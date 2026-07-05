---
status: testing
phase: 19-picker-engine-economic-events
source: [19-VERIFICATION.md]
started: 2026-07-05T00:45:52Z
updated: 2026-07-05T01:14:11Z
---

## Current Test

number: 2
name: Live worker chain-trigger confirmation
expected: |
  On live Postgres + pg-boss, a compute-gex-snapshot success enqueues compute-picker,
  which writes a picker_snapshot row (idempotent on same-cohort re-trigger — WR-01);
  getPicker returns the latest snapshot. Fires next RTH (Mon 2026-07-06).
awaiting: user response

## Tests

### 1. Manual visual UAT of the Analyzer picker rail
expected: Picker rail shows live candidates; loading/error/cold-start/zero-filtered/populated states correct; freshness dot + "as of · source" from real observedAt; context tags honest; no layout regression.
result: pass
source: chrome-devtools (morai.wtf live, authenticated session)
note: |
  Verified via chrome-devtools on live morai.wtf. 8 candidates (scores 31/28/26/24×4/23),
  top 7010P 2026-07-31/2026-08-21. Freshness dot amber + "as of 13:29 · cboe" (real observedAt,
  WR-03). Honest degraded tags "GEX unavailable"/"events unavailable" + GEX-fit/event-adj n/a.
  Scoring checklist: Forward-vol edge 83%, Breakeven-vs-EM 100%, Positive theta +6.4/d;
  REFUTED criteria absent + "WHAT WE DON'T SCORE" disclosure. Risk-profile/WHY/Entry-Exit/
  Term-structure all populate; no layout regression. Minor (non-blocking): WHY panel cites live
  GEX (+$26.2B) while cards tag GEX unavailable — dual GEX source, cosmetic follow-up.

### 2. Live worker chain-trigger confirmation
expected: On live Postgres + pg-boss, a compute-gex-snapshot success enqueues compute-picker, which writes a picker_snapshot row and is idempotent on same-cohort re-trigger (no PK-violation retry loop, WR-01 fix); getPicker returns the latest snapshot.
result: [pending]

### 3. FRED live-shape + FOMC-seed accuracy
expected: With FRED_API_KEY set, the FRED release/dates response parses to the assumed shape; CPI/NFP dates populate; FOMC seed dates are accurate; eventsContextStatus reflects the real fetch outcome; FOMC seed present even if FRED fails (WR-05 fix).
result: pass
source: railway run --service worker (live FRED key) + local run (no key)
note: |
  Live FRED fetch returned 1836 events = 1820 fred (CPI/NFP release/dates parse to assumed
  shape, source="fred") + 16 FOMC seed (source="seed"). economic_events populated. WR-05
  confirmed separately: with FRED key absent (local), the 16 FOMC seed still returned + persisted
  (never dropped). Note IN-02 (review): FRED history spans 1949→2026 unfiltered — picker reads
  are unbounded; cosmetic/perf follow-up, not blocking.

## Summary

total: 3
passed: 2
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
