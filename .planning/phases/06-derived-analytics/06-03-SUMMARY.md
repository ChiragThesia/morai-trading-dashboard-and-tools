---
phase: 06-derived-analytics
plan: 03
subsystem: analytics
tags: [risk-reversal, percentile-rank, interpolation, fast-check, hexagonal, domain]

# Dependency graph
requires:
  - phase: 06-01
    provides: SmileQuote row type + analytics ports + RED scaffolds (risk-reversal.test.ts, percentile-rank.test.ts)
provides:
  - "interpolateRiskReversal: 25Δ risk-reversal via linear-in-delta interpolation, null when ±0.25 unbracketable"
  - "percentileRank: inclusive trailing-window percentile in [0,100], empty→100 sentinel"
  - "both domain functions re-exported from analytics + core barrels for the 06-05 use-case"
affects: [06-05, computeAnalytics, skew-slice]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pure numeric domain: imports only same-context types, no I/O, no Date.now()"
    - "fast-check property tests for interpolation + percentile numerics (Math.fround on fc.float bounds)"
    - "null-propagation for unbracketable interpolation (never extrapolate / fabricate)"

key-files:
  created:
    - packages/core/src/analytics/domain/risk-reversal.ts
    - packages/core/src/analytics/domain/risk-reversal.property.test.ts
    - packages/core/src/analytics/domain/percentile-rank.ts
    - packages/core/src/analytics/domain/percentile-rank.property.test.ts
  modified:
    - packages/core/src/analytics/domain/risk-reversal.test.ts
    - packages/core/src/analytics/domain/percentile-rank.test.ts
    - packages/core/src/analytics/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "interpAtDelta returns null when the target delta is not bracketed by available points — never extrapolates"
  - "percentileRank empty-history sentinel = 100 (locked by plan); rr_rank null-ness is handled by the 06-05 caller, not here"
  - "reconciled the 06-01 percentile-rank RED scaffold from [0,1]+null-on-empty to the plan-locked [0,100]+100-on-empty contract"

patterns-established:
  - "Tightest-bracket interpolation helper: pick largest delta ≤ target and smallest delta ≥ target, linear across delta"
  - "Property-test trio for interpolation: no-overshoot, null-safety, order-independence"

requirements-completed: [ANLY-01]

# Metrics
duration: ~10min
completed: 2026-06-22
status: complete
---

# Phase 6 Plan 03: Skew Numerics Domain Summary

**Pure-domain `interpolateRiskReversal` (25Δ RR, linear-in-delta, null when unbracketable) and `percentileRank` (inclusive [0,100] trailing-window rank), both fast-check property-tested and re-exported from the core barrel.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-22T16:15:00Z (approx)
- **Completed:** 2026-06-22T16:25:04Z
- **Tasks:** 2 features (TDD red→green each)
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- `interpolateRiskReversal`: splits the smile into puts/calls, interpolates IV linearly in delta to −0.25 / +0.25, subtracts; returns `null` when either wing cannot bracket its target (SPEC R2 — never fabricate). Worked example asserts `rr ≈ 0.06` to 1e-6.
- `percentileRank`: inclusive (weak) percentile `100·count(history ≤ value)/n` in [0,100], with a documented empty-history → 100 sentinel (forward-only first observation).
- Both functions are pure domain (no I/O, no `Date.now()`), re-exported from `analytics/index.ts` and `core/src/index.ts` for the 06-05 skew use-case.
- Fast-check property coverage: RR (no-overshoot, null-safety, order-independence) and rank (bounds [0,100], monotonicity, inclusivity) — 1000 runs each.

## Task Commits

1. **Feature 1: interpolateRiskReversal** - `5843671` (feat) — test (worked example + null cases + property test) RED at assertion level → implementation GREEN
2. **Feature 2: percentileRank + barrels** - `b796741` (feat) — scaffold reconciled + property test RED → implementation GREEN + barrel re-exports

_TDD note: per the documented Phase 3 execution lesson, RED was proven inline (stub returning a deliberately-wrong constant → assertion-level failures shown) rather than as a separate `test(...)` commit; each feature committed once at green._

## Files Created/Modified
- `packages/core/src/analytics/domain/risk-reversal.ts` - interpolateRiskReversal + interpAtDelta helper (tightest-bracket linear-in-delta, null when unbracketable)
- `packages/core/src/analytics/domain/risk-reversal.test.ts` - worked example (0.06), null/unbracketable/all-puts/all-calls/empty/exact-hit, NaN/null-delta filtering, order-independence
- `packages/core/src/analytics/domain/risk-reversal.property.test.ts` - fast-check: no-overshoot, null-safety, order-independence (1000 runs each)
- `packages/core/src/analytics/domain/percentile-rank.ts` - percentileRank (inclusive [0,100], empty→100)
- `packages/core/src/analytics/domain/percentile-rank.test.ts` - reconciled to [0,100]; mid/max/min/repeats/empty cases
- `packages/core/src/analytics/domain/percentile-rank.property.test.ts` - fast-check: bounds, monotonicity, inclusivity (1000 runs each)
- `packages/core/src/analytics/index.ts` - re-export both domain functions
- `packages/core/src/index.ts` - re-export both domain functions from the analytics section

## Decisions Made
- **Empty-history sentinel = 100** (plan-locked "you decide"). Documented in the function JSDoc. `rr_rank` null-ness when RR is null is the 06-05 caller's concern, kept out of this window-agnostic function.
- **Tightest-bracket interpolation**: choose the largest delta ≤ target and smallest delta ≥ target; an exact hit (delta === target) collapses to that point's IV (zero-span guarded).

## Deviations from Plan

### Reconciled scaffold contract (not an auto-fix — followed the plan's locked behavior)

**1. percentile-rank RED scaffold scale + empty-history semantics**
- **Found during:** Feature 2 (percentileRank)
- **Issue:** The 06-01 RED scaffold asserted a `[0,1]` scale (`toBeCloseTo(1.0)`, `toBeCloseTo(0.6)`) and `null` for empty history. The 06-03 plan `<behavior>` locks the `[0,100]` scale and an empty-history → `100` sentinel.
- **Resolution:** Updated the scaffold example tests to the plan-locked contract (order of authority: plan > scaffold; the plan's `<implementation>` directs "extend the 06-01 scaffold"). The scaffold's intent — inclusive trailing-window percentile — is preserved; only the units and the empty sentinel changed to match the locked decision.
- **Files modified:** packages/core/src/analytics/domain/percentile-rank.test.ts
- **Verification:** All 10 percentile-rank tests (example + property) green.
- **Committed in:** b796741

---

**Total deviations:** 1 (scaffold→locked-contract reconciliation; no auto-fixes under Rules 1-4 were needed)
**Impact on plan:** Brings the RED scaffold in line with the plan's locked numeric contract. No scope creep.

## Issues Encountered
None — both features went red→green cleanly on first implementation.

## Threat Surface
- **T-06-05 (Tampering — fabricated RR):** mitigated — `interpolateRiskReversal` returns null on any unbracketable wing; asserted by example tests + the fast-check null-safety property.
- **T-06-06 (Tampering — NaN/out-of-range corruption):** mitigated — null/NaN delta+iv points filtered before interpolation; `percentileRank` bounds [0,100] property-tested.
No new threat surface introduced.

## Next Phase Readiness
- Both numeric domain functions are ready for the 06-05 skew use-case (`makeComputeAnalyticsUseCase` consumes them via the core barrel).
- **Still RED (expected, out of scope for 06-03):** `packages/core/src/analytics/application/computeAnalytics.test.ts` fails with module-not-found for `./computeAnalytics.ts` — that factory is implemented in 06-04 (term-structure half) / 06-05 (skew/RR half). This is the only typecheck error and the only failing test file in the analytics context.

## Self-Check: PASSED

All created files verified present; both feature commits (`5843671`, `b796741`) verified in git history.

---
*Phase: 06-derived-analytics*
*Completed: 2026-06-22*
