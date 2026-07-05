---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 10
subsystem: api
tags: [hono, mcp, zod, rule-tags, journal, hexagonal-ports]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "journal-rules contracts — setRuleTagsRequest/setRuleTagsResponse/getEventsWithRulesResponse (plan 20-07)"
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "getCalendarEventsWithRules (read) + setRuleTags (write) use-cases, ForReadingAnnotations/ForWritingAnnotations ports (plan 20-09)"
provides:
  - "GET /api/journal/:calendarId/rules — combined events+annotations read, JWT-gated inside authReadGroup"
  - "PUT /api/journal/events/:hash/rules — validated rule-tag write, addressed by fillIdsHash alone"
  - "get_rule_tags + set_rule_tags MCP tools sharing the SAME contract schemas as the HTTP routes (MCP-02)"
  - "ForReadingCalendarEventByHash core port + postgres/memory implementations (unblocks hash-only addressing)"
affects: [20-11-journal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Existence pre-check via a separate port (ForGettingCalendarById) to distinguish 404-unknown-calendar from 200-empty-calendar, when the primary read use-case can't itself tell the two apart (both read empty)"
    - "Global-hash addressing: when a domain row has its own DB UNIQUE key (fill_ids_hash), route/MCP-tool/use-case layers address it by that key alone instead of threading a parent id (calendarId) through every layer just to re-derive the same row"
    - "Distinct error kinds per HTTP-status target: CalendarNotFound (404) vs ValidationError (400) from the SAME use-case, so the thin adapter can switch on result.error.kind instead of string-matching messages"

key-files:
  created:
    - apps/server/src/adapters/http/journal-rules.routes.ts
    - apps/server/src/adapters/http/journal-rules.routes.test.ts
  modified:
    - apps/server/src/main.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/tools.test.ts
    - apps/server/src/adapters/mcp/server.ts
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/application/setRuleTags.ts
    - packages/core/src/journal/application/setRuleTags.test.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/repos/calendar-events.ts
    - packages/adapters/src/memory/calendar-events.ts
    - packages/adapters/src/__contract__/calendar-events.contract.ts
    - packages/adapters/src/postgres/repos/calendar-events.contract.test.ts
    - packages/adapters/src/memory/calendar-events.contract.test.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "setRuleTags is addressed by fillIdsHash alone (dropped calendarId from SetRuleTagsInput) — the plan's own route (PUT /api/journal/events/:hash/rules) never receives a calendarId, and fill_ids_hash is already the DB UNIQUE idempotency key, matching how annotations are already addressed (D-09, no FK)."
  - "The 'unknown fillIdsHash' failure now returns CalendarNotFound (kind: 'not-found') instead of ValidationError, so the route/tool can map it to 404 distinctly from the 400s produced by cross-type-tag / OTHER-without-note (previously all three shared one generic validation-error kind, which can't drive two different HTTP statuses)."
  - "GET /api/journal/:calendarId/rules adds a getCalendarById existence pre-check before calling getCalendarEventsWithRules, because the read use-case's own readCalendarEvents port returns an empty array for BOTH an unknown calendarId and a known-but-empty one — the 404-vs-200-empty distinction the plan requires needs a second port."
  - "set_rule_tags MCP tool reuses the exact setRuleTagsRequest Zod schema (including the D-21 OTHER-requires-note refine) for the tags/otherNote portion of its input, plus a separate bare fillIdsHash length check — MCP-02 'same schema both surfaces' applied to the body slice rather than forcing a merged schema through a refined ZodEffects object."

patterns-established:
  - "Reflect-based direct handler invocation for MCP-tool tests that need to exercise a handler's OWN internal safeParse fallback when the MCP SDK's own inputSchema-shape validation (e.g. z.string().uuid()) would otherwise intercept the malformed arg before the handler runs (mirrors the existing mcp.test.ts CR-02 pattern)."

requirements-completed: [RULE-01]

coverage:
  - id: D1
    description: "GET /api/journal/:calendarId/rules returns the combined events+annotations payload (200), 404 for an unknown calendar, 500 on storage error; PUT /api/journal/events/:hash/rules validates the body (incl. D-21 OTHER-requires-note), 200 on save, 400 on validation-error, 404 on not-found, 500 on storage error; both mounted inside authReadGroup (JWT-gated)"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/journal-rules.routes.test.ts (11 tests, real Hono app + fetch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "get_rule_tags and set_rule_tags MCP tools registered, sharing the journal-rules contract schemas with the HTTP routes (MCP-02), safeParse args at the boundary, never throw on invalid input"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts (12 tests: 3 pre-existing get_picker_candidates + 9 new for get_rule_tags/set_rule_tags, real McpServer + InMemoryTransport Client plus Reflect-direct handler calls for SDK-intercepted invalid-arg cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ForReadingCalendarEventByHash core port added and implemented by both the Postgres and in-memory calendar-events repos, with setRuleTags refactored to use it instead of calendarId + ForReadingCalendarEvents (deviation fix required to unblock D1/D2's hash-only route/tool addressing)"
    requirement: "RULE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/setRuleTags.test.ts (8 tests) + packages/adapters/src/__contract__/calendar-events.contract.ts readCalendarEventByHash suite, run against both postgres/repos/calendar-events.contract.test.ts (testcontainers) and memory/calendar-events.contract.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 10: RULE-01 Adapter Surface (HTTP + MCP) Summary

**GET/PUT /api/journal/*rules HTTP routes and get_rule_tags/set_rule_tags MCP tools, both addressed by fillIdsHash alone and sharing one contract schema set (D-13) — the full RULE-01 backend surface, wired into main.ts's authReadGroup.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-05T08:10:40-05:00
- **Completed:** 2026-07-05T08:30:02-05:00
- **Tasks:** 2 (plus 1 preparatory deviation-fix commit)
- **Files modified:** 18 (2 created, 16 modified)

## Accomplishments
- `journalRulesRoutes(getCalendarById, getEventsWithRules, setRuleTags)` — GET the combined events+rule-tag payload (404 on unknown calendar via an existence pre-check, since the read use-case alone can't distinguish that from a known-empty calendar) and PUT a validated rule-tag write (400/404/500 mapped from the use-case's Result), both mounted inside main.ts's existing `authReadGroup` JWT group alongside calendar/journal routes (Security V4)
- `registerGetRuleTagsTool` / `registerSetRuleTagsTool` — MCP tools sharing the exact `getEventsWithRulesResponse`/`setRuleTagsRequest`/`setRuleTagsResponse` contract schemas as the HTTP routes (MCP-02), safeParsing args at the boundary and never throwing, wired into `makeMcpRouter` as two new optional trailing params
- Deviation fix (prerequisite, committed first): added `ForReadingCalendarEventByHash` core port + Postgres/memory implementations, and refactored `setRuleTags` to address its target event by `fillIdsHash` alone instead of `calendarId` + `ForReadingCalendarEvents` — required because the plan's own PUT route/MCP tool never receive a calendarId, and `fill_ids_hash` is already the DB UNIQUE idempotency key
- Split the "unknown fillIdsHash" failure into `CalendarNotFound` (404) distinct from `ValidationError` (400, cross-type-tag / OTHER-without-note) — the two failure classes previously shared one generic `validation-error` kind, which couldn't drive two different HTTP statuses at the route
- Closed a barrel-export gap from plan 20-08: `makePostgresCalendarEventAnnotationsRepo` / `makeMemoryCalendarEventAnnotationsRepo` were implemented but never re-exported from `packages/adapters/src/index.ts`, blocking `main.ts`'s composition-root wiring

## Task Commits

1. **Deviation fix: setRuleTags addressed by fillIdsHash alone** - `4a3f07c` (fix)
2. **Task 1 RED: journal-rules HTTP route tests** - `d2de636` (test)
3. **Task 1 GREEN: journal-rules HTTP routes + main.ts wiring** - `155a473` (feat)
4. **Task 2 RED: get_rule_tags/set_rule_tags MCP tool tests** - `ec6f4ff` (test)
5. **Task 2 GREEN: get_rule_tags/set_rule_tags MCP tools + server.ts/main.ts wiring** - `ba16b26` (feat)

## Files Created/Modified
- `apps/server/src/adapters/http/journal-rules.routes.ts` - new: `journalRulesRoutes` Hono router factory (GET + PUT)
- `apps/server/src/adapters/http/journal-rules.routes.test.ts` - new: 11 tests (real Hono app + fetch)
- `apps/server/src/main.ts` - composition root: wires `calendarEventsRepo`/`calendarEventAnnotationsRepo`, builds `getEventsWithRules`/`setRuleTags`, mounts `journalRulesRoutes` inside `authReadGroup`, threads both use-cases into `makeMcpRouter`
- `apps/server/src/adapters/mcp/tools.ts` - adds `registerGetRuleTagsTool` + `registerSetRuleTagsTool`
- `apps/server/src/adapters/mcp/tools.test.ts` - adds 9 tests for the two new MCP tools
- `apps/server/src/adapters/mcp/server.ts` - `makeMcpRouter` gains two new optional trailing params + conditional registration
- `packages/core/src/journal/application/ports.ts` - adds `ForReadingCalendarEventByHash`
- `packages/core/src/journal/application/setRuleTags.ts` - refactored to `readEventByHash` (no calendarId), unknown-hash now returns `CalendarNotFound`
- `packages/core/src/journal/application/setRuleTags.test.ts` - updated for the new deps shape and not-found error kind
- `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` - barrel-export `ForReadingCalendarEventByHash`
- `packages/adapters/src/postgres/repos/calendar-events.ts`, `packages/adapters/src/memory/calendar-events.ts` - add `readCalendarEventByHash`
- `packages/adapters/src/__contract__/calendar-events.contract.ts` + both `*.contract.test.ts` files - add the shared `readCalendarEventByHash` contract-test suite
- `packages/adapters/src/index.ts` - barrel-exports `makePostgresCalendarEventAnnotationsRepo`/`makeMemoryCalendarEventAnnotationsRepo` (20-08 gap)

## Decisions Made
- **fillIdsHash-only addressing for the write path:** the route/tool design (plan 20-10, PUT by hash) and the annotations table's own no-FK-by-design (D-09) both already treat `fillIdsHash` as sufficient identity — extending that to `setRuleTags`'s event lookup removes an unnecessary `calendarId` parameter the caller could never actually supply.
- **CalendarNotFound over string-matching:** rather than have the route inspect `result.error.message` for "unknown fillIdsHash" (which would leak use-case internals into the adapter and violate the thin-adapter rule), the use-case now returns a distinct error kind, matching the existing `closeCalendar`/`registerCalendar` convention of one error type per HTTP-status target.
- **getCalendarById as a route-level pre-check, not a use-case change:** rather than modifying `getCalendarEventsWithRules`'s signature to also disambiguate unknown-vs-empty, the route composes an existing, already-wired port (`calendarsRepo.getCalendarById`) — zero core changes needed for the GET side.
- **set_rule_tags MCP inputSchema does not include calendarId:** the plan's task description sketched `{calendarId, fillIdsHash, tags, otherNote}`, but since the underlying use-case no longer needs calendarId (see above), including it in the tool's input would be a dead, unused parameter — dropped for consistency with the HTTP route and the "adapters call use-cases, not vice versa" rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] setRuleTags required a calendarId the plan's own route can never supply**
- **Found during:** Task 1 (reading 20-09's `setRuleTags` signature before writing the route)
- **Issue:** `SetRuleTagsInput` required `calendarId` to look up the target event via `ForReadingCalendarEvents(calendarId)`. The plan's PUT route is `PUT /api/journal/events/:hash/rules` (no calendarId in path) and `setRuleTagsRequest`'s body schema is `{tags, otherNote}` only — there was no way to obtain a calendarId at the route.
- **Fix:** Added `ForReadingCalendarEventByHash` core port (Postgres + memory implementations, keyed on the DB UNIQUE `fill_ids_hash` column / the memory repo's existing hash-keyed Map) and rewired `setRuleTags` to look up the target event by hash alone, dropping `calendarId` from `SetRuleTagsInput` entirely.
- **Files modified:** `packages/core/src/journal/application/ports.ts`, `setRuleTags.ts`, `setRuleTags.test.ts`, `journal/index.ts`, `core/index.ts`, `packages/adapters/src/postgres/repos/calendar-events.ts`, `packages/adapters/src/memory/calendar-events.ts`, `packages/adapters/src/__contract__/calendar-events.contract.ts` + both contract-test files
- **Verification:** `setRuleTags.test.ts` (8/8), `calendar-events.contract.ts`'s new `readCalendarEventByHash` cases run green against both Postgres (testcontainers) and memory adapters; full-repo `bun run typecheck`/`bun run lint`/`bun run test` (210 files, 2017 tests) all clean
- **Committed in:** `4a3f07c` (separate deviation commit, before Task 1's RED test)

**2. [Rule 1 - Bug] "unknown fillIdsHash" and "cross-type tag"/"OTHER-without-note" shared one error kind, but need different HTTP statuses**
- **Found during:** Task 1 (designing the PUT route's error-to-status mapping)
- **Issue:** `setRuleTags` returned `ValidationError` (kind: `validation-error`) for all three failure modes. The plan's `<behavior>` requires 404 for unknown-hash and 400 for the other two — a single generic kind can't drive two different statuses without the route inspecting error message text (which would embed business logic in the adapter, violating the thin-adapter rule).
- **Fix:** Changed the unknown-fillIdsHash branch to return the existing `CalendarNotFound` type (kind: `not-found`) instead, matching the codebase's established one-error-kind-per-HTTP-status-target convention (see `closeCalendar`'s `CalendarNotFound | CalendarAlreadyClosed`).
- **Files modified:** `packages/core/src/journal/application/setRuleTags.ts`, `setRuleTags.test.ts`
- **Verification:** Same as above (bundled in the same fix commit)
- **Committed in:** `4a3f07c`

**3. [Rule 2 - Missing Critical] `calendar-event-annotations` repos (20-08) were never barrel-exported from `@morai/adapters`**
- **Found during:** Task 1 (wiring `main.ts`, discovered `makePostgresCalendarEventAnnotationsRepo` was not importable from `@morai/adapters`)
- **Issue:** 20-08 implemented the Postgres and in-memory annotations repos but left their factory functions un-exported from `packages/adapters/src/index.ts` — the exact barrel-export gap 20-09's summary flagged as expected for this plan to close.
- **Fix:** Added the four missing exports (`makePostgresCalendarEventAnnotationsRepo`/`PostgresCalendarEventAnnotationsRepo`, `makeMemoryCalendarEventAnnotationsRepo`/`MemoryCalendarEventAnnotationsRepo`).
- **Files modified:** `packages/adapters/src/index.ts`
- **Verification:** `bun run typecheck` clean (main.ts's import now resolves)
- **Committed in:** `4a3f07c`

---

**Total deviations:** 3 auto-fixed (2 blocking/bug in the same use-case refactor, 1 missing barrel export) — all bundled into a single preparatory "fix" commit before Task 1's RED test, since they were prerequisites for both of this plan's declared tasks rather than issues found mid-task.
**Impact on plan:** All three were required for D1/D2 to be implementable exactly as the plan's `<behavior>`/`must_haves` specify (fillIdsHash-only PUT route, distinct 404-vs-400, working composition-root wiring). No scope creep beyond what unblocks this plan's own acceptance criteria.

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None — no migrations, no environment variables, no external services. `calendar_events.fill_ids_hash` was already a UNIQUE-constrained column (Phase 5); `readCalendarEventByHash` is a straightforward indexed lookup on that existing constraint.

## Next Phase Readiness
- RULE-01's full backend surface (read/write use-cases from 20-09, HTTP routes + MCP tools from this plan) is live and JWT-gated; 20-11 (journal UI) can now build against `GET /api/journal/:calendarId/rules` and `PUT /api/journal/events/:hash/rules` directly, or the `get_rule_tags`/`set_rule_tags` MCP tools for Claude Code.
- No blockers.

## Self-Check: PASSED

All created files verified present on disk; all 5 commits (`4a3f07c`, `d2de636`, `155a473`, `ec6f4ff`, `ba16b26`) verified in `git log`; full-repo `bun run typecheck`, `bun run lint`, and `bun run test` (210 files / 2017 tests) all pass as of the final commit.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*
