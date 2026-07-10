---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 05
subsystem: api
tags: [exits, rule-engine, fast-check, vitest, hexagonal]

requires:
  - phase: 26-exit-advisor
    provides: "evaluate-exit.ts pure evaluator + exit-rules.ts TAKE/STOP rung constants"
provides:
  - "resolveExitRuleConfig(overrides?) — pure merge of exit-rule overrides over TAKE_RUNGS/STOP_RUNGS"
  - "evaluateExit's optional 4th config arg, threaded into evalTake/evalStop"
affects: [29-02-rule-settings-contract, 29-11-exits-worker-wiring]

tech-stack:
  added: []
  patterns:
    - "Optional-param merge seam (mirrors picker/domain/scoring.ts's weights? idiom): params.override?.field ?? CONSTANT, never a required param, defaults reproduce today's output byte-identically"

key-files:
  created:
    - packages/core/src/exits/domain/rule-config.ts
    - packages/core/src/exits/domain/rule-config.test.ts
  modified:
    - packages/core/src/exits/domain/evaluate-exit.ts
    - packages/core/src/exits/domain/evaluate-exit.test.ts

key-decisions:
  - "resolveExitRuleConfig rebuilds each rung by label (switch on rung.label, not a lookup table) — explicit, no `as` casts, matches typescript.md strictness"
  - "evalStop/evalTake gained an optional rungs param defaulting to STOP_RUNGS/TAKE_RUNGS so their existing internal call sites (module-constant reads) stay correct while evaluateExit now threads config.stopRungs/config.takeRungs explicitly"
  - "evalGamma/evalTerm/evalEvt/evalRoll left untouched — excluded/code-only knobs per 29-CONTEXT.md"

requirements-completed: []

coverage:
  - id: D1
    description: "resolveExitRuleConfig(overrides?) merges TAKE/STOP rung overrides over exit-rules.ts constants by label; omission reproduces TAKE_RUNGS/STOP_RUNGS byte-identically; rung order preserved"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/rule-config.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "evaluateExit accepts an optional 4th config arg defaulting to resolveExitRuleConfig(); omitting it reproduces today's verdicts byte-identically; overridden rungs change the fired take/stop rule and hysteresis hold-armed still honors overridden arm/disarm"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts (34 tests, 3 new: omission-vs-explicit-default equality, overridden +5% take, overridden STOP hysteresis)"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 05: Exit Rule Override Seam Summary

**Runtime-override seam for the exit advisor's TAKE/STOP rungs via a pure `resolveExitRuleConfig(overrides?)` merge and an optional 4th `config` arg on `evaluateExit` — omission byte-identical to today's verdicts.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `packages/core/src/exits/domain/rule-config.ts` — `ExitRuleOverrides` + `ExitRuleConfig` types and `resolveExitRuleConfig(overrides?)`, mirroring `scoring.ts`'s `weights?` optional-param idiom, imports only `./exit-rules.ts`
- `evaluateExit(position, context, previousVerdict, config?)` — new optional 4th param defaulting to `resolveExitRuleConfig()`, threaded into `evalTake`/`evalStop` via a new optional `rungs` param on each (defaulting to `TAKE_RUNGS`/`STOP_RUNGS`)
- Full pre-existing exit test suite (34 tests in `evaluate-exit.test.ts`) passes unmodified alongside 3 new tests proving omission-equivalence, overridden-rung firing, and hysteresis hold-armed under an overridden STOP rung

## Task Commits

Each task was committed atomically at green:

1. **Task 1: exits/domain/rule-config.ts — ExitRuleConfig + resolveExitRuleConfig** - `3deb779` (feat)
2. **Task 2: evaluate-exit.ts — optional config 4th arg threaded into evalTake / evalStop** - `3d95c95` (feat)

_TDD: RED confirmed for both tasks by temporarily removing the not-yet-written implementation (Task 1) / running the new config-seam tests against the unmodified 3-arg signature (Task 2) before implementing; both showed the correct failure (module-not-found / wrong verdict) before GREEN._

## Files Created/Modified
- `packages/core/src/exits/domain/rule-config.ts` - `ExitRuleOverrides`, `ExitRuleConfig`, `resolveExitRuleConfig(overrides?)`
- `packages/core/src/exits/domain/rule-config.test.ts` - omission/override/order tests (7 tests, incl. fast-check)
- `packages/core/src/exits/domain/evaluate-exit.ts` - optional 4th `config` param; `evalStop`/`evalTake` gain an optional `rungs` param
- `packages/core/src/exits/domain/evaluate-exit.test.ts` - 3 new tests for the config seam, appended (34 total, unmodified pre-existing 31 + 3 new)

## Decisions Made
- `resolveTakeRung`/`resolveStopRung` use an explicit `switch` on `rung.label` rather than a generic lookup-table-keyed-by-string, avoiding any `as` type assertion (typescript.md: no `any`/`as`/`!`)
- `evalStop`/`evalTake`'s new `rungs` param defaults to the module constant so no other internal call site needed updating — only `evaluateExit`'s own call sites pass `config.stopRungs`/`config.takeRungs` explicitly

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`resolveExitRuleConfig` + config-threaded `evaluateExit` are ready for 29-11 (exits worker-wiring), which will read overrides fresh each `compute-exit-advice` run and pass the resolved config as the 4th arg. No blockers.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: packages/core/src/exits/domain/rule-config.ts
- FOUND: packages/core/src/exits/domain/rule-config.test.ts
- FOUND: .planning/phases/29-runtime-rule-settings-curated-20-knob-settings-surface-entry/29-05-SUMMARY.md
- FOUND commit: 3deb779
- FOUND commit: 3d95c95
