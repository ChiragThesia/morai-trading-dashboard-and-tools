"""07-01-PLAN.md Task 2: leg-role assignment, root provenance, OPENING-only
scoping, and creation idempotency for `morai.ledger.positions`.

Tests 1-5 are pure -- they build `FillRecord`s directly and call
`plan_positions` with a hand-built `resolutions` mapping, no database, no
`pytest.mark.db` -- mirroring `tests/ledger/test_pairing_pure.py`'s own
no-marker convention: a database marker here would hide that `plan_positions`
needs nothing but data. Test 6 is a `db`-marked idempotency proof through
the real write path (`create_positions`), since idempotency is a database
fact (does the second call see the first's committed legs?), not a pure one.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.fills import FillRecord, FillWrite, insert_fills
from morai.ledger.pairing import FillKey, parse_occ_symbol
from morai.ledger.positions import create_positions, plan_positions
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- pytest resolves these by name lookup
# in this module's namespace when a test module imports them from here.
# Same convention `tests/ledger/test_oracle_gate.py`/
# `test_pairing_no_position_state.py` already use.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

_USER_ID = UUID("00000000-0000-4000-8000-000000000003")
_ORDER_ID = "1006681717677"
_FRONT_SYMBOL = "SPXW260618P07275000"  # earlier expiry -- 2026-06-18
_BACK_SYMBOL = "SPX260717P07275000"  # later expiry -- 2026-07-17
_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `fills.py`/`events.py` already established. `TypeAdapter` narrows
# at that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)


def _fill_record(
    *,
    order_id: str = _ORDER_ID,
    occ_symbol: str,
    leg_index: int = 0,
    execution_time: datetime = _EXECUTION_TIME,
    position_effect: str,
    side: str = "SELL",
) -> FillRecord:
    """Mirrors `tests/ledger/test_pairing_pure.py::_fill_record`'s own
    shape -- a hand-built `FillRecord`, no database."""
    return FillRecord(
        user_id=_USER_ID,
        order_id=order_id,
        occ_symbol=occ_symbol,
        leg_index=leg_index,
        execution_time=execution_time,
        position_effect=position_effect,
        side=side,
        quantity=Decimal("1"),
        price_usd=Decimal("1"),
        key_version=1,
    )


def test_two_opening_fills_plan_front_by_earlier_expiry_regardless_of_order() -> None:
    """A1: `front` is the earlier parsed expiry, `back` the later, whether
    the front or the back fill is listed first -- leg-role assignment
    reads the parsed contract's own expiry, never the fills' input order."""
    front_first = [
        _fill_record(occ_symbol=_FRONT_SYMBOL, position_effect="OPENING"),
        _fill_record(occ_symbol=_BACK_SYMBOL, leg_index=1, position_effect="OPENING"),
    ]
    back_first = list(reversed(front_first))

    for fills in (front_first, back_first):
        planned = plan_positions(fills, {})
        assert len(planned) == 1
        position = planned[0]
        assert position.order_id == _ORDER_ID
        assert len(position.legs) == 2
        front, back = position.legs
        assert front.leg_role == "front"
        assert front.occ_symbol == _FRONT_SYMBOL
        assert back.leg_role == "back"
        assert back.occ_symbol == _BACK_SYMBOL


def test_root_comes_from_parse_occ_symbol_never_a_hand_derived_substring() -> None:
    """Every planned leg's `root` equals `parse_occ_symbol(occ_symbol).root`
    -- the assertion compares against the parser's own output, not a
    hardcoded literal, so a change to the OCC symbol convention cannot
    silently desync this test from the parser it is supposed to prove."""
    fills = [
        _fill_record(occ_symbol=_FRONT_SYMBOL, position_effect="OPENING"),
        _fill_record(occ_symbol=_BACK_SYMBOL, leg_index=1, position_effect="OPENING"),
    ]
    planned = plan_positions(fills, {})
    assert len(planned) == 1
    for leg in planned[0].legs:
        assert leg.root == parse_occ_symbol(leg.occ_symbol).root


def test_a_fill_already_resolved_to_a_real_position_plans_nothing() -> None:
    """A fill whose `FillKey` maps to a real `UUID` in `resolutions` is
    already resolved -- it contributes no new `PlannedPosition` (creation
    only fills the gap `resolve_fill_positions` could not already close)."""
    fill = _fill_record(occ_symbol=_FRONT_SYMBOL, position_effect="OPENING")
    key: FillKey = (
        fill.order_id,
        fill.occ_symbol,
        fill.leg_index,
        fill.execution_time,
    )
    resolutions = {key: uuid4()}

    planned = plan_positions([fill], resolutions)
    assert planned == ()


def test_a_closing_fill_with_no_resolution_plans_nothing() -> None:
    """D7-12: creation is OPENING-only. A CLOSING fill has nothing to
    close if it is unresolved -- there is no position for it to close --
    so it plans no new position, matching `classify_fill`'s own
    OPENING-vs-CLOSING distinction (never `side`, per Rule 1, NN-9)."""
    fill = _fill_record(occ_symbol=_FRONT_SYMBOL, position_effect="CLOSING")
    planned = plan_positions([fill], {})
    assert planned == ()


def test_a_single_distinct_opening_symbol_plans_one_front_leg_and_does_not_raise() -> (
    None
):
    """A2: an order whose fills all resolve to one distinct OPENING
    `occ_symbol` (no matching second contract) still plans -- exactly one
    `PlannedLeg` with `leg_role='front'`, and `plan_positions` does not
    raise. No production fixture proves this project ever opens a
    single-leg structure (it trades calendars/diagonals exclusively); the
    code must not crash if it happens anyway."""
    fills = [
        _fill_record(occ_symbol=_FRONT_SYMBOL, position_effect="OPENING"),
    ]
    planned = plan_positions(fills, {})
    assert len(planned) == 1
    position = planned[0]
    assert len(position.legs) == 1
    assert position.legs[0].leg_role == "front"
    assert position.legs[0].occ_symbol == _FRONT_SYMBOL
    assert position.legs[0].root == parse_occ_symbol(_FRONT_SYMBOL).root


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- Postgres's
    `SET` grammar only accepts a literal there. Mirrors
    `tests/test_isolation.py::_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


@pytest.mark.db
async def test_create_positions_called_twice_creates_the_position_once(
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Idempotency (D7-12): calling `create_positions` a second time over
    the same fills in the same transaction sees them already resolved
    through the `legs` the first call wrote -- the position is created
    once, not twice. Seeds fills through `insert_fills`, the real write
    path, never a test-only fast path (D3-14's own discipline)."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)

    fill_writes = [
        FillWrite(
            order_id=_ORDER_ID,
            occ_symbol=_FRONT_SYMBOL,
            leg_index=0,
            execution_time=_EXECUTION_TIME,
            position_effect="OPENING",
            side="SELL",
            quantity=Decimal("1"),
            price_usd=Decimal("44.8567"),
        ),
        FillWrite(
            order_id=_ORDER_ID,
            occ_symbol=_BACK_SYMBOL,
            leg_index=1,
            execution_time=_EXECUTION_TIME,
            position_effect="OPENING",
            side="BUY",
            quantity=Decimal("1"),
            price_usd=Decimal("30.1233"),
        ),
    ]
    await insert_fills(app_db_session, user_id, fill_writes)

    first_created = await create_positions(app_db_session, user_id)
    second_created = await create_positions(app_db_session, user_id)

    assert first_created == 1
    assert second_created == 0

    # `provisioned_users.position_a` is a pre-existing, legless row
    # `seeded_users` (tests/identity/conftest.py) always seeds per user --
    # unrelated to and predating this plan's creation path -- so the
    # count below is 2, not 1: one pre-existing seed plus the one this
    # test's own two `create_positions` calls actually created.
    count_row = _INT.validate_python(
        (
            await app_db_session.execute(
                text("SELECT count(*) FROM positions WHERE user_id = :uid"),
                {"uid": str(user_id)},
            )
        ).scalar_one()
    )
    assert count_row == 2
