"""Task 1 (06-03-PLAN.md): the sync record -- what ran, what landed, what
errored, and a failure that survives the ingest transaction's rollback
(INGEST-06).

`@pytest.mark.db` throughout -- every test that reaches `sync_user_task`
defers it onto the real `worker.app.app` and drains it with a real
Procrastinate worker run, the same bounded `run_worker_async(wait=False)`
pattern `tests/ingest/test_sync_tracer.py` already establishes. This is not
incidental: the two-session failure-record split lives in the worker
wrapper itself (`sync_user_task`), not in `morai.ingest.schwab_sync.sync_user`,
so only a real task run exercises it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import HTTPStatusError, Request, Response
from procrastinate.jobs import Status
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.db.models import BrokerTransaction, SchwabConnection
from morai.ingest.sync_runs import (
    SyncError,
    SyncStatus,
    SyncTrigger,
    classify_sync_error,
    read_sync_runs,
)
from morai.ledger.fills import read_fills
from morai.vendor.connections import ConnectionNotFound, upsert_connection
from morai.vendor.protocol import ExchangedToken
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TX_PAYLOAD, TxFakeSchwabAuth

pytestmark = pytest.mark.db

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture(autouse=True)
def disable_periodic_fanout() -> Generator[None, None, None]:
    """`run_worker_async` always starts Procrastinate's own periodic
    deferrer as a side task, and that deferrer immediately catches up any
    periodic task due for the current tick
    (`procrastinate.periodic.PeriodicDeferrer.worker`) -- including this
    project's own `sync_all_connected_users`, cron `* * * * *`. Left
    running, every `_drain` call in this module would risk an ambient,
    uncontrolled `sync_user` job for whichever user this test has already
    connected, silently doubling this file's own exact-row-count
    assertions. `tests/ingest/test_fanout.py` sidesteps the same
    interaction by calling `sync_all_connected_users` directly rather than
    through the periodic mechanism; this module instead removes the
    periodic registration for its own duration and restores it after --
    the `heartbeat` periodic task is left alone, since nothing here reads
    its output."""
    key = ("sync_all_connected_users", "")
    task = worker_app.app.periodic_registry.periodic_tasks.pop(  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]  # why: vendor's PeriodicTask value type is unparameterized (D-06), same suppression tests/ingest/test_fanout.py already carries.
        key
    )
    try:
        yield
    finally:
        worker_app.app.periodic_registry.periodic_tasks[key] = task  # pyright: ignore[reportUnknownMemberType]  # why: see the pop() call above -- same unparameterized vendor type.


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Seeds one connection row through `upsert_connection`, the real
    write path -- mirrors `tests/ingest/test_sync_tracer.py::_seed_connection`
    exactly (D3-14's own discipline: never a test-only fast path)."""
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


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- mirrors
    `tests/test_isolation.py::_set_current_user`."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _drain(user_id: UUID) -> Status:
    """Defers `sync_user` by name onto the real `worker.app.app` and drains
    it with a bounded `run_worker_async(wait=False)` under an outer
    timeout, mirroring `test_sync_tracer.py`'s own pattern -- returns the
    job's final status."""
    async with app.open_async():
        job_id = await app.configure_task("sync_user").defer_async(user_id=str(user_id))
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)
    assert status is not None
    return status


async def test_successful_sync_writes_one_run_row_and_sets_last_synced_at(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful `sync_user` leaves exactly one `sync_runs` row: started
    at or before finished, the scheduled trigger, succeeded status, both
    landed counts matching the tracer payload, and a null error code.
    `last_synced_at` is null before this run and equals the run's own
    `started_at` afterwards."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    await _set_current_user(app_db_session, user_id)
    connection_before = (
        await app_db_session.execute(
            select(SchwabConnection).where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one()
    assert connection_before.last_synced_at is None

    status = await _drain(user_id)
    assert status is Status.SUCCEEDED

    runs = await read_sync_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.started_at <= run.finished_at
    assert run.trigger == SyncTrigger.SCHEDULED
    assert run.status == SyncStatus.SUCCEEDED
    assert run.broker_transactions_landed == 1
    assert run.fills_landed == 2
    assert run.error_code is None

    # `connection_before` was loaded into this session's identity map; the
    # write that follows happens on a different session (the worker's
    # own), so a second SELECT here would return the same cached object
    # unless the map is expired first.
    app_db_session.expire_all()
    connection_after = (
        await app_db_session.execute(
            select(SchwabConnection).where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one()
    assert connection_after.last_synced_at == run.started_at


async def test_missing_connection_fails_and_writes_a_classified_run_row(
    clean_ingest_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No `schwab_connections` row for this user: `ConnectionNotFound`
    propagates out of `sync_user`, the job fails, and the failed run row
    carries null counts and the `connection_not_found` code -- written on
    the second, fresh session, since the ingest session never opened a
    transaction with anything to roll back."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a

    status = await _drain(user_id)
    assert status is Status.FAILED

    await _set_current_user(app_db_session, user_id)
    runs = await read_sync_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == SyncStatus.FAILED
    assert run.fills_landed is None
    assert run.broker_transactions_landed is None
    assert run.error_code == SyncError.CONNECTION_NOT_FOUND


async def test_failure_mid_backfill_rolls_back_all_writes_but_keeps_the_run_row(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The important one. A freshly-connected user (`last_synced_at` null)
    backfills across several windows; the first window's writes land
    inside the ingest transaction, then the second window's vendor call
    raises. The whole transaction rolls back -- no fills, no broker
    transactions and no `last_synced_at` change survive the first window's
    writes either -- and the failed `sync_runs` row, written on a second,
    fresh session after that rollback, is exactly what does survive."""
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    failing_auth = TxFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        transactions=TX_PAYLOAD,
        fail_on_call=1,
        fail_exception=RuntimeError("simulated mid-backfill vendor failure"),
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: failing_auth)

    status = await _drain(user_id)
    assert status is Status.FAILED

    await _set_current_user(app_db_session, user_id)

    fills = await read_fills(app_db_session, user_id)
    assert fills == []
    tx_rows = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).all()
    assert tx_rows == []

    connection = (
        await app_db_session.execute(
            select(SchwabConnection).where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one()
    assert connection.last_synced_at is None

    runs = await read_sync_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    assert runs[0].status == SyncStatus.FAILED
    assert runs[0].fills_landed is None
    assert runs[0].broker_transactions_landed is None
    assert runs[0].error_code == SyncError.UNKNOWN
    # Proves the fake actually reached a second window before raising --
    # otherwise this test would pass for the wrong reason (nothing to roll
    # back at all, the same shape the missing-connection test above already
    # covers).
    assert failing_auth.last_client is not None
    assert len(failing_auth.last_client.windows_by_call) >= 2


class _StatusOnly(BaseModel):
    a: int


def test_classify_sync_error_maps_five_distinct_classes() -> None:
    """Distinct failure classes produce distinct codes: a missing
    connection, an authorisation failure, a rate-limited response, an
    unparseable payload and anything unrecognised are five different
    values, not one -- and every branch returns a member of the enum."""
    request = Request("GET", "https://api.schwabapi.com/trader/v1/accounts")

    def _status_error(status_code: int) -> HTTPStatusError:
        response = Response(status_code, request=request)
        return HTTPStatusError("vendor error", request=request, response=response)

    try:
        _StatusOnly.model_validate({"a": "not-an-int"})
        validation_error: ValidationError | None = None
    except ValidationError as exc:
        validation_error = exc
    assert validation_error is not None

    codes = {
        classify_sync_error(ConnectionNotFound("no connection")),
        classify_sync_error(_status_error(401)),
        classify_sync_error(_status_error(429)),
        classify_sync_error(validation_error),
        classify_sync_error(RuntimeError("something this module has never seen")),
    }
    assert codes == {
        SyncError.CONNECTION_NOT_FOUND,
        SyncError.VENDOR_AUTH_FAILED,
        SyncError.VENDOR_RATE_LIMITED,
        SyncError.VENDOR_PAYLOAD_UNPARSEABLE,
        SyncError.UNKNOWN,
    }


async def test_second_failed_sync_leaves_first_syncs_state_untouched_and_leaks_no_token(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful first sync, then a second that fails with a vendor
    exception whose message embeds a token-shaped string. The second
    failure changes neither the landed row counts nor `last_synced_at`
    from what the first run established, and that distinctive string
    appears in no column of either stored row (`NN-34`)."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    first_status = await _drain(user_id)
    assert first_status is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    first_run = (await read_sync_runs(app_db_session, user_id, limit=10))[0]
    fills_after_first = await read_fills(app_db_session, user_id)
    tx_after_first = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).all()

    secret = "token-shaped-secret-ABCDEF123456"
    failing_auth = TxFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        transactions=TX_PAYLOAD,
        fail_on_call=0,
        fail_exception=RuntimeError(f"vendor error, refresh_token={secret}"),
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: failing_auth)

    second_status = await _drain(user_id)
    assert second_status is Status.FAILED

    await _set_current_user(app_db_session, user_id)
    connection = (
        await app_db_session.execute(
            select(SchwabConnection).where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one()
    assert connection.last_synced_at == first_run.started_at

    fills_after_second = await read_fills(app_db_session, user_id)
    tx_after_second = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).all()
    assert len(fills_after_second) == len(fills_after_first)
    assert len(tx_after_second) == len(tx_after_first)

    runs = await read_sync_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 2
    latest, earlier = runs[0], runs[1]
    assert latest.status == SyncStatus.FAILED
    assert latest.error_code == SyncError.UNKNOWN
    assert earlier.id == first_run.id

    for row_text in (
        str(latest.error_code),
        str(latest.trigger),
        str(latest.status),
        str(latest.fills_landed),
        str(latest.broker_transactions_landed),
    ):
        assert secret not in row_text


async def test_user_reads_only_their_own_sync_runs_with_superuser_positive_control(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A user reading `sync_runs` under their own RLS context sees only
    their own rows -- proved with a superuser positive control confirming
    the other user's rows genuinely exist, the same bracketed shape
    `tests/test_isolation.py` uses throughout."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_a = provisioned_users.user_a
    user_b = provisioned_users.user_b
    await _seed_connection(superuser_db_session, user_a)
    await _seed_connection(superuser_db_session, user_b)

    status_a = await _drain(user_a)
    status_b = await _drain(user_b)
    assert status_a is Status.SUCCEEDED
    assert status_b is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_a)
    as_user_a = await read_sync_runs(app_db_session, user_a, limit=10)
    assert len(as_user_a) == 1
    assert {run.user_id for run in as_user_a} == {user_a}

    await _set_current_user(superuser_db_session, user_a)
    all_rows = (
        await superuser_db_session.execute(text("SELECT user_id FROM sync_runs"))
    ).all()
    owners = {row[0] for row in all_rows}
    assert {user_a, user_b} <= owners
