---
phase: 18-analyzer-picker-ui-redesign
plan: 04
subsystem: ui
tags: [react, vitest, zod, visx, picker, payoff-chart]

requires:
  - phase: 18-01
    provides: frozen pickerCandidate Zod contract + pickerSnapshotFixture typed fixture
  - phase: 18-02
    provides: PayoffChart compareCurve/compareCurveColor + expectedMoveBand additive props
  - phase: 18-03
    provides: candidateToAnalyzerPosition adapter (candidate -> view-only AnalyzerPosition)
provides:
  - CandidateCard component with data-driven (criterion-name-lookup) 4-bar breakdown + guard-case rendering
  - Rewritten Analyzer.tsx as the ranked-cards picker screen (same export name/signature)
  - CandidateRail exported subcomponent (ranked rail + empty-state, directly testable)
  - ScenarioStrip component (T+0/@exp P&L grid at 5 key levels, reusing buildScenarioStrip)
  - Payoff center wiring: reprice selected candidate, single ⊕-compare overlay, EM band
affects: [18-05]

tech-stack:
  added: []
  patterns:
    - "Data-driven UI lookup by discriminated-union criterion name (never array index) for score-breakdown rendering"
    - "Exported internal subcomponent (CandidateRail) for direct unit-testing of a branch unreachable through the parent's fixture-only, zero-props signature (mirrors Overview.tsx's exported formatExpiryCell)"
    - "Spy-wrap PayoffChart via vi.mock(..., importOriginal) to assert exact props a screen hands the chart, without mocking away its real rendering (17.1-03/Overview.test.tsx precedent)"

key-files:
  created:
    - apps/web/src/components/picker/CandidateCard.tsx
    - apps/web/src/components/picker/CandidateCard.test.tsx
    - apps/web/src/components/picker/ScenarioStrip.tsx
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx

key-decisions:
  - "Breakdown-bar captions use a per-criterion formatter (vol-pts 'v' for slope/fwdEdge, percent for gexFit, ok/− for eventAdjustment) — UI-SPEC locks only the fwd-edge guard-case caption ('n/a'); other captions are an authored, internally-consistent choice mirroring mockups/playground-v4.html's own formatting"
  - "CandidateRail extracted and exported from Analyzer.tsx so the empty-state branch is unit-testable directly (Analyzer itself is fixture-only with zero props per D-02b, so it can't be handed an empty candidate list without module-mocking gymnastics)"
  - "ScenarioStrip renders numeric-only level headers (no 'put wall'/'flip'/'strike' semantic labels) — matches Overview.tsx's own buildScenarioStrip reuse precedent, since the merged/sorted/deduped level array loses per-level semantic identity by design"
  - "Payoff center uses fixed ScenarioParams (spot/rate/divYield from the frozen fixture, daysForward=0, ivShift=0) — the picker has no scenario sliders (D-02b, view-only)"

requirements-completed: [ANLZ-01, ANLZ-02]

coverage:
  - id: D1
    description: "CandidateCard renders 4 data-driven breakdown bars (slope/fwdEdge/gexFit/eventAdjustment) looked up by criterion name, never index; beVsEm never renders a 5th bar"
    requirement: "ANLZ-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/CandidateCard.test.tsx#CandidateCard — data-driven breakdown bars (D-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Guard-case candidate (fwdIv null) renders fwd-edge bar as zero-width + 'n/a' caption, never NaN/throw"
    requirement: "ANLZ-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/CandidateCard.test.tsx#guard case (fwdIv null): fwd-edge bar renders zero-width + caption n/a, never NaN or a throw"
        status: pass
    human_judgment: false
  - id: D3
    description: "Analyzer screen renders the ranked candidate rail (score-descending), defaults selection to the top candidate, and click-to-select works"
    requirement: "ANLZ-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — ranked candidate rail (Task 2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Payoff center reprices the selected candidate via candidateToAnalyzerPosition -> repriceScenario -> PayoffChart with picker curve colors (blue T+0, violet @exp), rollCurve always null"
    requirement: "ANLZ-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — payoff center (Task 3, ANLZ-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Single ⊕-compare overlay loads/clears a dashed amber compareCurve; compare-title suffix renders"
    requirement: "ANLZ-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#⊕-compare loads a non-null amber compareCurve / toggling off clears / compare-title suffix"
        status: pass
    human_judgment: false
  - id: D6
    description: "±1σ expected-move band and 5-level ScenarioStrip render off the same repriceScenario curves (no second pricing path)"
    requirement: "ANLZ-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — ScenarioStrip (Task 3, ANLZ-02/D-06)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual fidelity to mockups/playground-v4.html variant B (left+center columns) — pixel/layout read-through"
    verification: []
    human_judgment: true
    rationale: "Visual/layout fidelity against a reference mockup requires human eyes; deferred to the phase-gate manual check per human_verify_mode: end-of-phase (config.json)"

duration: 40min
completed: 2026-07-04
status: complete
---

# Phase 18 Plan 04: Analyzer→Picker Payoff Center Summary

**Rewrote Analyzer.tsx into the ranked-cards calendar picker — data-driven CandidateCard rail (score-breakdown bars looked up by criterion name, guard-safe) plus a payoff center that reprices the selected candidate through the one shared BSM engine, overlays a single dashed-amber ⊕-compare curve, draws the ±1σ EM band, and renders a 5-level T+0/@exp scenario strip.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-04
- **Tasks:** 3/3 completed
- **Files modified:** 5 (3 created, 2 rewritten)

## Accomplishments

- `CandidateCard` renders exactly 4 breakdown bars via criterion-name lookup on `candidate.breakdown` (never a hard-coded array index), proven by a shuffled-breakdown-order test; the `beVsEm` 5th entry is present in the data but never rendered as a card bar.
- Guard-case candidate (`fwdIv === null`) renders the fwd-edge bar at zero-width with an `n/a` caption — no NaN, no throw.
- `Analyzer.tsx` is a full replacement: 100% fixture-driven (`pickerSnapshotFixture` from `@morai/contracts`), zero `usePositions`/`useGex`/`useLiveStream`/`pairPositionsIntoCalendars` imports, exact `export function Analyzer(): React.ReactElement` signature preserved (`App.tsx` has zero diff).
- Payoff center reprices the selected candidate via `candidateToAnalyzerPosition` → `repriceScenario` → `PayoffChart`, with the picker's own curve colors (`#5b9cf6` T+0 blue, `#a78bfa` @exp violet) — distinct from both the Overview TOS override and the old Analyzer's defaults.
- Single ⊕-compare slot: clicking a second card's compare button loads a dashed-amber `compareCurve` (front-expiry P&L only); clicking it again clears it back to `null`; the "Risk profile" title gains the amber `vs {compareName} (dashed)` suffix while active.
- `ExpectedMoveBand` passed as `{ spot: fixtureSpot, em: selected.expectedMove }`; new `ScenarioStrip` component reuses `buildScenarioStrip`'s dedup/cap logic verbatim to render T+0/@exp P&L at the 5 key levels (put wall, γ flip, spot, call wall, candidate strike) off the same curves the chart already drew — no second pricing path.
- Scoring methodology collapsible panel renders the locked 3-item reference list verbatim; empty-state copy is unit-tested via the exported `CandidateRail` subcomponent.

## Task Commits

1. **Task 1: CandidateCard component — data-driven breakdown bars + guard case (RED→GREEN)** - `806bf4c` (feat)
2. **Task 2: Analyzer screen skeleton + ranked rail + scoring-methodology panel (RED→GREEN)** - `71e3e79` (feat)
3. **Task 3: Payoff center — reprice selected + ⊕-compare overlay + EM band + scenario strip (RED→GREEN)** - `ea11294` (feat)

**Plan metadata:** (this commit) - docs: complete plan

_Note: per this repo's `.claude/rules/tdd.md` convention (matches 17.1-01 precedent), each task's RED test file and GREEN implementation landed in a single commit at green, rather than separate test→feat commits — the RED failure was run and confirmed before writing the implementation in every task._

## Files Created/Modified

- `apps/web/src/components/picker/CandidateCard.tsx` - Ranked-card component: header (name/score), sub-line (DTE/debit/θ/vega/event tags), 4 data-driven breakdown bars, ⊕ compare button with click-delegation (stopPropagation)
- `apps/web/src/components/picker/CandidateCard.test.tsx` - Shuffled-breakdown-order mapping, 4-bars-only, guard-case, click/⊕ delegation tests
- `apps/web/src/components/picker/ScenarioStrip.tsx` - T+0/@exp P&L grid at buildScenarioStrip-derived key levels
- `apps/web/src/screens/Analyzer.tsx` - Full rewrite: 3-col picker screen (ranked rail, payoff center, methodology, 18-05 placeholder shells)
- `apps/web/src/screens/Analyzer.test.tsx` - Full rewrite: ranked-rail, selection, methodology, empty-state, payoff-center, compare-overlay, EM-band, scenario-strip tests

## Decisions Made

- Breakdown-bar caption format per criterion (vol-pts "v" / percent / ok-−) is an authored choice mirroring the mockup's own formatting — UI-SPEC only locks the guard-case "n/a" caption.
- `CandidateRail` extracted and exported so the empty-state branch is directly testable without module-mocking `@morai/contracts` (Analyzer itself takes zero props, D-02b).
- `ScenarioStrip` shows numeric-only level headers (no "put wall"/"flip" labels), matching Overview.tsx's existing `buildScenarioStrip` reuse convention rather than the mockup's labeled row — the merged/deduped level array loses per-level semantic identity by design once GEX levels and the candidate strike are combined.
- Payoff center's `ScenarioParams` are fixed constants (fixture spot, `daysForward: 0`, `ivShift: 0`, rate/divYield matching Overview.tsx's `0.045`/`0.013` defaults) — this screen has no scenario sliders (D-02b, view-only against the frozen snapshot).

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met:
- Grep confirms no hard-coded `breakdown[0]`/`breakdown[1]` index access in `CandidateCard.tsx`.
- Grep confirms `Analyzer.tsx` imports NO `usePositions`/`useGex`/`useLiveStream`/`pairPositionsIntoCalendars`/`CalendarGroup`.
- Grep confirms `Analyzer.tsx` calls `repriceScenario` and `candidateToAnalyzerPosition` (single payoff path) and passes `rollCurve={null}`.
- `git diff --stat apps/web/src/App.tsx` and `apps/web/src/screens/Overview.tsx` and `apps/web/src/components/charts/PayoffChart.tsx` are all empty (zero behavioral change to callers/siblings).
- `bun run test` (full workspace, 1488 passed / 168 skipped — skips are pre-existing Docker-unavailable testcontainers, not caused by this plan), `bun run typecheck` (`tsc --build --force`, clean), and `bun run lint` (`eslint .`, clean) all pass.
- No `any`/`as`/`!` in any new/modified file (only `as const` literals, which are explicitly permitted).

## Issues Encountered

None — the only test-authoring correction made during RED→GREEN was disambiguating `getByText(candidate.name)` (which matched both the CandidateCard header and the Risk profile subtitle) by adding a `data-testid="risk-profile-selected-name"` to the subtitle span; this was resolved before the first commit, not a deviation from the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The picker's scan → select → compare loop is fully wired against the frozen fixture (ANLZ-01/ANLZ-02 delivered).
- The right column (`Why this calendar` / `Term structure + your legs` / `Entry / exit plan`) is a placeholder shell only — content, plus the orphaned old-Analyzer file deletions (`RollSimulator`, `AdHocPicker`, `GreekStrips`, `PnlHeatmap`, `AttributionWaterfall`, `LevelBar`, `parseTosOrder`, `rollScenario`), land in 18-05 per the plan's explicit scope split.
- Manual phase-gate check remains open: `/analyzer` visual read-through against `mockups/playground-v4.html` variant B (left+center columns) — deferred per `human_verify_mode: end-of-phase`.

---
*Phase: 18-analyzer-picker-ui-redesign*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created files found on disk; all 3 task commit hashes (`806bf4c`, `71e3e79`, `ea11294`) found in git log.
