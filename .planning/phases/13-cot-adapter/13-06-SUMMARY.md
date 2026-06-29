---
phase: 13-cot-adapter
plan: "06"
subsystem: server-adapters
tags: [cot, mcp, http-route, analytics, mcp-02, cot-02]
status: complete

dependency_graph:
  requires:
    - 13-04  # makeGetCotUseCase + ForRunningGetCot exported from @morai/core
    - 13-03  # makePostgresCotObservationsRepo available from @morai/adapters
  provides:
    - GET /api/analytics/cot — cotResponse JSON array over the shared contract
    - MCP get_cot tool — same cotResponse payload from the same use-case (MCP-02)
  affects:
    - apps/server/src/adapters/http/analytics.routes.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/main.ts

tech_stack:
  added: []
  patterns:
    - cotResponse.parse(result.value) — direct parse, no Date serialisation (CotEntry already plain strings/ints)
    - ForRunningGetCot injected once in main.ts; passed to both route + MCP (MCP-02 single source)
    - Optional getCot? in makeMcpRouter (matches getGex? pattern, backward-compat with existing call sites)

key_files:
  modified:
    - apps/server/src/adapters/http/analytics.routes.ts
    - apps/server/src/adapters/http/analytics.routes.test.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/main.ts

decisions:
  - "Direct cotResponse.parse(result.value) — CotEntry is structurally identical to cotSeriesEntry; no intermediate mapping needed (unlike skew/term-structure which have Date snapshotTime)"
  - "getCot? optional in makeMcpRouter (after getGex?) — matches existing GEX pattern; backward-compatible with all existing test call sites that omit optional params"

metrics:
  duration: "9 minutes"
  completed: "2026-06-29"
  tasks_completed: 2
  tests_added: 5
  tests_passing: 37
---

# Phase 13 Plan 06: COT Route + MCP Tool Summary

COT series exposed on both read surfaces via single makeGetCotUseCase instance — GET /api/analytics/cot and MCP get_cot share cotResponse from one composition-root wiring.

## What Was Built

### Task 1: GET /api/analytics/cot Route

Added `/analytics/cot` GET handler to `analyticsRoutes`. The handler calls `ForRunningGetCot`, maps `Result` to JSON, and validates output through `cotResponse.parse` (shared contract). Empty store returns `200 + []`, not an error. Storage error returns `500 + {error:"internal"}` (flat, no DB internals exposed — T-13-06-INJ).

Key implementation note: `CotEntry` (from the use-case) has all fields as plain strings and integers — `publishedAt` is already `.toISOString()` output, `asOf` is already `YYYY-MM-DD`. Unlike `skew`/`term-structure` which have a `Date snapshotTime` requiring serialisation, COT uses `cotResponse.parse(result.value)` directly without a mapping step.

`main.ts` wires: `makePostgresCotObservationsRepo(db).listCotObservations` → `makeGetCotUseCase` → `getCot` const → passed to both `analyticsRoutes(getTermStructure, getSkew, getCot)` and `makeMcpRouter(..., getGex, getCot, ...)`.

Tests added (3): data → 200 + contract-valid array; empty → 200 + []; error → 500 + flat.

### Task 2: get_cot MCP Tool (MCP-02)

Added `registerGetCotTool` to `tools.ts` — mirrors `registerGetGexTool` pattern. Registered in `makeMcpRouter` as `getCot?: ForRunningGetCot` (optional, after `getGex?`), guarded by `if (getCot !== undefined)`.

The tool calls the same `getCot` instance as the HTTP route (single `makeGetCotUseCase` in `main.ts`), satisfying MCP-02. `cotResponse.parse(result.value)` validates the payload; empty array returns normally (never an error).

Tests added (2): tool registers without throw + cotResponse-valid payload; empty → `cotResponse.parse([])` equals `[]`.

## Acceptance Criteria Verification

- `rg -n "/cot" analytics.routes.ts` → matches `router.get("/analytics/cot", ...)` ✓
- `rg -n "get_cot" server.ts` → matches tool registration + comment ✓
- Route and MCP reference same `getCot` use-case (grepped in `main.ts`: single instance passed to both) ✓
- Empty store → 200 + `[]` on both surfaces ✓
- `bun run typecheck` clean ✓
- `bun run lint` clean ✓
- 37 tests passing (26 MCP + 11 route) ✓

## Deviations from Plan

None — plan executed exactly as written.

The only notable implementation detail: `cotResponse.parse(result.value)` is direct (no field mapping) because `CotEntry` is already in the contract's expected shape. The plan anticipated this ("the field names already align") and it held.

## Threat Surface Scan

No new trust boundaries introduced. `GET /api/analytics/cot` is read-only public CFTC data, no request body, no mutation — same exposure class as existing gex/skew analytics routes (T-13-06-IDOR: accepted per plan). T-13-06-INJ mitigated: no user-controlled query parameters; output validated through `cotResponse` Zod contract before send. T-13-06-DOS: COT is a small weekly series naturally bounded.

## Self-Check: PASSED

- analytics.routes.ts: FOUND
- server.ts: FOUND
- tools.ts: FOUND
- Commit adb366d (Task 1): FOUND
- Commit 5991f53 (Task 2): FOUND
