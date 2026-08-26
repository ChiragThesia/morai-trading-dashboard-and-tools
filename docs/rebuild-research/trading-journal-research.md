# Trading journal — research for the Morai rebuild

Scope: a journal for a delta-neutral SPX calendar and diagonal trader. Front legs 8–45 DTE,
mostly puts, SPXW weeklies and SPX monthlies. Account roughly $17k with $3.5–4.75k targeted at
risk. The system already ingests Schwab and CBOE chains, computes BSM greeks server-side, tracks
term structure and skew, takes 30-minute RTH snapshots of every open calendar, and pairs broker
fills into positions.

Every claim below carries its source inline or is marked UNVERIFIED. Where the research
disagreed, both sides are shown.

**The thesis.** Every skeptic in the corpus makes the same argument, and every one of them
concedes the same single exception. The argument: the broker's own order-status screen already
shows what a journal shows. The exception: it cannot show rolling-trade P&L. This journal earns
its existence on two things — a correct ledger for rolled multi-leg positions, and an immutable
pre-commitment record. Everything else it could do, something else already does better.

---

## 1. The evidence

**No controlled study of trading journals exists.** Not an RCT, not an academic paper, not a
rigorous before/after comparison. Multiple search passes across several phrasings found only
vendor marketing, affiliate-monetised review sites, and self-report on forums. The "+22.8% work
performance" and "42% goal achievement" numbers circulating in journal-vendor copy trace back to
general workplace and expressive-writing meta-analyses that studied no traders at all.

That reframes everything after it. No section of this document can lean on "studies show
journaling helps." It does not. The design has to be justified field by field from what is known
about trading behaviour and about when feedback can teach anything.

### What is actually measured

**Overtrading is the largest measured destroyer of individual returns, and overconfidence
drives it.** Barber & Odean studied 66,465 households at a discount broker from 1991 to 1996. The
highest-turnover quintile earned 11.4% a year against a 17.9% market return
([Trading Is Hazardous to Your Wealth](https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/individual_investor_performance_final.pdf),
Journal of Finance 55(2), 2000). Gross performance barely differed between frequent and
infrequent traders. Net performance differed by seven points: 11.4% versus 18.5%. Their companion
paper isolates the mechanism as a natural experiment — men trade about 45% more than women and
earn about 0.94 points a year less because of it
([Boys Will Be Boys](https://faculty.haas.berkeley.edu/odean/papers/gender/boyswillbeboys.pdf),
QJE 116(1), 2001).

**Traders sell winners and hold losers.** Odean's account-level test found mean Proportion of
Gains Realized 0.57 against Proportion of Losses Realized 0.36, rejected at t=19; the aggregate
test rejected at t greater than 35 (Odean, "Are Investors Reluctant to Realize Their Losses?",
Journal of Finance 53(5), 1998, pp. 1775–1798 — no stable public URL). The winners sold went on
to outperform the losers kept. Original framing: Shefrin & Statman, "The Disposition to Sell
Winners Too Early and Ride Losers Too Long", Journal of Finance 40(3), 1985. Barber & Odean's
survey chapter calls it "a remarkably consistent and robust phenomenon" across many datasets
(Handbook of the Economics of Finance ch. 22, 2013 — no stable public URL).

**Winning teaches the wrong lesson.** Gervais & Odean (2001) model self-attribution: investors
credit success to ability and failure to luck, so experience manufactures overconfidence instead
of correcting it. Both Barber & Odean papers above cite the mechanism directly. "Even investors
with more past failures than successes may become overconfident by overweighting their
successes."

### Base rates

Barber, Lee, Liu, Odean & Zhang used complete Taiwan Stock Exchange transaction data from 1992 to
2006. Only 9.81% of day-trading volume came from predictably profitable traders, who made up
under 3% of all day traders on an average day. Aggregate net-of-fees day-trading performance was
negative in all fifteen years
([Do Day Traders Rationally Learn About Their Ability?](https://faculty.haas.berkeley.edu/odean/papers/Day%20Traders/Day%20Trading%20and%20Learning%20110217.pdf),
working paper, Oct 2017).

The same paper kills a comfortable assumption. Previously unprofitable traders with 50+ days of
experience had a 95.3% chance of trading again within twelve months. Previously profitable ones:
96.4%. Losses barely move the decision to continue. Persistence carries no information about
whether an edge is real.

A Brazilian study of 19,646 individuals who day-traded mini-Ibovespa futures reports roughly 97%
lost money (Chague, De-Losso & Giovannetti, "Day Trading for a Living?", SSRN 3423101).
UNVERIFIED — SSRN returned 403 and the FGV repository returned a bot challenge. The 97% headline
is consistent across every secondary summary; a second figure (the share earning more than a bank
teller's salary) is reported as both 0.5% and 0.4% by different summaries and should not be cited
at all.

### Why "learn from your trades" is unreliable advice

Skill needs two conditions. The environment must have stable cue-to-outcome structure. The person
must get prolonged practice with feedback that is rapid and unequivocal. Kahneman & Klein state
both as necessary
([Conditions for Intuitive Expertise](https://www.hansfagt.dk/Kahneman_and_Klein%282009%29.pdf),
American Psychologist 64(6), 2009).

Market direction fails the first condition outright. Their summary box: "To a good approximation,
predictions of the future value of individual stocks and long-term forecasts of political events
are made in a zero-validity environment." Any publicly available predictive signal would already
be priced in. On finance specifically: feedback from failures in long-term judgment is "delayed,
sparse, and ambiguous... conducive to overconfidence."

But expertise is *fractionated*. The same person can have real skill in one sub-task and none in
the neighbouring one. Auditors show genuine expertise on hard data and none on soft. This is the
taxonomy the journal's field list should be built on.

| Sub-task | Valid feedback? | Why |
|---|---|---|
| Fill quality against mid at submit | Yes | Specifiable correct answer, feedback within minutes |
| Front-leg DTE inside the stated 8–45 band | Yes | Binary, checkable against the entry record |
| Size against the declared risk cap | Yes | Binary, checkable |
| Exit followed or overrode the stated rule | Yes | Binary, checkable against an immutable plan |
| Directional or IV-level conviction | **No** | Zero-validity environment, no cue to calibrate against |

Grading a conviction score against outcomes produces noise dressed as insight. The environment
has no valid cue to learn.

### The precondition nobody lists

Kahneman & Klein describe a "wicked" environment via Hogarth: the early-20th-century physician who
sensed which ward patients would develop typhoid, confirmed it by palpating their tongues, and —
because he did not wash his hands — made his own intuitions come true. Misleading regularities
teach confident false lessons.

This system already built one. Its previous fill-to-event ledger computed −$319,850 of P&L for a
trade that made +$395. That is a wrong-by-construction feedback signal on a real trade the trader
would otherwise have learned from. Ledger correctness is not QA polish. It is the precondition
for every other claim in this document being applicable at all.

---

## 2. Sample size, and what a journal can honestly tell you

This bounds every number the journal will ever display, so it comes before the metrics.

To separate a true 55% win rate from a 50% coin flip at two-sided alpha 0.05 and 80% power:

```
n = [ z(α/2)·√(p0(1−p0)) + z(β)·√(p1(1−p1)) ]² / (p1 − p0)²      with p0 = 0.5
```

| True win rate | Trades needed |
|---|---|
| 60% | ~194 |
| 55% | ~783 |
| 52% | ~4,900 |

Computed from the standard normal-approximation power formula, not cited from a source. Verify it
rather than trust it.

Two caveats make it worse, not better.

**It is a lower bound.** The formula assumes a clean binary win/loss with independent trials.
Calendar P&L is continuous and asymmetric. An *expectancy* estimate needs more data than a win-rate
estimate, driven by the variance of trade P&L.

**783 trades is a decade.** A ~$17k account running a handful of concurrent delta-neutral SPX
calendars produces order dozens of closed trades a year. One bull run does not supply this. One
full market cycle does not supply this.

The rule that falls out: **the journal may display descriptive numbers. It may not attach
statistical confidence language to them.** "You are 12 for 19 this quarter" is honest. "Your edge
is 63%" is not. Below a few hundred closed trades, no ratio in the journal is evidence about
whether the strategy works.

---

## 3. What existing journals do, and what they all get wrong

Prices fetched from live vendor pages in Aug 2026 except where noted.

| Product | Price | Options handling | Import | Notable |
|---|---|---|---|---|
| [Tradervue](https://www.tradervue.com/site/pricing/) | Silver $29.95/mo, Gold $49.95/mo | Options gated to paid tiers; groups by symbol, not strategy | Broker sync + generic CSV | Expirations and assignments must be hand-added as fake $0.00 fills |
| [Wingman Tracker](https://wingmantracker.com/pricing) | $49/mo single tier | Auto-groups by option strategy, tracks rolls as one continuous position | CSV export-then-upload, not live sync | Same owner as Tradervue (SureSwift Capital) |
| [TradeZella](https://tradezella.com/pricing) | $35 / $59 / $99 per mo | Options expiration report; credit-spread P&L reported broken (see below) | Broker sync, forces a specific CSV shape | AI features credit-metered at every tier |
| TraderSync | Pro $22.46–29.95, Premium $37.46–49.95, Elite $59.96–79.95 per mo | "Spread detection" at Pro and up | Auto-sync and CSV; auto-sync reported to drop trades | Pricing from a [July 2026 Wayback snapshot](http://web.archive.org/web/20260716082607/https://tradersync.com/pricing/) — the live page is Cloudflare-blocked and returned 403 to every direct fetch |
| [Edgewonk](https://edgewonk.com/pricing) | $197 / 16 months (~$12.30/mo) | "Options" is one checked market type. The words spread, leg, roll and strategy grouping appear nowhere on the pricing page | CSV | Real strength is behavioural: Tiltmeter, Edge Finder, MFE/MAE |
| [Trademetria](https://trademetria.com/pricing) | Free / $19.95 / $29.95 per mo | "Track and merge options spreads" listed on all three tiers | Broker auto-sync appears gated to Pro | Gates on data volume, not features |
| [Stonk Journal](https://stonkjournal.com/) | Free / Pro $10/mo | Free tier names **calendar spreads** explicitly in its auto-detected strategy list — the only product in the survey that does | No import on free; Pro is CSV. "Broker sync is on the roadmap" | AI coach reads only the journal, never predicts markets, refuses to call a pattern real on a small sample |
| [TradesViz](https://www.tradesviz.com/pricing) | Free / $19.99 / $29.99 per mo (monthly) | Deepest in the survey: [per-leg greeks, net greeks summary, wheel cost basis, CSP ROI/APY](https://www.tradesviz.com/options/) | Auto-sync | Its options backtester's templates stop at same-expiry structures |

### The shared failure

**Multi-leg spreads get shredded into unrelated legs, or netted wrong.** This is not an inference
from marketing copy. It is a named complaint against the two largest vendors, in one r/options
thread, from users who paid:

> "I have now started trading credit spreads and right out of the box, TradeZella doesn't handle
> spreads well. My numbers are super whacky because it's not tracking the credit properly... I
> spun up a trial on TraderSync and I'm having the same issue there."
> — [r/options, Aug 2025](https://old.reddit.com/r/options/comments/1mryjun/trade_logjournal_that_handles_credit_spreads/)

Another in the same thread: "Definitely don't use Tradezella for spreads. I had [to] adjust the
entries manually for the correct PL every time." A third got a refund. The OP's own fix was to
abandon auto-sync for manual CSV upload, then assign the spread type by hand — which defeats the
point of automated import.

Tradervue's version of the problem is architectural and stated in its own docs. The unit of record
is the individual execution, and executions are grouped "together with other executions with the
same symbol" — by symbol, not by strategy
([generic import spec](https://www.tradervue.com/help/generic)). Corporate actions are not
imported at all. Their instruction: "if you had a short option contract that expired worthless,
add a row to buy it back on the expiration date for $0.00"
([managing option positions](https://help.tradervue.com/article/3443-managing-option-positions)).
That is manual reconciliation debt pushed onto the user — the same class of bug that produced this
system's −$319,850 incident, solved by asking the trader to fake a fill.

The market-structure explanation: Tradervue and Wingman Tracker share a footer, terms and privacy
structure, both reading "© SureSwift Capital, Inc." The roll-tracking pitch lives entirely in the
separate $49/mo product. Nobody sells the general journal and the options-roll specialist under
one roof.

### The white space

TradesViz is the closest existing product to what this trader needs. Its backtester's strategy
templates are "short straddle, short strangle, long straddle, long strangle, iron condor, iron
fly, call vertical and put vertical" — up to eight legs, all same-expiry. **No calendar. No
diagonal.** The most sophisticated options journal on the market has not solved the
different-expiry case.

One thing worth copying outright from the same page: its backtester excludes days with missing leg
data "and counted rather than quietly treated as flat." Honest-by-default gap handling.

### The skeptics

Unprompted, across three threads, without the question being asked:

> "My journal app is called schwabs 'order status' screen don't complicate it."
> — [r/options](https://old.reddit.com/r/options/comments/1t5himk/best_options_trading_journal_apptool_youve/)

> "TDA has great reports with all the details I need **except for rolling trades**... If you found
> keeping up with an excel sheet tedious then you likely made it far more complicated than it
> needs to be and are duplicating what most full featured brokers are already providing."
> — u/ScottishTrader,
> [r/thetagang](https://old.reddit.com/r/thetagang/comments/11kjri2/what_paid_trading_journals_do_you_guys_use/)

> "all this tracking gets boring in the end and I'm not sure if it's even required."
> — [r/thetagang](https://old.reddit.com/r/thetagang/comments/1cd0ood/best_trading_journal_for_option_seller_and_wheel/)

Multiple long-time Excel users in the same threads never switched to a paid tool. Emphasis added
above, because it is the whole argument: the one gap every skeptic concedes is rolling-trade P&L.

Experienced forum traders also report the value curve bends down. "I've been doing this for a long
time and the benefit proves diminishing returns but it was invaluable early" and, independently,
"journaling has diminishing returns as a trader gains knowledge and experience"
([elitetrader](https://elitetrader.com/et/threads/tips-for-keeping-a-trading-journal.326221/)).
Neither user sells a journal. For a mature process, the journal's job shifts from discovery
toward audit: catch drift from the plan, keep the attribution honest.

---

## 4. The data model

### The unit of record

Two sources look like they contradict each other. They do not.

From outside, a commenter in r/options argues per-trade rows break at the first roll: "a CSP that
gets rolled three times before assignment, then the resulting shares get four CC rolls before
assignment back to cash, is one position and nine separate trades in your broker statement.
journaling each roll as its own row makes the position level math invisible." The proposed fix is
a position-level row with a roll-event sub-table underneath
([r/options](https://old.reddit.com/r/options/comments/1t5himk/best_options_trading_journal_apptool_youve/)).
The handle reads as possibly a product operator; treat it as opinion, not audited fact. The
mechanism it names is independently corroborated by the TradeZella and TraderSync complaints
above, and by the existence of Wingman Tracker as a separate product.

That critique attacks fill as the *reporting* row. It does not attack fill as the *storage* atom.
The repo already has the right answer to both, in `packages/core/src/journal/domain/calendar-event.ts`:

- `RawFill` is the atom — one broker fill, with `occSymbol`, `side`, `qty`, `price` and its own
  broker-reported `positionEffect`.
- `CalendarEvent` is the derived unit — `OPEN`, `CLOSE` or `ROLL`, keyed by `fillIdsHash`, a
  SHA-256 of the sorted fill UUIDs that compose it. Same fills always rebuild to the same event.
- `calendarId` is the aggregate — it groups events into the position.
- `ROLL` is a first-class event type, not a CLOSE plus an OPEN, and it stores `rollOpenDebit` and
  `rollCloseCredit` as explicit separate components.

The market converges on the same shape. Wingman groups legs into positions and continues the
existing position across a roll; TradesViz offers a manual merge for the same purpose. Those
claims come from search summaries, not fetched pages — UNVERIFIED as to exact wording, cited as
convergence, not as quotes.

**Recommendation: keep this model.** Fill immutable, event derived, position the aggregate.

### The grain tradeoff for rolls

| Convention | What it gets right | What it hides |
|---|---|---|
| Close-and-open (each roll is a new trade) | Execution cost of the rolling decision is visible | Inflates trade count, deflates mean hold time, books a loser at every defensive roll even when the campaign finishes green |
| Campaign only (one verdict, first entry to final exit) | Clean win/loss, honest expectancy | You can no longer ask whether rolling out helped or just delayed the loss |

No controlled study compares trader outcomes under the two conventions. This appears to be an
unstudied bookkeeping question, so what follows is reasoning, not a finding.

**Recommendation: store both grains, report different metrics from each.** Expectancy and
win/loss at campaign level. Execution cost and roll cost at event level. Because fills and events
are already immutable and `calendarId` already groups them, the campaign — a chain of rolled
`calendarId`s — should be a read-model view, not a new mutable table.

### The two structural deltas

Against what already exists in `calendar-event.ts`, only two things are genuinely new.

**1. The campaign read-model.** Above.

**2. A synthetic SETTLEMENT event.** Cash settlement produces no closing fill and no order. It is
a computed cash credit or debit at expiration. A ledger that closes a position only when a
matching offsetting fill arrives will leave an expired leg open at its last stored mark forever,
silently misstating the closed campaign's realised P&L. This is the same class of bug as the
−$319,850 failure: an event the ledger structurally cannot receive, because it waits for a signal
that never comes. Fire a SETTLEMENT event from the calendar's own expiration date and strike once
the settlement value is known.

### Settlement mechanics, because they change the number

AM-settled standard third-Friday SPX options settle on a Special Opening Quotation, published
under the ticker SET. CBOE's own document: "The SOQ is based on the opening trade price in the
primary market of each constituent stock... Because official opening prices are rarely
disseminated at the opening, the SOQ... is not anchored to a specific time of day... the current
values of the intraday S&P 500 Index and SOQ will typically be different"
([CBOE, Settlement of Standard A.M.-Settled S&P 500 Index Options](https://cdn.cboe.com/resources/spx/Settlement_of_Standard_AM_Settled_SP_500_Index_Options.pdf)).
Trading ceases the Thursday before. Marking that leg from Thursday's close, or from any Friday
intraday SPX print, produces a wrong realised P&L. Verbatim from the CBOE specifications page:
"Trading in SPX options will ordinarily cease on the business day (usually a Thursday) preceding
the day on which the exercise-settlement value (i.e., the expiration date) is calculated, 5:00 pm
ET" ([CBOE, SPX Options Specifications](https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/)).

SPXW weeklies settle PM, on the ordinary close. Verbatim from the same page: "Trading in SPXW
options will ordinarily cease on the day of expiration, 4:00 pm ET, and at 1:00 pm ET for any half
day holiday."

That half-day clause is a real edge case and it is easy to miss. On a half-day holiday the SPXW
settlement clock is 1:00 pm ET, not 4:00 pm. Any years-to-settlement calculation that assumes a
fixed 4:00 pm close overstates T by three hours on those dates, and the error lands hardest on the
front leg of a calendar, where T is smallest and the sensitivity to it is largest.

The consequence stands either way. A single campaign can mix a PM-settled weekly front leg with an
AM-settled monthly back leg. **Settlement style is a per-leg flag, not a per-calendar one.**

SPX and SPXW are cash-settled, so classic pin and assignment risk does not apply. American-style
equity mechanics — early exercise, ex-dividend risk on short ITM calls, a margin call over a
weekend when only the short leg is assigned — would apply the moment any equity-underlying leg
entered the book. Not a requirement today. A guard to keep in the design.

### What must be captured at entry because it cannot be reconstructed

Because this system already stores full chains, greeks, term structure and IV history at 30-minute
RTH resolution, the honest answer is narrower than the generic checklist. Spot, both legs' IV,
term-structure slope, IV rank, the full greeks set — all reconstructible.

Unrecoverable:

1. **The quote you were actually looking at when you clicked.** A 30-minute snapshot samples a
   different instant than order submit.
2. **Which side of the combo quote you lifted, and the net price at submit versus at fill.** This
   is the reference price for the only honest slippage number.
3. **Top-of-book size at that instant.**
4. **The thesis, the invalidation condition, and the structures you considered and rejected.** No
   data source of truth exists at all. The repo already encodes this: `entryThesis` is documented
   as "a free-text hook, set at OPEN time" — captured once, at the one moment it exists.

### The invariant that would have caught −$319,850

The prior failure has two named mechanisms, both preserved as warnings in the code:

1. A ROLL stored a single combined `netAmount` (open debit minus close credit). Recompute needs
   the two components separately, or a roll's open-leg debit lands in `openNetDebit` and its
   close-leg credit in `closeNetCredit` incorrectly. Fixed by storing `rollOpenDebit` and
   `rollCloseCredit` explicitly.
2. Fill classification was derived from the calendar's current, mutable `status` column instead of
   the fill's own broker-reported `positionEffect`. Status reflects the calendar's latest state,
   not a historical fill's role at trade time. This "folded a calendar's real CLOSE fills into
   OPEN events (or vice versa) whenever status hadn't kept pace with reality."

**The general lesson: classify a fill's role from data stored on the fill at trade time, never
from a mutable current-state column. Never let a compound event net its components into one number
without keeping the split.**

**The invariant:**

> Sum of per-trade realised P&L over any window must equal the broker cash delta over that same
> window, net of transfers.

Not a dashboard tile. An automated test, run every ingest cycle against the `broker_transactions`
raw store the system already keeps. The −$319,850 case would have failed this check by roughly
$320,200 on a $17k account. No metric formula catches that class of bug; a formula applied to a
corrupt series just produces a confidently wrong ratio.

One corollary, already learned here. Fixing the source-of-truth field does not retroactively fix
already-derived numbers. `packages/core/src/journal/application/recomputeSnapshotPnl.ts` exists
because `pnl_open` is frozen at snapshot-write time, so every historical snapshot row carried a
P&L computed from a stale `openNetDebit` after that field was corrected. Assume this will be
needed again. Keep recompute a pure function of stored fills, with no broker call.

---

## 5. P&L attribution

### The standard decomposition

Vol desks call it **Greeks decomposition**, or P&L attribution, or P&L explain. It splits option
P&L into greek terms via a Taylor expansion of the pricing function, with an explicit residual.

```
Delta P&L  = delta × ΔS
Gamma P&L  = 0.5 × gamma × (ΔS)²
Theta P&L  = theta × days elapsed
Vega P&L   = vega × Δσ
Residual   = actual P&L − (delta + gamma + theta + vega)
```

Formulas from a worked numeric example on a real IWM put position
([moontower.ai](https://blog.moontower.ai/dynamic-hedging-option-p-l-decomposition/)). A risk.net
paper calls the Greeks decomposition "the most commonly used approach" and cites the lineage: Carr
(2005) for the fixed-vol case, Bergomi (2016) and Ravagli (2015, 2022) for local and exotic
attribution, Daviaud & Mukhopadhyay (2022) for the live-implied-vol generalisation
([risk.net](https://www.risk.net/media/download/1091141/download)).

**The residual is a first-class output, always present, never an error to drive to zero.**

### Two reasons not to copy the desk version naively

**The method is built for a one-day mark-to-market horizon.** The risk.net paper states its own
limitation: summed over a long hold, the standard approach "loses the memory of the implied vol at
which the option was originally traded." That is exactly the multi-week calendar hold, not the
desk's daily reprice. The paper's fix needs continuous vol-surface data a retail journal will not
have.

Workable version here: attribute per 30-minute RTH snapshot interval — data the system already
captures — sum across the campaign, and display cumulative residual as its own line.

**The clean example is clean because it re-hedges.** The moontower position buys a single option
and re-hedges delta with shares every day. That sterilises delta and leaves a small, well-behaved
residual. A static delta-neutral calendar does not re-hedge. Front and back leg vega and vanna move
in opposite directions as spot and term structure shift, so delta is not cleanly separable from
vega and vanna. **Expect a noisier residual with proportionally larger vanna, volga and charm
cross-terms.** Set that expectation up front, so a large residual is not mistaken for a broken
formula. This part is reasoning from the structure, not a fetched finding.

### Separating what the trader controlled from what the market did

The decomposition answers where the money came from. It does not answer who caused it. Three
buckets:

| Bucket | Source | Examples |
|---|---|---|
| Market | Greeks decomposition | Delta, gamma, theta, vega, residual |
| Execution | Fill against mid at submit | Combo-level effective spread, in and out |
| Decision | Immutable entry record versus what happened | Followed the exit rule or not; held past the stated DTE window; sized inside the declared cap |

Only the second and third are controllable. Only the third needs a human to type anything.

---

## 6. The metrics

### Metrics that earn their place

Ordered by reliability: computable unattended from fills and snapshots first, then the ones
needing one piece of typed intent.

| Metric | Formula | What it assumes | How to read it |
|---|---|---|---|
| **Reconciliation invariant** | Σ realised P&L over window == broker cash delta over window | The `broker_transactions` raw store is complete | Not a metric. A test. Red means every number below is void |
| **MTM drawdown** | Peak-to-trough of equity including open marks, from 30-min snapshots | Snapshots are dense enough to see the trough | The real risk number. Closed-P&L drawdown shows zero for a position that went 15% underwater and recovered — and a margin call does not wait for you to decide the position is done |
| **MAE / MFE by full reprice** | Worst and best mark-to-market excursion of the *repriced spread*, per snapshot | Reprice both legs. Never infer from spot | Two uses: calibrate a stop empirically from where losing calendars actually turned, and separate "right but exited early" (large MFE, closed below it) from "never working" (MFE near zero) |
| **Combo effective spread** | \|execution price − combo mid at submit\|, in $ and % | Mid at *submit*, not at fill | The largest controllable term. Barber & Odean measured a 7-point annual gap opening net of costs on identical gross performance, and quantified round-trip cost at 3% commissions plus 1% spread on 1990s single stocks. Percentages do not transfer; the mechanism does, and a calendar crosses four legs' worth of spread per round trip |
| **Theta captured vs theta expected** | Σ model theta per snapshot vs actual value change, **net of delta and vega P&L** | The netting is done. Without it the number is a vega result wearing a theta label | "Captured 140% of expected theta" in a week back-month IV rose is a vega win, mislabelled |
| **Portfolio net vega / gamma vs equity** | Rolled-up greeks over open positions ÷ account equity | Greeks are current | Replaces per-trade position sizing. Several concurrent short-vega SPX spreads are one bet in a real vol event |
| **Expectancy in R** | (win rate × avg R win) − (loss rate × avg R loss) | R = the stop **declared at entry**, write-once | See the R problem below. Descriptive only until n is in the hundreds (§2) |
| **Hold time vs stated DTE plan** | Actual days held vs the window written at entry | An entry record exists and cannot be edited | The cheapest drift detector there is |

**The R problem.** R is well-defined for a directional trade with a hard stop: entry minus stop, a
structural observable. For a long calendar it is not. Textbook max loss is the net debit, but the
debit only caps the loss if you hold to front expiry with the back leg flat, which never happens
in this playbook. Realised losses come from back-month IV crush or a large spot move away from the
strikes. Debit-as-R makes every R-multiple artificially small and non-comparable across trades
with different debits and DTE.

**Use the declared stop, not the structural max loss.** That makes R behavioural, and it only
works if the stop is captured at entry and locked. Which ties this metric to §8.

Two more that are worth building but add real complexity, so they belong in a research view rather
than a scoreboard: P&L per unit of vega, and P&L per unit of theta-days. Both need one consistent
convention for *when* the greek is measured. Entry-only greeks misattribute P&L on any position
that was rolled or adjusted. Average-over-holding-period is more honest and the 30-min snapshots
make it computable.

### Metrics to deliberately omit from the scoreboard

Omitting from the scoreboard is not deleting the data. These can exist as secondary views with
their caveat attached. None of them may gate a go/no-go decision.

| Metric | The specific way it misleads a spread trader |
|---|---|
| **Win rate, alone** | Silent on loss size, and gameable in the exact direction this strategy already leans. Widen the stop, roll the loser, hold through the adverse move — every one raises win rate and lowers expectancy. A delta-neutral calendar seller gets a high win rate by construction. It says close to nothing about whether the edge is real. Vendor-adjacent sources put it plainly: a 40% win rate can be highly profitable and an 80% win rate can be losing money (UNVERIFIED — search summaries of optionjournal.app and coveredge.io, not fetched). Pair it with expectancy and average win versus average loss, or do not show it |
| **Profit factor** | Denominator can be one or two large losses at this trade count, so it swings month to month. If computed on closed trades only while open losers sit excluded, it structurally overstates edge during exactly the period an open loser exists |
| **Sharpe, annualised by √252 or √12** | Provably wrong under serial correlation. Lo shows annualised Sharpe overstated "by as much as 65 percent" for real hedge-fund series, and that correcting it changes rankings ([The Statistics of Sharpe Ratios](https://traders.studentorg.berkeley.edu/papers/The-Statistics-of-Sharpe-Ratios.pdf), Financial Analysts Journal 58(4), 2002). A book of overlapping multi-week calendars marked every 30 minutes is mechanically autocorrelated — today's mark reprices yesterday's positions. Biased high, not slightly |
| **Sortino** | Downside deviation is computed from below-target periods only. A short-vol book's losses are sparse and fat, so the sample is thin and understates the tail — right up until the tail arrives and retroactively blows up the estimate |
| **Calmar** | Denominator is observed max drawdown. Under about two years the book has not yet met a real vol event, so the worst case is an underestimate and the ratio is overstated for the same reason as Sortino |
| **Percentage of max profit taken** | Has no honest denominator here. For a defined-credit trade max profit is the credit, fixed at entry. A long calendar's max profit depends jointly on where spot sits at front expiry *and* back-month IV at that moment. Defining it requires picking a model assumption, so the percentage measures the model as much as the trade. Not adaptable. Exclude |
| **Rolling ROI% on margin** | Denominator moves. A calendar's buying-power requirement gets recalculated as spot, IV and time change, unlike a vertical's fixed max loss. A live-updating ROI% invites comparing numbers that measure different things |
| **Per-leg slippage** | A combo fills as one print at one net price. Per-leg allocation is an accounting convention chosen after the fact, not a separately observed market event. "You paid $0.03 too much on the back leg" invents precision that does not exist |
| **Per-trade Kelly size** | Two failures. Kelly's optimum needs true population edge and variance; from a small sample the estimate is noisy, and Kelly's growth function punishes overbetting asymmetrically — which is the real reason fractional Kelly is standard, not nerve. Worse here: Kelly assumes independent bets. Several concurrent short-vega SPX spreads share one risk factor and lose together. Summing per-position Kelly fractions overstates safe total size |
| **An attribution that reconciles exactly** | If delta+gamma+theta+vega sums to realised P&L with no visible residual, the residual was folded into theta or vega. That manufactures false precision about where the money came from — the opposite of what attribution is for |
| **A mark-derived P&L on a settled leg** | Once SET or the 4pm close is knowable, it supersedes any traded quote. Showing mid-derived P&L as final on an expired leg is the phantom-P&L mechanism. Gate the realised-P&L field on settlement-value availability, or label it provisional |

### Slippage benchmarking is subtler than it looks

Two mechanisms, both worth stating before anyone builds this.

**The reference price is not stable.** Market makers price to their own fair value, not the NBBO
midpoint, especially away from ATM. From a practitioner thread: "the market making firms have
their own fair values for the options. It often isn't the mid point (especially with non-ATM
options)... you will get executions based on where your price is to their fair values, not the
listed market prices." A bid appearing on one leg of a two-quote market shifts that leg's
arithmetic midpoint without the combo's value having changed, and a spread must execute all legs
on one exchange, so a spread's NBBO midpoint can combine leg prices from different exchanges that
never cross together
([elitetrader](https://www.elitetrader.com/et/threads/option-spread-execution-slippage.278143/)).

**The timestamp choice changes what you are measuring.** Benchmarking against mid at *fill* time
conflates execution cost with market drift. A resting limit order on a calendar can sit for
minutes; using fill-time mid silently absorbs adverse selection into what looks like a good fill.
Benchmark against mid at *submit*.

The named metric is **effective spread**: |execution price − midpoint|, in dollars and percent,
midpoint sampled at the same instant. Methodology from a Nasdaq study of NDX index options — the
closest published, methodologically explicit analog, since no equivalent public SPX study was
found
([Nasdaq](https://www.nasdaq.com/articles/measuring-execution-quality-on-ndx-index-options-with-effective-spreads)).
Take the definition and the method. **The percentages in that article are NDX, not SPX, and must
not be shown as SPX benchmarks.** One transferable qualitative point: low-delta legs show a worse
percentage effective spread without a proportionally higher dollar cost, so the OTM legs a
delta-neutral calendar necessarily carries will look worse in percent even when execution is fine.

### One statistic that must not enter the document or the UI

The widely repeated claim that tastytrade studied a large trade sample and found closing at 21 DTE
improves risk-adjusted returns by a specific percentage could not be traced to any primary
tastylive or tastytrade source. Searches returned only blog and SEO summaries; direct fetches of
tastylive.com pages returned 404. The circulating figures have the shape this project has flagged
before as fabricated precision. The general direction — closing short premium before expiry
reduces the final-weeks gamma-versus-theta tradeoff — is a defensible mechanical argument that
needs no study. **The numbers are UNVERIFIED and should not be restated.**

---

## 7. Automatic versus manual

Manual entry is what kills journals. A vendor selling automation states the cost directly: manual
entry at "15–30 minutes per day leads to abandonment within weeks," against a claimed 5–10 minutes
with sync — 0 minutes data entry, 3–5 tagging, 2–3 context notes
([TradeZella](https://www.tradezella.com/blog/effective-trading-log-guide)). Self-serving and
uncited. Treat as an order-of-magnitude claim.

One number circulating alongside it — "73% of day traders who start a trading journal quit within
three weeks" — **does not appear anywhere in the fetched page HTML.** It was fabricated by a
search summariser. It is recorded here only so it never gets carried forward as a fact.

But entry cost is not the whole failure. The sharper one is entry cost with no usable output:

> "Several blue moons ago I used to do it in an Access database. Problem was creating usable
> reports. It took way more time than entering data, including pics. Basically, the journal was a
> silo... no way out in a reasonable time for the data, but easily queried on screen!"
> — [elitetrader](https://www.elitetrader.com/et/threads/journaling-what-tags-make-sense.376064/)

A journal that captures and cannot be queried fails the same way even when capture is free.
**Design the review output alongside the capture schema, not after it.**

### The split

This system already ingests Schwab and CBOE chains, computes greeks server-side, tracks term
structure and skew, and pairs broker fills. Almost the entire automatic side is built. That is not
a normal starting position for a journal, and it changes where the friction budget goes.

| Automatic — never ask | Manual — only a human has it |
|---|---|
| Fills, quantities, prices, commissions, fees | The thesis: why this structure, these strikes, this expiry pair |
| Both legs' IV, greeks, DTE at every snapshot | The invalidation condition, as an if-then |
| Term-structure slope, skew, IV rank at entry | The exit plan: profit target and stop |
| Spot, GEX, regime context | Plan-followed, yes/no, at close |
| Position value repriced every 30 minutes | One short post-trade note |
| MAE, MFE, MTM drawdown, attribution, effective spread | |
| Roll chains, settlement events, campaign rollup | |

Practitioners converge on the same boundary from a different direction. Every tag proposed in the
forum threads is something a human must judge — setup, regime, conviction, plan-followed. Nobody
proposes re-deriving a number the broker already has. And nobody proposes automating the thesis;
several frame it as the reason to journal at all.

**So the new manual surface is four fields and one binary.** That is a disciplined form, not a
data-entry form. Spend the entire friction budget there.

---

## 8. Pre-commitment and the immutable record

The strongest evidence in this whole corpus for how to structure a written record is not about
trading.

In an IARPA-sponsored geopolitical forecasting tournament, 1,000+ forecasters were randomly
assigned across 137 questions over ten months. Forecasters accountable for **outcome** accuracy
outperformed those accountable for **process** quality, and the gap grew over time. Verbatim:
"Holding forecasters accountable to outcomes ('getting it right') boosted forecasting accuracy
beyond holding them accountable for process ('thinking the right way'). The performance gap grew
over time."
([Chang, Atanasov, Patil, Mellers & Tetlock, Judgment and Decision Making 12(6), 2017](http://journal.sjdm.org/17/17630/jdm17630.html)).

Method matters as much as result: forecasters placed time-stamped probability predictions with
written justifications, could update before resolution, and were scored against the real outcome.

The transfer is direct. **A thesis record only has teeth if it is time-stamped at entry and scored
later against what actually happened.** A journal that grades "quality of reasoning" reproduces the
weaker condition in that study.

For the plan itself, write it as an if-then. A meta-analysis of 94 independent studies covering
over 8,000 participants found implementation intentions produce d = 0.65 on goal attainment over
holding the intention alone (Gollwitzer & Sheeran, Advances in Experimental Social Psychology 38,
2006, pp. 69–119; citation and figure cross-checked against
[Wikipedia's reference list](https://en.wikipedia.org/wiki/Implementation_intention) and a
[secondary summary](https://goalsandprogress.com/implementation-intentions-gollwitzer-how-to/)).
The mechanism: an if-then plan delegates the decision to a pre-specified trigger, so the person
does not have to reason it out in the moment — the same moment a live loss has compromised them.

"If SPX closes below 6,400, close the calendar" is a pre-commitment. "I'll manage it if it goes
against me" is not.

### Why editable is worthless

Fields that require typed intent are exactly the fields that rot in a drawdown or get back-filled
to look better. Nothing forces them to exist before the outcome is known, and nothing checks them
against anything else. Price, greeks and fills are objective. "What was I thinking" is
unfalsifiable after the fact unless the system captured it at entry and refuses edits.

A stop declared at entry and locked is a real commitment the journal can grade against. A stop
field editable at any time is a diary entry that can be rewritten.

Independent convergence from practitioner tooling, arriving at the same rule from a different
angle:

> "Don't add tags retroactively. If you didn't tag at the time, don't go back and add tags weeks
> later — your memory of the trade is contaminated by the outcome and you'll tag every losing
> trade as conviction=2 because it lost. Tags set at entry are signal; tags set at review are
> post-hoc rationalisation."
> — [retired.today](https://retired.today/blog/trade-tagging)

**Current state, stated plainly:** `entryThesis` in `calendar-event.ts` is a nullable free-text
field. Nothing in the code enforces immutability today. This section is a recommendation for the
rebuild, not a description of what already happens.

Design rule: **entry-intent fields are write-once.** Written before the position opens, locked
after. Not "discouraged from editing" — structurally not editable. This one rule fixes both the
R-multiple definition problem from §6 and the flatter-yourself-later problem at once.

---

## 9. DO and DON'T

### DO

| Do | Evidence |
|---|---|
| Run the reconciliation invariant every ingest cycle, as a test | The −$319,850-on-+$395 incident. No formula catches a corrupt series; only an independent-ledger check does |
| Keep fill immutable, event derived, position the aggregate, ROLL first-class with its two components stored separately | Already built in `calendar-event.ts`; corroborated by the r/options position-level critique and by Wingman's existence |
| Fire a synthetic SETTLEMENT event from expiry and strike, not from a fill | Cash settlement produces no fill. A fill-waiting ledger leaves the leg open at its last mark forever |
| Flag settlement style per leg | CBOE's AM SOQ document is primary; the SPXW PM claim is UNVERIFIED. A weekly front and a monthly back can differ inside one campaign |
| Track turnover and adjustment frequency as a trended metric | [Barber & Odean 2000](https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/individual_investor_performance_final.pdf) — the most evidence-backed leading indicator of self-inflicted underperformance there is |
| Measure combo-level effective spread against mid at submit | [Barber & Odean 2000](https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/individual_investor_performance_final.pdf) on cost as the gap-maker; [Nasdaq](https://www.nasdaq.com/articles/measuring-execution-quality-on-ndx-index-options-with-effective-spreads) for the metric definition |
| Show the attribution residual as its own line | [risk.net](https://www.risk.net/media/download/1091141/download) — the standard method loses the entry-vol memory over a multi-week hold, and a static calendar does not sterilise delta |
| Capture thesis, invalidation and exit plan at entry, write-once | [Tetlock outcome accountability](http://journal.sjdm.org/17/17630/jdm17630.html) and Gollwitzer & Sheeran's d = 0.65; independently, [retired.today](https://retired.today/blog/trade-tagging) on retroactive tags |
| Make the review a comparison against the trader's own trailing baseline, capped at three observations | "Without a baseline, you don't know if this week was good, bad, or normal... Not 10 observations. Not a full journal entry. Exactly three" ([TradeZella](https://www.tradezella.com/blog/weekly-trade-review-process)). Vendor-stated, but self-contained reasoning |
| Lead the review with one binary: did you follow the plan, and if not, why | The most-repeated question across unrelated forum users, unprompted ([elitetrader](https://www.elitetrader.com/et/threads/trading-journal.374447/)); converges with the plan-followed tag and with Tetlock |
| Compute MAE/MFE by full spread reprice from the existing 30-min snapshots | Spot can sit still while a calendar's P&L swings on front-versus-back IV. Inferring from price movement is wrong for this structure |
| Ship a closed tag vocabulary of four to six | Sprawl is a named failure mode: journals grow "from two or three tags to fourteen, becoming a junk drawer where no two trades share the same tags" ([retired.today](https://retired.today/blog/trade-tagging)) |

### DON'T

| Don't | The failure it causes |
|---|---|
| Group by underlying symbol | Tradervue's model. Every leg of every SPX position collapses into one blob. Strategy-level P&L becomes unrecoverable |
| Ask the user to type a fake $0.00 fill for an expiry | [Tradervue's documented workaround](https://help.tradervue.com/article/3443-managing-option-positions). Manual reconciliation debt, on the exact path that already broke here once |
| Derive a fill's role from a mutable status column | The second named mechanism of the −$319,850 bug. Status is the latest state, not a historical fill's role |
| Net a compound event into one number | The first mechanism. A ROLL's open debit lands in the close bucket and the P&L is nonsense |
| Fix a source field and skip the recompute pass | Every already-derived row stays wrong. That is why `recomputeSnapshotPnl.ts` had to exist |
| Headline win rate | Gameable in the direction this strategy already leans, and near-guaranteed high by construction for a delta-neutral seller. §6 |
| Annualise Sharpe by √252 on overlapping positions | Overstated by up to 65% under serial correlation ([Lo 2002](https://traders.studentorg.berkeley.edu/papers/The-Statistics-of-Sharpe-Ratios.pdf)) |
| Show a percentage of max profit for a calendar | The denominator is a model assumption, not a fact. The percentage measures the model |
| Size positions by per-trade Kelly | Concurrent short-vega SPX spreads are one bet in a vol event. Summing independent fractions overstates safe size |
| Grade a directional or IV conviction score against outcomes | Zero-validity environment ([Kahneman & Klein 2009](https://www.hansfagt.dk/Kahneman_and_Klein%282009%29.pdf)). No amount of feedback calibrates it. The analytics produce noise dressed as insight |
| Build a "review your winners to reinforce what works" ritual | Self-attribution bias. Without a mechanism separating luck from process, a winner-review feeds the overconfidence this literature documents rather than correcting it (Gervais & Odean 2001, cited in both Barber & Odean papers above) |
| Ship an A–F self-graded trade score | No ground truth, and even vendors selling grading warn that inflated grades are worse than none because they manufacture false confidence (UNVERIFIED — search summary, not fetched). The defensible analog is the plan-followed binary, checkable against the immutable record |
| Let tags be free text | Sprawl. Forum users asked to brainstorm tags immediately produced one-off labels nobody would ever filter on ([elitetrader](https://www.elitetrader.com/et/threads/journaling-what-tags-make-sense.376064/)) |
| Copy a day-trading template | Time-of-day tags and per-session heatmaps are noise for an 8–45 DTE hold. What matters is whether the invalidation condition fired and how the greeks evolved across sessions. (The framing that broker history shows entry, exit and P&L but not whether the thesis held is UNVERIFIED — search summary — though it matches the fetched retired.today emphasis) |
| Write entries that only report | "Took three trades today, won two, lost one" restates the blotter. Naming a recurring pattern is the thing the blotter cannot do. (UNVERIFIED — search-summarised vendor content) |
| Present descriptive numbers with confidence language | §2. Below a few hundred closed trades, no ratio here is evidence about edge |

### Where the research disagreed

**Emotion tagging.** [retired.today](https://retired.today/blog/trade-tagging) argues never: "you
can't honestly tag yourself as 'greedy' while placing the trade because greed doesn't feel like
greed in real time, it feels like opportunity... produces zero actionable signal."
[traderssecondbrain](https://traderssecondbrain.com/guides/how-to-tag-trades) builds a whole
category on it and reports calm trades winning 54% against FOMO trades at 29%. Both are vendors.
Neither cites a study. The first position is more consistent with the pre-commitment evidence in
§8: an emotion tag set at entry is plausible signal, one set at review is decoration.

**Review cadence.** Weekly is the standard recommendation. A caveat in the same vendor's material
says low-frequency traders should widen to bi-weekly or monthly and wait for 15–20 trades before a
pattern means anything — UNVERIFIED, search summary, not fetched. The underlying logic is sound
and this book is low-frequency, so weekly review of trade outcomes would mostly be reviewing an
empty set. A four-tier cadence (daily capture, weekly patterns, monthly trends, quarterly rule
changes) is also proposed — UNVERIFIED, and its daily rung does not fit an 8–45 DTE hold.

**Tradervue's free tier.** Not on the current pricing page. A homepage testimonial says "right now
I'm on the free version and it's still great." Either legacy, grandfathered, or hidden. Aggregator
sites reporting a "free plan, 100 trades/month" could not be confirmed against the vendor's own
page — one of several places where review-farm numbers conflicted with fetched ground truth. The
same happened with a TradesViz price: summaries said $15.74/mo, the pricing page said $22.49
annual and $29.99 monthly.

**Journal survivorship.** The claim that self-kept journals under-record losing trades is a
plausible extrapolation from the disposition effect, not a proven result. The disposition effect
is about *holding* losers, not about *not logging* them. No controlled finding about journal
completeness was found. Stated as inference, not fact. The fix works either way: a broker-fed
journal is mechanically checkable against a second ledger, and a hand-typed one is not. That is
the real argument for automation — not that automation is more trustworthy, but that it *admits an
audit* and manual entry does not.

---

## 10. The minimum viable journal

Ten minutes a week. Everything below is either computed unattended or takes under a minute to
type.

### At entry — one form, five fields, write-once

| Field | Type | Why |
|---|---|---|
| Thesis | Free text, one or two lines | Unrecoverable later. §4 |
| Invalidation | If-then, structured | Gollwitzer & Sheeran; the trigger has to be pre-specified. §8 |
| Exit plan | Profit target and stop, both numeric | The stop *is* R. §6 |
| Planned DTE window | Two integers | Makes hold-time drift checkable |
| Combo mid at submit and the net price submitted | Two numbers, or captured by the order path | The only honest slippage reference. §6 |

Locked the moment the position opens. No edits, no exceptions.

### Continuously, with no human involvement

- Fills paired into events; ROLL first-class with its two components stored apart.
- Synthetic SETTLEMENT events fired from expiry and strike.
- 30-minute reprice of every open calendar. MAE, MFE, MTM drawdown roll forward from it.
- Greek attribution per snapshot interval, summed across the campaign, residual on its own line.
- Combo effective spread on every entry, roll and exit.
- Portfolio net vega and gamma against account equity.
- **The reconciliation invariant, every cycle.** Realised P&L over the window against broker cash
  delta over the window. If it fails, the journal shows one thing: the failure. Nothing else is
  trustworthy until it is green.

### At close — one binary and one line

- **Plan followed: yes / no.** If no, one sentence on why. This is the load-bearing field. A
  strategy that loses on plan-followed=yes is broken. A strategy that wins on plan-followed=yes and
  loses overall because plan-followed=no trades drag it down is fine, and the trader is not. The
  fix is completely different in each case ([retired.today](https://retired.today/blog/trade-tagging)).
- One short note. Optional.

### The review surface — the part that must not be a scroll

Not a trade table. Four things:

1. **Reconciliation status.** Green or the failure.
2. **This cohort against the trader's own trailing baseline**, with anything more than ~15% off
   the average marked.
3. **Campaign view for anything rolled**: one row per campaign, roll events nested underneath,
   campaign expectancy above and per-roll execution cost below.
4. **Drift**: positions held past their stated DTE window, exits that overrode the declared stop,
   sizes outside the declared cap. All computed from the immutable entry record, no typing.

Cadence: monthly, or on every tenth closed campaign, whichever comes first. Weekly is a
day-trader default and would review an empty set here. Output capped at three observations, at
most one of which becomes a rule change.

### What this deliberately does not have

No win-rate headline. No Sharpe. No profit factor. No percentage of max profit. No Kelly
recommendation. No letter grade. No emotion field. No screenshots — if chart context is kept at
all, auto-capture it at entry and exit with the thesis overlaid, because the one practitioner
report of screenshots surviving a real trading week describes notes burned into the image with no
separate write-up ("Short and sweet. Can't be bothered writing a novel" —
[elitetrader](https://elitetrader.com/et/threads/tips-for-keeping-a-trading-journal.326221/)).

No free-text tag field. Four tags, closed vocabulary, set at entry: **structure** (calendar or
diagonal), **entry trigger** (which rule fired), **exit reason** (target, stop, roll, settlement),
**plan-followed** (yes/no, the one set at close).

That substitutes two of the four in the source taxonomy, which proposes setup type,
session/regime, conviction 1–3, and plan-followed
([retired.today](https://retired.today/blog/trade-tagging)). Conviction is dropped because §1 says
a directional or IV conviction score cannot be calibrated in a zero-validity environment.
Session/regime is dropped because it is a day-trading field, and regime here is computed
automatically from data the system already has.

### The test this journal has to pass

Every skeptic in §3 says the broker's order-status screen already does this. They are right about
almost all of it. The two things it cannot do are the campaign-level ledger across rolls and the
immutable pre-commitment record.

**If a screen in this journal does not do one of those two things, delete it.**

---

## Sources

Primary, fetched and verified:

- Barber & Odean, [Trading Is Hazardous to Your Wealth](https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/individual_investor_performance_final.pdf), Journal of Finance 55(2), 2000
- Barber & Odean, [Boys Will Be Boys](https://faculty.haas.berkeley.edu/odean/papers/gender/boyswillbeboys.pdf), QJE 116(1), 2001
- Barber, Lee, Liu, Odean & Zhang, [Do Day Traders Rationally Learn About Their Ability?](https://faculty.haas.berkeley.edu/odean/papers/Day%20Traders/Day%20Trading%20and%20Learning%20110217.pdf), working paper, 2017
- Kahneman & Klein, [Conditions for Intuitive Expertise](https://www.hansfagt.dk/Kahneman_and_Klein%282009%29.pdf), American Psychologist 64(6), 2009
- Lo, [The Statistics of Sharpe Ratios](https://traders.studentorg.berkeley.edu/papers/The-Statistics-of-Sharpe-Ratios.pdf), Financial Analysts Journal 58(4), 2002
- Chang, Atanasov, Patil, Mellers & Tetlock, [Accountability and adaptive performance under uncertainty](http://journal.sjdm.org/17/17630/jdm17630.html), Judgment and Decision Making 12(6), 2017
- Guenther & Lordan, [When the Disposition Effect Proves to Be Rational](https://eprints.lse.ac.uk/118353/1/fpsyg_14_1091922_1_.pdf), Frontiers in Psychology 14, 2023 — the source for the Frydman & Rangel (2014) result that reducing purchase-price salience cut the disposition effect by 25%
- CBOE, [Settlement of Standard A.M.-Settled S&P 500 Index Options](https://cdn.cboe.com/resources/spx/Settlement_of_Standard_AM_Settled_SP_500_Index_Options.pdf)
- [risk.net P&L attribution paper](https://www.risk.net/media/download/1091141/download)
- [moontower.ai, option P&L decomposition](https://blog.moontower.ai/dynamic-hedging-option-p-l-decomposition/)
- [Nasdaq, effective spreads on NDX index options](https://www.nasdaq.com/articles/measuring-execution-quality-on-ndx-index-options-with-effective-spreads)

Cited without a URL because no stable public copy was found:

- Odean, "Are Investors Reluctant to Realize Their Losses?", Journal of Finance 53(5), 1998
- Shefrin & Statman, "The Disposition to Sell Winners Too Early and Ride Losers Too Long", Journal of Finance 40(3), 1985
- Barber & Odean, "The Behavior of Individual Investors", Handbook of the Economics of Finance ch. 22, 2013
- Gollwitzer & Sheeran, "Implementation intentions and goal achievement: A meta-analysis", Advances in Experimental Social Psychology 38, 2006
- Gervais & Odean, "Learning to Be Overconfident", 2001
- Chague, De-Losso & Giovannetti, "Day Trading for a Living?", SSRN 3423101 — UNVERIFIED, could not be fetched

Repo:

- `packages/core/src/journal/domain/calendar-event.ts`
- `packages/core/src/journal/application/recomputeSnapshotPnl.ts`

Vendor and practitioner sources are linked inline in §3, §7, §8 and §9.

### One design tension left open

Frydman & Rangel (2014), as reported in
[Guenther & Lordan](https://eprints.lse.ac.uk/118353/1/fpsyg_14_1091922_1_.pdf), found the
disposition effect 25% lower when purchase-price salience was reduced. A journal that foregrounds
cost basis and open P&L may entrench the bias it exists to expose. That research is on single
stocks, where purchase price is one well-defined number. On a rolled multi-leg calendar it is not
even that. Worth a deliberate UI decision. Do not inherit the brokerage-screen default without
making it.
