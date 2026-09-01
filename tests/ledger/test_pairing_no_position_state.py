"""Task 2: hard case 2 -- position state changes nothing, and the 14th
fixture stays open (D5-02, `salvage/oracle-fixtures.md`'s "Hard case 2 --
the stale status column").

This schema has no status column (Phase 3's own decision, `D5-02`) and one
must not be added. Criterion 2 -- "mutating a position's status column
changes no derived event" -- was originally satisfied two ways: structurally,
by the AST gate in `tests/ledger/test_pairing_pure.py`
(`test_pairing_never_imports_or_references_position`), which proves the
derivation module never even names the `Position` model; and behaviourally,
by mutating the only two state columns that then existed (`opened_at`,
`closed_at`) and observing that no derived event moved.

**The behavioural half is retired here, by Phase 7's own schema change, not
by oversight.** Migration 0014 (07-02-PLAN.md) drops `opened_at`/`closed_at`
entirely (D7-01) -- closed state is derived from net quantity per leg
instead (LEDGER-05), so there is nothing left to mutate. The structural half
(the AST gate) still stands unchanged. The behavioural claim's replacement
lives in `tests/ledger/test_closed_state.py`
(`test_two_legs_each_net_zero_position_closed_at_latest_event_time` and its
siblings), which proves the same thing about the derivation that actually
exists now: fill-quantity mutation, not column mutation, is what a gapped or
unwound leg looks like to `derive_position_state`.

This module is also the 14th synthetic fixture's own proof: one OPENING
order, no CLOSE order anywhere, must derive to exactly one OPEN event and
never a fabricated CLOSE. Deciding whether a *position* is closed is
`LEDGER-05`, Phase 7's work -- this module's narrower claim is only that
nothing in the derivation path invents a CLOSE for a calendar with no
closing fill.

`pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.pairing import EventType, sync_events
from morai.ledger.positions import read_position_state
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.oracle_seed import (
    SYNTHETIC_OPEN_DEBIT_USD,
    SYNTHETIC_OPEN_POSITION_ID,
    seed_oracle,
    seed_synthetic_open_calendar,
)

__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db


async def test_synthetic_open_calendar_derives_to_one_open_event_and_stays_open(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await seed_synthetic_open_calendar(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 1

    event = derivation.events[0]
    assert event.event_type is EventType.OPEN
    assert event.open_debit_usd == SYNTHETIC_OPEN_DEBIT_USD
    assert event.close_credit_usd is None

    close_events = [e for e in derivation.events if e.event_type is EventType.CLOSE]
    assert close_events == []

    # Derived, not a stored column (D7-01) -- moved off `positions.closed_at`
    # the same way `routes_identity.py`'s readers were.
    state = await read_position_state(
        app_db_session, SYNTHETIC_OPEN_POSITION_ID, provisioned_users.user_a
    )
    assert state.closed_at is None


async def test_synthetic_open_calendar_stays_open_alongside_the_13_real_calendars(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await seed_oracle(superuser_db_session, app_db_session, provisioned_users.user_a)
    await seed_synthetic_open_calendar(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)
    assert derivation.unresolved == ()

    synthetic_events = [
        e for e in derivation.events if e.position_id == SYNTHETIC_OPEN_POSITION_ID
    ]
    assert len(synthetic_events) == 1
    assert synthetic_events[0].event_type is EventType.OPEN
    assert synthetic_events[0].open_debit_usd == SYNTHETIC_OPEN_DEBIT_USD

    # 13 real calendars x 2 events each + the 14th's own 1 OPEN.
    assert len(derivation.events) == 27
