---
phase: 27-pick-04-backtest-harness
plan: 06
subsystem: backend
tags: [typescript, hexagonal, backtest, cli, zod, vitest, tdd, bootstrap-ci]

requires:
  - phase: 27-pick-04-backtest-harness
    provides: "27-01's ports/domain types + append-only backtest_runs storage, 27-02's reuse seams (selectCandidates/scoreCalendarCandidates/evaluateExit/haircutFill/computeLegPairMetrics + the weights ablation seam), 27-03's as-of-T readers, 27-04's report kernel (directionalAttribution/ablationDelta/bootstrapCi/coveragePercent), 27-05's three replay use-cases (replayPickerCohort/replayExitsForCalendar/replayHypotheticalEntry)"
provides:
  - "makeRunBacktestUseCase / runBacktest — orchestrates the three 05 replay paths into one fully-stamped BacktestReport (n/dateRange/coverage% on every headline number, per-rule directional attribution, leave-one-rule-out ablation, seeded bootstrap CI, both standing caveats) and persists it EXACTLY ONCE"
  - "apps/worker/src/backtest.ts — DATABASE_URL-only operator CLI (Zod argv: --from/--to/--calendar/--report-only, rejects --from before 2026-06-12 and malformed dates) with a stamped console summary"
  - "packages/core/src/backtest/application/ports.test.ts — the BT-05 no-write-path structural guard, mirroring EXIT-10's import.meta.glob precedent"
  - "BacktestReport.ci (new BootstrapCiRow[] field) + HypotheticalCandidateOutcome.breakdown (new field) — two additive gaps closed so the report kernel is actually wireable"
  - "makePostgresBacktestChainRepo / makePostgresBacktestHistoryRepo / makePostgresBacktestRunsRepo threaded through packages/adapters/src/index.ts (existed since 27-01/27-03, never exported from the adapters barrel until this plan's CLI needed them)"
affects: []

tech-stack:
  added: []
  patterns:
    - "Orchestrator pattern: makeXxxUseCase(deps) driver-port factory sequencing sibling same-bounded-context use-cases via plain relative imports, reaching @morai/core only for cross-context (journal) ports — mirrors 05's own replay use-cases' import discipline, one level up"
    - "CLI env-bootstrap: a task-scoped minimal Zod env schema (DATABASE_URL + defaulted BSM_RATE_FALLBACK/BSM_DIVIDEND_YIELD matching apps/worker/src/config.ts's live defaults) instead of the shared bootWorkerConfig() — for a tool that performs zero brokerage I/O"
    - "--report-only implemented as a dependency-injection swap (a no-op persist sink) at the CLI composition root, not a second runBacktest code path — keeps runBacktest's 'persists exactly once' contract literal and unconditional"

key-files:
  created:
    - packages/core/src/backtest/application/runBacktest.ts
    - packages/core/src/backtest/application/runBacktest.test.ts
    - packages/core/src/backtest/application/ports.test.ts
    - apps/worker/src/backtest.ts
    - apps/worker/src/backtest.test.ts
  modified:
    - packages/core/src/backtest/domain/types.ts
    - packages/core/src/backtest/application/replayHypotheticalEntry.ts
    - packages/core/src/backtest/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "BacktestReport gained a `ci: ReadonlyArray<BootstrapCiRow>` field (types.ts, not in this plan's nominal files_modified list). The shipped 27-01 shape had nowhere to carry 'Bootstrap CI on every headline metric' — a must-have this plan's own Task 1 text requires. Purely additive; no existing field changed. Deviation Rule 2 (missing critical functionality)."
  - "HypotheticalCandidateOutcome gained a `breakdown: ReadonlyArray<BreakdownEntry>` field (replayHypotheticalEntry.ts, outside this plan's files_modified list). Per-rule directional attribution needs each candidate's own per-criterion raw contribution vs its outcome ('high-scoring beat low-scoring', 27-CONTEXT.md's locked framing) — the aggregate `score` alone can't be attributed back to one rule, and reimplementing scoring to get it would violate the phase's zero-reimplementation lock. Purely additive; verified no existing test asserts exact-equality on the outcome object shape. Deviation Rule 2."
  - "packages/adapters/src/index.ts gained exports for makePostgresBacktestChainRepo/BacktestHistoryRepo/BacktestRunsRepo. These repos existed since 27-01/27-03 but were never threaded through the adapters barrel — this plan's CLI is their first consumer outside packages/adapters' own contract tests, and every other CLI composition root reaches repos via `@morai/adapters`, not a direct relative import. Deviation Rule 3 (blocking issue)."
  - "Per-rule directional attribution: for each of the 9 scored BreakdownCriterion, build (metric, outcome) samples from every baseline hypothetical-entry outcome's own breakdown entry for that criterion vs its simulatedPnl, then call directionalAttribution once per rule. ALL_CRITERIA is a hand-listed literal array (same 9 strings scoring.ts's own breakdown[] construction and its Zod mirror already hand-list) rather than derived from RULE_SET_METADATA's plain-string `id` field, to avoid an unsafe cast (typescript.md forbids `as`)."
  - "Per-rule leave-one-out ablation: a second replayHypotheticalEntry pass per (cohort, rule) with that rule's weight zeroed. rankDelta = mean of ablationDelta() over every candidate present in the baseline ranking; outcomeDelta = mean, across cohorts, of (ablated top-ranked candidate's simulatedPnl − baseline top-ranked candidate's simulatedPnl). Documented as a ponytail: comment — O(cohorts × 9) extra replay passes, each re-reading chain/events/closes; batch/cache the as-of-T reads across rules if a wide --from/--to range makes this the bottleneck."
  - "Bootstrap CI (seed=1337, fixed — not clock/random-derived, so re-running over unchanged data reproduces an identical report) applied to three headline P&L samples: the 13-trade oracle's modeled P&L, its oracle (fills-ledger) P&L, and the full hypothetical-simulated-P&L distribution (a much larger n, shown for contrast against the n≈13 interval's width)."
  - "--calendar filter is a client-side filter over listCalendars(\"closed\")'s result (narrows the BT-03 replay to one id) rather than a new port — Claude's Discretion per 27-CONTEXT.md's CLI-arg-surface latitude."

patterns-established:
  - "PICK-04 orchestrator seam: runBacktest is the ONLY function the CLI reaches into @morai/core for (via makeRunBacktestUseCase); the replay use-cases and report kernel stay internal to packages/core/src/backtest/, reached by runBacktest via plain relative imports, never re-exported to a driving adapter directly"

requirements-completed: [BT-04, BT-05]

coverage:
  - id: D1
    description: "runBacktest reduces the three replay paths into one BacktestReport where every headline number carries n=/dateRange/coverage%, includes per-rule directional attribution + leave-one-rule-out ablation + a seeded bootstrap CI, flags both standing caveats, and persists the report exactly once via ForPersistingBacktestRun"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/application/runBacktest.test.ts#runBacktest"
        status: pass
    human_judgment: false
  - id: D2
    description: "The operator CLI (apps/worker/src/backtest.ts) parses DATABASE_URL-only env plus Zod-validated argv, rejects a --from before 2026-06-12 and malformed dates, accepts an optional UUID-shaped --calendar and --report-only, and composes the backtest repos under import.meta.main with no brokerage I/O"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "apps/worker/src/backtest.test.ts#parseBacktestArgs"
        status: pass
    human_judgment: false
  - id: D3
    description: "The BT-05 structural guard proves the backtest module tree can never write a rule weight or registry: no ForWriting*Rules/ForPersisting*RuleWeights port anywhere, no direct rules.ts/exit-rules.ts import outside the read-only @morai/core barrel, and ports.ts declares no update/delete counterpart to ForPersistingBacktestRun"
    requirement: "BT-05"
    verification:
      - kind: unit
        ref: "packages/core/src/backtest/application/ports.test.ts#BT-05 — no-write-path structural guard"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-09
status: complete
---

# Phase 27 Plan 06: Backtest Orchestrator + Operator CLI Summary

**runBacktest reduces the three 05 replay paths into one persisted, fully-stamped BacktestReport (attribution + ablation + bootstrap CI + coverage + caveats); apps/worker/src/backtest.ts is the DATABASE_URL-only CLI that runs it; ports.test.ts proves the harness can never write a weight.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-09T13:24:00Z
- **Completed:** 2026-07-09T13:42:50Z
- **Tasks:** 3
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- `makeRunBacktestUseCase` (`runBacktest.ts`): enumerates every stored cohort in `[from, to]`, replays each through `replayPickerCohort` (BT-02 leakage oracle) and a baseline `replayHypotheticalEntry` pass (BT-04 input, reused for attribution/ablation/coverage), replays every closed calendar (or one, via `--calendar`) through `replayExitsForCalendar` (BT-03), then reduces everything with the 04 kernel: per-rule directional attribution (median-split on each candidate's own breakdown entry vs its simulated P&L — "high-scoring beat low-scoring"), leave-one-rule-out ablation (a second, weight-zeroed replay pass per rule per cohort), a seeded bootstrap CI on three headline P&L samples, and gap-excluded coverage. Both standing caveats (late-solved-BSM optimism, economic-events leakage) are always attached. Persists exactly once.
- `apps/worker/src/backtest.ts`: a composition root mirroring `backfill-transactions.ts` except env parsing — `{ DATABASE_URL, BSM_RATE_FALLBACK?, BSM_DIVIDEND_YIELD? }` only, never `bootWorkerConfig()`. Zod-validates `--from`/`--to` (round-trip YYYY-MM-DD, rejects anything before 2026-06-12), an optional UUID-shaped `--calendar`, and `--report-only` (swaps in a no-op persist sink). Composes the backtest repos + reused journal ports, runs `runBacktest`, and prints a stamped console summary (n=, date range, coverage %, leakage-oracle reproduced/mismatched/registry-drift counts, 13-trade direction matches, per-rule attribution signs, per-rule ablation deltas, bootstrap CIs, caveats).
- `ports.test.ts`: the BT-05 guarantee as an executable static guard — no `ForWriting*Rules`/`ForPersisting*RuleWeights`-shaped port exists anywhere in the backtest tree (declared or imported), no source imports `rules.ts`/`exit-rules.ts` outside the read-only `@morai/core` barrel, and `ports.ts` declares no update/delete counterpart to `ForPersistingBacktestRun`.
- Closed two structural gaps discovered mid-implementation (both additive, documented under Deviations): `BacktestReport` had nowhere to carry a bootstrap CI, and `HypotheticalCandidateOutcome` had no per-criterion breakdown for attribution to key off.

## Task Commits

Each task was committed atomically:

1. **Task 1: runBacktest orchestrator — report assembly + single persist** - `c5f5ae1` (test)
2. **Task 2: apps/worker/src/backtest.ts operator CLI (DATABASE_URL-only, Zod argv)** - `00da5b5` (feat)
3. **Task 3: BT-05 no-write-path structural guard** - `28893c6` (test)

_Task 1 landed as a single `test` commit (RED confirmed via a real `vitest run` showing "Cannot find module './runBacktest.ts'" before the implementation existed, then GREEN in the same commit) — matches this phase's established task-level TDD granularity (27-01 through 27-05 precedent)._

## Files Created/Modified

- `packages/core/src/backtest/application/runBacktest.ts` — the orchestrator; `makeRunBacktestUseCase(deps)` driver-port factory
- `packages/core/src/backtest/application/runBacktest.test.ts` — 5 tests: full report-shape assembly + persist-once, attribution/ablation structural validity across all 9 criteria, empty-range degenerate report, StorageError propagation (never persists), `--calendar` filter narrowing
- `packages/core/src/backtest/application/ports.test.ts` — 3 tests: no forbidden write-port name declared/imported, no direct rules.ts/exit-rules.ts import, no update/delete counterpart to the backtest_runs write port
- `packages/core/src/backtest/domain/types.ts` — added `BootstrapCiRow` type + `BacktestReport.ci` field
- `packages/core/src/backtest/application/replayHypotheticalEntry.ts` — added `HypotheticalCandidateOutcome.breakdown` field, populated from `candidate.breakdown`
- `packages/core/src/backtest/index.ts` — threads `makeRunBacktestUseCase`/`RunBacktestDeps`/`RunBacktestParams`/`BootstrapCiRow`
- `packages/core/src/index.ts` — threads the same up to the top-level `@morai/core` barrel (value export, not just types)
- `apps/worker/src/backtest.ts` — the CLI; `parseBacktestArgs` (pure, exported) + the `import.meta.main` composition root
- `apps/worker/src/backtest.test.ts` — 7 tests covering `parseBacktestArgs`: valid range, malformed date, `--from` before the corpus start (and exactly at it), missing args, `--calendar`/`--report-only`, invalid `--calendar`
- `packages/adapters/src/index.ts` — added `makePostgresBacktestChainRepo`/`BacktestHistoryRepo`/`BacktestRunsRepo` exports (+ their repo types)

## Decisions Made

See `key-decisions` in frontmatter for full rationale on each. Summary:
- Two additive type/field extensions (`BacktestReport.ci`, `HypotheticalCandidateOutcome.breakdown`) were structurally required by this plan's own must-haves and were not anticipated by 27-01/27-05's shipped shapes — both are pure additions, zero existing-field changes, zero broken tests.
- The adapters barrel gap (three backtest repos never exported from `@morai/adapters`) was a genuine blocking issue for this plan's CLI, fixed the same way every other repo in that file already is threaded.
- Attribution/ablation/CI design choices (which samples, which seed, which aggregation) were made under `27-CONTEXT.md`'s explicit "Claude's Discretion" grant for report JSONB shape — each choice is documented and traceable to a locked constraint (sign+n never a coefficient, seeded determinism, n=13 CI-width-as-honesty).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `BacktestReport.ci` (BootstrapCiRow[])**
- **Found during:** Task 1 (designing the report assembly — no field existed to carry a bootstrap CI)
- **Issue:** The plan's own must-haves require the report to "include ... a bootstrap CI" alongside attribution/ablation, but the 27-01-shipped `BacktestReport` type had no field for it.
- **Fix:** Added `BootstrapCiRow = { metric, low, high, n }` and `BacktestReport.ci: ReadonlyArray<BootstrapCiRow>` — purely additive.
- **Files modified:** `packages/core/src/backtest/domain/types.ts`, `packages/core/src/backtest/index.ts`, `packages/core/src/index.ts`
- **Verification:** `runBacktest.test.ts` asserts `report.ci.length > 0` and `low <= high` per row; full suite green.
- **Committed in:** `c5f5ae1`

**2. [Rule 2 - Missing Critical] Added `HypotheticalCandidateOutcome.breakdown`**
- **Found during:** Task 1 (designing per-rule attribution — no per-criterion data existed on the outcome to split candidates by)
- **Issue:** CONTEXT.md's attribution wording ("high-scoring beat low-scoring") requires splitting candidates by their PER-RULE raw contribution, but `replayHypotheticalEntry`'s outcome shape only carried the aggregate `score`.
- **Fix:** Added `breakdown: ReadonlyArray<BreakdownEntry>` to the outcome type, populated from the already-computed `candidate.breakdown` (27-05's own scored candidate) — zero re-scoring, zero reimplementation.
- **Files modified:** `packages/core/src/backtest/application/replayHypotheticalEntry.ts`
- **Verification:** Confirmed no existing test in `replayHypotheticalEntry.test.ts` asserts exact-equality on the outcome object shape (only `.caveats` and empty-array checks) — no regression. Full suite green.
- **Committed in:** `c5f5ae1`

**3. [Rule 3 - Blocking] Threaded the three backtest Postgres repos through the adapters barrel**
- **Found during:** Task 2 (writing the CLI's composition root — `makePostgresBacktestChainRepo`/`BacktestHistoryRepo`/`BacktestRunsRepo` were unreachable via `await import("@morai/adapters")`)
- **Issue:** These repos existed since 27-01/27-03 but were never exported from `packages/adapters/src/index.ts`; every other CLI composition root in this codebase reaches repos through that barrel, never a direct relative path.
- **Fix:** Added the three `export { makePostgresXxx } from "./postgres/repos/xxx.ts"` + type export pairs, following the file's own existing convention exactly.
- **Files modified:** `packages/adapters/src/index.ts`
- **Verification:** `bun run typecheck` clean; the CLI's `await import("@morai/adapters")` destructure resolves.
- **Committed in:** `00da5b5`

---

**Total deviations:** 3 auto-fixed (2 missing-critical, 1 blocking)
**Impact on plan:** All three were required for the plan's own must-haves to be satisfiable at all — no scope creep beyond them. No architectural change (Rule 4) was triggered by any of them.

## Issues Encountered

One self-caught issue during Task 3 authoring (not a plan deviation — fixed before the task's own commit): the first draft of the BT-05 "no forbidden port name" guard scanned every line of every file, which flagged `ports.ts`'s own header comment (which names the forbidden token while explaining why it must stay absent — the exact false-positive class EXIT-10's own docstring warns about). Narrowed the check to only `export type`/`export interface`/`import` lines before the guard's first commit; re-ran to confirm all 3 guard tests pass.

## User Setup Required

None — no external service configuration required. Migration 0021 (`backtest_runs`) was created in 27-01 and has NOT been applied to prod; per this plan's own verification note, `bun run migrate` and a real CLI run against the target DB are the orchestrator's post-merge responsibility, not this plan's.

## Next Phase Readiness

- Phase 27 (PICK-04 Backtest Harness) is now feature-complete: storage (27-01), reuse seams (27-02), point-in-time readers (27-03), report kernel (27-04), replay use-cases (27-05), and the orchestrator + CLI + BT-05 guard (27-06) all ship and pass.
- Full monorepo suite green: 261 files, 2621 tests (including testcontainers); `bun run typecheck` and `bun run lint` both clean.
- Not yet done (explicitly out of this plan's scope per the assigning message): running `bun run migrate` against a real target DB, and running the CLI (`bun run apps/worker/src/backtest.ts --from 2026-06-12 --to <date>`) against live data. The orchestrator owns both post-merge.
- No blockers.

---
*Phase: 27-pick-04-backtest-harness*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 10 created/modified files verified present on disk; all 3 task commits (`c5f5ae1`, `00da5b5`, `28893c6`) verified present in git history.
