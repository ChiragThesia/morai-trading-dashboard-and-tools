-- 0005_broker_tokens_refresh_error.sql
-- Phase 05, Plan 05 (JOB-02 / D-14): additive nullable column on broker_tokens.
--
-- Persists the per-app refresh failure flag so the server process can surface it
-- at GET /api/status (worker writes after each refresh attempt; server reads via
-- readTokenFreshness — separate processes require DB persistence, not in-memory map).
--
-- NEVER contains token values — only appId + error reason (T-05-11).
-- Nullable, no default: NULL = last refresh succeeded (or no refresh attempted yet).
-- Non-destructive: no DROP, no RENAME, no constraint change.

ALTER TABLE "broker_tokens" ADD COLUMN "last_refresh_error" text;
