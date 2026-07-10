---
phase: 29
slug: runtime-rule-settings
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) + fast-check + testcontainers + msw |
| **Config file** | `vitest.workspace.ts` (workspace root) |
| **Quick run command** | `bun run test --project <package> -- <file>` (scoped to touched package) |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | full suite ~4–6 min (2,776+ tests, testcontainers Postgres) |

---

## Sampling Rate

- **After every task commit:** Run scoped package tests for the touched package
- **After every plan wave:** Run `bun run test` + `bun run typecheck` + `bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~360 seconds (full suite)

---

## Per-Task Verification Map

Filled by planner per task. Test types available in this repo:

| Concern | Test Type | Command pattern |
|---------|-----------|-----------------|
| Merge semantics (`resolveRuleConfig`: overrides ⊆ whitelist, idempotent, defaults-identical when empty) | unit + fast-check property | vitest in `packages/core` |
| Zod overrides schema (reject unknown keys, hysteresis pair validation, weight-sum invariant) | unit | vitest in `packages/contracts` / `packages/core` |
| Overrides table repo (read/write/delete JSONB row) | contract test (testcontainers Postgres) | vitest in `packages/adapters` |
| GET/PUT routes (auth, validation errors, effective-config response) | integration (Hono app + msw/testcontainers per existing route-test pattern) | vitest in `apps/server` |
| Worker merge-at-job-start (compute-picker reads fresh overrides; no cross-run caching) | unit with fake port + integration | vitest in `apps/worker` / `packages/core` |
| Snapshot `ruleSet` stamps EFFECTIVE values (not compile-time constants) | unit on `computePickerSnapshot` | vitest in `packages/core` |
| Backtest determinism unchanged (no-override path byte-identical) | existing suites must pass UNMODIFIED (`rules.test.ts`, `candidate-selection.test.ts`, `brakes.test.ts`, `evaluate-exit.test.ts`) | `bun run test` |
| Modal + gear icon + reset-per-group | component tests (existing web test patterns) | vitest in `apps/web` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — vitest workspace, fast-check,
testcontainers, and web component-test setup are all live. No Wave 0 install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gear icon placement/affordance in top bar; modal visual grouping | UI decision (CONTEXT.md) | Visual quality judgment | Open web app, verify gear top-right in nav bar next to Overview/Analyzer/Journal; modal groups Entry/Picker · Exit Advisor · Regime Bands; overridden values show default alongside |
| Mid-day override takes effect next compute-picker cycle | Worker freshness decision | Requires live worker + RTH timing | Set override, wait for next 30-min cycle (or trigger_job), confirm picker snapshot ruleSet reflects new value |
