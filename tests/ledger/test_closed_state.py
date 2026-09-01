"""07-02-PLAN.md Task 1: closed state as a pure function over net quantity
per leg (LEDGER-05, D7-01, D7-02, D7-03).

Tests 1-6 are pure -- they build `FillRecord`/`EventRecord`/`LegRow`
directly and call `net_quantity_for_leg`/`derive_position_state`, no
database, no `pytest.mark.db` -- mirroring
`tests/ledger/test_position_creation.py`'s own no-marker convention for its
pure tests. Tests 7-8 are `db`-marked: the 14th synthetic single-OPEN
calendar derives to open, and a fully-unwound oracle calendar derives to
closed, through the real read wrapper (`read_position_state`) against real
seeded fills and events -- replacing the behavioural half of
`test_pairing_no_position_state.py` that Task 2 retires.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventRecord
from morai.ledger.fills import FillRecord
from morai.ledger.pairing import sync_events
from morai.ledger.positions import (
    LegNet,
    LegRow,
    PositionState,
    derive_position_state,
    net_quantity_for_leg,
    read_position_state,
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
from tests.ledger.oracle_seed import seed_oracle, seed_synthetic_open_calendar

# Re-exported, not merely imported -- pytest resolves these by name lookup
# in this module's namespace. Same convention every other ledger test
# module already uses.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

_USER_ID = UUID("00000000-0000-4000-8000-000000000097")


def _fill(
    *,
    occ_symbol: str,
    side: str,
    quantity: Decimal | None,
    execution_time: datetime,
    order_id: str = "ORDER-1",
) -> FillRecord:
    """A hand-built `FillRecord`, no database -- mirrors
    `test_position_creation.py::_fill_record`'s own shape."""
    return FillRecord(
        user_id=_USER_ID,
        order_id=order_id,
        occ_symbol=occ_symbol,
        leg_index=0,
        execution_time=execution_time,
        position_effect="OPENING",
        side=side,
        quantity=quantity,
        price_usd=Decimal("1.00"),
        key_version=1,
    )


def _event(*, position_id: UUID, event_type: str, event_time: datetime) -> EventRecord:
    return EventRecord(
        id=uuid4(),
        user_id=_USER_ID,
        position_id=position_id,
        event_type=event_type,
        event_time=event_time,
        fill_ids_hash=None,
        open_debit_usd=None,
        close_credit_usd=None,
        key_version=1,
        rolled_from_position_id=None,
    )


def test_two_legs_each_net_zero_position_closed_at_latest_event_time() -> None:
    """Test 1: two legs each with a BUY of 1 and a SELL of 1 net to zero,
    and the position is closed at the latest event time of the closing
    group."""
    position_id = uuid4()
    t_open = datetime(2026, 1, 1, tzinfo=UTC)
    t_close = datetime(2026, 2, 1, tzinfo=UTC)
    legs = (
        LegRow(id=uuid4(), position_id=position_id, occ_symbol="LEGA"),
        LegRow(id=uuid4(), position_id=position_id, occ_symbol="LEGB"),
    )
    fills = [
        _fill(
            occ_symbol="LEGA", side="BUY", quantity=Decimal("1"), execution_time=t_open
        ),
        _fill(
            occ_symbol="LEGA",
            side="SELL",
            quantity=Decimal("1"),
            execution_time=t_close,
        ),
        _fill(
            occ_symbol="LEGB", side="SELL", quantity=Decimal("1"), execution_time=t_open
        ),
        _fill(
            occ_symbol="LEGB", side="BUY", quantity=Decimal("1"), execution_time=t_close
        ),
    ]
    events = [
        _event(position_id=position_id, event_type="OPEN", event_time=t_open),
        _event(position_id=position_id, event_type="CLOSE", event_time=t_close),
    ]

    state = derive_position_state(position_id, legs, fills, events)

    assert isinstance(state, PositionState)
    assert state.is_closed is True
    assert state.opened_at == t_open
    assert state.closed_at == t_close
    assert all(isinstance(leg_net, LegNet) for leg_net in state.leg_nets)
    assert all(leg_net.net_quantity == Decimal("0") for leg_net in state.leg_nets)


def test_leg_with_no_offsetting_sell_nets_nonzero_and_stays_open() -> None:
    """Test 2: a leg with a BUY of 1 and no offsetting SELL nets to a
    non-zero quantity, and the position is open with `closed_at` `None`."""
    position_id = uuid4()
    t_open = datetime(2026, 1, 1, tzinfo=UTC)
    legs = (LegRow(id=uuid4(), position_id=position_id, occ_symbol="LEGA"),)
    fills = [
        _fill(
            occ_symbol="LEGA", side="BUY", quantity=Decimal("1"), execution_time=t_open
        )
    ]
    events = [_event(position_id=position_id, event_type="OPEN", event_time=t_open)]

    state = derive_position_state(position_id, legs, fills, events)

    assert state.is_closed is False
    assert state.closed_at is None
    assert state.leg_nets[0].net_quantity == Decimal("1")


def test_unrecognised_side_makes_leg_net_none_and_neither_open_nor_closed() -> None:
    """Test 3: a fill whose `side` is neither `BUY` nor `SELL` makes that
    leg's net `None`, and the position is reported neither open nor
    closed -- `is_closed` is `None`, never `False` (D7-03, NN-16)."""
    position_id = uuid4()
    t_open = datetime(2026, 1, 1, tzinfo=UTC)
    legs = (LegRow(id=uuid4(), position_id=position_id, occ_symbol="LEGA"),)
    fills = [
        _fill(
            occ_symbol="LEGA", side="XFER", quantity=Decimal("1"), execution_time=t_open
        )
    ]
    events = [_event(position_id=position_id, event_type="OPEN", event_time=t_open)]

    assert net_quantity_for_leg(fills) is None

    state = derive_position_state(position_id, legs, fills, events)
    assert state.is_closed is None
    assert state.leg_nets[0].net_quantity is None


def test_none_quantity_produces_the_same_none_net_for_its_leg() -> None:
    """Test 4: a fill whose `quantity` is `None` produces the same `None`
    net for its leg."""
    fills = [
        _fill(
            occ_symbol="LEGA",
            side="BUY",
            quantity=None,
            execution_time=datetime(2026, 1, 1, tzinfo=UTC),
        )
    ]
    assert net_quantity_for_leg(fills) is None


def test_opened_at_is_earliest_open_event_time_and_none_without_one() -> None:
    """Test 5: `opened_at` is the `event_time` of the earliest OPEN event,
    and is `None` when no OPEN event exists."""
    position_id = uuid4()
    t_earlier = datetime(2026, 1, 1, tzinfo=UTC)
    t_later = datetime(2026, 1, 5, tzinfo=UTC)
    legs = (LegRow(id=uuid4(), position_id=position_id, occ_symbol="LEGA"),)
    fills = [
        _fill(
            occ_symbol="LEGA",
            side="BUY",
            quantity=Decimal("1"),
            execution_time=t_earlier,
        )
    ]
    events = [
        _event(position_id=position_id, event_type="OPEN", event_time=t_later),
        _event(position_id=position_id, event_type="OPEN", event_time=t_earlier),
    ]

    state = derive_position_state(position_id, legs, fills, events)
    assert state.opened_at == t_earlier

    state_no_open = derive_position_state(position_id, legs, fills, events=())
    assert state_no_open.opened_at is None


def test_sign_convention_never_uses_absolute_value() -> None:
    """Test 6: the sign convention never uses an absolute value -- a SELL
    of 3 against a BUY of 1 nets to a negative quantity, not a positive
    one."""
    fills = [
        _fill(
            occ_symbol="LEGA",
            side="BUY",
            quantity=Decimal("1"),
            execution_time=datetime(2026, 1, 1, tzinfo=UTC),
        ),
        _fill(
            occ_symbol="LEGA",
            side="SELL",
            quantity=Decimal("3"),
            execution_time=datetime(2026, 1, 2, tzinfo=UTC),
        ),
    ]
    assert net_quantity_for_leg(fills) == Decimal("-2")


@pytest.mark.db
async def test_synthetic_open_calendar_derives_to_open_via_read_position_state(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 7 (db): the 14th synthetic single-OPEN calendar -- one OPENING
    order, no CLOSE order anywhere -- derives to open through the real
    read wrapper against real seeded fills and events."""
    position_id = await seed_synthetic_open_calendar(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )
    await sync_events(app_db_session, provisioned_users.user_a)

    state = await read_position_state(
        app_db_session, position_id, provisioned_users.user_a
    )

    assert state.is_closed is False
    assert state.closed_at is None
    assert state.opened_at is not None


@pytest.mark.db
async def test_fully_unwound_oracle_calendar_derives_to_closed_via_read_position_state(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 7 (db), second half: a fully-unwound real oracle calendar
    derives to closed through the real read wrapper."""
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["9eef2153"],
    )
    await sync_events(app_db_session, provisioned_users.user_a)

    state = await read_position_state(
        app_db_session, position_ids["9eef2153"], provisioned_users.user_a
    )

    assert state.is_closed is True
    assert state.closed_at is not None
