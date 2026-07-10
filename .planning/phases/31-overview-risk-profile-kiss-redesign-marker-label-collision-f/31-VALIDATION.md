---
phase: 31
slug: overview-risk-profile-kiss-redesign
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 31 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) + fast-check |
| **Quick run command** | scoped `bunx vitest run <path>` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | full ~50s + containers boot |
| **Note** | no new tables; additive contract fields only |

## Sampling Rate

- After every task commit: scoped tests for touched package
- After every wave: `bun run test` + typecheck + lint
- Before verify: full suite green

## Per-Task Verification Map

| Concern | Test Type |
|---------|-----------|
| Marker labels removed / lane-arrow scheme collision-proof (assignLabelRows or per-spec treatment): property test — any N markers in any domain → unique lanes/no shared anchor row | unit + fast-check (apps/web) |
| Real repro example: 7488/7500/7544/7550 on 7100–8050 domain renders without overlapping label anchors | example component test |
| Off-domain wall → edge arrow in fixed lane | component test |
| bandWarn/bandCrisis additive contract fields (Zod) + populated at all 4 getRegimeBoard push sites from effective config (Phase 29 overrides respected) | unit (contracts + core) |
| Regime response backward-compat (old clients: additive only) | contract test |
| Gauge component: value in calm/warn/crisis states, missing-data state, aria (role="meter", valuenow/valuetext), fixed scale ranges | component tests (apps/web) |
| RegimeBoard integration: 4 gauges + ENTRY GATE/rates/COT unchanged | component test |
| Both PayoffChart consumers (Overview + Analyzer) render new marker treatment; Phase 30 dynamic-domain tests stay green | existing + updated component tests |

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

## Manual-Only Verifications

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| Markers read clean on live clustered day; chart visually KISS | Perceptual | morai.wtf Overview + Analyzer after deploy |
| Gauges read at a glance, bands sensible vs live values | Perceptual | Left rail on morai.wtf; VIX/VIX3M 0.87 marker in calm zone etc. |
