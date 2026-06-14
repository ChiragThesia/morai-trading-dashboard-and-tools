---
phase: 3
slug: calendar-journal-mvp
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace; +fast-check, testcontainers, msw) |
| **Config file** | `vitest.config.ts` (workspace root) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~TBD (planner/Nyquist fills after plan breakdown) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test && bun run typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** TBD seconds

---

## Per-Task Verification Map

> Populated by the planner / Nyquist auditor once PLAN.md task IDs exist.
> Source: RESEARCH.md "Validation Architecture" — highest-risk behaviors are
> snapshot idempotency under composite PK `(time, calendar_id)`, NaN-leg row
> continuity (D-06), out-of-band leg fetch (D-04), and holiday/RTH gating (CAL-05).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Existing Vitest infrastructure (218 tests in prod from Phase 2) covers the stack — no framework install needed.
- [ ] Test stubs for CAL-01..05, MCP-01 created during planning per-plan.

*Existing infrastructure covers all phase requirements; per-plan test stubs land with each vertical slice.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP tools reachable from Claude Code over streamable HTTP | MCP-01 | Live MCP transport / Claude Code client interaction | Register calendar, run `list_calendars` + `get_journal` from Claude Code; confirm same series as HTTP route. |

*Automated tests cover register → snapshot → read via HTTP and the shared contracts schema; the live-MCP-client round-trip is UAT.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < TBD s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
