# OptionStrat — teardown

Reference for the Morai rebuild. Written 2026-08-25.

Three evidence sources, kept separate throughout:

| Marker | Means |
|---|---|
| **SCREENSHOT** | Transcribed from two screenshots of the live page, 2026-08-25. |
| **MEASURED** | Read off the wire or out of the shipped JavaScript. Reproducible. |
| **VENDOR** | OptionStrat's own words — FAQ, blog, pricing page, in-app copy. |
| **INFERRED** | Reasoning on top of the above. Not observed. |
| **UNVERIFIED** | Could not be confirmed. Says so and stops. |

Page under test:
`https://optionstrat.com/build/calendar-put-spread/SPX/-.SPXW261016P7425,.SPXW261130P7425`

Bundle read: Next.js build `w5R0W-8076cD6Fi8dQ1Ce`, site version `v1.5`. Chunk
`pages/_app-e1a6edbef2f0f764.js` holds the pricing kernel. Chunk
`5650-6e2988afa1fc7026.js` holds the strategy view. Chunk `7755-10de5b845c598a14.js`
holds the expiration ribbon. Chunk `321-969efd33b80f841a.js` holds the in-app tips.

Companion doc: [optionstrat-live-capture.md](optionstrat-live-capture.md) — the wire
capture. This teardown cites it rather than repeating it.

---

## 1. What OptionStrat is, and what it is for

OptionStrat is a browser options-strategy builder. You pick a named strategy, pick a
symbol, pick strikes and expirations, and it draws what the trade is worth across price
and time. It was launched in November 2020 by one person, Heath Milligan, and every
dated blog post on the site carries his byline (VENDOR:
[about](https://optionstrat.com/about)). It now sits inside OptionMetrics' product
portfolio (VENDOR, single source: a Businesswire release dated 2026-08-05, surfaced by
search and not fetched — treat the ownership claim as UNVERIFIED). It sells two tiers
above free, $39.99/mo and $99.99/mo (VENDOR:
[membership](https://optionstrat.com/membership)). It is a tool for deciding whether to
put a trade on. It is not a tool for watching one you already have: its whole answer to
"I own this" is to overtype the entry price by hand (VENDOR:
[FAQ](https://optionstrat.com/faq), quoted in §7).

---

## 2. The UI, part by part

Build cost is rated against a repo that already has a chain, a BSM kernel, greeks, and
term structure. It is the cost of the *surface*, not the math.

### 2.1 Top chrome

Title with an info tooltip. Button cluster: Add, Positions (2), Save Trade, Historical
Chart. Symbol chip `SPX`, spot `7,675.02`, change `+0.29% / +22.16` in green, a refresh
glyph, and a `Delayed` badge. Then `EXPIRATIONS: 52d, 97d` — the DTE of each leg stated
as a set, not as dates. (SCREENSHOT)

The `Delayed` badge is real, not decoration. OptionStrat is a licensed OPRA vendor and
the free tier runs 15 minutes behind (VENDOR: [FAQ](https://optionstrat.com/faq)).

**Cost: cheap.** One row. The DTE-set header earns its space — it is the number that
drives a calendar's theta and vega asymmetry, and it saves the reader arithmetic on two
dates.

### 2.2 Expiration ribbon

A horizontal scrolling calendar strip. Month bands (Sep, Oct, Nov, Dec, Jan '27, Feb)
sit across the top, each sized by how many expirations fall inside it, not by how many
days the month has. Under each band sit individual day ticks. Some carry a small `AM`
superscript. The two selected expirations are highlighted in different colours — Oct 16
blue, Nov 30 magenta — and those colours are reused everywhere else on the page.
(SCREENSHOT)

The badge logic is exact (MEASURED, chunk `7755`): series are filtered to
`!expired && !isNonStandard`, sorted by maturity and then by settlement style, and each
tick renders `EXPIRED`, or `AM` when `settlementStyle === Open`, or `NS` when
non-standard, or nothing. Each tick is a `role="button"` with an
`aria-label` of the maturity and Enter/Space key handling.

The AM flag matters. SPX monthlies are AM-settled off the opening prices of the
constituents; SPXW weeklies are PM-settled off the closes; SPX stops trading the
business day *before* the settlement value is struck (VENDOR:
[CBOE SPX fact sheet](https://cdn.cboe.com/resources/spx/spx-fact-sheet.pdf),
[specifications](https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/)).
OptionStrat models this: settlement style feeds
`getSettlementDateTime()` and `getLastTradeDateTime()` per series, so DTE is
settlement-aware, not date-aware (MEASURED).

**Cost: medium.** Two-pass layout — count ticks per month, size the band by share of
ticks, then space ticks evenly inside their band. The trap is sizing bands by calendar
days, which crushes the weekly-dense near months.

### 2.3 Strike axis

A horizontal price axis from about 7250 to past 7700, labelled every 25 points. Leg
pills sit on the axis at their strike: a magenta `7425P ⚠` badged `11/30` above the
line, a red `7425P ⚠` badged `10/16` below it. An `SPX` marker sits at 7675 on the same
axis, so strike-versus-spot reads at a glance. Small carets under the axis at about 7475
mark a draggable cursor. (SCREENSHOT)

The `⚠` is the liquidity warning, and it is labelled — on hover, not on the pill.
Thresholds, verbatim from the shipped code (MEASURED, chunk `5650`):

| Condition | Test | Message |
|---|---|---|
| Low open interest | `oi < 10` | `Low open-interest (N)` |
| No volume | `volume === 0` | `No volume today` |
| Low volume | `volume < 10` | `Low volume (N)` |
| Wide spread | `(ask−bid)/mark >= 0.10` **and** `ask−bid >= 0.10` | `Wide bid/ask spread (X%)` |
| No IV | `isNaN(iv)` | `IV could not be calculated` |

Messages join with commas beside the icon. An in-app tip states the same thing (VENDOR,
chunk `321`): *"This warning icon is displayed for options that have extremely low
volume or open interest, or a wide bid/ask spread."*

This corrects a claim made from the screenshots alone — that the glyph ships with no
legend. It ships with a hover label. The design objection survives anyway: a glance
surface needs the label visible, not one hover away.

**Cost: medium.** Dragging must snap to the chain's real strike increment, and two legs
on the same strike must stack rather than overlap. Both are fiddly, neither is deep.

### 2.4 Metric strip

A horizontally paged row with `<` `>` chevrons, so more metrics sit off-screen.
Visible: `NET DEBIT $5,355`, `MAX LOSS $9,370.27`, `MAX PROFIT $10,343.68`,
`CHANCE OF PROFIT --%` with a padlock, `BREAKEVENS Between 7,191.40 - 7,749.64`.
(SCREENSHOT)

The padlock is a paywall, and the tooltip says so in the bundle (MEASURED, chunk
`5650`): *"Net greeks (total greeks for multi-leg strategies) are only available to paid
members. Upgrade for access."* Chance of profit and net greeks both unlock at the
$39.99 tier (VENDOR: [membership](https://optionstrat.com/membership)).

Max loss exceeds the net debit by $4,015.27. That is not a rounding artefact and it is
not what a calendar's structural max loss is. §5.6 resolves it.

**Cost: cheap**, if the numbers already exist. A fixed ordered array paged in fixed-size
groups beats a width-measuring layout.

### 2.5 View 1 — the table

A T+N profit matrix. Rows are underlying price descending, 8,064 down to 7,286, each
tagged with a signed percent move in a narrow gutter, 5.1% down to −5.1%. Rows are
evenly spaced in *percent*, not in dollars. Columns are dates ascending under month
headers: Aug 25, 28, 31; Sep 2, 4, 8, 10, 14, 16, 18, 21, 24, 28, 30; Oct 2, 5, 8, 12,
13, 16. Column spacing thins with distance from today. The last column is the front-leg
expiration and the matrix stops there. Cells carry dollar P/L with thousands separators,
`10.3k` when they overflow, on a diverging heatmap centred on zero. A dashed horizontal
rule sits between the 7,710 and 7,675 rows, marking spot. The single largest cell is
emphasised. (SCREENSHOT)

Three corrections from measurement:

- The grid is **335 cells** in the DOM, against about 420 implied by the screenshot's
  21×20 shape. The gap is unexplained and stays unreconciled (MEASURED, see
  [live capture](optionstrat-live-capture.md)).
- There is **no `<canvas>`** anywhere on the page. A few hundred styled divs is well
  inside what the DOM handles (MEASURED).
- The heatmap is **one hue per sign with variable alpha**, not a two-hue interpolation.
  Sampled losing cells: `rgba(144, 0, 30, 0.410)` at −2,227 through
  `rgba(144, 0, 30, 0.443)` at −2,391 (MEASURED). Over a near-black ground that gives a
  smooth ramp for free, with no palette lookup. It also collapses under a light theme.

The date convention is stated only in the FAQ (VENDOR): *"The table calculations show
the estimated price at market open, except for the current date and expiration date. On
the current day, the estimate is for the current time. On the expiration day, the
estimate is for market close."* Three conventions inside one grid, documented nowhere on
screen.

**Cost: cheap to render, expensive to get right.** Use a native `<table>` with
`<th scope="row">` on the price rows and `<th scope="col">` on the dates. Do not
virtualise: at this cell count there is no performance reason, and inconsistent
`aria-rowindex`/`aria-colindex` values on a recycled grid can make screen-reader table
navigation skip rows or stop working (
[W3C ARIA APG, data grid examples](https://www.w3.org/WAI/ARIA/apg/patterns/grid/examples/data-grids/)).
Because a date column click switches the graph view, the grid is interactive and wants
`role="grid"` with roving tabindex, not a passive table.

### 2.6 View 2 — the graph

One filled payoff curve at one chosen date. x-axis underlying 7,300 to 8,050, y-axis P/L
−$4,000 to $10,000. Green gradient above the zero line, red below. The peak is annotated
with price and percent, `7,471.16 (-2.7%)`. A crosshair dot tracks the pointer with a
dollar label, `$8,351.87`. A dotted vertical marks spot at 7,675, unlabelled. A solid
cyan vertical marks the breakeven at 7,749.64, labelled. Below the plot:
`DATE: Fri Oct 16th 3:00pm (52d)` and a full-width date slider whose right end reads
`(At expiration)`. (SCREENSHOT)

The chart SVG has **507 children**, using `defs, linearGradient, stop, mask, rect, g,
text, line, polygon`. The curve is a `<polygon>` filled with a `<linearGradient>` and
clipped by a `<mask>` — that is how the green-above/red-below fade works. No `<path>`,
so the curve is a point list, not a bezier. No charting-library fingerprint matched
(MEASURED).

The `3:00pm` is not a mystery and not a vendor quirk. The scrubber's label is computed
as `earliestSeries.settlementDate.minus({days: N}).toLocal()`, and it reads `Now` when
`earliestSeries.dte − N <= 0` (MEASURED, chunk `5650`). So every scrubber date inherits
the front leg's settlement *time of day*, rendered in the viewer's timezone. SPXW settles
at the 4:00pm ET close, so a 3:00pm label means the screenshot was taken on a US Central
clock (INFERRED). Note this is a *different* convention from the table's market-open
columns quoted above. Two views, two clocks, same trade. Not reconciled.

**Cost: medium.** Recharts is already a dependency here (`recharts` in
`apps/web/package.json`) and covers the curve, fill and axes. Drive the crosshair with a
transform-only update so pointer tracking never triggers layout.

### 2.7 Shared bottom controls

`RANGE: ±5.1%` with a slider, setting the price domain. A crosshair glyph. An
`AVERAGE ▾` dropdown. `IMPLIED VOLATILITY: 16.7%` with a slider tick-marked ×1, ×2, ×3
and a reset glyph. A tab row `[Table] [Graph]`, then a metric selector
`[Profit / Loss $] [Profit / Loss %] [Contract Value] [% of Max Risk] [▾ More]`.
(SCREENSHOT)

**`AVERAGE` is decoded.** The screenshot transcription guessed it selects a
volatility-assumption model. It does not. The bundle builds the menu like this
(MEASURED, chunk `5650`):

```js
let paid = user?.accessLevel >= AccessLevel.Tools;
let show = seriesControls.length > 1;
let items = [
  { name: narrow ? "Avg" : "Average", control: undefined, color: undefined },
  ...seriesControls.map(c => ({ name: fmt.expiration(c.value.expiration),
                                color: c.color, control: c }))
];
// each item is disabled unless (item === items[0] || paid)
// footer row when !paid: "Upgrade to adjust IV per expiration"
```

So the dropdown picks **which IV series the slider below it moves**. `Average` moves all
legs at once. Selecting a specific expiration moves only that leg — and that is the paid
"Adjust IV per expiration" feature. The dropdown only renders when the strategy has more
than one expiration. Each menu row shows that series' current IV and, when the multiplier
is not 1, the delta against its base IV.

`Average` itself is a **size-weighted mean of the legs' implied vols**, falling back to a
series' ATM IV when a leg's own IV is NaN, and to the nearest 30-day series' ATM IV when
there are no options at all (MEASURED, `getAverageIv`). The slider is a *multiplier*, not
an absolute vol: its stops are literally `[{at:1,text:"×1"},{at:2,text:"×2"},{at:3,text:"×3"}]`.

The metric selector's greyed-out entries have a stated reason (VENDOR: FAQ):
*"% of Entry Cost can only be calculated for net debit strategies. % of Max Risk can only
be calculated for strategies that have a defined risk."*

Separately, and not the same control: a **Pricing mode** choice group in settings picks
mid versus bid/ask fills, with the tooltip *"Using the midpoint (between the bid and ask)
as the option price. This price may not be attainable when liquidity is low."*
(MEASURED + VENDOR). Mid is the default (VENDOR: FAQ). Commissions are a paid feature.

**Cost: cheap for the controls, and the cheapness is the trap.** The whole modelling
problem in §5 hides behind one dropdown and one multiplier.

---

## 3. How it is built

Only fingerprints matched in bytes. Wire detail lives in
[optionstrat-live-capture.md](optionstrat-live-capture.md); this is the summary.

| Layer | Finding | Evidence |
|---|---|---|
| Framework | Next.js. `__NEXT_DATA__`, `next-head-count`, build id `w5R0W-8076cD6Fi8dQ1Ce`, dynamic route `pages/build/[definition]/[[...symbol]]` | MEASURED |
| Rendering | Hand-built SVG. 507 children on the chart SVG; `polygon` + `linearGradient` + `mask`; no `<path>`; no `<canvas>` anywhere | MEASURED |
| Charting lib | None matched. No Recharts, Visx, Highcharts, Plotly, D3, Chart.js fingerprint | MEASURED |
| Styling | CSS Modules (`Header_header__zC4N_`, `StrategyChooser_categories__iFxta`). No Tailwind utilities, no CSS-in-JS. Font Awesome icons, Google Fonts (Montserrat, Inter) | MEASURED |
| Component lib | None matched — no MUI, shadcn, Antd, Bootstrap, daisyUI | MEASURED |
| Compute | **Fat client.** Two data requests for the whole page: `GET /api/underlyings`, and `GET /api/quote/chain/delayed?symbol=SPX` returning 500,810 bytes of `application/octet-stream`. Every number is computed in the browser from that payload | MEASURED |
| Chain payload | Not JSON. `JSON.parse` fails; first bytes are high-entropy. Decode format unknown | MEASURED / UNVERIFIED |
| WASM / worker | Neither. Zero `.wasm` resources, zero worker resources. Pricing runs on the main thread | MEASURED |
| Bundle | 545 KB JS across 25 chunks — **compressed transfer size, initial page load only** (summed `transferSize` over `performance.getEntriesByType('resource')` entries matching `.js`, so it excludes anything lazy-loaded later and is not the uncompressed parse size); 3,422 DOM nodes on the built page; ES2019 polyfills present | MEASURED |
| Hosting | AWS CloudFront behind Cloudflare — `cf-ray`, `via` CloudFront, `x-amz-cf-pop`, `x-amz-cf-id` | MEASURED |
| Telemetry | Sentry (`_sentryDebugIds` in every chunk), Google Analytics, and a Mixpanel proxy at `/api/mp/track` | MEASURED |
| Public API | None. No REST, no GraphQL, no docs, no webhooks. The only public interface is the URL in §4 | MEASURED |
| Auth | No client-side auth SDK matched (Firebase, Supabase, Auth0, Clerk). Handled server-side | MEASURED |
| Mobile | iOS app id `1541714905` and a Play Store link. No React Native, Ionic or Flutter in the web bundle, so the apps are a separate build | MEASURED |

### Refuted claims

Four earlier research findings were made from pre-hydration HTML or from a sitemap, and
the wire and bundle contradict them. Recording them so they do not get laundered back in:

| Earlier claim | What the bytes say |
|---|---|
| "Only public endpoint is `/api/discord/invite`; the calculation engine may be backend-driven" | Wrong. Two real data endpoints, and the engine is entirely client-side. |
| "No Google Analytics, Mixpanel or Hotjar detected" | Wrong. GA and a Mixpanel proxy both fire. |
| "19 SVG elements" | Counted pre-hydration. The chart SVG alone has 507 children. |
| "53 strategies" (sitemap) vs "72 strategies" (rendered nav, including Double Diagonal) | Both are right about different surfaces. The sitemap publishes fewer routes than the nav renders. |

### The client-side pricing question

Two positions were put forward for the rebuild, and they conflict.

One says price everything server-side and ship a precomputed grid, citing commit
`1baceaa` ("delete the browser's copy of the math") as precedent against browser
pricing. The other says copy OptionStrat: ship the chain, price in the client, and no
control ever touches the network.

This repo already settles it, and the first position misreads its own citation.
`1baceaa` deleted `chain-math.ts`, a browser **twin** of logic that already existed in
`core`. The twin was wrong because it ran on *different inputs* — a per-expiry `(r, q)`
instead of the carry the stored IV was inverted at, a different spot selection, and a
per-row timestamp instead of one instant. Two implementations, two input sets, two
answers. Client-side pricing over the **shared kernel** is a different thing and is
already sanctioned here: `eslint.config.js` allows `apps → quant` with the comment
"apps/web imports quant for client-side BSM live re-pricing (D21)";
`apps/web/src/lib/scenario-engine.ts` already does exactly this over `@morai/quant`; and
`packages/quant` has devDependencies only, so it ships anywhere (all MEASURED locally).

The rule to carry forward is not "math lives on the server". It is **one implementation,
one input set, shipped to both sides**.

---

## 4. The URL grammar

The trade is the URL. No database row, no share id, no expiry. Worth copying outright.

```
https://optionstrat.com/build/calendar-put-spread/SPX/-.SPXW261016P7425,.SPXW261130P7425
                              └─ definition ────┘ └sym┘ └──────── legs ─────────────────┘
```

### Grammar

```
/build/<definition>[/<symbol>[/<legs>]]

definition := kebab-case strategy name        e.g. calendar-put-spread, call-ratio-spread
symbol     := underlying ticker               e.g. SPX
legs       := leg ( "," leg )*
leg        := [ quantity ] "." contract
quantity   := "-" | "+" | signed integer      "-" = short 1, "+" or omitted = long 1,
                                              "-2" = short 2, "+2" = long 2
contract   := root YYMMDD ( "C" | "P" ) strike
root       := option root, not the underlying — SPXW is not SPX
YYMMDD     := 6-digit expiration date
strike     := integer strike
```

The `.` separator is literal and required. The quantity sits *before* it.

### Worked example

`-.SPXW261016P7425,.SPXW261130P7425`

| Token | Quantity | Root | Expiration | Right | Strike | Reads as |
|---|---|---|---|---|---|---|
| `-.SPXW261016P7425` | `-` → short 1 | SPXW | 2026-10-16 | Put | 7425 | Sell 1 SPXW 16 Oct 26 7425 put |
| `.SPXW261130P7425` | omitted → long 1 | SPXW | 2026-11-30 | Put | 7425 | Buy 1 SPXW 30 Nov 26 7425 put |

Short front, long back, same strike. That is a long put calendar, and it settles the
structure from the URL rather than from which pill is drawn above the axis. The net debit
confirms it.

The grammar was tested with a constructed URL, not just decoded:
`/build/call-ratio-spread/SPX/-.SPXW261016C7400,+2.SPXW261016C7500` loads and renders
both contracts (MEASURED). So signed multi-contract quantities work.

Two more properties worth having:

- **The title is generated from the URL.** The document title came back as
  *"SPX Oct 16th - Nov 30th 7425 Calendar Put Spread"* — a shared link previews correctly
  with no stored state (MEASURED).
- **The `og:image` is not.** Every route serves the same static
  `https://optionstrat.com/img/og/og-general.jpg`, so a shared trade has no chart preview
  (MEASURED).

Note the root, not the underlying, is what goes in the contract. SPX monthlies (`.SPX`,
AM-settled) and SPXW weeklies (`.SPXW`, PM-settled) are different roots with different
settlement, and a grammar that collapses them is broken before it starts.

---

## 5. The math behind the matrix

This is the section that decides whether a rebuild is worth doing.

### 5.1 What OptionStrat actually computes

Read out of `pages/_app-e1a6edbef2f0f764.js` (MEASURED throughout this subsection).

**Two pricing models, dispatched per series.** The exercise-style enum is
`{ American: 0, European: 1 }`. `getModel(style)` returns a Bjerksund-Stensland 2002 class
for American and a plain Black-Scholes class for European. Every pricing call reads
`option.profile.series.exerciseStyle`.

That qualifies the FAQ. OptionStrat says (VENDOR:
[FAQ](https://optionstrat.com/faq)): *"We use the Bjerksund-Stensland (2002) American
options model for our theoretical price and greeks calculations... European models do not
consider the early-exercise possibility of American options, which leads to errors in
their charts."* The code has both models. SPX and SPXW are European, so they take the
Black-Scholes branch. For our instrument, plain BSM is not a compromise — it is what
OptionStrat itself uses, and what the contract requires.

**Rates come from a per-tenor curve.** `context.riskFreeRates.getRate(dte)`. Not one flat
rate for every leg. That matches exchange practice: CBOE derives its risk-free rate from
the Treasury constant-maturity curve, interpolated to each option's exact tenor and
converted to continuous compounding (VENDOR:
[Cboe Volatility Index Mathematics Methodology](https://cdn.cboe.com/resources/indices/Cboe_Volatility_Index_Mathematics_Methodology.pdf)).

**Dividends are zero for anything that is not a future.**

```js
static getDividend(underlying, rate) {
  return underlying.profile.type === Future ? rate : 0;
}
```

The underlying-type enum is `{ Other: 0, Stock: 1, ETF: 2, Index: 3, Future: 4 }`, so
SPX is `Index` and falls to the `: 0` branch. Only futures get a carry, where `q = r` —
correct for a future, since its cost of carry is zero.

So SPX gets `q = 0`. The forward is `S·e^{rT}`, with no dividend yield at all. This is
wrong for SPX — the index pays nothing but its constituents do, and the option-implied
forward reflects that. CBOE's own method extracts the forward from put-call parity per
expiration, `F = K + e^{rT}(C − P)` at the strike where `|C − P|` is smallest, and needs
no dividend assumption at all (VENDOR: same methodology document).

The error partly hides. OptionStrat inverts IV from the market price with the same wrong
`q`, so repricing at the observed spot and tenor reproduces the market price exactly. It
stops hiding the moment you march time or move spot — which is the entire job of the
matrix. Two legs at different tenors absorb different amounts of the error, so the
front-back IV differential is biased. That differential is the calendar. (INFERRED, and
this is the one place the measurement and the consequence should not be conflated.)

**Greeks are finite differences.** Delta and gamma reprice at `S ± 0.01` rather than using
a closed form.

**IV inversion is bisection.** 30 iterations over `[0, 2000]` percent, tolerance 0.01.

**Time is calendar days over 365.** `getTheoreticalOptionPrice(..., dte/365, ...)`.

**The scan window is derived from the back leg's implied move**:

```js
let halfWidth = 5 * latestSeries.getImpliedMove() * Math.max(1, ivMultiplier(latestSeries));
let lo = Math.max(0, spot - halfWidth), hi = spot + halfWidth;   // extended to cover all strikes
// 500 samples across [lo, hi]
// sign change in P/L      -> bisect -> a breakeven, with crossing direction
// sign change in dP/L/dS  -> bisect -> a peak location
```

So breakevens are found numerically, by root-finding, exactly as they must be for a
calendar — there is no closed form when one leg is still alive at the other's expiry.

### 5.2 The vol assumption, stated plainly

**Every dollar on the page is downstream of one number per leg: an implied vol held
constant.** OptionStrat says so (VENDOR: [FAQ](https://optionstrat.com/faq)):
*"Implied volatility is never constant through the life of an option, so we recommend
that you move the IV slider to see how changes in implied volatility will affect your
trade."*

Read that carefully. The model is flat, constant IV per leg, held fixed across every cell
of the matrix. There is no rule for how IV moves when spot moves. There is no roll along
the term structure as DTE decays. The IV slider is not a model — it is the modelling
problem handed to the user as a knob.

For a vertical that is defensible. Both legs sit at the same maturity, so a
mis-specified vol rescales a spread that was going to move the same direction anyway, and
much of the error cancels between the long and short leg (INFERRED — no source states this
in these terms; it follows from the equations in §5.3).

For a calendar it is the whole game. The two legs sit on different points of the term
structure. Their IVs do not move together. A calendar's P/L depends on the *spread*
between the two legs' vol changes, not on either level, so a wrong assumption can flip the
sign of the move rather than just its size. (INFERRED, same caveat.)

And the fix is paywalled. "Adjust IV per expiration" is a $39.99/mo feature (VENDOR:
[membership](https://optionstrat.com/membership); confirmed in the bundle by the
`Upgrade to adjust IV per expiration` row in §2.7). The one control a calendar trader
needs most is the one the free product will not give.

Events are not modelled either (VENDOR: FAQ) — *"While some market events like earnings
and ex-dividend dates are shown for informational purposes to premium users, they are not
accounted for in the calculation."*

### 5.3 Sticky strike, sticky delta, sticky tree

There are three canonical rules for how the smile moves when spot moves. Derman names and
defines all three (ACADEMIC:
[Derman, Patterns of Volatility Change, E4718 Lecture 9](https://emanuelderman.com/wp-content/uploads/2013/09/smile-lecture9.pdf)),
verbatim: *"There are at least three different views on which aspects of the current skew
are sticky as the index moves over short times... 1. The Sticky Strike Rule. 2. The Sticky
Delta Rule. 3. The Sticky Implied Tree Rule."*

| Rule | Formula | What it says | What it does to a calendar |
|---|---|---|---|
| **Sticky strike** | `Σ(S,K,t) = Σ₀ − b(K − S₀)` | Each strike keeps its own IV regardless of spot. | Both legs keep today's vol at the fixed strike. The front-back differential never changes. Cheapest to implement, and it never shows you the vol move that actually hurts. Derman calls the market-maker who believes it "irrational exuberance" — it lowers IV without limit as the market rises. |
| **Sticky delta / moneyness** | `Σ(S,K,t) = Σ₀ − b(K/S − 1)S₀ ≈ Σ₀ − b(K − S)` | IV depends only on moneyness. ATM vol is roughly constant as spot moves. | The smile travels with spot, so a fixed-strike calendar slides along the smile as spot moves. Both legs re-read the skew at their own tenor, so the differential moves only through the two tenors' skew slopes. Derman: "a model of common sense and moderation." |
| **Sticky implied tree** | `Σ(S,K,t) ≈ Σ₀ − b(K + S − 2S₀)` | ATM vol itself falls twice as fast as the skew's strike-slope when spot rises, and rises twice as fast when spot falls. | The only rule that reproduces "market falls, IV rises." The front leg's vol reacts hardest, so the short leg gains value fastest in a selloff — the real risk of a long calendar in a crash. |

Derman's own summary table records the empirical finding: *"during calm upward-trending
periods, the market satisfied the sticky strike rule, and during fearful periods it comes
closer to satisfying the sticky implied tree rule."*

So the regime is not a preference. It changes with the tape, and a tool that picks one
silently will be right half the year.

### 5.4 The other axis: what happens to a fixed expiration as time passes

The three rules above govern the *spot* axis. Nothing governs the *time* axis, and this is
the gap nobody names.

Hold spot fixed. Advance 30 days. The back leg was 97 DTE and is now 67 DTE. What is its
IV?

There is **no canonical convention** and no named rule. Searching turns up only the
constant-maturity convention used to build a term structure at fixed tenors (VENDOR:
[ORATS on term structures](https://orats.com/blog/implied-volatility-term-structures-three-parameters)),
which describes cross-sectional curve-building, not how one fixed expiration evolves.
Two defensible conventions exist and must be **chosen**, not discovered:

- **Convention A — frozen IV.** The leg keeps today's own implied vol as its DTE shrinks.
  This is what a naive constant-IV reprice does by default, and it is what OptionStrat
  does.
- **Convention B — curve roll.** The leg's IV converges toward wherever today's term
  structure sits at its shrinking DTE. A 97-day option that becomes a 67-day option trades
  near today's 67-day level.

Which is bigger? For a long calendar, which is long back-leg vega: in contango, frozen IV
holds the back leg at a *higher* vol than the curve implies at its new tenor, so it
**overstates** the back leg's value and the position's P/L. In backwardation it
understates it. The magnitude scales with back-leg vega times the vol-point gap between
the two conventions. (INFERRED. No measured backtest of this error for SPX 52d/97d
calendars was found, and none is asserted.)

The market-consistent anchor for Convention B is the forward vol between two tenors, which
falls out of variance additivity:

```
σ_fwd = sqrt( (T₂·σ₂² − T₁·σ₁²) / (T₂ − T₁) )
```

Because `Var(X_T₂) = Var(X_T₁) + Var(X_T₂ − X_T₁)` under independent increments, so
`T₂σ₂² = T₁σ₁² + (T₂−T₁)σ_fwd²`. Elementary and not in dispute. It gives the vol the
market is already quoting for the window between the front and back expirations — which is
exactly the window a calendar trader is selling.

### 5.5 Chance of profit

Four real methods exist. Each carries a different assumption and a different failure.

| Method | What it needs | Assumption | Fails when |
|---|---|---|---|
| **Breeden-Litzenberger** — `q(K) = e^{rT}·∂²C/∂K²` | A dense, arbitrage-clean strike ladder | None about the distribution. Model-free. | Prices are noisy. The finite-difference estimate `e^{rT}[C(K−ΔK) − 2C(K) + C(K+ΔK)]/ΔK²` amplifies noise by `1/ΔK²`; with `ΔK = 5` and `ε = $0.05` the noise is 0.002, comparable to the density itself ([derivation](https://sungchullee.github.io/financial_math_book_writing/ch12/model_free_results/breeden_litzenberger_formula/)) |
| **Closed-form lognormal** | One IV | GBM with one constant σ. No skew. | Always, for an index. It understates OTM downside and overstates OTM upside on a negatively-skewed underlying |
| **Delta as probability** | The chain | Exact only under Black-Scholes with the same σ the option was priced at, and it gives the risk-neutral probability | Long-dated options, and any time implied ≠ realised. *"Using delta as probability proxy is only an estimate. It assumes random market movement and rational (unbiased) valuation of options"* ([Macroption](https://www.macroption.com/delta-calls-puts-probability-expiring-itm/)) |
| **Monte Carlo** | A process | Whatever you simulate under | Nothing extra for a vanilla European marginal — it converges to Breeden-Litzenberger given the same density. Its value is jumps, stochastic vol, path dependence |

**What OptionStrat does** (MEASURED, chunk `pages/_app`):

```js
static chanceOfTarget(spot, target, dte, iv) {
  if (target < 0) return { above: 1, below: 0 };
  if (dte <= 0) { /* hard 0 or 1 */ }
  let below = cnd( Math.log(target / spot) / (iv * Math.sqrt(dte / 365)) );
  return { above: 1 - below, below };
}

static getChanceOfProfit(strategy) {
  // walk the breakevens, subtract chanceOfTarget(...).below * crossing direction
  // dte comes from strategy.earliestSeries.dteFromUpdate
  // iv  comes from earliestSeries.getATMImpliedVol() * ivMultiplier(earliestSeries)
}
```

That is a driftless lognormal. `ln(K/S) / (σ√T)` has **no drift term at all** — no
risk-free rate, no dividend, and not even the `−σ²/2` variance correction that `N(d₂)`
carries. It uses the **front** expiry's DTE and the **front** expiry's ATM IV, with no
skew and no contribution from the back leg. For a 52-DTE SPX put at 16.7% vol the omitted
`σ²T/2` term is about 0.002 against a `σ√T` of about 0.063, so the z-score shifts by about
0.03 standard deviations — roughly a point of probability near the middle (INFERRED, my
arithmetic). Small. The skew omission is not small.

And whatever number any of these produce, it is a **risk-neutral** probability, not a
forecast. The gap between the risk-neutral and the physical measure is the variance risk
premium, and it is positive on average for equity indices because sellers of variance
demand payment for tail risk (ACADEMIC, but assembled from search summaries rather than a
fetched primary source — treat the magnitude as UNVERIFIED; the direction is standard).
Risk-neutral probability is useful for comparing strategies consistently. It is not a
calibrated win rate, and a tooltip that implies otherwise is lying.

This repo has been burned by exactly this class of error before — the VVIX regime tag that
looked predictive because it was read at the close of the day it was predicting. A
model-derived number labelled as ground truth is the same mistake wearing different
clothes.

### 5.6 MAX LOSS versus NET DEBIT — resolved

The screenshot shows `NET DEBIT $5,355` and `MAX LOSS $9,370.27`. The textbook says a long
calendar cannot lose more than the debit: *"The max loss for the spread is the debit paid
and can occur when both legs expire OTM and are worthless"* and *"Calculating the max
profit of a long calendar spread is impossible since the short put leg expires before the
long put leg, and the long put leg will still have some amount of extrinsic value
remaining"* (VENDOR:
[tastytrade, long put calendar spread](https://tastytrade.com/learn/options/long-put-calendar-spread/)).

The number is $4,015.27 too big. Here is why, with three independent supports.

**The algorithm** (MEASURED):

```js
static getMaxProfitAndLoss(strategy) {
  let basis = strategy.stats.basis;                 // the debit paid
  let hi = -Infinity, lo = +Infinity;
  let price = S => strategy.getTheoreticalPrice(S, 0);   // day offset 0 = at FRONT expiry
  if (singleExpiry) { /* scan [0, ...strikes, lastStrike + rightBound] */ }
  else {
    for (let S of plFunctionCharacteristics.derivativeZeroes) track(price(S));
    track(price(0));                                      // <- S = 0
    track(getApproaching(price, getRightBound(strategy), 1));
  }
  return { maxLoss: basis - lo, maxProfit: hi - basis };  // commissions folded in
}
static getRightBound(s) { return 100 * s.underlying.quote.last; }
```

So `MAX LOSS = debit − min(position value)`, and the candidate set explicitly includes
`S = 0`. Day offset 0 is the front expiration — the scrubber confirms it, since offset `N`
maps to `earliestSeries.settlementDate.minus({days: N})`.

**The mechanism.** At `S = 0` on the front expiry: the short front put pays its full
strike, `−7425`. The long back put has 45 days left and, in their own European class, is
worth `K·e^{−rT}·N(−d₂) − S·N(−d₁)`, which at `S = 0` is exactly `K·e^{−rT}`. Net position
value is `7425·(e^{−rT} − 1) < 0`. Negative. So `maxLoss = debit + K(1 − e^{−rT})`, which
exceeds the debit by construction.

**The arithmetic.** Two independent captures of the same URL, taken at different times
with different delayed quotes:

| Capture | Net debit | Max loss | Max loss − debit |
|---|---|---|---|
| Screenshot | $5,355 | $9,370.27 | **$4,015.27** |
| Earlier browser capture | $5,400 | $9,415.27 | **$4,015.27** |

Identical to the cent, while the debit moved $45. The excess is invariant to the quote,
exactly as `K(1 − e^{−rT})` should be — it depends only on strike, rate and the 45-day gap
between the two expirations. Solving gives `rT = 0.005422`, so `r ≈ 4.40%` over 45 days
(INFERRED, my arithmetic; the invariance itself is measured).

(Max profit does *not* behave this way: `10,343.68 + 5,355 = 15,698.68` against
`10,184.02 + 5,400 = 15,584.02`. The peak depends on live quotes, the minimum does not.)

**So MAX LOSS is the answer to "what if SPX goes to zero on October 16th."** It is
mathematically correct and practically meaningless. It is not scanned over the displayed
±5.1% range, and it is not scanned over dates — an earlier reading that guessed a
price×date domain scan was wrong on both counts.

**The fix does not depend on agreeing with any of this.** Show two separate figures:

1. **Structural max loss** — the net debit, at the front expiry. Labelled as such.
2. **Worst modelled P/L** — the minimum over a stated price domain, at a stated date,
   under a stated vol assumption. Labelled with all three.

Reusing one word for both is how a trader reads "worst case" and gets a number that is
neither.

### 5.7 Where a naive implementation goes wrong

Each of these is a real trap, sourced above.

1. **Summing today's greeks instead of repricing.** A delta+gamma Taylor expansion of a
   single SPX put at the screenshot's own parameters (K=7425, S=7675.02, T=52/365,
   σ=16.7%) diverges measurably: a 5% down move gives a true price change of $160.50
   against a Taylor prediction of $153.56, an error of −$6.94 or 4.3% of the move, rising
   to 7.2% at 10% (MEASURED, computed from closed-form BSM). That isolates the spot axis
   only. A matrix cell moves spot *and* time *and* vol at once, so vanna and the vol
   regime's own re-pricing are invisible to a t=0 greek snapshot. **Reprice every cell.**
2. **One flat IV across both legs.** §5.2. The legs sit on different tenors. Two numbers
   minimum, or the calendar is not modelled.
3. **Freezing the back leg's IV as its DTE shrinks.** §5.4. Defensible, but it is a
   choice, and in contango it flatters a long calendar.
4. **Assuming a dividend yield instead of extracting the forward.** §5.1. CBOE's method
   backs `F` out of put-call parity per expiration and needs no `q`. OptionStrat sets
   `q = 0` and lets the IV inversion absorb it, which stops working once time moves.
5. **One flat risk-free rate for every leg.** OptionStrat gets this right with a per-tenor
   curve. The short end's slope is not negligible across a 52d/97d gap.
6. **Treating AM and PM settlement as the same instant.** SPX monthlies settle off the
   opening prices and stop trading the day before; SPXW weeklies settle off the closes on
   expiration day. Same calendar date, different τ and different terminal price source.
   Branch on the root.
7. **A date without a time of day.** τ is continuous. OptionStrat itself uses three
   conventions in one product — market open for most table columns, current time for
   today, market close on expiration day, and the front leg's settlement time for every
   graph scrubber date. Pick one, and put it on screen.
8. **Caching breakevens independent of the vol assumption.** They are roots of a P/L
   function that includes the still-alive back leg. Move the IV slider and they move.
9. **Calling a risk-neutral probability a win rate.** §5.5.
10. **Reusing "max loss" for a scanned extremum.** §5.6.

---

## 6. What is excellent, what is weak

### Excellent

**The matrix is the primary object, not the curve.** A payoff curve answers one question:
P/L at one date under one vol. The matrix answers the question a calendar trader actually
has — what happens when price and time both move. A calendar is a time-and-vol spread, so
the price×date grid is the native shape of the risk and the curve is one column of it.
Landing on the grid and demoting the curve to a tab is the right default.

**Rows spaced evenly in percent, not in dollars.** A 5% SPX move is the same kind of day
whether SPX is at 4,000 or 7,700. Percent spacing keeps row density constant in the units
a trader reasons in, and it survives the index drifting hundreds of points across a year.

**Date columns that thin with distance.** Aug 25, 28, 31 are dense; Oct 2, 5, 8, 12, 13,
16 are sparse. Resolution goes where decisions happen — the next few sessions, where theta
and gamma move fastest. Evenly spaced columns would either crowd the near term or waste
grid on days where nothing changes.

**The URL is the trade.** No save step, no share id, no row in a table, and the page title
generates from it so links preview correctly. §4. It costs route params and it makes every
trade discussion a link.

**Leg colour as identity, reused everywhere.** Blue for Oct 16, magenta for Nov 30, the
same in the ribbon, on the strike axis, and in the chart. Colour follows the entity, never
its rank. Two series is well inside the count where colour alone is comfortable.

**DTE stated as a set in the header.** `EXPIRATIONS: 52d, 97d` answers "how spread out in
time is this" without arithmetic on two dates, and it is the number driving the theta and
vega asymmetry.

**The alpha-encoded heatmap.** One fixed hue per sign, alpha varying with magnitude,
composited over a near-black ground. No palette lookup, no interpolation, and it
composites correctly over anything. It is the cheapest correct diverging heatmap in this
scan (MEASURED, see [live capture](optionstrat-live-capture.md)). It breaks if the theme
goes light.

**Every cell prints its number.** `10.3k` when it overflows. That is what makes the
colour-only failure mode survivable, and it is why the technique above is safe to copy.

**Emphasising the single largest cell.** In a several-hundred-cell grid it says "if you
read one number, read this one," and it costs no legend and no new colour.

### Weak

**`AVERAGE` hides the most consequential control behind the least informative word.**
Decoded in §2.7: it selects which IV series the multiplier moves. The word tells you
nothing, and the per-expiration options — the ones a calendar needs — are greyed out
until you pay. Two separate readers guessed two different wrong meanings from the
screenshot before the bundle settled it. If a careful reader cannot recover a control's
meaning, a trader glancing during RTH certainly cannot.

**A padlocked `--%` inside a row of computed values.** Net debit, max loss, max profit and
breakevens are all resolved numbers. Chance of profit is a permanent non-answer with a
lock. It breaks the implicit contract of a metric row — that every slot holds a value —
and the reason is a business model, not a data limitation.

**`MAX LOSS` states no domain.** §5.6. It is the S=0 case at the front expiry, and nothing
on screen says so. A trader reads "worst case" and gets a number that describes an
extinction event.

**No vol-surface provenance anywhere.** Nothing on the page says which quotes, which
timestamp, or which interpolation produced any number. For a builder that is unhelpful.
For a monitor it is dangerous — a stale input misprices a live position with no visible
sign.

**Spot is unlabelled while breakeven is labelled.** The dotted vertical at 7,675 carries
no price; the solid cyan breakeven at 7,749.64 does. That inverts the priority a trader
scanning a live chart actually has.

**One flat IV per leg, held constant across the whole matrix.** §5.2. The vendor says so
itself. For the strategy this repo trades, this is the single biggest modelling gap in the
product.

**The liquidity warning is a bare glyph on the pill.** The label exists on hover and in a
tip card (§2.3), so the earlier "no legend at all" reading was too harsh. Still: a status
flag on a dense surface should carry its label where the eye already is.

**Leg quantities are linked by default.** *"By default, OptionStrat links the quantity of
each leg... click the link/unlink icon"* (VENDOR: [FAQ](https://optionstrat.com/faq)).
Users experience it as a bug: *"For multi legged options, if you change the multiplier for
1 leg, it changes for other legs too. So unable to setup butterfly for example"*
(user-reported, 1-star, Apple's public
[review RSS for app 1541714905](https://itunes.apple.com/us/rss/customerreviews/id=1541714905/sortBy=mostRecent/json)).
Ratio-locking is a reasonable default and a bad hidden default. Every leg's quantity must
stay independently addressable, and editing one leg must never silently mutate a sibling.

---

## 7. The gap: it models hypothetical trades only

OptionStrat's answer to "I already own this" is manual overtyping (VENDOR:
[FAQ](https://optionstrat.com/faq)): *"Yes, simply click the price of the stock or option
to change it. Type in what you paid for it and press Enter... Options that are using a
custom price will have a small blue dot next to them... you must save the trade using the
save trade button... if you wish to keep these custom prices next time you open the trade
link."*

There is no broker link, no fill import, no position sync. The FAQ is explicit that
*"We are not a brokerage and trades cannot be executed through our software."* The closest
thing to monitoring is a saved trade: it tracks total return and today's return off the
saved snapshot, and premium adds the highest return and largest loss reached plus a value
graph (VENDOR: [features](https://optionstrat.com/features)). Later additions let you
close individual legs, roll a closed leg while tracking realised versus unrealised
separately, exclude legs without deleting them, and diff a saved trade before saving a
roll (VENDOR: [blog](https://optionstrat.com/blog/options-calculator-improvements)).

All of it runs on hand-typed prices. That is a materially easier and less trustworthy
problem than reconciling real fills — which is the problem that produced a −$319,850 P&L
for a +$395 trade in this repo's own journal.

### What a monitoring surface additionally needs

Everything below is reachable from data this system already stores: paired broker fills,
30-minute RTH snapshots with greeks, term structure, and skew.

| Requirement | Concretely |
|---|---|
| **P&L since entry, as the hero** | One large figure with a sparkline trend behind it. Signed, coloured by direction. The number a glance is for. |
| **Attribution by greek** | A diverging bar or waterfall splitting total P&L into delta, gamma, theta, vega and residual. Diverging colour for polarity, not categorical — these bars encode sign of contribution, not identity. Answers *why* the calendar is up, not just that it is. |
| **Entry marks versus current marks, per leg** | A compact table: mark at entry, mark now, mark P&L, IV at entry versus now. Keyed by each leg's frozen colour. A table, not a plot — this is precise per-leg data. |
| **The path through the matrix** | Reuse the price×date grid unchanged and trace the position's actual walk since entry as a thin trail of ringed dots. One added layer, no new chart type. |
| **Thesis drift** | The trader runs delta-neutral. Thesis is a net-delta band and a term-slope target. Two small meters, each flipping to a reserved status colour with an icon *and* a label when the position walks outside its band. |
| **Time remaining against plan** | Reuse the expiration ribbon and add a thin band beneath showing the planned exit DTE window, so "how much time is left" is a visual gap, not mental subtraction. |
| **Colour frozen at entry** | OptionStrat only holds leg colour stable for one page load. A monitor holds a position for weeks. Assign the colour at entry and never re-derive it from current moneyness or P&L sign. |
| **Provenance on screen** | Which chain source, which timestamp, which model. The cost is a caption. The cost of not having it is silent wrongness in money math. |

**One screen or two?** One, with a Prospective / Position mode toggle. The two views share
the ribbon, the strike axis, the leg colours, the matrix/graph tabs and the metric strip
shell. What differs is which date counts as "now", whether entry marks appear, and whether
the attribution panel is present. Two routes means two copies of the pricing math and two
copies of the colour logic, and this repo has already paid once for two implementations
that drifted.

**Density is not the same in both.** Used beside TradingView on a second monitor, the
glance state needs three things legible from two feet: P&L since entry, a one-line drift
status, and DTE remaining. The per-leg table, the attribution waterfall and the full
matrix are examine-on-demand. A monitoring list shows one compact card per position; a
click expands it to the dense view. The near-black ground and high-chroma leg colours are
right to keep — a light page beside a dark chart glares.

---

## 8. The competitive field

| Tool | The one thing it does better | Evidence |
|---|---|---|
| **OptionStrat** | The price×date matrix as the landing object, with the whole chain in the browser so every control is instant | MEASURED |
| **optionsprofitcalculator.com** | Honest in its own FAQ about its limit: *"Given a constant IV, the calculator will be correct... however since IV is a reflection of market sentiment... it is impossible to predict"* | VENDOR: [FAQ](https://www.optionsprofitcalculator.com/faq.html) |
| **ThinkOrSwim Risk Profile** | Two curves on one graph — blue at expiration, purple at today — driven by one date picker | VENDOR: [thinkManual](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Analyze) |
| **ThinkOrSwim Portfolio Uniform Stress Test** | Sticky-ratio vol stress across a whole portfolio. Not on by default: *"For more information about enabling Portfolio Uniform, Stress Test, please contact chat support"* | VENDOR: same |
| **tastytrade** | Says the quiet part out loud: *"Max Profit: Cannot be determined due to multiple expiration dates"* | VENDOR: [learn](https://tastytrade.com/learn/options/long-put-calendar-spread/) |
| **Option Alpha** | Same honesty for diagonals: *"a payoff diagram is variable and has multiple outcomes depending on when the options trader chooses to exit"* | VENDOR: [put diagonal spread](https://optionalpha.com/strategies/put-diagonal-spread) |
| **Market Chameleon** | A cross-sectional calendar *screener* — filter candidates by DTE per leg, IV rank, premium, max risk, POP | UNVERIFIED — the site blocks automated fetch; this rests on search summaries |
| **Unusual Whales** | Frames the IV slider explicitly as an earnings-crush simulator. One global slider across all legs, and no calendar or diagonal in its named strategy list | VENDOR: [profit calculator](https://unusualwhales.com/lp/options-profit-calculator) |
| **IBKR Performance Profile** | Refuses to draw the curve and warns you: *"For multi-expiry combinations, Performance Profile values may vary within a potentially wide range that is not reflected by the clean lines in a graph... this may result in flipping of the sign"* | VENDOR: [IBKR Campus](https://www.interactivebrokers.com/campus/trading-lessons/performance-profile-for-options-2/) |
| **IBKR Risk Navigator** | Per-leg vol scenarios with three input modes — explicit value, change, percent change. The trader types the number | VENDOR: [IBKR Campus](https://www.interactivebrokers.com/campus/trading-lessons/ibkr-risk-navigator-calculating-the-forward-prices-for-options/) |
| **OptionNet Explorer** | Both jobs in one tool: design and backtest on 5-minute historical data, plus live broker-fed monitoring, with adjustments and commissions folded into a cumulative P&L | VENDOR: [explorer](https://www.optionnetexplorer.com/explorer.aspx), [pricing](https://www.optionnetexplorer.com/pricing.aspx) |
| **OptionStratLib** (Rust, OSS) | Real quant machinery — BSM, Monte Carlo, binomial, second-order greeks, vol-surface construction — and no calendar or diagonal strategy type at all | MEASURED: [README](https://raw.githubusercontent.com/joaquinbejar/OptionStratLib/main/README.md) |
| **optionlab** (Python, OSS) | Small and readable: P&L profile, per-leg greeks, POP, max/min return — all on a single user-defined target date | MEASURED: [README](https://raw.githubusercontent.com/rgaveiga/optionlab/main/README.md) |

### The capability none of them has

**A forward-vol assumption for the back leg, derived from observed term structure, married
to fill-fed tracking of the position since entry, decomposed by greek.**

Every tool does at most one half. They either refuse to draw the multi-expiry curve
(IBKR), or call it unknowable in their own teaching copy (tastytrade, Option Alpha), or
hand the trader one flat vol slider (Unusual Whales, ThinkOrSwim's default profile,
OptionStrat), or ask the trader to type the number in (IBKR Risk Navigator). On the
monitoring side, OPC makes you rebuild the calculation by hand and OptionStrat makes you
overtype the entry price.

Be precise about the exception: **OptionNet Explorer genuinely does both jobs.** It is not
in the gap. What it does not claim is a *derived* forward-vol assumption — practitioners
report it struggles with calendar theta precisely because of the front-back IV
differential, and characterise that as a limit of all such software rather than a bug
(UNVERIFIED — the forum thread is behind a Cloudflare block and this rests on a search
summary. Treat as a lead).

And the open-source engines with the machinery to do it — vol surfaces, full greek suites
— never wired it to a calendar. That is the tell. The gap is not missing math. It is that
closing it requires taking a position on forward vol, which is a forecast, not a formula
lookup.

Morai holds both raw materials already: server-side term structure and skew history, and
30-minute RTH snapshots tied to paired broker fills.

---

## 9. Verdict

Ranked by leverage. Highest first.

### Copy

1. **The price×date matrix as the primary object.** Percent-spaced rows, irregular date
   columns thinning with distance, every cell printing its number, the largest cell
   emphasised. This is the whole reason to study the page.
2. **The URL as the trade.** §4. Cheapest high-value thing on the list — route params, no
   storage, no share id, and it composes with the MCP tools this repo already has.
3. **Client-side repricing over the shared kernel.** Their instant sliders come from
   shipping the chain once. This lane already exists here (`apps → quant`,
   `scenario-engine.ts`) and the rule is one implementation, one input set, both sides.
4. **Leg colour as identity, assigned once, reused everywhere** — and frozen at entry for
   the life of a monitored position.
5. **The alpha-encoded heatmap technique.** One hue per sign, alpha by magnitude. Keep the
   technique; see below on the hues.
6. **Native `<table>` for the matrix, no canvas, no virtualisation.** A few hundred cells
   is an order of magnitude under where canvas starts paying, and virtualising an
   interactive grid risks breaking screen-reader table navigation for nothing.
7. **DTE as a set in the header** — extended for monitoring to show entry and current
   together, `52d/97d → 23d/68d`.

### Improve on

1. **Put the vol assumption on screen and make it free.** This is the highest-leverage
   departure. Their `AVERAGE` dropdown hides which IV the slider moves, and per-expiration
   control costs $39.99/mo. Name the regime explicitly — sticky strike, sticky delta,
   sticky tree (§5.3) — and name the time-axis convention explicitly — frozen IV or curve
   roll (§5.4). This system already tracks the term structure and skew that make a derived
   forward-vol assumption possible instead of a slider. That is the axis where it is
   structurally better than OptionStrat, and the only one where copying would be a
   downgrade.
2. **Lead with monitoring, not building.** OptionStrat's information architecture is
   builder-first because it has nothing else. Copying that order means under-investing in
   the screen where this system has data OptionStrat structurally cannot have, and where
   being wrong costs the most. §7.
3. **Split MAX LOSS in two.** Structural bound (= the debit) and worst modelled P/L over a
   stated domain under a stated assumption. Never one word for both. §5.6.
4. **State the time-of-day convention in the UI.** OptionStrat runs three conventions in
   one product and documents them in a FAQ. Market open, market close and "the picked
   date's start" all give different numbers for the same trade. §5.7.
5. **Extract the forward from put-call parity per expiration.** Do not set `q = 0` and do
   not assume a constant index dividend yield. §5.1.
6. **Swap the diverging hues.** Red/green is the worst pair for the most common colour
   vision deficiency. ColorBrewer's RdBu-11 is colourblind-safe with published stops:
   `#67001f, #b2182b, #d6604d, #f4a582, #fddbc7, #f7f7f7, #d1e5f0, #92c5de, #4393c3,
   #2166ac, #053061`, white at zero
   ([d3-scale-chromatic source](https://raw.githubusercontent.com/d3/d3-scale-chromatic/main/src/diverging/RdBu.js),
   [ColorBrewer](https://colorbrewer2.org/)). Keep red as loss. The leg-identity
   blue/magenta needs no change — that pair is already distinguishable. Keep the printed
   value in every cell regardless; it is carrying the load colour cannot.
7. **Label the status flags.** Icon *and* label, in a reserved status colour distinct from
   the leg palette. Their thresholds are a fine starting point (§2.3), but on a glance
   surface the label goes where the eye already is.
8. **Compute chance of profit properly, or omit it.** Breeden-Litzenberger off the real
   chain, with lognormal-from-ATM as a documented fallback when the ladder is too sparse.
   Label it risk-neutral. Never ship a permanent `--%`.
9. **Label the spot line.** It is the most important vertical on a live chart.
10. **Show provenance.** Source, timestamp, model. A caption.

### Skip

1. **Their vol model.** Flat constant IV per leg is the thing being replaced, not copied.
2. **Bjerksund-Stensland.** SPX and SPXW are European and cash-settled. Their own code
   dispatches to plain Black-Scholes for European series (§5.1). BSM is correct here, not
   a compromise.
3. **A responsive squeeze of this layout.** Build it desktop-only. This is a dense terminal
   panel — scrollable ribbon, draggable pills, paged metric strip, twenty-column grid, two
   sliders and a dropdown all visible at once. This repo already learned that responsive is
   not mobile design and ended up with a separate mobile tree. And with TradingView now the
   live cockpit, whether a web UI gets rebuilt at all is unresolved. Do not build a mobile
   IA against an unsettled question.
4. **Paywall furniture.** Padlocks, `--%` placeholders, upgrade rows. Someone else's
   business constraint with none of the reason for it.
5. **The strategy zoo.** They ship 53 routes and render 72 named strategies. This is a
   two-structure system: calendars and diagonals, mostly puts. Every extra template is a
   surface to get wrong.
6. **Delta-as-probability anywhere.** A retail heuristic, not a computation to build on.
7. **Options flow, Congress and insider feeds.** A different product with different data
   contracts.

---

## Open items

- The chain payload's binary format is undecoded (MEASURED as high-entropy, not JSON).
- The 335-cell DOM count versus the ~420-cell screenshot shape is unreconciled.
- The table's market-open column convention and the graph scrubber's settlement-time
  convention are different, and OptionStrat documents only the first.
- The variance-risk-premium magnitude in §5.5 rests on search summaries, not a fetched
  paper.
- Their European branch appears to discount the carry twice: `getPrice` does
  `S *= exp(-q·T)` and then passes `q` into `d1`, which subtracts it again. Harmless at
  `q = 0`, which is every non-future. Live for futures options, where `q = r`. Not our
  instrument, so not chased — but it matters to anyone benchmarking their /ES numbers.
- Reddit and Trustpilot were unreachable (403 and an AWS WAF challenge, via both curl and
  a live browser). Complaint signal in this teardown comes from the Apple review RSS feed
  only, and that is not the same corpus.
