# Pitfalls Research — v1.3 Picker Intelligence

**Domain:** Adding an exit advisor + options backtest harness + regime gates to an existing SPX calendar-spread journaling/picker system
**Researched:** 2026-07-09
**Confidence:** HIGH (canonical quant/backtest pitfalls are web-grounded and well-established; system-specific integration pitfalls are drawn from this repo's architecture docs and incident history)

> **Framing.** v1.3 does not build a new system — it bolts three inference layers onto a data
> pipeline that already has known defects: ~74% gap rows in some snapshot windows (spot=0/NaN),
> a BSM drain that can exceed the 900s pg-boss handler cap and leave a big cohort partially
> solved when `compute-picker` fires last in the chain, first-write-wins `picker_snapshot`
> rows, and exactly **13 closed calendars** as the only labeled outcomes. Every pitfall below is
> about *inheriting* those defects into an exit advisor, a backtest, or a regime gate — where a
> data-quality bug stops being a cosmetic gap and becomes a wrong trade verdict or a false
> "this rule works" conclusion. The single biggest theme: **these features convert silent data
> gaps into confident wrong answers.**

---

## Critical Pitfalls

### Pitfall 1: Overfitting the 9 rule weights to 13 closed trades

**What goes wrong:**
PICK-04 runs, reports that re-weighting (say) `thetaVega` up and `beVsEm` down improves realized
P&L across the 13 closed calendars, and the weights get promoted. The "improvement" is noise. 13
outcomes is below every statistical floor: ~30 trades is the bare Central-Limit heuristic, ~100 is
"basic reliability," 200–500 is institutional confidence. Worse, the 13 are highly correlated (one
trader, one instrument, one ~6-week window, mostly the same 2026 contango regime), so the
*effective* sample is smaller than 13. Tuning 9 free weights against ~13 correlated points is
curve-fitting by definition — you will always find weights that fit the history and fail forward.

**Why it happens:**
The harness looks like a validation tool, and a green backtest manufactures false confidence. The
optimizer's job *feels* like "find the weights that maximize P&L on my real trades." Every extra
parameter tested raises the odds of a spurious fit; 9 weights is already deep into overfit
territory even before you count the gates and universe knobs.

**How to avoid:**
Treat PICK-04 as a **refutation tool, not a fitting tool** — it can demote a rule whose sign is
demonstrably wrong (strong prior + evidence, e.g. the slope redesign), never fine-tune all 9
weights at once. Change **one variable at a time** and cap changes per run (the rule table already
says PICK-04 "re-arbitrates" — keep a human in that loop; never auto-write weights). With N=13 the
only honest split is **leave-one-out** (train on 12, test on the held-out one); require a rule's
sign to be *stable across LOO folds* before promotion, not a P&L bump. Report **bootstrap
confidence intervals** on every metric — with 13 samples the CI is enormous, and showing it is the
honest antidote to false precision. Keep the user-locked weights versioned in `rules.ts` so any
promotion is a reviewable diff guarded by the weight-sum-100 test.

**Warning signs:**
Backtest shows a large hit-rate/Sharpe jump from a weight change; in-sample P&L climbs with each
parameter added; the optimizer touches several weights simultaneously; no CI reported, or a
suspiciously tight one.

**Phase to address:** PICK-04 backtest harness phase.

---

### Pitfall 2: In-sample percentile / normalization leakage

**What goes wrong:**
Several rules normalize a raw metric against a distribution: `slopePercentile` ("percentile of
candidate slope vs trailing candidate slopes"), `vrp` against RV20, `beVsEm` and `debitFit` clamps,
any future promoted percentile rule. If the backtest computes those percentiles / means / stdevs
against the **whole stored corpus** (including cohorts *after* the decision date), the rule "sees the
future." A percentile computed against the full dataset is the textbook look-ahead leak, and it is
invisible — the code runs, the numbers look plausible, the backtest looks better than reality.

**Why it happens:**
It is convenient and fast to precompute one global stats table over all `leg_observations` /
`picker_snapshot` rows and join it in. Point-in-time recomputation per cohort is more work and
easy to skip.

**How to avoid:**
Every distributional statistic in the backtest must be **point-in-time**: computed only from data
with `observedAt <= decision-cohort time` (trailing window), exactly as the live picker saw it.
Then exploit a free oracle this system already has — **prod writes `picker_snapshot` rows live**.
For any historical cohort that has a real `picker_snapshot`, the backtest replaying that cohort
**must reproduce the recorded score exactly**. A mismatch means leakage (or a fill/data drift) and
is a hard test failure. This single invariant catches most leaks cheaply. Add a targeted test:
feeding a future-dated observation must not change a past decision's score.

**Warning signs:**
A percentile/rank that stays stable when you add future data (it should shift); one global stats
table feeding the replay; backtest scores that diverge from the recorded `picker_snapshot` for the
same cohort.

**Phase to address:** backtest harness phase.

---

### Pitfall 3: Look-ahead via late-solved BSM and dual-source cohort union

**What goes wrong:**
Two system-specific leaks beyond percentiles. (1) **Late-solved greeks.** `compute-bsm-greeks`
drains `bsm_iv IS NULL` rows over many cycles (and can exceed the 900s cap on a big cohort). In
*live*, the picker at cohort T only sees rows already solved by T; a backtest reading the table
*today* sees every row ever solved, including ones solved minutes-to-cycles later — so the backtest
is **more complete than live was**, which is optimism. (2) **Cohort union.** The dual-source chain
carries two `observedAt` timestamps per logical 30-min cycle (Schwab + CBOE). A naive `max(time)`
or a join that pulls a later CBOE row into an earlier decision leaks future data across the seam.

**Why it happens:**
The schema records `observedAt` but the BSM solve happens in-place via upsert — there is likely **no
`bsm_solved_at` column**, so the as-of-solved set at time T is not perfectly reconstructable from
the table today. And the documented cohort semantics ("union per 30-minute slot, not `max(time)`")
are a live-read discipline that a backtest author can forget to replicate.

**How to avoid:**
Replay per 30-minute slot with the same **per-contract-latest, deduped, union** semantics the live
readers use (`readLegObsForGex` is the reference). For the BSM lag: either record a solve timestamp
so the as-of-solved set is reconstructable, or **explicitly flag the residual optimism** ("backtest
assumes greeks were available at cohort time; live BSM drain may lag") and keep it out of the
"proven" column. Prefer validating against `picker_snapshot` (Pitfall 2) — those rows already
encode what the live picker actually saw, drain lag included.

**Warning signs:**
Backtest greeks present for a cohort where live `picker_snapshot` had NULL-derived scores; replay
joins on `max(observedAt)`; edge numbers better than the live picker recorded.

**Phase to address:** backtest harness phase; ties to the BSM-drain / `bsm_solved_at` ops rider.

---

### Pitfall 4: Mid-fill optimism and fill-model divergence (entry AND exit)

**What goes wrong:**
The live picker already prices entries with the ORATS 66%-of-width haircut — good. The trap is the
**exit side of the backtest** closing at mid. Exiting a calendar means selling the back and buying
the front — you cross the spread *again*. Modeling the exit at mid overstates realized edge exactly
as entering at mid would, and it is the more dangerous half because exit marks decide the +5/+10/+15%
ladder. Compounding it: stored chains are 30-min snapshots, so the backtest can only fill at snapshot
marks while real fills happen at arbitrary intraday times — unmodeled slippage.

**Why it happens:**
Entry haircut is visible in `candidate-selection.ts`; the exit path is new code and mid is the
obvious default. The snapshot cadence makes intraday slippage invisible.

**How to avoid:**
**One shared fill function** used by the live picker and both sides of the backtest — extend the
existing haircut to the exit leg. Then **calibrate against the 13 real fills** (the oracle from the
journal P&L ledger fix): if the model says +$400 and the real fill netted +$150, the haircut is too
generous. Report backtest P&L as a **range (mid → full-haircut)**, never a single number, so the
optimism band is explicit.

**Warning signs:**
Exit modeled at mid; backtest exit P&L exceeds the real fill for a trade you can check; entry and
exit use different fill code.

**Phase to address:** backtest harness phase (calibration reuses the journal P&L oracle).

---

### Pitfall 5: Survivorship in the 13 trades and in strike selection

**What goes wrong:**
Two survivorship flavors. (1) The 13 closed calendars are the ones the trader *chose to open and
chose to close* — they survived his selection and his exit judgment. Fitting entry rules to them
measures "what he already did," not "what the engine would independently pick," and inflates apparent
skill toward 100%. (2) In the strike replay, only strikes that stayed liquid (OI≥100, tight spread)
are reliably present in `leg_observations`; illiquid strikes the engine would have *correctly
rejected* are underrepresented, so the backtest can't see its own good rejections and overstates hit
rate.

**Why it happens:**
You backtest on the data you have, and the data you have is survivors — the classic survivorship
bias that inflates equity backtests 1–3%/yr, here concentrated in a tiny hand-picked set.

**How to avoid:**
**Separate the two evaluation questions.** Use the 13 trades to test the **exit rules** (did the
ladder beat his actual exits? — real fills are the oracle) and to sanity-check entry scores, **not**
to fit entry weights. To test the **entry engine** honestly, replay the **full candidate universe**
at each historical cohort (every band-scan strike, including rejected ones) through the same
generation code, and measure what the engine *would* have picked and how those hypothetical trades
would have fared. Acknowledge in the output that a 6-week single-trader dataset cannot be fully
de-survivored.

**Warning signs:**
Entry backtest hit rate near 100%; the replay set contains only traded strikes; "the engine agrees
with every trade I made" (it's testing on your own survivors).

**Phase to address:** backtest harness phase.

---

### Pitfall 6: Exit-verdict flapping between cycles

**What goes wrong:**
The exit advisor emits HOLD/TAKE/STOP/ROLL/EXIT-pre-event every picker cycle (every 30 min, 24/7).
Near a ladder threshold (+5% take, −25% stop), a mark that oscillates around the boundary flips the
verdict cycle to cycle — TAKE, HOLD, TAKE, STOP — off bid/ask-midpoint jitter and IV-recompute
noise. The panel looks jittery and untrustworthy, and the user can't act on a verdict that won't
sit still.

**Why it happens:**
Naive threshold comparison with no hysteresis and no cross-cycle state, applied to inherently noisy
marks.

**How to avoid:**
**Hysteresis / debounce.** Require a condition to hold for K consecutive cycles, or use a band (arm
TAKE at +5%, only downgrade below +3%). The playbook ladder is already banded (+5/+10/+15,
−25/−50) — snap verdicts to those discrete bands, not raw points. Carry verdict state across cycles
in the `picker_snapshot` append-history table (the JSONB history is the natural home). Surface the
reason **and how long the verdict has held**, not just the label.

**Warning signs:**
Verdict changes more than once an hour on a static position; two cohorts 30 min apart with near-
identical marks disagree; "it keeps changing its mind."

**Phase to address:** exit advisor phase.

---

### Pitfall 7: Acting on stale / after-hours / gap marks

**What goes wrong:**
The advisor fires STOP/TAKE off a mark that is stale (the ~74% gap rows with spot=0/NaN), after-hours
indicative (overnight boards legitimately empty and failing the liquidity gate), or derived from NULL
BSM greeks. A −25% STOP at 3am on an empty overnight board is pure noise, potentially panic-inducing,
and un-actionable (market closed).

**Why it happens:**
The fetch→bsm→…→picker chain runs 24/7 by design. An exit advisor that treats every cohort equally
emits verdicts on garbage cohorts. The `marketSession` label and gap rows exist but must be
*consciously* gated on the exit path.

**How to avoid:**
Make the advisor **session- and gap-aware**. Reuse the existing `marketSession: rth | after-hours`
label and the AH-indicative chip. Verdicts on AH/stale/gap cohorts are **display-only** ("indicative,
RTH will confirm") and **must not escalate to actionable STOP/TAKE**. Require a valid (non-null,
non-zero, non-NaN) spot + non-null net greeks + liquidity-passing legs before a verdict is
actionable; otherwise emit HOLD/UNKNOWN with a reason. This pitfall is the direct argument for
sequencing the **snapshot-gap ops fix** before/with the exit advisor — fixing gaps improves signal
quality at the source.

**Warning signs:**
Actionable verdicts timestamped outside RTH; STOP with spot=0; verdict computed where `bsm_iv IS
NULL`.

**Phase to address:** exit advisor phase; depends on / benefits from the snapshot-gap ops rider.

---

### Pitfall 8: P&L-basis mismatch (mid vs fill; points vs dollars)

**What goes wrong:**
The +5%/−25% ladder is a percentage of *what*? If current P&L is `(current mid − openNetDebit)`, it
mixes a mid-based current value against a fill-based cost basis, so the % is wrong by the whole
entry+exit haircut. Far worse in *this* system, which has a documented history of `openNetDebit`
unit bugs (dollars stored where points were expected → **−$319,850 reported for a +$395 trade**) and
`pnl_open` frozen-at-write staleness needing `recompute-snapshot-pnl`. An exit advisor that reads
`openNetDebit`/`pnl_open` without unit discipline produces a garbage ladder.

**Why it happens:**
P&L looks trivial; unit and basis discipline are invisible until a number is absurd.

**How to avoid:**
Define the % basis **explicitly and consistently**: current **haircut-exit** value vs the **actual
open fill debit** (the oracle), both in the same unit (points·100·qty). Reuse the validated fill
ledger from the journal-P&L fix — do not recompute basis independently. Never compute exit % off
mid. Add the same oracle discipline that fixed the journal: a known trade's exit % must match a
hand-computed value. Guard the `openNetDebit IS NULL` case (no prior OPEN event) — emit UNKNOWN,
never a fabricated %.

**Warning signs:**
Exit % implausibly large; verdict % disagrees with the journal P&L-attribution graph for the same
calendar; a NULL-basis calendar still shows a %.

**Phase to address:** exit advisor phase (reuse the journal P&L ledger + oracle).

---

### Pitfall 9: Advising exits the market can't fill

**What goes wrong:**
The advisor says TAKE at +12%, but the back leg is a wide, thin far-dated strike (the CBOE-breadth
legs that carry long-dated open positions) quoting a 15% spread. Crossing to exit gives back most of
the gain; the "+12%" evaporates. Or it advises EXIT-pre-event on an AH board with no bids —
theoretically right, practically unfillable.

**Why it happens:**
Entry has a liquidity gate; exit advice often doesn't. Calendars are held toward expiry, and the back
leg drifts out of the liquid window over the trade's life, so the exit market is systematically worse
than the entry market.

**How to avoid:**
Apply the **same liquidity gate to the current legs** before issuing an actionable exit — if the
current market fails `(ask−bid)/mid ≤ 0.10` and `OI ≥ 100`, downgrade to "illiquid — indicative."
Value the exit at the **haircut exit price** (what you'd actually get), not mid. Prefer **ROLL over
EXIT** when the back leg is illiquid but the front is liquid — this is already the playbook ladder's
roll rule.

**Warning signs:**
TAKE on a leg with a double-digit spread; modeled exit at mid vs at haircut differ by >30%.

**Phase to address:** exit advisor phase.

---

### Pitfall 10: Regime-gate data lag (EOD FRED vs intraday decisions)

**What goes wrong:**
The playbook port adds VIX < 25 and VIX/VIX3M < 0.95 gates, requiring the `VIXCLS3M` FRED series.
FRED publishes VIXCLS / VIXCLS3M **end-of-day, once daily, with a publication lag** (the 18:30 ET
`fetch-rates` run catches same-day; some series lag T+1). The picker runs every 30 min, 24/7. Gating
intraday entries on yesterday's (or this morning's stale) EOD vol is a decision-time/data-time
mismatch — a cousin of look-ahead. And it fails exactly when it matters: backwardation episodes are
**short (avg 3.3 days, median 1 day)**, so an EOD gate can be a full day behind a fast vol spike.

**Why it happens:**
FRED is the path of least resistance — already integrated for 8 macro series — and it is EOD by
nature. The gate reads `macro_observations` latest without regard to its resolution.

**How to avoid:**
Design the gate as a **slow, day-granularity regime filter** ("are we in a crisis regime"), not an
intraday trigger — VIX 25 rarely flips within a session, so daily resolution is defensible for a
regime read. If intraday freshness genuinely matters, source spot VIX from the CBOE adapter (already
used for VVIX) rather than FRED; intraday VIX3M would need a new CBOE source. **Stamp every gate
decision with the as-of date** of the vol data so staleness is visible. Decide **fail-open vs
fail-closed** for missing VIX3M explicitly and document it (a crisis gate failing *closed* blocks all
entries on missing data — that may be undesirable; fail-open risks trading blind into a spike).

**Warning signs:**
Gate uses a VIX value dated >1 day old during a fast move; gate decision inconsistent with the live
VIX print; missing VIX3M silently passes.

**Phase to address:** playbook port phase.

---

### Pitfall 11: Regime-gate flapping at thresholds

**What goes wrong:**
VIX oscillates around 25, or VIX/VIX3M around 0.95. On the boundary the gate flips open/closed, and
the whole candidate universe appears and vanishes. Because backwardation episodes are short (median 1
day), a single EOD print can trip and untrip the ratio gate — the user sees an unstable universe and
loses trust.

**Why it happens:**
Hard threshold, no hysteresis, applied to a noisy boundary value sampled once a day.

**How to avoid:**
Same hysteresis pattern as exit verdicts — **band the gate** (block above VIX 26, re-open below 24;
or require the regime to persist ≥1–2 days). Since the source is daily, day-level persistence is
natural and cheap. **Log gate transitions** (like the existing gates log drop counts) so flapping is
visible. Strongly consider a **graded score penalty near the boundary instead of a hard gate** — this
system already learned that lesson twice: the `event-blackout` and `term-inversion` hard gates were
**RETIRED** precisely because they deleted trades with edge. A VIX gate should inherit that scar and
lean toward a penalty band over a cliff.

**Warning signs:**
Candidate count swings widely day to day; the same structure is gated in and out on consecutive days;
gate transitions cluster at the threshold value.

**Phase to address:** playbook port phase.

---

### Pitfall 12: Gap-row poisoning of the backtest and percentiles

**What goes wrong:**
~74% of some snapshot windows are gap rows (spot=0/NaN); `snapshot-calendars` wrote empty rows
Jun 23–26 and a worker-down hole Jun 27–30. If the backtest replays these cohorts as valid, it fills
on spot=0 (infinite/garbage edge), poisons RV20 (a 0-return inflates stdev), and skews every
percentile/normalization built over the corpus. A single NaN through a `clamp01` can propagate
silently and corrupt a whole rule column.

**Why it happens:**
The backtest reads `leg_observations` / `calendar_snapshots` wholesale; gap rows are real rows a
naive query includes.

**How to avoid:**
An **explicit gap-row filter at the backtest data boundary** — reject cohorts where spot is 0/NaN,
greeks are NULL, or the cohort's row count is below a minimum. Treat gaps as **missing (skip the
cohort), never as zeros**. NaN-guard every normalization (the codebase's "null RV → 0, never
fabricated" rule is exactly the right instinct — extend it everywhere). **Report coverage**:
"replayed X of Y cohorts, skipped Z gap cohorts," so the user sees how thin the real data is. This is
a second argument for doing the **snapshot-gap ops fix before/with the backtest**.

**Warning signs:**
Absurd backtest edge; RV20 spikes; low coverage %; any replayed cohort with spot=0.

**Phase to address:** backtest harness phase; strongly benefits from the snapshot-gap ops fix first.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Auto-write rule weights from the backtest | Fast iteration | Overfits 13 correlated trades; ships false confidence into live picks | **Never** — human arbitrates; one weight change per run |
| Close backtest exits at mid | Simpler exit code | Overstates edge; diverges from the live haircut; corrupts the ladder | **Never** — reuse the shared haircut fill fn on both legs |
| First-write-wins `picker_snapshot`/exit-history | Trivial idempotency | Freezes a partial/AH/NULL-greek first write over a fuller RTH recompute (same class as the GEX premature-UPSERT bug) | Only if **completeness-gated** (BSM drained, spot valid, RTH) |
| Global percentile table over the full corpus | One query | Look-ahead leak invisible in a green run | **Never** — point-in-time trailing windows only |
| FRED-only VIX3M feeding a gate | Already integrated | EOD lag; a day behind a 1-day backwardation spike | Acceptable as a **slow day-granularity regime filter**, not an intraday trigger |
| Emit exit verdicts on every 24/7 cohort uniformly | One code path | Flapping + AH/gap noise + un-actionable off-hours STOPs | Only with **session/gap gating + hysteresis** |
| Point-metric backtest report (single P&L/Sharpe) on N=13 | Looks decisive | False precision; hides that CI spans zero | **Never** — report range/CI + coverage + "N=13, directional" |

---

## Integration Gotchas

Common mistakes when connecting to external services and internal seams.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FRED `VIXCLS3M` | Reading `.latest` as if it's intraday | It is EOD + publication-lagged; stamp the as-of date, treat as daily regime resolution, decide fail-open/closed on missing |
| Schwab+CBOE dual-source chain | `max(observedAt)` join for "latest cycle" | Union per 30-min slot, dedupe per contract newest-wins (mirror `readLegObsForGex`); a later CBOE row must not leak into an earlier decision |
| BSM greeks in `leg_observations` | Backtest reads final solved value | Solve happens late/in-place with no `bsm_solved_at`; reconstruct as-of-solved set or flag the optimism; prefer validating vs `picker_snapshot` |
| Real Schwab fills (the 13) | Using them to fit entry weights | They are survivors of the trader's own selection+exit; use as the **exit oracle** and P&L basis, not entry training data |
| `openNetDebit` / `pnl_open` | Reading for the exit % basis without unit checks | Documented dollars-vs-points and frozen-`pnl_open` bugs; reuse the validated journal fill ledger + `recompute-snapshot-pnl` discipline |

---

## Performance Traps

Patterns that work at small scale but fail as the corpus grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| BSM drain exceeds the 900s handler cap; `compute-picker` (last in chain) fires on a partially-solved cohort | Missing put wall / NULL-greek scores in the picker & exit verdict | Batched `writeBsm`, newest-first bounded read (partly shipped); completeness-gate the picker write | Large dual-source cohorts (~15k rows/cycle) |
| Backtest replays full chain × all cohorts × full universe in memory | Slow / OOM on a growing corpus | Stream per-cohort; cap the replay universe exactly as the live generator does | `leg_observations` since Jun-12 already large; worsens each cycle |
| Percentile/rank recomputed per candidate per cohort against all history | O(n²) replay time | Precompute trailing-window stats incrementally, point-in-time | Long history / many candidates per cohort |

---

## Security Mistakes

Domain-specific issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Wiring the exit advisor to auto-place orders | A flapping/stale/AH verdict trades real money on noise | Keep the advisor **display-only**, mirroring STRM-04 (stream is display-only; REST/human stays the fill authority) |
| Backfill/exit code logging broker fills or tokens | Credential/PII leak in logs | Existing rule: Schwab creds/tokens never in code, logs, or fixtures; fills stay out of logs |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Verdict with no reason or duration | Can't trust or act on a bare label | Show the rule that fired + how long the verdict has held + the fill-adjusted number |
| AH/indicative verdict shown as actionable | User acts on overnight noise | Reuse the AH-indicative chip; label "RTH will confirm"; never render STOP/TAKE as actionable off-hours |
| Backtest shows a point P&L/Sharpe on 13 trades | False precision; over-confidence | Show CI/range + coverage % + explicit "N=13, directional only" |
| Regime universe appears/vanishes daily | Confusion, distrust | Hysteresis band + a visible regime-state banner explaining why candidates are gated |

---

## "Looks Done But Isn't" Checklist

- [ ] **Backtest percentiles:** often missing point-in-time isolation — verify feeding a future-dated row does **not** change a past decision's score.
- [ ] **Backtest fidelity:** often missing the `picker_snapshot` reproduction check — verify the replay reproduces the recorded live score for every cohort that has one.
- [ ] **Backtest coverage:** often missing gap-cohort exclusion + coverage report — verify skipped-cohort count is surfaced and no replayed cohort has spot=0.
- [ ] **Backtest fills:** often missing the exit-side haircut — verify entry and exit use the one shared fill fn and P&L is a mid→haircut range.
- [ ] **Exit advisor stability:** often missing hysteresis — verify the verdict is stable across ≥3 cycles on a static position.
- [ ] **Exit advisor gating:** often missing session/liquidity gate — verify no actionable STOP/TAKE on an AH, spot=0, or illiquid cohort.
- [ ] **Exit advisor basis:** often missing an explicit % basis — verify the exit % matches the journal-ledger oracle for a known trade, and NULL-basis emits UNKNOWN.
- [ ] **Regime gate freshness:** often missing an as-of stamp + hysteresis — verify the gate uses fresh vol data and doesn't flip on one boundary print.
- [ ] **Pipeline completeness:** often missing a completeness gate — verify `compute-picker` sees a fully-drained cohort (not mid-BSM-drain).

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Overfit weights shipped | MEDIUM | Revert to user-locked weights (versioned in `rules.ts`, weight-sum test); weights are display-sourced so rollback is a reviewed code change |
| Backtest leakage discovered | LOW–MEDIUM | Re-run with point-in-time cutoff; the `picker_snapshot` reproduction test pins the regression |
| Exit advisor fired bad verdicts | LOW | Display-only means no capital moved; add hysteresis/gating and re-derive verdict history from the append log |
| Regime gate deleted good trades | MEDIUM | Same scar as the retired `term-inversion`/`event-blackout` gates — convert the hard gate to a penalty band; the universe regenerates next cycle |
| Gap rows poisoned the corpus | MEDIUM | Fix snapshot gaps (ops rider), re-run backtest with the gap filter; append-only tables mean no destructive loss |

---

## Pitfall-to-Phase Mapping

Suggested build order mirrors the milestone's stated order, with one **prerequisite ops rider**
surfaced by the data-quality pitfalls (7, 12, and the BSM/first-write-wins traps): the snapshot-gap
fix + batched BSM writes + completeness-gated picker snapshot should land **before or alongside** the
backtest and exit advisor, because both features inherit those defects directly.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Exit flapping (6) | Exit advisor | Verdict stable across ≥3 cycles on a static position |
| Stale/AH/gap marks (7) | Exit advisor (+ ops rider) | No actionable verdict on AH/spot=0/NULL-greek cohort |
| P&L-basis mismatch (8) | Exit advisor | Exit % matches journal-ledger oracle; NULL basis → UNKNOWN |
| Unfillable exits (9) | Exit advisor | No actionable TAKE on an illiquid leg; exit valued at haircut |
| Overfitting 13 trades (1) | Backtest harness | LOO stability + bootstrap CI reported; ≤1 weight change/run; no auto-write |
| Percentile leakage (2) | Backtest harness | Future row doesn't move a past score; reproduces `picker_snapshot` |
| Late-BSM / cohort union (3) | Backtest harness (+ ops rider) | Replay uses per-slot union; optimism flagged or `bsm_solved_at` recorded |
| Fill-model divergence (4) | Backtest harness | Shared haircut both legs; P&L reported as range; calibrated to 13 fills |
| Survivorship (5) | Backtest harness | Entry backtest replays full universe incl. rejected strikes |
| Gap-row poisoning (12) | Backtest harness (+ ops rider) | Gap filter + coverage report; no spot=0 in replay set |
| Regime data lag (10) | Playbook port | Gate stamped with vol as-of date; treated as daily filter; fail-mode documented |
| Regime flapping (11) | Playbook port | Hysteresis band; transitions logged; penalty-over-cliff considered |
| BSM-cap / first-write-wins | Ops rider (before/with backtest) | `compute-picker` sees a fully-drained cohort; snapshot completeness-gated |

---

## Sources

- [The critical pitfalls of backtesting trading strategies — StarQube](https://starqube.com/backtesting-investment-strategies/) — look-ahead, survivorship, overfitting taxonomy (HIGH)
- [Survivorship Bias in Backtesting Explained — LuxAlgo](https://www.luxalgo.com/blog/survivorship-bias-in-backtesting-explained/) — survivorship inflates returns 1–3%/yr (HIGH)
- [The Seven Sins of Quantitative Investing — Portfolio Optimization Book §8.2](https://portfoliooptimizationbook.com/book/8.2-seven-sins.html) — canonical backtest-sin list (HIGH)
- [Backtesting Mistakes That Kill Quant Strategies — Hedge Fund Alpha](https://hedgefundalpha.com/education/backtesting-mistakes-kill-quant-strategies-guide/) — overfitting via parameter search (HIGH)
- [Minimum Trades for a Valid Backtest — BacktestBase](https://www.backtestbase.com/education/how-many-trades-for-backtest) — 30 floor / 100 basic / 200–500 institutional; correlated trades shrink effective N (HIGH)
- [How Many Trades Are Enough — statistical significance in backtesting](https://medium.com/@trading.dude/how-many-trades-are-enough-a-guide-to-statistical-significance-in-backtesting-093c2eac6f05) — in-sample vs out-of-sample divergence as the overfit tell (MEDIUM)
- [Put Calendar Spread Guide — Option Alpha](https://optionalpha.com/strategies/put-calendar-spread) — exit discipline, close 5–10 DTE, roll at 7 DTE (HIGH)
- [Calendar Spreads 101 — OptionsTradingIQ](https://optionstradingiq.com/calendar-spreads/) — 50%-profit-in-50%-duration take rule (banded exits → argues for hysteresis) (HIGH)
- [VIX Term Structure — VolRadar](https://volradar.com/learn/term-structure) — VIX/VIX3M<1.0 = contango (~80% of time) (HIGH)
- [VIX Term Structure — Raven Quant](https://ravenquant.com/vix-term-structure/) — backwardation episodes avg 3.3 days / median 1 day; term structure as a fast early-warning regime signal (MEDIUM)
- Repo docs read directly: `docs/architecture/picker-rules.md`, `docs/architecture/jobs.md`, `.planning/PROJECT.md` — rule registry, gate history (retired hard gates), dual-source cohort semantics, BSM drain, fill haircut, `marketSession` labeling (HIGH)
- Incident history (project memory): journal-P&L fill-ledger fix (−$319,850 oracle), GEX premature-UPSERT / BSM-starvation NULL greeks, snapshot ~74% gap rows (HIGH)

---
*Pitfalls research for: exit advisor + options backtest harness + regime gates on an existing SPX calendar system*
*Researched: 2026-07-09*
