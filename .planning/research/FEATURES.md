# Feature Research — v1.2 Trade Picker & Dashboard Redesign

**Domain:** Single-user, self-hosted options-trading dashboard — candidate scanner/screener,
economic-event calendar, trade-rules engine, stream-health watchdog, event-triggered capture
**Researched:** 2026-07-03
**Confidence:** MEDIUM-HIGH (comparable-tool behavior well documented; single-user scope is a
judgment call, not sourced)

This file covers ONLY the five NEW v1.2 feature areas. Existing shipped features (journal,
live greeks, GEX/skew analytics, COT/FRED cards, MCP surface) are out of scope — see
`.planning/PROJECT.md` for what's already built. Scoring criteria themselves are NOT
re-researched here — see `.planning/research/calendar-selection-criteria.md` (already
adversarially verified; do not re-derive). This file supersedes the prior (v1.1) FEATURES.md,
archived alongside other v1.1 milestone research.

## Comparable Tools Surveyed

| Tool | What it is | Relevant to |
|------|-----------|-------------|
| thinkorswim Analyze tab + Spread Hacker/Option Hacker | Retail standard for options analysis; on-demand scan over a symbol universe against user filters, then Analyze-tab payoff/greeks drill-down | Candidate scanner UX |
| OptionNet Explorer (ONE) | Desktop backtester + live paper/real trade log; custom filters (`Underlying = SPX and PnL > 0`), grouping by DTE, trade log with tags | Rules/checklist tagging pattern (not live scanning — batch/backtest tool) |
| OptionStrat | Web-based strategy builder/scanner; payoff-first UI, one-click strategy comparison | Payoff-first candidate card layout (mockup precedent already chosen: playground-v4 variant B) |
| SpotGamma | GEX/dealer-positioning dashboard; already Morai's primary GEX source | GEX regime display conventions (already adopted); forward-IV framing (criterion 1) |
| ForexFactory economic calendar | The de facto standard economic-event calendar UI | Event-impact color coding, proximity-to-event display |
| Edgewonk / Tradervue | Retail trade journals; checklist-per-setup, rule-adherence-over-time reporting (Edgewonk "Tiltmeter") | Rule-fired logging + post-trade review pattern |
| TradingView / general trading dashboards | Stale-data visual conventions (yellow "delayed" badge), heartbeat-based feed-health detection | Stream watchdog UX + stall-detection thresholds |

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ranked candidate list, sorted by composite score | Every screener tool (TOS Spread Hacker, OptionStrat) leads with a sortable ranked list — a scanner that just dumps a filtered table with no rank feels unfinished | LOW | Sort by `scoreCalendarCandidates` composite; ties broken by criterion #1 (FwdIV edge) |
| Per-candidate score breakdown ("why-panel") | TOS shows the filter criteria that matched; Edgewonk shows checklist-item-by-item pass/fail. Users distrust a single opaque number | MEDIUM | Already the mockup decision (playground-v4 variant B, why-panel). Map 1:1 to the 8 criteria rows in calendar-selection-criteria.md |
| Visible "as of" timestamp on chain data | TradingView's delayed-data badge is the industry pattern; SpotGamma timestamps every GEX snapshot | LOW | Picker reads the 30-min REST chain snapshot (full-chain streaming is explicitly out of scope per PROJECT.md) — timestamp = chain snapshot time, not "now" |
| Staleness indicator distinct from "no data" | Feed-health literature treats stale ≠ absent — a frozen-but-present value is more dangerous than a visible gap | LOW-MEDIUM | Applies to picker (chain snapshot age) AND stream watchdog (tick heartbeat age) — same visual language, two data sources |
| Payoff diagram per candidate, one click away | Universal across OptionStrat, TOS Analyze tab, ONE — payoff curve is the trust-building artifact before sizing a trade | MEDIUM | Already shipped BSM engine; UI work is "payoff compare" per milestone scope, not new math |
| Filter by DTE range and strike/delta target | TOS Spread Hacker's core UX is filter-first; CML TradeMachine's (delta, front DTE, back DTE) tuple matches Morai's user constraint shape exactly | LOW | Matches open discuss-phase decision noted in PROJECT.md (DTE as user filter, strike by delta target) |
| Economic event flag per candidate leg | Criterion 3/4 in calendar-selection-criteria.md requires this; every options-analysis tool that discusses calendars (SpotGamma, tastytrade content) calls out earnings/FOMC proximity as baseline due diligence | MEDIUM | New adapter — no existing feed. FOMC is static/yearly; CPI/NFP are monthly BLS releases |
| Event proximity shown as a simple day-count or icon, not raw JSON | ForexFactory's color-badge-plus-date convention is the readable baseline | LOW | Red/flagged if a leg's expiry window spans the event window; otherwise clean |
| Stream connection state visible as a UI badge (LIVE / STALE / DISCONNECTED) | TradingView-style feed-health badges are standard; Morai's own phase-12 audit flagged "badge lies LIVE" as an open gap — this is closing known debt, not speculative scope | LOW-MEDIUM | Backend: heartbeat/last-tick timestamp already exists in SSE payload; badge is mostly a UI-state-machine problem |
| Rule tag recorded at entry (which rule fired) | Edgewonk's checklist-per-setup and OptionNet Explorer's trade-log tags are the baseline pattern in every serious trade journal | LOW | Attach point already decided: `entry_thesis` field (D-07). Structured enum/tag, not free text |

### Differentiators (Competitive Advantage)

None of these tools are built for one trader running SPX calendars specifically — Morai's edge
is depth on a narrow, well-understood structure rather than breadth across strategy types.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Forward-IV (not raw IV diff) as the primary edge metric | No mainstream retail tool (TOS, OptionStrat, ONE) computes true forward vol between two expiries by default — most compare raw IV%, which criterion 1 shows is only valid same-date. This is a real analytical edge over off-the-shelf screeners | MEDIUM | Formula and guard already verified (calendar-selection-criteria.md #1) |
| GEX-fit as a scoring input, not a separate dashboard tab | SpotGamma treats GEX as its own product surface; nobody folds "strike near Absolute Gamma strike" directly into a calendar-candidate score. Morai already computes GEX (shipped) — wiring it into the picker is cheap and differentiated | LOW (data exists) / MEDIUM (scoring integration) | Criterion 7 — bonus term, not a hard gate (sign alone is insufficient per research) |
| Event-premium-aware baseline (strip event-spanning expiries before computing "clean" forward vol) | This is a genuinely non-obvious refinement (arXiv 2606.12872 / NBER w28306-backed) that generic screeners don't do — they don't distinguish structural edge from discrete event premium | MEDIUM-HIGH | Criteria 3+4 combined; requires the event adapter to exist first (dependency) |
| Rule-fired → outcome correlation report (post-trade review) | Edgewonk's Tiltmeter concept (rule adherence vs. equity curve) applied narrowly to Morai's own enter/exit/roll rule set — "did trades where Rule X fired outperform?" | MEDIUM | Needs a population of tagged trades to be meaningful; defer reporting UI until rule-tagging has run for a few cycles (L4 is "record + which rule fired," not the analytics layer yet) |
| Event-triggered supplemental snapshot (off-cadence capture on large SPX moves) | No comparable tool does this because most retail tools poll on a fixed timer or are always-live; Morai's 30-min cadence is a deliberate cost/scope tradeoff (full-chain streaming ruled out), so a move-triggered exception snapshot captures the "something happened" moments the cadence would otherwise miss | MEDIUM | Trigger source = existing live SSE price tick, not a new feed; must debounce (see anti-features) |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Multi-underlying / full-market screener (scan hundreds of symbols like TOS Stock Hacker) | "Real" screeners scan a universe | Morai is SPX-only by design (PROJECT.md constraint); building universe-scan infra for one symbol is pure waste and reopens the full-chain-streaming question that was explicitly closed (D17) | Picker scans the SPX chain snapshot only; DTE/strike/delta are the "universe" being filtered, not tickers |
| Continuous/real-time picker refresh (sub-second re-scoring as the chain ticks) | Feels more "live," matches the SSE greeks stream users already see elsewhere in the app | Candidate data source is the 30-min REST chain snapshot, not the live stream (full-chain streaming is out of scope); faking sub-second refresh over 30-min-stale data is worse than an honest timestamp — same trap as "badge lies LIVE" that phase 12 already hit | Re-score on each chain snapshot arrival (30 min) + manual "as of" display; let the user request a refresh, which just re-reads the latest snapshot rather than polling Schwab live |
| Backtesting engine (OptionNet-Explorer-style historical strategy replay) | ONE is the category-standard tool and backtesting feels like the obvious next step after a scoring engine | PROJECT.md explicitly scopes Trade Picker as "scores structures, not advice/timing"; a backtester is a different product surface, needs a fill-simulation model, and the open question in calendar-selection-criteria.md (Vasquez slope signal transfer to SPX) says this needs a proper backtest later, not bolted onto v1.2 | Leave it as a documented backlog item; `leg_observations` already has the data since 2026-06-12 if it's ever built |
| Auto-execution / one-click order placement from a candidate card | Natural next step once a candidate looks good | Explicitly out of scope — "Live trade advice" boundary belongs to the separate `trade-advisor` plugin; Morai owns collected/historical data, not trade execution | Candidate card shows the structure; the trader places the order manually in their broker platform, same as today |
| Full multi-country economic calendar (ForexFactory-style, all currencies/central banks) | ForexFactory is the "obvious" reference implementation | Only FOMC/CPI/NFP matter for SPX; the rest is noise for a single-symbol single-user tool and multiplies data-source surface for no benefit | Three event types only, sourced from Fed schedule (static/yearly) + BLS (monthly); extend later only if a real gap surfaces |
| Live economic-surprise data (actual vs. consensus, market reaction magnitude) | Would make event flags "smarter" | Requires a second paid data feed just to color an already-binary flag; the verified criteria (3/4) only need "does this leg span the event window," not surprise magnitude | Flag = date/window membership only; magnitude-aware weighting is a documented open question (calendar-selection-criteria.md open questions #1/#3), not v1.2 scope |
| Free-text rule/thesis notes as the only record of "which rule fired" | Feels flexible, fastest to type | Unqueryable — can't ever answer "did Rule X trades outperform?" without re-reading prose; defeats the whole point of L4 (structured rule tracking) | Structured enum/tag on `entry_thesis` (already the attach point decision) with optional free-text supplement, not instead of it |
| Aggressive auto-reconnect / retry storms on stream stall | Feels more resilient | Reconnect storms can worsen an already-degraded sidecar/Schwab connection and mask the real signal (is Schwab down, or is our process wedged?) — this exact class of problem is why Phase 11 needed a zombie-lock self-heal | Bounded backoff (few attempts, capped interval), visible attempt count in the badge state, and fail loud to STALE/DISCONNECTED rather than silently retrying forever |
| Snapshotting on every tick during a fast move | "More data is safer" | 30-min cadence is a deliberate storage/cost boundary; unthrottled event-triggered snapshots on a volatile day could produce hundreds of extra rows and re-litigate the chunked-insert-limit lesson from Phase 2 | Debounce/cooldown window (e.g., one supplemental snapshot per N minutes regardless of how many times the threshold re-fires) |

## Feature Dependencies

```
Economic-events adapter (FOMC/CPI/NFP)
    └──requires──> [nothing new — static Fed schedule + BLS monthly schedule]
    └──feeds──> Picker criterion 3/4 (event flags, event-premium penalty)
                    └──feeds──> Picker scoring engine (scoreCalendarCandidates)
                                    └──requires──> 30-min chain snapshot (existing, shipped)
                                    └──requires──> BSM engine (existing, shipped)
                                    └──requires──> GEX computation (existing, shipped, criterion 7)
                                    └──feeds──> Analyzer picker UI (ranked cards + why-panel)
                                                    └──requires──> Overview v2 / payoff UI patterns
                                                                     (ships first per milestone build order)

Strategy-rules engine (L4)
    └──requires──> entry_thesis field (existing schema attach point)
    └──enables (later, not v1.2)──> rule-fired → outcome correlation report

Stream stall watchdog
    └──requires──> existing SSE heartbeat/last-tick data (shipped, Phase 11-12)
    └──independent of──> picker and events work (can ship in parallel/any order)

Event-triggered supplemental snapshot
    └──requires──> existing live SSE price tick (shipped) as trigger source
    └──requires──> existing 30-min snapshot job (shipped, reused/re-triggered off-cadence)
    └──enhances──> journal (existing core value), not the picker
```

### Dependency Notes

- **Picker scoring requires the events adapter first:** criteria 3 and 4 (event flags, event
  penalty) are two of the eight scoring rows — the picker engine phase cannot be feature-complete
  without the adapter landing first or alongside it. Per milestone build order, events adapter is
  bundled into the same phase as the engine (step 4), which is correct sequencing.
- **Picker UI can ship ahead of the real engine:** the milestone plan already sequences the
  Analyzer→picker redesign against candidate-contract fixtures/stubs before the engine exists
  (contract-first). This is the right call — it decouples UI/UX risk from scoring-correctness risk.
- **Stall watchdog and event-triggered snapshot are independent of the picker track** — both only
  touch the existing live-stream/journal pipeline, not the new scoring engine. They can be
  sequenced as tail work without blocking or being blocked by picker delivery, as the milestone
  plan already does.
- **Rule-fired → outcome correlation report enhances the rules engine but is not required for
  L4** — L4 scope is record + attribute the fired rule; the analytics/report layer needs a
  population of tagged trades to be meaningful and should be a later addition, not bundled in.

## MVP Definition

### Launch With (v1.2)

Matches the milestone's stated build order — nothing added here beyond what PROJECT.md already
scopes.

- [ ] Ranked candidate list with composite score + why-panel (per-criterion breakdown) —
      the core trust-building UX every comparable screener has
- [ ] "As of" chain-snapshot timestamp + staleness indicator on the picker — prevents the
      exact "badge lies" failure mode already seen once in this project
- [ ] DTE range / delta-target filters on the picker — matches user's stated trading constraints
- [ ] Economic-events adapter (FOMC/CPI/NFP) feeding criteria 3/4 — scoring is incomplete without it
- [ ] Payoff diagram + compare view per candidate — table stakes, and the BSM engine already exists
- [ ] Stream stall watchdog (LIVE/STALE/DISCONNECTED badge) — closes a known, already-flagged gap
- [ ] Event-triggered supplemental snapshot with debounce — narrow, well-scoped addition to the
      existing journal job
- [ ] Rule-fired tag on `entry_thesis` (structured, not free text) — L4 record-only scope

### Add After Validation (v1.2.x or v1.3)

- [ ] Rule-fired → outcome correlation report — once enough tagged trades exist to be meaningful
- [ ] Event-premium magnitude weighting (vs. binary flag) — if binary flagging proves too coarse
      in practice
- [ ] Vasquez slope in-house backtest over `leg_observations` — explicitly flagged as needing
      separate validation work in calendar-selection-criteria.md, not a v1.2 UI/engine concern

### Future Consideration (v2+ / explicitly out of scope)

- [ ] Full backtesting engine (OptionNet-Explorer-style) — different product surface, no fill-sim
      model exists, no evidence yet that it's needed beyond the one already-flagged slope backtest
- [ ] Auto-execution from candidate cards — crosses into `trade-advisor` plugin's territory
- [ ] Multi-underlying screener — contradicts the SPX-only constraint (D17)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Ranked candidate list + why-panel | HIGH | MEDIUM | P1 |
| Chain-snapshot staleness indicator (picker) | HIGH | LOW | P1 |
| Economic-events adapter (FOMC/CPI/NFP) | HIGH | MEDIUM | P1 |
| Payoff diagram/compare | HIGH | MEDIUM | P1 |
| DTE/delta filters | MEDIUM | LOW | P1 |
| Stream stall watchdog (badge state) | MEDIUM-HIGH | LOW-MEDIUM | P1 |
| Event-triggered supplemental snapshot | MEDIUM | MEDIUM | P1 |
| Rule-fired tag on entry_thesis | MEDIUM | LOW | P1 |
| Rule-fired → outcome report | MEDIUM | MEDIUM | P2 |
| Event-premium magnitude weighting | LOW-MEDIUM | MEDIUM-HIGH | P3 |
| Vasquez slope backtest (leg_observations) | MEDIUM (validates criterion 2) | HIGH | P2/P3 |
| Full backtesting engine | LOW (no current evidence of need) | HIGH | P3 (backlog only) |

**Priority key:**
- P1: In the v1.2 build order per PROJECT.md
- P2: Should have, natural next step once v1.2 data exists
- P3: Nice to have / explicitly deferred, backlog candidate only

## Competitor Feature Analysis

| Feature | thinkorswim (Spread Hacker/Analyze) | OptionNet Explorer (ONE) | OptionStrat | SpotGamma | Morai's Approach |
|---------|--------------------------------------|---------------------------|--------------|-----------|-------------------|
| Candidate ranking | Filter-driven scan list, no composite score | N/A (backtest/log tool, not a live scanner) | Payoff-first cards, comparison view | N/A (GEX dashboard, not a screener) | Composite score (8 verified criteria) + why-panel — more transparent than TOS's filter-pass/fail-only list |
| Data freshness display | Live/streaming during market hours, no explicit staleness UI | N/A (historical/backtest) | Live quotes, standard "as of" ticker | Snapshot timestamps on GEX charts | Explicit "as of" chain-snapshot age + staleness state, honest about 30-min cadence |
| Economic event awareness | None built into scan/Analyze | None | None | Not a calendar feature (GEX-only) | New adapter, purpose-built for FOMC/CPI/NFP flags feeding the score, not a general calendar |
| Rule/checklist tracking | None | Trade-log tags, custom filters, no explicit "rule fired" concept | None | N/A | Structured rule tag on `entry_thesis`, closer to Edgewonk's checklist-per-setup pattern than any options-analysis tool |
| Stream health / stall indication | Standard broker-platform connection status, not stall-specific | N/A | Standard live-quote refresh | N/A | Purpose-built LIVE/STALE/DISCONNECTED badge with bounded reconnect — closes a specific known gap (phase-12 audit) |
| GEX-informed scoring | Not offered | Not offered | Not offered | GEX is the product, but not fused into a calendar-candidate score | Differentiator: GEX fit folded directly into the picker score (criterion 7) |

## Sources

- [thinkorswim Spread Hacker manual](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Scan/Spread-Hacker) — HIGH (official docs)
- [thinkorswim Scan tab overview](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Scan) — HIGH (official docs)
- [OptionNet Explorer official site](https://www.optionnetexplorer.com/) / [User Guide](https://help.optionnetexplorer.com/) — HIGH (official docs)
- [SteadyOptions: OptionNET Explorer review](https://steadyoptions.com/articles/optionnet-explorer-one-options-backtesting-software-r743/) — MEDIUM (practitioner review)
- [Edgewonk Features](https://edgewonk.com/features) and [Edgewonk blog: 10 Things to Do After First Trades](https://edgewonk.com/blog/10-things-to-do-in-edgewonk) — MEDIUM (vendor content, cross-checked against Tradervue positioning)
- [Forex Factory Calendar](https://www.forexfactory.com/calendar) and impact-color-coding guides ([XS.com guide](https://www.xs.com/en/blog/forex-factory-guide/), [eplanetbrokers guide](https://eplanetbrokers.com/en-US/training/forex-factory-calendar)) — MEDIUM (third-party guides, consistent across sources)
- [Deephaven: Building real-time trading dashboards](https://deephaven.io/blog/2025/11/13/real-time-trading-dashboard/) — MEDIUM (vendor engineering blog, general real-time dashboard patterns)
- [dataintellect.com: Measuring Stale Data in Trading Systems](https://dataintellect.com/blog/stale-data-measuring-what-isnt-there/) — MEDIUM (data-quality engineering blog; Poisson-based stall-detection framing used to justify bounded-threshold approach over open-ended polling)
- [TradingView delayed-data documentation](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Datafeed-Issues/) — MEDIUM (platform docs, corroborates "yellow delayed badge" convention)
- `.planning/research/calendar-selection-criteria.md` (this project, adversarially verified) — HIGH (primary source for scoring criteria; not re-derived here)
- `.planning/PROJECT.md` (this project) — HIGH (scope boundaries, existing shipped features, milestone build order)

---
*Feature research for: single-user self-hosted SPX options trading dashboard (v1.2 scope)*
*Researched: 2026-07-03*
