---
phase: 35
slug: mobile-experience-redesign-the-phone-view-is-desktop-panels-
status: final
shadcn_initialized: true
preset: base-nova (neutral base, lucide icons) — detected from apps/web/components.json, not re-run this phase
created: 2026-07-11
---

# Phase 35 — UI Design Contract

> Responsive re-composition of three existing screens (Overview, Analyzer, Journal) below
> the `lg:` (1024px) breakpoint. No new colors, fonts, type sizes, or dependencies — this
> phase reflows existing MORAI-design-system primitives (`Panel`/`PanelHeading`/`Stat`/
> `MetricChip`/`Button`) into a mobile-first stack, fixes two real bugs (`MarketRail`'s
> hardcoded `open`, Analyzer/Journal's fixed-pixel grids with zero responsive fallback),
> and adds exactly two new presentational components (`PositionCard`, `ChipRail`). Desktop
> (`≥1024px`) is pixel-identical throughout — every mobile change is `lg:`-reverted to
> today's exact classes.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `apps/web/components.json`) |
| Preset | `base-nova`, baseColor `neutral`, `cssVariables: true` — unchanged this phase |
| Component library | radix (via shadcn `ui/*` — `Badge`, `Tooltip`, `Dialog`, already in use) |
| Icon library | lucide (declared in `components.json`) — **not used this phase**; every new affordance (`‹›▸▾`) is an existing text glyph, matching current `MarketRail`/`PayoffControls`/`Journal` conventions |
| Font | Space Grotesk (`font-display`, headings/labels) / JetBrains Mono (`font-mono`, all numerals) |

No `shadcn add` needed. No new registries, no new npm dependencies (CONTEXT.md constraint,
confirmed zero-install by RESEARCH's Standard Stack). Every mechanism below is native CSS
(Tailwind v4 utilities, `<details>`, `scroll-snap`, `display: contents` + `order`,
`env()`, `100dvh`) or a `className`-override on an existing molecule
(`apps/web/src/components/system/index.tsx`, `Button.tsx`).

---

## Spacing Scale

Project's existing 4px-multiple scale, expressed as raw Tailwind arbitrary values — no
named tokens (matches `Panel`/`MetricChip`/`RegimeBoard` precedent). This phase's new
values, all multiples of 4 except where noted:

| Token | Value | Usage |
|-------|-------|-------|
| touch target (new) | 44px (`min-h-11`/`h-11`) | `<lg:` only — position-card checkbox hit-area, `PayoffControls` date-step/Today/toggle buttons, `Shell` nav tabs |
| priority-chip padding (new, mobile-only) | 8px/4px (`px-2 py-1`, down from `px-3 py-1.5`) | `MetricChip` in the priority KPI row, `<lg:` only via `className` override — `lg:` reverts to the unchanged `px-3 py-1.5` |
| priority-chip gap (new, mobile-only) | 4px (`gap-1`, down from `gap-1.5`) | Same override, same `lg:` revert |
| card padding | 12px (`p-3`) | `PositionCard` — matches existing `Panel`'s `p-3`, no new value |
| card internal gap | 8px (`gap-2`) | `PositionCard` rows |
| chip-rail item gap | 8px (`gap-2`) | `ChipRail` (shared by PillHeader secondary rail + `PayoffControls`) |
| chip-rail edge peek | ~24px (`pr-6` on the scroll container) | Deliberately less than one chip width so the next chip visibly peeks — the "more to scroll" affordance, zero JS |

Exceptions: none beyond the above — every value is an existing Tailwind spacing step
already in use elsewhere in the codebase (`h-11`/`min-w-11` already exists in `Shell.tsx`'s
nav tabs; `p-3`/`gap-2` already exist in `Panel`/positions rows).

---

## Typography

Reuses the system's existing type scale exactly — **no new sizes, no new weights**. Every
label/value pair below is a `Stat`, `SectionLabel`, or raw class string already declared
somewhere in `Overview.tsx`/`PositionsTable`/`HeldPositionsPanel.tsx`.

| Role | Size | Weight | Where (reused, not new) |
|------|------|--------|---------------------------|
| Card label (position name) | 14px (`text-sm`) | 700 (`font-bold`) | `font-display text-sm font-bold` — same as `HeldPositionsPanel`'s `row.name` |
| Card meta (expiry/DTE) | 10-11px | 400 | Same classes as the desktop table's expiry cell (`text-[11px] text-muted-foreground` / `text-[9px] text-dim`) |
| Card stat label | 10px | 600 | `Stat`'s existing label styling, unchanged (`font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase`) |
| Card stat value | mono, tabular-nums | 400/600 (sign-colored) | `Stat`'s existing value styling, unchanged |
| Chip label/value | 10px / 16px | 600 / 700 | `MetricChip`, unchanged sizes (only padding is overridden, see Spacing) |

---

## Color

All colors are the existing LOCKED palette in `apps/web/src/index.css` (`@theme`). **No new
hex values, no new accent usage** — this phase is layout/presentation only, not a re-skin
(CONTEXT.md constraint).

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--color-bg #0a0e14` / `--color-panel #0f1521` | App background, `Panel` surface — unchanged |
| Secondary (30%) | `--color-raise #161d2b` / `--color-line #1b2433` / `--color-line2 #27313f` | Card borders, chip backgrounds, rail dividers — unchanged |
| Accent (10%) | `--color-violet #a78bfa` (active/focus), `--color-up #26a69a` / `--color-down #ef5350` (P&L sign), `--color-amber #f0b429` (warning/AH) | Unchanged usage — this phase never introduces a new accent context, only relocates existing accented elements (verdict chips, P&L sign, live-badge dots) into new card/rail layouts |
| Destructive | `--color-down #ef5350` | Unchanged — negative P&L, STOP verdicts; no new destructive UI action this phase |

Accent reserved for (unchanged from today — nothing new claims accent this phase):
- P&L sign (`text-up`/`text-down`) on card Net val / Unreal
- Verdict chip severity (`VerdictChip`, unchanged component, reused as-is inside the card)
- Focus ring (`focus-visible:ring-violet`) on the new tappable card and `ChipRail` items
- Live-cell flash / freshness dots (`bg-up`/`bg-amber`) — unchanged, same as desktop

---

## Copywriting Contract

No new user-facing copy strings beyond what's structurally required by the new
components — no new empty/error states are introduced (all three screens' existing
loading/error/empty branches are reused verbatim; only their container reflows).

| Element | Copy |
|---------|------|
| Primary CTA | Not applicable — no new interactive action this phase (tap-to-expand reuses `onSelectRow`, checkbox reuses `onToggleExcluded`) |
| Empty state | Not applicable — existing branches unchanged (`PositionsTable`'s "No open positions…", `exitsBody`'s cold-start/empty copy, Journal's "No journal history yet.") |
| Error state | Not applicable — unchanged (`exitsBody`'s "Couldn't load exit verdicts." + Retry) |
| Destructive confirmation | Not applicable — no destructive action introduced |
| MarketRail collapsed summary (existing, unchanged) | `"Market"` — already the copy at `MarketRail.tsx:48`, kept as-is |
| Position-card checkbox `aria-label` (new, machine-read) | `` `Include ${label} in risk profile & total` `` — identical wording to the existing desktop table's `aria-label` (`Overview.tsx:483`), reused verbatim for consistency |
| `ChipRail` scroll container `aria-label` (new, machine-read) | `"Additional market metrics"` (PillHeader secondary rail) / `"Chart date and series controls"` (PayoffControls) — orients a screen-reader user landing in a horizontally-scrollable region |

---

## Cross-Cutting Responsive Contract

### Breakpoint

Single split at Tailwind `lg:` (1024px) app-wide — per RESEARCH D-01, this is the
codebase's only existing responsive boundary; nothing branches at `md:` (768px) today, so
there is no intermediate behavior to preserve. `<1024px` = mobile surface (this phase's
scope). `≥1024px` = desktop, pixel-identical.

### Sticky strategy — one sticky element max below `lg:`

**Decision (resolves Pitfall 5, not covered by RESEARCH beyond "don't add a third
layer"):** `Shell.tsx`'s header (`sticky top-0 z-50`, 48px, all three screens) is the ONLY
sticky element below `lg:`. Overview's `PillHeader` (`sticky top-0 z-10`) becomes
`static lg:sticky lg:top-0 lg:z-10` — normal in-flow content at `<lg:`, exactly today's
sticky behavior unchanged at `≥lg:`. This is the minimal fix because the new priority KPI
row lives inside `PillHeader`'s existing container (no new wrapper), and being first-in-flow
already satisfies "no scroll needed to see the KPI strip" without needing sticky
positioning at all at mobile widths — sidesteps the iOS Safari nested-sticky bug entirely
on the surface where it actually bites (dynamic toolbar resize), with zero desktop risk.

### Safe-area insets

`AuthExpiredBanner.tsx` is the one fixed-bottom element in the app. Both its `role="alert"`
divs (the red `isExpired` branch and the amber `isMarketExpired`/`isNearExpiry` branch) are
**100% inline `style` objects — no `className` at all** — so the fix edits the inline style
directly (a Tailwind class would never win against an inline style on the same element).
Split the existing `padding: "8px 16px"` into sides and add safe-area clearance to the
bottom only, identically in both branches (`AuthExpiredBanner.tsx:73` and `:109`):

```ts
// before
padding: "8px 16px",

// after
paddingTop: "8px",
paddingLeft: "16px",
paddingRight: "16px",
paddingBottom: "max(8px, env(safe-area-inset-bottom))",
```

No other bottom-anchored element exists to treat.

### `100dvh` correction

`Shell.tsx`'s `<main className="min-h-[calc(100vh-48px)]">` changes to
`min-h-[calc(100dvh-48px)]` — prevents iOS Safari's toolbar-resize height jump. Applies at
all widths (harmless/universal, not mobile-gated); zero visual difference on desktop or in
any browser without a resizing dynamic toolbar.

### Touch targets (≥44px below `lg:`)

Per Pitfall 3 — three call sites, each `lg:`-reverted to today's exact desktop size:

1. **`Shell.tsx` nav tabs** — `min-h-8 min-w-11` → `min-h-11 min-w-11 lg:min-h-8` (width
   already met 44px; only height was short).
2. **`PayoffControls` date-step (`‹`/`›`), `Today`, and toggle chip buttons** — add a new
   `ButtonSize` entry to `Button.tsx`'s `SIZE_CLASS` map (extends the existing
   variant-lookup pattern per RESEARCH's Don't-Hand-Roll table, rather than one-off inline
   styles):
   ```ts
   const SIZE_CLASS: Record<ButtonSize, string> = {
     xs: "px-[7px] py-0.5 text-[9px]",
     sm: "px-2.5 py-1 text-[10px]",
     touch: "min-h-11 px-3 py-1.5 text-[11px] lg:min-h-0 lg:px-[7px] lg:py-0.5 lg:text-[9px]",
   };
   ```
   `PayoffControls` passes `size="touch"` on its five buttons instead of the default `xs`;
   every other `Button` call site in the app is untouched (still defaults to `xs`).
3. **`PositionCard` checkbox** — wrapped in a `min-h-11 min-w-11 flex items-center
   justify-center` label/div so the real (invisible) hit-area is 44px even though the
   visual checkbox stays its native small size — same "generous invisible padding around a
   small control" pattern, not a new checkbox component.

### Table ↔ card accessibility strategy (per NN/g guidance, RESEARCH Pattern 1)

The desktop `<table>` and the mobile `<PositionCard>` list are genuinely different DOM (not
a CSS transform of the same markup). They MUST be paired with `display:none`-based hiding
(Tailwind `hidden lg:table` / `flex flex-col lg:hidden`), **never** `sr-only`/
`visually-hidden`/`opacity-0` tricks — `display:none` is the only technique that removes an
element from the accessibility tree entirely. Getting this wrong means a mobile
screen-reader user hears every position announced TWICE (once as a card, once as a phantom
`<table>` row that's invisible but still AT-reachable).

### `ChipRail` — one shared scroll-snap primitive, two call sites

New file: `apps/web/src/components/system/ChipRail.tsx`. Native CSS only (no JS carousel):

```tsx
export function ChipRail({
  children,
  ariaLabel,
  className,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
}): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex snap-x snap-mandatory gap-2 overflow-x-auto pr-6 pb-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "lg:flex-wrap lg:overflow-visible lg:snap-none lg:pr-0 lg:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
```
Each child chip/button gets `snap-start shrink-0` added at its call site. The `lg:` triplet
(`flex-wrap overflow-visible snap-none`) is a byte-for-byte revert to today's desktop
`flex flex-wrap` behavior — not "probably never wraps at desktop width," a guaranteed
revert, satisfying the pixel-identical constraint with certainty.

Two call sites:
- **PillHeader secondary rail** (`<lg:` only — at `lg:` all 10 chips render unwrapped in
  the single existing row, `ChipRail` isn't mounted there at all).
- **`PayoffControls`' toggle/date row** (mounted at all widths — the `lg:` triplet handles
  the desktop revert internally).

---

## Component Specifications

### 1. Overview — mobile stack order

**File:** `apps/web/src/screens/Overview.tsx`. Structurally already the closest to correct
(RESEARCH: existing `flex-col lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px]` skeleton,
three direct siblings) — Pattern 3's `order-*` applies cleanly, no restructure needed.

```tsx
<div className="flex flex-col gap-3 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:items-start">
  <MarketRail className="order-2 lg:order-1" />
  <div className="order-1 lg:order-2 flex min-w-0 flex-col gap-3">
    {/* payoff hero Panel, positions Panel, exitsBody — unchanged internal order */}
  </div>
  <div className="order-3 flex flex-col gap-3">
    <GexRail gex={gex} railGreeks={railGreeks} />  {/* unchanged — see "GEX rail" below */}
  </div>
</div>
```

Resulting mobile visual order (top to bottom): **priority KPI row → secondary chip rail →
payoff hero (chart) → positions (cards) → unlinked-verdicts panel (if any) → MarketRail
(collapsed, one line) → GEX rail (4 panels, stacked, uncollapsed)**.

**GEX rail decision (not covered by RESEARCH — CONTEXT only diagnosed MarketRail as
"buried"):** the GEX rail stays fully expanded, not collapsed, at mobile. Rationale: (a)
CONTEXT's screenshots and complaints named MarketRail (regime/rates/COT/health — ambient
market context) as the buried offender, never the GEX rail (dealer walls/greeks — directly
tied to the user's own risk); (b) its charts (`GammaProfile`, `GexBars`) already render via
`ResponsiveContainer`, needing no collapse mechanism to be usable; (c) adding a second
`<details>` collapse where none was diagnosed as broken is unrequested scope (ladder rung
1). It already renders LAST in DOM/visual order at mobile with zero changes (see Journal's
identical reasoning below for why "already last" needs no `order-*`).

**PillHeader split** (KPI strip decision):

Priority row (SPX spot, net γ/1%, VIX, book P&L) renders as a **single row**, not a 2×2
grid — a single row costs less vertical height (the scarce resource for "no scroll needed"
on a phone), and each of the four values is short enough to fit once `MetricChip` gets the
compact mobile padding above. These four were chosen because each answers a different
question the other three can't: SPX spot is the anchor every other number is relative to;
net γ/1% is the single highest-value regime signal (drives AMPLIFY/stable); VIX is the
universal ambient-vol context; book P&L is the literal, explicit answer to CONTEXT's "how
am I doing" acceptance bar. The remaining 6 (0DTE γ, γ flip, VVIX, Fed funds, 10y−2y, COT
lev — RESEARCH's D-06 said "5," an off-by-one against the actual 10-chip `PillHeader`;
corrected here) move into the `ChipRail` secondary row below it, non-sticky, scroll-snap,
peek-cut at the right edge to signal "more."

```tsx
function PillHeader(...): React.ReactElement {
  return (
    <div className="static lg:sticky lg:top-0 lg:z-10 -mx-4 border-b border-line bg-bg/90 px-4 py-2 lg:backdrop-blur">
      <div className="flex flex-nowrap items-center gap-1 lg:hidden">
        <MetricChip label="SPX" value={...} className="px-2 py-1 gap-1" />
        <MetricChip label="net γ /1%" value={...} className="px-2 py-1 gap-1" />
        <MetricChip label="VIX" value={...} className="px-2 py-1 gap-1" />
        <MetricChip label="book" value={...} className="ml-auto px-2 py-1 gap-1" />
      </div>
      <ChipRail ariaLabel="Additional market metrics" className="mt-2 lg:mt-0 lg:hidden">
        {/* 6 secondary MetricChips, snap-start shrink-0 each */}
      </ChipRail>
      <div className="hidden lg:flex lg:flex-wrap lg:items-center lg:gap-2">
        {/* all 10 chips, exactly today's markup, unchanged */}
      </div>
    </div>
  );
}
```

**Chart chrome** (`Risk profile — combined book` Panel):

- The freshness-chip pair ("GEX as of…", "mark as of…") is already wrapped in its own
  `flex flex-wrap items-center gap-2` badge cluster (`PanelHeading`'s `badge` slot) — it
  drops to its own line below the title at `<lg:` (already achievable with the existing
  `flex-wrap` on `PanelHeading`'s title row, no new class needed there). The two chips
  themselves stay single-line internally (`whitespace-nowrap`, already implicit from their
  fixed content) and fit side by side in one row on a 390px viewport without needing
  `ChipRail`.
- The `"view-only · Analyzer →"` action text moves to `hidden lg:inline` — it's redundant
  wayfinding at mobile (the same destination is one tap away via `Shell`'s nav tabs on both
  mobile and desktop); removing it loses no functionality and saves a line of chrome
  (ladder rung 1: it doesn't need to exist on a width-constrained screen with an already
  reachable nav).
- `PayoffControls`'s row becomes a `ChipRail` (date buttons get `size="touch"`, the whole
  strip scrolls together as one unit rather than splitting date-vs-toggles into two
  mechanisms — simplest working option, per D-07).
- Chart full-bleed: the `PayoffChart` wrapper gains `-mx-3 lg:mx-0` (negates `Panel`'s
  `p-3` horizontal inset only, at `<lg:`) — same pattern already used for `PillHeader`'s
  `-mx-4`. **No aspect-ratio change needed anywhere** — `PayoffChart.tsx:688` already sets
  `style={{ width: "100%", aspectRatio: SVG_W/SVG_H }}` on the shadcn `ChartContainer` (which
  wraps Recharts' `ResponsiveContainer` internally); this already IS the correct responsive
  aspect-ratio pattern, chart-internals-frozen constraint fully respected.

**Positions:** table (`hidden lg:table`) / card list (`flex flex-col gap-2 lg:hidden`) — see
`PositionCard` spec below.

### 2. MarketRail — the `open` bug fix (D-02)

**File:** `apps/web/src/screens/MarketRail.tsx`. One attribute change plus the `order-*`
prop threading:

```tsx
export function MarketRail({ className }: { className?: string }): React.ReactElement {
  return (
    <details className={cn("group flex flex-col gap-3 lg:[&>div]:!block", className)} data-testid="market-rail">
      <summary className="cursor-pointer list-none font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase lg:hidden lg:pointer-events-none">
        Market
      </summary>
      <div className="mt-3 flex flex-col gap-3 lg:mt-0">
        <RegimeBoard dense />
        <CotCard />
        <Panel><PanelHeading title="System health" /><SystemHealth /></Panel>
      </div>
    </details>
  );
}
```
- Drop the hardcoded `open` attribute (defaults closed — correct for mobile).
- Force-visible at desktop regardless of runtime `open` state via a scoped `lg:[&>div]:!block`
  utility (Assumption A1's flagged approach — **spot-check visually across 320px→1440px
  during implementation**; fall back to a `matchMedia`-driven controlled `open` prop per
  RESEARCH's Open Question 3 resolution if the cascade doesn't hold).
- `className` prop added so `Overview.tsx` can pass `order-2 lg:order-1`.

### 3. `PositionCard` — new component

**File:** `apps/web/src/components/PositionCard.tsx` (new, per RESEARCH's project structure).

Fed the SAME `Row` (from `buildRows`) the desktop `<table>` renders — no new data shape,
no second source of truth.

```tsx
export function PositionCard({
  row, spot, liveGreeks, liveStatus, ivNa, verdict, marketSession,
  expanded, onSelect, included, onToggleIncluded,
}: PositionCardProps): React.ReactElement {
  const { netVal, unreal, greeks: g, liveTs } = resolveLivePositionRow(row.legs, spot, liveGreeks);
  return (
    <div
      data-testid={`position-card-${row.key}`}
      className={cn(
        "rounded-lg border border-line bg-transparent p-3 transition-opacity",
        !included && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            checked={included}
            onChange={() => { onToggleIncluded(row.key); }}
            aria-label={`Include ${row.label} in risk profile & total`}
            className="accent-blue"
          />
        </label>
        <button
          type="button"
          onClick={() => { onSelect(row.key); }}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="font-display text-sm font-bold text-txt">{row.label}</span>
              {ivNa && <Badge variant="outline" className="border-amber/50 px-1 py-0 font-mono text-[9px] text-amber">IV n/a</Badge>}
            </span>
            {verdict !== null && <VerdictChip row={verdict} marketSession={marketSession} />}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-dim">
            {row.expiry.line1} · {row.expiry.line2}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Stat label="Net val" value={usd(netVal)} />
            <Stat
              label="Unreal"
              value={unreal === null ? "—" : signedUsd(unreal)}
              valueClassName={unreal === null ? "text-dim" : signClass(unreal)}
            />
          </div>
          {expanded && (
            <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line/40 pt-2">
              <Stat label="Δ" value={signed(g.delta)} valueClassName={signClass(g.delta)} />
              <Stat label="Γ" value={signed(g.gamma)} />
              <Stat label="Θ/d" value={signedUsd(g.theta)} valueClassName={signClass(g.theta)} />
              <Stat label="Vega" value={signedUsd(g.vega)} valueClassName={signClass(g.vega)} />
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
```

- Expand trigger is a real `<button>` (native keyboard support for free — Enter/Space
  toggle — rung 4, no hand-rolled `role="button"`/`onKeyDown`). Checkbox sits OUTSIDE the
  button as a sibling (nested interactive elements are invalid HTML), mirroring the desktop
  table's `stopPropagation` split.
- `expanded` state, `onSelect` handler: **reuses `expandedRowKey`/`onSelectRow` verbatim**
  (D-05) — `Overview.tsx` passes the same `selectedRowKey`/`handleSelectRow` it already
  threads into `PositionsTable`. No second expand mechanism.
- `ivNaByRowKey`, `verdictByRowKey`, `included`/`onToggleExcluded` — same props
  `PositionsTable` already receives, just fed into `PositionCard` per-row instead.
- Live-cell flash/staleness (`.live-cell`, `.live-cell-flash`) is **not** ported to the card
  — the desktop table's per-cell flash-on-tick animation doesn't translate to a card
  layout with fewer, larger value blocks; the card simply re-renders with the latest
  `resolveLivePositionRow` output each tick (same data freshness, no flash chrome). This is
  a deliberate simplification — the flash exists to draw the eye to ONE changed cell among
  nine columns; a 2-value card doesn't have that scanning problem.

Mount:
```tsx
<table className="hidden w-full lg:table">{/* existing markup, unchanged */}</table>
<div className="flex flex-col gap-2 lg:hidden">
  {rows.map((r) => {
    const verdict = verdictByRowKey.get(r.label) ?? null;
    return (
      <PositionCard
        key={r.key}
        row={r}
        verdict={verdict}
        expanded={selectedRowKey === r.key && verdict !== null}
        {...sharedProps}
      />
    );
  })}
</div>
```

### 4. Analyzer — mobile stack order

**File:** `apps/web/src/screens/Analyzer.tsx:750-853`. Structurally UNLIKE Overview: today's
desktop shape is two stacked blocks (`ScoringMethodologyPanel` full-width, THEN a 3-column
`grid` below it, `rail`/`center`/`right` nested one level inside that second block) — so
Pattern 3's simple `order-*` (siblings only) can't reach across both nesting levels on its
own.

**Decision (not covered by RESEARCH beyond "port the `lg:grid` convention" — the specific
reorder mechanism is this document's call, revised per checker feedback):** the desktop
constraint is pixel-identical **AND DOM-identical** — no JSX/element reordering, no new
wrapper restructuring that would move where `railBody`/`ScoringMethodologyPanel`/chart/term/
`RightColumn` sit in the tree. `order-*` alone can't reach `rail`/`center`/`right` because
they're a level deeper than `scorecard`; the fix is `display: contents` on the inner grid
container at `<lg:` only — a native CSS technique that removes a box from the layout tree
**without moving its children in the DOM**, promoting `rail`/`center`/`right` to be direct
flex-items of the same outer container `scorecard` is already in. At `lg:`, `contents`
reverts to `lg:grid` — the inner container becomes a real box again, restoring today's exact
two-level nesting untouched.

```tsx
<div className="flex flex-col gap-4 bg-bg p-3">
  <div className="order-2 lg:order-none">
    <ScoringMethodologyPanel candidate={selected} ... />
  </div>
  <div className="contents lg:grid lg:grid-cols-[300px_minmax(0,1fr)_330px] lg:gap-4">
    <div className="order-1 lg:order-none">{railBody}</div>
    <div className="order-3 lg:order-none flex min-w-0 flex-col gap-3">
      {/* Risk profile Panel (chart) + Term structure Panel — unchanged internal order */}
    </div>
    <div className="order-4 lg:order-none">
      <RightColumn candidate={selected} gex={...} sizing={...} />
    </div>
  </div>
</div>
```

Resulting **mobile VISUAL order**: rail → scorecard → chart+term → right-column — exactly
the order specified. Resulting **DOM/tab order at every breakpoint**: scorecard, rail,
chart+term, right — **byte-identical to today**, since no element moved in the JSX; only
`order` (a paint-order-only property) and `contents` (a box-tree flattening property, not a
DOM move) changed. At `lg:`, every `order-none`/`lg:grid` reset reproduces today's exact
box tree and visual layout with zero pixel drift.

**This is the SAME class of visual/DOM-order mismatch Pattern 3 already accepts for
Overview's `MarketRail` (Pitfall 6) — documented, not silently introduced.** Correction
from an earlier draft of this document: the claim that Analyzer has "DOM order = visual
order = tab order at both breakpoints" was **wrong** and is retracted here — the mismatch
exists on this screen too, at mobile only. Checked concretely: `ScoringMethodologyPanel`
has zero focusable elements (verified — no `<button>`, `<input>`, or tooltip trigger in
`ScoringMethodologyPanel.tsx`), so today, tabbing from the nav at `<lg:` lands on
`scorecard`'s (empty) tab-stop set first, then `rail`'s paste-box/candidate buttons — i.e.
**zero actual tab stops are displaced or skipped**, even though the visual reading order
puts `rail` above `scorecard`. This has no practical keyboard-navigation cost today, but is
a WCAG 1.3.2-relevant mismatch if `ScoringMethodologyPanel` ever gains an interactive
element — flag for re-audit if that changes.

Chart chrome inside the `center` block gets the same `PayoffControls` → `ChipRail` swap and
`-mx-3 lg:mx-0` full-bleed treatment as Overview (same component, same fix, both call sites
free per D-07/D-10). No `index.css` addition needed for this mechanism — `contents` and
`order-*` are both built-in Tailwind utilities.

### 5. Journal — mobile stack order

**File:** `apps/web/src/screens/Journal.tsx:562`. Structurally like Overview (already one
`grid`, three direct siblings: trade list / lifecycle / reactive rail) — but unlike
Overview, **no reorder is needed at all.** Decision (RESEARCH left this open — "decide from
the screen's actual content"): Journal is inherently a master-detail flow — you must pick a
trade from the list before a lifecycle/detail view means anything, so "list → detail →
detail-support" is both the only coherent mobile order AND already the exact left-to-right
DOM order of today's three columns. Zero `order-*` classes needed; only the responsive
mechanics change:

```tsx
<div className="flex flex-col gap-3 p-3 lg:grid lg:h-full lg:grid-cols-[250px_minmax(0,1fr)_290px] lg:overflow-hidden">
  <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">{/* Trades */}</div>
  <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">{/* Lifecycle */}</div>
  <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">{/* Reactive rail + Notes */}</div>
</div>
```
`h-full`/`overflow-hidden`/per-column `overflow-y-auto`/`min-h-0` — today's "three
independently-scrolling panes within a fixed viewport" desktop pattern — all move behind
`lg:`. At `<lg:`, the page uses normal document flow/scroll (no clipping trap, fixing
Pitfall 2's "worse than clipped table" bug), and each section's natural height is used.

### 6. Registry / component sourcing

No new shadcn `ui/*` primitive is required anywhere in this phase — `Badge`, `Dialog`,
`Tooltip` (already used by `PositionsTable`/`HeldPositionsPanel`) are reused as-is inside
`PositionCard`. `ChipRail` and `PositionCard` are new MORAI-system files
(`components/system/`, `components/`), not registry installs.

---

## Wireframes

### Overview — mobile, first screen (no scroll, ~390×700px viewport)

```
┌───────────────────────────────────────────┐
│ MOR·AI      Overview  Analyzer  Journal    │ ← Shell header, sticky, 48px, z-50 (ONLY sticky element)
├───────────────────────────────────────────┤
│ SPX 5821.4   netγ/1% +$2.1B   VIX 14.32   book +$1,204 │ ← priority row, static, single line
├───────────────────────────────────────────┤
│ ‹0DTEγ›‹γ flip›‹VVIX›‹Fed funds›‹10y-2y›» │ ← ChipRail, scroll-snap, edge-peek "»"
├───────────────────────────────────────────┤
│ RISK PROFILE — COMBINED BOOK               │
│ GEX as of 14:32 · 2m                       │ ← freshness chips, own line, wrap to 2 if needed
│ mark as of 14:35 · 1m                      │
│ ‹ [07/14 ▾] › Today  @exp Walls Profit »  │ ← PayoffControls as ChipRail (touch-sized buttons)
│                                             │
│           (payoff chart, full-bleed)       │
│                                             │
└─────────────────────────────────────────── ┘ ← ~700px cutline: KPI + hero visible, no scroll
```

### Overview — mobile, scrolled

```
┌───────────────────────────────────────────┐
│ POSITIONS                    ● live       │
│ ┌─────────────────────────────────────┐   │
│ │ ☐ 5800P                       HOLD   │   │ ← PositionCard, collapsed
│ │   Aug 8 → Sep 5 · 5d/33d · 28d wide  │   │
│ │   Net val $1,230      +$45 (unreal)  │   │
│ └─────────────────────────────────────┘   │
│ ┌─────────────────────────────────────┐   │
│ │ ☑ 5850C                       ROLL   │   │
│ │   Aug 8 → Sep 5 · 5d/33d · 28d wide  │   │
│ │   Net val $980       −$12 (unreal)   │   │
│ └─────────────────────────────────────┘   │
├───────────────────────────────────────────┤
│ ▸ Market                                   │ ← MarketRail, collapsed, ONE tab-stop
├───────────────────────────────────────────┤
│ DEALER γ PROFILE            (chart)        │
│ GEX BY STRIKE                (chart)       │
│ KEY LEVELS   Call Wall 5850                │
│              γ flip     5820               │
│ NET BOOK GREEKS  Net Δ +120 · Net Γ ...    │
└───────────────────────────────────────────┘
```

### Position card — collapsed vs. expanded

```
Collapsed (tap anywhere but the checkbox to expand):
┌───────────────────────────────────────────┐
│ ☐  5800P                          HOLD     │
│    Aug 8 → Sep 5 · 5d/33d · 28d wide       │
│    Net val $1,230        +$45 (unreal)     │
└───────────────────────────────────────────┘

Expanded:
┌───────────────────────────────────────────┐
│ ☐  5800P                          HOLD     │
│    Aug 8 → Sep 5 · 5d/33d · 28d wide       │
│    Net val $1,230        +$45 (unreal)     │
│ ─────────────────────────────────────────  │
│  Δ +12.4    Γ +0.08    Θ/d −3.20  Vega +8  │
└───────────────────────────────────────────┘
```

### KPI strip (priority row + secondary rail)

```
┌──────────┬──────────────┬──────────┬───────────────┐
│ SPX      │ NET γ/1%     │ VIX      │ BOOK          │  ← priority row, one line, no wrap
│ 5821.4   │ +$2.1B       │ 14.32    │ +$1,204       │
└──────────┴──────────────┴──────────┴───────────────┘
┌────────┬─────────┬───────┬───────────┬────────┬────╮
│ 0DTE γ │ γ flip  │ VVIX  │ Fed funds │ 10y−2y │ COT ⟩  ← ChipRail, scroll-snap, last chip peeks
└────────┴─────────┴───────┴───────────┴────────┴────╯
```

---

## Accessibility Notes

- **`<details>`/`<summary>` (MarketRail):** native semantics — the browser exposes
  expanded/collapsed state to assistive tech automatically via the `open` attribute; no
  manual `aria-expanded` is needed or added. `<summary>` already has an implicit
  disclosure-button role with built-in Enter/Space toggle support.
- **`aria-expanded` (PositionCard):** DOES need to be set manually here because the trigger
  is a plain `<button>`, not a native disclosure element — `aria-expanded={expanded}` on
  the card's expand button, as specified above.
- **Table vs. cards (screen-reader strategy):** `hidden lg:table` / `lg:hidden` (both
  compile to `display:none` at the inactive breakpoint) — this is the ONLY correct pairing;
  `sr-only`/`opacity-0`/`visibility:hidden` tricks would leave the non-visible variant
  reachable by assistive tech, causing every position to be announced twice. See
  Cross-Cutting Contract above.
- **Keyboard tab order (Pitfall 6, Overview):** `MarketRail` stays FIRST in DOM order (only
  visually reordered via CSS `order`), so a keyboard user tabbing from the nav still
  reaches `MarketRail`'s single collapsed `<summary>` before the payoff hero — one extra
  tab stop, not a dozen (mitigated by D-02's default-closed fix). Expected and acceptable
  per RESEARCH's Assumption A2.
- **Keyboard tab order (Analyzer):** same class of mismatch, via `order` + `display:
  contents` (see Component Specifications §4) — DOM/tab order stays `scorecard, rail,
  chart+term, right` at every breakpoint, while mobile VISUAL order is `rail, scorecard,
  chart+term, right`. Verified `ScoringMethodologyPanel` has zero focusable elements, so
  the tab-order/visual-order mismatch costs zero displaced tab stops today — re-audit if
  that component ever gains an interactive element. Journal has NO such mismatch — its
  DOM order already equals its mobile visual order (see its section above), so this
  tradeoff doesn't recur there.
- **Position-card keyboard gap (inherited, not introduced):** today's desktop `<tr
  onClick>` row-expand has no keyboard affordance at all (no `role`, `tabIndex`, or
  `onKeyDown`). `PositionCard` improves on this (real `<button>`, free keyboard support) —
  it is a strict a11y improvement over the desktop pattern it's derived from, not a
  regression. Fixing the desktop table's pre-existing gap is out of this phase's scope
  (presentation/layout-only, not a Table interaction rewrite).
- **Checkbox `aria-label` parity:** `PositionCard`'s checkbox reuses the EXACT
  `aria-label` wording the desktop table already uses (`Include ${label} in risk profile &
  total`) — one label convention, not a new one for mobile.
- **`ChipRail` regions:** each mount gets a distinct `aria-label` (`"Additional market
  metrics"` / `"Chart date and series controls"`) via `role="group"`, so a screen-reader
  user landing inside a horizontally-scrollable region knows what it contains before
  navigating its children.
- **Focus-visible preservation:** no new focus-ring styling anywhere — every new
  interactive element (`PositionCard`'s button, `ChipRail`'s children, the `touch`-sized
  `Button`s) inherits the existing `Button`/native `focus-visible:ring-violet` treatment
  already baked into `Button.tsx`'s `BASE` class or the browser's default outline on plain
  `<input type="checkbox">`/`<button>` elements — nothing overrides or suppresses it.

---

## Acceptance Criteria (chrome-devtools, 390×844 emulation unless noted)

### Overview
- [ ] Load at 390px: priority KPI row (SPX / net γ/1% / VIX / book) visible on one line, no
      wrap, no horizontal page scroll.
- [ ] Secondary chip rail scrolls horizontally (`overflow-x-auto`), snaps per chip, last
      chip visibly peeks at the right edge before any scroll input.
- [ ] Payoff hero chart visible (at least partially) without scrolling past the KPI strip —
      `document.body.scrollWidth === window.innerWidth` (no horizontal overflow anywhere on
      the page).
- [ ] `PayoffControls` row scrolls instead of wrapping; date-step/Today/toggle buttons
      measure ≥44px tall (devtools box-model check).
- [ ] Positions render as `PositionCard`s (`<table>` absent from the accessibility tree —
      `getComputedStyle` shows `display: none`); tapping a card (not the checkbox) expands
      Δ/Γ/Θ/Vega; the checkbox toggles independently without expanding the card.
- [ ] `MarketRail` loads COLLAPSED (`<details>` has no `open` attribute); tapping "▸
      Market" expands it, positioned AFTER positions in scroll order.
- [ ] Tab from the nav: focus lands on `MarketRail`'s `<summary>` before the payoff hero
      (one tab stop, not a dozen).

### Analyzer
- [ ] Load at 390px: no horizontal scroll; VISUAL order top-to-bottom is rail → scorecard →
      chart → term structure → right-column panels.
- [ ] Devtools computed style: the inner rail/chart+term/right container shows
      `display: contents` at 390px (not `grid`, not `flex`, not `block`).
- [ ] Devtools computed style: `scorecard`'s wrapper shows `order: 2`, `rail`'s wrapper
      shows `order: 1` at 390px.

### Journal
- [ ] Load at 390px: no horizontal scroll, no clipped/invisible content (confirms Pitfall
      2's `overflow-hidden` bug is gone) — Trades → Lifecycle → reactive rail stack in
      natural document flow (page scrolls, not three independent inner scroll panes).
- [ ] Selecting a trade from the list scrolls/reveals its lifecycle section below it.

### Cross-cutting
- [ ] Tap the payoff chart on Overview or Analyzer at 390px — tooltip/crosshair responds
      (Pitfall 4/OQ2; if broken, log as a follow-up, not a silent regression).
- [ ] Only ONE sticky element observed while scrolling at 390px (`Shell`'s header);
      `PillHeader` scrolls normally with the page.
- [ ] Real iOS Safari (not emulator, if available): header does not jitter/misplace on
      scroll (Pitfall 5).

---

## Desktop Regression Tripwires (spot-check at 1024px+ and 1440px)

- [ ] `PillHeader`: all 10 chips render in the single existing row, unwrapped; still
      `position: sticky` under `Shell`'s header exactly as before this phase.
- [ ] Positions: `<table>` visible with all 9 columns + checkbox column; `PositionCard`
      list absent from the DOM (`lg:hidden` → `display: none`).
- [ ] `MarketRail`: renders fully expanded as the 320px left column regardless of the
      `<details>` element's runtime `open` state; the `<summary>` "Market" text is not
      visible (`lg:hidden`).
- [ ] Overview 3-column grid: `320px / minmax(0,1fr) / 360px` — unchanged column widths.
- [ ] `PayoffControls`: `flex flex-wrap` row, unchanged desktop wrap behavior (never
      scroll-snap at `≥lg:`).
- [ ] `PayoffControls`' 5 buttons (‹, date input's neighbors, ›, Today, toggle chips)
      render at their EXACT pre-phase classes at `≥lg:` — `px-[7px] py-0.5 text-[9px]`,
      `min-h-0` — after `size="touch"` lands. `SIZE_CLASS.touch`'s `lg:` triplet
      (`lg:min-h-0 lg:px-[7px] lg:py-0.5 lg:text-[9px]`) is a hand-typed duplicate of
      `xs`'s values, one typo from silently drifting — devtools-diff the computed box
      model against an untouched `xs` button on the same page.
- [ ] Analyzer: scorecard banner renders full-width above the 300px/1fr/330px row (via
      `order-none` + the inner container's `lg:grid`) — reproduces today's exact visual
      layout with the exact original DOM nesting.
- [ ] Journal: 250px/1fr/290px three-pane layout with independent per-column scrolling
      inside a fixed-height viewport, exactly as today.
- [ ] `Shell` nav tabs: `min-h-8` (32px) height at `≥lg:`, unchanged.
- [ ] No visual diff in a side-by-side screenshot comparison against the pre-phase
      baseline at 1280px (MOBILE-06).

---

## What does NOT change

- **Chart internals** (`PayoffChart`, `GammaProfile`, `GexBars`, `LifecycleChart`) — zero
  code changes; only their `Panel` wrapper's horizontal padding adapts (D-10).
- **Bottom tab bar** — not added (D-08); `Shell`'s 3 top tabs stay, only their touch-target
  height changes below `lg:`.
- **PWA / native app / TestFlight** — explicitly out of scope.
- **Data layer / hooks** (`usePositions`, `useGex`, `useCot`, `useMacro`, `useExits`,
  `useLiveStream`) — untouched; both the table and card branches consume the same `Row[]`/
  resolved-position data.
- **Desktop (`≥1024px`) visuals** — pixel-identical throughout, per the tripwire checklist
  above.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|--------------|
| shadcn official | none new — reuses already-installed `Badge`, `Dialog`, `Tooltip` | not required |
| third-party | none | not applicable |

No `npx shadcn view`/vetting needed — zero new registry blocks this phase.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-07-11 (0 BLOCK; 2 implementation-bug fixes + tripwire/nit
patches applied post-approval, see diff summary)
