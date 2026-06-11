---
status: testing
phase: 02-market-data-bsm-engine
source: [02-VERIFICATION.md]
started: 2026-06-11T19:15:26Z
updated: 2026-06-11T19:15:26Z
---

## Current Test

number: 1
name: Worker boots on fresh database and runs scheduled jobs end-to-end
expected: |
  Deploy the worker to Railway against the live Supabase database. Worker starts
  without crash-looping: pg-boss v12 creates its three queues (fetch-cboe-chain,
  fetch-rates, compute-bsm-greeks) at boot, schedules register, and during the next
  RTH window (09:30–16:00 ET) the fetch-cboe-chain job runs, persists observations
  to leg_observations, chains compute-bsm-greeks, and bsm_* columns receive finite
  (non-NaN) values for in-band contracts. /status endpoint reports lastJobRuns
  for all three jobs.
awaiting: user response

## Tests

### 1. Worker boots on fresh database and runs scheduled jobs end-to-end
expected: Railway worker deploy starts clean (no "Queue <name> not found" crash-loop); three pg-boss queues exist; during an RTH slot the chain fetch → compute pipeline writes real greeks to leg_observations; /status shows lastJobRuns populated for fetch-cboe-chain, fetch-rates, compute-bsm-greeks.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
