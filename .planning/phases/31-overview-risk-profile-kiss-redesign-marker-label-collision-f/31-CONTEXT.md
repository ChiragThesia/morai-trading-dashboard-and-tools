# Phase 31: Overview Risk Profile KISS Redesign + Macro Band-Gauges - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Source:** User screenshots + requests 2026-07-10 ("UX is ass on the graph… KISS"; "gauge UI for the macro market data on the left… easy to read"). Gauge style (linear bullet, not dials) proposed by orchestrator, user accepted.

<domain>
## Phase Boundary

Two Overview readability fixes, both presentation-only:

1. **Risk Profile marker labels collide.** γflip / put wall / call wall / spot verticals can
   all land within ~60 SPX pts (0DTE-heavy days); their top-edge text labels overlap into
   unreadable garbage ("γflip pll call wall"). KISS the marker rendering.
2. **Left-rail macro numbers are hard to scan.** MARKET REGIME rows (VIX/VIX3M, VVIX,
   VIX9D/VIX, HY OAS) print raw values; the reader must remember each warn/crisis band.
   Replace with compact linear band-gauges (bullet style): value marker on a
   warn/crisis-colored track, so "how close to the edge" reads at a glance.

NOT in scope: any GEX math change (flip/wall computation verified data-consistent
2026-07-10: flip 7488 = profile zero-crossing, putWall 7500 = max put OI ≤ spot;
putWall>flip is legitimate 0DTE-era structure). No wall-picking policy change this phase —
changing wall selection would silently change gexFit scoring inputs; if 0DTE
exclusion/discount is ever wanted it is its own evidence-gated phase. No new data,
endpoints, or contracts expected (regime warn/crisis thresholds already flow to the web
via the regime response / effective rule config from Phase 29).
</domain>

<decisions>
## Implementation Decisions

### USER LOCKED
- KISS: fewer/cleaner chart chrome elements; marker labels must never overlap regardless
  of how tightly the levels cluster.
- Left-rail macro rows become linear band-gauges (bullet style) — NOT circular dials —
  compact enough to keep the rail's density.
- No GEX math changes (user's "why is flip after put wall" answered: data-consistent).

### ORCHESTRATOR RESOLVED (do not reopen)
- Wall-picking policy: unchanged this phase (documented above).
- Gauges apply to the four banded regime indicators (VIX/VIX3M, VVIX, VIX9D/VIX, HY OAS).
  Rates block (FED FUNDS/SOFR/1M/3M/10Y−2Y/10Y−3M) and COT stay typographic — they have no
  warn/crisis semantics to gauge.
- Gauge bands use the EFFECTIVE regime thresholds (Phase 29 overrides-aware), not
  hardcoded copies — single source of truth.

### Claude's Discretion
- Label collision strategy for chart markers: e.g. legend-only labels + unlabeled
  verticals, staggered two-row label lanes, collision-detecting horizontal shift with
  leader ticks, or abbreviations at the axis instead of the top edge. Pick the simplest
  that provably cannot overlap (a property/unit test with clustered levels).
- Whether spot keeps its solid line treatment (probably yes — it is the anchor).
- Gauge visuals: track width/height, band coloring (calm→warn→crisis using existing
  design tokens), value marker shape, min/max scale choice per indicator (fixed sensible
  ranges so the marker doesn't jitter), ARIA semantics. Follow the repo design system
  (Panel/PanelHeading, tracking scale, muted grays + up/down tones; Phase 21 Button
  conventions for any interactive bits).
- Whether the Analyzer's Risk Profile (same PayoffChart) gets the same marker fix
  automatically (it should — the fix lives in PayoffChart, shared).
- Component test strategy per repo web-test conventions.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Chart markers (defect 1)
- `apps/web/src/components/charts/PayoffChart.tsx` — `pinMarker` + marker label rendering
  (top-edge text for γflip/put wall/call wall; spot line); Phase 30 made the x-domain
  dynamic — labels must work for ANY domain
- `apps/web/src/screens/Overview.tsx` + `apps/web/src/screens/Analyzer.tsx` — PayoffChart consumers
- User screenshot evidence 2026-07-10: flip 7488 / putWall 7500 / spot 7544 / callWall 7550
  all within 62 pts → "γflip put wall call wall" text pile-up

### Left-rail macro gauges (defect 2)
- `apps/web/src/screens/RegimeBoard.tsx` (or wherever MARKET REGIME rows render — verify)
  — current typographic rows with source-and-rationale info buttons (keep those buttons)
- `packages/core/src/analytics/domain/regime.ts` — warn/crisis thresholds (VIX_TERM_STRUCTURE
  0.9/0.95, VVIX 100/115, VIX9D_RATIO 1.0/1.1, HY_OAS 3.0/5.0) + Phase 29 rule-config
  overrides; check what the regime API response already carries (bands included?) —
  if thresholds aren't in the response, add them additively (contract change) rather than
  hardcoding client-side
- `apps/server/src/adapters/http/analytics.routes.ts` + `packages/contracts` regime response shape

### Design system
- `docs/` design-system docs if present; `apps/web/src/components/system/Button.tsx`
  (Phase 21 conventions); existing Panel/PanelHeading components; 0.09em tracking scale
  (commit b5155b6); dataviz principles: linear bullet gauges, muted track, banded
  thresholds, no radial dials
- `.claude/rules/` — hexagon, TDD, typescript

### Recent phases (context)
- Phase 30 SUMMARYs — PayoffChart now takes a `domain` prop; don't regress
- Phase 29 — effective rule config plumbing (regime thresholds overridable)
</canonical_refs>

<specifics>
## Specific Ideas

- Marker-label non-overlap must be a TESTED invariant: feed the real 2026-07-10 cluster
  (7488/7500/7544/7550 on a 7100–8050 domain) plus a fast-check property (any 4 levels in
  any domain → no overlapping label boxes).
- Gauge reads at a glance: value marker position on track + current value as text; band
  edges NOT labeled with numbers by default (tooltip/info button keeps detail) — KISS.
- If regime response lacks band values, prefer additive contract fields (bandWarn,
  bandCrisis per indicator) sourced from effective config server-side.
</specifics>

<deferred>
## Deferred Ideas

- 0DTE exclusion/discount in wall picking (own evidence-gated phase if ever)
- Gauges for rates/COT (no band semantics)
- Any GEX chart data changes
</deferred>

---

*Phase: 31-overview-risk-profile-kiss-redesign*
*Context gathered: 2026-07-10 from user screenshots + accepted gauge proposal*
