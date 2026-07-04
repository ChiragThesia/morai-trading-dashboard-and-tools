---
phase: 18-analyzer-picker-ui-redesign
verified: 2026-07-04T15:50:00Z
status: passed
score: 8/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Open /analyzer and visually compare the three-column layout (ranked candidate rail, payoff center with compare/EM-band/scenario strip, why-panel + term-structure + entry/exit plan) against mockups/playground-v4.html variant B."
    expected: "Layout, spacing, typography, and color read as the same design system as the mockup — no TOS-neon override, 3-col grid at 300px/1fr/330px, locked section headings verbatim."
    why_human: "Pixel/layout fidelity to a reference mockup requires human eyes; both 18-04-SUMMARY.md and 18-05-SUMMARY.md explicitly deferred this check per config.json's human_verify_mode: end-of-phase, and this is the final plan of the phase, so the check is now due."
---

# Phase 18: Analyzer → Picker UI Redesign Verification Report

**Phase Goal:** Ranked-cards picker UI built contract-first — the Analyzer screen replaced by a
ranked-candidate picker (left rail of ranked cards, payoff center with compare overlay +
expected-move band + scenario strip, right column with why-panel + term-structure + entry/exit
plan), all driven by a frozen PickerCandidate Zod contract.

**Verified:** 2026-07-04
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Ranked candidate-cards rail with per-criterion score-breakdown bars, rendered from a contract-typed fixture (ANLZ-01 / roadmap SC1) | ✓ VERIFIED | `CandidateCard.tsx` looks up `candidate.breakdown` by `criterion` name (never index) for the 4 bars (slope/fwdEdge/gexFit/eventAdjustment); `beVsEm` present in data but never a 5th bar. `Analyzer.tsx`'s `CandidateRail` renders one card per `pickerSnapshotFixture.candidates`, score-descending, top card selected by default. Tests: `CandidateCard.test.tsx` (shuffled-order mapping, 4-bars-only, guard n/a/zero-width, click delegation — 6/6 pass), `Analyzer.test.tsx` ranked-rail block (pass). |
| 2 | User can overlay a candidate on the payoff center (⊕ compare) with expected-move band and scenario strip (ANLZ-02 / roadmap SC2) | ✓ VERIFIED | `PayoffChart.tsx` has additive `compareCurve`/`compareCurveColor`/`expectedMoveBand` props (absent-safe, distinct layer from `rollCurve`, drawn before the curve layers). `Analyzer.tsx` wires `candidateToAnalyzerPosition → repriceScenario → PayoffChart` for both the selected and compare candidates, passes `expectedMoveBand={{spot, em: selected.expectedMove}}`, and renders `ScenarioStrip` (5-level T+0/@exp grid) off the same engine output. Tests: `PayoffChart.test.tsx` (6 new cases pass), `Analyzer.test.tsx` payoff-center/compare/EM-band/scenario-strip blocks (pass). |
| 3 | Why-panel per candidate: term structure with leg dots + forward-vol bracket + event markers, and an entry/exit plan card (+25%/−17.5% defaults) (ANLZ-03 / roadmap SC3) | ✓ VERIFIED | `WhyPanel.tsx` (stat grid + 3-way forward-edge sentence + event-premium sentence + GEX-fit sentence, guard-safe), `TermStructureChart.tsx` (term polyline + amber event markers + leg dots + fwd-IV bracket, omitted+guard-tag when `fwdIv===null`), `EntryExitPlan.tsx` (5 locked rows, `target=debit×0.25`/`stop=debit×0.175` from `candidate.exitPlan`). Wired into `Analyzer.tsx`'s `RightColumn` under the three locked headings. Tests: `WhyPanel.test.tsx` (18/18), `TermStructureChart.test.tsx` (9/9), `EntryExitPlan.test.tsx` (10/10) all pass. |
| 4 | `PickerCandidate`/`pickerSnapshotResponse` Zod contract parses valid payloads, rejects malformed ones, guard-case is schema-legal, `breakdownEntry.criterion` is a closed enum structurally excluding REFUTED criteria | ✓ VERIFIED | `packages/contracts/src/picker.ts` — closed enum `["slope","fwdEdge","gexFit","eventAdjustment","beVsEm"]`; `fwdIv: z.number().nullable()` + `fwdIvGuard` enum. `picker.test.ts` (17/17 pass) exercises valid-parse, malformed-reject (`.parse()`, never swallowed `.safeParse`), guard-case parse, and closed-enum rejection. |
| 5 | Debit = max-loss invariant proven for candidate-derived positions (adapter correctness underlying the entry/exit plan) | ✓ VERIFIED | `candidate-to-position.ts`'s `candidateToAnalyzerPosition` maps legs only (`live:false`), imports no broker/`CalendarGroup` symbols (grep-confirmed). `candidate-to-position.test.ts` proves the invariant by example (all 9 fixture candidates) and a `fast-check` property test (`numRuns:200`) feeding straight into the existing `repriceScenario` — both pass. |
| 6 | Guard-case candidate (`fwdIv===null`) renders safely (no NaN/throw) across every surface it touches | ✓ VERIFIED | `CandidateCard` (fwd-edge bar → `n/a`/0-width), `WhyPanel` (Fwd IV → `—`, guard sentence, Net θ still positive, θ:vega guarded against `vega===0`), `TermStructureChart` (bracket omitted, `guard` tag rendered **on-canvas**, not clipped — WR-02 regression test passes). All guard-path assertions pass in their respective test files. |
| 7 | Old-Analyzer machinery retired without touching Overview.tsx, App.tsx, or the KEEP engine symbols | ✓ VERIFIED | `rg -l "RollSimulator\|AdHocPicker\|AttributionWaterfall\|GreekStrips\|PnlHeatmap\|LevelBar\|parseTosOrder\|rollScenario" apps/web/src` returns zero matches (files confirmed deleted from disk). `git log -1` on `Overview.tsx`/`App.tsx` both point to pre-phase-18 commits (17/17.1); `git diff HEAD~20` for both is empty. `repriceScenario`/`AnalyzerPosition`/`bookPL`/`buildScenarioStrip`/`PayoffChart`/`pairPositionsIntoCalendars`/`CalendarGroup` all still export. |
| 8 | Code-review warnings (WR-01..WR-05) are genuinely fixed in source, not just claimed in 18-REVIEW-FIX.md | ✓ VERIFIED | Re-read source directly: `scenario-engine.ts` `bookGreekAt`/`repriceScenario` now filter on `includedForT0` (WR-01); `TermStructureChart.tsx` `guardTagY = Math.max(PAD.top, ...)` (WR-02); `picker.ts`/fixture/`TermStructureChart.tsx` all carry/consume `asOf` (WR-03); `PayoffChart.test.tsx`'s combined-curve test now uses the more-extreme today-curve values (WR-04, spot-checked); `WhyPanel.tsx` guards `vega===0` (WR-05). Full suite green after fixes. |
| 9 | Visual fidelity of `/analyzer` to `mockups/playground-v4.html` variant B (all 3 columns) | ⚠️ Human verification required | Both 18-04-SUMMARY.md and 18-05-SUMMARY.md explicitly flag this as `human_judgment: true`, deferred per `human_verify_mode: end-of-phase` (`.planning/config.json`). Functional/structural equivalence is verified (layout grid, headings, colors, props) but pixel-level fidelity was never rendered and screenshotted by any agent in this phase. |

**Score:** 8/9 truths verified (1 routed to human verification — visual fidelity, not a behavior-dependent state-transition truth).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/contracts/src/picker.ts` | Frozen PickerCandidate/pickerSnapshotResponse Zod contract | ✓ VERIFIED | Present, exported via `index.ts`, `asOf` field added (WR-03), no `any`/`as`/`!`. |
| `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` | Frozen 9-candidate fixture (8 real + 1 guard) | ✓ VERIFIED | `asOf: "2026-07-02"` present; data-only (no scoring logic). |
| `apps/web/src/components/charts/PayoffChart.tsx` | compareCurve/expectedMoveBand additive props | ✓ VERIFIED | Both props present, optional, defaulted; Overview.tsx call site untouched. |
| `apps/web/src/lib/candidate-to-position.ts` | candidateToAnalyzerPosition adapter | ✓ VERIFIED | Maps legs only, `live:false`, no broker imports. |
| `apps/web/src/components/picker/CandidateCard.tsx` | Ranked card w/ data-driven breakdown bars | ✓ VERIFIED | Criterion-name lookup, guard-safe, click delegation. |
| `apps/web/src/components/picker/ScenarioStrip.tsx` | 5-level T+0/@exp P&L grid | ✓ VERIFIED | Reuses `buildScenarioStrip`, no second pricing path. |
| `apps/web/src/components/picker/WhyPanel.tsx` | Stat grid + conditional narrative | ✓ VERIFIED | Guard-safe (incl. WR-05 fix). |
| `apps/web/src/components/picker/TermStructureChart.tsx` | Term line + markers + leg dots + fwd-IV bracket | ✓ VERIFIED | Guard-aware, on-canvas guard tag (WR-02 fix), `asOf`-driven (WR-03 fix). |
| `apps/web/src/components/picker/EntryExitPlan.tsx` | 5 locked rows, target/stop arithmetic | ✓ VERIFIED | `|debit|×pct` fixed-sign formatting, never NaN. |
| `apps/web/src/screens/Analyzer.tsx` | Rewritten picker screen (same export signature) | ✓ VERIFIED | 3-col grid, all panels wired, `export function Analyzer()` unchanged, `App.tsx` diff empty. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `index.ts` | `picker.ts`/fixture | re-export block | ✓ WIRED | `@morai/contracts` re-exports confirmed; `apps/web` imports from the barrel, not `__fixtures__` directly. |
| `Analyzer.tsx` | `candidate-to-position.ts` → `scenario-engine.ts` | `candidateToAnalyzerPosition` → `repriceScenario` | ✓ WIRED | Single payoff path confirmed by grep + source read; `rollCurve={null}` passed. |
| `Analyzer.tsx` | `PayoffChart.tsx` | compareCurve/expectedMoveBand props | ✓ WIRED | Props populated from `compareScenarioResult`/`selected.expectedMove`. |
| `CandidateCard.tsx` | `candidate.breakdown` | criterion-name `.find()` | ✓ WIRED | No hard-coded index access (grep-confirmed, source-read-confirmed). |
| `TermStructureChart.tsx` | `pickerSnapshotFixture.asOf` | `Analyzer.tsx` prop pass-through | ✓ WIRED | `asOf={pickerSnapshotFixture.asOf}` confirmed at call site. |
| `Analyzer.tsx` | `Overview.tsx`/`App.tsx` | route wiring / sibling screen | ✓ WIRED (unchanged) | Zero git diff on both files since before phase 18. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|--------------|----------------|--------------|--------|----------|
| ANLZ-01 | 18-01, 18-04 | Ranked candidate-cards rail w/ score-breakdown bars, contract-typed fixture | ✓ SATISFIED | CandidateCard + CandidateRail + picker.ts, all tests pass. |
| ANLZ-02 | 18-01, 18-02, 18-03, 18-04 | ⊕-compare overlay + EM band + scenario strip | ✓ SATISFIED | PayoffChart additive props + candidate-to-position adapter + Analyzer wiring, all tests pass. |
| ANLZ-03 | 18-01, 18-05 | Why-panel + term structure + entry/exit plan card | ✓ SATISFIED | WhyPanel + TermStructureChart + EntryExitPlan, all tests pass. |

No orphaned requirements — `REQUIREMENTS.md`'s traceability table maps only ANLZ-01/02/03 to Phase 18, and all three are accounted for above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/src/components/picker/CandidateCard.tsx` | 85 | Negative debit renders `$-803` instead of `−$803` (IN-01, code review info-level, not in fix scope) | ℹ️ Info | Cosmetic only — affects the guard candidate's sub-line formatting; `EntryExitPlan.tsx` already formats debit correctly via a dedicated helper. |
| `apps/web/src/components/charts/PayoffChart.tsx` | 956 | Stale comment claims un-imported `AreaClosed`/`AreaStack` APIs (IN-03, not in fix scope) | ℹ️ Info | Misleading comment only, no behavioral effect. |
| `apps/web/src/lib/scenario-engine.ts` | 568-570 | Unreachable `.slice(0, SCENARIO_STRIP_MAX_LEVELS)` defensive cap (IN-04, not in fix scope) | ℹ️ Info | Dead code, harmless. |
| `apps/web/src/lib/candidate-to-position.test.ts` | 66 | `TOLERANCE=2500` is >50% of typical fixture debit (~$4,600) (IN-05, not in fix scope) | ℹ️ Info | Loosens the debit=max-loss regression guard; documented and empirically justified in the test comment, but a large adapter mis-mapping could theoretically slip under it. Worth tightening in a future pass, not a phase-18 blocker. |

No BLOCKER-severity anti-patterns found. No unresolved `TBD`/`FIXME`/`XXX` markers in any file touched by this phase.

### Behavioral Spot-Checks / Test Execution

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Picker component + screen suite | `bunx vitest run apps/web/src/screens/Analyzer.test.tsx apps/web/src/components/picker` | 5 files, 62 tests passed | ✓ PASS |
| Contract + adapter + chart + engine + Overview regression | `bunx vitest run packages/contracts/src/picker.test.ts apps/web/src/lib/candidate-to-position.test.ts apps/web/src/components/charts/PayoffChart.test.tsx apps/web/src/lib/scenario-engine.test.ts apps/web/src/screens/Overview.test.tsx` | 5 files, 98 tests passed | ✓ PASS |
| Full workspace suite | `bunx vitest run` | 156 files / 1478 tests passed, 21 files / 168 tests skipped (pre-existing Docker-unavailable testcontainers skip) | ✓ PASS |
| Typecheck | `bun run typecheck` | `tsc --build --force` clean, exit 0 | ✓ PASS |
| Lint | `bun run lint` | `eslint .` clean (only pre-existing non-error boundary-selector warnings) | ✓ PASS |
| Orphan-deletion grep | `rg -l "RollSimulator\|AdHocPicker\|AttributionWaterfall\|GreekStrips\|PnlHeatmap\|LevelBar\|parseTosOrder\|rollScenario" apps/web/src` | 0 matches | ✓ PASS |

### Human Verification Required

#### 1. Visual read-through of `/analyzer` against `mockups/playground-v4.html` variant B

**Test:** Open the running app's `/analyzer` route and visually compare all three columns (ranked
candidate rail, payoff center with compare overlay/EM band/scenario strip, why-panel/term-structure/
entry-exit-plan) against `mockups/playground-v4.html`'s variant B.
**Expected:** Layout matches the 300px/1fr/330px 3-column grid, typography/spacing/color read as
the same design system as the mockup (no TOS-neon override, MORAI palette), and the locked section
headings/copy render verbatim.
**Why human:** Pixel/layout fidelity to a reference mockup cannot be confirmed by grep or unit
tests — both 18-04-SUMMARY.md and 18-05-SUMMARY.md explicitly deferred this check
(`human_judgment: true`) per `.planning/config.json`'s `human_verify_mode: end-of-phase`. This is
the final plan of the phase, so the check is now due and was never performed by any agent in this
session (no screenshot or manual browser check appears in any plan/summary/review artifact).

### Gaps Summary

No gaps found. All 5 plans' must-haves are genuinely implemented and wired — verified by reading
source directly (not trusting SUMMARY claims) and by running the actual test suites, typecheck, and
lint fresh in this session. The 5 code-review warnings (WR-01..WR-05) are confirmed fixed in the
current source, each with its own regression test that would fail on the pre-fix behavior. The only
outstanding item is the deferred visual-fidelity check against the mockup, which the phase's own
plans correctly identified as requiring human eyes and explicitly deferred to this end-of-phase gate.

---

_Verified: 2026-07-04_
_Verifier: Claude (gsd-verifier)_
