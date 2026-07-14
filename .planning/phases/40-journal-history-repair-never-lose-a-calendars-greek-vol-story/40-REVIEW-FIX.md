---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
fixed_at: 2026-07-14T04:34:00Z
review_path: .planning/phases/40-journal-history-repair-never-lose-a-calendars-greek-vol-story/40-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 40: Code Review Fix Report

**Fixed at:** 2026-07-14T04:34:00Z
**Source review:** .planning/phases/40-journal-history-repair-never-lose-a-calendars-greek-vol-story/40-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02 — Info out of scope per fix policy)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: `healSnapshot`'s INSERT branch has no conflict guard — concurrent heal-writes crash with an unhandled unique-violation

**Files modified:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts`,
`packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts`,
`packages/adapters/src/__contract__/calendar-snapshots.contract.ts`
**Commit:** `d588a9f`
**Applied fix:** Mirrored `persistSnapshot`'s `.onConflictDoNothing()` idiom in `healSnapshot`'s
INSERT branch. On a lost race (0 rows returned from the conflict-safe insert), the code re-reads
the row for `(calendar_id, time)` and applies the exact same fill-only gap-check/UPDATE decision
the pre-existing `existing !== undefined` branch already used — no new gap predicate, `isGapRow`
reused verbatim.

A plain `Promise.all([healSnapshot(a), healSnapshot(b)])` proxy against local Postgres did not
reliably reproduce the TOCTOU (round trips complete too fast to interleave two independent
transactions), so a deterministic regression test was added: an uncommitted "blocker"
transaction inserts the row directly and stays open until `healSnapshot`'s own SELECT has run,
forcing the exact race window the review described. This test failed for the right reason
pre-fix (`healResult.ok === false`, an unhandled unique-violation) and passes post-fix. The
originally-specified `Promise.all` observable-contract test was also added to the shared
contract suite and runs against both the Postgres (testcontainers) and memory twins — 79 tests
pass in that suite.

### WR-01: The shared rebuild engine has no batching/time-budget guard for unbounded windows

**Files modified:** `packages/core/src/journal/application/rebuildCalendarHistory.ts` (+test),
`packages/core/src/journal/application/selfHealJournal.ts` (+test),
`packages/core/src/journal/application/repairJournalHistory.ts` (+test),
`packages/core/src/journal/application/registerOpenCalendars.ts` (+test),
`apps/worker/src/handlers/self-heal-journal.test.ts`,
`apps/worker/src/repair-journal-history.ts`
**Commit:** `8518c32`
**Applied fix:** Implemented option (b)-lite from the review's fix guidance: rather than
requiring `calendarId` for `trigger_job`'s `repair-journal-history` (option a), made the shared
rebuild engine resilient to per-slot `healSnapshot` errors. `rebuildCalendarHistory`'s loop now
records a failed slot in an additive `errorCount` field on `RebuildCoverage` and continues to
the remaining slots, instead of returning `err(...)` and abandoning the whole calendar's
rebuild. The three consumers named in the review were adjusted:
- `selfHealJournal` aggregates `errorCount` across calendars into its returned `RebuildCoverage`.
- `repairJournalHistory` surfaces `errorCount` per calendar on the new `CalendarRepairReport`
  field; the operator CLI (`repair-journal-history.ts`) prints it when nonzero.
- `registerOpenCalendars`' on-register backfill already treated a *total* rebuild failure as
  non-fatal (`backfilledSlots: null`); it now inherits the fix for free — a single colliding
  slot no longer nulls out the whole backfill count, since `rebuildCalendarHistory` itself
  absorbs that error internally. Its doc comment was updated to describe the new behavior
  (verified with a dedicated regression test proving no source change was needed there).

`resolveLegObservationForSlot` failures still abort immediately and were left untouched — that
is a data-fetch problem, not a benign per-slot write race. No batching/time-budget system was
added (explicitly out of scope per the fix instructions); `trigger_job`'s "all" scope for
`repair-journal-history` remains unbounded, with the CLI as the sanctioned unbounded-repair path.

### WR-02: Stale "known limitation" doc comment in `registerOpenCalendars.ts`

**Files modified:** `packages/core/src/journal/application/registerOpenCalendars.ts`
**Commit:** `7a17430`
**Applied fix:** Verified against current code (`packages/adapters/src/postgres/repos/fills.ts`)
that `calendarLegSymbols` still derives front+back occSymbol from a single stored root and was
not touched by Phase 40's HIST-01 fix. Narrowed the comment to cite that path specifically, and
removed the now-inaccurate claim about `calendars.ts getOpenCalendarLegs` — confirmed that
`resolveRootCandidates` already fixed that call site (and `resolveLegSnapshot`/
`resolveLegObservationForSlot`) to try both candidate roots per leg. Comment-only change, no
behavior change.

## Skipped Issues

None — all in-scope findings were fixed.

---

**Verification (after all three fixes):**
- `bun run test` on the affected suites (`calendar-snapshots.contract.test.ts` for both the
  Postgres and memory twins, `packages/core/src/journal/**`, `apps/worker/src/handlers/**`,
  `apps/worker/src/repair-journal-history.ts`, `apps/worker/src/register-open-calendars-cli.ts`):
  all green (570+ tests across the targeted run; 667 across the broader superset that includes
  the adapter contract suites).
- `bun run typecheck` (`tsc --build --force`, full workspace, all 8 project references): no
  errors.
- `eslint .` (full repo): no errors.

_Fixed: 2026-07-14T04:34:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
