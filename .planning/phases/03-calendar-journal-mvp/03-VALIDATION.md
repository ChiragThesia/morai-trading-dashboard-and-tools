---
phase: 3
slug: calendar-journal-mvp
status: draft
nyquist_compliant: true
wave_0_complete: true
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
| 03-01-01 | 01 | 1 | CAL-01/02/04 | T-03-01 | Calendar type cannot widen optionType/strike | typecheck | `bun run typecheck` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 1 | CAL-01 | T-03-02 | option_type migration generated + schema column | unit | `rg option_type packages/adapters/src/postgres/migrations` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 1 | CAL-01 | T-03-02/03 | live schema push applied + idempotent | manual | `bun run migrate` | ✅ | ⬜ pending |
| 03-03-01 | 03 | 2 | CAL-01/04 | T-03-04 | Zod rejects bad optionType/strike; backExpiry rule | unit | `bun run test --run calendar.test registerCalendar.test closeCalendar.test` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | CAL-01/04 | T-03-04/05 | parameterized insert; register/list/close round-trip | integration | `bun run test --run calendars.contract` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | CAL-01/04 | T-03-06 | route error bodies flat; 201/400/404/409 mapping | unit | `bun run test --run calendar.routes.test` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 3 | CAL-05 | T-03-08 | isNyseHoliday true/false on 2026-2027 dates | unit | `bun run test --run nyse-holidays.test` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 3 | CAL-05 | T-03-08 | fetch handler no-op on holiday/weekend | unit | `bun run test --run fetch-cboe-chain.test` | ✅ | ⬜ pending |
| 03-05-01 | 05 | 4 | CAL-02 | T-03-13 | net-greek math + NaN-leg continuity + pnlOpen property | unit | `bun run test --run snapshotCalendars.test` | ❌ W0 | ⬜ pending |
| 03-05-02 | 05 | 4 | CAL-02/04 | T-03-10/13 | idempotent persist + leg resolution + NaN insert | integration | `bun run test --run calendar-snapshots.contract` | ❌ W0 | ⬜ pending |
| 03-05-03 | 05 | 4 | CAL-04 | T-03-10 | D-04 targeted-fetch persists out-of-band leg | unit | `bun run test --run fetchChain.test` | ✅ | ⬜ pending |
| 03-05-04 | 05 | 4 | CAL-05 | T-03-11/12 | snapshot handler RTH+holiday no-op; chain trigger | unit | `bun run test --run snapshot-calendars.test` | ❌ W0 | ⬜ pending |
| 03-06-01 | 06 | 5 | CAL-03/MCP-01 | T-03-16 | journal/analytics contracts validate snapshot row | unit | `bun run test --run journal.test` | ❌ W0 | ⬜ pending |
| 03-06-02 | 06 | 5 | MCP-01 | T-03-14 | getLatestLegObs latest-by-time + miss | integration | `bun run test --run leg-observations.contract` | ✅ | ⬜ pending |
| 03-06-03 | 06 | 5 | CAL-03 | T-03-14/15/16 | journal route ordered/404/empty/500 | unit | `bun run test --run journal.routes.test` | ❌ W0 | ⬜ pending |
| 03-07-01 | 07 | 6 | MCP-01 | T-03-19/20/21 | six tools schema-valid; typed-empty; no trigger_job | unit | `bun run test --run mcp.test` | ✅ | ⬜ pending |
| 03-07-03 | 07 | 6 | MCP-01 | T-03-18 | live MCP round-trip matches HTTP (manual UAT) | manual | human-check (Claude Code) | n/a | ⬜ pending |

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
