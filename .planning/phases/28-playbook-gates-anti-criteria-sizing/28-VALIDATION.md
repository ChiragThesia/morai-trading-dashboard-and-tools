---
phase: 28
slug: playbook-gates-anti-criteria-sizing
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
---

# Phase 28 — Validation Strategy

> Per-phase validation contract. Derived from 28-RESEARCH.md `## Validation Architecture` + the 6 committed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace + fast-check + testcontainers |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `bun run test -- <touched test file>` |
| **Full suite command** | `bun run test` (~2626 tests pre-phase) |
| **Estimated runtime** | ~165 s full suite |

---

## Sampling Rate

- **After every task commit:** targeted test file(s)
- **After every plan wave:** full suite + typecheck (gate wiring touches LIVE picker use-case)
- **Before `/gsd-verify-work`:** full suite green + lint clean
- **Max feedback latency:** ~165 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 28-01-* | 01 | 1 | PLAY-01 | flapping, silent-blind | resolveEntryGate: block ≥25 / re-open <24; ratio ≥0.95 / <0.93; penalty band below block; GATE BLIND >3 bizdays (NYSE-holiday aware) fail-closed; fast-check no-flap + band no-gap/overlap | unit + fast-check | `bun run test -- packages/core/src/picker/domain/entry-gate.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-* | 02 | 1 | PLAY-02 | — | ForReadingRecentClosedCalendars correct rows vs real Postgres; max-open trips at exactly 6; cooldown trips ≥25% loss for exactly 2 bizdays | unit + contract (testcontainers) | `bun run test -- packages/core/src/picker/domain/brakes.test.ts packages/adapters/src/postgres/repos/calendar-events.contract.test.ts` | ❌ W0 + ✅ extend | ⬜ pending |
| 28-03-* | 03 | 2 | PLAY-01/02 | per-candidate regression | Gate evaluated ONCE per cohort at use-case level; blocked cohort → candidates:[] + gate state in payload; snapshot gate field round-trips Zod; self-read hysteresis vs previous snapshot | unit | `bun run test -- packages/core/src/picker/application/computePickerSnapshot.test.ts packages/contracts/src/picker.test.ts` | ✅ extend | ⬜ pending |
| 28-04-* | 04 | 3 | PLAY-03/05 | derived-optimum creep | Sizing tier lookup exact at boundaries (shared ladder); counts are named constants never computed; autoTune tilt clamped to band or documented defer | unit + fast-check | `bun run test -- packages/core/src/picker/domain/sizing.test.ts` | ❌ W0 | ⬜ pending |
| 28-05-* | 05 | 4 | PLAY-04 | — | selectEventCandidates only [3,10]d gap + owned back event; event registry weights sum 100 (own invariant test); primary registry untouched | unit | `bun run test -- packages/core/src/picker/domain/candidate-selection.test.ts packages/core/src/picker/domain/event-rules.test.ts` | ✅ extend + ❌ W0 | ⬜ pending |
| 28-06-* | 06 | 5 | PLAY-01/03/04 | silent-blind UI | Board gate chip incl. loud GATE BLIND state; Analyzer sizing count render; event-bucket label distinct | RTL | `bun run test -- apps/web/src/components/RegimeBoard.test.tsx apps/web/src/screens/Analyzer.test.tsx` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

TDD RED-first tasks create: entry-gate.test.ts, brakes.test.ts, sizing.test.ts, event-rules.test.ts. Framework installed; no Wave 0 install.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gate state visible on live board + snapshot | PLAY-01 | Prod state | post-deploy: board shows gate chip; psql picker_snapshot payload has gate field next cycle |
| [ASSUMED] boundaries confirmation (penalty widths, sizing default counts, event-bucket weight) | PLAY-03/04 | User judgment | UAT checkpoint in 28-06 — user confirms or adjusts constants |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 165s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09
