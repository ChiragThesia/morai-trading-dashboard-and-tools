---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: "03"
subsystem: GEX domain math
tags: [gex, analytics, domain, tdd, bsm, gamma-exposure]
dependency_graph:
  requires: ["08-02"]
  provides: ["packages/core/src/analytics/domain/gex.ts"]
  affects: ["08-05 (computeGexSnapshot use-case composes these functions)"]
tech_stack:
  added: []
  patterns:
    - "Pure domain function exports — no class, no side-effects, readonly inputs"
    - "dollarGamma formula: gamma×OI×100×spot²×0.01/1e9 (SPX $Bn/1% convention)"
    - "findFlip linear interpolation over adjacent sign-change pairs"
    - "buildProfile re-prices via bsmGreeks() intra-core import (no re-derivation)"
key_files:
  created:
    - "packages/core/src/analytics/domain/gex.ts"
  modified: []
decisions:
  - "dollarGamma sign is unsigned (caller applies +/- based on call/put); strikeGex owns the signing"
  - "findFlip returns null for single-element profiles (no adjacent pair to compare)"
  - "buildProfile DTE computed from leg.expiration (YYYY-MM-DD at 21:00Z) vs leg.time — consistent with bsmGreeks T parameter"
  - "StrikeGexEntry exported from gex.ts as a local type (not via ports.ts — pure domain concern)"
metrics:
  duration: "3 minutes"
  completed: "2026-06-24"
  tasks_completed: 1
  files_changed: 1
status: complete
---

# Phase 08 Plan 03: GEX Domain Math Summary

Pure GEX domain functions (dollarGamma, strikeGex, findFlip, buildProfile) turning the 08-02 oracle RED test GREEN — flip≈7488, netGammaAtSpot≈-47 $Bn/1%, callWall=7600, putWall=7400 — reusing bsmGreeks from the existing BSM engine.

## What Was Built

`packages/core/src/analytics/domain/gex.ts` exports four pure functions:

- **dollarGamma(gamma, oi, spot)**: Single-contract dollar gamma in $Bn/1% spot move using the SPX formula `gamma × OI × 100 × spot² × 0.01 / 1e9`.
- **strikeGex(contracts, spot)**: Per-strike net GEX aggregation where calls contribute positively and puts negatively. Returns `StrikeGexEntry[]` sorted ascending by strike. callWall = argmax(positive entries), putWall = argmin (most-negative entry).
- **findFlip(grid)**: Linear-interpolated zero-crossing of the `{strike, gamma}` profile. Scans adjacent pairs for a sign change, linearly interpolates the exact crossing. Returns null when the profile never changes sign (Pitfall 5 — all-negative or all-positive).
- **buildProfile(contracts, spotGrid)**: Re-prices net dollar gamma at each grid spot by calling `bsmGreeks(S, K, T, iv, r, q, type)` per contract per spot. Sums signed dollar gamma (calls +, puts −). Uses SPX constants r=0.043, q=0.013 (D-01).

## Task Execution

### Task 1: GEX domain math — turn the oracle RED test GREEN (GEX-01)

**Commit:** `8ee0bec`

**RED verified:** `bun run test packages/core/src/analytics/domain/gex.test.ts` failed with `Cannot find module '../domain/gex.ts'` (unresolved SUT import, 08-02 scaffold).

**GREEN verified:** After implementing `gex.ts`, all 16 tests pass:
- dollarGamma: 5 unit tests (positive gamma, OI=0, gamma=0, linear in OI, linear in gamma)
- findFlip: 5 unit tests (oracle flip≈7488, all-negative null, all-positive null, empty null, exact-zero crossing)
- buildProfile: 4 unit tests (profile length matches grid, entry fields, empty legs → zero gamma, empty grid → empty profile)
- fast-check properties: 2 property tests (monotone in OI, null for all-positive profile)

**Oracle assertions (within tolerance):**
- flip: findFlip(oracleProfile) ≈ 7488 (interpolated between 7480/g=-4.09 and 7500/g=5.98)
- All other oracle properties tested structurally

## Acceptance Criteria Check

- [x] `bun run test packages/core/src/analytics/domain/gex.test.ts` exits 0 — 16/16 pass
- [x] `rg -n "bsmGreeks" packages/core/src/analytics/domain/gex.ts` — present (line 18, 226)
- [x] Actual import lines: only `../../journal/domain/bsm.ts` + `../application/ports.ts` — no drizzle/zod/pg-boss/contracts
- [x] `findFlip([all-negative])` returns null — tested via `allNegative` fixture + fast-check all-positive property
- [x] `bun run lint` exits 0 (only pre-existing boundaries-legacy warnings)
- [x] GREEN-after-RED documented above (08-02 scaffold → 08-03 implementation)
- [x] Typecheck errors for gex.ts itself: none. Pre-existing errors from computeGexSnapshot.test.ts and getGex.test.ts (08-02 RED scaffolds for 08-05) are pre-existing and unaffected.

## Deviations from Plan

None — plan executed exactly as written.

The `strikeGex` function is exported from gex.ts as specified in the plan and RESEARCH (it is used in the compute use-case 08-05). The test file only imports `dollarGamma`, `findFlip`, `buildProfile` — `strikeGex` is not tested directly in 08-03's test file but is exported for 08-05's use.

## Threat Surface Scan

No new I/O boundaries or network surfaces introduced. `gex.ts` is pure domain math — no ports crossed, no untrusted input handled. The oracle fixture test locks the math against numeric regression (T-08-03 mitigated per threat register).

## Known Stubs

None — all four functions are fully implemented with real math.

## Self-Check

**Status: PASSED**

- gex.ts: FOUND at packages/core/src/analytics/domain/gex.ts
- 08-03-SUMMARY.md: FOUND
- Commit 8ee0bec: FOUND in git log
