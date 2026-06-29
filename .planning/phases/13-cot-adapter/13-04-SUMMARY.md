---
phase: 13-cot-adapter
plan: "04"
subsystem: core/journal/cot
status: complete
tags: [cot, use-cases, hexagon, tdd, fast-check]
requires: [13-01, 13-02, 13-03]
provides: [cotNet, makeFetchCot, ForRunningFetchCot, makeGetCotUseCase, ForRunningGetCot]
affects: [packages/core, 13-05-job-handler, 13-06-route-mcp]
tech_stack:
  added: []
  patterns: [fast-check-property, factory-inject-deps, ForRunningXxx-driver-port, inline-test-doubles]
key_files:
  created:
    - packages/core/src/journal/application/cotNet.ts
    - packages/core/src/journal/application/cotNet.test.ts
    - packages/core/src/journal/application/fetchCot.ts
    - packages/core/src/journal/application/fetchCot.test.ts
    - packages/core/src/journal/application/getCot.ts
    - packages/core/src/journal/application/getCot.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
decisions:
  - "CotEntry defined in getCot.ts (not imported from contracts) to keep hexagon pure"
  - "getCot.test.ts validates cotSeriesEntry shape inline (YYYY-MM-DD / ISO regexes + Number.isInteger) because core tsconfig references only @morai/shared + @morai/quant"
  - "fetchCot.test.ts uses vi.fn() spies for fetch/persist + inline Map for idempotency test"
metrics:
  duration_seconds: 415
  completed: "2026-06-29"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 2
requirements: [COT-01, COT-02]
---

# Phase 13 Plan 04: COT Use-Cases Summary

**One-liner:** Pure hexagon use-cases — cotNet derivation, makeFetchCot fetch-stamp-persist, makeGetCotUseCase read-and-derive — all fully tested with fast-check + vitest.

## Tasks Completed

| Task | Description | Commit | Tests |
|------|-------------|--------|-------|
| 1 | cotNet — pure net-per-class derivation (D-04) | `493b673` | 5 passed |
| 2 | makeFetchCot use-case + ForRunningFetchCot port (COT-01) | `52b221b` | 7 passed |
| 3 | makeGetCotUseCase + ForRunningGetCot port (COT-02) | `d967f40` | 8 passed |

**Total: 20 tests passing. typecheck clean. lint clean.**

## What Was Built

### cotNet (D-04)

`cotNet(report)` → `{ netDealer, netAssetManager, netLeveraged, netOther, netNonreportable }`

Pure function; no I/O, no ports. Input is a `Pick<CotReport, legs...>` so it can be tested with bare objects and composed into `getCot` without a full row. Tested with fast-check property (numRuns=1000):
- `net + short === long` for all 5 TFF classes
- All nets are integers (no floating-point drift)

### makeFetchCot (COT-01)

Factory: `makeFetchCot({ fetchCotReport, persistCotObservation, now, contractCode? }) → ForRunningFetchCot`

On invoke: fetch → on err propagate (skip persist) → on ok build `CotObservationRow = report + { publishedAt: now() }` → persist.

- `published_at` stamped from injected clock (D-07, Friday)
- `as_of` from report's own date field (D-08, Tuesday)
- Default `contractCode = "13874A"` (E-mini S&P 500 TFF futures-only)
- Idempotency lives in the repo's ON CONFLICT (contract_code, as_of) DO NOTHING

### makeGetCotUseCase (COT-02)

Factory: `makeGetCotUseCase({ readCotObservations }) → ForRunningGetCot`

Reads stored rows (most-recent-first) and maps each `CotObservationRow` to a `CotEntry`:
- `asOf`: YYYY-MM-DD (passes through from repo)
- `publishedAt`: ISO datetime via `Date.toISOString()`
- All raw legs (long/short for all 5 classes)
- Five `net*` fields derived by `cotNet` (D-04 — not stored, derived at use-case layer)
- Empty store → `ok([])`

`CotEntry` is defined in `getCot.ts` (not imported from `@morai/contracts`) to keep the hexagon pure. It is structurally compatible with `cotSeriesEntry` from contracts.

## Exports Verified

```
rg "makeFetchCot|ForRunningFetchCot" packages/core/src/index.ts  → 2 matches
rg "makeGetCotUseCase|ForRunningGetCot" packages/core/src/index.ts → 2 matches
```

All four names exported from `core/index.ts` (via `journal/index.ts`).

## Deviations from Plan

### Deviation 1 [Rule 2 — Missing Critical Functionality] cotSeriesEntry.safeParse inline

**Found during:** Task 3 (getCot.test.ts)

**Issue:** The plan specifies `validate rows against cotSeriesEntry.safeParse in the test`, but `packages/core/tsconfig.json` only references `@morai/shared` and `@morai/quant`. Importing from `@morai/contracts` is architecturally forbidden in core tests.

**Fix:** Implemented inline shape validation in `getCot.test.ts`:
- YYYY-MM-DD regex for `asOf`
- ISO datetime regex for `publishedAt`
- `Number.isInteger` check for all numeric fields
- `net = long − short` equality assertions per class

This is equivalent to what `cotSeriesEntry.safeParse` would assert, and correctly respects the hexagon boundary.

**Files modified:** `packages/core/src/journal/application/getCot.test.ts`

## Architecture Compliance

- `packages/core` imports only `@morai/shared` — confirmed by typecheck + lint
- No `any`, `as`, `!` used in any file
- `CotEntry` type flows from `z.infer`-equivalent manual typing (no contracts import)
- `ForRunningFetchCot` and `ForRunningGetCot` follow the `ForRunningXxx` driver port naming convention
- Inline test doubles in core tests (no adapter imports) follow the hexagon rule

## Self-Check

### Created files exist

- `packages/core/src/journal/application/cotNet.ts` — exists
- `packages/core/src/journal/application/cotNet.test.ts` — exists
- `packages/core/src/journal/application/fetchCot.ts` — exists
- `packages/core/src/journal/application/fetchCot.test.ts` — exists
- `packages/core/src/journal/application/getCot.ts` — exists
- `packages/core/src/journal/application/getCot.test.ts` — exists

### Commits exist

- `493b673` — Task 1 (cotNet)
- `52b221b` — Task 2 (makeFetchCot)
- `d967f40` — Task 3 (makeGetCotUseCase)

## Self-Check: PASSED

All 6 files created, all 3 commits recorded, all exports verified, 20 tests green, typecheck clean, lint clean.
