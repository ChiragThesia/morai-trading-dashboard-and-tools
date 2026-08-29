# TradingView Watchlists — SPX Calendar Spreads

Built 2026-08-19. Every symbol below was verified live on the desktop app (quote returned
a fresh timestamp), not merely found in symbol search. Thresholds match
`tools/tradingview/vol-state.pine`, which is the authority — a watchlist row that disagrees
with the study is a bug, not a second opinion.

## Answer: three lists, not one

A calendar entry is three separate questions and they fire on different clocks. One 39-row
list forces you to scroll past macro context to read the vol decision, which is the row that
actually gates the trade.

| List | Question it answers | Rows |
|---|---|---|
| `CAL 1 - Vol Engine` | Should I be in a calendar at all? | 16 |
| `CAL 2 - Tape and Flow` | Where is spot, is the tape one-sided? | 14 |
| `CAL 3 - Macro Risk` | What blows up my back month? | 17 |

Only CAL 1 holds decision-grade rows. CAL 2 and CAL 3 are context — they veto, they never
trigger. The research pass validated this posture by absence: not one claim in the corpus,
confirmed or refuted, addressed NYSE TICK, ADD, TRIN, PCC, PCCI, MOVE, 2s10s, DXY or HYG/LQD
credit spreads. That is absence of evidence, not evidence of absence — which makes
context/veto-only the correct default for both lists rather than a concession.

## CAL 1 — Vol Engine

```
2*CBOE:VIX6M*CBOE:VIX6M-CBOE:VIX*CBOE:VIX
CBOE:VIX3M/CBOE:VIX
TVC:VIX
CBOE:VIX1D
CBOE:VIX9D
CBOE:VIX3M
CBOE:VIX6M
CBOE:VIX9D/CBOE:VIX
CBOE:VVIX
CBOE:VVIX/CBOE:VIX
CBOE:VX1!
CBOE:VX2!
CBOE:VX2!-CBOE:VX1!
CBOE:VXN
NASDAQ:SDEX
CBOE:COR1M
```

Not every row here is equal. After the research pass (see below), only the first two carry
primary-source evidence; the rest are context that happens to live on the vol list.

### Decision-grade

**`2*CBOE:VIX6M*CBOE:VIX6M-CBOE:VIX*CBOE:VIX`** — the closest computable form of the only
term-structure measure with published predictive evidence for long-vega timing. Johnson
(JFQA 52(6), 2017) tests differences of implied **variances** across the long end of the curve
and names `2*VIX²(12m) - VIX²(1m)` as the preferred variant, because the naive difference is
-68% correlated with the *level* of the curve. TradingView's longest CBOE tenor is 6M, so this
is 6M-for-12M — directionally the tested object, short of its endpoint. Reads ~657 today.

**How to use it: percentile, not level.** The evidence supports no absolute threshold at all.
Johnson's operational rule is an *expanding*-window percentile of the measure's own history —
bottom quintile favours long vega, otherwise short it. Grepping the paper for "contango" or
"backwardation" returns zero hits. So this row needs history, not a line in the sand: chart it,
and read where today sits in its own distribution.

**MEASURED 2026-08-25: the 6M-for-12M substitution costs de-trending, and we KEEP `k=2` anyway.**
Johnson's whole reason for the `2*` is that the naive difference is contaminated by the *level*
of the curve (he reports -68%). The coefficient is the forward-variance weight for a 2:1 tenor
ratio — 12m over 6m. Carried onto a 6M long leg with a 1M short leg, that ratio no longer holds,
so the de-trending does not transfer. Correlation of each candidate with the level of VIX,
CBOE daily closes, n=4,258, 2009-09 to 2026-08:

| measure | full | 08-11 | 12-15 | 16-19 | 20-23 | 24-26 |
|---|---:|---:|---:|---:|---:|---:|
| `2*VIX6M² - VIX²` (this row) | +0.575 | +0.562 | +0.521 | +0.296 | +0.249 | +0.207 |
| `1.485*VIX6M² - VIX²` (fitted) | +0.152 | +0.103 | +0.291 | −0.228 | −0.337 | −0.333 |
| `2*VIX6M² - VIX3M²` (3m→6m fwd) | +0.831 | +0.833 | +0.707 | +0.741 | +0.775 | +0.757 |
| `VIX6M/VIX` (scale-free) | −0.734 | −0.852 | −0.629 | −0.892 | −0.829 | −0.844 |

A full-sample fit gives `k = 1.485` and nulls the correlation to +0.000 — but **that constant is
not stable**: refit per period it runs 1.700 / 1.168 / 1.676 / 1.765 / 1.782, and the resulting
measure *flips sign* against the level across the sample. A consistently-signed bias is less
damaging to a percentile-ranked series than one that inverts, because ranking absorbs part of a
steady tilt and nothing absorbs a sign flip.

The 3m→6m forward-variance form looks principled — it restores the exact 2:1 tenor ratio — and
measures **worst of all** at +0.83. Scale-free ratios are worse still: dividing by VIX makes the
measure fall mechanically as VIX rises.

So: no candidate is both near-zero and stable. `k=2` stays because it is the only one carrying
published evidence, its bias is at least consistently signed, and that bias has been *shrinking*
(+0.56 → +0.21 across the sample). **Read the row knowing it is part level, not pure slope** —
which is one more reason the operational rule is a percentile of its own history rather than a
threshold.

**Related, and uncomfortable:** `VIX3M/VIX` — the TERM gate — measures **−0.660** against the
level and is very stable there. That gate is substantially a level proxy. It is practitioner-
calibrated on your own fill history so it earns its keep empirically, but do not describe it as
a pure slope measure.

**`CBOE:VIX3M/CBOE:VIX`** — TERM, defined as `vol-state.pine` defines it (VIX3M over VIX). Its
thresholds are **practitioner calibration inherited from `entry-gate.ts`, not literature**:
`<= 1.053` block, `<= 1.111` penalty. Keep using them — they encode your own fill history — but
do not cite them as evidence-backed.

VIX gates from the same file: `>= 25` blocks, `>= 20` penalty, VIX percentile `>= 80` penalty.

### Context only — do not trigger on these

- `CBOE:VVIX`, `CBOE:VVIX/CBOE:VIX` — the one validating paper (Park, J. Financial Markets 26,
  2015) tested 8-90 DTE options and says in its own footnote 7 that results are **weaker for
  long-dated options** — exactly the leg a calendar owns. Every numeric VVIX band was refuted
  3-0 during verification. No gate level is quotable.

  **MEASURED 2026-08-25 and refuted a fourth time.** During this session I told you a high VVIX
  roughly doubled the 2σ breach rate on the expected-move band at the same VIX level, and
  proposed wiring it into `expected-move.pine` as a "trust this width less today" flag. That was
  wrong, and the error was mine: `backtest-expected-move.ts` built its band from the PRIOR
  close but tagged each session with VVIX read at THAT DAY'S close. A large move raises VVIX
  the same day, so the split was conditioning on the answer. Re-tagged at the prior close —
  the only value a non-repainting study can read — the effect is gone:

  | tag read at | VIX-high tercile, VVIX low | VIX-high tercile, VVIX high |
  |---|---:|---:|
  | prior close (honest) | 2.95% breach | 3.07% breach |
  | same day (contaminated) | 3.07% breach | 5.18% breach |

  Identical days, n = 848 per cell. Within VIX deciles, prior-day VVIX against mean&#124;z&#124;
  gives **t = +1.18 on n = 5,088** — a well-powered null. The regime board's original
  "double-counts VIX" call stands; nothing was built. `backtest-expected-move.ts` §3b now prints
  both taggings side by side so the claim cannot quietly return.
- `NASDAQ:SDEX`, `CBOE:COR1M` — **zero surviving evidence in the corpus, in either direction.**
  Nothing addressed skew or implied correlation for index calendars. They stay as context.
- `CBOE:VIX9D/CBOE:VIX` — front-end stress tell, under 1.0 means no near-dated panic bid. Not a
  tested predictor: Johnson's tenor grid has no 9-day point.
- `CBOE:VX1!`/`VX2!` resolve to `CBOE_DLY:` — **delayed feed**, fine for regime, useless for
  execution timing.

**`CBOE:VX2!-CBOE:VX1!` is NOT the futures version of `VIX3M/VIX`.** An earlier draft of this
file said it was; that is wrong. On 2024-08-05 spot VIX printed ~66 pre-market while front VIX
futures stayed under 35, and BIS Bulletin 95 records the spot-versus-front-futures gap hitting
a **record high**. Both series signalled backwardation that morning; they disagreed violently on
magnitude. A threshold calibrated on one and ported to the other would have been badly wrong on
size. Related signal, different market — never cross thresholds between them.

The only published numeric term-structure gate found anywhere was Simon & Campasano's `±0.10`
daily roll — and it is defined as *(front VIX future − spot VIX) ÷ business days to settlement*,
which is **not** what `VX2!-VX1!` computes. It also governs an ES-hedged directional VIX futures
position, its sample ends 2011, and Quantpedia's own out-of-sample run reports negative
performance. Do not port it here.

VRP (`VIX / realized`) has no watchlist row. A watchlist cannot compute realized vol — read it
off the `vol-state` pane, which already plots it.

## CAL 2 — Tape and Flow

```
SPCFD:SPX
CAPITALCOM:SPX500
CME_MINI:ES1!
AMEX:SPY
NASDAQ:QQQ
NASDAQ:NDX
CME_MINI:NQ1!
USI:PCC
USI:PCCI
USI:PCCE
USI:ADD
USI:TICK
USI:TRIN.NY
AMEX:RSP/AMEX:SPY
```

**`SPCFD:SPX` and `CAPITALCOM:SPX500` are not duplicates — keep both.** Verified on bar data:
`SPCFD:SPX` runs 09:30-16:00 ET with a 17.5-hour overnight gap (RTH only), while
`CAPITALCOM:SPX500` has unbroken 30m bars at 22:00, 02:30 and 08:30 ET (max gap 1800s, 24/5).
This matters more than it looks, because `CME_MINI:ES1!` resolves to a **delayed** feed — so
SPX500 is the only real-time overnight read on the index, which is precisely the gap risk
against a short strike you carry into the next session.

`USI:PCCI` (index put/call) is the one to watch over `USI:PCC` — you trade the index, and index
flow is where the front-month bid shows up first. `USI:PCCE` (equity-only) earns its row as the
divergence partner: retail equity flow pulling away from index hedging is a different tape than
both moving together. `USI:ADD` and `USI:TICK` catch the case where SPX is green on a thin tape;
internals rolling over while price holds is the setup that walks spot away from your strike.

`CME_MINI:NQ1!` covers overnight Nasdaq (also delayed). It replaces the original `IG:NASDAQ` CFD
— canonical instrument over a broker feed, and Nasdaq is context here, not the traded book, so
the delay is acceptable. If real-time overnight Nasdaq ever matters, put `IG:NASDAQ` back.

## CAL 3 — Macro Risk

```
TVC:MOVE
TVC:US02Y
TVC:US10Y
TVC:US30Y
TVC:US10Y-TVC:US02Y
100-CBOT:ZQ1!-(100-CBOT:ZQ2!)
CBOT:ZQV2026-CBOT:ZQU2026
FRED:BAMLH0A0HYM2
AMEX:HYG
AMEX:LQD
NASDAQ:TLT
TVC:DXY
TVC:GOLD
FX:USOIL
VELOCITY:BRENT
ECONOMICS:USIRYY
ECONOMICS:USCCPI
```

You are long back-month vega. Rate vol leads equity vol, so `TVC:MOVE` rising while VIX sits
still is the early warning that the back month you own is about to reprice. `FRED:BAMLH0A0HYM2`
(HY OAS) and `AMEX:HYG` are the credit tripwire.

**Both ZQ spreads belong here, and they are not redundant.** They print the same number today
only because `ZQ1!`/`ZQ2!` currently map to those months. `100-CBOT:ZQ1!-(100-CBOT:ZQ2!)` is
continuous and **rolls**, so it always shows the front Fed-repricing gauge.
`CBOT:ZQV2026-CBOT:ZQU2026` is dated and **does not roll**, so it stays pinned to one specific
FOMC meeting — the correct instrument when the meeting is the event inside your back month.

**`VELOCITY:BRENT` is not a duplicate of `FX:USOIL`.** Brent and WTI are different grades:
93.90 vs 86.60 as of writing, a $7.3 spread that is itself the macro read. Only `BLACKBULL:WTI`
was a true duplicate (WTI CFD, same as `FX:USOIL`) and it stays cut.

`ECONOMICS:USIRYY` / `USCCPI` update monthly, so they never move intraday — they are a
regime-reference glance, not a live signal. Two rows is cheap for that.

## What the research changed (2026-08-19, 102-agent deep-research pass)

Headline: **nothing in the corpus is decision-grade for calendar spreads on direct evidence.**
Every validated result is measured on a different instrument — Johnson on synthetic
constant-maturity straddles and variance swaps (the paper never studies calendars),
Bollerslev-Tauchen-Zhou on quarterly index excess returns, Park on OTM SPX puts and VIX calls,
Simon-Campasano on VIX futures. Treat the tiering above as the best available inference, not
as proof.

Three findings worth acting on beyond the watchlist:

**1. The percentile discipline is on the wrong measure.** `vol-state.pine` percentile-ranks VIX
(`pctLb=252`, blocks at `vixPct >= 80`) — a measure the evidence does *not* support as a slope
signal — while gating TERM on fixed absolute levels, which is the measure it *does* support and
where the evidence explicitly calls for an expanding-window percentile instead. The asymmetry is
backwards. Adding a percentile arm to TERM is the single highest-value change to that file.

**2. The VRP realized leg uses the construction shown to be the weak one.** RFS 22(11) (2009) is
blunt: results "depend crucially on the use of model-free, as opposed to Black-Scholes, options
implied volatilities, along with accurate realized variation measures constructed from
high-frequency intraday as opposed to daily data." Adjusted R² is **6.82% intraday versus 2.16%
daily**. The pine's implied leg is already correct (VIX is model-free), but its realized leg is
`ta.stdev(log(close/close[1]), 20)` on **daily** bars — the weak form. This project already
collects 30-minute RTH snapshots, and Pine can request a 30m series inside `request.security`,
so the stronger construction is reachable. No published VRP threshold exists; the `1.0` line is
an identity and `1.3` is a practitioner reference, not literature.

**3. Ratios and variance-differences are not interchangeable under a percentile rule.**
`VIX3M/VIX > 1` iff `VIX3M² - VIX² > 0`, so the two agree on sign — but they *rank days*
differently. VRP 1.3 occurs at VIX 13/RV 10 (variance spread 69) and at VIX 39/RV 30 (spread
621). Under an absolute threshold that only shifts calibration. Under the expanding-percentile
rule the evidence supports, it changes which days land in the bottom quintile. Pick one form per
signal and percentile-rank that one; do not treat them as the same object.

Two smaller notes: the slope predicts **the P&L of a vol position, not the path of VIX** — a
flattening curve is your long leg repricing, never a forecast that VIX will move. And pre-market
VIX prints are structurally noisy (Rhoads: across 2,094 sessions the daily VIX high fell
pre-market 803 times, ~1 in 3), which sharpens the existing warning in the pine header that an
alert means *go look*, not *signal fired*.

One counter-hypothesis, deliberately not acted on: a retail source argues high-IV calendars work
as a term-structure-reversion trade rather than a theta trade, which would put the pine's double
block (`vix >= 25` **and** `term <= 1.053`) directly in the way of a real setup. The source never
measures term structure at all — it buckets by VIX *level* — its metric is touch-frequency rather
than P&L, its 1,200 entries are overlapping daily samples clustering into ~5-8 episodes, and its
companion statistic was refuted 3-0. Keeping the block. Recording it as a choice against a named
counter-hypothesis, not an uncontested setting.

## Traps found while building this

The TradingView MCP watchlist API lies in **both** directions. Screenshots are ground truth.

- `watchlist_add_bulk` returns `success: true` with an `added_as` that reports only the
  **resolved first leg** of an expression. Sending `CBOE:VIX3M/CBOE:VIX` reports
  `added_as: "TVC:VIX"`. The expression *does* store correctly — `added_as` is simply wrong.
  Do not use it to verify.
- The same call reported `NASDAQ:SDEX` as `failed`. It landed. False negative.
- `watchlist_get` returns `{count: 0, source: "empty"}` for a populated list after `quote_get`
  has switched the chart around. It reads the DOM and loses the container. Not a wipe.
- Creating a list via the UI does **not** reliably move the active-list pointer. A new list was
  created, the pointer stayed on the previous list, and a bulk add landed 13 symbols in the wrong
  watchlist. **Always click the target list explicitly and confirm the panel header by screenshot
  before adding.**
- macOS: `tv_launch` starts TradingView but the CDP port dies with the process. Launching the
  binary with `--remote-debugging-port=9222` from a backgrounded Bash call holds it open.

## Dead and missing feeds

- **`CBOE:SKEW` is dead.** Last tick 2022-11-25, roughly four years stale, and it renders as a
  normal number. Removed. `NASDAQ:SDEX` (Nations SkewDex) is live and replaces it.

**Correction — an earlier version of this file over-trimmed.** Four rows were cut as
"duplicates" that are not: `CAPITALCOM:SPX500` (24/5 vs RTH-only `SPCFD:SPX`),
`VELOCITY:BRENT` (Brent, not WTI), `CBOT:ZQV2026-CBOT:ZQU2026` (dated, does not roll), and
`USI:PCCE` (the divergence partner to `PCCI`). All four are restored. The lesson is in the
session laws below: "prints the same number today" and "looks like the same asset class" are
not duplicate tests — check the session hours and the roll behaviour first.
- **`DSPX` does not exist on TradingView.** Search returns only Goldman warrants. Dispersion is
  covered partially by `CBOE:COR1M`.
- **No CBOE SPX index entitlement on this account.** `CBOE:SPX` silently aliases to `SPCFD:SPX`.
  The original `SPCFD:SPX` was already correct.
- `TVC:MOVE` lags one session. It is a daily index; that is expected, not a fault.
