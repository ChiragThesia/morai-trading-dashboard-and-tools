# Feature Research

**Domain:** SPX options trading dashboard — real-time data layer + journal (v1.1 milestone)
**Researched:** 2026-06-25
**Confidence:** HIGH on Schwab historical verdict; MEDIUM on vendor pricing / COT / FRED; LOW on exact streaming cadence numbers

---

## Critical Pre-Research Finding: Historical Options Data Verdict

**This is the most important deliverable. Verdict first.**

### 2a. Does Schwab Provide Historical Option Chains? DEFINITIVE NO.

Confirmed via the official schwab-py documentation (the canonical Python wrapper that
mirrors the Schwab Trader API contract):

> "Schwab provides price history for equities and ETFs. It does not provide price
> history for options, futures, or any other instruments."

The `get_option_chain()` endpoint's `from_date` / `to_date` parameters filter by
**expiration date** — they narrow which future expirations the current snapshot returns.
They are not observation-date parameters. Calling `get_option_chain(fromDate="2026-05-01")`
returns today's chain filtered to contracts expiring after May 1 — not what the chain
looked like on May 1.

No workaround exists inside the Schwab API. There is no `/marketdata/v1/optionHistory`
endpoint, no `price-history` for options symbols, and no CBOE/OCC data pipe through the
broker API.

**Confidence: HIGH** (direct documentation; cross-confirmed by schwab-client-js
DeveloperReference and the schwab-py readthedocs narrative page).

### 2b. External Historical Options Data Vendors

| Vendor | What They Provide | Time Coverage | Cost | Separate Auth? | Greeks/IV? | Notes |
|--------|-------------------|---------------|------|----------------|------------|-------|
| **ORATS** | EOD option chains, 500+ proprietary indicators, backtestable daily data; intraday tier adds 1-min chains (Aug 2020+) | Back to 2007 (EOD); Aug 2020 (intraday) | $99/mo (EOD delayed), $199/mo (live EOD), $399/mo (intraday) | Yes — ORATS account + live data agreements required | Yes — IV + greeks included in all tiers | Most turnkey for a quant; SPX covered. Best fit if you want backtestable signal |
| **Polygon.io (Massive)** | Historical quotes (2022+), trades (2016+), tick-level with greeks and IV; full US options market | Quotes: 2022. Trades: 2016. Tick with greeks: 2014 | $29/mo Starter (2yr intraday data); Business tier requires contact | Yes — Polygon/Massive account + API key | Yes — delta/gamma/theta/vega/IV pre-calculated; SPX index options covered | Cheapest entry. 2-yr window on Starter may be sufficient for v1.1 backfill. |
| **CBOE DataShop / LiveVol** | EOD snapshots, 3:45PM ET snapshots, tick-level trade data; official source for CBOE products | 2011+ (tick), EOD varies | LiveVol Pro ~$380/mo; dataset downloads sold separately | Yes — CBOE DataShop account; **SPX requires separate Cboe Global Indices license** | EOD Calcs add-on includes IV + greeks | Most authoritative for SPX (CBOE is the exchange). Extra licensing friction for SPX specifically. Expensive for one trader. |
| **Databento (OPRA.PILLAR)** | Raw OPRA feed: trades, CBBO-1m, OHLCV, statistics, instrument definitions; 10+ years | 10+ years of OPRA data | Standard $199/mo; pay-as-you-go $/GB; $125 free credits on signup | Yes — Databento account + API key | **NO** — raw market data only, no pre-calculated IV or greeks; you must compute your own BSM | Good for raw tick-level reconstruction if you have a BSM engine (Morai does). But significant ETL work to reconstruct option chains. |
| **IVolatility** | EOD + intraday options with IV and greeks; RAW IV dataset; historical back to 2005 | 2005+ (EOD with greeks) | Pay-per-download (no mandatory monthly sub); retail pricing available; exact $/file not published | Yes — free IVolatility registration required | Yes — IV + greeks included | Pay-per-file is trader-friendly. No recurring cost if you only need a backfill batch. SPX covered. |
| **OptionMetrics IvyDB** | Academic gold standard: EOD prices, IV, greeks, dividends, correct zero-div adjustments | 1996+ | Contact sales; not retail-accessible; typically $thousands/yr institutional | Yes — institutional contract | Yes — industry-standard greeks | Not viable for a single trader. Institutional only. |
| **optionsDX** | Intraday SPX/VIX/SPY historical data with pre-calculated greeks + IV at up to minute intervals | Not clearly stated; marketed as "free" | Unclear — "store" links suggest some paid tiers; free sample data exists | Unclear; registration likely required | Yes | Best investigated for free sample data. Not production-reliable without clarity on licensing. |

**Is there a free, no-extra-auth source of historical SPX option chains/greeks?**

No. Every historical options data source that covers SPX with greeks requires either
a separate paid subscription or, at minimum, a free account registration creating a
new auth credential to manage. There is no source piggybacking on the existing Schwab
or CBOE no-auth access that provides past-date option chains.

The CBOE's free public data (`www.cboe.com/us/options/market_statistics/historical_data/`)
publishes settlement prices and delayed chain summaries, not per-strike greeks or
full chain snapshots at arbitrary past dates.

### 2c. Self-Collection vs Vendor Feed — Verdict for the Journal

**Self-collection is the correct fit for Morai's journal. Do not buy a vendor feed for v1.1.**

The reasoning:

1. **The journal is forward-only by design.** The core value statement is "how did
   price + greeks move over the life of THIS trade?" — meaning from entry to expiry.
   Morai has been collecting the full SPX chain via REST snapshots since Jun-12, 2026.
   For every calendar opened after that date, every relevant observation already exists
   in `leg_observations`. A vendor feed would only matter for trades opened *before*
   collection started.

2. **No past trades need to be back-filled with full chain data.** The existing
   `sync-fills` / rebuild path reconstructs trade history from Schwab fills. The journal
   needs per-leg greeks at each snapshot, which requires a chain pull at that time —
   not historical data for a date before collection began. If there are gaps (re-auth
   outage, CBOE fallback period), the gap-fill logic pulls from CBOE's delayed chain,
   which covers the preceding session.

3. **Vendor cost is unjustifiable for a single trader.** The cheapest credible option
   (Polygon Starter at $29/mo) introduces a second auth to manage, a monthly cost,
   and external data not consistent with Morai's own BSM engine calibration. ORATS at
   $99+/mo is real money for marginal benefit when self-collection already runs.

4. **The data you need doesn't exist pre-Jun-12 from any source cleanly.** Intraday
   chain snapshots with your own BSM's greeks are not purchasable. Vendors provide their
   own calculated greeks, which will not match Morai's BSM output (creating consistency
   problems in the journal). Buying historical data for pre-collection dates means
   you'd have two different greek calculation methodologies in the same journal.

**The tradeoff stated plainly:**

- Vendor feed: costs $29–$399/mo, adds a second auth burden, gives data back to
  2007–2022 depending on vendor, but those greeks won't match Morai's BSM and are
  irrelevant to current trades.
- Self-collection: zero incremental cost, single auth (sidecar), greeks consistent with
  BSM engine, already running since Jun-12. Only gap: trades opened before Jun-12
  have no chain snapshots. But those trades have already closed — the journal for
  them was never going to be complete anyway.

**Conclusion: self-collect forward on the sidecar. No vendor feed in v1.1.**

---

## Feature Landscape

### Table Stakes (The Sidecar Must Deliver These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **schwab-py sidecar — single auth boundary** | All existing Schwab REST calls need to route through one non-stale token; currently TS adapter holds its own token that hard-expires every 7 days creating a staleness race | MEDIUM | Replaces the TS Schwab adapter's direct token management; TS adapters swap `broker_tokens → sidecar` endpoint; hexagonal boundary stays clean via HTTP port |
| **Auto-refresh (kill 30-min staleness)** | schwab-py handles OAuth token refresh internally; current TS adapter lets access tokens expire mid-session | LOW | schwab-py built-in; the primary driver for the sidecar existing at all |
| **7-day re-auth alert + one-click flow** | Refresh tokens hard-expire at 7 days; silence = prod blackout; trader must know N days before expiry | MEDIUM | Alert threshold: warn at T-2 days; browser-launched re-auth URL via sidecar `/reauth` endpoint; CBOE fallback activated automatically on `AUTH_EXPIRED` |
| **Real-time marks + bid/ask via LEVELONE_OPTIONS** | Trader expects live option quotes once stream is live; stale quote is worse than no quote | LOW | Schwab streamer pushes on quote change (push-driven, not polled); DELTA(28), GAMMA(29), THETA(30), VEGA(31), RHO(32), VOLATILITY/IV(10) all available in stream |
| **Per-leg greeks live (delta/gamma/theta/vega)** | Calendar spread P&L management requires seeing net greeks tick in real time — especially theta decay and delta vs spot | LOW | Schwab streams these in LEVELONE_OPTIONS; sidecar subscribes per open leg's option symbol; fan-out to TS SSE |
| **Fills landing instantly via ACCT_ACTIVITY** | Fill latency matters: trader needs to see a new position the moment it's confirmed, not on the next snapshot | LOW | ACCT_ACTIVITY stream delivers MESSAGE_TYPE + JSON MESSAGE_DATA payload; field 2 = message type, field 3 = fill JSON; sidecar parses and emits to TS server |
| **TS server fan-out (SSE/WS to N browser tabs)** | Single Schwab streamer session → multiple UI consumers; sidecar can't directly serve browser auth | MEDIUM | One upstream Schwab WS per account; TS server re-broadcasts to browsers behind Supabase JWT; Schwab enforces 1 stream/account hard limit — sidecar must own it exclusively |
| **Journal re-sourced via sidecar** | Snapshot cadence relies on authenticated chain pulls; sidecar owns auth; TS server must delegate chain pulls to sidecar REST endpoint | LOW | Existing 30-min RTH schedule retained; pg-boss job calls sidecar `/chain` endpoint instead of direct Schwab adapter |
| **CBOE fallback retained for re-auth gap** | 7-day re-auth window creates predictable auth outages; journal must not stop during that period | LOW | Already built; just needs graceful routing: if sidecar returns `AUTH_EXPIRED`, snapshot job falls back to CBOE adapter. Gap ≤ 7 days — CBOE delayed chain is sufficient |
| **CFTC COT adapter (no auth)** | Adds futures positioning context to existing GEX + regime analytics; free, no new auth | LOW | CFTC publicreporting.cftc.gov API requires no token; Python `cot_reports` library or direct HTTP; TFF Futures-Only report for E-mini S&P 500 |
| **FRED expanded macro series** | Existing FRED adapter has unset prod key; rate-free rate is needed for BSM; expansion to curve + VIX indices closes the fragility composite spec | LOW | Free API, one-time key setup; series needed: VIXCLS (VIX), VXVCLS (VIX3M), DFF (fed funds), T10Y2Y (2/10 spread), T10YIE (10yr breakeven inflation); VVIX not on FRED — source from CBOE directly or compute from chain |

### Differentiators (Worth Building in v1.1)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Snapshot cadence optimization: event-driven coarse hybrid** | 30-min is right for baseline journal; streaming gives free intra-window ticks that can trigger an on-demand REST chain pull when underlying moves >N points | MEDIUM | SPX calendar trader needs: (a) guaranteed 30-min snapshot for the journal, (b) event snapshot on large underlying moves (>0.5% in 15 min) because calendar delta + vega change materially. Implement as: background 30-min scheduler + stream-event trigger with debounce. Do not go finer than 5-min on triggered snaps — full SPX chain REST pull is expensive. |
| **Re-auth smoothing: proactive alert + CBOE bridge** | Most traders would not notice a 7-day counter until prod goes dark; surfacing this 48h ahead + bridging with CBOE prevents data gaps | LOW | Differentiates this from naive broker adapters; already partially planned; CBOE bridge already built |
| **Sidecar health endpoint + stream-reconnect with exponential backoff** | WebSocket disconnects happen (Schwab disconnects after market close per reports); silent reconnect with no gap is required for production use | MEDIUM | Schwab streamer disconnects at market close / nightly; sidecar must detect, back off, reconnect, and replay missed ACCT_ACTIVITY events by gap-filling from Schwab's REST transactions endpoint |
| **COT net positioning + change indicator** | Asset Managers net long/short + weekly delta shows whether institutional money is accumulating or distributing; leading indicator for regime shifts | LOW | Data arrives weekly; compute: net position (long - short) per category + week-over-week delta; expose via API as `cot_observations`; low complexity once adapter built |

### Anti-Features (Explicitly Cut from v1.1)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Buying a historical options data vendor feed** | Backfilling greeks for trades before Jun-12 seems appealing | (1) Vendor greeks won't match Morai's BSM engine — inconsistent journal. (2) Adds a second auth credential to manage weekly. (3) $29–$399/mo for data Morai won't use going forward. (4) Pre-collection trades have already closed — backfill would be display-only, not actionable. | Self-collect forward. Accept that trades before Jun-12 have no full chain history. Document the collection start date in the journal schema. |
| **Finer than 30-min baseline snapshot** | Real-time stream makes "more snapshots" feel free | Full SPX chain REST pull is not free — it's a large payload (hundreds of strikes × 2 sides). Running it every 5 min baseline would 6× the Schwab API request volume and create rate-limit risk. | Use streaming quotes for intraday marks; reserve REST chain pulls for: (a) baseline 30-min snapshots, (b) event-triggered on large moves (debounced, max 1/5 min). |
| **Streaming the full option chain** | LEVELONE_OPTIONS can subscribe to many symbols; why not stream the entire SPX chain? | SPX full chain = ~1000+ active contracts. Subscribing all creates massive event volume, connection instability, and Schwab rate throttle risk. schwab-py has no documented hard limit but community reports suggest hundreds of symbols is the practical ceiling. | Stream only open position legs. Use REST for full chain snapshots on schedule. |
| **COT as an entry signal** | COT positions look like a positioning edge | COT data is 3 days stale at publication (Tuesday data, Friday release). It covers E-mini S&P 500 futures, not SPX option dealer positioning. By the time you see the data, the market has moved. Cannot be used for short-term calendar entry decisions. | Use COT as a weekly regime context indicator (are institutions net-long or net-short?), not a timing signal. Store and display; do not wire to any trade-entry logic. |
| **VVIX from FRED** | VVIX is part of the calibrated Fragility Composite spec and is a key signal | VVIX is NOT available as a FRED series. CBOE publishes VVIX but FRED does not carry it. Pulling VVIX via FRED will silently fail or return empty. | Source VVIX directly from CBOE (no auth, same endpoint family as the existing CBOE adapter) or compute implied vol-of-vol from the VIX option chain Morai already pulls. |
| **OptionMetrics / IVyDB integration** | Gold standard historical greeks | Institutional-only pricing (thousands/yr); not accessible for a single trader | Not applicable. Self-collect. |
| **UI panels for macro/COT/live stream** | Visible data feels more finished | UI is explicitly a separate future milestone. Backend must ship APIs + contracts; UI consumes them later. Building UI in v1.1 violates the documented D19 decision and will delay the backend. | Define typed Hono RPC endpoints + Zod contracts. Freeze the API shape. UI milestone consumes them. |
| **Real-time IV calculation in the stream path** | Streaming options quotes arrive; computing IV from each tick seems natural | IV inversion via BSM is CPU-intensive; doing it per-tick for all subscribed legs creates a compute bottleneck in the hot path. Current approach: stream delivers Schwab's own VOLATILITY(10) field for display; Morai's BSM IV runs on REST chain snapshots, not stream ticks. | Use Schwab's streamed VOLATILITY(10) for live display. Run BSM IV on REST snapshots at snapshot time (already the current design). |

---

## Feature Dependencies

```
schwab-py sidecar (auth + REST + stream)
    └──required-by──> Auto-refresh (token never stale)
    └──required-by──> Real-time marks via LEVELONE_OPTIONS
    └──required-by──> Fills via ACCT_ACTIVITY
    └──required-by──> Journal re-sourced (REST chain pulls delegated to sidecar)
    └──required-by──> 7-day re-auth alert (sidecar knows token expiry)

LEVELONE_OPTIONS stream subscription
    └──required-by──> Per-leg greeks live
    └──required-by──> TS server fan-out (needs upstream event source)

TS server fan-out
    └──required-by──> Browser SSE/WS (future UI milestone)

Sidecar health + reconnect
    └──enhances──> All stream features (stream is useless without reconnect)

CFTC COT adapter
    └──standalone (no auth, no Schwab dependency)
    └──feeds──> COT net positioning analytic

FRED expanded series (key already set)
    └──standalone
    └──feeds──> Fragility Composite (VIX, VIX3M, DFF, T10Y2Y)

CBOE fallback
    └──required-by──> Journal continuity during 7-day re-auth gap
    └──already-built (CBOE adapter exists; just needs routing logic)

Event-triggered snapshot
    └──requires──> LEVELONE_OPTIONS stream (to detect underlying move events)
    └──requires──> sidecar REST chain endpoint (to execute on-demand snapshot)
```

**Dependency notes:**

- All stream features share one Schwab WebSocket session — the sidecar must own it. If
  the sidecar is down, all stream features go dark simultaneously. This is why the
  sidecar health endpoint + reconnect logic is a differentiator, not an afterthought.
- The TS server fan-out layer is a v1.1 deliverable (backend-only). Browsers will not
  connect to it in v1.1 because UI is deferred. But the SSE/WS contract must be typed
  (Zod) so the future UI milestone can consume it without server changes.
- COT and FRED are fully independent of Schwab and can be built in parallel with the
  sidecar work.

---

## Snapshot Cadence Recommendation (Question 3)

**Keep 30-min baseline. Add event-triggered supplemental pulls. Do not go finer as baseline.**

Rationale for an SPX calendar spread trader:

- **What moves the calendar P&L materially:** (a) underlying price level vs strike —
  determines gamma exposure and pin risk; (b) term-structure shift (front-vs-back IV
  ratio) — determines whether the spread has expanded or contracted. These shift on the
  order of hours, not minutes, under normal conditions.
- **When 30-min is too coarse:** On days with Fed announcements, CPI prints, or sharp
  intraday moves (>0.5% in 15 min), a 30-min snapshot may miss the peak gamma exposure
  window entirely. An event-triggered pull (debounced to max once per 5 min) covers this.
- **Why not finer than 5-min on triggered pulls:** SPX full chain REST pull is a large
  response. Running it more often than once per 5 min risks hitting Schwab's undocumented
  rate limits and creates noise in the journal (hundreds of near-identical snapshots when
  market is quiet).
- **Stream is NOT a substitute for REST chain snapshots:** Schwab's LEVELONE_OPTIONS
  only covers subscribed symbols (open position legs). It does not deliver the full chain
  needed to compute GEX, skew, or term structure. Those analytics require a REST pull.

**Recommended cadence:**
1. 30-min RTH baseline (existing, keep as-is)
2. Event-triggered: if SPX moves >0.5% in any 15-min window (detectable from streamed
   underlying price), fire one supplemental chain pull, debounced to at most once per 5
   min per trigger event
3. On open/close of a position (ACCT_ACTIVITY fill event): fire an immediate chain
   snapshot to capture greeks at trade entry/exit — this is the highest-value snapshot

---

## COT Honest Assessment (Question 4)

### What COT Actually Delivers

The CFTC Traders in Financial Futures (TFF) report for E-mini S&P 500 breaks open
interest into four trader categories: Dealers/Intermediaries, Asset Managers/Institutional,
Leveraged Funds (hedge funds, CTAs), and Other Reportables. Each category's long, short,
and spreading positions are reported as of the prior Tuesday.

**Publication lag:** Data is collected Tuesday close; verified and released Friday 3:30pm
ET. Minimum stale by 3 days at publication; effectively 1 week old by the following Friday.

**What it genuinely tells you:**
- Whether large institutional money (Asset Managers) is net long or short vs history —
  a medium-term sentiment gauge
- Whether leveraged funds (hedge funds, CTAs) are crowded long or short — a contrarian
  indicator at extremes
- Week-over-week changes in institutional positioning — detects regime shifts building
  over weeks, not days

**What it cannot tell an SPX options trader:**
- Nothing about SPX *option* dealer positioning, GEX, or put/call skew
- Nothing about options flow (not OPRA data)
- Nothing about what happened Wednesday–Friday (positions moved but won't appear until
  next report)
- Not usable for calendar spread entry/exit timing — the lag makes it irrelevant for
  sub-weekly decisions

**Honest utility for Morai:**

COT is a weekly macro-sentiment layer, appropriate as context alongside GEX regime
(which is current) and VIX term structure. It tells you "is the institutional crowd
positioned for a rally or a decline this week?" — which influences how aggressively to
manage delta on a calendar spread heading into an event. It is a **soft regime input**,
not a precision signal.

**Classification:**
- **Table stakes for the v1.1 data layer?** No — it's a free enhancement with zero auth
  complexity. Worth building as a low-cost differentiator.
- **Differentiator?** Mildly — most retail dashboards don't surface COT alongside
  options analytics. For SPX calendar spreads specifically, the E-mini positioning is the
  most relevant COT series.
- **Anti-feature if over-weighted:** Treating COT as a timing signal or wiring it to
  entry recommendations is wrong. It is context, not a trigger.

---

## FRED Macro Layer — What's Worth Building (Question 5)

### Series That Materially Help an SPX Options Trader

| FRED Series ID | What It Is | Why It Matters | Table Stakes? |
|----------------|-----------|----------------|---------------|
| **VIXCLS** | CBOE VIX (30-day implied vol) | The primary vol regime signal; already used in Fragility Composite (check 3: VIX/VIX3M > 0.90) | YES — already spec'd |
| **VXVCLS** | CBOE VIX3M (93-day implied vol) | VIX/VIX3M ratio = term-structure signal; > 0.90 = caution, > 0.95 = hard gate for calendar entry | YES — already spec'd |
| **DFF** | Fed Funds Effective Rate | Risk-free rate input to BSM; used for rho; also regime context (rising rates = different carry) | YES — existing FRED adapter uses this; just needs prod key |
| **T10Y2Y** | 10yr minus 2yr Treasury spread | Yield curve shape: inversion = macro stress signal; part of broader regime read | MEDIUM — useful for Fragility Composite expansion |
| **T10YIE** | 10yr Breakeven Inflation Rate | Real rate context; fed policy reaction function; calendar spreads have term exposure | LOW — informational only; not decision-relevant for a spread trader |

### VVIX — Not on FRED

VVIX (vol-of-vol) is part of the calibrated Fragility Composite spec (check 3: VVIX > 100)
but is **not available as a FRED series**. Source it directly from CBOE:
`www.cboe.com/indices/dashboard/?symbol=vvix` or the CBOE market statistics endpoint
(no auth, same family as the existing CBOE adapter). This is low complexity — one
additional CBOE fetch alongside the existing chain pull.

### Anti-Features in the FRED Expansion

| Series | Why It Seems Useful | Why It's an Anti-Feature |
|--------|---------------------|--------------------------|
| **UNRATE (unemployment)** | Macro completeness | Monthly lag; no bearing on SPX options term structure or calendar spread management. Noise. |
| **CPIAUCSL (CPI)** | Inflation narrative | Monthly lag; for a calendar spread trader managing 14–30 day positions, CPI is context only. Already proxied by T10YIE. |
| **MORTGAGE30US** | Macro health indicator | Irrelevant to SPX options. Vanity metric — adds complexity with no signal for the strategy. |
| **GDP / INDPRO** | Economic activity | Quarterly/monthly data; too slow for any decision a short-term options trader makes. |

**Recommended FRED expansion for v1.1:** VIXCLS + VXVCLS + DFF (already in adapter) +
T10Y2Y. Total: 4 series. Add VVIX from CBOE directly. Everything else is vanity for
this use case.

---

## MVP Definition for v1.1

### Ship With (v1.1 Backend)

- [ ] schwab-py sidecar scaffold: Python service, Railway deployment, HTTP port for TS server
- [ ] sidecar: OAuth + token store + auto-refresh (kills 30-min staleness)
- [ ] sidecar: REST endpoint `/chain` (delegates to Schwab get_option_chain)
- [ ] sidecar: WebSocket to Schwab (LEVELONE_OPTIONS for open legs + ACCT_ACTIVITY)
- [ ] sidecar: fan-out events to TS server via internal HTTP/SSE
- [ ] sidecar: `/reauth` endpoint + 7-day expiry alert
- [ ] TS server: SSE/WS endpoint for browsers (Supabase JWT auth); typed Zod contracts
- [ ] TS server: ACCT_ACTIVITY handler → fill recorded in Supabase + journal snapshot triggered
- [ ] Journal: snapshot job calls sidecar `/chain` instead of direct Schwab adapter
- [ ] Journal: CBOE fallback routing on `AUTH_EXPIRED` (already built; needs routing wiring)
- [ ] Journal: event-triggered snapshot on fill (ACCT_ACTIVITY) + supplemental on large underlying move
- [ ] CFTC COT adapter: TFF Futures-Only report, E-mini S&P 500 contract; weekly poll; `cot_observations` table + API endpoint
- [ ] FRED expanded: set prod key; add VIXCLS + VXVCLS + T10Y2Y; VVIX from CBOE
- [ ] Architecture doc update: `stack-decisions.md` updated for Python sidecar + 3rd Railway service before any code

### Defer to v1.2+ (UI Milestone)

- [ ] Live position display panel (consumes SSE from v1.1 TS server)
- [ ] COT positioning panel UI
- [ ] Macro composite panel (Fragility score visualization)
- [ ] Historical journal chart view
- [ ] Event-triggered snapshot tuning (threshold calibration needs real usage data)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| schwab-py sidecar + auto-refresh | HIGH | MEDIUM | P1 |
| LEVELONE_OPTIONS stream (marks + greeks) | HIGH | LOW | P1 |
| ACCT_ACTIVITY fills | HIGH | LOW | P1 |
| TS server SSE/WS fan-out + Zod contracts | HIGH | MEDIUM | P1 |
| Journal re-sourced via sidecar | HIGH | LOW | P1 |
| CBOE fallback routing on AUTH_EXPIRED | HIGH | LOW | P1 |
| 7-day re-auth alert + one-click flow | HIGH | MEDIUM | P1 |
| Fill-triggered journal snapshot | HIGH | LOW | P1 |
| Sidecar health + stream reconnect | HIGH | MEDIUM | P1 |
| FRED expanded (VIX, VIX3M, T10Y2Y, VVIX) | MEDIUM | LOW | P2 |
| CFTC COT adapter + positioning analytic | MEDIUM | LOW | P2 |
| Event-triggered supplemental snapshot | MEDIUM | MEDIUM | P2 |
| Historical vendor data feed | LOW | HIGH | Cut (anti-feature) |
| UI panels (macro/COT/live) | HIGH | HIGH | Deferred (v1.2 milestone) |

---

## Sources

- [schwab-py streaming documentation](https://schwab-py.readthedocs.io/en/latest/streaming.html) — LEVELONE_OPTIONS field list, ACCT_ACTIVITY fields, 1-session/account limit. Confidence: HIGH (official library docs).
- [schwab-py client documentation](https://schwab-py.readthedocs.io/en/latest/client.html) — get_option_chain fromDate/toDate = expiration filter, not observation date. No options price history. Confidence: HIGH.
- [ORATS data-api pricing page](https://orats.com/data-api) — $99/$199/$399 tier structure. Confidence: MEDIUM.
- [Polygon.io options (Massive)](https://polygon.io/options) — $29/mo Starter, 2yr intraday data, greeks included, SPX covered. Confidence: MEDIUM.
- [CBOE DataShop LiveVol](https://datashop.cboe.com/) — ~$380/mo LiveVol Pro; SPX requires Cboe Global Indices license. Confidence: MEDIUM.
- [Databento OPRA pricing](https://databento.com/pricing) — Standard $199/mo; pay-as-you-go $/GB; NO pre-calculated IV/greeks. Confidence: MEDIUM.
- [IVolatility historical options](https://www.ivolatility.com/historical-options-data/) — Pay-per-download; no mandatory monthly; historical back to 2005 with greeks. Confidence: MEDIUM.
- [optionsDX](https://www.optionsdx.com/) — Free sample data for SPX; SPX + greeks + IV at minute intervals; free tier limits unclear. Confidence: LOW.
- [CFTC COT public reporting](https://publicreporting.cftc.gov/) — TFF Futures-Only report; E-mini S&P 500 data; no token required for API. Confidence: HIGH (official government source).
- [FRED API documentation](https://fred.stlouisfed.org/docs/api/fred/) — Free API, 120 req/min; VIXCLS, VXVCLS, DFF, T10Y2Y confirmed. VVIX NOT on FRED. Confidence: HIGH.
- schwab-client-js DeveloperReference cross-confirmed Schwab historical options absence.

---

*Feature research for: Morai v1.1 — Real-Time Schwab Streaming, sidecar architecture, COT + FRED expansion*
*Researched: 2026-06-25*
