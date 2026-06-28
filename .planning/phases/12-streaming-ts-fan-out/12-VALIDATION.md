---
phase: 12
slug: streaming-ts-fan-out
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-28
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Scaffold — the per-task map, Wave 0, and manual-only rows are populated by the planner
> (from 12-RESEARCH.md § Validation Architecture) and confirmed before /gsd-verify-work.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS: server/contracts/adapters) + pytest (Python sidecar) |
| **Config file** | `vitest.config.ts` per package · `apps/sidecar/pytest.ini` |
| **Quick run command** | `bun run test` (changed pkg) · `apps/sidecar/.venv/bin/python -m pytest` |
| **Full suite command** | `bun run test && (cd apps/sidecar && .venv/bin/python -m pytest)` |
| **Estimated runtime** | ~{fill at plan time} seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the touched package.
- **After every plan wave:** Run the full suite.
- **Before `/gsd-verify-work`:** Full suite green.
- **Max feedback latency:** {fill at plan time} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {populated by planner} | | | STRM-0X | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note (from RESEARCH):** streaming behaviors (LEVELONE updates within 30s of open, ACCT_ACTIVITY
fill within 10s, SSE auth at edge) are partly **manual/RTH-gated** — see Manual-Only below. The
display-only regression (`SELECT count(*) FROM leg_observations` does not grow during a
streaming-only session, STRM-04) IS automatable and must have an automated check.

---

## Wave 0 Requirements

- [ ] {populated by planner — RED scaffolds for STRM contracts (liveGreeks stream payload Zod), ticket store, SSE fan-out unit}

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LEVELONE_OPTION updates logged within 30s of market open | STRM-01 | needs live Schwab stream + RTH | open a position leg, observe sidecar logs at RTH open |
| ACCT_ACTIVITY fill appears within 10s of execution | STRM-02 | needs a live test-account fill | execute a fill in the test account, observe stream |
| ACCT_ACTIVITY MESSAGE_TYPE discovery | STRM-02 | undocumented (RESEARCH) — capture empirically | log raw ACCT_ACTIVITY frames during first RTH UAT |

*Automated where possible; the above are inherently live-market.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency target set
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
