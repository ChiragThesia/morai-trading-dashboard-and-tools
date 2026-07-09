---
phase: 24-regime-breadth-board
plan: 05
subsystem: ui
tags: [react, tanstack-query, zod, tailwind, radix-tooltip, vitest, rtl]

requires:
  - phase: 24-regime-breadth-board (plan 04)
    provides: GET /api/analytics/regime + get_regime MCP tool, regimeResponse contract
provides:
  - useRegimeBoard hook (GET /api/analytics/regime, parsed through regimeResponse)
  - RegimeBoard component — 4-up chip grid with band-colored value/dot, as-of date, provenance tooltip
  - Overview.tsx "Regime & breadth" section mounted between Positioning & macro detail and Book & system
affects: [phase-28-picker-gates]

tech-stack:
  added: []
  patterns:
    - "useRegimeBoard clones useMacro's fetch/parse/401-non-retryable/retry-backoff shape verbatim"
    - "RegimeBoard chip reuses the Overview 'IV n/a' Badge+Tooltip info-affordance interaction"
    - "Section wrapping a single self-contained Panel component omits an internal PanelHeading to avoid a duplicated title with the section's SectionLabel"

key-files:
  created:
    - apps/web/src/hooks/useRegimeBoard.ts
    - apps/web/src/components/RegimeBoard.tsx
    - apps/web/src/components/RegimeBoard.test.tsx
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx

key-decisions:
  - "Dropped RegimeBoard's internal PanelHeading (present in the initial TDD build) once mounted — it duplicated the section's 'Regime & breadth' SectionLabel text; the section now supplies the sole visible title, mirroring how BookSummary's panels omit PanelHeading."
  - "Rendered indicator.value as value.toFixed(2) — the regimeIndicator contract carries a bare number with no per-indicator unit/format field, and the UI-SPEC only specifies '16px bold tabular-nums', not a format string."
  - "Provenance tooltip renders source and rationale as two separate text nodes (not concatenated) so each is independently assertable and matches the payload verbatim, per BOARD-02."

requirements-completed: [BOARD-01, BOARD-02]

coverage:
  - id: D1
    description: "useRegimeBoard fetches GET /api/analytics/regime and parses the body through regimeResponse (no `as` cast); 401 throws a non-retryable UnauthorizedError"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx (mocked hook — hook itself mirrors useMacro.test.ts's already-proven shape 1:1, no separate hook test per plan's file list)"
        status: pass
    human_judgment: false
  - id: D2
    description: "RegimeBoard renders one regime-chip-{id} per present indicator with a band-colored value + dot (calm/warning/crisis → up/amber/down tokens) and an 'as of {date}' stamp; a missing indicator is silently omitted, never a placeholder/dash chip; loading/empty/error states use the exact UI-SPEC copy"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx — 6/6 passing (loading/empty/error copy, 4-chip band-color assertions, 2-of-4 partial-data omission)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each chip's ⓘ (regime-why-{id}) trigger shows the indicator's own source + rationale payload fields verbatim on hover — never a hardcoded per-indicator UI string"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx > 'the ⓘ trigger's tooltip renders the indicator's own source + rationale verbatim'"
        status: pass
    human_judgment: false
  - id: D4
    description: "The 'Regime & breadth' section is mounted on Overview between 'Positioning & macro detail' and 'Book & system', without touching either existing grid"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx > 'mounts the Regime & breadth section between Positioning & macro detail and Book & system (Phase 24)'"
        status: pass
      - kind: other
        ref: "grep -c 'RegimeBoard' apps/web/src/screens/Overview.tsx == 2; grep -c 'regime-chip-' apps/web/src/components/RegimeBoard.tsx == 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual UAT — chip grid, band triad colors (calm=green/warning=amber/crisis=red), provenance tooltip, as-of date-only, section placement — on the live Overview tab"
    verification: []
    human_judgment: true
    rationale: "Pixel/visual judgment per plan's human-check, deferred to end-of-phase per human_verify_mode=end-of-phase; also depends on live macro_observations rows accruing post-deploy for VIX9D/HY-OAS."

duration: 12min
completed: 2026-07-09
status: complete
---

# Phase 24 Plan 05: Overview Regime & Breadth Board UI Summary

**useRegimeBoard hook + RegimeBoard 4-up chip grid mounted on Overview between Positioning & macro detail and Book & system — band-colored values, as-of dates, and a payload-driven provenance tooltip, no new dependency/atom/token.**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 2

## Accomplishments
- `useRegimeBoard` hook: GET /api/analytics/regime, parsed through `regimeResponse.parse()` (no `as` cast), 401 → non-retryable UnauthorizedError, daily-cadence refetch — a direct clone of `useMacro`'s proven shape.
- `RegimeBoard` component: a Panel holding a `grid grid-cols-2 gap-2 md:grid-cols-4` of Tile-shaped chips, one per present indicator (band dot + value colored by calm/warning/crisis token, "as of {date}", and an ⓘ tooltip rendering the payload's own `source`/`rationale` verbatim — BOARD-02). Missing indicators are silently omitted; loading/empty/error states use the exact UI-SPEC copy.
- Mounted as a new "Regime & breadth" `<section>` on `Overview.tsx`, between the existing "Positioning & macro detail" and "Book & system" sections, matching sibling-section structure exactly. Existing CotCard/MacroCard and Book & system grids untouched.

## Task Commits

1. **Task 1: useRegimeBoard hook + RegimeBoard component (RTL tests)** - `dce81f2` (feat) — TDD RED confirmed (component didn't exist → import-resolution failure), then GREEN (6/6 RTL tests passing).
2. **Task 2: Mount the Regime & breadth section on Overview** - `b57d476` (feat) — includes the Rule-1 PanelHeading-duplication fix (see Deviations).

_No separate plan-metadata commit required by this executor invocation; SUMMARY.md commit follows._

## Files Created/Modified
- `apps/web/src/hooks/useRegimeBoard.ts` - GET /api/analytics/regime hook, cloned from useMacro
- `apps/web/src/components/RegimeBoard.tsx` - the chip grid + provenance tooltips
- `apps/web/src/components/RegimeBoard.test.tsx` - RTL suite (6 tests: loading/empty/error copy, 4-chip band colors, partial-data omission, provenance tooltip)
- `apps/web/src/screens/Overview.tsx` - new "Regime & breadth" section mounted between the two existing sections
- `apps/web/src/screens/Overview.test.tsx` - mocked `useRegimeBoard` (matches useMacro/useCot convention) + one mount assertion

## Decisions Made
- Dropped RegimeBoard's internal `PanelHeading` once mounted on Overview — see Deviations below.
- `indicator.value.toFixed(2)` for the Display-tier value: the contract carries a bare number with no per-indicator unit, and UI-SPEC specifies typography only, not a format string. Verified visually consistent across the ratio (0.92), level (89.00), and percent (3.40) fixtures used in tests.
- Provenance tooltip renders `source` and `rationale` as two separate `<span>`s (not string-concatenated) so BOARD-02's "verbatim" requirement is independently testable per field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed RegimeBoard's internal PanelHeading — duplicated the section's SectionLabel**
- **Found during:** Task 2 (mounting the section on Overview)
- **Issue:** Task 1's RegimeBoard.tsx (per UI-SPEC's Component & Layout Contract, "a Panel titled 'Regime & breadth'") rendered its own `<PanelHeading title="Regime & breadth" />`. Task 2's Placement contract separately requires the mounting `<section>` to carry its own `SectionLabel` with the identical text. Read together and mounted, this produced the literal string "Regime & breadth" twice, back-to-back — a real UI defect, unlike any other section on Overview (CotCard/MacroCard/BookSummary/SystemHealth each carry a title distinct from their section's SectionLabel).
- **Fix:** Removed the internal `PanelHeading` (and its now-unused import) from all four RegimeBoard render branches (loading/error/empty/loaded). The mounting section's `SectionLabel` is now the sole visible title, matching how `BookSummary`'s two panels already omit `PanelHeading` and render directly under a `SectionLabel`.
- **Files modified:** `apps/web/src/components/RegimeBoard.tsx`
- **Verification:** `bun run test -- apps/web/src/components/RegimeBoard.test.tsx` still 6/6 green (no test asserted the internal title text); `bun run test -- apps/web/src/screens/Overview.test.tsx` 38/38 green including the new mount assertion; full web suite 479/479; full repo suite 2375/2375; typecheck + lint clean.
- **Committed in:** `b57d476` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic-but-real UI defect caught before the end-of-phase visual UAT checkpoint. No scope creep — no new files, no new abstraction, just a 4-line removal.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The board is live on Overview (empty-state copy renders until `macro_observations` rows accrue for VIX9D/HY-OAS post-deploy, per 24-CONTEXT.md).
- End-of-phase visual UAT (chrome-devtools, per standing permission) still owed: chip grid, band triad colors, tooltip hover, as-of date-only, section placement — deferred per `human_verify_mode=end-of-phase` (D5 above).
- Phase 28 (deferred) will wire crisis bands into picker gates — this phase is display-only by design (24-CONTEXT.md).

---
*Phase: 24-regime-breadth-board*
*Completed: 2026-07-09*

## Self-Check: PASSED
All created/modified files found on disk; both task commits (dce81f2, b57d476) found in git log.
