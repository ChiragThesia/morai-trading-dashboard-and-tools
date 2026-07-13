# Phase 37: In-app Schwab Re-auth Wizard - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 20 new/modified artifacts across 5 layers (sidecar Python, DB, contracts, server, web)
**Analogs found:** 18 exact/role-match / 20 (2 partial-new: FastAPI header auth, boot-time callback capture)

This phase has an unusually strong analog base: every layer it touches already has a
Schwab-adjacent sibling shipped in Phases 4/11/12/29. The dominant instruction to the
planner is **imitate, do not invent** — the OAuth exchange, the token freshness gate, the
sidecar→server proxy, the JWT group, and the modal idiom all exist verbatim.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `apps/sidecar/reauth_admin.py` (new router) | route | request-response | `apps/sidecar/positions_proxy.py` | exact |
| ↳ authurl/exchange logic (same module) | service | request-response | `apps/sidecar/seed_token.py` `step_authurl`/`step_exchange`/`_make_seed_writer`/`_verify_and_finish` | exact |
| ↳ shared-secret header check | middleware | request-response | *(no FastAPI analog)* — concept from `supabase-auth.ts` + `config.py` | partial |
| nonce read/write (Python) | repo/model | CRUD | `apps/sidecar/token_store.py` + `advisory_lock.py` (raw psycopg2) | role-match |
| `packages/adapters/src/postgres/migrations/0024_reauth_nonces.sql` + `schema.ts` entry | migration | — | `migrations/0022_rule_overrides.sql` + `schema.ts` `ln` table | role-match |
| `apps/sidecar/config.py` (add `SIDECAR_ADMIN_TOKEN`) | config | — | `apps/sidecar/config.py` (self) | exact |
| `apps/sidecar/tests/test_reauth_admin.py` | test | request-response | `tests/test_positions_proxy.py` + `tests/test_token_store.py` + `conftest.py` | exact |
| `packages/contracts/src/reauth.ts` + `index.ts` export | contract | — | `packages/contracts/src/status.ts` + `index.ts` barrel | exact |
| `packages/contracts/src/reauth.test.ts` | test | — | `packages/contracts/src/status.test.ts` | role-match |
| core port `ForStartingReauth` / `ForExchangingReauth` | port | request-response | `packages/core/src/streaming/ports.ts` `ForReconcilingPositions` | role-match |
| `packages/adapters/src/sidecar/reauth-adapter.ts` | adapter | request-response | `packages/adapters/src/sidecar/positions-reconciler.ts` | exact |
| `packages/adapters/src/sidecar/reauth-adapter.test.ts` | test | request-response | `sidecar/chain-adapter.test.ts` (injected fake fetch) | exact |
| `apps/server/src/adapters/http/reauth.routes.ts` | route | request-response | `brokerage.routes.ts` + `settings.routes.ts` | exact |
| `apps/server/src/adapters/http/reauth.routes.test.ts` | test | request-response | `settings.routes.test.ts` (`buildTestApp` + `app.request`) | exact |
| `apps/server/src/config.ts` (add `SIDECAR_ADMIN_TOKEN`) | config | — | `apps/server/src/config.ts` (self) | exact |
| `apps/server/src/main.ts` (wire adapter + mount route) | config/wiring | — | `main.ts` `apiRouter` chain + `makeSidecarPositionReconciler` | exact |
| `apps/web/src/components/ReauthWizard.tsx` (modal) | component | request-response | `apps/web/src/screens/RuleSettingsModal.tsx` + `ui/dialog.tsx` | exact |
| `apps/web/src/components/AuthExpiredBanner.tsx` (Reconnect button + copy) | component | — | self (modify) + `system/Button.tsx` | exact |
| `apps/web/src/hooks/useReauth.ts` | hook | request-response | `hooks/useRuleSettings.ts` (mutation) + `hooks/useStatus.ts` (query) | exact |
| boot-time `?code=&state=` capture + `history.replaceState` | component/util | event-driven | `lib/rpc.ts` `apiFetch`; App boot — *(no exact replaceState analog)* | partial |
| `apps/web/src/hooks/useReauth.test.ts` / `ReauthWizard.test.tsx` | test | — | `useRuleSettings.test.ts` / `AuthExpiredBanner.test.tsx` | exact |

---

## Pattern Assignments

### `apps/sidecar/reauth_admin.py` — new FastAPI router (route, request-response)

**Analog:** `apps/sidecar/positions_proxy.py` (router shape) + `apps/sidecar/seed_token.py` (OAuth logic to lift)

**Router + imports** (`positions_proxy.py:20-29`):
```python
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()
```
Register it in `main.py` exactly like the others (`main.py:334-339`):
```python
from positions_proxy import router as positions_router  # noqa: E402
app.include_router(positions_router)
```

**Handler shape — access clients/config off `request.app.state`, guard, JSONResponse on failure** (`positions_proxy.py:117-134`):
```python
@router.get("/sidecar/positions", response_model=PositionsResponse)
async def get_positions(request: Request) -> PositionsResponse | JSONResponse:
    client = getattr(request.app.state, "trader_client", None)
    if client is None:
        logger.error("positions proxy: trader_client not available ...")
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
```
The two admin endpoints become `@router.post("/sidecar/admin/reauth/start")` and
`@router.post("/sidecar/admin/reauth/exchange")` with Pydantic request/response models
(`positions_proxy.py:52-74` shows the `BaseModel` response idiom).

**`/start` — mint authorize URL + nonce** (lift from `seed_token.py:95-109` `step_authurl`):
```python
ctx = schwab.auth.get_auth_context(env[key_env], env[cb_env])
# ctx.authorization_url  → return as authUrl
# ctx.state              → persist as the nonce (see nonce section), return as state
```
Per-app key/secret/callback come from the `APPS` tuple pattern (`seed_token.py:60-63`).

**`/exchange` — validate nonce, exchange redirect URL, re-init client in-process** (lift from `seed_token.py:148-174` `step_exchange`):
```python
state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("state", [None])[0]
# VALIDATE + DELETE the nonce here (replay-kill) BEFORE exchanging — see nonce section
ctx = schwab.auth.get_auth_context(env[key_env], env[cb_env], state=state)
schwab.auth.client_from_received_url(
    env[key_env], env[secret_env], ctx, url,
    _make_seed_writer(db_url, key, app_id),   # reuse the seed_token writer verbatim
)
```

**Per-app success = freshness re-check, NOT HTTP 200** (CONTEXT decision — lift `seed_token.py:212-234` `_verify_and_finish`):
```python
cur.execute(
    "SELECT app_id, refresh_issued_at > now() - interval '5 minutes' "
    "FROM broker_tokens WHERE app_id IN ('trader','market') ORDER BY app_id"
)
```
Return per-app `{app, ok, ...}` so the wizard's partial-failure isolation works.

**In-process client rebuild after exchange (no restart, hold the lock):** the lifespan
already re-inits clients via `_init_schwab_clients(app, cfg)` (`main.py:95-142`). After a
successful exchange, call the same helper to swap `app.state.trader_client` /
`app.state.market_client` while the advisory lock (`main.py:191-201`) stays held — the
CONTEXT's "no second streamer session" requirement. **Do not** re-acquire the lock or
restart the streamer task; only rebuild the client objects.

**Security idioms that are LAW here (never break):**
- Log `type(exc).__name__` only — never `str(exc)`, never the token, never the code (`positions_proxy.py:142-147`).
- `TOKEN_ENCRYPTION_KEY` / secrets only as bound `%s` params (`token_store.py:139-161`).
- Error responses to the server must be generic — the UI-SPEC forbids echoing the `code`/`state`/redirect URL in any error string.

---

### nonce persistence (Python psycopg2, CRUD)

**Analog:** `apps/sidecar/token_store.py` (bound-param UPSERT/SELECT) + `apps/sidecar/advisory_lock.py` (session connection idiom)

The sidecar is the sole DB writer for OAuth state, mirroring the token writer. Use the
raw-psycopg2 connect/cursor/commit/close idiom (`token_store.py:136-169`):
```python
conn = psycopg2.connect(db_url)
try:
    with conn.cursor() as cur:
        cur.execute(SQL, (bound, params, only))   # never f-string interpolate values
    conn.commit()
finally:
    conn.close()
```

- **Insert on `/start`:** `INSERT INTO reauth_nonces (state, app_id, created_at) VALUES (%s, %s, now())`.
- **Validate + delete on `/exchange` (replay-kill in one statement):**
  `DELETE FROM reauth_nonces WHERE state = %s AND app_id = %s AND created_at > now() - interval '10 minutes' RETURNING app_id`
  — `cur.rowcount == 0` ⇒ invalid/expired/replayed nonce ⇒ reject before exchanging.
  This mirrors the freshness-gate philosophy in `_verify_and_finish` (presence is not
  enough; the row must be *fresh*) and `token_store.py:162-166`'s `rowcount == 0` guard.
- **TTL cleanup:** the `DELETE ... created_at > now() - interval '10 minutes'` predicate
  makes expired rows unusable; a periodic sweep is optional (ponytail: the WHERE clause is
  the enforcement, a cron sweep is not required for correctness — CONTEXT calls it
  "TTL-cleaned", so a best-effort `DELETE ... < now() - interval '10 minutes'` at
  `/start` time is the lazy correct option).

**DB URL constraint:** use `cfg.DATABASE_URL` (direct 5432), never a pool URL — same
constraint as `config.py:19-22` and `advisory_lock.py:26-30`.

---

### nonce table migration + schema (migration)

**Analog:** `packages/adapters/src/postgres/migrations/0022_rule_overrides.sql` (next number is `0024_*.sql`) + `schema.ts`

Drizzle (TS) owns DDL even though the sidecar (Python) reads/writes it — exactly like
`broker_tokens`, which is defined in `schema.ts` as the obfuscated `ln` table
(`schema.ts` "§ 8 ln — Schwab OAuth tokens") yet written by `token_store.py`. Add:
1. A `pgTable` entry in `packages/adapters/src/postgres/schema.ts` (shape:
   `state text primary key, app_id text not null, created_at timestamptz not null default now()`).
2. A sequential migration file `0024_reauth_nonces.sql`.

The Python side never runs Drizzle; the sidecar tests create the table inline in their own
DDL (see `conftest.py:52-68` `_CREATE_TABLE_SQL`) — replicate that for a `reauth_nonces`
fixture table.

---

### `apps/sidecar/config.py` — add `SIDECAR_ADMIN_TOKEN` (config)

**Analog:** self. Add one field to the pydantic-settings model (`config.py:18-37`):
```python
class SidecarConfig(BaseSettings):
    DATABASE_URL: str
    TOKEN_ENCRYPTION_KEY: str
    ...
    SIDECAR_ADMIN_TOKEN: str   # shared secret required on the admin endpoints
```
Never logged, never in an f-string — same rule as every other field (`config.py:6-9`).

---

### `apps/sidecar/tests/test_reauth_admin.py` (test)

**Analog:** `tests/test_positions_proxy.py` (route handler test) + `tests/test_token_store.py` (real-DB nonce test) + `conftest.py` (fixtures)

**Route handler called directly with a fake Request** (`test_positions_proxy.py:24-42`) —
no live server, no lifespan:
```python
def _make_fake_request(**state_kwargs) -> MagicMock:
    req = MagicMock()
    req.app.state = types.SimpleNamespace(**state_kwargs)
    return req
```
Stub the Schwab client with `AsyncMock` (`test_positions_proxy.py:34-42`). For the exchange
path, `monkeypatch` `schwab.auth.get_auth_context` / `schwab.auth.client_from_received_url`
so no real Schwab call happens.

**Nonce round-trip against real Postgres** (SQL is never mocked — `tdd.md`): follow
`test_token_store.py:32-47` + the `conftest.py` `db_url`/`_setup_db` fixtures. Assert: a
fresh nonce validates once, a second use fails (replay), an >10-min-old nonce fails (TTL).

**503/failure body assertions** (`test_positions_proxy.py:170-202`): `isinstance(result, JSONResponse)`, `json.loads(result.body)`, generic error key.

**Async test style:** methods are `async def` (`test_positions_proxy.py:97`); the sidecar's
`pytest.ini` enables asyncio mode.

---

### `packages/contracts/src/reauth.ts` — Zod request/response schemas (contract)

**Analog:** `packages/contracts/src/status.ts`

Schema-first, `z.infer` for the type, one export per schema (`status.ts:8-14`, `41-54`):
```typescript
import { z } from "zod";

export const reauthStartRequest = z.object({ app: z.enum(["trader", "market"]) });
export const reauthStartResponse = z.object({ authUrl: z.string().url(), state: z.string() });
export const reauthExchangeRequest = z.object({ redirectUrl: z.string().url() });
export const reauthExchangeResponse = z.object({
  app: z.enum(["trader", "market"]),
  ok: z.boolean(),
  // NEVER include code/state/redirect echo — CONTEXT + UI-SPEC content constraint
});
export type ReauthStartRequest = z.infer<typeof reauthStartRequest>;
```
Register in the barrel (`packages/contracts/src/index.ts:4-5` pattern):
```typescript
export { reauthStartRequest, reauthStartResponse, reauthExchangeRequest, reauthExchangeResponse } from "./reauth.ts";
export type { ReauthStartRequest, ReauthStartResponse, ... } from "./reauth.ts";
```
**Boundary rule:** contracts import only `zod` + `shared`. The sidecar's own Zod schemas
(if any) stay adapter-local, NOT in contracts (`chain-adapter.ts:6` "D-08 — MUST NOT live
in packages/contracts").

---

### core port + `packages/adapters/src/sidecar/reauth-adapter.ts` (port + adapter, request-response)

**Analog:** `packages/adapters/src/sidecar/positions-reconciler.ts` (the canonical
server→sidecar fetch adapter) implementing a `packages/core/src/streaming/ports.ts`-style
function port.

**Port** (`streaming/ports.ts:92` shape) — a `ForVerbingNoun` function type:
```typescript
export type ForStartingReauth = (app: "trader" | "market")
  => Promise<Result<ReauthStart, ReauthError>>;
export type ForExchangingReauth = (redirectUrl: string)
  => Promise<Result<ReauthExchange, ReauthError>>;
```

**Adapter — injected fetch, `SIDECAR_ADMIN_TOKEN` header, Zod safeParse, Result mapping** (`positions-reconciler.ts:67-129`):
```typescript
export function makeSidecarReauthAdapter(deps: {
  readonly baseUrl: string;                 // config.SIDECAR_URL
  readonly adminToken: string;              // config.SIDECAR_ADMIN_TOKEN  (NEW)
  readonly fetch: typeof globalThis.fetch;  // always injected — never globalThis inside
}): ForStartingReauth { /* ... */ }
```
Forward with the shared-secret header (this is the new bit; header attach mirrors how
`apiFetch` adds `Authorization` — see `rpc.ts:26-31`):
```typescript
const resp = await deps.fetch(`${deps.baseUrl}/sidecar/admin/reauth/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Sidecar-Admin-Token": deps.adminToken },
  body: JSON.stringify({ app }),
});
if (!resp.ok) { /* map 401/503/etc → err(...) */ }
const parsed = SomeSchema.safeParse(await resp.json());   // parse-don't-cast at boundary
if (!parsed.success) return err({ kind: "ParseError", detail: parsed.error.message });
return ok(parsed.data);
```
**Log discipline** (`positions-reconciler.ts:79-83`): log `e.constructor.name` only, never
`error.message`, never the redirect URL/code.

**No in-memory twin needed:** the sidecar HTTP adapters (`chain-adapter.ts`,
`positions-reconciler.ts`) have NO `packages/adapters/src/memory/` twin — that directory is
for Postgres repos only. HTTP adapters are tested with an injected fake `fetch`. Do the same
for reauth; the architecture rule-8 "ship the in-memory twin" applies to *driven ports over
a repo*, not to these fetch adapters.

**Adapter test** (`chain-adapter.test.ts:49-87`): inject a `makeFakeFetch(body, status)`
that returns a `new Response(JSON.stringify(body), { status })`; assert `result.ok` and the
mapped value. Add a case asserting the `X-Sidecar-Admin-Token` header is sent (inspect the
`init` arg in the fake fetch).

---

### `apps/server/src/adapters/http/reauth.routes.ts` (route, request-response)

**Analog:** `brokerage.routes.ts` (sidecar-backed read) + `settings.routes.ts` (POST-body + zValidator)

**Factory + zero-logic Result-map** (`settings.routes.ts:35-59`):
```typescript
export function reauthRoutes(startReauth: ForStartingReauth, exchangeReauth: ForExchangingReauth) {
  const router = new Hono();

  router.post("/reauth/start", zValidator("json", reauthStartRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await startReauth(body.app);
    if (!result.ok) return c.json({ error: "internal" }, 500);   // generic — no leak
    return c.json(reauthStartResponse.parse(result.value));
  });

  router.post("/reauth/exchange", zValidator("json", reauthExchangeRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await exchangeReauth(body.redirectUrl);
    if (!result.ok) return c.json({ error: "internal" }, 500);
    return c.json(reauthExchangeResponse.parse(result.value));
  });

  return router;
}
```
**Error-leak guard** (`settings.routes.test.ts:121-131` asserts this): the 500 body must be
generic `{ error: "internal" }` and must NOT contain sidecar error detail — the code/state
must never reach the browser.

**Mount inside the JWT group** (`main.ts:520-544`, `567-574`) — the chained `apiRouter`,
which is wrapped by `authReadGroup.use("/*", makeSupabaseJwtAuth(...))`. Add
`.route("/", reauthRoutes(startReauth, exchangeReauth))` to the `apiRouter` chain. Build the
adapter next to `makeSidecarPositionReconciler` (`main.ts:547-554`):
```typescript
const reauthAdapter = makeSidecarReauthAdapter({
  fetch: globalThis.fetch,
  baseUrl: config.SIDECAR_URL,
  adminToken: config.SIDECAR_ADMIN_TOKEN,   // NEW config field
});
```
Any authenticated user is the operator (CONTEXT — single-user app); no new role check.

**Route test** (`settings.routes.test.ts:74-104`): `buildTestApp(fakeStart, fakeExchange)`
mounts the factory on a bare `new Hono()`; drive with `app.request("/api/reauth/start", { method: "POST", body: JSON.stringify(...) })`; parse the response through the contract schema; assert the no-leak invariant.

---

### `apps/server/src/config.ts` — add `SIDECAR_ADMIN_TOKEN` (config)

**Analog:** self (`config.ts:3-38`). One field on the Zod schema, `.min(16)` like the other
shared secret `MCP_BEARER_TOKEN` (`config.ts:6`):
```typescript
SIDECAR_ADMIN_TOKEN: z.string().min(16, "SIDECAR_ADMIN_TOKEN must be at least 16 chars"),
```
`bootConfig` already prints field names (never values) on failure (`config.ts:68-82`).

---

### `apps/web/src/components/ReauthWizard.tsx` (component, request-response)

**Analog:** `apps/web/src/screens/RuleSettingsModal.tsx` (Dialog + step body + action row) + `apps/web/src/components/ui/dialog.tsx`

**Dialog structure** (`RuleSettingsModal.tsx:414-447`):
```tsx
<Dialog>
  <DialogTrigger render={<Button variant="primary" tone="violet" size="touch" />}>
    Reconnect
  </DialogTrigger>
  <DialogContent>            {/* UI-SPEC: do NOT widen to sm:max-w-lg — default sizing */}
    <DialogHeader><DialogTitle>Reconnect Schwab</DialogTitle></DialogHeader>
    {/* step chips + step body + CTA */}
  </DialogContent>
</Dialog>
```
`Dialog`/`DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogTitle` import from
`../components/ui/dialog.tsx` (`RuleSettingsModal.tsx:18`); base-ui `render` prop wires the
`<Button>` primitive as the trigger (`RuleSettingsModal.tsx:416-422`).

**Step chips (non-interactive, buttonClass on a `<span>`)** — UI-SPEC §Interaction. Use
`buttonClass({ variant: "toggle", tone: "violet", active, size: "xs" })` from
`system/Button.tsx:72-86` on a plain element, never a real `<button>`.

**CTA buttons** — `system/Button.tsx` (`Button.tsx:88-100`):
- "Authorize with Schwab": `variant="primary" tone="violet" size="touch"`.
- "Retry": `variant="secondary" size="touch"`. "Close": `variant="secondary"`.
- `size="touch"` already renders `min-h-11` below `lg:` (Button.tsx:36) — satisfies the
  UI-SPEC 44px touch-target requirement with no new primitive.

**"Confirming…" in-flight text** — plain dim text, matching `RuleSettingsModal.tsx:383-386`'s
`Previewing…` idiom (no spinner component; UI-SPEC locks this).

**Success/failure copy colors** — `text-up` (`#26a69a`) for connected, `text-down`
(`#ef5350`) for the failure line only (UI-SPEC §Color).

---

### `apps/web/src/components/AuthExpiredBanner.tsx` — add Reconnect button + new copy (modify)

**Analog:** self. Keep the three-state gate logic (`AuthExpiredBanner.tsx:38-60`
`isExpired`/`isMarketExpired`/`isNearExpiry`) — it already computes exactly the red/amber
states the UI-SPEC banner table needs. The change is:
1. Replace the ``Run `auth setup` `` copy (`:84-96`, `:123-135`) with the CTA-first strings
   from UI-SPEC §Copywriting.
2. Render the `ReauthWizard`'s `DialogTrigger` **Reconnect** button in both the red branch
   (`:62-99`) and the amber branch (`:101-140`).

Watch the existing test (`AuthExpiredBanner.test.tsx:117-123`) asserts *no* button today —
that assertion will need updating in RED-first when the Reconnect button lands. The banner
still reads `useStatus()` (`:39`); no data-flow change.

---

### `apps/web/src/hooks/useReauth.ts` (hook, request-response)

**Analog:** `hooks/useRuleSettings.ts` (POST mutation via `apiFetch`, parse-don't-cast) + `hooks/useStatus.ts` (polling query)

**POST via `apiFetch` + contract parse** (`useRuleSettings.ts:48-72`):
```typescript
const res = await apiFetch("/api/reauth/start", {
  method: "POST",
  body: JSON.stringify({ app }),
});
if (!res.ok) throw new Error(`POST /api/reauth/start failed: ${res.status}`);
return reauthStartResponse.parse(await res.json());   // never cast
```
`apiFetch` (`rpc.ts:59-70`) attaches the Bearer JWT automatically — the wizard rides the
existing auth, no new token handling.

**On success, invalidate `["status"]`** so the banner re-reads freshness and disappears —
mirror `useRuleSettings.ts:68` `queryClient.invalidateQueries`. The Done-state copy
("Live data resumes on the next status check") maps directly to `useStatus`'s 30s poll
(`useStatus.ts:43`).

---

### boot-time callback capture (`?code=&state=` → strip → resume) — component/util, event-driven

**Analog:** *partial* — `lib/rpc.ts` `apiFetch` for the POST; App/Shell boot for the mount.
No existing code reads `window.location.search` or calls `history.replaceState`, so this is
the one genuinely new browser idiom. Keep it a tiny module (parse `URLSearchParams`, if
`code`+`state` present → `history.replaceState({}, "", "/")` FIRST, then hand
`{ redirectUrl }` to `useReauth`'s exchange). CONTEXT/UI-SPEC LAW: strip before any render,
and never log the URL/code. Test with jsdom by setting `window.location` search + asserting
`replaceState` was called before the exchange fetch (jest/vitest `vi.spyOn(history, "replaceState")`).

---

## Shared Patterns

### Sidecar security posture (apply to every sidecar file)
**Source:** `token_store.py:23-29`, `positions_proxy.py:11-17`, `config.py:6-12`
- Secrets/keys only as bound `%s` psycopg2 params — never f-string, never logged.
- Log `type(exc).__name__` only; never `str(exc)`, the token, the code, or the redirect URL.
- Direct `DATABASE_URL` (5432), never the pool URL.

### Result → HTTP mapping (apply to server route + adapter)
**Source:** `brokerage.routes.ts:41-59`, `positions-reconciler.ts:73-129`
- Adapter returns `Result<T, E>`; route maps `!result.ok` → status + generic body, success →
  `schema.parse(result.value)`. Zero business logic in the route.
- The 500/4xx body is generic and asserted leak-free (`settings.routes.test.ts:130`).

### Parse-don't-cast at every boundary (apply to contracts, adapter, hooks)
**Source:** `chain-adapter.ts:122-128`, `useStatus.ts:39-41`, `rpc.ts` note
- Every external payload (sidecar response, HTTP body) goes through Zod `.parse`/`.safeParse`.
  Types flow from `z.infer`. No `as`, no `!`, no `any` (`typescript.md`).

### Env config (apply to both config files + main.ts)
**Source:** `config.ts:52-82`, `config.py:40-43`, `main.ts:547-554`
- `process.env` read once at the composition root, Zod/pydantic-parsed; typed config flows
  inward. New env var (`SIDECAR_ADMIN_TOKEN`) added to BOTH `apps/server/src/config.ts` and
  `apps/sidecar/config.py`, and to Railway server + sidecar services before deploy (CONTEXT
  integration point).

### TDD red→green (apply to every non-wiring file)
**Source:** `tdd.md`, `test_token_store.py:13-15` (RED-first import), `chain-adapter.test.ts:16-19`
- Failing test first, real Postgres via the sidecar's psycopg2 fixtures (SQL never mocked),
  injected fake `fetch` for TS HTTP adapters, direct-handler + `AsyncMock` for sidecar routes.
- Composition-root wiring in `main.ts` is TDD-exempt (`tdd.md` §Scope).

---

## No Analog Found

| Artifact | Role | Reason / guidance |
|----------|------|-------------------|
| Sidecar shared-secret header check | middleware | The sidecar has **no** existing auth (it was private-net-only). No FastAPI auth analog in-repo. Keep it minimal: read `SIDECAR_ADMIN_TOKEN` from `config`, compare the `X-Sidecar-Admin-Token` request header with a constant-time compare (`hmac.compare_digest`), return `JSONResponse(status_code=401, ...)` on mismatch — apply to BOTH admin endpoints only (not health/chain/positions). Conceptual sibling: the TS `supabase-auth.ts:33-57` 401-on-bad-header shape and the server's `bearerAuth(config.MCP_BEARER_TOKEN)` group (`main.ts:579-582`). |
| Boot-time `?code=&state=` capture + `history.replaceState` | util | No existing web code touches `window.location.search`/`history`. New, but tiny — see the assignment above. Everything else in the web layer has an exact analog. |

Both are small, well-bounded additions; the rest of the phase is imitation.

---

## Metadata

**Analog search scope:** `apps/sidecar/`, `apps/sidecar/tests/`, `apps/server/src/adapters/http/`, `apps/server/src/`, `packages/adapters/src/sidecar/`, `packages/adapters/src/postgres/`, `packages/contracts/src/`, `packages/core/src/streaming/`, `apps/web/src/{components,screens,hooks,lib}/`
**Files read for extraction:** 22 (main.py, seed_token.py, positions_proxy.py, config.py [sidecar], token_store.py, advisory_lock.py, conftest.py, test_positions_proxy.py, test_token_store.py, brokerage.routes.ts, supabase-auth.ts, settings.routes.ts + test, status.routes.ts, chain-adapter.ts + test, positions-reconciler.ts, config.ts [server], main.ts, AuthExpiredBanner.tsx + test, Button.tsx, dialog.tsx, useStatus.ts, useRuleSettings.ts, rpc.ts, RuleSettingsModal.tsx, status.ts)
**Pattern extraction date:** 2026-07-13
