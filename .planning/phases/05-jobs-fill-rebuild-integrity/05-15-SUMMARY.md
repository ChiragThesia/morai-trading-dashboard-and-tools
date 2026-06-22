---
phase: 05-jobs-fill-rebuild-integrity
plan: 15
subsystem: database
tags: [drizzle, postgres, testcontainers, fill-pairing, calendar-events, idempotency, hexagonal]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: "fills data-path (syncFills/rebuildJournal), calendar_events ledger, in-memory twins, shared contract suites"
provides:
  - "fills.processed_at column + ForMarkingFillsProcessed port — explicit per-fill processed tracking (WR-A2)"
  - "ForResettingFillsProcessedForCalendar port — rebuild un-marks a calendar's fills so the scoped re-pair re-reads them"
  - "readUnprocessedFills = WHERE processed_at IS NULL AND id NOT IN orphan_fills (no unbounded re-pair, no partial-fill double-count)"
  - "CalendarEvent.rollOpenDebit/rollCloseCredit + calendar_events columns — structured ROLL split (WR-A1)"
  - "recomputeCalendarAmounts sums by eventType (OPEN/CLOSE/ROLL split) — a calendar with a ROLL reconciles after rebuild (SC5)"
  - "Full-shape in-memory MemorySeedEvent — twin can model a ROLL; twin/Postgres recompute parity (WR-A4)"
affects: [05-16 property tests, re-review-3, journal reconciliation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit per-row processed tracking (processed_at) replaces inferred orphan-only exclusion"
    - "Structured ROLL components persisted as dedicated columns (not re-parsed free JSON) for deterministic, auditable recompute"
    - "rebuild delete-scope == sync-scope: deleting events un-marks their fills so the scoped re-pair is faithful"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0006_fills_processed_at.sql
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/application/syncFills.ts
    - packages/core/src/journal/application/rebuildJournal.ts
    - packages/core/src/journal/domain/calendar-event.ts
    - packages/adapters/src/postgres/repos/fills.ts
    - packages/adapters/src/postgres/repos/calendar-events.ts
    - packages/adapters/src/memory/fills.ts
    - packages/adapters/src/postgres/schema.ts

key-decisions:
  - "WR-A2 exposed a rebuild idempotency break (deleted events' fills stay processed → scoped re-pair reads nothing). Added ForResettingFillsProcessedForCalendar + a rebuild step to un-mark the calendar's leg fills (delete scope == sync scope)."
  - "ROLL split persisted as dedicated numeric columns (roll_open_debit/roll_close_credit), read by recompute — never re-parsed from legBreakdown JSON (T-05-15-03 auditability)."
  - "Both processed_at and the two ROLL columns ship in ONE additive migration 0006 (migration discipline; nullable ALTERs, hand-written to match 0004/0005 style)."

patterns-established:
  - "processed_at exclusion: a fill is processed iff processed_at IS NOT NULL OR parked in orphan_fills"
  - "eventType-summing recompute with exhaustive switch (switch-exhaustiveness-check) replacing sign-bucketing"

requirements-completed: [JRNL-01]

# Metrics
duration: 33min
completed: 2026-06-22
status: complete
---

# Phase 5 Plan 15: WR-A2 + WR-A1 + WR-A4 Data-Correctness Core Summary

**Explicit processed_at fill tracking (idempotent re-sync, no partial-fill double-count) plus eventType-aware ROLL recompute with persisted split components, so a calendar containing a roll reconciles after rebuild — both proven on the Postgres testcontainer adapter and the in-memory twin.**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-06-22T09:09:00Z
- **Completed:** 2026-06-22T09:30:00Z
- **Tasks:** 2
- **Files modified:** 16 (1 created)

## Accomplishments
- **WR-A2:** `fills.processed_at` column + `ForMarkingFillsProcessed` port; `syncFills` marks paired AND orphan-parked fills processed; `readUnprocessedFills` excludes processed + orphaned fills. Re-sync emits no duplicate event; a fill arriving in a later sync forms a NEW event covering only it (no double-count).
- **WR-A1:** `recomputeCalendarAmounts` now sums by `eventType` with persisted ROLL components (open-leg debit → `openNetDebit`, close-leg credit → `closeNetCredit`). A calendar with a ROLL reconciles after rebuild (SC5).
- **WR-A4:** the in-memory `MemorySeedEvent` carries the full event shape (eventType, legOccSymbol, rolledFromOccSymbol, fillIdsHash, ROLL components); the shared contract seeds a ROLL → twin/Postgres recompute parity.
- Contract suites ran against **real Postgres 16 via testcontainers** (container started, not skipped) and passed on both adapters.

## Task Commits

1. **Task 1: WR-A2 — processed_at tracking, port, repo + twin, syncFills mark-processed (+ rebuild reset)** - `23e0eef` (feat)
2. **Task 2: WR-A1 + WR-A4 — ROLL recompute by eventType (explicit components) + full-shape memory seedEvent** - `2173b7d` (feat)

_TDD: each task ran RED (failing tests shown for the right reason) then GREEN; committed at green with test+impl together (project convention — see TDD Gate Compliance)._

## Files Created/Modified
- `packages/adapters/src/postgres/migrations/0006_fills_processed_at.sql` - additive: `processed_at` + `roll_open_debit` + `roll_close_credit`
- `packages/adapters/src/postgres/migrations/meta/_journal.json` - idx-6 entry (tag `0006_fills_processed_at`)
- `packages/adapters/src/postgres/schema.ts` - `fills.processedAt`, `calendarEvents.rollOpenDebit/rollCloseCredit`
- `packages/core/src/journal/application/ports.ts` - `ForMarkingFillsProcessed`, `ForResettingFillsProcessedForCalendar`
- `packages/core/src/journal/index.ts` + `packages/core/src/index.ts` - barrel exports
- `packages/core/src/journal/domain/calendar-event.ts` - `rollOpenDebit`/`rollCloseCredit` fields
- `packages/core/src/journal/application/syncFills.ts` - mark-processed at every store/park site; set ROLL components, null on OPEN/CLOSE
- `packages/core/src/journal/application/rebuildJournal.ts` - reset-fills-processed step (delete scope == sync scope)
- `packages/adapters/src/postgres/repos/fills.ts` - `markFillsProcessed`, `resetFillsProcessedForCalendar`, processed_at filter, eventType-summing recompute
- `packages/adapters/src/memory/fills.ts` - twin: `processedIds`, mark/reset, widened `MemorySeedEvent`, eventType recompute, `readProcessedFillIds`
- `packages/adapters/src/postgres/repos/calendar-events.ts` - persist + read ROLL components
- `packages/adapters/src/__contract__/fills.contract.ts` - processed-tracking + ROLL recompute cases; widened `SeedEvent`
- `packages/adapters/src/__contract__/calendar-events.contract.ts` - ROLL component round-trip cases
- `packages/adapters/src/postgres/repos/fills.contract.test.ts` + `packages/adapters/src/memory/fills.contract.test.ts` - harness wiring (`markFillsProcessed`, `readProcessedFillIds`, ROLL seed columns)
- `apps/worker/src/main.ts` - wire `markFillsProcessed` + `resetFillsProcessedForCalendar`
- `apps/worker/src/journal-e2e.test.ts` - dep wiring for new ports
- `packages/core/src/journal/application/syncFills.test.ts` + `rebuildJournal.test.ts` - new RED/GREEN tests

## Decisions Made
See key-decisions in frontmatter. Most consequential: adding the rebuild reset-processed port — WR-A2 made paired fills permanently processed, which would have silently broken rebuild-journal (delete events → re-pair finds zero fills → empty rebuild). The fix keeps the rebuild use-case's documented "safe to repeat" contract true.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `ForResettingFillsProcessedForCalendar` + rebuild reset step**
- **Found during:** Task 1 (after wiring mark-processed, the journal-e2e SC5 rebuild-idempotency test failed: second rebuild produced 0 events → amounts recomputed to 0)
- **Issue:** The plan added processed_at tracking to syncFills but did not address rebuild-journal. Once a calendar's fills are marked processed, rebuild deletes its events then the scoped re-pair reads zero unprocessed fills → the rebuild emits nothing and SC5 reconciliation collapses to 0. This is a correctness regression the plan under-specified.
- **Fix:** New port `ForResettingFillsProcessedForCalendar(calendarId)` (clears processed_at for fills matching the calendar's leg OCC symbols, mirroring `readUnprocessedFillsForCalendar`); implemented on the Postgres repo + memory twin; `rebuildJournal` calls it between resetCalendarAmounts and the scoped sync (delete scope == sync scope); wired in worker main + e2e test. Added RED/GREEN tests in `rebuildJournal.test.ts` (ordering + error propagation) and updated the existing order assertions.
- **Files modified:** ports.ts, journal/index.ts, core/index.ts, rebuildJournal.ts, rebuildJournal.test.ts, postgres/repos/fills.ts, memory/fills.ts, apps/worker/src/main.ts, apps/worker/src/journal-e2e.test.ts
- **Verification:** journal-e2e SC5 (2 tests) green; rebuildJournal (10 tests) green; full suite 783 pass
- **Committed in:** `23e0eef` (Task 1 commit)

**2. [Rule 1 - Bug] Updated stale rebuildJournal order tests for the new step**
- **Found during:** Task 1 (the deviation above changed rebuild's step order)
- **Issue:** Pre-existing order-assertion tests asserted `[delete, reset, sync]` / `[delete, reset, sync, recompute]`; the new step inserts `resetProcessed` between reset and sync, and the deps type gained a required field.
- **Fix:** Added a `noopResetProcessed` ok-twin to non-asserting deps blocks, updated the two order assertions to include `resetProcessed`, and added an explicit error-propagation test.
- **Files modified:** packages/core/src/journal/application/rebuildJournal.test.ts
- **Verification:** rebuildJournal suite green (10 tests)
- **Committed in:** `23e0eef` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical, 1 bug — both consequences of the same WR-A2/rebuild interaction)
**Impact on plan:** Necessary for correctness — without the rebuild reset, WR-A2 would have broken rebuild-journal (the very flow the phase hardens). No scope creep; the addition is the natural completion of the processed-tracking model.

## Testcontainer Verification

The Postgres contract suites (`fills.contract` + `calendar-events.contract`) **ran against real Postgres 16 via testcontainers, not skipped** — the global setup logged "Postgres container started: postgres://test:test@localhost:..." on every run, and the per-adapter `describe.skipIf(!dbUrl)` blocks executed (44 + 18 cases). Migration 0006 was applied to the container by `runMigrations`. ROLL component round-trip and processed_at filtering were verified by SELECT against the live DB.

## TDD Gate Compliance

This plan is `type: tdd`. Each task followed RED → GREEN: failing tests were written first and run (output shown failing for the right reason — `markFillsProcessed is not a function`, `expected undefined to be null`, sign-bucketing recompute mismatch), then the implementation made them pass. Per project convention (Phase 3 lessons: executor commits at green with test+impl together rather than separate `test(...)`/`feat(...)` commits), each task is a single `feat` commit containing both the tests and the implementation. No separate RED commit exists; the RED step was performed and verified in-session before each GREEN.

## Issues Encountered
- The WR-A2/rebuild interaction (documented as Deviation 1) — caught by the existing journal-e2e SC5 idempotency test, fixed at root cause with a new port rather than a band-aid.

## User Setup Required
None - migration 0006 is additive (nullable columns); applied by the boot migrator / testcontainers. No live-DB push performed in this plan.

## Next Phase Readiness
- WR-A1, WR-A2, WR-A4 closed; data-correctness core ready for 05-16 fast-check property tests (no double-count, idempotent re-sync, ROLL reconciliation, UUID collision-freedom).
- Migration 0006 must be applied to the live DB before deploy (separate `bun run migrate` op).

## Self-Check: PASSED

- Created files exist: `0006_fills_processed_at.sql`, `05-15-SUMMARY.md`
- Commits exist: `23e0eef`, `2173b7d`
- Artifacts verified: `ForMarkingFillsProcessed` in ports (2), `processed_at`/isNull filter in fills.ts (4), `rollOpenDebit`/`roll_open_debit` in fills.ts (3), `eventType` recompute in fills.ts (3), `markFillsProcessed` wired in worker main (2), `processed_at` in migration (1)
- typecheck: clean · lint: clean (pre-existing boundaries v6 warnings only) · full suite: 82 files / 783 tests pass · testcontainer Postgres ran (not skipped)

---
*Phase: 05-jobs-fill-rebuild-integrity*
*Completed: 2026-06-22*
