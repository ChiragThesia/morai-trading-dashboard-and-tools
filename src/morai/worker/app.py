"""The worker process (D-13, OPS-04): its own psycopg v3 pool, and one periodic
heartbeat task.

Procrastinate ships five connectors and no `asyncpg` one. `PsycopgConnector`
(psycopg v3) is the only one that is both async and able to run a worker -- the
others are synchronous, defer-only, or both (01-RESEARCH.md's connector table).
This process therefore holds its own connection pool, entirely separate from the
web process's SQLAlchemy/asyncpg `AsyncEngine` (`morai.db.session.get_engine`):
two pools against one Postgres connection ceiling (`NN-28`), each its own budget
line, not a shared one. The web process gets no Procrastinate connector this
phase -- nothing defers a job from a request yet.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import procrastinate

from morai.settings import get_settings

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
    """Logs its own run and returns. No table of its own -- `gate_money_probe`
    is the only table Phase 1 creates (D-13); this task's durable evidence is
    its own row in `procrastinate_jobs`."""
    logger.info("heartbeat run at %s", datetime.now(UTC).isoformat())
