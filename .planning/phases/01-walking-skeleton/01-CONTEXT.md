# Phase 1: Walking Skeleton - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

A deployable Bun-workspaces monorepo with the hexagon boundary mechanically enforced, a real
Supabase Postgres reachable through one proven port+adapter pattern (`calendars`), and
`GET /api/status` + MCP `get_status` live in production on Railway — one end-to-end vertical slice
(request → use-case → DB → response). No market data, no BSM, no journal, no real jobs yet.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**13 requirements are locked.** See `01-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `01-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Bun-workspaces monorepo: `packages/{core,adapters,contracts,shared}`, `apps/{server,worker}`.
- Mechanical enforcement: ESLint hexagon boundaries, strict-TS lint + compiler rules.
- `shared` kernel: `Result`, `assertDefined`, `OccSymbol` (tested).
- Full Drizzle schema (7 journal-context tables) + idempotent migrator.
- Exactly ONE repository (`calendars`) as port + Postgres adapter + in-memory adapter + contract test.
- Zod-parsed config at the composition root.
- Real production deploy: two Railway services + a real Supabase project.
- `GET /api/status` (real DB health, empty token/job sections) live in prod.
- MCP `/mcp` endpoint + `get_status` tool (bearer-protected) live in prod.
- The MCP-02 one-use-case-two-adapters-one-schema pattern, established on `get_status`.

**Out of scope (from SPEC.md):**
- CBOE/FRED/Schwab adapters (Phase 2/4); BSM engine (Phase 2); calendar/snapshot/journal (Phase 3).
- Every repository other than `calendars`; real jobs/pg-boss (Phase 5; worker only boots + migrates).
- `broker_tokens` table (Phase 4); derived analytics (Phase 6).
- Web UI (`apps/web`) + Vercel (D19); Supabase-native Realtime/Auth/RLS (D18).

</spec_lock>

<decisions>
## Implementation Decisions

### Deploy & CI pipeline
- **D-01:** GitHub-connected Railway deploy. Railway watches the `ChiragThesia/morai-trading-dashboard-and-tools` GitHub repo; push to `main` auto-deploys both the `server` and `worker` services. No local-CLI-only deploy.
- **D-02:** CI from Phase 1. GitHub Actions runs `bun run typecheck`, `bun run lint`, and `bun run test` (including the `calendars` contract test via testcontainers Postgres — Docker is available on GH-hosted Ubuntu runners) on every PR. Effectively gates deploy on green.

### Railway build
- **D-03:** Nixpacks auto-detect for the Bun monorepo (zero Dockerfile). Each Railway service sets its root + build/start command per `deployment.md`. Revisit to a committed Dockerfile only if Nixpacks monorepo detection proves flaky (recorded as the fallback, not the default).

### Boundary enforcement
- **D-04:** `eslint-plugin-boundaries` for the hexagon dependency law (element types: `shared`, `core`, `adapters`, `apps/*`). Purpose-built, clearest violation messages. Enforces `core → shared` only; `core` may not import adapters/apps/frameworks/vendor SDKs.

### Database driver
- **D-05:** `postgres.js` as the Postgres driver behind Drizzle, pointed at Supabase via the **direct/session** `DATABASE_URL`. Rationale (clarified in discussion): Supabase is just managed Postgres (D18); Drizzle is an ORM, not a driver — it needs a wire-protocol client to open the socket. We deliberately do NOT use `@supabase/supabase-js` (its REST/Realtime/Auth SDK), because that couples the hexagon to Supabase and raises swap cost (D18). `postgres.js` + a connection string keeps any Postgres swappable. The direct/session connection (not the 6543 transaction pooler) is required for migrations and future pg-boss (`LISTEN/NOTIFY` + advisory locks).

### Claude's Discretion (technical, derived from architecture docs — planner decides specifics)
- MCP transport: `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` mounted at `/mcp` on the same Hono server (`mcp-and-plugins.md`).
- Migrator: Drizzle's migrator (`drizzle-kit generate` for SQL + boot-time `migrate()`), idempotent via the `__drizzle_migrations` ledger; runs over the direct connection.
- Contracts: Zod schemas in `packages/contracts`; Hono `@hono/zod-validator` on routes; MCP tool input/output derived from the same schema (one `statusResponse` source).
- In-memory adapters live in `packages/adapters/memory/`; package scope `@morai/*`.
- The single repo built this phase is `calendars` (locked by SPEC). Other repos are deferred to their phases.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements
- `.planning/phases/01-walking-skeleton/01-SPEC.md` — locked requirements, boundaries, acceptance criteria. MUST read first.

### Architecture (source of truth)
- `docs/architecture/overview.md` — vision, system context, hard rules, doc map.
- `docs/architecture/monorepo-layout.md` — exact package/app layout, dependency graph, composition roots, `apps/server` + `apps/worker` internal structure.
- `docs/architecture/stack-decisions.md` — D1–D19; esp. D5/D6 (Postgres+Drizzle), D14 (Zod), D15 (ESLint boundaries), D18 (Supabase-as-Postgres + connection modes), D19 (Vercel/UI deferred).
- `docs/architecture/hexagonal-ddd.md` — layers, ports/adapters, naming, dependency law, bounded contexts.
- `docs/architecture/data-model.md` — the 7 journal-context tables, time-leading composite keys, migration discipline.
- `docs/architecture/api-design.md` — Hono route shape (Zod-validate → use-case → Result→response), `/api/status` route, service/DAO vocabulary.
- `docs/architecture/mcp-and-plugins.md` — MCP server as inbound adapter at `/mcp`, bearer auth, tool surface, MCP-02 rule.
- `docs/architecture/deployment.md` — Railway topology, env (`DATABASE_URL` direct vs `DATABASE_POOL_URL`), `TOKEN_ENCRYPTION_KEY`, `MCP_BEARER_TOKEN`, status payload contents.
- `docs/architecture/testing-tdd.md` — red→green loop, test pyramid, contract-test pattern, testcontainers usage.

### Rules (mechanical requirements)
- `.claude/rules/tdd.md` — red→green TDD, required test kinds.
- `.claude/rules/typescript.md` — no any/as/!, strict compiler + lint rule set (source of truth for D-03/strict-TS criteria).
- `.claude/rules/architecture-boundaries.md` — dependency law, layer laws (source of truth for D-04/boundary criteria).
- `.claude/rules/workflow.md` — docs-first, verification-before-done, change hygiene.

### Reference implementations (port, don't reinvent)
- `docs/trade-advisor-inventory.md` — locates the existing OCC parser, BSM engine, Schwab auth, and config patterns in the `trade-advisor` plugin (only OCC parsing + config shape are relevant to Phase 1).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None in-repo (pre-code). External reference only: `trade-advisor` plugin's `OccSymbol`/OSI parsing and Zod-config shape (`docs/trade-advisor-inventory.md`) inform `shared` (FND-04) and the config module (DATA-04) — port the logic test-first, do not copy wholesale.

### Established Patterns
- Hexagon dependency law and strict-TS rules already specified in `.claude/rules/` — Phase 1 makes them executable (ESLint + tsconfig), it does not invent them.
- In-memory-adapter-per-port is the project pattern (`monorepo-layout.md`) — the `calendars` repo establishes the contract-test harness reused by every later repo.

### Integration Points
- `apps/server` composition root wires: config (DATA-04) → postgres.js pool → Drizzle → `calendars` repo → `get_status` use-case → Hono route + MCP tool.
- `apps/worker` composition root: config → migrator on boot → idle (no real jobs this phase).
- Railway ↔ GitHub ↔ Supabase: push `main` → CI green → Railway builds (Nixpacks) → services boot → migrate → connect to Supabase.

</code_context>

<specifics>
## Specific Ideas

- Status payload shape is fixed by the SPEC interview: `{ db: "ok"|"down" (real Supabase ping), tokenFreshness: "none yet", lastJobRuns: "none yet", version, uptime }`. Token/job fields are present-but-empty placeholders, populated in Phases 4/5.
- The `calendars` repo is the deliberate pattern-prover; the contract-test harness it introduces is the reusable asset for all later repos.

</specifics>

<deferred>
## Deferred Ideas

- Dockerfile-per-service build — fallback if Nixpacks monorepo detection is flaky (D-03). Not now.
- `@supabase/supabase-js` (Realtime/Auth/RLS) — only on the D18 revisit trigger (a real need for Supabase-native features). Not v1.
- PR preview environments on Railway — nice-to-have once the pipeline is stable; not required for Phase 1.

None of these are scope creep — discussion stayed within the Phase 1 boundary.

</deferred>

---

*Phase: 1-Walking Skeleton*
*Context gathered: 2026-06-07*
