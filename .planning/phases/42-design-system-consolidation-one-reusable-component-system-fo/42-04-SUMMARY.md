---
phase: 42-design-system-consolidation-one-reusable-component-system-fo
plan: 04
subsystem: ui
tags: [react, tailwind, base-ui, design-system]

requires:
  - phase: 42-design-system-consolidation-one-reusable-component-system-fo (plan 01)
    provides: DataTable<T> primitive, system/index.tsx barrel conventions
provides:
  - components/system/Button as the sole Button component in apps/web
  - ui/dialog.tsx close buttons migrated to system/Button (ghost/xs, secondary)
  - Login.tsx and RebuildButton.tsx Panel-gradient duplicates swept to token utilities
  - apps/web/src/components/ui/button.tsx deleted
affects: [design-system-doc-update, topic-map-update]

tech-stack:
  added: []
  patterns:
    - "system/Button variant map is the only Button variant source — ui/button.tsx's cva-based variants retired"
    - "Panel gradient token utilities (bg-gradient-to-b from-panel to-panel2 ring-1 ring-line) replace hand-rolled linear-gradient/hex card styling"

key-files:
  created: []
  modified:
    - apps/web/src/components/ui/dialog.tsx
    - apps/web/src/screens/Login.tsx
    - apps/web/src/components/RebuildButton.tsx
    - apps/web/src/components/ui/button.tsx (deleted)

key-decisions:
  - "No React.forwardRef added to system/Button — React 19's ref-as-prop model already flows base-ui's DialogClose/DialogTrigger merged ref onto the real <button> DOM node through Button's existing {...props} spread; confirmed by base-ui's useRenderElement source (React.cloneElement with a merged ref, which React 19 does not warn on for plain function components) and by the pre-existing DialogTrigger render={<Button/>} usage in RuleSettingsModal.tsx (identical clone-merge pattern) producing zero console warnings across 35 passing tests"
  - "Dialog close/focus-return smoke test could not be run in a live browser this session (no browser-automation tool available to this executor) — evidence gathered instead via base-ui source trace (DialogClose.js / useRenderElement.js) plus the existing production-proven DialogTrigger+Button pattern; flagged human_needed for a literal click-through confirmation"

requirements-completed: []

coverage:
  - id: D1
    description: "ui/dialog.tsx's two DialogPrimitive.Close render={<Button/>} sites migrated to system/Button (ghost/xs corner close, secondary footer close)"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/RuleSettingsModal.test.tsx, apps/web/src/components/ReauthWizard.test.tsx, apps/web/src/components/AuthExpiredBanner.test.tsx (35 tests)"
        status: pass
    human_judgment: true
    rationale: "Focus-return behavior on dialog close cannot be proven in jsdom; plan mandates a live-browser smoke test which this executor had no browser tool to perform this session. Code-trace evidence (base-ui DialogClose/useRenderElement source + the identical, already-shipped DialogTrigger render={<Button/>} pattern with zero ref warnings) strongly supports PASS without forwardRef, but a human click-through is the authoritative confirmation."
  - id: D2
    description: "Login.tsx migrated to system/Button (variant=primary, full-width) and its Panel-gradient/hex duplicate swept to token utilities"
    verification:
      - kind: unit
        ref: "apps/web/src/App.test.tsx (3 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "RebuildButton.tsx migrated to system/Button (destructive trigger, secondary Cancel, destructive Rebuild) and its DialogContent gradient/hex duplicate swept to token utilities"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Journal.test.tsx (22 tests, includes 'renders the RebuildButton')"
        status: pass
    human_judgment: false
  - id: D4
    description: "apps/web/src/components/ui/button.tsx deleted with zero remaining importers repo-wide"
    verification:
      - kind: unit
        ref: "rg -n \"components/ui/button\" apps/web/src returns nothing; test ! -f apps/web/src/components/ui/button.tsx"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-15
status: complete
---

# Phase 42 Plan 04: Button Consolidation (dialog/Login/RebuildButton) Summary

**Migrated the three remaining `components/ui/button` call sites (dialog.tsx, Login.tsx, RebuildButton.tsx) to `components/system/Button` and deleted the duplicate, sweeping the Panel-gradient hex duplicates on Login.tsx and RebuildButton.tsx to token utilities in the same pass**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-15
- **Tasks:** 3 completed
- **Files modified:** 4 (3 modified, 1 deleted)

## Accomplishments

- `components/system/Button` is now the sole Button component in `apps/web` — `ui/button.tsx` deleted, zero remaining importers (grep-proven before deletion)
- Both `ui/dialog.tsx` `DialogPrimitive.Close` render-merge sites migrated: corner ✕ (`ghost`/`xs`), footer Close (`secondary`, was `outline` — no such value on `system/Button`)
- Login.tsx and RebuildButton.tsx no longer hand-roll the `linear-gradient(180deg,#0f1521,#0c111a)` + `#1b2433` border Panel duplicate — both now use `Panel`/token gradient utilities
- Login.tsx's remaining 1:1-token inline hex/font literals (brand, heading, labels, error, submit button) swept to `text-txt`/`text-muted-foreground`/`text-dim`/`text-violet`/`text-down`/`font-display`/`font-mono`
- RebuildButton.tsx's DialogContent/title/description inline hex/font literals swept the same way; layout-only `maxWidth` moved to `className="max-w-[400px]"`

## Task Commits

Each task was committed atomically:

1. **Task 1: migrate ui/dialog.tsx internal close Buttons + smoke-test the render-merge** - `8652230` (feat)
2. **Task 2: migrate Login.tsx Button + sweep its inline Panel-gradient/token hex** - `0530815` (feat)
3. **Task 3: migrate RebuildButton.tsx Button + sweep hex, then delete ui/button.tsx** - `5f2706a` (feat)

_No TDD tasks in this plan — all three are style/wiring migrations with existing regression-anchor suites._

## Files Created/Modified

- `apps/web/src/components/ui/dialog.tsx` - Button import swapped to `system/index.tsx`; `variant="outline" size="icon-sm"` → `variant="ghost" size="xs"` (corner ✕); `variant="outline"` → `variant="secondary"` (footer Close)
- `apps/web/src/screens/Login.tsx` - Button+Panel import swapped to `system/index.tsx`; submit button now `variant="primary" size="sm" className="w-full"`; card wrapper now `<Panel className="w-full max-w-[360px] rounded-xl p-6">`; brand/heading/labels/error swept to token text/font classes
- `apps/web/src/components/RebuildButton.tsx` - Button import swapped to `system/index.tsx`; trigger now `variant="destructive" size="sm"`; footer Cancel now `variant="secondary" size="sm"`; DialogContent gradient/border swept to `className="max-w-[400px] bg-gradient-to-b from-panel to-panel2 ring-1 ring-line"`; title/description swept to token classes
- `apps/web/src/components/ui/button.tsx` - deleted (zero remaining importers, grep-verified)

## Decisions Made

- **No `React.forwardRef` added to `system/Button`.** The plan's contingency required adding it only if the render-merge smoke test proved it necessary. I traced base-ui's actual source (`DialogClose.js` calls `useRenderElement` with a merged ref array, which `useRenderElement.js` attaches via `React.cloneElement(newElement, mergedProps)` where `mergedProps.ref` is set). In React 19, `ref` flows through a plain function component's props object without `forwardRef` (no more "cannot be given refs" warning) as long as the component doesn't strip it — `system/Button`'s `{...props}` spread onto the native `<button>` carries the ref through correctly. This is also empirically confirmed: `RuleSettingsModal.tsx` already uses the identical `DialogTrigger` render-merge pattern with the same `Button` component (`render={<Button variant="ghost" size="xs" .../>}` on line 419), and its 35-test suite runs clean with zero ref warnings in the raw (unfiltered) vitest output.
- **Dialog focus-return smoke test not performed live.** This executor had no browser-automation tool available this session (chrome-devtools MCP not in the active toolset), so the plan's mandatory live-browser click-through (open dialog → click ✕ → click footer Close → confirm focus returns to trigger, no ref warning) could not be executed. Flagged `human_needed` in the coverage block above rather than silently marking it pass; the code-trace evidence above is strong but not the literal proof the plan asked for.

## Deviations from Plan

**1. [Rule 1 - Bug] Stale doc-comment hex literals in Login.tsx contradicted the plan's own token-sweep acceptance grep**
- **Found during:** Task 2
- **Issue:** The file's top-of-function JSDoc comment still described the card as `bg linear-gradient(180deg, #0f1521, #0c111a), border #1b2433 1px` — literal text that would fail the plan's own `rg -n "linear-gradient\(180deg|#0f1521|#0c111a|#1b2433"` acceptance check even though it's a comment, not code, and no longer matches the implementation after the Panel sweep.
- **Fix:** Reworded the one comment line to describe the Panel gradient token surface instead of the retired literal values (no other prose changed).
- **Files modified:** apps/web/src/screens/Login.tsx
- **Verification:** `rg -n "linear-gradient\(180deg|#0f1521|#0c111a|#1b2433" apps/web/src/screens/Login.tsx` returns nothing.
- **Committed in:** `0530815` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — stale doc comment)
**Impact on plan:** Cosmetic doc-accuracy fix required to satisfy the plan's own acceptance grep. No scope creep.

## Issues Encountered

- `src/screens/MarketRail.test.tsx` fails in the full suite run (`readFileSync("apps/web/src/screens/MarketRail.tsx", ...)` → ENOENT) because the test hardcodes a repo-root-relative path while vitest's cwd is `apps/web`. Confirmed pre-existing and unrelated to this plan — last touched in phase 38 (commit `b81eab3`), not one of this plan's `files_modified`. Left untouched per the deviation-rules scope boundary (out-of-scope discovery, not fixed).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `components/system/Button` is now the single Button implementation for `apps/web`; `class-variance-authority` becomes unused by buttons but the dependency itself is out of scope for removal (per this plan's threat register, T-42-SC).
- Remaining Migration Manifest work (design-system.md doc update, TOPIC-MAP.md row, DataTable rollout to CandidateTable/Overview) is scoped to other plans in this phase per `42-PATTERNS.md`.
- The live dialog focus-return smoke test remains open — recommend a human (or an agent with browser-automation tooling) do one click-through pass on any `DialogContent`-based dialog (e.g. RuleSettings gear modal) before closing out this phase's UAT.

---
*Phase: 42-design-system-consolidation-one-reusable-component-system-fo*
*Completed: 2026-07-15*

## Self-Check: PASSED

All modified/created files exist on disk; `apps/web/src/components/ui/button.tsx` confirmed deleted; all three task commit hashes (`8652230`, `0530815`, `5f2706a`) found in git log.
