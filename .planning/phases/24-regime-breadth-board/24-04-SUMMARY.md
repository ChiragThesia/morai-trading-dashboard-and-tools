---
phase: 24-regime-breadth-board
plan: 04
subsystem: api
tags: [hono, mcp, zod, hexagonal, regime, macro-observations]

# Dependency graph
requires:
  - phase: 24-02
    provides: VIX9D ingestion (macro_observations, series id VIX9D)
  - phase: 24-03
    provides: regime banding domain fns + regimeIndicator/regimeResponse contract
provides:
  - makeGetRegimeBoardUseCase (core) — computes 4 regime indicators from latest macro_observations rows
  - GET /api/analytics/regime HTTP route
  - get_regime MCP tool
affects: [24-05, overview-tab-regime-board]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Board use-case reuses an existing driven port (ForReadingMacroObservations) — zero new repo/table for a new read surface"
    - "Missing-input-omits-indicator (fail-closed) rather than fabricate/zero a value"
    - "Ratio-indicator asOf = OLDER of its two input dates (never overstate freshness)"

key-files:
  created:
    - packages/core/src/analytics/application/getRegimeBoard.ts
    - packages/core/src/analytics/application/getRegimeBoard.test.ts
  modified:
    - packages/core/src/analytics/index.ts
    - packages/core/src/index.ts
    - apps/server/src/adapters/http/analytics.routes.ts
    - apps/server/src/adapters/http/analytics.routes.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/main.ts

key-decisions:
  - "RegimeIndicatorOut is a core-local type structurally matching contracts' regimeIndicator (core cannot import @morai/contracts); the route + MCP tool parse it through regimeResponse at the edge."
  - "Latest row per series = MAX-date row (lexicographic YYYY-MM-DD comparison), computed with a single grouping pass over the unfiltered ForReadingMacroObservations read."
  - "getRegimeBoard crosses into the journal bounded context through its public application-port surface (journal/index.ts), not journal/domain/ — architecture-boundaries rule 7."

patterns-established:
  - "Board use-case pattern: read-all -> latest-per-series -> per-indicator required-input check -> omit-if-missing -> band via domain fn -> provenance from a small metadata constant table"

requirements-completed: [BOARD-01, BOARD-02, BOARD-03, MACRO-03]

coverage:
  - id: D1
    description: "makeGetRegimeBoardUseCase computes vix-term-structure, vvix, vix9d-vix, hy-oas from the latest macro_observations row per series, with band/asOf/source/rationale/inputs"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#computes vix-term-structure/vvix/vix9d-vix/hy-oas from the latest rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "A missing input series omits its indicator (never fabricated); empty store returns []"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#OMITS vix-term-structure/vix9d-vix when an input has no row; returns ok([]) when the store is empty"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ratio indicator asOf = OLDER of its two input dates; single-input indicator asOf = that row's own date (never overstates freshness, MACRO-03)"
    requirement: "MACRO-03"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#asOf = the OLDER of the two input dates / asOf = that row's own date"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every indicator carries a non-empty source + rationale string from the domain metadata table (payload-carried provenance, not UI copy)"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#carries non-empty source + rationale strings for every indicator (BOARD-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /api/analytics/regime returns a regimeResponse-valid board (present indicators or [] on empty), maps storage errors to a flat {error:\"internal\"} 500"
    requirement: "BOARD-03"
    verification:
      - kind: integration
        ref: "apps/server/src/adapters/http/analytics.routes.test.ts#GET /api/analytics/regime"
        status: pass
    human_judgment: false
  - id: D6
    description: "get_regime MCP tool returns the SAME regimeResponse-parsed payload as the HTTP route; wired as an optional param in makeMcpRouter and main.ts, reusing the existing macroObservationsRepo"
    requirement: "BOARD-03"
    verification:
      - kind: unit
        ref: "bun run typecheck (one-sided regimeResponse field change fails typecheck, MCP-02 guard)"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-09
status: complete
---

# Phase 24 Plan 04: Regime Board Use-Case + HTTP Route + MCP Tool Summary

**`makeGetRegimeBoardUseCase` computes the 4-indicator regime board on-read from macro_observations, exposed on `GET /api/analytics/regime` and the `get_regime` MCP tool over one shared `regimeResponse` schema.**

## Performance

- **Duration:** 20 min
- **Completed:** 2026-07-09
- **Tasks:** 2 completed
- **Files modified:** 9 (2 new, 7 edited)

## Accomplishments

- `makeGetRegimeBoardUseCase` reads all `macro_observations` rows via the existing
  `ForReadingMacroObservations` port (zero new repo/table), keeps the latest row per series,
  and computes `vix-term-structure` (VIXCLS/VXVCLS), `vvix`, `vix9d-vix` (VIX9D/VIXCLS), and
  `hy-oas` (BAMLH0A0HYM2) — each with band, as-of date, and provenance (source + rationale)
  from a small domain metadata table (BOARD-02).
- A missing input series OMITS its indicator rather than fabricating a value (T-24-09); an
  empty store returns `ok([])`. A ratio indicator's `asOf` is the OLDER of its two input
  dates so the board never overstates freshness (T-24-10, MACRO-03).
- `GET /api/analytics/regime` and the `get_regime` MCP tool both parse through the single
  `regimeResponse` schema from `@morai/contracts` (BOARD-03/MCP-02) — a one-sided field
  change fails `bun run typecheck`. Both map a `StorageError` to a flat `{error:"internal"}`
  (T-24-08), never leaking DB internals.

## Task Commits

Each task was committed atomically (TDD RED→GREEN for Task 1):

1. **Task 1: makeGetRegimeBoardUseCase** — `b9d3d35` (test, RED) then `5138a59` (feat, GREEN)
2. **Task 2: HTTP route + MCP tool wiring** — `4f58870` (feat)

**Plan metadata:** this commit (docs: complete 24-04 plan)

## Files Created/Modified

- `packages/core/src/analytics/application/getRegimeBoard.ts` — the board use-case + indicator metadata table
- `packages/core/src/analytics/application/getRegimeBoard.test.ts` — 9 tests covering all 4 indicators, omission, empty store, StorageError propagation
- `packages/core/src/analytics/index.ts`, `packages/core/src/index.ts` — export the new use-case + types through the existing barrel chain
- `apps/server/src/adapters/http/analytics.routes.ts` (+ test) — `GET /analytics/regime`
- `apps/server/src/adapters/mcp/tools.ts` — `registerGetRegimeTool`
- `apps/server/src/adapters/mcp/server.ts` — optional `getRegimeBoard` param + conditional registration
- `apps/server/src/main.ts` — `makeGetRegimeBoardUseCase` wired with the existing `macroObservationsRepo`, mounted into both the route and the MCP router call

## Decisions Made

- `RegimeIndicatorOut` is core-local (structurally matches contracts' `regimeIndicator`) since core cannot import `@morai/contracts` — the route/MCP tool parse it through `regimeResponse` at the edge, exactly as the plan specified.
- Crossed into the journal bounded context via `journal/index.ts` (its public application-port surface: `ForReadingMacroObservations`, `MacroObservationRow`, `StorageError`) rather than deep-importing `journal/application/ports.ts` directly — keeps the cross-context boundary at the intended public surface (architecture-boundaries rule 7).
- New optional MCP params (`getRegimeBoard` in `makeMcpRouter`) are appended at the END of the existing positional-optional parameter list, matching the established convention for every prior phase's addition (Phase 8 GEX through Phase 22 lifecycle) — avoids reordering existing call sites.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The board is live on HTTP + MCP, computed from data that's already accreting (VIXCLS/VXVCLS
since Phase 23, VVIX since Phase 14, VIX9D + BAMLH0A0HYM2 since 24-01/24-02). Plan 24-05 can
now build the Overview-tab UI (MetricChip grid, provenance tooltip) against a real, contract-valid
`regimeResponse` payload. Full workspace suite green (2368 tests / 234 files), `bun run typecheck`
and `bun run lint` clean at HEAD.

---
*Phase: 24-regime-breadth-board*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all 3 task commits (`b9d3d35`,
`5138a59`, `4f58870`) confirmed in git log.
