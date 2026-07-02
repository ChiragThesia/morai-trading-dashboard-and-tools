---
phase: 14-fred-expansion
plan: 04
subsystem: macro-data
tags: [core, use-case, promise-allsettled, hexagonal-application, macro, tdd]

# Dependency graph
requires:
  - phase: 14-fred-expansion
    provides: "MacroObservationRow domain type + ForFetchingFredSeries/ForFetchingVvixQuote/ForPersistingMacroObservation/ForReadingMacroObservations ports (14-01); makeFredSeriesAdapter/makeCboeVvixAdapter/postgres+memory macro-observations repos (14-03)"
provides:
  - "makeFetchMacroSeries + ForRunningFetchMacroSeries — orchestrates 7 FRED series + VVIX with per-series independent failure and a fail-loud finish (MAC-01)"
  - "makeGetMacroUseCase + ForRunningGetMacro + MacroSeriesQuery + MacroSeriesPointOut — groups stored rows into the ascending series map with 90-day-default windowing + days/series filters (MAC-02)"
affects: [14-05-job, 14-06-route-mcp]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promise.allSettled with each task's own try/catch wrapper (returns a Result-shaped outcome) so a rejected fetch is absorbed into the same best-effort accounting as a Result.err — no separate rejected-branch handling needed downstream"
    - "Best-effort + fail-loud finish: persist every success independently, collect every failed series id, return err naming all of them only after every attempt is made"

key-files:
  created:
    - packages/core/src/journal/application/fetchMacroSeries.ts
    - packages/core/src/journal/application/fetchMacroSeries.test.ts
    - packages/core/src/journal/application/getMacro.ts
    - packages/core/src/journal/application/getMacro.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "Each fetch task wraps its call in a local try/catch inside the Promise.allSettled map, converting a thrown rejection into a Result.err outcome with the same shape as a fetch-adapter err — the `for` loop after allSettled never needs to special-case PromiseSettledResult's rejected branch (kept only as an unreachable type-safety fallback)"
  - "DEFAULT_FRED_SERIES_IDS is a domain constant defined in fetchMacroSeries.ts (not imported from @morai/contracts) — core cannot import contracts, mirroring fetchCot's default contractCode constant"
  - "cutoffDateString computes now-minus-days as a YYYY-MM-DD string via toISOString().slice(0,10) so cutoff/row.date comparison stays a plain lexicographic string compare — no date-library dependency"

patterns-established:
  - "Second live instance of the allSettled-per-item-independence pattern (refreshTokens.ts JOB-02 precedent) — now also used for an N-item fan-out (8 series) instead of a fixed 2-item fan-out"

requirements-completed: [MAC-01, MAC-02]

coverage:
  - id: D1
    description: "fetchMacroSeries fetches 7 FRED series + VVIX via Promise.allSettled, persists every success independently of any other series' outcome, and returns err naming every failed series only after all persists are attempted (best-effort + fail-loud finish, D-07)"
    requirement: MAC-01
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/fetchMacroSeries.test.ts (4 tests: all-succeed->ok, mixed-failure->6 persisted+err naming both, persist-failure counted in finish, rejected-promise absorbed)"
        status: pass
      - kind: other
        ref: "rg -n 'allSettled' packages/core/src/journal/application/fetchMacroSeries.ts"
        status: pass
      - kind: other
        ref: "rg -n 'makeFetchMacroSeries|ForRunningFetchMacroSeries' packages/core/src/index.ts"
        status: pass
      - kind: other
        ref: "bun run typecheck; imports only @morai/shared + ./ports.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "getMacro groups rows by seriesId into an ascending { [seriesId]: [{time,value}] } map, applies the default 90-day window plus optional days/series filters (D-10/D-11), and returns ok({}) on an empty store"
    requirement: MAC-02
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/getMacro.test.ts (7 tests: group+ascending, empty->{}, 90d default window, days override, series filter, combined filters, StorageError propagation)"
        status: pass
      - kind: other
        ref: "rg -n 'makeGetMacroUseCase|ForRunningGetMacro' packages/core/src/index.ts"
        status: pass
      - kind: other
        ref: "bun run typecheck; imports only @morai/shared + ./ports.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 04: Macro Use-Cases (fetchMacroSeries + getMacro) Summary

**Pure-core orchestration for macro data: fetchMacroSeries fans out 8 independent fetches via Promise.allSettled with a best-effort-persist/fail-loud-finish contract, and getMacro groups stored rows into the ascending `{ [seriesId]: [{time,value}] }` read shape with default 90-day windowing.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-02T02:14:00Z (approx, following 14-03)
- **Completed:** 2026-07-02T02:22:00Z
- **Tasks:** 2 completed
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- Shipped `makeFetchMacroSeries` (MAC-01): builds one fetch task per FRED series id (default
  the 7 ids `DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS`) plus one VVIX task, runs all
  8 via `Promise.allSettled`, persists every fetch success independently of the others, and
  returns `err` naming every series that failed to fetch OR persist only after all persists
  have been attempted (D-07 best-effort + fail-loud finish). A thrown rejection from a fetch
  task is absorbed into the same accounting path as a `Result.err`, so the batch never
  short-circuits on an unexpected throw.
- Shipped `makeGetMacroUseCase` (MAC-02): reads all `macro_observations` rows, computes a
  window cutoff (`now` minus `days ?? 90`, formatted `YYYY-MM-DD`), filters by the cutoff and
  an optional `series` allow-list, groups surviving rows by `seriesId`, and sorts each
  series' array ASCENDING by `time` (D-10 — opposite of COT's DESC read). Empty store
  returns `ok({})`.
- Both use-cases full TDD RED->GREEN, and both re-exported through `journal/index.ts` +
  `core/index.ts` per the existing COT barrel pattern.

## Task Commits

Each task followed the full TDD RED->GREEN cycle (no REFACTOR commits needed — each
implementation was already minimal at GREEN):

1. **Task 1: fetchMacroSeries use-case (per-series independence + fail-loud finish)**
   - RED: `684227b` (test) — `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts` failed (module not found)
   - GREEN: `39595c9` (feat) — 4/4 tests pass
2. **Task 2: getMacro use-case (group by series + window/filter)**
   - RED: `3ab6dc0` (test) — `bun run test -- packages/core/src/journal/application/getMacro.test.ts` failed (module not found)
   - GREEN: `b80a98e` (feat) — 7/7 tests pass

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/core/src/journal/application/fetchMacroSeries.ts` - `makeFetchMacroSeries` + `ForRunningFetchMacroSeries` + `DEFAULT_FRED_SERIES_IDS`
- `packages/core/src/journal/application/fetchMacroSeries.test.ts` - 4 tests: all-succeed, mixed-failure, persist-failure, rejected-promise
- `packages/core/src/journal/application/getMacro.ts` - `makeGetMacroUseCase` + `ForRunningGetMacro` + `MacroSeriesQuery` + `MacroSeriesPointOut`
- `packages/core/src/journal/application/getMacro.test.ts` - 7 tests: group+ascending, empty, window default/override, series filter, combined, StorageError
- `packages/core/src/journal/index.ts` - re-exports for both use-cases + driver-port types
- `packages/core/src/index.ts` - re-exports for both use-cases + driver-port types at the core barrel

## Decisions Made

- Each fetch task wraps its call in a local `try`/`catch` inside the `Promise.allSettled` map,
  converting any thrown rejection into a `Result.err`-shaped outcome before `allSettled`
  resolves — this collapses "rejected" and "fetched but err" into one code path in the
  post-`allSettled` loop, keeping the `status !== "fulfilled"` branch unreachable dead code
  kept only to satisfy TypeScript's `PromiseSettledResult` union.
- `DEFAULT_FRED_SERIES_IDS` is a domain constant local to `fetchMacroSeries.ts`, not imported
  from `@morai/contracts` — mirrors `fetchCot.ts`'s default `contractCode` (core cannot import
  contracts per architecture-boundaries §2).
- `cutoffDateString` computes the window boundary as a `YYYY-MM-DD` string via
  `toISOString().slice(0, 10)`, so the cutoff/`row.date` comparison stays a plain lexicographic
  string compare with no date-library dependency — consistent with the existing codebase
  convention of storing/comparing dates as strings.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required in this plan. `FRED_API_KEY` prod
operator step remains tracked at phase level for the job-wiring plan (14-05), per D-13.

## Next Phase Readiness

- `makeFetchMacroSeries`/`ForRunningFetchMacroSeries` and `makeGetMacroUseCase`/
  `ForRunningGetMacro`/`MacroSeriesQuery` are stable for 14-05 (worker job wiring:
  `fetch-rates.ts` handler extension + two-run cron) and 14-06 (route + MCP tool) to inject
  directly.
- No blockers. `rate_observations`/`readRate`/BSM path untouched (D-02) — no edits outside
  the two new use-case files + the two barrel files.
- Full `packages/core` suite (46 files / 452 tests) green; `bun run typecheck` and
  `bun run lint` clean (only pre-existing boundaries-plugin legacy-selector warning, unrelated
  to this plan).

## Self-Check: PASSED

- All 4 created files verified present on disk.
- All 4 task commit hashes (`684227b`, `39595c9`, `3ab6dc0`, `b80a98e`) verified in `git log`.
- Re-ran plan-level `<verification>`: `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts packages/core/src/journal/application/getMacro.test.ts` (11/11 pass), `bun run typecheck` (clean), `bun run lint` (clean).

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*
