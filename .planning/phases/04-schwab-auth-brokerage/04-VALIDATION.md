---
phase: 04
slug: schwab-auth-brokerage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace) + fast-check, msw, testcontainers |
| **Config file** | `vitest.workspace.ts` (root) + per-package `vitest.config.ts` |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~30–90 seconds (testcontainers Postgres adds cold-start) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test` (affected package)
- **After every plan wave:** Run `bun run test && bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | AUTH-XX | T-04-XX / — | {expected secure behavior or "N/A"} | unit | `bun run test` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Populated by the planner / nyquist-auditor during planning — one row per task.*

---

## Wave 0 Requirements

- [ ] msw handlers for Schwab OAuth token endpoint + chain/positions/transactions
- [ ] testcontainers Postgres fixture with `pgcrypto` enabled (round-trip encrypt/decrypt)
- [ ] in-memory twins for the new Schwab trader ports (mirror Phase 1–2 contract-test pattern)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `auth setup` browser → loopback → token exchange | AUTH-01/03 | Requires real Schwab login + registered callback; cannot be automated in CI | Run `auth setup`, complete browser login, confirm encrypted row in `broker_tokens` |
| Live SPX chain fetch via Schwab market app | BRK-01 | Requires live authed Schwab market app + RTH market hours | Run chain pull during RTH, confirm `leg_observations` rows tagged `source='schwab_chain'` |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
