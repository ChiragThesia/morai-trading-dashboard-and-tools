---
phase: 42-design-system-consolidation-one-reusable-component-system-fo
plan: "03"
subsystem: ui
tags: [react, tailwind, data-table, design-system]

requires:
  - phase: 42-design-system-consolidation-one-reusable-component-system-fo (Plan 01)
    provides: "DataTable<T> primitive (sort/hover/renderRowDetail/footer slots)"
provides:
  - "Overview's PositionsTable rendered through the shared DataTable<Row> primitive"
  - "Header + body cell chrome converged to px-2 py-1.5 (matching CandidateTable)"
  - "Locked ownership pattern: DataTable owns header + base rows only; expandable
     detail row and Net-total row are caller-composed via renderRowDetail/footer"
affects: [42-05-phase-verify]

tech-stack:
  added: []
  patterns:
    - "Per-row live-data memoization: one resolveLivePositionRow Map computed per render,
       looked up (not recomputed) by each of the six live DataTableColumn render() fns"
    - "Live-cell flash remount trick moved from <td key=...> (DataTable now owns <td>) to
       an inner <span key=...> inside each live column's render() — React still respects
       key changes on a single (non-array) child to force unmount/remount"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Overview.tsx

key-decisions:
  - "wrapperClassName=\"\" (bare passthrough) — PositionsTable's <table> had no scroll
     wrapper before this migration; DataTable's div wrapper with an empty className
     reproduces that exact layout, no new overflow/scroll behavior introduced"
  - "tableClassName omitted — the original bare 'table' Tailwind utility class (display:
     table) was redundant on a native <table> element and unrelated to the .live-cell/
     .live-cell-flash CSS (verified against index.css), so it was dropped rather than
     carried forward"
  - "Net-total row padding converged to px-2 py-1.5 (was py-1) alongside the header/body
     convergence, for visual consistency with the DataTable-rendered rows above it —
     not test-asserted, matches the phase's stated convergence intent"

requirements-completed: []

coverage:
  - id: D1
    description: "PositionsTable renders through DataTable<Row> with detail + footer
      slots; every live-greek overlay, IV n/a badge, VERDICT chip, checkbox-include,
      opacity-40/highlight, and hover-sync behavior preserved verbatim"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx (89/89 passing, zero test-file edits)"
        status: pass
      - kind: other
        ref: "cd apps/web && bunx tsc --noEmit (9 pre-existing errors, none new/none in Overview.tsx PositionsTable)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-16
status: complete
---

# Phase 42 Plan 03: Overview PositionsTable → DataTable Summary

**Migrated Overview's docked PositionsTable off its hand-rolled `<table>` onto the shared `DataTable<Row>` primitive, converging its chrome (px-2 py-1.5, sticky bg-panel header) to CandidateTable's — the expandable verdict-detail row and Net-total row stay caller-composed via `renderRowDetail`/`footer`.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-16
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `PositionsTable` in `apps/web/src/screens/Overview.tsx` now renders through `<DataTable<Row>>` instead of a hand-rolled `<table>`/`<thead>`/`<tbody>` — header and body cells converge to the shared `px-2 py-1.5` density and sticky `bg-panel` header, matching `CandidateTable` (the user's original "these must be indistinguishable" complaint).
- All 10 columns (checkbox-include + the 9 `COLS`) moved into `DataTableColumn<Row>` definitions; the six live-sourced columns (Net val, Unreal, Δ, Γ, Θ/d, Vega) each read from one `resolveLivePositionRow` result per row — a `resolvedByKey` Map computed once per render rather than 6× per row.
- The per-tick `key=` remount trick that drives the `.live-cell-flash` CSS animation moved from the `<td>` (now DataTable-owned) to an inner `<span key=...>` inside each live column's `render()` — React still honors a key change on a single child to force unmount/remount, so the flash animation still restarts on tick arrival.
- The expandable verdict-detail `<tr data-testid="position-verdict-detail-{key}">` and the Net-total `<tr>` are passed through DataTable's `renderRowDetail`/`footer` slots (Plan 01's escape hatches) — DataTable itself owns zero expansion/total state, matching the phase's locked ownership decision.
- Every preserved behavior verified byte-identical via the unedited `Overview.test.tsx` oracle: IV n/a badge+tooltip, VERDICT chips (`VerdictChangedMarker`/`VerdictChip`), checkbox `aria-label="Include {label} in risk profile & total"` with click-stop, `opacity-40` excluded-row dimming, `bg-raise/20` highlight, hover→payoff-chart sync, empty-state early-return copy.

## Task Commits

1. **Task 1: migrate PositionsTable onto DataTable with detail + footer slots** - `0a23746` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/screens/Overview.tsx` - `PositionsTable` rewritten onto `DataTable<Row>`; `formatExpiryCell`/`buildCalendarPosition` re-export line and the empty-state early-return kept unchanged.

## Decisions Made

- `wrapperClassName=""` — the original bare `<table>` had no scroll wrapper; an empty-string passthrough on DataTable's outer `<div>` reproduces that exact (lack of) layout constraint rather than inventing a new one.
- `tableClassName` omitted entirely — checked `index.css` and confirmed `.live-cell`/`.live-cell-flash`/`.live-cell.stale` depend on nothing from the original bare `table` Tailwind utility class (which was a no-op `display: table` on an already-`<table>` element); safe to drop.
- Net-total row's cell padding converged to `px-2 py-1.5` (was `py-1`) alongside the header/body convergence — not asserted by any test, but keeps the total row visually consistent with the DataTable-rendered rows immediately above it, matching the phase's stated intent ("this is the one intentional density delta the migration produces").

## Deviations from Plan

None - plan executed exactly as written. The plan's own resolved-ownership decision (DataTable owns header + base rows; detail/total rows are caller-composed via `renderRowDetail`/`footer`) was followed literally, including the exact column-building and per-row live-map approach the action text specified.

## Issues Encountered

None. `Overview.test.tsx` stayed green (89/89) through the rewrite with zero test-file edits (`git diff --quiet` confirmed). `tsc --noEmit` baseline was independently re-verified via `git stash` before/after: 9 pre-existing errors both times, none touching `PositionsTable`. `bunx eslint src/screens/Overview.tsx` is clean. Full web suite run: 895/896 passing — the one pre-existing failure (`MarketRail.test.tsx`, a `readFileSync` relative-path bug unrelated to this file) was confirmed present before this change via the same `git stash` A/B check, so it is out of this task's scope per the Scope Boundary rule.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Overview's positions table and the Analyzer's candidate table now render through the same `DataTable` primitive with the same chrome — Plan 04 (Button consolidation) and remaining sweep work in Plan 05 can proceed.
- Visual parity (chrome-devtools screenshots, no page scroll at 1512×860 / 2056×1329) is explicitly deferred to the phase-gate check in Plan 05 per this plan's own `<verification>` section — not re-verified here.

---
*Phase: 42-design-system-consolidation-one-reusable-component-system-fo*
*Completed: 2026-07-16*

## Self-Check: PASSED
- FOUND: apps/web/src/screens/Overview.tsx
- FOUND: 0a23746 (feat commit)
- FOUND: 5c78081 (docs/summary commit)
