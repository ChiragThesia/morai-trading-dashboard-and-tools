"""The core value, checked (Phase 9, `RECON-01`, `RECON-02`, `D9-01`..`D9-13`):
realised P&L, net of commissions, must equal the broker's own cash delta
over the same settlement-date trading-day window, or the check honestly
cannot tell.

## The arithmetic (`D9-05`, `D5-04`)

`reconcile_window` compares two independently-sourced sides for exact
`Decimal` equality, no epsilon (`D9-07`):

    (the window's realised P&L, from `events` -- a CLOSE contributes
     `close_credit_usd`, an OPEN contributes minus `open_debit_usd`, a
     ROLL contributes `close_credit_usd` minus `open_debit_usd`)
    minus (the window's commissions, from `broker_transactions`)
    compared against
    (the window's allow-listed net cash amounts, from `broker_transactions`)

`D5-04`'s deferred contradiction is resolved here, not upstream: the oracle
(`ledger/pairing.py`, `ledger/events.py`) is fee-free by convention --
`avgPrice x qty`, never the broker's `netAmount` -- and this module never
writes to `events` or reads a plaintext money column back out of it that
the oracle does not already produce. The commission that closes the gap
`D5-04` deliberately left as `None` on `DerivedEvent.commission_usd` comes
from the broker's own transaction payload, read here, at reconciliation
time, never persisted onto `events`. `pairing.py` is not modified by this
module at all.

## The vendor-field ceiling (`A1`, unverified)

`extract_broker_cash` reads two keys off the broker's own raw transaction
payload -- `settings.schwab_tx_net_amount_field` (default `"netAmount"`)
and `settings.schwab_tx_commission_field` (default `"commission"`). Neither
name is verified: the installed `schwab-py` 1.5.1 source names neither
anywhere, and this project's own fixtures (`tests/ingest/conftest.py`'s
`TX_PAYLOAD`) never populate them. A key that is absent or unparseable
routes the whole window to `indeterminate` (`D9-08`) -- never a wrong
number, never a guess (`NN-16`). The first live payload is what settles
both names, correcting one place.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from enum import StrEnum
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import JsonValue, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.data_keys import dek_for_version
from morai.crypto.envelope import decrypt_field
from morai.db.models import BrokerTransaction
from morai.ingest.broker_transactions import (
    _broker_transaction_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this module reverses insert_broker_transactions' own encrypt-then-store shape to read the raw payload back; it needs the exact AAD helper that function uses, the same cooperating-module convention tests/ingest/test_sync_tracer.py already uses for this identical helper.
)
from morai.ledger.events import EventRecord, read_events
from morai.settings import get_settings

# ET, never a fixed UTC offset -- Eastern is UTC-4 or UTC-5 depending on the
# date, so a constant offset is wrong roughly half the year (D9-04, mirroring
# settlements.py's own `_EASTERN`).
_EASTERN = ZoneInfo("America/New_York")

# D9-09: the allow-list `RECON-01`'s "net of transfers" carve-out
# implements. A transaction type in neither set below is not silently
# dropped and not silently summed -- it makes its window `indeterminate`.
# Read from schwab-py 1.5.1's own installed
# `client.base.Client.Transactions.TransactionType` this session -- a
# request-filter enum, not a verified response schema. A sixteenth type
# appearing in a live payload is exactly the case this allow-list exists to
# surface, not silently pass through.
CASH_TRANSACTION_TYPES: frozenset[str] = frozenset({"TRADE", "RECEIVE_AND_DELIVER"})
EXCLUDED_TRANSACTION_TYPES: frozenset[str] = frozenset(
    {
        "ACH_RECEIPT",
        "ACH_DISBURSEMENT",
        "CASH_RECEIPT",
        "CASH_DISBURSEMENT",
        "ELECTRONIC_FUND",
        "WIRE_OUT",
        "WIRE_IN",
        "JOURNAL",
        "DIVIDEND_OR_INTEREST",
        "MARGIN_CALL",
        "MONEY_MARKET",
        "SMA_ADJUSTMENT",
        "MEMORANDUM",
    }
)


class ReconciliationVerdict(StrEnum):
    """`D9-08`'s three states. `INDETERMINATE` is never collapsed into
    either terminal state -- an unanswerable check must never report
    `PASSED`, and reporting it as `FAILED` would fire on every routine gap
    (an unpriced settlement, a missing commission) and teach the reader
    that a red reconciliation means nothing."""

    PASSED = "passed"
    FAILED = "failed"
    INDETERMINATE = "indeterminate"


class IndeterminateReason(StrEnum):
    """The fixed, enumerated reasons an `INDETERMINATE` verdict can carry --
    matching migration 0016's `reconciliation_runs_reason_check` exactly.
    Every member is a fixed literal; none is ever derived from an
    exception's message or a vendor payload value (`NN-20`, `NN-34`)."""

    CASH_AMOUNT_UNAVAILABLE = "cash_amount_unavailable"
    COMMISSION_UNAVAILABLE = "commission_unavailable"
    UNRECOGNISED_TRANSACTION_TYPE = "unrecognised_transaction_type"
    SETTLEMENT_UNPRICED = "settlement_unpriced"
    EVENT_AMOUNT_UNAVAILABLE = "event_amount_unavailable"


@dataclass(frozen=True)
class BrokerCashRecord:
    """One broker transaction's cash-relevant fields, decrypted. Both money
    fields are `Decimal | None` -- an absent or unparseable vendor key is a
    gap, and a gap is `None`, never a guess (`NN-16`)."""

    activity_id: str
    transaction_type: str
    transaction_time: datetime
    net_amount_usd: Decimal | None
    commission_usd: Decimal | None


@dataclass(frozen=True)
class ReconciliationResult:
    """One window's verdict, not yet written. `reason` is non-`None` if and
    only if `verdict` is `INDETERMINATE` -- migration 0016's own `CHECK` is
    the backstop for a caller that bypasses this module."""

    trading_day: date
    window_start: datetime
    window_end: datetime
    realised_pnl_usd: Decimal | None
    commissions_usd: Decimal | None
    cash_delta_usd: Decimal | None
    signed_difference_usd: Decimal | None
    verdict: ReconciliationVerdict
    reason: IndeterminateReason | None


def trading_day_for(moment: datetime) -> date:
    """The sole membership predicate for every window in this module
    (`D9-01`): a transaction or an event belongs to a window when this
    function returns that window's own date. Nothing anywhere in this
    module compares an instant against `window_start`/`window_end` --
    that is what makes double-counting structurally impossible rather than
    a comparison a later caller could get half-open in the wrong direction
    (`L048`'s own half-open-window bug)."""
    return moment.astimezone(_EASTERN).date()


def window_bounds(trading_day: date) -> tuple[datetime, datetime]:
    """Eastern midnight on `trading_day` through Eastern midnight on the
    following day, as aware datetimes. Stored for the reader (`D9-13`) --
    never the membership predicate; see `trading_day_for` above."""
    start = datetime.combine(trading_day, time.min, tzinfo=_EASTERN)
    end = datetime.combine(trading_day + timedelta(days=1), time.min, tzinfo=_EASTERN)
    return start, end


def closed_trading_days(
    events: Sequence[EventRecord], broker_cash: Sequence[BrokerCashRecord]
) -> tuple[date, ...]:
    """`D9-02`: a window closes when a later trading day's broker
    transaction has landed -- not on a clock timeout. The candidate set is
    the union of every day observed in `events` and every day observed in
    `broker_cash`: a day with ledger activity but no same-day broker
    transaction (a SETTLEMENT/expiry with nothing exercised or assigned is
    the leading case) still needs an answer, so it must become a candidate
    window even though `broker_cash` alone never names it. Closure itself
    stays broker-driven, per `D9-02`: a day closes only once it is strictly
    earlier than the newest day observed in `broker_cash` -- the broker's
    own later activity, not an event, is the evidence a prior day is final.
    Returns every such day, sorted ascending; empty only when `broker_cash`
    has observed no day at all, since closure then has nothing to anchor
    to. A *single* observed broker day still closes every earlier
    event-only day -- that one transaction is itself the later broker
    activity `D9-02` asks for. (Before CR-01 the candidate set was
    `broker_cash` alone, so one observed day did close nothing; that is no
    longer true, and `test_an_event_only_day_becomes_a_candidate_and_closes`
    pins the difference with exactly one broker day.)

    Market holidays and weekends need no calendar: a day with no activity
    on either side never enters the candidate set, so no window ever has
    to reason about whether that day was open."""
    broker_days = {trading_day_for(record.transaction_time) for record in broker_cash}
    if not broker_days:
        return ()
    newest = max(broker_days)
    event_days = {trading_day_for(event.event_time) for event in events}
    candidate_days = broker_days | event_days
    return tuple(sorted(day for day in candidate_days if day < newest))


_DECIMAL: TypeAdapter[Decimal] = TypeAdapter(Decimal)


def _parse_decimal(raw: JsonValue | None) -> Decimal | None:
    """`None` for a missing key, an explicit JSON `null`, or a value that
    does not parse as a `Decimal` -- never `0`, never a guess (`NN-16`).
    Pydantic converts through the value's string form, the only conversion
    that keeps four decimal places intact (`D3-17`)."""
    if raw is None:
        return None
    try:
        return _DECIMAL.validate_python(raw)
    except ValidationError:
        return None


def extract_broker_cash(
    raw_payload: JsonValue,
    *,
    activity_id: str,
    transaction_type: str,
    transaction_time: datetime,
    net_amount_field: str,
    commission_field: str,
) -> BrokerCashRecord:
    """Pure: no session, no clock, never raises for any input. Reads the
    two named keys only when `raw_payload` is a mapping. `D9-06`: both
    values come out of the broker's own payload and nothing else -- a
    commission recomputed from a per-leg constant would be a fabricated
    input to the very check that exists to catch fabrication, and the
    comparison would be this project's own arithmetic against itself.

    `A1`: the two key names are assumed and unverified against a live
    Schwab payload this session -- see this module's own docstring. A
    wrong name here produces loud `INDETERMINATE` windows on the first
    live run, never a wrong number.
    """
    net_amount_usd: Decimal | None = None
    commission_usd: Decimal | None = None
    if isinstance(raw_payload, dict):
        net_amount_usd = _parse_decimal(raw_payload.get(net_amount_field))
        commission_usd = _parse_decimal(raw_payload.get(commission_field))
    return BrokerCashRecord(
        activity_id=activity_id,
        transaction_type=transaction_type,
        transaction_time=transaction_time,
        net_amount_usd=net_amount_usd,
        commission_usd=commission_usd,
    )


def _indeterminate(
    trading_day: date,
    window_start: datetime,
    window_end: datetime,
    reason: IndeterminateReason,
) -> ReconciliationResult:
    return ReconciliationResult(
        trading_day=trading_day,
        window_start=window_start,
        window_end=window_end,
        realised_pnl_usd=None,
        commissions_usd=None,
        cash_delta_usd=None,
        signed_difference_usd=None,
        verdict=ReconciliationVerdict.INDETERMINATE,
        reason=reason,
    )


def _event_contribution(event: EventRecord) -> Decimal:
    """One event's own signed contribution to the window's realised P&L --
    the one seam every event's money routes through when `reconcile_window`
    sums them (`D9-05`'s arithmetic), mirroring `pairing.py`'s own
    `_signed_leg_amount` seam exactly: an OPEN contributes minus its
    `open_debit_usd`, a CLOSE contributes its `close_credit_usd`, a ROLL
    contributes the difference. `tests/ledger/test_reconciliation.py`'s own
    seeded-fault case patches this one function to prove the comparison has
    teeth (`D9-07`, `T-09-07`), the same convention `tests/ledger/
    test_pairing_seeded_faults.py` already established for the oracle.

    Callers only reach this after `reconcile_window`'s own indeterminate-
    cause walk has already proven the needed field is not `None`, and a
    SETTLEMENT is filtered out of `window_events` before this is ever
    called on one -- the `assert`s below document that precondition
    rather than enforce a fallback a caller needs."""
    if event.event_type == "OPEN":
        assert event.open_debit_usd is not None  # checked by caller
        return -event.open_debit_usd
    if event.event_type == "CLOSE":
        assert event.close_credit_usd is not None  # checked by caller
        return event.close_credit_usd
    assert event.event_type == "ROLL"
    assert event.open_debit_usd is not None  # checked by caller
    assert event.close_credit_usd is not None  # checked by caller
    return event.close_credit_usd - event.open_debit_usd


def reconcile_window(
    events: Sequence[EventRecord],
    broker_cash: Sequence[BrokerCashRecord],
    *,
    trading_day: date,
) -> ReconciliationResult:
    """Pure: no `AsyncSession`, no clock read, mirroring
    `derive_settlements`'s own signature discipline exactly (`D9-12`) --
    the one function both the pytest suite and the ingest cycle call, so
    the two can never drift.

    Narrows both inputs to the window with `trading_day_for`, on
    `event_time` and `transaction_time` respectively, then walks the
    indeterminate causes in a fixed, documented order so a window with two
    causes always reports the same one:

    1. Any in-window transaction whose `transaction_type` is in neither
       `CASH_TRANSACTION_TYPES` nor `EXCLUDED_TRANSACTION_TYPES` --
       `UNRECOGNISED_TRANSACTION_TYPE` (`D9-09`).
    2. Any in-window allow-listed transaction whose `net_amount_usd` is
       `None` -- `CASH_AMOUNT_UNAVAILABLE`; whose `commission_usd` is
       `None` -- `COMMISSION_UNAVAILABLE` (`D9-06`).
    3. Any in-window SETTLEMENT event -- `SETTLEMENT_UNPRICED`. `D7-07`
       leaves a SETTLEMENT's money fields deliberately `None` until market
       data exists; `D9-11` makes that a known, documented gap rather than
       a ledger error, because reporting it as a failure would fire on
       every expiry and teach the reader that a red reconciliation means
       nothing.
    4. An OPEN with a `None` `open_debit_usd`, a CLOSE with a `None`
       `close_credit_usd`, or a ROLL with either `None` --
       `EVENT_AMOUNT_UNAVAILABLE`.

    Every `INDETERMINATE` result carries all four money fields as `None` --
    an unanswerable check publishes no numbers rather than partial ones.

    When no cause fires, sums each side in Python over the already-decrypted
    values (`D9-10`: the amounts exist only as ciphertext, so the database
    cannot aggregate them). The realised total is the sum, over the
    window's events, of a CLOSE's `close_credit_usd`, minus an OPEN's
    `open_debit_usd`, plus a ROLL's `close_credit_usd` minus its
    `open_debit_usd`. `signed_difference_usd` is that total, minus the sum
    of commissions, minus the sum of allow-listed net cash amounts.
    `verdict` is `PASSED` exactly when that difference equals `Decimal("0")`,
    `FAILED` otherwise, `reason` `None` in both cases -- native `Decimal`
    equality, no epsilon of any kind (`D9-07`): any tolerance loose enough
    to absorb rounding is also loose enough to absorb the one cent
    criterion 2 requires to fail.

    Never calls the absolute-value builtin on any amount, here or anywhere
    in this module: the sign is the direction, and the direction comes from
    the vendor's own signed field (`NN-9`, `NN-10`). A future reader whose
    instinct is to make `open_debit_usd` fee-inclusive must meet `D5-04`'s
    and this module's own docstring first -- the oracle's fee-free fields
    are read here and never written.
    """
    window_start, window_end = window_bounds(trading_day)
    window_events = [
        event for event in events if trading_day_for(event.event_time) == trading_day
    ]
    window_cash = [
        cash
        for cash in broker_cash
        if trading_day_for(cash.transaction_time) == trading_day
    ]

    for cash in window_cash:
        if (
            cash.transaction_type not in CASH_TRANSACTION_TYPES
            and cash.transaction_type not in EXCLUDED_TRANSACTION_TYPES
        ):
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.UNRECOGNISED_TRANSACTION_TYPE,
            )

    for cash in window_cash:
        if cash.transaction_type not in CASH_TRANSACTION_TYPES:
            continue
        if cash.net_amount_usd is None:
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.CASH_AMOUNT_UNAVAILABLE,
            )
        if cash.commission_usd is None:
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.COMMISSION_UNAVAILABLE,
            )

    for event in window_events:
        if event.event_type == "SETTLEMENT":
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.SETTLEMENT_UNPRICED,
            )

    for event in window_events:
        if event.event_type == "OPEN" and event.open_debit_usd is None:
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE,
            )
        if event.event_type == "CLOSE" and event.close_credit_usd is None:
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE,
            )
        if event.event_type == "ROLL" and (
            event.open_debit_usd is None or event.close_credit_usd is None
        ):
            return _indeterminate(
                trading_day,
                window_start,
                window_end,
                IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE,
            )

    realised_pnl_usd = Decimal("0")
    for event in window_events:
        realised_pnl_usd += _event_contribution(event)

    commissions_usd = Decimal("0")
    cash_delta_usd = Decimal("0")
    for cash in window_cash:
        if cash.transaction_type not in CASH_TRANSACTION_TYPES:
            continue
        assert cash.net_amount_usd is not None  # checked above
        assert cash.commission_usd is not None  # checked above
        cash_delta_usd += cash.net_amount_usd
        commissions_usd += cash.commission_usd

    signed_difference_usd = realised_pnl_usd - commissions_usd - cash_delta_usd
    verdict = (
        ReconciliationVerdict.PASSED
        if signed_difference_usd == Decimal("0")
        else ReconciliationVerdict.FAILED
    )

    return ReconciliationResult(
        trading_day=trading_day,
        window_start=window_start,
        window_end=window_end,
        realised_pnl_usd=realised_pnl_usd,
        commissions_usd=commissions_usd,
        cash_delta_usd=cash_delta_usd,
        signed_difference_usd=signed_difference_usd,
        verdict=verdict,
        reason=None,
    )


_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


async def read_broker_cash_records(
    session: AsyncSession, user_id: UUID
) -> tuple[BrokerCashRecord, ...]:
    """The shell half's read side. Selects every `BrokerTransaction` row
    for the user -- RLS is the filter, the same convention `read_events`/
    `read_sync_runs` already state. Caches a DEK per `key_version` through
    `dek_for_version` (`morai.crypto.data_keys`), never a sixth copy of
    that module's own promoted query. Decrypts `raw_ciphertext` under the
    AAD `insert_broker_transactions` used to write it, reversing that
    function's own encrypt-then-store shape. Calls `extract_broker_cash`
    with the two field names read from `get_settings()`. Sorted by
    `transaction_time` then `activity_id` so two runs are comparable
    element-wise.
    """
    settings = get_settings()
    rows = (
        await session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).scalars()

    dek_cache: dict[int, bytes] = {}
    records: list[BrokerCashRecord] = []
    for row in rows:
        if row.key_version not in dek_cache:
            dek_cache[row.key_version] = await dek_for_version(
                session, user_id, row.key_version
            )
        dek = dek_cache[row.key_version]
        raw_payload = _JSON_VALUE.validate_json(
            decrypt_field(
                row.raw_ciphertext,
                row.raw_nonce,
                dek,
                _broker_transaction_associated_data(
                    "raw_ciphertext", user_id=user_id, activity_id=row.activity_id
                ),
            )
        )
        records.append(
            extract_broker_cash(
                raw_payload,
                activity_id=row.activity_id,
                transaction_type=row.transaction_type,
                transaction_time=row.transaction_time,
                net_amount_field=settings.schwab_tx_net_amount_field,
                commission_field=settings.schwab_tx_commission_field,
            )
        )

    records.sort(key=lambda record: (record.transaction_time, record.activity_id))
    return tuple(records)


async def run_reconciliation(
    session: AsyncSession, user_id: UUID, *, as_of: datetime
) -> tuple[ReconciliationResult, ...]:
    """The thin shell `sync_user` calls, immediately after `sync_events`
    and before its own `return` (the exact CR-01 seam this plan closes,
    Phase 7's own lesson: reconciliation built and unit-tested but
    unreachable because `sync_user` never called it).

    Reads both sides, then for each closed trading day (`closed_trading_days`)
    calls `reconcile_window` and compares the result against
    `read_latest_run_for_trading_day`. Writes nothing when a prior row
    exists and matches on `realised_pnl_usd`, `commissions_usd`,
    `cash_delta_usd`, `verdict` and `reason` -- an unchanged closed window
    is not re-litigated every cycle. Writes a fresh row with
    `is_reopening=False` when no prior row exists, and a fresh row with
    `is_reopening=True` when a prior row exists and any of those five
    differ (`D9-03`): a closed window whose inputs later changed means the
    broker restated, and that is a finding, not noise.

    Passes `as_of` straight through as `checked_at`; never reads the clock
    itself. Opens no second session and commits nothing -- `D7-12`'s
    convention, restated verbatim in `sync_user`'s own docstring, applies
    identically here. Returns the results actually persisted.
    """
    # Local import: `ingest/reconciliation_runs.py` imports
    # `ReconciliationResult`/`ReconciliationVerdict`/`IndeterminateReason`
    # from this module, so a module-level import here would be circular.
    # Same precedent as `ledger/pairing.py::sync_events`'s own local import
    # of `ledger/settlements.py`.
    from morai.ingest.reconciliation_runs import (
        record_reconciliation_run,
        read_latest_run_for_trading_day,
    )

    events = await read_events(session, user_id)
    broker_cash = await read_broker_cash_records(session, user_id)

    results: list[ReconciliationResult] = []
    for trading_day in closed_trading_days(events, broker_cash):
        result = reconcile_window(events, broker_cash, trading_day=trading_day)
        prior = await read_latest_run_for_trading_day(session, user_id, trading_day)
        if prior is not None and (
            prior.realised_pnl_usd,
            prior.commissions_usd,
            prior.cash_delta_usd,
            prior.verdict,
            prior.reason,
        ) == (
            result.realised_pnl_usd,
            result.commissions_usd,
            result.cash_delta_usd,
            result.verdict,
            result.reason,
        ):
            continue
        await record_reconciliation_run(
            session,
            user_id,
            result=result,
            checked_at=as_of,
            is_reopening=prior is not None,
        )
        results.append(result)

    return tuple(results)
