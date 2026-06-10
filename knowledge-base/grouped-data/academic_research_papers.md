---
## Group Summary: Academic Research Papers

### Overview
This collection synthesizes cutting-edge quantitative finance research spanning 28 papers on systematic trading, machine learning applications, and market structure. Core themes include the efficacy of simple mechanical rules vs. complex optimization, the role of volatility clustering in generating alpha, real-world implementation barriers for academic frameworks, and the surprising finding that many inefficiencies are exploitable despite being widely known. Research spans foundational work (1994 Moody-Saffell reinforcement learning) through modern applications (2018 deep RL on forex, 2016 formulaic alphas).

### Key Insights
- **Volatility Clustering as Core Alpha Engine**: Simple trend-following using 10-month SMA reduces S&P 500 max drawdown from 46% to <10% (Faber 2013); mechanism exploits that downtrends exhibit 60% lower returns AND 30% higher volatility. Parameter stability confirmed (works 3-12 month windows without degradation); Global TAA across 5 asset classes achieves equity returns with bond volatility using identical mechanical rules.

- **101 Real-World Formulaic Alphas Define Practical Limits**: Kakushadze's production-ready alphas hold 0.6-6.4 days with 15.9% average pair-wise correlation (surprisingly diversifiable); returns scale strongly with volatility (mu ~ sigma^0.76); turnover has NO explanatory power for returns, suggesting genuine signal not friction-driven noise.

- **Machine Learning Requires Domain-Specific Design, Not Off-Shelf Algorithms**: Risk-averse RL (Ritter) outperforms expected-value maximization when reward function encodes utility; deep DRQN on forex (Huang) achieves 23.8% annual returns with action augmentation eliminating random exploration; Moody-Saffell differential Sharpe ratio enables online risk-adjusted optimization; 10^7 samples required for convergence in RL approaches.

- **Dragon-Kings (Predictable Crashes) vs Black Swans (Unpredictable)**: Largest drawdowns (1929, 1987, 2000, 2008) are statistical outliers even relative to their own fat-tailed distributions (Sornette); Log-periodic power laws show super-exponential acceleration preceding crashes with measurable precursor signatures; phase transitions driven by positive feedback mechanisms (herding, leverage, margin calls) make some crises partially forecastable.

- **Mechanical Rules Outperform Optimized Complexity**: Paired-switching binary rotation (stocks/bonds negatively correlated) achieves 11.3% annual return, 9.3% volatility; simplicity enables robustness to regime change; alternatives to optimization: Hierarchical Risk Parity (Lopez de Prado) uses graph-theoretic dendrogram clustering producing more stable allocations than Markowitz mean-variance.

### Key Questions
- **Why do simple moving averages remain effective despite universal knowledge?** Answer: exploits structural volatility asymmetry (downtrends have both worse returns and higher volatility), not information inefficiency. Regularity based on market microstructure, not misvaluation.
- **How much backtest outperformance is genuine vs. survivor bias?** Kakushadze uses 4-year window with 1,006 trading days; Faber walk-forward 2006-2012; multi-geography testing (Swedroe framework) key validation. Trend/momentum the most pervasive factor globally.
- **Do ML/RL approaches offer genuine advantage over mechanistic rules?** Depends on problem: RL beats heuristics when handling transaction costs + position state (recurrent architecture required); but simple moving averages remain competitive at lower frequencies. Diminishing returns to complexity.
- **How can traders avoid catastrophic crash exposure without giving up equity returns?** Sornette suggests LPPL monitoring + diversification across uncorrelated dragon-king hedges (long vol, long puts, long gold). Standard VaR underestimates tail; need convex hedging.

### Major Patterns & Themes
- **Volatility Clustering Universality**: Present across stocks, bonds, commodities, real estate (Faber); drives trend-following edge; explains why downside protection (switching to cash) adds value without return drag.
- **Simplicity-Robustness Tradeoff**: 10-month moving average wins vs. dozens of factors; Kakushadze's 101 alphas work despite low correlation (diversifiable); Paired-switching outperforms complex TAA—suggests parameter stability matters more than explanatory power.
- **Implementation Reality Checks**: Commission structure, slippage, market impact, position sizing all material; Huang's forex study shows action augmentation (+6.4% vs epsilon-greedy); Ritter's 10^7 sample requirement shows data efficiency challenges for RL.
- **Risk-Aware Optimization Critical**: Moody-Saffell differential Sharpe outperforms profit maximization; Ritter's risk-averse reward function necessary for realistic utility maximization; factor-based approaches (size, value, momentum, volatility premium) survive all 5 trustworthiness tests.

### File List
- raw/papers/101-formulaic-alphas.md
- raw/papers/asset-class-trend-following.md
- raw/papers/autoencoder-asset-pricing-models.md
- raw/papers/brownian-motion-stock-market.md
- raw/papers/deep-rl-portfolio-management.md
- raw/papers/differential-machine-learning.md
- raw/papers/dragon-kings-black-swans-prediction-of-crises.md
- raw/papers/fed-model-expected-asset-returns.md
- raw/papers/financial-trading-as-a-game-deep-rl.md
- raw/papers/machine-learning-for-trading-ritter.md
- raw/papers/momentum-asset-allocation-strategy.md
- raw/papers/paired-switching.md
- raw/papers/pca-with-a-difference.md
- raw/papers/reinforcement-learning-for-trading-moody.md
- raw/papers/rl-techniques-algorithmic-trading.md
- raw/papers/ten-financial-applications-of-machine-learning.md
- raw/papers/time-series-momentum-effect.md
