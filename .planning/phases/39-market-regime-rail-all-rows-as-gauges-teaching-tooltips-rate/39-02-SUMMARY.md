---
phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate
plan: 02
subsystem: ui
tags: [react, tailwind, vitest, tdd]

requires: ["39-01"]
provides:
  - "RATE_GAUGE_SCALE/RATE_BANDS client-only display constants in RegimeBoard.tsx (gate BLIND)"
  - "RateGaugeRow — 4 neutral money-rate gauges (bg-dim, no bands) + 2 banded yield-curve gauges"
  - "TOOLTIP_COPY/RATE_SOURCE + shared InfoTooltip — 4-part WHAT/WHY/BANDS/SOURCE tooltips for all 10 rows"
affects: ["39-04"]

tech-stack:
  added: []
  patterns:
    - "RateGaugeRow mirrors Row's label+value+BulletGauge shape but sources value via a shared latestValue(data, id) helper so the printed string and the gauge never double-parse"
    - "InfoTooltip: one shared ⓘ badge/Tooltip/TooltipContent idiom parameterized by what/why/bands/source, used by both regime rows (server source+rationale) and rate rows (static RATE_SOURCE)"

key-files:
  modified:
    - apps/web/src/components/RegimeBoard.tsx
    - apps/web/src/components/RegimeBoard.test.tsx

key-decisions:
  - "Kept RATE_SOURCE as a separate map from TOOLTIP_COPY (what/why/bands only) instead of folding source into TOOLTIP_COPY as an optional field — regime rows never carry a source in the map (they use indicator.source/rationale), so a single map would need an unused optional field on 4 of 10 entries"
  - "rateBand(value, bands) checks crisis before warn (crisis ⊆ warn since -0.50 ≤ 0.0) — a plain client-side classifier, never touching usePicker/useRegimeBoard"
  - "fmtRate refactored to call latestValue internally (single source for both the printed value and the gauge's numeric input) rather than duplicating the points[]-latest lookup"

requirements-completed: [GAUGE-02, GAUGE-04, GAUGE-05]

coverage:
  - id: D1
    description: "4 money-rate rows render NEUTRAL bg-dim gauges, no band-segment children, for any value"
    requirement: GAUGE-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx — 'renders the 4 money-rate rows as NEUTRAL bg-dim gauges...' + 'aria-valuetext states...position'"
        status: pass
    human_judgment: false
  - id: D2
    description: "10Y-2Y/10Y-3M render BANDED gauges from RATE_BANDS at documented thresholds (crisis/warning/calm boundary values)"
    requirement: GAUGE-05
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx — -0.60 crisis / -0.20 warning / +0.50 calm boundary tests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Regime + rate ⓘ tooltips render 4-part WHAT/WHY/BANDS/SOURCE, copy verbatim from UI-SPEC; regime rows keep server source/rationale as SOURCE"
    requirement: GAUGE-04
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx — 'teaching tooltips' describe block (hy-oas provenance preserved, T10Y2Y banded wording, DFF neutral wording)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-13
status: complete
---

# Phase 39 Plan 02: Rates block gauges + regime/rate teaching tooltips Summary

**Turned the 6 rates rows into bullet gauges (4 neutral position-only money rates + 2 banded yield-curve spreads) and rewrote every RegimeBoard ⓘ tooltip into a 4-part WHAT/WHY/BANDS/SOURCE teaching payload, copy verbatim from the UI-SPEC.**

## Performance

- **Duration:** 35 min
- **Tasks:** 2/2 completed
- **Files modified:** 2 (component + test, per the plan's pathspec-scoped file list)

## Accomplishments

- `RATE_GAUGE_SCALE` (per-id visual axis) and `RATE_BANDS` (calm `> 0.0` / warning `≤ 0.0` / crisis `≤ -0.50`, matching the 39-01-documented t10y2y/t10y3m evidence rows) are client-only display constants — never passed to `usePicker`/`useRegimeBoard`, confirmed by a `grep -n RATE_BANDS` showing only definition + display-code call sites.
- `RateGaugeRow` replaces `RateRow`: Fed Funds/SOFR/1M/3M render a `variant="neutral"` `BulletGauge` with a `bg-dim` marker for every value and zero band-segment children (never `bg-amber`/`bg-down`/`bg-txt`, so "no verdict" never reads as calm); 10Y−2Y/10Y−3M render `variant="banded"` gauges with a local `rateBand()` classifier. A rate with no macro point renders the value dash and omits the gauge entirely — no marker at a fabricated 0 (catch #26 discipline, test-covered).
- `latestValue(data, id)` is the single source both `fmtRate`'s printed string and the gauge's numeric value read from — no double parse of `data[id]`'s latest point.
- `TOOLTIP_COPY` (WHAT/WHY/BANDS, 10 entries: 4 regime + 6 rate ids) and `RATE_SOURCE` (static SOURCE line, 6 rate ids) hold the UI-SPEC's locked copy verbatim. A shared `InfoTooltip` component renders the 4-line stack (`text-txt` WHAT/WHY, `text-muted-foreground` BANDS, `text-dim` SOURCE) and is used by both the 4 regime rows (`regime-why-{id}`, SOURCE = server `indicator.source`+`indicator.rationale`, unchanged/test-covered) and the 6 rate rows (new `rate-why-{id}` trigger, SOURCE = static `RATE_SOURCE[id]`). The ⓘ `Badge` glyph moved `text-[9px]` → `text-[10px]` per the Typography table.

## Task Commits

1. **Task 1: RATE_BANDS + RATE_GAUGE_SCALE + RateGaugeRow (neutral 4, banded 2)** - `5b2100b` (feat) — RED confirmed (8 new tests failing on missing `rate-gauge-*`/`rate-gauge-marker-*` testids, 32 pre-existing green), then implementation to GREEN (37/37, including 5 of the new rate-gauge tests — 2 had already been satisfied by pre-existing `fmtRate` behavior and don't depend on the tooltip work split out to Task 2)
2. **Task 2: Four-part teaching tooltips — regime rows (upgrade) + rate rows (new)** - `7c46d4a` (feat) — RED confirmed on top of Task 1's green base (3 new tooltip tests failing on missing `rate-why-{id}`/4-part copy, 37 pre-existing green), then implementation to GREEN (40/40)

## Files Created/Modified

- `apps/web/src/components/RegimeBoard.tsx` - `RATE_GAUGE_SCALE`, `RATE_BANDS`, `rateBand()`, `latestValue()`, `RATES` extended with `variant`, `RateGaugeRow` (replaces `RateRow`), `TOOLTIP_COPY`, `RATE_SOURCE`, shared `InfoTooltip` component, `Row` rewired onto `InfoTooltip`
- `apps/web/src/components/RegimeBoard.test.tsx` - "rate block gauges" describe block (7 tests) + "teaching tooltips" describe block (3 tests); all 30 pre-existing tests (39-01 baseline) plus the 10 new ones pass unmodified in substance

## Decisions Made

- `RATE_SOURCE` kept as its own map rather than an optional `source` field on `TOOLTIP_COPY` — regime rows have no static source (they render the server's own `indicator.source`/`rationale`), so a shared field would sit unused on 4 of 10 entries; two maps keep each caller's data shape honest.
- `rateBand()` checks `value <= crisis` before `value <= warn` (crisis, at ≤ −0.50, is numerically a subset of warn's ≤ 0.0 range) — a plain client-side classifier local to `RegimeBoard.tsx`, never touching a gate.
- Split what was authored as one combined implementation pass into two atomic commits matching the plan's task boundaries: reverted Task 2's tooltip wiring, re-confirmed Task 1 green in isolation, committed, then reapplied Task 2's tooltip test block (RED) before reapplying the tooltip implementation (GREEN) and committing separately.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes were needed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`RATE_BANDS`/`RATE_GAUGE_SCALE` are display-only constants confirmed to appear nowhere outside `RegimeBoard.tsx`'s render path — ready for 39-04's gate-blind grep verification. `apps/web` tsc baseline holds at 7 pre-existing errors (none in `RegimeBoard.tsx`, none newly introduced); lint clean on both touched files. The `InfoTooltip`/`TOOLTIP_COPY` pattern established here is available if 39-03's COT rows (built in parallel on `CotCard.tsx`, a disjoint file) want the same 4-part teaching idiom, though this plan did not touch `CotCard.*`.

---
*Phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate*
*Completed: 2026-07-13*

## Self-Check: PASSED
Verified present: `apps/web/src/components/RegimeBoard.tsx`, `apps/web/src/components/RegimeBoard.test.tsx`; commit hashes `5b2100b` and `7c46d4a` confirmed in `git log`.
