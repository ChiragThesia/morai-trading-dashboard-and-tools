# Phase 1: Walking Skeleton - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-07
**Phase:** 1-Walking Skeleton
**Areas discussed:** Deploy + CI, Railway build, Boundary lint, Postgres driver

---

## Deploy + CI pipeline

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub-connected + CI from Phase 1 | Railway auto-deploys from GitHub main; GitHub Actions runs typecheck/lint/test (+ contract test via testcontainers) on PR | ✓ |
| GitHub deploy, CI later | Railway auto-deploys from GitHub, no Actions yet | |
| Local CLI deploy, CI later | `railway up` from local, no GitHub trigger, no Actions | |

**User's choice:** GitHub-connected + CI from Phase 1
**Notes:** GitHub remote already exists (`ChiragThesia/morai-trading-dashboard-and-tools`). CI green effectively gates deploy.

---

## Railway build method

| Option | Description | Selected |
|--------|-------------|----------|
| Nixpacks auto-detect | Railway detects Bun, builds each service zero-config | ✓ |
| Dockerfile per service | Committed Dockerfile for server + worker, full control | |

**User's choice:** Nixpacks auto-detect
**Notes:** Dockerfile retained as documented fallback if monorepo detection is flaky.

---

## Boundary-lint tool

| Option | Description | Selected |
|--------|-------------|----------|
| eslint-plugin-boundaries | Purpose-built for layered/hexagonal architectures, clearest errors | ✓ |
| import/no-restricted-paths | Built into eslint-plugin-import, lighter, terser errors | |

**User's choice:** eslint-plugin-boundaries

---

## Postgres driver

| Option | Description | Selected |
|--------|-------------|----------|
| postgres.js | Drizzle's primary driver, Bun-friendly; direct/session connection sidesteps pooler prepared-statement issue | ✓ |
| node-postgres (pg) | Classic driver, broad ecosystem | |

**User's choice:** postgres.js
**Notes:** User asked why a driver is needed given Supabase. Clarified: Supabase is just managed Postgres (D18); Drizzle is an ORM not a driver and needs a wire-protocol client; `@supabase/supabase-js` (REST/Realtime/Auth SDK) was deliberately rejected to avoid vendor coupling. `postgres.js` + connection string keeps any Postgres swappable.

---

## Claude's Discretion

- MCP transport wiring (`@modelcontextprotocol/sdk` StreamableHTTPServerTransport at `/mcp` on Hono).
- Migrator mechanism (Drizzle boot-time `migrate()`, idempotent via `__drizzle_migrations`).
- Contracts/Zod wiring (one `statusResponse` schema shared by HTTP route + MCP tool).
- Package scope (`@morai/*`), in-memory adapter location.

## Deferred Ideas

- Dockerfile-per-service build (fallback to Nixpacks).
- `@supabase/supabase-js` (Realtime/Auth/RLS) — only on D18 revisit trigger.
- Railway PR preview environments — once pipeline is stable.
