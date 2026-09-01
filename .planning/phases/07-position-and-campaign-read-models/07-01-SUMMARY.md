---
phase: 07-position-and-campaign-read-models
plan: 01
subsystem: database
tags: [sqlalchemy, postgres, procrastinate, ast-gate, tdd]

requires:
  - phase: 06-schwab-ingest
    provides: sync_user's fill-landing shell, read_fills, resolve_fill_positions
provides:
  - "src/morai/ledger/positions.py — plan_positions (pure) + create_positions (shell), the position/leg creation path"
  - "Position/Leg write-token sentinels on db/models.py, mirroring Fill.__init__"
  - "sync_user wired to call create_positions then sync_events, closing 07-RESEARCH.md's Pitfall 3"
affects: [07-02, 07-03, 07-04, 07-05, phase 8 (repricing), phase 9 (reconciliation), phase 11 (review API)]

actuals:
  tokens: 9100
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Pure-function + thin-shell split (plan_positions/create_positions), mirroring derive_events/sync_events exactly"
    - "Write-token sentinel gate on Position/Leg constructors, mirroring Fill.__init__"
    - "AST write-boundary gate test, parametrized over two sentinels sharing one allowed-importer set"

key-files:
  created:
    - src/morai/ledger/positions.py
    - tests/ledger/test_position_creation.py
    - tests/gate/test_ledger_write_boundary.py
  modified:
    - src/morai/db/models.py
    - src/morai/ingest/schwab_sync.py
    - tests/ingest/test_sync_tracer.py

key-decisions:
  - "A three-or-more-distinct-symbol group in plan_positions is left out of the returned tuple entirely (NN-16) rather than guessing a role — no such group exists in this project's traded structures (calendars/diagonals only)."
  - "tests/identity/conftest.py's seeded_users fixture pre-seeds one legless positions row per user (a Phase 2/3 isolation-testing artifact, predating D7-12) — this plan's own tests scope their position-count assertions to distinguish the newly-created row from that pre-existing seed, rather than touching the shared fixture many unrelated suites depend on."

patterns-established:
  - "Pattern: pure derivation + thin async shell for anything that groups/derives from FillRecord — the shape every later Phase 7 module (settlements.py, campaigns.py) should copy."

requirements-completed: [LEDGER-05]

coverage:
  - id: D1
    description: "A drained sync_user worker job over TX_PAYLOAD creates exactly one new position and two correctly-rolled legs (front/SPXW, back/SPX), and at least one OPEN event — the tracer slice through every layer this phase touches."
    requirement: "LEDGER-05"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_tracer.py#test_sync_user_job_lands_one_broker_transaction_and_two_fills"
        status: pass
    human_judgment: false
  - id: D2
    description: "plan_positions correctly assigns leg_role by expiry order (A1), derives root from parse_occ_symbol (never a hand-derived substring), scopes creation to unresolved OPENING fills only (D7-12), and handles the single-leg edge case (A2) without raising."
    requirement: "LEDGER-05"
    verification:
      - kind: unit
        ref: "tests/ledger/test_position_creation.py#test_two_opening_fills_plan_front_by_earlier_expiry_regardless_of_order"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_position_creation.py#test_root_comes_from_parse_occ_symbol_never_a_hand_derived_substring"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_position_creation.py#test_a_fill_already_resolved_to_a_real_position_plans_nothing"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_position_creation.py#test_a_closing_fill_with_no_resolution_plans_nothing"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_position_creation.py#test_a_single_distinct_opening_symbol_plans_one_front_leg_and_does_not_raise"
        status: pass
    human_judgment: false
  - id: D3
    description: "create_positions is idempotent — calling it twice in one transaction over the same fills creates the position once, the second call seeing the fills already resolved through the first call's own legs."
    requirement: "LEDGER-05"
    verification:
      - kind: integration
        ref: "tests/ledger/test_position_creation.py#test_create_positions_called_twice_creates_the_position_once"
        status: pass
    human_judgment: false
  - id: D4
    description: "Position/Leg cannot be constructed outside morai.ledger.positions — the write-token sentinel raises RuntimeError, and an AST gate proves only two tracked modules (positions.py and db/models.py) ever name each sentinel."
    requirement: "LEDGER-05"
    verification:
      - kind: unit
        ref: "tests/ingest/test_sync_tracer.py#test_position_and_leg_reject_construction_without_the_write_token"
        status: pass
      - kind: unit
        ref: "tests/gate/test_ledger_write_boundary.py#test_only_the_write_module_and_the_model_import_the_sentinel"
        status: pass
      - kind: unit
        ref: "tests/gate/test_ledger_write_boundary.py#test_scanner_reports_a_synthetic_offending_file"
        status: pass
    human_judgment: false

duration: 42min
completed: 2026-09-01
status: complete
---

# Phase 7 Plan 1: Position and Leg Creation Path Summary

**The missing `positions`/`legs` creation path, wired into `sync_user`'s existing transaction so a real worker run produces a position with two correctly-rolled legs and an OPEN event — closing the two gaps (no creation path, `sync_events` never called) that would have left Phase 7's read models running against a permanently-empty table.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-09-01T16:01:00Z (approx.)
- **Completed:** 2026-09-01T16:43:00Z
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `src/morai/ledger/positions.py`: `plan_positions` (pure) groups an order's unresolved OPENING fills into one `PlannedPosition` with correctly-rolled `PlannedLeg`s — `front` by earlier parsed expiry, `back` by later (A1), root always taken from `parse_occ_symbol`, never re-derived; a single-symbol group plans one `front` leg without raising (A2); a three-or-more-symbol group is left unplanned (NN-16). `create_positions` (shell) mirrors `sync_events`'s exact resolve → read → derive → write shape, including the same per-user `pg_advisory_xact_lock`.
- `Position.__init__`/`Leg.__init__` write-token sentinels added to `db/models.py`, copying `Fill.__init__`'s exact shape (function-body import, `is not` identity check, `RuntimeError` naming `create_positions()`).
- `sync_user` (`schwab_sync.py`) now calls `create_positions` then `sync_events`, in that order, on the same session, inside the same caller-owned transaction, after all windows' fills have landed — closing 07-RESEARCH.md's Pitfall 3 (before this plan, `sync_events` had zero call sites under `src/`, and nothing under `src/` ever created a `positions`/`legs` row).
- `tests/ingest/test_sync_tracer.py` extended with the end-to-end tracer proof and a sentinel-rejection unit test.
- `tests/ledger/test_position_creation.py`: 6 tests (5 pure, 1 db-marked) covering A1/A2, root provenance, OPENING-only scoping, and creation idempotency.
- `tests/gate/test_ledger_write_boundary.py`: AST write-boundary gate, parametrized over both sentinels, proving no third writer exists.

## Task Commits

Each task was committed atomically:

1. **Task 1: One Schwab order becomes a position, its legs, and an OPEN event — end to end through the real worker** - `7fbda17` (feat)
2. **Task 2: Leg-role, root and idempotency unit suite for the creation path** - `6e1ffc3` (test)
3. **Task 3: AST write-boundary gate for the position and leg sentinels** - `5b5b6da` (test)

_Note: Task 1 (`tdd="true"`, `type="tracer"`) followed RED→GREEN: the test extension was written and observed failing with a genuine `ModuleNotFoundError` (positions.py temporarily moved aside), then restored, observed GREEN. Task 2's 6 tests passed immediately against Task 1's already-correct implementation — no gap was exposed, so no further `feat`/`refactor` commit was needed._

## Files Created/Modified

- `src/morai/ledger/positions.py` - `plan_positions`, `create_positions`, `PlannedLeg`/`PlannedPosition`, the two write-token sentinels
- `src/morai/db/models.py` - `Position.__init__`/`Leg.__init__` sentinel gates
- `src/morai/ingest/schwab_sync.py` - wires `create_positions`/`sync_events` into `sync_user`
- `tests/ingest/test_sync_tracer.py` - end-to-end tracer assertions + sentinel-rejection test
- `tests/ledger/test_position_creation.py` - unit suite for `plan_positions`/`create_positions` (new file)
- `tests/gate/test_ledger_write_boundary.py` - AST write-boundary gate (new file)

## Decisions Made

- **Three-or-more-symbol group in `plan_positions` is left unplanned, not guessed.** No production fixture proves this project ever trades a structure with 3+ distinct opening symbols on one order (calendars and diagonals only). An absent `PlannedPosition` for that `order_id` is the honest gap (NN-16).
- **Test assertions scoped around a pre-existing fixture, not the fixture itself.** `tests/identity/conftest.py`'s `seeded_users` fixture (Phase 2/3, used by a dozen unrelated identity/isolation/crypto-shred/key-rotation test suites) unconditionally seeds one legless `positions` row per user via `insert(Position)`. This plan's own tests distinguish the *newly created* position (the one this sync's `create_positions` call produced) from that pre-existing seed, rather than modifying the shared fixture — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test-assumption correction] Plan's literal acceptance-criteria SQL ("`SELECT count(*) FROM positions` returns 1") conflicts with a pre-existing Phase 2/3 fixture**
- **Found during:** Task 1, verifying the tracer test after implementation.
- **Issue:** `tests/identity/conftest.py::seeded_users` (transitively required by `provisioned_users`, which this test needs for data-key provisioning) always inserts one legless `positions` row per user (`insert(Position).values(user_id=user_a)`) as a Phase 2/3 isolation-testing artifact, predating and unrelated to D7-12's creation path. A literal `SELECT count(*) FROM positions` (or a count scoped to `user_id`) is therefore 2 after a successful sync, not 1: one pre-existing seed plus the one `create_positions` newly writes. Root-caused via direct DB inspection and stack-trace instrumentation (temporarily added and removed) proving the constructor-gated `Position.__init__` fired exactly once per `sync_user` call, while a second, un-gated `insert(Position)` Core statement (bypassing `__init__` entirely, the documented honest ceiling) accounted for the extra row.
- **Fix:** Test assertions in `tests/ingest/test_sync_tracer.py` and `tests/ledger/test_position_creation.py` compute `{observed position ids} - {provisioned_users.position_a}` to isolate the newly-created row, and assert on that set plus the correctly-rolled leg values — verifying the plan's real intent (one new position, two correctly-rolled legs) without requiring or modifying the shared fixture's pre-existing behavior, which many other test suites depend on.
- **Files modified:** `tests/ingest/test_sync_tracer.py`, `tests/ledger/test_position_creation.py`.
- **Verification:** `uv run pytest tests/ingest/test_sync_tracer.py tests/ledger/test_position_creation.py -q` — all pass; `bash tools/gate.sh` exits 0.
- **Committed in:** `7fbda17` (Task 1), `6e1ffc3` (Task 2).

---

**Total deviations:** 1 auto-fixed (1 test-assumption correction).
**Impact on plan:** No production-code behavior changed by this deviation — `create_positions`/`plan_positions` work exactly as the plan specifies. Only the test's literal position-count assertion was corrected to account for a pre-existing, unrelated fixture. No scope creep.

## Issues Encountered

None beyond the deviation above, which is fully documented there.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `positions`/`legs` are no longer permanently empty in production — Plan 07-02 (closed-state derivation, LEDGER-05's read-model half) has real rows to derive against.
- `plan_positions`/`create_positions` establish the pure-function + thin-shell pattern later Phase 7 modules (`settlements.py`, `campaigns.py`) should copy verbatim.
- No blockers for 07-02/07-03/07-04/07-05.

---
*Phase: 07-position-and-campaign-read-models*
*Completed: 2026-09-01*
