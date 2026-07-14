---
phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
plan: 03
subsystem: ui
tags: [react, scoring, analyzer, picker, mobile]

requires:
  - phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
    provides: "41-02's ranked candidate table + candidate-row-* testids (this plan's verdict hero mounts unchanged in the same analyzer-scorecard-wrapper slot)"

provides:
  - "GROUP_OF (criterion -> EDGE/RISK/FIT) and verdictWord(score) exported from useAnalyzerModel.ts — single source both trees partition/derive from"
  - "formatAsOf exported from CandidateCard.tsx for the hero footer's as-of provenance (AUI-07)"
  - "Desktop VerdictHero (Analyzer.tsx): headline (verdict word + score + Theta) over EDGE/RISK/FIT factor-group columns + one quiet footer, replacing the retired 11-chip ScoringMethodologyPanel"
  - "Mobile MobileScorecard: same verdict-word headline + EDGE/RISK/FIT groups stacked single-column, sharing GROUP_OF/verdictWord with desktop"

affects: [41-04, 41-05]

tech-stack:
  added: []
  patterns:
    - "GROUP_OF/verdictWord live once in useAnalyzerModel.ts (D-02 single-source) — both desktop and mobile trees import and partition scoreItems by GROUP_OF[item.key], never re-declaring the mapping"
    - "verdictWord() derives strictly from scoreStatus(candidate.score)'s existing icon/tier split — no new threshold, no fabricated confidence (D-02 evidence-honesty)"

key-files:
  created: []
  modified:
    - apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts
    - apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts
    - apps/web/src/components/picker/CandidateCard.tsx
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx
    - apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx
    - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx

key-decisions:
  - "Per-criterion weight badges (the old chip strip's `w35`/`w30` spans) are dropped entirely, on both trees — the UI-SPEC's locked factor-row format is `label ✓/~/✗ NN%` with no weight slot; carrying the weight forward would have contradicted the spec's own literal template. Tests asserting `checklist-*-weight` testids were removed rather than migrated."
  - "The desktop hero's footer (calibrating + gate-drops + as-of/source) always renders once a candidate is scored, never conditionally hidden — the UI-SPEC's 'omitted when empty' only describes the two OPTIONAL segments (calibrating/gate-drops); as-of+source is always populated (AUI-07 requires it on every displayed number), so the footer line itself is never absent for a scored candidate."
  - "Mobile keeps checklist-experimental/checklist-gate-drops as SEPARATE rows (not merged into one footer line like desktop) — the plan's Task 3 explicitly says 'preserve the context/gate-drops footer rows exactly,' unlike desktop where Task 2 explicitly asked for one merged footer line."

requirements-completed: [AUI-02, AUI-06]

coverage:
  - id: D1
    description: "Desktop verdict hero: headline (icon + FAVORABLE/CAUTION/SKIP + score/100 + Theta/d) over EDGE/RISK/FIT factor-group columns, replacing the 11-chip flat scorecard"
    requirement: "AUI-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — verdict hero (Phase 41, AUI-02/D-02) — renders the headline (verdict word + score + Theta) and a checklist row per rubric factor for the selected calendar / groups the checklist rows under EDGE/RISK/FIT per the LOCKED mapping"
        status: pass
    human_judgment: false
  - id: D2
    description: "Verdict word derives strictly from scoreStatus(candidate.score) at the three tier boundaries — no fabricated confidence, no new threshold"
    requirement: "AUI-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts#verdictWord — evidence-honest verdict derivation (Phase 41, AUI-02/D-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Not-scored (pasted) candidate renders ONLY the not-scored note (no verdict word, no groups); no selection renders nothing — on both trees"
    requirement: "AUI-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — pasted calendars (multi-paste) — Why / Scoring checklist / Entry-exit show a 'not engine-scored' note; apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx#MobileScorecard — J7 verdict hero — J7a/J7b"
        status: pass
    human_judgment: false
  - id: D4
    description: "Quiet footer carries as-of + source provenance (AUI-07 honesty) — never a floating debug row"
    requirement: "AUI-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — verdict hero (Phase 41, AUI-02/D-02) — renders the as-of + source provenance in the quiet footer (AUI-07)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Mobile MobileScorecard restructures the flat checklist into the same Edge/Risk/Fit groups, stacked single-column, with the identical verdict-word headline"
    requirement: "AUI-06"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx#MobileScorecard — J7 verdict hero — J7c/J7e (groups the checklist rows under EDGE/RISK/FIT per the LOCKED mapping)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Whole Analyzer.test.tsx + analyzer-mobile suite (109 tests) exercises the new hero/grouped DOM — no retired scoring-pills/scoring-checklist/checklist-theta/mobile-score testid remains anywhere in apps/web"
    verification:
      - kind: unit
        ref: "bun run test apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile (109/109 pass); grep for scoring-pills|scoring-checklist|checklist-theta\"|mobile-score\" returns 0 live-code matches"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-14
status: complete
---

# Phase 41 Plan 03: Verdict Hero (Desktop + Mobile) Summary

**Replaced the 11-chip flat scorecard with a one-headline verdict hero (FAVORABLE/CAUTION/SKIP word + score + Θ) over three labeled EDGE/RISK/FIT factor-group columns on desktop, and the same grouping stacked single-column on mobile — both sharing one `GROUP_OF`/`verdictWord` source in `useAnalyzerModel.ts`.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 completed
- **Files modified:** 8

## Accomplishments
- `useAnalyzerModel.ts` exports `GROUP_OF` (the LOCKED `fwdEdge/slope/vrp`→EDGE, `eventAdjustment/beVsEm/debitFit`→RISK, `gexFit/deltaNeutral/thetaVega`→FIT mapping) and `verdictWord(score)`, which reuses `scoreStatus(score)`'s own ✓/~/✗ tier split to pick `FAVORABLE`/`CAUTION`/`SKIP` — no new threshold, no fabricated confidence.
- `CandidateCard.tsx`'s `formatAsOf` is now exported so both the desktop hero footer and (already) the candidate card reuse the identical as-of/freshness formatter.
- `Analyzer.tsx`'s `ScoringMethodologyPanel` (the retired 11-chip strip + bare debug line) is replaced by `VerdictHero`: a headline row (`{icon} {WORD}   score {N}/100   Θ {sign}{val}/d`, word at 16px/600-weight tier-colored, score/Θ at 13px/600-weight mono, Θ independently sign-colored), an AH-session badge when after-hours, a `grid-cols-3` of EDGE/RISK/FIT factor columns (each row `label ✓/~/✗ NN%`, same guard handling as the retired chips), and one quiet footer combining calibrating context + gate-drop counts + `as of {HH:MM} · {source}`.
- `MobileScorecard.tsx` gets the identical verdict-word headline above its checklist, and the flat row list restructures into the same three EDGE/RISK/FIT group blocks stacked vertically (single column, phone width) — the θ GATE row is folded into the headline Θ exactly as on desktop, while the calibrating/gate-drops rows stay separate (unlike desktop's merged footer, per the plan's own "preserve... exactly" instruction for mobile).
- Per-criterion weight badges (`w35`/`w30`) are dropped on both trees — the UI-SPEC's locked factor-row format has no weight slot.

## Task Commits

Each task was committed atomically:

1. **Task 1: GROUP_OF partition + verdictWord derivation + formatAsOf export (shared)** - `85935a2` (feat)
2. **Task 2: Desktop verdict hero replaces ScoringMethodologyPanel** - `23ef94e` (feat)
3. **Task 3: Mobile MobileScorecard — flat checklist → Edge/Risk/Fit stacked groups** - `db477f9` (feat)

_Each task followed RED (test written + run, confirmed failing for the right reason — missing export or missing testid) → GREEN (implementation + full suite pass) → commit, per this repo's TDD rule._

## Files Created/Modified
- `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts` - added `GROUP_OF` + `verdictWord()`
- `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts` - RED/GREEN tests for `GROUP_OF` (all 9 criteria) and `verdictWord` (3 tier boundaries)
- `apps/web/src/components/picker/CandidateCard.tsx` - `formatAsOf` now exported (no behavior change)
- `apps/web/src/screens/Analyzer.tsx` - `ScoringMethodologyPanel` replaced by `VerdictHero`; `MetricChip` import dropped (no longer used); `formatAsOf`/`GROUP_OF`/`verdictWord` imported
- `apps/web/src/screens/Analyzer.test.tsx` - "per-candidate scoring checklist" and "rule-registry-driven checklist" describe blocks migrated onto the hero DOM (`verdict-word`/`verdict-score`/`verdict-theta`/`verdict-group-*`/`verdict-hero-footer`); other scattered `scoring-pills`/`scoring-checklist` references across the file (pasted-calendar tests, J1/J2 branch tests) swept onto the new testids
- `apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx` - 32px bare score + flat checklist replaced by the verdict-word headline + EDGE/RISK/FIT stacked groups
- `apps/web/src/screens/analyzer-mobile/MobileScorecard.test.tsx` - J7 suite migrated onto `mobile-verdict-word`/`mobile-verdict-score`/`mobile-verdict-theta`/`mobile-verdict-group-*`; added a grouping-assertion test; weight assertions removed
- `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx` - 3 `mobile-score` references (a DOM-order tripwire + 2 hollow-shell gates) migrated to `mobile-verdict-headline` (Rule 1 fix, outside this plan's named files)

## Decisions Made
- Per-criterion weight badges dropped on both trees (see key-decisions above) — matches the UI-SPEC's literal `label ✓/~/✗ NN%` factor-row format, which has no weight slot.
- Desktop footer always renders once scored (never conditionally hidden) since as-of+source provenance is always present — satisfies AUI-07 unconditionally rather than only when calibrating/gate-drops happen to be non-empty.
- Mobile keeps `checklist-experimental`/`checklist-gate-drops` as separate rows rather than merging into one footer line like desktop, per the plan's explicit "preserve... exactly" instruction for Task 3.
- Renamed `ScoringMethodologyPanel` → `VerdictHero` (and its props interface) since the component's entire body and purpose changed — a re-label of a function whose implementation this task fully replaces, not a drive-by rename of unrelated code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `AnalyzerMobile.test.tsx` referenced the retired `mobile-score` testid in 3 places**
- **Found during:** Task 3 full-suite verification run (`bun run test apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile`)
- **Issue:** `AnalyzerMobile.test.tsx` (not in this plan's named `<files>` list) had a DOM-order tripwire test and two "no hollow shells" gate assertions that queried `[data-testid="mobile-score"]` — a testid Task 3 retired when `MobileScorecard.tsx`'s 32px bare score was replaced by the verdict-word headline.
- **Fix:** Migrated all 3 references to `mobile-verdict-headline` — the DOM-order test now asserts against the new headline element, and the two "no hollow shells" tests still assert a real absence instead of becoming permanently vacuous.
- **Files modified:** `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx`
- **Verification:** Full 109/109 suite green (`Analyzer.test.tsx` + `analyzer-mobile/*`).
- **Committed in:** `db477f9` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a test outside the plan's named files left broken by this plan's own testid retirement, matching the same failure mode 41-02's SUMMARY documented)
**Impact on plan:** No scope creep — same testid-migration pattern already applied within the plan's own named files, one more instance of it in a sibling test file.

## Issues Encountered
None beyond the deviation above.

## Next Phase Readiness
- The verdict hero (desktop + mobile) is fully wired to `candidate.score`/`candidate.breakdown` — snapshot-derived only, no live-tick recomputation, matching the phase's threat model (T-41-03/T-41-04).
- No blockers for 41-04/41-05.

---
*Phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar*
*Completed: 2026-07-14*

## Self-Check: PASSED
All 8 modified source files and the SUMMARY.md itself confirmed present on disk; all 3 task
commits (`85935a2`, `23ef94e`, `db477f9`) confirmed in `git log`.
