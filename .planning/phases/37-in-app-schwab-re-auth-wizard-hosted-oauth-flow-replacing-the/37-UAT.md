---
status: testing
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
source: [37-VERIFICATION.md]
started: 2026-07-14T06:20:00Z
updated: 2026-07-14T06:20:00Z
---

## Current Test

number: 1
name: Railway env + deploy (SIDECAR_ADMIN_TOKEN both services, SCHWAB_WEB_CALLBACK_URL)
expected: |
  SIDECAR_ADMIN_TOKEN (identical strong random ≥16 chars) set on BOTH Railway server
  AND sidecar services; SCHWAB_WEB_CALLBACK_URL=https://morai.wtf on sidecar; both boot
  (Zod min(16) gates); /api/reauth/start returns 200 not 401/500.
awaiting: user response

## Tests

### 1. Railway env + deploy
expected: Both services boot with shared admin token; /api/reauth/start returns 200.
result: [pending confirmation — phases 37-38 deployed to prod 2026-07-13 per deploy record]

### 2. Live end-to-end wizard re-auth at next 7-day expiry (~2026-07-20)
expected: |
  Click Reconnect on AuthExpiredBanner → authorize Trader with Schwab → land on
  morai.wtf → wizard silently exchanges, advances to Market → authorize Market →
  banner clears within ~30s, live data resumes. No CLI, no service restart,
  refresh_issued_at freshly anchored, sidecar re-inits clients+streamer in-process.
result: [pending — TIME-LOCKED to real token expiry ~2026-07-20; this is the phase's designed acceptance gate]
