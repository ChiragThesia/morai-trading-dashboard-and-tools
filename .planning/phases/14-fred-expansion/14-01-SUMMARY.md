---
phase: 14-fred-expansion
plan: 01
subsystem: macro-data
tags: [zod, fred, vvix, hexagonal-ports, macro, docs-before-code]

# Dependency graph
requires:
  - phase: 13-cot-adapter
    provides: "COT vertical slice pattern (contract → core ports → adapter → repo → job → route/MCP) mirrored structurally for macro"
provides:
  - "docs/architecture/jobs.md fetch-rates entry corrected (stale 0 7 cron → actual two-run 09:00+18:30 ET cadence, D-06) + macro-fetch responsibility documented"
  - "docs/architecture/data-model.md macro_observations table section (composite time-leading PK, raw values, source column)"
  - "macroSeriesPoint/macroResponse/macroQuery/MACRO_SERIES_IDS/macroSeriesId — @morai/contracts, MCP-02 shared schema"
  - "MacroObservationRow domain type + ForFetchingFredSeries/ForFetchingVvixQuote/ForPersistingMacroObservation/ForReadingMacroObservations ports — @morai/core"
affects: [14-02-migration, 14-03-adapters, 14-04-usecases, 14-05-job, 14-06-route-mcp, 14-07-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "z.record(z.string(), z.array(...)) two-arg Zod v4 map-keyed-by-id contract (status.ts precedent)"
    - "z.coerce.number().max(N).optional() query param + CSV string.transform().pipe(z.array(enum)) for series filter"
    - "ForVerbingNoun function-type ports, no-fallback variant distinct from an existing lenient-fallback port for the same external system"

key-files:
  created:
    - packages/contracts/src/macro.ts
    - packages/contracts/src/macro.test.ts
  modified:
    - docs/architecture/jobs.md
    - docs/architecture/data-model.md
    - packages/contracts/src/index.ts
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "Docs-first (workflow.md): jobs.md + data-model.md updated before any code, per D-06/D-01/D-14"
  - "macroQuery.series uses z.string().transform(split).pipe(z.array(macroSeriesId)).optional() — validates every CSV token against MACRO_SERIES_IDS at the boundary (T-14-01)"
  - "MacroObservationRow ports added as a parallel trio+one beside the existing rate ports — ForFetchingRate/ForPersistingRate/ForReadingRate/RateObservation left byte-for-byte untouched (D-02)"

patterns-established:
  - "New-table-per-capability (D-01) reaffirmed over widening an existing production-critical table — matches skew/term-structure/GEX/COT precedent"

requirements-completed: [MAC-01, MAC-02]

coverage:
  - id: D1
    description: "docs/architecture/jobs.md + data-model.md updated before any code — fetch-rates two-run cadence (09:00+18:30 ET) and new macro_observations table documented"
    verification:
      - kind: other
        ref: "grep -n '18:30|30 18' docs/architecture/jobs.md && grep -n 'macro_observations' docs/architecture/data-model.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "macroSeriesPoint/macroResponse/macroQuery/MACRO_SERIES_IDS Zod contract — round-trip, rejection, and query-param validation, exported from @morai/contracts"
    requirement: "MAC-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/macro.test.ts (13 tests, RED→GREEN)"
        status: pass
      - kind: other
        ref: "bun run typecheck"
        status: pass
    human_judgment: false
  - id: D3
    description: "MacroObservationRow domain type + four core macro ports (ForFetchingFredSeries, ForFetchingVvixQuote, ForPersistingMacroObservation, ForReadingMacroObservations) — types only, rate/BSM ports unchanged"
    requirement: "MAC-01"
    verification:
      - kind: other
        ref: "bun run typecheck; rg ForFetchingFredSeries|ForFetchingVvixQuote|ForPersistingMacroObservation|ForReadingMacroObservations packages/core/src/index.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 01: Macro Foundation (Docs + Contract + Ports) Summary

**Docs-first fetch-rates/macro_observations correction, shared macroSeriesPoint/macroResponse/macroQuery Zod contract (TDD), and four new core macro ports — zero changes to the existing DGS3MO/BSM rate path.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-02T01:35:00Z (approx)
- **Completed:** 2026-07-02T01:53:00Z
- **Tasks:** 3 completed
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- Fixed the stale `0 7 * * 1-5` cron documentation in `docs/architecture/jobs.md`, replacing it
  with the actual two-run daily cadence (`0 9 * * 1-5` + `30 18 * * 1-5`, ET) and documented
  fetch-rates' new second responsibility (best-effort/fail-loud macro fetch, D-07/D-09) —
  BEFORE any code changed (docs-before-code, workflow.md).
- Documented the new `macro_observations` table in `docs/architecture/data-model.md`
  (composite time-leading `(date, series_id)` PK, raw values with no `/100` normalization
  per D-14, `source` provenance column) and confirmed `rate_observations`/BSM stays untouched.
- Shipped `macroSeriesPoint`/`macroResponse`/`macroQuery`/`MACRO_SERIES_IDS`/`macroSeriesId`
  in `packages/contracts/src/macro.ts` via full TDD RED→GREEN: 13 tests covering round-trip,
  malformed-point rejection, empty-map, `days` coercion/boundary/over-cap rejection, and
  `series` CSV parsing + unknown-id rejection.
- Added `MacroObservationRow` + four function-type ports
  (`ForFetchingFredSeries`, `ForFetchingVvixQuote`, `ForPersistingMacroObservation`,
  `ForReadingMacroObservations`) to `@morai/core`, re-exported through
  `journal/index.ts` and `core/index.ts` — types only, no implementations (14-03/14-04 scope).

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-before-code — fetch-rates cadence + macro_observations schema** - `516ade6` (docs)
2. **Task 2: macro Zod contract (macroSeriesPoint + macroResponse + macroQuery)** - TDD cycle:
   - RED: `7073e13` (test) — `bun run test -- packages/contracts/src/macro.test.ts` failed on missing module
   - GREEN: `d5c46fd` (feat) — 13/13 tests pass
   - REFACTOR: none needed — implementation was already minimal
3. **Task 3: core macro ports + MacroObservationRow domain type** - `1aa1085` (feat)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/contracts/src/macro.ts` - macroSeriesPoint/macroResponse/macroQuery/MACRO_SERIES_IDS/macroSeriesId
- `packages/contracts/src/macro.test.ts` - 13 tests: round-trip, rejection, query-param validation
- `packages/contracts/src/index.ts` - barrel export for the macro contract
- `packages/core/src/journal/application/ports.ts` - MacroObservationRow + 4 macro ports (Phase 14 section)
- `packages/core/src/journal/index.ts` - re-export of the macro domain type + ports
- `packages/core/src/index.ts` - re-export of the macro domain type + ports at the core barrel
- `docs/architecture/jobs.md` - corrected fetch-rates cron + new fetch-rates section documenting the macro-fetch addition
- `docs/architecture/data-model.md` - new macro_observations table section

## Decisions Made

- Docs-before-code executed literally as Task 1, with zero code touched in that commit —
  matches workflow.md's hard requirement for new-table/job-cadence changes.
- `macroQuery.series` implemented as `z.string().transform(split).pipe(z.array(macroSeriesId)).optional()`
  rather than a manual CSV-split-then-refine — the pipe form gives per-token enum validation
  "for free" and produces a clean `string[] | undefined` inferred type with no `as` casts.
- Confirmed via grep that the four new core ports do not touch `ForFetchingRate`/
  `ForReadingRate`/`RateObservation` — D-02 (BSM path frozen) holds.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required in this plan (FRED_API_KEY operator step
is tracked for 14-05, per D-13).

## Next Phase Readiness

- `macroSeriesPoint`/`macroResponse`/`macroQuery`/`MACRO_SERIES_IDS` are stable for 14-04
  (use-cases) and 14-06 (route + MCP) to import directly.
- `MacroObservationRow` + the four macro ports are the interface anchor for 14-02 (migration/
  schema), 14-03 (adapters + repo), and 14-04 (fetchMacroSeries/getMacro use-cases) — no
  further port changes expected downstream.
- No blockers. `rate_observations`/BSM path verified unchanged (D-02) — Phase 14 waves 2+ can
  proceed in parallel per the roadmap's wave plan.

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*
