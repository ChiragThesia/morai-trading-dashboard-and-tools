---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
plan: 05
subsystem: web
tags: [react, tooltip, rule-settings, explainer-ui]
dependency-graph:
  requires:
    - "packages/contracts/src/rule-explainers.ts (RULE_EXPLAINERS, Plan 01)"
  provides:
    - "RuleSettingsModal renders per-knob captions/affects tags/direction+unit popovers from RULE_EXPLAINERS"
    - "Tooltip primitive (apps/web/src/components/ui/tooltip.tsx) has its first live consumer"
  affects:
    - "apps/web (Plan 06 preview flow lands in the same modal file)"
tech-stack:
  added: []
  patterns:
    - "Registry lookup key = [group, ...row.path].join('.') against RULE_EXPLAINERS, fail-soft to undefined (no crash) rather than an impossible-but-unguarded assertion"
    - "Single TooltipProvider at the modal body level; per-row Tooltip/TooltipTrigger/TooltipContent instances share it (base-ui/react tooltip primitive, zero new dependency)"
key-files:
  created: []
  modified:
    - apps/web/src/screens/RuleSettingsModal.tsx
    - apps/web/src/screens/RuleSettingsModal.test.tsx
decisions:
  - "Tasks 1 (caption/tag) and 2 (info-popover) landed in one commit -- both touch the same GroupPanel row JSX block, so splitting into two commits would require an artificial intermediate render state with no test value."
metrics:
  duration: "~30m"
  completed: 2026-07-10
status: complete
---

# Phase 32 Plan 05: Explain-what-you-touch modal UI Summary

One-line: `RuleSettingsModal` now renders each knob row's registry summary caption, affects
tag, and an info-icon popover (direction + unit) sourced entirely from `RULE_EXPLAINERS`,
using the Tooltip primitive's first live consumer, with all Phase-29 v1 behaviors unregressed.

## What shipped

**Task 1 -- per-knob caption + affected-surface tag (B6).** In `GroupPanel`'s row loop, each
`LeafRow` now looks up `RULE_EXPLAINERS[[group, ...row.path].join(".")]` via a small
`explainerKey(group, row)` helper. When present, the row renders the registry `summary` as a
dim inline caption under the label and the `affects` value (`Picker candidates` / `Exit
verdicts` / `Regime board`) as a compact tag chip beside it. The lookup fails soft -- an
`undefined` explainer renders no caption/tag rather than throwing, even though Plan 01's
completeness test makes that path unreachable in practice. No inline copy strings were
added; every word rendered comes from the registry.

**Task 2 -- info-icon popover, Tooltip primitive's first consumer (B9).** Each row's label
now has an `Info` (lucide-react) `TooltipTrigger` (`aria-label="{label} details"`, a real
focusable button by default from `@base-ui/react/tooltip`) that opens a `TooltipContent`
showing the registry `direction` sentence and `unit` in parentheses. One `TooltipProvider`
wraps the whole modal body (inside `DialogContent`, outside the `GroupPanel` map) so all rows
share it -- no per-row provider, no hand-rolled popover, zero new dependency.

**v1 behavior preservation.** `flattenNumeric`, `lookupLeaf`, `unflatten`, `handleSave`, the
per-group Save/Reset buttons, and the WR-02 clear-field-falls-back-to-effective-value guard
are all byte-unchanged. All 5 pre-existing tests (open-on-click, overridden-value display,
reset calls `resetGroup`, save calls `saveGroup` with patch, clearing falls back to effective
value) pass unmodified.

## TDD Gate Compliance

RED confirmed before implementation: 2 new tests were added to
`RuleSettingsModal.test.tsx` (representative-row caption/tag assertions for
`picker.weights.slope` / `exits.take.plus15Arm` / `regime.vvixWarn`, and a focus-triggered
popover assertion for `exits.take.plus15Arm`'s direction+unit) and run against the
unmodified component -- both failed (missing caption/tag text; `getByLabelText` found no
info-icon trigger), while the 5 pre-existing tests stayed green. Implementation then made all
7 tests pass. This plan's tasks do not carry `tdd="true"` frontmatter, so RED and GREEN were
not committed as separate `test(...)`/`feat(...)` commits -- both land in the single
`feat(32-05)` commit per the deviation noted above.

## Deviations from Plan

**1. [No rule -- execution efficiency] Tasks 1 and 2 combined into one commit.** Both tasks
modify the exact same JSX block inside `GroupPanel`'s row loop (caption+tag sit directly next
to the info-icon trigger in the row header). Splitting them into two commits would require
committing an intermediate render state (caption/tag with no popover) with no additional test
coverage, so they were implemented and committed together. Not a Rule 1-4 deviation --
tracked here per gsd's task-commit-atomicity default, with rationale.

None of the deviation rules (bug fix, missing critical functionality, blocking issue,
architectural change) applied -- the plan's `<action>` and `<behavior>` blocks matched the
existing code shape exactly (registry shape from Plan 01, Tooltip primitive already vendored
and typed correctly).

## Known Stubs

None. Every rendered row that has a `RULE_EXPLAINERS` entry (all 43, per Plan 01's
completeness test) shows real registry copy -- no placeholder text, no hardcoded empty
fallback.

## Threat Flags

None new. `T-32-11` (registry copy → DOM, XSS, accept) from the plan's threat model is
satisfied as written: `summary`/`affects`/`direction`/`unit` are all React children of
app-authored static strings (auto-escaped), no user input reaches this render path.
`T-32-SC` (zero new deps) holds -- `Tooltip`/`TooltipTrigger`/`TooltipContent`/
`TooltipProvider` were already vendored at `apps/web/src/components/ui/tooltip.tsx`.

## Verification

- `bun run test -- apps/web/src/screens/RuleSettingsModal.test.tsx` -- 7/7 tests green (5
  pre-existing + 2 new)
- `bun run typecheck` -- clean
- `bun run lint` -- clean (0 errors; pre-existing `[boundaries]` legacy-selector-syntax
  warning is unrelated and out of scope)
- `bun run test` (full workspace) -- 285 files / 3128 tests, green

## Self-Check: PASSED

- FOUND: apps/web/src/screens/RuleSettingsModal.tsx (modified)
- FOUND: apps/web/src/screens/RuleSettingsModal.test.tsx (modified)
- FOUND commit 1badc8c (feat(32-05): render per-knob explainer captions/tags + info-icon popover)
