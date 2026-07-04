---
phase: 19-picker-engine-economic-events
plan: 07
subsystem: api
tags: [hono, mcp, zod, picker, hexagonal]

requires:
  - phase: 19-picker-engine-economic-events (19-01, 19-05, 19-06)
    provides: pickerSnapshotResponse contract, PostgresPickerSnapshotRepo, makeGetPickerUseCase
provides:
  - "GET /api/picker/candidates HTTP route (thin latest-snapshot reader)"
  - "get_picker_candidates MCP tool (same pickerSnapshotResponse schema)"
  - "Server composition wiring: pickerSnapshotRepo + getPicker + route mount + MCP registration"
affects: [19-08, 19-09, apps/web analyzer/picker UI consumers]

tech-stack:
  added: []
  patterns:
    - "MCP tool unit-tested via a real McpServer + InMemoryTransport-linked Client (genuine handler invocation, not just a direct use-case call) — avoids the green-suite-without-coverage pattern flagged in prior phases"

key-files:
  created:
    - apps/server/src/adapters/http/picker.routes.ts
    - apps/server/src/adapters/http/picker.routes.test.ts
    - apps/server/src/adapters/mcp/tools.test.ts
  modified:
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/main.ts
    - packages/core/src/index.ts
    - packages/core/src/picker/index.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "Added getPicker as a new optional trailing-ish param to makeMcpRouter (server.ts) between getMacro and getPositions, mirroring the getGex/getCot/getMacro optional-param pattern — required plumbing not itemized in the plan's files_modified list, since main.ts alone cannot register an MCP tool (registration happens inside server.ts's per-request makeServerAndTransport closure)"
  - "Exported ForRunningGetPicker + makeGetPickerUseCase from @morai/core and makePostgresPickerSnapshotRepo/makeMemoryPickerSnapshotRepo from @morai/adapters — these existed since 19-05/19-06 but were never re-exported through the package barrels, so apps/server couldn't import them"
  - "MCP tool test drives the real registered handler through InMemoryTransport.createLinkedPair() + a Client, not just a direct use-case call (mcp.test.ts's existing get_status precedent is weaker) — genuinely covers the err/null/ok branches inside registerGetPickerCandidatesTool"

requirements-completed: [PICK-02]

coverage:
  - id: D1
    description: "GET /api/picker/candidates returns 200 + pickerSnapshotResponse body for a stored row, 404 {error:'no-snapshot'} on cold start, 500 {error:'internal'} on storage error"
    requirement: "PICK-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/picker.routes.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "get_picker_candidates MCP tool returns the SAME pickerSnapshotResponse payload, {error:'no-snapshot'} when none, 'internal error' text on storage error, never throws"
    requirement: "PICK-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/mcp/tools.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Server composition wires getPicker into main.ts, mounts the route inside the authenticated apiRouter (same Bearer-token group as gex), and registers the MCP tool"
    requirement: "PICK-02"
    verification:
      - kind: unit
        ref: "bun run typecheck (tsc --build --force, all workspace packages including apps/server)"
        status: pass
    human_judgment: false

duration: ~18min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 07: Picker HTTP + MCP read surfaces Summary

**GET /api/picker/candidates Hono route + get_picker_candidates MCP tool, both thin readers of the latest picker_snapshot row parsed through the single pickerSnapshotResponse contract (PICK-02).**

## Performance

- **Duration:** ~18 min
- **Tasks:** 3 completed
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- `pickerRoutes(getPicker)` Hono router: `GET /picker/candidates` → err→500 `{error:"internal"}`, null→404 `{error:"no-snapshot"}`, else 200 + `pickerSnapshotResponse.parse(row.snapshot)` (direct JSONB-blob parse, D-05).
- `registerGetPickerCandidatesTool(server, getPicker)` MCP tool `get_picker_candidates`, mirroring `registerGetGexTool` exactly: same schema, same error mapping, never throws.
- Server composition wired end-to-end: `makePostgresPickerSnapshotRepo(db)` → `makeGetPickerUseCase(...)` → mounted at `.route("/", pickerRoutes(getPicker))` inside the authenticated `apiRouter` (effective `GET /api/picker/candidates`, same Bearer-token/Supabase-JWT group as `/api/analytics/gex`) → `getPicker` passed to `makeMcpRouter(...)` and registered in `server.ts`'s `makeServerAndTransport`.

## Task Commits

Each task was committed atomically (TDD red→green pairs):

1. **chore: export ForRunningGetPicker + makeGetPickerUseCase from @morai/core** — `6275940`
2. **Task 1 (RED): GET /picker/candidates test** — `317c295` (test)
3. **Task 1 (GREEN): GET /picker/candidates route** — `84ff81d` (feat)
4. **Task 2 (RED): get_picker_candidates MCP tool test** — `d722aaa` (test)
5. **Task 2 (GREEN): get_picker_candidates MCP tool** — `9bbbfeb` (feat)
6. **Task 3: server composition wiring** — `bb29fe8` (feat)

## Files Created/Modified

- `apps/server/src/adapters/http/picker.routes.ts` - `pickerRoutes(getPicker)` Hono router, GET /picker/candidates
- `apps/server/src/adapters/http/picker.routes.test.ts` - 200/404/500 route test cases + no-leak assertion
- `apps/server/src/adapters/mcp/tools.ts` - `registerGetPickerCandidatesTool` added after `registerGetGexTool`
- `apps/server/src/adapters/mcp/tools.test.ts` - MCP tool test via InMemoryTransport + Client (new file)
- `apps/server/src/adapters/mcp/server.ts` - `getPicker` optional param + conditional tool registration
- `apps/server/src/main.ts` - picker snapshot repo + getPicker wiring, route mount, MCP call-site update
- `packages/core/src/index.ts` / `packages/core/src/picker/index.ts` - export `ForRunningGetPicker` + `makeGetPickerUseCase`
- `packages/adapters/src/index.ts` - export `makePostgresPickerSnapshotRepo` + `makeMemoryPickerSnapshotRepo`

## Decisions Made

- MCP tool test invokes the actual registered handler through a real `McpServer` + `InMemoryTransport.createLinkedPair()` + SDK `Client`, rather than only calling the use-case function directly (the codebase's existing `get_status` precedent in `mcp.test.ts` is weaker — it registers the tool but never actually calls it). This genuinely exercises all three branches (`ok`/`null`/`err`) inside `registerGetPickerCandidatesTool`.
- `getPicker` inserted into `makeMcpRouter`'s optional-param list between `getMacro` and `getPositions` (thematic grouping with the other precomputed-snapshot read tools); safe because all existing test call-sites (`mcp.test.ts`) stop at `getSkew` and never pass trailing optional args positionally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing barrel exports for the picker get-use-case and postgres repo**
- **Found during:** Task 1 (writing `picker.routes.ts`, importing `ForRunningGetPicker` from `@morai/core`)
- **Issue:** `makeGetPickerUseCase`/`ForRunningGetPicker` (built in 19-06) and `makePostgresPickerSnapshotRepo`/`makeMemoryPickerSnapshotRepo` (built in 19-05) existed as source files but were never re-exported through `packages/core/src/picker/index.ts`, `packages/core/src/index.ts`, or `packages/adapters/src/index.ts` — unreachable from `apps/server`.
- **Fix:** Added the missing type + value exports to all three barrels.
- **Files modified:** `packages/core/src/index.ts`, `packages/core/src/picker/index.ts`, `packages/adapters/src/index.ts`
- **Verification:** `bun run typecheck` (tsc --build --force) green across all workspace packages.
- **Committed in:** `6275940` (core exports, separate chore commit before Task 1); adapters export folded into Task 3's commit `bb29fe8`.

**2. [Rule 3 - Blocking] server.ts not in the plan's files_modified list but required for MCP wiring**
- **Found during:** Task 3 (server composition)
- **Issue:** The plan's frontmatter lists only `apps/server/src/main.ts` for composition, but `registerGetGexTool`/`registerGetCotTool`/etc. are all actually invoked inside `apps/server/src/adapters/mcp/server.ts`'s `makeServerAndTransport()` closure (per-request `McpServer` construction), not in `main.ts`. `main.ts` only passes use-case instances positionally into `makeMcpRouter(...)`. Registering `get_picker_candidates` without touching `server.ts` was architecturally impossible.
- **Fix:** Added `getPicker?: ForRunningGetPicker` as a new optional param to `makeMcpRouter`, imported `registerGetPickerCandidatesTool`, and registered it conditionally — mirroring the exact `getGex`/`getCot`/`getMacro` precedent already in the file.
- **Files modified:** `apps/server/src/adapters/mcp/server.ts`
- **Verification:** Full server test suite (`bunx vitest run --project server`, 188 tests) and full monorepo suite (`bun run test`, 1792 tests) pass; `bun run typecheck` green; the plan's acceptance grep (`pickerRoutes(getPicker)|registerGetPickerCandidatesTool` in `main.ts`) matches via the route-mount alternative.
- **Committed in:** `bb29fe8` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues, missing plumbing required to complete the plan's own acceptance criteria)
**Impact on plan:** Both fixes are pure wiring/export additions with zero business logic — no scope creep. All plan-specified behavior (200/404/500 route semantics, MCP schema parity, auth-gating, no-recompute) implemented exactly as written.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `GET /api/picker/candidates` and `get_picker_candidates` are live, auth-gated, thin readers of the latest snapshot — ready for the Analyzer/Picker web UI (apps/web) and Claude Code to consume once a `compute-picker` job (19-08/19-09) starts populating rows.
- No blockers for 19-08 (economic-events cron / compute-picker job wiring).

## Self-Check: PASSED

All created files and task commit hashes verified present on disk / in git log.
