---
phase: 08-snapshot-capture
plan: 03
subsystem: database
tags: [procrastinate, sqlalchemy, postgres-rls, aes-gcm-envelope-encryption, repair-path, cli]

requires:
  - phase: 08-snapshot-capture
    provides: "08-01: snapshot_observations/snapshot_marks tables, write_snapshot_observations/write_snapshot_marks asymmetric upsert, parse_quote_payload, to_schwab_wire_symbol, rth_slots_between -- this plan imports all of them and modifies none"
provides:
  - "morai.ingest.snapshot_repair -- read_snapshot_observations, repair_snapshot_marks, backfill_uncaptured_slot_gaps"
  - "worker/app.py: repair_snapshot_marks_task (on-demand Procrastinate task, no periodic decorator)"
  - "tools/repair_snapshots.py -- the second entry point, CLI over the identical repair_snapshot_marks/backfill_uncaptured_slot_gaps functions"
affects: [08-04-run-ledger, 09-reconciliation]

actuals:
  tokens: 16342
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Module-qualified call (snapshot_repair.repair_snapshot_marks(...)), not an aliased from-import, at both entry points -- the only shape that lets a test patch the function at its defining module and observe both the worker task and the CLI reach the identical object (D8-13's own anti-drift requirement)."
    - "RLS-context re-assertion on every write/read within one test session -- set_config(..., true) is transaction-local and reverts to '' (not NULL) across a commit boundary inside the same session, discovered empirically this plan and now a named convention in every test helper's own docstring."
    - "Pre-filter-then-write for idempotent backfill: query existing (leg_id, slot_time) pairs once, write only for the missing set -- lets the asymmetric upsert's own WHERE clause do the real-vs-gap blocking with no second implementation of that rule in the backfill itself."

key-files:
  created:
    - src/morai/ingest/snapshot_repair.py
    - tools/repair_snapshots.py
    - tests/ingest/test_snapshot_repair.py
  modified:
    - src/morai/worker/app.py

key-decisions:
  - "snapshot_repair.py split into three task-scoped commits rather than one: Task 1 (read_snapshot_observations/repair_snapshot_marks), Task 2 (worker task + CLI wrapper, --backfill-gaps accepted but not yet dispatched), Task 3 (backfill_uncaptured_slot_gaps + wiring --backfill-gaps to it). Each commit's own bash tools/gate.sh passes standalone -- Task 2's CLI intentionally does not call backfill_uncaptured_slot_gaps yet, since that function does not exist until Task 3, and calling a not-yet-existing module attribute would fail mypy's attr-defined check."
  - "Both entry points call the shared function through the module object (from morai.ingest import snapshot_repair; snapshot_repair.repair_snapshot_marks(...)), not an aliased from-import -- discovered mid-Task-2 that an aliased import binds a separate name at import time that a later monkeypatch on the defining module does not reach, which would have made Task 2's own anti-drift patch test (D8-13) pass for the wrong reason (or fail outright)."
  - "backfill_uncaptured_slot_gaps queries existing (leg_id, slot_time) pairs from snapshot_observations before writing, rather than relying solely on the asymmetric upsert's WHERE clause -- this is what makes a second run's gap_rows_written genuinely 0 (not a same-value no-op update) and needs no special case for an already-real slot, per the plan's own instruction."
  - "Test fixtures for backfill's opened_at/closed_at behavior go through insert_fills + sync_events (the real write paths), never a hand-written events insert -- each test uses its own distinct occ_symbol so resolve_fill_positions has nothing ambiguous to resolve against a sibling test's rows."

requirements-completed: [SNAP-04]

coverage:
  - id: D1
    description: "repair_snapshot_marks rebuilds snapshot_marks from the raw observations actually stored, with no vendor call, structurally proven by an AST import scan."
    requirement: SNAP-04
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_repair_writes_real_marks_from_stored_observations_with_no_prior_marks"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_snapshot_repair_module_imports_no_vendor_or_schwab_module"
        status: pass
    human_judgment: false
  - id: D2
    description: "A mark written wrong by a parsing bug is corrected by re-running the repair over the unchanged stored observation; a real mark is never overwritten by a rebuilt gap."
    requirement: SNAP-04
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_repair_corrects_a_wrong_real_mark_from_the_stored_observation"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_repair_blocked_by_an_existing_real_mark_leaves_it_byte_identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both entry points -- the Procrastinate task and the tools/ CLI -- call the identical repair_snapshot_marks/backfill_uncaptured_slot_gaps functions, proven by patching the shared function at its defining module and observing both call paths."
    requirement: SNAP-04
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_repair.py#test_both_entry_points_call_the_identical_repair_function"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_snapshot_repair.py#test_cli_backfill_gaps_flag_reaches_the_shared_function"
        status: pass
    human_judgment: false
  - id: D4
    description: "The worker path is exercised through a real deferred Procrastinate job and a drained worker, not a direct function call; the task asserts it cannot bypass RLS before touching a protected table."
    requirement: SNAP-04
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_repair.py#test_repair_snapshot_marks_job_rebuilds_marks_via_a_drained_worker"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_snapshot_repair.py#test_repair_task_asserts_rls_before_touching_a_protected_table"
        status: pass
    human_judgment: false
  - id: D5
    description: "backfill_uncaptured_slot_gaps writes an honest slot_not_captured gap for a slot with no stored row, bounded by the leg's own derived open lifetime, and is idempotent on a second run -- never writes a value."
    requirement: SNAP-04
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_backfill_writes_slot_not_captured_gaps_for_missing_slots_only"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_backfill_skips_a_slot_before_the_legs_position_opened"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_backfill_skips_a_slot_after_the_legs_position_closed"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_backfill_is_idempotent_on_a_second_run"
        status: pass
    human_judgment: false
  - id: D6
    description: "The CLI is runnable and rejects a non-UUID user id without echoing it back; --help names every option including --backfill-gaps."
    requirement: SNAP-04
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_cli_rejects_a_non_uuid_user_id_without_echoing_it"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_snapshot_repair.py#test_cli_help_exits_zero_and_names_every_option"
        status: pass
      - kind: other
        ref: "uv run python tools/repair_snapshots.py --help (shell invocation, exit 0)"
        status: pass
    human_judgment: false

duration: ~90min
completed: 2026-09-01
status: complete
---

# Phase 8 Plan 3: Snapshot Repair Path Summary

**`repair_snapshot_marks` rebuilds every mark from the raw payloads 08-01 already stores, re-parsing through the identical pure `parse_quote_payload` the live writer uses so a repair can never derive a different value from the same bytes; `backfill_uncaptured_slot_gaps` turns Procrastinate's own ten-minute `MAX_DELAY` blind spot into an honest, queryable `slot_not_captured` gap instead of a silent hole; and both functions ship as a Procrastinate task and a `tools/` CLI over one shared function, proven identical by patching it at its defining module.**

## Performance

- **Duration:** ~90 min
- **Completed:** 2026-09-01T22:48:27Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `src/morai/ingest/snapshot_repair.py` ships `read_snapshot_observations` (joins `snapshot_observations` to `legs`, decrypts each row under its own stored `key_version` via `dek_for_version`, never `current_dek`), `repair_snapshot_marks` (re-parses via `parse_quote_payload`/`to_schwab_wire_symbol` and writes through `write_snapshot_marks`'s existing asymmetric upsert), and `backfill_uncaptured_slot_gaps` (walks `rth_slots_between`, keeps a leg for a slot only inside its position's own derived `opened_at`/`closed_at` window via `read_position_state`, writes a `slot_not_captured` gap through both writers for every `(leg_id, slot_time)` pair with no stored row at all). No import from `morai.vendor` or `schwab` anywhere in the module -- asserted by an AST walk, not a comment.
- `worker/app.py` adds `repair_snapshot_marks_task` (`@app.task(name="repair_snapshot_marks")`, no `@app.periodic` -- repair is operator-triggered, not on a cadence), a thin wrapper opening a `morai_app` session and asserting it cannot bypass RLS before touching a protected table, mirroring `snapshot_user_task` exactly.
- `tools/repair_snapshots.py` is the second entry point: with a user id, repairs that user (or backfills, with `--backfill-gaps START END`); without one, lists distinct `user_id` values from `snapshot_observations` on the superuser engine (one column, no ciphertext, no write) and repairs each under its own RLS context. Rejects a non-UUID argument with a message that never echoes the bad value.
- Both entry points reach the identical shared function through `from morai.ingest import snapshot_repair; snapshot_repair.repair_snapshot_marks(...)` -- a module-qualified call, not an aliased `from X import Y`, which is what lets a test patch the function at its own defining module and observe both the drained worker job and the CLI call the same object (D8-13).
- `tests/ingest/test_snapshot_repair.py` -- 23 tests across the three tasks: rebuild-from-scratch, heal-a-gap, correct-a-wrong-mark, the no-vendor-call AST scan, gap-rewrites-gap, blocked-by-real-mark, `since` windowing, zero observations, a seeded second `key_version`, a payload that no longer parses; a real deferred `repair_snapshot_marks` job drained by a real worker, the RLS assertion observed via a spy, the anti-drift patch test, the CLI with and without a user id, the non-UUID rejection, `--help`, no reimplemented parser; missing-slot gaps with existing rows untouched, opened-after/closed-before exclusion, second-run idempotency, and the CLI's `--backfill-gaps` flag reaching the shared function.

## Task Commits

Each task was committed atomically:

1. **Task 1: `repair_snapshot_marks` -- rebuild every mark from the stored raw observations, with no vendor call** - `54163bf` (feat)
2. **Task 2: Two entry points, one function -- the Procrastinate task and the runnable CLI** - `09a529d` (feat)
3. **Task 3: An honest gap for a slot the scheduler never fired** - `abcce5a` (feat)

**Plan metadata:** committed separately after this SUMMARY.

## Files Created/Modified

- `src/morai/ingest/snapshot_repair.py` - `StoredObservation`, `RepairOutcome`, `BackfillOutcome`, `read_snapshot_observations`, `repair_snapshot_marks`, `backfill_uncaptured_slot_gaps`
- `src/morai/worker/app.py` - `repair_snapshot_marks_task`
- `tools/repair_snapshots.py` - the CLI, `main(argv)`, `--since`/`--backfill-gaps` handling, the superuser listing-only fan-out
- `tests/ingest/test_snapshot_repair.py` - 23 tests, all `@pytest.mark.db`

## Decisions Made

- **Module-qualified calls, not aliased imports, at both entry points.** Discovered mid-Task-2: `from morai.ingest.snapshot_repair import repair_snapshot_marks as run_repair_snapshot_marks` binds a separate name at import time, so a test that later patches `morai.ingest.snapshot_repair.repair_snapshot_marks` (the defining module) would not reach the aliased reference in either wrapper. Both `worker/app.py` and `tools/repair_snapshots.py` instead `from morai.ingest import snapshot_repair` and call `snapshot_repair.repair_snapshot_marks(...)`/`snapshot_repair.backfill_uncaptured_slot_gaps(...)`, resolved fresh at call time -- this is what makes Task 2's and Task 3's own anti-drift patch tests (D8-13) mean what they claim to mean.
- **Task-scoped `snapshot_repair.py` growth, not one big file written up front.** Task 2's own commit accepts `--backfill-gaps` in argparse (so `--help` names it, satisfying the plan's "the CLI is written once") but does not dispatch to `backfill_uncaptured_slot_gaps` -- that function does not exist until Task 3's own commit. Calling a not-yet-existing module attribute would have failed `mypy`'s `attr-defined` check inside Task 2's own `bash tools/gate.sh` run, which each task's acceptance criteria requires to pass standalone.
- **`set_config('app.current_user_id', :uid, true)` reverts to `''`, not `NULL`, once its transaction commits.** Measured directly this plan (a small diagnostic script against the live cluster): a fresh session's `current_setting(..., true)` returns `NULL`, but after one `set_config(..., true)` + `COMMIT` on the same session, it returns `''` -- and `current_setting(...)::uuid` on `''` raises `InvalidTextRepresentationError` rather than evaluating to `NULL`. Every test helper that writes or reads more than once per session (`_seed_observation`, `_seed_mark`, `_read_mark_row`, `_decrypt_mark_usd`) now re-asserts the RLS context on every call, documented in each helper's own docstring so the next test file in this suite doesn't rediscover it the hard way.
- **Backfill test fixtures use `insert_fills` + `sync_events`, not a hand-written `events` insert.** `PositionState.opened_at`/`closed_at` are derived from real `OPEN`/`CLOSE` events (`derive_position_state`), not from fills directly -- a hand-inserted `events` row would test a shape `backfill_uncaptured_slot_gaps` never actually reads through `read_position_state`'s real path. Each test seeds its own distinct `occ_symbol` so `resolve_fill_positions` has nothing ambiguous to resolve against a sibling test's or fixture's rows.

## Deviations from Plan

None - plan executed exactly as written. The two design decisions above (module-qualified calls; task-scoped `--backfill-gaps` wiring split across Tasks 2 and 3) are implementation choices within the plan's own stated task boundaries, not deviations from what the plan specified -- Task 2's own action text explicitly names `--backfill-gaps` as "Task 3's entry point, wired here so the CLI is written once," which is exactly the split committed.

## Known Stubs

None. Both `repair_snapshot_marks` and `backfill_uncaptured_slot_gaps` are fully wired to both entry points and covered by tests exercising the real production call path (a drained Procrastinate job and a direct CLI `main()` invocation).

## Issues Encountered

None beyond the two mid-flight design corrections documented above under "Decisions Made" (the module-qualified-call fix and the RLS-context-reassertion fix), both caught by the gate/test run that immediately followed the change that introduced them, before any task commit landed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 08-04 (run ledger, `snapshot_runs`, D8-15) can write `snapshot_runs` rows around either entry point's own call without any change to this plan's functions -- neither `repair_snapshot_marks` nor `backfill_uncaptured_slot_gaps` commits its own transaction, so a caller-owned `snapshot_runs` write composes naturally in the same transaction.
- No blockers. `bash tools/gate.sh` green at 521 passed (498 baseline + 23 new), the 13-calendar oracle gate unchanged (`tests/ledger/test_oracle_gate.py`/`tests/ledger/oracle_seed.py` both empty in `git diff --stat`), and only this plan's own four scoped files were modified (`src/morai/ingest/snapshot_repair.py`, `src/morai/worker/app.py`, `tools/repair_snapshots.py`, `tests/ingest/test_snapshot_repair.py`) -- `src/morai/ingest/snapshots.py` and `tests/ingest/conftest.py`, both owned by the concurrent 08-02 agent this wave, are untouched.

---
*Phase: 08-snapshot-capture*
*Plan: 03*
*Completed: 2026-09-01*

## Self-Check: PASSED

- All 4 key files confirmed present on disk: `src/morai/ingest/snapshot_repair.py`, `src/morai/worker/app.py`, `tools/repair_snapshots.py`, `tests/ingest/test_snapshot_repair.py`.
- All 3 task commit hashes confirmed in `git log --oneline`: `54163bf`, `09a529d`, `abcce5a`.
- `bash tools/gate.sh` green: ruff, ruff format, basedpyright strict, mypy strict, full pytest -- 521 passed (498 baseline + 23 new), 0 failed.
- `tests/ledger/test_oracle_gate.py` passes (15 tests) and `git diff --stat -- tests/ledger/test_oracle_gate.py tests/ledger/oracle_seed.py` is empty (untouched).
- `uv run python tools/repair_snapshots.py --help` exits 0 and names `user_id`, `--since`, `--backfill-gaps`.
- `uv run python tools/repair_snapshots.py not-a-uuid` exits 2 without echoing the value.
- AST scans confirmed live: no `morai.vendor`/`schwab` import in `snapshot_repair.py`; no `rth_slot`-prefixed function defined there; no `parse_quote`-prefixed function defined in `tools/repair_snapshots.py`.
- `git status --short` shows only this plan's four scoped files touched across all three task commits; `src/morai/ingest/snapshots.py` and `tests/ingest/conftest.py` (08-02's own scope this wave) carry no diff from this plan.
