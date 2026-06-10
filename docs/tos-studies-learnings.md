# TOS Studies — Extracted Learnings

Eleven thinkScript studies built pre-Morai (GEX overlays, fragility composites, regime
ratios, chain scanner). All retired — they were manual workarounds for not having a live
dashboard. Durable knowledge extracted here. Scripts themselves not kept.

## Why Retired

- Levels typed by hand into chart inputs each data pull; stale badges existed only to
  catch rotting manual data. Morai jobs automate the pull.
- Chain scanning inside thinkScript is a hack: SPY-only symbol construction,
  closed-form IV approximation, true zero-gamma flip not computable. Morai computes
  from real chain data.
- Single-signal lower studies (RSP/SPY, VIX/VIX3M, VVIX) — Morai renders the same
  signals with history and proper composites.

## Analytics Specs for Morai

These are calibrated, battle-tested specs — port into the `analytics` bounded context.

### Fragility Composite (ready domain spec)

Five binary checks, each scores 1 when fragile. Sum 0-5: 0-1 healthy, 2-3 caution, 4-5 fragile.

| # | Check | Fragile when |
|---|---|---|
| 1 | Breadth | RSP/SPY ratio < its 20d average |
| 2 | Vol term structure | VIX/VIX3M > 0.90 |
| 3 | Vol of vol | VVIX > 100 |
| 4 | Price trend | close < 20d average |
| 5 | Credit | HYG < its 20d average |

### Regime Thresholds (calibrated constants)

| Signal | Warn | Danger | Note |
|---|---|---|---|
| VIX/VIX3M | 0.90 | 0.95 | ≥0.95 = near backwardation = calendar hard-gate |
| VVIX | 100 | 115 | hedging demand building / stress |

Belong in domain constants; UI colors green/yellow/red at the same cuts.

### GEX Level Taxonomy + Vendor Corrections

Level set per pull: CallResistance, CallWall2, HVL (flip), GammaMagnet, PutSupport,
PutWall2, Spot, ±1σ one-day range. This is Morai's GEX observations model.

Hand-verified corrections to vendor fields:
- **Flip = gamma sign-cross on the strike grid**, NOT the vendor "HVL" field.
- **Put wall = strike with max put OI**, NOT the vendor "putWall" field.
- Gamma magnet = strongest-OI wall (pin/battleground strike).

### GEX Computation

- Three contribution conventions: shares (`gamma × OI × 100`), dollars per $1 move
  (`× spot`), dollars per 1% move (`× spot² × 0.01`). Pick one, label units explicitly.
- **Put-sign regression test (real bug):** v0.4 applied put `× -1` in only one of three
  calc methods → net GEX could never go negative → regime read permanently stuck
  LONG-GAMMA. Morai property test: *puts always contribute negative gamma exposure;
  net GEX must be able to go negative.*
- Regime read: net GEX ≥ 0 → long-gamma/pin (mean-rev); < 0 → short-gamma/trend.

### Staleness Is First-Class

Manual pulls rot silently — entire badge machinery existed for this. Morai: every
analytics payload carries its data timestamp; UI badges age; `/api/status` exposes last
successful run per job. (Already in `architecture/deployment.md` observability — this is
the empirical why.)

### Percentile Normalization for Composite Views

Cross-signal comparison works when each signal is rescaled to where today sits in its
own 252-day range (0-100), all oriented the same direction (up = fragile). Lines
bunched near top = danger. Good UI technique for multi-signal panels.

## Future Feature (deferred)

TOS stays the execution platform with sound alerts. Morai endpoint could emit a
ready-to-paste level block (levels + per-symbol scale conversion
`adjusted = level / scale + offset`; SPY ≈ SPX/10.048, ES = SPX + basis) for a thin TOS
overlay. Kills manual typing, keeps TOS alerting. Not scheduled.

## thinkScript Gotchas (if TOS work ever returns)

- Recursive vars init to **0, not NaN** — `IsNaN()` latches never fire. Latch on 0
  instead (ratios/prices never legitimately 0).
- Index symbols (VIX, VIX3M, VVIX) print NaN on the latest bar intermittently —
  carry forward: `def x = if !IsNaN(raw) then raw else x[1];`.
- Bubbles in the expansion area (right of candles, covers nothing):
  `def bubbleBar = IsNaN(close) and !IsNaN(close[1]);` — needs chart expansion ≥ 5 bars.
- Option-symbol folds (`open_interest(".SPY..." + strike)`) work on DAILY + RTH only;
  outside RTH the chain quotes 0/NaN. Futures option roots don't resolve this way.
- Stale-pull detection: `GetYYYYMMDD() > PullStamp or SecondsFromTime(PullHHMM) > N×3600`.

Older thinkScript lessons (pre-2026-05): `knowledge-base/thinkscript-learnings.md`.
