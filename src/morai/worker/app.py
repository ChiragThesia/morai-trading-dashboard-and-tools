"""The worker process (D-13, OPS-04): its own psycopg v3 pool, one periodic
heartbeat task, and (Phase 6) the per-user Schwab ingest job.

Procrastinate ships five connectors and no `asyncpg` one. `PsycopgConnector`
(psycopg v3) is the only one that is both async and able to run a worker -- the
others are synchronous, defer-only, or both (01-RESEARCH.md's connector table).
This process therefore holds its own connection pool, entirely separate from the
web process's SQLAlchemy/asyncpg `AsyncEngine` (`morai.db.session.get_engine`).
The web process gets no Procrastinate connector this phase -- nothing defers a
job from a request yet.

**Three pools now, not two, against one Postgres connection ceiling (`NN-28`),
each its own budget line.** `sync_user_task` below opens its own session from
`morai.db.session.get_app_engine` -- the same pool the web process's
`get_db_session` dependency uses, connected as `morai_app` (`NOSUPERUSER
NOBYPASSRLS`) rather than this module's own superuser Procrastinate pool.
Reused deliberately, not duplicated into a fourth engine factory:
`get_app_engine`'s five-plus-five sizing was chosen for a web process serving
concurrent requests, and this worker runs jobs strictly serially at
Procrastinate's own default `concurrency=1` (verified against the installed
3.9.0 package, 06-RESEARCH.md), so that sizing is larger than the worker
needs -- an honest oversize, recorded here rather than re-tuned without a
measured reason to.

**This is the security finding Phase 6 exists to close.** Before this phase,
an ingest job writing user-scoped rows over this module's own superuser
Procrastinate pool would have made every RLS policy in the system inert for
exactly those rows, silently. `sync_user_task` routes its session through
`get_app_engine()` instead and calls `assert_connection_cannot_bypass_rls` on
it before touching a protected table -- a real call in the code path, not a
comment and not a test-only check.

**The worker service now requires `MORAI_APP_DB_PASSWORD`, which it did not
before.** `get_app_engine()` raises at first use if
`Settings.morai_app_db_password` is unset -- declared as `user_setup` in plan
06-01's own frontmatter, not assumed.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

import procrastinate
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SchwabConnection
from morai.db.session import get_engine, get_session_maker
from morai.identity.rls import assert_connection_cannot_bypass_rls
from morai.ingest.schwab_sync import (
    sync_all_connected_users as run_sync_all_connected_users,
)
from morai.ingest.schwab_sync import sync_user as run_sync_user
from morai.ingest.snapshots import (
    capture_all_connected_users as run_capture_all_connected_users,
)
from morai.ingest.snapshots import capture_user_snapshot as run_capture_user_snapshot
from morai.ingest.snapshots import rth_slot_for
from morai.ingest.sync_runs import (
    SyncStatus,
    SyncTrigger,
    classify_sync_error,
    record_sync_run,
)
from morai.settings import get_settings
from morai.vendor.protocol import SchwabAuth
from morai.vendor.schwab_adapter import SchwabAuthAdapter

logger = logging.getLogger(__name__)

# Capped explicitly rather than taking psycopg_pool's own default (min_size=4,
# and max_size=None resolves to min_size) -- this pool is its own line in the
# connection-ceiling budget (NN-28), separate from the web process's asyncpg
# pool. One worker running one heartbeat task needs at most a couple of
# connections; raise this only alongside an explicit accounting of the combined
# ceiling against Postgres's own connection limit.
app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(
        conninfo=get_settings().sync_dsn, min_size=1, max_size=2
    )
)


@app.periodic(cron="* * * * *")  # Phase 1's own heartbeat cadence, not the
# 30-minute RTH cadence Phases 6 and 8 own -- the execution model behind that
# real cadence is Phase 6's owned spike; this cron is not a preview of it.
@app.task(name="heartbeat")
async def heartbeat(timestamp: int) -> None:
    """Logs its own run and returns. No table of its own -- this task's
    durable evidence is its own row in `procrastinate_jobs`."""
    logger.info("heartbeat run at %s", datetime.now(UTC).isoformat())


@app.periodic(cron="* * * * *")  # Phase 1's own heartbeat cadence, not the
# 30-minute RTH cadence Phases 6 and 8 own (D6-01) -- the execution model
# behind that real cadence is settled here; a one-minute cron on it is a
# placeholder cadence on a settled model, not a preview of the real one.
@app.task(name="sync_all_connected_users")
async def sync_all_connected_users_task(timestamp: int) -> None:
    """Fans out one `sync_user` job per connected user, every tick (D6-01).

    Opens its own session on the superuser engine (`get_engine()`), not
    `get_session_maker()`'s `morai_app` role -- `sync_all_connected_users`'s
    own docstring explains why this one cross-tenant read is the one place
    in the ingest path where that is correct. Every job it defers then
    runs under `sync_user_task`'s own `morai_app` session and that user's
    own RLS context, where the isolation this phase exists to prove
    actually lives.
    """
    async with AsyncSession(get_engine()) as session:
        await run_sync_all_connected_users(session)
        await session.commit()


@app.periodic(cron="0,30 * * * *")
@app.task(name="capture_all_connected_users")
async def capture_all_connected_users_task(timestamp: int) -> None:
    """Fires every thirty minutes in UTC, on every day (D8-06) -- Eastern
    RTH membership is the *runtime* filter, computed by `rth_slot_for`
    below, because a cron expression carrying its own hour range drifts an
    hour twice a year. A tick outside the grid returns immediately: it
    defers nothing and writes nothing, not even a `snapshot_runs` row,
    because it was never a slot to begin with (D8-05).

    Honest ceiling, read directly from the installed `procrastinate` 3.9.0
    source (`periodic.py`'s own `MAX_DELAY = 60 * 10`): a worker down for
    more than ten minutes across a slot boundary produces **no job at all**
    for that slot, not even a gap-writing one -- Procrastinate never gives
    this task a chance to run for it. That hole is invisible in
    `snapshot_observations`/`snapshot_marks` and visible only in
    `snapshot_runs` (plan 08-04's own table), named here so a reader meets
    the gap where the mechanism lives, not only in a research doc.

    Opens its own session on the superuser engine, exactly as
    `sync_all_connected_users_task` does -- see that task's own docstring
    for why this one cross-tenant read is correct.
    """
    moment = datetime.fromtimestamp(timestamp, tz=UTC)
    slot = rth_slot_for(moment)
    if slot is None:
        return
    async with AsyncSession(get_engine()) as session:
        await run_capture_all_connected_users(session, slot_time=slot)
        await session.commit()


def get_schwab_auth() -> SchwabAuth:
    """The real adapter in production; `tests/ingest/test_sync_tracer.py`
    monkeypatches this module-level function with a `Protocol` fake --
    zero network calls in this plan's own test suite (D4-05, D4-14).
    Mirrors `api/routes_connections.py::get_schwab_auth`'s identical seam,
    the closest thing this worker process has to FastAPI's
    `dependency_overrides` -- Procrastinate tasks are plain functions with
    no injectable-dependency framework of their own."""
    return SchwabAuthAdapter(get_settings().schwab_credentials)


@app.task(name="sync_user")
async def sync_user_task(
    user_id: str, *, trigger: str = SyncTrigger.SCHEDULED.value
) -> None:
    """Pulls one connected user's raw Schwab transactions and lands them
    in `broker_transactions` and `fills` (Phase 6, D6-01), and records a
    `sync_runs` row for the attempt either way (INGEST-06).

    Opens one session from `get_session_maker()` -- `morai_app`, not this
    module's own superuser Procrastinate pool -- and calls
    `assert_connection_cannot_bypass_rls` on it before touching a
    protected table (see this module's own docstring: this call is the
    whole security finding this phase exists to close).

    `trigger` defaults to the scheduled value, so the periodic fan-out's
    own `defer_async(user_id=...)` call needs no change. `POST
    /schwab/sync` (task 2) passes `trigger=SyncTrigger.MANUAL.value`
    through this same task, so no second writer into `sync_runs` ever
    comes into existence.

    A failure record written inside the transaction that failed rolls
    back with it -- that is the whole reason this function is not a
    single `try`/`except` around one session. On success, the run row and
    the `last_synced_at` update are written and committed on the same
    session the ingest itself used, one transaction. On failure, that
    session is rolled back first, then a **second, fresh** session records
    the failed run row and commits *that* alone -- so the failure record
    survives the very rollback that erased everything else the run
    attempted. `now=started_at`, not the finish time, both for the ingest
    window boundary and for `last_synced_at`: a fill executed while the
    vendor call was in flight then falls inside the next window rather
    than between two. After recording, this function re-raises so
    Procrastinate still marks the job `failed` -- swallowing the exception
    would make `procrastinate_jobs` disagree with `sync_runs` about what
    happened.
    """
    started_at = datetime.now(UTC)
    sync_trigger = SyncTrigger(trigger)
    session_maker = get_session_maker()
    async with session_maker() as session:
        await assert_connection_cannot_bypass_rls(session)
        try:
            outcome = await run_sync_user(
                session, UUID(user_id), auth=get_schwab_auth(), now=started_at
            )
        except Exception as exc:
            await session.rollback()
            error_code = classify_sync_error(exc)
            async with session_maker() as failure_session:
                await failure_session.execute(
                    text("SELECT set_config('app.current_user_id', :uid, true)"),
                    {"uid": user_id},
                )
                await record_sync_run(
                    failure_session,
                    UUID(user_id),
                    started_at=started_at,
                    finished_at=datetime.now(UTC),
                    trigger=sync_trigger,
                    status=SyncStatus.FAILED,
                    fills_landed=None,
                    broker_transactions_landed=None,
                    error_code=error_code,
                )
                await failure_session.commit()
            raise
        await record_sync_run(
            session,
            UUID(user_id),
            started_at=started_at,
            finished_at=datetime.now(UTC),
            trigger=sync_trigger,
            status=SyncStatus.SUCCEEDED,
            fills_landed=outcome.fills_landed,
            broker_transactions_landed=outcome.broker_transactions_landed,
            error_code=None,
        )
        await session.execute(
            update(SchwabConnection)
            .where(SchwabConnection.user_id == UUID(user_id))
            .values(last_synced_at=started_at)
        )
        await session.commit()


@app.task(name="snapshot_user")
async def snapshot_user_task(
    user_id: str, slot_time: str, *, trigger: str = "scheduled"
) -> None:
    """Reprices one connected user's open legs for one RTH slot (Phase 8,
    SNAP-01).

    Opens one session from `get_session_maker()` -- `morai_app`, never
    this module's own superuser Procrastinate pool -- and calls
    `assert_connection_cannot_bypass_rls` on it before touching a
    protected table, mirroring `sync_user_task`'s own call exactly (this
    module's own docstring: the whole security finding Phase 6 exists to
    close). `capture_user_snapshot` itself sets `app.current_user_id` as
    its first action, the same split `sync_user`/`sync_user_task` already
    use.

    `observed_at` is read once here, at task start, and threaded through
    to `capture_user_snapshot` -- never read again inside the shell, so
    every leg in one run shares one wall-clock reading. Does not swallow
    exceptions: a raised error propagates so `procrastinate_jobs` and this
    phase's own data agree, the same discipline `sync_user_task` already
    follows.

    `trigger` is accepted but not yet recorded anywhere -- the
    `snapshot_runs` row this parameter is for is plan 08-04's own scope
    (D8-15); this task is deliberately incomplete on that axis for now,
    named here rather than left silent.
    """
    observed_at = datetime.now(UTC)
    parsed_slot_time = datetime.fromisoformat(slot_time)
    session_maker = get_session_maker()
    async with session_maker() as session:
        await assert_connection_cannot_bypass_rls(session)
        await run_capture_user_snapshot(
            session,
            UUID(user_id),
            slot_time=parsed_slot_time,
            observed_at=observed_at,
            auth=get_schwab_auth(),
        )
        await session.commit()
