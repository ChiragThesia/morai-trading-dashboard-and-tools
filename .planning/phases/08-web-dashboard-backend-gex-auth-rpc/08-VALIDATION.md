---
phase: 08
slug: web-dashboard-backend-gex-auth-rpc
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-24
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from 08-RESEARCH.md "## Validation Architecture". Per-task map is populated by the planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace mode for fast unit tests; per-package mode for testcontainers) |
| **Config file** | `vitest.config.ts` at workspace root |
| **Quick run command** | `bun run typecheck && bun run test` (workspace, skips testcontainers) |
| **Full suite command** | `cd packages/adapters && bun run test` (Postgres testcontainers integration) |
| **Estimated runtime** | ~30s quick suite; testcontainers adds container spin-up |

---

## Sampling Rate

- **After every task commit:** Run `bun run typecheck && bun run test`
- **After every plan wave:** Run full suite incl. `cd packages/adapters && bun run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (quick suite)

---

## Per-Task Verification Map

*Populated by the planner from PLAN.md tasks. Behavior → test mapping (from research):*

| Behavior | Requirement | Threat Ref | Test Type | Automated Command | File Exists |
|----------|-------------|------------|-----------|-------------------|-------------|
| GEX domain math → oracle (γ-flip ≈ 7488, net ≈ −47, callWall 7600, putWall 7400) | GEX-01 compute | — | unit + property (fast-check) | `bun run test packages/core` | ❌ W0 |
| Snapshot job handler: calls use-case, RTH gate, chain-triggers next | GEX-01 job | — | unit | `bun run test apps/worker` | ❌ W0 |
| Re-run within same cycle → 0 duplicate rows (`onConflictDoNothing` on cycle PK) | GEX-01 / SC-4 | — | integration (testcontainers) | `cd packages/adapters && bun run test` | ❌ W0 |
| `gexSnapshotEntry.parse(oraclePayload)` succeeds | GEX-02 contract | — | unit | `bun run test packages/contracts` | ❌ W0 |
| `AppType` exported; `hc<AppType>()` compiles | RPC-01 | — | typecheck | `bun run typecheck` | ❌ W0 |
| Unauthenticated read endpoint → 401 | AUTH-01 | T-Auth | integration | `bun run test apps/server` | ❌ W0 |
| `WEB_ORIGIN` gets CORS headers; other origin does not | AUTH-01 CORS | T-CORS | integration | `bun run test apps/server` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/analytics/domain/gex.test.ts` — oracle property tests (flip, callWall, putWall, netGamma)
- [ ] `packages/core/src/analytics/application/computeGexSnapshot.test.ts` — use-case with in-memory twin
- [ ] `packages/core/src/analytics/application/getGex.test.ts` — read use-case
- [ ] `packages/contracts/src/gex.test.ts` — contract parse tests
- [ ] `packages/adapters/src/postgres/gex-snapshot.repo.test.ts` — testcontainers migration + insert + read + idempotency
- [ ] `apps/worker/src/handlers/compute-gex-snapshot.test.ts` — handler RTH gate + call flow
- [ ] `apps/server/src/adapters/http/gex.routes.test.ts` — 401 unauth, 200 auth, 404 no-snapshot, CORS headers

*(Exact paths are research recommendations; planner finalizes against actual file layout.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GEX endpoint reproduces live SPX numbers | GEX-01 | Live `leg_observations` data varies; oracle test uses fixed fixture | Hit `get_gex` against prod after a snapshot cycle; sanity-check flip/walls vs market |
| Supabase JWT algorithm is HS256 (not RS256) | AUTH-01 (A1) | Requires Supabase Dashboard access | Dashboard → Settings → API → JWT settings; confirm before auth code lands |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
