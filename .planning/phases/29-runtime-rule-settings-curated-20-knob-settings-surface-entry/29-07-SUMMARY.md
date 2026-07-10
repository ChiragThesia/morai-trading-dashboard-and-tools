---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 07
subsystem: picker-domain
tags: [picker, rule-settings, tdd, fast-check, hexagonal-core, merge-function]

# Dependency graph
requires:
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 03)
    provides: "selectCandidates deltaMax/frontDteMin/frontDteMax overrides, debitFitFraction band override, maxOpenTripped max override — the seams this plan's resolved config feeds"
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 04)
    provides: "resolveVixLadder(override?) — the single ladder-rebuild source this plan's vixLadder field delegates to; DEFAULT_TIER_CONTRACTS export this plan's sizingContracts merges over"
provides:
  - "resolvePickerRuleConfig(overrides?) — the single pure picker merge function"
  - "PickerRuleConfig (pinned shape) + PickerRuleOverrides (core-local flat override type)"
affects: [29-10 worker wiring (destructures PickerRuleConfig into each picker-domain seam param)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolvePickerRuleConfig composes the per-field ?? CONSTANT idiom (scoring.ts precedent) across all 8 pinned PickerRuleConfig fields, delegating to existing single-source helpers (resolveVixLadder) rather than re-deriving them"

key-files:
  created:
    - packages/core/src/picker/domain/rule-config.ts
    - packages/core/src/picker/domain/rule-config.test.ts
  modified:
    - packages/core/src/picker/index.ts

key-decisions:
  - "PickerRuleOverrides uses flat field names (deltaBandMin/deltaBandMax etc.) matching the contract's pickerOverrides shape (packages/contracts/src/rule-settings.ts) exactly, while PickerRuleConfig uses the plan-pinned nested shape (deltaBand: {min,max}) — resolvePickerRuleConfig is the one function that bridges flat overrides to nested resolved config"
  - "Single-field isolation proven via 12 deterministic it() cases (one per top-level override field) rather than one generic fast-check property — each override field maps to a distinct, differently-shaped config location (scalar vs nested vs record vs array), so per-field literal assertions are clearer and equally rigorous; idempotency (the property genuinely needing broad input coverage) uses real fast-check over all 12 fields simultaneously"
  - "configToOverrides (test-only) is the literal inverse of resolvePickerRuleConfig's shape transform, used only by the idempotency property — not exported from the module, since production code never needs to invert a resolved config back into overrides"

patterns-established:
  - "Every resolved field reads a named constant or delegates to an existing single-source resolver (resolveVixLadder, DEFAULT_TIER_CONTRACTS) — never a fresh literal or a re-derived ladder/tier table"

requirements-completed: []

coverage:
  - id: D1
    description: "resolvePickerRuleConfig() with no/empty overrides produces values identical to the module constants (BT-02 leakage-oracle correctness)"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/rule-config.test.ts#resolvePickerRuleConfig — omission (2 tests: omitted arg, explicit {})"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every single override field changes exactly that field; all sibling fields remain at their default"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/rule-config.test.ts#resolvePickerRuleConfig — single-field isolation (12 tests: deltaBandMin/Max, frontDteMin/Max, backDteMinGap/MaxGap, debitIdealMin/Max, maxOpenCalendars, sizingContracts, weights, vixLadder)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The merge is idempotent: feeding a resolved config's own values back as overrides reproduces the same config, for any generated override combination"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/rule-config.test.ts#resolvePickerRuleConfig — idempotency (fast-check property, pickerRuleOverridesArb)"
        status: pass
    human_judgment: false
  - id: D4
    description: "rule-config.ts imports only picker domain/ siblings — no contracts, no cross-context, no adapters (hexagon law)"
    verification:
      - kind: unit
        ref: "grep '^import' packages/core/src/picker/domain/rule-config.ts — 7 imports, all from ./rules.ts, ./candidate-selection.ts, ./entry-gate.ts, ./sizing.ts, ./brakes.ts, ./types.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "resolvePickerRuleConfig, PickerRuleConfig, PickerRuleOverrides exported from packages/core/src/picker/index.ts barrel"
    verification:
      - kind: unit
        ref: "bun run typecheck (clean) — import resolvePickerRuleConfig from @morai/core would fail to compile otherwise; picker/index.ts diff adds the barrel export"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 07: Picker Rule Config Merge Function Summary

**`resolvePickerRuleConfig(overrides?)` — the picker engine's single pure merge function, resolving 8 pinned `PickerRuleConfig` fields each defaulting to its named picker-domain constant, byte-identical on omission and idempotent under fast-check.**

## Performance

- **Duration:** 8 min
- **Tasks:** 1/1 completed
- **Files modified:** 3

## Accomplishments

- `resolvePickerRuleConfig(overrides?: PickerRuleOverrides): PickerRuleConfig` resolves the exact pinned shape from 29-07-PLAN.md's Artifacts section: `weights` (9-criterion `Record<BreakdownCriterion, number>`), `deltaBand`/`frontDte`/`backDteGap`/`debitBand` (`{min,max}` or `{idealMin,idealMax}` pairs), `vixLadder` (`ReadonlyArray<VixLadderRow>`), `sizingContracts` (`Record<VixTier, number>`), `maxOpenCalendars` (number).
- Every scalar field reads `overrides?.field ?? NAMED_CONSTANT` (never a fresh literal); `vixLadder` delegates to 29-04's `resolveVixLadder` (the one ladder-rebuild source — never re-derived here); `sizingContracts` spreads `DEFAULT_TIER_CONTRACTS` then the override (29-04's export).
- `PickerRuleOverrides` is a core-local type with flat field names (`deltaBandMin`, `deltaBandMax`, `frontDteMin`, ... `sizingContracts`) that structurally match `packages/contracts/src/rule-settings.ts`'s `picker` override group field-for-field — without importing that module (hexagon law: only sibling `./` domain modules imported).
- 15 tests: 2 omission tests (implicit + explicit `{}`), 12 single-field isolation tests (one per top-level override field, including the 3 literal examples from the plan's `<behavior>` block: `maxOpenCalendars`, `weights`, `vixLadder`), 1 fast-check idempotency property generating combinations across all 12 fields.
- Barrel-exported (`resolvePickerRuleConfig`, `PickerRuleConfig`, `PickerRuleOverrides`) from `packages/core/src/picker/index.ts` — ready for 29-10's worker wiring to import from `@morai/core`.

## Task Commits

Each task was committed at TDD green:

1. **Task 1: picker/domain/rule-config.ts — PickerRuleConfig + resolvePickerRuleConfig (fast-check)** - `18a7a22` (feat)

_RED confirmed first: `bunx vitest run rule-config.test.ts` failed on "Cannot find module './rule-config.ts'" (import error, not an assertion failure — the test file was authored against the not-yet-existing module, per this repo's tdd.md red-for-the-right-reason discipline) before `rule-config.ts` was created. GREEN: all 15 tests pass. RED test file and GREEN implementation landed in one commit at green (17.1-01/18-03/19-01/29-03/29-04 precedent — commit-only-at-green, not a separate RED-only commit)._

## Files Created/Modified

- `packages/core/src/picker/domain/rule-config.ts` - `PickerRuleOverrides` type, `PickerRuleConfig` type, `resolvePickerRuleConfig(overrides?)`.
- `packages/core/src/picker/domain/rule-config.test.ts` - omission (2), single-field isolation (12), idempotency fast-check property (1) — 15 tests total.
- `packages/core/src/picker/index.ts` - barrel-exports `resolvePickerRuleConfig`, `PickerRuleConfig`, `PickerRuleOverrides`.

## Decisions Made

- `PickerRuleOverrides` mirrors the contract's `picker` override group by flat field name (not by importing it — hexagon law forbids `packages/core` importing `packages/contracts`), while `PickerRuleConfig` uses the plan-pinned nested shape. `resolvePickerRuleConfig` is the one function bridging the two.
- Single-field isolation is proven with 12 deterministic `it()` cases rather than one generic fast-check property, since each override field lands in a differently-shaped config location (scalar, nested pair, record, or array) — literal per-field assertions are clearer and equally rigorous. Idempotency (the property that genuinely benefits from broad random coverage across all fields at once) uses a real fast-check property over a 12-field arbitrary.
- The test-only `configToOverrides` helper (inverse shape transform, used only by the idempotency property) stays local to the test file — production code never needs to invert a resolved config back into override form.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `resolvePickerRuleConfig` is ready for 29-10 (worker wiring) to import from `@morai/core` and destructure: `weights` → `scoreCalendarCandidates`; `deltaBand`/`frontDte`/`backDteGap` → `selectCandidates`; `debitBand` → `debitFitFraction`; `vixLadder` → `resolveEntryGate` + `autoTuneTargetDelta`'s floor; `sizingContracts`+`vixLadder` → `resolveSizingTier`; `maxOpenCalendars` → `maxOpenTripped`.
- Full `@morai/core` picker-domain suite (13 files, 252 tests) passes; `bun run typecheck` and `bun run lint` are clean.
- `rule-config.ts`'s import list is exactly 6 sibling modules (`./rules.ts`, `./candidate-selection.ts`, `./entry-gate.ts`, `./sizing.ts`, `./brakes.ts`, `./types.ts`) — no contracts, no cross-context, no adapters.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 3 created/modified files found on disk; commit hash `18a7a22` found in git log.
