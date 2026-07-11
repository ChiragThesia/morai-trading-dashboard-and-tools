# Phase 35: Mobile Experience Redesign - Research

**Researched:** 2026-07-11
**Domain:** Responsive frontend layout (React/Tailwind v4, Recharts), mobile trading-app UX
**Confidence:** MEDIUM-HIGH (codebase findings VERIFIED by direct read/grep; UX pattern claims CITED from web sources; a few CSS-cascade specifics ASSUMED and flagged for a quick empirical check during implementation)

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md is a single locked directive (not the `## Decisions`/`## Claude's Discretion`/
`## Deferred Ideas` discuss-phase format) — reproduced verbatim below, with research findings
against each.

### Locked Decisions (from CONTEXT.md `## Constraints (locked)` and `## Acceptance (UAT)`)

- Desktop unchanged at ≥768px (Tailwind `md:` boundary already in use). **Research correction:
  the codebase's only live responsive boundary is `lg:` (1024px), not `md:` — see "Breakpoint
  Correction" and D-01 below.**
- No new heavy dependencies; Tailwind + existing shadcn primitives + existing charts (Recharts
  already responsive via `ResponsiveContainer`/aspect-ratio — reuse). **Confirmed achievable:
  zero new packages needed for any recommendation in this document.**
- Data layer untouched: this is layout/presentation + at most new pure view components.
- The Phase 33/34 chart stack is fresh — chart INTERNALS stay untouched; only their container
  sizing/chrome may adapt.
- MORAI design system (tokens, Panel/PanelHeading/Button primitives, mono type, 0.09em tracking
  scale) stays — this is responsive re-composition, not a re-skin.
- PWA/native app/TestFlight explicitly OUT of scope (mobile native later via Expo consuming this
  API; this phase is the responsive web).
- UI-SPEC gate before implementation (ui-plan-gate) — this is a UI phase.
- Acceptance (UAT): first screen at ~390px shows nav + tight KPI strip + payoff hero/positions
  summary with no scroll; no horizontal scroll/clipping anywhere; ticker chips condensed; the
  MarketRail accessible but demoted; desktop ≥768px (see correction: ≥1024px) visually
  unchanged.

### Claude's Discretion

CONTEXT.md does not include an explicit discretion section. Treat as discretionary, informed by
the research below: exact card field selection/order on `<PositionCard>`, exact scroll-snap chip
grouping/order within the secondary KPI rail, exact touch-target size values (as long as ≥44px),
and whether the `<details>` fix uses a CSS-only override or a `matchMedia` hook (Open Question
3). The `lg:` vs `md:` breakpoint correction (D-01) is a factual finding, not a discretionary
choice, and should be confirmed with the user rather than silently assumed.

### Deferred Ideas (OUT OF SCOPE)

- PWA / native app / TestFlight (explicit in CONTEXT.md; unrelated to this phase's responsive-
  web scope).
- Chart internals (crosshair rendering, z-order, curve logic) — frozen per constraint; Pitfall 4
  (Recharts touch tooltip) is observed and logged, not fixed, if broken.
</user_constraints>

## Summary

The user's screenshots describe a naive-stacking symptom, but reading the actual source shows
the root causes are more specific and, in two of three screens, worse than "just stacked":

- **Overview** (`apps/web/src/screens/Overview.tsx`) already has a working responsive
  skeleton — `flex flex-col gap-3 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px]` — and
  `MarketRail.tsx` already ships a native `<details>` collapse mechanism. The bug is that the
  `<details>` hardcodes `open`, so it never actually collapses; it just LOOKS collapsible while
  rendering fully expanded above the hero on every viewport. This is a one-attribute-class fix,
  not a rebuild.
- **Analyzer** (`Analyzer.tsx:759`) and **Journal** (`Journal.tsx:562`) have **zero** responsive
  handling: both use a fixed-pixel `grid-template-columns` (`300px 1fr 330px` / `250px 1fr
  290px`) with no breakpoint at all. Journal's version also sits inside `overflow-hidden`, so on
  a 390px viewport it doesn't scroll or wrap — it **clips content into invisibility**. This is a
  more severe bug than the CONTEXT.md's "naively stacked" framing suggests, and the fix is to
  port Overview's already-proven `flex-col lg:grid lg:grid-cols-[...]` pattern to both screens
  (reuse, not invention).
- The app's only live responsive breakpoint today is Tailwind's `lg:` (1024px), not `md:`
  (768px) as CONTEXT.md's constraints section states. This is a factual correction, not a
  judgment call — see "Breakpoint Correction" below.
- The ticker blob, the positions table, and the chart-chrome wrap are real UX problems that need
  actual redesign work (not just a missing breakpoint), informed by the mobile-trading-app and
  data-table research below.

**Primary recommendation:** Fix the two broken fixed-pixel grids (Analyzer, Journal) by porting
Overview's existing `lg:grid` pattern; fix MarketRail's `open` hardcoding; then apply the
researched mobile patterns (KPI hero strip + scroll-snap rail, table→card transform, chart chrome
collapse) using only native CSS (Tailwind v4 utilities, `<details>`, `scroll-snap`, `env()`) —
zero new dependencies are needed anywhere in this phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Breakpoint-driven layout branching (grid → stack, table → cards) | Browser / Client | — | Vite SPA, no SSR; all rendering is client-side React + Tailwind CSS |
| KPI/ticker strip condensation | Browser / Client | — | Pure presentational restructuring of existing `PillHeader`/`MetricChip` |
| Positions table → card transform | Browser / Client | — | New view component consuming the same `Row[]`/`buildRows` data already computed in `Overview.tsx` |
| Chart container sizing/chrome | Browser / Client | — | `PayoffChart`/`GammaProfile`/`GexBars`/`LifecycleChart` internals stay frozen (constraint); only their `Panel` wrapper padding and `PayoffControls` chrome may adapt |
| Navigation (tabs) | Browser / Client | — | `Shell.tsx` top-tab bar; no routing/server involvement |
| Data fetching (positions, GEX, COT, macro, exits) | API / Backend (existing) | Browser / Client (hooks) | Unchanged — this phase touches presentation only, per CONTEXT.md constraint |

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new packages (CONTEXT.md constraint, confirmed
achievable — every recommendation below uses Tailwind v4.3.1 (already installed), native HTML
(`<details>`), and native CSS (`scroll-snap`, `env(safe-area-inset-*)`, `100dvh`) that ship in
every evergreen browser with no library required.

## Standard Stack

No new dependencies. Existing toolkit this phase draws on:

| Tool | Version (verified in repo) | Used for |
|------|------|----------|
| Tailwind CSS | `4.3.1` [VERIFIED: apps/web/package.json] | Breakpoint utilities, `scroll-snap-*`, arbitrary-value grid columns, the `open:` state variant |
| Recharts | `3.9.2` [VERIFIED: apps/web/package.json] | Already responsive via `ResponsiveContainer`/`aspectRatio` (`PayoffChart.tsx:686-689`) — no chart-internals change needed |
| Native `<details>`/`<summary>` | HTML living standard | Already used in `MarketRail.tsx:46` — reuse, don't replace with a JS accordion |
| CSS `env(safe-area-inset-*)`, `100dvh` | CSS Environment Variables Module Level 1 / CSS Values L4 | Notch/home-indicator safe areas, iOS Safari viewport-resize stability |
| `@testing-library/react` | `16.3.0` [VERIFIED: apps/web/package.json] | Breakpoint-conditional render assertions (jsdom, no real CSS layout) |

**Installation:** none.

## Breakpoint Correction (read before planning)

CONTEXT.md's constraints section states: *"Desktop unchanged at ≥768px (Tailwind `md:` boundary
already in use)."* This is inaccurate. `grep -rn "md:\|lg:\|sm:" apps/web/src/screens/` shows the
**only** responsive prefix in production use across all three screens is `lg:` (Tailwind default
1024px), on exactly two lines: `Overview.tsx:1080` (the 3-column grid) and `MarketRail.tsx:47,50`
(the collapse). `md:` appears nowhere in a layout-affecting position. [VERIFIED: grep against
`apps/web/src/screens/*.tsx`]

Consequence: today, everything from 0px to 1023px already renders in the SAME single-column
stacked mode Overview's grid falls back to — there is no behavior change to preserve between
768px and 1023px, because nothing currently branches there. Treating `lg:` (1024px) as the
"desktop unchanged" cutover (not 768px) satisfies CONTEXT.md's actual intent — pixel-identical
desktop — without inventing a boundary the code doesn't have, and keeps a single mobile/desktop
split across all three screens (reuse over invention). **D-01** below locks this in; flagged in
Open Questions for a one-line user confirmation since it corrects the written constraint.

## Decisions

Research-driven recommendations for the planner (distinct from CONTEXT.md's user-locked
decisions, which these are designed to satisfy, not override):

- **D-01:** Mobile/desktop split stays at Tailwind `lg:` (1024px), not `md:` (768px) — corrects
  CONTEXT.md's constraint text to match the codebase's only existing responsive boundary. Zero
  regression risk since nothing branches at 768px today (see Breakpoint Correction).
- **D-02:** MarketRail's existing `<details>` element is reused as-is; the only change is
  removing the hardcoded `open` attribute and adding a `lg:`-scoped override to force it visible
  at desktop widths regardless of runtime open/closed state (Pitfall 1).
- **D-03:** MarketRail moves to the END of the visual stack on mobile via CSS `order` (Pattern
  3), not a DOM reorder — DOM/tab order stays nav → MarketRail summary → hero → positions → GEX
  rail (Pitfall 6's mitigated tradeoff).
- **D-04:** The positions table gets a genuine second render path (`<PositionCard>`) below
  `lg:`, sharing the same `Row[]` data as the desktop `<table>` — no CSS-only table transform
  (Pattern 1).
- **D-05:** The card's tap-to-expand-greeks affordance reuses the EXISTING `expandedRowKey`
  state already built for verdict-detail expansion (`Overview.tsx:389,461`) — no second expand
  mechanism.
- **D-06:** PillHeader splits into a sticky priority row (SPX spot, net γ/1%, VIX, book P&L) and
  a non-sticky horizontal scroll-snap rail for the remaining 5 chips, below `lg:` only; at `lg:`
  and up all 9 chips render in the current single row, unchanged.
- **D-07:** `PayoffControls`' `flex-wrap` chip row becomes the same scroll-snap mechanism as
  D-06 (one shared `ChipRail`-style wrapper, two call sites), not a bespoke fix per surface
  (Pattern 2).
- **D-08:** No bottom tab bar is added. `Shell.tsx`'s existing top-tab nav (3 tabs) is kept;
  only its touch-target HEIGHT is bumped to 44px minimum below `lg:` (width already meets it).
  Apple HIG's bottom-bar guidance targets apps needing thumb-zone primary nav across many
  screens; this app has exactly 3 top-level screens already fitting a compact header, and the
  reported complaints were about content density/hierarchy, not nav discoverability — a bottom
  bar is unrequested scope (ladder rung 1: does this need to exist at all).
- **D-09:** Analyzer's and Journal's fixed-pixel 3-column grids (`Analyzer.tsx:759`,
  `Journal.tsx:562`) convert to the same `flex-col lg:grid lg:grid-cols-[...]` convention
  Overview already uses — one responsive pattern across all three screens (Pitfall 2).
- **D-10:** Chart internals (`PayoffChart`, `GammaProfile`, `GexBars`, `LifecycleChart`) are not
  touched; only their `Panel` wrapper padding/margins adapt for full-bleed mobile display, per
  the CONTEXT.md constraint.

## Architecture Patterns

### System Architecture Diagram

```
Viewport width (CSS media query, evaluated by the browser on load/resize)
        │
        ├─ < 1024px ("mobile" — phone AND tablet-portrait, per Breakpoint Correction)
        │     │
        │     ├─ PillHeader   → priority-KPI row (sticky) + scroll-snap chip rail (non-sticky)
        │     ├─ MarketRail   → <details> CLOSED by default, rendered AFTER hero/positions
        │     │                 (CSS `order`, not DOM move — see Pitfall 1)
        │     ├─ Payoff hero  → full-bleed chart, PayoffControls chips → scroll-snap row
        │     ├─ PositionsTable → <table> hidden; <PositionCard> list shown (same Row[] data)
        │     └─ GEX rail     → stacks below positions (existing behavior, unchanged)
        │
        └─ ≥ 1024px ("desktop" — pixel-identical, per constraint)
              │
              └─ existing 3-column `lg:grid` layout, existing <table>, existing chip row
                 (all current `lg:` classes stay exactly as they are today)

Same data hooks (usePositions/useGex/useCot/useMacro/useExits/useLiveStream) feed BOTH
branches unchanged — this phase only branches the PRESENTATION layer built from their
output, never the fetching layer.
```

### Recommended Project Structure

No new directories. New files land beside what they extend:

```
apps/web/src/
├── screens/
│   ├── Overview.tsx        # PillHeader split, positions table/card branch, MarketRail order
│   ├── MarketRail.tsx      # fix `open` hardcoding (Pitfall 1)
│   ├── Analyzer.tsx        # port lg:grid pattern to the 759 fixed grid
│   └── Journal.tsx         # port lg:grid pattern to the 562 fixed grid
├── components/
│   ├── system/
│   │   └── ChipRail.tsx    # NEW — one shared scroll-snap wrapper, used by PillHeader AND
│   │                       #   PayoffControls (same mechanism, two call sites — Pattern 2)
│   └── PositionCard.tsx    # NEW — mobile card view of a positions Row (Pattern 1)
```

### Pattern 1: Table → Card transform (dual render, shared data)

**What:** Render the SAME `Row[]` (from `buildRows`) through two presentational branches: the
existing `<table>` at `lg:` and up, a new `<PositionCard>` list below `lg:`. Never attempt a
CSS-only `display: block` transform of `<table>`/`<tr>`/`<td>` — it breaks the table's
row/column ARIA semantics for screen readers, a documented accessibility caution, and produces
brittle alignment. [CITED: nngroup.com/articles/mobile-tables — "the priority+ pattern... is the
most adaptive"; "Transforming table rows into card views... provides clear visual hierarchy"]

**When to use:** Any tabular data with >4 columns viewed on <1024px, where rows are read
individually (not compared side-by-side) — exactly the positions table's use case (each
calendar is inspected on its own, not cross-compared column-by-column).

**Example (shape, not exact code):**
```tsx
// Overview.tsx — same `rows` computed once, branched at render:
<table className="hidden w-full lg:table">{/* existing markup, unchanged */}</table>
<div className="flex flex-col gap-2 lg:hidden">
  {rows.map((r) => <PositionCard key={r.key} row={r} {...sharedProps} />)}
</div>
```
Priority fields visible on the closed card: Position label (+ IV n/a badge), Expiry/DTE (both
lines), Net val, Unreal (P&L/entry), Verdict chip. Behind a tap: Δ/Γ/Θ/Vega + the include
checkbox — **reuse the existing `expandedRowKey`/click-to-expand state** already wired for
`VerdictDetailBody` (`Overview.tsx:389,461,581-588`) rather than adding a second expand
mechanism.

### Pattern 2: Horizontal scroll-snap chip rail (native CSS, one mechanism twice)

**What:** `overflow-x-auto` + `snap-x snap-mandatory` (or `snap-proximity`) on a `flex-nowrap`
row of chips — the browser handles momentum scroll and snap natively, no JS carousel.
[CITED: developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap — "content snapping into
position as the user scrolls"; tailwindcss.com/docs/scroll-snap-type ships `snap-x`/`snap-none`
utilities out of the box]

**When to use:** Both the PillHeader's demoted secondary KPIs (0DTE γ, γ flip, VVIX, Fed funds,
10y−2y, COT lev) AND `PayoffControls`' toggle chips, which today use `flex flex-wrap` — the
literal cause of the "chart chrome wraps" complaint (`PayoffControls.tsx:54`,
`Overview.tsx:1092` badge row). Wrapping a `flex-wrap` row into a `flex-nowrap overflow-x-auto`
row is the fix for both reported wrap bugs with the same one new `ChipRail` wrapper.

**Example:**
```tsx
<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 pb-1">
  {chips.map((c) => <div key={c.key} className="snap-start shrink-0">{c}</div>)}
</div>
```

### Pattern 3: CSS `order` for visual reflow without DOM move

**What:** Keep MarketRail, the hero+positions column, and the GEX rail as siblings in the SAME
DOM order they are today (screen-reader/tab order untouched); use Flexbox/Grid `order` to make
MarketRail render visually LAST on mobile and visually FIRST on desktop.

**When to use:** Exactly the "buried hero" fix — MarketRail must appear after the hero on phones
without changing its position in the accessibility tree wholesale.

**Example:**
```tsx
<div className="flex flex-col gap-3 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px]">
  <MarketRail className="order-2 lg:order-1" />
  <div className="order-1 lg:order-2 flex min-w-0 flex-col gap-3">{/* hero + table */}</div>
  <div className="order-3 flex flex-col gap-3">{/* GEX rail — unchanged position */}</div>
</div>
```
See Pitfall 6 for the tab-order tradeoff this introduces and why it's acceptable here.

### Anti-Patterns to Avoid

- **CSS-only table→card via `display: block`:** strips table semantics for assistive tech,
  produces fragile pixel alignment. Use Pattern 1's dual-render instead.
- **A new Accordion/Collapsible dependency for MarketRail:** the native `<details>` already
  does this (`MarketRail.tsx:46`) — the bug is one hardcoded `open` attribute, not a missing
  component (see Pitfall 1).
- **A JS carousel library for the chip rails:** native `scroll-snap` covers it with zero JS
  (Pattern 2).
- **Adding a bottom tab bar:** see Decision D-08 — this is scope beyond what was reported.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Table→card responsive transform | CSS `display:block` hack on `<tr>`/`<td>` | A real `<PositionCard>` component fed by the same `Row[]` | Preserves table a11y semantics on desktop; card markup is genuinely different DOM, not a CSS trick [CITED: nngroup.com/articles/mobile-tables] |
| Horizontal chip overflow | JS carousel/swiper library | Native `overflow-x-auto` + Tailwind `snap-x`/`snap-mandatory` | Zero JS, native momentum scroll, already ships in Tailwind core |
| Collapsible MarketRail | New Accordion/Radix component (new dep) | Existing native `<details>`/`<summary>` already in `MarketRail.tsx` | Already in the codebase (ladder rung 2) AND a native platform feature (rung 4) simultaneously — just fix the `open` bug |
| Safe-area / notch padding | JS viewport-detection library | CSS `env(safe-area-inset-*)` | Universally supported native CSS env var [CITED: css-tricks.com/almanac/functions/e/env] |
| Touch-target sizing | Ad hoc inline padding per instance | Extend `Button`'s existing `SIZE_CLASS` lookup map (`Button.tsx:33-36`) with a mobile-appropriate size, gated `lg:` back to `xs` | Reuses the established variant-lookup pattern (ladder rung 2) instead of one-off styles |

**Key insight:** Every "don't hand-roll" here resolves to "this codebase (or the browser) already
has the primitive — the actual bug is a missing/incorrect class, not a missing component."

## Common Pitfalls

### Pitfall 1: `<details open>` hardcodes the collapse away

**What goes wrong:** `MarketRail.tsx:46` renders `<details open ...>` — the boolean `open`
attribute is present unconditionally. Tailwind responsive classes (`lg:hidden` on the
`<summary>`) cannot toggle a DOM boolean attribute, so the rail is ALWAYS expanded regardless of
viewport. This is precisely why the screenshots show it buried on top despite the collapse
markup already existing.
**Why it happens:** The collapse affordance was built (summary hidden at `lg:`) but the actual
open/closed STATE was never made viewport-conditional — an easy gap to miss because the code
"looks" responsive.
**How to avoid:** Drop the hardcoded `open` attribute (defaults to closed, correct for mobile).
For desktop, force content visibility regardless of the attribute's runtime state with a small
scoped CSS rule (e.g. `lg:[&>div]:!block` utility or a two-line custom `@media` rule in
`index.css`) rather than attempting `open:` + `lg:` utility stacking and hoping cascade order
works out — verify the chosen approach visually across 320px→1440px before trusting it (flagged
as Assumption A1, LOW-MEDIUM confidence on the exact utility combination).
**Warning signs:** MarketRail visible-and-expanded on a fresh phone-width load with no user tap.

### Pitfall 2: Analyzer/Journal fixed-pixel grids have no responsive fallback at all

**What goes wrong:** `Analyzer.tsx:759` (`style={{ gridTemplateColumns: "300px 1fr 330px" }}`)
and `Journal.tsx:562` (`grid-cols-[250px_1fr_290px] ... overflow-hidden`) never branch on
viewport. Analyzer's grid forces the page to either overflow horizontally or crush all three
columns into a ~390px viewport; Journal's identical pattern sits inside `overflow-hidden`, which
actively CLIPS the two right columns off-screen — worse than "clipped table," genuinely
unreadable/unusable on any phone width.
**Why it happens:** These grids predate this phase and were never revisited for mobile; unlike
Overview, they have no `lg:` fallback at all — Overview is the exception, not the norm.
**How to avoid:** Port Overview's exact proven pattern (`flex flex-col gap-3 lg:grid
lg:grid-cols-[...]`) to both. Do not invent a second responsive convention.
**Warning signs:** Horizontal body scroll or invisible right-hand panel content on Analyzer/
Journal at <1024px — reproducible today, not hypothetical.

### Pitfall 3: Touch targets under the Apple HIG / Material minimum

**What goes wrong:** `Button.tsx` `SIZE_CLASS.xs` is `"px-[7px] py-0.5 text-[9px]"` (≈2px
vertical padding, 9px text) — used by `PayoffControls`' date-step buttons and toggle chips.
`Shell.tsx`'s nav tabs are `min-h-8 min-w-11` (32px × 44px) — width already meets the 44pt
guideline, **height does not**. [CITED: developer.apple.com/design/human-interface-guidelines/
tab-bars — general iOS tap-target guidance is 44pt minimum]
**Why it happens:** These sizes were tuned for mouse-precision desktop density; no mobile pass
has happened yet.
**How to avoid:** Add a touch-appropriate size variant gated to `<lg:` only (e.g. `p-2 lg:p-0.5`
composite classes, or a new `SIZE_CLASS` entry used only in mobile-only call sites) — never
change the shared `xs`/`sm` defaults desktop already relies on.
**Warning signs:** Mis-taps on the date-projection ‹/› buttons or toggle chips during mobile UAT.

### Pitfall 4: Recharts touch tooltip/crosshair is historically flaky

**What goes wrong:** Recharts has multiple long-standing, still-referenced GitHub issues about
`<Tooltip>` not reliably firing on `touchstart`/`touchmove` in `ComposedChart` (#444, #754,
#743). [CITED: github.com/recharts/recharts/issues/444, /754, /743]
**Why it happens:** Recharts' event wiring historically favored mouse events; touch parity has
improved but is not guaranteed across every chart type/version combination.
**How to avoid:** This phase's constraint freezes chart internals, so no code fix is in scope —
but the crosshair/tooltip-on-tap behavior for `PayoffChart` MUST be spot-checked on a real touch
device (or chrome-devtools' touch emulation) during UAT. If broken, it's a documented follow-up,
not a silent regression to absorb into "it's just how mobile is."
**Warning signs:** Tapping the payoff chart on a phone does nothing / requires a long-press.

### Pitfall 5: iOS Safari sticky-position instability with nested sticky elements

**What goes wrong:** `Shell.tsx` header is `sticky top-0` AND Overview's `PillHeader` is ALSO
`sticky top-0 z-10` nested inside `<main>` — two independent sticky layers. iOS Safari's dynamic
toolbar (which resizes the visual viewport on scroll) has documented bugs misplacing
fixed/sticky elements, worse with nested/stacked sticky contexts. [CITED:
pratikpathak.com/fix-ios-26-safari-web-layouts-are-breaking-due-to-fixed-sticky-position-
elements-getting-misplaced]
**Why it happens:** iOS Safari recalculates the layout viewport as browser chrome shows/hides
during scroll; `position: sticky` offsets are computed against a viewport that keeps changing.
**How to avoid:** Don't add a THIRD sticky layer for the new KPI-priority row inside PillHeader —
keep it in the same sticky container PillHeader already owns rather than nesting another
`sticky`. Test on real iOS Safari (chrome-devtools emulation does not reproduce this bug) during
UAT.
**Warning signs:** Header jitter, header disappearing/misplacing on scroll on an actual iPhone
(not the emulator).

### Pitfall 6: DOM/visual-order mismatch from `order-*` reflow

**What goes wrong:** Pattern 3 makes MarketRail render visually AFTER the hero on mobile while
staying first in DOM/tab order — a keyboard/screen-reader user tabbing through the page still
hits MarketRail's focusable elements before the hero, even though it displays lower on screen.
**Why it happens:** CSS `order` changes paint order, not DOM order — flagged by WCAG 1.3.2
guidance when the mismatch is large.
**How to avoid:** Mitigated by Pitfall 1's fix: MarketRail defaults CLOSED on mobile, so it
contributes exactly ONE focusable element (the `<summary>` toggle) before the hero, not dozens of
rows — the mismatch cost is minimal. Spot-check with keyboard Tab traversal during UAT; don't
apply `order-*` to a MarketRail that's open by default.
**Warning signs:** Tabbing from the nav lands on "Market ▸" before reaching the payoff chart,
which is expected and acceptable; landing on a dozen regime/COT rows before the chart would not
be.

## Code Examples

### Priority KPI row + scroll-snap secondary rail (Overview PillHeader)

```tsx
// Source: pattern synthesis from research (Pattern 2) + existing MetricChip/Overview.tsx code
<div className="sticky top-0 z-10 -mx-4 border-b border-line bg-bg/90 px-4 py-2 backdrop-blur">
  {/* Priority row — always visible, no scroll, mirrors "portfolio value + P&L hero" pattern */}
  <div className="flex items-center gap-2">
    <MetricChip label="SPX" value={...} valueClassName="text-blue" />
    <MetricChip label="net γ /1%" value={...} alert={...} />
    <MetricChip label="VIX" value={...} />
    <MetricChip label="book" value={...} className="ml-auto" />
  </div>
  {/* Secondary rail — scroll-snap, hidden entirely at lg: (folds back into one row there) */}
  <div className="mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto lg:hidden">
    {secondaryChips.map((c) => <div key={c.key} className="snap-start shrink-0">{c}</div>)}
  </div>
  {/* At lg:, render ALL 9 chips in the single existing row — desktop unchanged */}
</div>
```

### Safe-area + dvh footer padding (if a bottom-anchored element is added)

```css
/* Source: css-tricks.com/almanac/functions/e/env, MDN env() */
.bottom-safe {
  padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
}
```

### Analyzer/Journal grid fix (porting Overview's proven pattern)

```tsx
// Before (Analyzer.tsx:759 / Journal.tsx:562) — no responsive fallback:
<div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr 330px" }}>

// After — same convention Overview already uses:
<div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)_330px]">
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Hover-only chart tooltips | Tap-triggered tooltips on touch devices, `trigger="click"` config or hover-plus-touch dual handling | Ongoing across Recharts 2.x→3.x | Confirms this phase should verify (Pitfall 4), not assume, tooltip-on-tap works pre-existing |
| Fixed-height CSS `100vh` for mobile full-bleed sections | `100dvh` (dynamic viewport height), with `100vh` fallback | Broadly supported since ~2023, universal by 2026 | Prevents iOS Safari's toolbar-resize jump; relevant if any full-height mobile section is added |
| Hamburger/off-canvas mobile nav | Bottom tab bar (3-5 items) for primary app sections | Long-standing (Apple HIG, Material) | Supports D-08's "keep top tabs, don't add bottom bar" — the existing 3-tab top bar already avoids the hamburger anti-pattern this guidance warns against |

**Deprecated/outdated:** None specific to this phase's stack — Tailwind v4's CSS-based `@theme`
config (already adopted in `index.css`) and native container queries are current, no migration
needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact Tailwind utility combination for forcing `<details>` content visible at `lg:` regardless of the `open` attribute's runtime state (cascade/specificity ordering) will work as reasoned without a custom CSS rule | Pitfall 1 / Pattern 3 | Low — fallback is a 2-line custom `@media` rule in `index.css`, not a redesign; verify visually at implementation time |
| A2 | WCAG 1.3.2 tolerance for the MarketRail `order-*` reflow is acceptable because it resolves to a single collapsed tab stop | Pitfall 6 | Low-medium — if a reviewer disagrees, the fallback is a physical two-render split (duplicate the hero JSX above/below MarketRail) instead of `order`, a larger diff |
| A3 | Recharts 3.9.2's touch/tap tooltip behavior on `PayoffChart` works acceptably out of the box | Pitfall 4 | Medium — if broken, it's a chart-internals fix explicitly out of this phase's scope; would need a follow-up phase or a scope exception |

## Open Questions (RESOLVED)

1. **Is the `lg:` (1024px) breakpoint the correct "desktop unchanged" cutover, given CONTEXT.md
   literally says 768px?**
   - What we know: the codebase has no `md:` (768px) responsive behavior anywhere today —
     [VERIFIED: grep]. Everything below `lg:` (1024px) already renders identically today.
   - What's unclear: whether the user meant "768px" literally (which would require introducing a
     NEW intermediate tablet breakpoint the code has never had) or used it loosely to mean
     "the current desktop boundary."
   - **Resolution (D-01):** proceed with `lg:` (1024px) as the mobile/desktop split — matches
     existing code, zero regression risk, one convention app-wide. Surface this correction to
     the user at the discuss/plan gate rather than silently reinterpreting a locked constraint;
     does not block planning.

2. **Recharts touch tooltip on `PayoffChart` — does it already work?**
   - What we know: Recharts has a history of touch-tooltip bugs (Pitfall 4); the version in use
     (3.9.2) is recent enough that some of these may be resolved.
   - What's unclear: untested in this session (chart internals are out of scope to modify, but
     behavior needs observing).
   - **Resolution:** verify in the UAT chrome-devtools mobile-emulation pass (Validation
     Architecture below, checklist item); if broken, log a follow-up rather than expanding this
     phase's scope to touch chart internals.

3. **Should MarketRail's fix use a CSS-only `open:`/`lg:` utility combination or a small
   `matchMedia`-driven controlled `open` prop?**
   - What we know: a CSS-only fix keeps the change to class names only (smallest diff, no new
     state/hook); the exact cascade behavior of stacking `hidden open:block lg:block` needs a
     5-minute empirical check (Assumption A1).
   - **Resolution:** default to the CSS-only approach; fall back to a `matchMedia` hook (or a
     handful of lines using `window.matchMedia("(min-width: 1024px)")`) only if the CSS
     combination doesn't reliably force-open at desktop during implementation spot-checks.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| chrome-devtools MCP (mobile emulation) | Manual UAT checklist (390px viewport spot-checks) | ✓ | — (skill installed) | Physical device test if emulation and real iOS Safari diverge (Pitfall 5) |
| Vite dev server (`bun run dev`) | Local UI iteration | ✓ | per CLAUDE.md | — |
| Vitest (`bun run test`) | Automated breakpoint-conditional assertions | ✓ | `4.1.8` [VERIFIED: root package.json devDependencies] | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.8` + `@testing-library/react` `16.3.0`, jsdom environment [VERIFIED: `apps/web/vitest.config.ts`, package.json] |
| Config file | `apps/web/vitest.config.ts` (workspace-aliased) |
| Quick run command | `bunx vitest run apps/web/src/screens/Overview.test.tsx` |
| Full suite command | `bun run test` (root, runs `vitest run` across the workspace) |

### Phase Requirements → Test Map

No REQ IDs exist yet for Phase 35 (ROADMAP.md lists `Requirements: TBD`). Provisional IDs below
map to CONTEXT.md's Acceptance (UAT) bullets for the planner to carry into REQUIREMENTS.md;
renumber if the discuss/plan step assigns different IDs.

| Req ID (provisional) | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOBILE-01 | First screen at <1024px shows nav + priority KPI row + hero/positions summary, no scroll | manual | chrome-devtools 390px emulation checklist | ❌ Wave 0 |
| MOBILE-02 | No horizontal scroll/clipping anywhere on Overview/Analyzer/Journal at <1024px | manual + smoke | chrome-devtools checklist + `document.body.scrollWidth === window.innerWidth` smoke assertion | ❌ Wave 0 |
| MOBILE-03 | Ticker chips condensed (priority row + scroll rail), not a 4-row wrap | unit (jsdom class assertion) | `vitest run Overview.test.tsx` — asserts secondary-rail wrapper has `overflow-x-auto`/`lg:hidden` classes present | ❌ Wave 0 |
| MOBILE-04 | MarketRail collapsed by default at <1024px, positioned after hero (DOM order unchanged, visual order later) | unit (jsdom: absence of `open` attribute) + manual (visual order) | `vitest run MarketRail.test.tsx` — asserts `<details>` has no `open` attribute by default | ❌ Wave 0 (extend existing `MarketRail.test.tsx`) |
| MOBILE-05 | Positions render as tap-expandable cards at <1024px, table at ≥1024px | unit (jsdom class assertion on both branches) | `vitest run Overview.test.tsx` — asserts `hidden lg:table` / `lg:hidden` wrapper pair both render in the DOM (jsdom doesn't evaluate media queries, only class presence) | ❌ Wave 0 |
| MOBILE-06 | Desktop (≥1024px) visually unchanged | manual (spot-check) | chrome-devtools 1280px+ emulation, side-by-side pre/post screenshot | manual only |

### Sampling Rate
- **Per task commit:** `bunx vitest run <changed test file>`
- **Per wave merge:** `bun run test` (full workspace suite)
- **Phase gate:** full suite green + the manual chrome-devtools 390px/1024px+ checklist (MOBILE-01/02/06 have no jsdom equivalent — jsdom has no real layout engine, so wrap/clip/scroll behavior is only verifiable by an actual rendered viewport) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Extend `apps/web/src/screens/MarketRail.test.tsx` — assert `<details>` renders WITHOUT
  `open` by default (currently untested; this is the exact bug in Pitfall 1)
- [ ] Extend `apps/web/src/screens/Overview.test.tsx` — assert both the card-list and table
  branches are present with the correct `hidden`/`lg:hidden` class pairing
- [ ] No new framework/config needed — existing Vitest + jsdom setup covers all automatable
  class/attribute assertions; layout-in-viewport claims (wrap, clip, order, touch-target size)
  are jsdom-blind by construction and MUST go through the manual chrome-devtools checklist below

### Manual UAT checklist (jsdom cannot verify these — chrome-devtools mobile emulation required)
- [ ] 390px width: no horizontal body scroll on Overview, Analyzer, Journal
- [ ] 390px width: MarketRail starts collapsed; tapping "Market ▸" expands it below the hero
- [ ] 390px width: positions render as cards; tapping a card reveals greeks
- [ ] 390px width: ticker priority row visible without scroll; secondary chips scroll/snap
  horizontally
- [ ] 390px width: PayoffControls chips scroll instead of wrapping
- [ ] 390px width: tap the payoff chart — tooltip/crosshair responds (Pitfall 4/OQ2)
- [ ] 1024px+ width: layout is pixel-identical to the pre-phase screenshot baseline (MOBILE-06)
- [ ] Keyboard Tab traversal at 390px: MarketRail's one collapsed tab-stop appears before the
  hero in tab order (expected per Pitfall 6), full rail content does not
- [ ] Real iOS Safari (not emulator) if available: header does not jitter/misplace on scroll
  (Pitfall 5)

## Security Domain

This phase is presentation/layout-only: no new inputs, no new endpoints, no auth/session
changes, no data-layer changes (CONTEXT.md constraint: "Data layer untouched"). No ASVS category
in the ≥Level-1 set applies to a CSS/component-composition change with no new trust boundary.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | unchanged |
| V3 Session Management | no | unchanged |
| V4 Access Control | no | unchanged |
| V5 Input Validation | no | no new inputs (all data already flows through existing typed hooks/contracts) |
| V6 Cryptography | no | unchanged |

No known threat patterns apply — no new attack surface is introduced.

## Sources

### Primary (HIGH confidence — direct codebase verification)
- `apps/web/src/screens/Overview.tsx` — PillHeader, PositionsTable, MarketRail composition, `lg:grid` pattern
- `apps/web/src/screens/MarketRail.tsx` — `<details open>` collapse mechanism
- `apps/web/src/screens/Analyzer.tsx:759`, `apps/web/src/screens/Journal.tsx:562` — fixed-pixel grids with no responsive fallback
- `apps/web/src/components/system/Button.tsx`, `apps/web/src/components/Shell.tsx` — touch-target sizes
- `apps/web/src/components/charts/PayoffChart.tsx`, `PayoffControls.tsx` — chart responsiveness + chrome wrap source
- `apps/web/index.html`, `apps/web/src/index.css` — viewport meta, tokens, no existing safe-area handling
- `apps/web/package.json`, root `package.json`, `apps/web/vitest.config.ts` — verified versions

### Secondary (MEDIUM confidence — WebSearch cross-referenced with official/authoritative sources)
- [NN/g — Mobile Tables](https://www.nngroup.com/articles/mobile-tables/) — priority+ pattern, card transform guidance
- [Apple HIG — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) — bottom-nav thumb-zone rationale, tab count guidance
- [MDN — CSS Scroll Snap](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap) — scroll-snap-type mechanics
- [Tailwind CSS — Responsive Design](https://tailwindcss.com/docs/responsive-design) / [scroll-snap-type](https://tailwindcss.com/docs/scroll-snap-type) — mobile-first utility confirmation
- [CSS-Tricks — env()](https://css-tricks.com/almanac/functions/e/env/) — safe-area-inset usage
- [Recharts — Responsive design](https://recharts-recharts.mintlify.app/concepts/responsive-design) / [ResponsiveContainer](https://recharts.github.io/en-US/api/ResponsiveContainer/) — confirms `ChartContainer`'s existing pattern is correct, no change needed

### Tertiary (LOW confidence — WebSearch only, informational)
- [pratikpathak.com — iOS 26 Safari sticky bug](https://pratikpathak.com/fix-ios-26-safari-web-layouts-are-breaking-due-to-fixed-sticky-position-elements-getting-misplaced/) — real-device verification recommended, not just emulation
- Recharts touch-tooltip GitHub issues (#444, #754, #743) — historical, version-dependent, needs live spot-check (Pitfall 4)
- Lollypop/Medium trading-app-design articles — general pattern color, not load-bearing on any specific decision

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, every primitive verified already present in the repo
- Architecture (breakpoint correction, grid bugs, `<details>` bug): HIGH — grep/read-verified against actual source, not inferred
- UX patterns (KPI hero, card transform, scroll-snap rail, bottom-nav-vs-top): MEDIUM — CITED from NN/g, Apple HIG, MDN, Tailwind docs; broadly consistent across multiple independent sources
- CSS-cascade specifics for the `<details>`/`open:`/`lg:` interaction (Pitfall 1): LOW-MEDIUM — flagged as Assumption A1, needs a 5-minute visual check at implementation time, not a planning blocker
- Pitfalls requiring live device/touch verification (Recharts tooltip, iOS Safari sticky): MEDIUM — documented, real, but outcome not verifiable without a rendered browser (covered by the manual UAT checklist, not jsdom)

**Research date:** 2026-07-11
**Valid until:** 30 days (stable stack — Tailwind/Recharts/native CSS APIs, no fast-moving dependency here)
