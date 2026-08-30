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


def test_settings_expose_a_single_database_url() -> None:
    """The connector is built from `settings.sync_dsn`, and no second database
    environment variable exists for the worker -- `Settings` (`extra="forbid"`)
    declares exactly one DSN field, the same one the web process's `async_dsn`
    derives from."""
    assert list(Settings.model_fields) == ["database_url"]


@pytest.mark.db
async def test_heartbeat_defers_and_reaches_succeeded(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Defers the heartbeat by name (`App.configure_task`, not the periodic
    decorator's own narrowed type -- the decorator strips `timestamp` from the
    public signature since the periodic deferrer injects it at schedule time),
    confirms the deferred row starts `todo`, then runs the worker bounded by
    `wait=False` (stop once caught up) plus an outer `asyncio.wait_for` timeout,
    so a dequeue failure fails the test rather than hanging CI. Confirms the
    terminal status is `succeeded` and that the task logged its run."""
    async with app.open_async():
        job_id = await app.configure_task("heartbeat").defer_async(
            timestamp=int(time.time())
        )

        status_before = await app.job_manager.get_job_status_async(job_id)
        assert status_before is Status.TODO

        with caplog.at_level(logging.INFO, logger="morai.worker.app"):
            await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)

        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    assert any(
        record.getMessage().startswith("heartbeat run at ") for record in caplog.records
    )
