"""Tests for the worker process (D-13, OPS-04): its own psycopg v3 pool, and one
periodic heartbeat task.

The first three assertions below need no database -- import-and-inspect checks on
the module-level `App`, run everywhere. The last one drives a real Postgres
through the worker's own pool and is `@pytest.mark.db`, run only in CI's
`test-pytest` job -- there is no local database (Docker's daemon is broken here,
Railway's Postgres is private-network-only).
"""

from __future__ import annotations

import asyncio
import logging
import time

import procrastinate
import pytest
from procrastinate import periodic
from procrastinate.jobs import Status

from morai.settings import Settings
from morai.worker.app import app


def test_connector_is_psycopg() -> None:
    """The one Procrastinate connector that is both async and able to run a
    worker -- no `asyncpg` connector exists (01-RESEARCH.md's connector table)."""
    assert isinstance(app.connector, procrastinate.PsycopgConnector)


def test_heartbeat_is_registered_as_a_periodic_task() -> None:
    """A cron-scheduled task, not a job the web process enqueues -- Phase 1's
    scope per D-13. Registered on the app's own `periodic_registry`, keyed by
    (task name, periodic id); this project uses no periodic id."""
    # `PeriodicRegistry.periodic_tasks` is a bare `dict[tuple[str, str],
    # PeriodicTask]` in procrastinate/periodic.py -- an unparameterized generic
    # in the vendor's own source, confirmed by reading it, not this file's doing.
    periodic_task = app.periodic_registry.periodic_tasks[("heartbeat", "")]  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]  # why: vendor's PeriodicTask value type is unparameterized (D-06)
    assert periodic_task.cron == "* * * * *"


async def test_the_suite_neutralises_procrastinates_periodic_deferrer() -> None:
    """`tests/conftest.py::no_periodic_deferrer` keeps Procrastinate's periodic
    deferrer from ever running inside a test. This is the check that it still does.

    Both periodic tasks registered above live on the module-level `app` that every
    worker-driving test drains with `app.run_worker_async(wait=False)` -- eight test
    files do. The deferrer fires on its *first* pass, not only on a minute boundary:
    `PeriodicDeferrer.get_timestamps` with no prior defer yields the *previous* cron
    tick whenever that tick is inside `MAX_DELAY` (600s), which for a `* * * * *`
    cron it always is. Across runs only `procrastinate_periodic_defers`' unique
    constraint suppresses the repeat, which is why the contamination was
    intermittent rather than constant.

    Left alone, then, a worker-driving test fans out a real `sync_all_connected_users`
    -> `sync_user` chain for whatever connection it just seeded, through whatever
    seam it just monkeypatched. That is exactly how
    `tests/ingest/test_snapshot_capture.py::test_expired_connection_writes_gap`
    intermittently observed a vendor client built by a task it never invoked.

    The registrations themselves stay intact -- the two tests above still read the
    live registry, not a snapshot. Only the deferrer's loop is disabled.
    """
    deferrer = periodic.PeriodicDeferrer(registry=app.periodic_registry)

    await asyncio.wait_for(deferrer.worker(), timeout=5)

    assert deferrer.last_defers == {}


def test_settings_expose_a_single_database_url() -> None:
    """The connector is built from `settings.sync_dsn`, and no second database
    environment variable exists for the worker -- `Settings` (`extra="forbid"`)
    declares exactly one DSN field, the same one the web process's `async_dsn`
    derives from.

    Phase 2 adds a second connection *identity* without adding a second DSN
    *field*: `app_async_dsn` composes the web process's app-role connection
    from this same `database_url`'s host plus a new credential field
    (`morai_app_db_password`), which contains none of "database"/"dsn"/
    "postgres" and so does not appear in `dsn_fields` below. "Exactly one DSN
    field" is still true and still means what it says -- it does not mean
    "exactly one connection identity" now that the web process runs as
    `morai_app` while this worker (and Alembic) still runs as the superuser
    role named by `database_url` directly."""
    dsn_fields = [
        name
        for name in Settings.model_fields
        if "database" in name or "dsn" in name or "postgres" in name
    ]
    assert dsn_fields == ["database_url"]


class _CollectingHandler(logging.Handler):
    """Attached directly to `morai.worker.app`'s own logger, not the root
    logger -- `pytest`'s `caplog` relies on a handler at root, and this
    session's `migrated_db` fixture (exercised by `test_money_roundtrip.py`,
    collected first) runs Alembic, whose `env.py` calls
    `logging.config.fileConfig(alembic.ini)`. `fileConfig`'s default
    `disable_existing_loggers=True` disables every already-instantiated
    logger not named in that ini (measured this session: it silently zeroed
    `caplog.records` here) and resets root's level to `alembic.ini`'s
    `WARNING`, which this logger would otherwise inherit. Attaching straight
    to the logger and resetting its own state below bypasses both."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@pytest.mark.db
async def test_heartbeat_defers_and_reaches_succeeded() -> None:
    """Defers the heartbeat by name (`App.configure_task`, not the periodic
    decorator's own narrowed type -- the decorator strips `timestamp` from the
    public signature since the periodic deferrer injects it at schedule time),
    confirms the deferred row starts `todo`, then runs the worker bounded by
    `wait=False` (stop once caught up) plus an outer `asyncio.wait_for` timeout,
    so a dequeue failure fails the test rather than hanging CI. Confirms the
    terminal status is `succeeded` and that the task logged its run."""
    worker_logger = logging.getLogger("morai.worker.app")
    handler = _CollectingHandler()
    worker_logger.addHandler(handler)
    worker_logger.disabled = False
    worker_logger.setLevel(logging.INFO)

    try:
        async with app.open_async():
            job_id = await app.configure_task("heartbeat").defer_async(
                timestamp=int(time.time())
            )

            status_before = await app.job_manager.get_job_status_async(job_id)
            assert status_before is Status.TODO

            await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)

            status_after = await app.job_manager.get_job_status_async(job_id)
            assert status_after is Status.SUCCEEDED
    finally:
        worker_logger.removeHandler(handler)

    assert any(msg.startswith("heartbeat run at ") for msg in handler.messages)
