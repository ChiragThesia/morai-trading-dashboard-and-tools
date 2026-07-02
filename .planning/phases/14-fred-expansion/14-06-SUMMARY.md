---
phase: 14-fred-expansion
plan: 06
subsystem: macro-data
tags: [hono, mcp, http-route, macro, tdd, mcp-02]

# Dependency graph
requires:
  - phase: 14-fred-expansion
    provides: "macroResponse/macroQuery/MACRO_SERIES_IDS contract (14-01); makeGetMacroUseCase/ForRunningGetMacro (14-04); makePostgresMacroObservationsRepo (14-03)"
provides:
  - "GET /api/analytics/macro — query-validated (days/series), contract-parsed, inherits the Supabase JWT gate by apiRouter placement"
  - "get_macro MCP tool — same macroResponse payload as the HTTP route over the ONE shared contract"
  - "server composition wiring: macro repo + getMacro use-case shared by both adapters"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Query-param validation at the HTTP boundary via macroQuery.safeParse before the use-case runs (T-14-01) — invalid input never reaches getMacro, mirroring the existing 'omit absent keys' object-building pattern used by /analytics/term-structure and /analytics/skew"
    - "MCP tool reuses the SAME macroQuery contract schema (not a locally-redeclared zod object) to validate {days?,series?} args — the HTTP route and MCP tool share literally one validation schema, not just one response schema"

key-files:
  created: []
  modified:
    - apps/server/src/adapters/http/analytics.routes.ts
    - apps/server/src/adapters/http/analytics.routes.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/main.ts

key-decisions:
  - "macroQuery.safeParse output is destructured into a conditionally-spread object (days/series omitted when absent) before calling getMacro — exactOptionalPropertyTypes rejects zod's `days?: number | undefined` shape against MacroSeriesQuery's `days?: number`; this mirrors the existing term-structure/skew route pattern rather than introducing a new one"
  - "get_macro's MCP inputSchema takes days as a plain number and series as a CSV string (matching the HTTP route's query-string shape), then reuses macroQuery.safeParse(args) directly inside the handler — the route and tool share one validation schema, not just one response schema"
  - "getMacro inserted into the makeMcpRouter(...) positional-optional-param list immediately after getCot (matching the read_first guidance); this shifted getPositions/getTransactions/getOrders/enqueueJob one position over in main.ts's call site, which Task 3 already had to update alongside adding getMacro itself"

patterns-established: []

requirements-completed: [MAC-02]

coverage:
  - id: D1
    description: "GET /api/analytics/macro returns the macroResponse-shaped map, validates days/series (400 on invalid, use-case never called), maps StorageError to a flat 500, and inherits the Supabase JWT gate by apiRouter placement"
    requirement: MAC-02
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/analytics.routes.test.ts (6 new tests: default window, forwarded days/series, invalid days->400, invalid series->400, empty map, StorageError->500)"
        status: pass
      - kind: other
        ref: "rg -n '/analytics/macro' apps/server/src/adapters/http/analytics.routes.ts"
        status: pass
      - kind: other
        ref: "rg -n 'macroResponse.parse' apps/server/src/adapters/http/analytics.routes.ts"
        status: pass
      - kind: other
        ref: "bun run typecheck (clean, whole repo)"
        status: pass
    human_judgment: false
  - id: D2
    description: "MCP get_macro returns the same macroResponse payload as the HTTP route over the ONE shared macroQuery/macroResponse contract, accepting optional {days,series}"
    requirement: MAC-02
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/mcp/mcp.test.ts (6 new tests: registers without throwing, default payload, {days,series} filter parity, invalid-args rejection, empty map, StorageError->flat internal-error content)"
        status: pass
      - kind: other
        ref: "rg -n 'registerGetMacroTool' apps/server/src/adapters/mcp/tools.ts apps/server/src/adapters/mcp/server.ts"
        status: pass
      - kind: other
        ref: "bun run typecheck (clean, whole repo)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both adapters are wired from one getMacro use-case in the server composition root; rate_observations/readRate/BSM wiring stays untouched (D-02)"
    requirement: MAC-02
    verification:
      - kind: other
        ref: "rg -n 'makeGetMacroUseCase|makePostgresMacroObservationsRepo' apps/server/src/main.ts"
        status: pass
      - kind: other
        ref: "rg -n 'analyticsRoutes\\(' apps/server/src/main.ts (shows getMacro passed as 4th arg)"
        status: pass
      - kind: integration
        ref: "bun run test -- --project server (172/172, whole server suite)"
        status: pass
      - kind: other
        ref: "bun run typecheck && bun run lint (both clean, whole repo)"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 06: Macro HTTP Route + MCP Tool (MAC-02 / MCP-02) Summary

**GET /api/analytics/macro and the get_macro MCP tool both validate {days,series} through the SAME macroQuery schema and return the SAME macroResponse payload, wired from one getMacro use-case in the server composition root.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-02T02:37:00Z (approx)
- **Completed:** 2026-07-02T02:41:20Z
- **Tasks:** 3 completed
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments

- Shipped `GET /api/analytics/macro` (MAC-02): reads optional `?days`/`?series` query params,
  validates them through `macroQuery.safeParse` BEFORE calling the use-case (T-14-01 — an invalid
  value returns 400 and `getMacro` is never invoked), calls `getMacro(query)` with the parsed
  values, maps a `StorageError` to a flat `{error:"internal"}` 500 (T-14-14 — no DB internals
  leaked), and always parses the response through `macroResponse` before `c.json(...)` (empty
  store → `{}`). Inherits the existing Supabase JWT gate purely by `apiRouter` placement — no new
  auth code.
- Shipped the `get_macro` MCP tool (MCP-02): mirrors `registerGetCotTool`'s shape but, unlike
  `get_cot`, takes optional `{days,series}` input — validated through the exact SAME `macroQuery`
  schema the HTTP route uses (not a re-declared duplicate), so the two adapters share one
  validation schema in addition to one response schema. Registered as an optional param on
  `makeMcpRouter` (backward-compat pattern matching `getCot`/`getGex`).
- Wired the server composition root: `makePostgresMacroObservationsRepo(db)` +
  `makeGetMacroUseCase(...)` constructed next to the existing `getCot` block, then `getMacro`
  passed as the fourth `analyticsRoutes(...)` argument and threaded into `makeMcpRouter(...)`
  immediately after `getCot`. `rate_observations`/`readRate`/BSM wiring is untouched (D-02).

## Task Commits

Tasks 1 and 2 followed the full TDD RED→GREEN cycle (no REFACTOR commits needed — each
implementation was already minimal at GREEN); Task 3 is pure composition-root wiring
(TDD-exempt per architecture-boundaries.md §6), single commit:

1. **Task 1: GET /api/analytics/macro route**
   - RED: `4f9a0ea` (test) — `bun run test -- --project server analytics.routes` failed (6/17, route/param missing)
   - GREEN: `8db4932` (feat) — 17/17 tests pass
2. **Task 2: get_macro MCP tool**
   - RED: `ccd0703` (test) — `bun run test -- --project server mcp` failed (6/37, `registerGetMacroTool` not a function)
   - GREEN: `36baa93` (feat) — 37/37 tests pass
3. **Task 3: server composition wiring**
   - `4804c1c` (feat) — `bun run typecheck` clean (whole repo); `bun run test -- --project server` 172/172 pass

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `apps/server/src/adapters/http/analytics.routes.ts` - added `GET /analytics/macro`; `getMacro: ForRunningGetMacro` is now the fourth `analyticsRoutes(...)` param
- `apps/server/src/adapters/http/analytics.routes.test.ts` - 6 new tests covering default window, days/series forwarding, invalid-param 400s (use-case not called), empty map, StorageError 500
- `apps/server/src/adapters/mcp/tools.ts` - added `registerGetMacroTool` mirroring `registerGetCotTool` but validating `{days?,series?}` via `macroQuery`
- `apps/server/src/adapters/mcp/server.ts` - added optional `getMacro?: ForRunningGetMacro` param + `if (getMacro !== undefined) registerGetMacroTool(...)` wiring, positioned after `getCot`
- `apps/server/src/adapters/mcp/mcp.test.ts` - 6 new tests covering registration, default payload, filter parity, invalid-args rejection, empty map, StorageError content
- `apps/server/src/main.ts` - composed `makePostgresMacroObservationsRepo` + `makeGetMacroUseCase`; wired `getMacro` into both `analyticsRoutes(...)` and `makeMcpRouter(...)`

## Decisions Made

- `macroQuery.safeParse` output is rebuilt into a conditionally-spread object (omitting `days`/
  `series` when absent) before calling `getMacro` — `exactOptionalPropertyTypes` rejects Zod's
  `days?: number | undefined` output type against `MacroSeriesQuery`'s `days?: number`; this
  mirrors the existing `/analytics/term-structure` and `/analytics/skew` "omit absent keys"
  pattern rather than introducing a new one.
- `get_macro`'s MCP `inputSchema` takes `days` as a plain number and `series` as a CSV string
  (matching the HTTP route's query-string shape) and reuses `macroQuery.safeParse(args)` directly
  inside the handler — the route and tool share ONE validation schema, not just one response
  schema, tightening the MCP-02 parity guarantee beyond what the plan strictly required.
- `getMacro` was inserted into `makeMcpRouter`'s positional-optional-param list immediately after
  `getCot` (per the plan's read_first guidance); this shifted `getPositions`/`getTransactions`/
  `getOrders`/`enqueueJob` one position over in `main.ts`'s call site — Task 3 already needed to
  touch that call site to add `getMacro`, so no extra scope was introduced.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. `bun run typecheck` was intentionally red between Task 1/Task 2 and Task 3 (main.ts's
`analyticsRoutes(...)`/`makeMcpRouter(...)` call sites still had the old arg count/order) — this
is the expected, plan-structured consequence of splitting one feature's route/MCP/wiring across
three sequential commits, and it clears once Task 3 lands. Each task's own scoped test command
(`bun run test -- --project server analytics.routes` / `mcp`) was green at task completion, per
the plan's own `<verify>` commands.

## User Setup Required

None - no external service configuration required in this plan. `FRED_API_KEY` prod operator
step (D-13) remains tracked at phase level (set in Phase 14 Plan 05); this plan's route/MCP
surface reads already-stored `macro_observations` rows and does not itself call FRED/CBOE.

## Next Phase Readiness

- MAC-02 and MCP-02 are fully closed for the macro vertical: `GET /api/analytics/macro` and
  `get_macro` both validate input through `macroQuery` and both return `macroResponse`-shaped
  payloads sourced from the one `getMacro` use-case.
- No blockers. `rate_observations`/`readRate`/BSM path untouched (D-02) — `main.ts`'s diff shows
  only additive lines around the existing `getCot`/`analyticsRoutes`/`makeMcpRouter` blocks.
- Full `apps/server` suite (16 files / 172 tests) green; `bun run typecheck` and `bun run lint`
  clean (only pre-existing boundaries-plugin legacy-selector warning, unrelated to this plan).
- Remaining Phase 14 work (per ROADMAP): plan 07 (frontend `MacroCard`/`useMacro` wiring, D-12)
  can proceed independently — it only needs the now-live `GET /api/analytics/macro` HTTP surface,
  not anything internal to this plan.

## Self-Check: PASSED

- All 6 modified files verified present on disk with the expected changes.
- All 5 task commit hashes (`4f9a0ea`, `8db4932`, `ccd0703`, `36baa93`, `4804c1c`) verified in `git log`.
- Re-ran plan-level `<verification>`: `bun run test -- --project server` (172/172 pass), `bun run typecheck` (clean), `bun run lint` (clean, only pre-existing boundaries-plugin warnings).
- Re-ran acceptance-criteria greps: `rg -n "/analytics/macro"`, `rg -n "macroResponse.parse"` (route), `rg -n "registerGetMacroTool"` (tools.ts + server.ts), `rg -n "makeGetMacroUseCase|makePostgresMacroObservationsRepo"` (main.ts), `rg -n "analyticsRoutes\("` (main.ts) — all matched.

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*
