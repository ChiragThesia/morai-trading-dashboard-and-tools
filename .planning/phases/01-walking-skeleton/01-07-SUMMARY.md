---
phase: 01-walking-skeleton
plan: 07
subsystem: infra
tags: [procrastinate, psycopg, alembic, postgres, worker, cron]

requires:
  - phase: 01-walking-skeleton (01-03)
    provides: "src/morai/settings.py (get_settings, sync_dsn/async_dsn), alembic/env.py, the 0001 baseline revision"
provides:
  - "src/morai/worker/app.py -- a module-level Procrastinate App on PsycopgConnector, one periodic heartbeat task"
  - "alembic/versions/0002_procrastinate_schema.py -- Procrastinate's own schema.sql wrapped verbatim into Alembic's chain"
  - "A second process (OPS-04) that does real work against the same Postgres as the web process"
affects: [01-08 (Railway deploy needs this worker service to exist), phase-3 (extends the migration chain past 0002), phase-6 (owns the real RTH-cadence execution model this heartbeat cron is not a preview of)]

actuals:
  tokens: 2935
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Two independent connection pools against one Postgres: asyncpg/SQLAlchemy for the web process, psycopg v3/PsycopgConnector for the worker -- forced by Procrastinate shipping no asyncpg connector, not a design choice"
    - "Vendor raw-SQL migrations wrapped verbatim into an Alembic revision via op.execute(), split into individual per-statement calls (asyncpg's extended query protocol rejects multi-statement strings) rather than reformatted"
    - "Attach a log-capture handler directly to a named logger, bypassing pytest's caplog/root chain, when a session-scoped fixture elsewhere (Alembic's own logging.config.fileConfig) reconfigures root logging mid-session"

key-files:
  created:
    - src/morai/worker/__init__.py
    - src/morai/worker/app.py
    - alembic/versions/0002_procrastinate_schema.py
    - tests/test_worker_heartbeat.py
  modified: []

key-decisions:
  - "PsycopgConnector (psycopg v3) is the worker's connector -- Procrastinate ships no asyncpg connector at all; the other four are sync/defer-only"
  - "Pool capped explicitly (min_size=1, max_size=2) as its own line in the Postgres connection-ceiling budget (NN-28), separate from the web process's asyncpg pool"
  - "Procrastinate's schema.sql is split into individual op.execute() calls at top-level semicolons (dollar-quoted function bodies treated as atomic), not one op.execute() call -- asyncpg's prepared-statement protocol refuses multi-statement strings"
  - "Heartbeat deferred in tests via App.configure_task('heartbeat').defer_async(timestamp=...), not the periodic-decorated Task object directly -- the periodic decorator narrows the Task's own type to exclude timestamp, since the periodic deferrer injects it at schedule time"

patterns-established:
  - "Vendor SQL wrapped into Alembic keeps verbatim text intact per-statement even when split for driver compatibility -- concatenating the pieces reconstructs the original file exactly"

requirements-completed: [OPS-04, OPS-02]

coverage:
  - id: D1
    description: "alembic upgrade head brings a fresh database to a state that includes Procrastinate's own tables"
    requirement: "OPS-04"
    verification:
      - kind: integration
        ref: ".github/workflows/ci.yml test-pytest job, run uv run alembic upgrade head"
        status: pass
    human_judgment: false
  - id: D2
    description: "The worker connects through its own psycopg v3 pool (PsycopgConnector), separate from the web process's asyncpg pool"
    requirement: "OPS-04"
    verification:
      - kind: unit
        ref: "tests/test_worker_heartbeat.py#test_connector_is_psycopg"
        status: pass
    human_judgment: false
  - id: D3
    description: "The heartbeat is registered as a periodic task with a cron expression, firing on a schedule with no enqueuer"
    requirement: "OPS-04"
    verification:
      - kind: unit
        ref: "tests/test_worker_heartbeat.py#test_heartbeat_is_registered_as_a_periodic_task"
        status: pass
    human_judgment: false
  - id: D4
    description: "A deferred heartbeat job is picked up by the worker's own pool and reaches succeeded status in procrastinate_jobs"
    requirement: "OPS-04"
    verification:
      - kind: integration
        ref: "tests/test_worker_heartbeat.py#test_heartbeat_defers_and_reaches_succeeded"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-30
status: complete
---

# Phase 1 Plan 07: The Procrastinate Worker Summary

**A worker process on its own psycopg v3 pool, one periodic heartbeat task, and Procrastinate's own schema wrapped verbatim into Alembic's migration chain.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-30T18:05:26-05:00
- **Completed:** 2026-08-30T18:18:55-05:00
- **Tasks:** 2
- **Files modified:** 4 (all new)

## Accomplishments

- `src/morai/worker/app.py`: a module-level Procrastinate `App` on `PsycopgConnector` (psycopg v3, min_size=1/max_size=2), with one `heartbeat` task registered `@app.periodic(cron="* * * * *")` — Phase 1's own cadence, explicitly not a preview of Phase 6's 30-minute RTH cadence.
- `alembic/versions/0002_procrastinate_schema.py`: Procrastinate 3.9.0's `procrastinate/sql/schema.sql` taken verbatim, split into per-statement `op.execute()` calls (dollar-quoted function/DO bodies kept atomic), chained onto the `0001` baseline. Real `downgrade()` dropping every table/function/type the schema creates, in dependency order.
- `tests/test_worker_heartbeat.py`: three no-DB import-and-inspect assertions plus one `@pytest.mark.db` test that defers the heartbeat through the real psycopg pool, runs the worker bounded (`wait=False` + outer `asyncio.wait_for` timeout), and confirms the job reaches `succeeded` and logs its run.
- CI (`test-pytest`) verified green end to end: `alembic upgrade head` on a fresh Postgres service container reaches `0002` including Procrastinate's tables, and the full 20-test suite passes.

## Task Commits

1. **Task 1: Procrastinate's schema, owned by Alembic** — `ba0a277` (feat), `4573201` (fix — driver-compatibility split, found in CI)
2. **Task 2: The worker, its own pool, and one heartbeat** — `f12013e` (test, RED), `01dc712` (feat, GREEN), `f3d765b` (fix — log-capture robustness, found in CI)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `src/morai/worker/__init__.py` — package docstring
- `src/morai/worker/app.py` — the worker `App`, its capped psycopg pool, the `heartbeat` task
- `alembic/versions/0002_procrastinate_schema.py` — Procrastinate's schema wrapped into Alembic, split per-statement
- `tests/test_worker_heartbeat.py` — connector shape, periodic registration, single-DSN, and the real defer→run→succeeded round trip

## Decisions Made

- **`PsycopgConnector` (psycopg v3) is the worker's connector.** Procrastinate ships no `asyncpg` connector at all — confirmed against 01-RESEARCH.md's own connector table (five connectors; the other four are sync and/or defer-only). The web process gets no Procrastinate connector this phase — nothing defers a job from a request yet, per the plan's own scope.
- **Pool capped explicitly** (`min_size=1, max_size=2`) rather than the library default (`min_size=4`), as its own line in the Postgres connection-ceiling budget (`NN-28`), separate from the web process's asyncpg pool.
- **Vendor SQL split per-statement, not reformatted.** `op.execute()` on the whole `schema.sql` as one call fails against asyncpg's extended query protocol ("cannot insert multiple commands into a prepared statement") — measured in CI, not anticipated by the plan or by 01-RESEARCH.md, which only established the wrap-verbatim pattern in the abstract. `_split_sql_statements()` splits on top-level semicolons, treating every `$$ ... $$` body as atomic; concatenating the pieces reconstructs the original file exactly (verified in this session).
- **Heartbeat deferred by name in tests**, via `App.configure_task("heartbeat").defer_async(timestamp=...)`, not the periodic-decorated `Task` object's own `.defer_async()`. The `@app.periodic()` decorator's return type narrows the `Task`'s own signature to exclude `timestamp` (the periodic deferrer injects it at schedule time), so the by-name path is the clean way to defer manually without a suppressed type error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `op.execute()` on the whole schema.sql fails under asyncpg's protocol**
- **Found during:** Task 1 verification (pushed, read CI)
- **Issue:** `alembic upgrade head` failed in `test-pytest` with `asyncpg.exceptions.PostgresSyntaxError: cannot insert multiple commands into a prepared statement`. SQLAlchemy's async dialect routes `op.execute()` through asyncpg's extended query protocol, which — unlike `psql`'s simple-query protocol Procrastinate's own SQL is written for — rejects a single string containing multiple SQL statements.
- **Fix:** Added `_split_sql_statements()`, splitting the embedded SQL on top-level semicolons while treating `$$ ... $$` dollar-quoted bodies as atomic (so a semicolon inside a function/DO block never splits it). `upgrade()` now loops `op.execute(statement)` per statement. Verified the split pieces concatenate back to the exact original string.
- **Files modified:** `alembic/versions/0002_procrastinate_schema.py`
- **Verification:** CI `test-pytest` — `alembic upgrade head` reached `0002` clean on a fresh Postgres service container.
- **Committed in:** `4573201`

**2. [Rule 1 - Bug] `caplog` captured nothing because a sibling test's fixture reconfigures root logging mid-session**
- **Found during:** Task 2 verification (pushed, read CI)
- **Issue:** The db-marked test passed its defer/status assertions (`todo` → `succeeded`) but failed the log-line assertion — `caplog.records` was empty. Root cause: `test_money_roundtrip.py` (collected before `test_worker_heartbeat.py` alphabetically) uses the session-scoped `migrated_db` fixture, which runs `alembic upgrade head` — and Alembic's own `env.py` calls `logging.config.fileConfig(alembic.ini)`. `fileConfig`'s default `disable_existing_loggers=True` disables every already-instantiated logger not named in `alembic.ini` (our `morai.worker.app` logger, created at collection-time import, included) and resets root's level to `alembic.ini`'s `WARNING`. Neither `alembic/env.py` nor `alembic.ini` were in this plan's `files_modified`, so the fix had to live entirely in the test.
- **Fix:** Replaced `caplog` with a small handler (`_CollectingHandler`) attached directly to `logging.getLogger("morai.worker.app")`, with `.disabled` and `.setLevel(INFO)` explicitly reset before use — bypassing root's handler chain and inherited level entirely.
- **Files modified:** `tests/test_worker_heartbeat.py`
- **Verification:** CI `test-pytest` — full 20-test suite green, including the log-line assertion.
- **Committed in:** `f3d765b`

---

**Total deviations:** 2 auto-fixed (both Rule 1, both discovered only against real CI infrastructure — Docker's local daemon is broken here, so neither driver protocol nor cross-test logging state was observable locally).
**Impact on plan:** Both fixes are narrowly scoped to make the plan's own design (verbatim SQL wrap; a log-line assertion) actually work against the real driver and the real multi-file test session. No scope creep — the connector choice, the pool cap, the cron cadence, and the migration-chain shape are exactly as planned.

## Issues Encountered

None beyond the two deviations above, both resolved within this plan's own files.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- OPS-04's second process exists and does real work (defer → dequeue → succeed) against the same database as the web process.
- One migration system of record: `alembic upgrade head` reaches `0002` including Procrastinate's tables; `procrastinate schema --apply` appears nowhere in the repository (verified by grep).
- A worker service now exists for plan 01-08's Railway deploy and its private-network probe (`web.railway.internal`) to originate from.
- Phase 3 extends the Alembic chain past `0002` rather than replacing it — the migration is one-way by design (D-13).

---
*Phase: 01-walking-skeleton*
*Completed: 2026-08-30*

## Self-Check: PASSED

All 4 created files found on disk (`src/morai/worker/__init__.py`, `src/morai/worker/app.py`,
`alembic/versions/0002_procrastinate_schema.py`, `tests/test_worker_heartbeat.py`). All 5 task
commits (`ba0a277`, `f12013e`, `01dc712`, `4573201`, `f3d765b`) found in `git log`. CI run
[33341489500](https://github.com/ChiragThesia/morai-trading-dashboard-and-tools/actions/runs/33341489500)
green on all four jobs against the final commit.
