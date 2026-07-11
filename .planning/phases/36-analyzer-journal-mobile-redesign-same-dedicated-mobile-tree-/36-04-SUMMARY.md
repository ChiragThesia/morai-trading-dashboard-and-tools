---
phase: 36-analyzer-journal-mobile-redesign
plan: 04
subsystem: ui
tags: [react, mobile, journal, lifecycle, vitest, base-ui-dialog, visx]

# Dependency graph
requires:
  - phase: 36-03-journal-switch
    provides: Journal useIsDesktop switch + useJournalModel(trades) + single-sourced helpers/stubs/RuleTagChips
  - phase: 35.1-mobile-overview
    provides: dedicated-mobile-tree recipe + PositionCard idiom (focal value, one meta line)
provides:
  - JournalMobile TradeCard — single OPEN affordance / focal P&L, un-gated select (D-11)
  - JournalMobile trades section + History fold (D-11/D-15)
  - MobileLifecycle — masthead / honest states / 840px pan mount / ⋯ Rebuild demotion / Chart notes (D-12/D-13/D-14)
  - Mobile rail stack (PnlBridge→Edge→GreeksNow→Beats→Notes) with crosshair→bridge sync (D-15)
affects: [36-05-desktop-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Full-bleed horizontal pan mount: fixed w-[840px] chart inside overflow-x-auto, scrollLeft=scrollWidth on [trade.id, showChart] — designed-size labels, chart internals untouched (D-12)"
    - "Destructive-action demotion: reuse the existing confirm component verbatim inside a nested base-ui Dialog rather than re-implementing the gate (D-13)"
    - "Spy-wrap a child component via vi.mock importOriginal to assert a parent's callback wiring drives another child's props (crosshair→bridge)"

key-files:
  created:
    - apps/web/src/screens/journal-mobile/TradeCard.tsx
    - apps/web/src/screens/journal-mobile/TradeCard.test.tsx
    - apps/web/src/screens/journal-mobile/MobileLifecycle.tsx
  modified:
    - apps/web/src/screens/journal-mobile/JournalMobile.tsx
    - apps/web/src/screens/journal-mobile/JournalMobile.test.tsx

key-decisions:
  - "Pan-scroll layout effect keys on [trade.id, showChart] — fires scroll-to-latest on trade change AND when the chart first mounts after snapshots arrive, but never per snapshot poll (showChart stable true, trade.id stable) — satisfies T-36-08 while still landing at the latest days on first paint"
  - "TradeCard sign class derives from parseFloat(realizedPnl): finite→up/down, non-finite ('')→text-dim em-dash — same data path as desktop, no new fetch"
  - "MobileLifecycle takes onRetry/onCrosshairChange callbacks (desktop LifecycleSection parity) rather than raw refetch/setHoveredIndex — keeps the floating-promise void at the JournalMobile call site, no `!`"

requirements-completed: [MOBILE-12]

coverage:
  - id: J11
    description: "TradeCard — single OPEN affordance / focal sign-colored P&L, un-gated select (catch #23), selected ring, tags pill"
    requirement: "MOBILE-12"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/journal-mobile/TradeCard.test.tsx (6 pass)"
        status: pass
    human_judgment: false
  - id: J12
    description: "Trades section — cards above a folding History (auto-open when no open trades), tags pill on the selected card only"
    requirement: "MOBILE-12"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/journal-mobile/JournalMobile.test.tsx#J12 (4 pass)"
        status: pass
    human_judgment: false
  - id: J13
    description: "Lifecycle chart mounts at 840px inside an overflow-x-auto pan container; LifecycleChart.tsx zero diff"
    requirement: "MOBILE-12"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/journal-mobile/JournalMobile.test.tsx#J13a"
        status: pass
      - kind: grep
        ref: "git diff --quiet on the 7 reused journal components"
        status: pass
    human_judgment: false
  - id: J14
    description: "Honest states bare (no Panel); Rebuild demoted behind ⋯ 'Journal' dialog with the verbatim nested confirm; Chart notes disclosure closed with both footnotes; kind caption"
    requirement: "MOBILE-12"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/journal-mobile/JournalMobile.test.tsx#J14a-d (4 pass)"
        status: pass
    human_judgment: false
  - id: J15
    description: "Crosshair callback feeds PnlBridgeCard.hoveredIndex; rail stack mounts in order with the ENTER/EXIT/ROLL rule-tag blocks"
    requirement: "MOBILE-12"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/journal-mobile/JournalMobile.test.tsx#J15a/b (3 pass)"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-11
status: complete
---

# Phase 36 Plan 04: JournalMobile Tree Summary

**The full mobile Journal flow on the 36-03 foundation — PositionCard-idiom TradeCards (single OPEN/P&L affordance, un-gated select), a folding History, and MobileLifecycle with the D-12 840px full-bleed pan mount that kills the 60%-width bug, the ⋯-demoted Rebuild (verbatim confirm), a Chart-notes disclosure, and the verbatim crosshair-synced rail — all J11–J15 jsdom-green with LifecycleChart provably untouched.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 3
- **Files:** 5 (3 created, 2 modified)

## Accomplishments

- **TradeCard (D-11, J11):** kills the desktop triple affordance (OPEN badge + status text + history chip) for ONE focal signal — the OPEN badge for open trades or the 16px sign-colored realized P&L for closed ones — over a single muted meta line. The pre-Jun-12 fact the dead chip carried survives as a ` · entry/exit only` text suffix. Whole-card `role="button"` fires select on click/Enter/Space, never gated on `hasSnapshots` (catch #23). `rule-tags-pill` retained for the selected trade (D-22).
- **Trades section (D-11/D-15, J12):** `Trades` SectionLabel + `SPXW put calendars` HeadingPill; open cards render above the `History (N)` toggle; the fold is real React state (`aria-expanded`, catch #24) that auto-opens when there are no open trades.
- **MobileLifecycle (D-12/D-13/D-14, J13/J14):**
  - **D-12 pan mount:** `LifecycleChart` mounts at its designed `w-[840px]` inside a full-bleed `overflow-x-auto` container in a `px-0` section, a layout effect scrolling it to the latest snapshots on mount / trade change — killing the `xMinYMin meet` 60%-width bug **without touching a single chart internal** (zero-diff gate green).
  - **D-13 Rebuild demotion:** `RebuildButton` renders NOWHERE in the top-level flow; a `⋯` ("More journal actions") ghost button opens a `Journal` dialog that holds it verbatim — its own nested confirm ("This overwrites all snapshot history.") intact (T-36-07 mitigation, J14b asserts the confirm copy renders).
  - **Honest states** (loading skeleton / error+Retry / PreHistoryStub / BuildingLifecycleStub) render bare — no `Panel` wrapper (asserted via no `from-panel` ancestor).
  - **D-14 Chart notes:** the two attribution/feed-gap footnotes live behind a closed `<details>` under the `‹ swipe for earlier days` pan hint — both present only in the history-with-chart state.
- **Rail stack (D-15, J15):** `PnlBridgeCard → EdgeCard → GreeksNowCard → BeatsCard → Notes` mount in order, the Notes ENTER/EXIT/ROLL `RuleTagChips` blocks + textarea duplicated verbatim from the desktop rail. The hero-chart crosshair feeds `PnlBridgeCard.hoveredIndex` through the model's `setHoveredIndex` (proven by spy-wrapping both components).

## Task Commits

1. **Task 1: TradeCard — PositionCard idiom, single OPEN affordance (D-11)** — `6fa39ea` (feat)
2. **Task 2: JournalMobile trades section — cards + History fold (D-11)** — `f2bfc77` (feat)
3. **Task 3: MobileLifecycle pan mount + ⋯ Rebuild demotion + rail stack (D-12/D-13/D-14/D-15)** — `818fb6d` (feat)

_All three followed TDD red→green (assertion-level RED shown per task below), committed at green._

## RED Run Outputs

**Task 1 (TradeCard):** after a render-nothing stub, all 6 J11 tests failed at assertion level — `Unable to find an element by: [data-testid="rule-tags-pill"]` (and siblings), against a `<div />`. GREEN after the real card: **6/6**.

**Task 2 (trades section):** against the 36-03 empty skeleton, 3 of 4 J12 tests failed (`Unable to find [data-testid="trade-card-…"]`); the empty-state test passed trivially (skeleton already renders it). GREEN after the section: **4/4**.

**Task 3 (MobileLifecycle + rail):** with the trades section but no lifecycle/rail, the 8 new J13/J14/J15 tests failed at assertion level (`lifecycle-pan` / `More journal actions` / `Chart notes` / `P&L bridge…` / `ROLL` all absent) while the 4 J12 stayed green. GREEN after MobileLifecycle + the rail: **12/12**.

## Verification Evidence

- `bunx vitest run TradeCard.test.tsx` → **6/6**; `JournalMobile.test.tsx` → **12/12**.
- `bunx vitest run Journal.test.tsx` (desktop guard, unmodified) → **22/22**.
- **Zero-diff gate:** `git diff --quiet` on `LifecycleChart / LifecycleMasthead / PnlBridgeCard / EdgeCard / GreeksNowCard / BeatsCard / RebuildButton` → **PASS** (all seven untouched across the plan's three commits).
- `bun run test` (full workspace) → **303 files / 3374 tests passed**.
- `bun run typecheck` → clean. `bun run lint` → the three journal-mobile files are clean (see Issues for the one out-of-scope sibling finding).

## Files Created/Modified

- `apps/web/src/screens/journal-mobile/TradeCard.tsx` — the mobile trade card (D-11), imports `fmtDate`/`fmtPnl` from the model and `classifyTradeHistory` (never re-implemented).
- `apps/web/src/screens/journal-mobile/TradeCard.test.tsx` — J11 coverage, fully controlled (no provider).
- `apps/web/src/screens/journal-mobile/MobileLifecycle.tsx` — masthead / states / 840px pan mount / ⋯ Rebuild / Chart notes.
- `apps/web/src/screens/journal-mobile/JournalMobile.tsx` — trades section + MobileLifecycle + rail stack wired from the shared model.
- `apps/web/src/screens/journal-mobile/JournalMobile.test.tsx` — J12–J15 (spy-wraps LifecycleChart + PnlBridgeCard via importOriginal; `vi.clearAllMocks` keeps the spy implementations, the Overview precedent).

## Decisions Made

- **Pan-scroll effect deps `[trade.id, showChart]`** — the plan said "mount / trade change (not per poll)". `showChart` flips false→true exactly once when snapshots first arrive, so adding it fires the scroll-to-latest when the chart actually mounts (not just on the initial empty render) while snapshot polls — which keep `showChart` true and `trade.id` stable — never re-thrash it. T-36-08 mitigation preserved.
- **`MobileLifecycle` takes `onRetry` / `onCrosshairChange` callbacks** (desktop `LifecycleSection` parity) rather than raw `refetch` / `setHoveredIndex` — the floating-promise `void refetch()` stays at the JournalMobile call site, no `!`, no floating promise inside the component.
- **`DIALOG_TITLE_CLASS` defined locally** in MobileLifecycle (a one-line class string) rather than exported from `MobileChartControls` — avoids a cross-module coupling for a constant, same value.

## Deviations from Plan

None — the plan executed as written. The two implementation choices above (effect deps, callback props) are clarifications of the plan's indicative prop naming / "mount-or-trade-change" wording, not behavior changes; both are covered by the plan's own contracts (T-36-08, J15).

## Issues Encountered

- **`bun run lint` reports 1 error in `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx` (a type assertion) — the parallel 36-02 executor's in-flight, uncommitted file, NOT in my write set.** My three journal-mobile files lint clean (`bun run lint` filtered for journal-mobile/MobileLifecycle/TradeCard → no findings). This is the wave-2 sibling's Analyzer half (analyzer-mobile/* modified + `MobileAnalyzerChart.tsx` untracked); it resolves when that executor lands its own green commit. Out of scope per the plan's exclusive write set (`journal-mobile/*`). The full vitest suite is green (3374/3374) because the assertion is a lint rule, not a runtime failure.

## Known Stubs

None — every value in the mobile tree flows from `useJournalModel` (the real `useLifecycle`/`useRuleTags` slices); no hardcoded empty/placeholder data, no "coming soon" copy.

## Self-Check: PASSED

- Created files exist on disk: `TradeCard.tsx`, `TradeCard.test.tsx`, `MobileLifecycle.tsx` — all FOUND.
- All three task commits present in the git log: `6fa39ea`, `f2bfc77`, `818fb6d` — all FOUND.

---
*Phase: 36-analyzer-journal-mobile-redesign*
*Completed: 2026-07-11*
