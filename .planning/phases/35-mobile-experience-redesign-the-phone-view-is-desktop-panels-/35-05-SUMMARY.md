---
phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-
plan: 05
subsystem: web
tags: [mobile, responsive, display-contents, css-order, overflow-clip]

requires:
  - phase: 35-01
    provides: "PayoffControls already a ChipRail (shared chart chrome fix reused by both screens' payoff center)"
provides:
  - "Analyzer reflows rail -> scorecard -> chart+term -> right below lg via display:contents on the inner grid container + order-* on four wrappers; lg:grid restores the exact 300px/1fr/330px grid, DOM byte-identical"
  - "Analyzer payoff chart full-bleed below lg (-mx-3 lg:mx-0), matching Overview's 35-03 treatment"
  - "Journal outer container ported from unconditional grid+overflow-hidden to flex-col (lg:grid lg:h-full lg:overflow-hidden), un-clipping the two right panes below lg; per-column overflow-y-auto/min-h-0 gated behind lg:"
affects: [35-06]

tech-stack:
  added: []
  patterns:
    - "display:contents (not order-* alone) used to reach across a two-level nesting Pattern 3 can't span on its own — flattens the inner grid box below lg so its children become flex-items of the SAME outer flex column the sibling scorecard block is in, letting order-* interleave them without moving any JSX (Analyzer-specific extension of Pattern 3, documented in 35-UI-SPEC section 4)"
    - "Journal needed zero order-* — master-detail content order (Trades -> Lifecycle -> reactive rail) already matches the desired mobile order, so only the responsive mechanics (grid/h-full/overflow-hidden/overflow-y-auto/min-h-0) moved behind lg:"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/screens/Journal.tsx
    - apps/web/src/screens/Journal.test.tsx

key-decisions:
  - "Added data-testid hooks (analyzer-scorecard-wrapper, analyzer-inner-grid, analyzer-rail-wrapper, analyzer-center-column, analyzer-right-wrapper, analyzer-payoff-chart-bleed; journal-positions, journal-trades-column, journal-lifecycle-column, journal-rail-column) purely as test-selection anchors — follows the exact convention 35-03 established on Overview.tsx (market-rail, overview-center-column, payoff-chart-bleed)."
  - "Only PayoffChart itself (not PayoffControls) is wrapped in the -mx-3 lg:mx-0 full-bleed div on Analyzer, mirroring Overview's 35-03 treatment exactly — the chart's negative margin negates Panel's p-3 horizontal inset, the controls strip stays inset."
  - "Journal's new outer inline style assertion used a negative-lookbehind regex (/(?<!lg:)\\boverflow-hidden\\b/) rather than a plain .not.toContain, since 'lg:overflow-hidden' legitimately contains the substring 'overflow-hidden' — the test needs to distinguish an unconditional class from an lg:-gated one."
  - "No JSX element was reordered in either screen — Analyzer's mobile visual reorder is entirely CSS (contents + order-*); Journal needed no reorder at all, only responsive-mechanics classes moved behind lg:. Verified in both suites with explicit DOM-order assertions (children index comparisons) so a future regression that silently reorders JSX would fail loudly, not just visually."

patterns-established:
  - "The Analyzer display:contents mechanism is the reusable answer for any future screen with 2+ levels of grid nesting that RESEARCH's simple order-* pattern can't reach — flatten the intermediate box below lg, let order-* work across the flattened set, restore the box at lg."

requirements-completed: [MOBILE-02]

coverage:
  - id: D1
    description: "Below lg Analyzer stacks in the visual order rail -> scorecard -> chart+term -> right-column, with no horizontal scroll; at lg it is the exact two-level layout of today (scorecard banner full-width above the 300px/1fr/330px grid) with byte-identical DOM"
    requirement: "MOBILE-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — mobile stack order (35-05: display:contents + order-*, full-bleed chart)"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px visual order + 1024px+ tripwire, per plan's own <verify> note)"
        status: pending
    human_judgment: true
  - id: D2
    description: "Analyzer's inner rail/chart/right container is display:contents below lg (promoting its three children to flex-items of the outer column) and lg:grid at desktop — no JSX element is reordered, only order-* (paint) and contents (box-flatten) change"
    requirement: "MOBILE-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — mobile stack order (35-05: display:contents + order-*, full-bleed chart) > flattens the inner rail/chart/right container via display:contents / threads order-* / keeps DOM order unchanged"
        status: pass
    human_judgment: false
  - id: D3
    description: "Below lg Journal flows as a normal single-column document (Trades -> Lifecycle -> reactive rail) with no clipping; at lg it is the 250px/1fr/290px three-pane layout with independent per-column scroll inside a fixed-height viewport, exactly as today"
    requirement: "MOBILE-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal — mobile stack order (35-05: flex-col lg:grid, un-clip below lg)"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px un-clipped flow + reachable right panes, 1024px+ tripwire, per plan's own <verify> note)"
        status: pending
    human_judgment: true

duration: ~20min
completed: 2026-07-11
status: complete
---

# Phase 35 Plan 05: Analyzer + Journal responsive port Summary

**Analyzer's two-level 300px/1fr/330px grid reflows via `display: contents` on the inner container + `order-*` on four wrappers (rail → scorecard → chart+term → right below `lg`, DOM byte-identical); Journal's `overflow-hidden` + fixed-grid clip trap is ported to `flex-col … lg:grid`, un-clipping its two right panes below `lg` — both screens byte/pixel-identical at `≥1024px`.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (each TDD: RED → GREEN)
- **Files modified:** 4

## Accomplishments

- `Analyzer.tsx`'s `ScoringMethodologyPanel` is now wrapped in `order-2 lg:order-none`, the inner rail/chart/right `<div className="grid gap-4" style={{ gridTemplateColumns: ... }}>` became `<div className="contents lg:grid lg:grid-cols-[300px_minmax(0,1fr)_330px] lg:gap-4">` (inline style dropped entirely), and its three children each gained an `order-*`/`lg:order-none` wrapper (`railBody` → `order-1`, center chart+term column → `order-3`, `RightColumn` → `order-4`). `contents` flattens the inner grid box below `lg`, promoting rail/center/right to flex-items of the same outer `flex flex-col` column the scorecard block already sits in — letting CSS `order` interleave scorecard between them without moving a single JSX element. At `lg:`, `lg:grid` reverts the box to a real grid, reproducing today's exact two-level nesting with zero pixel drift.
- The Analyzer payoff chart (`PayoffChart`, not `PayoffControls`) is wrapped in a new `-mx-3 lg:mx-0` div — full-bleed below `lg`, reverting at `lg` — the same treatment 35-03 applied to Overview's hero chart.
- `Journal.tsx`'s outer `<div className="grid h-full grid-cols-[250px_1fr_290px] gap-3 overflow-hidden p-3">` (the Pitfall-2 clip trap that hid the two right panes on a phone) became `<div className="flex flex-col gap-3 p-3 lg:grid lg:h-full lg:grid-cols-[250px_minmax(0,1fr)_290px] lg:overflow-hidden">`; each of the three column children moved from `flex min-h-0 flex-col gap-3 overflow-y-auto` to `flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto`. No `order-*` was needed — Journal's master-detail DOM order (Trades → Lifecycle → reactive rail) already is the desired mobile order.

## Task Commits

Each task committed atomically per RED → GREEN:

1. **Task 1: Analyzer — display:contents + order-* mobile reflow (DOM byte-identical)** — `9bc743e` `feat(35-05): Analyzer mobile reflow via display:contents + order-*`
2. **Task 2: Journal — flex-col lg:grid port, un-clip below lg** — `5babc24` `fix(35-05): Journal un-clips below lg via flex-col lg:grid port`

_No separate RED-only commits — each task's RED run was verified (genuine assertion failures — missing `data-testid`s, missing `contents`/`order-*`/`lg:` class strings, an inline `gridTemplateColumns` style still present — never import/syntax errors) before writing the GREEN implementation in the same commit, matching this repo's TDD-commit convention (commit only at green, per `.claude/rules/tdd.md`)._

## Files Created/Modified

- `apps/web/src/screens/Analyzer.tsx` — `ScoringMethodologyPanel`/rail/center/`RightColumn` each wrapped with `order-*`/`lg:order-none` + `data-testid`; the inner grid container's inline `gridTemplateColumns` style replaced with `contents lg:grid lg:grid-cols-[300px_minmax(0,1fr)_330px] lg:gap-4`; `PayoffChart` wrapped in `-mx-3 lg:mx-0`.
- `apps/web/src/screens/Analyzer.test.tsx` — added 1 new describe block (4 tests): `display:contents`/`lg:grid` class assertions, `order-*` on all four wrappers, DOM-order-unchanged assertion (children index comparison), full-bleed chart wrapper.
- `apps/web/src/screens/Journal.tsx` — outer container className changed to `flex flex-col gap-3 p-3 lg:grid lg:h-full lg:grid-cols-[250px_minmax(0,1fr)_290px] lg:overflow-hidden` + `data-testid="journal-positions"`; each of the three column `<div>`s gained `data-testid`s and moved `min-h-0`/`overflow-y-auto` behind `lg:`.
- `apps/web/src/screens/Journal.test.tsx` — added 1 new describe block (3 tests): outer container gates `grid`/`h-full`/`overflow-hidden` behind `lg:` (regex-checked to exclude the `lg:`-prefixed match), each column gates `overflow-y-auto`/`min-h-0` behind `lg:`, DOM order unchanged (Trades → Lifecycle → reactive rail).

## Decisions Made

- Followed the UI-SPEC's exact target markup for both screens (§"4. Analyzer — mobile stack order" and §"5. Journal — mobile stack order") verbatim — no material deviation from either.
- Chose `data-testid` naming that mirrors 35-03's Overview precedent exactly (`overview-center-column` → `analyzer-center-column`, `payoff-chart-bleed` → `analyzer-payoff-chart-bleed`) rather than inventing a new naming scheme, so a future reader scanning both files finds the same convention.
- Journal's RED test needed its own `beforeEach(() => mockUseRuleTags.mockReturnValue(emptyRuleTagsResult()))` since the new describe block sits outside the existing `describe("Journal screen", ...)` block that already had one — without it the component throws destructuring `undefined` before ever reaching a layout assertion (caught during RED, fixed before the real RED run).

## Deviations from Plan

None — plan executed exactly as written; both RED runs failed for the right reason on the first attempt (after fixing the Journal mock-setup gap above, which is scaffolding for the test itself, not a deviation from the plan's behavior spec), and both GREEN implementations passed on the first attempt.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both screens' layout containers are now fully reflowed for mobile; their internal content (candidate cards, trade rows, lifecycle chart, notes) is untouched — plan 35-06 owns the integration gate (desktop tripwires + 390px chrome-devtools UAT for both `<human-check>` items deferred above) on top of this plan's work with no conflict.
- `Analyzer 2.tsx` (the untracked stray file with a space in the name) was never opened, read, edited, or imported — confirmed via `git status --short` before and after both commits (stays `??` throughout).
- Verification run exactly as the plan's `<verification>` block specifies: `cd apps/web && bunx vitest run src/screens/Analyzer.test.tsx src/screens/Journal.test.tsx src/screens/JournalContainer.test.tsx` — 77/77 tests pass (55 Analyzer + 19 Journal + 3 JournalContainer, all pre-existing plus 7 new). `bun run typecheck` (root, `tsc --build --force`) clean. `bun run lint` clean (only the same pre-existing, unrelated `eslint-plugin-boundaries` legacy-selector warning noted in 35-01/35-02/35-03's summaries — not an error). Full workspace gate (`bun run test` at root) — 3249/3249 tests pass across 294 files.
- Not touched, and not needed by this plan per explicit instruction: `ROADMAP.md`, `STATE.md` (owned by the orchestrator/team-lead for this session).

## Self-Check: PASSED

All modified files and commit hashes verified present.

---
*Phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-*
*Completed: 2026-07-11*
