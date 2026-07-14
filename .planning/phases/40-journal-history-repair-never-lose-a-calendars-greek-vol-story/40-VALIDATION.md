---
phase: 40
slug: journal-history-repair-never-lose-a-calendars-greek-vol-story
status: draft
nyquist_compliant: false
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
| (planner fills from task breakdown; the requirement→test map below is the source) | | | | | | | | | |

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
