"""The pure extraction and the shell that pulls one user's Schwab
transactions and lands them in two independent tables (Phase 6, D6-01,
D6-02).

Pure/shell split follows `derive_connection_health`
(`vendor/connections.py`) and `derive_events` (`ledger/pairing.py`)
exactly: `extract_fills` and `sync_windows` below take no session and no
clock, so they are unit-testable with no database and no network.
`sync_user` is the shell -- it reads the connection, opens the vendor
client through Phase 4's existing `schwab_client_for_user`, calls
`get_transactions`, and writes both tables from the same response inside
one transaction.

**Ordering, carried from v1 without its cron offset (Pitfall 4,
06-RESEARCH.md).** v1 ran `sync-transactions` five minutes ahead of
`sync-fills` so the broker's own copy landed before the derived rows. This
project's `SchwabClient` names exactly one transaction-data method, so
there is no second job to offset against -- the reasoning carries forward
as write-order within one function instead: `insert_broker_transactions`
runs before `insert_fills`, inside the same transaction, so a partial
failure never leaves fills referencing transactions that never landed.

**Two honest limits, stated here and repeated in the plan's own SUMMARY,
not left implicit.**

1. `httpx.Response.json()` has already turned the vendor's decimal
   numerals into Python floats before any code here runs, so Pydantic's
   float-to-`Decimal` conversion recovers the intended digits through the
   shortest round-trip repr rather than reading the wire bytes. For
   four-decimal option prices that is exact (proven by a canary in this
   plan's tracer test); for a value carrying more significant digits than
   a float can hold it would not be, and that is a gap owed to the first
   live payload, not something this session can close (`NN-8`).
2. The vendor field mapping below (`amount`'s sign, the `cost`-sign
   fallback, `transferItems[].price` as `price_usd`'s source, the OCC
   symbol's real spacing) is carried from `salvage/vendor-notes.md`'s
   citation of the *deleted* v1 adapter, never re-verified against a live
   2026 Schwab response this session. Every one of these is named as owed
   to the first live run in this plan's own SUMMARY.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SchwabConnection
from morai.ingest.broker_transactions import (
    BrokerTransactionWrite,
    insert_broker_transactions,
)
from morai.ledger.fills import FillWrite, insert_fills
from morai.settings import Settings, get_settings
from morai.vendor.connections import (
    ConnectionNotFound,
    read_connection,
    schwab_client_for_user,
)
from morai.vendor.protocol import SchwabAuth

logger = logging.getLogger(__name__)

# --- The typed vendor boundary (D4-03 convention) --------------------------
#
# Extras ignored and every money/optional field genuinely optional --
# deliberately, and only here in the whole phase: the whole raw element is
# stored verbatim in `broker_transactions` regardless of shape, so this
# model only needs to be lenient enough that every element type
# `get_transactions` can return (TRADE, RECEIVE_AND_DELIVER,
# DIVIDEND_OR_INTEREST, a cash movement, ...) parses without raising
# (NN-14, Pitfall 3, 06-RESEARCH.md). `extract_fills` below, not this
# model, is what decides whether an element is actionable.


class _Instrument(BaseModel):
    """One `transferItems[].instrument`. `symbol`/`assetType` are Optional
    -- a non-option transfer item's instrument shape is unverified against
    a live payload this session (Assumptions Log, 06-RESEARCH.md)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    symbol: str | None = None
    asset_type: str | None = Field(default=None, alias="assetType")


class _TransferItem(BaseModel):
    """One `transferItems[]` entry. `amount`/`price`/`cost` are `Decimal |
    None` -- Pydantic v2 validates `Decimal` fields natively via `str()`,
    never `float()`, which is what preserves precision (see this module's
    own honest-limit paragraph above for the one place that still does not
    hold)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    instrument: _Instrument | None = None
    amount: Decimal | None = None
    price: Decimal | None = None
    cost: Decimal | None = None
    position_effect: str | None = Field(default=None, alias="positionEffect")


class _Transaction(BaseModel):
    """One `get_transactions` response element, of any `type`. `activity_id`
    is typed `int | str` and rendered through `str(...)` at the one place
    it becomes a key (`extract_fills`, `sync_user`) -- the vendor sends a
    JSON number, this project stores text to avoid an int64 assumption
    nothing here has verified, and a before-validator would take an
    untyped argument the `reportAny` gate would reject."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    activity_id: int | str = Field(alias="activityId")
    type: str
    time: datetime
    order_id: str | None = Field(default=None, alias="orderId")
    transfer_items: list[_TransferItem] = Field(
        default_factory=list, alias="transferItems"
    )


_TRANSACTIONS: TypeAdapter[list[_Transaction]] = TypeAdapter(list[_Transaction])
_JSON_LIST: TypeAdapter[list[JsonValue]] = TypeAdapter(list[JsonValue])


def _direction(
    amount: Decimal | None, cost: Decimal | None
) -> tuple[str, Decimal] | None:
    """`NN-10`, and this is the part that cost v1 real money. Reads the
    sign of the leg's own `amount` first and writes it into `side` as the
    vendor's own convention -- `"BUY"` for a positive amount, `"SELL"` for
    a negative one, matching the two strings
    `ledger/pairing.py::_signed_leg_amount` already accepts. Only after the
    sign is captured does the magnitude get taken -- never through Python's
    built-in absolute-value function anywhere in this module, by negating
    a negative value under the branch that already knows the sign.

    Falls back to the sign of `cost` when `amount` is absent or zero --
    Schwab sends `cost` as the negation of `amount`'s intent (carried from
    `salvage/vendor-notes.md`'s citation of the deleted v1 adapter,
    unverified against a live payload this session). Returns `None` when
    neither signal is usable -- a gap is honest, never guessed (`NN-11`,
    `NN-16`).
    """
    if amount is not None and amount != 0:
        if amount > 0:
            return "BUY", amount
        return "SELL", -amount
    if cost is not None and cost != 0:
        if cost < 0:
            return "BUY", -cost
        return "SELL", cost
    return None


def extract_fills(transaction: _Transaction) -> tuple[list[FillWrite], list[str]]:
    """Pure: no session, no clock, no broker call. Returns the fills
    extracted from one validated transaction element, plus a list of
    human-readable skip reasons -- one per skipped element or leg, so one
    unparseable element or leg never aborts the batch (`NN-14`, Pitfall 3).

    Returns no fills, with one skip reason, when the element is not a
    `TRADE`, when `orderId` is absent, or when it carries no option
    `transferItems`. For each option transfer item, in payload order,
    `leg_index` is its position among the option items -- `occ_symbol` is
    the instrument symbol with whitespace removed (owed to the first live
    payload: no source read this session shows Schwab's real spacing).
    `position_effect` is the vendor's own `positionEffect` string, written
    through unchanged, never mapped, uppercased or defaulted --
    `ledger/pairing.py::classify_fill` reads exactly this field and only
    this field (`NN-9`). `execution_time` is the transaction's own `time`.
    """
    fills: list[FillWrite] = []
    skip_reasons: list[str] = []
    activity_label = str(transaction.activity_id)

    if transaction.type != "TRADE":
        skip_reasons.append(
            f"activity {activity_label}: not a TRADE (type={transaction.type!r})"
        )
        return fills, skip_reasons
    if transaction.order_id is None:
        skip_reasons.append(f"activity {activity_label}: missing orderId")
        return fills, skip_reasons

    option_items = [
        item
        for item in transaction.transfer_items
        if item.instrument is not None and item.instrument.asset_type == "OPTION"
    ]
    if not option_items:
        skip_reasons.append(f"activity {activity_label}: no option transferItems")
        return fills, skip_reasons

    for leg_index, item in enumerate(option_items):
        instrument = item.instrument
        assert instrument is not None  # filtered above
        if instrument.symbol is None:
            skip_reasons.append(
                f"activity {activity_label} leg {leg_index}: no instrument symbol"
            )
            continue
        if item.position_effect is None:
            skip_reasons.append(
                f"activity {activity_label} leg {leg_index}: no positionEffect"
            )
            continue
        direction = _direction(item.amount, item.cost)
        if direction is None:
            skip_reasons.append(
                f"activity {activity_label} leg {leg_index}: "
                "no usable amount or cost to determine direction"
            )
            continue
        side, quantity = direction
        fills.append(
            FillWrite(
                order_id=transaction.order_id,
                occ_symbol=instrument.symbol.replace(" ", ""),
                leg_index=leg_index,
                execution_time=transaction.time,
                position_effect=item.position_effect,
                side=side,
                quantity=quantity,
                price_usd=item.price,
            )
        )

    return fills, skip_reasons


async def sync_all_connected_users(session: AsyncSession) -> list[UUID]:
    """Fans out one `sync_user` job per row in `schwab_connections`
    (D6-01, Pattern 1, 06-RESEARCH.md). Returns the list of user ids it
    deferred, in `schwab_connections`' own row order -- empty, with no
    error, when no user is connected.

    Runs on whatever session it is given, and that session must be the
    superuser one -- this is the one place in the ingest path where that
    is correct. The fan-out is a cross-tenant read by definition: it is
    asking which users exist, and no RLS context can be set for "all
    users" without either bypassing the policy (what a superuser session
    already does, honestly) or setting a context that is a lie. This
    function reads exactly one column, `user_id`, and touches no
    encrypted value, so a cross-tenant read here discloses only the set
    of connected users to a process that already holds the database
    credentials. Every per-user job it defers then runs under that user's
    own RLS context (`sync_user`'s own `set_config` call), which is where
    the isolation this phase exists to prove actually lives.

    Imports `app` from `morai.worker.app` inside the function body, not at
    module scope: `worker/app.py` already imports `sync_user` from this
    module at module scope, so a module-level `from morai.worker.app
    import app` here would cycle. By the time this function is actually
    called, both modules have finished loading -- the same local-import
    shape `Fill.__init__`/`BrokerTransaction.__init__` already use to
    break their own equivalent cycle.
    """
    from morai.worker.app import app

    user_ids = list(
        (await session.execute(select(SchwabConnection.user_id))).scalars().all()
    )
    for user_id in user_ids:
        await app.configure_task("sync_user").defer_async(user_id=str(user_id))
    return user_ids


def sync_windows(
    last_synced_at: datetime | None, now: datetime, settings: Settings
) -> list[tuple[datetime, datetime]]:
    """Pure: no clock read, no I/O. Returns half-open `(start, end)`
    windows covering `[start, now]`, each no wider than
    `settings.schwab_tx_max_range_days`.

    With `last_synced_at` set, `start` is that timestamp less
    `schwab_tx_sync_overlap_days`. With it `None` -- the first-connect
    signal Phase 4 shipped nullable and proved null -- `start` is `now`
    less `schwab_tx_lookback_max_days`. Derives the first-connect signal
    from `last_synced_at IS NULL` rather than a second stored boolean, the
    same reasoning `Position`'s own docstring gives for carrying no status
    column.

    **Owed to the first live run, not guessed here (D6-03).** The real
    per-call range limit and the real rate limit on `get_transactions` are
    both unmeasured -- `settings.schwab_tx_max_range_days` and
    `settings.schwab_tx_lookback_max_days` carry forward as named,
    injectable constants, not as verified facts. `sync_user` logs every
    window's requested bounds and returned element count; that logging is
    the instrument the first live run reads to settle both, and no delay
    or backoff is added ahead of a limit nobody has observed
    (`06-RESEARCH.md`'s own recommendation).

    **What the lookback does and does not guarantee for `INGEST-05`.** A
    position opened before the lookback window and still open has no
    fills inside the window this function returns, so a first-connect
    backfill does not recover it. 365 days covers every front leg this
    project's own structure uses by a wide margin -- a reasoned bound, not
    a measured one. Said here rather than assumed silently: a silent
    assumption is how a still-open calendar disappears.
    """
    if last_synced_at is not None:
        start = last_synced_at - timedelta(days=settings.schwab_tx_sync_overlap_days)
    else:
        start = now - timedelta(days=settings.schwab_tx_lookback_max_days)

    max_range = timedelta(days=settings.schwab_tx_max_range_days)
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < now:
        window_end = min(cursor + max_range, now)
        windows.append((cursor, window_end))
        cursor = window_end
    return windows


@dataclass(frozen=True)
class SyncOutcome:
    """The result of one `sync_user` call: the two landed counts, summed
    across every window, plus the accumulated skip reasons."""

    broker_transactions_landed: int
    fills_landed: int
    skip_reasons: tuple[str, ...]


async def sync_user(
    session: AsyncSession,
    user_id: UUID,
    *,
    auth: SchwabAuth,
    now: datetime,
) -> SyncOutcome:
    """The shell: resolve the connection, open the vendor client, and for
    each `sync_windows` window write the broker's raw copy then the
    extracted fills, inside the one caller-owned transaction.

    Sets `app.current_user_id` for this user with a transaction-local
    `set_config`, the same way the request path does, so RLS is evaluated
    for every read and write below rather than bypassed -- this must
    happen before `read_connection`, which itself reads an RLS-protected
    table.

    Takes this user's own `pg_advisory_xact_lock` as its very next action,
    before `read_connection` and before `sync_windows` -- the same shape
    `sync_events`'s own docstring documents for the identical race
    (`ledger/pairing.py`, CR-02, `05-REVIEW.md`). `last_synced_at` is the
    value that decides which windows get synced; reading it before the
    lock let two overlapping calls for the same user compute windows from
    the same stale read (WR-01, `06-REVIEW.md`). `schwab_client_for_user`
    (`vendor/connections.py`) then acquires this same lock again as its
    own first action -- a harmless no-op re-acquisition within the same
    transaction, `pg_advisory_xact_lock` being re-entrant there, not a
    second, independent critical section. The lock is transaction-scoped,
    so it stays held through the caller's own `last_synced_at` write and
    releases only at that commit -- what actually serialises two full
    sync cycles for one user end to end, not merely the window this
    function's own body covers.

    Never calls `get_transactions` with both dates unset -- every call
    passes the window's own explicit `start_date`/`end_date` from
    `sync_windows`, and logs the requested bounds and the returned element
    count at info level, one line per call. That logging is not
    incidental: it is the measurement `D6-03` asks the first live run to
    produce (Pitfall 2, 06-RESEARCH.md).

    Writes `insert_broker_transactions` before `insert_fills`, per window,
    inside the same transaction -- this module's own docstring explains
    why. Does not commit and does not swallow exceptions: a raised
    `ConnectionNotFound` or vendor failure propagates so the caller's
    transaction rolls back whole, which is what `schwab_client_for_user`'s
    own context manager already relies on.
    """
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
        {"uid": str(user_id)},
    )

    connection = await read_connection(session, user_id)
    if connection is None:
        raise ConnectionNotFound(
            f"No schwab_connections row for user_id={user_id} -- nothing to sync."
        )

    settings = get_settings()
    windows = sync_windows(connection.last_synced_at, now, settings)

    broker_transactions_landed = 0
    fills_landed = 0
    skip_reasons: list[str] = []

    async with schwab_client_for_user(session, user_id, auth) as client:
        for start, end in windows:
            response = await client.get_transactions(
                connection.account_hash, start_date=start, end_date=end
            )
            raw_elements = _JSON_LIST.validate_python(response)
            transactions = _TRANSACTIONS.validate_python(raw_elements)
            logger.info(
                "sync_user user_id=%s window=%s..%s elements=%d",
                user_id,
                start.isoformat(),
                end.isoformat(),
                len(transactions),
            )

            broker_rows: list[BrokerTransactionWrite] = []
            fill_rows: list[FillWrite] = []
            for raw_element, transaction in zip(
                raw_elements, transactions, strict=True
            ):
                broker_rows.append(
                    BrokerTransactionWrite(
                        activity_id=str(transaction.activity_id),
                        transaction_type=transaction.type,
                        transaction_time=transaction.time,
                        order_id=transaction.order_id,
                        raw_payload=raw_element,
                    )
                )
                extracted, reasons = extract_fills(transaction)
                fill_rows.extend(extracted)
                skip_reasons.extend(reasons)

            broker_transactions_landed += await insert_broker_transactions(
                session, user_id, broker_rows
            )
            fills_landed += await insert_fills(session, user_id, fill_rows)

    return SyncOutcome(
        broker_transactions_landed=broker_transactions_landed,
        fills_landed=fills_landed,
        skip_reasons=tuple(skip_reasons),
    )
