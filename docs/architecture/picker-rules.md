# Picker Rule Table

The calendar-candidate picker scores SPX OTM-put calendars with ONE typed rule registry:
`packages/core/src/picker/domain/rules.ts`. Every rule is a row — formula, inputs, weight,
status, rationale, source. Adding a rule = adding a row (plus a weight rebalance and a test).
The registry ships to the UI as `pickerSnapshotResponse.ruleSet`, so the Analyzer methodology
panel renders the engine's actual table, never a copy.

## Rule kinds

- **gate** — hard filter. A failing candidate is dropped before scoring. Drop counts are
  logged per gate (no silent caps).
- **score** — weighted term. Each normalizes its raw metric to [0,1], multiplies by its
  weight, and sums into the 0–100 score. Active score weights MUST sum to exactly 100
  (enforced by test).
- **experimental** — computed and displayed per candidate (`candidate.context[]`) but weight
  0. Promotion to `score` requires the PICK-04 backtest over the `picker_snapshot` corpus.

## Candidate universe (generation — before any gate)

User-locked 2026-07-08 (research-verified against tastytrade/SteadyOptions/ORATS material):

- **Band-scan (redesigned 2026-07-08 after the 7450 rung-gap miss):** every liquid 25-point
  strike whose front put delta lies in **[−0.55, −0.25]** enters the universe — MEMBERSHIP
  test, not nearest-delta rungs. Commercial screeners use band membership; nearest-target
  designs provably skip strikes whose delta falls between targets. The band's OTM edge
  (−0.25Δ ≈ 0.7σ) subsumes the old expected-move cap. A VIX-conditional delta shift was
  researched and REFUTED (tent width widens with IV).
- **25-point strikes only:** SPX OI/volume concentrate there; off-grid strikes never enter.
- **Front DTE:** 21–36. **Back gap:** 21–35 days after the front — ALL qualifying backs are
  emitted (fwd-edge scoring ranks them).
- **Fill model:** debits price from the actual bid/ask with the ORATS 2-leg haircut — cross
  66% of each leg's width off the natural side (buy back at bid+0.66·w, sell front at
  ask−0.66·w). Ranking on mid or BSM theory overstates edge on wide markets.
- **Session label:** snapshots carry `marketSession: rth | after-hours` (isWithinRth on the
  cohort time); AH cohorts render an "AH — indicative" warning chip. The 30-min 24/7 cron
  replaces AH marks with fresh RTH data automatically at the next open.

## Gates

| id | Condition | Why |
|---|---|---|
| `net-theta-positive` | net θ = (θ_back − θ_front)·100 > 0 | A calendar with negative carry has no edge thesis. |
| `liquidity` | each leg: (ask−bid)/mid ≤ 0.10 AND OI ≥ 100 | Untradeable markets produce fictional debits/breakevens. |
| `term-inversion` | drop pair when front IV > back IV | Playbook hard gate (trading-knowledge repo): a calendar needs back IV ≥ front IV. |
| `event-blackout` | drop pair when a tier-1 event (FOMC/CPI/NFP) falls ≤3 days before the front expiry | Playbook H4: event vol + gamma cliff stack in the short leg's final days. |

Deferred to the playbook-port phase (need a macro→picker port + the VIX3M FRED series, which
`macro_observations` does not yet carry): VIX < 25 hard gate, VIX/VIX3M < 0.95 contango gate,
and the VIX-tuned target-delta preference (autoTuneTargetDelta).

## Active scores (weights sum 100)

| id | Weight | Formula | Source |
|---|---|---|---|
| `fwdEdge` | 30 | fwd = √((t_b·σ_b² − t_f·σ_f²)/(t_b − t_f)); edge = σ_f − fwd; fraction = clamp01((edge+0.02)/0.04); inverted radicand → 0 | Forward-IV term-structure edge (Perfiliev; SpotGamma fwd-IV) |
| `slope` | 25 | slope = ((σ_b − σ_f)/(t_b − t_f))·365; fraction = clamp01(slope/0.6) | Term-slope ≈ variance-risk-premium proxy (Johnson 2017, JFQA) |
| `gexFit` | 15 | near-term (≤45d) GEX placement: +0.5 if spot > flip (dampen regime), +0.3 if K ∈ [putWall, callWall], +0.2 if K within 5 pts of either wall (pin). Falls back to all-expiry flip/walls when `nearTerm` is null. Stale/missing GEX → 0 | Dealer-gamma pinning/dampening (SpotGamma-convention walls; in-house GEX) |
| `eventAdjustment` | 10 | 1 − Σ(front-leg FOMC/CPI/NFP × 0.5), floor 0 | No binary catalysts inside the short leg (practitioner consensus) |
| `beVsEm` | 10 | breakeven width / (spot·σ_f·√(t_f/365)); fraction = clamp01(ratio/1.5); <2 breakevens → 0 | Profit-zone width vs expected move (real bisection breakevens, D-09) |
| `deltaNeutral` | 10 | fraction = clamp01(1 − \|Δ_net\|/10), Δ_net in $/pt per spread | User-locked 2026-07-08: "delta neutral as much as possible"; skew-driven fwd-edge otherwise drags the rail toward high-\|Δ\| strikes |

## Experimental (weight 0 — display only until PICK-04 calibrates)

| id | Formula | Inputs |
|---|---|---|
| `vrp` | σ_f(front IV) − RV20, RV20 = stdev(last 20 daily log returns)·√252 | daily spot closes (leg_observations, last obs per day) |
| `slopePercentile` | percentile of candidate slope vs trailing candidate slopes from stored picker snapshots | picker_snapshot history |
| `backEventBonus` | 1 if an FOMC/CPI/NFP date ∈ (frontExpiry, backExpiry] else 0 — "own the event vol in the back leg" | economic_events (PICK-05 precursor) |
| `thetaVega` | θ_net / vega_net (null when vega 0) — practitioner gate is ≥ 0.20 ("vega ≤ 5× theta", tastytrade/OptionsTradingIQ); cutoff unvalidated on our data, so display-only until PICK-04 | candidate greeks |

## Refuted — MUST NOT be encoded

Adversarially refuted during Phase-19 research (`.planning/research/calendar-selection-criteria.md`);
the registry test asserts none of these appear as rule ids, and the contract's breakdown
criterion enum stays closed (T-19-04):

1. IV-rank / IV-percentile entry gates for calendars.
2. "Back−front IV differential −1% to −3% ideal band" (fabricated source).
3. "Fair debit = 25–40% of back-month premium" (fabricated source).
4. "Further-OTM monotonically decreases debit and PoP".

## How to add a rule

1. Add a row to `PICKER_RULES` in `packages/core/src/picker/domain/rules.ts` with
   `status: "experimental"` and rationale + source filled in.
2. Wire any new inputs through `CandidateContext` (new driven ports need memory twins +
   contract tests in the same PR — architecture rule 8).
3. Tests: the registry invariants run automatically (weight sum, refuted guard); add a
   behavior test for the rule's formula (fast-check for numerical rules).
4. Promotion to `score`: only with PICK-04 backtest evidence; rebalance weights to 100.

Selection-universe parameters (delta rungs, DTE windows) and exit-plan defaults live in
`candidate-selection.ts` / `rules.ts` as named constants — they shape the universe, not the
score, and are listed in the snapshot's ruleSet for display.

## Cross-reference: RULE-01 journal tags

Journal ENTER tags (`packages/core/src/journal/domain/rule-tags.ts`) mirror the scoring
dimensions in prose only (recording vocabulary, not a DSL — Phase-20 guard):

| ENTER tag | Nearest rule |
|---|---|
| `term-structure-edge` | `slope` / `fwdEdge` |
| `gex-fit` | `gexFit` |
| `event-window-play` | `eventAdjustment` / `backEventBonus` |
| `iv-skew-favorable` | (no scored counterpart — skew is context-only) |
