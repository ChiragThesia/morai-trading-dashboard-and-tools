---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 06
subsystem: journal
tags: [use-case, worker-job, pg-boss, tdd, fill-only, self-heal]

# Dependency graph
requires:
  - phase: 40-05
    provides: "makeRebuildCalendarHistoryUseCase — the single HIST-02 derivation engine, RebuildWindow/RebuildCoverage types"
  - phase: 40-04
    provides: "ForResolvingLegObservationForSlot (as-of-slot read) + ForHealingSnapshot (fill-only write) Postgres adapters"
provides:
  - "makeSelfHealJournalUseCase(deps) — HIST-03: bounded-lookback (default 7 days), OPEN-calendars-only wrapper over the plan-05 rebuild engine, aggregating RebuildCoverage across every open calendar. Exported via @morai/core as ForRunningSelfHealJournal + SELF_HEAL_LOOKBACK_DAYS."
  - "self-heal-journal pg-boss job — sparse hourly cron (America/New_York, no RTH gate), thin handler with an optional Zod-parsed { lookbackDays } payload, wired at the worker composition root."
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-heal use-case composes two already-shipped ports (getOpenCalendars + rebuildCalendarHistory) with pure clock injection — zero new adapter code, mirrors the deps-factory idiom every other journal use-case follows (makeXxxUseCase(deps) -> driver port)."
    - "Handler payload with an optional numeric field must never forward an explicit `undefined` key when exactOptionalPropertyTypes is on — Zod's `.optional()` output type is `T | undefined` on a present key, which the strict TS config rejects for an optional property. Fix: build the call args conditionally (`lookbackDays !== undefined ? { lookbackDays } : {}`) so the key is omitted, not set to undefined."

key-files:
  created:
    - packages/core/src/journal/application/selfHealJournal.ts
    - packages/core/src/journal/application/selfHealJournal.test.ts
    - apps/worker/src/handlers/self-heal-journal.ts
    - apps/worker/src/handlers/self-heal-journal.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts

key-decisions:
  - "self-heal-journal is a SEPARATE job on a sparse hourly cron (not chain-triggered off snapshot-calendars), matching the dedicated-repair-job precedent (rebuild-journal, recompute-snapshot-pnl). Healing PAST slots is not time-of-day sensitive, a sparse cadence bounds scan cost, and the fill-only heal makes every re-run a free no-op on already-healed rows — chain-triggering after every 30-min cycle was considered and rejected as redundant scanning on the hot path (decision recorded in the plan's objective, Claude's discretion per CONTEXT.md)."
  - "The handler carries an unused `now: () => Date` dep despite never calling it in the body — matches the repo-wide convention every other no-RTH-gate thin handler follows (register-open-calendars, wipe-derived-fills, recompute-snapshot-pnl all do the same), kept for consistency rather than introduced as new complexity."

requirements-completed: [HIST-03]

coverage:
  - id: D1
    description: "selfHealJournal reads OPEN calendars only (getOpenCalendars) and calls rebuildCalendarHistory once per calendar with window = [now - lookbackDays, now]; lookbackDays defaults to SELF_HEAL_LOOKBACK_DAYS (7) and an explicit override is honored"
    requirement: "HIST-03"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/selfHealJournal.test.ts#makeSelfHealJournalUseCase (only-open, bounded-window default + override)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Per-calendar RebuildCoverage aggregates into one total (slotsConsidered/rowsHealed/honestGapSlots summed); a StorageError from either getOpenCalendars or any rebuild call short-circuits and propagates via err(...), never partially aggregating past the failure"
    requirement: "HIST-03"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/selfHealJournal.test.ts#makeSelfHealJournalUseCase (aggregation + error-propagation cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "self-heal-journal job registered on a sparse hourly cron (0 * * * *, America/New_York) with NO RTH gate; the handler is a thin adapter (array-guard -> Zod-parse optional lookbackDays -> call use-case -> throw on !ok) wired at the worker composition root from the plan-04/05 repos"
    requirement: "HIST-03"
    verification:
      - kind: unit
        ref: "apps/worker/src/handlers/self-heal-journal.test.ts (array-guard, invalid-payload throw, happy-path, err-throw, off-RTH run); apps/worker/src/schedule.test.ts (self-heal-journal queue/cron/work registration, 17-queue/9-schedule counts)"
        status: pass
    human_judgment: false
---

# Phase 40 Plan 06: Journal History Repair Self-Heal Job Summary

**`makeSelfHealJournalUseCase` — HIST-03's recurring self-heal: bounded-lookback (7-day default), OPEN-calendars-only wrapper over the plan-05 rebuild engine, run by a sparse hourly `self-heal-journal` pg-boss job with no RTH gate.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-14
- **Tasks:** 2
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- `makeSelfHealJournalUseCase(deps)` reads OPEN calendars via `getOpenCalendars` (which returns open calendars only — no closed calendar is ever touched) and calls the plan-05 `rebuildCalendarHistory` engine once per calendar with a window bounded to `[now - lookbackDays, now]`. `lookbackDays` defaults to the exported `SELF_HEAL_LOOKBACK_DAYS` constant (7) and an explicit override is honored. Per-calendar `RebuildCoverage` (`slotsConsidered`/`rowsHealed`/`honestGapSlots`) is summed into one aggregate total; a `StorageError` from either `getOpenCalendars` or any individual rebuild call short-circuits the loop and propagates via `err(...)`.
- Pure clock injection throughout (`now` from deps) — no `Date.now()` in core, matching architecture-boundaries.md §2. Exported through `@morai/core` (`makeSelfHealJournalUseCase`, `ForRunningSelfHealJournal`, `SelfHealJournalDeps`, `SelfHealJournalInput`, `SELF_HEAL_LOOKBACK_DAYS`) via the two-tier barrel convention (`journal/application/*.ts` → `journal/index.ts` → `core/index.ts`).
- `apps/worker/src/handlers/self-heal-journal.ts` — a thin adapter mirroring the register-open-calendars precedent: array-guard for pg-boss v12's possibly-undefined job element, Zod-parses an optional `{ lookbackDays?: number }` payload (invalid payload throws naming the job), calls the use-case, and throws on `!ok` so pg-boss retries. No RTH gate — the job repairs past slots via `leg_observations`, which is not time-of-day sensitive.
- `apps/worker/src/schedule.ts` registers the new `self-heal-journal` queue (createQueue phase), an hourly cron (`0 * * * *`, `America/New_York`, no RTH gate) in the schedule phase, and a `boss.work` registration in the handler phase; `AllHandlers` gained a `selfHealJournal` field. `schedule.test.ts` was updated to the new 17-queue/9-schedule/17-work counts (renamed `ALL_16_QUEUES` → `ALL_17_QUEUES`, `SCHEDULED_7` → `SCHEDULED_8`) and gained a dedicated cron-shape assertion for `self-heal-journal`, following the exact convention every prior job addition to this shared test file used.
- `apps/worker/src/main.ts` composes `rebuildCalendarHistoryUseCase` from `legObsRepo.resolveLegObservationForSlot` + `calendarSnapshotsRepo.healSnapshot` (both already-instantiated plan-04 Postgres repos), then `selfHealJournalUseCase` from `calendarsRepo.getOpenCalendars` + the rebuild engine, then the handler — added to the `registerAllJobs` handlers map and the boot log message (16→17 queues, 7→8 scheduled jobs).

## Task Commits

Each task was committed atomically (TDD RED confirmed then GREEN for both):

1. **Task 1: selfHealJournal use-case — bounded-lookback wrapper over the rebuild engine (OPEN only)** - `6cb442d` (feat)
2. **Task 2: self-heal-journal handler + schedule registration + main.ts wiring** - `8a25a25` (feat)

## Files Created/Modified

- `packages/core/src/journal/application/selfHealJournal.ts` - `makeSelfHealJournalUseCase` factory + `ForRunningSelfHealJournal`/`SelfHealJournalDeps`/`SelfHealJournalInput` types + `SELF_HEAL_LOOKBACK_DAYS` constant
- `packages/core/src/journal/application/selfHealJournal.test.ts` - only-open, bounded-window (default + override), coverage aggregation, StorageError propagation (both ports) cases
- `packages/core/src/journal/index.ts` / `packages/core/src/index.ts` - re-export the new use-case + types through both barrel tiers
- `apps/worker/src/handlers/self-heal-journal.ts` - thin handler (array-guard, Zod-parsed optional payload, call use-case, throw on `!ok`), no RTH gate
- `apps/worker/src/handlers/self-heal-journal.test.ts` - array-guard, invalid-payload throw, empty/override payload pass-through, `err`-throw, off-RTH-run cases
- `apps/worker/src/schedule.ts` - `self-heal-journal` queue/cron/work registration; `AllHandlers.selfHealJournal`
- `apps/worker/src/schedule.test.ts` - updated queue/schedule counts (16→17 queues, 7→8 cron jobs) + new `self-heal-journal` cron-shape assertion
- `apps/worker/src/main.ts` - composition-root wiring (`rebuildCalendarHistoryUseCase` + `selfHealJournalUseCase` + handler), `registerAllJobs` call, boot log message

## Decisions Made

- **Separate sparse-cron job, not chain-triggered.** The plan's objective explicitly delegated "chained vs cron" to Claude's discretion (CONTEXT.md). Decision: a dedicated hourly cron (mirroring `rebuild-journal`/`recompute-snapshot-pnl`'s dedicated-repair-job precedent) rather than chain-triggering after every 30-min snapshot cycle. Healing past slots is not time-of-day sensitive, the sparse cadence bounds scan cost, and the fill-only heal makes every re-run a free no-op on already-healed rows — chain-triggering would have added redundant scanning to the hot snapshot-calendars → compute-analytics → compute-gex-snapshot → compute-picker → compute-exit-advice chain for no benefit.
- **Unused `now` dep kept in the handler deps type** for consistency with every other no-RTH-gate thin handler in this codebase (`register-open-calendars`, `wipe-derived-fills`, `recompute-snapshot-pnl` all declare it without using it in the body) — matching an established repo-wide convention rather than diverging for a marginal simplification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `exactOptionalPropertyTypes` rejected forwarding Zod's optional-field output directly**
- **Found during:** Task 2, typecheck after wiring the handler
- **Issue:** `z.object({ lookbackDays: z.number().optional() })`'s inferred output type is `{ lookbackDays?: number | undefined }` — Zod always widens an optional field's value type to include `undefined`, even under `exactOptionalPropertyTypes: true`. Passing `payloadResult.data` straight into `ForRunningSelfHealJournal` (whose `SelfHealJournalInput.lookbackDays?: number` forbids an explicit `undefined` value under the strict compiler flag) failed to typecheck.
- **Fix:** Build the use-case call args conditionally — `lookbackDays !== undefined ? { lookbackDays } : {}` — so the key is omitted entirely when absent, never set to `undefined`.
- **Files modified:** `apps/worker/src/handlers/self-heal-journal.ts`
- **Commit:** `8a25a25`

None of the plan's task shapes, port names, or file lists changed — both tasks otherwise executed exactly as written.

## Issues Encountered

None beyond the exactOptionalPropertyTypes fix above.

## User Setup Required

None — no external service configuration required. The new job runs on the existing pg-boss worker; no new environment variables or credentials.

## Next Phase Readiness

- `self-heal-journal` is live in `registerAllJobs` on an hourly cron — the next worker boot will register the queue/schedule/work automatically (idempotent, safe on every deploy).
- Full plan-level verification green: `bun run test -- packages/core/src/journal/application/selfHealJournal.test.ts apps/worker/src/handlers/self-heal-journal.test.ts` (12/12 pass across both files); `apps/worker/src/schedule.test.ts` 20/20 green after the queue-count updates; whole-repo `bun run typecheck` clean; whole-repo `bun run lint` clean (only pre-existing repo-wide `boundaries` config warnings, unrelated to these files); full workspace suite `bun run test` — 319 files, 3574 tests, all green.
- No blockers. Ready for 40-07 (operator CLI repair, unbounded window, per plan 05's `RebuildWindow` reuse).

## Self-Check: PASSED

- `packages/core/src/journal/application/selfHealJournal.ts` — FOUND
- `packages/core/src/journal/application/selfHealJournal.test.ts` — FOUND
- `apps/worker/src/handlers/self-heal-journal.ts` — FOUND
- `apps/worker/src/handlers/self-heal-journal.test.ts` — FOUND
- Commit `6cb442d` — FOUND in `git log --oneline`
- Commit `8a25a25` — FOUND in `git log --oneline`
- All plan-level `<verification>` commands re-run and passing: `selfHealJournal.test.ts` + `self-heal-journal.test.ts` green, `schedule.test.ts` green, `bun run typecheck` clean, `bun run lint` clean, full workspace suite green (319/319 files, 3574/3574 tests).

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*
