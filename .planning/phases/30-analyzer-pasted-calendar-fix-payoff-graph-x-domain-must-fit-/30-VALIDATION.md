---
phase: 30
slug: analyzer-pasted-calendar-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) + fast-check + msw |
| **Config file** | `vitest.workspace.ts` |
| **Quick run command** | scoped `bunx vitest run <package/path>` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | full suite ~50s local run + testcontainers boot |
| **Note** | no new tables expected → no new testcontainers suites |

---

## Sampling Rate

- **After every task commit:** scoped tests for the touched package
- **After every plan wave:** `bun run test` + `bun run typecheck` + `bun run lint`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Concern | Test Type | Command pattern |
|---------|-----------|-----------------|
| Domain-fit function (positions → [min,max]: covers all strikes/BEs/spot, padding, monotone in inputs) | unit + fast-check property | vitest apps/web (lib) |
| scenario-engine grid follows dynamic domain (curve data spans domain; no 6900/7900 literals left) | unit + source assertion | vitest apps/web |
| PayoffChart: xScale/ticks/pinMarker/crosshair (line 375 pointer math) all derive from dynamic domain | component tests | vitest apps/web |
| Overview combined-book non-regression (multi-strike book renders; walls pin correctly) | component test | vitest apps/web |
| User repro: 7500P pasted → left BE 7150 + full left tail inside domain | example test | vitest apps/web |
| analyzeAdHocCalendar use-case (puts-only guard, scoring parity with scoreOne, effective rule config applied, snapshot gate/sizing reuse, scored:false degradation) | unit with fake ports | vitest packages/core |
| POST /picker/analyze route (auth, Zod parse, 200 + scored:false when context missing, Result mapping) | integration (route test pattern) | vitest apps/server |
| MCP analyze tool (same contract) | unit | vitest apps/server |
| Contract schemas (analyze request/response, additive only) | unit | vitest packages/contracts |
| Paste flow calls endpoint + renders factor bars/gate chip; fallback to unscored note on scored:false | hook + component tests (msw) | vitest apps/web |
| Backtest neutrality (replay suites untouched, pass unmodified) | existing suites | `bun run test` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No Wave 0 install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pasted 7500P renders full tent + real score card on morai.wtf | User repro | Visual + live context | Paste the user's TOS order, confirm tent fits with both BEs visible and factor bars/θ GATE render |
| Live scoring uses current overrides | Phase 29 integration | Needs live DB state | With an override active, pasted score reflects it (ruleSet parity with engine candidates) |
