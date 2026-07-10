---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 14
subsystem: web
tags: [react, tanstack-query, base-ui-dialog, rule-settings, tdd]

# Dependency graph
requires:
  - phase: 29-02
    provides: "ruleOverrides / getRuleSettingsResponse / setRuleOverridesRequest / setRuleOverridesResponse contracts — the shapes useRuleSettings parses through"
  - phase: 29-13
    provides: "GET/PUT /api/settings/rules HTTP route — the endpoint useRuleSettings calls"
provides:
  - "useRuleSettings hook — query + non-optimistic per-group mutation + invalidate-on-success, mirrors useRuleTags.ts"
  - "RuleSettingsModal — gear-icon modal grouped by engine (Entry/Picker · Exit Advisor · Regime Bands) with effective+default display and per-group reset/save"
  - "Gear-icon trigger mounted in Shell.tsx's top bar"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "flattenNumeric/lookupLeaf/unflatten (RuleSettingsModal.tsx) — a generic, landmine-free way to render/edit every leaf of a RuleConfig group without hand-listing ~25 fields: recursion is typed over `unknown` (never assigned to an index-signature-typed variable), so it never hits the mapped-type-vs-index-signature TS incompatibility 29-13 discovered for zod-inferred types."
    - "DialogTrigger render={<Button .../>} — composes the shared system Button onto the base-ui Dialog trigger's a11y/behavior, matching DialogClose's existing precedent in dialog.tsx exactly (same idiom, new call site)."

key-files:
  created:
    - apps/web/src/hooks/useRuleSettings.ts
    - apps/web/src/hooks/useRuleSettings.test.ts
    - apps/web/src/screens/RuleSettingsModal.tsx
    - apps/web/src/screens/RuleSettingsModal.test.tsx
  modified:
    - apps/web/src/components/Shell.tsx

key-decisions:
  - "Editing sends the FULL edited group object on Save, not a leaf-level partial — every leaf of the group is already rendered as an input (fed from `effective`), so reconstructing the complete group from the rendered rows is both simpler and safer than tracking per-leaf deltas: the server's weight-sum-100 and hysteresis-pair refinements require complete objects anyway (a partial weight set or single-sided rung is rejected by the contract regardless), so sending a partial would only add client-side complexity for no gain."
  - "flatten/lookup/unflatten helpers operate on `unknown`-typed parameters, never on an explicit index-signature type — this sidesteps the exact TS mapped-type-vs-index-signature incompatibility 29-13-SUMMARY.md documented (zod's z.infer output doesn't get the implicit-index-signature leniency a hand-written type gets). Reading via `unknown` + a type-guard (`isRecord`) has no such landmine since nothing is ever assigned INTO an index-signature-typed variable."
  - "useRuleSettings has no `enabled` guard (unlike useRuleTags' calendarId gate) — the settings endpoint takes no required param and is always valid once authenticated, so the lesson from RULE-01's empty-calendarId→401 gotcha doesn't apply here; there is no invalid-input state to guard against."

requirements-completed: []

coverage:
  - id: RULE-SETTINGS-UI-01
    description: "useRuleSettings mirrors useRuleTags: query + non-optimistic mutation + invalidate-on-success; resetGroup(group) PUTs { [group]: null }"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useRuleSettings.test.ts (4 tests: fetch/parse, non-optimistic save+invalidate, reset-per-group, save-failure error surfacing)"
        status: pass
    human_judgment: false
  - id: RULE-SETTINGS-UI-02
    description: "Gear icon in Shell top bar opens a modal grouped by engine (Entry/Picker · Exit Advisor · Regime Bands); an overridden knob shows effective + default; each group has a reset-to-defaults button"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/RuleSettingsModal.test.tsx (4 tests: closed-until-clicked + 3 groups render, effective+default display, reset wired to resetGroup, save wired to saveGroup with the edited patch)"
        status: pass
      - kind: manual
        ref: "Human-verify checkpoint (Task 3) — visual placement/grouping/effective-default/reset/validation-error surfacing"
        status: auto-approved (AUTO_MODE)
    human_judgment: true

duration: ~20min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 14: Runtime Rule Settings — Gear-Icon Settings Modal Summary

**A gear icon in the Shell top bar opens a Dialog modal grouped by engine (Entry/Picker · Exit Advisor · Regime Bands), backed by a useRuleSettings hook that mirrors useRuleTags' query + non-optimistic mutation + invalidate shape exactly — every curated knob renders as an editable row showing its effective value, with the code default shown alongside when overridden, and each group has its own Save + Reset-to-defaults action.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-10
- **Tasks:** 3/3 completed (Task 3 was the human-verify checkpoint — auto-approved under AUTO_MODE)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `useRuleSettings()` — a `useQuery(["settings","rules"])` for GET `/api/settings/rules`
  parsed through `getRuleSettingsResponse`, exposing `{ defaults, overrides, effective }`; a
  non-optimistic per-group PUT (`saveGroup(group, overrides)` / `resetGroup(group)` →
  `{ [group]: null }`) that never flips local state before the PUT resolves (T-29-19) and
  invalidates the settings query on success — the exact same shape as `useRuleTags.ts`, with
  group-keyed errors instead of hash-keyed.
- `RuleSettingsModal` — a `Dialog`/`DialogTrigger`/`DialogContent` composition (the existing
  wrapper, no hand-rolled modal) rendering three `Panel` groups. Each group's knobs are
  generated by recursively flattening the group's `effective` config into leaf rows (no
  hand-listed ~25-field descriptor list needed) — every leaf renders as a labeled number
  input; when `overrides` has that leaf, the row also shows `default {value}` next to the
  input. Each group has a `Reset to defaults` button (`resetGroup`) and a `Save` button that
  reconstructs the full edited group object and calls `saveGroup`.
- `Shell.tsx` gained a gear-icon `DialogTrigger` (lucide-react `Settings` icon) on the right
  side of its top bar, composed onto the shared `<Button variant="ghost">` primitive via the
  `render` prop — the same idiom `DialogClose` already uses in `dialog.tsx`, so the gear gets
  the shared Button's focus-ring/hover treatment for free.
- Both TDD suites RED→GREEN confirmed (implementation module moved aside, test run showed an
  import-resolution failure, restored, reran green): `useRuleSettings.test.ts` (4 tests) and
  `RuleSettingsModal.test.tsx` (4 tests, mocking the hook module the same way
  `Analyzer.test.tsx` mocks `usePicker`).
- Full web suite (46 files, 526 tests) green after wiring the gear into the always-mounted
  `Shell` — no regression to any screen that renders through `Shell`.
- `bun run typecheck && bun run lint` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: useRuleSettings hook — query + non-optimistic mutation + invalidate** -
   `d09d7c6` (feat, TDD RED→GREEN — RED confirmed via a real failing run before the
   implementation file existed)
2. **Task 2: RuleSettingsModal + Shell.tsx gear trigger** - `630d2f1` (feat, TDD RED→GREEN)

## Files Created/Modified

- `apps/web/src/hooks/useRuleSettings.ts` - the settings data hook (query + `saveGroup` +
  `resetGroup`, group-keyed errors).
- `apps/web/src/hooks/useRuleSettings.test.ts` - 4 tests covering every `<behavior>` bullet.
- `apps/web/src/screens/RuleSettingsModal.tsx` - the modal (`flattenNumeric`/`lookupLeaf`/
  `unflatten` helpers + `GroupPanel` + the gear `DialogTrigger`).
- `apps/web/src/screens/RuleSettingsModal.test.tsx` - 4 tests (closed-until-clicked + 3
  groups, effective+default display, reset wiring, save wiring).
- `apps/web/src/components/Shell.tsx` - mounts `<RuleSettingsModal />` on the right side of
  the sticky header, next to the existing `NAV_TABS` group.

## Decisions Made

- Editing sends the full edited group object on Save rather than a leaf-level partial patch
  (see key-decisions above) — simpler client code, and the server's weight-sum/hysteresis
  refinements require complete sub-objects anyway.
- The generic `flattenNumeric`/`lookupLeaf`/`unflatten` traversal operates entirely on
  `unknown`-typed parameters narrowed by an `isRecord` type guard — this was a deliberate
  choice to avoid the exact TS mapped-type-vs-index-signature incompatibility documented in
  29-13-SUMMARY.md (a zod-inferred `RuleConfig`/`RuleOverrides` value cannot be assigned to a
  plain index-signature-typed variable). Reading through `unknown` has no such landmine.
- No `enabled` guard was added to `useRuleSettings` — unlike `useRuleTags`'s
  empty-`calendarId`→401 gotcha, the settings endpoint takes no required parameter, so there
  is no invalid-input state to guard against.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria were met without
any auto-fixes or blocking issues.

## Checkpoint Handling

Task 3 (`checkpoint:human-verify`, gate="blocking") is a visual-placement/grouping/
effective-default/reset/validation-error-surfacing check. AUTO_MODE was active for this run
per the orchestrator's instructions, so this checkpoint was auto-approved rather than
paused on:

⚡ Auto-approved checkpoint (visual UAT deferred to `/gsd-verify-work 29`)

The automated coverage above (both component-level TDD suites, full web suite, typecheck,
lint) verifies the functional behavior the checkpoint's `how-to-verify` steps describe
(gear placement/affordance, three groups, effective+default display, reset wiring, save
wiring). The one item the automated suites cannot cover — the live server rejecting a bad
edit (weights not summing to 100, single-sided rung) with a *visible* error in the running
app — is deferred to the phase-level `/gsd-verify-work 29` visual UAT, consistent with
29-VALIDATION.md's Manual-Only classification for this item.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The curated ~20 knobs are now readable and editable from the dashboard (gear icon → modal
  → save/reset per group), closing the loop opened by 29-13's HTTP/MCP surface.
- No blockers. `bun run typecheck && bun run lint` clean; full web suite (46 files, 526
  tests) green.
- Deferred: live-server validation-error visual check (weight-sum / hysteresis-pair
  rejection) — part of the phase-level `/gsd-verify-work 29` UAT per 29-VALIDATION.md.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 5 created/modified files verified present on disk. Both task commits (`d09d7c6`,
`630d2f1`) verified present in git history.
