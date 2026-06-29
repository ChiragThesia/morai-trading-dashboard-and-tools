---
phase: 13-cot-adapter
plan: "05"
subsystem: worker-jobs
tags: [cot, pg-boss, weekly-job, cftc, composition-root]
dependency_graph:
  requires: [13-04]
  provides: [fetch-cot-queue, fetch-cot-handler, fetch-cot-wiring]
  affects: [apps/worker]
tech_stack:
  added: []
  patterns: [pg-boss-handler-factory, composition-root-wiring, thin-adapter]
key_files:
  created:
    - apps/worker/src/handlers/fetch-cot.ts
    - apps/worker/src/handlers/fetch-cot.test.ts
  modified:
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts
decisions:
  - "No RTH gate in fetch-cot handler — weekly CFTC job runs regardless of NYSE hours"
  - "No NYSE holiday gate — CFTC publishes weekly regardless of NYSE calendar"
  - "schedule.test.ts updated to reflect 10-queue/6-cron reality (Rule 1 auto-fix)"
metrics:
  duration_minutes: 6
  completed_date: "2026-06-29"
  tasks_completed: 2
  files_changed: 5
status: complete
requirements: [COT-01]
---

# Phase 13 Plan 05: fetch-cot Worker Job Summary

Weekly CFTC COT report fetch-cot pg-boss job: thin handler around ForRunningFetchCot, Friday-17:00-ET cron, and composition-root wiring (CFTC adapter + postgres repo + clock).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | fetch-cot handler (thin pg-boss adapter) | 0c45126 | fetch-cot.ts, fetch-cot.test.ts |
| 2 | register queue + cron + handler; wire main.ts | bbf348a | schedule.ts, schedule.test.ts, main.ts |

## Verification Evidence

**Handler tests (Task 1):** 4/4 passed
- ok result → resolves without throw
- fetch-error result → throws with message (pg-boss retry)
- storage-error result → throws with message (pg-boss retry)
- undefined pg-boss array element → no-op (T-02-18 array-guard)

**Schedule tests (Task 2):** 12/12 passed (includes new fetch-cot cron assertion)

**Typecheck:** clean (tsc --build --force)

**Lint:** clean (no errors; pre-existing warnings only)

**Acceptance criteria:**
- `rg -n "fetch-cot" apps/worker/src/schedule.ts` shows createQueue + `"0 17 * * 5"` + work registration
- `rg -n "makeFetchCot|makeFetchCotHandler" apps/worker/src/main.ts` shows wiring
- No `isWithinRth` in fetch-cot.ts (confirmed by grep)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] schedule.test.ts broken by AllHandlers interface extension**
- **Found during:** Task 2 typecheck
- **Issue:** Adding `fetchCot` to `AllHandlers` made `makeFakeHandlers()` in `schedule.test.ts` incomplete; TS2741 error
- **Fix:** Added `fetchCot: handler` to `makeFakeHandlers()`, updated queue/cron counts (9→10, 5→6), added fetch-cot cron assertion test
- **Files modified:** `apps/worker/src/schedule.test.ts`
- **Commit:** bbf348a (included in Task 2 commit)

## Known Stubs

None. All dependencies wired to real adapters/repos in composition root.

## Threat Flags

None. No new network endpoints or trust-boundary changes introduced. The CFTC adapter was built in Plan 13-02; this plan only wires it into the job scheduler.

## Self-Check: PASSED

- `apps/worker/src/handlers/fetch-cot.ts` — FOUND
- `apps/worker/src/handlers/fetch-cot.test.ts` — FOUND
- Commit 0c45126 — FOUND (feat(13-05): fetch-cot pg-boss handler)
- Commit bbf348a — FOUND (feat(13-05): register fetch-cot queue + cron; wire deps in main.ts)
