# Phase 24: Regime & Breadth Board - Research

**Researched:** 2026-07-09
**Domain:** Market-regime indicators (volatility term structure, vol-of-vol, credit spreads, breadth) surfaced as a threshold-banded board on the Overview tab
**Confidence:** HIGH (data-availability findings are live-verified; threshold rationale is MEDIUM — practitioner-sourced, not academically peer-reviewed for every cut)

## Summary

Four candidate families were adjudicated against the phase's evidence-or-drop discipline. **Two admit
cleanly**: the VIX/VIX3M term-structure ratio (inputs already in-house since Phase 23) and the absolute
VVIX level (already in-house since Phase 14) — both confirm the user's calibrated thresholds from
`docs/tos-studies-learnings.md` against independent online sources. **One admits with a new but
verified data source**: VIX9D/VIX, which requires a new CBOE `_VIX9D` delayed-quote endpoint (live-
verified today, byte-identical JSON shape to the existing `cboe-vvix.ts` adapter) since FRED does not
carry a VIX9D series (`VIX9DCLS` returns HTTP 404). **One is a data-driven drop**: RSP:SPY equal-weight
breadth. No in-system adapter exposes raw equity/ETF quotes (the Schwab sidecar only proxies option
chains; `Stooq`'s CSV endpoint is blocked by a client-side JS proof-of-work challenge that cannot be
solved from a server-side fetch). The academic evidence for RSP:SPY itself is also weaker than the
user's TOS-study confidence suggested (near-zero return-correlation in a 2003–2018 sample). A FRED
substitute for the credit leg is proposed: `BAMLH0A0HYM2` (ICE BofA US HY OAS), which live-verifies
cleanly and requires zero new adapter code — just a new series id on the existing parameterized FRED
adapter.

The VVIX/VIX *ratio* form (as literally named in the CONTEXT.md candidate list) is a real, documented
indicator — but on a completely different numeric scale (4–7 normal-to-high-risk) than the user's
calibrated absolute-VVIX thresholds (100/115). Shipping both would double-count the same two raw
series under two uncalibrated threshold sets. This research recommends shipping only the absolute-VVIX
form this phase (it has the user's battle-tested calibration) and documenting the ratio form as a
deferred, separately-calibratable indicator.

**Primary recommendation:** Ship four board indicators — VIX/VIX3M term-structure state, VVIX absolute
level, VIX9D/VIX short-term stress ratio, and HY OAS credit spread — all computed-on-read from
`macro_observations` via a new pure domain module in the existing `analytics` bounded context. Drop
RSP:SPY breadth with a documented refutation and revival path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch new series (CBOE VIX9D, FRED HY OAS) | API / Backend (worker cron + `packages/adapters/src/http`) | — | Mirrors existing `fetch-rates` job; no new job needed |
| Persist observations | Database / Storage (`macro_observations`, existing table) | — | Same shape as all 9 existing series; 2 new `seriesId` values, no schema change |
| Compute ratios/bands (VIX/VIX3M, VVIX, VIX9D/VIX, HY OAS) | API / Backend (`packages/core/src/analytics`) | — | Pure derivation from persisted rows — computed-on-read, no new table |
| Expose board payload | API / Backend (HTTP route + MCP tool) | — | Mirrors `GET /api/analytics/macro` + `get_macro` (MCP-02 convention) |
| Render chips + provenance | Browser / Client (`apps/web/src/screens/Overview.tsx`) | — | MetricChip molecule already exists; board is new chips in the existing grid, not a new page |

## Standard Stack

**Zero new npm dependencies** (CONTEXT.md hard constraint, confirmed compatible with all four admitted
indicators — no candidate requires a library beyond `zod`, already a dependency, and the native `fetch`
already used by every HTTP adapter in `packages/adapters/src/http/`).

### Core (existing, reused)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | (already a workspace dep) | Parse FRED/CBOE JSON at the adapter edge, parse the board response contract | Existing project convention, every HTTP adapter and contract uses it |

### New external HTTP resources (not npm packages — endpoints only)
| Resource | Verified | Purpose | Adapter pattern to mirror |
|---|---|---|---|
| CBOE `_VIX9D` delayed quote | `HTTP 200`, 2026-07-09 06:03 UTC, `current_price: 14.41` | 9-day VIX numerator for VIX9D/VIX | `packages/adapters/src/http/cboe-vvix.ts` (identical `{timestamp, data:{current_price,...}}` shape) |
| FRED `BAMLH0A0HYM2` (HY OAS) | `HTTP 200` via `fredgraph.csv`, latest row `2026-07-07,2.67` | Credit-stress leg (replaces HYG, which is unreachable — see Package/Data Legitimacy) | `packages/adapters/src/http/fred.ts` `makeFredSeriesAdapter` — just a new series id string, zero new code |

**Installation:** none. No `npm install` required this phase.

**Version verification:** N/A — no packages installed. Both new resources are plain HTTP endpoints
verified live via `curl` during this research session (see Package Legitimacy Audit for full detail).

## Package Legitimacy Audit

No new npm packages are proposed this phase (CONTEXT.md hard constraint: "ZERO new npm
dependencies"). This section instead documents the **data-source legitimacy check** required by
CONTEXT.md's data-constraints clause ("A new public HTTP endpoint fetch... acceptable ONLY if research
verifies the endpoint live").

| Resource | Type | Verified live | Response shape | Verdict | Disposition |
|---|---|---|---|---|---|
| `cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json` | CBOE delayed-quote JSON | HTTP 200, 2026-07-09 | Identical to already-shipped `_VVIX`/`_VIX3M` endpoints (`{timestamp, data:{current_price, close, prev_day_close,...}}`) | OK | Approved — mirror `cboe-vvix.ts` |
| `api.stlouisfed.org/fred/series/observations?series_id=BAMLH0A0HYM2` | FRED series API (existing adapter, new series id) | HTTP 200 via public `fredgraph.csv` mirror; the authenticated `/fred/series/observations` path uses the same series id and the existing adapter code path | Identical to the 9 already-ingested FRED series | OK | Approved — add to `DEFAULT_FRED_SERIES_IDS` |
| `fred.stlouisfed.org/graph/fredgraph.csv?id=VIX9DCLS` | FRED series (candidate, REJECTED) | HTTP 404 (FRED HTML error page, not a series) | N/A | SLOP (hallucinated series id — VIX9D is not published to FRED; confirmed both by direct 404 and absence from FRED's own Volatility Indexes category, which lists VIXCLS/VXNCLS/VXDCLS/GVZCLS/VXFXICLS/OVXCLS but no VIX9D variant) | REMOVED — use CBOE instead |
| `stooq.com/q/d/l/?s=rsp.us&i=d` | Public EOD CSV (candidate for RSP breadth) | HTTP 200, but body is a JS proof-of-work anti-bot challenge page (`crypto.subtle.digest` puzzle), not CSV data | Not parseable server-side without executing JS | SLOP for this use (returns HTTP 200 but is not a usable data endpoint for an unattended cron) | REMOVED — see RSP:SPY adjudication below |
| `query1.finance.yahoo.com/v8/finance/chart/RSP` | Unofficial Yahoo Finance chart API (fallback candidate) | HTTP 200, valid JSON with `regularMarketPrice` | Undocumented/reverse-engineered API, no ToS support, known history of being rate-limited or blocked without notice, requires spoofed `User-Agent` | SUS (works today, no stability guarantee — see refutation below) | Flagged — NOT admitted this phase; documented as a revival path only, gated behind `checkpoint:human-verify` if a future phase attempts it |

**Packages removed due to `[SLOP]` verdict:** none (no npm packages proposed).
**Endpoints removed due to unusable/hallucinated verdict:** `VIX9DCLS` (FRED, hallucinated series id), Stooq CSV (bot-walled, not a usable data endpoint).
**Endpoints flagged `[SUS]`:** Yahoo Finance chart API — not admitted this phase; if a future phase revives RSP:SPY via this endpoint, gate the install behind `checkpoint:human-verify` and add retry/backoff + a hard timeout, since it is known to break without notice.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-02 | Regime/breadth indicator set researched online, admitted only with documented evidence | Per-Indicator Adjudication table below — 4 ADMIT, 2 DROP with documented refutation, matching picker-rules.md's source+rationale-per-row discipline |
| MACRO-03 | Evidence-admitted indicators ingested/computed daily, as-of stamped, EOD not presented as intraday | All 4 admitted indicators derive from `macro_observations` rows that already carry a `date` (YYYY-MM-DD, no time-of-day) — board payload's `asOf` field is that date, never "now" |
| BOARD-01 | Overview board: value + calm/warning/crisis band + as-of date per indicator | Architecture Patterns section — new `analytics/domain/regime.ts` banding functions + board payload shape |
| BOARD-02 | Each indicator exposes its "why" (source + rationale), payload-carried not hardcoded UI copy | Board payload shape (below) carries `source` + `rationale` fields per indicator, mirrors the picker `ruleSet` precedent (`packages/core/src/picker/domain/rules.ts`) |
| BOARD-03 | HTTP route + MCP tool (MCP-02 convention) | Architecture Patterns → Route + MCP registration section, mirrors `GET /api/analytics/macro` + `get_macro` exactly |
</phase_requirements>

## Per-Indicator Adjudication

This is the phase's core deliverable — mirrors `docs/architecture/picker-rules.md`'s evidence-per-row
discipline. Every row below is one indicator, its evidence citations, its live-verification result, its
threshold rationale, and its verdict.

### 1. VIX/VIX3M term-structure ratio — **ADMIT**

- **Data:** FRED `VIXCLS` + `VXVCLS`, both already ingested since Phase 23 (`DEFAULT_FRED_SERIES_IDS` in
  `fetchMacroSeries.ts`). No new fetch. `[VERIFIED: in-repo, packages/core/src/journal/application/fetchMacroSeries.ts]`
- **Evidence:** `[CITED: eco3min.fr/en/vix-backwardation-contango-volatility-term-structure]` — contango
  dominates ~85% of trading days (1990–2025); backwardation is rare (8.6% of days, 55 episodes, median
  duration 1 day) and has historically preceded major drawdowns. `[CITED: systemtrader.co/tools/vix]` —
  a reading above 0.95 is treated as a warning; above 1.0 confirms backwardation.
- **Threshold rationale:** User's prior (0.90 warn / 0.95 danger) is **confirmed** by independent
  sources — 0.95 lines up with the "warning" cut cited by systemtrader.co, and the ratio crossing 1.0
  (true backwardation) is the well-documented rare/stress event. No refinement needed.
- **Bands:** calm `< 0.90` · warning `0.90–0.95` · crisis `≥ 0.95`.

### 2. VVIX absolute level — **ADMIT**

- **Data:** CBOE `_VVIX` delayed-quote, already ingested since Phase 14
  (`packages/adapters/src/http/cboe-vvix.ts`). No new fetch.
- **Evidence:** `[CITED: spotgamma.com/vvix-explained-what-the-volatility-index-tells-traders]`,
  `[CITED: tosindicators.com/research/using-the-vvix-to-trade-spy-volatility-signal]`,
  `[CITED: volatilitybox.com/research/vvix-trading]`, `[CITED: captrader.com/en/blog/vvix]` — converge
  on: normal range 80–100, elevated 100–110, extreme fear above 120, acute-stress readings rare above
  150.
- **Threshold rationale:** User's 100 warn is **confirmed directly** (multiple sources cite 100 as the
  normal/elevated boundary). User's 115 stress is **not cited verbatim anywhere** — it sits inside the
  documented 110–120 "elevated → extreme fear" transition zone. Treat 115 as a CITED interpolation, not
  a verified exact cut; keep the user's number since it is a reasonable point inside the confirmed band
  and the user's own TOS study already back-tested it.
- **Bands:** calm `< 100` · warning `100–115` · crisis `≥ 115`.
- **Note — do not also ship VVIX/VIX ratio as a separate indicator.** The ratio form is real and
  documented (`[CITED: tradingview.com/script/FVF6lHU5 — VVIX/VIX Ratio with Interpretation Levels]`:
  normal 4–6, elevated 6–7, high-risk >7), but it is a **different signal on a different numeric scale**
  than the absolute-VVIX thresholds the user battle-tested in TOS. CONTEXT.md itself flags this
  ambiguity ("candidate list says VVIX/VIX, their TOS study used absolute VVIX"). Shipping the ratio too
  would double-expose the same two raw series under an uncalibrated threshold set. **Deferred** — see
  Refuted/Dropped section.

### 3. VIX9D/VIX — **ADMIT** (new but verified data source)

- **Data:** FRED does **not** carry VIX9D — `VIX9DCLS` returns HTTP 404 (both via `fredgraph.csv` and
  the `/series/VIX9DCLS` page), and FRED's own Volatility Indexes category (`fred.stlouisfed.org/categories/32425`)
  lists VIXCLS/VXNCLS/VXDCLS/GVZCLS/VXFXICLS/OVXCLS but no VIX9D variant — this is a genuine gap, not a
  fetch bug. CBOE's delayed-quotes endpoint **does** carry it:
  `cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json`, live-verified today, HTTP 200,
  `current_price: 14.41`, byte-identical response shape to the already-shipped `_VVIX` and `_VIX3M`
  endpoints on the same host. `[VERIFIED: curl, 2026-07-09]`
- **Evidence:** `[CITED: topstep.com/blog/understanding-volatility-term-structure]`,
  `[CITED: macroption.com/vix-term-structure]`, `[CITED: cboe.com/tradable-products/vix/term-structure]`
  — VIX9D/VIX compares 9-day to 30-day expected volatility, a recognized short-term stress read (the
  near end of the term structure inverting ahead of the 30-day point).
- **Threshold rationale:** No source gives a specific numeric backtested cut (unlike VIX/VIX3M's
  documented 0.90/0.95). The proposed bands below are `[ASSUMED]` — structurally mirroring the
  VIX/VIX3M ratio logic (>1.0 = near-curve inversion = stress) by analogy, not backtested. **Flag for
  user confirmation** before treating as anything beyond a display-only band; do not wire into any
  future hard gate (Phase 28) without a dedicated backtest.
- **Bands (provisional, `[ASSUMED]`):** calm `< 1.0` · warning `1.0–1.1` · crisis `≥ 1.1`.

### 4. RSP:SPY equal-weight breadth ratio — **DROP** (data-availability failure)

- **Data — no verified source exists:**
  - Schwab sidecar (`apps/sidecar`) exposes exactly 4 endpoints: `/sidecar/health`, `/sidecar/chain`
    (option chains only), `/sidecar/events`, `/sidecar/subscribe` — no raw equity/ETF quote surface.
    `[VERIFIED: grep across apps/sidecar/*.py]`
  - Schwab's own market-data chain adapter (`packages/adapters/src/schwab/market/chain-adapter.ts`)
    fetches `marketdata/v1/chains` (option chains); its `underlyingPrice` field is a chain-fetch
    byproduct, not a standalone equity-quote surface, and using it for RSP/SPY would mean pulling a full
    option chain per ETF just to read the underlying spot — wasteful and outside the adapter's actual
    contract.
  - `stooq.com/q/d/l/?s=rsp.us&i=d` returns HTTP 200 but the body is a JS proof-of-work anti-bot
    challenge (`crypto.subtle.digest` puzzle in a `<script>` tag), not CSV — confirmed live for RSP, SPY,
    *and* HYG (same challenge on all three symbols tested). Not fetchable from an unattended server cron
    without executing untrusted JS. `[VERIFIED: curl, 2026-07-09, all 3 symbols identical challenge page]`
  - `query1.finance.yahoo.com/v8/finance/chart/RSP` **does** return real JSON quote data (HTTP 200,
    `regularMarketPrice: 212.2`) — but it is a well-documented unofficial/reverse-engineered API with no
    ToS support, a history of being blocked or rate-limited without notice, and requires a spoofed
    `User-Agent` to avoid a 429. Building a production daily-cron dependency on it violates this
    project's root-cause-not-band-aid discipline (`.claude/rules/workflow.md` Change Hygiene). Not
    admitted this phase.
- **Evidence is also weaker than the user's TOS-study confidence suggests, independent of data
  availability:** `[CITED: cxoadvisory.com/technical-trading/rspspy-as-a-stock-market-breadth-indicator]`
  — an academic review found weekly RSP/SPY changes have near-zero correlation with subsequent SPY
  returns (Apr 2003–Jul 2018 sample); only *large drops* in the ratio showed an association with
  elevated volatility, not a clean predictive signal. `[CITED: optionstradingiq.com/rsp-spy-ratio-breadth-indicator]`
  frames it as "a clean lens on broad participation" (concentration monitor) rather than a calibrated
  timing signal.
- **Verdict: DROP.** Documented refutation: no verified, stable, server-fetchable data source exists in
  this system today, and the independent evidence for the signal itself is more equivocal than the
  user's calibration implies.
- **Revival path:** (a) if the Schwab sidecar ever adds a `/sidecar/quote` equity-quote proxy (would need
  a sidecar code change, out of scope here), or (b) if the team explicitly accepts the Yahoo Finance
  chart-API instability risk with monitoring + retry/backoff, gated behind `checkpoint:human-verify`.

### 5. FRED "movement series" — HY OAS `BAMLH0A0HYM2` — **ADMIT** (replaces the HYG credit leg)

- **Data:** FRED series `BAMLH0A0HYM2` (ICE BofA US High Yield Index Option-Adjusted Spread), live-
  verified via `fredgraph.csv`: HTTP 200, latest row `2026-07-07,2.67` (i.e. 2.67% = 267bp). Uses the
  **existing** `makeFredSeriesAdapter` unmodified — only a new series-id string added to
  `DEFAULT_FRED_SERIES_IDS` / `MACRO_SERIES_IDS`. `[VERIFIED: curl, 2026-07-09]`
- **Why this instead of HYG:** the original fragility-composite credit leg in
  `docs/tos-studies-learnings.md` (`HYG < 20d avg`) needs an ETF close — same data-availability problem
  as RSP:SPY (no in-system source, Stooq blocked). HY OAS is the FRED-native, free, no-key-required
  equivalent risk signal and needs zero new adapter code.
- **Evidence:** `[CITED: eco3min.fr/en/hy-oas-credit-spread-recession-signal-equity-markets]` — HY OAS
  leads equity drawdowns by 2–4 weeks in stress regimes; spreads above 800bp have historically coincided
  with or preceded recession; below ~300–350bp signals late-cycle complacency.
  `[CITED: macroradar.io/high-yield-spread]`, `[CITED: convextrade.com/metrics/bamlh0a0hym2]` — corroborate
  the same tiering.
- **Threshold rationale:** No exact match to the user's `HYG < 20d avg` design exists (different series,
  different units), so this is a **new** calibration, not a refinement of an existing user prior. Ship
  as an absolute-level band (not a moving-average comparison) — see Architecture question 7 for why: a
  brand-new series has zero history on ship day, so a 20-day-average check would be non-functional for
  the first ~4 trading weeks. An absolute-level band works immediately.
- **Bands (raw value = FRED's percent units, e.g. `2.67` = 2.67% = 267bp):** calm `< 3.0` · warning
  `3.0–5.0` · crisis `≥ 5.0`. Rationale text should additionally note (not as a 4th band) that ≥8.0
  historically correlates with recession-consistent stress, per the cited sources.

### 6. Front-month IV inversion from the own SPX chain — brief adjudication, **KEEP OUT of this board**

The picker already computes per-candidate front/back IV slope (`slope` rule,
`packages/core/src/picker/domain/rules.ts`) and the Analyzer surfaces it. Re-surfacing the same
per-candidate structure signal on the Overview regime board would duplicate the Analyzer's job and blur
the board's intended scope (macro/cross-asset regime, not per-candidate structure). Not adjudicated as a
data-availability question — this is a scope call: **keep the board macro-level**, per CONTEXT.md's
own framing ("board is chips/cards... macro-level").

## Refuted / Dropped

| # | Candidate | Reason | Revival path |
|---|-----------|--------|---------------|
| 1 | RSP:SPY equal-weight breadth ratio | No verified, stable, server-fetchable data source in-system (Stooq bot-walled; Schwab sidecar has no equity-quote surface); independent academic evidence is also weaker than the user's TOS calibration implies | Sidecar equity-quote endpoint (code change, out of scope) OR accept Yahoo Finance chart-API instability with monitoring — gate behind `checkpoint:human-verify` |
| 2 | VVIX/VIX ratio (as a *separate* board indicator) | Real, documented indicator (TradingView interpretation levels: 4–6 normal, >7 high-risk) but on a different numeric scale than the absolute-VVIX thresholds the user actually battle-tested in TOS — shipping both double-counts the same two raw series under two uncalibrated bands | Ship as its own indicator in a future phase, with its own calibration study (the user has not TOS-tested this form) |
| 3 | `VIX9DCLS` as a FRED series | Hallucinated/non-existent FRED series id — confirmed HTTP 404 + absent from FRED's Volatility Indexes category | N/A — use CBOE `_VIX9D` instead (already the admitted path) |
| 4 | HYG ETF close (original credit leg) | Same ETF-quote data-availability gap as RSP:SPY — no verified in-system source | Superseded by FRED `BAMLH0A0HYM2` (HY OAS), which is data-available today; if HYG itself is ever needed, same Stooq/Yahoo revival path as RSP:SPY applies |

## Architecture Patterns

### System Architecture Diagram

```
CBOE _VIX9D JSON ──┐
FRED VIXCLS ────────┼──► fetch-rates cron (apps/worker) ──► macro_observations table
FRED VXVCLS ────────┤        (existing job, +1 new CBOE          (existing table,
FRED BAMLH0A0HYM2 ──┘         fetch task + 1 new FRED             +2 new seriesId
                               series id — zero new jobs)          values, no schema change)
                                                                          │
                                                                          ▼
                                              GET /api/analytics/regime ◄─┤ makeGetRegimeBoardUseCase
                                              get_regime MCP tool  ◄──────┤ (packages/core/src/analytics)
                                                     │                    │  reads existing
                                                     │                    │  ForReadingMacroObservations
                                                     ▼                    │  port (already wired in
                                          regimeResponse (Zod, contracts) │  apps/server/src/main.ts)
                                                     │                    │
                                                     ▼                    ▼
                                          apps/web/src/screens/Overview.tsx
                                          new MetricChip row: band color + asOf + provenance popover
```

Data flow: two new series accrete into the same `macro_observations` table the existing 9 series already
use (no schema change). A new pure domain module computes ratios and calm/warning/crisis bands
on-read from that table (no new persisted table, no new job). The board is exposed exactly like the
existing macro endpoint — one Zod contract shared by the HTTP route and the MCP tool.

### Recommended Project Structure (additions only — no new files outside these)
```
packages/core/src/analytics/
├── domain/
│   └── regime.ts               # NEW — pure functions: bandVixTermStructure, bandVvix,
│                                #        bandVix9dRatio, bandHyOas (each returns {value, band})
├── application/
│   └── getRegimeBoard.ts       # NEW — makeGetRegimeBoardUseCase(deps), takes the EXISTING
│                                #        ForReadingMacroObservations port (no new port, no new repo)
└── index.ts                    # export the two new symbols (mirrors GEX export block)

packages/contracts/src/
└── regime.ts                   # NEW — regimeIndicator schema, regimeResponse (array of indicators),
                                 #        shared by the route AND the MCP tool (MCP-02)

packages/adapters/src/http/
└── cboe-vix9d.ts                # NEW — copy of cboe-vvix.ts with seriesId "VIX9D", url swapped to
                                 #        _VIX9D.json (same shape, same spot-resolution fallback chain)

apps/server/src/adapters/http/analytics.routes.ts   # +router.get("/analytics/regime", ...)
apps/server/src/adapters/mcp/tools.ts               # +registerGetRegimeTool (mirrors registerGetMacroTool)
apps/server/src/main.ts                             # wire getRegimeBoard deps (reuses existing
                                                     #  macroObservationsRepo — zero new repo)
apps/web/src/screens/Overview.tsx                   # new board chips row, reads useRegimeBoard()
```

### Pattern 1: Computed-on-read regime board (no new table)

**What:** A new use-case reads the existing `macro_observations` rows (via the port already injected
into `getMacro`'s composition-root wiring) and derives ratios + bands in the domain layer, returning a
`RegimeIndicator[]` — the same computed-on-read shape `getGex.ts`/`getTermStructure.ts` already use for
derived analytics.

**When to use:** Every one of the 4 admitted indicators — none needs a new persisted table. VIX/VIX3M
and VVIX use only the current day's row (raw-level threshold, no history needed). VIX9D/VIX likewise
uses only the current day's two values. HY OAS ships as an absolute-level band (not a moving average)
specifically so it needs zero warm-up history on ship day.

**Example (domain function shape, mirrors `gex.ts`'s pure-function style):**
```typescript
// Source: pattern mirrors packages/core/src/analytics/domain/gex.ts's pickWalls/findFlip —
// pure functions taking primitive inputs, returning a typed band verdict, zero I/O.
export type RegimeBand = "calm" | "warning" | "crisis";

export function bandVixTermStructure(ratio: number): RegimeBand {
  if (ratio >= 0.95) return "crisis";
  if (ratio >= 0.90) return "warning";
  return "calm";
}
```

### Pattern 2: New CBOE series — clone the existing adapter, don't parameterize it

**What:** `cboe-vvix.ts` is intentionally NOT parameterized by symbol (its URL, schema, and even its
`seriesId: "VVIX"` literal are hardcoded). Cloning it to `cboe-vix9d.ts` with the URL and `seriesId`
swapped is the smaller diff than retrofitting a parameterized version across both call sites — matches
the project's own precedent (the FRED adapter IS parameterized because it serves 9 different series
through 1 URL pattern; CBOE only serves 2 series total, each requiring its own literal URL segment
`_VVIX.json` / `_VIX9D.json`).

```typescript
// Source: packages/adapters/src/http/cboe-vvix.ts (existing, verified pattern) — cboe-vix9d.ts
// changes exactly 2 lines: CBOE_VIX9D_URL and the returned seriesId literal.
const CBOE_VIX9D_URL = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json";
// ...same CboeVvixResponseSchema shape (rename to a shared/generic schema if preferred, or duplicate —
// either is fine at 2 call sites; do not build an abstraction for exactly 2 users).
```

### Pattern 3: Route + MCP registration (MCP-02 convention)

**What:** New `GET /analytics/regime` route in `analytics.routes.ts`, new `get_regime` MCP tool in
`tools.ts`, both parsing through the SAME `regimeResponse` Zod schema — exact structural mirror of the
existing `get_macro` pair (`apps/server/src/adapters/mcp/tools.ts` lines ~662–720,
`apps/server/src/adapters/http/analytics.routes.ts` macro route block).

**Board payload shape** (per CONTEXT.md's "Specific Ideas"):
```typescript
// Source: packages/contracts/src/regime.ts (NEW) — Zod-parsed at both the route and MCP tool edges.
export const regimeIndicator = z.object({
  id: z.string(),               // "vix-term-structure" | "vvix" | "vix9d-vix" | "hy-oas"
  label: z.string(),            // "VIX/VIX3M" etc — display label
  value: z.number(),            // current computed value (ratio or raw level)
  band: z.enum(["calm", "warning", "crisis"]),
  asOf: z.string().date(),      // EOD date, never "now" (MACRO-03)
  source: z.string(),           // e.g. "FRED VIXCLS/VXVCLS"
  rationale: z.string(),        // e.g. "warn ≥0.90, crisis ≥0.95 — systemtrader.co backwardation study"
  inputs: z.record(z.string(), z.number()).optional(), // raw component values for the provenance popover
});
export const regimeResponse = z.array(regimeIndicator);
```

### Anti-Patterns to Avoid

- **Don't build a composite fragility score this phase.** BOARD-01/02/03 ask for per-indicator bands,
  not a rolled-up score. The user's original 5-leg fragility composite (`tos-studies-learnings.md`) is
  missing its breadth leg (dropped this phase) and its trend leg (close < 20d avg, not in this phase's
  candidate list at all) — assembling a partial composite would silently misrepresent the user's
  battle-tested 5-leg model. Ship the 4 admitted indicators as independent chips; leave the composite for
  a later phase once/if breadth data exists.
- **Don't parameterize the CBOE adapter into a generic "any CBOE symbol" fetcher for 2 call sites.**
  YAGNI — clone `cboe-vvix.ts`, don't build a factory.
- **Don't wire the VIX9D/VIX or HY OAS bands into any hard gate.** Both are `[ASSUMED]`/newly-calibrated
  this phase (no backtest). CONTEXT.md explicitly defers all hard-gate wiring to Phase 28 — this phase
  is display-only banding.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Parsing FRED/CBOE JSON | A new JSON validator | `zod` (already a dep, already the pattern in every adapter) | Consistency, already-proven error paths (`.safeParse`) |
| 20-day rolling average (if ever revived for HY OAS) | A stateful rolling-window class | Same array-slice-and-average approach `percentile-rank.ts` already uses for GEX percentiles | Existing precedent, no new abstraction |
| Threshold banding logic | A rules-engine / DSL | Plain `if/else` pure functions (Pattern 1 above) — same shape as `pickWalls`/`findFlip` in `gex.ts` | RULE-01's own guard: "recording vocabulary, not a DSL" — the picker phase already refused to build a rule DSL; the regime board shouldn't either |

**Key insight:** every admitted indicator's computation is a 2–4 line pure function over already-typed
numbers. There is no complexity here that justifies an abstraction beyond what `gex.ts`/`percentile-rank.ts`
already establish as the project's derived-analytics idiom.

## Common Pitfalls

### Pitfall 1: FRED-sourced series look backfillable but the existing adapter doesn't backfill

**What goes wrong:** `fredgraph.csv` genuinely returns years of history for any FRED series, which
suggests a brand-new FRED series (like `BAMLH0A0HYM2`) could have full 20-day history available on ship
day. It does not, in this codebase.
**Why it happens:** `makeFredSeriesAdapter`'s `fetchFredSeries` helper requests `limit=5` and persists
only the single most-recent valid observation per cron run (`fred.ts` lines 54–55, 76–87). This is the
same mechanism that ingested `VXVCLS` — and CONTEXT.md itself confirms VXVCLS has been "accreting since
2026-07-09" (i.e., started from zero history, not backfilled), even though FRED could have supplied
VXVCLS's full history too.
**How to avoid:** Ship HY OAS (and any future FRED-backed indicator) as an absolute-level threshold, not
a moving-average comparison, unless a plan explicitly adds a one-time backfill task (a bounded
`fredgraph.csv` fetch + bulk insert, not wired into any cron). This phase's admitted indicators all avoid
the problem this way — see each indicator's "Bands" above.
**Warning signs:** A plan or task that says "compute 20-day average of {new series}" without a backfill
step will silently degrade to a 1-point average (or a null/undefined band) for ~4 trading weeks after
ship — the same class of silent-gap bug the project's "Staleness Is First-Class" learning
(`tos-studies-learnings.md`) exists to prevent.

### Pitfall 2: Confusing the VVIX absolute-level scale with the VVIX/VIX ratio scale

**What goes wrong:** Both forms use the same two raw inputs (VVIX, VIX) but produce numbers on
completely different scales — absolute VVIX sits in the 60–150+ range, the ratio sits in the 3–8 range.
Applying the user's 100/115 thresholds to a computed ratio (or vice versa) produces a permanently-wrong
band (e.g., a ratio of ~5 would read as "calm" under the absolute scale's `<100` cut, which is
meaningless).
**Why it happens:** CONTEXT.md's own candidate list names "VVIX/VIX" while the cited calibration
(`tos-studies-learnings.md`) is for absolute VVIX — an easy copy-paste-the-wrong-field bug.
**How to avoid:** This research recommends shipping ONLY the absolute-VVIX form this phase (see
Indicator 2's adjudication). If the ratio form is ever added, give it a visibly distinct `id`
(`"vvix-vix-ratio"`, not `"vvix"`) and its own threshold constants, never reusing 100/115.
**Warning signs:** A single domain constant named just `VVIX_THRESHOLDS` used for two different `value`
computations.

## Code Examples

### FRED series id addition (HY OAS) — the entire adapter-side change

```typescript
// Source: packages/core/src/journal/application/fetchMacroSeries.ts (existing) — add one string.
export const DEFAULT_FRED_SERIES_IDS: ReadonlyArray<string> = [
  "DFF", "DGS1MO", "DGS3MO", "SOFR", "T10Y2Y", "T10Y3M", "VIXCLS", "VXVCLS",
  "BAMLH0A0HYM2", // NEW — ICE BofA US HY OAS (MACRO-02 credit leg, replaces unreachable HYG)
];
```

```typescript
// Source: packages/contracts/src/macro.ts (existing) — add one string to the enum + docstring count.
export const MACRO_SERIES_IDS = [
  "DFF", "DGS1MO", "DGS3MO", "SOFR", "T10Y2Y", "T10Y3M", "VIXCLS", "VVIX", "VXVCLS",
  "VIX9D", "BAMLH0A0HYM2", // NEW
] as const;
```

### VIX9D CBOE fetch task addition — the entire orchestration-side change

```typescript
// Source: packages/core/src/journal/application/fetchMacroSeries.ts — add one task alongside VVIX's,
// same shape (deps.fetchVix9dQuote mirrors deps.fetchVvixQuote exactly).
const tasks = [
  ...fredSeriesIds.map((id) => ({ id, fetch: () => deps.fetchFredSeries(id) })),
  { id: "VVIX", fetch: () => deps.fetchVvixQuote() },
  { id: "VIX9D", fetch: () => deps.fetchVix9dQuote() }, // NEW
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Manual TOS thinkScript studies for VIX/VIX3M, VVIX, RSP/SPY (retired, see `tos-studies-learnings.md`) | Automated daily board fed by existing FRED/CBOE crons | This phase | No more hand-typed levels; as-of dates are first-class, matching the project's staleness discipline |

**Deprecated/outdated:** none — this is a greenfield board, not a migration.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | VIX9D/VIX bands of calm `<1.0` / warning `1.0–1.1` / crisis `≥1.1` | Indicator 3 adjudication | No backtested numeric threshold exists online for this specific ratio; if wrong, the board shows a misleading band. Mitigated: display-only this phase (CONTEXT.md), no hard gate. Recommend a follow-up backtest before Phase 28 gate-wiring. |
| A2 | HY OAS bands of calm `<3.0` / warning `3.0–5.0` / crisis `≥5.0` (percent units) | Indicator 5 adjudication | This is a NEW calibration (not a refinement of an existing user prior) built from 3 practitioner sources, not the user's own TOS study. Reasonably conservative (calm cut matches cited "complacency <300bp"), but not user-verified. Flag for user confirmation before treating as authoritative. |
| A3 | VVIX 115 "stress" cut is the correct interpolation of the cited 110–120 transition zone | Indicator 2 adjudication | No source states "115" verbatim. Low risk — the user's own TOS study already validated this exact number; online evidence merely brackets it, doesn't contradict it. |

## Open Questions

1. **Should VIX9D/VIX get a real backtest before shipping even as a display-only band?**
   - What we know: the ratio concept is well-documented; the specific numeric cut is not.
   - What's unclear: whether 1.0/1.1 will feel "right" against the user's own market intuition once live.
   - Recommendation: ship as-is (display-only, no gate), but the planner should treat the exact threshold
     constants as easily tunable (named constants, not inlined magic numbers) so a post-launch adjustment
     is a one-line change, not a re-plan.

2. **Does the team want the Yahoo Finance chart API path pursued for RSP:SPY in a follow-up phase?**
   - What we know: it works today and returns real data.
   - What's unclear: its reliability under an unattended daily cron over months, and whether the
     project's root-cause discipline tolerates depending on an unofficial API.
   - Recommendation: leave as a documented revival path, not auto-pursued; needs an explicit user decision
     given the stability tradeoff.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| FRED public API (`api.stlouisfed.org`) | HY OAS ingestion | ✓ | n/a (public REST) | none needed — already load-bearing for 8 other series |
| CBOE delayed quotes (`cdn.cboe.com`) | VIX9D ingestion | ✓ | n/a (public REST) | none needed — already load-bearing for VVIX/VIX3M |
| Stooq CSV | RSP:SPY breadth | ✗ (bot-walled) | — | none viable this phase — DROP |
| Yahoo Finance chart API | RSP:SPY breadth (fallback candidate) | ✓ but unofficial/unstable | — | not admitted this phase |

**Missing dependencies with no fallback:** none block the 4 admitted indicators.
**Missing dependencies with fallback:** RSP:SPY breadth has no admitted fallback this phase (see Refuted/Dropped #1).

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (workspace-wide `vitest run`), fast-check for numerical/property tests, msw for HTTP adapter tests |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `vitest run packages/core/src/analytics packages/adapters/src/http/cboe-vix9d.test.ts` |
| Full suite command | `bun run test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| MACRO-02 | Each admitted indicator bands correctly at calm/warning/crisis boundaries | unit (example + fast-check boundary sweep) | `vitest run packages/core/src/analytics/domain/regime.test.ts` | ❌ Wave 0 |
| MACRO-03 | Board `asOf` is always the observation date, never "now" | unit | `vitest run packages/core/src/analytics/application/getRegimeBoard.test.ts` | ❌ Wave 0 |
| BOARD-01 | Route returns all 4 indicators with value/band/asOf | integration (route-level, mirrors `analytics.routes.test.ts` if present) | `vitest run apps/server/src/adapters/http/analytics.routes.test.ts` | check existing file — likely needs a new `describe` block, not a new file |
| BOARD-02 | Payload carries `source`/`rationale` — not hardcoded in the UI | unit (contract) | `vitest run packages/contracts/src/regime.test.ts` | ❌ Wave 0 |
| BOARD-03 | `get_regime` MCP tool returns the SAME schema as the HTTP route | contract test (mirrors `fred.contract.test.ts` pattern) | `vitest run packages/contracts/src/regime.contract.test.ts` | ❌ Wave 0 |
| New CBOE VIX9D adapter | Fetch success/failure paths (msw) | unit (HTTP adapter, msw at network layer per `.claude/rules/tdd.md`) | `vitest run packages/adapters/src/http/cboe-vix9d.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant quick-run file(s) above.
- **Per wave merge:** `bun run test` (full suite).
- **Phase gate:** full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `packages/core/src/analytics/domain/regime.test.ts` — boundary tests for all 4 banding functions
      (fast-check: band is monotonic in the input value, no gap/overlap at the calm/warning/crisis cuts)
- [ ] `packages/core/src/analytics/application/getRegimeBoard.test.ts` — asOf-is-observation-date,
      empty-store → empty array (not error), missing-series → indicator omitted (not a fabricated value)
- [ ] `packages/adapters/src/http/cboe-vix9d.test.ts` — msw-mocked 200/non-200/malformed-payload paths,
      cloned from `cboe-vvix.test.ts`'s existing coverage
- [ ] `packages/contracts/src/regime.contract.test.ts` — mirrors `fred.contract.test.ts`'s one-sided-
      field-change-fails-typecheck pattern (MCP-02 parity guard)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | No | No new auth surface — board is a read-only analytics endpoint, same trust boundary as existing `/analytics/macro` |
| V3 Session Management | No | No new session handling |
| V4 Access Control | No | No new access-control decision — same as existing analytics routes (no per-user data) |
| V5 Input Validation | Yes | `zod` — `regimeQuery` (if any query params are added) parsed at the route boundary before the use-case runs, mirroring `macroQuery`'s T-14-01 discipline |
| V6 Cryptography | No | No secrets/crypto in this phase (FRED/CBOE endpoints used here require no API key; if a future HY OAS backfill task is added, it reuses the FRED key already Zod-parsed once in the composition root — no new secret handling) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| DB/internal error message leaked in the regime route's error response | Information Disclosure | Flat `{error: "internal"}` mapping, mirroring existing `T-06-08`/`T-14-14` mitigations in `analytics.routes.ts` |
| Malformed/unexpected CBOE `_VIX9D` payload shape (vendor changes the JSON) | Tampering (external-data integrity) | Zod `safeParse` at the adapter edge, same as `cboe-vvix.ts` — malformed payload returns `err`, never a fabricated value; `[ASSUMED]`/computed bands must never silently substitute a stale or default number |
| FRED sentinel `.` (missing-value) row silently coerced to `0` | Tampering (data integrity) | Already handled by the existing `fetchFredSeries` filter (Pitfall 7 precedent) — the new `BAMLH0A0HYM2` series reuses this unchanged code path |

## Sources

### Primary (HIGH confidence)
- Live `curl` verification, 2026-07-09: `cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX9D.json` (200), `_VIX3M.json` (200), `fred.stlouisfed.org/graph/fredgraph.csv?id=VXVCLS` (200), `?id=BAMLH0A0HYM2` (200), `?id=VIX9DCLS` (404)
- In-repo source: `packages/adapters/src/http/{fred,cboe-vvix}.ts`, `packages/core/src/journal/application/fetchMacroSeries.ts`, `packages/contracts/src/macro.ts`, `packages/core/src/analytics/**`, `apps/sidecar/*.py`, `apps/server/src/adapters/{http/analytics.routes.ts,mcp/tools.ts}`, `apps/server/src/main.ts`
- `docs/tos-studies-learnings.md`, `docs/architecture/picker-rules.md` (canonical priors + evidence-format precedent)

### Secondary (MEDIUM confidence — WebSearch, cross-checked against multiple independent sources)
- [eco3min.fr — VIX backwardation/contango](https://eco3min.fr/en/vix-backwardation-contango-volatility-term-structure/)
- [systemtrader.co — VIX/VIX3M tracker](https://www.systemtrader.co/tools/vix)
- [SpotGamma — VVIX explained](https://spotgamma.com/vvix-explained-what-the-volatility-index-tells-traders/)
- [TOS Indicators — VVIX to trade SPY](https://tosindicators.com/research/using-the-vvix-to-trade-spy-volatility-signal)
- [Volatility Box — VVIX trading](https://volatilitybox.com/research/vvix-trading/)
- [CapTrader — interpreting VVIX](https://www.captrader.com/en/blog/vvix/)
- [TradingView — VVIX/VIX Ratio with Interpretation Levels](https://www.tradingview.com/script/FVF6lHU5/)
- [Topstep — understanding volatility term structure](https://www.topstep.com/blog/understanding-volatility-term-structure)
- [Macroption — VIX term structure](https://www.macroption.com/vix-term-structure/)
- [CBOE — VIX term structure](https://www.cboe.com/tradable-products/vix/term-structure/)
- [CXO Advisory — RSP/SPY as a breadth indicator](https://www.cxoadvisory.com/technical-trading/rspspy-as-a-stock-market-breadth-indicator/)
- [OptionsTradingIQ — RSP/SPY ratio breadth indicator](https://optionstradingiq.com/rsp-spy-ratio-breadth-indicator/)
- [eco3min.fr — HY OAS as a leading recession signal](https://eco3min.fr/en/hy-oas-credit-spread-recession-signal-equity-markets/)
- [MacroRadar — high yield spread](https://www.macroradar.io/high-yield-spread)
- [Convex — BAMLH0A0HYM2 metric](https://convextrade.com/metrics/bamlh0a0hym2)

### Tertiary (LOW confidence — flagged for validation)
- The specific numeric VIX9D/VIX bands (1.0/1.1) — no direct citation, structural analogy only (see A1).
- The specific numeric HY OAS bands (3.0/5.0) — synthesized from 3 practitioner sources, not user-verified (see A2).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, both new endpoints live-verified today
- Architecture: HIGH — every pattern mirrors an existing, shipped precedent in this exact codebase (getGex/getMacro/cboe-vvix/analytics.routes)
- Pitfalls: HIGH — Pitfall 1 (FRED non-backfill) is directly confirmed by reading `fred.ts`'s actual `limit=5` behavior, not inferred
- Threshold rationale: MEDIUM — VIX/VIX3M and VVIX absolute confirm the user's own battle-tested priors against independent sources (high confidence); VIX9D/VIX and HY OAS are new calibrations from practitioner (not academic) sources (medium confidence, flagged in Assumptions Log)

**Research date:** 2026-07-09
**Valid until:** 30 days (stable domain — FRED/CBOE endpoint shapes rarely change; re-verify the CBOE `_VIX9D` endpoint specifically if this research is reused after a long gap, since it is undocumented/unofficial like the already-shipped `_VVIX` endpoint)
