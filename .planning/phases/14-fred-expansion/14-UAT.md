---
status: testing
phase: 14-fred-expansion
source: [14-VERIFICATION.md]
started: 2026-07-01T21:55:00Z
updated: 2026-07-01T21:55:00Z
---

## Current Test

number: 1
name: Prod FRED_API_KEY set and live macro population
expected: |
  FRED_API_KEY is set on the Railway worker service (and local .env for dev).
  After the next fetch-rates run (or manual trigger_job), macro_observations
  contains rows for all 7 FRED series (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y,
  T10Y3M, VIXCLS) plus VVIX (source=cboe). A second run for the same
  observation date is idempotent (no duplicates). MacroCard on prod Overview
  shows populated tiles; VVIX reads ~80-120 index level (not ~0.9 — that
  would be a /100 regression).
awaiting: user response

## Tests

### 1. Prod FRED_API_KEY set and live macro population
expected: FRED_API_KEY set on Railway worker + local .env (see 14-USER-SETUP.md). fetch-rates run populates macro_observations with 7 FRED series + VVIX; second run idempotent; prod MacroCard renders live values (VVIX ~80-120, DFF ~4-5%).
result: |
  Data layer VERIFIED 2026-07-02: FRED_API_KEY set on Railway worker; worker+server
  force-deployed (railway up — push deploys were SKIPPED, known gotcha). Manual
  fetch-rates run 1 completed → 8 rows (DFF 3.63, DGS1MO 3.70, DGS3MO 3.87,
  SOFR 3.68, T10Y2Y 0.31, T10Y3M 0.63, VIXCLS 16.45 all source=fred; VVIX 89.04
  source=cboe). Raw units confirmed (no /100). VVIX dated 07-01 ET while UTC was
  07-02 03:36 — WR-02 tz fix verified in prod. Run 2 completed → still 8 rows,
  0 duplicate (date,series_id) pairs — idempotent. REMAINING: user visual confirm
  of MacroCard on prod Overview. Local .env append still pending (permission-gated).

### 2. One-time prod pgboss schedule cleanup
expected: |
  Run once against prod DB after deploy:
  DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';
  Then verify: SELECT name, key, cron FROM pgboss.schedule WHERE name = 'fetch-rates';
  returns exactly two rows — key='morning' (09:00 ET) and key='evening' (18:30 ET).
result: |
  PASSED 2026-07-02 (user-approved). Stale keyless row deleted; verification query
  returned exactly two rows: (fetch-rates, morning, 0 9 * * 1-5, America/New_York)
  and (fetch-rates, evening, 30 18 * * 1-5, America/New_York) — registered by the
  newly deployed worker.

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
