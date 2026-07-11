---
phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-
plan: 04
subsystem: web
tags: [mobile, responsive, positions, card, accessibility, dual-render]

requires:
  - phase: 35-03
    provides: "Overview's PillHeader/grid restructure — this plan owns the untouched positions region on the same file"
provides:
  - "lib/position-format.ts — shared usd/signed/signedUsd/signClass helpers + Row/ExpiryCell types, importable by both Overview.tsx and PositionCard.tsx with no runtime cycle"
  - "PositionCard — mobile positions-list card component (collapsed label/expiry/Net val/Unreal/verdict, tap-to-expand Δ/Γ/Θ/Vega grid, sibling checkbox)"
  - "Overview positions dual render — hidden lg:table desktop table paired with a lg:hidden card list, both fed the same Row[]"
affects: [35-06]

tech-stack:
  added: []
  patterns:
    - "hidden lg:table / lg:hidden (display:none pairing) as the only correct technique for a genuinely-different-DOM table/card duo — never sr-only/opacity, which would leave the inactive variant AT-reachable and double-announce every position"
    - "Shared lib/ module extraction to break a would-be Overview -> PositionCard -> Overview runtime import cycle, rather than either file importing the other directly"
    - "Test-only within(getByRole('table')) scoping for pre-existing assertions whose target text/checkbox/label now legitimately duplicates into a sibling card render (no real CSS media query in jsdom) — same precedent 35-03 set for the PillHeader chip duplication"

key-files:
  created:
    - apps/web/src/lib/position-format.ts
    - apps/web/src/lib/position-format.test.ts
    - apps/web/src/components/PositionCard.tsx
    - apps/web/src/components/PositionCard.test.tsx
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx

key-decisions:
  - "Only usd/signed/signedUsd/signClass and the Row/ExpiryCell types moved to lib/position-format.ts (per the plan) — formatExpiryCell/formatExpiryDate/ExpiryCellInput stayed in Overview.tsx (still exported, still imported by Overview.test.tsx) since the plan only named the four helpers + two types as the shared surface PositionCard needs."
  - "The mobile card list is a second .map() over the same `rows` array (computing included/ivNa/verdict/expanded per row) rather than threading a shared per-row object out of the tbody's existing .map() — the derivations are cheap Map/Set lookups already duplicated nowhere else, and this keeps the existing table .map() untouched (minimal diff) per the plan's own 'mirror the derivations' instruction."
  - "PositionCard's `liveStatus` prop is declared in PositionCardProps (per the UI-SPEC's prop list) but not destructured/used in the component body — matches the UI-SPEC's own reference implementation, which lists it as a prop without consuming it (no live-cell flash is ported to the card, a deliberate simplification the UI-SPEC calls out)."

requirements-completed: [MOBILE-05]

coverage:
  - id: D4
    description: "Below lg the positions render as a list of PositionCards fed the same Row[] the desktop table uses; at lg the existing <table> renders and the card list is display:none (removed from the accessibility tree)"
    requirement: "MOBILE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#Overview — positions dual render (35-04: table hidden lg:table + card list lg:hidden)"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px cards / 1024px+ table, screen-reader single-announce check, per plan's own <human-check> note)"
        status: pending
    human_judgment: true
  - id: D5
    description: "A PositionCard collapsed shows label + IV n/a badge + expiry + Net val + Unreal (sign-colored) + verdict chip; tapping the card body expands Δ/Γ/Θ/Vega; the checkbox toggles include/exclude without expanding"
    requirement: "MOBILE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/PositionCard.test.tsx"
        status: pass
    human_judgment: false
  - id: D6
    description: "The card's expand state and include/exclude reuse the EXISTING expandedRowKey/onSelectRow and excluded/onToggleExcluded state — no second expand or exclusion mechanism"
    requirement: "MOBILE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.tsx PositionsTable — card list wired to the same onSelectRow/onToggleExcluded handlers, no new state"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-11
status: complete
---

# Phase 35 Plan 04: Overview positions to cards (PositionCard + dual render) Summary

**A genuine second DOM for mobile positions — `PositionCard` (tap-to-expand Δ/Γ/Θ/Vega, sibling checkbox) fed the same `Row[]` the desktop `<table>` renders, paired via `hidden lg:table` / `lg:hidden` so a screen reader never announces a position twice.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (Task 1 refactor + keep-green; Tasks 2-3 each TDD RED → GREEN)
- **Files created:** 4, modified: 2

## Accomplishments

- Extracted `usd`/`signed`/`signedUsd`/`signClass` and the `Row`/`ExpiryCell` types out of `Overview.tsx` into `apps/web/src/lib/position-format.ts` — a pure move (verbatim output, same default `dp` args) pinned by a small example test, so `PositionCard` can import the shared surface without creating an `Overview → PositionCard → Overview` runtime cycle.
- Built `PositionCard` (`apps/web/src/components/PositionCard.tsx`): collapsed shows `row.label`, the IV n/a `Badge` only when `ivNa`, `row.expiry.line1`/`line2`, `Net val`/`Unreal` `Stat`s (sign-colored), and the `VerdictChip` when a verdict exists; expanded additionally shows the Δ/Γ/Θ/Vega grid. The expand trigger is a real `<button aria-expanded={expanded}>` (free keyboard support); the checkbox is a sibling `<label>` (44px hit-area, `min-h-11 min-w-11`) carrying the exact `Include ${label} in risk profile & total` aria-label the desktop table already uses. Values come from `resolveLivePositionRow` — same source as the table, no second computation.
- Wired the dual render inside `PositionsTable` in `Overview.tsx`: the existing `<table>` gained `hidden lg:table`; a new `lg:hidden` `<div data-testid="positions-card-list">` maps the same `rows` to `PositionCard`, mirroring each row's `included`/`ivNa`/`verdict`/`expanded` derivation and reusing the exact `onSelectRow`/`onToggleExcluded` handlers already threaded from `Overview` — no second expand or exclusion mechanism, no prop re-threading.

## Task Commits

Each task committed atomically:

1. **Task 1: Extract position-format helpers + Row/ExpiryCell types (refactor, keep green)** — `804c6dd` `refactor(35-04): extract position-format helpers + Row/ExpiryCell types to lib`
2. **Task 2: PositionCard component (RED → GREEN)** — `5f8c198` `feat(35-04): PositionCard — mobile positions card (collapsed/expanded, checkbox + expand wiring)`
3. **Task 3: Dual-render positions (RED → GREEN)** — `e36bf50` `feat(35-04): positions dual render — table hidden lg:table + card list lg:hidden`

_Task 1 is a pure refactor (TDD-exempt per `.claude/rules/tdd.md`'s "styling-only"/glue-code exemption; the plan itself frames it as "refactor, keep green") — no separate RED commit. Tasks 2 and 3's RED runs were verified as genuine failures (missing module / missing test hooks and classes, never import or syntax errors) before writing the GREEN implementation in the same commit, matching this repo's TDD-commit convention (commit only at green)._

## Files Created/Modified

- `apps/web/src/lib/position-format.ts` (new) — `usd`/`signed`/`signedUsd`/`signClass` + `Row`/`ExpiryCell` types, moved verbatim from `Overview.tsx`.
- `apps/web/src/lib/position-format.test.ts` (new) — 4 example assertions pinning each helper's exact output.
- `apps/web/src/components/PositionCard.tsx` (new) — the mobile positions card.
- `apps/web/src/components/PositionCard.test.tsx` (new) — 7 tests: collapsed fields, IV n/a badge conditional, verdict chip conditional, expanded grid, expand-button wiring (`onSelect` + `aria-expanded`), checkbox wiring (`onToggleIncluded`, no cross-talk to `onSelect`), excluded-row dim.
- `apps/web/src/screens/Overview.tsx` — imports from `lib/position-format.ts` instead of local definitions; `PositionsTable`'s `<table>` gained `hidden lg:table`; a new `lg:hidden` card-list `<div>` mounts `PositionCard` per row.
- `apps/web/src/screens/Overview.test.tsx` — added a new describe block (2 tests: table `hidden lg:table`, card-list `lg:hidden` + card-count-matches-row-count); scoped 5 pre-existing assertions to `within(screen.getByRole("table"))` (see Deviations).

## Decisions Made

- Followed the UI-SPEC's exact `PositionCard` markup (§"3. `PositionCard` — new component") and the dual-render mount snippet verbatim — no material deviation from either.
- `position-format.ts` carries only the four helpers + two types the plan named; `formatExpiryCell`/`formatExpiryDate`/`ExpiryCellInput` stayed in `Overview.tsx` (still exported for `Overview.test.tsx`'s existing import) since the plan scoped the shared surface narrowly.
- The card list recomputes `included`/`ivNa`/`verdict`/`expanded` in its own `.map()` over `rows` rather than restructuring the table's existing `tbody` `.map()` to emit both a `<tr>` and a card per iteration — each derivation is a cheap `Set`/`Map` lookup already isolated to that scope, and this keeps the pre-existing table render loop untouched (smallest diff, per the plan's "mirror the derivations" instruction rather than "share a variable").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 5 pre-existing table assertions broke on the intentional table/card content duplication**
- **Found during:** Task 3 GREEN run (full-suite pass after wiring the dual render)
- **Issue:** The dual render's own design (the same row's label/expiry/checkbox/IV-n/a-badge text now exists in both the desktop `<table>` and the mobile card list — jsdom renders both regardless of viewport, since there's no real CSS media-query evaluation in tests) caused 5 pre-existing unscoped queries (`screen.getByText("IV n/a")`, three `screen.getByRole("checkbox", { name: … })` calls, and `screen.getByText(/10d wide/)`) to start matching two elements instead of one.
- **Fix:** Scoped all five to `within(screen.getByRole("table"))`, which is guaranteed to hold exactly one of each regardless of the card list's presence. No other pre-existing test in the file collided (the failing run surfaced exactly these 5, matched against a targeted grep for the same query patterns before applying the fix). This mirrors the identical fix 35-03 applied to the PillHeader's "0DTE γ" chip duplication.
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Commit:** `e36bf50`

None beyond the above — every RED run failed for the right reason (missing module/test hooks/classes, not import or syntax errors), and both TDD tasks' GREEN implementations passed on the first attempt once the pre-existing scoping fix was applied.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Overview's positions region now has a real mobile card render; 35-05 (Analyzer + Journal responsive port) and 35-06 (integration gate) are unaffected by this plan's scope (positions table/card only, same file region 35-03 explicitly deferred).
- The plan's `<human-check>` item (390px cards with tap-expand + independent checkbox, no h-scroll; 1024px+ table renders and the card list is `display:none`/absent from the a11y tree, single screen-reader announcement per position) is explicitly deferred to plan 35-06's integration gate per the plan's own `<verify>` note — not performed in this plan.
- Verification run exactly as the plan's `<verification>` block specifies: `cd apps/web && bunx vitest run src/lib/position-format.test.ts src/components/PositionCard.test.tsx src/screens/Overview.test.tsx` — all green (4 + 7 + 68 = 79 tests). `bun run typecheck` clean. `bun run lint` clean (only the same pre-existing, unrelated `eslint-plugin-boundaries` legacy-selector warning noted in every prior 35-* summary — not an error). Full workspace gate (`bun run test` at root) — 3262/3262 tests pass across 296 files.
- Not touched, and not needed by this plan: `ROADMAP.md`, `STATE.md` (per instruction — orchestrator owns those).

## Self-Check: PASSED

All modified/created files and commit hashes verified present.

---
*Phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-*
*Completed: 2026-07-11*
