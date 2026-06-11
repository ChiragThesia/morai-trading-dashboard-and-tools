---
phase: 02-market-data-bsm-engine
plan: "03"
subsystem: core/journal/domain
tags: [iv-inversion, newton-raphson, bisection, tdd, domain, numerical]
dependency_graph:
  requires:
    - packages/core/src/journal/domain/bsm.ts (Plan 02 — bsmPrice + bsmVega)
  provides:
    - packages/core/src/journal/domain/iv-inversion.ts
  affects:
    - packages/core/src/journal/application/computeBsmGreeks.ts (Plan 06, calls invertIv)
tech_stack:
  added: []
  patterns:
    - Newton-Raphson IV inversion with Brenner-Subrahmanyam initial guess
    - Bisection fallback with correct priceLo tracking (prevents stale-reference divergence)
    - fast-check v4 property testing with Math.fround() bounds
key_files:
  created:
    - packages/core/src/journal/domain/iv-inversion.ts
    - packages/core/src/journal/domain/iv-inversion.test.ts
  modified: []
decisions:
  - "Bisection loop must update currentPriceLo as lo advances — stale priceLo causes lo-always-right divergence when priceLo==mark (near-intrinsic marks)"
  - "Test file uses result.error.kind directly (no 'as IvError' cast) — Result<number,IvError> typing makes the cast redundant and triggers consistent-type-assertions lint error"
  - "Upper bound check uses '>=' not '>' — mark exactly equal to discounted forward has no valid sigma, return above-bound"
metrics:
  duration: 6
  completed: "2026-06-11"
  tasks: 2
  files: 2
---

# Phase 02 Plan 03: IV Inversion Summary

Newton-Raphson IV inversion with bisection fallback, returning Result<number, IvError>. Round-trip error <=1e-6 over 1000 fast-check inputs; bisection path exercised for deep OTM options; degenerate inputs return typed errors, never NaN.

## What Was Built

`packages/core/src/journal/domain/iv-inversion.ts` exports two symbols:

- `invertIv(mark, S, K, T, r, q, type): Result<number, IvError>` — two-stage IV solver
- `IvError` — discriminated union: `{kind:'expired'} | {kind:'below-intrinsic'} | {kind:'above-bound'}`

Algorithm:
1. Guard order: T<=0 → expired; mark < intrinsic - 0.5 → below-intrinsic; mark >= upperBound → above-bound
2. Brenner-Subrahmanyam initial guess σ₀ = (mark/S)·√(2π/T), clamped to [0.001, 5.0] (fallback 0.2 if non-finite)
3. Newton-Raphson (MAX_ITER=50): breaks to bisection when vega < 1e-8 or sigma leaves bounds
4. Bisection (200 steps): correctly tracks `currentPriceLo` as lo advances, preventing the stale-reference divergence bug

Constants match RESEARCH.md Pattern 4: VEGA_THRESHOLD=1e-8, MAX_ITER=50, NR_TOL=1e-10, BISECT_LO=0.001, BISECT_HI=5.0.

## TDD Cycle

**RED** (`be95960`): `iv-inversion.test.ts` written before `iv-inversion.ts`. Confirmed failure: `Cannot find module './iv-inversion.ts'`. Four test groups: round-trip (1000 runs), monotonicity (1000 runs), bisection-path coverage (3 inputs forcing vega<VEGA_THRESHOLD), degenerate inputs (6 assertions).

**GREEN** (`cac2a01`): `iv-inversion.ts` implemented. All 13 tests pass. Core typecheck clean. Lint clean (2 `as IvError` assertions removed from test file — redundant given Result<number,IvError> return type). No REFACTOR step needed.

## Test Coverage

| Test Group | Count | Key Assertion |
|------------|-------|---------------|
| Round-trip property | 1 (1000 runs) | |bsmPrice(recovered) - mark| <= 1e-6 |
| Monotonicity property | 1 (1000 runs) | sigmaHi > sigmaLo => priceHi >= priceLo |
| Bisection-path coverage | 3 | deep OTM vega < VEGA_THRESHOLD, bisection converges |
| Degenerate inputs | 6 | expired, below-intrinsic, above-bound — typed errors |
| NaN-leak guard | 1 (1000 runs) | all ok paths finite, all err paths typed |

**Total: 13 tests, 54 passing in full core suite**

## TDD Gate Compliance

- RED gate: commit `be95960` (`test(02-03): ...`)
- GREEN gate: commit `cac2a01` (`feat(02-03): ...`)
- REFACTOR gate: not needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bisection stale-priceLo divergence for near-intrinsic marks**
- **Found during:** GREEN phase (fast-check found counterexample: S=500, K=400, T=0.01, sigma=0.05)
- **Issue:** When `priceLo == mark` (near-intrinsic marks where BSM price is flat in sigma), the bisection condition `(priceLo - mark) * diff` always evaluates to `0 * diff = 0`, which is not `< 0`, so `lo` always advances right and `sigma` converges to `BISECT_HI` instead of the correct low-sigma answer. Same bug affected the deep OTM cases where `priceLo = 0 = mark`.
- **Fix:** Added early-exit when `Math.abs(currentPriceLo - mark) < NR_TOL` (lo already solves the equation). Maintained `currentPriceLo` as a mutable variable updated when `lo` advances (not stale). This matches correct bisection algorithm invariant.
- **Files modified:** `packages/core/src/journal/domain/iv-inversion.ts`
- **Commit:** `cac2a01`

**2. [Rule 2 - Lint] `as IvError` assertions in test file violate consistent-type-assertions rule**
- **Found during:** GREEN phase (lint check)
- **Issue:** `(result.error as IvError).kind` — the cast is redundant because `result` is typed `Result<number, IvError>`, so `result.error` is already `IvError`. ESLint's `consistent-type-assertions: never` rejects it.
- **Fix:** Removed both `as IvError` casts; access `.kind` directly. Removed now-unused `import type { IvError }` import.
- **Files modified:** `packages/core/src/journal/domain/iv-inversion.test.ts`
- **Commit:** `cac2a01`

## Known Stubs

None. Pure numerical solver; no data wiring.

## Threat Flags

None. Pure functions with no I/O. T-02-05 (solver correctness) fulfilled by round-trip 1e-6 property. T-02-06 (DoS via infinite loop) fulfilled by MAX_ITER=50 + BISECT_STEPS=200 hard caps.

## Self-Check: PASSED

- packages/core/src/journal/domain/iv-inversion.ts: FOUND
- packages/core/src/journal/domain/iv-inversion.test.ts: FOUND
- RED commit be95960: FOUND
- GREEN commit cac2a01: FOUND
- Full core suite 54/54: PASSED
