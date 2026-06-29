---
phase: 13
slug: cot-adapter
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-28
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace) + fast-check + testcontainers (real Postgres) + msw |
| **Config file** | `vitest.workspace.ts` (existing) |
| **Quick run command** | `bun run test -- <file>` |
| **Full suite command** | `bun run test && bun run typecheck && bun run lint` |
| **Estimated runtime** | ~30–90s (testcontainers boot dominates) |

---

## Validation Requirements

| Requirement | Behavior to prove | Test kind | How |
|---|---|---|---|
| **COT-01** | `fetch-cot` upserts one row/week; `as_of`=report's Tuesday date, `published_at`=fetch time | testcontainers (real PG) | insert a parsed week → assert row shape + dates |
| **COT-01** | **Idempotent** — second run for same `as_of` week = 0 duplicate rows | testcontainers | re-insert same `as_of` → row count unchanged (UNIQUE(contract_code, as_of) + ON CONFLICT) |
| **COT-01** | CFTC adapter parses live Socrata shape (strings→numbers, E-mini `13874A`, date field) | msw | mock `gpe5-46if.json` with captured fixture; assert Zod coercion + `$where` + error path (Result, no throw) |
| **COT-02** | `cot` Zod contract round-trips; net = long − short invariant | fast-check + example | property test over `cotSeriesEntry` |
| **COT-02 / MCP-02** | `GET /api/analytics/cot` returns the contract array; `get_cot` returns identical payload | route + MCP test | shared schema asserted on both surfaces |
| Port law | `ForFetchingCotReport` has an in-memory twin used by a use-case test (same PR) | unit | memory adapter + use-case |

---

## Wave 0 (infrastructure to install first)

- [ ] Capture a real CFTC Socrata JSON fixture for `13874A` (one week) → `packages/adapters/**/__fixtures__/cot-tff-emini.json` (strings-as-numbers, real field names).

*Existing infrastructure (Vitest/testcontainers/msw/fast-check) covers everything else.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First real Friday-17:00-ET run lands a fresh row in prod | COT-01 | Depends on the live CFTC weekly release + prod cron | After a Friday release, query `cot_observations` / `get_cot` → newest `as_of` is the latest Tuesday |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers the Socrata fixture
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
