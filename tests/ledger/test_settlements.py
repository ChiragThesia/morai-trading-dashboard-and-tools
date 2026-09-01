"""07-03-PLAN.md Task 2: per-leg settlement style, DST-correct settlement
instants, and the pure `derive_settlements` derivation.

Every fixture in this file is synthetic (D7-13) -- no independent oracle
exists for SETTLEMENT, and the position ids below (`...0000f1`, `...0000f2`)
are deliberately outside the 13 real oracle calendar ids in
`tests/ledger/oracle_seed.py` so a synthetic fixture can never be confused
with a real one.

All tests below are pure -- they build `LegRecord`/`EventRecord` values
directly and call `settlement_instant`/`derive_settlements`, no database,
no `pytest.mark.db` -- mirroring `tests/ledger/test_pairing_pure.py`'s and
`tests/ledger/test_position_creation.py`'s own no-marker convention for
pure derivation tests. Task 3 extends this file with `db`-marked tests
proving the fold into `sync_events`.
"""

from __future__ import annotations

import inspect
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from morai.ledger.events import EventRecord
from morai.ledger.settlements import (
    AM_SETTLEMENT_TIME,
    PM_SETTLEMENT_TIME,
    DerivedSettlement,
    LegRecord,
    derive_settlements,
    settlement_instant,
)

# Synthetic position ids -- deliberately outside the 13 real oracle
# calendar ids (D7-13).
_POSITION_A = UUID("00000000-0000-4000-8000-0000000000f1")
_POSITION_B = UUID("00000000-0000-4000-8000-0000000000f2")


def _leg(
    *, position_id: UUID = _POSITION_A, root: str, expiry: date, leg_role: str = "front"
) -> LegRecord:
    """A synthetic leg. `occ_symbol` is built from `root`/`expiry` in the
    same OCC shape `parse_occ_symbol` (`ledger/pairing.py`) inverts:
    root, six digits of `YYMMDD`, a strike-put letter, eight digits of
    strike in thousandths."""
    occ_symbol = f"{root}{expiry:%y%m%d}P07275000"
    return LegRecord(
        id=uuid4(),
        position_id=position_id,
        leg_role=leg_role,
        occ_symbol=occ_symbol,
        root=root,
    )


def _settlement_event_record(*, position_id: UUID, event_time: datetime) -> EventRecord:
    """A synthetic already-stored SETTLEMENT row, for the idempotency
    test below -- every field but `position_id`/`event_time` is a
    placeholder since `derive_settlements` only inspects those two plus
    `event_type`."""
    return EventRecord(
        id=uuid4(),
        user_id=uuid4(),
        position_id=position_id,
        event_type="SETTLEMENT",
        event_time=event_time,
        fill_ids_hash=None,
        open_debit_usd=None,
        close_credit_usd=None,
        key_version=1,
        rolled_from_position_id=None,
    )


# --- settlement_instant (Tests 1-4) -----------------------------------------


def test_settlement_instant_spx_is_am_in_eastern() -> None:
    instant = settlement_instant(date(2026, 6, 18), root="SPX")
    assert instant.timetz().replace(tzinfo=None) == AM_SETTLEMENT_TIME
    assert instant.date() == date(2026, 6, 18)


def test_settlement_instant_spxw_is_pm_in_eastern() -> None:
    instant = settlement_instant(date(2026, 6, 18), root="SPXW")
    assert instant.timetz().replace(tzinfo=None) == PM_SETTLEMENT_TIME
    assert instant.date() == date(2026, 6, 18)


def test_settlement_instant_spxw_third_friday_is_still_pm() -> None:
    """D026: style comes from the root, never from the calendar position
    of the date. 2026-06-19 is the third Friday of June 2026."""
    third_friday = date(2026, 6, 19)
    assert third_friday.weekday() == 4  # Friday
    assert 15 <= third_friday.day <= 21  # the third Friday of the month

    instant = settlement_instant(third_friday, root="SPXW")
    assert instant.timetz().replace(tzinfo=None) == PM_SETTLEMENT_TIME


def test_settlement_instant_dst_is_handled_by_the_zone_not_a_constant() -> None:
    """A winter and a summer expiry at the same named wall-clock time
    produce different UTC offsets -- proof DST comes from `zoneinfo`,
    never a hardcoded offset."""
    winter = settlement_instant(date(2026, 1, 16), root="SPXW")
    summer = settlement_instant(date(2026, 6, 18), root="SPXW")
    assert winter.utcoffset() != summer.utcoffset()


# --- derive_settlements (Tests 5-9) -----------------------------------------


def test_derive_settlements_produces_no_draft_before_expiry() -> None:
    leg = _leg(root="SPX", expiry=date(2026, 6, 18))
    as_of = settlement_instant(date(2026, 6, 18), root="SPX").replace(
        hour=8, minute=0
    )  # earlier the same day, still before the 09:30 AM instant

    drafts = derive_settlements([leg], [], as_of=as_of)

    assert drafts == ()


def test_derive_settlements_produces_one_draft_at_or_after_expiry() -> None:
    leg = _leg(root="SPX", expiry=date(2026, 6, 18))
    instant = settlement_instant(date(2026, 6, 18), root="SPX")

    drafts = derive_settlements([leg], [], as_of=instant)

    assert drafts == (
        DerivedSettlement(position_id=leg.position_id, event_time=instant),
    )


def test_derive_settlements_skips_a_leg_with_an_existing_settlement_row() -> None:
    leg = _leg(root="SPX", expiry=date(2026, 6, 18))
    instant = settlement_instant(date(2026, 6, 18), root="SPX")
    existing = _settlement_event_record(position_id=leg.position_id, event_time=instant)

    drafts = derive_settlements([leg], [existing], as_of=instant)

    assert drafts == ()


def test_derive_settlements_mixed_style_position_produces_two_distinct_drafts() -> None:
    """The Pitfall 2 regression at the pure-function level: one position
    with an SPXW front (earlier expiry) and an SPX back (later expiry),
    both past `as_of`, must produce exactly TWO drafts with two distinct
    `event_time` values -- never collapsed to one."""
    front = _leg(
        position_id=_POSITION_A, root="SPXW", expiry=date(2026, 6, 12), leg_role="front"
    )
    back = _leg(
        position_id=_POSITION_A, root="SPX", expiry=date(2026, 6, 19), leg_role="back"
    )
    as_of = datetime(2026, 12, 31, tzinfo=UTC)  # well past both expiries

    drafts = derive_settlements([front, back], [], as_of=as_of)

    assert len(drafts) == 2
    event_times = {draft.event_time for draft in drafts}
    assert len(event_times) == 2
    assert {draft.position_id for draft in drafts} == {_POSITION_A}


def test_derive_settlements_takes_no_session_and_reads_no_clock() -> None:
    """D7-06: `as_of` is the only time input. No `AsyncSession` parameter,
    keyword-only `as_of`."""
    signature = inspect.signature(derive_settlements)
    parameter_names = list(signature.parameters)
    assert parameter_names == ["legs", "events", "as_of"]
    assert signature.parameters["as_of"].kind == inspect.Parameter.KEYWORD_ONLY
    for name, parameter in signature.parameters.items():
        # `str(parameter)` (not `.annotation`, which typeshed types as
        # `Any`) renders the parameter's full "name: annotation" text --
        # a plain `str`, no `Any` boundary to cross (reportAny).
        assert "AsyncSession" not in str(parameter), name
