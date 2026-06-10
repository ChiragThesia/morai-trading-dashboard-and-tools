---
## Group Summary: Backtesting & Optimization

### Overview
This collection of 37 files covers backtesting methodology, pitfalls, and best practices from academic perspectives (Swedroe 5-factor framework) and practitioner experiences (SteadyOptions, Quantocracy). Core tension: historical backtests are necessary but insufficient validation tools. Single market path provides one realization from infinite distribution; perfect backtests often signal overfitting. Multi-path synthetic generation, walk-forward analysis, and factor robustness checks required for honest performance estimates. Emphasis on six simultaneous validation threats and five trustworthiness criteria separating durable factors from data mining artifacts.

### Key Insights
- **Single-Path Backtesting is Statistically Incomplete**: One historical realization is likely one outcome from vast distribution of possibilities. Vorobets synthetic resampling shows CVaR optimization outperforms variance not by accident but structurally (holds across 100 simulated paths). Only 10 observations below 90% VaR threshold needed for CVaR superiority to manifest. Perfect historical performance often indicates overfitting to period-specific anomalies.

- **Six Validation Threats Must Be Simultaneously Addressed**: (1) Overfitting—model memorizes noise; (2) Data snooping—multiple hypothesis testing without correction; (3) Survivorship bias—only surviving securities examined; (4) Look-ahead bias—future data leaks into training period; (5) Non-stationarity—regimes shift invalidating old patterns; (6) Inadequate cost modeling—ignores real friction (1-3% annual). Any one undermines strategy.

- **Transaction Costs Severely Underestimated by Researchers**: Most backtests apply costs only at round-trip level; reality requires proportional costs on EVERY rebalancing. Slippage, market impact, bid-ask spread, borrowing costs compound to 1-3% annually. Strategy backtesting 12% annual return becomes 9-11% net after realistic friction. At $2-3 billion AUM, these percentages represent $20-60M per year impact.

- **Five Trustworthiness Criteria Distinguish Persistent Factors**: (a) Persistent across time (10+ years minimum)—S&P 500 returning -1%/yr for 2000-2009 didn't invalidate equity factor; (b) Pervasive across markets (stocks, bonds, commodities, currencies, all geographies)—value effect found in 16 countries; (c) Robust to alternative definitions (P/B, P/E, P/S all work for value)—not parameter-dependent; (d) Investable (survives real costs/fees/taxes)—limits-to-arbitrage explanation for persistence; (e) Intuitive (risk-based or behavioral explanation)—not just historical accident.

- **Moving Average Crossovers Generate Positive Returns on RANDOM DATA**: Demonstrates data snooping mechanism—search space is so large that any optimization finds spurious patterns. If tested enough parameter combinations, MA crossovers work on noise. This warns against parameter optimization without cross-validation across independent data.

- **Five Factors Pass All Trustworthiness Tests**: (1) Market factor (stocks >T-bills), risk-based; (2) Term factor (long bonds > short), risk-based; (3) Size factor (small > large), risk-based; (4) Value factor (low P/multiple > high), risk+behavioral; (5) Momentum factor (past 6-12m winners > losers), behavioral; (6) Volatility premium (selling puts/calls > expected), risk-based. Others fail at least one test.

- **Walk-Forward Analysis More Honest Than Single Backtest**: Divide historical data into rolling training/testing windows. Re-optimize strategy on each training window, test on holdout window. Prevents data snooping by using fresh out-of-sample data. Multiple rolling windows reveal distribution of returns, not just single historical path. Required for honest performance assessment.

### Key Questions
- **How Do You Distinguish Genuine Edge from Overfitting Before Risking Capital?** Apply Swedroe 5-test framework: persistent (multiple decades), pervasive (multiple markets), robust (alternative definitions), investable (real costs), intuitive (rational explanation). If fails any test, likely spurious. Back-test using synthetic paths (100+ simulated), not just single historical.
- **What Are Your Realistic Friction Costs?** Slippage + market impact + bid-ask + borrowing = 1-3% annually for most strategies. At $1B AUM, this is $10-30M per year. Reduces "backtested 12% return" to actual 9-11%. If strategy margin < 2%, unlikely to survive real implementation.
- **How Does Your Strategy Perform in Different Market Regimes?** Test trending vs ranging, high vol vs low vol, crisis vs normal conditions, rising vs falling yields. Strategy optimal in trending market may fail in range-bound periods. Regime-dependent edge is not true alpha (not portable). True alpha works across regimes.

### Major Patterns & Themes
- **Overfitting Risk is Systemic and Incentive-Driven**: Researchers publish profitable strategies (not unprofitable ones); journals prefer novel results; career advancement requires publication; mutual funds market attractive backtests to investors. "Nobody has ever seen a bad backtest." Result: probability of finding spurious pattern increases with testing effort (multiple comparisons problem).

- **Reality Gap Between Backtest and Live Trading**: Costs (transaction, commissions, slippage) not modeled; slippage in back-test often 1-2 basis points, reality 5-20 bp; market impact ignored; regime changes happen; correlations break down; new competitors enter market. Backtest 20% return → 12-15% reality post-friction and adaptation.

- **Historical Period Selection Bias**: Different time periods show different factor premiums. 1980-2000 tech boom favors growth; 2000-2010 favors value; 1970-1980 favors commodities. Backtest on entire period. Walk-forward on rolling windows. Avoid cherry-picking favorable period.

- **In-Sample vs Out-of-Sample Degradation is True Measure**: Backtest on training period; test on held-out period. Ratio of out-of-sample Sharpe to in-sample Sharpe reveals overfitting. If ratio < 0.7, significant overfitting. Ratio 0.9+ suggests genuine robustness. Most backtests show 0.4-0.6 ratio.

- **Synthethic Path Generation Reveals Structural Advantage**: Generating 100 market paths from historical statistics shows whether strategy edge is broad-based or path-dependent. If outperforms on 70% of paths, likely robust. If only on historical realization, likely overfitted.

### File List

raw/abnormalreturns/docs/empirical-finance-blog-backtesting.md
raw/abnormalreturns/docs/marketsci-blog-backtesting-in-excel.md
raw/quantocracy/docs/backtest-powerful-intraday-trading-strategies.md
raw/quantocracy/docs/backtesting-course-from-rob-carver-march-7-and-8-in-person-and-remote.md
raw/quantocracy/docs/backtesting-the-opening-range-breakout-orb-strategy-using-polygon-io.md
raw/quantocracy/docs/backtesting.md
raw/quantocracy/docs/better-backtesting.md
raw/quantocracy/docs/can-we-backtest-asset-allocation-trading-strategy-in-chatgpt.md
raw/quantocracy/docs/day-13-backtest-i.md
raw/quantocracy/docs/day-15-backtest-ii.md
raw/quantocracy/docs/finding-an-edge-in-ipos-research-and-a-backtested-mechanical-trading-system.md
raw/quantocracy/docs/how-to-backtest-2000000-simulations-best-exits.md
raw/quantocracy/docs/improving-the-default-plot-timescale-for-backtesting-in-r.md
raw/quantocracy/docs/realistic-backtester-for-perpetual-futures-part-1-2-with-code.md
raw/quantocracy/docs/sketching-the-option-backtester-v2.md
raw/quantocracy/docs/taming-olmars-1222-backtest-into-a-sustainable-106-cagr.md
raw/quantocracy/docs/the-least-amount-of-assumptions-backtest.md
raw/quantocracy/docs/why-backtests-run-fast-or-slow-a-comparison-of-zipline-moonshot-and-lean.md
raw/steadyoptions/optionnet-explorer-one-options-backtesting-software-r743.md
raw/steadyoptions/when-can-you-trust-a-backtest-r499.md
