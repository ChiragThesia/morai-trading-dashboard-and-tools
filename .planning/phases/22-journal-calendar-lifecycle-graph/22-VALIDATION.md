---
phase: 22
slug: journal-calendar-lifecycle-graph
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `22-RESEARCH.md` → `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.8` + fast-check `^4.8.0` (root `package.json`, project-wide standard) |
| **Config file** | Root Vitest workspace config (existing — same config every prior phase uses) |
| **Quick run command** | `bunx vitest run packages/core/src/journal/domain/attribution.test.ts packages/core/src/journal/domain/fwd-vol.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~5s per domain test file; full workspace suite ~minutes |

---

## Sampling Rate

- **After every task commit:** Run `bunx vitest run <touched test file>` (domain-only files <5s)
- **After every plan wave:** Run `bun run test` (full workspace suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds (per-task domain tests)

---

## Per-Task Verification Map

> Task IDs (`22-01-01` …) are populated against PLAN.md task frontmatter after planning.
> The requirement→behavior→test rows below are lifted verbatim from RESEARCH `## Validation Architecture`
> and MUST each map to at least one plan task's `<automated>` verify.

| Requirement | Behavior | Test Type | Automated Command | File | Status |
|-------------|----------|-----------|-------------------|------|--------|
| JRNL-01 | Forward-vol negative-radicand guard never returns NaN, tags `"inverted"` | unit + fast-check property | `bunx vitest run packages/core/src/journal/domain/fwd-vol.test.ts` | ❌ W0 | ⬜ pending |
| JRNL-01 | Forward-vol radicand-exactly-0 is `"ok"` with `forwardVol: 0` | unit example | same file | ❌ W0 | ⬜ pending |
| JRNL-01 | Attribution accumulation identity: Σ(theta+vega+deltaGamma+residual) over any non-gap span == `pnlOpen[end]-pnlOpen[start]` exactly | fast-check property | `bunx vitest run packages/core/src/journal/domain/attribution.test.ts` | ❌ W0 | ⬜ pending |
| JRNL-01 | Gap detection: `spot="0"` OR non-finite greek/IV → `isGap:true`; gap intervals skipped, never zero-filled | unit examples | same file | ❌ W0 | ⬜ pending |
| JRNL-01 | `getCalendarLifecycle`: `ok(null)` unknown id, `ok([])` passthrough, `err(StorageError)` propagation | unit w/ in-memory `ForReadingJournal` double | `bunx vitest run packages/core/src/journal/application/getCalendarLifecycle.test.ts` | ❌ W0 | ⬜ pending |
| JRNL-01 | `GET /api/journal/:calendarId/lifecycle` — 404 unknown, 200 enriched shape, JWT-gated group | integration (mirror `journal.routes.test.ts`) | `bunx vitest run apps/server/src/adapters/http/journal.routes.test.ts` | ❌ W0 (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/journal/domain/fwd-vol.test.ts` — JRNL-01 forward-vol guard
- [ ] `packages/core/src/journal/domain/attribution.test.ts` — JRNL-01 accumulation identity + gap handling
- [ ] `packages/core/src/journal/application/getCalendarLifecycle.test.ts` — JRNL-01 use-case wiring
- [ ] Extend `apps/server/src/adapters/http/journal.routes.test.ts` (or sibling) — JRNL-01 route contract
- Framework install: none — Vitest + fast-check already present project-wide.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Crosshair sync between hero chart hover and `PnlBridgeCard` ("as of {day}" label swap) | JRNL-01 | Visual/interaction behavior, not meaningfully unit-testable | chrome-devtools UAT: hover the hero panel, confirm rail "as of" label + crosshair track across all panels |
| Line-break rendering at feed gaps (never interpolated) across all 5 panel types | JRNL-01 | SVG rendering correctness needs visual inspection (underlying `isGap` boolean IS unit-tested) | chrome-devtools UAT: load a calendar with sparse early snapshots, confirm breaks not straight-line interpolation |

*Both flagged `human_needed` at the phase gate, consistent with `human_verify_mode: "end-of-phase"` and the standing chrome-devtools UAT permission (memory `morai-gsd-uat-ui-chrome-devtools`).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
