---
phase: 17-overview-v2-redesign-iv-calibration-fix
reviewed: 2026-07-03T23:05:12Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - apps/web/src/lib/iv-calibration.ts
  - apps/web/src/lib/scenario-engine.ts
  - apps/web/src/components/charts/PayoffChart.tsx
  - apps/web/src/screens/Overview.tsx
  - apps/web/src/screens/Market.tsx
  - apps/web/src/lib/iv-calibration.test.ts
  - apps/web/src/lib/scenario-engine.test.ts
  - apps/web/src/components/charts/PayoffChart.test.tsx
  - apps/web/src/screens/Overview.test.tsx
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: partially_resolved
resolved: [CR-01, WR-01]
resolution_commit: e4a0efe
open: [WR-02, WR-03, WR-04, WR-05, IN-01, IN-02, IN-03, IN-04]
---

# Phase 17: Code Review Report

> **Resolution (commit `e4a0efe`):** CR-01 (wrong @exp P&L on IV-n/a rows) and WR-01
> (masking fixture) are FIXED — `includedForExpiry` now excludes any leg-non-convergent
> position, and the regression fixtures model the production `frontIv/backIv=0` state.
> A failing regression test (an ~$18.2k book-P&L error) drove the fix red→green.
> WR-02 through WR-05 and IN-01..04 remain OPEN (tracked follow-ups; none on the Overview
> surface, none blocking human verification).

**Reviewed:** 2026-07-03T23:05:12Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 17 wires per-leg calibrated IV into the Overview payoff hero. The convergence-tagging
contract in `resolveLegIv` is clean (no-price vs non-convergent distinct; never DEFAULT_IV,
never last iterate; division guards correct), and the T+0 leg-level exclusion is correct.
`buildScenarioStrip` dedupe/sort/cap-at-8 is correct.

The serious defect is in the **@exp path for a front-leg-non-convergent calendar**. The spec
correctly reasons that the *net price at expiry* needs no front IV (front is intrinsic at
`frontT=0`), but the **entry cost basis** (`entryNetPrice`) re-prices the front leg at T+0
where IV *is* required. In production a non-convergent leg carries `frontIv = 0` (set in
`Overview.resolveLeg`), so the entry front leg is priced as forward-intrinsic — collapsing the
short-front time value that is the calendar's whole P&L engine. The displayed "@exp shown"
number (which the UI tooltip explicitly promises) is therefore wrong for exactly the positions
badged "IV n/a". The scenario-engine unit tests miss this because their
`FRONT_NON_CONVERGENT_POS` fixture keeps `frontIv: 0.145` instead of modeling the `0` the
production wiring actually produces — the same green-suite-hides-prod-bug pattern flagged twice
before in this project.

## Critical Issues

### CR-01: @exp P&L for a front-non-convergent calendar uses `frontIv=0` in the entry basis → wrong displayed number

**File:** `apps/web/src/lib/scenario-engine.ts:204-211,295-310` (root cause `apps/web/src/screens/Overview.tsx:114`)

**Issue:** When a front leg's IV does not converge, `Overview.resolveLeg` returns `{ iv: 0, status: "non-convergent" }` (Overview.tsx:114), and `buildCalendarPosition` sets `frontIv: 0`. Such a position is (correctly) excluded from T+0 but (per D-02) still included in `bookPLAtExpiry` because `includedForExpiry` only drops back-non-convergent legs.

`bookPLAtExpiry` computes `net − entry`:
- `net = calendarNetPrice(pos, S, pos.frontDte, 0, …)` → `frontT = max((frontDte − frontDte)/365, 0) = 0` → front priced at intrinsic via `bsmPrice`'s `T<=0` branch. Front IV genuinely irrelevant here. Correct.
- `entry = entryNetPrice(pos, liveSpot, …) = calendarNetPrice(pos, liveSpot, 0, 0, …)` → `frontT = frontDte/365 > 0` → `bsmPrice(S, K, frontT, sigma=0, …)`. **With `sigma=0`, `bsmPrice` returns forward-intrinsic** (verified in `packages/quant/src/bsm.ts:96` — `d1` saturates to ±∞, `ncdf` → 0/1), i.e. the front leg's real entry time value is dropped.

Net effect: the front leg is treated as intrinsic-only in the entry too, so the short-front premium/time-value never enters the P&L. The `@exp` curve shown for an "IV n/a" row is materially wrong (typically understated), while the row tooltip states "@exp shown; excluded from T+0." This is an incorrect financial number on a financial surface, presented as trustworthy.

Note also that when `S === K` (ATM front) and `rate === divYield`, the `sigma=0` entry price degenerates to `0/0 = NaN`, poisoning that position's entire @exp curve.

**Fix:** A front-non-convergent leg has no trustworthy entry basis, so it should be excluded from @exp as well — or the entry basis must come from the broker's real average price rather than a re-derived BSM front price. Simplest correct option:

```ts
// scenario-engine.ts
function includedForExpiry(pos: AnalyzerPosition): boolean {
  // Both legs must have a usable IV to form the entry basis at T+0 (the front leg's
  // entry is re-priced at frontT>0, which needs its IV even though the @exp net does not).
  return (
    pos.included &&
    pos.frontIvStatus !== "non-convergent" &&
    pos.backIvStatus !== "non-convergent"
  );
}
```

If the product genuinely wants the @exp tent to survive a front non-convergence, then `entryNetPrice` must be fed a real cost basis (broker `averagePrice`), not a `frontIv=0` BSM re-price. Either way, add a regression test whose front-non-convergent fixture uses `frontIv: 0` (the production value) and asserts the @exp curve is either excluded or equals the real-cost-basis P&L.

## Warnings

### WR-01: Scenario-engine non-convergence fixtures don't model the production `iv=0`, masking CR-01

**File:** `apps/web/src/lib/scenario-engine.test.ts:66-80`

**Issue:** `FRONT_NON_CONVERGENT_POS` / `BACK_NON_CONVERGENT_POS` spread `LIVE_POS` and set only `frontIvStatus`/`backIvStatus`, keeping `frontIv: 0.145` / `backIv: 0.145`. But the only production caller (`Overview.resolveLeg`, Overview.tsx:114) sets `iv: 0` whenever `status: "non-convergent"`. The test at lines 281-307 therefore validates a code path (`frontIvStatus="non-convergent"` **with a valid 0.145 IV**) that can never occur in production, and reports the @exp curve as correct while CR-01 makes it wrong. This is the reused-fixture / green-suite-hides-prod-bug failure mode called out for this project.

**Fix:** Make the non-convergent fixtures carry `frontIv: 0` (and `backIv: 0` for the back case) to mirror `resolveLeg`, then re-derive the expected @exp assertions. The current "front still contributes to @exp" assertion should become "front-non-convergent is excluded from @exp" (or an exact real-cost-basis value) once CR-01 is fixed.

### WR-02: `bookGreekAt` / `positionGreeksAt` include `iv=0` non-convergent positions → `NaN` gamma in the greek strips

**File:** `apps/web/src/lib/scenario-engine.ts:333-334,361-378`

**Issue:** Unlike `bookPL`/`bookPLAtExpiry`, the greek functions gate only on `pos.included`, not on IV convergence. A non-convergent position (`frontIv`/`backIv = 0` in production) is fed to `bsmGreeks` with `sigma=0`, which yields `gamma = eqT·nd1/(S·0·sqT) = 0/0 = NaN` (verified `packages/quant/src/bsm.ts:133`). `repriceScenario.bookGreekStrips` / `positionGreeks` then contain `NaN`. These outputs are not consumed on the Overview surface today (Overview uses `netGreeksForLegs` on DEFAULT_IV), so no visible break here — but they are part of the public `ScenarioResult` used by the Analyzer, so this is a latent NaN.

**Fix:** Apply the same leg-level exclusion used for pricing, e.g. skip `isIvExcludedFromT0(pos)` positions in `bookGreekAt`, and skip / null out greeks for non-convergent positions in `positionGreeksAt`.

### WR-03: `PayoffChart` performs side effects inside `useMemo` (state set + parent callback during render)

**File:** `apps/web/src/components/charts/PayoffChart.tsx:214-227`

**Issue:** Two `useMemo` blocks are used purely for side effects, not memoized values:
- Lines 214-219 call `setYDomain`/`setYDomainSig` during render. This "works" only because it self-terminates after one extra render, but it is the classic setState-in-render anti-pattern.
- Lines 222-227 call `onFitYConsumed()` (a parent setter) from inside `useMemo`. Invoking a parent state update during a child's render phase triggers React's "Cannot update a component while rendering a different component" error and can loop. It is dormant on Overview only because `fitY` is hard-coded `false` (Overview.tsx:895); any real "fit Y" wiring will surface it.

**Fix:** Move both to `useEffect` (they are effects, keyed on `positionSetSignature` / `fitY` / `baseExpirationCurve`), or derive `yDomain` during render without storing it in state. Never call `onFitYConsumed()` from `useMemo`.

### WR-04: Tautological / non-exercising assertions in the kernel-parity test

**File:** `apps/web/src/lib/scenario-engine.test.ts:162-163`

**Issue:** `expect(directGreeks.delta).toBeCloseTo(directGreeks.delta, 10)` asserts a value equals itself — it can never fail. `expect(typeof pgResult).toBe("object")` is trivially true for any `Result`. The test's stated purpose (D-01 parity between `repriceScenario` and `computePositionGreeks`) is therefore not actually verified — `pgResult`'s numeric greeks are never compared to anything. The meaningful `toBeCloseTo(expectedDelta, 4)` assertions (141-144) do exercise the engine-vs-direct path, but the `computePositionGreeks` half of the claimed parity is untested.

**Fix:** Compare `pgResult.value.greeks` (on the `ok` branch, using a real `longQty`) against the direct `bsmGreeks` values, or delete the dead assertions and the misleading claim in the test name/comment.

### WR-05: Calibrated IV solved at `T = Δ/365.25` is applied by the display engine at `T = DTE/365`

**File:** `apps/web/src/lib/iv-calibration.ts:81,96` vs `apps/web/src/lib/scenario-engine.ts:189-191`

**Issue:** `resolveLegIv` calibrates `sigma` such that `bsmPrice(S,K,T₁,sigma)=mark` with `T₁ = (expiry−now)/MS_PER_YEAR` on a **365.25-day** basis using the exact expiry timestamp. `scenario-engine` then re-prices with `T₂ = (DTE−daysForward)/365` on a **365-day** basis using the integer DTE from `pairPositionsIntoCalendars`. The calibrated IV is only exact at `T₁`; applied at `T₂` the reconstructed T+0 price will not reproduce `mark`, weakening the D-01 "same-calendar cross-screen consistency" guarantee. The error is small (365 vs 365.25 plus up-to-one-day DTE rounding) but systematic on a surface whose stated purpose is consistency.

**Fix:** Use one day-count convention end to end — either calibrate on `DTE/365` (the display basis) or reprice on the exact-timestamp/365.25 basis. Prefer feeding the scenario engine the same `T` used for calibration rather than integer DTE.

## Info

### IN-01: Meaningless ternary in test

**File:** `apps/web/src/lib/scenario-engine.test.ts:123`

**Issue:** `bsmGreeks(SPOT, LIVE_POS.occSymbol ? 7425 : 7425, …)` — both branches are `7425`; the condition does nothing.

**Fix:** Replace with the literal `7425`.

### IN-02: Misleading comment claims visx imports that don't exist

**File:** `apps/web/src/components/charts/PayoffChart.tsx:818-819`

**Issue:** The trailing comment says "AreaClosed/AreaStack imported for potential future gradient-fill usage… (referenced in the import list above)", but only `LinePath` is imported from `@visx/shape` (line 25). The comment describes imports that aren't present.

**Fix:** Delete the stale comment.

### IN-03: Heatmap-cell construction duplicated

**File:** `apps/web/src/lib/scenario-engine.ts:462-479` and `548-573`

**Issue:** The `centerSpot`/`hmSpots`/cell-loop block appears twice — once in `repriceScenario` with a hard-coded `hmStep = 50`, once in `buildHeatmapCells` with a `step` parameter. Divergence risk if one is changed.

**Fix:** Have `repriceScenario` call `buildHeatmapCells(positions, params, 50)` instead of re-implementing the loop.

### IN-04: Magic-number fallback for `minFrontDte`

**File:** `apps/web/src/lib/scenario-engine.ts:426`

**Issue:** `const minFrontDte = includedPositions.length > 0 ? Math.min(...) : 45;` — the `45` fallback (used to bound the fan curves when the book is empty) is an unexplained literal.

**Fix:** Extract a named constant with a one-line rationale, or return no fan curves when the book is empty.

---

_Reviewed: 2026-07-03T23:05:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
