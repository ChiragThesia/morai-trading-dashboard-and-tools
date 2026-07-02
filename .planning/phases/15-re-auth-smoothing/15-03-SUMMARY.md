---
phase: 15-re-auth-smoothing
plan: 03
subsystem: jobs
tags: [trigger-job, mcp, contracts, cleanup, d-04]

# Dependency graph
requires:
  - phase: 11-sidecar-scaffold-auth-migration
    provides: refresh-tokens TS job retirement (GW-03) — sidecar became sole Schwab token writer
provides:
  - TRIGGERABLE_JOBS shrunk to the 3 live jobs (rebuild-journal, sync-fills, compute-bsm-greeks)
  - trigger_job MCP tool description matches the corrected contract
affects: [16-milestone-audit-followups, any future job-trigger surface work]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - packages/contracts/src/jobs.ts
    - packages/contracts/src/jobs.test.ts
    - apps/server/src/adapters/mcp/tools/trigger-job.ts
    - apps/server/src/adapters/http/jobs.routes.test.ts

key-decisions:
  - "Removed the retired refresh-tokens entry from TRIGGERABLE_JOBS rather than gating it behind a feature flag — the job was already fully retired in Phase 11 (GW-03); leaving it in the allow-list only offered a dead, storage-error-returning affordance."
  - "job-runs.ts / TRACKED_JOBS and the worker schedule were intentionally left untouched — they legitimately read HISTORICAL refresh-tokens run records, which is out of D-04 scope."
  - "packages/core/src/journal/application/enqueueJob.test.ts still uses the string \"refresh-tokens\" as an arbitrary job-name fixture — core does not import @morai/contracts (architecture-boundaries), so ForEnqueueingJob takes a plain string, not TriggerableJob. This is not linked to the allow-list and was left unmodified."

patterns-established: []

requirements-completed: [AUTH-06]

coverage:
  - id: D1
    description: "TRIGGERABLE_JOBS resolves to exactly [rebuild-journal, sync-fills, compute-bsm-greeks] (length 3); the retired refresh-tokens job is no longer triggerable at either the HTTP or MCP surface"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/jobs.routes.test.ts#TRIGGERABLE_JOBS is the canonical list from @morai/contracts (MCP-02 single schema source)"
        status: pass
      - kind: unit
        ref: "packages/contracts/src/jobs.test.ts#triggerJobBodyFor — WR-04 rebuild-journal requires calendarId"
        status: pass
    human_judgment: false
  - id: D2
    description: "trigger_job MCP tool description's Supported jobs list names only the three live jobs"
    requirement: "AUTH-06"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/jobs.routes.test.ts (full suite green + bun run typecheck clean, description string change verified by direct read)"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-07-02
status: complete
---

# Phase 15 Plan 03: Retired Token-Refresh Job Cleanup Summary

**Removed the dead `refresh-tokens` entry from `TRIGGERABLE_JOBS` and the `trigger_job` MCP tool description — the 3-job contract (rebuild-journal, sync-fills, compute-bsm-greeks) is now the single MCP-02 source for both adapters.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-02T19:10:00Z
- **Completed:** 2026-07-02T19:17:00Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- `TRIGGERABLE_JOBS` in `packages/contracts/src/jobs.ts` shrunk from 4 to 3 entries — the retired `refresh-tokens` job (GW-03, Phase 11) is gone
- `trigger_job` MCP tool description (`apps/server/src/adapters/mcp/tools/trigger-job.ts`) now advertises only the three live jobs, closing the misleading-affordance gap (T-15-08)
- `jobs.routes.test.ts` canonical-list test locked to `toHaveLength(3)` — proven RED (failing at length 4) before the array edit, then GREEN
- `jobs.test.ts` non-rebuild-optional-calendarId case reassigned from the retired job name to a still-valid job (`sync-fills`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove the retired token-refresh job from the triggerable surface (RED-first via the canonical-list test)** - `5c65ae2` (fix)

**Plan metadata:** (this commit)

_Note: this task combined the RED and GREEN steps into a single commit (see TDD Gate Compliance below) rather than separate `test(...)`/`feat(...)` commits._

## Files Created/Modified
- `packages/contracts/src/jobs.ts` - `TRIGGERABLE_JOBS` array now has exactly 3 entries (rebuild-journal, sync-fills, compute-bsm-greeks)
- `packages/contracts/src/jobs.test.ts` - non-rebuild-optional-calendarId case now uses `sync-fills` instead of the retired `refresh-tokens`
- `apps/server/src/adapters/mcp/tools/trigger-job.ts` - "Supported jobs" description sentence lists only the three live jobs
- `apps/server/src/adapters/http/jobs.routes.test.ts` - canonical-list test asserts `toHaveLength(3)` and drops the `refresh-tokens` `toContain` assertion

## Decisions Made
- Removed the redundant duplicate `sync-fills WITHOUT calendarId passes (optional)` test title that would have resulted from a literal rename of the `refresh-tokens` case (the file already had a `sync-fills` case) — kept a single instance instead of two identically-titled tests. This is a same-scope hygiene fix, not scope creep (still inside the one file the plan named).
- Left `job-runs.ts` (`TRACKED_JOBS`), the worker schedule, and `job-runs.contract.test.ts` untouched — they read historical `refresh-tokens` run records, explicitly out of D-04 scope per the plan.
- Left `enqueueJob.test.ts`'s `"refresh-tokens"` string fixture untouched — `packages/core` never imports `@morai/contracts` (architecture-boundaries.md), so `ForEnqueueingJob` takes a plain `string` job name; this fixture is unrelated to the `TRIGGERABLE_JOBS` allow-list and out of the plan's 4-file scope.

## Deviations from Plan

None — plan executed exactly as written. One minor in-scope hygiene fix (removing a duplicate test title inside `jobs.test.ts`, the file the plan explicitly names) is documented above under Decisions Made, not tracked as a Rule 1-4 deviation since it produced no code/behavior change beyond what the plan specified.

## TDD Gate Compliance

**Warning:** The plan frontmatter declares `type: tdd`, which calls for separate `test(...)` (RED) and `feat(...)` (GREEN) commits per the Plan-Level TDD Gate Enforcement convention. This plan's single task was executed as a genuine RED→GREEN cycle (the updated assertion was run and confirmed failing at `toHaveLength(3)` vs actual length 4 — see "expect(received).toHaveLength(expected) / Expected length: 3 / Received length: 4" in the execution transcript — before the `TRIGGERABLE_JOBS` array was edited to GREEN), but both steps were committed together as a single `fix(15-03)` commit (`5c65ae2`) rather than as two separate commits. No separate `test(...)`/`feat(...)` commit pair exists in git log for this plan.

This is a process/commit-hygiene gap only — the RED-before-GREEN discipline itself was followed and verified with real command output; no untested code shipped.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- D-04 milestone-audit debt item is closed: the triggerable-job surface now matches the live job set exactly.
- No blockers for remaining Phase 15 plans (15-04, 15-05).

---
*Phase: 15-re-auth-smoothing*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created/modified files found on disk; commit `5c65ae2` found in git log.
