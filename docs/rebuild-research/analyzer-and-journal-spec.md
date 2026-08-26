# Analyzer & Journal — product specification

The synthesis document. Research fed this; the rebuild works from it.

Written 2026-08-25. Sources are inline: repo facts as `file:line`, external claims as links,
unverified claims marked **UNVERIFIED** and never laundered into a confident sentence.

Companion documents:

- [optionstrat-live-capture.md](optionstrat-live-capture.md) — measured teardown of the live site.
  Where this spec and the research JSON disagree, that capture wins, because it was measured.
- [docs/architecture/overview.md](../architecture/overview.md) — the hexagon this lands in.

---

## 1. The two surfaces and why they are one product

The analyzer answers **"should I put this trade on."** The journal answers **"what happened to
the trades I put on, and what does that tell me."**

They share almost all of their apparatus: the expiration ribbon, the strike axis, the per-leg
colour identity, the price × date matrix, the payoff curve, the metric strip, and — critically —
the pricing kernel that produces every number in all of them.

### Decision: one screen, one component tree, one pricing path. Two URL shapes.

The mode switch is real and visible in the page. It changes which panels are on by default and
which date counts as "now". It does not change the code that produces a dollar figure.

**Why not two screens.** Two routes tempt two implementations. Two implementations of P&L is
exactly the shape of the bug that produced −$319,850 for a trade that made +$395
(`morai-journal-pnl-fill-ledger-fix.md`). The repo already committed to the opposite rule in code:
`apps/web/src/lib/scenario-engine.ts:5` — *"D-01: One shared kernel. The Analyzer's live P&L
preview uses the same bsmPrice/bsmGreeks as the server-computed Positions/Journal P&L —
guaranteeing cross-screen consistency for the same calendar."* Honour that.

**Why two URL shapes anyway.** A prospective trade has no identity beyond its legs, so the legs
are the URL. A live position has a `calendars.id`, so the id is the URL. A route is not a code
path.

| Mode | URL | "Now" is | Default panels |
|---|---|---|---|
| Prospective | `/build/calendar-put-spread/SPX/-.SPXW261016P7425,.SPXW261130P7425` | today, live spot | matrix, curve, metric strip |
| Position | `/position/{calendarId}` | today, live spot, **plus entry marks** | P&L hero, greek attribution, path overlay, drift meters, then matrix |

The URL-as-trade encoding is copied outright from OptionStrat. It is verified from the live page:
`/build/{definition}/{symbol}/{legs}`, per leg an optional leading `-` for short, then `.`, then
`ROOT + YYMMDD + P|C + STRIKE` ([optionstrat-live-capture.md §7](optionstrat-live-capture.md)).
The document title is generated server-side from it, so a shared link previews correctly with no
stored state. No database row, no share id, no expiry. It costs nothing and it makes every trade
discussion a link.

### Which mode is primary

**Position monitoring is the primary surface. The analyzer is secondary.**

This is a deliberate inversion of OptionStrat's information architecture, and it is the highest-
leverage departure in this document. Three reasons, in order:

1. OptionStrat's own answer to "I already own this trade" is to overtype the entry price by hand.
   Verified verbatim from their FAQ: *"Yes, simply click the price of the stock or option to
   change it. Type in what you paid for it and press Enter."* Their saved-trade tracking is high,
   low, and a value graph — a paid feature at that
   ([optionstrat-live-capture.md §4, §5](optionstrat-live-capture.md)). They are a builder with a
   manual override, not a position monitor.
2. Morai already stores 30-minute RTH snapshots with greeks per open calendar
   (`packages/adapters/src/postgres/schema.ts:78`) and pairs real broker fills into positions
   (`packages/core/src/journal/domain/calendar-event.ts`). Nobody scanned in the research has both.
   Building the builder first under-invests in the only surface where we hold data a competitor
   cannot get.
3. The cost of being wrong is asymmetric. A wrong prospective number costs a trade not taken. A
   wrong monitoring number is money already at risk, mismeasured. The −$319,850 bug lived on the
   monitoring side.

---

## 2. The analyzer specification

OptionStrat's anatomy is the baseline. Each departure is stated with its reason.

### 2.1 Component inventory

Five components need real design. The rest are thin wrappers over props.

| Component | Baseline behaviour | Departure |
|---|---|---|
| **TradeHeader** | Symbol chip, spot, change%, refresh, "Delayed" badge, `EXPIRATIONS: 52d, 97d` | No delay badge — our data is live from our own Schwab/CBOE accounts. In position mode the DTE set shows **both**: `entered 52d/97d → now 23d/68d`. Spot comes from the existing SSE feed, not a new poll. |
| **ExpirationRibbon** | Month bands sized by count of expirations in that month, day ticks below, `AM` superscript on AM-settled dates, selected expiries in per-leg colour | Keep the layout exactly (two-pass bin: `band_width = ticks_in_month / total_ticks × ribbon_width`). Keep the AM marker — it is load-bearing, not decoration (§3.4). Add a second thin band underneath showing the **planned exit DTE window** in position mode. |
| **StrikeAxis** | Draggable leg pills at their strike, spot marker on the same axis, a bare `⚠` badge per pill | **Drop the bare glyph.** Any status flag ships with an icon **and** a label, in a reserved status colour never reused for leg identity. A flag whose meaning a careful reader cannot recover is not a flag. Pills snap to the real chain strike increment and offset visually when two legs land on the same strike. |
| **MetricStrip** | Paged row: net debit, max loss, max profit, chance of profit (padlocked `--%`), breakevens | **No padlocked slots** — there is no paywall here, so a permanently unresolved metric slot has no reason to exist. **Split max loss into two labelled figures** (§2.4). Add a provenance caption (§2.5). |
| **PLMatrix** | ~21 rows × ~20 cols, rows evenly spaced in **percent** not price, date columns irregular and thinning with distance, diverging heatmap centred on zero, dollar value printed in every cell, dashed rule at spot, largest cell emphasised | Keep all of it. Percent-spaced rows and thinning date columns are both correct and both copied. **Change the palette** (§2.6). Native `<table>` with `<th scope>`, `role="grid"`, roving tabindex. No virtualisation — ~400 cells is an order of magnitude below where canvas pays off, and virtualised grids break screen-reader row indexing ([W3C APG data grids](https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/data-grids/)). |
| **PayoffChart + DateScrubber** | One filled curve for the scrubbed date, crosshair with live `$` label, dotted vertical at spot (unlabeled), solid cyan labelled vertical at breakeven, `DATE: Fri Oct 16th 3:00pm (52d)` | **Label the spot line.** Spot is the most important reference on the chart and OptionStrat leaves it unlabeled while labelling the derived breakeven. Inverted priority. Keep the explicit time of day and make the convention legible (§2.5). |
| **VolAssumptionControl** | One `AVERAGE ▾` dropdown + one global IV slider with ×1/×2/×3 ticks | **Replaced entirely.** See §3. This is the single largest departure. |

Trivial components, listed for completeness: ViewTabs, MetricSelector
(`P/L $ · P/L % · Contract Value · % of Max Risk`), RangeSlider, LegPositionsPanel.

### 2.2 State model

The only state that is **owned** is the trade definition. Everything else is a view control, a
derived value, or ephemeral UI noise.

```
owned:      symbol, legs[]{ expiration, strike, right, side, qty }
view:       spotVolRule, timeVolRule, perLegIvOverride[], ivMultiplier,
            priceRangePercent, selectedDate, activeView, activeMetric, mode
derived:    every DTE, net debit, structural max loss, worst/best modelled cell,
            breakevens, chance of profit, every matrix cell, every curve point
ephemeral:  hovered cell, crosshair position, drag flags, ribbon scroll, strip page
external:   spot + change% (existing SSE feed — not this component's fetch)
```

Derived values are never persisted independently. A stored copy of a number that is a pure
function of stored inputs is a second source of truth waiting to drift.

### 2.3 What lives in the URL

**In:** `symbol`, `legs[]`, `spotVolRule`, `timeVolRule`, `perLegIvOverride[]`, `ivMultiplier`,
`priceRangePercent`, `selectedDate`, `activeView`, `activeMetric`.

**Out:** hover, crosshair, drag state, ribbon scroll, metric-strip page index.

The vol rules belong in the URL for a specific reason: they change every dollar figure on the
page. A shared link that silently reset to different vol assumptions would misrepresent the trade
being discussed. Ephemeral interaction state must never round-trip — every mouse move would become
a history-mutating navigation.

### 2.4 Max loss: two numbers, both labelled

The screenshot shows `NET DEBIT $5,355`, `MAX LOSS $9,370.27`, `MAX PROFIT $10,343.68`. The max
loss exceeds the debit. For a long calendar that cannot be a structural bound.

tastytrade states the structural rule plainly: *"The max loss for the spread is the debit paid and
can occur when both legs expire OTM and are worthless"* and *"Calculating the max profit of a long
calendar spread is impossible since the short put leg expires before the long put leg, and the
long put leg will still have some amount of extrinsic value remaining"*
([tastytrade](https://tastytrade.com/learn/options/long-put-calendar-spread/)).

So OptionStrat's figures are the worst and best cells found across the displayed price × date grid
under the current vol assumption — model outputs over a finite domain, not bounds. Nothing on the
page says so. **INFERRED**, but it is the only reading consistent with the arithmetic.

We ship both, separately labelled:

| Label | Definition |
|---|---|
| `MAX LOSS (structural)` | Net debit paid. The bound at front expiry. |
| `WORST MODELLED P/L` | Worst cell in the displayed range and date domain, under the current vol assumption. The label names the domain and the assumption. |
| `BEST MODELLED P/L` | Same, other direction. There is no structural max profit for a calendar. |

An unscoped superlative is as misleading as an unlabelled colour.

### 2.5 Conventions stated on screen, not in a FAQ

Three tools give three answers for the same trade because they pin different instants.

| Tool | Convention | Source |
|---|---|---|
| OptionStrat | market **open**, except current date (current time) and expiration date (market **close**) | verbatim FAQ, [optionstrat-live-capture.md §4](optionstrat-live-capture.md) |
| ThinkOrSwim | the picked date's **start** | [optionstrat-live-capture.md §4](optionstrat-live-capture.md); the TOS-parity carry work, `morai-payoff-mixed-source-tos-dateline.md` |
| Morai | **market close, 16:00 ET**, every column | this spec |

We pick close because CBOE's own specs anchor to it: SPXW *"ordinarily cease [trading] on the day
of expiration, 4:00 pm ET"*
([CBOE SPX specifications](https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/)).
The `3:00pm` on OptionStrat's slider is **UNVERIFIED** — no source explains it, and we do not
reproduce an unexplained label.

Every matrix column and every curve carries an explicit `(date, time)` pair for τ, and the metric
strip carries a one-line provenance caption:

```
priced from CBOE chain 15:45 ET · BSM · sticky-moneyness / curve-roll · r = DGS3MO 2026-08-25
```

This closes a real trust gap. A stale or wrong vol input misprices a live position with no visible
sign — structurally the same class of silent wrongness as the fill-ledger bug.

### 2.6 Palette

Leg identity stays as observed: blue for one expiry, magenta for the other, reused unchanged
across ribbon, strike axis, and chart. Blue/magenta is already distinguishable under deuteranopia
and protanopia. The rule is that colour follows the entity, never its rank — and in position mode
the assignment made at entry is **frozen and carried forward** through every subsequent snapshot.
Re-deriving leg colour per render from current moneyness or P&L sign would repaint the position's
identity every time its greeks shift.

The heatmap changes. Red/green is the one genuinely broken pair for the two most common colour-
vision deficiencies. Use ColorBrewer RdBu-11, hex stops fetched from
[d3-scale-chromatic](https://raw.githubusercontent.com/d3/d3-scale-chromatic/main/src/diverging/RdBu.js):

```
#67001f #b2182b #d6604d #f4a582 #fddbc7 #f7f7f7 #d1e5f0 #92c5de #4393c3 #2166ac #053061
   deep loss ───────────────────►  zero  ◄─────────────────────── deep gain
```

Red stays loss, which preserves trader intuition. **The printed dollar value in every cell is
non-negotiable** — it is the redundant, non-colour channel that carries the accessibility load
(WCAG 1.4.1), and it survives every "clean up the matrix for density" impulse.

Dark, near-black background, high-chroma accents, no decorative chrome. Kept. It sits next to
TradingView's dark chrome on a second monitor.

### 2.7 The compute boundary — and a correction

**The brief for this document stated the constraint as "the option math lives on the server and
must not be duplicated in the browser." That is a misstatement of the repo's actual rule, and the
repo disagrees with it in code.**

| Evidence | What it says |
|---|---|
| `eslint.config.js:94` | `{ from: "apps", allow: [..., "quant", ...] }`, comment: *"apps/web imports quant for client-side BSM live re-pricing (D21)"* |
| `apps/web/src/lib/scenario-engine.ts:1` | *"Client-side scenario re-pricing over @morai/quant"* — already shipped, already on that lane |
| `packages/quant/package.json` | `devDependencies` only. Zero runtime dependencies. A pure leaf that ships anywhere. |

Commit `1baceaa` ("delete the browser's copy of the math") deleted `chain-math.ts`, a browser
**twin** of logic that already existed in core. It was wrong not because it ran in the browser but
because it ran on **different inputs**: a per-expiry `(r, q)` instead of the one carry the stored
`bsm_iv` was inverted at, `rows[0].underlyingPrice` instead of the lower median of usable quotes,
and each row's own `observedAt` instead of a single instant
([optionstrat-live-capture.md §8](optionstrat-live-capture.md)).

**The rule is one implementation of the math over one set of inputs, not server-only.**

The research JSON's `compute-boundary-numbers` and `compute-boundary-scrubber` findings assert the
server-only reading and reject client pricing as "recreating the 1baceaa failure mode." They were
written without reading `eslint.config.js`. On repo facts they are wrong, and the file:line
evidence above settles it. Their proposed alternative — precompute a dense grid server-side and
ship it as JSON — is strictly more machinery for strictly less capability: it forces a network
refetch on every IV-slider move and every vol-rule change, which the shared kernel does not.

#### The mechanism: one kernel, one input block

On any change to `legs`, the server sends **one block**:

```
{ chainSlice, spot, carry: { r, q }, clock, perLegVol, model: "BSM" }
```

The browser re-prices the entire price × date grid through the same `bsmPrice` / `bsmGreeks` from
`@morai/quant` that the server uses for `calendar_snapshots` and journal P&L. One kernel. One
input set. Shipped to both sides.

| Control | Cost |
|---|---|
| leg add / remove / strike / qty / side | server round trip (new chain slice, new carry) |
| **date scrubber** | pure client — array index + redraw. 60fps, zero network. |
| **IV slider, per-leg IV, vol rule change** | pure client — re-price the grid from the same block. |
| range %, view tab, metric selector | pure client — re-slice and format already-computed values |
| hover / crosshair | pure client — interpolate the rendered curve |

Rejected: WASM (a second implementation), a web worker (the compute is not the bottleneck at this
grid size), and per-frame server calls (the reason OptionStrat's sliders feel instant is that they
make **two** network requests for the whole page, [optionstrat-live-capture.md §1](optionstrat-live-capture.md)).

Crosshair updates use `transform: translate3d()` only, never SVG attribute writes, so pointer
tracking never triggers layout. The curve itself is Recharts, already a dependency at
`recharts@3.9.2` in `apps/web/package.json`.

**Guard the invariant with a test, not a convention.** One cross-boundary test asserts that
client-side `scenario-engine` output and server-side snapshot P&L agree to the cent for the same
calendar at the same instant. If the two ever drift, that test fails before a trader sees it.

---

## 3. The vol-assumption control

The most consequential control in the analyzer. OptionStrat hides it behind the word `AVERAGE`.

### 3.1 What OptionStrat actually does

Verified verbatim from their FAQ:

> *"Implied volatility is never constant through the life of an option, so we recommend that you
> move the IV slider to see how changes in implied volatility will affect your trade."*

So the model is **flat, constant IV per leg, held fixed across the whole matrix**. No sticky-strike
rule, no sticky-delta rule, no roll along the term structure as DTE decays. The IV slider is not a
model — it is a manual sensitivity knob, handed to the user along with the modelling problem
([optionstrat-live-capture.md §4](optionstrat-live-capture.md)).

The **menu contents of the `AVERAGE` dropdown remain UNVERIFIED.** The site is a client-rendered
SPA; no fetched page, tutorial, or help article documents that control. The research JSON's
`vol-3-average-dropdown-unverified` finding stands on the menu; its speculation about the model is
superseded by the FAQ quote above.

Note what it costs to fix on their side: *"Adjust IV per expiration"* is a **paid** feature at
$39.99/mo ([optionstrat-live-capture.md §5](optionstrat-live-capture.md)). The one control a
calendar trader most needs is behind their paywall. Ours is free and always visible.

### 3.2 The calendar-specific problem

A vertical's two legs sit at the same maturity. Under any vol rule, moving spot re-prices both legs
through the same skew function at the same tenor, so much of the model-choice error cancels inside
the spread.

A calendar's two legs sit at **different points on the term structure**. Its net vega P&L depends
on the **spread between the two legs' IV changes**, not on either IV alone. A wrong rule can flip
the sign of that spread, not merely rescale it. **INFERRED** — no source states it in these words,
but it follows mechanically from Derman's equations below.

Everyone in the market knows this and nobody solves it. IBKR's own in-app warning text, quoted by a
user on IBKR's own lesson page:

> *"For multi-expiry combinations, Performance Profile values may vary within a potentially wide
> range that is not reflected by the clean lines in a graph. In extreme cases, driven by the
> volatility of its later expiring legs, this may result in flipping of the sign (from + to −)
> changing what appears to be a potential profit to an actual loss."*
> — [IBKR Campus](https://www.interactivebrokers.com/campus/trading-lessons/performance-profile-for-options-2/)

tastytrade's education calls the max profit unknowable. Option Alpha calls the diagonal payoff
*"variable... depending on when the options trader chooses to exit"*
([Option Alpha](https://optionalpha.com/strategies/put-diagonal-spread)). Unusual Whales ships one
global IV slider across a whole multi-leg structure
([Unusual Whales](https://unusualwhales.com/lp/options-profit-calculator)). Even the most complete
open-source options library found ships 25+ named strategies and **no calendar or diagonal at all**
([OptionStratLib README](https://raw.githubusercontent.com/joaquinbejar/OptionStratLib/main/README.md)).

The gap is not missing math. It is that pricing a calendar forward requires taking a position on
forward vol, which is a forecast, not a formula lookup. We already store the history a forecast
needs. That is the differentiator.

### 3.3 The control: two axes, never one dropdown

A single selector collapses two independent questions and reproduces the `AVERAGE` failure.
Ship two named selectors, both always visible in the provenance caption.

**Axis 1 — spot. How does a leg's IV move when spot moves?**

Derman's three rules, named and formulated as he states them in
[Patterns of Volatility Change (lecture 9)](https://emanuelderman.com/wp-content/uploads/2013/09/smile-lecture9.pdf):

| Rule | Formula | What it does to the numbers |
|---|---|---|
| Sticky strike | `Σ(S,K,t) = Σ₀ − b(K − S₀)` | Each strike keeps today's IV forever. ATM vol falls as the market rises. Derman calls a market maker doing this *"irrational exuberance"*. |
| Sticky moneyness / delta | `Σ(S,K,t) = Σ₀ − b(K/S − 1)S₀ ≈ Σ₀ − b(K − S)` | IV depends only on `K/S`. ATM vol roughly constant as spot moves. Derman: *"model of common sense and moderation."* |
| Sticky implied tree | `Σ(S,K,t) ≈ Σ₀ − b(K + S − 2S₀)` | ATM vol falls **twice** as fast as the skew's strike slope when spot rises, and rises twice as fast when spot falls. |

Derman's own empirical note, from the same document: *"during calm upward-trending periods, the
market satisfied the sticky strike rule, and during fearful periods it comes closer to satisfying
the sticky implied tree rule."*

**Axis 2 — time. How does a fixed expiration's IV move as its own DTE shrinks, holding spot fixed?**

There is **no canonical name** for this convention. The literature covers the spot axis and not
this one. Both options below are used in practice and neither is "the" standard — state that
plainly rather than picking silently.

| Rule | What it does |
|---|---|
| Frozen IV | Each leg keeps today's own IV as τ decays. What a naive constant-IV BSM reprice does by default. A pure assumption with no data behind it. |
| Curve roll | The leg's IV converges toward wherever **today's** term structure sits at its shrinking DTE. A 97-DTE leg that becomes 67-DTE in 30 days is priced at today's 67-DTE level. |

Direction of the error, for a calendar that is long back-leg vega: in contango, frozen-IV
**overstates** the back leg's value and so overstates P&L; in backwardation it understates it. The
magnitude scales with back-leg vega times the vol-point gap between the two conventions.
**INFERRED** — no measured backtest of this error for SPX 52d/97d calendars was found, and no
number is invented here. §7 puts measuring it in the build order.

**Axis 3 — level. Per-leg IV base, free.**

Each leg's IV is an editable number seeded from `leg_observations.bsm_iv`. Per-leg, not global.
This is the control OptionStrat charges for. A global `×1` / `×2` / `×3` multiplier sits alongside
it for whole-surface stress, applied on top of the per-leg bases.

### 3.4 Defaults

| Setting | Default | Why |
|---|---|---|
| Spot rule | **Sticky moneyness** | Derman's "common sense and moderation" case, and the regime he observes in calm markets. Sticky implied tree is the stress regime — offer it, do not default to it. |
| Time rule | **Frozen IV** at launch → **curve roll** once the ATM term-structure builder lands | Curve roll is the better model and is **derivable** from stored data; frozen IV is a pure assumption. But derivable is not the same as read — see §3.4.1. Do not default to a computation that does not exist yet. Both rules ship from day one; the default flips in Phase 6. |
| Per-leg IV | seeded from `bsm_iv`, editable | Our own inverted IV, not the vendor's. |
| Multiplier | ×1 | |

Changing any of these re-prices the whole grid in the browser with no round trip (§2.7), and
rewrites the provenance caption. **Breakevens are recomputed on every change** — a calendar's
breakevens have no closed form and are the roots of a P&L function that itself depends on the vol
rule. They cannot be cached independently of the assumption that produced them.

#### 3.4.1 Curve roll is a computation, not a lookup

Be precise about what "derivable" costs, because the schema does not hand this over.

Curve roll needs **today's ATM IV at an arbitrary tenor** — the 67-DTE point, which frequently has
no listed expiry at all. Three schema facts stand between us and that number:

- `term_structure_observations` (`schema.ts:365`) is **per calendar**. It stores front and back IV
  for that one calendar's own two expiries. It is not a curve.
- `skew_observations` (`schema.ts:301`) is described in-schema as the *"Interpolation source for the
  ±25Δ points."* Its strike breadth per expiration is **UNVERIFIED** — not checked against the live
  table. If it stores only the wing points, it cannot supply ATM.
- BSM pricing rotates its expiry set, so a naive `max(time)` read lands on a half-written batch
  (§6.3).

So curve roll requires building an **ATM term structure across expirations** from
`leg_observations.bsm_iv` (`schema.ts:117`), plus a stated interpolation policy for tenors that
fall between listed expiries, plus the fully-priced-cycle anchor from §6.3.

**Until that exists, ship both rules and default to curve roll only once the term-structure builder
lands.** Phase 6 item 1 in §7 is where it lands, alongside the measurement that validates the
choice. Before then the analyzer ships frozen IV as the working default and says so in the
provenance caption — an honest assumption beats a computation we have not built.

The first step is one query against the live table:

```sql
SELECT expiration, count(DISTINCT strike)
FROM skew_observations
WHERE snapshot_time = (SELECT max(snapshot_time) FROM skew_observations)
GROUP BY expiration ORDER BY expiration;
```

If the ladder is wide, `skew_observations` is the source and the builder is thin. If it is two
points per expiry, the builder reads `leg_observations` directly.

### 3.5 The forward-vol anchor

Where a market-consistent number is wanted rather than a rule, compute forward vol between the two
tenors from variance additivity:

```
σ_fwd = sqrt( (T₂·σ₂² − T₁·σ₁²) / (T₂ − T₁) )
```

Elementary and not in dispute. It anchors curve-roll and validates that any T+N assumption stays
internally consistent in time. `calendar_snapshots.term_slope` already stores `back_iv − front_iv`
per snapshot (`schema.ts:78`), so the raw material for the trailing distribution of this number is
already on disk.

### 3.6 Why a full reprice, not greeks × move

Every matrix cell is a full BSM reprice. Never a Taylor expansion off today's greeks.

Measured, using the screenshot's own parameters (SPX put, K=7425, S=7675.02, T=52/365, σ=16.7%),
isolating the spot-only truncation error:

| Move | True reprice Δ | Taylor error | Error as % of true |
|---|---|---|---|
| 1% | $22.75 | −$0.07 | 0.3% |
| 2% | $49.90 | −$0.53 | 1.1% |
| 5% | $160.50 | −$6.94 | **4.3%** |
| 10% | $439.34 | −$31.81 | **7.2%** |

The research supplies the explicit Taylor-predicted figure at one row only: at a 5% down move,
$153.56 predicted against $160.50 true. The other rows give true-Δ and error, so the table reports
those two columns rather than reconstructing a third.

The matrix's own default range is ±5.1%, so the corner cells sit exactly where this error bites.
And this **understates** the calendar case: a real matrix cell changes spot, calendar time, **and**
implied vol at once. Cross terms — vanna especially — are invisible to a static greek snapshot
taken at t=0 and are not in this single-variable number at all.

---

## 4. The position-monitoring view

The thing OptionStrat does not have. Every panel below is built from data already on disk.

### 4.1 The hero

`P&L SINCE ENTRY`, set as a stat tile at ≥48px, coloured by direction, with a sparkline of the
trailing snapshot series behind it. Source: `calendar_snapshots.pnl_open` over the calendar's own
history (`schema.ts:78`).

One caveat carried forward as a design constraint, not resolved by fiat. Frydman & Rangel (2014),
cited inside [Guenther & Lordan 2023](https://eprints.lse.ac.uk/118353/1/fpsyg_14_1091922_1_.pdf):
*"the disposition effect in the low-salience group is 25% lower, suggesting that the disposition
effect can be mitigated by reducing the salience of the stock purchase price."* Making cost basis
and open P&L the visually dominant number may entrench the bias the journal exists to expose. That
research is on single stocks, where "purchase price" is one well-defined number; for a rolled
calendar it is not. Flagged, not silently inherited. See §9 Q6.

### 4.2 Entry versus current

A compact per-leg table. Not a chart — this is precise per-leg data, which belongs in a table.
Each row keyed by a short line stroke in the leg's **frozen** entry colour.

| Column | Source |
|---|---|
| mark at entry | first `calendar_snapshots` row for the calendar, `front_mark` / `back_mark` |
| mark now | latest snapshot |
| leg P&L | difference × qty × 100 |
| IV at entry vs now | `front_iv` / `back_iv` at both snapshots (our BSM-inverted IV, not the vendor's) |
| term slope entry vs now | `term_slope` at both snapshots |

### 4.3 P&L decomposed by greek

The standard vol-desk method is **Greeks decomposition**, also called P&L attribution or P&L
explain. Formulas, per the worked example in
[Moontower](https://blog.moontower.ai/dynamic-hedging-option-p-l-decomposition/) and the lineage
(Carr 2005, Bergomi 2016, Ravagli 2015/2022) cited in
[this risk.net paper](https://www.risk.net/media/download/1091141/download):

```
delta P&L = δ × ΔS
gamma P&L = ½ γ (ΔS)²
theta P&L = θ × Δdays
vega  P&L = ν × Δσ
residual  = actual P&L − (delta + gamma + theta + vega)
```

Rendered as a horizontal diverging bar / waterfall, diverging colour on polarity of contribution,
not categorical colour.

**Three rules, all non-negotiable.**

1. **Attribute per snapshot interval, then sum.** The standard one-day decomposition *"loses the
   memory of the implied vol at which the option was originally traded"* over a multi-week hold
   (risk.net, above) — which is exactly our hold length. Our 30-minute cadence is the right grain.
2. **The residual is its own line, always shown, never netted into theta or vega.** A breakdown
   that appears to reconcile exactly to realised P&L with no visible residual manufactures false
   precision about where the money came from.
3. **Expect the residual to be large.** The clean, small residual in the Moontower example is a
   property of a position delta-re-hedged with shares daily. A static delta-neutral calendar does
   not sterilise delta that way, and its front/back vega and vanna move in opposite directions as
   spot and term structure shift. **INFERRED.** A big residual here is not a broken formula.

### 4.4 The path the position actually took

Reuse the T+N matrix unchanged. Overlay the position's real price × date walk since entry as a thin
trail of ringed dots in a neutral ink colour, one dot per snapshot. Source: `(time, spot)` from
`calendar_snapshots`.

This answers "where has this actually been" with one added layer and no new chart type. It is
directly reachable from stored data and no competitor scanned can draw it.

### 4.5 Drift from thesis

The trader runs delta-neutral calendars. Thesis therefore means: stay inside a net-delta band and
inside a term-slope band. Two small meters:

| Meter | Source | Fires when |
|---|---|---|
| net delta vs neutral | `calendar_snapshots.net_delta` | outside the declared band |
| term slope vs entry slope | `calendar_snapshots.term_slope` vs the entry snapshot's | outside the declared band |

Bands come from the immutable pre-trade record (§5.5). A meter outside its band flips to a reserved
status colour **with an icon and a label**. This is the correctly-labelled version of the `⚠` that
OptionStrat ships with no legend.

### 4.6 Time remaining against plan

The expiration ribbon gains a second thin band showing the planned exit DTE window, shaded. Time
remaining against the plan becomes a visual gap, not mental subtraction.

### 4.7 Glance density versus inspection density

OptionStrat's density is right for focused inspection and wrong for glancing at a second monitor
during RTH. Split it.

- **List view** — one compact card per open position: P&L hero, one-line drift status
  (colour + icon + label), DTE remaining, sparkline. Nothing else. Legible from two feet.
- **Expanded view** — everything in §4.1–4.6, for one position at a time.

The matrix, the attribution waterfall, and the per-leg table never appear on the glance card.

---

## 5. The journal specification

### 5.1 Unit of record — already correct, keep it

The repo made this decision correctly and it is codified in
`packages/core/src/journal/domain/calendar-event.ts`:

| Grain | Type | Role |
|---|---|---|
| Fill | `RawFill` | the atom. One broker fill: `occSymbol`, `side`, `qty`, `price`, `positionEffect`. Immutable. |
| Event | `CalendarEvent` | derived. `OPEN` / `CLOSE` / `ROLL`, keyed by `fillIdsHash` (SHA-256 of the sorted fill UUIDs). Same fills always rebuild to the same event. |
| Position | `calendars.id` | the aggregate. `calendarId` groups events. |
| Campaign | **new, a read model** | chain of rolled calendarIds. A view, never a mutable table. |

An outside voice arrived at the same structure independently. From
[r/options](https://old.reddit.com/r/options/comments/1t5himk/best_options_trading_journal_apptool_youve/):
*"the framing problem with most options journals is the unit. tradezella, optionspro, edgewonk are
all built around per trade rows. for theta work that breaks at the first roll... position level row
at the top... separate row per roll under each position."* The handle reads as a possible product
operator, so treat it as opinion — but it is corroborated by two vendors' users reporting broken
credit-spread P&L, and by Wingman Tracker existing at $49/mo to solve exactly this.

Commercial confirmation of the failure mode, first-person, on the record: *"I have now started
trading credit spreads and right out of the box, TradeZella doesn't handle spreads well. My numbers
are super whacky because it's not tracking the credit properly... I spun up a trial on TraderSync
and I'm having the same issue there."* And: *"Definitely don't use Tradezella for spreads. I had
[to] adjust the entries manually for the correct PL every time."*
([r/options](https://old.reddit.com/r/options/comments/1mryjun/trade_logjournal_that_handles_credit_spreads/))

Tradervue's own generic-import spec is worse: it groups executions by **symbol**, not strategy, and
expiration is not imported at all — *"if you had a short option contract that expired worthless,
add a row to buy it back on the expiration date for $0.00"*
([Tradervue](https://www.tradervue.com/help/generic)). That is manual reconciliation debt pushed
onto the user. We do not copy it.

### 5.2 The two mechanisms behind the −$319,850 bug

Both are recorded in the code as comments explaining what not to do again. Both generalise.

1. **A compound event that nets its two legs into one number loses information.** A `ROLL` stores a
   combined `netAmount`; recompute needs the two components separately. Fixed by explicit
   `rollOpenDebit` / `rollCloseCredit` fields that recompute reads directly, never re-parsed from
   `legBreakdown` JSON (`calendar-event.ts`, WR-A1).
   **General rule: a compound event keeps its split.**
2. **Classification derived from a mutable current-state column is wrong for historical rows.** Fill
   OPENING/CLOSING was derived from the calendar's current `status`. A calendar's status reflects
   its latest state, not what a historical fill's role was at trade time — so real CLOSE fills got
   folded into OPEN events whenever status had not kept pace. Fixed by persisting the broker's own
   `positionEffect` on the fill (`schema.ts:170`).
   **General rule: classify a fill from data captured on the fill at trade time.**

A third lesson, from `recomputeSnapshotPnl.ts`: **fixing a source-of-truth field does not fix
already-derived numbers.** `pnl_open` is frozen at snapshot-write time; when `openNetDebit` was
corrected, every historical snapshot still carried the stale figure until a recompute pass ran.
Assume this will be needed again and keep recompute a pure function of stored fills.

### 5.3 Roll handling

Store at both grains. Report different metrics from each.

| Grain | Metric |
|---|---|
| Campaign (chain of rolls, first entry to final exit) | expectancy, win/loss verdict, total P&L |
| Event (one roll) | execution cost, roll debit/credit, whether the roll helped or delayed the loss |

Close-and-open bookkeeping inflates trade count, deflates mean hold time, and manufactures a booked
loser at every defensive roll. Pure campaign accounting hides the cost of the rolling decision
itself. Storing both costs nothing because the events are already immutable and `calendarId` is
already the grouping key. **No controlled study comparing trader outcomes under the two conventions
was found** — this is a reasoned recommendation, not a sourced finding.

### 5.4 Settlement is an event with no fill

SPX and SPXW are cash-settled. Cash settlement produces **no closing fill and no order** — it is a
computed cash credit at expiration. A ledger that closes a position only on a matching offsetting
fill leaves an expired leg open at its last stored mark forever, silently misstating the closed
campaign's realised P&L. This is the same shape as the −$319,850 bug: an event the ledger
structurally cannot receive.

**Fire a synthetic `SETTLEMENT` event from the calendar's own expiration date.** Do not wait for a
fill.

Settlement style branches **per leg**, not per calendar, because the trader's front leg is typically
an SPXW weekly and the back leg can be a standard third-Friday SPX monthly.

| Root | Settlement | Value | Source |
|---|---|---|---|
| `SPX` | AM | Special Opening Quotation (SOQ, ticker `SET`), from the **opening** trade price of each constituent. Published mid-morning, not at a fixed time. Trading ceases the Thursday before. | [CBOE, AM settlement PDF](https://cdn.cboe.com/resources/spx/Settlement_of_Standard_AM_Settled_SP_500_Index_Options.pdf) |
| `SPXW` | PM | 4:00pm ET closing index level — **but 1:00pm ET on any half-day holiday** | [CBOE, SPX Options Specifications](https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/): *"Trading in SPXW options will ordinarily cease on the day of expiration, 4:00 pm ET, and at 1:00 pm ET for any half day holiday."* |

The half-day clause is not cosmetic. A years-to-settlement calculation that hardcodes a 4:00pm ET
close overstates T by three hours on every half-day expiration. The error is largest on the front
leg of a calendar, which is where T is smallest and the price is most sensitive to it. The
settlement clock must be a per-expiration lookup against the exchange calendar, not a constant.

CBOE states it plainly for the AM case: *"the current values of the intraday S&P 500 Index and SOQ
will typically be different."* Marking an expiring AM-settled leg from Thursday's close or any
Friday intraday print produces phantom P&L.

`contracts.root` (`schema.ts:155`) already carries the discriminator at the right grain. Nothing
consumes it for settlement timing today. `contracts.exerciseStyle` is hardcoded `"european"` for
every row (`packages/core/src/journal/application/fetchChain.ts:157`), so it is not the
discriminator — `root` is.

### 5.5 The immutable pre-trade record

One new append-only table, following the `exit_verdicts` / `picker_snapshot` convention that
already exists in this codebase (`schema.ts:566`, `schema.ts:535`): INSERT only, never
`onConflictDoUpdate`.

Written once, at OPEN, keyed to the opening event's `fillIdsHash`. Never editable.

| Field | Type | Why |
|---|---|---|
| `thesis` | text | Human context. Cannot be reconstructed from any market data, ever. |
| `invalidation` | text, if-then form | *"if SPX closes below X, close the calendar."* |
| `plannedExitDte` | int range | Feeds the ribbon's plan band (§4.6). |
| `deltaBand`, `slopeBand` | numeric range | Feeds the drift meters (§4.5). |
| `declaredStop` | numeric | The denominator of R (§5.6). Behavioural, not structural. |
| `conviction` | 1–3 | Set at entry or not at all. |

Why write-once. A stop that can be edited any time is not a metric, it is a diary entry that can be
rewritten. From a practitioner tooling source: *"Tags set at entry are signal; tags set at review
are post-hoc rationalisation"*
([retired.today](https://retired.today/blog/trade-tagging)).

Why grade against outcomes, not against reasoning quality. The strongest available evidence is
Tetlock's forecasting tournament — 1,000+ randomly assigned forecasters, 137 questions, 10 months:
*"Holding forecasters accountable to outcomes ('getting it right') boosted forecasting accuracy
beyond holding them accountable for process ('thinking the right way'). The performance gap grew
over time."*
([Chang, Atanasov, Patil, Mellers & Tetlock 2017, JDM 12(6)](http://journal.sjdm.org/17/17630/jdm17630.html))
A journal that grades how convincing the narrative reads reproduces the weaker condition.

Why if-then form. Gollwitzer & Sheeran's meta-analysis of 94 studies and >8,000 participants finds
`d = 0.65` for implementation intentions on goal attainment over holding the intention alone
([summary](https://goalsandprogress.com/implementation-intentions-gollwitzer-how-to/),
[reference](https://en.wikipedia.org/wiki/Implementation_intention)). The mechanism: the plan
delegates the decision to a pre-specified trigger, so the trader is not reasoning it through in the
moment a live loss has compromised them.

`calendar_event_annotations` (`schema.ts:549`) already exists but is the wrong shape — it carries
`updatedAt` and is upsert-keyed, i.e. mutable, and it is a post-hoc rule-tagging table. Keep it for
what it does. The pre-trade record is separate and immutable.

### 5.6 Metrics that ship

Ranked by reliability first — computable unattended from fills and snapshots, immune to selective
logging because there is nothing to log — then by decision relevance.

Eight of the nine rows are buildable from data on disk today. Row 3 is not, and says so in place.

| # | Metric | Grain | Note |
|---|---|---|---|
| 0 | **Reconciliation invariant** | window | Not a metric. Sum of per-trade realised P&L over any window must equal broker cash delta over the same window, asserted against `broker_transactions` (`schema.ts:625`) as an automated test each ingest cycle. Every ratio below is a function of the P&L series; no formula catches a corrupt series. |
| 1 | **Mark-to-market drawdown** | account | From snapshot marks, including open positions. Closed-P&L drawdown is blind to the adverse excursion that a margin call does not wait out. For $3.5–4.75k at risk in a $17k account, the excursion is where the risk lives. |
| 2 | **MAE / MFE by full reprice** | position | Computed from the repriced spread value at each snapshot, never inferred from spot movement — a calendar's P&L swings on the front/back IV relationship while spot sits still. Used to calibrate stops empirically and to separate "right but exited early" (large MFE) from "never working" (MFE ≈ 0). |
| 3 | **Cost as % of gross** — **BLOCKED, Phase 6.2** | combo | Fill vs mid at **order-submit**. The input does not exist today (§6.2 gap 2). Ranked here because it is the highest-value metric in the list once unblocked. **Do not implement from this table** — it ships with the order-submit quote capture, not before. |
| 4 | **Theta captured vs theta expected** | position | Actual value change minus the delta and vega components. Reporting raw value change as "theta captured" measures vega and mislabels it: a calendar that "captured 140% of expected theta" in a week when back-month IV rose reported a vega win. |
| 5 | **Portfolio net vega / gamma vs equity** | account | Replaces per-trade Kelly. A handful of concurrent SPX calendars are not independent bets — in a real vol event they are one bet, and summing per-trade Kelly fractions overstates the safe aggregate. |
| 6 | **Expectancy in R** | campaign | R = the **declared-at-entry stop** (§5.5), not structural max loss. A calendar's max loss is the debit only if held to front expiry with the back leg flat, which never happens in this playbook. Debit-as-R makes every R artificially small and non-comparable. |
| 7 | **Hold time vs stated DTE plan** | campaign | Did the trade get held past its own thesis window. |
| 8 | **Plan-followed, yes/no** | campaign | Checkable against the immutable record. The single most-repeated review question among independent forum practitioners, unprompted: *"Did you follow your trading plan? If not why not?"* ([elitetrader](https://elitetrader.com/et/threads/trading-journal.374447/)). Separates a bad calendar from a good calendar executed badly — completely different fixes. |

Slippage (#3) is the one to fight for. Barber & Odean's 66,465-household study found frequent and
infrequent traders earned statistically indistinguishable **gross** returns, and 11.4% vs 18.5%
annualised **net**; they measure *"the average round-trip trade in excess of $1,000 costs three
percent in commissions and one percent in bid-ask spread"*
([Barber & Odean 2000](https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/individual_investor_performance_final.pdf)).
Those 1991–1996 percentages do not transfer. The mechanism transfers, and it is sharper for
multi-leg options: a calendar crosses four legs' worth of spread on a round trip.

### 5.7 Metrics deliberately omitted, and why

| Omitted as a headline | Reason |
|---|---|
| **Win rate alone** | Silent on loss size, and gameable in the exact direction this strategy already leans. A theta seller raises win rate by holding losers and rolling indefinitely — each of which lowers expectancy. Show it only paired with average win vs average loss. |
| **Profit factor** | Denominator can be one or two losses at this trade frequency, so it swings month to month. If computed on closed trades only while open losers are excluded, it structurally overstates edge. |
| **Sharpe with textbook annualisation** | Provably wrong on a serially correlated series. Lo: *"the annual Sharpe ratio for a hedge fund can be overstated by as much as 65 percent because of the presence of serial correlation in monthly returns"* ([Lo 2002, Financial Analysts Journal 58(4)](https://traders.studentorg.berkeley.edu/papers/The-Statistics-of-Sharpe-Ratios.pdf)). A book of overlapping calendars marked every 30 minutes is mechanically autocorrelated — today's mark reprices yesterday's positions. |
| **Sortino / Calmar** | Both computed from a sample that has not yet seen the tail the strategy is short. Sortino's downside-deviation sample is thin by construction for a high-win-rate short-vol book; Calmar's max-drawdown denominator has not been through a real vol event. Both are overstated in the same direction, for the same reason. |
| **Percentage of max profit taken** | Has no honest denominator for a calendar. Max profit depends jointly on where spot sits at front expiry and on back-month IV at that moment. The percentage would be a function of the model choice as much as the outcome. Correct for defined-credit trades; do not force-fit it. |
| **Per-trade Kelly sizing** | Two failures at once: Kelly's growth function punishes edge-overestimation asymmetrically under parameter uncertainty, and concurrent SPX calendars are correlated near 1 in a vol event, so summing per-trade fractions overstates safe size. Metric #5 replaces it. |
| **Per-leg slippage** | A combo fills as one print at one net price. Per-leg allocation is a bookkeeping convention chosen after the fact, not a separately observed market event. Displaying it invents precision. |
| **Chance of profit as a headline** | It is a risk-neutral probability, not a forecast of the win rate. Ship it, label it as risk-neutral, never headline it. See §8. |
| **Any tastytrade 21-DTE statistic** | The circulating figures — *"200,000+ trades", "15–20% improved risk-adjusted returns", "60–80% of max profit by 21 DTE"* — could not be traced to any primary tastylive/tastytrade page. **UNVERIFIED.** The mechanical argument for closing before the final weeks stands on its own; the numbers do not go in the product. |

None of these are deleted from the data. They can exist as secondary diagnostics with their caveats
attached. None of them gates a go/no-go decision.

### 5.8 What a review needs in front of it

Not a scroll through a trade list. That failure is on the record from a practitioner who abandoned a
structured journal for exactly this: *"Problem was creating usable reports. It took way more time
than entering data... Basically, the journal was a silo... no way out in a reasonable time for the
data"*
([elitetrader](https://www.elitetrader.com/et/threads/journaling-what-tags-make-sense.376064/)).
Design the review output alongside the capture schema, not after it.

A review needs two things: **a comparison against the trader's own trailing baseline**, and **a hard
cap on output**. Three observations, not ten.

**Cadence: monthly, not weekly.** The strategy runs 8–45 DTE front legs at low entry frequency. A
weekly window would hold too few closed campaigns to say anything. Vendor guidance suggests widening
to bi-weekly or monthly below 15–20 trades per window, but that specific threshold came through a
search summary and was not fetched — **UNVERIFIED**. The underlying logic (small-n weekly samples
are noise) stands on its own.

### 5.9 The automatic / manual split

Everything the broker and the market feed know is automatic. Three things are irreducibly human.

| Automatic | Manual, once, at entry |
|---|---|
| fills, prices, commissions, fees | thesis |
| every greek, IV, term slope | invalidation condition (if-then) |
| spot, marks, P&L, drawdown, MAE/MFE | planned exit window and bands |
| settlement events | declared stop |
| roll chains, campaign grouping | conviction 1–3 |

**Do not add an emotion tag.** Two vendor sources disagree openly. One argues *"you can't honestly
tag yourself as 'greedy' while placing the trade because greed doesn't feel like greed in real time,
it feels like opportunity"* ([retired.today](https://retired.today/blog/trade-tagging)); another
builds emotional state into its five core categories with worked win-rate splits
([traderssecondbrain](https://traderssecondbrain.com/guides/how-to-tag-trades)). Neither cites a
study; both sell journal tools. We side with the first, because it is consistent with the
pre-commitment evidence in §5.5: a label applied after the P&L is known is decoration.

**Ship a closed vocabulary, not a free-text tag field.** Tag sprawl is a named, converged failure
mode — a list that *"balloons over six months from two or three tags to fourteen, becoming a junk
drawer where no two trades share the same tags"* (retired.today). The elitetrader thread above shows
it happening live: asked what tags they use, people free-associate one-offs.

**No letter grades.** A self-assigned A–F score has no external check. The binary plan-followed
field does, because the plan is immutable and was written first.

### 5.10 What the evidence does not support

**No controlled or empirical study testing whether keeping a trading journal changes trading
outcomes was found.** Searched across multiple phrasings. Every "journaling works" claim in the
trading-education and journal-software industry is untested. So this specification cannot lean on
"studies show journaling helps" anywhere, and it does not. Each field is justified from what is
known about trading behaviour and feedback validity instead.

One specific circulating statistic is a fabrication: a search summary attributed *"73% of day
traders who start a trading journal quit within three weeks"* to a TradeZella page. The page was
fetched directly and the figure appears nowhere in it. It does not go in the product.

And one framing constraint from Kahneman & Klein. Skilled intuition needs an environment with valid
cues plus rapid unequivocal feedback. Stock and market-direction prediction has neither:
*"To a good approximation, predictions of the future value of individual stocks and long-term
forecasts of political events are made in a zero-validity environment"*
([Kahneman & Klein 2009, American Psychologist 64(6)](https://www.hansfagt.dk/Kahneman_and_Klein%282009%29.pdf)).
So the journal grades sub-tasks that **do** have valid cues — fill quality, whether front-leg DTE
landed in the stated band, size against the stated cap, whether an exit followed the stated rule —
and does not build analytics on directional conviction, which no amount of feedback can calibrate.

The same paper supplies the sharpest argument for §5.6's metric #0. A wicked environment teaches
false lessons confidently: the physician who *"confirmed his intuitions by palpating these patients'
tongues, but because he did not wash his hands the intuitions were disastrously self-fulfilling."*
A journal with a systematic accounting error does not merely fail to help. It teaches. Ledger
correctness is the precondition for every other claim here, not a QA nice-to-have.

---

## 6. Data requirements

Every displayed number, with its source.

### 6.1 Sourced today, no new ingest

| Number | Source |
|---|---|
| Spot, change% | existing SSE market-data feed |
| Chain: bid, ask, mark, OI, volume | `leg_observations` (`schema.ts:117`), Schwab + CBOE union |
| Per-leg IV | `leg_observations.bsm_iv` — our own BSM inversion, not the vendor's. **Partial and rotating — see 6.3.** |
| Per-leg greeks | `leg_observations.bsm_delta/gamma/theta/vega`. **Partial and rotating — see 6.3.** |
| Expiration ribbon dates | `contracts.expiration` (`schema.ts:155`) |
| AM/PM marker per expiry | `contracts.root` — `SPX` = AM, `SPXW` = PM |
| Strike ladder and increment | `contracts.strike` (×1000 int convention) |
| Every matrix cell, curve point, breakeven, net debit | computed in-browser through `@morai/quant` from the block in §2.7 |
| Term structure across tenors (curve-roll input) | `leg_observations.bsm_iv` across expirations; `skew_observations` (`schema.ts:301`) as the derived per-(expiry, strike, type) table |
| Term slope per calendar | `calendar_snapshots.term_slope`, `term_structure_observations` (`schema.ts:365`) |
| P&L since entry, path, MAE/MFE, MTM drawdown | `calendar_snapshots` (`schema.ts:78`) |
| Net greeks over time | `calendar_snapshots.net_delta/gamma/theta/vega`. **Can be NaN for days at a time — see 6.3.** |
| Fills, commissions, fees | `fills` (`schema.ts:170`) |
| Roll chains, campaign grouping | `calendar_events` (`schema.ts:247`) |
| Broker cash delta (reconciliation invariant) | `broker_transactions` (`schema.ts:625`) |
| Risk-free rate (flat) | `rate_observations` — FRED DGS3MO daily (`schema.ts:210`) |

### 6.2 Not sourceable today

Four gaps. Each with what it would take.

| # | Number | Why not | What it takes |
|---|---|---|---|
| 1 | **Diagonal spreads at all** | `calendars.strike` is a single `integer`, D-02 "same-strike both legs"; `optionType` is shared per D-01 (`schema.ts:56`). The schema models calendars only. The trader runs calendars **and diagonals**. | A migration to per-leg strike. This is a **required** schema change, not an enhancement. |
| 2 | **Effective spread / slippage** | `orders` has `limit_price` and `placed_at` (`schema.ts:194`) but no NBBO at submit. `fills` has no reference mid. Benchmarking against mid-at-**fill** conflates execution cost with drift while the order rested. | Capture the combo NBBO at order-placement time and persist it against the order. New ingest on the order-placement path. |
| 3 | **Per-tenor discount rate** | `ForReadingRate(onOrBefore: string)` is keyed by **date only**, not tenor (`packages/core/src/journal/application/ports.ts:413`), and returns one scalar. CBOE's own methodology interpolates the CMT curve to each option's exact tenor and converts to continuous compounding ([CBOE VIX Mathematics Methodology](https://cdn.cboe.com/resources/indices/Cboe_Volatility_Index_Mathematics_Methodology.pdf)). `MACRO_SERIES_IDS` has `DGS1MO` and `DGS3MO` only (`packages/contracts/src/macro.ts:27`), so a 52d leg interpolates but a 97d leg extrapolates past the last point. | Two changes, not one: add `DGS6MO` and `DGS1` to the existing fetch-rates job, **and** make the carry port tenor-aware — `readRate(onOrBefore, tenorDays)`. The port signature change is the bigger half. |
| 4 | **Option-implied forward per expiry** | Today `q` is a supplied `dividendYield` constant (`computeBsmGreeks.ts:145`). SPX pays no dividend but its constituents do, so a constant `q` is an assumption. CBOE extracts the forward model-free from put-call parity: *"Determine the option-implied forward price level, F, by identifying the options strike price at which the absolute difference between the call and put prices is smallest"* (same methodology PDF). | A per-expiry forward extraction over the chain we already store. No new ingest — a new computation over `leg_observations`. |

### 6.3 Sourceable but fragile — say so on screen

**Greek coverage is partial, rotating, and sometimes absent entirely. This is the single largest
threat to the "position monitoring is the differentiator" argument in §1, and it is not a historical
incident — it was measured live on 2026-08-25 while this document was being written.**

`calendar_snapshots` stores **net** greeks only (`schema.ts:78`); per-leg lives in
`leg_observations.bsm_*`, reachable by joining on `(time, contract)`. Both are downstream of the
`compute-bsm-greeks` job, and that job cannot finish the book inside its window. It carries
`lastError: "handler execution exceeded 900s"`. What it produces instead is a partial batch whose
membership changes every cycle.

Measured directly through `get_priced_chain`, two consecutive cycles thirty minutes apart, puts
only:

| Cohort | 15:00:27 cycle | 15:30:28 cycle |
|---|---|---|
| SPXW 2026-08-25 (dte 0) | 57 / 198 | 198 / 198 |
| SPXW 2026-08-26 (dte 1) | 0 / 198 | 192 / 198 |
| SPXW 2026-08-27 (dte 2) | 0 / 197 | 60 / 197 |
| SPXW 2026-09-21 (dte 27) | 74 / 96 | **0 / 96** |
| SPXW 2026-09-22 (dte 28) | 73 / 78 | **0 / 78** |
| SPXW 2026-09-23 (dte 29) | 73 / 79 | **0 / 79** |
| SPXW 2026-09-24 (dte 30) | 72 / 75 | **0 / 75** |
| **Whole put book** | **1,497 / 5,771 (26%)** | **1,132 / 5,773 (19%)** |

Two things to read off that table. Coverage went **down**, and the priced set **rotated** — the
front got priced by abandoning dte 27-30, which had been priced thirty minutes earlier. An expiry
being priced now is not evidence it will be priced next cycle.

This is not a quote problem. Unpriced strikes carry live markets: strike 7565 on the dte-1 cohort
showed `bid 1.4 / ask 1.5, openInterest 649` with `iv: null` and every greek `null`. The chain
fetch is healthy; the pricing step is behind it.

Independently, a review of live production on the same day found
`calendar_snapshots.net_delta/gamma/theta/vega` **NaN for every open position across a continuous
~1.5-trading-day window** (2026-08-24 13:30 UTC onward). So the earlier claim that "net-level
attribution is reliable" is false. Net greeks fail too, and they fail for longer — a snapshot row
is written on schedule whether or not the greeks behind it resolved, so the gap is invisible in row
counts.

Note also that this is the same failure class as the July 2026 incident in which roughly 74% of
journal snapshot rows carried `spot=0` or NaN. That was not a one-off that got fixed. It is the
recurring behaviour of a pipeline whose pricing stage cannot keep up with its ingest stage, and any
history-dependent feature must be designed against gaps that span **days**, not isolated 30-minute
holes.

**What this forces the UI to do.** Three states, not two, everywhere a greek is displayed:

| State | Condition | Behaviour |
|---|---|---|
| Priced | the cycle's front expiry is fully priced | draw normally |
| Partial | some legs priced, front expiry incomplete | draw net-level only, label the cycle timestamp, refuse the per-leg breakdown |
| Unpriced | net greeks NaN, or no leg of this position priced | draw nothing. Show the last cycle that *was* priced, with its age in hours, and say why |

The rule underneath: **never interpolate across a gap, and never let a missing greek render as
zero.** A zero delta and an unknown delta look identical on a chart and mean opposite things — this
repo's `?? 0` scar is exactly this mistake. The §4.3 attribution panel and the §4.5 drift meters
both inherit these three states; neither has a defined appearance in the Unpriced state today, and
that state is empirically common enough to be a design case rather than an edge case.

**One honest consequence for §1.** The 30-minute RTH snapshot history is still the asset no
competitor has. But it is not currently the clean series §1 implies. Before any feature is built on
it, someone has to measure what fraction of historical snapshot rows actually carry resolved
greeks, per position, per period. If that fraction is low, the differentiator is a repair job
first and a feature second. That measurement is not in this document and should gate the build
order in §7.

**Chance of profit.** Computable from the chain we already hold. Four methods exist; ranked for our
case:

1. **Breeden-Litzenberger** from the actual smile: `q(K) = e^{rT} ∂²C/∂K²`, model-free, uses only
   observed prices ([derivation](https://sungchullee.github.io/financial_math_book_writing/ch12/model_free_results/breeden_litzenberger_formula/)).
   Noise-sensitive: *"if option prices have noise of magnitude ε, the second derivative estimate has
   noise of order ε/(ΔK)²"* — with ΔK=5 and ε=$0.05 that noise can rival the density itself. Smooth
   the call curve or fit a parametric smile before differentiating.
2. Lognormal closed form from ATM IV — documented fallback when the ladder is too sparse. Ignores
   skew, so it misprices tails for a negatively-skewed index.
3. Monte Carlo — converges to (1) for a vanilla European marginal. Only worth it for jumps or
   stochastic vol.
4. Delta-as-probability — *"only an estimate. It assumes random market movement and rational
   (unbiased) valuation"* ([Macroption](https://www.macroption.com/delta-calls-puts-probability-expiring-itm/)).
   A retail heuristic, not the basis for a feature.

Whatever we report is a **risk-neutral** probability, not a real-world forecast. The gap is the
variance risk premium, empirically positive for equity indices. The label says so.

---

## 7. Build order

Each phase is independently useful and shippable. Ordered by what de-risks the most, not by what is
easiest.

### Phase 0 — the ledger invariant

Ship the reconciliation test: per-trade realised P&L summed over a window equals broker cash delta
over that window, run against `broker_transactions` every ingest cycle.

**Why first.** Every metric in §5.6 is a function of the P&L series. A formula applied to a corrupt
series produces a confidently wrong ratio, and the trader learns from it. This is the precondition,
not the first feature. Nothing downstream should be trusted until it is green on real history.

Shippable on its own: a failing test on live data is immediately valuable.

### Phase 1 — per-leg strike migration

Add per-leg strike (and per-leg option type) to `calendars` and everything downstream.

**Why this early, before any UI.** Retrofitting per-leg strike onto a journal already rebuilt on a
single-strike assumption is precisely the shape of the bug we are trying not to repeat: a structural
assumption baked into a P&L path that later turns out to be false. Doing it while the ledger is
already under a reconciliation test (Phase 0) means the migration is proven, not hoped.

Per the repo rules, this is an architecture change:
`docs/architecture/stack-decisions.md` gets updated **before** the migration lands.

Shippable on its own: diagonals become representable and the existing journal keeps working.

### Phase 2 — settlement events

Fire the synthetic `SETTLEMENT` event from expiration date, branching on `contracts.root` for AM vs
PM. Backfill over history.

**Why before any view.** Expired legs currently sit open at their last mark forever. Every P&L
number the monitoring view and the journal would display for a closed campaign is wrong until this
lands. Verify the SPXW PM convention against CBOE's own specification page first — it is
**UNVERIFIED** in §5.4.

Shippable on its own: closed campaigns start reporting correct realised P&L.

### Phase 3 — the position-monitoring view

The primary surface. Entry vs current, P&L hero, path overlay on the matrix, net-level greek
attribution with the residual as its own line, drift meters, plan band.

**Why before the analyzer.** This is where the unique data lives and where being wrong costs money
already at risk. The pricing kernel it needs is largely already built —
`apps/web/src/lib/scenario-engine.ts` already exports `HeatmapCell`, `PayoffPoint`, `ScenarioStrip`,
`SpotDomain`, `PositionGreeks`, and `buildSpotGrid`. Phase 3 wires an existing engine to a new
surface. It does not build a pricer.

Shippable on its own: open positions become monitorable.

### Phase 4 — the immutable pre-trade record

Append-only table, write-once at OPEN. Thesis, invalidation, planned exit window, bands, declared
stop, conviction.

**Why here.** The drift meters and plan band from Phase 3 have no bands to compare against until
this exists — they ship in Phase 3 reading defaults, and become real here. It also unlocks
expectancy-in-R and plan-followed, the only two metrics that need typed intent.

Shippable on its own: entries start being pre-committed instead of narrated.

### Phase 5 — the analyzer

The prospective mode: ribbon, strike axis, matrix, curve, scrubber, metric strip, and the two-axis
vol control from §3, with the URL-as-trade encoding.

**Why last of the surfaces.** It is the mode with a working competitor. Its correctness bar is
lower — a wrong prospective number costs a trade not taken. And it reuses everything Phases 2–4
proved.

Ship the cross-boundary test with it: client `scenario-engine` output must equal server snapshot
P&L to the cent for the same calendar at the same instant.

### Phase 6 — the data gaps

In order of leverage:

1. **Build the ATM term structure, then measure the frozen-IV vs curve-roll error on our own SPX
   history.** Two steps, in order. First the builder from §3.4.1: run the `skew_observations`
   breadth query, pick the source table, build an ATM IV curve across expirations with a stated
   interpolation policy, anchored on a fully-priced cycle (§6.3). Then the regression —
   `calendar_snapshots.term_slope` history is already on disk. This is a computation and a query,
   not an ingest. It turns an INFERRED claim into a measured one, **and it is what flips the §3.4
   time-rule default from frozen IV to curve roll.**
2. **Order-submit quote capture**, then the effective-spread metric. Barber & Odean say this is the
   largest controllable term. It is also the one metric in §5.6 that cannot ship earlier.
3. **Tenor-aware carry**: `DGS6MO` + `DGS1` plus the `readRate` port signature change.
4. **Option-implied forward per expiry** from put-call parity, replacing the constant `q`.

Each is independently shippable and each improves numbers that already display.

### Phase 7 — the journal review surface

Monthly cadence, baseline comparison, three-observation cap. Metrics from §5.6 only.

**Why last.** It is a read over everything the earlier phases made correct. Building it first would
produce the silo failure — a queryable surface over a ledger that was still wrong.

---

## 8. Explicitly out of scope

Each exclusion carries its reason. This section matters as much as the inclusions.

| Excluded | Reason |
|---|---|
| **Mobile and responsive layout** | This is a dense trading-terminal panel: scrollable multi-month ribbon, draggable pills, paged metric strip, 20-column heatmap, three sliders. The repo already learned that responsive ≠ mobile design and built a dedicated `overview-mobile/` tree rather than squeezing (`morai-phase35-1-mobile-overview.md`). Building a mobile IA now is speculative against an explicitly unresolved decision — whether a web UI is rebuilt at all — and an unknown usage pattern. Desktop only. |
| **A strategy template library** | OptionStrat ships 72 named strategies as a picker *and* a teaching device ([optionstrat-live-capture.md §6](optionstrat-live-capture.md)). This is a single-user tool for one trader who runs calendars and diagonals on SPX. Everything else is a teaching aid for an audience that does not exist here. |
| **Chance of profit as a headline metric** | Compute it, label it risk-neutral, put it in the metric strip. Do not headline it and do not build analytics on it. It is a pricing-consistent number useful for comparing structures, not a calibrated forecast of win rate. The project has already been burned once by treating a model-derived number as ground truth (the VVIX regime-tag contamination, `morai-tv-expected-move.md`). |
| **A pricing model other than BSM** | OptionStrat migrated to Bjerksund-Stensland (2002) in April 2023 for the early-exercise premium on American options. SPX and SPXW are **European, cash-settled**. There is no early exercise. B-S is an American approximation of a thing we can compute exactly. Our BSM engine is the correct model for our instrument, not a compromise ([optionstrat-live-capture.md §4](optionstrat-live-capture.md)). |
| **A WASM or duplicate JS pricer** | A second implementation of the math is the `1baceaa` failure mode. The shared `@morai/quant` kernel already gives client-side speed without a second implementation (§2.7). |
| **Broker execution** | Not a brokerage. Orders are placed in the broker's platform. |
| **Options flow, Congress trades, insider trades, news alerts** | OptionStrat's second product line and its $99.99/mo tier. Not a calendar trader's decision input, and a separate data-vendor problem. |
| **A strategy optimizer / "search thousands of trades"** | The picker rule engine already exists (`rank_calendars`, `get_picker_candidates`). Rebuilding it inside the analyzer duplicates a working system. |
| **Emotion tags and letter grades** | Neither has an external check. Both are applied after the outcome is known, which makes them decoration. The binary plan-followed field is the checkable version (§5.9). |
| **Screenshots as a manual step** | The one verified practitioner report describes screenshots surviving only when annotation *is* the artifact — *"I keep chart screenshots (with notes embedded)... Can't be bothered writing a novel"* ([elitetrader](https://elitetrader.com/et/threads/tips-for-keeping-a-trading-journal.326221/)). No evidence was found either way on whether saved screenshots get revisited. If we capture anything, it is auto-generated at entry from data we already hold — never a manual capture-and-annotate step. |
| **A daily review rung** | Copied from day-trading templates. This strategy holds 8–45 DTE front legs at low entry frequency; a daily review would be empty. Monthly (§5.8). |
| **Multi-underlying support** | SPX and SPXW only. Every settlement branch, every vol default, and every skew assumption in this document is calibrated to that book. Widening it silently would break the calibration, not extend it. |

---

## 9. Open questions for the owner

Nine sections of decisions are made above. These are the ones the research genuinely does not
settle.

**Q1. Does a web UI get rebuilt at all?**
Options: (a) yes, both surfaces; (b) monitoring only, analyzer stays in TradingView + MCP;
(c) no web UI — everything through MCP and TradingView.
**Recommendation: (b) first, then (a).** The strategic decision on record is TradingView as cockpit
and Morai as math engine. Monitoring is the surface TradingView cannot serve — it needs our fill
ledger and snapshot history. The analyzer has a working free competitor. Phase 3 before Phase 5 in
§7 already encodes this; answering (c) collapses the build order to Phases 0–2, 4, 6.

**Q2. Which phase gets per-leg strike?**
Options: (a) Phase 1, as specified; (b) after the monitoring view ships.
**Recommendation: (a).** Retrofitting a structural assumption into a P&L path after it has shipped
is the bug shape we are avoiding. The only argument for (b) is that diagonals might be rare enough
to defer — which is a question about the book, not the schema.

**Q3. Front leg range — is 8–45 DTE still the band?**
The brief says 8–45. `d65e0d6` floored the GEX near-term DTE window at 8 days. The ribbon's plan
band and the drift meters need the real number.
**Recommendation: confirm the band, and confirm whether it is a hard rule or a preference.** If it
is a rule, it belongs in the immutable pre-trade record's defaults.

**Q4. What are the delta and term-slope bands that define "thesis intact"?**
The drift meters in §4.5 have no thresholds without this. Options: (a) fixed defaults for all
trades; (b) declared per trade at entry; (c) derived from the trailing distribution of your own
closed campaigns.
**Recommendation: (b) with (a) as the seeded default.** (c) is circular until enough campaigns
exist, and it is what Phase 6's measurement work would eventually inform.

**Q5. Should the analyzer share a URL scheme with OptionStrat's, or use OCC symbols directly?**
Options: (a) copy their grammar exactly (`-.SPXW261016P7425`); (b) use our canonical OCC form.
**Recommendation: (a).** It is verified, compact, human-readable, and it means a link works in
either tool while both exist. The cost is one translation function.

**Q6. How prominent should P&L-since-entry be?**
Frydman & Rangel found 25% less disposition effect at lower cost-basis salience (§4.1). That
research is on single stocks; a rolled calendar has no single purchase price. Options: (a) hero
figure as specified; (b) demote it below the drift status and DTE.
**Recommendation: (a), with the drift status directly adjacent at equal weight.** The evidence is
real but not tested on this structure, and a monitoring view that hides P&L fails its own job. Worth
revisiting after a few months of use.

**Q7. Is the campaign-level or the event-level verdict the one you want to see first?**
§5.3 stores both. The default headline has to be one of them. Options: (a) campaign — one verdict
per idea; (b) event — every roll graded.
**Recommendation: (a).** A defensive roll booking a loser at the moment before recovery is a
bookkeeping artifact, not a trading result. Event-level stays one click away.

---

## Method notes

- Repo facts were read directly and are cited as `file:line`. No claim about this codebase in this
  document is secondhand.
- Where the research JSON conflicts with measured repo evidence, the repo wins and the conflict is
  stated in the body (§2.7 on the compute boundary; §3.1 on the vol model).
- Every **UNVERIFIED** marker is carried through from the research as-is. None was upgraded.
- Adding this document requires a row in [docs/TOPIC-MAP.md](../TOPIC-MAP.md), per
  `.claude/rules/docs.md`.
- Phase 1's schema change requires updating
  [docs/architecture/stack-decisions.md](../architecture/stack-decisions.md) first, per CLAUDE.md
  non-negotiable #4.
