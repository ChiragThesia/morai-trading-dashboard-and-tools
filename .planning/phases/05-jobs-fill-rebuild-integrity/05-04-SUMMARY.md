---
phase: 05-jobs-fill-rebuild-integrity
plan: 04
subsystem: jobs-backbone
tags: [pg-boss, job-queue, dedupe-key, schedule, tdd, jrnl-01, job-01]
dependency_graph:
  requires:
    - phase: 05-01
      provides: ForEnqueueingJob port stub (extended to 3-param in this plan)
    - phase: 05-02
      provides: calendar_events migration applied to live DB
    - phase: 05-03
      provides: fill-pairing domain functions (domain layer foundation)
  provides:
    - scheduledDedupeKey + rebuildDedupeKey pure functions (packages/core/src/journal/domain/dedupe-key.ts)
    - makePgBossJobQueue: ForEnqueueingJob pg-boss adapter with singletonKey dedupe (packages/adapters/src/pgboss/job-queue.ts)
    - makeMemoryJobQueue: in-memory twin with identical singletonKey semantics (packages/adapters/src/memory/job-queue.ts)
    - makeEnqueueJobUseCase: composes dedupe-key fns with ForEnqueueingJob port (packages/core/src/journal/application/enqueueJob.ts)
    - registerAllJobs(boss, AllHandlers): 7 queues, 5 crons, 7 work handlers (apps/worker/src/schedule.ts)
    - job-runs.ts TRACKED_JOBS extended to 7 names; /api/status lastJobRuns surfaces all 7 (SC1)
    - ForEnqueueingJob port updated to 3-param signature (name, payload, dedupeKey)
  affects:
    - 05-05 (refresh-tokens handler — registered in schedule.ts; slot ready)
    - 05-07 (sync-fills handler — registered in schedule.ts; slot ready)
    - 05-08 (trigger_job HTTP+MCP — uses makeEnqueueJobUseCase + makePgBossJobQueue)
tech_stack:
  added:
    - pg-boss added as dependency to packages/adapters (previously only in apps/worker)
  patterns:
    - ForEnqueueingJob port 3-param: (name, payload, dedupeKey) — use-case owns key selection
    - scheduledDedupeKey: floor(now/windowMs)*windowMs → "{jobName}:{windowStart.toISOString()}"
    - rebuildDedupeKey: calendar-scoped → "rebuild-journal:{calendarId}"
    - makeMemoryJobQueue: Map<dedupeKey, entry> for dedup; null key = always new entry
    - registerAllJobs: createQueue phase → schedule phase → work phase (CR-01 order)
key-files:
  created:
    - packages/core/src/journal/domain/dedupe-key.ts
    - packages/core/src/journal/domain/dedupe-key.test.ts
    - packages/core/src/journal/application/enqueueJob.ts
    - packages/core/src/journal/application/enqueueJob.test.ts
    - packages/adapters/src/pgboss/job-queue.ts
    - packages/adapters/src/memory/job-queue.ts
    - packages/adapters/src/memory/job-queue.test.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts (ForEnqueueingJob: added dedupeKey param)
    - packages/adapters/src/postgres/repos/job-runs.ts (TRACKED_JOBS: 3→7 names; SQL updated)
    - packages/adapters/src/index.ts (exports: makePgBossJobQueue, makeMemoryJobQueue)
    - packages/adapters/package.json (pg-boss added as dependency)
    - apps/worker/src/main.ts (imports registerAllJobs; inline blocks removed; makePgBossJobQueue wired)
key-decisions:
  - "ForEnqueueingJob port: dedupeKey is a 3rd parameter (not computed inside the adapter) — use-case owns strategy; port is a thin enqueue mechanism"
  - "makeEnqueueJobUseCase: rebuild-journal uses rebuildDedupeKey(calendarId); all scheduled jobs use scheduledDedupeKey(name, now, 10)"
  - "pg-boss dependency added to @morai/adapters package (not just worker) — adapter belongs where its implementation lives"
  - "TRACKED_JOBS 7-name list: fetch-schwab-chain (not fetch-cboe-chain), fetch-rates, compute-bsm-greeks, snapshot-calendars, sync-fills, refresh-tokens, rebuild-journal"
  - "registerAllJobs wires 3 new handler slots as stubs from plan 05-01; full bodies land in plans 05-05/05-07/05-08"
patterns-established:
  - "Window-floor dedup: Math.floor(now.getTime() / windowMs) * windowMs → deterministic boundary"
  - "null dedupeKey = no-op dedup (every enqueue distinct) — used when calendarId absent from rebuild-journal payload"
  - "Memory twin dedup: Map<dedupeKey, entry>; same key = return existing jobId (mirrors pg-boss singletonKey)"
  - "AllHandlers typed struct: every work() registration uses a named field (not positional) — compile-time safety"
requirements-completed: [JOB-01]
duration: 14min
completed: 2026-06-21
---

# Phase 5 Plan 04: Jobs Backbone Summary

**JobQueue port + pg-boss adapter + in-memory twin with singletonKey dedupe; registerAllJobs wiring all 7 queues (5 cron + 2 cronless); TRACKED_JOBS extended to 7 so /api/status lastJobRuns achieves SC1 complete visibility**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-21T22:01:33Z
- **Completed:** 2026-06-21T22:15:07Z
- **Tasks:** 3
- **Files modified:** 10 (9 created, 1 modified, 4 updated)

## Accomplishments

- scheduledDedupeKey floors now to the window boundary; rebuildDedupeKey is calendar-scoped; both pure + tested (8 GREEN tests)
- makePgBossJobQueue wraps boss.send with singletonKey (Pitfall 1 enforced: never singletonSeconds); makeMemoryJobQueue is an identical-semantics twin (5 GREEN tests)
- makeEnqueueJobUseCase composes dedupe strategy with ForEnqueueingJob port; tested with in-memory twin (6 GREEN tests)
- registerAllJobs creates 7 queues, schedules 5 crons, registers 7 work handlers; snapshot-calendars and rebuild-journal explicitly cronless; tested with fake boss (8 GREEN tests)
- main.ts rewired to call registerAllJobs; inline blocks removed; makePgBossJobQueue live in composition root
- TRACKED_JOBS extended to 7 names; fetch-cboe-chain removed; SC1 (/api/status lastJobRuns surfaces all 7) achieved

## TDD Gate Compliance

All 3 tasks followed RED → GREEN:

| Task | RED commit | GREEN commit |
|------|-----------|-------------|
| 1: dedupe-key + JobQueue | 8fd32e7 (test) | aa1040b (feat) |
| 2: enqueueJob use-case + TRACKED_JOBS | 5787eb2 (test) | ce4a761 (feat) |
| 3: schedule.ts + main.ts rewire | e1813b9 (test) | b73c5bf (feat) |

## Task Commits

1. **Task 1 RED: dedupe-key + memory twin tests** - `8fd32e7` (test)
2. **Task 1 GREEN: dedupe-key + pg-boss adapter + memory twin** - `aa1040b` (feat)
3. **Task 2 RED: enqueueJob test** - `5787eb2` (test)
4. **Task 2 GREEN: enqueueJob use-case + TRACKED_JOBS extension** - `ce4a761` (feat)
5. **Task 3 RED: schedule.ts test** - `e1813b9` (test)
6. **Task 3 GREEN: schedule.ts + main.ts rewire** - `b73c5bf` (feat)

## Files Created/Modified

- `packages/core/src/journal/domain/dedupe-key.ts` - scheduledDedupeKey + rebuildDedupeKey pure functions
- `packages/core/src/journal/domain/dedupe-key.test.ts` - 8 tests covering window-floor, same-window idempotency, adjacent windows
- `packages/core/src/journal/application/enqueueJob.ts` - makeEnqueueJobUseCase: dedupe strategy selection + port delegation
- `packages/core/src/journal/application/enqueueJob.test.ts` - 6 tests: scheduled + rebuild-journal + storage error propagation
- `packages/adapters/src/pgboss/job-queue.ts` - makePgBossJobQueue: boss.send with singletonKey
- `packages/adapters/src/memory/job-queue.ts` - makeMemoryJobQueue: Map-backed twin with getAll() test helper
- `packages/adapters/src/memory/job-queue.test.ts` - 5 tests: dedup, no-op, null key, getAll count
- `apps/worker/src/schedule.ts` - registerAllJobs: 7 queues, 5 crons, 7 handlers; AllHandlers type
- `apps/worker/src/schedule.test.ts` - 8 tests: createQueue count, schedule count, cronless queues, cron strings, ordering
- `packages/core/src/journal/application/ports.ts` - ForEnqueueingJob extended to 3 params (dedupeKey added)
- `packages/adapters/src/postgres/repos/job-runs.ts` - TRACKED_JOBS: 3 names → 7 names; SQL updated
- `packages/adapters/src/index.ts` - exports for makePgBossJobQueue + makeMemoryJobQueue
- `packages/adapters/package.json` - pg-boss ^12.18.3 added as dependency
- `apps/worker/src/main.ts` - registerAllJobs wiring; makePgBossJobQueue live; inline blocks removed

## Decisions Made

- **ForEnqueueingJob 3-param**: dedupeKey moved to the port signature so the use-case (not the adapter) owns the strategy. The adapter is a thin `boss.send` wrapper. This is cleaner than having the adapter compute the key — the use-case has the business context.
- **pg-boss in adapters**: Added pg-boss dependency to @morai/adapters. The pg-boss adapter implementation belongs in adapters (hexagonal law), so the package must declare the dependency.
- **null dedupeKey**: When rebuild-journal is triggered without a calendarId, no dedup key is set (each trigger is distinct). This is intentional — the caller is responsible for supplying the calendarId.
- **Stub handlers in main.ts**: Plans 05-05/05-07/05-08 implement syncFills/refreshTokens/rebuildJournal bodies. This plan registers the slots with throwing stubs so schedule.ts compiles with all 7 typed handlers now.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] ForEnqueueingJob port updated to include dedupeKey parameter**
- **Found during:** Task 1 (implementing makeMemoryJobQueue)
- **Issue:** The port declaration from plan 05-01 had only 2 params (name, payload). The plan Task 1 behavior explicitly requires a 3rd dedupeKey param for the twin's no-op semantics
- **Fix:** Updated ForEnqueueingJob in ports.ts to `(name, payload, dedupeKey: string | null)`. Updated comment to clarify that the use-case computes the key, not the adapter
- **Files modified:** packages/core/src/journal/application/ports.ts
- **Committed in:** aa1040b (Task 1 feat commit)

**2. [Rule 3 - Blocking] pg-boss added to @morai/adapters package.json**
- **Found during:** Task 1 (pg-boss adapter typecheck)
- **Issue:** packages/adapters had no pg-boss dependency; `import type { PgBoss } from "pg-boss"` failed to resolve
- **Fix:** Added `"pg-boss": "^12.18.3"` to adapters dependencies; ran bun install
- **Files modified:** packages/adapters/package.json, bun.lock
- **Committed in:** aa1040b (Task 1 feat commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing critical, 1 Rule 3 blocking)
**Impact on plan:** Both fixes required for correctness. No scope creep.

## Issues Encountered

- `*/10` in a `/** ... */` JSDoc comment caused an early-close parse error in the Vitest transform (oxc parser). Fixed by switching the file header to `//` line comments.

## Known Stubs

None — no data stubs, placeholder text, or unwired UI components in this plan's output. The 3 new handler slots (syncFills, refreshTokens, rebuildJournal) are intentional stubs per the plan's scope boundary; they are documented inline and will be wired in plans 05-05/05-07/05-08.

## Threat Flags

None — this plan introduces no new network endpoints or auth paths. The ForEnqueueingJob port is internally generated (dedupe keys are deterministic business keys, not user-supplied — T-05-08 mitigated). snapshot-calendars and rebuild-journal are explicitly excluded from cron scheduling (T-05-09 mitigated).

## Next Phase Readiness

- JOB-01 backbone complete: ForEnqueueingJob port + pg-boss adapter + in-memory twin
- schedule.ts provides the composition point for all 7 job types
- SC1 (/api/status lastJobRuns surfaces all 7 jobs) is now live
- Plans 05-05 (refresh-tokens), 05-07 (sync-fills), 05-08 (trigger_job + rebuild-journal) can proceed independently — their handler slots are registered in schedule.ts

---
*Phase: 05-jobs-fill-rebuild-integrity*
*Completed: 2026-06-21*
