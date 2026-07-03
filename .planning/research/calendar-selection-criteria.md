# SPX Put-Calendar Selection Criteria — Verified Research

**Source**: /deep-research run 2026-07-02 (102 agents, 20 sources, 25 claims verified 3-vote
adversarial: 19 confirmed, 6 refuted). Feeds the Analyzer-as-picker redesign.
**User constraints**: front leg ≥21–30 DTE at entry; ≥21 days between front and back expirations;
1–2 lots; SPX (European, cash-settled).

## Scoring criteria (ranked, encode over live chain)

| # | Criterion | Encoding | Confidence |
|---|-----------|----------|------------|
| 1 | **Forward IV, not raw IV diff** — term-structure edge exists only via `FwdIV = sqrt((T2·σ2² − T1·σ1²)/(T2 − T1))`, T in DTE. Raw front−back subtraction is only valid same-date (skew). Guard: radicand < 0 under inversion. | Compute FwdIV between candidate leg expiries; edge = front IV rich vs forward path | HIGH (3-0 ×3; SpotGamma verbatim + no-arb identity) |
| 2 | **Term-structure slope is the dominant long-vol P&L driver** — Vasquez (JFQA 2017): top-vs-bottom slope decile = 16.5%/mo spread, t=10.02. Buy long-vol when slope up; avoid when inverted. Caveat: cross-sectional equity straddles, not SPX time-series — needs in-house backtest (leg_observations has the data). | Slope between legs = (σ_back − σ_front)/(DTE_back − DTE_front); require > 0, weight heavily | HIGH (peer-reviewed) |
| 3 | **Event-premium stripping** — expiries just after FOMC/CPI/NFP carry discrete event premium; apparent edge may be event premium, not structural. Flag every leg that spans a scheduled event; clean forward-vol baseline only from non-event-spanning expiries. | Event calendar (FOMC/CPI/NFP dates) × leg expiry windows → per-leg flags | HIGH (arXiv 2606.12872 + NBER w28306) |
| 4 | **Event edge carries risk penalty** — front-leg realized-vol spike ≈ max loss; calendar max loss typically > max profit. Event-sourced edge scores a penalty, not just a bonus. | If front spans event: score penalty + label | MEDIUM (2-1) |
| 5 | **Strike = price forecast at front expiry** — peak profit at shared strike @ short expiration. ATM = neutral (widest zone); OTM puts = bearish drift. Prefer OTM over ITM (parity-equal for European SPX, better liquidity/spreads). | Strike options: ATM + delta-targeted OTM; parameterize by delta not raw strike (CML precedent) | HIGH (3-0 ×3) |
| 6 | **Positive-net-theta bounds OTM distance** — calendar theta flips negative far enough OTM (~6.7–8.3% OTM for 30/60 at 20% vol; varies). | Constraint: net position theta > 0, computed from live greeks — never a fixed %-OTM cutoff | MEDIUM (3-0, single primary + independent BSM check) |
| 7 | **GEX regime filter** — calendars safer under positive net dealer gamma; strike at/near Absolute Gamma strike reasonable when price drawn to it. Sign alone insufficient — need proximity/convergence. | Bonus: netGEX > 0 AND |strike − absGammaStrike| small | MEDIUM (SpotGamma framework + pinning literature) |
| 8 | **Debit = max loss for sizing** — valid for SPX European IF closed at/before front expiry. Residual long held past front expiry can lose more. | Size by debit; hard rule: close by front expiration | MEDIUM (2-1 ×2) |
| 9 | **Exit defaults** — +20–30% of debit profit target, −15–20% mental stop, plan before entry. One practitioner's rule — tunable defaults, not validated. Related: 21-DTE management rule for short legs. | Defaults +25% / −17.5%, close-by date on card | LOW (attributed heuristic) |

**Tool precedents**: thinkorswim Spread Hacker = generic composable filter engine over calendar
candidates (≤8 filters, no prescribed metrics — we must supply metrics). CML TradeMachine =
(delta target, front DTE, back DTE) tuples per leg — matches our constraint shape.

## Refuted — do NOT encode

- IV-rank / IV-percentile entry gates for calendars (three separate claims killed 0-3, 1-2, 1-2 —
  including "enter when IV low because vega-positive").
- "Back−front IV differential must be −1% to −3% ideal band" (0-3; journalplus.co fabricated specifics).
- "Fair debit = 25–40% of back-month premium" (0-3; same source).
- "Further OTM monotonically decreases debit and PoP" (1-2).

## Open questions (backlog candidates)

1. Vol-level entry filter: nothing survived; vega-long benefit vs vol-crush tradeoff needs a
   scoring term calibrated empirically.
2. Vasquez slope signal transfer to SPX time-series → **in-house backtest over leg_observations**
   (data exists since 2026-06-12).
3. Thresholds for breakeven-width-vs-expected-move, PoP, theta/vega — no verified sources; calibrate.
4. OPEX/weekend gamma handling; VVIX/COT incremental signal — no verified evidence either way.
   Keep as context display, not score inputs.

## New data requirement

**Economic event calendar** (FOMC/CPI/NFP dates) — needed for criterion 3/4 flags. No adapter
exists. FOMC schedule is published yearly (static-ish); CPI/NFP monthly schedules from BLS.
Matches the existing "Catalysts ○ needs feed" stub in overview-v1 mockup.

## Key sources

- SpotGamma: Forward Implied Volatility; Long Calendar Spread (support.spotgamma.com)
- Vasquez, "Equity Volatility Term Structures and the Cross-Section of Option Returns", JFQA 52(6) 2017 (SSRN 1944298)
- Zhong (USC), arXiv 2606.12872 — SPX event premia FOMC/CPI/NFP; Wright NBER w28306
- Fidelity/tastytrade/SteadyOptions/OptionAlpha practitioner guides (strike placement, max loss, exits)
- thinkorswim Spread Hacker manual; CML TradeMachine docs (screener architecture)
