---
phase: 18-analyzer-picker-ui-redesign
reviewed: 2026-07-04T15:27:14Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - apps/web/src/components/charts/PayoffChart.tsx
  - apps/web/src/components/charts/PayoffChart.test.tsx
  - apps/web/src/components/picker/CandidateCard.tsx
  - apps/web/src/components/picker/CandidateCard.test.tsx
  - apps/web/src/components/picker/ScenarioStrip.tsx
  - apps/web/src/components/picker/EntryExitPlan.tsx
  - apps/web/src/components/picker/EntryExitPlan.test.tsx
  - apps/web/src/components/picker/TermStructureChart.tsx
  - apps/web/src/components/picker/TermStructureChart.test.tsx
  - apps/web/src/components/picker/WhyPanel.tsx
  - apps/web/src/components/picker/WhyPanel.test.tsx
  - apps/web/src/lib/candidate-to-position.ts
  - apps/web/src/lib/candidate-to-position.test.ts
  - apps/web/src/lib/scenario-engine.ts
  - apps/web/src/lib/scenario-engine.test.ts
  - apps/web/src/screens/Analyzer.tsx
  - apps/web/src/screens/Analyzer.test.tsx
  - packages/contracts/src/picker.ts
  - packages/contracts/src/picker.test.ts
  - packages/contracts/src/__fixtures__/picker-candidates.fixture.ts
  - packages/contracts/src/index.ts
findings:
  critical: 0
  warning: 5
  info: 5
  total: 10
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-07-04T15:27:14Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Reviewed the Analyzer→Picker redesign: the `picker.ts` contract + frozen fixture, the
`scenario-engine`/`candidate-to-position` pricing libs, the five picker components, the
shared `PayoffChart`, and the `Analyzer` screen. Type-safety discipline is clean — no
`any`/`as`/`!` violations, no floating promises, no debug artifacts, no forbidden
`console` usage. The guard-case (fwdIv null) branch is threaded consistently through the
contract, fixture, and every component's render path.

No BLOCKER-severity defect ships in the Phase-18 fixture-only path. However, five
WARNING-level issues are provable:

1. The D-02 non-convergence exclusion is applied to the P&L curves but **not** to the
   greek strips / per-position greeks in the same shared engine — a real NaN gap for the
   Overview screen that shares this code.
2. The guard candidate's `guard` tag in `TermStructureChart` renders **off the top of the
   SVG viewport** (clipped) for exactly the guard case it exists to flag — and that guard
   candidate is in the frozen fixture that ships now.
3. The picker contract has **no snapshot reference/asOf date**, yet `TermStructureChart`
   needs one to place absolute event dates on the relative-DTE axis — it hardcodes
   `2026-07-02`, which silently breaks the documented Phase-19 "import-only swap, zero
   shape change" promise.
4. One "combined-curve" test in `PayoffChart.test.tsx` is vacuous (green-suite pattern):
   it would pass even if `computeYDomain` stopped scanning the today curve.
5. `WhyPanel`'s `theta/vega` division is unguarded despite the panel's own stated
   "never NaN" contract.

## Warnings

### WR-01: D-02 non-convergence exclusion is missing from the greek strips (NaN gap)

**File:** `apps/web/src/lib/scenario-engine.ts:329-330, 419, 441`
**Issue:** The P&L paths (`bookPL`, `bookPLAtExpiry`) correctly drop non-convergent legs
via `includedForT0`/`includedForExpiry` (which call `isIvExcludedFromT0`). But
`bookGreekAt` filters on `pos.included` **only** (line 330), and `positionGreeksAt` is fed
`includedPositions = positions.filter((p) => p.included)` (line 419) — neither applies the
IV-exclusion. In production a non-convergent leg carries `frontIv = 0`
(`Overview.resolveLeg`, per the file's own CR-01 comment). `bsmGreeks(S, K, frontT, 0, …)`
divides by `sigma*sqrt(T) = 0` → `d1 = ±Infinity`/`NaN`, so `bookGreekStrips.delta/gamma/
theta/vega` and `positionGreeks` contain `NaN` for exactly the "IV n/a" positions the P&L
path just guarded. The picker never triggers this (candidate positions omit
`frontIvStatus`, treated as "ok"), but this is shared code the Overview screen consumes —
the D-02 fix is only half-applied.
**Fix:** Apply the same exclusion predicate to the greek producers:
```ts
// bookGreekAt:
for (const pos of positions) {
  if (!includedForT0(pos)) continue; // was: if (!pos.included) continue;
  ...
}
// repriceScenario:
const greekIncluded = positions.filter(includedForT0);
const positionGreeks = greekIncluded.map((pos) => positionGreeksAt(pos, ...));
```

### WR-02: Guard tag renders off-canvas (clipped) for the guard candidate

**File:** `apps/web/src/components/picker/TermStructureChart.tsx:84, 193-214`
**Issue:** `guardTagY = Math.min(frontY, backY) - 18`. The fixture's guard candidate
(`7450-guard-inverted`) has `frontLeg.iv = 0.155`, which is exactly `IV_MAX`, so
`yScale(0.155) = PAD.top = 10`. Then `guardTagY = min(10, 90) - 18 = -8`. The guard
`<rect>` spans y −8…2 and the `guard` `<text>` sits at y ≈ −0.5 — above the `viewBox="0 0
310 150"` top edge, where the default SVG viewport clipping hides it. The one visual cue
the guard branch exists to render is invisible for the guard candidate that ships in the
frozen fixture. The test (`TermStructureChart.test.tsx:70-77`) only asserts the element
exists in the DOM, not that it is on-canvas, so it passes while the user sees nothing.
**Fix:** Clamp the tag into the drawable band, e.g.
`const guardTagY = Math.max(PAD.top, Math.min(frontY, backY) - 18);` (or place it below the
higher dot when the higher dot is within ~18px of the top).

### WR-03: Contract lacks a snapshot reference date; event-marker placement is hardcoded

**File:** `packages/contracts/src/picker.ts:150-156`, `apps/web/src/components/picker/TermStructureChart.tsx:46, 56-61`
**Issue:** `pickerSnapshotResponse` carries `spot/termStructure/gex/events/candidates` but
**no `asOf`/reference date**. `termStructure` points and leg dots are DTE-relative, while
`events` carry absolute ISO dates (`pickerEvent.date`). To place events on the DTE x-axis
the component must know the snapshot's reference date, so it hardcodes
`FIXTURE_REFERENCE_DATE_MS = Date.UTC(2026, 6, 2)`. This is correct only for the frozen
Phase-18 fixture. `picker.ts`'s own header and the fixture header both promise the Phase-19
live response is "an import-only swap with zero shape change" — but a live snapshot taken on
any other date will have its event markers mis-placed (shifted by whole days) because the
schema gives the component no way to learn the real reference date. The contract is
incomplete for its stated Phase-19 role.
**Fix:** Add a reference date to the contract and drive the component from it:
```ts
export const pickerSnapshotResponse = z.object({
  asOf: z.string(),         // ISO 8601 snapshot date the DTE fields are relative to
  spot: z.number(),
  ...
});
```
Then in `TermStructureChart`, derive the reference from `asOf` instead of the module
constant. Update the frozen fixture with `asOf: "2026-07-02"`.

### WR-04: `computeYDomain` "combined-curve" test is vacuous (green-suite)

**File:** `apps/web/src/components/charts/PayoffChart.test.tsx:280-307`
**Issue:** The test is named "combines both curves so a near-flat today curve is not
squashed…" but every assertion is satisfiable by the exp curve alone. `tallExp` spans
±10,000 while `nearFlatToday` spans ±5, so `lo ≤ -10_000` / `hi ≥ 10_000` and the
`expOnly` comparison all hold whether or not `computeYDomain` scans `todayCurve` at all. If
someone regressed `computeYDomain` to ignore its first argument, this test would still
pass — it does not guard the behavior it claims to. The project has been bitten by this
green-suite pattern repeatedly.
**Fix:** Make the today curve carry the *more extreme* value so its inclusion is required:
```ts
const tallToday: PayoffPoint[] = [{ spot: 6900, pl: -20_000 }, { spot: 7400, pl: 0 }, { spot: 7900, pl: 20_000 }];
const smallExp: PayoffPoint[]  = [{ spot: 6900, pl: -100 },    { spot: 7400, pl: 0 }, { spot: 7900, pl: 100 }];
const { lo, hi } = computeYDomain(tallToday, smallExp);
expect(lo).toBeLessThanOrEqual(-20_000); // only passes if today IS scanned
expect(hi).toBeGreaterThanOrEqual(20_000);
```

### WR-05: `WhyPanel` theta/vega division is unguarded, contradicting its no-NaN contract

**File:** `apps/web/src/components/picker/WhyPanel.tsx:136`
**Issue:** `value={(candidate.theta / candidate.vega).toFixed(3)}`. `pickerCandidate.vega`
is `z.number()` — `0` is a valid value. When `vega === 0` this renders `"Infinity"` (or
`"NaN"` if theta is also 0). The component's own docstring and the guard handling for
`fwdIv`/`theta` promise "guard-safe … never a fabricated number", so this division is an
inconsistent gap. No fixture candidate triggers it today, but the contract permits it.
**Fix:** Guard the ratio, e.g.
`value={candidate.vega === 0 ? "—" : (candidate.theta / candidate.vega).toFixed(3)}`.

## Info

### IN-01: Negative debit renders as `$-803` in the candidate card sub-line

**File:** `apps/web/src/components/picker/CandidateCard.tsx:85`
**Issue:** `debit $${candidate.debit.toFixed(0)}` produces `debit $-803` for the guard
candidate (debit −802.82), placing the minus after the dollar sign. `EntryExitPlan.tsx`
already formats this correctly as `−$803` via a dedicated helper. The `+` on
`θ +${candidate.theta.toFixed(1)}` is likewise hardcoded (fine only while the engine's
`theta > 0` constraint holds).
**Fix:** Reuse a signed-USD helper (like `EntryExitPlan`'s `debitUsd`) for the debit token.

### IN-02: Dead ternary in the kernel-parity test

**File:** `apps/web/src/lib/scenario-engine.test.ts:131`
**Issue:** `bsmGreeks(SPOT, LIVE_POS.occSymbol ? 7425 : 7425, backT, IV, R, Q, "P")` — both
branches of the ternary evaluate to `7425`, so the condition is inert and confusing.
**Fix:** Replace with the literal `7425`.

### IN-03: Stale trailing comment claims un-imported visx APIs

**File:** `apps/web/src/components/charts/PayoffChart.tsx:956-957`
**Issue:** The closing comment says "AreaClosed/AreaStack imported for potential future
gradient-fill usage … referenced in the import list above" — but neither `AreaClosed` nor
`AreaStack` appears in the import list (only `LinePath`, `curveMonotoneX`, `scaleLinear`,
`LinearGradient`, `Group`, `localPoint`). The comment is incorrect and misleading.
**Fix:** Delete the stale comment.

### IN-04: Unreachable level cap in `buildScenarioStrip`

**File:** `apps/web/src/lib/scenario-engine.ts:568-570`
**Issue:** `.slice(0, SCENARIO_STRIP_MAX_LEVELS)` (8) can never drop anything:
`baseLevels` is at most 4 (putWall/flip/spot/callWall) and `keptPositionStrikes` is capped
at `SCENARIO_STRIP_MAX_POSITION_STRIKES` (4), so the merged array is ≤ 8 by construction.
Dead defensive code.
**Fix:** Either drop the slice or add a comment noting it is a belt-and-suspenders guard.

### IN-05: max-loss invariant tolerance is >50% of the typical debit

**File:** `apps/web/src/lib/candidate-to-position.test.ts:66, 179, 188, 211`
**Issue:** `TOLERANCE = 2500` against fixture debits of ~$4,600 means the "worst case ≥
-debit" invariant only asserts `worstCase ≥ -7,100` — a >50% slack band. The comment
justifies it empirically (worst observed gap ~$2,087), but the guard is loose enough that a
sizeable adapter mis-mapping could slip under it.
**Fix:** Consider narrowing the evaluation grid used for this invariant to the near-the-
money region the candidates actually occupy, which would let the tolerance shrink toward
the true BSM discount gap and tighten the check.

---

_Reviewed: 2026-07-04T15:27:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
