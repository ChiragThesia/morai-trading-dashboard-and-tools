"""WR-01 (`06-REVIEW.md`): `sync_user`'s own read of `last_synced_at` --
the value that decides which windows get synced -- must happen inside this
user's own `pg_advisory_xact_lock`, not before it. `sync_user`'s docstring
already claimed the whole body ran locked; this test is the proof, mirroring
`tests/ledger/test_pairing_idempotency.py::test_two_concurrent_sync_events_calls_write_exactly_one_event_set`'s
own concurrency shape for `sync_events`'s identical per-user lock (CR-02,
`05-REVIEW.md`) and `tests/vendor/test_refresh_lock.py`'s own
two-independent-engines-plus-gate technique for deterministic ordering.

Deterministic, not merely a race: `auth_a`'s `refresh_gate`/`entered_refresh`
(`tests/vendor/conftest.py::FakeSchwabAuth`) hold call A inside its own
critical section -- past its own lock acquisition, past its own
`read_connection`/`sync_windows`, deep inside `schwab_client_for_user`'s
`build_client` -- so the test can start call B, let B's own pre-lock code
run to completion in real wall-clock time, and only then release A. Under
the ordering this fix corrects, B's own `read_connection`/`sync_windows`
already ran *before* B ever attempts the lock, so B computes its windows
from the same stale `last_synced_at=NULL` A itself started from, never from
A's own committed write. Under the fixed ordering, B's lock attempt blocks
until A commits, and only then does B read the now-current
`last_synced_at` -- so B's first requested window starts from A's own
`started_at`, overlap-adjusted, not from a 365-day first-connect lookback.
The two are far enough apart (365 days vs. one) that no timing tolerance is
needed to tell them apart.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import SchwabConnection
from morai.ingest.schwab_sync import sync_user
from morai.settings import get_settings
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TX_PAYLOAD, TxFakeSchwabAuth

pytestmark = pytest.mark.db

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `test_idempotency.py::_seed_connection` -- leaves
    `last_synced_at` NULL, the first-connect signal `sync_windows` reads."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": "fake-refresh-user-a"},
            created_at=_TOKEN_CREATED_AT,
        ),
        account_hash="fake-account-hash",
    )
    await superuser_db_session.commit()


async def _sync_and_record_over_own_engine(
    user_id: UUID, auth: TxFakeSchwabAuth, started_at: datetime
) -> None:
    """One full `sync_user` cycle on its own engine and session, connected
    as `morai_app` with RLS set explicitly, followed by the exact
    `last_synced_at` write `worker/app.py::sync_user_task` performs on the
    same session before its own commit -- reproduced here, not imported,
    since this file drives `sync_user` directly rather than through the
    worker to bypass Procrastinate's own `concurrency=1` default, the same
    reason `06-REVIEW.md`'s own WR-01 names for why this race needs a
    direct-call test at all."""
    engine = create_async_engine(get_settings().app_async_dsn)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user_id)},
            )
            await sync_user(session, user_id, auth=auth, now=started_at)
            await session.execute(
                update(SchwabConnection)
                .where(SchwabConnection.user_id == user_id)
                .values(last_synced_at=started_at)
            )
            await session.commit()
    finally:
        await engine.dispose()


async def test_second_overlapping_sync_user_call_computes_windows_from_the_locked_read(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    gate = asyncio.Event()
    entered = asyncio.Event()
    auth_a = TxFakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT,
        account_entries=[],
        transactions=TX_PAYLOAD,
        refresh_gate=gate,
        entered_refresh=entered,
    )
    auth_b = TxFakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT,
        account_entries=[],
        transactions=TX_PAYLOAD,
    )

    started_at_a = datetime(2026, 6, 20, tzinfo=UTC)
    started_at_b = started_at_a + timedelta(minutes=1)

    async with asyncio.timeout(15):
        task_a = asyncio.create_task(
            _sync_and_record_over_own_engine(user_id, auth_a, started_at_a)
        )
        # A is now inside its own critical section: past its own lock
        # acquisition and its own read_connection/sync_windows, blocked
        # inside build_client's refresh -- confirmed by the fake's own
        # `entered_refresh`, never by a fixed sleep.
        await asyncio.wait_for(entered.wait(), timeout=5)

        task_b = asyncio.create_task(
            _sync_and_record_over_own_engine(user_id, auth_b, started_at_b)
        )
        # Real wall-clock time for B's own pre-lock code to run to
        # completion before A is released -- under the ordering this test
        # guards against, that is exactly the window where B's own
        # `read_connection`/`sync_windows` runs unlocked, before A's write
        # is even committed.
        await asyncio.sleep(1)

        gate.set()
        await task_a
        await task_b

    settings = get_settings()
    expected_start = started_at_a - timedelta(days=settings.schwab_tx_sync_overlap_days)
    assert auth_b.last_client is not None
    assert auth_b.last_client.windows_by_call[0][0] == expected_start
