---
phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-
plan: 01
subsystem: web
tags: [mobile, responsive, chip-rail, touch-target, chart-chrome, design-system]

requires: []
provides:
  - "ChipRail: native CSS scroll-snap container, exported from components/system, lg: reverts to flex-wrap"
  - "Button size=\"touch\": >=44px SIZE_CLASS entry that lg: reverts byte-for-byte to xs"
  - "PayoffControls mounted inside a ChipRail with touch-sized buttons — fixes CONTEXT item 4 wrap bug at both call sites"
affects: [35-03, 35-06, "any later plan mounting a chip strip (PillHeader secondary rail)"]

tech-stack:
  added: []
  patterns:
    - "One shared scroll-snap primitive (ChipRail) reused at every horizontally-scrollable chip strip, not a bespoke wrapper per surface (RESEARCH Pattern 2 / D-07)"
    - "Button SIZE_CLASS lookup-map extension pattern (touch entry) instead of one-off inline styles at call sites (RESEARCH Don't-Hand-Roll table)"

key-files:
  created:
    - apps/web/src/components/system/ChipRail.tsx
    - apps/web/src/components/system/ChipRail.test.tsx
  modified:
    - apps/web/src/components/system/index.tsx
    - apps/web/src/components/system/Button.tsx
    - apps/web/src/components/system/system.test.tsx
    - apps/web/src/components/charts/PayoffControls.tsx
    - apps/web/src/components/charts/PayoffControls.test.tsx

key-decisions:
  - "SIZE_CLASS.touch's lg: tail is a hand-typed duplicate of xs's px-[7px] py-0.5 text-[9px] plus lg:min-h-0 — matches the UI-SPEC string verbatim; a guard test on size=xs (px-[7px] py-0.5 text-[9px]) locks the untouched box so the two entries can't silently drift apart."
  - "Applied snap-start shrink-0 to every direct child of PayoffControls' ChipRail (label span, both step buttons, the date input, the divider span, and all four toggle chips) — not just the buttons — so nothing in the row gets flex-shrunk when the container overflows below lg:."

patterns-established:
  - "ChipRail owns only the scroll container; each call site is responsible for adding snap-start shrink-0 to its own children (documented in the component's own comment for the next call site, PillHeader, in 35-03)."

requirements-completed: [MOBILE-02, MOBILE-03]

coverage:
  - id: D1
    description: "Below lg (1024px) a row of chips scrolls horizontally with per-chip snap and a right-edge peek; at lg and up the same row falls back byte-for-byte to flex-wrap (no scroll-snap, no clipping)"
    requirement: "MOBILE-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/system/ChipRail.test.tsx"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px + 1024px+ chrome-devtools UAT)"
        status: pending
    human_judgment: true
  - id: D2
    description: "A Button rendered with size=\"touch\" is at least 44px tall below lg and reverts to the exact xs box (px-[7px] py-0.5 text-[9px], min-h-0) at lg and up"
    requirement: "MOBILE-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/system/system.test.tsx#Button — shared control-affordance primitive"
        status: pass
    human_judgment: false
  - id: D3
    description: "PayoffControls' date/toggle strip scrolls as one ChipRail unit with 44px-tall buttons below lg, and is visually identical to today at lg and up — both Overview and Analyzer chart mounts inherit the fix from one edit"
    requirement: "MOBILE-02, MOBILE-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffControls.test.tsx"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px scroll + box-model check on Overview and Analyzer)"
        status: pending
    human_judgment: true

duration: 20min
completed: 2026-07-11
status: complete
---

# Phase 35 Plan 01: Shared mobile-chrome primitives (ChipRail + Button touch) Summary

**New `ChipRail` scroll-snap primitive and `Button` `size="touch"` entry, both `lg:`-reverted to today's exact desktop classes, applied to `PayoffControls` to fix the chart-chrome wrap bug (CONTEXT item 4) for both the Overview and Analyzer chart mounts with one edit.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 (each TDD: RED → GREEN)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `ChipRail` (`apps/web/src/components/system/ChipRail.tsx`) — a `role="group"` scroll-snap container carrying `snap-x snap-mandatory overflow-x-auto pr-6` for the mobile edge-peek affordance, plus the `lg:flex-wrap lg:overflow-visible lg:snap-none lg:pr-0` revert triplet so desktop is a guaranteed `flex-wrap` fallback. Merges a caller `className` via `cn` and is re-exported from `components/system` beside `Panel`/`Stat`/`MetricChip`.
- `Button`'s `ButtonSize` union gained a third member, `"touch"`, with a matching `SIZE_CLASS` entry (`min-h-11 px-3 py-1.5 text-[11px] lg:min-h-0 lg:px-[7px] lg:py-0.5 lg:text-[9px]`) — `≥44px` tall below `lg:`, reverting byte-for-byte to the untouched `xs` box at `lg:`. `xs`/`sm` entries and every other existing `Button` call site are unchanged (verified by a guard test).
- `PayoffControls`' outer `flex flex-wrap` div became a `ChipRail` (`ariaLabel="Chart date and series controls"`), and all five `Button`s (`‹`, `›`, `Today`, and the four series toggles) now render `size="touch"`. Existing `data-testid`/`aria-pressed`/`aria-label`/handler wiring on every control is unchanged. Because both Overview and Analyzer mount the same `PayoffControls` component, this single edit fixes the wrap bug at both chart chrome locations.

## Task Commits

Each task committed atomically per RED → GREEN:

1. **Task 1** — `5e20cf3` `feat(35-01): add ChipRail shared scroll-snap chip rail primitive`
2. **Task 2** — `a85efa8` `feat(35-01): add Button size=touch entry with lg: revert to xs box`
3. **Task 3** — `e4c7ebc` `feat(35-01): PayoffControls scrolls-not-wraps below lg via ChipRail`

_No separate RED-only commits — each task's RED run was verified (real module-not-found or assertion failure) before writing the GREEN implementation in the same commit, matching this repo's existing TDD-commit convention (one commit per task at green, per `.claude/rules/tdd.md`'s "commit only at green")._

## Files Created/Modified

- `apps/web/src/components/system/ChipRail.tsx` — new scroll-snap container primitive.
- `apps/web/src/components/system/ChipRail.test.tsx` — 4 tests: role/name, children render, mobile+`lg:` class contract, `className` merge.
- `apps/web/src/components/system/index.tsx` — re-exports `ChipRail`.
- `apps/web/src/components/system/Button.tsx` — `ButtonSize` widened to `"xs" | "sm" | "touch"`; `SIZE_CLASS.touch` added.
- `apps/web/src/components/system/system.test.tsx` — added a `size=xs` box guard test and a `size=touch` height/revert test.
- `apps/web/src/components/charts/PayoffControls.tsx` — outer wrapper is now `ChipRail`; all 5 buttons get `size="touch"`; every direct child gets `snap-start shrink-0`.
- `apps/web/src/components/charts/PayoffControls.test.tsx` — added 2 tests: `ChipRail` role/name wrapper, touch-height class on a toggle button.

## Decisions Made

- Followed the UI-SPEC's `ChipRail` component body and `SIZE_CLASS.touch` string verbatim — no material deviation.
- Applied `snap-start shrink-0` to every direct child of `PayoffControls`' `ChipRail` (not just the buttons) so the label span, date input, and divider also resist being flex-shrunk in the `overflow-x-auto` container — the plan's action step said "each direct child," which this reading satisfies most literally and keeps the row visually consistent end to end.
- Did not touch `PayoffChart.tsx` or any chart internals (D-10) — only the control strip changed, as required.

## Deviations from Plan

None — plan executed exactly as written. All three RED runs failed for the right reason (a genuine module-not-found on Task 1, and genuine class-assertion failures on Tasks 2 and 3 — not import/syntax errors), and each GREEN implementation passed on the first attempt.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `ChipRail` and `Button size="touch"` are both importable from `apps/web/src/components/system/index.tsx` — plan 35-03 (Overview `PillHeader` secondary rail) can mount `ChipRail` directly with no further wiring.
- Verification run exactly as the plan's `<verification>` block specifies: `bunx vitest run src/components/system/ChipRail.test.tsx src/components/system/system.test.tsx src/components/charts/PayoffControls.test.tsx` — 29/29 tests pass. Broader consumer sweep (`src/components/charts`, `Overview.test.tsx`, `Analyzer.test.tsx`) — 200/200 tests pass, confirming neither chart mount regressed. `bun run typecheck` clean workspace-wide. `bun run lint` clean for changed files (only a pre-existing, unrelated `eslint-plugin-boundaries` legacy-selector warning, no errors).
- The plan's `<human-check>` (390px scroll-not-wrap + ≥44px box-model measurement on Overview and Analyzer, plus the 1024px+ flex-wrap tripwire) is explicitly deferred to plan 35-06's integration gate per the plan's own `<verify>` note ("Manual (end-of-phase UAT, per 35-06)") — not performed in this plan, tracked as `pending`/`human_judgment: true` in the coverage table above. 35-06 should also run the desktop tripwire diffing a `touch` button's computed box model against an untouched `xs` button, per this plan's `key_links` note on hand-typed class drift risk.
- Not touched, and not needed by this plan: `ROADMAP.md`, `STATE.md` (per instruction — orchestrator owns those).

## Self-Check: PASSED

All created files and commit hashes verified present.

---
*Phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-*
*Completed: 2026-07-11*
