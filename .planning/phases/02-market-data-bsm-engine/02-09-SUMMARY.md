---
phase: 02-market-data-bsm-engine
plan: "09"
subsystem: worker
tags: [pg-boss, queue-boot, gap-closure, tdd]
dependency_graph:
  requires: []
  provides: [worker-boots-fresh-db, chain-enqueue-contained]
  affects: [apps/worker]
tech_stack:
  added: []
  patterns: [pg-boss-createQueue-before-schedule, fire-and-forget-with-catch]
key_files:
  created: []
  modified:
    - apps/worker/src/main.ts
    - apps/worker/src/handlers/fetch-cboe-chain.ts
    - apps/worker/src/handlers/fetch-cboe-chain.test.ts
decisions:
  - "createQueue calls placed immediately after boss.start() and before any boss.schedule()/boss.work() (CR-01)"
  - "boss.send().catch() with unknown-typed catch variable — consistent with useUnknownInCatchVariables (WR-02)"
  - "No fourth queue created — D-08 (no manual trigger) preserved"
metrics:
  duration: "5m"
  completed: "2026-06-11T19:08:05Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 02 Plan 09: Worker Boot Gap Closure Summary

Three idempotent `boss.createQueue()` calls added before schedule/work, and the chain handler's fire-and-forget `boss.send` now has `.catch(console.warn)` to contain enqueue failures.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | createQueue for all three queues before schedule (CR-01) | 7a6749a | apps/worker/src/main.ts |
| 2 (RED) | Failing test for contained boss.send rejection (WR-02) | 18a7fb1 | apps/worker/src/handlers/fetch-cboe-chain.test.ts |
| 2 (GREEN) | Contain boss.send rejection with .catch (WR-02) | 820158d | apps/worker/src/handlers/fetch-cboe-chain.ts |

## What Was Built

### CR-01: pg-boss createQueue before schedule (apps/worker/src/main.ts)

pg-boss v12 enforces a foreign-key constraint: the `schedule` and `work` tables
reference the `queue` table. On a fresh database, calling `boss.schedule()` or
`boss.work()` without a prior `boss.createQueue()` throws `Queue <name> not found`
and the Railway worker enters a crash-restart loop.

Fix: three `await boss.createQueue(name)` calls inserted between `boss.start()` and
the first `boss.schedule()`. Placement in source (lines 108-110 before line 115):

```
await boss.start();
// ... db/repos/adapters/use-cases/handlers wiring ...
await boss.createQueue("fetch-cboe-chain");  // idempotent
await boss.createQueue("fetch-rates");        // idempotent
await boss.createQueue("compute-bsm-greeks"); // idempotent
await boss.schedule("fetch-cboe-chain", ...);
```

All three queue names match exactly the names passed to schedule/work and the chain
handler's boss.send target. No fourth queue created (D-08). Boot log updated to note
"3 queues created, 3 jobs scheduled".

### WR-02: Contained boss.send rejection (apps/worker/src/handlers/fetch-cboe-chain.ts)

The success path in `makeFetchCboeChainHandler` enqueues `compute-bsm-greeks` via
`void deps.boss.send(...)` (fire-and-forget, per D-07: failure must not fail the
chain job). Without a `.catch`, a rejected send (queue missing, transient DB error)
becomes an unhandled rejection — a process risk and a silently lost D-07 trigger.

Fix: chain `.catch((e: unknown) => { console.warn("fetch-cboe-chain: failed to enqueue compute-bsm-greeks", e); })` onto the send call. The `void` keyword is retained
(explicit fire-and-forget intent). The catch variable is typed `unknown` per
`useUnknownInCatchVariables`. Only `console.warn` is used (per typescript.md gate-console rule).

### TDD Gate Compliance

RED commit: `18a7fb1` — `test(02-09): add failing test for contained boss.send rejection (WR-02 RED)`
GREEN commit: `820158d` — `fix(02-09): contain boss.send rejection with .catch on chain enqueue (WR-02)`

RED output showed: `expected "warn" to be called with arguments: [ StringContaining{...}, Any<Error> ] — Number of calls: 0`

GREEN output: 5 passed (5 tests), all green.

Note: Tests run from the worktree directory (`bunx vitest run` from
`.claude/worktrees/agent-aebebe1f45ba3e366/`) because the vitest workspace is
configured per the main repo's directory structure and resolves test files via the
worker's `vitest.config.ts`. The worktree isolates file changes correctly.

## Test Results (GREEN)

```
Tests  5 passed (5)
  ✓ when outside RTH: use-case NOT called and console.warn was called
  ✓ when inside RTH + use-case ok: use-case called once and boss.send invoked with singletonKey
  ✓ when inside RTH + use-case err: handler throws (pg-boss marks job failed)
  ✓ when inside RTH + use-case ok + boss.send rejects: handler resolves and console.warn is called for failed enqueue (WR-02)
  ✓ array guard: undefined job returns immediately without calling use-case
```

## Deviations from Plan

None — plan executed exactly as written.

Note: `bun run typecheck` reports pre-existing `Cannot find module 'pg-boss'`
and related errors across the workspace — these exist because `node_modules` is not
installed in the worktree (packages are installed only in the main repo tree). These
errors are pre-existing and not caused by this plan's changes; the type shape of
`boss.createQueue` is verified by the pg-boss v12 API documented in 02-REVIEW.md.

## Deferred Manual Verification

Per plan verification section and VERIFICATION.md "Human Verification Required" #1:
deploy the worker to Railway against a fresh database; confirm the process boots
without "Queue <name> not found", and after an RTH slot, `curl /api/status` shows
`fetch-cboe-chain.lastSuccessAt` populated and `leg_observations` gains
`source='cboe'` rows. This is deferred to `/gsd-verify-work`.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. The
`createQueue` calls are idempotent DML against the pg-boss-managed schema (already
owned by pg-boss since `boss.start()`). T-02-24 and T-02-25 are now mitigated per
the threat register in the plan.

## Known Stubs

None.

## Self-Check: PASSED

- apps/worker/src/main.ts: contains 3 boss.createQueue calls before first boss.schedule
- apps/worker/src/handlers/fetch-cboe-chain.ts: contains .catch on boss.send
- apps/worker/src/handlers/fetch-cboe-chain.test.ts: 5 tests including WR-02 containment test
- Commits verified: 7a6749a, 18a7fb1, 820158d
