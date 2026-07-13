---
phase: 37
slug: in-app-schwab-reauth-wizard
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-13
---

# Phase 37 — Validation Strategy

Formalized from 37-RESEARCH.md's "Validation Architecture" section (plan-checker
blocker #1); requirement IDs updated to the REAUTH-01..07 set minted at planning.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest (workspace) + Testing Library (wizard) + testcontainers (migration/schema) |
| **Framework (sidecar)** | pytest + pytest-asyncio (`apps/sidecar/pytest.ini`, `asyncio_mode = auto`), real Postgres via existing fixtures — SQL never mocked |
| **Quick run (TS)** | `bun run test -- reauth` (workspace filter) |
| **Quick run (sidecar)** | `cd apps/sidecar && python -m pytest tests/test_reauth_admin.py -x` |
| **Full suite** | `bun run test` + `python -m pytest` (from `apps/sidecar/`) |
| **Note** | Token/security path: never log or assert on real codes/states; fixtures use obviously-fake values. Freshness gate assertions use DB-time (`now()`) comparisons, not wall-clock sleeps. |

## Sampling Rate

- **Per task commit:** the touched layer's quick-run command above.
- **Per wave merge:** full `bun run test` + full sidecar `pytest`.
- **Phase gate (37-07):** both suites + `bun run typecheck` + `bun run lint` green;
  the phase's acceptance bar is the live human UAT — the NEXT real re-auth
  (~2026-07-20) performed through the wizard end-to-end.

## Per-Requirement Verification Map

| Requirement | Behavior validated | Test file / command | Test Type |
|-------------|--------------------|---------------------|-----------|
| REAUTH-01 | `/start` returns per-app authorize URL + state; `/exchange` performs the code exchange via `client_from_received_url` (run_in_executor) and reports per-app result | `pytest tests/test_reauth_admin.py -x` (37-04) | pytest (FastAPI TestClient, mocked schwab-py boundary) |
| REAUTH-02 | Nonce single-use: atomic `DELETE … RETURNING` with TTL predicate — second exchange with the same state fails; expired state fails | `pytest tests/test_reauth_admin.py::test_nonce_single_use -x` (37-04) + migration 0024 schema/contract test (37-01) | pytest + testcontainers |
| REAUTH-03 | Wizard exchange anchors `refresh_issued_at` (RED if the routine writer — which deliberately never touches it — were reused instead of `make_reauth_writer`) | `pytest tests/test_reauth_admin.py::test_anchors_refresh_issued_at -x` (37-03) | pytest, RED-if-trap-fires |
| REAUTH-03 | Freshness gate: exchange success = `refresh_issued_at > now() - 5min` re-check, NOT HTTP 200 | pytest (37-04) + wizard advance gated on contract `ok` boolean (37-06) | pytest + Vitest |
| REAUTH-04 | In-process re-init: old streamer/keepalive tasks cancelled AND awaited before new ones created; advisory lock never released; no second streamer session | `pytest tests/test_reauth_admin.py::test_reinit_cancels_old_tasks -x` (37-03) | pytest (mock app.state), RED-if-trap-fires |
| REAUTH-04 | Partial failure isolation: trader success + market failure leaves trader's fresh token untouched; no restart | `pytest tests/test_reauth_admin.py::test_partial_failure_isolation -x` (37-04) | pytest |
| REAUTH-05 | Server proxy: JWT-gated inside existing authReadGroup; `X-Sidecar-Admin-Token` attached; generic error mapping; never echoes code/state; MCP scoped OUT (documented) | server route tests w/ injected fetch fake (37-05) | Vitest |
| REAUTH-05 | Sidecar admin auth: `hmac.compare_digest` on the header, 401 on mismatch/absence | pytest (37-04) | pytest |
| REAUTH-06 | `parseReauthRedirect` pure: returns null unless BOTH `code`+`state` present; strip-before-render via `history.replaceState` | `vitest run reauth-callback.test.ts` (37-06) | Vitest unit |
| REAUTH-06 | Wizard step machine: trader success auto-advances to market; per-app error scoped with per-app Retry; UI-SPEC copy verbatim | `vitest run ReauthWizard.test.tsx` (37-06) | Vitest + Testing Library |
| REAUTH-07 | Integration gate: full TS suite + sidecar pytest + typecheck + lint; runbook UI path; Railway env (`SIDECAR_ADMIN_TOKEN` both services, `SCHWAB_WEB_CALLBACK_URL`) | 37-07 gate commands | full suite + gate |
| REAUTH-07 | Live acceptance: next real re-auth (~2026-07-20) through the wizard, both apps, banner clears | human UAT (37-07 user_setup) | human-verify |

## Cross-Cutting Negative Assertions (every layer)

- No log line anywhere contains the authorization code, state nonce, or full
  redirect URL — grep-verified per plan (`type(exc).__name__` /
  `e.constructor.name` only).
- No contract schema echoes `code`/`state` back in responses (`.strict()` schemas).

## Wave 0 Requirements

- [ ] `apps/sidecar/tests/test_reauth_admin.py` — nonce consumption,
  refresh_issued_at anchor, re-init task lifecycle, partial-failure isolation,
  admin-token 401
- [ ] migration 0024 `reauth_nonces` schema test (37-01; TS-side repo NOT built —
  only Python touches the table, per RESEARCH)
- [ ] `apps/web/src/lib/reauth-callback.test.ts`
- [ ] `apps/web/src/components/ReauthWizard.test.tsx`
- [ ] Framework install: none — pytest and Vitest fully configured already.

## Known Weaker Gate (accepted)

Pitfall 3 (event-loop blocking during exchange) is gated by a static
`run_in_executor` grep scoped to the exchange call site (37-04), not a timing
test — a mocked exchange returns instantly regardless of executor wrapping, so a
behavioral test is not constructible at this layer (plan-checker warning #3,
accepted).
