# The journal fill-pairing oracle — 13 real calendars

Source: `apps/worker/src/journal-oracle.test.ts` (round 4 + round 5 of the
`journal-pnl-opennetdebit-units` investigation) and the domain code it exercises,
`packages/core/src/journal/domain/fill-pairing.ts`.

## What the oracle is, and why it's an oracle and not a regression snapshot

A regression snapshot freezes whatever a piece of code currently outputs and calls
future deviation "wrong." That's worthless here because the code being tested had
already been wrong in production twice. This suite is different: **every expected
number was computed independently of the pipeline under test**, straight from the
signed cash flows of 13 real Schwab broker transactions, before the fix was written.

The independent computation lives in `.planning/debug/journal-pnl-ground-truth.md`:

> Computed independently from `get_transactions` (the authoritative signed `netAmount`
> cash flows), NOT from the buggy pipeline. This is the ORACLE every fix + test must
> match. Source data: `scratchpad/txns.json` · analyzer: `scratchpad/ground-truth.mjs`
> · date: 2026-07-05.

The test file's own header explains the same thing from the other side — these are
"5 real calendars" (round 4) extended to "ALL 13 real, ground-truth-confirmed
calendars," and states the exact production damage the coverage gap allowed:

> BUG 1 (shared-leg attribution): 8a63aa81 (7275P Jun18/Jun23) and 6303e6af (7275P
> Jun18/Jul17) share the SAME front-month contract (SPXW 260618P07275000)... the old
> matching logic orphan-parked all of them — each calendar kept only its unique back
> leg (a back-leg-only debit, e.g. 62.50 instead of the true net 62.50-52.30=10.20).
>
> BUG 2 (closed-status not set): 65aac62e is registered status "open" despite its real
> Jul-1 CLOSE order fully unwinding both legs.

Every fixture below is a **real Schwab order**: real `activityId`, real `orderId`,
real strikes/expiries, real fill prices. None are fabricated. All are SPXW puts,
qty 1, one calendar (long back-month leg / short front-month leg) per id.

### The arithmetic convention — how to derive `openNetDebit`/`closeNetCredit` from fills

The pipeline's own convention (`syncFills.ts`, mirrored by the test's
`recomputeFromRealEvents` helper) is **fee-free avgPrice × qty arithmetic** — it
never reads the broker's raw `netAmount` (which bakes in a ~$1-2/leg commission).
Concretely, for a plain OPEN/CLOSE pair (no roll):

```
openNetDebit   = (price of the OPENING "buy" leg)  − (price of the OPENING "sell" leg)
closeNetCredit = (price of the CLOSING "sell" leg)  − (price of the CLOSING "buy" leg)
```

This reproduces every `EXPECTED` value in the test to the cent (verified by hand for
all 13 below). The ground-truth doc's own figures are ~2-3 cents higher per leg
(e.g. 65aac62e: ground-truth openDebit **32.37** vs. this suite's **32.35**) because
the ground-truth doc used the broker's fee-inclusive `netAmount` directly; the test's
header flags this explicitly as a known, separate, out-of-scope gap — match the
fee-free figures below, not the ground-truth doc's raw numbers, when the rebuild's
fee handling is still absent (fees/commission are always `null` in this pipeline).

Tolerance in the original suite is `toBeCloseTo(expected, 2)` (2 decimal places).

---

## All 13 calendars — inputs and expected outputs

Each calendar: qty is always 1. "front" is the earlier expiry (short leg, sold to
open); "back" is the later expiry (long leg, bought to open). Underlying is SPXW,
option type P (put) throughout. Strike is shown in points (the seed's `strike` field
in the test is the OCC-convention integer, strike × 1000, e.g. 7425000 for 7425).

Legend per fill: `<expiry> <strike>P  qty  price  <positionEffect>  <side>  (netAmount)`.

### 1. `65aac62e` — 7425P Aug7/Aug31 — **stale status column (hard case, see below)**
- front 2026-08-07 · back 2026-08-31
- OPEN 2026-06-22, order `1006855414174`:
  - `2026-08-31 7425P` qty1 price **159.41** OPENING buy (−15942.22)
  - `2026-08-07 7425P` qty1 price **127.06** OPENING sell (+12704.78)
- CLOSE 2026-07-01, order `1006990704540`:
  - `2026-08-31 7425P` qty1 price **123.13** CLOSING sell (+12311.78)
  - `2026-08-07 7425P` qty1 price **86.78** CLOSING buy (−8679.22)
- **expected: openNetDebit = 32.35, closeNetCredit = 36.35**
- seed `status`: **"open"** (WRONG — real events fully close the position on 2026-07-01)

### 2. `9eef2153` — 7100P May15/Jun8
- front 2026-05-15 · back 2026-06-08
- OPEN 2026-04-24, order `1006130670569`:
  - `2026-05-15 7100P` qty1 price **81.54** OPENING sell (+8152.78)
  - `2026-06-08 7100P` qty1 price **124.39** OPENING buy (−12440.22)
- CLOSE 2026-04-30, order `1006198637052`:
  - `2026-06-08 7100P` qty1 price **91.75** CLOSING sell (+9173.78)
  - `2026-05-15 7100P` qty1 price **45.15** CLOSING buy (−4516.22)
- **expected: openNetDebit = 42.85, closeNetCredit = 46.6**
- seed `status`: closed

### 3. `e8bfbf41` — 7175P May22/Jun15
- front 2026-05-22 · back 2026-06-15
- OPEN 2026-05-01, order `1006216919920`:
  - `2026-06-15 7175P` qty1 price **115.12** OPENING buy (−11513.22)
  - `2026-05-22 7175P` qty1 price **70.52** OPENING sell (+7050.78)
- CLOSE 2026-05-06, order `1006265261970`:
  - `2026-06-15 7175P` qty1 price **75.45** CLOSING sell (+7543.78)
  - `2026-05-22 7175P` qty1 price **31.65** CLOSING buy (−3166.22)
- **expected: openNetDebit = 44.6, closeNetCredit = 43.8**
- seed `status`: closed

### 4. `60c46a57` — 7425P Jul8/Jul31 — **shares a broker order with `24f1e72e`**
- front 2026-07-08 · back 2026-07-31
- OPEN 2026-06-15, order `1006755504464`:
  - `2026-07-31 7425P` qty1 price **96.6** OPENING buy (−9661.22)
  - `2026-07-08 7425P` qty1 price **52.4** OPENING sell (+5238.78)
- CLOSE 2026-06-17, order `1006797510202` (this order ALSO opens `24f1e72e` — 4 legs
  total in one broker order; see note below):
  - `2026-07-08 7425P` qty1 price **59.7** CLOSING buy (−5971.22)
  - `2026-07-31 7425P` qty1 price **102.92** CLOSING sell (+10290.78)
- **expected: openNetDebit = 44.2, closeNetCredit = 43.22**
- seed `status`: closed

### 5. `24f1e72e` — 7475P Jul9/Jul31 — **shares a broker order with `60c46a57`**
- front 2026-07-09 · back 2026-07-31
- OPEN 2026-06-17, order `1006797510202` (the SAME order that closes `60c46a57`; the
  other 2 of its 4 legs):
  - `2026-07-31 7475P` qty1 price **117.84** OPENING buy (−11785.22)
  - `2026-07-09 7475P` qty1 price **76.32** OPENING sell (+7630.78)
- CLOSE 2026-06-18, order `1006830552432`:
  - `2026-07-09 7475P` qty1 price **79.86** CLOSING buy (−7987.22)
  - `2026-07-31 7475P` qty1 price **124.86** CLOSING sell (+12484.78)
- **expected: openNetDebit = 41.52, closeNetCredit = 45.0**
- seed `status`: closed
- Note (from the test's own comment): order `1006797510202` closes `60c46a57` (strike
  7425) and opens `24f1e72e` (strike 7475) in one broker order, but it is **NOT** a
  domain ROLL — `detectRoll` requires the same strike+type+root with only the expiry
  differing, and these are different strikes. So it must be treated as 2 ordinary
  CLOSE fills + 2 ordinary OPEN fills, each belonging to its own calendar — not a
  single roll event.

### 6. `8a63aa81` — 7275P Jun18/Jun23 — **shared front leg (hard case, see below)**
- front 2026-06-18 · back 2026-06-23
- OPEN 2026-06-09, order `1006681717677`:
  - `2026-06-23 7275P` qty1 price **62.5** OPENING buy (−6251.22)
  - `2026-06-18 7275P` qty1 price **52.3** OPENING sell (+5228.78)
- CLOSE 2026-06-10, order `1006687566650`:
  - `2026-06-23 7275P` qty1 price **65.17** CLOSING sell (+6515.78)
  - `2026-06-18 7275P` qty1 price **54.62** CLOSING buy (−5463.22)
- **expected: openNetDebit = 10.2, closeNetCredit = 10.55**
- seed `status`: closed
- Its front leg, OCC symbol `SPXW 260618P07275000` (2026-06-18, strike 7275, put),
  is IDENTICAL to `6303e6af`'s front leg.

### 7. `6303e6af` — 7275P Jun18/Jul17 — **shared front leg (hard case, see below)**
- front 2026-06-18 · back 2026-07-17
- OPEN 2026-05-19, order `1006417446601`:
  - `2026-07-17 7275P` qty1 price **128.9** OPENING buy (−12891.22)
  - `2026-06-18 7275P` qty1 price **82.9** OPENING sell (+8288.78)
- CLOSE 2026-06-05, order `1006622444775`:
  - `2026-07-17 7275P` qty1 price **66.2** CLOSING sell (+6618.78)
  - `2026-06-18 7275P` qty1 price **19.2** CLOSING buy (−1921.22)
- **expected: openNetDebit = 46.0, closeNetCredit = 47.0**
- seed `status`: closed
- Opened 2026-05-19, BEFORE `8a63aa81` (2026-06-09) — relevant to Test C's ordering
  trap, see below.

### 8. `45727d08` — 7300P Jun5/Jun29
- front 2026-06-05 · back 2026-06-29
- OPEN 2026-05-15, order `1006379061928`:
  - `2026-06-29 7300P` qty1 price **100.94** OPENING buy (−10095.22)
  - `2026-06-05 7300P` qty1 price **56.44** OPENING sell (+5642.78)
- CLOSE 2026-05-18, order `1006405063827`:
  - `2026-06-29 7300P` qty1 price **112.54** CLOSING sell (+11252.78)
  - `2026-06-05 7300P` qty1 price **67.54** CLOSING buy (−6755.22)
- **expected: openNetDebit = 44.5, closeNetCredit = 45.0**
- seed `status`: closed

### 9. `53533aa7` — 7275P Jun5/Jun26
- front 2026-06-05 · back 2026-06-26
- OPEN 2026-05-12, order `1006328241982`:
  - `2026-06-26 7275P` qty1 price **122.27** OPENING buy (−12228.22)
  - `2026-06-05 7275P` qty1 price **82.72** OPENING sell (+8270.78)
- CLOSE 2026-05-15, order `1006374383514`:
  - `2026-06-05 7275P` qty1 price **59.73** CLOSING buy (−5974.22)
  - `2026-06-26 7275P` qty1 price **100.98** CLOSING sell (+10096.78)
- **expected: openNetDebit = 39.55, closeNetCredit = 41.25**
- seed `status`: closed

### 10. `b0d862ba` — 7300P May29/Jun22
- front 2026-05-29 · back 2026-06-22
- OPEN 2026-05-08, order `1006293766875`:
  - `2026-06-22 7300P` qty1 price **108.45** OPENING buy (−10846.22)
  - `2026-05-29 7300P` qty1 price **63.1** OPENING sell (+6308.78)
- CLOSE 2026-05-12, order `1006325330463`:
  - `2026-06-22 7300P` qty1 price **117.55** CLOSING sell (+11753.78)
  - `2026-05-29 7300P` qty1 price **68.7** CLOSING buy (−6871.22)
- **expected: openNetDebit = 45.35, closeNetCredit = 48.85**
- seed `status`: closed

### 11. `95546839` — 7050P May20/Jun18
- front 2026-05-20 · back 2026-06-18
- OPEN 2026-04-20, order `1006070855412`:
  - `2026-05-20 7050P` qty1 price **96.3** OPENING sell (+9628.78)
  - `2026-06-18 7050P` qty1 price **143.85** OPENING buy (−14386.22)
- CLOSE 2026-04-21, order `1006078556268`:
  - `2026-06-18 7050P` qty1 price **138.8** CLOSING sell (+13878.78)
  - `2026-05-20 7050P` qty1 price **90.05** CLOSING buy (−9006.22)
- **expected: openNetDebit = 47.55, closeNetCredit = 48.75**
- seed `status`: closed

### 12. `f3789ddd` — 6900P May7/Jun1 — **same-day open + close**
- front 2026-05-07 · back 2026-06-01
- OPEN 2026-04-16, order `1006028000778`:
  - `2026-05-07 6900P` qty1 price **64.81** OPENING sell (+6479.78)
  - `2026-06-01 6900P` qty1 price **105.41** OPENING buy (−10542.22)
- CLOSE 2026-04-16 — **same calendar day as the open**, order `1006028001427`
  (a different `orderId` from the open):
  - `2026-05-07 6900P` qty1 price **62.97** CLOSING buy (−6298.22)
  - `2026-06-01 6900P` qty1 price **103.97** CLOSING sell (+10395.78)
- **expected: openNetDebit = 40.6, closeNetCredit = 41.0**
- seed `status`: closed
- Proves pairing keys off `orderId`, never trade date — the open and close orders
  fall on the identical `tradeDate` and must not be conflated.

### 13. `3ca74277` — 7375P Jul8/Jul31
- front 2026-07-08 · back 2026-07-31
- OPEN 2026-06-12, order `1006740037547`:
  - `2026-07-08 7375P` qty1 price **94.39** OPENING sell (+9437.78)
  - `2026-07-31 7375P` qty1 price **137.39** OPENING buy (−13740.22)
- CLOSE 2026-06-15, order `1006753323002`:
  - `2026-07-31 7375P` qty1 price **86.5** CLOSING sell (+8648.78)
  - `2026-07-08 7375P` qty1 price **44.15** CLOSING buy (−4416.22)
- **expected: openNetDebit = 43.0, closeNetCredit = 42.35**
- seed `status`: closed

### The 14th, synthetic fixture — negative control for the status-transition rule

Not one of the 13 real calendars. Built solely to prove a genuinely-open calendar
must NOT be auto-closed:

- id `00000000-0000-4000-8000-000000000099`, 7500P, front 2026-09-04, back 2026-10-02
- ONE order only, 2026-07-04, order `9990000001`, OPENING only (no CLOSE order
  exists anywhere for it):
  - `2026-10-02 7500P` qty1 price **100** OPENING buy
  - `2026-09-04 7500P` qty1 price **60** OPENING sell
- expected: status stays `"open"` after the closure check runs (no event, no
  transition — see Rule 4 below).

### Global invariants the suite also checks

- **52 fills total** written from the 13 calendars' 4 fills each (2 OPEN legs + 2
  CLOSE legs), even though `60c46a57`/`24f1e72e` share one 4-leg broker order (fewer
  distinct `orderId`s, never fewer fills).
- **Zero orphaned fills** after a full sweep — every fill, including the two shared
  front-leg symbols, resolves to exactly one calendar.
- **Exactly 4 events per calendar**, all `OPEN` or `CLOSE` — never a spurious `ROLL`
  (confirms `detectRoll`'s strict same-strike/type/root requirement holds even for
  the 60c46a57/24f1e72e pair, which shares a broker order but not a strike).

---

## The two hard cases

### Hard case 1 — the shared front-month leg (`8a63aa81` and `6303e6af`)

Both calendars' **front** leg is the exact same OCC contract:
`SPXW 260618P07275000` (2026-06-18 expiry, 7275 strike, put). One is a very
short-dated calendar (front Jun18 / back Jun23, opened Jun 9); the other is a
longer one (front Jun18 / back Jul17, opened May 19) — coincidentally reusing the
identical front-month contract at a different time.

Why this is hard: a leg-lookup keyed only on OCC symbol (`readCalendarLegs`) returns
**two calendar candidates** for every fill on that symbol — for either calendar's
open AND close fills. The naive old behavior treated "more than one candidate" as
unresolvable and orphan-parked the fill. That silently dropped one calendar's real
economics down to just its unique back leg — e.g. `8a63aa81` would compute a
back-leg-only debit of 62.50 instead of the true net `62.50 − 52.30 = 10.20`.

The fix (Rule 3 below) disambiguates using the **other leg in the same broker
order**: within one order, the back leg (`Jun23` for `8a63aa81`, `Jul17` for
`6303e6af`) is NOT shared with any other calendar, so it uniquely "anchors" that
order to one calendarId. Every other fill in that same order — including the
ambiguous shared front leg — resolves to that anchor.

There is a second layer to this hard case, exercised by Test C: the REAL production
mechanism that hit this bug was not a full sweep but `fix-pnl-reingest.ts`'s
per-calendar rebuild path, which reads fills **scoped to one calendar's own legs**.
A naive scoped read for `8a63aa81` would only fetch fills matching `8a63aa81`'s own
legs — never the sibling `6303e6af`'s unique back leg — so `resolveFillMatches`
would have no anchor fill to work with at all, even with the disambiguation logic
correctly written. The round-5 fix therefore had to widen
`readUnprocessedFillsForCalendar` to also include "order context" fills — every fill
in the same broker order, not just fills matching the calendar's own registered
legs — regardless of which of the two calendars gets rebuilt first. Test C proves
this by replaying the exact processing order the orchestrator's real correction
script uses (`listCalendars` descending by `openedAt`, which puts `8a63aa81`
(opened Jun 9) before `6303e6af` (opened May 19)) and asserting both converge to
their correct numbers with zero orphans, including on a second, idempotent rebuild
of `8a63aa81`.

### Hard case 2 — the stale status column (`65aac62e`)

`65aac62e` was **registered** `status: "open"` in the calendars table. But its real
broker history is complete: it opened 2026-06-22 and a CLOSE order on 2026-07-01
(order `1006990704540`) fully unwinds both legs (net quantity zero on every leg it
touched). The stored status column simply never got updated to reflect that — it
reflects whatever the calendar's *last known* state was, not what the *full replayed
event history* proves.

Why this is hard: any code path that classifies a fill, or decides whether a
calendar is closed, by reading the `status` column is reading a value that can be
**stale relative to the very fills being processed**. It's not merely wrong for
`65aac62e`'s display — trusting status while classifying its historical fills would
misclassify a real CLOSE fill as OPEN (or vice-versa) purely because status hadn't
caught up. The fix (Rules 2 and 4 below) derives all of these facts from the events
themselves and never reads the status column as an input to computation — it treats
status as an output to be corrected, not a source of truth.

---

## The four disambiguation rules and what breaks without each

All four live in `packages/core/src/journal/domain/fill-pairing.ts`.

### Rule 1 — classify a fill from `positionEffect` only, never `side`

```
classifyFill(positionEffect: "OPENING"|"CLOSING"|"UNKNOWN"): "OPEN"|"CLOSE"|"UNKNOWN"
```

> positionEffect is the authoritative classification signal: OPENING→OPEN,
> CLOSING→CLOSE, UNKNOWN→UNKNOWN. The raw fill `side` is not used here — it carries
> no classification information beyond positionEffect, so a dead `side` param is
> omitted (REVIEW WR-06: do not fabricate a side and feed it to a branch that ignores
> it).

`side` (buy/sell) is a real, needed field elsewhere — it drives the sign of the net
amount in `AggregatedFill.side` — but it must never be consulted to decide
OPEN-vs-CLOSE. **What breaks without this rule:** `side` alone is ambiguous for
that purpose — closing a short position is a "buy," and closing a long position is
a "sell," exactly mirroring the two OPENING sides. A classifier that infers OPEN/CLOSE
from `side` instead of `positionEffect` will get every closing fill on a short leg
backwards.

### Rule 2 — derive `positionEffect` from the first fill, never from the calendar's status column

Inside `aggregatePartialFills`:

> positionEffect = the first fill's OWN broker-reported role (journal-pnl-opennetdebit-units
> round 4) — NOT an externally-supplied value derived from the calendar's current
> status column (that was the round-4 root cause: a calendar's `status` reflects its
> LATEST known state, not what a historical fill's role was at trade time, so
> deriving classification from it folded real CLOSE fills into OPEN events, or vice
> versa, whenever status hadn't kept pace with reality).

**What breaks without this rule:** this is the round-4 root cause directly, and
exactly the `65aac62e` failure mode. Any fill aggregation step that asks "what does
this calendar's status column currently say?" instead of "what did the broker say
this specific historical fill was?" produces wrong OPEN/CLOSE events the moment the
calendar's status is out of date relative to the fills being (re)processed — which
is precisely the reprocessing scenario a re-ingest/rebuild exists to handle.

### Rule 3 — disambiguate shared legs by order-anchor intersection

`resolveFillMatches`, guarding hard case 1:

> The disambiguating signal: a calendar's OPENING (and CLOSING) broker order
> contains BOTH its legs together. Within one order, a leg matching EXACTLY ONE
> calendar (an "anchor") tells us which calendar every OTHER fill in that SAME order
> belongs to. An ambiguous fill is resolved to its order's anchor ONLY IF that
> calendarId is one of its own candidates AND the order has exactly one anchor
> calendarId; otherwise it stays ambiguous — never guessed (D-05/WR-01).

The implementation explicitly also handles the case where one order legitimately
anchors **two** calendars at once (a genuine ROLL order that closes one calendar and
opens another in the same broker order) — the code comment notes an earlier
regression (2026-07-24) where a naive `size === 1` gate gave up and orphan-parked
the new calendar's shared leg forever. The final rule: match only when **exactly
one** of the fill's own candidates is anchored by its order; if more than one
candidate is anchored, stay ambiguous rather than guess.

**What breaks without this rule:** hard case 1, verbatim — "the old matching logic
orphan-parked all of them — each calendar kept only its unique back leg (a
back-leg-only debit, e.g. 62.50 instead of the true net 62.50-52.30=10.20)."

### Rule 4 — net quantity per leg decides "closed," never a status column

`isCalendarFullyClosed`, guarding hard case 2:

> OPEN increases a leg's net qty; CLOSE decreases it; ROLL decreases the
> rolled-from leg and increases the new leg. A calendar with events but zero net
> qty on every touched leg is fully closed — regardless of its stored `status`
> column (the exact bug: `status` can go stale and never reflect events proving the
> position was unwound, e.g. 65aac62e).

Implementation detail worth preserving: a calendar with **zero events** is NOT
considered closed (`hasOpen` must be true) — this is what keeps the synthetic
"still open" 14th fixture correctly `open`, since it has fills but (in the negative
control scenario) no processed OPEN event bumping its net-qty map.

**What breaks without this rule:** `65aac62e` (and any calendar like it) stays
registered `"open"` forever, no matter how many times fills are re-synced, because
nothing ever re-derives status from the replayed events — the column is simply
never touched. Per the ground-truth doc's own root-cause note, the downstream
consequence was that "snapshot-calendars kept snapshotting it past its Jul-1 close
and the masthead shows a live mark-based P&L... for a trade that's actually done" —
i.e., a fully realized, closed trade kept being valued with the live-mark formula
instead of its realized P&L. This is the same calendar and the same status-staleness
class of bug that, per the broader investigation, produced wildly wrong displayed
P&L for a real closed trade (a true +$395 realized outcome rendered as a five- or
six-figure loss elsewhere in the pipeline) — the concrete stakes this rule exists to
prevent.

Test B additionally locks down two non-obvious behavioral requirements for the fix:
- `closedAt` on the newly-transitioned calendar must be **the real close order's
  own date** (2026-07-01 for `65aac62e`), never `now()` — the moment the re-ingest
  happens to run.
- The transition must be a true no-op on already-closed calendars: re-running it
  must NOT overwrite an existing `closedAt` with a fresh timestamp (proved with a
  deliberately implausible sentinel date, 2020-01-01, that must survive untouched).
