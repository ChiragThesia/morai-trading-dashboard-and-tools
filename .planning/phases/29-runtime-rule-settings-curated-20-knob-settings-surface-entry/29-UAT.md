---
status: testing
phase: 29-runtime-rule-settings
source: [29-VERIFICATION.md]
started: 2026-07-10T09:05:00Z
updated: 2026-07-10T09:05:00Z
---

## Current Test

number: 1
name: Gear icon + settings modal visual layout
expected: |
  Gear icon renders top-right in the nav bar (same bar as Overview/Analyzer/Journal).
  Clicking opens the settings modal grouped Entry/Picker · Exit Advisor · Regime Bands.
  Overridden knobs show effective value with default alongside; reset-to-defaults per group;
  invalid edits (weight sum ≠ 100, misordered ladder, warn ≥ crisis, broken hysteresis pair)
  are rejected with a visible error.
awaiting: user response

## Tests

### 1. Gear icon + settings modal visual layout
expected: Gear top-right in Shell nav bar; modal groups Entry/Picker · Exit Advisor · Regime Bands; effective + default values visible when overridden; per-group reset; invalid edit shows rejection error.
result: [pending]

### 2. Mid-day override takes effect next compute-picker cycle
expected: Set an override via the modal (or PUT /api/settings/rules) during the trading day; the next 30-min compute-picker run uses it and the new picker snapshot's ruleSet metadata shows the EFFECTIVE (overridden) value.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
