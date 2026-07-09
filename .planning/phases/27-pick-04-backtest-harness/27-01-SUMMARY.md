---
phase: 27-pick-04-backtest-harness
plan: 01
subsystem: database
tags: [drizzle, postgres, zod, vitest, testcontainers, hexagonal]

requires: []
provides:
  - "docs/architecture/backtest-harness.md — the phase's source-of-truth doc (three replay paths, point-in-time discipline, reuse rule, honesty rule, hard boundary)"
  - "backtest_runs table (migration 0021) — append-only report storage"
  - "packages/core/src/backtest/ — driven ports (persist + 4 read ports) and BacktestReport/replay-result domain types, reachable from @morai/core"
  - "backtest_runs INSERT-only repo + memory twin, shared contract-tested"
affects: [27-02, 27-03, 27-04, 27-05, 27-06]

tech-stack:
  added: []
  patterns:
    - "Backtest bounded context under packages/core/src/backtest/ (application/ports.ts + domain/types.ts + index.ts), mirroring exits' Phase-26 own-domain-only convention"
    - "Shared adapter-local Zod write-boundary validator (backtest-report-schema.ts) reused by both the Postgres repo and the memory twin — avoids an adapter-to-adapter drizzle-leak import"

key-files:
  created:
    - docs/architecture/backtest-harness.md
    - packages/adapters/src/postgres/migrations/0021_backtest_runs.sql
    - packages/core/src/backtest/domain/types.ts
    - packages/core/src/backtest/application/ports.ts
    - packages/core/src/backtest/index.ts
    - packages/adapters/src/backtest-report-schema.ts
    - packages/adapters/src/postgres/repos/backtest-runs.ts
    - packages/adapters/src/memory/backtest-runs.ts
    - packages/adapters/src/__contract__/backtest-runs.contract.ts
    - packages/adapters/src/postgres/repos/backtest-runs.contract.test.ts
    - packages/adapters/src/memory/backtest-runs.contract.test.ts
  modified:
    - docs/architecture/data-model.md
    - docs/TOPIC-MAP.md
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - packages/core/src/index.ts

key-decisions:
  - "Report write-boundary validation lives in a new packages/adapters/src/backtest-report-schema.ts (top-level, zero drizzle deps), shared by both the Postgres repo and the memory twin — mirrors the existing smile-moneyness.ts 'shared by both adapters' precedent instead of an adapter-to-adapter import that would leak drizzle into the memory twin."
  - "Read-port return shapes (ChainLegQuoteAsOf, StoredPickerSnapshotRow, FullHistorySnapshotRow) are backtest-owned re-declarations, not imports of picker/exits domain types, per architecture-boundaries §7 — plan 03 implements them against these shapes."

requirements-completed: [BT-04, BT-05]

coverage:
  - id: D1
    description: "backtest-harness.md documents the three replay paths, point-in-time discipline, n=13 honesty rule, and never-writes-weights boundary before any backtest code exists"
    requirement: "BT-04"
    verification:
      - kind: other
        ref: "test -f docs/architecture/backtest-harness.md && grep backtest_runs docs/architecture/data-model.md && grep backtest-harness docs/TOPIC-MAP.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration 0021 creates the append-only backtest_runs table (RLS enabled); backtest module skeleton declares all driven ports + report/result types, reachable from @morai/core"
    requirement: "BT-04"
    verification:
      - kind: unit
        ref: "bun run typecheck"
        status: pass
    human_judgment: false
  - id: D3
    description: "backtest_runs repo is INSERT-only: a second persist never overwrites the first, and the repo surface exposes only insertBacktestRun (no update/delete/weight-write)"
    requirement: "BT-05"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/backtest-runs.contract.test.ts#backtest-runs persistence contract"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/backtest-runs.contract.test.ts#backtest-runs persistence contract"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-09
status: complete
---

# Phase 27 Plan 01: Backtest Harness Storage Foundation Summary

**Append-only `backtest_runs` table (migration 0021), INSERT-only repo/twin, and the `packages/core/src/backtest/` port+type skeleton — docs-first, zero weight-write path.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-09T11:33:00Z
- **Completed:** 2026-07-09T12:13:36Z
- **Tasks:** 3
- **Files modified:** 16

## Accomplishments

- `docs/architecture/backtest-harness.md` written first (D-04 docs-before-architecture): three replay paths (leakage oracle, 13-trade exit reproduction, hypothetical entry+exit), point-in-time discipline, the reuse-the-live-engine rule, the n=13 honesty rule, both documented residual caveats (late-solved BSM, no event-discovery timestamp), and the never-writes-weights hard boundary.
- Migration `0021_backtest_runs.sql` generated via `drizzle-kit generate` (not hand-written) — `backtest_runs(id uuid PK, created_at, params jsonb, report jsonb)`, RLS enabled.
- `packages/core/src/backtest/` bounded-context skeleton: `application/ports.ts` declares `ForPersistingBacktestRun` plus the four read ports plan 03 implements (`ForReadingChainAsOf`, `ForReadingDailySpotClosesAsOf`, `ForReadingPickerSnapshotsInRange`, `ForReadingFullSnapshotHistoryForCalendar`); `domain/types.ts` declares `BacktestReport` and the replay-result shapes (`CohortMismatch`/`ReplayMismatch`, `DirectionalAttributionRow`, `AblationRow`, `CoverageDay`, `TradeReproduction`) — pure, readonly, no imports beyond `@morai/shared`. Threaded through `packages/core/src/index.ts`.
- `backtest_runs` INSERT-only Postgres repo + in-memory twin, both validating the report JSONB via a shared `backtestReportSchema` before insert. Shared contract spec (`runBacktestRunsContractTests`) proves append-only behavior (two persists → two rows) and that the repo surface exposes only `insertBacktestRun`. RED confirmed (module-not-found) before implementation; GREEN after — 6/6 new tests pass against real testcontainers Postgres and the memory twin.

## Task Commits

1. **Task 1: Docs-first — backtest-harness architecture note + data-model row + TOPIC-MAP** - `fd68eeb` (docs)
2. **Task 2: Migration 0021 backtest_runs table + backtest module skeleton** - `dc3afa9` (feat)
3. **Task 3: backtest_runs INSERT-only repo + memory twin + append-only contract test** - `4ed0daf` (test — RED confirmed inline, then implemented to GREEN in the same commit per TDD task convention)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `docs/architecture/backtest-harness.md` - phase source-of-truth doc
- `docs/architecture/data-model.md` - new `backtest_runs` table row
- `docs/TOPIC-MAP.md` - registered the new doc
- `packages/adapters/src/postgres/schema.ts` - `backtestRuns` pgTable (id/createdAt/params/report, enableRLS)
- `packages/adapters/src/postgres/migrations/0021_backtest_runs.sql` - drizzle-generated DDL
- `packages/adapters/src/postgres/migrations/meta/_journal.json` - renamed the auto-generated tag `0021_unknown_hellion` → `0021_backtest_runs` to match the file
- `packages/core/src/backtest/domain/types.ts` - `BacktestReport` + replay-result types
- `packages/core/src/backtest/application/ports.ts` - `ForPersistingBacktestRun` + 4 read-port declarations
- `packages/core/src/backtest/index.ts` - bounded-context barrel
- `packages/core/src/index.ts` - re-exports the backtest barrel
- `packages/adapters/src/backtest-report-schema.ts` - shared Zod write-boundary validator (new, not in original file list — see Deviations)
- `packages/adapters/src/postgres/repos/backtest-runs.ts` - `makePostgresBacktestRunsRepo`
- `packages/adapters/src/memory/backtest-runs.ts` - `makeMemoryBacktestRunsRepo`
- `packages/adapters/src/__contract__/backtest-runs.contract.ts` - shared contract-test suite
- `packages/adapters/src/postgres/repos/backtest-runs.contract.test.ts` - testcontainers wiring
- `packages/adapters/src/memory/backtest-runs.contract.test.ts` - memory wiring

## Decisions Made

- Report validation schema placed in a new top-level `packages/adapters/src/backtest-report-schema.ts` rather than inline in either repo file. Importing the Postgres repo's schema directly from the memory twin would pull `drizzle-orm`/`Db` into the memory adapter (defeats the point of a DB-free twin). A shared, dependency-free sibling module — mirroring the existing `smile-moneyness.ts` "shared by both adapters" pattern — avoids that leak. This is one file beyond the plan's `files_modified` list; justified under deviation Rule 2 (missing critical functionality: a single write-boundary validator, not duplicated logic that could drift between backends).
- Read-port return shapes in `application/ports.ts` (`ChainLegQuoteAsOf`, `StoredPickerSnapshotRow`, `FullHistorySnapshotRow`) are new backtest-owned type declarations, following the exits-context precedent of never importing another bounded context's `domain/` types (architecture-boundaries §7). Plan 03 implements these read ports and may refine field lists as needed — this plan only had to declare a plausible, complete shape.
- Dropped one originally-planned contract-test case ("rejects a malformed report blob") because exercising it required a `BacktestRunRow` value that violates `BacktestReport`'s TypeScript shape, which is only reachable via a forbidden `as` type assertion (typescript.md). The `<behavior>` list in the plan didn't require this test explicitly — the underlying Zod validation still runs on every insert (both repos), it's just not covered by a dedicated contract-test case in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed migration file + journal tag to match the plan's required name**
- **Found during:** Task 2
- **Issue:** `drizzle-kit generate` auto-named the file `0021_unknown_hellion.sql` (random tag), but the plan and `27-VALIDATION.md` require `0021_backtest_runs.sql`.
- **Fix:** Renamed the file and updated the matching `tag` field in `migrations/meta/_journal.json` so Drizzle's migrator (which reads tags from the journal, not just directory listing) stays consistent.
- **Files modified:** `packages/adapters/src/postgres/migrations/0021_backtest_runs.sql`, `packages/adapters/src/postgres/migrations/meta/_journal.json`
- **Verification:** `ls packages/adapters/src/postgres/migrations/0021_backtest_runs.sql` succeeds; the postgres contract test (which boots a real testcontainers Postgres through the full migration chain including 0021) passes.
- **Committed in:** `dc3afa9` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added a shared write-boundary Zod schema for the report blob**
- **Found during:** Task 3
- **Issue:** The plan's action text asked to "validate the report blob through the same kind of parse boundary exit-verdicts uses ... so a malformed blob is rejected before insert," but no contracts-package file was in this plan's file list, and duplicating a hand-rolled schema in both the Postgres repo and the memory twin risks drift between backends.
- **Fix:** Added `packages/adapters/src/backtest-report-schema.ts` — a single Zod schema imported by both `postgres/repos/backtest-runs.ts` and `memory/backtest-runs.ts` — following the codebase's existing `smile-moneyness.ts` precedent for logic shared across both adapter backends without cross-importing between them.
- **Files modified:** `packages/adapters/src/backtest-report-schema.ts` (new), `packages/adapters/src/postgres/repos/backtest-runs.ts`, `packages/adapters/src/memory/backtest-runs.ts`
- **Verification:** Both contract-test suites pass; `bun run typecheck` and `bun run lint` are clean.
- **Committed in:** `4ed0daf` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes were necessary for the migration to match its required name and for the write-boundary validation to be single-sourced across both adapter backends. No scope creep — no new tables, no new read-port implementations, no CLI code (all still owned by later plans in this phase).

## Issues Encountered

None beyond the two auto-fixes documented above.

## User Setup Required

None — no external service configuration required. Migration 0021 has NOT been run against prod; the orchestrator's deploy step owns `bun run migrate`.

## Next Phase Readiness

- Plan 03 can implement the four read ports (`ForReadingChainAsOf`, `ForReadingDailySpotClosesAsOf`, `ForReadingPickerSnapshotsInRange`, `ForReadingFullSnapshotHistoryForCalendar`) against the exact declared shapes in `packages/core/src/backtest/application/ports.ts`.
- Plan 05 (replay use-cases) and plan 06 (CLI/report) can build `BacktestReport` instances against `packages/core/src/backtest/domain/types.ts` and persist them via `ForPersistingBacktestRun` — the storage contract is proven append-only.
- No blockers. Full test suite (246 files, 2521 tests) green; typecheck and lint clean.

---
*Phase: 27-pick-04-backtest-harness*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 12 created files verified present on disk; all 3 task commits (`fd68eeb`, `dc3afa9`, `4ed0daf`) verified present in git history.
