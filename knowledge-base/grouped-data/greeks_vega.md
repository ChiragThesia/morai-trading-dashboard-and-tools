---
## Group Summary: Greeks - Vega

### Overview
Vega measures implied volatility sensitivity—how much an option's price changes per 1% change in IV. Both calls and puts have positive vega (both benefit from IV expansion). Unlike delta (directional), gamma (convexity), and theta (time decay), vega is a separate dimension of risk: you can have delta-hedged, gamma-neutral, theta-matched positions that still have massive vega exposure. IV crush post-earnings (20-50% IV compression) is the most predictable vega move in trading, making event-driven vega strategies central to professional volatility trading.

### Key Insights
- **Vega = dollar change per 1% IV change**: vega 0.20 means 1% IV rise = $0.20 option price increase ($20 per contract). This compounds with other Greeks—an ATM call might have delta 0.50, gamma 0.05, vega 0.20, theta -0.03, meaning it's exposed to price, convexity, volatility, and time simultaneously.
- **Vega is highest for ATM, longer-dated options**: 180-day ATM calls have vega ≈ 0.50; 30-day ATM calls have vega ≈ 0.15; 1-day ATM calls have vega ≈ 0.01. This creates calendar spread vega profits: long 180-day ATM call (vega +0.50) + short 30-day ATM call (vega -0.15) = net long 0.35 vega. If IV expands, the long contract gains more than the short loses.
- **IV crush post-catalysts is the most reliable vega trade**: implied volatility collapses 20-50% in minutes after earnings, FOMC, earnings calls, regardless of move direction (Predicting Alpha, Steadyoptions). Short straddles/strangles benefit from IV crush even if the move was large, because remaining days-to-expiration still have vega exposure.
- **Vega-neutral strategies isolate directional/gamma exposure**: buy 2 ATM 100 calls (vega +0.40 each) + sell 1 ATM 102 call (vega +0.25) = net long 0.55 vega. But replace one ATM call with a tighter ITM call (lower vega) or OTM call (lower vega), and you can achieve net zero vega while staying long gamma for specific directional moves.
- **IV term structure creates consistent calendar spread opportunities**: the "volatility smile" shows that short-dated options (near catalysts) have inflated IV; longer-dated options have more stable IV. Selling near-term IV and buying longer-term IV is a profitable bet that IV normalizes post-event.
- **Vega and theta are partially in tension**: buying long-dated ATM calls (high vega, low theta decay) isolates volatility bets; buying short-dated ATM calls (low vega, high theta decay) accelerates theta income but removes vega exposure. Your timescale determines which Greek matters most.
- **IV "skew" and "smile" create cross-gamma/vega structures**: puts (especially OTM) often trade at higher IV than calls (protective demand from fund managers). This creates opportunities: sell OTM put vega, buy ATM call vega, capture the skew compression over time.

### Key Questions
- Can IV "fair value" be estimated from historical realized volatility + term structure + skew, or is IV inherently forward-looking with no quantitative anchor?
- For event-driven vega plays (earnings IV crush), what position sizing maximizes vega profit while minimizing gamma explosion losses if the move is extreme?
- How does vega interaction with dividend dates (early assignment risk, IV adjustments) complicate multi-leg vega strategies?

### Major Patterns & Themes
- **Volatility of volatility (VoV)—vol's own volatility—creates meta-trading**: if historical realized vol is 15% but IV is 20%, that 5% spread is the "variance risk premium." Selling options when IV > realized vol is systematically profitable (on average), but timing remains difficult.
- **Vega clustering: all long-dated ATM vega tends to move together**: when market VIX rises, all options get more expensive (IV expansion across all strikes/expirations). Vega diversification requires trading different underlyings, not just different structures on the same name.
- **IV mean-reversion is weak but consistent**: extremely high IV (>80th percentile) tends to compress; extremely low IV (<20th percentile) tends to expand. This creates systematic short-vega opportunities in high-IV regimes and long-vega opportunities in low-IV regimes, but reversions are gradual (weeks, not days).

### File List

raw/investopedia/vega.md
raw/predictingAlpha/what-is-vega-options.md
raw/projectoption/option-vega.md
raw/steadyoptions/ep-options-vega.md
raw/steadyoptions/options-vega.md
raw/tastytrade/vega.md
