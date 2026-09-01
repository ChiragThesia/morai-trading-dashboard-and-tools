"""The fan-out and its no-double-fire proof (06-02 Task 1, D6-01, INGEST-01).

One periodic tick defers one `sync_user` job per connected user, and none
for an unconnected one; one user's vendor failure fails only that user's
job; and the `procrastinate_periodic_defers` unique constraint is proved
directly against the installed database, not read from migration 0002.

`@pytest.mark.db` on every DB-backed test -- the first (periodic-registry)
test needs no database at all, matching
`tests/test_worker_heartbeat.py::test_heartbeat_is_registered_as_a_periodic_task`'s
own module-level-only shape.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from procrastinate.jobs import Status
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.ingest.schwab_sync import sync_all_connected_users
from morai.ledger.fills import read_fills
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TX_PAYLOAD, TxFakeSchwabAuth

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)

# `Job.task_kwargs` values type as `JSONValue` (a union), not `Any` --
# `procrastinate/types.py`'s own alias. `TypeAdapter` narrows it (D-06).
_STR: TypeAdapter[str] = TypeAdapter(str)


def test_sync_all_connected_users_is_registered_as_a_periodic_task() -> None:
    """Registered on the app's own periodic registry under its own name,
    alongside the existing heartbeat -- neither displaces the other.
    Mirrors `test_worker_heartbeat.py::test_heartbeat_is_registered_as_a_periodic_task`
    exactly."""
    fanout_task = app.periodic_registry.periodic_tasks[  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]  # why: vendor's PeriodicTask value type is unparameterized (D-06), same suppression test_worker_heartbeat.py already carries.
        ("sync_all_connected_users", "")
    ]
    assert fanout_task.cron == "* * * * *"
    heartbeat_task = app.periodic_registry.periodic_tasks[("heartbeat", "")]  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]  # why: see above.
    assert heartbeat_task.cron == "* * * * *"


async def _seed_connection(
    superuser_db_session: AsyncSession, user_id: UUID, *, refresh_token: str
) -> None:
    """Seeds one connection row through `upsert_connection`, the real write
    path -- mirrors `test_sync_tracer.py::_seed_connection`, extended with
    an explicit `refresh_token` so the failure-isolation test below can
    select behavior per user through `TxFakeSchwabAuth.responses_by_user_id`
    (see that field's own docstring for why the refresh token, not the user
    id directly, is the channel)."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(token={"refresh_token": refresh_token}, created_at=_TOKEN_CREATED_AT),
        account_hash=f"fake-account-hash-{refresh_token}",
    )
    await superuser_db_session.commit()


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


@pytest.mark.db
async def test_fan_out_defers_one_job_per_connected_user_and_none_for_the_unconnected_third(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Behavior 1: `seeded_users` gives three users (`user_a`, `user_b`,
    `admin`) -- only `user_a`/`user_b` get a `schwab_connections` row here,
    `admin` gets none."""
    await _seed_connection(
        superuser_db_session, provisioned_users.user_a, refresh_token="fake-refresh-user-a"
    )
    await _seed_connection(
        superuser_db_session, provisioned_users.user_b, refresh_token="fake-refresh-user-b"
    )

    async with app.open_async():
        deferred = await sync_all_connected_users(superuser_db_session)
        jobs = await app.job_manager.list_jobs_async(task="sync_user")

    assert set(deferred) == {provisioned_users.user_a, provisioned_users.user_b}

    # Secondary confirmation that the deferral actually reached Procrastinate's
    # own queue, not just this function's return value -- a subset check, not
    # an equality check, since `procrastinate_jobs` accumulates across the
    # whole test session and is not truncated by any fixture here (it is
    # Procrastinate's own internal schema, not this project's app schema).
    job_user_ids = {_STR.validate_python(job.task_kwargs["user_id"]) for job in jobs}
    assert {str(provisioned_users.user_a), str(provisioned_users.user_b)} <= job_user_ids
    assert str(provisioned_users.admin) not in job_user_ids


@pytest.mark.db
async def test_fan_out_defers_nothing_with_no_connected_users(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Behavior 2: no `schwab_connections` row at all -- defers nothing,
    raises nothing."""
    async with app.open_async():
        deferred = await sync_all_connected_users(superuser_db_session)

    assert deferred == []


@pytest.mark.db
async def test_one_users_vendor_failure_leaves_the_other_users_job_succeeded_with_rows_landed(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Behavior 3: `user_a`'s vendor call raises, `user_b`'s succeeds and
    its rows land -- one broken token cannot starve the rest (Pitfall 7,
    06-RESEARCH.md; T-06-09)."""
    await _seed_connection(
        superuser_db_session, provisioned_users.user_a, refresh_token=str(provisioned_users.user_a)
    )
    await _seed_connection(
        superuser_db_session, provisioned_users.user_b, refresh_token=str(provisioned_users.user_b)
    )

    failing_auth = TxFakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT,
        account_entries=[],
        transactions=TX_PAYLOAD,
        responses_by_user_id={provisioned_users.user_a: RuntimeError("vendor exploded")},
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: failing_auth)

    async with app.open_async():
        await sync_all_connected_users(superuser_db_session)
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        jobs = await app.job_manager.list_jobs_async(task="sync_user")

    status_by_user = {
        _STR.validate_python(job.task_kwargs["user_id"]): job.status
        for job in jobs
        if _STR.validate_python(job.task_kwargs["user_id"])
        in {str(provisioned_users.user_a), str(provisioned_users.user_b)}
    }
    # `Job.status` (from `list_jobs_async`'s own `Job.from_row`) is the raw
    # DB string, unlike `get_job_status_async`'s `Status(...)`-wrapped
    # return -- compare against `.value`, not the enum member itself.
    assert status_by_user[str(provisioned_users.user_a)] == Status.FAILED.value
    assert status_by_user[str(provisioned_users.user_b)] == Status.SUCCEEDED.value

    await _set_current_user(app_db_session, provisioned_users.user_b)
    records = await read_fills(app_db_session, provisioned_users.user_b)
    assert len(records) == 2


@pytest.mark.db
async def test_periodic_defers_unique_constraint_rejects_duplicate_and_accepts_differing_timestamp(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
) -> None:
    """Behavior 5, D6-01 criterion 1: proved against the installed database
    by a rejected insert, never by reading migration 0002. `periodic_id` is
    a fresh UUID per run -- `procrastinate_periodic_defers` is not part of
    any fixture's truncate list (it is Procrastinate's own internal
    schema, not this project's app schema), so a prior run's committed row
    must never collide with this one."""
    periodic_id = str(uuid4())
    insert_sql = text(
        "INSERT INTO procrastinate_periodic_defers (task_name, periodic_id, defer_timestamp) "
        "VALUES ('sync_all_connected_users', :periodic_id, :defer_timestamp)"
    )
    try:
        await superuser_db_session.execute(
            insert_sql, {"periodic_id": periodic_id, "defer_timestamp": 1000}
        )
        await superuser_db_session.commit()

        with pytest.raises(IntegrityError) as exc_info:
            await superuser_db_session.execute(
                insert_sql, {"periodic_id": periodic_id, "defer_timestamp": 1000}
            )
        # The constraint's own name, quoted -- criterion 1's evidence, not a
        # bare exception type that a future unrelated integrity error could
        # make this test pass for the wrong reason (test_type_gate.py's own
        # discipline for marker names).
        assert "procrastinate_periodic_defers_unique" in str(exc_info.value)
        await superuser_db_session.rollback()

        await superuser_db_session.execute(
            insert_sql, {"periodic_id": periodic_id, "defer_timestamp": 2000}
        )
        await superuser_db_session.commit()
    finally:
        await superuser_db_session.execute(
            text(
                "DELETE FROM procrastinate_periodic_defers WHERE periodic_id = :periodic_id"
            ),
            {"periodic_id": periodic_id},
        )
        await superuser_db_session.commit()
