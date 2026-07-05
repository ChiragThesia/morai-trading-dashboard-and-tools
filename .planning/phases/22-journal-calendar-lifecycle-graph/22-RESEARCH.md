# Phase 22: Journal Calendar-Lifecycle Graph - Research

**Researched:** 2026-07-05
**Domain:** Hexagonal read-path enrichment (forward-vol + P&L attribution) over an existing
per-calendar snapshot series, rendered as a multi-panel visx SVG chart.
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — HERO = P&L ATTRIBUTION over time.** Top/dominant panel decomposes P&L into theta /
  vega / delta-gamma buckets PLUS an explicit unexplained RESIDUAL, over the trade's life. Must
  make the gamma-vs-theta collision near front expiry visible.
- **D-02 — The edge is implied FORWARD VOL, NOT the naive front-minus-back IV spread.** Plot
  front IV, back IV, implied forward vol, and the front/back ratio as DISTINCT series; never a
  blended/averaged vol line.
- **D-03 — Greeks are SIGNED small-multiples, each on its own axis.** Delta / gamma / theta /
  vega each get their own panel. Surface long-vega / short-gamma / +theta signature and the
  theta/gamma sign-flip.
- **D-04 — TIME on the x-axis; realized history entry→now/exit.** All panels share one date
  axis and a synced crosshair.
- **D-05 — Honest data.** Feed gaps (spot=0 / NaN snapshots) render as LINE BREAKS, never
  interpolated. The attribution residual is always shown, never hidden.
- **D-06 — Attribution is per-interval (local), accumulated.** Each interval's P&L ≈ greek ×
  move in its variable (theta×Δt, vega×ΔIV, delta×ΔS + ½·gamma×ΔS², …), summed over the life;
  an explicit residual absorbs cross-terms and higher-order error. Pick ONE decomposition
  convention and document it.
- **D-07 — Forward vol formula:** σ_fwd = sqrt( (σ_back²·t_back − σ_front²·t_front) /
  (t_back − t_front) ), computed per snapshot from front/back IV + DTEs.
- **D-08 — Layout:** stacked column — (1) P&L attribution (hero), (2) vol & term structure,
  (3) four signed greek small-multiple rows, (4) price vs strike. Right rail: P&L bridge,
  the forward-vol read, the greek signature, the beats.
- **D-09 — One calendar at a time.** A calendar picker (list_calendars — open + closed) drives
  the graph.

### Claude's Discretion
- Exact panel heights, crosshair/tooltip mechanics, event-annotation styling.
- Whether forward-vol + attribution compute in a core use-case (hexagon) or client-side.
  **This research answers that question — see "Compute Path" below: core use-case.**
- Horizon-graph vs simple signed sparkline for the greek rows.

### Deferred Ideas (OUT OF SCOPE)
- Rule-tag (RULE-01) overlay as event beats on the lifecycle timeline.
- Multi-calendar comparison / small-multiples across trades.
- IV surface / full term-structure ribbon at a point-in-time.
- Realized-vs-implied move overlay, GEX walls at each snapshot.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| JRNL-01 | Per-calendar lifecycle graph — P&L attribution hero, vol term structure (front/back/forward), signed greek small-multiples, price vs strike, honest gaps, read-only over existing snapshot series | Compute-path recommendation (core use-case, zero new ports), forward-vol formula reuse pattern, attribution decomposition + residual convention with an exact accumulation-identity property test, route/contract/MCP wiring precedent, gap-detection rule verified against the actual write-path (`buildSnapshotRow`) |
</phase_requirements>

## Summary

This phase adds exactly two computed layers (forward vol, per-interval P&L attribution) on top
of a snapshot series that already exists and is already fully typed (`SnapshotResponse`). Nothing
about the underlying architecture is novel: Phase 19 (`getPicker`) and Phase 20
(`getCalendarEventsWithRules`) both establish the "thin core use-case wraps an existing driven
port, adds pure domain computation, exposed via HTTP route + MCP tool" shape this phase should
copy. The forward-vol formula is not new either — `computeFwdIv` already exists in
`packages/core/src/picker/domain/fwd-iv.ts` with the exact D-07 formula, DTE-in-days signature,
and negative-radicand guard already correct. Journal's `dteFront`/`dteBack` columns are already
integer calendar-days, so it plugs in directly with zero unit conversion.

The one piece of real domain work is the attribution decomposition (D-06), and the codebase
constrains it more than CONTEXT.md's open question implies: `calendar_snapshots` stores only
**net** (position-level, already qty×100-scaled) greeks — there are no historical per-leg
(front/back) vega columns. That means the vega bucket cannot be split by leg after the fact; it
must use `netVega` against a single blended ΔIV. This research recommends that approximation
explicitly, with the residual (which is defined as the exact plug value) absorbing the error —
this is not a compromise invented here, it is exactly what D-05's "residual is a 2nd-order
approximation, never hidden" already anticipates. Framed this way, the residual is definitionally
exact: `residual[i] = ΔpnlOpen[i] − theta[i] − vega[i] − deltaGamma[i]`, which gives a clean,
falsifiable property test (sum of all four buckets across any span of intervals equals the actual
`pnlOpen` change over that span) instead of a fuzzy "should approximately explain the P&L" test.

One data-contract correction: CONTEXT.md flags `pnlOpen` as "cents; verify." It is **dollars**,
not cents — verified against `buildSnapshotRow`'s `(netMark - cal.openNetDebit) * cal.qty * 100`
(the `×100` is the option contract multiplier, not a cents conversion) and against the existing
`SnapshotTable`/`LifecycleSection` UI code, which already renders `pnlOpen` directly with a `$`
prefix and no `/100` division anywhere.

**Primary recommendation:** Build `getCalendarLifecycle` as a hexagon-pure core use-case in
`packages/core/src/journal/application/` that calls the *existing* `ForReadingJournal` port,
then maps the result through two new pure domain functions
(`computeForwardVol`, `computeAttributionSeries` in `packages/core/src/journal/domain/`). Expose
it via a new additive route `GET /api/journal/:calendarId/lifecycle` and a new MCP tool
`get_journal_lifecycle`, both parsed through one new additive Zod schema in
`packages/contracts/src/journal.ts`. No new port, no new adapter, no new in-memory twin, and no
new npm dependency are required.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Forward-vol computation (D-07) | API / Backend (`packages/core` domain) | — | Pure numeric function over already-fetched data; must be fast-check property-tested per `tdd.md` ("numerical code... attribution" requires property tests), which needs a Vitest-testable module, not embedded browser logic |
| P&L attribution decomposition (D-06) | API / Backend (`packages/core` domain) | — | Same testability requirement; also MCP-reusable (Claude Code can query `get_journal_lifecycle` directly without a browser) |
| Snapshot series read (existing) | API / Backend (`packages/adapters/postgres`) | — | Unchanged — `ForReadingJournal` port, already built, already tested |
| Gap detection / honest-data typing | API / Backend (contract + domain) | Browser (chart rendering) | The *classification* (isGap: true/false) is a pure domain concern computed once, server-side; the *rendering* of that flag as a broken SVG path is a client concern (visx `LinePath` `defined` accessor) |
| Chart rendering (stacked panels, crosshair, tooltip) | Browser / Client (`apps/web`) | — | Pure presentation over the already-computed enriched series; matches `PayoffChart.tsx` precedent |
| Calendar picker (D-09) | Browser / Client (`apps/web`, existing) | API (`list_calendars`, existing) | Already shipped — `JournalContainer.tsx` + `useCalendars()`; this phase touches neither |

## Standard Stack

### Core
No new libraries. This phase is 100% additive code inside the existing stack:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `visx` (`@visx/shape`, `@visx/curve`, `@visx/scale`, `@visx/gradient`, `@visx/group`, `@visx/event`) | already installed (UI-SPEC confirms, matches `PayoffChart.tsx`) | Chart primitives — `LinePath`, `scaleLinear`, `localPoint` crosshair mapping | Locked chart primitive per `PayoffChart.tsx`'s own doc comment; UI-SPEC explicitly states zero new chart dependency |
| `zod` | existing (`packages/contracts`) | Enriched lifecycle response schema | Same MCP-02 "one schema source" discipline as every other contract in this repo |
| `fast-check` `^4.8.0` | existing (root `package.json`) | Property tests for forward-vol guard + attribution accumulation identity | `tdd.md` explicitly names "attribution" and "greeks" as requiring fast-check property tests |
| `vitest` `^4.1.8` | existing (root `package.json`) | Test runner | Project standard |

### Supporting
None — no new supporting libraries needed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server-side (core use-case) compute | Client-side compute in a web hook/lib function | Rejected: `tdd.md`'s numerical-code rule requires fast-check property tests, which are far more natural in a Vitest-testable `packages/core` module than embedded in a React hook; also loses MCP reusability (Claude Code could not query the enriched series directly) and duplicates logic if a future non-web consumer needs it |
| Duplicating `computeFwdIv`'s formula into journal's own domain | Importing `packages/core/src/picker/domain/fwd-iv.ts` directly from journal's use-case | Rejected: `architecture-boundaries.md` rule 7 forbids importing another bounded context's `domain/` directly. Relocating it to `@morai/quant` (the pure-leaf package, mirroring the existing `bsm.ts` shim precedent) is the "correct" long-term fix but touches Phase 19's picker context for a phase that doesn't need to; duplicating five lines of pure, dependency-free math is the smaller-blast-radius, "surgical changes" choice for this phase. Flag the duplication in a code comment cross-referencing the picker copy. |
| Extending `GET /api/journal/:calendarId` in place | New `GET /api/journal/:calendarId/lifecycle` route | Extending in place changes an existing MCP-02-shared schema (`journalResponse`) that both the HTTP route and the `get_journal` MCP tool already consume — adding heavy computed fields there would slow down every existing `get_journal` caller (including MCP/Claude Code queries that don't need the chart data) for no benefit. A new sub-route is exactly the pattern `journal-rules.routes.ts` already established for `GET /api/journal/:calendarId/rules`. |

**Installation:** None required.

**Version verification:** No new packages — nothing to verify against a registry.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new npm dependencies (UI-SPEC §Design System states
this explicitly; confirmed by reading `PayoffChart.tsx`'s existing `visx` imports, which are the
same primitives this phase's chart reuses). No `npm install` step exists in this phase's plan.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ apps/web (Browser)                                                       │
│                                                                           │
│  Journal.tsx (left picker, unchanged)                                    │
│        │ selects calendarId                                              │
│        ▼                                                                 │
│  useLifecycle(calendarId)  ── GET /api/journal/:calendarId/lifecycle ───┐│
│        │ parses via lifecycleResponse (Zod)                             ││
│        ▼                                                                ││
│  LifecycleChart.tsx (rewrite) ──renders──▶ stacked SVG panels            ││
│        │                                    (attribution hero, vol,     ││
│        │                                     4 greek small-multiples,   ││
│        │                                     price vs strike)           ││
│        ▼                                                                ││
│  LifecycleMasthead / PnlBridgeCard / EdgeCard / GreeksNowCard /          ││
│  BeatsCard  (crosshair-reactive rail, reads same enriched series)        ││
└───────────────────────────────────────────────────────────────────────┼─┘
                                                                          │
┌─────────────────────────────────────────────────────────────────────────┐
│ apps/server (API — JWT-gated authReadGroup, same as existing            │
│ journalRoutes / journalRulesRoutes)                                     │
│                                                                          │
│  journalLifecycleRoutes  ── calls ──▶  getCalendarLifecycle (use-case) │
│  get_journal_lifecycle MCP tool ────┘                                  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│ packages/core/journal (hexagon — pure, no I/O)                          │
│                                                                          │
│  getCalendarLifecycle.ts (application, NEW)                            │
│    1. calls existing ForReadingJournal(calendarId)  ── unchanged port ─┐│
│    2. ok(null)/ok([])/err(...) passthrough — same as getJournal.ts     ││
│    3. maps ok([...rows]) through:                                      ││
│         computeForwardVol(row) ──▶ per-snapshot fwd-vol domain/fwd-vol.ts│
│         computeAttributionSeries(rows) ──▶ cumulative buckets           ││
│           domain/attribution.ts                                        ││
└──────────────────────────────────┬───────────────────────────────────────┘
                                    │ (unchanged)
┌───────────────────────────────────▼─────────────────────────────────────┐
│ packages/adapters/postgres — makePostgresCalendarSnapshotsRepo          │
│   readJournal: SELECT calendar_snapshots ORDER BY time ASC              │
│   (no schema change — this phase reads only)                            │
└───────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/core/src/journal/
├── domain/
│   ├── fwd-vol.ts              # NEW — duplicated D-07 formula, DTE-in-days, tagged guard
│   ├── fwd-vol.test.ts         # NEW — example + fast-check (mirror fwd-iv.test.ts)
│   ├── attribution.ts          # NEW — per-interval decomposition + cumulative accumulation
│   └── attribution.test.ts     # NEW — example + fast-check accumulation-identity property
├── application/
│   ├── getCalendarLifecycle.ts       # NEW — thin use-case: readJournal + map through domain fns
│   └── getCalendarLifecycle.test.ts  # NEW — mirrors getCalendarEventsWithRules.test.ts

packages/contracts/src/
└── journal.ts                  # EDIT (additive) — new lifecycleSnapshotResponse + lifecycleResponse

apps/server/src/adapters/
├── http/journal.routes.ts      # EDIT (additive) — new GET .../lifecycle sub-route,
│                                  OR new sibling file journal-lifecycle.routes.ts (either is
│                                  consistent with the journal-rules.routes.ts precedent)
└── mcp/tools.ts, server.ts     # EDIT (additive) — registerGetJournalLifecycleTool

apps/web/src/
├── hooks/useLifecycle.ts       # NEW — mirrors useJournal.ts poll/parse pattern
└── components/
    ├── LifecycleChart.tsx      # REWRITE — D-08 stacked-panel engine (per UI-SPEC)
    ├── LifecycleMasthead.tsx   # NEW
    ├── PnlBridgeCard.tsx       # NEW
    ├── EdgeCard.tsx            # NEW
    ├── GreeksNowCard.tsx       # NEW
    └── BeatsCard.tsx           # NEW
```

### Pattern 1: Thin forwarder use-case wrapping an existing port
**What:** A `makeXxxUseCase(deps)` factory that calls an *already-existing* driven port and maps
its `Result` through pure domain functions, with zero new I/O.
**When to use:** Whenever new derived data can be computed entirely from data an existing port
already returns (this phase's exact situation — `SnapshotRow[]` already contains everything
`computeForwardVol`/`computeAttributionSeries` need).
**Example (adapted from `getPicker.ts` / `getJournal.ts`):**
```typescript
// packages/core/src/journal/application/getCalendarLifecycle.ts
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingJournal, SnapshotRow, StorageError } from "./ports.ts";
import { computeForwardVol } from "../domain/fwd-vol.ts";
import { computeAttributionSeries } from "../domain/attribution.ts";
import type { LifecycleSnapshot } from "../domain/attribution.ts";

export type GetCalendarLifecycleDeps = { readonly readJournal: ForReadingJournal };
export type ForRunningGetCalendarLifecycle = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<LifecycleSnapshot> | null, StorageError>>;

export function makeGetCalendarLifecycleUseCase(
  deps: GetCalendarLifecycleDeps,
): ForRunningGetCalendarLifecycle {
  return async (calendarId) => {
    const result = await deps.readJournal(calendarId);
    if (!result.ok) return err(result.error);
    if (result.value === null) return ok(null);
    const fwdVols = result.value.map(computeForwardVol);
    const attribution = computeAttributionSeries(result.value);
    return ok(result.value.map((row, i) => ({ ...row, ...fwdVols[i], ...attribution[i] })));
  };
}
```

### Pattern 2: Tagged guard result for a possibly-undefined numeric (D-07 negative radicand)
**What:** Never return `NaN`; return a discriminated union so the caller must branch.
**When to use:** Any BSM/vol-math function whose domain can go negative under real market
conditions (term-structure inversion).
**Example (from the existing, directly analogous `computeFwdIv`):**
```typescript
// Source: packages/core/src/picker/domain/fwd-iv.ts (existing, verified)
export type FwdIvResult =
  | { readonly fwdIv: number; readonly guard: "ok" }
  | { readonly fwdIv: null; readonly guard: "inverted" };

export function computeFwdIv(tf: number, ivf: number, tb: number, ivb: number): FwdIvResult {
  const rad = (tb * ivb * ivb - tf * ivf * ivf) / (tb - tf);
  if (rad < 0) return { fwdIv: null, guard: "inverted" };
  return { fwdIv: Math.sqrt(rad), guard: "ok" };
}
```
Journal's `dteFront`/`dteBack` (integer calendar-days) map directly onto `tf`/`tb`; `frontIv`/
`backIv` (decimal fractions, e.g. `"0.20"`) map directly onto `ivf`/`ivb` — no unit conversion.
Duplicate this exact shape as `computeForwardVol` in journal's own domain (see Alternatives
Considered above for why duplicate rather than import).

### Pattern 3: Gap-aware SVG line via visx `defined` accessor
**What:** `@visx/shape`'s `LinePath` accepts a `defined` accessor (same as d3-shape) that skips
points, creating a natural path break — this replaces the mockup's hand-rolled `bpath()` helper
that manually walks `M`/`L` commands and calls `flush()` at each gap.
**When to use:** Every panel in this chart (hero stack, vol/term structure, 4 greek
small-multiples, price-vs-strike) needs this for D-05 honest gaps.
**Example:**
```typescript
// apps/web/src/components/LifecycleChart.tsx (new pattern for this phase)
import { LinePath } from "@visx/shape";

<LinePath
  data={enrichedSeries}
  x={(d) => xScale(d.time)}
  y={(d) => yScale(d.attribution.cumTheta)}
  defined={(d) => !d.isGap}   // <- visx skips gap points, breaking the path naturally
  curve={curveMonotoneX}
  stroke={THETA_COLOR}
/>
```
For the stacked-area fills (which `LinePath` doesn't cover), port the mockup's manual
`areaSeg`/`flush()` path-building approach directly — visx has no first-class "gap-aware area"
primitive, so the hand-rolled segment-and-flush technique from `mockups/journal-lifecycle-v3.html`
(lines 198-206) is the correct implementation to carry over, translated to TS.

### Anti-Patterns to Avoid
- **Returning `NaN` from any new computed field.** `JSON.stringify(NaN)` silently serializes to
  `null` with no error — a silent-corruption footgun distinct from the intentional `isGap`/`guard`
  typed markers this phase requires. Every new domain function must return `null` + a boolean/enum
  tag, never a bare `NaN`, mirroring `computeFwdIv`'s pattern exactly.
- **Interpolating across a gap "just for the stacked area fill."** D-05 is explicit: residual
  and gaps are both non-negotiable disclosures. A stacked-area fill that bridges a gap (even
  visually smoothing it) is a regression against this decision — flush the fill at the gap
  boundary exactly like the v3 mockup script already does.
- **Re-deriving BSM greeks from `leg_observations` for attribution.** The phase is explicitly
  "no new data collection" and the already-persisted `calendar_snapshots.net*` columns are
  sufficient for delta/gamma/theta; only the vega bucket needs an approximation (see Code
  Examples below) — do not build a second per-leg-BSM compute path just to "improve" vega
  precision; that is new scope this phase doesn't need.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Forward-vol formula | A fresh derivation of D-07 | Duplicate `computeFwdIv`'s exact 6-line body (verified correct, already fast-check tested for the identical formula) | Zero risk of a transcription bug; the existing implementation already resolved the radicand-exactly-0 edge case (`guard: "ok"`, not "inverted") that's easy to get wrong on a fresh read of the formula |
| Gap-aware line rendering | Hand-rolled SVG path-string builder (the mockup's `bpath()`) for `LinePath`-eligible series | `@visx/shape`'s `LinePath` `defined` accessor | Already part of the installed library; less code, matches how the rest of `apps/web`'s charts are built |
| Crosshair pixel-to-logical-space mapping | A new mapping formula | `PayoffChart.tsx`'s existing `localPoint` → `scaleX = SVG_W / svgRect.width` → `innerX` technique | UI-SPEC explicitly mandates reusing this exact technique; it already handles `preserveAspectRatio` scaling correctly |

**Key insight:** every piece of "hard" math or interaction plumbing this phase needs already has
a working, tested precedent somewhere in this exact codebase (Phase 17-19 payoff/picker work).
The actual net-new logic is narrow: two small pure functions (`computeForwardVol`,
`computeAttributionSeries`) and one new chart layout.

## Common Pitfalls

### Pitfall 1: Treating `pnlOpen` as cents
**What goes wrong:** Dividing displayed dollar values by 100 a second time, producing P&L numbers
100× too small.
**Why it happens:** CONTEXT.md flagged this field as needing verification ("pnlOpen is
unrealized P&L in cents"), and the `×100` in its write-path formula
(`(netMark - openNetDebit) * qty * 100`) looks superficially like a cents conversion.
**How to avoid:** The `×100` is the **option contract multiplier** (100 shares/contract), not a
currency-unit conversion. `pnlOpen` is already in dollars — confirmed by `buildSnapshotRow`
(`packages/core/src/journal/application/snapshotCalendars.ts:88`) and by the existing UI
(`Journal.tsx`'s `SnapshotTable` renders `parseFloat(s.pnlOpen).toFixed(2)` with a bare `$`
prefix, no division). Do not divide by 100 anywhere in the new attribution code.
**Warning signs:** A rendered net-P&L hero value of "+$0.36" instead of "+$36" on a trade whose
existing `realizedPnl`/`SnapshotTable` values are two orders of magnitude larger.

### Pitfall 2: Trying to split the vega bucket by front/back leg
**What goes wrong:** Attempting to compute `frontVegaExposure × ΔfrontIv + backVegaExposure ×
ΔbackIv` for a more "precise" vega bucket, then discovering there is no historical per-leg vega
column to multiply against.
**Why it happens:** `calendar_snapshots` stores `frontIv`/`backIv` (the *inputs* to IV) but only
`netVega` (the *combined, already-qty×100-scaled position vega output*) — the front/back vega
split that produced that net value is computed transiently in `snapshotCalendars.ts` and never
persisted per-leg.
**How to avoid:** Use `netVega[i] × Δ(mean(frontIv, backIv)) × 100` (the `×100` converts the
decimal IV delta to "vol points," matching `bsmGreeks().vega`'s "per 1 vol point" convention) as
the vega bucket. Document this as the locked convention; let the residual absorb the
front/back-divergence error this approximation introduces — that is exactly what D-05's residual
is for.
**Warning signs:** A plan task that adds new `frontVega`/`backVega` columns to
`calendar_snapshots` or re-runs BSM per-leg for historical rows — that is out of this phase's
"no new data collection" scope.

### Pitfall 3: Computing Δt from `dteFront`/`dteBack` instead of the actual snapshot timestamps
**What goes wrong:** `dteFront`/`dteBack` are integer, `Math.floor`-clamped calendar-day DTEs
(see `calendarDte` in `dte.ts`) — they are flat across every 30-minute intraday snapshot on the
same trading day, so `Δt = dteFront[i] - dteFront[i+1]` is `0` for most consecutive intervals,
making the theta bucket zero almost everywhere until a day boundary.
**Why it happens:** `dteFront`/`dteBack` were designed for display (integer "days left"), not for
interval math.
**How to avoid:** Compute `Δt` from the snapshot `time` field directly:
`(new Date(rows[i+1].time).getTime() - new Date(rows[i].time).getTime()) / 86_400_000` (fractional
days) — this gives a nonzero, correctly-scaled theta contribution for each 30-minute interval.
**Warning signs:** A cumulative theta line that looks like a staircase with long flat plateaus
instead of the smooth-then-collision curve D-01 requires.

### Pitfall 4: Gap detection missing the `netTheta`/`netVega`/`netDelta`/`netGamma` NaN case
**What goes wrong:** Only checking `spot === "0"` for gaps and missing rows where spot is valid
but the greeks are NaN-stamped (e.g. one leg resolved, the other didn't — D-06 in
`snapshotCalendars.ts`'s NaN-continuity rule means marks/pnlOpen can be valid while IV/greeks are
`"NaN"`).
**Why it happens:** The two NaN sources (missing leg entirely → `spot="0"`; one leg missing IV →
greeks NaN but marks still populate) are easy to conflate as "the same gap condition."
**How to avoid:** A snapshot is a gap for **attribution/vol purposes** when `spot === "0"` OR any
of `parseFloat(frontIv|backIv|netDelta|netGamma|netTheta|netVega)` is non-finite. `parseFloat`
handles this cleanly: `parseFloat("NaN")` returns JS `NaN`, so `Number.isFinite(...)` is a correct,
single check — no special-case string comparison against `"NaN"` is needed at the reading layer
(only the writing layer, `snapshotCalendars.ts`, needs the literal `"NaN"` string convention).
**Warning signs:** A "gap" that renders a straight line through clearly-NaN-looking data, or a
forward-vol computation that emits `Infinity`/`NaN` because it silently accepted a NaN input IV.

### Pitfall 5: Forgetting the JWT auth mount for the new route
**What goes wrong:** Registering the new `/lifecycle` sub-route on a router that isn't mounted
inside `authReadGroup`, accidentally exposing calendar P&L data unauthenticated.
**Why it happens:** `main.ts` mounts `journalRoutes`/`journalRulesRoutes` via
`.route("/", journalRoutes(getJournal))` inside `apiRouter`, which is itself nested under
`authReadGroup` (`app.route("/api", authReadGroup)`, `authReadGroup.route("/", apiRouter)`) — it's
easy to instead mount a new router directly on `app` by copying the wrong example.
**How to avoid:** Register the new lifecycle route/router the same way as the existing
`journalRoutes`/`journalRulesRoutes` — as an additional `.route("/", ...)` call feeding into
`apiRouter`, verified in `apps/server/src/main.ts` lines 271-273.
**Warning signs:** The new endpoint responds `200` with no `Authorization` header when tested
manually.

## Code Examples

### Attribution domain function shape (new, this phase)
```typescript
// packages/core/src/journal/domain/attribution.ts
// Pure domain: no I/O. Per-interval (D-06) decomposition, accumulated.
//
// Convention (locked by this research, confirm in plan): interval-START greeks are used for
// each interval's bucket (a forward-Euler / "sequential" convention) — netTheta[i], netVega[i],
// netDelta[i], netGamma[i] describe the position AS OF the start of interval [i, i+1].
//
// residual[i] is defined as the exact plug value:
//   residual[i] = ΔpnlOpen[i] - theta[i] - vega[i] - deltaGamma[i]
// This makes the accumulation identity exact by construction — the property test below is a
// tautology check on the implementation, not an approximation-quality check (which is inherent
// and separately documented as Pitfall 2).

export type AttributionInterval = {
  readonly theta: number;
  readonly vega: number;
  readonly deltaGamma: number;
  readonly residual: number;
};

export type LifecycleSnapshot = {
  readonly time: string;
  readonly isGap: boolean;
  readonly cumTheta: number;
  readonly cumVega: number;
  readonly cumDeltaGamma: number;
  readonly cumResidual: number;
};

function isGapRow(row: { spot: string; frontIv: string; backIv: string; netDelta: string; netGamma: string; netTheta: string; netVega: string }): boolean {
  if (row.spot === "0") return true;
  return [row.frontIv, row.backIv, row.netDelta, row.netGamma, row.netTheta, row.netVega]
    .some((v) => !Number.isFinite(parseFloat(v)));
}

// computeAttributionSeries(rows) walks consecutive pairs, skipping (never bridging) gap
// boundaries — flush semantics mirror the v3 mockup's areaSeg()/flush() pattern.
```

### Forward-vol per-snapshot mapping (duplicated from `computeFwdIv`)
```typescript
// packages/core/src/journal/domain/fwd-vol.ts
// Duplicated from packages/core/src/picker/domain/fwd-iv.ts (architecture-boundaries.md rule 7
// forbids importing another bounded context's domain/ directly; this formula is five lines of
// dependency-free pure math, so duplication is the surgical choice for this phase — see
// RESEARCH.md "Alternatives Considered" for the cross-package-refactor alternative).
export type ForwardVolResult =
  | { readonly forwardVol: number; readonly guard: "ok" }
  | { readonly forwardVol: null; readonly guard: "inverted" };

export function computeForwardVol(row: { dteFront: number; dteBack: number; frontIv: string; backIv: string }): ForwardVolResult {
  const tf = row.dteFront, tb = row.dteBack;
  const ivf = parseFloat(row.frontIv), ivb = parseFloat(row.backIv);
  if (!Number.isFinite(ivf) || !Number.isFinite(ivb) || tb === tf) {
    return { forwardVol: null, guard: "inverted" }; // treat NaN/degenerate DTE as the same non-computable case
  }
  const rad = (tb * ivb * ivb - tf * ivf * ivf) / (tb - tf);
  if (rad < 0) return { forwardVol: null, guard: "inverted" };
  return { forwardVol: Math.sqrt(rad), guard: "ok" };
}
```

### Enriched contract shape (additive, mirrors picker.ts's `fwdIv`/`fwdIvGuard`)
```typescript
// packages/contracts/src/journal.ts — ADD (do not modify existing journalResponse/snapshotResponse)
export const lifecycleSnapshotResponse = snapshotResponse.extend({
  isGap: z.boolean(),
  forwardVol: z.number().nullable(),
  forwardVolGuard: z.enum(["ok", "inverted"]),
  cumTheta: z.number().nullable(),
  cumVega: z.number().nullable(),
  cumDeltaGamma: z.number().nullable(),
  cumResidual: z.number().nullable(),
});
export const lifecycleResponse = z.object({ snapshots: z.array(lifecycleSnapshotResponse) });
export type LifecycleResponse = z.infer<typeof lifecycleResponse>;
```

## State of the Art

Not applicable in the "library upgrade" sense — nothing in this phase's stack has moved. The one
relevant "old→new" shift is internal to the project itself:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `LifecycleChart.tsx`'s 3-tab (P&L/Price/Greeks) + range-input scrubber | D-08 stacked-panel, single shared x-axis + crosshair (no tabs, no scrubber) | This phase | Full rewrite of `LifecycleChart.tsx`, not an incremental edit — UI-SPEC confirms "Same file, same import site... different internals and a different prop shape" |

**Deprecated/outdated:** The current `LifecycleChart.tsx` tab/scrubber UX and its `ModeChart`
helper are fully retired by this phase, per the UI-SPEC's Placement Decision.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vega bucket convention (`netVega × Δ(mean(frontIv,backIv)) × 100`) is the right blended-IV proxy, as opposed to e.g. `Δ(backIv)` alone or `Δ(termSlope)` | Code Examples / Pitfall 2 | If the planner/user prefers a different blend, the attribution's vega/residual split shifts (the *accumulation identity* still holds regardless of which proxy is chosen, since residual is defined as the exact plug — so this is a "which story does the narrative tell" risk, not a correctness risk) |
| A2 | Interval-start ("forward Euler") greeks convention, not interval-end or averaged, for each bucket | Code Examples | A different convention changes the exact bucket values shown (e.g. slightly different theta/vega split at the gamma-bite moment) but not the residual's plug-exactness; needs to be locked once and documented per D-06's "pick ONE decomposition convention" instruction |
| A3 | New route as `GET /api/journal/:calendarId/lifecycle` (vs. e.g. `GET /api/journal/:calendarId?enrich=lifecycle` query param) | Route Shape / Standard Stack | Low risk — this is purely a URL-shape preference; the `journal-rules.routes.ts` precedent supports a sub-path, not a query param, so this follows established convention |

**If empty:** N/A — see table above; all three items are implementation-detail choices within an
already-verified architecture, not open factual claims about external systems.

## Open Questions (RESOLVED)

*Both closed during Phase 22 planning; resolutions locked into plan acceptance criteria (22-02, 22-04, 22-06).*

1. **Exact vega-bucket blend formula (A1 above).**
   - What we know: `netVega` is the only available position-level vega scalar; front/back IV are
     both available per snapshot; no per-leg historical vega exists to split against.
   - What's unclear: whether `mean(frontIv, backIv)` change, `backIv` change alone (since the
     back leg dominates a calendar's net vega — it's the long leg), or `termSlope` change best
     matches the "long vega" narrative the masthead copy needs to tell.
   - **RESOLVED:** use `mean(frontIv, backIv)` as the default (symmetric, no leg-dominance
     assumption baked in); flag as a one-line tunable constant so it's trivial to change if the
     narrative reads oddly against real trade data during UAT. Locked in plan 22-02 as "the locked default".

2. **Whether `BeatsCard`'s event list needs SNAP-01 `trigger` data (event-move snapshots) or
   stays entry/close-only for this phase.**
   - What we know: `SnapshotRow.trigger` (`"scheduled" | "event-move" | null`) already exists
     (Phase 20, SNAP-01) and is exactly the kind of "the beats" marker the mockup shows (Jul 3
     "0.7% move" beat).
   - What's unclear: UI-SPEC explicitly defers this ("Data source... is explicitly not a visual-
     contract question — left to plan-phase"). This research confirms the data (`trigger` field)
     already exists in `SnapshotRow` and requires zero new plumbing to surface it — it's a "should
     we" (scope) question, not a "can we" (data availability) question.
   - **RESOLVED:** include `trigger === "event-move"` snapshots as beats if they exist for the
     selected calendar (cheap, already-available data); fall back to entry/close-only when none
     exist. Either way, no new backend work is needed beyond passing `trigger` through the
     existing `lifecycleSnapshotResponse` (it's already a `SnapshotRow` field via `snapshotResponse`).
     Locked in plans 22-04/22-06 (`trigger === "event-move"` beats, entry/close fallback).

## Environment Availability

Skipped — this phase has no external tool/service dependency. It reads an existing Postgres
table through an existing, already-tested repo; no new CLI, runtime, or service is introduced.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.8` + fast-check `^4.8.0` (root `package.json`, project-wide standard) |
| Config file | Root Vitest workspace config (existing — same config every prior phase's tests use) |
| Quick run command | `bunx vitest run packages/core/src/journal/domain/attribution.test.ts packages/core/src/journal/domain/fwd-vol.test.ts` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JRNL-01 | Forward-vol negative-radicand guard never returns NaN, tags `"inverted"` | unit + fast-check property (mirror `fwd-iv.test.ts`) | `bunx vitest run packages/core/src/journal/domain/fwd-vol.test.ts` | ❌ Wave 0 |
| JRNL-01 | Forward-vol radicand-exactly-0 is `"ok"` with `forwardVol: 0`, not `"inverted"` | unit example test | same file | ❌ Wave 0 |
| JRNL-01 | Attribution accumulation identity: sum of (theta+vega+deltaGamma+residual) across any contiguous non-gap span equals `pnlOpen[end] - pnlOpen[start]` exactly | fast-check property test | `bunx vitest run packages/core/src/journal/domain/attribution.test.ts` | ❌ Wave 0 |
| JRNL-01 | Gap detection: `spot="0"` OR any of frontIv/backIv/netDelta/netGamma/netTheta/netVega non-finite → `isGap: true`, and gap rows never contribute a numeric bucket value (interval spanning a gap is skipped, not zero-filled) | unit example tests | same file | ❌ Wave 0 |
| JRNL-01 | `getCalendarLifecycle` use-case: `ok(null)` on unknown calendarId, `ok([])` passthrough, `err(StorageError)` propagation (mirrors `getCalendarEventsWithRules.test.ts` shape) | unit test with in-memory `ForReadingJournal` double | `bunx vitest run packages/core/src/journal/application/getCalendarLifecycle.test.ts` | ❌ Wave 0 |
| JRNL-01 | `GET /api/journal/:calendarId/lifecycle` — 404 unknown calendar, 200 with the enriched shape, mounted inside the JWT-gated group | integration test (mirrors `journal.routes.test.ts`) | `bunx vitest run apps/server/src/adapters/http/journal.routes.test.ts` (extended) or a new sibling `*.test.ts` | ❌ Wave 0 (extend existing) |
| JRNL-01 | Crosshair sync between hero chart hover and `PnlBridgeCard` ("as of {day}" label swap) | UI-visual, manual/chrome-devtools UAT | none (not meaningfully unit-testable — visual/interaction) | manual-only, justified: pixel/interaction behavior |
| JRNL-01 | Line-break rendering at feed gaps (never interpolated) across all 5 panel types | UI-visual, manual/chrome-devtools UAT | none | manual-only, justified: SVG rendering correctness needs visual inspection; the underlying `isGap` boolean IS unit-tested above |

### Sampling Rate
- **Per task commit:** `bunx vitest run <touched test file>` (fast, <5s per the project's own
  velocity history for domain-only test files).
- **Per wave merge:** `bun run test` (full workspace suite).
- **Phase gate:** Full suite green before `/gsd-verify-work`; the two UI-visual rows above are
  flagged `human_needed` at that gate, consistent with `human_verify_mode: "end-of-phase"` in
  `.planning/config.json` and the standing chrome-devtools UAT permission already established for
  this project (memory `morai-gsd-uat-ui-chrome-devtools`).

### Wave 0 Gaps
- [ ] `packages/core/src/journal/domain/fwd-vol.test.ts` — covers JRNL-01 forward-vol guard
- [ ] `packages/core/src/journal/domain/attribution.test.ts` — covers JRNL-01 accumulation
      identity + gap handling
- [ ] `packages/core/src/journal/application/getCalendarLifecycle.test.ts` — covers JRNL-01
      use-case wiring
- [ ] Extend `apps/server/src/adapters/http/journal.routes.test.ts` (or add a sibling file) —
      covers JRNL-01 route contract
- Framework install: none — Vitest + fast-check already present project-wide.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no (unchanged) | Existing Supabase JWT auth on `authReadGroup`, already covers this route family |
| V3 Session Management | no (unchanged) | N/A — stateless bearer/JWT, unchanged |
| V4 Access Control | yes (unchanged pattern) | Single-user v1 model: unknown `calendarId` → 404, not 403 (T-03-14 precedent, reused verbatim) |
| V5 Input Validation | yes | `calendarId` path param handled the same way `journalRoutes`/`journalRulesRoutes` already do (DB lookup returns null → 404; no new validation surface introduced); response body Zod-parsed through `lifecycleResponse.parse()` before serialization (MCP-02 discipline) |
| V6 Cryptography | no | No new crypto — read-only computed data, no secrets involved |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| New route mounted outside the JWT-gated group (Pitfall 5 above) | Elevation of Privilege / Information Disclosure | Mount the new lifecycle route via the same `.route("/", ...)` composition into `apiRouter` → `authReadGroup` that `journalRoutes`/`journalRulesRoutes` already use (`apps/server/src/main.ts` lines 271-273) |
| Silent `NaN`→`null` JSON coercion masking a real computation bug as a legitimate gap | Tampering (data integrity) | Every new computed field returns an explicit `null` + a typed `guard`/`isGap` tag (never a bare `NaN`), so `lifecycleResponse.parse()` fails loudly (Zod rejects `NaN` against `z.number()`) instead of silently passing through as `null` |
| Flat `{error:"internal"}` error body leaking no DB internals | Information Disclosure | Reuse `journalRoutes`'s existing T-03-16 pattern verbatim for the new route's error branches |

## Sources

### Primary (HIGH confidence)
- `packages/core/src/picker/domain/fwd-iv.ts` + `fwd-iv.test.ts` — verified forward-vol formula,
  guard pattern, and property-test shape via direct file read (`Read` tool)
- `packages/core/src/journal/application/snapshotCalendars.ts` — verified `pnlOpen` unit (dollars,
  not cents), gap-writing (`NAN_STAMP`) convention, and net-greek scaling (`×qty×100`)
- `packages/adapters/src/postgres/schema.ts` — verified `calendar_snapshots` column list (no
  per-leg historical vega columns exist)
- `packages/core/src/journal/application/getJournal.ts`, `getCalendarEventsWithRules.ts`,
  `packages/core/src/picker/application/getPicker.ts` — verified thin-forwarder use-case pattern
- `apps/server/src/adapters/http/journal.routes.ts`, `journal-rules.routes.ts`, `main.ts` —
  verified route/contract/MCP wiring pattern and JWT-gated mounting
- `apps/web/src/components/charts/PayoffChart.tsx` — verified crosshair/`localPoint` mapping
  technique and visx idiom to reuse
- `apps/web/src/lib/deriveStreamStatus.ts` — verified "pure, test-first fn" precedent style
- `packages/core/src/journal/domain/dte.ts` — verified `calendarDte` is integer-floored (Pitfall 3)
- `.planning/phases/22-journal-calendar-lifecycle-graph/22-UI-SPEC.md` — approved UI contract
- `.claude/rules/architecture-boundaries.md`, `tdd.md`, `typescript.md`, `workflow.md` — project
  rules verified for compliance requirements

### Secondary (MEDIUM confidence)
None used — every claim in this research traces to a direct in-repo file read.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every primitive verified present in the repo
- Architecture: HIGH — the exact use-case/route/contract shape is copied from two already-shipped
  phases (19, 20) in this same codebase
- Pitfalls: HIGH — every pitfall traces to a specific line of already-existing code, not a
  hypothetical

**Research date:** 2026-07-05
**Valid until:** No external dependency drift risk (zero new packages); revalidate only if
`calendar_snapshots` schema or `SnapshotRow`/`snapshotResponse` contract changes before this phase
executes.
