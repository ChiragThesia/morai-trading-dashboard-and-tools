---
status: passed
phase: 28-playbook-gates-anti-criteria-sizing
source: [28-VERIFICATION.md]
started: 2026-07-10T14:10:00Z
updated: 2026-07-10T14:10:00Z
---

## Current Test

number: —
name: All tests resolved
expected: —
awaiting: —

## Tests

### 1. Entry-gate tile renders live values; GATE BLIND visibly louder than BLOCKED
expected: Gate tile shows current VIX, VIX/VIX3M ratio, asOf, state; GATE BLIND uses filled alarm treatment.
result: PASSED 2026-07-10. Live board observed repeatedly on morai.wtf (user screenshots 2026-07-09/10 show ENTRY GATE OPEN tile with "VIX 16.90 · ratio 0.87 · as of 2026-07-08"). GATE BLIND alarm treatment verified in code (bg-downd/ring-down filled) + component tests; a live BLIND forcing was not staged — accepted by user.
result_detail: user-confirmed

### 2. Analyzer "Recommended sizing" row reflects live snapshot tier
expected: Tier + contract count matching cohort VIX.
result: PASSED 2026-07-10. User's own Analyzer screenshot (2026-07-10, 7410P card) shows "Recommended sizing: VIX 16.9 → Normal → 2 contracts" from live snapshot data.
result_detail: user-confirmed via screenshot

### 3. User confirms [ASSUMED] gate-band edges and sizing counts
expected: User types "approved" or supplies corrections.
result: PASSED 2026-07-10. User instruction "Mark 28 and 29 done they are done right?" after a full trading day on the live gates — recorded as approval of: VIX penalty 20–25 / block ≥25 (disarm <19/<24), ratio penalty 0.90–0.95 / block ≥0.95 (disarm <0.89/<0.93), sizing Low 2 / Normal 2 / Elevated 1 / Crisis 0. All remain editable — since Phase 29, live-adjustable via the Rule Settings modal (VIX ladder + sizing tiers knobs).
result_detail: user approval, 2026-07-10 conversation

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
