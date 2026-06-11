---
phase: 02-market-data-bsm-engine
plan: "08"
subsystem: core/journal
tags: [bsm, iv-inversion, bug-fix, tdd, gap-closure]
completed: "2026-06-11T19:08:00Z"
duration_minutes: 30
tasks_completed: 2
tasks_total: 2
files_created: 0
files_modified: 4
commits:
  - hash: "5431ceb"
    message: "fix(02-08): European no-arb lower bound + post-solve residual check in invertIv (CR-03, WR-01)"
  - hash: "e0c13ca"
    message: "fix(02-08): compute T from obs.time per row in computeBsmGreeks (CR-02)"
requirements: [BSM-01, BSM-03]
depends_on: []
dependency_graph:
  requires: []
  provides:
    - "invertIv: European no-arb lower-bound guard replaces American intrinsic"
    - "invertIv: post-solve residual check (1e-4) closes bisection endpoint-clamp fabrication path"
    - "computeBsmGreeks: T computed from obs.time per row, not job wall-clock"
    - "factory signature (incl. deps.now) preserved — worker composition root untouched"
  affects:
    - "packages/core/src/journal/domain/iv-inversion.ts"
    - "packages/core/src/journal/application/computeBsmGreeks.ts"
tech_stack:
  added: []
  patterns:
    - "European no-arb lower bound: max(K·e^(-rT) - S·e^(-qT), 0) for puts; max(S·e^(-qT) - K·e^(-rT), 0) for calls"
    - "Post-solve residual check: |bsmPrice(sigma) - mark| > 1e-4 → err(below-intrinsic)"
    - "Per-row observation-time T: computeT(obs.time, obs.expiry, obs.root)"
key_files:
  modified:
    - "packages/core/src/journal/domain/iv-inversion.ts"
    - "packages/core/src/journal/domain/iv-inversion.test.ts"
    - "packages/core/src/journal/application/computeBsmGreeks.ts"
    - "packages/core/src/journal/application/computeBsmGreeks.test.ts"
decisions:
  - "European no-arb bound used instead of American intrinsic (SPX/SPXW are European-exercise; spec_lock in 02-CONTEXT.md D-03)"
  - "Post-solve residual tolerance set to 1e-4 absolute (catches endpoint-clamped sigmas; round-trip property maintains 1e-6)"
  - "IvError union kept to three members (expired | below-intrinsic | above-bound) — no new variant, existing callers unaffected"
  - "deps.now retained in factory type but local binding removed (sibling plan 02-09 owns worker wiring)"
  - "Existing degenerate-input test updated: S=4000,K=5000,T=0.5 European put bound ≈ 915, so mark=999 is valid; test now uses mark=850 (genuinely below European bound)"
---

# Phase 02 Plan 08: Gap Closure — IV Inversion + Obs-Time T Summary

Gap closure plan fixing three defects that permanently NaN-stamped valid observations or fabricated IV in the BSM compute pipeline.

## What Was Built

**One-liner:** European no-arb bound + post-solve residual check in IV solver, and obs.time per-row T in the use case, so no valid observation is ever silently NaN-stamped or given fabricated IV.

### CR-02: Per-Row obs.time for computeT (Task 2)

**Bug:** `computeBsmGreeks.ts` called `computeT(now, obs.expiry, obs.root)` where `now = deps.now()` was the job wall-clock, captured once at job-run time. Any 0DTE row observed before 16:00 ET but computed after 16:00 ET got T=0 from the job wall-clock → `invertIv` returned `err({kind:'expired'})` → permanent NaN stamp.

**Fix:** Changed to `computeT(obs.time, obs.expiry, obs.root)` — T is now measured from each observation's own timestamp, not the ambient job time. A row observed at 15:30 ET has T = 30 min / 525960 ≈ 5.7e-5 years (positive), so `invertIv` proceeds normally.

**Factory signature preserved:** `deps.now` remains in the `makeComputeBsmGreeksUseCase` deps type so `apps/worker/src/main.ts` (owned by sibling plan 02-09 in the same wave) needs no changes. The local `const now = deps.now()` binding was removed since it is now unused.

### CR-03: European No-Arb Lower Bound (Task 1)

**Bug:** `invertIv` used American intrinsic `max(K-S, 0)` (put) as the lower-bound guard. SPX/SPXW options are European. For a deep-ITM put with S=7000, K=7700, T=90/365: American intrinsic = 700, but the correct European no-arb lower bound = K·e^(-rT) - S·e^(-qT) ≈ 637.9. Valid marks in [637.9, 700) were permanently rejected and NaN-stamped.

**Fix:** Replaced the intrinsic guard with the European discounted no-arb bound:
- Put:  `max(K·Math.exp(-r·T) - S·Math.exp(-q·T), 0)`
- Call: `max(S·Math.exp(-q·T) - K·Math.exp(-r·T), 0)`

The 0.5 rounding tolerance is preserved: marks below `lowerBound - 0.5` are rejected as `err({kind:'below-intrinsic'})`.

### WR-01: Post-Solve Residual Check (Task 1)

**Bug:** The bisection fallback had an endpoint-clamp path: when the mark fell outside `[bsmPrice(BISECT_LO), bsmPrice(BISECT_HI)]`, it returned `ok(BISECT_LO)` or `ok(BISECT_HI)` — a fabricated sigma that does not reprice to the mark. Similarly, non-converged Newton iterations could fall through with a poor sigma.

**Fix:** Added a post-solve residual check before the final `return ok(sigma)`:
```
residualPrice = bsmPrice(S, K, T, sigma, r, q, type)
if |residualPrice - mark| > 1e-4 → return err({kind:'below-intrinsic'})
```

Tolerance is 1e-4 absolute (the round-trip property maintains 1e-6; 1e-4 here is sufficient to catch endpoint-clamped sigmas without being too strict for well-converged solutions). The `IvError` union is unchanged (expired | below-intrinsic | above-bound) so callers and exhaustiveness tests are unaffected.

## Test Coverage

### Task 1 — iv-inversion.test.ts (17 tests, all pass)

RED tests added (failing before fix):
- `CR-03a`: deep-ITM European put derived from `bsmPrice(7000,7700,90/365,0.15,0.045,0.013,'P')` inverts and round-trips within 1e-4
- `CR-03b`: put mark=650 at same params (inside [~637.9, 699.5)) returns `ok` and round-trips

GREEN after fix; also:
- `CR-03c`: put mark=600 (below European bound) returns `err({kind:'below-intrinsic'})` — passed immediately (600 is also below American intrinsic)
- `WR-01`: 1000-run property — every `ok` result satisfies `|bsmPrice(recovered sigma) - mark| ≤ 1e-4`

**Existing test updated (deviation):** The "mark below put intrinsic" test for S=4000,K=5000,T=0.5 used mark=999. The European put bound at those params ≈ 915, so mark=999 is a VALID European put mark (above the bound). The test was updated to use mark=850, which is genuinely below the European bound. This is a correct semantic update — the old test was asserting American-intrinsic behavior that is wrong for European options.

### Task 2 — computeBsmGreeks.test.ts (9 tests, all pass)

RED test added (failing before fix):
- `CR-02 regression`: 0DTE SPXW row with `obs.time`=15:30 ET, `now`=16:30 ET, expiry=same day → after fix, all five `bsm_*` are finite numeric strings (not 'NaN')

The magnitude-guard test and all other existing tests remain green. T ≈ 1.000057 years (from obs.time 15:00 UTC to SPXW 2027-06-11 PM cutoff) vs 1.0 from `now` — difference is within the test's tolerance (|vega - 0.378| < 0.05, |theta - (-0.015)| < 0.005).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing degenerate-input test for European put bound semantics**
- **Found during:** Task 1 GREEN phase (all-suite run)
- **Issue:** The plan commented that "the existing 'mark below put intrinsic' test at S=4000,K=5000 uses mark=999 which is below the European bound too, so it stays valid." This was factually incorrect: the European put bound at those params (K=5000, S=4000, T=0.5, r=0.045, q=0.013) is ≈ 915, and mark=999 > 915, so 999 is a valid European put mark. After the fix, `invertIv(999,4000,5000,0.5,…,'P')` correctly returns `ok` (the solver finds a valid sigma), breaking the test's assertion of `result.ok === false`.
- **Fix:** Updated the test to use mark=850, which is genuinely below the European bound (~915), so `err({kind:'below-intrinsic'})` is the correct outcome.
- **Files modified:** `packages/core/src/journal/domain/iv-inversion.test.ts`
- **Commit:** 5431ceb

## Known Stubs

None. Both fixes are complete implementations. No hardcoded empty values, placeholder text, or wired-up stubs.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All changes are pure domain logic corrections within `packages/core/` — inside the hexagon. The threat mitigations from the plan's threat model are satisfied:

| Threat ID | Status |
|-----------|--------|
| T-02-22 (fabricated IV via endpoint-clamp) | Mitigated — post-solve residual check ensures only repricing solves are returned as ok |
| T-02-23 (valid rows NaN-stamped) | Mitigated — European bound + obs.time T prevent valid 0DTE/deep-ITM rows from being wrongly rejected |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `iv-inversion.ts` exists | FOUND |
| `iv-inversion.test.ts` exists | FOUND |
| `computeBsmGreeks.ts` exists | FOUND |
| `computeBsmGreeks.test.ts` exists | FOUND |
| `02-08-SUMMARY.md` exists | FOUND |
| commit 5431ceb exists | FOUND |
| commit e0c13ca exists | FOUND |
| `Math.exp(-r * T)` in iv-inversion.ts | FOUND |
| `Math.exp(-q * T)` in iv-inversion.ts | FOUND |
| `computeT(obs.time` in computeBsmGreeks.ts | FOUND |
| residual check (`Math.abs(residualPrice - mark)`) in iv-inversion.ts | FOUND |
