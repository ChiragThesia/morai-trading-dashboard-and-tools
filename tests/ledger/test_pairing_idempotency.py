"""Task 3: re-deriving the same `(user, order_id)` scope changes nothing
(LEDGER-09).

One self-contained test function -- this repo configures no test-order
randomisation (`pyproject.toml`'s pytest block has one marker, `db`, and no
shuffle plugin), so a test split across separate functions relying on
execution order would never be caught if that coupling ever broke.

D5-01 defers positive ROLL derivation, so an idempotent re-run here proves
OPEN and CLOSE only -- the guard against a spurious ROLL is plan 05-02's,
and it is a different claim.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.ledger.events import read_events
from morai.ledger.pairing import sync_events
from morai.settings import get_settings
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.oracle_seed import ORACLE_FILLS, seed_oracle

__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db


async def test_repeated_sync_events_over_one_scope_inserts_nothing_new(
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
    open_order_id = next(
        f.order_id
        for f in ORACLE_FILLS
        if f.calendar_id == "65aac62e" and f.position_effect == "OPENING"
    )

    first = await sync_events(app_db_session, provisioned_users.user_a)
    assert len(first.events) == 2

    first_records = await read_events(app_db_session, provisioned_users.user_a)
    first_hashes = {record.fill_ids_hash for record in first_records}
    assert len(first_records) == 2
    assert len(first_hashes) == 2
    assert None not in first_hashes

    # Second run, no scope: the row count and the set of fill_ids_hash
    # values are unchanged.
    await sync_events(app_db_session, provisioned_users.user_a)
    second_records = await read_events(app_db_session, provisioned_users.user_a)
    second_hashes = {record.fill_ids_hash for record in second_records}
    assert len(second_records) == len(first_records)
    assert second_hashes == first_hashes

    # Third run, scoped to the calendar's own open order id: still no new
    # row -- the OPEN event's hash already exists, so nothing is written.
    # The scoped run's own derivation reports zero unresolved fills, the
    # property plan 05-02 then proves under the real shared-leg ambiguity.
    third = await sync_events(
        app_db_session,
        provisioned_users.user_a,
        order_ids=[open_order_id],
    )
    assert third.unresolved == ()

    third_records = await read_events(app_db_session, provisioned_users.user_a)
    third_hashes = {record.fill_ids_hash for record in third_records}
    assert len(third_records) == len(first_records)
    assert third_hashes == first_hashes


async def _sync_over_own_engine(barrier: asyncio.Barrier, user_id: UUID) -> None:
    """One full `sync_events` cycle on its own engine and session,
    connected as `morai_app` with RLS set explicitly -- mirrors
    `tests/vendor/test_refresh_lock.py`'s own `_refresh_over_own_engine`
    and `tests/vendor/test_upsert_connection_race.py`'s own
    barrier-fenced helper, for the same reason: two sessions on one engine
    would not prove this, because a single connection serialises the two
    statements and the race never happens. Waits on `barrier` immediately
    before the call so both coroutines genuinely overlap the
    read-compare-skip window rather than merely being scheduled close
    together."""
    engine = create_async_engine(get_settings().app_async_dsn)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user_id)},
            )
            await asyncio.wait_for(barrier.wait(), timeout=5)
            await sync_events(session, user_id)
            await session.commit()
    finally:
        await engine.dispose()


async def test_two_concurrent_sync_events_calls_for_one_user_write_exactly_one_event_set(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """CR-02 (`05-REVIEW.md`). Two overlapping `sync_events` calls for the
    same user -- a manual resync racing the scheduled worker's own sweep,
    or two retried requests -- must not both read the same empty
    `existing_triples` and both insert. The barrier (size 2) fences both
    coroutines at the same instant right before each calls `sync_events`,
    so a serialised implementation still passes this test by construction
    -- what proves the race is closed is that neither call raises and
    exactly one event set survives, not merely that both eventually
    succeed."""
    await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["65aac62e"],
    )
    await app_db_session.commit()

    barrier = asyncio.Barrier(2)

    async with asyncio.timeout(10):
        await asyncio.gather(
            _sync_over_own_engine(barrier, provisioned_users.user_a),
            _sync_over_own_engine(barrier, provisioned_users.user_a),
        )

    records = await read_events(superuser_db_session, provisioned_users.user_a)
    hashes = {record.fill_ids_hash for record in records}
    assert len(records) == 2
    assert len(hashes) == 2
