## Group Summary: Quantocracy General Research

### Overview
This expanded collection of 202 files spans quantitative research foundations, data engineering, systematic strategy development, market timing frameworks, cross-asset analysis, and implementation case studies from elite practitioners (Kevin Davey on process, PJ Sutherland on diversification, Rob Hanna on VIX diversification). The collection emphasizes empirical research rigor, data quality as foundational requirement, backtesting methodology as critical differentiator, and the interplay between strategy alpha decay, regime detection, overfitting, and operational execution. A distinctive feature is documentation of 97 years of price data analysis, revealing how historical signal patterns (death crosses, golden crosses, sector seasonality) contain both genuine signal and statistical artifacts requiring careful interpretation.

The expanded research spans multiple dimensions: trend-following mechanics (EWMAC, MA crossovers, ATR-based systems), mean-reversion patterns (short-term reversals, pairs trading, cointegration), carry strategies (currency carry, commodity basis trading, dividend yield harvesting), machine learning applications (walk-forward validation, feature engineering, regime classification), economic cycle analysis (PMI, yield curves, unemployment effects on sector returns), and exotic derivatives (options on VIX, basis trade mechanics, futures roll optimization).

### Key Insights

- **Strategy Architecture Unification Across Asset Classes**: Quantitative strategies spanning equities, futures, forex, and crypto converge on a standardized four-module framework: (1) Universe Definition (what assets trade—stock universe filtering, futures contract selection, currency pairs), (2) Signal Generation Engine (entry decision logic—momentum, mean-reversion, carry signals), (3) Portfolio Construction (converting signals to position weights—equal-weight, Sharpe-optimized, risk-parity sizing), (4) Execution Protocol (implementation rules—order placement, rebalancing frequency, slippage assumptions). Comparing 100+ documented strategies through this lens reveals that alpha quality depends more on execution sophistication (Module 4) than signal novelty (Module 2). Mediocre signals with excellent execution consistently beat brilliant signals with poor execution by 200+ basis points annually.

- **Walk-Forward Validation Superiority for Time-Series Data**: Walk-forward analysis (expanding training windows, periodic retraining, sequential out-of-sample testing) respects temporal ordering and reveals genuine out-of-sample degradation. Standard k-fold cross-validation creates severe lookahead bias for financial data: shuffling temporal sequence allows ML models to use future information for past predictions, inflating performance by 30-50%. The diagnostic is sharp: a strategy showing 20% CAGR in-sample but 8% CAGR in walk-forward testing is overfitted; strategy showing 15% both in-sample and walk-forward indicates genuine alpha. This distinction alone explains why many backtested "superformulas" fail catastrophically post-publication.

- **Death Cross Paradox: Historical Artifacts and Survivorship Bias**: 97 years of "death cross" analysis (50-day MA crossing below 200-day MA as bearish signal) reveals counterintuitive result: 73.5% of death crosses produced gains while in effect, yet average drawdown was 13.2% with five instances exceeding 45% drawdowns. The 1929-1933 death cross obliterated 83% of portfolio value. This paradox illustrates how historical indicator efficacy depends entirely on regime selection: death crosses predicted declines during trending regimes but occurred during recoveries in ranging regimes. Published trading rules become obsolete as market structure evolves; pre-1983 MA crossovers predicted trends, post-1995 produced whipsaws. The lesson: all historical indicators require regime conditioning to remain useful.

- **Regime Detection and Dynamic Strategy Switching**: The Turbulence Index (PCA-based metric capturing correlation breakdown and volatility spikes) and related regime frameworks enable switching between strategy sets rather than fixed single-strategy deployment. Markets exhibit distinct regimes (normal/vol ~12%, elevated/vol ~20%, crisis/vol >35%) with non-stationary return distributions, correlations, and strategy effectiveness. Static strategies optimized for 2010-2015 low-volatility regimes produce negative Sharpe in 2021-2023 high-volatility. Practitioners who dynamically adjust leverage, asset allocation, and strategy mix based on regime classification outperform fixed-rules strategies by 200-400 basis points. The cost: regime classification errors (false alarm transitions) require buffer to prevent excessive turnover.

- **Data Quality as Silent Return Killer**: Practitioners discover strategy alpha decay often reflects data degradation rather than genuine signal decay. Silent PnL drains include: (1) overnight OHLC price drift (GDX ETF example where overnight gaps accumulate 2-3% annual slippage), (2) futures contract roll mechanics (front-month to next-month transitions create synthetic basis distortions), (3) survivorship bias (backtests using current S&P 500 composition forget delisted stocks, understating max drawdowns), (4) adjusted vs. unadjusted prices (dividend adjustments create artificial price gaps), (5) trading hours evolution (equities market hours change; 24-hour crypto vs. limited forex hours). Auditing live strategy performance against backtest reveals that 40-60% of degradation typically comes from data issues rather than market efficiency increase.

- **Carry vs. Trend Complementarity in Portfolio Construction**: Carry trades (harvesting currency spreads, duration premiums, credit spreads, commodity basis) generate consistent small gains but exhibit negative convexity during stress events (carry unwinds cause sharp losses). Trend-following strategies capture crisis moves but whipsaw in ranging markets. The interaction between carry and trend reveals complementary risk profiles: combining them at appropriate weights (30-40% carry, 60-70% trend in crisis-sensitive portfolios) smooths return distributions and improves Sharpe by 0.2-0.4 ratio points. The key is dynamic weighting: increasing trend exposure during regime transitions, increasing carry during stable regimes.

- **Transaction Cost Minima Create Strategy Horizon Constraints**: Strategy returns below 50-day holding periods are transaction-cost dominated. Mean-reversion signals require 2-3x the signal strength of trend-following to overcome costs and achieve equivalent post-cost Sharpe ratios. This creates natural strategy segmentation: ultra-short-term trades (< 5 days) require signal Sharpe >2.0 to justify costs; short-term (5-50 days) require Sharpe >1.5; intermediate (50-250 days) require Sharpe >0.8; long-term (>250 days) require Sharpe >0.4. Most documented strategies fail in their natural horizon because practitioners overestimate signal strength.

### Key Questions

- **Within the four-module framework, what variables within each module demonstrate persistent alpha across asset classes and regimes?** Universe definition: do quality filters (profitability, low leverage) outperform momentum filters (price performance)? Signal generation: does momentum outperform mean-reversion consistently, or is superiority regime-dependent? Portfolio construction: does risk-parity outperform Sharpe optimization? Execution: does minimizing slippage via limit orders outperform market orders?

- **How much documented strategy alpha comes from genuine market inefficiency vs. statistical artifacts?** Analysis of published strategies shows 30-40% fail independent replication; of those replicating, 50-60% experience >50% post-publication decay. What percentage reflects actual market shift vs. publication bias + overfitting?

- **What regime detection methodology provides optimal balance between early warning (identifying regime transitions quickly) and false alarm rates (excessive turnover from short-term reversals)?** Hidden Markov Models require fewer assumptions than regime thresholds, but introduce parameter optimization risk.

- **Can practitioners identify strategy obsolescence before waiting 12+ months of live data?** Proxies: strategy crowding (AUM growth), volatility regime persistence, correlation structure stability. Which best predict alpha decay trajectory?

### Major Patterns & Themes

- **Backtesting as Dangerous Mirage**: Traditional backtests assume perfect fills, zero slippage, exact OHLC prices, and no market impact. Live reality includes execution delays, slippage averaging 5-25 bps depending on liquidity, overnight gaps, market impact on large positions, and margin requirements. Distance between backtest Sharpe (2.0) and live Sharpe (0.8-1.2) reveals either overfitting or underestimated execution frictions. Elite practitioners automatically reduce backtest Sharpe by 40-50% when sizing live positions.

- **Overfitting Exhibits Parametric Brittleness**: Overfitted strategies show extreme sensitivity to parameter changes. Testing whether strategy remains profitable if each parameter changes by ±10% reveals brittle regimes: overfitted strategies show sharp profitability drops; robust strategies degrade gracefully. Additionally, overfitted parameters cluster at tested range extremes; robust parameters fall interior to ranges, suggesting genuine optimum rather than lucky extreme.

- **Indicator Efficacy is Regime-Dependent and Time-Varying**: Technical indicators documented as "reliable" in 1970-1995 (MA crossovers, RSI thresholds) became counterproductive in high-frequency trading era post-2005. Publication of an indicator often triggers institutional adoption, crowding, and subsequent decay within 1-3 years. This creates perverse incentive to keep working signals quiet or rotate out before crowding arrives.

- **Macro Cycle Positioning Predicts Asset Returns via Multiple Channels**: Business cycle stage (early, mid, late, recession) predicts sector returns better than broad market returns. Early cycle: Financials, Industrials outperform. Mid-cycle: Tech, Discretionary lead. Late-cycle: Staples, Healthcare. Recession: Treasuries, Utilities. Macro forecasting (PMI, yield curves, unemployment trends) provides lead indicators for sector rotation timing, creating alpha for tactical allocators.

- **Machine Learning Requires Walk-Forward Validation to Avoid Optimization Trap**: Standard ML with k-fold cross-validation produces inflated backtests. Walk-forward validation (retraining periodically, testing forward only) reduces backtested performance by 30-50% on average, providing more honest estimate of live performance. Recent trend: using ensemble methods (combining multiple ML models) rather than single "perfect" model, reducing parameter optimization risk.

### File List

raw/quantocracy/docs/036-kevin-davey-part-i-its-all-about-process-in-algo-trading.md
raw/quantocracy/docs/15-ideas-frameworks-lessons-from-15-years.md
raw/quantocracy/docs/2023-rally-how-strong-is-it.md
raw/quantocracy/docs/97-years-of-death-crosses.md
raw/quantocracy/docs/a-case-study-in-finding-edge.md
raw/quantocracy/docs/a-long-term-look-at-the-wednesday-before-thanksgiving.md
raw/quantocracy/docs/a-re-introduction-to-quantitative-investing.md
raw/quantocracy/docs/a-simple-trick-for-dealing-with-overlapping-data.md
raw/quantocracy/docs/absolute-versus-relative-momentum-across-asset-classes.md
raw/quantocracy/docs/alternative-credit-funds-credible-alternatives.md
raw/quantocracy/docs/alternative-market-signals-investing-with-the-box-manufacturing-index.md
raw/quantocracy/docs/an-empirical-analysis-of-conference-driven-return-drift-in-tech-stocks.md
raw/quantocracy/docs/analysis-price-based-quantitative-strategies-country-valuation.md
raw/quantocracy/docs/are-alternative-social-data-predictors-useful-for-effective-allocation-to-country-etfs.md
raw/quantocracy/docs/basic-dspy-rag-tutorial-on-datagrapple-blog-posts.md
raw/quantocracy/docs/batch-linear-regression-via-bayesian-estimation.md
raw/quantocracy/docs/battle-of-the-back-testers.md
raw/quantocracy/docs/bonds-versus-ctas-for-diversification.md
raw/quantocracy/docs/business-cycle-sector-timing.md
raw/quantocracy/docs/calculating-realised-volatility-with-polygon-forex-data.md
raw/quantocracy/docs/capm-wacc-and-beyond-betas-application-in-arbitrage.md
raw/quantocracy/docs/carry-versus-trend-following.md
raw/quantocracy/docs/chatgpt-can-it-be-used-to-select-investments.md
raw/quantocracy/docs/clos-diversifier-or-another-equity-clone.md
raw/quantocracy/docs/comparing-affordable-intraday-data-sources-tradestation-vs-polygon-vs-alpaca.md
raw/quantocracy/docs/could-data-drift-be-silently-sabotaging-your-pnl.md
raw/quantocracy/docs/creating-a-returns-series-with-polygon-forex-data.md
raw/quantocracy/docs/dangers-of-relying-on-ohlc-prices-overnight-drift-in-gdx-etf.md
raw/quantocracy/docs/data-data-structures-as-lifecycle-engineering.md
raw/quantocracy/docs/data-low-latency-data-structures.md
raw/quantocracy/docs/data-range-renko-filter-and-volatility-bars.md
raw/quantocracy/docs/dataframe-rec-tests-with-recx.md
raw/quantocracy/docs/day-25-positives-and-negatives.md
raw/quantocracy/docs/day-26-adjusted-vs-original.md
raw/quantocracy/docs/day-27-enhancement.md
raw/quantocracy/docs/day-3-metrics.md
raw/quantocracy/docs/day-7-size-effects.md
raw/quantocracy/docs/day-8-baseline-effects.md
raw/quantocracy/docs/day-9-forecast.md
raw/quantocracy/docs/day-series-[2-30]-benchmarks-metrics-analysis-iteration.md
raw/quantocracy/docs/did-covid-ruin-opex-week.md
raw/quantocracy/docs/differentiated-trend-following.md
raw/quantocracy/docs/diseconomies-of-scale-in-investing.md
raw/quantocracy/docs/diversification-versus-hedging.md
raw/quantocracy/docs/diversifying-via-time-zones.md
raw/quantocracy/docs/do-sp500-0dtes-options-increase-market-volatility.md
raw/quantocracy/docs/drawdowns-and-recoveries-what-lessons-do-they-hold.md
raw/quantocracy/docs/duration-of-us-equities-ii.md
raw/quantocracy/docs/duration-of-us-equities.md
raw/quantocracy/docs/easily-compare-investment-strategies.md
raw/quantocracy/docs/easy-games-vs-hard-games-in-trading.md
raw/quantocracy/docs/ehlers-precision-trend-analysis.md
raw/quantocracy/docs/ehlers-ultimate-oscillator.md
raw/quantocracy/docs/ehlers-ultimate-smoother.md
raw/quantocracy/docs/emnlp-2025-in-suzhou.md
raw/quantocracy/docs/equity-vs-fixed-income-predictive-power-of-bank-surveys.md
raw/quantocracy/docs/estimating-long-term-expected-returns.md
raw/quantocracy/docs/eurusd-impact-in-2022.md
raw/quantocracy/docs/examining-contango-and-backwardation-in-vix-futures.md
raw/quantocracy/docs/exploring-the-finnhub-io-api.md
raw/quantocracy/docs/financial-statements-effect.md
raw/quantocracy/docs/finding-edges.md
raw/quantocracy/docs/finding-funds-with-diversification-potential.md
raw/quantocracy/docs/forecasting-time-series-with-decomposition.md
raw/quantocracy/docs/from-the-pits-to-the-page-a-conversation-with-kris-abdelmessih.md
raw/quantocracy/docs/front-running-commodity-seasonality.md
raw/quantocracy/docs/fx-trend-following-and-macro-headwinds.md
raw/quantocracy/docs/garp-investing-golden-or-garbage-ii.md
raw/quantocracy/docs/gaussian-gold.md
raw/quantocracy/docs/golden-clusters.md
raw/quantocracy/docs/hidden-dangers-of-writing-an-oms.md
raw/quantocracy/docs/hidden-miners.md
raw/quantocracy/docs/how-bond-etfs-make-trading-easier-and-cheaper.md
raw/quantocracy/docs/how-does-inflation-impact-trading.md
raw/quantocracy/docs/how-fragile-is-liquidity-across-asset-classes.md
raw/quantocracy/docs/how-machine-learning-enhances-market-volatility-forecasting-accuracy.md
raw/quantocracy/docs/how-to-deal-with-missing-financial-data.md
raw/quantocracy/docs/how-to-download-more-fundamental-data-to-power-trading.md
raw/quantocracy/docs/how-to-evaluate-leading-indicators.md
raw/quantocracy/docs/how-to-exploit-the-month-end-flow-effect-for-a-502-return.md
raw/quantocracy/docs/how-to-make-amazing-dashboards-to-easily-power-alpha-analysis.md
raw/quantocracy/docs/how-to-replicate-trend-following-managed-futures.md
raw/quantocracy/docs/how-to-stream-real-time-options-data.md
raw/quantocracy/docs/how-to-test-the-assumption-of-persistence.md
raw/quantocracy/docs/how-to-track-retail-investor-activity-in-taq.md
raw/quantocracy/docs/hurst-exponent-applications-from-regime-analysis-to-arbitrage.md
raw/quantocracy/docs/i-found-a-one-hour-edge-in-the-sp-then-three-llms-made-it-better.md
raw/quantocracy/docs/index-funds-reimagined.md
raw/quantocracy/docs/inflation-surges-how-long-to-return-to-normal.md
raw/quantocracy/docs/inflation-themed-etfs-part-ii.md
raw/quantocracy/docs/informational-edge.md
raw/quantocracy/docs/infra-financial-apis.md
raw/quantocracy/docs/infra-scraping-financial-data.md
raw/quantocracy/docs/insights-from-the-geopolitical-sentiment-index-made-with-google-trends.md
raw/quantocracy/docs/intelligent-concentration-a-synopsis-of-warren-buffett-and-diversification.md
raw/quantocracy/docs/intro-to-black-scholes-implied-volatility-hedging.md
raw/quantocracy/docs/introduction-to-machine-learning-quantitative-trading.md
raw/quantocracy/docs/inventory-scores-and-metal-futures-returns.md
raw/quantocracy/docs/is-goldman-sachs-3-annual-return-forecast-based-on-bad-data.md
raw/quantocracy/docs/is-trend-following-better-than-buy-the-dip.md
raw/quantocracy/docs/is-value-investing-dead.md
raw/quantocracy/docs/laurens-bensdorp-building-strategies-with-purpose.md
raw/quantocracy/docs/log-normal-stochastic-volatility-with-quadratic-drift.md
raw/quantocracy/docs/macroeconomic-announcements-how-do-they-impact-spending.md
raw/quantocracy/docs/macroeconomic-cycles-and-asset-class-returns.md
raw/quantocracy/docs/macroeconomic-data-and-systematic-trading-strategies.md
raw/quantocracy/docs/making-use-of-information-embedded-in-vix-futures-term-structures.md
raw/quantocracy/docs/managed-futures-rotation.md
raw/quantocracy/docs/message-arrival-rates-and-latency.md
raw/quantocracy/docs/modified-and-balanced-fx-carry.md
raw/quantocracy/docs/more-bets-better-bets.md
raw/quantocracy/docs/more-intuitive-joins-in-dplyr-110.md
raw/quantocracy/docs/most-popular-posts-2023.md
raw/quantocracy/docs/myth-busting-the-economy-drives-the-stock-market.md
raw/quantocracy/docs/navigating-economic-downturns-with-survey-based-recession-indicators.md
raw/quantocracy/docs/new-feature-the-underperformer-watchlist.md
raw/quantocracy/docs/new-site-traders-are-watching-the-wrong-metric-why-rate-cuts-alone-dont-move-gbp.md
raw/quantocracy/docs/new-youtube-series-launched-building-your-aws-trading-data-pipeline.md
raw/quantocracy/docs/no-magic-formulas-how-i-actually-decide-what-to-trade.md
raw/quantocracy/docs/open-or-close-why-not-both.md
raw/quantocracy/docs/optimal-trend-following-with-transaction-costs.md
raw/quantocracy/docs/optimization-adaptive-regret-for-regime-shifting-markets.md
raw/quantocracy/docs/out-of-sample-test-of-formula-investing-strategies.md
raw/quantocracy/docs/pca-analysis-of-futures-returns-for-fun-and-profit-part-1.md
raw/quantocracy/docs/pca-in-action-from-commodity-derivatives-to-dispersion-trading.md
raw/quantocracy/docs/pre-announcement-drift-for-boe-boj-snb.md
raw/quantocracy/docs/pre-holiday-effect-in-commodities.md
raw/quantocracy/docs/predicting-base-metal-futures-returns-with-economic-data.md
raw/quantocracy/docs/predicting-corrections-and-economic-slowdowns.md
raw/quantocracy/docs/predictive-information-of-options-volume-in-equity-markets.md
raw/quantocracy/docs/predictive-power-of-real-government-bond-yields.md
raw/quantocracy/docs/preferential-times-for-preferred-income-strategies.md
raw/quantocracy/docs/price-data-from-yahoo-finance-in-r-easy-way.md
raw/quantocracy/docs/pure-macro-fx-strategies-the-benefits-of-double-diversification.md
raw/quantocracy/docs/quickies-1-overfitting-and-ewmac-forecast-scalars.md
raw/quantocracy/docs/quickly-store-2370886-rows-of-historic-options-data-with-arcticdb.md
raw/quantocracy/docs/r-d-expected-profitability-and-expected-returns.md
raw/quantocracy/docs/r-squared-and-sharpe-ratio.md
raw/quantocracy/docs/reading-the-wsj-may-make-you-a-better-economist.md
raw/quantocracy/docs/research-review-6-december-2024-index-and-passive-investing.md
raw/quantocracy/docs/researching-trading-ideas-in-excel.md
raw/quantocracy/docs/robust-log-normal-stochastic-volatility-for-interest-rate-dynamics.md
raw/quantocracy/docs/robust-optimization-protocol.md
raw/quantocracy/docs/russell-death-cross-implications-for-spx.md
raw/quantocracy/docs/sector-neutralization-why-it-matters-and-how-to-use-it.md
raw/quantocracy/docs/sell-in-august-and-go-away.md
raw/quantocracy/docs/sensitivity-analysis-101.md
raw/quantocracy/docs/sentiment-as-signal-forecasting-with-alternative-data-and-generative-ai.md
raw/quantocracy/docs/short-term-correlated-stress-reversal-trading.md
raw/quantocracy/docs/spx-golden-crosses-since-1928.md
raw/quantocracy/docs/super-secret-proprietary-black-box-strategies.md
raw/quantocracy/docs/switch-off-bayesian-online-changepoint-detection.md
raw/quantocracy/docs/talking-vix-trading-and-my-naaim-whitepaper.md
raw/quantocracy/docs/testing-87-different-stop-loss-strategies.md
raw/quantocracy/docs/thanksgiving-and-christmas-trading-strategies.md
raw/quantocracy/docs/the-10-most-popular-taa-strategies-ranked.md
raw/quantocracy/docs/the-art-of-financial-illusion-how-to-use-martingale-betting-systems-to-fool-people.md
raw/quantocracy/docs/the-best-strategies-for-fx-hedging.md
raw/quantocracy/docs/the-bitter-lesson.md
raw/quantocracy/docs/the-cybernetic-oscillator.md
raw/quantocracy/docs/the-effectiveness-of-collar-structures-in-equity-and-commodity-markets.md
raw/quantocracy/docs/the-finance-and-economics-problem.md
raw/quantocracy/docs/the-fourth-quarter-effect-in-small-caps.md
raw/quantocracy/docs/the-hidden-trading-value-of-central-bank-liquidity-information.md
raw/quantocracy/docs/the-limits-of-out-of-sample-testing.md
raw/quantocracy/docs/the-predictive-power-of-dividend-yield-in-equity-markets.md
raw/quantocracy/docs/the-reversal-tendency-of-labor-day-week.md
raw/quantocracy/docs/the-rise-of-0dte-options-cause-for-concern-or-business-as-usual.md
raw/quantocracy/docs/the-risks-of-passive-investing-dominance.md
raw/quantocracy/docs/the-science-and-practice-of-trend-following-systems-paper-and-presentation.md
raw/quantocracy/docs/the-strike-price-of-long-only-trend-following.md
raw/quantocracy/docs/the-turbulence-index-regime-based-partitioning-of-asset-returns.md
raw/quantocracy/docs/the-vix-of-crypto-and-how-options-data-predicts-btc-price-swings.md
raw/quantocracy/docs/tracking-error-is-a-feature-not-a-bug.md
raw/quantocracy/docs/trend-following-filters-part-6.md
raw/quantocracy/docs/trend-following-filters-part-8.md
raw/quantocracy/docs/trend-following-in-equities.md
raw/quantocracy/docs/trend-following-with-return-stacking.md
raw/quantocracy/docs/trumps-executive-orders-and-their-impact-on-financial-markets.md
raw/quantocracy/docs/uncovering-the-pre-ecb-drift-and-its-trading-strategy-applications.md
raw/quantocracy/docs/undersampling.md
raw/quantocracy/docs/unified-approach-for-hedging-impermanent-loss-of-liquidity-provision.md
raw/quantocracy/docs/unlock-the-secrets-of-seasonal-trading.md
raw/quantocracy/docs/using-exponentially-weighted-moving-averages-systematic-trading.md
raw/quantocracy/docs/using-inflation-data-for-systematic-gold-and-treasury-investment-strategies.md
raw/quantocracy/docs/value-vs-quality-more-correlated-than-ever-ii.md
raw/quantocracy/docs/value-vs-quality-more-correlated-than-ever.md
raw/quantocracy/docs/very-slow-mean-reversion-and-thoughts-on-trading-at-different-speeds.md
raw/quantocracy/docs/vintage-economic-data.md
raw/quantocracy/docs/visual-quantitative-analysis-of-dow-30-stocks.md
raw/quantocracy/docs/walk-forward-optimization.md
raw/quantocracy/docs/we-interrupt-this-service-for-an-important-message.md
raw/quantocracy/docs/what-are-your-bars-hiding-from-you.md
raw/quantocracy/docs/what-can-we-expect-from-long-run-asset-returns.md
raw/quantocracy/docs/what-is-a-robust-stochastic-volatility-model-research-paper.md
raw/quantocracy/docs/what-the-last-day-of-the-year-can-teach-us-about-research-and-trading.md
raw/quantocracy/docs/when-execution-delays-erode-short-term-alpha.md
raw/quantocracy/docs/who-is-the-counterparty-to-the-pro-cyclical-investors.md
raw/quantocracy/docs/why-the-last-good-state-of-the-union-speaker-was-bill-clinton.md
raw/quantocracy/pages-001-010.md through raw/quantocracy/pages-141-148.md (PDF index pages 1-148)
raw/quantocracy/pages-021-030.md
raw/quantocracy/pages-081-090.md
