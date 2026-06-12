---
status: diagnosed
phase: 02-market-data-bsm-engine
source: [02-VERIFICATION.md]
started: 2026-06-11T19:15:26Z
updated: 2026-06-12T13:55:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Worker boots on fresh database and runs scheduled jobs end-to-end
expected: Railway worker deploy starts clean (no "Queue <name> not found" crash-loop); three pg-boss queues exist; during an RTH slot the chain fetch → compute pipeline writes real greeks to leg_observations; /status shows lastJobRuns populated for fetch-cboe-chain, fetch-rates, compute-bsm-greeks.
result: issue
reported: "Claude tested live during 2026-06-12 RTH (user-directed). PARTIAL: worker boots clean — pgboss.queue has all three queues (CR-01 fix verified in prod); RTH gating works (pre-RTH jobs complete as no-ops); fetch-rates wrote 2026-06-12 rate=0.045 (fallback — FRED_API_KEY unset in Railway). FAILED: leg_observations has 0 rows ever — fetch-cboe-chain insert dies at production scale; /api/status returns 500."
severity: blocker

## Summary

total: 1
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "During an RTH slot the chain fetch persists observations to leg_observations and compute writes real greeks"
  status: failed
  reason: "fetch-cboe-chain job failed at 2026-06-12T13:31:38Z (first real RTH slot). Drizzle insert error captured in pgboss.job.output."
  severity: blocker
  test: 1
  artifacts:
    - "packages/adapters/src/postgres/repos/leg-observations.ts (persistObservations — single db.insert().values(allRows) batch)"
    - "pgboss.job output: failed insert query with max parameter index $175784"
  missing:
    - "Chunked batch insert in persistObservations: 175,784 bind parameters in one INSERT (≈12,556 rows × 14 cols) exceeds Postgres's 65,534-parameter protocol limit. Split into chunks (e.g. 2,000 rows = 28,000 params per INSERT) inside one transaction or sequential awaits; onConflictDoNothing semantics preserved per chunk. Same audit needed for upsertContracts batch."
    - "Regression test with a row count large enough to exceed one chunk boundary (e.g. 3,000 synthetic rows) against testcontainers Postgres."

- truth: "/api/status responds 200 with lastJobRuns populated for all three jobs"
  status: failed
  reason: "GET /api/status returns 500. Server logs: ZodError invalid_format 'Invalid ISO datetime' at lastJobRuns.fetch-cboe-chain.lastErrorAt and lastJobRuns.fetch-rates.lastSuccessAt — contracts schema requires Z-anchored ISO; job-runs repo returns Postgres text timestamps ('2026-06-12 13:31:38.031+00')."
  severity: blocker
  test: 1
  artifacts:
    - "packages/adapters/src/postgres/repos/job-runs.ts (DISTINCT ON raw query returns timestamptz as Postgres text format)"
    - "packages/contracts/src/status.ts (jobRunRecord z.iso.datetime() Z-anchored pattern)"
  missing:
    - "Convert job-runs timestamps to ISO-8601 Z format (new Date(v).toISOString()) before returning from the repo, or parse via timestamp mode in the query layer."
    - "Contract test gap: testcontainer DB has no pgboss schema so readJobRuns always returned ok({}) in tests — the real-timestamp path was never validated. Add a contract test that creates a minimal pgboss.job fixture (schema + table + one row) and asserts the returned record parses against the contracts jobRunRecord schema."

## Observations (non-blocking)

- FRED_API_KEY is not set on the Railway worker service — fetch-rates stored the 4.5% fallback instead of live DGS3MO. Works as designed (T-02-12), but set the key for real rates. User action: Railway dashboard → worker → Variables.
- compute-bsm-greeks ran once (2026-06-11T20:00Z) and completed with nothing to do (no pending observations — expected given the insert failure upstream).
