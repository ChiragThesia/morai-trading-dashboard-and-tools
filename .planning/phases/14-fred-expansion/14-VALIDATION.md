---
phase: 14
slug: fred-expansion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
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
| (filled by planner) | — | — | MAC-01, MAC-02 | — | — | unit/integration | `bun run test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for MAC-01 (macro_observations ingest, idempotency)
- [ ] Test stubs for MAC-02 (macro route + MCP get_macro contract)

*Existing vitest workspace infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Prod `FRED_API_KEY` set + live fetch-rates run | MAC-01 | Operator env var + live FRED/CBOE API | Set key in Railway, trigger fetch-rates, query macro_observations |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
