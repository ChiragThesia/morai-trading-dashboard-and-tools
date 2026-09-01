"""D7-09/D7-10: positive ROLL derivation (Task 1 of this plan; Task 2
extends this file with the campaign-chain read over derived rolls,
ROADMAP criterion 4).

Every fixture in this file is synthetic (D7-13). No independent oracle
exists for ROLL -- unlike the 13 real calendars in `oracle_seed.py`, whose
hex `calendar_id`s this file's synthetic ids are deliberately built to
never resemble (`SYN-` prefixed, never a bare hex string). The genuine
independent check available to this plan is a negative one: Test 9 below
re-seeds the full 13-calendar oracle and asserts it still derives zero
ROLL events, byte-identically with `test_oracle_gate.py`'s own invariant.

Tests 1-8 are pure -- hand-built `FillRecord`s and a hand-built
`resolutions` mapping, no database, no `pytest.mark.db` -- proving
`derive_events`'s roll pass in isolation, the same no-marker convention
`test_pairing_pure.py`/`test_position_creation.py` already use. Test 9 is
`db`-marked: the oracle's own negative guard at full scale, closing
D5-01's own hard-stop requirement.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.fills import FillRecord
from morai.ledger.pairing import (
    EventType,
    FillKey,
    _net_amount,  # pyright: ignore[reportPrivateUsage]  # why: Test 2 asserts a derived ROLL's amounts equal `_net_amount`'s own output, not a hardcoded literal (D7-09's own basis for resolving D5-01's deferral) -- the same in-suite access to this module's private money helpers `test_pairing_pure.py`/`test_pairing_seeded_faults.py` already use.
    derive_events,
    sync_events,
)
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.oracle_seed import seed_oracle

# Re-exported, not merely imported -- pytest resolves these by name lookup
# in this module's namespace, the same convention every other ledger test
# module in this project already follows.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

_INT: TypeAdapter[int] = TypeAdapter(int)

# --- Tests 1-8: pure fixtures, synthetic, never a real oracle id (D7-13) --

_USER_ID = UUID("00000000-0000-4000-8000-000000000097")
_ROLL_ORDER_ID = "SYN-ROLL-0001"
_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)

# Same root (SPXW), same strike (7500), same option type (P) -- differing
# only in expiry, so `detect_roll` reads this pair True.
_CLOSING_SYMBOL = "SPXW260618P07500000"
_OPENING_SYMBOL = "SPXW260716P07500000"

# One field changed from `_OPENING_SYMBOL` at a time, for the negative
# tests (4-6).
_OPENING_SYMBOL_DIFFERENT_STRIKE = "SPXW260716P07550000"
_OPENING_SYMBOL_DIFFERENT_ROOT = "SPX260716P07500000"
_OPENING_SYMBOL_DIFFERENT_OPTION_TYPE = "SPXW260716C07500000"
_OPENING_SYMBOL_SAME_EXPIRY = "SPXW260618P07500000"


def _fill_record(
    *,
    order_id: str = _ROLL_ORDER_ID,
    occ_symbol: str,
    leg_index: int,
    execution_time: datetime = _EXECUTION_TIME,
    position_effect: str,
    side: str,
    quantity: Decimal | None = Decimal("1"),
    price_usd: Decimal | None,
) -> FillRecord:
    return FillRecord(
        user_id=_USER_ID,
        order_id=order_id,
        occ_symbol=occ_symbol,
        leg_index=leg_index,
        execution_time=execution_time,
        position_effect=position_effect,
        side=side,
        quantity=quantity,
        price_usd=price_usd,
        key_version=1,
    )


def _key(fill: FillRecord) -> FillKey:
    return (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)


def test_same_order_same_root_strike_and_type_different_expiry_derives_one_roll() -> (
    None
):
    """Behavior 1: a same-order CLOSE/OPEN pair, same root/strike/option
    type, different expiries, resolving to two different positions,
    derives exactly one ROLL event and no separate CLOSE or OPEN for that
    pair."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000101"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000102"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 1
    assert derivation.events[0].event_type is EventType.ROLL


def test_roll_amounts_are_exactly_net_amounts_own_output_never_netted() -> None:
    """Behavior 2: the ROLL's `open_debit_usd`/`close_credit_usd` are both
    non-`None` and are exactly what `_net_amount` returns for each half --
    never a single netted figure, never a sum."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000101"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000102"),
    }

    derivation = derive_events([closing, opening], resolutions)
    assert len(derivation.events) == 1
    event = derivation.events[0]

    assert event.open_debit_usd is not None
    assert event.close_credit_usd is not None
    assert event.open_debit_usd == _net_amount([opening], EventType.OPEN)
    assert event.close_credit_usd == _net_amount([closing], EventType.CLOSE)


def test_roll_hangs_on_the_opened_position_and_points_back_at_the_closed_one() -> None:
    """Behavior 3 (D7-10): the ROLL's `position_id` is the newly opened
    position and its `rolled_from_position_id` is the closed one."""
    closed_position_id = UUID("00000000-0000-4000-8000-000000000201")
    opened_position_id = UUID("00000000-0000-4000-8000-000000000202")
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): closed_position_id,
        _key(opening): opened_position_id,
    }

    derivation = derive_events([closing, opening], resolutions)
    assert len(derivation.events) == 1
    event = derivation.events[0]

    assert event.position_id == opened_position_id
    assert event.rolled_from_position_id == closed_position_id


def test_pair_differing_in_strike_derives_no_roll() -> None:
    """Behavior 4: a pair differing in strike derives no ROLL -- the fills
    fall through to the ordinary OPEN and CLOSE path."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL_DIFFERENT_STRIKE,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000301"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000302"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert len(derivation.events) == 2
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)


def test_pair_differing_in_root_derives_no_roll() -> None:
    """Behavior 5a: a pair differing in root derives no ROLL."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL_DIFFERENT_ROOT,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000401"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000402"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert len(derivation.events) == 2
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)


def test_pair_differing_in_option_type_derives_no_roll() -> None:
    """Behavior 5b: a pair differing in option type derives no ROLL."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL_DIFFERENT_OPTION_TYPE,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000501"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000502"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert len(derivation.events) == 2
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)


def test_pair_with_same_expiry_on_both_sides_derives_no_roll() -> None:
    """Behavior 6: a pair with the same expiry on both sides derives no
    ROLL."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL_SAME_EXPIRY,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000601"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000602"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert len(derivation.events) == 2
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)


def test_unrecognized_side_on_either_half_derives_no_roll_and_two_ordinary_events() -> (
    None
):
    """Behavior 7: a pair where either half's `_net_amount` returns `None`
    -- here, the closing fill's `side` is neither `"BUY"` nor `"SELL"` --
    derives no ROLL at all, rather than a ROLL with one amount missing."""
    closing = _fill_record(
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="UNKNOWN",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        occ_symbol=_OPENING_SYMBOL,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000701"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000702"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert len(derivation.events) == 2
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)


def test_pair_in_different_orders_derives_no_roll() -> None:
    """Behavior 8: two fills in different orders that would otherwise
    match derive no ROLL -- a roll is one broker order."""
    closing = _fill_record(
        order_id="SYN-ROLL-0001-A",
        occ_symbol=_CLOSING_SYMBOL,
        leg_index=0,
        position_effect="CLOSING",
        side="BUY",
        price_usd=Decimal("12.34"),
    )
    opening = _fill_record(
        order_id="SYN-ROLL-0001-B",
        occ_symbol=_OPENING_SYMBOL,
        leg_index=1,
        position_effect="OPENING",
        side="SELL",
        price_usd=Decimal("5.67"),
    )
    resolutions = {
        _key(closing): UUID("00000000-0000-4000-8000-000000000801"),
        _key(opening): UUID("00000000-0000-4000-8000-000000000802"),
    }

    derivation = derive_events([closing, opening], resolutions)

    assert len(derivation.events) == 2
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)


# --- Test 9: the oracle stays byte-identically green (db) ------------------


@pytest.mark.db
async def test_full_oracle_derives_zero_roll_events(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Behavior 9: the 13 real oracle calendars derive exactly 4 events
    each (2 here -- OPEN and CLOSE, per this schema's position-level
    event row, `test_oracle_gate.py`'s own translation), all OPEN or
    CLOSE, with zero ROLL events -- including order `1006797510202`,
    which spans two calendars and is not a roll."""
    await seed_oracle(superuser_db_session, app_db_session, provisioned_users.user_a)

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 26
    assert all(event.event_type is not EventType.ROLL for event in derivation.events)

    roll_count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT COUNT(*) FROM events WHERE event_type = 'ROLL'")
            )
        ).scalar_one()
    )
    assert roll_count == 0
