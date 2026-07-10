---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
plan: 01
subsystem: contracts
tags: [zod, rule-settings, explainer-registry, preview-contract]
dependency-graph:
  requires: []
  provides:
    - "packages/contracts/src/rule-explainers.ts (RULE_EXPLAINERS, RuleExplainer, RuleAffectedSurface)"
    - "packages/contracts/src/rule-preview.ts (previewRuleOverridesRequest, previewRuleOverridesResponse)"
    - "ruleConfig exported from rule-settings.ts"
  affects:
    - "apps/server (future preview HTTP route)"
    - "apps/web (Rule Settings modal v2 — explainer + preview UI, later plans this phase)"
tech-stack:
  added: []
  patterns:
    - "Schema-derived completeness test: recursive ZodObject walk into dotted leaf paths, never a hand-copied literal array"
    - "Identity reuse of an existing Zod schema for a sibling contract (previewRuleOverridesRequest === ruleOverrides)"
key-files:
  created:
    - packages/contracts/src/rule-explainers.ts
    - packages/contracts/src/rule-explainers.test.ts
    - packages/contracts/src/rule-preview.ts
    - packages/contracts/src/rule-preview.test.ts
  modified:
    - packages/contracts/src/rule-settings.ts
    - packages/contracts/src/index.ts
decisions:
  - "Explainer completeness bar: walk ruleConfig.shape recursively (instanceof z.ZodObject) rather than hand-listing 43 dotted paths — proven fail-closed by a scratch-field injection + revert (see below)."
  - "affects field uses the plan's fixed 3-value enum (Picker candidates / Exit verdicts / Regime board), not the looser 'Picker universe' wording from the 32-CONTEXT.md prose example — the two locked tone examples (deltaBandMax, exits.take.plus15Arm) are matched verbatim in summary/direction text, with affects as a separate structured field."
  - "previewRuleOverridesResponse's exits branch shape follows the plan's exact spec (calendarId + current{verdict,rung,ruleId} + staged{verdict,rung,ruleId,metric}); regime preview is explicitly NOT part of this response (client-side per 32-CONTEXT.md)."
metrics:
  duration: "~1h"
  completed: 2026-07-10
status: complete
---

# Phase 32 Plan 01: Explainer registry + preview contract Summary

One-line: schema-derived per-knob explainer registry (43 leaf paths, Hemingway trader copy) plus a preview request/response Zod contract that reuses `ruleOverrides` verbatim and returns re-scored candidates with `oldScore` inline.

## What shipped

**Task 1 — `RULE_EXPLAINERS` (B6).** `ruleConfig` is now exported from `rule-settings.ts`
(one-line change). `rule-explainers.ts` exports `RULE_EXPLAINERS: Readonly<Record<string,
RuleExplainer>>` with `{ summary, unit, direction, affects }` for all 43 real leaf paths a
recursive walk of `ruleConfig.shape` produces (6 delta/DTE knobs + 9 scoring weights + 2
debitFit band edges + 3 VIX-ladder boundaries + maxOpenCalendars + 4 sizing tiers under
`picker`; 6 TAKE + 4 STOP rung arm/disarm values under `exits`; 8 warn/crisis band edges
under `regime`). `docs/architecture/rule-overrides.md`'s "~20 knobs" figure counts the 9
weights as one group — the schema-derived leaf count is 43, and the registry covers every
one of them, not the rounded prose estimate.

`rule-explainers.test.ts` derives its path list by walking `ruleConfig.shape` with
`instanceof z.ZodObject` recursion — never a hand-copied array (the plan's Pitfall-4 guard).
It asserts a 1:1 set-equality between the derived paths and `Object.keys(RULE_EXPLAINERS)`,
non-empty copy per entry, and correct `affects` tagging per top-level group. Two tests pin
the locked copy-tone examples from `32-CONTEXT.md` (`picker.deltaBandMax`,
`exits.take.plus15Arm`) verbatim.

**Task 2 — preview contract (B4/B5/B7).** `rule-preview.ts` exports
`previewRuleOverridesRequest` as a literal identity reuse of `ruleOverrides` (`export const
previewRuleOverridesRequest = ruleOverrides;` — same object reference, not a copy), so the
preview body inherits the exact `.strict()` + weight-sum-100 + hysteresis-pair refinements
the PUT route already enforces. `previewRuleOverridesResponse` is `.strict()` at every level:
`asOf: string | null`; `picker: null | { candidates: (pickerCandidate & { oldScore: number
})[], gate: {before,after}|null, sizing: {before,after}|null, universeNote: string|null }`;
`exits: null | { calendarId, current: {verdict,rung,ruleId}, staged:
{verdict,rung,ruleId,metric} }[]`. Regime preview is deliberately absent from this schema
(client-side per 32-CONTEXT.md's ORCHESTRATOR RESOLVED decision).

Both new modules plus `RULE_EXPLAINERS`/`RuleExplainer`/`RuleAffectedSurface` are barrel-
exported through `packages/contracts/src/index.ts`, grouped beside the existing
`rule-settings` export block.

## TDD Gate Compliance

Both tasks followed RED → GREEN:
- Task 1: `test(32-01)` commit ships `rule-explainers.test.ts` + an empty `RULE_EXPLAINERS`
  stub (all assertions fail on missing/undefined entries, not an import error) → `feat(32-01)`
  commit fills in all 43 entries, suite green.
- Task 2: `test(32-01)` commit ships `rule-preview.test.ts` + empty `.strict({})` stubs for
  both schemas (identity check, round-trip, and `.strict()` rejection tests all fail on shape
  mismatch) → `feat(32-01)` commit fills in the real schemas + barrel exports, suite green.

## Completeness-test fail-closed proof (acceptance criteria)

Per the plan's acceptance criteria ("adding a knob to `ruleConfig` without a registry entry
fails the test... prove by a scratch edit reverted"): a `scratchProbeField: z.number()` field
was injected into `pickerConfig` in `rule-settings.ts`, `rule-explainers.test.ts` was run
(3 of 49 tests failed — the 1:1 set-equality check, the per-path copy-presence check for the
new path, and the `affects`-tagging check all failed with `undefined` where an entry was
expected), then the field was reverted via `Edit` (not `git checkout`) back to the exact
committed text — confirmed by an empty `git diff --stat` on the file afterward, and the full
suite re-run green (102/102 across the three rule-settings/rule-explainers/rule-preview test
files).

## Deviations from Plan

None — plan executed exactly as written. `ruleConfig`'s actual leaf-path count (43) exceeds
the phase-level doc's approximate "~20 knobs" figure because that figure counts the 9-weight
group as one knob; the registry and its completeness test both operate on the real schema
leaves, which is the acceptance bar the plan specifies.

## Known Stubs

None. Both `rule-explainers.ts` and `rule-preview.ts` are fully wired contract modules —
no UI consumes them yet (that's Plans 02+ this phase), but nothing here is a placeholder.

## Verification

- `bun run test -- packages/contracts/src/rule-explainers.test.ts packages/contracts/src/rule-preview.test.ts` — 59 tests, green
- `bun run typecheck` — clean
- `bun run lint` — clean (0 errors)
- `bun run test` (full workspace suite) — 282 files / 3087 tests, green
- Completeness fail-closed behavior proven and reverted (see above)

## Self-Check: PASSED

- FOUND: packages/contracts/src/rule-explainers.ts
- FOUND: packages/contracts/src/rule-explainers.test.ts
- FOUND: packages/contracts/src/rule-preview.ts
- FOUND: packages/contracts/src/rule-preview.test.ts
- FOUND commit 1f50008 (test: schema-derived completeness test)
- FOUND commit 872cad2 (feat: explainer registry)
- FOUND commit 83eb30d (test: preview round-trip tests)
- FOUND commit b341711 (feat: preview contract + barrel exports)
