## Group Summary: Straddle Strategies

### Key Insights
- Long straddles are pre-earnings volatility plays that profit from large price moves in either direction, requiring careful timing of entry (7-10 days before earnings) and exit (immediately after earnings announcement). Holding through earnings announcement typically destroys profits despite favorable moves due to IV crush, with backtested data showing -1.31% average for AAPL, 0.70% for FB, -2.59% for CMG over 10-year periods.
- Implied volatility (IV) crush is the dominant profit driver and risk: straddle premiums expand as earnings approach, creating profit opportunity pre-earnings; then collapse post-announcement regardless of the directional move, turning wins to losses. Exiting 1-2 days after earnings before IV fully normalizes is critical to capturing IV expansion profit.
- Short straddles generate income in sideways markets but carry undefined risk with immediate assignment exposure at large moves. Mathematical analysis shows break-even points (strike ± total premium collected), with leverage through portfolio selling producing 6-7% annual returns but exposing traders to gap risk and assignment complications.
- Expected move calculations (derived from ATM option prices) represent market consensus about likely price range; selecting straddle strikes too far from expected move (buying lower-delta options) requires larger moves to profit, while ATM selection maximizes probability of profit but costs more premium.
- Backtesting parameter sensitivity is extreme: entry timing (7 days vs 21 days before earnings) produces dramatically different backtest results, suggesting traders must optimize entry date selection per stock rather than using fixed calendars. Delta level, exit timing, and implied volatility regime all impact profitability significantly.
- Covered straddles (selling straddles while owning shares) reduce risk to portfolio-level decline, applicable during consolidation periods when downside is protected by share ownership. This creates income generation with limited downside, though upside is capped at strike price.
- Expected value analysis reveals straddles and strangles have similar expected values despite different probability/reward structures: straddles have higher probability of profit but lower reward; strangles have lower probability but higher reward. Optimal selection depends on trader's risk tolerance and expected move magnitude.

### Key Questions
- What is the optimal entry timing (days before earnings) and exit timing (same day, next day, or multiple days after announcement) for different stocks and historical volatility regimes?
- How should you calculate expected move from option prices and use that to select optimal strike deltas for straddles versus strangles given your volatility forecast?
- When is short straddle selling appropriate versus covered straddles, and how should position sizing change based on account leverage and portfolio volatility?

### File List
raw/investopedia/long-straddle.md
raw/investopedia/short-straddle.md
raw/investopedia/straddles-vs-strangles.md
raw/predictingAlpha/straddle-vs-strangle-options.md
raw/predictingAlpha/what-is-a-short-straddle.md
raw/projectoption/long-straddle.md
raw/projectoption/short-straddle.md
raw/steadyoptions/backtesting-pre-earnings-straddles-using-cml-trademachine-r518.md
raw/steadyoptions/covered-straddle-explained-r520.md
raw/steadyoptions/how-we-made-23-on-qihu-straddle-in-4-hours-r141.md
raw/steadyoptions/long-and-short-straddles-opposite-structures-r507.md
raw/steadyoptions/long-straddle-guaranteed.md
raw/steadyoptions/long-straddle-option.md
raw/steadyoptions/long-straddle-options-strategy-maximize-profits-with-big-moves-r750.md
raw/steadyoptions/long-straddle-through-earnings-backtest-r342.md
raw/steadyoptions/selling-short-strangles-and-straddles-does-it-work-r516.md
raw/steadyoptions/selling-straddles-too-risky-r251.md
raw/steadyoptions/straddle-option-overview-r286.md
raw/steadyoptions/straddle-vs-strangle-options-strategy-r734.md
raw/steadyoptions/straddle-vs-strangle.md
raw/steadyoptions/straddles-risks-determine-when-they-are-best-used-r386.md
raw/steadyoptions/why-we-sell-our-straddles-before-earnings-r148.md
