---
phase: 36
plan: 02
subsystem: web
status: complete
tags: [analyzer, mobile, scorecard, candidates-fold, payoff-chart, disclosures, D-06, D-07, D-08, D-09, D-10, D-18]
requires:
  - useAnalyzerModel (36-01, D-02 — consumed by name)
  - MobileChartControls (36-01, D-05 — mounted verbatim)
  - CandidateCard / WhyPanel / TermStructureChart / EntryExitPlan / PayoffChart (reused verbatim)
  - AnalyzerMobile skeleton root (36-01, D-01)
provides:
  - MobileScorecard (verdict hero + checklist rows)
  - MobileAnalyzerChart (chart block: controls + full-bleed PayoffChart + caption)
  - AnalyzerMobile full mobile flow (paste → candidates → scorecard → chart → disclosures)
affects:
  - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx
tech-stack:
  added: []
  patterns:
    - controlled native <details> (React-owned `open`, synchronous body mount — catch #24)
    - top-3 + aria-expanded fold (Journal history-toggle idiom)
    - bare rail prompts (no Panel shells in the mobile tree)
key-files:
  created:
    - apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx
    - apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx
    - apps/web/src/screens/analyzer-mobile/MobileAnalyzerChart.tsx
    - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx
  modified:
    - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx
decisions:
  - Disclosure uses a CONTROLLED <details open={open}> with a summary onClick that preventDefaults the native toggle and drives React state — instead of an uncontrolled onToggle listener. jsdom dispatches the native `toggle` event asynchronously, so an onToggle-gated body never mounts before the assertion; the controlled pattern mounts the body synchronously while still keeping the content React-gated on the real `open` attribute (catch #24 satisfied). No CSS reveal anywhere.
  - MobileAnalyzerChart mounts MobileChartControls directly (it already owns its own px-4) rather than wrapping it — mirrors the MobileRiskPanel consumer pattern; no double padding.
  - Caption/scorecard derive session/context fallbacks the same way the desktop call sites do (`snapshot?.marketSession ?? "rth"`, gateDrops `{liquidity:0,netTheta:0}`), so a pasted-card-during-cold-start edge never throws.
metrics:
  duration_min: 21
  completed: 2026-07-11
  tasks: 3
  files_created: 4
  files_modified: 1
---

# Phase 36 Plan 02: AnalyzerMobile Tree Summary

The full mobile Analyzer flow on the 36-01 foundation: paste block first (the screen's verb),
candidates with a top-3 + `All candidates (N)` fold and five bare-prompt rail states, the
`MobileScorecard` verdict hero (32px score + checklist rows), the full-bleed `MobileAnalyzerChart`
behind one slim chrome row, and the three closed Term/Why/Plan `<details>` disclosures. Every
D-06…D-10/D-18 contract is jsdom-verified; the desktop tree and every reused chart/picker
component are provably untouched.

## What shipped

- **Task 1 — `MobileScorecard` (D-08, J7).** A fully-controlled verdict hero: `candidate === null`
  → renders nothing (no hollow shell); `breakdown.length === 0` → SectionLabel + the not-scored
  note only; scored → the 32px mono score, the verbatim desktop context line (name violet +
  debit/θ/vega, amber combined-book summary when `bookCount > 1`), and the checklist as stacked
  rows. Row derivation reuses `scoreStatus`/`CHIP_LABELS`/`FALLBACK_SCORE_ITEMS`/`EXPERIMENTAL_SHORT`
  from the model module — never re-implemented; the fwdEdge-null `— n/a` guard, θ GATE sign color,
  AH SESSION row (first, after-hours only), CALIBRATING dim row, and the gate-drops fine print
  mirror `ScoringMethodologyPanel` row-for-row. `MetricChip` is not mounted. Commit `b3b231c`.
- **Task 2 — AnalyzerMobile flow (D-06/D-07/D-18, J5/J6).** Fleshed out the skeleton: paste block
  first (`text-base` 16px input, D-18 iOS-zoom guard, `min-h-11` target) + Analyze; a Candidates
  section whose heading carries `Clear all` + the verbatim Re-pull control, whose body is the five
  bare rail states (loading/error/cold-start/zero-filtered/populated — no `Panel` anywhere), and
  whose populated list pins pasted cards, shows the top 3, folds the rest behind a real
  `aria-expanded` `All candidates (N)` toggle (React state — catch #24), and closes with the
  verbatim rail legend. Mounts `MobileScorecard` after the section. Commit `8b460c8`.
- **Task 3 — chart block + disclosures (D-09/D-10, J4/J8/J9/J10).** New `MobileAnalyzerChart`:
  `MobileChartControls` row + `mt-2 w-full` PayoffChart with the exact UI-SPEC §4 prop block (picker
  curve colors, EM band gated on `expectedMove > 0`, snapshot GEX walls, and the three 35.1 mobile
  props `showBePills={false}`/`aspectRatio={1.3}`/`highlightedPositionId={null}`) + a 9px worst-of
  caption (`bg-up` iff both context statuses `"ok"` and session RTH, else `bg-amber`; ` · AH —
  indicative` appended after-hours). The `⧉ Copy TOS order` button is not rendered (D-09). In
  AnalyzerMobile: the chart mounts after the scorecard when `selected !== null && scenarioResult
  !== null`, then three closed `<details>` (Term/Why/Plan) render whenever a candidate is selected
  (catch #23 — never gated on scoring), each showing the pasted-note for a not-scored candidate.
  D-06 DOM order held. Commit `fc54d96`.

## TDD RED evidence (per task)

- **Task 1 RED:** `Failed to resolve import "./MobileScorecard.tsx"` — the component did not exist
  yet (canonical new-component RED). GREEN → `8 passed (8)`.
- **Task 2 RED:** `11 failed | 1 passed` — every flow assertion failed on `getByTestId("picker-paste-input")`
  etc. against the still-empty skeleton root. GREEN → `12 passed (12)`.
- **Task 3 RED:** `8 failed | 13 passed` — the new chart/disclosure assertions failed
  (`date-pill` / `analyzer-mobile-caption` / `term-structure-line` absent) while the Task-2 tests
  stayed green. GREEN → `21 passed (21)`.

## Verification

| Gate | Result |
|------|--------|
| MobileScorecard.test.tsx (J7) | 8 passed |
| AnalyzerMobile.test.tsx (J4/J5/J6/J8/J9/J10 + paste/D-18) | 21 passed |
| Analyzer.test.tsx (desktop byte-identity guard, unmodified) | 58 passed |
| `bun run test` (full workspace) | 303 files / 3374 tests passed |
| `bun run typecheck` | clean |
| `bun run lint` | clean (only pre-existing project-wide boundaries warnings) |
| `! rg Panel AnalyzerMobile.tsx` (no Panel in the mobile tree) | confirmed absent |
| Desktop tripwire `git diff --quiet` (Analyzer.tsx, PayoffChart.tsx, PayoffControls.tsx, CandidateCard.tsx, WhyPanel.tsx, TermStructureChart.tsx, EntryExitPlan.tsx) | NO DIFF |

Closes validation claims J4, J5, J6, J7, J9, J10, and the Analyzer-side half of J8.

## Deviations from Plan

None to the contract. Two implementation judgment calls (see frontmatter `decisions`):

1. **[Rule 3 — blocking] Controlled `<details>` instead of `onToggle`.** The plan action described
   a native `<details onToggle>` mounting content on the real `open` state. jsdom dispatches the
   `toggle` event asynchronously, so an `onToggle`-gated body did not mount before the J10b/J10c
   assertions (RED surfaced this). Switched to a controlled `<details open={open}>` whose summary
   `onClick` preventDefaults the native toggle and drives React state — synchronous, still fully
   React-gated on the real `open` attribute (catch #24 intact, zero CSS reveal). No contract change;
   the disclosures behave identically in a real browser.
2. **J8 test ordering.** An open Base-UI Projection dialog inerts the control row behind it, so the
   `›` stepper is unreachable while the modal is open (correct product behavior). The J8 test steps
   the pill BEFORE opening the dialog, then opens it to check the slider/date-input — an assertion
   ordering fix, not a code change.

## Self-Check: PASSED

- Files: MobileScorecard.tsx, MobileScorecard.test.tsx, MobileAnalyzerChart.tsx,
  AnalyzerMobile.test.tsx (created) + AnalyzerMobile.tsx (modified) — all FOUND on disk.
- Commits: b3b231c, 8b460c8, fc54d96 — all FOUND in git history.

## Notes for downstream

- 36-05 (cleanup + D-17): the AnalyzerMobile tree is complete; the desktop dead-branch cleanup
  (`order-*`, `contents lg:grid`, `-mx-3 lg:mx-0`) is still pending and unrelated to these files.
- The `analyzer-mobile-caption` worst-of dot and the disclosure force-open pattern are the mobile
  Analyzer analogues of Overview's `mobile-freshness` caption — same 9px token, same dot semantics.
- Chart edge-to-edge bleed, 320/390px fit, and iOS focus-zoom are chrome-devtools/phone-check items
  (C1/C3/C8/C9), not jsdom-assertable — they belong to the phase's manual UAT pass.
