# Phase 33: Chart Engine Migration (Recharts via shadcn primitives) - Research

**Researched:** 2026-07-10
**Domain:** React chart library migration (visx + echarts-for-react → Recharts)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Recharts, wired through shadcn chart primitives** (`ChartContainer` /
  `ChartTooltipContent` / CSS-variable theming). Project is already shadcn base-nova
  (`apps/web/components.json`), so the shadcn `chart` component is the idiomatic add —
  one new npm dep (recharts), zero bespoke chart chrome.
- Presentation swap ONLY. Data layer stays byte-identical: `scenario-engine.ts`,
  `payoff-domain.ts`, `packages/contracts/*` — UNTOUCHED. No server/worker/core
  changes. Web-only phase.
- In scope (4 charts): `PayoffChart.tsx` (priority), `TermStructureChart.tsx`,
  `GammaProfile.tsx`, `GexBars.tsx`.
- Out of scope: `LifecycleChart.tsx` (Phase 22, shipped + live-UAT'd — do not
  destabilize; candidate for a later phase). `EquityCurve.tsx`, `MiniLine.tsx`,
  `GexByExpiry.tsx` — migrate only if free, never at cost to the 4 in-scope charts.
  No data-layer/contract changes. No new visual features — parity with MORAI palette
  (violet/gray, Phase 17.1 decision), not a redesign.
- No overflow, structurally: plot elements clip to the plot area by construction
  (library clipping / ResponsiveContainer), not hand-`Math.min/max` clamps. EM band at
  extreme domains must not bleed (keep 2563bd6's test intent, re-expressed against the
  new renderer).
- Domain fidelity: PayoffChart keeps consuming `computePayoffDomain` output as its
  x-domain (Phase 30 behavior). Tent always fits.
- Existing test suite green; chart tests re-written against the new DOM where
  assertions were SVG-coordinate-specific, preserving each test's intent (overflow
  regressions, zero-crossing/BE markers, EM clamp).
- Visual parity gate: same data → same story. Design tokens via shadcn chart CSS
  variables mapped to the existing MORAI palette.
- Bundle: recharts is the single new dependency (v1.2 "zero new deps" guard was
  milestone-scoped; user directive overrides here).
- Hexagonal boundaries unchanged. TDD red→green per chart swap; commit at green.
  Phase 31 KISS: no marker-text in plot; edge-arrow lanes stay (re-expressed as
  Recharts reference-line labels or a custom layer). Phase 30: `domain` remains a
  required prop of PayoffChart.

### Claude's Discretion

- Custom-layer strategy for: IV fan, BE pills, scenario strip, edge-arrow lanes —
  Recharts `Customized`/custom shapes vs. a thin overlay div. Prefer library idiom;
  keep overlay ONLY if the library fights us.
- Crosshair tooltip fidelity: Recharts `Tooltip` vs. Phase-22-style custom crosshair —
  whichever preserves current UX with least code.
- Test strategy: what to assert against Recharts' DOM, given jsdom/`ResponsiveContainer`
  width-0-in-test pitfalls.

### Deferred Ideas (OUT OF SCOPE)

- `LifecycleChart.tsx` migration (candidate for a later phase).
- `EquityCurve.tsx`, `MiniLine.tsx`, `GexByExpiry.tsx` migration (only if free).
- Any data-layer, contract, or visual-design change.
</user_constraints>

## Summary

Recharts 3.9.2 is current on npm (published 2026-07-04, verified via registry), lists
React 16–19 in its peer range, and is the exact version the official shadcn/ui `chart`
docs target — this is a clean, well-timed adopt. The shadcn CLI (`bunx shadcn@latest
add chart`) scaffolds one file, `apps/web/src/components/ui/chart.tsx`
(`ChartContainer`/`ChartConfig`/`ChartTooltip`/`ChartTooltipContent`/`ChartLegend`),
that wraps `ResponsiveContainer` and reads colors through `var(--color-KEY)` — this
project's `index.css` already has the exact CSS-variable bridge pattern (`@theme
inline` mapping shadcn tokens to `--color-*`) that this convention expects, so the
MORAI palette (violet/teal/coral/amber/blue) plugs straight into `ChartConfig` colors
with zero new token infrastructure.

Every hand-rolled visual element in the 4 in-scope charts maps to a first-class or
well-documented Recharts idiom: continuous (non-category) x-axes via `XAxis
type="number"`, dual-color fills via the linearGradient-offset-split technique (the
exact same trick the current visx code already uses — direct port, not new invention),
partial-width reference segments via `ReferenceLine`'s `segment` prop (perfect fit for
the term-structure forward-IV bracket), per-bar coloring via `Cell`, and the few
genuinely custom shapes (KISS edge-arrow glyphs, EM-band ticks, short BE marker bars)
via a small `Customized` layer function. The two headline user-directed wins —
structural clipping and native tooltips — are real: `allowDataOverflow={true}` +
Recharts' auto-generated `clipPath` on Area/Line/Bar retires every hand-clamp in
`PayoffChart.tsx`, and Recharts' `Tooltip` retires ~50 lines of manual
`localPoint`/`getBoundingClientRect`/scale-invert math currently doing the same job.

The one real risk is test infrastructure, not the library: `ResponsiveContainer`
renders 0×0 under jsdom (a long-standing, still-open Recharts issue), so all 4 chart
test files need either a mocked `ResponsiveContainer` or fixed pixel dimensions in
tests — this repo already has the exact precedent (`GexBars.test.tsx` currently mocks
`echarts-for-react` the same way). `@visx/*` and `echarts`/`echarts-for-react` CANNOT
be removed from `package.json` after this phase: `LifecycleChart.tsx`, `EquityCurve.tsx`,
and `MiniLine.tsx` still import `@visx/*`, and `GexByExpiry.tsx` still imports
`echarts-for-react` — all four are explicitly out of scope.

**Primary recommendation:** Pin `recharts@^3.9`, scaffold `ui/chart.tsx` via the shadcn
CLI, map MORAI palette hex values directly into each chart's local `ChartConfig`
(don't touch the global `--chart-N` oklch tokens shadcn's default theme ships), migrate
`PayoffChart.tsx` first (highest element count, proves every technique the other three
reuse), and add one shared `mockResponsiveContainer()` test helper before touching any
chart's test file.

## Decisions

- **D-01:** Pin `recharts@^3.9.2` as the single new dependency [VERIFIED: npm
  registry]. Do not install a `2.x` or pre-release (`alpha`/`beta`/`canary`) tag —
  `latest` is the version shadcn/ui's official chart docs target.
- **D-02:** Scaffold theming/container plumbing via the shadcn CLI
  (`bunx shadcn@latest add chart`), not hand-written. Commit the generated
  `apps/web/src/components/ui/chart.tsx` unmodified; extend via `ChartConfig` +
  composition only, per the official "no wrapping abstraction" convention.
- **D-03:** Container/responsive strategy: every chart wraps in `ChartContainer`
  (→ `ResponsiveContainer` internally). No hand-rolled `viewBox`/width-tracking. For
  `GammaProfile`'s fixed-pixel full/compact variants, pass explicit numeric
  `width`/`height` through to `ChartContainer` rather than relying on 100%-responsive
  sizing, matching its current fixed-size usage.
- **D-04:** Every x-axis (`PayoffChart`, `TermStructureChart`, `GexBars`'s value axis)
  MUST be `type="number"` with an explicit `domain` and `allowDataOverflow={true}` —
  never the categorical default. This is the direct re-expression of Phase 30's
  domain-fidelity lock (Pitfalls 2 and 3).
- **D-05:** Split-color fills (PayoffChart T+0/profit-zone, GammaProfile gamma) use the
  linearGradient-offset-split technique (Pattern 2) — a like-for-like port of the
  gradient trick the current visx code already implements, not a new invention.
- **D-06:** The `TermStructureChart` forward-IV bracket uses `ReferenceLine`'s native
  `segment` prop (Pattern 3), replacing the hand-drawn partial-width SVG path string.
- **D-07:** GEX/flip/put-wall/call-wall/spot reference marks use `ReferenceLine`
  (full-width verticals) across all charts; per-bar GEX/OI sign coloring in `GexBars`
  uses `Cell` (Pattern reuse, direct port of the existing conditional-color logic).
- **D-08:** The only elements requiring a custom `Customized` layer (no native
  primitive covers them) are: PayoffChart's KISS edge-arrow glyphs, its short BE-marker
  bars, and its EM-band ticks+connector (Pattern 4). Everything else in CONTEXT.md's
  "custom-layer strategy" question resolves to a native Recharts prop — see Open
  Question 2.
- **D-09:** BE pills and the scenario strip stay unchanged plain-HTML overlays outside
  the `<svg>` — they already are today and were never chart-library concerns.
- **D-10:** Crosshair/hover uses Recharts' native `<Tooltip>` + `cursor` prop with a
  custom typed `content` component (Code Examples), replacing the current manual
  `localPoint`/`getBoundingClientRect`/scale-invert block (~50 line deletion).
- **D-11:** Set `isAnimationActive={false}` on every series/reference component across
  all 4 charts, for both test determinism and parity with the current zero-animation
  visx/ECharts behavior (Pitfall 5).
- **D-12:** Custom Tooltip/Customized/label render functions MUST use concrete generic
  type parameters (e.g. `TooltipContentProps<number, "pl">`), never
  `TooltipContentProps<any, any>` (Pitfall 6, project no-`any` rule).
- **D-13:** Do not remove `@visx/*`, `echarts`, or `echarts-for-react` from
  `apps/web/package.json` — all three remain load-bearing for out-of-scope charts
  (`LifecycleChart.tsx`, `EquityCurve.tsx`, `MiniLine.tsx` on visx; `GexByExpiry.tsx`
  on echarts) after this phase (Pitfall 7).
- **D-14:** `GexBars` uses `<BarChart layout="vertical">` (Recharts' naming for
  horizontal bars) with `XAxis type="number"` (value) / `YAxis type="category"`
  (strikes) to reproduce its current horizontal-bar layout (Pitfall 8).
- **D-15:** Test harness: add one shared `apps/web/src/components/test/recharts-test-utils.tsx`
  helper mocking `ResponsiveContainer` to a fixed pixel size, imported by all 4 chart
  test files — reuses this repo's existing per-file `vi.mock` precedent
  (`GexBars.test.tsx`'s current `echarts-for-react` mock) rather than introducing a new
  global `setupFiles` mechanism.
- **D-16:** Migration order: `PayoffChart.tsx` first (highest element count/complexity,
  proves every technique — split-gradient fill, `Customized` layers, native Tooltip,
  numeric domain+overflow — that the other three charts then reuse), followed by
  `GammaProfile.tsx` (subset of PayoffChart's techniques), then `TermStructureChart.tsx`
  and `GexBars.tsx` in either order (each independent, smaller element sets).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chart rendering (SVG, axes, tooltips, clipping) | Browser / Client (`apps/web/src/components/charts/*`, `components/picker/TermStructureChart.tsx`) | — | Pure presentation; Recharts renders client-side SVG, no server involvement |
| Domain/curve/scenario computation | Browser / Client (`apps/web/src/lib/scenario-engine.ts`, `payoff-domain.ts`) | — | Already client-side pure functions; UNTOUCHED this phase (CONTEXT.md lock) |
| Chart theming (CSS variables) | Browser / Client (`apps/web/src/index.css`, `components.json`) | — | Static design tokens, no build-time or server involvement |
| Contract types feeding chart props (`GexSnapshotEntry`, `PickerCandidate`, etc.) | API / Backend contract (`packages/contracts`) | Browser / Client (consumer) | Zod-defined shapes already exist; charts only consume, never redefine |
| Test harness (jsdom `ResponsiveContainer` sizing) | Browser / Client (test tooling, `apps/web/vitest.config.ts` + per-file mocks) | — | jsdom-only concern; no runtime/production impact |

## Project Constraints (from CLAUDE.md)

- **No `any`, no `as`, no `!`** (typescript rule) — Recharts' custom `Tooltip` `content`
  render-prop and `Customized` layer props are typed generically
  (`TooltipContentProps<TValue, TName>`); every custom render function in this phase
  MUST supply concrete type parameters matching this project's `PayoffPoint`/curve
  shapes, never `TooltipContentProps<any, any>`. See Pitfall 6 and Code Examples below
  for the exact typed pattern.
- **TDD red→green** — each chart swap is its own red→green loop per CONTEXT.md; no
  production Recharts code without a failing test demanding it first.
- **Dependencies point inward** — web imports contracts + core pure functions only.
  Recharts is a pure `apps/web` presentation dependency; it must never be imported by
  `packages/core` or `packages/adapters` (it won't be — this is a UI-only swap, but
  flagging per the boundary rule since a new dependency is being added).
- **Docs before architecture changes** — `docs/architecture/stack-decisions.md` must
  gain a row for the recharts adoption (new UI dependency) before/alongside
  implementation, per `.claude/rules/workflow.md`'s "Docs Before Code" requirement.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `recharts` | `^3.9.2` [VERIFIED: npm registry] | SVG chart primitives (Area/Line/Bar/ReferenceLine/Tooltip/etc.) | Locked decision (CONTEXT.md); current major targeted by shadcn/ui's official `chart` docs [CITED: ui.shadcn.com/docs/components/base/chart]; React 16–19 peer range covers this project's React 19.2.7 [VERIFIED: npm registry `peerDependencies`] |

### Supporting

No new supporting packages. `shadcn` CLI (`^4.11.0`) is already an installed
dependency in `apps/web/package.json` — used only to scaffold
`apps/web/src/components/ui/chart.tsx` (one file, copied into the repo, not a runtime
dependency of its own).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | Visx (already used by 5 of 9 web chart files) | Rejected by user directive — visx is exactly the "hand-rolled SVG" pattern causing the overflow bug class; no built-in clipping/tooltip/responsive story, which is the whole point of this phase |
| Recharts | Apache ECharts (already used by GexBars via echarts-for-react) | Rejected — heavier (canvas renderer, imperative option objects), doesn't compose with shadcn's declarative `ChartContainer`/CSS-variable theming; GexBars is explicitly the chart migrating OFF echarts in this phase |
| Recharts | Nivo, Victory, uPlot (already a dep, unused by any in-scope chart) | Not evaluated in depth — user directive locked Recharts + shadcn; no reason to relitigate |

**Installation:**
```bash
cd apps/web
bun add recharts
bunx shadcn@latest add chart
```

**Version verification:** `npm view recharts version` → `3.9.2` (registry, checked
2026-07-10). `npm view recharts dist-tags --json` confirms `latest: 3.9.2` (not
alpha/beta/canary). `npm view recharts@latest peerDependencies --json` →
`{"react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0", "react-dom": "^16.0.0 ||
^17.0.0 || ^18.0.0 || ^19.0.0", "react-is": "^16.8.0 || ^17.0.0 || ^18.0.0 ||
^19.0.0"}` — covers this project's `react@^19.2.7`. `npm view recharts@latest
scripts.postinstall` → empty (no postinstall script; no supply-chain script-execution
signal).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `recharts` | npm | ~10 years (created 2015-08-07) [VERIFIED: npm registry `time.created`] | 53,253,165 / week (2026-07-02 to 2026-07-08) [VERIFIED: npmjs.org downloads API] | `github.com/recharts/recharts` [VERIFIED: npm registry `repository.url`] | OK | Approved |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

Manual gsd-tools `package-legitimacy check` seam was unavailable in this environment
(`gsd-tools.cjs` not found on any documented install path) — the audit above was run
directly against the npm registry and npmjs.org downloads API instead, which satisfies
the same evidence bar (age, download volume, source repo, no postinstall script) the
seam checks. No `[ASSUMED]` package names in this research: `recharts` was confirmed
directly against the npm registry, not sourced from an unverified web page.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (apps/web)                                                   │
│                                                                        │
│  scenario-engine.ts / payoff-domain.ts   (UNTOUCHED — pure functions) │
│         │  PayoffPoint[], SpotDomain, ScenarioStripLevels             │
│         ▼                                                              │
│  Screen component (Analyzer.tsx / Overview.tsx / Market.tsx / etc.)    │
│         │ props (curves, domain, spot, gex, toggles, ...)              │
│         ▼                                                              │
│  Chart component (PayoffChart.tsx / TermStructureChart.tsx /           │
│                    GammaProfile.tsx / GexBars.tsx)                     │
│         │                                                               │
│         ├─► ui/chart.tsx: ChartContainer(config)                       │
│         │        │  wraps → ResponsiveContainer (recharts)             │
│         │        ▼                                                     │
│         │   <ComposedChart / BarChart data={curve}>                    │
│         │        ├─ XAxis type="number" domain={[min,max]}             │
│         │        │       allowDataOverflow                             │
│         │        ├─ YAxis domain={[lo,hi]} allowDataOverflow           │
│         │        ├─ Area (split-gradient fill, clipPath auto)          │
│         │        ├─ Line ×N (today/exp/fan/roll/compare curves)        │
│         │        ├─ ReferenceLine (walls/flip/spot/flip-vertical)      │
│         │        ├─ ReferenceLine segment=[...] (fwd-IV bracket)       │
│         │        ├─ Cell ×N (per-bar GEX sign color — GexBars only)    │
│         │        ├─ Customized (BE marker bars, EM-band ticks,         │
│         │        │       KISS edge-arrow glyphs — no native primitive) │
│         │        └─ ChartTooltip content={<Custom.../>}                │
│         │             (replaces manual pointermove/localPoint math)    │
│         ▼                                                                │
│  BE pills row / dated-event legend / exclusion note                     │
│    (plain HTML <div>, unchanged — outside the SVG, no Recharts)         │
└─────────────────────────────────────────────────────────────────────┘
```

A reader can trace: data layer produces typed curve/domain values (unchanged) → the
chart component feeds them to Recharts primitives inside `ChartContainer` → Recharts
owns the SVG scale math, clipping, and hover detection that the current hand-rolled
`xScale`/`yScale`/`localPoint` code owns today → the small set of genuinely bespoke
marks (KISS arrows, EM ticks, BE bars) render through one `Customized` layer per chart,
not a parallel rendering system.

### Recommended Project Structure

No new directories. Files change in place:

```
apps/web/src/components/
├── ui/
│   └── chart.tsx              # NEW — shadcn-scaffolded (ChartContainer, ChartConfig, ChartTooltip*, ChartLegend*)
├── charts/
│   ├── PayoffChart.tsx        # visx → Recharts (priority)
│   ├── PayoffChart.test.tsx   # re-target DOM assertions to Recharts' rendered SVG
│   ├── GammaProfile.tsx       # visx → Recharts
│   ├── GexBars.tsx            # echarts-for-react → Recharts
│   ├── GexBars.test.tsx       # replace echarts-for-react mock with ResponsiveContainer mock
│   ├── EquityCurve.tsx        # UNCHANGED (visx) — out of scope
│   ├── MiniLine.tsx           # UNCHANGED (visx) — out of scope
│   └── GexByExpiry.tsx        # UNCHANGED (echarts-for-react) — out of scope
├── picker/
│   └── TermStructureChart.tsx # hand-rolled SVG → Recharts
├── LifecycleChart.tsx         # UNCHANGED (visx) — out of scope, do not destabilize
└── test/                      # NEW (optional) — shared chart test helper, see Validation Architecture
    └── recharts-test-utils.tsx
```

### Pattern 1: Continuous (numeric) x-axis, never category

**What:** `<XAxis type="number" dataKey="spot" domain={[domain.min, domain.max]}
allowDataOverflow />` on every in-scope chart's x-axis.
**When to use:** Always, for these 4 charts. Recharts' `XAxis` defaults to a
categorical band scale; PayoffChart/GammaProfile/TermStructureChart/GexBars all plot a
continuous spot/strike/DTE value, and a categorical axis silently mis-orders or clips
points that don't land on exact category boundaries — this is Pitfall 2 below, and it
is the single most important technique in this migration since it directly re-expresses
Phase 30's domain-fidelity requirement.
**Example:**
```typescript
// Source: https://recharts.github.io/en-US/api/XAxis/ [CITED]
<XAxis
  type="number"
  dataKey="spot"
  domain={[domain.min, domain.max]}
  allowDataOverflow
  ticks={buildXTicks(domain.min, domain.max)}  // reuse existing pure function verbatim
/>
```

### Pattern 2: Split-color fill above/below zero (linearGradient offset trick)

**What:** A single `<Area>` whose fill transitions color at the y=0 crossing, using a
`<linearGradient>` with two `<stop>` elements at the same computed `offset` (the
fraction of the y-domain above zero) but different colors.
**When to use:** PayoffChart's T+0 teal/coral fill (current Layer 2) and the
profit-zone teal-only fill (current Layer 1); GammaProfile's teal/coral gamma fill.
This is not a new invention — it is the exact same gradient trick the current visx code
already implements (`payoff-teal-fill`/`payoff-coral-fill`/`gamma-teal-fill` gradients
in the files read for this research); only the host library changes.
**Example:**
```typescript
// Source: pattern confirmed via recharts.github.io guide + community examples [CITED]
// offset = fraction of the Y domain that is >= 0
const offset = yDomain.hi <= 0 ? 0 : yDomain.lo >= 0 ? 1 : yDomain.hi / (yDomain.hi - yDomain.lo);

<defs>
  <linearGradient id="payoff-split" x1="0" y1="0" x2="0" y2="1">
    <stop offset={offset} stopColor={TEAL} stopOpacity={0.34} />
    <stop offset={offset} stopColor={CORAL} stopOpacity={0.34} />
  </linearGradient>
</defs>
<Area dataKey="pl" stroke="none" fill="url(#payoff-split)" baseValue={0} isAnimationActive={false} />
```

### Pattern 3: Partial-width reference segment (forward-IV bracket)

**What:** `<ReferenceLine segment={[{x: frontDte, y: fwdIv}, {x: backDte, y: fwdIv}]}
stroke={BLUE} strokeDasharray="4 3" />` — draws a line between exactly two data-space
points, not full chart width.
**When to use:** `TermStructureChart`'s horizontal dashed bracket between the front and
back leg x-positions at `y=fwdIv`. This is a first-class `ReferenceLine` prop
(`segment`), not a workaround — it is the direct replacement for the current hand-drawn
`M${frontX} ${yScale(fwdIv)}H${backX}` SVG path string.
**Example:**
```typescript
// Source: Recharts ReferenceLine API — `segment` prop [CITED: recharts.github.io/en-US/api/ReferenceLine/]
<ReferenceLine
  segment={[{ x: candidate.frontLeg.dte, y: fwdIv }, { x: candidate.backLeg.dte, y: fwdIv }]}
  stroke={BLUE}
  strokeDasharray="4 3"
  label={{ value: `fwd ${(fwdIv * 100).toFixed(1)}%`, position: "insideBottom" }}
/>
```

### Pattern 4: `Customized` layer for genuinely non-standard marks

**What:** A small function component receiving Recharts' internal `xAxisMap` /
`yAxisMap` (or, more simply, plain closures over the same `xScale`/`yScale` this
project already computes) that renders raw SVG for shapes no built-in primitive covers.
**When to use:** The KISS edge-arrow glyphs (single `‹`/`›` character in a fixed
per-series lane — `EDGE_ARROW_LANE_Y`), the short BE-marker vertical bars (a fixed-length
bar at the zero line, not a full-height `ReferenceLine`), and the EM-band
ticks+connector (two short vertical ticks + a horizontal connector, all manually
clamped into `[0, innerWidth]` today). These three are the ONLY elements across all 4
charts that don't map to a built-in Recharts primitive or prop — everything else in
CONTEXT.md's "custom-layer strategy" open question resolves to a native Recharts idiom.
**Example:**
```typescript
// Source: Recharts Customize guide [CITED: recharts.github.io/en-US/guide/customize/]
function BeMarkerBars({ xAxisMap, yAxisMap, beStrikes }: CustomizedProps): React.ReactElement {
  const xScale = Object.values(xAxisMap)[0]?.scale;
  const yScale = Object.values(yAxisMap)[0]?.scale;
  if (xScale === undefined || yScale === undefined) return <g />;
  const zeroY = yScale(0);
  return (
    <g>
      {beStrikes.map((x) => (
        <line key={x} x1={xScale(x)} x2={xScale(x)} y1={zeroY - 9} y2={zeroY + 9} stroke={CORAL} strokeWidth={2} />
      ))}
    </g>
  );
}
// usage: <Customized component={BeMarkerBars} />
```

### Anti-Patterns to Avoid

- **Hand-clamping instead of `allowDataOverflow`:** Re-implementing
  `Math.max(0, Math.min(INNER_W, ...))` clamps for curve/Area/Line/Bar geometry defeats
  the entire point of this phase (CONTEXT.md: "not by hand-`Math.min/max` clamps"). Use
  `allowDataOverflow={true}` + the domain prop; let Recharts' auto-generated `clipPath`
  do the clipping. Manual clamping is still correct — and still needed — ONLY inside
  `Customized` layers (Pattern 4), which are not covered by axis-level `clipPath`.
- **`TooltipContentProps<any, any>`:** Violates the project's no-`any` rule (Pitfall 6).
- **Category-type `XAxis` for continuous data:** Silently reorders/clips points that
  don't sit on exact category boundaries (Pitfall 2) — the root cause class this whole
  phase exists to retire, reintroduced through the back door if missed.
- **Removing `@visx/*` or `echarts`/`echarts-for-react` from `package.json`:** Both
  remain load-bearing for out-of-scope charts after this phase (Pitfall 10).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Plot-area clipping | Manual `Math.min/max` clamps per marker/curve | `allowDataOverflow={true}` + Recharts' auto `clipPath` | Structural fix per CONTEXT.md; hand-clamps are exactly the bug class being retired |
| Hover/crosshair coordinate math | `localPoint` + `getBoundingClientRect` + manual scale-invert (current `PayoffChart.tsx` `handlePointerMove`, ~30 lines) | Recharts `<Tooltip>` + `cursor` prop | Recharts already tracks pointer state, viewport clamping (`allowEscapeViewBox`), and re-renders on hover — this is a real ~50-line deletion, not a lateral move |
| Responsive SVG sizing | Hand-rolled `viewBox`/`preserveAspectRatio` + manual width tracking | `ResponsiveContainer` (via `ChartContainer`) | Library-native responsive behavior is the other headline win CONTEXT.md calls out |
| Per-bar conditional color | Manually building ECharts `itemStyle.color` per data point (current `GexBars.tsx` `buildOption`) | `<Cell fill={...} />` per bar | Documented first-class Recharts pattern, same conditional logic, less indirection than ECharts' nested option objects |

**Key insight:** every hand-rolled coordinate-math routine in the 4 in-scope files
(`buildXScale`, `pinMarker`, `handlePointerMove`'s inversion, `xScale`/`yScale` in
`TermStructureChart.tsx`) exists to compensate for a library that doesn't manage its
own scales/clipping/hover — Recharts manages all three natively, so the phase's real
work is deletion, not reimplementation.

## Common Pitfalls

### Pitfall 1: jsdom renders `ResponsiveContainer` at 0×0

**What goes wrong:** Recharts' `ResponsiveContainer` (used internally by `ChartContainer`)
measures its parent's DOM size to size the SVG; jsdom has no real layout engine, so
width/height resolve to 0 and Recharts renders nothing — this is a long-standing,
still-open upstream issue [CITED: github.com/recharts/recharts/issues/2268,
github.com/recharts/recharts/issues/2166].
**Why it happens:** jsdom doesn't implement `getBoundingClientRect`/ResizeObserver-driven
layout the way a real browser does.
**How to avoid:** Mock `ResponsiveContainer` per test file to render children at a fixed
pixel size (`width={800} height={400}`), OR pass fixed numeric `width`/`height` props
directly to `ChartContainer` in tests instead of the default 100%-responsive usage.
This repo already has the exact precedent: `GexBars.test.tsx` currently does
`vi.mock("echarts-for-react", ...)` to sidestep an analogous jsdom limitation (canvas
`getContext` is null). Recommend a small shared helper
(`apps/web/src/components/test/recharts-test-utils.tsx`) exporting a
`mockResponsiveContainer()` call, since all 4 chart test files need the identical fix
(crosses the repo's own DRY threshold for test setup).
**Warning signs:** Tests pass structurally (render doesn't throw) but
`container.querySelector("svg")` or any Recharts DOM query returns null/empty even
though the component "rendered".

### Pitfall 2: `XAxis` defaults to a categorical band scale

**What goes wrong:** Without `type="number"`, Recharts treats the x-axis as
categorical — points are placed at evenly-spaced band centers keyed by array index/
label match, not by numeric value. For PayoffChart's continuous spot-price curve,
GexBars' strike axis (already numeric labels but was categorical `type: "category"` in
the ECharts version — same risk on port), and TermStructureChart's DTE axis, this
silently reorders or unevenly spaces points that don't already sit on exact grid steps.
**Why it happens:** Recharts' default axis type historically favored bar-chart/category
use cases; it is opt-in, not opt-out, for continuous numeric axes.
**How to avoid:** Always set `type="number"` explicitly (Pattern 1) plus an explicit
`domain` — never rely on `"auto"` for the payoff/GEX-strike/DTE axes, since `"auto"`
combined with category defaults is exactly how Phase 30's original hardcoded-domain bug
class re-enters.
**Warning signs:** Curve points visually bunch or spread unevenly relative to their
numeric spot/strike/DTE values; breakeven/wall markers land at the wrong x pixel
despite correct data.

### Pitfall 3: `allowDataOverflow` defaults to `false`

**What goes wrong:** With an explicit `domain` prop but `allowDataOverflow` left at its
default `false`, Recharts silently WIDENS the rendered domain to fit any out-of-range
data point rather than clipping it [CITED:
recharts.github.io/en-US/guide/domainAndTicks/]. For PayoffChart this means an
out-of-domain GEX wall or a fan-curve point outside `computePayoffDomain`'s fitted
window would stretch the axis past the intended tent-fit window — defeating Phase 30's
domain-fidelity requirement in a different, more subtle way than the old hardcoded-6900-7900
bug (silent domain drift instead of silent clipping).
**Why it happens:** `allowDataOverflow: false` is Recharts' default across all axis
types; it is a per-axis opt-in.
**How to avoid:** Set `allowDataOverflow={true}` explicitly on every `XAxis`/`YAxis` in
all 4 charts. Confirmed side effect (desired): Line/Area auto-render a `clipPath` when
`allowDataOverflow` is true, which is the mechanism that retires the manual
`Math.max/min` clamps in `clampY`/`pinMarker`.
**Warning signs:** A regression test that pushes a wall/curve point outside the fitted
domain and asserts the rendered x stays within `[0, innerWidth]` starts failing because
the axis silently grew instead.

### Pitfall 4: `ComposedChart`/multi-series z-order (version-dependent)

**What goes wrong:** In Recharts 2.x, `ComposedChart` had a documented fixed internal
render order (Area → Bar → Line, regardless of JSX order) that could not be overridden
[CITED: github.com/recharts/recharts/issues/295]. PayoffChart's UI-SPEC has a LOCKED
9-layer z-order (profit zone → T+0 fill → fan → tent → roll overlay → walls → BE
markers → T+0 line → spot/crosshair) that depends on render order being controllable.
**Why it happens:** Pre-3.0, SVG element layering was handled by internal
component-type ordering, not JSX position.
**How to avoid:** Recharts 3.0's migration notes state z-index "is determined based
upon render order since SVG does not have a concept of z-index" — i.e., 3.0 changed
this to strict JSX order [CITED: github.com/recharts/recharts/wiki/3.0-migration-guide].
Since this phase pins `^3.9.2` (well past the 3.0 fix), JSX order SHOULD directly
control the 9-layer stack. Verify this empirically with one early smoke test in the
PayoffChart migration (render all layers, assert DOM `compareDocumentPosition` order
matches JSX order) before building out the remaining 8 layers on that assumption —
cheap to confirm, expensive to discover wrong after all layers are built.
**Warning signs:** A layer that should render on top (e.g., the T+0 curve) visually
sits behind a layer JSX places before it (e.g., the profit-zone fill).

### Pitfall 5: Animation defaults cause flaky/misleading test assertions

**What goes wrong:** Recharts' animation defaults (`isAnimationActive` effectively
`true`/`"auto"` on most series components) mean a test that renders and immediately
asserts on SVG attributes (`x`, `height`, `d`) may read mid-transition values rather
than final ones, or transition timers may leak between tests [CITED:
recharts.github.io/en-US/guide/animations/].
**Why it happens:** Recharts 3.0 bundled its own animation engine (replacing the
external `react-smooth` dependency) with animation on by default for a polished
out-of-box feel; it also respects `prefers-reduced-motion`, which jsdom does not set
consistently.
**How to avoid:** Set `isAnimationActive={false}` explicitly on every series component
(`Area`, `Line`, `Bar`, `ReferenceLine`) in all 4 charts — matches the current visx/ECharts
behavior anyway (none of the existing hand-rolled charts animate), so this is parity,
not a regression.
**Warning signs:** Tests that pass in isolation but fail when run in the full suite (or
vice versa), or assertions on geometry that are numerically close but not exact.

### Pitfall 6: Custom `Tooltip`/`Customized` typing defaults to `any`

**What goes wrong:** Recharts' generic `TooltipContentProps<TValue, TName>` type is
easy to reach for as `TooltipContentProps<any, any>` in examples found online — that
violates this project's no-`any` rule (`.claude/rules/typescript.md`).
**Why it happens:** Most public Recharts TypeScript examples prioritize brevity over
strict typing.
**How to avoid:** Supply concrete generics matching this project's own value/name
types, e.g. `TooltipContentProps<number, "today" | "expiration" | "fan">` for
PayoffChart's curve payload, derived from the existing `PayoffPoint` type — never
`any`. Same discipline applies to `Customized`'s `CustomizedProps` and any
`ReferenceLine` `label` render function's parameter type.
**Warning signs:** ESLint's `no-explicit-any` rule catches this at commit time if
missed — but the friction is real enough to flag in advance for the planner/executor.

### Pitfall 7: `@visx/*` / `echarts`/`echarts-for-react` cannot be removed from `package.json`

**What goes wrong:** After migrating `PayoffChart.tsx` and `GammaProfile.tsx` off
`@visx/*`, and `GexBars.tsx` off `echarts-for-react`, a natural "clean up unused deps"
instinct would remove those packages from `apps/web/package.json` — this breaks the
build.
**Why it happens:** `LifecycleChart.tsx`, `EquityCurve.tsx`, and `MiniLine.tsx` all
still import `@visx/*` [VERIFIED: `rg "@visx/" apps/web/src` — 8 files total, only 2
of which (`PayoffChart.tsx`, `GammaProfile.tsx`) are in scope]. `GexByExpiry.tsx` still
imports `echarts-for-react` [VERIFIED: `rg -l "echarts-for-react" apps/web/src` — 5
files, only `GexBars.tsx`/`GexBars.test.tsx` in scope]. All four holdout files are
explicitly out of scope per CONTEXT.md.
**How to avoid:** Leave `@visx/*`, `echarts`, and `echarts-for-react` in
`apps/web/package.json` untouched. Dependency cleanup is only safe once (and if) a
later phase migrates the remaining holdouts.
**Warning signs:** `bun run build` or `bun run typecheck` fails on missing-module
errors in `LifecycleChart.tsx`/`EquityCurve.tsx`/`MiniLine.tsx`/`GexByExpiry.tsx` after
a dependency-removal commit.

### Pitfall 8: Recharts' "vertical layout" means horizontal bars (naming trap)

**What goes wrong:** `GexBars.tsx`'s current ECharts config makes strikes the Y (category)
axis and GEX/OI/volume the X (value) axis — i.e., horizontal bars. In Recharts,
achieving the same layout requires `<BarChart layout="vertical">`, which is
counter-intuitive: `layout="vertical"` in Recharts means "bars grow horizontally, value
axis is X" (the opposite of what the name suggests to most readers).
**Why it happens:** Recharts names the `layout` prop after the axis arrangement, not
the visual bar direction.
**How to avoid:** For GexBars, use `<BarChart layout="vertical">` with `<XAxis
type="number">` (value: gex/coi-poi/vol) and `<YAxis type="category" dataKey="k">`
(strikes) — this reproduces the current ECharts `xAxis: value / yAxis: category`
layout exactly.
**Warning signs:** Bars render vertically (growing up from a shared baseline) instead
of horizontally from a shared left/center baseline.

## Code Examples

### Typed custom Tooltip content (no `any`)

```typescript
// Source: pattern derived from Recharts TooltipContentProps generic
// [CITED: github.com/recharts/recharts/discussions/6055] + this project's no-any rule
import type { TooltipContentProps } from "recharts";

type PayoffTooltipPayloadEntry = { spot: number; pl: number };

function PayoffTooltipContent(
  props: TooltipContentProps<number, "pl">,
): React.ReactElement | null {
  const { active, payload, label } = props;
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const point = payload[0]?.payload as PayoffTooltipPayloadEntry | undefined;
  if (point === undefined) return null;
  return (
    <div className="...">
      <div>{fmtPl(point.pl)}</div>
      <div>SPX {Math.round(Number(label))}</div>
    </div>
  );
}
```

### ChartConfig mapped to MORAI palette (CSS variables already in `index.css`)

```typescript
// Source: shadcn/ui chart docs ChartConfig shape [CITED: ui.shadcn.com/docs/components/base/chart]
// + this project's existing --color-* tokens (apps/web/src/index.css)
const chartConfig = {
  today: { label: "T+0", color: "var(--color-violet)" },
  expiration: { label: "@exp", color: "var(--color-muted)" },
  fan1: { label: "+7d", color: "#7c6fd6" },
} satisfies ChartConfig;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `react-smooth` external animation dep + `recharts-scale` external scale dep | Bundled internally in `recharts` 3.0 | Recharts 3.0 release | No action needed; don't hand-pin those sub-packages if seen in older tutorials |
| `accessibilityLayer` default `false` | Default `true` in Recharts 3.0 | Recharts 3.0 | Free accessibility improvement (keyboard nav) on every chart in this migration — no extra work required, just don't disable it |
| `CategoricalChartState` internal prop-passing | Removed in 3.0; custom components read scales via `Customized`/hooks instead | Recharts 3.0 | Confirms `Customized` (Pattern 4) is the current-idiom way to build custom layers, not a workaround |

**Deprecated/outdated:** `alwaysShow` and `isFront` props on `ReferenceLine`/`ReferenceArea`
were removed in 3.0 (were already non-functional pre-2.0 in the `isFront` case) — don't
reach for them if seen in older StackOverflow/blog examples.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | ComposedChart/multi-series z-order fully follows JSX render order in 3.9.x (Pitfall 4) | Common Pitfalls, Pattern usage throughout PayoffChart mapping | If wrong, the locked 9-layer z-order needs a workaround (explicit `zIndex`-style layering trick or splitting into multiple stacked `<svg>`/`<g>` groups); would surface immediately in the first PayoffChart smoke test, low blast radius since it's the first thing verified |
| A2 | `Customized` component receives `xAxisMap`/`yAxisMap` with a directly-usable `.scale` function in 3.9.x (exact shape may have shifted slightly across 3.x point releases) | Pattern 4, Code Examples | If the exact prop shape differs, the same effect is achievable by computing `xScale`/`yScale` via the same pure `scaleLinear`-style helper this project already has (`buildXScale` in `PayoffChart.tsx`) and closing over it directly in the `Customized` render function, independent of what Recharts passes — low risk, cheap fallback already exists in-repo |

**If this table is empty:** N/A — see above for the two assumptions and their fallback
paths.

## Open Questions (RESOLVED)

1. **Recharts version + shadcn chart compat (React 19? Vite? current shadcn base-nova
   CLI `chart` component output)**
   - What we know: `recharts@3.9.2` is latest on npm, published 2026-07-04, peer-deps
     cover React 19.2.7 [VERIFIED: npm registry]. shadcn/ui's official chart docs
     target Recharts v3 [CITED: ui.shadcn.com/docs/components/base/chart]. The CLI
     command (`bunx shadcn@latest add chart`) generates one file,
     `components/ui/chart.tsx`, with no additional runtime deps beyond `recharts`
     itself.
   - What's unclear: nothing material — this question is resolved.
   - Recommendation: Pin `recharts@^3.9`, run the shadcn CLI once, commit the
     generated `chart.tsx` as-is (don't hand-edit its internals; extend via
     `ChartConfig`/composition, per the "no wrapping abstraction" convention the
     official docs describe).

2. **Custom-layer strategy for: IV fan (area between computed series), BE pills,
   scenario strip, edge-arrow lanes**
   - What we know: The "IV fan" is not actually an area-between-two-series band in the
     current implementation — `fanCurves` are 3 separate `LinePath`s (+7/+14/+21d), not
     a filled confidence band. That maps directly to 3 separate Recharts `<Line>`
     components (Pattern reuse, no band-Area technique needed). BE pills and the
     scenario strip are already plain HTML `<div>` rows outside the `<svg>` element in
     the current code — they don't touch the chart library at all today and don't need
     to start. Edge-arrow lanes are the one true custom-layer case (Pattern 4).
   - What's unclear: nothing material — this question is resolved by inventory, not by
     research; CONTEXT.md's framing assumed the fan curves were a band when they are
     discrete lines.
   - Recommendation: Keep BE pills / scenario strip as unchanged HTML overlays (already
     satisfies "keep overlay ONLY if library fights us" — they were never chart-library
     concerns). Render fan curves as 3 `<Line>`s. Render edge-arrow lanes via one shared
     `Customized` layer (Pattern 4), reusing the existing `pinMarker`/`EDGE_ARROW_LANE_Y`
     pure logic verbatim.

3. **Crosshair tooltip fidelity: Recharts Tooltip vs. Phase-22-style custom crosshair**
   - What we know: Recharts' built-in `<Tooltip>` + `cursor` prop natively provides
     hover detection, a vertical cursor line (`cursor={{ stroke: CROSSHAIR_COLOR }}`),
     and a fully custom `content` render prop — covering the crosshair line, the
     hover-driven readout, and viewport-aware positioning (`allowEscapeViewBox`) that
     the current code hand-rolls via `localPoint` + manual `left: Math.min(...)` math.
   - What's unclear: whether Recharts' default tooltip positioning (which trails the
     cursor) versus this project's current fixed-top-right-of-crosshair positioning
     needs a custom `position` prop override to match pixel-for-pixel — a minor visual
     tuning question, not an architectural one.
   - Recommendation: Use Recharts' `<Tooltip>` with a custom `content` component
     (Code Examples above) — this is the "least code" path CONTEXT.md asks for and
     deletes the manual coordinate-math block. Tune the `position`/`offset` props
     during implementation to match the current fixed-offset visual if needed; this is
     a CSS-level detail, not a research gap.

4. **Test strategy: what to assert against Recharts DOM (ResponsiveContainer
   width-0-in-test pitfall)**
   - What we know: `ResponsiveContainer` measures 0×0 under jsdom (Pitfall 1,
     [CITED] multiple open Recharts GitHub issues). The fix is a per-test-file mock
     (fixed width/height) or explicit numeric `width`/`height` props — this repo
     already has the identical precedent pattern in `GexBars.test.tsx`'s
     `echarts-for-react` mock. Once sized correctly, Recharts renders real SVG
     (`<path>`, `<rect>`, `<line>`) that `@testing-library/react` queries exactly like
     the current visx output — `container.querySelector`, `getByTestId` (via `data-testid`
     passed through to underlying SVG elements where Recharts forwards it), and
     `getByText` all continue to work unchanged.
   - What's unclear: nothing material — this question is resolved.
   - Recommendation: Add one shared test helper (`recharts-test-utils.tsx`,
     Validation Architecture below) exporting a `ResponsiveContainer` mock; import it
     in all 4 chart test files. Preserve each existing test's *intent* (per CONTEXT.md)
     by re-deriving the same assertions against Recharts' DOM shape — e.g., a wall-line
     assertion becomes a query for the `<line>` Recharts' `ReferenceLine` renders, at
     the same computed x-coordinate, rather than the current hand-rolled
     `[data-testid="wall-line-call"]` (Recharts' `ReferenceLine` accepts arbitrary
     pass-through props including a wrapping `<g>` — confirm `data-testid` forwarding
     during implementation; if it doesn't forward cleanly, fall back to structural
     queries like nth `<line>` with a matching `stroke` color, which the current tests
     already do in some cases, e.g. the EM-band zero-line lookup by `stroke="#46556a"`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node/Bun toolchain | Build/test | ✓ | (existing, unchanged) | — |
| npm registry access | `recharts` install + version verification | ✓ | — | — |
| `recharts` package | All 4 chart migrations | Not yet installed | Install `^3.9.2` this phase | — |
| shadcn CLI (`shadcn`) | Scaffolding `ui/chart.tsx` | ✓ (already a dependency, `^4.11.0`) | 4.11.0 | — |
| `gsd-tools.cjs` seam | Research provider routing / package-legitimacy automation | ✗ (not found on any documented install path in this environment) | — | Direct npm registry + npmjs.org downloads API calls (used for this research) |

**Missing dependencies with no fallback:** none blocking.

**Missing dependencies with fallback:** `gsd-tools.cjs` — worked around via direct
registry/API calls for this research session; does not block phase execution since
package installation itself (`bun add recharts`) doesn't depend on the seam.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace `test.projects`), `@testing-library/react` 16.3.0, `jsdom` 26.1.0 |
| Config file | `apps/web/vitest.config.ts` (environment: jsdom, globals: false — explicit imports required) |
| Quick run command | `cd apps/web && bunx vitest run src/components/charts/PayoffChart.test.tsx` |
| Full suite command | `bun run test` (root workspace, runs all `test.projects`) |

### Phase Requirements → Test Map

No formal REQ IDs exist for Phase 33 yet (`ROADMAP.md` lists `Requirements: TBD`) — the
planner should assign REQ IDs during plan creation. Provisional behavior → test map,
keyed to CONTEXT.md's hard requirements:

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|---------------------|--------------|
| PayoffChart: no plot-element bleeds past `[0, innerWidth]` at extreme/out-of-domain values (EM band, GEX walls) | unit (fast-check + example) | `vitest run src/components/charts/PayoffChart.test.tsx` | ✅ Existing (re-target assertions to Recharts DOM) |
| PayoffChart: x-domain equals `computePayoffDomain` output (Phase 30 parity) | unit | `vitest run src/components/charts/PayoffChart.test.tsx` | ✅ Existing |
| PayoffChart: 9-layer z-order renders in locked JSX order (Pitfall 4 / Assumption A1) | unit (new) | `vitest run src/components/charts/PayoffChart.test.tsx` | ❌ Wave 0 — new test needed |
| GexBars: per-bar GEX sign coloring (teal positive / coral negative) | unit | `vitest run src/components/charts/GexBars.test.tsx` | ✅ Existing (re-target from echarts-stub mock to real Recharts DOM) |
| TermStructureChart: forward-IV bracket omitted when `fwdIv` is null (guard case) | unit | `vitest run src/components/picker/TermStructureChart.test.tsx` | Check — confirm test file exists during planning |
| GammaProfile: teal/coral split renders correctly in both compact and full sizes | unit | (new/existing — confirm during planning) | Check |

### Sampling Rate

- **Per task commit:** the single chart file's test command (quick run above).
- **Per wave merge:** `bun run test` (full web workspace).
- **Phase gate:** full suite green before `/gsd-verify-work 33`.

### Wave 0 Gaps

- [ ] `apps/web/src/components/test/recharts-test-utils.tsx` — shared
      `ResponsiveContainer` mock (or fixed-dimension helper), used by all 4 chart test
      files (Pitfall 1). No framework install needed — `recharts` itself is the only
      new package.
- [ ] Confirm `TermStructureChart.test.tsx` exists (not read during this research
      session — only the component source was inventoried per the task brief); if
      absent, it's a Wave 0 gap for that chart's migration.
- [ ] New z-order regression test for PayoffChart (Assumption A1 verification) —
      cheap, should be one of the first tests written in the PayoffChart migration
      plan, before other layers are built on the JSX-order assumption.

## Security Domain

`security_enforcement: true` in `.planning/config.json`, so this section is included
per policy — but this phase has effectively no attack surface: it is a client-side
presentation swap with no new trust boundary, no new user input parsing, and no
data-layer change (CONTEXT.md lock).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | Unaffected — no auth surface touched |
| V3 Session Management | No | Unaffected |
| V4 Access Control | No | Unaffected |
| V5 Input Validation | Marginal | Chart props are already typed via `packages/contracts` Zod schemas upstream of these components (e.g. `GexSnapshotEntry`, `PickerCandidate`) — no new untyped input enters the chart layer; Recharts itself renders only what's passed, no new parsing introduced |
| V6 Cryptography | No | Unaffected |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| XSS via unsanitized chart labels/tooltip content | Tampering / Information Disclosure | Not a new risk — all label/tooltip content in this phase derives from already-typed numeric contract fields (spot, strike, P&L, IV), never raw user/HTML strings; Recharts renders text nodes via React (auto-escaped), same safety property React already provides everywhere else in this codebase |

## Sources

### Primary (HIGH confidence)

- npm registry (`npm view recharts ...`) — version `3.9.2`, peer deps, publish date,
  creation date, repository URL, postinstall script (checked 2026-07-10)
- npmjs.org downloads API — weekly download count for `recharts` (checked 2026-07-10)
- [ui.shadcn.com/docs/components/base/chart](https://ui.shadcn.com/docs/components/base/chart) — `ChartContainer`/`ChartConfig`/`ChartTooltip*`/`ChartLegend*` API, CSS-variable theming pattern, installation command
- [github.com/recharts/recharts/wiki/3.0-migration-guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide) — breaking changes, TypeScript typing changes, z-order/render-order change, `ReferenceLine`/`ReferenceArea` prop removals
- [recharts.github.io/en-US/api/XAxis/](https://recharts.github.io/en-US/api/XAxis/), [recharts.github.io/en-US/guide/domainAndTicks/](https://recharts.github.io/en-US/guide/domainAndTicks/) — `type="number"`, `domain`, `allowDataOverflow` semantics
- [recharts.github.io/en-US/api/ReferenceLine/](https://recharts.github.io/en-US/api/ReferenceLine/) — `segment` prop, custom label rendering
- [recharts.github.io/en-US/guide/animations/](https://recharts.github.io/en-US/guide/animations/) — `isAnimationActive` defaults and `prefers-reduced-motion` behavior
- [recharts.github.io/en-US/guide/customize/](https://recharts.github.io/en-US/guide/customize/) — `Customized` component pattern

### Secondary (MEDIUM confidence)

- [github.com/recharts/recharts/issues/2268](https://github.com/recharts/recharts/issues/2268), [github.com/recharts/recharts/issues/2166](https://github.com/recharts/recharts/issues/2166) — `ResponsiveContainer` 0×0-in-jsdom, community-confirmed workarounds
- [github.com/recharts/recharts/discussions/6055](https://github.com/recharts/recharts/discussions/6055) — typed custom tooltip pattern (`TooltipContentProps<TValue, TName>`)
- [github.com/recharts/recharts/issues/295](https://github.com/recharts/recharts/issues/295) — pre-3.0 `ComposedChart` fixed z-order (superseded by the 3.0 migration guide's stated fix, cross-checked above)
- [github.com/recharts/recharts/discussions/4559](https://github.com/recharts/recharts/discussions/4559) and related CodeSandbox examples — split-color-gradient Area technique

### Tertiary (LOW confidence)

- None retained as load-bearing — all claims above were either registry-verified or
  cross-checked against Recharts' own official docs/wiki.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — version, peer deps, and postinstall safety all confirmed
  directly against the npm registry, not inferred from training data or web search
  alone.
- Architecture: HIGH — every element in all 4 charts was inventoried from the actual
  source files (not assumed), and each maps to a specifically-cited Recharts prop/API,
  not a general "Recharts probably supports this" guess.
- Pitfalls: HIGH — the two most consequential pitfalls (jsdom `ResponsiveContainer`
  sizing, `allowDataOverflow` default) are both confirmed via multiple independent
  GitHub issues and the official domain/ticks guide, not single-source claims.

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (30 days — Recharts ships frequently but this research
pinned to a specific verified version; re-verify the version pin if implementation
starts more than a few weeks out)
