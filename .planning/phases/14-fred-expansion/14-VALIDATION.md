---
phase: 14
slug: fred-expansion
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
audited: 2026-07-01
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) |
| **Config file** | vitest.workspace.ts |
| **Quick run command** | `bun run test -- <changed package>` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- <changed package>`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| docs cadence + schema | 14-01 | 1 | MAC-01 | — | — | grep | `grep -n "18:30\|30 18" docs/architecture/jobs.md && grep -n "macro_observations" docs/architecture/data-model.md` | ✅ | ✅ green |
| macro Zod contract | 14-01 | 1 | MAC-01, MAC-02 | — | — | unit | `bun run test -- packages/contracts/src/macro.test.ts` | ✅ | ✅ green |
| core macro ports | 14-01 | 1 | MAC-01, MAC-02 | — | — | typecheck | `bun run typecheck` | — | ✅ green |
| macro_observations migration 0013 | 14-02 | 1 | MAC-01 | — | RLS on table | migration | `bun run migrate && bun run typecheck` | — | ✅ green (live, idempotent ×2) |
| FRED series adapter | 14-03 | 2 | MAC-01 | — | no-fallback, key not logged | unit | `bun run test -- packages/adapters/src/http/fred.test.ts` | ✅ | ✅ green |
| CBOE VVIX adapter | 14-03 | 2 | MAC-01 | — | ET trading-day date (WR-02) | unit | `bun run test -- packages/adapters/src/http/cboe-vvix.test.ts` | ✅ | ✅ green |
| macro repo + twin contract | 14-03 | 2 | MAC-01 | — | — | integration (testcontainers) | `bun run test -- --project packages/adapters macro-observations` | ✅ | ✅ green |
| fetchMacroSeries use-case | 14-04 | 2 | MAC-01 | — | fail-loud finish | unit | `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts` | ✅ | ✅ green |
| getMacro use-case | 14-04 | 2 | MAC-02 | — | — | unit | `bun run test -- packages/core/src/journal/application/getMacro.test.ts` | ✅ | ✅ green |
| fetch-rates macro fetch | 14-05 | 3 | MAC-01 | — | — | unit | `bun run test -- --project apps/worker fetch-rates` | ✅ | ✅ green |
| twice-daily cron (D-06) | 14-05 | 3 | MAC-01 | — | distinct schedule keys (CR-01) | unit | `bun run test -- --project apps/worker schedule` | ✅ | ✅ green |
| worker composition | 14-05 | 3 | MAC-01 | — | — | typecheck + project | `bun run typecheck && bun run test -- --project apps/worker` | — | ✅ green |
| GET /api/analytics/macro | 14-06 | 3 | MAC-02 | — | query Zod-validated | integration | `bun run test -- --project server analytics.routes` | ✅ | ✅ green |
| get_macro MCP tool | 14-06 | 3 | MAC-02 | — | shared contract parity | integration | `bun run test -- --project server mcp` | ✅ | ✅ green |
| server composition | 14-06 | 3 | MAC-02 | — | — | typecheck + project | `bun run typecheck && bun run test -- --project server` | — | ✅ green |
| useMacro hook | 14-07 | 4 | MAC-02 | — | — | unit | `bun run test -- --project web useMacro` | ✅ | ✅ green |
| MacroCard + Overview | 14-07 | 4 | MAC-02 | — | — | unit | `bun run test -- --project web MacroCard Overview` | ✅ | ✅ green |
| MacroCard visual checkpoint | 14-07 | 4 | MAC-02 | — | — | manual | — | — | ✅ approved (human-verify) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Test stubs for MAC-01 (macro_observations ingest, idempotency) — superseded: full TDD suites exist (contract, adapters, repo, use-case, worker)
- [x] Test stubs for MAC-02 (macro route + MCP get_macro contract) — superseded: route + MCP + web suites exist

*Existing vitest workspace infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Result |
|----------|-------------|------------|-------------------|--------|
| Prod `FRED_API_KEY` set + live fetch-rates run | MAC-01 | Operator env var + live FRED/CBOE API | Set key in Railway, trigger fetch-rates, query macro_observations | ✅ passed 2026-07-02 (14-UAT.md: 8 series live, sane values, idempotent) |
| Stale keyless pgboss schedule cleanup | MAC-01 | One-time prod SQL | `DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';` | ✅ done 2026-07-02 (14-UAT.md) |
| MacroCard visual in Overview | MAC-02 | Human visual judgment | Run web app, check Overview macro card renders live data | ✅ approved (14-07 checkpoint) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved — validation audit 2026-07-01

---

## Validation Audit 2026-07-01

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 14 test files present. Macro-targeted run: 17 files / 153 tests green (includes
testcontainers Postgres contract suite). Full suite at phase verification: 170 files /
1520 tests green. MAC-01 and MAC-02 fully covered by automated tests; three
operator/visual items closed via UAT evidence (14-UAT.md).
