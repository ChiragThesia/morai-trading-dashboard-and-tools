---
phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
plan: 04
subsystem: ui
tags: [react, analyzer, picker, recharts, number-formatting]

requires:
  - phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
    provides: "41-03's verdict hero (VerdictHero/MobileScorecard) — this plan rounds the
      debit/vega numbers those and the Risk-profile subline already render"

provides:
  - "Local Math.round/.toFixed(2) formatter at the Analyzer's 5 debit/vega call sites — the
    Journal/Overview exact-broker-value contract (position-format.ts's exactAbs/usd/signedUsd)
    stays untouched and unreferenced by Analyzer.tsx/MobileScorecard.tsx"
  - "TermStructureChart.tsx at H=320, leg-dot r=7/label 13px, event lines labelled + opacity
    0.5 — consumed unchanged by both AnalyzerDesktop's center column and AnalyzerMobile's
    Term-structure disclosure (shared component, one fix, both trees)"
  - "Desktop paste input at px-3 py-2 text-[12px] (larger hit target/legible text)"

affects: [41-05]

tech-stack:
  added: []
  patterns:
    - "Display-layer-only rounding: Math.round()/.toFixed(2) inlined at each render call site,
      never a new shared formatter module (UI-SPEC ladder rung 6) and never position-format.ts's
      exact-value helpers, which are the Journal/Overview screens' own locked contract"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx
    - apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx
    - apps/web/src/components/picker/TermStructureChart.tsx
    - apps/web/src/components/picker/TermStructureChart.test.tsx

key-decisions:
  - "vega always renders with 2 explicit decimals (.toFixed(2)), including whole numbers
    (e.g. 610 -> '610.00') — this is the UI-SPEC's own literal rule (Greeks ≤2dp via
    .toFixed(2)), not a rounding artifact; the one hardcoded MobileScorecard.test.tsx J7d
    fixture (bookVega=610) was updated to expect '610.00' rather than relaxing the rule."
  - "The Analyzer desktop paste-input's Analyze button was already size=\"sm\"/variant=\"primary\"
    from prior work (predates this plan) — Task 3 only grew the <input> (px-2 py-1 text-[10px]
    -> px-3 py-2 text-[12px]); no button change was needed or made."

requirements-completed: [AUI-04, AUI-05, AUI-06]

coverage:
  - id: D1
    description: "Analyzer's 5 debit/vega call sites (3 in Analyzer.tsx, 2 in MobileScorecard.tsx)
      round to whole-dollar debit / 2dp vega via a LOCAL Math.round/.toFixed(2) formatter, never
      reusing position-format.ts's exact-value helpers"
    requirement: "AUI-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#rounds debit to whole dollars and vega to 2dp in the subline (AUI-04) — no long-decimal render; apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx#J7c asserts contextTail(TOP) + not.toContain(String(TOP.vega))"
        status: pass
    human_judgment: false
  - id: D2
    description: "exactAbs import removed from both Analyzer.tsx and MobileScorecard.tsx (and
      their test files) — grep confirms zero references remain"
    requirement: "AUI-04"
    verification:
      - kind: unit
        ref: "grep -n exactAbs apps/web/src/screens/Analyzer.tsx apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx returns no matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "TermStructureChart grows to H=320 (aspect-[760/320]), leg ReferenceDots to
      r=7/13px labels, and event ReferenceLines gain an in-chart label matching the legend chip
      name (opacity 0.3->0.5) — shared component, applies to both desktop and mobile"
    requirement: "AUI-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/TermStructureChart.test.tsx#chart height grows to 320 / leg dots grow to r=7 / each event ReferenceLine carries an in-chart label matching its below-chart legend name"
        status: pass
    human_judgment: false
  - id: D4
    description: "Desktop paste input grows to a larger, legible target (px-3 py-2 text-[12px]);
      existing paste-flow tests stay green unchanged (styling-only, no new branch)"
    requirement: "AUI-05"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx -t \"pasted calendars\" (14 tests pass)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Rounding fix applies identically on mobile (MobileScorecard's 2 call sites) —
      same Math.round/.toFixed(2), one rule, both trees"
    requirement: "AUI-06"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx (9/9 pass, incl. J7d's hardcoded vega now expects '610.00')"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-14
status: complete
---

# Phase 41 Plan 04: Number Rounding + Term-Structure/Paste Polish Summary

**Replaced the 5 `exactAbs` (Journal/Overview exact-broker-value helper) call sites on the Analyzer tab with a local `Math.round()`/`.toFixed(2)` formatter — dollars now whole, vega ≤2dp — and grew the term-structure chart (H 320, r=7 leg dots, in-chart event labels) plus the desktop paste input, on both desktop and mobile trees.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments

- `Analyzer.tsx`'s Risk-profile subline (selected-name debit/vega, both ternary branches) and
  combined-book summary, plus `MobileScorecard.tsx`'s identical context line and combined-book
  summary, now compute `Math.round(debit)` and `vega.toFixed(2)` inline at each render site — no
  new shared formatter module (UI-SPEC ladder rung 6), and `exactAbs`/`position-format.ts` is no
  longer imported by either file. Journal/Overview's own exact-broker-value contract in
  `position-format.ts` is untouched.
- `TermStructureChart.tsx` (shared by desktop's center column and mobile's "Term structure + your
  legs" disclosure) grew from H=230 to H=320, its leg `ReferenceDot`s from `r=5.5`/12px labels to
  `r=7`/13px labels, and its event `ReferenceLine`s gained an in-chart `label` (the event's own
  name, matching the below-chart legend chip) at `opacity=0.5` (was 0.3) — one fix, both trees,
  since the component is imported unchanged by both.
- `Analyzer.tsx`'s desktop paste `<input>` grew from `px-2 py-1 text-[10px]` to
  `px-3 py-2 text-[12px]` for a larger, legible hit target; the "Analyze" button was already
  `size="sm"`/`variant="primary"` from prior work, so no button change was needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: AUI-04 number rounding — local formatter replaces the exact-value call sites** - `6ff8e15` (feat)
2. **Task 2: AUI-05 term-structure chart — taller, prominent leg markers, in-chart event labels** - `f4d9e71` (feat)
3. **Task 3: AUI-05 desktop paste-input polish (styling-only)** - `101966c` (style)

_Tasks 1 and 2 followed RED (test written + run, confirmed failing against the still-`exactAbs`/
still-230px production code) → GREEN (implementation + full suite pass) → commit. Task 3 is a
tdd.md styling-only exemption per the plan (no new branch) — existing paste tests verified
unchanged green._

## Files Created/Modified

- `apps/web/src/screens/Analyzer.tsx` - `exactAbs` import removed; subline + combined-book
  summary now use `Math.round`/`.toFixed(2)`; paste `<input>` grown to `px-3 py-2 text-[12px]`
- `apps/web/src/screens/Analyzer.test.tsx` - `exactAbs` import removed; new rounding-assertion
  test added; two combined-book-summary assertions switched from `exactAbs(...)` to
  `Math.round(...)`
- `apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx` - `exactAbs` import removed;
  context line + combined-book summary now use `Math.round`/`.toFixed(2)`
- `apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx` - `exactAbs` import removed;
  `contextTail()` helper switched to `Math.round`/`.toFixed(2)`; J7c gained a
  not-the-raw-decimal assertion; J7d's hardcoded vega expectation updated to `"610.00"`
  (`.toFixed(2)` always shows 2 decimals, even for whole numbers)
- `apps/web/src/components/picker/TermStructureChart.tsx` - `H` 230→320, `aspect-[760/230]`→
  `aspect-[760/320]`, leg dot `r` 5.5→7 + label `fontSize` 12→13, event `ReferenceLine`s gained
  a `label` prop + `opacity` 0.3→0.5
- `apps/web/src/components/picker/TermStructureChart.test.tsx` - 3 new tests (chart height 320,
  leg dot r=7, event line in-chart label) in a new describe block

## Decisions Made

- vega's `.toFixed(2)` always shows exactly 2 decimals, including on whole numbers (e.g. bookVega
  610 renders "610.00") — this is the UI-SPEC's own literal rule, not an artifact to work around;
  the one pre-existing hardcoded test fixture asserting the old "+610" string was updated to
  "+610.00" rather than relaxing the formatting rule.
- The Analyze button needed no change in Task 3 — it was already `size="sm"` from prior work
  (predates this plan), so only the `<input>` was grown, matching the plan's stated target state
  with a smaller diff.

## Deviations from Plan

None — plan executed exactly as written. The Task 3 Analyze-button "grow to size=sm" instruction
described a starting state (implicit size) that no longer matched the codebase (already
`size="sm"`); this is not a deviation requiring a Rule 1-4 classification since the target state
was already satisfied — no code change was skipped, just none was needed for that one element.

## Issues Encountered

None.

## Next Phase Readiness

- All 5 rounding call sites, the term-structure chart, and the paste input are done on both
  desktop and mobile trees (shared `TermStructureChart` component covers mobile automatically).
- No blockers for 41-05.

---
*Phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar*
*Completed: 2026-07-14*

## Self-Check: PASSED
All 6 modified source files and this SUMMARY.md confirmed present on disk; all 3 task commits
(`6ff8e15`, `f4d9e71`, `101966c`) confirmed in `git log`. Verification suite
(`Analyzer.test.tsx` + `MobileScorecard.test.tsx` + `TermStructureChart.test.tsx`) 92/92 pass;
`grep -n exactAbs` on both touched source files returns zero matches; `bunx tsc --noEmit` shows
zero new errors attributable to these 6 files (pre-existing unrelated repo-wide typecheck
baseline errors confirmed absent from the touched-file grep).
