# Domain: options, volatility, calendar spreads

Trading knowledge, not software knowledge. None of it depends on a codebase.

Two sections, and the line between them matters. **Verified** entries carry a
measurement, a query, or a live comparison. **Claimed** entries are asserted — by a
published source, by a research pass, or by design intent — and were never measured
here. Do not promote a claim to a fact by rewriting it.

Disproved trading beliefs live in [refuted.md](refuted.md). Software laws live in
[LAWS.md](LAWS.md). Vendor-specific data quirks live in
[vendors-and-infra.md](vendors-and-infra.md).

---

## Verified

### D001. Meaningful gamma walls need both tails cut: 8 to 45 DTE.

0-7 DTE carried 44.3% of total absolute gamma exposure on a live snapshot (2026-08-01T03:30Z, spot 7490, 32 expiries, 30.9 Bn total |GEX|), against 26.1% for 8-30d, 26.1% for 31-60d, 3.6% for 61d+. That near-dated mass is noise for a multi-week calendar. At the other end, LEAPS act as static parking-lot gamma that masks real near-term concentration: an unbounded window put the put wall 9.4% from spot against 0.4% windowed.

The 8-day floor was measured, not chosen: an earlier 15-day floor was wrong because the 8-14d bucket holds 11.9% of gamma and a maturing front leg still belongs in it. The 45-day ceiling has a known cost — on 2026-08-01 the largest single expiry line, 2026-09-18 at 49 DTE and +8.05 Bn, sat just outside it while the 3-DTE line at +6.68 Bn sat inside.

Source: `packages/core` GEX snapshot computation; `tools/tradingview/README.md`.

### D002. A put wall above spot is non-physical. Bracket the walls.

Constrain the put wall to ≤ spot and the call wall to ≥ spot. Without it, whichever strike carries the largest net gamma gets reported as the wall even on the wrong side of spot, which does not match how dealer hedging concentrates. Shipped 2026-07-08 (commit bda919a).

### D003. The 20-day calendar gap is convention, not derivation. Leverage falls smoothly with the gap.

Measured forward-vol leverage by gap size: 15-day gap ≈ 2.9×, 20-day ≈ 2.5×, 30-day ≈ 2.0×. The right gap is a leverage/risk trade-off, not a fixed number.

Source: analysis of the Predicting Alpha corpus, 2026-08-05.

### D004. A vendor's absolute vol-point threshold does not transfer to a different underlying.

Predicting Alpha's forward-flatness gate (`FF ≥ 16-20%`, cushion 17-20 vol points) was calibrated on single names and sector ETFs trading at 60-105% IV. SPX trades near 16% IV. Dispersion scales with the vol level, so the copied threshold is about an order of magnitude too large.

Measured on the live SPX chain, 2,465 candidates, cycle 2026-07-27: `FF ≥ 16%` fires **0 times**. Max FF 14.4%, p90 7.06%, median 0.36%. Cushion median +0.02 vol points against a doctrine of 17-20. The gate returns zero candidates forever and looks like it is working — silent failure, not an error. Rank cross-sectionally inside the current snapshot instead.

Source: `docs/calendar-engine/measurements.md`; `docs/calendar-engine/spec.mdx`.

### D005. Measured at a shared traded strike, "term structure" is really skew.

Front-month put skew is steeper than back-month put skew on SPX. Reading front-vs-back IV at one shared strike lets a deep-OTM strike show large apparent backwardation that is skew, not a mispriced term structure.

Ranking 2,465 SPX put candidates by raw per-strike forward factor put SPXW 7100 — 302 points OTM — at the top with FF 14.4%, against the best near-ATM candidate (|K−S| ≤ 25) at 7.7%, roughly half. Read the term-structure signal from each expiry cohort's IV interpolated to a fixed delta reference. Display the raw per-strike reading; never score it.

Source: `docs/calendar-engine/measurements.md`; `docs/calendar-engine/doctrine.md`.

### D006. Nearest-available-strike to a target delta degenerates on a sparse ladder. Interpolate, or refuse.

Scanning for "the strike nearest 50-delta" on a sparse cohort hands back a strike sitting at |delta| 0.876 while labelled 50-delta. Every ratio built on that reference is fabricated: the resulting forward factor inflated to 44.37% against a real cross-book maximum of 14.4%.

A tolerance alone is not enough. On an SPX 17/53-day pair, nearest-strike FF read 21.35% against 10.91% interpolated, because front and back references sat at different deltas (delta-gaps 0.070 and 0.001) and skew turned the mismatch into a systematic bias. Interpolate linearly in delta space between the tightest bracketing pair, and return null when the point is not bracketed or the bracket is too wide. Never extrapolate. Where both references genuinely sit at the target delta, nearest-strike and interpolated agree to 0.45 vol points — the method only diverges where it matters. The same degeneracy runs in the other direction on the selection side: a screening universe built from fixed delta rungs (at-the-money, −0.30, −0.20, −0.10) provably excluded the trader's own real 7450 fill at Δ −0.43, which fell between the −0.45 and −0.40 rungs. Replaced by a continuous membership band — every liquid 25-point strike whose front delta falls in [−0.49, −0.30] — so a real fill is provably inside the universe.

Source: `docs/calendar-engine/spec.mdx`.

### D007. Theta as a percent of extrinsic value is U-shaped in strike. It is a tenor comparator, not a strike comparator.

Valid across tenors — roughly 3%/day of extrinsic at 30 DTE, 10%/day at 10 DTE, 100% on the last day. Invalid across strikes within one expiry: the ratio is minimised at the money and rises on both sides, so ranking it higher-is-better ships the most out-of-the-money strike available.

Measured live: strike 6660 (736 points OTM) 0.03022; strike 7380 (16 points OTM, the minimum) 0.00744; strike 7640 (244 points ITM) 0.02852. Scored at weight 20, the top-ranked live candidate landed 721 points OTM, in the 93rd percentile of that term. The replacement tried next — `netTheta/|netGamma|` — was worse: monotonic from 55,070 deep OTM to negative deep ITM, no minimum at all. One hundred green unit tests coexisted with this term shipped at the wrong sign. No unit test can catch a ranking term pointing the wrong way, because the term computes exactly what it claims to compute. The only check that fires is a live cross-sectional run asserting the top-ranked candidate sits near the money. Make that a required gate in the engine spec, not a habit.

Check the shape of a metric against the axis you intend to rank on before scoring it.

Source: `docs/calendar-engine/spec.mdx`.

### D008. A scalar shared by every candidate is mathematically inert in a percentile-rank scorer.

`frontIv − marketWideConstant`, where the constant is the same for every candidate in the snapshot, changes no pairwise comparison. Percentile rank counts how many others a value beats; a shared offset preserves every ordering.

Doubling the injected realized vol from 0.12 to 0.30 produced a byte-identical candidate ranking. Measured correlation between the proposed term's percentile and the existing forward-vol edge percentile: 0.954 across 7,951 candidates. The term itself took only 21 distinct raw values. It was collinear, not independent, regardless of how much the shared constant moved. A penalty term saturates the same way and for the same reason. A per-event penalty of 0.5 fired on effectively every candidate — any 20-35 DTE window spans at least two of FOMC, CPI and NFP — so the criterion sat permanently at 0 and separated nothing. Halving it to 0.25 restored the spread and flipped the live top pick to a single-event candidate at 75% credit. Before weighting any term, check that it actually varies across the candidate set.

Source: `docs/calendar-engine/spec.mdx`.

### D009. On a fresh weekly index chain, neither open interest nor spread is a usable liquidity filter.

Open interest only accumulates after a strike has traded. On a chain minting new weeklies continuously, a freshly listed near-the-money strike legitimately shows low OI while quoting tight two-sided. Measured on 1,218 SPX puts, 15-90 DTE, one cycle: OI p25 = 4, p50 = 39; OI < 100 for 829 of 1,218 (68%), and for 175 of 255 (69%) of near-ATM SPXW legs specifically. An `OI ≥ 100` gate removed 82% of all candidates, 2,454 → 450 — including the exact strikes the strategy wants.

The textbook alternative fails too. Spread as a fraction of mid: p10 0.4%, p50 0.6%, p90 1.0%, max 7.8%. The whole distribution sits inside 1% of mid, so a spread gate at any reasonable cutoff removes nothing.

The only liquidity signal left is whether the quote is two-sided at all — bid > 0.

Source: `docs/calendar-engine/measurements.md`; `docs/calendar-engine/spec.mdx`.

### D010. Implied vol is solved, not observed. Two reputable platforms disagree by vol points and both are right.

IV is back-solved from a quoted price through a pricing model — rate, dividend yield, American/European treatment. Each platform picks its own. Raw bid, ask, last, OI and volume are identical across platforms; only derived IV and greeks diverge.

On 2026-06-05, SPX 7350 PUT calendar (Jul 10 / Aug 7): Schwab read front 15.58% / back 15.23% — inverted, a hard fail on a term-structure gate. ThinkorSwim read front 17.12% / back 17.25% — normal contango, pass. Same strikes, same minutes. A ~2-point systematic gap flips the verdict on the same trade.

Never consume a vendor's derived IV for a decision. Solve it yourself from raw bid/ask with your own fixed, documented (r, q), calibrated periodically against a trusted reference.

Source: `docs/iv-engine-discrepancy-and-solver.md`.

### D011. Put-call parity implied carry: `q = −ln((C − P + K·e^(−rT)) / S) / T`.

Re-derived independently and matched against the shipped code, then confirmed against a hand-derived oracle and again against the BSM pricer. Guard `rhs ≤ 0` to null rather than taking the log of a negative. Require both the call and the put mark strictly greater than zero before accepting an ATM pair — a stale or zero mark can still produce a positive `rhs` and a silently wrong yield.

Source: Phase 34 review.

### D012. Parity-implied carry has noise gain 1/T. Refuse below a time floor; never clamp.

Dividing a price residual by T amplifies residual noise by 1/T. Short-dated expiries produce impossible results: measured live, a 0DTE implied yield of 29.84%, plus negative yields on sparse expiries — impossible for an index. The decay is steep and it settles fast. Measured on one live cycle: 0.1846 at 0 DTE, 0.0746 at 1 DTE, 0.0443 at 2 DTE, and roughly 0.009 by 4 DTE. Nothing about the pipeline is broken at the short end; the 1/T noise gain is.

The fix refuses any expiry under a 7-day horizon and any answer outside [0, 0.10], returning null rather than a clamp, so every consumer falls back to its own explicit default instead of a clamped value posing as a measurement. Post-fix live cycle: 32 carry entries, 0 negative, 0 above 0.10, range 0.00280 to 0.01614.

Source: `plans/analyzer-chain-HANDOFF.md`.

### D013. The T+0 breakeven gap to ThinkorSwim closes on fractional settlement DTE plus parity carry. Smile IV is not needed.

Two sources dominated the gap: integer DTE instead of exact fractional time to settlement, and a flat or zero carry assumption instead of a per-expiry yield solved from put-call parity.

Baseline gap on a 3-calendar book: 8 points at the low breakeven, 18 at the high. After the fix, live during regular hours on 2026-07-13 and user-confirmed against ThinkorSwim on the same book: 7416 / 7686, within a few points.

Smile-aware IV was explicitly not needed. ThinkorSwim's own default "Individual Implied Volatility" mode holds each series' calibrated IV fixed as spot moves — exactly what a flat front/back scenario model already does for a single-strike calendar. Smile interpolation only matters for multi-strike books. See [R012](refuted.md#r012-smile-aware-iv-would-close-the-thinkorswim-breakeven-gap).

Source: Phase 34 UAT and context.

### D014. Every leg of a spread uses one settlement-aware T. Mixing conventions does not cancel out of a ratio.

If one leg settles AM and the other PM, a naive calendar-days/365 convention gets the ratio between the two legs' T wrong by an amount depending on which root landed on which settlement type that month. It is not a uniform rescale, because settlement time is not proportional to calendar days.

Measured on a 17/52-day pair, 2026-07-28 15:30Z: settlement-aware `t_f/t_b` = 0.32934 for SPXW and 0.33106 for SPX, against a naive DTE ratio of 0.32692 for both — roughly a factor-of-two difference in the resulting edge, purely because that month's back expiry was a third Friday.

See [L060](LAWS.md#l060-one-math-kernel-one-t-function-one-carry-source-three-implementations-will-drift) for what happens when nine T conventions coexist in one codebase.

Source: `docs/calendar-engine/current-state.md`; `docs/calendar-engine/spec.mdx`.

### D015. Carry must come from the same computation that solved the IV it reprices.

If IV is inverted with a flat platform-wide (r, q) but a downstream step reprices greeks with a different, more granular per-expiry pair, the two legs of one position can land on different carry regimes whenever one expiry has a solved entry and its partner does not. Carry moves delta, and if selection depends on delta, the selected strike changes.

Measured 2026-07-28: a per-expiry lookup with a silent `{0.045, 0.013}` fallback priced the two legs of 3,313 of 5,917 live candidates — 56% — on different (r, q). It moved the delta-neutral strike on 1 of the top 10 ranked pairs with a 2-expiry carry array and on 8 of 10 with a 43-expiry array, and reordered the top ten in both runs. The round trip has to close on the same parameters too. Inverting a broker mark to IV under a flat default rate and dividend, then repricing that IV under per-leg parity carry, is not an identity: the T+0 curve floated +$265 at spot — the site read +$194 against the broker's −$20 — and breakevens came out about 45 points wide. Resolve carry first, then invert with it (commit 2055e82).

Use one carry source for the whole computation, matched to whatever solved the IVs. Never a per-leg lookup with a silent default.

Source: `docs/calendar-engine/spec.mdx`; `docs/calendar-engine/current-state.md`.

### D016. Compute T from the settlement timestamp, never from `(expiry − now)/86400000`.

Calendar-day subtraction undercuts any expiry whose real settlement falls late relative to an arbitrary "now". A nominally 6-calendar-day expiry works out to 7.31 years-fraction days measured to the settlement instant. Any time-sensitive guard — a minimum-T floor, for instance — must use the real timestamp or it rejects and accepts the wrong expiries at its boundary.

Source: `plans/analyzer-chain-HANDOFF.md`.

### D017. VIX1D defines a session as exactly 1/252. Dividing by sqrt(252) inverts its own construction.

CBOE's VIX1D methodology builds on business minutes during regular hours: a business year is 252 × 6.75 × 60 = 102,060 minutes, and one full session is 405. So a session is 405/102,060 = exactly 1/252. Weekends contribute zero business minutes.

VIX, VXN, RVX and VXD are different — they annualise on 365 calendar days, so sqrt(252) there is a genuine convention choice, justified by French & Roll (1986): a 3-day weekend carries only about 10.7% more variance than one session.

Source: `tools/tradingview/expected-move.pine`, citing CBOE's VIX1D methodology PDF.

### D018. VIX1D drifts up through the session and gaps down overnight, mechanically.

Its dynamic weighting of the 1DTE leg produces the drift independent of any change in expected volatility (Albers & Kestner, *Journal of Behavioral & Experimental Finance*, 2024).

Confirmed live pre-open on 2026-08-21: VIX1D read 12.31, up 26.1% on the day, while VIX moved −2.1%. That gap is the artefact, not a vol event. Read VIX1D near the open for the most honest value; discount a rising VIX1D late in the session as partly mechanical.

Source: `tools/tradingview/expected-move.pine`.

### D019. Remaining expected move scales with sqrt(elapsed fraction), never with the fraction.

Half a session gone leaves sqrt(0.5) ≈ 71% of the day's expected move, not 50%. Subtracting a realized move from the daily expected move — "1.00% expected, 0.33% realized, so 0.67% left" — understates the remaining move every time.

Source: `tools/tradingview/expected-move.pine`.

### D020. An expected-move band's anchor and sigma must match. Only two of three obvious pairings are correct.

| Anchor | Sigma | Verdict |
|---|---|---|
| Prior regular-hours close | Full-day implied sigma | Correct |
| Today's open | Full-day sigma × sqrt(regular-hours variance share) | Correct |
| Today's open | Full-day sigma, unadjusted | **Wrong** — double-counts the overnight move as still ahead |

The third pairing is what most published expected-move indicators do. It is why their bands read generous.

Source: `tools/tradingview/expected-move.pine`.

### D021. A backtest that prices entry and exit from the same chain slice measures the spread, not edge.

With no forward time progression, P&L collapses algebraically to a function of the entry spreads. With haircut fraction `f` applied symmetrically: `simulatedPnl = (1 − 2f) × (sum of bid-ask widths) × qty`. For `f = 0.66` that is always negative, and identical for any two candidates with the same spreads regardless of what actually happened — derived as `−0.32 × (width_back + width_front) × 100`.

Every downstream signal built on it — attribution, ablation, confidence intervals — reports rule-validity verdicts that are really transaction cost. The fix is a genuine forward walk: re-price at later chain snapshots and exit at the first actionable verdict or at expiry, mirroring however the tool already replays exits for closed positions (CR-01, Phase 27, fixed f164747). Unreplayable candidates get marked, never fabricated.

Source: Phase 27 review.

### D022. A 1-day expected-move band from VIX1D reads about 11% too wide. A 30-day proxy is 12 points worse.

Backtested against CBOE's published SPX/VIX/VIX1D history, n = 1,072 common-window sessions:

| Source | 1σ coverage | Fitted haircut | Post-haircut |
|---|---|---|---|
| VIX1D | 72.67% | 1.108 | 68.10% |
| VIX (30-day) | 80.13% | 1.311 | — |

The calibrated target is 68.27%. A 30-day average implied vol spread evenly over one session runs rich on quiet days and cheap into events — 11.86 percentage points worse than VIX1D on identical days. The same over-generosity is predicted for VXN, RVX and VXD on QQQ/IWM/DIA, since CBOE never built 1-day versions of those.

The over-width shrinks in stress but never flips sign: fitted haircut runs 1.13 in the calmest VIX tercile down to 1.08 in the highest for VIX1D, and 1.57 down to 1.15 for VIX. Every bucket is above 1.00. Prior-close-tagged 2σ breach rates run 3.66% and 3.07% across terciles, both below the 4.55% expected. An earlier claim that this error flips sign across regimes was contamination — see [R010](refuted.md#r010-the-expected-move-error-flips-sign-across-vol-regimes).

Source: `tools/tradingview/backtest-expected-move.md`.

### D023. Monday's band runs about 20% wide, and it is a real weekend variance risk premium — not a bug.

Monday's band, built from Friday's VIX1D close, covers 81.4-81.5% at 1σ against roughly 67-72% Tuesday through Friday. Haircut ~1.29-1.30 against ~1.04-1.08.

Two checks rule out a calendar-vs-trading-day artefact. First, Friday's mean VIX1D (16.66) is *not* marked down against Wednesday (16.27) or Thursday (17.05) — sellers charge a full ordinary session's variance for a span that structurally delivers far less. Second, French & Roll's true weekend variance excess is only +10.7% (1.052× in std terms), far too small, and applied literally it pushes the wrong way. Holiday four-day weekends (n = 31) land near-ordinary at a 1.109 haircut, which a pure calendar-length mechanism cannot explain. The overstatement is not monotonic in calendar gap length, which is the strongest single argument against a calendar-time mechanism: fitted haircut 1.065 across a one-day gap, 1.290 across three days, 1.109 across four. No calendar-time story produces that ordering. Worth recording how this was nearly got wrong. A calendar-versus-trading-day annualisation explanation was written into three shipped artifacts before CBOE's own VIX1D methodology PDF was read, and the PDF disproves it outright — VIX1D is already business-time, see D017. A mechanism that fits the sign of the data is still a guess. Read the vendor's methodology document first.

This is an edge for premium sellers, not a defect to correct.

Source: `tools/tradingview/expected-move.pine`.

### D024. A term-structure de-trending coefficient does not survive a tenor substitution.

Johnson (JFQA 2017) prefers `2·VIX_12m² − VIX_1m²`. The `2·` coefficient is derived for the 12m:1m tenor ratio specifically, to de-trend the naive difference's −68% correlation with the level of the vol curve. Substituting a capped 6-month tenor breaks it: `2·VIX6M² − VIX²` still correlates +0.575 with VIX level, against an intended near-zero.

Re-fitting does not rescue it. A fitted `k = 1.485` nulls the full-sample correlation (+0.152) but is unstable across sub-periods — 1.700 / 1.168 / 1.676 / 1.765 / 1.782 — and its sign relative to the level flips across periods. That is worse than a small consistently-signed bias for percentile ranking: ranking absorbs a steady tilt, nothing absorbs a sign flip. The published coefficient was kept because its bias stays consistently signed and has been shrinking (+0.56 down to +0.21 across sub-periods).

Measured 2026-08-25 on n = 4,258 daily closes, 2009-09 to 2026-08.

Source: `tools/tradingview/watchlists-calendar.md`.

### D025. A roll's credit is not the rolled position's realized P&L. They can point opposite ways.

The credit shown on a roll ticket is proceeds from closing the old leg minus the cost of the new one. It nets a loss on the old position against the cost of the new one, so a positive credit coexists with a real loss.

Measured: an SPX 7500P calendar rolled at a $1.50 credit had a true realized loss of −$169, the mark having moved 43.27 → 41.58. The replacement 7400P went on at 40.08. A broker's trade-history view does not surface strategy-level realized P&L across a roll. Only a fill-by-fill cost-basis ledger gives the real number.

Source: `.remember` 2026-07-23.

### D026. Settlement style comes from the contract's root, never from its expiry date pattern.

SPX monthlies are AM-settled; SPXW is PM-settled on every date it lists, third Fridays included. Inferring AM/PM from "is this a third Friday" is only safe while the code path never sees SPXW. Once both roots coexist, a real SPXW third-Friday contract gets tagged AM — which selects the wrong contract if the order is pasted into a broker.

Source: `plans/analyzer-chain-HANDOFF.md`.

### D027. Overnight variance share cannot be measured from pre-2015 Yahoo opens.

Yahoo reports `^GSPC`'s daily open as equal to the prior close for 96.7% of 2000-2004 sessions and 31.4% of 2005-2009 — no true opening print was published then. Each such day fabricates a zero overnight move and drags the measured share down. Only 2015 onward is trustworthy, and only 2022-05 onward for the VIX1D era. Any study shipping a hardcoded overnight-share constant should be re-measured against a clean-opens window.

Source: `tools/tradingview/verify-expected-move.ts`.

### D028. Two symbols printing the same number today are not duplicates. Check session hours, roll behavior, and delay status.

Verified pairs that are genuinely different instruments: `SPCFD:SPX` is regular-hours-only with a 17.5-hour overnight gap, while `CAPITALCOM:SPX500` runs continuous 24/5 with a maximum 1800s gap — and because the E-mini continuous contract resolves to a delayed feed on this account, the CFD is the only real-time overnight index read. `VELOCITY:BRENT` against `FX:USOIL` are different crude grades with a genuine $7.30 spread (93.90 against 86.60). A continuous rolling futures spread and a dated non-rolling one pinned to a single FOMC meeting answer different questions; both belong.

An earlier version of this list over-trimmed on exactly the wrong tests: "prints the same number today" and "looks like the same asset class".

Source: `tools/tradingview/watchlists-calendar.md`.

### D048. A two-anchor variance curve must never be evaluated below its shorter anchor.

Interpolating implied vol linearly in total variance between two tenor anchors is sound between them and nonsense below them. Evaluated at a tenor shorter than the near anchor it is extrapolation, and it removes variance that was never there — far enough to produce a negative variance for the front leg, which then gets silently clamped to a vol floor.

Measured on a curve built through (30d, VIX) and (93d, VIX3M) and read at 16 DTE: the front leg priced at 0.72× VIX against a reality near 0.93-0.96×, the nine-day variance came out negative, and the whole surface inflated roughly threefold — an at-the-money read of +18.4% of debit against a correct +5.6%. The fix was a third anchor at 9 days from VIX9D, so the tenor needed is always bracketed.

Source: project memory, calendar strike-side study.

### D049. Count a regime filter's episodes, not its days. One crisis wears the filter's clothes.

A binary market-condition gate looks well-powered when its "on" days are counted and thin when its independent episodes are. Days inside one episode are the same observation repeated.

Measured on a 200-day moving-average skip gate over a decade of SPX calendar windows: 172 ON days, but only 16 episodes, and 2022 alone supplies 129 of the days. Fifteen of the decade's twenty worst windows are 2022 entries. The other five — two in February 2020, one in September 2020, December 2018 and March 2018 — were all *above* the 200-day, and the gate never fired on any of them. Excluding 2022, the gate fires on 3% of days and catches none of the worst twenty.

Checking whether the effect survives removing the dominant period is itself circular when that period is most of the sample. The honest read is that the gate has one episode of evidence.

Source: project memory, calendar strike-side study.

### D050. Forward factor is the inverse term-structure ratio wearing a different name.

Under the closed form `sigma_fwd² = (T2·V2² − T1·V1²) / (T2 − T1)`, the absolute vol level cancels out of the forward-factor ratio exactly. What is left is a strictly decreasing function of the back-over-front IV ratio alone. A screen that ranks on forward factor is ranking on curve slope and nothing else.

Measured on 60k `calendar_ranking` rows at a fixed tenor gap: the Spearman correlation between the raw IV ratio and the engine's own forward-edge value runs −0.93 to −0.98. Ranking by one is about 97% rank-identical to ranking by the other.

The consequence is a design conflict, not a rounding note. A high-forward-factor requirement demands a flat or inverted curve, so it cannot coexist with a separate "contango preferred" entry gate. One of the two has to go.

Source: project memory, calendar strike-side study.

### D051. On a European cash-settled index, the call and put calendar at one strike differ by a computable constant. Let liquidity pick the side.

Put-call parity makes a call calendar and a put calendar at the same strike and the same two expiries near-identical in P&L on a European cash-settled underlying. What separates them is a deterministic financing offset, not a directional view. So the side to trade is the side with the tighter, deeper market at that strike — which is the out-of-the-money side.

Measured at K = 7730: the two structures differ by +$39.83 per share, drifting −$0.21 per SPX point. Live open interest at 7850, above spot: 25,939 calls against 1,643 puts. Above spot the call side is the liquid one by an order of magnitude.

This answers which *side* to trade at a chosen strike. It does not touch which strike to choose relative to spot — see the "Still open" note in [refuted.md](refuted.md).

Source: project memory, calendar strike-side study.

### D052. A book has one P&L horizon, not one per position.

Evaluating each position at its own front-leg expiry and summing the results adds up numbers computed on different calendar dates. For a book of calendars with mixed expiries that approximates nothing. Price the whole book at one horizon — the earliest included front expiry — and let the later legs keep the time value they still have.

Measured against a real ThinkorSwim book: at spot 7200 the per-position version reported +$6,368 against ThinkorSwim's roughly +$500. Every single-calendar fixture had exactly one expiry, so "own expiry" and "earliest expiry" were the same number and the suite stayed green throughout.

Source: project memory, Phase 29-35 review chain.

### D053. Close-inside-band and intraday-touch are two different questions, about 20 points apart.

A close-only backtest answers whether the close landed inside the band. It says nothing about whether price reached the band during the session — and price routinely passes through a level on its way to a further close.

Measured on the same SPX/VIX1D history: 72.64% of closes land inside the 1σ band, while only 52.66% of sessions never touch it at all, so roughly 47% of days do. At 2σ, 96.83% close inside against 93.84% never touched. Anyone reading the band as intraday support or resistance needs the touch number; the containment number flatters it by about twenty points at 1σ.

Source: `tools/tradingview/backtest-expected-move.md`.

---

## Claimed

Asserted, sourced, never measured here. Treat as a prior, not a fact.

### D029. A calendar's term-structure edge lives in forward variance, not an IV subtraction.

Simple front-minus-back IV subtraction is valid only at the same expiry, where it measures skew. Across two expiries the correct measure is the no-arbitrage forward-variance identity:

```
FwdIV = sqrt((T2·sigma2² − T1·sigma1²) / (T2 − T1))     T in days to expiry
```

The radicand can go negative under term-structure inversion. Guard it; never silently take the root of a negative or substitute a default.

Rated HIGH confidence by a 3-0 adversarial vote across three passes, cited as matching SpotGamma's published methodology. Source: `.planning/research/calendar-selection-criteria.md`.

### D030. A calendar's net vega is root-time flat. Never score it.

Short-dated implied vol reacts to a shock roughly as 1/sqrt(T) while vega grows as sqrt(T). The two cancel, so `vega(T) × deltaSigma(T)` is approximately constant across the term structure for any normal, root-time-conforming shock. A calendar — short front, long back, same strike — therefore neither gains nor loses on net vega from a normal shock. All the real edge sits in the non-root-time residual. Compute and display net vega; never weight it.

The invariant held even where the source's own arithmetic did not: a published shock table's vega ladder (30d 17, 60d 24, 90d 29, 120d 34, 365d 59) is pure sqrt(T) — 24/17 = sqrt2, 29/17 ≈ sqrt3, 34/17 = sqrt4, 59/17 ≈ sqrt12 — while its printed shock-magnitude cells contradict its own stated shock formula.

Source: `docs/calendar-engine/doctrine.md`.

### D031. Theta is rent for gamma, in exact proportion. Ranking on raw theta ranks tail risk.

Theta income is bought with short gamma in a fixed proportion for a given structure. Ranking "higher net theta is better" without normalising for the gamma sold surfaces the most short-gamma expiry and strike available. Theta scales as 1/sqrt(T). The doctrine's own framing: one man's theta is another man's gamma.

Read theta as a percentage of the option's own remaining extrinsic value, not in dollars — and note that even the normalised form is a tenor comparator only. See [D007](#d007-theta-as-a-percent-of-extrinsic-value-is-u-shaped-in-strike-it-is-a-tenor-comparator-not-a-strike-comparator).

Source: `docs/calendar-engine/doctrine.md`.

### D032. Expected value is structure-invariant. Never rank on probability of profit.

For a fixed forecast and market price, EV is a property of the mispricing, not of the structure expressing it. A straddle (~60% win rate, 1:1 payoff) and a strangle (~80% win rate, 1:0.5) on the same view can carry identical EV. Ranking on win rate picks a path preference and calls it edge. Score the mispricing.

Source: `docs/calendar-engine/doctrine.md`, quoting: "All else held equal, your EV should be the same."

### D033. A protective long leg bought rich can consume most of the edge it protects.

Buying a longer-dated option as a hedge halves max loss cheaply only if that leg is itself cheap in vol terms. A 90-DTE long strangle hedging a 7-DTE short program consumed roughly a third of expected profits and over 60% of premium collected, while cutting max loss from $4,000 to $2,400 per lot. A live SPX strangle-swap hedge stressed to an 8% one-week move reproduced the same shape.

A long calendar is exactly this hedged structure — short front, long back. Check the back leg's richness independently before trusting the calendar's edge.

Source: `docs/calendar-engine/doctrine.md`; `docs/research/predicting-alpha-ultimate-guide-to-selling-options.md` Module 9.

### D034. A hard gate at a noisy boundary flaps and deletes the trades with edge. Prefer hysteresis or a graded penalty.

A binary cutoff on a metric that oscillates around its own threshold makes the whole candidate universe appear and vanish as the metric crosses. Worse than jitter: the boundary region is exactly where marginal opportunity clusters, so a hard gate rejects what would have been the profitable trades.

The remedy is hysteresis — a condition must persist, or arm and disarm at separate thresholds — or a graded score penalty near the boundary. Applied deliberately to the market-level crisis gate: `VIX ≥ 25` or `VIX/VIX3M ≥ 0.95` became a hysteresis-banded penalty rather than a cliff that blocks entry.

This is the design correction drawn from [R006](refuted.md#r006-a-per-pair-term-inversion-gate-encodes-crisis-avoidance). Source: `.planning/research/PITFALLS.md`; `.planning/REQUIREMENTS.md` PLAY-01.

### D035. Sample-size floors: 30 bare, 100 basic, 200-500 institutional — and correlated trades count for less.

Per Bailey, Borwein, Lopez de Prado and Zhu on the probability of backtest overfitting: ~30 trades is the bare statistical floor for any significance claim, ~100 gives basic reliability of aggregate metrics, 200-500 approaches institutional confidence.

Raw count is not sufficient. 500 trades in one volatility regime is weaker evidence than 100 across several, because trades within one regime, trader, instrument or window are correlated and the effective sample is smaller than the nominal count.

Source: `.planning/research/FEATURES.md`, `PITFALLS.md`, `SUMMARY.md`.

### D036. n=13 is overfitting formalized. No confidence percentage, no weight promotion below n=30.

Fitting 9 free scoring weights to 13 closed trades — one trader, one instrument, roughly a 6-week window, one contango regime — is less than half the bare floor, inside one regime. That backtest is a refutation and mechanics-validation tool: does this rule's sign even point the right way. It is never a weight-fitter.

Three consequences, all enforced structurally rather than by process reminder. Every reported number is stamped with its `n` and date range. Verdicts state the rule that fired and its raw metric and carry no confidence percentage — there is no calibration basis for one. Automated weight promotion is hard-gated until n ≥ 30 real closed trades, and the backtest CLI is stamped never-writes-weights at the code level, with no rule-writing port anywhere in its package.

Source: `.planning/STATE.md`; `.planning/REQUIREMENTS.md` BT-05; `docs/architecture/backtest-harness.md`.

### D037. A backtest's exit fill needs the same haircut as its entry.

Exiting a spread crosses the bid-ask again. Haircutting the entry off mid but filling the exit at mid systematically overstates edge — and the exit is the more dangerous half, because exit marks are exactly what decide whether a profit-take or stop threshold was crossed.

Use one shared haircut function for both sides, calibrate it against real known fills rather than the model's own number, and report P&L as a range from mid to full haircut, never a single figure. The calibration test: if the model says +$400 and the real fill netted +$150, the haircut is too generous.

Source: `.planning/research/PITFALLS.md`.

### D038. Store the vendor's greeks and your own side by side. Prefer yours; keep theirs.

A vendor's greeks are a black box — unauditable, unreconcilable. Your own are internally consistent and attributable. Store both in separate columns on every observation table, read the computed value, fall back to raw only before computation has run. The vendor number is what lets a later reader detect that your own computation has drifted from what the broker's screen shows. Carried forward as a lesson from the predecessor dashboard.

See [D010](#d010-implied-vol-is-solved-not-observed-two-reputable-platforms-disagree-by-vol-points-and-both-are-right) for why the two legitimately differ. Source: `docs/architecture/data-model.md`.

### D039. Newton-Raphson IV inversion needs a bisection fallback near zero vega.

Vega collapses toward zero for deep ITM and deep OTM strikes and for very short DTE, and Newton-Raphson then fails to converge. Fall back to bisection whenever a step would leave the search bracket or vega drops below a small epsilon. Bisection is slower and guaranteed to converge inside a fixed bracket regardless of local flatness.

Shipped constants: vega threshold 1e-8, 50 Newton iterations, 200 bisection steps.

Source: `knowledge-base/calendar-trade-dashboard-learnings.md`; `packages/core/src/journal/domain/iv-inversion.ts`.

### D040. Recompute the GEX flip and put wall. A vendor's own labelled fields are wrong by its own methodology.

The true zero-gamma flip is the strike where net dealer gamma changes sign on the strike grid — not whatever a vendor's HVL field reports. The put wall is the strike carrying maximum *put* open interest — not whatever a generic putWall field reports.

Regression guard: property-test the signed-gamma computation so puts always contribute negative exposure and net GEX can go negative. A predecessor study applied the put sign in only one of three parallel calculation paths, so net GEX could never go negative and the regime read froze at long-gamma permanently.

Source: `docs/tos-studies-learnings.md`.

### D041. The GEX dealer sign convention is an assumption, not a measurement.

Calls positive, puts negative encodes "dealers are net long calls and net short puts". Every vendor assumes it. It is a model. When real customer flow runs the other way — heavy call selling, or put buying — the true dealer gamma sign can invert relative to what the formula reports, and computed levels are confidently wrong with no internal signal that it happened.

Source: `tools/tradingview/README.md`.

### D042. SPX index options report open interest as zero; the workaround was an ETF proxy.

Carried as a standing regression gate across three milestones: SPX options report `open_interest = 0` in every vendor observation, treated as a structural feed characteristic rather than a data-quality bug, with SPY's OI scaled by roughly 10.048× used as a liquidity proxy.

**This conflicts with a later measurement.** See [V011](vendors-and-infra.md#v011-open-interest-reads-zero-outside-regular-trading-hours) — 86.3% of contracts carried non-zero OI from 10:30Z onward, and 0.0% before it. Reconcile before rebuilding either behavior.

Source: `.planning/milestones/v1.1-ROADMAP.md`; `.planning/STATE.md` regression gates.

### D043. The percentile discipline is on the wrong measure.

The shipped vol-state gate percentile-ranks VIX itself (252-day lookback, blocking at the 80th percentile) — a measure the literature does not support as a slope or timing signal. It gates term structure on fixed absolute levels — the exact measure where Johnson's evidence calls for an expanding-window percentile instead. Johnson names no absolute cutoff; his rule is that the bottom quintile of the measure's own history favours long vega.

Adding a percentile arm to term structure, not to VIX, was identified as the single highest-value change to that gate.

Source: `tools/tradingview/watchlists-calendar.md`, 102-agent research pass 2026-08-24.

### D044. The realized leg of VRP wants intraday data, not daily closes.

*Review of Financial Studies* 22(11) (2009) states the results depend crucially on model-free implied volatilities together with realized variation measures built from high-frequency intraday rather than daily data. Adjusted R² is 6.82% intraday against 2.16% daily — more than 3× from the realized-vol construction alone.

The shipped implementation uses `stdev(log(close/close[1]), 20)` on daily bars: the weak form. The implied leg is already correct, since VIX is model-free. 30-minute regular-hours snapshots were already being collected and could supply the stronger construction.

Source: `tools/tradingview/watchlists-calendar.md`.

### D045. A ratio's moving average is not the ratio of the legs' moving averages.

Fetch the ratio as one combined symbol and average that series. Fetching the two legs separately, averaging each, and dividing the averages computes a different quantity. The difference changes which days a check flags, not just rounding.

Source: `tools/tradingview/breadth.pine`.

### D046. Picking tickers from different-sounding categories is not diversification. Check the correlation matrix.

KWEB, ASHR and FXI all pass an independent VRP screen and look like three separate China-adjacent sector trades. They are extremely correlated: what looked like three trades was much closer to one giant trade held three times, tripling transaction cost and concentration. KWEB with URA (uranium) and BITO (bitcoin) showed very little pairwise correlation by contrast.

Source: `docs/research/predicting-alpha-ultimate-guide-to-selling-options.md` Module 9.

### D047. A published live short-vol track record: 89.97% over two years, and the tail is the whole risk budget.

Self-reported, not independently audited. Selling short-dated (near-1-DTE) at-the-money straddles and strangles across a basket of single-name earnings events, held overnight, 2022-10-06 to 2024-09-27 (772 days):

| Metric | Value |
|---|---|
| Trades | 1,380 (the source's own title says 1,381; its conclusion says "over 1,300") |
| Win rate | 82.60% |
| Average winner | $800.64 |
| Average loser | −$2,951.35 |
| Biggest winner | $9,544.07 |
| Biggest loser | −$32,384.57 |
| Total return | $224,914.81 = 89.97% on $250,000 |
| Beta to SPY | 0.031 |

The stated sizing rule: size to a max risk of 25% of what you think you can handle, and plan for the tail to be 3-5× the stated max-risk figure.

No Sharpe ratio and no maximum drawdown were ever published, while every other summary statistic was. Treat the absence as a signal, not an oversight. The self-contradicting trade count is preserved deliberately — see [P023](process-and-verification.md#p023-preserve-a-sources-self-contradiction-verbatim).

Source: `docs/research/predicting-alpha-ultimate-guide-to-selling-options.md` Module 9.
