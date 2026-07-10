---
phase: 31
slug: overview-risk-profile-kiss-redesign-marker-label-collision-f
status: draft
shadcn_initialized: true
preset: base-nova (neutral base, lucide icons) — detected from apps/web/components.json, not re-run this phase
created: 2026-07-10
---

# Phase 31 — UI Design Contract

> Two presentation-only fixes on the existing dark-terminal design system: (1) collision-proof
> GEX wall/flip markers on `PayoffChart`, (2) linear bullet gauges for the 4 banded regime rows
> in `RegimeBoard`. No new screens, no new color tokens, no new dependencies.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `apps/web/components.json`) |
| Preset | `base-nova`, baseColor `neutral`, `cssVariables: true` — unchanged this phase |
| Component library | radix (via shadcn `ui/*` primitives: `Badge`, `Tooltip`) + visx (chart) |
| Icon library | lucide (declared in components.json) — **not used this phase**; both deliverables use existing SVG/text glyphs, no new icon imports |
| Font | Space Grotesk (`font-display`, headings/labels) / JetBrains Mono (`font-mono`, all numerals) |

No `shadcn add` needed. No new registries. Zero new npm dependencies (ladder rung 2:
everything below reuses `apps/web/src/index.css` tokens, `Panel`/`PanelHeading`/`Button`
from `apps/web/src/components/system/index.tsx`, and the existing visx chart already in
`PayoffChart.tsx`).

---

## Spacing Scale

Project uses a 4px-multiple scale expressed as raw Tailwind arbitrary values (`text-[10px]`,
`h-1.5`, `py-1`), not named tokens — matches existing `RegimeBoard.tsx`/`PayoffChart.tsx`
usage. This phase's new values, all multiples of 2/4:

| Token | Value | Usage |
|-------|-------|-------|
| gauge track height | 6px (`h-1.5`) | Band-gauge track |
| gauge marker | 3px × 10px (`w-[3px] h-2.5`) | Value marker, taller than track (bullet-graph convention) |
| row vertical padding | 6px (`py-1.5`, up from `py-1`) | Regime row now carries 2 lines instead of 1 |
| row line gap | 4px (`gap-1`) | Between label/value line and the gauge track line |
| chart edge-marker lane pitch | 8px (`y = 8, 16, 24`) | Fixed vertical lanes for off-domain wall arrows |

Exceptions: chart lane pitch (8px) is smaller than the 8pt base unit's usual minimum step
because it sits inside a 470px SVG viewBox at 2x information density (three possible lanes
in a 14px top margin) — same precedent as the chart's existing `y={10}` label baseline.

---

## Typography

Reuses the system's existing type scale exactly — no new sizes, no new weights.

| Role | Size | Weight | Line Height | Where |
|------|------|--------|-------------|-------|
| Row label | 10px | 600 (`font-semibold`) | default | `RegimeBoard` row label, unchanged (`font-display text-[10px] tracking-[0.09em] uppercase`) |
| Row value | 13px | 400/600 (600 only when abnormal) | default | `RegimeBoard` row value, unchanged (`font-mono text-[13px] tabular-nums`) |
| Chart edge-arrow glyph | 9px | 400 | default | `PayoffChart` off-domain indicator (was the removed label's font size) |
| Legend swatch text | 10px | 400 | default | Overview curve-color key row, unchanged |

No body/heading/display sizes are introduced — this phase touches only rail rows and one
chart layer, both already governed by 09-UI-SPEC.md's locked type scale.

---

## Color

All colors are the existing LOCKED palette in `apps/web/src/index.css` (`@theme`). No new
hex values.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--color-bg #0a0e14` / `--color-panel #0f1521` | App background, Panel surface — unchanged |
| Secondary (30%) | `--color-raise #161d2b` / `--color-line #1b2433` / `--color-line2 #27313f` | Panel borders, gauge track base, RateRow backdrop — unchanged |
| Accent (10%) | `--color-amber #f0b429` (warning), `--color-down #ef5350` (crisis), `--color-up #26a69a` (call wall / calm-positive) | Reserved for: gauge warn/crisis band fills + marker, gauge/row value text when abnormal, γ-flip line+lane, call-wall line+lane, put-wall line+lane. **Never** used for chrome, borders, or non-signal text. |
| Destructive | `--color-down #ef5350` | Crisis band fill/marker, put-wall dashed line — no new destructive actions this phase (no delete/remove UI) |

Accent reserved for (explicit — nothing else may use amber/down/up/violet this phase):
- Gauge track warn segment → `bg-amber/30`
- Gauge track crisis segment → `bg-down/30`
- Gauge marker → `bg-txt` (calm) / `bg-amber` (warning) / `bg-down` (crisis)
- Row value text → unchanged existing rule (`text-txt` calm / `text-amber` warning / `text-down` crisis)
- Chart wall lines/lanes → `AMBER` (γ flip), `TEAL`/`bg-up` (call wall), `CORAL`/`bg-down` (put wall) — same three constants already in `PayoffChart.tsx`, only their **label rendering** changes, not their color

---

## Copywriting Contract

No new user-facing copy strings, no new CTAs, no new empty/error states — both deliverables
restyle existing data, they don't introduce new flows.

| Element | Copy |
|---------|------|
| Primary CTA | Not applicable — no new interactive action this phase |
| Empty state | Not applicable — existing `RegimeBoard` loading/error/empty branches (lines 249–295) are unchanged and already handle "no data"; gauges never render without a `RegimeIndicator.value`, which the contract requires as non-optional |
| Error state | Not applicable — unchanged (`Regime board unavailable — check the FRED/CBOE fetch job.`) |
| Destructive confirmation | Not applicable — no destructive action introduced |
| Gauge `aria-valuetext` (new, machine-read, not visible copy) | `` `${value.toFixed(2)} — ${band}` `` e.g. `"0.97 — crisis"` |
| Gauge `aria-label` (new) | `` `${indicator.label} gauge` `` e.g. `"VIX/VIX3M gauge"` |
| Chart edge-arrow (new, 1-glyph, not a label) | `"›"` (clamped to domain max) / `"‹"` (clamped to domain min) — no wall name, no value; exact numeric value lives in the Overview "Key levels" panel, the Analyzer `ScenarioStrip` level row, and the crosshair tooltip |

---

## Component Specifications

### 1. Chart marker labels — KISS collision fix

**File:** `apps/web/src/components/charts/PayoffChart.tsx` (shared by both `Overview.tsx`
and `Analyzer.tsx` — fix applies to both automatically, no per-screen changes needed).

**Chosen strategy: delete the in-chart text label entirely.** Of the options CONTEXT.md
left to discretion (legend-only + unlabeled verticals / staggered lanes / collision-shift
+ leader ticks / axis abbreviations), a dashed **unlabeled vertical line** is the only
option with zero possible collision surface — there is no text to overlap regardless of
how tightly γflip/put wall/call wall cluster (the repro case: 7488/7500/7544/7550 within
62pts). This is rung 1 of the ladder: the label doesn't need to exist in the chart body at
all, because the exact numeric value already exists in three other places:

- Overview: the "Key levels" panel (`Overview.tsx` `keyLevelsFor`/`GexRail`, already
  renders `Call Wall` / `γ flip` / `Spot` / `Put Wall` as color-keyed rows, unchanged)
- Analyzer: the `ScenarioStrip` level row (`components/picker/ScenarioStrip.tsx`, already
  renders the deduped level values as a header row, unchanged)
- Both: the crosshair tooltip (`PayoffChart.tsx` lines 876–891, already renders
  `vs put wall` / `vs call wall` deltas on hover, unchanged)

**What changes in `PayoffChart.tsx`:**

1. Delete the `<text>` element at lines 708–717 (the `marker.label` render) entirely.
2. Keep the dashed vertical `<line>` exactly as-is (`stroke={color}` `strokeWidth={1}`
   `strokeDasharray="2 3"` `opacity={0.6}`) — this is the only in-chart signal now, and a
   plain line can never "pile up into garbage" the way stacked text does.
3. Replace `PinnedMarker`'s `label`/`anchorEnd` fields with a single `clampedTo: "min" |
   "max" | null` field (`pinMarker` keeps its clamp arithmetic, just stops building a
   string):
   ```ts
   type PinnedMarker = { readonly x: number; readonly clampedTo: "min" | "max" | null };
   ```
4. When `clampedTo !== null` (the wall/flip level sits outside the current domain — a
   real case since Phase 30's domain is anchored on strikes/spot/breakevens, **not** GEX
   walls, per `payoff-domain.ts`), render a single-glyph arrow (`›` for `"max"`, `‹` for
   `"min"`) instead of the removed label. This is the only place a "label" survives, and
   it is provably non-overlapping by construction, not by measurement: each of the 3
   series (γ flip, call wall, put wall) owns a **fixed vertical lane** independent of
   value or domain —
   ```ts
   const EDGE_ARROW_LANE_Y: Record<"flip" | "call" | "put", number> = { flip: 8, call: 16, put: 24 };
   ```
   Two or three walls clamping to the *same* edge stack vertically in their own lanes
   (never the same y, so never the same bounding box) instead of horizontally into the
   same x position — the failure mode that produced "γflip pll call wall" cannot recur
   because there is no shared line of text left to pile onto.
5. Typography for the arrow glyph: `fontSize={9}` `fontFamily="JetBrains Mono, monospace"`
   `fill={color}` (same 3 color constants: `AMBER`/`TEAL`/`CORAL`), `textAnchor` =
   `"end"` when `clampedTo === "max"` else `"start"`, positioned 3px off the clamped line
   same as before (`marker.x - 3` / `marker.x + 3`).
6. Spot stays a solid line + dot, unlabeled — unchanged (CONTEXT confirmed: "probably
   yes — it is the anchor").
7. Breakeven pills and BE markers (lines 392–450, 724–752) are unchanged — they are the
   existing precedent for "pull the text out of the chart body," already collision-free.

**Overview legend row extension** (`apps/web/src/screens/Overview.tsx` lines 1131–1148):
the generic single `"walls"` swatch (`bg-up`) is replaced with three swatches matching the
chart's actual per-series colors, so removing the in-chart labels doesn't remove the
color→meaning mapping:
```
● γ flip (bg-amber)   ● call wall (bg-up)   ● put wall (bg-down)
```
Same `inline-block h-0.5 w-3.5 rounded-full` swatch markup already used for `T+0`/`@ exp`.
**Analyzer does not get an equivalent legend row** (discretion call): it has no legend row
today, and `ScenarioStrip`'s level header already prints the exact numbers next to the same
put/call-wall/γ-flip colors used app-wide (Key Levels panel, GexRail) — adding one would be
new chrome for information that's already one line below the chart. Skip; add only if a
future UAT finds Analyzer readers actually confused.

**Test invariant to hold (TDD, executor writes the actual test):** a fast-check property
over 4 arbitrary levels in an arbitrary domain asserting the chart renders **zero `<text>`
nodes** for wall/flip markers when in-domain, and — when out-of-domain — that the y-lane
function returns a value from the fixed 3-element set regardless of input, so no two
edge-arrows for different series can ever share a bounding box. Plus the literal repro
fixture (flip 7488 / putWall 7500 / spot 7544 / callWall 7550, domain 7100–8050) as an
example test.

---

### 2. Linear band-gauges — MARKET REGIME rows

**File:** `apps/web/src/components/RegimeBoard.tsx`, function `Row` (lines 57–118).

**Row layout — two lines, up from one:**

Line 1 (existing, minus the dot): label + ⓘ info button (unchanged, left) — value text
(unchanged position/color rule, right). **Remove** the standalone `size-1.5 rounded-full`
band dot (line 100–104) — it becomes redundant once the gauge marker on line 2 carries the
same color signal; keeping both is double-encoding the same fact for no added scan speed
(ponytail: delete, don't duplicate).

Line 2 (new): the gauge track, full row width.

```
<div className="flex flex-col gap-1 py-1.5" data-testid={`regime-chip-${indicator.id}`}>
  <div className="flex items-center justify-between gap-2">  {/* line 1, unchanged minus dot */}
    ...label + ⓘ...                    ...value text (band-colored)...
  </div>
  <div role="meter" className="relative h-1.5 w-full overflow-hidden rounded-full bg-line2"
       aria-valuenow={indicator.value} aria-valuemin={scale.min} aria-valuemax={scale.max}
       aria-valuetext={`${indicator.value.toFixed(2)} — ${indicator.band}`}
       aria-label={`${indicator.label} gauge`}
       data-testid={`regime-gauge-${indicator.id}`}>
    {/* warn segment */}
    <div className="absolute inset-y-0 bg-amber/30" style={{ left: `${warnPct}%`, width: `${crisisPct - warnPct}%` }} />
    {/* crisis segment */}
    <div className="absolute inset-y-0 bg-down/30" style={{ left: `${crisisPct}%`, width: `${100 - crisisPct}%` }} />
    {/* marker */}
    <div className={cn("absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full", markerClass)}
         style={{ left: `${valuePct}%` }} data-testid={`regime-gauge-marker-${indicator.id}`} />
  </div>
</div>
```

**Track base color:** `bg-line2` (`#27313f`, existing token) represents the un-annotated
calm zone — no separate calm-colored segment is drawn, matching the row-value rule ("calm
stays quiet, only abnormal gets color").

**Band segments:** `bg-amber/30` from `warnPct` to `crisisPct`, `bg-down/30` from
`crisisPct` to 100%. 30% opacity keeps them a backdrop, not a headline — the marker is the
thing the eye should land on.

**Marker:** 3px × 10px rounded bar (taller than the 6px track — standard bullet-graph
"pin"), horizontally positioned by `left: {valuePct}%` clamped to `[0, 100]` (the printed
numeric value on line 1 is never clamped — only the marker position, same edge-clamp
precedent as the chart's `pinMarker`). Color:

| Band | Marker color |
|------|-------------|
| calm | `bg-txt` (`#d6dbe4`) — bright neutral; the existing dim `bg-line2` dot doesn't have enough contrast to read as a positioned marker on a track, so calm gets a visible-but-unaccented color instead |
| warning | `bg-amber` |
| crisis | `bg-down` |

**Why a styled `<div role="meter">`, not the native `<meter>` element** (ladder rung 4
considered and rejected with a reason, not skipped): `<meter>`'s internal bar/segments are
rendered through non-standard `::-webkit-meter-*` pseudo-elements with no cross-browser
equivalent for Firefox, so the calm/warn/crisis band-color segments this design calls for
cannot be reliably skinned to the token palette. `role="meter"` on a plain div keeps the
correct ARIA semantics (a scalar reading within a bounded range — not `progressbar`, which
implies task completion) while giving full control over the visual.

**Fixed per-indicator scale** (frontend-only presentation constant, lives beside the
existing `SHORT_LABELS` map in `RegimeBoard.tsx` — **not** sourced from the contract, since
it is a visual axis choice, not a semantic threshold):

| id | label | min | max | warn¹ | crisis¹ |
|----|-------|-----|-----|-------|---------|
| `vix-term-structure` | VIX/VIX3M | 0.6 | 1.2 | 0.9 | 0.95 |
| `vvix` | VVIX | 70 | 150 | 100 | 115 |
| `vix9d-vix` | VIX9D/VIX | 0.7 | 1.3 | 1.0 | 1.1 |
| `hy-oas` | HY OAS | 1.5 | 8.0 | 3.0 | 5.0 |

¹ warn/crisis values shown for reference only — **do not hardcode these two columns
client-side.** Per CONTEXT.md's orchestrator-resolved decision, they must come from the
regime API response (Phase-29 effective-config-aware, single source of truth). Required
**additive** contract change (planner/executor task, not this doc's job to implement):

```ts
// packages/contracts/src/regime.ts — regimeIndicator gains two optional-safe fields
export const regimeIndicator = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
  band: regimeBand,
  bandWarn: z.number(),    // NEW — the warn threshold actually used to compute `band`
  bandCrisis: z.number(),  // NEW — the crisis threshold actually used to compute `band`
  asOf: z.string().date(),
  source: z.string(),
  rationale: z.string(),
  inputs: z.record(z.string(), z.number()).optional(),
});
```
Populated in `getRegimeBoard.ts` from the same `RegimeThresholds` override values (falling
back to the named constants in `packages/core/src/analytics/domain/regime.ts`) it already
resolves to compute `band` — no new lookup, just surfacing values the use-case already has
in hand. `min`/`max` (the two scale-only columns) stay a client-side lookup table exactly
like `SHORT_LABELS` today, because they carry no semantic meaning to gate on — only where
the ruler starts and ends.

**Missing-data state:** none needed this phase. `RegimeIndicator.value`/`band` are
non-optional in the contract; a fully-absent indicator set is already handled one level up
by `RegimeBoard`'s existing loading/error/empty branches (lines 249–295), which never reach
`Row` at all. Do not add a per-row "no data" gauge variant for a case the contract cannot
currently produce (YAGNI) — add it if/when an indicator's `value` ever becomes optional.

**Info button (ⓘ) and `asOf`:** unchanged. The tooltip trigger/content (lines 70–97) stays
on line 1 exactly where it is; the panel-level freshness footer (lines 297–318, one
deduped "as of" line for all four indicators) is untouched.

**Dense mode:** the existing `dense` prop (label shortening only) is orthogonal to the
gauge — no dense-specific gauge variant. At the narrow `MarketRail` width the 6px track
just renders narrower; readability holds down to the rail's current minimum column width
(it already fits four rows of 10–13px type today).

---

### 3. What does NOT change

- **Entry gate tile** (`GateChip`, lines 149–188) — stays the framed, state-colored
  compact tile. It has a gate *state* (open/penalty/blocked/blind), not a continuous
  banded value — nothing in this phase's gauge pattern applies to it.
- **Rates block** (`RateRow`/`RATES`, lines 190–220) — stays the plain 2-col
  label/value grid. Orchestrator-resolved: no warn/crisis semantics to gauge (Fed
  Funds/SOFR/curve spreads aren't banded indicators).
- **COT block** (`CotCard.tsx`) — stays typographic, untouched, not read this phase
  (out of scope per CONTEXT.md deferred list).
- **GEX wall/flip computation** — zero math changes anywhere (`packages/core` GEX domain
  untouched). This phase is rendering-only on both fronts.
- **Regime banding math** (`regime.ts` `bandVixTermStructure` etc.) — untouched; the
  contract addition only *surfaces* the threshold values these functions already use.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none new — reuses already-installed `Badge`, `Tooltip` | not required |
| third-party | none | not applicable |

No `npx shadcn view`/vetting needed — zero new registry blocks this phase.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
