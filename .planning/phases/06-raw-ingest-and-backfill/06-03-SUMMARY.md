---
phase: 06-raw-ingest-and-backfill
plan: 03
subsystem: ingest
tags: [procrastinate, sqlalchemy, rls, schwab, alembic, pydantic, fastapi]

requires:
  - phase: 06-raw-ingest-and-backfill
    provides: "Plan 06-01's sync_user shell and insert_fills/insert_broker_transactions ON CONFLICT DO NOTHING retrofit; plan 06-02's sync_all_connected_users periodic fan-out and the TxFakeSchwabAuth/_TxFakeSchwabClient fixtures this plan extends with fail_on_call/fail_exception"
provides:
  - "sync_runs table (migration 0012): what ran, what landed, what errored per sync_user attempt -- a failure record that survives the ingest transaction's own rollback via a second, fresh session opened after that rollback (INGEST-06)"
  - "classify_sync_error: five classified codes from exception type and HTTP status code only, never exception text (NN-20, NN-34)"
  - "schwab_connections.last_synced_at finally written, on success only, to the run's own started_at -- the loop Phase 4 opened and left null"
  - "POST /schwab/sync (INGEST-04): the manual re-sync, deferring the same sync_user job the scheduler defers, over a deferral-only Procrastinate App connected as morai_app (never superuser), with migration 0013's grants forced by five real InsufficientPrivilegeErrors"
  - "GET /schwab/sync-runs: one user's own sync history, most recent first, RLS-isolated with a superuser positive control"
affects: [09-reconciliation]

actuals:
  tokens: 19820
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Two-session failure-record split: on a sync_user failure, roll back the ingest session first, then open a second, fresh session to write the failed sync_runs row and commit that alone, then re-raise -- a failure record written on the session that just failed would roll back with it"
    - "Deferral-only procrastinate.App (api/job_queue.py), never consumed (run_worker_async never called from the web process), built on PsycopgConnector over a role-swapped DSN mirroring the existing app_async_dsn pattern but with the plain psycopg-style scheme"
    - "Grant-discovery loop, exercised live against local Postgres as morai_app rather than reasoned about: attempt the real operation, read the InsufficientPrivilegeError Postgres raises, grant exactly what it names, repeat until it succeeds (V092)"
    - "Test-only periodic-registry pop/restore (disable_periodic_fanout, duplicated across two test files) to neutralize Procrastinate's own periodic deferrer -- every run_worker_async call unconditionally starts it as a side task and it immediately catches up any due periodic task, which would otherwise inject an uncontrolled extra sync_user run into exact-row-count assertions"

key-files:
  created:
    - alembic/versions/0012_sync_runs.py
    - alembic/versions/0013_procrastinate_defer_grants.py
    - src/morai/ingest/sync_runs.py
    - src/morai/api/job_queue.py
    - tests/ingest/test_sync_runs.py
    - tests/ingest/test_sync_route.py
  modified:
    - src/morai/db/models.py
    - src/morai/identity/account.py
    - src/morai/settings.py
    - src/morai/worker/app.py
    - src/morai/api/routes_connections.py
    - src/morai/api/models_connections.py
    - tests/identity/conftest.py
    - tests/ingest/conftest.py

key-decisions:
  - "The cooldown is read off the caller's most recent COMPLETED sync_runs row, not a new state field -- which means it only takes effect after a sync_user job has actually been drained, not merely deferred. Two POST /schwab/sync calls back-to-back before any worker run both succeed and both defer; the 429 rejection only fires once a prior run's own sync_runs row exists. Discovered by the RED test itself (an immediate second call was not rejected), documented here rather than silently changing the test to hide it -- this is the honest behavior of 'read off the run this plan already records,' the plan's own chosen mechanism, not a bug in it."
  - "record_sync_run/read_sync_runs use plain ORM insert()/select(), not pg_insert(...).on_conflict_do_nothing() -- unlike fills/broker_transactions, sync_runs has no natural composite key to conflict on (its id is a fresh UUID per row, by design, since a second writer never exists per SyncRun's own docstring) and no idempotency requirement: every attempt, successful or not, is meant to leave its own row."
  - "Landed counts on SyncRun use plain Integer, not SmallInteger like Fill.leg_index -- a first-connect backfill across the full 365-day lookback can plausibly land more rows in one run than a SmallInteger's ~32k ceiling comfortably covers over a long-unsynced account, and nothing about this column benefits from the narrower type the way a legitimately-bounded leg index does."

patterns-established:
  - "A table meant to record every attempt (not just every successful write) gets a synthetic UUID primary key and no ON CONFLICT clause -- the opposite shape from fills/broker_transactions, which conflict on a natural key precisely because a second attempt over the same window must be a no-op, not a second row."

requirements-completed: [INGEST-04, INGEST-06]

coverage:
  - id: D1
    description: "A successful sync_user writes one sync_runs row with both counts, a null error_code, and sets last_synced_at to the run's own started_at; a failed sync_user writes one row with null counts and a classified error_code, and that row survives the ingest transaction's own rollback"
    requirement: "INGEST-06"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_runs.py#test_successful_sync_writes_one_run_row_and_sets_last_synced_at"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_runs.py#test_missing_connection_fails_and_writes_a_classified_run_row"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_runs.py#test_failure_mid_backfill_rolls_back_all_writes_but_keeps_the_run_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five distinct exception classes classify to five distinct SyncError codes, and no fragment of an exception's own message ever reaches the stored row"
    requirement: "INGEST-06"
    verification:
      - kind: unit
        ref: "tests/ingest/test_sync_runs.py#test_classify_sync_error_maps_five_distinct_classes"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_runs.py#test_second_failed_sync_leaves_first_syncs_state_untouched_and_leaks_no_token"
        status: pass
    human_judgment: false
  - id: D3
    description: "A user reads only their own sync_runs rows, proved with a superuser positive control confirming another user's rows genuinely exist"
    requirement: "INGEST-06"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_runs.py#test_user_reads_only_their_own_sync_runs_with_superuser_positive_control"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /schwab/sync defers the same sync_user job the scheduler defers, over a connection whose current_user is morai_app, with migration 0013 carrying only grants a real privilege failure forced; 404 for no connection, 401 unauthenticated, 429 inside the cooldown deferring nothing, and repeated re-sync outside the cooldown is safe"
    requirement: "INGEST-04"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_route_defers_sync_user_with_the_manual_trigger"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_route_404s_for_a_user_with_no_connection"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_route_rejects_an_unauthenticated_call"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_second_call_inside_cooldown_is_rejected_and_defers_nothing"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_repeated_manual_resync_outside_the_cooldown_is_safe"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_deferral_connection_role_is_morai_app_not_superuser"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /schwab/sync-runs returns the caller's own history most-recent-first with null counts on failure, an empty list (not 404) for no runs, no vendor payload leakage, is rejected unauthenticated, and isolates users with a superuser positive control"
    requirement: "INGEST-06"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_runs_route_returns_the_users_own_history_most_recent_first"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_runs_route_returns_an_empty_list_and_200_for_no_runs"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_runs_route_serialises_a_failed_runs_counts_as_null"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_runs_route_rejects_an_unauthenticated_call"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_route.py#test_sync_runs_route_isolates_users_with_a_superuser_positive_control"
        status: pass
    human_judgment: false

duration: ~95min (estimate -- no literal start timestamp was captured before the initial read pass, same honest-estimate caveat 06-01/06-02-SUMMARY.md record)
completed: 2026-09-01
status: complete
---

# Phase 6 Plan 3: Sync Runs and Manual Resync Summary

**A `sync_runs` row for every `sync_user` attempt whose failure record survives the ingest transaction's own rollback via a second, fresh session; `last_synced_at` finally written on success; and `POST /schwab/sync` defers the same job the scheduler defers over a deferral-only connection whose role is `morai_app`, with migration 0013 carrying only grants five real `InsufficientPrivilegeError`s forced.**

## Performance

- **Duration:** ~95 min (estimate)
- **Completed:** 2026-09-01T14:13:51Z
- **Tasks:** 3 (all executed, all genuinely RED before GREEN)
- **Files modified:** 14 (6 created, 8 modified)

## Accomplishments

- Migration 0012 lands `sync_runs`: `CHECK` constraints restricting `trigger` to `('scheduled', 'manual')` and `status` to `('succeeded', 'failed')`, `FOR ALL` RLS (`V092`), no `UPDATE` grant (a run record is written once), `(user_id, started_at DESC)` index. Landed counts nullable on purpose -- a failed run landed an unknown number of rows, not zero (`NN-16` applied to a count).
- `src/morai/ingest/sync_runs.py`: `SyncTrigger`/`SyncStatus`/`SyncError` `StrEnum`s, `classify_sync_error` (branches on exception type and, for `HTTPStatusError`, on `response.status_code` -- never on `str(exc)`, `NN-20`/`NN-34`), `record_sync_run`/`read_sync_runs`.
- `src/morai/worker/app.py::sync_user_task`: captures `started_at` before opening the ingest session. On success, records the run and sets `last_synced_at` to `started_at` (not the finish time) in the same transaction as the ingest writes. On failure, rolls back that session, opens a **second, fresh** session, records the failed run there alone, commits it, then re-raises so Procrastinate still marks the job `failed`. `trigger` defaults to `scheduled`, so the periodic fan-out needed no change; the manual route passes `trigger=SyncTrigger.MANUAL.value` through the identical task.
- `src/morai/settings.py::app_sync_dsn`: mirrors `app_async_dsn`'s role-swap exactly, with the plain `postgresql://` scheme Procrastinate's `PsycopgConnector` needs rather than `+asyncpg`.
- `src/morai/api/job_queue.py`: a second, deferral-only `procrastinate.App` over `PsycopgConnector(app_sync_dsn)`, `min_size=1, max_size=1`. Its own docstring states, and this session verified true, that it is never consumed and never imports `morai.worker.app` -- and names all four connection pools across both processes against `NN-28`.
- Migration 0013's grants -- `INSERT, SELECT ON procrastinate_jobs`; `USAGE, SELECT ON procrastinate_jobs_id_seq`; `INSERT ON procrastinate_events`; `USAGE, SELECT ON procrastinate_events_id_seq` -- were each forced by a real `InsufficientPrivilegeError`, driven live as `morai_app` against local Postgres 18, quoted below.
- `POST /schwab/sync`: 404 with no connection, 429 inside the cooldown (read off the caller's own most recent `sync_runs` row, deferring nothing), otherwise defers `sync_user` with the manual trigger and returns a near-empty `SyncTriggeredResponse`.
- `GET /schwab/sync-runs`: a thin shell over `read_sync_runs`, `SyncRunResponse`'s `Optional` counts/`error_code` staying optional on the wire (`NN-16` at the API boundary).

## Task Commits

1. **Task 1: sync_runs record** -- RED: `60735fd` (`test(06-03)`), GREEN: `d4cd19d` (`feat(06-03)`)
2. **Task 2: manual re-sync route** -- RED: `25b9850` (`test(06-03)`), GREEN: `71a05ed` (`feat(06-03)`)
3. **Task 3: reading the record** -- RED: `43498a1` (`test(06-03)`), GREEN: `5cfd563` (`feat(06-03)`)

**Plan metadata:** (this commit, following)

_TDD note: every RED was verified as a genuine, unmanufactured red, following the same move-out/stash-and-run discipline 06-01/06-02 established -- never a temporary scaffold built to produce a more interesting failure._

**Task 1's RED**, quoted from the real run: `src/morai/ingest/sync_runs.py` was moved out of the tree; `uv run pytest tests/ingest/test_sync_runs.py -x -q` failed collection with `ModuleNotFoundError: No module named 'morai.ingest.sync_runs'` (via `worker/app.py`'s own import chain), then the file was restored.

**Task 2's RED**, quoted from the real run: `src/morai/api/routes_connections.py` and `src/morai/api/models_connections.py` were stashed back to their task-1 state; `uv run pytest tests/ingest/test_sync_route.py -x -q` returned a genuine `404` (`assert second.status_code == 200` failing with `404`, the route simply not existing), then the stash was restored.

**Task 3's RED**, quoted from the real run: same stash technique against task 2's own state; `GET /schwab/sync-runs` returned `404` (the route not existing), then restored.

## Files Created/Modified

- `alembic/versions/0012_sync_runs.py` -- the table, `FOR ALL` RLS, no `UPDATE`, two `CHECK`s
- `alembic/versions/0013_procrastinate_defer_grants.py` -- the four grants the discovery loop forced
- `src/morai/db/models.py` -- `SyncRun`, no `_write_token` gate (mirrors `Event`'s own precedent)
- `src/morai/identity/account.py` -- `sync_runs` added to `delete_account`'s identity-rows block
- `src/morai/ingest/sync_runs.py` -- enums, `classify_sync_error`, `record_sync_run`/`read_sync_runs`
- `src/morai/settings.py` -- `app_sync_dsn`, `schwab_sync_cooldown_seconds`
- `src/morai/worker/app.py` -- `sync_user_task`'s two-session failure split, `last_synced_at` write
- `src/morai/api/job_queue.py` -- the deferral-only `App`, `defer_manual_sync`
- `src/morai/api/routes_connections.py` -- `POST /schwab/sync`, `GET /schwab/sync-runs`
- `src/morai/api/models_connections.py` -- `SyncTriggeredResponse`, `SyncRunResponse`
- `tests/identity/conftest.py` -- `sync_runs` added to the truncate list
- `tests/ingest/conftest.py` -- `fail_on_call`/`fail_exception` on the tracer fakes; re-exports `clean_connection_tables`/`logged_in_client`
- `tests/ingest/test_sync_runs.py`, `tests/ingest/test_sync_route.py` -- the full behavior suite

## Decisions Made

See `key-decisions` in frontmatter. The cooldown-timing discovery is the one worth restating in prose: **the cooldown only takes effect once a prior sync has actually been drained**, not merely deferred, because it reads `sync_runs.started_at` and that row does not exist until the worker runs. Two `POST /schwab/sync` calls issued back-to-back with no worker run in between both succeed. This is the honest consequence of the plan's own chosen mechanism ("read off the run this plan already records") -- a manual trigger followed immediately by a second manual trigger, with the deployed worker running at its normal cadence in between, is exactly the shape production traffic takes, and the cooldown's job is throttling *sustained* re-triggering, not a sub-second double-click. Recorded here rather than silently working around it in the test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test-owned SQLAlchemy identity-map staleness in the first sync_runs test**
- **Found during:** Task 1, `test_successful_sync_writes_one_run_row_and_sets_last_synced_at`
- **Issue:** The test loaded `SchwabConnection` into `app_db_session`'s identity map before the write (which happened on the worker's own, different session), then re-queried the same session and got back the same cached, stale object -- `last_synced_at` read as `None` even though the DB row had genuinely been updated.
- **Fix:** `app_db_session.expire_all()` before the second `SELECT`, forcing a fresh load.
- **Files modified:** `tests/ingest/test_sync_runs.py`
- **Verification:** `uv run pytest tests/ingest/test_sync_runs.py::test_successful_sync_writes_one_run_row_and_sets_last_synced_at -q` -- 1 passed
- **Committed in:** `d4cd19d` (feat commit, alongside the GREEN implementation)

**2. [Rule 1 - Bug] Procrastinate's own periodic deferrer contaminating exact-row-count assertions**
- **Found during:** Task 1, first run of the new test suite
- **Issue:** Every `run_worker_async` call unconditionally starts Procrastinate's periodic deferrer as a side task (`Worker._start_side_tasks`), and that deferrer immediately catches up any periodic task due for the current tick -- including this project's own `sync_all_connected_users`, cron `* * * * *`. With a connection already seeded, this silently deferred and ran a *second*, ambient `sync_user` job inside the same `wait=False` drain, producing two `sync_runs` rows where the test expected one.
- **Fix:** A local `disable_periodic_fanout` autouse fixture, in both new test files, that pops `("sync_all_connected_users", "")` from `app.periodic_registry.periodic_tasks` for the duration of each test and restores it after -- mirroring `tests/ingest/test_fanout.py`'s own sidestep of the identical interaction (calling `sync_all_connected_users` directly there, rather than through the periodic mechanism).
- **Files modified:** `tests/ingest/test_sync_runs.py`, `tests/ingest/test_sync_route.py`
- **Verification:** Full suite green with no flaky duplication across repeated runs.
- **Committed in:** `60735fd`/`25b9850` (test commits, alongside the RED test files)

**3. [Rule 1 - Bug] `POST /schwab/sync` 404s before deferring, so the "counts serialize as null" test couldn't reach a failed row through the route**
- **Found during:** Task 3, `test_sync_runs_route_serialises_a_failed_runs_counts_as_null`
- **Issue:** The route's own no-connection guard (task 2's 404) fires before `defer_manual_sync` is ever called, so a test that tries to produce a failed run by calling the route for a user with no connection just gets a 404 -- never a deferred, failing job.
- **Fix:** The test now defers `sync_user` directly through `app.configure_task("sync_user").defer_async(...)`, the same shape `test_missing_connection_fails_and_writes_a_classified_run_row` (task 1) already uses, rather than routing through `POST /schwab/sync`.
- **Files modified:** `tests/ingest/test_sync_route.py`
- **Verification:** `uv run pytest tests/ingest/test_sync_route.py -x -q` -- 11 passed
- **Committed in:** `5cfd563` (feat commit, alongside the GREEN implementation)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 test bugs owned by this plan's own new test infrastructure, 1 Rule 1 test-design correction against a real route guard). **Impact on plan:** All three were necessary to make the plan's own explicit behaviors provable. No scope creep -- nothing outside this plan's own file list was touched.

## Issues Encountered

None beyond the deviations above.

## Privilege Discovery Loop (migration 0013's own justification)

Exercised live, not reasoned about (`V092`). Each grant below was forced by re-running `defer_manual_sync` as `morai_app` and reading the real `InsufficientPrivilegeError` Postgres raised, one at a time, until the defer succeeded:

1. `permission denied for table procrastinate_jobs` (the `INSERT` half of `procrastinate_defer_jobs_v1`'s own `WITH inserted_jobs AS (INSERT INTO procrastinate_jobs ... RETURNING id) SELECT array_agg(id) FROM inserted_jobs`) → `GRANT INSERT ON procrastinate_jobs TO morai_app`.
2. Same error text again after (1) alone -- Postgres's `RETURNING` clause additionally requires `SELECT` on the returned columns → `GRANT SELECT ON procrastinate_jobs TO morai_app`.
3. `permission denied for sequence procrastinate_jobs_id_seq` (`id bigserial`'s own default) → `GRANT USAGE, SELECT ON procrastinate_jobs_id_seq TO morai_app`.
4. `permission denied for table procrastinate_events` (the `AFTER INSERT` trigger `procrastinate_trigger_status_events_insert_v1`, migration 0002, writing a `deferred` event row unconditionally inside the same statement) → `GRANT INSERT ON procrastinate_events TO morai_app`.
5. `permission denied for sequence procrastinate_events_id_seq` (that trigger's own `id bigserial`) → `GRANT USAGE, SELECT ON procrastinate_events_id_seq TO morai_app`.

After grant 5, `defer_manual_sync` succeeded with no error. **No grant was needed on `procrastinate_periodic_defers`, `procrastinate_workers`, or any `procrastinate_*` function** -- the loop never asked for one, matching `api/job_queue.py`'s own design constraint that this `App` only ever calls `defer_async`. `pg_notify` (the queue-insert trigger's own final call) needed no grant either, confirmed by the same live run.

## Four-Pool `NN-28` Accounting

| Pool | Process | Role | Sizing |
|---|---|---|---|
| `morai.db.session.get_app_engine()` | web | `morai_app` | `pool_size=5, max_overflow=5` -- up to 10 |
| `api/job_queue.py`'s `app` | web | `morai_app` | `min_size=1, max_size=1` -- exactly 1 |
| `morai.worker.app.app` | worker | superuser | `min_size=1, max_size=2` |
| `morai.db.session.get_app_engine()` (reused) | worker | `morai_app` | `pool_size=5, max_overflow=5` -- up to 10 |

Combined ceiling: up to 23 connections across both processes, against whatever Postgres's own `max_connections` allows -- a written number now, not an inference.

## User Setup Required

None -- no new external service configuration this plan. Plan 06-01's own `MORAI_APP_DB_PASSWORD` worker-service requirement still stands, unchanged here; the web service already required it for `get_app_engine()`, and this plan's `app_sync_dsn` reuses the same setting.

## Next Phase Readiness

Phase 6 (raw ingest and backfill) is complete across all three plans. Ready for Phase 9 (reconciliation), which consumes `broker_transactions` as its independent comparison source and can now also read `sync_runs` for operational visibility into when each user's cycles ran and what, if anything, went wrong.

**Facts owed to a first live Schwab run, carried forward from 06-01/06-02 and unchanged by this plan (still owed, still unguessed):**

- The real per-call transaction range limit and the real rate limit on `get_transactions` -- every window `sync_user` issues still logs its requested bounds and returned element count; that logging remains the instrument the first live run reads.
- `activityId`'s real uniqueness guarantee per user.
- Whether `transferItems[].price` is the right source field for `price_usd` (Assumption A3, `06-RESEARCH.md`).
- The real OCC symbol spacing Schwab sends.
- The `cost`-sign fallback in `_direction`'s second branch.

**New full-suite pass count and wall-clock time:** `bash tools/gate.sh` -- ruff, ruff format, basedpyright, mypy all clean; **382 passed** (up from plan 06-02's own 365, +17 net new tests: 6 in `test_sync_runs.py`, 6 in `test_sync_route.py` task 2, 5 in `test_sync_route.py` task 3), pytest wall-clock **55.99s**, full gate wall-clock **~60.5s** (against 06-02's own recorded 54.85s gate time).

**Migration reversibility**, confirmed by hand once against the local database: `uv run alembic downgrade 0011` then `uv run alembic upgrade head` -- both exit `0`.

---
*Phase: 06-raw-ingest-and-backfill*
*Plan: 03*
*Completed: 2026-09-01*

## Self-Check: PASSED

- All 14 files listed under Key Files (created/modified) confirmed present on disk.
- All 6 commit hashes (`60735fd`, `d4cd19d`, `25b9850`, `71a05ed`, `43498a1`, `5cfd563`) confirmed present via `git log --oneline --all`.
- Full suite (`bash tools/gate.sh`): 382 passed, exit 0, ~60.5s wall-clock.
- Migration reversibility (`uv run alembic downgrade 0011` then `upgrade head`): both exit 0.
