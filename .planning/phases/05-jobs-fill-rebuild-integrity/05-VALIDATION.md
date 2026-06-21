---
phase: 05
slug: jobs-fill-rebuild-integrity
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-21
updated: 2026-06-21
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (+ fast-check, testcontainers, msw) |
| **Config file** | per-package `vitest.config.ts` (workspace) |
| **Quick run command** | `bun run test` (vitest run, no Docker — core/domain/use-case + memory twins) |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` (incl testcontainers Postgres) |
| **Estimated runtime** | ~60–120 s full suite (testcontainers dominate); < 15 s for core-only |

---

## Sampling Rate

- **After every task commit:** Run the task's `<verify><automated>` (core/memory tests, < 15 s)
- **After every plan wave:** Run `bun run test && bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green (incl testcontainers)
- **Max feedback latency:** < 15 s per task; full suite < 120 s per wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | JOB-01/JRNL-01 | T-05-02 | Docs precede schema (no secrets in docs) | docs grep | `rg -q "calendar_events" docs/architecture/data-model.md` | ✅ exists | ⬜ pending |
| 05-01-02 | 01 | 1 | JRNL-01 | T-05-01 | fill_ids_hash UNIQUE(64) blocks dup events | typecheck | `cd packages/adapters && bunx tsc --noEmit` | ✅ exists | ⬜ pending |
| 05-01-03 | 01 | 1 | JOB-01/JRNL-01 | T-05-01 | Wave-0 RED stubs fail on assertions | unit | `cd packages/core && bun run test src/journal/domain/fill-pairing.test.ts` (must FAIL) | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | JRNL-01 | T-05-03 | Additive-only migration (no DROP/RENAME) | migration grep | `rg -q "calendar_events" packages/adapters/src/postgres/migrations/0004_calendar_events.sql` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | JRNL-01 | T-05-03/04/05 | Live DB has tables; idempotent re-run | manual SQL | `SELECT to_regclass('public.calendar_events')` IS NOT NULL | ❌ manual | ⬜ pending |
| 05-03-01 | 03 | 2 | JRNL-01 | T-05-06/07 | hashFillIds deterministic; classifyFill never drops | unit + property | `cd packages/core && bun run test src/journal/domain/fill-pairing.test.ts` | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 3 | JOB-01 | T-05-08 | singletonKey dedupe (never singletonSeconds) | unit | `cd packages/core && bun run test src/journal/domain/dedupe-key.test.ts` | ❌ W0 | ⬜ pending |
| 05-04-02 | 04 | 3 | JOB-01 | T-05-08 | enqueue idempotent; TRACKED_JOBS = 7 | unit | `cd packages/core && bun run test src/journal/application/enqueueJob.test.ts` | ❌ W0 | ⬜ pending |
| 05-04-03 | 04 | 3 | JOB-01 | T-05-09 | snapshot-calendars + rebuild-journal cronless | unit | `cd apps/worker && bun run test src/schedule.test.ts` | ❌ W0 | ⬜ pending |
| 05-05-01 | 05 | 4 | JOB-02 | T-05-11/12/13 | allSettled per-app; isNearExpiry@6d; no token logs | unit | `cd packages/core && bun run test src/brokerage/application/refreshTokens.test.ts` | ❌ W0 | ⬜ pending |
| 05-05-02 | 05 | 4 | JOB-02 | T-05-11/12 | No RTH gate; one-app failure isolated; no token logs | unit | `cd apps/worker && bun run test src/handlers/refresh-tokens.test.ts` | ❌ W0 | ⬜ pending |
| 05-06-01 | 06 | 4 | JOB-03 | T-05-15/16 | SC3 drain to 0; mark-NULL skipped; idempotent | integration (testcontainers) | `cd packages/adapters && bun run test src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` | ❌ W0 | ⬜ pending |
| 05-07-01 | 07 | 5 | JRNL-01 | T-05-17/18/19/20 | OPEN/CLOSE/ROLL + per-leg P&L; orphan parked; re-run idempotent | unit (in-memory) | `cd packages/core && bun run test src/journal/application/syncFills.test.ts` | ❌ W0 | ⬜ pending |
| 05-07-02 | 07 | 5 | JRNL-01 | T-05-17 | calendar-events/orphan-fills contract on both impls | integration (testcontainers + memory) | `cd packages/adapters && bun run test src/postgres/repos/calendar-events.contract.test.ts src/memory/calendar-events.contract.test.ts` | ❌ W0 | ⬜ pending |
| 05-07-03 | 07 | 5 | JRNL-01 | T-05-19 | sync-fills handler RTH-gated + Zod payload | unit | `cd apps/worker && bun run test src/handlers/sync-fills.test.ts` | ❌ W0 | ⬜ pending |
| 05-08-01 | 08 | 6 | JRNL-01 | T-05-23 | SC5 reconciliation; rebuild idempotent | unit (in-memory) | `cd packages/core && bun run test src/journal/application/rebuildJournal.test.ts` | ❌ W0 | ⬜ pending |
| 05-08-02 | 08 | 6 | JRNL-01 | T-05-21/22/24 | trigger_job HTTP+MCP share schema; auth-guarded | unit | `cd apps/server && bun run test src/adapters/http/jobs.routes.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** No 3 consecutive tasks lack an `<automated>` verify. The only manual
check (05-02-02 live-DB apply) is a [BLOCKING] checkpoint flanked by automated migration-file
grep (05-02-01) and the downstream automated SC3/SC4/SC5 contract tests that exercise the live
schema — feedback latency stays within bounds.

---

## Wave 0 Requirements

All failing-test stubs are created in plan 05-01 Task 3 (TDD RED baseline). They must fail on
assertions (not import errors) before downstream plans implement against them. The dedupe-key /
enqueueJob RED stubs are created within plan 05-04's own RED step (their consumers live in 05-04).

- [ ] `packages/core/src/journal/domain/fill-pairing.test.ts` — classifyFill/aggregatePartialFills/computePnl/detectRoll/hashFillIds (example + fast-check) — driven GREEN by 05-03
- [ ] `packages/core/src/journal/domain/dedupe-key.test.ts` — scheduledDedupeKey/rebuildDedupeKey — driven GREEN by 05-04
- [ ] `packages/core/src/journal/application/enqueueJob.test.ts` — enqueue idempotency — 05-04
- [ ] `packages/core/src/journal/application/syncFills.test.ts` — OPEN/CLOSE/ROLL, orphan parking, idempotency — driven GREEN by 05-07
- [ ] `packages/core/src/journal/application/rebuildJournal.test.ts` — delete-then-reinsert + SC5 reconciliation — driven GREEN by 05-08
- [ ] `packages/core/src/brokerage/application/refreshTokens.test.ts` — per-app independence + expiry warning — driven GREEN by 05-05
- [ ] `packages/core/src/brokerage/domain/token-freshness.test.ts` — isNearExpiry — 05-05
- [ ] `packages/adapters/src/__contract__/calendar-events.contract.ts` + `__contract__/orphan-fills.contract.ts` — shared contract modules — filled in by 05-07
- [ ] `packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` — SC3 drain (testcontainers) — 05-06
- [ ] `apps/worker/src/handlers/sync-fills.test.ts` — RTH gate + delegation — 05-07
- [ ] `apps/worker/src/handlers/refresh-tokens.test.ts` — no RTH gate + one-app isolation — 05-05
- [ ] `apps/worker/src/handlers/rebuild-journal.test.ts` — on-demand handler — 05-08
- [ ] `apps/worker/src/schedule.test.ts` — 7 createQueue / 5 schedule (snapshot + rebuild cronless) — 05-04
- [ ] `apps/server/src/adapters/http/jobs.routes.test.ts` — trigger_job HTTP — 05-08
- [ ] Shared fixtures: testcontainers Postgres harness (reuse calendar-snapshots.contract.test.ts pattern); msw Schwab refresh handler (reuse Phase 4); in-memory JobQueue twin
- [ ] Framework install: None needed — vitest, fast-check, testcontainers, msw already installed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live DB migration applied (calendar_events, orphan_fills, entry_thesis) | JRNL-01 | DDL against the live Supabase DB cannot run in CI without prod credentials; [BLOCKING] gate | Run `bun run migrate`; `SELECT to_regclass('public.calendar_events')` IS NOT NULL; second run is a no-op (05-02 Task 2) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency (the single manual check is the [BLOCKING] migration)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120 s full suite
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-21
