---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 08
subsystem: database
tags: [drizzle, postgres, testcontainers, journal, rule-tags, rebuild-safety]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "enterRuleTag/exitRuleTag/rollRuleTag vocabulary + journal-rules contracts (plan 20-07)"
provides:
  - "calendar_event_annotations table (migration 0017) — no FK to calendar_events, RLS enabled, ships empty"
  - "makePostgresCalendarEventAnnotationsRepo / makeMemoryCalendarEventAnnotationsRepo — upsert + read-one + read-many-by-hash, contract-parity proven"
  - "rebuildJournal.test.ts regression guard pinning the D-09 no-coupling invariant"
affects: [20-09-read-usecase, 20-10-routes-mcp, 20-11-journal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local (pre-core-port) function-type aliases duplicated identically across the Postgres repo and memory twin files, pending 20-09's ForReadingAnnotations/ForWritingAnnotations core ports — a type-only swap later, no logic change"
    - "onConflictDoUpdate for editable-anytime storage (D-10), distinct from calendar-events' onConflictDoNothing idempotent-write pattern"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0017_calendar_event_annotations.sql
    - packages/adapters/src/postgres/migrations/meta/0017_snapshot.json
    - packages/adapters/src/postgres/repos/calendar-event-annotations.ts
    - packages/adapters/src/postgres/repos/calendar-event-annotations.contract.test.ts
    - packages/adapters/src/memory/calendar-event-annotations.ts
    - packages/adapters/src/memory/calendar-event-annotations.contract.test.ts
    - packages/adapters/src/__contract__/calendar-event-annotations.contract.ts
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - docs/architecture/stack-decisions.md
    - docs/architecture/data-model.md
    - packages/core/src/journal/application/rebuildJournal.test.ts

key-decisions:
  - "D24 added to stack-decisions.md: calendar_event_annotations is keyed by fill_ids_hash with NO foreign key to calendar_events, by design — rebuildJournal's delete-then-reinsert would either CASCADE-wipe or RESTRICT-break under a real FK (RESEARCH Pitfall 3)."
  - "Port types (CalendarEventAnnotation, UpsertAnnotation, ReadAnnotation, ReadAnnotationsByHashes) are defined LOCALLY in the Postgres repo file and duplicated in the memory twin, not imported from @morai/core — plan 20-09 (not yet executed) is the one that adds ForReadingAnnotations/ForWritingAnnotations to packages/core/application/ports.ts. The local shapes already match what 20-09 will formalize; wiring is a type-only swap."
  - "Generated migration 0017 via `bunx drizzle-kit generate` (confirms 0 FKs on the new table), then renamed the auto-generated file + updated the _journal.json tag to the plan's descriptive name (0017_calendar_event_annotations), matching the repo's existing convention for every prior migration (0008-0016)."
  - "The Task 3 regression guard is a pinning test, not a RED-driven one: rebuildJournal.ts's dependency shape (RebuildJournalDeps) has no field capable of reaching an annotations store, so the test is green on first run — it documents/locks the invariant rather than driving new production code."

patterns-established:
  - "calendar-event-annotations.ts (postgres + memory) + calendar-event-annotations.contract.ts mirror the calendar-events.ts / picker-snapshot.ts contract-parity structure exactly: a shared assertions file + two thin runner *.contract.test.ts files (memory always-on, postgres skipIf no Docker)."

requirements-completed: [RULE-01]

coverage:
  - id: D1
    description: "calendar_event_annotations table (migration 0017): fill_ids_hash varchar(64) PK, rule_tags text[], other_note text, updated_at timestamptz, RLS enabled, no FK to calendar_events, ships empty"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "rg -n REFERENCES calendar_events packages/adapters/src/postgres/migrations/0017_calendar_event_annotations.sql (no match, exit 1)"
        status: pass
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-event-annotations.contract.test.ts (testcontainers, migration 0017 applied)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Postgres repo (upsertAnnotation/readAnnotation/readAnnotationsByHashes) + in-memory twin at proven contract parity — insert-then-update round-trip, read-missing null, read-many subset"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-event-annotations.contract.ts (7 assertions x 2 impls = 14 tests, both green)"
        status: pass
    human_judgment: false
  - id: D3
    description: "rebuildJournal delete-then-reinsert regression guard: a recorded annotation survives unchanged (D-09)"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/rebuildJournal.test.ts#RULE-01/D-09: a fillIdsHash annotation survives a full delete-then-reinsert rebuild cycle unchanged"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 08: RULE-01 Annotations Storage Summary

**A no-FK `calendar_event_annotations` table (migration 0017) plus a Postgres repo + memory twin at proven contract parity, with a regression test pinning the rebuild-survival invariant that motivates the no-FK design (D-09).**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-05T07:43:48-05:00 (docs edits began after reading context)
- **Completed:** 2026-07-05T07:57:44-05:00
- **Tasks:** 3
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments
- Docs-first: `docs/architecture/stack-decisions.md` D24 and `docs/architecture/data-model.md` document the deliberate no-foreign-key design BEFORE the schema change landed
- Migration `0017_calendar_event_annotations.sql` + `schema.ts`'s `calendarEventAnnotations`: `fill_ids_hash varchar(64)` PRIMARY KEY (plain, no `.references()`), `rule_tags text[] NOT NULL DEFAULT '{}'`, `other_note text` (nullable, no DB CHECK — D-21 stays contract-level), `updated_at timestamptz NOT NULL DEFAULT now()`, RLS enabled, ships empty (no backfill, D-16)
- Postgres repo (`makePostgresCalendarEventAnnotationsRepo`) with `upsertAnnotation` (`onConflictDoUpdate` on the PK — editable anytime, D-10), `readAnnotation` (null on miss), `readAnnotationsByHashes` (subset read for 20-09's future join)
- In-memory twin (`makeMemoryCalendarEventAnnotationsRepo`) with identical semantics via a plain `Map`
- Contract-parity test suite (`calendar-event-annotations.contract.ts` + two runner files) — 7 assertions run against both implementations (14 tests total), all green, including insert-then-update round-trip, read-missing→null, and read-many-by-hashes subset behavior
- Regression guard added to `rebuildJournal.test.ts`: seeds an independent annotation double keyed by the same `fillIdsHash` as an event double, runs the real `makeRebuildJournalUseCase` delete-then-reinsert cycle against the events double, and asserts the annotation is untouched (count + content unchanged) — proving `rebuildJournal`'s dependency shape has no path to reach an annotations store

## Task Commits

1. **Task 1: Docs-first + migration 0017 + Drizzle schema (D-09/D-16)** - `0476ad9` (feat)
2. **Task 2 RED: contract-parity test** - `dddda70` (test)
3. **Task 2 GREEN: repo + memory twin implementation** - `159b45a` (feat)
4. **Task 3: rebuild-survival regression guard (D-09)** - `a8bd0b2` (test)

_Note: Task 3's test is green on first run (no RED phase in the traditional sense) — see TDD Gate Compliance below._

## Files Created/Modified
- `docs/architecture/stack-decisions.md` - D24 decision table row + full section: the no-FK rationale for `calendar_event_annotations`
- `docs/architecture/data-model.md` - new `calendar_event_annotations` table doc section
- `packages/adapters/src/postgres/migrations/0017_calendar_event_annotations.sql` - new table, no FK, SQL comment stating the D-09/D24 rationale
- `packages/adapters/src/postgres/migrations/meta/0017_snapshot.json`, `meta/_journal.json` - drizzle-kit generated snapshot + journal entry (tag renamed to match the descriptive filename convention)
- `packages/adapters/src/postgres/schema.ts` - `calendarEventAnnotations` Drizzle table, `.enableRLS()`, inline no-FK comment
- `packages/adapters/src/postgres/repos/calendar-event-annotations.ts` - Postgres repo: `upsertAnnotation`/`readAnnotation`/`readAnnotationsByHashes`, plus local `CalendarEventAnnotation`/`StorageError`/port-shaped function types (pending 20-09's core ports)
- `packages/adapters/src/memory/calendar-event-annotations.ts` - in-memory twin, identical semantics via `Map`
- `packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` - shared parity assertions (7 cases)
- `packages/adapters/src/postgres/repos/calendar-event-annotations.contract.test.ts` - testcontainers runner (skips gracefully without Docker)
- `packages/adapters/src/memory/calendar-event-annotations.contract.test.ts` - always-on memory runner
- `packages/core/src/journal/application/rebuildJournal.test.ts` - added the RULE-01/D-09 rebuild-survival regression guard

## Decisions Made
- **D24 (stack-decisions.md):** `calendar_event_annotations` is keyed by `fill_ids_hash` with deliberately NO foreign key to `calendar_events`. A real FK would either `CASCADE`-wipe annotations the instant `rebuildJournal` deletes the parent event mid-rebuild, or `RESTRICT`-block the delete outright (RESEARCH Pitfall 3). Documented before the schema change per the repo's Docs-Before-Code rule.
- **Local (not-yet-core) port types:** `CalendarEventAnnotation`, `UpsertAnnotationInput`, and the three function-type aliases (`UpsertAnnotation`/`ReadAnnotation`/`ReadAnnotationsByHashes`) are defined directly in `postgres/repos/calendar-event-annotations.ts` and duplicated identically in `memory/calendar-event-annotations.ts`, rather than imported from `@morai/core`. Plan 20-09 (not yet executed, per this plan's own `depends_on` chain and files_modified list) is the plan that adds `ForReadingAnnotations`/`ForWritingAnnotations` to `packages/core/application/ports.ts` — those don't exist yet. The local shapes here already match what 20-09 will formalize (same field names, same `Result<T, StorageError>` return shape), so 20-09's wiring is a type-only swap (`import type {...} from "@morai/core"` replacing each local block), not a rewrite. This keeps hexagon purity intact today (no premature/guessed port design landing in core) while still shipping a working, contract-tested storage layer this plan.
- **Migration generated via drizzle-kit, then renamed:** ran `bunx drizzle-kit generate` (confirmed "0 fks" in its own table-diff output), then renamed the auto-named file (`0017_youthful_peter_quill.sql` → `0017_calendar_event_annotations.sql`) and updated the `_journal.json` tag to match — following the exact convention already used for migrations 0008 through 0016 in this repo (all have descriptive, not randomly-generated, filenames).
- **Contract-test runner files** (`postgres/repos/calendar-event-annotations.contract.test.ts`, `memory/calendar-event-annotations.contract.test.ts`) were added alongside the plan-listed shared `__contract__/calendar-event-annotations.contract.ts` file. The plan's `<files>` list for Task 2 named only the shared file, but its own acceptance criteria ("memory/Postgres parity green under testcontainers") and the `20-PATTERNS.md` analog (`calendar-events.contract.ts`) both require the shared-assertions-plus-two-runners three-file shape already used by every other contract-parity suite in this codebase (`calendar-events`, `picker-snapshot`). This is not a deviation from the plan's intent, just the literal file set the described pattern requires.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the two contract-test runner files not explicitly listed in Task 2's `<files>`**
- **Found during:** Task 2 implementation
- **Issue:** The plan's `<files>` tag for Task 2 lists only `packages/adapters/src/__contract__/calendar-event-annotations.contract.ts`, but that file only exports a `runCalendarEventAnnotationsContractTests` function — nothing in it runs under `vitest` unless a `describe`-wrapping runner file imports and calls it. Without the two runner files, the plan's own verify command (`bun run test -- packages/adapters/src/__contract__/calendar-event-annotations.contract.ts`) and acceptance criteria ("memory/Postgres parity green under testcontainers") could not be satisfied.
- **Fix:** Added `packages/adapters/src/postgres/repos/calendar-event-annotations.contract.test.ts` (testcontainers, `describe.skipIf`) and `packages/adapters/src/memory/calendar-event-annotations.contract.test.ts` (always-on), mirroring the exact existing structure of `calendar-events.contract.test.ts` / `picker-snapshot.contract.test.ts` in both locations.
- **Files modified:** as listed above (both new files)
- **Verification:** `bun run test -- packages/adapters/src/__contract__/... packages/adapters/src/memory/... packages/adapters/src/postgres/repos/...` — 14/14 tests pass (7 memory + 7 postgres via testcontainers)
- **Committed in:** `dddda70` (RED — module-not-found, matching this repo's established RED convention for brand-new files) and `159b45a` (GREEN)

---

**Total deviations:** 1 auto-fixed (missing critical test-runner scaffolding, Rule 2)
**Impact on plan:** Necessary to make the plan's own verify command and acceptance criteria executable at all. No scope creep — same file count and shape as every other contract-parity suite already in this codebase.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None required for this execution. Per the plan's `user_setup` block: migration 0017 must be applied to the **live** database via `bun run migrate` against `DATABASE_URL` during the RULE-01 deploy cycle (after 20-09/20-10/20-11 land and the feature ships) — **not done here**, per this task's explicit instruction not to run migrations against any live database. Verified locally via testcontainers only.

## Next Phase Readiness
- `calendar_event_annotations` exists (locally/testcontainers-verified, not yet deployed), with a working, contract-tested Postgres repo + memory twin ready to be wired into real ports.
- Plan 20-09 can now add `ForReadingAnnotations`/`ForWritingAnnotations` to `packages/core/application/ports.ts` and wire `getCalendarEventsWithRules`/`setRuleTags` against these two adapter implementations — their function signatures already match what those ports will require, so no adapter rework is anticipated.
- No blockers. The RULE-01 rebuild-survival invariant is now pinned by an automated test, not just a design decision on paper.

## TDD Gate Compliance

Task 2 (repo + memory twin) followed the standard RED→GREEN cycle: `dddda70` (test — module-not-found for both not-yet-created implementation files, the established RED pattern for brand-new adapter files in this repo, matching prior plans 20-06/20-07's documented convention) then `159b45a` (feat — implementation, 14/14 tests green).

Task 3 (rebuild-survival regression guard) is marked `tdd="true"` in the plan but is architecturally a **pinning test**, not a RED-driven one: `rebuildJournal.ts`'s dependency type (`RebuildJournalDeps`) has no field capable of reaching an annotations store at all (that is the entire point of D-09's no-FK, no-coupling design), so the test in `a8bd0b2` passed on its first run — there was no production code to change to make it pass. This matches the plan's own action text: "Write it RED first (it will fail only if someone wired a FK/cascade)." No FK/cascade is wired, so RED never fires; the guard exists to catch a FUTURE regression, not to drive today's implementation.

## Self-Check: PASSED

All 7 created files verified present on disk; all 4 task commits (`0476ad9`, `dddda70`, `159b45a`, `a8bd0b2`) verified in `git log`.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*
