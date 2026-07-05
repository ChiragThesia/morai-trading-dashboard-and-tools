---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 07
subsystem: api
tags: [zod, journal, rule-tags, contracts, hexagonal-boundaries]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "calendar-event.ts CalendarEventType discriminant (Phase 5); RULE-01 planning decisions D-07/D-08/D-14/D-21"
provides:
  - "enterRuleTag/exitRuleTag/rollRuleTag Zod enums + ruleTagEnumForEventType resolver (packages/core)"
  - "setRuleTagsRequest/setRuleTagsResponse/getEventsWithRulesResponse contracts (packages/contracts)"
  - "locked, user-approved rule-tag vocabulary for the rest of RULE-01 (20-08 table, 20-09 use-case, 20-10 routes+MCP, 20-11 UI)"
affects: [20-08-annotations-table, 20-09-read-usecase, 20-10-routes-mcp, 20-11-journal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-package Zod value single-sourcing: contracts imports pure Zod enum exports from core (narrow eslint boundary carve-out, not ports/use-cases)"
    - "Event-type-keyed enum resolver via exhaustive switch (no default), matching calendar-event.ts's CalendarEventType discriminant idiom"

key-files:
  created:
    - packages/core/src/journal/domain/rule-tags.ts
    - packages/core/src/journal/domain/rule-tags.test.ts
    - packages/contracts/src/journal-rules.ts
    - packages/contracts/src/journal-rules.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/core/package.json
    - packages/contracts/src/index.ts
    - packages/contracts/package.json
    - eslint.config.js
    - docs/architecture/monorepo-layout.md
    - bun.lock

key-decisions:
  - "D-08 checkpoint resolved: user chose 'accept-seeds' — locked ENTER = iv-skew-favorable/term-structure-edge/event-window-play/gex-fit/other; EXIT = profit-target/max-loss/time-stop/thesis-invalidated/other; ROLL = defend-tested-side/roll-for-duration/other. thesis-invalidated (flagged [ASSUMED] in RESEARCH) accepted as-is."
  - "Added zod as a packages/core dependency for this one domain module — a narrow, phase-specific carve-out from core's otherwise zod-free convention (other core files explicitly comment 'NO zod'), sanctioned by this plan's project_rules for the RULE-01 recording vocabulary."
  - "Added a narrow contracts→core eslint boundary edge (values only, never ports/use-cases) so the enum vocabulary is genuinely single-sourced rather than hand-copied into both packages. Documented in docs/architecture/monorepo-layout.md 'Narrow carve-out' note and eslint.config.js boundaries/dependencies comment (Docs-Before-Code)."
  - "setRuleTagsRequest's tags[] element type is the UNION of all three per-event-type enums (not parameterized per event type) — the per-event-type narrowing described in the plan happens at the route layer (20-10) via ruleTagEnumForEventType after the route resolves the target event's type; this contract stays generic and independently unit-testable."
  - "getEventsWithRulesResponse.tags is a plain string[] (not re-validated against the enum) since it's a read of already-persisted data; enum enforcement is a write-path concern per Security T-20-11."

patterns-established:
  - "Rule-tag vocabulary lock: three Zod enums in core (each including 'other') + one resolver, imported by contracts to build the write-path union — future RULE-01 plans reuse these exports rather than redefining the vocabulary."

requirements-completed: [RULE-01]

coverage:
  - id: D1
    description: "Three event-keyed Zod enums (enterRuleTag/exitRuleTag/rollRuleTag) each including 'other', with an exhaustive ruleTagEnumForEventType resolver mapping OPEN/CLOSE/ROLL"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/domain/rule-tags.test.ts (23 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "setRuleTagsRequest (list-shaped, bounded tags[]+otherNote, D-21 OTHER-requires-note refine) and setRuleTagsResponse/getEventsWithRulesResponse contracts, vocabulary single-sourced from @morai/core"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/journal-rules.test.ts (15 tests)"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 07: Strategy-Rule Vocabulary (RULE-01) Summary

**Three event-keyed Zod enums (enter/exit/roll rule tags, D-07/D-08 locked) plus list-shaped, OTHER-requires-note request/response contracts (D-14/D-21) — vocabulary single-sourced from @morai/core into packages/contracts.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-05T07:35:16-05:00
- **Completed:** 2026-07-05T07:42:24-05:00
- **Tasks:** 2 (checkpoint pre-resolved by user before this run)
- **Files modified:** 12 (4 created, 8 modified)

## Accomplishments
- Locked and implemented `enterRuleTag`/`exitRuleTag`/`rollRuleTag` Zod enums plus an exhaustive `ruleTagEnumForEventType` resolver in `packages/core/src/journal/domain/rule-tags.ts`
- Implemented `setRuleTagsRequest`/`setRuleTagsResponse`/`getEventsWithRulesResponse` in `packages/contracts/src/journal-rules.ts`, deriving the tag vocabulary from `@morai/core` so the DB-boundary and HTTP/MCP wire vocabulary can never diverge
- Enforced D-21 (OTHER-requires-note) via a Zod `.refine`, and Security T-20-11/V5 bounds (`tags[].max(5)`, `otherNote.max(280)`)
- Defined the combined `getEventsWithRulesResponse` read surface (events + per-event tags/otherNote) that RESEARCH flagged as missing — no route or MCP tool exposes `calendar_events` today; this plan only defines the schema, the route lands in 20-10

## Task Commits

Each task followed RED→GREEN (test commit, then feat commit):

1. **Task 1 RED: rule-tags enums** - `579a186` (test)
2. **Task 1 GREEN: rule-tags enums + resolver** - `aaef857` (feat)
3. **Task 2 RED: journal-rules contracts** - `8e371fa` (test)
4. **Task 2 GREEN: journal-rules contracts** - `bb51a94` (feat)

_Checkpoint task (D-08) was pre-resolved by the user ("accept-seeds") before this execution run — no additional commit for it._

## Files Created/Modified
- `packages/core/src/journal/domain/rule-tags.ts` - Three locked Zod enums + `ruleTagEnumForEventType` exhaustive resolver
- `packages/core/src/journal/domain/rule-tags.test.ts` - 23 unit tests (own-value acceptance, cross-type rejection, resolver mapping)
- `packages/contracts/src/journal-rules.ts` - `setRuleTagsRequest`/`setRuleTagsResponse`/`getEventsWithRulesResponse`
- `packages/contracts/src/journal-rules.test.ts` - 15 unit tests (D-21 refine, bounds, vocabulary rejection, round-trips)
- `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` - re-export the new enums/resolver
- `packages/contracts/src/index.ts` - re-export the new contracts
- `packages/core/package.json` - added `zod` dependency (see Decisions)
- `packages/contracts/package.json` - added `@morai/core` dependency (see Decisions)
- `eslint.config.js` - narrow `contracts → core` boundary edge (values-only)
- `docs/architecture/monorepo-layout.md` - documented the narrow carve-out and its rationale
- `bun.lock` - updated for the two new workspace dependency edges

## Decisions Made
- **D-08 resolved via "accept-seeds":** locked all three enum lists exactly as seeded from the KB, including `thesis-invalidated` (previously `[ASSUMED]` in RESEARCH). No trim requested.
- **zod added to `packages/core`:** a narrow, phase-specific exception to core's otherwise zod-free convention, explicitly authorized by this plan's task instructions for the RULE-01 recording vocabulary. Only `rule-tags.ts` uses it.
- **`contracts → core` eslint boundary carve-out:** added (values-only, never ports/use-cases/domain-logic) so the enum vocabulary is genuinely single-sourced rather than duplicated by hand into both packages, which would silently drift the first time either side changed. Updated `docs/architecture/monorepo-layout.md` in the same commit per the repo's Docs-Before-Code rule.
- **Request tag typing is generic, not per-event-type:** `setRuleTagsRequest.tags` accepts the union of all three enums rather than being parameterized by `CalendarEventType` at the contract layer — the plan's "route resolves which by the event's type" language is satisfied by deferring the per-event-type narrowing to the route (future plan 20-10, via `ruleTagEnumForEventType` after it looks up the target event), keeping this contract simple and independently testable now.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4-adjacent, explicitly pre-authorized] Boundary carve-out for `contracts → core` and `zod` in `core`**
- **Found during:** Task 1/2 implementation — the plan's key_link ("contract enums import/derive from rule-tags.ts") requires an import edge the repo's mechanical `eslint.config.js` `boundaries/dependencies` rule explicitly disallowed (`contracts` was only permitted `shared`+`contracts`), and `packages/core`'s `package.json` had no `zod` dependency despite two other core files' comments stating "NO zod" as the established convention.
- **Resolution:** This plan's own `<project_rules>` block explicitly stated "packages/core imports only zod + packages/shared... contracts import zod + shared (may derive enum values from core)" — treated as pre-authorized instruction for this phase, not a new ad-hoc decision. Updated `eslint.config.js` (narrow value-only edge) and `docs/architecture/monorepo-layout.md` (Docs-Before-Code) in the same commit as the code change, rather than silently adding an `eslint-disable` (which the repo's rules explicitly forbid).
- **Files modified:** `eslint.config.js`, `docs/architecture/monorepo-layout.md`, `packages/core/package.json`, `packages/contracts/package.json`
- **Verification:** `bun run typecheck` and `bun run lint` clean repo-wide (no boundary errors); full test suite green (205 files / 1964 tests)
- **Committed in:** `aaef857` (zod-in-core), `bb51a94` (contracts→core edge + docs)

---

**Total deviations:** 1 auto-fixed (architecture-boundary carve-out, pre-authorized by task instructions)
**Impact on plan:** Necessary to satisfy the plan's own "single-sourced from @morai/core" acceptance criterion without either an eslint-disable or a config/doc drift. No scope creep — the carve-out is scoped exclusively to the three new files' value exports.

## Issues Encountered
None beyond the boundary carve-out above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The locked, single-sourced rule-tag vocabulary is ready for 20-08 (annotations table + migration 0016), 20-09 (read use-case), 20-10 (routes + MCP tools using `ruleTagEnumForEventType` for per-event-type write validation), and 20-11 (Journal UI toggle chips).
- No blockers. `getEventsWithRulesResponse`/`setRuleTagsRequest`/`setRuleTagsResponse` are ready to be wired to real ports in 20-08/20-09/20-10.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*

## Self-Check: PASSED

All 4 created files verified present; all 4 task commits (579a186, aaef857, 8e371fa, bb51a94) verified in git log.
