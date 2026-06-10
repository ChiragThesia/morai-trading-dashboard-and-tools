## Group Summary: Options Analysis

### Key Insights
- Delta measures the expected price change of an option given a $1 move in the underlying, ranging from 0 to 1 for calls and 0 to -1 for puts. Approximates the probability an option will be in-the-money at expiration; for example, a 0.50 delta call is roughly 50% likely to expire ITM and has 50:50 odds on the risk/reward payoff diagram.
- Gamma measures how fast delta changes as the underlying price moves, revealing directional leverage and acceleration. Positive gamma (long options) means positions benefit from large moves in either direction but lose money from time decay; negative gamma (short options) means positions suffer from large moves but benefit from time decay—understanding gamma prevents unexpected directional losses.
- Theta measures daily time decay benefit or cost, quantifying exactly how much premium evaporates each day as expiration approaches. Short premium (credit spreads, selling options) has positive theta, while long premium (debit spreads, buying options) has negative theta—this fundamental relationship determines which strategies are suitable for sideways versus trending markets.
- Vega measures sensitivity to implied volatility changes, determining whether high IV is a tailwind (for short premium strategies) or headwind (for long premium strategies). IV crush after earnings and IV spikes during market dislocations create opportunities for volatility-aware traders rather than standard directional traders.

### Key Questions
- How do you practically estimate delta and gamma from option quotes or trading software to make real-time position management decisions?
- What is the relationship between strike selection and gamma risk over time, and how does this change as options approach expiration?
- How does the concept of "IV crush" after earnings affect the profitability of different strategies, and what strategies specifically exploit or protect against it?

### File List
- raw/steadyoptions/anchor-analysis-and-options-r564.md
- raw/steadyoptions/anchor-maximum-drawdown-analysis-r505.md
- raw/steadyoptions/delta-hedging-your-options-strategies-r402.md
- raw/steadyoptions/delta-neutral-trading-what-not-to-do-and-how-to-fix-it-r752.md
- raw/steadyoptions/ep-gamma-scalping-options-trading-strategy.md
- raw/steadyoptions/ep-options-delta.md
- raw/steadyoptions/ep-options-gamma.md
- raw/steadyoptions/ep-options-greeks.md
- raw/steadyoptions/ep-options-theta.md
- raw/steadyoptions/ep-options-vega.md
- raw/steadyoptions/estimating-delta-for-calls-or-puts-r552.md
- raw/steadyoptions/estimating-gamma-for-calls-or-puts-r554.md
- raw/steadyoptions/is-analysis-paralysis-killing-your-trading-performance-r50.md
- raw/steadyoptions/january-2019-performance-analysis-r451.md
- raw/steadyoptions/long-gamma-vs-short-gamma-options-strategy-explained-r730.md
- raw/steadyoptions/market-neutral-strategies-long-or-short-gamma-r95.md
- raw/steadyoptions/options-delta-and-other-greeks-r427.md
- raw/steadyoptions/options-delta.md
- raw/steadyoptions/options-gamma.md
- raw/steadyoptions/options-greeks-essentials-r302.md
- raw/steadyoptions/options-greeks-explained-r293.md
- raw/steadyoptions/options-greeks-myths-and-realities-r305.md
- raw/steadyoptions/options-greeks.md
- raw/steadyoptions/options-theta.md
- raw/steadyoptions/options-time-decay-explained-understanding-theta-r754.md
- raw/steadyoptions/options-vega.md
- raw/steadyoptions/quantitative-analysis-not-just-numbers-r348.md
- raw/steadyoptions/steadyoptions-2019-performance-analysis-r544.md
- raw/steadyoptions/steadyoptions-strategies-analysis-r458.md
- raw/steadyoptions/what-is-delta-hedging-r797.md
- raw/steadyoptions/what-is-gamma-hedging-and-why-is-everyone-talking-about-it-r714.md
- raw/steadyoptions/why-dollar-delta-will-change-your-trading-r275.md
- raw/steadyoptions/why-you-should-not-ignore-negative-gamma-r86.md
