---
phase: 17-overview-v2-redesign-iv-calibration-fix
verified: 2026-07-03T18:10:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Deploy/preview Overview and compare to mockups/overview-v2.html"
    expected: "Pill header, full-width payoff hero + breakevens + T+0/@exp scenario strip, positions table docked below, 320px GEX rail on the right (gamma profile, GEX bars, key levels, net book greeks), macro + book rows below. The dedicated Market screen still renders full-size via its own nav tab (no regression)."
    why_human: "Visual layout fidelity vs a mockup (spacing, visual grammar, pixel-level conformance) cannot be verified by grep/unit tests — planner explicitly deferred this to a human-check step (17-04-PLAN.md Task 1)."

  - test: "During and outside RTH, watch the live Overview screen"
    expected: "The payoff T+0 curve visibly moves with live marks (not frozen at a flat 18% guess); a non-convergent/illiquid leg shows 'IV n/a' and the net-book 'T+0 excludes N' note; the live-mark badge tints amber past 5 min and the GEX badge tints amber past its refresh window; hovering/selecting a positions row spotlights that position's curve and dims the rest; the scenario strip @exp header shows the front expiry date."
    why_human: "Live production timing/behavior (real market data flowing through the SSE stream, real staleness thresholds crossing in real time) cannot be verified by a unit test — planner explicitly deferred this to a human-check step (17-04-PLAN.md Task 2)."
---

# Phase 17: Overview v2 Redesign + IV Calibration Fix Verification Report

**Phase Goal:** Users see a payoff-centered Overview (variant B "TOS dock") whose T+0 scenario curve
is calibrated to each position's live-mark IV instead of a flat default guess.
**Verified:** 2026-07-03T18:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TOS-dock layout: full-width payoff hero + breakevens + T+0/@exp scenario strip at key levels, positions table docked below, GEX rail right, pill header (SPX·netγ+regime·flip·VIX·VVIX·DFF·10y2y·COT·book P&L) | ✓ VERIFIED (structure) / human-check pending (visual fidelity) | `Overview.tsx:830-984` renders `PillHeader` (all 9 metrics present, `Overview.tsx:673-708`) sticky above a `grid-template-columns: 1fr 320px` two-column body: payoff hero `Panel` hosting `PayoffChart` + scenario strip (`Overview.tsx:838-935`) above the docked `PositionsTable` (`Overview.tsx:938-953`), and `GexRail` (GammaProfile, GexBars mode="gex", Key levels, Net book greeks — `Overview.tsx:580-640`) in the 320px right column. `CotCard`/`MacroCard`/`BookSummary`/`SystemHealth` reused unmodified below (`Overview.tsx:962-984`). Breakevens computed in `PayoffChart.tsx:124` (pre-existing, reused). 15 Overview.test.tsx assertions pass. Pixel/visual conformance vs `mockups/overview-v2.html` is a human-check item (planner-deferred). |
| 2 | Payoff T+0 curve uses per-position IV calibrated to live-mark via bisection (`invertIv`), never a flat `DEFAULT_IV` on the hero path | ✓ VERIFIED | `resolveLegIv` (`apps/web/src/lib/iv-calibration.ts:65-99`) calls `invertIv` from `@morai/core` (frozen Newton+200-step-bisection solver) on the REST/cold-start path and trusts an already-converged live-tick `bsmIv` otherwise — never returns/substitutes a flat constant on any branch. `Overview.tsx`'s `resolveLeg`/`buildCalendarPosition` (lines 92-150) call `resolveLegIv` per leg and feed the result into `repriceScenario` (line 761) which drives `PayoffChart`'s `todayCurve` (line 888). Grep confirms `DEFAULT_IV` (line 65, value 0.18) is referenced only inside `netGreeksForLegs` (line 174, the documented-deferred `BookSummary`/OQ2 path) — zero occurrences in `resolveLeg`/`buildCalendarPosition`/the `calendarBuild`/`scenario` chain. 45/45 targeted tests pass (`iv-calibration.test.ts` 7, `scenario-engine.test.ts` covering leg exclusion, `Overview.test.tsx` covering the wiring). |
| 3 | A non-convergent calibration (deep-ITM/illiquid leg) shows a tagged result on screen instead of a silently wrong curve | ✓ VERIFIED | `resolveLegIv` returns a tagged `CalibrationError` (`IvError \| {kind:"no-price"}`) — never the last Newton/bisection iterate, never `DEFAULT_IV` (`iv-calibration.ts:38-39,65-99`, unit-tested). `scenario-engine.ts`'s `isIvExcludedFromT0`/`includedForT0`/`includedForExpiry` (lines 240-250) correctly implement the front-vs-back exclusion rule (front-only non-convergence still draws @exp since `bsmPrice`'s `T<=0` branch at the front expiry ignores sigma — confirmed in `packages/quant/src/bsm.ts:92-94`; back-leg non-convergence excludes both). `Overview.tsx` renders an amber "IV n/a" `Badge`+`Tooltip` on the row (lines 383-409) and threads `excludedFromT0.count` into `PayoffChart`'s `excludedFromT0Count` prop (line 902), which renders the amber "T+0 excludes {n} position(s): IV n/a" note (`PayoffChart.tsx:205-206`). Cold-start ("no-price") is correctly distinguished from genuine non-convergence and does NOT set the misleading badge (`Overview.tsx:114`, tested in `Overview.test.tsx` "a cold-start leg... does NOT render an 'IV n/a' badge"). |
| 4 | Stale GEX data displays its snapshot timestamp so the user can tell it apart from live data | ✓ VERIFIED | GEX "as of" badge reuses `relAge`/`GEX_FRESH_MS` from `Market.tsx` verbatim (now exported, `Overview.tsx:26,817-821,847-853`) — shows timestamp + relative age, amber-tints past the freshness window. An independent new live-mark "as of" badge (5-min amber threshold, `LIVE_MARK_FRESH_MS`) shows the same visual grammar for the live-tick timestamp (`Overview.tsx:70,823-828,855-865`). Both convert CBOE-UTC timestamps to local time via `toLocaleString`/`relAge` — never a raw UTC string (regression gate held). Unit-tested in `Overview.test.tsx` ("renders the GEX 'as of' staleness badge", "renders the live-mark badge amber when the last tick is older than 5 minutes"). Live behavior during/outside RTH is a human-check item (planner-deferred). |

**Score:** 4/4 truths structurally verified; 0 present-but-behavior-unverified (the two live/visual-timing checks were explicitly planner-deferred to human-check, not silently skipped — see Human Verification below).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/lib/iv-calibration.ts` | `resolveLegIv()` + `CalibrationError` — client-side `invertIv` wrapper | ✓ VERIFIED | Exists, exports `resolveLegIv`, `LiveTick`, `CalibrationError`, `BSM_PARITY_TOLERANCE`. Imports `invertIv`/`IvError` from `@morai/core` package root (not a deep relative path). No `any`/`as`(non-const)/`!`. |
| `apps/web/src/lib/iv-calibration.test.ts` | fast-check property + unit coverage | ✓ VERIFIED | 7 tests: round-trip property, live-tick trust, non-convergence, cold-start, netQty===0, expired, BSM parity smoke test. All pass. |
| `apps/web/src/lib/scenario-engine.ts` | `AnalyzerPosition.frontIvStatus/backIvStatus`, leg-level exclusion, `buildScenarioStrip`, `t0ExcludedPositions` | ✓ VERIFIED | All present, correctly implements front-vs-back Pitfall-1 exclusion rule (verified against `bsmPrice`'s T<=0 branch), bounded/deduped/capped scenario strip. |
| `apps/web/src/lib/scenario-engine.test.ts` | front-vs-back fixtures + strip cap/dedupe/sort/front-expiry tests | ✓ VERIFIED | Present, all cases pass. |
| `apps/web/src/components/charts/PayoffChart.tsx` | `highlightedPositionId` + single-position curve props + `excludedFromT0Count` | ✓ VERIFIED | 4 optional backward-compatible props added; net-book dim to `strokeOpacity=0.3` is chart-layer, distinct from `opacity-40` row class (grep confirms `opacity-40` never introduced into this file). |
| `apps/web/src/components/charts/PayoffChart.test.tsx` | dim/highlight + exclusion-note tests | ✓ VERIFIED | 7 tests, all pass. |
| `apps/web/src/screens/Overview.tsx` | TOS-dock layout, calibrated IV wiring, staleness badges, row-highlight, scenario strip | ✓ VERIFIED | Contains `resolveLegIv` import/call (line 15, 101); single `useLiveStream()` call (line 728); all wiring described above present. |
| `apps/web/src/screens/Overview.test.tsx` | TOS-dock layout + calibration + staleness + highlight coverage | ✓ VERIFIED | 15 tests, all pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `iv-calibration.ts` | `@morai/core` | `import { invertIv }` from package root | ✓ WIRED | Confirmed; `apps/web` package.json/tsconfig/vitest alias updated to support this (documented deviation, not scope creep — required by the plan's own interface contract). |
| `bookPL` (T+0) | `AnalyzerPosition.frontIvStatus`/`backIvStatus` | exclude on either leg non-convergent | ✓ WIRED | `includedForT0()` (scenario-engine.ts:244-246) checks both fields, matches Pitfall 1 / plan's own `<behavior>` spec (not the task-text's front-only shorthand — documented as an intentional bug-fix deviation in 17-02-SUMMARY.md). |
| `bookPLAtExpiry` (@exp) | `AnalyzerPosition.backIvStatus` | exclude only on back-leg non-convergent | ✓ WIRED | `includedForExpiry()` (scenario-engine.ts:248-250) checks only `backIvStatus`; confirmed correct via `bsmPrice`'s `T<=0` intrinsic branch (front leg's IV is irrelevant at its own expiry). |
| `Overview.tsx` | `iv-calibration.ts` | `resolveLegIv` per leg → `frontIvStatus`/`backIvStatus` on `AnalyzerPosition` → `repriceScenario` | ✓ WIRED | `resolveLeg`/`buildCalendarPosition` (Overview.tsx:92-150) → `calendarBuild`/`calendarPositions` (line 740-747) → `repriceScenario` (line 761) → `PayoffChart` `todayCurve`/`expirationCurve` (lines 888,890). |
| `Overview.tsx` live-mark + GEX badges | CBOE-UTC timestamps | convert UTC → local via `relAge`/`toLocaleString` | ✓ WIRED | `relAge`/`GEX_FRESH_MS` reused verbatim from `Market.tsx` (now exported); `markAsOf`/`gexAsOf` use `toLocaleString` — never a raw UTC string. |
| `Overview.tsx` `useLiveStream()` | payoff hero + docked table | exactly ONE consumer, not `BookSummary` | ✓ WIRED | Single occurrence at line 728, threaded into `calendarBuild`/`PositionsTable`/`GexRail` — `BookSummary` receives raw `positions`/`spot` only, no live-stream data. |
| `PayoffChart` net-book curve strokes | `highlightedPositionId` prop | `stroke-opacity → 0.3` when active | ✓ WIRED | `netBookStrokeOpacity` variable applied to both net-book `LinePath` elements (PayoffChart.tsx:458,613); highlight overlay curves render at full emphasis with `VIOLET`/`GRAY_MUTED` tokens when `highlightedPositionId` set. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| OVW-01 | 17-02, 17-03, 17-04 | TOS-dock layout | ✓ SATISFIED | All layout elements present and structurally tested; visual fidelity is a deferred human-check. |
| OVW-02 | 17-01, 17-02, 17-04 | Calibrated per-position IV, never flat DEFAULT_IV, tagged non-convergence, stale GEX timestamp | ✓ SATISFIED | `resolveLegIv` wired end-to-end; `DEFAULT_IV` confirmed absent from the hero path via grep; non-convergence tagging and staleness badges implemented and tested. |

No orphaned requirements — REQUIREMENTS.md maps only OVW-01/OVW-02 to Phase 17, both claimed by plans and both satisfied.

### Anti-Patterns Found

None. Scanned all 5 modified/created files (`iv-calibration.ts`, `scenario-engine.ts`, `PayoffChart.tsx`, `Overview.tsx`, `Market.tsx`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/empty-implementation patterns — zero matches (one doc-comment in `Overview.tsx:53` references a historical "placeholder flat IV" that was superseded within the same plan/file, confirmed resolved by grep showing `DEFAULT_IV` absent from the hero path). No `any`, no non-const `as`, no `!` non-null assertions in any touched file.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| iv-calibration suite | `bun run test -- apps/web/src/lib/iv-calibration.test.ts` | 7/7 pass | ✓ PASS |
| scenario-engine suite | `bun run test -- apps/web/src/lib/scenario-engine.test.ts` | all pass (part of 45 combined) | ✓ PASS |
| PayoffChart suite | `bun run test -- apps/web/src/components/charts/PayoffChart.test.tsx` | 7/7 pass | ✓ PASS |
| Overview suite | `bun run test -- apps/web/src/screens/Overview.test.tsx` | 15/15 pass | ✓ PASS |
| Combined 4-file run | `bun run test -- <4 files>` | 4 files / 45 tests passed | ✓ PASS |
| Typecheck | `bun run typecheck` | clean, no errors | ✓ PASS |
| Lint | `bun run lint` | clean (only pre-existing boundary-plugin warnings, unrelated) | ✓ PASS |
| Git log RED→GREEN sequencing | `git log --oneline` | `test(17-0N)` precedes `feat(17-0N)` for all 4 plans, all 4 SUMMARY-claimed commit hashes exist in history | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` conventions or phase-declared probes found for this phase (React/TypeScript UI phase, not a migration/tooling phase). Skipped.

### Human Verification Required

Both items below were explicitly identified by the planner as `<human-check>` blocks in 17-04-PLAN.md (deferred to end-of-phase per `workflow.human_verify_mode`), harvested here per the verifier's mandate. Automated checks (structure, wiring, tests, typecheck, lint, anti-patterns) all pass — nothing here is a code gap, only visual/live-timing confirmation that only a human can give.

1. **Layout fidelity vs mockup**
   **Test:** Deploy/preview the Overview screen and visually compare to `mockups/overview-v2.html`.
   **Expected:** Pill header, full-width payoff hero + breakevens + T+0/@exp scenario strip, positions table docked below the graph, 320px GEX rail on the right (gamma profile, GEX bars, key levels, net book greeks), macro + book rows below — matching the mockup's visual grammar (spacing, typography, color). The dedicated Market screen still renders full-size via its own nav tab (no regression).
   **Why human:** Pixel/visual conformance to a static mockup cannot be verified by grep or unit assertions — only structural presence (headers, testids) can be automated, which has been confirmed.

2. **Live calibration + staleness behavior**
   **Test:** During and outside RTH, watch the live Overview screen.
   **Expected:** The payoff T+0 curve visibly moves with live marks (not frozen at a flat 18% guess); a non-convergent/illiquid leg shows "IV n/a" and the net-book "T+0 excludes N" note; the live-mark badge tints amber past 5 min and the GEX badge tints amber past its refresh window; hovering/selecting a positions row spotlights that position's curve and dims the rest; the scenario strip @exp header shows the front expiry date.
   **Why human:** Real-time SSE tick behavior and staleness-threshold crossing in production cannot be exercised or observed by a unit test — the underlying logic (thresholds, formatting, exclusion) is unit-tested and passes, but the live behavior itself needs eyes on the running app.

### Gaps Summary

No gaps found. All 4 ROADMAP success criteria are structurally implemented, wired end-to-end, and covered by passing automated tests (45/45 across the 4 phase-owned test files), with typecheck/lint clean and no anti-patterns. Both requirement IDs (OVW-01, OVW-02) are satisfied. The only outstanding items are two planner-deferred human-check verifications (visual layout fidelity vs mockup, and live production timing behavior) — neither is a code defect, both require a human to observe the running app.

One noteworthy design nuance surfaced during code tracing (not a gap against any documented must-have): when a front leg is non-convergent, `Overview.tsx`'s `resolveLeg` sets that leg's numeric IV to `0` (never `DEFAULT_IV`, per D-01). For a front-non-convergent-but-still-@exp-included position, `scenario-engine.ts`'s `entryNetPrice` (used as the "current value" reference point for the @exp curve) computes the front leg's *current* value at `T>0` using that `iv=0`, which mathematically converges to the discounted-intrinsic value (not `NaN`/`Infinity` in the general case — verified against `bsmPrice`'s formula). This does not violate "never NaN/Infinity" (untested edge case: exact at-the-money strike could produce `0/0`, but this is a pre-existing numerical property of the reused `bsmPrice` kernel, not a regression introduced by this phase, and is not among the phase's must-have truths). Flagged here for visibility, not as a blocking gap.

---

_Verified: 2026-07-03T18:10:00Z_
_Verifier: Claude (gsd-verifier)_
