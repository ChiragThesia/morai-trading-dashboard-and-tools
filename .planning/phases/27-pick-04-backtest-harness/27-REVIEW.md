---
phase: 27-pick-04-backtest-harness
reviewed: 2026-07-09T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - packages/core/src/backtest/application/replayHypotheticalEntry.ts
  - packages/core/src/backtest/application/replayPickerCohort.ts
  - packages/core/src/backtest/application/replayExitsForCalendar.ts
  - packages/core/src/backtest/application/runBacktest.ts
  - packages/core/src/backtest/application/ports.ts
  - packages/core/src/backtest/domain/bootstrap-ci.ts
  - packages/core/src/backtest/domain/directional-attribution.ts
  - packages/core/src/backtest/domain/coverage.ts
  - packages/core/src/backtest/domain/ablation-delta.ts
  - packages/core/src/picker/domain/scoring.ts
  - packages/core/src/journal/application/snapshotCalendars.ts
  - packages/adapters/src/postgres/repos/backtest-chain.ts
  - packages/adapters/src/postgres/repos/backtest-history.ts
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts
  - packages/adapters/src/postgres/repos/backtest-runs.ts
  - apps/worker/src/backtest.ts
  - packages/adapters/src/postgres/migrations/0021_backtest_runs.sql
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: fixed
fixed_at: 2026-07-09
fix_commits:
  CR-01: f164747
  WR-01: 3c286f6
  WR-02: 2b268c8
  WR-03: d66b675
  IN-01: bce4b22
  IN-02: docs
---

# Phase 27: Code Review Report

**Reviewed:** 2026-07-09
**Depth:** deep
**Files Reviewed:** 14 (+ tests/twins cross-referenced)
**Status:** issues_found

## Summary

The lookahead discipline on the replay READ paths is solid: `readChainAsOf`,
`readDailySpotClosesAsOf`, and the picker-cohort ledger are all bounded by `asOfT`, and the
backtest chain reader is a faithful `+ lte(time, asOfT)` generalization of the live
`readChainForPicker` (identical 10-min lookback union + per-contract DISTINCT ON dedup). The
weights seam is correct (`?? WEIGHT_*` per-criterion; `{}` does NOT zero, explicit `0` is
respected). `computeLegPairMetrics` is a byte-identical extraction. BT-02 leakage oracle and
BT-03 13-trade walk-forward are methodologically sound (BT-03 genuinely prices exit at a
later snapshot instant than entry). The kernel math (seeded LCG, median-split, coverage,
ablation-delta) is correct and honest. No `any`/`as`/`!`; hexagon law respected; the write
surface is INSERT-only (BT-05 holds).

**However, one BLOCKER undercuts the harness's core purpose:** BT-04's hypothetical simulation
prices entry AND exit from the *same* as-of-T chain slice, so its `simulatedPnl` is a
deterministic function of the entry bid-ask spreads with zero forward-price information. Every
downstream BT-04 signal (per-rule directional attribution, ablation `outcomeDelta`, the
`hypothetical-simulated-pnl` CI) is computed on that hollow quantity — the tool would report
rule-validity verdicts that measure entry transaction cost, not predictive edge. This is
exactly the "tool that LIES about rule validity" failure the phase set out to avoid.

## Critical Issues

### CR-01: BT-04 hypothetical `simulatedPnl` prices entry and exit at the same instant — no forward P&L

**File:** `packages/core/src/backtest/application/replayHypotheticalEntry.ts:198-261`
(`simulateCandidateExit`), consumed by `runBacktest.ts:181-240`

**Issue:** `simulateCandidateExit` builds the MarketContext, calls `evaluateExit` ONCE, and
prices the "exit" from the SAME as-of-`cohortObservedAt` chain slice used for entry. There is
no forward time progression and no future chain read (the deps expose only `readChainAsOf`,
called once at `cohort.observedAt` in `replayHypotheticalEntry`). The verdict is used only as
an `indicative` skip-gate — it never changes the P&L or selects a later exit instant.

Because entry and exit use identical quotes, the P&L collapses to a pure function of the entry
spreads. With `entryValue = candidate.debit/100 = haircutFill(back,"buy") − haircutFill(front,"sell")`
(candidate-selection.ts:299) and `exitValue = haircutFill(back,"sell") − haircutFill(front,"buy")`
(line 258), and `FILL_WIDTH_FRACTION = 0.66`:

```
simulatedPnl = (exitValue − entryValue) × 100
             = ([sell−buy]_back + [sell−buy]_front) × 100
             = (1 − 2·0.66) × (width_back + width_front) × 100
             = −0.32 × (width_back + width_front) × 100      ≤ 0, always
```

So every candidate's `simulatedPnl` is `−32%` of its total bid-ask width — deterministic,
sign-fixed, and carrying no information about how the trade would actually have performed.
Two candidates with identical spreads but opposite real outcomes get the identical number.

Blast radius (`runBacktest.ts`): `directionalAttribution` (metric vs `simulatedPnl`, lines
181-191), `ablation.outcomeDelta` (`ablatedTop.simulatedPnl − baselineTop.simulatedPnl`, line
229), and `ci("hypothetical-simulated-pnl", …)` (line 239) are ALL built on this hollow
quantity. The `caveats` block (runBacktest.ts:105-108) discloses only events-leakage and
late-BSM — it does NOT disclose that the hypothetical P&L is an entry-cost artifact, so the
report presents these as forward-performance/rule-validity signals.

The plan required a forward exit: 27-05-PLAN.md line 123 — *"Output is a per-candidate
simulated P&L at the first actionable verdict or front expiry"* — and line 131 *"each
candidate is forward-walked to a simulated P&L."* The implementation does neither. Contrast
`replayExitsForCalendar` (BT-03), which correctly prices exit at `finalRow.time` (a later
snapshot found by the forward walk) vs entry at `openedAt` — that path is sound; only BT-04 is
broken.

**Fix:** Actually forward-walk the hypothetical. Thread a bounded forward chain read (e.g.
iterate `readChainAsOf(t)` over the cohort's subsequent 30-min snapshot instants, or read the
specific front/back contracts' future `leg_observations` up to front expiry), re-price the
leg pair per instant via `computeLegPairMetrics`, run `evaluateExit` with `previousVerdict`
threaded for hysteresis, and take the P&L at the first non-indicative non-HOLD verdict OR at
front expiry — mirroring `replayExitsForCalendar`'s loop. If a forward walk is genuinely out
of scope for this phase, do NOT feed the entry-instant number into attribution/ablation/CI;
instead drop those three BT-04 outputs and add a loud caveat that hypothetical forward P&L is
not yet measured. Shipping the current hollow metric under "attribution/ablation" labels is
the honesty failure the phase exists to prevent.

**Fixed (f164747):** `simulateCandidateForward` now forward-walks the chain daily from T0 to
front expiry, re-pricing the candidate's fixed legs per slot, threading `previousVerdict` for
hysteresis, and exiting at the first actionable verdict (priced from THAT slot) or front
expiry. Entry stays priced at T0. Daily sampling bounds read cost and is disclosed as a report
caveat; candidates with no forward data are marked unreplayable, never fabricated. RED test:
a favorable forward move now yields positive simulated P&L (impossible under same-instant
pricing). Forward-walk exit-selection logic flagged for human verification.

## Warnings

### WR-01: Leakage oracle swallows a closes-read error and can cry wolf on `vrp`

**File:** `packages/core/src/backtest/application/replayPickerCohort.ts:341-342`

**Issue:** `readDailySpotClosesAsOf` failure is silently degraded to `[]`
(`realizedVol20Result = closesResult.ok ? closesResult.value : []`), unlike the chain read one
line above which propagates its error (line 338). With `[]`, `realizedVol20` becomes `null`
and the `vrp` rule scores differently from the stored snapshot — so a *transient DB error on
the closes read* surfaces as a `score-mismatch` (criterion `"vrp"`), i.e. a fabricated
"leakage bug." For an oracle whose entire value is trustworthy mismatch reporting, a false
positive is as corrosive as a missed leak.

**Fix:** Propagate the closes-read error the same way the chain read is propagated
(`if (!closesResult.ok) return closesResult;`), or emit a distinct `inconclusive` mismatch
kind so a storage hiccup is never reported as a score divergence.

**Fixed (3c286f6):** closes-read failure now returns the error (matching the chain read) instead
of degrading to `[]`. RED regression test: a failing closes port returns err, not a fabricated
`vrp` score-mismatch.

### WR-02: BT-03 magnitude tolerance-band check specified by the plan is not implemented

**File:** `packages/core/src/backtest/application/replayExitsForCalendar.ts:157-161`

**Issue:** 27-05-PLAN.md (lines 38, 103) requires BT-03 to *"Compare direction (sign match,
hard) + magnitude (within the chosen tolerance band, documented in a code comment + the report
caveat)."* The implementation computes only `directionMatch` (sign). No magnitude tolerance
band is evaluated and no magnitude caveat is surfaced. `modeledPnl`/`oraclePnl` are carried
per trade so a human *can* eyeball scale, but the automated band check the plan called for is
absent.

**Fix:** Add the documented magnitude band (e.g. `|modeledPnl − oraclePnl| / |oraclePnl|` vs a
named tolerance) to `TradeReproduction` and to the report caveats, or amend the plan/scope if
direction-only was intentionally accepted at UAT.

**Fixed (2b268c8):** implemented the plan's ~3x tolerance band. `TradeReproduction` now carries
`magnitudeMatch` and a `reproduction` verdict (`reproduced` = direction + magnitude within 3x;
`direction-only` = sign agrees, magnitude out of band; `diverged` = sign mismatch). Surfaced in
the report caveats and the CLI summary distinctly. RED tests for reproduced / direction-only /
diverged first.

### WR-03: Coverage `isGap` conflates true data gaps with empty candidate universes

**File:** `packages/core/src/backtest/application/runBacktest.ts:160`

**Issue:** `isGap: baselineResult.value.length === 0` treats ANY cohort that produced zero
hypothetical outcomes as a data gap. But `replayHypotheticalEntry` returns `ok([])` not only
for a true gap (empty chain / spot=0, lines 294, and per-candidate skips) but also for a cohort
with real data where every candidate was gate-dropped by `selectCandidates` or skipped by the
leg-freshness/NaN guard. Those real-but-empty cohorts get excluded from the coverage
`replayed` numerator, overstating the gap rate — the opposite of the honest "thin real-data
footprint" signal coverage is meant to give.

**Fix:** Derive `isGap` from the chain read itself (e.g. distinguish `chain.length === 0` /
all-spot-0 from "chain present but no surviving candidates"), so an empty universe over real
data is not mislabeled a data gap.

**Fixed (d66b675):** `replayHypotheticalEntry` now classifies each cohort as `gap` (empty/all-spot-0
chain), `empty-universe` (real data, zero surviving candidates), or `replayed`. Coverage tallies
gap vs empty-universe distinctly (`gapCohorts` / `emptyUniverseCohorts`), per day and overall,
surfaced in the report and CLI. RED coverage tests first.

## Info

### IN-01: Redundant zero-equality clause in `directionMatch`

**File:** `packages/core/src/backtest/application/replayExitsForCalendar.ts:158-159`

**Issue:** `Math.sign(modeledPnl) === Math.sign(oraclePnl) || (modeledPnl === 0 && oraclePnl === 0)`
— the `||` clause is dead: when both are 0, `Math.sign(0) === Math.sign(0)` is already true.
Harmless but misleading.

**Fix:** Drop the second clause.

**Fixed (bce4b22):** dropped the dead `|| (modeledPnl === 0 && oraclePnl === 0)` clause.

### IN-02: Migration 0021 enables RLS with no policy

**File:** `packages/adapters/src/postgres/migrations/0021_backtest_runs.sql:8`

**Issue:** `ENABLE ROW LEVEL SECURITY` with no accompanying `CREATE POLICY` denies all access
to non-owner / non-BYPASSRLS roles. The backtest CLI connects via `DATABASE_URL` directly
(likely the owner/service role, which bypasses RLS), and this matches the repo's existing
drizzle-generated convention, so it is not a live break — but it is worth confirming the CLI's
role bypasses RLS before relying on the INSERT in any non-owner context.

**Fix:** None required if the CLI role owns the table / has BYPASSRLS (verify once); otherwise
add an explicit policy.

**Fixed (docs):** verified — no `CREATE POLICY` exists anywhere in the repo; every migration
enables RLS with no policy (drizzle convention), and the backtest-runs contract test inserts
successfully as the table owner. Documented in `docs/architecture/backtest-harness.md`: the
operator role connects via `DATABASE_URL` as owner/service (bypasses RLS); a restricted role
would need an explicit policy. No code change required.

---

_Reviewed: 2026-07-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
