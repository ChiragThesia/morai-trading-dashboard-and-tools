"""The web process's own deferral-only Procrastinate `App` (task 2,
INGEST-04).

Three things this module's existence is for, stated once, here.

First, this `App` exists to defer and never to consume: `run_worker_async`
is never called from the web process, and a reader who reaches for it here
has misread the design. `morai.worker.app.app` is the consuming `App`, in
the worker process, over its own superuser Procrastinate pool.

Second, it connects as `morai_app` and not as the superuser role
`morai.worker.app.app`'s own connector uses, because a superuser-capable
connection sitting in the web process is the exact backdoor
`morai.db.session.get_app_engine`'s own docstring already says RLS exists
to close. Importing `morai.worker.app` from a route would materialise
exactly that connection -- forbidden for that reason, not a stylistic one.

Third, the connection-pool accounting against `NN-28`. Four pools now,
named, across the two processes:

- Web process, `morai.db.session.get_app_engine()`: `morai_app`,
  `pool_size=5, max_overflow=5` -- up to 10.
- Web process, this module's `app`: `morai_app`, `min_size=1, max_size=1`
  -- exactly 1. Sized minimally on purpose: this connector only ever calls
  `defer_async`, a single short-lived statement, never a long-running
  worker loop.
- Worker process, `morai.worker.app.app`: superuser, `min_size=1,
  max_size=2`.
- Worker process, `morai.db.session.get_app_engine()` (reused, not a
  fourth engine factory -- `morai.worker.app`'s own docstring explains
  why): `morai_app`, `pool_size=5, max_overflow=5` -- up to 10.

Combined ceiling: up to 23 connections across both processes, against
whatever Postgres's own `max_connections` allows (Railway's Postgres has
no pooler in front of it, `02-RESEARCH.md`'s spike) -- a written number,
not an inference.
"""

from __future__ import annotations

from uuid import UUID

import procrastinate

from morai.ingest.sync_runs import SyncTrigger
from morai.settings import get_settings

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(
        conninfo=get_settings().app_sync_dsn, min_size=1, max_size=1
    )
)


async def defer_manual_sync(user_id: UUID) -> None:
    """Defers `sync_user` by name, carrying the manual trigger value --
    the same task `morai.worker.app`'s own periodic fan-out defers, so
    this route and the scheduler share one job definition and one write
    path (INGEST-04). Opens the connector, defers, and closes -- this
    function's whole lifetime."""
    async with app.open_async():
        await app.configure_task("sync_user").defer_async(
            user_id=str(user_id), trigger=SyncTrigger.MANUAL.value
        )
