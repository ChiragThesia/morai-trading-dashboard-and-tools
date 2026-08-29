# Trading Rules Spec — salvaged from `packages/core/src/calendar/domain/` and `packages/core/src/picker/domain/`

This document is a specification, not a code port. The code that produced it is being deleted;
everything here is what a reimplementer needs and the code's structure (classes, ports, file
layout) is not among those things. All numbers are quoted verbatim from source comments and are
either MEASURED (an experiment ran, a result is recorded) or explicitly marked ASSUMED/UNJUSTIFIED
— read the label before trusting a constant.

There were **two separate ranking engines** in this codebase, not one:

1. **The calendar engine** (`calendar/domain/`) — a lean, 4-stage, 2-term cross-sectional ranker
   built after a rewrite that stripped an earlier over-fit design down to what the live chain could
   actually justify. This is the newer, more battle-tested design.
2. **The picker engine** (`picker/domain/`) — an earlier, richer 9-term weighted-score engine with
   gates, brakes, a VIX-based entry gate, and position sizing. Encodes a 25-claim, 20-source, 3-vote
   adversarial research pass (`.planning/research/calendar-selection-criteria.md`), plus a string of
   user-locked weight changes dated through 2026-07-15.

Both are captured in full below. Where they duplicate a concept (forward IV, the fill haircut) the
formula is identical — they share `computeFwdIv` and `haircutFill` at the code level, so a
reimplementation should keep them as one shared primitive.

---

## 1. The calendar cohort model (`calendar/domain/cohort.ts`, `types.ts`)

### 1.1 What a cohort is

A **cohort** is all chain quotes grouped by `(root, expiration)`, for one contract type (this
engine only builds puts). `root` is `"SPX"` (AM-settled, third-Friday monthlies) or `"SPXW"`
(PM-settled weeklies); absent root defaults to `"SPXW"`.

Within a cohort, quotes are deduplicated **by strike**, keeping the newest observation and, on a
tie, the higher IV. The whole quote set is sorted into a total order first — `root, expiration,
strike, time, iv` — so dedup and downstream iteration are never a function of input arrival order
(the chain is a two-vendor union, so arrival order is not a property of the data).

A strike is priced into a `CohortLeg` (BSM greeks solved) only if its IV is usable. A strike the
cohort quotes but cannot price stays in `unpricedStrikes` — **never dropped silently**. The two
sets are defined as `quoted − priced`, which is the only definition under which they provably
partition the ladder (filtering on IV parseability instead would silently disagree the first time
a row's IV parses but its greeks come out non-finite).

Legs that fail the tradeability test (see §1.7) are **kept in the cohort, marked untradeable** —
an unquotable strike still belongs to the smile that defines the ATM reference. Only candidate
enumeration (stage 2) requires tradeability.

### 1.2 One spot per snapshot

`snapshotSpot` — the **lower median** of every quote's `underlyingPrice` across the whole
snapshot (both wings, all cohorts), not per-row. Rationale: spot is a single global quantity; the
per-row spread is vendor noise. Median (not mean) so one stale row from the other vendor moves
nothing. **Lower** median (not the midpoint of the two middle values) so the result is a price
that was actually observed, never invented. Returns `null` when no row carries a positive finite
spot (an honest "no nearest" on a gap cycle).

### 1.3 The four recorded "scars" (why the cohort model looks the way it does)

**Scar 1 — root must be part of the per-strike key.**
SPX (AM-settled monthlies) and SPXW (PM-settled weeklies) can quote the *same strike on the same
date* with different books. A root-blind cohort **once measured a back IV of 68.89% against a
front of 24.69% at strike 6675** — a single number that made no sense once root was added back to
the key. Root is baked into the group key `(root, expiration)`, so a root-blind cohort is not
constructible in this design.

**Scar 2 — `bsmIv` has three states, not two.**
The stored `bsm_iv` column is `string | null`:
- `null` — never processed (the IV drain is bounded at **800 rows a pass**, so older rows can stay
  null indefinitely);
- the literal string `'NaN'` — inversion **permanently failed** for that row;
- anything else — parses to a real number.

`parseIv` treats both `null` and `'NaN'` (via `parseFloat` → `NaN` → finiteness check) as "no
value," and additionally rejects any IV `≤ 0` (gamma and vega divide by sigma). **Measured on the
live chain read this engine actually consumes, 2026-07-28: 5,768 put rows, of which 700 are
`null` and 708 are the literal `'NaN'` — 1,408 legs, 24.4% of the wing**, previously silently
reported as zero drops.

**Scar 3 — one spot for the snapshot, not one spot per leg.**
The chain is a two-vendor union, so `rows[0]` is whichever vendor's row landed first. A design
that measures the ATM reference against a screen-wide first row while pricing each leg against
its own row's spot ends up with **two different spots on one screen**. Fixed by `snapshotSpot`
(§1.2) — one spot, used everywhere.

**Scar 4 — one carry for the snapshot, and it must be the carry `bsm_iv` was inverted at.**
The module used to accept a *per-expiry* `carryOf` array with a flat fallback, pricing the two
legs of one calendar at different `(r, q)`. **Measured before/after against the live chain,
2026-07-28, read-only, same chain read for both sides:**

| Carry source | Mixed-carry candidates | Top-10 pair changes |
|---|---|---|
| latest carry array (2 solved expiries) | 3,313 of 5,917 (**56%**) | 1 of top 10 changed strike |
| 43-expiry array, same chain | 1,150 of 6,850 (**17%**) | 8 of top 10 changed strike, largest move **7400 → 7375** |

Both runs also **reordered the top-10 pairs themselves**, which strike-level framing does not
predict — carry reaches the pair *score* too, because `atm50Iv` interpolates to `|delta| = 0.50`
and delta is exactly what carry moves. A mixed-carry pair mismeasures its forward factor, not just
its strike.

The per-expiry carry was not "more faithful" than the flat one — the fix is **one carry**, not
"better" carry. `implied_carry` (per-expiry, put-call-parity-solved) and `bsm_iv` (inverted with
`r` = the DGS3MO observation for the row's date, `q` = a constant `BSM_DIVIDEND_YIELD`) are two
*different* computations. The flat carry matches the inversion's `q` **exactly** (both server and
worker configs default `q = 0.013`), where the solved per-expiry `q` on 2026-07-28 read **0.0002
and 0.0013** — an order of magnitude off. Repricing at a carry the inversion did not use breaks
the repo-wide law "invert → reprice shares (r, q)". Conclusion: use the flat, single-carry
snapshot value that matches whatever `(r, q)` the stored IV was inverted at — never a per-expiry
array, however "more accurate" it looks in isolation.

### 1.4 DTE and settlement clock (also see §2)

`dte` in a cohort is computed with `< 0` rejection, not `<= 0`: DTE 0 means "expires today, still
trading." The bug this fixes: conflating the two used to cost the chain table **every 0DTE row —
192 quoted SPXW puts on one day (2026-07-29)** alone. Whether a contract has *settled* (as opposed
to merely reached its calendar expiration date) is a separate, root-aware question answered by
`yearsToSettlement` (§2), because calendar-day counting cannot know AM vs PM settlement.

### 1.5 The ATM reference is interpolated, not picked

Two ATM references exist per cohort:

- `atmIv` — the IV of the strike nearest spot (ties break to the **lower** strike, for an
  order-independent pick), resolved over the full quoted union (priced + unpriced) so a strike
  that never solved is never silently replaced by a neighbour's IV — this was a real prior bug: a
  strike 48 points from the money was once labelled ATM because the true nearest strike hadn't
  solved.
- `atm50Iv` — IV **linearly interpolated in delta** to exactly `|delta| = 0.50`, between the
  tightest bracketing pair of legs. This is the doctrine's ATM and the one term-structure math is
  computed from.

**Why interpolate rather than pick nearest-strike:** picking lets front and back cohorts' ATM
references sit at *different* deltas, and skew turns that mismatch into a systematic bias in the
forward factor. Measured on the live chain:

| Pair | Front / Back |Δ| | FF picked | FF interpolated |
|---|---|---|---|
| SPX 17/53d | 0.43 vs 0.50 | 21.35% | 10.91% |
| SPXW 35/65d | 0.497 vs 0.4997 | 0.09% | 0.54% |

Half of that 21% gap was pure delta mismatch, not signal. Where both references already sit near
50 delta, picked and interpolated agree to within half a point — interpolation costs nothing on a
dense ladder and removes a real artifact on a sparse one. Also recorded (`types.ts`): interpolating
vs picking nearest is worth **10.4 forward-factor points on one live SPX pair**.

Interpolation constants:
- `TARGET_ABS_DELTA = 0.5`
- `MAX_BRACKET_WIDTH = 0.3` — widest delta-space gap the interpolation will trust. Justification:
  same policy and same threshold as the 25Δ risk reversal interpolator elsewhere in the repo
  (`analytics/domain/risk-reversal.ts`) — a stated precedent, not a fresh measurement for this
  module.
- **Never extrapolated.** A cohort whose legs sit entirely on one side of 50 delta has no ATM
  reference at all (`atm50Iv: null`), and every pair built from it is dropped with a named reason
  (`no-atm-reference`), never substituted.
- A delta magnitude `≥ 1` is treated as a mis-signed/unstable solve and excluded from bracketing.

### 1.6 Strike scale and matching across expiries

Strikes arrive `×1000` from the chain (e.g. `7_400_000` = index level 7400); converted to points
exactly once, in `buildCohorts` (`STRIKE_SCALE = 1000`). No domain code below that point ever sees
the `×1000` form. Matching a strike across two expiries (for pair math) is a plain equality on the
converted point value via a `Map<strike, leg>` keyed per cohort.

### 1.7 Tradeability gate (not a score term)

```
tradeable = bid > 0 && ask >= bid && mid > 0 && (ask − bid) / mid <= MAX_SPREAD_FRACTION
```

`MAX_SPREAD_FRACTION = 0.15` (15% of mid). **Deliberately loose**: measured on SPX puts at
15–90 DTE, the spread is **p50 0.6% of mid, p90 1.0%** — this bound exists to catch genuine
garbage quotes, not to discriminate among real ones. Explicitly *never* used as a score term: "the
doctrine's 12%/22%/58% figures are retail single-name weeklies and mean nothing here" (a direct
refutation of applying single-name spread doctrine to SPX).

`extrinsic = max(mid − intrinsic, 0)` — floored at zero because a mid below intrinsic is a quote
artifact, not real negative time value; this is the denominator of the theta-carry score term, so
a negative value would flip its sign.

---

## 2. Forward volatility and the settlement clock (`calendar/domain/time.ts`, `picker/domain/fwd-iv.ts`)

### 2.1 The formula

The forward-variance identity, used identically in both engines:

```
radicand = (T_back·IV_back² − T_front·IV_front²) / (T_back − T_front)
fwdIv    = sqrt(radicand)        if radicand >= 0   (guard: "ok")
fwdIv    = null                  if radicand <  0   (guard: "inverted")
```

`radicand === 0` is a **valid degenerate "ok" result** (`fwdIv = 0`), not inverted — the guard
only rejects `radicand < 0`. This function is scale-invariant in `T` (days or years give the same
answer as long as both legs use the same units) — but see §2.3 for why that invariance does not
mean the *choice* of clock is free.

Two additional guards live in the caller (`pair.ts`), not inside `computeFwdIv` itself, because
the function alone will happily return a clean-looking `NaN`-free wrong answer otherwise:
- `back.t <= front.t` must be rejected by the caller — `computeFwdIv` only guards a negative
  radicand, so an equal or inverted `(t_f, t_b)` pair reaches it as a division by zero and comes
  back as `sqrt(NaN)` tagged `guard: "ok"`.
- A null/unpriced leg IV must be rejected by the caller — a null arriving as `0` variance solves
  cleanly to a plausible-looking forward vol.

### 2.2 Which clock: settlement instant, not calendar days

`yearsToSettlement(now, expiration, root)` returns **years to the exact settlement instant** —
09:30 ET for AM-settled SPX on its exact third Friday, 16:00 ET (PM) for everything else — via the
shared, DST-safe `settlementTimestamp`. Zero (never negative, never NaN) for an unparseable or
already-settled expiration.

This is deliberately **not** the same as `calendarDaysTo`, the whole-day DTE counter the gates use
(front ≥ 15 DTE etc.). Measured cost of conflating them: **from 16:00Z, a 15-calendar-day expiry
reads T = 15.67 days if measured to UTC midnight instead of the settlement instant** — and mixing
whole-day DTE against settlement-aware T is exactly what made a theta reading come out visibly low
against ThinkOrSwim in production once already.

The repo carried **nine separate time-to-expiry definitions**, two of which took a `Date` and
disagreed about UTC vs local component reads — passing the wrong flavor to either is a silent
one-day error. The fix adopted here: **take the expiration as a `YYYY-MM-DD` string**, never a
`Date`, so there is no ambiguous flavor for a caller to get wrong; the one place a `Date` is
constructed (`yearsToSettlement`, to satisfy `settlementTimestamp`'s local-reader contract) builds
it internally, never accepts one from a caller.

`calendarDaysTo` is intentionally **not derived from `yearsToSettlement`** — rounding T loses
information in both directions: from 04:00Z a 15-calendar-day expiry is `T = 15.67` days, and an
AM-settled expiry 25 calendar days out is `T = 24.9`.

### 2.3 Why the settlement clock and not a calendar-day count, specifically for the pair math

`pair.ts`'s `PairLeg.t` is documented as years-to-settlement, never whole DTE days, and the reason
given is precise: `computeFwdIv` is scale-invariant under a *uniform* rescale of both legs' `t`,
but **the settlement clock is not a uniform rescale of calendar-day DTE**. AM (09:30 ET)
settlement lands *before* the expiry day's UTC midnight; PM (16:00 ET) settlement lands *after*
it. So `t_front / t_back ≠ dte_front / dte_back` in general, and the computed forward vol
genuinely moves by an amount **whose sign flips depending on which leg's root is AM vs PM
settled**. This is why root-mismatched pairs are blocked entirely at the candidate-enumeration
stage (§3) rather than merely adjusted for.

### 2.4 BSM year basis

`DAYS_PER_YEAR = 365.25`, matching `bsmGreeks`' theta convention and every other T-computation in
the repo — stated as a consistency requirement, not independently measured here.

---

## 3. The calendar candidate enumeration (`calendar/domain/candidate.ts`)

### 3.1 Hard gates (not knobs)

The trader's own stated rule, encoded as **non-configurable constants**:

- `FRONT_DTE_FLOOR = 15` — "minimum 15 DTE for my short."
- `GAP_DAYS_FLOOR = 15` — "minimum 15 days between short and long."

These floors have no override parameter. `EnumerateOptions.frontDteMax` is a real knob (the trader
works several front-leg windows: 15/30, 21/45, 30/60, 21/60) but cannot lower the floor — passing a
value under it simply yields nothing, by construction.

- `BACK_DTE_CEILING = 90` — **not a trading preference, a data bound.** Ingest only fetches chain
  data out to 90 DTE (`BSM_MAX_DTE`); nothing past it exists to rank. If the data pipeline's fetch
  horizon changes, this ceiling must move with it.

Root mismatch between front and back legs is a hard drop (`root-mismatch`): "mixing AM- and
PM-settled legs changes the front leg's expiry-day risk, and nothing in the doctrine covers it.
Blocked in v1" — an explicit acknowledgment this is a scope decision, not a proven-harmful
combination.

Enumeration is exhaustive, not sampled: measured on the live chain, front 15–60 DTE with gap ≥ 15
and back ≤ 90 produces **124 expiry pairs and 2,454 full calendars** — small enough that no
pruning heuristic is needed.

### 3.2 Term structure is measured at 50-delta, never at the traded strike

The single most important measurement decision in this module: `fwdIv`, `cushion`, `ffAtm`
(forward factor), and `slope` are all computed from each cohort's **50-delta interpolated IV**
(`atm50Iv`, §1.5) — never from the two IVs of the strike actually being traded.

**Why:** reading term structure off the traded strike measures *skew*, not term structure.
Measured on the live chain, ranking candidates by *per-strike* forward factor put the top four
candidates **302, 277, 252, and 102 points from spot**, at forward factors up to **14.4%**, while
the best genuinely near-the-money candidate read **7.7%**. SPX's front-month smile is steeper than
its back-month smile, so a deep strike shows local backwardation that looks like a term-structure
signal but is not one.

The per-strike reading is still computed and reported (`ffStrike`), for the reader's information —
it is simply never scored.

### 3.3 Formulas

Given front/back 50-delta references `frontRef`, `backRef` and their years-to-settlement `t`:

```
fwd    = computeFwdIv(front.t, frontRef, back.t, backRef)
        → drop (term-inverted) if guard === "inverted" OR fwdIv <= 0
ffAtm    = frontRef / fwd.fwdIv − 1                          // the scored forward factor
cushion  = backRef − fwd.fwdIv                                // loss condition: back falls to fwd
slope    = (backRef − frontRef) / (back.t − front.t)
```

At the traded strike (reported only):
```
ffStrike   = frontLeg.iv / strikeFwd.fwdIv − 1   (null if that pair's own guard fires)
hSkew      = frontLeg.iv − backLeg.iv             // horizontal skew at this strike
vSkewFront = frontLeg.iv − front.atmIv            // how far up the front smile this strike sits
vSkewBack  = backLeg.iv − back.atmIv
```

Net greeks: `back − front` on delta/gamma/theta/vega (a calendar is short gamma, long vega — the
sign convention makes that visible directly).

Entry debit: `haircutFill(backLeg, "buy") − haircutFill(frontLeg, "sell")` — buy the back leg up
toward its ask, sell the front leg down toward its bid, **never at mid** ("ranking on mid
overstates every edge"). See §6.3 for the haircut formula (shared with the picker engine, both at
fraction 0.66).

`spreadCost = (backLeg.ask − backLeg.bid) + (frontLeg.ask − frontLeg.bid)` — one-way cost of
crossing both legs' spreads, reported, never scored (see §4, "what is not here").

### 3.4 Normalized theta carry

```
thetaCarry = (−frontLeg.theta / frontLeg.extrinsic) − (−backLeg.theta / backLeg.extrinsic)
```

Null when either leg has zero or negative extrinsic (no rate to quote; a divide-by-zero would
produce an infinity that looks like a very good score). Positive and large = the front is burning
much faster than the back, which is the calendar-seller's thesis. `bsmGreeks` returns theta
negative for a long option, so `−θ/extrinsic` is the decay *rate*, a positive number — the
subtraction is oriented so larger is always better for a seller.

This normalized ratio is reported but **never scored** in the calendar engine (see §4) — it *is*
one of the picker engine's design considerations (the doctrine's own measure, "roughly 3% a day at
30 DTE, 10% at 10 DTE, 100% on the last day" — an assumed practitioner figure, not independently
measured here).

---

## 4. The calendar ranking/scoring engine (`calendar/domain/score.ts`)

### 4.1 The core design decision: percentile rank, not absolute threshold

The published doctrine states absolute gates: a Forward Factor of 16–20% to enter, a 17-vol-point
cushion, a 3-vol-point fair-value edge. All of these were **calibrated on single names and sector
ETFs at 60–105% implied vol**. SPX runs around 16% IV, and dispersion scales with the underlying's
vol level.

**Measured across all 2,465 candidates in a live snapshot: the maximum Forward Factor was 14.4%,
the median 0.36%, and the 16% doctrine gate fired ZERO times.** The cushion's median was **+0.02
vol points** against the doctrine's 17.

An engine built on the doctrine's absolute constants returns an empty list every day and *looks*
like it is working. The chosen fix: rank candidates **against each other, within the same
snapshot** — the same relative-value frame the doctrine itself uses elsewhere, requires no price
history, and is exactly reproducible from one chain read.

**Stated cost of this choice, explicitly:** a rank says which calendar is best *among what's
available today*. It does **not** say whether that calendar is objectively good. The raw value of
every scored term rides along in the breakdown specifically so a reader can apply the doctrine's
absolute bars themselves once there is enough history to band them properly.

### 4.2 The two scored terms

```
SCORE_WEIGHTS = { fwdEdge: 70, deltaBalance: 30 }   // sums to 100
```

- **`fwdEdge` (weight 70)** = raw value is `ffAtm` (§3.3). "A calendar IS a forward-volatility
  trade and nothing else" — picks the expiry *pair*, strike-invariant by construction.
- **`deltaBalance` (weight 30)** = raw ranking value is `−|net.delta|` (negated so larger is
  always better, matching every other term's convention); the value shown to the reader is the
  signed `net.delta` itself. Picks the *strike* within a chosen pair.

Percentile computed via `percentileRank(value, distribution)` over the snapshot's own candidates
(`h <= value` counting convention — this detail matters, see §4.4). A term with **zero measurable
values anywhere in the snapshot is INACTIVE**: its weight is removed and the remaining active
term(s) renormalize back up to 100, so a snapshot missing one term's data is still comparable to
one that has it. A candidate with no value on an *active* term scores **zero** on that term — never
skipped, because skipping would reward missing data.

Final tie-break order (fully deterministic, never a function of input array position): score desc
→ `ffAtm` desc → `|net.delta|` asc → `debit` asc → `root` → `frontExpiration` → `backExpiration`
→ `strike`.

### 4.3 What was tried, measured, and explicitly removed (the calendar engine's refutations)

**`thetaCarry` (was weight 20) — REMOVED.** Ranked a live candidate **721 points out of the
money** as a top pick. Root cause: theta-as-share-of-extrinsic is **U-shaped in strike** with its
minimum *at the money* — measured across one pair's ladder: **0.0302 at 736 points OTM, 0.0074 at
16 points OTM, 0.0285 at 244 points ITM**. Ranking a U-shaped metric rewards whichever extreme
strike happens to be available, not the best trade. The doctrine itself only ever uses this ratio
to compare *tenors*, never to rank *strikes* within a tenor — the term was misapplied, not merely
miscalibrated.

**`frontVrp` (was weight 25) — REMOVED.** Defined as `IV_front(50Δ) − RV20`, where `RV20` is
**one scalar for the entire snapshot**. Because `percentileRank` counts `h <= value`, subtracting
the *same constant* from every candidate changes no relative comparison whatsoever — **measured
on the live chain, doubling realized vol from 0.12 to 0.30 left the ranking byte-identical.**
The term's stated justification for existing — "the only term that looks outside the chain,
therefore the only one not collinear with `fwdEdge`" — failed on **both** counts: what it actually
ranked was `frontRefIv` (a per-cohort constant, only **21 distinct values across 7,951
candidates**), and because a richer front leg mechanically lowers forward vol, it moved in lockstep
with `fwdEdge`. **Measured correlation between the two terms' percentiles: 0.954.**

Both removed weights (20 + 25 = 45... but stated explicitly: "both removed weights went to
`fwdEdge`, leaving the strike discriminator [deltaBalance] untouched at 30") were folded into
`fwdEdge`. These reallocations are described as "the doctrine's emphasis plus two measured
corrections" and explicitly flagged: **"should be re-derived against a backtest, never adjusted by
feel."**

A variance risk premium on a single underlying is *snapshot context*, not a cross-sectional
signal — it's still reported (`CalendarRanking.realizedVol` alongside every candidate's
`frontRefIv`), just never scored.

### 4.4 What is deliberately never scored, and why (calendar engine)

- **Net vega** — "root-time flat": short-dated IV moves ~`1/√T` while vega grows `~√T`, so
  `vega × Δσ` is roughly constant across the term structure. Ranking it ranks nothing. Stated as
  "the one prohibition the corpus states outright" — i.e., this is the strongest-sourced
  refutation in the file, not an in-house measurement.
- **Net theta**, raw or extrinsic-normalized — raw theta is bought with short gamma in exact
  proportion (ranks the most dangerous front expiry); extrinsic-normalized is U-shaped in strike
  (§4.3, same failure mode as the removed `thetaCarry` term). Both reported, neither scored.
- **Cushion, slope, per-strike forward factor** — all monotone re-expressions of the same two
  50-delta IVs already captured by `fwdEdge`. Scoring them would triple-count one signal.
- **Spread cost and open interest** — measured inert-to-harmful on SPX: spread is p90 1.0% of mid
  (§1.7); an OI ≥ 100 gate would remove **82% of candidates, including 69% of the near-the-money
  SPXW ladder**. "A near-constant term is noise with a weight attached."
- **Anything ranked against price/vol history** — "there are 30 days of it," i.e., not enough
  history exists yet to build a real time-series signal honestly.

---

## 5. Every gate/threshold in the calendar engine, one table

| Constant | Value | Sourced / Assumed | Filters |
|---|---|---|---|
| `FRONT_DTE_FLOOR` | 15 days | User's stated trading rule (hard, non-configurable) | Front leg minimum DTE |
| `GAP_DAYS_FLOOR` | 15 days | User's stated trading rule (hard, non-configurable) | Min gap between front/back |
| `BACK_DTE_CEILING` | 90 days | Data bound (ingest fetch horizon `BSM_MAX_DTE`), not a preference | Back leg maximum DTE |
| `MAX_SPREAD_FRACTION` | 0.15 (15% of mid) | Measured (p50 0.6%, p90 1.0% on real SPX puts 15–90 DTE) — deliberately loose | Tradeable-quote gate |
| `TARGET_ABS_DELTA` | 0.50 | Definitional (doctrine's ATM) | 50-delta interpolation target |
| `MAX_BRACKET_WIDTH` | 0.30 | Borrowed precedent from `risk-reversal.ts`'s 25Δ interpolator, not independently measured here | Refuses 50-delta interpolation across too-sparse a smile |
| `STRIKE_SCALE` | 1000 | Vendor data convention | Strike unit conversion |
| Root mismatch | hard drop | Scope decision ("blocked in v1"), not a proven-harmful measurement | Cross-root pairs |

---

## 6. The picker engine (`picker/domain/`)

This is a separate, earlier, more elaborate engine: a 9-term weighted score (not percentile-rank),
plus an entry gate, brake system, and sizing tiers. It encodes a formal research pass:
`.planning/research/calendar-selection-criteria.md` — **102 agents, 20 sources, 25 claims, 3-vote
adversarial verification: 19 confirmed, 6 refuted**, dated 2026-07-02 — plus a sequence of
user-locked weight changes on 2026-07-08, -09, and -15.

### 6.1 The registry and current weights (`rules.ts`)

Active score weights (sum to 100, enforced by a test):

| Rule | Weight | Direction / formula |
|---|---|---|
| `fwdEdge` | 25 | `clamp01((frontIv − fwdIv + 0.02) / 0.04)` — see §6.2 |
| `slope` | 10 | `slopeEntryFraction(slope)` — see §6.5 |
| `gexFit` | 10 | 0–1 near-term GEX placement fraction — see §6.6 |
| `eventAdjustment` | 5 | `max(0, 1 − eventPenalty)` — see §6.7 |
| `beVsEm` | 15 | breakeven-width vs expected-move ratio — see §6.8 |
| `deltaNeutral` | 15 | `1 − |netΔ|/5`, clamped [0,1] |
| `thetaVega` | 10 | `clamp01((θ/vega)/0.20)` |
| `vrp` | 5 | `clamp01((frontIv−RV20)/0.03)` |
| `debitFit` | 5 | preference band on haircut debit — see §6.9 |

**History of the weight split** (stated in `rules.ts`): as of 2026-07-08, `fwdEdge`/`slope` were
35/30; the 2026-07-09 promotions of `thetaVega`, `vrp`, and `debitFit` from experimental to scored
took weight from both, landing at the current 25/10.

Two gates (weight 0, pass/fail, applied before scoring):

- **`net-theta-positive`** — "a calendar with negative carry has no edge thesis — dropped before
  scoring" (Phase-19 criterion 6).
- **`liquidity`** — `isLiquidQuote`: `(ask − bid)/mid ≤ LIQUIDITY_MAX_SPREAD_FRAC` (0.10, i.e.
  10% — note this is a *tighter* bound than the calendar engine's 15%, and applies per-leg not
  per-cohort) **AND** `openInterest ≥ LIQUIDITY_MIN_OI` (100). "Untradeable markets produce
  fictional debits and breakevens — better no candidate than a fantasy one."

Two experimental (weight-0, display-only, "calibrating") entries not yet promoted:
- `slopePercentile` — candidate slope ranked against the trailing snapshot-corpus slope
  distribution (cites Johnson 2017). Display-only pending PICK-04.
- `backEventBonus` — 1 if the back leg spans an event the front leg does not (the long leg "owns"
  that event's vol the short leg never faces). Display-only pending PICK-05.

A **retired** back-event bonus (`WEIGHT_BACK_EVENT_BONUS = 10`) is kept as a **read-path
compatibility constant only** — old stored `picker_snapshot` rows tagged `bucket:
"event-calendar"` included this bonus in their stored score, and a re-score/preview path needs to
reproduce that exact historical number. This constant carries **zero forward-going scoring
meaning** — a rebuild does not need this bucket concept at all, only (if it ever reads old stored
snapshots) the number to reproduce their historical score.

### 6.2 fwdEdge

```
fwd = computeFwdIv(frontDte, frontIv, backDte, backIv)     // same identity as §2.1, DTE in DAYS here
fwdEdge = ivF − fwdIv          (0 if guard === "inverted" — inverted term structure is NEVER rewarded,
                                 not run through the normalization window at all)
fwdEdgeFraction = clamp01((fwdEdge + FWD_EDGE_OFFSET) / FWD_EDGE_RANGE)
FWD_EDGE_OFFSET = 0.02, FWD_EDGE_RANGE = 0.04    // [ASSUMED] normalizer, no measurement recorded
```

Note the picker engine computes forward IV per-*candidate* strike (using that candidate's own
front/back IV), unlike the calendar engine's 50-delta-only design (§3.2). No refutation of the
per-strike approach is recorded in the picker engine's own comments — the calendar engine's
50-delta fix (§3.2) was written later and is the more defensible design; a rebuild should prefer
it.

### 6.3 The ORATS fill haircut (shared primitive, both engines)

```
haircutFill(quote, side):
  width = ask − bid
  side === "buy"  → bid + width × FILL_WIDTH_FRACTION
  side === "sell" → ask − width × FILL_WIDTH_FRACTION

FILL_WIDTH_FRACTION = 0.66
```

Sourced explicitly: "ORATS backtester methodology (66% for 2-leg complex orders)" — an external,
cited methodology, not an in-house measurement. Debit is always priced buy-the-back /
sell-the-front at this haircut, never at mid: "ranking on mid overstates edge on wide SPX
markets."

### 6.4 Universe construction — band membership, not delta rungs (`candidate-selection.ts`)

**Design history recorded in the header:** the *previous* design picked candidates at fixed
"nearest-delta rungs" (e.g. −0.45, −0.40 targets). This **provably missed real fills**: "the
user's real 7450 fill at Δ−0.43 sat between the −0.45 and −0.40 rungs." Redesigned 2026-07-08 to
**band membership**: every liquid strike whose front-leg put delta falls in
`[DELTA_BAND_MIN, DELTA_BAND_MAX] = [−0.49, −0.30]` enters the universe, paired with every back
expiry in the gap window at the same strike. "Commercial screeners use band membership for exactly
this reason" (uncited assertion, treat as a design rationale not a sourced fact).

Also retired: a "25-multiple strikes only" filter, removed 2026-07-09 on direct user statement:
*"25s is where I see OI — if you see OI and volume elsewhere consider that too."* The liquidity
gate (OI + spread) is the real filter; any strike passing it enters the universe regardless of
whether it's a multiple of 25.

Windows:
- `FRONT_DTE_MIN/MAX = 21 / 36` — "mockup default grid" — **[ASSUMED]**, not a measured optimum.
- `BACK_DTE_MIN_GAP/MAX_GAP = 15 / 90` — user-locked, widened from an original `[21, 35]`. Wide,
  expensive backs are deliberately *not* banned here — the rationale given is that debit-normalized
  scoring terms (`fwdEdge`, `debitFit`) already punish them, so a hard ceiling would be redundant
  gatekeeping.
- `EVENT_BLACKOUT_DAYS = 3` — a tier-1 macro event (FOMC/CPI/NFP) within this many days *before*
  front expiry no longer **blocks** entry (that gate was retired — see §6.10); instead it stamps
  an early hard-exit date the day before the earliest qualifying event.
- `PEAK_THETA_DAYS = 5` — the final N days before front expiry, where decay is richest. An event
  landing inside this window (not just the 3-day blackout window) **doubles** the event-penalty
  score term (§6.7) — "weigh the forced pre-event exit against max theta decay," a 2026-07-09
  user lock.

**autoTuneTargetDelta** — a VIX-tuned nudge of the band's *deep* (min) edge, linear from
`DELTA_BAND_MIN` at/below the VIX ladder's "normal" floor (15) to `DELTA_BAND_MAX` at/above the
"crisis" floor (25); flat at the floor value for null/NaN VIX. Sourced to a single blog citation
("earlyretirementnow.com, Options Trading Series Part 14": *"If the VIX is high at inception, you
will likely sell so far out of the money..."*) — explicitly called "thin, directional-only
evidence," shipped as "the SMALLEST version" the milestone's time-box allowed. Proven (by
fast-check) to never push the effective delta outside the original band edges.

### 6.5 Term-structure slope — entry fraction (REDESIGNED, with a documented reversal)

The current design **explicitly reverses an earlier one**:

> "calendar ENTRY wants the front leg rich — mild backwardation between the legs. ORATS
> backwardation backtest (−0.09%→+0.58%/yr) and SteadyOptions' negative-differential evidence both
> point this way; the old contango-reward (Johnson 2017 carry) actively fought fwdEdge on inverted
> boards."

```
slopeEntryFraction(slope):
  slope < −1.5            → 0     // crisis-grade inversion: vol exploding, not edge
  −1.5 ≤ slope ≤ −0.25    → 1     // mild front-richness: the sweet spot
  −0.25 < slope < 0.6     → linear 1 → 0
  slope ≥ 0.6              → 0
```

`SLOPE_CRISIS_FLOOR = −1.5`, `SLOPE_RICH_FULL = −0.25`, `SLOPE_NORMALIZER = 0.6` — no numeric
provenance recorded beyond the directional citations above; treat the *breakpoints* themselves as
**[ASSUMED]**, the *direction* as sourced.

Note the term-structure slope was ALSO used, in an earlier design, as a hard entry gate
("term-inversion" — reject any front-rich pair outright). That gate is **retired** — see §6.10.

### 6.6 gexFit — near-term GEX placement

```
useNearTerm = any of nearTermFlip / nearTermCallWall / nearTermPutWall is non-null
flip, callWall, putWall = the near-term set if useNearTerm, else the all-expiry set

base    = GEX_DAMPEN_BASE_CREDIT (0.5)  if spot > flip                      // dealers dampen realized vol
inRange = GEX_RANGE_CREDIT       (0.3)  if putWall ≤ K ≤ callWall           // dealer-defended range
pinned  = GEX_WALL_PIN_CREDIT    (0.2)  if |K − putWall| ≤ 5 or |K − callWall| ≤ 5   // pin magnet

gexFit = clamp01(base + inRange + pinned)
```

Uses the near-term (≤45d) wall set preferentially: "far-dated OI dominates the all-expiry set with
structural levels" that are less relevant intraday. A null/missing/stale GEX context returns
**0**, never a silent credit. `GEX_WALL_PIN_PTS = 5` index points. All four credit constants are
unweighted-sum design choices — no measurement is cited for the specific values 0.5/0.3/0.2/5;
treat as **[ASSUMED]**.

### 6.7 Event adjustment — graded, and why it was softened

```
evtPenaltyBase = sum of EVENT_PENALTY[name] for each event the front leg spans
evtPenalty     = evtPenaltyBase × 2   if eventInPeakTheta, else evtPenaltyBase
eventFraction  = max(0, 1 − evtPenalty)

EVENT_PENALTY = { FOMC: 0.25, CPI: 0.25, NFP: 0.25 }   // was 0.5 each before 2026-07-15
```

**Measured reason for softening 0.5 → 0.25:** "any 20–35 DTE front window spans ≥2 of
FOMC/CPI/NFP, so 0.5/event saturated the criterion to a permanent 0 for the real universe" — i.e.
the harsher penalty made the term constant (always fully triggered) and therefore useless for
ranking. The graded version keeps it discriminating: 1 event → −25%, 3 events → −75%.

### 6.8 beVsEm — breakeven width vs expected move (`breakevens.ts`)

Real bisection solve, not a fixed-strike proxy (explicitly stated as replacing an earlier mockup
approximation, D-09).

**Payoff function** (long put calendar, evaluated at front-leg expiry):
```
remainingBackT = max((backDte − frontDte)/365, 0.001)
backValue      = bsmPrice(S, backStrike, remainingBackT, backIv, r, q, "P")
frontIntrinsic = max(frontStrike − S, 0)
payoff(S)      = (backValue − frontIntrinsic) × 100 − debit
```

**Solve method:** scan `BISECT_STEPS = 200` grid points across `[spot×0.5, spot×1.5]`
(`BISECT_LO/HI = 0.5/1.5`), detect sign changes between adjacent grid points, bisect each bracket
with a hard cap `MAX_ITER = 50` iterations, tolerance `1e-6`. A calendar's payoff-at-front-expiry
is tent-shaped (single peak near the strike, decreasing on both wings) so it crosses zero at most
twice. Returns an empty array (never NaN/throws) when no breakeven exists in bounds.

**Scoring:**
```
hasPair    = breakevens.length >= 2
ratio      = (max(breakevens) − min(breakevens)) / expectedMove     if hasPair && expectedMove > 0, else 0
beVsEmFraction = hasPair ? clamp01(ratio / BE_VS_EM_TARGET_RATIO) : 0
expectedMove   = spot × frontIv × sqrt(frontDte / 365)               // ±1σ by front expiry
```

`BE_VS_EM_TARGET_RATIO = 1.5` — **reverted from 2.0 → 1.5 on 2026-07-15**, with a measured
reason: "live ATM calendars cluster ~1.1×, 2.0 unreachable" — i.e. the original 2.0 target was
calibrated against a value the real candidate population essentially never hit, so nothing ever
earned meaningful credit on this term until it was lowered.

### 6.9 debitFit — asymmetric preference band on the haircut debit

```
DEBIT_IDEAL_MIN = 3200, DEBIT_IDEAL_MAX = 5000     // full credit band
DEBIT_CHEAP_FLOOR = 2000, DEBIT_CHEAP_CREDIT = 0.7  // floor below ideal
DEBIT_EXPENSIVE_ZERO = 7500                          // credit reaches 0 here

debit in [3200, 5000]        → 1
debit < 3200:
  debit <= 2000               → 0.7
  else                         → linear 0.7 → 1 between 2000 and 3200
debit > 5000:
  debit >= 7500                → 0
  else                          → linear 1 → 0 between 5000 and 7500
```

Sourced entirely to a **user-locked spend preference** (2026-07-09): *"I usually like to pay as
little as possible but still get a good calendar."* Asymmetric because cheapness is treated as a
virtue in itself, not a red flag — the rationale explicitly notes "structurally-odd cheap
candidates are caught by other rules" (i.e. this term deliberately does not also try to police
quality-at-cheap-price; that job belongs to the other 8 terms). All four dollar breakpoints are
**[ASSUMED]** — user preference, not measured against outcomes.

### 6.10 A hard gate that was tried, then RETIRED — the per-candidate term-inversion gate

This is the picker engine's most important refutation, and it motivated a separate module
(`entry-gate.ts`) entirely:

> "The RETIRED per-pair `term-inversion` gate's exact mistake ... a per-candidate crisis gate
> deletes the trades with edge."

The original design rejected any individual candidate whose front IV exceeded its back IV
(inverted term structure) as a hard entry block. This was wrong because *mild* front-richness
(inversion) is exactly the entry edge the corpus's own research supports (§6.5 — ORATS/
SteadyOptions). A **per-candidate** gate that fires on any inversion throws away the very
candidates with real edge, indiscriminately from candidates caught in a genuine volatility
crisis. `gateDrops.termInverted` is kept at `0` in the code only "for contract compat" — it is
dead weight, not a live gate.

**The replacement:** term-structure risk is now assessed **once per market cycle**, on
market-level scalars (VIX level, VIX/VIX3M ratio), never per-candidate — `resolveEntryGate` in
§7. Slope's crisis floor (`slope < −1.5`, §6.5) is the only place a *severe* inversion is still
penalized at the candidate level, and it zeroes the slope score term rather than blocking the
trade outright.

### 6.11 The Phase-19 adversarial refutations — criteria that must never be re-encoded

From `.planning/research/calendar-selection-criteria.md` (102-agent, 20-source, 3-vote adversarial
research pass, 2026-07-02) — **six claims explicitly refuted (0-3 or 1-2 vote outcomes)** and
structurally blocked from ever becoming a rule row again (a registry guard test asserts none of
this language or these rule-ids ever appear):

- **IV-rank / IV-percentile entry gates for calendars** — three separate claims killed (0-3, 1-2,
  1-2 votes), *including* "enter when IV low because vega-positive."
- **"Back−front IV differential must be −1% to −3% ideal band"** — killed 0-3; source
  ("journalplus.co") judged to have fabricated the specific numbers.
- **"Fair debit = 25–40% of back-month premium"** — killed 0-3, same fabrication-judged source.
- **"Further OTM monotonically decreases debit and PoP"** — killed 1-2.

The registry guard also forbids the rule-ids `ivRank`, `debitPctOfBack`, and `ivDifferentialBand`
from ever appearing — a rebuild should treat these three concepts as permanently rejected, not
merely "not yet implemented."

**Confirmed-but-unintegrated research claims** (from the same pass, not yet built into any rule):
- Vasquez (JFQA 2017): top-vs-bottom term-structure-slope decile spread = **16.5%/mo, t=10.02** on
  cross-sectional equity straddles — HIGH confidence but explicitly caveated "not SPX
  time-series — needs in-house backtest," which was never done (`slopePercentile` remains
  experimental/weight-0 for this reason).
- "Positive-net-theta bounds OTM distance — calendar theta flips negative far enough OTM (~6.7–8.3%
  OTM for 30/60 at 20% vol; varies)" — MEDIUM confidence, and the recommended encoding was
  explicitly "constraint: net position theta > 0 from live greeks — never a fixed %-OTM cutoff."
  This is exactly the `net-theta-positive` gate (§6.1).
- Exit defaults (+20–30% profit target / −15–20% stop) — rated **LOW confidence, "one
  practitioner's rule — tunable defaults, not validated"**. The shipped constants
  (`EXIT_PROFIT_TARGET_PCT = 0.25`, `EXIT_STOP_PCT = 0.175`, `EXIT_MANAGE_SHORT_DTE = 21`,
  `scoring.ts`) sit inside that range but are **[ASSUMED]** defaults, not independently measured.

---

## 7. The market-level entry gate (`picker/domain/entry-gate.ts`)

Runs **once per cycle**, never per-candidate — the direct fix for §6.10's mistake.

### 7.1 VIX ladder

```
VIX_LADDER (contiguous, half-open [min,max)):
  low:      [0, 15)
  normal:   [15, 20)
  elevated: [20, 25)
  crisis:   [25, ∞)
```

All three interior edges (15/20/25) are marked **`[ASSUMED]`** in the source, "confirm at UAT" —
never independently measured. This same ladder feeds the entry gate, `autoTuneTargetDelta` (§6.4),
and the position-sizing tiers (§8) — **one shared ladder**, not three independently-tuned ones.

### 7.2 Hysteresis rungs (arm/disarm asymmetry — avoids flapping at a boundary)

```
VIX:   blocked  arm=25  disarm=24
       penalty  arm=20  disarm=19
RATIO (VIX/VIX3M): blocked  arm=0.95  disarm=0.93
                    penalty arm=0.90  disarm=0.89
```

The `blocked`/`penalty` arm values are stated as **user-locked**; the disarm values and the whole
penalty-band construction are **`[ASSUMED]`** (Claude's discretion, per the source comment).
`RATIO_PENALTY_FLOOR = 0.9` is independently cross-checked against a sibling module
(`analytics/domain/regime.ts`'s `VIX_TERM_STRUCTURE_WARN`), both citing "eco3min.fr/systemtrader.co"
as the VIX/VIX3M warn-level source — re-declared by value rather than imported, because
cross-bounded-context domain imports are architecturally forbidden in this repo, not because the
two numbers are meant to differ.

A rung is "held armed" from the previous cycle only if that *same* metric+label fired last cycle —
this is the actual anti-flap mechanism: crossing 20.5 up doesn't immediately disarm until VIX
drops below 19, not just below 20.

Within the penalty band, the score multiplier is **linear**, never a step function at the
boundary — explicitly stated as "the retired term-inversion lesson" (a discontinuous gate produces
a cliff at the boundary; a linear multiplier does not). Multiplier floor at the penalty ceiling:
`GATE_PENALTY_FLOOR_MULTIPLIER = 0.3` (never drops score contribution to zero purely from the
penalty band — full block is a separate state).

### 7.3 Fail-closed on stale/missing data ("GATE BLIND")

`GATE_BLIND_MAX_BIZDAYS = 3` — the VIX/VIX3M reading is trusted for at most 3 NYSE business days
old; beyond that, or if either series (`VIXCLS`/`VXVCLS`, FRED series IDs) is entirely missing,
the gate returns `state: "blind"`, `entriesAllowed: false`. Explicitly documented: **only the
`VIXCLS`/`VXVCLS` pair is used, never `vix9d-vix`** — a sibling module's "epoch-mismatch warning"
is cited as the reason to avoid that alternative pairing (an inherited caution, not a fresh
measurement in this file).

### 7.4 The two "anti-criteria" brakes (`brakes.ts`)

Two independent booleans, both fed unconditionally into the same gate (`maxOpenBrake`,
`cooldownBrake`) regardless of VIX/ratio state — a brake trip blocks entries even in an otherwise
fully open market:

```
MAX_OPEN_CALENDARS = 6          // >= trips, not >
LOSS_COOLDOWN_PCT  = -0.25      // realizedPnl / openNetDebit <= -0.25 trips
COOLDOWN_BIZDAYS   = 2          // cooldown window length once tripped
```

A **third brake — sustained-trend detection — was explicitly proposed and dropped**
("USER-DECISION-2"), with a stated reason: "no honest calibration basis at n=13" — i.e., the
research sample was judged too small to support a real threshold, and the brake was left out
entirely rather than shipped with a guessed number. This is a case where the correct action on
insufficient data was *omission*, not a marked-assumed placeholder — worth preserving as the
model to follow for a rebuild that hits the same situation.

All three sizing/gate/brake constants above are **[ASSUMED]**, described as "USER-LOCKED" in the
sense that the user set them by decision rather than by backtest, at n=13 trades.

---

## 8. Position sizing (`picker/domain/sizing.ts`)

```
DEFAULT_TIER_CONTRACTS = { low: 2, normal: 2, elevated: 1, crisis: 0 }
```

Maps the same VIX_LADDER tiers (§7.1) to a contract count. **Explicitly not a derived/backtest-fit
optimum** — the source comment states outright that a formula-fit "optimal size" would
"re-introduce the exact over-fit-to-13-trades risk the milestone's research flagged." The table is
meant to be **hand-edited directly** as the visible source of truth, never wrapped in a UI config
screen or a fitted model. All four counts are **`[ASSUMED]`**, "UAT-pending."

---

## 9. Summary: constants with NO recorded justification (UNJUSTIFIED / free to change)

These appear as bare numbers with no experiment, citation, or stated rationale behind the specific
value (direction may be sourced; the number is not):

- `FWD_EDGE_OFFSET = 0.02`, `FWD_EDGE_RANGE = 0.04` (picker `rules.ts`) — normalizer window for
  the picker's fwdEdge fraction; no measurement cited.
- `GEX_DAMPEN_BASE_CREDIT = 0.5`, `GEX_RANGE_CREDIT = 0.3`, `GEX_WALL_PIN_CREDIT = 0.2`,
  `GEX_WALL_PIN_PTS = 5` — the specific credit split and pin-distance; only the *concept*
  (dampen regime, dealer-defended range, pin magnet) is sourced (SpotGamma framework + pinning
  literature per the registry row), not these particular numbers.
- `SLOPE_CRISIS_FLOOR = −1.5`, `SLOPE_RICH_FULL = −0.25`, `SLOPE_NORMALIZER = 0.6` — the
  *direction* of the slope-entry redesign is sourced (ORATS backtest range, SteadyOptions), but
  these three breakpoints are not directly traceable to those citations' own numbers.
- `DEBIT_IDEAL_MIN/MAX = 3200/5000`, `DEBIT_CHEAP_FLOOR = 2000`, `DEBIT_CHEAP_CREDIT = 0.7`,
  `DEBIT_EXPENSIVE_ZERO = 7500` — pure user spend preference, not measured against any outcome.
- `THETA_VEGA_FULL = 0.2` — sourced to "tastytrade's own floor (vega no more than 5× theta)," so
  this one has an external citation, but it is explicitly flagged in the code itself as
  "unvalidated on our data."
- `VRP_FULL = 0.03` (3 vol points) — no citation given for the specific magnitude.
- The three VIX ladder edges (15/20/25) and all hysteresis disarm values in §7.2 — marked
  `[ASSUMED]` directly in source.
- `DEFAULT_TIER_CONTRACTS` (2/2/1/0) — marked `[ASSUMED]` directly in source.
- `EXIT_PROFIT_TARGET_PCT = 0.25`, `EXIT_STOP_PCT = 0.175`, `EXIT_MANAGE_SHORT_DTE = 21` — traced
  to a research row rated **LOW confidence, "not validated"** in the source research doc itself.

---

## 10. Cross-cutting rules a fresh implementer would get wrong by default

- **Never substitute a neighboring strike's IV for one that failed to solve.** Every module here
  enforces this at multiple points (ATM strike lookup, quoted-vs-priced partitioning) because it
  was a real, shipped bug (§1.5).
- **A null input must produce a null output, never a zero.** Arithmetic reads a missing value as
  zero silently; every pair/candidate/breakeven computation here guards nulls explicitly at the
  boundary specifically because a "clean-looking" wrong number (a fabricated hSkew, a NaN-free
  inverted forward vol) is worse than a visible null.
- **Sort before you dedup or iterate.** The chain is a union of two vendors with no natural
  ordering; every dedup-by-key operation in this codebase sorts to a total order first so the
  "winner" of a collision is a property of the data, not of array arrival order.
- **DTE (calendar days) and T (years to settlement) are different clocks and are not
  interchangeable**, especially across AM- vs PM-settled roots, because the ratio between them is
  not constant (§2.3). Gates count DTE; pricing uses T.
- **A percentile-ranked score and a weighted-fraction score are different design philosophies**,
  and this repo tried both (the calendar engine is percentile-rank against the same day's
  snapshot; the picker engine is an absolute 0–1 fraction against a fixed formula per term). The
  calendar engine's rationale (§4.1) for preferring percentile rank on SPX — that published
  absolute doctrine numbers are calibrated on a different vol regime and fire ~zero times on
  SPX — is a measured, falsifiable finding and should be taken seriously in any rebuild that
  reaches for the picker engine's older, absolute-threshold style instead.
- **A term correlated with another scored term at ~0.95, or provably constant across the ranked
  population, is not adding a second opinion — it's double-counting or noise with a weight
  attached** (§4.3's `frontVrp` refutation, §1.7 and §4.4's OI/spread refutation). Before scoring
  any new term, check it against the terms already in the registry.
