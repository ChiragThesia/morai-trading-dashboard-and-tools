---
phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-
plan: 03
subsystem: web
tags: [mobile, responsive, chip-rail, css-order, chart-chrome, pill-header]

requires:
  - phase: 35-01
    provides: "ChipRail shared scroll-snap primitive, exported from components/system"
  - phase: 35-02
    provides: "MarketRail accepts className + defaults closed, force-visible at lg"
provides:
  - "Overview PillHeader: mobile 4-chip priority row + 6-chip secondary ChipRail, de-stickied below lg, unchanged 10-chip row at lg"
  - "Overview 3-column grid reordered via CSS order (MarketRail order-2 lg:order-1, center order-1 lg:order-2, GEX order-3), DOM/tab order unchanged"
  - "Payoff hero full-bleed below lg (-mx-3 lg:mx-0); 'view-only · Analyzer →' chrome hidden below lg"
affects: [35-04, 35-06]

tech-stack:
  added: []
  patterns:
    - "PillHeader duplicates the same computed chip value/valueClassName expressions into three sibling blocks (priority row / secondary ChipRail / full row) rather than conditionally rendering one set — CSS display:none/hidden gates visibility per breakpoint, all three exist in the DOM at once (Pattern 3 precedent from the UI-SPEC)"
    - "Grid reorder via CSS order-* on three existing sibling divs — zero JSX/DOM reordering, MarketRail stays first in source so keyboard tab order is unaffected"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx

key-decisions:
  - "Duplicating chip markup into 3 DOM blocks (not one set toggled by breakpoint) means labels like '0DTE γ' now match twice in jsdom (no real CSS media query evaluation in tests) — the pre-existing 'Pill header — 0DTE γ pill' test was scoped to within(pill-header-full) rather than left on an unscoped getByText, since that duplication is a direct, expected consequence of this task's own change (Rule 1 — fix the regression it causes, don't leave it red)."
  - "Added data-testid hooks (pill-header, pill-header-priority, pill-header-full, overview-center-column, overview-gex-column, payoff-chart-bleed) purely as test-selection anchors — matches the file's existing convention (market-rail, gex-rail-empty, gex-freshness) rather than inventing a new pattern."
  - "PayoffChart's full-bleed treatment wraps it in a new -mx-3 lg:mx-0 div rather than editing the component itself — chart internals stay completely untouched (D-10), only the wrapper margin negates Panel's p-3 horizontal inset below lg."

patterns-established:
  - "Test-only data-testid additions for structural/layout assertions (order-*, hidden/lg: pairs) follow the existing single-word-kebab convention already used elsewhere in Overview.tsx's test surface."

requirements-completed: [MOBILE-01, MOBILE-03, MOBILE-04]

coverage:
  - id: D1
    description: "Below lg the Overview header shows a single-line priority row (SPX, net γ/1%, VIX, book) plus a horizontally-scrolling ChipRail of the remaining 6 metrics; at lg all 10 chips render in today's single flex-wrap row unchanged"
    requirement: "MOBILE-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#PillHeader — mobile priority row + secondary ChipRail (35-03)"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px + 1024px+ chrome-devtools UAT, per plan's own <verify> note)"
        status: pending
    human_judgment: true
  - id: D2
    description: "Below lg the payoff hero renders ABOVE the collapsed MarketRail (MarketRail visually last via CSS order, DOM order unchanged); at lg the 3-column grid is byte-identical"
    requirement: "MOBILE-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#Overview — mobile stack order (35-03: order-*, full-bleed chart, view-only hidden)"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px visual order + tab-order check, per plan's own <verify> note)"
        status: pending
    human_judgment: true
  - id: D3
    description: "Below lg the PillHeader is normal in-flow content (not sticky) so Shell's header is the only sticky layer; at lg it is sticky exactly as today"
    requirement: "MOBILE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#PillHeader — mobile priority row + secondary ChipRail (35-03) > de-stickies the PillHeader wrapper below lg"
        status: pass
    human_judgment: false
  - id: D4
    description: "Below lg the payoff chart is full-bleed (negates Panel's horizontal padding) and the redundant 'view-only · Analyzer →' chrome is hidden; at lg both revert exactly"
    requirement: "MOBILE-03"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#Overview — mobile stack order (35-03: order-*, full-bleed chart, view-only hidden) > makes the payoff chart full-bleed / hides the view-only chrome"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-11
status: complete
---

# Phase 35 Plan 03: Overview mobile structure (PillHeader split + grid stack order) Summary

**PillHeader split into a mobile 4-chip priority row + 6-chip scroll-snap ChipRail (de-stickied below `lg:`), and the 3-column grid reordered via CSS `order-*` so the payoff hero paints above the collapsed MarketRail on phones — DOM/tab order and desktop (`≥1024px`) visuals byte-identical throughout.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (each TDD: RED → GREEN)
- **Files modified:** 2

## Accomplishments

- `PillHeader` now renders three sibling blocks inside one `static lg:sticky` wrapper: a `lg:hidden` priority row (SPX, net γ/1%, VIX, book — compact `px-2 py-1 gap-1` `MetricChip` override), a `lg:hidden` `ChipRail` (`role="group"`, `aria-label="Additional market metrics"`) holding the other 6 chips (0DTE γ, γ flip, VVIX, Fed funds, 10y−2y, COT lev), and the unchanged `hidden lg:flex` full 10-chip row. All three reuse the exact same computed values/`valueClassName` expressions (`regime`, `zeroDte`, `vix`, `vvix`, `dff`, `curveSlope`) — no metric computation was touched.
- The 3-column grid (`MarketRail` / center hero+positions / GEX rail) is reordered via CSS `order-*` only: `MarketRail` gets `order-2 lg:order-1`, the center column `order-1 lg:order-2`, the GEX column `order-3` — the mobile visual order becomes priority KPI → chip rail → payoff hero → positions → MarketRail (collapsed) → GEX rail, while `MarketRail` stays first in DOM/tab order (Pattern 3 — no JSX element moved).
- The payoff hero's chart is wrapped in a new `-mx-3 lg:mx-0` div (full-bleed below `lg:`, reverts at `lg:`) without touching `PayoffChart` itself; the `"view-only · Analyzer →"` action span is now `hidden lg:inline` (redundant wayfinding on a narrow screen with the nav one tap away).

## Task Commits

Each task committed atomically per RED → GREEN:

1. **Task 1: PillHeader — priority row + secondary ChipRail, de-stickied below lg** — `9b4d585` `feat(35-03): split PillHeader into mobile priority row + secondary ChipRail`
2. **Task 2: Grid stack order + MarketRail order prop + full-bleed chart + view-only hidden** — `78a4c42` `feat(35-03): reorder Overview grid via CSS order, full-bleed chart below lg`

_No separate RED-only commits — each task's RED run was verified (genuine assertion failures — missing `data-testid`s / missing `order-*`/`-mx-3`/`hidden` class strings, never import/syntax errors) before writing the GREEN implementation in the same commit, matching this repo's TDD-commit convention (commit only at green, per `.claude/rules/tdd.md`)._

## Files Created/Modified

- `apps/web/src/screens/Overview.tsx` — `PillHeader` restructured into 3 sibling blocks (priority row / secondary `ChipRail` / full row); grid children gained `order-*` classes and `data-testid`s; `PayoffChart` wrapped in a full-bleed `-mx-3 lg:mx-0` div; the view-only action span gated `hidden lg:inline`.
- `apps/web/src/screens/Overview.test.tsx` — added 2 new describe blocks (8 tests: 4 for the PillHeader split, 4 for grid order/full-bleed/view-only); fixed the pre-existing "Pill header — 0DTE γ pill" test to scope its assertions to `within(pill-header-full)` (see Deviations).

## Decisions Made

- Followed the UI-SPEC's exact target markup for `PillHeader` (§"1. Overview — mobile stack order" → "PillHeader split") and the grid excerpt verbatim — no material deviation from either.
- Added `data-testid` hooks purely as test-selection anchors (`pill-header`, `pill-header-priority`, `pill-header-full`, `overview-center-column`, `overview-gex-column`, `payoff-chart-bleed`) — the plan's `<action>` steps didn't mandate specific test IDs, but the file's existing convention (`market-rail`, `gex-rail-empty`, `gex-freshness`) already relies on `data-testid` for structural assertions, so this follows established precedent rather than introducing e.g. brittle `container.querySelector` class-string matching.
- `snap-start shrink-0` applied to all 6 secondary-rail `MetricChip`s (not a subset) — matches 35-01's own `PayoffControls` precedent of applying it to every direct child of a `ChipRail`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing "Pill header — 0DTE γ pill" test broke on the intentional chip duplication**
- **Found during:** Task 1 GREEN run (full-suite pass after implementing the PillHeader split)
- **Issue:** The plan's own duplication strategy (same "0DTE γ" chip now exists in both the mobile secondary `ChipRail` and the desktop full row — jsdom renders both regardless of viewport, since there's no real CSS media-query evaluation in tests) caused the pre-existing unscoped `screen.getByText("0DTE γ")` / `screen.getByText("−$9.8B")` assertions to start matching two elements instead of one.
- **Fix:** Scoped both assertions to `within(screen.getByTestId("pill-header-full"))`, which is guaranteed to hold exactly one of each chip regardless of breakpoint. No other pre-existing test in the file collided (verified by grepping every chip label/value string used in `getByText`/`queryByText` calls before implementing).
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Commit:** `9b4d585`

None beyond the above — every other RED run failed for the right reason (missing test hooks/classes, not import/syntax errors), and both GREEN implementations passed on the first attempt.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `Overview.tsx`'s header/grid/chrome region is now fully reflowed for mobile; the positions region (`PositionsTable` / the desktop `<table>`) is untouched in this plan — plan 35-04 owns that region next wave (card transform, `PositionCard` mount) on the same file with no conflict, since this plan never touched `PositionsTable` or the `<table>` markup.
- `buildCalendarPosition`'s Phase 34-05 carry wiring (fractional DTE + per-leg carry) was read but not touched — verified untouched by the full `buildCalendarPosition` test suite (`describe("buildCalendarPosition (34-05: fractional DTE + per-leg carry)")`) still passing 2/2 in the final broader sweep.
- Verification run exactly as the plan's `<verification>` block specifies: `cd apps/web && bunx vitest run src/screens/Overview.test.tsx` — 66/66 tests pass (58 pre-existing + 8 new). `bun run typecheck` (root, `tsc --build --force`) clean. `bun run lint` clean for changed files (only the same pre-existing, unrelated `eslint-plugin-boundaries` legacy-selector warning noted in 35-01/35-02's summaries — not an error). Full workspace gate (`bun run test` at root) — 3242/3242 tests pass across 294 files (3234 from 35-02's baseline + 8 new from this plan).
- The plan's `<human-check>` items (390px priority-row/ChipRail visual check, 1024px+ full-row/sticky tripwire; 390px hero-above-MarketRail visual + tab-order check, 1024px+ 3-column-grid/chart-chrome tripwire) are explicitly deferred to plan 35-06's integration gate per the plan's own `<verify>` notes ("Manual (end-of-phase UAT, per 35-06)") — not performed in this plan, tracked as `pending`/`human_judgment: true` in the coverage table above.
- Not touched, and not needed by this plan: `ROADMAP.md`, `STATE.md` (per instruction — orchestrator owns those).

## Self-Check: PASSED

All modified files and commit hashes verified present.

---
*Phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-*
*Completed: 2026-07-11*
