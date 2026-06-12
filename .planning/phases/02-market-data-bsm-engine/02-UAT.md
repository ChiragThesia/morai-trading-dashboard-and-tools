---
status: complete
phase: 02-market-data-bsm-engine
source: [02-VERIFICATION.md]
started: 2026-06-11T19:15:26Z
updated: 2026-06-12T16:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Worker boots on fresh database and runs scheduled jobs end-to-end
expected: Railway worker deploy starts clean (no "Queue <name> not found" crash-loop); three pg-boss queues exist; during an RTH slot the chain fetch → compute pipeline writes real greeks to leg_observations; /status shows lastJobRuns populated for fetch-cboe-chain, fetch-rates, compute-bsm-greeks.
result: pass
reported: "Three live rounds 2026-06-12. Round 1 found param-limit insert failure + status 500 (gaps A/B). Round 2 after fixes: pipeline flowed (12,092 rows/slot, greeks computed, status 200) but exposed +4h timestamp shift (gap C). Round 3 after UTC fix + data correction: 36,136 rows across 3 slots, 0 future-dated, 23,413 greeks against corrected T, 691 NaN-stamped (~1.9% genuine unsolvables), /api/status 200 with all three lastSuccessAt populated, no errors."
severity: resolved

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "During an RTH slot the chain fetch persists observations to leg_observations and compute writes real greeks"
  status: resolved
  resolution: "Plan 02-10 (chunked inserts ≤2,000 rows). Verified live 2026-06-12 15:00 UTC slot: 12,092 rows persisted, 12,092 contracts, compute wrote 2,979 greeks (287 NaN-stamped unsolvables). Deploy f57dcaa."
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
  status: resolved
  resolution: "Plan 02-11 (extractCompletedOn string branch → new Date(v).toISOString() with Invalid Date guard). Verified live: /api/status 200 within 3 min of deploy f57dcaa, lastJobRuns rendering ISO-Z timestamps + lastError text."
  reason: "GET /api/status returns 500. Server logs: ZodError invalid_format 'Invalid ISO datetime' at lastJobRuns.fetch-cboe-chain.lastErrorAt and lastJobRuns.fetch-rates.lastSuccessAt — contracts schema requires Z-anchored ISO; job-runs repo returns Postgres text timestamps ('2026-06-12 13:31:38.031+00')."
  severity: blocker
  test: 1
  artifacts:
    - "packages/adapters/src/postgres/repos/job-runs.ts (DISTINCT ON raw query returns timestamptz as Postgres text format)"
    - "packages/contracts/src/status.ts (jobRunRecord z.iso.datetime() Z-anchored pattern)"
  missing:
    - "Convert job-runs timestamps to ISO-8601 Z format (new Date(v).toISOString()) before returning from the repo, or parse via timestamp mode in the query layer."
    - "Contract test gap: testcontainer DB has no pgboss schema so readJobRuns always returned ok({}) in tests — the real-timestamp path was never validated. Add a contract test that creates a minimal pgboss.job fixture (schema + table + one row) and asserts the returned record parses against the contracts jobRunRecord schema."

- truth: "Stored observation times reflect actual quote time (UTC) so journal/DTE math is correct"
  status: resolved
  resolution: "Plan 02-12 (UTC parse, ET machinery deleted) + orchestrator data correction (12,092 future-dated rows shifted −4h, greeks reset, WHERE time > now() predicate avoided touching new-code rows). Verified live 16:12 UTC: 36,136 rows, 0 future-dated, max_time 15:59:59Z; 23,413 greeks recomputed against corrected T; deep-ITM puts (Δ −0.92) now carry finite IV — European-bound fix proven on real data; /api/status all three jobs lastSuccessAt, no errors."
  reason: "Live round 2 (2026-06-12): max(time) in leg_observations = 19:00:18Z while wall clock was 15:08 UTC — rows future-dated by exactly +4h (EDT offset). Direct CDN check: payload timestamp '2026-06-12 15:09:24' at 15:10 UTC → CBOE timestamp is UTC, not ET-local. Phase 2 RESEARCH Pitfall-1 was wrong; etToUtc() in cboe.ts double-shifts."
  severity: major
  test: 1
  artifacts:
    - "packages/adapters/src/http/cboe.ts (etToUtc + isDstInET — entire ET conversion built on wrong premise)"
    - "Live CDN evidence: payload timestamp ≈ wall-clock UTC (60s skew), not ET"
  missing:
    - "Parse CBOE timestamp as UTC: new Date(timestamp.replace(' ', 'T') + 'Z'); delete etToUtc/isDstInET/nthSunday machinery."
    - "Update adapter tests + fixture expectations to UTC interpretation."
    - "One-time prod data correction (user-approved): UPDATE leg_observations SET time = time - interval '4 hours'; then reset bsm_* columns to NULL (and bsm_iv NaN stamps) so compute re-derives greeks against corrected T."

## Observations (non-blocking)

- FRED_API_KEY is not set on the Railway worker service — fetch-rates stored the 4.5% fallback instead of live DGS3MO. Works as designed (T-02-12), but set the key for real rates. User action: Railway dashboard → worker → Variables.
- compute-bsm-greeks ran once (2026-06-11T20:00Z) and completed with nothing to do (no pending observations — expected given the insert failure upstream).
