---
phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f
fixed_at: 2026-07-10T13:52:00Z
review_path: .planning/phases/31-overview-risk-profile-kiss-redesign-marker-label-collision-f/31-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 31: Code Review Fix Report

**Fixed at:** 2026-07-10T13:52:00Z
**Source review:** .planning/phases/31-overview-risk-profile-kiss-redesign-marker-label-collision-f/31-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: RegimeGauge band-segment positions are unclamped — negative CSS width when bandWarn/bandCrisis fall outside GAUGE_SCALE

**Files modified:** `apps/web/src/components/RegimeBoard.tsx`, `apps/web/src/components/RegimeBoard.test.tsx`
**Commit:** `f8932b0`
**Applied fix:** Followed the project's TDD rule — extended the existing fast-check clamp
test (`RegimeBoard.test.tsx:205-235`) FIRST to also read the warn/crisis segment `<div>`s
and assert `left`/`width` stay within `[0,100]` and never negative. Confirmed RED
(`AssertionError: expected -100 to be greater than or equal to 0`, reproducing the exact
negative-width bug from the review). Then changed `Row`'s `warnPct`/`crisisPct` from the
unclamped `axisPct` to the same `clampedAxisPct` already used for the value marker, so an
out-of-axis `bandWarn`/`bandCrisis` (Phase-29 override, or a real print past the fixed
`GAUGE_SCALE`) saturates the segment at the axis edge instead of producing invalid negative
CSS width. Also updated the now-stale `axisPct` doc comment that claimed band segments were
"trusted to sit inside the configured axis" (no longer true — call sites needing on-track
positioning now go through `clampedAxisPct`). Confirmed GREEN after the fix (26/26 tests).
This commit bundles CR-01's fix with WR-02's test extension since the extended property test
*is* the regression guard the review asked for.

### WR-01: aria-valuenow can fall outside aria-valuemin/aria-valuemax on the regime gauge's role="meter"

**Files modified:** `apps/web/src/components/RegimeBoard.tsx`
**Commit:** `2d91435`
**Applied fix:** Added a `clampedValue = Math.min(scale.max, Math.max(scale.min, indicator.value))`
in `Row` and used it for `aria-valuenow`, keeping `aria-valuemin`/`aria-valuemax` as the fixed
`GAUGE_SCALE` bounds and leaving `aria-valuetext` carrying the true unclamped
`${value.toFixed(2)} — ${band}` string (per the review's fix guidance — AT users still get
the real number via `aria-valuetext`). Existing fixture values are all within-range so
`clampedValue === indicator.value` for the pre-existing `aria-valuenow` assertion test —
confirmed unchanged (26/26 tests still green).

### WR-02: fast-check clamp test exercises the CR-01 code path but never asserts on it

**Files modified:** `apps/web/src/components/RegimeBoard.test.tsx`
**Commit:** `f8932b0` (same commit as CR-01 — the test extension IS the CR-01 fix's
regression guard)
**Applied fix:** Extended `"clamps the marker position at both axis ends"` to also read
`gauge.querySelectorAll(":scope > div")[0]`/`[1]` (warn/crisis segments, mirroring the
existing `"positions band segments..."` test's access pattern) and assert `left ∈ [0,100]`
and `width ≥ 0` for both segments, for any arbitrary `bandWarn < bandCrisis` pair fed in
(fast-check, 50 runs). This reproduced CR-01 on the unfixed source (RED) and passes after
the fix (GREEN).

## Verification

- `bun run typecheck` — clean (tsc --build --force, no output).
- `bun run lint` — clean (only pre-existing eslint-plugin-boundaries legacy-selector
  warnings, no errors).
- `bun run test` — `apps/web/src/components/RegimeBoard.test.tsx`: 26/26 passed. Full
  workspace run: 1 pre-existing failing file (`apps/web/src/hooks/useLiveStream.test.ts`,
  17 tests, `TypeError: Cannot read properties of undefined (reading 'replace')` in
  `useLiveStream.ts:199`) — confirmed unrelated to this phase: neither file was touched by
  these commits, and `git log` shows the file's last changes are from Phase 12/20 commits.
  Not fixed here (out of scope for phase 31's REVIEW.md findings).

---

_Fixed: 2026-07-10T13:52:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
