---
## Group Summary: Greeks - Gamma

### Overview
Gamma measures how fast delta changes—the convexity of the option's price curve. Long options have positive gamma (delta accelerates favorably with moves in either direction), while short options have negative gamma (delta accelerates unfavorably). Gamma is highest for ATM options and shortest expirations, creating gamma explosions near expiration where small price moves cause massive delta swings. Understanding gamma is critical for managing non-linear risk in spreads and understanding the fundamental tradeoff between selling theta (short options) and managing gamma risk (losses from large moves).

### Key Insights
- **Gamma = the rate of delta change**: if a call has delta 0.40 and gamma 0.13, a $1 rise in stock makes delta 0.53 (0.40 + 0.13). Gamma is approximated as the second derivative: how fast the first derivative (delta) changes (Investopedia, Projectoption).
- **Gamma is highest ATM (maximum convexity) and approaches zero far OTM/ITM**: ATM options have the most uncertainty in directional outcome, so delta is most sensitive to price moves; deep ITM calls are already committed to increasing delta (→1.0), deep OTM calls are committed to low delta (→0). This creates a "smile" shape in gamma across strikes.
- **Long gamma = profit from volatility (moves in either direction)**; short gamma = losses from volatility: long call at 100 strike with stock at 100 profits if stock moves to 95 OR 105 (delta hedged, you buy low/sell high); short call (sold gamma) loses on both moves because delta flips against you as you rebalance.
- **Gamma explodes near expiration for ATM options**: with 60 DTE and stock at strike, gamma ≈ 0.05; with 1 DTE and stock at strike, gamma ≈ 0.40+. A $1 move now swings delta from 0.25 to 0.75 instead of 0.45 to 0.55. This creates emergency rebalancing costs and makes hedging near expiration prohibitively expensive.
- **Gamma-neutral positions eliminate convexity but aren't perfectly delta-neutral**: long 2 ATM 100 calls (each gamma 0.05, net +0.10) + short 1 ATM 102 call (gamma 0.03, net -0.03) = net long 0.07 gamma. Net delta might be near-zero, but gamma exposure remains. Traders use gamma and delta together (gamma-delta hedging) for full non-linearity management.
- **Gamma scalping is a continuous income strategy**: hold long options (positive gamma), delta-hedge via stock shorts. As stock moves, rehedge (buy stock after drops, sell after rallies), capturing the bid-ask spread repeatedly. Profits if realized vol > option's implied vol (all else equal), but theta decay erodes gains.
- **Short gamma (selling premium) requires active management**: a short straddle seller must defend the position as stock approaches strikes, constantly buying/selling stock to rebalance deltas. Failure to manage gamma leads to cascading losses as delta moves exceed rebalancing costs.

### Key Questions
- What's the optimal rebalancing frequency for gamma scalping (every $0.10 move vs. every $0.50 vs. daily vs. weekly)? How does realized gamma profit vary by rebalancing frequency and transaction cost assumption?
- For multi-leg spreads (bull call spreads, strangles, etc.), how do you calculate net gamma across strikes and manage when net gamma is undesirable?
- Can gamma scalping profits be systematized? Does realized vol > IV consistently for specific underlyings/regimes to enable algorithmic hedging?

### Major Patterns & Themes
- **Gamma and theta are typically in tension**: short options give positive theta (decay benefits you) but negative gamma (large moves hurt you); long options have negative theta but positive gamma. Option sellers accept gamma risk to capture theta income.
- **Gamma convexity creates optionality value**: this is why longer-dated options are worth "more than" shorter-dated options even if they have the same delta—longer options have more gamma upside potential from subsequent moves.

### File List

raw/investopedia/gamma.md
raw/predictingAlpha/what-is-gamma-options.md
raw/projectoption/long-gamma-vs-short-gamma.md
raw/projectoption/option-gamma.md
raw/steadyoptions/ep-gamma-scalping-options-trading-strategy.md
raw/steadyoptions/ep-options-gamma.md
raw/steadyoptions/estimating-gamma-for-calls-or-puts-r554.md
raw/steadyoptions/gamma-risk-explained-introduction-and-example-r735.md
raw/steadyoptions/long-gamma-vs-short-gamma-options-strategy-explained-r730.md
raw/steadyoptions/market-neutral-strategies-long-or-short-gamma-r95.md
raw/steadyoptions/options-gamma.md
raw/steadyoptions/what-is-gamma-hedging-and-why-is-everyone-talking-about-it-r714.md
raw/steadyoptions/why-you-should-not-ignore-negative-gamma-r86.md
raw/tastytrade/gamma.md
