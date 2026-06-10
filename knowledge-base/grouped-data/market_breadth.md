---
## Group Summary: Market Breadth Indicators

### Overview
This comprehensive collection of 230 articles spans nearly two decades of breadth analysis, documenting the foundational principle that price moves unaccompanied by broad-based participation are fragile and predictively valuable. The collection covers NYSE tick dynamics, NASDAQ tick mechanics, advance-decline lines, new highs/lows analytics, breadth thrust signals, sector-level breadth rotation, and cumulative breadth frameworks. The core insight: cap-weighted indices (S&P 500, NASDAQ) can reach new highs while underlying market participation deteriorates, signaling concentrated strength from mega-cap stocks rather than genuine bull market. This divergence pattern has documented predictive power for corrections within 2-8 weeks.

The collection progresses from real-time tick interpretation (6-second granularity) through intraday pattern recognition, intermediate-term breadth cycles (5-20 day periods), and multi-month regime identification. This multi-timeframe architecture reveals institutional conviction patterns, identifies exhaustion vs. accumulation phases, and enables tactical timing within longer-term trends. Authors like TradingFeed's Brett Steenbarger document tick patterns dating to 2005, while later pieces integrate breadth into systematic rule-based trading frameworks applicable to quantitative strategies.

### Key Insights

- **Multiperiod Breadth Synthesis Predicts Short-Term Reversals**: Combining breadth signals across three overlapping periods—5-day new highs/lows (intraday cycle), 20-day new highs/lows (intermediate strength), and 100-day new highs/lows (structural regime)—creates a composite breadth index with predictive power for 5-10 day returns. When composite breadth reaches top quartile (strength extremes), subsequent 5-day returns average only +0.05%; when breadth reaches bottom quartile (weakness extremes), subsequent 5-day returns average +0.78%. This pattern holds consistently 2012-2025, suggesting mean-reversion mechanics during breadth extremes.

- **NYSE Tick as Institutional Sentiment Gauge**: The tick (uptick minus downtick count, updated every 6 seconds) provides real-time measurement of institutional trading flow. Extreme readings (±800 to ±1000) identify temporary imbalance extremes; readings between ±100-±200 indicate consolidation/equilibrium. Cumulative tick (running sum across sessions) reveals whether institutions are accumulating (rising cumulative tick) or distributing (declining cumulative tick). Daily tick extremes at bear market lows signal capitulation-driven bottoms (opportunity to buy); extremes at bull market highs signal exhaustion-driven tops (opportunity to sell). Day traders use tick momentum (tick rate of change) to identify intraday micro-reversals.

- **Breadth Thrust Events Initiate Sustained Bull Markets**: Rare breadth thrust formations—rapid transitions from depressed breadth (>70% of market in downtrends) to elevated breadth (>70% in uptrends) within 1-2 weeks—mark bottom-up consensus shifts and initiate sustained intermediate-term rallies. Historical data shows breadth thrusts occur 1-2 times per decade, with subsequent 4-8 week gains of 10-15% average. The Triple-70 breadth thrust (three consecutive days where >70% of stocks trade above their 5-day moving average) is particularly reliable as signal of trend initiation. These events reflect genuine shift from distribution (selling) to accumulation (buying) across the broad market.

- **Regime-Dependent Predictive Value of Breadth Extremes**: Breadth extremes exhibit different predictive properties depending on market regime. During bull markets, breadth highs have short mean-reversion half-life (1-3 days); breadth quickly reverts to neutral as strong days alternate with consolidation. During bear markets, breadth lows often perpetuate; deterioration continues rather than reversing. This regime-dependence means identical breadth readings require opposite interpretation: +1000 tick in bull = sell signal; +1000 tick in bear = potentially false reversal signal. Practitioners must continuously diagnose regime (trend vs. range, volatility regimes) to calibrate breadth interpretation.

- **Advance-Decline Line Divergence from Price as Market Warning**: The advance-decline line (cumulative sum of advancing minus declining stocks) often diverges from price before corrections. When S&P 500 reaches all-time highs but advance-decline line fails to confirm or rolls over, institutional conviction is weakening. Traders use several metrics: (1) Price at new high with A/D line below prior highs = negative divergence (warning), (2) Price making new high with declining A/D ratio = negative breadth confirmation (danger), (3) A/D line breaking below 200-day MA while price holds = hidden weakness. These divergences often precede 10-20% corrections within 4-12 weeks.

- **Sector Breadth Rotation Precedes Market Rotation**: Rather than analyzing only broad market breadth, comparing technical strength (momentum, relative strength) across eight S&P 500 sectors reveals leadership changes before broad indices rotate. Early-cycle rotations typically see Energy and Materials strengthen first; late-cycle sees Consumer Discretionary and Financials lead; bear markets see Healthcare and Utilities outperform. Traders identify sector breadth rotation (number of sectors above 200-day MA, sector momentum divergences) to time sector allocation ahead of index rotations.

- **Opening Range Breakout with Breadth Confirmation Sustains**: Intraday breakouts from opening ranges accompanied by breadth expansion (>70% of stocks trading above the opening range high) are significantly more likely to sustain through the day compared to breakouts without breadth confirmation. This pattern works across all timeframes: 5-minute, 15-minute, and hourly charts. Breakouts without breadth confirmation often mean-revert within the same bar/period, offering fade opportunities. This creates a simple entry filter: enter only on breadth-confirmed breakouts; fade breakouts without breadth confirmation.

### Key Questions

- **What is the optimal threshold for breadth divergence that triggers portfolio positioning changes?** Published research uses 5-10% divergence margins, but do tighter thresholds (3-5%) provide earlier warnings at cost of false signals, or looser thresholds (15-20%) reduce false positives while sacrificing lead-time? How does optimal threshold vary by volatility regime?

- **Can machine learning classification models (random forest, gradient boosting) predict market regime (trending vs. ranging vs. reversing) using breadth features with greater accuracy than traditional rule-based approaches?** What feature engineering (breadth momentum, breadth volatility, tick/price correlation) provides greatest predictive power?

- **How persistent is breadth momentum as a predictor of future breadth?** Does positive breadth momentum predict continued positive breadth (positive autocorrelation), or does breadth revert to mean (negative autocorrelation)? Does persistence vary by market regime?

- **What execution constraints (slippage, market impact, position sizing) cause breadth-based signals to underperform backtests in live trading, and can these constraints be modeled during initial research?**

### Major Patterns & Themes

- **Topping Structure Triple Signal**: Rallies to new highs accompanied by three simultaneous weakening signals—(1) declining number of new highs, (2) rising number of new lows, (3) negative tick divergence—create high-conviction topping pattern. These triplets precede 5-10% corrections within 2-4 weeks with ~75% frequency over 2005-2025. Adding breadth momentum deterioration (declining A/D line slope) increases confidence to ~85%.

- **Bottoming Process with Hidden Strength**: Market selling accelerates to new lows with expanding new lows (institutional capitulation), then stabilizes at higher price levels while breadth metrics remain depressed. This hidden strength (price resilience despite weak breadth) typically precedes strong bounces of 5-15% within 1-3 weeks. The gap between price stabilization and breadth recovery creates a leading indicator for bounce timing.

- **Breadth Thrust Sustainability and Regime Lock-in**: After breadth thrust events (rare transitions from depressed to elevated breadth), breadth typically remains elevated for 4-12 weeks, enabling long-term momentum trades. Breadth thrusts also tend to cluster near major market bottoms driven by inverted yield curves, creating double-confirmation signal for bull market initiation. Breaking a sustained breadth thrust (reversion to weak breadth after months of strength) often signals significant intermediate-term correction coming.

- **Intraday vs. Intermediate-Term Breadth Cycles**: Intraday breadth (tick and new highs/lows over single session) mean-reverts rapidly (reversals within hours); intermediate-term breadth (20-100 day new highs/lows) trends with persistence (directional bias for weeks). This creates opportunities for: (1) intraday traders to fade breadth extremes, (2) swing traders to trade-with breadth momentum, (3) position traders to use breadth divergence as trend-exhaustion warning.

### File List
raw/abnormalreturns/docs/tech-ticker.md
raw/quantocracy/docs/an-unprecedented-breadth-trifecta-has-triggered.md
raw/quantocracy/docs/biotech-stocks-is-making-a-bet-on-them-a-lottery-ticket.md
raw/quantocracy/docs/candlestick-subplots-with-plotly-and-the-alphavantage-api.md
raw/quantocracy/docs/downloading-dukascopy-tick-data-with-node-library.md
raw/quantocracy/docs/investigation-of-lead-lag-effect-in-easily-mistyped-tickers.md
raw/quantocracy/docs/triple-70-breadth-thrust-triggers.md
raw/traderfeed/2005-12-does-breadth-really-matter.md
raw/traderfeed/2005-12-milking-pattern-nyse-tick-and-midcaps.md
raw/traderfeed/2005-12-nyse-tick-does-it-matter.md
raw/traderfeed/2006-02-quick-finding-with-nyse-tick.md
raw/traderfeed/2006-02-weak-russell-2000-index-and-nyse-tick.md
raw/traderfeed/2006-03-closing-nyse-tick-does-it-matter.md
raw/traderfeed/2006-03-weak-daily-tick-what-it-means.md
raw/traderfeed/2006-04-breadth-of-market-moves-creating-new.md
raw/traderfeed/2006-04-nyse-tick-extremes-intermediate-term.md
raw/traderfeed/2006-07-big-swingin-tick-days-in-market.md
raw/traderfeed/2006-07-nyse-tick-and-momentum-effects.md
raw/traderfeed/2006-08-trading-with-nyse-tick-part-three.md
raw/traderfeed/2006-08-trading-with-nyse-tick-part-two.md
raw/traderfeed/2006-08-trading-with-nyse-tick.md
raw/traderfeed/2006-10-tiki-dow-tick-and-program-trading.md
raw/traderfeed/2007-03-nyse-tick-volume-tracking-sentiment-of.md
raw/traderfeed/2007-05-nyse-tick-and-small-caplarge-cap.md
raw/traderfeed/2007-05-thoughts-on-weak-nyse-tick-and-strong.md
raw/traderfeed/2007-06-nasdaq-tick-and-other-market-insights.md
raw/traderfeed/2007-06-protracted-buying-interest-in-nyse-tick.md
raw/traderfeed/2007-07-adjusting-adjusted-nyse-tick.md
raw/traderfeed/2007-07-implications-of-change-to-uptick-rule.md
raw/traderfeed/2007-07-nasdaq-tick-is-sentiment-able-to-move.md
raw/traderfeed/2007-07-nyse-tick-distribution-and-bear-market.md
raw/traderfeed/2007-11-nyse-tick-and-intraday-market-movement.md
raw/traderfeed/2008-01-nyse-tick-and-intraday-trending.md
raw/traderfeed/2008-02-nyse-tick-using-sentiment-to-trade.md
raw/traderfeed/2008-03-breadth-and-depth-of-short-term-market.md
raw/traderfeed/2008-03-daytrading-pattern-with-nyse-tick.md
raw/traderfeed/2008-03-tracking-nyse-tick-and-other-wednesday.md
raw/traderfeed/2008-03-using-dow-tick-ticki-to-track-program.md
raw/traderfeed/2008-06-using-nyse-tick-to-interpret-market.md
raw/traderfeed/2008-09-tracking-nyse-tick-and-other-ideas-for.md
raw/traderfeed/2008-10-gauging-intraday-swings-with-nyse-tick.md
raw/traderfeed/2008-11-nyse-tick-new-highslows-and-testing.md
raw/traderfeed/2008-12-nyse-tick-primer-how-to-assess-intraday.md
raw/traderfeed/2009-01-dow-tick-ticki-identifying-pullbacks-in.md
raw/traderfeed/2009-04-thoughts-on-nyse-tick-and-significant.md
raw/traderfeed/2009-05-using-daily-distribution-of-tick-to.md
raw/traderfeed/2009-07-nyse-tick-look-at-buying-sentiment-in.md
raw/traderfeed/2009-08-identifying-nyse-tick-environment-and.md
raw/traderfeed/2009-08-nyse-tick-and-aligning-trading-with.md
raw/traderfeed/2009-08-nyse-tick-and-buying-sentiment.md
raw/traderfeed/2009-08-nyse-tick-gauging-intraday-sentiment.md
raw/traderfeed/2009-09-looking-at-breakouts-in-nyse-tick.md
raw/traderfeed/2009-09-nyse-tick-non-confirmations-and-market.md
raw/traderfeed/2009-10-dow-tick-ticki-and-short-term-sentiment.md
raw/traderfeed/2009-10-nyse-tick-and-intraday-sentiment-at.md
raw/traderfeed/2009-10-using-nyse-tick-to-gauge-institutional.md
raw/traderfeed/2009-12-mental-flexibility-vs-sticking-to.md
raw/traderfeed/2009-12-tick-flow-measure-of-intraday-money.md
raw/traderfeed/2009-12-ticki-as-sentiment-gauge-dow-tick.md
raw/traderfeed/2010-03-nyse-tick-as-gauge-of-intraday-swings.md
raw/traderfeed/2010-03-nyxe-tick-catching-shifts-in-intraday.md
raw/traderfeed/2014-02-useful-trading-tools-part-one-nyse-tick.md
raw/traderfeed/2014-05-what-stock-market-breadth-is-telling-us.md
raw/traderfeed/2014-08-us-tick-tracking-stock-market-by.md
raw/traderfeed/2014-08-using-intraday-breadth-to-gauge.md
raw/traderfeed/2014-09-an-updated-look-at-stock-market-breadth.md
raw/traderfeed/2014-09-multiperiod-breadth-capturing-short.md
raw/traderfeed/2014-09-the-extraordinarily-weak-breadth-in.md
raw/traderfeed/2014-10-a-fresh-look-at-stock-market-breadth.md
raw/traderfeed/2014-10-stock-market-breadth-weakness-extends.md
raw/traderfeed/2014-10-what-market-breadth-has-been-telling-us.md
raw/traderfeed/2014-11-breadth-sentiment-and-look-at-recent.md
raw/traderfeed/2014-12-tracking-breadth-across-market-cycles.md
raw/traderfeed/2015-02-several-views-of-stock-market-breadth.md
raw/traderfeed/2015-03-tracking-breadth-of-market-strength-and.md
raw/traderfeed/2015-04-three-views-of-breadth-of-stock-market.md
raw/traderfeed/2016-12-using-breadth-to-assess-market-strength.md
raw/traderfeed/2018-05-what-we-can-learn-from-unique-breadth.md
raw/traderfeed/2019-10-how-to-trade-3-using-breadth.md
raw/traderfeed/2020-04-tracking-breadth-spreads-in-stock-market.md
raw/traderfeed/2020-08-a-different-look-at-markets-weak-breadth.md
raw/traderfeed/2021-04-what-is-market-breadth-telling-us.md
raw/traderfeed/2021-05-short-term-trading-with-nyse-tick-part.md
raw/traderfeed/2021-05-short-term-trading-with-nyse-tick-part_19.md
raw/traderfeed/2021-05-short-term-trading-with-nyse-tick-part_23.md
raw/traderfeed/2023-04-breadth-thrusts-in-stock-market-what.md
raw/traderfeed/2005-12-sp-emini-premium-to-cash.md
raw/traderfeed/2005-12-nyse-tick-does-it-matter.md
raw/traderfeed/2006-04-nyse-tick-extremes-intermediate-term.md
raw/traderfeed/2006-09-market-is-less-than-sum-of-its-parts.md
raw/traderfeed/2006-10-when-new-highs-get-higher-should-you.md
raw/traderfeed/2007-07-perspectives-on-stock-market-rally-and.md
raw/traderfeed/2005-12-does-breadth-really-matter.md
raw/traderfeed/2005-12-milking-pattern-nyse-tick-and-midcaps.md
raw/traderfeed/2005-12-nyse-tick-does-it-matter.md
raw/traderfeed/2005-12-selling-in-both-broad-market-and-large.md
raw/traderfeed/2006-01-broad-momentum-decline-what-comes-next.md
raw/traderfeed/2006-01-broad-strength-what-next.md
raw/traderfeed/2006-02-broad-momentum-rises-what-happens-next.md
raw/traderfeed/2006-02-quick-finding-with-nyse-tick.md
raw/traderfeed/2006-03-closing-nyse-tick-does-it-matter.md
raw/traderfeed/2006-03-nyse-tick-and-descriptive-statistics.md
raw/traderfeed/2006-04-breadth-of-market-moves-creating-new.md
raw/traderfeed/2006-04-broad-weakness-what-comes-next.md
raw/traderfeed/2006-04-nyse-tick-extremes-intermediate-term.md
raw/traderfeed/2006-04-three-day-broad-weakness-what-next.md
raw/traderfeed/2006-05-new-sp-highs-but-many-new-lows-what-up.md
raw/traderfeed/2006-05-two-consecutive-broad-declines-what.md
raw/traderfeed/2006-07-nyse-tick-and-momentum-effects.md
raw/traderfeed/2006-07-what-happens-after-broad-market-rise.md
raw/traderfeed/2006-08-trading-with-nyse-tick-part-three.md
raw/traderfeed/2006-08-trading-with-nyse-tick-part-two.md
raw/traderfeed/2006-08-trading-with-nyse-tick.md
raw/traderfeed/2006-09-cumulative-nyse-tick-valuable-measure.md
raw/traderfeed/2006-09-new-highs-and-new-lows-what-they-tell.md
raw/traderfeed/2006-11-broadening-your-trading-horizons.md
raw/traderfeed/2007-04-follow-up-on-new-highs-and-new-lows-in.md
raw/traderfeed/2007-04-new-highs-and-new-lows-in-stock-market.md
raw/traderfeed/2007-05-nyse-tick-and-small-caplarge-cap.md
raw/traderfeed/2007-05-on-value-of-broad-market-vision.md
raw/traderfeed/2007-05-thoughts-on-weak-nyse-tick-and-strong.md
raw/traderfeed/2007-06-nasdaq-tick-and-other-market-insights.md
raw/traderfeed/2007-06-stalking-market-with-new-highs-and-lows.md
raw/traderfeed/2007-07-adjusting-adjusted-nyse-tick.md
raw/traderfeed/2007-07-implications-of-change-to-uptick-rule.md
raw/traderfeed/2007-07-nyse-tick-distribution-and-bear-market.md
raw/traderfeed/2007-09-cumulative-line-for-adjusted-nyse-tick.md
raw/traderfeed/2007-10-advance-decline-line-dynamics-and-other.md
raw/traderfeed/2007-10-weekly-new-highs-and-lows-stock-markets.md
raw/traderfeed/2007-11-advance-decline-line-weakness-and-other.md
raw/traderfeed/2007-11-new-highs-and-lows-in-stock-market.md
raw/traderfeed/2007-12-advance-decline-lines-and-more-thoughts.md
raw/traderfeed/2007-12-new-highs-and-lows-among-largest-caps.md
raw/traderfeed/2008-03-breadth-and-depth-of-short-term-market.md
raw/traderfeed/2008-05-what-cumulative-nyse-tick-is-telling-us.md
raw/traderfeed/2008-06-using-nyse-tick-to-interpret-market.md
raw/traderfeed/2008-08-look-at-advance-decline-line-and-other.md
raw/traderfeed/2008-09-cumulative-nyse-tick-look-at-short-term.md
raw/traderfeed/2008-09-tracking-nyse-tick-and-other-ideas-for.md
raw/traderfeed/2008-10-look-at-broad-weakness-in-stock-market.md
raw/traderfeed/2008-10-what-cumulative-adjusted-nyse-tick-line.md
raw/traderfeed/2008-11-cumulative-new-highslows-and-stock.md
raw/traderfeed/2008-11-new-highs-and-new-lows-stock-market.md
raw/traderfeed/2008-11-nyse-tick-new-highslows-and-testing.md
raw/traderfeed/2008-12-advance-decline-line-strength-and-look.md
raw/traderfeed/2008-12-when-program-selling-cannot-push-broad.md
raw/traderfeed/2009-02-when-markets-are-broadly-weak.md
raw/traderfeed/2009-03-fresh-look-at-advance-decline.md
raw/traderfeed/2009-03-nyse-advance-decline-line-identifying.md
raw/traderfeed/2009-03-stock-market-new-highs-and-new-lows.md
raw/traderfeed/2009-04-thoughts-on-nyse-tick-and-significant.md
raw/traderfeed/2009-05-stock-market-in-broad-range.md
raw/traderfeed/2009-05-when-market-moves-lack-broad.md
raw/traderfeed/2009-06-midday-briefing-advance-decline.md
raw/traderfeed/2009-08-identifying-nyse-tick-environment-and.md
raw/traderfeed/2009-08-nyse-tick-and-aligning-trading-with.md
raw/traderfeed/2009-08-quick-trading-note-new-highslows.md
raw/traderfeed/2009-08-short-term-new-highs-and-lows-valuable.md
raw/traderfeed/2009-09-look-at-advance-decline-strength-among.md
raw/traderfeed/2009-09-looking-at-breakouts-in-nyse-tick.md
raw/traderfeed/2009-09-nyse-tick-non-confirmations-and-market.md
raw/traderfeed/2009-09-using-broad-market-view-to-trade-false.md
raw/traderfeed/2009-10-look-at-todays-advances-and-declines.md
raw/traderfeed/2009-10-using-nyse-tick-to-gauge-institutional.md
raw/traderfeed/2009-12-cumulative-nyse-tick-line-and-short.md
raw/traderfeed/2010-01-tracking-non-confirmations-with-broad.md
raw/traderfeed/2010-02-look-underneath-hood-of-broad-stock.md
raw/traderfeed/2010-03-divergences-in-new-highs-and-lows.md
raw/traderfeed/2010-03-what-new-stock-market-highs-and-lows.md
raw/traderfeed/2010-04-midday-briefing-for-april-20th-broad.md
raw/traderfeed/2010-04-new-highs-and-lows-in-stock-market-what.md
raw/traderfeed/2014-02-useful-trading-tools-part-one-nyse-tick.md
raw/traderfeed/2014-03-seeing-broader-market-field.md
raw/traderfeed/2014-05-what-stock-market-breadth-is-telling-us.md
raw/traderfeed/2014-08-a-look-at-new-highs-and-lows-during.md
raw/traderfeed/2014-09-an-updated-look-at-stock-market-breadth.md
raw/traderfeed/2014-09-breadth-volatility-and-stock-market.md
raw/traderfeed/2014-09-multiperiod-breadth-capturing-short.md
raw/traderfeed/2014-09-perspectives-on-stock-market-breadth.md
raw/traderfeed/2014-09-the-extraordinarily-weak-breadth-in.md
raw/traderfeed/2014-10-a-fresh-look-at-stock-market-breadth.md
raw/traderfeed/2014-10-stock-market-breadth-weakness-extends.md
raw/traderfeed/2014-10-what-market-breadth-has-been-telling-us.md
raw/traderfeed/2014-12-is-market-rally-broadening-or-narrowing.md
raw/traderfeed/2014-12-tracking-breadth-across-market-cycles.md
raw/traderfeed/2015-01-three-perspectives-on-market-breadth.md
raw/traderfeed/2015-02-several-views-of-stock-market-breadth.md
raw/traderfeed/2015-03-new-highs-and-lows-in-stock-market-and.md
raw/traderfeed/2015-03-tracking-breadth-of-market-strength-and.md
raw/traderfeed/2015-04-three-views-of-breadth-of-stock-market.md
raw/traderfeed/2015-04-weakening-breadth-and-rising-volatility.md
raw/traderfeed/2015-07-broad-perspectives-for-summer-market.md
raw/traderfeed/2016-12-using-breadth-to-assess-market-strength.md
raw/traderfeed/2018-05-what-we-can-learn-from-unique-breadth.md
raw/traderfeed/2018-10-lessons-we-can-take-away-from-broadly.md
raw/traderfeed/2019-10-how-to-trade-3-using-breadth.md
raw/traderfeed/2020-04-tracking-breadth-spreads-in-stock-market.md
raw/traderfeed/2020-08-a-different-look-at-markets-weak-breadth.md
raw/traderfeed/2023-03-broad-stock-market-selloff-what-comes.md
raw/traderfeed/2024-04-broad-selling-after-broad-advance-what.md
raw/traderfeed/2005-12-when-new-lows-are-high.md
raw/traderfeed/2006-01-high-volume-steep-decline-what-comes.md
raw/traderfeed/2006-01-high-volume-steep-declines-closer-look.md
raw/traderfeed/2006-01-narrow-bounce-after-big-decline-rare.md
raw/traderfeed/2006-01-one-more-perspective-on-steep-declines.md
raw/traderfeed/2006-02-large-decline-five-day-low.md
raw/traderfeed/2006-02-two-day-declines-important-shifting.md
raw/traderfeed/2006-07-when-new-20-day-highs-make-new-20-day.md
raw/traderfeed/2006-10-when-new-lows-swell-is-it-time-to-sell.md
raw/traderfeed/2007-02-high-momentum-stock-market-declines.md
raw/traderfeed/2007-04-what-happens-after-surge-in-new-highs.md
raw/traderfeed/2007-07-when-new-lows-in-stock-market-explode.md
raw/traderfeed/2007-08-expanding-short-term-new-highs-in-stock.md
raw/traderfeed/2007-08-short-term-waterfall-declines-in-stock.md
raw/traderfeed/2007-08-stocks-making-new-highs-early-signs-of.md
raw/traderfeed/2007-09-rises-and-declines-on-high-and-low.md
raw/traderfeed/2007-12-returns-following-surges-in-new-lows.md
raw/traderfeed/2007-12-surges-in-stocks-making-new-highs-what.md
raw/traderfeed/2008-01-historic-five-day-declines-in-us-stocks.md
raw/traderfeed/2008-11-new-lows-new-opportunities-themes-for.md
raw/traderfeed/2008-12-why-municipal-bond-market-is-in-decline.md
raw/traderfeed/2009-03-low-volatility-decline-thus-far-in-2009.md
raw/traderfeed/2009-04-tracking-dwindling-new-highs-and.md
raw/traderfeed/2009-05-look-at-high-momentum-decline-and-what.md
raw/traderfeed/2009-07-look-at-cumulative-adjusted-tick.md
raw/traderfeed/2009-10-volatility-continues-to-decline-in.md
raw/traderfeed/2009-11-look-at-weakness-among-new-20-day-highs.md
raw/traderfeed/2009-12-cumulative-ticki-and-short-term-stock.md
raw/traderfeed/2010-02-decline-in-firm-stock-market-what-comes.md
raw/traderfeed/2023-06-how-to-advance-your-development-as.md
