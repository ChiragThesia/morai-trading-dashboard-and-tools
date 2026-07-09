---
phase: 24-regime-breadth-board
plan: 02
subsystem: macro-pipeline
tags: [cboe, vix9d, macro, adapter, in-memory-twin]

requires: [24-01]
provides:
  - "makeCboeVix9dAdapter — CBOE _VIX9D delayed-quote adapter (ForFetchingVix9dQuote)"
  - "makeMemoryVix9dAdapter — in-memory twin (architecture-boundaries §8)"
  - "VIX9D task wired into makeFetchMacroSeries + MACRO_SERIES_IDS + worker composition root"
affects: [24-04-regime-board-api, 24-05-regime-board-ui]

tech-stack:
  added: []
  patterns: [clone-not-parameterize (2 CBOE call sites), additive-enum-widening, fail-closed-no-fallback]

key-files:
  created:
    - packages/adapters/src/http/cboe-vix9d.ts
    - packages/adapters/src/http/cboe-vix9d.test.ts
    - packages/adapters/src/memory/vix9d.ts
    - packages/adapters/src/memory/vix9d.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/index.ts
    - packages/core/src/journal/application/fetchMacroSeries.ts
    - packages/core/src/journal/application/fetchMacroSeries.test.ts
    - packages/contracts/src/macro.ts
    - packages/contracts/src/macro.test.ts
    - apps/worker/src/main.ts

key-decisions:
  - "Cloned cboe-vvix.ts verbatim (URL + seriesId literal only) rather than parameterizing a generic CBOE fetcher — research Anti-Pattern explicitly rejects a shared abstraction for 2 call sites"
  - "VIX9D appended at the END of MACRO_SERIES_IDS (12th->11th position, following the BAMLH0A0HYM2/VXVCLS array-order-stability precedent from Phase 23/24-01)"
  - "VIX9D task inherits the existing Promise.allSettled best-effort + fail-loud finish (D-07) with zero new control flow — same shape as the VVIX task"

patterns-established: []

requirements-completed: [MACRO-02, MACRO-03]

coverage:
  - id: D1
    description: "VIX9D is fetched from the CBOE _VIX9D delayed-quote endpoint each fetch-rates run and persisted to macro_observations with source 'cboe'; malformed/non-200/missing-spot payloads fail closed (err, row omitted, never fabricated)"
    requirement: MACRO-03
    verification:
      - kind: unit
        ref: "packages/adapters/src/http/cboe-vix9d.test.ts (9/9 pass, msw at network layer)"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/vix9d.test.ts (3/3 pass, no-fallback parity)"
        status: pass
    human_judgment: false
  - id: D2
    description: "macro_observations now carries 11 series ids (VIX9D added); no new job, no migration; worker root wires makeCboeVix9dAdapter"
    requirement: MACRO-02
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/fetchMacroSeries.test.ts (18/18 pass, RED->GREEN on dep/task/count assertions)"
        status: pass
      - kind: unit
        ref: "packages/contracts/src/macro.test.ts (13/13 pass, MACRO_SERIES_IDS ends with VIX9D)"
        status: pass
      - kind: static
        ref: "grep -c 'makeCboeVix9dAdapter' apps/worker/src/main.ts == 2 (import + call)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-09
status: complete
---

# Phase 24 Plan 02: CBOE VIX9D Adapter + Macro Orchestration Wiring Summary

**New `makeCboeVix9dAdapter` (cloned from the VVIX adapter, URL/seriesId swapped) plus its in-memory twin and port now feed a VIX9D fetch task into the existing macro orchestration and worker composition root — zero new jobs, migrations, or dependencies.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 13 (4 new, 9 edited)

## Accomplishments

- `ForFetchingVix9dQuote` port added to `ports.ts` as an exact structural twin of `ForFetchingVvixQuote`, re-exported through `journal/index.ts` → `core/index.ts`.
- `makeCboeVix9dAdapter` (`packages/adapters/src/http/cboe-vix9d.ts`) clones `cboe-vvix.ts` with only the URL (`_VIX9D.json`) and the returned `seriesId` literal changed — identical Zod schema, `current_price ?? close ?? prev_day_close` spot resolution, UTC→America/New_York trading-day date derivation, and fail-closed no-fallback behavior. msw tests cover 200/non-200/network-throw/malformed-payload/missing-spot/zero-spot/timezone-boundary paths (9 cases, cloned from `cboe-vvix.test.ts`).
- `makeMemoryVix9dAdapter` (`packages/adapters/src/memory/vix9d.ts`) — in-memory twin returning `err` unseeded, `ok(seeded row)` after `seed()`, matching the real adapter's no-fallback contract (architecture-boundaries §8).
- Both adapters exported from the `packages/adapters/src/index.ts` barrel beside their VVIX siblings.
- `makeFetchMacroSeries` now requires a `fetchVix9dQuote: ForFetchingVix9dQuote` dep and pushes a `{ id: "VIX9D", fetch: () => deps.fetchVix9dQuote() }` task right after the VVIX task — inherits the existing `Promise.allSettled` best-effort + fail-loud finish (D-07) with no new control flow.
- `MACRO_SERIES_IDS` appended `"VIX9D"` at the end (11 ids total).
- `apps/worker/src/main.ts` builds `fetchVix9dQuote = makeCboeVix9dAdapter({ fetch: globalThis.fetch, userAgent: USER_AGENT })` beside `fetchVvixQuote` and passes it into `makeFetchMacroSeries`'s deps — VIX9D piggybacks the existing twice-daily fetch-rates cron, no new job/queue.

## Task Commits

Each task was committed atomically:

1. **Task 1: CBOE VIX9D adapter + port + in-memory twin (RED→GREEN)** - `12c0627` (feat)
2. **Task 2: Wire VIX9D into the macro orchestration + enum + worker root (RED→GREEN)** - `2cbead2` (feat)

## Files Created/Modified

- `packages/adapters/src/http/cboe-vix9d.ts` — NEW: `makeCboeVix9dAdapter`, cloned from `cboe-vvix.ts`
- `packages/adapters/src/http/cboe-vix9d.test.ts` — NEW: 9 msw cases (200/fallthrough chain/null-spot/zero-spot/non-2xx/network-throw/parse-fail/ET-timezone)
- `packages/adapters/src/memory/vix9d.ts` — NEW: `makeMemoryVix9dAdapter` in-memory twin
- `packages/adapters/src/memory/vix9d.test.ts` — NEW: 3 twin cases (unseeded err, seeded ok, re-seed replace)
- `packages/core/src/journal/application/ports.ts` — `ForFetchingVix9dQuote` port type added beside `ForFetchingVvixQuote`
- `packages/core/src/journal/index.ts` — re-exports `ForFetchingVix9dQuote`
- `packages/core/src/index.ts` — re-exports `ForFetchingVix9dQuote`
- `packages/adapters/src/index.ts` — exports `makeCboeVix9dAdapter` + `makeMemoryVix9dAdapter`/`MemoryVix9dAdapter`
- `packages/core/src/journal/application/fetchMacroSeries.ts` — `fetchVix9dQuote` dep + VIX9D task; doc comments updated (9 FRED + VVIX + VIX9D)
- `packages/core/src/journal/application/fetchMacroSeries.test.ts` — widened to 11-series assertions + new `fetchVix9dQuote` fixture + a VIX9D-failure-named-in-finish case
- `packages/contracts/src/macro.ts` — `MACRO_SERIES_IDS` appends `"VIX9D"`
- `packages/contracts/src/macro.test.ts` — "contains all eleven series ids" assertion
- `apps/worker/src/main.ts` — imports `makeCboeVix9dAdapter`, builds `fetchVix9dQuote`, wires into `makeFetchMacroSeries` deps

## Verification Evidence

- `bun run test -- packages/adapters/src/http/cboe-vix9d.test.ts packages/adapters/src/memory/vix9d.test.ts` — RED (2 failed suites, `Cannot find module` for both new files, adapter/twin absent) → GREEN (2 files / 12 tests pass) after implementation.
- `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts packages/contracts/src/macro.test.ts` — RED (6 failed: 5 count-mismatch assertions in fetchMacroSeries.test.ts + 1 in macro.test.ts, all right-reason assertion failures not import/syntax errors) → GREEN (18 + 13 = 31 tests pass) after wiring the dep/task and widening `MACRO_SERIES_IDS`.
- `bun run typecheck` — clean.
- `bun run lint` — clean (pre-existing `[boundaries]` legacy-selector-syntax warning only, unrelated).
- Full workspace `bun run test` — 233 files / 2356 tests passed.
- `grep -c '_VIX9D' packages/adapters/src/http/cboe-vix9d.ts` → 3.
- `grep -c 'VIX9D' packages/contracts/src/macro.ts` → 3 (doc comment + array entry + doc reference).
- `grep -c 'makeCboeVix9dAdapter' apps/worker/src/main.ts` → 2 (import + call).

## Decisions Made

- Cloned rather than parameterized: `cboe-vix9d.ts` is a near-verbatim copy of `cboe-vvix.ts` with the URL and `seriesId` literal swapped — matches the plan's explicit instruction and the research Anti-Pattern (no generic CBOE fetcher justified for 2 call sites).
- `VIX9D` appended at the end of `MACRO_SERIES_IDS`, not inserted alphabetically — consistent with the array-order-stability precedent from Phase 23 (`VXVCLS`) and 24-01 (`BAMLH0A0HYM2`).
- Added one extra fetchMacroSeries test case beyond the plan's explicit `<behavior>` list ("names VIX9D among failures when its fetch fails") to directly exercise the fail-loud-naming behavior for the new series, mirroring the existing DFF/SOFR/T10Y2Y failure-path coverage already in the file.

## Deviations from Plan

None — plan executed exactly as written. RED-phase failures matched the plan's expected shape (module-not-found for Task 1, count/contains assertion mismatches for Task 2) before each GREEN implementation.

## Issues Encountered

None.

## Known Stubs

None — VIX9D flows through the real `makeCboeVix9dAdapter` via the existing fetch-rates cron; no mocked or hardcoded data path introduced.

## Threat Flags

None new. Mitigations from the plan's threat register (T-24-03 malformed CBOE payload, T-24-04 timezone mislabel) are implemented via the cloned Zod safeParse-at-the-edge and the verbatim UTC→ET trading-day derivation — both regression-gated by the cloned msw test suite. No new dependency (T-24-SC accept, unchanged).

## User Setup Required

None — no external service configuration required. The CBOE `_VIX9D.json` endpoint needs no API key (same as the VVIX endpoint it mirrors).

## Next Phase Readiness

VIX9D now accretes into `macro_observations` on the existing twice-daily fetch-rates cadence, ready for plan 24-03's banding-function implementation and plan 24-04's `getRegimeBoard` use-case to read via the existing `ForReadingMacroObservations` port — no additional wiring needed. No blockers for 24-03/24-04.

---
*Phase: 24-regime-breadth-board*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: packages/adapters/src/http/cboe-vix9d.ts
- FOUND: packages/adapters/src/memory/vix9d.ts
- FOUND: packages/core/src/journal/application/ports.ts (ForFetchingVix9dQuote present)
- FOUND: packages/contracts/src/macro.ts (VIX9D present)
- FOUND: apps/worker/src/main.ts (makeCboeVix9dAdapter present)
- FOUND: .planning/phases/24-regime-breadth-board/24-02-SUMMARY.md
- FOUND commit 12c0627 (feat RED→GREEN — Task 1)
- FOUND commit 2cbead2 (feat RED→GREEN — Task 2)
