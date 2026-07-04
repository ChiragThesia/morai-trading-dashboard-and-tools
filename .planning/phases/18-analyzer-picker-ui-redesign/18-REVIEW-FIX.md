---
phase: 18-analyzer-picker-ui-redesign
fixed_at: 2026-07-04
review_path: .planning/phases/18-analyzer-picker-ui-redesign/18-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 18: Code Review Fix Report

**Fixed at:** 2026-07-04
**Source review:** .planning/phases/18-analyzer-picker-ui-redesign/18-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (WR-01..WR-05; fix_scope `critical_warning`, 0 critical present)
- Fixed: 5
- Skipped: 0

Every fix was applied red→green: a targeted regression test was added (or strengthened)
and confirmed FAILING against the current code first, then the source fix was applied and
the test confirmed GREEN. Type-safety discipline held — no `any`/`as`/`!` introduced.

## Fixed Issues

### WR-01: D-02 non-convergence exclusion missing from the greek strips (NaN gap)

**Files modified:** `apps/web/src/lib/scenario-engine.ts`, `apps/web/src/lib/scenario-engine.test.ts`
**Commit:** 60d5a1b
**Applied fix:** Extended the leg-level non-convergence exclusion (`includedForT0`) — already
applied to the P&L curves — to the two greek producers. `bookGreekAt` now skips on
`!includedForT0(pos)` instead of `!pos.included`, and `repriceScenario` builds
`positionGreeks` from `positions.filter(includedForT0)` (new `greekIncluded`) instead of the
`included`-only set. A `sigma=0` leg (prod `frontIv=0`) can no longer reach `bsmGreeks` and
emit NaN/Infinity strips. RED test asserted the excluded leg leaves `bookGreekStrips` +
`positionGreeks` NaN-free and unchanged vs the control book; failed before (Δ mismatch),
passes after. The fan-curve `minFrontDte` still uses the `included`-only set (display-only
bound, no NaN path) — left untouched to keep the change surgical.

### WR-02: Guard tag renders off-canvas (clipped) for the guard candidate

**Files modified:** `apps/web/src/components/picker/TermStructureChart.tsx`, `apps/web/src/components/picker/TermStructureChart.test.tsx`
**Commit:** e30686a
**Applied fix:** Clamped `guardTagY` into the drawable band —
`Math.max(PAD.top, Math.min(frontY, backY) - 18)`. For the frozen guard candidate
(`frontLeg.iv === IV_MAX`) the raw value was −8, clipped above the `viewBox` top; it is now
`PAD.top` (10), on-canvas. RED test asserts the guard `<rect>`/`<text>` sit within `[0, H]`
(failed at y=−8, passes at y=10).

### WR-03: Contract lacks a snapshot reference date; event-marker placement hardcoded

**Files modified:** `packages/contracts/src/picker.ts`, `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts`, `packages/contracts/src/picker.test.ts`, `apps/web/src/components/picker/TermStructureChart.tsx`, `apps/web/src/components/picker/TermStructureChart.test.tsx`, `apps/web/src/screens/Analyzer.tsx`
**Commit:** 255ad13
**Applied fix:** (USER-APPROVED contract change this run) Added `asOf: z.string()` (ISO 8601)
as a required field on `pickerSnapshotResponse`, with a header note that `asOf` completes the
Phase-19 import-only-swap contract (strengthens, does not break). Set `asOf: "2026-07-02"` on
the frozen fixture. Replaced the `FIXTURE_REFERENCE_DATE_MS` module constant in
`TermStructureChart` with a required `asOf` prop; the component now derives the event-marker
reference date from `asOf` (`isoDateToUtcMs(asOf)`), and `Analyzer` passes
`pickerSnapshotFixture.asOf`. RED tests: the contract now rejects a snapshot missing `asOf`,
and the chart places the same absolute event at a different x for a different `asOf` (proving
placement is asOf-driven, not a constant). All picker/Analyzer/contract suites green.

### WR-04: `computeYDomain` "combined-curve" test is vacuous (green-suite)

**Files modified:** `apps/web/src/components/charts/PayoffChart.test.tsx`
**Commit:** 92a3fe6
**Applied fix:** Test-only. Rewrote the vacuous case so the *today* curve carries the more
extreme values (±20,000 vs the exp tent's ±100); the assertions (`lo ≤ -20_000`,
`hi ≥ 20_000`, and equality to the today-only scan) can only pass if `computeYDomain`
actually scans its first argument. Proven load-bearing: temporarily removing the today-curve
scan from `computeYDomain` makes the strengthened test FAIL; with the (unchanged, correct)
source it passes. No production code touched.

### WR-05: `WhyPanel` theta/vega division unguarded, contradicting its no-NaN contract

**Files modified:** `apps/web/src/components/picker/WhyPanel.tsx`, `apps/web/src/components/picker/WhyPanel.test.tsx`
**Commit:** 6f7a888
**Applied fix:** Guarded the ratio —
`value={candidate.vega === 0 ? "—" : (candidate.theta / candidate.vega).toFixed(3)}` — so a
valid `vega: 0` renders the panel's documented no-value fallback instead of `"Infinity"`/
`"NaN"`. RED test with a synthetic `vega: 0` candidate asserted the `—` fallback (rendered
`"Infinity"` before, `"—"` after).

## Verification

- `bunx vitest run --project web --exclude '**/useLiveStream.test.ts'` → 31 files, **261 passed**
- `bunx vitest run packages/contracts/` → 10 files, **127 passed**
- `bun run typecheck` → **clean (exit 0)**

**Pre-existing unrelated failure (NOT introduced by these fixes):**
`apps/web/src/hooks/useLiveStream.test.ts` (11 SSE/EventSource tests) fails **only inside the
isolated fix worktree's fresh `bun install` node_modules** — it passes in the main repo's
node_modules at the same base commit, and it fails identically at the base commit (HEAD~5,
zero fixes applied) with the worktree node_modules. The file was last modified in Phase 12
(commit 17bda79) and is untouched by any of the five fix commits. Root cause is a
worktree-install environment artifact in the SSE/EventSource test harness (a historically
flaky area per project notes), not a regression from this phase's changes. It was excluded
from the pass count above for that reason; re-run it in the main repo to confirm green.

---

_Fixed: 2026-07-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
