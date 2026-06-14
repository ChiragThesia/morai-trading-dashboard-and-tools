---
phase: "03"
plan: "05"
subsystem: journal
tags: [snapshot, use-case, repos, tdd, calendar-journal, greek-math, targeted-fetch, worker-wiring]
dependency_graph:
  requires: [03-01, 03-02, 03-03, 03-04]
  provides: [snapshot-vertical-slice, snapshot-calendars-use-case, calendar-snapshots-repo, d04-targeted-fetch, d03-chain-trigger, cal05-holiday-gate]
  affects: [packages/core/journal, packages/adapters/postgres, packages/adapters/memory, apps/worker]
tech_stack:
  added: []
  patterns: [tdd-red-green, hexagonal-ports, testcontainers-contract, fast-check-property, d06-nan-continuity, d05-net-greek-math, d04-mustinclude-bypass, d03-boss-chain, cal05-rth-holiday-gate]
key_files:
  created:
    - packages/core/src/journal/application/snapshotCalendars.ts
    - packages/core/src/journal/application/snapshotCalendars.test.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - apps/worker/src/handlers/snapshot-calendars.ts
    - apps/worker/src/handlers/snapshot-calendars.test.ts
    - apps/worker/src/handlers/compute-bsm-greeks.test.ts
  modified:
    - packages/core/src/journal/application/fetchChain.ts
    - packages/core/src/journal/application/fetchChain.test.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/index.ts
    - apps/worker/src/handlers/compute-bsm-greeks.ts
    - apps/worker/src/handlers/fetch-rates.ts
    - apps/worker/src/main.ts
    - packages/core/src/journal/domain/nyse-holidays.ts
decisions:
  - D-05: netGreek = (back - front) * qty * 100; NaN propagation when any leg NaN
  - D-06: NaN_STAMP = "NaN"; always write snapshot row even if legs unresolvable
  - D-04: mustInclude bypass — getOpenCalendarLegs() builds a set that skips DTE/band filter
  - D-03: compute-bsm-greeks success fires boss.send("snapshot-calendars", {}, { singletonKey }) fire-and-forget
  - CAL-05: ALL 4 jobs gate on NYSE holiday; compute-bsm-greeks + snapshot-calendars also gate on RTH
  - Blocker-2: fetch-rates holiday-only gate (no RTH gate — daily 09:00 job runs before RTH per RESEARCH A2)
  - Blocker-3: compute-bsm-greeks CAL-05 gate sits before use-case call so holiday never chains to snapshot
metrics:
  duration_minutes: 19
  completed_date: "2026-06-14"
  tasks_completed: 4
  files_changed: 17
---

# Phase 03 Plan 05: Snapshot Vertical Slice Summary

**One-liner:** Snapshot-calendars use-case with D-05 net-greek math, D-06 NaN-leg continuity, Postgres+memory repos with testcontainers contract tests, D-04 targeted-fetch bypass, D-03 boss chain trigger, and CAL-05 holiday gate across all 4 worker jobs.

## Tasks Completed

| Task | Name | RED commit | GREEN commit |
|------|------|-----------|-------------|
| 1 | snapshotCalendars use-case (D-05 + D-06) | 5cc2afc | ed02cf3 |
| 2 | calendar-snapshots repos + contract tests | d975810 | ba55aa4 |
| 3 | fetchChain D-04 targeted-fetch extension | 88d074d | b307181 |
| 4 | snapshot handler + CAL-05 gates + worker wiring | 0bf575a | 03fc4a6 |

## What Was Built

### Task 1 — `snapshotCalendars` use-case

`makeSnapshotCalendarsUseCase` in `packages/core/src/journal/application/snapshotCalendars.ts`.

D-05 formulas implemented per SPEC:
- `netMark = backMark - frontMark`
- `netGreek = (back - front) * qty * 100` for delta, gamma, theta, vega
- `termSlope = backIv - frontIv`
- `pnlOpen = (netMark - openNetDebit) * qty * 100`

D-06 NaN-leg continuity:
- `NAN_STAMP = "NaN"` — the Postgres string literal for NaN in numeric columns
- When any leg is null, errors, or has NaN IV, numeric greeks all get `NAN_STAMP`
- `pnlOpen` still computes from marks (never NaN) even when greeks are NaN
- Row is ALWAYS written — no skips on unresolvable legs

15 unit tests (15/15 green). fast-check property: `pnlOpen = (netMark - openNetDebit) * qty * 100` for 50 arbitrary float inputs.

### Task 2 — Calendar-snapshots repos

**Postgres:** `makePostgresCalendarSnapshotsRepo(db)` implementing:
- `persistSnapshot`: INSERT with `onConflictDoNothing()` on composite PK `(time, calendar_id)`
- `readJournal`: checks calendar existence first → `ok(null)` for unknown IDs; `orderBy(asc(time))` for known
- `resolveLegSnapshot`: two-step join — contracts table → leg_observations ORDER BY time DESC LIMIT 1

**Memory:** `makeMemoryCalendarSnapshotsRepo()` with `Map<string, SnapshotRow>` keyed `${iso}:${calendarId}`. Divergence documented: `readJournal` returns `[]` for unknown IDs vs Postgres `null`.

Shared contract suite (`calendar-snapshots.contract.ts`): 11 tests covering idempotency, NaN insert, time-ASC ordering, null-on-unknown-id, resolveLegSnapshot hit/miss/latest. 11/11 green against real Postgres 16 (testcontainers).

### Task 3 — fetchChain D-04 targeted-fetch

`FetchChainDeps` extended with `getOpenCalendarLegs: ForGettingOpenCalendarLegs`. Before processing chains, builds `mustInclude: ReadonlySet<string>` from `getOpenCalendarLegs()` result (degrades to empty set on error).

Loop guard: `if (!isInFilter(...) && !mustInclude.has(quote.occSymbol)) continue` — must-include legs bypass both DTE and strike-band filters.

3 new tests (8/8 total green for fetchChain).

### Task 4 — Handler + gates + wiring

**`makeSnapshotCalendarsHandler`:** array-guard → RTH+holiday gate → use-case → throw on err. Terminal job, no boss.send.

**`makeComputeBsmGreeksHandler` (modified):** RTH+holiday gate sits BEFORE use-case call (Blocker 3). On success: `boss.send("snapshot-calendars", {}, { singletonKey: "triggered-by-compute" })` fire-and-forget with `.catch()` (D-03).

**`makeFetchRatesHandler` (modified):** holiday-only gate added (no RTH gate — daily 09:00 job per RESEARCH A2 / Blocker 2). Now testable via `now` injection.

**`main.ts`:** Builds `calendarSnapshotsRepo`, `snapshotCalendarsUseCase` with all 4 deps, `snapshotCalendarsHandler`. Updates `fetchChainUseCase` with `getOpenCalendarLegs`. Updates `computeBsmGreeksHandler` and `fetchRatesHandler` with `boss`/`now`. 4th queue `snapshot-calendars` created (no schedule — chain-triggered only, D-03/Pitfall 5).

10 handler tests (5 snapshot-calendars + 5 compute-bsm-greeks), all 10/10 green.

## TDD Gate Compliance

All 4 tasks followed strict RED → GREEN:
- `test(03-05):` commits all predate their corresponding `feat(03-05):` commits
- `git log --grep="^test(03-05):"` returns 4 commits: `5cc2afc`, `d975810`, `88d074d`, `0bf575a`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing lint compliance] strict-boolean-expressions in nyse-holidays.ts**
- **Found during:** Task 4 (lint run)
- **Issue:** `!year || !month || !day` triggered `@typescript-eslint/strict-boolean-expressions`
- **Fix:** Replaced with `year === undefined || month === undefined || day === undefined`
- **Files modified:** `packages/core/src/journal/domain/nyse-holidays.ts`
- **Commit:** 03fc4a6

**2. [Rule 2 - Missing lint compliance] consistent-type-assertions violations in snapshotCalendars.test.ts**
- **Found during:** Task 1 (lint run after implementation)
- **Issue:** `as SnapshotRow` cast in test to extract row from `vi.fn().mock.calls`
- **Fix:** Replaced all `vi.fn().mockResolvedValue(ok(undefined))` mocks with `makePersistCapture()` typed closure helper. Rows captured in `SnapshotRow[]` array — no casts anywhere.
- **Files modified:** `packages/core/src/journal/application/snapshotCalendars.test.ts`
- **Commit:** 03fc4a6

**3. [Rule 2 - Missing lint compliance] `as LegSnapshot` cast in contract test**
- **Found during:** Task 2 (lint run)
- **Issue:** `as LegSnapshot` cast when narrowing from `LegSnapshot | null`
- **Fix:** Replaced with explicit null guard + typed assignment: `const leg: LegSnapshot = legOrNull`
- **Files modified:** `packages/adapters/src/__contract__/calendar-snapshots.contract.ts`
- **Commit:** ba55aa4

**4. [Rule 1 - Bug] OccSymbol brand confusion in Postgres repo**
- **Found during:** Task 2 (typecheck)
- **Issue:** `parsedOcc.value` (type `OccSymbolParsed`) used where `OccSymbol` (branded string) required
- **Fix:** Used `formatOccSymbol(parsedOcc.value)` to get the branded `OccSymbol` string
- **Files modified:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts`
- **Commit:** ba55aa4

**5. [Rule 1 - Bug] fast-check v4 float boundaries must be 32-bit**
- **Found during:** Task 1 (test run)
- **Issue:** `fc.float({ min: 0.01, max: 500 })` — v4 requires `Math.fround()` for min/max
- **Fix:** `fc.float({ min: Math.fround(0.01), max: Math.fround(500), noNaN: true })`
- **Files modified:** `packages/core/src/journal/application/snapshotCalendars.test.ts`
- **Commit:** ed02cf3 (baked in before lint pass)

## Known Stubs

None. All data flows are wired end-to-end: `getOpenCalendars` → `resolveLegs` → `persistSnapshot` with real Postgres adapter implementations.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced in this plan. All new surfaces are internal job handler and use-case wiring, and Postgres row operations covered by existing RLS policy.

## Self-Check: PASSED

Files created:
- packages/core/src/journal/application/snapshotCalendars.ts: FOUND
- packages/core/src/journal/application/snapshotCalendars.test.ts: FOUND
- packages/adapters/src/__contract__/calendar-snapshots.contract.ts: FOUND
- packages/adapters/src/postgres/repos/calendar-snapshots.ts: FOUND
- packages/adapters/src/memory/calendar-snapshots.ts: FOUND
- apps/worker/src/handlers/snapshot-calendars.ts: FOUND
- apps/worker/src/handlers/snapshot-calendars.test.ts: FOUND
- apps/worker/src/handlers/compute-bsm-greeks.test.ts: FOUND

Commits verified:
- 5cc2afc (RED task 1): FOUND
- ed02cf3 (GREEN task 1): FOUND
- d975810 (RED task 2): FOUND
- ba55aa4 (GREEN task 2): FOUND
- 88d074d (RED task 3): FOUND
- b307181 (GREEN task 3): FOUND
- 0bf575a (RED task 4): FOUND
- 03fc4a6 (GREEN task 4): FOUND

Tests: 33/33 green (4 test files run in isolation); 11/11 contract tests green (isolated run)
Typecheck: clean
Lint: clean
