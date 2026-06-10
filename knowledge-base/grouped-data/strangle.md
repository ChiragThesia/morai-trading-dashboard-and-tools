## Group Summary: Strangle Strategies

### Key Insights
- Long strangles are lower-cost alternatives to long straddles, requiring larger directional moves to profit but exposing traders to less capital. Strangles buy OTM puts and calls at different strikes, requiring moves beyond both strikes to profit; OTM theta decay is front-loaded, with options losing 50% of value by 29 DTE, meaning traders must be right sooner rather than later to overcome time decay.
- Pre-earnings strangles are low-probability trades: holding through earnings is typically destructive due to IV crush despite favorable moves. Example data from 2011: AKAM moved 15% yet the straddle lost 7% (IV crush from 84% to 47%); BIDU moved only 4.5% with a 31% loss. Only exceptional moves like NFLX's 34.9% rally produce substantial profits, and such moves are rare and unpredictable.
- Short strangles generate consistent income through theta decay in sideways markets, with breakevens extending ±25% from entry. Negative gamma creates accelerating losses as stock moves toward short strikes, with delta shifting against the trader. Naked short strangles carry unlimited upside risk and substantial downside risk, requiring disciplined position sizing—avoiding the portfolio margin leverage trap that destroyed many traders.
- Strike selection via delta determines probability of profit and risk/reward: 16-delta options place strikes near one standard deviation (roughly 68% probability both expire worthless); 30-delta options increase probability to 60% of max profit but reduce premium collected. Asymmetric deltas allow directional bias while maintaining strangle structure.
- Short strangle portfolios benefit from diversification across non-correlated underlyings (SPY, IWM, FXE, TLT, GLD, XLE), with individual short strangles generating 6-7% annual returns without leverage. Portfolio management requires dynamic profit targets (16-delta credit instead of static 50%), rolling untested sides at 21 DTE, and volatility-based position sizing increases when IVR exceeds 50%.
- Passive management of short strangles—holding until expiration without adjustment—outperforms active management in backtests. Frequent closing at 50% profit and defensive rolling both reduce expected value. Holding to expiration captures accelerated front-loaded theta decay but requires emotional discipline during adverse moves.
- Expected value analysis reveals strangles and straddles have similar EV despite different probability structures: straddles have higher probability but lower payout; strangles have lower probability but higher reward. Long volatility traders prefer pre-earnings entry 2-15 days before announcement, exiting before the event to avoid IV crush.

### Key Questions
- Should pre-earnings strangle entry timing vary by stock, and how do historical volatility regimes affect optimal entry windows compared to the standard 7-10 day window?
- What is the optimal profit-taking threshold (percentage of max or delta-based) and does it vary by underlying volatility regime and strike selection?
- How should position sizing on naked strangles scale with volatility levels, and what is the optimal portfolio leverage given the risk of 20-30% drawdowns?

### File List
raw/projectoption/long-strangle.md
raw/projectoption/short-strangle.md
raw/steadyoptions/building-a-short-strangles-portfolio-r517.md
raw/steadyoptions/bullish-short-strangles-r528.md
raw/steadyoptions/does-managing-winners-add-value-to-short-strangles-r618.md
raw/steadyoptions/enhancing-6040-with-a-short-strangle-overlay-r641.md
raw/steadyoptions/long-strangle-option-strategy-the-ultimate-guide-r769.md
raw/steadyoptions/selling-naked-strangles-the-math-r512.md
raw/steadyoptions/selling-strangles-prior-to-earnings-r277.md
raw/steadyoptions/the-gut-strangle-strategy-r419.md
raw/steadyoptions/why-not-to-hold-strangles-through-earnings-r687.md
