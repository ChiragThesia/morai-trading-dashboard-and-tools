---
phase: 06-derived-analytics
plan: 04
subsystem: analytics
tags: [term-structure, vertical-slice, pg-boss-chain, mcp, hexagonal, testcontainers, idempotency]

# Dependency graph
requires:
  - phase: 06-02
    provides: migration 0007 (term_structure_observations table + composite PK)
  - phase: 06-03
    provides: analytics domain + ports + computeAnalytics RED scaffold
provides:
  - "term-structure repo + in-memory twin (storeTermStructureObservations idempotent, readTermStructureSeries ordered) over a shared testcontainer contract"
  - "computeAnalytics use-case (term-structure half): term_slope passthrough, idempotent, NaN-skip"
  - "getTermStructure read use-case (thin forwarder)"
  - "compute-analytics pg-boss job chain-triggered after snapshot-calendars, RTH/holiday-gated, in TRACKED_JOBS"
  - "GET /api/analytics/term-structure + MCP get_term_structure over the ONE termStructureResponse contract"
  - "calendar-snapshots readSnapshotsForCycle port (current-cycle term_slope source) on both adapters"
affects: [06-05, compute-analytics-skew-half, analytics-read-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "term-slope passthrough: written value === source calendar_snapshots.term_slope, bit-for-bit (no recompute)"
    - "current-cycle read: MAX(snapshot_time) ≤ now, then all rows at that time"
    - "pg-boss chain extension: snapshot-calendars → compute-analytics (boss.send singletonKey, fire-and-forget)"
    - "one shared Zod contract for HTTP route + MCP tool (MCP-02): one-sided change fails typecheck"

key-files:
  created:
    - packages/adapters/src/postgres/repos/term-structure-observations.ts
    - packages/adapters/src/memory/term-structure-observations.ts
    - packages/adapters/src/__contract__/term-structure-observations.contract.ts
    - packages/adapters/src/memory/term-structure-observations.contract.test.ts
    - packages/adapters/src/postgres/repos/term-structure-observations.contract.test.ts
    - packages/core/src/analytics/application/computeAnalytics.ts
    - packages/core/src/analytics/application/getTermStructure.ts
    - packages/core/src/analytics/application/getTermStructure.test.ts
    - apps/worker/src/handlers/compute-analytics.ts
    - apps/server/src/adapters/http/analytics.routes.ts
    - apps/server/src/adapters/http/analytics.routes.test.ts
  modified:
    - packages/adapters/src/index.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
    - packages/adapters/src/memory/calendar-snapshots.contract.test.ts
    - packages/adapters/src/postgres/repos/job-runs.ts
    - packages/core/src/analytics/application/computeAnalytics.test.ts
    - packages/core/src/analytics/index.ts
    - packages/core/src/index.ts
    - apps/worker/src/handlers/snapshot-calendars.ts
    - apps/worker/src/handlers/snapshot-calendars.test.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/main.ts

key-decisions:
  - "readSnapshotsForCycle semantics = most recent snapshot time ≤ injected now(), then all rows at that time (the 'current cycle'); added to calendar-snapshots repo (owns the table) + twin"
  - "term_slope NaN ('NaN' numeric string) → parseFloat → NaN at the adapter; computeAnalytics skips NaN slopes so continuity rows never write a term-structure value (D-06)"
  - "compute-analytics is the new TERMINAL job (snapshot-calendars is no longer terminal); chain via boss.send singletonKey 'triggered-by-snapshot'"
  - "get_term_structure MCP tool migrated from typed-empty stub to real use-case over termStructureResponse; gained optional calendarId arg"

patterns-established:
  - "current-cycle reader port pattern for chain-triggered derived-row jobs"

requirements-completed: [ANLY-02, ANLY-03, MCP-02]

# Metrics
duration: ~17min
completed: 2026-06-22
status: complete
---

# Phase 6 Plan 04: Term-Structure Vertical Slice Summary

**The first end-to-end analytics slice: a compute-analytics pg-boss job (chain-triggered after snapshot-calendars) writes term_structure_observations as an exact term_slope passthrough, and the series is readable via GET /api/analytics/term-structure and MCP get_term_structure over one shared Zod contract.**

## Performance
- **Duration:** ~17 min
- **Started:** 2026-06-22T16:32:24Z
- **Completed:** 2026-06-22T16:50:17Z
- **Tasks:** 3 (Tasks 1-2 TDD red→green; Task 3 wiring + route/handler tests)
- **Files:** 30 (11 created, 19 modified)

## Accomplishments
- **Term-structure repo + twin (ANLY-02):** `makePostgresTermStructureObservationsRepo` (bulk INSERT onConflictDoNothing on the (snapshot_time, calendar_id) PK; ordered read; calendarId filter) and the Map-keyed in-memory twin. Both pass the SAME `runTermStructureContractTests` suite — memory in workspace mode, Postgres under testcontainers (real Postgres 16, migration chain incl. 0007). Idempotency proven (re-write = 0 new rows) and the value round-trips exactly (T-06-07 — no term_slope drift through the repo).
- **computeAnalytics term-structure half (R3):** reads the current snapshot cycle, copies `term_slope` THROUGH unchanged into each term-structure row (asserted bit-for-bit: written value === source term_slope), is idempotent, and skips NaN-slope continuity rows. The skew/RR half is left for 06-05 (deps accepted, not invoked).
- **getTermStructure use-case (ANLY-03):** thin forwarder over `ForReadingTermStructureSeries`; `ok([])` on no data; optional calendarId filter.
- **compute-analytics job (R4):** new pg-boss queue (no cron), chain-triggered by snapshot-calendars on success (`boss.send("compute-analytics", …, { singletonKey })`), RTH + NYSE-holiday gated terminal handler, registered in `schedule.ts` (9 queues now) and added to `TRACKED_JOBS` so it surfaces in `GET /api/status` `lastJobRuns`.
- **Read surface over one contract (R5 / MCP-02):** `GET /api/analytics/term-structure` and MCP `get_term_structure` both import and parse through the single `termStructureResponse` schema. Empty array (not error) on no data; flat `{error:"internal"}` on storage error. A one-sided field change fails `bun run typecheck`.

## Task Commits
1. **Task 1: term-structure repo + twin + shared contract** — `10e95d9` (feat). RED: postgres contract test failed module-not-found (right reason); GREEN: both repos pass the suite (memory 7/7 workspace; Postgres 7/7 testcontainers).
2. **Task 2: computeAnalytics term-structure half + getTermStructure** — `5d6e18d` (feat). RED: both use-case modules not found; GREEN: 8/8 analytics application tests, term_slope equality asserted.
3. **Task 3: compute-analytics job chain + GET/MCP surface + status** — `7973719` (feat). Route/handler/schedule/mcp tests green (43/43 in the targeted run); grep checks pass.

_TDD note (per the documented Phase 3 lesson): Tasks 1-2 proved RED inline (module-not-found at the right import) then committed once at green; Task 3 is wiring + adapter tests (TDD-exempt composition roots, but the route, handler-chain, schedule, and MCP behaviors all have failing-first assertions added)._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `readSnapshotsForCycle` to the calendar-snapshots repo + twin**
- **Found during:** Task 3 (wiring computeAnalytics in the worker)
- **Issue:** `makeComputeAnalyticsUseCase` requires `ForReadingCalendarSnapshotsForCycle`, but no adapter implemented it — the use-case could not be composed.
- **Fix:** Implemented `readSnapshotsForCycle` on `makePostgresCalendarSnapshotsRepo` (MAX(time) ≤ cycle, then all rows at that time; parseFloat at the numeric boundary so "NaN" → NaN) and the in-memory twin (§8 parity). Extended the shared calendar-snapshots contract suite with 3 cases (current-cycle selection, NaN passthrough, empty-on-no-data) — both adapters pass under testcontainers.
- **Files modified:** calendar-snapshots.ts (postgres + memory), calendar-snapshots.contract.ts, both calendar-snapshots.contract.test.ts
- **Committed in:** `7973719`

**2. [Rule 1 - Test sync] Updated snapshot-calendars / schedule / mcp tests for the new signatures**
- **Found during:** Task 3 (typecheck)
- **Issue:** Changing the snapshot-calendars handler deps (added `boss`), `AllHandlers` (added `computeAnalytics`), `makeMcpRouter` (added `getTermStructure`), and `registerGetTermStructureTool` (now takes a use-case) broke their existing tests at compile time.
- **Fix:** Injected a fake boss into the snapshot-calendars tests (plus a new assertion that success chain-enqueues compute-analytics and a failure does not); added `computeAnalytics` to the schedule test fixtures + a "not scheduled" case; threaded `fakeGetTermStructure` through the 3 makeMcpRouter calls and rewrote the get_term_structure tool test to exercise the real use-case over the shared contract.
- **Files modified:** snapshot-calendars.test.ts, schedule.test.ts, mcp.test.ts
- **Committed in:** `7973719`

**Total deviations:** 2 (1 Rule-3 blocking port addition, 1 Rule-1 test sync for deliberate signature changes). No architectural (Rule 4) decisions required.

## Known Stubs
- `apps/worker/src/main.ts` wires the compute-analytics use-case with **inert placeholders** for the skew/RR-half ports (`readSmile`/`writeSkew`/`writeRr`/`readRrHistory`) — they return `ok([])`/`ok(undefined)` and are **never invoked by the term-structure code path**. 06-05 replaces them with real smile/RR adapters when it adds the skew half. This is intentional and scoped to 06-05; it does not affect the term-structure slice (which uses only `readSnapshots`/`writeTerm`/`now`).

## Threat Surface
- **T-06-07 (Tampering — term-structure drift):** mitigated — computeAnalytics copies term_slope through; the use-case test asserts written value === source term_slope; the repo contract asserts exact numeric round-trip.
- **T-06-08 (Info disclosure on route error):** mitigated — flat `{error:"internal"}` body, no stack/SQL.
- **T-06-09 (malformed calendarId / tool args):** mitigated — optional calendarId parsed at the route + safeParse at the MCP boundary; invalid/unknown → empty array, never throws.
- **T-06-10 (off-RTH/holiday compute writing junk):** mitigated — RTH + NYSE holiday gate before the use-case in the compute-analytics handler.
No new threat surface beyond the plan's register.

## Next Phase Readiness
- 06-05 extends `makeComputeAnalyticsUseCase` with the skew/RR half (the dep surface is already in place) and adds `GET /api/analytics/skew` + MCP `get_skew` (the `analyticsRoutes` factory and the shared-contract pattern are ready to extend). The worker main.ts placeholders are the only wiring 06-05 must replace.

## Self-Check: PASSED

All 11 created files verified present; all 3 feature commits (`10e95d9`, `5d6e18d`, `7973719`) verified in git history. Full suite: 857 tests / 94 files green (testcontainer ran, not skipped); typecheck + lint clean.

---
*Phase: 06-derived-analytics*
*Completed: 2026-06-22*
