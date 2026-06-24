# Stack Decisions (ADR-lite)

Every entry: what we chose, why, what it costs to swap, and the trigger that reopens the decision.
**Rule**: any new tooling decision or reversal gets a row + section here *before* implementation.

## Decision Table

| # | Concern | Decision | Swap cost | Revisit trigger |
|---|---|---|---|---|
| D1 | Runtime + pkg mgr | Bun | Low | Bun-specific blocker in a critical lib |
| D2 | Backend HTTP | Hono + Zod | Low (inbound adapter) | Need for websockets at scale beyond Hono support |
| D3 | Frontend + charting | React + Vite + TS + Tailwind v4 + shadcn/ui · visx + uPlot + ECharts for charts (see D3 section) | Medium | — |
| D4 | Data fetching (web) | TanStack Query + Hono RPC client | Low | — |
| D5 | Database | Postgres 16 (hosted on **Supabase**) | Low (outbound adapter) | — |
| D6 | ORM / DAO | Drizzle | Low | — |
| D7 | Time-series | Plain Postgres (no Timescale) | One migration | >10M rows in any observations table OR p95 snapshot query >500ms |
| D8 | Jobs / queue | pg-boss | Low (`JobQueue` port) | Job throughput >100/s sustained OR need rate-limit groups → BullMQ+Redis |
| D9 | Testing | Vitest + fast-check + testcontainers + msw | — | — |
| D10 | E2E | Playwright (deferred until UI stabilizes) | — | First real user-facing release |
| D11 | Hosting | **Railway** (server + worker) · **Supabase** (Postgres) · **Vercel** (web, deferred) | Medium | Cost >$50/mo OR need for fixed-cost VPS |
| D12 | AI integration | MCP server (streamable HTTP) + Claude Code plugin | Low | — |
| D13 | Monorepo | Bun workspaces | Low | — |
| D14 | Validation | Zod everywhere (API edges, env, external API responses) | Medium | — |
| D15 | Lint/boundaries | ESLint flat config + boundary enforcement | — | — |
| D16 | Schwab auth | Own TS OAuth client (vendored, port of trade-advisor `auth.ts`); tokens in Postgres | Low | Schwab changes OAuth contract |
| D17 | Market data streaming | Deferred — poll-based jobs cover the journal use-case | New driven port + adapter | Need for sub-minute live data → TS streamer adapter OR schwab-py Python sidecar |
| D18 | DB provider / host | **Supabase** (managed Postgres 16) | Low (connection string) | Need Supabase Realtime (sub-second push) OR cost/limits |
| D20 | API auth | Supabase Auth JWT (HS256, offline verify via `hono/jwt`) + exact-origin CORS | Low (middleware seam) | Need multi-tenant auth OR provider swap |
| D19 | Web host + build order | **Vercel** for `apps/web`, **deferred**; backend + data layer built first | Low | UI work begins |
| D21 | BSM kernel leaf | `packages/quant` — pure math leaf imported by both `core` and `web` (see D21 section) | Low (call sites + tsconfig refs + ESLint boundary) | — |

## D1 — Bun

**Why**: Speed of install/test/run; first-class TS execution (no build step in dev); `bun test`-compatible
but we standardize on Vitest for ecosystem (fast-check, msw, testcontainers integration).
Old dashboard ran Bun successfully.
**Swap cost**: Low. Hono runs on Node/Deno/Workers unchanged; Drizzle and pg-boss are runtime-agnostic.

## D2 — Hono

**Why**: Proven in the previous dashboard. Runtime-portable (keeps D1 swappable). Hono RPC +
Zod validator gives end-to-end type-safety to the React client without codegen. Tiny, fast on Bun.
**Role in hexagon**: inbound (driving) adapter only. Route handlers parse/validate with Zod, call
application use-cases, serialize results. **No business logic in routes — ever.**
**Swap cost**: Low. Replace `apps/server/src/adapters/http/` and the client import in web.

## D3 — React + Vite + Tailwind v4 + shadcn/ui + visx + uPlot + ECharts

**Why**: Team familiarity, prior art from old dashboard, shadcn gives composable primitives we own
(copy-in, not dependency).

**Charting libraries (locked by D-05 + UI-SPEC, Phase 9):** Three libraries cover five distinct chart
types. Recharts was the initial placeholder. The UI-SPEC locked these three after mockup iteration
(see `mockups/playground-v3.html`). Recharts cannot handle synced greek-strip small-multiples or
gradient-fill payoff z-order — both are hard requirements for the trading dashboard.

| Library | Package(s) | Chart types |
|---|---|---|
| **visx** | `@visx/shape`, `@visx/gradient`, `@visx/event`, `@visx/scale`, `@visx/axis`, `@visx/group`, `@visx/tooltip` | Payoff chart, net-gamma profile, equity curve, term/skew minis — SVG with crosshair |
| **uPlot** | `uplot`, `uplot-react` | Greek strips (Δ/Γ/Θ/Vega) — 4-panel synced small multiples, high-performance canvas |
| **Apache ECharts** | `echarts`, `echarts-for-react` | GEX by-strike bars, P&L heatmap, GEX-by-expiry bars |

**Recharts**: superseded. Not used. The locked UI-SPEC (D-05) records the swap reason.

## D4 — TanStack Query + Hono RPC client

**Why**: Server state belongs in a cache layer, not useState. Hono RPC client (`hc`) gives typed
calls inferred from server routes via the shared `contracts` package.

## D5/D6 — Postgres 16 + Drizzle

**Why**: Relational fits journal/positions/orders. Drizzle is SQL-transparent, type-safe, has
first-class migrations (drizzle-kit), and keeps us close to the SQL — important for the
time-series-ish queries. Prisma rejected: heavier runtime, less SQL control.
**Role in hexagon**: Drizzle code lives ONLY in `packages/adapters/postgres/`. Repositories there
implement ports defined in core. Domain never sees a Drizzle type.
**Host**: the Postgres instance is Supabase-managed (D18) — Drizzle and the adapter are unchanged;
only the connection string differs.

## D7 — Plain Postgres now, Timescale later (maybe)

**The math** (see `data-model.md` for schema):
- Journal cadence: 30-min RTH snapshots = 13/day per calendar.
- 10 concurrent calendars × 13 × 250 trading days ≈ **33k rows/year**.
- Even full-chain capture (~500 contracts × 13/day) ≈ **1.6M rows/year**.

Plain Postgres with composite `(time, calendar_id)` indexes handles this for years. Timescale adds
ops complexity (extension availability on Railway managed PG, compression job tuning) for zero
benefit at this volume.

**Upgrade path** (pre-designed so it stays cheap):
1. Schema already time-series-shaped: composite time-leading PKs, append-only observation tables.
2. Trigger fires (D7 table) → provision Timescale-enabled PG (Railway template image), run
   `create_hypertable` migration, add compression policy. No application code changes — it's all
   inside the postgres adapter.

## D8 — pg-boss

**Why**: Queue semantics (retries, backoff, cron, dedup via singleton keys, persistence across
restarts) **without a Redis service**. One database = less infra to babysit on Railway.
Old dashboard used BullMQ+Redis; lesson kept (deterministic job IDs), infra simplified.
**What jobs do** (catalog in `jobs.md`): scheduled API pulls (Schwab/CBOE), derived calcs
(BSM greeks, skew, term structure), 30-min calendar snapshots, daily token refresh, journal rebuild.
**Multi-user story**: the queue decouples user-triggered work from rate-limited upstream APIs.
Per-queue concurrency caps protect Schwab quotas; user requests enqueue and poll/subscribe.
**Role in hexagon**: behind a `JobQueue` driven port. Job *handlers* are thin — they call
application use-cases. pg-boss never appears outside `packages/adapters/jobs/`.
**Swap cost**: Low. BullMQ adapter implements the same port; deterministic-ID pattern carries over.

## D9 — Vitest stack

**Why**: Fast, zero-config with Bun + TS. Companions:
- **fast-check** — property-based tests for numerical code (greeks math, OCC parsing).
- **testcontainers** — real Postgres in Docker for adapter/integration tests. No mocked SQL.
- **msw** — mock Schwab/CBOE HTTP at the network layer for adapter tests.

**TDD red→green is mandatory** — see `.claude/rules/tdd.md` and `testing-tdd.md`.

## D11 — Railway

**Why**: Per-service deploys (server, worker), cron-friendly, cheap at this scale, fastest path to
"lives online". Tooling already installed.
**Scope**: Railway hosts the **stateless compute** — `apps/server` (Hono API + MCP) and
`apps/worker` (pg-boss). The database is **not** on Railway; it is Supabase (D18). Schwab token
persistence is a Supabase Postgres row (`broker_tokens`), not a Railway volume — any service reads
one source of truth.
**Topology**: see `deployment.md`.

## D12 — MCP server + Claude Code plugin

**Why**: Claude Code is a first-class client of this system. The MCP server is just another
inbound adapter calling the same use-cases as HTTP. See `mcp-and-plugins.md`.

## D14 — Zod at every boundary

Parse, don't cast:
- Inbound HTTP request/response — Hono zod-validator.
- External API responses (Schwab/CBOE/FRED) — Zod-parse before anything touches core.
- Env/config — Zod-parsed once at composition root; typed config object injected.
- Job payloads — Zod-parsed in the jobs adapter.

## D15 — ESLint boundary enforcement

The dependency rule is enforced mechanically, not by review vigilance:
- `eslint-plugin-boundaries` (or `import/no-restricted-paths`) forbids core → adapters/apps imports.
- Strict rules carried from old dashboard: `no-explicit-any`, no type assertions, no non-null
  assertions, no floating promises, switch exhaustiveness. Full list in `.claude/rules/typescript.md`.

## D16 — Schwab auth: own TS OAuth client, tokens in Postgres

**Why**: The flow is plain OAuth2 (authorization_code + refresh grant, Basic auth header,
two apps: trader + market). Proven implementation exists — trade-advisor `auth.ts` with
`setup`/`refresh`/`status`/`doctor` subcommands. Port it into the `brokerage` context +
a thin CLI. No library dependency needed for auth; schwab-py NOT required here.

**Hard constraint — weekly re-auth**: Schwab refresh tokens expire **7 days after
issuance, hard, no sliding window**. Refreshing access tokens does not extend it.
Consequences (designed in, see `deployment.md`):
- Jobs degrade gracefully on auth failure: pause Schwab pulls, alert via status + UI
  banner + MCP `get_status`. One app failing must not block the other.
- Re-auth is one command run locally (browser OAuth dance), which writes the new token
  row to Postgres. Server picks it up on next call — no deploy, no SSH.
- `doctor` diagnostics carried over: env completeness, callback-URL exact-match check
  (`https://127.0.0.1` default; portal field must match character-for-character),
  live refresh-grant test, `invalid_grant` → re-auth instruction.

**Token storage**: single source of truth in Postgres (`broker_tokens`), encrypted
app-side. Any future consumer (including a Python sidecar — schwab-py supports custom
token read/write functions) reads the same row. No file/volume coordination.

## D17 — Streaming: deferred

**Why deferred**: journal cadence is 30-min snapshots; scheduled pulls cover it.
Streaming adds a long-lived websocket process for no current consumer.

**When the trigger fires** (sub-minute live data need), two adapter options behind a
`ForStreamingQuotes` driven port — hexagon unchanged either way:
1. **TS-native streamer adapter** — Schwab streamer is documented websocket + JSON
   (login with access token, SUBS commands). Keeps the stack single-language.
2. **Python sidecar with schwab-py** — separate Railway service running schwab-py's
   `StreamClient`, writing observations to Postgres. Reads tokens from `broker_tokens`
   via custom access functions → one token source, no refresh races.

Decide at trigger time; default lean is (1) to avoid a second language in the repo.

## D18 — Supabase as the database provider

**Why**: Managed Postgres 16 with zero infra babysitting, generous free tier, instant provisioning,
point-in-time backups, and a clean upgrade path (it *is* Postgres). Replaces Railway-managed
Postgres so the database is independent of the compute host — Railway can redeploy or be swapped
without touching data.

**Scope now — Supabase is "just Postgres"**: we use it as a Postgres connection string behind the
existing `postgres` adapter. Drizzle, the schema, repositories, and pg-boss are all unchanged.
**Supabase-native features (Realtime, Auth, RLS, auto-REST/GraphQL, Edge Functions, Storage) are
deliberately NOT adopted** — adopting them would couple the hexagon to a vendor and raise swap cost,
contradicting the swap-friendly premise. They stay documented as future options.

**Connection-mode constraint (important)**: Supabase exposes two endpoints —
- **Direct / session pooler** (port 5432 / session mode): full Postgres session semantics.
- **Transaction pooler** (port 6543): PgBouncer transaction mode — no `LISTEN/NOTIFY`, no session
  advisory locks, no prepared-statement reuse.

pg-boss (D8) needs `LISTEN/NOTIFY` + advisory locks, and drizzle-kit migrations need a stable
session → **both use the direct/session connection**. Pooled read-path queries from the API may use
the transaction pooler later if connection count becomes a constraint. Config carries two URLs:
`DATABASE_URL` (direct, used by worker + migrator) and an optional `DATABASE_POOL_URL` (pooled).

**Swap cost**: Low — change the connection string back to any Postgres. Because we avoid
Supabase-native features, nothing else moves.

**Revisit trigger**: a concrete need for Supabase Realtime (sub-second UI push) OR cost/limits
push us to a different Postgres host.

**Auth update (Phase 8, D-02):** The Supabase Auth deferral is lifted. See D20.

## D19 — Vercel for the web app; backend-first build order

**Why deferred**: the immediate goal is a strong **backend + data layer driven by APIs** — `apps/web`
is not built yet. When UI work begins, `apps/web` (React + Vite SPA, D3) deploys to **Vercel** (its
natural host) and talks to the Railway API over HTTPS via the Hono RPC client + `contracts` types.

**Consequence for now**: `apps/server` serves **API + MCP only** — it does *not* serve a static SPA
(the earlier "server serves the built SPA" plan is superseded; the SPA will live on Vercel, a
separate origin, so CORS is configured on the API when the UI lands).

**Swap cost**: Low — the SPA is a static build; any static host works. Vercel chosen for DX and zero
config with Vite.

**Revisit trigger**: UI phase begins, OR a need to colocate UI with the API (then fold the SPA back
into the server's static serving).

## D20 — Supabase Auth JWT verification + CORS (Phase 8)

**Context**: Phase 8 adds `apps/web` on Vercel. The existing read endpoints
(`/api/status`, `/api/journal`, `/api/brokerage`, `/api/analytics`, `/api/analytics/gex`)
are unauthenticated. Once the web dashboard reaches them from a browser, that brokerage
data — real positions, P&L, order history — is internet-reachable. It needs a login gate.

**Decision**: Gate all read endpoints with Supabase Auth JWT verification. Single trader
account; signups closed. This lifts the D18 "Supabase Auth" deferral.

**How — JWT verification (offline HS256)**:
- Supabase Auth issues JWTs signed with HS256 using the project JWT secret.
- The server verifies these tokens offline with Hono's built-in `hono/jwt` middleware and
  `SUPABASE_JWT_SECRET` (a env var from Supabase Dashboard → Settings → API).
- No Supabase SDK on the server. No per-request network call. Stateless JWT verify.
- Invalid or missing token → Hono returns `401` before reaching any route handler.

**How — CORS**:
- `hono/cors` middleware restricts `Access-Control-Allow-Origin` to `WEB_ORIGIN`.
- `WEB_ORIGIN` is the Vercel deployment URL (env var; e.g. `https://morai.vercel.app`).
- `credentials: true` is required for the `Authorization` header. The origin must be
  exact — never `*` with credentials.
- CORS middleware applies first, before the JWT group, so `OPTIONS` preflights succeed.

**Scope**: Read endpoints only. The `/api/jobs/*` group keeps its existing `bearerAuth`
(MCP bearer token, separate group). MCP tools are not gated by Supabase Auth.

**New env vars**: `SUPABASE_JWT_SECRET` (min 32 chars), `WEB_ORIGIN` (URL string).

**Swap cost**: Low. JWT verification sits behind a middleware seam. Swapping to any
provider means replacing the middleware and the env var; routes and use-cases are
unchanged.

**Revisit trigger**: Multi-tenant auth (RLS per user) or provider swap.

**References**: Phase 8 CONTEXT.md D-02, D-02a; `apps/server/src/main.ts` middleware group.

## D21 — `packages/quant` pure-leaf BSM kernel (Phase 9, D-01)

**Context**: The BSM pricing kernel (`bsmPrice`/`bsmGreeks`/`bsmVega`) lives at
`packages/core/src/journal/domain/bsm.ts`. It has zero imports — pure math. Phase 9 needs it in the
browser for live Analyzer re-pricing on slider drag (proven sub-1ms in `mockups/playground-v3.html`).
The law forbids `web → core` imports. See D-01 in `09-CONTEXT.md`.

**Decision**: Extract the BSM kernel DOWN to a new pure leaf — `packages/quant` (`@morai/quant`).
Both `core` and `web` import from `@morai/quant`. No dependency arrow reverses: `core → quant` and
`web → quant` are both valid; `quant` imports nothing. The hexagon stays intact.

**Why a dedicated `quant` leaf (not `packages/shared`)**: `shared` holds Result, assertDefined,
OccSymbol, and time utilities — general-purpose primitives. `quant` holds financial math — a
distinct concern. Keeping them separate lets each grow without coupling unrelated domains.

**One kernel = cross-screen consistency**: the Analyzer's live P&L preview and the
Positions/Journal server-computed P&L run the same kernel on the same float64 inputs → identical
output. A second copy in the browser would risk visible divergence on the same calendar.

**Swap cost**: Low. Call sites in `packages/core` update their import path. `tsconfig.json`
references and the ESLint boundary element (`type: "quant"`) are added. No logic changes.

**References**: Phase 9 CONTEXT.md D-01; `packages/core/src/journal/domain/bsm.ts` (source file
before extraction); `monorepo-layout.md` (updated dependency graph).
