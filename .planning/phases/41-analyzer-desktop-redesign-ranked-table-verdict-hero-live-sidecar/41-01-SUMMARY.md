---
phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar
plan: 01
subsystem: ui
tags: [react, sse, useLiveStream, analyzer, live-data]

requires:
  - phase: 38-stream-watchdog-live-spot-and-indices
    provides: useLiveStream hook + LiveStatusBadge component + the LIVE-04 live-aware-spot seam pattern (useOverviewModel)

provides:
  - "useAnalyzerModel.spot is live-aware: liveStatus==='live' && liveSpot!==null -> liveSpot, else snapshot.spot, else 0"
  - "useAnalyzerModel exposes liveBadgeProps (6-field object) for LiveStatusBadge consumers"
  - "LiveStatusBadge mounted in the desktop Risk-profile header and the mobile chart chrome row"

affects: [41-02, 41-03, 41-04, 41-05]

tech-stack:
  added: []
  patterns:
    - "LIVE-04 live-aware-spot seam ported from useOverviewModel to useAnalyzerModel (identical double-gate: status==='live' && liveSpot!==null)"

key-files:
  created:
    - apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts
  modified:
    - apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx
    - apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx
    - apps/web/src/screens/analyzer-mobile/MobileAnalyzerChart.tsx

key-decisions:
  - "Kept the LiveStatusBadge in its own row above MobileChartControls in MobileAnalyzerChart rather than editing the shared MobileChartControls.tsx component (which Overview also consumes) — smaller diff, no risk to Overview's chrome."
  - "Desktop badge placed outside the `selected !== null` guard in the Risk-profile header — stream health is not gated on a selected candidate."

requirements-completed: [AUI-07, AUI-06]

coverage:
  - id: D1
    description: "useAnalyzerModel.spot is live-aware with the catch #26 double-gate (never a frozen live value shown as fresh)"
    requirement: "AUI-07"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts#useAnalyzerModel — live-aware spot seam (AUI-07, D-07 port of LIVE-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "LiveStatusBadge mounted on both the desktop Risk-profile header and the mobile chart chrome row"
    requirement: "AUI-06"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — desktop LiveStatusBadge (Phase 41, AUI-07)"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx#AnalyzerMobile — LiveStatusBadge in the chart chrome row (Phase 41)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pre-existing Analyzer.test.tsx + AnalyzerMobile.test.tsx suites stay green (no real EventSource opened)"
    verification:
      - kind: unit
        ref: "bun run test apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile (97 tests)"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-07-14
status: complete
---

# Phase 41 Plan 01: Live sidecar spot seam + LiveStatusBadge Summary

**Ported Phase 38's LIVE-04 live-aware-spot seam onto the Analyzer's `useAnalyzerModel` and mounted `LiveStatusBadge` on both the desktop Risk-profile header and the mobile chart chrome row.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 completed
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments
- `useAnalyzerModel.spot` now reads the live SPX tick (`useLiveStream().liveSpot`) while the sidecar stream is live, falling back to the 30-min snapshot spot otherwise — the exact double-gate law from Overview (`status==="live" && liveSpot!==null`), so a frozen/stalled stream never shows as fresh (catch #26).
- `useAnalyzerModel` exposes `liveBadgeProps` (status/lastTickAt/isRth/hasReceivedFirstTick/isReconnecting/onReconnect), the same 6-field shape `useOverviewModel`/`LiveStatusBadge` already use.
- The score/verdict path (`candidate.score`/`breakdown`/`theta`/`vega`/`debit`) takes zero live input — only the source of `spot` changed, and `spot` only feeds the existing `params`/`payoffDomain`/`scenarioResult` memo chain that already fed `PayoffChart`.
- `LiveStatusBadge` now renders in the desktop "Risk profile" panel header (next to the Copy TOS order button, outside the `selected !== null` guard) and in the mobile `MobileAnalyzerChart`'s chrome row.

## Task Commits

Each task was committed atomically:

1. **Task 1: Live-aware spot seam + liveBadgeProps in useAnalyzerModel (LIVE-04 port)** - `ea6e1f3` (feat)
2. **Task 2: Mount LiveStatusBadge — desktop Risk-profile header + mobile chart chrome row** - `0e2af80` (feat)

_No separate TDD-cycle commits — each task's test file was written and run RED before the implementation change, then committed together with the passing suite (matching this plan's existing single-commit-per-task convention, not the strict RED-commit/GREEN-commit split)._

## Files Created/Modified
- `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts` - live-aware `spot` ternary + `liveBadgeProps` field/return
- `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.test.ts` (new) - 5-case live-seam suite mirroring `useOverviewModel.test.ts`
- `apps/web/src/screens/Analyzer.tsx` - imports `LiveStatusBadge`, destructures `liveBadgeProps`, mounts badge in the Risk-profile header
- `apps/web/src/screens/Analyzer.test.tsx` - `useLiveStream`/`STALL_THRESHOLD_MS` mock (green-suite protection) + desktop badge test suite
- `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx` - destructures `liveBadgeProps`, passes it to `MobileAnalyzerChart`
- `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx` - `useLiveStream`/`STALL_THRESHOLD_MS` mock (green-suite protection) + mobile badge test
- `apps/web/src/screens/analyzer-mobile/MobileAnalyzerChart.tsx` - new `liveBadgeProps` prop, renders `LiveStatusBadge` in its chrome row

## Decisions Made
- Reused `useOverviewModel`'s exact `liveBadgeProps` shape and the exact `status==="live" && liveSpot!==null` gate rather than inventing any new live-vs-snapshot vocabulary (per the UI-SPEC's "one seam, not a new one" law).
- Left `MobileChartControls.tsx` untouched — it's shared with Overview's mobile chrome, and this plan's file list scoped Task 2 to `MobileAnalyzerChart.tsx` only. The badge renders in its own row directly above `MobileChartControls` inside the same chart-chrome section, rather than editing the shared component to interleave it into `MobileChartControls`'s own internal flex row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `LiveStatusBadge` imports `STALL_THRESHOLD_MS` as a module-level const, not just the hook**
- **Found during:** Task 2 (mounting `LiveStatusBadge` for the first time in the Analyzer trees)
- **Issue:** `Analyzer.test.tsx`'s and `AnalyzerMobile.test.tsx`'s `vi.mock("../hooks/useLiveStream.ts", ...)` blocks (added in Task 1) only mocked the `useLiveStream` function. `LiveStatusBadge.tsx` also imports `STALL_THRESHOLD_MS` directly from that module at load time; the incomplete mock crashed every test as soon as the component was rendered.
- **Fix:** Added `STALL_THRESHOLD_MS: 20_000` to both `vi.mock` blocks (matching `Overview.test.tsx`'s precedent for the same module).
- **Files modified:** `apps/web/src/screens/Analyzer.test.tsx`, `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx`
- **Verification:** Both suites pass (97/97 total across the four Analyzer-scoped test files).
- **Committed in:** `0e2af80` (Task 2 commit)

**2. [Rule 1 - Bug] Mocked `useLiveStream` return type inferred as the literal `status: "quiet"`, rejecting `"live"`/`"stalled"` overrides**
- **Found during:** Task 2, `bun run typecheck`
- **Issue:** The Task-1 `vi.hoisted(() => ({ mockUseLiveStream: vi.fn(() => ({ status: "quiet" as const, ... })) }))` factories let TypeScript infer the mock's return type from that one literal object, so `.mockReturnValue({ status: "live", ... })` in Task 2's new tests failed to typecheck against the inferred `"quiet"`-only type.
- **Fix:** Imported `UseLiveStreamResult` (type-only) from `useLiveStream.ts` and annotated the factory's return type explicitly (`vi.fn((): UseLiveStreamResult => ({...}))`), widening `status` to the real `LiveStreamStatus` union — no `as`/`!` needed.
- **Files modified:** `apps/web/src/screens/Analyzer.test.tsx`, `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.test.tsx`
- **Verification:** `bun run typecheck` clean of all errors this plan introduced (remaining errors are pre-existing, in files untouched by this plan — confirmed via `git status`).
- **Committed in:** `0e2af80` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs blocking the plan's own test suites from running/typechecking)
**Impact on plan:** Both fixes were necessary to make Task 2's own tests pass and typecheck; no scope creep beyond the plan's stated files.

## Issues Encountered
None beyond the two deviations above.

## Next Phase Readiness
- `useAnalyzerModel.liveBadgeProps` and the live-aware `spot` seam are now available for plans 41-02..41-05 (ranked table, verdict hero, etc.) to build on without re-deriving the live-vs-snapshot distinction.
- No blockers for the next plan in this phase.

---
*Phase: 41-analyzer-desktop-redesign-ranked-table-verdict-hero-live-sidecar*
*Completed: 2026-07-14*
## Self-Check: PASSED
