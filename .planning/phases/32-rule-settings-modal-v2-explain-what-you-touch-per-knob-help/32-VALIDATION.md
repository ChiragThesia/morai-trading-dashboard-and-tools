---
phase: 32
slug: rule-settings-modal-v2
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 32 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) + fast-check |
| **Quick run command** | scoped `bunx vitest run <path>` |
| **Full suite command** | `bun run test` |
| **Note** | no new tables; one new endpoint + MCP twin |

## Sampling Rate

- After every task commit: scoped tests
- After every wave: `bun run test` + typecheck + lint
- Before verify: full suite green

## Per-Task Verification Map

| Concern | Test Type |
|---------|-----------|
| Explainer registry completeness: every knob path in the REAL contract has an entry (imports actual schema — no hand-copied key list) | unit (contracts-driven) |
| Preview use-case byte-parity: empty staged overrides → previewed scores identical to stored snapshot scores | fast-check property (core) |
| Score-only knobs (9 weights + debit band) re-score correctly from stored candidate fields | unit (core) |
| Gate/sizing preview: staged ladder/maxOpen/sizing re-resolve from stored gate scalars + fresh open/closed reads | unit with fake ports (core) |
| Universe knobs (delta band, DTE windows) return honest not-previewable marker, never fake numbers | unit (core + component) |
| Exit preview: staged rungs re-evaluate current verdict inputs via pure evaluateExit | unit (core) |
| Regime preview: client-side band functions imported from @morai/core (legal per eslint boundaries) — staged bands re-band on-screen values; parity test vs core functions | unit (web) |
| POST /api/settings/rules/preview: auth, Zod-strict, never persists, snapshot asOf in response | integration (server route tests) |
| MCP preview twin | unit (server) |
| Modal v2: captions/popovers render per knob, Preview button flow, delta display, loading/error, staleness note | component tests (web) |
| Phase 29 modal v1 behaviors unregressed (save, reset-per-group, validation errors) | existing suites green |
| Phase 27 backtest neutrality | existing suites unmodified |

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (Tooltip primitive already present, unused — first consumer).

## Manual-Only Verifications

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| Explainer copy reads right to a trader | Editorial judgment | User skims modal copy on morai.wtf |
| Preview deltas plausible on live data | Live data judgment | Stage a weight swap → Preview → sensible movers list; stage universe knob → honest note |
