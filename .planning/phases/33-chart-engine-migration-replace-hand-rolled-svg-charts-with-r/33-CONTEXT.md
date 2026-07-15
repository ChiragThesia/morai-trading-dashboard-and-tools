---
phase: 33-chart-engine-migration
status: locked
created: 2026-07-10
source: user directive 2026-07-10 ("The analyze tab is still ass the graph is ASS it overflows all the time. USE A PROPER graphing tool/library") + roadmap Phase 33 entry
---

# Phase 33 Context — Chart Engine Migration (Recharts via shadcn chart primitives)

## Why (user-locked)

Hand-rolled SVG charts keep producing the same bug class: overflow/bleed outside the
plot area (EM-band page-bleed hotfix 2563bd6), marker label pile-up (Phase 31), fixed
domains clipping tents (Phase 30). Each fix is a hand-clamp. User directive: stop
patching, adopt a proper charting library. Native clipping, responsive containers, and
built-in tooltips kill the bug class permanently.

## Decision (locked)

**Recharts, wired through shadcn chart primitives** (`ChartContainer` /
`ChartTooltipContent` / CSS-variable theming). Project is already shadcn base-nova
(`apps/web/components.json`), so the shadcn `chart` component is the idiomatic add —
one new npm dep (recharts), zero bespoke chart chrome.

## Scope (locked)

Presentation swap ONLY. Data layer stays byte-identical:

- `apps/web/src/lib/scenario-engine.ts` — UNTOUCHED (grid/curves/crossings)
- `apps/web/src/lib/payoff-domain.ts` — UNTOUCHED (tent-fitting domain)
- `packages/contracts/*` — UNTOUCHED (no API changes)
- No server/worker/core changes. Web-only phase.

### In scope (4 charts, roadmap-listed)

1. **PayoffChart** (`components/charts/PayoffChart.tsx`, ~37K) — the priority. Dual
   T+0/expiry curves, IV fan, profit-zone shading, wall/flip reference lines +
   edge-arrow lanes (Phase 31), EM band + ticks, crosshair tooltip, BE pills,
   scenario strip. Used by Analyzer (ad-hoc paste) and Overview.
2. **TermStructureChart** (`components/picker/TermStructureChart.tsx`)
3. **GammaProfile** (`components/charts/GammaProfile.tsx`) — dealer-gamma profile
4. **GexBars** (`components/charts/GexBars.tsx`) — GEX-by-strike bars

### Out of scope (explicit)

- `LifecycleChart.tsx` — Phase 22, shipped + live-UAT'd, crosshair→rail sync; do NOT
  destabilize. Candidate for a later phase if 33 proves the pattern.
- `EquityCurve.tsx`, `MiniLine.tsx`, `GexByExpiry.tsx` — small/sparkline; migrate only
  if free (shared primitives make it trivial), never at cost to the 4 in-scope charts.
- Any data-layer or contract change.
- New visual features. Parity with current design tokens (MORAI palette: violet/gray,
  Phase 17.1 decision) — not a redesign.

## Hard requirements

- **No overflow, structurally**: plot elements clip to the plot area by construction
  (library clipping / ResponsiveContainer), not by hand-`Math.min/max` clamps.
  Regression: EM band at extreme domains must not bleed (keep 2563bd6's test intent,
  re-expressed against the new renderer).
- **Domain fidelity**: PayoffChart keeps consuming `computePayoffDomain` output as its
  x-domain (Phase 30 behavior). Tent always fits.
- **Existing test suite green**; chart tests re-written against the new DOM where
  assertions were SVG-coordinate-specific, preserving each test's *intent* (esp.
  overflow regressions, zero-crossing/BE markers, EM clamp).
- **Visual parity gate**: same data → same story (curves, zones, walls, EM). Design
  tokens via shadcn chart CSS variables mapped to the existing MORAI palette.
- Bundle: recharts is the single new dependency (v1.2 "zero new deps" guard was
  milestone-scoped; user directive overrides here — one dep, justified).

## Non-negotiables carried forward

- Hexagonal boundaries: web imports contracts + core pure functions only — unchanged.
- TDD red→green for each chart swap; commit at green.
- Phase 31 KISS: no marker-text in plot; edge-arrow lanes stay (re-expressed as
  Recharts reference-line labels or custom layer — whatever keeps the lanes).
- Phase 30: `domain` remains a required prop of PayoffChart.

## Open questions for research

- Recharts version + shadcn chart compat (React 19? Vite? current shadcn base-nova CLI
  `chart` component output).
- Custom-layer strategy for: IV fan (area between computed series), BE pills,
  scenario strip, edge-arrow lanes — Recharts `Customized` / custom shapes vs. keeping
  a thin overlay div. Prefer library idiom; keep overlay ONLY if library fights us.
- Crosshair tooltip fidelity: Recharts Tooltip vs. Phase-22-style custom crosshair —
  what preserves current UX with least code.
- Test strategy: what to assert against Recharts DOM (recharts renders SVG too — but
  responsive; jsdom sizing caveats, `ResponsiveContainer` width-0-in-test pitfall).
