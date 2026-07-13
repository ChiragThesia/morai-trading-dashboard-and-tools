---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
verified: 2026-07-13T19:05:36Z
status: human_needed
score: 6/7 must-haves verified (REAUTH-07 docs verified; deploy + live UAT are the human gate)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Set SIDECAR_ADMIN_TOKEN (identical strong random value ≥16 chars) on BOTH the Railway server service AND the sidecar service, and SCHWAB_WEB_CALLBACK_URL=https://morai.wtf on the sidecar service, then deploy server + sidecar."
    expected: "Both services boot (config.ts Zod requires SIDECAR_ADMIN_TOKEN.min(16); sidecar config requires SIDECAR_ADMIN_TOKEN). The adapter's X-Sidecar-Admin-Token header matches the sidecar's constant-time guard, so /api/reauth/start returns 200 rather than 401/500."
    why_human: "Railway env + deploy is an external operational action; the shared-secret match cannot be verified from source. A mismatched or missing token fails closed (401 at the sidecar) — see runbook §Environment."
  - test: "At the next real 7-day expiry (~2026-07-20), reconnect Schwab end-to-end through the wizard: click Reconnect on the AuthExpiredBanner, authorize Trader with Schwab, land back on morai.wtf, confirm the wizard silently exchanges and advances to Market, authorize Market, and confirm the banner clears within ~30s and live data resumes — with no CLI and no service restart."
    expected: "Both apps reconnect; refresh_issued_at is freshly anchored (banner clears); the sidecar re-inits clients + streamer in-process holding the advisory lock (no restart, no second streamer session); live SPX/chain data resumes."
    why_human: "The Schwab OAuth round-trip is an external interactive service (7-day interactive-auth ceiling) — the real code exchange, redirect landing, and live-data resumption can only be exercised against Schwab's live authorize flow. This is the phase's designed acceptance gate (VALIDATION.md)."
---

# Phase 37: In-app Schwab Re-auth Wizard Verification Report

**Phase Goal:** The operator reconnects Schwab entirely in-app — a banner-driven Reconnect wizard runs the hosted OAuth flow (trader then market), lands back on morai.wtf, exchanges the code silently, and re-inits the sidecar's clients + streamer in-process, so live data resumes with no CLI and no service restart.
**Verified:** 2026-07-13T19:05:36Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (requirement) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | REAUTH-01 — sidecar `/start` mints per-app authorize URL (`get_auth_context`, no local callback server) returning `{app,authUrl,state}`; `/exchange` exchanges the redirect via `client_from_received_url` written through `token_store` encryption; both require `SIDECAR_ADMIN_TOKEN` | ✓ VERIFIED | `reauth_admin.py:82-110` (start), `:160-211` (exchange), `_require_admin_token :59-66` (hmac). Behavioral: `test_valid_request_mints_authurl_and_persists_nonce`, `test_successful_exchange_anchors_refresh_reinits_and_returns_ok_true` (green) |
| 2 | REAUTH-02 — CSRF `state` is a single-use Postgres nonce (`reauth_nonces`, migration 0024, 10-min TTL) validated AND consumed atomically (`DELETE … RETURNING`); a replay can never succeed twice | ✓ VERIFIED (behavioral) | `_consume_nonce :125-140` (DELETE … WHERE created_at > now()-10min RETURNING). Migration 0024 + `schema.ts:572` reauthNonces + `_journal.json` idx 24 agree. Behavioral vs real Postgres: `test_nonce_single_use_and_ttl`, `test_replay_of_consumed_state_fails` (green) |
| 3 | REAUTH-03 — per-app success is a `refresh_issued_at` freshness re-check (within 5 min), never a bare HTTP 200; the wizard writer anchors `refresh_issued_at` so the banner clears | ✓ VERIFIED (behavioral) | `make_reauth_writer` UPSERT anchors `refresh_issued_at=now()` (`token_store.py`); `_is_freshly_anchored :143-157`; exchange returns `ok=fresh` (`:194,:211`). Behavioral: `test_make_reauth_writer_anchors_refresh_issued_at`, `test_ok_false_when_refresh_issued_at_not_freshly_anchored` (green) |
| 4 | REAUTH-04 — after exchange the sidecar re-inits clients AND cancels+recreates streamer/keepalive (+indices) tasks in-process holding the advisory lock (no restart, never two streamers); trader-success+market-failure keeps trader's token, retry only the failed app | ✓ VERIFIED (behavioral) | `reinit_schwab_session :145-212` — cancels+awaits all THREE tasks, `has_lock` no-op guard (`:162`) + post-await re-check (WR-04, `:180`), WR-02 rebuild-failure still recreates + re-raises. Behavioral: `test_reinit_cancels_old_tasks_and_creates_new_ones`, `test_reinit_noop_when_lock_not_held`, `test_reinit_recreates_tasks_and_reraises_on_client_init_failure`, `test_reinit_aborts_task_recreation_when_lock_lost_mid_reinit`, `test_partial_failure_isolation_leaves_other_app_untouched` (green) |
| 5 | REAUTH-05 — server proxies `/api/reauth/{start,exchange}` behind Supabase JWT (operator-only), forwards the admin-token header, returns GENERIC errors (never echo code/state/redirect); no MCP tool mints/exchanges (HTTP-only) | ✓ VERIFIED | `reauth.routes.ts` (generic `{error:"internal"}` 500, slim re-parse `:41`); `main.ts:561` mounts `reauthRoutes` on `apiRouter` inside `authReadGroup` (JWT middleware `:585`); adapter sends `X-Sidecar-Admin-Token :46`. Grep: NO MCP file references reauth. Server route tests green |
| 6 | REAUTH-06 — AuthExpiredBanner shows Reconnect in BOTH red + amber states opening the Trader→Market modal; on morai.wtf landing the SPA captures `?code=&state=`, strips via `history.replaceState` before render, auto-resumes + exchanges silently; code/redirect URL never renders or logs | ✓ VERIFIED | `AuthExpiredBanner.tsx` renders `<ReauthWizard expiredApps={…}/>` at BOTH sites (`:95` red, `:125` amber — delta blocker 6fbfe76); `reauth-callback.ts` strip-before-render + one-shot consume; `main.tsx:14` capture runs before `createRoot :21`; `ReauthWizard.tsx` sequential machine + WR-01 `.catch` + per-app Retry. Tests: `reauth-callback.test.ts` (strip), `ReauthWizard.test.tsx`, `useReauth.test.ts` (green) |
| 7 | REAUTH-07 — docs record wizard-primary/CLI-fallback + runbook UI path; `SIDECAR_ADMIN_TOKEN`+`SCHWAB_WEB_CALLBACK_URL` set on Railway before deploy; next real re-auth (~2026-07-20) through the wizard as human UAT | ⚠️ PARTIAL — docs ✓ VERIFIED, deploy + live UAT → HUMAN | `stack-decisions.md:438` D26 (wizard PRIMARY / CLI fallback); `schwab-reauth-runbook.md:20` Primary Path: In-App Wizard + `:46` Fallback: CLI. Railway env + deploy + live re-auth are the human gate (see Human Verification) |

**Score:** 6/7 truths fully verified in code; REAUTH-07 docs verified, its deploy + live-UAT completion is the designed human acceptance gate. **0 behavior-unverified** — every behavior-dependent invariant (nonce replay-kill, freshness gate, reinit cancel/recreate lifecycle, has_lock re-check, partial-failure isolation) has a passing behavioral test against real Postgres.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/sidecar/reauth_admin.py` | `/start` + `/exchange` endpoints, hmac guard, atomic nonce, run_in_executor, freshness gate, per-app isolation | ✓ VERIFIED | 211 lines; all mechanisms present + tested |
| `apps/sidecar/main.py::reinit_schwab_session` | cancel+recreate all 3 tasks, hold lock, WR-04 re-check, WR-02 recovery | ✓ VERIFIED | `:145-212`, no lock release anywhere in fn |
| `apps/sidecar/token_store.py::make_reauth_writer` | UPSERT wrapped blob + anchor `refresh_issued_at=now()` | ✓ VERIFIED | anchor in `_REAUTH_UPSERT_SQL` |
| `apps/sidecar/config.py` | `SIDECAR_ADMIN_TOKEN` + `SCHWAB_WEB_CALLBACK_URL` | ✓ VERIFIED | `:38`, `:43` (default `https://morai.wtf`) |
| `packages/contracts/src/reauth.ts` | split sidecar (`{app,authUrl,state}`) vs slim browser (`{authUrl}`) schemas, no code/state echo, all `.strict()` | ✓ VERIFIED | CR-01/CR-02 fix; exchange resp `{app,ok}` only |
| `packages/core/src/reauth/application/ports.ts` (+ use-cases) | `ForStartingReauth`/`ForExchangingReauth`, imports only `@morai/shared` | ✓ VERIFIED | hexagon-pure |
| `packages/adapters/src/sidecar/reauth-adapter.ts` | parses sidecar shape, narrows to `{authUrl}`, sends admin-token header, logs only constructor name | ✓ VERIFIED | `:91` parse, `:95` narrow, `:46` header |
| `apps/server/src/adapters/http/reauth.routes.ts` | zero-logic Result-mappers, generic errors | ✓ VERIFIED | mounted JWT-gated in main.ts |
| `apps/web/src/lib/reauth-callback.ts` | capture + strip before render, one-shot consume, never log | ✓ VERIFIED | module-scope strip |
| `apps/web/src/components/ReauthWizard.tsx` | sequential machine, WR-01 catch, per-app retry, expiredApps prop | ✓ VERIFIED | 230 lines |
| `apps/web/src/components/AuthExpiredBanner.tsx` | Reconnect both states, expiredApps at BOTH sites | ✓ VERIFIED | `:95`, `:125` (6fbfe76) |
| `packages/adapters/.../0024_reauth_nonces.sql` + `schema.ts` + `_journal.json` | table (state PK, app_id, created_at), all three agree | ✓ VERIFIED | idx 24, drift-consistent |
| `docs/architecture/stack-decisions.md` / `docs/operations/schwab-reauth-runbook.md` | D26 + runbook UI path | ✓ VERIFIED | wizard-primary, CLI-fallback |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| `reauth-adapter.ts` | sidecar `/sidecar/admin/reauth/*` | `X-Sidecar-Admin-Token` header (`:46`) ↔ `_require_admin_token` hmac guard | ✓ WIRED |
| `main.ts` | `reauthRoutes` | `.route("/", reauthRoutes(...))` on `apiRouter` inside JWT `authReadGroup` (`:561/:585/:586`) | ✓ WIRED |
| `reauth_admin` exchange | `make_reauth_writer` + `reinit_schwab_session` | anchor + bounce clients (`:186`, `:203`) | ✓ WIRED |
| nonce INSERT/DELETE | `reauth_nonces` table | migration 0024 | ✓ WIRED |
| `main.tsx` capture/strip | `ReauthWizard` auto-resume | `consumeCapturedRedirect` → `useReauth.exchange` → invalidate `["status"]` → banner clears | ✓ WIRED |
| `AuthExpiredBanner` | `ReauthWizard` | `expiredApps` prop at BOTH render sites | ✓ WIRED (6fbfe76) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Reauth-scoped TS suite (contracts/core/adapters/server/web) | `bunx vitest run reauth` | 8 files / 54 tests passed | ✓ PASS |
| Sidecar reauth suites | `pytest tests/test_reauth_admin.py tests/test_reinit_session.py tests/test_token_store.py -q` | 21 passed | ✓ PASS |
| Full cross-layer gate (recorded 37-07-SUMMARY, trusted) | `bun run test` / sidecar `pytest` / `bun run typecheck` / `bun run lint` | 3423 TS + 84 pytest, typecheck 0, lint 0 | ✓ PASS (recorded) |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
| --- | --- | --- | --- |
| REAUTH-01 | 37-04 | ✓ SATISFIED | Truth 1 |
| REAUTH-02 | 37-01, 37-04 | ✓ SATISFIED | Truth 2 |
| REAUTH-03 | 37-03, 37-04 | ✓ SATISFIED | Truth 3 |
| REAUTH-04 | 37-03, 37-04 | ✓ SATISFIED | Truth 4 |
| REAUTH-05 | 37-02, 37-05 | ✓ SATISFIED | Truth 5 |
| REAUTH-06 | 37-06 | ✓ SATISFIED | Truth 6 |
| REAUTH-07 | 37-01, 37-07 | ? NEEDS HUMAN (docs done) | Truth 7 — deploy + live UAT |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX` debt markers, no `TODO`/`HACK`/`PLACEHOLDER`, no empty-return stubs across the 15 phase-modified source files. (`return null` in `reauth-callback.ts` is the correct pure-function no-match path, data-flow gated — not a stub.)

### Human Verification Required

1. **Railway env + deploy** — set `SIDECAR_ADMIN_TOKEN` (identical, ≥16 chars) on BOTH server + sidecar services, `SCHWAB_WEB_CALLBACK_URL=https://morai.wtf` on the sidecar, then deploy server + sidecar. Fails closed (401) on any token mismatch.
2. **Live re-auth UAT (~2026-07-20)** — reconnect Schwab end-to-end through the wizard (Trader → land on morai.wtf → silent exchange → Market → banner clears, live data resumes, no CLI/restart). This is the phase's designed acceptance gate (external Schwab interactive-auth ceiling).

### Gaps Summary

No code-level gaps. The two prior code blockers (CR-01/CR-02 conflated `/start` contract) and four warnings (WR-01 silent start failure, WR-02 non-atomic reinit, WR-03 stale sessionStorage, WR-04 reinit reentrancy) plus the reviewer's delta blocker (6fbfe76 — `expiredApps` computed but never passed) are all verified fixed in the committed code, each with a matching regression test. The only remaining work is the operational deploy + the live human re-auth UAT — both were the phase's designed human acceptance gate from the start (VALIDATION.md).

---

_Verified: 2026-07-13T19:05:36Z_
_Verifier: Claude (gsd-verifier)_
