# TradingView bridge

MORAI's live surfaces on a TradingView chart:

| File | What |
|---|---|
| `vol-state.pine` | VRP and term structure as ratios, plus the calendar entry gate |
| `gamma-levels.pine` | Gamma flip / call wall / put wall, fed by `push-gex.ts` |
| `breadth.pine` | A/D line, Zweig thrust, RSP/SPY fragility — vol's early-warning arm |
| `expected-move.pine` | Daily 1σ/2σ envelope from VIX1D, and how much of it is still ahead |
| `push-gex.ts` | Pushes MORAI's GEX levels onto the live chart |

## The constraint that shapes everything

**Pine Script has no network primitive.** No `fetch`, no HTTP, no URL — `request.*()` takes a
ticker, never an endpoint. And TradingView carries no per-strike SPX option contracts (`SPXW`
does not resolve, there is no OPRA exchange), so GEX cannot be computed on the platform either.

So the split is:

- **Native** (zero bridge): VIX complex, FRED macro, yields, CFTC positioning. Plain
  `request.security()` calls against tickers TradingView already carries.
- **Bridged**: gamma levels only. MORAI computes them; `push-gex.ts` carries them in.

Every public GEX script on TradingView works the same way — a hardcoded levels string plus a
paste-override input, republished by the author. Verified by reading their source.

## Running the push

```bash
bun --env-file=.env run tools/tradingview/push-gex.ts             # once
bun --env-file=.env run tools/tradingview/push-gex.ts --dry       # print only
bun --env-file=.env run tools/tradingview/push-gex.ts --last-good # newest snapshot WITH walls
bun --env-file=.env run tools/tradingview/push-gex.ts --watch     # every 30 min
```

Requires `DATABASE_URL` and TradingView Desktop running with the debug port open:

```bash
osascript -e 'quit app "TradingView"'; sleep 3
osascript -e 'tell application "Terminal" to do script \
  "/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222 \
   >/tmp/tv.log 2>&1"'
```

The redirect matters for usability: without it the app dumps its (very verbose) Electron
debug log straight into the Terminal window. With it, the window stays quiet — read
`/tmp/tv.log` if something needs diagnosing.

That Terminal window must stay open, and **do not press Ctrl-C in it** — that quits
TradingView. `nohup` and `open -a --args` both fail on macOS; the process dies with the
spawning shell, which is why it needs a Terminal-owned session.

Verify the port with `lsof -nP -iTCP:9222 -sTCP:LISTEN`. Note that TradingView sometimes
self-relaunches to apply an update — it comes back WITHOUT the debug flag, so re-run the
launch command after any auto-update.

**Close the window when done.** While port 9222 is open, any local process can drive the
logged-in TradingView session.

## Why it sets an input instead of rewriting source

The vendors rewrite the script source and re-save it, because that is all a published-script
author can do for strangers. We have CDP access to our own chart, so we set the indicator's
input directly. That skips compilation — which matters, because Pine bans compiling for **one
hour** after three consecutive failed compiles, and a 30-minute republish loop is exactly what
would trip it.

Setting an input only changes the live chart, so the push also sends ⌘S; without it a reload
silently reverts to the last saved layout.

## Why it skips null walls

Off-hours both chain sources stop reporting open interest — Schwab returns 0 outside RTH, and
CBOE's delayed file stops refreshing. GEX then legitimately computes null walls. Measured over
three days: **14/14 RTH cycles produce walls, weekends produce none.** That is not a bug.

Pushing nulls would erase good levels, so the push skips them and lets the study's staleness
marker age the previous ones. Friday's levels dimmed and labelled stale beat an empty overlay
on a Monday pre-market. `--last-good` makes that explicit.

## Where the GEX numbers come from, and how far to trust them

```
Schwab chain (real-time, RTH only)  ┐
                                     ├→ leg_observations → IV inversion → BSM gamma → GEX
CBOE delayed_quotes (~15-min delay) ┘
```

1. **Two sources, unioned.** Newest row per contract wins — *except* open interest, which
   takes `MAX()` across the cohort window. Schwab returns `openInterest: 0` outside RTH, so
   newest-wins would zero every strike.
2. **IV is inverted from the option mark**, not taken from a vendor field, using the
   FRED risk-free rate and a put-call-parity implied dividend yield.
3. **Gamma is MORAI's own BSM** computed from that IV — not the vendor's gamma column.
4. `GEX = gamma × OI × 100 × spot² × 0.01 / 1e9` → $Bn per 1% move. Industry-standard form.
5. **Sign convention: calls +, puts −.**

### Two caveats that are real

**The dealer sign convention is an assumption, not a measurement.** Calls-positive /
puts-negative encodes "dealers are long calls, short puts." Every vendor assumes this, but it
is a model. When customer flow runs the other way (heavy call selling, put buying) the true
sign can invert and GEX will be confidently wrong.

**Open interest is a once-daily OCC figure.** Today's trades do not appear in OI until
tomorrow, so intraday GEX moves come from gamma changing as spot moves, not from new
positioning.

### ⚠️ The walls are NOT aimed at calendar trading

Measured on the 2026-08-01T03:30Z snapshot (spot 7490, 32 expiries, 30.9 Bn total |GEX|):

| DTE bucket | share of \|GEX\| |
|---|---|
| 0–7d | **44.3%** |
| 8–30d | 26.1% |
| 31–60d | 26.1% |
| 61d+ | 3.6% |

`callWall` / `putWall` are computed by `pickWalls()` over **all expiries with no DTE filter**,
so they are ~44% driven by 0–7 DTE flow — precisely the near-dated noise a calendar trader
does not care about.

Worse, the `nearTerm` field is **backwards for this use case**: it filters to ≤45 DTE, which
*keeps* the 0DTE noise and *cuts* the September monthly — the single largest line in the book:

```
2026-09-18   49d   +8.05 Bn   ← Sep monthly, biggest single expiry
2026-08-03    3d   +6.68 Bn   ← 0DTE
2026-08-21   21d   +4.05 Bn   ← Aug monthly
```

The per-expiry data IS available (`by_expiry` on every snapshot), it is only the headline
walls that blend everything.

**OPEN — not yet built:** a DTE *window* on `pickWalls` (e.g. 21–60d, or monthlies only) so
the levels reflect the expiries actually being traded. This is a MORAI-side change; it flows
to the chart for free because `push-gex.ts` just reads the snapshot.

## Gotchas paid for the hard way

- **A ticker resolving in symbol search does NOT mean it resolves in `request.security()`.**
  CFTC data needs the BARE symbol (`13874A_F_DP_L`); the `COT:` prefix returns `na` — and
  inconsistently across the series family, so probe each string.
- **`request.quandl()` compiles in v6 but is dead at runtime** — passes `pine check` with zero
  errors, then silently kills the whole script.
- **Weekly/daily series requested at `timeframe.period` return `na` on intraday charts.** They
  do not hold the last value flat. Name `"D"` or `"W"` explicitly.
- **`lookahead_off` (the default) returns the last COMPLETED bar** — on a Friday evening that
  is Thursday's close. The board uses `lookahead_on`, which is safe only because it renders
  solely on `barstate.islast` and drives no signal. Never copy that into a study that plots
  history or backtests.
- **`CBOE:VIX` resolves to `CBOE_DLY:VIX`** (delayed) on this account.
- **Never diagnose a market-data pipeline from an off-hours sample.** Check the RTH hit rate
  across several days first — a weekend snapshot of an options pipeline looks identical to a
  dead one. This cost an entire evening chasing a GEX "bug" that was a closed market.
- **`force_overlay` works but is invisible to the query tools.** `tv data lines` / `data
  labels` report nothing for drawings created with `force_overlay = true`; they are genuinely
  on the price pane. Verify with a screenshot, not the data layer.
- **A level far from spot rescales the whole chart.** TradingView autoscales to fit indicator
  drawings, so a put wall 6.5% away flattens the candles into a band. The study filters levels
  beyond a configurable % of spot; also set the price scale to "Scale price chart only".
- **`indicator set --inputs` does not persist.** It changes the live chart; a reload reverts to
  the last saved layout. `push-gex.ts` sends ⌘S after every push for this reason.
- **Pine has no block comments.** `/** ... */` is a syntax error — only `//` works.
