---
phase: 29-runtime-rule-settings
plan: 04
subsystem: api
tags: [typescript, vitest, fast-check, hexagonal-core, picker-domain]

# Dependency graph
requires:
  - phase: 29-runtime-rule-settings (plan 02)
    provides: rule-settings.ts Zod contract (vixLadderShape { normalMin, elevatedMin, crisisMin }, sizingContracts shape) that this plan's override param shapes now literally match
  - phase: 28 (Playbook gates)
    provides: entry-gate.ts (VIX_LADDER, resolveEntryGate) and sizing.ts (SIZING_TIERS, resolveSizingTier) this plan adds override seams to
provides:
  - "resolveVixLadder(override?) — the single pure ladder-rebuild helper for the VIX tier boundaries"
  - "resolveEntryGate optional vixLadder input + new vixTier output field"
  - "resolveSizingTier(vix, override?) — ladder + contracts override path"
  - "exported DEFAULT_TIER_CONTRACTS"
affects: [29-07 (picker merge fn), 29-10 (worker wiring)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional-param merge seam: params.override?.field ?? CONSTANT (scoring.ts precedent), now applied to entry-gate.ts and sizing.ts"

key-files:
  created: []
  modified:
    - packages/core/src/picker/domain/entry-gate.ts
    - packages/core/src/picker/domain/entry-gate.test.ts
    - packages/core/src/picker/domain/sizing.ts
    - packages/core/src/picker/domain/sizing.test.ts

key-decisions:
  - "resolveEntryGate's vixTier is a NEW, OPTIONAL output field (not a required one) — an optional field lets computePickerSnapshot.ts's toEntryGateState() reconstruction (which never sets it) keep compiling with zero changes to that out-of-scope file"
  - "vixLadder param type is the already-built ReadonlyArray<VixLadderRow> (not the raw {normalMin,elevatedMin,crisisMin} override shape) — callers (29-07's merge fn) call resolveVixLadder(overrides) first, then pass the resulting rows into resolveEntryGate"
  - "Gate hysteresis constants (VIX_BLOCK_ARM, VIX_PENALTY_FLOOR, etc.) are read as literals inside resolveRung/bandMultiplier, never derived from vixLadder — verified by a dedicated test that a heavily-shifted ladder still hard-blocks at VIX=25"

patterns-established:
  - "resolveVixLadder(override?) is the ONE ladder-rebuild source; sizing.ts's override path calls it internally rather than re-deriving contiguous rows itself"

requirements-completed: []

coverage:
  - id: D1
    description: "resolveVixLadder(override?) rebuilds contiguous [min,max) VIX tiers from normalMin/elevatedMin/crisisMin boundary overrides; omission returns VIX_LADDER unchanged"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveVixLadder"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveVixLadder > fast-check: overridden ladder stays contiguous, no gap/overlap, for any ascending boundaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveEntryGate accepts an optional vixLadder input and resolves the current vix into a vixTier output; omission is byte-identical to the default-ladder gate, and gate hysteresis constants are untouched by a ladder override"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveEntryGate — vixLadder override (29-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveSizingTier(vix, override?) rebuilds tier rows from resolveVixLadder(override.ladder) + merged contracts; DEFAULT_TIER_CONTRACTS exported; omission reproduces today's tier lookup byte-identically; null/NaN still resolves null"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/sizing.test.ts#resolveSizingTier (override path, 29-04)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 04: Entry-Gate + Sizing Ladder Override Seams Summary

**Added a single pure `resolveVixLadder(override?)` helper and threaded optional ladder/contracts overrides through `resolveEntryGate` and `resolveSizingTier`, with byte-identical omission behavior and gate hysteresis constants left untouched.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2/2 completed
- **Files modified:** 4

## Accomplishments

- `resolveVixLadder(override?)` rebuilds the four contiguous half-open `[min,max)` VIX tiers from `{ normalMin, elevatedMin, crisisMin }` boundary overrides — the shape matches `packages/contracts/src/rule-settings.ts`'s already-shipped `vixLadderShape` exactly (built in 29-02, before this plan ran).
- `resolveEntryGate` now accepts an optional `vixLadder` input (default `VIX_LADDER`) and resolves the current VIX into a new `vixTier` output field. This is additive/optional on `EntryGateState`, so `computePickerSnapshot.ts`'s existing `toEntryGateState()` reconstruction (which doesn't set it) still type-checks with zero changes to that file.
- Verified by dedicated test that a heavily-shifted ladder override does NOT move the gate's block/penalty arm points — `VIX_BLOCK_ARM`/`VIX_PENALTY_FLOOR` stay literal constants, resolving the phase's open research question.
- `resolveSizingTier(vix, override?)` gained an override path that rebuilds tier rows from `resolveVixLadder(override.ladder)` and `{ ...DEFAULT_TIER_CONTRACTS, ...override.contracts }`, reusing the Task 1 helper rather than duplicating ladder-rebuild logic.
- `DEFAULT_TIER_CONTRACTS` is now exported (was module-private) so the picker merge fn (29-07) can default from it.

## Task Commits

Each task was committed at TDD green:

1. **Task 1: entry-gate.ts — resolveVixLadder helper + optional ladder on resolveEntryGate** - `641db88` (feat)
2. **Task 2: sizing.ts — resolveSizingTier override path + exported defaults** - `10fc1c7` (feat)

_Note: per this repo's tdd.md rule ("Commit only at green"), each task's RED test additions and GREEN implementation landed in a single commit at green — matching the 17.1-01/18-03/19-01 precedent already established in STATE.md's decision log._

## Files Created/Modified

- `packages/core/src/picker/domain/entry-gate.ts` — added `resolveVixLadder`, `VixLadderOverride` type, `resolveVixTier` helper, optional `vixLadder` input + `vixTier` output field on `resolveEntryGate`
- `packages/core/src/picker/domain/entry-gate.test.ts` — RED→GREEN tests for `resolveVixLadder` (omission, override contiguity, fast-check) and `resolveEntryGate`'s ladder/tier seam (omission byte-identical, tier resolution, hysteresis-untouched, blind→null tier)
- `packages/core/src/picker/domain/sizing.ts` — exported `DEFAULT_TIER_CONTRACTS`, added `SizingTierOverride` type and the override rebuild path in `resolveSizingTier`
- `packages/core/src/picker/domain/sizing.test.ts` — RED→GREEN tests for the override path (contracts-only, ladder-only, combined, null/NaN, omission-equals-default)

## Decisions Made

- `vixTier` is an OPTIONAL field on `EntryGateState` (not required) specifically so `computePickerSnapshot.ts` needed zero edits — kept this plan's file scope to exactly the 4 files in `files_modified`.
- `resolveEntryGate`'s `vixLadder` param takes pre-built ladder rows (`ReadonlyArray<VixLadderRow>`), matching the plan's own literal type spec — callers resolve boundary overrides into rows via `resolveVixLadder()` first, then pass rows in. This lets `resolveEntryGate` stay agnostic of the raw override shape.
- Confirmed via codegraph that `resolveEntryGate` and `resolveSizingTier` each have exactly one existing caller (`computePickerSnapshot.ts`), both calling with today's argument shapes (no `vixLadder`/override arg) — so the optional-param additions are non-breaking by construction, not just by test coverage.

## Deviations from Plan

None — plan executed exactly as written. The one interpretive decision (adding a `vixTier` output field to `resolveEntryGate` to fulfil the plan's literal behavior-block line "resolveEntryGate with an overridden ladder resolves a VIX into the overridden tier") was resolved by reading `entry-gate.ts` current source directly: it had no VIX→tier mapping logic prior to this plan (only two independent hysteresis constant pairs), so "tier resolution" had to be newly introduced, not merely threaded through pre-existing logic. Kept fully additive/optional to respect the plan's `files_modified` scope boundary.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `resolveVixLadder`, `resolveEntryGate`'s `vixLadder`/`vixTier` seam, and `resolveSizingTier`'s override path are all ready for 29-07 (picker merge fn) to consume: it can call `resolveVixLadder(overrides.picker?.vixLadder)` once and feed the resulting rows into both `resolveEntryGate` and `resolveSizingTier`.
- `candidate-selection.ts`'s `autoTuneTargetDelta` (via `vixLadderFloor`) is explicitly NOT touched by this plan (per its own scope note) — 29-10's worker wiring will feed it the resolved ladder-derived floor directly, no signature change needed there.
- Full `packages/core/src/picker/domain` suite (10 files, 197 tests) passes; `bun run typecheck` and `bun run lint` are clean.

---
*Phase: 29-runtime-rule-settings*
*Completed: 2026-07-10*
