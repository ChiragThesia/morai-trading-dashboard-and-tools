---
phase: 02-market-data-bsm-engine
plan: "05"
subsystem: fred-rate-vertical-slice
tags: [fred, rate, risk-free-rate, ports-adapters, persistence, fetchRate, tdd, wave-3]
dependency_graph:
  requires:
    - 02-04 (FetchError + ports.ts shape; msw@2.14.6 installed; testcontainers harness pattern)
  provides:
    - ForFetchingRate port + RateObservation type
    - ForPersistingRate + ForReadingRate ports
    - makeFredRateAdapter (packages/adapters/src/http/fred.ts)
    - makeMemoryRateAdapter (packages/adapters/src/memory/rate.ts)
    - makePostgresRateObservationsRepo (packages/adapters/src/postgres/repos/rate-observations.ts)
    - makeFetchRateUseCase (packages/core/src/journal/application/fetchRate.ts)
    - runRateContractTests + runRateObservationsContractTests (shared harnesses)
  affects:
    - Plan 06 (computeBsmGreeks reads r from ForReadingRate → latest rate ≤ observation date)
    - Plan 07 (worker handler wires makeFetchRateUseCase in composition root)
tech_stack:
  added: []
  patterns:
    - FRED adapter: DGS3MO endpoint, Zod parse, '.' row filter, 4.5% fallback on keyless/unreachable
    - API key security: key passed as URL query param; never appears in log messages (T-02-11)
    - Rate persistence: onConflictDoUpdate by date PK (last-write wins idempotency)
    - ForReadingRate: lte + desc + limit(1) Drizzle query for latest rate ≤ given date
    - Use-case injection: fetchRate always returns ok (fallback built in); use-case orchestrates fetch→persist
key_files:
  created:
    - packages/core/src/journal/application/fetchRate.ts
    - packages/core/src/journal/application/fetchRate.test.ts
    - packages/adapters/src/http/fred.ts
    - packages/adapters/src/http/fred.test.ts
    - packages/adapters/src/http/fred.contract.test.ts
    - packages/adapters/src/memory/rate.ts
    - packages/adapters/src/memory/rate.contract.test.ts
    - packages/adapters/src/__contract__/rate.contract.ts
    - packages/adapters/src/__contract__/rate-observations.contract.ts
    - packages/adapters/src/postgres/repos/rate-observations.ts
    - packages/adapters/src/postgres/repos/rate-observations.contract.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts (RateObservation, ForFetchingRate, ForPersistingRate, ForReadingRate)
    - packages/core/src/journal/index.ts (re-exports new port types + makeFetchRateUseCase)
    - packages/core/src/index.ts (re-exports new port types + makeFetchRateUseCase)
    - packages/adapters/src/index.ts (makeFredRateAdapter, makeMemoryRateAdapter, makePostgresRateObservationsRepo)
decisions:
  - "FRED DGS3MO expressed as percentage (5.25) — adapter divides by 100 to store as decimal (0.0525)"
  - "ForReadingRate returns Drizzle numeric string (not number) — Plan 06 passes directly to BSM as parseFloat"
  - "onConflictDoUpdate (not DoNothing) for rate_observations — last-write-wins is correct for daily rate updates"
  - "Memory rate adapter returns ok({rate:0.045}) when unseeded — mirrors FRED fallback, avoids null errors in test"
  - "vi.fn<typeof fetch>() instead of as-cast — typescript.md forbids as assertions in test code"
metrics:
  duration_seconds: 562
  completed_at: "2026-06-11T15:52:25Z"
  tasks_completed: 2
  files_created: 11
  files_modified: 4
---

# Phase 02 Plan 05: FRED Rate Vertical Slice Summary

**One-liner:** DGS3MO 3-month risk-free rate flows from FRED (Zod-parsed, '.' rows filtered, 4.5% fallback on keyless/unreachable) through ForFetchingRate into rate_observations (date PK upsert) and back out via ForReadingRate (latest date ≤ query date) — fully contract-tested with msw and testcontainers.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | ForFetchingRate port + FRED adapter + in-memory twin + rate contract (MKT-02) | 688d180 | ports.ts, fred.ts, memory/rate.ts, rate.contract.ts |
| 2 | rate-observations repo + fetchRate use-case (persist + fallback wiring) | 64b0fa6 | rate-observations.ts, fetchRate.ts, rate-observations.contract.ts |

## RateObservation Shape (Plan 06 reads r from here)

```typescript
type RateObservation = {
  readonly date: string; // YYYY-MM-DD
  readonly rate: number; // decimal — 5.25% → 0.0525
};
```

FRED DGS3MO reports percentages (e.g. "5.25"). The adapter divides by 100 before returning.

## ForReadingRate Semantics (Plan 06 needs this)

```typescript
type ForReadingRate = (onOrBefore: string) => Promise<Result<string | null, StorageError>>;
```

- Returns the numeric rate as a **Drizzle-numeric string** (e.g. "0.0525") — not a JS number.
- `null` when no row exists with `date ≤ onOrBefore` (no rate ever stored for that period).
- Plan 06 (`computeBsmGreeks`) calls this with the observation's date to get `r` for BSM.
- Query: `SELECT rate FROM rate_observations WHERE date ≤ $1 ORDER BY date DESC LIMIT 1`.

## FRED Adapter Behavior

1. **No API key** (`apiKey === undefined || apiKey === ""`): return `ok({ date: today, rate: 0.045 })` immediately, no fetch call.
2. **Fetch success, valid rows**: Zod-parse, filter `value === "."`, pick first (most-recent since `sort_order=desc`), divide by 100.
3. **All '.' rows**: return fallback.
4. **HTTP non-2xx or network error**: `console.warn` with static text (no key value), return fallback.
5. **Malformed payload**: `console.warn`, return fallback.

API key is passed as a URL query parameter and never appears in any logged string (T-02-11).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Fixed `as unknown as typeof fetch` cast in fred.test.ts**
- **Found during:** Task 2 lint pass
- **Issue:** The no-key test used `fetchSpy as unknown as typeof fetch` which violates `@typescript-eslint/consistent-type-assertions`.
- **Fix:** Used `vi.fn<typeof fetch>()` — properly typed generic mock, no cast needed.
- **Files modified:** `packages/adapters/src/http/fred.test.ts`
- **Commit:** 64b0fa6

## Deferred Issues

**Pre-existing lint errors in Plan 04 files (out of scope for Plan 05):**
- `packages/adapters/src/postgres/repos/leg-observations.ts` lines 50, 71, 72: `as` casts in Drizzle enum mapping
- `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` lines 44, 57: `as` cast in raw SQL result narrowing

These existed before Plan 05 and are not caused by this plan's changes. Tracked in `deferred-items.md`.

## Threat Surface Scan

All threats covered per plan's threat model:
- **T-02-11** (API key in logs): FRED key passed as URL param; fallback warn uses static text only — verified by dedicated test case.
- **T-02-12** (FRED unreachable blocks compute): fallback returns ok on 500 + network error — tested with msw.
- **T-02-13** (malformed FRED payload): Zod-parsed; '.' rows filtered; parse failure → fallback, never throw.
- **T-02-14** (SQL injection via rate date): Drizzle parameterized upsert on date PK.

No new threat surface beyond plan's threat model.

## Verification Results

```
bunx vitest run --project "packages/adapters" --project "@morai/core"
→ 17 test files, 108 tests all pass

bun run typecheck
→ tsc --build --force (clean, no errors)
```

## Self-Check: PASSED

Files created:

- packages/core/src/journal/application/fetchRate.ts: FOUND
- packages/core/src/journal/application/fetchRate.test.ts: FOUND
- packages/adapters/src/http/fred.ts: FOUND
- packages/adapters/src/http/fred.test.ts: FOUND
- packages/adapters/src/http/fred.contract.test.ts: FOUND
- packages/adapters/src/memory/rate.ts: FOUND
- packages/adapters/src/memory/rate.contract.test.ts: FOUND
- packages/adapters/src/__contract__/rate.contract.ts: FOUND
- packages/adapters/src/__contract__/rate-observations.contract.ts: FOUND
- packages/adapters/src/postgres/repos/rate-observations.ts: FOUND
- packages/adapters/src/postgres/repos/rate-observations.contract.test.ts: FOUND

Commits:
- 688d180 (Task 1): FOUND
- 64b0fa6 (Task 2): FOUND
