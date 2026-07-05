---
phase: 22-journal-calendar-lifecycle-graph
plan: 03
subsystem: api
tags: [use-case, http-route, mcp-tool, tdd, hexagonal-core, jwt-gated]
status: complete

dependency-graph:
  requires:
    - phase: 22-journal-calendar-lifecycle-graph
      provides: "22-01's computeForwardVol + lifecycleResponse contract"
    - phase: 22-journal-calendar-lifecycle-graph
      provides: "22-02's computeAttributionSeries + AttributionPoint"
  provides:
    - "makeGetCalendarLifecycleUseCase / ForRunningGetCalendarLifecycle / LifecycleSnapshot (@morai/core)"
    - "GET /api/journal/:calendarId/lifecycle (JWT-gated, apps/server)"
    - "get_journal_lifecycle MCP tool (apps/server)"
  affects:
    - packages/contracts/src/index.ts
    - apps/server/src/main.ts

tech-stack:
  added: []
  patterns:
    - "Thin single-port use-case forwarder (mirrors getJournal.ts's ok(null)/ok([])/err three-way Result contract)"
    - "Route/MCP tool pair sharing ONE Zod contract (MCP-02), mounted only via apiRouter/authReadGroup (never app directly)"

key-files:
  created:
    - packages/core/src/journal/application/getCalendarLifecycle.ts
    - packages/core/src/journal/application/getCalendarLifecycle.test.ts
    - apps/server/src/adapters/http/journal-lifecycle.routes.ts
    - apps/server/src/adapters/http/journal-lifecycle.routes.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/contracts/src/index.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/main.ts

decisions:
  - "computeForwardVol's `guard` field is mapped explicitly to `forwardVolGuard` (never spread blindly), avoiding a stray `guard` key on the wire payload."
  - "No separate getCalendarById existence pre-check in the route — getCalendarLifecycle's own ok(null) already distinguishes unknown-calendar from zero-snapshots (single-port contract, unlike journal-rules' two-port idiom)."
  - "Fixed a Rule-1 bug from Wave 1: lifecycleResponse/lifecycleSnapshotResponse were added to packages/contracts/src/journal.ts by plan 22-01 but never re-exported from packages/contracts/src/index.ts, making the contract unreachable via '@morai/contracts' (the barrel every adapter actually imports from). Added the missing export lines."

metrics:
  duration: "~35 min"
  completed: "2026-07-05"
---

# Phase 22 Plan 03: getCalendarLifecycle Use-Case + JWT-Gated Route + MCP Tool Summary

One-liner: A thin hexagon-pure `getCalendarLifecycle` use-case wraps the existing
`ForReadingJournal` port, mapping every row through 22-01's `computeForwardVol` and 22-02's
`computeAttributionSeries`, exposed via a new JWT-gated `GET /api/journal/:calendarId/lifecycle`
route and a parallel `get_journal_lifecycle` MCP tool — both parsed through the single
`lifecycleResponse` contract.

## What Was Built

**Task 1 — `getCalendarLifecycle` use-case (RED→GREEN, TDD):**
- `packages/core/src/journal/application/getCalendarLifecycle.ts` — `makeGetCalendarLifecycleUseCase(deps)`
  returns `ForRunningGetCalendarLifecycle`, a thin forwarder over `ForReadingJournal`. Propagates
  `err(result.error)` immediately on port failure; passes through `ok(null)` (unknown calendar)
  and `ok([])` (known, zero snapshots) without collapsing them; on `ok([...rows])` maps each row
  through `computeForwardVol` (mapping its `guard` field explicitly to `forwardVolGuard`, never
  spread blindly) and `computeAttributionSeries`, producing `LifecycleSnapshot[]` (SnapshotRow &
  `{forwardVol, forwardVolGuard}` & `AttributionPoint`).
- `getCalendarLifecycle.test.ts` — 4 tests: `ok(null)` passthrough, `ok([])` passthrough,
  `err(StorageError)` propagation, and enrichment field presence + the `forwardVolGuard`/no-stray-`guard`
  assertion, using an in-memory `readJournal` double (mirrors `getCalendarEventsWithRules.test.ts`).
- RED confirmed first: `Cannot find module './getCalendarLifecycle.ts'` (import error) before
  implementation existed.
- Exported `makeGetCalendarLifecycleUseCase` + `ForRunningGetCalendarLifecycle` + `LifecycleSnapshot`
  from both `packages/core/src/journal/index.ts` and the top-level `packages/core/src/index.ts`.

**Task 2 — JWT-gated route (RED→GREEN, TDD):**
- `apps/server/src/adapters/http/journal-lifecycle.routes.ts` — `journalLifecycleRoutes(getCalendarLifecycle)`
  returns a Hono router with `GET /journal/:calendarId/lifecycle`: `err` → 500 `{error:"internal"}`;
  `ok(null)` → 404 `{error:"not found"}`; `ok([...rows])` → 200, body parsed through `lifecycleResponse`
  with `time` serialised to ISO string. Zero business logic in the handler — no separate
  `getCalendarById` existence pre-check needed since the use-case's own `ok(null)` already
  distinguishes unknown-calendar.
- `journal-lifecycle.routes.test.ts` — 5 tests: 200 enriched shape (asserts `forwardVol`,
  `forwardVolGuard`, `isGap`, `cumTheta` on the parsed body), 404 for `ok(null)`, 200 empty for
  `ok([])`, 500 with no DB-string leak for `err(...)` (T-03-16), and calendarId pass-through.
- RED confirmed first: `Cannot find module './journal-lifecycle.routes.ts'`.
- **Rule 1 bug found + fixed while implementing:** the route imports `lifecycleResponse` from
  `@morai/contracts`, but 22-01 had only added `lifecycleSnapshotResponse`/`lifecycleResponse` to
  `packages/contracts/src/journal.ts` — never re-exporting them from `packages/contracts/src/index.ts`
  (the top-level barrel every consumer actually imports from). The import resolved to `undefined`,
  causing a `TypeError` inside `.parse(...)` that surfaced as an unexpected 500 on all 200-path
  tests. Fixed by adding the missing export lines to the contracts barrel.

**Task 3 — MCP tool + composition mount:**
- `apps/server/src/adapters/mcp/tools.ts` — `registerGetJournalLifecycleTool(server, getCalendarLifecycle)`,
  copying `registerGetJournalTool`'s shape verbatim: tool `get_journal_lifecycle`, `inputSchema:
  {calendarId: z.string().uuid()}`, safeParse-at-boundary, `!result.ok` → internal-error text,
  `ok(null)` → not-found text, else `lifecycleResponse.parse({snapshots: ...})` returned as JSON text.
- `apps/server/src/adapters/mcp/server.ts` — added `getCalendarLifecycle?: ForRunningGetCalendarLifecycle`
  as the last optional param on `makeMcpRouter`; registers the tool when present.
- `apps/server/src/main.ts` — composed `getCalendarLifecycle` from `calendarSnapshotsRepo.readJournal`
  (no new repo); mounted `journalLifecycleRoutes(getCalendarLifecycle)` via `.route("/", ...)` INTO
  `apiRouter` (nested under `authReadGroup`) — never on `app` directly (T-22-05); passed
  `getCalendarLifecycle` into the `makeMcpRouter(...)` positional call in the matching new tail
  position.
- Pure composition-root wiring — TDD-exempt per `tdd.md` Scope; verified via the full existing
  MCP suite (unaffected by the new trailing optional param) + typecheck.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing lifecycle contract re-export in the contracts barrel**
- **Found during:** Task 2 (route implementation) — the "200 enriched" and "200 empty" route
  tests both unexpectedly returned 500 instead of 200.
- **Issue:** `lifecycleSnapshotResponse`/`lifecycleResponse`/`LifecycleResponse` were added to
  `packages/contracts/src/journal.ts` by plan 22-01, but 22-01 only touched `journal.ts` — never
  `packages/contracts/src/index.ts`, the top-level barrel that `@morai/core`/`apps/server` actually
  import from. `import { lifecycleResponse } from "@morai/contracts"` resolved to `undefined`,
  so `lifecycleResponse.parse(...)` threw a `TypeError` inside the route handler.
- **Fix:** Added `export { lifecycleSnapshotResponse, lifecycleResponse } from "./journal.ts";`
  and the matching `export type { LifecycleSnapshotResponse, LifecycleResponse }` to
  `packages/contracts/src/index.ts`.
- **Files modified:** `packages/contracts/src/index.ts`
- **Commit:** `da1b333`

Or: no other deviations — the rest of the plan executed exactly as written.

## Verification

```
$ bunx vitest run packages/core/src/journal/application/getCalendarLifecycle.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)

$ bunx vitest run apps/server/src/adapters/http/journal-lifecycle.routes.test.ts
Test Files  1 passed (1)
     Tests  5 passed (5)

$ bun run typecheck
$ tsc --build --force
(clean, no output)

$ bunx vitest run apps/server/src/adapters/mcp/mcp.test.ts apps/server/src/adapters/http/journal-lifecycle.routes.test.ts
Test Files  2 passed (2)
     Tests  37 passed (37)

$ bunx eslint packages/core/src/journal/application/getCalendarLifecycle.ts packages/core/src/journal/application/getCalendarLifecycle.test.ts packages/core/src/journal/index.ts packages/core/src/index.ts packages/contracts/src/index.ts apps/server/src/adapters/http/journal-lifecycle.routes.ts apps/server/src/adapters/http/journal-lifecycle.routes.test.ts apps/server/src/adapters/mcp/tools.ts apps/server/src/adapters/mcp/server.ts apps/server/src/main.ts
(clean — only pre-existing informational boundary-selector warnings, no errors)

$ bunx vitest run apps/server/
Test Files  21 passed (21)
     Tests  225 passed (225)

$ bunx vitest run packages/core/
Test Files  60 passed (60)
     Tests  566 passed (566)
```

Structural confirmation: `apps/server/src/main.ts` mounts `journalLifecycleRoutes(getCalendarLifecycle)`
via `.route("/", ...)` inside the `apiRouter` chain, which is itself nested under `authReadGroup`
(`authReadGroup.route("/", apiRouter)` → `app.route("/api", authReadGroup)`) — never mounted
directly on `app`.

## Task Commits

1. **Task 1 (RED):** `f3e586d` test(22-03): add failing test for getCalendarLifecycle use-case
2. **Task 1 (GREEN):** `3363ac1` feat(22-03): implement getCalendarLifecycle use-case (JRNL-01)
3. **Task 2 (RED):** `c4e2354` test(22-03): add failing test for GET /api/journal/:calendarId/lifecycle route
4. **Task 2 (GREEN + Rule 1 fix):** `da1b333` feat(22-03): implement journalLifecycleRoutes + fix missing lifecycle contract barrel export
5. **Task 3 (composition wiring):** `1f1fff1` feat(22-03): register get_journal_lifecycle MCP tool + mount lifecycle route (JRNL-01)

## TDD Gate Compliance

- Task 1: RED (`f3e586d`) precedes GREEN (`3363ac1`) in git log. Gate satisfied.
- Task 2: RED (`c4e2354`) precedes GREEN (`da1b333`) in git log. Gate satisfied.
- Task 3 (`type="auto"`, pure composition wiring) is TDD-exempt per `tdd.md` Scope ("pure wiring
  in composition roots"); verified via the existing MCP suite + typecheck instead.

## Known Stubs

None — the route, use-case, and MCP tool are all fully wired against real (test-doubled) ports;
no hardcoded empty/placeholder data flows to any consumer.

## Threat Flags

None beyond what the plan's own `<threat_model>` already names (T-22-05 through T-22-08, all
mitigated per the plan and confirmed in Verification above).

## Next Phase Readiness

- `useLifecycle` (plan 22-04) can now call `GET /api/journal/:calendarId/lifecycle` and parse the
  response through `lifecycleResponse` from `@morai/contracts`.
- `LifecycleSnapshot` (core) and `LifecycleSnapshotResponse`/`LifecycleResponse` (contracts) are
  both exported and ready for the web hook's typing.
- No blockers for Plans 22-04/22-05.

## Self-Check

- `packages/core/src/journal/application/getCalendarLifecycle.ts` — FOUND
- `packages/core/src/journal/application/getCalendarLifecycle.test.ts` — FOUND
- `apps/server/src/adapters/http/journal-lifecycle.routes.ts` — FOUND
- `apps/server/src/adapters/http/journal-lifecycle.routes.test.ts` — FOUND
- Commit `f3e586d` (RED, use-case) — FOUND in `git log`
- Commit `3363ac1` (GREEN, use-case) — FOUND in `git log`
- Commit `c4e2354` (RED, route) — FOUND in `git log`
- Commit `da1b333` (GREEN, route + contract fix) — FOUND in `git log`
- Commit `1f1fff1` (MCP tool + mount) — FOUND in `git log`

## Self-Check: PASSED
