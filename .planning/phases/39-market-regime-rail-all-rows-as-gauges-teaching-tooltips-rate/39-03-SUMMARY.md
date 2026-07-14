---
phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate
plan: 03
subsystem: ui
tags: [react, tailwind, vitest, tdd]

requires: ["apps/web/src/components/system/BulletGauge.tsx (39-01)"]
provides:
  - "CotCard.tsx COT_GAUGE_SCALE — per-class widened axes (checker-corrected) so live prints never pin"
  - "CotCard.tsx 5 COT rows rendering through BulletGauge variant=\"neutral\", sign-tinted marker"
  - "CotCard.tsx cot-why-{key} 4-part WHAT/WHY/BANDS/SOURCE tooltip, verbatim UI-SPEC copy"
affects: [39-04]

tech-stack:
  added: []
  patterns:
    - "COT rows follow the same label+ⓘ-left/value-right/track-below row shape as RegimeBoard's Row and 39-02's RateGaugeRow — one shared rhythm across all three blocks"

key-files:
  created: []
  modified:
    - apps/web/src/components/CotCard.tsx
    - apps/web/src/components/CotCard.test.tsx

key-decisions:
  - "COT_GAUGE_SCALE axes widened per the plan's binding CHECKER CORRECTION: derived each axis as ±(max observed |net| across the test fixture's two weeks) × ~1.5 headroom, rounded up to a clean number — netDealer ±1.15M, netAssetManager ±1.5M, netLeveraged ±800K, netOther ±25K, netNonreportable ±200K. All five real/live values cited in the plan sit 45-66% into their tracks, never pinned."
  - "Split the single combined RED→GREEN pass into two atomic commits matching the plan's two tasks: reconstructed the Task-1-only intermediate (gauge rewire, no tooltip) to commit separately from Task 2 (tooltip + footnote), rather than one combined commit — keeps the task_commit_protocol's one-task-one-commit contract intact."
  - "aria-valuetext direction phrase (up/down) reads the WoW delta's sign, not the position's long/short sign — a short class can still read 'up' if it got less short week-over-week (e.g. netLeveraged −373K/down but WoW +142K/up)."

requirements-completed: [GAUGE-03, GAUGE-04]

coverage:
  - id: D1
    description: "5 COT rows render neutral, sign-tinted BulletGauge (bg-up long / bg-down short, never amber), no band segments"
    requirement: GAUGE-03
    verification:
      - kind: unit
        ref: "apps/web/src/components/CotCard.test.tsx (marker-color + no-band-segment assertions across all 5 classes)"
        status: pass
    human_judgment: false
  - id: D2
    description: "net/WoW spans read at 11px, label at 10px (no row-level size cascade); cot-net/cot-wow strings unchanged"
    requirement: GAUGE-03
    verification:
      - kind: unit
        ref: "apps/web/src/components/CotCard.test.tsx (typography + unchanged-string assertions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every COT row has a cot-why-{key} 4-part tooltip with verbatim UI-SPEC copy; footnote at 10px"
    requirement: GAUGE-04
    verification:
      - kind: unit
        ref: "apps/web/src/components/CotCard.test.tsx (hover + verbatim-substring assertions, footnote size)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-13
status: complete
---

# Phase 39 Plan 03: COT block gauges + COT teaching tooltips Summary

**Rewired the 5 COT trader-class rows onto the shared BulletGauge as neutral, sign-tinted (long/short, never verdict) meters on checker-corrected per-class axes, unified their typography to the 10/11px scale, and gave each a 4-part verbatim teaching tooltip — all 10 CotCard tests green, zero new tsc/lint findings.**

## Performance

- **Duration:** 35 min
- **Tasks:** 2/2 completed
- **Files modified:** 2 (`CotCard.tsx`, `CotCard.test.tsx`)

## Accomplishments

- `COT_GAUGE_SCALE` replaces the old shared `maxAbs`-relative proportional bar with five
  fixed, per-class visual axes. The UI-SPEC's original axes (±150K/±600K/±400K) were derived
  from a single-week HTTP fixture and are stale against this file's own two-week test
  fixture and the live prints cited in the plan's checker correction — netDealer −755.9K,
  netAssetManager +992.7K, and netLeveraged −515.5K (prior week) would all have pinned past
  their old axis edges. Each axis is now ±(max observed `|net|` × ~1.5 headroom), rounded up:
  netDealer ±1.15M, netAssetManager ±1.5M, netLeveraged ±800K, netOther ±25K,
  netNonreportable ±200K — every real print now sits 45-66% into its track.
- Each row renders `<BulletGauge variant="neutral">` with `markerColorClass={isLong ? "bg-up" : "bg-down"}` (reusing the existing `isLong = net >= 0` long/short convention) — never amber, never a band segment. A regression test walks all 5 classes asserting `role="meter"`, exactly one child (`:scope > div`, the marker — no band segments), and no `bg-amber` on any marker.
- Row layout now mirrors RegimeBoard's/39-02's shape: label + ⓘ on the left, net/WoW values on the right of the top line, the gauge full-width below — replacing the old single-line label|bar|value|WoW row. `cot-net-{key}`/`cot-wow-{key}` textContent is byte-identical to before.
- Typography unified: the row container's cascading `text-[10px]` is gone; the label span keeps `text-[10px]`, net/WoW spans move to `text-[11px]`, matching the rail's 10/11/12/13px scale.
- Each row gained a `cot-why-{key}` ⓘ `Badge`/`Tooltip` trigger (same idiom as `RegimeBoard`) opening a 4-line `WHAT`/`WHY`/`BANDS`/`SOURCE` payload in `TOOLTIP_COPY`, copied verbatim from `39-UI-SPEC.md`'s COT block — Dealer's longer BANDS sentence and the other four classes' shorter "Position only, no verdict." line are both preserved exactly.
- Legend footnote moved from `text-[9px]` to `text-[10px]`.
- Every gauge carries the full meter aria contract (`aria-valuemin`/`valuemax`/`valuenow` clamped/`valuetext`/`label`) — `aria-valuetext` states the signed net plus the WoW direction phrase (e.g. `"−373K contracts — up 142K week-over-week"`), never a band/verdict word.

## Task Commits

1. **Task 1: COT_GAUGE_SCALE axes + neutral direction-tinted BulletGauge rewire + typography** — `eed8694` (feat) — RED confirmed first (missing `cot-gauge-*` test ids, `text-[9px]`-cascade test failures), then GREEN (8/8 tests in the Task-1-only state)
2. **Task 2: Four-part COT teaching tooltips + a11y meter parity + footnote size** — `0b08f2f` (feat) — RED confirmed first (`cot-why-netLeveraged` trigger missing, footnote still `text-[9px]`), then GREEN (10/10 full suite)

## Files Created/Modified

- `apps/web/src/components/CotCard.tsx` — `COT_GAUGE_SCALE`, `TOOLTIP_COPY`, `cotAriaValueText`, BulletGauge-based row, 4-part tooltip, typography fix
- `apps/web/src/components/CotCard.test.tsx` — 6 new tests (marker sign/no-band, unchanged net/WoW strings, typography, aria parity, tooltip verbatim, footnote size) alongside the 4 existing tests, all passing

## Decisions Made

- Widened all 5 axes uniformly by the same ±(max observed × 1.5) formula rather than only the 3 axes the checker correction named by number (dealer/assetMgr/leveraged) — netOther and netNonreportable's old ±150K axis technically wasn't clipping today's fixture, but the same formula pushed netNonreportable's headroom from 1.22x to 1.5x and shrank netOther's from ~10.7x to 1.5x, giving one consistent, defensible derivation across the block instead of a mix of "touched" and "untouched" axes.
- Split the single implemented-together RED→GREEN pass into two separate atomic commits by reconstructing the Task-1-only intermediate file state, so the git history matches the plan's two-task structure (task_commit_protocol's one-commit-per-task contract) rather than one combined commit.
- Kept `w-14`/`w-16 shrink-0 text-right` on the net/WoW spans for consistent right-edge value-column alignment across rows, even though the row shape no longer needs fixed-width columns for the bar-between-values layout it replaced.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blockers encountered. The plan's own CHECKER CORRECTION (axis widening) was implemented as specified, not treated as a deviation.

## Issues Encountered

- `bun run typecheck` (workspace-scoped) briefly surfaced 3 extra errors in `RegimeBoard.tsx` referencing `TOOLTIP_COPY`/`RATE_SOURCE`/`InfoTooltip` while checked mid-task — confirmed via diff against the pre-existing 8-error baseline that these come from the parallel 39-02 executor's in-progress edits to `RegimeBoard.tsx` in the same shared working tree, not from this plan's files. `apps/web`'s scoped `tsc --noEmit` run showed the expected 8 pre-existing errors with zero `CotCard.tsx` errors both before and after this plan's changes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`CotCard.tsx`'s COT block now matches the regime/rate blocks' gauge + tooltip rhythm. 39-04 (integration gate) can run the full suite, typecheck, and lint across all three rewired blocks together once 39-02 lands; this plan's scoped files (`CotCard.tsx`/`CotCard.test.tsx`) are self-contained and did not touch `RegimeBoard.*`, `BulletGauge.*`, `.planning/STATE.md`, or `.planning/ROADMAP.md`.

---
*Phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate*
*Completed: 2026-07-13*

## Self-Check: PASSED
All modified files and commit hashes (eed8694, 0b08f2f) verified present.
