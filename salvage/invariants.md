# Invariants salvaged from the property-based tests

Source: every `*.test.ts`/`*.property.test.ts`/`*.contract.ts` under `packages/` and `apps/`
that imports `fast-check`, read before the application code (`apps/`, `packages/`) was deleted.
Structure, DI wiring, and file organisation are gone by design — this document keeps only the
**claims about the system** that a property test asserts, the **domain of inputs** it was
checked over, and **measured constants** with the experiment behind them. Cited by file path;
this repo bans line numbers because they rot.

## How to read "suspect" flags

Two failure modes recur in property-based tests, and this codebase's own tests exhibit both.
Where a property below is flagged, treat the property as *documentation of intent*, not as
proof the code was correct:

- **Vacuous / adversarial-input-then-no-assertion.** The generator can produce an input the
  implementation rejects, and the property lets that count as a pass (`if (!result.ok) return
  true`), so a solver that started erroring on every input would leave the property green. Or
  the property asserts something true of *any* function (`f(x) === f(x)` for a pure `f`),
  proving determinism, not correctness.
- **Self-referential oracle.** The "expected value" the property checks against is the same
  formula the implementation computes, sometimes copy-pasted from the source file. This proves
  the implementation didn't drift from a written-down formula (real value — it catches
  refactor slips) but it is *not* independent evidence the formula itself is right. A bug baked
  into the formula would satisfy its own property forever.

Flags are noted inline as **[SUSPECT: vacuous]** or **[SUSPECT: self-referential]** with the
specific reason. Unflagged properties either check a domain-independent mathematical fact
(monotonicity, boundedness, idempotence, no-NaN) or reconcile two *independently derived*
quantities (e.g. a use-case's output against raw fill economics computed a different way) —
these are the load-bearing ones.

---

## Quant (BSM pricing core)

Source: `packages/quant/src/bsm.test.ts` (duplicated verbatim in `packages/core/src/journal/domain/bsm.test.ts`).

- **Calibration fixtures are named textbook/reference values, not measured-from-production
  numbers** — keep them as regression pins in the rebuild:
  - Fixture 1 "Hull Classic (q=0 baseline)": S=42, K=40, T=0.5, r=0.10, σ=0.20, q=0 → call
    ≈4.7594, put ≈0.8086, call delta ≈0.779131, put delta ≈−0.220869, gamma ≈0.049963, call
    theta/day ≈−0.012482, vega/vol-point ≈0.088134. Tolerance `TOL = 1e-4` **[UNJUSTIFIED — no
    recorded reasoning for 1e-4 specifically]**.
  - Fixture 2 "SPX ATM q=1.3%": S=100,K=100,T=1.0,r=0.05,σ=0.20,q=0.013 → call≈9.6439,
    put≈6.0584, call delta≈0.604271, put delta≈−0.382813, gamma≈0.018906, call theta/day
    ≈−0.015153, put theta/day≈−0.005645, vega≈0.378117.
  - Fixture 3 "OTM put SPX-like": S=100,K=95,T=0.25,r=0.045,σ=0.18,q=0.013 → call≈7.0710,
    put≈1.3327, call delta≈0.756762, put delta≈−0.239993, gamma≈0.034490, call theta/day
    ≈−0.021056, vega≈0.155204.
  - T≤0 collapses to intrinsic value exactly (not an approximation).
  - `bsmVega` (unscaled) must equal `bsmGreeks(...).vega * 100` — i.e. the greeks-object vega
    is scaled ÷100 relative to the raw BSM vega, and IV inversion must use the **unscaled**
    one as its Newton denominator.
- **Property domain used everywhere in this file**: S∈[500,8000], K∈[400,9000], T∈[0.01,2],
  σ∈[0.05,3] — this is described explicitly as "the SPX domain." `numRuns: 1000` throughout.
- Invariants (all held over that domain, `numRuns=1000`):
  - call delta ∈ [0,1]; put delta ∈ [−1,0]; gamma ≥ 0 (both call and put — same formula);
    vega ≥ 0.
  - **Call theta ≤ 0 only inside a ±20% strike-moneyness band** (K/S ∈ [0.80,1.20]) — comment
    explains why the domain is restricted: *"Outside this band (deep ITM/OTM with near-zero T),
    BSM theta CAN be positive (dividend carry q·S·N(d1) dominates) — correct, but outside the
    operationally relevant domain (contracts outside ±10% never reach compute-bsm-greeks)."*
    Also: *"Put theta sign can also be positive when r > q."* This is a real mathematical
    property of BSM, not a codebase quirk — do not assume theta-always-negative in the rebuild.
- **fast-check v4 mechanical constraint recorded repeatedly across the whole suite**:
  `fc.float()` requires **32-bit float bounds**, so every literal bound is wrapped in
  `Math.fround()`. Comment: *"Note: fc.float in fast-check v4 requires 32-bit float bounds. ...
  (Same pattern as the fc.date().filter fix from Phase 1 — STATE.md decisions)"* — a real
  fast-check v4 API constraint to carry into any v4/v5+ harness rewrite (check the target
  version's `fc.float` signature; this may not apply to newer fast-check).

## Journal

### IV inversion — `packages/core/src/journal/domain/iv-inversion.test.ts`

- **Round-trip property** (`numRuns=1000`, S∈[500,8000],K∈[400,9000],T∈[0.01,2],σ∈[0.05,3]):
  for a mark generated as `bsmPrice(S,K,T,σ,R,Q,type)` with R=0.045,Q=0.013, `invertIv` must
  recover a σ that reprices to within 1e-6 of the mark. **[SUSPECT: vacuous]** — the property
  body is `if (!result.ok) return true`, so any input the solver rejects passes trivially; the
  1000 runs only constrain the *ok* branch, not solver coverage.
- **Monotonicity property**: BSM price is non-decreasing in σ (σHi>σLo ⇒ price(σHi) ≥
  price(σLo) − 1e-10). This is a real, independent mathematical fact about BSM (vega ≥ 0), not
  self-referential.
- **Bisection-fallback coverage** (example tests, not property, but load-bearing): the solver
  has two paths — Newton-Raphson with a Brenner-Subrahmanyam initial guess, falling back to
  bisection when analytic vega at that guess is below `VEGA_THRESHOLD = 1e-8` **[UNJUSTIFIED —
  no recorded derivation for 1e-8]**. Deep-OTM (S=4000,K=8000,T=0.02) and near-expiry-ATM
  (T=0.005) are the two regimes that force this path. **Attribution note**: the test file
  reconstructs the guess itself, as `sigma0 = sqrt(2π/T)·mark/S, clamped to [0.001, 5.0]`, to
  independently verify vega is below threshold there — that clamp is the *test's own*
  reconstruction of what it expects the implementation to do, not a value read from
  `iv-inversion.ts` itself. Confirm the real implementation's clamp bounds before porting;
  treat this the same way as the self-referential-oracle caution in the preamble.
- **CR-03 regression (real bug, fixed)**: the solver used to guard against **American**
  intrinsic value, which is systematically higher than the correct **European** no-arbitrage
  lower bound `max(K·e^(−rT) − S·e^(−qT), 0)` for calls (mirror for puts) — SPX options are
  European. Worked numeric example from the review doc: S=7000,K=7700,T=90/365,r=0.045,q=0.013
  → American intrinsic = max(7700−7000,0) = 700; **European put bound ≈ 637.9**. A mark of 650
  (between the two) was wrongly rejected under the old American guard. **Rule for the rebuild:
  price European bounds, never American intrinsic, for European-style index options.**
- **WR-01 regression property** (`numRuns=1000`): *"across 1000-run round-trip property, every
  ok result reprices to mark within 1e-4 (no fabricated sigma)"* — added specifically to catch
  an endpoint-clamped σ escaping as `ok` without actually repricing correctly (a post-solve
  residual check). Same vacuous-shape caveat as the round-trip property above (early return on
  `!result.ok`).
- **Degenerate-input contract**: T≤0 → `err({kind:'expired'})`; mark below the European
  no-arb bound → `err({kind:'below-intrinsic'})`; mark above the upper no-arb bound (≈S·e^(−qT)
  for calls, ≈K·e^(−rT) for puts) → `err({kind:'above-bound'})`. **Never NaN — always a typed
  Result.** Final catch-all property (numRuns=1000) checks every generated input lands in
  exactly one of {finite ok, one of the 3 typed error kinds}.

### Forward vol — `packages/core/src/journal/domain/fwd-vol.test.ts`

- Formula: `forwardVol = sqrt((dteBack·backIv² − dteFront·frontIv²) / (dteBack − dteFront))`.
- Guard states, stated explicitly in the file's own docblock:
  - Normal term structure (radicand ≥ 0) → `{guard:"ok", forwardVol: finite}`.
  - Inverted (radicand < 0) → `{guard:"inverted", forwardVol: null}` — **never NaN**.
  - Degenerate radicand exactly 0 → still `"ok"` with `forwardVol: 0` (only `< 0` is inverted).
  - Non-finite input IV or `dteBack === dteFront` (would divide by zero) → treated as the SAME
    non-computable case as an inverted term structure (`guard:"inverted"`, not a separate error
    kind).
- Property (`numRuns=1000`, dte∈[1,400] integers, iv∈[0.001,3] floats): the result is never
  NaN — always either a finite `ok` or `null` with `inverted`.

### OCC root resolution — `packages/core/src/journal/domain/occ-root.test.ts`

- Rule: `"SPX"` → `["SPX","SPXW"]` (stored root first, sibling second); `"SPXW"` →
  `["SPXW"]` only (unambiguous, no split). **[SUSPECT: vacuous-ish]** — the fast-check property
  draws from `fc.constantFrom("SPX","SPXW")`, a 2-element domain; it's two example tests
  wearing property-test clothing, not a meaningful random-input check.

### RTH slot flooring — `packages/core/src/journal/domain/rth-slot.test.ts`

- Floors an instant to its 30-minute RTH slot boundary using `Intl`-based DST-safe logic
  (explicitly **not** manual UTC-offset arithmetic) — flooring must be correct across both EDT
  (UTC−4) and EST (UTC−5) without hardcoding either offset.
- **Idempotence property** (integer ms ∈ [Date.UTC(2024,0,1), Date.UTC(2028,0,1)]): flooring an
  already-floored instant is a no-op, for any instant across 4 years spanning multiple DST
  transitions; floored result ≤ input always.
- **Collapse property**: two RTH instants in the same 30-min slot floor to the identical Date.
  Restricted via `fc.pre(isWithinRth(...))` specifically because the DST spring-forward gap
  only ever occurs at 2am ET, outside RTH (09:30–16:00) — the test explains this restriction
  rather than leaving it implicit.

### Snapshot cooldown — `packages/core/src/journal/domain/snapshot-cooldown.test.ts`

- `isWithinCooldown(now, lastSnapshotAt, cooldownMs)`: `null` last → always false (never
  suppress on cold start); boundary `now-last === cooldownMs` → **false** (not within cooldown
  — the boundary belongs to "outside"); property (numRuns=100): monotonic in `now` — once false
  (elapsed ≥ cooldown), never flips back to true as `now` increases further.

### BSM inversion vs greeks — `packages/core/src/journal/domain/bsm.test.ts`

Byte-identical to `packages/quant/src/bsm.test.ts` above — same fixtures, same domain, same
±20%-strike-band theta-sign caveat. Two copies of the same suite existed in the repo.

### Fill pairing — `packages/core/src/journal/domain/fill-pairing.test.ts`

- `classifyFill`: `positionEffect` "OPENING"→"OPEN", "CLOSING"→"CLOSE", else "UNKNOWN".
  Completeness property over the 3-element domain **[SUSPECT: vacuous]** — trivially total by
  construction of a 3-branch function.
- `aggregatePartialFills`: qty-weighted average price; `commission`/`fees` sum treating `null`
  as 0; **side and positionEffect are read from the bucket's own fills, not supplied
  externally** — this was itself a fix: "positionEffect used to be supplied externally (derived
  from the calendar's current status column). It is now read off the bucket's own fills."
  `sumQty ≤ 0` (including an empty input) → `Result.err`, **never** an `avgPrice` of 0 masking
  the error. Property (unbounded runs): for arbitrary positive-qty fill batches, `sumQty` in
  the `ok` result equals the arithmetic sum of the input quantities — real (non-vacuous) check.
- `computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose) = closeCredit −
  originalOpenDebit − feesOnClose`. On a ROLL, the new leg's open debit is **never** subtracted
  here — it's cost basis for a *different* future close, not this realization. Monotonicity
  properties: strictly increasing in closeCredit, strictly decreasing in originalOpenDebit and
  in feesOnClose (all real, independently-checkable facts).
- `detectRoll`: true only for same calendarId + same orderId + same root+strike+type +
  **different** expiry. Same expiry (identical OCC) → false, even same order/calendar.
- `hashFillIds`: sorts ids then `':'`-joins before hashing (order-independent by construction);
  determinism property **[SUSPECT: vacuous]** — `f(x)===f(x)` holds for any pure function;
  order-independence is only checked by an example test, not the property.
- **`resolveFillMatches` — real production incident, 2026-07-24.** A leg symbol shared by two
  *different* calendars (e.g. a shared back-month leg reused by an older and a newer calendar)
  makes candidate lookup return 2+ matches for one fill. The fix: disambiguate using the fill's
  own **broker order** as signal — if exactly one candidate calendar is also anchored (has an
  unambiguous leg) in the *same order*, that calendar wins; if the order anchors 0 or ≥2
  candidate calendars, the fill stays `"ambiguous"` and is parked, never guessed. Documented
  real trade shape: a single broker order simultaneously closed a 7500-strike calendar and
  opened a new 7400-strike calendar (rolling), where the new calendar's back leg was shared
  with an older, already-closed 7400 calendar — resolved correctly by anchor-set intersection.
  **Rule: never guess a fill's calendar when ambiguous — only resolve via same-order anchoring,
  and only when the anchor set intersects the candidate set in exactly one place.**
- `isCalendarFullyClosed`: net-zero-by-leg across OPEN/CLOSE/ROLL events. A ROLL nets its
  "rolled-from" leg to zero but the new leg stays open until its own CLOSE. Real shape tested:
  "the real 65aac62e shape" — two legs opened together, must both independently close.

### Attribution (P&L decomposition) — `packages/core/src/journal/domain/attribution.test.ts`

- `isGapRow`: a row is a gap when `spot === "0"` (literal string sentinel) OR any of
  frontIv/backIv/netDelta/netGamma/netTheta/netVega parses non-finite.
- Accumulation starts at the first non-gap row with all four cumulatives (theta, vega,
  deltaGamma, residual) = 0.
- **Δt is derived from the row's own `time` field, not from `dteFront`/`dteBack`** — a 30-min
  same-day interval must yield a nonzero theta bucket; this is explicitly called out as a fixed
  bug ("Pitfall 3").
- Gap rows in the middle of a series get **null** cumulatives, and the interval(s) touching a
  gap are skipped entirely — post-gap cumulative equals pre-gap cumulative exactly (no partial
  credit for a half-known interval).
- **`pnlOpen` is stored/consumed in dollars, never divided by 100** — explicitly flagged as
  "Pitfall 1," with a magnitude-sanity assertion (`Math.abs(expectedResidual) > 50`) added
  specifically to catch a future regression that silently collapses the residual toward ~5.
- **Accumulation identity property** (numRuns=500, spans of 2–15 synthetic rows, arbitrary
  sub-span [a,b]): `Δcumulative(theta) + Δcumulative(vega) + Δcumulative(deltaGamma) +
  Δcumulative(residual) === Δ(pnlOpen)` over ANY contiguous non-gap span. **[SUSPECT:
  self-referential]** — `attribution.ts`'s own comment states the identity is "exact by
  construction" because residual is defined as *whatever plug makes the sum equal pnlOpen*.
  This property proves arithmetic closure of the bucket definitions, not that theta/vega/
  deltaGamma are individually computed correctly — a bug shared between all four buckets would
  still satisfy it. (Source comment, `attribution.ts`: *"...ccumulation identity exact by
  construction (see attribution.test.ts's fast-check...")* — the implementation's own comment
  admits this.)

### Journal application layer

- **`chunkDateRange.property.test.ts`** — pure date-window chunker (fully captured by its own
  docblock, `numRuns=1000` throughout, over "any valid [from,to] and positive maxDays"):
  - A (no gaps): union of all chunk day-spans equals the inclusive `[from,to]` day set.
  - B (no overlap): chunk spans are pairwise disjoint.
  - C (cap): every chunk spans ≤ `maxDays` days inclusive.
  - C2: each window's `from` = previous window's `to` + 1 day (contiguous).
  - D: `maxDays ≤ 0` → `Result.err`. D2: `from > to` → `Result.err`.
  These are genuine independent invariants (day-set arithmetic checked against the chunker's
  output), not self-referential.

- **`syncFills.property.test.ts`** — property suite over the real pairing pipeline, called out
  explicitly as hardening two rounds of production fixes (WR-A1/A2/A3). Docblock states the
  methodology rule directly: *"If a property finds a counterexample it is a real residual bug
  ... the source is fixed at root cause, never the generator narrowed to hide it."* Locked
  properties:
  - P1 no double-count: sum over emitted events of (#fills composing it) equals the number of
    distinct paired fills; no fill id appears in two events.
  - P2 idempotent sync: re-running sync over the same store emits no new events.
  - P2b partial growth: a fill arriving in a later sync forms exactly ONE new event covering
    only the new fill; prior events are untouched.
  - P3 rebuild reconcile: applying the sum-by-eventType recompute rule to emitted events yields
    `openNetDebit`/`closeNetCredit` equal to the *independently computed* raw-fill economics
    (price×qty) — a genuine cross-check, not self-referential.
  - P4 OPEN-only debit: `openNetDebit` is invariant under adding CLOSING fills to an
    already-opened leg — this is the exact regression it guards: classification used to be
    derived from the calendar's current status column rather than each fill's own
    `positionEffect`, so real CLOSE fills could leak into `openNetDebit`.

- **`syncTransactions.property.test.ts`** — **real production bug, WR-A3**: the prior
  `hexToUuid` synthesized a version-5 UUID and **dropped input hex nibble 12**, so two distinct
  `(activityId, legIndex)` keys could collide on the same UUID, and the `fills.id` primary key
  then silently dropped the second real fill via `onConflictDoNothing`. Fix: `hexToUuid` made a
  contiguous TOTAL mapping of the full 32-hex-char prefix (every nibble contributes). Locked
  property P4 (numRuns≥1000, "matching the pure-numerical convention in iv-inversion.test.ts"):
  distinct `(activityId, legIndex)` pairs → distinct fill UUIDs, checked in two complementary
  forms specifically so a hasher collision cannot mask a `hexToUuid` regression:
  - end-to-end key path through the real derivation with an injected strong avalanche hasher
    (8-lane FNV-1a+xorshift, standing in for sha256 since `node:crypto` is banned in `core`).
  - `hexToUuid` totality tested directly and in isolation from the hasher.
  - P4b shape: every derived id matches the UUID regex.
  **This split (isolate the hasher from the thing under test) is the positive counter-example
  to the vacuous-property pattern elsewhere in this codebase — cite it as the model.**

- **`cotNet.test.ts`** — pure integer net-per-class: `net + short === long` for all 5 CFTC/TFF
  classes (dealer, asset manager, leveraged money, other-reportable, non-reportable), checked
  over independent integer legs ∈ [0, 1,000,000], `numRuns=1000`. **Deliberately does not
  constrain long ≥ short**: comment states *"net can be negative in practice (dealers / asset
  managers can be net short index futures)."* Second property: all nets are exact integers
  (no floating-point drift — this function does pure integer subtraction only).

- **`rebuildCalendarHistory.test.ts`** — `enumerateRebuildSlots`: every emitted anchor lies
  within `[max(openedAt, windowFrom), min(closedAt ?? now, windowTo)]`, is RTH-valid, and the
  series is sorted with no duplicates (numRuns default, wide random date/offset domain spanning
  2024–2026). The use-case's row composition is checked against the SAME pure functions
  (`computeLegPairMetrics`, `computeSnapshotPnl`) the live snapshot writer uses — explicit
  "D-02, byte-identical-to-live-writer" goal, so a rebuilt engine must keep one shared formula
  path for scheduled snapshots and history rebuilds, not two. **[SUSPECT: self-referential]**
  for the final `pnlOpen` property — it calls `computeSnapshotPnl` as its own oracle to check
  the wired-up use-case, so it proves wiring correctness, not formula correctness.
  A resolve failure on either leg produces an **honest gap** (no `healSnapshot` call, not a
  fabricated row) — "D-04." A single slot's heal failure is recorded per-slot and **does not
  abort the rest of the calendar's rebuild** ("WR-01" regression, 40-REVIEW.md).

- **`fetchChain.test.ts`** property (numRuns=300, async): for the OCC symbol emitted from
  synthetic `(root, year∈[2026,2035], month, day∈[1,28], type, strike∈[100,9000])` tuples, the
  chain-ingest pipeline's persisted `root`/`expiration` round-trip the same digits the symbol
  was built from — a real parse/format round-trip check, not vacuous.

- **`getTradeDetail.test.ts`** property (numRuns=50): `front.delta + back.delta === (backRaw −
  frontRaw) × qty × 100` for synthetic per-leg deltas. **[SUSPECT: self-referential]** — this is
  the net-greeks formula restated as its own check (pins against drift, doesn't independently
  validate the ×100/×qty scaling choice).

- **`snapshotCalendars.test.ts`** property (async, "fast-check property: pnlOpen formula
  invariant"): `pnlOpen === (netMark − openNetDebit) × qty × 100` where `netMark = backMark −
  frontMark`. **[SUSPECT: self-referential]** — same pattern, restates the formula as the
  expected value. The `× 100` (dollars-per-contract-point) and `× qty` scaling is the load-
  bearing convention to preserve, even though the property can't validate it's the *right*
  formula.

## Calendar (SPX calendar-spread engine — richest production-damage narratives in the suite)

### `candidate.test.ts` — pairing front/back legs into scoreable candidates

- **Headline claim, stated in the file's own docblock**: term-structure signal must be read off
  each cohort's **50-delta reference IV**, never off the traded strike's own two IVs. *"Measured
  on the live chain, the top candidates ranked by per-strike forward factor all sat 250–300
  points from spot at roughly double the near-the-money reading — that is SPX put skew leaking
  into a term-structure measurement, and it would make the engine recommend deep OTM puts."*
- **Carry-consistency bug, measured live 2026-07-28**: both legs of a calendar must be priced
  on the SAME `(r,q)` carry. The engine used to take per-expiry solved carry with a flat
  fallback; since calendar front legs are 15–30 DTE weeklies while solved entries cover
  monthlies, the front leg often moved on the fallback while the back leg sat on solved carry —
  net delta (a difference of two deltas at one strike, the only score term selecting strike)
  partly measured *carry-source mismatch*, not the market. **Measured: 3,313 of 5,917
  candidates (56%) affected; forcing one carry moved 8 of the top-10 pairs' strikes** on a
  43-expiry live carry array.
- **Hard constants, asserted as literal values, described as "the trader's rule and cannot be
  crossed" (i.e. deliberately not configurable)**: `FRONT_DTE_FLOOR = 15`, `GAP_DAYS_FLOOR =
  15`, `BACK_DTE_CEILING = 90`. All three floors/ceiling are inclusive (exactly-15 DTE front,
  exactly-15-day gap, and a caller-supplied front ceiling cannot be raised past these — "a
  hostile ceiling cannot smuggle one in"). `frontDteMax` is the one configurable knob.
  Windows the engine is checked to actually reach: 15/30, 21/45, 30/60, 21/60 DTE pairs.
- Pairing rules: never pairs across roots (SPX vs SPXW); only pairs strikes quoted in BOTH
  expiries; requires BOTH legs tradeable; never pairs a cohort with itself or backwards
  (`backDte > frontDte` always, `frontExpiration !== backExpiration` always).
- **An inverted term structure (negative forward-variance radicand) is dropped with a named
  reason (`"term-inverted"`), never scored as zero** — explicit rejection of a substitution the
  "incumbent" (prior/reference implementation) made.
- Debit pricing uses the **fill haircut**, not mid-to-mid — buying the back up and selling the
  front down both work against the trader, so `debit > midDebit` always.
- `thetaCarry` is theta normalized by remaining extrinsic (matches the cited trading-doctrine
  convention of "~3%/day at 30 DTE, ~10% at 10 DTE") — reported but see `score.test.ts` below
  for why it is never scored.
- Property: no NaN in any numeric candidate field over `iv∈[0.05,0.9]` front/back
  (`numRuns=100`); candidate enumeration is invariant to cohort input order; every candidate
  key `(root,strike,frontExpiration,backExpiration)` is emitted exactly once.

### `cohort.test.ts` — grouping the flat option chain into priced `(root,expiration)` cohorts

Docblock states three things "paid for in production":

1. **Root is part of the cohort key.** SPX and SPXW quote the same strike/date with different
   books. A root-blind cohort **measured a real back IV of 68.89% against a front of 24.69% at
   strike 6675** — a book collision, not a market signal. SPX and SPXW on the same third-Friday
   date get **different T** (different settlement instants) despite having the same calendar
   DTE — settlement timing, not day-count, differs.
2. **`bsmIv` has three states**: `null` (never processed), literal string `"NaN"` (permanent
   solve failure), and a real number. A two-state read fabricates the third. IV ≤ 0 is also
   dropped (gamma/vega divide by σ). A cohort where every leg fails still emits — as a ladder of
   named gaps (`unpricedStrikes`), never a silent deletion. **Measured live 2026-07-29**: two
   put expiry-groups existed with 0 legs solved out of 199 and 1 quoted contracts respectively —
   under the old "group only rows with usable IV" logic, these expiries never formed a group at
   all and were unrescuable downstream.
3. **One spot per snapshot.** The chain is a two-vendor union; `snapshotSpot` takes the
   **median** of all rows' `underlyingPrice` specifically so one stale vendor row can't move it
   (tested: 3 clustered quotes + 1 far outlier → median stays near the cluster). Non-positive
   and non-finite spot values are excluded from the median entirely, not zero-filled.
- **50-delta reference IV is interpolated to exactly |Δ|=0.50 between the tightest bracketing
  strike pair, never picked-nearest, and never extrapolated beyond a bracket.** Two documented
  regressions before landing here:
  - Regression #1 (live SPX chain, 2026-07-27): "nearest to 50 delta" on a sparse cohort
    returned a 1-leg 7.7-delta strike at 26.22% IV as if it were near-50-delta, vs. a real
    4-leg 87.6-delta strike at 11.93% — inflating one pair's forward factor to 44.37% against a
    real maximum of 14.4%.
  - Regression #2 (found after bounding #1 with a tolerance): a tolerance alone is insufficient
    because front and back references could land at *different* deltas under skew — a
    systematic bias, not noise. **Measured**: SPX 17/53d front |Δ| gap 0.0702 vs back 0.0013 →
    nearest-pick FF reads 21.35% vs interpolated 10.91%; where both sides truly sit near 50Δ the
    two methods agree to within half a point.
  - **Bracket-too-wide guard**: nulls the reference (refuses to interpolate) when the
    bracketing strikes' delta gap exceeds **0.30** — same technique and rationale as the 25Δ
    risk-reversal's bracket refusal elsewhere in the codebase (never extrapolate across a wide
    gap).
- Separately, **`atmStrike`** (nearest-spot strike, for display) must resolve over the
  **quoted union** (legs ∪ unpriced gaps), not just priced legs — an earlier version scanned
  only priced legs and silently substituted a solved neighbour for an unsolved ATM strike, with
  a guard comment sitting one line above where the bug actually was ("the guard comment above
  atmIv stated the law correctly and sat above the wrong line" — an instructive editing-error
  pattern). Tie-break for nearest-to-spot is **toward the lower strike**, deterministically
  (order-independent).
- **Tradeability is marked, never filtered** — an unquotable leg (no bid, crossed market, or
  spread-too-wide) stays in the cohort with `tradeable:false`. Spread-width bound: 15% of mid.
  **Measured**: real SPX spread/mid is p50 0.6%, p90 1.0%, so *"the 15% bound is loose on
  purpose — it catches genuine garbage and discriminates nothing among real quotes."**
- **A cohort's whole snapshot uses ONE carry** — same bug/fix as `candidate.test.ts` above,
  restated at the cohort layer: measured live 2026-07-28, 3,313/5,917 (56%) of candidates were
  affected by the per-expiry-carry-with-fallback defect.
- 0DTE handling: a cohort expiring **today** stays live until its **own settlement instant**,
  not calendar midnight — SPX (AM-settled, 3rd-Friday-only) settles 09:30 ET, SPXW (PM-settled)
  settles 16:00 ET, a 6.5-hour gap on the same calendar date. Measured live 2026-07-29: SPXW
  0DTE carried 192 quoted puts, invisible under an old `dte <= 0` guard.
- Property: cohort building is invariant to input row order (`numRuns=100`); no NaN across
  `iv∈[0.001,3]`, strike∈[4000,12000]pts (`numRuns=200`); extrinsic value is never negative (a
  mid quote below intrinsic is a data artifact, not real negative time value — and extrinsic is
  the theta-normalization denominator elsewhere, so a negative value would flip the score sign).

### `score.test.ts` — the four-term cross-sectional candidate score

- **Why cross-sectional, not absolute-threshold, stated as measured fact**: the cited trading
  doctrine's calendar entry gate (Forward Factor ≥ 16–20%) is calibrated on single names
  running 60–105% implied vol; **measured across all 2,465 candidates in a live SPX snapshot,
  the maximum FF was 14.4% and the median 0.36%** — an absolute-threshold gate fires zero times
  on SPX and "looks like it is working" while returning nothing. Each score term is instead a
  **percentile within the snapshot** — scale-free by construction.
- `SCORE_WEIGHTS`: exactly two active terms, `fwdEdge: 70`, `deltaBalance: 30`, summing to 100.
  **[UNJUSTIFIED — no recorded measurement backs the specific 70/30 split; free to change.]**
- **Two terms were removed after being measured to be redundant or actively harmful — keep
  these as documented negative results, not just "don't add them back":**
  - `frontVrp` (front-leg IV minus one snapshot-wide realized-vol scalar, formerly weight 25):
    since `percentileRank` only compares `h ≤ value` and the subtracted realized-vol term was
    the SAME constant for every candidate in a snapshot, it could never move the ranking —
    **measured: doubling realized vol from 0.12 to 0.30 produced a byte-identical ranking.**
    What was actually left driving the ranking was `frontRefIv` alone, which is highly
    collinear with `fwdEdge` (higher front IV → lower forward vol → higher fwdEdge) —
    **measured Pearson correlation of the two terms' percentiles: 0.954.** A quarter of the
    score was `fwdEdge` counted twice. General lesson stated explicitly: *"A variance risk
    premium on ONE underlying is not a cross-sectional quantity at all."*
  - `thetaCarry` (theta ÷ remaining extrinsic, formerly weight 20): this quantity is
    **U-shaped in strike, with its minimum AT the money**, so "higher is better" ranking
    rewards the most extreme strike available. **Measured live 2026-07-27, one dense ladder**:
    strike 6660 (736pts OTM) → 0.03022; strike 7380 (16pts OTM) → 0.00744 (the minimum); strike
    7640 (244pts ITM) → 0.02852. Under this defect the top-ranked candidate sat 721 points OTM
    at the 93rd percentile of the term. The doctrine's theta-as-share-of-extrinsic concept
    compares *tenors* at the money (its stated numbers: ~3%/day at 30 DTE, ~10% at 10 DTE) — it
    was never meant as a cross-strike discriminator.
- Ranking mechanics: rank is **inclusive** (a value is ranked against a distribution containing
  itself), so with n candidates the floor score is `100/n`, not 0 — asserted explicitly (n=2 →
  floor 50; n=50 → floor 2). A term with no measurable value across the WHOLE snapshot is
  dropped and the remaining weights **renormalize to sum to 100** (not left capped below 100).
  A single candidate's own-missing value on an otherwise-active term scores that term's
  contribution as 0 (not skipped/excluded) — "must not be rewarded for the gap."
- Properties (`numRuns=150`): scoring is invariant to input order; every score lands in [0,100]
  and the output is sorted descending, for arbitrary FF distributions.

### `time.test.ts` — the one time-to-expiry function for the whole engine

- **Motivating defect, stated directly**: the repo carried **nine different time-to-expiry
  definitions**, three inside the GEX path alone; two of the nine disagreed about whether a
  `Date`'s components should be read as UTC or local (`computeT` in journal/domain/dte.ts reads
  UTC accessors; `settlementTimestamp` in packages/shared reads local ones) — handing the wrong
  flavour of Date to either is a silent one-day error, and this exact class of bug once made
  theta read visibly low against ThinkOrSwim. **Design response: `yearsToSettlement` takes the
  expiration as a bare `YYYY-MM-DD` string, never a `Date`** — "There is no Date to get the
  flavour of wrong."
- **DTE (whole calendar days, gate-counting) and T (settlement-aware, pricing) intentionally
  disagree and must not be derived from each other by rounding.** Measured example: from
  04:00Z, a 15-calendar-day expiry has T=15.67 days (rounds to 16, wrong); an AM-settled expiry
  25 calendar days out has T=24.9 (floors to 24, wrong). `calendarDaysTo` is therefore its own
  separate whole-day-count function, not derived from T.
- **Settlement time depends on root AND whether the date is the third Friday of the month**:
  SPX settles at the AM Special Opening Quotation (09:30 ET) **only** on the third Friday;
  SPXW always settles PM (16:00 ET); any non-third-Friday SPX expiry is PM-settled the same as
  SPXW. Measured gap on a real third Friday (2026-08-21): AM vs PM settlement differ by exactly
  6.5 hours.
- Properties: `yearsToSettlement` is monotonically non-increasing as `now` advances
  (`numRuns=200`); depends only on the expiration STRING, never on how a `Date` for "now" might
  have been constructed (`numRuns=100`) — directly targets the nine-conventions bug class
  above; strictly increasing by expiration date across a real ladder.

---

## Picker

Files: `packages/core/src/picker/domain/{candidate-selection,entry-gate,scoring,sizing,brakes,
realized-vol,fwd-iv,breakevens,rule-config}.test.ts`,
`packages/core/src/picker/application/{analyzeAdHocCalendar,previewPickerRuleOverrides}.test.ts`.

### `candidate-selection.ts` — band-scan universe + hard gates

- Band-scan: **every liquid 25-multiple strike with front delta in [−0.55, −0.25]** is a
  candidate — explicitly a membership test, not a nearest-pick, "so rung-gap misses like the
  user's 7450 are structurally impossible." `DELTA_BAND_MIN`/`DELTA_BAND_MAX` are the named
  constants (values not captured in this pass — read `candidate-selection.ts` directly for the
  literals; the test docblock pins them at −0.55/−0.25).
- Debit uses the **ORATS 2-leg 66%-of-width fill haircut** (`FILL_WIDTH_FRACTION`) — same
  "never price at mid" doctrine as the calendar engine's `candidate.test.ts` above.
- Hard gates, all counted in a `gateDrops` tally (never silently dropped): net-theta sign,
  per-pair term inversion, and a **tier-1 event blackout ≤3 days before front expiry**.
- `legSpansEvents` is a pure ISO-string-interval membership test, fast-check covered for
  arbitrary date sets — property checks that every event NAME returned by the function
  genuinely has an occurrence whose date falls in `(today, expiry]`.
- `autoTuneTargetDelta`: for any finite VIX (including out-of-range, `[-100,200]`), the result
  never leaves `[DELTA_BAND_MIN, DELTA_BAND_MAX]` (numRuns default, tolerance 1e-9). `null`/`NaN`
  VIX degrades to `DELTA_BAND_MIN`, not a thrown error or a fabricated mid value.
- **Source comment worth quoting verbatim** (`candidate-selection.ts`, cited by the task brief
  as a "free invariant statement in the author's own words"): tilt logic stays *"inside
  [deltaMin, deltaMax] (fast-check proven at the default edges)"* — note the qualifier: proven
  at the *default* edge parameters specifically, not for arbitrary overridden edges.
- `yearFractionToSettlement` — greeks in this module use the **settlement-aware** year
  fraction (matches `calendar/domain/time.ts`'s doctrine above), explicitly called out as "TOS
  parity, 2026-07-14 — whole-day dte/365 is retired."

### `entry-gate.test.ts` — market-level entry gate (densest property file in picker, 10 fc sites)

Docblock states 8 locked invariants directly:

1. VIX ≥ **25** OR VIX3M-ratio ≥ **0.95** each independently resolve state `'blocked'` — worse
   regime always wins between the two signals.
2. **Penalty band is linear 1.0 → 0.3** across VIX **20–25** and ratio **0.90–0.95**,
   monotonic, **never a step at the boundary**. Combined multiplier = `min(vixMultiplier,
   ratioMultiplier)` (the worse of the two signals gates the penalty too).
3. `businessDaysSince > 3` (or `asOf` null, or the macro series missing) → state `'blind'`,
   **fails closed** — treat missing/stale macro data as a block, not a pass-through.
4. **Hysteresis**: blocked/penalty state holds across a disarm band, no flap on noise — checked
   by fast-check for both the VIX ladder and the ratio ladder independently. Named constants:
   `VIX_BLOCK_ARM`/`VIX_BLOCK_DISARM` (arm at 25, disarm at 24 per the test body), `RATIO_BLOCK_
   ARM`/`RATIO_BLOCK_DISARM`. Property: any sequence of 2–6 values oscillating strictly inside
   `[disarm, arm)` after an initial arm never flips the state back — armed once, stays armed
   until crossing below `disarm`, checked for VIX and for ratio.
5. `businessDaysSince` is **NYSE-holiday-aware** and specifically verified correct across a
   3-day weekend **and Thanksgiving** (a holiday that isn't a fixed weekday-count problem).
6. **Brake passthrough**: `maxOpenBrake`/`cooldownBrake` force `entriesAllowed:false` with the
   brake named in the result (never a silent block).
7. `applyGatePenaltyScore` rounds and clamps its output into **[0, 100]**.
8. `VIX_LADDER` has **no gap and no overlap** across its four tiers — checked both for the
   fixed default ladder (`numRuns=200`, every VIX in `[0,100)` falls in exactly one tier) and
   for an arbitrary **overridden** ladder built from three positive ascending deltas (property:
   `resolveVixLadder` always stitches `curr.min === prev.max` for consecutive tiers, so a
   caller-supplied override cannot introduce a gap or overlap either).

### Other picker domain files

- **`realized-vol.test.ts`** — `RV = stdev(log returns, sample n−1) × √252` ("the experimental
  `vrp` rule, frontIV − RV20"). Null (not 0, not NaN) when fewer than 3 closes (need ≥2 returns
  for a sample stdev) or when any close is non-positive (log undefined). Properties: **scale
  invariance** — multiplying every close by any `k>0` leaves RV unchanged (real, independent
  check of the log-return math); RV is always finite and ≥0 when defined.
- **`fwd-iv.test.ts`** — identical guard shape and formula to `journal/domain/fwd-vol.ts`
  above: `fwdIv = sqrt((tb·ivb² − tf·ivf²)/(tb−tf))`, `guard:"ok"`/`"inverted"`, degenerate
  radicand===0 stays `"ok"`. This is effectively the same formula implemented (or duplicated)
  in two places in the codebase — **worth deduplicating in the rebuild rather than porting
  twice.**
- **`breakevens.test.ts`** — `findBreakevens` on a long-put-calendar payoff: returns 0, 1, or 2
  crossings, always finite, always within `[BISECT_LO·spot, BISECT_HI·spot]`, and the bisection
  search is bounded (`MAX_ITER`, `BISECT_STEPS`) — "no unbounded iteration" stated explicitly as
  a design requirement, not just an implementation detail.
- **`sizing.test.ts`** — `SIZING_TIERS` **reuses `VIX_LADDER`'s edges exactly** — stated as a
  design rule: *"one shared ladder, never a second band system."* Discrete contract counts:
  low→2, normal→2, elevated→1, crisis→0 (crisis "coincides with the gate's hard block" — sizing
  to zero at exactly the VIX level the gate independently blocks entries at, not a coincidence
  worth re-deriving separately in a rebuild). Half-open tier boundaries `[min,max)` — VIX
  exactly 20 resolves `"elevated"`, not `"normal"`. Property: every finite non-negative VIX
  resolves to a row that is a **member of the registry's own array** (`toContainEqual`), never
  a fabricated tier.
- **`brakes.test.ts`** — `MAX_OPEN_CALENDARS = 6`, `LOSS_COOLDOWN_PCT = -0.25`,
  `COOLDOWN_BIZDAYS = 2` — all three tagged **"USER DECISION 2"** in the source, i.e.
  explicitly a trader's choice, not derived. `maxOpenTripped`: true at exactly 6, false at 5.
  `cooldownActive`: true at exactly −25%, false at −24.9% (boundary inclusive on the "active"
  side, opposite convention from the snapshot-cooldown boundary above — check each boundary's
  own test rather than assuming a house-wide convention). `cooldownCutoff` reuses entry-gate's
  own `businessDaysSince` (not a separate calendar-day proxy) so NYSE-holiday awareness is
  shared, not reimplemented. `cooldownActive` skips a zero `openNetDebit` and a null
  `realizedPnl` row rather than computing a percentage against them (never NaN / divide-by-zero
  — checked for arbitrary row arrays, returns a boolean always).
- **`rule-config.test.ts`** — `resolvePickerRuleConfig`'s merge is checked for **idempotency**:
  feeding a resolved config's own values back in as overrides reproduces the identical config
  (fast-check over arbitrary override combinations) — the general "merge-then-remerge is a
  no-op" contract worth keeping for any settings-override resolver in the rebuild.
- **`scoring.test.ts`** — weights `WEIGHT_SLOPE/FWD_EDGE/GEX_FIT/EVENT/BE_VS_EM` = 40/25/15/10/10
  (picker-level score — a **different, five-term** score from the calendar engine's two-term
  `SCORE_WEIGHTS` above; do not conflate the two scoring systems in the rebuild). `beVsEm`'s raw
  value is explicitly required to be **the real breakeven-width/expectedMove ratio via
  `findBreakevens`**, "not the mockup's fixed-strike proxy" — i.e. an earlier mockup/prototype
  used a placeholder for this term and the real implementation was required to replace it with
  the genuine geometric computation. An inverted candidate (`fwdIvGuard:"inverted"`) scores its
  `fwdEdge` contribution as exactly 0 while the overall score stays finite (never NaN-poisons
  the whole score). Property (fast-check over strike/iv/dte/debit ranges, an ORATS-realistic
  debit synthesized via `bsmPrice`): every contribution and the total score stay finite and in
  `[0,100]`.
- **`analyzeAdHocCalendar.test.ts`** (application layer) — property (`fc.asyncProperty`) checks
  **byte-parity** between the ad-hoc analyzer path and `scoreCalendarCandidates` on an
  equivalent synthetic `RawCandidate` — i.e. a user pasting an arbitrary calendar must score
  identically to one the engine found itself, over strike/iv/dte/debit ranges. Also: a gate
  state of `BLOCKED` must **still score the candidate** ("binding #1 — never hide the
  analysis") — a blocked entry gate suppresses *trading*, not *information*.
- **`previewPickerRuleOverrides.test.ts`** — same byte-parity discipline: an **absent** staged
  override group must re-derive the exact same effective config the stored candidates were
  originally scored with, so every candidate's `newScore` equals its stored `score` and
  `gate`/`sizing` before/after are identical. Explicitly exercised against **both** a live-open
  stored gate and a stale-`"blind"` one, "never silently un-blinded" by the preview path.

---

## Analytics

Files: `packages/core/src/analytics/domain/{gex,implied-carry,percentile-rank.property,
regime,risk-reversal.property,rule-config}.test.ts`.

### `percentile-rank.property.test.ts`

- `percentileRank(value, history)`: empty history → `null` (no distribution to rank against).
- For non-empty history: result ∈ [0,100] always; **monotonic** — a larger value never ranks
  below a smaller one against the same fixed history; **inclusive** — ranking a value that
  itself appears `k` times in an `n`-length history gives rank ≥ `100·k/n` (the value counts
  itself as ≤ itself). **This `h ≤ value`-inclusive convention is exactly what
  `score.test.ts`'s `frontVrp` autopsy above depends on** — subtracting a snapshot-wide
  constant from every candidate cannot move an inclusive percentile ranking, which is *why*
  that term was inert. `numRuns=1000` throughout, value domain float∈[−5,5].

### `risk-reversal.property.test.ts` — the 25Δ risk reversal

- `interpolateRiskReversal` returns `putIV − callIV`, each leg linearly interpolated between
  the two smile points bracketing exactly **±0.25 delta**.
- **No-overshoot property**: the interpolated result always lies strictly between its
  bracketing points' IVs — checked by explicit shallow/deep delta generators per wing rather
  than an arbitrary smile, so the bracket is guaranteed to straddle ±0.25 by construction.
- **Null-safety**: a smile whose wings never reach ±0.25 (both shallower than 0.24 on each
  side) returns `null`, never a number.
- **Bracket-width gate, `MAX_BRACKET_WIDTH = 0.30`** (delta units): a bracket wider than 0.30
  around ±0.25 returns `null` — *"the smile is too sparse to trust a straight line across the
  gap."* Complementary property (WR-02) confirms brackets ≤0.20 wide still yield a finite
  result — the gate isn't accidentally over-firing on legitimate tight smiles.
- **Order-independence**: shuffling the input smile array does not change the result.
- **This 0.30 bracket-width bound is shared doctrine, not a coincidence** —
  `calendar/domain/cohort.test.ts`'s 50-delta reference-IV interpolation explicitly cites this
  module as "same technique and same never-extrapolate policy as the 25Δ risk reversal." Any
  rebuild of either interpolator should keep the two bound values in sync (or unify them into
  one shared bracket-interpolation primitive — they are the same algorithm applied to two
  different target deltas, 0.25 and 0.50).

### `gex.test.ts` — gamma exposure profile

- Oracle values are pinned against `mockups/gex-profile.json`/`gex-snapshot.json` (a real
  computed GEX profile, not a hand-derived fixture): spot 7381, flip ≈7488 (zero-crossing
  between spot=7480 gamma=−4.09 and spot=7500 gamma=+5.98), netGammaAtSpot≈−47.43 at spot=7380,
  callWall=7600 (argmax positive GEX in the snapshot, dollar value 1,230,277,553), putWall=7400
  (argmin/most-negative GEX, −5,974,395,559).
- `dollarGamma(gamma, oi, spot)` property: **monotone non-decreasing in open interest** when
  gamma>0 (`numRuns=1000`, oi∈[0,100000] integers, spot∈[5000,10000]).
- `findFlip` on a **monotone-positive** profile (no sign change) returns `null` — never
  fabricates a crossing point that doesn't exist (`numRuns=500`). Comment flags a real
  regression this guards: *"WR-01: field is `spot` not `strike`"* — an earlier version read the
  wrong field name off the profile rows.

### `rule-config.test.ts` (analytics — `resolveRegimeRuleConfig`)

Same shape as the picker's and exits' `rule-config.test.ts` files: omitting overrides
reproduces the four regime threshold pairs (`vixTermStructure`, `vvix`, `vix9dRatio`, `hyOas`,
each a `{warn, crisis}` pair) byte-identically against `regime.ts`'s own named constants
(`VIX_TERM_STRUCTURE_WARN/CRISIS`, `VVIX_WARN/CRISIS`, `VIX9D_RATIO_WARN/CRISIS`,
`HY_OAS_WARN/CRISIS`); a single-field override (e.g. `vvixWarn`) changes only that one field,
every sibling pair/field stays at its default. This is the third instance of the identical
"omission reproduces named constants, single override touches only itself" merge contract in
this codebase (picker, exits, analytics all have one) — worth implementing as one shared
generic merge primitive in the rebuild rather than three parallel hand-written ones.

### `regime.test.ts`

- Four pure banding functions (`bandVixTermStructure`, `bandVvix`, `bandVix9dRatio`,
  `bandHyOas`) classify a raw indicator value into `calm|warning|crisis`. **Boundary values are
  inclusive on the worse side** (`>= cut` triggers the escalation), matching the domain
  constants — not the codebase-wide convention seen elsewhere (compare against
  `snapshot-cooldown.test.ts`'s boundary-exclusive convention; check each function's own
  boundary test rather than assuming uniformity across the codebase).
- Properties (`numRuns=1000` each, run over all four band functions): **monotonic
  non-decreasing** in the input value; **total** — every value maps to exactly one of the three
  bands. Repeated again under an arbitrary **overridden thresholds** object, so a caller-tunable
  threshold config cannot break monotonicity either.
- `regime.ts` source comment (own words, cited by the brief as a free invariant statement):
  *"...and monotonic non-decreasing in its input (proven by regime.test.ts fast-check)."*

### `implied-carry.test.ts` — parity-implied dividend yield solver

- **Formula note, own words**: *"34-RESEARCH.md Pattern 2 / Pitfall 3: q = −ln[((C−P) +
  K·e^{−rT}) / S] / T... (RESEARCH's literally-quoted formula has a sign error — see
  implied-carry.ts's header comment; this oracle is what pins the corrected, verified form.)"*
  — i.e. the design-research document that specified this formula had a **sign error**, caught
  and fixed only by building a round-trip oracle (forward-price a synthetic call/put pair via
  `bsmPrice` at a *known* `q`, feed the marks back through the solver, assert recovery). Put-
  call parity is an exact BSM identity given shared `r/q/T/K`, so recovery holds to
  floating-point precision, not merely "close" — this file's own docblock states the general
  methodology rule: *"Money-path rule: build the oracle before trusting the math."*
- **Real production incident, 2026-07-27 — minimum-horizon refusal.** Parity divides the
  residual by `T`, so as `T→0` the solve becomes a noise amplifier rather than a measurement.
  Measured live values from the GEX snapshot's `impliedCarry`, escalating as DTE shrinks:
  - 0DTE → q = 0.2984 (29.8% implied dividend yield)
  - 1DTE → q = 0.0823
  - 2DTE → q = 0.0450
  - 3DTE → q = 0.0291
  - 4DTE → q = 0.0070 (back in the sane range)
  - steady state thereafter: ~0.009–0.012
  - two later expiries even went **negative** (q ≈ −0.1201 and −0.0857) — "non-physical for an
    index." Real SPX yields roughly 1.2–2.0%.
  - Root cause stated numerically: at 1 DTE, `T ≈ 0.0027`, so a five-cent bid/ask noise error
    in either mark moves the solved `q` by whole percentage points.
  - **Fix: the solver refuses to solve below a minimum horizon `T ≥ 0.02y` (~7.3 days /
    7 DTE)** — pinned by example tests at DTE ∈ {0.5,1,2,3,6} (all return `null`, "even when
    the marks are perfectly consistent" — the guard is on *conditioning*, not on whether a
    particular solve happens to look clean) and confirmed working again exactly at 7 DTE. Below
    the minimum horizon, `computeImpliedCarry` emits **no entry** for that expiry (not a
    fabricated one), and `resolveCarry` falls back to its flat default carry.
  - Round-trip property domain reflects this refusal directly: `T ∈ [0.02, 2]` years — "the
    solver now REFUSES a shorter horizon outright... This property is 'recovers q wherever the
    solve is defined,' so its domain moved with the function's."
  - Also returns `null` (never `NaN`) when either input mark is itself non-finite (corrupted
    upstream data).

---

## Backtest

Files: `packages/core/src/backtest/domain/{ablation-delta,bootstrap-ci,coverage,
directional-attribution}.test.ts`.

- **`bootstrap-ci.test.ts`** — `bootstrapCi(samples, seed, iterations?)`. Empty samples →
  `{low: NaN, high: NaN, n: 0}` (explicit degenerate case, not an error/throw). A constant-
  valued array or `n=1` degenerates to a **point interval** (`low === high === value`).
  **Seed-determinism is load-bearing and named directly in the docblock**: *"a re-run over
  identical replay data reproduces an identical interval — no false 'the numbers changed' alarm
  from an append-only audit tool."* Properties (unbounded/default `numRuns`): `low ≤ high`
  always, for any non-empty sample set (float∈[−1000,1000]) and any 31-bit seed; same seed +
  same samples reproduce byte-identical `{low, high, n}` on every call; a constant-value array
  of length 2–20 always degenerates to a point interval within `1e-9·max(1,|value|)` tolerance
  — comment explains the tolerance is deliberate, not sloppy: *"summing+dividing identical
  floats... can differ from the input by a few ULP — the invariant under test is 'degenerates
  to essentially a point,' not bit-identity."*
- **`coverage.test.ts`** — `coveragePercent`: a cohort with **no/degenerate chain data**
  ("gap") and a cohort with real data but **zero surviving candidates** ("empty-universe") both
  count toward a day's `total` but **never** toward `replayed`, and the two are reported
  distinctly. Docblock states why this distinction matters: *"a thin-real-data footprint is not
  mislabeled as a data gap."* Properties: `replayed ≤ total` always, per-day and overall
  (`fc.array` of up to 40 `{date, kind}` records over 3 fixed dates); `replayed === total − gap
  − emptyUniverse` exactly (nothing double-counted) for arbitrary kind sequences.
- **`directional-attribution.test.ts`** — a **median-split sign test**, deliberately not a
  correlation coefficient. Docblock: *"sign + n, NEVER a correlation coefficient."* Verdict is
  one of `"yes"|"no"|"insufficient"` — insufficient below a **floor of n<4** samples (pinned by
  explicit examples at n=0,1,2,3). Properties: the function never returns a numeric coefficient
  — verdict is always one of exactly the three strings, and `n` always equals the input sample
  count; a **constant metric array** (zero variance in the independent variable — nothing to
  split on) always degenerates to `"insufficient"` regardless of outcome values or sample count
  (checked for n∈[4,20], i.e. this is a real degeneracy check, not just the n<4 floor
  restated); any sample set below the n<4 floor is `"insufficient"` regardless of the actual
  metric/outcome values (checked up to length 3).
- **`ablation-delta.test.ts`** — `ablationDelta` diffs two **already-ranked** id lists
  (baseline vs. one rule ablated); it "never re-scores." Core invariant, stated directly:
  *"zeroing a rule whose raw contribution to a candidate was positive never yields an improved
  (lower-numbered) rank for that candidate"* — removing a positive contribution can only push a
  candidate's rank index up (worse) or leave it unchanged, **never down (better)**. This is
  checked as a genuine derived property (not vacuous): for a random unique-id candidate set
  (`fc.uniqueArray`, 2–12 candidates) with a random positive `contribution` subtracted from one
  target candidate's score, the re-ranked position of that candidate in the new ranking is
  never numerically lower than its baseline rank. `null` result when the candidate is absent
  from either ranking (never a fabricated 0).

---

## Exits

Files: `packages/core/src/exits/domain/{evaluate-exit,rule-config}.test.ts`,
`packages/core/src/exits/application/previewExitRuleOverrides.test.ts`.
Constants sourced from `packages/core/src/exits/domain/exit-rules.ts` directly (not a test
file, but the registry the properties below are checked against).

### The exit-rule registry — all thresholds explicitly "USER-LOCKED"

`exit-rules.ts`'s own header comment: *"All threshold values are USER-LOCKED (26-CONTEXT.md
'The playbook ladder') — encoded here EXACTLY, no re-derivation. Hysteresis disarm bands are
Claude's-discretion values (26-CONTEXT.md)."* **This is the opposite justification-status from
most of this document: these numbers are known-deliberate trader decisions, not measurements —
port them verbatim, do not treat them as free parameters to re-derive or optimize.** Only the
*disarm* bands (the hysteresis buffer around each user-locked arm threshold) were left to
implementation discretion, and are noted as such below.

- **Precedence ladder, first match wins** (`EXIT_PRECEDENCE`): `stop → evt → gamma → term →
  take → roll → hold`. Rationale per rule, quoted from the registry:
  - `stop`: *"Capital preservation is non-negotiable and time-critical. A stop is urgent risk
    control and fires before a patient profit target even when both conditions are live the
    same cycle."*
  - `evt`: *"A fixed calendar date, not a noise-driven trigger — mirrors the picker's own
    exitPlan.closeByExpiry discipline, so it runs ahead of the noisier continuous triggers below
    it."*
  - `gamma`: *"Pin/whipsaw risk in the final DTE window compounds fastest of the remaining
    triggers — a single session's move near expiry can erase weeks of theta gain."*
  - `term`: *"Front-back IV inversion means the calendar's entry edge is gone — a slower-moving
    structural signal than GAMMA's DTE-driven urgency."*
  - `take`: *"Profit-taking is patient by nature; evaluated after every risk-driven trigger
    above it. Highest qualifying rung wins (+15% over +10% over +5%)."*
  - `roll`: *"A constructive continuation, evaluated only once nothing more urgent fired.
    Replacement front is haircutFill-priced with the same ORATS fill model the picker uses on
    entry."* (i.e. exits and entries deliberately **share** the fill-haircut pricing function —
    `haircutFill` from `picker/domain/candidate-selection.ts` — do not fork a second one.)
- **TAKE rungs** (P&L%, highest→lowest, "highest qualifying rung wins" as a linear scan):
  +15% arm / 13% disarm; +10% arm / 8% disarm; +5% arm / 3% disarm.
- **STOP rungs** (deepest→shallowest, "deepest qualifying rung wins"): −50% arm / −48% disarm;
  −25% arm / −23% disarm.
- **TERM**: arms at front IV − back IV ≥ **0.005** (0.5 percentage points); disarms below
  **0.003** ("proportional ~40% buffer," per the source comment).
- **GAMMA**: arms at `|spot−strike|/strike > 0.02` (2% off-strike); disarms below 0.015; AND
  front DTE **< 7** (`GAMMA_FRONT_DTE_MAX`) — this DTE half has **no hysteresis band**, with the
  reasoning stated directly in source: *"DTE only decreases"* (a monotone countdown needs no
  disarm buffer).
- **EVT**: a fixed **3-day** blackout before front expiry (`EVT_BLACKOUT_DAYS`), explicitly "no
  hysteresis (a calendar date does not flap)" — matches the picker's own
  `EVENT_BLACKOUT_DAYS`, kept as a *separately-owned* exits-layer constant rather than a
  cross-module import, because "the domain layer only imports @morai/shared."
- **ROLL**: arms when front DTE strictly **< 14**; requires spot within **±1%** of strike
  (`ROLL_SPOT_BAND = 0.01`); requires P&L strictly **< 15%** (`ROLL_PROFIT_MAX`, i.e. rolling is
  refused once TAKE would already have fired at the +15% rung — the two rules are mutually
  exclusive by construction, not by precedence order alone); replacement front is selected from
  the **[14, 21] DTE inclusive** window (`ROLL_REPLACEMENT_DTE_MIN/MAX`).

### `evaluate-exit.test.ts` properties (6 fc call-sites)

- **Precedence property**: for combinations of {every named P&L rung, off-strike fraction ∈
  {0 (roll-eligible), 0.03 (gamma-eligible)}, front DTE ∈ {5,10,30}, term-inversion firing or
  not, event firing or not}, the evaluator resolves to exactly the highest-precedence rule that
  actually fires under `STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD` — checked as a genuine
  combinatorial property, not a single example.
- **Hysteresis properties** (both TAKE and STOP rungs, separately): once armed at a rung's
  exact `arm` threshold, hovering the P&L anywhere inside the open `(disarm, arm)` band for 2–4
  more steps (`fc.array` of random fractional positions within the band) **stays armed on that
  rung** — disarms only once the value actually crosses past `disarm`.
- **P&L basis rule, stated directly**: `pnlPct === (netMark − openNetDebit) / openNetDebit`,
  "never a parallel recompute" — i.e. exits must read the exact same P&L definition the journal
  layer already computes, not reimplement it with potential drift.
- TERM/GAMMA boundary thresholds are checked to fire **exactly at the locked literal**, not
  before it (off-by-epsilon boundary discipline, same pattern as `brakes.test.ts` above).
- ROLL prices its replacement front via the **shared** `haircutFill` (imported directly from
  `picker/domain/candidate-selection.ts` in the test file) — confirms the cross-module reuse
  noted above is real, not just a comment.
- Indicative-data gate (after-hours/stale/NaN market data) is checked to run **first**, before
  any other rule — "never an actionable escalate on a gated cohort."

### `rule-config.test.ts` (exits)

Same shape as the picker's `rule-config.test.ts`: omitting overrides deep-equals
`TAKE_RUNGS`/`STOP_RUNGS` exactly; a single-field override changes only that field, siblings
stay default; rung order (TAKE highest→lowest, STOP deepest→shallowest) is preserved through
the merge.

### `previewExitRuleOverrides.test.ts` (application layer)

Same byte-parity discipline as the picker's `previewPickerRuleOverrides.test.ts` above,
applied to exit verdicts instead of candidate scores: docblock states it explicitly "mirrors
computeExitAdvice.test.ts's fixture shapes and previewPickerRuleOverrides.test.ts's byte-parity
property structure." An **absent/empty staged exits override group reproduces the SAME verdict
the current live config produces**, for every open position — checked via `fc.asyncProperty`
over an arbitrary `netMark` fed into two open calendars simultaneously. Additional pinned
behavior: a staged rung change (e.g. `plus10Arm`) must flip the previewed verdict exactly where
the metric crosses the *new* arm value (not the old one); an after-hours/stale snapshot stays
`"indicative"` on **both** the current and staged sides of the preview (never one live, one
stale); a calendar with no snapshot yet is **skipped, not an error**. Port hygiene: the
preview's dependencies structurally exclude `persistExitVerdict`/`readChainForRoll` — a preview
must be provably incapable of writing or of pricing a real roll, not just conventionally
disciplined not to.

---

## Shared

`packages/shared/src/occ-symbol.test.ts` — OCC option-symbol format:
`RRRRRRYYMMDDCNNNNNNN` — 6-char left-aligned space-padded root, 6-digit `YYMMDD`, 1-char C/P,
8-digit strike **× 1000**. This exact encoding is depended on by name in several other files'
own comments above (`fetchChain.test.ts`'s round-trip property, `recompute-live-greek.test.ts`
hand-building a 21-char OCC string, `payoff-domain.test.ts`'s `occSymbolForStrike` helper) — it
is load-bearing shared vocabulary across calendar, journal, picker, and web, not an isolated
utility.

- **Round-trip property** (`numRuns` default): for arbitrary `(root, expiry, type, strike)`
  tuples — root from a small realistic set, strike a **positive integer** (`fc.integer({min:1,
  max:9999})`, comment: *"no fractional strikes for SPX"`), `formatOccSymbol` then
  `parseOccSymbol` must reproduce every field exactly (date compared by year/month/day, not
  exact instant — the format only carries a date, not a time). A parse failure on a
  self-produced formatted string is treated as a **hard test failure with full context dumped**
  (not a skip) — i.e. this round-trip is meant to hold for every value in the arbitrary's
  domain, unlike some of the "skip on reject" properties flagged elsewhere in this document.

## Streaming (no dedicated group in the task list — filed here nearest its domain)

- **`spot-move-detector.test.ts`** — `detectLargeMove(samples, newSample, windowMs,
  thresholdPct)`: prunes samples older than `windowMs` before appending the new one; triggers
  iff `|newPrice − oldestInWindow| / oldestInWindow ≥ thresholdPct` — **boundary is inclusive**
  (a move of exactly the threshold, e.g. 1.0% with `thresholdPct=0.01`, triggers `true`). A
  cold start (empty pruned window) never triggers. Properties: **pruning invariant** — every
  sample retained in `nextWindow` is within `windowMs` of the new sample's timestamp, for
  arbitrary sample arrays/timestamps/window sizes; **direction symmetry** — an equal-magnitude
  move up or down triggers identically, guarded with `fc.pre(Math.abs(magnitude - 0.01) >
  1e-6)` specifically to keep generated magnitudes away from the threshold itself, "so float
  rounding never flips one direction's outcome relative to the other's" — a deliberate
  precision-safety margin around a boundary-inclusive check.
- **`recompute-live-greek.test.ts`** — `recomputeLiveGreek`: inverts IV from a live tick's
  `mark` (falling back to `(bid+ask)/2` when `mark` is absent), typed-skip when neither mark nor
  midpoint is available or `T≤0` ("Pitfall 4") — never throws, never emits NaN on the ok path.
  Round-trip property: for synthetic ATM-ish ticks generated across spot∈[3000,8000],
  strike-as-fraction-of-spot∈[0.7,1.3], type, and seed-IV∈[0.1,1.0], recovering IV from a mark
  built at a known σ and repricing must reproduce the original mark within tolerance — same
  shape as `journal/domain/iv-inversion.test.ts`'s round-trip, applied to the live-streaming
  IV-recompute path specifically. Uses `parseOccSymbol` internally "to get the SAME T that
  recomputeLiveGreek will compute... avoids timezone-driven mismatches."

## Adapters contract seam (no dedicated group — filed here as it spans core/adapters)

`packages/adapters/src/__contract__/compute-analytics-seam.contract.ts` — a **real-Postgres
(testcontainers) seam contract**, not a pure-function property test, but it imports `fast-check`
directly and its own header explains a genuine production fix:

- **CR-01 (bounded read)**: leg observations and calendar snapshots are seeded at times
  `T_obs`/`T_snap` strictly **earlier** than the injected `now()` instant `N`. The **old**
  implementation resolved the analytics cycle via an **exact-`now()`** read and *"wrote 0 rows
  here"* — i.e. it never found the cohort at all unless a write happened to land in the exact
  same instant as `now()`. The fix reads the **bounded "latest leg cycle ≤ anchor"** instead of
  an exact match.
- **CR-02 (idempotency)**: running the use-case twice with two **different** `now()` values
  must leave row counts unchanged after the second run — the comment states the mechanism
  directly: *"PKs collide on the resolved cycle instant, not now()."* I.e. the primary key is
  (correctly) keyed on the **resolved cycle's own instant**, not on wall-clock `now()`, so two
  runs that resolve to the same underlying cycle collide safely and idempotently even though
  their `now()` inputs differed. **This is the load-bearing design rule for the rebuild: derive
  write-time primary keys from the resolved data cycle, never from the wall-clock instant the
  job happened to run at** — a `now()`-keyed PK is exactly what CR-01/CR-02 exist to rule out.
  Checked by an `fc.asyncProperty` over four independently-offset instants `(T_obs, T_snap, N1,
  N2)`, all distinct, `T_obs`/`T_snap` strictly before both `N1` and `N2`.
- **SC1 (single-anchor)**: `skew_observations.snapshot_time == term_structure_observations.
  snapshot_time` for one resolved cycle — the two derived tables must stamp the same anchor
  instant, not two independently-computed "latest" times that could drift apart.
- Snapshots-absent fallback: a chain-only read (no `calendar_snapshots` row yet) still writes
  skew/risk-reversal stamped at the resolved **leg** cycle time, with zero term-structure rows
  — and a re-run adds zero additional rows (idempotent even in the degraded/partial-data case).

---

## Web (`apps/web`)

Files with fast-check: `components/charts/{PayoffChart,PayoffChartMarks}.test.tsx`,
`components/{RegimeBoard,system/BulletGauge}.test.tsx`,
`lib/{candidate-to-position,chain-risk-reversal,date-projection,deriveStreamStatus,
iv-bisection,iv-calibration,live-position-greeks,payoff-domain,position-greeks,
scenario-engine,tos-parser}.test.ts`.

### `tos-parser.test.ts` — pasted ThinkOrSwim calendar-order parser, 9 locked rules

Vendor-text parsing is inherently full of undocumented format quirks; this file's docblock
states the full contract, which the rebuild will need to re-derive from scratch if this file
is not ported directly:

1. `BUY`/`SELL` + quantity (absolute value, minimum 1).
2. `PUT`/`CALL` — **defaults to `P` (put) if absent** from the pasted text.
3. Strike: **the last 3–5 digit number before the `PUT`/`CALL` token.**
4. Debit: the number after `@` (optional — an order can paste without a fill price).
5. **Two dates** in `DD MMM YY` format, **sorted ascending → front/back** (the two dates are
   not guaranteed to appear in front-then-back order in the pasted text itself).
6. DTE validation: front DTE must be **> 0**, back DTE must be **> front** — reject the whole
   parse otherwise (never silently accept an inverted or expired pair).
7. Underlying: the ticker after the literal word `CALENDAR`, **defaulting to `SPX`** if absent.
8. **Implied flat IV is derived via `impliedFlatIv`** (the same bisection solver documented
   below) — the parser's IV field is not itself in the pasted text; it is back-solved from the
   parsed debit and strikes/dates.
9. Both call and put calendars are supported (not put-only).
- **Canonical locked sample** (exact string, useful as a parser regression fixture in any
  reimplementation): `"BUY +1 CALENDAR SPX 100 (Weeklys) 30 NOV 26/20 NOV 26 [AM] 7550 PUT
  @5.80 LMT GTC"`.
- **Round-trip property** (`numRuns:1000`): for synthetic orders built from strike∈[5000,8000],
  frontDays∈[14,60], backDays = front+offset∈[7,30] more, call/put, and a seed IV∈[0.10,0.60]
  used to synthesize a realistic debit — parsing the generated order text, then re-solving
  implied flat IV from the parsed fields, must reprice the front/back BSM spread back to within
  `DEBIT_TOL = 0.02` of the original synthesized debit.

### `iv-bisection.test.ts` / `iv-calibration.test.ts` — a SECOND, browser-side IV solver

**Important structural note for the rebuild**: the web app has its own IV-from-price solver
(`iv-bisection.ts`, pure bisection) distinct from `packages/core/src/journal/domain/
iv-inversion.ts`'s Newton-Raphson+bisection solver documented in the Journal section above.
`iv-calibration.ts` (`resolveLegIv`) *does* import and wrap `invertIv` from `@morai/core`
(confirms `apps/web` is allowed to import core's pure functions per the architecture table),
but `impliedFlatIv` in `iv-bisection.ts` is a **separate**, calendar-spread-specific solver
that finds a single flat IV such that `BSM(back, iv) − BSM(front, iv) ≈ debit` — used
specifically by the TOS paste parser (rule 8 above), where only a net debit is known, not
per-leg IVs.
- `impliedFlatIv` contract, stated directly ("UI-SPEC TOS Parser Contract Rule 8"): **bounded**
  bisection, `lo=0.02, hi=2.0` — "never unbounded loop"; **no-debit default returns 0.15**
  (15% flat IV assumed when there's nothing to solve against); **unbracketable inputs return
  the closest bound** (`lo` or `hi`), never `null`/`NaN`/a thrown error. Tolerance
  `SPREAD_TOL = 1e-4` on the repriced spread for the known-fixture example; a looser
  `ROUND_TRIP_TOL = 0.02` "for the round-trip property at extremes" — i.e. the property test
  deliberately uses a wider tolerance than the example test because bisection near the bound
  edges (T very short, deep ITM/OTM) is less precise, and the test says so explicitly rather
  than silently loosening the check.
- `iv-calibration.ts`'s `resolveLegIv` — five distinct outcomes, each independently tested:
  1. **REST-fallback round-trip** (`numRuns=500`): when falling back to a REST-computed price
     (`netQty=1`, `restMarketValue = mark×100`), the recovered σ matches `invertIv`'s own
     result for the same effective tuple.
  2. **Live-tick trust shortcut ("Pitfall 2")**: when a live tick carries its own `bsmIv`, that
     value is **trusted verbatim and never re-run through `invertIv`** — i.e. two different IV
     sources exist (a live streamed IV and a REST-derived one) and the resolver must not
     silently re-derive the live one, which would be redundant work and a possible source of
     drift between the two.
  3. Deep-ITM/illiquid non-convergence → a typed `IvError`, never a bare number.
  4. Cold-start (no tick, `marketValue === null`) → `err({kind:"no-price"})`, explicitly
     **distinct** from the non-convergence error kind above (two different reasons to fail,
     kept as two different typed errors, not collapsed into one generic failure).
  5. `netQty === 0` on the REST fallback path → `err({kind:"no-price"})`, never NaN/Infinity
     from a division by zero ("Pitfall 3").
  6. Expired leg (`T ≤ 0`) → `err({kind:"expired"})`.
  7. **Cross-engine parity smoke test**: an `invertIv`-recovered σ must reprice through
     `@morai/quant`'s `bsmPrice` (a *different* import path than whatever `invertIv` uses
     internally) within `BSM_PARITY_TOLERANCE` of the original mark — guards against the two
     BSM implementations silently drifting apart.

### `scenario-engine.test.ts` — payoff/scenario projection engine (675 lines)

- **Kernel-parity requirement, stated as test (a)**: `repriceScenario`'s per-position greeks
  must equal a **direct** `bsmGreeks` call AND equal `computePositionGreeks`'s own output for
  the same inputs — three independently-invokable code paths that must agree exactly, not just
  approximately, on the same position.
- Payoff-shape requirement: a calendar's payoff **peaks near the strike** (sanity-checked
  directly, not just inferred from greeks).
- **Heatmap property** (`numRuns:1000`, spot∈[6900,7900]): every heatmap P&L cell is finite;
  and a symmetry bound — `|P&L above strike| / |P&L below strike| < 20` — is checked as a loose
  sanity bound, explicitly **not** exact symmetry: *"calendar is not perfectly symmetric, but
  the magnitude ratio should be reasonable."* Treat this as a smoke-test-strength property, not
  a precise mathematical claim about calendar payoff symmetry.
- Note from the file's own docblock: `rollScenario` (a prior feature) was **deliberately
  removed** from this suite in plan 18-05 because its only caller (the old Analyzer's
  RollSimulator) was retired — a reminder that some historical test coverage in this repo
  tracks now-dead UI, not a universal requirement to re-port everything ever tested here.

### `chain-risk-reversal.test.ts` — adapter, not the risk-reversal formula itself

Explicitly scoped: *"The 25Δ risk-reversal formula itself is NOT under test here... What IS
under test is the ADAPTER."* Two failure modes it exists to pin:
1. **Unit slips** — chain rows carry strike as `×1000` and DTE as whole days; forgetting the
   `÷1000` strike conversion or using a **365.25-day year** (not 365) for T silently produces
   deltas that never bracket ±0.25 (always null) or bracket the wrong points. Pinned by an
   exact-equality oracle against `packages/core`'s own `interpolateRiskReversal` fed the same
   already-correct smile.
2. **Fabricating a wing** — the live chain read was puts-only at the time this was written
   ("until the sibling widening lands"); a row with a missing `bsmIv` must be **dropped, never
   defaulted** — explicit house rule quoted verbatim: *"T-17-01 'never DEFAULT_IV'."* This is
   the same "never fabricate a missing input" doctrine seen in `cohort.test.ts`'s unpriced-
   strike handling and `iv-inversion.test.ts`'s typed-error-never-NaN discipline — a repeated,
   deliberate house style, not a one-off rule.

### `date-projection.test.ts` — the CBOE-UTC bug class, inverted

Docblock: *"RESEARCH Pitfall 1 (the CBOE-UTC bug class this project has hit twice, inverted
direction here): `<input type="date">` values must be parsed as LOCAL midnight, never via the
UTC-parsing single-string `new Date(string)` constructor."* (Project memory already records
that CBOE vendor timestamps are UTC and were once mishandled as local — this is the mirror-
image bug: a browser date-input's value must be read as *local*, and the naive `new
Date("YYYY-MM-DD")` constructor parses it as UTC instead, silently shifting the date by up to a
day depending on the viewer's timezone offset from UTC.) Locked with a fast-check round-trip
property stated to hold "regardless of the runner's timezone or time-of-day" — i.e. the CI/test
environment's own local timezone must not affect the result, which is exactly the property a
naive UTC-parse would fail non-deterministically depending on where the tests run.

### `deriveStreamStatus.test.ts` — SSE stream health derivation

Precedence, stated directly: **`isRth===false` → `"quiet"` wins first** (outside regular
trading hours, don't report a stall regardless of tick recency), then `"connecting"` (no ping
yet, or a cold-start grace period), then the elapsed-vs-threshold stall check last. Same
first-match-wins ladder shape as the calendar entry-gate and exit-rule precedence ladders
elsewhere in this document — a recurring pattern in this codebase for multi-condition state
derivation.

### `candidate-to-position.test.ts` and `payoff-domain.test.ts` — debit-as-max-loss invariant

- **`candidate-to-position.test.ts`**: converting a `PickerCandidate`'s two legs into an
  `AnalyzerPosition` must satisfy **debit = max loss** (D-01b): the worst-case P&L anywhere on
  the position's expiration curve must not exceed the original debit, within pricing tolerance
  — checked both as a single worked example and as a property (`numRuns:200`) over arbitrary
  in-range candidate legs. A guard-case candidate (`fwdIv: null`) must still adapt without
  throwing, since "the adapter never reads fwdIv, it only consumes legs" — a reminder that a
  field being null elsewhere in a larger object should not block a function that never reads
  that field.
- **`payoff-domain.test.ts`**: `computePayoffDomain`'s wide-pass curve generation is checked so
  that **every** strike, spot, and breakeven value produced anywhere in the curve build lies
  within the function's own returned `[min, max]` domain bounds — i.e. the domain-bounds
  computation cannot itself be inconsistent with the curve points it's meant to bound. Anchored
  against a real reported user repro (7500P strike, spot ~7381, left breakeven ~7150) as a
  named regression fixture, not just a synthetic case.

### `position-greeks.test.ts` / `live-position-greeks.test.ts`

- **`position-greeks.test.ts`** — real production-shaped rationale, stated directly: `GET
  /api/positions` (the `brokerPosition` schema) **does not carry computed greeks at all** — the
  docblock lists confirmed fields (`occSymbol/putCall/longQty/shortQty/averagePrice/
  marketValue/underlyingSymbol` only) — so greeks are computed **client-side** via the shared
  `@morai/quant` kernel, "per D-03 (live-only, fix at source)." Kernel-parity property: output
  matches a direct `bsmGreeks()` call for the same parsed inputs. Qty-scaling property:
  scaling `longQty` scales delta **linearly** (a real, independently-checkable BSM fact — delta
  is per-contract, net position delta is `netQty × delta`). Net qty = `longQty − shortQty`; a
  short-only position has negative delta. Expired/`T=0` positions return `NaN` for all greeks
  (BSM's `d1` is undefined/infinite at `T=0` — the same edge the quant module's fixtures handle
  by short-circuiting to intrinsic value at the *pricing* layer; this greeks layer instead lets
  the NaN surface, which is a different choice than `bsmPrice`'s explicit `T≤0` intrinsic-value
  branch — worth reconciling deliberately in the rebuild rather than porting both conventions
  unexamined).
- **`live-position-greeks.test.ts`** — `resolveLivePositionRow` overlays live SSE ticks onto
  otherwise-static polled greeks for the Overview positions table. Property: with an **empty**
  live-greeks map, the result is **byte-identical** to the existing static computation path
  (`netGreeksForLegs`/`netValue`/`netUnreal`) — i.e. the live-overlay code path must be a strict
  superset of the static one, never a parallel reimplementation that could silently diverge
  when no live data has arrived yet. Second property: never throws for arbitrary finite inputs,
  and `liveTs` is `null` **if and only if** no leg in the position had a live tick (an exact
  biconditional, not just "usually correlated").

### `PayoffChart.test.tsx` / `PayoffChartMarks.test.tsx` / `RegimeBoard.test.tsx` /
`BulletGauge.test.tsx` — UI rendering-contract properties

These are lighter-weight than the domain/application properties above — mostly "never renders
a fabricated/out-of-place DOM node" and "never lets a numeric prop escape its visual bounds"
checks rather than measured business logic:
- **PayoffChart / PayoffChartMarks**: for arbitrary in-domain or out-of-domain GEX wall/flip
  levels, the chart never renders a stray `"wall"`-labeled text node or edge-arrow glyph (`›`/
  `‹`) when the toggle for that mark is off / the level is out of range — a pure absence-of-
  fabricated-content check, run per-render across `numRuns=50`.
- **RegimeBoard / BulletGauge (shared bullet-gauge track)**: for arbitrary `value`/`min`/`max`
  triples (float ∈ [−1000,1000], degenerate `max ≤ min` cases explicitly skipped via an early
  `return` rather than asserted on), the rendered marker/segment position is always **clamped
  into the gauge's visual [0,100]% track** — never overflows past either end even when `value`
  is far outside `[min,max]`. `BulletGauge.test.tsx`'s docblock notes it was **extracted** from
  `RegimeBoard`'s own row-rendering code specifically "to prove the extraction preserves the
  exact markup/clamp math RegimeBoard.test.tsx already asserts" — i.e. this property exists
  twice in the suite (once against the composed `RegimeBoard`, once against the extracted
  `BulletGauge`) by design, as a refactor-safety check, not duplicated by accident.

---

## UNJUSTIFIED constants — consolidated

Every constant in this list has no recorded derivation, measurement, or experiment anywhere in
the test suite or its comments — the rebuild is free to change any of them without breaking a
documented invariant. (This is distinct from the exit-rule arm thresholds and floor/ceiling
constants elsewhere in this document, which ARE recorded as deliberate — either measured, or
explicitly "USER-LOCKED"/"the trader's rule.")

- **Calendar engine**: `SCORE_WEIGHTS.fwdEdge=70 / deltaBalance=30` — the *removal* of the
  other two terms is measured (0.954 correlation, U-shaped ladder); the surviving 70/30 split
  itself is not.
- **Picker**: `WEIGHT_SLOPE/FWD_EDGE/GEX_FIT/EVENT/BE_VS_EM = 40/25/15/10/10` — no measurement
  recorded for this specific five-way split.
- **Picker**: `DELTA_BAND_MIN/MAX = −0.55/−0.25` (the band-scan universe's delta membership
  range).
- **Exits — the hysteresis DISARM bands specifically** (not the arms, which are USER-LOCKED
  and must be kept verbatim): TAKE disarms 13%/8%/3%; STOP disarms −48%/−23%;
  `TERM_INVERSION_DISARM=0.003`; `GAMMA_OFF_STRIKE_DISARM=0.015`. The source comment itself
  says these are *"Claude's-discretion values,"* i.e. explicitly not user-derived — the
  cleanest UNJUSTIFIED entry in the whole document because the code admits it.
- **BSM/IV tolerances**: `TOL=1e-4` (bsm.test.ts fixture tolerance); `VEGA_THRESHOLD=1e-8`
  (Newton→bisection fallback trigger); `BISECT_LO=0.02`/`BISECT_HI=2.0` and the no-debit
  default `0.15` (web `iv-bisection.ts`); `SPREAD_TOL=1e-4`, `ROUND_TRIP_TOL=0.02`
  (iv-bisection); `DEBIT_TOL=0.02` (tos-parser); `BSM_PARITY_TOLERANCE` (iv-calibration, exact
  value not captured in this pass).
- **Backtest**: `directionalAttribution`'s minimum-sample floor `n<4`; `scenario-engine`'s
  heatmap symmetry sanity bound (magnitude ratio `<20`) — explicitly called a "loose sanity
  bound," not a claimed mathematical property.
- **Harness convention, not a domain constant**: the `numRuns` ladder itself (1000 for "pure
  numerical" properties, 50–300 for async/integration-shaped ones) — repeatedly justified in
  comments only by *citing another file's convention*, never by a stated reason 1000 specifically
  was chosen. Treat the whole ladder as free to change when porting to a new harness.

**Recorded rationale, unmeasured magnitude** (a middle category — not the same as fully
unjustified): `MAX_BRACKET_WIDTH = 0.30` (25Δ risk-reversal / 50Δ cohort-interpolation bracket
gate). The *reason* for refusing a wide bracket is documented ("too sparse to trust a straight
line across the gap"), but no measurement pins 0.30 specifically over, say, 0.25 or 0.35 — the
policy is real, the exact number is a judgment call.

---

## Cross-cutting notes for the rebuild

- **fast-check v4 mechanical constraint, repeated everywhere**: `fc.float()` requires 32-bit
  bounds, so every numeric bound in this suite is wrapped in `Math.fround()`. If the rebuild
  uses a different fast-check major version, re-check whether this wrapping is still required
  before porting bound literals verbatim.
- **`numRuns` convention**: 1000 is the default for "pure numerical" properties (explicitly
  cited across multiple files as "matching the convention in iv-inversion.test.ts" /
  "chunkDateRange.property.test.ts"); lower run counts (50–300) appear on async/integration-
  shaped properties that spin up a use-case per run. No file records *why* 1000 specifically
  was chosen over another round number — treat the exact figure as convention, not a measured
  requirement, when porting the harness.
- **Recurring architectural rule visible only in test comments**: `packages/core` (including
  its own tests) never imports `node:*` — no `node:crypto`, no Docker, no Drizzle. Tests that
  would naturally reach for `crypto.randomUUID`/`sha256` instead inject a deterministic
  hash/hasher function. This is why `syncTransactions.property.test.ts` hand-rolls an 8-lane
  FNV-1a avalanche hasher rather than using `node:crypto` — carry the "core stays pure, inject
  the impure primitive" pattern into the rebuild, not the specific hasher.
- **Recurring numerical-safety rule**: money/greeks-producing functions are checked to *never*
  emit `NaN` — always either a valid finite number or a typed error/null. This shows up
  independently in `fwd-vol`, `iv-inversion`, `cohort` (candidate fields), and
  `candidate.test.ts`. Treat "never NaN, always a typed absence" as house style, not a one-off.
