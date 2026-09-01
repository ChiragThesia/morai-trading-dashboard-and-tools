---
phase: 06-raw-ingest-and-backfill
plan: 02
subsystem: ingest
tags: [procrastinate, sqlalchemy, rls, schwab, pytest]

requires:
  - phase: 06-raw-ingest-and-backfill
    provides: "Plan 06-01's sync_user shell, insert_fills/insert_broker_transactions ON CONFLICT DO NOTHING retrofit, the TxFakeSchwabAuth/_TxFakeSchwabClient fixtures, and sync_windows' two branches -- this plan extends the fan-out on top and proves the other two directly"
provides:
  - "sync_all_connected_users (schwab_sync.py): one Procrastinate job deferred per schwab_connections row, on the superuser session, from a periodic task registered in worker/app.py alongside the heartbeat"
  - "The procrastinate_periodic_defers_unique constraint proved against the installed database by a rejected duplicate insert -- D6-01 criterion 1's no-double-fire guarantee is a database fact, not a read of migration 0002"
  - "Re-ingest idempotency proved at the byte level (ciphertext/nonce, not just row count) and the WR-A3 conflict-clause-safety proof: two fills differing only in leg_index, two broker_transactions differing only in activity_id, both land and both hold across a rerun"
  - "The backfill window planner (sync_windows) proved pure, gapless, non-overlapping and collapsing to one window on routine sync; sync_user's first-connect calls proved explicitly-dated, logged per window, and deduplicating overlapping payloads"
affects: [06-03-sync-runs-and-manual-resync, 09-reconciliation]

actuals:
  tokens: 5564
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Per-user selector for a fake vendor auth threaded through the connection's own refresh token (TxFakeSchwabAuth.responses_by_user_id) -- build_client's own Protocol (D4-02) carries no user_id parameter, so the refresh token token_read_func() yields is the only channel that can distinguish one user's connection from another's inside it"
    - "A recording fake client (windows_by_call, payload_by_window) attached to the auth's own last_client field, since sync_user opens exactly one client per invocation and no other reference to it escapes schwab_client_for_user's context manager"

key-files:
  created:
    - tests/ingest/test_fanout.py
    - tests/ingest/test_idempotency.py
    - tests/ingest/test_backfill.py
  modified:
    - src/morai/ingest/schwab_sync.py
    - src/morai/worker/app.py
    - tests/ingest/conftest.py

key-decisions:
  - "sync_all_connected_users takes whatever session it is given and documents that it MUST be the superuser one -- the fan-out is a cross-tenant read by definition (asking which users exist), and no RLS context represents 'all users' without either bypassing the policy or lying about it. worker/app.py's periodic task wrapper opens its own session via get_engine(), not get_session_maker()'s morai_app role, to satisfy this."
  - "Task 2 and Task 3 landed 4/4 and 5/5 GREEN on arrival respectively, with no companion feat commit -- plan 06-01's own insert_fills/insert_broker_transactions retrofit and sync_windows/sync_user implementation already satisfied every behavior these tasks prove. Documented as such per the plan's own red-ceremony rule rather than manufacturing a red."
  - "The failure-isolation test (Task 1) seeds each connection's refresh token as str(user_id) so TxFakeSchwabAuth.responses_by_user_id can select per-user behavior -- the honest ceiling of the fake: build_client sees only the refresh token, never a user_id argument, so that is the one channel available."

requirements-completed: [INGEST-01, INGEST-03, INGEST-05]

coverage:
  - id: D1
    description: "One periodic tick defers exactly one sync_user job per connected user and none for an unconnected one; one user's vendor failure fails only that job while the other's rows land; the periodic-defer unique constraint is proved against the installed database"
    requirement: "INGEST-01"
    verification:
      - kind: integration
        ref: "tests/ingest/test_fanout.py#test_fan_out_defers_one_job_per_connected_user_and_none_for_unconnected"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_fanout.py#test_fan_out_defers_nothing_with_no_connected_users"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_fanout.py#test_one_users_vendor_failure_leaves_the_other_succeeded_with_rows_landed"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_fanout.py#test_periodic_defers_unique_constraint_rejects_duplicate_accepts_differing"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_fanout.py#test_sync_all_connected_users_is_registered_as_a_periodic_task"
        status: pass
    human_judgment: false
  - id: D2
    description: "Re-running sync_user over the same window lands zero new rows and changes no stored ciphertext/nonce byte; a widening window lands only the genuinely new transaction; the ON CONFLICT DO NOTHING clause is safe because the composite key carries every discriminating column (WR-A3), proved for two fills differing only in leg_index and two broker_transactions differing only in activity_id"
    requirement: "INGEST-03"
    verification:
      - kind: integration
        ref: "tests/ingest/test_idempotency.py#test_second_run_over_same_window_lands_nothing_and_changes_no_byte"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_idempotency.py#test_run_over_extending_window_lands_only_the_genuinely_new_transaction"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_idempotency.py#test_two_fills_differing_only_in_leg_index_both_land_and_rerun_holds"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_idempotency.py#test_two_broker_transactions_differing_only_in_activity_id_both_land"
        status: pass
    human_judgment: false
  - id: D3
    description: "sync_windows covers the full 365-day lookback in consecutive ≤60-day chunks with no gap and no overlap, collapses to one window for a routine sync, and is pure under a fixed now; a first-connect sync_user issues one explicitly-dated get_transactions call per window, logs each window's bounds and returned count, and lands a transaction present in two overlapping windows' payloads exactly once"
    requirement: "INGEST-05"
    verification:
      - kind: unit
        ref: "tests/ingest/test_backfill.py#test_windows_cover_the_full_lookback_with_no_gap_and_no_overlap"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_backfill.py#test_routine_sync_collapses_to_one_window"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_backfill.py#test_stale_last_synced_at_chunks_into_more_than_one_window"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_backfill.py#test_sync_windows_is_pure_and_reads_no_clock"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_backfill.py#test_first_connect_calls_are_explicitly_dated_logged_and_dedupe_overlap"
        status: pass
    human_judgment: false

duration: ~55min (estimate -- no literal start timestamp was captured before the initial read pass, same honest-estimate caveat 06-01-SUMMARY.md records)
completed: 2026-09-01
status: complete
---

# Phase 6 Plan 2: Fan-Out, Idempotency and Backfill Summary

**One periodic tick fans out into one Procrastinate job per connected user, proved isolated and non-duplicating against the installed database; a second ingest run over the same window changes no stored byte; and a first-connect backfill issues one explicitly-dated, logged call per 60-day chunk of the 365-day lookback.**

## Performance

- **Duration:** ~55 min (estimate)
- **Completed:** 2026-09-01T13:28:37Z
- **Tasks:** 3 (all executed; Tasks 2 and 3 landed green on arrival against Task 1's and plan 06-01's own implementation)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `sync_all_connected_users` (`schwab_sync.py`): selects `user_id` from `schwab_connections` on the superuser session it is given -- the one place in the ingest path a cross-tenant read is correct -- and defers `sync_user` by name for each row through `app.configure_task("sync_user").defer_async(user_id=...)`. Registered as a periodic task in `worker/app.py` (same one-minute placeholder cadence and decorator order as the heartbeat), opening its own session on `get_engine()` (superuser), not `get_session_maker()`'s `morai_app` role.
- `D6-01` criterion 1 proved directly: an `INSERT` into `procrastinate_periodic_defers` with a duplicate `(task_name, periodic_id, defer_timestamp)` raises `IntegrityError` naming constraint `"procrastinate_periodic_defers_unique"` (quoted below), and a differing `defer_timestamp` is accepted -- proved against the live schema, not read from migration 0002.
- Failure isolation proved end to end: one user's `get_transactions` raising leaves that job `failed` and the other user's job `succeeded` with its rows landed, exercising Procrastinate's own per-job retry/failure semantics at its real `concurrency=1`.
- `tests/ingest/test_idempotency.py`: a second `sync_user` run over the same window lands zero rows on both tables and leaves every stored ciphertext/nonce byte unchanged (not just a stable row count); a widening-payload run lands only the genuinely new transaction; two fills built through the real `extract_fills` and differing only in `leg_index`, and two broker transactions differing only in `activity_id`, both land and both hold across a rerun -- the WR-A3 proof (`salvage/invariants.md`) that the `DO NOTHING` clause is safe because the composite key carries every discriminating column.
- `tests/ingest/test_backfill.py`: `sync_windows` proved pure, gapless, non-overlapping, chunked at ≤60 days over the full 365-day lookback, and collapsing to one overlap-day window on a routine sync; a first-connect `sync_user` proved to issue one explicitly-dated call per window (never `None`/`None`, guarding against `schwab-py`'s own 60-day silent-default), log one line per window naming its bounds and returned count, and dedupe a transaction present in two overlapping windows' payloads to one landed row.
- Extended `sync_windows`' own docstring with the two paragraphs the plan's action text asks for: what remains unmeasured (the real per-call range/rate limits, owed to the first live run) and what the 365-day lookback does not guarantee (a still-open position opened before the window is not recovered).
- `tests/ingest/conftest.py`: `TxFakeSchwabAuth`/`_TxFakeSchwabClient` extended with `responses_by_user_id` (per-user failure/behavior selection, keyed by the connection's own refresh token since `build_client`'s `Protocol` carries no `user_id`), `payload_by_window` and `windows_by_call` (the recording-fake shape Task 3 needed).

## Task Commits

1. **Task 1: The fan-out -- one job per connected user** -- RED: `3598203` (`test(06-02-01)`), GREEN: `860b944` (`feat(06-02-01)`)
2. **Task 2: Repeating the work changes nothing** -- `cf5d6af` (`test(06-02-02)`) -- 4/4 green on arrival, no companion feat
3. **Task 3: First connect reaches back** -- `c3ad4d9` (`test(06-02-03)`) -- 5/5 green on arrival, no companion feat

_TDD note: Task 1's RED was verified as a genuine, unmanufactured red -- `uv run pytest tests/ingest/test_fanout.py -x -q` failed collection with `ImportError: cannot import name 'sync_all_connected_users' from 'morai.ingest.schwab_sync'` (quoted from the real run, before `sync_all_connected_users` existed). Tasks 2 and 3 were genuinely green against plan 06-01's already-correct `insert_fills`/`insert_broker_transactions`/`sync_windows`/`sync_user` on first run -- documented as such per this plan's own red-ceremony rule, with no manufactured red._

## Files Created/Modified

- `src/morai/ingest/schwab_sync.py` -- `sync_all_connected_users`, `sync_windows`' extended docstring
- `src/morai/worker/app.py` -- `sync_all_connected_users_task`, periodic registration alongside the heartbeat
- `tests/ingest/conftest.py` -- `responses_by_user_id`, `payload_by_window`, `windows_by_call`, `last_client`
- `tests/ingest/test_fanout.py` -- fan-out, failure isolation, periodic-defer constraint proof
- `tests/ingest/test_idempotency.py` -- byte-level no-op proof, WR-A3 conflict-clause-safety proof
- `tests/ingest/test_backfill.py` -- pure `sync_windows` proof, recording-fake `sync_user` proof

## Decisions Made

See `key-decisions` in frontmatter -- the superuser-session requirement for `sync_all_connected_users`, the green-on-arrival documentation for Tasks 2/3, and the refresh-token-as-user-id-selector channel for the failure-isolation fake.

## Deviations from Plan

None beyond the discretionary choices already recorded in `key-decisions` and `06-CONTEXT.md`'s "Claude's Discretion" list (idempotency mechanism, per-user fan-out shape) -- both already settled by plan 06-01 and reused here unchanged. `tests/ingest/conftest.py` was touched by Task 3's own action text (extending the recording fake) even though the plan's per-task `<files>` tag for Task 3 lists only `schwab_sync.py`/`test_backfill.py` -- the plan-level `files_modified` frontmatter does include `conftest.py`, and the action text is unambiguous, so this is a frontmatter/action-text granularity gap, not a scope deviation.

## Issues Encountered

None.

## User Setup Required

None -- no new external service configuration this plan. (Plan 06-01's own `MORAI_APP_DB_PASSWORD` worker-service requirement still stands, unchanged here.)

## Next Phase Readiness

Ready for plan 06-03 (sync-run records and manual resync, `INGEST-06`/`INGEST-04`) -- builds directly on `sync_all_connected_users`, the periodic task registration, and the idempotent write paths proved here.

**Facts owed to a first live run, carried forward from plan 06-01 and reaffirmed by this plan's own logging (unchanged, not newly measured this session):**

- **The real per-call transaction range limit and the real rate limit on `get_transactions`.** Every window `sync_user` issues logs its requested bounds and returned element count (`logger.info("sync_user user_id=%s window=%s..%s elements=%d", ...)`, `morai.ingest.schwab_sync`'s own logger) -- proved by this plan's `test_first_connect_calls_are_explicitly_dated_logged_and_dedupe_overlap` to fire once per window with both bounds present in the message. That logging is the instrument the first live run reads; no delay or backoff has been added ahead of an unobserved limit, per `06-RESEARCH.md`'s own recommendation.
- **`D6-01` criterion 1's evidence, quoted from this session's real run against the installed database:**

  ```
  duplicate key value violates unique constraint "procrastinate_periodic_defers_unique"
  DETAIL:  Key (task_name, periodic_id, defer_timestamp)=(sync_all_connected_users, <uuid>, 1000) already exists.
  ```

  Confirmed by direct probe against the live database this session (not only the test assertion) -- the full message is an `asyncpg.exceptions.UniqueViolationError` wrapped by SQLAlchemy's `IntegrityError`, naming the constraint by its real installed name.
- Everything else carried forward from `06-01-SUMMARY.md`'s own "Facts this plan could not verify" list (Schwab's real `activityId` uniqueness guarantee, `transferItems[].price` as `price_usd`'s source, real OCC symbol spacing, the `cost`-sign fallback) is unchanged by this plan -- still owed, still unguessed.

**New full-suite pass count and wall-clock time:** `bash tools/gate.sh` -- ruff, ruff format, basedpyright, mypy all clean; **365 passed** (up from plan 06-01's own 351, +14 net new tests: 5 in `test_fanout.py`, 4 in `test_idempotency.py`, 5 in `test_backfill.py`), pytest wall-clock **49.74s**, full gate wall-clock **54.85s** (against 06-01's own recorded 48.31s gate time -- this plan's tests drain a real Procrastinate worker twice more than 06-01's did, which is the most expensive shape of test in this suite).

---
*Phase: 06-raw-ingest-and-backfill*
*Plan: 02*
*Completed: 2026-09-01*

## Self-Check: PASSED

- All 6 files listed under Key Files (created/modified) confirmed present on disk.
- All 4 commit hashes (`3598203`, `860b944`, `cf5d6af`, `c3ad4d9`) confirmed present via `git log --oneline --all`.
- Full suite (`bash tools/gate.sh`): 365 passed, exit 0, 54.85s wall-clock.
