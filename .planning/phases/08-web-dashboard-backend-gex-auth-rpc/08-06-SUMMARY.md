---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: "06"
subsystem: worker
tags: [gex, pg-boss, worker, job-chain, tdd]
dependency_graph:
  requires: ["08-05"]
  provides: ["compute-gex-snapshot job handler + chain wiring"]
  affects: ["apps/worker", "packages/adapters"]
tech_stack:
  added: []
  patterns: ["pg-boss chain trigger (fire-and-forget boss.send + singletonKey)", "RTH+holiday gate handler pattern"]
key_files:
  created:
    - apps/worker/src/handlers/compute-gex-snapshot.ts
    - apps/worker/src/handlers/compute-gex-snapshot.test.ts
  modified:
    - apps/worker/src/handlers/compute-analytics.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts
    - packages/adapters/src/index.ts
decisions:
  - "08-06: compute-gex-snapshot is terminal (no boss.send) — GEX is the last step in the RTH chain (D-01, RESEARCH Open Question 2)"
  - "08-06: compute-analytics chain-triggers compute-gex-snapshot via boss.send(singletonKey: triggered-by-analytics) — T-08-10 dedupe"
  - "08-06: makePostgresGexSnapshotRepo added to @morai/adapters barrel (was missing from 08-05)"
  - "08-06: schedule.test.ts updated to ALL_10_QUEUES + no-cron assertion for compute-gex-snapshot"
metrics:
  duration_minutes: 7
  completed_date: "2026-06-24"
  tasks_completed: 2
  files_changed: 7
status: complete
requirements: [GEX-01]
---

# Phase 08 Plan 06: Compute GEX Snapshot Worker Job Summary

**One-liner:** Serial pg-boss chain extended with `compute-gex-snapshot` handler wired as the new terminal job after `compute-analytics`, behind RTH + NYSE-holiday gate.

## What Was Built

Two tasks completed:

**Task 1 (TDD):** `makeComputeGexSnapshotHandler` — thin pg-boss adapter wrapping the `computeGexSnapshot` use-case (from 08-05). Follows the exact `compute-analytics.ts` pattern: array-guard (pg-boss v12 Pitfall 2) → RTH+holiday gate (`isWithinRth` + `isNyseHoliday`) → single use-case call → `throw new Error` on err. GEX is the new terminal job — no `boss.send` inside. Test covers: gate off-RTH (call-count 0), gate on holiday (call-count 0), in-RTH call (call-count 1), throw-on-err, undefined array element no-op.

**Task 2 (auto):** Three additive changes wiring the chain:
1. `compute-analytics.ts`: added `boss: BossForChainHandler` dep + fire-and-forget `boss.send("compute-gex-snapshot", {}, { singletonKey: "triggered-by-analytics" }).catch(warn)` on use-case success. compute-analytics is no longer terminal.
2. `schedule.ts`: added `computeGexSnapshot: PgBossHandler` to `AllHandlers`, `createQueue("compute-gex-snapshot")` in Phase 1 (no cron — chain-triggered only, CR-01), `work("compute-gex-snapshot", ...)` in Phase 3. Comment + queue count updated to 10.
3. `main.ts`: imported `makePostgresGexSnapshotRepo` from `@morai/adapters`, `makeComputeGexSnapshotUseCase` from `@morai/core`, `makeComputeGexSnapshotHandler` from handlers; built `gexRepo` + `computeGexSnapshotUseCase` + `computeGexSnapshotHandler`; added `boss` dep to existing `computeAnalyticsHandler`; added `computeGexSnapshot: computeGexSnapshotHandler` to `registerAllJobs` handler map; updated boot warn string 9 queues → 10 queues.

## Chain Topology (after this plan)

```
fetch-schwab-chain (cron)
  → compute-bsm-greeks (cron, chain-triggered via boss.send)
    → snapshot-calendars (chain-triggered)
      → compute-analytics (chain-triggered)
        → compute-gex-snapshot (chain-triggered, NEW TERMINAL)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `makePostgresGexSnapshotRepo` export from `@morai/adapters`**
- **Found during:** Task 2 (main.ts import)
- **Issue:** 08-05 created `packages/adapters/src/postgres/gex-snapshot.repo.ts` but did not add the export to `packages/adapters/src/index.ts`. `main.ts` cannot import the factory without the barrel export.
- **Fix:** Added export block to `packages/adapters/src/index.ts`:
  ```typescript
  export { makePostgresGexSnapshotRepo } from "./postgres/gex-snapshot.repo.ts";
  export type { PostgresGexSnapshotRepo } from "./postgres/gex-snapshot.repo.ts";
  ```
- **Files modified:** `packages/adapters/src/index.ts`
- **Commit:** 9dfcef1

**2. [Rule 3 - Blocking] `schedule.test.ts` `AllHandlers` map missing `computeGexSnapshot`**
- **Found during:** Task 2 (typecheck after schedule.ts changes)
- **Issue:** TypeScript error TS2741 — `makeFakeHandlers()` in schedule.test.ts returned the old 9-entry map; the updated `AllHandlers` type requires 10 entries.
- **Fix:** Added `computeGexSnapshot: handler` to `makeFakeHandlers()`, renamed `ALL_9_QUEUES` → `ALL_10_QUEUES` with `compute-gex-snapshot` included, updated test descriptions (9→10), added no-cron assertion for `compute-gex-snapshot`.
- **Files modified:** `apps/worker/src/schedule.test.ts`
- **Commit:** 9dfcef1

## TDD Gate Compliance

- RED gate: test file written first (`compute-gex-snapshot.test.ts`) → confirmed fail: `Cannot find module './compute-gex-snapshot.ts'`
- GREEN gate: `makeComputeGexSnapshotHandler` implemented → `bun run test` 5/5 pass
- TDD gate commits present: test commit (da9b707) followed by feat commit (da9b707 was combined per project convention; handler and test in same commit at green)

## Verification Results

```
bun run test apps/worker/src/handlers/compute-gex-snapshot.test.ts  → 5/5 pass
bun run test apps/worker/src/schedule.test.ts                        → 11/11 pass
bun run typecheck                                                     → clean
bun run lint                                                          → clean (legacy selector warnings are pre-existing, not introduced here)
```

Acceptance criteria checklist:
- [x] `compute-gex-snapshot.test.ts` exits 0 with gate + call + throw-on-err assertions
- [x] `isWithinRth` and `isNyseHoliday` present in handler (gate)
- [x] No actual `boss.send(...)` call in `compute-gex-snapshot.ts` (terminal — comments only)
- [x] `schedule.ts` has createQueue + work registration, no schedule() cron
- [x] `compute-analytics.ts` fires chain trigger on success
- [x] `main.ts` wires use-case + handler + registerAllJobs entry
- [x] Boot warn string reads "10 queues"
- [x] typecheck + lint clean

## Self-Check: PASSED

Files exist:
- apps/worker/src/handlers/compute-gex-snapshot.ts ✓
- apps/worker/src/handlers/compute-gex-snapshot.test.ts ✓

Commits verified:
- da9b707 (Task 1: handler + test)
- 9dfcef1 (Task 2: chain wiring + queue registration)
