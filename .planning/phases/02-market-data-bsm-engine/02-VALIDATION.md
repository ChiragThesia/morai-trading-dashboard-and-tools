---
phase: 2
slug: market-data-bsm-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (root `vitest.config.ts` with `test.projects`) + fast-check + msw + testcontainers |
| **Config file** | `vitest.config.ts` (root) + per-package `packages/*/vitest.config.ts`, `apps/*/vitest.config.ts` |
| **Quick run command** | `bunx vitest run <changed package filter>` |
| **Full suite command** | `bun run test` (Postgres tests: `TEST_DATABASE_URL=postgres://test:test@localhost:55432/morai_test` against `docker run -p 55432:5432 postgres:16` if testcontainers stalls locally) |
| **Estimated runtime** | ~60 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run quick command for the touched package
- **After every plan wave:** Run `bun run test` + `bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green, 0 skipped
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Filled by the planner — every task maps to a requirement and an automated command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (planner fills) | | | MKT-01..03, BSM-01..03 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Live CBOE endpoint smoke check — confirm `_SPX.json` content + whether SPXW contracts require `_SPXW.json` (research open question #1) before adapter TDD starts
- [ ] Recorded CBOE fixture payload committed for msw tests

*Existing infrastructure (Vitest 4 projects, msw, fast-check, testcontainers harness, TEST_DATABASE_URL escape hatch) covers all other phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production `lastJobRuns` shows successful `fetch-cboe-chain`; `leg_observations` has `source='cboe'` rows | MKT-03 / SPEC AC-7 | Needs deployed Railway worker + live RTH window | Deploy, wait for RTH 30-min slot, `curl /api/status`, query Supabase |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
