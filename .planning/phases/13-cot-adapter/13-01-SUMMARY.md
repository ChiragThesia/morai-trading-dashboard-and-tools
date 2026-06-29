---
phase: 13-cot-adapter
plan: "01"
subsystem: contracts, core, adapters/postgres
tags: [cot, schema, ports, migration, tdd]
status: complete

dependency_graph:
  requires: []
  provides:
    - cotSeriesEntry / cotResponse — packages/contracts/src/cot.ts
    - CotReport / CotObservationRow domain types — packages/core/src/journal/application/ports.ts
    - ForFetchingCotReport / ForPersistingCotObservation / ForReadingCotObservations ports
    - cotObservations pgTable — packages/adapters/src/postgres/schema.ts
    - 0012_cot_observations.sql migration — applied to live dev schema
  affects:
    - packages/contracts/src/index.ts (barrel re-export)
    - packages/core/src/journal/index.ts (port re-exports)
    - packages/core/src/index.ts (core barrel)
    - packages/adapters/src/postgres/migrations/meta/_journal.json

tech_stack:
  added: []
  patterns:
    - TFF class net naming (supersedes legacy net_noncommercial/net_commercial — D-05)
    - UNIQUE(contract_code, as_of) idempotency key pattern (COT-01, D-09)
    - Three-port driven trio (ForFetchingX / ForPersistingX / ForReadingX) mirroring MKT-02 Rate pattern

key_files:
  created:
    - packages/contracts/src/cot.ts
    - packages/contracts/src/cot.test.ts
    - packages/adapters/src/postgres/migrations/0012_cot_observations.sql
  modified:
    - packages/contracts/src/index.ts
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - packages/adapters/src/postgres/migrations/meta/0012_snapshot.json

decisions:
  - cotSeriesEntry includes both raw long/short legs AND derived net fields in the contract (D-04/D-05); this gives the Overview chart everything it needs without client-side net derivation
  - unique() from drizzle-orm/pg-core required for composite unique constraint — plain object literal syntax does not emit UNIQUE SQL
  - Migration 0012 hand-renamed from random drizzle-kit tag (0012_bent_aaron_stack → 0012_cot_observations) per project convention (Phase 4 P01 precedent)
  - bun run migrate requires SIDECAR_URL (added Phase 11) — supplemented inline as http://localhost:8000 for migration-only run; no SIDECAR_URL added to .env

metrics:
  duration_minutes: 8
  completed: "2026-06-29"
  tasks_completed: 3
  files_created: 3
  files_modified: 7
---

# Phase 13 Plan 01: COT Contract + Ports + Schema Summary

COT foundation: TFF Zod contract, hexagonal ports (fetch/persist/read trio), and cot_observations table (migration 0012) live in dev schema.

## Tasks Completed

| # | Task | Commit | Type | Result |
|---|------|--------|------|--------|
| 1 | cot Zod contract (cotSeriesEntry + cotResponse) | 3ee99b2 | TDD red→green | 12/12 tests pass |
| 2 | Core COT ports + domain types | a0c42b3 | execute | typecheck clean |
| 3 | cot_observations table + migration 0012 + schema push | 0f5bf93 | execute | live applied |

## Acceptance Criteria Verification

- [x] `bun run test -- packages/contracts/src/cot.test.ts` — 12 passed (round-trip, rejection cases, netLeveraged invariant)
- [x] `bun run typecheck` — clean across contracts + core + adapters
- [x] `rg -n 'from "./cot.ts"' packages/contracts/src/index.ts` — matches (barrel wired)
- [x] `rg -n "ForFetchingCotReport|ForPersistingCotObservation|ForReadingCotObservations" packages/core/src/index.ts` — 3 matches
- [x] `bun run migrate` — applied 0012 live (exit 0)
- [x] `rg -n "cot_observations" packages/adapters/src/postgres/migrations/0012_cot_observations.sql` — 3 matches (CREATE TABLE + UNIQUE + ENABLE RLS)
- [x] UNIQUE constraint on (contract_code, as_of) — in emitted SQL
- [x] `rg -n "0012_cot_observations" packages/adapters/src/postgres/migrations/meta/_journal.json` — matches
- [x] `bun run lint` — clean (pre-existing boundary warnings only)

## Contracts Produced

### cotSeriesEntry (packages/contracts/src/cot.ts)
TFF class schema: `asOf` (date string), `publishedAt` (datetime string), `contractCode`, `openInterest`, and for each of the five TFF trader classes (Dealer, Asset Manager, Leveraged Funds, Other Reportable, Non-Reportable): raw `*Long`/`*Short` integers PLUS derived `net*` integer. `netLeveraged` is the headline D-05 signal.

`cotResponse = z.array(cotSeriesEntry)` — time series (empty array is valid no-data case).

### Core ports (packages/core/src/journal/application/ports.ts)
- `CotReport` — 10 raw class legs + contractCode + asOf + openInterest (no net — derived at API)
- `CotObservationRow` — `CotReport & { publishedAt: Date }` (persisted row)
- `ForFetchingCotReport = (contractCode: string) => Promise<Result<CotReport, FetchError>>`
- `ForPersistingCotObservation = (row: CotObservationRow) => Promise<Result<void, StorageError>>`
- `ForReadingCotObservations = (limit?: number) => Promise<Result<ReadonlyArray<CotObservationRow>, StorageError>>`

### cot_observations table (migration 0012)
16 columns: uuid PK, contractCode, asOf (date), publishedAt (timestamptz), openInterest, 10 integer legs, createdAt. UNIQUE(contract_code, as_of) enforces COT-01 idempotency. RLS enabled.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drizzle unique constraint API**
- **Found during:** Task 3 (drizzle-kit generate round 1)
- **Issue:** Used plain object literal `{ unique: true, columns: [...] }` in pgTable — not the Drizzle API. Generated SQL had no UNIQUE constraint.
- **Fix:** Added `unique` import from `drizzle-orm/pg-core`; used `unique("name").on(col1, col2)` — re-generated and confirmed UNIQUE appears in emitted SQL.
- **Files modified:** packages/adapters/src/postgres/schema.ts
- **Commit:** 0f5bf93

**2. [Rule 3 - Blocking] SIDECAR_URL missing from local .env**
- **Found during:** Task 3 `bun run migrate`
- **Issue:** `bootWorkerConfig()` validates all worker env vars including `SIDECAR_URL` (added Phase 11); not set locally.
- **Fix:** Supplemented `SIDECAR_URL=http://localhost:8000` inline for the migrate-only run (only DATABASE_URL needed by `runMigrations`; SIDECAR_URL is a config-validation gate, not a migration dependency).
- **Impact:** None — migration succeeded. Not added to `.env` permanently (user controls local env setup).

## Live Schema Push

**Status: Applied live to dev database.**
- Command: `SIDECAR_URL=http://localhost:8000 bun run migrate`
- Result: `"migrate: all migrations applied"` (exit 0)
- Idempotent: `runMigrations` applies onConflict logic; re-run applies 0 new migrations

## Known Stubs

None. This plan is pure interface/contract/schema — no data wiring.

## Threat Flags

No new security surface introduced. The `cot_observations` table has RLS enabled (matching all other tables). No new network endpoints or auth paths. UNIQUE constraint is the only trust-boundary mitigation (T-13-01).

## Self-Check: PASSED

- [x] packages/contracts/src/cot.ts — exists
- [x] packages/contracts/src/cot.test.ts — exists
- [x] packages/adapters/src/postgres/migrations/0012_cot_observations.sql — exists
- [x] commit 3ee99b2 exists (cot contract)
- [x] commit a0c42b3 exists (COT ports)
- [x] commit 0f5bf93 exists (schema + migration)
