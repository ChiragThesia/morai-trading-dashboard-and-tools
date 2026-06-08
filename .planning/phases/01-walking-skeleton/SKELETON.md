# Walking Skeleton — Morai (Trading Dashboard & Tools)

**Phase:** 1
**Generated:** 2026-06-08

## Capability Proven End-to-End

A request — `GET /api/status` over HTTP or the `get_status` tool over MCP — flows from a driving
adapter through the `get_status` application use-case in the pure hexagon, into the `calendars`
repository port backed by a real Supabase Postgres (a live DB ping), and back as a single
`statusResponse` payload — running in production on Railway, reachable by both curl and Claude Code.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monorepo / runtime | Bun workspaces (`packages/{shared,contracts,core,adapters}` + `apps/{server,worker}`), one root `bun.lock` | One lockfile, one test runner, TS-direct execution; cross-package imports via `@morai/*` workspace symlinks (FND-01) |
| Boundary enforcement | `eslint-plugin-boundaries` v6 flat config, `mode:"full"` + `no-restricted-imports` for vendor packages in core | Hexagon dependency law fails the build, not just review; `core → shared` only (FND-02, D-04) |
| Type safety | `tsconfig.base.json` strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; ESLint no-any/no-as/no-non-null | Unsafe TS rejected mechanically (FND-03) |
| Hexagon | Fine-grained function-type ports (`ForVerbingNoun`), `makeXxx(deps)` factories; in-memory twin per driven port | Test doubles are plain functions; fast TDD; swap-friendly (hexagonal-ddd.md) |
| Data layer | Postgres 16 (Supabase, plain Postgres — D18) + Drizzle ORM + `postgres.js` driver, DIRECT/session connection | Drizzle is an ORM not a driver; postgres.js keeps any Postgres swappable; direct conn required for migrations + future pg-boss (D-05) |
| Migrations | drizzle-kit generated SQL + boot-time `migrate()` over a `max:1` direct client, idempotent via `__drizzle_migrations` | File-tracked, per-file transaction, safe across Railway restarts (DATA-02) |
| API surface | Hono, route law = Zod-validate → use-case → map Result → respond; routes carry zero business logic | Runtime-portable; contracts shared with future web client (api-design.md) |
| MCP surface | `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` (stateless) mounted at `/mcp` on the same Hono server via `fetch-to-node` bridge, bearer-protected | One Railway service serves API+MCP; fetch-to-node@2.1.0 bridges Web Fetch ↔ Node req/res (RESEARCH Pattern 4); `@modelcontextprotocol/hono` alpha avoided |
| Contracts (MCP-02) | ONE `statusResponse` Zod schema in `packages/contracts`; both HTTP route + MCP tool derive from it | One-sided drift fails typecheck; every use-case ships both adapters from day one (MCP-02) |
| Config | Zod-parse `process.env` ONCE at each composition root; fail boot loudly naming the missing var | Typed config flows inward; no scattered env reads (DATA-04) |
| Deployment | Two Railway services (server, worker) + Supabase Postgres; GitHub-connected auto-deploy on `main`; Nixpacks builder (Dockerfile fallback) | Compute/DB/host are swap-friendly boundaries; CI gates deploy on green (D-01, D-02, D-03) |
| Directory layout | `packages/core/src/<context>/{domain,application}` per bounded context; driven adapters by technology in `packages/adapters/src/<tech>/`; driving adapters inside `apps/*/src/adapters/` | Matches monorepo-layout.md + hexagonal-ddd.md; first context is `journal` |

## Stack Touched in Phase 1

- [x] Project scaffold — Bun workspaces, strict tsconfig, ESLint flat config (boundaries + strict-TS), Vitest workspace, root scripts (plan 01)
- [x] Routing — real `GET /api/status` Hono route + `/mcp` MCP endpoint (plan 05)
- [x] Database — real read AND write path: Drizzle schema (7 tables), idempotent migrator, `calendars` Postgres repo with a live DB ping (plans 04, 05)
- [x] Interaction wired to the API — MCP `get_status` tool callable from Claude Code, returning the same payload as the HTTP route (plans 05, 06)
- [x] Deployment — two Railway services on real Supabase, live prod status URL + registered MCP endpoint; documented local run via `bun run dev` (plan 06)

## Out of Scope (Deferred to Later Slices)

These are explicitly NOT in the skeleton — this list prevents later phases from re-litigating Phase 1's minimalism:

- CBOE / FRED / Schwab market-data adapters and the BSM engine (Phase 2 / Phase 4).
- Calendar registration, the `snapshot-calendars` job, and the journal read surface (Phase 3 — the MVP anchor).
- Every repository other than `calendars` (snapshots, leg_observations, contracts, fills, orders, rates) — built in the phase that needs each. Their TABLES exist in the schema this phase; their REPOS do not.
- Real background jobs / pg-boss queue + schedules (Phase 5) — the worker only boots + migrates + idles this phase.
- `broker_tokens` table + token encryption + `TOKEN_ENCRYPTION_KEY` (Phase 4) — status reports token/job sections as the literal "none yet".
- Derived analytics: skew, term-structure (Phase 6).
- Web UI (`apps/web`) + Vercel (D19) — not scaffolded this phase.
- Supabase-native Realtime / Auth / RLS (D18) — Supabase used as plain Postgres only.
- The Supabase 6543 transaction pooler — `DATABASE_POOL_URL` is optional and unused this phase.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2 — Market Data & BSM Engine:** CBOE SPX chain in through `ForFetchingChain` (Zod-parsed) into `leg_observations`; a property-tested BSM IV-inversion + greeks engine. Reuses the contract-test harness for new repos.
- **Phase 3 — Calendar Journal (MVP):** register a calendar via `POST /api/calendars`; the `snapshot-calendars` job writes 30-min RTH journal rows; `GET /api/journal/:id` + MCP `get_journal` read the series. The MVP anchor.
- **Phase 4 — Schwab Auth & Brokerage:** OAuth two-app flow, encrypted `broker_tokens`, Schwab chain + positions behind the same ports as CBOE; `AUTH_EXPIRED` degrades gracefully.
- **Phase 5 — Jobs, Fill Rebuild & Integrity:** full pg-boss `JobQueue` port with dedupe + idempotent handlers; `sync-fills` pairs fills into OPEN/CLOSE; `rebuild-journal` reconstructs history from fills.
- **Phase 6 — Derived Analytics:** `compute-analytics` writes skew + term-structure observations; `GET /api/analytics/*` + MCP `get_skew`/`get_term_structure`.
