---
phase: 22-journal-calendar-lifecycle-graph
plan: 05
subsystem: ui
tags: [react, visx, svg, charting, jrnl-01]

# Dependency graph
requires:
  - phase: 22-01
    provides: "LifecycleResponse / LifecycleSnapshotResponse Zod contract (isGap, forwardVol/forwardVolGuard, signed greeks, cumulative attribution buckets, optional trigger)"
provides:
  - "LifecycleChart rewritten from the retired 3-tab + scrubber engine to the D-08 stacked-panel SVG (attribution hero, vol & term structure, 4 signed greek small-multiples, price vs strike)"
  - "onCrosshairChange(index|null) callback for rail sync (consumed by 22-06)"
  - "Module-level color-constant block locked 1:1 to the UI-SPEC Chart Series Color Map"
affects: [22-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gap-aware LinePath: defined={(d) => !d.isGap} (visx handles the multi-subpath break natively via d3-shape)"
    - "Hand-built gap-aware band path (buildGapAwareBandPath) for stacked/signed area fills — visx has no two-boundary gap-aware area primitive, ported from journal-lifecycle-v3.html's areaSeg/flush"
    - "Diverging (bipolar) per-point stack (stackDiverging) generalizing d3's stackOffsetDiverging to arbitrary per-point sign flips"
    - "Crosshair mapping reused verbatim from PayoffChart.tsx: localPoint -> svgRect -> scaleX -> logicalX"

key-files:
  created:
    - apps/web/src/components/LifecycleChart.test.tsx
  modified:
    - apps/web/src/components/LifecycleChart.tsx

key-decisions:
  - "Hero attribution stack uses a per-point diverging (bipolar) stack over [theta, vega, deltaGamma, residual] in that fixed order, rather than the mockup's dataset-specific stacking script — this generalizes correctly to arbitrary sign flips per snapshot instead of assuming vega/delta-gamma are always negative"
  - "Residual is stacked as a fourth series (not a separate near-net sliver like the mockup) so its band and legend entry are structurally always rendered, never conditionally guarded (D-05)"
  - "All gap decisions (every panel) key off the single isGap boolean from the contract, except the forward-vol line which additionally breaks on forwardVolGuard === 'inverted' even when isGap is false (D-02's own honesty requirement, distinct from D-05's general feed-gap requirement)"
  - "Lines and areas use curveLinear (no curve smoothing) to avoid implying interpolated values between real snapshots"

requirements-completed: [JRNL-01]

coverage:
  - id: D1
    description: "LifecycleChart renders five stacked regions (attribution hero, vol & term structure, 4 signed greek small-multiples, price vs strike) on one shared time axis, viewBox 0 0 840 700 with preserveAspectRatio xMinYMin meet"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — D-08 stacked-panel engine (Task 1) > renders all five stacked regions sharing one time axis"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — D-08 stacked-panel engine (Task 1) > uses viewBox 0 0 840 700 with preserveAspectRatio xMinYMin meet"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hero panel always renders all 4 legend entries (theta/vega/delta-gamma/residual) and the residual band, never guarded on magnitude"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — D-08 stacked-panel engine (Task 1) > always renders all 4 hero legend entries"
        status: pass
    human_judgment: false
  - id: D3
    description: "Vol panel renders forward vol / front IV / back IV as three distinct LinePaths (never blended); forward vol additionally breaks on an inverted-guard point independent of the general feed gap"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — D-08 stacked-panel engine (Task 1) > renders forward vol / front IV / back IV as three distinct LinePaths"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — D-08 stacked-panel engine (Task 1) > breaks the forward-vol line independently at an inverted-guard point"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every panel (hero, vol, 4 greeks, price) breaks its line/fill at a true feed gap — never interpolates across it"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — D-08 stacked-panel engine (Task 1) > breaks every panel's line at the true feed gap"
        status: pass
    human_judgment: false
  - id: D5
    description: "Shared crosshair (PayoffChart's localPoint mapping) + fixed HTML tooltip with the locked row order; gap-index hover shows only 'feed lapsed — no data'; onCrosshairChange fires on move/leave"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — shared crosshair + tooltip (Task 2) > reports the hovered index via onCrosshairChange on move and null on leave"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — shared crosshair + tooltip (Task 2) > shows the locked tooltip row order on a non-gap hover"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/LifecycleChart.test.tsx#LifecycleChart — shared crosshair + tooltip (Task 2) > shows ONLY 'feed lapsed — no data' on a gap-index hover"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual fidelity of the rendered stacked chart against the D-08 mockup (colors, proportions, honest gaps in a real sparse calendar) — needs eyeballing"
    human_judgment: true
    rationale: "Component-level unit tests confirm structure, colors, and gap-break semantics, but final visual composition (rendered inside Journal.tsx's chart card, real production data) is a phase-gate chrome-devtools UAT item per the plan's own <verify> block — not this plan's scope to self-certify."
    verification: []

# Metrics
duration: 45min
completed: 2026-07-05
status: complete
---

# Phase 22 Plan 05: LifecycleChart D-08 Stacked-Panel Engine Summary

**Rewrote LifecycleChart.tsx from the retired 3-tab + scrubber engine into a five-region D-08 stacked SVG (P&L attribution hero, vol & term structure, 4 signed greek small-multiples, price vs strike) with honest per-panel gap breaks and a shared crosshair + tooltip.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-07-05T13:53:00Z
- **Completed:** 2026-07-05T14:07:00Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 rewritten, 1 new test file)

## Accomplishments

- Stacked-panel engine: title/legend band, P&L attribution hero (diverging-stack of
  cumTheta/cumVega/cumDeltaGamma/cumResidual + net line), vol & term structure (front
  IV / back IV / forward vol as the distinct amber "edge" line, D-02), four signed
  greek small-multiples with zero baselines (D-03), price vs an optional strike
  reference — all sharing one index-based x-scale (D-04).
- Honest gap handling (D-05): every LinePath uses `defined={(d) => !d.isGap}`
  (visx/d3-shape natively breaks the path into multiple subpaths); stacked/signed area
  fills use a hand-built `buildGapAwareBandPath` that flushes (closes) each contiguous
  run rather than bridging a gap, ported from the mockup's `areaSeg`/`flush` idiom.
  Forward vol additionally treats an inverted term-structure guard as its own break,
  independent of the general feed-gap flag.
- Shared crosshair + fixed HTML tooltip reusing PayoffChart's exact
  `localPoint -> svgRect -> scaleX -> logicalX` mapping; the tooltip renders the
  locked row order (day/DTE -> net P&L -> theta -> vega -> delta-gamma -> forward
  vol -> spot) or, on a gap index, only `"feed lapsed — no data"`.
  `onCrosshairChange(index | null)` fires on move/leave for Plan 22-06's rail sync.
- Module-level color-constant block (`COLOR_UP`, `COLOR_BLUE`, `COLOR_VIOLET`,
  `COLOR_FAINT`, `COLOR_DIM`, `COLOR_TXT`, `COLOR_AMBER`, `COLOR_MUTED`, `COLOR_DOWN`,
  `COLOR_LINE2`) mapped 1:1 to the UI-SPEC Chart Series Color Map — verified via
  `grep -oE "#[0-9a-fA-F]{6}"` that only these 10 hex values appear in the file.

## Task Commits

1. **Task 1 + Task 2 (combined — see Deviations)** implemented and tested together in
   a single file rewrite:
   - `1e00d7b` — `test(22-05): add failing test for LifecycleChart D-08 stacked-panel engine` (RED)
   - `59584b7` — `feat(22-05): rewrite LifecycleChart as D-08 stacked-panel engine (JRNL-01)` (GREEN)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/components/LifecycleChart.tsx` — rewritten: stacked-panel engine, new
  prop shape `{ snapshots: LifecycleResponse["snapshots"]; strike?: number;
  onCrosshairChange?: (index: number | null) => void }`, viewBox `0 0 840 700`.
- `apps/web/src/components/LifecycleChart.test.tsx` — new: 14 tests across two
  `describe` blocks (`Task 1` structural/color/gap-break assertions, `Task 2`
  crosshair/tooltip assertions).

## Decisions Made

- Hero attribution stack: a per-point diverging (bipolar) stack over
  `[theta, vega, deltaGamma, residual]` in that fixed series order — generalizes
  correctly to a snapshot where any bucket flips sign, rather than replicating the
  mockup's dataset-specific stacking script (which assumed vega/delta-gamma are
  always negative).
- Residual is stacked as a fourth series in that same diverging stack (not a
  separate near-net-line sliver like the mockup) so its band and legend entry are
  structurally unconditional — there is no `if (residual)` branch to accidentally
  hide it (D-05).
- Every panel's gap decision keys off the single `isGap` boolean from the contract,
  except the forward-vol line, which additionally breaks on
  `forwardVolGuard === "inverted"` even when `isGap` is false — this is D-02's own
  honesty requirement (never plot a fabricated/blended forward-vol value) and is
  distinct from D-05's general feed-gap requirement.
- All series render with `curveLinear` (no curve smoothing) so the drawn path never
  implies interpolated values between real snapshots — consistent with the mockup's
  own straight-segment `bpath` builder.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, test infrastructure only] jsdom in this environment has no
`PointerEvent` constructor**
- **Found during:** Task 2 (writing the crosshair/tooltip test cases)
- **Issue:** `window.PointerEvent` is `undefined` under this project's jsdom test
  environment. `fireEvent.pointerMove(...)`'s event-map lookup falls back to a bare
  `Event` with no `clientX`/`clientY`, so `@visx/event`'s `localPoint` computed `NaN`
  and `onCrosshairChange` was called with `NaN` instead of the expected index.
  Separately, jsdom's `SVGElement` has no `clientLeft`/`clientTop` (they're `0` on any
  real element after layout), and `localPoint`'s bounding-box fallback path subtracts
  them, so an `undefined` there also produces `NaN`.
- **Fix:** Test helpers dispatch a `MouseEvent` constructed with `type: "pointermove"`
  / `"pointerout"` (via raw `fireEvent(element, event)`, not the `pointerMove` sugar
  helper) instead of relying on a native `PointerEvent`. React's synthetic-event
  system dispatches by the native event's `.type` string, not by its constructor
  class, so this reaches the component's real `onPointerMove`/`onPointerLeave`
  handlers unchanged. (`pointerout`, not `pointerleave`, because React derives
  `onPointerLeave` from the bubbling `pointerout` event plus a `relatedTarget` check —
  mirroring how `onMouseLeave` is derived from `mouseout`.) `clientLeft`/`clientTop`
  are stubbed to `0` via `Object.defineProperty` alongside the existing
  `getBoundingClientRect` mock.
- **Files modified:** `apps/web/src/components/LifecycleChart.test.tsx` (test-only —
  no production code changed).
- **Verification:** All 14 tests pass; `PayoffChart.test.tsx` (the codebase's other
  visx crosshair consumer) has no pointer-event tests at all, consistent with this
  being a known environment gap rather than a component bug.
- **Committed in:** `59584b7`.

**2. [Rule 3 - Blocking] Two `Partial<Record<...>> ... as Record<...>` casts and a
mismatched-variance array cast**
- **Found during:** Task 1 lint pass (`@typescript-eslint/consistent-type-assertions`)
  and typecheck pass (TS4104 readonly/mutable array variance).
- **Issue:** Initial draft built `greekScaleY`/`greekBandPaths` via `forEach` into a
  `Partial<Record<...>>` accumulator, requiring an `as Record<...>` cast at the end
  (forbidden by `typescript.md`'s "no `as`" rule). Separately, `greekLineData`'s
  reduce-accumulator type used `ReadonlyArray<...>`, which TS rejects when the
  mutable `LinePath` `data` prop is assigned from it (arrays are invariant for
  readonly-vs-mutable in this direction).
- **Fix:** Rewrote both `greekScaleY` and `greekBandPaths` as object literals built
  from a local `scaleFor`/`pathFor` helper called once per `GreekKey` — no partial
  accumulator, no cast, and the result is exactly `Record<GreekKey, ...>` by
  construction. Changed the reduce-accumulator type to `Array<...>` (mutable).
- **Files modified:** `apps/web/src/components/LifecycleChart.tsx`.
- **Verification:** `bun run lint` and `bun run typecheck` clean for both files.
- **Committed in:** `59584b7`.

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking, no scope creep).
**Impact on plan:** No behavior change; both fixes are internal (test infra, type
hygiene) and don't touch the component's runtime contract or rendered output.

## Task Commit Note

Both plan tasks (Task 1: stacked-panel engine; Task 2: crosshair + tooltip) were
implemented in a single coherent rewrite of `LifecycleChart.tsx` and committed as one
`feat` commit, preceded by one `test` (RED) commit covering both tasks' assertions
(the test file's two `describe` blocks map 1:1 to the two plan tasks). Splitting the
implementation into two separate intermediate commits would have required manually
reconstructing and re-verifying a temporary crosshair-less intermediate state purely
for commit granularity, with no additional evidence value — both tasks live in the
same file, the same component, and were verified together (14/14 tests green,
typecheck clean, lint clean) before the single commit landed.

## Known, Deliberate Cross-Plan Gap

`apps/web/src/screens/Journal.tsx:417` still calls `<LifecycleChart snapshots={snapshots} />`
with the plain `useJournal()` `SnapshotResponse[]` (unenriched — no `isGap`/`forwardVol`/
cumulative attribution fields). This now fails `apps/web` typecheck with a TS4104
readonly/shape mismatch against the new `LifecycleResponse["snapshots"]` prop type.

This is **expected and by design**, not a regression to fix here: `22-06-PLAN.md`
(`depends_on: ["22-03", "22-04", "22-05"]`, wave 3) explicitly owns
`apps/web/src/screens/Journal.tsx` and its Task 1 swaps `useJournal` → `useLifecycle`
at that exact call site. This plan's `files_modified` frontmatter scopes only
`LifecycleChart.tsx` — touching `Journal.tsx` here would duplicate 22-06's own task and
risk merge conflicts with its rewrite. Confirmed via `git stash` diff that this is the
*only* typecheck error newly introduced by this plan's change (all other `apps/web`
typecheck errors — `ErrorBoundary.tsx`, `Button.tsx`, `useMacro.test.ts`,
`JournalContainer.test.tsx` — are pre-existing and unrelated, verified against the
pre-change baseline).

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`LifecycleChart` is ready for Plan 22-06 to wire into `Journal.tsx`: swap
`useJournal` → `useLifecycle`, pass the enriched `snapshots` + calendar `strike`,
lift a `hoveredIndex` state fed by `onCrosshairChange`, and feed that into
`PnlBridgeCard` (22-04) for the crosshair-reactive rail bridge described in the
UI-SPEC's Attribution Idiom Decision. No blockers.

---
*Phase: 22-journal-calendar-lifecycle-graph*
*Completed: 2026-07-05*

## Self-Check: PASSED
- FOUND: apps/web/src/components/LifecycleChart.tsx
- FOUND: apps/web/src/components/LifecycleChart.test.tsx
- FOUND: commit 1e00d7b (test)
- FOUND: commit 59584b7 (feat)
