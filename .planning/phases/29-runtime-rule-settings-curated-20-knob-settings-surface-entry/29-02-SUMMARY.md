---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 02
subsystem: contracts
tags: [zod, contracts, validation, rule-overrides, security]

# Dependency graph
requires: ["29-01 (docs-before-code: rule-overrides.md architecture doc, D25)"]
provides:
  - "ruleOverrides Zod schema — the single validation seam for the settings PUT route (29-13), storage repo (29-08), and settings use-cases (29-09)"
  - "getRuleSettingsResponse / setRuleOverridesRequest / setRuleOverridesResponse contracts + inferred types"
affects: [29-08 (rule_overrides repo), 29-09 (settings use-cases), 29-13 (PUT route)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nested .strict() Zod objects at every level — unknown keys rejected, never .passthrough()"
    - "All-9-or-none weight object: Zod's own required-field check on a non-optional inner object does the completeness check; a .refine() adds the sum-to-100 invariant"
    - "Arm/disarm hysteresis pairs validated via a shared validRungPair(arm, disarm, direction) helper, one .refine() per rung"

key-files:
  created: [packages/contracts/src/rule-settings.ts, packages/contracts/src/rule-settings.test.ts]
  modified: [packages/contracts/src/index.ts]

key-decisions:
  - "Weight-sum enforced as HARD VALIDATION (reject non-100), not server-side normalization — matches rules.test.ts's existing sum-to-exactly-100 invariant (per plan's Claude's-Discretion decision, documented in the schema file header)"
  - "picker.weights all-9-or-none achieved for free by Zod's required-field check on the (non-optional-field) pickerWeightsShape object — no separate completeness refine needed, only the sum refine"
  - "exits.take/exits.stop rungs are FLAT fields (plus15Arm/plus15Disarm etc.), not nested {arm,disarm} pairs — matches the plan's action text and read_first exit-rules.ts field naming"
  - "ruleConfig (full resolved shape for defaults/effective) is a separate all-required schema, not ruleOverrides.required() — kept as a hand-written sibling since the two shapes diverge structurally (weights is required+complete in ruleConfig vs optional+all-9-or-none in ruleOverrides)"

requirements-completed: []

coverage:
  - id: T1
    description: "Unknown key at any nesting level (picker.slopeNormalizer, exits.take.plus20Arm, regime.fooWarn, top-level foo) is rejected"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/contracts/src/rule-settings.test.ts (whitelist + excluded-knobs describe blocks)"
        status: pass
    human_judgment: false
  - id: T2
    description: "picker.weights all-9-present-and-sum-100 enforced; <9 keys, sum=99, sum=101 all rejected; sum=100 passes"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/contracts/src/rule-settings.test.ts (sum-to-100 describe block)"
        status: pass
    human_judgment: false
  - id: T3
    description: "TAKE rung single-sided edit rejected; disarm>=arm rejected; disarm<arm passes; empty take group passes"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/contracts/src/rule-settings.test.ts (exits.take describe block)"
        status: pass
    human_judgment: false
  - id: T4
    description: "STOP rung disarm<=arm (deeper or equal) rejected; disarm>arm (closer to zero) passes; single-sided rejected"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/contracts/src/rule-settings.test.ts (exits.stop describe block)"
        status: pass
    human_judgment: false
  - id: T5
    description: "Only the curated ~20 knobs are expressible; excluded knobs (SLOPE_NORMALIZER, gexFit credits, fill haircut, gate hysteresis internals, loss cooldown, roll windows) have no schema field"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/contracts/src/rule-settings.test.ts (excluded knobs describe block, 6 cases)"
        status: pass
    human_judgment: false
  - id: T6
    description: "barrel exports ruleOverrides/getRuleSettingsResponse/setRuleOverridesRequest/setRuleOverridesResponse + inferred types"
    verification:
      - kind: automated
        ref: "bun run typecheck (packages/contracts) clean"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 02: Runtime Rule Settings — ruleOverrides Contract Summary

**Defined the nested, partial, whitelisted Zod contract (`ruleOverrides`) that is the single validation seam for the runtime rule-settings PUT route, storage repo, and settings use-cases — expressing exactly the curated ~20 knobs with weight-sum and hysteresis-pair invariants enforced at the parse boundary.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-10T23:00:00Z
- **Completed:** 2026-07-10T23:12:00Z
- **Tasks:** 1
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Created `packages/contracts/src/rule-settings.ts`: nested `.strict()` Zod objects for the
  `picker` / `exits` / `regime` override groups, each field optional (partial deltas) and
  each top-level group `.nullable()` (reset-per-group sentinel).
- Weight-sum invariant: `picker.weights` is all-9-or-none (Zod's native required-field check
  on the non-optional `pickerWeightsShape` inner object) plus a `.refine()` that rejects any
  9-weight set not summing to exactly 100 — hard validation, not normalization.
- Hysteresis invariant: TAKE rungs (`plus15/10/5 Arm/Disarm`) and STOP rungs
  (`minus50/25 Arm/Disarm`) each validated by a shared `validRungPair(arm, disarm, direction)`
  helper via one `.refine()` per rung — rejects single-sided edits and wrong-ordered pairs
  (TAKE: disarm < arm; STOP: disarm > arm, since STOP values are negative).
- `getRuleSettingsResponse` (`{ defaults, overrides, effective }`),
  `setRuleOverridesRequest` (the partial `ruleOverrides`), and `setRuleOverridesResponse`
  (`{ overrides, effective }`) contracts, plus a hand-written `ruleConfig` (all-required
  full resolved shape) for `defaults`/`effective`. All types inferred and exported.
- Re-exported everything from `packages/contracts/src/index.ts` following the existing
  `export { ... } from "./file.ts"` + `export type { ... }` barrel idiom.
- TDD RED→GREEN: wrote 32 tests first (`bunx vitest run` confirmed the RED failure —
  `Cannot find module './rule-settings.ts'`), then implemented and reran (32/32 green).

## Task Commits

Each task was committed atomically (single commit at green, per project `tdd.md` +
17.1-01/18-03 precedent — TDD RED and GREEN land together, not as separate commits):

1. **Task 1: RED→GREEN the ruleOverrides Zod schema — whitelist + weight-sum + hysteresis-pair refines** - `58b03ee` (feat)

## Files Created/Modified

- `packages/contracts/src/rule-settings.ts` - New: `ruleOverrides`, `getRuleSettingsResponse`,
  `setRuleOverridesRequest`, `setRuleOverridesResponse` schemas + types
- `packages/contracts/src/rule-settings.test.ts` - New: 32 tests covering every `<behavior>`
  bullet in the plan
- `packages/contracts/src/index.ts` - Barrel re-export of the new schemas + types

## Decisions Made

- Weight-sum is HARD VALIDATION (reject when the 9 weights don't sum to 100), matching the
  plan's Claude's-Discretion decision — documented in the schema file's own header comment,
  not just here.
- `picker.weights` all-9-or-none needed no separate completeness `.refine()` — a non-optional
  inner Zod object (`pickerWeightsShape`, no `.optional()` on its 9 fields) already fails
  parse when any key is missing. Only the sum-to-100 check needed an explicit refine.
- `exits.take`/`exits.stop` use flat field names (`plus15Arm`, `plus15Disarm`, ...) rather
  than a nested `{ arm, disarm }` shape per rung — this is what the plan's action text and
  `exit-rules.ts` read_first note both specify.
- `ruleConfig` (the full resolved shape backing `defaults`/`effective`) is a hand-written
  sibling schema, not derived from `ruleOverrides` via `.required()` — the two structurally
  diverge (`weights` is optional+all-9-or-none in overrides, required+always-complete in
  config), so deriving one from the other would need per-field overrides anyway.

## Deviations from Plan

None — plan executed exactly as written. The single-commit-at-green pattern (rather than
separate `test(...)`/`feat(...)` commits) follows this project's own established `tdd.md`
rule ("Commit only at green") and matches prior-plan precedent (17.1-01, 18-03) already
recorded in STATE.md's Accumulated Context.

## Issues Encountered

None.

## Self-Check Results

- `packages/contracts/src/rule-settings.ts` — FOUND
- `packages/contracts/src/rule-settings.test.ts` — FOUND
- Commit `58b03ee` — FOUND in `git log --oneline`

## TDD Gate Compliance

Plan frontmatter is `type: tdd`, `tdd="true"` on Task 1. RED phase confirmed via a real
`bunx vitest run` failure (`Cannot find module './rule-settings.ts'` — the right reason, an
import error from the not-yet-created implementation file, not a syntax/assertion issue).
GREEN phase confirmed via a real passing run (32/32). Both phases landed in the same commit
per the project's own TDD rule and established precedent — no separate `test(...)` commit
exists, which is expected and matches prior plans, not a gate violation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The `ruleOverrides` schema is the validation seam the storage repo (29-08) and the PUT route
(29-13) must both parse through. Downstream plans building `resolvePickerRuleConfig` /
`resolveExitRuleConfig` / `resolveRegimeRuleConfig` (per docs/architecture/rule-overrides.md's
Pattern 1) should consume `RuleOverrides`'s per-group types as their optional-param input
shape, and the full `RuleConfig` type as their return shape.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED
