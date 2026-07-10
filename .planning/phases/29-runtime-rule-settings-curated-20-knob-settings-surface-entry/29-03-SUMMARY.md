---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 03
subsystem: picker-domain
tags: [picker, calendar-selection, rules, brakes, tdd, optional-params]

# Dependency graph
requires: []
provides:
  - "selectCandidates accepts optional deltaMax/frontDteMin/frontDteMax overrides"
  - "debitFitFraction accepts an optional { idealMin?, idealMax? } band override"
  - "maxOpenTripped accepts an optional max override"
affects: [29-07 picker merge fn, 29-10 worker wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "params.override?.field ?? CONSTANT idiom (mirrors scoring.ts weights?) applied to three more picker-domain seams"

key-files:
  created: []
  modified:
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/candidate-selection.test.ts
    - packages/core/src/picker/domain/rules.ts
    - packages/core/src/picker/domain/rules.test.ts
    - packages/core/src/picker/domain/brakes.ts
    - packages/core/src/picker/domain/brakes.test.ts

key-decisions:
  - "deltaMin clamp's upper bound now reads the effective (possibly overridden) deltaMax, not the DELTA_BAND_MAX constant — keeps the deltaMin-never-exceeds-deltaMax invariant when a caller overrides the max edge"
  - "debitFitFraction's cheap-floor/expensive-zero edges (DEBIT_CHEAP_FLOOR, DEBIT_CHEAP_CREDIT, DEBIT_EXPENSIVE_ZERO) stay code-only constants per CONTEXT.md excluded-knobs list — only the ideal-band midpoint is overridable"

patterns-established:
  - "Every new default reads a named constant, never a re-typed literal — verified per-task by omission-regression tests that assert byte-identical output against the pre-change constant-only path"

requirements-completed: []

coverage:
  - id: D1
    description: "selectCandidates accepts optional deltaMax/frontDteMin/frontDteMax; omitting all three reproduces today's universe byte-identically"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectCandidates — deltaMax / frontDteMin / frontDteMax (29-03 runtime override seams)"
        status: pass
    human_judgment: false
  - id: D2
    description: "debitFitFraction accepts an optional ideal band; omitting it reproduces today's fraction byte-identically"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/rules.test.ts#debitFitFraction — optional ideal-band override (29-03 runtime rule settings)"
        status: pass
    human_judgment: false
  - id: D3
    description: "maxOpenTripped accepts an optional max; omitting it uses MAX_OPEN_CALENDARS"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/brakes.test.ts#maxOpenTripped — omitting max reproduces the MAX_OPEN_CALENDARS behavior byte-identically (29-03) / trips at an overridden max (29-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every pre-existing candidate-selection/rules/brakes test passes unmodified"
    verification:
      - kind: unit
        ref: "bun run test — packages/core/src/picker (220/220 passed); bunx vitest run --project @morai/core (990/990 passed)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 03: Picker-Domain Runtime Override Seams Summary

**Added optional deltaMax/frontDteMin/frontDteMax, debitFit ideal-band, and maxOpenTripped-max override params to three picker-domain functions, each defaulting to its existing named constant so omission reproduces today's behavior byte-identically.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-10T04:07:00Z
- **Completed:** 2026-07-10T04:10:24Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `selectCandidates` (`candidate-selection.ts`) gains `deltaMax?`, `frontDteMin?`, `frontDteMax?` on `SelectCandidatesParams`; the pre-existing `effectiveDeltaMin` clamp now bounds against the effective (possibly overridden) `deltaMax` rather than the hardcoded `DELTA_BAND_MAX`.
- `debitFitFraction` (`rules.ts`) gains an optional `{ idealMin?, idealMax? }` band param; the cheap-floor/expensive-zero edges (`DEBIT_CHEAP_FLOOR`, `DEBIT_CHEAP_CREDIT`, `DEBIT_EXPENSIVE_ZERO`) stay code-only per the excluded-knobs list.
- `maxOpenTripped` (`brakes.ts`) gains an optional `max` param defaulting to `MAX_OPEN_CALENDARS`; `cooldownActive`/`cooldownCutoff`/cooldown constants untouched.
- Every default reads the named constant it replaces (`DELTA_BAND_MAX`, `FRONT_DTE_MIN`, `FRONT_DTE_MAX`, `DEBIT_IDEAL_MIN`, `DEBIT_IDEAL_MAX`, `MAX_OPEN_CALENDARS`) — never a fresh literal, per the BT-02 leakage-oracle correctness requirement.
- All three targeted test files pass with the new omission-regression tests added and every pre-existing assertion left byte-unmodified.

## Task Commits

Each task was committed atomically:

1. **Task 1: candidate-selection.ts — deltaMax / frontDteMin / frontDteMax optional params** - `51a196c` (feat)
2. **Task 2: rules.ts — debitFitFraction optional ideal-band param** - `dd7417f` (feat)
3. **Task 3: brakes.ts — maxOpenTripped optional max param** - `ee80025` (feat)

_Note: TDD RED test runs were done in-place (added tests confirmed failing for the right reason via `bunx vitest run`) before each GREEN implementation edit; RED test additions were committed together with the GREEN implementation in a single task commit (no separate RED-only commit), consistent with the plan's task-per-commit protocol._

## Files Created/Modified
- `packages/core/src/picker/domain/candidate-selection.ts` - `SelectCandidatesParams` gains `deltaMax?`/`frontDteMin?`/`frontDteMax?`; delta and front-DTE filters read the effective (overridden-or-default) values; `deltaMin` clamp bounds against effective `deltaMax`.
- `packages/core/src/picker/domain/candidate-selection.test.ts` - new `describe` block: omission byte-identical test, narrower-`deltaMax` exclusion test, `frontDteMin`/`frontDteMax` window-shift test, clamp-against-effective-`deltaMax` test.
- `packages/core/src/picker/domain/rules.ts` - `debitFitFraction(debit, band?)` reads `band?.idealMin ?? DEBIT_IDEAL_MIN` / `band?.idealMax ?? DEBIT_IDEAL_MAX`.
- `packages/core/src/picker/domain/rules.test.ts` - new `describe` block: omission byte-identical test, shifted-band plateau test, excluded-edges-unchanged test.
- `packages/core/src/picker/domain/brakes.ts` - `maxOpenTripped(openCount, max?)` reads `max ?? MAX_OPEN_CALENDARS`.
- `packages/core/src/picker/domain/brakes.test.ts` - two new tests: omission byte-identical, overridden-max trip point.

## Decisions Made
- The `deltaMin` clamp's upper bound now uses the effective `deltaMax` (default-or-override) instead of the `DELTA_BAND_MAX` constant, so `effectiveDeltaMin` and `deltaMax` overrides compose correctly (T-29-06 mitigation) — verified by a test asserting `effectiveDeltaMin` above an overridden `deltaMax` clamps to that `deltaMax`, not the wider default.
- Excluded knobs (debitFit's cheap-floor/expensive-zero edges, all cooldown constants/functions in `brakes.ts`) were left as bare constants exactly as scoped — no seam added.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The three seams (`selectCandidates` delta/DTE overrides, `debitFitFraction` band override, `maxOpenTripped` max override) are ready for Plan 29-07 (picker merge fn) and Plan 29-10 (worker wiring) to pass resolved override values through.
- Full `@morai/core` test suite (990/990) and picker-domain suite (220/220) pass; `bun run typecheck` and `bun run lint` are clean.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created/modified files found on disk; all three task commit hashes (`51a196c`, `dd7417f`, `ee80025`) found in git log.
