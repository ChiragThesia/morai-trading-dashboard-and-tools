---
phase: 25
slug: data-quality-ops-rider
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-09
---

# Phase 25 — Validation Strategy

> Per-phase validation contract. Derived from 25-RESEARCH.md `## Validation Architecture` + the 2 committed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace + fast-check + testcontainers (Postgres contract tests) |
| **Config file** | `/vitest.config.ts` (root), `packages/core/vitest.config.ts` |
| **Quick run command** | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts packages/core/src/journal/application/computeBsmGreeks.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~150 s full suite (2376 tests as of Phase 24) |

---

## Sampling Rate

- **After every task commit:** targeted unit files (no Docker)
- **After every plan wave:** contract test files (testcontainers, Docker) + `bun run typecheck`
- **Before `/gsd-verify-work`:** full suite green + lint clean
- **Max feedback latency:** ~150 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | OPS-01 | — | jobs.md documents freshness gate + tolerance constant | doc grep | `rg -q "SNAPSHOT_LEG_STALENESS_TOLERANCE" docs/architecture/jobs.md` | ❌ (edit) | ⬜ pending |
| 25-01-02 | 01 | 1 | OPS-01 | — | Jul-06 zero-row shape → SKIP; stale-serve shape → SKIP+warn; fresh legs → written unchanged (D-05/D-06 regression guard) | unit (TDD) | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | ✅ extend | ⬜ pending |
| 25-01-03 | 01 | 1 | OPS-01 | — | Postgres read paths return real `time` column (round-trip) | contract (testcontainers) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | ✅ extend | ⬜ pending |
| 25-02-01 | 02 | 2 | OPS-02 | — | jobs.md stale lines fixed (cadence + retry defaults) + batch/budget constants documented | doc grep | `rg -q "COMMIT_BATCH_SIZE" docs/architecture/jobs.md` | ❌ (edit) | ⬜ pending |
| 25-02-02 | 02 | 2 | OPS-02 | DoS-vs-900s | Batch loop: ≤800/batch writeBsm calls; budget-exhausted → ok(undefined) with pending remaining; single small batch drains in one pass | unit (TDD, fake now()) | `bun run test -- packages/core/src/journal/application/computeBsmGreeks.test.ts` | ✅ extend | ⬜ pending |
| 25-02-03 | 02 | 2 | OPS-02 | — | Kill/budget-interrupt mid-drain → committed batches persist; second invocation resumes via bsm_iv IS NULL and finishes | contract (testcontainers) | `bun run test -- packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

None — all four test files exist with the exact fixture/capture patterns needed (`makeLegSnapshot`, `makePersistCapture`, `runBsmDrainContractTests`). No new test file or framework install required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Zero new gap rows post-deploy | OPS-01 | Prod state over time | psql: `SELECT count(*) FROM calendar_snapshots WHERE time > '<deploy-ts>' AND (spot=0 OR spot IS NULL OR spot='NaN')` — expect 0 across subsequent RTH days |
| BSM durations under cap + backlog drains | OPS-02 | Prod pgboss state | psql: `SELECT completed_on-started_on FROM pgboss.job WHERE name='compute-bsm-greeks' AND started_on > '<deploy-ts>'` — expect << 900s per run; null-BSM backlog trends to 0 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none needed)
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09
