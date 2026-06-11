---
phase: 2
slug: market-data-bsm-engine
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-10
updated: 2026-06-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (root `vitest.config.ts` with `test.projects`) + fast-check + msw + testcontainers |
| **Config file** | `vitest.config.ts` (root) + per-package `packages/*/vitest.config.ts`, `apps/*/vitest.config.ts` (worker config created in Plan 02-01) |
| **Quick run command** | `bunx vitest run <changed package filter>` |
| **Full suite command** | `bun run test` (Postgres tests: `TEST_DATABASE_URL=postgres://test:test@localhost:55432/morai_test` against `docker run -p 55432:5432 postgres:16` if testcontainers stalls locally) |
| **Estimated runtime** | ~60 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run quick command for the touched package
- **After every plan wave:** Run `bun run test` + `bun run typecheck && bun run lint`
- **Before `/gsd-verify-work`:** Full suite must be green, 0 skipped
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> One row per task across all 7 plans. Automated Command mirrors each task's `<verify><automated>` element. TDD plans (02-02, 02-03) are single-feature plans — one row each. Test files marked "created in task (RED)" are written as the failing test inside the task itself per TDD red→green; they do not pre-exist.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 0 | MKT-01 (prep) | T-02-SC | Package legitimacy verified by human before any install | human checkpoint (blocking) | — (checkpoint:human-verify; exempt from automated rule) | n/a | ⬜ pending |
| 02-01-T2 | 02-01 | 0 | MKT-01 (prep) | T-02-SC | Pinned versions; no @types/pg-boss; no postinstall surprises | import smoke check | `cd apps/worker && bun -e "import('pg-boss').then(()=>console.log('pgboss-ok'))" && cd ../../packages/adapters && bun -e "import('msw/node').then(()=>console.log('msw-ok'))"` | created in task | ⬜ pending |
| 02-01-T3 | 02-01 | 0 | MKT-01 (prep) | T-02-01 | Fixture trimmed (<100 KB), human-reviewed, no secrets | fixture validation script | `cd packages/adapters && bun -e "const f=require('./test/fixtures/cboe-spx.fixture.json'); if(!f.timestamp||!Array.isArray(f.data.options)||f.data.options.length<20) throw new Error('bad fixture'); console.log('fixture-ok', f.data.options.length)"` | created in task | ⬜ pending |
| 02-02-F | 02-02 | 1 | BSM-02 | T-02-03 | Numerical correctness gated by calibration fixtures + invariants | fast-check + calibration unit (TDD) | `bunx vitest run packages/core/src/journal/domain/bsm.test.ts` | created in task (RED) | ⬜ pending |
| 02-03-F | 02-03 | 2 | BSM-01 | T-02-05, T-02-06 | Bounded iterations (no infinite loop); degenerate inputs → typed err, never NaN | fast-check property (TDD) | `bunx vitest run packages/core/src/journal/domain/iv-inversion.test.ts` | created in task (RED) | ⬜ pending |
| 02-04-T1 | 02-04 | 2 | MKT-01 | T-02-07, T-02-10 | Zod safeParse at adapter boundary; Result.err never throw; no payload dumps in errors | msw adapter + shared contract | `bunx vitest run packages/adapters/src/http/cboe.test.ts packages/adapters/src/memory/chain.contract.test.ts` | created in task (RED) | ⬜ pending |
| 02-04-T2 | 02-04 | 2 | MKT-03 | T-02-08, T-02-09 | DTE/strike filter bounds write volume; Drizzle parameterized SQL only | testcontainers + in-memory unit | `TEST_DATABASE_URL=${TEST_DATABASE_URL:-postgres://test:test@localhost:55432/morai_test} bunx vitest run packages/adapters/src/postgres/repos/leg-observations.contract.test.ts packages/core/src/journal/application/fetchChain.test.ts` | created in task (RED) | ⬜ pending |
| 02-05-T1 | 02-05 | 3 | MKT-02 | T-02-11, T-02-12, T-02-13 | FRED_API_KEY never logged; fallback returns ok (never blocks compute); '.' rows filtered | msw adapter + shared contract | `bunx vitest run packages/adapters/src/http/fred.test.ts packages/adapters/src/memory/rate.contract.test.ts` | created in task (RED) | ⬜ pending |
| 02-05-T2 | 02-05 | 3 | MKT-02 | T-02-14 | Parameterized upsert on date PK; no raw interpolation | testcontainers + in-memory unit | `TEST_DATABASE_URL=${TEST_DATABASE_URL:-postgres://test:test@localhost:55432/morai_test} bunx vitest run packages/adapters/src/postgres/repos/rate-observations.contract.test.ts packages/core/src/journal/application/fetchRate.test.ts` | created in task (RED) | ⬜ pending |
| 02-06-T1 | 02-06 | 4 | BSM-03 (D-04 support) | — | Pure function; injected clock (no Date.now in core) | unit (TDD) | `bunx vitest run packages/core/src/journal/domain/dte.test.ts` | created in task (RED) | ⬜ pending |
| 02-06-T2 | 02-06 | 4 | BSM-03 | T-02-15, T-02-16, T-02-17 | NaN stamp removes failed rows from rescan; bsm-write touches only bsm_* columns; vendor columns immutable | testcontainers + in-memory unit | `TEST_DATABASE_URL=${TEST_DATABASE_URL:-postgres://test:test@localhost:55432/morai_test} bunx vitest run packages/adapters/src/postgres/repos/leg-observations.contract.test.ts packages/core/src/journal/application/computeBsmGreeks.test.ts` | created in task (RED) | ⬜ pending |
| 02-07-T1 | 02-07 | 5 | (sched) / D-10 | T-02-19, T-02-20 | pgboss.job SELECT-only; no stack traces in HTTP/MCP status output; first-deploy empty → "none yet" | unit + contract (HTTP + MCP, MCP-02) | `bunx vitest run packages/core/src/journal/domain/rth-window.test.ts packages/contracts/src/status.test.ts packages/core/src/journal/application/getStatus.test.ts apps/server/src/adapters/http/status.routes.test.ts apps/server/src/adapters/mcp/mcp.test.ts` | created in task (RED) | ⬜ pending |
| 02-07-T2 | 02-07 | 5 | (sched) | T-02-18, T-02-21 | Empty job payload + `([job])` guard; config values (FRED_API_KEY) never logged | unit + typecheck | `bunx vitest run apps/worker/src/handlers/fetch-cboe-chain.test.ts && bun run typecheck` | created in task (RED) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Planned in Plan 02-01 (wave 0); boxes are ticked at execution, not planning. `wave_0_complete` stays false until 02-01 executes.

- [ ] Live CBOE endpoint smoke check — confirm `_SPX.json` content + whether SPXW contracts require `_SPXW.json` (research open question #1) before adapter TDD starts → **planned: Plan 02-01 Task 3**
- [ ] Recorded CBOE fixture payload committed for msw tests → **planned: Plan 02-01 Task 3**

Additional Wave 0 infrastructure (planned: Plan 02-01 Tasks 1–2):

- [ ] pg-boss installed in `apps/worker` (behind blocking-human legitimacy checkpoint)
- [ ] msw installed in `packages/adapters` devDependencies
- [ ] `apps/worker/vitest.config.ts` created so the root `apps/*/vitest.config.ts` glob discovers worker handler tests

*Existing infrastructure (Vitest 4 projects, fast-check, testcontainers harness, TEST_DATABASE_URL escape hatch) covers all other phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production `lastJobRuns` shows successful `fetch-cboe-chain`; `leg_observations` has `source='cboe'` rows | MKT-03 / SPEC AC-7 | Needs deployed Railway worker + live RTH window | Deploy, wait for RTH 30-min slot, `curl /api/status`, query Supabase (Plan 02-07 output notes this is deferred to /gsd-verify-work) |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (sole exception: 02-01-T1, a `checkpoint:human-verify` gate — exempt by definition)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every auto/tdd task has one)
- [x] Wave 0 covers all MISSING references (pg-boss, msw, worker vitest project, CBOE fixtures — all in Plan 02-01)
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 90s (per-task commands are package-scoped; full suite ~60s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** gsd-planner — 2026-06-11 (revision pass; map filled from plan `<verify><automated>` elements)
