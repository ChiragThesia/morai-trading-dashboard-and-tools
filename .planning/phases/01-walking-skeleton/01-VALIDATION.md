---
phase: 1
slug: walking-skeleton
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace) on Bun |
| **Config file** | `vitest.workspace.ts` (Wave 0 installs) |
| **Quick run command** | `bun run test` (unit + in-memory adapter suites) |
| **Full suite command** | `bun run test` (includes testcontainers Postgres contract test) |
| **Estimated runtime** | ~10s quick (no Docker) · ~45–60s full (testcontainers Postgres cold start) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test` (quick — in-memory + unit; skip testcontainers via `skipIf(!dockerAvailable)`)
- **After every plan wave:** Run `bun run typecheck && bun run lint && bun run test` (full, including the `calendars` contract test against Postgres)
- **Before `/gsd-verify-work`:** Full suite green + prod smoke checks (status endpoint + MCP registration)
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

Representative mapping (task IDs finalized by the planner). Each Phase 1 requirement has an automated proof except the inherently manual prod-deploy checks.

| Requirement | Test Type | Automated Command / Proof | Manual? |
|-------------|-----------|---------------------------|---------|
| FND-01 (workspaces) | integration | `bun install` clean + `bun run typecheck` resolves cross-package import | no |
| FND-02 (boundary lint) | unit (lint) | fixture: `core` importing an adapter → `bun run lint` exits non-zero | no |
| FND-03 (strict TS) | unit (lint/types) | fixture using `any`/`as`/`!` → `bun run lint`/`typecheck` fails | no |
| FND-04 (shared kernel) | unit + property | Vitest + fast-check: Result, assertDefined, OccSymbol round-trip green | no |
| FND-05 (root scripts) | integration | each of dev/test/typecheck/lint/migrate exits 0 | no |
| DATA-01 (schema) | unit | `drizzle-kit generate` emits migration; composite keys asserted in SQL | no |
| DATA-02 (migrator) | integration | migrate twice → 2nd run applies 0 (testcontainers) | no |
| DATA-03 (calendars repo) | contract | same suite green vs Postgres AND in-memory | no |
| DATA-04 (config) | unit | missing required env → Zod error names var, boot exits non-zero | no |
| DEPLOY-01 (Railway×2) | manual | both services deployed, connected to Supabase | YES |
| DEPLOY-02 (status) | e2e/http | prod `GET /api/status` 200 `db:"ok"`; local DB-down → `db:"down"` | partial |
| DEPLOY-03 (MCP prod) | manual + http | `claude mcp add` registers; `get_status` returns; bad bearer → 401 | partial |
| MCP-02 (one schema) | unit (types) | one-sided `statusResponse` change → `bun run typecheck` fails | no |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Install test stack: `vitest`, `@fast-check/vitest` (or `fast-check`), `testcontainers`, `msw`.
- [ ] `vitest.workspace.ts` aggregating per-package suites.
- [ ] `globalSetup` for the shared testcontainers Postgres (one container, `provide/inject`), `testTimeout`/`hookTimeout` = 60_000.
- [ ] `skipIf(!dockerAvailable)` guard so contract tests skip cleanly without Docker locally.
- [ ] `tsconfig.base.json` (strict) + `eslint.config.js` (flat, eslint-plugin-boundaries `mode:"full"` + no-restricted-imports for vendor packages).

*These bootstrap the harness all later requirements verify against.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Railway provisioning of 2 services on Supabase | DEPLOY-01 | One-time cloud provisioning, needs authenticated accounts | Provision Supabase project + 2 Railway services; confirm both deploys green + worker connects |
| Prod status reachable | DEPLOY-02 | Requires the live prod URL | `curl https://<prod>/api/status` → 200 `db:"ok"` |
| MCP registration in Claude Code | DEPLOY-03 | Interactive `claude mcp add` | `claude mcp add --transport http morai <url>/mcp --header "Authorization: Bearer $MCP_BEARER_TOKEN"`; call `get_status`; verify bad bearer → 401 |

---

## Validation Sign-Off

- [ ] All tasks have an automated verify or a Wave 0 dependency (manual rows limited to cloud-deploy)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test harness, lint/ts config)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner finalizes per-task map)

**Approval:** pending
