---
phase: 27-pick-04-backtest-harness
plan: 04
subsystem: testing
tags: [fast-check, vitest, backtest, statistics, tdd]

requires:
  - phase: 27-pick-04-backtest-harness (plan 01)
    provides: backtest domain types (DirectionalAttributionRow, AblationRow, CoverageDay, BacktestReport) + backtest/index.ts barrel skeleton
provides:
  - directionalAttribution — pure median-split sign test (yes/no/insufficient + n), never a Pearson coefficient
  - ablationDelta — pure rank-index diff between baseline and leave-one-rule-out ablated rankings
  - bootstrapCi — seeded mulberry-style-PRNG bootstrap resample CI + quantile() helper
  - coveragePercent — replayed-of-total cohort coverage per day + overall, gap cohorts excluded
  - all four fns + their types threaded through packages/core/src/backtest/index.ts (value exports, not just types)
affects: [27-05 (replay use-cases produce the (metric,outcome) samples/rankings these fns consume), 27-06 (runBacktest report assembly calls all four directly)]

tech-stack:
  added: []
  patterns:
    - "Kernel fns are pure numeric reducers with no I/O — RED stub (throws 'not implemented') committed first, full impl committed second, per task"
    - "Honesty-over-precision statistics: sign+n instead of correlation coefficient, seeded bootstrap instead of a parametric interval, gap-cohort-excluded coverage instead of a silent denominator"

key-files:
  created:
    - packages/core/src/backtest/domain/directional-attribution.ts
    - packages/core/src/backtest/domain/directional-attribution.test.ts
    - packages/core/src/backtest/domain/ablation-delta.ts
    - packages/core/src/backtest/domain/ablation-delta.test.ts
    - packages/core/src/backtest/domain/bootstrap-ci.ts
    - packages/core/src/backtest/domain/bootstrap-ci.test.ts
    - packages/core/src/backtest/domain/coverage.ts
    - packages/core/src/backtest/domain/coverage.test.ts
  modified:
    - packages/core/src/backtest/index.ts

key-decisions:
  - "directionalAttribution's tie rule: metric <= median goes to the low half, metric > median to the high half — documented and deterministic, not left implicit"
  - "quantile() lives in bootstrap-ci.ts (exported) rather than a shared cross-file helper — directional-attribution.ts computes its own median inline since it's authored in an earlier task, avoiding a same-plan forward dependency"
  - "coveragePercent's overall row uses the sentinel date 'overall' on the same CoverageDayResult shape as per-day rows, rather than inventing a second output type, since every field it needs (replayed/total/coveragePct) is identical"

requirements-completed: [BT-04]

coverage:
  - id: D1
    description: "directionalAttribution: median-split sign test returns yes/no/insufficient + n, never a coefficient; insufficient below n=4 or on a constant metric array"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/domain/directional-attribution.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "ablationDelta: pure rank-index diff between baseline/ablated rankings; zeroing a rule's positive contribution to a candidate never improves that candidate's rank"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/domain/ablation-delta.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "bootstrapCi: seeded resample CI — deterministic per (samples, seed), degenerates to a point interval at n=1 or a constant array, low <= high always, empty samples => NaN/NaN/0"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/domain/bootstrap-ci.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "coveragePercent: replayed-of-total per day + overall, gap cohorts (spot 0/NaN) counted toward total but never toward replayed"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/domain/coverage.test.ts"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-09
status: complete
---

# Phase 27 Plan 04: Backtest Report Kernel Summary

**Pure, no-I/O report kernel — median-split directional attribution, rank-delta ablation, seeded bootstrap CI, and gap-excluded coverage — all fast-check TDD'd and threaded through the backtest barrel for 06's `runBacktest` to consume.**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

- `directionalAttribution` — median-split sign test over paired (metric, outcome) samples; returns `{ verdict: "yes"|"no"|"insufficient", n }`, never a Pearson coefficient (the CONTEXT.md lock). Insufficient below n=4 or for a constant metric array (no split possible). Ties at the median resolve deterministically (`metric <= median` → low half).
- `ablationDelta` — pure rank-index diff between a baseline ranked-id list and an ablated one; the property test constructs a re-scoring where only the target candidate's score falls by a positive amount and asserts the resulting rank never improves (delta always >= 0).
- `bootstrapCi` — seeded mulberry-style-LCG resample bootstrap + a `quantile()` helper (percentileRank doesn't invert). Same `(samples, seed)` always reproduces the identical interval; constant arrays and n=1 both degenerate to a point interval; `low <= high` always; empty samples return `{ low: NaN, high: NaN, n: 0 }`.
- `coveragePercent` — reduces a flat list of `{date, isGap}` cohort records into per-day and overall `{replayed, total, coveragePct}`; a gap cohort counts toward `total` but is never counted as `replayed`.
- All four functions (plus their supporting types) are now value-exported from `packages/core/src/backtest/index.ts`, not just declared as types — the barrel is the seam 27-06's `runBacktest` report assembly will import from.

## Task Commits

Each task followed RED (failing stub test) → GREEN (implementation):

1. **Task 1: Directional attribution + ablation delta**
   - `c93bac2` test(27-04): add failing tests for directional attribution + ablation delta
   - `136fa82` feat(27-04): implement directional attribution + ablation delta kernel fns
2. **Task 2: Seeded bootstrap CI + coverage**
   - `137a88e` test(27-04): add failing tests for seeded bootstrap CI + coverage
   - `a6ca9b9` feat(27-04): implement seeded bootstrap CI + coverage, thread kernel through barrel

_No plan-metadata commit prior to this SUMMARY; this file + STATE.md/ROADMAP.md updates are handled by the orchestrator per this plan's explicit instruction (do NOT update STATE.md/ROADMAP.md from inside this plan)._

## Files Created/Modified

- `packages/core/src/backtest/domain/directional-attribution.ts` — median-split sign test
- `packages/core/src/backtest/domain/directional-attribution.test.ts` — unit + fast-check coverage (constant array, n<4, ties, known splits)
- `packages/core/src/backtest/domain/ablation-delta.ts` — rank-index diff
- `packages/core/src/backtest/domain/ablation-delta.test.ts` — unit + fast-check positive-contribution invariant
- `packages/core/src/backtest/domain/bootstrap-ci.ts` — seeded bootstrap CI + `quantile()` helper
- `packages/core/src/backtest/domain/bootstrap-ci.test.ts` — unit + fast-check (determinism, degeneracy, low<=high)
- `packages/core/src/backtest/domain/coverage.ts` — replayed-of-total coverage reducer
- `packages/core/src/backtest/domain/coverage.test.ts` — unit + fast-check (gap-exclusion invariant)
- `packages/core/src/backtest/index.ts` — added value exports for all four kernel fns + their types

## Decisions Made

- Tie rule for the median split is `metric <= median => low half` — documented in the function's own doc comment and covered by a dedicated determinism test, rather than left as an implicit sort-order accident.
- `quantile()` is exported from `bootstrap-ci.ts` (where the CI needs it) rather than factored into a third shared file; `directionalAttribution`'s own median calculation is a small inline helper in the same file, since Task 1 (attribution) is authored before Task 2 (bootstrap-ci) exists in this plan's task order and a forward dependency between same-plan tasks would break the RED-first sequencing.
- `coveragePercent`'s overall figure reuses the same `CoverageDayResult` shape as per-day rows (sentinel `date: "overall"`) instead of a bespoke second type — every field it needs is identical, so a second type would be an unrequested abstraction (ponytail: same shape, same accessor, one type).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Relaxed a fast-check assertion from exact equality to a tolerance band**
- **Found during:** Task 2 (bootstrap-ci property test run)
- **Issue:** The "constant samples array degenerates to a point interval" property test asserted `result.low === value` with `toBe`-style exact equality. fast-check's shrinker found a subnormal-magnitude counterexample (`~-6.4e-267`) where summing six identical floats and dividing by six differs from the input by a few ULP — a floating-point summation artifact, not a bug in `bootstrapCi` itself (the same class of tolerance `realized-vol.test.ts` already uses for its own scale-invariance property).
- **Fix:** Changed the assertion to `Math.abs(result.low - value) <= 1e-9 * Math.max(1, Math.abs(value))`, matching the existing repo convention for floating-point property assertions.
- **Files modified:** `packages/core/src/backtest/domain/bootstrap-ci.test.ts`
- **Verification:** Full domain suite (30/30) green after the fix; re-ran the fast-check property 100+ times with no further counterexamples.
- **Committed in:** `a6ca9b9` (part of Task 2's GREEN commit — the fix landed before the commit, so no separate fix commit was needed)

---

**Total deviations:** 1 auto-fixed (1 bug — test-tolerance correction, not a production-code bug)
**Impact on plan:** No scope creep; the deviation is entirely inside the newly-authored test file and does not touch any production logic described in the plan.

## Issues Encountered

None beyond the deviation above.

## Next Phase Readiness

- All four report-kernel functions are pure, fully tested, and reachable via `packages/core/src/backtest/index.ts` — 27-05's replay use-cases (leakage oracle, 13-trade exit replay, hypothetical-entry walk-forward) can produce the `(metric, outcome)` samples, baseline/ablated rankings, P&L samples, and `{date, isGap}` cohort lists these functions consume, and 27-06's `runBacktest` can call all four directly for report assembly.
- Full monorepo suite (255 files, 2585 tests) green; `bun run typecheck` and `bun run lint` both clean.
- No blockers for 27-05.

---
*Phase: 27-pick-04-backtest-harness*
*Completed: 2026-07-09*
