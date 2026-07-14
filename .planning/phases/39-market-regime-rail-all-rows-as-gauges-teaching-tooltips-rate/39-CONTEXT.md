# Phase 39: Market Regime Rail — All Rows as Gauges + Teaching Tooltips - Context

**Gathered:** 2026-07-13 (user-directed, decisions made in-conversation)
**Status:** Ready for planning

<domain>
## Phase Boundary

Two user asks on the Overview MARKET REGIME rail:
1. **All rows as gauges, not numbers.** The 4 regime indicators already render as
   banded bullet gauges (Phase 31/38). Extend the same gauge treatment to the
   remaining number rows: the rates block (Fed funds, SOFR, 1M, 3M, 10Y−2Y,
   10Y−3M) and the COT positioning rows (dealer, asset mgr, leveraged, other
   rept, non-rept).
2. **ⓘ tooltips teach.** Every indicator's tooltip explains WHAT it measures and
   WHY it matters — not just provenance.

Out of scope: any change to regime gates/verdicts/bands math, EntryGate chip,
mobile stat-grid market section (rail is desktop; mobile follows only if the
components are shared), backend/contracts.

</domain>

<decisions>
## Implementation Decisions

### Gauge scope — "All rows, evidence-aware" (user-picked 2026-07-13)
- Yield-curve spreads (10Y−2Y, 10Y−3M): REAL warn/crisis bands — inversion is
  documented evidence (negative spread = inverted curve; band thresholds and
  citations authored per the Phase-24 evidence discipline, added to the
  regime-board evidence doc BEFORE encoding — docs-before-code).
- Fed funds, SOFR, 1M, 3M bills, COT rows: NEUTRAL position-only tracks —
  marker on a fixed visual range, NO verdict colors, NO warn/crisis segments.
  The regime board's evidence law stands: no verdict-coloring without
  documented research. A neutral track communicates position without judgment.
- COT gauge axis: positioning value on a symmetric fixed visual range (e.g.
  ±1M contracts, authored per series from historical extent) — neutral track,
  WoW delta arrow kept.
- Visual idiom: reuse the EXISTING regime-row bullet-gauge component/idiom
  (GAUGE_SCALE map + clampedAxisPct + meter a11y role in RegimeBoard.tsx) —
  extract/share rather than reinvent; neutral variant = same track minus band
  segments.

### Tooltip content — "What + why + bands + source" (user-picked)
Every gauge row's ⓘ tooltip gets four parts, in order:
1. WHAT: plain-English, 1-2 sentences — what the indicator measures.
2. WHY: 1-2 sentences — how it matters for THIS user's SPX calendar trading
   (vol regime, term structure, credit stress, positioning context).
3. BANDS: what warn/crisis thresholds mean (banded rows only; neutral rows
   say what the range shows instead).
4. SOURCE: the existing provenance line (source + threshold rationale) kept
   at the bottom, visually quiet.
- Copy sourced from knowledge-base/ (READ-ONLY reference) and the regime-board
  evidence doc — accuracy over flourish, Hemingway style. Copy is LOCKED at
  UI-SPEC/plan time (listed verbatim in the plan) so executors don't improvise
  financial explanations.

### Laws carried
- Display-live/gate-EOD untouched (Phase 38) — gauges are display only.
- Evidence discipline (Phase 24): new BANDS only with documented citations,
  added to the evidence doc first.
- Catch #26 honesty: live-tint rules unchanged; neutral tracks show EOD values
  with existing freshness footer semantics.
- Rates/COT keep their as-of provenance from existing responses; no new data.

### Claude's Discretion
- Exact visual ranges for neutral tracks (authored from sensible historical
  extents, documented in code comments), tooltip layout/width, whether COT
  section header keeps the current table or each row gains a track inline,
  component extraction shape (shared BulletGauge vs local variant).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- apps/web/src/components/RegimeBoard.tsx — Row component with banded bullet
  gauge: GAUGE_SCALE visual axis (:101), axisPct/clampedAxisPct, meter role
  a11y (aria-valuenow clamped, aria-valuetext true value), BAND_CLASSES,
  shadcn Tooltip already wired (:8-12, provenance at :177+).
- apps/web/src/components/CotCard.tsx — COT rows (dealer/asset-mgr/leveraged/
  other/non-rept, WoW arrows).
- Rates grid — 2-col label/value grid inside RegimeBoard (former MacroCard).
- docs/ regime evidence doc (regime-board.md from Phase 24) — evidence table
  to extend for yield-curve inversion bands.
- knowledge-base/ — read-only trading knowledge for tooltip copy.

### Established Patterns
- Evidence table + refutations doc pattern (24-01).
- Phase-29 rule overrides: regime band thresholds flow from the response
  (indicator.bandWarn/bandCrisis) — yield-curve bands, if server-computed,
  would follow that path; if client-visual-only, document why. NOTE: rates
  come from the macro response (not regime indicators) — adding real BANDS to
  10Y−2Y/10Y−3M may need them promoted to regime indicators server-side OR a
  client-side banded display with thresholds as named constants + citations.
  Planner decides with research; keep the gate BLIND to them either way (no
  new gate inputs — display only).

### Integration Points
- RegimeBoard renders inside MarketRail (Overview left rail).
- Mobile: MobileMarketSection is a separate stat-grid — check whether it
  shares these components; if not shared, desktop-only per phase boundary.

</code_context>

<specifics>
## Specific Ideas

- User: "the information symbol should EXPLAIN exactly how it matters. What it
  is and how it matters." — teaching tooltips are the point; a trader glancing
  at the rail should learn what each dial means without leaving the app.
</specifics>

<deferred>
## Deferred Ideas

- Verdict bands for Fed funds/SOFR/COT (needs researched evidence first —
  user chose not to override the evidence law).
- Mobile market section gauge parity (if components turn out unshared).
</deferred>
