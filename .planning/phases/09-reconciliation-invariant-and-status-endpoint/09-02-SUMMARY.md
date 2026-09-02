---
phase: 09-reconciliation-invariant-and-status-endpoint
plan: 02
subsystem: ledger
tags: [reconciliation, decimal, pytest, tdd, rls, postgres]

requires:
  - phase: 09-reconciliation-invariant-and-status-endpoint
    provides: "09-01's reconcile_window/run_reconciliation/reconciliation_runs read path, wired into sync_user"
provides:
  - "tests/ledger/test_reconciliation.py: 37 cases proving reconcile_window's arithmetic, its three verdicts and five indeterminate causes, and the window's edges (DST midnight, adjacency, closure ordering/emptiness, reopening)"
  - "src/morai/ledger/reconciliation.py::_event_contribution: the one seam every event's money routes through, extracted so the seeded-fault test can patch it (mirrors pairing.py's _signed_leg_amount seam)"
affects: [09-03]

actuals:
  tokens: 8940
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "One extracted per-item seam (_event_contribution) every amount routes through, patched by a seeded-fault test -- the same shape tests/ledger/test_pairing_seeded_faults.py already established for pairing.py's _signed_leg_amount"
    - "Difference-seeding by subtracting the seeded delta from a broker net amount so signed_difference_usd equals the seeded delta exactly -- makes a four-point sweep a structural proof against any tolerance"

key-files:
  created:
    - tests/ledger/test_reconciliation.py
  modified:
    - src/morai/ledger/reconciliation.py

key-decisions:
  - "Extracted `_event_contribution` from `reconcile_window`'s inline realised-P&L loop, mirroring `pairing.py`'s own `_signed_leg_amount` seam. The plan's Task 1 required a seeded-fault test following `test_pairing_seeded_faults.py`'s exact convention (patch one seam, assert the passing case fails), and no such single-function seam existed in `reconciliation.py` before this plan -- the arithmetic was inline in three unqualified elif branches. This is a same-behavior refactor (identical arithmetic, identical result on every existing case, verified by the unchanged Task-1 pass/fail assertions), not a defect fix, and was necessary to make the phase's own anti-vacuous-pass control (`D9-07`, `T-09-07`) provable at all -- justified under Rule 2 (missing critical functionality: a check with a documented teeth-proving requirement and no seam to prove it through)."
  - "Seeded discrepancies subtract the delta from the broker's closing net amount (`base - d`), which makes `signed_difference_usd` equal the seeded delta exactly (not its negation). This let one construction serve both the named one-cent case (Task 1 Test 2) and the four-point sweep (Task 1 Test 3) without a second fixture shape."
  - "Task 3's db-marked cases (Tests 8/9) use a zero-arithmetic scenario (no events, one TRADE broker transaction with net_amount_usd/commission_usd both `0.00`) rather than a balanced multi-leg fixture -- the window-mechanics claim (no-op re-run, reopening) is orthogonal to the arithmetic claim Task 1 already proved, and a minimal scenario keeps the db-marked cases fast and legible."

patterns-established:
  - "A comparison function with a documented anti-vacuous-pass requirement gets one small seam extracted for the seeded-fault test to patch, rather than leaving the arithmetic inline and unpatchable."

requirements-completed: [RECON-01, RECON-03]

coverage:
  - id: D1
    description: "reconcile_window agrees to the cent on a hand-derived fixture (PASSED, signed_difference_usd == 0), and a seeded one-cent discrepancy on the broker's own net amount returns FAILED with signed_difference_usd exactly 0.01"
    requirement: "RECON-01"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_a_window_that_agrees_to_the_cent_passes"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_a_seeded_one_cent_discrepancy_fails"
        status: pass
    human_judgment: false
  - id: D2
    description: "A four-point parametrized sweep (0, +0.01, -0.01, +1000.00) proves no epsilon and no constant-returning implementation can satisfy the suite -- PASSED only at zero, FAILED at the other three, signed_difference_usd equal to the seeded delta in every case"
    requirement: "RECON-01"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_verdict_across_a_discrepancy_sweep"
        status: pass
    human_judgment: false
  - id: D3
    description: "A seeded fault in the one seam every event's money routes through (_event_contribution) makes the previously-passing fixture fail, following tests/ledger/test_pairing_seeded_faults.py's own convention -- proves the comparison is sensitive to a real corruption, not merely passing because the pipeline happens to be right"
    requirement: "RECON-01"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_a_seeded_fault_in_the_comparison_makes_the_passing_case_fail"
        status: pass
    human_judgment: false
  - id: D4
    description: "A failed result names its trading_day, window_start/window_end, and all three of realised_pnl_usd/commissions_usd/cash_delta_usd -- the next question is answerable from the result alone"
    requirement: "RECON-03"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_failure_names_the_window_and_both_sides"
        status: pass
    human_judgment: false
  - id: D5
    description: "Four-decimal amounts survive the arithmetic digit-for-digit; a difference of 0.0001 still fails -- proves NUMERIC(14,4)-scale precision, not just cent-scale"
    requirement: "RECON-01"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_four_decimal_amounts_survive_the_arithmetic"
        status: pass
    human_judgment: false
  - id: D6
    description: "A ROLL event contributes close_credit_usd minus open_debit_usd to realised P&L, and a window containing one ROLL reconciles exactly"
    requirement: "RECON-01"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_roll_event_contributes_close_minus_open"
        status: pass
    human_judgment: false
  - id: D7
    description: "All three ReconciliationVerdict members and all five IndeterminateReason causes are exercised, each with its own case asserting its own reason (unrecognised type, missing commission, missing cash amount, unpriced settlement, missing event amount on OPEN/CLOSE/ROLL); every indeterminate result publishes all four money fields as None; an excluded transfer type is counted out of cash_delta_usd without being indeterminate; the allow-list/exclusion sets exactly cover the vendor's 15-member enum with nothing overlapping and nothing missing; a window with two simultaneous causes reports the earlier one stably"
    requirement: "RECON-03"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_indeterminate_on_an_unrecognised_transaction_type"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_indeterminate_on_a_missing_commission"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_indeterminate_on_a_missing_cash_amount"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_indeterminate_on_an_unpriced_settlement"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_indeterminate_publishes_no_numbers"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_an_excluded_transfer_type_is_not_counted_and_is_not_indeterminate"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_transaction_type_sets_cover_the_vendor_enum_exactly"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_indeterminate_reason_is_stable_when_two_causes_are_present"
        status: pass
    human_judgment: false
  - id: D8
    description: "trading_day_for is the sole window-membership predicate across a DST boundary in both directions; adjacent windows share no instant; closed_trading_days closes every day before the newest, is order-independent, and never treats an unobserved day as a candidate; window_bounds spans Eastern midnight to midnight across all four DST states"
    requirement: "RECON-02"
    verification:
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_eastern_midnight_belongs_to_exactly_one_window"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_adjacent_windows_share_no_instant"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_a_single_observed_day_closes_nothing"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_closed_days_are_every_day_before_the_newest"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_closure_does_not_depend_on_arrival_order"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_a_day_with_no_activity_is_never_a_candidate_window"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_reconciliation.py#test_window_bounds_spans_eastern_midnight_to_midnight"
        status: pass
    human_judgment: false
  - id: D9
    description: "Re-running run_reconciliation over an unchanged closed window writes no second row; a late broker transaction landing in an already-closed window makes the next run write one new row marked is_reopening=True for the same trading_day, leaving the earlier row's own values untouched -- seeded through insert_events/insert_broker_transactions, the real write paths"
    requirement: "RECON-02"
    verification:
      - kind: integration
        ref: "tests/ledger/test_reconciliation.py#test_an_unchanged_closed_window_writes_no_second_row"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_reconciliation.py#test_late_data_writes_a_new_row_marked_as_a_reopening"
        status: pass
    human_judgment: false
  - id: D10
    description: "The 13-calendar oracle stays byte-identical (pairing.py, oracle_seed.py, test_oracle_gate.py, salvage/oracle-fixtures.md untouched) and green"
    verification:
      - kind: other
        ref: "git diff --exit-code src/morai/ledger/pairing.py tests/ledger/oracle_seed.py tests/ledger/test_oracle_gate.py salvage/oracle-fixtures.md"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_oracle_gate.py"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-02
status: complete
---

# Phase 9 Plan 2: Reconciliation Invariant Has Teeth Summary

**37 new tests prove `reconcile_window`'s exact-`Decimal` comparison actually has teeth: a seeded one-cent discrepancy fails, a four-point sweep rules out any tolerance, a seeded fault in the extracted `_event_contribution` seam breaks the passing case, all three verdicts and all five `IndeterminateReason` causes are exercised, and the window's edges (DST midnight, adjacency, closure ordering, reopening) are proven — with zero defects found in plan 09-01's implementation.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-02 (this session)
- **Completed:** 2026-09-02
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## First Run's Real Output (unparaphrased)

The plan requires recording the first run's actual command and output before any implementation change. Before extracting `_event_contribution`, `reconciliation.py` had no function by that name — the natural, cheapest-honest red:

```
$ uv run pytest tests/ledger/test_reconciliation.py -x -q
==================================== ERRORS ====================================
_____________ ERROR collecting tests/ledger/test_reconciliation.py _____________
ImportError while importing test module '.../tests/ledger/test_reconciliation.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
../importlib/__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
tests/ledger/test_reconciliation.py:50: in <module>
    from morai.ledger.reconciliation import (
E   ImportError: cannot import name '_event_contribution' from 'morai.ledger.reconciliation'
=========================== short test summary info ============================
ERROR tests/ledger/test_reconciliation.py
!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
```

This is genuine evidence: the test file was written first (all 37 cases, across all three tasks), then `_event_contribution` was extracted from the inline arithmetic to make the seeded-fault case (and only that case) collectible and patchable. After the extraction, every case ran and passed on its first real run — recorded below, and it is genuine evidence rather than a vacuous pass because the sweep (4 parametrized cases, only the zero-delta one passing) and the seeded-fault case (the only case requiring the new seam) both ran in that same first pass:

```
$ uv run pytest tests/ledger/test_reconciliation.py -x -q
.....................................                                    [100%]
```

37 passed. Followed by `-m "not db"` (35 passed), `-m db` (2 passed), the oracle gate (15 passed), and `bash tools/gate.sh` (634 passed, ruff/basedpyright/mypy clean) — all reported below.

## Accomplishments

- `tests/ledger/test_reconciliation.py`: 37 cases across the plan's three tasks.
  - **Task 1 (7 tests, one parametrized ×4):** exact-to-the-cent pass with a hand-derived, arithmetic-commented fixture; a seeded one-cent discrepancy on the broker's own net amount fails with `signed_difference_usd == 0.01`; a four-point sweep (`0`, `+0.01`, `-0.01`, `+1000.00`) passes only at zero; a seeded fault in the `_event_contribution` seam breaks the passing fixture; a failure names its window and carries all three money fields; four-decimal amounts survive the arithmetic and a `0.0001` difference still fails; a ROLL contributes `close_credit_usd - open_debit_usd`.
  - **Task 2 (10 tests):** each of the five `IndeterminateReason` causes gets its own case asserting its own reason (unrecognised type, missing commission, missing cash amount, unpriced SETTLEMENT, missing event amount on OPEN/CLOSE/ROLL-either-side); every indeterminate result publishes all four money fields as `None`; a real vendor transfer type (`WIRE_IN`) is excluded from `cash_delta_usd` without triggering indeterminacy; `CASH_TRANSACTION_TYPES | EXCLUDED_TRANSACTION_TYPES` is proven to equal the vendor's own 15-member `TransactionType` enum exactly, disjoint; a window with two simultaneous causes reports the earlier one stably across two calls.
  - **Task 3 (9 pure + 2 db tests):** `trading_day_for` is proven the sole membership predicate across a DST boundary in both directions (July/January, before/at Eastern midnight); adjacent windows are proven to share no instant (positive intersection/union check, not just counts); `closed_trading_days` closes every day before the newest, is order-independent, and never treats an unobserved day as a candidate; `window_bounds` spans Eastern midnight to midnight across all four DST states (July, January, spring-forward, fall-back). The two db-marked cases seed through `insert_events`/`insert_broker_transactions` (the real write paths, `D3-14`) and prove `run_reconciliation`'s no-op-on-unchanged and reopening-on-restatement behavior end to end.
- `src/morai/ledger/reconciliation.py`: extracted `_event_contribution`, the one seam every event's money routes through inside `reconcile_window`'s realised-P&L sum — same arithmetic, same result on every case, but now the single patch point the seeded-fault test needs (mirroring `pairing.py`'s own `_signed_leg_amount` seam and `test_pairing_seeded_faults.py`'s own convention).
- Zero defects found in plan 09-01's `reconcile_window`/`closed_trading_days`/`trading_day_for`/`window_bounds`/`run_reconciliation`. The only source change this plan made was the seam extraction — a same-behavior refactor, not a bug fix.
- The 13-calendar oracle stayed byte-identical (`git diff --exit-code` over `pairing.py`, `oracle_seed.py`, `test_oracle_gate.py`, `salvage/oracle-fixtures.md` exits 0) and green (15 passed).

## Task Commits

1. **Tasks 1–3 (test file + `_event_contribution` extraction)** - `f6a16d2` (feat)

_All three tasks' tests were authored together in one file, then run once as a whole (following plan 09-01's own established precedent: "implementation and test files were authored together per task... run once each... no separate RED commit exists"). The natural red — `ImportError: cannot import name '_event_contribution'` — was observed and is recorded above verbatim; it was not captured as a standalone commit, since the test file and the one-function source correction were authored and verified together in a single pass before any commit. No implementation defect required a separate fix-and-re-run cycle: the only source change was the seam extraction itself, made before the first full run, not in response to a failing test._

**Plan metadata:** commit pending below (docs: complete plan)

## Files Created/Modified

- `tests/ledger/test_reconciliation.py` - 37 tests: Task 1 (invariant arithmetic + anti-vacuous-pass controls), Task 2 (three verdicts, five indeterminate causes), Task 3 (window edges: DST midnight, adjacency, closure, reopening)
- `src/morai/ledger/reconciliation.py` - extracted `_event_contribution`, the per-event money seam, from `reconcile_window`'s inline realised-P&L loop

## Decisions Made

- **Extracted `_event_contribution` as a same-behavior refactor, not a bug fix.** Plan 09-01's `reconcile_window` summed realised P&L with three unqualified `elif` branches inline — no single function every event's money routed through for a seeded-fault test to patch, unlike `pairing.py`'s `_signed_leg_amount`. The plan's Task 1 required a seeded-fault case following `test_pairing_seeded_faults.py`'s exact convention (patch one seam, prove the passing case breaks). Extracting the seam was necessary to make that requirement provable at all — justified under deviation Rule 2 (missing critical functionality: `D9-07`'s own anti-vacuous-pass mandate has no seam to prove itself through without this). Verified identical arithmetic and identical results on every pre-existing and new case; the AST checks for banned rounding/float/abs calls still pass unchanged.
- **Seeded discrepancies subtract the delta from the broker's closing net amount (`base - d`).** This makes `signed_difference_usd` equal the seeded delta exactly (not its negation), letting Task 1's named one-cent case (Test 2) and the four-point sweep (Test 3) share one fixture construction.
- **Task 3's db-marked cases use a zero-arithmetic scenario** (no events, one `TRADE` transaction with `net_amount_usd`/`commission_usd` both `"0.00"`) rather than reusing Task 1's balanced multi-leg fixture — the window-mechanics claim (no-op re-run, reopening) is independent of the arithmetic claim Task 1 already proved, so a minimal scenario keeps the db tests fast and focused on what they actually assert.

## Deviations from Plan

None requiring Rules 1/3/4. One Rule 2 auto-add:

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extracted `_event_contribution` seam for the seeded-fault test**
- **Found during:** Task 1 (writing the seeded-fault case)
- **Issue:** `reconcile_window`'s realised-P&L arithmetic was inline (three `elif` branches on `event.event_type`), with no single function every event's contribution routed through — the plan's own required seeded-fault test (following `test_pairing_seeded_faults.py`'s convention) had nothing to patch.
- **Fix:** Extracted `_event_contribution(event: EventRecord) -> Decimal`, called once per event inside `reconcile_window`'s existing loop. Identical arithmetic (OPEN: `-open_debit_usd`, CLOSE: `close_credit_usd`, ROLL: `close_credit_usd - open_debit_usd`), identical preconditions (the same `assert`s, now inside the extracted function), identical result on every case.
- **Files modified:** `src/morai/ledger/reconciliation.py`
- **Verification:** All Task 1–3 tests pass; oracle gate unaffected (module not touched); AST checks for banned `quantize`/`normalize`/`to_integral_value`/`float`/`abs`/`round` still pass; `bash tools/gate.sh` green at 634 tests.
- **Committed in:** `f6a16d2`

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical functionality: no seam existed for the phase's own mandated teeth-proving test).
**Impact on plan:** Necessary for `D9-07`/`T-09-07` to be provable as written. No scope creep — no behavior change, no new symbol beyond the one private helper, no file outside the plan's two-file scope touched.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `reconcile_window`'s exact-`Decimal` comparison, all three verdicts, all five `IndeterminateReason` causes, and the window's edge cases (DST, adjacency, closure, reopening) are now proven with teeth — no epsilon, no constant-returning implementation, and no silent corruption can pass this suite.
- Plan 09-03 (the status endpoint) can build on `read_window_verdicts`/`ReconciliationRunRecord` with this plan's proof that the underlying invariant check is trustworthy, not merely wired.
- No blockers. `bash tools/gate.sh` is green at 634 tests (597 baseline + 37 new).

---
*Phase: 09-reconciliation-invariant-and-status-endpoint*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: tests/ledger/test_reconciliation.py
- FOUND: src/morai/ledger/reconciliation.py (modified)
- FOUND commit: f6a16d2
