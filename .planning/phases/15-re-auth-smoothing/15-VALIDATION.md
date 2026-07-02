---
phase: 15
slug: re-auth-smoothing
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-02
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) + pytest (sidecar) |
| **Config file** | `vitest.workspace.ts` / `apps/sidecar/pytest.ini` |
| **Quick run command** | `bun run test --project <affected-package>` |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` verify command (targeted `bun test`)
- **After every plan wave:** Run `bun run test && bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | AUTH-05 | plan `<threat_model>` | no token values in computed status | unit (tdd) | `bun test packages/core/src/brokerage/domain/token-freshness.test.ts` | ✅ | ⬜ pending |
| 15-01-02 | 01 | 1 | AUTH-05 | plan `<threat_model>` | contract field propagates, no `any`/`as` | typecheck+suite | `bun run typecheck && bun run test` | ✅ | ⬜ pending |
| 15-02-01 | 02 | 1 | AUTH-06 | T-15-04/05 (mitigated) | no token/redirect-URL values logged | source assertion | `python -c "import ast; ast.parse(open('apps/sidecar/seed_token.py').read())"; rg -c 'railway redeploy --service sidecar' apps/sidecar/seed_token.py` | ✅ | ⬜ pending |
| 15-02-02 | 02 | 1 | AUTH-06 | plan `<threat_model>` | runbook never contains secrets | source assertion | `test -f docs/operations/schwab-reauth-runbook.md; rg -c 'railway redeploy --service sidecar -y' docs/operations/schwab-reauth-runbook.md; rg -c 'schwab-reauth-runbook' docs/TOPIC-MAP.md` | ✅ (new file) | ⬜ pending |
| 15-02-03 | 02 | 1 | AUTH-06 | — | live OAuth dance, operator-gated | checkpoint:human-verify | manual (see Manual-Only below) | — | ⬜ pending |
| 15-03-01 | 03 | 1 | AUTH-06 | plan `<threat_model>` | retired job not triggerable | unit (tdd) | `bun test packages/contracts/src/jobs.test.ts apps/server/src/adapters/http/jobs.routes.test.ts && bun run typecheck` | ✅ | ⬜ pending |
| 15-04-01 | 04 | 2 | AUTH-05 | T-15-09 (mitigated) | warn log carries appId+seconds only, never tokens | unit (tdd) | `bun test apps/server/src/adapters/refresh-expiry-warner.test.ts && bun run typecheck` | ✅ W0 (new test file) | ⬜ pending |
| 15-04-02 | 04 | 2 | AUTH-05 | plan `<threat_model>` | single composition-root wiring (HTTP+MCP) | integration | `bun run typecheck && bun test apps/server/src/adapters/mcp/mcp.test.ts apps/server/src/adapters/http/status.routes.test.ts` | ✅ | ⬜ pending |
| 15-05-01 | 05 | 2 | AUTH-05 | plan `<threat_model>` | banner renders no token data | component (tdd) | `bun test apps/web/src/components/AuthExpiredBanner.test.tsx && bun run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. New test files
(`refresh-expiry-warner.test.ts`) are created RED-first inside their own TDD tasks —
no separate Wave 0 stubs needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live re-auth runbook end-to-end (Schwab OAuth dance → token write → `railway redeploy --service sidecar -y` → freshness restored on `/api/status`) | AUTH-06 | Requires live Schwab OAuth browser flow + prod Railway restart | Follow `docs/operations/schwab-reauth-runbook.md` at 15-02 checkpoint / UAT |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (15-02-03 is an explicit human-verify checkpoint)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none exist)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-02 (plan-checker Nyquist dimension passed 8a–8d)
