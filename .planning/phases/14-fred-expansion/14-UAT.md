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
result: [pending]

### 2. One-time prod pgboss schedule cleanup
expected: |
  Run once against prod DB after deploy:
  DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';
  Then verify: SELECT name, key, cron FROM pgboss.schedule WHERE name = 'fetch-rates';
  returns exactly two rows — key='morning' (09:00 ET) and key='evening' (18:30 ET).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
