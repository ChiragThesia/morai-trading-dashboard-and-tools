---
phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
plan: 02
subsystem: ui
tags: [react, table, sort, analyzer, picker]

requires:
  - phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
    provides: "41-01's live-aware spot seam + liveBadgeProps/LiveStatusBadge mount in the Risk-profile header (untouched by this plan)"

provides:
  - "CandidateRail's desktop populated body is a native <table> (Score/Calendar/Debit/Theta/Event/Combine columns) replacing the 17-CandidateCard scroll rail"
  - "Score/Debit/Theta columns are client-sort-only (desc-default, click cycles desc<->asc) via local AnalyzerDesktop state (CandidateSortState), never the shared useAnalyzerModel hook"
  - "CandidateRail's Panel wrapper is max-h-[70vh] overflow-y-auto with a sticky thead, killing the 3,274px dead-column page-height defect"
  - "A second Combine affordance in the Risk-profile header (detail-combine) lets the SELECTED candidate self-toggle into the combined book, alongside the per-row Combine cell for non-selected rows"

affects: [41-03, 41-04, 41-05]

tech-stack:
  added: []
  patterns:
    - "Native <table> row/action-cell stopPropagation pattern ported from Overview.tsx's positions table (td onClick stops before it reaches the tr's onSelect)"
    - "Sort state lives in the view component (AnalyzerDesktop), not the shared model hook, since the mobile tree has no table (D-03/OQ2)"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx

key-decisions:
  - "Copy TOS order is no longer a per-row affordance — the UI-SPEC Table Contract only lists a Combine (⊕) action cell. The pre-existing 'a rail card's Copy copies that specific candidate' test was retargeted to select a row then click the existing detail-pane copy-tos-order button, preserving the per-candidate-copy assertion intent without a dropped affordance."
  - "Dropped observedAt/source/gexContextStatus/eventsContextStatus/copiedId/onCopy from CandidateRailProps — the Table Contract's rows carry no staleness dot, GEX/events guard tags, or per-row Copy (UI-SPEC explicitly moves the as-of provenance to the future Verdict Hero footer, a 41-03 concern); keeping these props on CandidateRail would have been dead code this plan's own change orphaned."
  - "PASTED pill and the numeric score render independently in the Score cell (pasted-and-scored rows show both, matching CandidateCard.tsx's own pattern) — only Debit/Theta gate strictly on breakdown.length===0, per the Table Contract's 'Not-scored (pasted, unscored)' row state."

requirements-completed: [AUI-01, AUI-03]

coverage:
  - id: D1
    description: "Ranked table replaces the CandidateCard rail — one row per candidate, score-desc default, pasted rows pinned above unsorted"
    requirement: "AUI-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — ranked candidate table (Phase 41, AUI-01/AUI-03) — renders one row per fixture candidate, ordered score-descending by default"
        status: pass
    human_judgment: false
  - id: D2
    description: "Row click selects (same onSelect/selectedId as the old cards); the ⊕ action cell stopPropagations so Combine never also selects"
    requirement: "AUI-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — ranked candidate table (Phase 41, AUI-01/AUI-03) — clicking a different row updates the selected candidate / the ⊕ cell toggles Combine without changing the current row selection (stopPropagation)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Score/Debit/Theta headers sort with aria-sort + desc<->asc cycling; pasted rows never re-sort"
    requirement: "AUI-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — ranked candidate table (Phase 41, AUI-01/AUI-03) — clicking the Debit header sorts rows by debit descending and sets aria-sort on that column only / clicking the same header again flips the direction"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pasted-unscored row shows the PASTED pill and — (never a fabricated $0) in Debit/Theta"
    requirement: "AUI-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#CandidateRail — direct-render states (Phase 41, D-18) — a pasted, unscored candidate shows the PASTED pill and — for the Debit/Θ cells"
        status: pass
    human_judgment: false
  - id: D5
    description: "CandidateRail Panel is bounded (max-h-[70vh] overflow-y-auto) with a sticky thead — kills the dead-column page-height defect (AUI-03)"
    requirement: "AUI-03"
    verification: []
    human_judgment: true
    rationale: "Sticky/max-height are CSS-only layout effects jsdom cannot observe (per this plan's own <verification> note) — needs the phase-gate visual UAT (plan 41-05) to confirm no dead columns / content-driven page height in a real browser."
  - id: D6
    description: "Whole Analyzer.test.tsx suite (66 tests) exercises the new table DOM — no retired candidate-card-* testid remains anywhere in the file"
    verification:
      - kind: unit
        ref: "bun run test apps/web/src/screens/Analyzer.test.tsx (66/66 pass); grep -n \"candidate-card\" returns 0 matches"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-07-14
status: complete
---

# Phase 41 Plan 02: Ranked candidate table + sticky bounded Panel Summary

**Replaced the 17-CandidateCard scroll rail with a native sortable `<table>` (Score/Calendar/Debit/Θ/Event/Combine columns) inside a `max-h-[70vh] overflow-y-auto` Panel with a sticky header, and migrated all 66 Analyzer.test.tsx tests off the retired card DOM.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `CandidateRail`'s populated body is now a `<table>`: Score (tier-colored, PASTED pill for unscored pasted rows), Calendar (verbatim name), Debit (`$Math.round`), Θ/d (sign-colored), Event (amber `⚡` pill with `+N` for multiple events), and a narrow ⊕ action column with a visually-hidden "Combine" `<th>` label.
- Score/Debit/Θ headers are `cursor-pointer` with `aria-sort` + a `▲`/`▼` glyph on the active column; clicking cycles that column desc→asc→desc via local `AnalyzerDesktop` sort state (`CandidateSortState`, never the shared `useAnalyzerModel` hook — mobile keeps `CandidateCard`, no table there).
- Pasted rows render as a separate pinned group above scored rows in paste order, always unsorted, each carrying the existing `×` remove button beside its ⊕ cell.
- The row's selected-tint (`bg-violet/[0.06] border-l-2 border-l-violet`) and the ⊕ cell's `stopPropagation` port `CandidateCard.tsx`'s own tint/Combine pattern and Overview.tsx's `td onClick={stopPropagation}` action-cell precedent respectively.
- `CandidateRail`'s `Panel` wrapper is `max-h-[70vh] overflow-y-auto` with a `sticky top-0 z-10 bg-panel` `<thead>` — bounds the left column's own height so the 3-column grid row is only ever as tall as the taller of the capped table or the center/right stack, eliminating the previous 3,274px dead-column page height.
- A second Combine button (`detail-combine`) now sits in the center "Risk profile" panel header next to Copy TOS order, letting the currently-SELECTED candidate self-toggle into the combined book — the per-row ⊕ only ever targets non-selected rows.
- Swept every remaining `candidate-card-*` testid and `"⊕ Combine"`/`"✓ Combined"` text lookup across the rest of Analyzer.test.tsx (per-candidate scoring checklist, payoff center, right column, pasted calendars, copy TOS order, live-data populated) onto `candidate-row-*`/`combine-*` testids — the whole 66-test file now exercises the real table DOM, not a retired testid.

## Task Commits

Each task was committed atomically:

1. **Task 1: Ranked sortable table + sticky bounded Panel (CandidateRail body)** - `667ffa3` (feat)
2. **Task 2: Migrate the card-click test blocks across the rest of Analyzer.test.tsx** - `1e9a3fa` (test)

_Single commit per task (matching plan 41-01's precedent) — each task's test rewrite and the corresponding production change were verified together (RED confirmed via the pre-Task1 card-based tests failing against the new table DOM, GREEN via the full 66/66 pass) before committing._

## Files Created/Modified
- `apps/web/src/screens/Analyzer.tsx` - `CandidateRail`'s card list replaced with a `<table>` (`CandidateRow`/`SortableHeader` helpers, `CandidateSortState`/`cycleSort`/`sortCandidates`); `AnalyzerDesktop` gained local sort state + a `sortedRows` memo + the detail-pane Combine button; `CandidateCard` import removed (mobile's own import in `AnalyzerMobile.tsx` is untouched)
- `apps/web/src/screens/Analyzer.test.tsx` - rail-scoped describe blocks rewritten for the table (row testids, sort headers, ⊕ stopPropagation, pasted-unscored dashes); every other card-based describe block (scoring checklist, payoff center, right column, pasted calendars, copy-out, live-data) swept onto row/combine testids

## Decisions Made
- Copy TOS order dropped from the table entirely (Table Contract only specs a Combine action cell) — the "rail card Copy" test was retargeted to select-then-detail-Copy rather than deleted, keeping its per-candidate-wiring assertion alive.
- `observedAt`/`source`/`gexContextStatus`/`eventsContextStatus`/`copiedId`/`onCopy` removed from `CandidateRailProps` — the table renders none of the staleness dot, GEX/events guard tags, or per-row Copy those props existed for; carrying them forward as dead props would violate this repo's "remove only what your change made unused" rule. The as-of provenance UI-SPEC promises for the footer is a 41-03 concern (Verdict Hero), not this component.
- Score cell renders PASTED pill and numeric score independently (both show when a pasted candidate is also scored) — ported verbatim from `CandidateCard.tsx`'s own `{pasted && ...}` / `{breakdown.length > 0 && ...}` pair rather than gating PASTED on the notScored flag, which would have hidden the pill on a scored-pasted row and broken the existing "provenance kept even though it's scored" test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 2's read_first list undercounted one card-click describe block**
- **Found during:** Task 2 full-suite run
- **Issue:** The plan's Task 2 `<read_first>` named 6 describe blocks to sweep, but "Analyzer — per-candidate scoring checklist" (a 7th block, clicking `candidate-card-${GUARD.id}`) also broke once Task 1 landed the table — exactly the "test-migration undercounted" failure mode the plan's own RESEARCH Pitfall 5 warned about.
- **Fix:** Migrated that block's guard-candidate click to `candidate-row-${GUARD.id}` alongside the six named blocks.
- **Files modified:** `apps/web/src/screens/Analyzer.test.tsx`
- **Verification:** Full 66/66 suite green; `grep -n "candidate-card"` returns zero matches.
- **Committed in:** `1e9a3fa` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a test left broken by Task 1's table swap, outside the plan's own named list but required for the file-wide green-suite done criteria)
**Impact on plan:** No scope creep — same migration pattern already applied to the six named blocks, just one more instance of it.

## Issues Encountered
None beyond the deviation above.

## Next Phase Readiness
- The table/sort/bounded-Panel foundation (AUI-01/AUI-03) is in place for 41-03's Verdict Hero work, which will also need to land the as-of provenance footer this plan deliberately did not carry forward onto the table rows.
- Sticky-header/bounded-height layout behavior is CSS-only and unverified by jsdom — flagged as `human_judgment: true` in this SUMMARY's coverage block for the phase-gate visual UAT (plan 41-05).
- No blockers for 41-03.

---
*Phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar*
*Completed: 2026-07-14*
