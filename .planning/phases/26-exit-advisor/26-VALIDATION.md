---
phase: 26
slug: exit-advisor
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
---

# Phase 26 — Validation Strategy

> Per-phase validation contract. Derived from 26-RESEARCH.md `## Validation Architecture` + the 6 committed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace + fast-check + testcontainers |
| **Config file** | `/vitest.config.ts` (root) |
| **Quick run command** | `bun run test -- packages/core/src/exits` (domain/application, no containers) |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~150 s full suite (2383 tests pre-phase) |

---

## Sampling Rate

- **After every task commit:** `bun run test -- packages/core/src/exits` (or the plan's named files)
- **After every plan wave:** full suite + typecheck
- **Before `/gsd-verify-work`:** full suite green + lint clean
- **Max feedback latency:** ~150 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-* | 01 | 1 | EXIT-01/04/06 | — | exit-rules.md registry doc + haircutFill export behavior-identical (picker tests stay green) + contracts schema rejects confidence fields | doc grep + unit | `rg -q "precedence" docs/architecture/exit-rules.md`; `bun run test -- packages/core/src/picker packages/contracts/src/exits.test.ts` | ❌ W0 | ⬜ pending |
| 26-02-* | 02 | 2 | EXIT-01..06/09 | T-26-03 stale-actionable | Registry boundary tests (TERM ≥0.5pp, GAMMA 2%+<7DTE, EVT ≤3d); precedence STOP>EVT>GAMMA>TERM>TAKE>ROLL>HOLD exhaustive; hysteresis both directions (fast-check no-flap property); indicative on AH/stale/NaN; P&L oracle vs known trade; ROLL AND-window + shared haircut fn | unit + fast-check | `bun run test -- packages/core/src/exits/domain` | ❌ W0 | ⬜ pending |
| 26-03-* | 03 | 3 | EXIT-01/02 | — | Migration 0020; composite-PK (observed_at, calendar_id) onConflictDoNothing idempotency (dual-write same cohort → first wins); twin parity; latest-snapshot port does NOT drop schwab_chain rows (Pitfall-1 regression) | contract (testcontainers) | `bun run test -- packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts packages/adapters/src/memory/exit-verdicts.contract.test.ts packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | ❌ W0 | ⬜ pending |
| 26-04-* | 04 | 4 | EXIT-01/02/06/09/10 | T-26-04 P&L drift, T-26-10 order creep | Use-case: one verdict per open calendar per cycle; single ledger read; change detection vs previous row; EXIT-10 static guard (no order port under exits/); chain trigger after compute-picker with idempotent enqueue | unit + static | `bun run test -- packages/core/src/exits/application apps/worker/src/handlers/compute-exit-advice.test.ts` | ❌ W0 | ⬜ pending |
| 26-05-* | 05 | 5 | EXIT-08 | T-26 error leak | Route + MCP share one exitsResponse (MCP-02 parity test); flat {error:"internal"} | integration | `bun run test -- apps/server/src/adapters/http/exits.routes.test.ts apps/server/src/adapters/mcp/tools.test.ts` | ❌ W0 | ⬜ pending |
| 26-06-* | 06 | 6 | EXIT-07/09/10 | T-26-16/17 | Panel renders chips+ruleSet from payload; escalated STOP/EVT styling; CHANGED marker; indicative forced non-actionable; no order affordance | RTL | `bun run test -- apps/web/src/screens/Analyzer.test.tsx apps/web/src/components/exits` | ✅ extend + ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

TDD RED-first tasks in plans create all missing files (exit-rules.test.ts, evaluate-exit.test.ts, computeExitAdvice.test.ts, exit-verdicts contract tests both sides, route/MCP tests, panel tests). Framework installed; no Wave 0 install work.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Panel visual fidelity (chips, escalation weight, CHANGED marker, indicative) | EXIT-07/09 | Visual judgment | chrome-devtools on Analyzer post-deploy; user sign-off (visual UAT) |
| exit_verdicts prod accrual | EXIT-01 | Prod state | psql: `SELECT count(*), max(observed_at) FROM exit_verdicts` after next RTH compute-picker chain cycle |
| Migration 0020 applied | — | Prod DDL | `bun run migrate` locally against prod (validates worker env incl SIDECAR_URL) before Railway deploys |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09
