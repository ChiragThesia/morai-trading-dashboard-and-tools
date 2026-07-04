---
phase: 19-picker-engine-economic-events
plan: 04
subsystem: api
tags: [fred, zod, drizzle, postgres, msw, hexagonal-ports]

# Dependency graph
requires:
  - phase: 19-picker-engine-economic-events (plan 01)
    provides: "ForFetchingEconomicEvents/ForReadingEconomicEvents/ForPersistingEconomicEvents port signatures + EconomicEvent domain type in packages/core/src/picker/application/ports.ts"
provides:
  - "makeEconomicEventsAdapter — FRED CPI (release_id=10) + NFP (release_id=50) release/dates HTTP client unioned with a maintained FOMC_SEED table into one EconomicEvent[]"
  - "makeMemoryEconomicEventsRepo — in-memory twin, Map keyed on (date, name), replace-on-conflict"
  - "makePostgresEconomicEventsRepo — bulk onConflictDoUpdate upsert + read-all on the economic_events table"
  - "economic_events Postgres table (schema.ts + migration 0014_economic_events.sql, plain `date` column, composite PK, RLS)"
  - "runEconomicEventsContractTests — shared contract suite exercised against both implementations"
  - "packages/core/src/picker/index.ts barrel — first cross-package-consumable export surface for the picker bounded context"
affects: ["19-05 (live migration apply)", "19-06..19-09 (compute-picker use-case, worker cron wiring, HTTP/MCP routes)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FRED release/dates client mirrors fred.ts's no-fallback discipline (err on any failure, static warn text, never log the key) but with a NEW FredReleaseDatesSchema — release/dates has a different response shape than series/observations"
    - "Two-origin union (FRED fetch + hardcoded FOMC seed) resolved inside the adapter — the port returns one EconomicEvent[], never exposing two read paths"
    - "event_date stored as a plain SQL `date`, never timestamptz — the ET calendar day as published is the correct day, no timezone conversion needed at read/write time"

key-files:
  created:
    - packages/adapters/src/http/economic-events.ts
    - packages/adapters/src/http/economic-events.test.ts
    - packages/adapters/src/memory/economic-events.ts
    - packages/adapters/src/memory/economic-events.contract.test.ts
    - packages/adapters/src/__contract__/economic-events.contract.ts
    - packages/adapters/src/postgres/repos/economic-events.ts
    - packages/adapters/src/postgres/repos/economic-events.contract.test.ts
    - packages/adapters/src/postgres/migrations/0014_economic_events.sql
    - packages/core/src/picker/index.ts
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - packages/core/src/index.ts

key-decisions:
  - "Added packages/core/src/picker/index.ts barrel + wired it into packages/core/src/index.ts (Rule 3 auto-fix) so EconomicEvent/ForFetchingEconomicEvents/etc. are importable from @morai/adapters via \"@morai/core\" — no prior plan (19-01..03) needed cross-package consumption so no barrel existed yet"
  - "StorageError/FetchError intentionally NOT re-exported from the picker barrel — both are structurally identical to (and already exported under those names by) the journal context; re-exporting under the same name would collide (analytics/index.ts precedent)"
  - "FOMC_SEED authored from best-available Fed-published 2025/2026 meeting schedule (training-knowledge recall, not a live fetch) since no live web/FRED access was available this session — documented as needing periodic refresh against the official Fed calendar"
  - "NOT marking PICK-03 complete — this plan ships only the adapter/repo data path; the cron job wiring (fetch-economic-events, worker schedule.ts) lives in plan 19-08 and the scoring/candidates-payload integration lands in later plans, matching the 19-01/19-02/19-03 precedent of not prematurely closing a requirement"

patterns-established:
  - "Wave-0 shape-spike-as-header-comment: when a live API call can't be confirmed (no key/no network), document the assumed shape and its risk directly at the top of the file that will parse it, so a first-live-run Zod failure is expected and traceable"

requirements-completed: []  # PICK-03 intentionally NOT marked complete — see key-decisions

# Metrics
duration: ~15min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 04: Economic-Events Data Path Summary

**FRED CPI+NFP `release/dates` HTTP adapter unioned with a maintained FOMC seed into one honest `EconomicEvent[]`, persisted to a plain-`date` Postgres table via a shared memory+Postgres contract suite**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-04T22:15:25Z
- **Tasks:** 3 (Wave-0 spike, HTTP adapter, table+repos+contract suite)
- **Files modified:** 13 (10 created, 3 modified)

## Accomplishments

- `makeEconomicEventsAdapter` fetches FRED CPI (release_id=10) and NFP (release_id=50) release dates, unions them with the exported `FOMC_SEED` table, and returns one date-sorted `EconomicEvent[]` — no fabricated fallback on any failure path (missing/empty key, non-2xx, network error, malformed payload all return `err`)
- New `economic_events` Postgres table (plain `date` column, composite PK on `(event_date, event_name)`, RLS enabled) via migration `0014_economic_events.sql`, plus `makePostgresEconomicEventsRepo` (bulk `onConflictDoUpdate` upsert) and `makeMemoryEconomicEventsRepo` (in-memory twin)
- `runEconomicEventsContractTests` shared suite proves round-trip, idempotent re-insert, read-all-across-names, empty-read, and a DST-boundary round-trip (event_date never shifts a calendar day) — run against both implementations identically
- Closed a wiring gap: added the picker bounded context's first `index.ts` barrel so its port types reach `@morai/adapters` via `@morai/core`

## Task Commits

Each task was committed atomically:

1. **Task 1: FRED release/dates live-shape spike (Wave 0, Pitfall 4)** - `9b43ecd` (docs)
2. **Task 2: economic-events HTTP adapter (FRED CPI+NFP + FOMC seed union) with msw tests** - `3af94c0` (feat, TDD RED→GREEN in one commit per project tdd.md/17.1-01 precedent)
3. **Task 3: economic_events table + Postgres repo + memory twin + shared contract suite** - `d85d8c7` (feat)

**Plan metadata:** (final commit hash recorded after this file is committed)

_Note: TDD tasks landed as a single commit at green, matching the project's own established precedent (17.1-01, 18-03) — RED was run and confirmed failing for the right reason (`TypeError: makeEconomicEventsAdapter is not a function`) before the GREEN implementation was written._

## Files Created/Modified

- `packages/adapters/src/http/economic-events.ts` - FRED CPI+NFP release/dates client + FOMC_SEED, union-inside-adapter, no fabricated fallback
- `packages/adapters/src/http/economic-events.test.ts` - msw tests for union, missing-key-err, malformed-payload-err, non-2xx-err, network-throw-err
- `packages/adapters/src/memory/economic-events.ts` - in-memory twin, Map keyed `${date}|${name}`
- `packages/adapters/src/memory/economic-events.contract.test.ts` - wires the shared suite to the memory twin
- `packages/adapters/src/__contract__/economic-events.contract.ts` - shared `runEconomicEventsContractTests(makeRepo)` suite
- `packages/adapters/src/postgres/repos/economic-events.ts` - Postgres repo, bulk upsert + typed read
- `packages/adapters/src/postgres/repos/economic-events.contract.test.ts` - wires the shared suite to testcontainers Postgres
- `packages/adapters/src/postgres/migrations/0014_economic_events.sql` - `CREATE TABLE economic_events` (plain `date`, composite PK, RLS)
- `packages/core/src/picker/index.ts` - new picker context barrel (EconomicEvent + 3 ports)
- `packages/adapters/src/postgres/schema.ts` - added `economicEvents` table definition
- `packages/adapters/src/postgres/migrations/meta/_journal.json` - registered migration 0014
- `packages/core/src/index.ts` - re-exports the picker barrel

## Decisions Made

- Added `packages/core/src/picker/index.ts` (Rule 3 blocking-issue auto-fix): the adapter needed `EconomicEvent`/`ForFetchingEconomicEvents`/etc. importable from `@morai/core`, but no picker barrel existed yet since plans 19-01..03 only produced files internal to `packages/core` with no external consumer. Followed the exact analytics/index.ts precedent (per-context barrel, `StorageError`/`FetchError` not re-exported to avoid name collision with journal's identically-shaped types).
- `FOMC_SEED` dates are authored from training-knowledge recall of the Fed's published 2025/2026 meeting schedule (statement day of each two-day meeting), since `FRED_API_KEY` was absent and no live web access was available this session to cross-check. Documented in the file's own doc comment as needing periodic refresh against the official Fed calendar.
- Renamed drizzle-kit's auto-generated `0014_wise_blacklash.sql` to `0014_economic_events.sql` (and updated the journal tag to match) per the plan's explicit naming requirement — drizzle-kit itself has no flag to name migrations directly.
- Not marking `PICK-03` complete in REQUIREMENTS.md — this plan ships the adapter/repo data path only; the cron job (`fetch-economic-events` in worker `schedule.ts`) and the scoring/candidates-payload event-window integration are scoped to later plans in this phase (19-06..19-09 per 19-PATTERNS.md), matching the phase's own established discipline of not prematurely closing a requirement (19-01/19-02/19-03 SUMMARY precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing picker context barrel (`packages/core/src/picker/index.ts`)**
- **Found during:** Task 2 (HTTP adapter implementation)
- **Issue:** `packages/adapters/src/http/economic-events.ts` needs `EconomicEvent`, `ForFetchingEconomicEvents`, `FetchError` from `@morai/core`, but `packages/core/src/index.ts` had no picker-context exports at all (no `picker/index.ts` barrel existed — prior plans 19-01/02/03 only wrote files consumed within `packages/core` itself, never by an adapter)
- **Fix:** Created `packages/core/src/picker/index.ts` re-exporting `EconomicEvent`/`ForFetchingEconomicEvents`/`ForReadingEconomicEvents`/`ForPersistingEconomicEvents` from `application/ports.ts`, and added the corresponding re-export block to `packages/core/src/index.ts`, following the exact structural precedent of `analytics/index.ts`'s own barrel (including its documented rationale for not re-exporting `StorageError`/`FetchError` a second time)
- **Files modified:** `packages/core/src/picker/index.ts` (new), `packages/core/src/index.ts`
- **Verification:** `bun run typecheck` green; `bun run test --project packages/adapters -- http/economic-events.test.ts` green
- **Committed in:** `3af94c0` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary wiring to make the plan's own artifact compile; no scope creep beyond the barrel itself, no new architectural decision (pure porting of an existing pattern).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. `FRED_API_KEY` is an existing env var (already referenced by `fred.ts` since Phase 14); it remains unset locally, which is the honest-degradation path this plan's adapter is designed to handle (`err`, never a fabricated event set).

**Human-check carried forward from Task 1:** `FRED_API_KEY` was not available in this execution environment, so the `release/dates` response shape was NOT live-confirmed — the adapter proceeds on RESEARCH.md's A3 assumed shape (`{release_dates: [{release_id, release_name?, date}]}`). The first live cron run (once `fetch-economic-events` is wired in plan 19-08 and a real key is provisioned) must be watched for a Zod parse failure; if the live shape differs, `makeEconomicEventsAdapter` will fail loudly with `err({kind:"fetch-error"})` rather than silently corrupting data, per D-17.

## Next Phase Readiness

- The economic-events data path (adapter + both repos + shared contract suite) is complete and fully tested (memory contract green; Postgres contract gracefully skips — Docker unavailable in this environment, will exercise once Docker/CI is available)
- Migration `0014_economic_events.sql` is committed but NOT yet applied to any live database — live apply is explicitly deferred to plan 19-05 per this plan's own scope boundary
- Ready for 19-05 (live migration apply) and the later compute-picker/worker-cron/route wiring plans (19-06..19-09) to consume `ForFetchingEconomicEvents`/`ForReadingEconomicEvents`/`ForPersistingEconomicEvents`

---
*Phase: 19-picker-engine-economic-events*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 13 created/modified files verified present on disk; all 3 task commit hashes (9b43ecd, 3af94c0, d85d8c7) verified present in git log.
