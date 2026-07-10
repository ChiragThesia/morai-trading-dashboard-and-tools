---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - apps/server/src/adapters/http/picker.routes.test.ts
  - apps/server/src/adapters/http/picker.routes.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.test.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/config.ts
  - apps/server/src/main.ts
  - apps/web/src/components/charts/PayoffChart.test.tsx
  - apps/web/src/components/charts/PayoffChart.tsx
  - apps/web/src/components/picker/CandidateCard.test.tsx
  - apps/web/src/components/picker/CandidateCard.tsx
  - apps/web/src/hooks/useAnalyzeCalendar.test.ts
  - apps/web/src/hooks/useAnalyzeCalendar.ts
  - apps/web/src/lib/payoff-domain.test.ts
  - apps/web/src/lib/payoff-domain.ts
  - apps/web/src/lib/scenario-engine.test.ts
  - apps/web/src/lib/scenario-engine.ts
  - apps/web/src/lib/tos-parser.test.ts
  - apps/web/src/lib/tos-parser.ts
  - apps/web/src/screens/Analyzer.test.tsx
  - apps/web/src/screens/Analyzer.tsx
  - apps/web/src/screens/Overview.test.tsx
  - apps/web/src/screens/Overview.tsx
  - packages/contracts/src/index.ts
  - packages/contracts/src/picker.test.ts
  - packages/contracts/src/picker.ts
  - packages/core/src/index.ts
  - packages/core/src/picker/application/analyzeAdHocCalendar.test.ts
  - packages/core/src/picker/application/analyzeAdHocCalendar.ts
  - packages/core/src/picker/application/computePickerSnapshot.ts
  - packages/core/src/picker/application/ports.ts
  - packages/core/src/picker/domain/candidate-selection.test.ts
  - packages/core/src/picker/domain/candidate-selection.ts
  - packages/core/src/picker/index.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 30 (+ 4 additional files read to trace call chains: `apps/web/src/lib/candidate-to-position.ts`, `apps/web/src/screens/Overview.tsx`'s `resolveLeg`, `packages/core/src/picker/domain/scoring.ts`, `packages/shared/src/assert.ts`)
**Status:** issues_found

## Summary

Reviewed the Phase 30 diff: the dynamic payoff-domain fitter (`computePayoffDomain`), its threading into `PayoffChart`/`scenario-engine`, and the new ad-hoc pasted-calendar scoring path (`makeAnalyzeAdHocCalendarUseCase` + `POST /picker/analyze` + the MCP tool + the `analyzeAdHocCalendarRequest`/`Response` contracts).

The domain-fitting work (D-01) is solid: `computePayoffDomain` correctly reuses `findZeroCrossings`/`repriceScenario` (no second breakeven detector), `includedForT0` is shared between the domain anchor selection and the curve predicates (the CR-01 regression this phase explicitly guards against), and `PayoffChart`'s xScale/ticks/pinMarker/crosshair all derive from the single `domain` prop with no leftover 6900/7900 literals in the render path. However, the domain-collapse edge case when every position is excluded from `T+0` (all legs non-convergent, or every book row's checkbox unchecked) while the position list is non-empty is unguarded and untested — see WARNING WR-01.

The ad-hoc analyze use-case (D-02) correctly reuses `scoreCalendarCandidates` verbatim, keeps gate/sizing/spot/asOf pinned to the latest snapshot (T-28-10), and degrades cleanly to `{scored:false}` rather than throwing. But the request's `frontExpiry`/`backExpiry` fields are unvalidated free-form strings with no consistency check against the client-supplied `frontDte`/`backDte` — a genuine trust-boundary gap given the endpoint is a new, directly-reachable (Zod-strict-body-required) surface. See BLOCKER CR-01.

## Structural Findings (fallow)

None provided for this phase.

## Narrative Findings (AI reviewer)

### CR-01: `analyzeAdHocCalendarRequest` accepts unvalidated/inconsistent date strings, letting user input reach an `assertDefined()` throw and silently desync the scored greeks from the exit plan

**File:** `packages/contracts/src/picker.ts:346-349` (schema), `packages/core/src/picker/application/analyzeAdHocCalendar.ts:117-158` (use-case), `packages/core/src/picker/domain/candidate-selection.ts:140-148,177-193` (`isoDayNumber`/`resolveEventExit`), `packages/core/src/picker/domain/scoring.ts:262` (`closeByExpiry`)

**Issue:** `analyzeAdHocCalendarRequest` validates `frontExpiry`/`backExpiry` as bare `z.string()` — no `.regex(/^\d{4}-\d{2}-\d{2}$/)`, no cross-field check against `frontDte`/`backDte` (only `backDte > frontDte` is refined). Two consequences:

1. **Uncaught throw at the trust boundary.** `makeAnalyzeAdHocCalendarUseCase` passes `input.frontExpiry` straight into `resolveEventExit(fe, events)` (`analyzeAdHocCalendar.ts:135`), which calls `isoDayNumber(frontExpiryIso)` (`candidate-selection.ts:140-148`). `isoDayNumber` does `assertDefined(match, ...)` on the result of a `YYYY-MM-DD` regex match — for any non-conforming string (e.g. `"not-a-date"`, `""`, or a valid-looking but malformed date) this **throws**, not returns a `Result`. Neither the HTTP route (`picker.routes.ts:64-80`) nor the MCP tool (`tools.ts:657-684`) wraps the use-case call in a try/catch, so this bypasses the documented flat-error contract (T-19-16/T-30-16: "errors mapped to flat `{error:"internal"}` — no DB internals") and instead surfaces as an unhandled exception (Hono's default handler / the MCP SDK's own catch, whichever fires first) — inconsistent with every other error path in this file, which is explicitly `Result`-typed end to end. `assertDefined` is documented (`typescript.md`) as the replacement for non-null assertions on **invariants**, not as external-input validation — using it here on unvalidated client input is a misuse of the pattern.
2. **Silent internal desync.** `tf = input.frontDte` / `tb = input.backDte` (`analyzeAdHocCalendar.ts:118-119`) drive every priced value (theta/vega/delta/slope via `bsmGreeks`), while `scoring.ts:262`'s `closeByExpiry = candidate.exitBeforeIso ?? candidate.frontLeg.expiration` derives the exit plan from `input.frontExpiry` directly. Nothing enforces that `frontDte` actually equals `daysBetween(asOfIso, frontExpiry)` (contrast with `selectCandidates`, which always derives `tf` from `asOfIso`/`fe` together — `candidate-selection.ts:352`). A caller (a future client, a buggy MCP integration, or a crafted request) can submit a `frontDte`/`frontExpiry` pair that disagree, producing a scored candidate whose greeks correspond to one date and whose `exitPlan.closeByExpiry` corresponds to a different one — an internally inconsistent, money-facing output. The current UI (`parseTosOrder`) always derives both from the same parsed date, so the normal paste flow never triggers this, but the server contract does not enforce it, and neither `picker.routes.test.ts`, `analyzeAdHocCalendar.test.ts`, nor `picker.test.ts` (contracts) has a test with mismatched or malformed dates.

**Fix:**
```ts
// packages/contracts/src/picker.ts
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const analyzeAdHocCalendarRequest = z
  .object({
    putCall: z.literal("P"),
    strike: z.number().finite().positive(),
    frontDte: z.number().int().positive(),
    backDte: z.number().int().positive(),
    qty: z.number().int().positive(),
    frontIv: z.number().finite().positive(),
    backIv: z.number().finite().positive(),
    debit: z.number().finite(),
    frontExpiry: isoDate,
    backExpiry: isoDate,
  })
  .strict()
  .refine((v) => v.backDte > v.frontDte, { path: ["backDte"], message: "backDte must be greater than frontDte" });
  // Optionally also refine frontDte/backDte against daysBetween(asOfIso, expiry) once the
  // use-case has resolved asOfIso — or simply derive tf/tb from the expiry+snapshot.asOf
  // server-side instead of trusting the client-supplied dte at all (mirrors selectCandidates).
```
At minimum, add the date-format regex so malformed input 400s at the Zod boundary instead of reaching `assertDefined`, and add a regression test asserting `POST /picker/analyze` with a non-ISO `frontExpiry` returns 400, not 500/throw.

---

## Warnings

### WR-01: `computePayoffDomain` collapses to a zero-width `{min: spot, max: spot}` domain when every position is excluded from T+0 but the position list is non-empty — untested, feeds a degenerate scale into `PayoffChart`

**File:** `apps/web/src/lib/payoff-domain.ts:40-67`, `apps/web/src/components/charts/PayoffChart.tsx:147-149,305,318,362`

**Issue:** `computePayoffDomain` only special-cases the truly-empty book (`positions.length === 0` → `spot ± FALLBACK_HALF_WIDTH`, line 40-42). It does **not** special-case the case where `positions.length > 0` but `contributing = positions.filter(includedForT0)` is empty — which happens whenever every position is either user-excluded (`Overview.tsx`'s per-row checkbox, `excludedCalendars`) or IV-non-convergent on both legs (`Overview.resolveLeg` genuinely returns `"non-convergent"` at cold start / outside RTH, per its own doc comment). In that case:
- `baseAnchors = [spot]` (line 49), so `baseLo === baseHi === spot`.
- The wide-pass reprice (line 56) still only prices `positions` through `bookPL`/`bookPLAtExpiry`, both of which apply the same `includedForT0`/`includedForExpiry` filter — so with everything excluded, `wide.payoffCurve`/`wide.expirationCurve` are flat at `pl = 0` for every spot, and `findZeroCrossings` finds no sign change (a flat 0-line never satisfies `a<0&&b>=0` or `a>=0&&b<0`), so `breakevens = []`.
- Final `anchors = [spot]`, `lo === hi === spot`, `pad = 0` → the function returns `{min: spot, max: spot}`.

That degenerate domain is then passed straight to `PayoffChart`'s `buildXScale` (`domain: [spot, spot]`, `PayoffChart.tsx:147-149`) — a d3 `scaleLinear` with a zero-width domain divides by `(domain[1]-domain[0]) === 0`, producing `NaN` for both `xScale(spot)` (used for `spotX`, the blue spot line/dot) and `xScale.invert(...)` (used in `handlePointerMove`, line 362) — the chart silently renders a broken/empty plot instead of the documented fallback behavior. This is directly in the invariant this phase is reviewed against ("excluded/non-convergent positions filtered from domain anchors") but only the "some excluded, not all" case is covered.

`Overview.test.tsx`'s only related test (`"CR-01 regression: a non-convergent calendar contributes nothing to EITHER curve even with its checkbox left checked"`, line 652) exercises exactly one of two calendars non-convergent, never all of them; `payoff-domain.test.ts` never exercises `contributing.length === 0` with `positions.length > 0`.

**Fix:**
```ts
// apps/web/src/lib/payoff-domain.ts
export function computePayoffDomain(
  positions: ReadonlyArray<AnalyzerPosition>,
  spot: number,
  params: ScenarioParams,
): SpotDomain {
  const contributing = positions.filter(includedForT0);
  if (contributing.length === 0) {
    // No contributing legs (empty book, or every leg excluded/non-convergent) — same
    // fallback as the empty-positions case, never a zero-width domain.
    return { min: spot - FALLBACK_HALF_WIDTH, max: spot + FALLBACK_HALF_WIDTH };
  }
  const strikes = contributing.map(extractStrike);
  const baseAnchors = [...strikes, spot];
  // ... unchanged from here
}
```
Add a regression test: all positions `included: false` (or all `frontIvStatus/backIvStatus: "non-convergent"`) with `positions.length > 0` → `domain.min < domain.max` and both finite.

### WR-02: `assertDefined` used as external-input validation instead of an invariant guard is a design smell that will recur

**File:** `packages/core/src/picker/domain/candidate-selection.ts:140-148` (`isoDayNumber`), used from `resolveEventExit` (line 177-193) and reachable from user input via `analyzeAdHocCalendar.ts`

**Issue:** `isoDayNumber`'s `assertDefined(match, ...)` was originally only ever called with dates the engine itself produced (chain `expiration` strings from `selectCandidates`, sourced from validated DB rows) — a true invariant. Phase 30's `makeAnalyzeAdHocCalendarUseCase` now calls the same function transitively with a **client-supplied** `frontExpiry` (see CR-01), turning what was an invariant assertion into an input-validation gate that throws instead of returning a `Result`. This is the same root cause as CR-01 but is called out separately because it is a reusable function whose contract quietly changed callers (chain data → user input) without a corresponding validation change at the new call site — future reuse of `resolveEventExit`/`isoDayNumber` from another user-facing path will reintroduce the same gap unless the Zod boundary is fixed once, upstream (see CR-01's fix).

**Fix:** Same as CR-01 — validate the date format at the Zod boundary so `isoDayNumber` only ever receives already-validated strings, restoring its `assertDefined` to a true invariant.

## Info

### IN-01: `AdHocCalendarInput.frontDte`/`backDte` are trusted verbatim instead of derived from `asOf`+`expiry`, unlike every other engine candidate

**File:** `packages/core/src/picker/application/analyzeAdHocCalendar.ts:118-119`, contrast with `packages/core/src/picker/domain/candidate-selection.ts:352,371`

**Issue:** Every auto-surfaced candidate's `dte` is derived (`daysBetween(asOfIso, fe)`) from the snapshot's own reference date, never client-supplied. The ad-hoc path is the one place in the picker engine where `dte` is taken directly from external input rather than derived — a deliberate simplification for the ad-hoc-paste use case (the client doesn't know the server's `asOf`), but it means "byte-parity with `scoreCalendarCandidates`" (T-30-10, tested) is parity on the **pricing formula**, not a guarantee that the *scored* dte matches the calendar's *real* dte the way every other candidate's does. Worth a one-line doc callout at the `AdHocCalendarInput` type (`ports.ts:318-329`) so a future reader doesn't assume the same derivation guarantee holds here.

**Fix:** Add a comment on `AdHocCalendarInput.frontDte`/`backDte` noting they are trusted client input, not server-derived, and (per CR-01) should eventually be cross-validated against `frontExpiry`/`backExpiry` rather than independently accepted.

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
