---
status: testing
phase: 17-overview-v2-redesign-iv-calibration-fix
source: [17-VERIFICATION.md]
started: 2026-07-03T23:18:42Z
updated: 2026-07-03T23:18:42Z
---

## Current Test

number: 1
name: Overview TOS-dock layout fidelity vs mockup
expected: |
  Deploy/preview Overview and compare to mockups/overview-v2.html. Pill header
  (SPX · netγ+regime · flip · VIX · VVIX · DFF · 10y2y · COT · book P&L), full-width
  payoff hero + breakevens + T+0/@exp scenario strip, positions table docked below the
  graph, 320px GEX rail on the right (gamma profile, GEX bars, key levels, net book
  greeks), macro + book rows below. The dedicated Market screen still renders full-size
  via its own nav tab (no regression).
awaiting: user response

## Tests

### 1. Overview TOS-dock layout fidelity vs mockup
expected: |
  Pill header, full-width payoff hero + breakevens + T+0/@exp scenario strip, positions
  table docked below, 320px GEX rail on the right, macro + book rows below. Market screen
  unaffected.
result: [pending]

### 2. Live calibration + staleness behavior (during and outside RTH)
expected: |
  The payoff T+0 curve visibly moves with live marks (not frozen at a flat 18% guess);
  a non-convergent/illiquid leg shows "IV n/a" and the net-book "T+0 excludes N" note;
  the live-mark badge tints amber past 5 min and the GEX badge tints amber past its
  refresh window; hovering/selecting a positions row spotlights that position's curve and
  dims the rest; the scenario strip @exp header shows the front expiry date. (CR-01 fix:
  an "IV n/a" calendar is now excluded from BOTH the T+0 and @exp curves — it must NOT
  draw a wrong @exp tent.)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
