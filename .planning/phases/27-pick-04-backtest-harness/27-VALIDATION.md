---
phase: 27
slug: pick-04-backtest-harness
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
---

# Phase 27 — Validation Strategy

> Per-phase validation contract. Derived from 27-RESEARCH.md `## Validation Architecture` + the 6 committed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4 workspace + fast-check + testcontainers |
| **Config file** | root/workspace vitest config (no phase-specific changes) |
| **Quick run command** | `bun run vitest run packages/core/src/backtest` (or specific new file) |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~160 s full suite (2515 tests pre-phase) |

---

## Sampling Rate

- **After every task commit:** the specific new/changed test file(s)
- **After every plan wave:** `bun run test` full suite (additive exports touch LIVE picker/exit paths — rules.test.ts, scoring.test.ts, computePickerSnapshot.test.ts, evaluate-exit.test.ts must not regress) + typecheck
- **Before `/gsd-verify-work`:** full suite green + lint clean
- **Max feedback latency:** ~160 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-01-* | 01 | 1 | BT-04/05 | — | Migration 0021 applies; backtest_runs INSERT-only (second insert never overwrites; no update port) | contract (testcontainers) | `bun run vitest run packages/adapters/src/postgres/repos/backtest-runs.contract.test.ts` | ❌ W0 | ⬜ pending |
| 27-02-* | 02 | 2 | BT-01/04 | — | Ablation seam additive: default = live registry, existing picker/exit suites untouched-green | unit (regression) | `bun run test -- packages/core/src/picker packages/core/src/exits` | ✅ must stay green | ⬜ pending |
| 27-03-* | 03 | 3 | BT-01/02/03 | lookahead | Future-dated row must NOT change as-of-T read; RV20 as-of-T; schwab_chain rows included in full-history read | contract (testcontainers) | `bun run vitest run packages/adapters/src/postgres/repos/backtest-chain.contract.test.ts packages/adapters/src/postgres/repos/backtest-history.contract.test.ts packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | ❌ W0 + ✅ extend | ⬜ pending |
| 27-04-* | 04 | 4 | BT-04 | overclaim | Attribution sign+n (constant array, n<4, known split); ablation-delta invariant; bootstrap CI (constant/n=1/low≤high/seeded-reproducible); coverage % | unit (fast-check) | `bun run vitest run packages/core/src/backtest/domain` | ❌ W0 | ⬜ pending |
| 27-05-* | 05 | 5 | BT-01..04 | leakage | Leakage oracle: seeded cohort reproduces stored score EXACTLY + ruleSet-drift flagged (not false mismatch); 13-trade direction+magnitude vs calendar_events.realizedPnl; hypothetical walk-forward w/ synthetic MarketContext | integration | `bun run vitest run packages/core/src/backtest/application` | ❌ W0 | ⬜ pending |
| 27-06-* | 06 | 6 | BT-04/05 | weight-write creep | Report: every number stamped n=/date-range/coverage; caveats (late-BSM) present; BT-05 structural guard (no ForWriting*Rules-shaped port, no write import into rules.ts/exit-rules.ts); CLI DATABASE_URL-only bootstrap | unit + static | `bun run vitest run packages/core/src/backtest/application/ports.test.ts packages/core/src/backtest/application/runBacktest.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

TDD RED-first tasks create all missing files (kernel tests, replay tests, contract tests, ports guard). Framework installed — no Wave 0 install. The `calendar-snapshots.contract.test.ts` extension reuses the existing file.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full CLI run against prod data | BT-01..05 | Operator artifact | `bun apps/worker/src/backtest.ts` (DATABASE_URL from .env) — orchestrator runs post-merge; report row lands in backtest_runs; leakage oracle passes on real cohorts; 13-trade reproduction reported |
| Migration 0021 applied | — | Prod DDL | `bun run migrate` before/with deploy |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 160s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09
