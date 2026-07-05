---
status: testing
phase: 19-picker-engine-economic-events
source: [19-VERIFICATION.md]
started: 2026-07-05T00:45:52Z
updated: 2026-07-05T00:45:52Z
---

## Current Test

number: 1
name: Manual visual UAT of the Analyzer picker rail
expected: |
  On the live Analyzer screen the picker rail renders LIVE scored candidates (not the
  fixture). Loading, error, cold-start, zero-filtered, and populated states each render
  correctly; the per-card freshness dot + "as of HH:MM · source" reflect the real snapshot
  instant (observedAt, WR-03 fix); GEX/events degraded-context tags show honestly. No layout
  regression vs the Phase 18 Analyzer.
awaiting: user response

## Tests

### 1. Manual visual UAT of the Analyzer picker rail
expected: Picker rail shows live candidates; loading/error/cold-start/zero-filtered/populated states correct; freshness dot + "as of · source" from real observedAt; context tags honest; no layout regression.
result: [pending]

### 2. Live worker chain-trigger confirmation
expected: On live Postgres + pg-boss, a compute-gex-snapshot success enqueues compute-picker, which writes a picker_snapshot row and is idempotent on same-cohort re-trigger (no PK-violation retry loop, WR-01 fix); getPicker returns the latest snapshot.
result: [pending]

### 3. FRED live-shape + FOMC-seed accuracy
expected: With FRED_API_KEY set, the FRED release/dates response parses to the assumed shape; CPI/NFP dates populate; FOMC seed dates are accurate; eventsContextStatus reflects the real fetch outcome; FOMC seed present even if FRED fails (WR-05 fix).
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
