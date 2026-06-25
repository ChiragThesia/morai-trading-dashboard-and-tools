---
status: testing
phase: 11-sidecar-scaffold-auth-migration
source: [11-VERIFICATION.md]
started: 2026-06-25T23:00:00Z
updated: 2026-06-25T23:00:00Z
---

## Current Test

number: 1
name: Apply migration 0011 to live Supabase
expected: |
  bun run migrate exits 0; SELECT column_name FROM information_schema.columns
  WHERE table_name='broker_tokens' AND column_name='token_json' returns one row;
  second run is a no-op.
awaiting: user response

## Tests

### 1. Apply migration 0011 (token_json) to the live Supabase DB
expected: `bun run migrate` (direct DATABASE_URL, port 5432 — NOT the 6543 pooler) exits 0; `information_schema.columns` shows `broker_tokens.token_json`; second run is a no-op (idempotent).
result: [pending]

### 2. Create the Railway sidecar service with NO public domain (GW-05)
expected: third Railway service exists built from `railway.sidecar.toml`; reachable from server/worker over the private network; NOT reachable from the public internet (Settings → Networking → no generated domain).
result: [pending]

### 3. Set sidecar env vars + SIDECAR_URL on server/worker
expected: sidecar has DATABASE_URL (direct 5432), TOKEN_ENCRYPTION_KEY (≥32 chars), SCHWAB_TRADER_APP_KEY/SECRET, SCHWAB_MARKET_APP_KEY/SECRET; `SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}}` set on BOTH server and worker.
result: [pending]

### 4. Run the one-time Schwab OAuth dance to seed token_json
expected: `client_from_manual_flow` seeds `token_json` for both trader + market app_id rows; GET /sidecar/health (from inside the private network via server) returns `{status:'ok', tokenFreshness:'fresh'}`; `token_json IS NOT NULL` for both rows.
result: [pending]

### 5. Confirm sidecar is NOT publicly reachable
expected: curl from outside the Railway private network times out / connection-refused; no public Railway domain exists for the sidecar service.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
