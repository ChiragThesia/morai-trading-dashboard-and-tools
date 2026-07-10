---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 10
subsystem: picker-application
tags: [picker, rule-settings, tdd, hexagonal-core, compute-picker, worker]

# Dependency graph
requires:
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 07)
    provides: "resolvePickerRuleConfig(overrides?) — the single picker merge function this plan calls fresh per run"
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 08)
    provides: "makePostgresRuleOverridesRepo(db) — the postgres repo this plan wires into the worker composition root"
  - phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry (plan 09)
    provides: "ForReadingRuleOverrides port + StoredRuleOverrides (generic JsonObject) — the storage-facing shape this plan narrows into PickerRuleOverrides"
provides:
  - "computePickerSnapshot reads rule overrides FRESH per run and threads the resolved config through every picker seam"
  - "picker_snapshot.ruleSet stamps the EFFECTIVE weights actually used for scoring, not the compile-time RULE_SET_METADATA constants"
  - "autoTuneTargetDelta(vix, ladder?) and ScoringParams.debitBand — plumbing seams the objective's threading map required but the plan's files_modified list omitted"
affects: [29-11 (exit advisor worker wiring, same fresh-read pattern), 29-13 (server composition root — GET/PUT settings surface + regime board wiring)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runtime-JSON-to-domain-type narrowing via a local type guard (isPickerRuleOverrides), not a rebuild — the shape was already Zod-validated at the future PUT boundary (29-13), so read-time only needs to satisfy the type system, not re-validate"
    - "A settings-context port (ForReadingRuleOverrides) is imported cross-context via its application/ports.ts file directly (not a barrel) since settings/ has no index.ts (29-09 decision) — same 'application ports only, never domain' convention as the existing journal/index.ts cross-context imports"
    - "readRuleOverrides degrades to defaults on error (best-effort, matches readDailySpotCloses/readPickerSlopeHistory), distinct from the gate's own fail-CLOSED posture — overrides are optional customization, never load-bearing for correctness"

key-files:
  created: []
  modified:
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/application/computePickerSnapshot.test.ts
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/scoring.ts
    - packages/core/src/backtest/application/replayPickerCohort.test.ts
    - apps/worker/src/main.ts

key-decisions:
  - "readRuleOverrides errors (and malformed stored picker groups) degrade to resolvePickerRuleConfig(undefined) — i.e. compile-time defaults — rather than failing the whole compute-picker job. This matches the file's existing best-effort degradation convention (readDailySpotCloses/readPickerSlopeHistory), not the entry gate's fail-CLOSED posture, because omission is always safe by the merge design itself (T-29-15)."
  - "candidate-selection.ts's autoTuneTargetDelta gained an optional second `ladder` param (defaults to VIX_LADDER) and scoring.ts's ScoringParams gained an optional `debitBand` field — both required by the plan's own objective threading map ('autoTuneTargetDelta(gate.vix, config.vixLadder)', 'pass config.debitBand via the scoring params path') but neither file was listed in the plan's files_modified frontmatter. Treated as a plan-authoring gap (Rule 3 blocking issue), not a scope violation — matches 29-08/19-07 precedent for small unlisted plumbing."
  - "toPickerSizing's ladder override is built from the RAW picker override's vixLadder field (PickerRuleOverrides.vixLadder, already the VixLadderOverride boundary shape resolveSizingTier expects), not re-derived from the already-resolved config.vixLadder rows — avoids a redundant boundary round-trip while still routing through resolveVixLadder as the ONE ladder-rebuild source (29-04 precedent)."
  - "ruleSet's effective-weight projection uses a BreakdownCriterion type guard (isBreakdownCriterion) rather than the plan objective's literal 'config.weights[rule.id] ?? rule.weight' snippet — that snippet doesn't typecheck (Record<BreakdownCriterion,number> indexed by a plain string), so gate/experimental RULE_SET_METADATA ids (liquidity, slopePercentile, etc., which aren't BreakdownCriterion values) fall through to rule.weight (always 0) via the guard instead."

requirements-completed: []

coverage:
  - id: D1
    description: "compute-picker reads rule overrides FRESH each run (inside the async use-case body, not the factory closure) and resolves a PickerRuleConfig before selecting/scoring"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts — 'runtime rule overrides (29-10)' describe block (3 tests: omission, overridden knob effect, read-error degradation)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The resolved config threads into selectCandidates, scoreCalendarCandidates (weights + debitBand), resolveEntryGate (vixLadder), resolveSizingTier, maxOpenTripped, and autoTuneTargetDelta"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts — 'a picker override changes gate/brake behavior AND stamps the EFFECTIVE ruleSet weights' (maxOpenCalendars override flips the brake; fwdEdge weight override changes the stamp while siblings stay default)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The persisted snapshot ruleSet stamps EFFECTIVE weights, not the compile-time RULE_SET_METADATA weights"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts — ruleSet effective-weight assertions in the same override test; RULE_SET_METADATA source constant itself asserted unchanged"
        status: pass
    human_judgment: false
  - id: D4
    description: "With no overrides stored, the produced snapshot is byte-identical to today's"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts — full 40-test file (all pre-existing assertions pass unmodified) + explicit 'no rule overrides -> ruleSet stamps ... unchanged' test; packages/core/src/backtest/application/replayPickerCohort.test.ts BT-02 leakage-oracle suite unmodified and passing"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 10: Runtime Rule Config Wired Into compute-picker Summary

**compute-picker now reads rule-settings overrides fresh every run, threads the resolved `PickerRuleConfig` through every scoring/selection/gate/sizing seam, and stamps the picker snapshot's `ruleSet` with the effective (not compile-time) weights — verified byte-identical for the no-override case.**

## Performance

- **Duration:** 25 min
- **Tasks:** 2/2 completed
- **Files modified:** 6

## Accomplishments

- `ComputePickerSnapshotDeps` gained `readRuleOverrides: ForReadingRuleOverrides`, called at the very top of the use-case's async body (before even the chain read) — genuinely fresh per invocation, never cached in `makeComputePickerSnapshotUseCase`'s factory closure.
- The raw storage read (`StoredRuleOverrides`, a generic `JsonObject`) is narrowed into `PickerRuleOverrides` via a local `isPickerRuleOverrides` type guard (whole-group reject on any field-type mismatch, never a guessed partial), then resolved via `resolvePickerRuleConfig` from 29-07.
- The resolved `config` threads into: `selectCandidates`/`selectEventCandidates` (delta band max, front-DTE window, back-DTE gap), `scoreCalendarCandidates`/`scoreEventCandidates` (weights + new `debitBand` param), `resolveEntryGate` (vixLadder), `maxOpenTripped`, `resolveSizingTier` (via an updated `toPickerSizing`), and `autoTuneTargetDelta` (new optional ladder param) at both the primary and event-bucket call sites.
- `picker_snapshot.ruleSet` now stamps `config.weights[rule.id]` for the 9 active score criteria (via a `BreakdownCriterion` type guard) instead of the compile-time `RULE_SET_METADATA` constant — gate/experimental rows (`liquidity`, `slopePercentile`, etc.) are untouched, always 0.
- Worker composition root (`apps/worker/src/main.ts`) constructs `makePostgresRuleOverridesRepo(db)` once at boot and injects `readRuleOverrides` into the compute-picker deps — pure wiring, zero business logic.
- 3 new tests cover: byte-identical omission, an overridden `maxOpenCalendars`+`weights` run changing gate/brake behavior AND the ruleSet stamp, and a `readRuleOverrides` read error degrading to defaults instead of failing the job.

## Task Commits

1. **Task 1: computePickerSnapshot — readRuleOverrides dep, resolve + thread config, effective ruleSet** - `0456ddb` (feat)
2. **Task 2: worker main.ts — wire readRuleOverrides into the compute-picker deps** - `d9d9e5a` (feat)

RED confirmed implicitly: before this plan's changes, `ComputePickerSnapshotDeps` had no `readRuleOverrides` field, so the 3 new tests (and every existing test's `baseDeps` object once `readRuleOverrides` was added as a required field) failed to typecheck — the right reason, per this project's tdd.md ("Cannot find module"-equivalent for an existing file: a missing required property, not an assertion failure). GREEN confirmed via a real `bunx vitest run` (40/40 passing) after implementing. RED test additions and GREEN implementation landed in one commit at green, matching this project's own `tdd.md` "commit only at green" rule and the established 17.1-01/18-03/19-01/29-02/29-07/29-09 precedent already recorded in STATE.md's Accumulated Context.

## Files Created/Modified

- `packages/core/src/picker/application/computePickerSnapshot.ts` - `readRuleOverrides` dep, `isPickerRuleOverrides`/`isBreakdownCriterion` narrowing helpers, fresh config resolution + threading through every seam, effective-weight `ruleSet` stamp, `toPickerSizing` gains a `sizingOverride` param.
- `packages/core/src/picker/application/computePickerSnapshot.test.ts` - `baseDeps` gains `ruleOverrides` fixture support (default `{}`); 3 new tests (omission, overridden knob effect, read-error degradation).
- `packages/core/src/picker/domain/candidate-selection.ts` - `autoTuneTargetDelta` gains an optional `ladder` param (defaults to `VIX_LADDER`), removing the module-level `AUTOTUNE_VIX_FLOOR`/`CEILING` constants in favor of a per-call `vixLadderFloor(ladder, tier)` lookup.
- `packages/core/src/picker/domain/scoring.ts` - `ScoringParams` gains an optional `debitBand` field, threaded into `debitFitFraction`.
- `packages/core/src/backtest/application/replayPickerCohort.test.ts` - added `readRuleOverrides: async () => ok({})` to the BT-02 leakage-oracle fixture (blocking type-error fix, Rule 3 — this test constructs `ComputePickerSnapshotDeps` directly).
- `apps/worker/src/main.ts` - constructs `ruleOverridesRepo` via `makePostgresRuleOverridesRepo(db)`, injects `readRuleOverrides` into the compute-picker use-case deps.

## Decisions Made

See `key-decisions` in frontmatter. In short: read errors degrade to defaults (never fail the job); `autoTuneTargetDelta`/`ScoringParams.debitBand` plumbing additions were unavoidable per the plan's own objective text despite being outside the frontmatter's `files_modified` list; sizing's ladder override reuses the raw picker override directly rather than re-deriving boundaries from already-resolved rows; the ruleSet effective-weight projection uses a type guard instead of the plan's literal (non-typechecking) snippet.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `autoTuneTargetDelta` needed a ladder param not itemized in files_modified**
- **Found during:** Task 1 — the objective's own threading map calls for `autoTuneTargetDelta(gate.vix, config.vixLadder)`, but `autoTuneTargetDelta`'s existing signature only accepted `vix`. `candidate-selection.ts` was not in the plan's `files_modified` list.
- **Fix:** Added an optional `ladder: ReadonlyArray<VixLadderRow> = VIX_LADDER` param, replacing the module-level `AUTOTUNE_VIX_FLOOR`/`CEILING` constants with a per-call `vixLadderFloor(ladder, tier)` lookup — omission reproduces today's tilt range byte-identically (existing `candidate-selection.test.ts` assertions for `autoTuneTargetDelta(10/15/25/40/null/NaN)` all still pass unmodified).
- **Files modified:** `packages/core/src/picker/domain/candidate-selection.ts`
- **Verification:** `bunx vitest run packages/core/src/picker` (23 files, 323 tests green, including `candidate-selection.test.ts`'s existing `autoTuneTargetDelta` suite).
- **Committed in:** `0456ddb` (Task 1 commit)

**2. [Rule 3 - Blocking] `debitFitFraction`'s band override needed a `ScoringParams.debitBand` seam not itemized in files_modified**
- **Found during:** Task 1 — the objective explicitly says "add a `debitBand` field to `ScoringParams` if needed... follow the existing `weights?` precedent". `scoring.ts` was not in the plan's `files_modified` list.
- **Fix:** Added `readonly debitBand?: { readonly idealMin?: number; readonly idealMax?: number }` to `ScoringParams`, threaded into `debitFitFraction(candidate.debit, params.debitBand)` inside `scoreOne` — mirrors the file's own `weights?` idiom exactly; omission reproduces `DEBIT_IDEAL_MIN`/`MAX` byte-identically (`debitFitFraction`'s own `band?.idealMin ?? CONSTANT` fallback, already built in a prior plan).
- **Files modified:** `packages/core/src/picker/domain/scoring.ts`
- **Verification:** `bunx vitest run packages/core/src/picker` (green); full `bunx vitest run packages/core` (92 files, 1066 tests green).
- **Committed in:** `0456ddb` (Task 1 commit)

**3. [Rule 3 - Blocking] `replayPickerCohort.test.ts` (backtest) directly constructs `ComputePickerSnapshotDeps`**
- **Found during:** Task 1, running `bun run typecheck` after adding the required `readRuleOverrides` field — `packages/core/src/backtest/application/replayPickerCohort.test.ts` builds a real `ComputePickerSnapshotDeps` object to run the live use-case once as the BT-02 leakage-oracle fixture. Not in the plan's `files_modified` list.
- **Fix:** Added `readRuleOverrides: async () => ok({})` to that fixture.
- **Files modified:** `packages/core/src/backtest/application/replayPickerCohort.test.ts`
- **Verification:** `bunx vitest run packages/core/src/backtest` (green, BT-02 leakage-oracle suite unmodified in assertions).
- **Committed in:** `0456ddb` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking type errors from a required-field addition rippling into files the plan's frontmatter omitted, all matching the objective's own explicit threading-map text).
**Impact on plan:** All three are the minimum plumbing required to actually deliver what the plan's `<objective>` text describes; none add unrequested functionality. No scope creep beyond what the plan itself specified in prose.

## Issues Encountered

- The plan objective's literal ruleSet-stamp snippet (`config.weights[rule.id] ?? rule.weight`) does not typecheck as written: `config.weights` is `Record<BreakdownCriterion, number>` and `rule.id` is a plain `string` (gate/experimental rows like `"liquidity"`/`"slopePercentile"` aren't `BreakdownCriterion` values), so indexing by an unnarrowed string fails under `noImplicitAny`. Resolved with a `isBreakdownCriterion` type guard (checked against a `Set<string>` of the 9 active criteria, zero `as`/`any`) — functionally identical outcome (gate/experimental rows keep their fixed 0 weight), just type-safe.
- Bridging the untyped `StoredRuleOverrides` (generic `JsonObject`, a 29-09 design decision) into the strongly-typed `PickerRuleOverrides` needed a hand-written runtime type guard rather than a `zod`-based parse, since `packages/core` may only import `@morai/shared` (hexagon law) and zod isn't used anywhere in this package. `isPickerRuleOverrides` does lenient per-field `typeof` checks (whole-group reject on any mismatch) — sufficient because the shape is already Zod-validated at the future PUT boundary (29-13); this read-time guard only needs to satisfy the type system.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `readRuleOverrides` is live end-to-end in the worker: `makePostgresRuleOverridesRepo(db)` → `ComputePickerSnapshotDeps.readRuleOverrides` → fresh read every compute-picker run. No settings row exists yet in prod (29-13 ships the GET/PUT surface + `default`-row seeding), so today's live runs continue to resolve `resolvePickerRuleConfig(undefined)` — the byte-identical defaults path, proven by this plan's own tests.
- 29-11 (exit advisor worker wiring) can follow the exact same fresh-read/type-guard pattern this plan established for `exits/domain/rule-config.ts`'s `ExitRuleOverrides`.
- 29-13's server composition root still owns: seeding `defaults` (the full injected `RuleConfig`-shaped knob object for `getRuleSettings`/`setRuleOverrides`), the GET/PUT route + MCP tools, and wiring `readRuleOverrides` into `GetRegimeBoardDeps` (server-side, not this plan's scope — `computeExitAdvice`/`getRegimeBoard` wiring belongs to later plans per 29-PATTERNS.md).
- Full workspace test suite green post-change: `bun run test` — 274 test files, 2905 tests passing (includes testcontainers-backed postgres suites). `bun run typecheck && bun run lint` both clean.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED
