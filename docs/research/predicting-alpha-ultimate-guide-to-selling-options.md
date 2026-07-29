## About this document

This is a full extraction of *The Ultimate Guide to Selling Options* by Predicting Alpha — all
nine modules, all 56 course articles, plus three further articles reachable from inside them.
It exists so you can read the whole course offline in one place and ask questions against it.

Every article gets its own section with its source URL. Within a section the material is
organised by what it actually contains: definitions, formulas, numbers and thresholds, worked
examples, tables, practical rules, and the author's own opinions where he states them plainly.

### How it was built, and why that matters

Ten agents read the course in parallel. The first pass ran each page through a web-fetching tool
that summarises before handing the text over. That produced sections that were fluent, plausible,
and in places wrong — padded to length with generic options knowledge that read exactly like
Predicting Alpha's own claims. One file invented a strike ladder for a calendar-spread example.
Two supplied `252` and `15.9` as annualisation constants the course never states.

So the whole corpus was re-downloaded as raw text — 59 articles, 103,078 words — and every
section rewritten from that text instead. Then every number in every section was checked
mechanically against the full corpus: a figure that appears nowhere in any Predicting Alpha
article was deleted rather than replaced.

What survives is deliberately shorter than the source. Each section runs 60–83% of the length of
the articles it covers. **An extract longer than its source is an extract with something added.**

Two things follow from this that you should know while reading:

- **Where the course does not say something, this document says so.** Those absences are marked,
  not filled in. They are information — several of them are more useful than the material around
  them.
- **Derived arithmetic is shown, not hidden.** Where a figure was computed rather than quoted,
  the calculation appears inline so you can check it.

### What the course does not cover

Verified absences, each confirmed by searching the source text directly:

- **The IV Rank article never defines IV Rank.** Despite the URL, it gives no formula, no lookback
  window and no threshold. It argues *against* the metric: "Typical metrics such as IV rank and
  percentile won't work, since they rely on the historical data."
- **The Kelly article never prints the Kelly formula.** It calls Kelly "a mathematical formula used
  by professional gamblers and traders alike" and then discusses bankroll management qualitatively.
  No `f*`, no fractional-Kelly multiplier, no position-size cap.
- **The early-assignment article covers no dividends, no ex-dividend dates, no pin risk, no
  American vs European distinction and no settlement mechanics.** It covers exercise, assignment,
  the 100-share multiplier, why early exercise forfeits extrinsic value, and what to do if you
  lack the shares — then stops. No automatic exercise, no exercise-by-exception, and no dollar or
  percentage trigger for assignment risk. The article contains no percentage figures at all. The
  dividend-driven early exercise case — the one that actually bites in practice — is absent.
- **Neither option-chain article covers volume, open interest, or any contract-symbol notation.**
  Between the two of them the only greek column defined is delta; gamma, theta, vega, rho and last
  price go unmentioned, as do root and ticker conventions.
- **No payoff formulas for the iron butterfly, the iron condor or the back spread.** The most
  formula-shaped structures in the course are described entirely in prose. Vertical spreads get
  cost, max profit and max loss but never a breakeven.
- **No annualisation convention is stated anywhere.** A course teaching volatility never pins
  whether it means 252 days or 365.
- **Sharpe and maximum drawdown are not published** for the live earnings strategy, even in the
  trade log spreadsheet that supplies every other statistic.
- **Neither tradeable strategy has a profit target, a stop loss, or a defensive roll ladder.**
  That is the author's design rather than a gap in extraction, and it is stated as such.

### A note on how quantitative this course actually is

The 59 articles contain 181 distinct numeric values in total across 103,078 words. The course is
substantially more conceptual than its framing suggests. Where you were expecting a threshold and
find a paragraph of reasoning instead, that is the source, faithfully rendered.

### Contradictions preserved, not smoothed

Where the course disagrees with itself, both readings are kept with attribution:

- **Iron butterfly wing placement** is given as 3× the straddle price in the body of one article
  and 1–2× in that same article's key-takeaways box; the dedicated wings article resolves it as
  1× for moderate conviction and 2× for high, with the author's personal floor being 2× minimum.
- **Straddles vs strangles for earnings**: one article argues straddles are correct; the live
  trader profiled in the case study evolved to prefer strangles, which are 63.50% of his trades
  against 29.00% straddles. He then cuts back the other way himself — "If you can't handle
  crossing the spread to get out when you see danger coming, only sell straddles. The deeper out
  you go, the faster losses multiply."
- **Iron condor long strikes** are given as at least 1× the strangle price beyond the short
  strikes in the key-takeaways box, and at least 1× the distance from at-the-money to the short
  strike in the body. Those are different rules.
- **Earnings exit window**: the quick answer says 5–10 minutes after the open; the author's own
  described practice says between 5 and 20 minutes.
- **Trade count**: the case-study title and part one say 1,381 trades, the body says 1,380, the
  spreadsheet says 1,380, and the conclusion says "over 1,300". All four are reported where they
  appear rather than reconciled to one figure.


## Source index

All 59 articles, in course order. Every one was downloaded in full as text.

| Module | Article | Source |
|---|---|---|
| M1 | How to Think Like a Professional Option Trader: The Secrets of the 1% | [link](https://www.predictingalpha.com/blogs/how-to-think-like-a-professional-trader) |
| M1 | The Truth About Trading Psychology: The Real Reason You're Not Profitable | [link](https://www.predictingalpha.com/blogs/traders-mindset) |
| M1 | How Professional Option Sellers Think About Trading: The Mentality You Need To Maximize Your Returns | [link](https://www.predictingalpha.com/blogs/option-trading-psychology) |
| M1 | Is Selling Options Profitable? The Answer is Yes and Here is Why | [link](https://www.predictingalpha.com/blogs/is-selling-options-profitable) |
| M1 | Who Trades Options: The 4 Groups That Are On The Other Side Of Your Trade | [link](https://www.predictingalpha.com/blogs/who-trades-options) |
| M2 | What is an Option Contract? 6 Characteristics That Every Option Has | [link](https://www.predictingalpha.com/blogs/what-is-an-option-contract) |
| M2 | How to Read an Option Chain: Identifying Option Information When Placing A Trade | [link](https://www.predictingalpha.com/blogs/reading-an-option-chain) |
| M2 | What Are Underlying Shares? Option Selling Basics | [link](https://www.predictingalpha.com/blogs/what-are-underlying-shares) |
| M2 | Options Expiration Date: The Importance of Days to Expiration in Options Trading | [link](https://www.predictingalpha.com/blogs/options-expiration-date) |
| M2 | Call Option Explained: A Simple Guide For New Option Traders | [link](https://www.predictingalpha.com/blogs/call-option-explained) |
| M2 | Put Option Explained: A Simple Guide For New Option Traders | [link](https://www.predictingalpha.com/blogs/put-option-explained) |
| M2 | How to Read an Options Chain: Key Terms You Need to Know | [link](https://www.predictingalpha.com/blogs/how-to-read-an-options-chain) |
| M2 | Worried About Early Assignment in Option Selling? It's Not As Scary As You Think | [link](https://www.predictingalpha.com/blogs/early-assignment-options) |
| M2 | Mastering Days to Expiration (Option DTE) in Options Trading (sub-link) | [link](https://www.predictingalpha.com/blogs/option-dte) |
| M3 | What is Volatility In Options and Why Is It Important For Option Sellers? | [link](https://www.predictingalpha.com/blogs/what-is-implied-volatility-in-options) |
| M3 | Implied Volatility Explained: The Lens Of Option Trading | [link](https://www.predictingalpha.com/blogs/implied-volatility-explained) |
| M3 | The 3 Types Of Volatility That Impact Option Prices: Market, Event and Non-Event Volatility | [link](https://www.predictingalpha.com/blogs/calculating-implied-volatility) |
| M3 | Understanding Implied Volatility vs. Realized Volatility in Options Trading | [link](https://www.predictingalpha.com/blogs/implied-vs-realized-volatility) |
| M3 | Statistics For Option Selling: Essential Concepts You Need To Know | [link](https://www.predictingalpha.com/blogs/option-trading-statistics) |
| M3 | Volatility Mean Reversion and Clustering: Option Selling Characteristics | [link](https://www.predictingalpha.com/blogs/volatility-mean-reversion) |
| M3 | Volatility Characteristics That Explain How Option Prices Change: The Must Know Features of Volatility | [link](https://www.predictingalpha.com/blogs/option-iv-explained) |
| M3 | Understanding Spot Vol Correlation: How Share Price and Implied Volatility Move Together | [link](https://www.predictingalpha.com/blogs/spot-vol-correlation) |
| M3 | Understanding Autocorrelation: A Key Characteristic for Predicting Future Option Prices | [link](https://www.predictingalpha.com/blogs/option-price-prediction) |
| M3 | Implied Volatility Explained: How to Think About Options Like a Professional | [link](https://www.predictingalpha.com/blogs/what-is-implied-volatility) |
| M3 | Understanding Variance Risk Premium: The Reason Option Sellers Make Money | [link](https://www.predictingalpha.com/blogs/variance-risk-premium) |
| M4 | Black Scholes Model Explained: The Foundation of Option Pricing | [link](https://www.predictingalpha.com/blogs/black-scholes-model-explained) |
| M4 | Understanding Option Greeks: The Key to Professional Option Selling | [link](https://www.predictingalpha.com/blogs/understanding-greeks-options) |
| M4 | What Does Delta Mean In Options? Controlling Direction When Selling Options | [link](https://www.predictingalpha.com/blogs/what-does-delta-mean-in-options) |
| M4 | What is Gamma in Options Selling: Understanding the Rate of Change in Delta | [link](https://www.predictingalpha.com/blogs/what-is-gamma-options) |
| M4 | What is Theta In Option Selling: The Cost of Holding an Option Over Time | [link](https://www.predictingalpha.com/blogs/what-is-theta-options) |
| M4 | What is Vega in Options? Understanding Sensitivity to Changes in Implied Volatility | [link](https://www.predictingalpha.com/blogs/what-is-vega-options) |
| M4 | Mastering Delta Hedging: A Comprehensive Guide for Option Sellers | [link](https://www.predictingalpha.com/blogs/delta-hedging) |
| M5 | Structures Used In Option Selling Strategies: Long and Short Straddles | [link](https://www.predictingalpha.com/blogs/option-selling-strategies) |
| M5 | What is a Short Straddle? A Comprehensive Guide for Option Sellers | [link](https://www.predictingalpha.com/blogs/what-is-a-short-straddle) |
| M5 | Straddle VS Strangles: Which is Better For Option Sellers? | [link](https://www.predictingalpha.com/blogs/straddle-vs-strangle-options) |
| M5 | What is an Iron Butterfly and How Do You Trade Them: A Comprehensive Guide for Option Sellers | [link](https://www.predictingalpha.com/blogs/what-is-an-iron-butterfly) |
| M5 | How to Trade Iron Condors - Ultimate Guide For Option Sellers | [link](https://www.predictingalpha.com/blogs/how-to-trade-iron-condors) |
| M5 | Where to Place Option Wings When Selling Iron Butterflys and Iron Condors | [link](https://www.predictingalpha.com/blogs/option-wings) |
| M5 | How to Trade Vertical Spreads - An Option Trade For Betting on Direction While Leveraging Volatility Skew | [link](https://www.predictingalpha.com/blogs/vertical-spread-options) |
| M5 | Mastering Back Ratio Spreads: A Comprehensive Guide for Option Sellers | [link](https://www.predictingalpha.com/blogs/back-ratio-spread) |
| M6 | Expected Value Trading: The Mentality of a Profitable Trader | [link](https://www.predictingalpha.com/blogs/expected-value-trading) |
| M6 | The Importance of Trading Research: Finding Tradable Information | [link](https://www.predictingalpha.com/blogs/trading-research) |
| M7 | Introduction to Options Skew: A Game Changer for Option Sellers | [link](https://www.predictingalpha.com/blogs/options-skew) |
| M7 | How To Read Option Volatility Skew to Understand Future Expected Moves | [link](https://www.predictingalpha.com/blogs/volatility-skew) |
| M7 | How The Term Structure Impacts Option Selling Strategies: A Comprehensive Guide For Option Sellers | [link](https://www.predictingalpha.com/blogs/term-structure-options) |
| M7 | Understanding Volatility as Synthetic Time: Advanced Option Selling Lesson | [link](https://www.predictingalpha.com/blogs/implied-volatility-over-time) |
| M8 | Mastering Option Selling Strategy Development: Creating A Profitable System | [link](https://www.predictingalpha.com/blogs/option-selling-strategy) |
| M8 | How to Run A Calendar Spread Strategy: A Guide for Option Sellers Looking To Trade Calendars Like a Professional | [link](https://www.predictingalpha.com/blogs/calendar-spread-strategy) |
| M8 | How to Sell Options Profitably When IV Rank is Low | [link](https://www.predictingalpha.com/blogs/iv-rank) |
| M8 | Two Ways to Price Option Premiums: A Masterclass In Option Selling Strategy | [link](https://www.predictingalpha.com/blogs/option-trading-masterclass) |
| M8 | How To Trade Changes In Implied Volatility and Profit Off Vega: Option Volatility Trading | [link](https://www.predictingalpha.com/blogs/option-volatility-trading) |
| M8 | Kelly Criterion Trading: How To Manage Your Bankroll To Maximize Your Returns | [link](https://www.predictingalpha.com/blogs/kelly-criterion-trading) |
| M8 | Introduction to Relative Value Trading: A Profitable Way To Sell Options | [link](https://www.predictingalpha.com/blogs/relative-value-trading) |
| M8 | How to Make Money Selling Options: The Truth About What It Takes To Run A Profitable Portfolio (sub-link) | [link](https://www.predictingalpha.com/blogs/how-to-make-money-selling-options) |
| M8 | How to Trade Illiquid Options: The Keys to Success For Selling Options With a Wide Bid Ask Spread (sub-link) | [link](https://www.predictingalpha.com/blogs/illiquid-options) |
| M9 | The Ultimate Option Selling Strategy: A Boring But Profitable Method That Actually Makes Money | [link](https://www.predictingalpha.com/blogs/profitable-option-selling-strategy) |
| M9 | How to Roll Weekly Options Like a Pro | [link](https://www.predictingalpha.com/blogs/how-to-roll-weekly-options-like-a-pro) |
| M9 | The Ultimate Earnings Options Strategy – Selling Options Like a Professional | [link](https://www.predictingalpha.com/blogs/earnings-options-strategy) |
| M9 | $224,914.81 Profit Across 1,381 Trades: A Live Breakdown of Earnings Strategy Returns | [link](https://www.predictingalpha.com/blogs/earnings-strategy-profit) |


## Module 1 — Why This Course Matters


*From the full article text; every number and example appears in the source. Module split is my call. All seven by Sean Ryan.*

---

### How to Think Like a Professional Option Trader: The Secrets of the 1%
*Source: https://www.predictingalpha.com/blogs/how-to-think-like-a-professional-trader*
*Sean Ryan · August 28, 2024*

#### Core thesis

Opens with two figures stated as fact: **90% of traders lose money**, and in options **99% of traders end up in the red**. Ryan lists the usual explanations — poor mentality, greed, emotional trading, lack of market experience — and rejects them as the cause. These "poor mentality" things are **symptoms of poor trading, not the cause**.

What the 1% do differently is see the market **through the lens of value**. They play a game of **"buy cheap, sell expensive,"** grounded in understanding how options work, what drives their value, why someone is willing to buy them, and **under what circumstances someone is willing to overpay for them.**

#### Key Takeaways (as stated)

1. **Mindset and value perception** — always asking whether an option is fairly priced, leveraging deep understanding of the trading products.
2. **Price sensitivity and fair value** — constantly evaluating whether market price reflects true value; identifying and exploiting the discrepancy is crucial to their strategy.
3. **Expected value (EV)** — the difference between market price and fair value **is** the expected value. Consistently finding mispriced options ensures a positive average expected return, "a cornerstone of long-term profitability."

#### Understanding how options work

Unlike stocks, which simply go up or down in value, options involve multiple factors influencing price. Ryan frames that complexity as the source of the opportunity — daunting, but lucrative for those who truly understand the product. Profitable traders know what causes options to change in value, how to structure trades to express different views, and how to manage their trades.

#### The importance of price sensitivity

Named **the most crucial trait**. When they see an option priced at **$5**, they don't just consider its potential payoff — they ask *"Is this option really worth $5?"*

In option terms, the skill is identifying the difference between the **premium collected** from selling options and the **amount paid out due to realized volatility**.

#### Worked example — simple arbitrage

Imagine finding a **$5 bill** someone will sell you for **$3** — an obvious profit opportunity. Similarly, an option **worth $3** that the market values at **$5** can be sold now and bought back later for $3, securing **$2** profit. Ryan flags the catch immediately: the concept is simple, and **the challenge lies in accurately determining the true value of an option.**

#### Evaluating options for fair value

Most traders think of options in terms of the **leverage** they provide — predict a stock will go up, buy a call to maximise gains. The question they overlook: *"Is the price I'm paying for this option justified?"* Ryan's verdict on that omission is blunt — this lack of price consideration is a fundamental reason most traders **"basically donate their money to other market participants."**

He repeats the $5/$3/$2 example, then defines a strategy:

> Finding a repeatable process that finds options trading for $5 that are really worth $3 is what we call a strategy.

#### The role of expected value

The difference between market price and fair value **is the EV**. Find mispriced options consistently and the average expected return will be positive. His contrast: most traders focus on managing emotions and maintaining a strong mentality; the pros concentrate on evaluating the true value of their trades and **capitalizing on the market's price insensitivity.**

#### Conclusion

Understanding the complexities of options and being sensitive to their pricing are **the two key traits** that distinguish the profitable 1%.

#### Practical rules

- Ask what the option is worth before asking what it could pay.
- As a seller, model premium collected against expected payout from realized volatility.
- Judge a "strategy" by whether the mispricing-finding process is repeatable.

#### Body hyperlinks

`expected-value-trading` · `option-trading-psychology`
*(Footer-chrome links excluded throughout.)*

---

### The Truth About Trading Psychology: The Real Reason You're Not Profitable
*Source: https://www.predictingalpha.com/blogs/traders-mindset*
*Sean Ryan · August 25, 2024*

#### Core thesis

Ryan warns the article will frustrate some readers and says he comes "from a place of love." His claim, unhedged: **most trading psychology is nonsense.** The reason most people lose money is that they have **a poor strategy.**

> You can't "risk manage" your way to success at a roulette table. You can't "control" your way to winning in a -EV trading strategy.

#### Key Takeaways (as stated)

1. **Strategy over psychology** — success hinges more on a strategy with positive expected value than on perfecting psychology alone. Even with disciplined psychology, a flawed strategy won't make money. **If you are losing money, question your strategy before your psychology.**
2. **Understanding market biases** — recognise self-attribution, hindsight bias and loss aversion; mitigate them through systematic trading and data-driven decision-making; and **recognise these biases in others and how that can create trading opportunities for you.**

#### The Trader's Rat Race

When you're taught to trade on **subjective patterns and interpretations**, it feels natural to blame yourself when things go wrong. That produces the **"Traders rat race"** — constantly working on yourself, always feeling like you're about to turn the corner, with mentors preaching *"Master yourself, and you'll master the markets."* Ryan's question back: **but what if the strategy you're using has no edge?**

His diagnostic: if you've worked on your psychology for any meaningful length of time, you're probably already subconsciously aware it isn't giving you an edge. You may see improvements like **not yoloing your life savings** — but putting really dumb things aside, it has probably done nothing for your trade execution, expected returns, or actual dollars in your bank account.

> No amount of psychological fine-tuning can turn a losing strategy into a winning one.

Without positive expected value you stay in the rat maze, **"endlessly chasing the illusion of success without ever truly achieving it."** He concedes it's harsh — "it sucks" — but says it has to be embraced.

#### The blackjack analogy

Who wins in the long run — **a drunk dealer at a blackjack table, or a sober guru monk?**

The dealer, because the game has positive expected value for the house. **As long as he can stand up and deal the cards, he will come out ahead in the long run.**

Ryan then sets the ordering: if the overall expected value of your trades is positive, you have a strategy that can lead to long-term profitability — **and at this point it's worth focusing on psychology.**

#### The basketball analogy

Psychology plays a role **only when you have the skills to win.** A professional basketball player in their **third year of the NBA** could be helped toward becoming one of the best by a world-class sports psychologist. Give that same psychologist to **"your buddy Joe from down the block"** and Joe does not make the NBA — **especially if Joe can't even do a layup.**

> Psychology's value shines when you already have the skill. But it doesn't replace the skill.

Once you have a solid, statistically sound strategy, psychology helps you stick to the plan, manage risk, and avoid fear and greed.

#### The psychology of the market — three biases

To truly leverage psychology, focus on **the psychology of others in the market.** The market is made of people, people have biases, and if you understand how they think you understand how they act.

**1. Self-attribution bias — the trap of overconfidence.** Attributing successes to our own actions and failures to external factors. **"Rampant in the technical analysis community"**: see a breakout, make a profitable trade, credit your skill; the trade fails, blame market manipulation or bad luck. Prevents learning from mistakes and recognising when luck was a factor.

> Not every profitable trade is a good trade, and not every good trade is profitable.

Overconfident traders take excessive risks believing their skills are superior to what they actually are, which **usually leads to a blow up.**

**2. Hindsight bias — the illusion of predictability.** Believing past events were predictable and therefore that we can predict future events with similar accuracy. Looking back it's easy to see how events led to the current market situation; predicting forward isn't as straightforward **because there are countless possible outcomes.** *"History doesn't repeat itself, but it often rhymes"* — learn from the past, don't rely on it to predict precisely.

**3. Loss aversion — the bias that bankrupts traders.** Holding losing positions longer than we should, hoping they'll rebound. **A major cause of trader bankruptcy.**

*Worked example:* you buy a stock at **$10**, expecting it to rise to **$13**. If it drops to **$7**, instead of cutting your losses you might buy more, thinking you're getting a bargain. Eventually the stock could drop to **$1** and you're left holding the bag. Ryan notes he has experienced this himself, multiple times.

Two harms, the second greater than we think:
- you lose money on the trade;
- **by choosing to stay in this position, you are forgoing being in another position that may have been profitable.**

#### The exit test

> If I did not have a trade on right now, would I enter into the position that I have?

**If the answer is no, get out.** His reasoning: every single moment that passes, you are saying *"I still think this is a good trade."* So if you no longer think that, get out.

#### Conclusion

Just have a winning strategy before you start blaming yourself. **Life is a lot better when you have a tangible thing to work on** — more fun, more profitable, and it actually gets you somewhere.

#### Practical rules

- Audit strategy EV before spending effort on mindset work.
- Separate "good trade" from "profitable trade" when reviewing.
- Run the "would I enter this now?" test on open positions.

#### Body hyperlinks

`expected-value-trading` · `option-trading-psychology` · `who-trades-options`

---

### How Professional Option Sellers Think About Trading: The Mentality You Need To Maximize Your Returns
*Source: https://www.predictingalpha.com/blogs/option-trading-psychology*
*Sean Ryan · September 24, 2024*

#### Core thesis

Everyone who has built a career out of trading thinks about it through a similar lens, and you can adopt that lens without reinventing the wheel. Ryan warns it is **a pretty significant shift in mindset** compared to what most traders are used to.

#### Key Takeaways (as stated)

- **Professional trader mindset** — a shift toward running core strategies that **"pay the bills"**, combined with **aggressive capitalization** on high-potential opportunities.
- **Look for the Arb** — *"Where is the arbitrage?"* should be **the first question you ask whenever something strange or unique happens.** Arbitrage exploits price differences across markets; quasi-arbitrage focuses on high-probability trades with minimal risk.

#### The mentor's answer

Built on one quoted response Ryan got when he asked a mentor what the "secret" to making money was. In sequence: most of the time play tight to the vest, watch your risks closely, make enough to cover the overhead and live well. When you find an edge, an arbitrage, or a quasi-arbitrage — **pile it on, hit it with everything you've got, gear it up, borrow money to play it** — and keep doing that until the arbitrage goes away, **which it always does.** Then spend your time looking for the next one.

#### Playing tight to the vest

Running simple strategies that make money, managing risks meticulously, making consistent gains to cover overhead. Cautious, methodical, disciplined:

| Component | As stated |
|---|---|
| **Consistent strategies** | Strategies you have tested and proven effective — in options, **VRP strategies** |
| **Risk management** | Know your **expected drawdowns**; manage your bankroll effectively |
| **Low time requirement** | Should not require all of your time; should be pretty straightforward |
| **Overhead management** | Gains sufficient to cover operational costs **and** provide a steady income |

These are typically strategies **pretty well known by the world**. **Not really alpha — a clean beta** you can rely on to generate returns **for providing some form of value back into the market**, "the type of stuff you can read in research." In options this probably means monetizing the **variance risk premium.**

#### Seizing high-potential opportunities

- **Leverage** — use it to maximise returns when there is a serious inefficiency. **They don't last long, so you need to hit it while it's there.**
- **Scaling up** — increase position size significantly on a high-confidence trade.
- **Spend your time looking for these** — after the opportunity dissipates, diligently seek the next one. The base strategies are deliberately straightforward **so that while they run we can focus on finding the high-potential opportunities.**

These are **true alpha** — "the type of stuff you are not going to read online," and if you uncover something like it yourself, you probably should not be posting it online.

#### Definitions

**Arbitrage** — exploiting price discrepancies in different markets or instruments for **risk-free profits.** Example: a stock priced differently on two exchanges — buy on the cheaper, sell on the more expensive, pocket the difference.

**Quasi-arbitrage** — trades with a **high probability of profit with minimal risk, but not completely risk-free.** They **arise more frequently than pure arbitrage** and can be highly lucrative for traders who can identify and exploit them.

#### Conclusion

Professionals do simple things that get them paid while spending the rest of their time looking for unique scenarios that push returns to the next level. The biggest separator: **when they find these situations, they really step on the gas** — they leverage up and hit it big. Ryan notes this is **much more intense than you would think, it's difficult to do**, but having witnessed it he knows it's the way.

> You either eat well or you sleep well.

When you have one of these big trades you're spending all your time researching it to make sure you haven't missed anything. **You have a lot on the line and your behavior should reflect that.** Once the opportunity is gone — **it always goes away** — go back to playing tight to the vest and start looking for the next one.

#### Practical rules

- Make "where is the arbitrage?" the reflex question when something strange happens.
- Keep the base book straightforward so research capacity stays free.
- Know expected drawdown before deploying the base strategy.
- Scale back down when the edge goes.

#### Body hyperlinks

Body anchor text points to a strategy-development article, bankroll management, the variance risk premium, and providing value back into the market. **None resolved into the page's captured link set** — only footer chrome was captured. Targets unconfirmed.

---

### Is Selling Options Profitable? The Answer is Yes and Here is Why
*Source: https://www.predictingalpha.com/blogs/is-selling-options-profitable*
*Sean Ryan · September 26, 2024*

#### Core thesis

The question Ryan says he gets all the time: why options and not forex, stocks, or futures? The simplest answer is that options is **where we found a way to make money** — but he says that doesn't help the reader, so he breaks down why options proved profitable.

#### Key Takeaways (as stated)

1. **Strategic market selection** — options offers a more manageable and profitable environment than highly liquid, competitive markets like Forex. More opportunities to gain an edge over less informed traders, **and enough demand for options that we can come in on the supply side and command a lucrative price for providing liquidity.**
2. **Specificity and creativity** — options allow expressing **very specific and unique views on volatility**, enabling sophisticated strategies not possible in other markets.
3. **A clear reason we get paid** — the **variance risk premium** provides a solid foundation for profitability. It is **well researched and should continue to persist.**

#### Choosing the right market is more important than being the best

When you're playing a game involving chance, betting, or gambling, **picking the right table to play at is crucial.** A professional poker player walks into a poker room and sees two tables: one filled with **professional players**, the other with **a bunch of drunk dudes having fun on a bachelor party trip.** A seat is available at both.

They **should not play against other professionals who are equally skilled or better.** They should want a table where they have a direct advantage.

> The most important thing in poker, if you ask a professional, is to pick the right table.

Applied to trading: be in a market where you have an edge. This is **why they avoid Forex** — the most liquid market in the world, **$7 trillion in daily transactions**, attracting the best analysts, the biggest funds, "essentially the smartest people in the world." Competing there is **incredibly challenging.**

#### The advantages of the options market

Options is a **smaller, more manageable market** — much smaller than forex or the stock market. That smaller space means encountering **more retail traders who might be gambling with their money**, and being able to **directly engage with professionals looking to hedge their books.** The opportunity is to play against participants who are **less informed or not directly looking to make money off the options themselves.**

#### Finding an edge

Once you've picked a good table and know who you're playing against, you can find an edge. An edge is **what gives you a positive expected value**. With positive EV, all that's left is to **manage your risk properly and take every trade that fits your criteria.**

#### The power of options

Options let you express **very specific views on the market.** If you can express **the size of move, the timeframe for the move, the direction for the move**, you can structure an option trade that **expresses it perfectly and gives you the best payoff for being correct.**

#### A clear reason we get paid

Knowing why you get paid and treating trading like a business is **"probably the principle that we believe in the most."** And it is **the number one reason we picked options**: thanks to the variance risk premium there is a very clear reason we can get paid for selling options. It is **the foundation of every single strategy that we run.**

#### Conclusion

They trade options because they can find an edge, know who they're playing against, and express specific market views. Ryan states they have been **trading options for five years, consistently beating the market, and raising capital.**

#### Practical rules

- Pick the market before trying to be the best in it.
- Take **every** trade that fits your criteria once they're set.
- Don't trade a structure until you can state why you are paid.

#### Body hyperlinks

`expected-value-trading` · `who-trades-options` · `variance-risk-premium` · `option-selling-strategies`

---

### Who Trades Options: The 4 Groups That Are On The Other Side Of Your Trade
*Source: https://www.predictingalpha.com/blogs/who-trades-options*
*Sean Ryan · August 22, 2024*

#### Core thesis

Retail traders have a habit of viewing the market as a **faceless, monolithic entity** they are up against — like a gambler facing off against a casino. Ryan's correction: trading is **less like roulette, and more like poker**, where you are directly competing against individual players.

His definition: a market is **a place where buyers and sellers come together to engage in transactions. A place where supply meets demand.** Once you accept you are engaging with other real people, the most important question presents itself: **Who is on the other side of our trade?**

#### Key Takeaways (as stated)

1. **Ask yourself — who is buying these options?** Understand the four participant types (Funds, Retail Traders, Sophisticated Traders, Market Makers); each has distinct motivations and behaviours.
2. **Understand their behaviour.** If you understand *why* someone is on the other side, you can determine whether they are someone you should be trading with. On average, **retail traders and hedge funds are less price sensitive, since their motivation is either leverage or protection, not pricing the option.**

#### Is the market really like a casino?

Ryan agrees with the *sentiment* behind "trade as if you are the casino" — trade with an edge, positive expected value — but the analogy itself is **not quite accurate.** When people picture a casino they picture slot machines and roulette tables: **games where it's you versus the house.** In trading it's not the same entity on the other side of every trade. **"The house" is not on the other side of our trades.** It's another person — which is why trading is a lot more like poker.

So one of the most important things in trading is **picking who you play with.** If you made a living playing poker, would you rather play **a table of drunk businessmen looking to pass a few hours while waiting for their flight**, or a table of professionals? The businessmen — you have an inherent edge, you're there to make money, and **they are there to have fun. If they lose money, it's ok because they were there for the gamble.**

> Who are we playing with and WHY are they engaging with us?

**We may never know exactly who that person is** — but a good idea lets us understand their intentions, and intentions tell us whether this is someone we can expect to generate returns trading with.

#### 1. Funds

Mutual funds, hedge funds, and pension funds. Their primary motivation is to **manage risk and hedge their equity portfolios against big losses.** They are **usually buying put options.** Not the most price-sensitive bunch, because the motivation is **insurance and not to save a couple pennies** — they **know they are paying a premium and are willing to do it.**

*Characteristics:*
- **Portfolio management** — large portfolios of stocks; options used primarily to hedge them.
- **Risk management** — more focused on avoiding losses than making large profits. If a single stock represents more than **X%** of their portfolio they might be **required to hedge it**, especially around significant events like **earnings reports.** *(The source literally writes "X%" — no number given.)*
- **Obligatory hedging** — funds often **buy puts or sell calls** to hedge, **regardless of the cost.**

*Trading against funds:* Ryan likes it. They are price insensitive and often **obligated** to buy options to hedge. The opportunity is to identify **the areas where they are paying the largest risk premiums** and be the one providing that "insurance."

#### 2. Retail Traders

"We have all been them, we may still be them." The individuals you see on reddit; the cousin who can't stop telling you he's all in on **AMC** at Thanksgiving dinner. A large portion of the market but **often the least sophisticated participants in options trading.**

*Characteristics:*
- **Attracted by leverage** — drawn by perceived leverage, hoping to amplify gains, **often overlooking the complexities and risks.**
- **Price insensitivity** — focused on potential profits rather than the cost of options, **willing to overpay, especially in volatile markets.**
- **High failure rate** — most lose money, especially in options.

*Trading against retail traders:* **"often your best counterparties."** Their lack of price sensitivity and **tendency to buy high and sell low** are "exactly the persona we want to be trading with." Ryan acknowledges **"it might sound harsh, but it's the reality of trading"**: we want to trade with people who understand less about options and volatility, and with people looking for a gamble.

#### 3. Sophisticated Traders

**"A scary group to trade against."** Professionals who understand the intricacies of options — proprietary trading firms, hedge funds, independents. **These traders have an edge, and it's unlikely that we know more than them.**

*Characteristics:*
- **Deep understanding of options** — they know how options work and what drives their prices.
- **Efficiency seekers** — they excel at finding mispriced options and exploiting the inefficiency.
- **Advanced models and information** — better models, better data, **and sometimes even insider information.**

*Trading against them:* **avoid whenever possible.** It's hard to know if they're there, and the tell is:

> Usually a sign that they might be there is when things appear to be mispriced, but you can't quite understand why.

#### 4. Market Makers

**"The 'Darth Vaders' of trading"** — often misunderstood and sometimes seen as the enemy by retail traders, which **is just not true. In fact, we need them.** Their role is to provide liquidity and keep bid-ask spreads tight, which **creates the market for us to trade.** They **get paid for holding inventory and effectively managing the market** around different companies. **A lot of the time this is actually who we are trading with.**

*Characteristics:*
- **Liquidity providers** — always ready to buy or sell options.
- **Spread management** — they profit from the **spread between bid and ask**, not directional bets.
- **Neutral positions** — typically **delta-neutral**, hedging away directional risks.

*Trading with market makers:* while they facilitate trades, they are **often not the ultimate counterparty** in a significant trade — they **bridge the gap between buyers and sellers.** A lot of the time the person who **actually fills our order is a market maker**, but they then turn around and try to **offload the position to the true "demand"**, which is one of the other groups.

#### Conclusion

Every time you place a trade, ask: **who is on the other side and why are they trading with me?** This helps you:

- **Understand motivations** — we want to be trading people who are price insensitive: **people looking for insurance, and people looking for gambles.**
- **Increase conviction** — a retail trader on the other side means more confidence; a likely sophisticated counterparty means more caution **"(or just not do it)."**
- **Refine strategies** — build entire strategies around engaging particular groups. A big part of understanding your trade is **deciphering who is driving demand.**

> A good strategy is like a good business, they know who their customers are.

#### Practical rules

- Ask who and why on every trade.
- Find where funds pay the largest risk premiums and supply the insurance.
- Stand down when you can see mispricing but cannot explain it.

#### Body hyperlinks

`expected-value-trading` · `earnings-options-strategy` · `trading-research`

---

## Module 2 — Option Basics

> Written from the local full-text corpus in `pa-text/`. Every figure below appears in those files. The two breakevens that are arithmetic rather than printed values are flagged where they appear. Thin sources get short sections and say so.

---

### What is an Option Contract? 6 Characteristics That Every Option Has
*Source: https://www.predictingalpha.com/blogs/what-is-an-option-contract*

Sean Ryan · September 22, 2024

#### Core thesis

Six characteristics define every option, call or put. Learn them and you can conceptualize what an option is and visualize how it works. Ryan pitches this as a guide for traders completely new to options, while insisting that doesn't make it unimportant — the first step on the road to options mastery is understanding what an option is.

#### The three stated key takeaways

1. **Options are contracts** traded in a separate market from stocks, letting traders exchange rights rather than the underlying asset itself.
2. **Options grant rights with obligations.** The buyer gains the right to buy or sell at a specified strike; the seller has the obligation to fulfil the order if the option is exercised. This defines the roles and risks of both parties.
3. **Options have defined terms** — strike price, expiration date, premium. These terms are crucial to understanding the value and timing of option trades.

#### The six characteristics

**1 — Options are contracts.** Buying or selling an option is not trading the stock; it is trading a contract, in a market separate from the stock market. In the stock market you exchange shares of a company. In the options market a contract is *created* when you buy or sell.

**2 — Options involve two parties.** Options are contracts between two people. Ryan calls this crucial because many people think of options as themselves versus the market:

> Trading is not like blackjack, where players play against the house. Instead, it is more like poker, where players compete against each other. Each trade you place has another person on the other side of that transaction.

**3 — Options grant rights.** The contract gives the right to either buy or sell a stock. Buying an option purchases that right; the seller carries the obligation to fulfil the order if you exercise.

**4 — Options have a strike price.** The given price at which the stock can be bought or sold. His example: a contract giving the right to buy or sell Apple at **$250**. The strike is the agreed-upon price if the option is exercised.

**5 — Options have an expiration date.** These contracts don't last forever. The expiration date is the deadline by which the option must be exercised. The tenors he names: **30 days, two days, or two years**. Example: the right to buy Apple at $250 within the next **30 days**.

**6 — Options have a premium.** The price of the option. His reason for why it exists is blunt — the reason someone would sell you an option is that they are getting paid to do it. Extending the example: the right to buy Apple at $250 in the next 30 days, and the market might price this at **$15**. The premium is what the buyer pays the seller for the rights the contract grants.

#### The running worked example

One Apple option carries four of the six characteristics as numbers: **$250 strike · 30 days to expiration · $15 premium**. The other two — that it is a contract, and that two parties are involved — are structural.

#### Practical rules

- On study method: don't sit and memorize the six. They become second nature quickly. But you do need to understand them.
- Read this, then part two, where the same characteristics get translated into what you actually see in your brokerage.

#### Notable quotes

> Options are contracts between two parties, granting rights to buy or sell at a specific price within a given timeframe, and they come with a premium.

> Every option you trade will have these characteristics. You don't need to sit here and memorize them. They will become second nature to you in no time. But you need to understand them.

#### Charts

One image sits between the "two parties" and "grant rights" sections. The body never describes its contents, so nothing can be said about what it depicts.

#### Note on length

Short and definitional — one recurring example, no formula, no table, no chain layout.

---

### How to Read an Option Chain: Identifying Option Information When Placing A Trade
*Source: https://www.predictingalpha.com/blogs/reading-an-option-chain*

Sean Ryan · September 22, 2024

#### Core thesis

Part two of the six-characteristics article, purely a translation exercise. The conceptual definition is "really pretty," but it has to become what you actually see in the market before you can place trades. Ryan's stated goal: show exactly where each characteristic appears on the chain in your brokerage, and how they combine into the navigation you use to structure trades.

The definition carried forward: an option is a contract between two people giving the purchaser the right to buy or sell a stock at a given price within a specified timeframe, and the purchaser pays a premium for that right.

#### The mapping — the article's central artefact

His own summary list:

| # | Characteristic | How it appears in the market |
|---|---|---|
| 1 | Contracts | Represented by the option chain |
| 2 | Two people | Depicted by the bid and ask prices |
| 3 | Right to buy or sell | Defined by puts and calls |
| 4 | Given price | Shown as the strike price |
| 5 | Timeframe | Indicated by the expiration date |
| 6 | Premium | Listed as the option price |

#### Field by field

**The option chain (the contract).** To see what's tradeable, open the chain for your ticker. It displays as a list, split into calls and puts, containing every contract you can engage in. When you want to buy or sell, you come here and select the one you want.

**Bid and ask (the two parties).** The bid is what someone is willing to pay to buy the contract; the ask is what someone is willing to sell it for. There is usually a difference between them due to supply and demand, with the bid slightly lower than the ask. Two ways to transact, both stated:

- Trade **immediately** at the bid or the ask.
- Set your **own price in between** the two and see if anyone will trade with you there.

**Calls and puts (the right to buy or sell).** A put gives the right to sell; a call gives the right to buy. The chain splits into two sides. His layout claim comes with an explicit hedge worth keeping: usually the **left side is calls, the right side is puts** — every broker he has used follows this, though he allows yours may differ if it isn't **IBKR or Thinkorswim**.

**Strike price (the given price).** The chain lists various strikes — his examples are **$95, $100, $105**. Each contract is tied to a specific strike. Concretely: buy a put with a **$100** strike and you have the right to sell the underlying at $100.

He explains *why* strikes sit where they do, which is the most useful layout detail here: strikes are usually listed **in the middle, between the call side and the put side**, because at each strike there are both call and put contracts. Centring them lets you **look across the row** at a given strike and see both.

**Expiration date (the timeframe).** When the contract expires and is no longer valid. The chain displays multiple expirations, each with its own contracts — his examples are a **July 15th** expiration and another for **September 16th**. Contracts only look forward, so you won't see expirations that have passed. To find your trade you filter by expiration.

Then the pattern a sharp reader notices: **monthly expirations typically take place on the third Friday of each month.** All the expirations together form the part of the chain called the **term structure**.

**Option price (the premium).** Simply referred to as the price of the contract. Each has a price varying on factors deferred to later posts. His illustrative prices: an option might be priced at **$10, $12, or $12** (the source repeats $12, apparently a typo for a third value). The price fluctuates over time, and the range in which you can currently attempt to trade is defined by the bid and ask.

#### Fields the article does not cover

Stated precisely, because the brief asks for the full column set. This article covers only chain, bid, ask, calls/puts, strike, expiration and price. There is **no volume, no open interest, no implied-volatility column, no greeks, and no contract-symbol, root or ticker notation** anywhere in it. No chain grid with actual quoted values is printed — the figures above are illustrative, not a reproduced chain.

#### Practical rules

- Read across the strike row, not just down one side. That's the reason strikes are centred.
- You aren't forced to take the bid or ask; you can post a price between them.
- Filter by expiration first, then work the strike ladder.

#### Predicting Alpha's position

The closing argument: we need to thoroughly understand the product we trade if we want to generate returns. The six characteristics let you explain an option in terms anyone — even non-traders — can understand, but putting them into practice means seeing how they present themselves on the chain.

#### Charts

Six images, one per section. The body doesn't narrate their contents beyond the figures quoted above.

---

### What Are Underlying Shares? Option Selling Basics
*Source: https://www.predictingalpha.com/blogs/what-are-underlying-shares*

Sean Ryan · September 23, 2024

#### Core thesis

Options are a derivative product, based on another asset. To understand an option you need to grasp what it's based on: the underlying stock. Trade options on Apple and the underlying is Apple's share price.

Ryan is openly dismissive of how much time this deserves — it's an easy concept, so read once and move on to juicier topics that will actually push you toward being a more profitable option seller.

#### The three stated key takeaways

1. **Underlying asset definition** — the financial instrument on which an option is based. In an Apple call, Apple's share price is the underlying. It directly impacts the option's value.
2. **P&L relationship** — for stocks it's linear. As the stock price increases, profit increases proportionally, and vice versa. This linear movement forms the basis for the complex behaviour of options.
3. **Impact of volatility** — volatility measures the price fluctuations of the underlying and significantly affects pricing. **High volatility increases the option's price** due to higher expected future movement; **low volatility results in lower prices** due to less expected movement.

#### Definition

**Underlying asset.** The financial instrument on which an option is based. Buy Apple shares for **$200** and you are essentially purchasing a $200 slice of the company. An option is instead a contract giving the right to buy or sell those shares at a specific price within a certain timeframe. That's why it's a derivative — based on something else.

#### The P&L relationship

For a stock like Apple the P&L relationship is linear:

- **Positive price movement:** as Apple's price increases, your profit increases proportionally.
- **Negative price movement:** as Apple's price decreases, your loss increases proportionally.

This direct correlation is fundamental to how stocks behave, and it's positioned as the contrast case for everything options do.

#### Options as derivatives

An option's value derives from the underlying's price. Buying a call is not purchasing physical shares but a contract based on them. The sentence that sets up the whole course:

> The options market revolves around predicting how the underlying stock moves—not just the direction, but also the volatility.

#### Charts

Two images. The first accompanies the linear P&L discussion. The second is described in the text as showing **the payoff for a straddle**, which he calls **the most common structure used by option sellers**. The body doesn't describe either shape further.

#### Notable quote

> Like I said, this was a short and sweet blog (or at least it was meant to be). At this point you should fully understand that options are based on the stocks for the company you are looking at. Yea, that's really it.

#### Note on length

The shortest article in the module. One figure, no formula, no table. Nothing is being withheld — the source genuinely is this brief.

---

### Options Expiration Date: The Importance of Days to Expiration in Options Trading
*Source: https://www.predictingalpha.com/blogs/options-expiration-date*

Sean Ryan · September 25, 2024

#### Core thesis

DTE is a key characteristic of the contract and a key factor affecting pricing and value. His phrase for it is worth keeping: DTE is **the amount of "time" in the "time value" of an option.**

#### The three stated key takeaways

1. **DTE significance** — days remaining until expiry. It significantly impacts pricing and value, reflecting the time available for the underlying to move beyond the strike and begin to accumulate intrinsic value.
2. **Pricing and premiums** — longer expirations typically carry higher premiums due to the extended timeframe for potential price movements. Shorter ones are cheaper in dollar cost but offer less time for the stock to move in your favour.
3. **Impact on strategy** — depending on the DTE you select, you are expressing a different view on the market with a different set of sensitivities that can cause your option to change in value.

#### Definition

**Days to expiration (DTE).** The timeframe during which the contract remains valid. Once the expiration date is reached, the option expires worthless if not exercised. Value is closely tied to DTE because it reflects the time available for the underlying to move favourably.

#### Worked example — Apple call

| Input | Value |
|---|---|
| Current date | June 15th |
| Expiration date | June 30th |
| Days to expiration | **15 days** |
| Strike price | **$200** |
| Apple's current price | **$200** per share |
| Premium paid | **$5** |

For the option to be profitable, Apple needs to exceed **$205** ($200 strike + $5 premium) by the expiration date. Above $205 you profit; below it you lose the premium paid.

#### Why not choose a longer expiration?

Posed directly: why not buy a call expiring **June 30th, 2022** instead of **June 30th, 2021**? The answer is about expressing a view cleanly, not about cost.

When we place a trade we want it to express our view in the cleanest way possible. If the view is about how much Apple's price changes over the next 15 days, trade the expiration that best reflects that — because we want to get paid when we're right and lose money when we're wrong. Structuring the trade to reflect your opinion is how you make sure you get paid for being correct.

The added, slightly more technical benefit: a trade that best reflects your opinion gets **better feedback from the market on your ideas**. The warning that follows is the sharpest line in the article:

> Remember: not all good trades make money, and not all bad trades lose money.

Even though a mismatched structure costs less today, if you aren't seeing the "pain" of your bad trades because of some other reason, you're setting yourself up for long-term failure — you aren't getting the feedback you need to improve your approach.

#### DTE and what causes your option to change in value

| DTE | Sensitivity | In plain terms |
|---|---|---|
| **Shorter** expiration | more **theta** and **gamma** | how much the stock moves *right now* |
| **Longer** dated expiration | more **vega** | how much the market thinks the stock will move *in the future* |

#### Pricing and DTE

Premium increases with days to expiration, because more time allows more potential price fluctuation. As DTE decreases, price typically decreases.

| Tenor | Premium | Reason given |
|---|---|---|
| Short-term (**1 day**) | Lower | Limited time for significant stock movement |
| Medium-term (**15 days**) | Moderate | Balancing likelihood of movement within a reasonable timeframe |
| Long-term (**1 year**) | Higher | Greater potential for significant price changes |

**The caveat that's easy to miss:** even though prices are cheaper *in dollar terms* for shorter-dated options, this does **not** mean they imply less movement. That becomes apparent once you learn term structure — how implied volatility changes at different expirations.

#### Impact on trading strategy

1. **Risk management.** Longer expirations carry higher premiums, increasing initial investment risk. Shorter ones are cheaper but offer less time for the stock to move your way.
2. **Position sensitivities.** Are you trading implied versus realized volatility, or a change in the *level* of implied volatility? The answer greatly influences the DTE you select.

#### Practical rules

- Match the expiration to the horizon of your actual view, not to what feels safe.
- Don't read a cheaper short-dated option as the market implying less movement.
- Decide which volatility question you're trading first; the DTE follows.

#### Charts

Two images — one after the example inputs, one after the premium ladder. Neither is described in the body.

---

### Call Option Explained: A Simple Guide For New Option Traders
*Source: https://www.predictingalpha.com/blogs/call-option-explained*

Sean Ryan · September 1, 2024

#### Core thesis

As option sellers we deal with calls pretty much all the time, so you need to know how they work and the view they express on the market.

#### Definition

A call option is a contract that can be bought or sold which gives the buyer the right to purchase a stock at a specific price within a certain timeframe. The takeaways add the standard qualifier: the right, **but not the obligation**, to buy at the strike within a set timeframe.

#### Worked example 1 — the main Apple call

| Input | Value |
|---|---|
| Desired right | buy Apple at **$200** per share |
| Current market price | **$190** per share |
| Contract bought | 30-day expiry, **$200** strike, for **$5** |

If in 30 days Apple rises to **$260**, you have the right to buy at $200 and sell at the market price of $260. The call is now worth **$60 per contract**, and you profit **$55 per contract**.

The profit rule in his own words: profit equals the difference between the strike price plus the premium paid, and the current price. (Breakeven here works out to $205, but that number is not from article text for this example — the article prints it only for the second example below.)

#### Worked example 2 — the "right direction, still lost money" case

A different strike, and the one that teaches breakeven:

| Step | Value |
|---|---|
| You have the right to buy Apple at | **$300** (strike) |
| Apple's price rises to | **$302** |
| Buy at $300, sell at $302 | **$2** profit |
| But you paid for the option | **$5** |
| **Net result** | **$3 loss** ($2 profit − $5 premium) |
| **Break-even point** | **$305** ($300 strike + $5 premium) |

You only start profiting once Apple exceeds $305. Directionally correct, still a loser — that's why it's included.

#### The payoff graph

Y-axis P&L, x-axis stock price. What the text says about the picture:

- Maximum loss is limited to the premium paid, visualized by the **blue P&L line going flat as you move further left**.
- P&L **rapidly increases as the stock price increases**, representing the **"convexity"** of the call payoff — which most option buyers find very attractive, and which he names as a big reason there is so much demand for them.

If Apple falls you lose the $5 premium; if it rises you only start making money after covering the premium.

#### Why sell call options

Premium is determined by supply and demand. The price you see is typically based on the likelihood the stock rises to the option's breakeven. Why PA is attracted to selling: **the implied future price baked into option prices is a bit higher on average than what is most likely to happen.** The reason is the risk profile of the option.

His argument for why this must be so, the best passage in the article:

> Think about it. If buying or selling a call option was 0 expected value, who would ever sell them? The seller is the one holding the convexity risk, meaning that on any given trade they can only make a fixed amount and are risking losing exponentially more. Everyone would choose to be a buyer of options if there was no difference. Which is why there is.

To incentivize sellers there is an **embedded premium for the seller** making the seller profit slightly on average. Over a large sample, being a net seller of calls yields a profit. This is the phenomenon PA calls the **variance risk premium**.

#### Predicting Alpha's specific claims

- Option trading **firms are built on the idea of selling options**, not the other way around.
- **Retail traders who see longevity** in their careers — and actually make money — are typically **on the sell side**.
- Sellers of calls believe the stock won't rise significantly *and* that the options are overpriced.

#### Conclusion as stated

A call gives the right, not the obligation, to buy at a specific price within a certain period — unlimited upside with limited downside. But the stock must rise enough to cover the premium for the option to be profitable.

---

### Put Option Explained: A Simple Guide For New Option Traders
*Source: https://www.predictingalpha.com/blogs/put-option-explained*

Sean Ryan · September 1, 2024

#### Definition

A put option is a contract between two people providing the right to sell a stock at a predetermined price (strike price) within a specified timeframe, for a fixed cost to the buyer. The takeaways add: the right **but not the obligation**, letting you profit from declining prices while limiting losses to the premium paid.

#### Worked example 1 — the main Apple put

| Input | Value |
|---|---|
| Desired right | sell Apple at **$190** per share |
| Current market price | **$200** per share |
| Contract bought | 30-day expiry, **$190** strike, for **$5** |

If in 30 days Apple falls to **$150**, you have the right to sell at $190 and can buy in the market at $150. The put is now worth **$40 per contract**, and you profit **$35 per contract**. (Breakeven works out to $185, but that figure is not from article text — it prints a breakeven only for the second example.)

#### Worked example 2 — the breakeven case

| Step | Value |
|---|---|
| You have the right to sell Apple at | **$300** (strike) |
| Apple's price drops to | **$295** |
| Sell at $300 | make **$5** |
| But you paid for the option | **$5** |
| **Net profit** | **zero** |
| **Break-even point** | **$295** ($300 strike − $5 premium) |

You start profiting once Apple drops **below** $295. If Apple doesn't move or goes up, you lose the $5 premium.

#### The payoff graph

Y-axis P&L, x-axis stock price. From the text:

- Max loss is limited to the premium paid, visualized by the **blue P&L line going flat as you move further right** — the mirror of the call, which flattens to the left.
- P&L **rapidly increases as the stock price decreases**, representing the **"convexity"** of the put payoff, which most option buyers find very attractive and which drives much of the demand.

#### Why sell put options

Identical logic to the call article, mirrored. Premium is set by supply and demand, and typically reflects the likelihood the stock falls to the put's breakeven. PA is attracted to selling because **the implied future price baked into put prices is a bit lower on average than what is most likely to happen.**

The same expected-value argument appears, with a parenthetical making the asymmetry explicit — the seller holds the convexity risk, can only make a fixed amount **(the premium)**, and risks losing exponentially more. The embedded premium exists to incentivize sellers; over a large sample, being a net seller of puts yields a profit; this is the variance risk premium. Firms are built on selling; retail traders with longevity are typically on the sell side.

#### Who buys put options

Unique to this article, and its most valuable section.

**Puts are the most commonly traded contract type.** The reason is historical: when options were first introduced, their primary purpose was to act as **insurance for long equity portfolios**. Since the risk with equities is to the downside, the put was more commonly traded because it's how funds protect their portfolios.

**Group 1 — funds.** Puts are seen as more attractive for hedging than approaches such as diversification, because a put is **the only form of hedging that doesn't fail in a market downturn**. Diversification becomes less effective in a crash because **the correlation between different equities increases towards 1** when the market is going down. This is why puts are so popular and usually traded by funds seeking portfolio protection.

**Group 2 — retail traders.** They trade puts to express a leveraged directional view that a stock will decrease rapidly over a given timeframe. The attraction is **limited risk with potential for exponential gain**. His specific behavioural claim: retail traders tend to be **very price insensitive**, and make up a lot of the demand where there is **a lot of news around a ticker** and where **there has recently been a large move**.

#### Conclusion as stated

Puts are typically purchased by funds hedging long equity portfolios and by retail traders expressing a directional view with leverage. Option sellers need to understand puts because they need to be aware of the risk exposures they take on when they sell a contract.

---

### How to Read an Options Chain: Key Terms You Need to Know
*Source: https://www.predictingalpha.com/blogs/how-to-read-an-options-chain*

Sean Ryan · September 24, 2024

#### Core thesis

Written for the moment after you get brokerage approvals, open the chain, and have absolutely no idea what you're looking at. You need to navigate the chain to trade the right things and get the exposures that express your view correctly.

#### The chain, column by column, exactly as given

An option chain provides a snapshot of available options for a stock: real-time quotes for different contracts, and the tangible version of the 6 characteristics of an option. The **default** fields:

| Field | What the article says it is |
|---|---|
| **Current stock price** | If the market is open, the current price. **If closed, it's the price at close.** |
| **Strike prices** | Various strike prices for call and put options. |
| **Bid and ask prices** | Current **bid (buy)** and **ask (sell)** prices for each strike price. |

Most brokerages also let you **edit the information available on the chain**. The two he names:

| Optional field | Definition as written |
|---|---|
| **Implied volatility** | "Typically based on the mid price between the bid and ask, this is the amount of volatility (annualized) implied by the price of the option contract" |
| **Delta** | "This is one of the option greeks which is often used in determining which strikes you want to trade. Delta tells you about you exposure to what direction the stock moves." |

He closes the list noting there are many more available, but these are the most common ones people add.

**Not in this article:** no volume, no open interest, no gamma, theta, vega or rho, no last price, and **no contract-symbol, root or ticker notation** anywhere. An example chain image is referenced with colour coding, but no grid of quoted values appears in the body — so there is no chain here to reproduce row by row.

#### Moneyness — ITM, ATM, OTM

All examples use **Apple trading at $241**.

| | Call options | Put options |
|---|---|---|
| **In the money (ITM)** | strike **below** the stock price — e.g. **$235, $230, $210** | strike **above** the stock price — e.g. **$245, $250, $260** |
| **At the money (ATM)** | strike very near the current price. With no exact $241 strike, the closest — such as **$240** — is at the money | same |
| **Out of the money (OTM)** | strike **above** the stock price — e.g. **$245, $250, $260** | strike **below** the stock price — e.g. **$235, $230, $210** |

ITM means the strike would have some value already if executed today — that value is intrinsic value. OTM describes contracts with **no intrinsic value** if executed right now, and per the takeaways, are **entirely made up of their "time value."**

The identity he flags explicitly:

> It's important to note that an in-the-money call option is the same as an out-of-the-money put option, and vice versa.

#### Intrinsic value

The real, tangible value of an option if exercised today.

```
Call intrinsic value = whichever is highest: (Stock Price − Strike Price), or 0
Put  intrinsic value = whichever is highest: (Strike Price − Stock Price), or 0
```
- *Stock Price* — the underlying's current price
- *Strike Price* — the contract's exercise price
- The "or 0" floor stops intrinsic value going negative

All four examples, with Apple at **$100**:

| Contract | Calculation | Intrinsic value |
|---|---|---|
| **$80** strike call | $100 − $80 | **$20** |
| **$110** strike call | out of the money | **$0** |
| **$120** strike put | $120 − $100 | **$20** |
| **$90** strike put | out of the money | **$0** |

#### Extrinsic value

The additional value beyond intrinsic value. It includes **time value and any other external factors** affecting the option's price.

```
Extrinsic Value = Option Price − Intrinsic Value
```

Worked example: if the **$80** strike call (with **$20** intrinsic value) is trading at **$25**, the extrinsic value is **$5**.

#### The claim that matters most for a seller

> When we are trading options, we are looking at the world through the lens of volatility... Volatility is related to the time value of an option, so when we are running our option selling portfolio we are primarily trading the extrinsic value of options.

That is why understanding these two values helps you determine whether an option is fairly priced and assess its potential profitability.

#### Expirations

Opening the chain shows a range of dates — some a couple of days out, others a year away. Each ticker has **multiple expirations ranging from daily to yearly and everything in between**, each with its own chain of strikes and prices. How to *pick* one is deferred to other blogs; the point here is that you shouldn't be surprised when you see the function.

#### Practical rules

- Add implied volatility and delta to your chain; they're the two most commonly added fields.
- Classify every strike as ITM/ATM/OTM first, then split its price into intrinsic and extrinsic.
- As a seller, know the extrinsic portion is what you're actually trading.

#### Charts

Two images. One is described as an example of what a basic option chain may look like, **with colour coding** supporting the moneyness section that follows. The second heads the intrinsic/extrinsic section. Neither is narrated further.

---

### Worried About Early Assignment in Option Selling? It's Not As Scary As You Think
*Source: https://www.predictingalpha.com/blogs/early-assignment-options*

Sean Ryan · September 11, 2024

#### Core thesis

He opens with the fear as he hears it: "What do I do if I get assigned early!" Exercise and assignment are a real part of the market and will happen, especially as the trade approaches expiration — but it is **not the big bad scary monster that you will see posts on Reddit make it out to be**. There are inherent good things about early assignment that benefit option sellers.

#### Definitions

**Exercising an option.** Converting the contract into actual stock. A call gives the right to buy the underlying at the strike. Example: buy a **$200** call option for Apple and you have the right to buy **100** Apple shares at $200.

**The contract multiplier.** **One option contract equals 100 shares** of the underlying. Exercise one $200 call and you get 100 shares of Apple at $200 each.

**Assignment.** The obligation for the seller if the buyer exercises. Selling makes you **short** the option, meaning you must fulfil the contract if the buyer exercises. Example: sell a $200 Apple call, the buyer exercises, and you must provide **100 shares of Apple at $200 each**.

The asymmetry, stated plainly: exercising is a **choice for the buyer**; assignment is an **obligation for the seller**.

#### Why traders rarely exercise early

An option contract is composed of intrinsic and extrinsic value. Exercising before expiration means **the buyer forgoes all of the extrinsic value that remains on the contract.** Rather than exercising early, it could make more sense to sell the contract to someone else on the open market, so the price received includes **both** intrinsic and extrinsic value. This is why early exercise is pretty rare.

#### The worked example — early assignment as a saving

| Step | Value |
|---|---|
| Sell a **$200** call option for **$5**, Apple trading at **$200** | |
| Apple moves to **$210**, still **10 days** to expiration | |
| The contract is now trading for | **$11** |
| — intrinsic | **$10** |
| — extrinsic (representing the 10 days remaining) | **$1** |
| Your position should be at a loss of | **$6** |
| **If the buyer exercises early:** you provide the shares, losing | **$5**, while keeping the extra **$1** of extrinsic value that remained |

> Since someone exercised the option early, you actually saved a dollar per contract!

The generalisation: early assignment leaves the seller better off by whatever extrinsic value remained when it was exercised.

#### "But Sean, what if I don't have the shares available?"

If you don't have the shares, **you become short 100 shares.** You can **immediately buy back the shares in the market**, effectively neutralizing your position and keeping the premium as profit. You'll have the capacity to do this because of **the margin you posted when you originally sold the option** — that margin covers this risk.

#### The two closing rules

1. **Don't count on early assignments to drive your profits.** Most of the time early assignment happens **extremely close to expiration**, so the extrinsic value remaining will be marginal.
2. **Close out the shares as soon as possible if assigned.** You will be **converted from having an option position to a delta position**, meaning you now make or lose money depending on which direction the stock moves — **not what you signed up for as an option seller**. Set up **assignment alerts in your brokerage** so you aren't surprised if you get assigned early without being made aware.

#### Predicting Alpha's contrarian position

Contrary to popular belief, early assignment can be advantageous for option sellers. His own sizing of the effect is honest rather than overstated: "it's actually a marginally good thing."

#### Rules the article does not give — checked against the full text

The brief asks for dividends, ex-dividend dates, pin risk, American vs European style, cash vs physical settlement, automatic exercise, and any dollar or percentage triggers. **None appear anywhere in the source.** The article contains no percentage figures at all, and its only dollar values are those tabulated above. It assumes an American-style, physically-settled equity option throughout without ever naming those properties. Anyone needing the dividend-driven early-exercise case — in practice the most common real trigger for early assignment on calls — will not find it in this module.

#### Charts

Two images, one after the assignment definition and one after the early-assignment example. Neither is described in the body.

---

### Mastering Days to Expiration (Option DTE) in Options Trading (sub-link)
*Source: https://www.predictingalpha.com/blogs/option-dte*

Sean Ryan · September 26, 2024

#### Core thesis

Where the earlier expiration article explains what DTE *is*, this one teaches how to **pick** the right expiration for an option-selling trade. The DTE choice is a pivotal part of how you express your view on the market. He notes upfront that you need to understand option greeks to get full value from the post.

#### The two stated key takeaways — the module's only DTE thresholds

1. **Near-dated expirations are sensitive to theta and gamma.** Near-dated options — **typically less than 30 DTE** — give a lot of exposure to the difference between implied and realized volatility. Regardless of changes in sentiment, **if realized volatility is less than implied you should be making money as an option seller.**
2. **Far-dated expirations are sensitive to vega.** Farther-dated options — **typically greater than 60 DTE** — give a lot of exposure to changes in implied volatility. Regardless of how much the stock moves on any given day, what drives returns is whether implied volatility increases or decreases.

**Definition.** DTE is the number of days from now until the contract expires; an option with 30 DTE expires in 30 days.

There is **no one-size-fits-all answer** for selecting an expiration. All the expirations visualized together form the **term structure**, which helps pick. The choice depends on your market outlook and the specific circumstances of the trade.

#### Near-dated options for realized volatility exposure

For trades focused on the **IV versus RV spread**, near-dated options — **typically no more than 30 days** — are preferred. This is the most common DTE range for strategies focused on the variance risk premium.

The reasoning, the most substantive claim in the article: **research shows the greatest concentration of variance risk premium is in shorter-dated options and slightly out of the money.** It makes sense through the lens of risk exposures — with a shorter DTE you are more sensitive to big moves, and **big moves are exactly what options are designed to insure against.**

He quotes an industry saying, then explicitly distances himself from it:

> There is a saying that "Vega wounds, but gamma kills", and this saying (while not something that we endorse) really speaks to the reason that the risk premium is most present in shorter dated contracts.

His conclusion: it's where the risk is, and therefore where the risk premium is too.

#### Longer-dated options for implied volatility exposure

For trades focused on changes in IV, longer-dated options — **typically more than 60 DTE** — are preferred. He says these are really only traded in two scenarios at Predicting Alpha.

**Scenario 1 — buying a hedge for the ETF Premium strategy.** The typical hedge is **buying a 90 DTE delta 20 strangle** to protect the **weekly short strangles** being rolled to collect the variance risk premium. Two stated benefits:

- Going out in time **saves transaction costs**, because a single hedge can protect multiple positions.
- On average **the risk premium paid by going further out in time is less than the risk premium collected by selling the shorter-dated expirations.**

**Scenario 2 — the Distressed Volatility strategy.** Flagged as **not systematic and not really taught at Predicting Alpha**, though many members including himself run it.

The setup: when catastrophic events hit individual stocks, or extremely bullish events like a **short squeeze or an IPO**, the term structure becomes extremely unrealistic and the implied volatility of longer-dated contracts becomes extremely inflated for a short period.

The mechanism: the stock starts moving a lot and everyone thinks similar movement will continue for the foreseeable future. People bid up the **90, even 180** day contracts to the point where they imply the insane short-term movement continuing for a very long time.

The trade: **sell the longer-dated options** to **maximize exposure to vega**. The reason to want as much vega exposure as possible relative to theta/gamma is subtle and worth restating carefully — PA actually **agrees** the stock will keep moving in the short term. The bet is that as the market calms, participants will realize the madness won't last forever and **longer-dated volatility will also calm down**.

#### On where strategies come from

The distressed volatility strategy wasn't his own invention. It was first brought to his attention **during the meme stock craziness** by some Predicting Alpha members. Together they developed an approach to monetizing inflated option premiums in a way that reduced exposure to the short-term insanity while still getting in on the action.

#### Predicting Alpha's opinions and the pitch

The article closes with an openly labelled "shameless plug": the community is capped at **1,000 traders** and hadn't hit the cap at time of writing. The framing is a filter rather than a sales pitch — if you aren't ready to give up the excitement of yoloing and hunting for wild ways to make money, you won't enjoy what they're doing:

> Putting it simply, we are focused on boring things that actually make money.

#### Practical rules

| Goal | DTE band | Dominant exposure |
|---|---|---|
| Trade the IV vs RV spread (variance risk premium) | **< 30 DTE**, slightly OTM | theta, gamma |
| Trade a change in the *level* of IV | **> 60 DTE** | vega |
| Hedge a weekly short-strangle book | buy a **90 DTE delta 20 strangle** | vega, plus cost efficiency across positions |
| Fade an inflated term structure after a shock | sell the **90–180** day contracts | maximum vega relative to theta/gamma |

---

## Module 2 — consolidated reference

### Formulas stated in this module

```
Call intrinsic value = whichever is highest: (Stock Price − Strike Price), or 0
Put  intrinsic value = whichever is highest: (Strike Price − Stock Price), or 0
Extrinsic Value      = Option Price − Intrinsic Value

Call break-even      = Strike Price + Premium      (article's example: $300 + $5 = $305)
Put  break-even      = Strike Price − Premium      (article's example: $300 − $5 = $295)

One option contract  = 100 shares of the underlying
```

### Figures by source

| Figure | Article | Meaning |
|---|---|---|
| 6 characteristics | What is an Option Contract | The defining set |
| $250 · 30 days · $15 | What is an Option Contract | Apple strike / tenor / premium |
| 30 days, two days, two years | What is an Option Contract | Stated possible tenors |
| $95, $100, $105 | Reading an Option Chain | Illustrative strike ladder |
| $100 put strike | Reading an Option Chain | Right to sell the underlying at $100 |
| $10, $12, $12 | Reading an Option Chain | Illustrative contract prices (source repeats $12) |
| July 15th, September 16th | Reading an Option Chain | Illustrative expirations |
| Third Friday | Reading an Option Chain | Monthly expiration pattern |
| IBKR, Thinkorswim | Reading an Option Chain | Brokers whose calls-left/puts-right layout he confirms |
| $200 | Underlying Shares | Apple share price — a "$200 slice of the company" |
| June 15 → June 30, 15 DTE | Expiration Date | Worked DTE |
| $200 strike, $200 spot, $5 premium, $205 needed | Expiration Date | Breakeven, stated |
| June 30 2021 vs June 30 2022 | Expiration Date | The longer-expiration comparison |
| 1 day / 15 days / 1 year | Expiration Date | Premium ladder |
| $190 spot, $200 strike, $5, 30 days | Call Option | Main long-call example |
| $260 → worth $60 → profit $55 | Call Option | Upside scenario |
| $300 strike, $302 spot, $2 gain, $3 net loss, $305 breakeven | Call Option | The "right direction, still lost" case |
| $200 spot, $190 strike, $5, 30 days | Put Option | Main long-put example |
| $150 → worth $40 → profit $35 | Put Option | Downside scenario |
| $300 strike, $295 spot, $5 gain, zero net, $295 breakeven | Put Option | Put breakeven case |
| correlation increases towards 1 | Put Option | Why diversification fails in a crash |
| Apple $241; $235/$230/$210 vs $245/$250/$260; ATM $240 | How to Read an Options Chain | Moneyness ladder |
| $100 spot: $80 call → $20, $110 call → $0 | How to Read an Options Chain | Call intrinsic value |
| $100 spot: $120 put → $20, $90 put → $0 | How to Read an Options Chain | Put intrinsic value |
| $80 call trading at $25, $20 intrinsic → $5 extrinsic | How to Read an Options Chain | Extrinsic value |
| 100 shares per contract | Early Assignment | Multiplier |
| $200 call sold for $5, spot $200 → $210, 10 DTE | Early Assignment | Assignment example |
| $11 = $10 intrinsic + $1 extrinsic; $6 loss → $5 loss | Early Assignment | The $1 saving |
| < 30 DTE | Option DTE (sub-link) | Near-dated: theta/gamma, IV vs RV |
| > 60 DTE | Option DTE (sub-link) | Far-dated: vega |
| 90 DTE delta 20 strangle | Option DTE (sub-link) | ETF Premium strategy hedge |
| 90, 180 day contracts | Option DTE (sub-link) | Distressed Volatility targets |
| 1,000 traders | Option DTE (sub-link) | Stated community cap |

### The module's throughline

An option is a contract with six terms → those terms appear at specific places on the chain → the contract derives from an underlying whose volatility, not just direction, drives its price → DTE decides which sensitivities you actually carry → calls and puts are mirror payoffs sharing one feature, convexity → convexity must be overpriced or nobody would sell it, which is the variance risk premium → the buyers paying it are identifiable, chiefly hedging funds and price-insensitive retail → the seller's remaining jobs are picking the DTE band that matches the volatility question being traded, and closing out any assigned shares before they become an unwanted delta position.

## Module 3 — Mastering Volatility (Part A: Foundations)

> **Written from the full local article text.** Every figure, quote and claim below is confirmed
> against the source files. Sub-links skipped per instruction.
>
> **What these six articles do not contain.** No volatility formula. No standard deviation of
> returns, no log returns, no annualization convention (neither trading-day nor calendar-day), no
> daily-move rule of thumb, no expected-move formula, no realized-volatility estimator, no lookback
> window, no mean-reversion half-life or reversion speed, and no distribution theory — normal,
> lognormal, fat tails, kurtosis, skewness and the sigma bands are all absent. The only arithmetic in
> the unit is the mean of three numbers and the mean of a die roll, in Article 5. This is a
> conceptual module; the quantitative machinery is not in it.

---

### What is Volatility In Options and Why Is It Important For Option Sellers?
*Source: https://www.predictingalpha.com/blogs/what-is-implied-volatility-in-options*

Sean Ryan · September 26, 2024

#### Core thesis

Options were invented as a way to trade volatility, and option prices are based on volatility.
Running a successful option-selling portfolio therefore requires a complete and thorough
understanding of what volatility is and how it relates to an option's value. The article is
deliberately introductory — a small step toward truly understanding how options work — and Ryan warns
that going deeper into Predicting Alpha means going deeper into volatility.

#### Definitions

**Volatility** — the size of the moves in a stock's price over a given period. It measures how much
the price fluctuates, regardless of the direction of the movement. The more a stock is expected to
move, the higher the price of its options.

The non-directional property is stated four ways in succession: you can have volatile moves to the
upside; volatile moves to the downside; periods of volatility that produce **no change in the stock
price** (it goes up a lot, then down a lot); and **low volatility that still produces substantial
price change**, if the stock trends slowly in one direction over time. The example for that last case
is the S&P 500 — over a long period it has gone up a lot but doesn't move much day to day, it just
slowly drifts up.

**Option price, reframed** — a reflection of how much the market thinks a stock will move in the
future. Which makes option trading, in Ryan's framing, betting on whether a stock will move more or
less than the market implies.

#### Formulas

**No formula given.** Volatility is defined in words only — no calculation method, no annualization,
no expected-move math.

#### Numbers, thresholds & rules of thumb

No thresholds. Every number is in the two return sequences and the two option prices below.

An inconsistency in the source worth knowing: the section is titled **"Comparing Coca-Cola and
Tesla"** and the Key Takeaways use **Tesla** as the volatile example, but the body of that section
compares Coca-Cola against **Gamestop**. Tesla never reappears.

#### Worked examples with the real figures

**Coca-Cola — a stable stock.** Strong fundamentals, a long history, widespread analysis, small
day-to-day changes. Four days: **−1%, +1%, +1%, −1%**. The pattern shows steady growth with minor
fluctuations, indicating low volatility.

**Gamestop — a volatile stock.** Known for significant daily movements; can experience substantial
gains or losses within a short period. Four days: **+9%, +7%, −10%, +15%**. Much larger fluctuations
than a company like Coca-Cola — a period of high volatility.

**The option comparison.** Both companies set at **$100 per share**, stated explicitly as making it
an apples-to-apples comparison, for a **three-day call option**:

| Underlying | Volatility | Call price |
|---|---|---|
| Coca-Cola | Low | **$3** |
| Gamestop | High | **$10** |

The stated reason Gamestop's is more expensive: the greater the volatility, the higher the risk and
potential reward, which makes options on more volatile stocks pricier. Both figures are illustrative
— nothing is computed.

#### Tables/charts

Two price-path charts, one per stock, introduced as what each "might look like." Coca-Cola's shows
steady growth with minor fluctuations; Gamestop's shows much larger swings. The images carry no
captions or alt text in the source capture, so nothing further is recoverable.

#### Practical rules

1. Judge volatility by the size of the daily moves, never by where the price ended up.
2. Expect to pay more for options on volatile names — the premium reflects risk and reward, not a
   mispricing.
3. Read every option price as the market's forecast of future movement, then decide whether the stock
   will move more or less than that.
4. Combine the volatility frame with expected value and ask which strategies exploit the difference
   between implied and realized volatility, and why those strategies should have positive expected
   value. Ryan presents this as the question the framing unlocks.

#### Predicting Alpha's specific/contrarian opinions

- **Overlooking volatility is a common mistake among new traders.** Some say they prefer trading based
  on direction rather than volatility — but if you're trading options you're inherently trading
  volatility, because the option's price is determined by the expected volatility of the underlying.
  You are trading it whether you realize it or not.
- **This is how all professionals think, and the stated reason is money** — they think this way
  because they want to make money.
- **Execution is trivial; the preparation is everything.** The closing image is that all we do is
  click buttons on a screen, and everything known before the click determines who gets paid.

#### Notable direct quotes

> "Volatility is the size of moves. Not the direction. We must never forget this."

> "Volatility is the lens that profitable option traders view the world through. It is what
> determines how options are priced."

---

### Implied Volatility Explained: The Lens Of Option Trading
*Source: https://www.predictingalpha.com/blogs/implied-volatility-explained*

Sean Ryan · September 16, 2024

#### Core thesis

Implied volatility is the concept that, once understood, really starts to move the needle on option
selling skill. It matters because options are volatility products — they exist so traders can express
a view on how much a stock will move in future, rather than only what direction it will move, which
stock alone already allows. Professional option traders think and speak about options in terms of
implied volatility, not price.

#### Definitions

**Implied volatility (IV)** — a reflection of the market's expectations of how much a stock will move
in the future. Professionals always prefer to convert option prices to IV so they can assess whether
an option is fairly priced, expensive, or cheap, which allows comparison across different stocks and
timeframes on a consistent basis.

**Absolute comparison** — within the same stock. **Relative comparison** — across different stocks,
including ones trading at drastically different share prices.

**Long volatility** — you believe the stock will experience a *higher* level of volatility than
implied by the market. **Short volatility** — a *lower* level than implied. Ryan flags a very
important distinction: whether you are long or short volatility does **not** mean you think the stock
will go up or down. The grammar mirrors stock — long it or short it — but the object is volatility.

**Variance risk premium** — given as the reason option strategies are run in the first place: on
average, implied volatility overstates realized volatility.

#### Formulas

**No formula written out.** The Black-Scholes model is named and its inputs listed; the equation
never appears.

**Inputs, as the body lists them (six):** current stock price · strike price · time to expiration ·
dividends · risk-free interest rate · implied volatility.

**The inversion:** given these inputs the model calculates the option price; conversely, if we know
the option price and the other variables, we can determine the implied volatility. That is the entire
mechanism described — no solving method is given.

> A discrepancy inside the article: the Key Takeaways list only **five** inputs (current stock price,
> strike, time to expiration, dividends, risk-free rate) as what the model uses to determine IV, while
> the body lists six, including IV itself.

#### Numbers, thresholds & rules of thumb

- Raising IV from **30% to 40%** moves the sample option from **$1.56 to $2.60**.
- **Apple: IV currently 38%, historically ranging between 20% and 40%.** No universal cheap/expensive
  threshold is offered — the judgment is made against the name's own history.
- The stated reasoning for calling 38% expensive: given the characteristics of volatility, we know it
  should return to its mean over time.

#### Worked examples with the real figures

**1 — Price alone is not enough.** A stock trading at **$100**, looking at the **105 strike call**. It
could be priced at **$2, $3, or $8** — but none of those figures tells you whether it's a good trade.
Restated with the 105 call at **$3.70**: without context we can't determine if that's a good price.
What matters is what the price says about what the market thinks will happen, since that is what
determines whether the option gains or loses value as time moves forward.

**2 — IV moves the price.** Stock at **$100**, **105 strike call**, **30 days to expiration**:

| IV | Model price |
|---|---|
| 30% | **$1.56** |
| 40% | **$2.60** |

**3 — Historical IV.** Apple's IV is **38%** against a historical range of **20% to 40%**, so it reads
as relatively high; mean reversion suggests Apple's options are expensive right now.

**4 — Absolute comparison.** The Apple **120 call at 50% IV** against the **125 call at 45% IV** —
directly comparable because both are in the same unit.

**5 — Relative comparison, the strongest case for IV.**

| | Apple | Micro-cap company |
|---|---|---|
| Share price | $200 | $1 |
| Strike | 200 | 1 |
| Option price | $2.40 | $0.50 |
| **IV** | **30%** | **250%** |

Without considering IV these prices seem incomparable — and Ryan adds that in the worst case some
traders will argue the micro-cap call is *cheaper* than Apple's because it costs fewer dollars. IV
settles it immediately. (The source introduces the company as a micro cap, then refers to it as the
biotech company a sentence later.)

**6 — A real ticker, and the trap.** **BCLI**, a biotech: the **17.50 strike call** might have an IV
of **262%**, the **12.50 call 185%**. At first glance the discrepancy might seem like an arbitrage
opportunity. On further analysis, the higher IV is due to the increased uncertainty and risk
associated with the company's future. Dispersion across strikes is information, not free money.

#### Tables/charts

One image in the body, after the short-volatility section, with no caption or alt text in the
capture. No data charts.

#### Practical rules

1. **Don't calculate IV yourself.** Your brokerage and the Predicting Alpha terminal do it for you.
   What is really important is knowing how to interpret it and how to determine whether it is fair
   value.
2. There are **two core ways** to determine whether an option is cheap or expensive; this article
   covers only the first, **historical analysis**, to keep things simple at this stage.
3. Judge current IV against the name's own historical range, and expect reversion toward the mean.
4. Prefer IV numbers when constructing strategies, because the analysis then applies across many
   tickers — and since many strategies require a degree of diversification, a language that applies
   to all tickers is attractive.
5. Read an extreme IV as a statement about uncertainty; check the underlying story before calling it
   a mispricing.
6. Keep your volatility view separate from any directional view.

#### Predicting Alpha's specific/contrarian opinions

- **Options are volatility products** — the governing premise, stated as fact and repeated as the
  closing instruction.
- **Short volatility is the view most professional option traders express**, usually by selling
  options; the entire reason they run strategies in the option space is that the variance risk
  premium exists.
- **Short volatility is the insurance business.** Most of the time you receive the option premium:
  many small winners, then once in a while — say the market crashes — a big loser. Similar to selling
  insurance, where you usually collect the premium and occasionally someone crashes their car and you
  pay out. It works because the variance risk premium makes the premiums collected on most days
  outweigh the losses from an outsized move.
- **Distrust educators who don't teach IV.** Ryan's filter is explicit, and he extends it into a claim
  about the education market itself: the topic is complicated, most people trading options just want a
  little gamble, and education simplified to appeal to that base skips these concepts. His instruction
  is to avoid that content.

#### Notable direct quotes

> "Professional option traders think and speak about options in terms of implied volatility, not
> price."

> "If you encounter someone who doesn't understand that options are volatility products and doesn't
> teach you about this, then you can be pretty certain that they do not know what they are talking
> about."

---

### The 3 Types Of Volatility That Impact Option Prices: Market, Event and Non-Event Volatility
*Source: https://www.predictingalpha.com/blogs/calculating-implied-volatility*

Sean Ryan · September 24, 2024

> Despite the URL slug, this article contains no implied-volatility calculation. Its subject is the
> **Three Circles of Volatility model**, which Predicting Alpha states it created, and which is
> recommended as the follow-up to the introductory volatility article.

#### Core thesis

Every single ticker experiences volatility, and a profitable option seller must understand the
different ways it can present itself. The three circles are offered as a conceptual model for the
different sources of volatility when analyzing a stock — and, critically, the third circle is
something that can be isolated and traded on its own.

#### Definitions — the three circles

**1. Market Volatility.** Pertains to the entire market: when the market becomes volatile, all
individual stocks within it are affected. Its observable signature is **correlation**. When conditions
are normal, on any given day some stocks go up and others go down, and correlation between stocks is
pretty low on average. If the market crashes, most stocks drop significantly — they become more
correlated, almost completely correlated. Market volatility overhangs all stocks and its impact is
universal across sectors and companies. Driven by macroeconomic factors: **interest rates, inflation,
geopolitical events, and overall investor sentiment.** Significant news can cause widespread panic or
euphoria, leading to large-scale buying or selling. The mnemonic given is "The rising tide lifts all
ships," restated in option speak as the rising market volatility impacting all stocks.

**2. Non-Event Volatility.** What you find *when you zoom in on a specific company*. The regular
day-to-day movements of a stock, driven by the fundamentals of the company and its typical trading
patterns. Different stocks exhibit different levels of it — Coca-Cola might show smaller daily price
changes than Gamestop, which would typically have larger daily swings. It is inherent to the stock
itself regardless of broader market conditions, and it is the movement you see when market conditions
are stable. Influenced by company performance, industry trends, and investor perception: a stable
company with consistent earnings and low debt might have lower volatility, while a tech startup with
high growth potential but uncertain earnings could exhibit higher volatility. Recognizing a stock's
typical non-event volatility helps set realistic expectations for its price movements.

**3. Event Volatility.** The third and most specific circle. Driven by specific events related to a
company — product releases, shareholder meetings, earnings reports. Major events can cause substantial
price changes in a short period, significantly impacting option prices. It is often anticipated, which
leads to heightened trading activity as investors position themselves ahead of announcements, and that
hype can lead to inflated option premiums around events. Ryan states it is **categorically different**
from non-event volatility and is something we can isolate and trade if we choose to.

The relationship is a zoom rather than a ranking: the whole market, then in to one company's baseline
behaviour, then in again to that company's specific events.

#### Formulas

**No formula given.** No method for decomposing an implied volatility into the three components, no
weights, no correlation figures.

#### Numbers, thresholds & rules of thumb

**The one hard number in the article, and the most actionable in the unit:**

- **Event volatility can account for 30% to 70% of a stock's annual movement**, making it a
  significant factor to consider.

The Tesla scenario supplies a **10% expected range over 10 days**. Nothing else is quantified.

#### Worked examples with the real figures

**The Tesla scenario.** A stock like Tesla currently trading at **$100**, considering a **call option
with 10 days to expiration**. If the market believes Tesla will move within a **10% range** over the
next 10 days, the option price reflects that expected movement. Now suppose there's an **earnings
event scheduled within that 10-day period**: the market might anticipate a significant price movement
due to the event, leading to higher option premiums — because the potential for a large price change
increases the likelihood the option ends up in the money, making it more valuable. Nothing is
computed; the point is the direction of the effect.

**The isolation trade.** If you want to trade the event volatility around an earnings report, you
might enter an options position **just before the earnings announcement** and exit **shortly after**,
focusing on the volatility induced by the event itself. That lets you focus on the heightened
uncertainty and increased demand for options associated with major events, while minimizing exposure
to broader market volatility and non-event day-to-day fluctuations.

#### Tables/charts

Five images across the body — one introducing the model, one in each circle's section, and one in the
conclusion. None carry captions or alt text in the capture, so the diagram's exact geometry is not
recoverable. The written description of the relationship is all the source provides.

#### Practical rules

1. Before selling, ask what view you're taking on each of the three circles. Depending on the trade,
   you structure it differently to give yourself more or less exposure to each type.
2. Check for events inside the option's life — a significant share of the year's movement can land
   inside a short window.
3. To trade an event, bracket it tightly: enter just before, exit shortly after.
4. Use a stock's typical non-event volatility to set realistic expectations for its ordinary movement.
5. Don't rely on diversification against Circle 1 — correlations become almost complete in a crash.

#### Predicting Alpha's specific/contrarian opinions

- **Buying or selling an option is explicitly taking a view on all three volatilities at once.** The
  word "explicitly" is Ryan's: this is the content of the trade, not a background detail.
- **Event volatility is categorically different and separately tradeable** — what makes the framework
  operational rather than merely descriptive.
- **Earnings Trading is one of the two strategies Predicting Alpha focuses on**, and Ryan says it has
  a clearly defined premium that has been around for years. A concrete disclosure of where the firm
  puts its money, following directly from the 30–70% claim.

#### Notable direct quotes

> "All three forms of volatility are present in the prices of the options that we trade. It's
> important to understand what drives the value of the product we are trading because when you buy or
> sell an option you are explicitly taking a view on each of these things."

---

### Understanding Implied Volatility vs. Realized Volatility in Options Trading
*Source: https://www.predictingalpha.com/blogs/implied-vs-realized-volatility*

Sean Ryan · August 21, 2024

#### Core thesis

Options are priced on the market's forecast; your P&L is the gap between that forecast and what
actually happened. Ryan frames this as the context we will actually be trading in most of the time,
and says that once you're through the topic you'll have a whole new understanding of trading.

#### Definitions

**Implied Volatility (IV)** — the market's forecast of how much a stock is expected to move over a
certain period in the future. A predictive measure; reflects the market's sentiment.

**Realized Volatility (RV)** — the actual movement of the stock over a specified period. Retrospective;
reflects what happened.

**The seller's edge** — when implied volatility is higher than realized volatility, option sellers make
money.

**Variance risk premium** — the concept the IV/RV difference underpins, and which Ryan calls the entire
reason we trade options to begin with. A repeatable gap is how a strategy gets identified: find an area
where implied consistently outpaces realized and you've found somewhere the VRP can be monetized.

**The Seabiscuit analogy.** You research a horse race, conclude Seabiscuit has the best chance, and
place a bet — that prediction is akin to implied volatility. Once the race is over and Seabiscuit wins
or loses, that outcome represents realized volatility.

#### Formulas

**No formula given** — verified against the full text, not a summary. There is no standard deviation,
no log returns, no annualization, no lookback window, and no estimator of any kind. The article never
states how either IV or RV is measured. The only appearance of "calculation" is as the label on the
Apple hypothetical, which is not a calculation.

#### Numbers, thresholds & rules of thumb

One number: the hypothetical **30% implied volatility over 30 days** for Apple. No threshold for how
wide an IV−RV gap must be to justify a trade, no historical VRP magnitude, no backtest figures.

The one operational heuristic: if you notice implied volatility decreasing and believe it's because
we're moving **from a high volatility regime to a low volatility regime**, there can be option-selling
opportunities that may not be apparent to other retail traders. No detection method is given.

#### Worked examples with the real figures

**Apple, a 30-day contract with an earnings event scheduled in the period.** The market looks at
historical data, current trends, and upcoming events to predict future movements, and might determine
Apple will have **30% volatility over the next 30 days**. That prediction impacts the pricing of the
options, which reflect the movement the market expects between now and expiration. Then reality:

| Realized volatility | Result |
|---|---|
| **Less than 30%** | Options were overpriced — **option sellers profit** |
| **Exceeds 30%** | **Option sellers realize a loss** |

Ryan attaches the qualifier directly to the profit case: sellers would have yielded a profit
**controlling for variables such as delta exposure**. Without that control, directional P&L
contaminates the result.

**The Federal Reserve interest-rate decision.** Ahead of a major economic announcement, traders and
investors might anticipate significant market movements, so implied volatility for many stocks and
indices may rise, reflecting the market's uncertainty. Then two symmetric branches:

| Your view vs. consensus | IV is | Trade | Because you expect |
|---|---|---|---|
| The announcement will have a **less significant** impact than others predict | Overpriced | **Sell** options | RV < IV |
| The market is **underestimating** the impact | Underpriced | **Buy** options | RV > IV |

No rates, percentages or outcomes are attached — the example is structural.

#### Tables/charts

One image following the Apple example, with no caption or alt text in the capture.

#### Practical rules

1. Use IV vs. RV to answer "why did my trade make/lose money?" Ryan makes this the test of whether you
   can explain your own results.
2. **Identify mispriced options** — determine whether options are overpriced or underpriced based on
   your own analysis.
3. **Estimate what the future will look like** — use your predictions of future volatility to guide
   strategy.
4. **Create strategy return expectations** — once you can effectively measure, compare and interpret
   the difference between implied and realized volatility, you can paint a picture of how a given
   strategy should perform.
5. Control for delta before attributing P&L to volatility.
6. Expect IV to rise during uncertainty or economic instability and to be lower in stable conditions,
   and adjust strategy as regimes change.

#### Predicting Alpha's specific/contrarian opinions

- **The article's opening sentence states the mechanism backwards.** Confirmed verbatim in the source,
  where it is the very first line: option sellers make money because on average the amount of movement
  the market thinks a stock will experience in the future is **less than what actually happens** —
  immediately followed by the claim that this means option prices are on average expensive. The two
  sentences contradict each other. If the market consistently expected *less* movement than occurred,
  options would be systematically cheap and sellers would systematically lose. The first sentence
  should read *more* than what actually happens. Everywhere else Ryan states it correctly — Article 2
  says on average the implied volatility overstates the realized volatility. **Read it as: expected
  movement exceeds actual movement, so options are on average expensive, so sellers get paid.** A typo,
  but it sits in the article's first line.
- **"Option trader" and "volatility trader" should be synonymous if you know what you are doing.**
- **The tooling section is flagged by Ryan himself as a shameless plug**, justified by five years of
  building. The three stated uses map how the framework is meant to be operationalized: convert IV and
  RV into variance risk premium — roughly half the reason people use the terminal, showing how much on
  average you can expect to earn selling volatility on different assets and around earnings events; run
  simulations and backtests, which translates the VRP from a theoretical concept into results you could
  expect from adding an asset to your portfolio; and scan, filter and rank stocks and ETFs to find what
  is actually worth analyzing in the first place.
- **Don't gloss over this** — and if you don't get it, email him.

#### Notable direct quotes

> "When we trade options, we are trading volatility."

> "Implied vs Realized volatility is what is going to get you paid, or cause you to lose money."

---

### Statistics For Option Selling: Essential Concepts You Need To Know
*Source: https://www.predictingalpha.com/blogs/option-trading-statistics*

Sean Ryan · September 26, 2024

> **Scope warning.** The unit's statistics lesson covers exactly three measures of central tendency —
> mean, median, mode. Confirmed against the full text: no standard deviation, variance, sigma, normal
> or lognormal distribution, fat tails, kurtosis, skewness, sigma bands, or sample-size guidance
> appear anywhere. Ryan frames it as the statistics 101 ideas needed to at least get started, and
> points to follow-up blogs on the statistical characteristics of option volatility and on
> autocorrelation.

#### Core thesis

Options trading, like all trading, is a probability-based game. Knowing the basics of statistics helps
you make informed decisions, evaluate risks and predict potential outcomes more accurately. You don't
need to be a math whiz, but a firm grasp of the fundamentals is essential — these are the measures you
carry forward into your analysis of strategies and returns.

#### Definitions

**Mean (average)** — the sum of a set of numbers divided by the count of those numbers. A measure of
central tendency giving an idea of the "typical" value in a data set. In options trading the mean is
often used to represent the **expected value**, helping traders predict average outcomes over time.

**Median** — the middle number in a sorted list of numbers. It provides a more accurate representation
of central tendency when the data has outliers or skewed values that could distort the mean.

**Mode** — the most frequently occurring number in a data set. It tells you what is most common or
likely to happen.

#### Formulas

The only formulas in the unit, both given as worked arithmetic:

**Mean = (sum of the values) ÷ (count of the values)**

- *sum of the values* — the arithmetic total of every observation
- *count of the values* — how many observations there are

Median and mode are procedural: sort and take the middle; count and take the most frequent. No
convention is given for an even-length list, and **no dispersion formula appears anywhere.**

#### Numbers, thresholds & rules of thumb

No thresholds — every number belongs to one of the examples. The one quasi-rule is the median
guidance: if you're analyzing stock price movements **over 10 days** and one day has an extreme move
due to an earnings announcement, the median gives a better sense of the typical daily movement.

#### Worked examples with the real figures

**Mean, simple set.** For **4, 5, and 6**: (4 + 5 + 6) / 3 = 15 / 3 = **5**

**Mean, six-sided die.** (1 + 2 + 3 + 4 + 5 + 6) / 6 = 21 / 6 = **3.5**. Ryan's point: although you
can't roll a 3.5, that value represents the average outcome if you rolled the die many times. This is
the bridge to expected value — the average outcome of a process need not be an attainable one.

**Median, the outlier.** For **1, 2, 3, 4, and 10 billion**: median = **3**. The mean here would be
heavily skewed by the outlier, giving a distorted view of the data; the median provides a more
accurate representation of the central tendency. The trading translation is the 10-day case above: an
earnings day wrecks the mean, and the median still tells you about the ordinary day.

**Mode, the frequency case.** For **1, 2, 2, 2, 4, 8, and 10**: mode = **2**. The trading translation:
if a **2% move** is the most frequent daily change in a stock, the mode helps you set realistic
expectations for future movements.

#### Tables/charts

Three images in the body — after the Key Takeaways, after the mean examples, and around the median and
mode examples. No captions or alt text in the capture, and no data visualizations.

#### Practical rules

1. Use the **mean** for expected value — the overall expected outcome.
2. Use the **median** when the data has outliers, which for options means any window containing an
   earnings move. It tells you about the typical day; the mean tells you about the period including its
   most extreme day.
3. Use the **mode** to set realistic expectations about the move you'll most often actually see.
4. Choose the measure deliberately — the same data yields very different summaries depending on which
   you apply.

#### Predicting Alpha's specific/contrarian opinions

- **You don't need to be a math whiz**, but you do need the fundamentals — positioned against both
  quant intimidation and math avoidance.
- **The sharpest line is aimed at people who dismiss the math entirely.** Ryan's claim is not that
  traders need more mathematics, but that they need the *relevant* mathematics, and that dismissing it
  is evidence of not knowing which parts matter.
- **These concepts are not just academic** — they have practical applications in analyzing market data,
  setting realistic expectations, and making informed decisions.

#### Notable direct quotes

> "options trading, like all trading, is a probability-based game. And trust me, if you don't think the
> math is important, then you just don't know the right math."

---

### Volatility Mean Reversion and Clustering: Option Selling Characteristics
*Source: https://www.predictingalpha.com/blogs/volatility-mean-reversion*

Sean Ryan · September 23, 2024

#### Core thesis

The article opens by attacking a belief: everybody seems to think volatility is an unpredictable wild
horse that bucks and kicks and does whatever it wants — and this is untrue. Volatility is something we
can measure, with very distinct characteristics that repeat themselves over time. Two are covered here:
**mean reversion** and **clustering**. Ryan's promise is that you will see these for yourself and be
able to use the knowledge to better understand the market.

#### Definitions

**Volatility** — the extent of variation in the price of a financial instrument over time; how much the
price of an asset fluctuates. High volatility means large price swings, low volatility smaller
movements. A critical component in the options market because it directly influences the pricing of
options.

**Mean reversion** — volatility tends to oscillate around a long-term average, or mean. If it deviates
significantly from that average, it is likely to return to it over time.

**Clustering** — volatility tends to be similar over short periods. If a stock shows high volatility
today, it is likely to exhibit high volatility tomorrow; if volatility is low today, it will probably
remain low in the near future. Volatility trends persist over short periods.

**Volatility regime** — a state where volatility behaves differently under various market conditions.
Ryan's framing: think of it as **a macro level clustering effect**. Regimes are clustering scaled up,
not a separate phenomenon.

**Volatility smile / skew** — named as another advanced concept: the pattern implied volatility forms
across different strike prices. It can provide insight into market expectations and potential
mispricings, and can offer additional opportunities for sophisticated traders. Not developed further
here.

#### Formulas

**No formula given.** No mean-reversion model, no reversion speed, **no half-life**, no lookback window,
no autocorrelation coefficient. Both characteristics are asserted qualitatively with illustrative
percentages only.

#### Numbers, thresholds & rules of thumb

All figures are illustrative; nothing is measured. No breakpoint defines when volatility counts as high
or low relative to its mean, and no regime transition trigger is given.

**Mean reversion:** if the long-term average volatility of a stock is **20%** and current volatility
spikes to **30%**, we can expect it to eventually decrease back toward 20%. Conversely, if volatility
drops to **10%**, it is likely to rise back to 20%.

**Clustering:** if Apple moved up **5%** today, it is likely to experience a similar magnitude of
movement tomorrow, whether up or down. If a meme stock moves up **20%** today, expect it to move around
that number tomorrow — **maybe 18% or 23%**. Note the direction-agnosticism carried from Article 1: the
magnitude persists, the sign does not.

#### Worked examples with the real figures

**Mean reversion and its caveat.** With a long-term average of 20%, deviations to 30% or 10% are both
expected to pull back toward 20%. The trading implication: buying options when volatility is low (below
the mean) and selling them when volatility is high (above the mean) could be a profitable strategy.
Ryan immediately qualifies it — obviously it's not really as simple as this, but as a general principle
it does in fact work. And he names the reason it isn't simple: **clustering, the second
characteristic.** This is the most valuable point in the article. Volatility sitting above its long-term
mean does not mean it falls tomorrow; clustering says tomorrow resembles today. The reversion happens
over a horizon the article never specifies.

**The temperature analogy.** Think of volatility like the weather. If today is a hot summer day at **80
degrees**, tomorrow is likely to be around the same temperature — we don't usually see a drastic change
from summer to winter overnight. Similarly, volatility doesn't shift dramatically from high to low in a
single day; if it was low today, it's likely to be low tomorrow. The analogy carries both properties at
once, which is why it works: temperature clusters day to day *and* reverts to a seasonal mean.

**Regimes.** During periods of market stress or economic uncertainty, volatility can spike dramatically
and **stay elevated for extended periods**. This is the case that breaks the naive mean-reversion trade
— the elevated level persists rather than reverting on a seller's timeline. Ryan's instruction is to
recognize these regimes and adjust your expectations around what implied and realized volatility should
look like. No breakpoints or durations are given.

#### Tables/charts

Four images: one in the mean-reversion section, one in the clustering section, one after the temperature
analogy, and one in the overview. None carry captions or alt text in the capture, so what they plot
cannot be recovered from the text.

#### Practical rules

1. Anchor on a long-term average and read the current level against it.
2. Lean toward selling above the mean and buying below — as a general principle rather than a mechanical
   rule, because clustering can hold an extreme level in place.
3. For short-horizon decisions, use today's volatility as the estimate of tomorrow's.
4. Identify the regime first. Under stress, re-anchor expectations for both implied and realized
   volatility rather than measuring against the old mean.
5. Expect to observe these characteristics in real time, all the time.

#### Predicting Alpha's specific/contrarian opinions

- **Volatility is not a wild horse.** The opening claim is that the widespread belief in volatility's
  unpredictability is simply wrong — it is measurable, with characteristics that repeat and that can be
  observed and predicted.
- **The obvious trade is not as simple as it sounds — but it does work.** Ryan gives both halves, which
  is unusually candid: the principle holds as a general matter, and clustering is why executing on it is
  harder than the description implies.
- **Regimes are a macro level clustering effect** — unifying both characteristics under one mechanism
  rather than treating regimes as something separate.
- **Seeing it live builds justified confidence.** His stated view is that observing these behaviours in
  the real world helps you grow in confidence that you are learning meaningful things.
- **"Volatility trader" is the more professional term** for an option seller — the same equivalence
  asserted in Article 4.

#### Notable direct quotes

> "Everybody seems to think that volatility is some unpredictable wild horse that bucks and kicks and
> does whatever it wants. But this is actually untrue."

> "Obviously it's not really as simple as this but as a general principle it does in fact work."

---

### Unit summary — the chain these six articles build

1. Volatility is the *size* of moves, never the direction (A1).
2. Option prices are set by expected volatility, so trading options is trading volatility whether you
   intend it or not (A1).
3. Dollar prices aren't comparable; IV is the unit that makes them comparable across strikes and across
   underlyings (A2).
4. The implied number decomposes into market, non-event and event volatility — and event volatility
   alone can be 30–70% of a stock's annual movement, and is separately tradeable (A3).
5. Your P&L is the gap between the forecast (IV) and the outcome (RV), controlling for delta (A4).
6. The mean is expected value; the median is what you use when an earnings day would wreck the mean (A5).
7. Volatility mean-reverts over long horizons and clusters over short ones, and that tension is why the
   obvious trade is hard (A6).

**Not in this unit, and needed from elsewhere:** any volatility or expected-move formula, any
annualization convention, any realized-volatility estimator or lookback, any distribution theory, any
mean-reversion parameter, and the Black-Scholes equation itself.

## Module 3 — Mastering Volatility (Part B: Advanced & the Variance Risk Premium)

> Notes written from the full text of each article. Every figure below appears literally in its
> source. Where the brief asked for something an article does not contain, the section says so under
> **Not stated in this article** rather than filling the gap.

---

### Volatility Characteristics That Explain How Option Prices Change: The Must Know Features of Volatility
*Source: https://www.predictingalpha.com/blogs/option-iv-explained*

Sean Ryan · September 2, 2024

#### Core thesis

The article opens against a specific claim: that volatility is unpredictable, and that the time
option sellers spend measuring and analyzing it is for nothing. Ryan's answer is that volatility has
key characteristics that help us forecast how it will behave, no differently from how stock price
movement has general characteristics of its own. The payoff is that stock and volatility have
opposite statistical properties, so the measurements that extract insight from each must differ.
Options are a derivative of stocks, but they behave in an entirely different way.

#### Definitions

**Mean reversion.** Volatility oscillates around an average value. Above that mean it tends to get
pulled back down; below it, it tends to rise back up. That pull toward the mean is a defining feature
of mean-reverting assets.

**Stationary.** Volatility stays within a specific range and tends to revert to its mean. It does not
trend indefinitely in one direction, which is what makes it a stationary process.

**Clustering.** Volatility tends to stay high when it is high and low when it is low. It does not
simply spike and drop back immediately — it often remains elevated or depressed for a period before
reverting to its mean.

**Non-stationarity (stock).** Stocks do not stay within a fixed range. They move directionally based
on factors such as earnings, economic conditions, and market sentiment.

#### Numbers, thresholds & rules of thumb

| Figure | Claim |
|---|---|
| **~14** | The average the VIX oscillates around |
| **9 and 80** | The range the VIX fluctuates between |
| **30-year period** | The span over which that range is observed |
| **4 year backtest** | Length of the short-vol backtest run on each ETF |

#### Formulas

None. Every relationship in the article is stated qualitatively; no equation appears.

#### Worked examples with the real figures

**The ETF Premium sorting process** — the article's one concrete procedure. Given the characteristics
of volatility, one of the most effective ways to measure it is to establish three things: the average
implied volatility, implied over realized volatility, and the variance risk premium. Once you have
done this you can visualize the range in which volatility moves for a particular underlying, and use
that to forecast what future volatility may look like.

Predicting Alpha applies this to its ETF Premium strategy by using the **mean variance risk premium
to sort ETFs into two groups**: those that have a variance risk premium and those that do not. The
sort is done by examining a **4 year backtest** of selling volatility on each ETF to see whether
returns have been positive — that is, whether after accounting for costs, hedging and so on, it has
been profitable to be net short options on that particular ETF.

Ryan frames this as a practical example of measuring volatility to make real trading decisions: take
the characteristics understood about volatility, assume they persist, and leverage them.

**Moving averages** — the counterpart for stock, not for volatility. Traders capture long-term trends
by buying when the stock price crosses above a moving average and selling when it crosses below. This
leverages the trending nature of stocks, which the article contrasts explicitly with the
mean-reverting nature of volatility. Ryan prefaces the section by stating he is not an expert in
trading stock and that their focus is the world of volatility.

#### Tables/charts

One image sits under "Three Characteristics of Volatility", introduced as describing the key
characteristics of how volatility changes. Its contents are not reproduced in the article text, so
nothing can be reported about its axes or series.

#### Practical rules

- Match the measurement to the behaviour of the series: trend-following tools for stock, range and
  mean-reversion tools for volatility.
- A volatility *range* for an underlying is a usable forecasting object, because volatility is
  stationary.
- Sort candidate underlyings into has-premium / no-premium before anything else.
- Judge a premium by a backtest that accounts for costs and hedging, not by the premium alone.

#### Predicting Alpha's specific/contrarian opinions

- Directly against the crowd: volatility is not unpredictable, and the analysis option sellers do on
  it is not for nothing.
- The stated epistemology is deliberately mechanical — understand the characteristics, assume they
  persist, act on them. No claim to foresight.
- Ryan openly disclaims expertise in stock trading, which bounds the course's claim of edge to the
  volatility domain.
- For stocks, volatility increases when prices decline — the opposite of how volatility itself
  behaves. When stocks drop, fear and uncertainty rise. This is where "stocks go up like an escalator
  and down like an elevator" comes from, which the article glosses as stocks slowly trending up and
  then realizing the majority of their volatility to the downside.

#### Notable direct quotes

> "Volatility is mean-reverting, which means it oscillates around an average value."

> "We take the characteristics that we understand about volatility, assume they should continue to
> persist, and then leverage them to make informed decisions."

> "Volatility is stationary and mean-reverting, while stocks trend."

#### Not stated in this article

- No formula for the variance risk premium — it is named as a measurement only.
- No moving-average lengths, and no results for the moving-average method.
- No threshold value for "average implied volatility".
- No spot-vol correlation figure; the escalator/elevator line is qualitative.

---

### Understanding Spot Vol Correlation: How Share Price and Implied Volatility Move Together
*Source: https://www.predictingalpha.com/blogs/spot-vol-correlation*

Sean Ryan · August 30, 2024

#### Core thesis

Changes in spot price affect implied volatility, and the sign of that relationship differs
significantly between assets. Because it exists, every volatility trade carries an implicit
directional view — and the article's point is that you should know what your trade is implicitly
saying before you place it. Ryan closes by calling the concept fairly straightforward at the end of
the day, and framing the real work as developing your view and expressing it correctly.

#### Definitions

**Spot price.** The current price of an asset, such as the S&P 500, Tesla, or Gamestop.

**Implied volatility.** The body defines it as the market's forecast of how much a stock will move in
the future. The Key Takeaways give a second, subtly different gloss — the relative value of the
options being traded on that ticker. Both appear in the article.

**Spot and IV correlation.** Examines how changes in the spot price impact implied volatility. The
article introduces it as a question: if the S&P 500 increases by 1%, what happens to its implied
volatility, and conversely, if it decreases by 1%, how does its IV respond?

#### Numbers, thresholds & rules of thumb

Only three figures appear in the entire article.

| Figure | Exact claim | Where |
|---|---|---|
| **1%** | Used only to *pose* the question — if SPX moves 1% up or down, what happens to IV | Understanding the Correlation |
| **2%** | S&P 500 up 2% → implied volatility typically decreases. S&P 500 down 2% → IV tends to rise by approximately **15.6%** | Using the S&P 500 as an Example |
| **$43** | GME's price in the trade-structuring example | Structuring Trades Based on Correlation |

Two cautions. The 1% is rhetorical framing, not a measured result — the measured claim uses 2%. And
the article never says whether 15.6% is a relative rise in the IV level or a rise in volatility
points, so it should not be converted or treated as a slope.

#### Formulas

None. No correlation coefficient, regression slope, or beta appears anywhere in the article.

#### Signs by asset

| Underlying | Sign | What the article says |
|---|---|---|
| S&P 500 (SPY) | **Negative** | When the S&P 500 rises, IV decreases; when it falls, IV increases |
| Gamestop (GME) | **Positive** | Spot up → IV up; spot down → IV down |
| Tesla (TSLA), 2021-2022 | **Positive** | Rare for such a large company, but for a while exactly what was seen |

The reasoning Ryan gives for GME is a question you can put to any ticker — where is the volatility?
If Gamestop were going to see a massive move, is it likely to be to the upside or the downside? The
observed answer for Gamestop is the upside, so a positive correlation between spot price and
volatility makes sense. He notes the analysis becomes really valuable on tickers where the
relationship is perhaps not so obvious, and offers Tesla as that case.

#### Worked examples with the real figures

**The GME short straddle.** Suppose GME is trading at **$43**, and we anticipate a drop in IV and a
decline in the spot price. By selling a straddle with a strike price slightly above the current spot
price, we capitalize on the correlation:

- If GME's price drops, we benefit from the decrease in IV.
- If GME's price increases, the impact is mitigated by our initial positioning above the spot price.

The Key Takeaways restate this as the general lesson: had you traded Gamestop during the rally, you
might have structured a short straddle slightly above at-the-money so you have positive returns if
implied volatility drops, while mitigating some risk if the stock continues to rally.

#### Tables/charts

Two images — one under "Visualizing the Data" for the S&P 500 relationship, one under the Gamestop
section. Neither image's contents are reproduced in the article text, so no axes, coefficients, or
fitted lines can be reported from them.

#### Practical rules — the article's "Three Things to Remember"

1. **Implicit directional views.** Always consider the implicit directional view when trading
   volatility. The article gives it in both directions: being long the S&P 500 implicitly means you
   are short volatility, since the S&P tends to rise when volatility is low; and if you are selling
   volatility on a ticker with negative spot/volatility correlation, you are implicitly saying you
   think the share price will rise — because if volatility goes down, the share price should go up.
2. **Adapting to changing correlations.** Correlations change. A trade placed today may not be done
   the same way next month if the correlation is significantly different.
3. **Utilizing correlation in risk management.** Understanding the correlation between spot price and
   IV lets traders better manage risk and optimize strategies; the Gamestop trade is the example.

#### Predicting Alpha's specific/contrarian opinions

- Positive spot-vol correlation on a company as large as Tesla is rare — the negative relationship is
  the default expectation for large names.
- Selling volatility is never directionally neutral. On a negatively correlated ticker it is an
  implicit bet that the share price rises, stated as what your trade *means* rather than as a risk to
  be hedged away.
- Correlation is unstable enough that a structure has a shelf life; re-check it rather than assume it.

#### Notable direct quotes

> "Correlations change. The trade that we placed today may not be done the same way next month if the
> correlation is significantly different."

> "Just ask yourself: where is the volatility?"

> "Trading is about developing your view and expressing it correctly."

#### Not stated in this article

- **Commodities are not mentioned at all** — no sign, no example. Nothing here supports any claim
  about commodity spot-vol correlation.
- **No correlation coefficient, regression slope, or beta** anywhere.
- **No general rule separating single names from indices as classes.** Two single-name examples are
  given, both positive, but the article generalises no further than "different assets, different
  correlations".
- **No P&L decomposition** for a short-vol position — the effect appears only as the GME straddle's
  two outcomes, never quantified or split into delta and vega.
- **No connection drawn to skew.**
- **No figure for the up-move case** — the 2% rally is described only as "implied volatility typically
  decreases".

---

### Understanding Autocorrelation: A Key Characteristic for Predicting Future Option Prices
*Source: https://www.predictingalpha.com/blogs/option-price-prediction*

Sean Ryan · September 17, 2024

#### Core thesis

Autocorrelation determines whether the path an underlying takes is friendly or hostile to a short
option position. Negative autocorrelation — chop — keeps the stock inside the break-evens and reduces
hedging costs. Positive autocorrelation — trend — is a reason to leave a ticker out of the portfolio.
The practical payload is a rejection filter, not an entry signal.

#### Definitions

**Autocorrelation.** A statistical concept that measures the relationship between a variable's
current value and its past values. In simpler terms, it tells us how today's return is a predictor of
tomorrow's return. Useful in financial markets because it helps traders identify trends and patterns.

**Positive autocorrelation.** Occurs in trending markets. If a stock has positive autocorrelation, a
1% up move today means it is likely to move up by a similar amount tomorrow. The pattern can continue
over multiple periods, indicating a trend.

**Negative autocorrelation.** The opposite, and a characteristic of mean-reverting markets. If a
stock goes up by 1% today, it is likely to go down by 1% tomorrow. This back-and-forth movement
indicates the stock price tends to revert to its mean rather than continue in one direction.

**Which series.** The examples are stock returns and stock prices — today's return predicting
tomorrow's, and a stock moving $100 → $101 → $100. The framing sentences call autocorrelation one of
the characteristics of volatility, and the conclusion says you will start seeing it in the behavior
of stock price and volatility, but no volatility or variance series is analysed anywhere.

#### Numbers, thresholds & rules of thumb

The complete set: **1%** (the illustrative daily move, used in both the positive and negative cases),
**$100** (starting price) and **$101** (after the first day). There is no threshold separating strong
from weak autocorrelation, and no coefficient of any kind.

#### Formulas

None.

#### Worked examples with the real figures

**Negative autocorrelation.** Consider a stock that starts at **$100** and has negative
autocorrelation. If it moves up to **$101** today, it is likely to move down to **$100** tomorrow,
and then up again the next day. This back-and-forth movement means the stock stays within a
predictable range, allowing your short volatility trades to profit.

**Positive autocorrelation.** Given generically — if a stock is on an upward trend, positive
autocorrelation would suggest it will likely continue moving up. No figures attached.

#### Tables/charts

Four images appear: under the positive autocorrelation section, the negative autocorrelation section,
the options-selling section, and the buying-volatility section. None of their contents appear in the
article text, so nothing can be described about what they plot.

#### Practical rules

- **Prefer negative autocorrelation as a seller.** The reason is direct: we want the underlying stock
  to stay within the break-even of our short straddles or short strangles.
- **Chop cuts costs.** We also want to minimize the frequency with which we need to delta hedge,
  since this leads to incurring costs. A second benefit independent of the break-even one.
- **Use it as an exclusion filter.** If a stock exhibits positive autocorrelation, it can be an
  indicator that we may want to avoid including that ticker in our portfolio — explicitly conditioned
  on believing the positive autocorrelation is likely to continue.
- **For long vol, treat it as a location hint.** If you are looking to add long volatility positions
  to your portfolio, positive autocorrelation may be something you look for when deciding where to
  add them.
- Identifying autocorrelation in stocks involves historical price analysis, statistical tools, and
  understanding market conditions — a closing line that names the ingredients without giving a method.

#### Predicting Alpha's specific/contrarian opinions

- The refusal to convert trend into a buy signal is the article's sharpest move. Positive
  autocorrelation may not strongly indicate an option buying opportunity — and the reason given is
  that the variance risk premium still exists. A trend signal does not clear the structural cost of
  being long options.
- Path matters, not just magnitude: the implicit argument is that realized volatility alone does not
  tell a seller what will happen to their position.

#### Notable direct quotes

> "We want the underlying stock to stay within the break-even of our short straddles or short
> strangles."

> "While this may not strongly indicate an option buying opportunity (the variance risk premium still
> exists), it can be an indicator that we may want to avoid including this ticker in our portfolio."

> "As you continue to learn more about the characteristics of volatility and prices, you will continue
> to refine the lens through which you view the market."

#### Not stated in this article

- **Only lag-1 is discussed** — today versus tomorrow. "Multiple periods" is mentioned for trend
  continuation, but no lag beyond 1 is named or measured.
- **No autocorrelation coefficients** for any ticker.
- **No holding-period guidance** — nothing on how long to hold for mean reversion to work.
- **No forecasting or calculation method**, despite the recommendation resting on believing the
  autocorrelation will continue.
- **No statistical tests, no data, no backtest.**
- **No analysis of volatility or variance autocorrelation** as distinct from returns.

This is the shortest article in the unit; the notes above cover essentially all of its content.

---

### Implied Volatility Explained: How to Think About Options Like a Professional
*Source: https://www.predictingalpha.com/blogs/what-is-implied-volatility*

Sean Ryan · August 19, 2024

#### Core thesis

Because options expire, a trader must be aware not just of the direction a stock will move but by how
much it will move in a given time period. That makes volatility the key factor the market uses to
price options, and it makes every option trader a volatility trader — some know this and others
don't. From there the article builds a decomposition (three separable forms of volatility inside one
option price) and then the trading decision: your forecast against the market's, with the variance
risk premium as the standing exception that lets sellers profit without a better forecast.

#### Definitions

**Volatility.** Simply the size of the move for a given stock. Not about the direction of movement —
fundamentally about the size of the moves, not the direction the stock goes.

**Implied volatility.** Since volatility is a significant part of how the market prices options, we
can say option prices *imply* future volatility. Stated plainly later: how much the market thinks the
stock will move in the future.

**Realized volatility.** How much the stock actually ends up moving.

**Market volatility.** The overarching volatility of the entire market that affects all stocks. Every
stock exists within the broader market, and if the market crashes they all take a significant hit.
Summarised as the "tide that rises and lowers all ships."

**Non-event volatility.** The regular day-to-day movement of a stock — how the company has been
performing and its average daily movement. The article's test question: does it typically move 1% a
day or 10% a day? $KO generally has less non-event volatility than $AMC.

**Event volatility.** Significant movements driven by key company-specific events — earnings
announcements, product releases, drug approvals. These introduce new information into the market,
often leading to sudden and substantial changes in the share price, causing short bursts of high
volatility not typically seen in regular day-to-day movement.

#### Numbers, thresholds & rules of thumb

| Figure | Context |
|---|---|
| KO: **+1%, −1%, +2%** | Three-day illustrative move pattern for the stable stock |
| AMC: **up 10%, down 15%, up 20%** | Three-day illustrative pattern for the volatile stock |
| **$100** per share | Both stocks, for the like-for-like option comparison |
| **$2** | The AMC option price at which everyone would buy and no one would sell |
| **$10** worth **$5** | The generic mispricing that constitutes a great opportunity |
| ATM call and put **$5** each (5% of share price) | The straddle example, stock at $100 |
| Straddle **$10** = **10%** of share price | The range the market implies |
| **30 days** | Option life; earnings scheduled in the middle |
| **29 days** | The other days that might see minimal movement |
| **1% a day** | The stock whose typical move a market crash would overshadow |
| **4:1** odds, **50%** vs **25%** implied, finished **4th** | The Seabiscuit analogy |

#### Formulas

The article's only explicit arithmetic, given in prose:

**ATM straddle = ATM call + ATM put** = $5 + $5 = **$10**, which is **10%** of the $100 share price.
Each leg is noted as 5% of the share price. The result is read as the market expecting the stock to
move up or down by 10% in the next 30 days.

**IV/RV ratio** is named as something these tools can examine for $KO and $AMC, but no ratio values
are given.

#### Worked examples with the real figures

**KO versus AMC.** KO has been around a long time — we understand how much money they make, how they
make it, and what future revenue is likely to be — so on a day-to-day basis we shouldn't expect
massive swings: for instance +1%, −1%, +2% across three days. AMC moves a lot: up 10% one day, down
15% the next, back up 20% on the third. KO is much more stable; there is a lot less risk associated
with it.

Which has costlier options? AMC's, because there is a higher risk it moves significantly, and the
options market tries to price what is going to happen in the future. Since it is much more probable
that AMC moves 10% tomorrow than Coca-Cola, AMC options imply more future big-move risk.

Hold the price constant to isolate the effect: if both stocks were trading at **$100** per share, a
**$100 strike call on AMC** would be much more expensive given the higher likelihood of significant
moves. The supply-demand check — if an AMC option were priced at only **$2**, everyone would want to
buy it and no one would want to sell it, and that imbalance would drive the price up.

**The 30-day straddle and its decomposition.** The stock trades at $100 and the ATM call and put are
each priced at $5. Adding them, the range the market implies is $10, or 10% of the share price — the
market expects the stock to move up or down by 10% over the next 30 days.

Now place an earnings event in the middle of those 30 days. Market, non-event and event volatility
are all contributing to that 10%. Knowing the event is there, the 3 circles let us predict that **much
of the implied 10% move might occur on that day, with minimal movement on the other 29 days**.
Analytics tools can separate event and non-event volatility, which the article calls useful for
selling options and understanding what you are selling.

**GME, where the event added nothing.** Consider GME during its highly volatile period. Despite the
extreme movements in its stock price, the event volatility around its earnings releases was almost
the same as its non-event volatility. This indicated no additional "event impact" was being priced
in, because the stock was already experiencing high volatility.

**DAL term structure.** An image shows the term structure for DAL and how much earnings event
volatility is priced into the different DTEs, with earnings scheduled for that week.

**Seabiscuit.** At the racetrack, Seabiscuit shows **4:1** odds — risking 1 to potentially win 4. You
analyze the situation and believe there is a **50%** chance of Seabiscuit winning while the market
implies only **25%**, so you place the bet. Seabiscuit makes a strong start but finishes **4th**. The
market's implied probability is akin to implied volatility; the race's outcome is the realized result,
akin to realized volatility. The discrepancy between your 50% and the market's 25% is the reason you
would place the bet at all — if you agreed with the bookie's odds there would be no reason to bet,
and since the bookie slightly skews the odds in his favour, agreeing with them would mean a bet with
negative expectancy.

#### Tables/charts

Images appear for the KO and AMC move patterns, each of the 3 circles, the decomposition of the 10%
move, the DAL term structure, and a KO/AMC implied-versus-realized graph. Only the last two are
characterised in the text. On the IV/RV graph, Ryan notes it is quite interesting to observe the gap
between implied and realized volatility for $KO and $AMC on a single graph, and that **both have
stabilized to a similar spread over time**.

#### Practical rules

- Think about the *value* of options, not just the exposure they provide. Finding an option trading
  for $10 that is really worth $5 is a great trading opportunity.
- Read the ATM straddle as the market's implied range, and express it as a percentage of share price.
- When an event falls inside the option's life, expect the implied move to concentrate on that day
  rather than spread evenly across the period.
- Check whether an event is actually priced as an event — GME is the counter-case where it was not.
- Isolate the circle you want. Depending on what you think is mispriced you can focus on one form of
  volatility; to trade an earnings event, structure the trade to minimize market and non-event
  volatility.
- Act on the discrepancy: if the market believes a stock won't move much but you think it will,
  options are cheap; if the market implies more movement than you expect, options are expensive. If
  you believe implied volatility accurately reflects the future, there is no edge for you.

#### The variance risk premium exception

The hinge into the next article, stated plainly: in most cases, forecasting volatility better than
the market is hard — but we don't always need to be doing that. Built into the market's forecast is
often the variance risk premium, which **if measured properly, allows option sellers to generate
returns without needing to be able to see the future**. A structural claim, not a skill claim.

#### Predicting Alpha's specific/contrarian opinions

- Every option trader is expressing a view on volatility; some know this and others don't.
- Most retail traders are price insensitive in the options space — they focus more on the exposure
  options provide than on their cost. This is named as the inefficiency worth exploiting.
- Event volatility can be effectively absent even when an event is scheduled.
- The closing frame, via a line from *The Richest Man in Babylon* about gold slipping away from those
  who invest it into purposes they are not familiar with: often it is this lack of familiarity that
  creates inefficiencies which more experienced traders can exploit.

#### Notable direct quotes

> "As an option trader, you are expressing a view on volatility… Some know this and others don't."

> "Volatility is crucial because it is the key factor the market uses to determine how much options
> should be trading for."

> "If you believe the market's implied volatility accurately reflects the future, there's no edge for
> you."

> "Remember, options are volatility products."

#### Not stated in this article

- No numerical split of the $10 straddle into its three components — the decomposition is described,
  never solved.
- No IV/RV ratio values for KO or AMC, and no DAL implied volatility levels.
- No annualisation convention, standard-deviation formalism, or option pricing model mechanics.
- No VRP magnitude — the premium is introduced conceptually and quantified in the next article.

---

### Understanding Variance Risk Premium: The Reason Option Sellers Make Money
*Source: https://www.predictingalpha.com/blogs/variance-risk-premium*

Sean Ryan · August 16, 2024

> The rendered H1 in the source reads "Understanding Variance Risk Premium's The Reason Option
> Sellers Make Money" — an apparent typo where a colon belongs. Rendered above with the colon.

#### Core thesis

Option selling works because implied volatility tends to overstate realized volatility. The article
is explicit that this is not new and not a hidden secret — it is well researched, thoroughly
documented, and the entire reason we sell options to begin with. Its stated purpose is to prove the
VRP exists, will continue to exist, and that leveraging it is the key to running a profitable option
selling portfolio. Predicting Alpha's strategies are all based on monetizing it, and Ryan concedes
they tend to be pretty "boring" strategies because they aren't doing magic — but that they offer real
returns backed by data and logic.

#### Definitions

**Variance risk premium.** The tendency for implied volatility to be higher than the *subsequently*
realized volatility. Observed across various asset classes including equity indices, the VIX, bonds,
commodities, currencies, and many individual stocks.

**How it is measured.** The difference between implied volatility — the market's forecast of future
volatility — and the actual volatility that materializes over time.

**In plain English (the article's own framing).** Option prices are typically higher than the actual
volatility experienced. This means options are usually expensive.

**Why it matters.** It justifies selling options as a profitable strategy. Without the phenomenon
there would be no inherent reason to believe selling options would continue to be profitable in the
future. Ryan draws the parallel directly: it is similar to how the key behind all stock buying
strategies is the equity risk premium.

#### Formulas

The article specifies the comparison rather than writing an equation. To create a data point, compare
the market implied volatility for a period against the realized volatility experienced in that same
period, using:

**VRP on a given day = IV30d − futureRV30d**

- **IV30d** — the 30 day implied volatility
- **futureRV30d** — the subsequent realized volatility over the next 30 days

The article's phrasing is that these two "determine the variance risk premium embedded on a given
day." The timing is the whole point: the comparison runs forward against what follows, not against
trailing realized volatility.

#### Numbers, thresholds & rules of thumb

| Figure | Claim | Scope |
|---|---|---|
| **4 points** | On average, implied volatility is 4 points higher than realized volatility | **S&P 500** |
| **85%** | The variance risk premium is positive 85% of the time | **S&P 500** |
| decades | The VRP has persisted for decades | S&P 500 graph; no year range given |
| **4 years** | Period over which the daily calculation is run to build the chart | All metrics except the moving average |
| **10 days** | Window for the VRP Moving Avg. metric | — |
| past year | Comparison window for IV Percentile | — |
| **80** | When IV Percentile climbs above 80, a sign of big swings ahead | Threshold |
| **5,000** | Option volume higher than this is what Ryan looks for | Liquidity threshold |
| **99%** | Share of profitable option strategies that harness the VRP | Author's claim |
| **1,000** | Number of traders being accepted for membership | Closing pitch |

The scope column matters. The 4 points and the 85% are stated for the **S&P 500 only**. The article
says the same analysis has been conducted for the Dow Jones, NASDAQ 100 and Russell 2000, but that
summary is delivered as an image — no per-index figures appear in the text.

#### Worked examples with the real figures

**The S&P 500 proof.** The article presents a graph of the difference between implied and realized
volatility for the S&P 500, often used to represent the broader market. A **blue line** represents
the implied volatility and an **orange line** the realized volatility. What the graph reveals: on
average the implied volatility is **4 points** higher than the realized, and notably the variance
risk premium is positive **85%** of the time — meaning that in the vast majority of instances,
implied exceeds realized. The graph also shows the VRP has persisted for **decades**.

**The two-step calculation.**

*Step 1* — compare implied volatility with realized volatility, using IV30d against futureRV30d, to
produce one data point.

*Step 2* — create data points over the last 4 years. One day's data isn't enough to make a trade: a
single day shows whether there *was* a profitable trade, but it doesn't tell us whether there is an
embedded premium for us to monetize. So the calculation is run for every day over a large period —
4 years — to build a chart of the variance risk premium. Ryan's note on the tooling: it lets the
S&P 500 analysis be repeated for any ticker in seconds, so you can immediately see whether the
variance risk premium exists on an ETF or stock.

#### The five metrics, and how to read them

| Metric | Definition | Interpretation |
|---|---|---|
| **Avg. VRP** | Average spread between 30-day implied volatility and the subsequent realized volatility, using 4 years of data | We want to trade tickers with an established VRP. A positive average confirms the hypothesis that a VRP exists for a ticker and that selling options is likely to remain profitable. **The most important metric in the analysis.** |
| **VRP Moving Avg.** | The same calculation using only the last 10 days of data | Because there is short-term clustering in volatility, this shows whether there has been a premium in recent times. It complements the average. |
| **VRP Win Rate** | Percentage of days over the last 4 years the VRP calculation output was positive | We want to sell premiums that follow the typical risk profile a short volatility strategy should see — **many small winners, occasional big losers**. The win rate is an easy way to observe this. |
| **IV Percentile** | Current percentile of 30-day implied volatility compared to the past year | The IV Percentile **doesn't impact the presence of the variance risk premium — it always exists**. What it does impact is the variance you experience in your PnL. Above **80**, a sign of big swings, and a reason to trade a different ticker. |
| **Median Option Volume** | Average number of options traded each day over the past 4 years | Data quality directly impacts insight quality. Volume higher than **5,000** is what Ryan looks for to have confidence there was enough liquidity for the observed data to be true. |

#### Four reasons the VRP exists

Data shows the historical presence; these are the reasons to believe it continues.

1. **Traders are willing to pay for insurance.** Called the most compelling reason. During market
   crashes, diversification strategies often fail and puts become the only reliable form of
   protection — so a significant portion of the VRP is driven by demand for put options.
2. **Traders are willing to pay to gamble.** Call options can be mispriced due to fear of missing out
   on significant price jumps. Traders seeking exponential returns are less sensitive to the price of
   the calls they buy.
3. **Options protect against sudden price jumps.** Underlying prices can experience sudden jumps, and
   unlike dynamic hedging strategies, options offer a straightforward way to manage sudden price
   movements — attractive to both hedgers and speculators.
4. **Most traders can only buy, not sell options.** Many retail traders face restrictions from their
   brokers, such as being prohibited from selling naked options. A large group of speculators can
   therefore only buy options, which drives up the variance premium.

Ryan's argument from independence: typically one solid reason is enough to understand a premium's
existence, and here there are four. Each factor individually justifies the VRP, and it is unlikely
they all disappear simultaneously regardless of how market dynamics evolve over time.

#### Tables/charts

Four images, and it matters which carry numbers in the text and which do not:

- **S&P 500 implied-vs-realized graph** — blue line implied, orange line realized. Its findings *are*
  given in the text: 4 points, 85%, decades.
- **Cross-index table** — introduced as summarising the key statistical findings for the Dow Jones,
  NASDAQ 100 and Russell 2000. **Delivered as an image; no values appear in the text.**
- **Step 1 and Step 2 calculation images** — no values in the text.
- **SPY metrics panel for July 25, 2024** — the article says the picture shows the key metrics for
  the variance risk premium of SPY on that date. **The values are not in the text and cannot be
  reported.**

#### Practical rules

- Measure implied volatility today against the volatility realized *afterward*, never against
  trailing realized volatility.
- Never judge from one day — build 4 years of daily data points first.
- Require a positive Avg. VRP; it is the gate.
- Cross-check the 4-year average against the 10-day moving average for current conditions.
- Require median option volume above 5,000, or distrust the data behind every other metric.
- Don't read IV Percentile as an edge signal — it does not affect whether the premium exists, only
  the variance of your P&L. Above 80, consider trading something else.
- Confirming a premium exists is not confirming you can capture it. The article's own next step is to
  expand the analysis with backtests to see whether the premium has been monetizable in a practical
  way.

#### Predicting Alpha's specific/contrarian opinions

- **99% of profitable option strategies harness the VRP** — the strongest claim in the unit,
  reframing nearly all option profitability as one phenomenon.
- The VRP is what justifies option selling at all; without it there is no inherent reason to expect
  selling to keep working.
- It is not a secret or an anomaly. The four reasons describe people paying for something they want,
  which is why the premium survives being widely known.
- The approach is deliberately unexciting, and Ryan says so twice — the strategies are "boring"
  because they aren't doing magic, and you probably won't brag to your friends about this approach.
- Predicting Alpha focuses on two sources of premium: selling options on ETFs, and selling options
  around earnings events.

#### Notable direct quotes

> "The variance risk premium is the tendency for implied volatility to be higher than the subsequently
> realized volatility."

> "In plain English, the variance risk premium (VRP) refers to the fact that option prices are
> typically higher than the actual volatility experienced. This means options are usually expensive."

> "If the stock is going to jump 1,000%, who cares if the call option costs $5 or $10!"

> "Billions of dollars have been raised and traded based on this core idea."

> "This is not really the most exciting way to trade. As we often say, you probably won't brag to your
> friends about this approach to trading. But in reality, it's how you make money."

#### Not stated in this article

- **No per-index VRP figures** for the Dow Jones, NASDAQ 100 or Russell 2000 — the comparison table
  is an image.
- **No numerical values for the five SPY metrics**, despite the panel being shown and dated.
- **No explicit sample period for the "decades" claim** — no year range is given. The 4 years applies
  to the screening metrics, not to the historical graph.
- **No quantified drawdown or tail magnitude.** The only statement about the shape of the loss side is
  the Win Rate row's "many small winners, occasional big losers"; nothing sizes the losers, and the
  days when the premium is negative are implied by the 85% but never discussed directly.
- **No VRP magnitudes** for the VIX, bonds, commodities, currencies, or individual stocks — named as
  places the phenomenon is observed, never quantified.
- **No variance-versus-volatility distinction.** Despite the name, the premium is defined and measured
  in volatility terms — points of implied minus points of realized — with no squared-units or
  variance-swap formulation.
- **No position sizing, allocation, or exit rules.**

---

### Module 3 Part B — gap across the unit

The loss side is never sized. "Many small winners, occasional big losers" is the only
characterisation of the short-vol payoff shape in these five articles, and none of them quantifies a
drawdown, a worst case, or the days when the premium is negative.

## Module 4 — Option Greeks

Seven articles, all by **Sean Ryan**, Predicting Alpha. Condensed from the full article text. Every
figure, formula, and claim below is the article's own; short quotes carry the author's distinctive
lines. Additions are tagged `> [context, not from article]`. Where an article's own arithmetic
doesn't reconcile, it is flagged — the trader needs to know which numbers are schematic.

**Sub-links: skipped per instruction** (site graph assigned elsewhere).

---

### Black Scholes Model Explained: The Foundation of Option Pricing
*Source: https://www.predictingalpha.com/blogs/black-scholes-model-explained*

Sean Ryan · September 5, 2024

#### Core thesis

Black-Scholes is the most commonly used formula for determining option prices and volatility, and
everything downstream — implied volatility, all the greeks — is derived from it. The article's
position is that you consume it, you don't compute it: "we may not need to 'use it'", but you need
to understand why it exists. It opens by calling it "a magical formula" and then deliberately
demystifies it.

#### Definitions

**The model.** A mathematical model for pricing options. It takes several inputs and returns **one
of two outputs: the implied volatility, or the option price.** This bidirectionality is the point,
and the article states it both ways explicitly — feed it the other variables and solve for implied
volatility (the number quoted on trading platforms), or feed it the implied volatility and solve
for the option price.

**Implied volatility.** The market's forecast of future volatility. An option's price *implies* how
much future movement the market expects.

**The analogy used:** plugging inputs into the formula is like a high-school math function — put
values in, get a result out.

#### Formulas

The five key variables, as listed:

| Input | Meaning as given |
|---|---|
| Call/Put Price | The current market price of the call or put option |
| Strike Price | The predetermined price at which the option can be exercised |
| Days Until Expiration | The remaining time until the option expires |
| Dividends | Any dividends paid by the underlying stock |
| Interest Rate | The risk-free interest rate |

**The equation itself is never written out in text.** The section "This is What The Equation Looks
Like" contains images and no caption, transcription, or symbol definitions. **d1 and d2 are never
named.** No assumption list appears anywhere in the article — no lognormal returns, no
constant-volatility caveat, no continuous-hedging condition, and no statement about which
assumptions fail in practice. That material is simply not in this piece.

#### Numbers, thresholds & rules of thumb

Strike $200 · 30 DTE · dividends none · interest rate 0% · market IV 30% · resulting call price $5
· trader's volatility view 15% · resulting fair value $2.50.

#### Worked example with the real figures

Price an **Apple call**: **$200 strike, 30 days until expiration, no dividends, 0% interest rate.**
At **30% implied volatility**, the model returns a call price of **$5**.

Now substitute your own view. If you expect realised volatility of **15%** instead, the model
"might give you" a new call price of **$2.50**.

The **$5 market price vs $2.50 calculated price** gap is the trade — "a difference between the
market price and our opinion on fair value." And the conclusion drawn from it: "If the market is
overvaluing the option, we want to be selling it!"

#### Tables/charts

Equation images, uncaptioned. No other exhibits.

#### Practical rules

1. Don't memorise the formula. Know the five inputs and know the machine exists.
2. Read it as a two-way converter: price ⇄ implied volatility.
3. Form your own volatility view, run it through the same model, compare to market. Sell the gap
   when the market is high.
4. Quote and compare options in implied volatility, never in dollars.

#### Predicting Alpha's specific/contrarian opinions

**Refusing to teach the math.** The article names the opposing camp directly — traders who insist
you must know the equation and "recite it to yourself before you go to bed each night" — and
dismisses it. The brokerage does the math and the outputs are on screen. What matters is knowing
the equation exists and that it is the standard model.

**Dollar prices actively mislead.** The strongest argument in the piece. Looking only at option
prices, a penny stock's calls always look "cheaper" than Amazon's, purely because Amazon's share
price is higher, so the dollar cost is certain to be multiples higher. But the penny stock's
options may be implying *higher* volatility, and the dollar lens hides that completely. Converting
to implied volatility standardises everything into an "apples to apples" comparison across tickers.
This is the unit-of-account argument the rest of the course runs on.

The Practical Application takeaway credits the Predicting Alpha Terminal alongside the brokerage as
handling the math. The stated value of knowing the mechanics is confidence in the numbers being
shown to you, not the ability to reproduce them.

#### Notable direct quotes

> "The short answer is no."

> "What is really important is to understand that this equation exists and it's the model most
> commonly used to determine option prices and implied volatility."

> "If the market is overvaluing the option, we want to be selling it!"

---

### Understanding Option Greeks: The Key to Professional Option Selling
*Source: https://www.predictingalpha.com/blogs/understanding-greeks-options*

Sean Ryan · September 24, 2024

#### Core thesis

Options are attractive because they have many dimensions and can express almost any view; the
greeks describe those dimensions. They let you take the risks you want and remove the ones you
don't. Critically: **"Greeks are not an edge. They simply describe our current exposures (risks)."**
And they are dynamic — they change, and "should not be thought of as stagnant."

**Key Takeaways:** (1) greeks tell you what exposures the position carries so you can confirm the
trade expresses your view; (2) delta = price sensitivity, gamma = change in delta, theta = time
decay, vega = volatility sensitivity; (3) apply them via delta-neutral structures, gamma
monitoring, theta capture, vega positioning; (4) mastery is the professional edge.

#### Definitions

**Part 1 — the reframe.** "Risk" here carries no negative connotation. Not "this is risky":

> "When I use the word risk, I am talking about exposure."

Buying stock exposes you to share price — up a dollar, make a dollar. Options offer many exposures,
including ones you may not want. The chain the article walks:

- *"I think that options are expensive"* →
- *"I want exposure to the difference between implied and realized volatility"* →
- position should have **theta and gamma exposure, but maybe not delta.**

**The tools argument.** Stock prices move linearly; options behave more intricately because they
are multidimensional. The analogy: an electrician arrives to wire your house and says he doesn't
know how his hammer and drill work. You'd fire him instantly — "It's an assumption that a
professional knows how their tools work."

#### The four greeks

**1. Delta** — how much the option's price changes for each 1-point move in the underlying. A call
at **0.25 delta (25%)** gains **25 cents** for every dollar the stock gains. Calls positive, puts
negative.

*Delta-one baseline:* trading stock is "delta-one." One share of AAPL = delta 1. **1,000 shares =
delta 1,000** → AAPL up $1 = **+$1,000**.

*Across the chain:* strikes carry different deltas. At **0.30 delta**, the option gains **30 cents**
per dollar move, and instantaneous P&L is **$30** because each contract holds 100 shares. A put at
**−0.70 delta** loses **70 cents** for every dollar the stock gains: **−0.70 × 100 = −$70**.

*The parity relation, as stated:* across the chain **the difference between call delta and put
delta has to equal 1.** At the **$100 strike**, a **0.6 delta** call pairs with a **−0.4 delta**
put, shown as **0.6 − (−0.4) = 1**.

*Delta as probability:* delta is "similar to the probability of an option expiring in the money."
**0.50 delta ≈ 50/50** chance of finishing ITM — which is why OTM options carry low delta and ITM
options high delta.

**2. Theta** — the time value of an option; the loss in value as time passes, **usually expressed
per day.** Buying premium → **negative theta**; selling premium → **positive theta**. Think of it
as rent collected for selling the option — "however, as you will see later, this rent does not come
for free."

*Figure:* a long option at **−0.10 theta** loses about **10 cents per day**, assuming stock price
and volatility are constant.

*The decay law, stated exactly:* theta is non-linear and accelerates into expiration, and "this
rate of decay is proportional to the square root of the time remaining before expiration."

*Theta ↔ gamma:* "Theta is the inverse of gamma. When you buy gamma, you are paying out theta every
single day." The saying: **"One man's theta is another man's gamma."** Then the condition that
matters — theta gains offset gamma losses **if implied volatility is greater than realized
volatility**; if the move is smaller than implied, theta outweighs gamma and being short pays out.

**3. Gamma** — a **second-order derivative**: the unit change in delta for each 1-point change in
the underlying. "It is your sensitivity to the quick movements of the underlying." Long gamma means
any quick move benefits you as the buyer; expecting a big move means wanting more gamma, because a
quick move pays out a lot and no quick move pays nothing. Two stated rules:

- Gamma is **higher the closer to expiration**, lower further out.
- Gamma is **highest at the money**, lower further OTM.

**4. Vega** — the change in option price relative to a change in the option's implied volatility,
**expressed in dollar terms.** **0.25 vega** → the option changes **25 cents** for every
percentage-point change in implied volatility. **Long calls and puts have positive vega; short
calls and puts have negative vega.**

*Worked figure:* an **AAPL $200-strike** option trading at **$10**, vega **1.00**, **IV at 30**. IV
moves **30 → 40**, so vega raises the price by the IV move times the vega: **1.00 × 10 = 10**,
taking the option to **$20**.

Three stated characteristics: vega is **highest at the money**; **vega increases with time**; if
you think uncertainty will increase, **buy the far-dated options** because they are most
vega-sensitive.

> ⚠️ **Flag.** The paragraph preceding those bullets is garbled in the source — it runs two
> sentences together mid-clause and asserts volatility changes have "a lesser impact on the price
> of longer-term options," which contradicts the bullet **"Vega increases with time"** three lines
> below, and contradicts the entire vega article. Trust the bullets.

#### Part 3 — Applying the greeks

**Delta-neutral strategies.** Balance positive and negative delta so the portfolio is relatively
stable regardless of price movement. *Example:* a trader thinks **30-day implied volatility** will
be higher than realised, has no view on direction, and **sells an at-the-money straddle.**
Exposures: **delta neutral · long theta · short gamma · short vega.** Management: **delta hedge
daily** to maintain neutrality as the stock drifts.

**Trading the change in implied volatility.** As the market's opinion changes, the IV level
changes — vega is that exposure, "and as such, it is something you can actually trade!" *Example:*
XYZ releases bad product news, the stock **drops 10%** and stabilises, but implied volatility
**across the term structure has not come down.** You **sell an ATM straddle with 180DTE.**
Exposures: **delta neutral · long theta (very little) · short gamma (very little) · short vega (a
lot).**

The logic: this position won't change much day to day unless IV shifts. Going further out in time
deliberately builds very little exposure to direction and daily movement, and a lot of exposure to
changes in implied volatility.

> **The DTE dial.** Read the two examples together: short-dated straddle = the realised-vs-implied
> trade; long-dated straddle = the IV-level trade. Same structure, different greek.

#### The mastery exercise (the author's own method)

1. Write the idea on paper in plain English — e.g. *"I think implied volatility will be higher than
   realized volatility over the next 10 days, and I don't care which direction the stock trends."*
2. Translate it into greeks — *"Delta neutral, long theta, short gamma, short vega."*
3. List the structures that reasonably give that exposure — *"Short straddles and short strangles
   give me this exposure"* — then pick between them.

#### Tables/charts

Images accompany the linear-vs-non-linear tools argument, the option chain showing per-strike call
deltas, the theta decay curve, the gamma illustration, and the vega illustration. None captioned in
text.

#### Practical rules

1. Greeks describe exposure, never opportunity. They are not a signal.
2. Re-check greeks as the trade moves — they are dynamic.
3. English view → greeks → structure. Never the reverse.
4. Realised-vs-implied view → short-dated. IV-level view → long-dated.
5. Delta hedge daily to hold neutrality on a short straddle.

#### Predicting Alpha's specific/contrarian opinions

- **Greeks are not an edge.** Stated flatly, against a large body of retail content that treats
  high-theta screens or delta thresholds as trade signals.
- **Risk = exposure, not danger.** The refusal of the colloquial meaning is deliberate and frames
  everything after it.
- **The failure mode to fear is structural, not predictive** — being right and not getting paid.

#### Notable direct quotes

> "When I use the word risk, I am talking about exposure."

> "Greeks are not an edge. They simply describe our current exposures (risks)."

> "It's an assumption that a professional knows how their tools work."

> "There is literally nothing worse than being right and not getting paid."

---

### What Does Delta Mean In Options? Controlling Direction When Selling Options
*Source: https://www.predictingalpha.com/blogs/what-does-delta-mean-in-options*

Sean Ryan · September 12, 2024

#### Core thesis

Delta is the exposure the volatility seller is trying to remove. Every option seller has heard of it
but may not fully understand it — and "failing to understand how delta exposure impacts our
positions is going to lead to losses." The governing distinction:

> "volatility is not the same thing as direction."

**Key Takeaways:** (1) delta measures option-price sensitivity to underlying price; calls 0 to 1,
puts −1 to 0; (2) if your only view is implied-vs-realised or the IV level, structure **delta
neutral** so whether the stock goes up or down doesn't touch P&L; (3) the stock will drift while you
hold, delta will change, and you must be prepared to adjust.

#### Definitions

**Delta.** A metric describing the exposure your position gives you — how much the option's price
changes for every dollar change in the underlying's price.

**Delta in stocks.** The easy case. Buy AAPL at **$200**: every dollar up gains a dollar per share,
every dollar down loses a dollar per share. That direct correlation gives stock a **delta of 1.**

#### Formulas and units

- Units: dollars of option price per dollar of underlying.
- Per-contract dollar impact = **delta × 100** (each contract represents 100 shares).
- **Call delta: 0 to 1.** Higher delta = greater sensitivity.
- **Put delta: −1 to 0.** Negative = price moves inversely to the underlying.
- Parity as stated **in this article**: "For any given strike price, the **sum** of the call Delta
  and the put Delta must equal 1."
- Synthetic identity: **"The difference between a call and a put is 100 shares."**

> ⚠️ **Flag — the two articles disagree, and this one is wrong.** The greeks-overview article states
> the **difference** (0.6 − (−0.4) = 1); this article states the **sum**. They can't both hold. Use
> **call delta − put delta = 1**. The article's own synthetic example below confirms the difference
> form.

#### Worked examples with the real figures

**Stock.** 1,000 AAPL shares at $200 → **+$1,000** on a dollar rise, **−$1,000** on a dollar fall.

**Calls, AAPL at $100**, on a move to $101:

| Strike | Delta | Price change | Position impact |
|---|---|---|---|
| 90 Call | 0.60 | +$0.60 | **$60** |
| 100 Call | 0.50 | +$0.50 | **$50** |
| 110 Call | 0.30 | +$0.30 | **$30** |

**Puts, AAPL at $100**, on the same move to $101:

| Strike | Delta | Price change | Position impact |
|---|---|---|---|
| 90 Put | −0.70 | −$0.70 | **$70** |
| 100 Put | −0.50 | −$0.50 | **$50** |
| 110 Put | −0.40 | −$0.40 | **$40** |

> ⚠️ **Flag.** The two tables don't reconcile as a chain. Under **call − put = 1**, only the 100
> strike works; the 90 and 110 strikes do not. Read each table as illustrating sign and magnitude
> ordering, not as a matched pair.

**Seller's perspective.**

- **Sell a call:** you take a **short position in delta.** Selling the 100 call at **0.50 delta**
  leaves you at **−0.50.** For every dollar AAPL rises, the option's price rises **50 cents** —
  potentially a loss for the seller.
- **Sell a put:** you take a **long position in delta.** Selling the 100 put at **−0.50 delta**
  leaves you at **0.50.** For every dollar AAPL rises, the option's price falls **50 cents** —
  potentially a profit for the seller.
- **Sell a straddle:** the exposures combine. Call gives **−0.50**, put gives **0.50**, combined
  **delta of zero.** This is how delta-neutral positions get created, "and this is why straddles are
  such a common way for retail traders to sell volatility."

**The synthetic, worked.** Sell a call (**−0.5 delta**), buy **100 shares** (**+1.00 delta**), and
your new delta is **+0.5** — the delta the put option would have. Your call has literally become a
put. The same happens if you sell a put and short 100 shares. The author's aside: try it in your
brokerage — "When I first understood this, it blew my mind and really helped me to grasp how delta
changes the exposures that you have."

#### The delta-hedging handoff

The primary reason option sellers look at options at all is the **variance risk premium** — "the
idea that implied volatility tends to overstate realized volatility." Without it, "we wouldn't
really be trading options in the first place"; it is the primary reason there are returns to be had
and a business to be built.

Because volatility isn't direction, the seller usually wants a **delta of 0**, so P&L is driven by
the implied-vs-realised difference. An ATM straddle is delta neutral **at inception**, but the stock
starts trending and the trade picks up delta — "What was once our ideal structure is now.. not." The
fix is **delta hedging**: trading more contracts or shares to add or remove delta so the direction
the stock moves no longer impacts P&L. An ongoing process across the life of the trade.

#### Tables/charts

One image accompanies the synthetics section illustrating the call-put delta relationship.

#### Practical rules

1. Read delta as dollars-per-dollar; multiply by 100 per contract for position P&L.
2. Flip the sign when you're the seller: short call = short delta, short put = long delta.
3. Build neutrality by pairing equal and opposite deltas at the same strike.
4. Neutral at entry ≠ neutral later. Drift creates delta; hedge it.
5. Any call converts to a put (and back) with 100 shares.

#### Predicting Alpha's specific/contrarian opinions

- **Delta is noise, not signal.** For a volatility seller it's the unwanted byproduct of the
  instrument, and the whole article builds toward stripping it out.
- **"Volatility is not the same thing as direction."** Aimed squarely at traders who sell puts
  because they're bullish — a directional trade dressed as a volatility trade.
- **Option selling is a business.** The closing frame is explicit: it's your responsibility to
  thoroughly understand the product you trade — "This is your business, so dive deep in the
  knowledge, master the product."

#### Notable direct quotes

> "volatility is not the same thing as direction."

> "The difference between a call and a put is 100 shares."

> "What was once our ideal structure is now.. not."

---

### What is Gamma in Options Selling: Understanding the Rate of Change in Delta
*Source: https://www.predictingalpha.com/blogs/what-is-gamma-options*

Sean Ryan · September 23, 2024

#### Core thesis

Gamma is what the option seller is actually selling. The article opens on **"One man's theta is
another man's gamma"** because it "paints a clear picture of the relationship between how we get
paid as option sellers, and what we are getting paid for." Gamma is "the thing that gets option
buyers paid when there is a big move." The stated purpose of the piece: understand why someone pays
us theta, and what exactly they are receiving.

**Key Takeaways:** (1) gamma measures the rate of change of delta with respect to underlying price,
showing how much delta shifts for a **$1 movement**; (2) high gamma → rapid delta changes →
**significant P&L swings**; (3) gamma is highest **ATM** and increases as expiration approaches —
and gamma "is what the buyer is really paying us for... what makes options a great hedge for some,
and a great lottery ticket for others."

#### Definitions

**Gamma.** The rate at which delta changes as the underlying's price changes. Unlike delta, which
provides a straightforward ratio for a dollar move, gamma is **a second-order measure of how much
delta itself will change.** This matters because "Delta is not a static value; it fluctuates as the
underlying asset's price changes."

**The P&L consequence:** when gamma is high, delta changes quickly — and if delta changes quickly,
the change in P&L due to delta can move quickly too.

**Gamma as curvature.** "Gamma essentially quantifies the curvature in the relationship between the
option's price and the price of the underlying asset."

#### Formulas and units

Units: change in delta per dollar change in the underlying. Gamma **0.04** → delta moves **0.04**
per dollar.

#### Worked example with the real figures

**AAPL at $200**, on a move to **$201**:

| Option | Delta | Delta after +$1 |
|---|---|---|
| 220 Call | 0.30 | **0.34** |
| 200 Call (ATM) | 0.50 | **0.54** |

Made explicit with gamma: a 220 call on AAPL with delta **0.30** and gamma **0.04** sees a dollar
rise in AAPL take delta from **0.30 to 0.34.**

> ⚠️ **Flag.** Both options are shown gaining the same amount of delta, which sits awkwardly against
> the article's own rule that gamma is highest ATM — the 200 call should gain more than the 220
> call. The source hedges with "might increase," so treat the figures as demonstrating the mechanic
> (delta moves by gamma), not the moneyness profile.

#### Gamma drives the variance risk premium

The section answers the question the article says sellers must be able to answer: **"Why are we
getting paid?"**

If you want a **hedge**, you want something that increases rapidly in value when there is a big
move. It's the same thing if you want a **lottery ticket**. Both buyers want the same thing. So:

> "Gamma is really what gives options the convexity that so many market participants look for. It's
> the reason that there is high demand, and as such, it's the reason that the variance risk premium
> exists."

#### The behaviour laws

| Axis | Behaviour |
|---|---|
| **ATM** | Gamma is **highest** — small underlying moves significantly affect whether the option is ITM or OTM |
| **Deep OTM / deep ITM** | Gamma is **lower** — less sensitive to small price changes because their probabilities of expiring ITM or OTM are already skewed |
| **Time to expiration** | The closer to expiry, the **higher** the gamma; longer-dated options have **lower** gamma |
| **IV level** | **Not addressed in this article** |

#### The cost of being long gamma

Retail traders and many institutions buy options because it "drives exponential returns as the rate
of change in the underlying stock price increases." That doesn't come without a cost, and the cost
is **theta**. When long gamma you benefit from rapid price movements but incur a theta cost — the
daily erosion of the option's value as it approaches expiration.

The section then points readers to a separate article on how gamma, theta and vega relate, and "how
volatility is actually synthetically the same as time." *(Not followed — assigned elsewhere.)*

#### Conclusion — the P&L identity in plain English

The most useful passage in the module for a seller: most option selling strategies trade the spread
between implied and realised volatility, betting that market-set implied on average outpaces
realised over the same period. And:

> "This is the 'plain english' way of saying that we believe our theta gains will outweigh our gamma
> losses."

| Volatility language | Greek language |
|---|---|
| Implied > realised | Theta gains > gamma losses |
| Implied < realised | Gamma losses > theta gains |

No algebraic form is given anywhere — the decomposition is qualitative only.

#### Tables/charts

Images accompany the delta-revisited example, the ATM/OTM/ITM gamma profile, and the
time-to-expiration section. None captioned in text.

#### Practical rules

1. Know why you get paid: you're selling convexity to hedgers and lottery-ticket buyers.
2. Gamma peaks ATM and near expiry — the most dangerous spot for a short position and the richest
   theta. Same fact.
3. You cannot collect theta without carrying gamma.
4. Judge the trade on implied vs realised, because that *is* the theta-vs-gamma ledger.

#### Predicting Alpha's specific/contrarian opinions

- **Gamma, not theta, is the product.** Most retail material frames selling as "collecting theta."
  This inverts it: theta is merely the price paid for gamma, and gamma is what you're short. Price
  the gamma, don't maximise the theta.
- **The variance risk premium has a demand-side cause** — hedgers and speculators both structurally
  want convexity and will pay for it. A durable reason for the premium to persist, not an
  unexplained anomaly.

#### Notable direct quotes

> "One man's theta is another man's gamma."

> "When we sell options, gamma is what the buyer is really paying us for."

> "Why are we getting paid?"

> "We need to understand the relationship between theta and gamma if we want to be profitable option
> sellers. It's the foundation of why we get paid."

---

### What is Theta In Option Selling: The Cost of Holding an Option Over Time
*Source: https://www.predictingalpha.com/blogs/what-is-theta-options*

Sean Ryan · September 14, 2024

#### Core thesis

Theta is the greek most option sellers are familiar with, because it tells them how much they get
paid each day. The article's job is to stop you reading that as profit. Its headline claim gets its
own Key Takeaway:

> **"Theta is Not Free Money:** The reason someone is paying you theta is for access to gamma. There
> is no free money in the market and we should only be selling options when we believe the theta
> gains will outweigh the gamma losses."

#### Definitions

**Theta.** The daily loss in an option's value due to the passage of time, **assuming all other
factors remain constant.** Unlike delta, theta deals **solely** with the impact of time on the
option's price.

**Time decay.** Theta quantifies it, reflecting how the probability of a significant price movement
diminishes **as the expiration date approaches or as implied volatility decreases.**

> That second clause is the article's only link between theta and the **IV level** — falling IV and
> falling time do the same job to an option.

**Theta as rent.** The rent the option buyer pays for holding an option. Buyer pays, seller
collects. In exchange the seller gives access to a "property" — which in options is **gamma**.

#### Formulas and units

- Units: **dollars per day**, holding underlying price and IV constant.
- Sign: **negative** for the long holder, **positive** for the seller.
- The acceleration mechanism: at expiration, if the option has no intrinsic value, theta must decay
  it to zero — so on the last day theta decay is **100% of the extrinsic value.**

#### Worked examples with the real figures

**Example 1 — time decay.** Buy a **$10** call option on AAPL, **30 days** until expiration,
underlying price and implied volatility constant:

| Day | Option price | Theta |
|---|---|---|
| Day 0 | $10 | — |
| Day 1 | $9.50 | −$0.50 |
| Day 2 | $9.00 | −$0.50 |
| … | … | … |
| Expiration | $0 (if OTM) | — |

> ⚠️ **Flag.** A flat −$0.50 per day from $10 reaches zero in 20 days, not 30, and constant daily
> decay is linear — the opposite of the acceleration the article teaches elsewhere. The source's own
> "…" marks this as schematic. Take the mechanic, not the path.

**Example 2 — why theta exists.** A **SHOP** call with **30 days** until expiration has a
significant chance of a large price movement in that period; as expiration nears, the likelihood
diminishes and so does the option's value. The principle: "The value of an option contract today is
less than it is on expiration day (assuming we hold all variables the same)."

**Example 3 — decay near expiration.** The quantified comparison:

| DTE | Theta | As % of the option's value |
|---|---|---|
| **30 days** | $0.50/day | **3%** |
| **10 days** | $0.50/day | **10%** |

Stated alongside: on the last day theta decay is **100% of the extrinsic value**, but at 30 days to
expiration "it might just be 3% of the extrinsic value."

**Example 4 — reading the chain.** **AAPL $100 Call, 30 days to expiration: Theta = −0.05.** The
option loses **5 cents** in value each day. Priced at **$4.00** today, it's **$3.95** tomorrow,
assuming no other changes.

#### The relationship between theta and gamma

Theta and gamma are **inversely related.** Buying an option (long gamma) means paying for the
potential of quick and substantial price movements, and that payment comes as theta. Selling (short
gamma) means collecting theta every day, as long as the underlying doesn't experience significant
price movements.

The load-bearing sentence:

> "The amount of theta you collect is directly proportional to the amount of gamma exposure you
> carry."

The rent analogy carries its own rule: "the bigger the house, the more the rent costs. As such, the
more the gamma, the higher the 'rent' too." And the hard constraint — "If you want to collect large
amounts of theta, then you are going to be providing access to large amount of gamma. There is no
way around it."

That kills the most common retail search: high theta with low risk does not exist by construction.

#### Numbers, thresholds & rules of thumb

30 DTE ≈ **3%** of value per day · 10 DTE ≈ **10%** per day · last day = **100%** of extrinsic ·
chain example **−0.05/day on $4.00** · decay example **−$0.50/day on $10** · long option at
**−0.10 theta** ≈ 10 cents/day (from the greeks overview).

#### Tables/charts

One image sits under "What is Theta?"; not captioned in text.

#### Practical rules

1. Never evaluate theta alone — evaluate the theta/gamma pair.
2. Short-dated options decay fastest as a percentage, which the article grants is appealing to some
   traders, but they're "more sensitive to sudden price movements in the underlying asset."
3. Sell only when you believe theta gains exceed gamma losses — i.e. implied exceeds realised.
4. Read theta off the chain as dollars per day, then sanity-check it against the option's price.

#### Predicting Alpha's specific/contrarian opinions

- **"Theta is Not Free Money"** is promoted to a Key Takeaway heading — a direct shot at content
  that markets premium selling as passive income.
- **Theta and gamma are directly proportional.** Not merely related. If true, no structure pays you
  more without exposing you more, and every "high yield, low risk" option-selling pitch is either
  mispriced or misunderstood.
- The seller is a **landlord**, not a harvester of decay. Rent scales with what you rented out.

#### Notable direct quotes

> "There is no free money in the market and we should only be selling options when we believe the
> theta gains will outweigh the gamma losses."

> "The amount of theta you collect is directly proportional to the amount of gamma exposure you
> carry."

> "If you want to collect large amounts of theta, then you are going to be providing access to large
> amount of gamma. There is no way around it."

---

### What is Vega in Options? Understanding Sensitivity to Changes in Implied Volatility
*Source: https://www.predictingalpha.com/blogs/what-is-vega-options*

Sean Ryan · September 23, 2024

#### Core thesis

Vega separates an opinion about *daily movement* from an opinion about *the future*, and days to
expiration is the dial that selects which one you're trading. Short-dated P&L is driven by the day
to day movement of the stock; long-dated P&L is driven by changes in perception of how much it will
move.

**Key Takeaways:** (1) vega measures sensitivity to changes in implied volatility — **when you sell
options you are short vega**, so if IV decreases you make money and if IV increases you lose money;
(2) vega is **highest for at-the-money options** and **increases with time to expiration**, making
**long-term ATM options the most sensitive** to volatility changes; (3) longer-dated P&L is
influenced more by changes in perception about the future, shorter-dated P&L more by day-to-day
movement.

#### Definitions

**Vega.** The amount by which an option's price changes in response to a **1% change in the implied
volatility** of the underlying. It quantifies your exposure to fluctuations in market uncertainty.

**Implied volatility's role.** IV reflects the market's expectations for future volatility. IV up →
the market anticipates greater price fluctuations → **higher option premiums.** IV down → lower
expected price movements → **lower premiums.**

#### Formulas and units

- Units: dollars per **1 percentage point** of implied volatility.
- Change in option price = **vega × change in IV.**
- Sign: long options **positive vega** (calls and puts alike); **selling makes you short vega.**

#### Worked example with the real figures

**AAPL trading at $200**, the **200 call** with **vega 1.0**. IV is currently **30%**; the market
suddenly anticipates a terrible quarter for Apple and IV **spikes to 40%**:

- Change in implied volatility: **40% − 30% = 10%**
- Change in option price: **vega (1.0) × change in IV (10%) = $10**
- Bought at **$15** → new price **$15 + $10 = $25**, reflecting the increased market uncertainty.

> [context, not from article] The greeks-overview article runs the identical mechanic (vega 1.00,
> IV 30 to 40, +$10) off a $10 starting premium, reaching $20. Same arithmetic, different entry
> price.

#### Vega's characteristics

**1. Highest at the money.** Options whose strikes are closest to the current underlying price have
the highest sensitivity to changes in implied volatility.

**2. Increases with time.** Stated as an explicit contrast: **"Unlike Gamma and Theta, which
decrease with time, Vega increases with the time to expiration."** Long-dated options have higher
vega than short-dated ones.

Combined: **the maximum-vega option in a chain is the long-dated ATM option.**

| Axis | Vega | Gamma | Theta |
|---|---|---|---|
| Moneyness | Peaks ATM | Peaks ATM | — |
| Time to expiration | **Rises** with DTE | **Falls** with DTE | **Falls** with DTE |

That inversion on the DTE axis is the strategic content of the article: **DTE trades gamma/theta
against vega.**

#### The two strategy scenarios

**Scenario 1 — short-term, realised vs implied.** Your view is the stock will **move less than
implied over the next 10 days.** Then "your vega exposure does not matter very much." What you want
is maximum exposure to the *difference* between implied and realised — so structure for **theta and
gamma**. Example: **sell an at-the-money straddle with 10 days to expiration.**

**Scenario 2 — the IV level is too high.** There's been panic, and the market is implying the stock
will see massive swings **for the next 6 months.** You think the market will become more rational
and the level will come down. Here you want to **maximise exposure to the level of implied
volatility and minimise exposure to today's implied vs realised.** Example: **sell an at-the-money
180 DTE straddle**, because it has "the most vega and least gamma/theta exposure."

The supporting term-structure chart shows **every single expiration** with elevated implied
volatility, "pushing close to the highest we have seen." The stated read: in situations like this,
the opportunity is in the **further-dated expirations.**

#### Tables/charts

A vega-vs-expiration chart, described in text as showing vega starting **low for short-term
options** and increasing **significantly for long-term options**; two further images in that
section; and the term-structure chart in the strategy section.

#### Numbers, thresholds & rules of thumb

Vega **1.0** = $1 per vol point · **0.25** vega = 25 cents per vol point (greeks overview) · IV
**30 → 40** = **$10** on a 1.0-vega option · short-dated example **10 DTE** · long-dated example
**180 DTE** · panic horizon **6 months**.

#### Practical rules

1. Selling options always makes you short vega — know it whether you wanted it or not.
2. Realised-vs-implied view → short-dated; vega barely matters there.
3. IV-level view → long-dated ATM; maximum vega, minimum daily noise.
4. Expect uncertainty to rise → buy far-dated options.
5. Check the whole term structure before a level trade. Every expiration elevated near historic
   highs points to the long end.

#### Predicting Alpha's specific/contrarian opinions

- **Vega is tradeable in its own right**, not just a risk to manage — the greeks overview states it
  with an exclamation mark.
- **The strongest personal claim in the module:**

  > "Some of the best trades I've ever taken have been vega oriented."

  Notable in a course about *selling* options, where retail focus sits almost entirely on
  short-dated theta harvesting. The author is saying his best trades came from the long end, from
  being right about the *level* of implied volatility.

#### Notable direct quotes

> "Some of the best trades I've ever taken have been vega oriented."

> "Unlike Gamma and Theta, which decrease with time, Vega increases with the time to expiration."

> "you want to maximize your exposure to the level of implied volatility and actually minimize your
> exposure to today's implied VS realized volatility."

---

### Mastering Delta Hedging: A Comprehensive Guide for Option Sellers
*Source: https://www.predictingalpha.com/blogs/delta-hedging*

Sean Ryan · August 23, 2024

#### Core thesis

Delta hedging is noise removal. The seller is trying to monetise the implied-vs-realised difference,
"and delta is noise that can get in the way of us doing this successfully."

> "Its entire purpose is to remove the noise that is introduced to our trade through delta."

Its most liberating claim: you don't need to do this well, you need to do it consistently — either
of two simple rules captures **90% of the value.**

**Key Takeaways:** (1) hedging keeps the position directionally neutral while maintaining exposure
to **theta, gamma and vega** — "the things we actually want to trade"; (2) the article covers
interpreting delta exposure and adjusting it through buying and selling shares; (3) **daily hedging
and threshold hedging** are the two common retail approaches, balancing frequency with transaction
costs.

#### Why delta hedge?

Sellers monetise implied vs realised, typically have no view on direction, and "definitely don't
want direction to play a big role in our PnL." So trades start **delta neutral**: ATM straddles, or
strangles where the call and put legs have the same delta, so the deltas cancel out and the overall
position ends with a delta of zero.

But stocks don't stay in the same place. What used to be at-the-money is now above or below spot,
and what used to be delta neutral will now make or lose money depending on direction.

**The variance-swap framing** — the sharpest idea in the article. Professional traders would use a
**variance swap**, "a financial instrument whose PnL is literally the difference between implied and
realized volatility." Retail can't trade those, so it uses options to accomplish the same goal, with
one difference: "we need to take care of that pesky delta exposure that comes with using options."

> Delta is not a feature of the strategy. It's contamination from the proxy instrument you were
> forced to use, and hedging converts the proxy back into the exposure you wanted.

#### How it works, generally

- Stock trends **up**, position goes **negative delta** (makes money if the stock goes down) → **buy
  shares** to neutralise.
- Stock goes **down**, position goes **positive delta** (makes money if the stock goes up) → **short
  shares**, or close out longs already bought.

On perfection: as retail traders "it's not going to be perfect," but one of the approaches below
gets close enough "that the noise from delta becomes irrelevant over a large number of trades." The
errors are random and wash out; only the volatility spread is systematic.

#### Formulas and units — the interpretation rule

Owning AAPL shares gives a **delta of 1**: a dollar rise means a dollar rise in position value.
**1,000 shares** → a dollar rise translates to **$1,000.**

On the chain, delta is expressed **between −1 and 1**. Delta of **1** is equivalent to holding
shares; **−1** to holding short shares.

**The stated formula:** multiply delta **× the number of lots you have open × 100.** That is how
much delta exposure your option position has.

> This resolves the notation in the example below: "−0.2 delta" is the per-contract figure, and
> ×1 lot ×100 gives **−20 position deltas** — hence $20 per dollar move, hedged with 20 shares. When
> you trade, work in position deltas.

#### Worked example with the real figures

The framing: "You adjust the balance of the shares you have to act as a counterweight to your delta
exposure."

**Step 1.** One short straddle on **XYZ**, after a couple of days at **−0.2 delta.** For every
dollar the stock decreases, the position increases by **$20**; for every dollar it increases, the
position decreases by **$20.** Hedge by purchasing **20 shares**, adding 0.2 delta:

| Leg | Delta |
|---|---|
| Option position | −0.2 |
| Shares | 0.2 |
| **Overall** | **0** |

**Step 2 — the teaching trap.** The stock continues to rally and the option position is now **−0.4
delta.** How many shares now? *"If you said 40, you would be wrong. Why? You forgot that we are
already holding 20 shares!"* You're currently at **−0.2** overall, so you buy **another 20 shares** —
not 40:

| Leg | Delta |
|---|---|
| Option position | −0.4 |
| Shares | 0.4 |
| **Overall** | **0** |

**Second example.** Sell a straddle on Apple, currently trading at **$200** — a call and a put with
the same strike and expiration. Selling the **200 strike straddle** leaves you initially delta
neutral, "not influenced by small movements in Apple's stock price." When Apple's price increases to
**$210**, the position becomes **short delta**: further increases will result in losses, so you
adjust.

**Adjusting.** When short delta, hedge by buying shares. Stated instance: if your delta is **−50**,
you buy **50 shares** of Apple, counteracting the negative delta and making the position delta
neutral again. "Delta hedging is a continuous process."

#### How often to hedge

Hedging every single delta would technically be the most delta-neutral approach, but it carries two
costs:

1. **Financial costs** — every hedge costs money, "at least a couple pennies when you cross the
   bid/ask spread. This adds up, and as good traders we care about our overhead."
2. **Time costs** — "You didn't become a trader to spend your life hedging deltas."

**Approach 1 — fixed schedule.** Called "a really common approach." As simple as *"I hedge my deltas
once every day at market close"* or *"at market open and market close."* At whatever interval you
set, adjust the number of shares to bring overall delta back to **zero**, then go away until next
time.

**Approach 2 — threshold breach.** You accept a certain degree of noise and variance from delta:
*"I am comfortable carrying +/- 30 delta on this trade."* **There are no fixed rules for what the
threshold needs to be** — pick the exposure you're comfortable with, and hedge back to zero when the
position breaches it.

**The 90% claim.** "Picking when to delta hedge does not need to be any more complicated than this."
Other techniques may yield slightly better results, but you'll be fine with either approach. The
author isn't discouraging exploration, just saying it isn't necessary at this stage, because you're
"already receiving 90% of the value that delta hedging aims to bring you."

#### Practical considerations

1. **Transaction costs** — frequent hedging can lead to significant transaction costs, "especially
   for small accounts." Balance the benefits against the costs of frequent trading.
2. **Slippage** — in volatile markets the price at which you execute your hedge may differ from the
   market price.
3. **Risk tolerance** — risk tolerance and account size influence the decision. "Larger accounts can
   absorb more significant price movements, while smaller accounts might need more frequent
   adjustments."

No numbers attach to any of the three — no slippage percentages, no cost magnitudes, no account-size
thresholds.

#### Numbers, thresholds & rules of thumb — complete list

Deltas used: **−0.2, −0.4, −50** · share hedges: **20, then 20 more, 50** · P&L: **$20** per dollar
move · prices: Apple **$200 → $210**, **1,000 shares** for the delta-one illustration · tolerance
example: **+/− 30 delta** · value capture: **90%** · minimum hedge cost: **"a couple pennies"** ·
schedules: **daily at close**, or **open and close**.

#### On the P&L equation

The article gives **no algebraic P&L decomposition** — no gamma-theta integral, no
realised-vs-implied variance formula. The module's version of that identity is qualitative and lives
in the gamma and greeks-overview articles ("theta gains will outweigh our gamma losses", conditional
on implied > realised). This article supplies the operational half: hedging is what makes that
decomposition hold, because otherwise the delta term swamps it.

#### Tables/charts

Images accompany the drift illustration in "Why Delta Hedge?", the Apple straddle example, and the
continuous-hedging section. None captioned in text.

#### Practical rules

1. Enter delta neutral — ATM straddle or strangle with legs that cancel.
2. Pick **one** rule, schedule or threshold, and stick to it.
3. Hedge back to **zero** when you act, under either method.
4. Don't hedge continuously — the costs are real and the marginal benefit past 90% isn't worth it.
5. Work in position deltas (shares-equivalent), not raw per-contract decimals.
6. Small account → costs bite harder → the threshold method cuts trade count.
7. Accept imperfection; it washes out over many trades.

#### Predicting Alpha's specific/contrarian opinions

- **"Good enough" hedging is the correct target.** The 90% claim is an explicit rejection of
  optimisation, against a literature that treats hedge frequency as a problem to solve.
- **Options are a proxy** for the variance swap you actually want.
- **Practice over theory.** The article ends by pushing you off the page.

#### Notable direct quotes

> "Its entire purpose is to remove the noise that is introduced to our trade through delta."

> "You didn't become a trader to spend your life hedging deltas."

> "If you said 40, you would be wrong. Why? You forgot that we are already holding 20 shares!"

> "you are already receiving 90% of the value that delta hedging aims to bring you."

> "You will learn much more from putting on a short straddle and delta hedging than you did from
> reading this article."

---

## Module 4 — consolidated reference

| Greek | Measures | Units | Long | Short | Moneyness | vs DTE |
|---|---|---|---|---|---|---|
| **Delta** | Price change per dollar in underlying | $ per $1 | Call **+** (0→1), Put **−** (−1→0) | flipped | rises toward ITM | — |
| **Gamma** | Change in delta per dollar | Δdelta per $1 | **+** | **−** | **peaks ATM** | **rises** into expiry |
| **Theta** | Value lost per day | $ per day | **−** | **+** | — | per-day burn **accelerates** into expiry; ∝ √(time remaining) |
| **Vega** | Price change per vol point | $ per 1% IV | **+** (calls and puts) | **−** | **peaks ATM** | **rises** with DTE |

**Second-order coverage.** Gamma is covered in full. The gamma/theta trade-off is stated
qualitatively and repeatedly — inversely related, directly proportional, theta beats gamma iff
implied exceeds realised — but **no numeric ratio is given anywhere.** **Vanna, charm and volga are
never mentioned** in any of the seven articles. Gamma scalping and pin risk are absent too.

**The throughline.** Black-Scholes converts price ⇄ vol, so quote in vol. Greeks are exposures, not
edge: English view → greeks → structure. Delta is the exposure you don't want. Gamma is the product
you're selling and the source of the variance risk premium. Theta is rent, priced directly
proportional to the gamma rented out. Vega is the level trade, and DTE is the dial. Delta hedging
keeps the whole thing about volatility.

**Conflicts flagged in the source.** The put-call parity relation is stated as a *sum* in the delta
article and a *difference* in the greeks overview — the difference form is correct. The delta
article's call and put tables don't reconcile except at the middle strike. The gamma article shows
an ATM and an OTM call gaining identical delta, against its own "gamma peaks ATM" rule. The greeks
overview's vega paragraph is garbled and contradicts its own next bullet on vega vs time. The theta
article's decay table is linear and reaches zero early.

## Module 5 — Option Selling Structures

*Built from the local full-text corpus (`pa-text/`). Every number, formula and quote below appears in the source article. Where an article does not state a max profit, max loss, breakeven, delta target, wing width or margin figure, that absence is recorded as an absence — nothing is completed from outside the text. The corpus is plain-text extraction, so hyperlink URLs are not recoverable; anchor phrases are noted where they carry meaning.*

---

### Structures Used In Option Selling Strategies: Long and Short Straddles
*Source: https://www.predictingalpha.com/blogs/option-selling-strategies*

Sean Ryan · September 25, 2024

#### Core thesis

There are two fundamental opinions a trader can express on the market: long volatility and short volatility. Both are opinions about the same thing — the gap between implied and realized volatility. Long vol says realized will come in above implied. Short vol says implied will come in above realized.

Retail traders have no direct way to buy and sell volatility. The options market is the vehicle, and that is what the majority of profitable option sellers use it for. The article's job is to answer the question that comes *after* you have formed a view: what do you actually do about it?

The second half is a rant with a point — the structure is not the reason you get paid.

#### Construction

**Long straddle:** buy both a call and a put at the same strike price and expiration date.
Example — Apple trading at $200 per share: buy a $200 call and buy a $200 put.

**Short straddle:** sell both a call and a put at the same strike price and expiration date.
Example — Apple trading at $200 per share: sell a $200 call and sell a $200 put.

The article notes in passing that two other commonly used structures are strangles and iron butterflies. It does not construct them here.

#### Payoff math

**No formulas are given in this article.** No breakevens, no max profit, no max loss, no premium figures. "Break even price" is referenced as a boundary but never computed. The payoff appears only as three outcome bullets per structure:

Long straddle — Apple rises to $220 (outside of break even price): the call gains significant value and you make money. Apple drops to $180 (outside of break even price): the put gains significant value and you make money. Apple stays around $200 (inside of break even prices): you lose the premium paid.

Short straddle — Apple stays around $200 (inside the breakevens): you keep the premium received. Apple rises to $220 or drops to $180 (outside the breakevens): you incur losses as the options gain value for the buyer.

One nuance in the framing worth keeping: the long straddle profits from moves in either direction **greater than implied by the market** — not simply from large moves.

#### Greek profile

Not given. The only greek reference is a pointer: the short straddle "gives you the exact exposures you want in order to express a short volatility view (see greeks for more information)."

#### Definitions

- **Long volatility** — you think realized volatility will be higher than implied volatility; volatility is cheap and you want to buy it.
- **Short volatility** — you think implied volatility will be higher than realized volatility; volatility is expensive and you want to sell it.
- **Long straddle** — buying a call and a put at the same strike and expiration.
- **Short straddle** — selling a call and a put at the same strike and expiration.

#### Numbers, thresholds & rules of thumb

The only numbers are the illustrative Apple prices: $200 spot, $200 strike on both legs, $220 upside test, $180 downside test. No delta targets, no DTE windows, no IV thresholds, no sizing rules. This is a framing article.

#### Tables/charts

Four images sit in the body. Two are P&L graphs, each introduced by "The profit and loss (P&L) graph for this strategy looks like this" — one long straddle, one short. The article does not describe either shape in prose. A third accompanies the long/short volatility definitions, a fourth the electrician rant. None are captioned.

#### When to use / when not to

**Long straddle** — ideal when you expect increased volatility but are unsure of the direction.

**Short straddle** — ideal when you expect low volatility and minimal price movement.

Selection follows from which side of the implied-versus-realized comparison you land on, not from a preference for a structure.

#### Practical rules

- Once you know whether you want to be long or short volatility, place a trade that properly expresses that view. Taking a view on volatility is "hitting a nail" and the straddle is the "hammer."
- Go and try it, even on a paper account. Placing a trade and watching the P&L move "is going to be a huge help and teach you way more than any article ever could."
- Learn delta hedging alongside it.
- Test your understanding by describing the strategy in non-options terms.

#### Predicting Alpha's specific/contrarian opinions

- Traders who say "my strategy is selling straddles" or "my strategy is short puts" are making a category error. Change the context to any other career and the absurdity is obvious — yet in trading it is what is expected.
- You do not get paid because of the structure you trade. You get paid for providing value to the market that the person on the other side is willing to compensate you for. Three named examples: providing protection against large moves around earnings events; holding the risk that equities experience a large drop in value; providing liquidity on tickers where no one is willing to be on the sell side of options.
- Most profitable option portfolios are short volatility because of the variance risk premium.
- The short straddle is "pretty much the most common trade placed by option sellers."

#### Notable direct quotes

> "Saying something like this is the equivalent of an electrician saying 'I make money because hammer' or 'I get paid because screwdriver'."

> "I go on a rant about how straddles are just the tool you use to complete the job, and not the reason you get paid. You get paid for having good ideas."

> "If you can't clearly articulate it in 'non options' terms, then you may not have a clear enough grasp on your strategy to really scale it up."

---

### What is a Short Straddle? A Comprehensive Guide for Option Sellers
*Source: https://www.predictingalpha.com/blogs/what-is-a-short-straddle*

Sean Ryan · August 24, 2024

#### Core thesis

The straddle is the most commonly used tool by professional option sellers. It is how you tell the market you think implied volatility is going to be higher than realized volatility, and ask to be paid if you are right.

The article's centre of gravity is not the payoff. It is two things the payoff does not show. First, *why* the straddle is the right instrument — its price is the implied move range, which makes it the cleanest available claim on the variance risk premium. Second, how to keep a structure with an occasional enormous loser from ending your trading career.

#### Construction

Sell both a call and a put on the same stock, same strike price, same expiration date. Typically executed at the money, meaning the strike is close to the current trading price of the underlying.

Example — Apple (AAPL) trading at $200: sell the $200 call and the $200 put with the same expiration date, e.g. July 17th.

This creates an upside down V-shaped payoff diagram where the point of the V is at the strike price of the options.

#### Payoff math

**Breakevens are the only formulas given, and they are given explicitly:**

- Call break-even = Strike Price + Total Premium Received
- Put break-even = Strike Price − Total Premium Received

**Worked example:**
- Call premium: $4
- Put premium: $5
- Total premium received: $9
- Upper break-even: $209 ($200 + $9)
- Lower break-even: $191 ($200 − $9)

**Maximum profit** is limited to the total premium received for both options.

**Maximum loss** is not given as a formula or a figure. The language is that if things go wrong "you could take an exponentially greater loss." The article does not use the word unlimited here and does not compute a worst case. This is the nature of a short volatility strategy: many small winners, and the occasional big loser.

#### The straddle as the implied move range

The article's most important structural claim, and easy to read past. The price of the straddle represents the implied move range for a stock over a given time period. **Assuming you delta hedge the position, the difference between the price you sold the straddle for and the average intrinsic value at expiration should be the variance risk premium for the position.**

That is the entire justification for preferring this structure: it is the retail trader's most direct claim on the premium.

#### Greek profile

Not given. Time decay is named as the source of the majority of profits and delta hedging is assumed throughout, but no delta, gamma, theta or vega values or signs appear.

#### Definitions

- **Straddle** — selling a call and a put on the same stock, same strike, same expiration; typically at the money.
- **Implied move range** — what the straddle's price represents over the period to expiration.
- **Stop loss (as used here)** — not a % or $ level, but stopping out when a catastrophic-level event occurs.

#### Numbers, thresholds & rules of thumb

- **Trade setup example:** implied move 10%, actual move 7%. The options market is overestimating the potential movement, making it a profitable opportunity to sell a straddle.
- **Sizing via stress test:** use the trade analysis tab in your brokerage and stress the position. If the loss exceeds **10% of your account** for a single position, you are probably sized too big. Stress to "a very unlikely scenario, such as **3-4 times bigger than the implied move**."
- **Sizing via margin:** if the margin requirement for a single position is greater than **10-15% of your portfolio**, you are "definitely too big for most trades."
- **Stop-loss trigger:** if implied volatility shoots up to the highest level seen in the last year — IV percentile is the suggested measure — close the trade. The author also does not trade things already in their highest IV percentiles.
- **Practice trade:** sell a **30 DTE straddle on SPY**, try delta hedging it, see if you can extract the premium.
- No delta targets. The only strike guidance is "at the money."

#### Tables/charts

One image follows the construction example. The prose describes it: an upside down V with the point at the strike.

#### When to use / when not to

Straddles are the trade you place when you think implied volatility will outpace realized volatility **and** you do not have a view on what direction the stock will trend. Both conditions matter.

Do not trade into the highest IV percentiles, and close out if you get there. The reasoning is specifically not that the edge disappears — the variance risk premium is still present. It is that profit/loss variance is at its highest, so "if there were going to be a time where you risk blowing up, it's here." Since the premium is not going anywhere, there is no obligation to trade through those periods.

#### Practical rules

Three risk-management methods, in the article's order:

1. **Sizing.** Trade a small enough amount of capital in a single position that the worst case is "just big enough that the trade is meaningful, but just small enough that it does stop or discourage you from continuing to trade." Verify two ways — the stress test and the margin requirement.
2. **Diversification.** In the ETF strategy, trade a complete basket of ETFs where each represents a different sector, industry or region. The point is to reduce concentration to any one factor besides the variance risk premium itself, giving a cleaner exposure to the premium and reducing dependence on any one asset's performance.
3. **Stop losses.** Do not set a % or $ stop — these "aren't really effective in the world of volatility trading because you may still want to stay in the position even if you are currently losing money." Stop out on catastrophic events instead. Close when things get ugly and reopen when they calm down, or go find something else.

#### Predicting Alpha's specific/contrarian opinions

- Percentage and dollar stop-losses are the wrong instrument for volatility trading. The trade may still be a good trade while it is losing money.
- Member onboarding education includes "letting go of the idea that you can time things, embracing the variance, and trying to trade based on strong principles."
- It is hard to find robust strategies that actually make money, which is why Predicting Alpha focuses on only two: selling volatility on ETFs, and selling volatility around earnings events — both using straddles and/or strangles.
- Fear of the structure is a knowledge problem, not a risk assessment.

#### Notable direct quotes

> "It's the way we say to the market 'Hey buddy, I think implied volatility is going to be higher than realized volatility. Pay me if I am right.'"

> "If you need to hit a nail, use a hammer. I guess you could use the back of a screwdriver.. But why would you when you could just use a hammer"

> "the thing that gets you paid in the end of the day is not the straddle. It's the idea that you are trading."

> "If they scare you, then you just don't understand them well enough. They are one of the most valuable structures that we have the ability to trade. It's your hammer to the market's nail."

---

### Straddle VS Strangles: Which is Better For Option Sellers?
*Source: https://www.predictingalpha.com/blogs/straddle-vs-strangle-options*

Sean Ryan · August 18, 2024

#### Core thesis

The straddle-versus-strangle debate is mostly a misconception. Neither choice materially changes expected value — it only changes which variables in the equation you adjust. The real deciding factors lie elsewhere: the straddle gives honest feedback, the strangle gives cheaper execution. Which you should trade depends on where you are in your development, not on which has the higher probability of profit.

#### Construction

Stock trading at $100:
- **Straddle** — sell the $100 call and the $100 put (at-the-money strikes).
- **Strangle** — sell (for example) the $90 put and the $110 call (out-the-money strikes).

A strangle is the same structure as a straddle except you trade out-the-money strikes instead of at-the-money strikes.

#### Payoff math

**No formulas, no breakevens, no max profit or max loss are given.** The trade-off is stated qualitatively.

The strangle is "wider" — a greater chance the stock price stays between the strikes. That wider breakeven does not come for free, "and this is often what traders forget." In exchange you collect less premium, so when you have a winner you make less money. And the losses you take can be higher, since a move outside the breakevens can be large relative to the premium collected.

**The expected-value demonstration** uses two simulations, presented as images with these inputs:

| | Example 1: Straddle | Example 2: Strangle |
|---|---|---|
| Bet | $10 | $10 |
| Probability of winning | 60% (0.6) | 80% (0.8) |
| Risk/Reward | 1:1 | 1:0.5 |

The stated result: in example 2 the probability of profit increased but the amount you win decreased, with no material impact on expected value. The article does not print the resulting EV number in the text — it sits inside the images.

#### Greek profile

Not given numerically. The article asserts the two structures "actually provide us with the same exposures" and supports it with an image placed after that line. No signs or magnitudes appear in the text. The argument built on it: "Why should one tool be better than another tool if they give us the same exposures to the market?"

#### Definitions

- **Strangle** — a structure similar to a straddle, except trading out-the-money strikes rather than at-the-money strikes.
- **Width** — the distance between breakevens; the source of the strangle's higher probability of profit and lower premium.

#### Numbers, thresholds & rules of thumb

- Reference spot $100; straddle at $100/$100; strangle at $90 put / $110 call.
- EV simulation inputs: $10 bet, 60% at 1:1 versus $10 bet, 80% at 1:0.5.
- **The author's own position: delta 20 strangles that expire weekly**, in the ETF Premium strategy run with Predicting Alpha members. Presented as personal practice with a stated reason, not as a general rule.
- No general delta targets, IV levels, skew shapes or term-structure conditions are used to choose between the structures.

#### When to use / when not to

**Choose the straddle** because the width of the straddle is equivalent to the implied move for the ticker being analyzed. Since the majority of trades are based on the difference between implied and realized volatility, you want your P&L to reflect that as accurately as possible.

The danger the straddle protects you from is subtle and worth stating carefully. Trading a structure that is very wide means you could be trading tickers where realized volatility came in *higher* than implied — i.e. you were wrong — and still make money. "At first glance, this doesn't sound like such a bad thing, but it really is." If you run trades that should have lost money in theory and the market does not give you that feedback, you are set up for long-term failure.

**Choose the strangle** to reduce transaction and hedging costs — explicitly *not* to increase probability of profit. Two mechanisms:

1. You can set a wider threshold for delta hedging. Because the breakeven strikes are wider you can be looser with hedging, which reduces costs.
2. There is a higher chance it expires between your strikes, so you do not need to pay to close the position.

Over a large number of trades these really add up.

#### Practical rules

**New trader or new strategy → trade straddles.** You need the feedback about whether you are doing things well. You will pay more in costs, but it is worth it early because "trading a straddle makes it much more difficult to hide behind higher probabilities of profit." You will know quickly whether your view on the market is getting you paid, "and that is worth more than a few extra points on your trade."

**Confident in a proven strategy → trade strangles.** By then you understand how it changes your expected value formula, you have confidence the strategy is profitable, and you are increasing the likelihood the trade expires worthless so you avoid closing costs.

#### Predicting Alpha's specific/contrarian opinions

- The debate is largely beside the point, because the choice does not impact expected value. "All we are doing is changing the variables in the equation, but we are still getting the same outcome."
- Probability of profit is the wrong reason to prefer a strangle. Cost is the right one.
- The risk in option selling is not the occasional small loser. It is the big losers, and running a strategy with long-term negative expected value without knowing it.
- Once you have found a profitable strategy, transaction costs and slippage are "the biggest hurdle" — trading is not cheap, and these costs can destroy the edge.

#### Notable direct quotes

> "Your probability of profit increases, but the amount you win when you are correct decreases."

> "The risk with option selling is not that you sometimes have small losers. It's that once in a while you are going to have big losers, or that you are running a strategy that has long term negative expected value."

> "Straddles are the purest way to trade the implied vs realized move. You get the right feedback, and the right time, and are able to adjust your trades accordingly."

> "The money you save from not needing to delta hedge as frequently plus only having to cross the spread one way (when you enter the trade) can be the difference between +EV and -EV."

---

### What is an Iron Butterfly and How Do You Trade Them: A Comprehensive Guide for Option Sellers
*Source: https://www.predictingalpha.com/blogs/what-is-an-iron-butterfly*

Sean Ryan · September 18, 2024

#### Core thesis

The iron butterfly is for the trader who wants to sell volatility but is not comfortable holding the unlimited loss exposure of a short straddle or strangle. The article opens by refusing to oversell it: it is not the best way, because hedging away the risk exposures you are paid to hold means making less money. What you buy with that is reduced P&L variance.

Nearly half the article is about one decision — where the wings go — because that is where the edge is won or destroyed.

#### Construction

A four-legged strategy:

1. **Sell a call and a put at one strike price (the body / short straddle)** — typically at or near the money.
2. **Buy a call and a put at different strike prices (the wings / long strangle)** — further out of the money to limit risk.

Example — XYZ Company trading at $200 share price:
- Sell the 200 Call and 200 Put
- Buy the 220 Call and 180 Put

This creates a net credit trade: the trader collects a premium from selling the at-the-money options and pays a smaller premium for the out-of-the-money options, limiting potential losses.

#### Payoff math

**The article gives no payoff formulas whatsoever.** No max profit formula, no max loss formula, no breakevens, and no premium figures attached to the $200 XYZ example. Worth flagging, because this is exactly the structure that invites auto-completed textbook math — the source does not do the arithmetic.

What it states is qualitative: the iron butterfly "gives you a similar risk exposure as a short straddle does, but with a max loss that is defined instead of a theoretically unlimited max loss as you have with short straddles."

Plus the variance-risk-premium framing, adapted from the straddle article: **the price of the iron butterfly (minus the cost of the wings) represents the implied move range** for a stock over a given period. Assuming you delta hedge, the difference between the price you sold it for and the average intrinsic value at expiration should be the variance risk premium for the position.

#### Greek profile

Not given. Delta hedging is required to "maintain your exposure to implied vs realized volatility as the position progresses," but no greek values, signs or magnitudes appear. The article defers to a separate delta-hedging piece and adds: "Seriously, read it before you start trading. It's important."

#### Definitions

- **Body** — the short straddle at the centre: a call and a put sold at the same strike.
- **Wings** — the long call and put bought at different, further out-of-the-money strikes.
- **Net credit trade** — premium collected on the ATM options exceeds premium paid for the OTM options.

#### Numbers, thresholds & rules of thumb

- **Wing placement (body text):** take the price of the straddle — the body — multiply the premium you collected by **3x**, and put the wings that far away from the current stock price, **at the closest**.
- **Wing placement (Key Takeaways box):** "The way we choose where to put the wings is by putting the 1-2x the straddle price away from the body." Both figures appear in the same article; the dedicated wings article uses 1x/2x.
- **Wing cost target:** "very cheap in dollar terms, maybe just a few pennies" — think of them as a cost of doing business for your strategy.
- **Sizing via stress test:** stress the position to see the loss "if you were to go past one of your wings." If that loss exceeds **10% of your account** for a single position, you are "definitely sized too big."
- **Sizing via margin:** if the margin requirement for a single position exceeds **10-15% of your portfolio**, you are too big for most trades.
- No delta targets are given for any leg.

#### Tables/charts

One image follows the construction example. The article does not describe its shape in prose.

#### When to use / when not to

Use an iron butterfly in the same situations as a short straddle: when you think implied volatility will outpace realized volatility and you do not have a view on what direction the stock will trend. They are ideal for low volatility environments and when the underlying is expected to stay within a specific trading range.

The reason to pick it over a naked straddle is stated with its cost attached: "You would trade an Iron Butterfly because you are willing to give up some of your premium and reduce your long term expected value in exchange for reduced PnL variance and to avoid the larger drawdowns that (will inevitably) occur when you are running a short volatility strategy."

The failure mode to avoid is wings placed too close: pay too much for them and you "completely destroy the edge in your trade, making it such that you shouldn't even bother placing the trade in the first place."

#### Practical rules

Iron butterflies are "pretty easy to manage because they already have a built in stop loss." Two requirements: size the trade appropriately, and delta hedge to maintain exposure to just implied versus realized volatility.

The five-step real-world workflow:
1. **Identify the trade** — you think there will be lower realized volatility than implied for Apple, currently trading at $200 per share.
2. **Construct** — sell the 200 Call and 200 Put; buy the 220 Call and 180 Put.
3. **Monitor** — keep an eye on Apple's price movement and implied volatility.
4. **Delta hedge** — maintain exposure to implied versus realized volatility.
5. **Close before expiration** — avoid assignment risk, then reallocate the freed capital to the next trade.

#### Predicting Alpha's specific/contrarian opinions

- **Buying wings is counter to the reason you are paid.** "We are the providers of the hedge, yet we are buying a hedge ourselves. If not done perfectly, it will erode the already thin margins we try to monetize through the variance risk premium."
- **But hedging is not automatically fatal**, and the concession comes with a good analogy: in the insurance industry — the business most comparable to option selling — insurance providers buy insurance themselves, giving way to an entire industry called re-insurance.
- **A good risk/reward ratio is a warning sign.** Option selling is inherently bad risk/reward by design. "If you have a good ratio of of risk and reward on each trade, that is a sure sign that you have entirely eroded your edge by not taking on any risk worth getting paid for."
- **Price the wings in dollars, not implied volatility.** The wings will certainly be more expensive in IV terms, because skew means IV rises the further out-the-money you go. But past a point the cost becomes so low that the IV does not matter. The wings are entirely an expense; you assume and hope they expire worthless, so all that matters is what the protection costs.
- **Always aim to put wings as far out as possible.** They exist to hedge away the worst case scenario, not to give a "good risk reward."
- Even when trading the butterfly because you are more risk averse, "we still need to hold some risk. If we don't, there is no reason someone should be paying us, and that means they don't pay us."

#### Notable direct quotes

> "If you are an option seller, you are getting paid for holding risk exposures that others don't want. If you hedge away these risk exposures (or part of them), then you are going to make less money."

> "Option selling is inherently bad 'risk/reward'. You are collecting premiums for holding the risk of outsized moves."

> "There is literally nothing worse than placing good trades that should get you paid and then losing money because we didn't structure things correctly."

> "Follow the guidelines set out in this article (or just trade naked straddles) and you will be good to!"

---

### How to Trade Iron Condors - Ultimate Guide For Option Sellers
*Source: https://www.predictingalpha.com/blogs/how-to-trade-iron-condors*

Sean Ryan · September 13, 2024

#### Core thesis

Iron condors are popular because they let you structure a trade with a high probability of profit while having a max loss built in — which answers retail traders' natural aversion to an undefined risk profile. But the probability-of-profit argument is a misconception, because it does not change expected value. The genuine advantage is different and specific: the iron condor lets you **capitalize on market skew** by selling strikes where implied volatility is elevated.

The conclusion is unusually candid for an article teaching the structure: the author does not like it.

#### Construction

An iron condor is an options strategy where the body strikes are **not** at the same price — the distinction from an iron butterfly, where the body strikes are identical (a short straddle).

The paired example, with Apple at $200:
- **Iron butterfly:** sell both the $200 put and call, buy the protective wings at $170 and $230.
- **Iron condor:** sell the $180 put, buy the $160 put, sell the $220 call, buy the $240 call.

The worked application — Apple at $200, a volatility smile observed in the 30 DTE skew, and an iron butterfly is what you would typically trade but the skew argues otherwise:
- **Sell the $180 Put** — more expensive due to higher implied volatility compared to at-the-money.
- **Buy the $160 Put** — protective wing, chosen because it is relatively cheap in dollar terms.
- **Sell the $220 Call** — more expensive due to higher implied volatility compared to at-the-money.
- **Buy the $240 Call** — protective wing, chosen because it is relatively cheap in dollar terms.

#### Payoff math

**Not given.** No max profit, no max loss, no breakevens, no formulas, no premium figures attached to the AAPL legs. The article's numeric content is entirely in strike selection.

The one payoff claim is comparative: selling options with inflated premiums due to skew while buying cheaper protection "improves your risk-reward ratio compared to a traditional iron condor where you might be selling at-the-money options with less favorable premiums."

#### Greek profile

Not given. Delta hedging is prescribed to maintain the directionless view over the lifetime of the trade; no greek values appear.

#### Definitions

- **Iron condor** — an options strategy where the body strikes are not at the same price, with protective wings bought further out.
- **Skew** — the difference in implied volatility between out-of-the-money puts and calls.
- **Volatility smile** — the specific shape looked for here: when implied volatility for both the out-the-money calls **and** the out-the-money puts is higher than the at-the-money implied volatility.

#### Numbers, thresholds & rules of thumb

- **Short strikes: usually sold at strikes between 30-40 delta.** The one explicit delta target in this module.
- **Short strike distance: one standard deviation away**, using the straddle price to gauge the expected move. Worked: "if the straddle price is $6 and the stock is trading at $50, the standard deviation is $6" — so sell the $44 put and the $56 call.
- **Long strikes:** equal distance from the short strikes on both sides, placed as far out as you are comfortable doing. The minimum is stated twice, in two different formulations:
  - Key Takeaways: "at least 1x the strangle price further away that the short strikes."
  - Body text: "at least 1x more than the distance from at-the-money to your short strike on each side."
- **DTE in the example:** 30.
- **Management:** hold to expiration unless it moves far beyond your max loss level.
- No margin or buying-power figures appear.

#### Tables/charts

Two images. One under "What is an Iron Condor?" (the structure). One in the skew discussion — the text describes the smile as OTM calls and OTM puts both carrying higher IV than at-the-money. Neither is captioned in prose.

#### When to use / when not to

The trigger is the skew shape, not the probability of profit. If you already hold the view that volatility is expensive, you want to be selling where it is higher — "and so being short the strangle makes more sense than being short the straddle." Out-the-money options may be cheaper in dollar terms but are more expensive in volatility terms, which is what makes them the better sale.

The misconception to discard: that a higher probability of profit makes condors better than iron butterflies. It does increase probability of profit, but "it doesn't really matter because it doesn't actually change your expected value."

Iron condors are described as the go-to trade for new option sellers who understand the importance of being delta neutral but are not yet comfortable with the true risk profile of selling straddles or strangles outright.

#### Practical rules

Three guidelines for choosing strikes, in order: estimate the standard deviation from the straddle price; set short strikes one standard deviation away; determine long strikes equidistant from the shorts, as far out as comfortable, respecting the 1x minimum.

Then delta hedge to maintain the directionless view, and plan to hold to expiration.

On judging wings in dollars rather than IV, the article repeats the passage from the butterfly piece nearly verbatim: the wings will certainly be more expensive in IV terms because skew raises IV further out-the-money, but past a point the cost becomes so low that IV does not matter, because the wings are entirely an expense you assume and hope will expire worthless.

#### Predicting Alpha's specific/contrarian opinions

The conclusion is the most valuable part of the article, and the mechanism it names is precise: **the wings themselves have a variance risk premium priced into them.** You are the buyer of that premium every time you put the trade on.

- Markets are priced relatively efficiently because "no one is trying to give away free money." The variance risk premium is not so large that it can carry the cost of expensive wings.
- The concession: anything that helps get retail option sellers away from the idea that they need to be trading direction is a net positive. If the condor is the stepping stone you need to get comfortable with a short volatility risk profile, go for it.
- The warning attached: it will have an impact on your expected value, and over time the cost of the wings "is going to significantly eat into your returns."

#### Notable direct quotes

> "I am personally not a huge fan of iron condors. My belief is that as volatility traders we are getting paid for taking on the risk that other people avoid or do not want. In order for us to get paid, we need to actually hold this risk."

> "The variance risk premium we aim to monetize is not so large that it can carry the cost of expensive wings (which also have a variance risk premium priced into them)."

> "We have to remember that as volatility traders we are getting paid to take on risks that others do not want on their books. In order to get paid, we actually need to take on some risk."

---

### Where to Place Option Wings When Selling Iron Butterflys and Iron Condors
*Source: https://www.predictingalpha.com/blogs/option-wings*

Sean Ryan · September 26, 2024

#### Core thesis

"Where should I place the wings?" is one of the most frequently asked questions about iron butterflies and condors. Understanding the structure is straightforward for most people; determining optimal wing placement is what trips them up. The answer is a systematic three-step method anchored to the straddle price, offered so you "never need to wonder about it again."

#### Construction

The method, not a leg structure:

**Step 1 — Price out the straddle.** Set the wings aside and focus on the body. Pricing out the straddle tells you the credit you would receive selling at the current stock price. Example: stock trading at $20, sell both a put and a call at the $20 strike, straddle priced at $3. "This figure will be crucial in the next steps."

**Step 2 — Determine your conviction.** Conviction is your confidence level that the trade will be profitable, and it drives how far the wings sit from the current stock price.
- **High conviction** — based on robust research or a strong market indicator, you might place the wings further away. "This means you are willing to take on more risk for a potentially higher reward."
- **Low or moderate conviction** — for most trades, where you do not have strong conviction, "it's safer to place the wings closer. This limits your risk but also caps your potential profit."

**Step 3 — Place the wings**, measured in straddle prices from the current stock price.

#### Payoff math

No max profit, max loss or breakeven formulas — the article is about distance selection. The only arithmetic is the multiple:

| Conviction | Distance | Stock $20, straddle $3 | Stock $50, straddle $5 |
|---|---|---|---|
| Standard | **1 straddle price** away | wings at **$17 and $23** | wings at **$45 and $55** |
| High | **2 straddle prices** away | wings at **$14 and $26** | wings at **$40 and $60** |

Both worked examples are the article's own; the $50 pair is labelled "Example 1: Low Conviction Trade" and "Example 2: High Conviction Trade."

On the trade-off: buying the wings costs money, which reduces the initial credit received from selling the straddle. The benefit is limiting potential losses, "converting an otherwise risky strategy into one with controlled risk."

#### Greek profile

**Not discussed.** The article says nothing about how wings change delta, gamma, theta or vega.

#### Margin / buying power

**Not discussed.** No margin or buying-power figures appear.

#### Definitions

- **Conviction** — your confidence level that the trade will be profitable; the input that selects the multiple.
- **Straddle price** — the credit from selling the body, used as the unit of measurement for wing distance.

#### Numbers, thresholds & rules of thumb

- **1x straddle price** — standard conviction.
- **2x straddle price** — high conviction.
- **The author's actual opinion, stated as an override of his own framework:** even though there are situations where it is OK to buy wings 1x the straddle price away, "my actual opinion is that you buy them at least 2x the straddle price away (or just don't buy them)."
- **The governing test:** "the wings should be cheap in dollar terms compared to the premium that you collect from selling the short straddle."
- Worked figures: $20 stock / $3 straddle → $17 and $23, or $14 and $26. $50 stock / $5 straddle → $45 and $55, or $40 and $60.

#### Tables/charts

Three images: one in Step 1 (pricing the straddle), one in Step 2 (conviction), one after Step 3 showing the placements. None are captioned beyond the surrounding text.

#### When to use / when not to

The decision is how far out, not whether. Low or moderate conviction places wings closer, limiting risk and capping profit; high conviction pushes them out, accepting more risk for a potentially higher reward. The author's own floor is 2x or nothing.

The failure mode the method exists to prevent is named in the Key Takeaways: the systematic approach "helps manage risk while stopping you from putting the wings so close that it completely destroys your edge."

#### Practical rules

- Price the straddle first. Everything downstream is a multiple of that number.
- Judge the wings in dollar terms, not implied volatility terms. Skew guarantees OTM wings look expensive in IV; past a point the dollar cost is low enough that the IV is irrelevant, because you assume and hope they expire worthless.
- Aim to put wings as far out as possible — they hedge away the worst case, not deliver a good risk/reward.
- Once the method is habit, "get back to looking for better trades to be taking."

#### Predicting Alpha's specific/contrarian opinions

- **The stated framework and the author's real preference differ, and he says so explicitly.** The 1x standard-conviction rule is presented as acceptable; his own view is 2x minimum or skip the wings entirely.
- Fundamentally, "as option sellers the reason we are getting paid is for holding the risk of big moves." Every wing bought reduces that.
- The wings are entirely an expense. You assume and hope they expire worthless.

#### Notable direct quotes

> "my actual opinion is that you buy them at least 2x the straddle price away (or just don't buy them)."

> "A good rule of thumb is that the wings should be cheap in dollar terms compared to the premium that you collect from selling the short straddle."

> "They are meant to hedge away the worst case scenario, not give us a 'good risk reward'."

---

### How to Trade Vertical Spreads - An Option Trade For Betting on Direction While Leveraging Volatility Skew
*Source: https://www.predictingalpha.com/blogs/vertical-spread-options*

Sean Ryan · September 15, 2024

#### Core thesis

This is the module's directional structure. The framing is that options let you build a position expressing your exact view — the article's own example of such a view is "I think the stock is going to trend down but not as aggressively as implied by the market." Vertical spreads express bullish or bearish views with limited risk and margin requirements, and what makes them genuinely good rather than merely defined-risk is **trading them into steep skew**.

#### Construction

A vertical spread involves buying one option and selling another option of the same type (call or put) but with a different strike price. Also known as call or put spreads.

**Bullish call spread** — Apple trading at $190 per share:
- Buy the 190 Call: costs $10
- Sell the 200 Call: fetches $6

**Bearish put spread** — Apple, bearish view:
- Buy the 190 Put: costs $9
- Sell the 180 Put: fetches $4

Note the put spread's direction: you buy the **higher** strike and sell the **lower** one.

The article covers only these two debit spreads. Credit verticals — bull put and bear call — are never mentioned.

#### Payoff math

Both examples are worked in full, with the general rule stated in prose alongside each figure.

**Bull call spread:**
- Cost = the difference between the premiums paid and received = $10 − $6 = **$4**
- Max profit = the difference between the strike prices minus the cost of the spread = ($200 − $190) − $4 = **$6**
- Max loss = limited to the debit paid for the spread = **$4**

**Bear put spread:**
- Cost = $9 − $4 = **$5**
- Max profit = ($190 − $180) − $5 = **$5**
- Max loss = **$5**

**Breakevens are not given** — no breakeven formula and no breakeven figure appears for either example.

#### Greek profile

Not given. No delta, gamma, theta or vega discussion, and no description of how exposures change as spot moves between the strikes.

#### Margin / buying power

Named but not quantified: vertical spreads "allow traders to express bullish or bearish views with limited risk and margin requirements."

#### Definitions

- **Vertical spread** — buying one option and selling another of the same type with a different strike price; also known as call or put spreads.
- **Trading into the skew** — having a directional view where the option skew slopes in that direction, letting you leverage the shape of the skew to structure the trade.

#### Numbers, thresholds & rules of thumb

- Bull call: $190 spot, 190/200 strikes, $10 and $6 premiums, $4 cost, $6 max profit, $4 max loss.
- Bear put: 190/180 strikes, $9 and $4 premiums, $5 cost, $5 max profit, $5 max loss.
- **Skew example:** implied volatility for the 160 call is **50%**, the 180 call is **75%**.
- **Strike selection by conviction, Apple at $200:** moderate bullish → buy the 200 call, sell the 210 call. Strong bullish → buy the 210 call, sell the 220 call.
- No delta targets and no spread-width rule in points or percent.

#### Tables/charts

Five images: one after each worked example, two in the skew section, one after the strike-selection example. The article does not describe any payoff shape in prose.

#### When to use / when not to

Use call spreads for bullish views and put spreads for bearish views. The more important condition: trade them **into the skew**. When you have a directional view and the option skew slopes in that direction, you can leverage the shape of the skew to structure a directional trade with a great risk/reward ratio.

The author's default execution for a bullish view with call skew: "I will typically buy a call option at-the-money or just slightly out-the-money, then finance it by selling a further out-the-money call. This works because the implied volatility of the further out-the-money strike call will be higher than the implied volatility of the call that is closer to the money." With a bearish perspective and put skew, do the same thing on the put side.

The 50%/75% example spells out the logic: selling the 180 call finances the 160 call you want to purchase, which makes sense if you think the stock is likely to trend upward, because you are reducing your cost basis by "selling" the payoff you would receive if there were a massive move to the upside.

**Strike distance** is set by conviction: moderately bullish → strikes close to the current price; strong bullish → strikes further out. Further out-of-the-money strikes offer higher potential rewards for lower initial costs.

**Expiration** is a stated trade-off: longer expirations provide more margin for error but move slower; shorter expirations offer higher potential payoffs but less time for the move to happen in the direction you forecast.

#### Practical rules

The management approach is a single specific stance: **hold to expiration.** Given the limited loss of a vertical spread, the author does not get picky about closing out when experiencing a loss, because "forecasting direction on a day to day basis can be really tricky."

The sizing rule that makes this work: "I will enter the trade with the expectation that my stop loss is zero, and I size my trade such that the total debit I pay for the position is equal to the stop loss amount that I would have set." Position sizing and the stop loss become the same decision.

#### Predicting Alpha's specific/contrarian opinions

- Verticals give "a great risk reward ratio, especially when traded into steep skew" — the qualifier does the work; the skew is what makes the structure attractive rather than merely defined-risk.
- Trading verticals into steep volatility skew "improves the structure, making it a much better risk/reward for your trade."
- Plan for the max loss rather than managing to avoid it. The stop loss is zero by design.

#### Notable direct quotes

> "One of the most beautiful parts of trading options is that you can create a structure to express your exact view on the market."

> "When you find a situation where the skew increases in the direction you think the stock will move, in the timeframe you think it will happen, there are few better ways to trade than a vertical spread."

---

### Mastering Back Ratio Spreads: A Comprehensive Guide for Option Sellers
*Source: https://www.predictingalpha.com/blogs/back-ratio-spread*

Sean Ryan · September 25, 2024

#### Core thesis

Back spreads, also known as ratio spreads, are an option selling structure highly sensitive to skew that offers "a great way for traders to monetize the variance risk premium in ETFs." The structure works because ETFs carry a steep and consistent put skew — shown to be true essentially all the time on SPY — which lets the two options you sell fund the one you buy and still leave a credit.

#### Construction

Buy one at-the-money (ATM) option and sell multiple out-of-the-money (OTM) options of the same type (calls or puts). The strategy capitalizes on the difference in implied volatility between the ATM and OTM options, making it highly sensitive to skew.

The Key Takeaways state it plainly: **buy an at-the-money put, sell two out-the-money puts.**

Worked example — you believe the skew in the S&P 500 (SPY) is overpriced:
1. Buy an ATM put for **$5**
2. Sell two OTM puts for **$3 each**, collecting **$6** in premiums

Net position: long one put, short two puts, **net credit $1** ($6 received − $5 paid).

No specific strike prices and no delta targets are given for either leg.

#### Payoff math

**No formulas, no breakevens, no max profit or max loss are given.** The payoff is described through three scenarios:

- **Small profit if SPY rallies.** Since you collected a credit for the position, you keep the credit if the ticker rallies to the upside.
- **Large profit on a small move down.** Because there is a gap between the put you bought and the two you sold, a small move down generates a larger return. "This can be a massive return relative to the premium collected and will vary based on the steepness of the skew."
- **Large loss on a big move down.** The primary risk is the stock moving sharply in the direction where you are naked. If SPY drops significantly below the strikes you sold, you face substantial losses.

The Key Takeaways compress this to: "a small profit in a rally, a large profit if there is a small drop in price, and then a large loss if there is a big down move."

Breakevens are referenced once without being calculated: going further out in time makes the premium large enough "that your breakevens are wide."

#### Greek profile

Not given. No delta, gamma, theta or vega discussion, and no description of how exposures change as spot falls through the short strikes.

#### Definitions

- **Back spread / ratio spread** — buying one ATM option and selling multiple OTM options of the same type.
- **Put skew** — the article's operational test, taken from its chart: "if the number is above 0, there is put skew."
- **Naked** — the uncovered direction; here, below the strikes you sold.

#### Numbers, thresholds & rules of thumb

- **Structure:** long 1 ATM put, short 2 OTM puts.
- **SPY example:** $5 paid, $3 × 2 = $6 collected, $1 net credit.
- **DTE: 30-60.** "We have found that the optimal timeframe for trading back spreads is 30-60 DTE." Especially on ETFs, "this is the sweet spot for this structure."
- **Margin utilization: less than 50%.** The stated rule of thumb for leverage.
- **Roll: at 75% of the way to expiration.** Worked: "if I am trading a 60 DTE back spread, I will roll into a new position after 45 days."
- **IV exit: above the 80th percentile**, close the trade because the variance becomes too high.

#### Tables/charts

Two images. One follows the "What is a Back Spread?" definition. The second is introduced explicitly — "The time series below shows you how the 30 DTE skew for SPY changes over time" — and the article describes what it shows: even at the lowest levels there is still a steep put skew, demonstrating "how at basically all times there is put skew on the SPY."

#### When to use / when not to

**Use when skew is high** — where the implied volatility for OTM options is much higher than for ATM options. This makes back spreads "an attractive structure to use on ETFs, where there is usually a very steep and consistent put skew." That difference is what lets you collect higher premiums on the OTM options you sell.

**Why 30-60 DTE:** this is meant to be a pretty hands-off approach, so going a bit further out in time makes the premium large enough that your breakevens are wide and you can feel comfortable that in the majority of cases you will yield a positive return — "while only taking a loss when downside volatility is significant (situations where you should expect to be losing anyways when selling volatility)."

**Exit when IV exceeds the 80th percentile.** The reasoning mirrors the short-straddle stop rule: the variance risk premium is still present when implied volatility is at its highest, but that is also when you experience the most variance, so taking the position off reduces the likelihood of a massive drawdown. A structure-specific reason is attached: "Given the leverage we have and the steepness of our PnL decline if we experience significant downside variance, this is a rule of thumb that I personally follow."

#### Practical rules

Two management rules, and the article calls the whole thing "a pretty hands-off trade":

1. Roll into a new position at 75% of the way to expiration.
2. Close out if implied volatility rises above the 80th percentile.

Sizing: keep margin utilization under 50%. Sizing matters more than usual here because "this is a structure that is typically traded continuously (rolling into new positions) so you want to make sure you are sized appropriately to absorb any large moves against you."

#### Predicting Alpha's specific/contrarian opinions

- Back spreads are "powerful tools for traders who understand skew and volatility" — positioned as requiring skew literacy, not as a beginner structure.
- ETFs are the natural home because their put skew is steep and consistent, and the SPY time series is offered as evidence rather than assertion.
- Losses are framed as expected rather than as failures: you take a loss when downside volatility is significant, "situations where you should expect to be losing anyways when selling volatility."
- Proper leverage and trade size management are "crucial to avoid excessive risk."

#### Notable direct quotes

> "even at the lowest levels there is still a steep put skew (if the number is above 0, there is put skew). This shows how at basically all times there is put skew on the SPY."

> "if I am trading a 60 DTE back spread, I will roll into a new position after 45 days."

> "Even though the variance risk premium is still present when implied volatility is at its highest, this is also the time when you will experience the most variance."

---

### Module 5 — the six structures at a glance

*Derived: this table is assembled from the eight articles, not lifted from any one of them. Leg constructions and selection criteria are the articles' own; the ordering by risk retained is my arrangement.*

| Structure | Legs | Risk retained | What selects it |
|---|---|---|---|
| Short straddle | Short ATM call + short ATM put, same strike | Full — "theoretically unlimited max loss" | IV > RV expected, no directional view |
| Short strangle | Short OTM call + short OTM put | Full, but wider breakevens | Same view; chosen to cut hedging and closing costs |
| Back ratio spread | Long 1 ATM put, short 2 OTM puts (1×2) | Full below the short strikes (naked) | Steep, consistent put skew — i.e. ETFs |
| Iron butterfly | Short straddle + long OTM wings | Capped at the wings | Same view as a straddle, but you want defined loss |
| Iron condor | Short strangle + long OTM wings | Capped at the wings | A volatility smile — sell where IV is elevated |
| Vertical spread | Two same-type options, different strikes | Capped at the debit paid | A **directional** view, traded into the skew |

The thread running through all eight articles: you are paid for holding risk others do not want, so every wing bought hands some of that back and pays a premium to do it. That is why the author prefers naked bodies to condors, wants wings at 2× the straddle price or not at all, and calls defined-risk structures a stepping stone rather than a destination.

### Module 5 — index of every numeric rule stated in the source

Each row appears in the article named. Nothing derived or inferred.

| Rule | Value | Article |
|---|---|---|
| Straddle strike | At the money | Short straddle |
| Straddle breakevens | Strike ± total premium received | Short straddle |
| Straddle breakeven worked example | $4 + $5 = $9 premium, $200 strike → $209 / $191 | Short straddle |
| Trade setup example | Implied move 10%, actual move 7% | Short straddle |
| Stress-test magnitude | 3-4× bigger than the implied move | Short straddle |
| Max loss per position | >10% of account = sized too big | Short straddle, Iron butterfly |
| Margin per position | >10-15% of portfolio = too big | Short straddle, Iron butterfly |
| Volatility stop trigger | IV at the highest level of the last year (IV percentile) | Short straddle |
| Practice trade | 30 DTE straddle on SPY | Short straddle |
| EV simulation inputs | $10 bet, 60% at 1:1 vs $10 bet, 80% at 1:0.5 | Straddle vs strangle |
| Author's live strangle | Delta 20, weekly expiry, ETF Premium strategy | Straddle vs strangle |
| Butterfly wings (body text) | 3× the collected straddle premium from spot, at closest | Iron butterfly |
| Butterfly wings (takeaways box) | 1-2× the straddle price from the body | Iron butterfly |
| Butterfly wing cost target | "a few pennies" in dollar terms | Iron butterfly |
| Butterfly example legs | XYZ $200: sell 200C/200P, buy 220C/180P | Iron butterfly |
| Condor short strikes | 30-40 delta, one standard deviation away | Iron condor |
| Standard deviation proxy | The straddle price ($6 straddle, $50 stock = $6 SD → $44/$56) | Iron condor |
| Condor long strikes | Equidistant; ≥1× the strangle price beyond the shorts (takeaways) / ≥1× the ATM-to-short distance (body) | Iron condor |
| Condor example legs | AAPL $200, 30 DTE: sell 180P/220C, buy 160P/240C | Iron condor |
| Butterfly comparison legs | AAPL $200: sell 200P/200C, wings at $170/$230 | Iron condor |
| Wings, standard conviction | 1 straddle price from spot ($20 stock, $3 straddle → $17, $23) | Option wings |
| Wings, high conviction | 2 straddle prices from spot ($20 stock, $3 straddle → $14, $26) | Option wings |
| Wings, second worked pair | $50 stock, $5 straddle → $45/$55 or $40/$60 | Option wings |
| Wings, author's floor | ≥2× the straddle price, or do not buy them | Option wings |
| Bull call spread | $190 spot; buy 190C $10 / sell 200C $6 → cost $4, max profit $6, max loss $4 | Vertical spreads |
| Bear put spread | Buy 190P $9 / sell 180P $4 → cost $5, max profit $5, max loss $5 | Vertical spreads |
| Vertical skew example | 160 call IV 50%, 180 call IV 75% | Vertical spreads |
| Vertical strike selection | AAPL $200: moderate → 200/210; strong → 210/220 | Vertical spreads |
| Vertical sizing | Total debit paid = the stop loss amount | Vertical spreads |
| Back spread structure | Long 1 ATM put, short 2 OTM puts | Back ratio spread |
| Back spread example | SPY: pay $5, collect $3 × 2 = $6 → $1 net credit | Back ratio spread |
| Back spread DTE | 30-60 | Back ratio spread |
| Back spread roll | 75% of the way to expiration (60 DTE → day 45) | Back ratio spread |
| Back spread IV exit | Above the 80th percentile | Back ratio spread |
| Back spread margin | <50% utilization | Back ratio spread |

**What no article in this module provides:** any greek values, signs or magnitudes for any structure; max profit, max loss or breakeven formulas for the iron butterfly, iron condor or back ratio spread; breakevens for vertical spreads; delta targets for anything other than the condor's 30-40 delta short strikes and the author's personal delta-20 strangles; capital-efficiency ratios; and any margin figure beyond the 10-15% and <50% ceilings.

## Module 6 — Strategy Fundamentals


---

### Expected Value Trading: The Mentality of a Profitable Trader
*Source: https://www.predictingalpha.com/blogs/expected-value-trading*
*Sean Ryan · August 17, 2024*

#### Core thesis

Whether a professional trades **options, stocks, or pokemon cards**, the way they think about their strategy doesn't really change. The core trait that makes them a professional is **the lens through which they view the world and their strategy** — Expected Value.

> If I make this decision over and over again into the future, do I make money on average?

#### Key Takeaways (as stated)

1. **Expected value (EV)** — helps determine if a trade will be profitable on average, ensuring every trade has positive EV for long-term success. "There's a formula for it."
2. **Finding an edge** — positive EV requires **an edge: a statistical advantage over the market or the person on the other side of the trade.**
3. **Long-term profitability** — **most edges available to us are small, but persistent.** The real difficulty in monetizing the edge comes down to **execution, cost and risk management, and portfolio management.**

#### Definition

Expected value is **a statistical concept that helps traders determine if, on average, they should make money by taking a particular trade.** Not exclusively a trading idea — a fundamental decision-making framework taught to everyone who studies decision making and statistics.

The canonical business example is a **casino**: every game you can play is designed so that each time it's played, the casino has **a slight statistical advantage**, positioning them to slowly extract earnings from gamblers over time.

#### The formula

**EV = (Probability of Winning × Amount Won) – (Probability of Losing × Amount Lost)**

| Term | Meaning |
|---|---|
| Probability of Winning | Chance of the favourable outcome (decimal) |
| Amount Won | Gain if you win |
| Probability of Losing | Chance of the unfavourable outcome (decimal) |
| Amount Lost | Loss if you lose |

A **positive number** indicates that on average, engaging in that trade or game will result in a profit.

#### Worked example — casino roulette

*Setup:* a roulette table where in each round players place a **$10 bet**. If the player wins they gain **$10**; if they lose, the casino keeps the **$10**. On each round the house has a **52%** chance of winning, the player **48%**.

```
EV = (0.52 × $10) – (0.48 × $10) = $5.20 – $4.80 = $0.40
```

For every **$10 bet** placed on roulette, the casino makes an average profit of **40 cents**. Ryan is careful about what that does *not* mean — they don't make $0.40 on each round; **they either make $10 or lose $10.** After thousands of rounds, total profit divided by games played averages out to roughly **$0.40 in profit per game.**

What would the casino do if the EV output were negative? **They would stop hosting the game** — casinos only run games because they want to make money.

#### Long-term profitability

A gambler might get lucky short-term and win several bets in a row, but over a large number of bets — **1,000** — the casino's consistent edge ensures it comes out ahead. **This is why casinos don't kick you out when you start to win.** They do everything they can to keep you playing — **buying you drinks, giving you a free room if you agree to play for a while.** They know **the more you play, the better the odds that they come out the winner.**

For traders, this is really the best we can hope for. **It's pretty much not going to happen that we find a strategy that makes us money 100% of the time**, which means **we are going to inevitably experience a drawdown at some point.** When we do, we need something to keep us confident that we are supposed to make money — which is why we need an idea of the expected value of our decisions.

> Casino style games are the best ones to run, and the worst ones to try and beat.

The expected value is **baked into the way the game works.** As a gambler playing roulette **you cannot win — no amount of risk management, strategy, or psychological "will power" can change the tides in your favor.** Flipped around, that's why a casino would be an epic business to own: **run enough tables and play enough games, and you win.**

#### Applying EV to option selling

The profitable trader continually asks: **"Do I have a positive expected value with every trade I place?"** By ensuring each trade has positive EV, we can manage risk and **spread bets across multiple trades** to secure long-term profitability.

**Developing an edge.** Just like the casino, we need to find **"games" in the market that people are willing to play with us** in which we secure positive expected value. Since we must **assume other market participants are making rational decisions**, we need areas where **the other person's motivations for "playing" with us are not directly monetary.**

To find these in options, we typically just need to look for **areas where someone is looking to offload risk.** The two most common — and the focus of the Predicting Alpha private community — are **selling volatility on ETFs** and **around Earnings Events.**

#### Stated limitation on the formula

Two assumptions go into the equation: the outcome of your "bet" is **binary** — you either win or lose — and **you know the exact probabilities** of each scenario.

In trading, and especially options where **the payoff is a distribution of returns**, we do not have such finite answers. So rather than trying to be **super mathematical**, just ask whether the decision you're making **is actually supposed to make money on average.**

If you can answer yes — **usually a combination of data and logic goes into this** — you should feel confident you're making decisions that should get you paid. You then compare assumptions against what happens in reality. Win or lose on any given day, **if what you are seeing matches what you know could potentially happen**, you can feel confident continuing, trusting that over time the expected value will show through.

#### Chart

The article includes **a crudely drawn graph showing what the PnL of different roulette tables may look like over a large number of games.** Ryan's reading of it: **none of them are constant winners, but all tables become extremely profitable over a long enough period of time.**

#### Practical rules

- Score decisions by their repeated-play average, never by a single outcome.
- Spread bets across multiple positive-EV trades and expect drawdown.
- Don't compute precise EV on options; check the logic, then validate against realised results.
- Look for counterparties whose motivation isn't directly monetary.

#### Body hyperlinks

`how-to-make-money-selling-options` · `option-trading-psychology` · `what-is-an-option-contract` · `implied-vs-realized-volatility`

---

### The Importance of Trading Research: Finding Tradable Information
*Source: https://www.predictingalpha.com/blogs/trading-research*
*Sean Ryan · September 3, 2024*

#### Core thesis

Finding a good trading opportunity requires **two things**: a **pricing discrepancy** — a difference between the current market price and what you think fair value should be — and **an understandable reason why this opportunity exists.**

Answering the second requires understanding what makes something a **"tradable" piece of information**, and how to apply what you see in the market to **the implied volatility you are seeing on the option chain.**

#### Key Takeaways (as stated)

1. **Value of tradable information** — provides a competitive edge by offering insights **not yet reflected in market prices.**
2. **Differentiating tradable information** — its **proprietary nature, exploitation of market inefficiencies, and the challenges associated with its effective utilization.**
3. **Using market information to explain option mispricings** — when there is a large spike in implied volatility, understand why **before** placing a trade. **If we can't explain it, then maybe someone knows something that we don't, and we could find ourselves on the wrong side of the trade.**
4. **Essentials of good research** — combines quantitative analysis with qualitative insights, employs logical reasoning to understand market anomalies, and **filters out trades based on non-tradable data.**

#### Definitions

**Tradable information** — valuable information; provides an edge because it offers insights **not already priced into the market.**

**Non-tradable information** — often **public and widely known.**

#### Cautionary tale — TEUM

**TEUM** was a **technology infrastructure company trading around $2.** Ryan saw several positive catalysts on the horizon: **new contracts, funding, a new CEO, and unrealized revenues from the previous year rolling into the current quarter.** Based on those he predicted the stock would **rise significantly in the next six months.**

Instead the stock **remained stagnant and even took a dip when one of the anticipated events fell through.** He calls it **one of my worst trades.**

> I had confused publicly available information with tradable information.

The positive catalysts **were already known to the market, meaning the stock was already priced according to these expectations.**

#### Three characteristics of tradable information

1. **Not well known** — often proprietary or not widely disseminated. Example: **you might discover a unique market correlation through your analysis that others haven't identified.**
2. **Structural inefficiencies** — certain market conditions create exploitable inefficiencies. Example: **funds often hedge their positions by buying out-of-the-money puts and selling out-of-the-money calls, leading to pricing inefficiencies.**
3. **Difficult to use** — even if an edge exists, it may be challenging to exploit. Example: **selling options around earnings events can be profitable, but the associated risks deter many traders.**

#### Worked example — the IV/RV research loop

Analysing a ticker showing implied volatility significantly higher than realized volatility:

- **Data insight:** IV is at **150%**, and the average realized volatility is **75%**. The options are priced at **$10**, but you believe they should be worth **$5**. You are considering selling them.
- **Research insight:** before acting, investigate **why** the IV is so high. Maybe the company has **recently released some bad news related to product sales** and it caused the stock price to drop.
- **Combining the two:** since the news is **already released and the market is aware** of the poor sales, you think the new stock price after it dropped **is fair and reflects this information.** For this reason you think implied volatility **should have come back down.**
- **Decision:** since IV has stayed elevated and **there should be no further news to drive the stock price to experience rapid changes**, you proceed. The options are expensive, **you understand why**, and you believe they should decrease in value.

#### Characteristics of good research

- **Comprehensive analysis** — covers both **quantitative data and qualitative insights**: market conditions, upcoming events, and the broader economic environment.
- **Logical reasoning** — if IV is high, find out why. **Is there insider trading? Is there a significant event on the horizon?**
- **Filtering bad trades** — use research to **filter out trades based on non-tradable information**, **crucial in refining your strategy and improving your success rate.**

#### Applying research in trading

1. **Data collection** — collect data on **variance risk premium, backtest results, recent changes in volatility, stock prices**, and other relevant metrics.
2. **Analyze trends** — look for trends and correlations that may indicate **pricing inefficiencies.**
3. **Understand the context** — **Why is IV high? Are there upcoming events that justify it? Is there an underlying market trend affecting the prices?**
4. **Validate with logic** — ensure data-driven insights are backed by logical reasoning.

#### How traders at Predicting Alpha think about research

The emphasis is on **understanding why you are getting paid** and running strategies that actually make money.

> We believe that ideas without data can't be traded. But we also believe data without ideas are worthless too.

**You need to understand why you are getting paid, and have proof that you actually will get paid.** That's the foundation of good trading — **the quantitative and the qualitative.**

#### Practical rules

- Require both a pricing discrepancy **and** an explanation before trading.
- Check whether every input to your thesis is public. If so, assume it's priced.
- Use research to filter trades out, not only to find them.

#### Body hyperlinks

`what-is-implied-volatility` · `earnings-options-strategy` · `variance-risk-premium`

## Module 7 — Skew and Term Structure

*Built from the four full article texts; every number below appears in the source files. Where the
articles describe something only qualitatively, that is recorded as a documented gap rather than
filled in from standard vol-surface theory. Sub-links skipped per instruction.*

---

### Introduction to Options Skew: A Game Changer for Option Sellers
*Source: https://www.predictingalpha.com/blogs/options-skew*

Sean Ryan · September 19, 2024. Explicitly the first of two parts on skew.

#### Core thesis

An option chain has **two primary dimensions**: time (the expirations) and underlying price (the
strikes available on each expiration). Both have typical "shapes" and abnormal shapes under
different market conditions. This article covers the price dimension — skew.

Skew describes that shape by looking at how implied volatility changes across strikes. IVs are not
evenly distributed as you move away from the at-the-money strikes, and that unevenness says more
than you would expect about what the market believes will happen. It works because option prices
are the market's attempt to describe the future distribution of a stock's returns, and real return
distributions are skewed rather than normal.

#### Key takeaways (the article's own three)

1. **Normal vs skewed distribution.** Normal distribution has symmetrical probabilities of
   returns. Skewed distribution reflects real-world stock behaviour: small up moves are the most
   frequent, and large down moves are more frequent than large up moves.
2. **Impact on options pricing.** Skew makes OTM puts more expensive through higher implied
   volatility, reflecting greater downside risk. The article adds a clause worth flagging — OTM
   puts being most expensive also means they **carry the most variance risk premium**, because
   this is the most common purchase by those looking to hedge.
3. **Implications for option sellers.** Skew tells you where the market implies the most likely
   moves to be and where the risk is on a ticker. It can also be used to **structure trades in a
   way that gives a better payoff if it matches the view you are trying to express.**

#### Definitions

**Normal distribution** — a statistical concept showing how likely different outcomes are, where
most data points cluster around the mean and the probabilities of extreme values are symmetrical
on both sides. Its three stated properties:

- Mean, median and mode are all the same.
- The probability of a large upward move is the same as the probability of a large downward move.
- It is symmetrical, creating a bell-shaped curve.

**Skewed distribution (real stock returns)** — the contrasting three:

- The most frequent return (**mode**) is positive, indicating many small upward moves.
- The **median** is lower than the mode but higher than the mean.
- The **mean** is pulled down by the infrequent but large downward moves.

**Skew, in the options market** — the difference in implied volatility between out-of-the-money
puts and calls. Typically OTM puts have higher IV and are more expensive; OTM calls have lower IV
and are cheaper. This reflects the market's expectation of a skewed distribution, since it
anticipates stocks are more likely to see significant downward moves — economic downturns, earnings
misses, and the like.

The intuition is grounded in the saying that stocks go up like an escalator and down like an
elevator, which the article argues is literally a description of return skewness: trend up, crash
down. Since stocks rise in value over time, it also implies the small up moves happen more often
than the large down moves.

#### Formulas

None. The article contains no equations. Skew is defined verbally as an IV difference between OTM
puts and OTM calls, with no measurement convention attached — no delta anchor, no slope, no
normalization.

#### Numbers, thresholds & rules of thumb

- **The S&P 500 might move up 57% of the time** — but the down moves, though less frequent, are
  often larger. This is the article's only empirical statistic, and the whole argument rests on it.
- The pricing pattern: OTM puts → higher IV, more expensive. OTM calls → lower IV, cheaper.

#### Worked example — S&P 500 options

Spot assumed at **4000**. The chain the article asks you to imagine:

| Position | Strike | Implied volatility |
|---|---|---|
| OTM put | 3800 | 25% |
| ATM | 4000 | 20% |
| OTM call | 4200 | 15% |

Its reading of each leg:

- The **OTM put** is more expensive, reflecting higher IV due to the greater perceived risk of a
  significant downward move.
- The **ATM option** has moderate IV, as it sits at the current price level.
- The **OTM call** is cheaper, with lower IV, reflecting the lower probability of a large upward
  move.

The stated payoff from understanding this: better decisions about *which options to sell*,
maximizing profits while managing risk.

#### Why puts are more expensive — the author's explanation

The primary reason given: **options are most commonly used to hedge risk.** Two supporting points:

- **Downside risk.** Options are insurance products meant to hedge risk away. For a stock, the
  risky thing that could happen is the company dropping significantly in value — so the most
  common purchase for options is puts.
- **Asymmetrical returns.** Companies often experience steady growth, but are less likely to have
  explosive upward moves compared to the potential for sharp declines.

The illustration: a company that goes bankrupt can lose most or all of its value, but it can't
experience an equivalent explosive move to the upside without significant fundamental changes.

#### The two core questions skew answers

1. **Where is the risk?**
2. **What is most likely to happen?**

The mechanism linking them: people are more willing to purchase options to protect against risk.
If the risk is to the downside, OTM puts should be more expensive than OTM calls. And by telling
you the risk is to the downside — a **bigger move with a lower chance** — skew simultaneously
tells you what the market thinks is *most likely*: a **smaller move to the upside**.

#### How to trade it

Kept brief. These insights become really valuable when analyzing companies that recently had major
fundamental changes or a large event — where the stock may have moved, IV may be through the roof,
and you are trying to understand what the market anticipates next. **If you disagree with the
skew**, fantastic trading opportunities come out of it through structures like **vertical
spreads**.

#### Practical rules

- Treat the expensive wing as the market's stated risk, the cheap side as its most-likely outcome.
- Apply skew hardest where fundamentals just changed or a large event just occurred, and trade it
  only where you disagree.

#### Predicting Alpha's specific / contrarian opinions

- Skew is an **information source about market-implied risk**, not a pricing artifact.
- **Hedging demand** is placed ahead of any academic mechanism: puts are expensive because that is
  what people buy for protection.
- The richest wing is explicitly tied to the **most variance risk premium**.
- Skew is a **structuring tool** — it shapes the trade so the payoff matches your view, rather than
  just flagging which side is expensive.

#### Notable direct quotes

> "The primary reason is because options are most commonly used to hedge risk."

> "Better yet, If we disagree with the skew then some really fantastic trading opportunities can
> come out of it through the use of structures like vertical spreads."

#### Tables/charts

- A normal-distribution curve built from S&P 500 returns: **frequency on the Y-axis, magnitude of
  returns on the X-axis**, most returns clustering around a central value with fewer large moves
  either side.
- A skewed-distribution curve with the mode displaced positive and a longer left tail dragging the
  mean down.
- An escalator/elevator illustration of trend-up, crash-down.

#### Documented gaps

No measurement convention for skew — no delta anchor, slope, sign convention or ATM normalization,
and no typical values for indices versus single names. One illustrative chain and one statistic is
the whole quantitative content.

---

### How To Read Option Volatility Skew to Understand Future Expected Moves
*Source: https://www.predictingalpha.com/blogs/volatility-skew*

Sean Ryan · September 21, 2024. The follow-up to the introduction above.

#### Core thesis

Skew takes four recognisable shapes, each a different statement about where the risk sits and which
way the stock is most likely to drift. Skew is **dynamic** — new information changes it quickly —
but certain tickers have a "typical" shape, and deviation from it is where opportunity lives.

#### Key takeaways — the four shapes with the article's exact implications

| Shape | When you see it | Risk is | Most likely move is |
|---|---|---|---|
| **Put skew** | Usually, for stocks/ETFs | Downside | Upside |
| **Call skew** | When retail traders are buying up all the calls | Upside | Downside |
| **Flat skew** | When the market doesn't know what will happen | — | Up & down, large & small all similar |
| **Skew smile** | When an event will change the stock price significantly | **Upside and downside** | — |

Note the deliberate inversion in the first two rows: **the expensive wing marks the risk, so the
expected drift is the other way.** This is the article's central reading rule.

#### Definitions

An option chain lists all available strike prices for calls and puts along with their implied
volatilities. Skew is read by plotting **IV on the Y-axis against strike price on the X-axis**.

**The call-delta convention** — the one normalization the article offers, and it gives the reason.
Instead of strike prices, skew is often represented using the **call delta**. Because of
**put/call parity**, the call delta can be used to represent the IV for the calls *and* puts at the
strike that would equate to that call delta. Stated purpose: a way to set skews up to be
comparable across tickers easily.

#### Formulas

None. Put/call parity is invoked by name to justify the call-delta x-axis, but no equation is
written and no skew metric is defined.

#### Worked example 1 — put skew

Introduced as "Imagine SPY is trading at $500."

| Strike | IV (%) |
|---|---|
| 180 | 30 |
| 190 | 29 |
| 200 | 28 |
| 210 | 27 |
| 220 | 26 |

The article's reading: IV **increases** as you move further OTM for puts, and **decreases** as you
move further OTM for calls. This reflects the market's perception that OTM puts — described as
similar to in-the-money calls — are more expensive due to higher risk of large downward moves.

Plotted with the X-axis at strikes 180/190/200/210/220 and the Y-axis at 26%/27%/28%/29%/30%, the
graph shows a **downward-sloping curve**: higher IV for lower strikes (OTM puts and ITM calls),
lower IV for higher strikes (OTM calls and ITM puts).

Why this is the equity default: the most common risk profile for stocks is that they trend upwards
and the risk of a big move is to the downside, and options prices reflect this.

*Source inconsistency, flagged not corrected: the stated spot is $500 but the ladder runs 180–220.
Take the shape and ordering from this table, not the strike-to-spot moneyness. The same ladder is
reused in the next two tables.*

#### Worked example 2 — flat skew

If the market believed a ticker's potential returns were normally distributed — equal chance of an
up move and a down move — the skew would be flat. Called uncommon but not impossible.

| Strike | IV (%) |
|---|---|
| 180 | 28 |
| 190 | 28 |
| 200 | 28 |
| 210 | 28 |
| 220 | 28 |

The reasoning in the author's framing. When there *is* a skew, it's because the market knows where
the risk is — the OTM puts are more expensive because if there is going to be a big move, it's
likely to be to the downside. But when OTM puts and OTM calls are the same price, the market is
saying it doesn't know which direction the stock will go if there is an outsized move.

This occurs when the odds of a small move, big move, up move and down move are basically the same.
The graph is a straight horizontal line. The article notes it **rarely occurs in equity markets
because of the inherent asymmetry in stock price movements**, and attributes the read to personal
experience: it shows up when the market is really uncertain about what will happen.

#### Worked example 3 — bullish / call skew

Seen particularly with stocks favored by retail traders — the named examples are **GME and AMC**.

| Strike | IV (%) |
|---|---|
| 180 | 25 |
| 190 | 26 |
| 200 | 27 |
| 210 | 35 |
| 220 | 40 |

The interpretation: retail traders are aggressively buying OTM calls, inflating their prices.
**Option sellers can take advantage of this by selling these overpriced calls.** The risk is to the
upside.

The article supplies the exact question to ask when comparing your view against the market's: if
GME is going to experience a massive move, is it more likely to be to the upside or the downside?

#### Worked example 4 — skew smile

The scenario: a biotech company with a pending clinical trial. Depending on the outcome, the drug
they have worked on for the last year is either approved for sale or denied. If approved, the share
price skyrockets. If denied, it crashes. **What is known for sure is that the share price should
change drastically.**

In these situations both the call and put OTM IV are higher than the ATM IV.

| Strike | IV (%) |
|---|---|
| 95 | 35 |
| 75 | 30 |
| 50 | 25 |
| 25 | 30 |
| 5 | 35 |

Read in ascending strike order — 5→35, 25→30, 50→25, 75→30, 95→35 — the strike at 50 is the trough
at 25, with both wings rising symmetrically to 30 and then 35. The author's description of the
plotted result: **"It's a smiley face."**

#### How to trade it

- **Call skew** — sell the overpriced OTM calls retail has bid up.
- **Deviation from a ticker's typical shape** — for most equities that shape is put skew. A
  deviation presents opportunity **if you expect the skew to revert to its typical shape**, and
  this is where **a risk reversal can become extremely profitable**.
- **Generally** — find where you disagree. The market prices in something, and the opportunity
  appears when you think it should be priced differently.

#### Practical rules

1. Classify the shape first — put, flat, call, or smile — then read it as two statements: where the
   risk is, and where the likely drift is.
2. Expect put skew as the equity baseline; treat deviation as the signal. Re-check often, since
   skew moves quickly on new information.
3. Use call delta rather than strike on the x-axis when comparing across tickers.
4. To disagree usefully you need both **(a)** how the dynamic works and **(b)** the ways it can
   present itself and what each implies — stated as the prerequisite for having an edge.

#### Predicting Alpha's specific / contrarian opinions

- **The expensive wing implies the opposite directional bias** — stated for both put and call skew,
  the inverse of how many traders read a rich put wing.
- **Call skew is a positioning read**, attributed to retail buying pressure in GME/AMC-type names
  rather than to a risk-neutral repricing.
- **Flat skew is a market admission of ignorance**, not a neutral default, and is rare in equities.
- Market-implied data is framed as a way to **aggregate the buying and selling pressures in the
  market** into a view of the distribution of future moves.

#### Notable direct quotes

> "But if the OTM puts and OTM calls are the same price, the market is saying to us 'I don't know
> which direction this stock will go if there is an outsized move'."

> "As traders, the way that we always want to be thinking about this is looking for areas where we
> disagree with it."

#### Tables/charts

Four IV-versus-strike plots — a downward-sloping curve (put skew), a horizontal line (flat), an
upward-sloping curve steepening at the top (call skew), and the U-shaped smile that prompts the
"smiley face" line.

#### Documented gaps

No risk reversal at any delta, no slope metric, no vol-points definition, no sign convention, no
sticky-strike/delta/moneyness, no index-vs-single-name values. The call-delta x-axis is named as a
practice, justified by put/call parity, with no method attached.

---

### How The Term Structure Impacts Option Selling Strategies: A Comprehensive Guide For Option Sellers
*Source: https://www.predictingalpha.com/blogs/term-structure-options*

Sean Ryan · September 25, 2024.

#### Core thesis

The **volatility surface** — how IV changes across all available option contracts for a ticker —
has exactly two parts:

1. **Skew**, which looks at changes in implied volatility across **strikes**.
2. **Term structure**, which looks at changes in implied volatility across **expirations**.

Term structure visualizes how IV changes across time. The market sets IV and option prices by
forecasting how much a stock should move in future; it may expect a lot of movement short-term and
little long-term, or the reverse. **These insights can only be interpreted by visualizing the term
structure.**

#### Key takeaways (the article's own three)

- **What the term structure says:** it tells us how much volatility the market expects over
  different time periods, and whether the market expects more or less volatility in the future.
- **Different term structure shapes:** typically one of two — **contango** and **backwardation**.
  Contango appears in "normal" market conditions. Backwardation appears when there is a high level
  of realized volatility right now.
- **Term structure highlights where events are:** a spike on one of the expirations usually means
  there is an event — earnings, product releases, and so on — around that point in time.

#### Definitions

**What is plotted:** for each expiration, the **at-the-money implied volatility**. Putting them all
on one chart lets you derive how the market expects the underlying's volatility to behave over
different time periods.

**Contango** — the expirations with fewer days to expiration have lower implied volatility compared
to the longer days-to-expiration options. This tells us the market expects implied volatility to
**increase** over time.

**Backwardation** — when shorter dated expirations have a higher implied volatility than the longer
dated expirations.

**Volatility clustering** — when volatility spikes, it tends to stay high for a little while before
coming back down towards its mean. Cited as one of the volatility characteristics covered elsewhere
in the course.

**Mean reversion** — also cited as one of the well-known behaviors exhibited by volatility, and
used as the explanation for contango.

#### Formulas

None. No slope metric, no numeric definition of "steep," no threshold for calling a curve inverted.

#### Numbers, thresholds & rules of thumb

**SPY on a regular day** — the normal shape, described as what traders should expect assuming the
world isn't coming to an end: the shorter day-to-expiration options typically have a **lower**
implied volatility than the longer day-to-expiration options.

**S&P 500 contango example:**

| Expiration | IV |
|---|---|
| Near-term (e.g. **10 DTE**) | low |
| Long-term (e.g. **1 year DTE**) | higher, closer to the historical mean of **around 15** |

The reasoning: if IV sits on the lower end of the range in which it oscillates, it makes sense the
market would anticipate some increase in future, bringing it closer to the mean IV it moves around.

**GameStop, June 2024 — the backwardation example.** Context given: GameStop had seen massive
moves, with huge daily changes in share price and everyone buying up options to get a piece of the
action.

| Expiration | IV |
|---|---|
| Near-term (e.g. **10 DTE**) | very high |
| Long-term (e.g. **1 year DTE**) | lower |

The justification is clustering: over the near term the stock will move a lot, but over a longer
horizon it should on average move less.

**The event-contribution figure — the module's key quantitative claim:** for the closer dated
expiration, **almost 35% of the implied volatility is entirely due to the earnings event.** That is
why the difference between the green and blue data points is so large for the **10 DTE** options.

#### Worked example — locating an event on the curve

The article's arithmetic for reading an earnings date off the term structure:

- An earnings event happens **20 days** from now.
- The **10 DTE** options are **not impacted** — by the time they expire the event will not yet have
  occurred.
- The **30 day** options still have time remaining when the event occurs, so the movement caused by
  the event **will** impact them.

Result on the plot: the expiration that does not see the event has lower IV than the expiration
that follows, which has the most exposure to it. Then, moving further out in time, IV **begins to
come back down** — because even though those longer-dated expirations also see the event, its
impact is **diluted** by the many non-event days priced into the expiration. The logic behind this
dilution is routed to the synthetic-time article covered next.

#### Tables/charts

- A "rather crude drawing" of the general term structure shape.
- The real SPY term structure on a regular day.
- The GameStop June 2024 term structure showing backwardation.
- A schematic of the event spike across expirations.
- **The two-curve comparison chart** — the "normal" term structure plotted against the
  **"non-event" term structure**, which removes the impact on IV caused by the earnings event,
  drawn as green and blue data points. The gap is largest at 10 DTE (the ~35% figure) and
  diminishes as DTE increases, because post-event expirations are less impacted and the difference
  between event and non-event volatility becomes minimal.

#### How to trade it

The term structure always plays a role, because a big part of the structure you choose is the
days-to-expiration you select. The three applications:

| Trade thesis | Expiration to use |
|---|---|
| Trading **implied vs realized** volatility | **shorter DTE** expirations |
| Trading a **change in the level** of implied volatility | **longer DTE** expiration |
| **Calendar spreads** | a third insight available immediately from the term structure |

Regardless of which you pick, the article says to be aware of the market's view on the current
level of IV, and to know whether there are upcoming earnings or other "volatility driving" events
that your chosen expiration is exposed to.

#### Practical rules

1. Plot the term structure for your candidates, identify the shape, and locate the next earnings
   event from the spike.
2. Check explicitly whether your expiration is exposed to a volatility-driving event.
3. Choose DTE from the trade thesis — short for implied-vs-realized, long for level changes.
4. Remember the dilution effect: the same event contributes progressively less IV as DTE grows.

#### Predicting Alpha's specific / contrarian opinions

- Term structure is a **diagnostic instrument** — reading the market's volatility expectation and
  locating events, not just pricing.
- **Expiration selection is a first-class decision** driven by which exposure you actually want.
- "The market is pretty smart, so option prices will typically reflect this too" — a stated
  presumption that the curve's shape is informative rather than an error to be arbitraged.

#### Notable direct quotes

> "volatility clusters. This means that when volatility spikes, it tends to stay high for a little
> while before it comes back down towards its mean."

> "for the closer dated expiration, almost 35% of the implied volatility is entirely due to the
> earnings event"

#### Documented gaps

No slope numbers per DTE bucket, and no IV-by-DTE table beyond the qualitative two-row examples
above ("low", "very high"). The only hard level quoted is the S&P's historical mean of **around
15**. No threshold for when a curve counts as inverted, and no diagonal-spread or front-month-sale
playbook — the three applications above are the complete trading guidance.

---

### Understanding Volatility as Synthetic Time: Advanced Option Selling Lesson
*Source: https://www.predictingalpha.com/blogs/implied-volatility-over-time*

Sean Ryan · September 5, 2024.

#### Core thesis

**Volatility and time are the same thing.** The author calls learning this mind-blowing, and says
it changed how he thinks about how options reflect IV over time. Once you understand volatility as
synthetic time, you can understand how structures like calendar spreads work and how **changes in
the term structure can be measured and forecasted** — which the article claims unlocks an entirely
new world of trading that **99% of retail option sellers** don't even know exists. That claim
appears twice, opening and closing.

#### Key takeaways (the article's own two)

1. **Volatility as synthetic time:** higher implied volatility compresses time by increasing the
   range of potential daily price movements. This makes options behave as if they have more time
   until expiration, reducing theta (time decay) and gamma (rate of change of delta).
2. **Practical application — earnings trades:** if IV spikes before an earnings announcement,
   options behave like they have more days to expiration, showing less sensitivity to daily
   movements. The conclusion drawn: **this is why, even though realized volatility before the event
   is low compared to implied, we do not realize much return until the event passes.**

#### The exact arithmetic

This is the one place in the module where real arithmetic is given. Transcribed as stated:

- Imagine a stock that can only move up or down by **1% each day**. If a stock can move up or down
  1% daily, **over 30 days**, this results in an annualized IV of about **16%**.
- Restated: when the movement is defined as 1% daily, this equals an implied volatility of **16%**.
- Question posed: with 1% daily moves, where could the stock end up in **4 days**? A **binomial
  tree** is constructed to show the range of possible moves.
- Answer: over a **4 day** period the stock ends up in a range between **+4% and −4%** of its
  current value.
- Next question: if we doubled the volatility, how long to reach ±4%? Adjusting to **2% daily
  moves** — stated as **32% implied volatility** — the same range is reached in **2 days** instead
  of four.
- **The stated rule: when we double the volatility, the time to realize the same range is cut in
  half.**

| Case | Daily move | Implied volatility | Days | Range reached |
|---|---|---|---|---|
| A | 1% | 16% | 4 | +4% / −4% |
| B | 2% | 32% | 2 | +4% / −4% |

**The conclusion drawn:** increasing time or increasing volatility has the same impact on the value
of an option. The reason time and volatility can be thought of as equal is that **they both change
the range of potential moves a stock can experience** — they both result in the same impact on the
underlying.

**Important limit on this arithmetic.** The article gives the 1%-daily ↔ 16% mapping on a
**30-day** basis and calls the result annualized, but it **states no annualization convention** —
no trading-day count, no square-root-of-time rule, no formula. Do not supply one; the article does
not have one. The tree is an intuition device, and the doubling rule is stated for the range the
tree reaches.

#### Practical demonstration — non-uniform theta

The setup: a ticker with an upcoming earnings event has some days of "non-event volatility" priced
into its options, **plus a single day with a much larger implied move** — the earnings day.

That sentence is the module's decomposition, and it is given **in words only**. There is no
equation, no statement that the addition happens in variance space, and no method for inverting it
to back out the event's implied move.

The key observation about the accompanying image: even though there are **30 days to expiration**,
**the theta for each day is not evenly distributed.** This explains why option values change so
little as the earnings event approaches, and so much after it has passed.

The mechanism: anticipation of significant stock movement around earnings causes IV for the
**entire expiration** to spike, making the options behave as if they have more time until
expiration. **The option decays slowly.**

Once the event has passed, that **"12% day"** in the image is no longer priced into the chain.
Implied volatility decreases drastically — **which is equivalent to time decreasing** — and the
option returns to the regular theta decay you would expect for that ticker with that many days to
expiration.

#### Worked example — Netflix

- **Trader:** Ronald, one of the Predicting Alpha community members.
- **Underlying:** Netflix (NFLX).
- **Action:** sold volatility **10 days before** its earnings announcement.
- **Structure:** a **short straddle**, which is **long theta and short gamma**.
- **Observed:** despite having a lot of short volatility exposure, his P&L **barely moved**,
  fluctuating by only small amounts daily as the event approached. He couldn't piece together why
  until he understood volatility as synthetic time.

The explanation is stated as a counterfactual: **if the volatility had been evenly distributed
across the expiration, the position should have been realizing some returns.** But because implied
volatility remained elevated — with all of the movement concentrated on the earnings date — there
was very little change in the position's value. The options behaved more like longer-dated ones,
showing less sensitivity to daily movements, hence the minimal daily P&L.

#### How to trade it

The article names the unlock rather than a playbook: synthetic time is what lets you understand
**how calendar spreads work** and how **changes in the term structure can be measured and
forecasted**. No entry rules, strikes or DTEs are specified.

#### Practical rules

1. Don't judge a pre-event short-volatility position by its daily P&L — flat is expected behaviour,
   not a broken trade.
2. Don't expect calendar-uniform theta when an event sits inside the expiration; decay concentrates
   on the event day, and elevated IV means less theta and less gamma throughout.
3. Treat the post-event IV collapse as **time decreasing**, and expect theta to normalize
   immediately afterwards.

#### Predicting Alpha's specific / contrarian opinions

- **Time and volatility are the same variable** — the article's central revelation.
- **Theta is not a daily drip when an event sits in the expiration.** It is concentrated, which
  contradicts the standard teaching that theta accrues smoothly into expiry.
- The claim that this is unknown to **99% of retail option sellers**.

#### Notable direct quotes

> "When we double the volatility, the time to realize the same range is cut in half."

> "even though there are 30 days to expiration, the theta for each day is not evenly distributed."

#### Tables/charts

- A binomial tree for the 1%-daily case over 4 days reaching ±4%, and a second for the 2%-daily
  case reaching the same range in 2 days.
- An image of an expiration's daily implied moves showing ordinary non-event days alongside the
  single **"12% day"** for earnings — the visual carrying the whole decomposition argument.
- A theta-by-day illustration showing decay is not evenly distributed across the 30 days.

#### Documented gaps

No synthetic-time weighting scheme: no "vol day" count for a weekend, holiday, earnings day or Fed
day, no trading-vs-calendar-days discussion, no calendar-to-business-time conversion formula, and no
annualization convention behind the 16%. The event/non-event split is prose only — base days
**plus** one much-larger-move day, illustrated by a **12%** event day inside a **30 DTE**
expiration. The arithmetic present is the tree and the doubling rule, nothing more.

---

### What this module does not contain

So nothing downstream attributes standard vol-surface theory to this course. The module teaches
skew and synthetic time **qualitatively**; it has no quantitative machinery for either.

1. **No skew measurement convention** — no risk reversal at any delta, slope, vol-points metric,
   sign convention, or sticky-strike/delta/moneyness. Only the **call-delta x-axis**, justified by
   put/call parity, with no method attached. No index-vs-single-name values.
2. **No term-structure slope numbers** and no threshold for calling a curve inverted. Only "around
   15" as the S&P's long-dated mean.
3. **No synthetic-time weighting scheme** — no vol-day counts for weekends, holidays, earnings or
   Fed days, no trading-vs-calendar-day conversion, no annualization convention behind the 16%.
4. **No event-variance algebra.** The decomposition is prose only: non-event days **plus** one
   much-larger-move day, sized by a **12%** event day in a **30 DTE** expiration and **almost 35%**
   of the near-dated IV. No equation, nothing about variance additivity.

## Module 8 — How to Make Money Selling Options (Part A: Strategy Development)

> Built from the local full-text corpus in `pa-text/`. Every figure below appears in the source
> text. Where an article states no formula, threshold, or parameter, this document says so
> explicitly rather than supplying one. Several key tables in the calendar article exist only as
> images and carry no numbers in the text — those are flagged in place.

---

### Mastering Option Selling Strategy Development: Creating A Profitable System
*Source: https://www.predictingalpha.com/blogs/option-selling-strategy*

Sean Ryan · September 23, 2024

#### Core thesis

A strategy is "a reproducible idea that you can bet on consistently" — an approach that, applied
systematically, produces profitable outcomes over time. The article is framed as a path "from
thesis all the way to execution," and its structure is a four-part test: thesis, testing, positive
expected value, risk management. The second theme is survival: since any real strategy has
drawdowns, the only way through them is understanding the long-term expectancy of the decisions you
are repeating.

#### Definitions

- **Strategy** — a reproducible idea you can bet on consistently.
- **Reproducibility** — you can apply it multiple times under similar conditions and expect similar
  outcomes. The stated counter-example is the **USO debacle of March 2020**, when oil prices were
  extremely mispriced. Profitable, but a *unique opportunity*, not a strategy: such events "can't be
  relied upon for consistent returns. True strategies need to offer steady, repeatable opportunities
  to trade."
- **Risk management** — "the science of balancing drawdowns with maximizing your returns." It
  "comes into play once we know that we have an edge."

#### The four core components

1. **Thesis** — a rationale for why the strategy should work.
2. **Testing** — historical data analysis to validate the strategy.
3. **Positive Expected Value** — the strategy should generate profits over the long run.
4. **Risk Management** — a system to control and limit losses.

#### Formulas

**None.** The article contains no mathematics. Expected value is discussed only in words.

#### Numbers, thresholds & rules of thumb

The fully-specified strategy definition:

| Parameter | Value |
|---|---|
| Action | Sell 30-day expiration **delta 20 strangles** on the S&P 500 |
| Frequency | **Roll the position every 20 days** |
| Risk management | **Never risk more than 25% of your bankroll** |

**Discrepancy present in the source, not resolved by it.** The Step 4 risk-management passage says
never risk more than **30%** of bankroll on any single trade. The formal strategy definition a few
lines later says **25%**. Both numbers are in the article. The 25% figure is the one in the final
specification.

The performance illustration runs **2020 to 2080**. No other numbers appear in the article.

#### Worked examples with the real figures

**Poker.** Go all-in every time you are dealt pocket aces. Charted, the P&L shows "a high degree of
variance," but pocket aces is the best hand pre-flop, so getting your chips in gets you "into a nice
sized pot with an advantage." The article states the caveat directly: this assumes "you have the
ability to reload your bankroll."

**The VRP strategy through the four steps** — selling delta 20 strangles on the S&P 500:

1. *Thesis* — based on "the need for downside protection in equity markets. By selling insurance
   (strangles), traders can earn a premium, assuming the risk of outsized moves."
2. *Testing* — acknowledged as challenging. Suggested resources: research papers, historical data,
   your own backtests, and (with a self-aware "*cough*") the Predicting Alpha Terminal.
3. *Positive expected value* — the backtest for selling 30-day strangles on the S&P 500 "shows a
   gradual increase in P&L, indicating a positive expected value."
4. *Risk management* — cap per-trade risk so capital is protected during downturns.

**The drawdown argument.** Over 2020–2080 the P&L "might look impressive when viewed over decades,"
but zooming into shorter periods reveals drawdowns. The conclusion: at any point in time "we are
just a dot on our PnL curve." The model for holding through one is the S&P 500 itself — when the
market draws down, people don't close their long equity portfolios, because "they have seen this
before. They understand how the S&P moves. They expect drawdowns." The instruction is to build the
same expectation for your own strategies.

#### Tables/charts

Four images, none captioned with values in the text: the poker all-in P&L curve; the long-horizon
(2020–2080) strategy P&L; the same curve zoomed in to show drawdowns; and one image in the opening
section.

#### Named strategy examples

Buy and Hold · Value Investing · Trend Following · **Systematic Volatility Selling** (selling
volatility on a basket of ETFs that exhibit positive variance risk premium — "hint: we do this at
Predicting Alpha") · **Systematic Volatility Selling Around Earnings** (a basket of stocks with an
upcoming earnings event — "hint: we also do this at Predicting Alpha").

#### Mechanical rules you could code

One rule set, given as the illustrative example:

```
UNIVERSE:   S&P 500
ENTRY:      sell 30 DTE strangle, both legs at delta 20
ROLL:       every 20 days
SIZING:     risk <= 25% of bankroll   (article also says 30% in an earlier passage)
```

Not given: any entry filter or signal, profit target, stop, adjustment rule, or exit other than the
20-day roll. The roll is unconditional and time-based.

#### Practical rules

- Judge an idea by whether the setup recurs. A one-off is an opportunity, not a strategy.
- Write the thesis first — you need a reason you are getting paid.
- Understand the *extent* of the possible drawdown before trading, not merely that one will occur.
- A defined rule set removes emotion: with clear rules "you're less likely to make impulsive
  decisions based on fear or greed."
- Establish edge first, then apply risk management to extract it — that ordering is explicit.

#### On the research-process questions in the brief

The brief asked for hypothesis, data, sample size, edge measurement, transaction-cost and slippage
assumptions, and pre-trade validation. **The article states none of these.** It names the four
components conceptually and says to backtest. There is no dataset, sample period, sample-size
requirement, edge statistic, cost or slippage assumption, or out-of-sample protocol anywhere in the
text. Documented absence.

#### Predicting Alpha's specific/contrarian opinions

- Testing options strategies is genuinely difficult; no canonical dataset is claimed.
- Edges get hidden once found: "when someone finds an edge, they protect it!"
- The closing paragraph carries several uncorrected typos, a sign the piece was published unedited.

#### Notable direct quotes

> "A strategy is a reproducible idea that you can bet on consistently."

> "We have to accept that even in a profitable strategy, at any point in time we are just a dot on
> our PnL curve. There will be drawdowns, and we need to be ready for them."

> "Risk management is the science of balancing drawdowns with maximizing your returns."

---

### How to Run A Calendar Spread Strategy: A Guide for Option Sellers Looking To Trade Calendars Like a Professional
*Source: https://www.predictingalpha.com/blogs/calendar-spread-strategy*

Sean Ryan · August 27, 2024

The article opens with a warning: it targets professional traders, "this content is challenging,"
and calendar spreads are "intricate financial structures." Because most traders lack a deep
understanding of the dynamics, "it's uncommon to find retail traders executing them correctly." The
author states his conviction plainly — there is significant potential here, few traders go this
deep, and "for those willing to invest time in identifying mispriced forward volatility, there are
certainly substantial opportunities to be found."

#### Core thesis

A calendar spread is **not** simply a bet on the stock sitting still, and it is **not** genuinely
long vega. It is a relative value trade between gamma and vega — "I'm short gamma and hedging with
vega" — equivalently a bet on **forward volatility**. The central technical claim is that a calendar
is **root time flat**: when the term structure moves in its normal square-root-of-time fashion, the
vega P&L across tenors cancels and you neither gain nor lose from vega. All vega edge therefore
comes from **non-root movements**, typically a dated event sitting inside one expiry and not the
other.

#### Definitions

- **Calendar spread** — buy and sell the **same strike** option across **two different expiration
  dates**.
- **Long calendar spread** — **sell the option with the closer expiration, buy the option with the
  later expiration**. Stated example: sell an AAPL **July 150 strike call**, buy a **September 150
  strike call**.
- **Short calendar spread** — the inverse: buy the front-month option, sell the back-month option.
- **Max loss (long calendar)** — a debit position, so the most you can lose is what you paid. In the
  article's example: **$3.40, or $340/lot**.
- **Term structure** — "the pattern of implied volatility across different expirations or tenors."
- **Root time movement** — how the term structure "usually" moves. "By 'root,' we mean the square
  root." Short-dated options are more sensitive than longer-dated ones, sensitivity meaning how much
  they move in implied volatility terms.
- **Root time flat** — "if normal volatility movements occur across the term structure, we neither
  lose nor gain money due to our vega exposure."
- **Volatility cone** — "shows where implied volatilities have historically been for different
  tenors, providing insight into whether current volatilities are rich or cheap."

#### Greek profile — initial exposures of an ATM calendar spread

| Greek | Sign | As stated |
|---|---|---|
| Delta | **Neutral** | "we are indifferent to the stock's price direction" |
| Gamma | **Short** | "Rapid price movements can negatively impact our position" |
| Theta | **Long** | "the passage of time will generate profit for us" |
| Vega | **Long\*** | "An increase in implied volatility will benefit our position" |

The asterisk is the article's own, and it is the hinge of the whole piece: traders "often assume
that this position is long vega. This is a common mistake."

The naive summary the article then dismantles: at first glance a calendar looks profitable if the
market stays stable or IV rises significantly, and looks likely to lose if the stock moves sharply.

#### Formulas

**1. Root-time propagation — stated in words only.** The article's sentence:

> "A 1-year volatility change of 10 points translates to changes in shorter-term volatilities by the
> square root of the ratio of days in a year to days until expiration, multiplied by the annualized
> volatility change."

The equation itself follows as an **image**; the text carries no symbolic form. Reading the sentence
literally gives `Δσ(DTE) = sqrt(days_in_year / DTE) × Δσ(1yr)`, but that is the prose transcribed,
not a formula printed in the article.

**2. Vega P&L — stated.**

> "Call PnL = Point increase × Vega"

Calibrated by the article's own example: an option with vega 10, IV rising 1 point (30 to 31),
profits `1 × 10 = $10`. So vega here is dollars per contract per 1 IV point.

**3. Forward volatility — explicitly NOT given.** The author declines it:

> "I won't delve into the math here, but you can easily find the forward volatility formula online.
> It's also something calculated for you in the Predicting Alpha Terminal."

He states only the result: 30-day IV of 40% and 90-day IV of 35% give a **30/90 forward volatility
of 32%**. No forward-variance equation appears anywhere in the article. Do not treat any
forward-variance identity as sourced from this piece.

#### CRITICAL — the numeric tables are images with no values in the text

Three exhibits central to the argument exist **only as images** and carry **no readable numbers** in
the source text:

1. The **root-time formula** itself.
2. The **calculated multipliers** per tenor — the text says only "Here are the calculated
   multipliers:" followed by an image, then "Using these multipliers, the new volatilities are:"
   followed by another image.
3. The **PnL breakdown for each expiration** — "Here's the PnL breakdown for each expiration:"
   followed by an image.

The multiplier values, the post-shock IVOL levels, and the per-expiration dollar P&Ls are
**unavailable**. The article's conclusion about them *is* in the text: "All the call options
generated nearly the same amount of money, with slight differences due to rounding errors."

#### Numbers, thresholds & rules of thumb

**AAPL ATM call vega by tenor** — the one numeric table that is real text:

| Tenor | Vega |
|---|---|
| 30-day | 17 |
| 60-day | 24 |
| 90-day | 29 |
| 120-day | 34 |
| 365-day | 59 |

Presented to show that "vega also follows a root time pattern through the option chain."

**Not given anywhere in this article** — and these are exactly the parameters the study brief asked
for:

- **No recommended front/back DTE pairs.** July/September and the 30/60/90/120/365 ladder are
  illustrations only.
- **No strike-selection rule.** "ATM" scopes the greek discussion; there is no delta target,
  moneyness band, or strike rule.
- **No management or exit rules.** No profit target, stop, roll trigger, time-based exit, or
  adjustment procedure.
- **No entry threshold** on forward vol, term-structure slope, or richness.
- **No position sizing.**

#### Worked examples with the real figures

**1 — Forward volatility setup.** Today is June 1st. July 1st expiration IV = **40%** (30 days out);
September 1st expiration IV = **35%** (90 days out). The market implies 40% volatility over the next
30 days and 35% over the next 90. The **30/90 forward volatility is 32%**. Buying this calendar
means "purchasing forward volatility at 32%."

**2 — The relative value mechanics.** July has "significantly more gamma"; September has "more
vega." You sold July at 40% IV and bought September at 35% IV, locking in 32% forward vol. If
realized volatility over the next 30 days is **40%**, July is break-even and everything hinges on
September: "If the September expiration is trading higher than 32%, we will have profited from the
calendar spread. If it is trading below 32%, we will have incurred a loss."

Two further scenarios:

| RV over next 30 days | July (gamma leg) | September (vega leg) |
|---|---|---|
| **60%** | loses — sold at 40% vol | "should be trading at a much higher volatility" |
| **10%** | "profit significantly" — sold 40%, realized 10% | IV "will decrease substantially" → loses |

"A significant portion of the PnL for July comes from gamma, whereas most of the PnL for September
comes from vega." The QQQ IVOL/RVOL chart establishes the correlation that makes this a genuine
relative-value trade: the strong correlation "indicates that it is uncommon to lose money on both
the gamma and vega legs or to profit from both… Instead, you are trading the relative value or
'richness' of one leg compared to the other."

**3 — The root-time shock.** Start from a flat term structure with **30-day, 60-day, 90-day,
120-day and 365-day IVOL all at 30%**. The event: "China deciding to halt international trade with
the USA." The **365-day IVOL jumps 10 points, from 30% to 40%**. The multipliers and resulting
volatilities are images (see above). The outcome, in text: every call generated nearly the same
amount, so "the shock to volatilities left us with no net gain!" The calendar is not long vega; it
is root time flat.

**4 — Fading a non-root move.** Some traders exploit deviations from root time. The article's case:
"if the 90-day IVOL only moved to **45%** after the shock, they would buy options with that
expiration and sell options with surrounding expirations using a calendar spread."

**5 — The event trade ("Free Alpha").** A tip that a pharmaceutical company will release a new drug
on **September 1st**. The chain shows **July 30%, August 30%, September 30%, October 30%**. Given
the anticipated news, September "should be trading at a higher volatility than the July and August
contracts, but they are not!" The trade: **sell August volatility, buy September volatility.** When
the market prices the release, September might rise **30% to 40%** while August is unchanged — a
non-root movement. In forward-vol terms you bought the Aug/Sep forward at 30% (August 30% and
September 30% = 30% forward), and with the new information the forward is much higher (August 30%
and September 40%).

**6 — The reverse calendar via volatility cone.** Observed: **IV30 = 80%** and **IV120 = 80%** —
flat at a high level — while "the stock is realizing a volatility of around **100%**." Read:
longer-dated volatilities are overpriced relative to short-term ones. The trade is a **reverse
calendar spread — selling the back month and buying the front month.** "This trade expresses the
view that gamma is cheap relative to vega."

#### Tables/charts

- **Basic long calendar spread** — the structure whose max loss is $3.40 / $340 per lot.
- **Forward volatility diagram** — accompanying the June 1st / July / September setup.
- **QQQ IVOL vs RVOL** — establishes the correlation making the two legs anti-correlated in P&L.
- **AAPL 30DTE/90DTE forward volatility timeseries** — "so you can see what it looks like over
  time." No values in text.
- **AAPL term structure on two different days** — the describing text is an unfilled template: "the
  30-day options are trading at **X%**, and the 90-day options are trading at **Y%**." The
  placeholders were never replaced. The stated observation is that over a one-week period,
  volatility across the term structure decreased.
- **Root-time formula · multipliers · new volatilities · post-shock term structure · PnL breakdown**
  — five images, all numerically unavailable.
- **Volatility cone** — for the IV30 = IV120 = 80% reverse-calendar example.

#### Mechanical rules you could code

Only two computations are stated concretely enough to implement:

```
CONSTRUCTION
  long calendar  = SELL front expiry @ strike K, BUY back expiry @ same strike K   (debit)
  short/reverse  = BUY front expiry @ strike K, SELL back expiry @ same strike K
  max loss (long calendar) = debit paid            # $3.40 quoted -> $340 per lot

VEGA PNL
  pnl = point_increase * vega        # vega in $ per contract per 1 IV point

DIRECTIONAL RULES (stated, but with no numeric thresholds attached)
  event inside back expiry not priced into it   -> sell front, buy back        (Example 5)
  term structure flat AND front IV << realized  -> reverse calendar            (Example 6)
  one tenor lagging the root-time move          -> buy it, sell its neighbours (Example 4)
```

Everything else needed to trade this — DTE pairs, strike selection, the forward-variance
computation, entry thresholds, sizing, exits — is **not given**. The forward-vol number is presented
as something the Predicting Alpha Terminal computes for you, not something the article teaches you
to compute.

#### Practical rules

- Do not read a calendar's vega off the greek sheet and conclude you are long volatility. Under a
  normal term-structure move you are flat.
- Translate the two legs into a single forward volatility and decide whether you want to own or sell
  that number — that is what you are actually trading.
- Look for dated catalysts that one expiry contains and the adjacent one does not, then check
  whether the chain has priced the difference.
- Use a volatility cone to judge richness or cheapness across tenors.
- Compare front-month IV against *realized* volatility, not only against the back month, to see
  whether gamma is cheap relative to vega.
- To experiment with calendar P&L: in Thinkorswim's **"Analyze"** tab, click the small **gear icon**
  in the right corner, select **"More parameters,"** and adjust volatility levels up and down to
  observe how P&L changes.

#### Predicting Alpha's specific/contrarian opinions

- **"This complexity is why calendars shouldn't be traded by most traders."** An explicit
  discouragement, mid-article, about the very structure being taught.
- The long-vega assumption is named as "a common mistake."
- Because IVOL and RVOL are strongly correlated, winning or losing on both legs is uncommon — the
  trade is structurally relative-value.
- Knowledge alone is not edge: "merely knowing this information won't make you money."
- Alpha comes from creativity and idea generation; options knowledge is what lets you identify new
  areas to explore and monetize ideas effectively.
- The author rates this "the most intricate part of the series so far."

#### Notable direct quotes

> "Think of it as 'I'm short gamma and hedging with vega.'"

> "Being root time flat means that if normal volatility movements occur across the term structure,
> we neither lose nor gain money due to our vega exposure."

> "For those willing to invest time in identifying mispriced forward volatility, there are certainly
> substantial opportunities to be found."

---

### How to Sell Options Profitably When IV Rank is Low
*Source: https://www.predictingalpha.com/blogs/iv-rank*

Sean Ryan · August 26, 2024

**Scope warning:** despite the URL, this article never defines IV Rank. It critiques it. See the
documented absences below before using it as an IV Rank reference.

#### Core thesis

IV Rank and IV percentile are built on historical data, so when the market moves from a high-vol
regime into a low one, today's volatility "will appear significantly cheap because in absolute terms
it is lower than what was observed over the last year" — even though under the new environment it
may be entirely reasonable for volatility to stay at the new levels. "Typical metrics such as IV
rank and percentile won't work, since they rely on the historical data." The replacement is to price
volatility as a **ratio** (IV/RV) and to **benchmark against an efficiently-priced reference
series**. As a percentage of implied volatility the variance risk premium is roughly constant across
regimes, so a calm market offers essentially the same opportunity: "Nothing really changes."

#### Definitions

- **IV/RV ratio** — implied over realized volatility, the transformation that makes premium
  comparable across regimes. The working measure is **IV30/RV20**.
- **Benchmark** — an efficiently-priced reference whose IV/RV ratio represents what a ticker's ratio
  *should* be. "The benchmark is meant to effectively represent what the implied/realized volatility
  ratio for a ticker like the one you are trading should be."
- **Volatility regime** — the prevailing environment, and the reason backward-looking metrics
  mislead across a transition.

#### Formulas

The article gives **no equations**. Its quantitative content is three stated relationships:

- The ratio itself: **IV30 / RV20**.
- The S&P benchmark level: "For the S&P, this ratio is typically around **1.3** (IV is 1.3 times
  RV)."
- The beta adjustment, in words: "**Multiply the beta by the benchmark vol** to get a more accurate
  fair value."

Correlation is used to adjust: "Use the correlation between the asset and the S&P to adjust the
IV/RV ratio."

#### Numbers, thresholds & rules of thumb

| Quantity | Value |
|---|---|
| VIX, a couple of years ago | 25 or higher |
| VIX, now | 15 |
| S&P benchmark IV/RV ratio | **~1.3** |
| Measurement windows | IV30 against RV20 |
| SPY ratio chart period | last two years |
| The one stated danger threshold | VIX above the **80th percentile** |
| Mustang analogy speeds | slowing to 40 or 50 |

The 80th-percentile claim is the article's sharpest and most codeable statement:

> "one could argue that the real time when you shouldn't be selling options is if the vix is about
> the 80th percentile. Even though this is when the VRP is the highest in absolute terms, it is also
> when you experience the most variance. So if there were going to be a time when you could 'blow
> up', this would be it."

#### Worked examples with the real figures

**SPY over two years.** The IV30/RV20 ratio is plotted for the last two years, a period over which
the VIX dropped from about **25 to 15**. Despite "this massive decline in the level of volatility,
indicating a change in the volatility regime, we continue to see the IV/RV ratio oscillate within
the same range." A second chart puts implied volatility and the ratio side by side: "Even as the
implied volatility drops, the ratio remains in the same range."

**The VIX variance risk premium table.** The article's evidence base. Its stated reading:
"regardless of what level the VIX is at, the variance risk premium is present and as a percentage of
the implied volatility it is constant." No bucket boundaries or premium values appear in the text —
the table is an image.

**Apple vs SPY.** The two IV/RV ratios plotted together: "the ratio for AAPL had recently deviated
significantly from SPY, and then began to come back in line with it." Divergence is the opportunity,
convergence the payoff. No entry threshold or trade figures are given.

**The Mustang analogy.** Rent a Mustang and drive at high speeds; returning to the neighbourhood and
slowing to 40 or 50 "feels like you're crawling, even though you're still moving at a dangerous
speed." The stated application: it "perfectly illustrates what trading in a lower volatility
environment feels like, especially coming out of a situation like Covid."

#### Tables/charts

Seven images, none with values in the text: the Mustang illustration; a regime-transition exhibit; a
section image for Method 1; the VIX-vs-VRP table showing the premium constant as a % of IV; the SPY
IV30/RV20 two-year series; IV level and IV/RV ratio side by side; and SPY vs AAPL IV/RV.

#### Mechanical rules you could code

```
RATIO
  ratio(ticker) = IV30(ticker) / RV20(ticker)

BENCHMARK SELECTION
  # stated: don't reflexively use the S&P for single names
  benchmark = the major ETF most correlated with the ticker being analyzed

FAIR VALUE
  benchmark_ratio(S&P) ~= 1.3
  fair_value_vol = beta(ticker vs benchmark) * benchmark_vol

SIGNAL (direction only -- no threshold given)
  ratio(ticker) >> ratio(benchmark)  -> trading at a premium
  ratio(ticker) << ratio(benchmark)  -> trading at a discount

REGIME GUARD
  if VIX > 80th percentile: this is when you could blow up
```

Not given: the deviation size that triggers a trade, the correlation floor for accepting a
benchmark, the VIX percentile lookback, position sizing, or exits.

#### Practical rules

- Ask whether IV is low relative to what the underlying is actually realizing, not whether it is low
  in absolute terms. The ratio survives a regime change; the level does not.
- Do not default to the S&P as benchmark for a single name. The S&P is used when explaining this
  analysis "because everyone understands that it is a fair representation of the market at large,"
  but individual tickers "may not share a great correlation with the overall market."
- Adjust for beta and correlation rather than comparing raw volatilities.
- Treat divergence between a name's IV/RV and its benchmark's as the setup, reconvergence as the
  thesis.
- Discount your own sense that markets are quiet — that is recency bias.

#### Documented absences — read before using this as an IV Rank source

The brief asked for five things. **None are present:**

1. **No IV Rank formula.** Named and criticised, never defined.
2. **No IV Percentile formula and no distinction** from IV Rank — they appear together once, as
   "typical metrics such as IV rank and percentile," and are dismissed jointly.
3. **No lookback window in days** for either metric. The nearest phrasing is "over the last year for
   example," which is illustrative. IV30 and RV20 belong to the ratio method, not to IV Rank.
4. **No IV Rank trading thresholds** — no sell-above / stand-aside-below levels.
5. **No backtest numbers** — no returns, win rates, sample sizes, or performance data.

The full critique of naive IV-rank trading is the regime-change argument plus the 80th-percentile
point, both captured above.

#### Predicting Alpha's specific/contrarian opinions

- **"The Idea That There's No Premium To Harvest When IV Is Low, is a Myth."** As a percentage of
  the implied volatility, the VRP is on average the same regardless of the level of implied
  volatility. The instruction is blunt: "Keep on selling."
- **High VIX is the dangerous regime, not low VIX** — around the 80th percentile, maximum absolute
  VRP coincides with maximum variance. This inverts the usual "sell when IV rank is high" advice.
- S&P volatility is "highly efficient due to its liquidity and the number of participants," which is
  what qualifies it as a fair-value reference.
- The benchmark section breaks off mid-sentence in the source ("The more accurately the benchmark
  you.") — the thought is unfinished in the published article.

#### Notable direct quotes

> "If we are coming out of a high volatility regime and moving into a low volatility regime, then
> today's volatility will appear significantly cheap because in absolute terms it is lower than what
> was observed over the last year for example."

> "even when the volatility environment is calmer, there is still ample opportunity to sell options.
> Nothing really changes."

> "When we are coming out of times where everything is high, something 'normal' will be indicated as
> low even though this may not be the reality. We can't allow our recency bias to influence us and
> trick us into thinking normal is low."

---

### Two Ways to Price Option Premiums: A Masterclass In Option Selling Strategy
*Source: https://www.predictingalpha.com/blogs/option-trading-masterclass*

Sean Ryan · September 15, 2024

#### Core thesis

"The entire game of trading options is about pricing the variance risk premium that is embedded into
the option price." Find where options trade at a different price than they should, and you have a
good trading opportunity. There are two ways to price them — compare an option's IV to where it has
been trading in the past (**absolute**), or compare it to the IV of similar options in the market
(**relative**) — and used together they give a clear picture of fair value.

The article scopes when to use this. Most of the time, forecasting option prices "isn't the ideal
way to go"; the default should be well-researched systematic programs like the ETF Premium Strategy
and the Earnings Premium Strategy. These sophisticated techniques are for the occasional unique
opportunity — "think meme stocks, short squeezes, etc" — where irrationality has pushed option
prices away from where they should be. The author frames them as "techniques that I learned from
years of trading alongside professionals" that "resulted in finding some of the best trading
opportunities that have made my year(s)."

#### Definitions

- **Absolute Valuation** — "Assessing an option's value based on its own historical volatility
  data." It works because "volatility is mean reverting, so by benchmarking against historical
  averages we can estimate the fair value of future volatility."
- **Relative Valuation** — "Comparing an option's volatility to that of similar assets." It compares
  the IV of one stock to similar stocks in the same sector; if two companies share similar
  volatility profiles, divergences in their implied volatility — "or if we go a level deeper, the
  risk premiums on each of them" — tell you whether volatility is mispriced for your target ticker.
- **Variance risk premium**, as measured here — `IV − subsequentRV`, in points.
- **IV/RV ratio** — "how great the spread between implied and realized volatility is today relative
  to the past." Stated property: "this ratio is **stationary & mean reverting**," which is what makes
  benchmarking to its average valid.

**The value investing analogy.** Value investors seek low price-to-earnings or price-to-book ratios;
option traders look for volatility mispricings, buying when volatility is cheap and selling when
expensive. But deciding what is cheap "is not so simple as saying volatility is 'low' or 'high'" —
you need a way to estimate fair value to benchmark against.

**The criticism of standard practice:** "Most option sellers take an overly simplistic approach to
this. They will simply look at the IV for an option and see if it's higher or lower than where it's
been in the past. But this doesn't really work because it doesn't tell us where the option price
should be."

#### Formulas

No equations are printed. Three relationships are stated in words:

- **Absolute:** compare the current `IV − subsequentRV` to its historical level.
- **Absolute, ratio form:** compare today's IV/RV ratio against its own average.
- **Relative:** judge a target's IV against a historical multiple of a correlated comparable's IV.
  The only instance of that multiple: DISCA "typically trades at **1.2 times** FOXA's IV."

#### Numbers, thresholds & rules of thumb

| Quantity | Value | Where |
|---|---|---|
| Current VRP, illustrative | **8 points** | absolute valuation |
| Historical VRP, illustrative | **~5 points** | absolute valuation |
| Correlation between DISCA and FOXA | **80% over the past year** | DISCA trade |
| DISCA's typical multiple of FOXA IV | **1.2×** | DISCA trade |
| FOXA IV at the time | **48%** | DISCA trade |
| DISCA implied fair value | **~58%** | DISCA trade |
| DISCA actual IV | **83%** | DISCA trade |
| Coca-Cola IV, hypothetical | **20%** | KO/PEP example |
| Pepsi IV, hypothetical | **60%** | KO/PEP example |

Not given: the deviation size that triggers a trade, holding period, exit rule, position sizing, or
transaction-cost assumptions.

#### Worked examples with the real figures

**Absolute valuation.** "if a stock's (IV-subsequentRV) is currently at **8 points**, and
historically it hovers around **5 points**, the current VRP may be greater than it is on average,
indicating that the option premiums are richer than usual."

**Coca-Cola vs Pepsi.** These two "share similar market caps, industries, and underlying
fundamentals, so their volatilities should be comparable." Plot both IV/RV ratios; if they are
normally tight together and the target's is now much higher, "you can determine that volatility is
expensive for your target ticker *relative* to the comparison company's volatility." The stated
case: "If Coca-Cola's IV is **20%** and Pepsi's is **60%**, there's likely a mispricing. We can
exploit this by buying Coca-Cola options (low IV) and selling Pepsi options (high IV), expecting the
volatilities to converge."

**The Discovery (DISCA) trade — the article's flagship.** When the Archegos fund imploded a couple of
years earlier, "a great trading opportunity on DISCA appeared because a large amount of forced
selling pressure" came into the market. The team knew there was likely a trade, "but in order to
allocate meaningful capital, we needed to figure out a way to price where DISCA options should be
trading (fair value)."

1. **Initial Screening** — "Using our terminal, we scanned for stocks with high IV rank and IV vs.
   forecast."
2. **Correlation Check** — "Ensured that DISCA and FOXA were correlated (**80% correlation over the
   past year**)."
3. **Relative Valuation** — "Typically, DISCA trades at **1.2 times** FOXA's IV. With FOXA at
   **48%** IV, DISCA should be around **58%**, but it was at **83%** — a clear overpricing."
4. **Action Taken** — "we sold DISCA options expecting the IV to drop."

**Outcome:** "The IV for DISCA dropped as predicted, leading to substantial profits."

Note the structure: forced-selling flow caused the dislocation, the 80% correlation validated the
comparable, and the 1.2× historical multiple supplied the fair-value model. The sizing decision is
what required the pricing work in the first place.

#### Tables/charts

Six images, none with values in the text: an opening exhibit after the Key Takeaways; a diagram
accompanying the absolute-vs-relative split; a variance risk premium timeseries; an IV/RV ratio
chart showing the stationary, mean-reverting behaviour; a KO/PEP comparison; and an exhibit
following the DISCA step-by-step.

#### Mechanical rules you could code

```
SCREEN
  scan for stocks with high IV rank AND high "IV vs forecast"

ABSOLUTE
  vrp_now = IV - subsequent_RV
  rich if vrp_now > historical average vrp        # 8 pts vs ~5 pts -> richer than usual
  # ratio form: compare IV/RV today against its own average (stationary, mean reverting)

RELATIVE
  find correlated comparables (DISCA/FOXA gate was 80% correlation over the past year)
  multiple  = the target's typical multiple of the comparable's IV     # DISCA: 1.2
  fair_IV   = multiple * IV(comparable)                                # 1.2 * 48% = 58%
  if actual_IV > fair_IV: sell the target's options                    # 83% vs 58%

EXPECTED RETURN
  price the option twice in an option price calculator:
    once with market IV, once with your forecast of future volatility
  the difference is what you should expect to return
```

#### Practical rules

The four implementation steps, in the article's order:

1. **Estimate Your Expected Return** — "Swap out the implied volatility in an option price
   calculator for the option with your forecast of future volatility to estimate how much you should
   expect to return by taking the trade."
2. **Screen for Opportunities** — "Use tools to find stocks with unusual IV levels."
3. **Perform Absolute Valuation** — "Compare current IV to historical IV."
4. **Perform Relative Valuation** — "Compare IV with similar stocks or within the same sector."

Additional stated practice: run a correlation analysis to *find* the comparables before relying on
the comparison, and use the two methods together, since "by using them together you are able to get
a clear picture of what price an option should be trading at."

#### Predicting Alpha's specific/contrarian opinions

- Direct criticism of standard practice: checking whether IV is higher or lower than its own history
  "doesn't tell us where the option price should be." Same complaint as the IV Rank article.
- **Sophisticated pricing is the exception, not the default.** Most of the time you should be running
  well-researched systematic programs; these techniques are reserved for irrational situations like
  meme stocks and short squeezes.
- Relative valuation across correlated names produced the largest stated edge in the unit — 25
  volatility points on DISCA.
- Forced-flow dislocations (Archegos) are treated as prime hunting ground.
- The IV/RV ratio's **stationarity and mean reversion** are asserted as the statistical basis for
  benchmarking — a stronger claim than most retail material makes.
- This article also carries uncorrected typos, again suggesting an unedited publication.

#### Notable direct quotes

> "The entire game of trading options is about pricing the variance risk premium that is embedded
> into the option price."

> "Most option sellers take an overly simplistic approach to this. They will simply look at the IV
> for an option and see if it's higher or lower than where it's been in the past. But this doesn't
> really work because it doesn't tell us where the option price should be."

> "Typically, DISCA trades at 1.2 times FOXA's IV. With FOXA at 48% IV, DISCA should be around 58%,
> but it was at 83%—a clear overpricing."

---

*Sub-links: skipped per instruction — the site graph is crawled and assigned elsewhere.*

## Module 8 — How to Make Money Selling Options (Part B: Vol Trading, Sizing, Relative Value)

> All five articles below are by Sean Ryan. Every figure here appears in the source text. Where the
> source renders something as an image rather than text — which is the case for the entire Kelly
> Criterion formula and both of its calculations — that is stated plainly rather than filled in from
> outside knowledge. Anything marked `> [context, not from article]` is added reasoning, not the
> author's.

---

### How To Trade Changes In Implied Volatility and Profit Off Vega: Option Volatility Trading
*Source: https://www.predictingalpha.com/blogs/option-volatility-trading*
*Sean Ryan · September 26, 2024*

#### Core thesis

Most option selling trades the difference between implied and realized volatility — the standard
way to extract the variance risk premium. This article is about the exception: situations where the
opportunity is not in that dynamic at all, but in **the change in the level of implied volatility
itself**.

When implied volatility explodes, Ryan argues, selling *longer dated* options is the most lucrative
way to trade it. You make money from the decline in IV level that comes as everyone "calms down" and
absorbs the new information. He presents this as producing outsized returns compared to regular
short volatility trades.

The setup: major news hits a ticker. The stock jumps 40% on the day and then moves 3-4% a day
after. Every expiration on the term structure has repriced sharply higher — the market is pricing
continued movement. Ryan grants that this partly makes sense: news came out, realized volatility is
genuinely high, the stock may well keep moving. His question is narrower, and it is the whole trade:

> "But does it really make sense that the stock is going to continue moving at elevated levels for
> the next 6-12 months?"

If the news is out and priced in, there is no reason for the back of the curve to stay inflated. So
you avoid the short-dated options — the stock probably will keep moving in the short term — and sell
the long-dated ones, which should decay fast as IV returns to normal levels.

#### Definitions

- **Vega trade** — a trade whose thesis is a change in the *level* of implied volatility, as
  distinct from a trade on implied vs. realized volatility over the option's life. Ryan is explicit
  that a 90 DTE vega trade "is not a 90 DTE trade on the implied vs realized volatility over 90
  DTE."
- **Distressed volatility** — Ryan's name for what he scans for: the entire option chain elevated,
  not just the front expiry.

#### Formulas

None. The article gives no formula, no greeks equation, and no P&L decomposition in math. The
relationship it rests on is stated in words, referring to a hand-drawn chart:

> "as DTE increases, your position's exposure to day to day movements in the underlying
> (gamma/theta) decreases, and your sensitivity to changes in implied volatility increases."

The corollary runs in both directions. A two-year option with high vega can move substantially in
price even if the underlying is relatively stable. And the reverse: if you hold a long-dated option
and the underlying makes a big move while IV is unchanged, you may not see a significant price
change. That two-sidedness is precisely why the structure isolates an IV-level bet.

#### Numbers, thresholds and rules of thumb

| Item | Value |
|---|---|
| Illustrative news-day move | 40% on the day, then 3-4% a day after |
| The question the trade rests on | Will it stay elevated for the next 6-12 months? |
| Expirations sold | 90-180 DTE |
| Structure | Wide strangle |
| Holding period | 1-3 weeks |
| Holding period as % of time to expiration | 10-20% |
| Scanner threshold | IV rank greater than 80 **across the entire term structure** |
| Margin at entry | Not all of it — if IV rises the trade gets better |
| Downside control | A stop loss at a certain point if the trade is clearly going against you |
| Exit trigger | When implied volatility comes down |

**Why a wide strangle rather than an ATM straddle.** The article's sharpest structural choice, and
it deliberately gives up the highest-vega strike:

> "Even though we know that vega is highest at the money, I will typically opt to sell a wide
> strangle because I want to really minimize the impact of realized volatility on my position.
> Having the wider strikes acts as another layer of defense as I try to isolate the level of
> implied volatility."

**Where these situations occur.** Short squeezes, meme stocks, IPOs, and major news releases. Ryan
notes there are others and that these are the obvious ones.

#### Worked example 1 — GME

GameStop during its volatility spikes. In January 2021 the **90-day** options were at **322%** IV,
dropping to **179%** by February. The longer-dated leg is where the trade sat:

| Two-year GME options | Value |
|---|---|
| Initial IV | 153% |
| IV after the drop | 113% |
| One-lot straddle, initial price | $560 |
| One-lot straddle, after | $340 |
| Profit | $220 per lot |

#### Worked example 2 — Tesla

Tesla's implied volatility in 2020. The article explicitly labels this **"a hypothetical
scenario"**:

| Tesla long-dated options | Value |
|---|---|
| Initial IV | 75% |
| Option price | $858 |
| IV after the drop | 57% |
| Option price after | "Significantly lower" |

On the return, Ryan writes: *"I can't remember the exact return we made, but it was high 🙂"* — which
sits oddly with the "hypothetical" framing, suggesting a real trade recalled loosely. Take the IV
and entry-price figures; there is no exit price and no stated return.

#### Tables / charts

No data tables. Five images sit in the body and the text characterizes only one — the drawing
showing gamma/theta exposure falling and IV sensitivity rising as DTE increases ("As you can see in
the drawing above..."). The others appear at the term-structure description, the strangle
description, the holding-period section, and each worked example. Their contents are not described
in the text, so they are not reproduced here.

#### Mechanical rules the article states

1. Scan for stocks where **IV rank is greater than 80 across the entire term structure**. That
   indicates the whole option chain is elevated, which usually means something is going on.
2. Confirm the situation type: short squeeze, IPO, meme stock, or major news.
3. Sell a **wide strangle** on an expiration between **90 and 180 DTE**.
4. Do **not** deploy all margin at entry.
5. Close when implied volatility comes down — expect **1-3 weeks**, roughly 10-20% of time to
   expiration. Do not hold to expiration.
6. Keep a stop loss for the case where the trade is clearly going against you.

#### Practical rules

The risk-management framing is stated directly as Key Takeaway 3, in two parts: don't use all your
margin right away, **because if implied volatility increases the trade can actually become even
better**; and have a stop loss at a certain point if the trade is clearly going against you. The
first is not a defensive rule — rising IV after entry is an improvement in the opportunity, and the
reserved margin is what lets you act on it.

Ryan also flags a prerequisite up front: you need to understand what vega is to find and execute
these trades properly.

#### Predicting Alpha's specific/contrarian opinions

- **Don't sell short-dated options into a vol explosion.** Takeaway 1 frames the choice as avoiding
  "the gamma risk of selling short dated options" — the fat front-month premium is exactly where the
  risk is.
- **Give up peak vega on purpose.** Selling away from the money sacrifices vega to buy insulation
  from realized volatility. Isolation of the bet beats magnitude of the bet.
- **These are the trades worth sizing up for.** In the conclusion Ryan recalls a mentor's quote from
  a previous blog — most of the time we play tight to the vest, but once in a while we need to
  leverage up when we find a big opportunity — and says searching for vega trades leads to those
  "big opportunity" trades. He adds that **some of the best trades of his career were betting on
  changes in the level of implied volatility**, and hopes readers "go on to find some absolute
  whales of trades too."
- On the scanner's hit rate, he is measured: it produces good opportunities "Not every day, but
  frequently enough that I am always keeping an eye on it."

#### Notable direct quotes

> "But over time as things find their place and settle down, these longer dated options should
> experience some very fast decay as the implied volatility moves back down to more 'normal'
> levels."

> "Just because we are trading a longer dated expiration, doesn't mean that we are holding this
> trade for the entire duration."

> "In my experience this is usually over the course of 1-3 weeks. So we actually only hold this
> trade for 10-20% of the time to expiration."

---

### Kelly Criterion Trading: How To Manage Your Bankroll To Maximize Your Returns
*Source: https://www.predictingalpha.com/blogs/kelly-criterion-trading*
*Sean Ryan · September 18, 2024*

#### Core thesis

The opening frames the problem as a dilemma: you either bet too big and risk blowing up, or bet too
small and leave money on the table. Bankroll management resolves it, and Ryan's claim is that it can
turn a winning approach into a losing one, and a great strategy into a mediocre one.

> "You can take a profitable strategy with positive expectancy and turn it into a losing one just
> by not knowing how big you should be betting."

The illustration: buying the S&P 500 is a reasonable way to grow wealth. Buying it with maximum
leverage and all of your money is not. You may see periods of outsized gains, but you will also see
a massive drawdown at some point — and maxed out, likely one you can't recover from.

#### Definitions

- **Bankroll management** — determining the amount of capital you want to risk on each trade.
- **Kelly Criterion** — described as a mathematical formula used by professional gamblers and
  traders to determine the optimal size of a series of bets, maximizing the bankroll's growth rate
  while minimizing the risk of going broke.

#### Formulas — what the article actually prints

**The article does not print the Kelly formula as text.** It says "Here's the formula:" and then
displays it as an image. The text that follows defines the symbols, and that symbol list is the only
formula content stated in words:

| Symbol | The article's definition |
|---|---|
| f\* | the fraction of the bankroll to wager |
| b | the net odds received on the wager (profit per unit bet) |
| p | the probability of winning |
| q | the probability of losing, which is 1−p |

Both worked calculations are also images. In the casino example the inputs are given as text, then
"Plugging these into the Kelly Criterion formula:" followed by an image, then the result. In the
iron butterfly example the scenario is given as text, then "Using the Kelly Criterion:" followed by
an image, then the result. **No intermediate arithmetic appears anywhere in the article text**, and
no value of `b` is stated for the iron butterfly example.

> [context, not from article] To reproduce these results you would need the Kelly formula from
> another source, and you would have to infer how an option trade's max profit and max loss map onto
> `b`. The article never makes that mapping explicit, so any mapping you write down is your
> inference, not Ryan's.

#### Worked example 1 — the casino game

| Input | Value |
|---|---|
| Bankroll | $1,000 |
| Chance of winning | 60% (P: 0.60) |
| Payout if you win | 1.2 times your bet (B: 1.2) |
| If you lose | You lose the amount bet |

**Result stated: bet 26.7% of your bankroll, or $267, on each trade** to optimize long-term growth.

#### Worked example 2 — the iron butterfly

Ryan describes the structure as selling a call and a put at one strike near the money and buying a
call and a put at different out-of-the-money strikes, profiting when the underlying stays in a
range.

| Input | Value |
|---|---|
| Winning scenario | Profit of $500 |
| Losing scenario | Loss of $1,000 |
| Probability of winning | 68% (0.68) |

**Result stated: risk 4% of your bankroll on each iron butterfly trade.**

Note the contrast between the two examples. Identical machinery, and the answer falls from 26.7% to
4% — the option trade risks twice what it can win, and that asymmetry does most of the work.

#### The CRM (Salesforce) event

The argument for sizing in advance is a war story, not a model. Ryan's trading group experienced **a
five standard deviation move with CRM (Salesforce)**, which he calls one of the most significant
earnings blowouts they'd seen. They survived with a loss that was not "out of the question," and the
stated reason is entirely about preparation:

> "we had spent the time in advance to consider how big we should be betting given that moves of
> this size do occur and that we need to be prepared for them."

His diagnosis of why others don't survive these: "Many traders underestimate their max loss until it
hits them, potentially wiping out their accounts if they bet too large."

#### Numbers, thresholds and rules of thumb

| Item | Value |
|---|---|
| Casino example bankroll / win rate / odds | $1,000 · 60% · 1.2× |
| Casino example result | 26.7% of bankroll, or $267 |
| Iron butterfly inputs | +$500 win · −$1,000 loss · 68% win rate |
| Iron butterfly result | 4% of bankroll |
| CRM earnings move | Five standard deviations |
| Betting below Kelly | "Ok" |
| Betting above Kelly | Not ok |

#### What this article does not contain

No fractional-Kelly multiplier — Ryan says to consider betting less than the Kelly recommendation if
you're risk-averse, but gives no half-Kelly, quarter-Kelly, or any other number. No position-size cap
as a percentage of an account beyond the two example outputs. No maximum number of concurrent
positions. No drawdown mathematics at full versus fractional Kelly. No Sharpe ratio, no historical
return table, no win-rate table. No discussion of fat tails invalidating Kelly's assumptions for
short-volatility payoffs — the CRM story is the closest it comes, and its lesson is to size for tails
in advance, not to distrust the formula. And, as above, no printed formula.

#### Mechanical rules the article states

Only three, all qualitative — there is no codable formula because the article never prints one:

1. Adjust the Kelly fraction based on your risk tolerance; if risk-averse, consider betting less
   than the Kelly recommendation.
2. It is ok to bet less than Kelly; it is not ok to bet more than Kelly.
3. Spread risk across multiple trades or strategies to avoid significant losses from a single event.
   (No count, no correlation rule.)

The third practical consideration Ryan lists is market conditions: "Market volatility and liquidity
can impact the performance of your trades. Adjust your strategy accordingly" — no threshold given.

#### Tables / charts

No data tables and no performance charts. The images are the formula, the two calculations, and one
illustration in the bankroll-management section. No equity curve, no return series, no drawdown
chart.

#### Predicting Alpha's specific/contrarian opinions

- **The two errors are not symmetric.** Undersizing costs return; oversizing costs the account.
  Ryan's rule of thumb is explicitly one-directional.
- **The Kelly output is an input to a decision, not the decision.** Takeaway 3: once you know the
  mathematical "optimal bet size," you adjust it for your personal risk tolerance and for whether you
  want to optimize absolute returns or PnL variance.
- **Sizing is settled before the tail event, not during it.** The CRM anecdote's entire point.

#### Notable direct quotes

> "Without proper bankroll management, even the best trading strategies can fail."

> "A good rule of thumb is that while it can be 'ok' to bet less than kelly, it is not ok to bet
> more than kelly. Leaving money on the table is not favorable, but at least you stay in the game.
> If you bet too big, well, we all know what happens!"

---

### Introduction to Relative Value Trading: A Profitable Way To Sell Options
*Source: https://www.predictingalpha.com/blogs/relative-value-trading*
*Sean Ryan · September 25, 2024*

#### Core thesis

Ryan calls relative value trading one of his favorite option selling topics and "arguably one of the
best approaches to strategy development." It is based on finding price discrepancies between similar
assets — buying cheap and selling expensive at the same time — and betting on convergence.

#### Definitions

- **Relative value** — exploiting price discrepancies between similar assets by buying cheap and
  selling expensive simultaneously.
- **Market-neutral** — insensitive to the market's direction. Being long and short an asset at the
  same time positions you so you don't lose money if the market moves up or down; PnL is based on the
  relative performance of similar assets.
- **Volatility arbitrage** — identifying discrepancies in implied volatility between two related
  assets and constructing strategies to exploit them. Ryan calls it "the options version of the
  Pepsi and Coke example."
- **The alpha leg** — the side of a relative value trade that we believe is inefficient.

#### The TV analogy

You own a $5,000 TV, priced at $5,000 on Kijiji. You find a similar TV on Amazon for **$3,000**. You
sell yours and buy the other, pocketing the difference. That is relative value trading in a
nutshell.

Where the opportunities appear: whenever there are things that "shake up" the market, when there is
not much liquidity, or when there is one asset that is much more efficient than a similar,
correlated asset.

#### Worked examples

**Pepsi vs. Coca-Cola (stock).** Both beverage giants with similar market caps and fundamentals,
typically moving in tandem. If Coca-Cola's stock shoots up while Pepsi's plummets, sell Coca-Cola
and buy Pepsi, betting on convergence. Ryan's note on the payoff: the strategy profits "whether
Pepsi's price rises, Coca-Cola's price falls, or both."

**Pepsi vs. Coca-Cola (volatility).** If **Pepsi's implied volatility is 60% while Coca-Cola's is
20%**, despite their similar nature, that is a mispricing. Buy volatility on Coca-Cola and sell
volatility on Pepsi, expecting convergence.

**Cross-exchange crypto.** Because options are a relatively new product in crypto, you can often see
discrepancies in implied volatility for options on the *same* coin on different exchanges. Buy and
sell the same thing at different implied volatilities and you lock in an arbitrage. Ryan names the
catch directly — there are nuances, "the risk that one of the exchanges pulls an FTX" for example —
and says he shares it mainly to get you thinking about the different forms relative value can take.

**SPY vs. a small-cap ETF (the alpha leg case).** If **SPY has an implied volatility of 20% and a
correlated small-cap ETF has 60%**, sell a straddle on the small-cap ETF, **assuming SPY's implied
volatility is more accurate**.

#### Trading the alpha leg

The challenge retail traders face with relative value strategies is that they can be quite margin
intensive. Hence trading only the inefficient side. The reasoning: whenever there is a relative value
trade, it's likely that **only one side of it is causing the opportunity**.

> "By doing this we reduce the margin requirements and the complexities that come with managing this
> trade, while holding on to the majority of the value that comes from this type of opportunity."

The cost, and note how lightly Ryan weights it:

> "Now obviously when you only trade the one side you are increasing your exposures to things
> outside of the relationship between the two assets, but this 'noise' is unlikely to completely
> overstate the opportunity you are trading if you have actually found one of substance."

So his position is not "you lose your neutrality, proceed carefully." It is that the added noise
generally will not swamp a real opportunity, conditional on the opportunity being real.

#### How market beta or vega is neutralized

Structurally, not quantitatively. Neutrality comes from being long and short similar assets at the
same time. There is **no hedge ratio, no beta weighting, no vega-neutral sizing rule and no
dollar-neutral construction** anywhere in the article — choosing genuinely similar assets is the
method as presented. And the alpha-leg recommendation deliberately gives that neutrality up.

#### Mechanical rules the article states

The three implementation steps, as given:

1. **Identify similar assets.** Look for pairs like Pepsi and Coca-Cola, or **IWM and SPY**.
2. **Compare their implied/realized volatility ratios.** Look at the relationship between their
   ratios and see if there is a **recent break**.
3. **Construct trades.** Use structures like straddles or strangles to sell volatility on the
   expensive side and buy volatility on the cheaper side.

Step 2 is the only quantitative instruction in the article, and the unit matters: the comparison is
between the two assets' **implied/realized volatility ratios**, not their raw IV levels, and the
signal is a *break* in the historical relationship between those ratios.

#### Numbers, thresholds and rules of thumb

| Item | Value |
|---|---|
| TV analogy | Own and listed at $5,000, found at $3,000 |
| Pepsi / Coca-Cola implied volatility | 60% vs. 20% |
| SPY / small-cap ETF implied volatility | 20% vs. 60% |
| Named pairs | Pepsi–Coca-Cola, IWM–SPY |
| Comparison variable | Implied/realized volatility ratio |
| Signal | A recent break in the relationship between the ratios |
| Structures | Straddles or strangles |

#### What this article does not contain

No z-score, no percentile rank, no normalization method of any kind. No universe definition beyond
the named pairs. No rebalance cadence. No dispersion (index vs. components) framework and no
correlation treatment. No edge-decay discussion. No returns, Sharpe, win rate or drawdown figures.
It is an introduction, and the framework it gives is pairwise and qualitative.

#### Tables / charts

No data tables and no performance charts. Three images sit in the body — after the key takeaways,
after the TV analogy, and after the Pepsi/Coca-Cola scenario. The text does not describe their
contents.

#### Predicting Alpha's specific/contrarian opinions

- **Retail can still get paid here.** "It's one of the few areas left in the market where a retail
  trader can find some really juicy alpha."
- **Drop the hedge leg.** Standard doctrine says the second leg is what makes it a relative value
  trade. Ryan says it is margin-intensive and that trading one side keeps the majority of the value.
- **The idea is what pays, not the screen.** He closes by saying it's "your fundamental ideas about
  where there can be a relative value opportunity that will really get you paid," with monetizing
  them as the next biggest challenge.
- **Arbitrage carries counterparty risk.** The FTX reference makes the point that a locked
  cross-venue arbitrage is not risk-free.

#### Notable direct quotes

> "Relative value trading is powerful. It's one of the few areas left in the market where a retail
> trader can find some really juicy alpha."

> "Since you are long and short an asset at the same time, it positions you so that you don't lose
> money if the market moves up or down. Your PnL is based on the relative performance of similar
> assets."

---

### How to Make Money Selling Options: The Truth About What It Takes To Run A Profitable Portfolio (sub-link)
*Source: https://www.predictingalpha.com/blogs/how-to-make-money-selling-options*
*Sean Ryan · August 21, 2024*

#### Core thesis

There is one core reason to trade: to make as much money as possible, as quickly as possible. The
argument is that most retail traders say this and behave otherwise, and that the correction is to
treat trading as a business — which means having a logical reason you are being paid. For option
sellers that reason is the variance risk premium.

#### The fun-versus-money confrontation

Ask 100 traders why they trade and Ryan reckons 100 would say "to make money." But look at behavior:
the overwhelming majority want to do fun stuff, and making money is a bonus if it happens. He puts
the figure at **99% of retail traders**. They want the thrill of the big payoff, to feel they see
what others don't, the glory and the rush — and he says this runs entirely counterintuitive to how
you'd act if making money were the primary objective.

> "Profitable trading is actually objectively boring."

Professionals don't call trading exciting; they talk about it as a job, because it is one. They make
money for providing liquidity and resolving inefficiencies. In options that means providing insurance
and holding risks others find unattractive: "We are essentially glorified insurance providers with
some added complications in the execution department." He sets expectations accordingly — you'll
learn a lot, run some cool strategies, "and you are going to be pretty bored (not really, but it's
not as exciting as gambling)."

#### Definitions

- **Variance risk premium** — the tendency for option prices to be higher than their intrinsic value
  at expiration. Ryan parenthetically defines intrinsic value here as "how much they are worth at
  expiration, when there is no time value left."
- **Convexity** — the exponential payoff that attracts retail buyers: you can buy an option for
  **$100** and potentially make thousands on a significant move in the underlying.

#### The argument, step by step

1. Convexity attracts the majority of retail traders to options. But there is **no logical reason we
   should get paid for buying it**.
2. The "aha" moment: there is a real person on the other side of your trade. If you receive money,
   they lose money. Absent a charity on the other side, **you must have a logical reason for being
   paid**.
3. Options are one of the greatest ways to hedge a portfolio *and* one of the greatest ways to place
   a leveraged bet. So demand comes from both the protection-seekers and the gamblers.
4. If that's true it should show up in prices — and it does. Historically, the price an option sells
   for tends to be a few points higher than its intrinsic value at expiration.
5. More demand than supply means prices go up. That premium is the variance risk premium, and it is
   "one of the most well studied phenomena in trading."

Demand → premium → your reason to get paid. Ryan is blunt about the ceiling on the ambition: "I know
this isn't as exciting as being told you are going to become a millionaire overnight, but it's the
real way that traders get paid." Chasing overnight riches, in his framing, amounts to asking someone
to hand you a million dollars. Could you get lucky? Yes. Should you bet your financial future on it?
"Up to you, but we prefer to have a bit more control."

#### Mechanical rules the article states

One, and it is the ETF Premium strategy that members run, described as a complete loop:

1. Use a tool that tells you **if a risk premium has existed for an ETF historically and if it has
   been monetizeable**.
2. If yes, the ETF falls into a **"sell" bucket**.
3. The **whole bucket gets sold**.
4. Everything else is focused on monetizing that risk premium and minimizing transaction costs.

Stated cost to run: **less than 30 minutes per week**. Ryan's summary: "That's it. No magic. But
guess what? It actually works."

#### Numbers, thresholds and rules of thumb

| Item | Value |
|---|---|
| Retail traders seeking fun over money | 99% |
| Traders who'd say "to make money" if asked | 100 out of 100 |
| Illustrative option purchase | $100, potentially making thousands |
| ETF Premium strategy time cost | Less than 30 minutes / week |
| Membership capacity | 1,000 traders |

#### Tables / charts

None. No data tables and no performance charts. Three images sit in the body — at the key takeaways,
the "blue pill or the red pill" section, and the who-is-trading-against-you section — and the text
does not describe their contents.

#### Predicting Alpha's specific/contrarian opinions

- **Excitement is the diagnostic.** Not a personality trait but evidence about your objective. The
  claim that 99% of retail traders are "clearly seeking fun based on their actions" is the framing
  the whole article rests on.
- **Stop stock picking and charting.** The conclusion says the first step is to step off "the
  emotional rollercoaster of stock picking, technical analysis, and thinking that if you just spend a
  bit more time on the charts you will be able to see something the rest of the market can't." The
  stated reason: we perceive far more control than we actually have.
- **The strategy that works is unglamorous and takes half an hour a week.** Offered deliberately as
  an anticlimax.
- **Without the VRP they'd trade something else.** Takeaway 3 says the premium "is the backbone of
  how we make money, and without it, we would go find something else to trade" — the edge is a
  documented market phenomenon, not skill.

#### Notable direct quotes

> "The only reason we should be trading is to make money, and as much of it as possible."

> "Once you realize this, you have taken the first step out of the world of gambling and into the
> world of profitable trading."

---

### How to Trade Illiquid Options: The Keys to Success For Selling Options With a Wide Bid Ask Spread (sub-link)
*Source: https://www.predictingalpha.com/blogs/illiquid-options*
*Sean Ryan · August 29, 2024*

#### Core thesis

Low-capacity spaces contain some of the best opportunities for retail traders because their pricing
is typically less efficient. The obstacle is execution, and Ryan's claim is that it is decisive:

> "Often, execution can be the difference between a profitable strategy and an unprofitable one."

Because the edge is usually small, poor execution significantly diminishes profits over time. His
standing advice to new option sellers is to stick to liquid names, where spreads are tighter and
execution matters less. But the opportunity is in smaller names — fewer eyes means volatility is
priced less efficiently, giving you the chance to price it better than the market does. The
resolution: **determine the volatility line you want to sell at, then aim to get filled at the
corresponding option prices.**

#### The midpoint is not fair value

The article's central negative claim. When $VOD showed up in Ryan's scan, the **15.5 puts expiring
January 7, 2022** had a **bid of $0.67 and an ask of $1.94**. Fill at the midpoint, **$1.30**, and
you might think you got a fair price. You didn't — the midpoint is not fair value and not even the
market's fair value. It is simply the price halfway between the bid and the ask, and it moves with
small actions from either side. If the ask side is more aggressive the midpoint favors the buyer; if
the bid side is more aggressive it favors the seller.

**The demonstration.** An illiquid option with a **bid of $0.50 and an ask of $5.00**, one lot on
each side. Midpoint: **$2.75**. Now a new participant offers to sell at **$3.50**, so the ask becomes
$3.50 instead of $5.00 — and the midpoint becomes **$2.00**. One order from one participant, and
"fair value" moved. Which one was true?

> "In highly liquid markets like QQQ, SPY, or AAPL, the midpoint is a useful indicator because the
> market is competitive, with knowledgeable participants setting the bid and ask prices. Therefore,
> the midpoint serves as a good estimate of market fair value. However, in illiquid markets, the
> midpoint is meaningless."

#### The method — pricing your own volatility line

Ryan's brokerage showed roughly **50% IV** on the VOD puts, but with a wide spread there is no
knowing whether that is achievable. The question to answer:

> "If I wanted to sell VOD puts at 50% IV, what price would I need to sell the put options for?"

Run a **Black-Scholes calculator** with the current price, strike, expiration and the target implied
volatility. The result for VOD: the put premium should be **$1.12**. Which gives a clean rule — to
sell at 50% IV on VOD you need to collect at least $1.12 per option. Collect more and you sold at a
higher IV; collect less and you sold at a lower IV.

#### Worked example — the trade that looked fine and wasn't

Suppose you skipped the pricing step. The analysis said VOD options were expensive at 50% IV since
the stock was only realizing **30%** volatility, so it looked like an easy sell. The market was
illiquid, you worked the order, and eventually sold a put for **$0.95**.

Bad trade. At $1.12 for 50% IV, selling at $0.95 means you sold at a lower implied volatility than
intended. To find out *how much* lower, run the calculator the other way — input the price received
instead of the volatility, and solve for IV.

The answer, and this is the number that makes the article:

> "Because I was too aggressive with my order, I actually sold at a 40% IV instead of the intended
> 50% IV. With my fair value at around 35% IV, I almost erased all of my edge by being too
> aggressive. I didn't know when to stop, and I either left money on the table or potentially made a
> negative expected value (EV) trade."

Most of the intended edge was gone at the point of execution, on a trade whose analysis was correct.

#### How much flexibility do you have on the fill?

Target is $1.12. Would $1.11 do? $1.05? Ryan's answer: **it depends on the amount of edge you have on
the trade, which is why accurate valuation is crucial.**

The non-options analogy: if you knew for certain AAPL is going to **$200** tomorrow, you should be
willing to pay anything below $200 today, maybe with room for error depending on confidence. The
point is that **you have to value it first.**

Applied to VOD, four steps:

1. **Implied and realized volatility** — VOD trading at **50% IV**, realizing about **32%**.
2. **Fair value estimate** — based on your analysis, closer to **35-40% IV**.
3. **Margin for error** — build in a buffer in case your calculations are slightly off.
4. **Risk-reward assessment** — make sure there's enough potential profit to justify the risk of the
   stock moving significantly.

The conclusion drawn: getting filled at the 40% IV line makes no sense — too close to fair value, not
enough room for error or profit. So **anything below about 47% IV wouldn't be a trade I'd consider**,
which via the calculator gives:

| | Value |
|---|---|
| Target price | $1.12 |
| Minimum acceptable price | $1.06 |

If he can't get filled above $1.06, the trade isn't worth taking — wait for a fill or move on.

> [context, not from article] The article gives two slightly different figures for the same two
> quantities: realized volatility appears as 30% in the mispricing setup and "about 32%" in the
> valuation checklist, and fair value as "around 35% IV" in the execution post-mortem and "35-40%
> IV" in the checklist. Both pairs are in the source as written; neither is a transcription error
> here.

#### Numbers, thresholds and rules of thumb

| Item | Value |
|---|---|
| VOD contract | 15.5 puts expiring January 7, 2022 |
| VOD bid / ask | $0.67 / $1.94 |
| VOD midpoint | $1.30 |
| Illiquid demo bid / ask | $0.50 / $5.00, one lot each side |
| Demo midpoint, then new ask, then new midpoint | $2.75 → ask $3.50 → $2.00 |
| Brokerage-shown VOD IV | ~50% |
| VOD realized volatility | 30%, elsewhere "about 32%" |
| Price required to sell at 50% IV | $1.12 |
| Price actually sold at | $0.95 |
| IV that fill actually represented | 40% |
| Fair value estimate | ~35% IV, elsewhere 35-40% IV |
| Lowest IV worth trading | About 47% |
| Minimum acceptable price | $1.06 |
| Liquid names where the midpoint does work | QQQ, SPY, AAPL |

#### Mechanical rules the article states

1. Determine the volatility line you want to sell at **before** you trade.
2. In an illiquid chain, **do not use the midpoint as fair value.** It is meaningless there.
3. Use a Black-Scholes calculator with underlying price, strike, expiration and your target IV to get
   the **premium you must collect** to be selling at that IV.
4. Estimate fair value IV from your own analysis (for VOD: 35-40% against a 50% market).
5. Add a margin for error, and check that the risk-reward justifies the move risk.
6. Set a **minimum acceptable price** from the lowest IV you'd accept — for VOD, about 47% IV, giving
   $1.06 against a $1.12 target.
7. If you can't get filled above the minimum, **don't take the trade.** Wait or move on.
8. After a fill, run the calculator in reverse — input the price received, solve for IV — to confirm
   what volatility you actually sold at.

Rule 8 is the one most traders skip, and in Ryan's own example it is what revealed the execution loss
on a trade he had analyzed correctly.

#### Tables / charts

No data tables and no performance charts. Four images sit in the body: two illustrating the
bid/ask/midpoint shift in the demonstration, and two showing the Black-Scholes calculator screens
(solving for price, then solving for implied volatility). The text describes what the calculators
were fed and what they returned, which is captured above; the images themselves are not described.

#### Predicting Alpha's specific/contrarian opinions

- **The midpoint is meaningless in illiquid markets.** Stated that strongly, against near-universal
  retail practice of working orders to the mid.
- **Beginners should stay in liquid names — but the money is in the illiquid ones.** Ryan gives both
  sides rather than picking one, and resolves it with a skill (pricing your own vol line) rather than
  a rule.
- **Execution, not idea generation, is the hard part.** "Most of the time, traders think that once
  they have found a good idea, the hard work is done." He puts execution as usually the difference
  between a +EV and −EV strategy, and says he'll consider the post a success if it made that clear.
- **Being too aggressive on the fill is a way to lose money with a correct thesis.** "I've seen many
  traders get too aggressive with their orders and then wonder why they are losing money."

#### Notable direct quotes

> "As retail traders, we are all relatively 'small fish.' We don't need to be in the ocean to find
> food; we can hunt in a pond."

> "Always remember, when trading in an illiquid market, we need to price our options."

> "If we can't price the option when we go to trade it, all the work we put into trying to price it
> beforehand is jeopardized."

---

### Unit summary — every rule this unit produced

| Rule | Value | Source |
|---|---|---|
| Vega trade expirations | 90-180 DTE | option-volatility-trading |
| Vega trade structure | Wide strangle, not ATM | option-volatility-trading |
| Vega trade holding period | 1-3 weeks = 10-20% of time to expiration | option-volatility-trading |
| Distressed volatility screen | IV rank > 80 across the entire term structure | option-volatility-trading |
| Margin at entry on a vega trade | Not all of it — rising IV improves the trade | option-volatility-trading |
| Vega trade exit | When IV comes down, not at expiration | option-volatility-trading |
| Kelly formula | Displayed as an image; not printed in the article text | kelly-criterion-trading |
| Kelly symbols | f\* = fraction of bankroll · b = net odds · p = P(win) · q = 1−p | kelly-criterion-trading |
| Kelly, casino example | 26.7% of bankroll, or $267 of $1,000 | kelly-criterion-trading |
| Kelly, iron butterfly example | 4% of bankroll | kelly-criterion-trading |
| Betting above Kelly | Never | kelly-criterion-trading |
| Relative value comparison variable | Implied/realized volatility ratio, pairwise | relative-value-trading |
| Relative value signal | A recent break in the ratios' relationship | relative-value-trading |
| Relative value execution | Trade the alpha leg only, to cut margin | relative-value-trading |
| ETF Premium strategy | Historical + monetizeable risk premium → sell bucket; under 30 min/week | how-to-make-money-selling-options |
| Midpoint in illiquid chains | Meaningless — do not use as fair value | illiquid-options |
| Illiquid execution method | BSM your target IV → required premium → minimum price → refuse below it | illiquid-options |
| Post-fill check | Solve for IV from the price received | illiquid-options |

**On sizing.** Kelly's iron butterfly example returns 4% of bankroll; no other article in this unit
states a position-size cap. Nothing here reconciles sizing across strategies, and none of these five
articles gives a portfolio-level exposure limit.

## Module 9 — Two Strategies for You to Use

Two complete playbooks, both monetizing the variance risk premium at opposite ends of the time
axis. The ETF Premium Strategy harvests VRP in weekly slices across a diversified basket of ETFs.
The Earnings Premium Strategy harvests it overnight across many uncorrelated single-name events.
The fourth article is a two-year live journal of the second strategy.

One structural note that governs how everything below reads: **neither strategy specifies a profit
target as a % of credit, a stop loss as a multiple of credit, or a defensive roll ladder.** Both are
hold-to-expiry / hold-to-event structures. Risk control is position size, diversification across
uncorrelated exposures, and short duration. Where the standard entry/target/stop/roll template has
an empty slot below, that is PA's design, not a gap in these notes.

---

### The Ultimate Option Selling Strategy: A Boring But Profitable Method That Actually Makes Money

*Source: https://www.predictingalpha.com/blogs/profitable-option-selling-strategy*

Sean Ryan · August 14, 2024

#### Core thesis

Running a volatility book means having a clean way to extract the variance risk premium, and the
best way to do that is selling options on ETFs. Sean's framing is that this is a service business,
not a prediction business: hedge funds want protection on their long equity portfolios, and you get
paid for selling it to them. He calls the operators "glorified insurance brokers. Holding risks
that others don't want, in exchange for a premium."

He opens with a disclaimer that the strategy is boring — you won't brag about it, you won't wake up
with adrenaline to check your brokerage. "Maybe not instagram influencer Lamborghini in 10 minute
money. But real money." He also disclaims novelty: this is how the majority of professional option
selling funds get their start.

Requirements to run it: the ability to sell naked options, and access to data. Time cost is about
**30 minutes of work per week**. His claim for the basket: it makes money, it outperforms, and it's
low maintenance.

The reason execution is this simple is that the hard work happened upstream — understanding the
risk premium, finding the variables that identify optimal trades, and building the model that
assembles the basket. The trader's job is to lean on the premium's existence and optimize
extraction.

#### The rules

**Selection criteria — the basket must satisfy all three**

1. Has a **positive variance risk premium that we can capture**.
2. Has an **IV percentile lower than 80**.
3. **Each ETF in the portfolio represents a different industry or market.**

**Execution**

4. **Sell weekly delta 20 strangles for 7 days.**
5. **Roll them for 4 weeks before rotating to a new ticker.**
6. **Do not delta hedge unless there is a massive jump.**
7. Optional: to hedge downside risk, **roll the weekly strangles under the protection of a 90 DTE
   delta 20 strangle** (the "strangle swap"). Open the hedge at the start of the trade cycle when
   you sell the first 7 DTE strangle; **close the hedge when your last short strangle expires (end
   of week 4)**.

**Finding trades**

8. Run the **ETF Premium Strategy scan** in the PA terminal. It returns ETFs with a positive VRP, a
   profitable option selling backtest, and an IV percentile lower than 80. All tickers meeting the
   criteria are fair game. Empirically you could trade all of them — that would give the smoothest
   PnL — but in reality you don't have the time or resources to manage 50 trades at once.
9. Narrow the list on **two variables only: diversification and liquidity.** Sean's claim: "We can
   achieve 90% of the benefits by focusing on 2 variables." They control the factors *surrounding*
   the risk premium, giving cleaner exposure and a smoother PnL.
10. **Diversification check:** plug your selected ETFs into the correlation matrix tool in the PA
    terminal and confirm they aren't "the same thing under different tickers."
11. **Liquidity check:** between two ETFs with positive VRP, pick the liquid one. If you have too
    many candidates, raise the liquidity threshold in the scan. Proxy metric used in the article:
    **average option volume.**
12. **Keep adding ETFs** until you have an acceptable number of trades on and are utilizing margin
    appropriately. **Rotate into new trades** as positions come off and capital frees up.

**Sizing** — *not specified in the article.* The guidance is qualitative: "an acceptable number of
trades" and "utilizing our margin appropriately." No contracts-per-capital figure, no % of account
at risk, no margin utilization target.

**Exit / profit target / stop loss** — *not specified in the article.* The 7 DTE strangle is held
and re-struck; the mechanics of exiting at expiry are the subject of the next article.

#### Formulas

No closed-form equations. Three quantitative relationships are defined:

- **The VRP criterion:** "This metric is to utilize VRP's long-term mean reversion to indicate if
  an ETF has the risk premium. Basically, if the average VRP is positive, then on average, we
  should capture a positive VRP."
- **The liquidity screen:** bid/ask spread expressed as a **percentage of the highest premium you
  could receive**. This is the arithmetic that decides FXI vs ASHR below.
- **AQR's alpha definition** (for the strike/expiry chart): "the alpha is defined as the
  delta-hedged returns minus the full period's beta to SPY."

#### Numbers, thresholds and rules of thumb

| Parameter | Value |
|---|---|
| IV percentile | **lower than 80** |
| Strikes | **delta 20** |
| Expiration | **7 DTE** (14 DTE acceptable — "the difference is not substantial enough for us to argue over it") |
| Roll cycle before rotating ticker | **4 weeks** |
| Optional hedge | **90 DTE delta 20 strangle** |
| Weekly time commitment | **30 minutes** |
| Two variables get you | **90% of the benefits** |
| Practical management ceiling | not **50 trades** at any given time |
| Hedge cost | **about ⅓ of profits**; over **60%** of premium collected |
| Delta hedging | **none**, unless a massive jump |

**The three structure decisions, as stated:**

1. **Structure** — delta neutral, short gamma, long theta, short vega. A short strangle is what we
   sell.
2. **Expiration** — the shorter the expiration, the greater the VRP. 7 DTE is what we sell.
3. **Strikes** — **the VRP is highest in OTM puts.** Delta 20 strikes is what we sell.

**Why ETFs — three reasons:**
1. ETFs have added premiums baked in because of **correlation risk** (all the holdings become
   correlated in a crash). "In fact it has been argued that the majority of the variance risk
   premium is due to this correlation risk."
2. ETFs are a common place for **funds to hedge their book** (good liquidity and sector exposures).
3. ETFs **don't carry the same bankruptcy and upside jump risk** that individual stocks do (less
   blow up risk).

**Why IV percentile below 80.** Not an edge filter — a variance filter. Higher IV results in a
higher VRP *in points*, but it also increases the strategy's variance. Normalizing VRP as a
percentage doesn't show a clear relationship with IV levels. So avoiding high IV environments
maintains your return on VRP while reducing variance.

**Two principles behind short-dated OTM:**
- Selling **shorter expiration** options should have a higher risk premium because the impact of
  large moves is greater, and that is what options are used to hedge against.
- Selling **OTM** options should have a higher risk premium because there is more convexity — fewer
  dollars collected upfront for a larger loss if there's a big move.

**The AQR chart.** Each line is a different expiration length, the X axis is different strikes, the
Y axis is alpha (excess return). Reading: the shorter the expiration, the greater the alpha, and it
peaks slightly below ATM. "Front Month options that are roughly **-0.5 standard deviations out the
money** have the greatest return."

**Why delta 20 / 7 DTE also solves delta hedging.** The problem is stated honestly: there is no
trade that exactly replicates the PnL of the difference between implied and realized volatility, so
delta exposure varies over the trade. Hedging is a double-edged sword — hedge infrequently and
stock drift adds more noise than the implied-vs-realized signal; hedge frequently and the costs
outweigh the edge. PA's answer is to trade a structure that requires less hedging, which happens to
be the same structure with the highest risk premium:

- **Wider strikes** allow more movement before a strike is breached, so the price can drift more
  without needing a hedge.
- **Shorter expirations** mean less exposure to slow drift — 7 days to move instead of 30 or 60.
- **Re-striking at the end of 7 days** is equivalent to delta hedging once per week, without the
  added costs.

#### Worked examples with the real figures

**Diversification, scenario #1 (failed).** Pick **KWEB, ASHR, and FXI**. All have a positive risk
premium and look like three separate ETFs — but all three are focused on the Chinese economy. In
the correlation matrix they are all extremely correlated with one another. "What looked like 3
separate trades was actually much closer to one giant trade. Attempt at diversification, failed."

**Diversification, scenario #2 (worked).** Pick **KWEB, URA, and BITO** — Chinese economy, uranium,
bitcoin. The correlation matrix shows very little correlation between them. Three trades each with
a positive VRP and very little to do with one another: "Just because one experiences higher
realized volatility, it doesn't mean the others have to as well."

**Liquidity, FXI vs ASHR.** Both have a positive VRP and are roughly the same size of trade (**both
around $25 underlying price**). Looking at average option volume, **FXI has almost 15x the volume**.

| Weekly short strangle | Spread | As % of highest premium receivable |
|---|---|---|
| **ASHR** | **0.05 – 0.12** | **58%** |
| **FXI** | **0.14 – 0.18** | **22%** |

"Just by picking to trade the more liquid ETF we have significantly improved our chances of making
money." Note these percentages are the output of a comparison — the article states no reject
threshold for spread width.

**SPX strangle vs strangle swap.** Both stressed to an **8% move up or down in 1 week**:

| | Loss per lot | Premium |
|---|---|---|
| Short strangle (unhedged) | **about $4,000** | full |
| Strangle swap (+90 DTE long strangle) | **about $2,400** ("almost 50% less ouch") | costs **over 60% of the premium we collected** |

Sean's caveat on the unhedged number: "an 8% 1 week move in the S&P is wild." Overall verdict: "The
strangle hedge costs us about ⅓ of our profits. But what we gain is significantly reduced risk."
And the decision rule: if you want to maximize absolute returns, drop the hedge and just sell
strangles; if you'll trade gains for a controlled risk profile, sell weekly strangles under the 90
DTE strangle.

#### Performance tables

**None.** The article publishes no backtest P&L, win rate, Sharpe, or drawdown for the ETF Premium
Strategy. The only performance claims are qualitative: "This basket makes money. It outperforms.
And it's really low maintenance," and that scanner-returned tickers have "a profitable option
selling backtest."

#### Failure modes and caveats

- **Hedges are not free and they eat into our edge.** You are the one providing hedges to other
  people.
- **Fake diversification.** Three tickers with one underlying driver is one trade with three sets of
  costs.
- **Illiquidity.** A 58%-of-premium spread quietly converts a positive-expectancy trade into a
  losing one.
- **Chasing a good risk/reward.** "Remember, we are the insurance providers. We should expect an
  outsized loss compared to our gain on each trade. Seeing a 'good risk reward ratio' is a sure
  sign that you are being too risk averse."
- **Blow-up risk is reduced, not removed** — an unhedged SPX strangle still loses about $4,000 a lot
  on an 8% week.
- *Not specified in the article:* commissions, capacity limits, tax treatment, or what market
  regime breaks the strategy.

#### Predicting Alpha's specific / contrarian opinions

1. **Most of the ETF VRP is correlation risk premium** — that, not diversification alone, is the
   reason to trade ETFs over single names.
2. **Strangles for continuous VRP harvesting** — deliberately the opposite of the earnings
   recommendation.
3. **Don't delta hedge — re-strike instead.** Weekly re-striking is a free delta hedge.
4. **Don't rank VRP.** The framework sorts ETFs into "Haves" and "Have Nots" — which world an ETF
   belongs to, not which has a "better" VRP. Custom ranking is explicitly outside the scope of the
   core strategy.
5. **Boring is the feature**, stated as the article's opening disclaimer.
6. **If you hedge, hedge the worst case** — don't be risk averse and optimize for a good risk/reward
   trade.

#### Notable direct quotes

> Hedge funds want protection on their long equity portfolios. We get paid for selling them that
> protection. The end.

> …at a fundamental level we are glorified insurance brokers. Holding risks that others don't want,
> in exchange for a premium.

> Seeing a "good risk reward ratio" is a sure sign that you are being too risk averse.

> Whether you choose to include the hedge or not, you make ZERO dollars if you never do anything.

---

### How to Roll Weekly Options Like a Pro

*Source: https://www.predictingalpha.com/blogs/how-to-roll-weekly-options-like-a-pro*

Sean Ryan · November 22, 2024. Explicitly "a supplement to our ETF Premium Strategy article."

**Scope note.** This is not a defensive roll decision tree. There is no roll-when-tested rule, no
roll-out vs roll-out-and-down branch, no minimum credit requirement for a roll, no cap on roll
count, and no "take the loss instead" rule. The position is never rolled defensively — it is
re-struck on a fixed weekly clock regardless of what happened. The article covers the Friday cycle,
three expiry scenarios, the margin overlap problem, and the delta hedging stance. It is a short
operational note; this section is exhaustive rather than long.

#### Core thesis

Sean's stated reframe: don't think of this as individual week-long trades. "Think about the strategy
as a month long trade that is delta hedged weekly. The way we are delta hedging is actually by
restriking the position." Every rule below follows from that.

#### The rules

**The Friday cycle — by market close on Friday you must:**

1. **Be out of the strangle you sold last week.**
2. **Be in the short strangle you are going to hold for the coming week.**

The goal in exiting is lowest cost possible, "because we know that a big part of our edge comes from
effectively managing our commissions and slippage."

**Three expiry scenarios, three different cost-optimal actions**

3. **Situation 1 — underlying safely between the strikes, options will expire OTM.** Take no action.
   Let them expire worthless. You exit for zero commissions and don't cross the bid/ask spread.
   "This saves us a lot of money over time."
4. **Situation 2 — underlying very close to the strikes, could expire ITM or OTM.** Close the
   position. The reason is not the option's value but assignment: you could be assigned shares (long
   or short depending on which strike is breached), "which means we will be carrying a lot of delta
   exposure over the weekend, which is an exposure that we do not want and can cause a significant
   impact to our returns." Accept the transaction costs plus slippage and close.
5. **Situation 3 — underlying beyond the strikes, options will expire ITM.** Two options:
   - **5a. Neutralize with shares.** If the **short call** is breached, **purchase 100 shares right
     at market close for every call option that will get assigned** — the call gives someone the
     right to buy 100 shares from you, so having them in inventory leaves you with zero shares at
     day's end. If the **short put** is breached, **short 100 shares right at market close for every
     put option that will get assigned** — when the buyer sells you their shares via exercise, you
     end at zero.
   - **5b. Close the position** as in Situation 2, incurring commission and slippage. "This is a
     reasonable approach as well." The most important thing is to be out by market close.

**Entering the new strangle**

6. Structure a **new delta 20 short strangle expiring in 7 days** and **place the trade near market
   close.** "Remember to push for the best fill possible (every penny counts!)"

**The margin overlap problem**

7. For a short period right before market close you hold both this week's and next week's short
   position, and the margin requirement is significantly increased. Two choices:
   - **Wait until Monday** — "not ideal since there is a lot of premium decay over the weekend that
     we want exposure to."
   - **Pay to close out the option position that would expire worthless** to free the margin. "It's
     not ideal to have to do this, but it's more important to get exposure to the risk premium over
     the weekend." This is the preferred fix.

**Delta hedging**

8. **No active delta hedging.** Reason: the strikes are already wide (delta 20) and they expire
   weekly. At the end of each week you are technically brought back to delta neutral because the new
   strangle is created by shorting the delta 20 call and delta 20 put. "So effectively, we are delta
   hedging the position weekly."

#### Formulas

None. The one quantitative relationship: **100 shares per contract** that will be assigned — bought
for a breached short call, shorted for a breached short put.

#### Numbers, thresholds and rules of thumb

| Parameter | Value |
|---|---|
| New strangle strikes | **delta 20** |
| New strangle expiry | **7 days** |
| Deadline for both actions | **market close on Friday** |
| Share offset per assigned contract | **100 shares** |
| Active delta hedging | **none** |
| Margin overlap fix | pay to close the worthless legs |

No profit target, stop loss, roll credit minimum, or roll count limit appears anywhere in this
article.

#### Worked examples with the real figures

**No numeric worked example.** The article's examples are diagrams: the trade cycle picture from the
ETF Premium Strategy article, plus one illustration per situation showing the underlying's position
relative to the strikes. All decision content is positional, not numeric.

#### Performance tables

None.

#### Failure modes and caveats

- **Weekend delta exposure is the named enemy.** Every scenario rule exists to avoid carrying
  assigned shares through the weekend.
- **Missing weekend premium decay.** Waiting until Monday to re-enter is the trap that looks
  prudent; paying to close worthless options is the preferred alternative.
- **Slippage and commissions are where the edge leaks** — the reason Situation 1 (do nothing) is
  worth engineering toward.
- *Not specified in the article:* what counts numerically as "very close to our strikes," what to do
  if you can't get a fill on the new strangle, or how to handle both strikes being breached.

#### Predicting Alpha's specific / contrarian opinions

1. **Re-striking is delta hedging**, so no separate hedging program is needed.
2. **Think in months, trade in weeks** — the reframe is presented as materially improving execution
   and risk understanding, not as a metaphor.
3. **Doing nothing is the best exit** when the underlying is safely inside the strikes.
4. **Use share inventory rather than closing** when a strike is already breached.
5. **Weekend decay is worth paying to keep** — it justifies both the Friday deadline and the
   pay-to-close margin fix.
6. Asking whether to delta hedge is treated as a good sign: "If you were wondering about this, it's
   a very bullish sign on your success with this strategy."

#### Notable direct quotes

> Think about the strategy as a month long trade that is delta hedged weekly. The way we are delta
> hedging is actually by restriking the position.

> Remember to push for the best fill possible (every penny counts!)

---

### The Ultimate Earnings Options Strategy – Selling Options Like a Professional

*Source: https://www.predictingalpha.com/blogs/earnings-options-strategy*

Sean Ryan · August 15, 2024

#### Core thesis

Variance risk premiums arise around events that could cause significant price changes — earnings,
FOMC meetings, product releases. Earnings is the most popular of these among PA members. The
premium exists because of a supply/demand imbalance: funds hedge, retail speculates, everyone wants
to buy, and almost nobody wants to sell. That reluctance is rational per-event — "If you look at
each earnings event in a vacuum, the risk far outweighs the reward" — and irrelevant at portfolio
level, because earnings moves are uncorrelated across stocks. "Just because Apple has a big move on
earnings, doesn't mean that Walmart will."

The car insurance analogy carries the argument. On any individual car you collect a small premium
regularly; occasionally one crashes and you pay out a large sum. The magic is that there are
millions of cars with uncorrelated risk, so you diversify by increasing volume. Earnings are the
same: a known embedded premium, uncorrelated outcomes, and profit from collecting the average
premium across a large number of trades.

Stated plainly — what we do: sell straddles on a basket of stocks with earnings events between
market close today and market open tomorrow. We make money when the implied move is higher than the
realized move. We lose money when there's a big surprise and the stock jumps more than the market
thought. It is profitable because dozens of uncorrelated trades each season minimize the impact of
losers and let you extract the average premium.

#### The rules

**Step 1 — Scan**

1. Go to the **Scanner Page** and select the **"Today's Earnings" Scanner**, which filters for
   earnings events occurring today. (If not a PA member: free earnings calendar tools also produce a
   candidate list.)
2. Narrow the list on **three metrics**:
   - **Straddle PnL** — look for trades where it is **negative**, which suggests selling options
     over historical earnings events for that ticker has been profitable.
   - **Implied Earnings Move (IEM)** — compare to the average move; **if the IEM is higher, it
     indicates a potential risk premium**.
   - **Price of underlying stock** — depending on account size, prefer a smaller price per share so
     a single trade isn't too big a percent of the account. "Its betters to trade many smaller
     tickers rather than one big ticker."

**Step 2 — Deeper analysis**

3. Use the earnings dashboard's backtest, which looks at **up to four years of earnings events**
   (less for a newer company), to establish whether there is a capturable risk premium. Three checks:
   - **Consistent premium** — the backtest graph shows the straddle consistently decreasing in value
     after the event (the line slopes downwards).
   - **Implied move vs. average move** — the implied move is higher than the average move.
   - **Low maximum historical move** — indicating potential losses will likely be manageable.
4. The core question: **"Is there a risk premium for us to collect here?"** If yes, proceed. Do not
   go deeper — "By taking a large number of trades during each earnings season, any variance we
   experience should balance out."

**Step 3 — Execute**

5. **Sell an at-the-money straddle on the closest expiration date.** Target the **closest to 1 DTE
   expiration available on the option chain.**
6. **Open the trade right before market close** (before the event).
7. **Close the trade 5-10 min after market open** (after the event). Elsewhere in the same article
   Sean gives his own practice as **between 5 and 20 minutes after the market opens** — both figures
   are stated; they are not reconciled.
8. **Work your orders.** "Do not rush. Do not just hit the bid or the ask." Before the close the
   spread should be pretty tight — follow the normal procedure, start at the ask and work the order
   down.
9. **Time the exit by scenario** (full tree below).
10. **Do not buy wings or protection.**

**Sizing** — *not specified numerically in this article.* The stated principle: spread risk across
many bets and don't count on one trade to make or break the PnL. "If one big loser takes you out of
the game, you either sized up way too much or you are trading a ticker that is way too big for your
account size." Some traders place **over 100 trades each earnings season**; the strategy trades
"literally hundreds of events each season."

**Exit** — time-based. No profit target as % of credit and no stop loss as a multiple of credit are
specified.

#### Formulas

- **Profit condition:** implied move due to earnings > realized move after the numbers come out.
- **Straddle price = the implied move**, with no added buffer from wider strikes. This is the stated
  reason straddles give better feedback than strangles here.
- **Expected IV crush** = event IV − non-event IV, read as the spread between the event and
  non-event term structures at the short-dated expirations. The article concedes "Calculating this
  is actually pretty complicated" and delegates it to the PA Terminal.

#### Numbers, thresholds and rules of thumb

| Parameter | Value |
|---|---|
| Earnings share of a stock's annual movement | **30-70%** |
| Backtest lookback | **up to four years** of earnings events |
| Structure | short **at-the-money straddle** |
| Expiration | **closest to 1 DTE** available |
| Entry | right before **market close** |
| Exit | **5-10 min after market open** (quick answer) / **5 to 20 minutes** (Sean's own trades) |
| Trades per season | **hundreds**; some traders **over 100** |
| Straddle PnL screen | **negative** |
| IEM screen | **higher** than the average move |
| Wings | **none** |
| IV crush worked example | **53%** → ~**32%**, crush of **21%**; exit is fine at **35%** |

**The four view questions that dictate the structure:**

| Do we have a view on… | Answer |
|---|---|
| If the stock goes up or down? | **No**, we don't know/care which direction |
| If the stock moves more or less than implied? | **Yes, we think it will move less** |
| If implied volatility goes up or down? | **Yes we think it will move down** |
| Time horizon? | **Less than 1 day** |

Required characteristics that follow: **delta neutral** (no PnL impact from direction), **long
theta** (make money as time passes), **short gamma** (lose money if big moves), **short vega** (make
money if IV crushes), and **maximum exposure to tomorrow's outcome**. The best fit is a short ATM
straddle with a close expiration date. Framing: "Need to tighten a screw? Use a screwdriver. Need to
cut a piece of wood? Use a saw. Picking a trade structure is no different."

**Straddles vs strangles — the explicit reversal.** Sean notes he argued strangles are optimal for
the ETF VRP strategy, "But for earnings, I will actually be sharing why straddles are the superior
structure." Three reasons: (a) there is no need to delta hedge because of the short time horizon, so
there is less added benefit to strangles; (b) the straddle price equals the implied move with no
buffer, giving better feedback on whether the implied-over-realized view is making money; (c) the
strangle's wider break-evens "doesn't actually impact our long term EV in any way" and make it
harder to get feedback and spot execution mistakes.

**Why the closest expiration.** Same logic as trading tight to the event — isolate the exposure. A
1 DTE option expires shortly after the event, so the event plays a big role in its value. A 1-year
option has hundreds of "regular days" diluting the event's impact, leaving "not enough exposure to
the difference between the implied and realized move for us to see a meaningful PnL." Hence: the
shorter the DTE, the better.

**Why no wings.** The core reason is one question: "We get paid for holding the risk of a big move
happening. If we hedge away the risk of a big move happening for ourselves, why are we getting
paid?" The principle behind it: we get paid for providing a service to the market; if we no longer
offer the service, we no longer get paid. To "what if the stock moves a crazy amount?" — first, you
will take a big hit, that is the nature of being short volatility and the reason you are being paid;
second, **the way you should hedge risk is through diversification**, spreading risk across many
bets so you aren't counting on one trade.

#### Worked examples with the real figures

**FITB — the screening example.** From the scanner screenshot FITB appears attractive on the three
filters. The deeper review confirms it: the straddle is consistently decreasing in value after the
event, the implied move is higher than the average move, and the maximum historical move is quite
low. Verdict: a strong candidate, one of the basket that day.

**Stock ABC — the exit decision tree.** Implied move is **10%**, and we sell an at-the-money
straddle. Three morning scenarios:

| Scenario | Realized vs implied | Result | Vega | Action |
|---|---|---|---|---|
| **1** | less than implied | winner | lots remaining | **hold a bit longer until IV comes down** |
| **2** | close to / slightly greater than implied | small loser | lots remaining | **hold a bit longer until IV comes down** |
| **3** | much greater than implied | big loser | very little | **get out right away** |

All three share the same exposures — you make money as time passes and if IV comes down; you lose
money on bigger-than-expected moves or if IV goes up. What changes is *sensitivity*. IV should drop
sharply once the event is over because the earnings volatility that was priced in is gone; that
matters only if you still have vega. In Scenario 3 the stock has moved so far that you have very
little vega left, so "relative to the losses on the position (and the impact on our trade from our
delta exposure), the change we would wait for in implied volatility is basically meaningless."

**The IV crush benchmark.** From the article's term-structure image: if IV is **53%** and is
expected to go to **~32%** after the event, the crush to expect is **21%**. You don't need the last
couple of points — "let's say it's down from 53% to 35%, you don't need to be waiting for the last
couple of points to get out." Use the forecast as a benchmark and close with confidence once the
crush is in the ballpark. The figure is shown on the scanner per ticker, or you can read it yourself
on the dashboard's term structure page by displaying event vs non-event term structures and reading
the spread at the short-dated expirations.

#### Performance tables

**None.** The only quantified claim in the article is that earnings account for **30-70% of a
stock's annual movement**. No win rate, no P&L, no Sharpe, no drawdown.

#### Failure modes and caveats

- **The loss aversion trap** is named "a fatal flaw": holding the position the day after earnings
  hoping the stock goes back into the body of the position sold. The diagnosis is structural, not
  tactical — "If we are too attached to the outcome of a single trade, we haven't been placing
  enough trades and we have way too much riding on this singular outcome."
- **Bad fills in the wide morning spread.** Market makers don't immediately know fair value after so
  much new information enters, so they widen. "Bad fills are the most common way that traders
  destroy a great edge." The fix: "take a deep breath and wait. If the spreads are wide, just do
  nothing."
- **Everything around the event is not the event** — the reason for both the entry and exit timing.
- **Oversizing.** One big loser taking you out means the size was too large or the ticker too big for
  the account.
- *Not specified in the article:* a win rate, commissions, liquidity thresholds, assignment handling,
  or capacity limits.

#### Predicting Alpha's specific / contrarian opinions

1. **Never buy wings around earnings** — hedging away the jump removes the service you're paid for.
2. **Diversification is the hedge**, not protective options.
3. **Straddles beat strangles for earnings** — explicitly the reverse of the ETF strategy, and
   argued from feedback quality rather than expected value.
4. **Shortest DTE always.**
5. **Don't over-analyse the individual name** — establish the premium exists, then move on.
6. **Wanting to hold a loser is a diagnosis of insufficient trade count**, not a market view.
7. **Doing nothing in a wide spread is the skill.**
8. **Earnings is a gateway** — once running, the same approach extends to FOMC and other events with
   a risk premium.

#### Notable direct quotes

> We get paid for holding the risk of a big move happening. If we hedge away the risk of a big move
> happening for ourselves, why are we getting paid?

> …everything that happens around the earnings event is not the earnings event.

> The easiest way to handle this is to take a deep breath and wait. If the spreads are wide, just do
> nothing.

> If the realized move is less than or slightly more than implied, wait for IV to crush. If the
> realized move is much higher than implied, just get out of the trade.

> If one big loser takes you out of the game, you either sized up way too much or you are trading a
> ticker that is way too big for your account size.

---

### $224,914.81 Profit Across 1,381 Trades: A Live Breakdown of Earnings Strategy Returns

*Source: https://www.predictingalpha.com/blogs/earnings-strategy-profit*

Sean Ryan · October 23, 2024. Two years of the Earnings Premium Strategy run live by a long-time PA
member, **Jay**, who tracked every trade since October 2022. Split into three parts: performance
review, trade process, and a Q&A with Jay.

#### Core thesis

This is the empirical test of the previous article. The claim being evidenced is that the earnings
VRP is real and capturable *after* real-world friction — the returns "account for real time
slippage, transaction costs, and learning/mistakes that happen in the reality of running a
strategy."

#### Performance tables

**Headline, from the article body:**

| Metric | Value |
|---|---|
| Total return ($) | **$224,914.81** |
| Total return (%) | **89.97%** |
| Trades | **1,380** (body) / **1,381** (article title and Part 1 description) / "over 1,300" (conclusion) — *the source disagrees with itself; all three are as written* |
| Period | **October 6, 2022, to September 27, 2024** |
| Structures | a blend of OTM strangles and ATM straddles, "with a preference for the former" |

**Key statistics, from the linked trade log spreadsheet:**

| Metric | Value |
|---|---|
| Start & end date | **10/06/2022 - 09/27/2024** (**772 days**) |
| Starting Balance | **$250,000.00** |
| Ending Balance | **$474,915.00** |
| Total Return ($) | **$224,914.81** |
| Total Return (%) | **89.97%** |
| Average Return Per Trade (%) | **0.37%** |
| Beta (to $SPY) | **0.031** |
| Win Rate (%) | **82.60%** — **1,380 trades, 1,140 winners** |
| Average Winner ($) | **$800.64** |
| Average Loser ($) | **-$2,951.35** |
| Biggest Winner ($) | **$9,544.07** |
| Biggest Loser ($) | **-$32,384.57** |
| Straddle Frequency (%) | **29.00%** |
| Strangle Frequency (%) | **63.50%** |
| Average Trades Placed (Daily) | **5.82** |
| Most Trades Placed (Daily) | **28** |
| Average Trade Size (Premium Collected) | **$1,539.99** |

**Sharpe ratio and maximum drawdown are not published** in either the article or the trade log. The
worst drawdown is described only qualitatively as "the biggest dip in performance chart."

**Distribution of returns.** The chart shows a skewed distribution: "The majority of trades are
small winners, with the tail risk for outsized losers. These losers are the reason why the strategy
returns are so high." Correlation to the market is very low, "making it a great strategy for
diversification."

**5 reasons this journal is impressive, as listed:**
1. The volume of trades is so large that it's clearly not luck that led to these returns.
2. The returns account for real time slippage, transaction costs, and learning/mistakes.
3. The correlation to the market is very low.
4. The returns are astronomical, showing how prevalent this risk premium is.
5. The PnL variance is relatively low, showing how by taking lots of trades we can control risk even
   though we are selling naked positions.

#### The rules, as Jay ran them

**Finding trades**

1. Each trading day starts by generating a list of upcoming trades from the PA Terminal. "A big part
   of this strategy is being able to take a high volume of trades, so every ticker gets some care
   and analysis."

**Analyzing — the earnings backtest**

2. **Is selling straddles profitable?** Want the cumulative return positive.
3. **Is the return smooth?** Want a typical short volatility profile — many small winners, the
   occasional big loser.
   - *Good backtest:* positive return; occasional losers, mostly small winners.
   - *Bad backtest:* negative return; choppy PnL, no consistency in being able to price the risk
     premium.

**Analyzing — historical one-day moves**

4. Review past earnings reports and how the stock moved post-announcement to gauge whether current
   option pricing makes sense.
   - *Good:* very few volatile jumps; the market prices the risk premium correctly on most events.
   - *Bad:* extremely volatile jumps, frequently moving more in the morning than the market implied
     — "the market doesn't really know how to price volatility around this company's earnings."
5. When Jay sees a ticker that frequently jumps more than the implied move, he **may avoid the
   position or at least size down the trade.**

**Structure and execution**

6. **Select the expiration that expires closest to the earnings event** — if the event is tonight,
   trade the options expiring tomorrow if possible.
7. **Enter close to market close** before the event; **close the position in the morning after.**
8. **Structure drift:** Jay started off trading exclusively straddles but over time traded more
   strangles, because farther OTM options "appeared to have a slightly greater risk premium plus
   less probability of going in the money," so he preferred strangles "because of their smoother
   performance." He also credits the higher win rate and trading many events in small size with
   making it possible to hold the risk of significant individual losses — which is why the returns
   are relatively smooth for the profit generated.
9. Exact strike selection for those strangles (by delta or by expected-move multiple) is **not
   specified in the article**.

**Sizing**

10. **"Trade at a max risk significantly less than what you think you can handle (25% of your
    expected trade size)."**
11. **"If you can't handle crossing the spread to get out when you see danger coming, only sell
    straddles. The deeper out you go, the faster losses multiply, and it is the tail events that get
    you."**
12. Position sizing standard: the max loss on a tail event must not kill the account. **"For a
    $1,000 max risk trade, a tail event might mean 3-5x this loss on average, so I expect to lose
    $1,000 but be able to walk away from a $5,000 loss."**

**Managing while active**

13. **Before the bell, label all trades from high to low risk** for the order in which to close them.
14. Keep a window with all tickers on a graph, plus **a watchlist of active trades filtered by bid
    size** (biggest bids = biggest trades by size).
15. **If there are a lot of trades, close them all indiscriminately in order** until it reaches a
    size where you can be more subjective in trade management.

**Exiting**

16. **Criteria: time-based.** "If it's a 2 std+ move at the open, I base it on my subjective opinion
    on the report itself."
17. **"If the market is doing something that makes no sense to me or moving in a way I did not
    expect, get out."**
18. **"Don't try to hold onto losers, don't try to fix or adjust your existing trade. If the sky
    looks like it's on fire, believe it."**
19. **Deep OTM strikes that become worthless are the only ones Jay lets run; everything else is
    closed the next day.**
20. **Don't hold for multiple days.** "A few years ago, I would hold for multiple days in hopes that
    price would mean revert, but it doesn't really. Tail risk events move in one direction and can
    move for prolonged periods of time."
21. **Emotional circuit breaker:** "My default response when I'm overwhelmed mentally is to just
    close everything down and leave the computer. Walk it off for as long as I need."

#### Formulas

Only one quantitative heuristic is given, and it is a sizing rule: **a tail event costs 3-5x the max
risk of the trade on average.** No pricing or position-sizing formula beyond that.

#### Numbers, thresholds and rules of thumb

| Parameter | Value |
|---|---|
| Max risk vs. capacity | **25% of your expected trade size** |
| Worked sizing case | **$1,000** max risk trade; tail = **3-5x**; expect to lose **$1,000**, survive **$5,000** |
| Subjective-exit trigger | a **2 std+** move at the open |
| Multi-day holds | none, except deep OTM worthless strikes |
| Liquidity veto | spreads of **a few dollars ($5-10)** forced bad exits |
| Recent-history read | last **5** events clustered as "very volatile"; last **3** green candles decreasing in size |
| Worst quarter | **May-August 2024**, lots of **3 std+** moves |

#### Worked examples with the real figures

**NKE.** Jay's illustration of the "get out when it makes no sense" rule: "NKE report isn't that
bad, let me buy some shares post-earnings—it dumps rapidly at the open. Get out immediately."

**CVS on April 30.** "CVS on April 30 represents the sky falling. The loss could have doubled if I
didn't hedge my shares before the bell." This is the one instance in the whole module of an active
intervention on a moving position — share hedging in the pre-market, not buying wings.

**The liquidity lesson.** "There have been several instances where I traded things that statistically
looked okay, but doesn't reflect the actual liquidity of the stock. I've had to close trades that
had a few dollars ($5-10) in the spread, and I don't sell vol if the liquidity looks suspect
anymore." Against an average premium collected of **$1,539.99**, a $5-10 exit spread is material.

**Reading a historical events chart.** Jay's own method: he sees the last 5 events clustered into
"very volatile," so if he thinks the implied moves are too low to reflect that increase, he would
not sell. He can see the green candles on the last 3 decreasing in size, so he would then look at
the skew to see how the rest of the strikes are priced.

**The worst quarter.** May-August 2024, with lots of 3 std+ moves — the biggest dip in the
performance chart. His response: **"I changed nothing."**

#### Failure modes and caveats

- **The tail is the whole risk.** Biggest loser **-$32,384.57** against an average winner of
  **$800.64**; the average loser (**-$2,951.35**) is itself several times the average winner. The
  82.60% win rate is structurally required, not a comfort.
- **Statistical screens miss liquidity.** Trades that "statistically looked okay" still had $5-10
  spreads on the exit.
- **Holding through tail events risks significant damage** — mean reversion after an earnings shock
  is not there.
- **Going further OTM accelerates losses.** "The deeper out you go, the faster losses multiply."
- **Operational overload** at up to 28 trades in a day, which is why the pre-bell risk ranking and
  indiscriminate-close triage exist.
- **Sleep is a stated constraint:** "You have to be able to sleep at night… You have to be more
  conservative in estimating your realistic loss when it's an outlier, not when it's the average."
- *Not published:* Sharpe, max drawdown, per-ticker or per-year breakdown, commission totals, margin
  utilization, capacity limits.

#### The straddle-vs-strangle contradiction

The two earnings articles disagree, and both are PA-published:

| | Position | Reasoning |
|---|---|---|
| **Earnings strategy article (doctrine)** | **Straddles** are superior for earnings | No need to delta hedge over a short horizon; straddle price = implied move gives better feedback; wider break-evens don't impact long-term EV |
| **Jay, live (this article)** | **Evolved to prefer strangles** | Farther OTM appeared to have slightly greater risk premium, less probability of going ITM, smoother performance |

The realized log: **63.50% strangles, 29.00% straddles.** Jay's own qualifier cuts the other way
though — if you can't handle crossing the spread to get out when danger is coming, **only sell
straddles**, because losses multiply faster the deeper out you go. Read the strategy article as PA's
taught doctrine and the journal as one trader's live deviation with two years of evidence behind it.

#### Predicting Alpha's specific / contrarian opinions

1. **Volume is the risk management** — low PnL variance while selling naked options is credited to
   trade count.
2. **Real-world friction included is the point** — this is not a backtest.
3. **Size at 25% of what you think you can handle.**
4. **Assume the tail is 3-5x your max loss**, then size to survive it.
5. **Don't hold, don't adjust, don't fix.** "If the sky looks like it's on fire, believe it."
6. **A liquidity read overrides the statistics.**
7. **A bad quarter is not a reason to change the strategy** — "I changed nothing."
8. **Triage before judgment** when the book is too large.
9. **Only sell straddles if you can't stomach crossing the spread to exit.**

#### Notable direct quotes

> Trade at a max risk significantly less than what you think you can handle (25% of your expected
> trade size).

> If the market is doing something that makes no sense to me or moving in a way I did not expect,
> get out.

> Don't try to hold onto losers, don't try to fix or adjust your existing trade. If the sky looks
> like it's on fire, believe it.

> CVS on April 30 represents the sky falling. The loss could have doubled if I didn't hedge my
> shares before the bell.

> You have to be able to sleep at night, especially when you see a really bad report happen after
> hours in the afternoon/evening.

> May-August 2024, with lots of 3 std+ moves… I changed nothing.

---

### Module 9 — cross-strategy comparison

| | **ETF Premium Strategy** | **Earnings Premium Strategy** |
|---|---|---|
| Universe | ETFs: positive VRP, IV percentile < 80, different industry/market each | Stocks with earnings between today's close and tomorrow's open |
| Structure | short **strangle**, delta 20 | short **ATM straddle** (doctrine); Jay ran 63.50% strangles |
| Expiration | **7 DTE** (14 acceptable) | **closest to 1 DTE** |
| Hold period | 7 days, rolled 4 weeks, then rotate ticker | overnight |
| Entry | near Friday market close | right before market close, day before the event |
| Exit | expire worthless / close / offset with shares | 5-10 min after the open (Sean: 5-20 min) |
| Profit target | not specified | not specified |
| Stop loss | not specified | not specified (2 std+ open move triggers a subjective call) |
| Delta hedging | **no** — weekly re-striking substitutes | **no** (Jay's one exception: CVS pre-market share hedge) |
| Wings / protection | optional 90 DTE strangle swap, costs ~⅓ of profits | **never** |
| The real hedge | diversification across uncorrelated industries/markets | diversification across hundreds of uncorrelated events |
| Sizing | qualitative only | 25% of expected trade size; $1,000 max risk; 3-5x tail |
| Published performance | none | $224,914.81 / 89.97% / 1,380 trades / 82.60% win rate |
| Time cost | 30 minutes per week | daily in season; up to 28 trades in a day |

**What Module 9 never specifies for either strategy:** a profit target as a % of credit, a stop loss
as a multiple of credit, a roll credit requirement, a maximum number of rolls, commission
assumptions, capacity limits, or Sharpe and maximum drawdown.