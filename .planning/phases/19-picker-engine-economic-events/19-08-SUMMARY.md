---
phase: 19-picker-engine-economic-events
plan: 08
subsystem: infra
tags: [pg-boss, worker, picker, fred, economic-events, gex, chain-trigger, hexagonal]

# Dependency graph
requires:
  - phase: 19-picker-engine-economic-events (19-04)
    provides: economic-events FRED+FOMC adapter, EconomicEvent port/domain types
  - phase: 19-picker-engine-economic-events (19-05)
    provides: picker-chain + picker-snapshot Postgres repos, migrations 0014/0015
  - phase: 19-picker-engine-economic-events (19-06)
    provides: makeComputePickerSnapshotUseCase (selectCandidates + scoreCalendarCandidates orchestration)
provides:
  - compute-picker pg-boss job (chain-triggered by compute-gex-snapshot, D-04)
  - fetch-economic-events pg-boss job (weekly Friday 17:00 ET cron, D-14)
  - compute-gex-snapshot -> compute-picker chain-trigger edit (T-19-18 singletonKey dedup)
  - worker composition wiring: economic-events adapter/repo, picker-chain repo, picker-snapshot
    repo, readGexContextForPicker adapter, computePickerSnapshot use-case
  - @morai/core and @morai/adapters barrel exports for the above (previously built but unexported)
affects: [19-09, picker-ui-live-data, economic-events-cron-monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chain-trigger via boss.send(singletonKey) fired after a successful use-case call (mirrors compute-analytics -> compute-gex-snapshot, 08-06)"
    - "composition-root context adapter (readGexContextForPicker) mapping one bounded context's row shape to another's port type, keeping the hexagon free of cross-context imports (architecture-boundaries §7)"

key-files:
  created:
    - apps/worker/src/handlers/compute-picker.ts
    - apps/worker/src/handlers/compute-picker.test.ts
    - apps/worker/src/handlers/fetch-economic-events.ts
    - apps/worker/src/handlers/fetch-economic-events.test.ts
  modified:
    - apps/worker/src/handlers/compute-gex-snapshot.ts
    - apps/worker/src/handlers/compute-gex-snapshot.test.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts
    - packages/core/src/index.ts
    - packages/core/src/picker/index.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "compute-picker mirrors compute-gex-snapshot's RTH+holiday gate even though it is chain-triggered right after gex (defense in depth against a stale/manual send landing off-hours)"
  - "absGammaStrike (GexContextForPicker) is derived at the composition root from GexSnapshotRow.strikes -- the strike with the largest abs(gex) magnitude -- since GexSnapshotRow itself has no absGammaStrike field"
  - "fetch-economic-events shares fetch-cot's exact cron slot (0 17 * * 5 America/New_York) as its own single schedule() call -- no CR-01 collision risk since it is the only schedule() call for that queue name"
  - "reworded compute-picker's terminal-job doc comments from 'no boss.send' to 'no further enqueue' so the plan's own literal-grep acceptance criterion (rg 'boss.send' returns no match) passes without weakening the comment's meaning"

requirements-completed: [PICK-01, PICK-03]

coverage:
  - id: D1
    description: "compute-picker pg-boss job — chain-triggered by compute-gex-snapshot (no cron), RTH+holiday gated, terminal (no further enqueue)"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "apps/worker/src/handlers/compute-picker.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "fetch-economic-events pg-boss job — weekly Friday 17:00 ET cron, fetches unified FRED+FOMC-seed events and persists them"
    requirement: "PICK-03"
    verification:
      - kind: unit
        ref: "apps/worker/src/handlers/fetch-economic-events.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "compute-gex-snapshot chain-triggers compute-picker on success via boss.send with a singletonKey (T-19-18 dedup)"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "apps/worker/src/handlers/compute-gex-snapshot.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "schedule.ts registers 12 queues total (compute-picker no-cron, fetch-economic-events weekly) preserving createQueue->schedule->work ordering (CR-01)"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "apps/worker/src/schedule.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "worker composition root wires economic-events adapter/repo, picker-chain repo, picker-snapshot repo, and the gex-context adapter into a real computePickerSnapshot use-case + both new handlers"
    requirement: "PICK-03"
    verification:
      - kind: other
        ref: "bun run typecheck (tsc --build --force, exits 0) + rg checks for makeComputePickerSnapshotUseCase/makeEconomicEventsAdapter/computePicker:/fetchEconomicEvents: in main.ts"
        status: pass
    human_judgment: true
    rationale: "No build script exists for apps/worker (bun runs src/main.ts directly, no bundling step); this composition wiring has never run against a live Postgres/pg-boss instance in this session (no Docker available for testcontainers) — a human should confirm the worker boots cleanly against a real DB before this pipeline is considered live-verified."

duration: 20min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 08: Wire Picker Engine + Economic-Events into the Worker Summary

**Chain-triggered compute-picker job + weekly fetch-economic-events cron, with compute-gex-snapshot now enqueueing compute-picker on success — the full precompute pipeline is wired end-to-end in the worker composition root.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files modified:** 12 (4 created, 8 modified)

## Accomplishments

- `makeComputePickerHandler`: array-guard → RTH+holiday gate → call `computePickerSnapshot` use-case → throw on err; terminal (no further enqueue) — mirrors `compute-gex-snapshot`'s shape exactly.
- `makeFetchEconomicEventsHandler`: array-guard → fetch unified FRED+FOMC events → persist → throw on err; no RTH gate (weekly cron, mirrors `fetch-cot`).
- `compute-gex-snapshot` handler edited: gained a `boss` dep and now fire-and-forget enqueues `compute-picker` on success with `singletonKey: "triggered-by-gex"` (T-19-18 dedup) — it is no longer the terminal job in the analytics chain.
- `schedule.ts`: `registerAllJobs` now creates 12 queues, schedules 8 crons (`fetch-economic-events` shares `fetch-cot`'s Friday 17:00 ET slot), and registers 12 work handlers. `compute-picker` gets `createQueue` + `work` only — no `schedule()` call (chain-triggered, D-04).
- `main.ts` composition root wires: `makeEconomicEventsAdapter` (FRED CPI/NFP + `FOMC_SEED`), `makePostgresEconomicEventsRepo`, `makePostgresPickerChainRepo`, `makePostgresPickerSnapshotRepo`, a `readGexContextForPicker` adapter (maps `GexSnapshotRow` → `GexContextForPicker`, deriving `absGammaStrike` from the per-strike gex profile), `makeComputePickerSnapshotUseCase`, and both new handlers into `registerAllJobs`.
- Barrel-export plumbing (Rule 3, 19-07 precedent): `makeComputePickerSnapshotUseCase`, `ForRunningComputePicker`, `GexContextForPicker`, `ForReadingGexContext` now exported from `@morai/core`; `makeEconomicEventsAdapter`, `FOMC_SEED`, `makePostgresEconomicEventsRepo`/`makeMemoryEconomicEventsRepo`, `makePostgresPickerChainRepo`/`makeMemoryPickerChainRepo` now exported from `@morai/adapters` — all built in 19-04/19-05/19-06 but never re-exported through the package barrels, so `main.ts` couldn't consume them until now.

## Task Commits

Each task was committed atomically:

1. **Task 1: compute-picker + fetch-economic-events handlers + chain-trigger edit** - `72f9366` (feat)
2. **Task 2: schedule.ts — register compute-picker (no cron) + fetch-economic-events (weekly)** - `6676d78` (feat)
3. **Task 3: Worker composition — wire picker + economic-events adapters, use-cases, handlers** - `cd0768f` (feat)
4. **Follow-up fix (Task 1 acceptance criterion):** `402241b` (fix) — see Deviations below.

## Files Created/Modified

- `apps/worker/src/handlers/compute-picker.ts` - Chain-triggered, terminal pg-boss handler for the picker compute
- `apps/worker/src/handlers/compute-picker.test.ts` - Holiday/RTH gate, ok/err, array-guard coverage
- `apps/worker/src/handlers/fetch-economic-events.ts` - Fetch→persist weekly-cron handler
- `apps/worker/src/handlers/fetch-economic-events.test.ts` - fetch-err/persist-err/ok/array-guard coverage
- `apps/worker/src/handlers/compute-gex-snapshot.ts` - Added `boss` dep + chain-trigger enqueue of `compute-picker`
- `apps/worker/src/handlers/compute-gex-snapshot.test.ts` - Added boss-stub + 3 new chain-trigger tests
- `apps/worker/src/schedule.ts` - 12-queue/8-cron/12-handler registration (compute-picker no-cron, fetch-economic-events weekly)
- `apps/worker/src/schedule.test.ts` - Updated queue/cron/handler counts + 2 new assertions
- `apps/worker/src/main.ts` - Composition root wiring for the picker + economic-events pipeline
- `packages/core/src/index.ts` - Re-exports `makeComputePickerSnapshotUseCase`, `ForRunningComputePicker`, `GexContextForPicker`, `ForReadingGexContext`
- `packages/core/src/picker/index.ts` - Same re-exports at the bounded-context barrel
- `packages/adapters/src/index.ts` - Re-exports economic-events adapter/repo + picker-chain repo (postgres + memory twins)

## Decisions Made

- `absGammaStrike` (needed by `GexContextForPicker`) has no field on `GexSnapshotRow` — derived it at the composition root from `row.strikes` (the strike with the largest `abs(gex)`), keeping the mapping logic out of the picker core per architecture-boundaries §7.
- `fetch-economic-events` reuses `fetch-cot`'s exact cron string/tz as its own single `schedule()` call — safe under CR-01 since each queue name gets only one schedule call in this plan.
- Reworded two doc comments in `compute-picker.ts` from "no boss.send" to "no further enqueue" — the plan's own acceptance criterion literal-greps for `boss.send` and expects zero matches; the original comment's wording (while correct in meaning) tripped that grep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Barrel-export plumbing for picker use-case + adapters**
- **Found during:** Task 1 (writing `compute-picker.ts`, which needs `ForRunningComputePicker` from `@morai/core`) and Task 3 (writing `main.ts`, which needs `makeComputePickerSnapshotUseCase`, `GexContextForPicker`, `makeEconomicEventsAdapter`, `makePostgresEconomicEventsRepo`, `makePostgresPickerChainRepo`)
- **Issue:** None of these were re-exported through `packages/core/src/index.ts`, `packages/core/src/picker/index.ts`, or `packages/adapters/src/index.ts` despite being fully implemented in 19-04/19-05/19-06 — importing them directly would have required reaching past the package barrel (a hexagon-boundary violation) or would fail to compile
- **Fix:** Added the missing type/value re-exports to all three barrel files (mirrors the exact gap 19-07 hit and fixed for `getPicker`/`picker-snapshot`)
- **Files modified:** `packages/core/src/index.ts`, `packages/core/src/picker/index.ts`, `packages/adapters/src/index.ts`
- **Verification:** `bun run typecheck` (tsc --build --force) exits 0 across the whole workspace
- **Committed in:** `72f9366` (Task 1 commit)

**2. [Rule 1 - Bug] compute-picker.ts comment wording tripped its own acceptance-criteria grep**
- **Found during:** post-Task-3 acceptance-criteria verification pass
- **Issue:** The plan's Task 1 acceptance criterion runs `rg -n 'boss.send' apps/worker/src/handlers/compute-picker.ts` and expects no match (proving the terminal job never enqueues). The handler's doc comments correctly said "no boss.send" but that literal substring matched the grep, producing a false failure signal
- **Fix:** Reworded the two occurrences to "no further enqueue" — same meaning, no behavior change, passes the literal check
- **Files modified:** `apps/worker/src/handlers/compute-picker.ts` (comments only)
- **Verification:** `rg -n 'boss.send' apps/worker/src/handlers/compute-picker.ts` now returns no match; full worker test suite (89 tests) still green
- **Committed in:** `402241b`

---

**Total deviations:** 2 auto-fixed (1 blocking plumbing gap, 1 bug — self-defeating comment wording)
**Impact on plan:** Both fixes were necessary for the plan's own stated acceptance criteria to hold. No scope creep — no new business logic, no architectural changes.

## Issues Encountered

- The plan's verify commands used `--project @morai/worker` / `--filter @morai/worker`, but the actual vitest project name is `apps/worker` (per `apps/worker/vitest.config.ts`) and there is no root-level workspace filter flag for `tsc --build` or a `build` script for `apps/worker` at all (the worker runs directly via `bun run src/main.ts`, no bundling step). Ran the equivalent correct commands instead: `bun run test --project apps/worker -- <files>` and `bun run typecheck` (root `tsc --build --force`, which type-checks the whole project-reference graph including the worker). Both are green; `bun run test` (full workspace) also passed 1623/1623 non-skipped tests (24 tests skipped — Docker unavailable for testcontainers-backed Postgres contract tests, a pre-existing environment limitation unrelated to this plan).

## User Setup Required

None - no external service configuration required. `FRED_API_KEY` is already a known-optional env var from 19-04 (the adapter returns `err` gracefully if unset, per D-17 no-fabricated-fallback discipline); no new env vars introduced.

## Next Phase Readiness

- The full precompute pipeline (`fetch-schwab-chain` → ... → `compute-analytics` → `compute-gex-snapshot` → `compute-picker`) is wired end-to-end and type-checks/tests clean, but has NOT been exercised against a live Postgres + pg-boss instance in this session (no Docker available). A human/operator should watch the first live RTH cycle post-deploy to confirm `compute-picker` actually fires and writes a `picker_snapshot` row, and the first Friday 17:00 ET run of `fetch-economic-events` for a successful FRED parse (per 19-04's own documented human-check note about its assumed FRED response shape).
- 19-09 (the final plan in this phase) can now build against a real, chain-triggered `picker_snapshot` table instead of the fixture-only path 19-07 used for HTTP/MCP wiring.
- No blockers.

---
*Phase: 19-picker-engine-economic-events*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all 4 commit hashes (72f9366,
6676d78, cd0768f, 402241b) confirmed in `git log --oneline --all`.
