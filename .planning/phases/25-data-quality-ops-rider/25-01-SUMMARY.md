---
phase: 25-data-quality-ops-rider
plan: 01
subsystem: database
tags: [journal, snapshot-calendars, drizzle, postgres, testcontainers, data-quality]

# Dependency graph
requires: []
provides:
  - "SNAPSHOT_LEG_STALENESS_TOLERANCE_MS + isLegFresh — the OPS-01 freshness gate in snapshotCalendars.ts"
  - "LegSnapshot.time on both Postgres read paths (resolveLegSnapshot, getLatestLegObs) and the memory leg-observations twin"
  - "Contract-proven time round-trip (Postgres + memory) for LegSnapshot"
affects: [26-exit-advisor, 27-backtest, 25-02-compute-bsm-greeks-batching]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Freshness gate as pure Date arithmetic in core (isLegFresh), never a repo-level WHERE-clause filter — keeps the staleness tolerance a domain concept testable without I/O"
    - "Port-type field addition (LegSnapshot.time) as the forcing function that surfaces every construction site across adapters + tests via the compiler"

key-files:
  created: []
  modified:
    - docs/architecture/jobs.md
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/application/snapshotCalendars.ts
    - packages/core/src/journal/application/snapshotCalendars.test.ts
    - packages/core/src/journal/application/getLiveGreeks.test.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/memory/leg-observations.ts
    - packages/adapters/src/memory/calendar-snapshots.contract.test.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/__contract__/leg-observations.contract.ts

key-decisions:
  - "SNAPSHOT_LEG_STALENESS_TOLERANCE_MS = 45 min (1.5x the 30-min chain cadence), boundary inclusive (<=  tolerance = fresh)"
  - "A resolveLegs error is still treated as a missing leg (unchanged error policy) — the freshness gate now skips that calendar's cycle instead of persisting a zero/NaN row"
  - "Freshness gate lives in core as pure Date arithmetic — no repo-level time filter, per RESEARCH anti-pattern guidance"

patterns-established:
  - "Freshness/staleness gates as an exported pure predicate (isLegFresh) + named tolerance constant, unit-tested at the exact boundary, not just happy/unhappy paths"

requirements-completed: [OPS-01]

coverage:
  - id: D1
    description: "Missing leg (resolveLegs ok(null) or error) skips the calendar's cycle — zero calendar_snapshots rows written, console.warn names the calendar"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#freshness gate (OPS-01) — Jul-06 gap-row shapes eliminated > Test A"
        status: pass
    human_judgment: false
  - id: D2
    description: "A leg present but older than SNAPSHOT_LEG_STALENESS_TOLERANCE_MS skips the calendar's cycle instead of silently serving stale marks"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#freshness gate (OPS-01) — Jul-06 gap-row shapes eliminated > Test B"
        status: pass
    human_judgment: false
  - id: D3
    description: "Freshness boundary is documented and pinned: <= tolerance is fresh, > tolerance is stale"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#freshness gate (OPS-01) — Jul-06 gap-row shapes eliminated > Test C"
        status: pass
    human_judgment: false
  - id: D4
    description: "Regression preserved: both legs fresh writes the same D-05 row as before; fresh-but-unsolved (bsmIv='NaN') still writes marks + NaN greeks (D-06)"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#freshness gate (OPS-01) — Jul-06 gap-row shapes eliminated > Test D, Test E"
        status: pass
    human_judgment: false
  - id: D5
    description: "LegSnapshot.time round-trips the real leg_observations.time column on both Postgres read paths (resolveLegSnapshot, getLatestLegObs), contract-proven against real Postgres and the memory twin"
    requirement: "OPS-01"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts (testcontainers)"
        status: pass
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/leg-observations.contract.test.ts (testcontainers)"
        status: pass
      - kind: integration
        ref: "packages/adapters/src/memory/calendar-snapshots.contract.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "jobs.md snapshot-calendars row documents the freshness-gate skip behavior and the named tolerance constant"
    requirement: "OPS-01"
    verification:
      - kind: other
        ref: "grep -n SNAPSHOT_LEG_STALENESS_TOLERANCE_MS docs/architecture/jobs.md"
        status: pass
    human_judgment: false
  - id: D7
    description: "Post-deploy: zero new spot=0/NULL/NaN calendar_snapshots rows across a subsequent RTH window in prod"
    verification: []
    human_judgment: true
    rationale: "Requires the change to actually be deployed and observed against live prod pgboss/RTH cycles — orchestrator-driven psql check per 25-CONTEXT.md, not something this plan can prove at authoring time."

duration: 10min
completed: 2026-07-09
status: complete
---

# Phase 25 Plan 01: OPS-01 Snapshot Freshness Gate Summary

**snapshot-calendars now skips (never zero/NaN-fills) a calendar's cycle when its front or back leg is missing or older than a 45-minute freshness tolerance, closing the Jul-06 gap-row corruption mechanism before Exit Advisor/Backtest can inherit it.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-09T08:00:08Z
- **Completed:** 2026-07-09T08:09:32Z
- **Tasks:** 3 completed
- **Files modified:** 11

## Accomplishments
- `snapshot-calendars` root-cause fix: a cycle with a missing or stale leg SKIPS that calendar (no row) instead of writing spot=0/net_mark=0/front_iv=NaN — the exact Jul-06 shape — or silently serving stale marks.
- `LegSnapshot.time` threaded through both Postgres read paths (`resolveLegSnapshot`, `getLatestLegObs`) and the memory `leg-observations` twin, giving the use-case the observation instant needed to reason about leg age.
- `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` (45 min = 1.5x the 30-min chain cadence) and a pure `isLegFresh` predicate, exported from core, boundary-tested (`<=` tolerance is fresh).
- D-06 NaN continuity preserved for the fresh-but-unsolved case (`bsmIv='NaN'`) — the gate is about leg age/presence, not BSM solve state.
- Contract-proven the `time` round-trip against real Postgres (testcontainers) and the memory twin.
- `docs/architecture/jobs.md` updated first (docs-before-code) to describe the new skip behavior and named tolerance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — jobs.md snapshot-calendars row** - `777a7e3` (docs)
2. **Task 2: Thread LegSnapshot.time + freshness gate (TDD red→green)** - `b0b20f2` (feat)
3. **Task 3: Contract-test the time round-trip from real Postgres** - `ed811e7` (test)

_TDD note: Task 2 was developed RED→GREEN (RED confirmed via `bun run test` — 4 failing assertions/TypeError before implementation existed — then GREEN, 23/23 passing) but committed as a single commit at green, per this repo's `tdd.md` ("Commit only at green. Never commit with a failing suite."), which takes precedence over the generic GSD executor convention of a separate RED-only commit._

## Files Created/Modified
- `docs/architecture/jobs.md` - snapshot-calendars Job Catalog row documents the freshness-gate skip behavior + tolerance constant
- `packages/core/src/journal/application/ports.ts` - `LegSnapshot.time: Date` added (forcing function for every construction site)
- `packages/core/src/journal/application/snapshotCalendars.ts` - `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS`, `isLegFresh`, and the skip-on-stale/missing gate in the per-calendar loop
- `packages/core/src/journal/application/snapshotCalendars.test.ts` - new freshness-gate describe block (Tests A-E) + rewrote the two tests that previously asserted a missing leg still wrote a NaN row
- `packages/core/src/journal/application/getLiveGreeks.test.ts` - local `makeLegSnapshot` fixture given a `time` field (unrelated use-case, same widened port type)
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` - `resolveLegSnapshot` selects and returns `legObservations.time`
- `packages/adapters/src/postgres/repos/leg-observations.ts` - `getLatestLegObs` selects and returns `legObservations.time`
- `packages/adapters/src/memory/leg-observations.ts` - `getLatestLegObs` twin returns `latest.time` (architecture-boundaries.md §8 parity)
- `packages/adapters/src/memory/calendar-snapshots.contract.test.ts` - `seedObservation` now threads `time` into the seeded `LegSnapshot` (was previously discarded as `_time`)
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` - `resolveLegSnapshot` hit/latest tests assert `leg.time` round-trips the seeded timestamp
- `packages/adapters/src/__contract__/leg-observations.contract.ts` - `getLatestLegObs` "latest wins" test asserts `time` round-trips the seeded timestamp

## Decisions Made
- Staleness tolerance = 45 minutes (1.5x the 30-min chain-fetch cadence), inclusive boundary (`<=` tolerance counts as fresh) — pinned by an explicit boundary unit test rather than left incidental.
- A `resolveLegs` error stays mapped to a null leg (unchanged error policy from before this plan) — what changed is what happens to a null leg: it now fails the freshness gate and skips that one calendar's cycle instead of being written as a NaN row.
- Freshness decision kept in core as pure `Date` arithmetic — no `WHERE time > ...` pushed into the repo, per RESEARCH anti-pattern guidance (the tolerance is a domain concept, not a query optimization).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing tests asserted the exact behavior this plan fixes**
- **Found during:** Task 2
- **Issue:** `snapshotCalendars.test.ts` had two tests ("front resolves null (storage error)" and "front resolves ok(null)") that asserted a missing leg still wrote a row with NaN fields — that is precisely the Jul-06 gap-row mechanism OPS-01 removes.
- **Fix:** Rewrote both tests to assert the calendar is skipped (`persistSnapshot` not called, run still returns `ok`); the ok(null) case is now covered by the new "Test A" in the freshness-gate describe block, so the duplicate test was folded into it.
- **Files modified:** `packages/core/src/journal/application/snapshotCalendars.test.ts`
- **Verification:** `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` — 23/23 passing
- **Committed in:** `b0b20f2` (Task 2 commit)

**2. [Rule 3 - Blocking] getLiveGreeks.test.ts fixture needed `time` after the port type widened**
- **Found during:** Task 2 (`bun run typecheck`)
- **Issue:** `getLiveGreeks.test.ts`'s local `makeLegSnapshot` fixture built a `LegSnapshot` literal without `time`, which no longer type-checked once `ports.ts` added the required field.
- **Fix:** Added a fixed `time` default to the fixture.
- **Files modified:** `packages/core/src/journal/application/getLiveGreeks.test.ts`
- **Verification:** `bun run typecheck` clean
- **Committed in:** `b0b20f2` (Task 2 commit)

**3. [Rule 3 - Blocking] Latent test-isolation gap in the shared leg-observations contract suite**
- **Found during:** Task 3
- **Issue:** Adding a `time` round-trip assertion to the basic `getLatestLegObs` "hit" test failed intermittently — the suite reuses the same fixture `occSymbol` across ~66 tests in the file without truncating the table between them, so "latest for this contract" can legitimately resolve to a row seeded by an earlier test in the file. This was always true; it was invisible before because every fixture call uses the identical `mark`/`underlyingPrice` values, so no prior assertion could distinguish "this test's row" from "an earlier test's row" for the same contract.
- **Fix:** Removed the fragile `time` assertion from the basic "hit" test (left a comment explaining why) and kept the round-trip proof in the "latest row when multiple observations exist" test, whose deliberate +30min offset is provably newer than any other test's random seed window in the same file (max jitter is ~16.67 min).
- **Files modified:** `packages/adapters/src/__contract__/leg-observations.contract.ts`
- **Verification:** `bun run test -- packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` run 3x consecutively, 19/19 passing each time (no flakiness)
- **Committed in:** `ed811e7` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were necessary to land the plan's own described behavior and test suite; no scope creep beyond the plan's file list plus two unavoidable ripple-effect files (`getLiveGreeks.test.ts`, `memory/calendar-snapshots.contract.test.ts`).

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- OPS-01 is code-complete and fully tested (unit + Postgres/memory contract). Not yet deployed to prod — the post-deploy gap-count verification (D7 above) is an orchestrator-driven follow-up once this ships.
- Plan 25-02 (compute-bsm-greeks batching, OPS-02) is unblocked — no shared files touched by this plan beyond `docs/architecture/jobs.md`, whose compute-bsm-greeks row and Retries note were explicitly left untouched here per the plan's scope boundary.
- Deferred items untouched, as scoped: `mapSnapshotRow` schwab_chain drop (RESEARCH Pitfall 6) and retroactive gap-fill of Jun 23-26 rows.

---
*Phase: 25-data-quality-ops-rider*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 11 modified/tracked files and 3 task commit hashes (777a7e3, b0b20f2, ed811e7) verified present.
