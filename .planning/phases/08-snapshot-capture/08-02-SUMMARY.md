---
phase: 08-snapshot-capture
plan: 02
subsystem: database
tags: [postgres-asymmetric-upsert, sqlalchemy-on-conflict, zoneinfo-rth-grid, procrastinate, gap-semantics]

requires:
  - phase: 08-snapshot-capture
    provides: "08-01's migration 0015 (three tables, gap-xor-payload CHECK), the wire-symbol codec, parse_quote_payload, capture_user_snapshot's healthy-path shell, and the asymmetric on_conflict_do_update(...where=...) clause itself"
provides:
  - "The asymmetric upsert's where= clause proven against real Postgres, all four truth-table cells plus corrective-backfill, adjacency and key-discrimination, with a firing positive control"
  - "capture_user_snapshot's connection_expired and vendor_error gap branches -- an honest gap replaces every silent skip 08-01 left as this plan's own scope"
  - "gap_writes_for_legs / SnapshotVendorError -- the one place a whole-slot gap fan-out is built, and the typed error the vendor-failure branch raises"
  - "rth_slot_for/rth_slots_between proven correct across both daylight-saving directions, both weekend boundaries, and the two empty-work-list cases"
affects: [08-03-repair-path, 08-04-run-ledger, 09-reconciliation]

actuals:
  tokens: 18264
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Database-level guard proven directly against Postgres through the real writer, never a hand-written insert -- tests/ledger/test_roll_check_constraint.py's own convention, extended to a four-cell truth table with a firing positive control."
    - "A gap branch that raises commits its own gap rows before raising, when the caller that would normally own that commit is out of this plan's scope for the wave -- documented as a deliberate, narrow exception to 'the shell never commits'."
    - "Per-test @pytest.mark.db decorators replacing a module-level pytestmark once a test module needs to mix pure and db-backed tests."

key-files:
  created:
    - tests/ingest/test_snapshot_gap_upsert.py
  modified:
    - src/morai/ingest/snapshots.py
    - tests/ingest/test_snapshot_capture.py

key-decisions:
  - "Missing connection and expired connection folded into one branch, both writing connection_expired gap rows -- 08-01's own docstring named this as this plan's scope, and criterion 5's reasoning (\"the row must exist\") applies identically to either cause."
  - "The vendor_error branch commits inside capture_user_snapshot before raising, the one place this function departs from its own 'caller owns the transaction' convention -- worker/app.py is 08-03's file this wave (parallel, not in scope), so the caller-side two-session split sync_user_task uses for the identical problem was not available; without the early commit, the gap rows would roll back when the session's own exception-exit discarded the uncommitted transaction."
  - "Task 3's pure RTH-grid tests forced test_snapshot_capture.py off its blanket pytestmark = pytest.mark.db onto per-test @pytest.mark.db decorators (all 11 db-backed tests in the file), since the module now also holds tests that must run with -m 'not db'."
  - "Test 4 (three gap reasons distinguishable) and the half-day/empty-position tests (7, 8) drive capture_user_snapshot directly rather than through the deferred snapshot_user task, so their own observed_at is explicit and controllable -- task-based tests (2, 3, 5, 9) needed a token_created_at relative to the real wall clock instead, since worker/app.py::snapshot_user_task (out of scope) reads datetime.now(UTC) internally, not the slot time."

requirements-completed: [SNAP-02, SNAP-03, SNAP-05]

coverage:
  - id: D1
    description: "All four cells of the asymmetric ON CONFLICT ... DO UPDATE ... WHERE clause (real-over-nothing, real-over-gap, gap-over-nothing, gap-blocked-by-real) proven against real Postgres for both write_snapshot_marks and write_snapshot_observations, plus corrective-backfill, adjacency, ordering and key-discrimination."
    requirement: SNAP-03
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_gap_upsert.py (13 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A temporary inversion of the where= clause's second disjunct makes exactly test_gap_blocked_by_real_leaves_row_unchanged[marks] fail, proving the assertion can fire rather than passing vacuously; reverted before commit (git diff empty on snapshots.py)."
    requirement: SNAP-03
    verification:
      - kind: manual_procedural
        ref: "Positive control performed live this session -- see Deviations/Verification section below for the observed AssertionError."
        status: pass
    human_judgment: false
  - id: D3
    description: "An expired or missing connection writes a connection_expired gap per open leg with no vendor call attempted, asserted on the fake auth's own last_client staying None."
    requirement: SNAP-05
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py::test_expired_connection_writes_gap"
        status: pass
    human_judgment: false
  - id: D4
    description: "A whole-get_quotes-call failure writes a vendor_error gap per open leg AND fails the job (procrastinate_jobs and the data agree)."
    requirement: SNAP-02
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py::test_vendor_call_failure_writes_gap_and_raises"
        status: pass
    human_judgment: false
  - id: D5
    description: "A partial response gaps only the missing symbol's leg -- one bad element does not abort the other leg's own write (D8-16)."
    requirement: SNAP-02
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py::test_partial_response_gaps_only_the_missing_leg"
        status: pass
    human_judgment: false
  - id: D6
    description: "Three distinct gap reasons (connection_expired, vendor_error, no_market_data) coexist and are distinguishable by one query, not only in a log (L043)."
    requirement: SNAP-02
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py::test_three_gap_reasons_are_distinguishable_in_the_data"
        status: pass
    human_judgment: false
  - id: D7
    description: "One user's vendor failure does not starve another user's capture job (D8-16's per-user isolation grain)."
    requirement: SNAP-02
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py::test_one_users_vendor_failure_leaves_the_other_users_job_succeeded"
        status: pass
    human_judgment: false
  - id: D8
    description: "Two concurrent captures for the same user and slot serialise on the per-user advisory lock and leave exactly one row per leg (SNAP-05's concurrency half, the plan's own backstop truth)."
    requirement: SNAP-05
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py::test_two_concurrent_captures_for_one_user_and_slot_land_one_row_per_leg"
        status: pass
    human_judgment: false
  - id: D9
    description: "rth_slot_for is correct across both daylight-saving directions (asserted on the UTC hour), both weekend boundaries, and the 14-slot ordinary-day grid; rth_slots_between has no duplicate or missing instant across a spring-forward-spanning window; both functions proven pure by AST walk."
    verification:
      - kind: unit
        ref: "tests/ingest/test_snapshot_capture.py (15 pure tests, -m 'not db')"
        status: pass
    human_judgment: false
  - id: D10
    description: "A half day (fake omits the afternoon quote) produces honest no_market_data gaps with no calendar special-casing; a user with zero open positions writes nothing; a periodic tick for a user with no open position defers, drains, and succeeds with zero rows written."
    verification:
      - kind: integration
        ref: "tests/ingest/test_snapshot_capture.py (3 db-marked tests: half-day, zero-positions, periodic-tick-empty)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-09-01
status: complete
---

# Phase 8 Plan 2: Gap Semantics — Asymmetric Upsert, Vendor Failure Isolation, RTH Grid Summary

**The database-level asymmetric upsert (`gap may never overwrite real, real always may heal gap`) proven against real Postgres with a firing positive control; `capture_user_snapshot` wired with `connection_expired` and `vendor_error` gap branches at both isolation grains; and the 30-minute Eastern RTH grid proven correct across both daylight-saving directions with no Postgres required.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-09-01T22:55:18Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `tests/ingest/test_snapshot_gap_upsert.py` proves all four cells of `D8-10`'s asymmetric `ON CONFLICT ... DO UPDATE ... WHERE` clause against real Postgres for both `write_snapshot_marks` and `write_snapshot_observations`, plus the corrective-backfill, adjacency (`D8-12`), ordering, and key-discrimination (`NN-1`/`L001`/`L002`) cases — 13 tests, the blocked cell asserted on raw ciphertext bytes rather than a decrypted comparison.
- A positive control was performed live this session: temporarily inverting the `where=` clause's second disjunct (`SnapshotMark.gap_reason.isnot(None)` → `.is_(None)`) made `test_gap_blocked_by_real_leaves_row_unchanged[marks]` fail with `AssertionError: assert 'no_market_data' == None` — the gap overwrote the real row exactly as the inverted clause would allow — proving the assertion fires rather than passing vacuously. Reverted immediately; `git diff` on `snapshots.py` was empty before that task's commit.
- `capture_user_snapshot` (`src/morai/ingest/snapshots.py`) gained `gap_writes_for_legs` (the one place a whole-slot gap fan-out is built) and two new branches: a missing-or-expired connection writes `connection_expired` gaps with no vendor call attempted at all; a whole-`get_quotes`-call failure writes `vendor_error` gaps, commits them, and raises `SnapshotVendorError` chained from the original exception (`NN-20`, `NN-34`).
- Isolation proven at both grains D8-16 names: per-symbol (a partial response gaps only the missing leg) and per-user (one user's vendor failure does not starve another user's job, mirroring `tests/ingest/test_fanout.py`'s own identical proof for `sync_user`).
- `rth_slot_for`/`rth_slots_between` proven correct across both daylight-saving directions (asserted on the UTC hour, so a fixed-offset implementation cannot pass both), both weekend boundaries, the 14-slot ordinary-day enumeration, a spring-forward-spanning window with no duplicate/missing instant, and structural purity (AST walk, no clock read) — 15 tests requiring no Postgres at all (`-m "not db"`).
- A half day, a user with zero open positions, and a periodic tick for a position-less user all complete honestly: gaps where data is genuinely absent, zero rows where there is nothing to capture, never a raise.

## Task Commits

Each task was committed atomically:

1. **Task 1: The four-cell upsert truth table, against real Postgres** - `fb07a8c` (test)
2. **Task 2: The three gap causes, distinguishable in the data, with isolation at both grains** - `863aac0` (feat)
3. **Task 3: The RTH grid — daylight saving, half days, and the empty cases** - `cb8d7d6` (test)

**Plan metadata:** committed separately after this SUMMARY.

_Note: all three tasks are `type="auto"` with `tdd="true"` inside a `type: execute` plan (not `type: tdd`), so each task is one commit, not a RED/GREEN/REFACTOR sequence. Task 1 and 3's natural red was the assertion suite itself (existing production code from 08-01 already satisfied every case on first run); Task 2's natural red was four genuine `AssertionError`/DB errors, fixed via two categories documented below._

## Files Created/Modified

- `tests/ingest/test_snapshot_gap_upsert.py` — the four-cell truth table (13 tests), parametrized over both writers, plus adjacency/ordering/key-discrimination
- `src/morai/ingest/snapshots.py` — `SnapshotVendorError`, `gap_writes_for_legs`, `capture_user_snapshot`'s two new gap branches
- `tests/ingest/test_snapshot_capture.py` — 6 tests for the three gap causes and isolation (Task 2), 18 tests for the RTH grid and empty cases (Task 3), converted from a blanket `pytestmark` to per-test `@pytest.mark.db`

## Decisions Made

- **Missing connection folded into the expired-connection branch.** Both mean "no vendor call is possible"; 08-01's own docstring named this as this plan's scope, and criterion 5's reasoning applies identically to either cause.
- **`capture_user_snapshot` commits before raising in the `vendor_error` branch** — the one place this function departs from "the caller owns the transaction." `worker/app.py` is 08-03's file this wave (parallel, out of scope), so the caller-side two-session split `sync_user_task` uses for the identical problem was unavailable here. Without the early commit, the gap rows would roll back when the session's own exception-exit discarded the uncommitted transaction, making criterion 5's "the row must exist" false. Documented in the function's own docstring and inline comment.
- **`pytestmark = pytest.mark.db` replaced with per-test decorators** in `test_snapshot_capture.py`. Task 3's RTH-grid tests are pure and must run with `-m "not db"`; a module-level blanket marker would have forced them onto Postgres for no reason.
- **`_healthy_token_created_at_now()` vs `_HEALTHY_TOKEN_CREATED_AT_FOR_SLOTS`.** Tests that drive `capture_user_snapshot` directly (Test 4, half-day, zero-positions) pass an explicit `observed_at`, so a fixed historical `token_created_at` near the slot times is correct. Tests that go through the real `snapshot_user_task` (Tests 2, 3, 5, 9) read `datetime.now(UTC)` internally (`worker/app.py`, out of scope) rather than the slot time — a fixed historical date there reads as EXPIRED against the real wall clock, so those tests compute `token_created_at` relative to `datetime.now(UTC)` at call time instead, mirroring `_seed_connection`'s own D3-14 discipline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 2's test-side token_created_at read as EXPIRED against the real wall clock**
- **Found during:** Task 2, first full run of the new test file
- **Issue:** Tests going through the real deferred `snapshot_user` task compute connection health against `datetime.now(UTC)` (read inside `worker/app.py`, out of this plan's scope), not the fixture's `_SLOT_TIME` constants. A `_HEALTHY_TOKEN_CREATED_AT` fixed to `2026-06-14` (near the slot times) was ~79 days in the past relative to the real September 2026 wall clock the test suite runs under — past the seven-day refresh-token lifetime, so three tests silently took the `connection_expired` branch instead of reaching the vendor call at all.
- **Fix:** Split the constant: `_HEALTHY_TOKEN_CREATED_AT_FOR_SLOTS` (fixed, used only where `observed_at` is passed explicitly) and `_healthy_token_created_at_now()` (computed fresh, `datetime.now(UTC) - timedelta(hours=1)`, used by every task-based test).
- **Files modified:** `tests/ingest/test_snapshot_capture.py`
- **Verification:** All previously-failing tests pass; `bash tools/gate.sh` green.
- **Committed in:** `863aac0` (Task 2 commit)

**2. [Rule 1 - Bug] A premature commit inside a test broke a later RLS-protected read**
- **Found during:** Task 2, same run
- **Issue:** `test_three_gap_reasons_are_distinguishable_in_the_data` called `await app_db_session.commit()` after its third `capture_user_snapshot` call, ending the transaction and resetting the transaction-local `app.current_user_id` GUC to the empty string (`connections.py`'s own documented behaviour) before the verification `SELECT` ran in a new, unconfigured transaction — Postgres rejected the RLS policy's own `::uuid` cast on the empty string.
- **Fix:** Removed the premature commit; the verification query now runs inside the same still-open transaction `capture_user_snapshot`'s own first action already configured.
- **Files modified:** `tests/ingest/test_snapshot_capture.py`
- **Verification:** Test passes; documented inline with the mechanism so a future reader does not reintroduce the same commit.
- **Committed in:** `863aac0` (Task 2 commit)

**3. [Rule 3 - Blocking] Ruff line-length and formatting fixes**
- **Found during:** Task 2, `bash tools/gate.sh` run
- **Issue:** Three lines over 88 characters (an `ExchangedToken(...)` call, a dataclass field, a docstring reference) and one extra blank line ruff format wanted collapsed.
- **Fix:** Wrapped the three long lines; ran `uv run ruff format` to apply the blank-line fix.
- **Files modified:** `tests/ingest/test_snapshot_capture.py`
- **Verification:** `bash tools/gate.sh` green.
- **Committed in:** `863aac0` (Task 2 commit)

---

**Total deviations:** 3 (2 Rule 1 test-correctness bugs, 1 Rule 3 lint fix). All three were caught by the "cheapest honest red" the tests themselves produced, fixed in the same task, no production-code correctness bug was hiding behind either Task 2 fix — both were test-fixture construction errors, not `snapshots.py` bugs.
**Impact on plan:** No scope creep. Every fix stayed inside the columns/files this plan itself owns.

## Known Stubs

None. Every gap branch this plan owns (`connection_expired`, `vendor_error`) is fully wired and proven end to end. `slot_not_captured` (plan 08-03's own scope) and `snapshot_runs`' writer (plan 08-04's own scope) remain intentional, named absences from before this plan — unchanged by it.

## Issues Encountered

None beyond the deviations documented above. `bash tools/gate.sh` reached green on the first run after each task's fixes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 08-03 (repair path, SNAP-04) can build directly on `gap_writes_for_legs`, `SnapshotVendorError`, and both asymmetric writers, all proven correct — it owns `worker/app.py`, `src/morai/ingest/snapshot_repair.py`, `tools/repair_snapshots.py`, and `tests/ingest/test_snapshot_repair.py`, none of which this plan touched.
- Plan 08-04 (run ledger, D8-15) has `snapshot_runs`' table shape unchanged and ready; this plan's own `capture_user_snapshot` docstring records that `snapshot_user_task`'s own commit line is bypassed on the `vendor_error` path specifically, which 08-04's run-record writer should account for when it eventually wraps this same task.
- No blockers. `bash tools/gate.sh` green at 535 passed (517 baseline after this plan's Task 2 + 18 new in Task 3; 459 phase-1 baseline + 76 new across this whole plan), the 13-calendar oracle gate unchanged (`tests/ledger/test_oracle_gate.py`/`oracle_seed.py` untouched per `git diff --stat`), and only the three files this plan's own `files_modified` names were touched (`git status --short` confirms).

---
*Phase: 08-snapshot-capture*
*Plan: 02*
*Completed: 2026-09-01*

## Self-Check: PASSED

- All 4 key files confirmed present on disk (`ls -la`): `tests/ingest/test_snapshot_gap_upsert.py`, `src/morai/ingest/snapshots.py`, `tests/ingest/test_snapshot_capture.py`, this SUMMARY.
- All 3 task commit hashes confirmed in `git log --oneline`: `fb07a8c`, `863aac0`, `cb8d7d6`.
- `bash tools/gate.sh` green: ruff, ruff format, basedpyright strict, mypy strict, full pytest — 535 passed, 0 failed.
- `tests/ledger/test_oracle_gate.py`/`oracle_seed.py` untouched (`git diff --stat` empty).
- `git status --short` confirms only this plan's own `files_modified` (plus this SUMMARY) were touched; `tests/ingest/conftest.py` untouched.
- The positive control (inverting the `where=` clause's second disjunct) was performed live and its `AssertionError` observed before revert; `git diff -- src/morai/ingest/snapshots.py` was empty immediately before that task's commit, confirming the revert was exact.
