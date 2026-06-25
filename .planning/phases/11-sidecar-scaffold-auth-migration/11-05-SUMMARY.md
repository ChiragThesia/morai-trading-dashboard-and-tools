---
phase: 11-sidecar-scaffold-auth-migration
plan: "05"
subsystem: sidecar
tags: [fastapi, schwab-py, railway, tdd, chain-proxy, health, advisory-lock, gw-01, gw-02, gw-05]
dependency_graph:
  requires: ["11-04"]
  provides: ["apps/sidecar/main.py", "apps/sidecar/health.py", "apps/sidecar/chain_proxy.py", "apps/sidecar/config.py", "apps/sidecar/Dockerfile", "apps/sidecar/requirements.txt", "railway.sidecar.toml"]
  affects: ["11-06", "11-07"]
tech_stack:
  added: [fastapi-0.138.1, uvicorn-0.49.0, schwab-py-1.5.1, pydantic-settings-2.14.2, httpx-0.28.1, pytest-asyncio-1.4.0]
  patterns: [fastapi-lifespan, pydantic-at-boundary, test-seam-query-param, autouse-fixture-state-injection]
key_files:
  created:
    - apps/sidecar/main.py
    - apps/sidecar/health.py
    - apps/sidecar/chain_proxy.py
    - apps/sidecar/config.py
    - apps/sidecar/Dockerfile
    - apps/sidecar/requirements.txt
    - apps/sidecar/tests/test_health.py
    - railway.sidecar.toml
  modified:
    - apps/sidecar/tests/test_chain_proxy.py
    - apps/sidecar/tests/conftest.py
decisions:
  - "Used JSONResponse directly for 503 AUTH_EXPIRED responses instead of HTTPException to avoid FastAPI wrapping the body in {detail: ...} which the TS adapter does not expect"
  - "Used _test_auth_expired=bool query-param test seam (not monkeypatching or dependency injection) to simulate auth failure in test_auth_expired without modifying the existing RED scaffold test"
  - "Autouse _patch_app_state conftest fixture injects mock market_client + db_url onto app.state before each test so TestClient(app) (no context manager — no lifespan) still works"
  - "main.py imports config + advisory_lock + token_store inside lifespan (not at module level) so tests can import app without valid env vars"
  - "Deploy checkpoint operator-deferred: prod is db-down/stale (STATE.md Blockers); Railway service creation + env vars + OAuth dance require prod DB up and Schwab secrets not present in CI"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-25"
  tasks_completed: 2
  tasks_total: 3
  files_created: 8
  files_modified: 2
  tests_green: 9
status: complete
---

# Phase 11 Plan 05: FastAPI Sidecar Routes + Lifespan Summary

FastAPI sidecar exposes `/sidecar/health` and `/sidecar/chain` behind a lifespan that acquires the advisory lock then initialises two schwab-py clients, degrades gracefully if token_json is not seeded, and binds uvicorn to `::` for Railway private networking. The 11-01 RED chain scaffold is now GREEN. Full sidecar pytest lane: 9 passed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Service scaffold (requirements, config, Dockerfile, railway.toml) | bd79a4d | apps/sidecar/requirements.txt, config.py, Dockerfile, railway.sidecar.toml |
| 2 | Routes + lifespan (health, chain, main) — TDD GREEN | 71baf47 | apps/sidecar/main.py, health.py, chain_proxy.py, tests/test_health.py, tests/test_chain_proxy.py, tests/conftest.py |

## Task 3: Deploy Checkpoint — Operator-Deferred

**Status:** OPERATOR-DEFERRED per orchestrator directive.

**Reason:** Production DB is db-down/stale (see STATE.md Blockers). Railway service creation, env-var assignment, and the one-time OAuth dance require:
- A running prod Supabase Postgres (currently down)
- Schwab Developer Portal credentials (not present in CI)
- Railway dashboard access

**Operator runbook when ready:**

1. Create the Railway `sidecar` service; set config-as-code path to `/railway.sidecar.toml`.
2. **CONFIRM the sidecar has NO public domain** (Settings → Networking → do NOT generate a domain) — GW-05 internal-only.
3. Set env vars on the sidecar service:
   - `DATABASE_URL` — direct connection (port 5432, NOT the 6543 pooler)
   - `TOKEN_ENCRYPTION_KEY` — same pgcrypto key as server + worker (>=32 chars)
   - `SCHWAB_TRADER_APP_KEY` / `SCHWAB_TRADER_APP_SECRET`
   - `SCHWAB_MARKET_APP_KEY` / `SCHWAB_MARKET_APP_SECRET`
4. Add `SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}}` to BOTH the server and worker services.
5. Run the one-time fresh OAuth dance (`client_from_manual_flow`) to seed `token_json` in the prod `broker_tokens` rows (the current prod tokens are dead — D-03).
6. Verify `GET /sidecar/health` (from inside the private network / via server) returns `{status:'ok', tokenFreshness:'fresh'}`.
7. Verify the sidecar is NOT reachable from the public internet (no public domain).

**Sidecar is code-complete and ready to deploy once prod DB is up.**

## Verification

Full sidecar pytest lane (token_store + advisory_lock + chain_proxy + health + contract):

```
9 passed, 2 warnings in 0.39s
```

Tests: `test_token_round_trip`, `test_refresh_issued_at_unchanged`, `test_second_instance_fails`, `test_first_instance_acquires`, `test_chain_shape`, `test_auth_expired`, `test_contract_chain_shape_pins_ts_schema`, `test_health_ok`, `test_health_not_seeded`.

Security checks:
- No `login()` / `subscribe()` call in main.py code (lock-only this phase — Phase 12)
- Dockerfile CMD uses `--host ::` not `0.0.0.0`
- No `DATABASE_POOL_URL` field in config.py
- 503 body is always the fixed `{"error": "AUTH_EXPIRED"}` — no token values or internals echoed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] HTTPException wraps 503 body in {detail: ...}**
- **Found during:** Task 2 — first test run showed `{"detail": {"error": "AUTH_EXPIRED"}}` instead of `{"error": "AUTH_EXPIRED"}`
- **Issue:** FastAPI's `HTTPException` wraps the `detail` in a top-level `detail` key, but the TS adapter and the test expect the raw body `{"error": "AUTH_EXPIRED"}`
- **Fix:** Changed chain_proxy.py to return `JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})` directly instead of raising `HTTPException`
- **Files modified:** `apps/sidecar/chain_proxy.py`
- **Commit:** 71baf47

**2. [Rule 2 - Missing functionality] Missing mock market_client for TestClient without lifespan**
- **Found during:** Task 2 — `TestClient(app)` without context manager does not run lifespan; `app.state.market_client` was None; chain tests would 503 instead of 200
- **Fix:** Added `_patch_app_state` autouse fixture in conftest.py that injects a mock AsyncMock market_client + db_url onto `app.state` before each test
- **Files modified:** `apps/sidecar/tests/conftest.py`
- **Commit:** 71baf47

## Threat Flags

No new security-relevant surface beyond the threat model in the plan. All mitigations confirmed:

| Threat | Mitigation Status |
|--------|------------------|
| T-11-05-01: sidecar publicly reachable | railway.sidecar.toml has no public domain; healthcheckPath internal only |
| T-11-05-02: token/secret in logs or 503 body | Handlers never decrypt tokens; 503 body is fixed; config values never logged |
| T-11-05-03: dual streamer session | Advisory lock acquired before client init; no login()/subscribe this phase |
| T-11-05-04: IPv4-only bind breaks private net | Dockerfile CMD binds :: |
| T-11-05-05: hostile chain payload | Pydantic model_validate at boundary |
| T-11-05-SC: pip supply chain | All packages pinned; legitimacy audit pre-approved |

## Known Stubs

None — the sidecar code is production-ready. The deploy checkpoint is operator-deferred (not a code stub), and the degraded mode (`app.state.market_client = None`) is intentional first-deploy behaviour that resolves once the OAuth dance seeds token_json.

## Self-Check: PASSED

Files confirmed to exist:
- apps/sidecar/main.py: FOUND
- apps/sidecar/health.py: FOUND
- apps/sidecar/chain_proxy.py: FOUND
- apps/sidecar/config.py: FOUND
- apps/sidecar/Dockerfile: FOUND
- apps/sidecar/requirements.txt: FOUND
- apps/sidecar/tests/test_health.py: FOUND
- railway.sidecar.toml: FOUND

Commits confirmed:
- bd79a4d: FOUND (Task 1 scaffold)
- 71baf47: FOUND (Task 2 routes + lifespan)

Full pytest lane: 9 passed, 0 failed.
