---
phase: 04-schwab-auth-brokerage
plan: "01"
subsystem: brokerage
tags: [oauth, pgcrypto, drizzle, tdd, brokerage-ports, token-freshness]
dependency_graph:
  requires: []
  provides:
    - brokerage bounded context ports (AppId, SchwabTokenRow, AppTokenStatus, TokenFreshnessMap, AuthExpiredError, ForReadingTokens, ForWritingTokens, ForReadingTokenFreshness)
    - pure token-freshness domain (isTokenExpired, isTokenStale, toAppTokenStatus)
    - broker_tokens Drizzle schema with bytea encrypted columns
    - 0003_broker_tokens.sql migration with pgcrypto prologue (not yet applied — Task 5 deferred)
    - makeMemoryBrokerTokensRepo in-memory twin
    - TOKEN_ENCRYPTION_KEY + SCHWAB_* env var config requirements
  affects:
    - packages/core/src/index.ts (new brokerage exports)
    - packages/adapters/src/index.ts (new memory twin export)
    - apps/server/src/config.ts (7 new required fields)
    - apps/worker/src/config.ts (7 new required fields)
tech_stack:
  added:
    - oauth-callback@2.2.0 (npm — legitimacy OK: kriasoft, 4.2k dl/wk, no postinstall)
    - open@11.0.0 (npm — legitimacy OK: sindresorhus, 115M dl/wk, no postinstall)
  patterns:
    - Drizzle customType<{data:string;driverData:Buffer}> for bytea pgcrypto columns (RESEARCH open question A6 resolved)
    - TDD red→green for token-freshness domain
    - ForVerbingNoun port convention in brokerage bounded context
key_files:
  created:
    - packages/core/src/brokerage/application/ports.ts
    - packages/core/src/brokerage/domain/token-freshness.ts
    - packages/core/src/brokerage/domain/token-freshness.test.ts
    - packages/core/src/brokerage/index.ts
    - packages/adapters/src/memory/broker-tokens.ts
    - packages/adapters/src/postgres/migrations/0003_broker_tokens.sql
    - packages/adapters/src/postgres/migrations/meta/0003_snapshot.json
  modified:
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/index.ts
    - apps/server/src/config.ts
    - apps/worker/src/config.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/config.test.ts
    - docs/architecture/data-model.md
    - package.json / bun.lock
    - packages/adapters/src/postgres/migrations/meta/_journal.json
decisions:
  - "bytea customType uses customType<{data:string;driverData:Buffer}> from drizzle-orm/pg-core with dataType()='bytea' — round-trip tested in plan 04-02 testcontainers (RESEARCH A6)"
  - "Migration file renamed from drizzle-kit generated 0003_famous_azazel to 0003_broker_tokens for readability; journal updated to match"
  - "pgcrypto CREATE EXTENSION hand-prepended as first SQL statement — drizzle-kit does not emit it automatically"
  - "makeMemoryBrokerTokensRepo accepts injectable getNow clock param for testability"
  - "Cross-context import of StorageError + FetchError from journal/application/ports.ts is allowed (application port type, not domain/ sub-path)"
metrics:
  duration_minutes: 7
  completed_date: "2026-06-20"
  tasks_completed: 4
  tasks_deferred: 1
  files_changed: 18
---

# Phase 04 Plan 01: Brokerage Foundation — Summary

JWT-style brokerage foundation: install two legitimacy-gated OAuth packages, define the `brokerage` bounded context with pure token-freshness domain (TDD), add `broker_tokens` Drizzle schema with bytea pgcrypto columns, generate the migration with pgcrypto prologue, ship the in-memory twin, and require 7 new Schwab/encryption env vars in both app configs.

## Tasks Completed

| # | Task | Commit | Key Artifacts |
|---|------|--------|---------------|
| 1 | Install OAuth packages + extend configs | 877e052 | oauth-callback, open in package.json; 7 Schwab/encryption fields in server + worker configSchema |
| 2 (RED) | Failing token-freshness tests | 6664f0f | token-freshness.test.ts — 8 behaviors |
| 2 (GREEN) | Brokerage ports + domain + core barrel | 3d3480d | ports.ts, token-freshness.ts, brokerage/index.ts, core/src/index.ts extended |
| 3 | broker_tokens schema + memory twin + doc | 95679b1 | schema.ts brokerTokens table, memory/broker-tokens.ts, data-model.md |
| 4 | broker_tokens migration + pgcrypto prologue | b8bfd7e | 0003_broker_tokens.sql, meta/_journal.json, meta/0003_snapshot.json |

## Deferred — Live Action Required

**Task 5: [BLOCKING] Push migration to the live DB + provision TOKEN_ENCRYPTION_KEY**

**Status:** DEFERRED — no DATABASE_URL available at execution time. Code is complete; only the live DB push is pending.

**Command to run:**
```bash
bun run migrate
```

**Prerequisites:**
1. Set `TOKEN_ENCRYPTION_KEY` (32+ random chars) in `.env` and Railway secrets.
2. Set six `SCHWAB_TRADER_*/SCHWAB_MARKET_*` vars from the already-registered apps (D-05).
3. Run `bun run migrate` — executes `apps/worker/src/migrate.ts` → Drizzle migrator picks up `0003_broker_tokens` via `meta/_journal.json` idx-3.

**Acceptance check (must all pass before plan 04-02):**
```bash
psql "$DATABASE_URL" -c "SELECT 1 FROM pg_extension WHERE extname='pgcrypto'"
# → 1 row

psql "$DATABASE_URL" -c "\d broker_tokens"
# → access_token / refresh_token typed 'bytea', app_id is PK

bun run migrate
# → second run is a clean no-op (idempotent)
```

**Blocks:** Plan 04-02 (Postgres broker-tokens repo + pgcrypto round-trip test requires the table to exist).

## TDD Gate Compliance

RED gate: `test(04-01)` commit `6664f0f` — token-freshness.test.ts (8 behaviors, all failing at module-not-found)
GREEN gate: `feat(04-01)` commit `3d3480d` — implementation; all 8 tests pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated test fixtures in existing tests for new required config fields**

- **Found during:** Task 1 — typecheck failed after adding 7 required fields to configSchema
- **Issue:** `apps/server/src/adapters/mcp/mcp.test.ts` and `apps/server/src/config.test.ts` both used partial config objects missing the new required fields; TypeScript `satisfies Config` guard caught this
- **Fix:** Added 7 Schwab/encryption placeholder fields to both test fixtures
- **Files modified:** `apps/server/src/adapters/mcp/mcp.test.ts`, `apps/server/src/config.test.ts`
- **Commit:** 877e052

**2. [Rule 1 - Deviation] Migration file renamed from drizzle-kit generated name to 0003_broker_tokens**

- **Found during:** Task 4 — drizzle-kit generated `0003_famous_azazel.sql`
- **Issue:** Plan specifies `0003_broker_tokens.sql` as the canonical name; journal tag updated to match
- **Fix:** Renamed SQL file; updated `meta/_journal.json` tag from `0003_famous_azazel` to `0003_broker_tokens`
- **Commit:** b8bfd7e

## Known Stubs

None — this plan is a pure foundation layer (ports, schema, migration, config). No data flows to UI yet; stubs are architecturally appropriate until 04-02 wires the Postgres repo.

## Threat Flags

No new threat surface introduced beyond what was modeled in the plan's `<threat_model>`. The seven new env vars required by config schemas ensure boot fails loud if any secret is absent (T-04-01 mitigated). The `bytea` column type in schema.ts enforces that tokens cannot be accidentally stored as plaintext text columns (T-04-02 foundation).

## Self-Check: PASSED

All key files exist and all per-task commits are present in git history:

| Check | Result |
|-------|--------|
| ports.ts | FOUND |
| token-freshness.ts | FOUND |
| token-freshness.test.ts | FOUND |
| brokerage/index.ts | FOUND |
| memory/broker-tokens.ts | FOUND |
| 0003_broker_tokens.sql | FOUND |
| commit 877e052 (Task 1) | FOUND |
| commit 6664f0f (Task 2 RED) | FOUND |
| commit 3d3480d (Task 2 GREEN) | FOUND |
| commit 95679b1 (Task 3) | FOUND |
| commit b8bfd7e (Task 4) | FOUND |
