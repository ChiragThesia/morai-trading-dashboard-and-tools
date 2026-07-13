# Phase 37: In-app Schwab Re-auth Wizard - Research

**Researched:** 2026-07-13
**Domain:** OAuth2 hosted-redirect flow (schwab-py, no local callback server) + in-process FastAPI background-task re-init + Hono/Supabase JWT proxy + React full-page-redirect wizard
**Confidence:** HIGH

## Summary

The load-bearing question — can schwab-py mint an authorize URL and exchange a code without
binding `127.0.0.1:8182` — is answered by the codebase's own working code, not a new API to
learn. `apps/sidecar/seed_token.py:101` already calls `schwab.auth.get_auth_context(api_key,
callback_url, state=None)`, a synchronous, local, no-network call that builds the URL via
authlib and returns an `AuthContext(callback_url, authorization_url, state)` namedtuple.
`seed_token.py:165-169` already calls `schwab.auth.client_from_received_url(api_key, app_secret,
auth_context, received_url, token_write_func, asyncio=False)`, which does the one network call
(a blocking POST to `https://api.schwabapi.com/v1/oauth/token` via authlib) and then invokes
`token_write_func` with the fetched blob. Neither function starts an HTTP server — only
`client_from_login_flow` does that (confirmed against schwab-py's public docs and GitHub
source, fetched directly since schwab-py is not installed on this dev machine — it only exists
inside the Railway sidecar container per `apps/sidecar/requirements.txt:5`, pinned exactly at
1.5.1). The wizard's admin endpoints are a thin reshaping of logic already proven live in
production via the CLI runbook.

Three things in this phase are NOT simple plumbing and need explicit handling or the wizard
will silently fail its own success gate: (1) `token_store.py`'s routine write function
deliberately never touches `refresh_issued_at` (by design, to protect the 7-day TTL from
routine access-token rotation) — a fresh OAuth dance MUST anchor it, or CONTEXT.md's own
"re-check refresh_issued_at within 5 minutes" success gate never passes; (2) the sidecar's
background `streamer_task` and `keepalive_task` each capture `app.state.trader_client` in a
**local variable once**, before their own `while True` loops (`streamer.py:384-389`,
`main.py:67`) — rebuilding `app.state.trader_client` after a successful exchange does **not**
reach either running task; both must be cancelled and recreated; (3) `client_from_received_url`
makes a real blocking HTTP call — calling it directly inside an `async def` FastAPI route stalls
the event loop (health checks, streamer message pump) for the duration of the network round
trip, the same class of problem `main.py` already solves for its psycopg2 calls via
`loop.run_in_executor`.

**Primary recommendation:** Build the wizard as two new sidecar admin routes that reuse
`get_auth_context` / `client_from_received_url` exactly as `seed_token.py` already does,
persist the CSRF nonce in a new tiny Postgres table (Drizzle-tracked, psycopg2-written, mirrors
`broker_tokens`' own split ownership), explicitly anchor `refresh_issued_at` after a successful
exchange, and add a `reinit_schwab_session` helper to `main.py` that cancels+recreates the two
per-lock-cycle background tasks while never releasing the advisory lock. The server and web
layers are pure plumbing through already-established patterns (Hono JWT-gated proxy route,
`apiFetch` hook, Dialog-based wizard) — zero new dependencies anywhere.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mint Schwab authorize URL + CSRF nonce | API/Backend (sidecar) | Database (nonce persist) | Only the sidecar holds Schwab app secrets; `get_auth_context` is a pure local call, no network |
| Exchange redirect code for tokens | API/Backend (sidecar) | Database (`broker_tokens` write) | Sidecar is the sole token writer (GW-03/D22); token encryption lives in `token_store.py` |
| In-process client + streamer re-init | API/Backend (sidecar) | — | Must happen inside the one process holding the Postgres advisory lock (GW-04); browser/server cannot reach into sidecar process state |
| Server proxy + Supabase JWT gate | API/Backend (server) | — | Existing JWT boundary (D20); sidecar has no public Railway domain (GW-05) — server is the only thing that can call it |
| Wizard step state machine, URL capture/strip | Browser/Client | — | The full-page OAuth redirect round trip and `history.replaceState` are browser-only concerns |
| CSRF nonce storage | Database/Storage | — | Must survive process restarts and be visible to whichever sidecar instance serves the exchange request during a rolling deploy |

<phase_requirements>
## Phase Requirements

ROADMAP.md lists `**Requirements**: TBD` for Phase 37 — no REQUIREMENTS.md IDs have been mapped
to this phase yet (0 plans exist). This research is scoped entirely from `37-CONTEXT.md`'s
locked decisions and `37-UI-SPEC.md`'s design contract, both read in full below. The planner
should treat CONTEXT.md's decision bullets as the requirement set for this phase (no separate
ID-mapping table is possible without REQUIREMENTS.md entries).
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**OAuth mechanics (Area 1):**
- Callback URL = bare `https://morai.wtf` (registered 2026-07-12, live by 2026-07-14 session).
  SPA reads `?code=&state=` at root on load and strips them immediately via
  `history.replaceState` before anything else can log/persist the URL client-side.
- CSRF `state` = sidecar-issued random nonce per app, persisted in Postgres with a 10-minute
  TTL, validated AND deleted on exchange (replay-killed). Not stateless-HMAC.
- Redirect consumption: SPA catches params → POSTs the full redirect URL to the server →
  server forwards to sidecar exchange endpoint. No copy-paste anywhere.
- Per-app success = sidecar re-checks `refresh_issued_at` anchored within 5 minutes (same
  freshness gate as `seed_token.py _verify_and_finish`) before the wizard advances. HTTP 200
  alone is not success.

**Sidecar admin surface (Area 2):**
- New `SIDECAR_ADMIN_TOKEN` shared-secret header required on both admin endpoints; env var on
  server + sidecar (Railway). Sidecar has no auth today — these endpoints mint tokens, so
  Railway private networking alone is insufficient.
- After a successful exchange the sidecar rebuilds its Schwab clients and restarts its streamer
  session in-process while HOLDING the existing Postgres advisory lock (GW-04) — no second
  streamer session, no service restart. `railway redeploy` remains the documented manual
  fallback.
- Partial failure isolation: trader succeeding and market failing keeps trader's fresh token;
  wizard surfaces the per-app error and offers retry of only the failed app. Mirrors CLI
  behavior ("do NOT restart the sidecar; re-run for the failed app").
- Endpoints: `POST /sidecar/admin/reauth/start` → `{app, authUrl, state}` and
  `POST /sidecar/admin/reauth/exchange` → per-app result. JSON, existing sidecar route style
  (FastAPI in main.py).

**Wizard UX + guardrails (Area 3):**
- Entry point: "Reconnect" button on the existing `AuthExpiredBanner` component, shown in both
  its red (expired) and amber (T-24h, `refreshExpiresIn` non-null) states. No new nav surface.
- Container: modal dialog with a step indicator (Trader 1/2 → Market 2/2), built on the
  Phase-21 Button system + Rule-Settings modal idiom; touch targets per Phase-35 mobile
  primitives (works from a phone).
- Callback landing: app load with `?code=&state=` auto-resumes the wizard and exchanges
  silently, then advances the step. No confirm screen. Params are stripped from the
  URL/history first.
- Auth-code exposure in hosting access logs (Vercel sees `?code=` on the landing request):
  ACCEPTED and documented — standard public-redirect OAuth posture; the code is single-use,
  expires ~30s, and is useless without the app secret. Our own code (server, sidecar, web)
  never logs the code or full redirect URL.

**Locked earlier (2026-07-12/13, pre-discuss):**
- Sidecar owns exchange + token encryption + re-init (no porting Python crypto to TS).
- Server proxy uses the EXISTING Supabase JWT auth — single-user app, any authed user is the
  operator. No new role system.
- Never log the authorization code anywhere in our stack.
- `docs/operations/schwab-reauth-runbook.md` gains the UI path; CLI stays fallback.
- No new alerting/cron in this phase — T-24h alert infra already exists.

### Claude's Discretion
- Exact wizard copy, step-state machine details, nonce table name/shape (small, TTL-cleaned),
  FastAPI route wiring details, server proxy route paths.

### Deferred Ideas (OUT OF SCOPE)
- Dedicated `/reauth/callback` path registration at Schwab (optional hygiene; no security
  gain — revisit only if root-landing handling proves annoying).
- Market-feed-down alerting / SSE silent-stall watchdog — separate ops-debt item, not this
  phase.
- Auto-refresh without human login (Schwab requires interactive authorization every 7 days —
  hard ceiling), any change to the streamer/chain data path, multi-operator roles.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- Dependencies point inward: `packages/core` imports only `packages/shared` — the new reauth
  bounded context's ports/use-cases must not import Hono, FastAPI, psycopg2, or `process.env`.
- TDD red→green: every new file (sidecar Python via pytest, TS via Vitest) needs a failing test
  first, shown failing for the right reason, then green.
- No `any`, no `as`, no `!` in TS — parse with Zod, use `Result<T,E>`, `assertDefined`.
- **Docs before architecture changes** — this phase introduces a new Postgres table, a new
  bounded context (`reauth`), and a new shared secret (`SIDECAR_ADMIN_TOKEN`). Per
  `docs/architecture/stack-decisions.md`'s existing convention (every phase 24-01/26-01/27-01/
  29-01/34-01 starts with a docs-first plan) and `workflow.md`'s "Docs Before Code" rule, the
  first plan in this phase's execution should update `docs/architecture/stack-decisions.md`
  with a new decision entry (grep the file's current highest `### D` number at execution time —
  it was D22 as of this research, `stack-decisions.md:342`; later phases may have added more
  under a different heading style, verify before assuming D23/D24 are free) documenting: hosted
  wizard replaces the CLI as the primary re-auth path, CLI remains the documented fallback,
  nonce table is Drizzle-tracked-but-Python-written (mirrors `broker_tokens`), and
  `SIDECAR_ADMIN_TOKEN` is a new Railway secret on both server + sidecar.
- `docs/operations/schwab-reauth-runbook.md` MUST gain the UI path per CONTEXT.md — this is a
  docs update, not optional polish.

## Standard Stack

No new dependency anywhere in this phase (server, sidecar, or web). Every piece below is
already installed and pinned.

### Core (all already installed — zero `npm install` / `pip install` needed)

| Library | Version | Purpose | Why Standard (already this codebase's choice) |
|---------|---------|---------|--------------|
| schwab-py | 1.5.1 (pinned) | OAuth mechanics + Schwab HTTP client | `apps/sidecar/requirements.txt:5` — "never upgrade without research review" (D22 note in the file) |
| FastAPI | `>=0.115,<1.0` | Sidecar admin routes | `apps/sidecar/requirements.txt:8`; matches `health.py`/`chain_proxy.py` router idiom |
| psycopg2-binary | `>=2.9` | Nonce table read/write, `refresh_issued_at` anchor | Already the sidecar's sole Postgres driver (`token_store.py`, `advisory_lock.py`) |
| Hono + `@hono/zod-validator` | (workspace-pinned) | Server proxy routes | `apps/server/src/adapters/http/settings.routes.ts` is the exact pattern to mirror |
| Zod | (workspace-pinned) | Browser-facing contracts | `packages/contracts/src/rule-settings.ts` is the pattern to mirror |
| Drizzle ORM | (workspace-pinned) | New nonce table migration tracking | `packages/adapters/src/postgres/schema.ts` — table declared here even though only Python writes it (exact `brokerTokens` precedent, `schema.ts:218-241`) |
| `@tanstack/react-query` | (workspace-pinned) | Wizard data hook | `apps/web/src/hooks/useRuleSettings.ts` is the pattern to mirror |
| base-ui `Dialog` via shadcn wrapper | (already installed) | Wizard modal | `apps/web/src/components/ui/dialog.tsx`; UI-SPEC's own "No new dependency, no new shadcn component" note |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB-backed single-use nonce (chosen) | Stateless HMAC-signed `state` | Explicitly rejected in CONTEXT.md ("Not stateless-HMAC") — a DB row can be deleted-on-use (true replay-kill); an HMAC can only be time-window-checked, never truly single-use without also tracking used tokens somewhere, which just re-adds the DB dependency anyway |
| Cancel+recreate the two background tasks (chosen) | Full `railway redeploy` after every re-auth | CONTEXT.md explicitly requires in-process re-init ("no service restart"); redeploy stays documented as the manual fallback only |
| `client_from_received_url` reused as-is (chosen) | Hand-roll the OAuth2 token-endpoint POST | schwab-py already does this correctly and is proven live via the CLI path; reimplementing it would duplicate authlib's PKCE/state/error handling for no benefit |

**Installation:** none — no `npm install` or `pip install` commands are needed for this phase.

**Version verification:** `apps/sidecar/requirements.txt:5` pins `schwab-py==1.5.1` with an
explicit comment: "never upgrade without research review." schwab-py is **not installed on
this development machine** — it only exists inside the Railway sidecar container built from
`apps/sidecar/Dockerfile` (`pip install --no-cache-dir -r requirements.txt` at build time,
`Dockerfile:7`). Function signatures below were cross-verified against schwab-py's official
docs (schwab-py.readthedocs.io) and GitHub source (github.com/alexgolec/schwab-py), and against
this codebase's own already-working calls in `seed_token.py` — not against a local `pip show`.

## Package Legitimacy Audit

No external packages are being added by this phase (see Standard Stack above — every library
is already installed and pinned). The Package Legitimacy Gate does not apply.

**Packages removed due to [SLOP] verdict:** none — no new packages proposed.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
Browser (SPA)                    Server (Hono, Supabase-JWT-gated)      Sidecar (FastAPI, SIDECAR_ADMIN_TOKEN-gated)    Postgres
─────────────                    ─────────────────────────────────      ─────────────────────────────────────────────  ────────

[Reconnect button clicked]
   │ POST /api/reauth/start {app}
   ▼                             ── forwards with admin-token header ──▶
                                                                          get_auth_context(key, WEB_CALLBACK, state=nonce)
                                                                          mint random nonce ──────────────────────────────▶ INSERT reauth_nonces
                                  ◀── {app, authUrl, state} ─────────────
   ◀── {authUrl} (state dropped, browser never needs it) ──
   │
   ▼ window.location.href = authUrl  (full same-tab redirect)
[Schwab hosted login + authorize]
   │
   ▼ Schwab redirects to https://morai.wtf/?code=...&state=...
[main.tsx, before React renders: capture full href, history.replaceState strips it]
   │
   ▼ Shell mounts (Supabase session restored from localStorage) → AuthExpiredBanner →
     ReauthWizard auto-resumes from the captured href
   │
   ▼ POST /api/reauth/exchange {redirectUrl}
                                  ── forwards with admin-token header ──▶
                                                                          DELETE FROM reauth_nonces WHERE state=... AND
                                                                            created_at > now()-10min RETURNING app_id
                                                                            (atomic validate+consume; resolves which app)
                                                                          client_from_received_url(key, secret, ctx,
                                                                            redirectUrl, token_write_func)
                                                                            └─ on success → token_write_func ────────────▶ UPDATE broker_tokens
                                                                          anchor refresh_issued_at = now() ───────────────▶ UPDATE broker_tokens
                                                                          reinit_schwab_session(app):
                                                                            cancel + await old keepalive_task/streamer_task
                                                                            _init_schwab_clients() rebuilds trader/market
                                                                            recreate keepalive_task + streamer_task
                                                                            (advisory lock held throughout — never released)
                                  ◀── {app, success, error?} ─────────────
   ◀── {app, success, error?} ──
[wizard advances step (trader→market) or shows scoped per-app error + Retry]
```

A reader can trace the primary use case (click Reconnect → land back authenticated → live data
resumes) end to end by following the arrows above; the Retry path re-enters at "POST
/api/reauth/start" for the failed app only (a fresh nonce is minted — a failed exchange has
already consumed the old one).

### Recommended Project Structure

```
apps/sidecar/
├── reauth_admin.py          # NEW: POST /sidecar/admin/reauth/{start,exchange} (mirrors health.py/chain_proxy.py idiom)
├── main.py                  # EDIT: app.state.cfg, app.state.keepalive_task/streamer_task, reinit_schwab_session()
├── token_store.py           # EDIT: new make_reauth_writer() (anchors refresh_issued_at; routine writer untouched)
├── config.py                # EDIT: + SIDECAR_ADMIN_TOKEN, SCHWAB_WEB_CALLBACK_URL
└── tests/test_reauth_admin.py  # NEW

packages/adapters/src/postgres/
├── migrations/0024_reauth_nonces.sql   # NEW
└── schema.ts                            # EDIT: + reauthNonces table (Python-written, Drizzle-tracked — brokerTokens precedent)

packages/core/src/reauth/         # NEW bounded context (mirrors exits/ layout exactly)
├── domain/types.ts
├── application/ports.ts          # ForStartingReauth, ForExchangingReauth
├── application/startReauth.ts
├── application/exchangeReauth.ts
└── index.ts

packages/adapters/src/
├── sidecar/reauth-adapter.ts     # NEW: fetch-based, mirrors positions-reconciler.ts exactly
└── memory/reauth.ts              # NEW: in-memory twin (architecture-boundaries.md rule 8)

packages/contracts/src/reauth.ts  # NEW: browser-facing Zod schemas (mirrors rule-settings.ts style)

apps/server/src/
├── config.ts                     # EDIT: + SIDECAR_ADMIN_TOKEN
├── adapters/http/reauth.routes.ts # NEW: mirrors settings.routes.ts exactly
└── main.ts                       # EDIT: wire adapter + use-cases + mount inside authReadGroup

apps/web/src/
├── lib/reauth-callback.ts        # NEW: pure capture/strip helpers, unit-testable without DOM
├── hooks/useReauthWizard.ts       # NEW: mirrors useRuleSettings.ts's apiFetch pattern
├── components/ReauthWizard.tsx    # NEW: Dialog-based, per UI-SPEC
├── components/AuthExpiredBanner.tsx  # EDIT: mount wizard trigger, update copy per UI-SPEC
└── main.tsx                      # EDIT: capture+strip ?code/&state as the FIRST statement, before render

docs/
├── architecture/stack-decisions.md   # EDIT: new decision entry (docs-first task)
└── operations/schwab-reauth-runbook.md  # EDIT: add the UI path section
```

### Pattern 1: schwab-py hosted flow without a local server (verified)

**What:** Build the authorize URL and exchange the redirect with two synchronous schwab-py
calls — no `client_from_login_flow` (binds `127.0.0.1:8182`), no `client_from_manual_flow`
(interactive CLI copy-paste convenience wrapper, not usable server-side either).

**When to use:** Any server-side / headless OAuth flow where the redirect lands on a
publicly-reachable domain instead of localhost.

**Verified signatures** [CITED: schwab-py.readthedocs.io/en/latest/auth.html,
github.com/alexgolec/schwab-py/blob/main/schwab/auth.py — cross-checked against this
codebase's own proven-live calls in `apps/sidecar/seed_token.py:101,165-169`]:

```python
# AuthContext = collections.namedtuple('AuthContext', ['callback_url', 'authorization_url', 'state'])

def get_auth_context(api_key, callback_url, state=None) -> AuthContext:
    """Pure, local, NO network call. Builds the URL via authlib's
    OAuth2Client.create_authorization_url() against
    https://api.schwabapi.com/v1/oauth/authorize. If state=None, authlib
    generates one internally; pass an explicit nonce to control it."""

def client_from_received_url(
    api_key, app_secret, auth_context, received_url,
    token_write_func, asyncio=False, enforce_enums=True,
):
    """BLOCKING network call — POSTs to
    https://api.schwabapi.com/v1/oauth/token via authlib's fetch_token().
    received_url only needs its `code`/`state` query params to be present
    (schwab-py extracts them internally) — the URL's own scheme/host do
    NOT need to match anything Schwab-side; only redirect_uri (set from
    auth_context.callback_url) is validated against Schwab's registration.
    On success, invokes token_write_func(wrapped_token_blob) — this IS
    the write path, not a separate step. Raises on any failure (bad/
    expired code, state mismatch) BEFORE token_write_func is ever called."""
```

Existing proven usage — `apps/sidecar/seed_token.py:163-169`:
```python
state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("state", [None])[0]
ctx = schwab.auth.get_auth_context(env[key_env], env[cb_env], state=state)
schwab.auth.client_from_received_url(
    env[key_env], env[secret_env], ctx, url,
    _make_seed_writer(db_url, key, app_id),
)
```
The wizard's exchange handler is this same call shape, with the sidecar's own DB-resolved
`app_id` (from the nonce lookup) selecting which app's key/secret/writer to use, instead of a
CLI positional argument.

**Blocking-call pitfall:** `client_from_received_url` makes a real HTTP POST via authlib
(synchronous `requests`-backed, not `httpx`). Calling it directly inside `async def` route
handler blocks the event loop for the round-trip duration — the exact class of problem
`main.py` already solves for psycopg2:

```python
# Source: apps/sidecar/main.py:170-174 (existing precedent for wrapping blocking I/O)
lock_conn = await loop.run_in_executor(
    None, try_acquire_sidecar_lock, cfg.DATABASE_URL
)
```
Apply the same wrapping to `client_from_received_url` in the new exchange route.
`get_auth_context` is pure/local and safe to call synchronously (no network).

### Pattern 2: In-process client + streamer re-init while holding the lock

**What:** After a successful exchange, rebuild `app.state.trader_client`/`market_client` AND
restart the two background tasks that consume them, without releasing the Postgres advisory
lock.

**Why merely rebuilding the client objects is not enough** — both background tasks capture a
**local variable** reference once, before their loops:

```python
# apps/sidecar/streamer.py:384-389
async def start_streamer(app: object) -> None:
    trader_client = getattr(app.state, "trader_client", None)   # captured ONCE, here
    if trader_client is None:
        ...
    # every use below reads the LOCAL `trader_client`, never app.state again
```
```python
# apps/sidecar/main.py:67 (_trader_token_keepalive)
client = getattr(app.state, "trader_client", None)   # captured ONCE, here
```
Replacing `app.state.trader_client` after a fresh exchange changes nothing for either already-
running task — they keep using the stale (but not-yet-expired, since it was fresh moments ago)
client until their own reconnect/retry logic eventually fires, which could be minutes away.
This is a genuine correctness gap CONTEXT.md's own language ("restarts its streamer session
in-process") requires closing, not merely an optimization.

**Current gap:** `keepalive_task`/`streamer_task` are local variables inside
`_acquire_lock_and_init`'s per-lock-cycle block (`main.py:201,207`) — nothing outside that
function can reference or cancel them today except the function's own `finally` (triggered
only by heartbeat failure / shutdown, `main.py:229-237`).

**Recommended change (main.py):**
1. In `lifespan()`, after `cfg = SidecarConfig()` succeeds, add `app.state.cfg = cfg` — route
   handlers only receive `Request`, not the lifespan closure's `cfg`; mirrors how
   `app.state.db_url` is already read by `health.py`'s route handler.
2. In `_acquire_lock_and_init`, store the two tasks directly on `app.state` instead of local
   variables only (`app.state.keepalive_task = asyncio.create_task(...)`,
   `app.state.streamer_task = asyncio.create_task(...)`), and have the existing `finally` block
   cancel `app.state.keepalive_task`/`app.state.streamer_task` (same objects — no behavior
   change for the lock-loss/shutdown path).
3. Add a new function, callable from the exchange route:
```python
async def reinit_schwab_session(app: FastAPI, cfg: object) -> bool:
    """Cancel + recreate the keepalive/streamer tasks and rebuild both Schwab
    clients from freshly-written tokens, WITHOUT touching the advisory lock.
    Returns False (no-op) if this instance is not currently the lock holder —
    the caller should report a transient failure rather than silently doing
    nothing (e.g. mid rolling-deploy rollover)."""
    if not getattr(app.state, "has_lock", False):
        return False
    for attr in ("keepalive_task", "streamer_task"):
        t = getattr(app.state, attr, None)
        if t is not None:
            t.cancel()
    for attr in ("keepalive_task", "streamer_task"):
        t = getattr(app.state, attr, None)
        if t is not None:
            with suppress(asyncio.CancelledError):
                await t
    _init_schwab_clients(app, cfg)   # already rebuilds BOTH clients unconditionally — idempotent
    app.state.keepalive_task = asyncio.create_task(_trader_token_keepalive(app))
    app.state.streamer_task = asyncio.create_task(start_streamer(app))
    return True
```
Calling this after EITHER app's successful exchange is safe and simple (accepted redundancy: a
market-only re-auth also bounces the streamer, even though the streamer only uses
`trader_client` per `streamer.py`'s own "Trader client only — never market_client" rule —
a brief reconnect blip is cheaper than conditional logic for a twice-per-re-auth-cycle event).

### Pattern 3: Atomic single-use nonce consumption

**What:** Validate AND consume the CSRF nonce in one round trip, so a replayed exchange request
can never succeed twice.

```sql
-- packages/adapters/src/postgres/migrations/0024_reauth_nonces.sql
CREATE TABLE "reauth_nonces" (
	"state" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reauth_nonces" ENABLE ROW LEVEL SECURITY;
```
Mirrors every existing table's bare `.enableRLS()` call with no explicit policy — the
established convention here (`schema.ts` rows 1-563 all follow this shape), not a new pattern
to invent.

```python
# sidecar exchange handler — validate + consume in one statement
with conn, conn.cursor() as cur:
    cur.execute(
        "DELETE FROM reauth_nonces WHERE state = %s "
        "AND created_at > now() - interval '10 minutes' "
        "RETURNING app_id",
        (state,),
    )
    row = cur.fetchone()
if row is None:
    # invalid, expired, or already-consumed nonce — reject, do not guess an app_id
    ...
app_id = row[0]
```
No periodic cleanup job is needed for correctness — the TTL is enforced at consumption time,
not by a background sweep. `ponytail: unconsumed/expired rows accumulate at ~1 row per wizard
click; add a cleanup query only if row count becomes an observed problem (extremely unlikely
at this app's usage volume).`

### Pattern 4: Hexagonal port/use-case shape for a thin proxy (this codebase's own law)

Even a near-passthrough capability gets a `packages/core` port + use-case in this codebase —
confirmed by `jobs.routes.ts`'s `makeEnqueueJobUseCase` wrapping a bare `jobQueue.enqueue` call,
and by every other route in `apps/server/src/adapters/http/`. Mirror `exits/` bounded-context
layout exactly (`packages/core/src/exits/application/ports.ts`,
`packages/core/src/exits/application/getExitAdvice.ts`,
`packages/core/src/exits/index.ts` barrel — all read in full during this research):

```typescript
// packages/core/src/reauth/application/ports.ts
export type ReauthError = { readonly kind: "network-error" | "upstream-error"; readonly message: string };
export type ReauthApp = "trader" | "market";
export type ForStartingReauth = (app: ReauthApp) => Promise<Result<{ authUrl: string }, ReauthError>>;
export type ForExchangingReauth = (redirectUrl: string) =>
  Promise<Result<{ app: ReauthApp | null; success: boolean; error: string | null }, ReauthError>>;
```
The adapter implementing these ports (`packages/adapters/src/sidecar/reauth-adapter.ts`) mirrors
`positions-reconciler.ts` field-for-field: injectable `fetch`, Zod `safeParse` at the boundary,
`AUTH_EXPIRED`/network/parse error mapping into `Result`, and the `SIDECAR_ADMIN_TOKEN` header
attached exactly like `Authorization: Bearer` is attached in `bearer.ts` — a plain header value
comparison server-side too (`bearer.ts:14` uses `auth !== \`Bearer ${token}\`` — no timing-safe
compare exists anywhere in this codebase today; match that convention for
`SIDECAR_ADMIN_TOKEN` rather than introducing a new one, unless the user wants the extra
hardening).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth2 authorize URL + token exchange | A hand-rolled `requests`/`httpx` POST to Schwab's token endpoint | `schwab.auth.get_auth_context` + `client_from_received_url` (already proven live via `seed_token.py`) | authlib already handles PKCE/state/error-response parsing correctly; a hand-rolled version would need to reimplement all of it for zero benefit |
| CSRF `state` validation | A stateless HMAC-signed token | The DB-backed nonce table + atomic `DELETE ... RETURNING` | Explicitly rejected in CONTEXT.md; a DB row is the only way to get true single-use replay-kill semantics without also tracking "used" tokens elsewhere |
| `refresh_issued_at` anchoring | A second bespoke UPDATE hand-copied from `seed_token.py`'s `_make_seed_writer` | Extract that UPSERT logic into a new shared `token_store.make_reauth_writer(db_url, app_id, key)`, called by both the CLI script and the new admin route | One tested writer instead of two near-duplicate copies of the same 8-column UPSERT; optional whether `seed_token.py` itself is refactored to call it too (not required for this phase's correctness) |
| Bearer-token comparison for `SIDECAR_ADMIN_TOKEN` | A new timing-safe-compare helper | Plain `!==`/`!=` equality, matching `bearer.ts:14`'s existing `MCP_BEARER_TOKEN` convention | Consistency with the one other shared-secret gate already in this codebase; flag as optional hardening if the user wants it, not a blocker |
| Wizard modal / step UI | A hand-rolled modal or custom dialog primitive | Existing `Dialog`/`DialogContent`/`DialogHeader` (`apps/web/src/components/ui/dialog.tsx`) + `Button`/`buttonClass` (Phase-21) | UI-SPEC's own explicit "No new dependency, no new shadcn component" line; `RuleSettingsModal.tsx` is the direct precedent to copy |
| Session persistence across the full-page redirect | A custom "remember where I was" mechanism | Supabase's own `getSession()` (localStorage-backed, no network) — already how `useAuthSession.ts:29` restores session on every page load | The redirect-and-back round trip is just an ordinary page reload from Supabase's perspective; `persistSession` (supabase-js default) already survives it with zero new code |

**Key insight:** every hard part of this phase (OAuth mechanics, encryption, single-writer lock
discipline) already has a working, production-proven implementation somewhere in this
codebase. The actual net-new code is small: two sidecar routes, one small table, one
background-task-lifecycle fix, and UI plumbing that mirrors `RuleSettingsModal`/
`useRuleSettings` almost line-for-line.

## Common Pitfalls

### Pitfall 1: `refresh_issued_at` silently never advances
**What goes wrong:** The wizard reports "success" (200 OK, tokens written) but the AUTH_EXPIRED
banner never clears, and CONTEXT.md's own "re-check refresh_issued_at within 5 minutes" gate
fails forever.
**Why it happens:** `token_store.py`'s `token_write_func` deliberately never touches
`refresh_issued_at` (`token_store.py:19-21` docstring: "NEVER updates refresh_issued_at... a
fresh dance resets the clock" is describing the OLD CLI path's separate UPSERT, not this
function). Reusing `token_store.make_token_callbacks`'s writer as-is for the wizard exchange
silently reproduces this gap.
**How to avoid:** Anchor `refresh_issued_at = now()` explicitly after a successful
`client_from_received_url` call returns (it only returns without raising once
`token_write_func` has already run) — either via a new shared `make_reauth_writer` (Pattern 3
above) or a follow-up `UPDATE broker_tokens SET refresh_issued_at = now() WHERE app_id = %s`.
**Warning signs:** `seed_token.py`'s own `_verify_and_finish` freshness check
(`seed_token.py:212-244`) is the exact test to mirror in the new admin route — a per-app
"seeded"/"STALE" verdict, never a bare 200.

### Pitfall 2: Streamer/keepalive tasks keep using the stale client object
**What goes wrong:** After a "successful" re-auth, live streaming ticks still stop working
minutes later (the streamer was never told about the new token) or the trader keep-alive ping
starts failing against a client object schwab-py itself has already internally rotated out of
sync with the DB.
**Why it happens:** See Pattern 2 above — both background tasks capture
`app.state.trader_client` into a local variable once, before entering their loops
(`streamer.py:384-389`, `main.py:67`). Reassigning `app.state.trader_client` doesn't reach a
running task.
**How to avoid:** Cancel and `await` both tasks before rebuilding the clients, then recreate
them — the `reinit_schwab_session` helper in Pattern 2.
**Warning signs:** A wizard "success" state that doesn't correspond to the live badge
recovering; the streamer's own reconnect-backoff log lines never firing (because nothing told
it to reconnect).

### Pitfall 3: Blocking the event loop during exchange
**What goes wrong:** `/sidecar/health` and the live streamer's message pump both freeze for the
duration of the Schwab token-endpoint round trip (typically sub-second, but non-zero and
externally-dependent).
**Why it happens:** `client_from_received_url` makes a real synchronous HTTP POST (authlib
defaults to `requests`, not `httpx`) — calling it directly inside `async def` blocks the single
event loop thread.
**How to avoid:** Wrap the call in `loop.run_in_executor(None, ...)`, exactly mirroring
`main.py:170-174`'s existing pattern for `try_acquire_sidecar_lock` (also a blocking psycopg2
call).
**Warning signs:** `/sidecar/health` latency spikes correlated with re-auth wizard use; any
streamer message-pump gap logged during that window.

### Pitfall 4: Schwab `redirect_uri` exact-match failure
**What goes wrong:** Schwab's token endpoint rejects the exchange even with a valid code,
because the `redirect_uri` sent at token-exchange time doesn't byte-for-byte match what was
sent at authorize time (OAuth2 spec requirement, enforced by Schwab).
**Why it happens:** The sidecar reconstructs `auth_context` at exchange time from
`get_auth_context(api_key, SCHWAB_WEB_CALLBACK_URL, state=nonce)` — if `SCHWAB_WEB_CALLBACK_URL`
differs even by a trailing slash or `http` vs `https` from what was used to mint the original
authorize URL (or from what's registered in the Schwab Developer Portal), the exchange fails.
**How to avoid:** Use ONE new config value (`SCHWAB_WEB_CALLBACK_URL=https://morai.wtf`, no
trailing slash) for both the start and exchange calls, and confirm it is the exact string
registered in the Schwab Developer Portal for both the trader AND market apps — CONTEXT.md's
note that `https://morai.wtf` was "registered as an additional callback URL" does not specify
whether it was added to one app or both; **this must be verified before the exchange route can
work for both apps** (see Open Questions).
**Warning signs:** One app's exchange works, the other's fails identically every time with an
`invalid_grant`/`redirect_uri_mismatch`-shaped error from Schwab.

### Pitfall 5: React double-invoke fires the exchange call twice
**What goes wrong:** In dev (StrictMode double-effect-invoke) or on a user hitting back/forward
after landing, the exchange POST fires twice for the same `code`.
**Why it happens:** `main.tsx:17` already wraps the app in `<StrictMode>`; any `useEffect` that
triggers the exchange call without a one-shot guard will double-fire in dev.
**How to avoid:** Guard the auto-resume exchange call with a module-level or ref-based
"already attempted this href" flag, not component state (component state resets on
double-mount; a module-level flag or the act of stripping the URL via `history.replaceState`
before the second mount's effect runs does not, since the SECOND mount reads a URL that's
already been stripped). Simplest: perform the capture-and-strip at the very top of `main.tsx`
(module scope, runs once, before React even renders) rather than inside a component effect —
this sidesteps StrictMode double-invoke entirely, since it's not a React effect at all.
**Warning signs:** Two `POST /api/reauth/exchange` calls in the network tab for one redirect
landing; the second one correctly fails (nonce already consumed) but is wasted traffic and a
confusing log line.

### Pitfall 6: Authorization code TTL (~30s) exceeded
**What goes wrong:** A slow round trip (SPA capture → server → sidecar → Schwab token
endpoint) lands after Schwab has already expired the code, and the exchange fails even though
everything is implemented correctly.
**Why it happens:** Schwab's authorization codes are single-use and short-lived (documented
industry-standard OAuth2 behavior, consistent with the runbook's own warning at
`schwab-reauth-runbook.md:53-54`: "Schwab's authorization code expires around 30 seconds after
you copy it").
**How to avoid:** The wizard's own design already minimizes this (no confirm screen, auto-
resume, immediate POST) — just don't add any await-able delay (extra round trip, artificial
loading state, analytics beacon) between landing and the exchange POST.
**Warning signs:** Exchanges failing intermittently, correlated with slow network conditions
or a debugger breakpoint during manual testing (which is why this failure mode is easy to
create accidentally while developing/testing the wizard).

### Pitfall 7: Retry-after-failure reusing a consumed nonce
**What goes wrong:** A "Retry" click resends the SAME old redirect URL/state instead of
starting a fresh authorize flow, and the exchange fails again for a different reason (nonce
already consumed) — masking the real per-app error.
**Why it happens:** The atomic `DELETE ... RETURNING` consumes the nonce row on the FIRST
exchange attempt regardless of whether the subsequent `client_from_received_url` call
succeeds or raises (the delete happens before the schwab-py call, to resolve `app_id`).
**How to avoid:** The UI-SPEC's own design already calls for this correctly: "Retry" re-enters
step 1 (idle → click Authorize with Schwab again), which calls `/api/reauth/start` fresh (new
nonce, new authorize URL) — never attempts to resubmit the old redirect URL.
**Warning signs:** A "Retry" implementation that stores and resubmits the captured
`redirectUrl` instead of restarting the whole per-app flow.

### Pitfall 8: Logging the code or full redirect URL
**What goes wrong:** The authorization code (or the full URL containing it) ends up in
sidecar/server logs, violating CONTEXT.md's explicit "never log the authorization code
anywhere in our stack" rule and this codebase's broader token-logging discipline (V6,
`token_store.py:24-28`).
**Why it happens:** The natural instinct when debugging a failed exchange is to log the
request body or the exception message, which for an `httpx`/`requests`-raised HTTP error may
echo response/request detail.
**How to avoid:** Follow the EXACT existing convention in `chain_proxy.py:251-257` and
`positions-reconciler.ts:76-83` — log only `type(exc).__name__` (Python) /
`e.constructor.name` (TS), never `str(exc)` or the request body, on every failure path in the
new routes.
**Warning signs:** Any `logger.error`/`console.error` call in the new files that interpolates
`redirect_url`, `received_url`, or an exception's full message rather than just its type name.

### Pitfall 9: Re-init attempted while the lock isn't held
**What goes wrong:** During a Railway rolling-deploy rollover window, a sidecar instance could
receive an exchange request while `app.state.has_lock` is `False` (mid re-acquire) — attempting
`reinit_schwab_session` in that state would try to rebuild clients this instance has no
business holding.
**Why it happens:** `_acquire_lock_and_init`'s outer `while True` loop (`main.py:165-247`) can
be in the "lost the lock, retrying" phase at any time; the admin routes run independently of
that loop.
**How to avoid:** `reinit_schwab_session` checks `app.state.has_lock` first and returns `False`
(no-op) rather than proceeding — the route handler maps this to a "temporarily unavailable,
try again" per-app error rather than silently succeeding with no actual effect.
**Warning signs:** A wizard success response that doesn't correspond to any actual client
rebuild, during or shortly after a deploy.

## Code Examples

### Sidecar admin route shape (mirrors `health.py`/`chain_proxy.py` idiom)

```python
# Source: pattern derived from apps/sidecar/health.py:1-116 and chain_proxy.py:175-274
# (APIRouter, JSONResponse for errors, Request-scoped app.state access, log-type-only)
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()

@router.post("/sidecar/admin/reauth/start")
async def reauth_start(request: Request, body: StartBody,
                        x_sidecar_admin_token: str = Header(...)) -> JSONResponse:
    cfg = request.app.state.cfg
    if x_sidecar_admin_token != cfg.SIDECAR_ADMIN_TOKEN:
        raise HTTPException(status_code=401)
    # ... get_auth_context (sync, local) + INSERT reauth_nonces + return {app, authUrl, state}
```

### Web: capture-and-strip at module scope (runs once, before React renders)

```typescript
// apps/web/src/lib/reauth-callback.ts — pure, unit-testable without DOM
export function parseReauthRedirect(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.has("code") && url.searchParams.has("state")) {
    return href;
  }
  return null;
}

// apps/web/src/main.tsx — FIRST statement, before createRoot(...).render(...)
// (imperative history.replaceState wrapper stays a thin, untested shim; parseReauthRedirect
// is the pure/tested part)
```

### New migration + schema.ts entry

```sql
-- packages/adapters/src/postgres/migrations/0024_reauth_nonces.sql (next free number,
-- confirmed via migrations/meta/_journal.json's last entry: idx 23, "0023_gex_implied_carry")
CREATE TABLE "reauth_nonces" (
	"state" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reauth_nonces" ENABLE ROW LEVEL SECURITY;
```
```typescript
// packages/adapters/src/postgres/schema.ts — new table, same shape convention as
// ruleOverrides (schema.ts:559-563) and brokerTokens (schema.ts:218-241)
export const reauthNonces = pgTable("reauth_nonces", {
  state: text("state").primaryKey(),
  appId: text("app_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```

## State of the Art

Not applicable — this phase reuses a pinned, already-integrated library (schwab-py 1.5.1) via
functions this codebase already calls successfully in production. No "old approach → new
approach" migration exists; the CLI path (`seed_token.py`) stays as the documented fallback,
unchanged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `https://morai.wtf` was registered as an additional callback URL on **both** the trader AND market Schwab Developer Portal app configs, not just one | Pitfall 4, Open Questions | If only one app has it registered, that app's exchange will fail every time with a redirect_uri mismatch — the other app's wizard step would need to keep using the CLI fallback until the Portal registration is fixed |
| A2 | authlib's `OAuth2Client` (used internally by schwab-py) validates the received URL's `state` query param against the value passed into `get_auth_context`, providing a second layer of CSRF defense beyond the app's own nonce table | Pattern 1 | Low risk even if wrong — the app's own DB-backed nonce table is the primary, already-locked CSRF control; this is a defense-in-depth bonus, not load-bearing |
| A3 | A single shared `SCHWAB_WEB_CALLBACK_URL` value (one Railway env var) is used for both the trader and market apps' hosted flow, since CONTEXT.md describes registering one URL, not two | Architecture Patterns, Config plumbing | If Schwab requires app-specific callback URLs even when the domain is identical, two env vars would be needed instead of one — a trivial fix if wrong, but changes the config schema shape |

**None of these are HIGH-risk to the phase's core mechanics** (the OAuth calls themselves are
verified against the codebase's own working code) — they are deployment/registration details
that depend on state in the Schwab Developer Portal this research cannot inspect directly.

## Open Questions (RESOLVED)

1. **RESOLVED 2026-07-13 — user confirmed the callback is registered on BOTH the trader and
   market Schwab apps** (recorded in 37-CONTEXT.md). 37-07's test-trader-first-then-market
   sequencing stays as belt-and-braces. Original question:
   Is `https://morai.wtf` registered as a callback URL on both the trader AND market Schwab
   apps, or only one?
   - What we know: CONTEXT.md states "`https://morai.wtf` registered as an additional callback
     URL 2026-07-12 (processes after market hours); live by 2026-07-14 session" — singular
     phrasing, doesn't disambiguate per-app.
   - What's unclear: Schwab Developer Portal app configuration is external state this research
     cannot query.
   - Recommendation: the planner should add a verification/checkpoint task (or the user should
     confirm directly) before the exchange route is considered done for both apps — test the
     trader app's wizard step first; if it works, immediately test market before assuming both
     are configured identically.

2. **RESOLVED — treated as low-risk per its own recommendation** (multiple redirect URIs are
   supported; CLI fallback unaffected while its original entry remains registered). Original
   question: Does `SCHWAB_MARKET_CALLBACK_URL`/`SCHWAB_TRADER_CALLBACK_URL` (the existing CLI
   127.0.0.1:8182 values) need to coexist with the new web callback URL in the same app
   registration, or does adding the new URL risk disturbing the existing CLI fallback?
   - What we know: Schwab apps support multiple registered redirect URIs simultaneously (this
     is why CONTEXT.md calls morai.wtf an "additional" callback URL, not a replacement).
   - What's unclear: whether Schwab enforces any additional per-URL scoping (e.g., HTTPS-only
     validation that could reject `127.0.0.1` differently once a second URL exists) — no
     evidence either way was found.
   - Recommendation: low risk, treat as resolved by CONTEXT.md's own "additional" phrasing; the
     CLI fallback is unaffected as long as its original callback URL entry is not removed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| schwab-py | Sidecar OAuth mechanics | Only inside the Railway sidecar container (`Dockerfile:7` installs from `requirements.txt`) — **not installed on this dev machine** | 1.5.1 (pinned) | N/A — verified via GitHub/readthedocs source instead of a local `pip show` |
| Postgres (Supabase) | New `reauth_nonces` table | Assumed available in every environment per existing project convention (`docs/architecture/deployment.md`) | 16 | none needed |
| FastAPI / Hono / Zod / TanStack Query / Drizzle | All plumbing layers | Already installed workspace-wide | workspace-pinned | none needed |

**Missing dependencies with no fallback:** none — nothing new is required.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | Vitest (workspace), `apps/sidecar` side: pytest + pytest-asyncio |
| Config file | root `vitest` config (workspace-level) + `apps/sidecar/pytest.ini` (`testpaths = tests`, `asyncio_mode = auto`) |
| Quick run command (TS) | `bun run test` (root `package.json:8` → `vitest run`) |
| Quick run command (sidecar) | `cd apps/sidecar && python -m pytest tests/test_reauth_admin.py -x` |
| Full suite command | `bun run test` (TS) + `python -m pytest` (sidecar, from `apps/sidecar/`) |

### Phase Requirements → Test Map

No REQUIREMENTS.md IDs exist for this phase yet (ROADMAP.md: `Requirements: TBD`). Mapping
against CONTEXT.md's own locked decisions instead:

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| Nonce single-use consumption | A second exchange with the same `state` fails | contract test (testcontainers) | `bun run test -- rule-overrides.contract` style, new `reauth-nonces.contract.test.ts` | ❌ Wave 0 |
| `refresh_issued_at` anchored on wizard exchange | Post-exchange row shows `refresh_issued_at > now() - 5min` | pytest | `pytest tests/test_reauth_admin.py::test_anchors_refresh_issued_at -x` | ❌ Wave 0 |
| Streamer/keepalive re-init | Old task objects are cancelled, new ones created, lock never released | pytest (mock app.state) | `pytest tests/test_reauth_admin.py::test_reinit_cancels_old_tasks -x` | ❌ Wave 0 |
| Partial failure isolation | Trader success + market failure leaves trader's fresh token untouched | pytest | `pytest tests/test_reauth_admin.py::test_partial_failure_isolation -x` | ❌ Wave 0 |
| URL capture/strip is pure | `parseReauthRedirect` returns null without both `code`+`state` | Vitest unit | `vitest run reauth-callback.test.ts` | ❌ Wave 0 |
| Wizard step machine | Trader success auto-advances to market step; per-app error scoped | Vitest + Testing Library | `vitest run ReauthWizard.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant quick-run command above for the layer just touched.
- **Per wave merge:** full `bun run test` + full `pytest` (sidecar).
- **Phase gate:** both suites green, plus `bun run typecheck && bun run lint`, before
  `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `apps/sidecar/tests/test_reauth_admin.py` — covers nonce consumption, refresh_issued_at
  anchor, re-init task lifecycle, partial-failure isolation
- [ ] `packages/adapters/src/postgres/repos/reauth-nonces.contract.test.ts` (if a TS-side
  repo is added at all — likely NOT needed, since only Python touches this table; add only if
  the planner decides the server needs to read nonce state directly, which CONTEXT.md's design
  does not require)
- [ ] `apps/web/src/lib/reauth-callback.test.ts`
- [ ] `apps/web/src/components/ReauthWizard.test.tsx`
- [ ] Framework install: none — pytest and Vitest are both already fully configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | New `SIDECAR_ADMIN_TOKEN` shared secret gates both admin endpoints (server-to-sidecar only; sidecar has no public Railway domain per GW-05) |
| V3 Session Management | yes | The CSRF `state` nonce is a session-like single-use token — DB-backed, 10-minute TTL, atomic delete-on-consume |
| V4 Access Control | yes | Server's own `/api/reauth/*` routes mounted inside the EXISTING `authReadGroup` (Supabase JWT-gated, `main.ts:562-574`) — no new unauthenticated surface |
| V5 Input Validation | yes | Zod `.strict()` at the server's browser-facing contracts (mirrors `rule-settings.ts`); Pydantic models at the sidecar's FastAPI boundary (mirrors `chain_proxy.py`'s `ChainResponse`) |
| V6 Cryptography | yes (existing, untouched) | `TOKEN_ENCRYPTION_KEY` / `pgp_sym_encrypt` already handles token-at-rest encryption (`token_store.py`) — this phase writes through that same path, never bypasses it |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| OAuth `state` replay/CSRF | Spoofing/Tampering | Single-use DB nonce, atomic `DELETE ... RETURNING`, 10-minute TTL (CONTEXT.md-locked design) |
| Authorization code leakage via logs | Information Disclosure | Never log the code or full redirect URL anywhere in this stack (CONTEXT.md rule); log only `type(exc).__name__` / `e.constructor.name` on every failure path, matching `chain_proxy.py`/`positions-reconciler.ts`'s existing convention |
| Unauthenticated sidecar admin access | Elevation of Privilege | `SIDECAR_ADMIN_TOKEN` header required on both admin routes; sidecar remains reachable only via Railway private networking (no public domain, GW-05) |
| Second concurrent streamer session (dual-writer) | Tampering (triggers Schwab `invalid_grant`) | Advisory lock (GW-04) held continuously through re-init; old background tasks are cancelled and awaited BEFORE new ones are created — never two live `StreamClient` sessions at once |
| Stale/reused authorization code | Tampering | Schwab's own ~30s code TTL is a backstop; the wizard's no-confirm-screen, immediate-POST design (UI-SPEC-locked) keeps the round trip fast |

## Sources

### Primary (HIGH confidence — this codebase's own working code)
- `apps/sidecar/seed_token.py` — proven-live `get_auth_context`/`client_from_received_url` usage, `_verify_and_finish` freshness gate, `_make_seed_writer` UPSERT shape
- `apps/sidecar/main.py` — lifespan/lock-acquisition/background-task structure, `_init_schwab_clients`
- `apps/sidecar/streamer.py`, `apps/sidecar/token_store.py`, `apps/sidecar/advisory_lock.py`, `apps/sidecar/config.py`, `apps/sidecar/health.py`, `apps/sidecar/chain_proxy.py`
- `apps/server/src/main.ts`, `apps/server/src/config.ts`, `apps/server/src/adapters/http/settings.routes.ts`, `supabase-auth.ts`, `bearer.ts`, `cors-policy.ts`
- `packages/adapters/src/sidecar/positions-reconciler.ts`, `packages/adapters/src/postgres/schema.ts`, migration files 0003/0022/0023, `migrations/meta/_journal.json`
- `packages/core/src/exits/application/ports.ts`, `getExitAdvice.ts`, `index.ts`
- `packages/contracts/src/rule-settings.ts`
- `apps/web/src/main.tsx`, `App.tsx`, `hooks/useAuthSession.ts`, `hooks/useRuleSettings.ts`, `lib/rpc.ts`, `screens/RuleSettingsModal.tsx`, `components/system/Button.tsx`, `components/Shell.tsx`, `components/AuthExpiredBanner.tsx`
- `docs/operations/schwab-reauth-runbook.md`, `docs/architecture/deployment.md`, `docs/architecture/stack-decisions.md`
- `.planning/phases/37-.../37-CONTEXT.md`, `37-UI-SPEC.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/config.json`

### Secondary (MEDIUM confidence — official docs, cross-checked against primary above)
- schwab-py.readthedocs.io/en/latest/auth.html — function signatures for `easy_client`,
  `client_from_login_flow`, `client_from_manual_flow`, `client_from_token_file`,
  `client_from_access_functions`
- github.com/alexgolec/schwab-py/blob/main/schwab/auth.py — `AuthContext` namedtuple shape,
  `get_auth_context`/`client_from_received_url` full signatures and internal mechanics
  (authlib `OAuth2Client`, `TOKEN_ENDPOINT`)

### Tertiary (LOW confidence)
- none — every claim in this document is either grounded in this codebase's own code or
  cross-checked against schwab-py's official documentation/source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every piece already proven in this codebase
- Architecture (sidecar OAuth + re-init): HIGH — verified against both this codebase's working
  code and schwab-py's official source; the streamer/keepalive staleness bug was independently
  derived by tracing the actual code, not assumed
- Architecture (server/web proxy + wizard): HIGH — direct precedent exists for every piece
  (`settings.routes.ts`, `useRuleSettings.ts`, `RuleSettingsModal.tsx`)
- Pitfalls: HIGH for the sidecar-side ones (derived from reading the actual task-lifecycle
  code); MEDIUM for the Schwab-Portal-registration-scope question (A1/A2/A3, genuinely external
  state this research cannot inspect)

**Research date:** 2026-07-13
**Valid until:** 30 days (stable — schwab-py is pinned and explicitly "never upgrade without
research review"; the only fast-moving unknown is the Schwab Developer Portal registration
state, which is operational, not code)
