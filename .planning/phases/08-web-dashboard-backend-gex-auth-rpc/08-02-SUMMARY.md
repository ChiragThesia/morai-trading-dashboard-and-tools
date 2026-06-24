---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: "02"
subsystem: gex-contract-schema-ports
tags: [gex, zod, drizzle, ports, tdd, wave-0, red-scaffold]
dependency_graph:
  requires: [08-01]
  provides: [gex-contract, gex-schema, gex-ports, wave-0-red-scaffolds]
  affects: [08-03, 08-04, 08-05, 08-06, 08-07]
tech_stack:
  added: []
  patterns:
    - GEX Zod contract (gexWallEntry/gexSnapshotEntry/gexSnapshotResponse) as MCP-02 ONE schema source
    - gexSnapshots pgTable with cycle_time PK + JSONB array columns (SC-2 anchor)
    - Five ForVerbingNoun ports (hexagon law §5) appended to analytics ports.ts
    - Wave-0 RED scaffolds committed intentionally failing (06-01 precedent)
key_files:
  created:
    - packages/contracts/src/gex.ts
    - packages/contracts/src/gex.test.ts
    - packages/core/src/analytics/domain/gex.test.ts
    - packages/core/src/analytics/application/computeGexSnapshot.test.ts
    - packages/core/src/analytics/application/getGex.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/adapters/src/postgres/schema.ts
    - packages/core/src/analytics/application/ports.ts
decisions:
  - "gexSnapshotResponse = gexSnapshotEntry (single object, not array) — D-03: both HTTP + MCP surfaces return one snapshot entry"
  - "gexSnapshots.cycleTime uses single-column .primaryKey() (not composite primaryKey() builder) — only one row per cycle"
  - "JSONB columns for profile/strikes/byExpiry avoid 65,534-param insert ceiling (T-08-02)"
  - "ports.ts imports only @morai/shared — no drizzle, no zod, no other-context domain (hexagon §2)"
  - "Wave-0 RED scaffolds committed intentionally failing on unresolved SUT imports — 08-03/08-05 turn them green"
  - "dollarGamma/findFlip/buildProfile function signatures locked by gex.test.ts oracle assertions (flip≈7488, net≈-47, callWall=7600, putWall=7400)"
metrics:
  duration: "5 minutes"
  completed: "2026-06-24"
  tasks_completed: 3
  files_modified: 8
status: complete
---

# Phase 08 Plan 02: GEX Foundation — Contract, Schema, Ports, RED Scaffolds Summary

GEX interface anchor for the whole phase: Zod contract (GEX-02), `gex_snapshots` Drizzle table with cycle_time PK + JSONB columns (SC-2), five application ports (D-04), and three Wave-0 RED test scaffolds that 08-03 + 08-05 turn green.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | GEX Zod contract + barrel export (TDD RED→GREEN) | 89168da | gex.ts, gex.test.ts, index.ts |
| 2 | gexSnapshots Drizzle table + GEX application ports | 6dd1763 | schema.ts, ports.ts |
| 3 | Wave-0 RED scaffolds for GEX domain + both use-cases | 1b2bef8 | gex.test.ts (domain), computeGexSnapshot.test.ts, getGex.test.ts |

## TDD Execution

### Task 1 — RED phase output

```
 FAIL  |@morai/contracts| src/gex.test.ts
Error: Cannot find module './gex.ts' imported from packages/contracts/src/gex.test.ts
 ❯ src/gex.test.ts:10:1
     10| import { gexSnapshotEntry, gexSnapshotResponse, gexWallEntry } from "./gex.ts";
Test Files  1 failed (1) — Tests  no tests
```

### Task 1 — GREEN phase output

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  10:25:53
   Duration  219ms
```

### Task 3 — RED scaffold confirmation (all three fail on unresolved SUT import)

```
 FAIL  src/analytics/domain/gex.test.ts
Error: Cannot find module '../domain/gex.ts' imported from ...gex.test.ts

 FAIL  src/analytics/application/computeGexSnapshot.test.ts
Error: Cannot find module './computeGexSnapshot.ts' imported from ...

 FAIL  src/analytics/application/getGex.test.ts
Error: Cannot find module './getGex.ts' imported from ...

Test Files  3 failed (3) — Tests  no tests
```

These are the LOCKED GREEN targets for 08-03 (domain) and 08-05 (use-cases). They commit intentionally failing per the 06-01 precedent.

## What Was Built

### packages/contracts/src/gex.ts

Three Zod schemas + inferred types:
- `gexWallEntry` — `{k: int, gex: number, coi: int, poi: int, vol: int}` (per-strike detail)
- `gexSnapshotEntry` — full snapshot with `spot`, `flip?`, `callWall?`, `putWall?`, `netGammaAtSpot`, `profile[]`, `strikes[]`, `byExpiry[]`, `computedAt`
- `gexSnapshotResponse = gexSnapshotEntry` — single object (NOT array, D-03)

Oracle parse test passes: `spot=7381.1201`, `flip=7488`, `callWall=7600`, `putWall=7400`, `netGammaAtSpot=-47`.

### packages/contracts/src/index.ts

Barrel block appended:
```typescript
// GEX contracts (MCP-02: ONE schema source for GET /api/analytics/gex + get_gex MCP tool)
export { gexWallEntry, gexSnapshotEntry, gexSnapshotResponse } from "./gex.ts";
export type { GexWallEntry, GexSnapshotEntry, GexSnapshotResponse } from "./gex.ts";
```

### packages/adapters/src/postgres/schema.ts

`gexSnapshots` table defined with:
- `cycle_time` timestamp PK (single-column `.primaryKey()`)
- `spot`, `flip`, `call_wall`, `put_wall`, `net_gamma_at_spot` scalar columns
- `profile`, `strikes`, `by_expiry` JSONB columns (avoids 65,534-param ceiling)
- `.enableRLS()` (consistent with all other tables)
- `jsonb` added to existing `drizzle-orm/pg-core` import line (single import)

### packages/core/src/analytics/application/ports.ts

Appended (append-only, no edits to existing ports):
- `LegObsForGex` row type — leg observation for GEX computation (time, contract, underlyingPrice, bsmGamma|null, bsmIv|null, openInterest, contractType, strike×1000, expiration)
- `GexSnapshotRow` row type — full snapshot as domain-typed readonly struct
- `ForReadingLegObsForGex` — reads latest leg_observations cohort
- `ForReadingGexSnapshot` — reads most recent persisted snapshot (nullable)
- `ForPersistingGexSnapshot` — upserts row keyed on cycleTime
- `ForRunningComputeGexSnapshot` — driver port for compute use-case
- `ForRunningGetGex` — driver port for get use-case

Imports only `@morai/shared` — hexagon law §2 verified (`rg -c "from \"drizzle|from \"zod" ports.ts` → 0).

### Wave-0 RED Scaffolds

Three test files locked as GREEN targets:

**gex.test.ts (domain):** Oracle assertions for `dollarGamma`/`findFlip`/`buildProfile` (flip≈7488 ±50pts, netGammaAtSpot≈-47, callWall=7600, putWall=7400). Fast-check properties: dollarGamma monotonic in OI; findFlip returns null for all-positive profiles.

**computeGexSnapshot.test.ts (use-case):** `makeComputeGexSnapshotUseCase` factory, persists exactly one `GexSnapshotRow`, cycleTime = DATA cycle (not `now()`), propagates read errors without persisting, returns `ok(undefined)`.

**getGex.test.ts (use-case):** `makeGetGexUseCase` factory, `ok(row)` when snapshot exists, `ok(null)` when none, propagates `StorageError`, thin forwarder with reference equality.

## Verification Results

| Check | Result |
|-------|--------|
| `bun run test packages/contracts/src/gex.test.ts` | 13 tests passed |
| `bun run typecheck` (over contracts + adapters) | PASSED |
| `bun run typecheck` (over core test files) | Only expected "Cannot find module" for unimplemented SUTs — no other errors |
| Three core RED scaffolds | FAIL on unresolved SUT imports (correct RED state) |
| `bun run lint` | PASSED (legacy selector warnings only, no boundary violations) |
| `rg -c 'from "drizzle|from "zod' ports.ts` | 0 (hexagon §2 verified) |
| Barrel re-exports gexSnapshotEntry/gexSnapshotResponse | VERIFIED |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The RED test scaffolds are intentional unresolved-import failures (the locked GREEN targets for downstream plans), not stubs. All production code in this plan is complete.

## Threat Flags

None. This plan defines types, schema, and tests only — no runtime data flow or auth surface introduced.

## Self-Check

- [x] packages/contracts/src/gex.ts exists and exports gexWallEntry/gexSnapshotEntry/gexSnapshotResponse
- [x] packages/contracts/src/gex.test.ts exists and passed (13/13)
- [x] packages/contracts/src/index.ts re-exports gexSnapshotEntry + gexSnapshotResponse
- [x] packages/adapters/src/postgres/schema.ts contains gexSnapshots table with cycle_time PK
- [x] packages/core/src/analytics/application/ports.ts contains all five ForVerbingNoun GEX ports
- [x] packages/core/src/analytics/domain/gex.test.ts exists and fails on unresolved SUT import
- [x] packages/core/src/analytics/application/computeGexSnapshot.test.ts exists and fails on unresolved SUT import
- [x] packages/core/src/analytics/application/getGex.test.ts exists and fails on unresolved SUT import
- [x] Commits 89168da, 6dd1763, 1b2bef8 exist in git log

## Self-Check: PASSED
