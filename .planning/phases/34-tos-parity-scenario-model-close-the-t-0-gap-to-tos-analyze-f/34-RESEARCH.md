# Phase 34: TOS-Parity Scenario Model - Research

**Researched:** 2026-07-10
**Domain:** Options pricing model precision (BSM time-to-expiry, put-call-parity carry estimation, vol-smile scenario semantics)
**Confidence:** HIGH (fractional DTE architecture, risk-free-rate sourcing), MEDIUM (settlement-timestamp convention, parity estimator robustness), LOW (TOS's exact internal T+0 intraday-decay convention and internal rate source — flagged, does not block the plan)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (ranked scope)

1. **Fractional DTE (highest expected impact).** `pair-calendars.ts` computes whole
   calendar days; the engine prices `days/365`. TOS uses exact time to settlement. At
   night a "98d" leg is really ~97.6d; the book carries ~$32/day theta → up to ~$16
   error ≈ 10-30 BE points. Fix: exact expiry timestamps (SPX settlement: AM-settled
   monthly SPX vs PM-settled SPXW Weeklys — research must pin the convention per leg
   from the OCC symbol) → fractional DTE flowing through scenario-engine, Analyzer,
   Overview. Integer display can stay ("98d"), math goes fractional.
2. **Parity-implied carry per expiry.** Replace flat DEFAULT_RATE (0.043) /
   DEFAULT_DIV (0.013) with the forward implied by put-call parity from our OWN stored
   chain (leg_observations has both sides per strike/expiry). One implied carry number
   per expiry kills both r and q error jointly. Fallback to the flat defaults when the
   chain row is missing/stale (degrade, never throw).
3. **Smile-aware scenario IV — RESEARCHED DECISION, not pre-committed.** Today each leg
   keeps its flat calibrated IV at every shifted spot (sticky-strike, no smile). TOS
   applies its vol model. We have per-strike IVs in the chain. Research must answer:
   what does TOS's default vol mode actually do, what would sticky-strike vs
   sticky-moneyness interpolation change, and is the added complexity justified after
   items 1+2 land — measure first, build only if the remaining gap is dominated by vol.

### Out of scope (explicit)

- PayoffChart / any presentation code — data-layer only
  (`apps/web/src/lib/scenario-engine.ts`, `pair-calendars.ts`, possibly
  `packages/quant` inputs, IV-calibration plumbing).
- Server/worker pipeline changes beyond what carry-from-chain needs for data access
  (prefer reusing data the web already receives; new API fields are additive on an
  existing endpoint + MCP twin per rule 9).
- The exit advisor / picker engines (their own rule configs own their math).
- After-hours mark parity — unfixable; the UAT gate is explicitly an RTH measurement.

### Claude's Discretion

- Exact settlement-timestamp construction technique (native `Intl` vs otherwise).
- Whether the parity estimator uses a single ATM-bracket pair or a wider regression.
- Whether `tos-parser.ts` (pasted calendars) also gains fractional DTE this phase.

### Deferred Ideas (OUT OF SCOPE)

- Smile-aware / sticky-delta scenario re-pricing — deferred pending measurement
  (see D-12; research finds a strong reason this is unlikely to be needed at all).
- Any chart/presentation change (Phase 33 just landed Recharts; untouched here).

### Hard requirements

- UAT gate is a measurement (RTH, live marks) — record before/after gap vs TOS.
- Every model change TDD'd against hand-computed oracles (money-path rule).
- Byte-honest degradation: missing/stale chain data or unparseable expiry → current
  behavior (flat defaults, integer days), never a throw.
- No `any`/`as`/`!`; hexagonal boundaries hold; web imports core pure functions +
  contracts only.
- Existing suites stay green; `AnalyzerPosition` gains optional fields at most.
</user_constraints>

## Summary

The dominant lever (item 1, fractional DTE) is a pure client-side fix with no new
dependencies: `packages/shared` already has `parseOccSymbol` (root + expiry date, no
time-of-day) and two OTHER call sites in this same codebase
(`apps/web/src/lib/iv-calibration.ts`, `apps/web/src/lib/position-greeks.ts`) already
compute fractional time-to-expiry via `(expiry.getTime() - now.getTime()) /
(365.25 * 86_400_000)` — only `pair-calendars.ts`'s `dte()` (whole-day `Math.ceil`) and
`scenario-engine.ts`'s `/365` divisor are the actual culprits [VERIFIED: source read].
The missing piece nobody in the codebase currently computes is the settlement
**time-of-day**: AM-settled standard SPX (3rd-Friday-of-month, root `SPX`) settles from
Friday's opening auction print, while every other SPX/SPXW series (root `SPXW`, or any
other date) is PM-settled at the 4:00 PM ET close [CITED: Cboe SPX specifications,
tastytrade/marketdata.app settlement guides]. The OCC root is already parsed and
already flows through `pair-calendars.ts`'s calendar-grouping comment ("SPX-rooted
standard-expiry front with an SPXW-rooted weekly back") — the root-vs-date settlement
rule is derivable with zero new data, using only what `parseOccSymbol` already returns.

The second lever (item 2, carry) turns out to decompose more cleanly than CONTEXT.md's
framing suggests. The codebase **already fetches a live FRED short-term risk-free rate**
(`DGS1MO`/`DGS3MO`, via `useMacro()`, already called in `Overview.tsx`) — there is no
need to *infer* `r` from parity at all; a single put-call-parity equation per expiry
cannot cleanly separate `r` and `q` from ONE equation anyway (only `r − q` appears in
BSM's `d1`, but `r` and `q` appear *separately* in the two discount factors
`S·e^{-qT}` and `K·e^{-rT}`). The correct decomposition is: **fix `r` from the
already-fetched FRED curve** (interpolated to each leg's DTE), **then solve the single
remaining unknown `q` from put-call parity** using the underlying chain — a
well-conditioned one-unknown solve instead of an ill-posed joint one. The raw
call/put mark prices needed for that parity solve are NOT currently exposed anywhere
(the one existing per-strike smile port, `ForReadingSmileSource`/`readSmile`, returns
already-inverted `bsm_iv` — computed using the flat defaults as inputs — not raw
prices, so it is circular for this purpose and also has **no live HTTP/MCP route**
today despite having a full `skewSmileEntry` Zod contract already defined
[VERIFIED: `rg` for consumers — zero HTTP route registrations]). The GEX snapshot
computation, however, already reads the FULL chain (every strike, both call and put)
every cycle via `ForReadingLegObsForGex`/`readLegObsForGex`; that type is missing only
one field (`mark`) to support a parity solve, and this codebase has direct precedent
for exactly this kind of additive widening (`packages/adapters/src/postgres/repos/
picker-chain.ts` already widens an analogous leg-obs read to carry `bid`/`ask` for a
different consumer). Computing implied `q` per expiry inside the SAME already-read GEX
cohort, and exposing it as one new additive field on the GEX snapshot response the web
already fetches (`useGex()`), needs zero new queries and zero new endpoints.

Item 3 (smile-aware IV) resolves to a clear "do not build" recommendation, but for a
different reason than "measure first and see." TOS's Analyze tab **defaults to, and
forum consensus recommends, "Individual Implied Volatility"** for accurate P&L — this
mode holds each *specific option series'* own calibrated IV fixed as spot moves; it
does **not** re-interpolate along a smile [CITED: thinkorswim manual + Aeromir/
CapitalDiscussions forum threads]. For a single-strike calendar (this book: same strike
K, two expiries), "IV fixed per specific series" is *exactly* what
`scenario-engine.ts`'s current flat `frontIv`/`backIv` model already does — the model
is already structurally TOS-default-consistent for this instrument shape. Smile
interpolation would only matter for multi-strike books (verticals/condors), which are
out of this book's shape entirely.

**Primary recommendation:** ship items 1+2 as additive, degrade-safe changes (no new
dependencies, no new endpoints beyond one additive GEX field); do not build item 3;
measure the residual at the Phase 34 UAT gate and record it as a closed research
question either way.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Settlement-aware fractional time-to-expiry | Browser / Client (`apps/web/src/lib/pair-calendars.ts`, `scenario-engine.ts`) | Shared utility (`packages/shared`, new pure helper) | Pure calendar math over an already-parsed OCC symbol; no I/O, reused by web only this phase |
| Risk-free rate `r` sourcing | API / Backend (existing FRED fetch job, unchanged) | Browser / Client (`Overview.tsx` already calls `useMacro()`) | Already live and already fetched — zero new work in this tier, only a new *consumer* of data that exists |
| Dividend yield `q` (parity-implied carry) | API / Backend (`packages/core/src/analytics`, `computeGexSnapshot` use-case) | Database / Storage (`leg_observations.mark`, already persisted, one new SELECT column) | Needs raw call+put mark pairs from the full chain, which only exists server-side; computed once per GEX cycle, not per-request |
| Chain raw price read widening | Database / Storage (`leg_observations` table, unchanged schema) | API / Backend (`ForReadingLegObsForGex` port, additive field) | Data already persisted; only the read projection needs to widen |
| Scenario re-pricing consumption of carry + fractional T | Browser / Client (`scenario-engine.ts`, `Overview.tsx buildCalendarPosition`) | — | `repriceScenario` stays a pure client function (D-01 kernel-parity contract); it only gains new optional inputs |
| Smile-aware / sticky-delta re-pricing (item 3) | Not built this phase | — | TOS's own default model doesn't require it for this instrument shape (D-12) |

## Project Constraints (from CLAUDE.md)

- **No `any`, no `as`, no `!`** — every new pure function (settlement-timestamp helper,
  parity solver) uses `Result<T, E>` from `@morai/shared` for its failure paths, never
  a thrown exception or a silent `NaN`.
- **TDD red→green** — every numeric change (fractional T, parity solve) needs a
  failing test first; this is explicitly a "money-path" domain per `.claude/rules/
  tdd.md` ("Bug fix → starts with a failing regression test"; "Numerical code → fast-
  check property tests").
- **Dependencies point inward** — the new settlement-timestamp helper belongs in
  `packages/shared` (already imported by `apps/web` directly, e.g. `parseOccSymbol` in
  `iv-calibration.ts`); the new parity-solver domain function belongs in
  `packages/core/src/analytics/domain/` (already the home of `gex.ts`, imports only
  `@morai/shared`); neither may import Drizzle/Hono/vendor SDKs.
- **Confine Drizzle to `packages/adapters/postgres/`** — the one new SELECT column
  (`mark`) is added only in `packages/adapters/src/postgres/repos/gex-snapshot.repo.ts`
  (or wherever `ForReadingLegObsForGex` is implemented) and its in-memory twin.
- **Ship the in-memory twin** — the widened `LegObsForGex` type needs its memory
  adapter counterpart updated in the same PR (architecture-boundaries.md rule 8).
- **Keep adapter surfaces in sync (rule 9)** — the new `impliedCarry`/`impliedDivYield`
  field on the GEX snapshot needs both `GET /api/analytics/gex` (existing route) and
  the `get_gex` MCP tool (`apps/server/src/adapters/mcp/tools.ts`) updated together —
  one Zod schema (`gexSnapshotEntry` in `packages/contracts/src/gex.ts`), no second
  inline schema, per the file's own MCP-02 comment.
- **Docs before architecture changes** — if the new pure functions land in
  `packages/shared`/`packages/core`, no new bounded context or tech swap occurs, so no
  `docs/architecture/stack-decisions.md` row is needed (confirmed: zero new
  dependencies this phase).

## Standard Stack

### Core

No new external packages. Every fix in this phase composes existing, already-installed
building blocks:

| Capability | Existing Building Block | Location |
|------------|--------------------------|----------|
| OCC symbol parsing (root, expiry date, strike, type) | `parseOccSymbol` | `packages/shared/src/occ-symbol.ts` |
| ET-timezone-aware wall-clock reads | `Intl.DateTimeFormat({ timeZone: "America/New_York" })` (native, zero deps) | precedent: `packages/shared/src/rth-window.ts` |
| BSM pricing/greeks over an arbitrary `T` (years) | `bsmPrice`, `bsmGreeks` | `packages/quant/src/bsm.ts` |
| Fractional time-to-expiry pattern (365.25-day year) | `MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000` | already used in `iv-calibration.ts` AND `position-greeks.ts` |
| `Result<T, E>` for fallible pure functions | `ok`/`err`/`Result` | `packages/shared/src/result.ts` |
| Live risk-free-rate series (FRED) | `DGS1MO`, `DGS3MO` via `macroResponse` | `packages/contracts/src/macro.ts`; already fetched by `apps/web/src/hooks/useMacro.ts`, already called in `Overview.tsx` |
| Full-chain read (both C and P, every strike, every cycle) | `ForReadingLegObsForGex` / `readLegObsForGex` | `packages/core/src/analytics/application/ports.ts`, Postgres impl in `packages/adapters/src/postgres/repos/` |
| Precedent for widening a leg-obs read with a new raw-price column | `picker-chain.ts` (already carries `bid`/`ask` for its own consumer) | `packages/adapters/src/postgres/repos/picker-chain.ts` |

### Supporting

None. No `npm view`/`bun add` needed — this is the rare phase where the standard-stack
recommendation is "use only what's already in the tree."

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `Intl` for DST-safe ET timestamp construction | A timezone library (`luxon`, `date-fns-tz`) | Rejected — one small pure function suffices (ladder rung 4: native platform feature covers it); this repo has zero timezone-library dependency today and the existing `rth-window.ts` precedent already solves the *reading* half natively |
| Solving `r` and `q` jointly from one parity equation per expiry (CONTEXT.md's literal framing) | Fix `r` from the already-fetched FRED curve, solve only `q` from parity | The joint solve is one equation, two unknowns per strike — underdetermined without an extra assumption; fixing `r` from an independently observed, already-live data source is strictly better-conditioned and costs nothing new to fetch |
| Building smile-aware/sticky-delta re-pricing now (item 3) | Defer, measure residual after items 1+2 ship | TOS's own default/recommended mode is "Individual Implied Volatility" (fixed per specific series, not smile-interpolated) — for this single-strike-per-calendar book, that is already the current architecture; building interpolation risks solving a problem TOS itself doesn't create for this instrument shape |
| Exposing the existing (but unrouted) `skewSmileEntry`/`readSmile` port for carry | Extend `ForReadingLegObsForGex` (already read for GEX, already includes both C/P, already has `expiration`/`strike`/`contractType`) | `readSmile` returns already-inverted `bsm_iv` (computed FROM the flat defaults) — circular for carry estimation; `LegObsForGex` is the correct raw-price source, needs only one new column |

**Installation:** none — zero new dependencies.

**Version verification:** N/A — no packages installed this phase.

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. No `npm view`/registry
checks were needed; every building block cited above was verified by reading the
actual source file in this repository (see file-path citations throughout), not by
package-registry lookup.

**Packages removed due to [SLOP] verdict:** none (none proposed).
**Packages flagged as suspicious [SUS]:** none (none proposed).

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Worker (apps/worker) — compute-gex job, unchanged cadence (30-min cycle)     │
│                                                                                │
│  readLegObsForGex()  ──── ADDITIVE: SELECT now also returns `mark`           │
│         │ LegObsForGex[] (both C and P, every strike, this cycle)             │
│         ▼                                                                     │
│  computeGexSnapshotUseCase (packages/core/analytics/application)              │
│         ├─ existing: strikeGex / buildProfile / findFlip / pickWalls           │
│         └─ NEW: impliedDivYieldByExpiry(legs, spot, rFromCaller)              │
│                 groups legs by expiration → ATM-bracket C/P pair(s) →          │
│                 solves single unknown q per expiry (parity) → null on         │
│                 <1 usable pair (degrade, never throw)                          │
│         ▼                                                                     │
│  GexSnapshotRow { ...existing fields, impliedDivYield: [{expiration, q}] }     │
│         ▼                                                                     │
│  persistGexSnapshot → gex_snapshots table (ADDITIVE column/JSON field)        │
└────────────────────────────────────────────────────────────────────────────┘
                                    │  GET /api/analytics/gex  (existing route,
                                    │  additive response field) + get_gex MCP twin
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Browser (apps/web) — Overview.tsx (already calls BOTH hooks below)           │
│                                                                                │
│  useGex()  ──► gex.impliedDivYield[expiration]        (NEW consumption)       │
│  useMacro() ──► macro["DGS1MO"], macro["DGS3MO"]      (EXISTING data,         │
│                 NEW consumption: interpolate to leg DTE → r)                  │
│         │                                                                     │
│         ▼                                                                     │
│  NEW: resolveCarry(gex, macro, calendar) → { rate, divYield } per calendar    │
│       degrades to DEFAULT_RATE/DEFAULT_DIV when either source missing/stale   │
│         │                                                                     │
│         ▼                                                                     │
│  pair-calendars.ts: dte() [unchanged, display] + NEW dteExact()               │
│       (settlement-aware, via NEW packages/shared settlement-timestamp helper) │
│         │                                                                     │
│         ▼                                                                     │
│  buildCalendarPosition() → AnalyzerPosition { frontDte, backDte  [unchanged,  │
│       display], frontDteExact?, backDteExact? [NEW, optional]  }              │
│         │                                                                     │
│         ▼                                                                     │
│  scenario-engine.ts: repriceScenario / calendarNetPrice / bookGreekAt         │
│       T = (dteExact ?? dte) − daysForward) / 365.25   [365→365.25, D-02]      │
│       rate/divYield now the per-calendar resolved values, not flat constants  │
└────────────────────────────────────────────────────────────────────────────┘
```

A reader can trace: the worker's already-scheduled GEX cycle gains one new SELECT
column and one new pure domain computation over data it already reads, producing one
new additive response field; the web's Overview screen, which already fetches both GEX
and macro data every render cycle, combines them into a per-calendar `{rate,
divYield}` pair and a settlement-aware fractional DTE, both flowing into the
existing `repriceScenario` kernel through purely additive, optional `AnalyzerPosition`
fields — every existing caller that never sets the new fields gets byte-identical
current behavior except the 365→365.25 divisor (D-02, immaterial - see Common
Pitfalls).

### Recommended Project Structure

```
packages/shared/src/
├── settlement-timestamp.ts       # NEW — pure, no I/O; AM/PM settlement rule
├── settlement-timestamp.test.ts  # NEW — example + fast-check round-trip vs bsmPrice

packages/core/src/analytics/
├── domain/
│   ├── gex.ts                    # UNCHANGED
│   └── implied-carry.ts          # NEW — pure parity solver (single unknown q)
├── domain/implied-carry.test.ts  # NEW — hand-computed oracle + fast-check round-trip
├── application/
│   ├── ports.ts                  # EDIT — LegObsForGex gains `mark: string`
│   └── computeGexSnapshot.ts     # EDIT — calls implied-carry per expiry group

packages/adapters/src/postgres/repos/
├── gex-*.ts (wherever readLegObsForGex lives) # EDIT — SELECT adds `mark`
packages/adapters/src/memory/
├── (matching in-memory twin)     # EDIT — same field, same shape (rule 8)

packages/contracts/src/gex.ts     # EDIT — gexSnapshotEntry gains `impliedDivYield`
apps/server/src/adapters/mcp/tools.ts  # EDIT — get_gex passthrough (rule 9)

apps/web/src/lib/
├── pair-calendars.ts             # EDIT — dte() unchanged; new dteExact() twin
├── scenario-engine.ts            # EDIT — AnalyzerPosition optional fields, 365.25
├── resolve-carry.ts              # NEW — per-calendar {rate, divYield} from gex+macro
apps/web/src/screens/Overview.tsx # EDIT — buildCalendarPosition wires new fields
```

### Pattern 1: Settlement-aware, DST-safe fractional time-to-expiry

**What:** Determine whether an OCC-parsed contract is AM- or PM-settled from its root
+ date, construct the exact settlement timestamp (09:30 ET for AM, 16:00 ET for PM) via
native `Intl`, and use it (not a whole-day count) as the numerator feeding `bsmPrice`'s
`T` argument.

**When to use:** Every leg's `frontDte`/`backDte` → replaced (additively) by
`frontDteExact`/`backDteExact` on `AnalyzerPosition`, sourced from `pair-calendars.ts`.

**Rule (derivable from `parseOccSymbol`'s existing output, zero new data needed):**
- AM-settled (root `SPX`, exact 3rd Friday of the month): settlement = 09:30 ET on the
  expiry date [CITED: SPX settles from the Special Opening Quotation, calculated from
  each index-component's opening print, published within the first ~30-45 minutes of
  trading — marketdata.app/education/options/spx-vs-spxw-options/].
- Everything else (root `SPXW`, or ANY date that is not the 3rd Friday — covers weekly/
  EOM series): PM-settled = 16:00 ET on the expiry date [CITED: Cboe SPX
  specifications — "Trading in SPXW options will ordinarily cease... 4:00 pm ET"].

**Example:**
```typescript
// Source: derived from Cboe SPX specifications [CITED] + existing rth-window.ts's
// native-Intl ET-reading technique (this repo's own precedent for DST-safe ET math)
import { parseOccSymbol } from "@morai/shared";

function isThirdFriday(y: number, m0: number, d: number): boolean {
  const dow = new Date(Date.UTC(y, m0, d)).getUTCDay(); // date-only, tz-agnostic check
  return dow === 5 && d >= 15 && d <= 21;
}

/** UTC offset (hours, negative) actually in effect for America/New_York on this date. */
function nyUtcOffsetHours(y: number, m0: number, d: number, hour: number, minute: number): number {
  const guess = new Date(Date.UTC(y, m0, d, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(guess);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = /GMT([+-]\d+)/.exec(tzPart);
  return match?.[1] !== undefined ? Number(match[1]) : -5;
}

export function settlementTimestamp(root: string, expiry: Date): Date {
  const y = expiry.getFullYear();
  const m0 = expiry.getMonth();
  const d = expiry.getDate();
  const isAmSettled = root === "SPX" && isThirdFriday(y, m0, d);
  const [hour, minute] = isAmSettled ? [9, 30] : [16, 0];
  const offset = nyUtcOffsetHours(y, m0, d, hour, minute);
  return new Date(Date.UTC(y, m0, d, hour - offset, minute));
}
```

### Pattern 2: Fix `r` from FRED, solve only `q` from parity (per expiry)

**What:** Interpolate `DGS1MO`/`DGS3MO` (already-fetched, percent units — divide by
100) to a given leg's fractional DTE for `r`; hold `r` fixed and solve the ATM-bracket
put-call-parity equation for the single unknown `q`.

**When to use:** Once per GEX cycle, grouped by `expiration`, inside
`computeGexSnapshotUseCase` — NOT per-request, NOT client-side (raw chain marks never
need to reach the browser).

**Example:**
```typescript
// Source: put-call parity [CITED: Wikipedia "Put–call parity"; Macroption formula
// reference] — C − P = S·e^{-qT} − K·e^{-rT}  ⟹  q = −ln[(S − (C−P) − K·e^{-rT}) / S] / T
export function impliedDivYield(
  callMark: number,
  putMark: number,
  spot: number,
  strike: number,
  T: number,
  r: number,
): number | null {
  if (T <= 0 || spot <= 0) return null;
  const rhs = spot - (callMark - putMark) - strike * Math.exp(-r * T);
  if (rhs <= 0 || !Number.isFinite(rhs)) return null; // guards ln() domain — degrade, never NaN
  const q = -Math.log(rhs / spot) / T;
  return Number.isFinite(q) ? q : null;
}
```
Group by expiry, pick the strike(s) nearest spot (ATM bracket — most liquid, tightest
bid/ask, least parity-violation noise from wide quotes [CITED: Interactive Brokers
"Understanding Put-Call Parity" — ATM straddle is the canonical parity-testing pair]),
average if 2+ adjacent strikes qualify, `null` if none do.

### Pattern 3: Kernel-parity oracle extension (existing test pattern, extended)

**What:** `scenario-engine.test.ts` already asserts `repriceScenario`'s per-position
result equals a DIRECT `bsmGreeks`/`bsmPrice` call computed independently in the test
(the file's own header: "the Analyzer's live P&L preview uses the same bsmPrice/
bsmGreeks... guaranteeing cross-screen consistency," D-01). Extend this exact pattern:
compute `T` independently in the test via the new `settlementTimestamp()` helper, feed
it directly into `bsmPrice`, and assert `repriceScenario` (fed the same
`frontDteExact`) produces the identical number.

**When to use:** The primary regression-safety mechanism for D-01 — no separate
"fractional-DTE oracle" needs inventing; it is the same kernel-parity technique this
file already established, one level deeper (T itself, not just the greeks call).

### Anti-Patterns to Avoid

- **Hardcoding `"T21:00:00Z"` for "~4pm ET"**: `packages/core/src/analytics/domain/
  gex.ts:271` already does exactly this for the near-term DTE filter, and its own
  comment hedges "~4pm ET" — this is a documented ~1-hour DST approximation (correct
  only in EST/winter; off by 1 hour during EDT/summer). Do NOT copy this pattern into
  the new settlement-timestamp helper; use the DST-safe `Intl`-based technique
  (Pattern 1) instead. Not in scope to FIX the existing `gex.ts:271` occurrence (that
  file is untouched by this phase's carry work beyond the additive field), but flag it
  — do not propagate the same shortcut into new code.
- **Solving `r` and `q` jointly from a single parity equation**: underdetermined; fix
  `r` from FRED first (Pattern 2).
- **Reading `ForReadingSmileSource`/`readSmile` for carry**: its `bsm_iv` values were
  already inverted using the flat defaults as `r`/`q` inputs — circular for this
  purpose. Use raw `mark` from `LegObsForGex` instead.
- **Building a browser-side smile interpolator (item 3)**: TOS's own default mode
  doesn't need one for a single-strike calendar book (D-12) — building it risks
  solving a problem TOS itself doesn't create for this instrument shape.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| ET wall-clock time construction with DST | A manual EST/EDT date-range table, or a new timezone library dependency | Native `Intl.DateTimeFormat` with `timeZoneName: "shortOffset"` (Pattern 1) | Zero new dependency; this repo already has the *reading* half of this exact technique in `packages/shared/src/rth-window.ts` — extending it to *construct* a timestamp is a natural, in-repo-precedented step, not a new invention |
| Joint (r, q) estimation from option prices | A 2D solver / regression jointly fitting both unknowns from the chain | Fix `r` from the already-fetched, already-live FRED `DGS1MO`/`DGS3MO` series; solve only `q` | The rate is independently and more reliably observed than backed out of noisy option quotes — this repo already pays the cost of fetching it (Phase 14, live in prod) and simply never wired it into the scenario engine |
| A brand-new "chain read for carry" query/endpoint | A new DB query, new table read, or new HTTP route | Widen the field list of `ForReadingLegObsForGex` (already reads the full chain every GEX cycle) | Same cohort, same query, one new SELECT column — the codebase's own `picker-chain.ts` is direct precedent for exactly this kind of additive widening |

**Key insight:** every piece of raw material this phase needs (OCC root/expiry
parsing, fractional-T math, a live risk-free rate, a full every-strike-every-cycle
chain read) already exists somewhere in this codebase, just not wired to the scenario
engine. The work is connecting existing pure functions and existing already-fetched
data, not inventing new infrastructure.

## Common Pitfalls

### Pitfall 1: Day-count-convention mismatch between IV calibration and re-pricing

**What goes wrong:** `iv-calibration.ts` and `position-greeks.ts` already compute `T`
using a 365.25-day year (`MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000`). If
`scenario-engine.ts`'s fractional-DTE fix uses a DIFFERENT convention (e.g. still
`/365`, or `/365.2425` Gregorian-mean), the IV that was CALIBRATED against one `T` gets
RE-PRICED against a slightly different `T` — a new, avoidable mismatch on top of the
whole-day-rounding bug this phase is fixing.

**Why it happens:** Nothing enforces day-count consistency across files; each file
picked its own divisor historically (`/365` in `scenario-engine.ts` and
`tos-parser.ts`, `/365.25` in `iv-calibration.ts`/`position-greeks.ts`).

**How to avoid:** Use `365.25` uniformly (D-02) — matches the ALREADY-SHIPPED
calibration path (`resolveLegIv`/`invertIv` via `iv-calibration.ts`), so the IV that
gets calibrated and the IV that gets re-priced share the identical `T` convention.
Materiality of 365 vs 365.25 alone (holding fractional-day counting fixed) at T≈98
days: `ΔT ≈ 98 × 0.25 / (365 × 365.25) ≈ 1.8×10⁻⁴` years ≈ 0.067 days ≈ **~$2** at the
book's ~$32/day theta — small next to the whole-day-rounding fix's estimated $16, but
free to get right at the same time since it's the same divisor everywhere already.

**Warning signs:** A kernel-parity test (Pattern 3) that computes `T` two different
ways and gets two different numbers for the "same" DTE.

### Pitfall 2: AM-settled SPX has no reliable "last trade" proxy for T=0

**What goes wrong:** AM-settled standard SPX cannot be traded after 5:00 PM ET the
Thursday before expiration [CITED: Cboe specifications], but its cash settlement value
(SOQ) isn't published until the FRIDAY MORNING opening auction — 30–45 minutes after
9:30 AM ET [CITED: marketdata.app SPX vs SPXW]. There is genuine ambiguity in what "T
at expiration" should mean for BSM modeling purposes: last-tradeable-instant (Thursday
5pm) vs value-determining-instant (Friday ~9:30-10:15am SOQ window).

**Why it happens:** BSM's `T→0` limit represents "the instant the payoff is
determined," which for AM-settled options is NOT the same instant as "the instant the
market stops letting you trade it."

**How to avoid:** This research recommends **Friday 09:30 ET (market open)** as the
settlement-timestamp anchor (Pattern 1) — the payoff-determining instant, matching how
PM-settled options anchor to 16:00 ET (also their payoff-determining instant, which
happens to coincide with their last-tradeable instant). This choice is **[ASSUMED]** —
no single authoritative source was found pinning down "what timestamp should a BSM
model use for AM-settled T=0"; it is this research's best-reasoned inference from the
settlement mechanics, not a verified industry convention. Flagged in Assumptions Log
(A1). Low blast radius: AM-settled legs are a small minority of any SPX calendar book
(only the literal 3rd-Friday-of-month series), and the 09:30-vs-Thursday-5pm choice
differs by roughly half a day out of 45-143 total days — smaller than the whole-day
fix's own precision floor.

**Warning signs:** None expected in practice (single-digit-hours effect on a
multi-week DTE), but worth a UAT spot-check on any book containing a literal
3rd-Friday-of-month SPX leg.

### Pitfall 3: Parity solve produces a nonsensical/negative or NaN `q` on wide/stale AH quotes

**What goes wrong:** `Math.log(rhs / spot)` (Pattern 2) is undefined when `rhs <= 0` —
happens when the raw `C − P` spread from stale or wide after-hours marks pushes the
right-hand side negative. An unguarded solve would produce `NaN` propagating into
`bsmPrice`'s `d1`/`d2`.

**Why it happens:** `leg_observations.mark` rows persist whatever the sidecar last
saw; outside RTH the chain can be stale or the quoted mark artificially wide.

**How to avoid:** Guard `rhs <= 0` → return `null` (Pattern 2 already does this).
Additionally gate the WHOLE per-expiry carry computation on cohort freshness —
`computeGexSnapshotUseCase` already resolves a `cycleTime` from the data itself (never
`now()`); reject/`null` the implied-`q` for a cycle whose `cycleTime` is stale relative
to when the GEX use-case runs (mirrors the existing `LIVE_MARK_FRESH_MS`-style
freshness-gating pattern already used client-side in `Overview.tsx`). Missing/stale →
web-side `resolve-carry.ts` falls back to `DEFAULT_DIV` (byte-honest degradation, per
CONTEXT.md hard requirement).

**Warning signs:** A UAT run during a low-liquidity window (e.g., right after RTH open,
before the chain fully populates) showing an implausible implied dividend yield
(deeply negative, or > a few percent for SPX).

### Pitfall 4: `AnalyzerPosition`'s new optional fields silently do nothing for picker/pasted positions

**What goes wrong:** `candidate-to-position.ts` (picker candidates) and
`parsed-calendar-to-candidate.ts` → `tos-parser.ts` (pasted TOS orders) both construct
`AnalyzerPosition` without ever setting the new `frontDteExact`/`backDteExact`/
per-calendar rate fields — if a future maintainer expects "fractional DTE" to apply
everywhere after this phase ships, it silently doesn't for those two paths (by design,
per CONTEXT.md scope — this phase touches Overview's live-book path only).

**Why it happens:** Both paths construct `PickerCandidate`/`ParsedCalendar` shapes with
only whole-day `dte` fields (`packages/contracts/src/picker.ts`: `dte: z.number().int()`
on both `frontLeg`/`backLeg`) — genuinely out of scope (picker engine owns its own math
per CONTEXT.md).

**How to avoid:** Document this explicitly (this Pitfall) rather than silently leaving
it undiscoverable; the graceful optional-field fallback in `scenario-engine.ts` means
nothing BREAKS, it just doesn't gain the precision improvement outside the live book.
`tos-parser.ts` COULD gain the same `settlementTimestamp()` treatment cheaply (it
already computes `frontDte`/`backDte` from real millisecond differences, just rounded
to whole days, and Rule 7's `underlying` default is always `"SPX"` — the 3rd-Friday
date heuristic from Pattern 1 works even without an OCC root, since only the literal
3rd Friday can ever be AM-settled) — flagged as Claude's Discretion / a cheap
same-pattern follow-up, not required for the UAT gate (the gate's target book is the
live broker book, not a pasted one).

**Warning signs:** A UAT tester pastes a TOS order and finds T+0 slightly less precise
than the live-book calendars — expected, not a bug, per this scope decision.

### Pitfall 5: `gexSnapshotEntry`'s existing consumers must tolerate a new optional field

**What goes wrong:** `gexSnapshotEntry` (Zod) is consumed by `useGex()`
(`gexSnapshotResponse.parse(...)`), the MCP `get_gex` tool, AND
`apps/web/src/lib/gex-regime.ts` (per the earlier repo grep for `America/New_York`
usages, `gex-regime.ts` reads GEX fields for the regime board — a DIFFERENT consumer
than Overview's payoff hero). A new required field would break existing fixture-based
tests across all these consumers.

**Why it happens:** `gexSnapshotEntry` is a single shared Zod schema (MCP-02
discipline, `gex.ts`'s own header comment) — every consumer parses the exact same
shape.

**How to avoid:** The new `impliedDivYield` field MUST be added as either an
`.optional()` or defaulted-to-`[]`/nullable array — never a bare required field —
mirroring the existing `nearTerm: z.object({...}).nullable()` precedent already in the
same schema for "may not exist on older/incomplete snapshots."

**Warning signs:** `bun run typecheck`/`vitest run` failures in `gex-regime.ts`'s test
suite or existing GEX fixture-based tests immediately after the schema edit — the
fastest possible detection, not a runtime surprise.

## Code Examples

### Fractional-DTE-aware `AnalyzerPosition` T resolution (scenario-engine.ts)

```typescript
// Source: this repo's own iv-calibration.ts/position-greeks.ts 365.25 precedent + D-02
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000; // matches calibration path, Pitfall 1

/** Resolve a leg's fractional DTE: prefer the exact value when the caller supplied it
 *  (live book, this phase), else fall back to the existing whole-day integer (Pitfall 4). */
function resolveDte(exact: number | undefined, whole: number): number {
  return exact ?? whole;
}

// in calendarNetPrice / bookGreekAt / positionGreeksAt:
const backT = Math.max((resolveDte(pos.backDteExact, pos.backDte) - daysForward) / 365.25, 1e-6);
const frontT = Math.max((resolveDte(pos.frontDteExact, pos.frontDte) - daysForward) / 365.25, 0);
```

### Per-calendar carry resolution (new `resolve-carry.ts`, web)

```typescript
// Source: Pattern 2 (server-computed q) + already-fetched FRED r (D-06)
import type { GexSnapshotResponse, MacroResponse } from "@morai/contracts";

const DEFAULT_RATE = 0.045; // existing Overview.tsx constant — degrade target
const DEFAULT_DIV = 0.013;  // existing Overview.tsx constant — degrade target

/** Linear-interpolate the FRED short rate (percent units → decimal) to a leg's DTE (days). */
function interpolateRate(macro: MacroResponse, dte: number): number | null {
  const oneMo = macro["DGS1MO"]?.at(-1)?.value; // most recent point, ascending order
  const threeMo = macro["DGS3MO"]?.at(-1)?.value;
  if (oneMo === undefined || threeMo === undefined) return null;
  const t = Math.min(Math.max((dte - 30) / (90 - 30), 0), 1); // clamp to [30d, 90d] bracket
  return (oneMo + (threeMo - oneMo) * t) / 100; // FRED is percent; BSM wants decimal
}

export function resolveCarry(
  gex: GexSnapshotResponse | undefined,
  macro: MacroResponse | undefined,
  expiration: string,
  dte: number,
): { rate: number; divYield: number } {
  const rate = macro !== undefined ? (interpolateRate(macro, dte) ?? DEFAULT_RATE) : DEFAULT_RATE;
  const entry = gex?.impliedDivYield?.find((e) => e.expiration === expiration);
  const divYield = entry?.value ?? DEFAULT_DIV;
  return { rate, divYield };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `dte()` whole-day `Math.ceil`, `/365` in `scenario-engine.ts` | Settlement-aware fractional DTE, `/365.25` | This phase | Eliminates the ~10-30 BE-point T+0 gap CONTEXT.md measured against live TOS |
| Flat `DEFAULT_RATE`/`DEFAULT_DIV` constants | Per-calendar `{rate, divYield}` from live FRED + parity-implied `q` | This phase | Removes a second, independent source of BE-point error; degrades to the same flat constants when data is missing (zero regression risk) |
| N/A — item never built | Smile-aware/sticky-delta re-pricing | Not built this phase (D-12) | TOS's own default mode makes this a non-issue for single-strike calendars; revisit only if UAT residual is measurably vol-attributable |

**Deprecated/outdated:** none — no library versions involved in this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AM-settled SPX's BSM `T=0` anchor should be Friday 09:30 ET (market open / SOQ window), not Thursday 17:00 ET (last trade) | Pitfall 2 | Half-day-scale timing error on the (small) subset of 3rd-Friday-of-month standard SPX legs only; smaller in magnitude than the whole-day-rounding fix this phase already delivers — low risk, easily corrected in a follow-up if UAT shows a systematic bias specifically on AM-settled legs |
| A2 | TOS's Analyze "today" (T+0) line recomputes continuously against the live clock (not a fixed start-of-day snapshot) | Summary / TOS Analyze semantics | If TOS actually freezes T+0 at a fixed reference instant per session, our continuously-recomputed `new Date()` T+0 could diverge from TOS's by up to a few hours of theta on any given intraday comparison — but this doesn't change the RECOMMENDED architecture (still "use the real current instant"), only the interpretation of any residual gap measured mid-session; UAT gate is explicitly RTH-measured, so this is a secondary concern |
| A3 | TOS's own internal risk-free-rate source for the Analyze tab could not be pinned down from public documentation | Summary / OQ2 (TOS defaults) | Does not block the plan — this research's recommendation (FRED `DGS1MO`/`DGS3MO`) is chosen on independent merit (it is a live, already-fetched, real market rate vs a stale hardcoded constant), not as a literal TOS-internals match; if TOS uses a materially different curve, the residual would show up at the UAT measurement and is a tunable follow-up (e.g. swap the interpolation bracket), not an architecture change |

## Open Questions (RESOLVED)

1. **SPX settlement conventions: AM-settled 3rd-Friday SPX vs PM-settled SPXW; exact
   settlement/last-trade timestamps per leg derivable from the OCC symbol; what does
   TOS display/use for DTE fractions?**
   - What we know: AM-settled = root `SPX` + exact 3rd Friday of month, settlement
     value from Friday's opening SOQ; everything else (root `SPXW`, or any other date)
     is PM-settled at 16:00 ET [CITED: Cboe SPX specifications, marketdata.app SPX vs
     SPXW]. Both signals (root, date) are already available from `parseOccSymbol` —
     zero new data needed.
   - What's unclear: the EXACT sub-hour anchor TOS itself uses for AM-settled DTE
     fractions internally (their SOQ isn't published until 30-45 min after open) — not
     independently verifiable from public docs.
   - Recommendation: implement Pattern 1 (09:30 ET anchor for AM-settled, 16:00 ET for
     PM-settled), tagged [ASSUMED] for the AM anchor specifically (A1); low blast
     radius given the whole-day fix dominates the error budget.

2. **TOS Analyze defaults: which vol mode, beginning-vs-end-of-day time decay for the
   "today" line, and its rate source — pin down what "parity" is actually chasing.**
   - What we know: default AND forum-recommended-for-accurate-P&L vol mode is
     "Individual Implied Volatility" — fixed per specific option series as spot moves,
     NOT smile-interpolated [CITED: thinkorswim manual description of the three modes;
     Aeromir forum thread quoting "only the IIV gives you the real p/l"]. This is
     structurally what `scenario-engine.ts` already does for a single-strike calendar.
   - What's unclear: TOS's exact intraday T+0 recompute cadence and internal rate
     source (A2, A3) — neither was found in public docs.
   - Recommendation: do not build smile interpolation (D-12); the vol-mode question is
     resolved decisively enough to deprioritize item 3 entirely rather than merely
     defer it. Continue recomputing T+0 against the live current instant (already
     current behavior) — matches the AVAILABLE evidence about how TOS's simulated
     Risk Profile behaves.

3. **Put-call parity implied carry: robust estimator from our chain snapshot (ATM
   bracket? regression across strikes? handle wide AH quotes), and where to compute it
   (web pure function over already-fetched data vs server-computed field).**
   - What we know: decompose into `r` (fixed from already-fetched FRED `DGS1MO`/
     `DGS3MO`) + `q` (solved from a single ATM-bracket parity equation per expiry,
     Pattern 2) [CITED: put-call parity fundamentals — Wikipedia, Macroption,
     Interactive Brokers ATM-straddle-parity guidance]. Compute server-side, inside
     the ALREADY-scheduled `computeGexSnapshotUseCase` (same cohort GEX already reads),
     exposed as one additive `gexSnapshotEntry` field — not a new endpoint, not a
     client-side computation over raw chain data (raw marks never need to leave the
     server).
   - What's unclear: whether an ATM-bracket single-pair solve vs a wider
     regression-across-strikes materially differs in practice for SPX's liquid ATM
     region — not independently testable without live data; both degrade identically
     (null on insufficient data) so the choice is a robustness refinement, not an
     architecture decision.
   - Recommendation: start with the ATM-bracket single-pair (or narrow 2-3-strike
     average) estimator (Pattern 2) — simplest, matches canonical practice, cheapest
     to TDD with a hand-computed oracle (round-trip: forward-price synthetic C/P via
     `bsmPrice` with a KNOWN q, assert the solver recovers it). Regression-across-
     strikes is Claude's Discretion as a future robustness upgrade, not required this
     phase.

4. **Does the engine's 365-day year vs 365.25 vs ACT/365F materially matter at
   98-143d?**
   - What we know: 365 vs 365.25 alone (holding fractional-day-counting fixed)
     produces ≈0.067 days of `T` error at 98 DTE ≈ ~$2 at the book's ~$32/day theta
     (Pitfall 1) — small next to the whole-day-rounding fix's ~$16, but the codebase
     ALREADY uses 365.25 in two other places (`iv-calibration.ts`, `position-greeks.ts`)
     that this phase's fix must stay consistent with, or introduce a NEW mismatch.
   - What's unclear: nothing material — this question is resolved.
   - Recommendation: use 365.25 uniformly (D-02) — a free consistency win bundled with
     the fractional-DTE fix, not a second independent lever worth its own separate
     analysis.

5. **Fractional-DTE plumbing: where do dteFront/dteBack get consumed besides the
   engine (sizing? DTE badges? exit advisor via server — out of scope but must not
   break)?**
   - What we know (full inventory, `rg` verified): `Overview.tsx`'s DTE display badge
     (`ExpiryCellInput`) reads the EXISTING whole-day `cal.dteFront`/`dteBack` —
     unaffected, stays integer per CONTEXT.md's explicit "integer display can stay."
     `Analyzer.tsx:501`'s `computeProjectionBounds([selectedPosition.frontDte], today)`
     is a display-scale projection-axis bound — unaffected. `payoff-domain.ts` does
     NOT read `frontDte`/`backDte` at all (verified — no matches). `packages/
     contracts/src/journal.ts`'s `dteFront`/`dteBack` (`z.number().int()`) is a
     completely separate server-side journal-snapshot table, no import relationship
     with `scenario-engine.ts` — untouched. `packages/contracts/src/picker.ts`'s `dte`
     fields (×2, both `z.number().int()`) feed `candidate-to-position.ts`/
     `parsed-calendar-to-candidate.ts`/`TermStructureChart.tsx` — picker-engine-owned,
     explicitly out of scope; these paths simply never set the new optional
     `frontDteExact`/`backDteExact` fields, so they get the existing (unchanged, minus
     the 365→365.25 divisor) behavior automatically (Pitfall 4).
   - What's unclear: nothing material — this question is resolved by exhaustive
     inventory.
   - Recommendation: no additional guard needed beyond the optional-field design
     already locked by CONTEXT.md ("AnalyzerPosition gains optional fields at most").

## Environment Availability

No external dependencies for this phase — skip per the skip condition (code/pure-
function changes plus one additive DB column read, no new tool/service/runtime
dependency). Postgres (already required for `leg_observations`) and the FRED-backed
`macro` endpoint (already live in prod per `morai-phase14-fred-complete` project
history) are both pre-existing, unaffected infrastructure.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace `test.projects`), `fast-check` (numerical property tests, per `.claude/rules/tdd.md`), `testcontainers` (Postgres repo changes) |
| Config file | `apps/web/vitest.config.ts` (jsdom); `packages/*/vitest.config.ts` (node) — existing, unchanged |
| Quick run command | `cd apps/web && bunx vitest run src/lib/scenario-engine.test.ts src/lib/pair-calendars.test.ts` (client fix); `cd packages/core && bunx vitest run src/analytics/domain/implied-carry.test.ts` (server fix) |
| Full suite command | `bun run test` (root workspace) |

### Phase Requirements → Test Map

No formal REQ IDs exist for Phase 34 yet (same situation as Phase 33's research) — the
planner should assign REQ IDs during plan creation. Provisional behavior → test map,
keyed to CONTEXT.md's ranked scope items:

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|---------------------|--------------|
| Settlement-timestamp helper: AM-settled 3rd Friday → 09:30 ET; PM/other → 16:00 ET; DST-safe across an EST/EDT boundary date | unit (example + fast-check round-trip vs a hand-computed offset table) | `vitest run packages/shared/src/settlement-timestamp.test.ts` | ❌ Wave 0 — new file |
| Kernel-parity: `repriceScenario` fed `frontDteExact` produces the identical price/greeks as a direct `bsmPrice`/`bsmGreeks` call using the same independently-computed `T` (Pattern 3) | unit (extends existing kernel-parity describe block) | `vitest run apps/web/src/lib/scenario-engine.test.ts` | ✅ Existing file, new test cases |
| `pair-calendars.ts` `dteExact()`: whole-day `dte()` unchanged; new exact variant matches settlement-timestamp helper; degrades to `dte()` on unparseable OCC | unit | `vitest run apps/web/src/lib/pair-calendars.test.ts` | ✅ Existing file, new test cases |
| Parity solver: round-trip — forward-price synthetic C/P via `bsmPrice` with a KNOWN `q`, assert `impliedDivYield` recovers it within tolerance; guards `rhs <= 0` → `null`, never `NaN` | unit (example) + fast-check (round-trip property, numRuns per repo convention) | `vitest run packages/core/src/analytics/domain/implied-carry.test.ts` | ❌ Wave 0 — new file |
| `readLegObsForGex` widened SELECT: `mark` column present and correctly typed for both Postgres and in-memory adapters | integration (testcontainers, per `.claude/rules/tdd.md` "Postgres repos → testcontainers against real Postgres") | `vitest run packages/adapters/src/postgres/repos/*.contract.test.ts` (extend existing contract-test pattern already used by `leg-observations.contract.ts`) | ✅ Existing contract-test pattern, extend fixtures |
| `gexSnapshotEntry` schema: new `impliedDivYield` field is optional/nullable-safe; existing fixtures (no field present) still parse | unit | `vitest run packages/contracts/src/gex.test.ts` | ✅ Existing file, new test cases |
| `resolve-carry.ts`: degrades to `DEFAULT_RATE`/`DEFAULT_DIV` when `gex`/`macro` data is `undefined`, stale, or the expiry has no matching entry | unit | `vitest run apps/web/src/lib/resolve-carry.test.ts` | ❌ Wave 0 — new file |

### Sampling Rate

- **Per task commit:** the touched file's quick-run command (above).
- **Per wave merge:** `bun run test` (full workspace).
- **Phase gate:** full suite green before `/gsd-verify-work 34`; UAT measurement
  (RTH, live marks, BE-today vs TOS) is the phase's acceptance bar per CONTEXT.md.

### Wave 0 Gaps

- [ ] `packages/shared/src/settlement-timestamp.ts` + `.test.ts` — new pure function,
      no framework install needed.
- [ ] `packages/core/src/analytics/domain/implied-carry.ts` + `.test.ts` — new pure
      function, fast-check already a workspace dependency (used elsewhere per TDD rule).
- [ ] `apps/web/src/lib/resolve-carry.ts` + `.test.ts` — new pure function.
- [ ] Extend `packages/adapters/src/postgres/repos/*.contract.test.ts` fixtures with a
      `mark` column value — confirm the exact file name during planning (`rg -l
      "readLegObsForGex"` under `packages/adapters/src/postgres/repos/` to pin down
      which repo file currently implements the GEX leg-obs read; this research
      confirmed the PORT (`ForReadingLegObsForGex`) and its TYPE (`LegObsForGex`) in
      `packages/core/src/analytics/application/ports.ts` but the planner should grep
      for the concrete Postgres implementation file name before writing tasks, since
      `leg-observations.ts` (read during this research) implements a DIFFERENT port
      set — `ForReadingSmileSource` et al. — not `ForReadingLegObsForGex` itself).

## Security Domain

`security_enforcement: true` (`.planning/config.json`), so this section is included —
this phase has minimal new attack surface: no new user input parsing, no new auth
surface, and the one new field is server-computed from already-trusted internal data
(the chain the system itself ingests from Schwab/CBOE).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | Unaffected — no auth surface touched |
| V3 Session Management | No | Unaffected |
| V4 Access Control | No | Unaffected — `GET /api/analytics/gex` already exists behind existing auth middleware; the new field rides the same authenticated response |
| V5 Input Validation | Marginal | `impliedDivYield` is server-computed, never derived from raw user input; the ONLY external input surface is the leg_observations chain data already ingested and Zod-validated at the vendor-adapter boundary (unchanged this phase) |
| V6 Cryptography | No | Unaffected |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| `Math.log()` domain error (NaN propagation) on adversarial/degenerate chain data (e.g. a corrupted `mark` of 0 or negative) | Tampering (data-integrity, not a security exploit vector — internal pipeline data) | Explicit `rhs <= 0` / `!Number.isFinite` guards (Pattern 2, Pitfall 3) — never let a computed `q` reach `bsmPrice`'s `d1`/`d2` as `NaN`; degrade to `null` → client falls back to `DEFAULT_DIV` |

## Sources

### Primary (HIGH confidence)

- Direct source-file reads in this repository (file paths cited inline throughout):
  `packages/shared/src/occ-symbol.ts`, `packages/shared/src/rth-window.ts`,
  `packages/quant/src/bsm.ts`, `apps/web/src/lib/{scenario-engine,pair-calendars,
  iv-calibration,position-greeks,tos-parser,candidate-to-position,
  parsed-calendar-to-candidate,payoff-domain}.ts`, `apps/web/src/screens/Overview.tsx`,
  `apps/web/src/hooks/{useGex,useMacro}.ts`, `packages/contracts/src/{gex,macro,
  picker,journal,analytics}.ts`, `packages/core/src/analytics/{application/{ports,
  computeGexSnapshot,computeAnalytics}.ts,domain/gex.ts}`, `packages/adapters/src/
  {smile-moneyness.ts,postgres/repos/{leg-observations,picker-chain}.ts}`.
- [Cboe SPX Specifications](https://www.cboe.com/tradable-products/sp-500/spx-options/spx-specifications/) — trading hours, last-trading-day cessation times (AM: Thursday 5pm ET; PM/SPXW: expiration-day 4pm ET / 1pm ET half-day).

### Secondary (MEDIUM confidence)

- [SPX vs SPXW Options — marketdata.app](https://www.marketdata.app/education/options/spx-vs-spxw-options/) — AM/PM settlement mechanics, SOQ timing (30-45 min post-open).
- [When Do SPX Options Expire? — fattail.ai](https://fattail.ai/spx-options-expiration/) — SOQ / opening-auction-VWAP settlement mechanics.
- [TOS IV model settings — Aeromir Discussion Forums](https://forums.aeromir.com/threads/tos-iv-model-settings.2339/) — default = Individual Implied Volatility; forum consensus on P&L accuracy.
- [thinkorswim's Analyze Calculations — CapitalDiscussions Forums](https://forums.capitaldiscussions.com/threads/thinkorswims-analyze-calculations-individual-implied-volatility-or-volatility-smile-approximation.1488/) — corroborating description of the three vol modes.
- [Put–call parity — Wikipedia](https://en.wikipedia.org/wiki/Put%E2%80%93call_parity) — parity formula, forward-price/dividend-adjustment relationship.
- [Put-Call Parity Formula — Macroption](https://www.macroption.com/put-call-parity-formula/) — formula reference.
- [Understanding Put-Call Parity — Interactive Brokers](https://www.interactivebrokers.com/campus/trading-lessons/understanding-put-call-parity-2/) — ATM straddle as the canonical parity-testing pair.
- [Sticky Strike vs. Sticky Delta — sophie-ai-finance.com](https://www.sophie-ai-finance.com/articles/sticky-strike-vs-sticky-delta-volatility-surface-dynamics), [Delta Quants](http://deltaquants.com/volatility-sticky-strike-vs-sticky-delta) — sticky-strike/sticky-delta/sticky-moneyness definitions.
- [ACT/365 fixed — ACT Wiki](https://wiki.treasurers.org/wiki/ACT/365_fixed) — day-count convention definitions (365 vs 365.25 vs ACT/365F).

### Tertiary (LOW confidence)

- General web search summaries on TOS's Risk Profile "today" line intraday-decay
  convention and TOS's internal rate source — no single authoritative citation found;
  recorded as Assumptions A2/A3, does not block the recommended architecture.

## Metadata

**Confidence breakdown:**
- Fractional-DTE architecture (item 1): HIGH — every building block verified by
  reading this repo's own source; the only genuinely new logic (settlement-timestamp
  construction) is a small, testable pure function over well-cited public settlement
  facts.
- Carry-decomposition architecture (item 2): HIGH for the "fix r from FRED" half
  (verified: the data is already fetched, already in scope, already correctly typed);
  MEDIUM for the parity-solver robustness details (ATM-bracket vs regression, AH-quote
  gating) — sound in principle, not validated against this system's actual live chain
  data in this research session.
- Settlement-timestamp AM/PM rule: MEDIUM — the AM/PM classification itself is HIGH
  confidence (multiple independent citations agree); the exact sub-hour anchor for
  AM-settled `T=0` is LOW/ASSUMED (A1), with low practical impact given its small
  magnitude relative to the dominant whole-day-rounding fix.
- Item-3 deferral (smile-aware IV): HIGH — TOS's own default/recommended mode was
  independently confirmed by two separate forum sources describing the identical
  three-mode behavior, and the "fixed IV per specific series" description maps
  unambiguously onto this book's single-strike-per-calendar shape.

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (30 days — no library versions pinned this phase, so
staleness risk is limited to public-doc drift on TOS's UI/settings, low likelihood of
material change in 30 days).
