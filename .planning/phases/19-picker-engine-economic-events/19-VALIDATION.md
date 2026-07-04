---
phase: 19
slug: picker-engine-economic-events
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-04
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace) + fast-check (property) + testcontainers (Postgres) + msw (HTTP) |
| **Config file** | vitest.workspace.ts |
| **Quick run command** | `bun run test` (single package: `bun run test --project <pkg>`) |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~90 seconds (full); testcontainers repos add ~cold-start on first run |

---

## Sampling Rate

- **After every task commit:** Run `bun run test` for the touched package
- **After every plan wave:** Run `bun run test` (full workspace)
- **Before `/gsd-verify-work`:** Full suite must be green (`bun run test && bun run typecheck && bun run lint`)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Filled during planning/execution. Numerical code (scoring, FwdIV, BE-vs-EM) MUST carry fast-check
> property tests; the two new Postgres repos (economic_events, picker_snapshot) use testcontainers;
> the FRED events HTTP source uses msw. The FwdIV negative-radicand guard ships as a named property.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | PICK-01 | — | N/A | property | `bun run test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] FRED `release/dates` live-shape spike — hit `release/dates?release_id=10` (CPI) and `release_id=50`
      (NFP) with the wired `FRED_API_KEY` to confirm the forward-dated JSON shape BEFORE finalizing the
      Zod schema (RESEARCH Pitfall 4 / Assumptions A1–A3; fetch tooling was 403-blocked at research time).
- [ ] Property-test scaffolding for `scoreCalendarCandidates` / FwdIV guard / BE-vs-EM (fast-check).

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Analyzer fixture→live swap renders ranked cards with per-card as-of+source, and honest loading/error/empty/stale states | PICK-02 | Visual/UX states over live async data are UAT-verified in the browser | Load Analyzer against a live `picker_snapshot` row; force cold-start (no row), 0-candidate, and stale/missing-context paths; confirm D-16/17/18/19 states render |

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
