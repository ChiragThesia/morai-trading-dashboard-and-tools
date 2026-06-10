## Group Summary: Quantocracy Anomalies & Factors

### Overview
This group documents market anomalies—persistent deviations from expected behavior under efficient market hypothesis—and examines their durability, underlying drivers, and tactical exploitation. The collection spans mean reversion vs. trend-following regime shifts, anomaly attenuation mechanics, factor-based anomalies (low-beta, low-vol, small-cap), and optimal strategy construction for mean-reverting assets. Key finding: structural shift from trend-dominance (pre-1983 equities) to mean-reversion-dominance (post-1995) caused by computerization and institutional participation.

### Key Insights

- **Anomaly Attenuation and Durability**: Published anomalies decay post-discovery as arbitrage capital deploys against them, with the rate of decay inversely related to fundamental anchoring. Anomalies backed by strong economic rationales (e.g., low-vol as behavioral preference for lottery stocks) persist longer than purely statistical patterns, providing durable alpha sources for disciplined practitioners.

- **Structural Regime Shift in Equities (1983 Inflection)**: The US equity market transitioned from trend-following dominance (1957-1982, where overbought predicted higher prices) to mean-reversion dominance (1995-present, where overbought predicts weakness). Electronic trading and algorithmic arbitrage fundamentally changed market microstructure, with the 2-period RSI signal showing consistent mean-reversion profitability since mid-2000s.

- **Mean Reversion Optimal Control Framework**: The Ornstein-Uhlenbeck (OU) process provides rigorous mathematical foundation for mean-reversion strategy design. Hamilton-Jacobi-Bellman optimization yields "no-trade zones" where transaction costs exceed expected reversion benefits, with Lipton-Lopez de Marcos closed-form solutions enabling practitioner calibration via maximum likelihood estimation on historical spreads.

- **Complementary Strategy Synthesis**: Mean reversion and trend-following have opposite failure modes (mean reversion fails in crises, trend fails in choppy markets), enabling portfolio construction through thousands of micro-strategies that achieve genuine non-correlation. Peter Lynch paradox (30% annual returns, investor losses) demonstrates how behavioral biases override signal quality—requiring frameworks built for leptokurtic distributions and black swan events, not Sharpe ratios alone.

- **Low-Vol Anomaly Across Asset Classes**: Low-volatility outperformance exists in equities (Sharpe ~2x higher in low-vol bins), crypto (effect stronger than equities in retail-dominated markets), and SPY (low-vol today predicts low-vol tomorrow through volatility clustering). Mechanisms: leverage constraints, retail lottery preferences, benchmark-relative mandates creating systematic overpricing of high-beta assets.

- **FX Mean Reversion Leverage Amplification**: Exponential position sizing on FX futures mean-reversion (basket-relative) achieves Sharpe 0.35 vs. 0.12 linear sizing, but reaches 450% maximum leverage. Volume-based filters (CV10/63 ratio) can improve mean-reversion Sharpe by 42% average profitability while reducing max drawdown 25%, though cross-strategy generalization remains limited.

- **Bitcoin Trend Dominance Over Mean Reversion**: Unlike equities, Bitcoin exhibits persistent trend-following edge (MAX strategy 10-day lookback optimal) that outperforms mean reversion (MIN strategy) especially in out-of-sample 2022-2024 bear market. Combined MIN+MAX achieves near all-time high performance with reduced drawdowns, suggesting crypto retained trend persistence despite 2017 maturation.

### Key Questions

- How quickly do fundamental-anchored anomalies attenuate in high-HFT environments versus passive index-heavy markets, and can practitioners measure attenuation rates in real-time to signal strategy retirement?
- Can rolling Hurst exponent estimation be implemented in production trading without lookahead bias, and what window lengths balance statistical reliability against timely regime detection?
- What explains the persistence of the low-vol anomaly despite decades of documented publication—is it purely behavioral (retail lottery demand) or does it reflect hidden systematic risk factors?
- Why does Bitcoin exhibit sustained trend-following edges while equity indices shifted to mean reversion post-1995, and does this reflect fundamental differences in institutional participation or market maturity curves?
- How to distinguish empirically between "free lunch" filter combinations that reduce costs while improving returns versus overfitted parameter choices that exploit historical backtest artifacts?

### Major Patterns & Themes

- **Regime Classification & Switching**: Quantitative diagnostics (Hurst exponent, RSI autocorrelation, efficiency ratio) enable switching between trend-following and mean-reversion strategies. Effective strategies dynamically condition on regime rather than using fixed rules, with rolling estimation capturing transitions.

- **Factor Persistence Hierarchy**: Fundamental factors (leverage constraints, behavioral biases) persist longest; statistical patterns decay rapidly. This creates a "durability ladder" where understanding the economic driver of an anomaly predicts its longevity better than historical returns alone.

- **Asset-Class Specificity**: Mean reversion works in FX and equities but Bitcoin shows trend edge; low-vol works in all three but with different strengths. No universal strategy applies across asset classes—each requires calibration to participation structure and liquidity microstructure.

- **Transaction Cost Importance**: Studies document "free lunches" where filters reduce turnover while improving returns (trend + mean-reversion filter: 7.55→5.58 turnover, CAGR 5.54%→6.89%). This reverses the traditional risk-return tradeoff, making transaction cost modeling foundational to strategy design.

- **Distribution Non-Normality**: Real market returns are leptokurtic (fat-tailed), not normal. Strategies must account for six-sigma events that happen multiple times per decade, not the theoretical "never" under Gaussian assumptions. This requirement drives portfolio synthesis (combining complementary approaches) over single-strategy concentration.

### File List
- raw/quantocracy/docs/036-kevin-davey-part-i-its-all-about-process-in-algo-trading.md
- raw/quantocracy/docs/8-ways-pandas-is-losing-to-polars-for-quick-market-data-analysis.md
- raw/quantocracy/docs/a-different-indicator.md
- raw/quantocracy/docs/a-long-term-look-at-the-wednesday-before-thanksgiving.md
- raw/quantocracy/docs/a-quants-guide-to-cross-section-maxxing-code-included.md
- raw/quantocracy/docs/a-two-factor-model-for-capturing-momentum-and-mean-reversion-in-stock-returns.md
- raw/quantocracy/docs/active-versus-index-funds-latest-results.md
- raw/quantocracy/docs/after-tax-performance-of-actively-managed-funds.md
- raw/quantocracy/docs/an-analysis-of-rebalancing-performance-dispersion.md
- raw/quantocracy/docs/and-the-winner-is-examining-alternative-value-metrics.md
- raw/quantocracy/docs/arbitrage-in-defi-p2.md
- raw/quantocracy/docs/artificial-intelligence-and-the-risks-of-harking-hypothesizing-after-the-fact.md
- raw/quantocracy/docs/autoregressive-drift-detection-method-addm-in-trading.md
- raw/quantocracy/docs/backtesting-course-from-rob-carver-march-7-and-8-in-person-and-remote.md
- raw/quantocracy/docs/bear-markets-through-the-decades.md
- raw/quantocracy/docs/betting-on-a-short-squeeze-as-investment-strategy.md
- raw/quantocracy/docs/bonds-versus-ctas-for-diversification.md
- raw/quantocracy/docs/breaking-bad-momentum-trends.md
- raw/quantocracy/docs/building-a-stock-portfolio-for-a-debt-averse-world.md
- raw/quantocracy/docs/calendar-anomalies-much-ado-about-nothing.md
- raw/quantocracy/docs/can-i-build-a-scalping-bot-a-blogpost-with-numerous-double-digit-sr.md
- raw/quantocracy/docs/can-technology-sector-leadership-be-systematically-exploited.md
- raw/quantocracy/docs/can-you-trust-the-fear-and-greed-index.md
- raw/quantocracy/docs/cesar-alvarez-a-novel-way-to-combine-trend-reversion-etfs-volatility-and-more.md
- raw/quantocracy/docs/clos-diversifier-or-another-equity-clone.md
- raw/quantocracy/docs/coding-live-forward-tests.md
- raw/quantocracy/docs/community-fav-quantstrat-trader-back-posting-after-almost-2-year-hiatus.md
- raw/quantocracy/docs/correlated-time-series-generation-using-object-oriented-python.md
- raw/quantocracy/docs/covered-calls-are-investors-making-a-devils-bargain.md
- raw/quantocracy/docs/crypto-market-arbitrage-profitability-and-risk-management.md
- raw/quantocracy/docs/data-building-micro-machines.md
- raw/quantocracy/docs/day-10-residuals.md
- raw/quantocracy/docs/day-18-autocorrelation-again.md
- raw/quantocracy/docs/day-25-positives-and-negatives.md
- raw/quantocracy/docs/day-5-trifactor.md
- raw/quantocracy/docs/defensive-factor-strategy-how-do-you-build-one.md
- raw/quantocracy/docs/detecting-wash-trading-in-major-crypto-exchanges.md
- raw/quantocracy/docs/diversifying-trend-following-strategies-improves-portfolio-efficiency.md
- raw/quantocracy/docs/does-dividend-impact-matter-to-stock-returns.md
- raw/quantocracy/docs/dr-ernest-chan-the-breakthrough-uses-of-machine-learning-in-risk-management.md
- raw/quantocracy/docs/duration-of-us-equities-ii.md
- raw/quantocracy/docs/efficiency-ratio-and-mean-reversion.md
- raw/quantocracy/docs/employing-volatility-of-volatility-in-long-term-volatility-forecasts.md
- raw/quantocracy/docs/equity-market-timing-the-value-of-consumption-data.md
- raw/quantocracy/docs/evaluating-long-term-performance-equities-bonds-commodities-usd.md
- raw/quantocracy/docs/explaining-overnight-returns-in-the-us.md
- raw/quantocracy/docs/extracting-structured-datasets-for-systematic-strategies-from-unstructured-textual-sources.md
- raw/quantocracy/docs/factor-seasonality-an-independent-risk-factor.md
- raw/quantocracy/docs/financial-machine-learning-pitfalls.md
- raw/quantocracy/docs/first-trading-day-of-the-month-has-generally-been-strong-except-august.md
- raw/quantocracy/docs/fractal-market-hypothesis-from-theory-to-practice.md
- raw/quantocracy/docs/front-running-seasonality-in-country-etfs-an-extended-test.md
- raw/quantocracy/docs/gaussian-gold.md
- raw/quantocracy/docs/getting-value-exposure-from-non-value-funds.md
- raw/quantocracy/docs/have-stock-markets-changed.md
- raw/quantocracy/docs/hidden-miners.md
- raw/quantocracy/docs/how-earnings-reports-affect-stocks.md
- raw/quantocracy/docs/how-much-damage-can-i-do-turbo-punting-shitcoins.md
- raw/quantocracy/docs/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin.md
- raw/quantocracy/docs/how-to-identify-ponzi-funds.md
- raw/quantocracy/docs/how-to-replicate-trend-following-managed-futures.md
- raw/quantocracy/docs/how-volatility-and-turnover-affect-return-reversals.md
- raw/quantocracy/docs/i-got-more-than-99-instruments-in-my-portfolio-but-butter-aint-one.md
- raw/quantocracy/docs/improving-hedged-equity-with-a-short-dated-ladder.md
- raw/quantocracy/docs/industry-classification-and-the-role-it-plays-in-momentum-strategies.md
- raw/quantocracy/docs/initial-test-of-trading-forex-news-announcements.md
- raw/quantocracy/docs/intangibles-and-the-value-factor.md
- raw/quantocracy/docs/introducing-max-gm-a-new-performance-statistic.md
- raw/quantocracy/docs/investing-unintended-consequences.md
- raw/quantocracy/docs/is-month-end-still-the-best-time-to-trade-tactical-strategies.md
- raw/quantocracy/docs/is-your-strategy-built-on-distributional-lies.md
- raw/quantocracy/docs/kronos-and-the-rise-of-pre-trained-market-models.md
- raw/quantocracy/docs/linking-impact-in-divergence-attribution-ii.md
- raw/quantocracy/docs/lunch-effect-in-the-us-stock-market-indices.md
- raw/quantocracy/docs/macro-trading-signal-optimization-basic-statistical-learning-methods.md
- raw/quantocracy/docs/major-brokerages-and-news-media-feature-technical-analysis.md
- raw/quantocracy/docs/markets-becoming-more-efficient-the-disappearing-index-effect.md
- raw/quantocracy/docs/member-note-our-approach-to-selecting-strategies-for-the-platform.md
- raw/quantocracy/docs/model-advances-in-clustering.md
- raw/quantocracy/docs/momentum-based-long-and-short-equities-portfolio.md
- raw/quantocracy/docs/monte-carlo-simulations-forecasting-folly.md
- raw/quantocracy/docs/much-ado-about-variance.md
- raw/quantocracy/docs/navigating-the-matrix-covariance-portfolio-stability.md
- raw/quantocracy/docs/new-contributor-scaling-python-financial-models-on-aws.md
- raw/quantocracy/docs/nlx-finances-hybrid-asset-allocation-60-40.md
- raw/quantocracy/docs/on-the-persistence-of-growth-and-value-stocks.md
- raw/quantocracy/docs/option-pricing-models-and-strategies-for-crude-oil-markets.md
- raw/quantocracy/docs/outperforming-cap-value-weighted-and-equal-weighted-portfolios.md
- raw/quantocracy/docs/parameter-exploration-with-quant-rv-and-heatmap.md
- raw/quantocracy/docs/performance-of-factors-what-the-research-says.md
- raw/quantocracy/docs/portable-alpha-for-all-return-stacked-strategies-for-diversification-without-sacrifice.md
- raw/quantocracy/docs/post-mortem-losing-money-at-36k-feet-above-sea-level-and-how-not-to.md
- raw/quantocracy/docs/predicting-corrections-and-economic-slowdowns.md
- raw/quantocracy/docs/profitably-trading-the-spx-opening-range-code-included.md
- raw/quantocracy/docs/python-vs-wolfram-language.md
- raw/quantocracy/docs/quant-and-machine-learning-links-20230820.md
- raw/quantocracy/docs/quant-signal-trade-offs-in-the-real-world.md
- raw/quantocracy/docs/quantpedia-awards-2025-winners-announcement.md
- raw/quantocracy/docs/random-portfolio-benchmarking-simulation-based-performance-evaluation-in-finance.md
- raw/quantocracy/docs/reduce-trading-costs-and-boost-profits-with-the-no-trade-region-strategy.md
- raw/quantocracy/docs/reinforcement-learning-in-finance-resources-and-expert-advice-from-paul-bilokon.md
- raw/quantocracy/docs/research-review-11-january-2024-fat-tail-distributions.md
- raw/quantocracy/docs/research-review-17-february-2023-risk-analysis.md
- raw/quantocracy/docs/research-review-21-dec-2023-portfolio-design-risk-factors.md
- raw/quantocracy/docs/research-review-7-november-2024-market-analytics.md
- raw/quantocracy/docs/rethinking-leveraged-etfs-and-their-options.md
- raw/quantocracy/docs/revisiting-overnight-vs-intraday-equity-returns.md
- raw/quantocracy/docs/rob-hanna-is-a-quant-blogging-og-streaking-longer-than-ripken.md
- raw/quantocracy/docs/rolling-regime.md
- raw/quantocracy/docs/sector-neutralization-why-it-matters-and-how-to-use-it.md
- raw/quantocracy/docs/setfit-fine-tuning-a-llm-in-10-lines-of-code-and-little-labeled-data.md
- raw/quantocracy/docs/should-investors-combine-or-separate-their-factor-exposures.md
- raw/quantocracy/docs/skewness-premium-in-managed-futures-a-practitioners-guide.md
- raw/quantocracy/docs/spx-golden-crosses-since-1928.md
- raw/quantocracy/docs/statistical-shrinkage.md
- raw/quantocracy/docs/stocks-arent-always-the-best-in-the-long-run.md
- raw/quantocracy/docs/switch-off-robust-changepoint-protocol.md
- raw/quantocracy/docs/tactical-asset-allocation-performance-2022-bear-market.md
- raw/quantocracy/docs/taming-olmars-1222-backtest-into-a-sustainable-106-cagr.md
- raw/quantocracy/docs/testing-macro-trading-factors.md
- raw/quantocracy/docs/the-ability-to-nav-time-interval-funds.md
- raw/quantocracy/docs/the-bitter-lesson.md
- raw/quantocracy/docs/the-derivative-payoff-bias.md
- raw/quantocracy/docs/the-factor-mirage-how-quant-models-go-wrong.md
- raw/quantocracy/docs/the-growth-and-inflation-sector-timing-model.md
- raw/quantocracy/docs/the-impact-of-inflation-on-the-performance-of-the-us-dollar.md
- raw/quantocracy/docs/the-lumber-gold-strategy.md
- raw/quantocracy/docs/the-points-and-line-chart.md
- raw/quantocracy/docs/the-risks-of-passive-investing-dominance.md
- raw/quantocracy/docs/the-surefire-ratio-my-custom-risk-ratio-that-supercharged-my-investing.md
- raw/quantocracy/docs/the-value-of-wallstreetbets-investment-research-recommendations.md
- raw/quantocracy/docs/time-series-models-using-object-oriented-python.md
- raw/quantocracy/docs/trading-0dte-options-with-the-ibkr-native-api.md
- raw/quantocracy/docs/trading-the-mean-reversion-curve.md
- raw/quantocracy/docs/trend-following-in-equities.md
- raw/quantocracy/docs/uncovering-the-pre-ecb-drift-and-its-trading-strategy-applications.md
- raw/quantocracy/docs/unified-approach-for-hedging-impermanent-loss-of-liquidity-provision.md
- raw/quantocracy/docs/us-stock-momentum-trading-system-for-retail-traders-deep-research.md
- raw/quantocracy/docs/using-time-series-lag-in-r-finance.md
- raw/quantocracy/docs/value-vs-quality-more-correlated-than-ever.md
- raw/quantocracy/docs/volatility-forecasting-garch-1-1-model.md
- raw/quantocracy/docs/volatility-targeting-across-asset-pricing-factors-and-industry-portfolios.md
- raw/quantocracy/docs/wes-discusses-value-investing-foundations-with-isaiah-douglass.md
- raw/quantocracy/docs/what-is-trend-following-a-painful-journey-to-smarter-investing.md
- raw/quantocracy/docs/when-point-forecasts-are-completely-useless.md
- raw/quantocracy/docs/why-bonds-still-belong-rethinking-fixed-income-in-modern-portfolios.md
- raw/quantocracy/docs/why-you-cant-tell-if-your-strategy-stopped-working-statistically-speaking.md
- raw/quantocracy/pages-011-020.md
- raw/quantocracy/pages-091-100.md
