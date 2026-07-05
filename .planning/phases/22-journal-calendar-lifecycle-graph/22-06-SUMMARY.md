---
phase: 22-journal-calendar-lifecycle-graph
plan: 06
subsystem: ui
tags: [react, react-query, screen-integration, jrnl-01]

# Dependency graph
requires:
  - phase: 22-journal-calendar-lifecycle-graph
    provides: "22-03's GET /api/journal/:calendarId/lifecycle route + lifecycleResponse contract"
  - phase: 22-journal-calendar-lifecycle-graph
    provides: "22-04's useLifecycle hook + LifecycleMasthead/EdgeCard/GreeksNowCard/PnlBridgeCard/BeatsCard rail components"
  - phase: 22-journal-calendar-lifecycle-graph
    provides: "22-05's LifecycleChart D-08 stacked-panel rewrite + onCrosshairChange callback"
provides:
  - "Journal screen (apps/web/src/screens/Journal.tsx) rewired end-to-end: useLifecycle data source, masthead + chart center column, reactive rail right column"
  - "Shared hoveredIndex crosshair-sync state lifted to the screen level"
  - "Honest too-new + error states with a working Retry, and an always-visible honest-caveats footer"
  - "Locally-derived beats array (entry/event-move/close) feeding BeatsCard"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Screen-level shared crosshair state: LifecycleChart.onCrosshairChange -> setHoveredIndex -> PnlBridgeCard.hoveredIndex"
    - "Honest-state branching (isPending / isError / kind==='entry-exit-only' / kind==='history'&&len<=1 / kind==='history'&&len>1) computed once, rendered exclusively"
    - "beats derived locally in the mounting screen from trade.openedAt/closedAt + snapshot.trigger==='event-move', BeatsCard stays presentational"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Journal.tsx
    - apps/web/src/screens/Journal.test.tsx
    - apps/web/src/screens/JournalContainer.test.tsx
    - apps/web/src/components/LifecycleChart.tsx

key-decisions:
  - "LifecycleMasthead has no `trade` prop (only `snapshots` + optional `eyebrow`) despite the plan's action text showing `trade={trade}` — read the actual 22-04 component signature and passed a computed `eyebrow` string (trade name + date range) instead of guessing a nonexistent prop."
  - "Removed the duplicate honest-caveats footer that 22-05 had already baked into LifecycleChart.tsx itself (Rule 1 bug: it only appeared when the chart rendered, never during pre-history/too-new/error states, and duplicated the new always-visible Journal.tsx footer verbatim when both were showing)."
  - "Task 1 and Task 2 land in a single feat commit (not two) because they share the same file's imports, the lifted hoveredIndex state, and the snapshots/beats derivations — splitting them would require reconstructing an artificial intermediate state with no additional evidence value, the same reasoning 22-05 documented for its own two-task combination."
  - "Journal.test.tsx and JournalContainer.test.tsx are updated in the same commit as the screen rewrite: both mocked the now-unused useJournal hook, so a screen-only commit would leave an intermediate red suite, which the project's TDD rule (commit only at green) forbids."

requirements-completed: [JRNL-01]

coverage:
  - id: D1
    description: "Selecting a calendar renders its lifecycle (masthead + stacked chart + reactive rail) from the enriched useLifecycle series"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal screen > renders the lifecycle masthead + chart + reactive rail for a history-eligible trade"
        status: pass
    human_judgment: false
  - id: D2
    description: "The hero chart's crosshair and the rail P&L bridge are synced via a shared hoveredIndex"
    requirement: JRNL-01
    verification: []
    human_judgment: true
    rationale: "The wiring (onCrosshairChange -> setHoveredIndex -> PnlBridgeCard.hoveredIndex) is unit-verified per-component in 22-04/22-05 (LifecycleChart fires onCrosshairChange; PnlBridgeCard reacts to hoveredIndex), but the live pointer-drag-across-the-hero-chart-updates-the-bridge behavior in the assembled screen needs the phase-gate chrome-devtools UAT this plan's own <verify> block reserves for it — no jsdom pointer-event test was added at the screen level (mirrors 22-05's own jsdom PointerEvent gap)."
  - id: D3
    description: "Honest states: 'Building the lifecycle' too-new copy, unchanged PreHistoryStub, error state with Retry, always-visible honest-caveats footer; no SKETCH tag ships"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal screen > renders entry/exit-only badge and 'no day-by-day (pre Jun-12)' stub for a pre-Jun-12 trade (JOURNAL-01)"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal screen > shows the error state with a working Retry button when the lifecycle fetch fails"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal screen > renders the lifecycle masthead + chart + reactive rail for a history-eligible trade"
        status: pass
    human_judgment: false
  - id: D4
    description: "The existing RULE-01 Notes card is relocated to the bottom of the rail, visually unchanged"
    requirement: JRNL-01
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx#Journal screen — rule-tag control (RULE-01) (all 8 tests, unchanged assertions)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual fidelity of the assembled screen (masthead + stacked chart + rail proportions, real production data) against the D-08 mockup"
    human_judgment: true
    rationale: "Component-level and screen-level unit tests confirm structure, hook wiring, and honest-state branching, but final visual composition inside the live 3-column layout with real production data is the phase-gate chrome-devtools UAT this plan's own <verify> block reserves — not this plan's scope to self-certify."
    verification: []

# Metrics
duration: 55min
completed: 2026-07-05
status: complete
---

# Phase 22 Plan 06: Journal Screen Integration Summary

**Rewired the Journal screen's center and right columns to the enriched `useLifecycle` series — masthead + D-08 stacked chart in the center, a crosshair-reactive P&L bridge / edge / greeks-now / beats rail on the right, honest too-new/error states, and a relocated RULE-01 Notes card — closing out JRNL-01.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-05T14:05:00Z
- **Completed:** 2026-07-05T15:00:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 (1 screen rewrite, 2 test files, 1 one-line dedup fix in a sibling component)

## Accomplishments

- `Journal.tsx` now calls `useLifecycle(calendarId)` instead of `useJournal`, with a
  `LifecycleResponse["snapshots"]`-typed series flowing into every consumer.
- A single `hoveredIndex` state, lifted to the screen, connects `LifecycleChart`'s
  `onCrosshairChange` (center) to `PnlBridgeCard`'s `hoveredIndex` prop (rail) — hovering
  the hero chart re-renders the bridge's "as of {day}" totals.
- Center column: `LifecycleMasthead` (verdict + read + net P&L) replaces the old trade-
  header Panel + 3-KPI grid; the chart card keeps `RebuildButton`; a new "Building the
  lifecycle." too-new state and a new error state (Retry wired to `refetch`) round out the
  honest-state branching alongside the unchanged `PreHistoryStub` and loading skeleton.
- An always-visible honest-caveats footer renders below the chart card in every state
  (loading excepted only by virtue of the skeleton occupying that space) — the mockup's
  "SKETCH · representative data" tag is not shipped.
- Right column: the snapshot table and the static "Why it moved" callout are retired;
  the rail now renders `PnlBridgeCard` → `EdgeCard` → `GreeksNowCard` → `BeatsCard`, in
  that order, followed by the relocated (unchanged) RULE-01 Notes card.
- `beats` is derived locally in the screen: an entry beat from `openedAt`, one event beat
  per snapshot where `trigger === "event-move"`, and a close beat from `closedAt` when the
  trade is closed — never fabricated.

## Task Commits

Both tasks landed in one `feat` commit (see Decisions Made for why), preceded by an
isolated `fix` commit for a duplicate-footer bug discovered while doing Task 1:

1. **Bug fix discovered during Task 1** — `c710402` — `fix(22-06): remove duplicate
   honest-caveats footer from LifecycleChart (JRNL-01)`
2. **Task 1 + Task 2 (combined — see Decisions Made)** — `959ca4a` — `feat(22-06): rewire
   Journal screen to useLifecycle with masthead, honest states, and reactive rail
   (JRNL-01)`

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/screens/Journal.tsx` — center column rewired to `useLifecycle` +
  `LifecycleMasthead` + honest states + footer; right column rewired to the four rail
  cards + relocated Notes; `SnapshotTable` deleted (orphaned); `hoveredIndex` lifted;
  `beats` derived locally.
- `apps/web/src/screens/Journal.test.tsx` — mocks `useLifecycle` instead of `useJournal`;
  `makeSnapshot` fixture enriched with `isGap`/`forwardVol`/`forwardVolGuard`/cumulative
  attribution buckets/optional `trigger`; the removed snapshot-table assertions are
  replaced with rail-card + footer assertions; a new error+Retry test added.
- `apps/web/src/screens/JournalContainer.test.tsx` — mock updated from `useJournal` to
  `useLifecycle` (same shape, `isError`/`refetch` added) to match the new hook the screen
  actually calls; no behavioral assertions changed (this file doesn't touch the rail).
- `apps/web/src/components/LifecycleChart.tsx` — removed a footer paragraph 22-05 had
  already baked into the component (see Deviations).

## Decisions Made

- **`LifecycleMasthead` prop mismatch (Rule 3 — blocking, no `trade` prop exists):** the
  plan's Task 1 action text shows `<LifecycleMasthead snapshots={snapshots} trade={trade} />`,
  but 22-04's actual component only accepts `snapshots` and an optional `eyebrow:
  ReactNode`. Per the prior-wave-context instruction to read each component's real prop
  signature rather than guess, I computed an `eyebrow` string (`"{trade.name} ·
  {openedAt} → {closedAt|"(open)"}"`) and passed that instead — this is the closest match
  to the plan's evident intent (surface the trade descriptor above the verdict) without
  inventing a prop the component doesn't have.
- **Combined commit for Task 1 + Task 2:** both tasks touch the same file's imports, the
  lifted `hoveredIndex` state, and the `snapshots`/`beats` derivations. Splitting them
  would require reconstructing an artificial intermediate state with no additional
  evidence value — the same reasoning 22-05 documented for its own two-task combination.
- **Test files land in the same commit as the screen rewrite:** `Journal.test.tsx` and
  `JournalContainer.test.tsx` both mock `useJournal`, which the rewritten screen no
  longer imports at all. A screen-only commit would leave the suite red at that commit,
  which the project's TDD rule ("commit only at green") forbids — so the screen and its
  test updates are one commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate honest-caveats footer between `LifecycleChart` and `Journal.tsx`**
- **Found during:** Task 1 (adding the always-visible honest-caveats footer to
  `LifecycleSection`)
- **Issue:** 22-05's `LifecycleChart.tsx` already rendered its own copy of the exact
  same "Attribution is a 2nd-order approximation… / Line breaks are real feed gaps…"
  text, but only when the chart itself renders (`kind === "history" && snapshots.length >
  1`) — never during the pre-history, too-new, or error states this plan's UI-SPEC
  requires it in every state. Once this plan's Task 1 added the real always-visible
  footer to `Journal.tsx`, the two copies rendered together whenever the chart was
  showing, producing literally duplicated text on screen (surfaced as a
  `getMultipleElementsFoundError` in `Journal.test.tsx`).
- **Fix:** Removed the footer block from `LifecycleChart.tsx` (14 lines), leaving
  `Journal.tsx`'s footer as the single source of truth, present in every honest state as
  the UI-SPEC requires.
- **Files modified:** `apps/web/src/components/LifecycleChart.tsx`.
- **Verification:** No test in `LifecycleChart.test.tsx` asserted the removed text
  (confirmed via `rg`); whole-repo `bun run typecheck` / `bun run lint` /
  `bunx vitest run` all stayed green after the removal, both in isolation and combined
  with the rest of this plan's changes.
- **Committed in:** `c710402` (separate `fix` commit, landed before the `feat` commit
  since it alone doesn't disturb any existing assertion).

**2. [Rule 3 - Blocking] `Journal.test.tsx` / `JournalContainer.test.tsx` still mocked the
retired `useJournal` hook**
- **Found during:** Task 1 (swapping `useJournal` → `useLifecycle` at the screen's call
  site immediately broke both test files' mocks, since `Journal.tsx` no longer imports
  `useJournal` at all).
- **Issue:** With `useJournal` unmocked/uncalled, react-query's real `useLifecycle` hook
  fired inside the test render (guarded by `enabled: !!calendarId`, so only when a trade
  is selected), hitting the tests' already-mocked-but-unimplemented `apiFetch` and
  leaving the screen stuck in a perpetual pending/error state regardless of the intended
  fixture — none of the old assertions (snapshot table headers, "Lifecycle" panel
  heading) could pass.
- **Fix:** Retargeted both files' `vi.mock` calls to `useLifecycle`, enriched the
  snapshot fixture with the new contract fields, and replaced the retired
  snapshot-table/"why it moved" assertions with assertions against the new rail cards,
  the honest-caveats footer, and a new error+Retry test.
- **Files modified:** `apps/web/src/screens/Journal.test.tsx`,
  `apps/web/src/screens/JournalContainer.test.tsx`.
- **Verification:** `bunx vitest run apps/web/` — 42 files / 443 tests, all pass.
- **Committed in:** `959ca4a` (same commit as the screen rewrite — see Decisions Made for
  why these couldn't be split into an intermediate red commit).

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking). No scope creep —
both were direct, necessary consequences of this plan's own changes.
**Impact on plan:** No behavior change beyond what the plan specified; both fixes are
internal (duplicate-text removal, test-mock retargeting) and don't alter the rendered
rail/chart contract.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The Journal screen renders the full JRNL-01 experience end to end: left picker →
  center masthead + stacked chart → reactive rail, with honest states and the relocated
  Notes card. Whole-monorepo `bun run typecheck` (clean), `bun run lint` (clean), and
  `bun run test` (2080/2080 passing across 217 files) all confirm no regressions.
- Two items remain for the phase-gate chrome-devtools UAT this plan's own `<verify>`
  block explicitly reserves for human judgment (not this plan's scope to self-certify):
  the live crosshair-hover-updates-the-P&L-bridge interaction, and visual fidelity of the
  stacked chart + rail against the D-08 mockup with real production data.
- No blockers for closing out Phase 22.

## Self-Check

- `apps/web/src/screens/Journal.tsx` — FOUND
- `apps/web/src/screens/Journal.test.tsx` — FOUND
- `apps/web/src/screens/JournalContainer.test.tsx` — FOUND
- `apps/web/src/components/LifecycleChart.tsx` — FOUND
- Commit `c710402` — FOUND in `git log`
- Commit `959ca4a` — FOUND in `git log`

---
*Phase: 22-journal-calendar-lifecycle-graph*
*Completed: 2026-07-05*

## Self-Check: PASSED
