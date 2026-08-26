# OptionStrat — live capture

Measured against the live site on 2026-08-25 by driving Chrome and reading the wire.
Everything here is **observed**, not inferred. Where something is inference it says so.

Page under test:
`https://optionstrat.com/build/calendar-put-spread/SPX/-.SPXW261016P7425,.SPXW261130P7425`

Site version string in the footer: `© 2025 OptionStrat, LLC | v1.5`.

---

## 1. The headline finding: it is a fat client

The whole page makes **two data requests**. That is all.

| Request | Response |
|---|---|
| `GET /api/underlyings` | 200 |
| `GET /api/quote/chain/delayed?symbol=SPX` | 200, `content-type: application/octet-stream`, **500,810 bytes** |

Everything else on the wire is Sentry, Google Analytics, a Mixpanel proxy (`/api/mp/track`), and a Cloudflare bot challenge.

So: **the entire SPX option chain is shipped to the browser once, and every number on the page is computed in the browser from it.** The profit matrix (335 measured price cells), the payoff curve, the greeks, the breakevens, the IV slider, the date scrubber — none of them round-trip. That is why the sliders feel instant.

Supporting measurements:

- **No WebAssembly.** `performance.getEntriesByType('resource')` returns zero `.wasm` entries.
- **No web worker.** Zero worker resources loaded. The pricing runs on the main thread.
- Total JS transferred: **545 KB** across 25 chunks. Basis: summed `transferSize` over `performance.getEntriesByType('resource')` entries matching `.js` — compressed bytes over the wire, initial load only. It is not the uncompressed parse size, and it excludes anything lazy-loaded after first paint.
- Total DOM nodes on the built page: **3,422**.

### The chain payload is deliberately obfuscated

The chain response is not JSON. `JSON.parse` fails on it, and the first bytes are high-entropy:

```
first 32 bytes: e6 73 a4 bc d9 ad 68 4c 68 99 f3 27 e1 b1 b9 3d
                fd 93 b9 b6 22 73 17 23 7a 0f 03 c3 48 62 b7 1c
```

Response headers carry a custom `x-protect: 1`. Served `cache-control: public, max-age=60`, through CloudFront (`x-amz-cf-pop: DFW59-P4`) behind Cloudflare (`server: cloudflare`).

Reading this as anti-scraping: they are a licensed OPRA vendor (see §4) and redistributing a plain-JSON full chain would be giving the data away. The decode key lives in the JS bundle, so it is defeatable, but the intent is clear.

**What this means for us:** we do not have this problem. We already own our chain data and our own API. The architectural lesson is the shape, not the encryption — *ship the chain once, price in the client.*

---

## 2. Stack, fingerprinted in bytes

| Layer | What it is | How it was matched |
|---|---|---|
| Framework | **Next.js, Pages Router** | `__NEXT_DATA__` present; `/_next/static/chunks/pages/...`; buildId `w5R0W-8076cD6Fi8dQ1Ce` |
| Route | `/build/[definition]/[[...symbol]]` | read from `__NEXT_DATA__.page` |
| SSR data | **none** | `pageProps` keys are only `_sentryTraceData`, `_sentryBaggage`, `article` — 766 bytes total |
| Styling | **CSS Modules** | class names like `StrategyTable_table__price--large__AGvCX`, `SeriesSelector_table__month__SmcyL`, `Slider_ticks__O7fi1` |
| Not Tailwind | confirmed | no utility-class fingerprints anywhere in the DOM |
| Errors | **Sentry** | `sentry.javascript.nextjs/9.11.0` |
| Analytics | **GA4** (`G-P1EDH40H3Z`) + **Mixpanel** via first-party proxy | `/api/mp/track/?verbose=1&ip=1` |
| Edge / CDN | **Cloudflare** in front of **CloudFront** | `cf-ray`, `x-amz-cf-id` |

The route pattern is worth noting: `[definition]` is the strategy slug and `[[...symbol]]` is an optional catch-all that carries the symbol *and* the encoded legs. One page component serves all 72 strategies.

---

## 3. How the two views are actually rendered

### The profit matrix is plain DOM in a CSS Grid

The table element (`StrategyTable_table__*`) has **509 children** and `display: inline-grid`.

Computed `grid-template-columns` — 21 tracks, a wide gutter then 20 equal date columns:

```
74.91px  53.75px × 20
```

Child class histogram: 335 price cells, 171 structural, 1 underlying marker, 2 unclassed.

The screenshot reads as roughly 21 price rows by 20 date columns, which would be 420 cells. The DOM says 335. The gap is unexplained — most likely the grid is virtualised at the edges, or rows scrolled out of view are not mounted. Recorded as measured, not reconciled.

**There is no `<canvas>` anywhere on the page.** A 400-cell grid of divs is well inside what the DOM handles comfortably; they did not reach for canvas and did not need to.

### The heatmap is one hue with variable alpha

Sampled cell backgrounds:

```
rgba(144, 0, 30, 0.410)   -2,227
rgba(144, 0, 30, 0.424)   -2,281
rgba(144, 0, 30, 0.427)   -2,313
rgba(144, 0, 30, 0.443)   -2,391
```

The colour is **fixed per sign** and only the **alpha** varies with magnitude. Over a near-black background this produces a smooth diverging ramp for free, with no colour-scale interpolation and no palette lookup. It is the cheapest correct implementation of a diverging heatmap I have seen, and it composites correctly over any background.

*Caveat for us:* alpha-on-dark means the encoding collapses if the theme goes light, and a pure red/green split is the worst case for the most common colour-vision deficiency. Worth copying the technique, not the two hues.

### The payoff chart is hand-built SVG

The chart SVG has **507 children**. Element types present:

```
defs, linearGradient, stop, mask, rect, g, text, line, polygon
```

The filled curve is a `<polygon>` filled with a `<linearGradient>` and clipped by a `<mask>` — that is how the green-above / red-below gradient fade is done. No `<path>` in the sampled set, so the curve is drawn as a point list rather than a bezier. No charting library fingerprint was matched.

---

## 4. What OptionStrat says about its own model — verbatim

Pulled from the `FAQPage` JSON-LD on `https://optionstrat.com/faq` via curl, so these are exact, not paraphrased.

### The pricing model

> "We use the **Bjerksund-Stensland (2002) American options model** for our theoretical price and greeks calculations. It provides more accurate modeling of options compared to the European Black-Scholes model that competitors use. European models do not consider the early-exercise possibility of American options, which leads to errors in their charts."

**This is a real finding, and for our use case it cuts the other way.** SPX options are **European and cash-settled**. There is no early exercise. Bjerksund-Stensland is an American approximation; applied to a European option it converges to Black-Scholes but is an approximation of a thing we can compute exactly. For SPX specifically, plain BSM is not the inferior choice they describe — it is the correct one. Our existing BSM engine is right for our instrument.

### The time-of-day convention

> "The table calculations show the estimated price at **market open**, except for the current date and expiration date. On the **current day**, the estimate is for the current time. On the **expiration day**, the estimate is for market close. If it's possible to fit an extra column, the market open of the expiration day is also shown."

This is the single most under-documented thing in every payoff tool, and it is why two tools disagree on the same trade. Note it **differs from ThinkOrSwim**, whose date line is the picked date's *start*. Three conventions, three answers, same trade.

Whatever we build must state its convention on screen, not in a FAQ.

### The volatility assumption — they hold IV constant

> "**Implied volatility is never constant through the life of an option**, so we recommend that you move the IV slider to see how changes in implied volatility will affect your trade (especially if you are trading around earnings)."

So the model is: **flat, constant IV per leg, held fixed across the whole matrix.** There is no sticky-strike or sticky-delta rule, and no roll up the term structure as DTE decays. The IV slider is not a model — it is a manual sensitivity knob handed to the user, with the modelling problem handed over with it.

For a vertical that is defensible. **For a calendar it is the whole game**: the two legs sit at different points on the term structure, and a single flat vol cannot be right for both. This is the biggest gap in the tool for our strategy.

And note what it costs to fix it there — "**Adjust IV per expiration**" is a **paid** feature (see §5). The one control a calendar trader most needs is behind the paywall.

### Entry price convention

> "The entry cost/credit of a trade defaults to the **mid of the bid/ask** and does not account for any brokerage fees. You can select 'bid/ask' to use the ask price for long options, and the bid price for short options, which may better reflect the price you will get filled at."

Mid by default, with an opt-in to the pessimistic side. Commissions are a paid feature.

### Events are not modelled

> "While some market events like earnings and ex-dividend dates are shown for informational purposes to premium users, **they are not accounted for in the calculation**."

### Data provenance

> "OptionStrat is a **licensed OPRA vendor** (meaning we receive the same data that your trading platform does!). Data is **delayed 15 minutes by default**, but live auto-updating data can be purchased."

### Entering an existing position

> "Yes, simply click the price of the stock or option to change it. Type in what you paid for it and press Enter... To access the option editing menu, right click an option (on desktop) or tap it (on mobile)."

This is their entire answer to "I already own this trade": overtype the entry price by hand. There is no fill import and no position history. It is a builder with a manual override, not a position monitor.

### Other operational answers

- **Unbalanced legs:** "By default, OptionStrat links the quantity of each leg... click the link/unlink icon" — quantities are linked as a ratio until you break the link.
- **Why some metrics are unselectable:** "% of Entry Cost can only be calculated for *net debit* strategies. % of Max Risk can only be calculated for strategies that have a defined risk."
- **Futures:** /ES, /NQ, /SR1 and others supported, always 15-minute delayed.

---

## 5. Pricing and what is gated

Two paid tiers, monthly or annual (annual "Save 12%"). Rated **4.6 / 5 over 3.3k reviews**.

| Tier | Price |
|---|---|
| Free | delayed data, limited access to each feature |
| **Live Tools** | **$39.99/mo** |
| **Live Flow** | **$99.99/mo** |

Gated behind a paid tier, verbatim from the membership page:

| Feature | Their description |
|---|---|
| Live prices | "Get current stock and option prices without any delay." Free tier is delayed. |
| **Chance of profit** | "View the chance of profit and probability distribution in the optimizer and visualizer." |
| **Net greeks** | "See the combined greeks for multi-leg strategies **and greeks charted over time on the table and chart**." |
| **IV enhancements** | "**Adjust IV per expiration** and view IV history" |
| **Saved strategy tracking** | "See the **high, low, and historical graph** of each of your saved strategies. Saved strategies can also be exported." |
| Commissions | "Add commission fees to strategy calculations." |
| Market events & news | earnings, ex-dividend, news overlaid on the trade |
| Volume overlay | "Volume chart showing the most active strikes for calls and puts." |

Two of these matter to us disproportionately:

1. **"Adjust IV per expiration"** is the calendar-critical control, and it is paid. Their free product cannot model our strategy honestly.
2. **"Saved strategy tracking"** is their entire position-monitoring story, and it is thin: high, low, and a value graph. No entry snapshot, no greek attribution, no path. This is the gap we already have the data to fill.

Also stated: live data is unavailable to professional/registered users for licensing reasons.

---

## 6. Strategy coverage

72 named strategies, grouped by skill tier then by family. Full list as rendered:

- **Novice** — Basic: Long Call, Long Put. Income: Covered Call, Cash-Secured Put. Other: Protective Put.
- **Intermediate** — Credit spreads: Bull Put Spread, Bear Call Spread. Neutral: Iron Butterfly, Iron Condor, Long Put Butterfly, Long Call Butterfly. **Calendar spreads: Calendar Call Spread, Calendar Put Spread, Diagonal Call Spread, Diagonal Put Spread.** Debit spreads: Bull Call Spread, Bear Put Spread. Directional: Inverse Iron Butterfly, Inverse Iron Condor, Short Put Butterfly, Short Call Butterfly, Straddle, Strangle. Other: Collar.
- **Advanced** — Naked: Short Put, Short Call. Neutral: Short Straddle, Short Strangle, Long Call Condor, Long Put Condor. Ratio spreads: Call Ratio Backspread, Put Broken Wing, Inverse Call Broken Wing, Put Ratio Backspread, Call Broken Wing, Inverse Put Broken Wing. Income: Covered Short Straddle, Covered Short Strangle. Directional: Short Call Condor, Short Put Condor. Ladders: Bull Call Ladder, Bear Call Ladder, Bull Put Ladder, Bear Put Ladder. Other: Jade Lizard, Reverse Jade Lizard.
- **Expert** — Ratio spreads: Call Ratio Spread, Put Ratio Spread. Synthetic: Long Synthetic Future, Short Synthetic Future, Synthetic Put. Arbitrage: Long Combo, Short Combo. Other: Strip, Strap, Guts, Short Guts, **Double Diagonal**.

Note the taxonomy does double duty: it is a picker *and* a teaching device, tagging each strategy bullish / bearish / neutral and limited / unlimited profit and loss. The category colour classes are in the markup (`StrategyChooser_definition--income`, `--bullish`, `--bearish`, `--neutral`).

---

## 7. The URL is the trade

```
/build/calendar-put-spread/SPX/-.SPXW261016P7425,.SPXW261130P7425
        └─ definition ──┘  └sym┘ └──── legs, comma-separated ────┘
```

Per leg: an optional leading `-` for a short leg, then `.`, then the OCC-style contract `ROOT + YYMMDD + P|C + STRIKE`. So `-.SPXW261016P7425` is short one SPXW 2026-10-16 7425 put, and `.SPXW261130P7425` is long the 2026-11-30 7425 put.

The page title is generated from it server-side — the document title came back as *"SPX Oct 16th - Nov 30th 7425 Calendar Put Spread"* — so a shared link previews correctly without any stored state.

**This is worth copying outright.** No database row, no share ID, no expiry. The trade *is* the URL. It costs nothing and it makes every trade discussion a link.

---

## 8. What this changes for our build

Directly actionable, ranked:

1. **Ship the chain, price in the client — and note we already do this legally.** Their whole responsiveness story is one payload and zero round-trips.

   This does **not** conflict with commit `1baceaa` ("delete the browser's copy of the math"), and it is worth being exact about why, because the two are easy to confuse. That commit deleted `chain-math.ts`, a browser **twin** of logic that already existed in `core`. The twin was wrong not because it ran in the browser but because it ran on **different inputs**: a per-expiry `(r, q)` instead of the one carry the stored `bsm_iv` was inverted at, `rows[0].underlyingPrice` instead of the lower median of usable quotes, and each row's own `observedAt` instead of a single instant. Two implementations, two input sets, two answers.

   Client-side pricing over the **shared kernel** is a different thing and is already the sanctioned architecture here:
   - `eslint.config.js:94` explicitly allows `apps → quant`, commented *"apps/web imports quant for client-side BSM live re-pricing (D21)"*.
   - `apps/web/src/lib/scenario-engine.ts` already does exactly this: *"Client-side scenario re-pricing over @morai/quant … no API round-trip (D-01)"*.
   - `packages/quant` has **zero runtime dependencies** — devDeps only. It is a pure leaf and ships anywhere.

   So the rule to carry forward is not "math lives on the server". It is: **one implementation of the math, one set of inputs, shipped to both sides.** The server owns the chain and the model parameters — carry, spot, clock — and hands them over with the data. The client re-prices the grid from that. No boundary change is needed; the lane already exists and is already used.
2. **Use BSM, and say so.** They use Bjerksund-Stensland because they price American equity options. We trade European cash-settled SPX. Our existing BSM engine is the correct model for our instrument, not a compromise.
3. **Put the vol assumption on screen.** Their "AVERAGE" dropdown hides the most consequential assumption behind a word, and per-expiration IV is a paid upgrade. For a calendar, per-leg vol *is* the model. Make it visible and free.
4. **State the time-of-day convention in the UI.** Market open, market close, and "picked date's start" all give different numbers for the same trade. Ours must be legible without a FAQ.
5. **Copy the URL-as-trade encoding.** Cheap, and it makes trades shareable and bookmarkable with no storage.
6. **Copy the alpha-encoded heatmap technique**, but not a bare red/green pair.
7. **Build the thing they don't have.** Their position tracking is high, low, and a value graph. We already store 30-minute RTH snapshots with greeks — entry snapshot, P&L decomposed by greek, and the actual path the position took are all reachable from data we hold and they never will.

---

## Method note

Captured by driving Chrome directly: `new_page` on the target URL, then `list_network_requests` filtered to xhr/fetch/websocket, then in-page `evaluate_script` for `performance` resource timings, `__NEXT_DATA__`, computed styles, and DOM structure. The FAQ text was pulled with `curl` and read out of the page's `FAQPage` JSON-LD rather than through any summarizer, so the quotes are exact.

Not captured, and still open: the decode format of the binary chain payload, and a direct measurement of recompute latency when a slider moves. The browser tab was in use by a parallel research agent before those tests completed. Neither changes any conclusion above — the two-request load already establishes that no recompute touches the network.
