## Group Summary: Quantocracy Quantitative Strategies

### Overview
This collection of 145 files documents the complete quantitative strategy lifecycle: signal discovery, architecture design, backtesting methodology, optimization pitfalls, walk-forward validation, and documented implementations across trend-following, mean-reversion, event-driven, carry, and hybrid approaches. The collection emphasizes the empirical reality that backtested Sharpe ratios (often 1.5-2.5) degrade to live Sharpe ratios (typically 0.8-1.2) due to execution frictions, regime changes, and overfitting. Signature contributions include case studies from elite practitioners (Kevin Davey on process discipline, Rob Hanna on VIX diversification, PJ Sutherland on portfolio construction) and detailed technical treatments of optimization challenges, leverage mechanics, and strategy robustness testing.

The research spans modern strategy variants: AI-assisted signal synthesis (accelerating literature review via LLM), machine learning backtesting (proper temporal validation protocols), exotic derivatives strategies (0DTE options, VIX variance swaps), cryptocurrency trading (on-chain data integration, 24/7 regime variations), leverage considerations (daily rebalancing drag, margin regulations), and real-world execution infrastructure (latency arbitrage, market impact modeling, slippage measurement).

### Key Insights

- **Four-Module Strategy Architecture Enables Systematic Comparison**: All quantitative strategies across asset classes decompose into four modules: (1) Universe Definition (asset pool selection—S&P 500 stocks, micro-cap stocks, commodity futures, currency pairs), (2) Signal Generation Engine (entry decision logic—momentum, mean-reversion, carry, event-driven), (3) Portfolio Construction (converting signals to position sizes—equal-weight, Sharpe-optimized, risk-parity, inverse volatility), (4) Execution Protocol (implementation specifics—limit vs. market orders, rebalancing frequency, slippage assumptions). Analyzing 100+ documented strategies through this lens reveals counterintuitive finding: execution quality (Module 4) typically dominates signal quality (Module 2) for live returns. A 0.5 Sharpe momentum signal with professional execution infrastructure (co-location, direct market access, limit order optimization) consistently beats a 1.5 Sharpe signal implemented via retail brokers with market orders and price slippage.

- **Walk-Forward Validation with K-Means Parameter Clustering**: Conventional optimization (finding single optimal parameter set on all historical data) produces illusions of stability that collapse out-of-sample. Walk-forward methodology (expanding training windows, periodic reoptimization, testing forward-only) respects temporal ordering and reveals genuine out-of-sample performance. Enhancement: K-Means clustering of optimal parameters across folds reveals distinct market regimes (bimodal parameter distributions indicate regime-switching). Deploying the centroid of the best-performing cluster produces robust out-of-sample results. This methodology automatically captures regime-aware parameter selection without explicit regime classification.

- **No-Trade Zone Economics Create Strategy Horizon Constraints**: Optimal execution theory reveals that fixed transaction costs (commissions, spreads) create economically irrational "no-trade zones." Below certain return thresholds, trading costs exceed expected gains. For stock traders: short-term strategies (5-20 day holding periods) require signal strength (expected return/volatility) exceeding 20-30 basis points to justify round-trip costs of 5-15 bps; longer-horizon strategies (50+ days) require only 5-10 bps signal strength. This creates natural strategy segmentation and minimum profitability horizons. Ultra-short-term strategies (<1 day) require signal Sharpe >2.0 to overcome costs; 1-month strategies require Sharpe >1.0; 1-year strategies require Sharpe >0.4.

- **Strategy Decay Diagnosis: Signal vs. Regime vs. Data Issues**: Strategy underperformance falls into three diagnostic categories requiring different responses: (1) Genuine alpha decay (competition increases, market becomes efficient, information value decreases)—retire or recalibrate aggressively. (2) Regime change (strategy optimized for specific volatility/correlation regime performs poorly in new regime)—reduce sizing, reoptimize parameters for new regime, add regime-detection overlay. (3) Data degradation (shifted market hours, new data feed with different tick sizes, survivorship bias in historical backtest)—investigate and correct. Practitioners distinguish these causes via: parameter sensitivity testing (overfitting shows brittleness; regime-robustness shows graceful degradation), regime analysis (strategy performance across historical volatility regimes), and data audit (comparing live data vs. backtest data).

- **Leverage Creates Volatility Drag and Liquidation Risk**: Leveraged strategies (2x, 3x sizing via futures or options) suffer two distinct costs: (1) volatility drag from daily rebalancing (theoretical 2x leverage returns 2x−1.5x average losses due to compounding; actual returns are 30-50% below theoretical). (2) Liquidation risk from margin calls during drawdowns (market drops 10%; 2x portfolio drops 20%; if margin requirement is >20%, forced liquidation occurs). Practitioners must stress-test leverage usage by simulating strategy returns during extreme historical drawdowns (2008 GFC: -55%, March 2020: -34%, Oct 1987: -23% in single day). Strategies that withstand 2-3 standard deviation moves without liquidation are suitable for leverage; others should operate unleveraged or with tight stop losses.

- **Elite Performers Use Thousands of Micro-Strategies**: Documentation of award-winning traders (Rob Hanna: NAAIM Award 2017, PJ Sutherland: model portfolio management) reveals sophisticated practitioners run 300-2000 concurrent micro-strategies. Each micro-strategy is a specific combination of (signal variant, asset, time horizon, position sizing) with small position sizes (0.1-1% portfolio per position). This creates genuine diversification where single strategy failure destroys <0.1% of portfolio; survival probability for portfolio approaches 99%+ even if 50% of micro-strategies fail. Infrastructure costs are high (position tracking, attribution analysis, dynamic rebalancing), but advantages justify complexity for institutional-scale operations.

- **AI-Assisted Literature Synthesis Accelerates Pattern Recognition**: Batch-processing 25+ research papers using Marker OCR (converting PDFs to markdown) plus LLM context windows can extract architectural patterns and strategy variations 5-10x faster than sequential reading. LLM classifies each strategy by: asset class, signal type, regime conditions, performance metrics, and implementation constraints. However, AI classification accuracy (signal vs. filter distinction, genuine novelty vs. incremental variation) requires human validation. Hybrid approach (AI extraction + human validation + custom implementation testing) maximizes productivity.

- **Backtesting Systematic Underestimation of Execution Friction**: Backtest assumptions (perfect fills, exact OHLC prices, zero market impact) are violated in live trading by: (1) slippage (1-5 bps typical, 10+ bps during volatility spikes), (2) market impact (large orders shift prices against position), (3) overnight gaps (OHLC prices don't reflect open gaps), (4) latency (order transmission, execution confirmation, data refresh times), (5) margin constraints (position sizing limited by available margin). Live performance is typically 30-50% below backtest Sharpe: backtest 2.0 → live 1.0-1.5. Elite practitioners automatically reduce backtest Sharpe by 50% when sizing positions.

### Key Questions

- **Within the four-module framework, which variables demonstrate persistent alpha across asset classes, time periods, and volatility regimes?** Universe definition: quality filters (profitability, dividend sustainability) vs. momentum filters (price performance)? Signal generation: do simple indicators (moving averages, momentum) outperform complex ML, or is complexity justified? Portfolio construction: does risk-parity outperform Sharpe optimization?

- **How much documented strategy alpha reflects genuine market inefficiency vs. artifacts of backtesting methodology?** Analysis of published strategies shows 30-40% fail independent replication; of those replicating, 50-60% experience >50% post-publication decay. What percentage reflects market shift vs. overfitting + publication bias?

- **What execution infrastructure investments (co-location, direct market access, smart order routing) provide ROI via latency reduction for sub-minute strategies?** Latency reduction from 500ms to 10ms provides alpha for intraday strategies but not for daily/weekly strategies. How do traders evaluate infrastructure spending vs. expected alpha gain?

- **Can practitioners identify strategy crowding and plan retirement before waiting 12+ months of live data?** Proxies: AUM growth in related strategies, volatility regime persistence, correlation structure changes. Which best predict alpha decay trajectory?

### Major Patterns & Themes

- **Execution Quality Dominates Signal Quality at Short Horizons**: For strategies with <20 day holding periods, execution infrastructure (latency, slippage, market impact modeling) determines returns more than signal sophistication. A competent signal with professional execution beats a brilliant signal with retail execution. This creates strategic separation: institutional traders focus on execution optimization; retail traders must focus on longer horizons (month+ timeframes) where execution friction matters less. This explains why retail traders rarely compete successfully in <5 day strategies but can compete in month+ strategies.

- **Parameter Stability Under Walk-Forward Testing Indicates Robustness**: Overfitted strategies show extreme parameter sensitivity: small changes (±10%) cause large return changes. Robust strategies degrade gracefully. Additionally, overfitted parameters cluster at tested range extremes; robust parameters fall interior to ranges. The diagnostic: if parameters change substantially across walk-forward periods, strategy is capturing noise rather than signal and should be abandoned.

- **Carry-Momentum Complementarity Improves Risk-Adjusted Returns**: Carry strategies (harvesting interest spreads, duration premiums, dividend yields) provide consistent small gains but exhibit negative convexity during crises. Momentum/trend strategies capture tail events but whipsaw in ranges. Optimal portfolio combines both: 30-40% carry (smooth returns during stable periods) + 60-70% momentum (insurance during crises). Dynamic reweighting based on volatility regime (increase momentum exposure during rising volatility) further improves Sharpe by 0.2-0.4 ratio points.

- **Alpha Decay Half-Lives and Strategy Longevity Prediction**: Documented strategies show exponential alpha decay with regime-dependent half-lives. Simple mean-reversion strategies (RSI thresholds, bollinger band breakouts) decay in 2-3 years post-publication due to crowding. Complex ML strategies decay in 1-2 years due to faster institutional adoption and replication. Practitioners should assume 50% alpha reduction per 2-3 year period and plan strategy rotation accordingly. New strategy development is not optional; it's mandatory for sustained returns.

- **Regime-Aware Strategy Switching Outperforms Static Rules**: Strategies optimized for one volatility regime perform poorly in different regimes. Rather than forcing static parameters, practitioners monitor volatility regime (VIX levels, realized volatility, correlation breakdowns) and switch to pre-optimized strategy variants. Example: trend-following with 20-day MA works well in 12-15 VIX environments; requires 5-10 day MA in 20-25 VIX environments; produces whipsaws in >30 VIX regimes requiring tactical pause. This regime-aware switching increases terminal wealth by 15-30% vs. fixed rules.

### File List
- raw/predictingAlpha/back-ratio-spread.md
- raw/predictingAlpha/black-scholes-model-explained.md
- raw/predictingAlpha/calendar-spread-strategy.md
- raw/predictingAlpha/call-option-explained.md
- raw/predictingAlpha/delta-hedging.md
- raw/predictingAlpha/earnings-options-strategy.md
- raw/predictingAlpha/earnings-strategy-profit.md
- raw/predictingAlpha/expected-value-trading.md
- raw/predictingAlpha/how-to-roll-weekly-options-like-a-pro.md
- raw/predictingAlpha/how-to-think-like-a-professional-trader.md
- raw/predictingAlpha/how-to-trade-iron-condors.md
- raw/predictingAlpha/implied-volatility-explained.md
- raw/predictingAlpha/iv-rank.md
- raw/predictingAlpha/option-selling-strategies.md
- raw/predictingAlpha/option-trading-psychology.md
- raw/predictingAlpha/options-expiration-date.md
- raw/predictingAlpha/profitable-option-selling-strategy.md
- raw/predictingAlpha/put-option-explained.md
- raw/predictingAlpha/reading-an-option-chain.md
- raw/predictingAlpha/straddle-vs-strangle-options.md
- raw/predictingAlpha/understanding-greeks-options.md
- raw/predictingAlpha/variance-risk-premium.md
- raw/predictingAlpha/vertical-spread-options.md
- raw/predictingAlpha/what-are-underlying-shares.md
- raw/predictingAlpha/what-does-delta-mean-in-options.md
- raw/predictingAlpha/what-is-a-short-straddle.md
- raw/predictingAlpha/what-is-an-iron-butterfly.md
- raw/predictingAlpha/what-is-an-option-contract.md
- raw/predictingAlpha/what-is-gamma-options.md
- raw/predictingAlpha/what-is-implied-volatility-in-options.md
- raw/predictingAlpha/what-is-theta-options.md
- raw/predictingAlpha/what-is-vega-options.md
- raw/quantocracy/docs/46-awesome-books-for-quant-finance-algo-trading-and-market-data-analysis.md
- raw/quantocracy/docs/a-deep-dive-into-volatility-targeting.md
- raw/quantocracy/docs/a-key-new-momentum-measure-distance-from-1-year-high.md
- raw/quantocracy/docs/a-quants-guide-to-covariance-matrix-estimation.md
- raw/quantocracy/docs/a-time-varying-parameter-vector-autoregression-model-with-stochastic-volatility.md
- raw/quantocracy/docs/active-reading-with-chatgpt-systematic-investing-in-credit.md
- raw/quantocracy/docs/adverse-effects-of-index-replication.md
- raw/quantocracy/docs/alternative-market-signals-investing-with-the-box-manufacturing-index.md
- raw/quantocracy/docs/analyzing-the-profitability-factor-with-alphalens.md
- raw/quantocracy/docs/arbitrage-in-defi-p1.md
- raw/quantocracy/docs/artfima-model-for-trading.md
- raw/quantocracy/docs/autocorrelation-trading-python-time-series.md
- raw/quantocracy/docs/backtest-powerful-intraday-trading-strategies.md
- raw/quantocracy/docs/bayesian-solutions-and-linear-asset-pricing-models.md
- raw/quantocracy/docs/better-backtesting.md
- raw/quantocracy/docs/bob-pardo-building-trading-strategies-that-work-with-walk-forward-analysis-part-2.md
- raw/quantocracy/docs/break-even-correlation-thresholds-for-linear-predictive-signals.md
- raw/quantocracy/docs/building-a-sp-500-company-classification-from-wikipedia-articles-guided-by-chatgpt.md
- raw/quantocracy/docs/calculating-realised-volatility-with-polygon-forex-data.md
- raw/quantocracy/docs/can-google-trends-sentiment-be-useful-as-a-predictor-for-cryptocurrency-returns.md
- raw/quantocracy/docs/can-smart-rebalancing-improve-factor-portfolios.md
- raw/quantocracy/docs/can-you-trade-only-the-best-trend-signals.md
- raw/quantocracy/docs/catastrophe-bonds-modeling-rare-events-and-pricing-risk.md
- raw/quantocracy/docs/cliff-smiths-bkln-strategy.md
- raw/quantocracy/docs/code-walkthrough-alpha-simulator-trend-rule-vol-targeting.md
- raw/quantocracy/docs/commodity-carry-as-a-trading-signal-part-2.md
- raw/quantocracy/docs/corrected-cornish-fisher-expansion.md
- raw/quantocracy/docs/covered-call-strategies-uncovered.md
- raw/quantocracy/docs/crowded-trades-increase-crash-risks.md
- raw/quantocracy/docs/dangers-of-relying-on-ohlc-prices-overnight-drift-in-gdx-etf.md
- raw/quantocracy/docs/day-1-benchmarks.md
- raw/quantocracy/docs/day-17-drawdowns.md
- raw/quantocracy/docs/day-24-lucky-logic.md
- raw/quantocracy/docs/day-4-first-analysis.md
- raw/quantocracy/docs/deep-reinforcement-learning-for-portfolio-optimization.md
- raw/quantocracy/docs/detecting-trends-and-mean-reversion-with-the-hurst-exponent.md
- raw/quantocracy/docs/diversification-versus-hedging.md
- raw/quantocracy/docs/do-sp500-0dtes-options-increase-market-volatility.md
- raw/quantocracy/docs/downside-betas-vs-downside-correlations.md
- raw/quantocracy/docs/duration-as-an-equity-factor.md
- raw/quantocracy/docs/effectiveness-of-covered-call-strategy-in-developed-and-emerging-markets.md
- raw/quantocracy/docs/emnlp-2025-in-suzhou.md
- raw/quantocracy/docs/equity-duration-and-predictability.md
- raw/quantocracy/docs/eurusd-impact-in-2022.md
- raw/quantocracy/docs/experimental-control-for-machine-learning-of-temporal-effects-in-quantitative-trading.md
- raw/quantocracy/docs/expressing-an-indicator-in-neural-net-form-part-3.md
- raw/quantocracy/docs/factor-olympics-q1-2024.md
- raw/quantocracy/docs/financial-distress-factors-altman-z-score-interest-coverage.md
- raw/quantocracy/docs/finding-the-nearest-valid-correlation-matrix-with-highams-algorithm.md
- raw/quantocracy/docs/forecasting-time-series-with-decomposition.md
- raw/quantocracy/docs/front-running-in-country-etfs-or-how-to-spot-and-leverage-seasonality.md
- raw/quantocracy/docs/gauging-existing-technical-fundamental-features-through-mutual-information.md
- raw/quantocracy/docs/getting-started-with-the-interactive-brokers-native-api.md
- raw/quantocracy/docs/growth-etfs-performance-factor-exposures.md
- raw/quantocracy/docs/hidden-dangers-of-writing-an-oms.md
- raw/quantocracy/docs/how-dollar-invoicing-and-dollar-debt-shape-fx-risk-premia.md
- raw/quantocracy/docs/how-much-bitcoin-should-we-allocate-to-the-portfolio.md
- raw/quantocracy/docs/how-to-deal-with-missing-financial-data.md
- raw/quantocracy/docs/how-to-exploit-the-month-end-flow-effect-for-a-502-return.md
- raw/quantocracy/docs/how-to-profitably-trade-bitcoins-overnight-sessions.md
- raw/quantocracy/docs/how-to-value-overvalued-microstrategy.md
- raw/quantocracy/docs/i-found-a-one-hour-edge-in-the-sp-then-three-llms-made-it-better.md
- raw/quantocracy/docs/implied-vs-realized-volatility-in-delta-hedging-strategies.md
- raw/quantocracy/docs/index-replication-avoid-the-negatives.md
- raw/quantocracy/docs/infra-scraping-financial-data.md
- raw/quantocracy/docs/intangibles-and-the-performance-of-the-value-factor.md
- raw/quantocracy/docs/introducing-hybrid-asset-allocation-haa.md
- raw/quantocracy/docs/investigation-of-lead-lag-effect-in-easily-mistyped-tickers.md
- raw/quantocracy/docs/is-managed-futures-value-able.md
- raw/quantocracy/docs/is-value-investing-dead.md
- raw/quantocracy/docs/kevin-davey-ii-selecting-optimal-strategies-for-peak-performance.md
- raw/quantocracy/docs/linear-congruential-generators-in-python.md
- raw/quantocracy/docs/low-volatility-stocks-reducing-risk-without-sacrificing-returns.md
- raw/quantocracy/docs/macro-trading-factors-dimension-reduction-and-statistical-learning.md
- raw/quantocracy/docs/macroeconomics-with-gaussian-mixture-models.md
- raw/quantocracy/docs/mark-virags-momentum-based-balancing.md
- raw/quantocracy/docs/meb-fabers-12-month-high-switch.md
- raw/quantocracy/docs/mlms-do-they-work-better-than-traditional-approaches.md
- raw/quantocracy/docs/momentum-and-the-clarity-of-the-trend.md
- raw/quantocracy/docs/moneyball-finding-undervalued-pairs-using-unconventional-metrics.md
- raw/quantocracy/docs/moving-average-distance-and-time-series-momentum.md
- raw/quantocracy/docs/navigating-economic-downturns-with-survey-based-recession-indicators.md
- raw/quantocracy/docs/new-contributor-gld-put-write-strategy.md
- raw/quantocracy/docs/new-youtube-series-launched-building-your-aws-trading-data-pipeline.md
- raw/quantocracy/docs/on-the-origins-of-bayesian-statistics.md
- raw/quantocracy/docs/optimizing-portfolios-simple-vs-sophisticated-allocation-strategies.md
- raw/quantocracy/docs/out-of-sample-test-of-formula-investing-strategies.md
- raw/quantocracy/docs/pairs-trading-in-the-equities-entity-store.md
- raw/quantocracy/docs/performance-attribution-crypto-market-neutral-statistical-risk-model.md
- raw/quantocracy/docs/political-beta-portfolio-theory.md
- raw/quantocracy/docs/portfolio-tilts-versus-overlays.md
- raw/quantocracy/docs/predicting-base-metal-futures-returns-with-economic-data.md
- raw/quantocracy/docs/profitability-retrospective-key-takeaways-for-investors.md
- raw/quantocracy/docs/python-tooling-in-2025.md
- raw/quantocracy/docs/quant-and-machine-learning-links-20230813.md
- raw/quantocracy/docs/quant-rv-performance-over-three-decades.md
- raw/quantocracy/docs/quantpedia-awards-2025-countdown.md
- raw/quantocracy/docs/r-squared-and-sharpe-ratio.md
- raw/quantocracy/docs/recursive-least-squares-linear-regression.md
- raw/quantocracy/docs/reinforcement-learning-for-portfolio-optimization-from-theory-to-implementation.md
- raw/quantocracy/docs/research-review-10-march-2023-etfs.md
- raw/quantocracy/docs/research-review-16-may-2025-asset-allocation.md
- raw/quantocracy/docs/research-review-20-jan-2023-etfs-and-related-strategies.md
- raw/quantocracy/docs/research-review-6-september-2024-portfolio-risk-management.md
- raw/quantocracy/docs/rethinking-growth-investing-why-traditional-growth-indices-miss-the-mark.md
- raw/quantocracy/docs/revisiting-links-global-growth-cycle-strategy.md
- raw/quantocracy/docs/rob-carver-the-comprehensive-guide-to-a-diversified-futures-strategy.md
- raw/quantocracy/docs/robustness-testing-of-country-and-asset-etf-momentum-strategies.md
- raw/quantocracy/docs/seasonality-patterns-in-the-crisis-hedge-portfolios.md
- raw/quantocracy/docs/sequential-entropy-pooling.md
- raw/quantocracy/docs/shorting-lousy-stocks-lousy-returns.md
- raw/quantocracy/docs/skewness-of-funds-friend-or-foe.md
- raw/quantocracy/docs/spearmans-rank-correlation-of-technical-indicators.md
- raw/quantocracy/docs/statistical-shrinkage-4-covariance-estimation.md
- raw/quantocracy/docs/stock-sentiment-indicators-in-us-equities-and-the-research-that-supports-them.md
- raw/quantocracy/docs/switch-off-bayesian-online-changepoint-detection.md
- raw/quantocracy/docs/tactical-asset-allocation-and-taxes-fifo-vs-lifo-deep-dive.md
- raw/quantocracy/docs/taming-excessive-timing-luck-in-taa-by-tranching-strategies.md
- raw/quantocracy/docs/testing-87-different-stop-loss-strategies.md
- raw/quantocracy/docs/the-5-point-trade-quality-scoring-system.md
- raw/quantocracy/docs/the-best-strategies-for-fx-hedging.md
- raw/quantocracy/docs/the-delusion-of-market-efficiency.md
- raw/quantocracy/docs/the-equity-overnight-anomaly-etfs.md
- raw/quantocracy/docs/the-gerber-statistic-a-robust-co-movement-measure-for-correlation-matrix-estimation.md
- raw/quantocracy/docs/the-impact-of-amortizing-volatility-across-private-investments.md
- raw/quantocracy/docs/the-low-vol-effect-in-crypto.md
- raw/quantocracy/docs/the-performance-of-major-private-equity-lbo-firms.md
- raw/quantocracy/docs/the-risk-constrained-kelly-criterion-from-definition-to-trading.md
- raw/quantocracy/docs/the-strike-price-of-long-only-trend-following.md
- raw/quantocracy/docs/the-value-factor-and-deleveraging.md
- raw/quantocracy/docs/time-and-state-dependent-resampling.md
- raw/quantocracy/docs/traders-guide-to-front-running-commodity-seasonality.md
- raw/quantocracy/docs/trading-the-channel.md
- raw/quantocracy/docs/trend-following-in-crypto-markets.md
- raw/quantocracy/docs/twitter-sentiment-analysis-using-zero-shot-classification.md
- raw/quantocracy/docs/understanding-why-beats-statistical-significance.md
- raw/quantocracy/docs/us-companies-have-outperformed-japanese-companies-or-have-they.md
- raw/quantocracy/docs/using-the-oecd-composite-leading-indicator-momentum-to-time-the-market.md
- raw/quantocracy/docs/value-vs-quality-more-correlated-than-ever-ii.md
- raw/quantocracy/docs/volatility-clustering-across-asset-classes-garch-and-egarch-analysis-with-python.md
- raw/quantocracy/docs/volatility-risk-premium-overnight-and-intraday-dynamics.md
- raw/quantocracy/docs/webinar-recordings-and-notebook.md
- raw/quantocracy/docs/what-is-managed-futures.md
- raw/quantocracy/docs/when-execution-delays-erode-short-term-alpha.md
- raw/quantocracy/docs/why-backtests-run-fast-or-slow-a-comparison-of-zipline-moonshot-and-lean.md
- raw/quantocracy/docs/why-the-last-good-state-of-the-union-speaker-was-bill-clinton.md
- raw/quantocracy/pages-001-010.md
- raw/quantocracy/pages-081-090.md
