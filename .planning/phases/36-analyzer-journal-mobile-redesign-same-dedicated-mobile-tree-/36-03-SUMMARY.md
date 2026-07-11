---
phase: 36-analyzer-journal-mobile-redesign
plan: 03
subsystem: ui
tags: [react, mobile, useIsDesktop, matchMedia, vitest, journal]

# Dependency graph
requires:
  - phase: 35.1-mobile-overview
    provides: useIsDesktop switch pattern + useOverviewModel extraction precedent
  - phase: 36-01-analyzer-switch
    provides: parallel wave-1 sibling (Analyzer half) — shares zero files
provides:
  - useJournalModel(trades) shared model hook — single source of Journal state/derivation
  - Single-sourced Journal helpers/stubs/RuleTagChips + TradeSummary (D-04)
  - Journal useIsDesktop switch → JournalDesktop | JournalMobile (D-03)
  - JournalMobile skeleton (root + empty state; sections land in 36-04)
  - Journal desktop tests migrated to matchMedia stub (D-16 byte-identity guard)
affects: [36-04-journal-mobile-tree, 36-05-desktop-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Model-hook extraction: all screen state/derivation in use<Screen>Model, both trees consume one model"
    - "Per-file stubDesktopMatchMedia() helper — jsdom defaults to the mobile tree, desktop describes opt in"

key-files:
  created:
    - apps/web/src/screens/journal-mobile/useJournalModel.tsx
    - apps/web/src/screens/journal-mobile/JournalMobile.tsx
  modified:
    - apps/web/src/screens/Journal.tsx
    - apps/web/src/screens/Journal.test.tsx
    - apps/web/src/screens/JournalContainer.test.tsx

key-decisions:
  - "useJournalModel is .tsx (not the useOverviewModel .ts precedent) — shared view helpers carry JSX, single-sourced here"
  - "Destructure the model into pre-extraction local names in JournalDesktop so the JSX stays byte-identical and const-narrowing flows into onSave closures (no `!`)"
  - "JournalContainer.test.tsx also migrated to the desktop stub — its desktop-tree assertions broke under the new switch (Rule 1 deviation, plan didn't enumerate it)"

patterns-established:
  - "Journal helpers/stubs/RuleTagChips single-sourced in the model file; the desktop view imports them, the mobile tree (36-04) will too"

requirements-completed: [MOBILE-12, MOBILE-13]

coverage:
  - id: D1
    description: "useJournalModel extraction is behavior-preserving — Journal.test.tsx passes UNMODIFIED, JournalContainer TradeSummary contract intact"
    requirement: "MOBILE-13"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx (22 pass, test file byte-unmodified at Task 1)"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/JournalContainer.test.tsx#maps calendar to TradeSummary"
        status: pass
    human_judgment: false
  - id: D2
    description: "Journal renders the mobile tree by default (jsdom) and today's desktop tree under the matchMedia stub (J3)"
    requirement: "MOBILE-12"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal branch — D-03/D-16 (36) (3 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every pre-existing Journal desktop assertion passes under the stub — the D-16 byte-identity guard"
    requirement: "MOBILE-13"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx (19 migrated desktop tests, 3 describes stubbed)"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-11
status: complete
---

# Phase 36 Plan 03: Journal Switch + useJournalModel Summary

**Journal split into a useIsDesktop switch over a shared useJournalModel(trades) hook; desktop tree unchanged and guarded byte-for-byte via a same-commit matchMedia test migration (J3 green).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-11T15:44:00Z
- **Completed:** 2026-07-11T15:53:00Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Extracted `useJournalModel(trades)` — the single source of all Journal state/derivation (open/closed split, selection, history override, lifecycle + rule-tags slices, beats) and the single useLifecycle/useRuleTags consumer.
- Single-sourced the shared view helpers (`fmtDate`/`fmtPnl`/`fmtSnapTime`/`tagLabel`/`RULE_TAG_LABELS`, `ENTER/EXIT/ROLL_OPTIONS`, `HeadingPill`, `RuleTagChips`, `DashedStub`/`PreHistoryStub`/`BuildingLifecycleStub`) and re-exported `TradeSummary` so `JournalContainer` keeps resolving.
- `Journal` is now the thin `useIsDesktop()` switch → `JournalDesktop` (today's JSX renamed in-file) | `JournalMobile` (skeleton). Only one tree mounts.
- Migrated all three pre-existing Journal desktop describes to `stubDesktopMatchMedia()` in the same commit as the switch (D-16), plus 3 new J3 branch tests.

## Task Commits

1. **Task 1: Extract useJournalModel + shared helpers (D-04)** — `d7f5dd0` (refactor)
2. **Task 2: Journal useIsDesktop switch + matchMedia test migration (D-03/D-16)** — `56a1e32` (feat)

_Task 1 is the sanctioned refactor exception: green on both sides, guarded by the UNMODIFIED existing Journal.test.tsx. Task 2 followed TDD red→green (RED output below)._

## RED Run Output (Task 2)

Before implementing the switch, the 3 new "Journal branch — D-03/D-16 (36)" tests were run against the still-desktop-only render:

```
❯ src/screens/Journal.test.tsx:675:19
    673|     renderJournal([makeHistoryTrade()]);
    674|
    675|     expect(screen.getByTestId("journal-mobile-root")).toBeDefined();
       |                   ^  (getElementError: journal-mobile-root not in DOM)

 Test Files  1 failed (1)
      Tests  1 failed | 2 passed | 19 skipped (22)
```

RED for the right reason — the mobile branch (`journal-mobile-root`) is absent because `Journal` still renders the desktop grid unconditionally. Tests 2 (stubbed desktop) and 3 (empty state) pass trivially pre-implementation since the desktop tree already renders those. After the switch + JournalMobile skeleton + test migration: **Journal.test.tsx 22/22 green, JournalContainer.test.tsx 3/3 green.**

## Files Created/Modified
- `apps/web/src/screens/journal-mobile/useJournalModel.tsx` - Shared model hook + exported helpers/stubs/RuleTagChips + TradeSummary (D-04). `.tsx` because helpers carry JSX.
- `apps/web/src/screens/journal-mobile/JournalMobile.tsx` - Mobile tree root: single useJournalModel consumer, empty state, `journal-mobile-root` container. Sections land in 36-04.
- `apps/web/src/screens/Journal.tsx` - Thin `useIsDesktop` switch + `JournalDesktop` (renamed body, model destructured to pre-extraction names → byte-identical JSX).
- `apps/web/src/screens/Journal.test.tsx` - 3 desktop describes migrated to `stubDesktopMatchMedia`; new "Journal branch — D-03/D-16 (36)" describe (3 J3 tests).
- `apps/web/src/screens/JournalContainer.test.tsx` - Added `stubDesktopMatchMedia` (deviation, below).

## Decisions Made
- **useJournalModel is `.tsx`** — the shared view helpers (HeadingPill, RuleTagChips, dashed stubs) carry JSX and are single-sourced here so the mobile tree imports the exact same components (the one deliberate deviation from the `useOverviewModel` `.ts` precedent, noted in the file header).
- **Destructure-into-locals in JournalDesktop** (the OverviewDesktop precedent) — keeps the JSX byte-identical and lets `const`-narrowing flow into the `onSave`/`onRetry` closures for `openEvent`/`closeEvent`, so no `!` is needed.
- **JournalMobile calls the model from day one** — even though the skeleton renders no sections, calling `useJournalModel(trades)` makes the mobile arm the single lifecycle/rule-tags consumer when it mounts (T-36-05 mitigation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JournalContainer.test.tsx desktop assertions broke under the new switch**
- **Found during:** Task 2 (full-suite gate)
- **Issue:** `JournalContainer.test.tsx` renders `<Journal>` and asserts the trade name (`SPX 7425P`) + `OPEN` badge — both desktop-tree-only affordances. The D-03 switch makes jsdom default to the empty `JournalMobile` skeleton (its trade list lands in 36-04), so these assertions failed. The plan enumerated the Journal.test.tsx migration but not this one.
- **Fix:** Added the same `stubDesktopMatchMedia()` helper + `beforeEach`/`afterEach` install-and-delete to the `JournalContainer` describe (the D-16 pattern). No source or assertion weakened.
- **Files modified:** apps/web/src/screens/JournalContainer.test.tsx
- **Verification:** `JournalContainer.test.tsx` 3/3 green under the stub.
- **Committed in:** `56a1e32` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a required test migration the switch surfaced).
**Impact on plan:** Necessary to keep the suite green (repo law: commit at green only). Journal-side file, no conflict with the parallel Analyzer executor. No scope creep.

## Issues Encountered
- **Full-workspace suite shows 1 failing file — `Analyzer.test.tsx` — which is the parallel executor's (plan 36-01) in-flight, uncommitted work** (Analyzer.tsx/Analyzer.test.tsx modified, analyzer-mobile/AnalyzerMobile.tsx untracked; their Task 52 switch/migration was mid-flight). None of my files are imported by Analyzer, so my changes cannot cause it. Every file in MY write set is green: Journal.test.tsx 22/22, JournalContainer.test.tsx 3/3, `bun run typecheck` clean, `bun run lint` clean (only pre-existing boundary/multi-project warnings). The Analyzer red resolves when the sibling executor lands its own D-01/D-16 migration.

## Next Phase Readiness
- 36-04 hangs off this branch + model: `JournalMobile` sections (TradeCard, MobileLifecycle, rail stack) consume `useJournalModel` slices; helpers/stubs/RuleTagChips are already single-sourced for import.
- D-17 desktop dead-branch cleanup (removing the Journal `lg:` mobile-flex arm on `journal-positions`) is deferred to the final phase task — the `lg:`-gated classes are still asserted by the migrated "mobile stack order" describe and remain correct pre-cleanup.

## Self-Check: PASSED

All created/modified files exist on disk; both task commits (`d7f5dd0`, `56a1e32`) are in the git log.

---
*Phase: 36-analyzer-journal-mobile-redesign*
*Completed: 2026-07-11*
