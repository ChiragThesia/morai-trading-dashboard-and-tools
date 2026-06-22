---
phase: 05-jobs-fill-rebuild-integrity
plan: 01
subsystem: journal-foundation
tags: [docs-first, schema, domain-types, ports, tdd-wave0, fill-pairing]
dependency_graph:
  requires: []
  provides:
    - calendar_events schema declaration (calendarEvents pgTable + calendarEventTypeEnum)
    - orphan_fills schema declaration (orphanFills pgTable)
    - calendars.entryThesis nullable column
    - CalendarEvent domain ADT + CalendarEventType union
    - RawFill + AggregatedFill domain types
    - fill-pairing signatures (classifyFill/aggregatePartialFills/computePnl/detectRoll/hashFillIds)
    - 8 new driven ports in journal/application/ports.ts
    - syncFills / rebuildJournal / refreshTokens use-case stubs
    - 3 handler stubs (sync-fills, refresh-tokens, rebuild-journal)
    - 9 Wave-0 failing test stubs (RED baseline)
  affects:
    - 05-02 (migration needs schema declarations)
    - 05-03 (implements fill-pairing function bodies)
    - 05-05 (implements refreshTokens use-case)
    - 05-07 (implements syncFills use-case)
    - 05-08 (implements rebuildJournal use-case)
tech_stack:
  added: []
  patterns:
    - docs-before-architecture (workflow.md requirement)
    - TDD RED baseline (Wave-0 stubs with throwing bodies)
    - ForVerbingNoun port naming convention
    - pgEnum + pgTable with enableRLS()
    - fillIdsHash varchar(64) UNIQUE for SHA-256 idempotency
key_files:
  created:
    - docs/architecture/data-model.md (updated)
    - docs/architecture/jobs.md (updated)
    - packages/adapters/src/postgres/schema.ts (extended)
    - packages/core/src/journal/domain/calendar-event.ts
    - packages/core/src/journal/domain/fill-pairing.ts
    - packages/core/src/journal/application/syncFills.ts
    - packages/core/src/journal/application/rebuildJournal.ts
    - packages/core/src/brokerage/application/refreshTokens.ts
    - apps/worker/src/handlers/sync-fills.ts
    - apps/worker/src/handlers/refresh-tokens.ts
    - apps/worker/src/handlers/rebuild-journal.ts
    - packages/core/src/journal/domain/fill-pairing.test.ts
    - packages/core/src/journal/application/syncFills.test.ts
    - packages/core/src/journal/application/rebuildJournal.test.ts
    - packages/core/src/brokerage/application/refreshTokens.test.ts
    - apps/worker/src/handlers/sync-fills.test.ts
    - apps/worker/src/handlers/refresh-tokens.test.ts
    - apps/worker/src/handlers/rebuild-journal.test.ts
    - packages/adapters/src/__contract__/calendar-events.contract.ts
    - packages/adapters/src/__contract__/orphan-fills.contract.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/brokerage/application/ports.ts
    - packages/core/src/brokerage/index.ts
    - packages/core/src/index.ts
decisions:
  - fillIdsHash as varchar(64) UNIQUE — exactly SHA-256 hex width (RESEARCH Pitfall 7)
  - entryThesis added to calendars table (not per-event) — simpler query surface (D-07 / RESEARCH Open Question 2)
  - ForRefreshingToken re-exported from brokerage ports for use by refreshTokens use-case
  - Wave-0 RED stubs use dynamic import() for use-cases not yet created — allows test files to compile before implementations exist
metrics:
  duration: 14 min
  completed: "2026-06-21T21:39:49Z"
  tasks: 3
  files: 25
---

# Phase 05 Plan 01: Docs-First Foundation Summary

Established the typed + documented foundation for Phase 5 in one Wave-1 plan: docs updated first (architecture rule), then Drizzle schema extended, domain ADTs declared, driven ports added, and 9 Wave-0 failing test stubs created as the RED baseline for downstream TDD plans.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Docs-first: data-model.md + jobs.md | 7bc7c24 | DONE |
| 2 | Extend schema.ts | 9319ae5 | DONE |
| 3 | CalendarEvent ADT, ports, fill-pairing signatures, 9 Wave-0 stubs | 868b3d2 (RED) + d1a1a7e (GREEN) | DONE |

## What Was Built

### Task 1 — Architecture Docs Updated (docs-before-architecture rule)

`docs/architecture/data-model.md` gained three new sections:
- `calendar_events` — L1 trade ledger (OPEN/CLOSE/ROLL events, fill_ids_hash UNIQUE idempotency key, per-leg JSON breakdown)
- `orphan_fills` — unmatched fill parking with reason (D-05)
- `calendars.entry_thesis` — nullable free-text hook (D-07)

`docs/architecture/jobs.md` job catalog updated:
- `snapshot-calendars` explicitly marked "chain-triggered only (NO cron)"
- `sync-fills` spec added: 10-min RTH, fillIdsHash dedupe, ROLL first-class
- `refresh-tokens` spec added: 04:00 ET, NO RTH gate, per-app independence (D-13), proactive 7-day expiry warning (D-14)
- `rebuild-journal` spec added: on-demand only, delete-then-reinsert, calendarId-scoped

### Task 2 — schema.ts Extended

Three additions to `packages/adapters/src/postgres/schema.ts`:
- `calendarEventTypeEnum` — pgEnum("calendar_event_type", ["OPEN","CLOSE","ROLL"]) — additive
- `calendarEvents` — pgTable with `fillIdsHash varchar(64).notNull().unique()` (SHA-256 idempotency, T-05-01), `.enableRLS()`
- `orphanFills` — pgTable with `fillId uuid().primaryKey()`, `.enableRLS()`
- `calendars.entryThesis` — nullable text column added to existing table (non-destructive)

No migration applied here — deferred to 05-02 [BLOCKING].
packages/adapters typecheck: 0 errors.

### Task 3 — Domain ADTs, Ports, Signatures, and 9 Wave-0 Stubs

**Production types/signatures (GREEN commit d1a1a7e):**
- `calendar-event.ts`: `CalendarEventType`, `CalendarEvent`, `RawFill`, `AggregatedFill`
- `fill-pairing.ts`: 5 exported function signatures with `throw new Error("not implemented")` bodies
- `ports.ts` extended: 8 new driven ports (`ForStoringCalendarEvent`, `ForReadingCalendarEvents`, `ForDeletingCalendarEvents`, `ForReadingUnprocessedFills`, `ForReadingCalendarLegs`, `ForStoringOrphanFill`, `ForResettingCalendarAmounts`, `ForEnqueueingJob`)
- `syncFills.ts`, `rebuildJournal.ts`, `refreshTokens.ts`: use-case factory stubs
- `sync-fills.ts`, `refresh-tokens.ts`, `rebuild-journal.ts`: handler stubs (RTH gate logic pre-wired in sync-fills and refresh-tokens)

**Wave-0 RED test stubs (RED commit 868b3d2):**
All 9 stubs confirmed present and failing on "not implemented" assertion (not import errors):
1. `fill-pairing.test.ts` — fast-check property tests + examples for all 5 functions
2. `syncFills.test.ts` — matched fill → event; orphan parking; idempotency re-run
3. `rebuildJournal.test.ts` — ordered steps; error propagation; calendarId scoping
4. `refreshTokens.test.ts` — per-app independence; proactive expiry warning (D-13/D-14)
5. `sync-fills.test.ts` — RTH gate; delegation; throw on error
6. `refresh-tokens.test.ts` — no RTH gate; per-app isolation; warnExpirySoon log
7. `rebuild-journal.test.ts` — UUID payload; no RTH gate; error signaling
8. `calendar-events.contract.ts` — idempotency on fillIdsHash; ordered reads; scoped delete
9. `orphan-fills.contract.ts` — idempotency on fillId PK; read surface

## Verification Evidence

```
# Task 1: docs checks
rg -q "calendar_events" docs/architecture/data-model.md  ✓
rg -q "orphan_fills" docs/architecture/data-model.md     ✓
rg -q "entry_thesis" docs/architecture/data-model.md     ✓
rg -q "sync-fills" docs/architecture/jobs.md             ✓
rg -q "refresh-tokens" docs/architecture/jobs.md         ✓
rg -q "rebuild-journal" docs/architecture/jobs.md        ✓

# Task 2: schema typecheck
cd packages/adapters && bunx tsc --noEmit → 0 errors     ✓
fillIdsHash varchar(64).notNull().unique()                ✓
calendarEvents + orphanFills declared                     ✓
calendars.entryThesis nullable                            ✓

# Task 3: RED baseline confirmed
bun test fill-pairing.test.ts → fails "not implemented"   ✓
No module resolution errors                               ✓
All 9 Wave-0 stub files present                           ✓
packages/core typecheck: 0 errors                         ✓
apps/worker typecheck: 0 errors                           ✓
```

## Deviations from Plan

**None** — plan executed exactly as written.

Minor implementation detail: `refreshTokens.test.ts` required importing `SchwabTokens` from `refreshToken.ts` to correctly type the `ForRefreshingToken` mock returns (`ok(SchwabTokens)` vs `ok(void)`). The type surface from the plan was correct; the stub mocks just needed the exact return type. This is a test fixture detail, not a plan deviation.

## Known Stubs

All stubs are intentional Wave-0 RED baselines per the plan design. Each throwing stub has a designated plan that will implement it:

| Stub | Plan that implements it |
|------|------------------------|
| `classifyFill` / `aggregatePartialFills` / `computePnl` / `detectRoll` / `hashFillIds` | 05-03 |
| `makeSyncFillsUseCase` | 05-07 |
| `makeRebuildJournalUseCase` | 05-08 |
| `makeRefreshTokensUseCase` | 05-05 |
| Handler bodies (sync-fills, refresh-tokens, rebuild-journal) | 05-05 / 05-07 / 05-08 |

No stubs block the plan's goal (docs + type surface + RED baseline). All are intentional.

## Threat Flags

None — this plan is docs + type declarations + failing test stubs. No runtime data flow, no external input parsed, no DB writes. T-05-01 (fillIdsHash tampering) mitigated by `varchar(64).unique()` declared (enforced when migration applies in 05-02).

## TDD Gate Compliance

- RED commit: `868b3d2` (test(05-01): Wave-0 failing stubs — 9 files)
- GREEN commit: `d1a1a7e` (feat(05-01): production types + signatures — enables imports, tests fail on assertions)

RED gate: confirmed tests fail on "not implemented" (assertion error), NOT import/module-resolution errors.

## Self-Check: PASSED

All 4 task commits exist (7bc7c24, 9319ae5, 868b3d2, d1a1a7e).
All files verified present. Zero typecheck errors across packages/core, packages/adapters, apps/worker.
