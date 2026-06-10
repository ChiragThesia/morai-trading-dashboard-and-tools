---
## Group Summary: Greeks - Delta

### Overview
Delta quantifies directional price exposure at the option level, enabling precise risk management across portfolios. While raw delta (a number between -1 and +1) describes directional probability, position delta (delta × 100 × contract count) translates to actual dollar P&L exposure. The core insight: delta is not constant—it changes as the underlying moves (gamma effect), requiring continuous rebalancing in delta-hedged strategies. Delta's relationship to moneyness, time decay, and volatility creates a complete language for discussing directional risk in multi-leg strategies.

### Key Insights
- **Position delta directly translates to portfolio P&L exposure**: 10 call contracts with +0.75 delta = +$750 position delta per $1 stock move. This is more actionable than saying "the option is 75% likely to expire ITM" because it quantifies actual risk in dollar terms (Tastytrade, Investopedia).
- **Delta ranges predictably by option moneyness**: call deltas go from ~0 (deep OTM) → 0.50 (ATM) → 1.0 (deep ITM); put deltas go from ~0 (deep ITM) → -0.50 (ATM) → -1.0 (deep OTM). This inverse relationship enables delta-neutral structures by combining calls and puts at different strikes (risk reversals, collars, spreads).
- **Gamma causes delta to accelerate as the underlying moves** (delta is the "speed," gamma is the "acceleration"): an ATM call with delta +0.50 becomes +0.60 if stock rises $1, then +0.70 if stock rises another $1. This convexity means delta-hedged positions need constant rebalancing, not just one-time hedges.
- **Short options flip delta sign, creating short gamma exposure**: selling a +0.50 delta call gives you -$50 position delta—you profit when stock falls, lose when it rises. This enables directional reversal strategies: short calls + long stock = short synthetic put; long calls + short puts = long synthetic stock.
- **Delta approximates probability of expiring ITM** but only in Black-Scholes framing: a 0.50-delta call ≈ 50% chance of finishing above strike (plus dividend adjustments). This probability weakens far OTM/ITM where delta → 0/1, and breaks down in real-world distributions with skew and jump risk.
- **Early-stage options have smooth delta changes; near-expiration deltas jump sharply**: a call at exactly the strike with 60 DTE has delta 0.50; with 1 DTE and stock at strike, any tick move causes massive delta jump (gamma spike). This makes hedging near expiration more difficult and expensive.

### Key Questions
- For delta-hedged positions (long options, short delta in stock), how do rebalancing frequency and transaction costs impact realized vs. implied volatility profit? Is quarterly rebalancing optimal or is continuous rebalancing necessary?
- Can delta's probability interpretation be systematically exploited by identifying when implied probability > realized frequency (for systematic edge)?
- How does delta's behavior change in gap-risk scenarios (earnings, takeovers, geopolitical shocks) where markets gap past strike prices between close and open?

### Major Patterns & Themes
- **Delta is foundational to portfolio Greeks**: all multi-leg strategies start with target portfolio delta (long 0.75 delta to stay bullish, delta-neutral spreads to isolate vega/gamma, short delta for bearish). Delta management comes before gamma/vega/theta considerations.
- **Delta hedging is a distinct trading strategy (not just risk management)**: continuously rebalancing at profitable prices (buy stock low after drops, sell high after rallies) captures gamma scalping profits while holding long options. This strategy is core to market maker profitability.

### File List

raw/abnormalreturns/docs/seeking-delta.md
raw/docs/13-delta-hedging.md
raw/investopedia/delta-adjusted-notional-value.md
raw/investopedia/delta-gamma-hedging.md
raw/investopedia/delta-neutral-trading-volatility.md
raw/investopedia/gamma-delta-neutral-spreads.md
raw/predictingAlpha/delta-hedging.md
raw/predictingAlpha/what-does-delta-mean-in-options.md
raw/projectoption/option-delta.md
raw/quantocracy/docs/implied-vs-realized-volatility-in-delta-hedging-strategies.md
raw/steadyoptions/delta-hedging-your-options-strategies-r402.md
raw/steadyoptions/delta-neutral-trading-what-not-to-do-and-how-to-fix-it-r752.md
raw/steadyoptions/ep-options-delta.md
raw/steadyoptions/estimating-delta-for-calls-or-puts-r552.md
raw/steadyoptions/options-delta-and-other-greeks-r427.md
raw/steadyoptions/options-delta.md
raw/steadyoptions/what-is-delta-hedging-r797.md
raw/steadyoptions/why-dollar-delta-will-change-your-trading-r275.md
raw/tastytrade/delta.md
raw/traderfeed/2006-01-using-market-delta-in-trading.md
raw/traderfeed/2009-04-market-delta-and-graphics-that-can-aid.md
raw/traderfeed/2009-09-reading-market-delta-charts-on.md
raw/traderfeed/2009-12-look-at-cumulative-delta-indicator.md
raw/traderfeed/2009-12-tracking-cumulative-delta.md
raw/traderfeed/2010-02-simulation-trading-with-market-delta.md
raw/traderfeed/2010-03-more-on-reading-traderfeed-market-delta.md
raw/traderfeed/2014-03-using-market-delta-to-visualize-real.md
