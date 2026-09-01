"""Task 2 (06-03-PLAN.md): the manual re-sync -- enqueueing `sync_user`
from the web process without a superuser connection (INGEST-04).

`@pytest.mark.db` throughout -- every test drives the real ASGI app over
`httpx.ASGITransport`, matching `tests/vendor/test_oauth_flow.py`'s
established pattern, or defers/drains through the real `worker.app.app`,
matching `tests/ingest/test_sync_tracer.py`'s.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.api.job_queue import app as job_queue_app
from morai.db.models import BrokerTransaction
from morai.ingest.sync_runs import SyncTrigger, read_sync_runs
from morai.ledger.fills import read_fills
from morai.settings import get_settings
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TxFakeSchwabAuth

pytestmark = pytest.mark.db

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)
_STR: TypeAdapter[str] = TypeAdapter(str)


@pytest.fixture(autouse=True)
def disable_periodic_fanout() -> Generator[None, None, None]:
    """Same reasoning and shape as `tests/ingest/test_sync_runs.py`'s own
    fixture of this name -- see that module's docstring."""
    key = ("sync_all_connected_users", "")
    task = worker_app.app.periodic_registry.periodic_tasks.pop(  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]  # why: vendor's PeriodicTask value type is unparameterized (D-06), same suppression tests/ingest/test_fanout.py already carries.
        key
    )
    try:
        yield
    finally:
        worker_app.app.periodic_registry.periodic_tasks[key] = task  # pyright: ignore[reportUnknownMemberType]  # why: see the pop() call above -- same unparameterized vendor type.


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `tests/ingest/test_sync_runs.py::_seed_connection`."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": str(user_id)},
            created_at=_TOKEN_CREATED_AT,
        ),
        account_hash="fake-account-hash",
    )
    await superuser_db_session.commit()


async def _drain_sync_user_jobs() -> None:
    """Drains whatever `sync_user` jobs are currently queued through the
    real, consuming `worker.app.app` -- mirrors
    `tests/ingest/test_sync_tracer.py`'s own bounded `run_worker_async`
    pattern. The route defers through a separate, deferral-only `App`
    instance (`api/job_queue.app`), but both point at the same Postgres
    `procrastinate_jobs` table -- draining is a property of the row, not
    of which `App` object deferred it."""
    async with app.open_async():
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)


async def test_sync_route_defers_sync_user_with_the_manual_trigger(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A connected, authenticated user's `POST /schwab/sync` defers exactly
    one `sync_user` job for their own id, carrying the manual trigger, and
    returns a body naming neither a job id nor any vendor detail. Draining
    that job runs the same ingest path the scheduled tick runs, and the
    resulting `sync_runs` row carries the manual trigger value."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    response = await logged_in_client.post("/schwab/sync")
    assert response.status_code == 200
    assert response.json() == {}

    async with app.open_async():
        jobs = await app.job_manager.list_jobs_async(task="sync_user")
    matching = [
        job
        for job in jobs
        if _STR.validate_python(job.task_kwargs["user_id"]) == str(user_id)
    ]
    assert len(matching) == 1
    assert matching[0].task_kwargs.get("trigger") == SyncTrigger.MANUAL.value

    await _drain_sync_user_jobs()

    await app_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    runs = await read_sync_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    assert runs[0].trigger == SyncTrigger.MANUAL


async def test_sync_route_404s_for_a_user_with_no_connection(
    clean_ingest_tables: None,
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
) -> None:
    """No `schwab_connections` row: 404, and nothing deferred."""
    response = await logged_in_client.post("/schwab/sync")
    assert response.status_code == 404

    # `procrastinate_jobs` accumulates across the whole test session and is
    # not truncated by any fixture here (test_fanout.py's own convention)
    # -- filtered to this user's own id, not asserted empty outright.
    async with app.open_async():
        jobs = await app.job_manager.list_jobs_async(task="sync_user")
    matching = [
        job
        for job in jobs
        if _STR.validate_python(job.task_kwargs["user_id"])
        == str(provisioned_users.user_a)
    ]
    assert matching == []


async def test_sync_route_rejects_an_unauthenticated_call(
    clean_ingest_tables: None,
) -> None:
    """The same rejection every other protected route gives an
    unauthenticated caller."""
    from morai.api.app import app as fastapi_app
    from httpx import ASGITransport

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/schwab/sync")
    assert response.status_code == 401


async def test_second_call_inside_cooldown_is_rejected_and_defers_nothing(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The cooldown is read off the caller's most recent completed
    `sync_runs` row, so this drains the first call's job before making the
    second -- inside the default (non-zero) cooldown, that second call
    gets 429 and defers nothing further -- only the first call's own job
    exists afterwards."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    first = await logged_in_client.post("/schwab/sync")
    assert first.status_code == 200
    await _drain_sync_user_jobs()

    second = await logged_in_client.post("/schwab/sync")
    assert second.status_code == 429

    async with app.open_async():
        jobs = await app.job_manager.list_jobs_async(task="sync_user")
    matching = [
        job
        for job in jobs
        if _STR.validate_python(job.task_kwargs["user_id"]) == str(user_id)
    ]
    assert len(matching) == 1


async def test_repeated_manual_resync_outside_the_cooldown_is_safe(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With the cooldown set to zero for this test, two full
    trigger-and-drain cycles leave the fills and broker-transaction row
    counts unchanged after the first -- repeated manual re-sync changes
    nothing past the first successful write (idempotent per-window writes,
    INGEST-03)."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    monkeypatch.setattr(get_settings(), "schwab_sync_cooldown_seconds", 0)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    first = await logged_in_client.post("/schwab/sync")
    assert first.status_code == 200
    await _drain_sync_user_jobs()

    await app_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    fills_after_first = await read_fills(app_db_session, user_id)
    tx_after_first = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).all()

    second = await logged_in_client.post("/schwab/sync")
    assert second.status_code == 200
    await _drain_sync_user_jobs()

    app_db_session.expire_all()
    fills_after_second = await read_fills(app_db_session, user_id)
    tx_after_second = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).all()
    assert len(fills_after_second) == len(fills_after_first)
    assert len(tx_after_second) == len(tx_after_first)


async def test_deferral_connection_role_is_morai_app_not_superuser() -> None:
    """The claim that the web process holds no superuser Procrastinate
    connection is worth an assertion, not only a comment (task 2's own
    action text)."""
    async with job_queue_app.open_async():
        row = await job_queue_app.connector.execute_query_one_async(
            "SELECT current_user"
        )
    assert _STR.validate_python(row["current_user"]) == "morai_app"
