---
phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate
plan: 01
subsystem: ui
tags: [react, tailwind, vitest, fast-check, docs-first]

requires: []
provides:
  - "docs/architecture/regime-board.md evidence rows for t10y2y/t10y3m (bands, [ASSUMED] crisis tier, client-visual-only/gate-blind note)"
  - "apps/web/src/components/system/BulletGauge.tsx — shared banded|neutral meter track, exported from the system barrel"
  - "RegimeBoard's 4 regime rows rendering through BulletGauge with the existing suite green unmodified"
affects: [39-02, 39-03]

tech-stack:
  added: []
  patterns:
    - "BulletGauge presentational track: caller owns label/value line + axis/band/marker-color inputs, component owns meter DOM + clamp math"

key-files:
  created:
    - apps/web/src/components/system/BulletGauge.tsx
    - apps/web/src/components/system/BulletGauge.test.tsx
  modified:
    - docs/architecture/regime-board.md
    - apps/web/src/components/system/index.tsx
    - apps/web/src/components/RegimeBoard.tsx

key-decisions:
  - "bandWarn/bandCrisis stay flat optional props narrowed by a runtime branch (throw if banded + undefined), not a discriminated union — matches the UI-SPEC's flat prop contract"
  - "Band segments rendered via a React Fragment (no wrapping div) so :scope > div child-count/order assertions (2 for banded, 0 for neutral, plus marker) hold without an extra DOM layer"

patterns-established:
  - "Shared gauge track extraction: one BulletGauge implementation with three planned callers (RegimeBoard now; rates block 39-02, COT block 39-03 next)"

requirements-completed: [GAUGE-01, GAUGE-05]

coverage:
  - id: D1
    description: "docs/architecture/regime-board.md documents t10y2y/t10y3m inversion bands (evidence-before-code, GAUGE-05)"
    requirement: GAUGE-05
    verification:
      - kind: other
        ref: "grep -Eiq 't10y2y|t10y3m|\\[ASSUMED\\]|macro_rates' docs/architecture/regime-board.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "Shared BulletGauge component (banded + neutral variants, role=meter, clamped marker/band positions)"
    requirement: GAUGE-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/system/BulletGauge.test.tsx (4 tests incl. fast-check clamp property)"
        status: pass
    human_judgment: false
  - id: D3
    description: "RegimeBoard's 4 regime rows refactored onto BulletGauge at zero visual change"
    requirement: GAUGE-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx (30 tests, file unmodified — git diff --quiet confirmed)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 39 Plan 01: Docs evidence rows + BulletGauge extraction + regime-row refactor Summary

**Extracted RegimeBoard's inline meter markup into a shared `BulletGauge` (banded + neutral variants) and rewired the 4 regime rows onto it with the existing 30-test suite passing byte-for-byte unmodified, after first documenting the t10y2y/t10y3m yield-curve inversion bands in the evidence table.**

## Performance

- **Duration:** 25 min
- **Tasks:** 3/3 completed
- **Files modified:** 4 (1 doc, 1 barrel edit, 1 component refactor); 2 files created (component + test)

## Accomplishments
- `docs/architecture/regime-board.md` now carries `t10y2y`/`t10y3m` evidence rows (bands `> 0.0` calm / `≤ 0.0` warning / `≤ -0.50` crisis `[ASSUMED]`), cited to `knowledge-base/grouped-data/macro_rates.md`, plus a client-visual-only/gate-blind disclosure — written before any component encodes these bands (docs-before-code).
- `apps/web/src/components/system/BulletGauge.tsx` is a new presentational component: a `role="meter"` track with `banded` (warn + crisis segments + marker) and `neutral` (marker only) variants, clamped axis math (`axisPct`/`clampedAxisPct` moved here from `RegimeBoard`), a separate `testId`/`markerTestId` contract, and no `any`/`as`/`!`. Exported from the `system` barrel alongside `Button`/`ChipRail`.
- `RegimeBoard.tsx`'s `Row` now renders `<BulletGauge variant="banded" .../>` instead of the inline meter markup; `RegimeBoard.test.tsx` was left completely unmodified and all 30 tests still pass — the constructive proof of zero visual change.

## Task Commits

1. **Task 1: Docs-before-code — yield-curve inversion bands** - `21dbaee` (docs)
2. **Task 2: Extract system/BulletGauge.tsx** - `6b1c03f` (feat) — RED confirmed first (missing-module import error), then implementation to green (4/4 tests)
3. **Task 3: Refactor RegimeBoard Row onto BulletGauge** - `2699bcb` (refactor) — RegimeBoard.test.tsx confirmed unmodified via `git diff --quiet`, 30/30 green

## Files Created/Modified
- `docs/architecture/regime-board.md` - t10y2y/t10y3m evidence rows + client-visual-only/gate-blind note
- `apps/web/src/components/system/BulletGauge.tsx` - shared bullet-gauge track (banded/neutral)
- `apps/web/src/components/system/BulletGauge.test.tsx` - unit + fast-check contract (4 tests)
- `apps/web/src/components/system/index.tsx` - barrel export of `BulletGauge` + its props types
- `apps/web/src/components/RegimeBoard.tsx` - `Row` calls `BulletGauge`; local `axisPct`/`clampedAxisPct` removed

## Decisions Made
- Kept `bandWarn?`/`bandCrisis?` as flat optional props (per the UI-SPEC's literal contract) narrowed by an explicit runtime branch (`throw` if `variant === "banded"` and either is `undefined`) rather than a discriminated union — matches "narrow via an explicit branch, never `!`" from the plan.
- Rendered the two band segments inside a `<>...</>` fragment rather than a wrapping `<div>` so `:scope > div` child-count assertions (3 for banded: warn/crisis/marker; 1 for neutral: marker only) hold without an extra DOM layer that would break the regression-guard suite.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes were needed; the extraction reused the source markup/classNames verbatim per the CHECKER WARNING 1 note (the load-bearing `relative` prefix on the track className was copied byte-for-byte).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`BulletGauge` is exported from the system barrel and ready for its two remaining callers: 39-02 (rates block — 6 neutral rows against the new `RATE_BANDS`/axis constants) and 39-03 (COT block — 5 neutral, direction-tinted rows). The `t10y2y`/`t10y3m` evidence rows are in place so 39-02 can cite them directly when it encodes the banded rate rows. `apps/web` tsc baseline remains at the same 8 pre-existing errors (none introduced by this plan); lint clean on all touched files.

---
*Phase: 39-market-regime-rail-all-rows-as-gauges-teaching-tooltips-rate*
*Completed: 2026-07-13*

## Self-Check: PASSED
All created files and commit hashes (21dbaee, 6b1c03f, 2699bcb) verified present.
