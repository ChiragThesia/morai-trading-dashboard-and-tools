---
phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f
plan: 01
subsystem: ui
tags: [react, visx, svg, payoff-chart, gex-walls, overview, kiss]

requires:
  - phase: 30-analyzer-payoff-domain-tail-fix
    provides: computePayoffDomain (strike/spot/breakeven-anchored x-domain that PayoffChart's off-domain wall clamp logic now operates against)
provides:
  - "PayoffChart wall/flip markers with zero in-chart text label collision surface (delete-label KISS strategy)"
  - "EDGE_ARROW_LANE_Y fixed-lane single-glyph edge arrow for off-domain walls, shared by Overview and Analyzer"
  - "Overview legend: γ flip / call wall / put wall per-series color swatches"
affects: [overview-screen, analyzer-screen, payoff-chart]

tech-stack:
  added: []
  patterns:
    - "Collision-proof-by-construction: fixed per-series y-lanes instead of runtime collision detection/measurement (jsdom cannot measure SVG text)"

key-files:
  created: []
  modified:
    - apps/web/src/components/charts/PayoffChart.tsx
    - apps/web/src/components/charts/PayoffChart.test.tsx
    - apps/web/src/screens/Overview.tsx

key-decisions:
  - "PinnedMarker reworked from {x,label,anchorEnd} to {x,clampedTo:'min'|'max'|null} — pinMarker() keeps identical clamp arithmetic, stops building label strings"
  - "In-chart wall/flip <text> label deleted entirely (rung 1 of ladder) rather than staggered/repositioned — dashed line is now the only in-chart signal, provably non-collidable since there is no text"
  - "Off-domain walls render a single glyph (›/‹) in one of 3 fixed y-lanes (flip:8, call:16, put:24) — two arrows on the same edge stack in distinct lanes, never sharing a bounding box, by construction not measurement"
  - "Overview legend's single generic 'walls' swatch split into 'call wall' (bg-up) and 'put wall' (bg-down), γ flip (bg-amber) unchanged — preserves color→meaning mapping the deleted labels used to carry"

patterns-established:
  - "Collision-proof-by-construction fixed-lane pattern for chart edge indicators — reusable for any future multi-series off-domain marker"

requirements-completed: [DEFECT-1]

coverage:
  - id: D1
    description: "PayoffChart renders zero wall/flip label text when levels are in-domain, including the real 2026-07-10 repro (flip 7488/putWall 7500/spot 7544/callWall 7550 on domain 7100-8050)"
    requirement: "DEFECT-1"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#real-repro 2026-07-10: flip 7488 / putWall 7500 / spot 7544 / callWall 7550 on 7100–8050 — zero wall-label text, lines at true x"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#fast-check: zero wall/flip label text nodes for arbitrary in-domain levels"
        status: pass
    human_judgment: false
  - id: D2
    description: "Off-domain walls render exactly one single-glyph edge arrow (›/‹) in a fixed per-series lane (EDGE_ARROW_LANE_Y), never overlapping across series"
    requirement: "DEFECT-1"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#off-domain call wall (8200 > domain.max 8050) renders a single '›' glyph in the call lane (y=16), no label text"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#off-domain put wall (6800 < domain.min 7100) renders a single '‹' glyph in the put lane (y=24), no label text"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#EDGE_ARROW_LANE_Y assigns three distinct y lanes to flip/call/put"
        status: pass
    human_judgment: false
  - id: D3
    description: "Overview legend maps γ flip / call wall / put wall colors to meaning now that in-chart labels are gone"
    requirement: "DEFECT-1"
    verification:
      - kind: unit
        ref: "bun run typecheck (apps/web/src/screens/Overview.tsx) — clean, no new errors"
        status: pass
    human_judgment: true
    rationale: "Legend markup is a styling-only JSX change (TDD-exempt per tdd.md scope) with no dedicated component test; visual correctness on a live clustered day is deferred to 31-VALIDATION's manual perceptual check per the plan's own verification section."

duration: ~20min
completed: 2026-07-10
status: complete
---

# Phase 31 Plan 01: Risk Profile Marker Collision Fix Summary

**Deleted PayoffChart's in-chart γflip/putWall/callWall text labels and replaced off-domain markers with fixed-lane single-glyph edge arrows, collision-proof by construction (KISS strategy per 31-UI-SPEC).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-10T18:25:35Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `PayoffChart.tsx`'s GEX-wall layer no longer renders any `<text>` label — only the dashed vertical line remains in-chart, so wall/flip levels clustering within 62 SPX pts (the real 2026-07-10 repro) can never produce overlapping text.
- Off-domain walls (a real case post-Phase-30, since the domain is anchored on strikes/spot/breakevens, not GEX walls) render a single `›`/`‹` glyph in one of 3 fixed vertical lanes (`EDGE_ARROW_LANE_Y = { flip: 8, call: 16, put: 24 }`), so two arrows clamped to the same edge stack in distinct lanes rather than piling into the same bounding box.
- Fix lives entirely in the shared `PayoffChart` component — both Overview and Analyzer get it with zero per-screen changes.
- Overview's curve-color legend gained `call wall` (bg-up) and `put wall` (bg-down) swatches (replacing the single generic "walls" swatch), preserving the color→meaning mapping the deleted labels used to carry.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete in-chart wall labels; render fixed-lane edge arrows for off-domain walls** - `1a75619` (fix)
2. **Task 2: Replace the generic "walls" legend swatch with three per-series wall swatches** - `07b6c08` (feat)

**Plan metadata:** pending (this commit)

_Note: Task 1 followed the project's single-commit-at-green TDD convention (test file written/run RED first — confirmed failing for the right reason: old label text/missing export — then implementation landed GREEN in the same commit), matching the 17.1-01/18-03/19-01 precedent recorded in STATE.md._

## Files Created/Modified
- `apps/web/src/components/charts/PayoffChart.tsx` — `PinnedMarker` type reworked to `{x, clampedTo}`; `pinMarker()` stops building label strings; new exported `EDGE_ARROW_LANE_Y` constant; GEX-wall layer deletes the `<text>` label, adds the conditional single-glyph edge arrow
- `apps/web/src/components/charts/PayoffChart.test.tsx` — removed 3 obsolete `getByText("...wall...")` assertions; added `EDGE_ARROW_LANE_Y` distinctness test, a 50-run fast-check no-label-text property, the literal 2026-07-10 repro example, and 2 off-domain single-glyph arrow examples (call-max and put-min)
- `apps/web/src/screens/Overview.tsx` — curve-color legend: `walls` (generic `bg-up`) swatch replaced with `call wall` (`bg-up`) + `put wall` (`bg-down`); `γ flip` (`bg-amber`) unchanged

## Decisions Made
- `PinnedMarker`'s label-building logic was deleted rather than kept-but-unused, so any lingering consumer of `marker.label`/`marker.anchorEnd` becomes a compile error (verified: none existed outside the Layer 6 wall block itself).
- Kept the exact edge-clamp arithmetic (`xScale(domain.max)` / `xScale(domain.min)` / `xScale(value)`) — only the label-string construction was removed — so the line geometry assertions in the pre-existing test suite needed no changes beyond removing their `getByText` counterparts.
- Task 2 treated as TDD-exempt styling-only per `.claude/rules/tdd.md` scope (no dedicated Overview legend component test); correctness verified via `bun run typecheck` showing zero new Overview.tsx errors.

## Deviations from Plan

None — plan executed exactly as written. `PayoffChart.tsx`/`PayoffChart.test.tsx`/`Overview.tsx` match the plan's `files_modified` list exactly; no additional files touched.

## Issues Encountered

`bun run typecheck` surfaced 11 pre-existing errors in files unrelated to this plan's scope (`ErrorBoundary.tsx`, `Button.tsx`, `useMacro.test.ts`, `candidate-to-position.test.ts`, `parsed-calendar-to-candidate.ts`/`.test.ts`, `tos-order.test.ts`, `Analyzer.test.tsx`, `JournalContainer.test.tsx`, `Overview.test.tsx`) — confirmed pre-existing via `git diff --stat HEAD -- apps/web/src` (only the two 31-01-owned chart files were modified before Task 2's Overview.tsx edit) and via grep showing none reference `PinnedMarker`/`marker.label`/`marker.anchorEnd`/`EDGE_ARROW_LANE_Y`. Out of scope per the executor's scope-boundary rule; logged to `.planning/phases/31-overview-risk-profile-kiss-redesign-marker-label-collision-f/deferred-items.md`, not fixed. `PayoffChart.tsx`/`.test.tsx`/`Overview.tsx` themselves produce zero typecheck errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 31-02 (RegimeBoard linear band-gauges, `31-UI-SPEC.md` Component Spec §2) is independent of this plan's files and can proceed.
- Manual perceptual verification on a live clustered day (morai.wtf Overview + Analyzer) remains deferred to `31-VALIDATION.md` post-deploy, as scoped by the plan's own `<verification>` block.
- No blockers.

---
*Phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commit hashes (`1a75619`, `07b6c08`) confirmed in `git log`.
