---
## Group Summary: Greeks - Theta

### Overview
Theta quantifies time decay—the daily erosion of an option's extrinsic (time) value as expiration approaches. Unlike other Greeks (delta measures direction, gamma convexity, vega volatility), theta is directional in time, not price. Long options have negative theta (time works against you); short options have positive theta (time works for you). Theta decay accelerates exponentially as expiration nears, creating the "time value cliff" in the final week before expiration. Understanding theta is essential for income-generation strategies (short premium) and for understanding why long-dated options retain value beyond intrinsic.

### Key Insights
- **Theta = daily dollar loss from time decay alone** (stock price and volatility held constant): theta of -0.05 per day means a $1 option loses $0.05/day or $1.00 over 20 days. For sellers, this is positive: -0.05 theta on a short position = +$0.05/day profit from time decay (Investopedia, Tastytrade).
- **Theta is asymmetric between buyers and sellers**: buyers lose theta value daily (negative theta hurts you); sellers gain theta daily (positive theta helps you). This is the core income-generation advantage of selling premium—time works in your favor while you wait for the underlying to stay range-bound.
- **Theta is highest for ATM options and near expiration**: an ATM call expiring in 1 day might have theta -0.30 (loses $30 from one day's decay); an ATM call expiring in 90 days might have theta -0.02 (loses $2 from one day's decay). Deep OTM/ITM options have minimal theta because they have little time value left.
- **Theta decay is front-loaded—accelerates in the final week**: most time value is captured in the first 30-40 days of decay; the final 7 days accelerates dramatically. This is why short-duration premium selling (7-14 DTE) captures theta most efficiently: decay rate is highest, absolute premium dollars are still meaningful.
- **Theta continues on weekends** (7-day decay, not 5-day trading decay): option pricing models include weekends in expiration countdown. A $1 option on Friday before a 3-day weekend decays over 3 days (Sat/Sun/Mon holiday), not 1 day. This creates inefficiency: weekend theta loss without price movement possibility.
- **Theta-gamma tradeoff is fundamental**: short call sellers capture theta but face gamma losses if stock moves sharply ITM (delta flips, requiring expensive rehedging). Long call buyers face theta decay but gain gamma convexity. This tension means sellers must actively manage risk (rebalancing, rolling) while buyers are paid for holding convexity.
- **Intrinsic vs. extrinsic value decomposition determines theta sensitivity**: a $50 strike call on $45 stock has only extrinsic value (all subject to theta decay). A $40 strike call on $45 stock has $5 intrinsic + extrinsic; theta only decays the extrinsic portion. ITM options have lower theta than ATM because more value is intrinsic.

### Key Questions
- What's the optimal expiration date for theta harvesting across different volatility regimes? Does 7 DTE always win, or are there conditions where 14-21 DTE yields better risk-adjusted theta capture?
- For income strategies (short premium), what's the relationship between position size, theta decay rate, and maximum acceptable loss from adverse gamma moves?
- Can theta be systematically predicted by regressing daily option price decay against calendar time, or does volatility and price movement cause realized theta to deviate significantly from option pricing models?

### Major Patterns & Themes
- **Theta is a seller's income stream, but requires market view**: if you're "neutral" on the underlying and sell premium, theta decay is pure profit (assuming assignment doesn't happen). If the underlying is rising and you're short calls, theta income is partially offset by gamma losses (deltas increase, forcing rehedging). The income only materializes if your directional view is correct.
- **Near-expiration trading exploits theta acceleration**: 1-DTE option strategies (straddles, strangles) can be profitable from theta acceleration alone (1 day → expiration day), without large underlying moves, if the closing bid-ask spread is tight.

### File List

raw/investopedia/theta.md
raw/predictingAlpha/what-is-theta-options.md
raw/projectoption/option-theta.md
raw/projectoption/why-theta-decay-isnt-linear.md
raw/steadyoptions/ep-options-theta.md
raw/steadyoptions/options-theta.md
raw/steadyoptions/options-time-decay-explained-understanding-theta-r754.md
raw/tastytrade/theta.md
