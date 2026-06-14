---
phase: 03-calendar-journal-mvp
plan: "01"
subsystem: journal-core-types
tags: [types, ports, domain, tdd, foundation]
dependency_graph:
  requires: []
  provides:
    - "Extended Calendar domain type (strike, optionType, frontExpiry, backExpiry, qty, openNetDebit, status, closedAt, notes)"
    - "CalendarNotFound / CalendarAlreadyClosed error variants"
    - "9 new driven-port types: ForRegisteringCalendar, ForListingCalendars, ForGettingCalendarById, ForClosingCalendar, ForGettingOpenCalendarLegs, ForResolvingLegSnapshot, ForPersistingSnapshot, ForReadingJournal, ForReadingLatestLegObs"
    - "LegSnapshot and SnapshotRow domain types"
    - "Exported calendarDte(now, expiry): number helper with unit coverage"
    - "optionType column added to schema.ts calendars table (Drizzle definition; SQL migration in plan 04)"
  affects:
    - "packages/adapters/src/postgres/repos/calendars.ts (getOpenCalendars now returns full Calendar)"
    - "packages/adapters/src/memory/calendars.ts (seedOpenCalendar accepts full Calendar)"
    - "packages/adapters/src/__contract__/calendars.contract.ts (seed type updated)"
tech_stack:
  added: []
  patterns:
    - "ForVerbingNoun function-type ports (hexagonal-ddd.md convention)"
    - "Result<T,E> for all fallible operations"
    - "Readonly fields on all domain types"
    - "TDD red→green (test commit before implementation)"
key_files:
  created:
    - "packages/core/src/journal/domain/dte.test.ts (calendarDte tests added to existing file)"
  modified:
    - "packages/core/src/journal/application/ports.ts"
    - "packages/core/src/journal/domain/dte.ts"
    - "packages/core/src/journal/index.ts"
    - "packages/adapters/src/postgres/schema.ts"
    - "packages/adapters/src/postgres/repos/calendars.ts"
    - "packages/adapters/src/memory/calendars.ts"
    - "packages/adapters/src/__contract__/calendars.contract.ts"
decisions:
  - "Added optionType to schema.ts (calendars table) in Plan 01 so adapters compile against extended Calendar type; the actual SQL migration (ALTER TABLE) is deferred to plan 04 per D-01"
  - "calendarDte uses Date.UTC floored math (86_400_000 ms/day) — identical to the existing private helper in fetchChain.ts, now exported from dte.ts for snapshot use"
  - "seedOpenCalendar signature changed from minimal {id,underlying,openedAt} to full Calendar type — enables contract tests to seed realistic data"
metrics:
  duration_minutes: 6
  completed_date: "2026-06-14"
  tasks_completed: 2
  files_modified: 7
---

# Phase 03 Plan 01: Calendar Types Foundation Summary

Extended Calendar domain type and exported all new Phase 3 port contracts — interface-first foundation so all downstream use-cases (register, list, close, snapshot, journal, targeted-fetch, live-greeks) compile against a stable contract.

## What Was Built

### Task 1: Extended Calendar type + 11 new port types (feat b4bb654)

`packages/core/src/journal/application/ports.ts`:
- Replaced the Phase 1 minimal `Calendar{id,underlying,openedAt}` with the full Phase 3 shape carrying `strike` (×1000 int per D-02), `optionType` ("C"|"P" per D-01), `frontExpiry`, `backExpiry`, `qty`, `openNetDebit`, `status`, `openedAt`, `closedAt`, `notes`
- Added `CalendarNotFound` and `CalendarAlreadyClosed` domain error variants
- Added `ForRegisteringCalendar`, `ForListingCalendars`, `ForGettingCalendarById`, `ForClosingCalendar`, `ForGettingOpenCalendarLegs`
- Added `LegSnapshot` type (mark, underlyingPrice, ivRaw, bsm* string fields per D-06 NaN convention)
- Added `ForResolvingLegSnapshot`, `SnapshotRow` (18-column journal row), `ForPersistingSnapshot`, `ForReadingJournal`, `ForReadingLatestLegObs`

### Task 2: calendarDte helper + index.ts re-exports (TDD: test 9752cbe, feat 8e9d398)

`packages/core/src/journal/domain/dte.ts`:
- Exported `calendarDte(now: Date, expiry: Date): number` — UTC-floored calendar-day count clamped at 0, using `Date.UTC()` math to avoid timezone/DST drift
- Implementation mirrors the existing private helper in `fetchChain.ts` exactly

`packages/core/src/journal/index.ts`:
- Re-exports all 13 new Phase 3 types from `ports.ts`
- Re-exports `calendarDte` alongside existing `computeT`/`isThirdFriday`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapter files broke on Calendar type extension**
- **Found during:** Task 1 (typecheck run after extending Calendar)
- **Issue:** `packages/adapters/src/postgres/repos/calendars.ts` and `packages/adapters/src/memory/calendars.ts` created Calendar objects with only 3 fields — now incompatible with the 11-field type
- **Fix:** Updated both adapters to select/map all fields; updated `MemoryCalendarsRepo.seedOpenCalendar` to accept the full Calendar type; updated contract test `seedOpenCalendar` to pass a full Calendar fixture
- **Additional fix:** Added `optionType: contractTypeEnum("option_type").notNull()` to `schema.ts` `calendars` table so Drizzle knows the column exists (the SQL migration is Plan 04's job)
- **Files modified:** `packages/adapters/src/postgres/schema.ts`, `packages/adapters/src/postgres/repos/calendars.ts`, `packages/adapters/src/memory/calendars.ts`, `packages/adapters/src/__contract__/calendars.contract.ts`
- **Commits:** b4bb654

## Known Stubs

None — this plan defines types only. No stubs or placeholder data flows to any rendering surface.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes beyond what the plan's threat model covers (T-03-01: `optionType`/`strike` typed as literal unions, cannot widen to string; T-03-SC: no new packages installed).

## Self-Check: PASSED

- FOUND: packages/core/src/journal/application/ports.ts
- FOUND: packages/core/src/journal/domain/dte.ts
- FOUND: packages/core/src/journal/domain/dte.test.ts
- FOUND: packages/core/src/journal/index.ts
- COMMIT FOUND: b4bb654 (Task 1)
- COMMIT FOUND: 9752cbe (RED test)
- COMMIT FOUND: 8e9d398 (Task 2 GREEN + index)
