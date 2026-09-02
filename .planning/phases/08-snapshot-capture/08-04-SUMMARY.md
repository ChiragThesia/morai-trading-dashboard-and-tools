---
phase: 08-snapshot-capture
plan: 04
subsystem: database
tags: [procrastinate, sqlalchemy, postgres-rls, error-classification, scheduler-observability]

requires:
  - phase: 08-snapshot-capture
    provides: "08-01: snapshot_runs table (migration 0015, unwritten), snapshot_user_task's docstring TODO naming this plan as its writer"
  - phase: 08-snapshot-capture
    provides: "08-02: capture_user_snapshot's CaptureOutcome (legs_attempted/marks_written/gaps_by_reason) and SnapshotVendorError, the exact shape this ledger records"
  - phase: 08-snapshot-capture
    provides: "08-03: snapshot_repair.backfill_uncaptured_slot_gaps, the repair missing_capture_slots hands its window to"
provides:
  - "morai.ingest.snapshot_runs -- SnapshotTrigger/SnapshotRunStatus/SnapshotError, classify_snapshot_error, record_snapshot_run/read_snapshot_runs, missing_capture_slots"
  - "worker/app.py: snapshot_user_task's two-session run accounting (success path commits with the capture; failure path records on a second, fresh session)"
affects: [09-reconciliation]

actuals:
  tokens: 14100
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "sync_runs' exact shape mirrored near-verbatim for a second run ledger (D8-15's own Claude's-discretion allowance) -- same two StrEnums, same classified-error StrEnum, same frozen record dataclass, same no-commit write path, same most-recent-first read."
    - "classify_snapshot_error follows exc.__cause__ once before giving up, factored through a shared _classify_by_type_and_status helper applied twice -- the one addition sync_runs' classifier does not need, since capture_user_snapshot's vendor_error branch always chains the original exception via `raise ... from exc`."
    - "missing_capture_slots is pure and delegates to rth_slots_between (imported, never reimplemented) so the run ledger's idea of a slot and the writer's are the same object -- proven structurally (AST: no ast.Await, no rth_-prefixed function defined in the module)."

key-files:
  created:
    - src/morai/ingest/snapshot_runs.py
    - tests/ingest/test_snapshot_runs.py
  modified:
    - src/morai/worker/app.py

key-decisions:
  - "_open_the_seeded_position's test helper calls sync_events after insert_fills, not insert_fills alone -- read_open_legs' is_closed check only needs the fills (net quantity), but Task 3's backfill_uncaptured_slot_gaps also needs opened_at, which derive_position_state derives from real OPEN/ROLL events, mirroring test_snapshot_repair.py's own _seed_leg_with_lifetime discipline (insert_fills + sync_events, never a hand-written events insert)."
  - "Split into three task-scoped commits reconstructed from the final, fully-verified working state rather than built commit-by-commit from scratch -- all three tasks' logic was written and tested together for speed (the module's own shape was fully known up front from mirroring sync_runs), then partitioned into Task 1 (ledger + classifier), Task 2 (worker two-session accounting), Task 3 (missing_capture_slots) with each commit's own snapshot_runs.py/test file verified independently (pytest + ruff + basedpyright) before landing, so each commit is a real, standalone-passing state, not merely a diff slice."
  - "test_manual_trigger_is_recorded_when_passed_through added beyond the plan's numbered Task 2 behaviors -- proves the action text's own claim ('trigger defaults to the scheduled value... a future manual re-capture routes through this same task') rather than leaving it asserted only in a docstring."

requirements-completed: [SNAP-01]

coverage:
  - id: D1
    description: "Every capture attempt leaves exactly one snapshot_runs row naming its slot, trigger, status, legs attempted, marks written and gaps by reason."
    requirement: SNAP-01
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_runs.py::test_successful_capture_job_leaves_one_succeeded_run_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "A capture run that raises still leaves a row, written on a second fresh session opened after the failed session's rollback -- the failure record survives the rollback that erased everything else."
    requirement: SNAP-01
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_runs.py::test_vendor_failure_leaves_one_failed_run_row_that_survives_rollback"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed run's count columns are NULL, not zero -- proven both through the dataclass reader and a direct SQL SELECT against the row."
    requirement: SNAP-01
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_runs.py::test_failed_run_stores_null_counts_and_a_classified_code"
        status: pass
    human_judgment: false
  - id: D4
    description: "A run's error code comes from a fixed enumerated set derived from the exception's type and status code alone, never message text -- structurally proven (no `str` Name node inside classify_snapshot_error's own AST) and behaviorally (a token-shaped message string never reaches the returned code)."
    requirement: SNAP-01
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_runs.py::test_classify_snapshot_error_maps_seven_distinct_classes, test_message_text_never_reaches_the_classified_code, test_chained_vendor_error_classifies_from_its_cause"
        status: pass
    human_judgment: false
  - id: D5
    description: "A stalled job and a real vendor outage are distinguishable by inspecting the data alone -- a slot with a succeeded run and gap rows is an outage, a slot with no run row at all is a job that never fired."
    requirement: SNAP-01
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_runs.py::test_a_stalled_slot_and_a_vendor_outage_are_distinguishable_by_one_query"
        status: pass
    human_judgment: false
  - id: D6
    description: "missing_capture_slots reports every RTH slot in a window with no snapshot_runs row -- pure, delegates to rth_slots_between, proven across a two-hour hole, a failed-run-still-present case, a weekend window, and a daylight-saving transition, then end to end against a simulated worker outage handed off to backfill_uncaptured_slot_gaps."
    requirement: SNAP-01
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_runs.py (six pure Task 3 cases, -m 'not db')"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_snapshot_runs.py::test_missing_capture_slots_names_a_simulated_outage_and_hands_off_to_backfill"
        status: pass
    human_judgment: false
  - id: D7
    description: "The three gap causes (connection_expired, vendor_error, no_market_data via a full connection_expired tally) are counted separately in gaps_by_reason, so a single run row says which happened."
    requirement: SNAP-01
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_runs.py::test_expired_connection_records_a_succeeded_run_with_a_full_gap_tally, test_vendor_failure_gap_rows_are_also_present_in_snapshot_marks"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-09-01
status: complete
---

# Phase 8 Plan 4: Snapshot Run Ledger Summary

**`snapshot_runs` gets its writer: `record_snapshot_run`/`read_snapshot_runs` mirror `sync_runs`' exact shape, `classify_snapshot_error` derives a fixed error code from an exception's type and status code alone (never text, and following `__cause__` once so a chained `SnapshotVendorError` classifies correctly), `snapshot_user_task` gains the two-session split so a failure record survives the rollback that erased everything else, and `missing_capture_slots` turns Procrastinate's own ten-minute `MAX_DELAY` scheduler hole into a queryable fact that hands off cleanly to plan 08-03's repair.**

## Performance

- **Duration:** ~23 min
- **Completed:** 2026-09-01T23:22:59Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `src/morai/ingest/snapshot_runs.py` ships `SnapshotTrigger`/`SnapshotRunStatus`/`SnapshotError` (seven members -- `DATA_KEY_MISSING` and `VENDOR_UNAVAILABLE` are the two new relative to `SyncError`), `classify_snapshot_error` (branches on type and HTTP status code, follows `exc.__cause__` once before giving up so a chained `SnapshotVendorError` classifies from its cause), the frozen `SnapshotRunRecord`, `record_snapshot_run`/`read_snapshot_runs` (no-commit write, most-recent-first read, RLS-scoped), and `missing_capture_slots` (pure, delegates to `rth_slots_between`).
- `worker/app.py::snapshot_user_task` now records a `snapshot_runs` row for every attempt: on success, the run row commits on the same session the capture used; on an exception, that session rolls back (a no-op when `capture_user_snapshot`'s own `vendor_error` branch already committed its gap rows and raised), a second fresh session records the failed run (null counts, classified code), and the function re-raises so `procrastinate_jobs` and `snapshot_runs` agree.
- `tests/ingest/test_snapshot_runs.py` -- 22 tests. Task 1 (8): write/rollback, field-for-field read-back, failed-run NULL counts (dataclass and raw SQL), all seven classified codes plus branch coverage on 401/403/500-504, message-text-never-leaks, chained-cause classification, most-recent-first + limit + RLS positive control, zero-legs-is-a-known-zero. Task 2 (7): successful job leaves one row, vendor failure leaves one failed row surviving rollback, the per-leg `vendor_error` gap rows are also present, expired connection is a succeeded run with a full `connection_expired` tally, zero open legs is a succeeded row with zero counts, a stalled slot and a real outage are distinguishable by one query, and `trigger="manual"` propagates through. Task 3 (7): every-slot-covered returns nothing, a four-slot hole names exactly those instants, a failed run still counts as present, a weekend window reports nothing, structural purity (no `await`), a DST-spanning window matches the grid on both sides, and an end-to-end simulated outage (three real captures, the middle one's rows deleted from all three snapshot tables) is named by `missing_capture_slots` and repaired by `backfill_uncaptured_slot_gaps` into an honest `slot_not_captured` gap with no fabricated mark.

## Task Commits

Each task was committed atomically:

1. **Task 1: The snapshot run ledger and its classified error codes** - `d5074f2` (feat)
2. **Task 2: The two-session run accounting, proven through a real drained job** - `6d7ee39` (feat)
3. **Task 3: `missing_capture_slots` -- making Procrastinate's own scheduler hole visible** - `1f09e11` (feat)

**Plan metadata:** committed separately after this SUMMARY.

_Note: all three tasks are `type="auto"` with `tdd="true"` inside a `type: execute` plan (not `type: tdd`), so each task is one commit, not a RED/GREEN/REFACTOR sequence. All three tasks' logic was developed together against the module's fully-known shape (mirroring `sync_runs` verbatim left little to discover), then partitioned into three task-scoped commits, each independently verified (pytest + ruff + basedpyright) before landing -- see Decisions Made._

## Files Created/Modified

- `src/morai/ingest/snapshot_runs.py` - `SnapshotTrigger`, `SnapshotRunStatus`, `SnapshotError`, `classify_snapshot_error`, `SnapshotRunRecord`, `record_snapshot_run`, `read_snapshot_runs`, `missing_capture_slots`
- `src/morai/worker/app.py` - `snapshot_user_task`'s two-session run accounting
- `tests/ingest/test_snapshot_runs.py` - 22 tests across the three tasks

## Decisions Made

- **`_open_the_seeded_position`'s test helper calls `sync_events` after `insert_fills`, not `insert_fills` alone.** `read_open_legs`' `is_closed` check only needs the fills' net quantity, but Task 3's `backfill_uncaptured_slot_gaps` also needs `opened_at`, which `derive_position_state` derives from real `OPEN`/`ROLL` events -- discovered when Task 3's end-to-end test first returned `gap_rows_written == 0` instead of `2`. Fixed by mirroring `test_snapshot_repair.py`'s own `_seed_leg_with_lifetime` discipline (`insert_fills` + `sync_events`, never a hand-written `events` insert).
- **Three task-scoped commits, reconstructed from a fully-verified working state.** All three tasks' logic was written and tested together, since mirroring `sync_runs`' exact shape (`D8-15`'s own Claude's-discretion allowance) left the whole module's shape known from the start -- there was no genuine task-to-task discovery to sequence around. Rather than commit the whole thing as one diff, the final state was partitioned into Task 1 (ledger + classifier, 8 tests), Task 2 (worker two-session accounting, 7 more tests), and Task 3 (`missing_capture_slots`, 7 more tests), with each commit's own `snapshot_runs.py`/test-file slice independently run through `pytest`, `ruff check`, `ruff format --check` and `basedpyright` before landing -- so each commit is a real, standalone-passing state (matching each task's own acceptance criteria's test-count thresholds: 8, then 15, then 22), not merely a diff slice with no independent meaning.
- **`test_manual_trigger_is_recorded_when_passed_through` added beyond the plan's numbered Task 2 behaviors.** The action text states `trigger` is "threaded through... so a future manual re-capture routes through this same task," but no numbered behavior tested it directly. Added one test proving `trigger="manual"` reaches the stored row's `trigger` column, rather than leaving that claim asserted only in a docstring.

## Deviations from Plan

None beyond the test-fixture correction above (a test-only gap, not a production-code bug -- `capture_user_snapshot`/`backfill_uncaptured_slot_gaps` themselves needed no change). No scope creep: every change stayed inside this plan's own `files_modified` (`src/morai/ingest/snapshot_runs.py`, `src/morai/worker/app.py`, `tests/ingest/test_snapshot_runs.py`).

## Known Stubs

None. `record_snapshot_run` is called from both branches of `snapshot_user_task` (`grep -c 'record_snapshot_run' src/morai/worker/app.py` returns 3 -- the import plus both call sites), proven reachable through the real deferred task and a drained worker in every Task 2 and Task 3 db-marked test, never only a direct function call (Phase 7's own code-review lesson).

## Issues Encountered

None beyond the test-fixture correction documented above, caught by the cheapest honest red (`gap_rows_written == 0` instead of `2`) on the first run of Task 3's end-to-end test, fixed in the same pass.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Phase 9 (reconciliation) can read `snapshot_runs` via `read_snapshot_runs` and call `missing_capture_slots` over any window without further changes -- both are complete, RLS-scoped, and proven against a real drained worker and a simulated outage.
- No blockers. `bash tools/gate.sh` green at 580 passed (558 baseline + 22 new), the 13-calendar oracle gate unchanged (`tests/ledger/test_oracle_gate.py`/`oracle_seed.py` both empty in `git diff --stat`), migration 0015 verified reversible (`upgrade head` → `downgrade -1` → `upgrade head`, ending at `0015 (head)`), and only this plan's own three scoped files were touched (`git status --short` confirms, per-commit).
- All structural (AST-based) acceptance criteria verified directly: `classify_snapshot_error` contains no `str` `Name` node; `snapshot_user_task` contains at least two `AsyncWith` nodes; `missing_capture_slots` contains no `Await` node and the module defines no `rth_`-prefixed function.

---
*Phase: 08-snapshot-capture*
*Plan: 04*
*Completed: 2026-09-01*

## Self-Check: PASSED

- All 3 key files confirmed present on disk: `src/morai/ingest/snapshot_runs.py`, `src/morai/worker/app.py`, `tests/ingest/test_snapshot_runs.py`.
- All 3 task commit hashes confirmed in `git log --oneline`: `d5074f2`, `6d7ee39`, `1f09e11`.
- `bash tools/gate.sh` green: ruff, ruff format, basedpyright strict, mypy strict, full pytest -- 580 passed, 0 failed.
- `tests/ledger/test_oracle_gate.py`/`oracle_seed.py` untouched (`git diff --stat` empty).
- `git status --short` shows only this plan's three scoped files touched across all three task commits.
- Migration 0015 reversibility verified live: `alembic upgrade head` → `downgrade -1` → `upgrade head`, ending at `0015 (head)`.
- Structural AST checks re-run and passing: no `str` in `classify_snapshot_error`; `snapshot_user_task` has ≥2 `AsyncWith`; `missing_capture_slots` has no `Await`; no `rth_`-prefixed function defined in `snapshot_runs.py`.
