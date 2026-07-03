# Phase 17: Overview v2 Redesign + IV Calibration Fix - Research

**Researched:** 2026-07-03
**Domain:** React/visx dashboard redesign (layout-only, contract already pinned) + wiring an
**already-shipped** BSM IV-inversion solver into the Analyzer scenario-engine's flat-IV path.
**Confidence:** HIGH — every claim below is grounded directly in this repo's code and tests
(`[VERIFIED: repo]`); no new external library or package is introduced by this phase.

## Summary

This phase has two very different research weights than the CONTEXT/PITFALLS docs assumed.

**OVW-01 (layout)** is fully pinned by `17-UI-SPEC.md` and `mockups/overview-v2.html` variant B.
Research here is a confirm-and-map exercise: which existing hooks/components satisfy each mount
point. All of them already exist and are already used on `Overview.tsx` or `Market.tsx` — this is
a rearrangement + one new interaction (row-highlight), not new data plumbing.

**OVW-02 (IV calibration) is the important finding.** The bisection/Newton-Raphson IV inverter
the CONTEXT and PITFALLS docs describe as something to *design* **already exists, is already
production-hardened, and is already used in two live pipelines**:
`packages/core/src/journal/domain/iv-inversion.ts` (`invertIv`), shipped in Phase 02 (commits
`cac2a01`, `5431ceb`), with 1000-run fast-check round-trip/monotonicity properties, explicit
bisection-fallback coverage (deep OTM, near-expiry), and a post-solve residual guard (WR-01) that
already collapses "fabricated endpoint-clamped IV" into a typed `err`. It is already the sole IV
source for the live SSE greek stream (`recomputeLiveGreek`, used by `apps/server`) and the batch
journal BSM job (`computeBsmGreeks`). **OVW-02 is an integration task — wire the existing solver's
already-tagged `Result<number, IvError>` into `scenario-engine.ts`'s flat `DEFAULT_IV`/`frontIv`/
`backIv` inputs — not a new-solver-design task.** This changes the phase's shape and risk profile
substantially versus what PITFALLS §4 anticipated (that pitfall's warnings about hand-rolled
Newton/bisection math are already retired by the existing module; the phase's new risk is scoping
the *consumer* wiring correctly, not the solver).

**Primary recommendation:** Reuse `invertIv` from `@morai/core` directly, client-side, in a new
`apps/web/src/lib/iv-calibration.ts` helper that `scenario-engine.ts` (or `Overview.tsx`) calls to
replace `DEFAULT_IV`. ESLint boundaries already permit `apps → core` (`{ from: "apps", allow: [
"adapters", "core", "contracts", "shared", "quant", "apps"] }`), and `invertIv`/`IvError` are
already exported at the `@morai/core` package root — no new port, no new HTTP route, no new
contract needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TOS-dock layout (pill header, payoff hero, docked table, GEX rail) | Frontend Server (SSR-less SPA / Browser) | — | Pure client rendering; all data already fetched by existing hooks (`usePositions`, `useGex`, `useStatus`, `useLiveStream`) |
| Row-highlight interaction (D-05) | Browser | — | Local component state (`useState`), no server round-trip, mirrors `AdHocPicker.tsx`'s `clearHovered` pattern |
| Per-leg IV calibration (bisection/Newton) | Browser (client-side, reusing `@morai/core`) | API/Backend (already computes the same thing for the live stream) | `invertIv` is a pure function (no I/O); ESLint already permits `apps→core`; avoids a new round-trip and duplicate solver |
| Live per-leg calibrated IV delivery | API/Backend (SSE) | Browser (REST-fallback bisection) | `StreamLiveGreekEvent.bsmIv` is **already computed server-side** by `recomputeLiveGreek` and streamed; browser only needs a fallback path for legs with no live tick yet |
| Staleness timestamp surfacing (D-03) | Browser | — | Pure display logic over already-fetched `computedAt`/`liveTs` fields; matches `Market.tsx`'s existing `relAge`/`GEX_FRESH_MS` pattern verbatim |
| GEX rail (dealer γ profile, GEX bars, key levels) | API/Backend (GEX computed server-side) | Browser (compact rendering) | `useGex()` already fetches `GET /api/analytics/gex`; Phase 17 only changes layout/sizing (`compact` props already exist on `GammaProfile`/`GexBars`) |

## Package Legitimacy Audit

**Not applicable — this phase installs zero new external packages.** Every primitive needed
(shadcn `badge`/`tooltip`/`tabs`/`card`, `@visx/*` chart libs, `fast-check`, `zod`) is already a
dependency, confirmed by direct inspection of `package.json`:

- `fast-check ^4.8.0` `[VERIFIED: repo package.json]` — already used by `iv-inversion.test.ts` and
  `scenario-engine.test.ts`.
- `@visx/shape @visx/curve @visx/scale @visx/gradient @visx/group @visx/event ^4.0.0`
  `[VERIFIED: repo package.json]` — already used by `PayoffChart.tsx`.
- `zod ^4.4.3`, `vitest ^4.1.8` `[VERIFIED: repo package.json]`.
- `@morai/core`, `@morai/quant`, `@morai/contracts`, `@morai/shared` — internal workspace
  packages, not registry installs.

No `npm view` / registry-legitimacy check is required — no new install occurs in this phase.

## Standard Stack

### Core (all pre-existing, reused)

| Module | Location | Purpose | Why it's the standard for this phase |
|--------|----------|---------|---------------------------------------|
| `invertIv` | `packages/core/src/journal/domain/iv-inversion.ts` | Price → IV inversion (Newton-Raphson + 200-step bisection fallback), returns `Result<number, IvError>` | Already production-hardened: 1000-run round-trip + monotonicity fast-check properties, explicit bisection-path tests (deep OTM call/put, near-expiry ATM), CR-03 European no-arb bound fix, WR-01 post-solve residual guard. `[VERIFIED: repo]` |
| `bsmPrice` / `bsmGreeks` / `bsmVega` | `packages/quant/src/bsm.ts` (re-exported `@morai/quant`) | Pure BSM leaf, zero deps | Already imported by `scenario-engine.ts`, `position-greeks.ts`, `recompute-live-greek.ts` — the "one shared kernel" (D-01 elsewhere in codebase) `[VERIFIED: repo]` |
| `recomputeLiveGreek` | `packages/core/src/streaming/recompute-live-greek.ts` | Wraps `invertIv` + `bsmGreeks` for one raw SSE tick; already returns `err({kind:"iv-failed"})` on non-convergence and the caller (server) simply **skips emitting an event** for that leg | Establishes the existing mid-price convention: `price = tick.mark ?? (bid+ask)/2` `[VERIFIED: repo]` |
| `useLiveStream()` | `apps/web/src/hooks/useLiveStream.ts` | SSE hook already called once in `Overview.tsx`; delivers `Map<occSymbol, StreamLiveGreekEvent>` where `StreamLiveGreekEvent.bsmIv` is the **already server-calibrated** per-leg IV | Zero new wiring needed to consume live-calibrated IV when a tick exists `[VERIFIED: repo]` |
| `PayoffChart` | `apps/web/src/components/charts/PayoffChart.tsx` | 9-layer visx payoff chart, already renders T+0/@exp/breakevens/GEX walls | Directly reusable for the payoff hero Panel; extend props for the dimmed/highlighted dual-curve mode (D-05), no new chart library |
| `Panel`, `SectionLabel`, `Stat`, `MetricChip` | `apps/web/src/components/system/index.tsx` | Locked Morai molecules | UI-SPEC mandates reuse, not recreation |
| `Badge`, `Tooltip` | `apps/web/src/components/ui/` | shadcn primitives, already installed | Used for "IV n/a" and staleness badges |

### Supporting

| Module | Location | When to use |
|--------|----------|-------------|
| `computePositionGreeks` | `apps/web/src/lib/position-greeks.ts` | Existing client-side per-leg greeks at a flat IV — pattern to mirror for the new calibration helper (same "parse OCC → call kernel → scale by qty" shape) |
| `resolveLivePositionRow` | `apps/web/src/lib/live-position-greeks.ts` | Existing live-vs-static per-row resolver; the calibration helper should slot in alongside this, not replace it |
| `relAge` / `GEX_FRESH_MS` (35 min) | `apps/web/src/screens/Market.tsx` | Reuse verbatim for both new staleness badges (D-03) — UI-SPEC already mandates this |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Client-side `invertIv` call reusing `@morai/core` | New server endpoint that pre-calibrates IV and returns it via a new contract/route | Rejected: duplicates a solver that already runs server-side for the live stream, adds a round-trip + new port/route/contract for zero benefit (the pure function has no I/O and ESLint already permits `apps→core`) |
| Newton-Raphson + bisection fallback (existing `invertIv`) | Pure bisection (as literally described in PITFALLS §4 and CONTEXT D-01) | Not a real choice — the existing module already does better than plain bisection (Newton with automatic bisection fallback on low vega / out-of-bounds step), and rewriting it as plain bisection would be a regression, not an improvement |

**Installation:** none — `bun install` already has everything.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────── Browser (apps/web) ───────────────────────────────┐
│                                                                                    │
│  usePositions() ──┐                                                              │
│  useGex() ─────────┤                                                              │
│  useStatus() ──────┼──► Overview.tsx ──► buildRows() ──► per-position calendars   │
│  useLiveStream() ──┘         │                                 │                  │
│         │                    │                                 ▼                  │
│         │ SSE ticks          │                    ┌──────────────────────────┐    │
│         │ (bsmIv already     │                    │ resolveCalibratedIv()    │    │
│         │  calibrated        │                    │ (NEW helper)             │    │
│         │  server-side)      │                    │  1. liveGreeks.get(sym)  │    │
│         ▼                    │                    │     .bsmIv  → preferred  │    │
│  Map<occSymbol,               │                    │  2. else: invertIv()     │────┼──► @morai/core
│    StreamLiveGreekEvent> ─────┘                    │     (fallback, marketVal)│    │    (invertIv,
│                                                     │  3. Result<number,      │    │     pure fn,
│                                                     │     IvError|NoPrice>    │    │     no I/O)
│                                                     └──────────┬───────────────┘    │
│                                                                ▼                    │
│                                          scenario-engine.ts (repriceScenario)       │
│                                          AnalyzerPosition.{frontIv,backIv} now      │
│                                          calibrated (or leg flagged non-convergent) │
│                                                                │                    │
│                                                                ▼                    │
│                                          PayoffChart (T+0 excludes non-converged;   │
│                                          @exp still drawn — CAUTION: only safe when │
│                                          the BACK leg converged, see Pitfall below) │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ GET /api/positions, /api/analytics/gex, /api/status  (REST, 30s poll)
                              │ SSE /api/stream (live ticks, ~1/sec coalesced)
                              ▼
┌────────────────────────────────── apps/server ───────────────────────────────────┐
│  sidecar-sse.ts ──► recomputeLiveGreek(tick, r, q, now)  [packages/core]          │
│                        │                                                          │
│                        ├─ invertIv(mark, S, K, T, r, q, type)                     │
│                        │     ok    → emit StreamLiveGreekEvent{bsmIv, bsmDelta…}  │
│                        │     err   → SKIP — no event emitted for this leg         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/web/src/
├── lib/
│   ├── scenario-engine.ts        # EXTEND: AnalyzerPosition gains calibration-aware fields
│   ├── iv-calibration.ts         # NEW: resolveCalibratedIv() — client-side invertIv wrapper
│   └── iv-calibration.test.ts    # NEW: fast-check property coverage (see Validation Architecture)
├── screens/
│   └── Overview.tsx              # REWRITE: TOS-dock layout per 17-UI-SPEC.md
├── components/
│   ├── charts/PayoffChart.tsx    # EXTEND: dimmed/highlighted dual-curve mode (D-05)
│   └── overview/                 # NEW: extracted TOS-dock subcomponents (pill header, docked
│                                  #      positions table, scenario strip) if Overview.tsx grows
│                                  #      too large for one file — planner's call
```

### Pattern 1: Client-side kernel reuse (already established, extend it)

**What:** `apps/web` imports pure domain functions directly from `@morai/core`/`@morai/quant`
rather than round-tripping through an HTTP endpoint, for anything that is I/O-free math.
**When to use:** Any per-leg/per-position numeric transform that has no side effects — greeks,
now IV calibration.
**Example (existing precedent, mirror this shape for the new helper):**
```typescript
// Source: apps/web/src/lib/position-greeks.ts (existing, verbatim pattern to mirror)
import { bsmGreeks } from "@morai/quant";
import { parseOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { ok, err } from "@morai/shared";

export function computePositionGreeks(input: PositionGreeksInput): Result<PositionGreeksResult, GreeksError> {
  const parseResult = parseOccSymbol(input.occSymbol);
  if (!parseResult.ok) return err({ kind: "OCC_PARSE_ERROR", detail: "…" });
  // … call the shared kernel, scale by qty, return ok(...)
}
```
The new `iv-calibration.ts` should follow this exact shape: parse OCC → resolve a price →
`invertIv(...)` from `@morai/core` → map to a local `Result`.

### Pattern 2: Non-convergence is a leg-level, not position-level, concern for calendars

**What:** A calendar position has a FRONT and a BACK leg with independently invertible IVs.
`recomputeLiveGreek` already models this per-leg (one `invertIv` call per tick, one leg at a
time) — never per-position.
**When to use:** Any new calibration code must key results by `occSymbol` (leg), then the caller
(scenario-engine / Overview) aggregates leg results into position-level display state.
**Example:**
```typescript
// Source: packages/core/src/streaming/recompute-live-greek.ts (existing pattern)
const ivResult = invertIv(price, S, K, T, rate, q, type);
if (!ivResult.ok) {
  return err<LiveGreekSkip>({ kind: "iv-failed" }); // never DEFAULT_IV, never last iterate
}
```

### Pattern 3: Row-highlight local state (D-05)

**What:** `hover` (transient) + `click`-to-persist-with-toggle-off local state, no route change.
**When to use:** The docked positions table → PayoffChart highlight interaction.
**Example:**
```typescript
// Source: apps/web/src/components/AdHocPicker.tsx (existing clearHovered pattern to mirror)
const [clearHovered, setClearHovered] = useState(false);
// hover sets a transient id; click toggles a persisted id; same-row click clears it
```

### Anti-Patterns to Avoid

- **Writing a new bisection/Newton solver for this phase:** `invertIv` already exists, is already
  tested to 1000-run fast-check properties, and is already used in two live pipelines. A parallel
  solver would violate the existing PITFALLS.md "Integration Gotcha" that explicitly warns against
  this: *"New calibration solver reuses ad hoc Math.sqrt/Newton math instead of the project's
  existing property-tested BSM/solver module."*
- **Treating "no live tick for this leg" as equivalent to "non-convergent IV":** These are
  different states. A leg can be missing from `liveGreeks` simply because no tick has arrived yet
  (cold start, outside RTH, or the position was just registered) — that is NOT the same as
  `invertIv` returning `err`. Conflating them means the "IV n/a — did not converge" badge (D-02)
  fires incorrectly for perfectly healthy legs that just haven't ticked yet. The calibration helper
  must call `invertIv` explicitly (using the best available price) to get a real tagged `Result`,
  not infer non-convergence from tick absence.
- **Assuming the @exp curve never needs IV for a calendar (see Pitfall below).**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Price → IV inversion | A new Newton/bisection solver in `apps/web` or `scenario-engine.ts` | `invertIv` from `@morai/core` (`packages/core/src/journal/domain/iv-inversion.ts`) | Already exists, already property-tested (1000-run round-trip + monotonicity + bisection-path coverage + CR-03/WR-01 regressions), already the sole IV source for the live stream and journal batch job |
| Mid-price / mark resolution | A new ad-hoc `(bid+ask)/2` calculation | Mirror `recompute-live-greek.ts`'s `price = tick.mark ?? (bid+ask)/2` convention exactly | Established, tested convention; `tick.mark` is the SSE stream's already-resolved mark, consistent with `docs/iv-engine-discrepancy-and-solver.md`'s "mid" decision |
| Staleness badge / relative-age formatting | A new age-formatting helper | `relAge()` + `GEX_FRESH_MS` pattern from `Market.tsx` | UI-SPEC explicitly mandates reuse — "do not invent a second staleness language" |
| Row-hover/select toggle logic | New state machine | `clearHovered` pattern from `AdHocPicker.tsx` | Already the established toggle-on-same-click-to-clear convention in this codebase |

**Key insight:** This phase's biggest risk is *scope inflation from re-solving an already-solved
problem*. The planner should treat `packages/core/src/journal/domain/iv-inversion.ts` as
**frozen, do-not-modify** infrastructure unless a genuine bug is found in it during integration
(none is known); all new work is in the *consumer* (`scenario-engine.ts`, `Overview.tsx`, and one
new `iv-calibration.ts` bridge file).

## Common Pitfalls

### Pitfall 1: The UI-SPEC's "non-convergent leg → @exp still safe" claim is only true for the FRONT leg

**What goes wrong:** `17-UI-SPEC.md` State Contract A says: *"@exp (expiration) curve: computed
and shown normally — intrinsic value at expiry needs no live IV."* This is true **only when the
non-convergent leg is the FRONT leg**. `scenario-engine.ts`'s `bookPLAtExpiry` values the book at
`daysForward = pos.frontDte` — at that instant the FRONT leg is at `T=0` (intrinsic, no IV needed,
confirmed by `bsmPrice`'s `T<=0` branch), **but the BACK leg still has real time value**
(`backT = max((backDte - frontDte)/365, 1e-6)` — e.g. 151−141=10 days remaining in the mockup's
real production data). If the **back leg's** IV fails to converge, the @exp curve for that
position is NOT safe to draw — it still needs `backIv` to price the remaining ~10 days of extrinsic
value on the back leg.
**Why it happens:** The UI-SPEC's blanket claim was written from a single-leg mental model; the
system's actual instrument is always a two-leg calendar.
**How to avoid:** Track convergence **per leg** (front/back), not per position. Recommended
display logic:
  - **Front leg non-convergent, back leg convergent:** @exp draws normally (front leg is
    intrinsic-only at its own expiry, doesn't need its IV); T+0 excludes the position (front leg's
    live time value is unknown before expiry).
  - **Back leg non-convergent (regardless of front):** BOTH curves are unsafe for that position —
    exclude from T+0 AND @exp, and the "IV n/a" badge should make this explicit (e.g. "IV n/a —
    back leg — excluded from T+0 and @exp").
**Warning signs:** A position's @exp curve looks flat/wrong specifically when its back leg is deep
ITM or the long-dated leg is thin.
**Phase to address:** This phase — refine D-02's blanket rule into the leg-aware version above
before implementation; flag this explicitly in the plan so the UAT script tests a synthetic
back-leg-non-convergent fixture, not just a front-leg one.

### Pitfall 2: "No live tick" and "IV did not converge" look identical from the browser's default vantage point

**What goes wrong:** `recomputeLiveGreek` returns `err({kind:"iv-failed"})` on non-convergence,
and the **server simply does not emit an SSE event** for that leg (confirmed:
`sidecar-sse.ts`/`recomputeLiveGreek` skip path). From the browser, `liveGreeks.get(occSymbol)`
returns `undefined` in BOTH cases: (a) genuine non-convergence, and (b) no tick has arrived yet
(cold start, outside RTH, newly registered position). If the calibration helper naively treats
"absent from `liveGreeks`" as the non-convergence signal, it will incorrectly badge every
not-yet-ticked position as "IV n/a" during the first seconds after page load or outside RTH.
**Why it happens:** The existing server-side skip-on-error design is correct for its own purpose
(never emit a fabricated tick) but was not built with a browser-side "why is this leg missing"
distinction in mind — that distinction didn't matter before OVW-02 needed to render it.
**How to avoid:** The client-side calibration helper (`iv-calibration.ts`) must call `invertIv`
itself (using `tick.mark` when a live tick exists, else the REST-derived fallback price) to obtain
an actual `Result<number, IvError>` — never infer convergence state from tick presence/absence
alone. This also means: don't reuse `tick.bsmIv` blindly as "the" calibrated value without also
being able to answer "did this converge" — either trust the tick (it's already `ok` by
construction, since the server only emits on `ivResult.ok`) as evidence of convergence for THAT
leg's most recent price, or explicitly recompute client-side for a single source of truth. **Recommendation:** trust `tick.bsmIv` as already-converged when present (cheap, avoids a redundant
client-side inversion of the same price); only invoke `invertIv` client-side for legs with no live
tick (the REST/cold-start fallback path) — this keeps a single non-convergence code path (the
fallback) while avoiding double-computation on the hot (live) path.
**Warning signs:** "IV n/a" badges flashing on for ~1-2 seconds after every page load before the
first tick arrives, or persistently showing outside RTH.
**Phase to address:** This phase — the UAT script should explicitly test a cold-start/no-tick
scenario and confirm no false "IV n/a" badge appears (should show the REST-fallback-calibrated
value, or a distinct "no data yet" state — not the non-convergence badge).

### Pitfall 3: REST fallback has no raw bid/ask/mark per leg — must derive price from `marketValue`

**What goes wrong:** `BrokerPositionResponse` (the `/api/positions` REST payload, used for the
static/cold-start path) has **no** `mark`/`bid`/`ask` fields — only `marketValue` (signed, already
`× netQty × 100`) and `averagePrice`. A naive port of the SSE mid-price convention
(`(bid+ask)/2`) has no data to work from in the REST path.
**Why it happens:** `brokerPosition` (in `packages/contracts/src/brokerage.ts`) was designed for
the positions table, which only ever needed a signed total value — not a per-share price.
**How to avoid:** Derive the fallback per-share price as
`Math.abs(leg.marketValue) / (Math.abs(netQty) * 100)` when `netQty !== 0` and
`marketValue !== null`; treat `netQty === 0` or `marketValue === null` as a "no-price" state
(a local error variant alongside `IvError`, e.g. `{ kind: "no-price" }`) rather than crashing or
dividing by zero. This is NOT literally "the mid" (Schwab's `marketValue` reflects whatever
mark/last convention the broker used at snapshot time), but it is the best available REST-only
price and is directionally consistent with "never raw bid/ask" (there is no raw bid/ask to
misuse here in the first place).
**Warning signs:** `NaN`/`Infinity` per-share price when a position briefly has `netQty === 0`
(fully hedged) during a partial fill.
**Phase to address:** This phase — the `iv-calibration.ts` fallback path needs this guard from
day one, covered by a unit test with `netQty === 0`.

### Pitfall 4 (inherited from PITFALLS.md, now re-scoped): Bisection/Newton non-convergence on deep-ITM/illiquid legs

**Status: already mitigated by existing code**, not a new risk to design for. `invertIv` already
has: a hard `MAX_ITER = 50` Newton cap with automatic bisection fallback on
`vega < VEGA_THRESHOLD (1e-8)` or an out-of-bounds Newton step; a `BISECT_STEPS = 200` guaranteed-
convergence fallback bounded to `[0.001, 5.0]`; a WR-01 post-solve residual check
(`|repriced − mark| > 1e-4` → `err`) that specifically catches the "endpoint-clamped fabricated
IV" failure mode PITFALLS §4 warned about. **The only remaining work is making sure the phase's
new caller code (the calibration helper) actually surfaces `err` results as the "IV n/a" badge
instead of silently falling back to `DEFAULT_IV` (0.18) anywhere** — grep for `DEFAULT_IV` usage
in `Overview.tsx`/`Analyzer.tsx`/`live-position-greeks.ts` during implementation and confirm each
call site either (a) is intentionally kept as a documented fallback-of-last-resort for a
genuinely-untagged code path, or (b) is replaced by the new calibrated-or-tagged-error flow.

### Pitfall 5: `packages/core/src/journal/domain/bsm.ts` and `packages/quant/src/bsm.ts` are two separate BSM implementations

**What goes wrong:** There are two independent Black-Scholes implementations in this repo:
`packages/quant/src/bsm.ts` (the pure leaf, imported by `apps/web` via `@morai/quant` for
client-side re-pricing) and `packages/core/src/journal/domain/bsm.ts` (imported internally by
`invertIv` and `computeBsmGreeks`, NOT re-exported as `@morai/quant`). `invertIv` calls
`bsmPrice`/`bsmVega` from its own local `./bsm.ts`, not from `@morai/quant`. If the phase's new
`iv-calibration.ts` helper independently re-derives a price using `@morai/quant`'s `bsmPrice`
anywhere near the same calculation `invertIv` performs internally, there is a latent risk of two
slightly different BSM implementations disagreeing (they should be numerically close — both are
standard closed-form BSM — but they are not byte-for-byte the same function).
**Why it happens:** `quant` was extracted later as the pure client-shareable leaf (ESLint comment:
"apps/web imports quant for client-side BSM live re-pricing (D21)"); `core`'s domain `bsm.ts`
predates or was intentionally kept separate to avoid `core` depending on `quant` for a boundary
reason not documented in this research pass.
**How to avoid:** Do not attempt to reconcile or merge these in this phase (out of scope, a
"docs before architecture changes" violation without its own decision doc). Simply be aware: when
the calibration helper needs `S, K, T, r, q, price` to call `invertIv`, pass the exact same `S`
(spot) used elsewhere in `scenario-engine.ts` (which itself calls `@morai/quant`'s `bsmPrice` for
the *display* curves) — the two BSM implementations only need to agree on the specific `(S,K,T,σ)`
tuple `invertIv` internally validates against itself (its own residual check uses its own `bsmPrice`
consistently), not against `@morai/quant`'s output.
**Warning signs:** A calibrated IV that reprices correctly inside `invertIv`'s own residual check
but produces a visibly different price when re-priced by `scenario-engine.ts`'s
`@morai/quant`-based `bsmPrice` for the payoff curve. If this is observed during UAT, it is a
genuine (if small) real signal, not a bug in the wiring — flag it as an open question rather than
silently "fixing" by picking one engine, since that is an architecture decision outside this
phase's scope.
**Phase to address:** Flag as an explicit "Open Question" in the plan; not a blocker (the two
engines are both standard BSM and should agree to within numerical-precision on liquid legs), but
worth a smoke-test comparison during UAT on at least one live position.

## Code Examples

### Client-side calibration helper — recommended shape

```typescript
// Source: pattern synthesized from apps/web/src/lib/position-greeks.ts (existing) +
// packages/core/src/streaming/recompute-live-greek.ts (existing mid-price/error convention)
import { invertIv } from "@morai/core";
import type { IvError } from "@morai/core";
import { parseOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { ok, err } from "@morai/shared";

export type CalibrationError = IvError | { readonly kind: "no-price" };

export function resolveLegIv(
  occSymbol: string,
  spot: number,
  rate: number,
  divYield: number,
  liveTick: { mark: number } | undefined,
  restMarketValue: number | null,
  netQty: number,
  now: Date,
): Result<number, CalibrationError> {
  const parsed = parseOccSymbol(occSymbol);
  if (!parsed.ok) return err({ kind: "no-price" });
  const { expiry, type, strike } = parsed.value;
  const T = (expiry.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (T <= 0) return err({ kind: "expired" });

  // Prefer the already-server-calibrated live tick's mark (cheap re-derivation of the
  // same price the server already used — keeps one price source of truth per leg).
  let price: number;
  if (liveTick !== undefined) {
    price = liveTick.mark;
  } else if (restMarketValue !== null && netQty !== 0) {
    price = Math.abs(restMarketValue) / (Math.abs(netQty) * 100);
  } else {
    return err({ kind: "no-price" });
  }

  return invertIv(price, spot, strike, T, rate, divYield, type);
}
```

### Existing solver — do not modify, just call

```typescript
// Source: packages/core/src/journal/domain/iv-inversion.ts (existing, verbatim)
export function invertIv(
  mark: number, S: number, K: number, T: number, r: number, q: number, type: "C" | "P",
): Result<number, IvError> {
  // Guard 1: expired (T<=0) → err({kind:"expired"})
  // Guard 2: below European no-arb lower bound → err({kind:"below-intrinsic"})
  // Guard 3: above upper bound → err({kind:"above-bound"})
  // Newton-Raphson (MAX_ITER=50, breaks to bisection on vega<1e-8 or out-of-bounds step)
  // Bisection fallback (BISECT_STEPS=200, bounds [0.001, 5.0])
  // WR-01: post-solve residual check (|repriced-mark|>1e-4 → err) — never a fabricated IV
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `scenario-engine.ts` prices every leg at flat `DEFAULT_IV`/user-set `frontIv`/`backIv` (Analyzer manual entry) | Per-leg calibrated IV from `invertIv`, sourced from the live SSE tick or REST fallback | This phase (17) | T+0 curve reflects the actual live-mark-implied vol per leg instead of a guessed flat 18% (or whatever the Analyzer's manual paste supplied) |
| `Overview.tsx` netGreeksForLegs uses `DEFAULT_IV = 0.18` for the static book summary | Should also migrate to calibrated IV where a mark is available (server-side, less time-critical than the payoff hero) | This phase — planner's call whether to extend the static `BookSummary`/`netGreeksForLegs` path too, or leave it as a documented lower-priority follow-up | Consistency between the payoff hero's calibrated greeks and the "Book & system" section's greeks — currently these will disagree if only the hero is upgraded |

**Deprecated/outdated:** Nothing in this phase deprecates existing code — `DEFAULT_IV` remains
correct as a last-resort constant for genuinely-unpriceable legs (no mark ever, no fallback
possible) but must no longer be the default happy path for any leg with an available price.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Trusting `tick.bsmIv` as "already converged" (rather than always re-deriving client-side via `invertIv`) is an acceptable simplification, since the server only emits an SSE event on `ivResult.ok`. | Pitfall 2 / Code Examples | If the server's emit-on-ok invariant ever changes (e.g. someone adds a "best-effort" emit path later), the browser would need to re-derive rather than trust — low risk today, verified against current `recompute-live-greek.ts` source, but worth a one-line comment/test pinning the invariant. |
| A2 | `Math.abs(marketValue) / (Math.abs(netQty) * 100)` is an acceptable REST-fallback per-share price proxy (not literally documented anywhere as "the" convention, synthesized from the available contract fields). | Pitfall 3 | If `marketValue`'s broker-side convention (mark vs last vs mid) differs meaningfully from the SSE `mark` field's convention, the REST-fallback calibrated IV could disagree from the live-tick calibrated IV for the same leg at nearly the same time — cosmetic risk (a brief IV "jump" when the first live tick arrives and supersedes the REST-derived value), not a correctness risk (both paths still go through the same tagged `invertIv`). |
| A3 | It is acceptable for this phase to leave `BookSummary`/`netGreeksForLegs` (the "Book & system" section) on `DEFAULT_IV`, deferring calibration there as a documented follow-up rather than in-scope. | State of the Art | If left un-migrated, the payoff hero and the book summary could show inconsistent greeks for the same book — the planner should explicitly decide in-scope vs deferred and record the choice, not let it happen by omission. |

## Open Questions

1. **Do the two BSM implementations (`packages/core` internal vs `@morai/quant`) numerically
   agree closely enough that a calibrated IV from `invertIv` (using core's internal `bsmPrice`)
   reprices cleanly through `@morai/quant`'s `bsmPrice` for the payoff curve?**
   - What we know: both are standard closed-form European BSM with a 5-term A&S normal-CDF
     approximation; they should agree to high precision on well-conditioned inputs.
   - What's unclear: no direct comparison test exists between the two implementations in this
     repo today.
   - Recommendation: add one smoke/property test during implementation comparing
     `core`'s internal `bsmPrice` output vs `@morai/quant`'s `bsmPrice` output for the same
     `(S,K,T,σ,r,q,type)` tuple — cheap insurance, not a redesign.

2. **Should `Overview.tsx`'s "Book & system" summary (`BookSummary`/`netGreeksForLegs`) also
   migrate off `DEFAULT_IV` in this phase, or is that explicitly deferred?**
   - What we know: OVW-02's stated success criterion is specifically about the "T+0 scenario
     curve" (the payoff hero), not the book-summary greeks tiles.
   - What's unclear: whether shipping with the hero calibrated but the summary still flat-IV is
     an acceptable, clearly-documented inconsistency for this phase, or a UAT-failing gap.
   - Recommendation: planner should make this an explicit in-scope/deferred decision recorded in
     the plan, not an accidental omission.

## Environment Availability

Skipped — this phase has no new external tool/service dependency. All data sources
(`/api/positions`, `/api/analytics/gex`, `/api/status`, SSE stream) are already live in
production per `.planning/STATE.md` (Phase 16 deploy complete).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.8` (root `vitest run`), `apps/web` has its own test setup consistent with existing `scenario-engine.test.ts`/`PayoffChart` tests |
| Config file | root `vitest.config.ts` / `apps/web` inherits workspace config (existing, no new config needed) |
| Quick run command | `bun run test -- scenario-engine iv-calibration` (or `vitest run apps/web/src/lib/iv-calibration.test.ts`) |
| Full suite command | `bun run test` (workspace-wide, per root `package.json`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| OVW-02 | Per-leg IV calibration round-trips (ATM/ITM/OTM/near-zero-vega) via `invertIv` reuse | property (fast-check, extend existing pattern) | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ Wave 0 |
| OVW-02 | Non-convergent leg (deep-ITM/illiquid synthetic fixture) returns tagged `err`, never `DEFAULT_IV` | unit | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ Wave 0 |
| OVW-02 | Back-leg-non-convergent excludes BOTH T+0 and @exp for that position (Pitfall 1 refinement) | unit | `vitest run apps/web/src/lib/scenario-engine.test.ts` | ❌ Wave 0 (extend existing file) |
| OVW-02 | Front-leg-non-convergent excludes T+0 only; @exp still renders | unit | `vitest run apps/web/src/lib/scenario-engine.test.ts` | ❌ Wave 0 (extend existing file) |
| OVW-02 | Cold-start (no live tick, no REST marketValue) does not spuriously show "IV n/a" (Pitfall 2) | unit | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ Wave 0 |
| OVW-02 | REST-fallback price derivation guards `netQty === 0` / `marketValue === null` (Pitfall 3) | unit | `vitest run apps/web/src/lib/iv-calibration.test.ts` | ❌ Wave 0 |
| OVW-02 | Stale GEX displays its snapshot timestamp (D-03) | unit/manual | `vitest run apps/web/src/screens/Overview.test.tsx` (reuses existing `Market.tsx` `relAge` pattern — likely already covered by existing Market tests; add an Overview-specific assertion) | ⚠️ verify existing coverage in Wave 0 |
| OVW-01 | Row-highlight dims net-book curves to 0.3 opacity, highlights selected position | unit/component | `vitest run apps/web/src/components/charts/PayoffChart.test.tsx` | ⚠️ check if `PayoffChart.test.tsx` exists — add if not |
| OVW-01 | Scenario-strip level set caps at 8 columns, dedupes, sorts ascending (D-06) | unit | `vitest run apps/web/src/lib/scenario-engine.test.ts` (or a new `scenario-strip.test.ts`) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run apps/web/src/lib/iv-calibration.test.ts apps/web/src/lib/scenario-engine.test.ts`
- **Per wave merge:** `bun run test` (full workspace suite — must stay green; `iv-inversion.test.ts`'s
  existing 1000-run properties must continue passing unchanged since this phase does not modify
  `invertIv` itself)
- **Phase gate:** Full suite green + `bun run typecheck` + `bun run lint` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/web/src/lib/iv-calibration.ts` + `iv-calibration.test.ts` — new module, TDD red→green
      from scratch (fast-check property + unit tests per the map above)
- [ ] Extend `apps/web/src/lib/scenario-engine.test.ts` — add front-leg-vs-back-leg
      non-convergence fixtures (Pitfall 1)
- [ ] Verify whether `apps/web/src/components/charts/PayoffChart.test.tsx` exists; if not, create
      it for the new dimmed/highlighted dual-curve rendering mode (D-05)
- [ ] Verify whether `apps/web/src/screens/Overview.test.tsx` exists and what it currently covers
      (the current `Overview.tsx` has no visible test file in this research pass — confirm during
      planning and scope a new one for the TOS-dock rewrite)

## Security Domain

`workflow.nyquist_validation`/`security_enforcement` config keys were not inspected in this pass
(not present in the files read); treating security review as standard-applicable per the ASVS
categories below, scoped to what this phase actually touches (read-only dashboard, no new auth
surface, no new write path).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | No new auth surface — reuses existing Bearer-token `apiFetch`/SSE auth already in place |
| V3 Session Management | No | No session changes |
| V4 Access Control | No | No new routes; existing `/api/positions`, `/api/analytics/gex`, `/api/status`, SSE stream already gated |
| V5 Input Validation | Yes | `invertIv`'s own guards (T<=0, below/above bound) already Zod-adjacent typed-Result discipline; new `iv-calibration.ts` must not introduce raw casts — parse OCC via `parseOccSymbol`, never hand-roll |
| V6 Cryptography | No | Not applicable to this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Silent numeric corruption (fabricated IV masquerading as real, e.g. an endpoint-clamped bisection result) | Tampering (of derived data, not transport) | Already mitigated by `invertIv`'s WR-01 post-solve residual guard — do not weaken or bypass this check when wiring the new caller |
| Divide-by-zero / `NaN`/`Infinity` propagation from the REST-fallback price derivation (Pitfall 3) | Denial of Service (rendering crash) / Tampering (silent bad data) | Explicit `netQty === 0` / `marketValue === null` guard returning a typed `err`, never computing `0/0` |

## Sources

### Primary (HIGH confidence — direct repo inspection)
- `packages/core/src/journal/domain/iv-inversion.ts` + `.test.ts` — the existing solver and its
  full test suite (1000-run fast-check properties, bisection-path coverage, CR-03/WR-01 fixes)
- `packages/core/src/streaming/recompute-live-greek.ts` — live SSE calibration pipeline, mid-price
  convention, skip-on-non-convergence behavior
- `packages/core/src/journal/application/computeBsmGreeks.ts` — batch journal calibration pipeline,
  `NaN`-stamp-on-error convention (D-09)
- `eslint.config.js` — authoritative boundary rules (`apps → core/quant/contracts/shared` all
  permitted; `core → shared/quant` only)
- `apps/web/src/lib/scenario-engine.ts`, `position-greeks.ts`, `live-position-greeks.ts`,
  `screens/Overview.tsx`, `components/charts/PayoffChart.tsx`, `components/LiveStatusBadge.tsx`,
  `components/AdHocPicker.tsx`, `screens/Market.tsx`, `screens/Analyzer.tsx` — existing consumer
  patterns to mirror
- `packages/contracts/src/stream-events.ts`, `brokerage.ts`, `status.ts`, `gex.ts` — exact payload
  shapes available to the browser
- `docs/iv-engine-discrepancy-and-solver.md` — the project's own prior decision to build a
  first-party BSM solver rather than trust vendor-derived IV (context for why `invertIv` exists)
- `.planning/phases/17-overview-v2-redesign-iv-calibration-fix/17-UI-SPEC.md`,
  `mockups/overview-v2.html` — the layout design contract (OVW-01)
- `.planning/research/PITFALLS.md` §4/§1, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` —
  phase requirements and regression gates

### Secondary / Tertiary
None — this research required no external web sources; the domain is entirely internal-codebase
integration with zero new third-party dependencies.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every module cited was read directly from the repository, not inferred.
- Architecture (client-side calibration recommendation): HIGH — grounded in the actual enforced
  ESLint boundary rule and the already-exported `@morai/core` package API, not a training-data
  guess.
- Pitfalls: HIGH for Pitfalls 1–3 and 5 (derived from reading the actual leg/DTE math in
  `scenario-engine.ts` and the actual contract shapes); the existing PITFALLS.md's §4 concerns are
  explicitly downgraded from "design risk" to "already mitigated, verify wiring only."

**Research date:** 2026-07-03
**Valid until:** 30 days (stable internal codebase, no fast-moving external dependency in scope)
