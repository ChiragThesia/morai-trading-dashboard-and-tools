---
phase: 02-market-data-bsm-engine
plan: "06"
subsystem: bsm-compute-engine
tags: [bsm, iv-inversion, greeks, compute, pending-scan, tdd, wave-4]
dependency_graph:
  requires:
    - 02-02 (bsmPrice/bsmGreeks/bsmVega — domain functions consumed here)
    - 02-03 (invertIv/IvError — IV inversion used in compute loop)
    - 02-04 (leg-observations repo extended; PendingObs from same repo)
    - 02-05 (ForReadingRate — r from stored rate; 4.5% fallback)
  provides:
    - computeT + isThirdFriday (packages/core/src/journal/domain/dte.ts)
    - PendingObs + ForReadingPendingObs + ForWritingBsmResults (ports.ts)
    - makeComputeBsmGreeksUseCase (packages/core/src/journal/application/computeBsmGreeks.ts)
    - readPendingObs + writeBsmResults on makePostgresLegObservationsRepo
    - journal/index.ts re-exports: bsmPrice/bsmGreeks/bsmVega/BsmGreeks/invertIv/IvError/computeT/isThirdFriday/makeComputeBsmGreeksUseCase
  affects:
    - Plan 07 (worker wires makeComputeBsmGreeksUseCase; all three use-cases ready)
tech_stack:
  added: []
  patterns:
    - Settlement-aware DTE: AM (SPX 3rd-Friday 09:30 ET) vs PM (SPXW/others 16:00 ET)
    - DST-aware ET offset: 2nd Sunday March / 1st Sunday November
    - Partial index scan: Drizzle isNull(bsmIv) + isNotNull(mark) for BSM-03
    - NaN stamp: string 'NaN' stored in Postgres numeric column (T-02-16, D-09)
    - Double-scaling guard: bsmGreeks() D-12 output written directly — no /100 or ×100
    - Idempotent re-run: NaN-stamped rows excluded from partial index; second scan empty
    - In-memory use-case test: magnitude guard catches double-scaling by 2 orders of magnitude
    - Batch write: all pending rows computed in one pass, single writeBsmResults call
key_files:
  created:
    - packages/core/src/journal/domain/dte.ts
    - packages/core/src/journal/domain/dte.test.ts
    - packages/core/src/journal/application/computeBsmGreeks.ts
    - packages/core/src/journal/application/computeBsmGreeks.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts (PendingObs, ForReadingPendingObs, ForWritingBsmResults)
    - packages/core/src/journal/index.ts (re-exports Plan 02/03/06 domain + use-case)
    - packages/core/src/index.ts (re-exports new types + domain functions)
    - packages/adapters/src/postgres/repos/leg-observations.ts (readPendingObs + writeBsmResults; lint fixes)
    - packages/adapters/src/postgres/repos/leg-observations.contract.test.ts (BSM-03 assertions; lint fix)
    - packages/adapters/src/__contract__/leg-observations.contract.ts (BSM-03 contract suite)
    - apps/server/src/config.ts (lint fix: strict-boolean-expressions)
    - apps/worker/src/config.ts (lint fix: strict-boolean-expressions)
    - packages/adapters/src/http/cboe.ts (lint fix: strict-boolean-expressions + any narrowing)
    - packages/adapters/src/http/fred.ts (lint fix: strict-boolean-expressions)
decisions:
  - "computeT uses local date components from expiry (getFullYear/Month/Date) to match how callers construct expiry via new Date(year, month, day)"
  - "readPendingObs: two-query approach (scan + inArray join) rather than LEFT JOIN — avoids complex Drizzle join typing for a small result set"
  - "ForWritingBsmResults iterates row-by-row (not batch UPDATE) — Postgres UPDATE WHERE (time, contract) requires individual calls in Drizzle ORM"
  - "string 'NaN' used for all five bsm_* columns on IvError (not just bsmIv) — all five must be non-null after compute to leave the partial index"
  - "NaN-stamp test filtered by observationTime — global readPendingObs returns all pending rows across tests; time-scoping avoids cross-test interference"
metrics:
  duration_seconds: 1200
  completed_at: "2026-06-11T11:15:37Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 10
---

# Phase 02 Plan 06: BSM Compute Engine Summary

**One-liner:** Settlement-aware computeT (AM/PM by root+date) + makeComputeBsmGreeksUseCase drain pending leg_observations via partial index, invert IV per row (4.5% fallback), compute D-12-scaled greeks, write all five bsm_* columns — NaN-stamping unsolvable rows for idempotent re-runs.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Settlement-aware DTE domain helper (D-04) | 21bdf5a | dte.ts, dte.test.ts |
| 2 | Pending-scan + BSM-write + computeBsmGreeks use-case (BSM-03, D-09) | a9ea363 | computeBsmGreeks.ts, ports.ts, leg-observations.ts, contract harness |

## PendingObs Shape (used by Plan 07)

```typescript
type PendingObs = {
  readonly time: Date;
  readonly contract: OccSymbol;
  readonly mark: number;          // converted from Postgres numeric string
  readonly underlyingPrice: number; // spot at observation time
  readonly strike: number;        // in points (e.g. 7275)
  readonly expiry: Date;
  readonly root: "SPX" | "SPXW";
  readonly type: "C" | "P";
};
```

## ForWritingBsmResults Shape (used by Plan 07 via use-case)

```typescript
type ForWritingBsmResults = (
  writes: ReadonlyArray<{
    time: Date;
    contract: OccSymbol;
    bsmIv: string;    // e.g. "0.2134" or "NaN"
    bsmDelta: string;
    bsmGamma: string;
    bsmTheta: string;
    bsmVega: string;
  }>,
) => Promise<Result<void, StorageError>>;
```

## Use-Case Factory Shape (ready for Plan 07 worker wiring)

```typescript
makeComputeBsmGreeksUseCase({
  readPending: repo.readPendingObs,
  writeBsm: repo.writeBsmResults,
  readRate: rateRepo.readRate,
  dividendYield: config.BSM_DIVIDEND_YIELD,  // default 0.013
  fallbackRate: config.BSM_RATE_FALLBACK,    // default 0.045
  now: () => new Date(),
})
```

## Three Use-Cases Ready for Plan 07 Worker Wiring

All three use-cases are now complete and can be wired in the Plan 07 worker:
1. `makeFetchChainUseCase` — Plan 04
2. `makeFetchRateUseCase` — Plan 05
3. `makeComputeBsmGreeksUseCase` — Plan 06 (this plan)

## Settlement-Aware DTE (D-04)

`computeT(now, expiry, root)` implements the 525960-minute-year basis with settlement distinction:
- **SPX on 3rd Friday** (first Friday on/after 15th) → AM-settled, cutoff 09:30 ET
- **All others** (SPXW any date, SPX non-3rd-Friday) → PM-settled, cutoff 16:00 ET
- DST handled: EDT UTC-4 (2nd Sunday March through 1st Sunday November), EST UTC-5 otherwise
- Returns `Math.max(0, minutesRemaining) / 525960` — always ≥ 0

## Magnitude Guard (D-12 double-scaling prevention)

Test fixture: spot=100, strike=100, call mark=9.6439, rate=0.05, q=0.013, T≈1.0yr

Expected values (direct from bsmGreeks, no extra scaling):
- `bsm_vega ≈ 0.378117` (per 1 vol point; already divided by 100 in bsmGreeks)
- `bsm_theta ≈ -0.015153` (per calendar day; already divided by 365.25 in bsmGreeks)

A stray ×100 or /100 would produce vega=37.8 or 0.00378, catching double-scaling failures by 2 orders of magnitude.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Lint] Fixed 5 deferred `as` casts from Plan 04**
- **Found during:** Task 2 lint pass
- **Issue:** `leg-observations.ts` lines 50, 71, 72 used `as "cboe"`, `as "C" | "P"`, `as "european"` type assertions. `leg-observations.contract.test.ts` lines 44, 57 used `as Record<string, unknown>` for raw SQL result narrowing.
- **Fix:** Removed `as` casts for Drizzle enum assignments (types already compatible). For raw SQL results: used `Object.fromEntries(Object.entries(row))` to produce a typed record without assertions.
- **Files modified:** `leg-observations.ts`, `leg-observations.contract.test.ts`
- **Commit:** a9ea363

**2. [Rule 2 - Lint] Fixed pre-existing `strict-boolean-expressions` errors**
- **Found during:** Task 2 lint pass (needed lint clean before SUMMARY)
- **Issue:** `cboe.ts`, `fred.ts`, `apps/server/src/config.ts`, `apps/worker/src/config.ts` used `if (!parsed.success)` where zod v4's `success` is typed such that `strict-boolean-expressions` requires explicit `=== true` comparison.
- **Fix:** Changed `if (!result.success)` to `if (result.success !== true)`. For `cboe.ts` filter: extracted `opt.option` to `const sym: string = String(opt.option)` to avoid `any` in filter callback.
- **Files modified:** 4 files listed above
- **Commit:** a9ea363

**3. [Rule 1 - Bug] NaN-stamp test cross-test interference fix**
- **Found during:** Task 2 testcontainers GREEN run
- **Issue:** The NaN-stamp contract test called `readPendingObs()` without time-scoping, so rows from other tests (same contract symbol, different time) appeared in the result — causing the assertion `expect(pendingContracts).not.toContain(obs0.contract)` to fail.
- **Fix:** Added `.filter((p) => p.time.getTime() === observationTime.getTime())` to scope the pending check to the current test's time slot.
- **Files modified:** `packages/adapters/src/__contract__/leg-observations.contract.ts`
- **Commit:** a9ea363

**4. [Rule 1 - Bug] computeBsmGreeks.test.ts used `as PendingObs["contract"]` assertion**
- **Found during:** Task 2 lint pass
- **Issue:** Test file used `as PendingObs["contract"]` to create a branded `OccSymbol`, violating `consistent-type-assertions: never`.
- **Fix:** Used `formatOccSymbol()` from `@morai/shared` to produce a properly branded symbol.
- **Files modified:** `packages/core/src/journal/application/computeBsmGreeks.test.ts`
- **Commit:** a9ea363

## Known Stubs

None. All bsm_* columns are written with real computed values from IV inversion + bsmGreeks. No placeholder data.

## Threat Surface Scan

All threats from the plan's threat model are implemented:
- **T-02-15** (DoS via infinite re-scan): NaN stamp removes failed rows from partial index; re-run no-op asserted in testcontainers — implemented.
- **T-02-16** (JS NaN serialized wrong): `NAN_STAMP = "NaN"` constant used throughout; grep gate confirmed; integration test verifies NaN round-trip — implemented.
- **T-02-17** (vendor column overwrite): `writeBsmResults` only sets `bsmIv/bsmDelta/bsmGamma/bsmTheta/bsmVega`; testcontainers asserts `mark` byte-identical before/after — implemented.

No new network endpoints, auth paths, or schema changes. The `bsm_*` columns and partial index existed already.

## Verification Results

```
bunx vitest run
→ 26 test files, 188 tests all pass
  (includes leg-observations.contract.test.ts: 8 tests with Docker testcontainers)
  (includes computeBsmGreeks.test.ts: 8 in-memory use-case tests)
  (includes dte.test.ts: 15 settlement-aware DTE tests)

bun run lint
→ clean (0 errors, 0 warnings)
```

## Self-Check: PASSED

Files created:

- packages/core/src/journal/domain/dte.ts: FOUND
- packages/core/src/journal/domain/dte.test.ts: FOUND
- packages/core/src/journal/application/computeBsmGreeks.ts: FOUND
- packages/core/src/journal/application/computeBsmGreeks.test.ts: FOUND

Commits:
- 21bdf5a (Task 1): FOUND
- a9ea363 (Task 2): FOUND
