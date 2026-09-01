---
phase: 05-fill-pairing-and-the-oracle-gate
plan: 03
subsystem: ledger
tags: [oracle, fill-pairing, fault-injection, decimal, pytest-parametrize]

requires:
  - phase: 05-fill-pairing-and-the-oracle-gate
    provides: >-
      plans 01/02's src/morai/ledger/pairing.py -- derive_events,
      sync_events, classify_fill, detect_roll -- and tests/ledger/
      oracle_seed.py's ORACLE_CALENDARS/ORACLE_FILLS transcription plus
      seed_oracle/seed_synthetic_open_calendar, both already proven
      end to end and on the two documented hard cases

provides:
  - "tests/ledger/oracle_seed.py: oracle_fill_records (builds in-memory
    FillRecords + resolutions from ORACLE_FILLS, no database) and
    assert_matches_oracle (the single Decimal-exact comparison both the
    pure proof and the fault suite call)"
  - "tests/ledger/test_oracle_gate.py: 13 parametrized cases (real broker
    order ids), the four global invariants read back from Postgres, and
    the pure no-database LEDGER-12 second proof -- the gate CLAUDE.md
    names as a hard constraint before any money code ships"
  - "tests/ledger/test_pairing_seeded_faults.py: the OPS-06 seeded-fault
    suite -- sign-flip, rounding, off-by-one, all three caught, a control
    that passes before and after"

affects: []

actuals:
  tokens: 5632
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Shared oracle-comparison helper (assert_matches_oracle) called from
      both the pure derivation proof and the fault suite, so a fault
      proved fatal in one place is proved fatal in the other by
      construction, not by keeping two assertions in sync by hand."
    - "monkeypatch.setattr against a module-level function
      (morai.ledger.pairing._signed_leg_amount), wrapping the real
      function rather than reimplementing it, so each faulted variant
      differs from the truth by exactly one named defect."
    - "Reseed-per-parametrized-case over function-scoped db fixtures,
      measured rather than assumed: 13 full 14-position sweeps plus one
      more for the invariants case cost about 1.9s total, well inside the
      local gate's budget -- no module-scoped fixture was needed."

key-files:
  created:
    - tests/ledger/test_oracle_gate.py
    - tests/ledger/test_pairing_seeded_faults.py
  modified:
    - tests/ledger/oracle_seed.py

key-decisions:
  - "Reseed per parametrized case, not a module-scoped shared derivation.
    Measured: 15 tests in tests/ledger/test_oracle_gate.py (13 calendar
    cases + 1 invariants case, each doing a full 14-position/54-fill
    sweep, + 1 pure case) run in 1.88s. The plan's own escape hatch (seed
    once into a module-scoped derivation if reseeding proved too slow)
    was not needed -- recorded here with the measurement that decided it,
    per the plan's own instruction to record either way."
  - "assert_matches_oracle is typed for Iterable[DerivedEvent] only, never
    EventRecord (tests/ledger/oracle_seed.py). The stored-row parametrized
    case reads back through read_events (EventRecord, a structurally
    different type -- str event_type, no commission_usd) and asserts
    directly rather than through the shared helper, because criterion 1
    requires proving the round trip through encryption/storage/decryption,
    which a pre-write DerivedEvent comparison cannot prove. The pure case
    and the fault suite both feed it derive_events's own DerivedEvent
    output, which is exactly what the type signature enforces."
  - "fills/events counts in the invariants test are read on app_db_session,
    not superuser_db_session. insert_fills/insert_events never commit (the
    caller owns the transaction, both modules' own documented contract),
    so the 54 fills and 27 events sit inside app_db_session's own
    still-open transaction; a different session, even the superuser one,
    cannot see another session's uncommitted rows under Postgres's default
    read-committed isolation. Caught as a real red during this plan's own
    first run (assert 0 == 54), not a hypothetical -- documented in the
    test's own docstring so the next multi-session db test in this suite
    does not repeat it."
  - "Markers are per-function (@pytest.mark.db on each db-backed test),
    not a module-wide pytestmark, in tests/ledger/test_oracle_gate.py --
    the file mixes db-marked cases with one pure no-database case that
    must keep running under the local default `uv run pytest -m 'not
    db'`. Matches tests/ledger/test_pairing_roll_guard.py's own resolution
    of the identical mix from plan 05-02."

requirements-completed: [LEDGER-11, OPS-06]

coverage:
  - id: D1
    description: >-
      All 13 real Schwab calendars derive to their recorded
      open_net_debit/close_net_credit as exact Decimals, one parametrized
      case per calendar named by its real broker order id, read back
      through read_events -- including both hard cases (8a63aa81 at
      10.20/10.55, 65aac62e at 32.35/36.35).
    requirement: LEDGER-11
    verification:
      - kind: integration
        ref: "tests/ledger/test_oracle_gate.py#test_calendar_derives_to_its_recorded_figures"
        status: pass
    human_judgment: false
  - id: D2
    description: >-
      The full sweep stores 54 fills and 27 events (2 per real calendar
      plus the 14th control's 1), zero unresolved/unclassified fills, and
      zero events outside OPEN/CLOSE -- all read from Postgres, not
      tallied in memory. The 14th synthetic control derives to exactly
      one OPEN event and stays open.
    requirement: LEDGER-11
    verification:
      - kind: integration
        ref: "tests/ledger/test_oracle_gate.py#test_full_sweep_global_invariants"
        status: pass
    human_judgment: false
  - id: D3
    description: >-
      derive_events reproduces the same 26 figures from in-memory
      FillRecords built via oracle_fill_records, with no database and no
      session -- LEDGER-12's second proof, and the same harness the
      seeded-fault suite depends on.
    requirement: LEDGER-11
    verification:
      - kind: unit
        ref: "tests/ledger/test_oracle_gate.py#test_pure_derive_events_reproduces_the_same_26_figures"
        status: pass
    human_judgment: false
  - id: D4
    description: >-
      A sign-flip, a rounding fault, and a quantity off-by-one, each
      injected into _signed_leg_amount via monkeypatch, each make the real
      assert_matches_oracle raise AssertionError, identified by fault
      name; the unfaulted control passes before and after the parametrized
      run, proving no fault leaked (OPS-06, D5-03).
    requirement: OPS-06
    verification:
      - kind: unit
        ref: "tests/ledger/test_pairing_seeded_faults.py#test_control_passes_with_no_fault_injected"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_seeded_faults.py#test_seeded_fault_makes_the_oracle_comparison_raise"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_seeded_faults.py#test_control_passes_again_after_the_parametrized_faults"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-09-01
status: complete
---

# Phase 5 Plan 3: The 13-calendar oracle gate and the seeded-fault suite Summary

**All 13 real Schwab calendars derive to their independently-computed figures at exact `Decimal` equality, the 14th synthetic control stays open, all four global invariants hold against real Postgres, and three hand-seeded arithmetic faults -- sign-flip, rounding, off-by-one -- each make the oracle's own comparison raise.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-01 (task 1 start)
- **Completed:** 2026-09-01T05:47:08-05:00 (last task commit)
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- The 13-calendar oracle: one `pytest.param(..., id=calendar_id)` case per
  calendar, 13 in all, each asserting its OPEN event's `open_debit_usd`
  and CLOSE event's `close_credit_usd` against `salvage/
  oracle-fixtures.md`'s independently-computed figures, at exact `Decimal`
  equality -- both hard cases included in the same loop, not bolted on.
- The four global invariants, read back from Postgres in one combined
  sweep: 54 fills stored, 27 events stored with zero rows outside
  OPEN/CLOSE, zero unresolved/unclassified fills, and the 14th synthetic
  control deriving to exactly one OPEN event with no CLOSE.
- LEDGER-12's second proof: the same 26 figures come back from a pure,
  no-database `derive_events` call over in-memory `FillRecord`s built by
  the new `oracle_fill_records` helper.
- The OPS-06 seeded-fault suite: sign-flip, rounding, and quantity
  off-by-one, each injected into `_signed_leg_amount` via
  `monkeypatch.setattr`, each proved to make the real
  `assert_matches_oracle` raise `AssertionError` -- with a control that
  passes both before and after the parametrized run, and an out-of-suite
  sanity check (a no-op wrapper) confirming the harness itself is not
  vacuously failing.
- No mutation-testing tool pinned, per D5-03 -- the hand-seeded suite
  covers exactly the three fault classes criterion 5 names.
- `salvage/oracle-fixtures.md` was not edited. The 4-events-to-2-events
  translation (v1's leg-level event model vs. this schema's
  position-level `events` row) is recorded in `tests/ledger/
  test_oracle_gate.py`'s own module docstring.

## Task Commits

Each task was committed atomically, RED before GREEN (or documented
honestly where no separate GREEN commit was needed):

1. **Task 1: The 13-calendar oracle, the 14th control, and the global
   invariants**
   - `291bf72` `test(05-03): add failing test for the 13-calendar oracle
     gate` -- RED, observed: `ImportError: cannot import name
     'assert_matches_oracle' from 'tests.ledger.oracle_seed'` (verified by
     temporarily reverting the helper additions and re-running the file;
     no scaffolding built)
   - `b56a55f` `feat(05-03): add oracle_fill_records and
     assert_matches_oracle helpers` -- GREEN: 15/15 in
     `tests/ledger/test_oracle_gate.py`, 1.88s
2. **Task 2: The seeded-fault suite**
   - `05d9b65` `test(05-03): add the seeded-fault suite for OPS-06
     (sign-flip, rounding, off-by-one)` -- RED was the file not existing
     (pytest "file or directory not found" collection error). No
     companion `feat` commit: the three fault functions are this suite's
     own test infrastructure, authored together with the assertions they
     make fail -- there was no pre-existing production implementation to
     iterate against, so RED and GREEN land in one commit, per this
     project's own red-ceremony rule (cheapest honest red, no manufactured
     scaffolding). GREEN: 5/5 in 0.02s.

**Plan metadata:** (this commit)

## Files Created/Modified

- `tests/ledger/test_oracle_gate.py` -- the 13-calendar oracle, the four
  global invariants, the pure LEDGER-12 proof
- `tests/ledger/test_pairing_seeded_faults.py` -- the OPS-06 seeded-fault
  suite
- `tests/ledger/oracle_seed.py` -- adds `oracle_fill_records` and
  `assert_matches_oracle`, the two helpers both new test files share

## Decisions Made

See `key-decisions` in the frontmatter for the full record. In brief:
reseed-per-case measured at 1.88s for 15 tests, well under budget, so the
plan's module-scoped-derivation escape hatch was not needed;
`assert_matches_oracle` stays typed for `DerivedEvent` only, so the
stored-row parametrized case reads `read_events`' `EventRecord`s directly
rather than through the shared helper (this is what proves the
encrypt/store/decrypt round trip, which a pre-write comparison cannot);
`fills`/`events` invariant counts are read on `app_db_session`, not
`superuser_db_session`, because `insert_fills`/`insert_events` never
commit; and markers are per-function, not module-wide, so the pure case
keeps running under `uv run pytest -m "not db"`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Global-invariants test read fills/events counts on the
wrong session**
- **Found during:** Task 1, first run of `test_full_sweep_global_invariants`
- **Issue:** The test counted `fills`/`events` rows via
  `superuser_db_session`, but `insert_fills`/`insert_events` never commit
  (the caller owns the transaction, per both modules' own documented
  contract) -- a different session cannot see another session's
  uncommitted rows under Postgres's default read-committed isolation.
  Observed as a real failure: `assert 0 == 54`.
- **Fix:** Read both counts on `app_db_session` itself (the same session
  that performed the inserts), matching the pattern
  `test_pairing_no_position_state.py` already established for
  same-session `events` mutation. Documented in the test's own docstring.
- **Files modified:** `tests/ledger/test_oracle_gate.py`
- **Verification:** `test_full_sweep_global_invariants` passes; full file
  15/15 in 1.88s.
- **Committed in:** `b56a55f` (part of Task 1's GREEN commit -- the fix
  landed before the first commit of this file, so no separate commit
  documents it; the fixed version is what `291bf72`/`b56a55f` both
  contain)

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** Necessary for correctness -- the test would otherwise
have silently asserted a count of zero against a hardcoded 54 for the
wrong reason if the arithmetic had happened to coincide, which it did
not. No scope creep.

## Issues Encountered

None beyond the deviation above, which was caught and fixed within Task 1
before any commit landed.

## User Setup Required

None -- no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. This plan builds no new network endpoint, auth path, file access
pattern, or schema change -- it is test-only, over already-proven write
paths (`insert_fills`, `insert_events`).

## TDD Gate Compliance

RED and GREEN gate commits are both present for Task 1: `291bf72` (test)
precedes `b56a55f` (feat). Task 2 carries only a `test(05-03)` commit
(`05d9b65`) with no companion `feat` -- documented above as an honest
"RED was the file not existing, and the fault functions are this suite's
own infrastructure" case, not a missing gate.

## Next Phase Readiness

- The gate CLAUDE.md names as a hard constraint -- "The 13-calendar
  oracle passes before any money code ships" -- is green. Phase 5 is
  complete: all three plans (`05-01` one-calendar tracer, `05-02` both
  hard cases, `05-03` the full oracle and the fault suite) are done.
- D5-04's phase-level fact for Phase 9: the derivation is fee-free by
  decision (`salvage/oracle-fixtures.md`'s own stated convention).
  `commission_usd` is an explicit `None` on every `DerivedEvent`, never a
  zero (`NN-16`), and has no column in `events` this phase. The
  cash-delta reconciliation `RECON-01` owns will differ from these
  figures by roughly two to three cents per leg (the ground-truth doc's
  own fee-inclusive `netAmount` figures are that much higher) and must
  confront that gap at a typed boundary -- the `Decimal | None` on
  `commission_usd` -- rather than absorb it silently.
- Positive `ROLL` and `SETTLE` derivation remain out of scope (`D5-01`),
  deferred to a phase with a real fixture for them. `detect_roll` ships
  as the negative guard only, proven on the one real order this oracle
  contains that must not be mistaken for a roll.
- No blockers.

## Self-Check: PASSED

- Created files verified on disk: `tests/ledger/test_oracle_gate.py`,
  `tests/ledger/test_pairing_seeded_faults.py` (both `FOUND`).
- Modified file verified on disk: `tests/ledger/oracle_seed.py` (`FOUND`).
- All three task commit hashes verified in `git log`: `291bf72`,
  `b56a55f`, `05d9b65`.
- `uv run pytest -q && bash tools/gate.sh`: **322 passed** (baseline 302 +
  20 new: 15 in `test_oracle_gate.py` + 5 in
  `test_pairing_seeded_faults.py`), gate exit 0, ruff/ruff-format/
  basedpyright (97 files, 0 errors)/mypy (97 files, success) all clean,
  48.74s wall clock against the phase's ~46s baseline -- a roughly 2.7s
  increase, entirely from the 14 db-marked reseeds this plan adds, well
  inside the local gate's budget.

---
*Phase: 05-fill-pairing-and-the-oracle-gate*
*Completed: 2026-09-01*
