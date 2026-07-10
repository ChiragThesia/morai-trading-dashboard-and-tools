---
status: passed
phase: 30-analyzer-pasted-calendar-fix
source: [30-VERIFICATION.md]
started: 2026-07-10T16:00:00Z
updated: 2026-07-10T16:05:00Z
---

## Current Test

number: —
name: All tests resolved
expected: —
awaiting: —

## Tests

### 1. Live 7500P repro — tent fits
expected: Pasted 7500P calendar renders the full tent (both tails + both BEs) with no clipping.
result: PASSED 2026-07-10 ~16:02Z (agent-driven on morai.wtf, new deploy). Pasted "BUY +1 CALENDAR SPX 100 20 NOV 26/16 OCT 26 7500 PUT @47.05 LMT" (user's exact repro shape: 7500P, debit $4705). Chart domain auto-expanded to ~7100–8050; BE@exp 7095 and 8026 both rendered inside the chart with the full tent visible, apex centered. Screenshot captured in session.
result_detail: agent-verified live

### 2. Live scored-paste UI
expected: Factor bars, θ GATE chip, WHY THIS CALENDAR, ENTRY/EXIT PLAN all render for a pasted PUT calendar; "Pasted calendar — not engine-scored." placeholder gone.
result: PASSED 2026-07-10. Pasted card shows PASTED pill + real score 65, factor bars (slope 0.0v rendered honestly for the flat-IV paste, fwd edge 0.0v, GEX fit 100%), scorecard θ GATE ✓ +26.3/d, WHY panel with real analysis ("strike pinned at the 45d put wall 7500 ✓", event-premium penalty), full ENTRY/EXIT plan (target +$1176, stop −$823, manage Sep 22, hard close Oct 13 pre-event, sizing VIX 16.9 → Normal → 2). No placeholder note anywhere.
result_detail: agent-verified live

### 3. Rule-override parity for pasted scoring
expected: An active Phase-29 override affects a pasted calendar's score the same as engine candidates.
result: PASSED by mechanism 2026-07-10. The ad-hoc use-case resolves overrides through the same readRuleOverrides port + resolvePickerRuleConfig proven live end-to-end in Phase 29's UAT (14:30:46Z snapshot stamped an overridden weight); analyzeAdHocCalendar.test.ts covers override application; byte-parity fast-check ties ad-hoc scoring to scoreCalendarCandidates. No live override was active during this UAT (deliberately reset at Phase 29 close) — running one solely for this check would re-perturb live picking for zero additional signal.
result_detail: mechanism-verified (live wire proven in Phase 29 UAT)

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
