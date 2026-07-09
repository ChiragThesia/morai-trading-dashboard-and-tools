# Regime & Breadth Board

The Overview regime board surfaces cross-asset stress indicators — value, calm/warning/crisis
band, as-of date, source, and rationale — the same evidence-per-row discipline as
[picker-rules.md](picker-rules.md). An indicator ships ONLY with a cited source and a
documented threshold rationale (MACRO-02). Candidates that fail evidence or data-availability
review are dropped, not shipped anyway — see Refuted/Dropped below.

The board is computed-on-read from `macro_observations` (see
[data-model.md](data-model.md)) — no new table. Bands are display-only this phase; Phase 28
wires hard gates into the picker.

## Admitted indicators

| id | Formula / inputs | Bands (calm / warning / crisis) | Threshold rationale | Source | Verified |
|---|---|---|---|---|---|
| `vix-term-structure` | VIX/VIX3M ratio (FRED `VIXCLS` / `VXVCLS`, both already ingested since Phase 23) | `< 0.90` / `0.90–0.95` / `≥ 0.95` | User's prior (0.90 warn / 0.95 danger) confirmed by independent sources: contango dominates ~85% of trading days, backwardation (ratio ≥ 1.0) is rare (8.6% of days) and has historically preceded major drawdowns; 0.95 matches the cited "warning" cut. | eco3min.fr (VIX backwardation/contango study), systemtrader.co (VIX/VIX3M tracker) | 2026-07-09 |
| `vvix` | VVIX absolute level (CBOE `_VVIX` delayed quote, already ingested since Phase 14) | `< 100` / `100–115` / `≥ 115` | 100 warn confirmed directly by four independent sources (normal/elevated boundary). 115 stress is a CITED interpolation inside the documented 110–120 elevated→extreme-fear transition zone, not a verbatim-cited exact cut — kept because it sits inside the confirmed band and the user's own TOS study already back-tested it. | SpotGamma, TOS Indicators, Volatility Box, CapTrader | 2026-07-09 |
| `vix9d-vix` | VIX9D/VIX ratio (CBOE `_VIX9D` delayed quote, new this phase, / FRED `VIXCLS`) | `< 1.0` / `1.0–1.1` / `≥ 1.1` — **`[ASSUMED]`** | No source gives a specific backtested numeric cut (unlike VIX/VIX3M's documented 0.90/0.95). Bands are a structural analogy to the VIX/VIX3M ratio logic (>1.0 = near-curve inversion = stress), not backtested. Display-only this phase — do not wire into a hard gate without a dedicated backtest (Phase 28). | topstep.com, macroption.com, cboe.com (VIX9D/VIX term-structure concept, no numeric cut cited) | 2026-07-09 |
| `hy-oas` | HY OAS absolute level, percent units (FRED `BAMLH0A0HYM2`, new this phase — ICE BofA US High Yield Index Option-Adjusted Spread) | `< 3.0` / `3.0–5.0` / `≥ 5.0` — **`[ASSUMED]`, newly-calibrated** | New calibration (not a refinement of an existing user prior — the original credit leg, `HYG < 20d avg`, is unreachable, see Refuted/Dropped #4). Synthesized from 3 practitioner sources: spreads above 800bp have historically coincided with or preceded recession; below ~300–350bp signals late-cycle complacency. Shipped as an absolute level, not a moving average — a brand-new series has zero history on ship day (Pitfall: the FRED adapter fetches only the latest observation per run, no backfill). | eco3min.fr (HY OAS recession-signal study), macroradar.io, convextrade.com | 2026-07-09 |

## Known limitations

`vix9d-vix`'s numerator (CBOE `_VIX9D`, delayed quote) and denominator (FRED `VIXCLS`,
prior-session EOD close) come from different observation times — the ratio can divide
today's intraday VIX9D by yesterday's VIXCLS close. `asOf` is the OLDER of the two dates
(MACRO-03), so the chip honestly stamps the stale VIXCLS date even though the numerator is
fresher. During a fast intraday vol spike the stale denominator can inflate the ratio and
flip the band spuriously. `vix-term-structure` does not have this problem — VIXCLS and
VXVCLS are both FRED EOD, same lag.

This is display-only and `[ASSUMED]` (see table above), so it is non-corrupting today.
**Phase 28 MUST NOT wire `vix9d-vix` into a hard picker gate until both legs share an
observation time** (e.g. source the denominator from the same CBOE delayed-quote surface
as VIX9D — an in-system `_VIX` quote — instead of FRED `VIXCLS`).

## Refuted / Dropped

| # | Candidate | Reason | Revival path |
|---|---|---|---|
| 1 | RSP:SPY equal-weight breadth ratio | No verified, stable, server-fetchable data source in-system: the Schwab sidecar exposes no equity/ETF quote surface (option chains only), and Stooq's CSV endpoint returns a client-side JS proof-of-work anti-bot challenge, not usable CSV, for RSP/SPY/HYG alike. Independent academic evidence is also weaker than the user's TOS calibration implies (near-zero weekly return-correlation, 2003–2018 sample). | A future Schwab sidecar `/sidecar/quote` equity-quote endpoint (code change, out of scope this phase), OR accept the Yahoo Finance chart API's unofficial/unstable-without-notice risk with monitoring — gate behind `checkpoint:human-verify`. |
| 2 | VVIX/VIX ratio (as a separate board indicator) | Real, documented indicator (normal 4–6, elevated 6–7, high-risk >7 per TradingView interpretation levels) — but on a completely different numeric scale than the absolute-VVIX thresholds (100/115) the user actually battle-tested in TOS. Shipping both would double-count the same two raw series under an uncalibrated threshold set. | Ship as its own indicator in a future phase with its own calibration study — the user has not TOS-tested this ratio form. |
| 3 | `VIX9DCLS` as a FRED series | Hallucinated/non-existent FRED series id — confirmed HTTP 404 via `fredgraph.csv` and absent from FRED's own Volatility Indexes category. | N/A — CBOE `_VIX9D` is the admitted path (see `vix9d-vix` above). |
| 4 | HYG ETF close (original credit leg from `docs/tos-studies-learnings.md`'s fragility composite) | Same ETF-quote data-availability gap as RSP:SPY — no verified in-system source (FRED does not carry ETF prices; Stooq is bot-walled). | Superseded by FRED `BAMLH0A0HYM2` (HY OAS), which is data-available today. If HYG itself is ever needed, the same Stooq/Yahoo revival path as RSP:SPY applies. |

## Not on this board

Front-month IV inversion (the picker's `slope` rule, `packages/core/src/picker/domain/rules.ts`)
is deliberately excluded — it is a per-candidate structure signal the Analyzer already surfaces.
Re-showing it here would duplicate the Analyzer and blur the board's macro-level scope.

The board does not assemble the user's full 5-leg fragility composite this phase (its breadth
leg is dropped above and its trend leg, close < 20d avg, is not in this phase's candidate set).
Assembling a partial composite would silently misrepresent the user's battle-tested 5-leg model
— the 4 admitted indicators ship as independent chips instead.

## Where to look

- [picker-rules.md](picker-rules.md) — the evidence-per-row format this doc mirrors
- [data-model.md](data-model.md) — `macro_observations` schema (all 4 admitted indicators'
  raw inputs land here)
- [jobs.md](jobs.md) — `fetch-rates` cron (ingests VIX9D + HY OAS alongside the existing 9 series)
- `docs/tos-studies-learnings.md` — the user's original calibrated fragility composite (the
  priors this board's thresholds confirm or newly calibrate against)
