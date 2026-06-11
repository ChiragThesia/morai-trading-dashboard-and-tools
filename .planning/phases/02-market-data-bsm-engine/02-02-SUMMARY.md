---
phase: 02-market-data-bsm-engine
plan: "02"
subsystem: core/journal/domain
tags: [bsm, greeks, tdd, domain, numerical]
dependency_graph:
  requires: []
  provides:
    - packages/core/src/journal/domain/bsm.ts
  affects:
    - packages/core/src/journal/domain/iv-inversion.ts (Plan 03, imports bsmPrice + bsmVega)
    - packages/core/src/journal/application/computeBsmGreeks.ts (Plan 06, calls bsmGreeks)
tech_stack:
  added: []
  patterns:
    - A&S 7.1.26 five-term polynomial ncdf approximation
    - TOS display convention: theta/365.25 per calendar day, vega/100 per vol point
    - fast-check v4 property testing with Math.fround() bounds
key_files:
  created:
    - packages/core/src/journal/domain/bsm.ts
    - packages/core/src/journal/domain/bsm.test.ts
  modified: []
decisions:
  - "fc.float v4 bounds require Math.fround() — all float arbitraries use Math.fround on literal bounds"
  - "theta<=0 property scoped to +-20% strike band — BSM theta can be positive for deep ITM options when q or r dominates (correct BSM behavior, outside operational domain)"
metrics:
  duration: 7
  completed: "2026-06-11"
  tasks: 2
  files: 2
---

# Phase 02 Plan 02: BSM Price + Greeks Summary

Pure Black-Scholes-Merton pricing and Greeks engine with continuous dividend yield q, calibrated against three reference fixtures at <=1e-4, with fast-check property validation.

## What Was Built

`packages/core/src/journal/domain/bsm.ts` exports four symbols:

- `bsmPrice(S,K,T,sigma,r,q,type)` — European call/put price; returns intrinsic for T<=0
- `bsmGreeks(S,K,T,sigma,r,q,type): BsmGreeks` — delta, gamma, theta, vega in TOS display units (D-12)
- `bsmVega(S,K,T,sigma,r,q)` — analytic vega without /100 scaling, for IV-inversion denominator (Plan 03)
- `BsmGreeks` — readonly type `{delta, gamma, theta, vega}`

Private helpers: `ncdf` (A&S 7.1.26 5-term polynomial, ~1.5e-7 max error) and `npdf`.

Display conventions (D-12):
- theta: per calendar day via `/365.25` (D-04 basis), negative = time decay
- vega: per 1 vol point via `/100`
- delta/gamma: raw per-share (no ×100 — applied at read/display only)

## TDD Cycle

**RED** (`6825601`): `bsm.test.ts` written before `bsm.ts`. Confirmed failure: `Cannot find module './bsm.ts'`. Three calibration fixture suites + fast-check sanity properties + edge cases (T<=0 intrinsic) + bsmVega relationship test.

**GREEN** (`1bffd15`): `bsm.ts` implemented. All 34 tests pass. Typecheck clean for `packages/core`. Lint warnings only (pre-existing boundaries legacy syntax). No REFACTOR step needed — implementation was clean on first pass.

## Calibration Fixtures — All Pass at <=1e-4

| Fixture | Parameters | Price | Delta | Gamma | Theta/day | Vega/pt |
|---------|-----------|-------|-------|-------|-----------|---------|
| 1 Hull q=0 | S=42 K=40 T=0.5 r=0.1 sigma=0.2 | C:4.7594 P:0.8086 | 0.779131 | 0.049963 | -0.012482 | 0.088134 |
| 2 SPX ATM q=1.3% | S=100 K=100 T=1.0 r=0.05 sigma=0.2 | C:9.6439 P:6.0584 | 0.604271 | 0.018906 | -0.015153 | 0.378117 |
| 3 OTM put SPX | S=100 K=95 T=0.25 r=0.045 sigma=0.18 | C:7.0710 P:1.3327 | 0.756762 | 0.034490 | -0.021056 | 0.155204 |

## TDD Gate Compliance

- RED gate: commit `6825601` (`test(02-02): ...`)
- GREEN gate: commit `1bffd15` (`feat(02-02): ...`)
- REFACTOR gate: not needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fast-check v4 requires 32-bit float bounds**
- **Found during:** GREEN phase (fast-check property tests failed immediately)
- **Issue:** `fc.float({ min: 0.01, ... })` throws "constraints.min must be a 32-bit float" in fc v4
- **Fix:** Wrapped all `fc.float` bounds in `Math.fround()`. Same fix pattern documented in STATE.md Phase 1 decisions (`fc.date().filter(!isNaN)` for Date invalidation).
- **Files modified:** `packages/core/src/journal/domain/bsm.test.ts`
- **Commit:** `1bffd15`

**2. [Rule 1 - Bug] theta<=0 invariant too broad — BSM theta can be positive for deep ITM options**
- **Found during:** GREEN phase (fast-check found counterexamples)
- **Issue:** The plan specifies "theta for both call and put ≤ 0 in this domain (decay; tolerate ±0 at boundaries)". Fast-check found counterexamples: deep ITM puts (K>>S with r>q) and deep ITM calls (S>>K with q*S*N(d1) dominating). These are CORRECT BSM behavior — positive theta occurs when dividend carry or interest-on-strike exceeds time decay. Example: S=500, K=500 ATM put, T=0.84, sigma=5%, r=4.5%, q=1.3% → theta = +0.000124/day.
- **Fix:** Split theta property into: (a) call theta assertion scoped to the ±20% strike band (the operational domain from MKT-03), where it reliably holds; (b) put theta sign documented as fixture-verified only (put theta CAN be positive when r > q). Added explanatory comments.
- **Assessment:** This is a correction to the plan's over-specified invariant. The BSM implementation is correct; the three calibration fixtures all show negative theta for typical SPX options.
- **Files modified:** `packages/core/src/journal/domain/bsm.test.ts`
- **Commit:** `1bffd15`

## Known Stubs

None. Pure numerical functions; no data wiring needed.

## Threat Flags

None. Pure functions with no I/O, no network access, no trust boundaries. T-02-03 (correctness gate) fulfilled by calibration fixtures.

## Self-Check: PASSED

- packages/core/src/journal/domain/bsm.ts: FOUND
- packages/core/src/journal/domain/bsm.test.ts: FOUND
- RED commit 6825601: FOUND
- GREEN commit 1bffd15: FOUND
- SUMMARY.md: FOUND
