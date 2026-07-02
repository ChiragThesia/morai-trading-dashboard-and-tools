# Deployment — Railway + Supabase + Vercel

## Topology

Compute on Railway, database on Supabase, web on Vercel (deferred). Three providers, each a
swap-friendly boundary.

| Host | Service | Source | Runs |
|---|---|---|---|
| Railway | `server` | `apps/server` | Hono API + MCP endpoint (one process, port from env) |
| Railway | `worker` | `apps/worker` | pg-boss runner (crons + queue handlers) |
| Supabase | Postgres 16 | managed | app data + pg-boss queue tables + `broker_tokens` |
| Vercel | `web` | `apps/web` | React SPA — **deferred** (D19), not built/deployed yet |

No Redis (D8). The API server serves **API + MCP only** — the SPA is hosted separately on Vercel
when UI work begins (D19), so it is a distinct origin (CORS configured on the API at that point).

## Build & Deploy

- **Config-as-code** is the source of truth for build + deploy config: `railway.server.toml` and
  `railway.worker.toml` (repo root). Each service is pointed at its file via its Railway *Config-as-code
  path* setting (one-time, e.g. `/railway.server.toml`). Config in code overrides dashboard values.
- Monorepo build: **Dockerfile-per-service** (`build.dockerfilePath` in each config →
  `apps/<app>/Dockerfile`). Each Dockerfile builds from the repo root (full workspace context),
  `bun install --frozen-lockfile`, and carries its own `CMD` (`bun run apps/<app>/src/main.ts`). This
  gives per-service start commands (the Railway CLI cannot set them) and sidesteps flaky Nixpacks
  Bun-monorepo detection. `build.watchPatterns` scopes each service's rebuilds to its own paths.
- The server config sets `deploy.healthcheckPath = "/api/status"` — a boot-but-unhealthy deploy (e.g.
  DB unreachable) is caught before it goes live. `restartPolicyType = "ON_FAILURE"`.
- Secrets stay **out** of config-as-code — `DATABASE_URL`, `MCP_BEARER_TOKEN`, `TZ` remain Railway env
  vars. (`RAILWAY_DOCKERFILE_PATH` is superseded by `build.dockerfilePath` once the config path is set.)
- Deploys per service; worker and server deploy independently.
- `web` (when built) deploys to Vercel from `apps/web` — its own pipeline, not part of the Railway
  build (D19).

## Configuration

- All config via env vars, **Zod-parsed at composition root** — boot fails loudly on bad config.
- Required: `DATABASE_URL` (Supabase **direct/session** connection — used by worker + migrator,
  required for pg-boss `LISTEN/NOTIFY` + advisory locks per D18), `SCHWAB_TRADER_APP_KEY/SECRET`,
  `SCHWAB_MARKET_APP_KEY/SECRET`, `MCP_BEARER_TOKEN`, `TOKEN_ENCRYPTION_KEY`,
  `TZ=America/New_York` (worker).
- Optional: `DATABASE_POOL_URL` (Supabase transaction pooler, port 6543) — pooled API read path if
  connection count becomes a constraint. **Never** used for migrations or pg-boss.
- Secrets in Railway environment config; Supabase keys from the Supabase dashboard — never in repo,
  never in logs.

## Schwab Token Persistence

- Tokens (access + refresh) must survive restarts → **tokens stored in Supabase Postgres**
  (`broker_tokens` table, encrypted at rest with app-level key from `TOKEN_ENCRYPTION_KEY`).
  Railway compute is stateless and ephemeral; the database is the one source of truth — any
  service can refresh, no volume coordination. The schwab-py sidecar (D22) reads the same row via `client_from_access_functions` callbacks.
- `refresh-tokens` job (04:00 ET daily) keeps **access** tokens fresh. It does NOT extend the
  refresh token: **Schwab refresh tokens expire 7 days after issuance, hard, no sliding window.**
- **Weekly re-auth is mandatory and designed in** (see `stack-decisions.md` D22):
  - On `invalid_grant`: Schwab-dependent jobs pause gracefully, status flags AUTH_EXPIRED,
    UI banner + MCP `get_status` surface it. One app failing must not block the other.
  - Re-auth = one command run locally (`apps/sidecar/seed_token.py`, see
    `docs/operations/schwab-reauth-runbook.md`), which writes the fresh token row to
    Postgres. The sidecar holds its Schwab token in memory and only re-reads Postgres on
    restart, so recovery requires `railway redeploy --service sidecar -y` — no code
    rebuild, no SSH, but a restart is mandatory.
  - `doctor`-style diagnostics in the CLI: env completeness, callback-URL exact match against
    the dev-portal field, live refresh-grant test.

## Environments

- `production` — Railway compute pointed at the production Supabase project.
- Local dev — `supabase start` (local Supabase stack via CLI) or a dedicated dev Supabase project,
  + `bun run dev`. A plain `docker compose up postgres` also works for pure-local since the adapter
  only needs a Postgres URL. In-memory adapters allow most dev without any DB or Schwab creds.
- No staging until multi-user; revisit then.

## Migrations

Auto-run on boot (server and worker both call the idempotent migrator — file-tracked,
lex-ordered, per-file transactions). Safe under Railway's rolling restarts.

## Observability (minimum viable)

- Structured JSON logs (console — Railway captures). `warn`/`error` gated console rule.
- `GET /api/status` exposes: token freshness, last successful run per job, DB reachability.
- Job failures surface in status payload — the UI shows a banner; Claude sees it via `get_status`.
