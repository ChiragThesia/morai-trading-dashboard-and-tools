---
phase: 42
slug: design-system-consolidation-one-reusable-component-system-fo
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 42 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (workspace) |
| **Config file** | vitest.workspace.ts (root) |
| **Quick run command** | `bun run vitest run apps/web/src/components/system apps/web/src/components/picker apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/Overview.test.tsx` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | quick ~15s · full ~65s |

---

## Sampling Rate

- **After every task commit:** Run the quick command (affected web suites)
- **After every plan wave:** Run `bun run vitest run apps/web` (full web app)
- **Before `/gsd-verify-work`:** Full suite (`bun run test`) must be green + `cd apps/web && bunx tsc --noEmit` at the pre-existing 10-error baseline (catch #29: root typecheck is blind to apps/web)
- **Max feedback latency:** ~65 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1/T2 | 42-01 | 1 | DataTable primitive | — | n/a (client UI) | TDD unit | `bun run vitest run apps/web/src/components/system/DataTable.test.tsx` | planner | ready |
| 02-T1 | 42-02 | 2 | CandidateTable wrapper | — | n/a | regression | `bun run vitest run apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile apps/web/src/components/picker` | existing | ready |
| 03-T1 | 42-03 | 2 | PositionsTable migration | — | n/a | regression | `bun run vitest run apps/web/src/screens/Overview.test.tsx` | existing | ready |
| 04-T1..T3 | 42-04 | 1 | Button consolidation + tokens | — | n/a | regression + smoke | `bun run vitest run apps/web` + manual dialog focus smoke | existing | ready |
| 05-T1/T2 | 42-05 | 3 | docs + phase gate | — | n/a | suite + visual | `bun run test` + tsc baseline + dual-viewport parity | existing | ready |

---

## Notes

- DataTable is the phase's only NEW logic surface — TDD red→green applies (sort cycling,
  aria-sort, selection callbacks, rowTestId, column render dispatch).
- Migration tasks are behavior-preserving: the oracle is the EXISTING test suites
  (Analyzer.test.tsx, AnalyzerMobile.test.tsx, Overview.test.tsx) staying green with
  unchanged assertions wherever testids/copy are preserved.
- Visual parity is human/browser-verified via chrome-devtools at 1512x860 and 2056x1329
  (standing permission) — no page scroll, tables indistinguishable.
- base-ui dialog `render={<Button/>}` clone-merge is a mandatory post-swap smoke test
  (research open question #1) — jsdom cannot prove focus behavior.
