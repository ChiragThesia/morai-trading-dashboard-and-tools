## Group Summary: Options Strategies & Implementation

### Key Insights
- Debit spreads (long calls/puts) offer defined maximum loss at entry, making them suitable for directional traders with precise risk budgets; credit spreads (shorts with protective long legs) provide income but require careful position sizing since maximum loss can exceed premium collected if markets move significantly against the position.
- The put-call parity relationship (Call - Put = Stock Price - Strike Price - Present Value of Dividends) creates arbitrage opportunities and links synthetic long stock positions to call/put spreads, allowing traders to replicate stock payoffs using options with better capital efficiency and defined risk.
- The "anchor strategy" (writing calls against long stock holdings) blends covered call income with protective long position, creating a structured income approach that captures premium while defining maximum loss. Success depends on understanding that capped upside is a feature, not a bug, when income goals drive portfolio construction.
- Strike selection in put-writing and spread strategies fundamentally determines profitability—selecting 1-2 standard deviations out of the money aligns probability of profit (typically 65-70% on put spreads) with adequate risk premium to justify taking the trade; tighter strikes increase probability but reduce income, while further out-of-the-money strikes boost premium at the cost of losses when breached.
- Naked put sales and covered calls have identical payoff profiles despite perceived risk differences—both are short-stock-equivalent positions with upside capped and downside exposed; proper position sizing is therefore equally important for naked puts as for covered calls, not optional as many retail traders assume.

### Key Questions
- What strike selection approach optimally balances probability of profit against risk-adjusted premium collection across different volatility regimes and underlying price levels?
- How should traders mechanically roll or exit positions when underlying prices approach strike prices? What are the pros and cons of rolling early versus waiting for closer proximity to expiration?
- How can traders compare the relative attractiveness of different spread structures (bull call spreads vs. bear call spreads vs. iron condors vs. calendars) using a unified framework that accounts for probability, risk-reward, and capital efficiency?

### File List
- raw/projectoption/bear-call-spread.md
- raw/projectoption/bear-put-spread.md
- raw/projectoption/bull-call-spread.md
- raw/projectoption/bull-put-spread.md
- raw/projectoption/call-vs-put.md
- raw/projectoption/cash-secured-put.md
- raw/projectoption/covered-call.md
- raw/projectoption/implied-volatility.md
- raw/projectoption/iron-condor-options-strategy.md
- raw/projectoption/long-call-option.md
- raw/projectoption/long-gamma-vs-short-gamma.md
- raw/projectoption/long-put-option.md
- raw/projectoption/long-straddle.md
- raw/projectoption/long-strangle.md
- raw/projectoption/option-delta.md
- raw/projectoption/option-gamma.md
- raw/projectoption/option-theta.md
- raw/projectoption/option-vega.md
- raw/projectoption/options-trading-explained.md
- raw/projectoption/protective-put-option.md
- raw/projectoption/short-call-option.md
- raw/projectoption/short-put-option.md
- raw/projectoption/short-straddle.md
- raw/projectoption/short-strangle.md
- raw/projectoption/wheel-options-strategy.md
- raw/projectoption/why-theta-decay-isnt-linear.md
- raw/tastytrade/analyzing-options-greeks.md
- raw/tastytrade/covered-call.md
- raw/tastytrade/covered-put.md
- raw/tastytrade/delta.md
- raw/tastytrade/gamma.md
- raw/tastytrade/how-to-trade-options.md
- raw/tastytrade/long-call-calendar-spread.md
- raw/tastytrade/long-call-diagonal-spread.md
- raw/tastytrade/long-call-vertical-spread.md
- raw/tastytrade/long-call.md
- raw/tastytrade/long-put-calendar-spread.md
- raw/tastytrade/long-put-diagonal-spread.md
- raw/tastytrade/long-put-vertical-spread.md
- raw/tastytrade/options-greeks.md
- raw/tastytrade/short-call-vertical-spread.md
- raw/tastytrade/short-iron-condor.md
- raw/tastytrade/short-put-vertical-spread.md
- raw/tastytrade/short-put.md
- raw/tastytrade/theta.md
- raw/tastytrade/vega.md
- raw/tastytrade/what-are-options.md
