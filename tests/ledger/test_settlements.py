"""07-03-PLAN.md Task 2 + Task 3: per-leg settlement style, DST-correct
settlement instants, the pure `derive_settlements` derivation, and its
fold into `sync_events`'s broadened idempotency key.

Every fixture in this file is synthetic (D7-13) -- no independent oracle
exists for SETTLEMENT, and the position ids below (`...0000f1`, `...0000f2`)
are deliberately outside the 13 real oracle calendar ids in
`tests/ledger/oracle_seed.py` so a synthetic fixture can never be confused
with a real one.

Tests 1-9 are pure -- they build `LegRecord`/`EventRecord` values directly
and call `settlement_instant`/`derive_settlements`, no database, no
`pytest.mark.db` -- mirroring `tests/ledger/test_pairing_pure.py`'s and
`tests/ledger/test_position_creation.py`'s own no-marker convention for
pure derivation tests. The `db`-marked tests below them prove the fold
into `sync_events` through the real write path.
"""

from __future__ import annotations

import inspect
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventRecord, read_events
from morai.ledger.pairing import EventType, sync_events
from morai.ledger.settlements import (
    AM_SETTLEMENT_TIME,
    PM_SETTLEMENT_TIME,
    DerivedSettlement,
    LegRecord,
    derive_settlements,
    settlement_instant,
)
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    SeededPosition,
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- pytest resolves these by name lookup
# in this module's namespace when a test module imports them from here.
# Same convention `tests/ledger/test_oracle_gate.py`/
# `test_position_creation.py` already use.
__all__ = [
    "SeededPosition",
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_position",
    "seeded_users",
    "superuser_db_session",
]

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


# --- sync_events fold-in (Task 3, db-marked) --------------------------------


@pytest.mark.db
async def test_sync_events_mixed_style_position_lands_two_settlement_rows(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Test 1 (db): `seeded_position` already seeds an SPXW front
    (`occ_symbol="SPXW260618P07275000"`, expiry 2026-06-18) and an SPX
    back (`occ_symbol="SPX260717P07275000"`, expiry 2026-07-17) under one
    position -- exactly criterion 3's fixture. Both expiries are past
    `as_of`; the sync must land exactly TWO settlement rows, not one
    (Pitfall 2's regression, asserted at the `sync_events` level)."""
    as_of = datetime(2026, 12, 31, tzinfo=UTC)

    await sync_events(app_db_session, provisioned_users.user_a, as_of=as_of)
    await app_db_session.commit()

    records = await read_events(superuser_db_session, provisioned_users.user_a)
    settlement_records = [r for r in records if r.event_type == "SETTLEMENT"]
    assert len(settlement_records) == 2
    event_times = {r.event_time for r in settlement_records}
    assert len(event_times) == 2
    assert {r.position_id for r in settlement_records} == {
        seeded_position.position_id
    }
    assert all(r.fill_ids_hash is None for r in settlement_records)


@pytest.mark.db
async def test_sync_events_settlement_resync_adds_no_further_rows(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Test 2 (db): syncing the same position a second time adds no
    further settlement rows."""
    as_of = datetime(2026, 12, 31, tzinfo=UTC)

    await sync_events(app_db_session, provisioned_users.user_a, as_of=as_of)
    await app_db_session.commit()
    first = await read_events(superuser_db_session, provisioned_users.user_a)
    first_settlements = [r for r in first if r.event_type == "SETTLEMENT"]
    assert len(first_settlements) == 2

    await sync_events(app_db_session, provisioned_users.user_a, as_of=as_of)
    await app_db_session.commit()
    second = await read_events(superuser_db_session, provisioned_users.user_a)
    second_settlements = [r for r in second if r.event_type == "SETTLEMENT"]
    assert len(second_settlements) == 2


@pytest.mark.db
async def test_sync_events_settlement_rows_have_null_money_and_hash(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Test 3 (db): each settlement row's `fill_ids_hash` and both money
    fields are `None` -- never zero (D7-05, D7-07, NN-16)."""
    as_of = datetime(2026, 12, 31, tzinfo=UTC)

    await sync_events(app_db_session, provisioned_users.user_a, as_of=as_of)
    await app_db_session.commit()

    records = await read_events(superuser_db_session, provisioned_users.user_a)
    settlement_records = [r for r in records if r.event_type == "SETTLEMENT"]
    assert len(settlement_records) == 2
    for record in settlement_records:
        assert record.fill_ids_hash is None
        assert record.open_debit_usd is None
        assert record.close_credit_usd is None


@pytest.mark.db
async def test_sync_events_no_settlement_row_before_expiry(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Test 4 (db): a position whose legs have not yet reached expiry
    produces no settlement row -- `as_of` well before both."""
    as_of = datetime(2020, 1, 1, tzinfo=UTC)

    await sync_events(app_db_session, provisioned_users.user_a, as_of=as_of)
    await app_db_session.commit()

    records = await read_events(superuser_db_session, provisioned_users.user_a)
    assert [r for r in records if r.event_type == "SETTLEMENT"] == []


@pytest.mark.db
async def test_sync_events_with_no_as_of_derives_no_settlements(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """`as_of=None` (the default): settlement derivation is skipped
    entirely -- the oracle suite and every existing caller need no
    change and the 13-calendar gate stays byte-identical (D7-13)."""
    await sync_events(app_db_session, provisioned_users.user_a)
    await app_db_session.commit()

    records = await read_events(superuser_db_session, provisioned_users.user_a)
    assert [r for r in records if r.event_type == "SETTLEMENT"] == []


def test_event_type_settlement_member_exists() -> None:
    assert EventType.SETTLEMENT.value == "SETTLEMENT"
