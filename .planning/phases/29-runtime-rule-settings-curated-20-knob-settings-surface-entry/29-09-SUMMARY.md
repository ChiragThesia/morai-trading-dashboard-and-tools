---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 09
subsystem: settings-application
tags: [hexagonal-core, merge-function, result-type, settings, tdd]

# Dependency graph
requires:
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 02)
    provides: "ruleOverrides/ruleConfig Zod contract shape (picker/exits/regime groups) — the shape this plan's ports/use-cases structurally mirror at the JSONB storage boundary"
provides:
  - "ForReadingRuleOverrides / ForWritingRuleOverrides driven ports — the ones the adapters repo (29-08) implements"
  - "makeGetRuleSettingsUseCase / makeSetRuleOverridesUseCase — the two use-cases backing the GET/PUT rule-settings surface"
  - "computeEffective / mergeStoredOverrides pure merge helpers (settings/domain/merge.ts)"
affects: [29-08 (rule_overrides repo implements ForReadingRuleOverrides/ForWritingRuleOverrides), 29-13 (server composition root wires defaults + the GET/PUT route to these two use-cases)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Engine-agnostic JsonObject-shaped merge — computeEffective/mergeStoredOverrides never name a single picker/exits/regime field, so the settings context never imports contracts or engine domain/ code (hexagon law rule 7)"
    - "Recursive deep-merge over plain nested objects (not a 1-level shallow merge) — correctly handles both picker's atomic all-or-none sub-objects (weights/vixLadder/sizingContracts) and exits' partial per-rung patches (exits.take.plus15Arm alone) with the SAME function"
    - "null = reset-per-group sentinel is a mergeStoredOverrides-only concept; computeEffective's second argument (stored overrides) never contains a null group by construction"

key-files:
  created:
    - packages/core/src/settings/domain/merge.ts
    - packages/core/src/settings/domain/merge.test.ts
    - packages/core/src/settings/application/ports.ts
    - packages/core/src/settings/application/getRuleSettings.ts
    - packages/core/src/settings/application/getRuleSettings.test.ts
    - packages/core/src/settings/application/setRuleOverrides.ts
    - packages/core/src/settings/application/setRuleOverrides.test.ts
  modified:
    - packages/core/src/index.ts

key-decisions:
  - "computeEffective/mergeStoredOverrides operate on a generic JsonObject type (Record<string, JsonValue>), never a hand-mirrored copy of the contract's picker/exits/regime field names — this makes the merge provably engine-agnostic (the plan's must_have) without needing 60+ lines of duplicated Zod-shape-mirroring types, and needs zero `as` casts since input/output share the same nominal JsonObject type throughout"
  - "Deep (not shallow) recursion at every nesting level: proven correct for BOTH picker (atomic all-or-none sub-objects like weights/vixLadder — deep merge produces the same result as a wholesale replace, since those sub-objects are always complete when present, per the 29-02 contract's all-9-or-none/complete-pair refines) and exits (partial per-rung patches like { take: { plus15Arm, plus15Disarm } } need field-level merging within `take`, not a whole-group replace that would silently drop unrelated rungs)"
  - "StorageError is defined locally in settings/application/ports.ts (structurally identical to journal's) and NOT re-exported a second time from the core barrel under the same name — same convention already established by exits/index.ts and backtest/index.ts"
  - "No settings/index.ts bounded-context barrel created — the plan's files_modified list only names packages/core/src/index.ts, so the top-level barrel imports directly from settings/domain/merge.ts and settings/application/{ports,getRuleSettings,setRuleOverrides}.ts, matching the plan's exact file scope"

requirements-completed: []

coverage:
  - id: T1
    description: "computeEffective(defaults, {}) deep-equals defaults; a single override field wins while all sibling fields (including nested sub-object patches like exits.take single-rung) stay/merge correctly"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/core/src/settings/domain/merge.test.ts (computeEffective describe block, 3 tests)"
        status: pass
    human_judgment: false
  - id: T2
    description: "mergeStoredOverrides: a group set to null deletes that group entirely; an object patch shallow/deep-merges into the group leaving other groups untouched; never emits a null group in output, including when resetting a group with no prior value"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/core/src/settings/domain/merge.test.ts (mergeStoredOverrides describe block, 4 tests)"
        status: pass
    human_judgment: false
  - id: T3
    description: "makeGetRuleSettingsUseCase returns { defaults, overrides, effective } with effective the per-field merge; empty overrides -> effective deep-equals defaults; read error propagates as Result err"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/core/src/settings/application/getRuleSettings.test.ts (3 tests)"
        status: pass
    human_judgment: false
  - id: T4
    description: "makeSetRuleOverridesUseCase reads current, merges the request patch, writes, and returns { overrides, effective }; { picker: null } persists overrides without the picker group; write and read errors both propagate as Result err (read error never reaches write)"
    verification:
      - kind: automated
        ref: "bunx vitest run packages/core/src/settings/application/setRuleOverrides.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: T5
    description: "The settings context imports NO picker/exits/analytics domain code; ports follow the ForVerbingNoun convention; use-cases return Result, no exceptions; ports+use-cases exported from the core barrel"
    verification:
      - kind: automated
        ref: "rg -n \"picker/domain|exits/domain|analytics/domain\" packages/core/src/settings/ (0 matches); bun run typecheck && bunx eslint packages/core/src/index.ts packages/core/src/settings/ (both clean); bunx vitest run packages/core (92 files, 1063 tests, all green)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 09: Settings Application Layer — Merge Helpers + GET/PUT Use-Cases Summary

**Engine-agnostic settings bounded context: a generic JsonObject-shaped `computeEffective`/`mergeStoredOverrides` pair plus two `Result`-returning use-cases (`makeGetRuleSettingsUseCase`, `makeSetRuleOverridesUseCase`) that never import picker/exits/analytics domain code, ready for the storage repo (29-08) and server surface (29-13) to wire in.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-10T23:50:00Z
- **Completed:** 2026-07-11T00:12:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- `packages/core/src/settings/domain/merge.ts`: a local `JsonObject` type (no picker/exits/
  regime field names anywhere) backs `RuleConfig` (defaults/effective) and
  `StoredRuleOverrides` (the persisted partial). `computeEffective(defaults, overrides)` and
  `mergeStoredOverrides(current, patch)` share one internal `deepMerge` helper that recurses
  into nested plain objects and replaces primitives/arrays outright — correct for both
  picker's atomic all-or-none sub-objects and exits' partial per-rung patches with the same
  function, and needs zero `as` casts since everything stays nominally `JsonObject`.
- `mergeStoredOverrides`'s top-level keys carry the extra `null` reset-per-group sentinel
  (`{ picker: null }` deletes the picker group's stored keys entirely via `delete
  result[key]`); the function never emits a null value in its returned object.
- `packages/core/src/settings/application/ports.ts`: `ForReadingRuleOverrides` /
  `ForWritingRuleOverrides` driven ports (`ForVerbingNoun` convention) plus a local
  `StorageError` (structurally identical to journal's, per the established per-context
  convention).
- `makeGetRuleSettingsUseCase(deps: { readRuleOverrides; defaults })` reads stored overrides
  and returns `{ defaults, overrides, effective: computeEffective(defaults, overrides) }`,
  propagating a read failure as `Result` err.
- `makeSetRuleOverridesUseCase(deps: { readRuleOverrides; writeRuleOverrides; defaults })`
  reads current overrides, merges the request patch via `mergeStoredOverrides`, writes the
  merged partial, and returns `{ overrides: merged, effective: computeEffective(defaults,
  merged) }`; both the read and write legs propagate failures as `Result` err (a read
  failure never reaches the write call).
- All five new/modified exports re-exported from `packages/core/src/index.ts`, following the
  exits/backtest convention of NOT re-exporting `StorageError` a second time under the same
  bare name.
- Full `@morai/core` suite stays green after the barrel change: 92 test files, 1063 tests.

## Task Commits

Each task was committed at TDD green:

1. **Task 1: settings/domain/merge.ts — pure mergeStoredOverrides + computeEffective** -
   `b1b4fb1` (feat)
2. **Task 2: ports + getRuleSettings + setRuleOverrides use-cases** - `751c44a` (feat)

RED confirmed for both tasks via a real `bunx vitest run` failure (`Cannot find module
'./merge.ts'` / `'./getRuleSettings.ts'` / `'./setRuleOverrides.ts'` — import errors, the
right reason, from test files authored against not-yet-existing implementation modules)
before each implementation file was created. GREEN confirmed via real passing runs (7/7 for
Task 1, 7/7 for Task 2's two use-case files). RED test files and GREEN implementations
landed together in one commit per task, matching this project's own `tdd.md` "commit only at
green" rule and prior-plan precedent (29-02, 29-07 — see those plans' own TDD Gate
Compliance notes).

## Files Created/Modified

- `packages/core/src/settings/domain/merge.ts` - `RuleConfig`, `StoredRuleOverrides`,
  `RuleOverridesPatch` types + `computeEffective`, `mergeStoredOverrides` pure functions.
- `packages/core/src/settings/domain/merge.test.ts` - 7 tests covering every `<behavior>`
  bullet in the plan.
- `packages/core/src/settings/application/ports.ts` - `ForReadingRuleOverrides`,
  `ForWritingRuleOverrides`, local `StorageError`.
- `packages/core/src/settings/application/getRuleSettings.ts` - `makeGetRuleSettingsUseCase`,
  `GetRuleSettingsResult`, `GetRuleSettingsDeps`, `ForRunningGetRuleSettings`.
- `packages/core/src/settings/application/getRuleSettings.test.ts` - 3 tests (merge
  correctness, empty-overrides omission, read-error propagation).
- `packages/core/src/settings/application/setRuleOverrides.ts` -
  `makeSetRuleOverridesUseCase`, `SetRuleOverridesResult`, `SetRuleOverridesDeps`,
  `ForRunningSetRuleOverrides`.
- `packages/core/src/settings/application/setRuleOverrides.test.ts` - 4 tests
  (merge-write-return, reset-per-group persistence, write-error propagation,
  read-error-never-reaches-write propagation).
- `packages/core/src/index.ts` - barrel re-exports for the new settings context (StorageError
  intentionally not re-exported a second time).

## Decisions Made

- Chose a fully generic `JsonObject`-shaped merge over hand-mirroring the contract's
  picker/exits/regime field names into core-local types (as picker/exits/analytics'
  `rule-config.ts` files each do for their OWN engine-specific merge). Those three existing
  `rule-config.ts` files serve a different purpose (feeding each engine's own consumption
  seams with named fields); this plan's `merge.ts` only needs to answer "does this JSON path
  exist in the override, and if so does it win" — which a recursive deep-merge answers
  without ever naming a field, keeping the "engine-agnostic" must-have provably true by
  construction rather than by convention.
- Deep recursion (not the literal word "shallow" from the plan's behavior bullet) at every
  level: verified this produces byte-identical results to a group-level shallow merge for
  picker (its sub-objects are always complete when present per the 29-02 contract's
  all-9-or-none/complete-pair refines) while being the ONLY correct choice for exits (a
  single-rung patch like `{ take: { plus15Arm, plus15Disarm } }` must not wipe out
  `plus10`/`plus5` — a group-level shallow merge would silently drop them).
- No `settings/index.ts` bounded-context barrel — the plan's `files_modified` list scopes
  exactly to `ports.ts`, `merge.ts` (+test), `getRuleSettings.ts` (+test),
  `setRuleOverrides.ts` (+test), and the top-level `packages/core/src/index.ts`; adding an
  unlisted intermediate barrel file would be scope creep the plan didn't ask for.

## Deviations from Plan

None — plan executed exactly as written. The single-commit-at-green pattern (RED test file
and GREEN implementation landing in one commit rather than two) follows this project's own
`tdd.md` rule and matches 29-02/29-07 precedent, already recorded in prior summaries and
STATE.md's Accumulated Context.

## Issues Encountered

- Initial `merge.test.ts` draft used dotted property access (`defaults.picker`,
  `effective.exits`) on the index-signature-typed `JsonObject`, which `tsc` rejected under
  `noPropertyAccessFromIndexSignature` (TS4111) plus a `TS2698` spread-type error. Rule 1
  (auto-fix bug) — switched to bracket access (`defaults["picker"]`) and replaced the
  problematic spread assertion with an explicit literal expectation; re-ran, clean.
- The same draft's fix attempt introduced an `as object` cast to satisfy the spread, which
  ESLint's `consistent-type-assertions` rule correctly rejected (this project's CLAUDE.md/
  typescript.md forbid `as`). Rule 1 — removed the cast entirely in favor of a fully literal
  expected-value object; re-ran lint, clean.
- One `setRuleOverrides.test.ts` assertion initially expected `effective` to deep-equal
  `defaults` after a `{ picker: null }` reset, but the test's own `current` fixture also
  carried a `regime` override that survives the reset — the assertion was wrong, not the
  implementation. Rule 1 — corrected the expected value to include the surviving
  `regime.vvixWarn` override; re-ran, green.

## Self-Check Results

- `packages/core/src/settings/domain/merge.ts` — FOUND
- `packages/core/src/settings/domain/merge.test.ts` — FOUND
- `packages/core/src/settings/application/ports.ts` — FOUND
- `packages/core/src/settings/application/getRuleSettings.ts` — FOUND
- `packages/core/src/settings/application/getRuleSettings.test.ts` — FOUND
- `packages/core/src/settings/application/setRuleOverrides.ts` — FOUND
- `packages/core/src/settings/application/setRuleOverrides.test.ts` — FOUND
- `packages/core/src/index.ts` — FOUND (modified)
- Commit `b1b4fb1` — FOUND in `git log --oneline`
- Commit `751c44a` — FOUND in `git log --oneline`

## TDD Gate Compliance

Plan frontmatter is `type: tdd`, `tdd="true"` on both tasks. RED phase confirmed for each
task via a real `bunx vitest run` failure (`Cannot find module` import errors — the right
reason) before the corresponding implementation file existed. GREEN phase confirmed via real
passing runs (7/7 both tasks). Both phases landed in the same commit per task, per this
project's own TDD rule ("Commit only at green") and established precedent (29-02, 29-07) —
no separate `test(...)` commit exists, which is expected and matches prior plans, not a gate
violation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `ForReadingRuleOverrides` is the exact port shape the storage repo (29-08) must implement
  (postgres + memory twin), returning `ok({})` for a fresh/no-row deployment (never an
  error) per this plan's `getRuleSettings` empty-overrides test.
- `makeGetRuleSettingsUseCase` and `makeSetRuleOverridesUseCase` are ready for 29-13's server
  composition root to wire: `defaults` must be a plain `RuleConfig`-shaped (`JsonObject`)
  value built by calling the three engines' own `resolvePickerRuleConfig()` /
  `resolveExitRuleConfig()` / `resolveRegimeRuleConfig()` with no overrides and adapting each
  into the contract's flat/nested field names (29-02's `ruleConfig` Zod schema) — that
  adaptation is 29-13's job, not this plan's, since this context stays engine-agnostic by
  design.
- The GET/PUT route (29-13) should call `getRuleSettingsResponse.parse(...)` /
  `setRuleOverridesResponse.parse(...)` (29-02's contracts) on each use-case's `Result.value`
  at the HTTP boundary — the `JsonObject`-typed `effective`/`overrides` fields returned here
  are structurally compatible but not nominally validated against the Zod schema inside core
  (by design: core never imports contracts).
- `rg -n "picker/domain|exits/domain|analytics/domain" packages/core/src/settings/` returns
  nothing; `bun run typecheck` and `bunx eslint packages/core/src/index.ts
  packages/core/src/settings/` are both clean; full `@morai/core` suite (92 files, 1063
  tests) passes.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED
