---
status: testing
phase: 11-sidecar-scaffold-auth-migration
source: [11-VERIFICATION.md]
started: 2026-06-25T23:00:00Z
updated: 2026-06-26T14:15:00Z
---

## Current Test

number: 4
name: Run the one-time Schwab OAuth dance to seed token_json
expected: |
  client_from_manual_flow seeds token_json for both trader + market app_id rows;
  GET /sidecar/health returns {status:'ok', tokenFreshness:'fresh'}; token_json
  IS NOT NULL for both rows. ORDERING: deploy the 11-06 worker cutover (retire
  refresh-tokens) BEFORE seeding, to avoid the dual-refresher race.
awaiting: user response

## Tests

### 1. Apply migration 0011 (token_json) to the live Supabase DB
expected: `bun run migrate` (direct DATABASE_URL, port 5432 — NOT the 6543 pooler) exits 0; `information_schema.columns` shows `broker_tokens.token_json`; second run is a no-op (idempotent).
result: pass
note: Applied over Supabase session pooler (:5432, the established migration-safe path). information_schema confirms broker_tokens.token_json = jsonb, nullable. Idempotent re-run = no-op (exit 0). Verified via Supabase MCP (project cwcdcosxoaqyqbsfifsh, ACTIVE_HEALTHY) 2026-06-26. (bun run migrate required an inline SIDECAR_URL placeholder because 11-06 made it a required worker-config field — migrate itself uses only DATABASE_URL.)

### 2. Create the Railway sidecar service with NO public domain (GW-05)
expected: third Railway service exists built from `railway.sidecar.toml`; reachable from server/worker over the private network; NOT reachable from the public internet (Settings → Networking → no generated domain).
result: pass
note: |
  Created service `sidecar` (d1bc4298) in morai/production; config-as-code path = railway.sidecar.toml
  (DOCKERFILE build). Live + healthy on deployment 42d9ce71, listening [::]:8080. Domains: serviceDomains=[],
  customDomains=[] → NO public domain (GW-05 satisfied). Two real artifact bugs found + fixed during deploy:
  (1) Dockerfile bare COPY paths would fail the root-context config-as-code build → fixed to root-relative (c95d1d4);
  (2) uvicorn cannot dual-stack bind from CLI → Railway IPv4 healthcheck failed on `::` → switched prod runner to
  Hypercorn `--bind [::]` (dual-stack), which honors RESEARCH Pitfall 5 (IPv6 private net) AND passes the IPv4
  healthcheck (89b2a8a). Verified vs Railway docs.

### 3. Set sidecar env vars + SIDECAR_URL on server/worker
expected: sidecar has DATABASE_URL (direct 5432), TOKEN_ENCRYPTION_KEY (≥32 chars), SCHWAB_TRADER_APP_KEY/SECRET, SCHWAB_MARKET_APP_KEY/SECRET; `SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}}` set on BOTH server and worker.
result: pass
note: |
  6 sidecar secrets wired as Railway reference vars → worker (${{worker.<KEY>}}) so no secret value was ever read
  (operator .env deny-rule honored; Railway resolves them). SIDECAR_URL set on BOTH server + worker; resolves to
  http://sidecar.railway.internal:8080. Required setting PORT=8080 on the sidecar so ${{sidecar.PORT}} resolves
  (Railway-injected PORT is not cross-service referenceable).

### 4. Run the one-time Schwab OAuth dance to seed token_json
expected: `client_from_manual_flow` seeds `token_json` for both trader + market app_id rows; GET /sidecar/health (from inside the private network via server) returns `{status:'ok', tokenFreshness:'fresh'}`; `token_json IS NOT NULL` for both rows.
result: [pending]

### 5. Confirm sidecar is NOT publicly reachable
expected: curl from outside the Railway private network times out / connection-refused; no public Railway domain exists for the sidecar service.
result: pass
note: |
  Sidecar service has zero domains (serviceDomains=[], customDomains=[]) — Railway never generated a public
  domain, so there is no public ingress (GW-05). Only the private network (sidecar.railway.internal:8080) reaches it.
  Optional external-curl negative test is moot with no public hostname to target.

## Summary

total: 5
passed: 4
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- finding: "Advisory lock (GW-04) blocks Railway zero-downtime redeploys"
  severity: major
  status: open
  detail: |
    Railway's rolling deploy starts the new sidecar instance while the old one still runs + holds the
    Postgres advisory lock. The new instance's lifespan calls pg_try_advisory_lock → fails → SystemExit →
    Hypercorn LifespanFailureError → deploy FAILED. The currently-running instance (42d9ce71) is healthy,
    but ANY future sidecar redeploy fails this way until fixed.
  fix: |
    Make the app serve /sidecar/health (degraded) WITHOUT holding the lock, and acquire the lock in a
    background retry task. New instance becomes healthy lock-free → Railway stops old → old releases lock →
    new acquires it. This breaks the rollover deadlock and revisits the GW-04 "fail-fast SystemExit on second
    instance" contract for rolling deploys. Phase 12 (streaming) needs this — the lock matters most there.
    Interim workaround to redeploy: stop/scale-down the running sidecar first (release the lock), then deploy.
