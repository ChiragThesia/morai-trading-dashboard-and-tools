---
phase: 27-pick-04-backtest-harness
plan: 03
subsystem: database
tags: [drizzle, postgres, zod, vitest, testcontainers, hexagonal, point-in-time]

requires:
  - phase: 27-pick-04-backtest-harness
    provides: "27-01's packages/core/src/backtest/application/ports.ts — the four read-port type declarations this plan implements (ForReadingChainAsOf, ForReadingDailySpotClosesAsOf, ForReadingPickerSnapshotsInRange, ForReadingFullSnapshotHistoryForCalendar)"
provides:
  - "backtest-chain.ts — Postgres + memory readChainAsOf: as-of-T union/dedup chain read with the BT-01 no-lookahead guarantee, full column set (bid/ask/mark/bsm greeks/OI/underlyingPrice/source/time)"
  - "backtest-history.ts — Postgres + memory readDailySpotClosesAsOf (RV20 no-lookahead) and readPickerSnapshotsInRange (cohort ledger)"
  - "calendar-snapshots.ts readFullSnapshotHistoryForCalendar — source-inclusive full snapshot history for one calendar, ASC, any source/status"
affects: [27-05, 27-06]

tech-stack:
  added: []
  patterns:
    - "As-of-T chain/history reads generalize their live-latest counterparts by adding exactly ONE lte(time, asOfT) predicate to the existing MAX(time)-then-lookback-window pattern"
    - "Memory twins for as-of-T ports re-implement the same two-step cohort resolution in-memory (not a trivial seed-passthrough) so the shared contract suite's lookahead-refusal test is genuinely proven on both backends"

key-files:
  created:
    - packages/adapters/src/postgres/repos/backtest-chain.ts
    - packages/adapters/src/postgres/repos/backtest-chain.contract.test.ts
    - packages/adapters/src/memory/backtest-chain.ts
    - packages/adapters/src/memory/backtest-chain.contract.test.ts
    - packages/adapters/src/__contract__/backtest-chain.contract.ts
    - packages/adapters/src/postgres/repos/backtest-history.ts
    - packages/adapters/src/postgres/repos/backtest-history.contract.test.ts
    - packages/adapters/src/memory/backtest-history.ts
    - packages/adapters/src/memory/backtest-history.contract.test.ts
    - packages/adapters/src/__contract__/backtest-history.contract.ts
  modified:
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.contract.test.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts

key-decisions:
  - "Added memory/backtest-chain.contract.test.ts and memory/backtest-history.contract.test.ts (not in the plan's files_modified list) to wire the shared contract suite against the in-memory twins — mirroring the existing picker-snapshot.ts and 27-01's backtest-runs.ts precedent, where 'the twin is contract-tested identically to the adapter' is the whole point of shipping one. Without these files the BT-01 no-lookahead test would only run against Postgres, and the memory twin's cohort logic would be untested."
  - "Memory twins for as-of-T reads implement the SAME two-step cohort-resolution algorithm as Postgres (max-time-with-bsmIv, then lookback window, then per-contract dedup) rather than a trivial seed-array passthrough — needed so the shared contract suite's lookahead-refusal assertion is genuinely exercised on both backends, not just Postgres."
  - "Added a postgres-only supplementary test (readFullSnapshotHistoryForCalendar — closed calendars included) asserting the closed-calendar-inclusion behavior directly via raw SQL, since the shared seed helper's seedCalendar always inserts status='open' and the implementation itself performs no join to calendars at all (status is structurally irrelevant, but the plan's behavior spec calls it out explicitly)."

requirements-completed: [BT-01, BT-02, BT-03]

coverage:
  - id: D1
    description: "readChainAsOf resolves the newest at-or-before-T cohort with live union/dedup semantics; a future-dated leg_observations row never changes a past-T read (BT-01's required no-lookahead check)"
    requirement: "BT-01"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/backtest-chain.contract.test.ts#backtest-chain as-of-T read contract > BT-01 no-lookahead: a future-dated row never changes a past-T read's result (the required check)"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/backtest-chain.contract.test.ts#backtest-chain as-of-T read contract > BT-01 no-lookahead: a future-dated row never changes a past-T read's result (the required check)"
        status: pass
    human_judgment: false
  - id: D2
    description: "readDailySpotClosesAsOf excludes future closes (RV20 no-lookahead); readPickerSnapshotsInRange returns the in-range picker_snapshot cohort ledger, validated on read"
    requirement: "BT-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/backtest-history.contract.test.ts#backtest-history point-in-time reads contract"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/backtest-history.contract.test.ts#backtest-history point-in-time reads contract"
        status: pass
    human_judgment: false
  - id: D3
    description: "readFullSnapshotHistoryForCalendar returns every row for a calendar ASC, including schwab_chain-sourced rows (regression guard for the mapSnapshotRow drop bug), regardless of open/closed status"
    requirement: "BT-03"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts#calendar-snapshots persistence contract > readFullSnapshotHistoryForCalendar — source-inclusive full history (27-03, BT-03)"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/calendar-snapshots.contract.test.ts#calendar-snapshots persistence contract > readFullSnapshotHistoryForCalendar — source-inclusive full history (27-03, BT-03)"
        status: pass
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts#postgres readFullSnapshotHistoryForCalendar — closed calendars included > returns snapshot rows for a CLOSED calendar"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-09
status: complete
---

# Phase 27 Plan 03: Point-in-Time Readers Summary

**Three as-of-T reads for the replay engine — chain (BT-01 no-lookahead), RV20 daily closes + picker_snapshot cohort ledger, and a source-inclusive full snapshot history — Postgres + memory twins, TDD RED-then-GREEN throughout.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-09T12:15:00Z
- **Completed:** 2026-07-09T12:40:00Z
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments

- `backtest-chain.ts` (Postgres + memory): `readChainAsOf` generalizes `picker-chain.ts`'s `readChainForPicker` by adding exactly ONE predicate — `lte(legObservations.time, asOfT)` — to the MAX(time WHERE bsm_iv IS NOT NULL) step, then the identical 10-min lookback union + per-contract-newest-wins dedup, but SELECTing the full column set (bid/ask/mark/bsmIv/bsmDelta/bsmGamma/bsmTheta/bsmVega/openInterest/underlyingPrice/source/time) so one read serves both candidate-universe generation and hypothetical exit-context assembly. The memory twin implements the SAME two-step algorithm (not a passthrough), so the BT-01 no-lookahead test genuinely proves the behavior on both backends.
- `backtest-history.ts` (Postgres + memory): `readDailySpotClosesAsOf` bounds picker-history's "last N distinct days present" read with `time <= asOfT` (RV20's as-of-T input — PITFALLS.md Pitfall 2's `vrp` leakage vector). `readPickerSnapshotsInRange` returns every `picker_snapshot` row with `observed_at` in `[from, to]`, ASC, validated through `pickerSnapshotResponse.parse` at the read boundary (mirrors picker-snapshot.ts's T-19-10 convention).
- `calendar-snapshots.ts` gained `readFullSnapshotHistoryForCalendar` — a plain SELECT with NO status join and NO source filter, mapped through a source-inclusive mapper mirroring `readLatestSnapshotPerOpenCalendar`'s pattern (never `mapSnapshotRow`'s `source !== "cboe" → null` drop). A dedicated regression test seeds both a `cboe` and a `schwab_chain` row and asserts both survive in ASC order; a postgres-only supplementary test proves closed-calendar inclusion directly.
- All three reads shipped with in-memory twins and shared `__contract__` test suites (architecture-boundaries §8), each RED-confirmed (module-not-found / "is not a function") before implementation, then GREEN.

## Task Commits

1. **Task 1: As-of-T union/dedup chain read (BT-01 no-lookahead)** - `d78fd49` (test)
2. **Task 2: As-of-T RV20 closes + picker-snapshot cohort ledger** - `613b654` (test)
3. **Task 3: Source-inclusive full snapshot history (BT-03 schwab_chain regression guard)** - `a538abd` (test)

**Plan metadata:** pending (this commit)

_Note: each task's RED step (module-not-found / "is not a function") was confirmed via a real `vitest run` before the corresponding implementation was written — shown inline above, not a separate commit, per this phase's TDD task convention (mirrors 27-01 Task 3)._

## Files Created/Modified

- `packages/adapters/src/postgres/repos/backtest-chain.ts` - `makePostgresBacktestChainRepo` — as-of-T union/dedup chain read
- `packages/adapters/src/postgres/repos/backtest-chain.contract.test.ts` - testcontainers wiring
- `packages/adapters/src/memory/backtest-chain.ts` - `makeMemoryBacktestChainRepo` — in-memory twin, same two-step algorithm
- `packages/adapters/src/memory/backtest-chain.contract.test.ts` - memory wiring
- `packages/adapters/src/__contract__/backtest-chain.contract.ts` - shared contract suite (BT-01 required check)
- `packages/adapters/src/postgres/repos/backtest-history.ts` - `makePostgresBacktestHistoryRepo` — RV20 as-of-T + cohort ledger
- `packages/adapters/src/postgres/repos/backtest-history.contract.test.ts` - testcontainers wiring
- `packages/adapters/src/memory/backtest-history.ts` - `makeMemoryBacktestHistoryRepo` — in-memory twin
- `packages/adapters/src/memory/backtest-history.contract.test.ts` - memory wiring
- `packages/adapters/src/__contract__/backtest-history.contract.ts` - shared contract suite
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` - added `readFullSnapshotHistoryForCalendar`
- `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` - wired the new method + closed-calendar supplementary test
- `packages/adapters/src/memory/calendar-snapshots.ts` - added the twin's `readFullSnapshotHistoryForCalendar`
- `packages/adapters/src/memory/calendar-snapshots.contract.test.ts` - wired the new method
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` - extended with the source-inclusion regression test + numeric-field-mapping test + empty-history test

## Decisions Made

- Added `memory/backtest-chain.contract.test.ts` and `memory/backtest-history.contract.test.ts` beyond the plan's file list — Rule 2 (missing critical functionality): without wiring the shared contract suite to the memory twin, the BT-01 no-lookahead check and the RV20/cohort-ledger tests would only run against Postgres, leaving the twin's own cohort-resolution logic completely untested. This mirrors the existing codebase convention (picker-snapshot.ts, 27-01's backtest-runs.ts both ship a memory contract test alongside the shared suite).
- Memory twins implement the full two-step cohort-resolution algorithm (not a seed-and-return passthrough like the existing `memory/picker-chain.ts`) — required because this plan's whole point is proving the no-lookahead guarantee, and a passthrough twin would trivially pass without exercising any real logic.
- Kept the puts-only filter (`contractType = "P"`) in `readChainAsOf`, matching the plan's action text ("generalize readChainForPicker's ... query by adding exactly ONE predicate") — the RESEARCH sketch says "identical selectDistinctOn/join/orderBy as readChainForPicker" and does not call for dropping that filter.
- Added a postgres-only "closed calendar included" test for `readFullSnapshotHistoryForCalendar` (not in the shared `__contract__` suite, since the shared seed helper's `seedCalendar` always inserts `status='open'`) — proves the behavior spec's "regardless of calendars.status (closed included)" claim directly against a real closed-status row via raw SQL.

## Deviations from Plan

### Auto-fixed Issues

None — Rule 1/2/3 auto-fixes only apply to bugs/missing-functionality found while executing; no bugs were found. The two additions above (memory contract test files) are documented as key-decisions rather than deviations since they are pure test-infrastructure additions with zero production-code behavior change, following the exact shape of 27-01's own precedent.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** No scope creep. Two test-infrastructure files added beyond the plan's explicit list, both justified by the "ship the twin, contract-test it" architectural rule this exact phase (27-01) already established as precedent.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 05 (replay use-cases) can now call `readChainAsOf`, `readDailySpotClosesAsOf`, `readPickerSnapshotsInRange`, and `readFullSnapshotHistoryForCalendar` against real Postgres or the in-memory twins — all four ports declared in 27-01's `ports.ts` are now fully implemented.
- Full test suite (251 files, 2555 tests) green; `bun run typecheck` and `bun run lint` clean. `calendar-snapshots.ts`'s existing readers (readJournal, resolveLegSnapshot, readSnapshotsForCycle, readLatestSnapshotTime, recomputeSnapshotPnl, readLatestSnapshotPerOpenCalendar) did not regress.
- No blockers.

---
*Phase: 27-pick-04-backtest-harness*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 15 created/modified files verified present on disk; all 3 task commits (`d78fd49`, `613b654`, `a538abd`) verified present in git history.
