---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 09
subsystem: core
tags: [hexagonal-ports, journal, rule-tags, use-case, result-type]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "enterRuleTag/exitRuleTag/rollRuleTag vocabulary + ruleTagEnumForEventType resolver (plan 20-07)"
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "calendar_event_annotations Postgres repo + memory twin, structurally matching the port shapes formalized here (plan 20-08)"
provides:
  - "ForReadingAnnotations / ForWritingAnnotations canonical core ports (packages/core/journal/application/ports.ts)"
  - "getCalendarEventsWithRules read use-case — the previously-missing calendar_events read path (RESEARCH gap)"
  - "setRuleTags write use-case — validates tags against event-type enum + D-21 OTHER-note rule before upserting"
affects: [20-10-routes-mcp, 20-11-journal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ForReadingAnnotations is a grouped two-method port object (readAnnotation + readAnnotationsByHashes) rather than a single ForVerbingNoun function, method-named to exactly match the 20-08 adapters' already-shipped repo shape — a true type-only swap for future wiring, zero adapter-file changes needed"
    - "Defense-in-depth orphan check: getCalendarEventsWithRules re-verifies every returned annotation's fillIdsHash against the current event-hash set in memory, even though the real adapters already filter by hash — the port contract doesn't guarantee that, so the use-case never trusts it blindly (D-09)"

key-files:
  created:
    - packages/core/src/journal/application/getCalendarEventsWithRules.ts
    - packages/core/src/journal/application/getCalendarEventsWithRules.test.ts
    - packages/core/src/journal/application/setRuleTags.ts
    - packages/core/src/journal/application/setRuleTags.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "ForReadingAnnotations method names (readAnnotation, readAnnotationsByHashes) and ForWritingAnnotations' single-function shape (upsertAnnotation-compatible) were chosen to structurally match the 20-08 Postgres/memory repos exactly, so wiring those adapters to these new core ports is a pure type import swap in a later plan (20-10) — no changes to packages/adapters/src/postgres/repos/calendar-event-annotations.ts or packages/adapters/src/memory/calendar-event-annotations.ts were needed or made in this plan (out of this plan's files_modified scope)."
  - "setRuleTags reuses the existing ValidationError type from registerCalendar.ts (kind: 'validation-error') rather than defining a new error type, for both the cross-type-tag and unknown-fillIdsHash failure modes — consistent with the codebase's existing single generic validation-error shape (see registerCalendar.ts) rather than introducing a distinct not-found kind."
  - "getCalendarEventsWithRules's orphan-detection test uses a port double that deliberately returns an annotation outside the requested hash set (rather than the real adapters' correctly-filtering behavior) to exercise the defense-in-depth check — under the real Postgres/memory adapters (which filter by inArray/Set), this path is dead in production today but guards against a future adapter that doesn't filter strictly, matching D-09's intent literally (never surface/delete an orphan) rather than only its currently-unreachable manifestation."

patterns-established:
  - "Read-use-case in-memory join pattern: read the parent aggregate (events) via its existing port, collect keys, batch-read the child rows via a by-keys port, left-join with explicit defaults — reusable for any future no-FK sidecar table joined at the application layer instead of SQL."

requirements-completed: [RULE-01]

coverage:
  - id: D1
    description: "ForReadingAnnotations (readAnnotation + readAnnotationsByHashes) and ForWritingAnnotations (upsert) driven-port types exist in ports.ts"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/getCalendarEventsWithRules.test.ts + setRuleTags.test.ts (both compile against the ports.ts types; bun run typecheck clean)"
        status: pass
    human_judgment: false
  - id: D2
    description: "getCalendarEventsWithRules joins events + annotations on fillIdsHash; unannotated events default to []/null; orphan annotations are logged and omitted, never deleted (D-09)"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/getCalendarEventsWithRules.test.ts (6 tests: annotated, unannotated, orphan log-and-omit, StorageError x2, empty-calendar short-circuit)"
        status: pass
    human_judgment: false
  - id: D3
    description: "setRuleTags validates tags against the event-type enum + D-21 OTHER-requires-note before upserting; rejects unknown fillIdsHash without a blind write; never evaluates/infers rules"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/setRuleTags.test.ts (8 tests: valid upsert, cross-type rejection, OTHER-without-note, OTHER-with-whitespace-note, OTHER-with-note accepted, unknown-hash rejection, StorageError x2)"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 09: RULE-01 Application Layer Summary

**Canonical `ForReadingAnnotations`/`ForWritingAnnotations` core ports plus the `getCalendarEventsWithRules` read use-case (closing RESEARCH's "no read surface for calendar_events" gap) and the `setRuleTags` write use-case (validates against the event-type enum + D-21 OTHER-note rule, never evaluates rules).**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-05T08:04:00-05:00
- **Completed:** 2026-07-05T08:09:00-05:00
- **Tasks:** 2
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- Added `ForReadingAnnotations` (grouped `readAnnotation`/`readAnnotationsByHashes` methods) and `ForWritingAnnotations` (upsert) to `packages/core/src/journal/application/ports.ts`, method-name-compatible with the 20-08 Postgres repo and memory twin so wiring them in a future plan is a type-only import swap, no adapter-file changes
- Implemented `makeGetCalendarEventsWithRulesUseCase`: reads a calendar's events, batch-reads their annotations by `fillIdsHash`, left-joins in memory with `[]`/`null` defaults for unannotated events, and defensively logs+omits (never deletes) any annotation whose hash matches no current event (D-09)
- Implemented `makeSetRuleTagsUseCase`: resolves the target event by `fillIdsHash`, validates every supplied tag against `ruleTagEnumForEventType`'s resolved enum, enforces D-21 (OTHER requires a non-empty note) as defense-in-depth beyond the contract's Zod refine, and only upserts via `ForWritingAnnotations` on full validation — never a blind write on an unknown hash
- Re-exported all new ports/types/use-cases through `packages/core/src/journal/index.ts` and `packages/core/src/index.ts` (barrel-export gap, project rule 4)

## Task Commits

Both tasks followed RED→GREEN (test commit, then feat commit):

1. **Task 1 RED: getCalendarEventsWithRules tests** - `1851e82` (test)
2. **Task 1 GREEN: annotation ports + getCalendarEventsWithRules** - `e0098f4` (feat)
3. **Task 2 RED: setRuleTags tests** - `ff4cda7` (test)
4. **Task 2 GREEN: setRuleTags use-case + barrel exports** - `aa717a5` (feat)

## Files Created/Modified
- `packages/core/src/journal/application/ports.ts` - added `CalendarEventAnnotation`, `UpsertAnnotationInput`, `ForWritingAnnotations`, `ForReadingAnnotations`
- `packages/core/src/journal/application/getCalendarEventsWithRules.ts` - read use-case (events + annotations join, D-09 orphan policy)
- `packages/core/src/journal/application/getCalendarEventsWithRules.test.ts` - 6 tests (in-memory port doubles)
- `packages/core/src/journal/application/setRuleTags.ts` - write use-case (event-type enum validation + D-21, upsert)
- `packages/core/src/journal/application/setRuleTags.test.ts` - 8 tests (in-memory port doubles)
- `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` - re-export the new ports/use-cases

## Decisions Made
- **`ForReadingAnnotations` as a grouped two-method object, not a bare `ForVerbingNoun` function:** the plan's own acceptance criteria describes it as one port covering "read-one + read-many-by-hash". Method names (`readAnnotation`, `readAnnotationsByHashes`) were chosen to exactly match what `makePostgresCalendarEventAnnotationsRepo`/`makeMemoryCalendarEventAnnotationsRepo` (20-08) already return, so a future composition-root wiring (`readAnnotations: annotationsRepo`) needs no adapter changes — the repo object already satisfies the port's structural type.
- **`ForWritingAnnotations` stays a bare function** (matching every other port in `ports.ts`, e.g. `ForRegisteringCalendar`) — a composition root would pass `annotationsRepo.upsertAnnotation` directly, the established pattern for every other calendar/journal port in this codebase.
- **Reused `ValidationError` from `registerCalendar.ts`** for all three `setRuleTags` failure modes (cross-type tag, OTHER-without-note, unknown hash) rather than inventing new error kinds — matches the existing single generic `validation-error` shape used elsewhere in this bounded context.
- **Orphan-detection test uses a non-filtering double on purpose:** since `readAnnotationsByHashes` is queried with exactly the current events' hashes, a correctly-filtering adapter (both 20-08 implementations filter via `inArray`/`Set`) can never itself return a hash outside that set — so the D-09 orphan path is unreachable through the real adapters today. The use-case still implements and tests the defensive check (log + omit, never delete) because the port's type contract does not promise strict filtering, and D-09's intent is about protecting against ANY stale/orphaned annotation surfacing, not just the current adapters' specific behavior.

## Deviations from Plan

None — plan executed as written. The two barrel-export files (`packages/core/src/journal/index.ts`, `packages/core/src/index.ts`) were not in the plan's `files_modified` list but their update is mandated by this session's project rule 4 (the recurring barrel-export gap) and by `architecture-boundaries.md`'s public-surface convention already followed by every prior RULE-01 plan (20-07, 20-08 both re-exported through the same two files).

## Issues Encountered
None.

## User Setup Required
None. No migrations, no environment variables, no external services touched by this plan (pure `packages/core` application-layer additions).

## Next Phase Readiness
- `getCalendarEventsWithRules`/`setRuleTags` are ready to be wired into the HTTP route + MCP tool in plan 20-10, using `packages/contracts`' `getEventsWithRulesResponse`/`setRuleTagsRequest`/`setRuleTagsResponse` (20-07) to map between the use-case's domain shapes and the wire contracts.
- The composition root (apps/server or apps/worker `main.ts`, in 20-10) will construct `{ readCalendarEvents: existingCalendarEventsRepo.readCalendarEvents, readAnnotations: annotationsRepo, writeAnnotations: annotationsRepo.upsertAnnotation }` — no adapter-file changes anticipated, per the type-only-swap design documented in 20-08's summary and confirmed here.
- No blockers.

## Self-Check: PASSED

All 4 created files verified present on disk; all 4 task commits (`1851e82`, `e0098f4`, `ff4cda7`, `aa717a5`) verified in `git log`.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*
