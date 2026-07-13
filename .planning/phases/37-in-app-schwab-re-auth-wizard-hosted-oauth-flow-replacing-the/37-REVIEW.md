---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
reviewed: 2026-07-13T00:00:00Z
depth: deep
files_reviewed: 22
files_reviewed_list:
  - packages/adapters/src/postgres/schema.ts
  - packages/adapters/src/postgres/migrations/0024_reauth_nonces.sql
  - packages/adapters/src/sidecar/reauth-adapter.ts
  - packages/adapters/src/index.ts
  - packages/contracts/src/reauth.ts
  - packages/contracts/src/index.ts
  - packages/core/src/reauth/application/ports.ts
  - packages/core/src/reauth/application/startReauth.ts
  - packages/core/src/reauth/application/exchangeReauth.ts
  - packages/core/src/reauth/index.ts
  - packages/core/src/index.ts
  - apps/sidecar/config.py
  - apps/sidecar/token_store.py
  - apps/sidecar/main.py
  - apps/sidecar/reauth_admin.py
  - apps/server/src/config.ts
  - apps/server/src/main.ts
  - apps/server/src/adapters/http/reauth.routes.ts
  - apps/web/src/lib/reauth-callback.ts
  - apps/web/src/hooks/useReauth.ts
  - apps/web/src/components/ReauthWizard.tsx
  - apps/web/src/components/AuthExpiredBanner.tsx
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: fixes_applied
fixes:
  CR-01: 6894e7c
  CR-02: 6894e7c
  WR-01: 048fddc
  WR-02: a0554c5
  WR-03: a87bc9a
  WR-04: 37c651f
fixes_note: >-
  TS-side findings fixed (CR-01/CR-02 share one root-cause commit). WR-02 and
  WR-04 are sidecar-Python findings, now fixed in two atomic commits (WR-04
  37c651f, WR-02 a0554c5). IN-01/IN-02/IN-03 are optional/out-of-scope and
  left unchanged.
---

# Phase 37: Code Review Report

**Reviewed:** 2026-07-13
**Depth:** deep (cross-file trace of the OAuth start/exchange call chains, contract seams, nonce lifecycle, and re-init lock invariants)
**Files Reviewed:** 22
**Status:** fixes_applied — all 6 blocker/warning findings fixed (CR-01, CR-02, WR-01, WR-03 TS-side; WR-02, WR-04 sidecar-Python); IN-01/IN-02/IN-03 are optional/out-of-scope

## Summary

Phase 37 adds an in-app Schwab re-auth wizard: a browser modal that mints a hosted Schwab
authorize URL, captures the `?code=&state=` redirect, and exchanges it server-side through the
sidecar. The security-sensitive parts are largely well built — the nonce is consumed atomically
with a single-use `DELETE ... RETURNING` under a TTL predicate, the admin token uses a
constant-time compare, exchange failures log only `type(exc).__name__`, the auth code is stripped
from the URL at module scope before React renders and never persisted, and the JWT gate covers
both proxy routes. Those defenses hold up under scrutiny.

**But the wizard's primary path cannot succeed in production.** The `/reauth/start` contract
(`reauthStartResponse`) is `.strict()` and conflates two different wire shapes, so the real
sidecar body is rejected at the server adapter *and* the real server body is rejected at the web
hook. Both parse failures are proven below with the repo's own Zod. The unit suites are green
because each half is tested against a hand-authored body that does not match what the real
producer on the other side emits — the exact green-suite seam gap this project has been bitten by
before. Net effect: clicking "Authorize with Schwab" does nothing (no redirect, no error), because
`/start` 500s at the adapter and the web wrapper silently swallows the rejection.

Two BLOCKERs (both the same root cause: one over-loaded contract), four WARNINGs (silent start
failure, non-atomic re-init, stale sessionStorage skipping a genuinely-expired app, re-init
reentrancy), and three INFO items.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `/reauth/start` adapter rejects the real sidecar response — `.strict()` trips on the `app` key

**FIXED:** commit `6894e7c` — split the conflated schema into `reauthStartSidecarResponse` `{app,authUrl,state}` (adapter parse). Adapter regression test now feeds the real 3-key sidecar body.

**File:** `packages/adapters/src/sidecar/reauth-adapter.ts:91` (schema), `packages/contracts/src/reauth.ts:16-21` (contract), `apps/sidecar/reauth_admin.py:76-110` (producer)

**Issue:** The sidecar `/sidecar/admin/reauth/start` handler returns a FastAPI `StartResponse`
with **three** fields — `app`, `authUrl`, `state` (`reauth_admin.py:76-80`, `:110`). The server
adapter parses that body through `reauthStartResponse` (`reauth-adapter.ts:91`), which is
`z.object({ authUrl, state }).strict()`. `.strict()` rejects the unrecognized `app` key, so
`safeParse` fails, `postToSidecar` returns `err({ kind: "parse-error" })`, and the route
(`reauth.routes.ts:30-31`) maps it to a generic `500 { error: "internal" }`. `/reauth/start` can
never return 200 against the real sidecar.

Proven against the repo's own Zod:

```
ADAPTER parse of real sidecar {app,authUrl,state}: FAIL -> unrecognized_keys
```

Why the suite is green: `reauth-adapter.test.ts:45` feeds `{ authUrl, state }` — it **omits the
`app` field the real sidecar always sends** — so the strict parse passes only in the test.

**Fix:** Split the conflated contract into the two distinct boundaries it actually spans. The
sidecar→server wire carries `{ app, authUrl, state }`; the server→browser wire carries
`{ authUrl }` only (T-37-06). Introduce a sidecar-facing schema and use it in the adapter:

```ts
// packages/contracts/src/reauth.ts
export const reauthStartSidecarResponse = z
  .object({ app: z.enum(["trader", "market"]), authUrl: z.string().url(), state: z.string() })
  .strict();

// browser-facing — structurally cannot carry state/code (enforces the no-leak invariant)
export const reauthStartResponse = z.object({ authUrl: z.string().url() }).strict();
```

```ts
// reauth-adapter.ts — parse the sidecar shape, then narrow to { authUrl }
const result = await postToSidecar(deps, "/sidecar/admin/reauth/start", { app }, reauthStartSidecarResponse);
if (!result.ok) return result;
return ok({ authUrl: result.value.authUrl });
```

Then add a test whose fetch stub returns the exact three-key body the sidecar emits.

### CR-02: `/reauth/start` web hook rejects the real server response — required `state` is (correctly) absent

**FIXED:** commit `6894e7c` (same root cause as CR-01) — slim `reauthStartResponse` is now `{authUrl}`-only; the route re-parses through it and the hook parses the real state-free body. Hook + contract regression tests feed the real server body.

**File:** `apps/web/src/hooks/useReauth.ts:33` (parse), `apps/server/src/adapters/http/reauth.routes.ts:35` (producer), `packages/contracts/src/reauth.ts:16-21` (contract)

**Issue:** The server route deliberately returns `{ authUrl }` only, with no `state`
(`reauth.routes.ts:32-35`, correct per T-37-06). The web hook then parses that body through the
same `reauthStartResponse` schema (`useReauth.ts:33`), which requires `state`. Missing-required
→ ZodError → `startReauth()` rejects. In the wizard, `handleAuthorize` is
`void startReauth(app).then((r) => { window.location.href = r.authUrl })` (`ReauthWizard.tsx:116-120`)
— the rejected promise means `.then` never runs, so the browser never navigates to Schwab. The
operator clicks "Authorize with Schwab" and nothing happens.

Proven against the repo's own Zod:

```
WEB parse of real server {authUrl}: FAIL -> invalid_type:state
```

Why the suite is green: `useReauth.test.ts:50-51` mocks the response as
`{ authUrl, state: "nonce-1" }` — it **injects a `state` the real server never sends** — and even
asserts the return `toEqual({ authUrl, state })` (`:65`), locking in the wrong wire shape. The
`ReauthWizard.test.tsx` suite mocks `useReauth` wholesale, so the parse never runs there either.
The two halves of the seam are each tested against a body the other half does not produce.

**Fix:** After CR-01 splits the schema, `reauthStartResponse` becomes `{ authUrl }`-only and
`useReauth.ts:33`'s `reauthStartResponse.parse(...)` works unchanged. Update
`useReauth.test.ts:50-51`/`:65` to the real `{ authUrl }` body (drop `state`) and drop `state`
from the `ReauthStartResponse` type consumers. Add one integration-style test that drives
`startReauth` against the actual server route output to close the seam permanently.

## Warnings

### WR-01: `handleAuthorize` swallows a failed `/start` — the button dies silently

**FIXED:** commit `048fddc` — `handleAuthorize` now sets `confirming` before navigating and `failure` on rejection, reusing the existing failure copy + Retry. Regression test mocks a `/start` rejection and asserts the failure copy + Retry render.

**File:** `apps/web/src/components/ReauthWizard.tsx:116-120`

**Issue:** `handleAuthorize` fires `startReauth` with a `.then` but no `.catch`. Any `/start`
failure (the CR-01/CR-02 500s today, or a transient sidecar 500 tomorrow) rejects the promise with
zero UI feedback — no "confirming" spinner, no failure copy, no Retry. The idle step just sits
there. This is *why* the CR-01/CR-02 breakage presents as "the Authorize button does nothing"
rather than a visible error. The exchange path handles rejection (`:109-111`); the start path does
not.

**Fix:** Mirror the exchange path — set the step to `confirming` before navigating and to
`failure` on rejection:

```ts
function handleAuthorize(app: ReauthApp): void {
  setState((prev) => ({ ...prev, statuses: { ...prev.statuses, [app]: "confirming" } }));
  startReauth(app)
    .then((response) => { window.location.href = response.authUrl; })
    .catch(() => setState((prev) => ({ ...prev, statuses: { ...prev.statuses, [app]: "failure" } })));
}
```

### WR-02: `reinit_schwab_session` is not atomic and its failure is uncaught — half-initialized session with the lock still held

**FIXED:** commit `a0554c5` — the client rebuild + task recreation is now wrapped: on failure it logs only the exception type, still recreates all three tasks (keepalive/streamer/indices) so the stream is never stranded, then re-raises. The exchange handler catches the reinit failure and returns `ok:false` (never claiming health) with a type-only log. Regression tests: reinit recreates-all-three-and-reraises on a rebuild blip (`test_reinit_recreates_tasks_and_reraises_on_client_init_failure`); the handler returns `ok:false` and logs type only (`test_reinit_failure_returns_ok_false_and_logs_type_only`).

**File:** `apps/sidecar/main.py:145-176` (re-init), `apps/sidecar/reauth_admin.py:194-200` (caller)

**Issue:** `reinit_schwab_session` cancels+awaits the old keepalive/streamer tasks, then calls
`_init_schwab_clients` and creates the new tasks — with no try/except around that second half. If
`_init_schwab_clients` raises anything other than `ValueError` (e.g. a psycopg2 connectivity blip
when `client_from_access_functions` reads the token), the exception propagates: the old tasks are
already cancelled, the new ones are never created, and the exchange handler (`reauth_admin.py:199`,
which does **not** wrap the reinit call in its try/except — that only covers the exchange at
`:178-192`) 500s. The live Schwab stream is now dead while this instance still holds the advisory
lock, so the lock-loss self-heal path never fires — the stream stays down until a manual restart.
The token itself was already written and anchored fresh, so `/api/status` will report healthy while
data is actually stale.

**Fix:** Wrap the client-rebuild + task-recreate half in try/except; on failure, log the type and
either restore a degraded-but-recoverable state (drop the lock so the acquire loop re-inits) or
re-raise only after ensuring the streamer is restarted. At minimum, surface the reinit failure
distinctly from exchange success so the wizard/status don't claim health.

### WR-03: stale `reauth-completed-apps` can skip a genuinely-expired app within a same-tab cycle

**FIXED:** commit `a87bc9a` — the banner now derives the live AUTH_EXPIRED set from `/api/status` tokenFreshness and passes it to the wizard as `expiredApps`; `computeInitialState` pre-fills an app `success` only when sessionStorage records it AND its live token is not expired. Regression test: both apps expired + sessionStorage `["trader"]` starts at the trader step.

**File:** `apps/web/src/components/ReauthWizard.tsx:43-74`

**Issue:** `computeInitialState` seeds the wizard from the `reauth-completed-apps` sessionStorage
set, marking a listed app as `success` and starting at the next step. The set is only cleared when
**both** apps complete (`persistCompletedApp:57-58`). If the operator reconnects trader but
abandons before market (tab left open), the set persists `["trader"]`. Weeks later, when trader's
7-day token expires again and the banner reappears in that same tab, the wizard opens at the Market
step with the Trader chip shown green — skipping the trader re-auth the operator actually needs.
The red banner then stays up and the flow looks stuck. sessionStorage clears on tab close, so the
blast radius is "same tab across a full token cycle," but it is a real correctness trap for a
long-lived dashboard tab.

**Fix:** Don't trust the completed-set as ground truth for "this app is fresh." Seed the initial
step from the live `/api/status` `tokenFreshness` (which the banner already reads) — mark an app
`success` only when its status is actually fresh — and keep sessionStorage purely as
cross-redirect continuity for the app just authorized. Alternatively, stamp the set with a
timestamp and ignore it after a few minutes.

### WR-04: re-init and lock-loss teardown mutate the same task slots without a guard — narrow two-streamer window

**FIXED:** commit `37c651f` — reinit re-checks `has_lock` after the cancel/awaits and bails (returns `False`, no task recreation) if the lock was lost mid-reinit, so the acquire loop's fresh streamer stays the only live one and the two-streamer window is closed. Regression test drives a lock-loss during the await window and asserts no new tasks are created (`test_reinit_aborts_task_recreation_when_lock_lost_mid_reinit`).

**File:** `apps/sidecar/main.py:145-176` (reinit) and `:265-285` (heartbeat finally + re-acquire)

**Issue:** Both `reinit_schwab_session` and the `_acquire_lock_and_init` heartbeat-finally read and
replace `app.state.keepalive_task`/`streamer_task`, and both run on the same event loop. If the
heartbeat detects lock loss during the `await t` window inside a concurrent reinit, the finally
sets `has_lock=False` and the acquire loop re-acquires and starts a fresh streamer, while the
resuming reinit *also* creates a streamer (having passed its `has_lock` check before the loss).
Two live streamer sessions against one market client is exactly the GW-04 single-writer violation
the design guards against (Schwab `invalid_grant`). Probability is low — it needs a DB/heartbeat
failure inside the sub-millisecond reinit await window — but the invariant is real and currently
unprotected.

**Fix:** Guard reinit with a re-check of `has_lock` *after* the awaits (bail before creating new
tasks if the lock was lost mid-reinit), or serialize reinit and teardown behind an `asyncio.Lock`
on `app.state`. A single boolean/lock closes the window.

## Info

### IN-01: freshness gate mixes app-clock write with DB-clock read

**File:** `apps/sidecar/token_store.py:229` (write) and `apps/sidecar/reauth_admin.py:143-157` (read)

**Issue:** `make_reauth_writer` stamps `refresh_issued_at` with the sidecar's
`datetime.now(utc)` (app clock), while `_is_freshly_anchored` compares it against Postgres `now() -
interval '5 minutes'` (DB clock). If the sidecar clock lags the DB clock by more than 5 minutes, a
just-written token fails the freshness gate and the wizard reports failure on a genuine success.
Both hosts are NTP-synced (sub-second skew in practice) and the 5-minute window is generous, and
this mirrors the pre-existing `seed_token._verify_and_finish` gate, so it is consistent working
behavior — noted for awareness, not action.

**Fix (optional):** Anchor the write with SQL `now()` too (e.g. `refresh_issued_at = now()` in the
UPSERT) so a single clock source drives both write and gate.

### IN-02: exchange ignores `reinit_schwab_session`'s `False` return

**File:** `apps/sidecar/reauth_admin.py:199-200`

**Issue:** `reinit_schwab_session` returns `False` when this instance is not the lock holder (mid
rolling-deploy rollover), but the exchange handler discards the return and still responds
`ok=fresh`. In that window the token is written+anchored (so `/api/status` reads fresh and the
wizard shows success), yet the *actual* lock-holding instance keeps serving the stream/chain with
its old in-memory token until it re-inits or restarts. Single-instance steady state is unaffected;
this only surfaces transiently across a deploy.

**Fix (optional):** If reinit returns `False`, either report a transient "reconnected, live data
resuming shortly" state or log it, rather than treating it as fully complete.

### IN-03: authorization code lands in the query string and is recorded upstream before the SPA strips it

**File:** `apps/web/src/lib/reauth-callback.ts:32-40`, `apps/web/src/main.tsx:14`

**Issue:** The SPA does its part well — `captureAndStripReauthRedirect` strips `?code=&state=` via
`history.replaceState` at module scope before React renders, and the code is never logged or
persisted (held in a one-shot module variable). But because Schwab redirects to
`morai.wtf/?code=...&state=...` via a browser GET, the code is already in the hosting/CDN access
log (Vercel) and browser address-bar history for that navigation before any JS runs. This is
inherent to the authorization-code-in-query flow, not a defect in this code — noted so the residual
exposure is on record. The single-use nonce + short code TTL limit the value of a leaked code.

**Fix (optional / out of scope):** Nothing actionable in the SPA; if the exposure ever matters,
it's an OAuth-flow-level change (e.g. code delivered via fragment or a dedicated callback path
excluded from access logging).

---

_Reviewed: 2026-07-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
