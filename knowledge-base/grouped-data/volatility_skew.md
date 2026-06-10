---
## Group Summary: Volatility Skew (Options & Return Distribution)

### Overview
Skew operates on two distinct levels: (1) Options skew—the IV difference between OTM puts vs OTM calls, reflecting supply/demand and hedging flows, and (2) Return distribution skew—the asymmetry of realized returns (more frequent small gains, rare large losses). Options market prices the expected distribution via skew. Options skew is NOT random; it's driven by rational hedging demand (people protect long equities via puts) and changes when risk expectations shift (meme stock squeezes → call skew spikes; corrections → put skew steepens). Traders exploit skew by identifying when skew is extreme relative to history, then betting on mean reversion. This collection of 9 files examines skew mechanics, historical patterns (CBOE skew index as sentiment), mispricings, and monetization strategies.

### Key Insights

- **Skew Reflects Distribution Asymmetry ("Escalator Up, Elevator Down")**: Equities don't follow normal distributions. Realized return history shows frequent small gains (+1-2% days), infrequent large losses (-10% crash days). This negative skew (left tail longer) means downside risk is concentrated in rare events. Options market prices this via put skew: OTM puts are MORE expensive than OTM calls at the same distance. This is RATIONAL, not a mispricing. Pension funds hedging $1M equity portfolios buy puts; supply is low relative to demand → puts expensive.

- **Skew as Supply/Demand Proxy for Tail Hedging**: Skew = IV(OTM put) - IV(OTM call). When people hedge (buy puts), skew steepens. Indices like S&P 500 have persistent put skew because the entire world is long equities. When meme stocks spike (AMC up 500% in weeks), hedgers switch to being short tail risk → call skew inverts (calls become expensive, puts cheap). Skew tracks hedging activity, not intrinsic mispricing. High skew near market TOPS (people lock in gains by hedging) is counterintuitive but empirically true—hedging is profitable, so people do it when winning.

- **Skew Rank (1-100 Scale) as Timing Tool, Not Price Level**: CBOE Skew Index (100-150 historical range) measures S&P 500 tail risk pricing. 100 = no tail pricing, 150 = extreme hedging. Backtests show: high skew (110-150) near TOPS, low skew (100-110) near BOTTOMS. Over 10-day forward returns: high skew quarter → -0.76% average; low skew quarter → +1.14% average. This is NOT because high skew causes selling; it's because people hedge strength as a strategy to lock gains. Skew rank tells you regime but doesn't directly predict direction—combine with other signals.

- **Skew Changes = Mean-Reverting Trading Edge**: The edge is NOT trading absolute skew levels but CHANGES. When skew spikes to 2-year highs (elevated Skew Rank), historical mean reversion suggests normalization. Example: TSLA put skew highest in 2 years → skew should compress. Optimal structure = risk reversals (long ATM call, short OTM put) betting on skew flattening AND capturing delta if rally continues. Skew changes are mean-reverting; skew levels are sticky within regimes.

- **Skew Varies by Expiration DTE**: Each option expiration has its own skew profile. Near-dated (1 week) skew is often steepest because event risk is compressed. 30-DTE skew is milder. 60+ DTE skew is flat. Traders scanning for opportunities should examine skew across expirations to find the steepest one (usually nearest term), then determine if that steepness is justified by upcoming catalysts or is mean-reverting.

- **Skew is Orthogonal to IV Level**: A stock can have HIGH IV rank (percentile vs history) and NORMAL skew, or LOW IV rank with EXTREME skew. These are independent dimensions. Trading skew is about relative call vs put pricing, NOT about whether overall IV is "high" or "low." A 50% IV with normal skew may be better to trade than 30% IV with extreme skew if the extreme skew is unsustainable.

- **Asymmetric Flies Into Skew as Risk-Reward Extreme**: When call skew is steep (calls expensive), traders buy ATM calls, sell 3 OTM calls, buy 2 further OTM calls (1-3-2 butterfly). Cost: $65. Max payout: $935. Risk/reward ratio of 1:14. These "lotto tickets" work in high-skew environments because the short calls' high premiums finance the bulk. In low-skew environments, similar structures are unprofitable—the financing disappears. Asymmetric flies are skew-directional, not neutral.

- **Skew Inversion Signals Risk Appetite Shifts**: When call skew > put skew (rare), it signals extreme bullish conviction (meme bubbles, short squeezes). This inversion historically precedes sharp reversals—market reach extremes before pulling back. Example: AMC skew inverted from put-skewed in 2020 to call-skewed in March 2021 as bubble inflated; skew then flipped back post-peak. Skew inversion is a regime shift signal, not a trade signal itself.

- **Skew Risk Premium is Overpriced by Industry**: Rob Carver's research shows practitioners demand 30+ basis points of return for managing "skew risk" (prefer positive skew), but the actual cost of negative skew is ~6 basis points per 5 units for Kelly investors, and nearly zero for sub-Kelly investors. Most investors are far under-leveraged (using <0.5x Kelly), making skew almost free. Investors sacrificing 30 bps for slight positive skew are optimizing for the wrong objective function—Sharpe ratio dominates skew preference.

- **Regime-Dependent Skew Behavior**: Macro shifts alter skew structure permanently. 2020 COVID: all equities showed massive put skew as hedging spiked. Normalization took months. Within stable regime, skew oscillates around mean (exploitable). Between regimes, skew jumps and stays elevated until risk is re-priced. Traders must distinguish routine mean reversion (bet on) from regime shifts (avoid or hedge).

### Key Questions
- What technical or fundamental signals best predict when skew will normalize or invert (e.g., earnings resolution, volatility spike, momentum exhaustion, news catalyst)?
- How does skew predictability differ between broad indices (SPX with persistent put skew, tight mean-reversion range) vs individual equities (variable skew tied to company-specific events)?
- Should skew-trading position sizing scale with skew magnitude (e.g., bigger bet at 150 vs 120 Skew Rank) or skew velocity (rate of change), and how should volatility-of-volatility impact leverage?

### Major Patterns & Themes
- **Skew is Sticky Within Regimes, Jumps Across Regimes**: Inside a bull market, skew oscillates 10-20 points (exploitable mean reversion). At major inflection points (earnings, Fed decisions, systemic events), skew jumps 30-50 points and stays elevated until risk re-priced. Traders differentiate via regime signals (moving averages of skew, breadth data).

- **Put Skew (Typical) vs Call Skew (Rare & Bullish)**: Equities default to put skew due to inherent asymmetry. Call skew appears in specific situations: meme stock bubbles, pre-announcement runups, sector rallies on momentum. Call skew is temporary; put skew is structural. Trading call skew inversions is high-conviction (skew should revert).

- **Event-Driven Skew Spikes**: Earnings announcements → front-loaded event vol in nearest expirations → steep skew in that month. Post-earnings, skew compresses. Binary events (FDA, trials, M&A) → skew spikes pre-event, collapses post. Traders who understand event cycles can predict skew patterns.

- **Cross-Asset Skew Correlation**: During sector rotations, sector-level skews diverge (tech puts expensive as rotation starts, energy puts cheap as rotation completes). Individual stock skew follows both sector and idiosyncratic factors. Relative skew (stock vs sector vs market) reveals mispricing opportunities.

### File List
raw/docs/09-trading-skew.md
raw/quantocracy/docs/an-evaluation-of-the-skewness-model-on-22-commodities-futures.md
raw/quantocracy/docs/can-skewness-identify-future-outperforming-mutual-funds.md
raw/quantocracy/docs/how-much-should-we-get-paid-for-skew-risk.md
raw/quantocracy/docs/skew-preferences-for-crypto-degens.md
raw/quantocracy/docs/skewness-of-funds-friend-or-foe.md
raw/quantocracy/docs/skewness-premium-in-managed-futures-a-practitioners-guide.md
raw/quantocracy/docs/using-skewness-and-kurtosis-to-enhance-trading-and-risk-management.md
raw/traderfeed/2015-04-what-we-can-learn-from-options-skew.md
