---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 11
subsystem: exits-application
tags: [exits, rule-engine, worker, tdd, hexagonal-core, compute-exit-advice]

requires:
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 05)
    provides: "resolveExitRuleConfig(overrides?) + evaluateExit's optional 4th config arg"
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 08)
    provides: "makePostgresRuleOverridesRepo(db) — the postgres repo this plan reuses"
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 09)
    provides: "ForReadingRuleOverrides port + StoredRuleOverrides — the storage-facing shape narrowed into ExitRuleOverrides"
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 10)
    provides: "the fresh-read/type-guard-narrowing pattern this plan replicates for the exits context"
provides:
  - "computeExitAdvice reads rule overrides FRESH per compute-exit-advice run and threads the resolved ExitRuleConfig into evaluateExit's 4th argument"
  - "worker composition root injects readRuleOverrides into the compute-exit-advice deps, reusing the single ruleOverridesRepo instance"
affects: []

tech-stack:
  added: []
  patterns:
    - "Runtime-JSON-to-domain-type narrowing via a local type guard (isExitRuleOverrides), not a rebuild — mirrors 29-10's isPickerRuleOverrides exactly, applied to the exits group instead of picker"
    - "Fresh-read-per-invocation at the top of the use-case body (before the per-position loop), never cached in the factory closure — mirrors readMacroObservations/readRuleOverrides in computePickerSnapshot.ts"
    - "readRuleOverrides degrades to defaults on error (best-effort), matching 29-10's picker degradation posture — overrides are optional customization, never load-bearing"

key-files:
  created: []
  modified:
    - packages/core/src/exits/application/computeExitAdvice.ts
    - packages/core/src/exits/application/computeExitAdvice.test.ts
    - apps/worker/src/main.ts

key-decisions:
  - "readRuleOverrides errors (and malformed stored exits groups) degrade to resolveExitRuleConfig(undefined) — compile-time TAKE_RUNGS/STOP_RUNGS defaults — rather than failing the whole compute-exit-advice cycle, matching 29-10's picker degradation posture (T-29-15)."
  - "Wired ONLY into ComputeExitAdviceDeps (worker job, apps/worker/src/main.ts) — NOT into GetExitAdviceDeps (server, HTTP GET path). Verified getExitAdvice.ts is untouched by this plan's git diff, confirming the rungs took effect on the worker cadence per RESEARCH Pitfall 2."
  - "isExitRuleOverrides type guard rejects the WHOLE take/stop sub-group on any field-type mismatch rather than accepting a guessed partial — mirrors isPickerRuleOverrides' never-a-guessed-partial rule exactly."

requirements-completed: []

coverage:
  - id: D1
    description: "compute-exit-advice reads rule overrides FRESH each run and resolves an ExitRuleConfig before evaluating; readRuleOverrides is called once per run inside the body, before the per-position loop"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/application/computeExitAdvice.test.ts — 'runtime rule overrides (29-11)' describe block, 'readRuleOverrides is called once per run...' test (asserts callCount===1 across 2 positions, both fired under the same override)"
        status: pass
    human_judgment: false
  - id: D2
    description: "evaluateExit is called with the resolved config as its 4th argument; an exits override changes the fired rung on the next run"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/application/computeExitAdvice.test.ts — 'an exits.take.plus5Arm override lowers the +5% arm threshold...' test (3.5% pnlPct: HOLD under defaults, TAKE +5% under plus5Arm:0.03 override)"
        status: pass
    human_judgment: false
  - id: D3
    description: "With no overrides, verdicts are byte-identical to today's"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/application/computeExitAdvice.test.ts — 'no exits override -> the fired verdict matches the compile-time TAKE_RUNGS byte-identically' test + all 13 pre-existing tests pass unmodified with fakeReadRuleOverrides() defaulting to {}"
        status: pass
    human_judgment: false
  - id: D4
    description: "A rung change takes effect on the next compute-exit-advice cycle (worker cadence), not on the next page load — wired into the worker composition root, not the server GET path"
    verification:
      - kind: unit
        ref: "apps/worker/src/main.ts computeExitAdviceUseCase deps gains readRuleOverrides: ruleOverridesRepo.readRuleOverrides; getExitAdvice.ts confirmed untouched via git diff"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 11: Runtime Exit Rung Config Wired Into compute-exit-advice Summary

**compute-exit-advice now reads rule-settings overrides fresh every worker run, resolves an `ExitRuleConfig` via `resolveExitRuleConfig`, and threads it through `evaluateExit`'s 4th argument — wired into the worker's `ComputeExitAdviceDeps`, not the server's `GetExitAdviceDeps`, so overridden TAKE/STOP rungs take effect on the compute-exit-advice cadence rather than the next HTTP GET.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed

## Accomplishments

- `ComputeExitAdviceDeps` gained `readRuleOverrides: ForReadingRuleOverrides`, called at the very top of the use-case's async body (before `readHeldPositions`) — genuinely fresh per invocation, never cached in `makeComputeExitAdviceUseCase`'s factory closure.
- The raw storage read (`StoredRuleOverrides`, a generic `JsonObject`) is narrowed into `ExitRuleOverrides` via a local `isExitRuleOverrides` type guard (whole-group reject on any field-type mismatch, mirrors 29-10's `isPickerRuleOverrides`), then resolved via `resolveExitRuleConfig` from 29-05.
- The resolved `exitConfig` is passed as `evaluateExit`'s 4th argument for every position in the per-calendar loop — the same resolved config for every position that run (single fresh read, not re-read per position).
- `apps/worker/src/main.ts` injects `readRuleOverrides: ruleOverridesRepo.readRuleOverrides` into `computeExitAdviceUseCase`'s deps, reusing the single `makePostgresRuleOverridesRepo(db)` instance already constructed for compute-picker (29-10) — pure composition-root wiring, zero business logic, zero new repo construction.
- `getExitAdvice.ts` (server HTTP GET path) confirmed untouched — verified via `git status`/`git diff` showing no changes to that file, satisfying the plan's explicit constraint (RESEARCH Pitfall 2: exit rungs are a worker-job concern, not a server-request-time concern).
- 4 new tests cover: byte-identical omission, an overridden `plus5Arm` changing the fired rung from HOLD to TAKE +5%, a `readRuleOverrides` read error degrading to defaults, and a fresh-once-per-run (not per-position) read across 2 open calendars.

## Task Commits

1. **Task 1: computeExitAdvice — readRuleOverrides dep + resolved config as evaluateExit 4th arg** - `61703bf` (feat)
2. **Task 2: worker main.ts — wire readRuleOverrides into the compute-exit-advice deps** - `57505c8` (feat)

RED confirmed by adding the required `readRuleOverrides` field to `ComputeExitAdviceDeps` first and running `bunx vitest run packages/core/src/exits/application/computeExitAdvice.test.ts`: 12/13 pre-existing tests failed with `TypeError: deps.readRuleOverrides is not a function` (the right reason — a missing required dependency, not an assertion failure). GREEN confirmed via a real `bunx vitest run` (13/13 passing) after adding the `fakeReadRuleOverrides()` fixture to all 12 call sites, then 17/17 passing after adding the 4 new override-behavior tests. Both RED-fix and GREEN-additions landed in one commit at green, matching this project's established TDD "commit only at green" convention (29-05/29-10 precedent).

## Files Created/Modified

- `packages/core/src/exits/application/computeExitAdvice.ts` - `readRuleOverrides` dep, `isExitRuleOverrides`/`isTakeOverrides`/`isStopOverrides`/`isPlainRecord`/`isOptionalNumber` narrowing helpers, fresh config resolution at the top of the use-case body, `exitConfig` threaded into `evaluateExit`'s 4th argument.
- `packages/core/src/exits/application/computeExitAdvice.test.ts` - `fakeReadRuleOverrides(overrides?)` fixture added to all 12 existing `makeComputeExitAdviceUseCase` call sites; 4 new tests in a "runtime rule overrides (29-11)" describe block.
- `apps/worker/src/main.ts` - `computeExitAdviceUseCase` deps gains `readRuleOverrides: ruleOverridesRepo.readRuleOverrides`, reusing the repo instance constructed at line 207 (shared with compute-picker's wiring at line 588).

## Decisions Made

See `key-decisions` in frontmatter. In short: read errors degrade to defaults (never fail the job); wired exclusively into the worker composition root per the plan's explicit critical constraint; the type guard rejects whole sub-groups rather than accepting guessed partials.

## Deviations from Plan

None — plan executed exactly as written. `apps/worker/src/main.ts`, `packages/core/src/exits/application/computeExitAdvice.ts`, and `packages/core/src/exits/application/computeExitAdvice.test.ts` were the only files touched, matching the plan's `files_modified` frontmatter exactly.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `readRuleOverrides` is live end-to-end in the worker for BOTH compute-picker (29-10) and compute-exit-advice (this plan): `makePostgresRuleOverridesRepo(db)` → fresh read every run of both jobs. No settings row exists yet in prod (a later plan ships the GET/PUT surface + `default`-row seeding), so today's live runs continue to resolve `resolveExitRuleConfig(undefined)` — the byte-identical defaults path, proven by this plan's own tests.
- Full workspace verification: `bun run typecheck && bun run lint` both clean; `bunx vitest run packages/core` — 92 test files, 1073 tests passing, zero regressions.
- `getExitAdvice.ts` (server) remains unmodified — the server's HTTP GET path continues to re-derive from the already-persisted `ExitVerdictRow` and never calls `evaluateExit` again, exactly as the plan's critical constraint requires.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: packages/core/src/exits/application/computeExitAdvice.ts
- FOUND: packages/core/src/exits/application/computeExitAdvice.test.ts
- FOUND: apps/worker/src/main.ts
- FOUND commit: 61703bf
- FOUND commit: 57505c8
