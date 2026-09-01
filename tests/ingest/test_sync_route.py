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
from morai.api.models_connections import SyncRunResponse
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
_SYNC_RUN_LIST: TypeAdapter[list[SyncRunResponse]] = TypeAdapter(list[SyncRunResponse])


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


# --- Task 3: reading the record -- one user's sync history, and nobody
# else's (INGEST-06). Its own tests below, beside task 2's, per the plan's
# own action text.

_PASSWORD = "correct horse battery staple 4"


async def _login_client(
    superuser_db_session: AsyncSession, user_id: UUID, username: str
) -> AsyncClient:
    """One authenticated `AsyncClient` for either seeded user, mirroring
    `tests/vendor/test_oauth_flow.py::_login_client` exactly -- needed
    here because the isolation test below needs both users logged in at
    once, and `logged_in_client` only ever logs in `user_a`."""
    from httpx import ASGITransport
    from morai.api.app import app as fastapi_app
    from morai.identity.passwords import hash_password
    from morai.db.models import User
    from sqlalchemy import update

    await superuser_db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=hash_password(_PASSWORD))
    )
    await superuser_db_session.commit()

    transport = ASGITransport(app=fastapi_app)
    client = AsyncClient(transport=transport, base_url="http://test")
    login = await client.post(
        "/login", json={"username": username, "password": _PASSWORD}
    )
    assert login.status_code == 200
    client.cookies.set("morai_session", login.cookies["morai_session"])
    return client


async def test_sync_runs_route_returns_the_users_own_history_most_recent_first(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An authenticated user's own runs, most recent first, each carrying
    started, finished, trigger, status, both landed counts and the
    classified error code."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    response = await logged_in_client.post("/schwab/sync")
    assert response.status_code == 200
    await _drain_sync_user_jobs()

    listing = await logged_in_client.get("/schwab/sync-runs")
    assert listing.status_code == 200
    runs = _SYNC_RUN_LIST.validate_json(listing.content)
    assert len(runs) == 1
    run = runs[0]
    assert run.trigger == "manual"
    assert run.status == "succeeded"
    assert run.fills_landed == 2
    assert run.broker_transactions_landed == 1
    assert run.error_code is None


async def test_sync_runs_route_returns_an_empty_list_and_200_for_no_runs(
    clean_ingest_tables: None,
    logged_in_client: AsyncClient,
) -> None:
    """No history is a real answer here, unlike a missing connection --
    `200` and `[]`, never `404`."""
    response = await logged_in_client.get("/schwab/sync-runs")
    assert response.status_code == 200
    assert response.json() == []


async def test_sync_runs_route_serialises_a_failed_runs_counts_as_null(
    clean_ingest_tables: None,
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed run (no connection seeded here) serialises its landed
    counts as JSON `null`, never `0` -- the `NN-16` failure at the API
    boundary, not only at the column. No exception text or vendor payload
    appears anywhere in the body.

    `POST /schwab/sync` itself 404s for a user with no connection (task
    2's own guard) before it ever defers, so a failed run needs the
    scheduled path's own defer directly -- the same shape
    `test_sync_runs.py::test_missing_connection_fails_and_writes_a_classified_run_row`
    already exercises."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a

    async with app.open_async():
        await app.configure_task("sync_user").defer_async(user_id=str(user_id))
    await _drain_sync_user_jobs()

    listing = await logged_in_client.get("/schwab/sync-runs")
    assert listing.status_code == 200
    runs = _SYNC_RUN_LIST.validate_json(listing.content)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == "failed"
    assert run.fills_landed is None
    assert run.broker_transactions_landed is None
    assert run.error_code == "connection_not_found"
    # No vendor payload leaks through: the response carries exactly the
    # fixed schema `SyncRunResponse` declares -- `_SYNC_RUN_LIST.validate_json`
    # above already rejects an unexpected extra field with `extra="forbid"`
    # (`api/models.py::ApiModel`), so parsing successfully is itself part
    # of this proof.
    assert set(run.model_dump().keys()) == {
        "started_at",
        "finished_at",
        "trigger",
        "status",
        "fills_landed",
        "broker_transactions_landed",
        "error_code",
    }


async def test_sync_runs_route_rejects_an_unauthenticated_call(
    clean_ingest_tables: None,
) -> None:
    """The same rejection every other protected route gives."""
    from httpx import ASGITransport
    from morai.api.app import app as fastapi_app

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/schwab/sync-runs")
    assert response.status_code == 401


async def test_sync_runs_route_isolates_users_with_a_superuser_positive_control(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A user sees zero of another user's runs even when the other user
    has several -- proved with a superuser query confirming the other
    user's rows genuinely exist, the same bracketed shape
    `tests/test_isolation.py` uses throughout."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_a = provisioned_users.user_a
    user_b = provisioned_users.user_b
    await _seed_connection(superuser_db_session, user_a)
    await _seed_connection(superuser_db_session, user_b)

    client_a = await _login_client(superuser_db_session, user_a, "user-a")
    client_b = await _login_client(superuser_db_session, user_b, "user-b")
    try:
        response_a = await client_a.post("/schwab/sync")
        assert response_a.status_code == 200
        await _drain_sync_user_jobs()
        response_b = await client_b.post("/schwab/sync")
        assert response_b.status_code == 200
        await _drain_sync_user_jobs()

        listing_a = await client_a.get("/schwab/sync-runs")
        assert listing_a.status_code == 200
        runs_a = _SYNC_RUN_LIST.validate_json(listing_a.content)
        assert len(runs_a) == 1
        assert runs_a[0].trigger == "manual"
    finally:
        await client_a.aclose()
        await client_b.aclose()

    all_rows = (
        await superuser_db_session.execute(text("SELECT user_id FROM sync_runs"))
    ).all()
    owners = {row[0] for row in all_rows}
    assert {user_a, user_b} <= owners
