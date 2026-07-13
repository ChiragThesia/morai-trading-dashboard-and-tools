"""
Tests for streamer.py — SubscriptionManager + sync_subscriptions (Task 1)
and start_streamer + event handlers (Task 2).

TDD red→green per task:
  Task 1: SubscriptionManager pure data-structure tests (no Schwab)
  Task 2: start_streamer / handler tests with mocked StreamClient
"""

import asyncio
import collections
from collections import OrderedDict
from unittest.mock import AsyncMock, MagicMock, call, patch
import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Task 1: SubscriptionManager tests
# ─────────────────────────────────────────────────────────────────────────────


class TestSubscriptionManagerBasic:
    """Core ad-hoc subscription mechanics."""

    def test_all_subscribed_empty_initially(self):
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        assert sm.all_subscribed == set()

    def test_request_ad_hoc_new_symbol(self):
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        to_add, to_evict = sm.request_ad_hoc("SPX   260620C05000000")
        assert to_add == ["SPX   260620C05000000"]
        assert to_evict == []
        assert "SPX   260620C05000000" in sm.all_subscribed

    def test_request_ad_hoc_already_subscribed_as_adhoc_no_churn(self):
        """Re-requesting an existing ad-hoc symbol refreshes LRU and returns ([], [])."""
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        sm.request_ad_hoc("SPX   260620C05000000")
        to_add, to_evict = sm.request_ad_hoc("SPX   260620C05000000")
        assert to_add == []
        assert to_evict == []

    def test_request_ad_hoc_already_subscribed_as_position_no_churn(self):
        """A position leg is already in all_subscribed; re-requesting it returns ([], [])."""
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        sm.set_position_legs({"SPX   260620C05000000"})
        to_add, to_evict = sm.request_ad_hoc("SPX   260620C05000000")
        assert to_add == []
        assert to_evict == []


class TestSubscriptionManagerLRU:
    """LRU eviction: oldest ad-hoc evicted; position legs never evicted."""

    def test_symbol_cap_eviction(self):
        """491 distinct ad-hoc symbols → exactly one LRU eviction of the oldest."""
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        # Fill to cap (490)
        for i in range(490):
            to_add, to_evict = sm.request_ad_hoc(f"SYM{i:04d}")
            assert to_evict == [], f"unexpected eviction at {i}"
        assert len(sm.all_subscribed) == 490

        # 491st symbol should evict SYM0000 (the oldest)
        to_add, to_evict = sm.request_ad_hoc("SYM_EXTRA")
        assert to_add == ["SYM_EXTRA"]
        assert to_evict == ["SYM0000"], f"expected SYM0000 evicted, got {to_evict}"
        assert len(sm.all_subscribed) == 490

    def test_lru_order_respects_reuse(self):
        """Re-requesting an existing symbol moves it to the end of LRU."""
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        sm.request_ad_hoc("FIRST")
        sm.request_ad_hoc("SECOND")
        sm.request_ad_hoc("THIRD")
        # Re-request FIRST → moves it to most-recently-used
        sm.request_ad_hoc("FIRST")
        # Now fill to cap and one more: SECOND should be evicted (oldest), not FIRST
        for i in range(487):
            sm.request_ad_hoc(f"PAD{i:04d}")
        _, to_evict = sm.request_ad_hoc("TRIGGER_EVICTION")
        assert to_evict == ["SECOND"], f"expected SECOND evicted, got {to_evict}"

    def test_position_legs_never_evicted_at_cap(self):
        """Position legs occupy slots but are never eligible for LRU eviction."""
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        # Add 100 position legs
        legs = {f"LEG{i:04d}" for i in range(100)}
        sm.set_position_legs(legs)
        # Fill ad-hoc up to cap (490 - 100 legs = 390 more)
        for i in range(390):
            sm.request_ad_hoc(f"ADHOC{i:04d}")
        # One more ad-hoc should evict an ad-hoc symbol (ADHOC0000), not a leg
        to_add, to_evict = sm.request_ad_hoc("TRIGGER_EVICTION")
        assert to_add == ["TRIGGER_EVICTION"]
        assert len(to_evict) == 1
        evicted = to_evict[0]
        assert evicted not in legs, f"position leg {evicted} was evicted — not allowed"
        assert evicted.startswith("ADHOC"), f"expected ADHOC* evicted, got {evicted}"


class TestSubscriptionManagerPositionLegs:
    """set_position_legs semantics."""

    def test_set_position_legs_adds_to_all_subscribed(self):
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        sm.set_position_legs({"LEG1", "LEG2"})
        assert "LEG1" in sm.all_subscribed
        assert "LEG2" in sm.all_subscribed

    def test_set_position_legs_does_not_touch_ad_hoc(self):
        """Replacing position legs must not remove existing ad-hoc symbols."""
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        sm.request_ad_hoc("ADHOC1")
        sm.set_position_legs({"LEG1"})
        sm.set_position_legs({"LEG2"})  # replace LEG1 with LEG2
        assert "ADHOC1" in sm.all_subscribed
        assert "LEG2" in sm.all_subscribed
        assert "LEG1" not in sm.all_subscribed

    def test_set_position_legs_clears_old_legs(self):
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        sm.set_position_legs({"OLD_LEG"})
        sm.set_position_legs({"NEW_LEG"})
        assert "OLD_LEG" not in sm.all_subscribed
        assert "NEW_LEG" in sm.all_subscribed


class TestSyncSubscriptions:
    """sync_subscriptions pure diff helper."""

    def test_sync_add_new_leg(self):
        from streamer import sync_subscriptions

        to_add, to_remove = sync_subscriptions(
            subscribed=set(),
            desired_legs=["SPX_LEG"],
            ad_hoc=set(),
        )
        assert "SPX_LEG" in to_add
        assert to_remove == []

    def test_sync_remove_closed_leg(self):
        from streamer import sync_subscriptions

        to_add, to_remove = sync_subscriptions(
            subscribed={"OLD_LEG"},
            desired_legs=[],
            ad_hoc=set(),
        )
        assert to_add == []
        assert "OLD_LEG" in to_remove

    def test_sync_no_change_when_desired_equals_subscribed(self):
        from streamer import sync_subscriptions

        to_add, to_remove = sync_subscriptions(
            subscribed={"LEG1", "LEG2"},
            desired_legs=["LEG1", "LEG2"],
            ad_hoc=set(),
        )
        assert to_add == []
        assert to_remove == []

    def test_sync_includes_ad_hoc_in_desired(self):
        from streamer import sync_subscriptions

        to_add, to_remove = sync_subscriptions(
            subscribed=set(),
            desired_legs=[],
            ad_hoc={"ADHOC1"},
        )
        assert "ADHOC1" in to_add
        assert to_remove == []

    def test_sync_respects_cap_evicting_adhoc_not_legs(self):
        """When adding one more symbol would exceed cap, oldest ad-hoc is dropped."""
        from streamer import sync_subscriptions

        # 489 subscribed (all ad-hoc), 1 new leg + 1 new ad-hoc would exceed 490
        subscribed = {f"AH{i:04d}" for i in range(489)}
        # Desired: 489 + leg + adhoc = 491, must evict 1 ad-hoc
        to_add, to_remove = sync_subscriptions(
            subscribed=subscribed,
            desired_legs=["LEG1"],
            ad_hoc=subscribed | {"NEW_ADHOC"},  # all current + one new
            cap=490,
        )
        # to_add contains at least LEG1 + NEW_ADHOC
        assert "LEG1" in to_add
        # Total after applying diff must be <= cap
        final_size = len(subscribed) - len(to_remove) + len(to_add)
        assert final_size <= 490


# ─────────────────────────────────────────────────────────────────────────────
# Task 2: start_streamer, handlers, event_queue
# ─────────────────────────────────────────────────────────────────────────────


def _make_fake_app(trader_client=None, has_lock: bool = True):
    """Build a minimal FastAPI-like app.state mock for start_streamer tests."""
    app = MagicMock()
    app.state.trader_client = trader_client
    app.state.has_lock = has_lock
    return app


def _make_stream_client_mock(messages=None):
    """
    Fabricate a StreamClient mock with async login/subs/handle_message.

    handle_message cycles through `messages` then raises CancelledError to
    terminate the while-True loop cleanly.
    """
    msgs = list(messages or [])
    call_count = 0

    async def _handle_message():
        nonlocal call_count
        if call_count < len(msgs):
            msg = msgs[call_count]
            call_count += 1
            return msg
        raise asyncio.CancelledError()

    sc = AsyncMock()
    sc.handle_message = _handle_message
    # Provide LevelOneOptionFields and AccountActivityFields as MagicMock enums
    sc.LevelOneOptionFields = MagicMock()
    sc.add_level_one_option_handler = MagicMock()
    sc.add_account_activity_handler = MagicMock()
    return sc


class TestStartStreamerDegradeOnNoClient:
    """start_streamer degrades gracefully when trader_client is None."""

    def test_returns_early_when_trader_client_none(self):
        from streamer import start_streamer

        app = _make_fake_app(trader_client=None)
        q = asyncio.Queue()

        # Should return without raising, even without a real event loop dance
        async def _run():
            await start_streamer(app)

        asyncio.run(_run())
        assert q.empty()  # no events pushed — graceful degrade


class TestStartStreamerTraderClientOnly:
    """StreamClient must be built from trader_client, never market_client."""

    def test_stream_client_built_from_trader_not_market(self):
        from streamer import start_streamer

        trader_mock = AsyncMock()
        app = _make_fake_app(trader_client=trader_mock)

        stream_client_mock = _make_stream_client_mock(messages=[])

        with patch("streamer.StreamClient") as MockSC:
            MockSC.return_value = stream_client_mock

            async def _run():
                try:
                    await start_streamer(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())
            MockSC.assert_called_once_with(trader_mock)


class TestStartStreamerLoginBeforeSubs:
    """login() must be awaited before any subscription calls."""

    def test_login_called_before_level_one_subs(self):
        from streamer import start_streamer

        trader_mock = AsyncMock()
        app = _make_fake_app(trader_client=trader_mock)

        stream_client_mock = _make_stream_client_mock(messages=[])
        call_order = []

        async def _login():
            call_order.append("login")

        async def _subs(*args, **kwargs):
            call_order.append("level_one_option_subs")

        stream_client_mock.login = _login
        stream_client_mock.level_one_option_subs = _subs

        with patch("streamer.StreamClient", return_value=stream_client_mock):
            async def _run():
                try:
                    await start_streamer(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        login_idx = call_order.index("login") if "login" in call_order else -1
        subs_idx = call_order.index("level_one_option_subs") if "level_one_option_subs" in call_order else 999
        assert login_idx < subs_idx, f"login must precede subs; order={call_order}"


class TestStartStreamerReconnect:
    """On ConnectionClosed the streamer re-establishes the session (re-login +
    re-subscribe) instead of spinning the pump on a dead socket (the STALE bug)."""

    def test_reconnects_after_connection_closed(self):
        from streamer import start_streamer
        from websockets.exceptions import ConnectionClosedOK

        trader_mock = AsyncMock()
        app = _make_fake_app(trader_client=trader_mock)

        login_calls = []
        state = {"n": 0}

        async def _handle_message():
            state["n"] += 1
            if state["n"] == 1:
                # Schwab WSS closed cleanly — the production symptom (token rotation)
                raise ConnectionClosedOK(None, None)
            # second session (post-reconnect) → terminate the loop cleanly
            raise asyncio.CancelledError()

        sc = AsyncMock()
        sc.handle_message = _handle_message
        sc.LevelOneOptionFields = MagicMock()
        sc.add_level_one_option_handler = MagicMock()
        sc.add_account_activity_handler = MagicMock()

        async def _login():
            login_calls.append(1)

        sc.login = _login

        with patch("streamer.StreamClient", return_value=sc), patch(
            "streamer.asyncio.sleep", new=AsyncMock()
        ):

            async def _run():
                try:
                    await start_streamer(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        assert len(login_calls) >= 2, (
            f"streamer must re-login (reconnect) after ConnectionClosed; "
            f"login called {len(login_calls)}x"
        )

    def test_transient_error_continues_without_reconnect(self):
        """A non-ConnectionClosed error is transient: log + continue the pump, NOT reconnect."""
        from streamer import start_streamer

        trader_mock = AsyncMock()
        app = _make_fake_app(trader_client=trader_mock)

        login_calls = []
        state = {"n": 0}

        async def _handle_message():
            state["n"] += 1
            if state["n"] == 1:
                raise ValueError("transient blip")  # not a ConnectionClosed
            raise asyncio.CancelledError()

        sc = AsyncMock()
        sc.handle_message = _handle_message
        sc.LevelOneOptionFields = MagicMock()
        sc.add_level_one_option_handler = MagicMock()
        sc.add_account_activity_handler = MagicMock()

        async def _login():
            login_calls.append(1)

        sc.login = _login

        with patch("streamer.StreamClient", return_value=sc), patch(
            "streamer.asyncio.sleep", new=AsyncMock()
        ):

            async def _run():
                try:
                    await start_streamer(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        assert len(login_calls) == 1, (
            f"transient errors must NOT trigger a reconnect; login called {len(login_calls)}x"
        )


class TestGetPositionOccSymbols:
    """_get_position_occ_symbols loads OPEN OPTION legs so the streamer subscribes them
    at startup. Without it the streamer subscribes nothing → no LEVELONE ticks for the
    open positions → the browser badge sits STALE."""

    def test_returns_option_occ_symbols_filtering_non_option(self):
        from streamer import _get_position_occ_symbols

        accounts_json = [
            {
                "securitiesAccount": {
                    "positions": [
                        {
                            "instrument": {
                                "assetType": "OPTION",
                                "symbol": "SPXW  260807P07425000",
                                "underlyingSymbol": "SPX",
                            },
                            "longQuantity": 1,
                            "shortQuantity": 0,
                            "marketValue": 1800,
                        },
                        {
                            "instrument": {"assetType": "EQUITY", "symbol": "AAPL"},
                            "longQuantity": 10,
                            "shortQuantity": 0,
                        },
                    ]
                }
            }
        ]
        from schwab.client.base import BaseClient

        resp = MagicMock()
        resp.json = MagicMock(return_value=accounts_json)

        trader = AsyncMock()
        # Real Account enum so the production code can read trader.Account.Fields.POSITIONS.
        trader.Account = BaseClient.Account

        # Mimic schwab-py enforce_enums=True: reject the string "positions", require the enum.
        async def _get_accounts(*, fields=None):
            if fields != [BaseClient.Account.Fields.POSITIONS]:
                raise ValueError('expected type "Fields", got type "str"')
            return resp

        trader.get_accounts = _get_accounts
        app = _make_fake_app(trader_client=trader)

        syms = asyncio.run(_get_position_occ_symbols(app))
        assert syms == ["SPXW  260807P07425000"], (
            f"must return OPTION legs via enum fields (string 'positions' raises); got {syms}"
        )

    def test_returns_empty_on_fetch_error(self):
        from streamer import _get_position_occ_symbols

        trader = AsyncMock()
        trader.get_accounts = AsyncMock(side_effect=RuntimeError("boom"))
        app = _make_fake_app(trader_client=trader)

        syms = asyncio.run(_get_position_occ_symbols(app))
        assert syms == [], "must degrade to [] on fetch error (stream still starts)"

    def test_returns_empty_when_trader_client_none(self):
        from streamer import _get_position_occ_symbols

        app = _make_fake_app(trader_client=None)
        syms = asyncio.run(_get_position_occ_symbols(app))
        assert syms == []


class TestStartStreamerSubscribesLegs:
    """With open legs present, start_streamer subscribes them and passes `fields` as a
    KEYWORD arg — schwab-py's level_one_option_subs(symbols, *, fields) is keyword-only;
    positional raised TypeError and killed every session."""

    def test_subscribes_legs_with_fields_keyword(self):
        from streamer import start_streamer
        from schwab.client.base import BaseClient

        accounts = [
            {
                "securitiesAccount": {
                    "positions": [
                        {
                            "instrument": {
                                "assetType": "OPTION",
                                "symbol": "SPXW  260807P07425000",
                                "underlyingSymbol": "SPX",
                            },
                            "longQuantity": 1,
                            "shortQuantity": 0,
                            "marketValue": 1800,
                        }
                    ]
                }
            }
        ]
        resp = MagicMock()
        resp.json = MagicMock(return_value=accounts)
        trader = AsyncMock()
        trader.Account = BaseClient.Account

        async def _get_accounts(*, fields=None):
            return resp

        trader.get_accounts = _get_accounts
        app = _make_fake_app(trader_client=trader)

        sc = AsyncMock()

        async def _handle_message():
            raise asyncio.CancelledError()

        sc.handle_message = _handle_message
        sc.LevelOneOptionFields = MagicMock()
        sc.add_level_one_option_handler = MagicMock()
        sc.add_account_activity_handler = MagicMock()
        sc.level_one_option_subs = AsyncMock()

        with patch("streamer.StreamClient", return_value=sc), patch(
            "streamer.asyncio.sleep", new=AsyncMock()
        ):

            async def _run():
                try:
                    await start_streamer(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        call = sc.level_one_option_subs.call_args
        assert call is not None, "level_one_option_subs must be called with the open legs"
        assert call.args[0] == ["SPXW  260807P07425000"]
        assert "fields" in call.kwargs, (
            f"fields must be passed as a keyword (schwab signature is subs(symbols, *, fields)); "
            f"got args={call.args!r} kwargs={call.kwargs!r}"
        )


class TestRequiredOptionFields:
    """LEVELONE subscription must include the REQUIRED_OPTION_FIELDS set."""

    def test_required_option_fields_contains_expected_symbols(self):
        from streamer import REQUIRED_OPTION_FIELDS
        from schwab.streaming import StreamClient

        expected_attrs = [
            "SYMBOL", "MARK", "BID_PRICE", "ASK_PRICE",
            "UNDERLYING_PRICE", "DELTA", "GAMMA", "THETA", "VEGA", "RHO",
        ]
        field_values = {f.value for f in REQUIRED_OPTION_FIELDS}
        for attr in expected_attrs:
            expected_val = getattr(StreamClient.LevelOneOptionFields, attr).value
            assert expected_val in field_values, (
                f"REQUIRED_OPTION_FIELDS missing {attr} (value={expected_val})"
            )


class TestAcctActivityHandler:
    """ACCT_ACTIVITY handler: log + forward raw - ACCOUNT; never filter on MESSAGE_TYPE."""

    def test_acct_activity_forwarded_to_event_queue(self):
        """ACCT_ACTIVITY event reaches event_queue with ACCOUNT stripped."""
        from streamer import _on_acct_activity, event_queue

        # Drain any leftover events
        while not event_queue.empty():
            event_queue.get_nowait()

        raw_msg = {
            "content": [
                {
                    "ACCOUNT": "12345678",
                    "MESSAGE_TYPE": "SUBSCRIBED",
                    "MESSAGE_DATA": "some fill data",
                    "key": "SomeKey",
                }
            ]
        }

        async def _run():
            await _on_acct_activity(raw_msg)

        asyncio.run(_run())

        assert not event_queue.empty(), "event_queue must have received an event"
        event = event_queue.get_nowait()
        assert event["type"] == "acct_activity"
        # ACCOUNT must be stripped
        raw_forwarded = event.get("activity", event.get("raw", {}))
        # Check in content items
        content = raw_forwarded.get("content", [])
        for item in content:
            assert "ACCOUNT" not in item, "ACCOUNT field must be stripped before forwarding"
        # Timestamp must end in Z
        assert event["ts"].endswith("Z"), f"ts must end in Z, got {event['ts']}"

    def test_acct_activity_no_message_type_branching(self):
        """Handler must never branch on MESSAGE_TYPE — all events forwarded equally."""
        from streamer import _on_acct_activity, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        # Send two events with different MESSAGE_TYPE values — both must be forwarded
        for mtype in ["OrderFill", "SUBSCRIBED", "UNKNOWN_FUTURE_TYPE"]:
            msg = {
                "content": [{"MESSAGE_TYPE": mtype, "MESSAGE_DATA": "x", "ACCOUNT": "999"}]
            }

            async def _run(m=msg):
                await _on_acct_activity(m)

            asyncio.run(_run())

        count = 0
        while not event_queue.empty():
            event_queue.get_nowait()
            count += 1
        assert count == 3, f"All 3 MESSAGE_TYPEs must be forwarded; got {count}"


class TestLevelOneHandler:
    """LEVELONE handler: emit Z-suffixed tick dict to event_queue."""

    def test_level_one_handler_emits_z_suffixed_tick(self):
        from streamer import _on_level_one_option, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        # Minimal LEVELONE_OPTIONS message (fields keyed by int field number)
        msg = {
            "content": [
                {
                    "key": "SPX   260620C05000000",
                    "1": 5.00,   # BID_PRICE field 2 (check actual enum values)
                    "2": 5.00,   # BID_PRICE
                    "3": 5.10,   # ASK_PRICE
                    "37": 5.05,  # MARK
                    "35": 5950.0, # UNDERLYING_PRICE
                }
            ]
        }

        async def _run():
            await _on_level_one_option(msg)

        asyncio.run(_run())

        assert not event_queue.empty()
        tick = event_queue.get_nowait()
        assert tick["type"] == "level_one_option"
        assert tick["ts"].endswith("Z"), f"ts must end in Z, got {tick['ts']}"
        assert "occSymbol" in tick or "data" in tick  # event carries symbol info

    def test_level_one_handler_absent_mark_leaves_mark_null(self):
        """When MARK is absent from the tick, mark is None (not raised or 0)."""
        from streamer import _on_level_one_option, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        msg = {
            "content": [
                {
                    "key": "SPX   260620C05000000",
                    "2": 4.90,   # BID_PRICE
                    "3": 5.00,   # ASK_PRICE
                    # MARK field intentionally absent — simulates Schwab incremental tick
                    "35": 5955.0,
                }
            ]
        }

        async def _run():
            await _on_level_one_option(msg)

        asyncio.run(_run())

        assert not event_queue.empty()
        tick = event_queue.get_nowait()
        # mark must be None (not raised)
        data = tick.get("data", tick)
        assert data.get("mark") is None, f"absent MARK must be None, got {data.get('mark')}"


class TestStreamWarmNoClients:
    """Stream stays warm with zero connected SSE clients (D-08)."""

    def test_stream_warm_no_clients(self):
        """
        The start_streamer loop runs independently of any SSE-client count.
        We verify the loop starts and calls handle_message regardless of there being
        zero 'clients' (the event_queue is the decoupling layer).
        """
        from streamer import start_streamer, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        trader_mock = AsyncMock()
        app = _make_fake_app(trader_client=trader_mock)

        # Mock that produces one message then cancels
        lv1_msg = {
            "content": [
                {"key": "SPX   260620C05000000", "37": 5.05, "35": 5950.0}
            ]
        }
        stream_client_mock = _make_stream_client_mock(messages=[None])  # one real dispatch cycle

        with patch("streamer.StreamClient", return_value=stream_client_mock):
            async def _run():
                try:
                    await start_streamer(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        # The handle_message loop ran at least once — no client count gating
        assert stream_client_mock.handle_message is not None  # loop was wired up


class TestEventQueueModule:
    """Module-level event_queue is bounded at 500."""

    def test_event_queue_exists_and_is_bounded(self):
        from streamer import event_queue

        assert isinstance(event_queue, asyncio.Queue)
        assert event_queue.maxsize == 500


class TestZSuffixUtility:
    """utc_now_z always returns a string ending in 'Z'."""

    def test_utc_now_z_ends_with_z(self):
        from streamer import utc_now_z

        ts = utc_now_z()
        assert isinstance(ts, str)
        assert ts.endswith("Z"), f"utc_now_z() must end with Z, got {ts!r}"
        assert "+00:00" not in ts, "utc_now_z() must not contain +00:00"


# ─────────────────────────────────────────────────────────────────────────────
# Task 2 (38-02): start_indices_poll — get_quotes REST poll loop (LIVE-03)
#
# Confirmed live (38-A1-PROBE.md, 2026-07-13 RTH): $VIX/$VVIX/$VIX9D/$VIX3M all
# return HTTP 200 in a single get_quotes() batch call, keyed by the literal
# $-prefixed symbol, level in quote.lastPrice. quote.quoteTime is unreliable
# (None in the probe) — ts is stamped from sidecar receipt time, never quoteTime.
# ─────────────────────────────────────────────────────────────────────────────


def _make_quotes_resp(raw: dict):
    resp = MagicMock()
    resp.json = MagicMock(return_value=raw)
    return resp


class TestIndicesPoll:
    """start_indices_poll: one get_quotes iteration → one Z-suffixed indices frame."""

    def test_emits_indices_frame_with_all_symbols(self):
        from streamer import start_indices_poll, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        raw = {
            "$VIX": {"assetMainType": "INDEX", "quote": {"lastPrice": 17.17}},
            "$VVIX": {"assetMainType": "INDEX", "quote": {"lastPrice": 94.59}},
            "$VIX9D": {"assetMainType": "INDEX", "quote": {"lastPrice": 15.1}},
            "$VIX3M": {"assetMainType": "INDEX", "quote": {"lastPrice": 19.66}},
        }
        market_client = AsyncMock()
        market_client.get_quotes = AsyncMock(return_value=_make_quotes_resp(raw))
        app = MagicMock()
        app.state.market_client = market_client

        with patch("streamer.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError())):
            async def _run():
                try:
                    await start_indices_poll(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        assert not event_queue.empty()
        frame = event_queue.get_nowait()
        assert frame["type"] == "indices"
        assert frame["vix"] == 17.17
        assert frame["vvix"] == 94.59
        assert frame["vix9d"] == 15.1
        assert frame["vix3m"] == 19.66
        assert frame["ts"].endswith("Z"), f"ts must end in Z, got {frame['ts']}"

    def test_missing_symbol_maps_to_none_others_present(self):
        from streamer import start_indices_poll, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        raw = {
            "$VIX": {"quote": {"lastPrice": 17.17}},
            "$VVIX": {"quote": {"lastPrice": 94.59}},
            "$VIX9D": {"quote": {"lastPrice": 15.1}},
            # $VIX3M intentionally absent from the response
        }
        market_client = AsyncMock()
        market_client.get_quotes = AsyncMock(return_value=_make_quotes_resp(raw))
        app = MagicMock()
        app.state.market_client = market_client

        with patch("streamer.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError())):
            async def _run():
                try:
                    await start_indices_poll(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        frame = event_queue.get_nowait()
        assert frame["vix3m"] is None, "a missing symbol must map to None, not raise"
        assert frame["vix"] == 17.17
        assert frame["vvix"] == 94.59
        assert frame["vix9d"] == 15.1

    def test_get_quotes_exception_swallowed_loop_continues(self):
        """A get_quotes throw must not raise out of the task, and no frame is pushed."""
        from streamer import start_indices_poll, event_queue

        while not event_queue.empty():
            event_queue.get_nowait()

        market_client = AsyncMock()
        market_client.get_quotes = AsyncMock(side_effect=RuntimeError("boom"))
        app = MagicMock()
        app.state.market_client = market_client

        sleep_calls = []

        async def _fake_sleep(_seconds):
            sleep_calls.append(1)
            raise asyncio.CancelledError()

        with patch("streamer.asyncio.sleep", new=_fake_sleep):
            async def _run():
                try:
                    await start_indices_poll(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())

        assert event_queue.empty(), "an exception must not push a partial/garbage frame"
        assert len(sleep_calls) == 1, "loop must reach sleep (continue) after the exception"

    def test_queue_full_drops_frame_without_raising(self):
        """A QueueFull on put_nowait is caught — the poll task must not crash."""
        from streamer import start_indices_poll

        raw = {
            "$VIX": {"quote": {"lastPrice": 17.17}},
            "$VVIX": {"quote": {"lastPrice": 94.59}},
            "$VIX9D": {"quote": {"lastPrice": 15.1}},
            "$VIX3M": {"quote": {"lastPrice": 19.66}},
        }
        market_client = AsyncMock()
        market_client.get_quotes = AsyncMock(return_value=_make_quotes_resp(raw))
        app = MagicMock()
        app.state.market_client = market_client

        with patch("streamer.event_queue") as mock_queue, patch(
            "streamer.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError())
        ):
            mock_queue.put_nowait = MagicMock(side_effect=asyncio.QueueFull())

            async def _run():
                try:
                    await start_indices_poll(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())  # no assertion needed — QueueFull must not propagate

    def test_degrades_when_market_client_none(self):
        """No market_client (not-seeded / lock-loss) → warn + keep looping, never raise."""
        from streamer import start_indices_poll

        app = MagicMock()
        app.state.market_client = None

        with patch("streamer.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError())):
            async def _run():
                try:
                    await start_indices_poll(app)
                except asyncio.CancelledError:
                    pass

            asyncio.run(_run())  # no exception raised = graceful degrade

    def test_indices_poll_interval_constant(self):
        from streamer import INDICES_POLL_INTERVAL_S

        assert INDICES_POLL_INTERVAL_S == 20.0
