---
phase: 02-market-data-bsm-engine
plan: "07"
subsystem: scheduling-and-visibility
tags: [pg-boss, scheduling, rth-gate, job-runs, status, worker, tdd, wave-5]
dependency_graph:
  requires:
    - 02-04 (makeFetchChainUseCase — wired as scheduled job handler)
    - 02-05 (makeFetchRateUseCase — wired as scheduled job handler)
    - 02-06 (makeComputeBsmGreeksUseCase — wired as scheduled job handler)
  provides:
    - isWithinRth (packages/core/src/journal/domain/rth-window.ts)
    - ForReadingJobRuns + JobRunMap + JobRunRecord (ports.ts)
    - makeGetStatusUseCase extended with readJobRuns dep
    - jobRunRecord Zod schema + lastJobRuns union (contracts/status.ts)
    - makePostgresJobRunsRepo (packages/adapters)
    - Three pg-boss job handlers (apps/worker/src/handlers/)
    - Worker composition root with pg-boss boot + schedule + work
  affects:
    - GET /api/status and MCP get_status now return populated lastJobRuns after first job runs
tech_stack:
  added: []
  patterns:
    - IANA-zone RTH gate: Intl.DateTimeFormat timeZone:'America/New_York' + formatToParts weekday/hour/minute
    - pg-boss v12 array handler signature ([job]): void; undefined guard for Pitfall 2
    - pgboss.job DISTINCT ON (name) raw SQL read; catch schema-absent error to ok({}) (Pitfall 6)
    - singletonKey 'triggered-by-chain' prevents duplicate compute-bsm-greeks enqueues (D-07)
    - lastJobRuns union: "none yet" (empty/error) | JobRunMap (populated) — falls back gracefully
    - BossForChainHandler exported type — avoids as-casts in test doubles
key_files:
  created:
    - packages/core/src/journal/domain/rth-window.ts
    - packages/core/src/journal/domain/rth-window.test.ts
    - packages/adapters/src/postgres/repos/job-runs.ts
    - packages/adapters/src/postgres/repos/job-runs.contract.test.ts
    - apps/worker/src/handlers/fetch-cboe-chain.ts
    - apps/worker/src/handlers/fetch-cboe-chain.test.ts
    - apps/worker/src/handlers/fetch-rates.ts
    - apps/worker/src/handlers/compute-bsm-greeks.ts
  modified:
    - packages/core/src/journal/application/ports.ts (JobRunRecord, JobRunMap, ForReadingJobRuns)
    - packages/core/src/journal/application/getStatus.ts (readJobRuns dep; lastJobRuns union type)
    - packages/core/src/journal/application/getStatus.test.ts (empty/err/populated readJobRuns cases)
    - packages/core/src/journal/index.ts (isWithinRth, ForRunningFetchChain, FetchChainDeps, new job-run types)
    - packages/core/src/index.ts (same re-exports)
    - packages/contracts/src/status.ts (jobRunRecord Zod object; lastJobRuns union)
    - packages/contracts/src/status.test.ts (populated record + invalid datetime tests)
    - packages/adapters/src/index.ts (makePostgresJobRunsRepo export)
    - apps/server/src/adapters/http/status.routes.test.ts (populated lastJobRuns round-trip)
    - apps/server/src/adapters/mcp/mcp.test.ts (populated lastJobRuns MCP-02 round-trip)
    - apps/server/src/main.ts (inject makePostgresJobRunsRepo into makeGetStatusUseCase)
    - apps/worker/src/config.ts (DATABASE_POOL_URL, FRED_API_KEY, BSM_MAX_DTE, BSM_STRIKE_BAND_PCT, BSM_DIVIDEND_YIELD, BSM_RATE_FALLBACK)
    - apps/worker/src/main.ts (pg-boss boot + 3 schedule + 3 work; full use-case wiring)
decisions:
  - "IANA zone America/New_York via Intl.DateTimeFormat — not fixed-offset arithmetic; handles EST/EDT transitions correctly"
  - "BossForChainHandler exported type — test stubs satisfy it directly; no as-casts in test code"
  - "pgboss.job schema-absent catch: messages containing pgboss/does not exist/no such table return ok({}) (Pitfall 6)"
  - "PgBoss named import (not default) — pg-boss v12 TypeScript module has no default export"
  - "bun install required on worktree startup — node_modules not pre-populated from bun.lock symlinks"
  - "ForRunningFetchChain and FetchChainDeps exported from @morai/core — enables handler to import use-case type"
metrics:
  duration_seconds: 1127
  completed_at: "2026-06-11T16:42:47Z"
  tasks_completed: 2
  files_created: 8
  files_modified: 11
---

# Phase 02 Plan 07: Scheduling and Visibility Summary

**One-liner:** Three pg-boss jobs (fetch-cboe-chain every 30 min ET, fetch-rates daily 09:00 ET, compute-bsm-greeks hourly 10-16 ET) wired with double-layered RTH gating and chain→compute singletonKey enqueue; `lastJobRuns` end-to-end from pgboss.job through contracts → core → HTTP + MCP — graceful "none yet" on first deploy.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | RTH window util + job-runs repo + lastJobRuns end-to-end (D-06, D-10, MCP-02) | 5a53801 | rth-window.ts, ports.ts, getStatus.ts, status.ts, job-runs.ts, server/main.ts |
| 2 | Worker config tunables + three thin handlers + pg-boss scheduling (D-06, D-07, D-08, D-13) | 5743d1e | config.ts, handlers/*, worker/main.ts |

## Scheduled Jobs

| Job Name | Cron (ET) | Trigger | Handler RTH Gate |
|---|---|---|---|
| `fetch-cboe-chain` | `*/30 * * * 1-5` | Schedule + boot | Yes — no-op + warn outside RTH |
| `fetch-rates` | `0 9 * * 1-5` | Schedule + boot | No — daily rate, valid all day |
| `compute-bsm-greeks` | `0 10-16 * * 1-5` | Schedule + chain enqueue | No — sparse fallback only |

All three scheduled with `tz: 'America/New_York'` (D-06).

## lastJobRuns Wire Shape

### Contract (packages/contracts/src/status.ts)

```typescript
const jobRunRecord = z.object({
  lastSuccessAt: z.string().datetime().nullable(),
  lastErrorAt:   z.string().datetime().nullable(),
  lastError:     z.string().nullable(),
});

lastJobRuns: z.union([
  z.literal("none yet"),
  z.record(z.string(), jobRunRecord),
])
```

### Core type (packages/core/src/journal/application/ports.ts)

```typescript
type JobRunMap = Readonly<Record<string, {
  lastSuccessAt: string | null;
  lastErrorAt:   string | null;
  lastError:     string | null;
}>>;
type ForReadingJobRuns = () => Promise<Result<JobRunMap, StorageError>>;
```

### Fallback behavior

- Empty map returned by `makePostgresJobRunsRepo` → `"none yet"` in `StatusPayload`
- Error from `readJobRuns()` → `"none yet"` (Pitfall 6: pgboss schema absent on first deploy)
- Populated map (at least one tracked job has run) → `JobRunMap`

## chain→compute Enqueue (D-07)

On successful `fetch-cboe-chain` run, the handler calls:

```typescript
boss.send("compute-bsm-greeks", {}, { singletonKey: "triggered-by-chain" });
```

The `singletonKey` ensures only one compute job is enqueued per chain fetch — if a prior compute is still queued, this send is a no-op.

## RTH Gate (D-06)

`isWithinRth(now: Date): boolean` uses `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` to extract local weekday/hour/minute. This handles EST/EDT transitions correctly without fixed-offset arithmetic.

DST validation (from test):
- `2026-07-15T13:30:00Z` (Wednesday 09:30 EDT) → `true`
- `2026-01-14T13:30:00Z` (Wednesday 08:30 EST) → `false`
- `2026-01-14T14:30:00Z` (Wednesday 09:30 EST) → `true`

## Production Verification (deferred to /gsd-verify-work)

After deployment to Railway, verify:
1. After an RTH 30-min slot: `curl /api/status` shows `fetch-cboe-chain.lastSuccessAt` populated
2. `SELECT count(*) FROM leg_observations WHERE source='cboe'` > 0
3. After compute runs: `SELECT count(*) FROM leg_observations WHERE bsm_iv IS NOT NULL` > 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] bun install required on worktree startup**
- **Found during:** Task 1 GREEN — `@morai/contracts` tests failed with "Cannot find package 'zod'"
- **Issue:** The git worktree was created without running `bun install`; node_modules were not populated from bun.lock symlinks.
- **Fix:** Ran `bun install` in the worktree root (920 packages, 5.27s).
- **Files modified:** node_modules populated
- **Commit:** 5a53801 (part of Task 1)

**2. [Rule 1 - Bug] PgBoss requires named import, not default**
- **Found during:** Task 2 typecheck
- **Issue:** `import PgBoss from 'pg-boss'` fails — pg-boss v12 TypeScript types have no default export; must use `import { PgBoss } from 'pg-boss'`.
- **Fix:** Changed to named import.
- **Files modified:** `apps/worker/src/main.ts`
- **Commit:** 5743d1e

**3. [Rule 2 - Missing] Exported BossForChainHandler type to avoid as-casts in tests**
- **Found during:** Task 2 typecheck + lint — test was using `as unknown as` for the boss stub
- **Issue:** Violated `consistent-type-assertions: never`.
- **Fix:** Exported `BossForChainHandler` from `fetch-cboe-chain.ts`; test uses it directly.
- **Files modified:** `apps/worker/src/handlers/fetch-cboe-chain.ts`, `apps/worker/src/handlers/fetch-cboe-chain.test.ts`
- **Commit:** 5743d1e

**4. [Rule 1 - Bug] ForRunningFetchChain needed at @morai/core public surface**
- **Found during:** Task 2 typecheck — handler imports `ForRunningFetchChain` from `@morai/core` but it was not exported
- **Issue:** `makeFetchChainUseCase` returns `ForRunningFetchChain` but only the factory was re-exported, not its return type.
- **Fix:** Added `ForRunningFetchChain` and `FetchChainDeps` to `core/journal/index.ts` and `core/index.ts` re-exports.
- **Files modified:** `packages/core/src/journal/index.ts`, `packages/core/src/index.ts`
- **Commit:** 5743d1e

## Known Stubs

None. All three use-cases are wired with real adapters in the composition root. No placeholder data.

## Threat Surface Scan

All threats from the plan's threat model are implemented:

- **T-02-18** (malformed job payload): array-guard `if (job === undefined) return` in all three handlers.
- **T-02-19** (pgboss.job SELECT only): `makePostgresJobRunsRepo` issues SELECT DISTINCT ON only; no INSERT/UPDATE/DELETE on pgboss schema.
- **T-02-20** (raw error/stack in status output): `lastError` carries the pg-boss output `message` field only; no stack traces in HTTP/MCP responses.
- **T-02-21** (secrets in worker logs): `bootWorkerConfig` logs field names only on failure; `FRED_API_KEY` never appears in any log path.
- **T-02-SC** (pg-boss runtime use): pg-boss v12.18.3 legitimacy-checked in Plan 01; unchanged.

No new network endpoints, auth paths, or schema changes beyond what the plan defined.

## Verification Results

```
bunx vitest run
→ 29 test files, 212 tests all pass
  (includes job-runs.contract.test.ts: skips gracefully without Docker dbUrl)
  (includes fetch-cboe-chain.test.ts: 4 handler tests with in-memory stubs)

bun run typecheck
→ tsc --build --force (clean, no errors)

bun run lint
→ clean (0 errors, 0 warnings)
```

## Self-Check: PASSED

Files created:
- packages/core/src/journal/domain/rth-window.ts: FOUND
- packages/core/src/journal/domain/rth-window.test.ts: FOUND
- packages/adapters/src/postgres/repos/job-runs.ts: FOUND
- packages/adapters/src/postgres/repos/job-runs.contract.test.ts: FOUND
- apps/worker/src/handlers/fetch-cboe-chain.ts: FOUND
- apps/worker/src/handlers/fetch-cboe-chain.test.ts: FOUND
- apps/worker/src/handlers/fetch-rates.ts: FOUND
- apps/worker/src/handlers/compute-bsm-greeks.ts: FOUND

Commits:
- 5a53801 (Task 1): FOUND
- 5743d1e (Task 2): FOUND
