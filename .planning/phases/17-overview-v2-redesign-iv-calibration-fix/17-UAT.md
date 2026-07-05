---
status: complete
phase: 17-overview-v2-redesign-iv-calibration-fix
source: [17-VERIFICATION.md]
started: 2026-07-03T23:18:42Z
updated: "2026-07-04T00:14:06Z"
---

## Current Test

[testing complete]

## Tests

### 1. Overview TOS-dock layout fidelity vs mockup

expected: |
  Pill header, full-width payoff hero + breakevens + T+0/@exp scenario strip, positions
  table docked below, 320px GEX rail on the right, macro + book rows below. Market screen
  unaffected.
result: pass
verified: |
  Deployed 205b495 → morai.wtf (Vercel READY), verified live via chrome-devtools.
  All TOS-dock elements present: 9-metric pill header, full-width payoff hero + breakevens
  (BE 7125/7729) + T+0/@exp(Jul 31) scenario strip at key levels, positions table docked
  below (5 rows, Net 5/5), 320px GEX rail (dealer Γ profile · GEX by strike · key levels ·
  net book greeks), CFTC COT + FRED macro + book/system rows below. Stale-GEX badge
  ("as of Jul 1 · 2d ago", amber) working.
notes: |
  Two non-blocking carve-outs (user accepted, Phase 17 closes as-is):
  (1) Mockup draws a 4th MARKET nav tab; live app has 3 tabs (Overview/Analyzer/Journal) —
      pre-existing Phase-12 5→3 structure, App.tsx never wired Market; NOT a Phase-17 regression.
  (2) Graph-fidelity + interactivity (TOS-style curve styling, future-date picker, per-calendar
      series selection) routed to Phase 18 as new feature scope — not a Phase-17 defect.

### 2. Live calibration + staleness behavior (during and outside RTH)

expected: |
  The payoff T+0 curve visibly moves with live marks (not frozen at a flat 18% guess);
  a non-convergent/illiquid leg shows "IV n/a" and the net-book "T+0 excludes N" note;
  the live-mark badge tints amber past 5 min and the GEX badge tints amber past its
  refresh window; hovering/selecting a positions row spotlights that position's curve and
  dims the rest; the scenario strip @exp header shows the front expiry date. (CR-01 fix:
  an "IV n/a" calendar is now excluded from BOTH the T+0 and @exp curves — it must NOT
  draw a wrong @exp tent.)
result: pass
verified: |
  Re-verified live via chrome-devtools on morai.wtf (2026-07-04). The OBSERVABLE surface of
  this test passed on the deployed Overview: (a) calibrated T+0 curve renders a real per-strike
  shape (−$1346→−$477 across 7200–7650, peaked near ATM), never a flat 18% guess; (b) the @exp
  scenario-strip header shows the front expiry "@ exp (Jul 31)"; (c) the GEX staleness badge
  reads "GEX as of Jul 1, 02:03 PM · 3d ago" with an amber dot and "mark as of —" (market
  closed); (d) hovering the 7400P positions row spotlit that position's curve — the @exp overlay
  reshaped to the 7400P calendar's individual tent (peak at 7400) and the combined profile
  dimmed. Interactive spotlight/dim, calibration, and staleness all confirmed working.
notes: |
  Residual live-only behaviors NOT observable at verification time (Sat 2026-07-04 + July-4
  holiday → market closed, mark "—"; all 5 open legs converged so no "IV n/a" leg exists):
  T+0 curve movement under live ticks, the "IV n/a" badge + "T+0 excludes N" note, and the
  5-min live-mark amber threshold crossing in real time. These are environmental blocks, not
  code defects — each is covered by static verification (17-VERIFICATION.md traced resolveLegIv
  into the hero path; CR-01 @exp-exclusion is covered by a regression test). Standing follow-up
  (already tracked): observe at the next RTH session. Not a Phase-17 blocker — the phase is
  live in prod and every verifiable behavior passes.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
