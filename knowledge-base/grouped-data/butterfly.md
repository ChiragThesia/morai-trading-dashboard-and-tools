---
## Group Summary: Butterfly Spreads

### Overview
This collection of 27 files covers butterfly spread strategies across multiple platforms (SteadyOptions, Investopedia, Predictable Alpha, Quantocracy) and underlying types (stocks, ETFs, indexes). Core structure: three equidistant strikes with simultaneous entry/exit, defined risk/reward profile. Two primary variants: traditional butterfly (3 contracts, net debit) and iron butterfly (4 contracts, net credit). Key insight: butterflies exploit theta decay + IV crush mechanics but require precise price prediction. Best-suited for range-bound, low-volatility environments. Success depends on realistic cost modeling and predefined adjustment thresholds.

### Key Insights
- **Long Butterfly Core Structure: Three Equidistant Strikes, Net Debit**: Buy ITM wings, sell ATM body. Maximum profit ONLY achieved when underlying exactly at body strikes at expiration (narrow profit zone). Cost structure: $5 wide might cost $2.15 debit with $2.85 max profit (132% return if held to expiration). Maximum loss = debit paid (risk is defined, unlike naked short options). Time decay + IV crush provide dual profit mechanisms.

- **Iron Butterfly = Credit Spread with Identical P&L**: Combines bear call spread + bull put spread (short straddle + long strangle). Credited upfront (net credit), margin requirement = width - credit. Example: $2.85 credit on $5 wide = $2.15 margin requirement (identical to traditional butterfly's $2.15 debit). P&L payoff diagram identical to call/put butterfly. Choice between traditional vs iron: depends on margin availability and assignment risk tolerance, not profit potential.

- **Theta Decay is Concentrated in Final Weeks**: ATM options decay faster than ITM/OTM; profit peaks into expiration. Holding through final 2-3 weeks extracts maximum theta. But if underlying far from body at late stage, theta decay accelerates losses (both long and short options near worthless, but short moves favor short). Early exit (20-30% of max profit target) prevents reversal risk into final week.

- **Vega Negative: IV Expansion Hurts Position**: Increases in implied volatility help long options more than short (long options 30-60 DTE, short options 5-7 DTE). When IV rises due to stock move (indicating volatility event), calendar structure can't compensate fast enough—both options lose value together. IV crush (post-earnings) beneficial ONLY if short options benefit from acceleration into expiration more than long options benefit from IV expansion.

- **Strike Width vs Cost-Profit Tradeoff**: Tighter spreads ($2-3 wide) cost less but require precise price forecasting (stock must be within narrow band). Wider spreads ($5+ wide) have higher absolute profit but higher debit. Example: $2 wide butterfly = $0.70 cost, $1.30 max profit (186% return) vs $5 wide = $2.15 cost, $2.85 max profit (132% return). Width choice depends on directional confidence and capital efficiency needs.

- **Assignment Risk Limited on Spreads**: If short call assigned, you're short shares but long call at higher strike (covered). If short put assigned, you're long shares but long put at lower strike (protected). Assignment by itself not loss-generating UNLESS causes margin call forcing liquidation of long hedge during gap opening. With proper margin sizing, assignment is merely position conversion (naked short → stock + call hedge).

- **Butterflies Require Market Regime Support**: Work best when stock in trading range (mean-reversion environment). Stock in strong trend frustrates butterfly (can't profit if moving away from body strike). Ideal conditions: VIX <20, stock price stable, earnings >3 weeks away. Post-earnings IV crush beneficial if short options expire days after event (accelerating theta decay advantage).

- **Short/Reverse Butterfly Inverts Payoff Profile**: Sell body, buy wings—profits from significant moves in either direction beyond body strikes. Thesis: expect volatility. Max profit at extremes (stock well above upper wing or below lower wing). Max loss = width - credit. Theta decay works AGAINST reverse butterfly (need stock to move to make profit, but theta shrinks). Better for earnings-related volatility (uncertain direction, expect move).

### Key Questions
- **Can You Forecast Stock Price Within Strike Width ±0.5% in 30 Days?** Butterflies require narrow price bands for profit. If unsure, better to use vertical spread (wider profit zone) or straddle (bet on volatility magnitude). Butterflies punish directional uncertainty—even 1% miss cuts profit by 50%.
- **What's Your Adjustment Plan if Stock Moves 1-2% in First Week?** If no plan, losses compound quickly. Options: (1) exit at predetermined loss (15-20% of debit), (2) roll short to new strike in direction of move, (3) add butterfly at new strike to "move the tent." Pre-define thresholds before entry.
- **Is IV Depressed Enough to Justify Entry Costs?** Compare current IV to 52-week range. Bottom 25% = good entry. Avoid entering at IV peaks (long options expensive, debit high). Post-earnings IV crush ideal—short options lose value to theta faster than long options benefit from IV rise.

### Major Patterns & Themes
- **Defined Risk Deceptive**: Max loss defined mathematically, but commissions, early exit pressure, and adjustment costs reduce realized profits. 4-leg spread at $1 commission = $4 cost; on $285 max profit = 1.4% drag. Unlikely to realize full max profit (stock rarely settles exactly at short strike).

- **Precision Requirement Penalty**: Unlike directional spreads with wide profit zones, butterflies require stock within narrow band for profit. Increases execution difficulty and demands accurate directional forecasting. Position concentration in small price range = higher probability of loss.

- **Greeks Interact Non-Linearly at Expiration**: Delta, gamma, and theta all accelerate into expiration. Gamma risk highest mid-range (fastest delta change); losses accelerate if underlying swings. Final week: theta dominance but gamma explosion if near short strikes.

- **Commissions Consume Material Portion**: 3-4 legs × $1-2 round-trip commission = $6-8 total. On $285 max profit, this is 2-3% drag. Better suited for high-priced underlyings ($100+) where percentage impact minimal. Low-priced stocks (<$50) economically infeasible for butterflies.

- **Strike Width Determines Risk-Return Geometry**: Narrow spreads capital-efficient but require precision. Wide spreads allow more price movement but higher absolute debit required. Choose based on capital constraints and directional conviction.

### File List

raw/investopedia/iron-butterfly.md
raw/investopedia/modified-butterfly-spread.md
raw/predictingAlpha/what-is-an-iron-butterfly.md
raw/quantocracy/docs/capturing-volatility-risk-premium-using-butterfly-option-strategies.md
raw/quantocracy/docs/options-iron-butterfly.md
raw/quantocracy/docs/rhino-strategy-family-from-broken-wing-butterfly-to-genetic-optimization.md
raw/steadyoptions/4-low-risk-butterfly-trades-for-any-market-r146.md
raw/steadyoptions/apple-dissecting-the-butterfly-trade-r14.md
raw/steadyoptions/butterfly-spread-strategy-the-basics-r424.md
raw/steadyoptions/using-directional-butterfly-spread-r219.md
