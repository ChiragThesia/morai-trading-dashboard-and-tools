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

from morai.db.session import get_session_maker
from morai.identity.rls import assert_connection_cannot_bypass_rls
from morai.ingest.schwab_sync import sync_user as run_sync_user
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
async def sync_user_task(user_id: str) -> None:
    """Pulls one connected user's raw Schwab transactions and lands them
    in `broker_transactions` and `fills` (Phase 6, D6-01).

    Opens one session from `get_session_maker()` -- `morai_app`, not this
    module's own superuser Procrastinate pool -- and calls
    `assert_connection_cannot_bypass_rls` on it before touching a
    protected table (see this module's own docstring: this call is the
    whole security finding this phase exists to close). Awaits
    `morai.ingest.schwab_sync.sync_user`, which does not commit and does
    not swallow exceptions -- a raised `ConnectionNotFound` or vendor
    failure propagates here uncaught, so Procrastinate records the job as
    `failed` and this transaction is never committed, leaving no partial
    cycle behind.
    """
    session_maker = get_session_maker()
    async with session_maker() as session:
        await assert_connection_cannot_bypass_rls(session)
        await run_sync_user(
            session, UUID(user_id), auth=get_schwab_auth(), now=datetime.now(UTC)
        )
        await session.commit()
