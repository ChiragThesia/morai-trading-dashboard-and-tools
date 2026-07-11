---
phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-
plan: 02
subsystem: web
tags: [mobile, responsive, safe-area, touch-target, collapse-bug]

requires: []
provides:
  - "MarketRail: closed-by-default <details>, className-driven, force-visible at lg via lg:[&>div]:!block — unblocks 35-03's order-* reflow"
  - "Shell: nav tabs meet the 44px touch minimum below lg, exact lg: revert to 32px; main uses 100dvh"
  - "AuthExpiredBanner: both branches clear the iOS home-indicator safe area via paddingBottom max(8px, env(safe-area-inset-bottom))"
affects: [35-03, 35-06]

tech-stack:
  added: []
  patterns:
    - "Scoped :not/child utility (lg:[&>div]:!block) to force-show a <details> content div at desktop independent of its runtime open state — no matchMedia fallback needed, cascade held on inspection"
    - "Inline style objects split into explicit padding sides (not shorthand) when one side needs an env()-based dynamic value — a Tailwind class can never win against an inline style on the same element"

key-files:
  created: []
  modified:
    - apps/web/src/screens/MarketRail.tsx
    - apps/web/src/screens/MarketRail.test.tsx
    - apps/web/src/components/Shell.tsx
    - apps/web/src/components/AuthExpiredBanner.tsx
    - apps/web/src/components/AuthExpiredBanner.test.tsx

key-decisions:
  - "Task 3 (Shell) followed the plan's TDD-exemption citation (.claude/rules/tdd.md 'styling-only UI tweaks') verbatim — no Shell.test.tsx exists (confirmed before editing), so a grep + typecheck + lint gate is the whole proof, per plan."
  - "Grep gate required the literal substring 'min-h-11 min-w-11 lg:min-h-8' contiguous in the class string — first pass appended lg:min-h-8 at the end of the className (still functionally correct, cn() doesn't care about order) but failed the grep; moved it immediately after min-w-11 to match the plan's exact expected string and re-passed the gate."
  - "Updated two doc comments (MarketRail's file-header 'open by default' description, AuthExpiredBanner's 'Visual spec' padding line) because both directly described the exact property this plan's tasks changed — stale docs about the changed line would mislead the next reader, not adjacent unrelated code."

requirements-completed: [MOBILE-04]

coverage:
  - id: T1
    description: "MarketRail's <details> renders with no open attribute by default (Pitfall 1 regression guard) and accepts+merges a className prop onto the details element"
    requirement: "MOBILE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/MarketRail.test.tsx"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (320px-1440px chrome-devtools spot-check of the lg:[&>div]:!block force-open cascade, per plan's own <verification> block)"
        status: pending
    human_judgment: true
  - id: T2
    description: "Both AuthExpiredBanner role=alert branches (red isExpired, amber isMarketExpired/isNearExpiry) carry paddingBottom max(8px, env(safe-area-inset-bottom)) with top/left/right unchanged"
    requirement: "MOBILE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/components/AuthExpiredBanner.test.tsx"
        status: pass
    human_judgment: false
  - id: T3
    description: "Shell nav tabs are min-h-11 (>=44px) below lg and lg:min-h-8 (32px) at lg; main uses min-h-[calc(100dvh-48px)]; header remains the only sticky layer (untouched)"
    requirement: "MOBILE-04"
    verification:
      - kind: static
        ref: "grep -nF gate in apps/web/src/components/Shell.tsx (both target strings present) + bun run typecheck + bun run lint"
        status: pass
      - kind: manual
        ref: "deferred to 35-06 integration gate (390px box-model measurement + real iOS Safari single-sticky-layer scroll check, per plan's own <verification> block)"
        status: pending
    human_judgment: true

duration: 15min
completed: 2026-07-11
status: complete
---

# Phase 35 Plan 02: Cross-cutting mobile fixes (MarketRail open + Shell + AuthExpiredBanner) Summary

**Fixed the three shared-shell mobile bugs that block the Overview reflow in 35-03: MarketRail's hardcoded `open` attribute that buried the hero on phones, Shell's sub-44px nav tabs and `100vh` toolbar-jump, and AuthExpiredBanner's fixed-bottom banner overlapping the iOS home indicator — every fix `lg:`-reverted to today's exact desktop behavior, zero new deps.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (2 TDD RED→GREEN, 1 TDD-exempt styling-only per `.claude/rules/tdd.md`)
- **Files modified:** 5

## Accomplishments

- `MarketRail` (`apps/web/src/screens/MarketRail.tsx`) — dropped the hardcoded `open` attribute (Pitfall 1: the "collapsible" rail was always-expanded, burying the hero on phones), added an optional `className` prop merged via `cn`, and added `lg:[&>div]:!block` on the `<details>` plus `lg:pointer-events-none` on the `<summary>` so the rail force-shows its content at desktop regardless of the details' runtime open state. Content composition (RegimeBoard, CotCard, system health) is unchanged.
- `Shell` (`apps/web/src/components/Shell.tsx`) — nav tab className goes `min-h-8 min-w-11` → `min-h-11 min-w-11 lg:min-h-8` (≥44px tall below `lg`, exact 32px revert at `lg`; width already met 44px). Main's height goes `min-h-[calc(100vh-48px)]` → `min-h-[calc(100dvh-48px)]` (prevents iOS Safari's dynamic-toolbar height jump, harmless at all widths). Header's `sticky top-0 z-50` and everything else untouched.
- `AuthExpiredBanner` (`apps/web/src/components/AuthExpiredBanner.tsx`) — both `role="alert"` inline-style objects (red `isExpired` branch, amber `isMarketExpired`/`isNearExpiry` branch) split their `padding: "8px 16px"` shorthand into explicit `paddingTop`/`Left`/`Right` (unchanged values) plus `paddingBottom: "max(8px, env(safe-area-inset-bottom))"`, clearing the iOS home-indicator safe area. No copy, gate logic, or other style property changed.

## Task Commits

Each task committed atomically:

1. **Task 1** — `08a5dfb` `fix(35-02): MarketRail defaults closed, accepts className, force-visible at lg`
2. **Task 2** — `037a6c0` `fix(35-02): AuthExpiredBanner clears iOS home-indicator safe area`
3. **Task 3** — `a3b238f` `fix(35-02): Shell nav tabs meet 44px touch minimum, main uses 100dvh`

_Tasks 1 and 2 were RED→GREEN (each RED run confirmed a genuine assertion failure — the missing `open`-attribute guard and the missing className merge for MarketRail; the missing `env(safe-area-inset-bottom)` string for AuthExpiredBanner — before the GREEN implementation, committed at green per `.claude/rules/tdd.md`). Task 3 is TDD-exempt per the plan's own citation of `.claude/rules/tdd.md`'s "styling-only UI tweaks" exemption; no `Shell.test.tsx` exists (confirmed before editing), so the grep + typecheck + lint gate is the proof of record, matching the plan's stated rationale (mounting Shell pulls in `RuleSettingsModal` + `AuthExpiredBanner` and their hooks, disproportionate for a class swap)._

## Files Created/Modified

- `apps/web/src/screens/MarketRail.tsx` — dropped `open`, added `className` prop, `lg:[&>div]:!block` force-open, `lg:pointer-events-none` on summary; updated the file-header doc comment ("open by default" → "closed by default").
- `apps/web/src/screens/MarketRail.test.tsx` — 2 new tests: no `open` attribute by default, `className` merges onto the details element.
- `apps/web/src/components/Shell.tsx` — nav tab `min-h-11 min-w-11 lg:min-h-8`; main `min-h-[calc(100dvh-48px)]`.
- `apps/web/src/components/AuthExpiredBanner.tsx` — both style objects split into explicit padding sides with `paddingBottom: max(8px, env(safe-area-inset-bottom))`; updated the "Visual spec" doc comment's padding line to note the safe-area addition.
- `apps/web/src/components/AuthExpiredBanner.test.tsx` — 2 new tests: red-branch and amber-branch `style.paddingBottom` contains `env(safe-area-inset-bottom)`, top/left/right unchanged.

## Decisions Made

- Followed the UI-SPEC's exact target markup for MarketRail (§"2. MarketRail — the `open` bug fix (D-02)") and the exact padding split for AuthExpiredBanner (§"Safe-area insets") verbatim — no material deviation from either.
- The `lg:[&>div]:!block` cascade (Assumption A1, LOW-MEDIUM confidence per RESEARCH) was implemented as specified; the plan's own visual spot-check (320px→1440px) is a `<human-check>` explicitly deferred to the 35-06 integration gate per this plan's `<verification>` block ("Manual (end-of-phase UAT, per 35-06)") — same deferral pattern 35-01 used for its own human-checks. No `matchMedia` fallback was needed at implementation time since the CSS-only approach compiles and the class contract test passes; final visual confirmation is 35-06's job.
- Grep-gate string ordering: moved `lg:min-h-8` to immediately follow `min-w-11` in Shell's nav-tab className (rather than appending it at the end of the class list) so the plan's `grep -nF 'min-h-11 min-w-11 lg:min-h-8'` gate matches the literal contiguous substring — functionally identical either way since Tailwind/`cn` don't care about class order, but matching the plan's exact string is the documented proof.

## Deviations from Plan

None — plan executed exactly as written. All RED runs failed for the right reason (genuine assertion failures on the new `open`-attribute/className/safe-area assertions, not import/syntax errors), and both GREEN implementations passed on the first attempt. Task 3's TDD exemption was per the plan's own explicit instruction, not an unrequested shortcut.

## Issues Encountered

None. One self-correction during Task 3: the first grep-gate run failed because `lg:min-h-8` was appended at the end of the className string instead of immediately after `min-w-11`; reordered within the same task before committing (not a separate fix-attempt cycle, caught before the commit).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `MarketRail` now accepts `className` and defaults closed — plan 35-03 can mount it as `<MarketRail className="order-2 lg:order-1" />` inside Overview's grid with no further wiring, exactly as the UI-SPEC's Overview grid excerpt shows.
- Shell's touch-target and `100dvh` fixes and AuthExpiredBanner's safe-area fix apply globally (Shell wraps all three screens) — 35-03/35-04/35-05 inherit them automatically, no per-screen work needed.
- Verification run exactly as the plan's `<verification>` block specifies: `bunx vitest run src/screens/MarketRail.test.tsx src/components/AuthExpiredBanner.test.tsx` — 18/18 pass. Shell's grep gate passes (`min-h-11 min-w-11 lg:min-h-8` and `min-h-[calc(100dvh-48px)]` both present). Broader consumer sweep (`src/screens/Overview.test.tsx src/components`) — 317/317 tests pass, confirming Overview's existing (pre-35-03) `<MarketRail />` call site still works with the now-optional `className` prop. `bun run typecheck` (root, `tsc --build --force`) clean. `bun run lint` clean for changed files (only the same pre-existing `eslint-plugin-boundaries` legacy-selector warning noted in 35-01's summary — not an error, unrelated to this plan). Full workspace gate (`bun run test` at root) — 3234/3234 tests pass across 294 files.
- The plan's two `<human-check>` items (MarketRail's 320px→1440px force-open spot-check; Shell's 390px box-model + real-iOS single-sticky-layer scroll check) are explicitly deferred to plan 35-06's integration gate per the plan's own `<verify>` notes — not performed in this plan, tracked as `pending`/`human_judgment: true` in the coverage table above.
- Not touched, and not needed by this plan: `ROADMAP.md`, `STATE.md` (per instruction — orchestrator owns those).

## Self-Check: PASSED

All modified files and commit hashes verified present.

---
*Phase: 35-mobile-experience-redesign-the-phone-view-is-desktop-panels-*
*Completed: 2026-07-11*
