---
phase: 02-market-data-bsm-engine
plan: 12
subsystem: adapters
tags: [cboe, timestamp, utc, tdd, fetch-adapter, observedAt]

requires:
  - phase: 02-market-data-bsm-engine
    provides: "cboe.ts fetch adapter with etToUtc() ET-conversion machinery (Plans 01-11)"

provides:
  - "UTC timestamp parsing in cboe.ts: new Date(ts.replace(' ', 'T') + 'Z')"
  - "Invalid-Date guard returning fetch-error Result (no propagation of NaN dates)"
  - "ET conversion machinery fully deleted: etToUtc, isDstInET, nthSunday gone"
  - "Regression tests: UTC interpretation + malformed-timestamp guard (9 tests green)"
  - "Post-deploy data-correction runbook documented (Task 3, pending orchestrator execution)"

affects:
  - "compute-bsm-greeks worker (T in greeks now derives from correct UTC time)"
  - "leg_observations table (existing rows need post-deploy -4h correction per runbook)"

tech-stack:
  added: []
  patterns:
    - "UTC-parse pattern: new Date(str.replace(' ', 'T') + 'Z') with Number.isNaN(getTime()) guard"
    - "Malformed external data returns fetch-error Result — never propagates Invalid Date"

key-files:
  created: []
  modified:
    - packages/adapters/src/http/cboe.ts
    - packages/adapters/src/http/cboe.test.ts

key-decisions:
  - "Parse CBOE timestamp as UTC directly: production evidence (2026-06-12) overrides RESEARCH Pitfall-1 — timestamp is already UTC, not ET-local"
  - "Delete etToUtc/isDstInET/nthSunday in full — no dead code, no commented-out remnants"
  - "RESEARCH.md and 02-PATTERNS.md left unchanged — Pitfall-1 entries stay as historical record"
  - "Task 3 data-correction runbook kept as orchestrator-executed checkpoint — executor performs no DB mutation"

patterns-established:
  - "UTC-first timestamp parsing: external string timestamps assumed UTC unless documented otherwise"

requirements-completed: [DATA-04]

duration: 15min
completed: 2026-06-12
---

# Phase 02 Plan 12: UAT Gap C — CBOE Timestamp UTC Fix Summary

**UTC timestamp parsing for CBOE delayed-quotes: etToUtc/isDstInET/nthSunday deleted, direct `new Date(ts.replace(' ', 'T') + 'Z')` parse with Invalid-Date guard, 9 tests green**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-12T10:20:00Z
- **Completed:** 2026-06-12T10:35:00Z
- **Tasks:** 2/3 (Task 3 is orchestrator runbook — not executor-executed)
- **Files modified:** 2

## Accomplishments

- Flipped observedAt test from ET-offset premise (UTC+4h = 19:13:25Z) to UTC-direct premise (15:13:25Z); confirmed RED against current etToUtc code before fixing
- Replaced entire ET conversion machinery (etToUtc/isDstInET/nthSunday + all associated comments) with a single direct UTC parse: `new Date(payload.timestamp.replace(" ", "T") + "Z")`
- Added Number.isNaN(getTime()) guard: malformed timestamps return `{ kind: "fetch-error", message: "..." }` Result — never an Invalid Date flowing into RawChain.observedAt
- Updated CboeResponseSchema timestamp comment and call-site comment to state UTC (not ET-local)
- All 9 cboe.test.ts tests pass (GREEN); typecheck and lint clean for packages/adapters

## Task Commits

Each task committed atomically (per CLAUDE.md: commits at green only):

1. **Task 1 (RED) + Task 2 (GREEN)** — `c8de7a9` (fix: parse CBOE timestamp as UTC, delete ET machinery)

   Tasks 1 and 2 committed together in a single GREEN commit per the repo's "commit at green only" policy. The RED run was executed and verified (failing assertion shown) before cboe.ts was modified.

**Plan metadata:** committed below

_Note: Task 3 (production data-correction runbook) is a checkpoint:human-action — the executor performed no DB action. See "Task 3 Pending" section below._

## Files Created/Modified

- `packages/adapters/src/http/cboe.ts` — deleted etToUtc/isDstInET/nthSunday + Pitfall-1 comment block (61 lines removed); replaced `etToUtc(payload.timestamp)` with direct UTC parse + Invalid-Date guard; updated schema comment and call-site comment
- `packages/adapters/src/http/cboe.test.ts` — renamed + flipped observedAt test to assert 15:13:25Z (UTC); added malformed-timestamp guard test (fetch-error Result, no throw)

## RED Run Evidence

Before cboe.ts was modified, the flipped tests failed with the correct assertion messages:

```
FAIL  parses observedAt as UTC (timestamp interpreted as UTC, no offset)
AssertionError: expected '2026-06-11T19:13:25.000Z' to be '2026-06-11T15:13:25.000Z'
  Expected: "2026-06-11T15:13:25.000Z"
  Received: "2026-06-11T19:13:25.000Z"

FAIL  returns err with kind=fetch-error when timestamp is unparseable
AssertionError: expected true to be false
  (etToUtc allowed "not-a-date" through as a Date, returning ok)
```

2 tests failed, 7 passed — exactly the right RED state.

## Decisions Made

- **Production evidence overrides research doc**: CBOE payload `timestamp` is UTC (verified live 2026-06-12: payload "2026-06-12 15:09:24" arrived at 15:10:06 UTC wall clock). Phase 2 RESEARCH "Pitfall 1" was wrong. RESEARCH.md and 02-PATTERNS.md left as historical record per plan spec.
- **Delete all ET machinery**: No dead code, no commented-out remnants. etToUtc/isDstInET/nthSunday deleted in full.
- **Invalid-Date guard shape**: Matches existing `{ kind: "fetch-error", message }` Result shape used throughout the adapter — no payload dumps (T-02-10 preserved).

## Task 3 Pending — Orchestrator Runbook

Task 3 is a `checkpoint:human-action` that the plan executor must NOT execute. It documents a post-deploy production data-correction to be run by the orchestrator/operator AFTER the corrected adapter is deployed to Railway.

**What Tasks 1-2 fix:** All FUTURE observations will stamp the correct UTC time. Existing rows in `leg_observations` are unaffected by the code change.

**What Task 3 corrects:** Every row written by the buggy adapter is future-dated by +4h (EDT offset). The runbook (documented in the plan, Task 3) corrects this in one transaction:

```sql
BEGIN;
UPDATE leg_observations SET time = time - interval '4 hours';
UPDATE leg_observations
   SET bsm_iv = NULL, bsm_delta = NULL, bsm_gamma = NULL,
       bsm_theta = NULL, bsm_vega = NULL;
COMMIT;
```

**Verification after**: `SELECT max(time) FROM leg_observations;` should be at/just-behind wall-clock UTC, not +4h ahead.

**Resume signal**: Type "corrected" once the UPDATEs have run and max(time) verifies, or "skip" to defer.

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 followed the TDD red→green flow. Task 3 correctly not executed (orchestrator runbook gate).

## Issues Encountered

- msw not present in the worktree's top-level node_modules on first run (`Cannot find package 'msw/node'`). Ran `bun install` in the worktree root to populate the local node_modules cache. msw was correctly declared in packages/adapters/package.json devDependencies and present in bun.lock — the install resolved the symlink chain and tests ran cleanly.

## Known Stubs

None — no stub patterns introduced.

## Threat Flags

None — no new security-relevant surface beyond what was in the plan's threat model.

## Next Phase Readiness

- Corrected cboe.ts is ready to deploy to Railway — observedAt will stamp UTC going forward
- Task 3 runbook must be executed by orchestrator post-deploy before BSM greek derivations are trustworthy for historical rows
- After data correction: greeks for all existing leg_observations will re-derive against correct T on next compute-bsm-greeks run

---
*Phase: 02-market-data-bsm-engine*
*Completed: 2026-06-12*
