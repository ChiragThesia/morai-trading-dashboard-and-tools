"""Phase 9 Plan 2: proves the invariant is worth reading (`RECON-01`,
`RECON-03`, `D9-01`..`D9-13`). Exercises all three `ReconciliationVerdict`
members and every `IndeterminateReason`: `cash_amount_unavailable`,
`commission_unavailable`, `unrecognised_transaction_type`,
`settlement_unpriced`, `event_amount_unavailable`.

Carries this phase's own anti-vacuous-pass control (`D9-07`, `T-09-07`): a
seeded one-cent discrepancy that must fail, a four-point sweep no epsilon
can satisfy, and a seeded fault in the comparison seam that must make the
passing case fail -- `tests/ledger/test_pairing_seeded_faults.py`'s own
convention, applied here.

Tasks 1 and 2's cases carry no `pytest.mark.db` -- `reconcile_window`
takes no session and reads no clock, so every one is a pure unit run,
mirroring `tests/ledger/test_pairing_pure.py`'s own no-marker convention.
Task 3 adds the file's only db-marked cases (Tests 8/9), following
`tests/ledger/test_oracle_gate.py`'s own marker-mixing convention rather
than promoting the whole module to a db file.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.ledger.reconciliation as reconciliation
from morai.db.models import ReconciliationRun
from morai.ingest.broker_transactions import (
    BrokerTransactionWrite,
    insert_broker_transactions,
)
from morai.ledger.events import EventRecord
from morai.ledger.reconciliation import (
    CASH_TRANSACTION_TYPES,
    EXCLUDED_TRANSACTION_TYPES,
    BrokerCashRecord,
    IndeterminateReason,
    ReconciliationVerdict,
    closed_trading_days,
    reconcile_window,
    run_reconciliation,
    trading_day_for,
    window_bounds,
)
from morai.ledger.reconciliation import (
    _event_contribution as _real_event_contribution,  # pyright: ignore[reportPrivateUsage]  # why: the seam this suite patches to prove `reconcile_window`'s own comparison has teeth (`tests/ledger/test_pairing_seeded_faults.py`'s own convention) -- capturing the real function before it is monkeypatched is what lets the faulted variant differ from the truth by exactly one named defect.
)
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import clean_ingest_tables, clean_reconciliation_tables

# Re-exported, not merely imported -- `tests/ingest/` is not an ancestor
# conftest of `tests/ledger/`, so pytest cannot resolve
# `clean_reconciliation_tables`'s own internal request for
# `clean_ingest_tables` without both being visible in this module's
# namespace. Same convention `tests/ingest/test_reconciliation_schema.py`
# already establishes for fixtures crossing that same boundary.
__all__ = ["clean_ingest_tables", "clean_reconciliation_tables"]

_USER_ID = UUID("00000000-0000-4000-8000-000000000009")
_POSITION_ID = UUID("00000000-0000-4000-8000-000000000010")
_TRADING_DAY = date(2026, 6, 18)
_MOMENT = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)

# schwab-py 1.5.1's own installed `client/base.py::Client.Transactions.
# TransactionType`, lines 343-359 -- transcribed as a literal so a
# sixteenth vendor type is caught by this test, not silently absorbed.
_SCHWAB_TRANSACTION_TYPES = frozenset(
    {
        "TRADE",
        "RECEIVE_AND_DELIVER",
        "DIVIDEND_OR_INTEREST",
        "ACH_RECEIPT",
        "ACH_DISBURSEMENT",
        "CASH_RECEIPT",
        "CASH_DISBURSEMENT",
        "ELECTRONIC_FUND",
        "WIRE_OUT",
        "WIRE_IN",
        "JOURNAL",
        "MEMORANDUM",
        "MARGIN_CALL",
        "MONEY_MARKET",
        "SMA_ADJUSTMENT",
    }
)


async def _async_set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- Postgres's
    own grammar only accepts a literal there. Mirrors `tests/test_isolation.py::
    _set_current_user` and `tests/ingest/test_sync_tracer.py::_set_current_user`
    exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


def _event(
    *,
    event_type: str = "OPEN",
    event_time: datetime = _MOMENT,
    open_debit_usd: Decimal | None = None,
    close_credit_usd: Decimal | None = None,
    rolled_from_position_id: UUID | None = None,
    position_id: UUID = _POSITION_ID,
) -> EventRecord:
    """One `EventRecord`, hand-built with sensible defaults and keyword
    overrides -- every case states only what it is about."""
    return EventRecord(
        id=uuid4(),
        user_id=_USER_ID,
        position_id=position_id,
        event_type=event_type,
        event_time=event_time,
        fill_ids_hash=None,
        open_debit_usd=open_debit_usd,
        close_credit_usd=close_credit_usd,
        key_version=1,
        rolled_from_position_id=rolled_from_position_id,
    )


def _cash(
    *,
    activity_id: str = "tx-1",
    transaction_type: str = "TRADE",
    transaction_time: datetime = _MOMENT,
    net_amount_usd: Decimal | None = Decimal("0"),
    commission_usd: Decimal | None = Decimal("0"),
) -> BrokerCashRecord:
    """One `BrokerCashRecord`, hand-built with sensible defaults and
    keyword overrides -- every case states only what it is about."""
    return BrokerCashRecord(
        activity_id=activity_id,
        transaction_type=transaction_type,
        transaction_time=transaction_time,
        net_amount_usd=net_amount_usd,
        commission_usd=commission_usd,
    )


def _balanced_fixture() -> tuple[list[EventRecord], list[BrokerCashRecord]]:
    """One OPEN, one CLOSE, two allow-listed TRADE broker transactions,
    balancing to the cent by construction (Task 1, `RECON-01` criterion
    1). The derivation, so a later reader can check it by eye:

        opening debit   4485.67   (event, cash out; OPEN's own convention)
        closing credit  3012.33   (event, cash in; CLOSE's own convention)
        realised P&L  = -4485.67 + 3012.33          = -1473.34

        commission (open)   0.65
        commission (close)  0.65
        commissions_usd    =  0.65 +  0.65           =     1.30

        broker net (open)  -4486.32  (= -(4485.67 + 0.65), fee-inclusive)
        broker net (close)  3011.68  (=   3012.33 -  0.65, fee-inclusive)
        cash_delta_usd     = -4486.32 + 3011.68       = -1474.64

        signed_difference_usd = realised_pnl_usd - commissions_usd - cash_delta_usd
                               =  -1473.34   -   1.30   -   (-1474.64)  =  0.00
    """
    events = [
        _event(event_type="OPEN", open_debit_usd=Decimal("4485.67")),
        _event(event_type="CLOSE", close_credit_usd=Decimal("3012.33")),
    ]
    broker_cash = [
        _cash(
            activity_id="tx-open",
            net_amount_usd=Decimal("-4486.32"),
            commission_usd=Decimal("0.65"),
        ),
        _cash(
            activity_id="tx-close",
            net_amount_usd=Decimal("3011.68"),
            commission_usd=Decimal("0.65"),
        ),
    ]
    return events, broker_cash


def _sign_flipped_event_contribution(event: EventRecord) -> Decimal:
    """Negates the real per-event contribution -- `LEDGER-01`'s own
    historical failure mode (direction lost, `NN-9`/`NN-10`), the same
    class `tests/ledger/test_pairing_seeded_faults.py`'s own
    `_sign_flipped` proves against the oracle, applied here to the one
    seam every event's money routes through inside `reconcile_window`."""
    return -_real_event_contribution(event)


# =====================================================================
# Task 1: the invariant holds to the cent, and one cent breaks it
# =====================================================================


def test_a_window_that_agrees_to_the_cent_passes() -> None:
    events, broker_cash = _balanced_fixture()
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.PASSED
    assert result.signed_difference_usd == Decimal("0")
    assert result.reason is None


def test_a_seeded_one_cent_discrepancy_fails() -> None:
    """Criterion 2's own named case and this phase's anti-vacuous-pass
    control: the broker's net amount on the closing transaction, moved by
    exactly one cent, must fail -- not merely become non-zero."""
    events, broker_cash = _balanced_fixture()
    assert broker_cash[1].net_amount_usd is not None
    broker_cash[1] = _cash(
        activity_id="tx-close",
        net_amount_usd=broker_cash[1].net_amount_usd - Decimal("0.01"),
        commission_usd=broker_cash[1].commission_usd,
    )
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.FAILED
    assert result.signed_difference_usd == Decimal("0.01")


@pytest.mark.parametrize(
    "seeded_difference",
    [Decimal("0"), Decimal("0.01"), Decimal("-0.01"), Decimal("1000.00")],
    ids=["zero", "plus-one-cent", "minus-one-cent", "plus-one-thousand"],
)
def test_verdict_across_a_discrepancy_sweep(seeded_difference: Decimal) -> None:
    """The structural proof that no tolerance sits in the comparison: a
    tolerance loose enough to pass the one-cent case would fail the zero
    case's own exactness assertion, and no single constant satisfies all
    four differences at once."""
    events, broker_cash = _balanced_fixture()
    assert broker_cash[1].net_amount_usd is not None
    broker_cash[1] = _cash(
        activity_id="tx-close",
        net_amount_usd=broker_cash[1].net_amount_usd - seeded_difference,
        commission_usd=broker_cash[1].commission_usd,
    )
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.signed_difference_usd == seeded_difference
    expected_verdict = (
        ReconciliationVerdict.PASSED
        if seeded_difference == Decimal("0")
        else ReconciliationVerdict.FAILED
    )
    assert result.verdict is expected_verdict


def test_a_seeded_fault_in_the_comparison_makes_the_passing_case_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`D9-07`'s anti-vacuous-pass control, `tests/ledger/
    test_pairing_seeded_faults.py`'s own convention applied to this
    module's `_event_contribution` seam -- the one function every event's
    money routes through. Proves the comparison is sensitive to a real
    corruption; it does NOT prove the corruption cannot occur in
    production -- a different claim, `tests/gate/`'s own. This is a
    shipped test, not scaffolding: it stays in the suite and runs on
    every gate."""
    events, broker_cash = _balanced_fixture()
    monkeypatch.setattr(
        reconciliation, "_event_contribution", _sign_flipped_event_contribution
    )
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is not ReconciliationVerdict.PASSED


def test_failure_names_the_window_and_both_sides() -> None:
    events, broker_cash = _balanced_fixture()
    assert broker_cash[1].net_amount_usd is not None
    broker_cash[1] = _cash(
        activity_id="tx-close",
        net_amount_usd=broker_cash[1].net_amount_usd - Decimal("0.01"),
        commission_usd=broker_cash[1].commission_usd,
    )
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.FAILED
    assert result.trading_day == _TRADING_DAY
    assert (result.window_start, result.window_end) == window_bounds(_TRADING_DAY)
    assert result.realised_pnl_usd is not None
    assert result.commissions_usd is not None
    assert result.cash_delta_usd is not None
    assert result.signed_difference_usd is not None


def test_four_decimal_amounts_survive_the_arithmetic() -> None:
    """Amounts at `NUMERIC(14, 4)`'s own scale -- this test's claim is
    about the arithmetic only; `tests/test_decimal_canary.py` and
    `tests/test_money_roundtrip.py` already prove the encrypted round trip
    and are cited here rather than re-proven."""
    events = [
        _event(event_type="OPEN", open_debit_usd=Decimal("4485.6712")),
        _event(event_type="CLOSE", close_credit_usd=Decimal("3012.3388")),
    ]
    broker_cash = [
        _cash(
            activity_id="tx-open",
            net_amount_usd=Decimal("-4486.3224"),
            commission_usd=Decimal("0.6512"),
        ),
        _cash(
            activity_id="tx-close",
            net_amount_usd=Decimal("3011.6876"),
            commission_usd=Decimal("0.6512"),
        ),
    ]
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.PASSED
    assert result.signed_difference_usd == Decimal("0")

    broker_cash[1] = _cash(
        activity_id="tx-close",
        net_amount_usd=Decimal("3011.6876") - Decimal("0.0001"),
        commission_usd=Decimal("0.6512"),
    )
    result_off_by_a_tenth_of_a_cent = reconcile_window(
        events, broker_cash, trading_day=_TRADING_DAY
    )
    assert result_off_by_a_tenth_of_a_cent.verdict is ReconciliationVerdict.FAILED
    assert result_off_by_a_tenth_of_a_cent.signed_difference_usd == Decimal("0.0001")


def test_roll_event_contributes_close_minus_open() -> None:
    events = [
        _event(
            event_type="ROLL",
            open_debit_usd=Decimal("1000.00"),
            close_credit_usd=Decimal("1200.00"),
            rolled_from_position_id=uuid4(),
        ),
    ]
    broker_cash = [
        _cash(
            activity_id="tx-roll",
            net_amount_usd=Decimal("199.50"),
            commission_usd=Decimal("0.50"),
        ),
    ]
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.PASSED
    assert result.realised_pnl_usd == Decimal("200.00")


# =====================================================================
# Task 2: all three verdicts, and every cause of the third
# =====================================================================


def test_indeterminate_on_an_unrecognised_transaction_type() -> None:
    broker_cash = [_cash(transaction_type="TAX_WITHHOLDING")]
    result = reconcile_window([], broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.UNRECOGNISED_TRANSACTION_TYPE


def test_indeterminate_on_a_missing_commission() -> None:
    broker_cash = [
        _cash(
            transaction_type="TRADE",
            net_amount_usd=Decimal("10.00"),
            commission_usd=None,
        )
    ]
    result = reconcile_window([], broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.COMMISSION_UNAVAILABLE


def test_indeterminate_on_a_missing_cash_amount() -> None:
    broker_cash = [
        _cash(
            transaction_type="TRADE",
            net_amount_usd=None,
            commission_usd=Decimal("0.50"),
        )
    ]
    result = reconcile_window([], broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.CASH_AMOUNT_UNAVAILABLE


def test_indeterminate_on_an_unpriced_settlement() -> None:
    """`D9-11`: a SETTLEMENT's money fields are null by `D7-07`'s own
    deliberate decision -- pricing them needs Phase 8's captured market
    data applied to expiries, out of this phase's scope. Reporting this as
    `FAILED` would fire on every expiry; this is the case most likely to
    be 'fixed' wrongly by a later reader."""
    events = [
        _event(event_type="SETTLEMENT", open_debit_usd=None, close_credit_usd=None)
    ]
    result = reconcile_window(events, [], trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.SETTLEMENT_UNPRICED


def test_indeterminate_when_an_open_is_missing_its_debit() -> None:
    events = [_event(event_type="OPEN", open_debit_usd=None)]
    result = reconcile_window(events, [], trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE


def test_indeterminate_when_a_close_is_missing_its_credit() -> None:
    events = [_event(event_type="CLOSE", close_credit_usd=None)]
    result = reconcile_window(events, [], trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE


def test_indeterminate_when_a_roll_is_missing_its_open_amount() -> None:
    events = [
        _event(
            event_type="ROLL",
            open_debit_usd=None,
            close_credit_usd=Decimal("1.00"),
            rolled_from_position_id=uuid4(),
        )
    ]
    result = reconcile_window(events, [], trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE


def test_indeterminate_when_a_roll_is_missing_its_close_amount() -> None:
    events = [
        _event(
            event_type="ROLL",
            open_debit_usd=Decimal("1.00"),
            close_credit_usd=None,
            rolled_from_position_id=uuid4(),
        )
    ]
    result = reconcile_window(events, [], trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.EVENT_AMOUNT_UNAVAILABLE


def test_indeterminate_publishes_no_numbers() -> None:
    """An unanswerable check publishes no numbers, not partial ones --
    every `INDETERMINATE` result carries all four money fields as
    `None`, across every one of the five causes."""
    results = [
        reconcile_window(
            [], [_cash(transaction_type="TAX_WITHHOLDING")], trading_day=_TRADING_DAY
        ),
        reconcile_window(
            [],
            [_cash(transaction_type="TRADE", commission_usd=None)],
            trading_day=_TRADING_DAY,
        ),
        reconcile_window(
            [
                _event(
                    event_type="SETTLEMENT", open_debit_usd=None, close_credit_usd=None
                )
            ],
            [],
            trading_day=_TRADING_DAY,
        ),
        reconcile_window(
            [_event(event_type="OPEN", open_debit_usd=None)],
            [],
            trading_day=_TRADING_DAY,
        ),
    ]
    for result in results:
        assert result.verdict is ReconciliationVerdict.INDETERMINATE
        assert result.realised_pnl_usd is None
        assert result.commissions_usd is None
        assert result.cash_delta_usd is None
        assert result.signed_difference_usd is None


def test_an_excluded_transfer_type_is_not_counted_and_is_not_indeterminate() -> None:
    """`RECON-01`'s "net of transfers" carve-out is exclusion, not
    indeterminacy: a real vendor transfer type (`WIRE_IN`) alongside a
    balanced pair of TRADEs is `PASSED`, and the transfer's own amount --
    with no commission at all -- never enters `cash_delta_usd`."""
    events = [
        _event(event_type="OPEN", open_debit_usd=Decimal("100.00")),
        _event(event_type="CLOSE", close_credit_usd=Decimal("100.00")),
    ]
    broker_cash = [
        _cash(
            activity_id="tx-open",
            net_amount_usd=Decimal("-100.00"),
            commission_usd=Decimal("0"),
        ),
        _cash(
            activity_id="tx-close",
            net_amount_usd=Decimal("100.00"),
            commission_usd=Decimal("0"),
        ),
        _cash(
            activity_id="tx-wire",
            transaction_type="WIRE_IN",
            net_amount_usd=Decimal("500.00"),
            commission_usd=None,
        ),
    ]
    result = reconcile_window(events, broker_cash, trading_day=_TRADING_DAY)
    assert result.verdict is ReconciliationVerdict.PASSED
    assert result.cash_delta_usd == Decimal("0")


def test_transaction_type_sets_cover_the_vendor_enum_exactly() -> None:
    """`schwab-py` 1.5.1's own installed `client/base.py::Client.
    Transactions.TransactionType`, lines 343-359 (`D9-09`) -- fifteen
    members, transcribed as a literal above so a sixteenth type in a live
    payload is caught here, not silently absorbed by neither set."""
    assert not (CASH_TRANSACTION_TYPES & EXCLUDED_TRANSACTION_TYPES)
    assert (
        CASH_TRANSACTION_TYPES | EXCLUDED_TRANSACTION_TYPES
    ) == _SCHWAB_TRANSACTION_TYPES


def test_indeterminate_reason_is_stable_when_two_causes_are_present() -> None:
    """The unrecognised-type check runs first in `reconcile_window`'s own
    documented order, so a window carrying both an unrecognised type and a
    missing commission always reports the earlier cause -- called twice to
    prove the answer is stable, not merely plausible once."""
    broker_cash = [
        _cash(activity_id="tx-unknown", transaction_type="TAX_WITHHOLDING"),
        _cash(activity_id="tx-nocomm", transaction_type="TRADE", commission_usd=None),
    ]
    first = reconcile_window([], broker_cash, trading_day=_TRADING_DAY)
    second = reconcile_window([], broker_cash, trading_day=_TRADING_DAY)
    assert first.reason is IndeterminateReason.UNRECOGNISED_TRANSACTION_TYPE
    assert second.reason is IndeterminateReason.UNRECOGNISED_TRANSACTION_TYPE


# =====================================================================
# Task 3: the window at its edges -- midnight, adjacency, emptiness,
# and a reopening
# =====================================================================


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        pytest.param(
            datetime(2026, 7, 15, 3, 59, 59, 999999, tzinfo=UTC),
            date(2026, 7, 14),
            id="july-one-microsecond-before-midnight",
        ),
        pytest.param(
            datetime(2026, 7, 15, 4, 0, 0, tzinfo=UTC),
            date(2026, 7, 15),
            id="july-at-midnight",
        ),
        pytest.param(
            datetime(2026, 1, 15, 4, 59, 59, 999999, tzinfo=UTC),
            date(2026, 1, 14),
            id="january-one-microsecond-before-midnight",
        ),
        pytest.param(
            datetime(2026, 1, 15, 5, 0, 0, tzinfo=UTC),
            date(2026, 1, 15),
            id="january-at-midnight",
        ),
    ],
)
def test_eastern_midnight_belongs_to_exactly_one_window(
    moment: datetime, expected: date
) -> None:
    """`trading_day_for` is the sole membership predicate in the whole
    module (`D9-01`) -- nothing anywhere compares an instant against
    `window_start`/`window_end`, which is what makes a half-open boundary
    structurally impossible rather than a comparison a later caller could
    get backwards (`L048`'s own half-open-window bug). July sits inside
    daylight saving (Eastern UTC-4), January outside it (UTC-5), so a
    fixed offset could not satisfy both pairs at once."""
    assert trading_day_for(moment) == expected


def test_adjacent_windows_share_no_instant() -> None:
    """Positive disjointness: the intersection of the two windows' own
    counted items is empty and their union is the full set -- an
    assertion that merely checks each window's own count would still pass
    even if one item were counted in both."""
    day1 = date(2026, 6, 18)
    day2 = date(2026, 6, 19)
    events = [
        _event(event_type="OPEN", event_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC)),
        _event(event_type="CLOSE", event_time=datetime(2026, 6, 18, 20, 0, tzinfo=UTC)),
        _event(event_type="OPEN", event_time=datetime(2026, 6, 19, 14, 30, tzinfo=UTC)),
        _event(event_type="CLOSE", event_time=datetime(2026, 6, 19, 20, 0, tzinfo=UTC)),
    ]
    day1_ids = {e.id for e in events if trading_day_for(e.event_time) == day1}
    day2_ids = {e.id for e in events if trading_day_for(e.event_time) == day2}
    assert day1_ids & day2_ids == set()
    assert day1_ids | day2_ids == {e.id for e in events}


def test_a_single_observed_day_closes_nothing() -> None:
    broker_cash = [_cash(transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC))]
    assert closed_trading_days([], broker_cash) == ()


def test_closed_days_are_every_day_before_the_newest() -> None:
    broker_cash = [
        _cash(
            activity_id="a", transaction_time=datetime(2026, 6, 16, 14, 30, tzinfo=UTC)
        ),
        _cash(
            activity_id="b", transaction_time=datetime(2026, 6, 17, 14, 30, tzinfo=UTC)
        ),
        _cash(
            activity_id="c", transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
        ),
    ]
    assert closed_trading_days([], broker_cash) == (
        date(2026, 6, 16),
        date(2026, 6, 17),
    )


def test_closure_does_not_depend_on_arrival_order() -> None:
    """Closure depends on the observed set, not on arrival order (Test 5,
    the ordering probe row)."""
    ordered = [
        _cash(
            activity_id="a", transaction_time=datetime(2026, 6, 16, 14, 30, tzinfo=UTC)
        ),
        _cash(
            activity_id="b", transaction_time=datetime(2026, 6, 17, 14, 30, tzinfo=UTC)
        ),
        _cash(
            activity_id="c", transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
        ),
    ]
    out_of_order = [ordered[2], ordered[0], ordered[1]]
    assert closed_trading_days([], ordered) == closed_trading_days([], out_of_order)


def test_a_day_with_no_activity_is_never_a_candidate_window() -> None:
    """A day with no broker activity and no ledger event never enters the
    candidate set, so no window ever has to reason about whether that day
    was a market holiday -- the argument for adding no calendar
    dependency."""
    broker_cash = [
        _cash(
            activity_id="a", transaction_time=datetime(2026, 6, 16, 14, 30, tzinfo=UTC)
        ),
        _cash(
            activity_id="b", transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
        ),
    ]
    closed = closed_trading_days([], broker_cash)
    assert date(2026, 6, 17) not in closed
    assert closed == (date(2026, 6, 16),)


def test_an_event_only_day_becomes_a_candidate_and_closes() -> None:
    """CR-01 regression: a trading day whose only activity is a ledger
    `Event` -- the leading case being a SETTLEMENT on an option's expiry,
    with no same-day broker-cash transaction at all -- must still become a
    candidate window once a later day's broker transaction closes it. Before
    this fix, `closed_trading_days` derived its candidate set from
    `broker_cash` alone, so June 18 (event-only) was never a candidate even
    though June 30's broker activity is later -- this test proves it now is.
    Closure itself stays broker-driven per `D9-02`: it is the broker's later
    transaction on June 30 that closes June 18, not the event itself."""
    events = [
        _event(
            event_type="SETTLEMENT",
            event_time=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
            open_debit_usd=None,
            close_credit_usd=None,
        )
    ]
    broker_cash = [
        _cash(
            activity_id="tx-close",
            transaction_time=datetime(2026, 6, 30, 14, 30, tzinfo=UTC),
        )
    ]
    closed = closed_trading_days(events, broker_cash)
    assert date(2026, 6, 18) in closed

    result = reconcile_window(events, broker_cash, trading_day=date(2026, 6, 18))
    assert result.verdict is ReconciliationVerdict.INDETERMINATE
    assert result.reason is IndeterminateReason.SETTLEMENT_UNPRICED


@pytest.mark.parametrize(
    "trading_day",
    [date(2026, 7, 15), date(2026, 1, 15), date(2026, 3, 8), date(2026, 11, 1)],
    ids=["july", "january", "spring-forward", "fall-back"],
)
def test_window_bounds_spans_eastern_midnight_to_midnight(trading_day: date) -> None:
    start, end = window_bounds(trading_day)
    assert start.time() == time.min
    assert end.time() == time.min
    assert end > start


@pytest.mark.db
async def test_an_unchanged_closed_window_writes_no_second_row(
    clean_reconciliation_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """`D9-03`'s no-op half. Seeds through `insert_broker_transactions` --
    the real write path (`D3-14`) -- never a direct table insert."""
    user_id = provisioned_users.user_a
    await _async_set_current_user(app_db_session, user_id)
    await insert_broker_transactions(
        app_db_session,
        user_id,
        [
            BrokerTransactionWrite(
                activity_id="tx-a",
                transaction_type="TRADE",
                transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC),
                order_id=None,
                raw_payload={"netAmount": "0.00", "commission": "0.00"},
            ),
            BrokerTransactionWrite(
                activity_id="tx-marker",
                transaction_type="JOURNAL",
                transaction_time=datetime(2026, 6, 19, 14, 30, tzinfo=UTC),
                order_id=None,
                raw_payload={},
            ),
        ],
    )
    await app_db_session.commit()

    await _async_set_current_user(app_db_session, user_id)
    as_of = datetime(2026, 6, 20, tzinfo=UTC)
    first_results = await run_reconciliation(app_db_session, user_id, as_of=as_of)
    await app_db_session.commit()
    assert len(first_results) == 1
    assert first_results[0].verdict is ReconciliationVerdict.PASSED

    await _async_set_current_user(app_db_session, user_id)
    second_results = await run_reconciliation(app_db_session, user_id, as_of=as_of)
    await app_db_session.commit()
    assert second_results == ()

    await _async_set_current_user(app_db_session, user_id)
    rows = (
        (
            await app_db_session.execute(
                select(ReconciliationRun).where(
                    ReconciliationRun.user_id == user_id,
                    ReconciliationRun.trading_day == date(2026, 6, 18),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1


@pytest.mark.db
async def test_late_data_writes_a_new_row_marked_as_a_reopening(
    clean_reconciliation_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """`D9-03`'s reopening half: a late broker transaction landing in an
    already-closed window makes the next `run_reconciliation` call write a
    new row marked `is_reopening=True`, leaving the earlier row's own
    values untouched -- a restatement is a finding, not an edit."""
    user_id = provisioned_users.user_a
    await _async_set_current_user(app_db_session, user_id)
    await insert_broker_transactions(
        app_db_session,
        user_id,
        [
            BrokerTransactionWrite(
                activity_id="tx-a",
                transaction_type="TRADE",
                transaction_time=datetime(2026, 6, 18, 14, 30, tzinfo=UTC),
                order_id=None,
                raw_payload={"netAmount": "0.00", "commission": "0.00"},
            ),
            BrokerTransactionWrite(
                activity_id="tx-marker",
                transaction_type="JOURNAL",
                transaction_time=datetime(2026, 6, 19, 14, 30, tzinfo=UTC),
                order_id=None,
                raw_payload={},
            ),
        ],
    )
    await app_db_session.commit()

    await _async_set_current_user(app_db_session, user_id)
    first_results = await run_reconciliation(
        app_db_session, user_id, as_of=datetime(2026, 6, 20, tzinfo=UTC)
    )
    await app_db_session.commit()
    assert len(first_results) == 1
    assert first_results[0].verdict is ReconciliationVerdict.PASSED

    await _async_set_current_user(app_db_session, user_id)
    await insert_broker_transactions(
        app_db_session,
        user_id,
        [
            BrokerTransactionWrite(
                activity_id="tx-late",
                transaction_type="TRADE",
                transaction_time=datetime(2026, 6, 18, 15, 0, tzinfo=UTC),
                order_id=None,
                raw_payload={"netAmount": "50.00", "commission": "0.00"},
            ),
        ],
    )
    await app_db_session.commit()

    await _async_set_current_user(app_db_session, user_id)
    second_results = await run_reconciliation(
        app_db_session, user_id, as_of=datetime(2026, 6, 21, tzinfo=UTC)
    )
    await app_db_session.commit()
    assert len(second_results) == 1
    assert second_results[0].verdict is ReconciliationVerdict.FAILED

    await _async_set_current_user(app_db_session, user_id)
    rows = (
        (
            await app_db_session.execute(
                select(ReconciliationRun)
                .where(
                    ReconciliationRun.user_id == user_id,
                    ReconciliationRun.trading_day == date(2026, 6, 18),
                )
                .order_by(ReconciliationRun.checked_at)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2
    original, reopened = rows
    assert original.is_reopening is False
    assert original.verdict == ReconciliationVerdict.PASSED.value
    assert original.cash_delta_usd == Decimal("0.00")
    assert reopened.is_reopening is True
    assert reopened.verdict == ReconciliationVerdict.FAILED.value
