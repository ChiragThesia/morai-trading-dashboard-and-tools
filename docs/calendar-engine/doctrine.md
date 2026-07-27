# Predicting Alpha — Doctrine Dossier

Source: 103 articles on predictingalpha.com/blogs, read by 11 agents.
Target: one deterministic SPX/SPXW calendar-spread ranking engine.

**URL convention.** Every citation in this document is a slug. Expand as
`https://www.predictingalpha.com/blogs/<slug>`. Numbers carry their slug inline.

**Attribution convention.** Plain text = the author's own words or arithmetic.
`[inference]` = mine, not his. I mark every one.

**The trader's frame — non-negotiable, overrides the corpus where they conflict:**

- Short (front) leg: minimum 15 DTE.
- Front-to-back gap: minimum 15 days. Back leg therefore ≥ 30 DTE.
- Delta-neutral.
- SPX / SPXW index options only.
- One engine: enumerate every leg pair, run the math, rank, name the best.

Where the corpus prescribes 7 DTE or 1 DTE fronts, it is out of scope. Say so
and move on. Section 7 lists every collision.

---

## 1. The house thesis

The author has exactly one claim about where money comes from, and he repeats it
in ~40 of the 103 articles: **the variance risk premium**.

> "the tendency for implied volatility to be higher than the subsequently
> realized volatility" — `variance-risk-premium`

It is not a theory. It is an empirical regularity he measures. The numbers he
publishes for it:

| Claim | Value | Slug |
|---|---|---|
| SPX average IV minus realized | **4 vol points** | `variance-risk-premium` |
| SPX implied exceeds realized | **by 9% on average** | `the-option-traders-guide-to-the-variance-risk-premium` |
| SPX IV30 / RV20 ratio, typical | **≈ 1.3** | `iv-rank` |
| VRP positive, share of history | **85% of the time** | `variance-risk-premium` |
| Short-vol Sharpe, equities | **0.6** | `the-option-traders-guide-to-the-variance-risk-premium` |
| Short-vol Sharpe, commodities | **1.5** | same |
| Market beta premium Sharpe, for scale | **0.4** | same |
| Study base | Fallon/Park/Yu, 1995–2015, 34 markets | same |

The 4-point and 1.3-ratio figures reconcile: 1.3× on a ~17 IV is ~3.9 points.
The "9%" figure does not reconcile with either. [inference] Treat 4 points /
1.3× as the SPX anchor and discard the 9% as a different, unstated horizon.

**Why it persists** — four independent structural reasons, `variance-risk-premium`:

1. Insurance demand from funds hedging equity books.
2. Speculative / FOMO call buying by retail.
3. Jump protection that dynamic hedging cannot replicate.
4. Retail brokers prohibiting naked shorts, which restricts supply.

> "Each of these factors individually justifies the VRP, and it is unlikely that
> all these factors will disappear simultaneously."

**What you are actually selling.** Not a structure. A service.

> "We don't get paid because of the structure that we trade. We get paid for
> providing value to the market." — `option-selling-strategies`

> "Insurance providers get paid." — `how-to-make-money-selling-options`

> "One man's theta is another man's gamma." — `what-is-gamma-options`

Theta is not free money. Theta is the rent buyers pay you for convexity, and it
is proportional to the gamma you carry (`what-is-theta-options`). Any engine
that ranks on theta without normalising by the gamma sold will simply pick the
most dangerous front expiry available. [inference on the "will simply pick" —
the author states the proportionality, not the ranking failure mode.]

**Who pays it.** `who-trades-options` splits the flow four ways: funds hedging
(price-insensitive), retail chasing leverage (price-insensitive), sophisticated
desks (assume they know more than you), market makers (delta-neutral liquidity,
not adversaries). The rule:

> "Every time that you place a trade, ask yourself: Who is on the other side and
> why are they trading with me?"

And from `expected-value-trading`: edge exists where "other persons motivations
for 'playing' with us are not directly monetary."

**The honest caveat, in his own words.** US equity index options are the
saturated market:

> "Trying to gain an edge through publicly available data is nearly impossible
> since all other investors also have that information." — `the-business-of-trading`

That article names commodities, lesser-known ETFs and single stocks as the
better ponds and US index options as the worst. [inference] So an SPX-only
engine should expect thin, structural, high-frequency edge — Sharpe 0.5–1.0
territory, small size, many repetitions — not dislocations. That expectation
should be built into the ranking thresholds rather than discovered later.

**Two return sources, two validation bars** (`how-to-learn-trading`):

- Risk-premium harvesting → prove the premium persisted and was monetizable.
- Inefficiency → prove it on a large sample.

A calendar is both, depending on why it ranks. That matters for how much
history you demand before trusting a score. [inference]

**The measurement stance.** This is the single most useful methodological line
in the corpus for a deterministic engine:

> "there is plenty of cash on the table for simply being able to measure the
> present accurately." —
> `finding-expensive-options-to-sell-calculating-the-variance-risk-premium-in-2024`

Volatility is stationary and mean-reverting, so you do not need to forecast it.
You need to measure it. That is what licenses a backward-looking, deterministic,
no-ML engine.

---

## 2. The metric catalogue

Each subsection: definition, what it measures, what "good" is, how he uses it,
and whether it is computable from a chain snapshot plus price history.

### 2.1 Variance Risk Premium (VRP)

**Definition** (`variance-risk-premium`, `trading-methodology-update-new-metrics-for-finding-inflated-option-premiums`):

```
VRP(t) = IV30d(t) − RV30d(t → t+30)
```

One observation per day. The horizons must MATCH — 30-day implied against the
30 days that actually followed. Repeat daily over **4 years** of history.

Derived family, all from `trading-methodology-update…` and `variance-risk-premium`:

```
Avg VRP        = mean(VRP)         over 4 years
VRP MovingAvg  = mean(VRP)         over last 10 days
VRP Win Rate   = share of days where VRP > 0
```

**Measures.** Whether this instrument's options are structurally overpriced, how
much, and how reliably.

**Good.** Positive. SPX baseline: 4 points, 85% win rate, ratio 1.3.

**How he uses it.** Five gating questions, verbatim from
`trading-methodology-update…`:

1. Is there a risk premium present in this asset, and how big is it?
2. Is the risk premium present currently?
3. Is the risk premium persistent over extended periods of time for us to monetize?
4. Is volatility behaving in a normal range, or are we in a period of extreme volatility?
5. Have options been liquid enough for this ticker for us to have reliable data?

Rendered green/red. Green = yes. Baseline trade the metrics support: "selling 30
DTE, at the money volatility on the ETFs with the richest variance risk premium."

**Computable?** Yes, from price history plus a 4-year IV30 history. The
subsequent-RV term means the newest 30 days of the series are always
unresolved — the metric is right-censored by construction. [inference] For a
calendar the horizon-matching rule forces a **per-tenor** VRP: VRP_front at the
front's DTE, VRP_back at the back's DTE. He never spells that out; it follows
directly from his own matching rule.

### 2.2 Implied vs Realized Volatility

**Definition.** `implied-vs-realized-volatility`: IV is "the market's forecast of
how much a stock is expected to move over a certain period in the future… a
predictive measure." RV is "the actual movement of the stock over a specified
period. It is retrospective."

Estimators he names (`the-option-traders-guide-to-volatility-trading`):

- **Close-to-Close** — stdev of daily returns over a window. Windows referenced: 10d through 200d.
- **Yang Zhang** — OHLC-based, "overcomes bias due to discrete sampling by accounting for the opening jumps," handles trend, needs fewer data points. Formula not given.
- **GARCH** — "a weighted average between realized volatility and the long-term mean." Coefficients not given.

**Decision rule.** Stated as an inequality, never with a threshold:

```
LONG vol  iff IV < E[RV]
SHORT vol iff IV > E[RV]
```

**Good.** IV materially above forecast RV for the leg you sell.

**How he uses it.** As the entire objective function. Restated in a dozen
articles. `implied-volatility-explained`: "options are volatility products";
professionals quote in IV, not dollars.

**Computable?** Yes. Close-to-Close is trivial; Yang Zhang needs OHLC; GARCH
needs a fit. The forward-looking E[RV] is a modelling choice the corpus leaves
open — see §2.3 for his own blending recipe.

### 2.3 Fair-Value Volatility (the blended forecast)

Not named as a metric, but it is the most-used construct in the case studies. He
never trusts one estimate. He **averages independent estimates** and prices
against the average.

| Case | Inputs | Blend | Slug |
|---|---|---|---|
| COP | PA 23.99, RV×1.1 = 30.52, RV×1.02 = 27.75 | **27.4%** | `cop-trade-analysis-temporarily-expensive-options` |
| BABA | PA 31.32, RV30 35.63, RV×IV/RV 39.68, JD-relative 41.8 | **37.1%** | `earnings-is-over-baba-case-study` |
| EWT | PA 12.73, RV30 11.34, IV÷1.5 = 11.21 | **11.76%** | `ewt-trade-analysis-foreign-vrp` |
| TSM | PA 22.69, RV30 25.03, IV÷1.06 = 25.9 | **24.54%** | `expensive-options-case-study-tsm` |
| GLD | PA 10.8, hist avg IV 17, peer-adjusted 14.5 | **14.1%** | `gld-trade-analysis-expensive-risk-premiums` |
| SLG | PA 54.75, RV30 65.99, avg IV/RV-adj 83.58, own IV/RV-adj 78.03 | **70%** | `slg` |
| KWEB | PA 27.28, RV×ratio 31.6 | (uses 31.6) | `expensive-kweb-options-trading-case-study` |

Recurring ingredients, three of which are computable without his proprietary model:

```
RV30                                   — trailing realized
RV30 × historical IV/RV ratio          — turns realized into an implied-comparable
IV ÷ historical IV/RV ratio            — strips the structural premium off implied
historical average IV at this tenor    — the mean-reversion anchor
peer-implied fair IV (see §2.9)        — cross-sectional
```

**Good.** Market IV above the blend by ≥ 3 vol points is his working bar
(TSM: "volatility spread ~3 percentage points", `expensive-options-case-study-tsm`;
EXPE/ETSY: 6 points, `post-earnings-trade-analysis-expe-etsy`).

**How he uses it.** Reprice the structure at the blend. Edge = market − fair.
Then normalise by margin.

> "Fair value at 37.1% vol: $7.14" against market "$8.20" — `earnings-is-over-baba-case-study`

**Computable?** Yes minus the PA proprietary forecast. Drop that term and average
the rest. [inference] Losing one of three or four inputs shifts the blend but
does not break the method.

### 2.4 IV/RV Ratio, and Premium Deviation

**Definition.** `option-trading-masterclass`, `expensive-kweb-options-trading-case-study`:

```
IV/RV ratio  = IV / RV                  ("stationary & mean reverting")
Premium %    = (IV − RV) / RV
Premium dev  = current Premium% − that instrument's average Premium%
```

**Rule.** "When the IV/RV ratio is greater than 1, options are expensive, and
there is a risk premium." — `expensive-kweb-options-trading-case-study`

**The important refinement.** Level is not signal; DEVIATION is. KWEB's premium
was 38.4% against a 14% average — 21 points above mean — while peer FXI sat only
9 points above its own 24.5% average. That gap between the two deviations is the
mispricing.

Published ratios: COP 1.02 / HES 0.98; BABA 1.075; EWT 1.5; TSM 1.06; KWEB 1.24
normalised, 1.38 current; SLG 1.02; SPX ≈ 1.3.

**Good.** Ratio above the instrument's own historical ratio, and above a
correlated peer's deviation.

**How he uses it.** Both as a screen (`> 1.1` filter,
`post-earnings-trade-analysis-expe-etsy`) and as the de-premiuming divisor in
the fair-value blend.

> "Implied volatility tends to be just a tad higher than realized, though,
> because of the variance risk premium." — `expensive-options-case-study-tsm`

That sentence is the whole reason the divisor exists. Comparing raw IV to raw RV
makes everything look rich.

**Computable?** Yes. Needs an IV history per tenor to get the "own average".

### 2.5 IV Rank / IV Percentile — and the author's attack on it

**Definition.** `variance-risk-premium`: IV Percentile = rank of current IV
against the past **12 months**.

**He publishes thresholds for it and then argues against the metric.** Both facts
must be encoded.

Thresholds:

| Use | Threshold | Slug |
|---|---|---|
| Selection filter for short-vol program | IV Percentile **< 80** | `profitable-option-selling-strategy` |
| "Most Inflated Premiums" scan | IV percentile **> 65%** for all expiries | `trade-nine-out-of-the-box-option-premium-strategies-using-the-predicting-alpha-terminal` |
| "Distressed Volatility" scan | entire term structure **> 70th percentile** | `how-to-find-profitable-option-trades-by-building-custom-volatility-scanners` |
| Distressed-vol vega trade entry | IV rank **> 80** across entire term structure | `option-volatility-trading` |
| Kill switch on selling vol | VIX at **80th percentile** | `iv-rank` |
| Short-straddle stop | IV at its **1-year high** | `what-is-a-short-straddle` |
| Back-ratio exit | IV **> 80th percentile** | `back-ratio-spread` |

The attack, two places:

> "our perception of where implied volatility should be is skewed" … "As a % of
> the implied volatility, the variance risk premium is on average the same
> regardless of the level of implied volatility." — `iv-rank`

> "[IV Rank or Percentile] measure IV relative to its historical implied
> volatility, but it doesn't tell us whether it's too high or too low." — `wheel`

**Reconciliation.** [inference] IV percentile is a **regime gate**, never an edge
term. The 65–80 window is the usable band: above 65 for richness, below 80 to
avoid variance spikes. Above 80 across the whole curve you are in the distressed
regime, where his own prescription flips to short vega — which is the opposite
of buying a calendar's back leg.

**Computable?** Yes, from 12 months of IV30 history.

### 2.6 Forward Volatility

The core of the engine. Two articles do the work.

**Definition.** He never writes the symbols. He demonstrates the arithmetic. The
identity his numbers satisfy is variance additivity:

```
σ_fwd = sqrt( (σ₂²·T₂ − σ₁²·T₁) / (T₂ − T₁) )
```

Verification against his own printed examples:

| Example | Inputs | His answer | Formula gives | Slug |
|---|---|---|---|---|
| Toy | week 1 = 50%, month = 30% | weeks 2–4 = **19%** | 19.5% | `kre-a-case-study-in-forward-volatility` |
| Live KRE | 11 DTE 105%, 39 DTE 72% | fwd = **55%** | 53.8% | same |
| Calendar article | 30d 40%, 90d 35% | 30/90 fwd = **32%** | 32.2% | `calendar-spread-strategy` |

Three independent checks. The formula is right. Residual 1–2% gaps are day-count
convention. [inference on the convention attribution.]

**Measures.** The volatility the term structure implies for the period BETWEEN
the two expiries. It is the price you actually pay or receive on a calendar.

> "When trading a calendar spread, you are essentially expressing a view on
> forward volatility." — `calendar-spread-strategy`

**Good.** For a long calendar: forward vol LOW relative to what the back leg's
IV will be. The loss condition is explicit:

> "My calendar spread would only lose money if implied volatility for the long
> option fell to 55%, a drop of nearly 20 points." — `kre-a-case-study-in-forward-volatility`

So the cushion is a directly codeable number:

```
cushion (vol points) = IV_back − σ_fwd        # KRE: 72 − 55 = 17
```

**The empirical justification, credited to Prof. Jim Campasano:**

> "forward volatility is a terrible indicator of future implied volatility" …
> "calendar spreads profit unless the long-term option experiences an extreme
> amount of IV Crush" — `kre-a-case-study-in-forward-volatility`

That is the asymmetry. Forward vol is a biased forecast; the back leg's IV rarely
collapses all the way down to it.

**Computable?** Yes. Two IVs and two DTEs. Nothing else.

### 2.7 Forward Factor

His named ranking metric for calendars, and the only place he publishes an entry
threshold.

**Definition — he refuses to give it:**

> "You can measure backwardation in several different ways, but the paper uses a
> ratio of implied and forward volatility. I use a tool that helps me calculate
> this ratio as a 'Forward Factor'." — `kre-is-it-crashing-yet-calendar-trade-analysis`

**Reverse-engineered [inference]:**

```
FF = IV_front / σ_fwd − 1
```

Check against his one fully-numbered case: May 19 $36 puts at 80% IV, June 16
$36 puts at 64% IV, stated FF = **49%**. With entry ~May 4–6 (front ≈ 14 DTE,
back ≈ 42 DTE), σ_fwd ≈ 54.3%, so 80/54.3 − 1 = **47.4%**. With front 16 / back
44: 51.7%. The stated 49% sits inside that window. The alternative readings
(IV_front/IV_back − 1 = 25%; IV_back/σ_fwd − 1 = 18%) do not fit. Take the
inference, flag it, and make it swappable in code.

**Thresholds — and they conflict:**

| Gate | Value | Slug |
|---|---|---|
| "I generally consider trades with a Forward Factor of **20%** to be worth taking" | 20% | `kre-is-it-crashing-yet-calendar-trade-analysis` |
| "forward factor greater than **16%**" | 16% | `trade-nine-out-of-the-box-option-premium-strategies-…` |
| Buy when the forward-factor tracker is **above the upper bound** of its 1-year band | relative | `five-pre-built-option-strategy-scanners-that-profit-from-volatility-inefficiencies` |

**This is the single most important tension in the whole corpus for an SPX
engine.** [inference, and it is load-bearing:]

FF = IV_front/σ_fwd − 1 is positive only in **backwardation**. In contango
(IV_front < IV_back), σ_fwd > IV_back > IV_front, so FF < 0 always. SPX sits in
contango most of the time. Combine that with the trader's front ≥ 15 DTE and
gap ≥ 15 days — which excludes exactly the 0–7 DTE window where SPX front IV
spikes hardest — and an absolute FF ≥ 16% gate will fire almost never, and only
in panics.

The reconciliation is his own third gate: the **percentile band**. Rank FF
against its own trailing one-year distribution and trade the upper bound, not an
absolute 16%. That version works in contango. Encode the percentile band as the
primary gate and keep the absolute 16%/20% as a separate "quasi-arbitrage"
conviction tier (see §2.15 and the two-tier idea in `option-trading-psychology`).

**Computable?** FF yes. The one-year band needs a year of daily term-structure
history per expiry pair — or per DTE bucket, which is the practical form.
[inference on the bucketing.]

### 2.8 Term Structure (contango / backwardation)

**Definition.** `term-structure-options`: "a way for us to visualize how implied
volatility changes across time" — ATM IV plotted per expiration. One of the two
components of the volatility surface; skew is the other.

```
CONTANGO        short-DTE IV < long-DTE IV     normal / low-vol regime
BACKWARDATION   short-DTE IV > long-DTE IV     high-vol regime
```

The mechanism, from `volatility-mean-reversion`: contango because vol is
expected to revert UP toward its mean; backwardation because the current spike
is expected to decay DOWN.

**Local spikes locate events.** This is the part an engine must not skip:

> "almost 35% of the implied volatility is entirely due to the earnings event"
> — `term-structure-options`

An expiry that straddles a catalyst prices it in. An expiry ending before it does
not. Far expiries dilute it across many non-event days. So elevated IV in one
expiry is not automatically richness — it may be correctly-priced event premium.

**Horizon rule, verbatim:** shorter DTE for implied-vs-realized trades, longer DTE
for trading changes in the LEVEL of implied volatility.

DTE anchors present in that article: 10, 30, 365. SPX/SPY reference: 10 DTE near
15% IV in the low-vol example; 1-year near the ~15% historical mean.

**Slope as a metric.** `how-to-find-profitable-option-trades-by-building-custom-volatility-scanners`
lists the author's own calendar filter family: "forward volatility and term
structure slope data points" — specifically "1 day forward moves, forward factors
for different expirations, slopes between different expirations and slope
percentiles."

**Good.** For a long calendar: front rich relative to back, i.e. flat-to-inverted
slope, or a slope percentile at the low end of its own history.

**Computable?** Yes. This is the cheapest metric in the catalogue.

### 2.9 Relative Value (cross-sectional)

**Definition.** `option-trading-masterclass` gives the only worked algebra:

```
fair IV(A) = historical_IV_ratio(A/B) × current IV(B)
richness   = actual IV(A) / fair IV(A) − 1
```

DISCA/FOXA during Archegos forced selling: correlation 80% over the prior year,
historical DISCA/FOXA IV ratio 1.2×, FOXA IV 48% → fair DISCA IV ≈ 58%, actual
83%, so DISCA was **~43% richer than justified**.

**Correlation bar for a peer to be admissible:**

| Pair | Correlation | Slug |
|---|---|---|
| BABA / JD | **> 70%** | `earnings-is-over-baba-case-study` |
| SLG / IYR | **> 70%** | `slg` |
| EWT / SMH | **~73%** (normally ~80%) | `ewt-trade-analysis-foreign-vrp` |
| DISCA / FOXA | **80%** | `option-trading-masterclass` |

Refinement from `iv-rank`: use the most correlated major ETF as benchmark, and
"Multiply the beta by the benchmark vol to get a more accurate fair value."

**How he uses it.** Always as a CONFIRM, never as the primary signal. Absolute
valuation finds the candidate; relative value proves it is idiosyncratic rather
than sector-wide. COP 1.02 vs HES 0.98. GLD "chronically higher" than GDX. KWEB
21 points above mean vs FXI's 9.

**Computable?** Yes, but SPX is the benchmark, so the machinery is largely inert
for SPX-vs-peer. [inference] The transferable move is to run relative value along
the **expiry axis instead of the peer axis** — which is exactly what a calendar
is. `option-trading-masterclass` licenses this: the method is peer-agnostic,
and `the-option-traders-guide-to-volatility-trading` says relative value is
compared "across different strikes and expirations."

### 2.10 Volatility Skew

**Definition.** `options-skew`: "difference in implied volatility between
out-of-the-money (OTM) puts and calls." Cause: returns are not normal.

> "stocks go up like an escalator and down like an elevator"

> "While the S&P 500 might move up 57% of the time, the down moves, though less
> frequent, are often larger." — `options-skew`

Distribution ordering for negatively-skewed equity returns: mode > median > mean.

**His illustrative SPX numbers** (`options-skew`): SPX at 4000 — 3800 put 25% IV,
4000 ATM 20%, 4200 call 15%. That is 10 vol points across ±5% of spot, ~2.5 vol
points per 100 SPX points.

⚠️ [inference] **Do not calibrate on this.** 5 vol points over 5% of spot is far
steeper than real SPX skew. It is a teaching example. Measure skew from the live
chain.

**Skew as a ratio.** `professional-trade-breakdown-soybean-meal-skew-trade` gives
the codeable per-strike form:

```
skew ratio(K) = IV(K) / IV(ATM)
```

with 1.3× flagged as mispriced there, and a structural law:

> "skew flattens as expiration approaches, it does not flip"

**Shapes and what they claim** (`volatility-skew`):

- Put skew → "risk is to the downside and the most likely move is to the upside." Standard equity shape.
- Call skew → "risk is to the upside and the most likely move is to the downside." Usually retail call demand.
- Flat → "equal chance of an up move and a down move."
- Smile → binary event (trial result, regulatory decision).

**How he uses it.** To find where he disagrees with the priced distribution, and
to pick which leg of a vertical to sell:

> "the implied volatility of the further out-the-money strike call will be higher
> than the implied volatility of the call that is closer to the money" …
> "Trading vertical spreads into the skew creates good risk reward scenarios."
> — `vertical-spread-options`

**Critical warning for a calendar** [inference, built on `options-skew` +
`what-does-delta-mean-in-options`]: because IV varies by strike, comparing the
front and back leg at the same fixed strike contaminates the term-structure
reading with skew — the two expiries' 50-delta strikes are not the same strike.
Sample the surface **by delta (50d) or by fixed moneyness**, not by raw strike.
The author never says this. It follows from his own two facts.

**Computable?** Yes, from one chain snapshot.

### 2.11 Spot-Vol Correlation

**Definition.** `spot-vol-correlation`: the sign of the co-movement between spot
and IV. Ticker-specific, measurable, unstable.

- SPY / indices: **negative**. Spot down → IV up.
- GME / upside-speculation names: **positive**.

**The one number:** S&P 500 down 2% → IV rises by approximately **15.6%**
(`spot-vol-correlation`). ⚠️ Ambiguous: 15.6 relative percent or 15.6 vol points.
The article does not say. [inference] Read as relative — 15.6 points on a ~17 IV
would be a doubling, which does not happen on a 2% down day.

**The doctrine.** Every vol trade carries an "implicit directional view":

> "Understanding spot and IV correlation is vital for structuring trades."

> "Equities have a negative 'spot/vol correlation': volatility increases when the
> spot price (stock price) falls." — `wheel`

And the trap for off-ATM puts, same article:

> "OTM puts will get shorter vega as the stock falls and implied volatility
> increases, hurting your position."

**Re-measure it, do not assume it:**

> "The trade that we placed today may not be done the same way next month if the
> correlation is significantly different." — `spot-vol-correlation`

**Why it matters for a calendar** [inference from the TGT case study
`earnings-disasters-tgt-trade-analysis` plus `spot-vol-correlation`]: on SPX a
selloff lifts front IV far more than back IV — backwardation — which is the short
front leg's loss mode and the calendar's main enemy. The TGT trade's answer was
to carry a deliberate short-delta tilt (5 short shares per straddle) rather than
a flat hedge, because short stock hedges delta and vega simultaneously when
correlation is negative. That conflicts with the trader's flat delta-neutral
mandate; note it and defer to the trader.

**Computable?** Yes. Regress daily ΔIV30 on daily spot returns. Needs a rolling
window the corpus does not specify.

### 2.12 Volatility Mean Reversion, Stationarity, Clustering

Three properties, from `option-iv-explained` and `volatility-mean-reversion`:

- **Mean-reverting** — "it oscillates around an average value. For the VIX, this average is around **14**."
- **Stationary** — "The VIX fluctuates between **9 and 80** over a 30-year period."
- **Clustering** — "it tends to stay high when it's high and low when it's low."

Contrast: stocks are non-stationary and trending.

**The method, verbatim:**

> "We take the characteristics that we understand about volatility, assume they
> should continue to persist, and then leverage them to make informed decisions."
> — `option-iv-explained`

**The self-imposed caveat.** `volatility-mean-reversion` states the naive rule
(buy below the mean, sell above) and immediately calls it an oversimplification.
Mean reversion is a forecast input, not a trade trigger.

**How it maps onto the two legs** [inference, but tightly implied by
`the-option-traders-guide-to-volatility-trading`'s clustering/mean-reversion
split]: the front leg's RV forecast should be clustering-driven (recent realized,
short window); the back leg's should be mean-reversion-driven (long-run average).
That is exactly the shape of the term structure a calendar trades against.

**Computable?** Yes. No half-life, window or decay constant is published. That
number is yours to choose.

### 2.13 Expected Move

Three forms, all his:

```
Expected move (to expiry) = ATM straddle price / spot
                            $5 call + $5 put on a $100 stock = "10% up or down"
                            — what-is-implied-volatility

Daily implied move        = IV_annual / √252
                            33.88% / 15.87 = 2.13% ≈ his stated 2.11%
                            — cop-trade-analysis-temporarily-expensive-options

Rule of thumb             = daily move % × 16 ≈ annualized IV %
                            1% → 16%; 2% → 32%
                            — implied-volatility-over-time
```

**Good.** Daily implied move meaningfully above the average daily realized move.
His printed pairs:

| Ticker | Implied daily | Realized daily | Slug |
|---|---|---|---|
| COP | 2.11% | 1.73% | `cop-trade-analysis-…` |
| KWEB | 2.6% | 1.7% | `expensive-kweb-options-…` |
| GLD | 1.09% | 0.8% | `gld-trade-analysis-…` |

**Secondary use — a ruler for distance.** The straddle price is his unit of
strike distance (`option-wings`, `how-to-trade-iron-condors`, `what-is-an-iron-butterfly`).
See §6 for the 1x / 2x / 3x figures.

**Computable?** Yes, from one snapshot.

### 2.14 Expected Value

**Definition.** `expected-value-trading`:

```
EV = (P_win × amount won) − (P_lose × amount lost)
```

Roulette: (0.52 × $10) − (0.48 × $10) = $0.40 per game.

**The caveat that matters for engineering**, same article: options produce
distributions, not binary outcomes, so exact win/lose probabilities are
impractical — you use a pricing model instead. So the operational form is:

```
EV = price(structure at market IV) − price(structure at forecast vol)
```

`how-to-think-like-a-professional-trader` states it as flatly as possible:

> "EV = Market Price − Fair Value" … "Is this option really worth $5?"

And the framing that governs everything:

> "If I make this decision over and over again into the future, do I make money
> on average?" — `expected-value-trading`

> "Most edges that are available to us are small, but persistent" — same

**Structure does not change EV.** `should-you-sell-straddles-or-strangles-…`:
"All else held equal, your EV should be the same." Straddle ~60% win at 1:1 vs
strangle ~80% win at 1:0.5 — same EV, different path
(`straddle-vs-strangle-options`).

⚠️ Direct consequence: **do not rank on probability of profit.** Two structures
with wildly different win rates carry identical edge. Rank on edge.

**Computable?** Yes.

### 2.15 Conviction tiering

Not a metric, but he insists the output is not a flat list.

> "Most of the time, play tight to the vest… When you find an edge, an
> arbitrage, or a quasi-arbitrage, pile it on." — `option-trading-psychology`

Arbitrage = risk-free price discrepancy. Quasi-arbitrage = high-probability,
minimal-risk. And: "arbitrage goes away, which it always does" — do not wait for
a better entry.

Same instruction from `what-i-learned-from-citadels-training-software`: "When
there is an arbitrage (an edge with nearly no risk), we must trade as much as
possible before it's gone." And from
`the-options-traders-guide-to-evaluating-trades`: size small for ordinary beta
edges, "as big as you can" for rare large alpha.

[inference] The engine should emit **score + conviction bucket**, and size as a
function of the bucket. Not one number.

### 2.16 The Greeks, as he frames them

His explicit ranking (`the-option-traders-comprehensive-guide-to-the-greeks`):
short-term vol trades live on **gamma + theta**; long-term vol trades live on
**vega + rho**; **delta is the least important** because it is trivially hedged.

**Delta.** `what-does-delta-mean-in-options`: sensitivity of option price to $1
of underlying. Position delta = Δ × contracts × 100 (`delta-hedging`). Identities
he gives:

```
|Δ_call| + |Δ_put| = 1        at a given strike
Δ_call − Δ_put     = 1.00     long call + short put = 100 shares
short call + 100 shares = long put
```

Explicitly NOT the probability of finishing ITM — that is N(d2)
(`the-option-traders-comprehensive-guide-to-the-greeks`).

**Gamma.** `what-is-gamma-options`: Γ = dΔ/dS. Maximum ATM. **Rises as expiration
approaches.** "One man's theta is another man's gamma." Retail buyers' demand for
that convexity is "the reason that the variance risk premium exists."
Warning: "30 Delta weekly options can become 50 or 80 Delta after a small move."

**Theta.** `what-is-theta-options`: Θ = dV/dt per day. The non-obvious rule — read
it as a **percentage of remaining extrinsic value**, not as dollars:

| DTE | Θ as % of extrinsic / day |
|---|---|
| 30 | ~3% |
| 10 | ~10% |
| last day | 100% |

And "The amount of theta you collect is directly proportional to the amount of
gamma exposure you carry." Plus the scaling law, `understanding-greeks-options`:
theta decay is "proportional to the square root of the time remaining", so
Θ/day ∝ 1/√T.

**Vega.** `what-is-vega-options`: V = dV/dσ per vol point. Maximum ATM.
**Increases with time to expiration** — the opposite direction to gamma and theta.
His canonical max-vega/min-gamma expression: "Sell an at-the-money 180 DTE
straddle."

**Rho.** Only material on LEAPS.

**Why this is the calendar's whole rationale.** Every greek's term-profile puts
the two legs on opposite sides:

| | Front (short) | Back (long) |
|---|---|---|
| Gamma | large, rising into expiry | small |
| Theta | steep, ∝ 1/√T | shallow |
| Vega | small | large, ∝ √T |

Net: **short gamma, long theta, nominally long vega** — and §4 explains why the
long-vega label is a trap.

**Computable?** Yes, from a BSM implementation. `black-scholes-model-explained`
fixes the bidirectional contract: invert quotes → IV per expiry; reprice at
forecast vol → fair value. `backtest-option-selling-strategies-…` fixes the
inputs: **r = 5%, q = 0%**, strike = the underlying, IV = interpolated 30-day.

### 2.17 Liquidity and Illiquidity tests

He gives no single threshold. He gives four different ones, plus an argument that
thresholds are the wrong tool.

**The argument** (`illiquid-options`):

> "In highly liquid markets like QQQ, SPY, or AAPL, the midpoint is a useful
> indicator because the market is competitive… However, in illiquid markets, the
> midpoint is meaningless."

His own failure: intended to sell at 50% IV, filled at 40% against a 32% RV
baseline. "Because I was too aggressive with my order, I actually sold at a 40%
IV instead of the intended 50% IV." A 10-vol slip ate the edge. The prescribed
method is to Black-Scholes a target IV into a limit price and work the order.

**The thresholds he does publish:**

| Test | Threshold | Slug |
|---|---|---|
| bid/ask as % of max receivable premium | 22% acceptable (FXI), 58% not (ASHR); 15× volume difference | `profitable-option-selling-strategy` |
| Median option volume | **5,000+ contracts/day** preferred | `variance-risk-premium` |
| Average option volume | **> 3,000 daily contracts** | `post-earnings-trade-analysis-expe-etsy` |
| Universe floor | **> 100 options traded daily** | `update-top-trades-pick-for-you-on-our-new-home-page-more` |
| Single-name reject | spreads exceeding **$5–$10** | `earnings-strategy-profit` |
| Retail weeklies, the rake | bid-ask **12% or more** | `winning-at-options-trading-what-poker-can-teach-you` |
| Price floor | stock above **$15** | `post-earnings-trade-analysis-expe-etsy` |

**SPX specifically** (`the-option-traders-guide-to-the-variance-risk-premium`):
SPX average daily options volume 94.4 million contracts (2015), vs EuroStoxx50
11.8 million; SPY put and call daily volumes "very rarely below 2M each."
Execution is not a binding constraint on the index.

**Good.** Rank on transactable prices — bid on what you sell, ask on what you
buy. [inference, but forced by `illiquid-options`: a calendar pays two spreads,
so mid-based edge is doubly unreliable.] The 12%-spread figure is the hard number
that belongs in code as a cost gate.

**Computable?** Yes, from the snapshot.

### 2.18 Kelly Sizing

**Definition.** `kelly-criterion-trading`:

```
f* = (b·p − q) / b
```

b = net odds, p = win probability, q = 1 − p.

Worked: casino 60% at 1.2× → 26.7% of bankroll. Iron butterfly $500 win /
$1,000 loss at 68% win rate → b = 0.5, f* = (0.5×0.68 − 0.32)/0.5 = **4%**.

**The asymmetry that is the whole point:**

> "while it can be 'ok' to bet less than kelly, it is not ok to bet more than
> kelly."

Three haircuts to full Kelly: risk tolerance, market conditions, diversification.
Tail motivator cited: a five standard deviation move in CRM earnings.

**Computable?** The formula yes; p and b for a calendar require a distribution,
which requires either a backtest or a simulation. [inference] For a debit
calendar b = expected exit credit / debit, and the loss branch is total — the KRE
articles say calendars "can go to 0". So use fractional Kelly, never full, and
treat correlated adjacent-expiry SPX calendars as ONE bet for the
diversification haircut.

### 2.19 Autocorrelation

**Definition.** `option-price-prediction`: "measures the relationship between a
variable's current value and its past values" — "how today's return is a
predictor of tomorrow's return."

- Positive → trending. 1% up today implies a similar up move tomorrow. Pushes spot through short-straddle breakevens. **Avoid short vol.**
- Negative → mean-reverting. "back-and-forth movement." Spot stays "within the break-even of our short straddles or short strangles." Cheap to hedge. **Sellers want this.**

No lag length, no coefficient threshold, no formula. Nothing.

**Computable?** Trivially (lag-1 rho of returns). Every parameter is yours.

### 2.20 Implied Volatility as "synthetic time"

The most underrated construct in the corpus for a calendar engine.

> "increasing time or increasing volatility has the same impact on the value of
> an option" — `implied-volatility-over-time`

> "When we double the volatility, the time to realize the same range is cut in
> half"

Consequence he states explicitly: **theta is not distributed evenly across
calendar days.** With a 12% implied move concentrated on one earnings date 30
days out, the whole chain behaves as if it were longer-dated — small daily P&L,
muted sensitivity — until the event passes and IV crashes.

[inference] An SPX calendar straddling a CPI / FOMC / OPEX day needs
**event-weighted time**, not calendar DTE, when computing expected front decay.
Reading raw theta off a flat-vol model over an event window overstates the carry.

### 2.21 Event Volatility decomposition

`calculating-implied-volatility` (which actually serves "The Three Circles of
Volatility") and `what-is-implied-volatility`:

```
σ_total² ≈ σ_market² + σ_nonEvent² + σ_event²
```

The decomposition is qualitative in the article; the symbols above are
[inference]. His one number: event volatility "can account for **30% to 70%** of
a stock's annual movement."

Three circles: market volatility (macro, systematic, "the rising tide lifts all
ships"), non-event volatility ("regular day-to-day movements… driven by the
fundamentals of the company"), event volatility (earnings, product launches, drug
approvals).

**For SPX** [inference]: there is essentially no single-name event circle. SPX is
almost pure market volatility. So the event-isolation play is weaker, and the
term structure's non-root deviations come from **macro dates** — CPI, FOMC, OPEX,
quarterly roll — plus structural flow. That is where an SPX calendar engine
should look. The author never discusses SPX macro dates.

---

## 3. How the author evaluates a trade

Four articles give a checklist. They agree on the order.

### 3.1 The four-stage pipeline — `the-options-traders-guide-to-evaluating-trades`

1. **Find the mispricing.** Either model-driven (your vol forecast says the option is far from fair value) or event-driven (earnings, Fed).
2. **Due diligence.** Implied and historical volatility data — is current IV high relative to prior levels? Current news — does an event explain the IV level? Sentiment data — is retail enthusiasm bidding it up? (StockTwits named.)
3. **Trade structure.** Choose the structure that pays off best if the forecast is right, and strip the unintended exposure — short AAPL vol is also short market vol, so buy an SPY straddle against it "so the position captures only the RELATIVE mispricing."
4. **Position management.** Size proportional to edge. Exit on convergence or on the event passing.

Exits, verbatim:

> "Size your trades according to how large your edge is. When your edge
> disappears (either from your forecast becoming true or realizing your forecast
> is wrong), close your trades."

- Profit exit, model-driven: "when the market value of our options has converged with our estimate of fair value."
- Profit exit, event-driven: after the event. Holding afterwards has no positive expected value.
- Loss exit: greater volatility than expected for several days in a row, or discovery of information that negates the positive EV.

### 3.2 The four-part admission gate — `option-selling-strategy` (Sean Ryan)

A strategy is tradeable only when all four exist:

1. A thesis for WHY it should work.
2. Historical testing to validate it.
3. Positive expected value over the long run.
4. A risk-management system that bounds losses.

> "A strategy is a reproducible idea that you can bet on consistently."

One-off dislocations (USO, March 2020) are disqualified as strategies.

### 3.3 The five green/red questions — `trading-methodology-update-new-metrics-for-finding-inflated-option-premiums`

Reproduced verbatim in §2.1. Premium exists → premium is present now → premium
is persistent → volatility regime is normal → data is trustworthy.

### 3.4 The case-study pipeline — `slg`, `earnings-is-over-baba-case-study`, `expensive-options-case-study-tsm`, `ewt-trade-analysis-foreign-vrp`, `gld-trade-analysis-…`, `cop-trade-analysis-…`

Six steps, identical in every case study:

1. **Forecast what will be realized.** Blend 3–4 independent vol estimates (§2.3).
2. **Price the structure at the blend.** Edge = market − fair, in dollars per contract.
3. **Cross-sectional confirm.** Compare IV/RV against a >70%-correlated peer. If the peer is equally rich, it is sector-wide, not mispricing.
4. **Normalise by margin.** Return = edge ÷ margin, over the actual holding period.
5. **Stress test.** SLG: 30% spot move plus 30 vol points, simultaneously, must lose < $500. EWT: 10% spot move → < $260. GLD/KWEB: 1.5× straddle-price move as the max-loss threshold. BABA: 10% spot → −$400.
6. **Haircut, then accept.** EXPE/ETSY: halve the edge (6 pts → 3 pts) and inflate assumed margin ($4,400 → $6,000) before believing the return.

The accept bar across all case studies: **0.67% to 3.5% on margin** over
10–37 days. Small. He says so:

> "Trade them small, find many trades, and reap those sweet, sweet premiums."
> — `post-earnings-trade-analysis-expe-etsy`

> "Trade it small; find many similar trades to spread your risk" — `slg`

### 3.5 The continuous re-entry test — `traders-mindset`

> "If I did not have a trade on right now, would I enter into the position I
> have?"

If no, exit immediately. [inference] This makes the ranking function do double
duty: re-score every open calendar every day with the entry criterion. Below the
entry bar → close.

### 3.6 The research veto — `trading-research`

> "If IV is high, find out why. Is there insider trading? Is there a significant
> event on the horizon?"

> "Tradable information provides an edge because it offers insights that are not
> already priced into the market."

Information already priced in is non-tradable. A rich front expiry that is rich
BECAUSE of a scheduled event inside it is not edge — it is correctly priced.
`sell-options-with-context-…` makes the same point as a product feature: attach
the news, understand the cause, then structure.

---

## 4. The calendar spread specifically

### 4.1 Definition and direction

Every article agrees:

> "purchasing longer-dated options while simultaneously selling shorter-dated
> ones" — `the-comprehensive-guide-to-trading-options-on-blue-chip-stocks`

> "Selling a short-term option and buying a longer-term option of the same
> strike" — `kre-a-case-study-in-forward-volatility`

Long calendar = **sell the near expiry, buy the far expiry, same strike.**
Max loss = the debit paid. `calendar-spread-strategy`: a $3.40 spread = $340 max
loss per lot.

### 4.2 It is a forward-volatility trade, and nothing else

> "a trade that sells short-term volatility while buying longer-term volatility —
> also known as a forward volatility trade" — `volatility-trading-delta-neutral-options-trades`

> "When trading a calendar spread, you are essentially expressing a view on
> forward volatility." — `calendar-spread-strategy`

His own course ordering confirms it: `the-ultimate-guide-to-selling-options`
teaches calendars in Module 8, *after* Skew and Term Structure and after
"Understanding Volatility and Synthetic Time." In this framework a calendar is a
term-structure trade, not a theta trade.

### 4.3 The greek signature, and the long-vega trap

Initial ATM greeks (`calendar-spread-strategy`,
`volatility-trading-delta-neutral-options-trades`): delta neutral, short gamma,
long theta, and **only apparently long vega**.

The trap, verbatim:

> "implied volatility moves differently across expirations. While it is true that
> a calendar spread would profit if the implied volatility of both options
> increased the same amount, this rarely happens in practice"
> — `volatility-trading-delta-neutral-options-trades`

`calendar-spread-strategy` gives the reason and it is the deepest idea in the
corpus. The term structure moves in **root time**: short-dated IV reacts more
violently to a shock than long-dated IV, roughly ∝ 1/√T, while vega grows ∝ √T.
So the products cancel:

His printed table (10-point annualized shock lifting 365-day IV from 30% to 40%):

| Tenor | IV after shock | Δσ | ATM call vega | vega × Δσ |
|---|---|---|---|---|
| 30d | 55.2% | 25.2 | 17 | 428 |
| 60d | 47.9% | 17.9 | 24 | 430 |
| 90d | 44.6% | 14.6 | 29 | 423 |
| 120d | 42.6% | 12.6 | 34 | 428 |
| 365d | 40.0% | 10.0 | 59 | 590 |

The invariant is `vega(T) × Δσ(T) ≈ constant`. That is the law. A calendar is
**"root time flat"** — normal, root-time-conforming vol moves produce neither
gain nor loss on the vega leg.

⚠️ **His table is internally inconsistent.** His own stated shock formula,
`Change = √(365/DTE) × Annualized Shock`, gives √(365/30) × 10 = 34.9 for the
30-day row, not the printed 25.2. And the 365-day row (59 × 10 = 590) breaks the
constant. Encode the **LAW**, not the printed cells. Verify the vega ladder is
pure √T: 24/17 = √2, 29/17 ≈ √3, 34/17 = √4, 59/17 ≈ √12. It is.

**Therefore: all calendar alpha comes from NON-ROOT movements.** Deviations of
the term structure from the √T pattern. One expiry mispriced against another.

**And therefore: never score a calendar on net vega.** Net vega is the root-time
component, which is flat by construction. The score must be the residual.

### 4.4 It is a gamma-vs-vega relative-value trade

> "I'm short gamma and hedging with vega." — `calendar-spread-strategy`

> "it is uncommon to lose money on both the gamma and vega legs or to profit from
> both" — same

Because RVOL and IVOL are strongly correlated, the two legs hedge each other.
That is the point of the structure. A reverse calendar (sell back, buy front)
"expresses the view that gamma is cheap relative to vega" — his volatility-cone
example: both 30-day and 120-day IV at 80% while realized runs ~100% → the
longer-dated options are overpriced relative to the short-dated → reverse the
calendar.

### 4.5 KRE Case Study #1 — `kre-a-case-study-in-forward-volatility`

The forward-vol demonstration and the clean win.

| Field | Value |
|---|---|
| Entry | Monday March 13 |
| Structure | $45 puts, same strike, Mar 24 / Apr 21 |
| Short leg | 11 DTE at **105% IV** |
| Long leg | 39 DTE at **72% IV** |
| Forward vol (11→39) | **55%** |
| Entry cost | ~**90 cents** per spread |
| Exit (same week, Friday) | front 99%, forward vol **rose to 67%** |
| Exit price | **$1.25** = **+39%** |
| Loss condition | only if IV_back fell to 55%, "a drop of nearly 20 points" |

**The P&L driver was the term structure normalising, not spot.** Front vol barely
moved (105 → 99). Forward vol rose 55 → 67. That is the mechanism to monitor.

### 4.6 KRE Case Study #2 — `kre-is-it-crashing-yet-calendar-trade-analysis`

The one with the entry gate.

| Field | Value |
|---|---|
| Structure | May 19 / June 16 **$36 puts**, same strike |
| Front IV | **80%** |
| Back IV | **64%** |
| Forward Factor | **49%** |
| Entry gate | "I generally consider trades with a Forward Factor of **20%** to be worth taking" |
| Cost | **$80** per spread |
| Delta hedge | **none** — "I probably won't bother Delta hedging this trade" |
| Roll rule | "I may roll my calendar if the stock moves too far from the strike, but that's about it" |
| Sizing | "I only invested an amount I was willing to lose entirely" — calendars "have a lot of variance (they can go to 0)" |

The condition being screened for is explicitly **term-structure backwardation**:
front IV above back IV at the same strike.

Note: strike was a round number ($36, and $45 in the sister trade), not a delta
target. He never states an ATM or delta rule for calendars.

### 4.7 The scanner specification

Three product articles disclose the shape of his own calendar engine.

**`what-is-predicting-alpha`** — a "Forward Volatility Scanner" that "identifies
stocks with steep term structures for calendar trades" and "calculates a
'forward factor' metric measuring contango/backwardation." Thesis: exploit
situations where "short-term options trade become overpriced."

**`five-pre-built-option-strategy-scanners-…`** — "Cheap Calendar Spreads,"
ranked by a **"Calendar Rating."** The report leads with a forward-factor tracker
over the last year, and the rule is:

> "We want to see it higher than the upper bound line if we are buying and lower
> than the lower bound line if we are selling."

Also exposes "key metrics for different expirations, signal percentiles, and
daily moves" — so the engine evaluates the whole term structure per-expiry before
pairing.

**`how-to-find-profitable-option-trades-by-building-custom-volatility-scanners`**
— the Calendar filter family, verbatim: "Calendar filters are based around
forward volatility and term structure slope data points." Users set "1 day
forward moves, forward factors for different expirations, slopes between
different expirations and slope percentiles."

**`trade-nine-out-of-the-box-option-premium-strategies-…`** — "Best Calendars To
Buy": enter when "forward factor greater than **16%**", "close the trade when the
first expiration is **3-5 days away**", rank by forward-factor magnitude, signal
credited to Jim Campasano.

Composite verdicts on a strong-buy-to-strong-sell scale: **Premium Rating** and
**Calendar Rating**. Neither formula is published.

### 4.8 Expiry selection

The cleanest statement is `options-expiration-date`:

> "When we place a trade, we want it to express our view in the cleanest way
> possible."

Short DTE → theta and gamma dominate → your P&L is driven by **realized**
volatility. Long DTE → vega dominates → your P&L is driven by what the market
**thinks**. Match DTE to thesis.

`option-dte` gives the buckets:

- **< 30 DTE** — theta and gamma dominate. "the greatest concentration of variance risk premium is in shorter dated options." "Vega wounds, but gamma kills."
- **> 60 DTE** — vega dominates.
- **90–180 DTE** — the "Distressed Volatility" zone, where the market over-extrapolates recent realized vol into long-dated contracts.

`term-structure-options`: front leg is the implied-vs-realized leg and belongs at
short DTE; back leg carries the IV-level/vega exposure and belongs at longer DTE.

**Reconciled against the trader's constraints** [inference]:

| Leg | Corpus range | Trader constraint | Usable window |
|---|---|---|---|
| Front | his live calendars used 7–14 DTE; VRP concentrated < 30 DTE; wheel says "30 DTE and under"; Sean Ryan says 30 DTE roll at 20 | **≥ 15 DTE** | **15–30 DTE** |
| Back | his live calendars used 35–42 DTE; vega-pure is > 60; distressed zone 90–180 | **≥ 30 DTE, gap ≥ 15** | **30–90 DTE**, with > 90 flagged as the over-extrapolation zone where you should be SELLING vega, not buying it |

The trader's front floor of 15 DTE deliberately sits above the gamma-explosion
zone that `the-option-traders-comprehensive-guide-to-the-greeks` warns about
("30 Delta weekly options can become 50 or 80 Delta after a small move") and
above his own 3–5 DTE exit trigger. It costs some VRP concentration and buys
tail safety. That trade is the trader's call and the corpus supports both sides.

### 4.9 Strike selection

The corpus does not agree with itself. Four positions:

1. **ATM.** `calendar-spread-strategy`'s greeks are ATM properties. `what-is-vega-options`: vega maximum at S = K. `what-is-gamma-options`: gamma maximum ATM. `understanding-greeks-options`: both. `straddle-vs-strangle-options`: the ATM straddle "accurately reflects implied vs. realized volatility" — cleanest feedback. `how-to-read-an-options-chain`: ATM is where extrinsic value is maximised and intrinsic is ~0, so the spread is a pure vol bet.
2. **Slightly OTM.** `should-you-sell-straddles-or-strangles-…`: delta 30–40 as the default, lower gamma and hedging burden at identical EV. `profitable-option-selling-strategy`: "Front Month options that are roughly **-0.5 standard deviations** out the money have the greatest return," which he equates to ~delta 20.
3. **A round number.** Both KRE calendars. $36 and $45. No rule given.
4. **Re-centred as spot moves.** `earnings-disasters-tgt-trade-analysis` rolled the strike from $165 to $155 when spot fell. `kre-is-it-crashing-yet-…` rolls "if the stock moves too far from the strike."

[inference] **For a delta-neutral SPX calendar, ATM wins**, on three grounds the
author supplies: vega and gamma both peak there, the vol reading is cleanest
there, and off-ATM in an SPX put means eating negative spot-vol correlation —
`wheel`: "OTM puts will get shorter vega as the stock falls and implied
volatility increases, hurting your position."

⚠️ And the measurement rule from §2.10: define ATM by **delta ≈ 50 per expiry**,
not by a shared strike, when reading the two IVs. The 50-delta strike differs
between expiries. Then pick ONE tradable strike for the spread and correct the
IV comparison for the skew slope between them. The author never says this.

### 4.10 What makes a calendar good, in his framework

Positive terms:

1. **Forward vol cheap relative to the back leg's IV.** Cushion = IV_back − σ_fwd, in vol points. KRE had 17–20. The loss branch requires IV_back to fall to σ_fwd, and Campasano says forward vol is a biased forecast — so that usually does not happen. (`kre-a-case-study-in-forward-volatility`)
2. **Forward Factor high** — absolutely ≥ 16–20%, or relatively above the upper bound of its own 1-year band. Backwardation. (`kre-is-it-crashing-yet-…`, `trade-nine-…`, `five-pre-built-…`)
3. **Term-structure slope percentile at an extreme**, not just a slope level. (`how-to-find-profitable-option-trades-…`)
4. **VRP concentrated in the front window and thin/negative in the back window.** Per-tenor VRP, horizon-matched. (`variance-risk-premium`, `finding-expensive-options-to-sell-…`)
5. **Front leg's IV rich against a blended forecast of the realized vol it will actually face; back leg's IV not similarly rich.** (`slg` and every case study)
6. **A nameable cause on the front leg's richness that is NOT a scheduled event inside the front window.** Flow, panic, hedging demand — yes. A CPI print you can read on a calendar — no, that is priced. (`trading-research`, `term-structure-options`)
7. **A known catalyst inside the BACK expiry but outside the front.** The drug-release example: July, August and September all at 30% IV with a September event → sell August, buy September. An explicit non-root long-calendar signal. (`calendar-spread-strategy`)
8. **Negative return autocorrelation over the front horizon.** Mean-reverting spot stays pinned near the strike; trending spot walks away from it. (`option-price-prediction`)
9. **Both legs transactable.** Bid on what you sell, ask on what you buy, and the two spreads must not eat the edge. (`illiquid-options`, `winning-at-options-trading-what-poker-can-teach-you`)

Negative terms:

1. **Net vega as a score.** It is root-time flat. Scoring it is scoring nothing. (`calendar-spread-strategy`, `volatility-trading-delta-neutral-options-trades`)
2. **Raw net theta as a score.** Theta is bought with short gamma in exact proportion, so a high-theta ranking is a most-dangerous-front-expiry ranking. Normalise: `Θ_front/extrinsic_front − Θ_back/extrinsic_back`, or theta per unit gamma. (`what-is-theta-options`)
3. **Probability of profit.** EV is structure-invariant. (`should-you-sell-straddles-or-strangles-…`, `straddle-vs-strangle-options`)
4. **IV rank of either leg.** He explicitly denies it says anything about expensiveness. (`wheel`, `iv-rank`)
5. **An expensive back leg.** This is the sharpest warning in the corpus and it is easy to miss. `profitable-option-selling-strategy` tested a 90-DTE long strangle as a hedge on a 7-DTE short program and rejected it: the hedge "consumes approximately 1/3 of profits" and "costs over 60% of collected premium" while only halving max loss ($4,000 → $2,400 per lot). A calendar IS that hedged structure. And `should-you-sell-straddles-or-strangles-…` / `what-is-an-iron-butterfly`: "The reason we are getting paid is for holding the risk that there is a large move" — buying protection refunds the premium you were paid to carry. So the back leg must be cheap in **vol terms** or the calendar converts a positive-EV short into a negative one.
6. **Whole-curve distressed IV.** IV rank > 80 across the entire term structure is his signal to be **short vega**, which is the opposite of buying a back month. (`option-volatility-trading`)
7. **Basis risk pretended away.** `relative-value-volatility-trading`: the two legs are similar but not identical exposures, so a calendar is never a clean arb. Measure the residual.

### 4.11 Exits

| Rule | Value | Slug |
|---|---|---|
| Close when front expiry is near | **3–5 days away** | `trade-nine-out-of-the-box-…` |
| Roll the short leg | at **75%** of the way to expiration | `back-ratio-spread` |
| Close on IV normalisation | "Close the trade out when implied volatility comes down" | `option-volatility-trading` |
| Holding period as fraction of tenor | **10–20% of DTE** | `option-volatility-trading` |
| Roll strike | if spot moves too far from the strike | `kre-is-it-crashing-yet-…` |
| Cut on realized vol | multiple consecutive days of outsized moves → cut early, even at a loss | `ewt-trade-analysis-…`, `expensive-options-case-study-tsm`, `slg` |
| Converged | when market value has converged with your fair-value estimate | `the-options-traders-guide-to-evaluating-trades` |
| Re-entry test fails | close immediately | `traders-mindset` |
| Event-driven | after the event has happened | `the-options-traders-guide-to-evaluating-trades` |
| NOT the 50% rule | "The 50% rule is only for beginner traders" | `wheel` |

The one calendar-specific mechanical exit is **3–5 DTE on the front**, which is
also where gamma explodes and where early assignment concentrates. It is
compatible with the trader's 15-DTE entry floor.

---

## 5. What the author says to AVOID

Every stated anti-pattern, with his reasoning.

**1. Do not rank on IV Rank or IV Percentile as an edge signal.**
> "[IV Rank or Percentile] measure IV relative to its historical implied volatility, but it doesn't tell us whether it's too high or too low." — `wheel`
> "our perception of where implied volatility should be is skewed" — `iv-rank`
Regime-biased by the recent vol environment. Use IV/RV instead. Keep percentile as a gate only.

**2. Do not sell volatility when VIX is at its 80th percentile.**
> `iv-rank`. Absolute VRP is highest there, but variance spikes make it untradeable.

**3. Do not buy wings / do not over-hedge the short leg.**
> "We get paid for holding the risk...If we hedge away the risk, why are we getting paid?" — `earnings-options-strategy`
> "The reason we are getting paid is for holding the risk that there is a large move" — `what-is-an-iron-butterfly`
Quantified: a long back-dated hedge costs 1/3 of profits and 60%+ of collected premium to halve max loss (`profitable-option-selling-strategy`). Direct warning about an expensive calendar back leg.

**4. Do not judge a hedge leg by its implied volatility.**
> `option-wings`. Skew makes far-OTM IV look expensive while the dollar cost is trivial. Judge in dollars.

**5. Do not trade the midpoint in illiquid markets.**
> "in illiquid markets, the midpoint is meaningless" — `illiquid-options`
His own 10-vol execution slip is the case study.

**6. Do not ignore transaction costs.**
> "retail investors trading weekly options with bid-ask spreads of 12% or more" — `winning-at-options-trading-what-poker-can-teach-you`
Options are worse than zero-sum. Net the round trip on both legs before ranking.

**7. Do not sell into a rich IV without finding out why.**
> "If IV is high, find out why. Is there insider trading? Is there a significant event on the horizon?" — `trading-research`
Already-priced information is non-tradable.

**8. Do not run a statistical signal with no macro/regime overlay.**
> 2012 Nikkei: call skew looked like a systematic sell on historical data. "They forgot to consider the macroeconomic landscape, only focusing on historical data" — `relative-value-volatility-trading`
Traders who sold it on the z-score got run over by the Abe rally. This is the explicit anti-overfitting rule.

**9. Do not fully automate options decisions.**
> Same article. Options are non-linear, so small mistakes become big problems. Most vol managers sit between systematic and discretionary.

**10. Do not run a relative-value trade with an unhedged exposure to the level.**
> "I lost money because I wasn't just trading the relative prices between locations, but I also had unhedged exposure to the global oil market." — `what-i-learned-from-citadels-training-software`
You thought you traded the spread. You traded the level.

**11. Do not size on a nominal max loss.**
> "A $1,000 max-loss trade should be expected to lose 3–5x that on average when the tail hits" — `earnings-strategy-profit`
And "Tail risk events move in one direction and can move for prolonged periods of time." Never hold a loser hoping for reversion.

**12. Do not bet more than Kelly.**
> "while it can be 'ok' to bet less than kelly, it is not ok to bet more than kelly." — `kelly-criterion-trading`

**13. Do not confuse structure with edge.**
> "We don't get paid because of the structure that we trade." — `option-selling-strategies`
Straddle, strangle and iron fly have identical EV.

**14. Do not use delta as a probability.**
> `the-option-traders-comprehensive-guide-to-the-greeks`. That is N(d2).

**15. Do not sell vol on positively-autocorrelated (trending) underlyings.**
> `option-price-prediction`. Spot walks through the breakevens.

**16. Do not read theta off a flat-vol model over an event window.**
> `implied-volatility-over-time`. With a concentrated event, theta is front-loaded onto the event day, not spread evenly.

**17. Do not apply the 50%-profit rule.**
> "The 50% rule is only for beginner traders" — `wheel`. Exit when the volatility thesis dies.

**18. Do not fix psychology before fixing expected value.**
> "No amount of psychological fine-tuning can turn a losing strategy into a winning one." — `traders-mindset`

**19. Do not trade against sophisticated flow.**
> "This is a scary group to trade against." — `who-trades-options`. If the anomaly is one a professional desk would already have taken, de-prioritise it.

**20. Do not expect index-option edge to be large.**
> `the-business-of-trading` names US equity index options as the saturated market. Expect thin, structural edge.

**21. Do not compare the two legs in dollars.**
> `what-is-implied-volatility-in-options`. A back-month option is always dollar-expensive because it has more time. That says nothing about cheapness in vol terms.

**22. Do not average into a drawdown beyond your modelled range.**
> "if all of a sudden you have a 20% drawdown, you know that you are seeing something outside of what you expect and you can stop" — `understanding-your-option-selling-strategy-why-it-makes-money-why-it-loses-money`

**23. Do not use technical analysis.**
> "Not a single trading simulation involved technical analysis." — `what-i-learned-from-citadels-training-software`

---

## 6. Numbers table

Every threshold and figure in the corpus. Slug expands to
`https://www.predictingalpha.com/blogs/<slug>`.

### 6.1 Variance risk premium and vol levels

| Metric | Value | Context | Slug |
|---|---|---|---|
| SPX VRP, average | 4 vol points | IV30 − futureRV30, 4y | `variance-risk-premium` |
| SPX VRP win rate | 85% | share of days VRP > 0 | `variance-risk-premium` |
| SPX IV over RV | 9% on average | conflicts with 4 pts | `the-option-traders-guide-to-the-variance-risk-premium` |
| SPX IV30/RV20 ratio | ≈ 1.3 | the benchmark VRP level | `iv-rank` |
| VRP measurement history | 4 years, daily | IV30d vs futureRV30d | `trading-methodology-update-new-metrics-for-finding-inflated-option-premiums` |
| VRP moving average window | 10 days | "is it live now" | `variance-risk-premium` |
| IV Percentile lookback | 12 months | | `variance-risk-premium` |
| Short-vol Sharpe, equities | 0.6 | Fallon/Park/Yu 1995–2015 | `the-option-traders-guide-to-the-variance-risk-premium` |
| Short-vol Sharpe, fixed income | 0.5 | | same |
| Short-vol Sharpe, currency | 0.5 | | same |
| Short-vol Sharpe, commodities | 1.5 | | same |
| Short-vol Sharpe, global composite | 1.0 | | same |
| Market beta premium Sharpe | 0.4 | for scale | same |
| Diversification benefit | +31% to Sharpe | | same |
| VRP Sharpe band | 0.5 – 1.5 | by asset class | `the-business-of-trading` |
| SPX 10% drawdown, implied prob | 13% | | `the-option-traders-guide-to-the-variance-risk-premium` |
| SPX 10% drawdown, actual prob | 4% | | same |
| 2-month 10% OTM SPX put | $14.30 market vs $4.10 fair | ~3× fair value | same |
| VIX long-run mean | ≈ 14 | | `option-iv-explained` |
| VIX historical range | 9 to 80 | over 30 years | `option-iv-explained` |
| Event vol share of annual movement | 30% – 70% | single names | `earnings-options-strategy`, `calculating-implied-volatility` |
| Event share of near-dated IV | ~35% | earnings-bearing expiry | `term-structure-options` |
| Pre-earnings straddle richness | 2% above fair value | day before | `the-options-traders-guide-to-evaluating-trades` |
| Daily-move → annual IV | 1% ≈ 16%; 2% ≈ 32% | √252 scaling | `implied-volatility-over-time` |

### 6.2 Forward volatility and calendars

| Metric | Value | Context | Slug |
|---|---|---|---|
| Forward Factor entry gate | **20%** | "worth taking" | `kre-is-it-crashing-yet-calendar-trade-analysis` |
| Forward Factor entry gate | **16%** | "Best Calendars To Buy" scan | `trade-nine-out-of-the-box-option-premium-strategies-using-the-predicting-alpha-terminal` |
| Forward Factor band rule | above 1-year upper bound to buy | relative gate | `five-pre-built-option-strategy-scanners-that-profit-from-volatility-inefficiencies` |
| Calendar exit | front expiry 3–5 days away | | `trade-nine-out-of-the-box-…` |
| KRE #1 front | 11 DTE at 105% IV | Mar 24 $45 put | `kre-a-case-study-in-forward-volatility` |
| KRE #1 back | 39 DTE at 72% IV | Apr 21 $45 put | same |
| KRE #1 forward vol | 55% | 11 → 39 DTE | same |
| KRE #1 cushion | ~17–20 vol points | IV_back − σ_fwd | same |
| KRE #1 entry / exit | $0.90 → $1.25 | +39%, same week | same |
| KRE #1 exit mechanism | front 105→99, fwd 55→67 | term structure normalised | same |
| KRE #2 front | May 19 $36 put at 80% IV | | `kre-is-it-crashing-yet-…` |
| KRE #2 back | June 16 $36 put at 64% IV | | same |
| KRE #2 Forward Factor | 49% | | same |
| KRE #2 cost | $80 per spread | | same |
| Toy forward vol | week1 50%, month 30% → weeks 2–4 = 19% | | `kre-a-case-study-in-forward-volatility` |
| Calendar forward vol example | 30d 40%, 90d 35% → 32% | | `calendar-spread-strategy` |
| Calendar max loss | the debit; $3.40 spread = $340/lot | | `calendar-spread-strategy` |
| Root-time shock table | 30d +25.2, 60d +17.9, 90d +14.6, 120d +12.6, 365d +10.0 | 10-pt annualized shock | `calendar-spread-strategy` |
| ATM call vega ladder | 30d 17, 60d 24, 90d 29, 120d 34, 365d 59 | pure √T | `calendar-spread-strategy` |
| Pre-event calendar timing | buy up to 10 days before earnings, sell right before | | `volatility-trading-delta-neutral-options-trades` |
| Conventional pre-earnings entry | 3–5 days before | flagged as questionable | `how-to-learn-trading` |

### 6.3 DTE and tenor

| Metric | Value | Context | Slug |
|---|---|---|---|
| Theta/gamma bucket | < 30 DTE | VRP harvesting | `option-dte` |
| Vega bucket | > 60 DTE | | `option-dte` |
| Distressed-vol zone | 90 – 180 DTE | over-extrapolated long IV | `option-dte`, `option-volatility-trading` |
| Hedge spec | 90 DTE delta-20 strangle | | `option-dte`, `profitable-option-selling-strategy` |
| Retail convention (cited, not endorsed) | sell 45 DTE, buy back ~20 DTE | | `the-option-traders-comprehensive-guide-to-the-greeks` |
| Wheel DTE | 30 DTE and under; rejects 45 | | `wheel` |
| Sean Ryan strangle program | 30 DTE, roll every 20 days | SPX delta-20 | `option-selling-strategy` |
| Weekly strangle program | 7 DTE, roll weekly for 4 weeks | | `profitable-option-selling-strategy`, `how-to-roll-weekly-options-like-a-pro` |
| Back-ratio DTE | 30 – 60 | ETFs | `back-ratio-spread` |
| Covered-call DTE | 30 – 45 OTM calls | | `trade-nine-out-of-the-box-…` |
| Earnings straddle DTE | closest expiry, ideally 1 DTE | | `earnings-options-strategy` |
| Max-vega expression | ATM 180 DTE straddle | | `what-is-vega-options` |
| Distressed-vol holding period | 1 – 3 weeks = 10–20% of DTE | | `option-volatility-trading` |
| Terminal default scan | ~30 DTE | Expensive Option Premiums | `five-pre-built-…` |
| Backtest convention | 30 DTE ATM straddle, exit 30 calendar days | | `backtest-option-selling-strategies-for-any-ticker-instantly-with-the-predicting-alpha-terminal` |
| Expiry range on a chain | 1 day to 2 years | | `the-six-characteristics-of-an-option` |
| Monthly expiry | third Friday | | `reading-an-option-chain` |

### 6.4 Strike and delta

| Metric | Value | Context | Slug |
|---|---|---|---|
| Strangle strike | delta 20 | author's live program | `how-to-roll-weekly-options-like-a-pro`, `straddle-vs-strangle-options` |
| Strangle strike, alt | delta 30 – 40 | | `should-you-sell-straddles-or-strangles-picking-the-optimal-structure-for-option-sellers` |
| Iron condor body | 30 – 40 delta, 1 SD from ATM | | `how-to-trade-iron-condors` |
| Best front-month return | −0.5 standard deviations OTM ≈ delta 20 | | `profitable-option-selling-strategy` |
| ATM | delta ≈ 50 | | `what-does-delta-mean-in-options` |
| Iron condor wings | ≥ 1× strangle price beyond shorts | | `how-to-trade-iron-condors` |
| Wing distance, standard | 1 × straddle price | | `option-wings` |
| Wing distance, high conviction | 2 × straddle price | author prefers ≥ 2 | `option-wings` |
| Wing distance, iron butterfly | ≥ 3 × premium collected | conflicts with above | `what-is-an-iron-butterfly` |
| Wing cost target | "a few pennies" | | `what-is-an-iron-butterfly` |
| Back ratio | buy 1 ATM put, sell 2 OTM puts | | `back-ratio-spread` |
| SPX skew illustration | 3800 put 25%, 4000 ATM 20%, 4200 call 15% | ⚠️ illustrative only | `options-skew` |
| Skew ratio flagged as mispriced | 1.3× ATM | soybean meal, positive spot-vol | `professional-trade-breakdown-soybean-meal-skew-trade` |
| Vertical skew example | 160 call 50% IV, 180 call 75% IV | further OTM richer | `vertical-spread-options` |
| SPX up-day frequency | 57% | down moves larger | `options-skew` |
| Spot-vol beta | SPX −2% → IV +15.6% | ⚠️ units ambiguous | `spot-vol-correlation` |

### 6.5 Screening gates

| Metric | Value | Context | Slug |
|---|---|---|---|
| IV/RV ratio filter | > 1.1 | post-earnings scan | `post-earnings-trade-analysis-expe-etsy` |
| IV/FV signal tiers | Strong Buy ≤ 0.8; Buy ≤ 0.9; Sell ≥ 1.1; Strong Sell ≥ 1.2 | | `backtest-option-selling-strategies-…` |
| IV Percentile, selection ceiling | < 80 | cut strategy variance | `profitable-option-selling-strategy` |
| IV Percentile, richness floor | > 65% all expiries | Most Inflated Premiums | `trade-nine-out-of-the-box-…` |
| Whole-curve percentile | > 70th percentile all expiries | "Distressed Volatility" scan | `how-to-find-profitable-option-trades-by-building-custom-volatility-scanners` |
| IV rank distressed entry | > 80 across entire term structure | short vega, not calendars | `option-volatility-trading` |
| VIX kill switch | 80th percentile | stop selling vol | `iv-rank` |
| VRP requirement | positive | | `profitable-option-selling-strategy`, `update-top-trades-pick-for-you-on-our-new-home-page-more` |
| Volatility environment | "stable" | undefined | `update-top-trades-…` |
| Peer correlation floor | > 70% | to license relative value | `earnings-is-over-baba-case-study`, `slg` |
| Earnings exclusion | no earnings in next 30 days | | `post-earnings-trade-analysis-expe-etsy` |
| Backtest exclusions | earnings periods and stock splits | | `backtest-option-selling-strategies-…` |
| Backtest lookback | past year minus last 30 days | | same |
| Ticker validation | 4 years of earnings history | | `earnings-options-strategy` |
| Event-history check | last 5 earnings events | | `earnings-strategy-profit` |
| Pricing inputs | r = 5%, q = 0% | | `backtest-option-selling-strategies-…` |
| Entry timing | ~15 minutes before the close | | same |

### 6.6 Liquidity

| Metric | Value | Context | Slug |
|---|---|---|---|
| Median option volume, preferred | 5,000+ contracts/day | | `variance-risk-premium` |
| Average option volume | > 3,000 daily contracts | | `post-earnings-trade-analysis-expe-etsy` |
| Universe floor | > 100 options traded daily | Top Trades list | `update-top-trades-…` |
| bid/ask as % of max premium | 22% acceptable (FXI); 58% reject (ASHR) | 15× volume gap | `profitable-option-selling-strategy` |
| Single-name spread reject | $5 – $10 | | `earnings-strategy-profit` |
| Retail weekly spread | 12% or more | the rake | `winning-at-options-trading-what-poker-can-teach-you` |
| Price floor | stock > $15 | | `post-earnings-trade-analysis-expe-etsy` |
| Illiquid example | VOD 15.5 put, bid $0.67 / ask $1.94 | spread ≈ 97% of mid | `illiquid-options` |
| Execution slip cost | sold 40% IV vs intended 50%, RV 32% | 10 vol points | `illiquid-options` |
| SPX daily options volume | 94.4M contracts (2015) | vs EuroStoxx50 11.8M | `the-option-traders-guide-to-the-variance-risk-premium` |
| SPY put/call daily volume | "very rarely below 2M each" | | same |

### 6.7 Sizing and risk

| Metric | Value | Context | Slug |
|---|---|---|---|
| Kelly | f* = (bp − q)/b | | `kelly-criterion-trading` |
| Kelly example, casino | 60% win at 1.2× → 26.7% of bankroll | | same |
| Kelly example, iron butterfly | $500/$1000 at 68% → 4% of bankroll | | same |
| Kelly rule | never bet more than Kelly | | same |
| Size vs comfort | 25% of your expected trade size | | `earnings-strategy-profit` |
| Expected tail loss | 3 – 5 × stated max loss | | same |
| Bankroll risk cap | never risk more than 25% (also stated 30%) | | `option-selling-strategy` |
| Max loss per position | ≤ 10% of account | | `what-is-an-iron-butterfly`, `what-is-a-short-straddle` |
| Margin per position | ≤ 10 – 15% of portfolio | | same two |
| Max account risk per trade | 3% | bull/bear spread scans | `trade-nine-out-of-the-box-…` |
| Margin utilization | < 50% | back ratio | `back-ratio-spread` |
| Stress test, short straddle | 3 – 4 × implied move, loss ≤ 10% of account | | `what-is-a-short-straddle` |
| Stress test, straddle price | 1.5 × straddle-price move | | `gld-trade-analysis-…`, `expensive-kweb-options-…` |
| Stress test, SLG | 30% spot + 30 vol points → loss < $500 | simultaneous | `slg` |
| Stress test, EWT | 10% spot move → < $260 | | `ewt-trade-analysis-…` |
| Stress test, BABA | 10% spot move → −$400 | | `earnings-is-over-baba-case-study` |
| Stress-to-loss, inflated premiums scan | 100% of option premium | | `trade-nine-out-of-the-box-…` |
| Expected max drawdown | 15% | short-vol program | `understanding-your-option-selling-strategy-…` |
| Out-of-model drawdown | 20% → stop | | same |
| Drawdown asymmetry | 30% loss needs 40%+ gain to break even | | `capturing-the-variance-risk-premium-a-guide-to-exploiting-edge-in-option-prices` |
| Drawdown asymmetry, worse | 50% loss needs a double | | `winning-at-options-trading-what-poker-can-teach-you` |
| Loss frequency on good bets | up to 23% (poker all-in analogy) | | same |
| Delta hedge band | ±30 position delta | | `delta-hedging` |
| Delta hedge value captured | 90% from either crude schedule | daily close or band | `delta-hedging` |
| Position delta | Δ × contracts × 100 | | `delta-hedging`, `what-does-delta-mean-in-options` |

### 6.8 Case-study returns and edges

| Case | Edge | Margin | Return / period | Slug |
|---|---|---|---|---|
| COP | IV 33.88 vs FV 27.4 (6.48 pts); $8.6 vs $6.9 = ~$130 | $5,200–$6,500 | 2% / 37 days | `cop-trade-analysis-…` |
| BABA | IV 42.66 vs FV 37.1; $8.20 vs $7.14 = ~$106 | ~$5,000 | ~2% / month | `earnings-is-over-baba-case-study` |
| EWT | IV vs FV 11.76; $1.64 vs $1.22 = ~$40 | ~$2,000 | ~2% / 31 days | `ewt-trade-analysis-…` |
| TSM | IV 27.51 vs FV 24.54 (3 pts); $5.28 vs $4.71 = ~$57 | < $5,000 | ~1% / month | `expensive-options-case-study-tsm` |
| GLD | $4.17 vs $3.49 = ~$65 | ~$8,500 | 0.75% / 10 days | `gld-trade-analysis-…` |
| KWEB | $1.53 vs $1.26 = ~$25 | ~$1,400 | 1.7% / 11 days | `expensive-kweb-options-…` |
| SLG | $4.53 vs $3.81 = ~$70 | $2,000 | 3.5% / 35 days | `slg` |
| EXPE | 6 pts × vega 14.4 = ~$100 (or $50 conservative) | $4,400 (or $6,000) | 2.3% (or 0.8%) / 14 days | `post-earnings-trade-analysis-expe-etsy` |
| ETSY | 6 pts × vega 13.9 = ~$80 (or $40) | $4,500 (or $6,000) | 1.78% (or 0.67%) / 14 days | same |
| TGT | IV30 45.8 vs NERV 35; closed at 38.9 | — | +$277 per straddle | `earnings-disasters-tgt-trade-analysis` |
| KRE #1 | fwd 55 vs IV_back 72 | — | +39% / 5 days | `kre-a-case-study-in-forward-volatility` |
| Earnings program | $224,914.81 profit, 1,381 trades | — | 89.97% / 2 years | `earnings-strategy-profit` |

**The accept bar across all of it: 0.67% to 3.5% on margin over 10–37 days.**

### 6.9 Instrument-specific IV/RV ratios

| Ticker | Ratio | Note | Slug |
|---|---|---|---|
| SPX | ≈ 1.3 | IV30/RV20 | `iv-rank` |
| COP | 1.02 | peer HES 0.98 | `cop-trade-analysis-…` |
| BABA | 1.075 | | `earnings-is-over-baba-case-study` |
| TSM | 1.06 | | `expensive-options-case-study-tsm` |
| SLG | 1.02 | | `slg` |
| KWEB | 1.24 normalised, 1.38 current | premium 14% avg vs 38.4% now | `expensive-kweb-options-…` |
| FXI | premium 24.5% avg vs 35% now | +9 pts vs KWEB's +21 | same |
| EWT | 1.5 (45% premium) | geopolitical + gap + illiquidity | `ewt-trade-analysis-…` |
| DISCA/FOXA | historical IV ratio 1.2× | 80% correlation | `option-trading-masterclass` |
| VRP as absolute test | current 8 pts vs 5-pt historical avg = rich | | `option-trading-masterclass` |

### 6.10 Greeks reference values

| Item | Value | Slug |
|---|---|---|
| Theta as % of extrinsic, 30 DTE | ~3% / day | `what-is-theta-options` |
| Theta as % of extrinsic, 10 DTE | ~10% / day | same |
| Theta as % of extrinsic, last day | 100% | same |
| Theta scaling law | ∝ √(time remaining) → Θ/day ∝ 1/√T | `understanding-greeks-options` |
| Vega scaling | increases with T; max ATM | `what-is-vega-options`, `understanding-greeks-options` |
| Gamma | max ATM; increases as T → 0 | `what-is-gamma-options`, `understanding-greeks-options` |
| Gamma warning | 30-delta weekly → 50 or 80 delta after a small move | `the-option-traders-comprehensive-guide-to-the-greeks` |
| Rho | material only on LEAPS | same |
| Greek priority, short horizon | gamma + theta | same |
| Greek priority, long horizon | vega + rho | same |
| Delta priority | least important, easily hedged | same |
| Delta identities | \|Δc\|+\|Δp\| = 1; Δc − Δp = 1.00 | `what-does-delta-mean-in-options` |
| GME 90-day IV move | 322% → 179% (143 vol points) | `option-volatility-trading` |
| GME 2-year IV move | 153% → 113% (40 vol points) | same |
| GME straddle | $560 → $340 = +$220/lot | same |

---

## 7. Doctrine → engine mapping

Categories: **(a)** directly encodable score term · **(b)** gate/filter only ·
**(c)** needs history we may not have · **(d)** human judgement.

### 7.1 Score terms — (a)

| Doctrine | Encoding | Source |
|---|---|---|
| Forward volatility | `σ_fwd = sqrt((σ_b²T_b − σ_f²T_f)/(T_b − T_f))` from two 50-delta IVs and two DTEs | `kre-a-case-study-in-forward-volatility` |
| Cushion | `IV_back − σ_fwd`, vol points. KRE had 17–20 | same |
| Forward Factor | `IV_front/σ_fwd − 1` [inference]. Keep swappable | `kre-is-it-crashing-yet-…` |
| Term-structure slope | `(IV_back − IV_front)/(T_b − T_f)` | `how-to-find-profitable-option-trades-…` |
| Per-tenor VRP | `IV(T) − forecastRV(T)` for front and back; score `VRP_f − VRP_b` | `finding-expensive-options-to-sell-…` |
| Blended fair vol per tenor | mean(RV30, RV×own IV/RV, IV÷own IV/RV, hist avg IV at tenor) — drop the PA proprietary term | `slg`, `expensive-options-case-study-tsm` |
| Dollar edge | `debit_at_market − debit_at_forecast_vol`, both legs repriced | `slg` |
| Return on risk | `edge ÷ debit` (debit = max loss on a long calendar) | `vertical-spread-options`, `calendar-spread-strategy` |
| Differential theta | `Θ_f/extrinsic_f − Θ_b/extrinsic_b` — % decay rate, not dollars | `what-is-theta-options` |
| Theta per unit gamma | normalise carry by the gamma sold | same |
| Skew ratio at strike | `IV(K)/IV(ATM)` per expiry; front wing steeper than back | `professional-trade-breakdown-soybean-meal-skew-trade` |
| Expected move | ATM straddle / spot per expiry; daily implied = IV/√252 | `what-is-implied-volatility`, `cop-trade-analysis-…` |
| Daily implied vs daily realized | ratio, per tenor | `cop-…`, `expensive-kweb-…`, `gld-…` |
| IV/RV ratio per expiry | and its deviation from that tenor's own average | `expensive-kweb-options-…` |
| Transactable edge | bid on the sold leg, ask on the bought leg. Never mid | `illiquid-options` |
| Spread cost as % of debit | round-trip both legs | `winning-at-options-trading-…` |
| Root-time residual | strip the √T component; score only the non-root deviation | `calendar-spread-strategy` |
| Conviction bucket | score + tier, size by tier | `option-trading-psychology` |

**The one thing that must NOT be a score term:** net vega. Root-time flat.
`calendar-spread-strategy`, `volatility-trading-delta-neutral-options-trades`.

### 7.2 Gates and filters — (b)

| Gate | Value | Source |
|---|---|---|
| Front DTE | 15 – 30 [trader's floor + `option-dte`/`wheel` ceiling] | trader + `wheel` |
| Back DTE | 30 – 90, gap ≥ 15 | trader + `option-dte` |
| Delta neutrality | pair delta ≈ 0 at inception; hedge residual | trader + `delta-hedging` |
| Strike | ATM = 50-delta, defined per expiry then reconciled | `what-does-delta-mean-in-options` + [inference] |
| VRP > 0 at both tenors | | `profitable-option-selling-strategy` |
| IV percentile band | 65 ≤ pct < 80 [inference reconciling two articles] | `trade-nine-…` + `profitable-option-selling-strategy` |
| Whole-curve distressed | pct > 80 all expiries → BLOCK (short-vega regime, not calendar) | `option-volatility-trading` |
| VIX kill switch | VIX at 80th percentile → block new short-front risk | `iv-rank` |
| Forward Factor | percentile band primary; absolute ≥ 16–20% = conviction tier | `five-pre-built-…` + `kre-is-it-crashing-yet-…` |
| Bid/ask width | reject when spread > ~22% of the leg's premium; hard reject at 58% | `profitable-option-selling-strategy` |
| Spread vs edge | reject when round-trip cost > some fraction of modelled edge | `winning-at-options-trading-…` |
| Liquidity floor | median volume; SPX always passes | `variance-risk-premium` |
| Macro event in front window | flag. If the richness IS the event, it is priced → deprioritise | `trading-research`, `term-structure-options` |
| Macro event in back-only window | flag as a POSITIVE non-root signal | `calendar-spread-strategy` |
| Autocorrelation regime | penalise positive lag-1 rho over the front horizon | `option-price-prediction` |
| Max loss ≤ 10% of account | | `what-is-an-iron-butterfly` |
| Margin ≤ 10–15% of portfolio | | same |
| Max account risk 3% per trade | | `trade-nine-…` |
| Fractional Kelly cap | never above f* | `kelly-criterion-trading` |
| Stress test | 30% spot + 30 vol points simultaneously; 3–4× implied move | `slg`, `what-is-a-short-straddle` |
| Accept bar | ≥ ~1% on risk over the holding period [inference from the 0.67–3.5% range] | case studies |
| Exit: front at 3–5 DTE | mechanical | `trade-nine-…` |
| Exit: re-entry test | re-score daily with the entry criterion | `traders-mindset` |
| Exit: consecutive outsized days | cut, even at a loss | `ewt-…`, `expensive-options-case-study-tsm`, `slg` |
| Drawdown stop | 15% expected / 20% anomaly | `understanding-your-option-selling-strategy-…` |

### 7.3 Needs history we may not have — (c)

| Requirement | Why | Source |
|---|---|---|
| 4 years of daily IV30 + subsequent RV30 | VRP average, win rate, moving average | `trading-methodology-update-…` |
| Per-tenor IV history | to compute "own average premium" and the de-premuming divisor at each DTE, not just at 30 DTE | `expensive-options-case-study-tsm` + [inference on per-tenor] |
| 1 year of daily Forward Factor per DTE bucket | the upper/lower bound band — the gate that actually works in contango | `five-pre-built-…` |
| 1 year of term-structure slope per bucket | slope percentile | `how-to-find-profitable-option-trades-…` |
| 12 months of IV30 | IV percentile | `variance-risk-premium` |
| Rolling spot-vol regression | the spot-vol beta term; no window specified | `spot-vol-correlation` |
| A macro event calendar (CPI, FOMC, OPEX, quarterly roll) | to classify which expiry contains which catalyst | [inference — he only ever discusses earnings] |
| SPX per-tenor historical IV/RV ratios | to de-premium each expiry before comparing them | [inference from `expensive-options-case-study-tsm`] |
| A backtest of the ranked signal | his four-part gate demands historical validation before deployment | `option-selling-strategy` |
| Distribution for Kelly p and b | calendars can go to 0; needs simulation or backtest | `kre-is-it-crashing-yet-…` + `kelly-criterion-trading` |

Right-censoring note: every VRP series is unresolved for its newest horizon by
construction. Encode that, do not paper over it. [inference]

### 7.4 Judgement that stays with the human — (d)

| Item | Why |
|---|---|
| "Find out WHY IV is high" | `trading-research` demands a cause. A calendar is only edge if the front's richness is not already-priced information. No dataset answers this. |
| The macro overlay | The 2012 Nikkei lesson is explicitly that a pure historical z-score with no macro read gets run over. `relative-value-volatility-trading`. |
| "Do not fully automate" | Same article: options are non-linear so small mistakes become big problems. The engine ranks; the human takes. |
| Is this counterparty flow or a sophisticated desk's position? | `who-trades-options`. Unanswerable from a chain. |
| The conviction/arbitrage call | "pile it on" vs "play tight to the vest" — `option-trading-psychology`. The engine can propose the tier; the human sizes it. |
| Overriding on a 2+ SD move | `earnings-strategy-profit`: "override with a subjective read of the report itself." |
| Whether to carry a short-delta tilt | The TGT trade did (5 short shares/straddle) because negative spot-vol correlation makes short stock a joint delta+vega hedge. Conflicts with flat delta-neutral. Trader's call. |
| The re-entry test | Mechanisable as re-scoring, but the "would I take this today" question is his framing, not a formula. |

### 7.5 Collisions between the corpus and the trader's constraints

| Corpus says | Trader says | Resolution |
|---|---|---|
| Front leg 7 DTE (`profitable-option-selling-strategy`), 1 DTE for earnings (`earnings-options-strategy`), 11–14 DTE in the live KRE calendars | front ≥ 15 DTE | Trader wins. Costs some VRP concentration, buys tail safety against the gamma explosion `the-option-traders-comprehensive-guide-to-the-greeks` warns about. Front window: 15–30 DTE. |
| "the greatest concentration of variance risk premium is in shorter dated options" (`option-dte`) | front ≥ 15 DTE | Accept the haircut. Note it in the score's expected magnitude. |
| Back leg > 60 DTE for vega dominance (`option-dte`); 90–180 for the vega trade (`option-volatility-trading`) | back ≥ 30 DTE | His own live calendars used 35–42 DTE backs, so 30–60 is empirically fine. Flag > 90 as the over-extrapolation zone. |
| No delta hedging on calendars (`kre-is-it-crashing-yet-…`); short-delta tilt (`earnings-disasters-tgt-trade-analysis`) | delta-neutral | Trader wins. Use `delta-hedging`'s ±30 band or daily-close schedule — either captures "90% of the value". |
| Forward Factor ≥ 16–20% absolute | SPX, contango most of the time | ⚠️ Absolute gate will almost never fire. Use his own percentile-band gate (`five-pre-built-…`) as primary. This is the single biggest engine decision in the dossier. |
| Strike = a round number (both KRE calendars) | delta-neutral | ATM (50-delta), on the vega/gamma-peak argument. |
| Wings at 1–2× straddle (`option-wings`) vs 3× premium (`what-is-an-iron-butterfly`) | — | Conflict unresolved in the corpus. A long calendar already IS the wing; do not add another. |

---

## 8. Where the corpus is silent or vague

Be honest about the holes. Every one of these is a decision the engine must make
without him.

**8.1 The Forward Factor formula.** He never writes it. "I use a tool that helps
me calculate this ratio." The `IV_front/σ_fwd − 1` reading fits his one numbered
case to within 2 points but is inference. Two thresholds are published (16%, 20%)
and they disagree. And a third, incompatible-in-kind gate (the 1-year band) is
published elsewhere. **The engine must pick one and make it configurable.**

**8.2. The Calendar Rating.** Named twice as the ranked output. Formula never
given. "signal percentiles" and "key metrics by expiration" are the only clues.
The composite weighting is entirely ours.

**8.3 No SPX macro-date treatment anywhere.** Every event discussion is earnings.
Zero words on CPI, FOMC, OPEX, quarterly roll, 0DTE flow, or the structural
weekly-vs-monthly SPX distinction. `calculating-implied-volatility` says SPX is
almost pure market volatility, which makes macro dates the entire event circle —
and then says nothing about them. This is the biggest single gap for an SPX
engine.

**8.4 No SPX contract mechanics.** Nothing on cash settlement, the $100
multiplier, AM vs PM settlement, SPX vs SPXW roots, European exercise, or the
1256 tax treatment. `early-assignment-options` discusses American assignment and
never mentions the American/European distinction at all. The engine must supply
all of this itself. (And: assignment risk is moot on SPX, so drop that term
entirely. [inference])

**8.5 No realized-vol estimator specification.** He names Close-to-Close (windows
"10d through 200d"), Yang Zhang and GARCH. No formulas, no coefficients, no
window choice, no recommendation. Which one, over which window, for which
tenor — all ours.

**8.6 No mean-reversion parameters.** Mean reversion and clustering are asserted
as facts. No half-life, no EWMA decay, no lookback, no blend weight between the
clustering term and the long-run mean. `volatility-mean-reversion` explicitly
calls the naive version an oversimplification and then supplies nothing better.

**8.7 No autocorrelation parameters.** No lag, no coefficient threshold, no
window. `option-price-prediction` gives the concept and zero numbers.

**8.8 No spot-vol correlation window, and the one number is ambiguous.** "S&P
down 2% → IV rises approximately 15.6%" — points or percent? Unstated. And "the
correlation must be re-measured" with no window given.

**8.9 The blend weights.** Every case study averages 3–4 vol forecasts.
`gld-trade-analysis-…` produces 14.1% from 10.8 / 17 / 14.5 — which is not the
simple mean (14.1). The weights are never disclosed. Others (COP, TSM, EWT) ARE
simple means. Inconsistent.

**8.10 One of the four blend inputs is proprietary.** The "PA forecast" appears in
every case study and its construction is never published. The engine loses one
of three or four terms.

**8.11 The root-time table is arithmetically inconsistent.** His printed 30-day
shock (25.2) contradicts his own printed formula (√(365/30)×10 = 34.9), and the
365-day row breaks the vega×Δσ invariant that the other four rows satisfy. Encode
the law, discard the cells, and note that a reader could reasonably derive two
different scalings from the same page.

**8.12 4-point vs 9% SPX VRP.** Two articles, two incompatible numbers, no
reconciliation. Related: `iv-rank`'s 1.3× ratio reconciles with 4 points and not
with 9%.

**8.13 No skew term structure.** `options-skew` says nothing about how skew
changes with tenor. `professional-trade-breakdown-…` asserts "skew flattens as
expiration approaches, it does not flip" — one sentence, one commodity, no
numbers, no SPX. A calendar at any non-ATM strike needs the front-vs-back skew
slope and the corpus does not supply it.

**8.14 The SPX skew illustration is not calibration.** 25/20/15 across ±5% of
spot is far steeper than real SPX. Do not seed the engine from it.

**8.15 No calendar-specific liquidity threshold.** Five different volume/spread
gates across five articles, none for a two-legged spread, none for SPX. And the
one hard number (12% spreads) is for retail single-name weeklies.

**8.16 No stated method for stripping event premium from an IV.** `term-structure-options`
says ~35% of a near-dated IV can be earnings; it gives no de-weighting formula.
`implied-volatility-over-time` says theta is front-loaded onto the event day; no
weighting scheme. The "event-weighted T" idea is entirely inference.

**8.17 Kelly p and b for a calendar.** He gives the formula and a defined-risk
example. For a calendar he says only "they can go to 0." No distribution, no win
rate, no expected exit value. The sizing layer needs a simulation the corpus does
not describe.

**8.18 No exit rule for a calendar that goes right.** The 3–5 DTE rule is
time-based. `option-volatility-trading` says exit on IV normalisation. KRE #1 was
exited on forward vol rising 55 → 67 — an ad-hoc read, no threshold. There is no
published "forward vol has converged, get out" number.

**8.19 No treatment of the reverse calendar's ranking.** `calendar-spread-strategy`
names it and gives one qualitative condition (vol cone says long-dated is
overpriced relative to short-dated). `five-pre-built-…` says sell when the
forward-factor tracker is below the lower bound. No threshold, no worked example.
If the engine is symmetric, the sell side is under-specified.

**8.20 Basis risk is named and never measured.** `relative-value-volatility-trading`
insists the two legs are similar-but-not-identical and that the residual must be
measured. No method given.

**8.21 The 65–80 IV-percentile window is my reconciliation, not his.** Two
articles give one bound each, for different purposes. Treating them as a joint
window is inference.

**8.22 Vega ratioing between legs.** `understanding-greeks-options` establishes
that a 1-lot calendar is not vega-neutral because vega ∝ √T. He never discusses
ratioing the legs to flatten it, and never gives a weighting scheme. Any √T or
vega-weighted normalisation in the engine goes beyond him.

**8.23 Nothing on how many candidates to emit, or how to handle correlated
pairs.** Adjacent expiry pairs on SPX are near-duplicates. `kelly-criterion-trading`
says diversification is a haircut to Kelly; it never says how to treat two
overlapping calendars as one bet.

---

## Appendix — the twelve lines that matter most

1. "When trading a calendar spread, you are essentially expressing a view on forward volatility." — `calendar-spread-strategy`
2. "I'm short gamma and hedging with vega." — `calendar-spread-strategy`
3. "if normal volatility movements occur across the term structure, we neither lose nor gain money due to our vega exposure" — `calendar-spread-strategy`
4. "forward volatility is a terrible indicator of future implied volatility" … "calendar spreads profit unless the long-term option experiences an extreme amount of IV Crush" — `kre-a-case-study-in-forward-volatility`
5. "I generally consider trades with a Forward Factor of 20% to be worth taking." — `kre-is-it-crashing-yet-calendar-trade-analysis`
6. "We want to see it higher than the upper bound line if we are buying" — `five-pre-built-option-strategy-scanners-…`
7. "implied volatility moves differently across expirations… this rarely happens in practice" — `volatility-trading-delta-neutral-options-trades`
8. "[IV Rank or Percentile] measure IV relative to its historical implied volatility, but it doesn't tell us whether it's too high or too low." — `wheel`
9. "there is plenty of cash on the table for simply being able to measure the present accurately." — `finding-expensive-options-to-sell-…`
10. "One man's theta is another man's gamma." — `what-is-gamma-options`
11. "If IV is high, find out why." — `trading-research`
12. "Trade them small, find many trades." — `post-earnings-trade-analysis-expe-etsy`
