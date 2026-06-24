---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: "05"
subsystem: analytics/gex
status: complete
tags: [gex, use-cases, adapters, testcontainers, tdd, idempotency]
completed_date: "2026-06-24"
duration_minutes: 11
tasks_completed: 2
files_changed: 10
dependency_graph:
  requires: ["08-02", "08-03", "08-04"]
  provides: ["makeComputeGexSnapshotUseCase", "makeGetGexUseCase", "gex-snapshot.repo.ts", "gex-snapshot.ts (memory twin)"]
  affects: ["@morai/core barrel", "packages/adapters/src/postgres/schema.ts (jsonb $type)"]
tech_stack:
  added: []
  patterns:
    - "Use-case factory makeXxx(deps) pattern (same as computeAnalytics)"
    - "snapCycleTime flooring for cycle_time derivation from DATA (CR-01/CR-02)"
    - "Drizzle jsonb $type<T>() for lint-clean typed JSONB columns (no as-casts)"
    - "testcontainers contract test: SC-4 idempotency proven against real Postgres 16"
    - "Shared contract suite (__contract__/gex-snapshot.contract.ts) run against both twins"
key_files:
  created:
    - packages/core/src/analytics/application/computeGexSnapshot.ts
    - packages/core/src/analytics/application/getGex.ts
    - packages/adapters/src/postgres/gex-snapshot.repo.ts
    - packages/adapters/src/postgres/gex-snapshot.repo.contract.test.ts
    - packages/adapters/src/memory/gex-snapshot.ts
    - packages/adapters/src/memory/gex-snapshot.contract.test.ts
    - packages/adapters/src/__contract__/gex-snapshot.contract.ts
  modified:
    - packages/core/src/analytics/index.ts (GEX re-exports)
    - packages/core/src/index.ts (GEX re-exports at core barrel level)
    - packages/adapters/src/postgres/schema.ts (jsonb columns parameterized with $type<T>)
decisions:
  - "cycle_time derived from DATA cohort time via snapCycleTime() (never now()) — SC-2/CR-01 idempotency anchor"
  - "computedAt NOT stored in gex_snapshots DB; returns cycleTime on reads (no schema change needed)"
  - "Drizzle jsonb $type<T>() annotation eliminates as-casts at read time (lint: consistent-type-assertions: never)"
  - "byExpiry computed inline in the use-case (same loop as strikeGex, avoids duplicated iteration)"
  - "netGammaAtSpot uses closest-strike lookup from strikeGex entries (scalar summary; profile gives full grid)"
---

# Phase 08 Plan 05: GEX Use-Cases + Adapters Summary

GEX vertical slice through application + driven-adapter layers: compute and read use-cases turn the 08-02 RED scaffolds GREEN; Postgres repo and in-memory twin prove idempotency and JOIN read via testcontainers.

## What Was Built

### Task 1: computeGexSnapshot + getGex use-cases (GREEN)

`makeComputeGexSnapshotUseCase` reads leg observations via `ForReadingLegObsForGex`, composes the 08-03 domain functions (`strikeGex` / `buildProfile` / `findFlip`), and persists exactly one `GexSnapshotRow` stamped with the resolved DATA cycle time — never `now()` (SC-2 / CR-01 idempotency design). Empty cohort = no row written, no crash.

`makeGetGexUseCase` is a thin forwarder over `ForReadingGexSnapshot` (D-01: GEX never recomputed on read).

Both are hexagon-clean: imports only `@morai/shared` + local ports/domain.

13 tests GREEN (the 08-02 RED scaffolds now GREEN).

### Task 2: Postgres repo + in-memory twin + testcontainers (SC-4)

`gex-snapshot.repo.ts` implements all three driven ports:
- `ForReadingLegObsForGex`: two-step JOIN (resolve latest cycle → read leg_obs INNER JOIN contracts on occ_symbol), returns `LegObsForGex[]` with `contractType`/`strike`/`expiration` from the contracts table (Pitfall 2).
- `ForPersistingGexSnapshot`: inserts one row with JSONB blobs for `profile`/`strikes`/`byExpiry` + numeric scalars as strings; `.onConflictDoNothing()` on the `cycle_time` PK (SC-4).
- `ForReadingGexSnapshot`: `ORDER BY cycle_time DESC LIMIT 1`; `ok(null)` when empty.

`gex-snapshot.ts` (in-memory twin) satisfies the identical contract with a `Map<string, GexSnapshotRow>` keyed by `cycleTime.toISOString()` — the idempotency key (§8 requirement).

The shared contract suite (`__contract__/gex-snapshot.contract.ts`) runs against both twins. The Postgres-specific test additionally proves SC-4 via a raw SQL `COUNT(*)` after two identical `persistGexSnapshot` calls — count = 1 against real Postgres 16. The JOIN test seeds a contract + leg_observation row and confirms `readLegObsForGex` returns `contractType`/`strike`/`expiration`.

18 tests GREEN (8 memory, 10 Postgres testcontainers).

## Verification Evidence

```
bun run test packages/core/src/analytics/application/computeGexSnapshot.test.ts getGex.test.ts
→ 13 passed (2 files)

bun run test packages/adapters/src/postgres/gex-snapshot.repo.contract.test.ts src/memory/gex-snapshot.contract.test.ts
→ 18 passed (2 files) — includes SC-4 idempotency via testcontainers postgres:16

bun run typecheck → exit 0
bun run lint → exit 0 (only pre-existing boundary warnings)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing barrel exports] GEX types not exported from @morai/core**
- **Found during:** Task 2 typecheck (adapters imports from @morai/core)
- **Issue:** `ForReadingLegObsForGex`, `GexSnapshotRow`, etc. were declared in `ports.ts` but not re-exported through `analytics/index.ts` or `core/src/index.ts`
- **Fix:** Added GEX port + use-case exports to `packages/core/src/analytics/index.ts` and `packages/core/src/index.ts`
- **Files modified:** Both barrel files
- **Commit:** 65b7453

**2. [Rule 1 - Lint violation] `as T` in parseJsonb helper forbidden by `consistent-type-assertions: never`**
- **Found during:** Task 2 lint
- **Issue:** `return value as T` in the `parseJsonb` helper + explicit `as ReadonlyArray<...>` casts in the contract test
- **Fix:** Added `$type<T>()` generic parameters to Drizzle's `jsonb()` column definitions in `schema.ts`; used typed variable declarations instead of inline casts in the contract test
- **Files modified:** `schema.ts`, `gex-snapshot.repo.contract.test.ts`
- **Commit:** 65b7453

## Known Stubs

None — `computedAt` is returned as `cycleTime` on reads (not stored in DB, not a stub — the contract test fixture has a different value but the repo consistently returns `cycleTime` as documented in a code comment).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond those already in the plan's threat model.

## Self-Check: PASSED

All created files confirmed to exist on disk. Both commits (49cbbed, 65b7453) confirmed in git log.
