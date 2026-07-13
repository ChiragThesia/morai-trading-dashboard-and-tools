# Phase 37: In-app Schwab Re-auth Wizard - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the local CLI re-auth dance with a hosted, wizard-driven OAuth flow. The
sidecar (sole Schwab boundary) gains authed admin endpoints that mint authorize URLs
and exchange redirect URLs for tokens, writing through the existing `token_store.py`
encryption and re-initializing its Schwab clients in-process — no service restart.
The server proxies those endpoints behind the existing Supabase JWT. The web
`AuthExpiredBanner` grows a "Reconnect" wizard (trader → market, sequential). The CLI
`seed_token.py` path stays as documented fallback. Schwab-side prerequisite already
done: `https://morai.wtf` registered as an additional callback URL 2026-07-12
(processes after market hours; live by 2026-07-14 session).

Out of scope: auto-refresh without human login (Schwab requires interactive
authorization every 7 days — hard ceiling), any change to the streamer/chain data
path, multi-operator roles.

</domain>

<decisions>
## Implementation Decisions

### OAuth mechanics (Area 1 — all accepted 2026-07-13)
- Callback URL = bare `https://morai.wtf` (registered). SPA reads `?code=&state=` at
  root on load and strips them immediately via `history.replaceState` before anything
  else can log/persist the URL client-side.
- CSRF `state` = sidecar-issued random nonce per app, persisted in Postgres with a
  10-minute TTL, validated AND deleted on exchange (replay-killed). Not stateless-HMAC.
- Redirect consumption: SPA catches params → POSTs the full redirect URL to the
  server → server forwards to sidecar exchange endpoint. No copy-paste anywhere.
- Per-app success = sidecar re-checks `refresh_issued_at` anchored within 5 minutes
  (same freshness gate as `seed_token.py _verify_and_finish`) before the wizard
  advances. HTTP 200 alone is not success.

### Sidecar admin surface (Area 2 — all accepted)
- New `SIDECAR_ADMIN_TOKEN` shared-secret header required on both admin endpoints;
  env var on server + sidecar (Railway). Sidecar has no auth today — these endpoints
  mint tokens, so Railway private networking alone is insufficient.
- After a successful exchange the sidecar rebuilds its Schwab clients and restarts
  its streamer session in-process while HOLDING the existing Postgres advisory lock
  (GW-04) — no second streamer session, no service restart. `railway redeploy`
  remains the documented manual fallback.
- Partial failure isolation: trader succeeding and market failing keeps trader's
  fresh token; wizard surfaces the per-app error and offers retry of only the failed
  app. Mirrors CLI behavior ("do NOT restart the sidecar; re-run for the failed app").
- Endpoints: `POST /sidecar/admin/reauth/start` → `{app, authUrl, state}` and
  `POST /sidecar/admin/reauth/exchange` → per-app result. JSON, existing sidecar
  route style (FastAPI in main.py).

### Wizard UX + guardrails (Area 3 — all accepted)
- Entry point: "Reconnect" button on the existing `AuthExpiredBanner` component,
  shown in both its red (expired) and amber (T-24h, `refreshExpiresIn` non-null)
  states. No new nav surface.
- Container: modal dialog with a step indicator (Trader 1/2 → Market 2/2), built on
  the Phase-21 Button system + Rule-Settings modal idiom; touch targets per Phase-35
  mobile primitives (works from a phone).
- Callback landing: app load with `?code=&state=` auto-resumes the wizard and
  exchanges silently, then advances the step. No confirm screen. Params are stripped
  from the URL/history first.
- Auth-code exposure in hosting access logs (Vercel sees `?code=` on the landing
  request): ACCEPTED and documented — standard public-redirect OAuth posture; the
  code is single-use, expires ~30s, and is useless without the app secret. Our own
  code (server, sidecar, web) never logs the code or full redirect URL.

### Locked earlier (2026-07-12/13 conversation, pre-discuss)
- Sidecar owns exchange + token encryption + re-init (no porting Python crypto to TS).
- Server proxy uses the EXISTING Supabase JWT auth — single-user app, any authed
  user is the operator. No new role system.
- Never log the authorization code anywhere in our stack.
- `docs/operations/schwab-reauth-runbook.md` gains the UI path; CLI stays fallback.
- No new alerting/cron in this phase — T-24h alert infra already exists.

### Claude's Discretion
- Exact wizard copy, step-state machine details, nonce table name/shape (small,
  TTL-cleaned), FastAPI route wiring details, server proxy route paths.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/sidecar/seed_token.py` — `_make_seed_writer`, `_verify_and_finish` freshness
  check, per-app APPS tuple; the exchange logic to lift into endpoint form.
- `apps/sidecar/token_store.py` — encryption + `broker_tokens` write path (sole writer).
- `apps/sidecar/main.py` — FastAPI app, client init in lifespan (`trader_client`,
  `market_client` on `app.state`), advisory-lock streamer ownership.
- `apps/web/src/components/AuthExpiredBanner.tsx` (+ test) — wizard entry point;
  driven by `/api/status` `tokenFreshness` (`status`, `refreshExpiresIn`).
- `apps/web/src/components/system/Button.tsx` — Phase-21 button primitive.
- Rule Settings modal (Phase 29/32) — modal idiom to copy.
- Server: `config.SIDECAR_URL` already in composition root (`apps/server/src/main.ts`);
  http adapter pattern in `apps/server/src/adapters/http/`.

### Established Patterns
- Hexagonal: server routes are thin Zod-parse → use-case → Result-map adapters; new
  proxy routes follow `packages/contracts` schema-first.
- TDD red→green mandatory; sidecar is Python (pytest, `apps/sidecar/tests/`).
- Secrets only via env (config.py Zod/pydantic parse); TOKEN_ENCRYPTION_KEY only as
  bound psycopg2 parameter.

### Integration Points
- `/api/status` `tokenFreshness` already drives banner states — wizard reads the same.
- Server → sidecar over `SIDECAR_URL` (Railway internal) + new `SIDECAR_ADMIN_TOKEN`.
- Railway env: add `SIDECAR_ADMIN_TOKEN` to server + sidecar services before deploy.

</code_context>

<specifics>
## Specific Ideas

- User's driving ask (2026-07-12): "ping the user saying hey the auth is about to
  expire with a banner and tell them to re-auth ... the app can itself call things" —
  banner-driven, everything automated except the Schwab login+authorize clicks.
- Deploy target: before the next 7-day expiry (~2026-07-20) so this re-auth cycle is
  the last CLI one.

</specifics>

<deferred>
## Deferred Ideas

- Dedicated `/reauth/callback` path registration at Schwab (optional hygiene; no
  security gain — revisit only if root-landing handling proves annoying).
- Market-feed-down alerting / SSE silent-stall watchdog — separate ops-debt item,
  not this phase.

</deferred>
