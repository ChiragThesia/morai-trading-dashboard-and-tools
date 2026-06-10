# IV Engine Discrepancy and the Own-Solver Decision

Status: PROPOSED (2026-06-05). Target: trade-advisor mcp-server now; Morai
pricing engine inherits the same module later.

## The Problem

Schwab Market Data API and thinkorswim disagree on option IV by ~2 vol points
on SPX. On 2026-06-05 this flipped a trade decision's sign.

Incident: evaluating an SPX 7350 PUT calendar (Jul 10 / Aug 7) on a -2.4%
crash day. The term-structure entry gate requires back IV >= front IV.

| Feed | Front IV (Jul 10) | Back IV (Aug 7) | Gate verdict |
|---|---|---|---|
| Schwab API (`analyze_calendar_candidate`) | 15.58 | 15.23 | INVERTED — hard fail |
| TOS chain (trader's screen) | 17.12 | 17.25 | normal contango — pass |

Same strikes, same minutes. The bot said "inverted, do not enter." The screen
said otherwise. Neither feed is wrong; they answer different questions.

## Root Cause (researched and verified 2026-06-05)

Deep-research run: 17 sources, 25 claims adversarially verified (19 confirmed,
6 refuted). Full citations in the findings below.

1. **There is no canonical IV.** IV is solved, not observed. Every platform
   picks its own model, interest rate, dividend yield, and mid convention.
   The 2-point gap is methodology, not error.
2. **TOS engine** (official TOS Learning Center docs): closed-form
   Bjerksund-Stensland approximation per Haug's *Complete Guide to Option
   Pricing Formulas*. Distinguishes exercise style via an `isEuropean` flag
   (`OptionPrice()` signature). SPX is European, so the SPX path is
   effectively Black-Scholes-Merton.
3. **TOS inputs:** one platform-wide scalar interest rate
   (`GetInterestRate()` — no yield curve). Its numeric value and update
   cadence are undocumented. Dividends enter as a continuous yield
   (`GetYield()`), not discrete amounts. The rate is the prime suspect for
   the 2-point gap: front-leg rho is -3.3 per 1% rate, so a ~2% rate
   disagreement moves solved IV ~1 point, and the q choice adds more.
4. **TOS chain "Volatility" column** has three modes (Setup gear →
   Application Settings): Individual Implied Volatility (default),
   Volatility Smile Approximation, Fixed per Expiration. Only IIV matches
   the Analyze-tab P/L. Smile-mode math is a black box; IIV is replicable.
5. **Schwab API is a separate engine** inherited from TDA. Its
   `volatility` / `interestRate` / `underlyingPrice` request params are
   honored only on ANALYTICAL strategy chains. SINGLE (quote) chains ignore
   them and return Greeks from internal, uncontrollable inputs. The API can
   never be configured to match TOS.
6. **Raw quotes are fine.** Bid/ask/last/OI/volume from the API are real,
   tradeable, and identical to what TOS displays. Only the derived fields
   (IV, Greeks) diverge.

Refuted along the way (0-3 adversarial votes each): "the rate is 3-month
$IRX", "IV is back-solved from midpoint" (as documented fact for
StreetSmart Edge), "BJS is never applied to European options".

## The Decision

Build our own IV/Greeks solver. Stop consuming any engine's opaque derived
fields for decisions; keep consuming raw quotes.

```
API bid/ask  →  mid  →  BSM Newton solver + our (r, q)  →  IV + Greeks
                              ↑
              (r, q) calibrated against TOS chain readings
```

Not an engine — a module. No DB, no jobs, no pipeline. Pure math over
quotes the plugin already pulls. Roughly 150 lines.

### Layout (trade-advisor mcp-server)

```
mcp-server/src/lib/iv-solver/
  bsm.ts          # Black-Scholes-Merton price + Greeks (European)
  solve-iv.ts     # Newton iteration: mid price → IV
  calibrate.ts    # least-squares fit of (r, q) from TOS readings
  params.json     # calibrated r, q + calibration date
```

### Integration

- `analyze_calendar_candidate` emits `tosIv`, `tosVega`, `tosTheta`,
  `tosDelta` per leg alongside the existing Schwab fields.
- Term-structure gate and forward-vol math switch to solved values.
- Schwab fields stay in the payload for comparison; nothing is removed.

### Calibration

- Inputs: 3-4 TOS chain IV readings (strike, expiry, IV, read time) on
  liquid SPX strikes, taken near a quote snapshot.
- Two unknowns (r, q); least-squares over the readings.
- Acceptance: residuals < 0.2 vol points across calibration strikes.
- Re-calibrate weekly; TOS's rate update cadence is undocumented.

### Scope guard

American-style support (Bjerksund-Stensland 2002) is explicitly out of
scope until a non-SPX underlying needs it. Reference implementation if that
day comes: `dbrojas/optlib` (closed-form BJS-2002, matches Haug parameter
conventions — the same reference TOS cites).

## Why Not Alternatives

| Alternative | Rejected because |
|---|---|
| Keep Schwab API IV | Opaque inputs; flipped a gate verdict vs the trader's screen |
| Use ANALYTICAL chains with forced inputs | Controls inputs but not Schwab's model internals; still a black box |
| Scrape/match TOS exactly via its API | No such API; TOS engine inputs undocumented |
| Trust TOS readings manually | Not automatable; trader re-keys numbers under stress |

## Open Questions

1. TOS global rate: actual value and update cadence — falls out of
   calibration residuals over a few weeks.
2. Does the TOS chain column use the exact ImpVolatility-study engine?
   Calibration residual size answers this empirically.
3. Settlement/DTE convention (calendar vs trading days, AM settlement for
   SPXW) — test both in the solver, keep whichever fits readings better.

## Sources (primary)

- TOS Learning Center, ImpVolatility study: Bjerksund-Stensland basis.
  toslc.thinkorswim.com/center/reference/Tech-Indicators/studies-library/G-L/ImpVolatility
- TOS thinkScript `OptionPrice()`: isEuropean / getInterestRate / getYield
  signature. toslc.thinkorswim.com/center/reference/thinkScript/Functions/Option-Related/OptionPrice
- schwab-py docs: ANALYTICAL-only calculation params.
  schwab-py.readthedocs.io/en/latest/client.html
- dbrojas/optlib: Haug-convention BJS-2002 + BSM reference implementation.
  github.com/dbrojas/optlib
- marketdata.app: no-canonical-IV explainer.
  marketdata.app/education/options/differences-in-iv-greeks/
