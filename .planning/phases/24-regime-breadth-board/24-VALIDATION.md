---
phase: 24
slug: regime-breadth-board
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 24-RESEARCH.md `## Validation Architecture` + the 5 committed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace (`vitest run`), fast-check for banding boundary sweeps, msw for HTTP adapter tests, testcontainers not needed (no new tables) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `bun run test -- <touched test file>` per task |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~90–150 s full suite (2313 tests as of Phase 23) |

---

## Sampling Rate

- **After every task commit:** Run the task's quick command (named per task in each PLAN's `<verify>`)
- **After every plan wave:** Run `bun run test` (full suite) + `bun run typecheck`
- **Before `/gsd-verify-work`:** Full suite green + lint clean
- **Max feedback latency:** ~150 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | MACRO-02 | — | Evidence doc carries per-indicator source + refutations (RSP:SPY drop, VVIX/VIX defer) | doc grep | `rg -q "RSP:SPY" docs/architecture/regime-board.md` | ❌ W0 | ⬜ pending |
| 24-01-02 | 01 | 1 | MACRO-03 | T-24 FRED sentinel | FRED `.` sentinel rows filtered (existing path reused for BAMLH0A0HYM2) | unit | `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts` | ✅ | ⬜ pending |
| 24-02-01 | 02 | 2 | MACRO-03 | T-24 malformed CBOE payload | Zod safeParse at adapter edge; malformed → err, never fabricated | unit (msw) | `bun run test -- packages/adapters/src/http/cboe-vix9d.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-02 | 02 | 2 | MACRO-03 | — | Worker wiring: VIX9D task appended, allSettled fail-loud inherited | unit | `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts` | ✅ | ⬜ pending |
| 24-03-01 | 03 | 1 | BOARD-02 | — | Contract carries source/rationale fields (provenance in payload, not UI copy) | contract unit | `bun run test -- packages/contracts/src/regime.test.ts` | ❌ W0 | ⬜ pending |
| 24-03-02 | 03 | 1 | BOARD-01, MACRO-02 | — | 4 banding fns: monotonic, no gap/overlap at 0.90/0.95, 100/115, 1.0/1.1, 3.0/5.0 cuts | unit + fast-check | `bun run test -- packages/core/src/analytics/domain/regime.test.ts` | ❌ W0 | ⬜ pending |
| 24-04-01 | 04 | 3 | BOARD-01, MACRO-03 | T-24-09 fabricated indicator | Missing series → indicator omitted; asOf = observation date never now(); empty store → empty array | unit | `bun run test -- packages/core/src/analytics/application/getRegimeBoard.test.ts` | ❌ W0 | ⬜ pending |
| 24-04-02 | 04 | 3 | BOARD-03 | T-24 error leak | Route + MCP share one `regimeResponse` schema; flat `{error:"internal"}` mapping | integration | `bun run test -- apps/server/src/adapters/http/analytics.routes.test.ts` | ✅ (new describe) | ⬜ pending |
| 24-05-01 | 05 | 4 | BOARD-01 | — | Board renders value/band/asOf per indicator; missing indicator → omitted, no dash chip | RTL | `bun run test -- apps/web/src/components/RegimeBoard.test.tsx` | ❌ W0 | ⬜ pending |
| 24-05-02 | 05 | 4 | BOARD-02 | — | Provenance tooltip renders payload source/rationale; Overview mounts board | RTL | `bun run test -- apps/web/src/screens/Overview.test.tsx` | ✅ (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/analytics/domain/regime.test.ts` — boundary tests all 4 banding fns (fast-check: monotonic, no gap/overlap at cuts)
- [ ] `packages/core/src/analytics/application/getRegimeBoard.test.ts` — asOf-is-observation-date, empty-store → empty array, missing-series → omitted
- [ ] `packages/adapters/src/http/cboe-vix9d.test.ts` — msw 200/non-200/malformed, cloned from cboe-vvix.test.ts
- [ ] `packages/contracts/src/regime.test.ts` — schema round-trip + provenance fields required

TDD RED-first tasks in plans 24-02/24-03/24-04 create these — no separate Wave 0 install needed (framework exists).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Board visual fidelity (chip grid, band triad colors, tooltip) on Overview | BOARD-01/02 | Pixel/visual judgment | chrome-devtools on local web (or morai.wtf post-deploy): Overview shows 4 chips, hover ⓘ → source+rationale tooltip, as-of date visible |
| VIX9D + HY OAS prod accrual day-one | MACRO-03 | Prod DB state | psql: `SELECT series_id, max(observed_at) FROM macro_observations WHERE series_id IN ('VIX9D','BAMLH0A0HYM2') GROUP BY 1` after next fetch-rates run post-deploy |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09
