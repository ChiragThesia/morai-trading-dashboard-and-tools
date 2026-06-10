---
## Group Summary: Calendar & Diagonal Spreads

### Overview
This collection of 39 files covers calendar spread mechanics, variants, and advanced applications across platforms (SteadyOptions, Tastytrade, Predictable Alpha, Quantocracy). Calendar spreads (also called time spreads, counter spreads, horizontal spreads) sell near-term options and buy longer-term options at same or nearby strikes. Dual profit mechanisms: theta decay (short option loses value faster) + vega asymmetry (longer-dated options have higher vega, benefiting from IV increase). Key distinction from vertical spreads: profit depends on time passage and IV change, not directional move. Best-suited for range-bound, low-volatility periods with defined inflection points at short-option expiration. Advanced applications include pre-earnings calendars and diagonal spreads with strikes offset.

### Key Insights
- **Dual Profit Mechanisms: Theta + Positive Vega Asymmetry**: Primary profit from theta decay—short 30 DTE option loses value faster than long 60 DTE option. Secondary profit from vega asymmetry—longer-dated options have ~3x vega of near-term. IV increase benefits position: back-month gains outpace front-month gains (same strike, vega asymmetry). BUT this only helps if stock near strike; if stock far away, vega increase can't compensate for directional loss.

- **Three Expiration Variables Shape Net Debit and Max Profit**: (1) Strike selection (ITM cheapest entry $3.65, ATM moderate $4.25, OTM cheapest spread but requires move $1.74); (2) Expiration gap (wider gap = higher debit, longer vega advantage); (3) IV skew (buy long when IV rank low, sell short when IV rank high for max margin). Sweet spot: front month high IV (sell overpriced), back month low IV (buy underpriced).

- **Front-Month Expiration is Critical Inflection Point**: Profit peaks when short option expires worthless with stock at or near strike. Before expiration: theta + vega both available. At expiration: theta collapse, vega profile shifts (short vega → zero, long still meaningful). Post-expiration: trade becomes pure directional if stock far from strike. Management decision point occurs 3-5 days before expiration: hold for final theta, roll to new month, or close.

- **Vega Profile Shift Creates Time-Dependent Risk**: As short option approaches expiration, vega → 0 (infinitesimal DTE = no vega). Long option retains weeks and maintains vega exposure. This asymmetry accelerates into final week. IV rise in final week of short option has minimal impact (vega near zero), but same IV rise in back month helps position. Late-cycle trade dynamics dominated by back-month vega, not front-month decay.

- **Net Debit Structure = Maximum Possible Loss**: Unlike iron condors or spreads that collect credit, calendar spreads always cost debit (longer-dated options more expensive than shorter-dated at same strike). Max loss = debit paid. If underlying moves to extreme and stays there through back-month expiration, you lose the full debit. However, defined risk is major advantage over naked short positions (unlimited loss risk).

- **Strike Selection Determines Risk-Return Profile and Directional Bias**: (a) ITM calendars: cheapest cost ($3.65 for $5 wide), lowest max profit, less precision required on strike placement; (b) ATM calendars: moderate cost, max profit at strike, purely theta-dependent; (c) OTM calendars: cheapest spread cost but requires directional move to profit, higher risk/reward ratio. Can skew strikes asymmetrically for directional confidence.

- **Pre-Earnings Calendars Exploit IV Skew Anomaly**: Short 30 DTE options expiring days after earnings, long options expiring 1-3 weeks later. IV in short options increases pre-earnings (skew), but theta acceleration post-earnings dominates, crushing short option value despite IV spike. Long options benefit from IV rise without being subject to post-earnings collapse. Empirically most profitable strategy on mega-cap tech (GOOG, AMZN, TSLA, NFLX).

- **Assignment Risk Manageable but Requires Hedge Awareness**: If short call assigned, you're short shares but have long call protecting you (fully hedged, offset position). If short put assigned, you're long shares but have long put protecting you. Assignment itself not loss-generating unless triggers margin call. Dollar-for-dollar offsetting on exercises (long put protects against share downside, short call offseted by long call).

- **Adjustment Strategy Critical for Mid-Trade Moves**: If stock moves 2-3% away from strike in week 1-2, adjustment needed. Approach: "move the tent" by adding calendar at new strike in direction of move (doubles position, maintains hedging). Alternative: close losing portion, keep winning portion as directional position. Pre-define exit thresholds (15-20% loss) to prevent over-holding into further deterioration.

- **OTM Directional Calendars Blend Theta + Directional Exposure**: Bullish bias: sell OTM call, buy further OTM call. Requires stock to rally but not excessively (profit capped at upper strike). Better risk-reward than pure ATM when directional conviction exists. Combines theta benefit (short-term decay) with directional optionality (stock needs to move right way).

### Key Questions
- **Is Your Market View Aligned with Strike Selection?** ATM = neutral (need stock flat). OTM = directional (need stock to move right way but not too far). ITM = bullish/bearish but cheap entry. Misalignment = fighting the trade structure. Match thesis to calendar variant.
- **What's Your Adjustment Plan if Stock Moves 3% Immediately?** If undefined, losses compound quickly. Options: (1) predetermined loss exit (15-20%), (2) add calendar at new strike, (3) close portion and keep directional. Execute discipline before emotion in loss period.
- **Is IV Skew Favorable (High Front, Low Back)?** Compare IV rank 30 DTE vs 60 DTE. Favorable skew: front month >70th percentile (sell expensive), back month <30th percentile (buy cheap). Unfavorable: opposite. Skew shapes actual debit cost; front-heavy skew reduces entry cost.

### Major Patterns & Themes
- **Theta Concentration in Final Weeks**: Profit doesn't build linearly with calendar passage. Acceleration into expiration (squared time decay function). Holding through final 2-3 weeks captures majority of theta. But final week also highest gamma/vega risk if stock near short strike.

- **Vega Regime Changes Trade Dynamics**: Early in trade: vega helps (own longer vega). Late in trade: vega hurts if IV drops (long vega exposure now material while profit already capped). IV increase in back month expiration week can extend profitability window.

- **Strike Precision Penalty vs Vertical Spreads**: Verticals have wide profit zones (full width up to spread width). Calendars require stock near single strike for optimal profit. Increases execution difficulty relative to directional spreads.

- **Mean-Reversion Dependence**: Works best when underlying mean-reverts to strike after post-earnings moves or other volatility events. Fails when new fundamental realization shifts price to new level (doesn't mean-revert). Regime-dependent strategy.

- **Pre-Earnings Window Anomaly**: 5-10 days pre-earnings: IV skew widens (short-term IV spikes, longer-term stable or declining). This skew benefits calendar structure maximally. Post-earnings: IV crush (short options collapse faster). This pattern repeats quarterly, making pre-earnings calendar a systematic opportunity.

- **Complexity Scales with Strikes and Time**: Single calendar ATM = simple entry/exit. Double calendar (2 strikes) = moderate complexity. Ratio calendars or calendars with rolling components = high management burden. Success proportional to active management discipline.

### File List

raw/docs/07-calendar-spreads.md
raw/predictingAlpha/calendar-spread-strategy.md
raw/quantocracy/docs/calendar-anomalies-much-ado-about-nothing.md
raw/quantocracy/docs/combining-calendar-strategies-into-the-trading-portfolio.md
raw/quantocracy/docs/cultural-calendars-and-the-gold-drift-are-holidays-moving-gld-etf.md
raw/quantocracy/docs/do-calendar-anomalies-still-work-evidence-and-strategies.md
raw/quantocracy/docs/the-calendar-effects-in-volatility-risk-premium.md
raw/quantocracy/docs/the-calendar-ensemble-building-an-event-driven-alpha-overlay.md
raw/steadyoptions/calendar-spread.md
raw/steadyoptions/diagonal-spread-options-strategy-the-ultimate-guide-r796.md
raw/steadyoptions/how-we-lost-60-on-spx-calendar-r142.md
raw/steadyoptions/portfolio-protection-utilizing-calendar-spreads-r409.md
raw/steadyoptions/ratio-calendar-spreads-r576.md
raw/steadyoptions/spx-calendar-spreads-historical-pl-levels-r270.md
raw/steadyoptions/using-bullish-calendar-spreads-to-profit-on-msft-stock-r584.md
raw/steadyoptions/using-otm-directional-calendar-spreads-r346.md
raw/steadyoptions/why-we-sell-our-calendars-before-earnings-r149.md
raw/steadyoptions/wide-flat-spx-diagonal-spread-r720.md
raw/tastytrade/long-call-calendar-spread.md
raw/tastytrade/long-call-diagonal-spread.md
raw/tastytrade/long-put-calendar-spread.md
raw/tastytrade/long-put-diagonal-spread.md
