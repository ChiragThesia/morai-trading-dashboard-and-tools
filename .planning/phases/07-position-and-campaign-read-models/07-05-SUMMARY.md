---
phase: 07-position-and-campaign-read-models
plan: 05
subsystem: database
tags: [ledger, roll, campaign-chain, sqlalchemy, postgres, tdd]

requires:
  - phase: 07-position-and-campaign-read-models
    provides: "07-03's widened sync_events idempotency key and EventType.SETTLEMENT; 07-04's campaign_chain view read wrapper (read_campaign_for_position)"
provides:
  - "Positive ROLL derivation in derive_events, reusing _signed_leg_amount/_net_amount unmodified (D7-09)"
  - "RollPair/_roll_pairs: the pure candidate-finding pass over detect_roll, unmodified"
  - "DerivedEvent.rolled_from_position_id and EventWrite.rolled_from_position_id wiring through sync_events (D7-10)"
  - "Proof that a campaign chain built from derived ROLL rows matches the same shape 07-04 proved over hand-seeded rows (ROADMAP criterion 4, closed end to end)"
affects: [phase-09-reconciliation, ledger-money-path]

actuals:
  tokens: 4740
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Roll pass runs before ordinary OPEN/CLOSE grouping inside derive_events, consuming matched fill keys so no fill contributes to both a ROLL and a separate OPEN/CLOSE"
    - "Bidirectional ambiguity guard in _roll_pairs: a closing fill with >1 candidate opening, or an opening fill with >1 candidate closing, forms no pair (NN-11)"

key-files:
  created:
    - tests/ledger/test_roll_derivation.py
  modified:
    - src/morai/ledger/pairing.py

key-decisions:
  - "No new money arithmetic: both ROLL halves are priced via the existing _net_amount(EventType.OPEN)/_net_amount(EventType.CLOSE) calls, verified by grep -c and a body-diff check that _signed_leg_amount/_net_amount are untouched (D7-09, D5-01's condition for lifting the deferral)"
  - "detect_roll's strict predicate is called unmodified from _roll_pairs -- not restated, not loosened -- so the oracle's order 1006797510202 negative case stays proved by the same code path"
  - "A ROLL missing either amount forms no ROLL at all (both fills fall through to the ordinary path) rather than a half-priced draft, matching NN-16 and letting insert_events' existing guard and migration 0008's roll_has_both_legs CHECK stay backstops rather than the only guard"

patterns-established:
  - "Split-commit TDD for a single test file spanning two plan tasks: Task 1's commit contains only the tests/imports its own behaviors need; Task 2's commit is a pure addition on top, each independently gate-clean"

requirements-completed: [LEDGER-10]

coverage:
  - id: D1
    description: "A same-order CLOSE/OPEN pair sharing root, strike, and option type but differing in expiry derives one ROLL event, never a separate CLOSE and OPEN"
    requirement: "LEDGER-10"
    verification:
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_same_order_same_root_strike_and_type_different_expiry_derives_one_roll"
        status: pass
    human_judgment: false
  - id: D2
    description: "A ROLL's open_debit_usd/close_credit_usd equal _net_amount's own output for each half, never netted or summed"
    requirement: "LEDGER-10"
    verification:
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_roll_amounts_are_exactly_net_amounts_own_output_never_netted"
        status: pass
    human_judgment: false
  - id: D3
    description: "A ROLL hangs on the newly opened position and rolled_from_position_id points at the closed one"
    requirement: "LEDGER-10"
    verification:
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_roll_hangs_on_the_opened_position_and_points_back_at_the_closed_one"
        status: pass
    human_judgment: false
  - id: D4
    description: "detect_roll's negative predicate branches (differing strike, root, option type, same expiry, unrecognized side, different orders) all fall through to the ordinary OPEN/CLOSE path"
    requirement: "LEDGER-10"
    verification:
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_pair_differing_in_strike_derives_no_roll"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_pair_differing_in_root_derives_no_roll"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_pair_differing_in_option_type_derives_no_roll"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_pair_with_same_expiry_on_both_sides_derives_no_roll"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_unrecognized_side_on_either_half_derives_no_roll_and_two_ordinary_events"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_roll_derivation.py#test_pair_in_different_orders_derives_no_roll"
        status: pass
    human_judgment: false
  - id: D5
    description: "The 13-calendar oracle derives exactly 26 OPEN/CLOSE events and zero ROLL events, including order 1006797510202 (D5-01's own negative guard, unweakened)"
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_derivation.py#test_full_oracle_derives_zero_roll_events"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_oracle_gate.py (unmodified, git diff --stat confirms no change)"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_roll_guard.py (unmodified, git diff --stat confirms no change)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A campaign chain built from derived ROLL rows (via insert_fills -> create_positions -> sync_events, the real pipeline) reads the same depth-0/1/2 shape 07-04 proved over hand-seeded rows"
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_derivation.py#test_two_position_roll_sequence_reads_as_a_depth_0_1_chain"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_roll_derivation.py#test_three_position_roll_sequence_reads_as_depths_0_1_2"
        status: pass
    human_judgment: false
  - id: D7
    description: "Re-running sync_events over the same fills adds no duplicate ROLL row and leaves the chain unchanged"
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_derivation.py#test_second_sync_events_pass_over_the_same_fills_adds_no_duplicate_roll"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-09-01
status: complete
---

# Phase 7 Plan 5: Positive ROLL Derivation and the Derived Campaign Chain Summary

**ROLL events now derive from same-order CLOSE/OPEN fill pairs by reusing the oracle-proven `_signed_leg_amount`/`_net_amount` functions unmodified, closing D5-01's deferral and ROADMAP criterion 4 end to end.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-01T12:55:00-05:00 (base commit)
- **Completed:** 2026-09-01T13:12:54-05:00
- **Tasks:** 2
- **Files modified:** 2 (`src/morai/ledger/pairing.py`, `tests/ledger/test_roll_derivation.py`)

## Accomplishments
- `derive_events` now runs a roll pass first: `_roll_pairs` finds every candidate same-order CLOSE/OPEN pair via `detect_roll` (unmodified), and each pair is priced by calling the existing `_net_amount(EventType.OPEN)`/`_net_amount(EventType.CLOSE)` — no new money arithmetic anywhere in this plan.
- A ROLL event stores both amounts split across `open_debit_usd`/`close_credit_usd`, hangs on the newly opened position, and points back at the closed one through `rolled_from_position_id` (D7-10), wired through `DerivedEvent` → `EventWrite` → `sync_events`.
- The 13-calendar oracle still derives exactly 26 OPEN/CLOSE events and zero ROLL events, including order `1006797510202` — `test_oracle_gate.py` and `test_pairing_roll_guard.py` are byte-identical (`git diff --stat` confirms no change).
- A campaign chain built from derived ROLL rows — seeded through `insert_fills`, `create_positions`, and `sync_events`, the real pipeline, never a direct `events` insert — reads the same depth-0/1/2 shape `read_campaign_for_position` (07-04) already proved over hand-seeded rows. Re-running `sync_events` adds no duplicate ROLL row.

## Task Commits

Each task was committed atomically:

1. **Task 1: Positive ROLL derivation, reusing the oracle-proven money functions** - `980bdea` (feat)
2. **Task 2: The campaign chain over derived rolls, end to end** - `9b203e7` (test)

_Note: the plan's own `files_modified` lists the same test file for both tasks. Task 1's commit contains only the tests and imports its own 9 behaviors need; Task 2's commit is a pure addition on top of that file, extending it to the full 13 tests. Each commit independently passes `bash tools/gate.sh`._

## Files Created/Modified
- `src/morai/ledger/pairing.py` — `EventType.ROLL`, `RollPair`, `_roll_pairs`, the roll pass inside `derive_events`, `sync_events`'s `rolled_from_position_id` wiring, updated module/`detect_roll` docstrings
- `tests/ledger/test_roll_derivation.py` — 13 tests: 9 pure (Tests 1-9, one db-marked oracle negative guard) plus 3 db-marked campaign-chain tests (Tests 10-12)

## Decisions Made
- No new money arithmetic: both ROLL halves are priced via the existing `_net_amount` calls, verified by `grep -c "def _signed_leg_amount"` returning `1` and a diff check that neither `_signed_leg_amount` nor `_net_amount`'s body changed (D7-09).
- `detect_roll`'s predicate is called unmodified from `_roll_pairs`, never restated or loosened — the oracle's order `1006797510202` negative case stays proved by the same code path that shipped in Phase 5.
- A ROLL missing either amount forms no ROLL at all (both fills fall through to the ordinary OPEN/CLOSE path) rather than a half-priced draft (NN-16) — `insert_events`'s existing guard and migration 0008's `roll_has_both_legs` CHECK remain backstops, not the only guard.
- `_roll_pairs`'s ambiguity guard is bidirectional (a closing fill matching >1 opening, or an opening fill matching >1 closing, forms no pair), extending the plan's literal instruction (which named only the closing-fill direction) to the symmetric case, consistent with NN-11's "never guessed" principle.

## Deviations from Plan

None — plan executed exactly as written. The bidirectional ambiguity guard in `_roll_pairs` (see Decisions Made) is a strict superset of the plan's literal instruction, not a deviation from it: the plan named the closing-fill-matches-multiple-openings case explicitly, and the symmetric opening-fill-matches-multiple-closings case follows from the same NN-11 principle the plan states.

## Known Stubs

None.

## Issues Encountered
None. Every task's tests passed on the first run against the implementation as written; no auto-fix, no blocking issue, no auth gate.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ROADMAP criterion 4 is closed: open/closed state (07-01/07-02), per-leg settlement (07-03), and rolled-position chains (this plan) are all computed from events, with no second writer for anything derivable.
- Phase 9's reconciliation invariant can now assume ROLL rows exist and are correctly split — no further deferral remains on the money side of a roll.
- `commission_usd` stays `None` and unpersisted this phase (D5-04, unchanged) — Phase 9 is still the phase that has to confront that gap.

## Self-Check: PASSED

- FOUND: `src/morai/ledger/pairing.py`
- FOUND: `tests/ledger/test_roll_derivation.py`
- FOUND: `.planning/phases/07-position-and-campaign-read-models/07-05-SUMMARY.md`
- FOUND commit: `980bdea`
- FOUND commit: `9b203e7`
- FOUND commit: `f5f8958`

---
*Phase: 07-position-and-campaign-read-models*
*Completed: 2026-09-01*
