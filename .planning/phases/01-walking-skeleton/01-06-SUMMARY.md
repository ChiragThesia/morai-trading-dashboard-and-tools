# Plan 01-06 Summary — CI + Railway/Supabase Production Deploy

**Status:** Complete
**Completed:** 2026-06-08

## What shipped

- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs `typecheck + lint + test` (incl. testcontainers Postgres, not skipped) on PR/push. Committed `cb2e9ae`.
- **Dockerfile-per-service Railway builds** — switched from the Nixpacks-force plan to Dockerfile-primary (committed `<this branch>`): per-service start commands can't be set on Railway CLI 4.11, so each service builds from its own `apps/<svc>/Dockerfile` (copies full workspace, `bun install --frozen-lockfile`, own `CMD`), selected via `RAILWAY_DOCKERFILE_PATH`. `railway.json` (NIXPACKS force) removed. `deployment.md` updated (docs-first).
- **Supabase project** `morai-trading-dashboard-and-tools` (ref `cwcdcosxoaqyqbsfifsh`, us-east-2, Postgres 17) — free-tier, created by user.
- **Railway project** `morai` (`78462a2f…`) with two services: `server` (`fd26c9b6…`, public domain `server-production-f5ca2.up.railway.app`) and `worker` (`e22cf71f…`).
- **Env** (Railway, never in repo): `DATABASE_URL` (Supabase **session pooler**, port 5432 — IPv4 for Railway + session features), `MCP_BEARER_TOKEN`, `TZ=America/New_York`, `RAILWAY_DOCKERFILE_PATH`.

## Acceptance proof (production)

| Req | Proof |
|---|---|
| DEPLOY-01 | Both `server` + `worker` deployed (build SUCCESS) on Supabase. Worker log: `morai worker: migrations applied, idling`. 7 tables present in Supabase (`list_tables`). |
| DEPLOY-02 | `GET https://server-production-f5ca2.up.railway.app/api/status` → `{"db":"ok","tokenFreshness":"none yet","lastJobRuns":"none yet","version":"0.0.1","uptime":...}` |
| DEPLOY-03 | `/mcp`: no bearer → 401, wrong bearer → 401, correct bearer → 200 (`tools/list`). Registered via `claude mcp add` (local scope). |

## Deviations

1. **Dockerfile-primary instead of Nixpacks** (D-03 fallback promoted to primary) — Railway CLI 4.11 has no per-service start-command setter; Dockerfiles give per-service entrypoints + dodge Nixpacks Bun-monorepo detection issues. `deployment.md` updated.
2. **CLI deploy (`railway up`) instead of GitHub-connected auto-deploy (D-01)** — GitHub→Railway connection needs browser OAuth authorization of the Railway GitHub app. First deploy done via CLI to get live fast. **Follow-up:** wire GitHub auto-deploy-on-push to fully satisfy D-01.

## Open follow-ups

- [ ] Wire Railway↔GitHub auto-deploy (D-01) — currently CLI-deployed.
- [ ] Enable RLS (deny-all) on the 7 tables — Supabase advisory; safe since our `postgres`-role connection bypasses RLS and we don't use PostgREST (D18).
- [ ] CI green run on a PR (workflow committed; first PR will exercise it).
