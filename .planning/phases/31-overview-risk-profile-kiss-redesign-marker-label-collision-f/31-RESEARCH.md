# Phase 31: Overview Risk Profile KISS Redesign + Macro Band-Gauges - Research

**Researched:** 2026-07-10
**Domain:** Internal codebase only — SVG chart label layout (visx) + a new Tailwind-token gauge
primitive for an existing typographic rail. Zero new dependencies.
**Confidence:** HIGH (every claim below is a direct file/line read from this repo, not a web
search — this is an internal-refactor phase with no external unknowns)

## Summary

Both defects live in code already read in full. Defect 1 (marker-label collision) is entirely
contained in `apps/web/src/components/charts/PayoffChart.tsx`'s GEX-wall layer (lines 683–722):
three pinned markers (`γflip`, `put wall`, `call wall`) each draw a `<text>` at the SAME fixed
`y={10}` row, so when their x-positions cluster (0DTE-heavy days) the text strings visually
merge. The fix is a pure, DOM-measurement-free function: sort the active markers by x, assign
each a distinct row (`y = 10 + row * ROW_HEIGHT`), so N markers get N rows and can never collide
regardless of how close their x-values are — no pixel/text measurement needed, which sidesteps
jsdom's lack of real SVG text layout entirely. Breakeven labels are already solved this way in a
prior phase (moved to an HTML pill row above the chart, `be-pills`, so they never had this bug).

Defect 2 (macro band-gauges) replaces `RegimeBoard.tsx`'s `Row` component (value-only text) with
a linear bullet-gauge track for the 4 banded indicators. The repo already has the exact bar
primitive to reuse — `CandidateCard.tsx`'s breakdown bars (`h-[5px] rounded-full bg-raise` track +
absolutely-positioned fill `span`) — just needs a 3-segment banded track (calm/warn/crisis) and a
marker instead of a single fill. The blocking finding: **the regime API response does NOT carry
warn/crisis threshold values today** — only the computed `band` classification. The effective
thresholds (Phase 29 overrides-aware) ARE computed server-side in `getRegimeBoard.ts` via
`resolveRegimeRuleConfig()` but are discarded before the indicator is pushed onto the output
array. This needs one additive field pair per indicator threaded through core → contracts → (the
route already passes the parsed object through unchanged, zero route/MCP code changes needed).

**Primary recommendation:** (1) In `PayoffChart.tsx`, replace the fixed `y={10}` wall/flip label
row with a pure `assignLabelRows(markers)` helper (sort-by-x → row-index) reused for BOTH the
labeled markers today and any future ones (generalizes to N, not hardcoded to 3) — provably
collision-free by construction, testable without DOM text measurement. (2) Add `bandWarn` /
`bandCrisis: number` fields to `packages/contracts/src/regime.ts`'s `regimeIndicator` schema,
populate them in `getRegimeBoard.ts` from the existing `config.<indicator>` values it already
computes, and build a new `RegimeGauge` component in `RegimeBoard.tsx` reusing `CandidateCard`'s
bar-track Tailwind pattern with fixed per-indicator min/max ranges (see `## Assumptions Log` —
these ranges are `[ASSUMED]`, need a quick user confirm, not verified against a numeric source).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Marker-label collision avoidance | Browser/Client (React/visx, pure function) | — | Pure layout math over already-fetched GEX values; no new data, no server round-trip |
| Regime band-gauge rendering | Browser/Client (React component) | — | Presentation-only; consumes the (additively extended) existing regime response |
| Effective warn/crisis threshold sourcing | API/Backend (`getRegimeBoard.ts` use-case) | Database (rule_overrides JSONB, Phase 29) | Single source of truth already lives here (`resolveRegimeRuleConfig`) — client must NOT hardcode/recompute band edges (CONTEXT ORCHESTRATOR RESOLVED) |
| Contract shape (`RegimeIndicator`) | API/Backend → Contracts (Zod) | Browser/Client (consumer) | Additive Zod fields only; `packages/contracts` is imported by both server and web (architecture-boundaries §1) |

## Package Legitimacy Audit

**N/A — zero new dependencies.** Both fixes reuse existing repo-local code (visx already a
dependency of `PayoffChart.tsx`; Tailwind utility classes already used by `CandidateCard.tsx`;
`fast-check` already a root `devDependency` — `package.json:21` — used workspace-wide with no
per-package `package.json` entry, confirmed by `packages/core/src/analytics/domain/regime.test.ts`
importing it with zero local declaration). No `npm view` / registry checks required.

## Architecture Patterns

### Defect 1 — Marker rendering internals (chart)

**File:** `apps/web/src/components/charts/PayoffChart.tsx`

- **`pinMarker()`** (lines 163–176) — edge-pins a GEX wall/flip x-value into the visible domain
  and builds the label string (`"call wall 8000 →"` when clamped, `"call wall"` when in-domain).
  Returns `{ x, label, anchorEnd }`. Unaffected by Phase 30's dynamic `domain` prop — it already
  takes `domain` as a parameter (D-01 precedent), so the collision fix does not need to touch this
  function's contract, only how its output `label` is *positioned vertically*.
- **GEX wall layer** (lines 683–722) — for each of `put wall` / `call wall` / `γflip` (in that
  fixed array order, NOT x-sorted), renders a dashed vertical `<line>` (`data-testid="wall-line-
  {key}"`) plus a `<text>` at **`y={10}`** (fixed, same row for all three) with
  `textAnchor={marker.anchorEnd ? "end" : "start"}`. This is the exact collision site: when
  `flip`/`putWall`/`callWall` x-pixels are within a monospace-9px label's rendered width of each
  other, the three `<text>` elements overlap visually (they don't error — SVG just draws
  overlapping text, unreadable at small font).
- **Spot** (lines 800–816) — a plain `<line>` + `<circle>`, **no text label at all** today. CONTEXT
  confirms "probably yes" it stays label-free (it's the anchor, already visually distinct as the
  only solid blue line + dot). Not part of the collision set unless a future plan adds one — the
  fix's lane-assignment function should still accept it generically since CONTEXT's own fast-check
  spec says "any 4 levels" (see `## Common Pitfalls`).
- **Toolbar/legend chips** — `apps/web/src/screens/Overview.tsx:1128–1148` — a *static,
  non-interactive* color key ("T+0" violet / "@ exp" gray-muted / "γ flip" amber / "walls" teal)
  rendered ABOVE the chart, separate from `PayoffControls` (the interactive show/hide toggle
  chips, same file, ~line 1118). This legend already answers "what does amber mean" — it is NOT
  itself a collision site (no per-value text) but is the reason simply removing wall labels
  entirely (legend-only) is a viable "Claude's Discretion" option: the legend maps color→meaning,
  so in-chart labels could become value-only ticks with the legend supplying the name. Analyzer.tsx
  has no equivalent color-key legend block (confirmed: 0 matches for "Legend"/"toolbar" strings in
  `Analyzer.tsx`) — only `PayoffControls`. If the fix relies on the legend to carry the name, the
  Analyzer screen would need its own mapping or the fix must remain self-contained in the chart.
- **Breakeven labels — already-solved precedent to copy.** `beExp`/`beToday` markers (lines
  724–752) draw ONLY a short red vertical bar in-chart; their numeric values are rendered in an
  HTML `<div data-testid="be-pills">` row ABOVE the SVG (lines 392–450), explicitly commented:
  *"so the values never overlap inside the plot. The in-chart markers are the red bars."* This is
  the exact pattern this phase's CONTEXT gestures at ("abbreviations at the axis instead of the
  top edge") — but for walls/flip a pill row would lose the vertical alignment signal (pills don't
  point at their x-position). The row-lane approach below keeps in-chart positional meaning while
  still using an already-proven "move text off the single collision-prone row" strategy.

**Every label that can collide today:** `γ flip`, `put wall`, `call wall` (all three share the
same fixed `y={10}` text row). Spot has no label (not a collision candidate as shipped). BE labels
were already moved out of the SVG in a prior phase (not a collision candidate). **Total collision
set = 3 markers, fixed positions relative to each other only by domain value, not draw order.**

**Recommended fix — sort-by-x row assignment (provably correct, no text measurement):**

```typescript
// Source: apps/web/src/components/charts/PayoffChart.tsx pattern extension
type PinnedMarker = { readonly x: number; readonly label: string; readonly anchorEnd: boolean };

const LABEL_ROW_HEIGHT = 11; // px, JetBrains Mono 9px line height + 2px gap
const LABEL_BASE_Y = 10;

/**
 * Assigns each marker a distinct vertical row by x-sort order. N markers -> N rows,
 * so no two labels ever share a row regardless of how close their x-values are —
 * correct by construction, not by measuring rendered text width (jsdom can't do
 * real SVG text layout, see Common Pitfalls).
 */
function assignLabelRows(
  markers: ReadonlyArray<PinnedMarker>,
): ReadonlyArray<PinnedMarker & { readonly y: number }> {
  return [...markers]
    .sort((a, b) => a.x - b.x)
    .map((m, i) => ({ ...m, y: LABEL_BASE_Y + i * LABEL_ROW_HEIGHT }));
}
```

This generalizes to any future labeled marker (spot, EM band, etc.) without new collision logic.
Trade-off: with 3 markers stacked vertically at different rows, a reader must trace a short
vertical distance from row to line — acceptable per CONTEXT's own listed option ("staggered
two-row label lanes"); 3 rows here, not 2, since 3 markers can all be mutually close (worse case
than 2-lane alternation, which only guarantees non-collision for *adjacent* x-sorted pairs, not
for 3 all within one label-width of each other — reject 2-lane alternation for that reason).

### Defect 2 — Regime rail component (left rail)

**File:** `apps/web/src/components/RegimeBoard.tsx` (320 lines) — the "Market regime" panel.
Composed into the Overview screen's left rail by `apps/web/src/screens/MarketRail.tsx:51`
(`<RegimeBoard dense />`).

**Row structure (top → bottom), current typographic tiers:**
1. `GateChip` (lines 149–188) — entry-gate tile, separate data source (`usePicker()`), OUT OF
   SCOPE (CONTEXT: gauges apply only to the 4 banded regime indicators, not the gate).
2. `Row` (lines 57–118) — ONE per banded indicator (`vix-term-structure`, `vvix`, `vix9d-vix`,
   `hy-oas`). Label left (`shortLabel`, dense-mode abbreviation via `SHORT_LABELS` map, line 46),
   info-button (ⓘ) `TooltipTrigger` + `TooltipContent` showing `indicator.source` +
   `indicator.rationale` verbatim (lines 70–97 — **keep this exact pattern, CONTEXT: "keep those
   buttons"**), value right as `indicator.value.toFixed(2)` colored by band (`BAND_CLASSES`,
   lines 38–42: calm = quiet `text-txt`/`bg-line2` dot, warning = `text-amber`, crisis = `text-
   down`). **This `Row` is the exact component the gauge replaces** — the label/ⓘ/tooltip half
   (JSX lines 62–98) stays untouched; only the value-display half (lines 99–116, currently a dot +
   `.toFixed(2)` text) becomes the gauge track.
3. `RateRow` (lines 211–220) — rates block (Fed Funds/SOFR/1M/3M/10Y−2Y/10Y−3M). CONTEXT:
   explicitly stays typographic, NOT gauged (no warn/crisis semantics).
4. Freshness footer (lines 297–317) — one dedupe line, `data-testid="regime-freshness"`. Unaffected.

**Data source hook:** `apps/web/src/hooks/useRegimeBoard.ts` — `GET /api/analytics/regime` via
`apiFetch`, parsed through `regimeResponse.parse()` (Zod), React Query with
`refetchInterval: 1_800_000` (30 min) / `staleTime: 900_000` (15 min), non-retryable on 401. No
query-key change needed for an additive Zod field — React Query re-parses the same endpoint;
adding fields to the schema is a non-breaking response shape change, cache key stays
`["regime-board"]`.

**Response shape today** (`packages/contracts/src/regime.ts:16–25`):
```typescript
export const regimeIndicator = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
  band: regimeBand,              // "calm" | "warning" | "crisis" — CLASSIFICATION ONLY
  asOf: z.string().date(),
  source: z.string(),
  rationale: z.string(),
  inputs: z.record(z.string(), z.number()).optional(),
});
```
**No warn/crisis numeric fields exist in the response today.**

### Threshold availability — the additive contract change

**Confirmed missing.** `packages/core/src/analytics/application/getRegimeBoard.ts:97–172`
(`makeGetRegimeBoardUseCase`) already computes the FULL effective (Phase-29-overrides-aware)
threshold set every request:

```typescript
// Source: packages/core/src/analytics/application/getRegimeBoard.ts:107-110 (already live)
const overridesResult = await deps.readRuleOverrides();
const regimeOverridesRaw = overridesResult.ok ? overridesResult.value["regime"] : undefined;
const regimeOverrides = isRegimeRuleOverrides(regimeOverridesRaw) ? regimeOverridesRaw : undefined;
const config = resolveRegimeRuleConfig(regimeOverrides);
// config.vixTermStructure / config.vvix / config.vix9dRatio / config.hyOas
// each a { readonly warn: number; readonly crisis: number } — RegimeThresholds
// (packages/core/src/analytics/domain/rule-config.ts:37-41)
```

`config.<indicator>` is passed into the `band*()` functions (e.g. line 124:
`bandVixTermStructure(value, config.vixTermStructure)`) but the `{warn, crisis}` pair itself is
**never attached to the pushed `RegimeIndicatorOut` object** (lines 120–128, 133–140, etc.) — it
is computed and then discarded. This is the exact "additive contract field" CONTEXT anticipated.

**Exact change needed (3 files, all additive, zero breaking changes):**

1. `packages/contracts/src/regime.ts` — add to `regimeIndicator`:
   ```typescript
   bandWarn: z.number(),
   bandCrisis: z.number(),
   ```
2. `packages/core/src/analytics/application/getRegimeBoard.ts`:
   - Add `bandWarn`/`bandCrisis` to the `RegimeIndicatorOut` type (line 42–51).
   - At each of the 4 push sites (lines 120–128, 133–140, 147–155, 160–166), spread
     `config.<indicator>.warn`/`config.<indicator>.crisis` into the pushed object — e.g.
     `bandWarn: config.vixTermStructure.warn, bandCrisis: config.vixTermStructure.crisis`.
3. **No route change needed** — `apps/server/src/adapters/http/analytics.routes.ts:173` already
   does `c.json(regimeResponse.parse(result.value))`, a blind pass-through; adding fields to the
   Zod schema + the object being parsed is sufficient. Same for the MCP tool
   (`apps/server/src/adapters/mcp/tools.ts:807–819`), which reuses the same `getRegimeBoard`
   result.

This is a genuinely single-source-of-truth change: thresholds are computed ONCE server-side
(respecting Phase 29 overrides), never duplicated as client-side constants — matching CONTEXT's
"ORCHESTRATOR RESOLVED: Gauge bands use the EFFECTIVE regime thresholds... single source of
truth."

### Existing gauge/bar primitives to reuse

**File:** `apps/web/src/components/picker/CandidateCard.tsx:240–251` — the closest existing
primitive, a horizontal bar with a track + proportional fill:

```tsx
// Source: apps/web/src/components/picker/CandidateCard.tsx:240-251 (verbatim)
<div key={criterion} className="flex items-center gap-1.5">
  <span className="w-16 shrink-0 font-mono text-[9px] text-dim">{BAR_LABEL[criterion]}</span>
  <span className="h-[5px] flex-1 rounded-full bg-raise">
    <span
      className={cn("block h-full rounded-full", BAR_FILL_CLASS[criterion])}
      style={{ width: `${width}%` }}
      data-testid={`breakdown-bar-fill-${criterion}`}
    />
  </span>
  <span className="w-9 shrink-0 text-right font-mono text-[9px] text-dim">{caption}</span>
</div>
```
Track: `h-[5px] flex-1 rounded-full bg-raise` (the muted-gray pill background). Fill: `block
h-full rounded-full`, color from a criterion→Tailwind-class lookup (`BAR_FILL_CLASS`, lines
45–50: `bg-violet` / `bg-blue` / `bg-up` / `bg-amber` — no hardcoded hex, matches the file's own
"Hand-rolled bar fills... mirror PayoffChart.tsx's existing hand-rolled precedent" comment). Width
computed inline as a clamped percentage (`Math.min(100, Math.max(0, entry.contribution))`).

**`CotCard.tsx:64–90`** — a second, simpler proportional-bar precedent (`maxAbs`-normalized width,
sign-colored), confirms the "inline `style={{width}}` percentage bar on a `bg-raise` track" idiom
is the established repo pattern, not a one-off.

**Recommended `RegimeGauge` shape** (new component in `RegimeBoard.tsx`, replacing the value half
of `Row`): a single `bg-raise` track divided into 3 flex segments (calm/warn/crisis width
proportional to each band's span within the fixed min/max range) OR — simpler, more KISS,
consistent with the existing single-fill-bar idiom above — ONE `bg-raise` track with 2 absolutely-
positioned thin tick marks at the warn/crisis x-fractions (band edges, muted, unlabeled per
CONTEXT "band edges NOT labeled with numbers by default") and a small marker (a `size-2` rounded
dot, `absolute`, `left: {pct}%`) at the current value's fraction, colored via the SAME
`BAND_CLASSES` map (lines 38–42) already used for the dot/value today — zero new color logic.

### Recommended Project Structure

No new files required — both fixes are edits to existing files:
```
apps/web/src/components/charts/PayoffChart.tsx   # add assignLabelRows() + wire into wall layer
apps/web/src/components/RegimeBoard.tsx          # add RegimeGauge, replace Row's value half
packages/contracts/src/regime.ts                 # add bandWarn/bandCrisis fields
packages/core/src/analytics/application/getRegimeBoard.ts  # populate the 2 new fields
```

### Anti-Patterns to Avoid

- **Client-side threshold hardcoding:** do NOT duplicate `VIX_TERM_STRUCTURE_WARN` etc. as a
  frontend constant — CONTEXT explicitly forbids this (single source of truth, Phase 29
  overrides-aware). Always read `indicator.bandWarn`/`bandCrisis` from the response.
- **Pixel/text-measurement-based collision detection:** do not reach for `getBBox()` or
  `getComputedTextLength()` for the label-lane assignment — jsdom does not implement real SVG
  text layout (see Common Pitfalls), so any test relying on measured pixel width will either
  throw or silently return 0 and pass vacuously. The row-assignment approach above needs no
  measurement at all.
- **Re-deriving band from value client-side:** `RegimeGauge` must read `indicator.band` (already
  computed server-side) for the marker color, not recompute calm/warn/crisis from
  `value`/`bandWarn`/`bandCrisis` — avoids a second (potentially inconsistent) banding
  implementation on the client.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Proportional bar/track UI | A new gauge/slider component library wrapper | The existing `CandidateCard.tsx` bar-track Tailwind pattern (`bg-raise` track + `style={{width}}` fill) | Already proven, zero-dep, matches every other proportional-value UI in this codebase (COT bars too) |
| Label collision avoidance | A generic force-directed/D3-style label-declutter algorithm | The sort-by-x row-assignment function above | Only 3 possible markers ever exist (put/call/flip) — a general declutter library is over-engineering for a fixed small N; CLAUDE.md ponytail discipline applies (YAGNI) |
| Threshold values | A new `/api/analytics/regime/thresholds` endpoint or a second query | Additive fields on the EXISTING `regimeIndicator` response | The data is already computed per-request in `getRegimeBoard.ts`; a new endpoint would duplicate the override-resolution call and add an extra round-trip for data already in flight |

**Key insight:** every piece of this phase is additive-and-reuse, not new-and-general. The
temptation to build a reusable "Gauge" design-system atom or a generic chart-label-declutter
utility should be resisted unless a second consumer appears — CONTEXT scopes gauges to exactly 4
indicators and label collision to exactly 3 markers.

## Common Pitfalls

### Pitfall 1: jsdom cannot measure real SVG text width
**What goes wrong:** A collision-avoidance test (or implementation) that calls
`textElement.getBBox()` or `getComputedTextLength()` under Vitest's `jsdom` environment
(`apps/web/vitest.config.ts:26`, `environment: "jsdom"`) will get either a thrown "not
implemented" error or a stubbed `0`/`{width:0,...}` return — jsdom does not lay out text.
**Why it happens:** jsdom is not a real rendering engine; SVG `getBBox`/`getComputedTextLength`
require actual font metrics and layout, which jsdom explicitly does not implement.
**How to avoid:** Never measure. Use the row-assignment approach (position by x-sort ORDER, not
by measured overlap) so the property under test is purely numeric (`y` values are distinct per
input array, independent of string content) — verifiable with plain `fast-check` over arrays of
`{x, label}` tuples, no DOM rendering needed for the property test itself (a SEPARATE component-
render test can assert the resulting `y` attributes on the real 2026-07-10 fixture cluster).
**Warning signs:** A test that renders the chart into jsdom and asserts "labels don't visually
overlap" via bounding-box math will be flaky/vacuous — assert `y` (or `data-testid` row index)
distinctness instead, which is what the production code actually guarantees.

### Pitfall 2: Regime response caching means a stale add-field response looks like a missing-field bug
**What goes wrong:** After adding `bandWarn`/`bandCrisis` to the schema and deploying, a browser
tab that had React Query's `["regime-board"]` cache warm from BEFORE the deploy (staleTime 15 min,
refetchInterval 30 min) will keep rendering the gauge with `undefined` thresholds until the next
scheduled refetch or a hard reload.
**Why it happens:** `useRegimeBoard.ts` has no cache-busting on schema version; it's a long-lived
query key with generous stale/refetch windows (appropriate for EOD macro data, not for a shape
change).
**How to avoid:** Not a code fix — an operational note for the deploy step (already how every
prior additive-contract-field phase in this codebase has shipped, e.g. Phase 29's rule-overrides
fields); do not add complexity (no cache-version key) to solve a one-time deploy artifact.
**Warning signs:** Gauge renders with a flat/zero-width bar or a marker pinned to one edge
immediately post-deploy, self-resolves within 30 minutes or on hard refresh.

### Pitfall 3: Tracking-scale inconsistency already present in `RegimeBoard.tsx`
**What goes wrong:** The design system's now-canonical `tracking-[0.09em]` for uppercase
`font-display` labels (confirmed by `apps/web/src/components/system/index.tsx`'s `SectionLabel`
and commit `b5155b6` which just fixed `CotCard.tsx` from `0.06em` → `0.09em` to match) is NOT
applied to `RegimeBoard.tsx`'s `Row`/`RateRow`/`GateChip` labels — they currently use
`tracking-[0.08em]` (lines 67, 162, 214). Not a bug that blocks this phase, but a redesign of
these exact rows is a natural place to also align tracking to `0.09em` for consistency —
**flag for planner discretion, not a locked requirement** (CONTEXT does not mention this).
**How to avoid:** If the planner chooses to fix it in the same phase, it's a 3-line find/replace
alongside the row's own edit; if deferred, note it as a small follow-up so it isn't silently
re-introduced by copy-pasting the current `Row` styling into the new gauge row.

### Pitfall 4: Fixed gauge min/max ranges will visually "pin" a marker if the wrong scale is picked
**What goes wrong:** CONTEXT requires "fixed sensible ranges so the marker doesn't jitter" — if a
range is too narrow, real values near historical extremes will clip to the track edge
(indistinguishable from a mid-range warning); too wide, and normal day-to-day movement barely
moves the marker (defeats "how close to the edge reads at a glance").
**Why it happens:** No existing numeric range exists in this codebase for these 4 series today —
only `warn`/`crisis` cut points, not a full display range.
**How to avoid:** Derive the range from each indicator's own `warn`/`crisis` values with headroom
(e.g. `[0, crisis * 1.3]` for a ratio bounded near zero on the low side, or `[warn * 0.5, crisis *
1.3]` for a series like HY OAS that has a meaningful "calm" floor) rather than a hardcoded
absolute range — self-adjusts if Phase 29 overrides shift the thresholds, staying consistent with
the "effective thresholds, single source of truth" decision. See `## Assumptions Log` — the exact
multipliers are `[ASSUMED]`, need a quick sanity check against real historical VIX3M-era data
during planning/discuss, not a blocking unknown.
**Warning signs:** A gauge that always shows the marker pinned at 100% or 0% width during normal
market conditions.

## Code Examples

### Existing edge-pin pattern (unmodified logic, verbatim reference for the row-assignment fix)
```typescript
// Source: apps/web/src/components/charts/PayoffChart.tsx:163-176
function pinMarker(
  name: string,
  value: number,
  xScale: (v: number) => number,
  domain: { readonly min: number; readonly max: number },
): PinnedMarker {
  if (value > domain.max) {
    return { x: xScale(domain.max), label: `${name} ${value.toFixed(0)} →`, anchorEnd: true };
  }
  if (value < domain.min) {
    return { x: xScale(domain.min), label: `← ${name} ${value.toFixed(0)}`, anchorEnd: false };
  }
  return { x: xScale(value), label: name, anchorEnd: false };
}
```

### Existing proportional bar-track pattern (verbatim reference for the gauge)
```tsx
// Source: apps/web/src/components/picker/CandidateCard.tsx:240-251
<span className="h-[5px] flex-1 rounded-full bg-raise">
  <span
    className={cn("block h-full rounded-full", BAR_FILL_CLASS[criterion])}
    style={{ width: `${width}%` }}
    data-testid={`breakdown-bar-fill-${criterion}`}
  />
</span>
```

### Existing band-color map to reuse for the gauge marker (unmodified)
```typescript
// Source: apps/web/src/components/RegimeBoard.tsx:38-42
const BAND_CLASSES: Record<RegimeBand, { dot: string; text: string }> = {
  calm: { dot: "bg-line2", text: "text-txt" },
  warning: { dot: "bg-amber", text: "text-amber" },
  crisis: { dot: "bg-down", text: "text-down" },
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Wall/flip labels drawn at a single fixed SVG `y` row | Row-lane assignment by x-sort order | This phase | Provably non-overlapping regardless of level clustering |
| Regime rows show only `value` + qualitative band color | Regime rows show a banded gauge track + value + marker | This phase | "How close to the edge" readable at a glance, per user request |
| Regime response carries only `band` (classification) | Response also carries `bandWarn`/`bandCrisis` (the numeric cut points) | This phase | Client can render exact-position gauges without duplicating threshold constants |

**Deprecated/outdated:** none — this phase does not remove any prior capability, only extends
label layout and adds gauge fields additively.

## Runtime State Inventory

**N/A — not a rename/refactor/migration phase.** This is a presentation-only UI change plus one
additive (non-breaking) contract field pair. No renamed identifiers, no stored-data keys, no
external service config, no OS-registered state, no secrets, no build artifacts affected.
Confirmed by direct read of the only 2 backend files touched (`getRegimeBoard.ts`,
`packages/contracts/src/regime.ts`) — neither involves any datastore key, external service
config, or environment variable.

<phase_requirements>
## Phase Requirements

No `REQUIREMENTS.md` phase-ID list was provided for Phase 31 in this milestone's scope (v1.3's
tracked requirement IDs — OPS/MACRO/BOARD/EXIT/BT/PLAY — predate this phase; Phase 31 is a
CONTEXT-driven mid-milestone UX fix, not itself carrying a REQ-ID). The two CONTEXT-defined
defects are the requirement surface:

| ID | Description | Research Support |
|----|-------------|-------------------|
| DEFECT-1 | Risk profile marker labels (γflip/put wall/call wall) collide when levels cluster within ~60 SPX pts | `assignLabelRows()` pattern (Architecture Patterns §1), reuses `pinMarker()` unmodified, no new deps |
| DEFECT-2 | Left-rail macro rows hard to scan raw numbers | `RegimeGauge` component reusing `CandidateCard` bar-track pattern; additive `bandWarn`/`bandCrisis` contract fields sourced from Phase 29's `resolveRegimeRuleConfig` (Architecture Patterns §2/§3) |
</phase_requirements>

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Gauge min/max display ranges per indicator should derive from `[warn * k1, crisis * k2]` with headroom multipliers (not fixed absolute numbers) | Common Pitfalls #4 | If the multiplier choice is wrong, the gauge marker could sit near an edge under normal conditions, defeating the "at a glance" goal — low risk, purely cosmetic, easy to tune post-ship (no data migration) |
| A2 | 3-row (not 2-lane-alternating) vertical stacking is the simplest provably-correct label layout for up to 3 simultaneous markers | Architecture Patterns §1 | If a future 5th+ marker type is added, more rows accumulate vertically above the chart's top edge — acceptable since CONTEXT caps the marker set at flip/putWall/callWall/spot(unlabeled) = effectively 3 labels max today |
| A3 | The `tracking-[0.08em]` vs `0.09em` inconsistency in `RegimeBoard.tsx` is out of CONTEXT's locked scope and should be planner-discretion, not auto-fixed | Common Pitfalls #3 | If left unfixed, a minor visual inconsistency persists; if silently "fixed" as a drive-by, violates the repo's `workflow.md` "no drive-by refactors" rule — safer to flag than to silently touch |

## Open Questions (RESOLVED)

1. **Should the gauge track show 3 discrete color segments (calm/warn/crisis bands) or 1 neutral
   track + 2 tick marks + 1 value marker?**
   - What we know: CONTEXT says "band edges NOT labeled with numbers by default... KISS" and
     wants "value marker position on track + current value as text."
   - What's unclear: whether the track itself should be visually pre-colored by band (3 solid
     color segments, like a classic bullet-graph "qualitative ranges") or stay neutral
     (`bg-raise`) with only 2 thin tick marks at the warn/crisis fractions and a colored dot
     marker (matching the existing `BAND_CLASSES` dot pattern already used in `Row`).
   - Recommendation: prefer the simpler neutral-track + 2-ticks + colored-dot-marker version —
     it reuses `BAND_CLASSES` verbatim (zero new color logic) and is the smaller diff; a 3-segment
     colored track needs the min/max range PLUS both thresholds to compute 2 extra segment widths,
     marginally more code for the same "how close to the edge" information the marker position
     already conveys. Leave this a plan-time call (Claude's Discretion per CONTEXT), not a
     blocking research gap.

## Environment Availability

**Skipped — no external dependencies.** This phase touches only files already present in the
repo (`apps/web`, `packages/core`, `packages/contracts`); no new CLI tools, runtimes, services,
or package installs are introduced. `bun`/`vitest`/`tsc`/`eslint` availability is an existing
project-wide precondition, not specific to this phase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (root `package.json:24`), per-package `test.projects` glob (`vitest.config.ts:8`) |
| Config file | `apps/web/vitest.config.ts` (jsdom environment, `@morai/*` workspace aliases) |
| Quick run command | `bun run test -- apps/web/src/components/charts/PayoffChart.test.tsx` (or `vitest run <path>` from repo root) |
| Full suite command | `bun run test` (root `vitest run`, all workspace projects) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| DEFECT-1 | `assignLabelRows` gives N distinct rows for N input markers, any x-values, any order | unit + fast-check property | `vitest run apps/web/src/components/charts/PayoffChart.test.tsx` | ❌ new `describe` block, same file (existing 977-line file already covers wall-pin tests at lines 523–582 — extend there) |
| DEFECT-1 | Real 2026-07-10 cluster (flip 7488 / putWall 7500 / callWall 7550 on a wide domain) renders 3 labels at 3 distinct `y` values | component/unit (render) | same file | ❌ new test case |
| DEFECT-1 | Existing `getByText("call wall")` / `getByText("call wall 8000 →")` / `wall-line-{key}` x1/x2 assertions (lines 531–581) still pass — label TEXT content unchanged, only `y` changes | regression | same file | ✅ already exists — must NOT need edits to `label` text, only possibly to `y` position expectations if any test asserts on `text`'s `y` attribute (currently none do; existing tests assert `x1`/`x2` and text content, not `y`, so this fix is additive-safe) |
| DEFECT-2 | `RegimeGauge` renders a marker positioned at the correct fraction of `[min, max]` for a given `value`, clamped to `[0,100]%` | unit + fast-check property | `vitest run apps/web/src/components/RegimeBoard.test.tsx` | ❌ new test — mirrors `regime.test.ts`'s existing fast-check-over-thresholds precedent (`packages/core/src/analytics/domain/regime.test.ts:186-` "monotonic under arbitrary thresholds") |
| DEFECT-2 | `bandWarn`/`bandCrisis` round-trip through `regimeIndicator.parse()` (Zod) | contract test | `vitest run packages/contracts/src/regime.test.ts` (or wherever contract tests live — none found today; may need a new file, see Wave 0 gap) | ❌ |
| DEFECT-2 | `getRegimeBoard.ts` populates `bandWarn`/`bandCrisis` from `resolveRegimeRuleConfig()` for all 4 indicators, including a Phase-29-overridden threshold | unit (extends existing use-case test) | `vitest run packages/core/src/analytics/application/getRegimeBoard.test.ts` | ✅ file exists, add assertions |
| DEFECT-2 | Existing `RegimeBoard.test.tsx` fixture-based tests (loading/empty/error/partial-data/tooltip/gate) still pass after `Row`'s value-half becomes `RegimeGauge` | regression | `vitest run apps/web/src/components/RegimeBoard.test.tsx` | ✅ existing — fixture `INDICATORS` (lines 34–71) will need `bandWarn`/`bandCrisis` added to satisfy the (now-required, non-optional) new Zod fields if the fixture is type-checked against `RegimeResponse` |

### Sampling Rate
- **Per task commit:** the single touched test file (`vitest run <file>`), per this repo's TDD
  red→green rule (`.claude/rules/tdd.md`) — every change here is source + test in the same commit.
- **Per wave merge:** `bun run test` (full workspace) + `bun run typecheck` + `bun run lint` —
  matches `workflow.md`'s "tests pass, typecheck clean, lint clean" done-bar.
- **Phase gate:** full suite green before `/gsd-verify-work 31`.

### Wave 0 Gaps
- No existing contract-level test file for `packages/contracts/src/regime.ts` was found (only
  the core use-case test and the web component test exercise the shape indirectly). If the
  planner wants a dedicated Zod round-trip test for the 2 new fields, it needs a new
  `packages/contracts/src/regime.test.ts` — otherwise the existing `getRegimeBoard.test.ts` (core)
  and `analytics.routes.test.ts` (server, exercises `regimeResponse.parse()` at the route boundary
  per line 173) already provide equivalent coverage without a new file. **Recommendation: skip
  the new contract file, rely on the two existing integration points — smaller diff, matches
  ponytail/CLAUDE.md "no scaffolding for later."**
- `packages/core/src/analytics/domain/regime.test.ts` already has the fast-check idiom to copy
  for `assignLabelRows`'s web-side property test (same `fc.float`/`fc.property` shape, different
  package) — no new test infra needed, `fast-check` is already root-hoisted and usable from
  `apps/web` with zero `package.json` change (see Package Legitimacy Audit).

*(No framework install needed — Vitest + fast-check + Testing Library are all already wired for
`apps/web` and `packages/core`.)*

## Security Domain

`security_enforcement: true` in `.planning/config.json:42`, so this section is required, but the
phase's actual security surface is minimal — no new endpoints, no new auth paths, no user input
beyond an already-parsed macro dataset.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | No change — existing Bearer-token `apiFetch` (`useRegimeBoard.ts:26`) unmodified |
| V3 Session Management | No | Unmodified |
| V4 Access Control | No | Unmodified — same route, same auth guard |
| V5 Input Validation | Yes | The 2 new `bandWarn`/`bandCrisis` fields go through the SAME Zod `regimeIndicator` schema (`packages/contracts/src/regime.ts`) already enforced at the route boundary (`analytics.routes.ts:173`, `regimeResponse.parse()`) — no hand-rolled parsing, `z.number()` per typescript.md's "parse, don't cast" rule |
| V6 Cryptography | No | Not applicable — no secrets/crypto touched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Client trusts a stale/attacker-influenced threshold value to render a misleading "calm" gauge | Tampering / Information Disclosure | Not applicable here — `bandWarn`/`bandCrisis` are read-only, server-computed values reflecting the CURRENT effective (possibly Phase-29-overridden) config; the client never writes these fields, and the existing rule-overrides write path (Phase 29) already has its own hard-validation gate (`.claude/rules/architecture-boundaries.md`, weight-sum validation precedent) — out of this phase's scope to re-verify, no new write surface introduced |
| Malformed/partial regime response (e.g. missing `bandWarn` on an old cached response mid-deploy) crashes the gauge render | Denial of Service (client-side) | `RegimeGauge` must treat `bandWarn`/`bandCrisis` as required (non-optional) Zod fields — `useRegimeBoard`'s `regimeResponse.parse()` will REJECT (throw, caught by React Query's `isError`) a stale-shape response outright rather than rendering with `undefined` math, which is the existing repo idiom (fail loud via Zod, not a silent NaN) — matches typescript.md's "parse, don't cast" and avoids Pitfall 2's "silently renders a broken gauge" failure mode |

## Sources

### Primary (HIGH confidence — direct file reads, this session)
- `apps/web/src/components/charts/PayoffChart.tsx` (full file, 979 lines) — marker rendering,
  `pinMarker`, wall layer, BE pill precedent, toggles/props
- `apps/web/src/components/charts/PayoffChart.test.tsx` (lines 1–70, 460–630) — existing marker
  test conventions, fixtures, `DOMAIN`
- `apps/web/src/components/RegimeBoard.tsx` (full file, 320 lines) — `Row`, `GateChip`,
  `RateRow`, `BAND_CLASSES`, layout tiers
- `apps/web/src/components/RegimeBoard.test.tsx` (lines 1–90) — existing fixture shape, mock
  conventions
- `apps/web/src/hooks/useRegimeBoard.ts` (full file) — query key, cache windows, error handling
- `packages/contracts/src/regime.ts` (full file) — current response schema (confirmed no
  threshold fields)
- `packages/core/src/analytics/application/getRegimeBoard.ts` (full file) — confirmed effective
  thresholds ARE computed (`resolveRegimeRuleConfig`) but discarded before response push
- `packages/core/src/analytics/domain/regime.ts` (full file) — `WARN`/`CRISIS` constants, banding
  functions, `RegimeThresholds` type
- `packages/core/src/analytics/domain/rule-config.ts` (grep + partial read) — `RegimeRuleConfig`
  shape (`vixTermStructure`/`vvix`/`vix9dRatio`/`hyOas`, each `RegimeThresholds`)
- `apps/web/src/components/picker/CandidateCard.tsx` (lines 1–250) — bar-track precedent to reuse
- `apps/web/src/components/CotCard.tsx` (lines 1–90) — second bar precedent
- `apps/web/src/index.css` (full file) — design tokens (`--color-up/down/amber/violet/blue`, etc.)
- `apps/web/src/components/system/index.tsx` (lines 1–60) — `Panel`/`SectionLabel`, `0.09em`
  tracking canon
- `apps/web/src/screens/Overview.tsx` (lines 1100–1265) — legend/toolbar chips, `PayoffChart`
  call site, no color override
- `apps/web/src/screens/Analyzer.tsx` (lines 800–840) — second `PayoffChart` call site, confirms
  shared-fix propagation
- `apps/web/src/screens/MarketRail.tsx` (full file) — `RegimeBoard` composition context
- `apps/server/src/adapters/http/analytics.routes.ts` (grep, line 165–173) — confirmed pass-
  through route, zero route changes needed
- `apps/web/vitest.config.ts`, `vitest.config.ts` (root), `package.json` (root, line 21
  `fast-check`) — test tooling confirmation, zero-new-dep confirmation
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`
- `git show b5155b6` — tracking-scale precedent commit, confirms `0.09em` is canonical

### Secondary (MEDIUM confidence)
- None — this research required no external/web sources; every claim is repo-internal.

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Gauge min/max range multipliers (A1) — training-knowledge judgment on reasonable headroom
  around existing warn/crisis constants, not verified against a specific numeric source this
  session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, every reused pattern read verbatim from this repo
- Architecture: HIGH — both defect sites fully read, exact line numbers cited, additive contract
  change confirmed by reading the discarding code path directly
- Pitfalls: HIGH for jsdom/caching (repo-verified precedent), MEDIUM for gauge-range pitfall
  (reasoning-based, not empirically measured)

**Research date:** 2026-07-10
**Valid until:** No expiry driver — this is an internal-code-only research artifact tied to the
current commit (`4230f63`); invalidated only by further edits to the 4 files above before this
phase is planned/executed.
