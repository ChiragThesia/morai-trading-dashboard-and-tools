---
phase: 03-calendar-journal-mvp
plan: 07
subsystem: mcp-tools
tags: [mcp, tools, contracts, tdd]
dependency_graph:
  requires: ["03-03", "03-06"]
  provides: ["MCP-01", "MCP-02-all-six-tools"]
  affects: ["apps/server/src/adapters/mcp"]
tech_stack:
  added: []
  patterns:
    - "registerXxxTool(server, useCase) — thin adapter, contract parse at boundary, Date→ISO serialization"
    - "typed-empty stub tools: no use-case, no result.ok branch, constant {observations:[]}"
    - "args re-parse via z.string().uuid() at tool handler boundary (Pitfall 6)"
key_files:
  created: []
  modified:
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/main.ts
decisions:
  - "Date→ISO serialization in MCP tool handlers matches HTTP route behavior (MCP-02 shared contract)"
  - "journalNotFound() typed helper avoids 'as' assertions for ForReadingJournal null return path"
  - "trigger_job NOT registered (D-08 deferred to Phase 5)"
metrics:
  duration_minutes: 7
  completed_date: "2026-06-14"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 4
---

# Phase 03 Plan 07: MCP Tools (All Six) Summary

**One-liner:** Five new MCP tools registered via TDD red→green — list_calendars, get_journal, get_live_greeks (wrap use-cases) and get_term_structure, get_skew (typed-empty stubs) — with shared Zod contracts (MCP-02). Task 3 (live transport round-trip) awaits human verification.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 (RED) | Failing tests for 5 new MCP tools | f832db5 | Done |
| 1 (GREEN) | Register 5 new tools in tools.ts | 0230d9c | Done |
| 2 | Expand makeMcpRouter + wire in main.ts | 43ee95c | Done |
| 3 | Human verify — live transport round-trip | — | Awaiting human |

## Behaviors Delivered

### MCP-01: Six Tools Registered

All six MCP tools are now registered on every request through `makeMcpRouter`:

1. **get_status** — (pre-existing) DB health, token freshness, job runs
2. **list_calendars** — `listCalendarsResponse.parse({ calendars: ... })` sharing calendar contract with `GET /api/calendars`
3. **get_journal** — `journalResponse.parse({ snapshots: ... })` sharing journal contract with `GET /api/journal/:calendarId`; re-parses calendarId UUID at boundary; unknown ID → `{error:"not found"}` text (never throws)
4. **get_live_greeks** — `liveGreeksResponse.parse(...)` sharing live-greeks contract; re-parses calendarId UUID at boundary
5. **get_term_structure** — typed-empty `{observations:[]}` constant, no use-case, never an error (SPEC §7)
6. **get_skew** — typed-empty `{observations:[]}` constant, no use-case, never an error (SPEC §7)

**trigger_job** is NOT registered (D-08 ban, Phase 5).

### MCP-02: One Contract Per Tool-Route Pair

Each tool handler imports the same Zod schema as its HTTP route:

- `registerListCalendarsTool` → `listCalendarsResponse` (from `@morai/contracts`)
- `registerGetJournalTool` → `journalResponse`
- `registerGetLiveGreeksTool` → `liveGreeksResponse`

### Date Serialization at MCP Boundary

Core domain types (`Calendar.openedAt: Date`, `SnapshotRow.time: Date`) are serialized to ISO strings before contract parsing, mirroring the HTTP route pattern:

```
cal.openedAt.toISOString()   // matches calendarRoutes
row.time.toISOString()       // matches journalRoutes
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Date serialization required before listCalendarsResponse.parse**

- **Found during:** Task 1 GREEN phase (test revealed Zod parse error: "received Date, expected string")
- **Issue:** `registerListCalendarsTool` passed raw `Calendar[]` with `Date` objects to `listCalendarsResponse.parse`. Schema uses `z.string().datetime()` for `openedAt`.
- **Fix:** Added `.toISOString()` serialization in tool handler (same pattern as `calendarRoutes`). Same fix applied to `registerGetJournalTool` for `row.time`.
- **Files modified:** `apps/server/src/adapters/mcp/tools.ts`
- **Commit:** 0230d9c

**2. [Rule 1 - Bug] Lint: no `as` assertions in test fake helpers**

- **Found during:** Task 2 lint pass
- **Issue:** Test fakes used `ok(null as unknown as ReadonlyArray<SnapshotRow>)` to satisfy ForReadingJournal type — violates typescript.md "no `as`" rule.
- **Fix:** Added typed `journalNotFound()` helper function returning `Result<ReadonlyArray<SnapshotRow> | null, StorageError>` with `ok(null)`. Also replaced `toolsModule as unknown as Record<string, unknown>` with `Object.keys(toolsModule)`.
- **Files modified:** `apps/server/src/adapters/mcp/mcp.test.ts`
- **Commit:** 43ee95c

## TDD Gate Compliance

- RED commit: `f832db5` — `test(03-07): add failing tests for 5 new MCP tools (RED)` — 7 tests failing (correct reason: functions not yet defined)
- GREEN commit: `0230d9c` — `feat(03-07): register 5 new MCP tools in tools.ts (GREEN)` — all 16 tests passing
- Wiring commit: `43ee95c` — `feat(03-07): expand makeMcpRouter to wire all six MCP tools`

## Verification

### Automated (Tasks 1-2)

```
bun run test --run mcp.test  → 16 passed
bun run typecheck            → clean (tsc --build --force exits 0)
bun run lint                 → clean (only pre-existing boundary warnings)
```

Pre-existing Postgres contract test failures (calendar-snapshots, calendars, leg-observations) are **unrelated to this plan** — documented in STATE.md Deferred Items since Phase 03 P06.

### Awaiting (Task 3)

Task 3 is a `checkpoint:human-verify` — the live Claude Code MCP client round-trip cannot be automated. See checkpoint details below.

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-03-19: malicious calendarId | `z.string().uuid()` re-parse at boundary in get_journal + get_live_greeks handlers |
| T-03-20: error leakage | term-structure/skew: constant payload, no DB call; get_journal unknown → flat `{error:"not found"}` |
| T-03-21: trigger_job elevation | NOT registered; grep-verified absent from tools.ts |

## Known Stubs

- `get_term_structure` and `get_skew` tools return `{observations:[]}` intentionally (Phase 6 analytics stub). Documented in tool JSDoc and SPEC §7.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond the plan's threat model.

## Self-Check

- [x] `apps/server/src/adapters/mcp/tools.ts` — exports all 5 new functions (grep confirmed)
- [x] `apps/server/src/adapters/mcp/server.ts` — calls all 6 register functions in makeServerAndTransport
- [x] `apps/server/src/main.ts` — passes 5 args to makeMcpRouter
- [x] Commits: f832db5 (RED), 0230d9c (GREEN), 43ee95c (wiring) — verified via git log
- [x] trigger_job: NOT in tools.ts (grep returns 0 matches)
- [x] All 16 MCP tests pass; typecheck and lint clean
