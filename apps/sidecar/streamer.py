"""
Live-stream engine for the sidecar (STRM-01, STRM-02, D-03, D-05, D-08).

Exports:
  event_queue           — module-level asyncio.Queue(maxsize=500); 12-03 SSE endpoint drains it.
  start_streamer(app)   — background task: hold lock → open StreamClient → subscribe → loop.
  SubscriptionManager   — 490-cap LRU tracker; position legs always kept; ad-hoc evicted LRU.
  sync_subscriptions    — pure diff: (subscribed, desired_legs, ad_hoc, cap) → (to_add, to_remove).
  REQUIRED_OPTION_FIELDS — LevelOneOptionFields list for the LEVELONE_OPTIONS subscription.
  utc_now_z             — always ends in 'Z'; mirrors chain_proxy.py observedAt lesson.

Security (threat_model 12-02-PLAN.md):
  T-12-02-01: ACCOUNT stripped from ACCT_ACTIVITY before forwarding to event_queue.
  T-12-02-02: only type(exc).__name__ on errors; token values never logged.
  T-12-02-03: StreamClient constructed only after app.state.has_lock (Pitfall 9/Pattern 1).
  T-12-02-04: asyncio.Queue(maxsize=500) bounds memory growth.

Prohibitions:
  MUST NOT write any Postgres row (no leg_observations, no inserts) — STRM-04.
  MUST NOT branch on ACCT_ACTIVITY MESSAGE_TYPE strings — Pitfall 1.
  MUST NOT create StreamClient from market client — Pitfall 9.
  MUST NOT call level_one_option_subs for incremental additions — use level_one_option_add (Pitfall 11).
"""

import asyncio
import copy
import datetime
import logging
from collections import OrderedDict
from typing import Optional

logger = logging.getLogger(__name__)

# ── Module-level event queue (fan-out buffer) ────────────────────────────────
# Bounded at 500: if 12-03 SSE endpoint lags, ticks are dropped gracefully
# instead of growing unbounded (T-12-02-04).
event_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

# ── Timestamp helper (chain_proxy.py lesson) ─────────────────────────────────


def utc_now_z() -> str:
    """
    Current UTC time as ISO-8601 string always ending in 'Z'.

    Never '+00:00' — Zod .datetime() on the TS side rejects that suffix.
    Mirrors chain_proxy.py lines 98-102 (observedAt lesson, Pitfall 5).
    """
    return (
        datetime.datetime.now(tz=datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


# ── Required LEVELONE_OPTIONS fields (Pattern 2) ────────────────────────────
# Import from the installed schwab-py so field values are authoritative.
# Imported at module level so test_required_option_fields can verify enum values.
from schwab.streaming import StreamClient  # noqa: E402 — after local defs

REQUIRED_OPTION_FIELDS = [
    StreamClient.LevelOneOptionFields.SYMBOL,
    StreamClient.LevelOneOptionFields.MARK,
    StreamClient.LevelOneOptionFields.BID_PRICE,
    StreamClient.LevelOneOptionFields.ASK_PRICE,
    StreamClient.LevelOneOptionFields.UNDERLYING_PRICE,
    StreamClient.LevelOneOptionFields.DELTA,
    StreamClient.LevelOneOptionFields.GAMMA,
    StreamClient.LevelOneOptionFields.THETA,
    StreamClient.LevelOneOptionFields.VEGA,
    StreamClient.LevelOneOptionFields.RHO,
]


# ── SubscriptionManager ───────────────────────────────────────────────────────


class SubscriptionManager:
    """
    Tracks subscribed OCC symbols with LRU ordering for ad-hoc eviction (D-05).

    Position legs are always kept (never evicted). Ad-hoc symbols are evicted
    LRU when adding a new symbol would exceed CAP (490, 10 below Schwab's 500
    limit per D17 architecture note).

    Usage:
        sm = SubscriptionManager()
        sm.set_position_legs({"SPX   260620C05000000", ...})
        to_add, to_evict = sm.request_ad_hoc("SPX   260720C05500000")
        # Apply to StreamClient: level_one_option_add(to_add); level_one_option_unsubs(to_evict)
    """

    CAP: int = 490

    def __init__(self) -> None:
        self._position_legs: set[str] = set()
        # OrderedDict preserves insertion order → first key = oldest (LRU-evict first)
        self._ad_hoc: OrderedDict[str, None] = OrderedDict()

    @property
    def all_subscribed(self) -> set[str]:
        """All currently subscribed symbols: position legs + ad-hoc."""
        return self._position_legs | set(self._ad_hoc)

    def request_ad_hoc(self, symbol: str) -> tuple[list[str], list[str]]:
        """
        Request subscription for an ad-hoc symbol.

        Returns (to_add, to_evict).  Caller applies these to the StreamClient
        via level_one_option_add / level_one_option_unsubs (Pitfall 11: never
        use level_one_option_subs for incremental additions).

        - If symbol is already in all_subscribed: refresh LRU, return ([], []).
        - If at cap: evict the oldest ad-hoc (LRU) to make room; never evict a
          position leg.
        """
        if symbol in self.all_subscribed:
            # Refresh LRU if it's an ad-hoc entry
            if symbol in self._ad_hoc:
                self._ad_hoc.move_to_end(symbol)
            return [], []

        to_evict: list[str] = []
        while len(self.all_subscribed) >= self.CAP:
            if not self._ad_hoc:
                # Can't evict position legs — at hard limit; caller decides what to do
                break
            oldest = next(iter(self._ad_hoc))
            del self._ad_hoc[oldest]
            to_evict.append(oldest)

        self._ad_hoc[symbol] = None
        return [symbol], to_evict

    def set_position_legs(self, new_legs: set[str]) -> None:
        """
        Replace the current set of position legs.

        Ad-hoc symbols are untouched. Old legs no longer in new_legs are
        removed from all_subscribed; new legs are added.
        """
        self._position_legs = set(new_legs)


# ── sync_subscriptions (pure diff helper) ────────────────────────────────────


def sync_subscriptions(
    subscribed: set[str],
    desired_legs: list[str],
    ad_hoc: set[str],
    cap: int = 490,
) -> tuple[list[str], list[str]]:
    """
    Pure diff: compute incremental add/remove to move from `subscribed` to
    `desired_legs ∪ ad_hoc` while staying within `cap`.

    Position legs (desired_legs) are never dropped from to_add for cap
    enforcement — only ad-hoc symbols are trimmed.

    Returns:
        (to_add, to_remove) — caller applies via level_one_option_add / level_one_option_unsubs.
    """
    desired: set[str] = set(desired_legs) | ad_hoc
    to_add: list[str] = list(desired - subscribed)
    to_remove: list[str] = list(subscribed - desired)

    # Enforce cap: trim ad-hoc symbols from to_add if the result would exceed cap.
    legs_set = set(desired_legs)
    effective_size = len(subscribed) - len(to_remove) + len(to_add)
    while effective_size > cap:
        adhoc_candidates = [s for s in to_add if s not in legs_set]
        if not adhoc_candidates:
            break  # cannot trim further without removing a position leg — stop
        to_add.remove(adhoc_candidates[0])
        effective_size -= 1

    return to_add, to_remove


# ── Event handlers ────────────────────────────────────────────────────────────


async def _on_level_one_option(msg: dict) -> None:
    """
    Handle LEVELONE_OPTIONS messages from schwab-py.

    Emits a Z-suffixed tick dict to event_queue per content item.
    MARK is left None if absent (server applies midpoint fallback — Pitfall 4).

    Supports both named-key format (schwab-py after relabel_message, e.g. "MARK")
    and numeric string-key format (direct test calls, e.g. "37").
    """
    for item in msg.get("content", []):
        occ_symbol = item.get("key", "")
        if not occ_symbol:
            continue

        # Named key first (production), then numeric string fallback (tests / raw frames).
        # dict.get(k, default) avoids the falsy-0.0 bug that `item.get(k) or item.get(n)` has.
        mark = item.get("MARK", item.get("37"))             # None if absent — Pitfall 4
        bid = item.get("BID_PRICE", item.get("2"))
        ask = item.get("ASK_PRICE", item.get("3"))
        underlying_price = item.get("UNDERLYING_PRICE", item.get("35"))
        delta = item.get("DELTA", item.get("28"))
        gamma = item.get("GAMMA", item.get("29"))
        theta = item.get("THETA", item.get("30"))
        vega = item.get("VEGA", item.get("31"))
        rho = item.get("RHO", item.get("32"))

        tick: dict = {
            "type": "level_one_option",
            "ts": utc_now_z(),
            "occSymbol": occ_symbol,
            "mark": mark,
            "bid": bid,
            "ask": ask,
            "underlyingPrice": underlying_price,
            "delta": delta,
            "gamma": gamma,
            "theta": theta,
            "vega": vega,
            "rho": rho,
        }
        try:
            event_queue.put_nowait(tick)
        except asyncio.QueueFull:
            logger.warning(
                "streamer: event_queue full — dropping level_one_option tick for %s",
                occ_symbol,
            )


async def _on_acct_activity(msg: dict) -> None:
    """
    Handle ACCT_ACTIVITY messages from schwab-py.

    Logs every event at INFO (MESSAGE_TYPE values are undocumented — never filter
    or branch on them — Pitfall 1 / STRM-02 discipline).

    Strips the ACCOUNT field before forwarding to event_queue (T-12-02-01 — account
    numbers are sensitive and must never reach the browser SSE stream).

    Pushes: {type: "acct_activity", ts: Z, activity: <raw minus ACCOUNT>}
    """
    # Deep copy so stripping ACCOUNT does not mutate the original message object
    forwarded = copy.deepcopy(msg)

    for item in forwarded.get("content", []):
        message_type = item.get("MESSAGE_TYPE", "<unknown>")
        message_data = item.get("MESSAGE_DATA")
        logger.info(
            "sidecar: ACCT_ACTIVITY message_type=%s data=%s",
            message_type,
            (message_data[:200] if isinstance(message_data, str) else message_data),
        )
        # Strip account number — sensitive (T-12-02-01 / security row in RESEARCH)
        item.pop("ACCOUNT", None)

    event: dict = {
        "type": "acct_activity",
        "ts": utc_now_z(),
        "activity": forwarded,
    }
    try:
        event_queue.put_nowait(event)
    except asyncio.QueueFull:
        logger.warning("streamer: event_queue full — dropping acct_activity event")


# ── Position helper (stub — resolved by 12-03 positions-proxy) ───────────────


async def _get_position_occ_symbols(app: object) -> list[str]:
    """
    Get current open-position OCC symbols for the initial LEVELONE subscription.

    Returns empty list on any error; the stream starts without initial symbols
    and gets updated via ACCT_ACTIVITY + reconcile calls (D-03).
    Phase 12-03 wires the full /sidecar/positions reconcile endpoint.
    """
    try:
        trader_client = getattr(app.state, "trader_client", None)
        if trader_client is None:
            return []
        # Placeholder: full position loading via positions_proxy arrives in 12-03.
        return []
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "streamer: could not fetch initial position symbols (%s) — starting with empty set",
            type(exc).__name__,
        )
        return []


# ── Ad-hoc subscription coordinator (12-03, SC6) ─────────────────────────────


async def request_ad_hoc_subscription(app: object, symbol: str) -> Optional[dict]:
    """
    Coordinator for POST /sidecar/subscribe (D-05, SC6).

    Reads the live stream_client and subscription_manager from app.state (set by
    start_streamer after login).  Returns None when the stream is not yet active
    (not-streaming sentinel — the route handler maps this to 503 AUTH_EXPIRED).

    When the stream is active, calls subscription_manager.request_ad_hoc(symbol)
    to compute the incremental diff and applies it on the live StreamClient via:
      - level_one_option_add(to_add)    when new symbols must be added
      - level_one_option_unsubs(to_evict) when LRU-evicted symbols must be dropped

    MUST NOT call level_one_option_subs — that resets the entire subscription set
    and loses all existing position legs (Pitfall 11).

    Returns:
        {"subscribed": symbol, "evicted": to_evict}  on success
        None                                          when stream is not active
    """
    stream_client = getattr(app.state, "stream_client", None)
    subscription_manager = getattr(app.state, "subscription_manager", None)

    if stream_client is None or subscription_manager is None:
        return None  # not-streaming sentinel

    to_add, to_evict = subscription_manager.request_ad_hoc(symbol)

    # Apply the diff incrementally (Pitfall 11: NEVER level_one_option_subs here).
    if to_add:
        await stream_client.level_one_option_add(to_add)
    if to_evict:
        await stream_client.level_one_option_unsubs(to_evict)

    return {"subscribed": symbol, "evicted": to_evict}


# ── Background task ──────────────────────────────────────────────────────────


async def start_streamer(app: object) -> None:
    """
    Background task: open a single Schwab StreamClient session and stream events
    to event_queue. Stays warm during RTH with zero connected SSE clients (D-08).

    Must be launched AFTER app.state.has_lock is True — the advisory lock (GW-04)
    ensures only one session opens at a time (T-12-02-03 / Pattern 1).

    Degrades gracefully (logs warning, returns early) when trader_client is None.

    Exposes the live StreamClient and SubscriptionManager on app.state after login
    so POST /sidecar/subscribe can drive ad-hoc subscriptions (12-03 / SC6).

    Loop behavior (Pitfall 8):
      - CancelledError propagates cleanly (shutdown signal).
      - Any other exception in handle_message() is logged by type name only
        (never token values) and the loop continues — keep-alive style resilience.
    """
    trader_client = getattr(app.state, "trader_client", None)
    if trader_client is None:
        logger.warning(
            "streamer: trader_client not available — not starting stream (degrade)"
        )
        return

    # Trader client only — never market_client (Pitfall 9 / T-12-02-03)
    stream_client = StreamClient(trader_client)

    # SubscriptionManager: tracks subscribed OCC symbols with LRU for ad-hoc eviction.
    # Created here (post-lock) and exposed on app.state for POST /sidecar/subscribe.
    subscription_manager = SubscriptionManager()

    # login() calls /trader/v1/userPreference to get the WSS URL + credentials.
    # Must run AFTER the lock is held (Pattern 1 / T-12-02-03).
    await stream_client.login()

    # Expose the live handles on app.state so POST /sidecar/subscribe can drive
    # ad-hoc subscriptions via request_ad_hoc_subscription() (12-03 / SC6).
    # These are set AFTER login() so the StreamClient is ready to receive commands.
    app.state.stream_client = stream_client  # type: ignore[attr-defined]
    app.state.subscription_manager = subscription_manager  # type: ignore[attr-defined]

    # Subscribe to LEVELONE_OPTIONS for any open position legs.
    initial_symbols = await _get_position_occ_symbols(app)
    if initial_symbols:
        await stream_client.level_one_option_subs(initial_symbols, REQUIRED_OPTION_FIELDS)

    # Subscribe to ACCT_ACTIVITY — account-scoped, no symbol arg (Pitfall 3)
    await stream_client.account_activity_sub()

    # Register handlers: synchronous callbacks that schedule the async coroutines.
    # asyncio.ensure_future schedules on the running event loop without blocking.
    stream_client.add_level_one_option_handler(
        lambda msg: asyncio.ensure_future(_on_level_one_option(msg))
    )
    stream_client.add_account_activity_handler(
        lambda msg: asyncio.ensure_future(_on_acct_activity(msg))
    )

    # Message loop — handle_message() is a single-message pump; must be in a while-True
    # loop (Pitfall 8).  CancelledError propagates; all other exceptions are logged by
    # type name only (T-12-02-02) and the loop continues.
    while True:
        try:
            await stream_client.handle_message()
        except asyncio.CancelledError:
            raise  # clean shutdown
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "streamer: handle_message error (%s) — continuing",
                type(exc).__name__,
            )
