---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - packages/core/src/journal/domain/occ-root.ts
  - packages/core/src/journal/domain/rth-slot.ts
  - packages/core/src/journal/application/snapshotCalendars.ts
  - packages/core/src/journal/application/getLiveGreeks.ts
  - packages/core/src/journal/application/rebuildCalendarHistory.ts
  - packages/core/src/journal/application/selfHealJournal.ts
  - packages/core/src/journal/application/repairJournalHistory.ts
  - packages/core/src/journal/application/registerOpenCalendars.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/index.ts
  - packages/core/src/index.ts
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts
  - packages/adapters/src/postgres/repos/calendars.ts
  - packages/adapters/src/postgres/repos/leg-observations.ts
  - packages/adapters/src/memory/calendar-snapshots.ts
  - packages/adapters/src/memory/calendars.ts
  - packages/adapters/src/memory/leg-observations.ts
  - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
  - packages/adapters/src/__contract__/calendars.contract.ts
  - packages/adapters/src/__contract__/leg-observations.contract.ts
  - packages/contracts/src/jobs.ts
  - apps/worker/src/handlers/self-heal-journal.ts
  - apps/worker/src/handlers/repair-journal-history.ts
  - apps/worker/src/repair-journal-history.ts
  - apps/worker/src/register-open-calendars-cli.ts
  - apps/worker/src/schedule.ts
  - apps/worker/src/main.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: fixed
---

# Phase 40: Code Review Report

**Reviewed:** 2026-07-14
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

The phase's core invariants hold up under scrutiny: D-02 (rebuild reuses `computeLegPairMetrics`/`computeSnapshotPnl` verbatim, no reimplemented math), D-03 (both the Postgres and memory `healSnapshot` twins gate on the single locked `isGapRow` predicate from `domain/attribution.ts` — no second gap definition), D-04 (a slot only heals when BOTH legs resolve; otherwise it's counted as an honest gap, never fabricated), D-08 (the destructive trim flag is structurally unreachable through `trigger_job` — `triggerJobPayload` is a bare `z.object({calendarId})` with no `.passthrough()`, so Zod silently strips `trimOutsideWindow` before the HTTP route/MCP tool ever calls `enqueueJob`; the CLI is confirmed as the only path that can set it), and the DST-safety technique in `rth-slot.ts`/`enumerateRebuildSlots` is sound (continuous UTC-ms stepping + per-instant `Intl` offset re-derivation avoids the classic "fixed-offset drift across a DST boundary" bug).

The one real gap is concurrency, which the phase context specifically flagged as a risk area: `healSnapshot`'s Postgres implementation does a SELECT-then-branch INSERT/UPDATE inside a transaction, but the INSERT branch has no `onConflictDoNothing()` (unlike `persistSnapshot`, which does). Under READ COMMITTED, two concurrent `healSnapshot` calls that both see "no existing row" for the same `(calendar_id, time)` PK will both attempt the bare INSERT, and the loser hits the DB's composite-PK unique-violation — an unhandled `StorageError` that aborts the entire in-flight rebuild loop (`rebuildCalendarHistory.ts` returns early on the first `healResult.ok === false`, and `selfHealJournal.ts`/`repairJournalHistory.ts` propagate that abort up through their own per-calendar loops). This is exactly the self-heal-cron-vs-live-writer race the phase's own architecture is built to run concurrently, and there is no test — Postgres contract or otherwise — that exercises it (the memory twin can't reproduce it; it's single-threaded with no `await` between the check and the write).

Two secondary findings: the shared rebuild engine has no batching/time-budget guard, so `repair-journal-history`'s trigger_job "all" scope (or a very-late `register-open-calendars` backfill) can issue thousands of sequential DB round-trips in one pg-boss job invocation — the context doc explicitly flagged this as an open question ("17 calendars × full history — batching?") that the implementation doesn't answer. And a stale doc comment in `registerOpenCalendars.ts` still describes a "known limitation" that Phase 40's own `resolveRootCandidates` fix already closed for the paths it names.

## Critical Issues

### CR-01: `healSnapshot`'s INSERT branch has no conflict guard — concurrent heal-writes crash with an unhandled unique-violation

**File:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts:455-508` (the `healSnapshot` closure, specifically the `if (existing === undefined) { await tx.insert(calendarSnapshots).values(...) ; return; }` branch at line 489-492)

**Issue:** `healSnapshot` does a SELECT to check whether a row exists for `(calendar_id, time)`, then — if it doesn't — INSERTs. Under Postgres's default READ COMMITTED isolation, this is a classic TOCTOU: the SELECT does not lock a nonexistent row, so two concurrent transactions can both observe "no row" and both proceed to INSERT. The composite PK on `(time, calendar_id)` then rejects the second writer with a unique-constraint violation, which is caught by the generic `catch (e)` and returned as `err<StorageError>`. Contrast with `persistSnapshot` in the same file (line 62-98), which correctly uses `.onConflictDoNothing()` for exactly this reason.

This is not a theoretical race — it is the specific scenario the phase's own architecture creates on purpose: `self-heal-journal` runs on an hourly cron (`schedule.ts:213-218`) against a window that always includes "now" rounded to the current 30-min slot, while `snapshot-calendars` is chain-triggered roughly every 30 minutes during RTH and writes the SAME rounded slot time for the SAME calendar (`roundDownToRthSlot`, shared by both paths). The operator repair CLI (`repair-journal-history.ts`) is explicitly documented as runnable "anytime," including during RTH while the live writer is active. When the two collide on the exact same `(calendar_id, time)` key:

1. `healSnapshot` returns `err(StorageError)`.
2. `rebuildCalendarHistory`'s per-slot loop (`rebuildCalendarHistory.ts:147-154`) does `if (!healResult.ok) return err(healResult.error);` — the ENTIRE calendar's remaining slots in that invocation are abandoned, not just the colliding one.
3. That error propagates up through `selfHealJournal.ts:60-61` (`if (!rebuildResult.ok) return err(rebuildResult.error);`), which aborts the loop over ALL open calendars — a race on calendar A's current slot silently skips healing for every OTHER open calendar in that hourly run too.
4. The job handler (`self-heal-journal.ts:46-48` / `repair-journal-history.ts:53-55`) turns this into `throw new Error(...)`, and for the CLI (`apps/worker/src/repair-journal-history.ts:114-119`) it prints a hard failure with no before/after coverage report at all, even though most of the run's work likely already committed successfully.

No data is corrupted (the fill-only guarantee still holds for whichever writer wins), but the exact reliability goal of this phase — "keep the GREEK + Vol and all charts history... right now it gets lost" — is undermined by a background job that can fail outright under its own designed-in concurrency, with zero test coverage proving otherwise. The Postgres contract suite (`calendar-snapshots.contract.ts`) tests `healSnapshot`'s insert/update/no-op branches individually but never two concurrent calls against the same key, and the memory twin (`memory/calendar-snapshots.ts:228-237`) cannot exhibit this bug at all — it's synchronous with no await between `store.get` and `store.set`, so a Postgres-only regression test is the only way to catch this.

**Fix:** Mirror `persistSnapshot`'s idiom — make the INSERT branch conflict-safe, then fall through to the gap-check/UPDATE branch if a concurrent writer already claimed the row:

```typescript
if (existing === undefined) {
  const inserted = await tx
    .insert(calendarSnapshots)
    .values({ time: row.time, calendarId: row.calendarId, ...values })
    .onConflictDoNothing()
    .returning({ time: calendarSnapshots.time });
  if (inserted.length > 0) return; // we won the race
  // A concurrent writer beat us — re-read and apply the same fill-only decision.
  const [raced] = await tx
    .select()
    .from(calendarSnapshots)
    .where(and(eq(calendarSnapshots.calendarId, row.calendarId), eq(calendarSnapshots.time, row.time)));
  if (raced === undefined || !isGapRow(raced)) return;
}
```

(Or equivalently, collapse the two-step SELECT+branch into a single `INSERT ... ON CONFLICT (time, calendar_id) DO UPDATE ... WHERE <gap predicate>` if the `isGapRow` conditions can be expressed as a SQL `WHERE` fragment.)

## Warnings

### WR-01: The shared rebuild engine has no batching/time-budget guard for unbounded windows

**File:** `packages/core/src/journal/application/rebuildCalendarHistory.ts` (the `for (const slotAnchor of slots)` loop, lines 108-155), consumed unbounded by `repairJournalHistory.ts:99-103` (`scope: "all"`, window `[openedAt, closedAt ?? now]` per calendar) and by `registerOpenCalendars.ts:210-213` (on-register backfill, window `[openedAt, now]`)

**Issue:** `enumerateRebuildSlots`/the per-slot loop issues at least 4 sequential DB round-trips per 30-min slot per calendar (two `resolveLegObservationForSlot` calls, each doing a contracts join + an observations lookup, plus a `healSnapshot` transaction). `selfHealJournal`'s window is correctly bounded to 7 days (`SELF_HEAL_LOOKBACK_DAYS`), but two other call sites of the exact same engine are not bounded at all:

- `repairJournalHistory`'s `scope: "all"` rebuilds every calendar's FULL life window. `repair-journal-history` is one of `TRIGGERABLE_JOBS` and its `triggerJobBodyFor` entry (unlike `rebuild-journal`/`recompute-snapshot-pnl`) does NOT require a `calendarId` — by design, per the doc comment in `jobs.ts:21-25` ("calendarId optional, absent → all"). That means an operator or agent calling `trigger_job` with no `calendarId` runs the full 17-calendar, multi-week rebuild as a single pg-boss job invocation.
- `registerOpenCalendars`'s HIST-04 backfill uses `{ from: openedAt, to: now }` with no upper bound — a late-discovered position with an old `openedAt` triggers the same unbounded loop, and `register-open-calendars` is also `trigger_job`-reachable.

The phase's own context doc calls this out explicitly as an open question: `code_context` in `40-CONTEXT.md` lists "pg-boss: singletonKey dedup idiom; 900s handler budget... **batch big writes**" as a WATCH item, and the review invariants list repeats it verbatim ("900s handler budget on the unbounded repair (17 calendars × full history — batching?)"). No batching, chunking, or time-budget check was added anywhere in the plan-05 engine or its two unbounded consumers. A pg-boss-invoked "all" repair over enough history (thousands of round-trips) risks exceeding pg-boss's job expiration window, at which point pg-boss may mark the job failed/retryable while the original handler keeps running to completion in the background — compounding CR-01's race (two concurrent repair runs over the same rows) rather than just being slow.

The CLI path (`apps/worker/src/repair-journal-history.ts`) is NOT subject to this — it calls the use-case directly in a long-running `bun` process with no pg-boss budget, so it remains a safe escape hatch for large repairs. The gap is specifically the trigger_job/MCP-invoked "all" scope.

**Fix:** Either (a) require `calendarId` for `repair-journal-history` via `trigger_job` (mirroring `rebuild-journal`/`recompute-snapshot-pnl`'s `triggerJobBodyFor` refinement) and document the CLI as the only sanctioned "all" entry point, or (b) add a slot-count/time budget inside `rebuildCalendarHistory`'s loop that returns partial coverage and lets the caller resume, so a pg-boss-invoked run degrades gracefully instead of risking a mid-run timeout.

### WR-02: Stale "known limitation" doc comment in `registerOpenCalendars.ts`

**File:** `packages/core/src/journal/application/registerOpenCalendars.ts:29-37`

**Issue:** The header comment says: "the calendars table's `underlying` column is a single root string shared by BOTH legs (see... `calendars.ts getOpenCalendarLegs`, [which] derive[s] front+back occSymbol from ONE stored root)... this use-case stores the front leg's root... so the back leg's occSymbol will be mis-derived by the existing fill-matching/snapshot-resolution paths." This is no longer accurate for the paths it names: Phase 40's HIST-01 fix (`resolveRootCandidates`) already changed `getOpenCalendarLegs` (`packages/adapters/src/postgres/repos/calendars.ts:346-373`, and the memory twin) to build BOTH candidate-root symbols per leg, and `resolveLegSnapshot`/`resolveLegObservationForSlot` also try both roots. The comment's own citation is now self-contradicting with the current code it points at.

**Fix:** Update the comment to scope the residual limitation accurately (e.g., to `fills.ts`'s `calendarLegSymbols`, if that path genuinely still derives from a single stored root and wasn't touched by this phase) or remove the claim about `getOpenCalendarLegs` since HIST-01 already fixed that specific call site.

## Info

### IN-01: `computeCoverage`'s "days" metric groups by UTC calendar date

**File:** `packages/core/src/journal/application/repairJournalHistory.ts:64` (`row.time.toISOString().slice(0, 10)`)

**Issue:** Not a bug in practice — RTH (9:30am-4pm ET) always falls within a single UTC calendar day for US Eastern time (13:30-21:00 UTC at the widest), so this never miscounts days for real snapshot rows. Flagging only because grouping by UTC date is a general footgun pattern in a codebase whose memory records three prior local-vs-UTC Date bugs; worth a one-line comment noting why the UTC slice is safe here (RTH never crosses UTC midnight for this timezone), so a future edit that reuses this helper for a different market/timezone doesn't inherit the assumption silently.

**Fix:** Optional — add a comment, no code change needed.

---

## Fixes Applied

Scope: critical + warning findings (Info is out of scope per fix policy).

### CR-01: fixed — commit `d588a9f`

`healSnapshot`'s INSERT branch in `packages/adapters/src/postgres/repos/calendar-snapshots.ts`
now mirrors `persistSnapshot`'s `.onConflictDoNothing()` idiom: on a lost race it re-reads the
row and applies the same fill-only gap-check/UPDATE decision, instead of surfacing an unhandled
unique-violation.

RED→GREEN: a plain `Promise.all([healSnapshot(a), healSnapshot(b)])` proxy did not reliably
reproduce the race on local Postgres (round trips complete too fast to interleave), so the fix
was proven with a deterministic lock-based regression test — an uncommitted "blocker"
transaction holds the row open until `healSnapshot`'s own SELECT has run, forcing the exact
TOCTOU window. That test failed for the right reason pre-fix (`healResult.ok === false`) and
passes post-fix, alongside the originally-requested `Promise.all` observable-contract test, run
against both the Postgres (testcontainers) and memory twins.

Files: `packages/adapters/src/postgres/repos/calendar-snapshots.ts`,
`packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts`,
`packages/adapters/src/__contract__/calendar-snapshots.contract.ts`.

### WR-01: fixed — commit `8518c32`

`rebuildCalendarHistory`'s per-slot loop now records a `healSnapshot` error and continues
(`errorCount` on `RebuildCoverage`, additive) instead of aborting the whole calendar's rebuild.
`selfHealJournal` aggregates `errorCount` across calendars; `repairJournalHistory` surfaces it
per calendar on `CalendarRepairReport` and the operator CLI (`repair-journal-history.ts`) prints
it; `registerOpenCalendars`' on-register backfill already tolerated a total rebuild failure
non-fatally and now inherits the same per-slot resilience for free (`backfilledSlots` no longer
nulls out on one colliding slot) — its doc comment is updated to describe this. Chose option
(b)-lite per the fix guidance: `trigger_job`'s "all" scope stays unbounded (the CLI remains the
sanctioned unbounded-repair path); no time-budget system was added (out of scope for this
finding).

A `resolveLegObservationForSlot` failure still aborts immediately — that is a data-fetch
problem, not a benign per-slot write race, and was left untouched.

Files: `packages/core/src/journal/application/rebuildCalendarHistory.ts` (+test),
`packages/core/src/journal/application/selfHealJournal.ts` (+test),
`packages/core/src/journal/application/repairJournalHistory.ts` (+test),
`packages/core/src/journal/application/registerOpenCalendars.ts` (+test),
`apps/worker/src/handlers/self-heal-journal.test.ts`, `apps/worker/src/repair-journal-history.ts`.

### WR-02: fixed — commit `7a17430`

The `KNOWN LIMITATION` comment in `registerOpenCalendars.ts` narrowed to the path that
genuinely still derives front+back occSymbol from a single stored root:
`packages/adapters/src/postgres/repos/fills.ts`'s `calendarLegSymbols` (and its memory twin),
confirmed unchanged by HIST-01. The claim about `calendars.ts getOpenCalendarLegs` was removed
— `resolveRootCandidates` already fixed that call site (and `resolveLegSnapshot`/
`resolveLegObservationForSlot`) to try both candidate roots per leg.

Files: `packages/core/src/journal/application/registerOpenCalendars.ts` (comment only, no
behavior change).

### Verification

- `bun run test` on the affected suites (`calendar-snapshots.contract.test.ts` ×2 twins,
  `packages/core/src/journal/**`, `apps/worker/src/handlers/**`,
  `apps/worker/src/repair-journal-history.ts`, `apps/worker/src/register-open-calendars-cli.ts`):
  570+ tests green.
- `bun run typecheck` (`tsc --build --force`, full workspace): no errors.
- `eslint .` (full repo): no errors.

---

_Reviewed: 2026-07-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fixed: 2026-07-14_
_Fixer: Claude (gsd-code-fixer)_
