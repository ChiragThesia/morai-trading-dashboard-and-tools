---
phase: 40
slug: journal-history-repair-never-lose-a-calendars-greek-vol-story
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 40-RESEARCH.md §Validation Architecture. The planner fills the
> Per-Task Verification Map from its task breakdown.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root `vitest.config.ts`) + fast-check ^4.8.0 + testcontainers (Postgres) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `bun run test -- <path/to/file.test.ts>` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~300 seconds (full workspace, 313 files) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- <changed file(s)>`
- **After every plan wave:** Run `bun run test` + `bun run typecheck` + `bun run lint`
- **Before `/gsd-verify-work`:** Full suite green, PLUS D-09 regression gate:
  `bun run test -- packages/core/src/backtest packages/core/src/exits` (backtest + exit
  suites consume journal rows — repair changes their inputs)
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 40-01-T1 | 40-01 | 1 | HIST-03/04 (docs-first) | T-40-SC | Docs-before-code job catalog; unrelated macro backfill note untouched | docs grep | `grep -q "self-heal-journal" docs/architecture/jobs.md && grep -q "repair-journal-history" docs/architecture/jobs.md` | ❌ edit existing | ⬜ pending |
| 40-01-T2 | 40-01 | 1 | HIST-01 | T-40-01 | Root candidates from a closed union (no arbitrary root reaches a query) | unit + fast-check | `bun run test -- packages/core/src/journal/domain/occ-root.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-01-T3 | 40-01 | 1 | HIST-05 | T-40-07 | Idempotent slot rounding (same-slot collapse) | unit + fast-check | `bun run test -- packages/core/src/journal/domain/rth-slot.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-02-T1 | 40-02 | 2 | HIST-01 | T-40-05, T-40-09 | Both candidate roots built; honest NaN only on genuine miss | unit + contract | `bun run test -- packages/core/src/journal/application/getLiveGreeks.test.ts packages/adapters/src/postgres/repos/calendars.contract.test.ts` | ❌ getLiveGreeks / extend calendars.contract | ⬜ pending |
| 40-02-T2 | 40-02 | 2 | HIST-01 | T-40-05, T-40-08 | Candidate-root contract match; source-inclusive journal read | contract (pg + memory) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts packages/adapters/src/memory/calendar-snapshots.contract.test.ts` | extend existing | ⬜ pending |
| 40-03-T1 | 40-03 | 2 | HIST-05 | T-40-10, T-40-11 | Same-slot dedup via existing PK; freshness gate on real clock | unit | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | extend existing | ⬜ pending |
| 40-04-T1 | 40-04 | 3 | HIST-02 | T-40-05, T-40-03 | As-of-slot read; stale-outside-window → honest gap | contract (pg + memory) | `bun run test -- packages/adapters/src/postgres/repos/leg-observations.contract.test.ts packages/adapters/src/memory/leg-observations.contract.test.ts` | extend + new memory runner | ⬜ pending |
| 40-04-T2 | 40-04 | 3 | HIST-02 | T-40-02, T-40-12 | Fill-only heal via isGapRow; windowed delete keeps in-window rows | contract (pg + memory) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts packages/adapters/src/memory/calendar-snapshots.contract.test.ts` | extend existing | ⬜ pending |
| 40-05-T1 | 40-05 | 4 | HIST-02 | T-40-01 | Slot enumeration clamped to life window (D-08) | unit + fast-check | `bun run test -- packages/core/src/journal/application/rebuildCalendarHistory.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-05-T2 | 40-05 | 4 | HIST-02 | T-40-13, T-40-03, T-40-02 | Byte-identical to live writer; honest-gap skip; fill-only heal | unit + fast-check | `bun run test -- packages/core/src/journal/application/rebuildCalendarHistory.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-06-T1 | 40-06 | 5 | HIST-03 | T-40-02, T-40-14 | OPEN-only, bounded lookback, fill-only | unit | `bun run test -- packages/core/src/journal/application/selfHealJournal.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-06-T2 | 40-06 | 5 | HIST-03 | T-40-06 | Handler Zod-parses payload; array-guard; throws on !ok | unit | `bun run test -- apps/worker/src/handlers/self-heal-journal.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-07-T1 | 40-07 | 6 | HIST-04 | T-40-04, T-40-15 | Heal-only by default; trim opt-in with count; before/after coverage | unit | `bun run test -- packages/core/src/journal/application/repairJournalHistory.test.ts` | ❌ Wave 0 | ⬜ pending |
| 40-07-T2 | 40-07 | 6 | HIST-04 | T-40-06, T-40-15 | z.enum job name; trim not reachable via trigger_job; explicit --all | unit | `bun run test -- apps/worker/src/handlers/repair-journal-history.test.ts packages/contracts/src/jobs.test.ts` | ❌ Wave 0 / extend jobs | ⬜ pending |
| 40-07-T3 | 40-07 | 6 | HIST-04 | T-40-16 | On-register backfill non-fatal to registration | unit | `bun run test -- packages/core/src/journal/application/registerOpenCalendars.test.ts` | extend existing | ⬜ pending |
| 40-08-T1 | 40-08 | 7 | HIST-01..05 + D-09 | T-40-18 | Full suite + typecheck + lint + backtest/exit regression green | integration | `bun run test && bun run typecheck && bun run lint && bun run test -- packages/core/src/backtest packages/core/src/exits` | existing suites | ⬜ pending |
| 40-08-T2 | 40-08 | 7 | HIST-01/04 | T-40-17 | Diagnostic SQL before write; heal-only trigger_job; before/after counts | manual (operator) | Diagnostic SQL queries 1-2 + `trigger_job repair-journal-history` (see plan 08 how-to-verify) | manual | ⬜ pending |
| 40-08-T3 | 40-08 | 7 | HIST-02/03 | — | Healed non-gap lifecycle series; honest gaps preserved; one row per slot | manual (visual UAT) | morai.wtf Journal lifecycle check (see plan 08 how-to-verify) | manual | ⬜ pending |

Requirement → test map (from RESEARCH §Validation Architecture):

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HIST-01 | `resolveRootCandidates` returns correct candidates for SPX/SPXW underlying | unit + fast-check | `bun run test -- packages/core/src/journal/domain/occ-root.test.ts` | ❌ Wave 0 |
| HIST-01 | `resolveLegSnapshot` finds back-leg data under SPXW root when `calendar.underlying='SPX'` | contract (postgres + memory) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | extend existing |
| HIST-01 | Regression: Nov-20/Nov-30 mixed-root calendar no longer produces a null back leg | unit | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | extend existing |
| HIST-02 | Rebuild derives byte-identical rows to live writer for a fixture slot | unit + fast-check | `bun run test -- packages/core/src/journal/application/rebuildCalendarHistory.test.ts` | ❌ Wave 0 |
| HIST-02 | As-of-slot read port: hit / miss / stale-outside-window | contract (postgres + memory) | `bun run test -- packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` | extend existing |
| HIST-02 | Heal-write port: insert-when-absent / update-when-gap / no-op-when-live (D-03) | contract (postgres + memory) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` | extend existing |
| HIST-03 | Self-heal touches only OPEN calendars, bounded lookback, never overwrites live rows | unit | `bun run test -- packages/core/src/journal/application/selfHealJournal.test.ts` | ❌ Wave 0 |
| HIST-03 | Handler: array-guard, gate decision, chain wiring | unit | `bun run test -- apps/worker/src/handlers/self-heal-journal.test.ts` | ❌ Wave 0 |
| HIST-04 | CLI/job orchestrator: one-calendar mode, all-calendars mode, idempotent re-run, before/after counts | unit (faked deps) | `bun run test -- apps/worker/src/repair-journal-history.test.ts` | ❌ Wave 0 |
| HIST-04 | On-register backfill: newly-registered calendar gets `[openedAt, now]` rows | unit | `bun run test -- packages/core/src/journal/application/registerOpenCalendars.test.ts` | extend existing |
| HIST-05 | Slot rounding: idempotent, rounds down to valid RTH 30-min slot, `event-move` bypasses | unit + fast-check | `bun run test -- packages/core/src/journal/domain/rth-slot.test.ts` | ❌ Wave 0 |
| HIST-05 | Regression: two same-slot runs 10-15 min apart produce ONE row | unit | `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` | extend existing |
| D-09 | Backtest + exit suites stay green after repair changes journal inputs | integration | `bun run test -- packages/core/src/backtest packages/core/src/exits` | existing suites |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/journal/domain/occ-root.test.ts` — HIST-01 root-candidate logic
- [ ] `packages/core/src/journal/application/rebuildCalendarHistory.test.ts` — HIST-02
- [ ] `packages/core/src/journal/application/selfHealJournal.test.ts` — HIST-03
- [ ] `apps/worker/src/handlers/self-heal-journal.test.ts` — HIST-03 handler
- [ ] `apps/worker/src/repair-journal-history.test.ts` — HIST-04 CLI/job
- [ ] Slot-rounding pure function + test — HIST-05
- [ ] Framework install: none — Vitest/fast-check/testcontainers all present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Diagnostic SQL against prod: does SPXW-rooted back-leg data exist in leg_observations? | HIST-01 | Live prod DB read — needs operator/orchestrator approval outside auto mode | Run RESEARCH §Root Cause Chain diagnostic queries 1-2 before locking repair expectations |
| One-time prod repair run + before/after coverage counts | HIST-04 | Writes to prod journal — operator-executed after deploy (D-10) | Trigger repair job post-deploy; record per-calendar rows/non-gap/days-covered before vs after |
| Lifecycle chart shows healed series for both open calendars | HIST-02/03 | Visual confirmation on morai.wtf | Open Journal → 7600P/7200P; greek/vol/price panels render non-gap runs for Jul 6-8 window (where archive has both legs) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
