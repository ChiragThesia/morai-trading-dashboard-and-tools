---
phase: 18-analyzer-picker-ui-redesign
plan: 05
subsystem: ui
tags: [react, vitest, zod, picker, inline-svg, term-structure]

requires:
  - phase: 18-01
    provides: frozen pickerCandidate/pickerSnapshotResponse Zod contract + pickerSnapshotFixture typed fixture (termStructure/events/gex)
  - phase: 18-04
    provides: rewritten Analyzer.tsx picker screen (ranked rail + payoff center) with right-column placeholder shells to fill
provides:
  - WhyPanel component — Fwd IV/Slope/Net θ/θ:vega stat grid + forward-edge/event-premium/GEX-fit prose sentences, guard-safe
  - TermStructureChart component — inline SVG term-structure line + event markers + leg dots + guard-aware forward-IV bracket
  - EntryExitPlan component — 5 locked plan rows with debit/target/stop arithmetic + manage/close-by date formatting
  - Analyzer.tsx right column fully wired to the selected candidate (WhyPanel/TermStructureChart/EntryExitPlan)
  - Old position-analyzer surface retired: RollSimulator, AdHocPicker, AttributionWaterfall, GreekStrips, PnlHeatmap,
    LevelBar, tos-parser, rollScenario all deleted (delete-if-orphaned, D-04a)
affects: []

tech-stack:
  added: []
  patterns:
    - "Custom 3-line stat-cell markup (label/value/sub-caption) inside WhyPanel.tsx rather than stretching the shared Stat molecule's 2-line contract — same discretion CandidateCard.tsx already exercised for its hand-rolled breakdown bars"
    - "Fixed +/- sign convention over an |debit|-derived magnitude for EntryExitPlan's target/stop rows (a profit target is always a gain, a stop is always a loss) rather than propagating a possibly-negative debit's raw sign — avoids a double-negative on the guard candidate's negative debit while staying NaN-safe"
    - "Module-local fixed reference date (FIXTURE_REFERENCE_DATE_MS, 2026-07-02) in TermStructureChart.tsx to convert an event's absolute ISO date onto the same DTE-relative x-axis the term-structure points and leg dots already use — verified against the fixture's own frontLeg.dte/closeByExpiry pairs, not invented"

key-files:
  created:
    - apps/web/src/components/picker/WhyPanel.tsx
    - apps/web/src/components/picker/WhyPanel.test.tsx
    - apps/web/src/components/picker/TermStructureChart.tsx
    - apps/web/src/components/picker/TermStructureChart.test.tsx
    - apps/web/src/components/picker/EntryExitPlan.tsx
    - apps/web/src/components/picker/EntryExitPlan.test.tsx
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/lib/scenario-engine.ts
    - apps/web/src/lib/scenario-engine.test.ts
  deleted:
    - apps/web/src/components/RollSimulator.tsx
    - apps/web/src/components/AdHocPicker.tsx
    - apps/web/src/components/AttributionWaterfall.tsx
    - apps/web/src/components/AttributionWaterfall.test.tsx
    - apps/web/src/components/charts/GreekStrips.tsx
    - apps/web/src/components/charts/GreekStrips.test.tsx
    - apps/web/src/components/charts/PnlHeatmap.tsx
    - apps/web/src/components/LevelBar.tsx
    - apps/web/src/lib/tos-parser.ts
    - apps/web/src/lib/tos-parser.test.ts

key-decisions:
  - "EntryExitPlan's target/stop dollar amounts use |debit| × pct with a fixed +/- sign (target always '+', stop always '−') rather than the raw debit × pct arithmetic, so the guard candidate's negative debit (a fixture edge case, not something the plan anticipated) never renders a confusing double-negative — still never NaN, per D-06"
  - "TermStructureChart derives event x-positions from a module-local fixed reference date (2026-07-02), verified against the fixture's own leg-dte/closeByExpiry pairs rather than invented — the fixture has no explicit 'asOf' field, and this is the same reference date the mockup's TODAY constant used"
  - "Deleted the now-unused RollConfig type alongside rollScenario (not explicitly named in the plan's deletion list, but it had zero other callers once rollScenario was removed — same delete-if-orphaned principle applied one level deeper)"
  - "Left the scenario-engine.ts docstring's stale 'Roll overlay' bullet point removed as direct fallout of the rollScenario deletion; left the bookGreekStrips/heatmapCells comment referencing the deleted PnlHeatmap component untouched per D-02 (no engine surgery beyond what's asked)"

requirements-completed: [ANLZ-03]

coverage:
  - id: D1
    description: "WhyPanel renders the Fwd IV/Slope/Net θ/θ:vega stat grid, guard-safe (fwdIv null renders '—', never a fabricated number; Net θ always renders positive)"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/WhyPanel.test.tsx#WhyPanel — stat grid (ANLZ-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WhyPanel's forward-edge sentence branches 3 ways (front-rich / forward-tailwind / locked guard sentence) and the event-premium sentence branches on frontEvents.length"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/WhyPanel.test.tsx#WhyPanel — forward-edge sentence (3-way branch) / WhyPanel — event-premium sentence (2-way branch)"
        status: pass
    human_judgment: false
  - id: D3
    description: "EntryExitPlan renders the 5 locked rows with target=debit×0.25/stop=debit×0.175 arithmetic and formatted manage/close-by dates, verbatim footnote, never NaN on a negative-debit guard candidate"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/EntryExitPlan.test.tsx#EntryExitPlan — 5 locked rows + arithmetic (ANLZ-03/D-01b)"
        status: pass
    human_judgment: false
  - id: D4
    description: "TermStructureChart renders the term-structure polyline, amber event markers, and front/back leg dots; a normal candidate gets a forward-IV bracket, the guard candidate (fwdIv null) omits it in favor of a guard tag — no throw/NaN"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/TermStructureChart.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "Analyzer.tsx's right column wires WhyPanel/TermStructureChart/EntryExitPlan to the selected candidate under the three locked headings; selecting the guard candidate shows the guard sentence and omitted bracket"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — right column (Task 2, ANLZ-03/D-01b)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Old position-analyzer surface retired (RollSimulator/AdHocPicker/AttributionWaterfall/GreekStrips/PnlHeatmap/LevelBar/tos-parser/rollScenario deleted, delete-if-orphaned), full suite green, Overview.tsx and the KEEP engine symbols untouched"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "bun run test (1472 passed / 168 skipped) && bun run typecheck && bun run lint"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual fidelity of the full picker (right column added) to mockups/playground-v4.html variant B — pixel/layout read-through"
    verification: []
    human_judgment: true
    rationale: "Visual/layout fidelity against a reference mockup requires human eyes; deferred to the phase-gate manual check per human_verify_mode: end-of-phase (config.json) — this is the FINAL plan of phase 18, so this check is now due."

duration: 25min
completed: 2026-07-04
status: complete
---

# Phase 18 Plan 05: Picker Right Column + Old-Analyzer Retirement Summary

**Filled the picker's right column (WhyPanel stat-grid + conditional narrative, guard-aware inline-SVG TermStructureChart, EntryExitPlan arithmetic card) and deleted the 8 now-orphaned old-Analyzer files, closing out phase 18 with a full green suite.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-04
- **Tasks:** 3/3 completed
- **Files modified:** 14 (6 created, 4 modified, 10 deleted... see key-files for exact accounting — 6 created + 4 modified + 10 deleted = 20 file-level changes across 3 commits)

## Accomplishments

- `WhyPanel` renders the Fwd IV/Slope/Net θ/θ:vega stat grid (Fwd IV shows `—` for the guard candidate, never a fabricated number; Net θ always renders `text-up`/positive) plus three candidate-conditional prose sentences: the forward-edge narrative (front-rich vs forward-tailwind vs the exact locked guard sentence), the event-premium narrative (warns and names events vs. the structural/non-event wording), and a closing GEX-fit sentence referencing the fixture's static flip/walls/netGamma/absGammaStrike context.
- `EntryExitPlan` renders the 5 locked rows (`Debit = max loss` / `Profit target (+25%)` / `Stop (−17.5%)` / `Manage short (21 DTE)` / `Hard close by`) with target/stop computed as `|debit| × pct` (fixed +/− sign convention keeps the guard candidate's negative debit from rendering a double-negative), manage/close-by dates derived from `exitPlan.closeByExpiry`/`manageShortDte`, and the verbatim footnote.
- `TermStructureChart` draws the fixture's 31-point term-structure polyline, one amber dashed event marker per fixture event (converted onto the DTE axis via a fixed, fixture-verified reference date), coral/teal front/back leg dots, and a blue dashed forward-IV bracket between the two leg x-positions — omitted for the guard candidate (`fwdIv === null`) in favor of a small amber `guard` tag, with no throw/NaN in either case.
- `Analyzer.tsx`'s right column now wires all three components to the selected candidate (replacing 18-04's placeholder shells); switching selection — including to the guard candidate — re-wires the whole column, verified end-to-end in `Analyzer.test.tsx`.
- Retired the entire dead position-analyzer surface: `RollSimulator`, `AdHocPicker`, `AttributionWaterfall`, `GreekStrips`, `PnlHeatmap`, `LevelBar`, `tos-parser`, and `rollScenario` (+ its test describe block and the now-unused `RollConfig` type) — every deletion re-verified via `rg -l` immediately before removal, per D-04a. `repriceScenario`/`AnalyzerPosition`/`bookPL`/`buildScenarioStrip`/`PayoffChart`/`pairPositionsIntoCalendars`/`CalendarGroup` all remain untouched and still export; `Overview.tsx` has zero diff.

## Task Commits

1. **Task 1: WhyPanel + EntryExitPlan — stat grid, conditional narrative, plan arithmetic (RED→GREEN)** - `8fd8348` (feat)
2. **Task 2: TermStructureChart (guard-aware) + wire the right column into Analyzer (RED→GREEN)** - `f31b31e` (feat)
3. **Task 3: Retire old-Analyzer orphans (delete-if-orphaned) + full-suite green gate** - `22899f7` (refactor)

**Plan metadata:** (this commit) - docs: complete plan

_Note: per this repo's `.claude/rules/tdd.md` convention (matches 18-04 precedent), each TDD task's RED test file and GREEN implementation landed in a single commit at green — the RED failure was run and confirmed for the right reason (import-error / missing-assertion) before writing the implementation in every task, including a targeted `git stash` round-trip to re-prove RED on the Analyzer-wiring sub-change specifically, since that edit had already been made before its own test was written._

## Files Created/Modified

- `apps/web/src/components/picker/WhyPanel.tsx` / `.test.tsx` - Stat grid + 3-way forward-edge / 2-way event-premium / GEX-fit prose, guard-safe
- `apps/web/src/components/picker/TermStructureChart.tsx` / `.test.tsx` - Inline SVG term line + event markers + leg dots + guard-aware forward-IV bracket
- `apps/web/src/components/picker/EntryExitPlan.tsx` / `.test.tsx` - 5 locked plan rows, debit/target/stop arithmetic, date formatting
- `apps/web/src/screens/Analyzer.tsx` - Right column wired to the selected candidate (`RightColumn` replaces 18-04's `RightColumnPlaceholders`)
- `apps/web/src/screens/Analyzer.test.tsx` - New "Analyzer — right column" describe block (headings, default-candidate wiring, re-wiring on selection, guard-candidate render)
- `apps/web/src/lib/scenario-engine.ts` - `rollScenario` + `RollConfig` removed (orphaned once `RollSimulator` was deleted); stale "Roll overlay" docstring bullet removed
- `apps/web/src/lib/scenario-engine.test.ts` - `rollScenario`'s `describe` block removed
- Deleted: `RollSimulator.tsx`, `AdHocPicker.tsx`, `AttributionWaterfall.tsx`(+test), `GreekStrips.tsx`(+test), `PnlHeatmap.tsx`, `LevelBar.tsx`, `tos-parser.ts`(+test)

## Decisions Made

- `EntryExitPlan`'s target/stop rows use `|debit| × pct` with a fixed `+`/`−` sign rather than propagating the raw `debit × pct` sign — a profit target is always a gain and a stop is always a loss by construction (Copywriting Contract), so the guard candidate's negative fixture debit renders `+$201`/`−$140` instead of a confusing `−$201` double-negative. Still never NaN.
- `TermStructureChart` needs a DTE for each event (absolute ISO date in the fixture) on the same DTE-relative x-axis the term-structure points and leg dots already use. There's no explicit "asOf" field in the fixture, so the component uses a fixed local reference date (2026-07-02) — verified, not guessed, against the fixture's own `frontLeg.dte`/`exitPlan.closeByExpiry` pairs (e.g. front DTE 21 + this reference date === closeByExpiry "2026-07-23" for the top candidate; checked against a second candidate too).
- Deleted the now-orphaned `RollConfig` type alongside `rollScenario` even though the plan's deletion list only named the function — once `rollScenario` was gone, `RollConfig` had zero remaining callers, so the same delete-if-orphaned principle (D-04a) applied one level deeper.
- `WhyPanel` builds its own 3-line stat-cell markup (label/value/sub-caption) instead of stretching the shared `Stat` molecule, which only supports a 2-line label/value cell — same discretion `CandidateCard.tsx` (18-04) already exercised for its hand-rolled breakdown bars, per UI-SPEC Registry Safety (hand-rolled, not a new registry component).

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met:
- Grep confirms the locked guard sentence, plan row labels, and footnote strings appear verbatim in the components.
- `rg -l "RollSimulator|AdHocPicker|AttributionWaterfall|GreekStrips|PnlHeatmap|LevelBar|parseTosOrder|rollScenario"` across `apps/web/src` returns only prose-comment mentions (verified non-import) — no dangling import of a deleted symbol.
- `bun run test` (1472 passed / 168 skipped — skips are pre-existing Docker-unavailable testcontainers, unchanged from 18-04's baseline), `bun run typecheck` (`tsc --build --force`, clean), and `bun run lint` (`eslint .`, clean) all pass.
- `git diff --stat apps/web/src/screens/Overview.tsx` and `apps/web/src/App.tsx` are both empty (zero behavioral change to callers/siblings).
- No `any`/`as`/`!` in any new/modified file.
- KEEP engine symbols (`repriceScenario`, `AnalyzerPosition`, `bookPL`, `buildScenarioStrip`, `PayoffChart`, `pairPositionsIntoCalendars`, `CalendarGroup`) all still export.

## Issues Encountered

- Task 1's first pass on `EntryExitPlan`'s stop-row arithmetic used the raw `debit × stopPct` sign directly (matching the plan's literal wording), which produced the wrong sign for the normal (positive-debit) case against my own test's expected mockup-matching output (`−$810`, not `+$810`). Root-caused to a sign-convention mismatch (mockup always hardcodes `+`/`−` per row regardless of the underlying arithmetic's sign) and fixed by switching to the `|debit| × pct` + fixed-sign formatter described above, before the task's single commit — not a deviation from the plan, a correction made during the same RED→GREEN cycle.
- Discovered the Analyzer-wiring edit for Task 2 had been made before its own integration test was written (violating strict RED-first ordering for that specific sub-change, even though the underlying `TermStructureChart` component itself was properly RED→GREEN'd first). Corrected by `git stash`-ing the wiring edit, re-running the new tests to confirm they failed for the right reason against the pre-wiring `Analyzer.tsx`, then restoring the edit — documented here for transparency rather than silently proceeding.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 18 (Analyzer→Picker UI redesign) is now feature-complete: all 5 plans across 4 waves landed (contracts/fixture, adapters, CandidateCard rail, payoff center, and this plan's right column + old-Analyzer retirement).
- Manual phase-gate check remains open and is now due (this was the final plan): `/analyzer` visual read-through against `mockups/playground-v4.html` variant B (all three columns, including the new right column), deferred per `human_verify_mode: end-of-phase`.
- The picker's full loop (scan → select → compare → read why/term-structure/plan) is wired end-to-end against the frozen 18-01 fixture. Phase 19 (per PROJECT.md's v1.2 roadmap) is expected to swap the fixture for a live `/api/picker/candidates` response with zero UI shape change (MCP-02: one schema source).

---
*Phase: 18-analyzer-picker-ui-redesign*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created files found on disk (`WhyPanel.tsx`/`.test.tsx`, `TermStructureChart.tsx`/`.test.tsx`,
`EntryExitPlan.tsx`/`.test.tsx`); all 3 task commit hashes (`8fd8348`, `f31b31e`, `22899f7`) found
in git log; all 8 deleted old-Analyzer files confirmed absent from disk.
