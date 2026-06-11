---
phase: 02-market-data-bsm-engine
plan: "04"
subsystem: cboe-chain-vertical-slice
tags: [cboe, options-chain, ports-adapters, persistence, fetchChain, tdd, wave-2]
dependency_graph:
  requires:
    - 02-01 (msw@2.14.6 installed, cboe-spx.fixture.json, SPXW endpoint finding)
  provides:
    - ForFetchingChain port + RawChain/RawQuote types
    - ForPersistingObservations + ForUpsertingContracts ports
    - ObservationRow + ContractRow domain types
    - makeCboeChainAdapter (packages/adapters/src/http/cboe.ts)
    - makeMemoryChainAdapter (packages/adapters/src/memory/chain.ts)
    - makePostgresLegObservationsRepo (packages/adapters/src/postgres/repos/leg-observations.ts)
    - makeFetchChainUseCase (packages/core/src/journal/application/fetchChain.ts)
    - runChainContractTests + runLegObservationsContractTests (shared harnesses)
  affects:
    - Plan 06 (computeBsmGreeks reads PendingObs from leg_observations; same repo)
    - Plan 05 (worker handlers wire makeFetchChainUseCase; see FetchChainDeps)
    - Plan 07 (getStatus reads lastJobRuns — shape decided here in ports context)
tech_stack:
  added:
    - zod@4.4.3 added to packages/adapters dependencies (Rule 3 auto-fix — cboe.ts Zod parse)
  patterns:
    - CBOE adapter: single _SPX.json endpoint, filter by OSI root prefix (SPXW=403 workaround)
    - ET→UTC timestamp: DST-aware conversion (2nd Sunday March / 1st Sunday November)
    - Append-only idempotency: composite PK (time, contract) onConflictDoNothing
    - First-seen contracts: occ_symbol PK onConflictDoNothing
    - Use-case injection: now() always injected, never Date.now() in core
key_files:
  created:
    - packages/core/src/journal/application/fetchChain.ts
    - packages/core/src/journal/application/fetchChain.test.ts
    - packages/adapters/src/http/cboe.ts
    - packages/adapters/src/http/cboe.test.ts
    - packages/adapters/src/http/cboe.contract.test.ts
    - packages/adapters/src/memory/chain.ts
    - packages/adapters/src/memory/chain.contract.test.ts
    - packages/adapters/src/__contract__/chain.contract.ts
    - packages/adapters/src/__contract__/leg-observations.contract.ts
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/postgres/repos/leg-observations.contract.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts (FetchError, RawChain, RawQuote, ForFetchingChain, ObservationRow, ContractRow, ForPersistingObservations, ForUpsertingContracts)
    - packages/core/src/journal/index.ts (re-exports new types + makeFetchChainUseCase)
    - packages/core/src/index.ts (re-exports new types)
    - packages/adapters/src/index.ts (exports new adapters)
    - packages/adapters/package.json (added zod dependency)
    - bun.lock (updated)
decisions:
  - "SPXW endpoint: fetch only _SPX.json, filter by OSI root prefix — SPXW root contracts inside _SPX.json"
  - "ET→UTC conversion: DST-aware via US DST calendar rules (2nd Sunday March / 1st Sunday Nov)"
  - "Append-only idempotency: onConflictDoNothing on composite PK (time, contract)"
  - "Both SPX + SPXW fetched concurrently with Promise.all; partial success persists surviving chain"
  - "Calendar-day DTE for filter gate; precise T (BSM minutes-per-year basis) computed at compute time (Plan 06)"
  - "zod added to packages/adapters deps (required for CboeResponseSchema.safeParse in adapter layer)"
metrics:
  duration_seconds: 810
  completed_at: "2026-06-11T15:38:44Z"
  tasks_completed: 2
  files_created: 11
  files_modified: 6
---

# Phase 02 Plan 04: CBOE Chain Vertical Slice Summary

**One-liner:** CBOE delayed-quote chain flows from CDN through Zod parse + OSI→OCC conversion, DTE/strike-band filter, and append-only persistence into `leg_observations` (source='cboe', bsm_iv NULL) with first-seen `contracts` upsert — all contract-tested against msw and testcontainers.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | ForFetchingChain port + CBOE adapter + in-memory twin (MKT-01) | 1398abd | ports.ts, cboe.ts, memory/chain.ts, chain.contract.ts |
| 2 | leg-observations persistence repo + filtered fetchChain use-case (MKT-03) | 6e26785 | leg-observations.ts, fetchChain.ts, leg-observations.contract.ts |

## ObservationRow + ContractRow Shapes (Plan 06 reads PendingObs from same repo)

### ObservationRow
Fields persisted to `leg_observations`:
- `time: Date` — UTC observedAt from CBOE payload (ET→UTC converted)
- `contract: OccSymbol` — 21-char OCC symbol (root padded to 6 chars)
- `bid, ask, mark: number` — bid/ask required; mark = (bid+ask)/2 if vendor mark absent
- `underlyingPrice: number` — spot from current_price ?? close ?? prev_day_close
- `iv, delta, gamma, theta, vega: number | null` — vendor-reported, nullable
- `openInterest, volume: number`
- `source: 'cboe'` — always literal 'cboe' for Plan 04 rows
- bsm_* columns NOT in this type (NULL in DB; filled by Plan 06 computeBsmGreeks)

### ContractRow
Fields persisted to `contracts`:
- `occSymbol: OccSymbol` — PK; onConflictDoNothing ensures first-seen only
- `underlying: 'SPX'` — both roots are on the SPX index
- `root: 'SPX' | 'SPXW'` — raw OSI root (D-11)
- `contractType: 'C' | 'P'`
- `exerciseStyle: 'european'` — hardcoded per D-04 (SPX/SPXW are always European)
- `strike: number` — stored ×1000 int (e.g. 7275 → 7275000)
- `expiration: string` — YYYY-MM-DD
- `multiplier: 100`

### PendingObs (Plan 06 input)
Plan 06 reads rows from the partial index `leg_obs_pending_bsm_idx` (bsm_iv IS NULL AND mark IS NOT NULL). The `makePostgresLegObservationsRepo` is the same repo Plan 06 will extend with `ForReadingPendingObs` + `ForWritingBsmResults` (per PATTERNS.md).

## SPXW Endpoint Approach

SPXW contracts are NOT fetched from a separate `_SPXW.json` endpoint (which returns HTTP 403 — S3 AccessDenied). Instead, the CBOE adapter fetches only `_SPX.json` and filters by OSI root prefix:
- `option.startsWith('SPXW')` → SPXW root (4-char prefix)
- `option.startsWith('SPX') && !option.startsWith('SPXW')` → SPX root (3-char prefix)

This is documented in `packages/adapters/test/fixtures/README.md` and was the critical finding from Plan 01.

## Filter Logic

The `fetchChain` use-case applies two gates before persistence (T-02-08 DoS mitigation):
1. **DTE gate**: `calendarDte(now, expiry) ≤ maxDte` (default 90, config-injected)
2. **Strike band**: `|strike - spot| ≤ strikeBandPct × spot` (default 10%, config-injected)

Calendar-day DTE is used for the filter gate (coarse entry gate). Precise T for BSM will be computed at compute time (Plan 06) using the minutes-per-year basis per D-04.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added zod to packages/adapters dependencies**
- **Found during:** Task 1 GREEN phase
- **Issue:** `cboe.ts` imports from `zod` but `packages/adapters/package.json` had no `zod` dependency. Import failed at test runtime.
- **Fix:** Added `"zod": "^4.4.3"` to `packages/adapters/dependencies` in package.json; ran `bun install`.
- **Files modified:** `packages/adapters/package.json`, `bun.lock`
- **Commit:** 1398abd

**2. [Rule 1 - Bug] Adapter created before msw server started**
- **Found during:** Task 1 GREEN — spot test returned live CBOE value not fixture value
- **Issue:** The adapter was created at module level before `server.listen()` was called, so early tests hit the real CBOE endpoint rather than the msw mock.
- **Fix:** Moved adapter creation inside individual test functions (after `beforeAll` server.listen).
- **Files modified:** `packages/adapters/src/http/cboe.test.ts`
- **Commit:** 1398abd

**3. [Rule 1 - Bug] Removed unused `root` param from mapCboeOption**
- **Found during:** Task 2 REFACTOR — `void root;` suppression line
- **Issue:** `root` parameter in `mapCboeOption` was not actually used inside the function; root-based filtering happens in the calling function before mapCboeOption is invoked.
- **Fix:** Removed the `root` parameter and the `void root;` suppression.
- **Files modified:** `packages/adapters/src/http/cboe.ts`
- **Commit:** 6e26785

**4. [Rule 1 - Bug] Raw SQL Date type error in testcontainers test**
- **Found during:** Task 2 GREEN — postgres.js rejects `Date` objects in `db.execute(sql\`...\`)`
- **Issue:** Passing a JS `Date` directly as a template literal parameter to `db.execute()` causes postgres.js to throw `TypeError: The "string" argument must be of type string`.
- **Fix:** Use `time.toISOString()` with explicit `::timestamptz` cast in the SQL template.
- **Files modified:** `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts`
- **Commit:** 6e26785

**5. [Rule 1 - Bug] Array type incompatibility with `ANY()` in raw SQL**
- **Found during:** Task 2 GREEN — Drizzle sql template wraps array as tuple `($1, $2)` not an array
- **Issue:** `root = ANY(${roots as string[]})` produced `ANY(($1, $2))` (a tuple), not a Postgres array. Postgres threw: `op ANY/ALL (array) requires array on right side`.
- **Fix:** Changed to `IN (...)` clause with individual parameters using `sql.join`.
- **Files modified:** `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts`
- **Commit:** 6e26785

## Threat Surface Scan

No new threat surface beyond the plan's threat model:
- T-02-07: CboeResponseSchema.safeParse at adapter entry — implemented
- T-02-08: DTE + strike band filter bounds write volume — implemented in fetchChain use-case
- T-02-09: Drizzle parameterized insert/onConflictDoNothing — implemented; no raw SQL in adapter
- T-02-10: FetchError carries {kind, message} only — no payload dumps in cboe.ts

No new network endpoints, auth paths, or schema changes beyond what the plan defined.

## Verification Results

```
bunx vitest run --project "packages/adapters" --project "@morai/core"
→ 11 test files, 72 tests all pass

bunx vitest run (all projects)
→ 18 test files, 125 tests all pass

bun run typecheck
→ tsc --build --force (clean, no errors)
```

## Self-Check: PASSED

Files created:

- packages/core/src/journal/application/fetchChain.ts: FOUND
- packages/core/src/journal/application/fetchChain.test.ts: FOUND
- packages/adapters/src/http/cboe.ts: FOUND
- packages/adapters/src/http/cboe.test.ts: FOUND
- packages/adapters/src/http/cboe.contract.test.ts: FOUND
- packages/adapters/src/memory/chain.ts: FOUND
- packages/adapters/src/memory/chain.contract.test.ts: FOUND
- packages/adapters/src/__contract__/chain.contract.ts: FOUND
- packages/adapters/src/__contract__/leg-observations.contract.ts: FOUND
- packages/adapters/src/postgres/repos/leg-observations.ts: FOUND
- packages/adapters/src/postgres/repos/leg-observations.contract.test.ts: FOUND

Commits:
- 1398abd (Task 1): FOUND
- 6e26785 (Task 2): FOUND
