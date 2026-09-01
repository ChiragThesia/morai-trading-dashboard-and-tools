"""Task 1's tracer: one real oracle calendar, already in Postgres through
`insert_fills` (the one write path), resolved to its position, classified
from the broker's own `positionEffect`, netted into an OPEN debit and a
CLOSE credit, and written back through `insert_events` (LEDGER-01,
LEDGER-09's first proof, LEDGER-12's shell side).

Amounts are compared with `==` on `Decimal`, not a tolerance: the original
TypeScript suite used `toBeCloseTo(expected, 2)` because JS numbers are
IEEE-754 floats. This codebase is `Decimal` end to end, every oracle price
is quoted to exactly two decimal places, and every oracle quantity is `1`
-- the arithmetic is exact, so exact equality is the stronger check. A
future reader should not "restore" the tolerance thinking it was lost; it
was deliberately not ported.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import read_events
from morai.ledger.pairing import sync_events
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.oracle_seed import ORACLE_CALENDARS, seed_oracle

# Re-exported, not merely imported -- pytest resolves fixtures by name
# lookup in this module's namespace, mirroring test_plaintext_queries.py's
# own convention.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db


async def test_one_calendar_derives_open_and_close_events_end_to_end(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["65aac62e"],
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 2

    records = await read_events(app_db_session, provisioned_users.user_a)
    assert len(records) == 2

    calendar = next(c for c in ORACLE_CALENDARS if c.calendar_id == "65aac62e")
    open_record = next(r for r in records if r.event_type == "OPEN")
    close_record = next(r for r in records if r.event_type == "CLOSE")

    assert calendar.open_net_debit == Decimal("32.35")
    assert calendar.close_net_credit == Decimal("36.35")

    assert open_record.open_debit_usd == calendar.open_net_debit
    assert open_record.close_credit_usd is None
    assert open_record.event_time == calendar.opened_at

    assert close_record.close_credit_usd == calendar.close_net_credit
    assert close_record.open_debit_usd is None
    assert close_record.event_time == calendar.closed_at

    assert open_record.fill_ids_hash is not None
    assert close_record.fill_ids_hash is not None
    assert open_record.fill_ids_hash != close_record.fill_ids_hash
