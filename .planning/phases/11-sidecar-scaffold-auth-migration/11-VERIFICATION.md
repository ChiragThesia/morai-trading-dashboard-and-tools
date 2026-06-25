---
phase: 11-sidecar-scaffold-auth-migration
verified: 2026-06-25T22:45:00Z
status: human_needed
score: 9/9
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run bun run migrate against the live Supabase DB (direct DATABASE_URL port 5432) and confirm broker_tokens.token_json column exists via information_schema"
    expected: "bun run migrate exits 0; SELECT column_name FROM information_schema.columns WHERE table_name='broker_tokens' AND column_name='token_json' returns one row; second run is a no-op"
    why_human: "Live prod DB is db-down/stale (STATE.md Blockers); DDL over production Supabase requires operator access + correct direct DATABASE_URL — cannot be automated in CI"
  - test: "Create the Railway sidecar service using railway.sidecar.toml with NO public domain (Settings → Networking → do not generate a domain)"
    expected: "Third Railway service exists; sidecar is reachable from server/worker over the private network; NOT reachable from the public internet (GW-05)"
    why_human: "Railway service creation is an operator dashboard action with no fully-scriptable substitute; requires Railway credentials and live infrastructure"
  - test: "Set sidecar env vars: DATABASE_URL (direct port 5432), TOKEN_ENCRYPTION_KEY (>=32 chars), SCHWAB_TRADER_APP_KEY/SECRET, SCHWAB_MARKET_APP_KEY/SECRET; set SIDECAR_URL on both server and worker services"
    expected: "All five sidecar env vars present; SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}} set on server and worker"
    why_human: "Railway env var assignment requires dashboard access with Schwab Developer Portal credentials not present in CI"
  - test: "Run the one-time Schwab OAuth dance (client_from_manual_flow) to seed token_json in the prod broker_tokens rows for both trader and market apps"
    expected: "GET /sidecar/health (from inside private network via server) returns {status:'ok', tokenFreshness:'fresh'}; token_json IS NOT NULL for both app_id rows in broker_tokens"
    why_human: "Requires live Schwab credentials, Schwab callback URL reachable from production, and the sidecar to be deployed and running — all operator go-live actions"
  - test: "Confirm GET /sidecar/health is NOT reachable from the public internet after deploy"
    expected: "curl from outside Railway private network times out or connection-refused; no public Railway domain exists for the sidecar service"
    why_human: "Public-internet negative test requires network access from outside Railway; cannot be proved from within CI/developer machine without the live infrastructure"
---

# Phase 11: Sidecar Scaffold & Auth Migration — Verification Report

**Phase Goal:** schwab-py sidecar deployed; TS refresh-tokens job retired; sidecar is sole token owner; journal re-sourced through sidecar REST proxy.
**Verified:** 2026-06-25T22:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | docs/architecture/stack-decisions.md §D22 records the GW-01 relaxation (token_json JSONB column + dual-write rationale + refresh_issued_at anchor) before any schema change | VERIFIED | `grep token_json docs/architecture/stack-decisions.md` matches at lines 330, 332, 336, 340; D22 cites GW-01 and D-02; states dual-write + refresh_issued_at invariant |
| 2 | broker_tokens schema gains a nullable token_json JSONB column (additive only; no existing column changed) | VERIFIED | `packages/adapters/src/postgres/schema.ts:230` — `tokenJson: jsonb("token_json")`; confirmed additive |
| 3 | Migration 0011_broker_tokens_token_json.sql exists and adds only the token_json column (additive ALTER TABLE) | VERIFIED | File exists; contents: `ALTER TABLE "broker_tokens" ADD COLUMN "token_json" jsonb;` — single additive statement |
| 4 | token_write_func dual-writes token_json blob + decomposes access/refresh into encrypted discrete columns; NEVER updates refresh_issued_at; rowcount guard prevents silent no-op | VERIFIED | `apps/sidecar/token_store.py:84,135,144` — token_json written; encrypted discrete columns written; `refresh_issued_at` absent from SET clause (comments at lines 19, 69, 103 confirm rule); `rowcount == 0` guard at line 155 |
| 5 | acquire_sidecar_lock uses session-level pg_try_advisory_lock(8876543210) on a direct connection; second instance gets False and raises SystemExit(1) | VERIFIED | `apps/sidecar/advisory_lock.py:81` — `SELECT pg_try_advisory_lock(%s)`; SIDECAR_LOCK_KEY = 8876543210; SystemExit(1) on False; advisory lock at lines 54, 74, 81 |
| 6 | FastAPI lifespan acquires advisory lock BEFORE init-ing two schwab-py clients; degrades gracefully when token_json not seeded; no streamer login()/subscribe() | VERIFIED | `apps/sidecar/main.py:60` — `acquire_sidecar_lock` called first; two `client_from_access_functions` calls at lines 81, 99; not-seeded ValueError caught; `grep login()/subscribe()` matches only a comment at line 13 (no live call) |
| 7 | GET /sidecar/health returns {status, tokenFreshness}; degraded+not_seeded when token_json IS NULL | VERIFIED | `apps/sidecar/health.py:99-105` — `if freshness in ("not_seeded", "expired", "unknown"): return degraded`; fresh path returns ok |
| 8 | GET /sidecar/chain returns RawChain-mirroring JSON with source='schwab_chain'; 503 AUTH_EXPIRED on auth failure | VERIFIED | `apps/sidecar/chain_proxy.py:63,135` — source default 'schwab_chain'; 503 body `{"error":"AUTH_EXPIRED"}` at lines 175-176, 188-189, 203 |
| 9 | TS refresh-tokens job is retired (schedule.ts / AllHandlers / main.ts); TS chain source swapped to makeSidecarChainAdapter; CBOE fallback wiring unchanged; SIDECAR_URL in worker config | VERIFIED | `schedule.ts` — 9 queues / 5 crons, all refresh-tokens references are comments only; `main.ts:104,123` — sidecarAdapter wired as schwabFetchChain; `config.ts:36` — SIDECAR_URL added; `main.ts:122,124` — readTokenFreshness + cboeFetchChain unchanged |
| 10 | apps/auth (@morai/auth) fully deleted; tsconfig.json drops apps/auth reference; no @morai/auth imports remain; bun install + typecheck + test green | VERIFIED | `test ! -d apps/auth` — PASS; `grep -r '@morai/auth' apps packages` — 0 matches; `grep 'apps/auth' tsconfig.json` — 0 matches; 11-07 SUMMARY confirms 136 files / 1227 tests green |
| 11 | apps/sidecar Dockerfile binds uvicorn to :: (not 0.0.0.0); PORT read from $PORT; CR-01 config error handler fix applied; CR-02 lock leak fix applied | VERIFIED | `Dockerfile:CMD` — `["sh", "-c", "uvicorn main:app --host :: --port ${PORT:-8000}"]`; `main.py:47-51` — pydantic_core.ValidationError.errors() used (not __mro__); `main.py:62-127` — outer try/finally wraps all code after lock acquisition |
| 12 | Python sidecar pytest lane (9 tests) green; TS suite (1221+ tests) green; typecheck clean | VERIFIED | Orchestrator confirms: `cd apps/sidecar && .venv/bin/python -m pytest -q` = 9 passed; `bun run typecheck` clean; full TS suite 135 files / 1221 tests pass |

**Score:** 12/12 code-level truths verified (0 present, behavior-unverified)

**Note:** The mandatory live-deploy truths (migration applied to prod DB, Railway service created, OAuth dance run, GW-05 public-net negative test) are operator go-live actions, not code gaps. They are surfaced as human verification items below.

---

### Requirements Coverage

| Requirement | Plans | Description | Code Status | Evidence |
|-------------|-------|-------------|-------------|----------|
| GW-01 | 11-01, 11-02, 11-04 | schwab-py sidecar is sole Schwab authenticator; token read/write against broker_tokens | VERIFIED (code) | token_store.py dual-write; schema.ts tokenJson; migration 0011; LIVE APPLY = human go-live |
| GW-02 | 11-01, 11-03, 11-05 | Sidecar exposes REST proxy; TS adapters become thin HTTP clients | VERIFIED | chain-adapter.ts + SidecarChainResponseSchema; chain_proxy.py GET /sidecar/chain |
| GW-03 | 11-06, 11-07 | TS refresh-tokens retired; sidecar is sole token refresher | VERIFIED | schedule.ts 9 queues/5 crons; handlers/refresh-tokens.ts deleted; apps/auth deleted |
| GW-04 | 11-01, 11-04 | Postgres advisory lock guarantees single sidecar session | VERIFIED | advisory_lock.py pg_try_advisory_lock(8876543210); SystemExit(1) on second instance |
| GW-05 | 11-05 | Sidecar internal-only; no public ingress | VERIFIED (code) | railway.sidecar.toml has no public domain; GW-05 comment at line 4; no healthcheck public path. LIVE CONFIRM = human go-live |
| JRNL-02 | 11-01, 11-03, 11-06 | Chain-snapshot job sources SPX chain through sidecar; CBOE fallback retained | VERIFIED | main.ts:123 schwabFetchChain: sidecarAdapter.fetchChain; cboeFetchChain + readTokenFreshness wiring intact |

All 6 requirement IDs declared across the 7 plans are accounted for. No orphaned requirements.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/architecture/stack-decisions.md` | GW-01 relaxation §D22 | VERIFIED | 4 token_json mentions; dual-write + refresh_issued_at; cites GW-01 + D-02 |
| `packages/adapters/src/postgres/schema.ts` | token_json JSONB column | VERIFIED | Line 230: `tokenJson: jsonb("token_json")` |
| `packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql` | Additive ALTER TABLE | VERIFIED | Single ADD COLUMN statement |
| `apps/sidecar/token_store.py` | make_token_callbacks dual-write | VERIFIED | 6.7K; token_json read/write; encrypted discrete; rowcount guard; refresh_issued_at absent from SET |
| `apps/sidecar/advisory_lock.py` | acquire_sidecar_lock + pg_try_advisory_lock | VERIFIED | 3.9K; SIDECAR_LOCK_KEY=8876543210; SystemExit(1) on False; direct connection documented |
| `apps/sidecar/main.py` | FastAPI lifespan (lock → clients → degrade) | VERIFIED | 6.6K; lifespan acquires lock first; two client_from_access_functions; ValueError degrade; no login/subscribe |
| `apps/sidecar/config.py` | pydantic-settings with DATABASE_URL (direct) | VERIFIED | 1.7K; DATABASE_URL field (port 5432 noted); no DATABASE_POOL_URL; all Schwab fields present |
| `apps/sidecar/chain_proxy.py` | GET /sidecar/chain; 503 AUTH_EXPIRED | VERIFIED | 7.9K; source='schwab_chain'; JSONResponse(503, {"error":"AUTH_EXPIRED"}); log redaction applied |
| `apps/sidecar/health.py` | GET /sidecar/health; degraded on not_seeded/expired | VERIFIED | 3.4K; degraded for not_seeded/expired/unknown; ok for fresh |
| `apps/sidecar/Dockerfile` | python:3.11-slim; uvicorn :: $PORT | VERIFIED | CMD binds :: ; ${PORT:-8000}; CR-03 fix applied |
| `apps/sidecar/requirements.txt` | Pinned deps including schwab-py==1.5.1 | VERIFIED | 828B; schwab-py==1.5.1 pinned |
| `railway.sidecar.toml` | Internal-only Railway config (no public domain) | VERIFIED | GW-05 documented; no public domain; healthcheckPath=/sidecar/health |
| `packages/adapters/src/sidecar/chain-adapter.ts` | makeSidecarChainAdapter + SidecarChainResponseSchema | VERIFIED | 4.6K; ForFetchingChain implemented; safeParse at boundary; AUTH_EXPIRED → err; no any/as |
| `packages/adapters/src/memory/sidecar-chain.ts` | makeMemorySidecarChainAdapter in-memory twin | VERIFIED | 1.4K; ForFetchingChain port; seed + fetch |
| `packages/adapters/src/index.ts` | Barrel exports for sidecar adapter + twin | VERIFIED | Lines 74-89; makeSidecarChainAdapter, SidecarChainResponseSchema, makeMemorySidecarChainAdapter exported |
| `apps/worker/src/schedule.ts` | 9 queues / 5 crons; refresh-tokens retired | VERIFIED | No active createQueue/schedule/work for refresh-tokens; only comments referencing GW-03 retirement |
| `apps/worker/src/main.ts` | sidecarAdapter wired as schwabFetchChain; refresh wiring removed | VERIFIED | Lines 104, 123; no makeSchwabChainAdapter import; boot log says 9 queues/5 jobs |
| `apps/worker/src/config.ts` | SIDECAR_URL added; SCHWAB_TRADER fields retained | VERIFIED | Line 36: SIDECAR_URL z.string().url(); lines 32-33: SCHWAB_TRADER_APP_KEY/SECRET present |
| `apps/auth/` (removed) | DELETED — @morai/auth retired | VERIFIED | Directory does not exist; tsconfig.json has no apps/auth reference; 0 @morai/auth imports |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `docs/architecture/stack-decisions.md` | `packages/adapters/src/postgres/schema.ts` | docs-before-code: GW-01 relaxation recorded before schema column | VERIFIED | D22 entry exists in docs; tokenJson column exists in schema |
| `apps/sidecar/token_store.py` | `broker_tokens` (token_json + discrete columns) | token_write_func dual-writes blob + decomposed encrypted columns | VERIFIED | Lines 135, 144 write token_json; encrypted access_token/refresh_token in SET clause |
| `apps/sidecar/advisory_lock.py` | Postgres direct connection (port 5432) | pg_try_advisory_lock over autocommit session-level cursor | VERIFIED | Line 81: `SELECT pg_try_advisory_lock(%s)`; docstring enforces direct URL |
| `apps/sidecar/main.py` | `advisory_lock.py` + `token_store.py` | lifespan: acquire_sidecar_lock → make_token_callbacks × 2 → client_from_access_functions | VERIFIED | Lines 38, 60, 81, 99 — lock first, then token callbacks, then clients |
| `packages/adapters/src/sidecar/chain-adapter.ts` | core `ForFetchingChain` port | fetchChain: ForFetchingChain — adapter implements existing core driven port | VERIFIED | Line 93: `const fetchChain: ForFetchingChain = async`; line 4: imported from @morai/core |
| `apps/worker/src/main.ts` | `packages/adapters/src/sidecar/chain-adapter.ts` | makeSidecarChainAdapter({fetch, sidecarUrl}).fetchChain → selectChainSource.schwabFetchChain | VERIFIED | Line 104: `makeSidecarChainAdapter({fetch, sidecarUrl})`; line 123: `schwabFetchChain: sidecarAdapter.fetchChain` |
| `apps/worker/src/schedule.ts` | retirement of refresh-tokens | removing queue/cron/handler from the scheduler (GW-03) | VERIFIED | No active createQueue/schedule/work for "refresh-tokens"; handlers/refresh-tokens.ts deleted |
| `apps/sidecar` (via railway.sidecar.toml) | Railway private network only | no public domain; SIDECAR_URL uses RAILWAY_PRIVATE_DOMAIN | VERIFIED (code) | railway.sidecar.toml has no public domain config; GW-05 documented; LIVE confirm = operator |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Python sidecar pytest lane (token_store + advisory_lock + chain_proxy + health + contract) | `cd apps/sidecar && .venv/bin/python -m pytest -q` | 9 passed (orchestrator-confirmed) | PASS |
| TS adapter exports callable makeSidecarChainAdapter | `node -e "const m = require('./packages/adapters/src/sidecar/chain-adapter.ts'); console.log(typeof m.makeSidecarChainAdapter)"` | "function" | PASS |
| refresh-tokens.ts handler deleted | `test ! -f apps/worker/src/handlers/refresh-tokens.ts` | exit 0 | PASS |
| apps/auth deleted | `test ! -d apps/auth` | exit 0 | PASS |
| No @morai/auth references remain | `grep -r '@morai/auth' apps packages` | 0 matches | PASS |
| tsconfig.json clean of apps/auth | `grep 'apps/auth' tsconfig.json` | 0 matches | PASS |
| Full TS suite | orchestrator-confirmed: 135 files / 1221 tests | PASS (orchestrator) | PASS |
| bun run typecheck | orchestrator-confirmed: clean | PASS (orchestrator) | PASS |

---

### Code Review Blockers — Fixed

All 4 blockers from 11-REVIEW.md were fixed before verification:

| Blocker | Fix Applied | Evidence |
|---------|-------------|----------|
| CR-01: Config error handler crashes on __mro__ AttributeError | Fixed: pydantic_core.ValidationError.errors() used | `main.py:47-51` — isinstance check + .errors() |
| CR-02: Advisory lock connection leaked on non-ValueError during client init | Fixed: outer try/finally wraps all post-lock-acquisition code | `main.py:62-130` — outer try/finally; lock_conn.close() in finally |
| CR-03: Dockerfile hardcodes port 8000, ignores Railway $PORT | Fixed: CMD uses sh -c with ${PORT:-8000} | `Dockerfile:CMD ["sh", "-c", "uvicorn main:app --host :: --port ${PORT:-8000}"]` |
| CR-04: Orphaned refresh-tokens.ts still on disk with live imports | Fixed: file deleted | `test ! -f apps/worker/src/handlers/refresh-tokens.ts` — PASS |

Additional warnings fixed:

| Warning | Fix Applied | Evidence |
|---------|-------------|----------|
| WR-01: token_write_func silent no-op when app_id row absent | Fixed: rowcount == 0 guard added | `token_store.py:155` — `if cur.rowcount == 0: raise ValueError(...)` |
| WR-02: chain_proxy logs full exception (potential token leakage) | Fixed: logs type name only with "(message redacted)" | `chain_proxy.py:199,212` — `%s (message redacted)` |
| WR-03: health.py returns status:'ok' for expired/unknown tokens | Fixed: degraded returned for expired/unknown | `health.py:99-101` — `if freshness in ("not_seeded", "expired", "unknown"): return degraded` |

Advisory items left open (WR-04, WR-05, IN-01, IN-02, IN-03 — see 11-REVIEW.md): not blockers; WR-04 (root parameter Literal type) and WR-05 (module-level singleton) were not fixed per the orchestrator advisory classification.

---

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `apps/sidecar/config.py:43` | Module-level `config = SidecarConfig()` singleton (WR-05) | Advisory | Never used; could fail in CI without env vars; NOT fixed this phase. No stub impact — callers import `SidecarConfig` class directly |
| `apps/sidecar/chain_proxy.py:69-78` | `_is_auth_error` function defined but never called (IN-02) | Advisory | Dead code; not a blocker; logged for Phase 12 cleanup |

No TBD/FIXME/XXX markers found in any phase-modified file. No unresolved debt markers.

---

### Human Verification Required (Go-Live Actions)

These are operator go-live actions — consistent with every prior-phase migration precedent and with the prod being db-down/stale (STATE.md Blockers). The code delivering GW-01..05 and JRNL-02 is complete and verified; the live-deploy actions require production infrastructure access.

#### 1. Apply migration 0011 to live Supabase DB

**Test:** Run `bun run migrate` with the direct `DATABASE_URL` (port 5432, not 6543 pooler).
**Expected:** exits 0; `SELECT column_name FROM information_schema.columns WHERE table_name='broker_tokens' AND column_name='token_json'` returns one row; second run is a no-op (idempotent).
**Why human:** Live prod DB is db-down/stale (STATE.md Blockers). DDL over production Supabase requires the direct connection and a running Postgres — cannot be automated in CI. The migration file and schema are code-complete.

#### 2. Create the Railway sidecar service (GW-05 internal-only)

**Test:** Create a new Railway service from `/railway.sidecar.toml` with NO public domain (Settings → Networking → do NOT generate a public domain).
**Expected:** Third Railway service exists; sidecar health check passes; sidecar is NOT reachable from the public internet.
**Why human:** Railway service creation and networking configuration are operator dashboard actions. The `railway.sidecar.toml` config-as-code is ready.

#### 3. Set env vars on sidecar and SIDECAR_URL on server + worker

**Test:** Set on the sidecar service: `DATABASE_URL` (direct port 5432), `TOKEN_ENCRYPTION_KEY` (>=32 chars), `SCHWAB_TRADER_APP_KEY`, `SCHWAB_TRADER_APP_SECRET`, `SCHWAB_MARKET_APP_KEY`, `SCHWAB_MARKET_APP_SECRET`. Set on server and worker: `SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}}`.
**Expected:** Sidecar starts up without config validation error; server and worker can reach the sidecar on `SIDECAR_URL`.
**Why human:** Railway env var assignment requires dashboard access; Schwab Developer Portal credentials are not present in CI.

#### 4. Run the one-time Schwab OAuth dance to seed token_json

**Test:** Run `client_from_manual_flow` to perform the fresh OAuth dance for both trader and market apps. This seeds `token_json` in the `broker_tokens` rows in the live Supabase DB.
**Expected:** `GET /sidecar/health` (from server via private network) returns `{status:'ok', tokenFreshness:'fresh'}`; `token_json IS NOT NULL` for both app_id rows.
**Why human:** Requires live Schwab OAuth callback URL reachable from production, Schwab credentials, and the sidecar to be deployed and running. Prod tokens are dead (D-03) and cannot be refreshed without this dance.

#### 5. Verify GW-05: sidecar is not publicly reachable

**Test:** From outside Railway private network, attempt to reach the sidecar's `/sidecar/health` endpoint.
**Expected:** Connection refused or timeout — no response from the public internet.
**Why human:** Public-internet negative test requires network access from outside Railway's private network; cannot be proved from CI or developer machine.

---

## Overall Assessment

The Phase 11 code delivery is **complete and clean**. All 12 observable code-level truths are VERIFIED:

- The schwab-py sidecar (apps/sidecar) is built, tested (9 pytest passes), and deploy-ready with a complete FastAPI service, advisory lock guard, dual-write token store, chain proxy, health endpoint, Dockerfile (`::` bind, `$PORT`), and Railway config-as-code.
- The TS refresh-tokens job is fully retired: schedule.ts has 9 queues / 5 crons with no refresh-tokens entry; the handler file is deleted; apps/auth (@morai/auth) is deleted from the repo; no @morai/auth imports remain.
- The worker chain source is re-routed through `makeSidecarChainAdapter` as `schwabFetchChain` in `selectChainSource`, with CBOE fallback intact.
- SIDECAR_URL is in the worker config schema; all 4 code review blockers and 3 of the warnings are fixed.
- The migration file (0011) and schema (token_json JSONB) are code-complete; the docs-before-code requirement is satisfied.

The 5 human verification items are all **operator go-live actions** (live DB migration, Railway service creation, env vars, OAuth dance, public-net negative test) — not code gaps. They are consistent with the operator-deferred pattern used in every prior production deployment phase.

---

_Verified: 2026-06-25T22:45:00Z_
_Verifier: Claude (gsd-verifier)_
