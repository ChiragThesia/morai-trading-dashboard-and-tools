---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 07
subsystem: journal
tags: [use-case, worker-job, cli, pg-boss, tdd, fill-only, operator-repair]

# Dependency graph
requires:
  - phase: 40-05
    provides: "makeRebuildCalendarHistoryUseCase — the single HIST-02 derivation engine, RebuildWindow/RebuildCoverage types"
  - phase: 40-06
    provides: "self-heal-journal job wiring pattern (schedule.ts/main.ts state this plan extends); isGapRow reuse convention"
provides:
  - "makeRepairJournalHistoryUseCase(deps) — HIST-04: one/all-calendar operator repair orchestrator over the plan-05 rebuild engine, before/after coverage (rows/nonGapRows/days), opt-in trim (deleteSnapshotsOutsideWindow). Exported via @morai/core as ForRunningRepairJournalHistory."
  - "repair-journal-history pg-boss job (on-demand, no cron) — heal-only via trigger_job (calendarId optional, absent → all); trim is structurally unreachable through triggerJobPayload (T-40-15)."
  - "apps/worker/src/repair-journal-history.ts CLI — explicit --all (never a silent default), opt-in --trim, before/after coverage table printed to stdout."
  - "On-register backfill in makeRegisterOpenCalendarsUseCase — a newly-registered calendar backfills [openedAt, now] via the same rebuild engine, non-fatally."
affects: [40-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator repair filters the SAME listCalendars(undefined) read for both 'all' and single-scope requests — no separate ForGettingCalendarById dependency; \"all\" is unfiltered, a single scope is the list filtered to one matching id."
    - "Three consumers, one engine: rebuildCalendarHistoryUseCase is constructed ONCE in each composition root (apps/worker/src/main.ts, register-open-calendars-cli.ts) and passed by reference into selfHealJournalUseCase, repairJournalHistoryUseCase, and registerOpenCalendarsUseCase — never re-instantiated per consumer."
    - "Destructive-flag containment by schema, not by handler logic: triggerJobPayload (packages/contracts/src/jobs.ts) has no trimOutsideWindow field at all, so Zod's default unknown-key stripping makes the trim flag structurally unreachable through trigger_job — T-40-15 is enforced by the schema shape itself, not a runtime check in the handler."
  removed: []

key-files:
  created:
    - packages/core/src/journal/application/repairJournalHistory.ts
    - packages/core/src/journal/application/repairJournalHistory.test.ts
    - apps/worker/src/handlers/repair-journal-history.ts
    - apps/worker/src/handlers/repair-journal-history.test.ts
    - apps/worker/src/repair-journal-history.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/contracts/src/jobs.ts
    - packages/contracts/src/jobs.test.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts
    - packages/core/src/journal/application/registerOpenCalendars.ts
    - packages/core/src/journal/application/registerOpenCalendars.test.ts
    - apps/worker/src/register-open-calendars-cli.ts
    - apps/server/src/adapters/http/jobs.routes.test.ts

key-decisions:
  - "repairJournalHistory's 'single vs all' scope selection reuses ForListingCalendars(undefined) for BOTH cases (filtering client-side for a single id) rather than adding a ForGettingCalendarById dependency — matches the plan's own key_links (only ForListingCalendars named), and keeps the use-case to exactly the 4 ports the plan specified."
  - "The CLI's argv parser (parseRepairArgs) is exported but untested by a dedicated test file — the plan explicitly marks the CLI 'thin wiring, TDD-exempt' (tdd.md Scope: pure composition-root wiring), mirroring fix-pnl-reingest.ts's zero-test precedent; the parsing RULE itself (explicit --all, opt-in --trim) is covered indirectly by the fully-tested repairJournalHistory use-case it feeds."
  - "backfilledSlots on RegisteredCalendarSummary records rowsHealed (not slotsConsidered or honestGapSlots) — the count of rows actually written, which is what 'backfilled' means to an operator reading the CLI output."

requirements-completed: [HIST-04]

coverage:
  - id: D1
    description: "repairJournalHistory('all') enumerates every calendar (open+closed) via listCalendars(undefined); a single-calendarId scope repairs exactly the matching one; each target's before/after coverage (rows, non-gap rows via isGapRow, distinct days) is read via readJournal"
    requirement: "HIST-04"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/repairJournalHistory.test.ts (single-scope, all-scope, coverage cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Default run (trimOutsideWindow omitted) NEVER calls deleteSnapshotsOutsideWindow (D-08 heal-only); trimOutsideWindow=true calls it and reports the deleted count on the report"
    requirement: "HIST-04"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/repairJournalHistory.test.ts (heal-only default + trim opt-in cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The repair is triggerable in prod without psql: repair-journal-history is in TRIGGERABLE_JOBS with calendarId optional (absent → all); trim is never reachable through triggerJobPayload (no field for it); the CLI requires an explicit --all and gates deletion behind --trim, printing the deleted count"
    requirement: "HIST-04"
    verification:
      - kind: unit
        ref: "packages/contracts/src/jobs.test.ts + apps/worker/src/handlers/repair-journal-history.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "A newly-registered calendar's history backfills from openedAt via the SAME rebuild engine, non-fatally (a StorageError never fails registration; the summary records backfilledSlots: null); skipped-existing calendars are never backfilled"
    requirement: "HIST-04"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/registerOpenCalendars.test.ts (registered-triggers-backfill, rebuild-failure-non-fatal, skipped-not-backfilled cases)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-14
status: complete
---

# Phase 40 Plan 07: Journal History Repair Operator Path Summary

**`makeRepairJournalHistoryUseCase` — the operator repair orchestrator (HIST-04): one/all-calendar rebuild via the plan-05 engine with before/after coverage, heal-only by default and opt-in `--trim`, triggerable via `trigger_job` (heal-only, trim structurally unreachable) or a thin operator CLI — plus a non-fatal on-register backfill so late-registered calendars never lose their entry-day story.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-14
- **Tasks:** 3
- **Files modified:** 16 (5 created, 11 modified)

## Accomplishments

- `makeRepairJournalHistoryUseCase(deps)` (`packages/core/src/journal/application/repairJournalHistory.ts`) loops the target calendars — `"all"` enumerates every calendar (open + closed) via `listCalendars(undefined)`, a single scope filters that same list down to one matching id (no separate `ForGettingCalendarById` dependency). Per calendar: reads before-coverage via `readJournal` (`rows`/`nonGapRows` via `isGapRow`/`days` via distinct date), rebuilds `[openedAt, closedAt ?? now]` through the plan-05 `rebuildCalendarHistory` engine (which itself clamps to the real life window, D-08), conditionally trims (opt-in only — `deleteSnapshotsOutsideWindow` is NEVER called by default), then re-reads after-coverage. Returns a per-calendar `CalendarRepairReport`. 10 unit tests cover single/all scope, heal-only-never-deletes, trim-deletes-with-count, coverage computation, idempotent re-run, and StorageError propagation from all four composed ports.
- `apps/worker/src/handlers/repair-journal-history.ts` — a thin handler mirroring `self-heal-journal`'s shape: array-guard, Zod-parses `{ calendarId?: uuid, trimOutsideWindow?: boolean }`, calls the use-case with `scope = calendarId ?? "all"`, throws on `!ok`. No RTH gate. `"repair-journal-history"` is added to `TRIGGERABLE_JOBS` (`packages/contracts/src/jobs.ts`) with `calendarId` staying optional — `triggerJobPayload` carries no `trimOutsideWindow` field at all, so Zod's unknown-key stripping makes the destructive trim flag structurally unreachable via `trigger_job` (T-40-15), not just handler-level policy.
- `apps/worker/src/repair-journal-history.ts` — the operator CLI (`import.meta.main`, mirrors `fix-pnl-reingest.ts`'s composition-root pattern). `parseRepairArgs` requires an explicit `--all` or a single `calendarId` positional (never a silent default-to-all) plus an optional `--trim`; prints a per-calendar before/after coverage line and, when `--trim`, the deleted count; exits 1 with an "idempotent, safe to re-run" message on failure. TDD-exempt per the plan (thin composition-root wiring calling the fully-tested use-case) — matches the zero-test precedent of `fix-pnl-reingest.ts`.
- `schedule.ts` registers the `repair-journal-history` queue (createQueue + work, NO cron — on-demand only via `trigger_job` or the CLI); `AllHandlers` gained a `repairJournalHistory` field. `main.ts` composes `rebuildCalendarHistoryUseCase` ONCE (moved earlier in the file, before `registerOpenCalendarsUseCase`, since the on-register backfill now needs it too) and reuses that same instance for `selfHealJournalUseCase`, `repairJournalHistoryUseCase`, and the on-register backfill — one engine, three consumers.
- `makeRegisterOpenCalendarsUseCase` (`registerOpenCalendars.ts`) gained a `rebuildCalendarHistory` dependency: after each successful `registerCalendar` call, it backfills `[openedAt, now]` via the same engine. The backfill is non-fatal — a `StorageError` never fails the registration (the calendar is already persisted); the new `RegisteredCalendarSummary.backfilledSlots` field records `rowsHealed` on success or `null` on failure (re-runnable via self-heal or the repair CLI). Skipped-existing calendars are never backfilled. Both composition roots that construct this use-case (`apps/worker/src/main.ts` and the standalone `register-open-calendars-cli.ts`) were updated to wire the dependency.

## Task Commits

Each task was committed atomically (TDD RED confirmed then GREEN for all three):

1. **Task 1: repairJournalHistory orchestrator use-case (one/all, before/after coverage, opt-in trim)** - `d04c801` (feat)
2. **Task 2: repair-journal-history pg-boss job + CLI + TRIGGERABLE_JOBS** - `6530c89` (feat)
3. **Task 3: On-register backfill in registerOpenCalendars** - `b2170a8` (feat)

## Files Created/Modified

- `packages/core/src/journal/application/repairJournalHistory.ts` - `makeRepairJournalHistoryUseCase` factory + `ForRunningRepairJournalHistory`/`RepairJournalHistoryDeps`/`RepairJournalHistoryInput`/`RepairCoverage`/`CalendarRepairReport` types
- `packages/core/src/journal/application/repairJournalHistory.test.ts` - 10 cases: single-scope, all-scope, heal-only-default, trim-opt-in, coverage, idempotent-re-run, 4× StorageError-propagation
- `packages/core/src/journal/index.ts` / `packages/core/src/index.ts` - re-export the new use-case + types through both barrel tiers
- `apps/worker/src/handlers/repair-journal-history.ts` - thin handler (array-guard, Zod-parsed `{ calendarId?, trimOutsideWindow? }`, call use-case, throw on `!ok`), no RTH gate
- `apps/worker/src/handlers/repair-journal-history.test.ts` - array-guard, invalid-payload throw, empty-payload→"all", calendarId→scope, defensive-trim-forwarded, err-throw, off-RTH-run cases
- `apps/worker/src/repair-journal-history.ts` - CLI entry point (`import.meta.main`; `parseRepairArgs` + composition-root wiring + before/after coverage table)
- `packages/contracts/src/jobs.ts` / `packages/contracts/src/jobs.test.ts` - `"repair-journal-history"` added to `TRIGGERABLE_JOBS`; contract tests for optional-calendarId + trim-key-stripping
- `apps/worker/src/schedule.ts` / `apps/worker/src/schedule.test.ts` - `repair-journal-history` queue/work registration (no cron); `AllHandlers.repairJournalHistory`; queue count 17→18
- `apps/worker/src/main.ts` - `rebuildCalendarHistoryUseCase` construction moved earlier (before `registerOpenCalendarsUseCase`); `repairJournalHistoryUseCase` + handler wired; `registerOpenCalendarsUseCase` gains the backfill dep; boot log updated (17→18 queues)
- `packages/core/src/journal/application/registerOpenCalendars.ts` / `.test.ts` - `rebuildCalendarHistory` dep + `backfilledSlots` field on `RegisteredCalendarSummary`; 3 new tests (registered-triggers-backfill, rebuild-failure-non-fatal, skipped-not-backfilled); 8 pre-existing test call sites given a `noopRebuildCalendarHistory` stub
- `apps/worker/src/register-open-calendars-cli.ts` - standalone CLI wired with the same `rebuildCalendarHistoryUseCase` composition; printed line gained `backfilledSlots`
- `apps/server/src/adapters/http/jobs.routes.test.ts` - Rule 1 auto-fix (see below)

## Decisions Made

- **Single vs all scope share one `listCalendars(undefined)` read.** No `ForGettingCalendarById` dependency was added — the plan's own `key_links` named only `ForListingCalendars`, and filtering the already-fetched list client-side to one matching id is simpler than a second read path.
- **CLI stays TDD-exempt, per the plan's explicit call-out** ("thin wiring, TDD-exempt, but it calls the fully-tested Task-1 use-case") and the repo's own `fix-pnl-reingest.ts` precedent (zero tests for a composition-root script). `parseRepairArgs` is exported so it's inspectable, but has no dedicated test file.
- **`backfilledSlots` = `rowsHealed`**, not `slotsConsidered` or `honestGapSlots` — the count of rows the backfill actually wrote, matching what an operator reading CLI/handler output means by "backfilled."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `apps/server/src/adapters/http/jobs.routes.test.ts` hardcoded `TRIGGERABLE_JOBS` length assertion broke**
- **Found during:** Task 2, whole-workspace `bun run test` gate
- **Issue:** A pre-existing contract test in `apps/server` (sibling to `packages/contracts/src/jobs.test.ts`) asserted `expect(TRIGGERABLE_JOBS).toHaveLength(7)` — a hardcoded count that legitimately grows every time a job is added to `TRIGGERABLE_JOBS`, exactly what Task 2 did.
- **Fix:** Updated the length assertion to 8 and added a `toContain("repair-journal-history")` check, matching the file's own stated purpose ("guarantees the HTTP route and MCP tool share the same constants").
- **Files modified:** `apps/server/src/adapters/http/jobs.routes.test.ts`
- **Commit:** `b2170a8`

None of the plan's task shapes, port names, or file lists changed otherwise — all three tasks executed exactly as written.

## Issues Encountered

None beyond the hardcoded-length fix above.

## User Setup Required

None — no external service configuration required. The new job runs on the existing pg-boss worker; no new environment variables or credentials. The CLI (`apps/worker/src/repair-journal-history.ts`) requires the same `railway run` prod-env injection as `fix-pnl-reingest.ts`/`register-open-calendars-cli.ts` when run against prod — not exercised in this plan (the plan 08 gate owns the actual prod repair run).

## Next Phase Readiness

- The full HIST-04 operator repair path is live: `repairJournalHistory` (tested), `repair-journal-history` job (on-demand, heal-only via `trigger_job`), the CLI (`--all`/`--trim`), and the on-register backfill are all wired at the worker composition root.
- Full plan-level verification green: `bun run test -- packages/core/src/journal/application/repairJournalHistory.test.ts packages/core/src/journal/application/registerOpenCalendars.test.ts apps/worker/src/handlers/repair-journal-history.test.ts packages/contracts/src/jobs.test.ts apps/worker/src/schedule.test.ts` — 62/62 pass; whole-repo `bun run typecheck` clean; whole-repo `bun run lint` clean (only pre-existing repo-wide `boundaries` config warnings, unrelated); full workspace suite `bun run test` — 321 files, 3599 tests, all green.
- No blockers. Ready for 40-08 (the plan explicitly reserves the actual prod repair RUN — enqueuing `repair-journal-history` against the 17 existing calendars — for that gate, not executed here).

## Self-Check: PASSED

- `packages/core/src/journal/application/repairJournalHistory.ts` — FOUND
- `packages/core/src/journal/application/repairJournalHistory.test.ts` — FOUND
- `apps/worker/src/handlers/repair-journal-history.ts` — FOUND
- `apps/worker/src/handlers/repair-journal-history.test.ts` — FOUND
- `apps/worker/src/repair-journal-history.ts` — FOUND
- Commit `d04c801` — FOUND in `git log --oneline`
- Commit `6530c89` — FOUND in `git log --oneline`
- Commit `b2170a8` — FOUND in `git log --oneline`
- All plan-level `<verification>` commands re-run and passing: 5-file targeted suite 62/62 green, `bun run typecheck` clean, `bun run lint` clean, full workspace suite green (321/321 files, 3599/3599 tests).

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*
