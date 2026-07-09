---
phase: 27-pick-04-backtest-harness
plan: 02
subsystem: backend
tags: [typescript, hexagonal, picker, exits, journal, backtest, tdd]

requires:
  - phase: 27-pick-04-backtest-harness
    provides: "27-01's backtest_runs/chain-as-of/picker-snapshots-in-range/full-snapshot-history ports + Postgres repos + in-memory twins"
provides:
  - "Every live picker/exit pure domain function importable from @morai/core (selectCandidates, haircutFill, scoreCalendarCandidates, RULE_SET_METADATA, realizedVol, rankAndCapCandidates, evaluateExit, exit-rules constants)"
  - "ScoringParams.weights?: Partial<Record<BreakdownCriterion, number>> ablation seam — per-rule weight override, byte-identical when omitted"
  - "computeLegPairMetrics exported pure function for hypothetical-candidate leg-pair pricing without a Calendar row"
  - "packages/core/src/backtest/reuse-exports.test.ts reachability guard"
affects: [27-03-read-ports, 27-04-backtest-kernel, 27-05-replay-cli]

tech-stack:
  added: []
  patterns:
    - "Barrel-thread pattern: domain fn exported from its own domain file -> bounded-context index.ts -> top-level core/index.ts, no logic in the barrel"
    - "Ablation seam: params.weights?.criterion ?? WEIGHT_CONSTANT per-criterion fallback, applied identically in both the breakdown[] entry and the rawScore sum"
    - "Refactor-extract with an Omit<> return type to strip Calendar-dependent fields (calendarId/pnlOpen/trigger) from a pure metrics function"

key-files:
  created:
    - packages/core/src/backtest/reuse-exports.test.ts
  modified:
    - packages/core/src/picker/index.ts
    - packages/core/src/exits/index.ts (unchanged — already barrelled evaluateExit/exit-rules; only core/index.ts needed the missing hop)
    - packages/core/src/index.ts
    - packages/core/src/picker/domain/scoring.ts
    - packages/core/src/picker/domain/scoring.test.ts
    - packages/core/src/journal/application/snapshotCalendars.ts
    - packages/core/src/journal/application/snapshotCalendars.test.ts
    - packages/core/src/journal/index.ts

key-decisions:
  - "exits/index.ts already barrelled evaluateExit + exit-rules constants (26-01/26-02) — the only missing hop was exits/index.ts -> core/index.ts, so exits/index.ts itself needed no edit despite being listed in files_modified"
  - "Dropped the planned `weights: undefined` regression-fixture test variant — exactOptionalPropertyTypes forbids passing an explicit undefined for an optional property; replaced with two separate omitted-weights calls asserting byte-identical output to each other and to the pinned live WEIGHT_SLOPE constant"

patterns-established:
  - "PICK-04 reuse seam: barrel-thread, never reimplement — every backtest read of live scoring/selection/exit logic imports from @morai/core"

requirements-completed: [BT-01, BT-04]

coverage:
  - id: D1
    description: "Every reused picker + exit pure function/registry constant is importable from @morai/core"
    requirement: "BT-01"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/reuse-exports.test.ts#PICK-04 reuse-exports reachability guard"
        status: pass
    human_judgment: false
  - id: D2
    description: "ScoringParams.weights ablation seam — omitting it is byte-identical, weights:{slope:0} zeroes only slope, per-criterion fallback"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#ScoringParams.weights — PICK-04 ablation seam (T-27-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "computeLegPairMetrics extracted and exported; buildSnapshotRow's live output unchanged"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#computeLegPairMetrics — PICK-04 extraction (27-02, Pattern 5)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-09
status: complete
---

# Phase 27 Plan 02: Backtest Reuse Seams Summary

**Barrel-threaded every live picker/exit pure function to @morai/core, added an optional per-rule `weights` ablation seam to `ScoringParams`, and extracted `computeLegPairMetrics` from `buildSnapshotRow` — all additive, zero live-behavior change.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-09T07:16:50Z
- **Completed:** 2026-07-09T07:23:10Z
- **Tasks:** 3
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments
- `selectCandidates`, `haircutFill`, `scoreCalendarCandidates`, `RULE_SET_METADATA`, `realizedVol`, `rankAndCapCandidates`, `evaluateExit`, and the full exit-rules registry constant set are all now importable from `@morai/core` — locked in by a reachability guard test.
- `ScoringParams.weights?: Partial<Record<BreakdownCriterion, number>>` gives the backtest a leave-one-rule-out ablation seam with per-criterion `??` fallback; every live call site (`computePickerSnapshot.ts`) is unaffected.
- `computeLegPairMetrics` is a pure, exported function pricing a candidate's leg-pair metrics from bare `LegSnapshot`s — no `Calendar` row required — enabling BT-04's hypothetical-entry walk-forward.

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread the reused picker + exit symbols through the barrels to @morai/core** - `fae599b` (feat)
2. **Task 2: Ablation seam — optional per-rule weights override on ScoringParams** - `a175b24` (feat, TDD RED confirmed then GREEN)
3. **Task 3: Extract computeLegPairMetrics from buildSnapshotRow** - `73457e3` (feat, TDD RED confirmed then GREEN)

_No separate `test →` commits: each TDD task's RED phase was run and confirmed failing for the right reason before the GREEN implementation, then committed together as one `feat` commit per this plan's task-level (not file-level) TDD granularity — matching the plan's own task boundaries._

## Files Created/Modified
- `packages/core/src/backtest/reuse-exports.test.ts` - Reachability guard importing every reused picker/exit symbol from `@morai/core`, asserting `typeof`
- `packages/core/src/picker/index.ts` - Threads `selectCandidates`/`haircutFill`/`scoreCalendarCandidates`/`RULE_SET_METADATA`/domain types/`realizedVol`/`rankAndCapCandidates`/`PICKER_TOP_N` up from domain/application files
- `packages/core/src/index.ts` - Threads the above picker symbols + `evaluateExit`/exit-rules constants (already barrelled at `exits/index.ts`) up to the top-level `@morai/core` barrel
- `packages/core/src/picker/domain/scoring.ts` - Adds `ScoringParams.weights?` and the 9-constant `??` substitution in `scoreOne` (breakdown push + rawScore sum)
- `packages/core/src/picker/domain/scoring.test.ts` - Regression fixture (omitting weights is byte-identical) + slope-ablation test + per-criterion-fallback test
- `packages/core/src/journal/application/snapshotCalendars.ts` - Extracts `computeLegPairMetrics`; `buildSnapshotRow` now delegates to it and attaches `calendarId`/`pnlOpen`/`trigger`
- `packages/core/src/journal/application/snapshotCalendars.test.ts` - Direct-call test (literal `LegSnapshot`s, no `Calendar`) + parity test (live use-case output === `computeLegPairMetrics` output + attached fields)
- `packages/core/src/journal/index.ts` - Threads `computeLegPairMetrics` up to `core/index.ts`

## Decisions Made
- `exits/index.ts` was listed in the plan's `files_modified` but needed no edit: `evaluateExit` and every exit-rules constant were already barrelled there (Phase 26). Only the `exits/index.ts → core/index.ts` hop was missing, so all the exits-side work landed in `core/index.ts`.
- The regression-fixture test originally planned an explicit `weights: undefined` call to prove "omitting weights" parity. `exactOptionalPropertyTypes: true` (this repo's TS strictness policy) rejects an explicit `undefined` for an optional property at the type level. Replaced with two separate calls that both omit `weights` entirely, asserting they're byte-identical to each other and pinning the live `WEIGHT_SLOPE` constant — the same regression guarantee without violating the repo's own strictness rule.

## Deviations from Plan

None - plan executed exactly as written, aside from the two decisions documented above (both are conformance to existing repo policy, not scope changes).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 27-03 (read ports) and 27-05 (replay CLI) can now import every reused picker/exit pure function from `@morai/core` directly — the reachability guard fails loud if a future edit breaks a thread.
- 27-04 (backtest kernel) has the ablation seam (`weights`) ready for BT-04's leave-one-rule-out analysis and `computeLegPairMetrics` ready for hypothetical-candidate pricing.
- Full test suite (247 files / 2530 tests) and typecheck/lint are green — no regression risk carried forward.

---
*Phase: 27-pick-04-backtest-harness*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created/modified files exist on disk; all 3 task commit hashes (fae599b, a175b24, 73457e3) found in git log.
