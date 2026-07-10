---
status: passed
phase: 29-runtime-rule-settings
source: [29-VERIFICATION.md]
started: 2026-07-10T09:05:00Z
updated: 2026-07-10T09:05:00Z
---

## Current Test

number: —
name: All tests resolved
expected: —
awaiting: —

## Tests

### 1. Gear icon + settings modal visual layout
expected: Gear top-right in Shell nav bar; modal groups Entry/Picker · Exit Advisor · Regime Bands; effective + default values visible when overridden; per-group reset; invalid edit shows rejection error.
result: PASSED 2026-07-10 (agent-driven via chrome-devtools, local server+web against prod DB read-only). Evidence: gear button renders in banner right of JOURNAL tab; modal opens with 3 group headings (ENTRY/PICKER · EXIT ADVISOR · REGIME BANDS), all curated knobs at correct defaults (delta −0.49/−0.3, DTE 21/36/15/90, 9 weights summing 100, debit 3200/5000, ladder 15/20/25, maxOpen 6, sizing 2/2/1/0, TAKE/STOP arm+disarm pairs, regime 0.9/0.95 · 100/115 · 1.0/1.1 · 3/5); per-group Reset + Save buttons present. Validation: set Weights Slope 10→11, Save → PUT /api/settings/rules returned 400, UI showed "Couldn't save picker settings.", values refetched to server state, no row written. Default-vs-effective annotation not exercised (nothing overridden; no prod write during UAT) — covered by component tests.
result_detail: agent-verified

### 2. Mid-day override takes effect next compute-picker cycle
expected: Set an override via the modal (or PUT /api/settings/rules) during the trading day; the next 30-min compute-picker run uses it and the new picker snapshot's ruleSet metadata shows the EFFECTIVE (overridden) value.
result: PASSED 2026-07-10 (agent-driven, live prod). Deployed 12:41Z; CORS PUT fix shipped 13:03Z (a1c3e81). Sequence: (1) debitIdealMax 5000→4999 saved 13:05Z via modal — persisted across sessions, modal showed "default 5000" annotation; band-edge $1 move deliberately unobservable in outputs, so (2) observable weight swap slope 10→9 / vrp 5→6 saved 14:12Z; the 14:30:46Z RTH compute-picker snapshot stamped ruleSet slope=9, vrp=6 (sum 100) — worker read overrides fresh mid-day and stamped EFFECTIVE values. (3) All overrides reset to defaults via per-group Reset (PUT 200) at 14:50Z; modal confirmed baseline. Note: ruleSet stamps effective WEIGHTS only (T-29-14); band/ladder labels remain static metadata text — logged as Phase 32 modal-v2 consideration.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
