"""Task 2: hard case 2 -- position state changes nothing, and the 14th
fixture stays open (D5-02, `salvage/oracle-fixtures.md`'s "Hard case 2 --
the stale status column").

This schema has no status column (Phase 3's own decision, `D5-02`) and one
must not be added. Criterion 2 -- "mutating a position's status column
changes no derived event" -- is satisfied two ways instead, not one:
structurally, by the AST gate in `tests/ledger/test_pairing_pure.py`
(`test_pairing_never_imports_or_references_position`), which proves the
derivation module never even names the `Position` model; and
behaviourally, here, by mutating the only two state columns that do
exist (`opened_at`, `closed_at`) and observing that no derived event
moves. Both halves are required -- the AST gate alone would not catch a
future derivation path that reads `opened_at`/`closed_at` themselves as
inputs, which this module's mutation test does catch.

This module is also the 14th synthetic fixture's own proof: one OPENING
order, no CLOSE order anywhere, must derive to exactly one OPEN event and
never a fabricated CLOSE. Deciding whether a *position* is closed is
`LEDGER-05`, Phase 7's work -- this phase's narrower claim is only that
nothing in the derivation path invents a CLOSE for a calendar with no
closing fill.

`pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import read_events
from morai.ledger.pairing import EventType, sync_events
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

_DATETIME_OR_NONE: TypeAdapter[datetime | None] = TypeAdapter(datetime | None)

# An implausible sentinel: no oracle calendar's opened_at/closed_at falls
# anywhere near the year 2099 (all 13 real calendars and the 14th
# synthetic fixture sit in 2026). If a derivation path ever leaked a
# position column into an event's own timestamp, this mismatch would
# surface immediately as a divergent event_time -- not a coincidental
# match.
_SENTINEL_TIMESTAMP = datetime(2099, 1, 1, tzinfo=UTC)


async def test_mutating_position_state_and_rederiving_from_scratch_reproduces_identical_events(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await seed_oracle(superuser_db_session, app_db_session, provisioned_users.user_a)

    first = await sync_events(app_db_session, provisioned_users.user_a)
    assert first.unresolved == ()
    assert first.unclassified == ()

    first_records = await read_events(app_db_session, provisioned_users.user_a)
    first_set = {
        (
            record.position_id,
            record.event_type,
            record.event_time,
            record.fill_ids_hash,
            record.open_debit_usd,
            record.close_credit_usd,
        )
        for record in first_records
    }
    assert len(first_set) == len(first_records)

    # Rewrite every one of this user's positions' two state columns to an
    # implausible sentinel, on the superuser session.
    await superuser_db_session.execute(
        text(
            "UPDATE positions SET opened_at = :t, closed_at = :t WHERE user_id = :uid"
        ),
        {"t": _SENTINEL_TIMESTAMP, "uid": provisioned_users.user_a},
    )
    await superuser_db_session.commit()

    # Truncating events between the two derivations is what makes the
    # second derivation a fresh computation rather than an idempotency
    # skip -- without this, sync_events' own read-compare-skip path would
    # see every draft's hash already present and insert nothing, which
    # would prove nothing about whether the mutation leaked in.
    await superuser_db_session.execute(text("TRUNCATE TABLE events"))
    await superuser_db_session.commit()

    second = await sync_events(app_db_session, provisioned_users.user_a)
    assert second.unresolved == ()
    assert second.unclassified == ()

    second_records = await read_events(app_db_session, provisioned_users.user_a)
    second_set = {
        (
            record.position_id,
            record.event_type,
            record.event_time,
            record.fill_ids_hash,
            record.open_debit_usd,
            record.close_credit_usd,
        )
        for record in second_records
    }

    assert second_set == first_set


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

    row = (
        await superuser_db_session.execute(
            text("SELECT closed_at FROM positions WHERE id = :id"),
            {"id": SYNTHETIC_OPEN_POSITION_ID},
        )
    ).scalar_one()
    assert _DATETIME_OR_NONE.validate_python(row) is None


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
