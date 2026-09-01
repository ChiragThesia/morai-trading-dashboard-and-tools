---
phase: 07-position-and-campaign-read-models
plan: 02
subsystem: database
tags: [sqlalchemy, postgres, tdd, closed-state, read-model]

requires:
  - phase: 07-position-and-campaign-read-models
    plan: 01
    provides: "positions.py's plan_positions/create_positions, the write-token sentinels, sync_user wiring"
provides:
  - "src/morai/ledger/positions.py -- LegNet/PositionState/LegRow dataclasses, net_quantity_for_leg (pure), derive_position_state (pure), read_position_state (async shell) -- the closed-state read model, LEDGER-05"
  - "Every reader (routes_identity.py, three test files) moved off the stored positions.opened_at/closed_at columns, with the columns still present in the database"
affects: [07-04 (campaign chain, security_invoker regression test), 07-05, phase 8 (repricing), phase 9 (reconciliation), phase 11 (review API)]

actuals:
  tokens: 8757
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Pure-function + thin-shell split (derive_position_state/read_position_state), mirroring plan_positions/create_positions and derive_events/sync_events exactly"
    - "A shared-symbol-safe async read shell: read_position_state scopes fills via resolve_fill_positions (not a bare occ_symbol match) and events via a position_id filter, so hard case 1's shared front leg cannot leak a sibling position's fills into this one's derivation"

key-files:
  created:
    - tests/ledger/test_closed_state.py
  modified:
    - src/morai/ledger/positions.py
    - src/morai/api/routes_identity.py
    - tests/ledger/oracle_seed.py
    - tests/ledger/test_pairing_shared_leg.py
    - tests/ledger/test_pairing_no_position_state.py

key-decisions:
  - "read_position_state scopes fills through resolve_fill_positions (the existing order-anchor disambiguation), not a bare occ_symbol match against read_fills -- a shared-leg symbol (hard case 1, calendars 8a63aa81/6303e6af) would otherwise let a sibling position's fills leak into this position's net-quantity computation. No task acceptance criterion exercises this directly, but it is the same correctness class D7-03/NN-11 already govern, so it was applied as Rule 2 (missing critical functionality) rather than left as a known gap."
  - "test_pairing_shared_leg.py's replacement ordering sorts ORACLE_CALENDARS by each calendar's own fixture opened_at field in Python, descending -- not ORDER BY created_at DESC, per the plan's own assumption A3 (seed_oracle inserts in ORACLE_CALENDARS declaration order, and 8a63aa81 is declared before 6303e6af, so a descending created_at sort would silently reverse the intended order)."
  - "test_pairing_no_position_state.py's remaining closed_at read (in the kept synthetic-open-calendar test) was moved onto read_position_state rather than left as a raw SQL SELECT against positions.closed_at -- the plan's action text called it 'unaffected', but the raw SELECT is itself a reader of the column this task's own title targets, and would have broken silently the moment migration 0014 (Task 4) drops it. Fixed here as Rule 1 (bug) rather than left for Task 4, which owns no task file listing test_pairing_no_position_state.py."

requirements-completed: []

coverage:
  - id: D1
    description: "A position's closed state is a pure function over net quantity per leg (LegNet/PositionState/derive_position_state), signed from the fill's own side (never abs()), with a gapped leg (unrecognised side or None quantity) making is_closed None -- never False."
    requirement: "LEDGER-05"
    verification:
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_two_legs_each_net_zero_position_closed_at_latest_event_time"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_leg_with_no_offsetting_sell_nets_nonzero_and_stays_open"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_unrecognised_side_makes_leg_net_none_and_neither_open_nor_closed"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_none_quantity_produces_the_same_none_net_for_its_leg"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_opened_at_is_earliest_open_event_time_and_none_without_one"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_sign_convention_never_uses_absolute_value"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 14th synthetic single-OPEN calendar derives to open, and a real fully-unwound oracle calendar derives to closed, through the real async read wrapper (read_position_state) against real seeded fills and events -- replacing the behavioural half of test_pairing_no_position_state.py's retired mutation test."
    requirement: "LEDGER-05"
    verification:
      - kind: integration
        ref: "tests/ledger/test_closed_state.py#test_synthetic_open_calendar_derives_to_open_via_read_position_state"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_closed_state.py#test_fully_unwound_oracle_calendar_derives_to_closed_via_read_position_state"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every reader in src/ and tests/ moved off positions.opened_at/positions.closed_at while the two columns still exist in the database -- the full suite stays green throughout, and the /gate/positions route serves the same response shape with opened_at now sourced from the event stream."
    requirement: "LEDGER-05"
    verification:
      - kind: unit
        ref: "grep -c 'row.opened_at' src/morai/api/routes_identity.py == 0"
        status: pass
      - kind: unit
        ref: "grep -c 'ORDER BY opened_at' tests/ledger/test_pairing_shared_leg.py == 0"
        status: pass
      - kind: unit
        ref: "grep -c 'UPDATE positions SET' tests/ledger/test_pairing_no_position_state.py == 0"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_shared_leg.py -- full file, 5/5 tests"
        status: pass
      - kind: e2e
        ref: "bash tools/gate.sh (ruff, ruff format, basedpyright, mypy, full pytest) -- 406 passed"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-09-01
status: halted
---

# Phase 7 Plan 2: Closed-State Derivation and Reader Migration (halted at Task 3 checkpoint) Summary

**`derive_position_state`/`net_quantity_for_leg` land as a pure, gap-honest read model in `positions.py`, and every reader in `src/` and `tests/` is moved off `positions.opened_at`/`closed_at` while both columns still exist in the database -- Task 3's blocking human checkpoint (the one-way column drop) is reached next and this run stops there, as instructed.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 of 4 completed (Task 3 is the checkpoint this run halts at; Task 4 not started)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `src/morai/ledger/positions.py`: `LegNet`/`PositionState`/`LegRow` frozen dataclasses, `net_quantity_for_leg` (pure -- BUY positive/SELL negative, never `abs()`, `None` on any gap), `derive_position_state` (pure -- no `AsyncSession`, no clock, no `Position`/`Leg` import, so the existing AST gate over the derivation module family stays meaningful), and `read_position_state` (the async shell -- scopes this position's own legs, and scopes fills/events to this position specifically via `resolve_fill_positions` and a `position_id` filter, so a shared-leg symbol from hard case 1 cannot leak a sibling position's fills into this one's net-quantity computation).
- `tests/ledger/test_closed_state.py` (new): 8 tests -- 6 pure (net-quantity signing, gap propagation, `is_closed` tri-state, `opened_at`/`closed_at` derivation) and 2 `db`-marked (the 14th synthetic single-OPEN calendar stays open; a real fully-unwound oracle calendar derives closed) through the real `read_position_state` wrapper.
- `src/morai/api/routes_identity.py`: `list_positions`/`get_position` now derive `opened_at` through `read_position_state` instead of reading `row.opened_at` off the ORM row -- same response shape, same route signatures (D7-04).
- `tests/ledger/oracle_seed.py`: both `insert(Position)` call sites (`seed_oracle`, `seed_synthetic_open_calendar`) no longer pass `opened_at=`/`closed_at=` kwargs; `OracleCalendar`'s own `opened_at`/`closed_at` fixture fields are untouched (still consumed by other tests as fixture data, never as columns).
- `tests/ledger/test_pairing_shared_leg.py`: the `ORDER BY opened_at DESC` raw-SQL ordering is replaced with a Python sort over `ORACLE_CALENDARS`' own fixture `opened_at` fields (descending), preserving the exact same asserted order (`8a63aa81` before `6303e6af`) and its fail-loudly property if the fixture dates ever change.
- `tests/ledger/test_pairing_no_position_state.py`: the column-mutation test is retired (nothing left to mutate once migration 0014 drops the columns); its replacement lives in `test_closed_state.py`'s Task-1 tests. Both synthetic-open-calendar tests are kept; the one that read `positions.closed_at` via raw SQL now reads it through `read_position_state` instead. Module docstring rewritten to record what happened and point at the replacement by name.

## Task Commits

Each task was committed atomically (Task 1 followed RED->GREEN per its `tdd="true"` attribute; Task 2 is a single `refactor` commit -- see TDD Gate Compliance below):

1. **Task 1 RED: add failing test for closed-state derivation** - `654d141` (test)
2. **Task 1 GREEN: implement closed-state derivation as pure function over net quantity per leg** - `0e71605` (feat)
3. **Task 2: move every reader off stored positions.opened_at/closed_at** - `051a18b` (refactor)

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the full RED->GREEN cycle: `654d141` is a genuine `test(...)` commit whose RED was a real `ImportError` on `LegNet` (no scaffolding built to manufacture a more interesting failure, per this project's own speed rule), and `0e71605` is the matching `feat(...)` commit that turned it green. No REFACTOR commit was needed -- the GREEN implementation was already clean on first pass (`bash tools/gate.sh` green, no follow-up cleanup).

Task 2 (`tdd="true"`) was committed as a single `refactor(...)` commit, not RED->GREEN. Rationale: Task 2 is a structural move -- readers change *how* they get `opened_at`/`closed_at`, not *what value* they observe (the oracle fixtures' own `opened_at` values are designed to equal the earliest-OPEN event time the derivation now computes). There is no new externally-observable input/output pair to write a failing test against first; the task's own acceptance criteria are grep-based structural assertions ("no more `row.opened_at` reads") plus "the full suite stays green throughout," not a new behavior. Manufacturing an artificial RED here (e.g., temporarily reverting a reader to prove a test fails) would repeat exactly the anti-pattern `.claude/rules/workflow.md` names as having cost Phase 2 four hours. This is flagged here per `gsd-core/references/tdd.md`'s own instruction to record gate-sequence deviations rather than silently skip them.

## Files Created/Modified

- `src/morai/ledger/positions.py` - `LegNet`, `PositionState`, `LegRow`, `net_quantity_for_leg`, `derive_position_state`, `read_position_state`
- `tests/ledger/test_closed_state.py` - 8-test suite for the closed-state read model (new file)
- `src/morai/api/routes_identity.py` - `list_positions`/`get_position` derive `opened_at` via `read_position_state`
- `tests/ledger/oracle_seed.py` - both `insert(Position)` sites drop the `opened_at`/`closed_at` kwargs
- `tests/ledger/test_pairing_shared_leg.py` - Python-side ordering replaces `ORDER BY opened_at DESC`
- `tests/ledger/test_pairing_no_position_state.py` - column-mutation test retired; remaining `closed_at` read moved onto `read_position_state`; module docstring rewritten

## Decisions Made

- **`read_position_state` scopes fills through `resolve_fill_positions`, not a bare `occ_symbol` match.** A shared-leg symbol (hard case 1's `8a63aa81`/`6303e6af`, which share an identical front contract) would otherwise let a sibling position's fills leak into this position's net-quantity computation if fills were filtered by `occ_symbol` alone. No task acceptance criterion exercises this path directly for closed-state, but it is the identical correctness class D7-03/NN-11 already govern for event derivation, so it was applied as Rule 2 (missing critical functionality) rather than left as a latent gap for a later phase to discover the hard way.
- **Ordering fix in `test_pairing_shared_leg.py` uses `ORACLE_CALENDARS`' own `opened_at` fixture field, never `created_at`.** Per the plan's own assumption A3: `seed_oracle` inserts in `ORACLE_CALENDARS` declaration order and `8a63aa81` is declared before `6303e6af`, so a descending `created_at` sort would silently reverse the intended order and prove a weaker claim.
- **The remaining `closed_at` read in `test_pairing_no_position_state.py`'s kept synthetic-open-calendar test was moved onto `read_position_state`, not left as raw SQL.** The plan's action text called the two kept synthetic tests "unaffected" by the retirement, but one of them reads `positions.closed_at` directly via `text()` -- a reader of exactly the column this task's own title targets ("move every reader off the stored position timestamps"). Left alone, it would have broken the moment migration 0014 (Task 4, not assigned this file) drops the column. Fixed here as Rule 1 (bug), not deferred.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `read_position_state` scopes fills via `resolve_fill_positions`, not a bare `occ_symbol` filter**
- **Found during:** Task 1, writing `read_position_state`.
- **Issue:** The plan's action text for `read_position_state` says only "queries `legs`, calls `read_fills` and `read_events`, and hands them to the pure function" -- it does not name the shared-leg disambiguation `resolve_fill_positions` already solves for event derivation. A naive `occ_symbol`-only filter would double-count a shared front leg's fills across both sibling positions (hard case 1).
- **Fix:** `read_position_state` calls `resolve_fill_positions` and filters `read_fills`' output to fills whose resolved `position_id` matches the target position; events are filtered by `position_id` directly (a plaintext column, no resolution needed).
- **Files modified:** `src/morai/ledger/positions.py`.
- **Verification:** `bash tools/gate.sh` green; existing hard-case-1 tests (`test_pairing_shared_leg.py`) unaffected and still passing.
- **Committed in:** `0e71605` (Task 1 GREEN).

**2. [Rule 1 - Bug] Moved the remaining raw-SQL `closed_at` read in `test_pairing_no_position_state.py` onto `read_position_state`**
- **Found during:** Task 2, reviewing the two synthetic-open-calendar tests the plan says to "keep... unaffected."
- **Issue:** `test_synthetic_open_calendar_derives_to_one_open_event_and_stays_open` reads `positions.closed_at` via a raw `text("SELECT closed_at FROM positions WHERE id = :id")` query -- a direct reader of the column Task 2's own title targets ("move every reader off the stored position timestamps, with the columns still present"). Migration 0014 (Task 4) will drop this column, and Task 4's file list does not include this test file, so left as-is this assertion would break with an `UndefinedColumn` error the moment the migration lands, with no task assigned to catch it.
- **Fix:** Replaced the raw SQL read with `await read_position_state(app_db_session, SYNTHETIC_OPEN_POSITION_ID, provisioned_users.user_a)` and asserted `state.closed_at is None`.
- **Files modified:** `tests/ledger/test_pairing_no_position_state.py`.
- **Verification:** `uv run pytest tests/ledger/test_pairing_no_position_state.py -x -q` passes; `bash tools/gate.sh` green.
- **Committed in:** `051a18b` (Task 2).

---

**Total deviations:** 2 auto-fixed (1 missing-critical, 1 bug).
**Impact on plan:** Both fixes are necessary for correctness -- the first prevents a real cross-position data leak in a hard case this project has already paid for once; the second prevents a landmine Task 4 was never assigned to defuse. No scope creep beyond what each fix required.

## Issues Encountered

None beyond the two deviations above, both fully documented there.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**This run halts at Task 3 -- a blocking human checkpoint (`gate="blocking-human"`) over the one-way drop of `positions.opened_at`/`positions.closed_at` in migration 0014.** Per the executor's checkpoint protocol, this decision cannot be auto-approved even in auto mode, and this run does not execute the drop.

**What has already been verified, before this checkpoint:**
- Every reader in `src/` and `tests/` has moved off both columns (Task 2's own acceptance criteria, all confirmed by grep and by test execution above).
- The three Pitfall-5 test repairs are done: `oracle_seed.py`'s two `insert(Position)` sites no longer pass the two kwargs; `test_pairing_shared_leg.py`'s ordering is fixed in Python off the fixtures' own timestamps, not `created_at`; `test_pairing_no_position_state.py`'s mutation test is retired with its behavioral claim replaced in `test_closed_state.py`.
- `tests/ledger/test_oracle_gate.py` is unmodified (`git diff --stat` reports no change) and passes (15/15).
- The full suite is green at the point of halting: `bash tools/gate.sh` -- ruff, ruff format, basedpyright, mypy, and `pytest` (406 passed) all clean.

**The irreversible action Task 3 gates:** migration 0014 will `DROP COLUMN` both `positions.opened_at` and `positions.closed_at`. `downgrade()` re-adds both columns, nullable, but cannot restore any value that was in them -- the data itself is gone once the migration runs.

**Evidence that the stored data is safe to drop, per the plan's own decision text (reproduced for the human's review, not re-derived here):** nothing under `src/` has ever written either column -- 07-01's `create_positions` leaves both `NULL` by design, and every `insert(Position)` call carrying the two kwargs lived only in this session's now-modified test seeds. Task 2 (just completed) confirms independently that nothing under `src/` or `tests/` *reads* either column anymore either. The loss, if the human approves the drop, is provably empty in this codebase today.

**What `downgrade()` can and cannot restore:** it can restore the two columns' *existence* (nullable, on `positions`), for a future `INSERT`/`UPDATE` to write into again. It cannot restore any specific value that had been stored before `upgrade()` ran -- the DDL operation is genuinely one-way for data, only reversible for schema shape.

Task 4 (migration 0014 itself, plus the `Event`/`Position` model updates, the `rolled_from_position_id` CHECK, and the `campaign_chain` view with its `security_invoker` requirement) is not started. No blockers for it beyond the human's answer to Task 3.

## Self-Check: PASSED

All created/modified files verified present on disk: `src/morai/ledger/positions.py`,
`tests/ledger/test_closed_state.py`, `src/morai/api/routes_identity.py`,
`tests/ledger/oracle_seed.py`, `tests/ledger/test_pairing_shared_leg.py`,
`tests/ledger/test_pairing_no_position_state.py`, this SUMMARY. All three commit hashes
(`654d141`, `0e71605`, `051a18b`) verified present in `git log --oneline --all`.

---
*Phase: 07-position-and-campaign-read-models*
*Completed: 2026-09-01 (halted at Task 3 checkpoint)*
