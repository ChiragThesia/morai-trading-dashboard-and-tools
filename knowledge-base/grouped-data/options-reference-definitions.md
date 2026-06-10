## Group Summary: Options Reference Definitions

### Overview
This group contains two reference files: a comprehensive Investopedia article on the Iron Condor strategy (a market-neutral 4-legged spread) and a trading terms glossary covering 150+ definitions spanning everything from basic concepts (bid/ask, ATM, ITM/OTM) to advanced strategies (spreads, synthetic positions, leverage structures) and account types (cash accounts, margin, CFD, proprietary). The Iron Condor article focuses on practical mechanics—how to construct, manage, and size the position—while the glossary serves as a foundational reference for traders building vocabulary and understanding market mechanics.

### Key Insights
- **The Iron Condor is a defined-risk, market-neutral strategy that profits from time decay and low volatility**, constructed by selling 4 options: short call spread (sell near strike, buy far OTM) + short put spread (sell near strike, buy far OTM) on the same expiration. Unlike the wheel (which is directional and requires assignment), iron condors cap profit at premium collected and loss at strike width minus premium, making them suitable for range-bound environments where the underlying stays between the short strikes until expiration.

- **Iron Condors require precise strike selection and expiration timing to balance probability, reward, and risk**: Selling calls and puts further OTM (30-delta, 45-60 DTE) increases probability of expiration worthless but reduces premium; selling closer ATM increases premium but increases probability of assignment/loss. The strategy works best on broad-based index options (SPX, NDX, RUT) rather than individual stocks because indexes are less prone to gap moves that can wipe out positions overnight.

- **Maximum loss is bounded but requires active management to avoid losses exceeding maximum profit**: Maximum loss = (strike width - premium collected) × 100; with 10-point spreads and $250 premium collected, worst-case is $750 loss per iron condor. However, this assumes holding to expiration—in reality, traders lock in losses early or reverse direction if the underlying moves against them, meaning actual losses depend on exit discipline, not on the theoretical maximum.

- **The glossary reveals layered complexity in trading fundamentals**: Core concepts (long/short, bid/ask, calls/puts, ATM/ITM/OTM, strike price) are foundational, but sophisticated traders must understand structural mechanics (margin accounts vs. cash accounts, settlement timelines T+3 vs. T+1, borrowing shares for shorting), leverage implications (2x overnight, 4x intraday for US brokers, 50x for CFDs), and technical features (dark pools, ECNs, market makers, smart routing) that directly impact execution quality and risk management.

- **Options Greeks and payoff profiles are distinct concepts that both matter**: The Iron Condor article references payoff diagrams showing profit/loss across price ranges at expiration, but doesn't deeply discuss theta decay mechanics over time (how quickly the position makes money with each passing day). The terms glossary covers volatility, Greeks indirectly (RSI, MACD, Bollinger Bands), and leveraging mechanics but lacks explicit definitions of delta, gamma, vega, and theta—critical concepts for understanding how position value changes intraday and near expiration.

- **Account structure choices profoundly affect trading capability and capital efficiency**: Cash accounts require T+3 settlement but offer no margin; margin accounts allow day trading and intraday leverage (4x for US brokers) but subject traders to margin calls and forced liquidations; CFD accounts (illegal in US) allow virtual leverage up to 50x but create counterparty risk. For wheel traders and iron condor sellers, margin accounts are essential, but margin calls during downside moves can force exits at exactly the wrong time.

- **The Iron Condor's risk management superiority over naked calls/puts is structural**: Selling naked calls on SPY has been a losing strategy since 2007 (backtested results show -0.20% annual returns), but iron condors cap the loss with a long option. The tradeoff is lower profit potential, but the probability of finishing profitable is higher, making iron condors better suited for consistent small gains versus high-variance large wins/losses.

### Key Questions
- How do you choose between iron condors on broad indexes (SPX, NDX, RUT) versus individual stocks or sector ETFs, given that individual names gap risk can wipe out positions, but index illiquidity may widen spreads?
- What is the optimal ratio between capital deployed to wheel strategies (cash-secured puts for stock acquisition) versus iron condors (purely income from spreads), given different market regimes and volatility environments?
- How should traders think about the Greeks—especially gamma risk near expiration and vega exposure to volatility regime shifts—when the glossary defines option mechanics but doesn't explain Greeks explicitly?

### Major Patterns & Themes
- **Vocabulary as foundational literacy**: The glossary emphasizes that trading requires mastery of 150+ terms spanning mechanics (bid/ask, settlement timelines), strategy names (spreads, condors, collars), and structural concepts (dark pools, routes, leverage). Traders fluent in this vocabulary can reason about positions systematically; those without it will make costly mistakes (e.g., not understanding T+3 settlement or margin account leverage).

- **Risk always comes in hidden forms**: Naked call selling looks profitable until tested over 17 years of data; iron condors appear to cap risk but require active management; leverage amplifies returns but also wipes accounts in margin calls. The glossary entries on margin calls, dark pools (showing how prices can be worse than visible spreads), and leverage illustrate that understanding mechanics is a prerequisite to managing risk.

- **Strategy selection depends on market regime and capital constraints**: Wheel strategies work in sideways-bullish markets and generate income + stock acquisition; iron condors profit in low-volatility ranges. The glossary reveals that both can be magnified through leverage and spread across correlated underlyings (via diversification), but require different account structures and monitoring frequency.

### File List

raw/investopedia/iron-condor.md
