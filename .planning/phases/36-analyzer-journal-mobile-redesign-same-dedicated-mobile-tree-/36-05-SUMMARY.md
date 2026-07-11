---
phase: 36-analyzer-journal-mobile-redesign
plan: 05
subsystem: ui
tags: [react, tailwind, mobile, analyzer, journal, vitest, cleanup]

# Dependency graph
requires:
  - phase: 36-02-analyzer-mobile-tree
    provides: AnalyzerMobile tree — desktop reflow arms on AnalyzerDesktop no longer the mobile path
  - phase: 36-04-journal-mobile-tree
    provides: JournalMobile tree — desktop reflow arms on JournalDesktop no longer the mobile path
provides:
  - AnalyzerDesktop on a plain 3-col grid (no display:contents / order-* / -mx-3 bleed reflow arms) (D-17)
  - JournalDesktop journal-positions on a plain grid + columns on plain min-h-0/overflow-y-auto (no lg: prefixes) (D-17)
  - J16 integration gate green (full suite + typecheck + lint)
affects: [36-phase-close, phase-37-planning]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dead-branch removal is RED-first too: the migrated structural describe is rewritten to assert the POST-cleanup classes and RUN red against the pre-cleanup tree before the deletion lands — the deletion is guarded by a test that fails for the right reason first"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/screens/Journal.tsx
    - apps/web/src/screens/Journal.test.tsx

key-decisions:
  - "Removed the analyzer-payoff-chart-bleed wrapper entirely rather than keeping a class-less div — at desktop the -mx-3 was already overridden by lg:mx-0 (net mx-0), Panel is a plain block (p-3, no flex/gap), so PayoffChart as a direct child is layout-identical; deleting dead structure over keeping it (the phase's own intent)"
  - "Empty-className wrappers (analyzer-scorecard-wrapper / analyzer-right-wrapper) kept as bare <div data-testid=...> — they are the DOM-order anchors the byte-identity + DOM-order tests assert on; only the order-* classes were stripped"
  - "C1-C10 chrome-devtools items + C7 1440px before/after screenshots recorded PENDING-ORCHESTRATOR: this executor has NO browser tools; the code + automated gates are complete and the orchestrator owns the browser run"

requirements-completed: [MOBILE-13]

coverage:
  - id: D-17-analyzer
    description: "AnalyzerDesktop reflow arms removed — analyzer-inner-grid on plain grid grid-cols-[300px_minmax(0,1fr)_330px] gap-4; no order-*/lg:order-none on the four wrappers; -mx-3 full-bleed chart wrapper deleted"
    requirement: "MOBILE-13"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx > Analyzer — desktop grid post-cleanup (36 D-17) (4 pass)"
        status: pass
    human_judgment: false
  - id: D-17-journal
    description: "JournalDesktop reflow arm removed — journal-positions on plain grid h-full grid-cols-[250px_minmax(0,1fr)_290px] gap-3 overflow-hidden p-3; three columns on plain min-h-0 overflow-y-auto (no lg: prefixes)"
    requirement: "MOBILE-13"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx > Journal — desktop grid post-cleanup (36 D-17) (3 pass)"
        status: pass
    human_judgment: false
  - id: J16
    description: "Integration gate — full workspace suite + typecheck + lint green"
    requirement: "MOBILE-13"
    verification:
      - kind: automated
        ref: "bun run test (303 files / 3374 tests) + bun run typecheck (exit 0) + bun run lint (exit 0)"
        status: pass
    human_judgment: false
  - id: C7
    description: "1440px Analyzer + Journal screenshots pixel-identical before vs after the D-17 cleanup"
    requirement: "MOBILE-13"
    verification:
      - kind: automated_ui
        ref: "chrome-devtools 1440x900 before(2e9eb33)/after(eb3a44f) diff — PENDING-ORCHESTRATOR (no browser tools in this executor)"
        status: unknown
    human_judgment: true
    rationale: "Screenshot pixel-identity requires a live browser; this executor has no chrome-devtools access. Deferred to the orchestrator with the baseline commit recorded."
  - id: C1-C10
    description: "chrome-devtools mobile checklist (390×844 + 320/1440 spot checks): cold-start, no-overflow, chart bleed, lifecycle 60%-bug gone, cards, rebuild stack, 320px, iOS no-zoom, 1024px tree swap"
    requirement: "MOBILE-13"
    verification:
      - kind: automated_ui
        ref: "36-VALIDATION.md C1-C10 — PENDING-ORCHESTRATOR (no browser tools in this executor)"
        status: unknown
    human_judgment: true
    rationale: "Each item is a visual/interaction assertion in a live emulated browser; not drivable from this executor. Deferred to the orchestrator's chrome-devtools run."
  - id: C11
    description: "User phone check on morai.wtf Analyzer + Journal — the phase's only acceptance bar"
    requirement: "MOBILE-13"
    verification:
      - kind: manual_procedural
        ref: "user, on the real phone, after deploy — PENDING-USER"
        status: unknown
    human_judgment: true
    rationale: "CONTEXT §Acceptance: the sole acceptance bar is the user's own phone check on the deployed site; agent C1-C10 evidence is supporting material only."

# Metrics
duration: 12min
completed: 2026-07-11
status: complete
---

# Phase 36 Plan 05: Desktop Dead-Branch Cleanup + Integration Gate Summary

**The Phase-35 responsive reflow arms are gone from both desktop trees — AnalyzerDesktop and JournalDesktop now sit on plain 3-col grids (no display:contents / order-* / -mx-3 bleed / lg:-gated variants), guarded RED-first and shipped with the full suite + typecheck + lint green.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-11
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- **D-17 dead-branch cleanup, both desktop trees (Task 1, commit `eb3a44f`)** — RED-first: rewrote the two 35-05 reflow `describe`s to assert the post-cleanup plain-grid classes, ran them red against the pre-cleanup source (5 assertion failures, right reason), then applied UI-SPEC §7 exactly:
  - `Analyzer.tsx` (AnalyzerDesktop only): `analyzer-inner-grid` → `grid grid-cols-[300px_minmax(0,1fr)_330px] gap-4`; dropped `order-*`/`lg:order-none` off the scorecard / rail / center / right wrappers; **removed** the `analyzer-payoff-chart-bleed` `-mx-3 lg:mx-0` wrapper (PayoffChart now renders directly inside its Panel); updated the stale 35-05 reflow comments.
  - `Journal.tsx` (JournalDesktop only): `journal-positions` → `grid h-full grid-cols-[250px_minmax(0,1fr)_290px] gap-3 overflow-hidden p-3`; the three columns keep `flex flex-col gap-3 min-h-0 overflow-y-auto` without `lg:` prefixes.
- **J16 integration gate green (Task 2)** — `bun run test` → 303 files / 3374 tests passed; `bun run typecheck` → exit 0; `bun run lint` → exit 0.
- **Mobile trees, switches, and model hooks untouched** — this was class-token cleanup on branches that only mount ≥1024px; no changes to AnalyzerMobile/JournalMobile, the `useIsDesktop` switches, or `useAnalyzerModel`/`useJournalModel`.

## RED evidence (Task 1)

Before the cleanup landed, the rewritten describes ran red for the right reason (assertion failures, not import/syntax):

Analyzer.test.tsx > "Analyzer — desktop grid post-cleanup (36 D-17)" — 3 failed / 1 passed:
- ✗ plain grid — `expected [ 'contents', 'lg:grid', …(2) ] to include 'grid'`
- ✗ no order utilities — `expected 'order-2 lg:order-none' not to contain 'order-'`
- ✗ no bleed wrapper — `expected <div …> to be null` (analyzer-payoff-chart-bleed still present)
- ✓ DOM order scorecard → rail → center → right (structural invariant, unchanged)

Journal.test.tsx > "Journal — desktop grid post-cleanup (36 D-17)" — 2 failed / 1 passed:
- ✗ plain grid — `expected [ 'flex', 'flex-col', 'gap-3', …(5) ] to include 'grid'`
- ✗ plain column min-h-0 — `expected [ 'flex', 'flex-col', 'gap-3', …(2) ] to include 'min-h-0'`
- ✓ DOM order Trades → Lifecycle → rail (structural invariant, unchanged)

After the cleanup: Analyzer 58/58, Journal 22/22, full suite 3374/3374.

## Screenshot comparison verdict (C7)

**PENDING-ORCHESTRATOR** — this executor has no browser/chrome-devtools tools, so the 1440×900 before/after capture-and-diff could not be run here. The cleanup is display-invisible **by construction**:
- Analyzer: at ≥1024px the removed arms were already no-ops — `contents` was overridden by `lg:grid`, `order-*` by `lg:order-none`, and `-mx-3` by `lg:mx-0`; the plain classes reproduce the exact resolved desktop styles. Panel is a plain block (`p-3`, no flex/gap), so deleting the bleed `div` leaves PayoffChart a full-width block child — layout-identical.
- Journal: `lg:grid lg:h-full lg:grid-cols-[…] lg:overflow-hidden` and per-column `lg:min-h-0 lg:overflow-y-auto` all resolved active at ≥1024px; the un-prefixed classes reproduce them exactly.

Baseline (pre-cleanup) commit for the C7 diff: **`2e9eb33`**. Post-cleanup commit: **`eb3a44f`**. Orchestrator: check out `2e9eb33`, capture `analyzer-1440-before.png` / `journal-1440-before.png`, return to `eb3a44f` (or later HEAD), capture `-after.png`, diff each pair; investigate ANY delta before treating C7 as passed.

## Integration checklist (J16 + chrome-devtools C1-C11)

| # | Claim | Disposition |
|---|-------|-------------|
| J16 | Full suite + typecheck + lint green | **PASS** — 303 files / 3374 tests; typecheck exit 0; lint exit 0 |
| C1 | Analyzer cold start: paste+Analyze top, one-line prompts, zero hollow shells | PENDING-ORCHESTRATOR (no browser tools) |
| C2 | Both screens: `body.scrollWidth === innerWidth` at 390 AND 320, pan container present | PENDING-ORCHESTRATOR |
| C3 | Analyzer: chart edge-to-edge, one slim chrome row, thumb-usable dialogs, term-structure fits | PENDING-ORCHESTRATOR |
| C4 | Journal lifecycle 60%-width bug GONE; 840px pan, legible labels, latest-first, swipe pans, crosshair↔bridge sync | PENDING-ORCHESTRATOR |
| C5 | Journal cards: focal P&L, single OPEN affordance, History folds, selected violet | PENDING-ORCHESTRATOR |
| C6 | ⋯ → Rebuild → confirm stack; Cancel unwinds one layer; copy verbatim | PENDING-ORCHESTRATOR |
| C7 | 1440px Analyzer + Journal pixel-identical vs pre-phase baseline (post-D-17 re-run) | PENDING-ORCHESTRATOR (baseline `2e9eb33` → after `eb3a44f`) |
| C8 | 320px: paste row, control row, checklist rows, trade cards — no wrap-break/clip | PENDING-ORCHESTRATOR |
| C9 | iOS profile: focusing paste input does not zoom (16px input, D-18) | PENDING-ORCHESTRATOR |
| C10 | Resize across 1024px swaps trees on both screens without crash | PENDING-ORCHESTRATOR |
| C11 | User phone check on morai.wtf Analyzer + Journal (after deploy) — the only acceptance bar | **PENDING-USER** |

## Deviations from Plan

None — the two code tasks executed exactly as written (RED-first rewrite → UI-SPEC §7 cleanup → J16 gate), on the four planned files only, with no auto-fixes required.

The plan's chrome-devtools items (C1-C10) and the C7 1440px before/after screenshots are **deferred to the orchestrator**, not deviated: this executor was spawned without browser tools (team-lead instruction), so all code tasks + automated gates are complete and the browser-driven visual gate is handed off with the baseline commit recorded. C11 (user phone check) is the phase's end-of-phase human acceptance item, handed to the user with the deploy prerequisite stated.

## C11 handoff (the acceptance bar)

Per CONTEXT §Acceptance, the **only** acceptance bar is the user's own phone check on the deployed site. Prerequisite: this plan does **not** deploy (deployment/UAT sequencing is the orchestrator's call after C11 is scheduled). Once deployed, the user opens morai.wtf on a real phone and confirms both the Analyzer and Journal screens read as designed mobile app screens (not reflowed desktop). Agent C1-C10 evidence, once the orchestrator runs it, is supporting material — not a substitute.

## Self-Check: PASSED

- FOUND: `.planning/phases/36-analyzer-journal-mobile-redesign-same-dedicated-mobile-tree-/36-05-SUMMARY.md`
- FOUND commit `eb3a44f` (Task 1 D-17 cleanup)
- Modified files present: Analyzer.tsx, Analyzer.test.tsx, Journal.tsx, Journal.test.tsx
