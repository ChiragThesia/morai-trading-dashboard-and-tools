---
phase: 03-calendar-journal-mvp
plan: "06"
subsystem: journal-read-surface
tags: [contracts, use-cases, http-route, live-greeks, analytics, tdd]
dependency_graph:
  requires: ["03-01", "03-03", "03-05"]
  provides: [journalResponse, liveGreeksResponse, termStructureResponse, skewResponse, getJournal, getLiveGreeks, GET-/api/journal/:calendarId, getLatestLegObs]
  affects: [packages/contracts, packages/core/journal, packages/adapters/leg-observations, apps/server]
tech_stack:
  added: []
  patterns: [MCP-02-single-schema-source, thin-http-adapter, hexagonal-port-injection]
key_files:
  created:
    - packages/contracts/src/journal.ts
    - packages/contracts/src/live-greeks.ts
    - packages/contracts/src/analytics.ts
    - packages/core/src/journal/application/getJournal.ts
    - packages/core/src/journal/application/getLiveGreeks.ts
    - packages/adapters/src/memory/leg-observations.ts
    - apps/server/src/adapters/http/journal.routes.ts
    - packages/contracts/src/journal.test.ts
    - packages/core/src/journal/application/getJournal.test.ts
    - packages/core/src/journal/application/getLiveGreeks.test.ts
    - packages/adapters/src/memory/leg-observations.test.ts
    - apps/server/src/adapters/http/journal.routes.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/index.ts
    - packages/adapters/src/__contract__/leg-observations.contract.ts
    - packages/adapters/src/postgres/repos/leg-observations.contract.test.ts
    - apps/server/src/main.ts
decisions:
  - "getLiveGreeks uses formatOccSymbol(strike/1000) matching calendars.ts getOpenCalendarLegs OCC-construction — same ×1000→points conversion"
  - "Memory leg-observations adapter implements only persistObservations + getLatestLegObs (subset needed by plan 06 tests)"
  - "Zod v4 UUID regex: test fixtures use 550e8400-e29b-41d4-a716-446655440001 format (not 00000000-0000-0000-0000-000000000001)"
  - "journalRoutes accepts ForReadingJournal directly — thin forwarder pattern matches getJournal use-case shape"
metrics:
  duration: "~16 min"
  completed_date: "2026-06-14"
  tasks_completed: 3
  files_created: 12
  files_modified: 8
---

# Phase 03 Plan 06: Journal Read Surface + Live Greeks + Analytics Contracts Summary

Journal read surface (CAL-03) delivered: `GET /api/journal/:calendarId` returns the ordered 18-field snapshot series using a shared `journalResponse` Zod contract. Also delivers `getLiveGreeks` use-case, `getLatestLegObs` repo method on both adapters, and typed-empty analytics contracts for plan 07 MCP stub tools.

## Tasks Completed

### Task 1: Journal + live-greeks + analytics contracts and use-cases

**Status:** COMPLETE — RED→GREEN

Files created:
- `packages/contracts/src/journal.ts` — `snapshotResponse` (18 fields, NaN allowed in numeric strings) + `journalResponse`
- `packages/contracts/src/live-greeks.ts` — `liveGreeksResponse` (`calendarId` + `legs` array with 5 bsm fields)
- `packages/contracts/src/analytics.ts` — `termStructureResponse` + `skewResponse` (typed-empty `{ observations: z.array(z.unknown()) }`)
- `packages/contracts/src/index.ts` — all new schemas exported
- `packages/core/src/journal/application/getJournal.ts` — `makeGetJournalUseCase` thin forwarder to `ForReadingJournal`
- `packages/core/src/journal/application/getLiveGreeks.ts` — `makeGetLiveGreeksUseCase` with `formatOccSymbol(strike/1000)` OCC construction; missing obs → NaN bsm fields; unknown calendar → ok with empty legs (never an error per SPEC §7)
- `packages/core/src/journal/index.ts` — re-exports new factories
- `packages/core/src/index.ts` — exports `makeGetJournalUseCase` + `makeGetLiveGreeksUseCase` + related types

Red commit: `7ec7a2e` — `test(03-06): journal+live-greeks+analytics contracts and getJournal/getLiveGreeks use-cases (RED)`
Green commit: `d851943` — `feat(03-06): journal+live-greeks+analytics contracts and getJournal/getLiveGreeks use-cases (GREEN)`

### Task 2: getLatestLegObs repo method (Postgres + memory)

**Status:** COMPLETE — RED→GREEN

Files modified:
- `packages/adapters/src/postgres/repos/leg-observations.ts` — added `getLatestLegObs: ForReadingLatestLegObs` (`SELECT ... ORDER BY time DESC LIMIT 1`, Drizzle parameterized)
- `packages/adapters/src/__contract__/leg-observations.contract.ts` — added `ForReadingLatestLegObs` to `LegObservationsRepo` type + 3 getLatestLegObs contract test cases
- `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` — pass `repo.getLatestLegObs` to contract suite

Files created:
- `packages/adapters/src/memory/leg-observations.ts` — `makeMemoryLegObservationsRepo` with `persistObservations` + `getLatestLegObs` (max-time scan)
- `packages/adapters/src/memory/leg-observations.test.ts` — 5 memory adapter unit tests (no Docker)
- `packages/adapters/src/index.ts` — export `makeMemoryLegObservationsRepo` + `MemoryLegObservationsRepo`

Red commit: `5355f32` — `test(03-06): getLatestLegObs repo method in leg-observations adapters (RED)`
Green commit: `617c298` — `feat(03-06): getLatestLegObs repo method on Postgres + memory leg-observations (GREEN)`

### Task 3: Journal HTTP route + server wiring

**Status:** COMPLETE — RED→GREEN

Files created:
- `apps/server/src/adapters/http/journal.routes.ts` — `journalRoutes(getJournal)` → `GET /journal/:calendarId`; 404 on null, 500 on err, `journalResponse.parse()` at boundary (MCP-02); T-03-14/15/16 mitigations
- `apps/server/src/adapters/http/journal.routes.test.ts` — 7 tests: 200+ordered, 404 unknown, 200+empty, 500 err, MCP-02 schema contract, calendarId passthrough, T-03-16 no DB-error leakage

Files modified:
- `apps/server/src/main.ts` — build `calendarSnapshotsRepo` + `legObsRepo` + `getJournal` + `getLiveGreeks` use-cases as named consts (plan 07 will inject getLiveGreeks into MCP router); mount `app.route("/api", journalRoutes(getJournal))`

Red commit: `36f6ab6` — `test(03-06): journal HTTP route tests (RED)`
Green commit: `89995a4` — `feat(03-06): journal HTTP route + server wiring (GREEN)`

## Verification Evidence

```
bun run typecheck    → exit 0 (tsc --build --force)
bun run lint         → exit 0 (no errors; 2 pre-existing warnings about legacy selector syntax)
bunx vitest run --project "@morai/contracts" "@morai/core" "@morai/server"
  → 22 test files, 237 tests, all PASSED
bunx vitest run --project "packages/adapters" (memory only)
  → getLatestLegObs memory tests: 5/5 PASS
  → getLatestLegObs Postgres contract tests: 3/3 PASS (Docker available)
git log --grep="^test(03-06):" → 3 RED commits (7ec7a2e, 5355f32, 36f6ab6)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 UUID regex: test UUIDs were non-RFC-4122 format**
- **Found during:** Task 1 GREEN phase (first test run)
- **Issue:** Zod v4 uses a stricter RFC 4122 UUID regex. `00000000-0000-0000-0000-000000000001` fails Zod v4 validation (only nil `00000000-0000-0000-0000-000000000000` passes alongside standard UUIDs).
- **Fix:** Updated all test fixtures to use valid RFC 4122 v4-style UUIDs (`550e8400-e29b-41d4-a716-446655440001/2`).
- **Files modified:** `journal.test.ts`, `getJournal.test.ts`, `getLiveGreeks.test.ts`
- **Commit:** included in GREEN commit d851943

**2. [Rule 1 - Bug] Type assertions in getLiveGreeks.test.ts**
- **Found during:** Task 3 lint run
- **Issue:** `FRONT_OCC as string` in test created ESLint `consistent-type-assertions` errors. `FRONT_OCC` is already `OccSymbol` (branded string from `formatOccSymbol`).
- **Fix:** Changed `makeLegSnapshot` to accept `OccSymbol` directly; removed the `as` casts.
- **Files modified:** `getLiveGreeks.test.ts`
- **Commit:** included in GREEN commit 89995a4

### Pre-existing Postgres Contract Flakiness (Not Caused by Plan 06)

The Postgres testcontainers suite for `leg-observations.contract.ts` has pre-existing cross-test contamination failures (`re-persisting the same rows adds zero rows` returns wrong count, `large batch` count mismatch). These are flaky — different tests fail on different runs. Root cause: `beforeEach` resets `observationTime` but the shared Postgres container retains rows from prior test runs in the same `vitest run` session.

These failures pre-date plan 06 and are in scope for a future isolation fix. Added to deferred-items log.

## Stubs

None — no hardcoded empty values or placeholders in production code paths.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: query-param | apps/server/src/adapters/http/journal.routes.ts | `:calendarId` path param flows to `readJournal(calendarId)` — Drizzle parameterized query in the adapter (T-03-15 mitigated) |

Existing threat model T-03-14/15/16/17 covers the new route surface.

## Self-Check: PASSED

All created files exist on disk. All 6 task commits verified in git log. No missing items.
