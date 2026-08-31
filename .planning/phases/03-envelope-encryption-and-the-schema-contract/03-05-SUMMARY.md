---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 05
subsystem: database
tags: [postgres, sql, oracle-fixtures, disambiguation, reconciliation, plaintext-boundary]

# Dependency graph
requires:
  - phase: 03-01
    provides: "insert_fills()/read_fills() -- the one write path into fills, encryption inside the write path"
  - phase: 03-02
    provides: "positions/legs/events tables (migration 0008), insert_events()/read_events()"
provides:
  - "tests/ledger/oracle_seed.py: the 13 real oracle calendars (26 legs, 52 fills), computed OCC symbols, seeded through insert_fills() -- Phase 5's oracle suite imports this directly, no re-transcription needed"
  - "Both criterion-2 queries proven against real Postgres and real oracle data: the shared-front-leg disambiguation query and the reconciliation window query"
  - "A mechanical, schema-derived proof that neither query names a ciphertext or nonce column (information_schema.columns, not hard-coded)"
affects: [phase-5, phase-6, phase-9]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 9424
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compact _CalendarSpec transcription -> OCC symbols computed via occ_symbol_for(), never hand-typed -- a transposition across 52 symbols is structurally impossible"
    - "Schema-derived no-ciphertext proof: query text checked against every information_schema.columns row with data_type='bytea', not a hard-coded column list -- a column added later is covered automatically"
    - "seed_oracle(calendar_ids=...) -- an optional filter so a test can seed 2 of 13 calendars without duplicating the seeding logic"

key-files:
  created:
    - tests/ledger/oracle_seed.py
    - tests/ledger/test_plaintext_queries.py

key-decisions:
  - "MIN(position_id) in the disambiguation query's anchors CTE was rewritten to MIN(position_id::text)::uuid -- Postgres has no MIN(uuid) aggregate, discovered by running the research-proven query against the real schema for the first time. Safe because HAVING COUNT(DISTINCT position_id)=1 already restricts the group to one value before MIN ever runs."
  - "positions.opened_at/closed_at are set to each calendar's own real OPEN/CLOSE order date (from salvage/oracle-fixtures.md), not left NULL -- this is what makes the reconciliation-window test's expected dates the oracle's own recorded dates rather than invented ones, and it is what research's own window test (8a63aa81/6303e6af, June 2026) depends on."
  - "The window 'total' in the Python-sum test is defined as the sum of every non-null open_debit_usd/close_credit_usd amount across the window's events -- not a P&L figure -- since D3-04's own point is that no SQL aggregate touches money, not that this plan derives Phase 9's reconciliation formula."

requirements-completed: []  # CRYPT-03 is declared by sibling plans in this phase too (03-01, 03-02); requirements.ready-ids reported 0/1 ready -- the last plan in the phase to finish marks it.

coverage:
  - id: D1
    description: "All 52 real oracle fills are seeded through insert_fills() -- the one write path, never a test-only fast path -- producing 13 positions, 26 legs, 52 fills with no composite-key collision, and every price reads back as the exact Decimal the fixture file records"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_seed_oracle_produces_52_fills_13_positions_26_legs"
        status: pass
    human_judgment: false
  - id: D2
    description: "The shared-front-leg disambiguation query resolves all 8 fills across calendars 8a63aa81/6303e6af to the correct positions using only plaintext columns"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_disambiguation_query_resolves_shared_front_leg_calendars"
        status: pass
    human_judgment: false
  - id: D3
    description: "An order with no single anchor resolves to NULL, never a guess (NN-11, LEDGER-03)"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_disambiguation_query_leaves_unanchored_order_unresolved"
        status: pass
    human_judgment: false
  - id: D4
    description: "The reconciliation window query selects exactly the events inside a real June-2026 window using event_time alone, correctly excluding an event just outside it"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_reconciliation_window_selects_correct_events"
        status: pass
    human_judgment: false
  - id: D5
    description: "The window's total is summed in Python from read_events()'s decrypted Decimals and matches a figure derived from the oracle's own recorded debit/credit -- no SQL aggregate touches a money value (D3-04)"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_reconciliation_window_total_summed_in_python_matches_oracle"
        status: pass
    human_judgment: false
  - id: D6
    description: "Neither query names a ciphertext or nonce column, proved mechanically against the schema's own information_schema.columns bytea list rather than by inspection"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_neither_query_names_a_ciphertext_or_nonce_column"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 5: The Plaintext Column Set Proven Sufficient Against Real Oracle Data Summary

**Both criterion-2 SQL queries -- shared-front-leg disambiguation and the reconciliation window -- run correctly against real Postgres, seeded with all 52 real oracle fills through `insert_fills()`, touching only the plaintext-by-design columns.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- `tests/ledger/oracle_seed.py`: all 13 real calendars from `salvage/oracle-fixtures.md` transcribed as compact `_CalendarSpec` literals (expiry, strike, price only -- no hand-typed OCC symbol), with `occ_symbol_for()` computing every symbol from its expiry and strike, and `_root_for_expiry()` computing the SPX-vs-SPXW settlement-style root from the third-Friday rule. `seed_oracle()` inserts `positions`/`legs` directly (no dedicated write path exists for them this phase) and routes every fill through `insert_fills()` -- the one write path (D3-13/D3-14) -- with an optional `calendar_ids` filter so a test can seed a subset without re-implementing the seeding logic.
- `tests/ledger/test_plaintext_queries.py`: both criterion-2 queries as module-level SQL constants, executed against real Postgres seeded with real oracle data. The disambiguation query resolves all 8 fills across the two calendars that share front-leg contract `SPXW260618P07275000` (`8a63aa81`, `6303e6af`) to their correct positions, and a synthetic no-anchor order (two positions sharing both leg symbols) resolves to `NULL` rather than a guess. The reconciliation window query selects exactly the 3 real June-2026 events by `event_time` alone; the window's total is summed in Python from `read_events()`'s decrypted `Decimal`s and matches a figure derived from the oracle's own recorded debit/credit. A mechanical test derives every `bytea` column from `information_schema.columns` and asserts neither query's text names one.
- **Real bug found and fixed** (Rule 1): the disambiguation query's `anchors` CTE, taken directly from 03-RESEARCH.md's Code Examples, used `MIN(position_id)` -- Postgres has no `MIN(uuid)` aggregate. Rewrote to `MIN(position_id::text)::uuid`, safe because the surrounding `HAVING COUNT(DISTINCT position_id) = 1` already restricts the group to one value before `MIN` ever runs. This is the first time this exact query ran against the real schema's UUID primary keys -- research's scratch schema apparently used a different key type.

## Task Commits

1. **Task 1: the oracle's fills enter through the one write path** - `4de5fb5` (test)
2. **Task 2: both queries run in SQL against the plaintext set** - `0c3c2c5` (test)

_Both tasks were TDD. Task 1's honest red was the seed assertion failing before transcription was complete (per the plan's own guidance, run early and partially) -- the seed test in fact passed on first full run once all 13 calendars were transcribed and `insert_fills()` (already built in 03-01) was wired up, so no scaffolding was needed to observe a real red along the way; the natural checkpoint was simply "does this compile and run against the real schema yet", which it did not until the module was complete. Task 2's honest red was the `MIN(uuid)` `ProgrammingError` on the very first run against real Postgres -- a genuine failure of the research-proven query against the real schema's key type, fixed per Rule 1 before any other assertion was checked, then all 6 tests passed green together._

## Files Created/Modified

- `tests/ledger/oracle_seed.py` - 13 real calendars, computed OCC symbols, `seed_oracle()` write-path helper
- `tests/ledger/test_plaintext_queries.py` - both criterion-2 SQL queries, 6 tests

## Decisions Made

- **`MIN(position_id::text)::uuid`, not a schema change.** Postgres lacks a native `MIN(uuid)` aggregate. The fix stays entirely inside the test's own SQL constant; it does not touch the schema, the write path, or D3-02's plaintext column set. Documented inline with a comment stating exactly why it's safe (the group is already restricted to one distinct value by `HAVING`).
- **`positions.opened_at`/`closed_at` carry the real OPEN/CLOSE order dates**, not `NULL`. This is what makes the reconciliation-window test's expected window (`8a63aa81` OPEN Jun 9, CLOSE Jun 10; `6303e6af` CLOSE Jun 5, excluding its OPEN May 19) match 03-RESEARCH.md's own proven result exactly, using real transcribed dates rather than invented ones.
- **The Python-summed "window total" is a sum of raw event amounts, not a P&L figure.** D3-04's requirement is narrowly that no SQL aggregate ever touches a money value -- this plan proves that shape, not Phase 9's actual reconciliation formula (net realized P&L across rolls and settlements), which is explicitly out of this phase's scope per `03-CONTEXT.md`.
- **`requirements-completed` is empty in this SUMMARY's frontmatter deliberately.** `CRYPT-03` is declared by sibling plans in this phase (`03-01`, `03-02`) too; `requirements.ready-ids` reported `0/1` ready when checked from this plan, meaning at least one sibling plan hadn't finished yet. The last plan in the phase to finish marks it complete, per the shared-ID gate (#2388) -- this SUMMARY still lists `CRYPT-03` against every `coverage` entry above for traceability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `MIN(uuid)` is not a Postgres aggregate function**
- **Found during:** Task 2, first run of the disambiguation query against real Postgres
- **Issue:** `03-RESEARCH.md`'s Code Examples query used `MIN(position_id)` in the `anchors` CTE; Postgres raised `UndefinedFunctionError: function min(uuid) does not exist`. Research's scratch schema evidently used a non-UUID position key; this schema's `positions.id` is UUID.
- **Fix:** `MIN(position_id::text)::uuid AS position_id`, with an inline comment stating the safety argument (the group is already restricted to exactly one distinct value by the surrounding `HAVING`).
- **Files modified:** `tests/ledger/test_plaintext_queries.py`
- **Verification:** Full 6-test file green after the fix; re-run 4 additional times in isolation to confirm no flakiness of its own.
- **Committed in:** `0c3c2c5` (Task 2's own commit)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact on plan:** Necessary and narrowly scoped -- a SQL portability fix inside the test's own query constant, touching no schema, write path, or plaintext-column decision. No scope creep.

## Issues Encountered

**Pre-existing test-suite flakiness, out of scope for this plan.** Running the full suite (`uv run pytest -q` / `bash tools/gate.sh`) surfaces intermittent failures across `tests/identity/*` and occasionally `tests/ledger/test_tracer_encrypted_fill.py`/`test_roll_check_constraint.py`/`test_schema_contract.py` -- a different subset fails on each run, always the same shape of error (`duplicate key value violates unique constraint "users_username_key"`, `NoResultFound`, a missing session cookie). **Confirmed present before this plan's changes**: moving both new files out of the tree entirely and re-running the full suite reproduces the same class of failures on unrelated files. **Confirmed absent from this plan's own work**: `tests/ledger/test_plaintext_queries.py` run in isolation passed cleanly across 5 consecutive runs (the very first run plus 4 more taken specifically to rule out flakiness). This looks like a fixture-lifecycle race in the shared `tests/*/conftest.py` "own new engine per fixture, dispose after" pattern interacting with the session-scoped asyncio event loop, not anything this plan's two files touch (`files_modified` is exactly `tests/ledger/oracle_seed.py` and `tests/ledger/test_plaintext_queries.py`; neither modifies any conftest). Per this project's own scope-boundary rule, not fixed here. Logged to `.planning/WINDOWS.md` as ledger entry id 2 (kind: deviation, phase 03) for cross-phase visibility, since a flaky suite defeats the "gate must be green" contract this and every later plan depends on.

`ruff check`, `ruff format --check`, `basedpyright`, and `mypy` are all clean (0 errors) across `src` and `tests`, including this plan's two new files -- these are deterministic and were not affected by the flakiness above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `D3-02`'s plaintext column set is now proven sufficient for both queries criterion 2 names, against real oracle data, on the real schema -- no revision needed.
- `tests/ledger/oracle_seed.py` is a plain, importable module (`ORACLE_CALENDARS`, `ORACLE_FILLS`, `occ_symbol_for`, `seed_oracle`) ready for Phase 5's 13-calendar oracle suite to import directly, with the per-calendar `openNetDebit`/`closeNetCredit` already exposed as data.
- The pre-existing test-suite flakiness documented above is not blocking for this plan's own criterion, but it is a real risk to every later plan's "gate must be green" verification step and is worth a dedicated investigation before Phase 5 leans harder on the same fixture infrastructure.

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- Both created files verified present on disk: `tests/ledger/oracle_seed.py`, `tests/ledger/test_plaintext_queries.py`.
- Both task commit hashes (`4de5fb5`, `0c3c2c5`) verified present in `git log --oneline`.
- `tests/ledger/test_plaintext_queries.py` re-confirmed green in isolation (6 passed) immediately before writing this summary.
- `ruff check`, `ruff format --check`, `basedpyright`, `mypy` re-confirmed clean (0 errors) immediately before writing this summary.
- `bash tools/gate.sh`'s pytest step is affected by the pre-existing, out-of-scope flakiness documented above under "Issues Encountered" -- not a full unqualified green, and stated as such rather than softened.
