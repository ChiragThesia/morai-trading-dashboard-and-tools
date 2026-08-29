# Phase 0 — measurement verdict

## 1. Verdict

**Yes for live positions, with named repairs. No for history, and no repair fixes it.** The greek
history clears the bar on the eight open calendars — 97.56% coverage (2,356 of 2,415 rows), zero
JSON nulls, zero missing spot — so the surface can be built on them provided every greek renders
through a guard that treats the literal string `"NaN"` as absent and the UI reports an 18-hour
staleness honestly; but only §4.4 is buildable this week, because four of the seven §4 panels read
columns no pass counted and need one more small measurement pass first, and the closed corpus is
dead on arrival — 1 of 21 calendars carries a usable end-to-end series, and twelve hold two
placeholder rows apiece written 5 to 68 days after the trade closed, so nothing can recover data
that was never captured.

**09:30 ET is correct and stays.** CBOE's own settlement document states the SOQ "is not anchored
to a specific time of day," so no exact instant is citable in principle; 09:30 is the earliest
possible instant and the right side of the only divide that matters, the residual error against a
documented hour-late SOQ is small and correctly signed (T short ~5.3%, theta ~5.6% too fast), and
the rejected alternative — Thursday 17:00 — is wrong by 16.5 hours and compresses T by 12x at 1 DTE.

---

## 2. Greek coverage: the numbers

### 2.1 Totals, all three passes

| Pass | Scope | Rows | Resolved | Coverage | Null greeks | NaN greeks | Missing spot |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 8 open calendars | 2,415 | 2,356 | 97.56% | 0 | 59 | 0 |
| 2 | 21 closed calendars | 671 | 439 | 65.42% | 0 | 232 | 54 |
| 3 | 6 calendars, lifecycle cross-check | 1,214 | 1,193 | 98.27% | 0 | 21 | 4 |

Passes 1 and 3 overlap on three open calendars. Pass 3 overlaps pass 2 on three closed ones.
Together they cover 29 calendars. `list_calendars` reports 30. One calendar sits in no pass.

### 2.2 Null versus NaN — the causes are different, and only one exists

**Zero rows carry a JSON `null` greek.** Not in 2,415 open-calendar rows, not in 671 closed-calendar
rows, not in 1,214 lifecycle rows. Every unresolved value is the literal string `"NaN"`. Pass 1
checked this with an explicit `select(.netDelta==null or ...)` returning 0 in every file, and
separately confirmed `has("netDelta")` and `has("spot")` true on every row. Pass 2 and pass 3
reproduce it independently.

This is the single most load-bearing fact in the document. Every numeric field in the payload is
string-encoded — spot arrives as `"20.83..."`, not `20.83`. So the failure marker is a string that
looks like a number, sitting in a field that always looks present:

- A null check catches nothing. Zero rows are null.
- `x ?? 0` passes `"NaN"` straight through. The nullish coalescer never fires on a string.
- `Number(x) || 0` returns `0`. That is this repo's `?? 0` scar, reproduced exactly.
- `"NaN" > band` and `"NaN" < band` are **both false**. An unparsed value makes a band check read
  as inside the band. A §4.5 drift meter fed raw payload shows a silent green light on a position
  it cannot price.

`spot` is clean on every open-calendar row (0 of 2,415 missing) and broken on 54 of 671 closed rows.

### 2.3 Open calendars — per calendar

| ID | Label | Rows | Resolved | Coverage | First row | Last row | Longest gap |
|---|---|---:|---:|---:|---|---|---:|
| 5f344931 | SPXW 7425P, front 08-31 / back 09-30 | 534 | 530 | 99.25% | 2026-07-06T17:30Z | 2026-08-28T20:00Z | 1h |
| 6d3fa1c0 | SPXW 7450P, front 10-16 / back 11-30 | 396 | 388 | 97.98% | 2026-07-21T13:30Z | 2026-08-28T20:00Z | 18h |
| 5cca8d00 | SPXW 7525P, front 09-11 / back 09-30 | 194 | 190 | 97.94% | 2026-08-11T13:30Z | 2026-08-28T20:00Z | 1h |
| 61ed0141 | SPXW 7425P, front 09-11 / back 09-14 | 307 | 299 | 97.39% | 2026-07-30T13:30Z | 2026-08-28T20:00Z | 18h |
| 9b4080ef | SPXW 7425P, front 09-14 / back 09-30 | 289 | 281 | 97.23% | 2026-07-31T13:30Z | 2026-08-28T20:00Z | 18h |
| 3f40770c | SPXW 7425P, front 08-17 / back 09-11 | 238 | 229 | 96.22% | 2026-07-24T13:30Z | 2026-08-18T14:00Z | 18.5h |
| 37e0545e | SPXW 7425P, front 08-17 / back 08-21 | 238 | 229 | 96.22% | 2026-07-24T13:30Z | 2026-08-18T14:00Z | 18.5h |
| d56a2070 | SPXW 7425P, front 08-21 / back 08-31 | 219 | 210 | 95.89% | 2026-07-31T13:30Z | 2026-08-21T20:00Z | 18h |

Two write-side problems live in that table.

**d56a2070 stopped writing.** Its journal ends 2026-08-21T20:00Z, the day its front leg expired.
`list_calendars` still reports it open. Today is 2026-08-29. On a glance card it renders as a live
position that has been Unpriced for eight days. This is not a coverage hole. The snapshot job
stopped for this calendar and nothing noticed.

**3f40770c and 37e0545e are frozen too.** Both end 2026-08-18T14:00Z while the other six run to
08-28. Both share a front expiry of 2026-08-17. Identical row counts, identical windows, opened
the same day.

### 2.4 The NaN incidents are upstream, not per calendar

Pass 1 found NaN rows recurring on the same calendar dates across unrelated calendars: 2026-08-07,
08-12, 08-14, 08-18, 08-21 each appear in two or more calendars' NaN lists. One pricing job
hiccuped on those cycles. This is one bug, not eight.

Pass 3 sees the same cluster, but it is not independent corroboration — its three open calendars
are three of pass 1's eight, read through a different endpoint. What that does prove is narrower
and still useful: the enrichment endpoint does not hide the cluster. Pass 2 is the genuinely
independent calendar set.

The shape is isolated ticks, not blackouts. Pass 1 found exactly one run longer than a single
snapshot: three consecutive rows on 9b4080ef on 2026-08-07 (13:30 / 16:00 / 18:00). The two
calendars reporting a 1-hour longest gap (5cca8d00, 5f344931) each hold exactly four isolated NaN
rows and no run at all.

### 2.5 Where the passes disagree

They disagree on one column, and the disagreement is a definition.

| Calendar | Pass 1 gap | Pass 3 gap |
|---|---:|---:|
| 5cca8d00 | 1h | 0.5h |
| 6d3fa1c0 | 18h | 0.5h |
| 5f344931 | 1h | 0.5h |

Rows and resolved counts match exactly on all three (194/190, 396/388, 534/530). Only the gap
differs. Pass 1 measures **wall-clock hours** from the last resolved snapshot to the next resolved
one. Pass 3 counts **adjacent unresolved snapshot slots**, so one missing 30-minute tick reads as
0.5h. Both are right under their own definition, and pass 2 shares pass 1's convention.

The reconciliation matters for the UI. A single missed cycle at the end of a trading day sits
against the overnight close, so the next resolved row is 18 hours later. Pass 1's own finding
confirms it: the 18 and 18.5-hour gaps span the overnight and pre-market window, last good RTH
snapshot one day to first good RTH snapshot the next. **A staleness label must use pass 1's
wall-clock number.** A surface that counts snapshot slots will say "30 minutes stale" when the last
real number is 18 hours old, and be wrong by 36x.

The gap metric also under-reports one case in both conventions. 34ec11bd reads 0.5h and looks
benign. Its single NaN row is its **last** snapshot. No gap metric can express "the one broken row
is the row attribution needs most."

`rows_missing_spot` reads 0 in pass 1 and 4 in pass 3. That is scope, not conflict. Pass 3's four
sit entirely in the two closed 2-row placeholder calendars, which pass 1 never looked at.

### 2.6 Monthly trend

| Period | Pass 1 (open) | Pass 2 (closed) | Pass 3 (cross-check) |
|---|---|---|---|
| 2026-06 | — | 0 / 48 (0%) | 0 / 4 (0%) |
| 2026-07 | 605 / 605 (100%) | 439 / 623 (70.47%) | 468 / 469 (99.79%) |
| 2026-08 | 1,751 / 1,810 (96.74%) | — | 725 / 741 (97.84%) |

Open-calendar coverage fell from 100% in July to 96.74% in August. Watch it. It is still nowhere
near the ~74%-gap June/July scenario recorded in prior session notes, and that scenario does not
reproduce on recent open-calendar data.

June is 0% in both passes that reach it. Pass 2 states the reason: **real journal history begins
no earlier than 2026-07-06.** Everything dated before that is placeholder.

### 2.7 Which series can carry a P&L attribution

**Open calendars: all eight, with holes marked.** Every one clears 95.89%. The NaN rows are
isolated ticks, and §3 proves the enrichment layer refuses to invent numbers across them.

**Closed calendars: one of twenty-one.**

| Class | Count | Calendars | Longest gap | Usable |
|---|---:|---|---:|---|
| Complete, gap-free, spans exact open-to-close | 1 | 05b1eb8c (SPXW 7400P, 07-23 → 07-30) | 0h | Yes |
| 98.84%, but the exit snapshot is the NaN row | 1 | 34ec11bd | 0.5h | No |
| Single snapshot for the whole trade life | 1 | 0f09a51a | 0h | No |
| Entry period missing or journal starts on/after close | 3 | a5e74742, a40b2294, 1cd7a9b1 | 20.66h each | No |
| Broken leading block plus multi-day hole | 2 | c225281e, af9923ba | 191.47h each | No |
| 26.09% coverage, 22 of 46 rows spot=0 | 1 | 65aac62e | 189.69h | No |
| Two placeholder rows, spot=0, all NaN | 12 | all closed 04-16 → 06-18 | 1h each | No |

Read the gap column with §2.5's convention in mind, and read the small numbers hardest. 0.5h on
34ec11bd is the whole problem with that calendar, not a sign of health — the missing row is the
exit. 0h on 0f09a51a means there is only one row, so there is nothing to gap.

**n=1.** That is the entire usable sample for any historical P&L-attribution study.

The twelve placeholder calendars share one signature: exactly two rows each, both timestamped
2026-06-23T17:00:58Z and T18:00:58Z, both spot=0, both fully NaN, regardless of the calendar's own
dates. One backfill event wrote all of them, 5 to 68 days after each trade had already closed.

Two calendars also wrote snapshots **after** `closedAt`. a40b2294 and 1cd7a9b1 both opened 07-02
and closed 07-06; their journals start on the close date and run four days past it, to 07-10.
Zero coverage of the window they were actually open. Post-close rows that should not exist.

### 2.8 One claim that did not reproduce

The Phase 0 brief cites a production review finding net greeks NaN **for every open position across
a continuous ~1.5-trading-day window from 2026-08-24 13:30 UTC onward.** Read against data through
2026-08-28, none of the three passes reproduces it.

A 1.5-day blackout across eight calendars would be roughly 26 RTH snapshots each, over 200 NaN
rows. Pass 1 counts 59 in total across all of August, and its longest continuous run is 18.5 hours
that spans an overnight close. The recurring NaN dates are 08-07, 08-12, 08-14, 08-18 and 08-21.
08-24 and 08-25 appear in no calendar's NaN list.

The discriminating fact is which store was read. All three passes read `get_journal` and
`get_journal_lifecycle` — the API read path. The review read `calendar_snapshots` in production —
the write path. Pass 2's method records that `DATABASE_URL`, psql, bun-SQL, `source .env` and
`lsof` were all **denied by the sandbox's Bash classifier**, so no pass could cross-check the API
against the store. This cannot be settled here. See §6.

97.56% is therefore the correct number for buildability, because the monitoring surface reads the
API. It is not evidence the stored rows are clean.

---

## 3. What the enrichment layer does with a hole

This is the section that decides whether the coverage problem is visible or invisible. If a
missing greek becomes a zero or a plausible finite number downstream, the UI lies and every
attribution figure is quietly wrong.

**It does not. The enrichment layer is honest.** Pass 3 checked exhaustively, not by sampling.

### 3.1 It drops nothing

`get_journal_lifecycle` returns exactly the same row count as `get_journal` on all six calendars:
194/194, 396/396, 534/534, 86/86, 2/2, 2/2. Verified by set-difference on the `time` field in both
directions — dropped-from-lifecycle and added-in-lifecycle both came back empty every time.

The enrichment carries every row through, including the fully degenerate ones, and marks what it
cannot compute.

### 3.2 It nulls every derived field, with no exceptions

For every lifecycle row whose `netDelta` / `netGamma` / `netTheta` / `netVega` / `frontIv` /
`backIv` is unresolved:

| Field | Value |
|---|---|
| `forwardVol` | `null` |
| `forwardVolGuard` | `"inverted"` |
| `cumTheta` | `null` |
| `cumVega` | `null` |
| `cumDeltaGamma` | `null` |
| `cumResidual` | `null` |
| `isGap` | `true` |

All 21 unresolved rows across the six calendars. Zero exceptions.

### 3.3 The adversarial check found nothing

Pass 3 ran explicit queries for the exact failure mode — `dangerous_forwardVolFiniteDespiteUnresolvedInput`
and `dangerous_cumFiniteDespiteUnresolvedInput` — looking for `forwardVol` or any `cum*` field
non-null while an input was unresolved. **Both counts are 0 on every calendar.**

`isGap` is a reliable proxy. `isGapTrue_but_forwardVolNotNull` = 0 and
`isGapFalse_but_greeksUnresolved` = 0 in every calendar. The flag and the null-ness move together
with no drift, so the UI can branch on `isGap` alone.

### 3.4 The two hardest cases both pass

**34ec11bd's terminal row.** Its only unresolved row is the last snapshot in the series
(2026-07-24T14:00), the freshest value a monitoring surface would display and the one most likely
to be shown as current. Lifecycle marks it `isGap=true` and nulls every derived field. It refuses
to show a stale-looking finite number in the position a user reads as live.

**The degenerate 2-row calendars.** 6303e6af and f3789ddd hold nothing but placeholder rows,
spot=0, all greeks NaN. Lifecycle matches row-for-row and nulls every derived field on both rows,
rather than inventing anything from a spot=0 chain.

### 3.5 What this buys, and what it does not

The enrichment layer is not the risk. The risk is the raw payload, and the boundary between them.
`get_journal_lifecycle` gives a correct `isGap` flag and honest nulls. `get_journal` gives the
string `"NaN"` in a string-encoded numeric field, with no null and no missing key to trip over.

**Any panel that reads `get_journal` directly inherits the whole problem.** Read the lifecycle
endpoint and branch on `isGap`. Where a panel must read raw journal fields, parse through one
shared guard that treats `"NaN"` as absent — never `??`, never `||`, never a bare comparison.

---

## 4. What this means for the build

### 4.1 Panel by panel

| Panel | Verdict | Why |
|---|---|---|
| §4.1 hero — P&L since entry | Blocked on a measurement | Reads `pnl_open`. No pass counted its coverage. Pass 3 saw it flip to a flat 4304.99 on 34ec11bd's terminal row and did not chase it. Measure before building. |
| §4.2 entry vs current | Blocked on a measurement | All five columns read fields no pass counted: `front_mark`, `back_mark`, `front_iv`, `back_iv`, `term_slope`. Structurally it also fails on 15 of 21 closed calendars, three of which have journals that start on or after `closedAt`. |
| §4.3 attribution waterfall | Live yes, pending one check | Lifecycle emits `cumTheta` / `cumVega` / `cumDeltaGamma` / `cumResidual` and nulls them honestly, so the panel draws. Whether the interval spanning a gap is skipped, bridged or double-counted is unknown, and that decides whether the drawn numbers are right. Historical study is dead — n=1. |
| §4.4 the path taken | **Yes, unconditionally** | Needs `(time, spot)` only. Zero of 2,415 open-calendar rows are missing spot. The only panel with no measured hole. Build this first. |
| §4.5 drift from thesis | Half yes, half unmeasured | `net_delta` resolves 97.56%. `term_slope` coverage was never measured by any pass, and it is the other meter. |
| §4.6 time remaining vs plan | Unmeasured | Needs the §5.5 immutable pre-trade record for the planned exit DTE band. No pass touched it. |
| §4.7 list / expanded split | Follows 4.1 and 4.5 | The glance card needs the hero and the drift status, so it inherits both blockers. |

**Order that falls out:** §4.4 today. §4.3 next, on the lifecycle endpoint, once the post-gap
cumulative is checked. §4.1, §4.2, §4.5 and §4.6 after a second measurement pass over `pnl_open`,
`front_mark`, `back_mark`, `front_iv`, `back_iv`, `term_slope` and the pre-trade record. That pass
is small — it is the same three endpoints, counting different columns.

### 4.2 The three-state contract cannot be built as specified

Spec §6.3 defines Priced / Partial / Unpriced. **The middle state is not implementable from the
journal payload.**

All four net greeks move in lockstep. Pass 2 verified it on real data before relying on it — every
row inspected has all four simultaneously finite or all four simultaneously `"NaN"` — and used
`netDelta` as an exact proxy on that basis. Pass 3 reproduced it. So the payload can express two
states, not three: the position is priced, or it is not.

Partial as specified means "some legs priced, front expiry incomplete." That is a per-leg fact.
It lives in `leg_observations`, which no pass measured. **Partial has no measured basis and no
detection path today.** Either measure `leg_observations` coverage and build the state properly, or
ship two states and say so on screen. Do not ship a three-state control whose middle state never
fires — a state that cannot fire is worse than a state that does not exist, because it reads as
reassurance.

### 4.3 What the states have to look like, given the real gaps

| Constraint | The measurement that forces it |
|---|---|
| Staleness age is wall-clock, never snapshot count | One missed cycle at a day boundary is 18h of real staleness (§2.5). Counting slots reports 30 minutes and is wrong by 36x. |
| Unpriced is a design case, not an edge case | 59 of 2,415 open rows, 2.44%. It fires on every open calendar. |
| Unpriced is usually one tick, so do not build for blackouts | Only one run exceeds a single snapshot: three rows on 9b4080ef, 08-07. |
| The staleness label will routinely read 18h+ | The 18 and 18.5h gaps are one missed cycle against an overnight close, not an outage. Copy must not imply an outage. |
| Never let `"NaN"` reach a comparison | `"NaN" > band` and `"NaN" < band` are both false. §4.5 fails to a silent green light. |
| A stopped writer is not an Unpriced tick | d56a2070 is eight days stale and still reported open. Needs its own state or a hard staleness ceiling. |

Add a staleness ceiling. Past some age, a position stops rendering "last priced N hours ago" and
starts rendering "this position is not being priced." d56a2070, 3f40770c and 37e0545e are all
already past it.

### 4.4 Repair: alongside, and never

**Alongside Phase 1, for the live pipeline.** The open-calendar surface is buildable at 97.56%
behind the three-state guard. The recurring NaN cycles are one upstream job failing on shared
dates, so one fix retires them all. Two write-side bugs sit next to it and are worth the same
pass: snapshot writes that continue past `closedAt`, and writers that stop on an open calendar
with nothing raising an alarm. None of this blocks Phase 1.

**Before Phase 1, for nothing.** No repair unblocks a panel that is otherwise buildable.

**Never, for the pre-07-06 corpus.** Twelve closed calendars hold two placeholder rows apiece.
A repair pass cannot recover data that was never captured. Real journal history begins no earlier
than 2026-07-06 and that is the floor for every history-dependent feature. Say it in the product,
not just in this document.

**One measurement first, though.** §2.8 leaves open whether the stored rows match what the API
returns. If they do not, the repair job is larger than the recurring-NaN fix. That check needs
store access the sandbox denied.

---

## 5. The settlement anchor

### 5.1 The answer

**Keep `AM_SETTLEMENT_HOUR = 9` and `AM_SETTLEMENT_MINUTE = 30`.** The code picked the right
family — Friday morning, not Thursday evening — and the reasoning holds. No numeric change.

The family is cited. The minute is not citable, in principle.

> "The exercise settlement value for A.M.-settled SPX options is based on a special opening
> quotation (SOQ) of the S&P 500 Index that is calculated on their expiration days... The SOQ is
> based on the opening trade price in the primary market of each constituent stock in the S&P 500
> Index on a given expiration (third) Friday."
> — [CBOE, *Settlement of Standard AM-Settled S&P 500 Options*](https://cdn.cboe.com/resources/spx/Settlement_of_Standard_AM_Settled_SP_500_Index_Options.pdf), v.2 July 17 2024, fetched

And the reason no minute exists:

> "The SOQ is not calculated until all of the constituent stocks of the S&P 500 Index have opened
> for trading and their corresponding official opening prices are established. Because official
> opening prices are rarely disseminated at the opening, the SOQ (by construction) is **not
> anchored to a specific time of day**."
> — same document, fetched

CBOE also states intraday S&P dissemination "typically begins at 8:30 a.m. (CT)" — 09:30 ET. That
makes 09:30 a hard floor, not the actual instant. A practitioner account CBOE does not contradict
reports the delay: "the opening settlement price of SPX (ticker SET) can sometimes be delayed an
hour or more because order imbalances delay trading on some stocks"
([sixfigureinvesting.com](https://www.sixfigureinvesting.com/2012/04/trading-spxpm-options/),
fetched). CBOE's own 15-year sample shows the SOQ diverging from the day's open by up to ~1% and
from the prior close by up to 1.47%.

**Why Thursday 17:00 is wrong.** T is time until the payoff-determining value is fixed, not time
until the contract stops trading. Trading in SPX options ceases Thursday 5:00 pm ET
([CBOE specifications](https://www.cboe.com/tradable_products/sp_500/spx_options/specifications/),
fetched), but the index's overnight and pre-open path is still unresolved uncertainty the payoff
depends on. That stretch is real diffusion time. Thursday 17:00 belongs in a tradability
constraint, never in the discount and vol integral.

### 5.2 The error, quantified

The anchors are **16.5 hours = 990 minutes** apart. This codebase computes T as calendar time,
`minutesToCutoff / 525960` (`packages/core/src/journal/domain/dte.ts`, ACT/365.25), and re-solves
front-leg IV from the observed mark, so a wrong T propagates into IV as well as into the greeks.

Evaluated from a Thursday 15:30 ET snapshot:

| | 1 DTE | 7 DTE |
|---|---|---|
| T with 09:30 Friday anchor | 1080 min = 0.0020533 yr | 9720 min = 0.018476 yr |
| T with 17:00 Thursday anchor | 90 min = 0.00017112 yr | 8730 min = 0.016594 yr |
| T ratio | **12x** compression | 1.1134x |
| Solved IV error | **3.46x too high** (√12) | 1.055x, 5.5% high |
| Theta error | **12x too fast** | 1.1134x, 11.3% too fast |

Theta takes the error twice. Because IV is re-solved from the same mark, σ ∝ 1/√T, and
θ_ATM ≈ Sσ/(2√(2πT)), so θ scales as 1/T — not the naive √T.

Past Thursday 17:00 the wrong anchor gives T = 0 through `Math.max(0, …)`. The IV solve and every
greek die outright while 16.5 hours of real gap risk remain. That is the qualitative failure; the
12x is what it looks like just before the cliff.

**Forward vol**, front leg Friday-AM, back leg next-Friday-PM, σ1 = 20%, σ2 = 18%, T2 = 0.021957 yr:
correct anchor gives **17.78%**, Thursday-close anchor gives **17.00%**. A 78bp understatement.
Thursday-anchoring makes the term structure look flatter and more inverted than it is.

The damage concentrates at the front of the calendar. A fixed 16.5-hour offset is a large fraction
of a 1-day T and a small fraction of a 7-day T — exactly where this system's calendar-spread and
forward-vol trade lives.

### 5.3 What remains is a rounding error, and the question is retired

Measured against a documented hour-late SOQ (T = 1140 min = 0.0021676 yr), the current 09:30
constant leaves:

| Quantity | Residual |
|---|---|
| T | ~5.3% short |
| Solved IV | ~2.7% high |
| Theta | ~5.6% too fast |
| Forward vol | ~5bp off |

Five basis points on forward vol. **That is a rounding error.** It is correctly signed — a short T
biases IV and theta up — bounded, and inherent to an instant CBOE declines to pin. Stop chasing
the exact minute. The open question is closed.

### 5.4 Two real code findings, and the one-line change that is not one line

No numeric fix is needed. The guard around the number is broken.

**The comment promises a correction path that does not exist.**
`packages/shared/src/settlement-timestamp.ts` says the anchor is "flagged below as a single named
constant so a future correction is a one-line change." False.
`packages/core/src/journal/domain/dte.ts:135-136` hardcodes the same split inline, with its own
DST logic:

```ts
const cutoffHourEt = isAmSettled ? 9 : 16;
const cutoffMinEt = isAmSettled ? 30 : 0;
```

A real correction is a two-package, two-place change. Either import the shared constants into
`computeT`, or delete the promise. Do not leave a comment that will send someone to the wrong file.

**Sharpen the flag, do not remove it.** The current text reads "no cited source pins down the exact
BSM T=0 instant," which implies nobody looked. Replace it with the fact: CBOE explicitly states the
SOQ is not anchored to a specific time of day, and 09:30 ET is the earliest-possible anchor. Cite
the SOQ PDF.

**A latent convention mismatch, not a live bug.** `settlement-timestamp.ts` reads its expiry with
**local** date accessors. `computeT` in `dte.ts` reads **UTC** accessors on a UTC-constructed
expiry. Every current call site hands `settlementTimestamp` a locally-constructed Date, and
`parseOccSymbol` builds expiry with `new Date(year, mm-1, dd)`, so the two are internally
consistent today. One caller getting the convention backwards produces a silent 4 to 6.5 hour
error — the same class of error this whole section exists to rule out.

---

## 6. What is still unmeasured

**Fields three §4 panels depend on, that no pass counted.**

- `term_slope`. Half of §4.5 rests on it. Zero passes measured its coverage.
- `pnl_open`. The §4.1 hero. Never counted. Pass 3 observed it flip to a flat 4304.99 on
  34ec11bd's terminal row and did not chase it.
- `front_mark`, `back_mark`, `front_iv`, `back_iv`. Every column of the §4.2 table. Never counted.
- The §5.5 immutable pre-trade record. §4.5's bands and §4.6's planned exit window both read it.
  No pass confirmed it exists.
- `leg_observations`. The only possible source for the Partial state. Never measured.

**Mechanisms nobody resolved.**

- **Store versus API.** The ~1.5-day NaN window does not reproduce through `get_journal` (§2.8).
  Nobody read `calendar_snapshots` directly to see whether the write path agrees with the read
  path. This decides how large the repair job is.
- **19-26% versus 97.56%.** The chain-level BSM pricing measured 19-26% on 2026-08-25, while net
  greeks on tracked calendar legs resolve at 97.56%. Both numbers are real. The mechanism that
  reconciles them is unmeasured — do not assume one.
- **Interval coverage for §4.3.** Attribution runs per interval, so one NaN row breaks two
  intervals, the one into it and the one out. No pass measured interval coverage. It is below
  97.56% and bounded by the isolated-tick pattern, but the number does not exist. Do not compute
  one and print it.
- **Does the cumulative chain resume after a gap?** Pass 3 proved the gap row itself carries null
  `cum*`. It did not check the row after. Whether the bridged interval is skipped, spanned, or
  double-counted is unknown, and §4.3 sums intervals.
- **Whether the entry row resolves.** Pass 1 measured aggregates, not first rows. §4.2 reads the
  first snapshot of each calendar.

**Tools that could not reach.**

- **Database access denied.** Pass 2 records that `DATABASE_URL`, psql, bun-SQL, `source .env` and
  `lsof` were all blocked by the sandbox's Bash classifier. No raw SQL or HTTP to the underlying
  store was available in any pass. This is why the store-versus-API question above stays open.
- **`get_journal` returns no file handle in pass 2's environment.** It inlines full JSON. So 18 of
  21 closed calendars were hand-transcribed to CSV as `(time, netDelta, spot)`, using `netDelta` as
  a proxy for all four greeks. The lockstep assumption was verified on two calendars (a5e74742,
  a40b2294), not on all 21.
- **OCC unreachable.** theocc.com returned a Cloudflare challenge page on two separate fetch
  attempts against two URLs. Not usable as a citation. CBOE footnotes SEC releases 24367 (1987) and
  30944 (1992) for the PM-to-AM history; one Federal Register lookup missed and the researcher
  stopped there. Neither source can move the verdict — OCC clears against whatever value CBOE
  publishes and asserts no timing convention of its own.
- **The second anchor research angle never ran.** The convergent-practice pass returned a literal
  stub: question `"test"`, answer `"test"`, evidence `https://example.com` quoting `"test quote"`.
  It produced nothing. **The anchor verdict rests on one angle, not two.** The primary-source angle
  is strong and fetched, so the conclusion is single-sourced rather than weak — but the
  cross-check that was commissioned did not happen.

**Population.**

- 8 open plus 21 closed is 29 calendars. `list_calendars` reports 30. One calendar appears in no
  pass, and nobody identified which.
- No full-population audit ran. Pass 3's cross-check covers 6 calendars.
- Every number here reads data through 2026-08-28T20:00Z.
