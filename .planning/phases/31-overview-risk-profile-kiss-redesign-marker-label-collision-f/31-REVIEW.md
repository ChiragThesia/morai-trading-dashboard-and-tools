---
phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/server/src/adapters/http/analytics.routes.test.ts
  - apps/web/src/components/RegimeBoard.test.tsx
  - apps/web/src/components/RegimeBoard.tsx
  - apps/web/src/components/charts/PayoffChart.test.tsx
  - apps/web/src/components/charts/PayoffChart.tsx
  - apps/web/src/screens/MarketRail.test.tsx
  - apps/web/src/screens/Overview.tsx
  - packages/contracts/src/regime.test.ts
  - packages/contracts/src/regime.ts
  - packages/core/src/analytics/application/getRegimeBoard.test.ts
  - packages/core/src/analytics/application/getRegimeBoard.ts
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-07-10
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the D-1 marker-collision fix (`PayoffChart.tsx` edge arrows) and the D-2
bandWarn/bandCrisis threading (`regime.ts` contract → `getRegimeBoard.ts` → `RegimeBoard.tsx`
gauge). The wall-label deletion / fixed-lane edge-arrow work (D-1, `PayoffChart.tsx`) is clean:
`pinMarker` correctly clamps to the domain edge, the three `EDGE_ARROW_LANE_Y` lanes are
provably distinct, and the Phase-30 `domain` prop plumbing (xScale/xTicks/crosshair invert) is
untouched and still correct. The four `getRegimeBoard.ts` push sites all populate
`bandWarn`/`bandCrisis` from `resolveRegimeRuleConfig`'s effective values, and the
override-proof test (T-31-04) asserts real, non-default numbers — not vacuous.

The D-2 `RegimeGauge` bullet-gauge in `RegimeBoard.tsx`, however, has a real rendering bug:
the warn/crisis band-segment positions are computed from `indicator.bandWarn`/`bandCrisis`
via an **unclamped** `axisPct`, while only the value **marker** is clamped
(`clampedAxisPct`). `bandWarn`/`bandCrisis` are explicitly designed (per this file's own
comments and 31-UI-SPEC.md §2) to reflect Phase-29 runtime overrides — and the override
write-path (`packages/contracts/src/rule-settings.ts`'s `regimeOverrides` schema) enforces
only `warn < crisis`, with no bound tying an override to the gauge's fixed `GAUGE_SCALE`
axis. When an operator sets an override outside that axis (or, for `vvix`, when a real
market print exceeds the fixed 70–150 scale — VVIX has historically traded above 150), the
crisis-band segment's CSS `width` goes negative, which is invalid CSS and drops the crisis
highlight instead of rendering it — silently hiding the exact "how close to crisis" signal
this gauge exists to show. See CR-01 below; WR-01/WR-02 are directly related.

## Critical Issues

### CR-01: RegimeGauge band-segment positions are unclamped — negative CSS width when bandWarn/bandCrisis fall outside GAUGE_SCALE

**File:** `apps/web/src/components/RegimeBoard.tsx:70-100,159-166`
**Issue:**

`axisPct` (line 70-74) is explicitly documented as "NOT clamped (band-segment positions are
trusted to sit inside the configured axis)":

```ts
function axisPct(value: number, min: number, max: number): number {
  return ((value - min) / (max - min)) * 100;
}
```

`Row` uses it, unclamped, for `warnPct`/`crisisPct` (only `valuePct` goes through the
clamped `clampedAxisPct`):

```ts
const warnPct = axisPct(indicator.bandWarn, scale.min, scale.max);
const crisisPct = axisPct(indicator.bandCrisis, scale.min, scale.max);
const valuePct = clampedAxisPct(indicator.value, scale.min, scale.max);
```

...and the crisis segment's width is `100 - crisisPct`:

```tsx
<div
  className="absolute inset-y-0 bg-down/30"
  style={{ left: `${crisisPct}%`, width: `${100 - crisisPct}%` }}
/>
```

`GAUGE_SCALE` is a hard-coded, per-indicator **visual** axis (e.g. `vvix: { min: 70, max:
150 }`) that is independent of the indicator's *effective* `bandWarn`/`bandCrisis`, which
this same file's own comment says come from "Phase-29 effective config" (runtime overrides,
`getRegimeBoard.ts` → `resolveRegimeRuleConfig`). The override write-path
(`packages/contracts/src/rule-settings.ts:161-190`, `regimeOverrides` schema) validates only
`warn < crisis` (`validWarnCrisisPair`) — there is no bound checking an override against the
UI's fixed axis. So a perfectly legal override (e.g. `vvixWarn: 140, vvixCrisis: 200`, still
satisfying `warn < crisis`) reaches `RegimeBoard.tsx` as `bandCrisis: 200` against a
`GAUGE_SCALE` of `{ min: 70, max: 150 }`:

```
crisisPct = ((200 - 70) / (150 - 70)) * 100 = 162.5
width     = 100 - 162.5 = -62.5%   // invalid CSS width → dropped/zeroed
```

The crisis-band `<div>` ends up with an invalid negative `width`, which browsers reject
(the declaration is dropped, and for an absolutely-positioned box with only `left` set the
box collapses to its (empty) content width — effectively invisible). The result: the exact
regime this gauge exists to flag — "value approaching/at the crisis band" — silently loses
its visual highlight instead of rendering.

This is also reachable **without** any override: `vvix`'s `GAUGE_SCALE` caps at 150, but
VVIX has historically printed above 150 (e.g. Feb 2018, ~200+). No override is needed for a
genuine market print to exceed the fixed axis feeding `bandCrisis`'s *default* 115 — that
part stays safely inside 70–150 today, so the negative-width path needs an override to
trigger currently, but the design explicitly ships overrides as a supported, load-bearing
feature of this exact code path (comment: "Phase-29 overrides-aware").

Confirmed by the codebase's own test: `RegimeBoard.test.tsx`'s fast-check clamp test
(`"clamps the marker position at both axis ends"`, lines 205-235) generates `bandWarn`/
`bandCrisis` values up to ±1000 against the fixed `vix-term-structure` axis (0.6–1.2) — i.e.
it exercises exactly this out-of-range scenario — but only asserts on the **marker**'s
`left`, never on the warn/crisis segment `left`/`width`. The property test was aimed at this
exact code path and would have caught this if it asserted on the segments.

**Fix:** Clamp `warnPct`/`crisisPct` the same way `valuePct` is clamped, so a segment can
never overflow past its container even when the effective threshold is outside the visual
axis:

```ts
const warnPct = clampedAxisPct(indicator.bandWarn, scale.min, scale.max);
const crisisPct = clampedAxisPct(indicator.bandCrisis, scale.min, scale.max);
```

(Optionally also clamp the resulting `width` values to `Math.max(0, ...)` for defense in
depth, since `crisisPct - warnPct` could still be very small/zero at the clamped edges —
but clamping the two percentages alone already fixes the negative-width case.)

## Warnings

### WR-01: aria-valuenow can fall outside aria-valuemin/aria-valuemax on the regime gauge's role="meter"

**File:** `apps/web/src/components/RegimeBoard.tsx:149-157`
**Issue:** The gauge's ARIA meter attributes use the fixed `GAUGE_SCALE` for
`aria-valuemin`/`aria-valuemax`, but `aria-valuenow` is the raw, unclamped
`indicator.value`:

```tsx
<div
  role="meter"
  aria-valuenow={indicator.value}
  aria-valuemin={scale.min}
  aria-valuemax={scale.max}
  ...
>
```

Per the ARIA `meter` role contract, `aria-valuenow` must stay within
`[aria-valuemin, aria-valuemax]`. Since `scale` (`GAUGE_SCALE`) is a fixed axis independent
of the indicator's real range (e.g. `vvix: 70–150`, while VVIX has genuinely printed above
150 historically), a real market spike renders `aria-valuenow` above `aria-valuemax` —
assistive tech is not guaranteed to handle this gracefully (some screen readers report the
raw out-of-range number, others clamp/misreport). The visible number and the clamped marker
are both already correct for this case (D-2's stated intent); only the ARIA attributes are
inconsistent with the meter contract.

**Fix:** Either clamp `aria-valuenow` to `[scale.min, scale.max]` to match the marker (and
keep the real value in `aria-valuetext`, which already carries the unclamped
`${value.toFixed(2)} — ${band}` string for a correct spoken value), or widen
`aria-valuemin`/`aria-valuemax` to also account for the live value:
`Math.min(scale.min, indicator.value)` / `Math.max(scale.max, indicator.value)`.

### WR-02: fast-check clamp test exercises the CR-01 code path but never asserts on it

**File:** `apps/web/src/components/RegimeBoard.test.tsx:205-235`
**Issue:** The property test `"clamps the marker position at both axis ends (fast-check:
value/min/max never overflow [0,100]%)"` feeds arbitrary `bandWarn`/`bandCrisis` values
(range ±1000, only constrained by `max <= min` degenerate-skip) into an indicator whose
`GAUGE_SCALE` axis is `0.6–1.2` — i.e. it specifically generates out-of-axis thresholds, the
exact precondition for CR-01 — but only reads `regime-gauge-marker-{id}`'s `left`. It never
reads the warn/crisis segment `<div>`s (`gauge.querySelectorAll(":scope > div")[0]`/`[1]`,
same pattern already used by the `"positions band segments..."` test above it) to assert
their `left`/`width` also stay within a valid range.

**Fix:** Extend this test (or add a sibling one) to assert the warn/crisis segment styles
never produce a negative `width` or an out-of-[0,100] `left`, mirroring the existing
`"positions band segments from response bandWarn/bandCrisis"` test's `segments[0]`/`[1]`
access pattern. This is the regression guard CR-01's fix needs.

---

_Reviewed: 2026-07-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
