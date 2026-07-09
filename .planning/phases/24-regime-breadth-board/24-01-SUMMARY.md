---
phase: 24-regime-breadth-board
plan: 01
subsystem: docs+macro-pipeline
tags: [fred, macro, evidence-discipline, regime-board, hy-oas]

requires: []
provides:
  - "docs/architecture/regime-board.md — evidence table for all 4 admitted board indicators + Refuted/Dropped section"
  - "BAMLH0A0HYM2 (HY OAS) ingested via the existing fetch-rates FRED pipeline, zero new job/migration"
affects: [24-02-vix9d-ingestion, 24-03-regime-domain, 24-04-regime-board-api, 24-05-regime-board-ui]

tech-stack:
  added: []
  patterns: [additive-enum-widening, text-column-no-migration, docs-first-evidence-table]

key-files:
  created:
    - docs/architecture/regime-board.md
  modified:
    - docs/architecture/data-model.md
    - docs/architecture/jobs.md
    - docs/TOPIC-MAP.md
    - packages/core/src/journal/application/fetchMacroSeries.ts
    - packages/core/src/journal/application/fetchMacroSeries.test.ts
    - packages/contracts/src/macro.ts
    - packages/contracts/src/macro.test.ts
    - packages/adapters/src/memory/fred-series.test.ts
    - packages/adapters/src/__contract__/macro-observations.contract.ts

key-decisions:
  - "regime-board.md mirrors picker-rules.md's per-row evidence format exactly: formula/inputs, bands, threshold rationale, source, verification date, one row per admitted indicator"
  - "BAMLH0A0HYM2 appended at the END of both DEFAULT_FRED_SERIES_IDS and MACRO_SERIES_IDS (Phase 23 array-order-stability precedent)"
  - "HY OAS ships as an absolute-level band, never a moving average — the FRED adapter's limit=5 fetch does not backfill, so a 20-day average would be non-functional for ~4 weeks on a brand-new series"
  - "docs updated ahead of code for VIX9D (source cboe) per the plan's explicit instruction — data-model.md/jobs.md now say 11 series though only the 10th (BAMLH0A0HYM2) is code-complete this plan; VIX9D lands in 24-02"

patterns-established:
  - "Evidence-discipline doc: new indicators are admitted only with a docs/architecture/regime-board.md row citing source + rationale + verification date, mirroring picker-rules.md"

requirements-completed: [MACRO-02, MACRO-03]

coverage:
  - id: D1
    description: "docs/architecture/regime-board.md exists with all 4 admitted indicators (source + rationale + band cuts) and a Refuted/Dropped section covering RSP:SPY, VVIX/VIX ratio, VIX9DCLS, and HYG"
    requirement: MACRO-02
    verification:
      - kind: unit
        ref: "test -f docs/architecture/regime-board.md && grep -q BAMLH0A0HYM2 docs/architecture/regime-board.md && grep -q regime-board.md docs/TOPIC-MAP.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "BAMLH0A0HYM2 flows through the existing twice-daily fetch-rates cron into macro_observations with zero new job or migration; stored raw (percent units, no /100), no moving average"
    requirement: MACRO-03
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/fetchMacroSeries.test.ts (RED->GREEN, 17/17 pass)"
        status: pass
      - kind: unit
        ref: "packages/contracts/src/macro.test.ts (RED->GREEN, contains all ten series ids)"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/fred-series.test.ts (BAMLH0A0HYM2 seed/read case)"
        status: pass
      - kind: integration
        ref: "packages/adapters/src/memory/macro-observations.contract.test.ts + packages/adapters/src/postgres/repos/macro-observations.contract.test.ts (8/8 pass, text-column no-migration parity)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-09
status: complete
---

# Phase 24 Plan 01: Regime Board Evidence Doc + HY OAS Ingestion Summary

**`docs/architecture/regime-board.md` created as the citation-of-record for all 4 admitted board indicators, and FRED series `BAMLH0A0HYM2` (HY OAS credit spread) now flows through the existing fetch-rates cron with zero new adapter code.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2/2 completed
- **Files modified:** 10 (1 new, 9 edited)

## Accomplishments

- `docs/architecture/regime-board.md` — per-indicator evidence table (VIX/VIX3M, VVIX, VIX9D/VIX, HY OAS) with formula/inputs, calm/warning/crisis bands, threshold rationale, source citations, and 2026-07-09 verification date, transcribed from `24-RESEARCH.md`'s Per-Indicator Adjudication. Includes a Refuted/Dropped section (RSP:SPY breadth, VVIX/VIX ratio, VIX9DCLS, HYG) each with a documented revival path.
- Corrected macro series counts in `data-model.md` and `jobs.md` from 9 to 11 (added VIX9D via CBOE and BAMLH0A0HYM2 via FRED to the series lists); added a `TOPIC-MAP.md` index row.
- `BAMLH0A0HYM2` added to `DEFAULT_FRED_SERIES_IDS` and `MACRO_SERIES_IDS` following the exact Phase 23 VXVCLS precedent: failing test assertions written first (widened counts, contains BAMLH0A0HYM2), confirmed RED, then the constants widened to GREEN.

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — create regime-board.md, correct macro series counts** - `3a74d17` (docs)
2. **Task 2: HY OAS series — BAMLH0A0HYM2 into the FRED pipeline (RED→GREEN)** - `38ec063` (feat)

## Files Created/Modified

- `docs/architecture/regime-board.md` — NEW: evidence table + Refuted/Dropped section
- `docs/architecture/data-model.md` — macro_observations series count 9 → 11
- `docs/architecture/jobs.md` — fetch-rates series count/list 9 → 11
- `docs/TOPIC-MAP.md` — regime-board.md index row
- `packages/core/src/journal/application/fetchMacroSeries.ts` — `BAMLH0A0HYM2` appended to `DEFAULT_FRED_SERIES_IDS`
- `packages/core/src/journal/application/fetchMacroSeries.test.ts` — widened count assertions (9→10 total series)
- `packages/contracts/src/macro.ts` — `BAMLH0A0HYM2` appended to `MACRO_SERIES_IDS`
- `packages/contracts/src/macro.test.ts` — widened "contains all ten series ids" assertion
- `packages/adapters/src/memory/fred-series.test.ts` — BAMLH0A0HYM2 seed/read parity case
- `packages/adapters/src/__contract__/macro-observations.contract.ts` — BAMLH0A0HYM2 row in the multi-series read test

## Verification Evidence

- `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts packages/contracts/src/macro.test.ts` — RED (5/17 failed on count mismatches: 9→10 total series, 7→8 successes-with-2-failures, 8→9 persisted-after-one-failure, twice) → GREEN (17/17 pass after widening the two constants).
- `bun run test -- packages/adapters/src/memory/fred-series.test.ts` — 6/6 pass (new BAMLH0A0HYM2 case included).
- `bun run test -- packages/adapters/src/memory/macro-observations.contract.test.ts packages/adapters/src/postgres/repos/macro-observations.contract.test.ts` — 8/8 pass both memory-twin and Postgres testcontainers (text column, no migration needed — same parity Phase 23 established for VXVCLS).
- `bun run typecheck` — clean.
- Full workspace `bun run test` — 229 files / 2314 tests passed.
- `bun run lint` — clean (pre-existing `[boundaries]` legacy-selector-syntax warning only, unrelated).
- `rg -c '"BAMLH0A0HYM2"'` — 1 hit each in `fetchMacroSeries.ts` and `macro.ts`.
- `test -f docs/architecture/regime-board.md && grep -q "BAMLH0A0HYM2" docs/architecture/regime-board.md && grep -q "regime-board.md" docs/TOPIC-MAP.md` — `DOCS_OK`.

## Decisions Made

- BAMLH0A0HYM2 appended at the END of both series-id arrays, matching Phase 23's VXVCLS array-order-stability decision.
- HY OAS ships as an absolute-level band this phase (not a moving average) — the FRED adapter's `limit=5` fetch persists only the latest observation per run, so a 20-day average would be non-functional for ~4 weeks on a brand-new series (Research Pitfall 1).
- Task 1's docs updates extend `data-model.md`/`jobs.md` to the full 11-series total (including VIX9D via CBOE, not yet code-complete) per the plan's explicit instruction to correct counts ahead of Task 2's code change — VIX9D's adapter lands in plan 24-02.

## Deviations from Plan

None — plan executed exactly as written. The RED-phase test failures matched the plan's expected shape (count/contains assertions, not import/syntax errors); the memory-twin and contract-suite additions are confirmation coverage of already-generic (text-column) behavior, same as Phase 23's precedent, not a true RED case — documented here per that same precedent, not a deviation.

## Issues Encountered

None.

## Known Stubs

None — `BAMLH0A0HYM2` flows through the real `makeFredSeriesAdapter` (existing, unmodified) via the existing cron; no mocked or hardcoded data path introduced.

## Threat Flags

None — reuses the existing hardened FRED fetch path (Zod parse + `.`-sentinel filter, `fred.ts`, unchanged). No new network endpoint, auth path, or schema change. Matches the plan's own threat register (T-24-01/T-24-02/T-24-SC, all `mitigate`/`accept` on unchanged code paths).

## User Setup Required

None — no external service configuration required. `BAMLH0A0HYM2` uses the FRED API key already configured for the 8 existing FRED series.

## Next Phase Readiness

`docs/architecture/regime-board.md` is now the citation-of-record for plan 24-02's VIX9D ingestion and plan 24-03's banding-function implementation — both can cite it directly instead of re-deriving thresholds. `BAMLH0A0HYM2` is accreting into `macro_observations` on the existing twice-daily cadence; plan 24-04's `getRegimeBoard` use-case can read it immediately, no warm-up wait beyond the first cron run. No blockers for 24-02.

---
*Phase: 24-regime-breadth-board*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: docs/architecture/regime-board.md
- FOUND: packages/core/src/journal/application/fetchMacroSeries.ts (BAMLH0A0HYM2 present)
- FOUND: packages/contracts/src/macro.ts (BAMLH0A0HYM2 present)
- FOUND: .planning/phases/24-regime-breadth-board/24-01-SUMMARY.md
- FOUND commit 3a74d17 (docs — Task 1)
- FOUND commit 38ec063 (feat RED→GREEN — Task 2)
