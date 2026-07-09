---
phase: 26-exit-advisor
plan: 05
subsystem: server
tags: [exits, http-route, mcp-tool, mcp-02-parity, composition-root]

requires:
  - phase: 26-exit-advisor plan 04
    provides: makeGetExitAdviceUseCase (ExitAdviceSnapshot/HeldPositionVerdict read use-case)
provides:
  - apps/server/src/adapters/http/exits.routes.ts — GET /api/exits
  - apps/server/src/adapters/mcp/tools.ts — get_exit_advice MCP tool
  - domain-to-contract flattening pattern for ExitVerdict -> heldPositionVerdict (both surfaces)
affects: [26-exit-advisor plan 06 (Analyzer held-positions panel consumes GET /api/exits via a
  new useExits hook, mirroring usePicker's 404-cold-start convention)]

tech-stack:
  added: []
  patterns:
    - "domain->contract flattening at the adapter boundary: ExitAdviceSnapshot's HeldPositionVerdict
      nests the evaluator's full ExitVerdict object under a `verdict` key; the contracts
      heldPositionVerdict schema flattens rung/ruleId/metric/indicative/escalate/roll to top-level
      siblings. Both exits.routes.ts and tools.ts perform the IDENTICAL flattening inline (not a
      shared helper — two ~15-line map calls, not worth a third file per ponytail's one-line rung)"
    - "MCP-02 parity proven by literal payload equality, not just independent schema validation:
      tools.test.ts calls both the MCP tool (via a real McpServer + InMemoryTransport) and the HTTP
      route (via app.request) against the SAME use-case double and asserts
      toolPayload toStrictEqual routePayload — a stronger guarantee than two `.parse()` calls that
      could each independently satisfy the schema while still disagreeing on values"

key-files:
  created:
    - apps/server/src/adapters/http/exits.routes.ts
    - apps/server/src/adapters/http/exits.routes.test.ts
  modified:
    - apps/server/src/main.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/tools.test.ts
    - apps/server/src/adapters/mcp/server.ts

key-decisions:
  - "Cold-start error string is {error:'no-verdicts'} (not picker's 'no-snapshot') — a
    plan-mandated NEW string for a distinct resource, still on the picker route's 404 status-code
    convention. apps/web/src/hooks/usePicker.ts's cold-start check is `res.status === 404` only
    (never reads the error string), so 26-06's future useExits hook can reuse the exact same
    status-only check with no coupling to this string."
  - "main.ts's composition-root mapping closures (mapCalendarToHeldPosition,
    mapSnapshotToLatestSnapshotForCalendar, readHeldPositionsForExits,
    readLatestSnapshotForExits) are a verbatim duplicate of apps/worker/src/main.ts's 26-04
    closures — NOT extracted into a shared helper. Each app composes its own root
    (architecture-boundaries.md: 'process.env read ONCE... in the composition root'); server and
    worker are separate deployables with separate main.ts entrypoints, and neither imports the
    other. Duplicating ~30 lines across two composition roots is the correct hexagonal outcome,
    not drift."
  - "main.ts was split across both task commits along its natural dependency seam: the
    getExitAdvice use-case construction + GET /api/exits mount (task 1, self-contained) landed
    first; the one-line `getExitAdvice,` passthrough into makeMcpRouter(...) (task 2, requires
    server.ts's new optional param + tools.ts's registerGetExitAdviceTool to already exist) landed
    with task 2. Both commits typecheck and pass their scoped tests independently — no
    intermediate broken-build commit."

requirements-completed: [EXIT-08]

coverage:
  - id: D1
    description: "GET /api/exits returns the exitsResponse payload from getExitAdvice on success, mounted inside the existing authenticated apiRouter"
    requirement: "EXIT-08"
    verification:
      - kind: integration
        ref: "apps/server/src/adapters/http/exits.routes.test.ts — 'GET /exits' describe block (5 cases: 200/404-cold-start/500-internal/schema-parity/no-message-leak)"
        status: pass
    human_judgment: false
  - id: D2
    description: "get_exit_advice MCP tool returns the SAME schema as GET /api/exits (MCP-02 parity), exercised over a real McpServer + InMemoryTransport"
    requirement: "EXIT-08"
    verification:
      - kind: integration
        ref: "apps/server/src/adapters/mcp/tools.test.ts — 'get_exit_advice MCP tool' describe block, esp. the 'MCP-02 parity' case asserting toolPayload toStrictEqual routePayload"
        status: pass
    human_judgment: false
  - id: D3
    description: "A StorageError maps to a flat {error:'internal'} on both surfaces — no DB internals leak"
    requirement: "T-26-13"
    verification:
      - kind: unit
        ref: "exits.routes.test.ts 'does not leak storage-error internals' + tools.test.ts 'returns internal error text on a storage error (never throws)'"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-09
status: complete
---

# Phase 26 Plan 05: GET /api/exits + get_exit_advice MCP Tool Summary

**GET /api/exits and get_exit_advice both call the one getExitAdvice use-case and emit the one contracts exitsResponse schema, with a byte-for-byte MCP-02 parity test — the browser and Claude Code read identical exit verdicts.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (each TDD, committed at green)
- **Files modified/created:** 6 (2 created, 4 modified)

## Accomplishments

- `exitRoutes(getExitAdvice)`: mirrors `pickerRoutes` exactly — 200 with the flattened
  `exitsResponse` body on `ok(snapshot)`, 404 `{error:'no-verdicts'}` on `ok(null)` (cold
  start), 500 `{error:'internal'}` on a `StorageError` (no message passthrough, T-26-13).
  Mounted at `GET /api/exits` inside the same authenticated `apiRouter` group as
  `/api/picker/candidates` — no new auth code (T-26-15).
- `registerGetExitAdviceTool`: mirrors `registerGetPickerCandidatesTool` — no input schema,
  same cold-start/error mapping, registered as an optional param on `makeMcpRouter` (backward
  compat with existing call sites, matching every prior MCP-02 tool in this file).
- Both adapters perform the identical domain→contract flattening: `ExitAdviceSnapshot`'s
  `HeldPositionVerdict.verdict` nests the evaluator's full `ExitVerdict` object
  (`rung`/`ruleId`/`metric`/`indicative`/`escalate`/`roll`); the contract's `heldPositionVerdict`
  hoists those to top-level siblings alongside `changed`/`pnlPct`/`basis` — exactly the mapping
  26-04-SUMMARY.md's "Next Phase Readiness" flagged as this plan's job.
- `main.ts` wiring: `getExitAdvice` is constructed from `calendarsRepo` +
  `calendarSnapshotsRepo` (both already built for other use-cases) via composition-root mapping
  closures (`mapCalendarToHeldPosition`, `mapSnapshotToLatestSnapshotForCalendar`) that are a
  verbatim mirror of `apps/worker/src/main.ts`'s 26-04 closures — each app composes its own root,
  so this is intentional duplication, not drift (see key-decisions).
- `tools.test.ts`'s MCP-02 parity test is stronger than a schema-only check: it drives the real
  MCP tool through `McpServer` + `InMemoryTransport` AND the real HTTP route through
  `app.request`, both against the same `getExitAdviceOk` double, and asserts
  `toolPayload toStrictEqual routePayload` — literal payload equality, not just two independent
  `.parse()` calls that could each pass while still disagreeing.
- Full suite: 2487/2487 passing (up from the pre-plan baseline of 2478 — 9 net new tests: 5 route
  + 4 MCP). `bun run typecheck` and `bun run lint` both clean.

## Task Commits

1. **Task 1: GET /api/exits route + server wiring**
   - `10c3dce` — feat(26-05): GET /api/exits route + server wiring
2. **Task 2: get_exit_advice MCP tool + MCP-02 parity test**
   - `f1be3ff` — feat(26-05): get_exit_advice MCP tool + MCP-02 parity test

_No separate "plan metadata" commit exists per this project's `commit_docs` setting — see State
Updates below._

## Files Created/Modified

- `apps/server/src/adapters/http/exits.routes.ts` - GET /exits route (200/404/500 + flattening)
- `apps/server/src/adapters/http/exits.routes.test.ts` - 5 tests
- `apps/server/src/main.ts` - getExitAdvice use-case wiring + apiRouter mount + mcpRouter param
- `apps/server/src/adapters/mcp/tools.ts` - registerGetExitAdviceTool
- `apps/server/src/adapters/mcp/tools.test.ts` - 4 new tests incl. the MCP-02 parity assertion
- `apps/server/src/adapters/mcp/server.ts` - optional `getExitAdvice` param on `makeMcpRouter`

## Decisions Made

- **Cold-start error string `{error:'no-verdicts'}`** (distinct from picker's `'no-snapshot'`,
  same 404 status-code convention) — see key-decisions above.
- **Composition-root mapping closures duplicated (not shared) between server and worker
  `main.ts`** — see key-decisions above; each app owns its own root per
  architecture-boundaries.md.
- **`main.ts` split across both task commits at its natural dependency seam** — the
  self-contained `getExitAdvice`/route-mount half in task 1, the one-line `mcpRouter(...,
  getExitAdvice)` passthrough (which requires task 2's `server.ts` signature change and
  `tools.ts` function to already exist) in task 2. Both commits typecheck independently.
- **MCP-02 parity test asserts literal payload equality**, not just two independent schema
  parses — a stronger guard against silent value-level drift between the two adapters.

## Deviations from Plan

None — plan executed exactly as written. Both `<read_first>` precedents (picker.routes.ts,
get_picker_candidates registration + test) mapped directly onto the exits equivalents with no
architectural surprises; the domain→contract flattening shape was already fully specified by
26-04-SUMMARY.md's "Next Phase Readiness" note.

## TDD Gate Compliance

Both tasks followed genuine RED→GREEN: the test file was written against the not-yet-existing
implementation, run first to confirm import-level RED failure (`Cannot find module`, Task 1;
`registerGetExitAdviceTool is not a function`, Task 2 — both the right *kind* of failure, not a
syntax/typo accident), then the implementation was restored/added and the same suite re-run to
confirm GREEN before committing. No commit landed with a failing suite.

## Issues Encountered

None. No auth gates, no blocking issues, no auto-fixes beyond the plan's own scope.

## User Setup Required

None — no external service configuration required. `GET /api/exits` and `get_exit_advice`
activate automatically once these commits deploy (no new migration, no new env var — 26-03's
migration 0020 already covers `exit_verdicts`, and 26-04's chain trigger already populates it).

## Next Phase Readiness

- 26-06 (Analyzer held-positions panel) can now build `useExits.ts` mirroring `usePicker.ts`
  exactly — same 404-status-only cold-start check, same react-query GET pattern — against the
  live `GET /api/exits` route this plan ships.
- No blockers. Both surfaces are live, schema-locked via `exitsResponse`, and byte-for-byte
  parity-proven.

---
*Phase: 26-exit-advisor*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 2 created files found on disk; both task commits (`10c3dce`, `f1be3ff`) found in git history.
Full suite 2487/2487 passing, `bun run typecheck` and `bun run lint` both clean at time of
writing.
