# Phase 4: Schwab Connection and Token Lifecycle - Research

**Researched:** 2026-08-31
**Domain:** Multi-user OAuth against an untyped vendor SDK; Postgres-native per-user locking; RLS on a new table
**Confidence:** HIGH on the vendor boundary and typing mechanics (verified against real source and real checker runs this session); MEDIUM on operational thresholds not written down anywhere in the record; LOW on anything marked `[ASSUMED]` below.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D4-01: `schwab-py` 1.5.1 ships NO `py.typed` marker, and no stub package exists.** Closed — do not re-verify. (Independently re-confirmed this session against the real downloaded wheel: still no `py.typed` anywhere in it, and it now also confirms the wheel contains more than the 7 files CONTEXT.md listed — `client/`, `orders/`, `contrib/`, `scripts/` subpackages exist too, none of them typed either. This widens the surface D4-01 describes; it does not weaken the conclusion.)
- **D4-02:** The project owns a `Protocol` naming exactly the methods it uses — `get_transactions`, `get_account_numbers`, `get_option_chain`, `get_quotes`. Exactly one adapter module imports `schwab`.
- **D4-03:** Every vendor response is parsed with `model_validate()` at the call site, immediately. `response.json()` is the untrusted-input boundary. Never a `TypedDict` cast.
- **D4-04:** The suppression budget is one narrowly-scoped `# why:` suppression inside the adapter module, and none anywhere else.
- **D4-05:** Vendor behaviour is tested with a fake implementing the `Protocol`, zero network calls. Not HTTP-level mocking.
- **D4-06:** `schwab.auth.get_auth_context()` builds the authorize URL; the callback route hands the received URL to `schwab.auth.client_from_received_url()` with a `token_write_func` closure. Never `easy_client()`/`client_from_login_flow()`.
- **D4-07:** The `state` nonce reuses Phase 2's `setup_tokens` shape: single-use, TTL'd, atomic `DELETE ... RETURNING`, hash-only storage.
- **D4-08:** `CONN-03`/`NN-34` is proven by a test that captures all log output and asserts the code and redirect URL appear nowhere.
- **D4-09:** Re-authorisation repairs the existing connection row. Row count for that user stays exactly 1.
- **D4-10:** The refresh lock is `pg_advisory_xact_lock(hashtext(user_id))` — transaction-scoped, per-user.
- **D4-11:** Tokens are encrypted under the user's existing Phase 3 DEK, same envelope, same write path. Not a separate secrets table/key domain.
- **D4-12:** Connection health is derived from `expires_at` at read time — `healthy`/`expiring_soon`/`expired`. Never a stored status column.
- **D4-13:** This phase records that a notification is due. Delivery is a later phase.
- **D4-14: No live Schwab calls in this phase.** Reading the library's source is expected; hitting the real endpoint is not.
- **D4-15:** The 7-day expiry cannot be observed inside a test run. Prove the logic with an injected clock/parameter; record honestly that the real 7-day window has never been observed.
- **D4-16:** The last-successful-sync timestamp is written only on a genuinely successful sync.
- **D4-17:** Schwab's account hash is resolved once at connect time and stored encrypted, not re-resolved per request.
- **D4-18 – D4-21:** Carried forward — `Decimal` end to end; RLS `ENABLE`+`FORCE`, no admin clause, narrowed grants; write paths don't commit internally; migrations are append-only (0001–0009 applied, this phase adds 0010+).

### Claude's Discretion

- Exact TTL for the OAuth `state` nonce (not specified — see Assumptions Log A1).
- Exact `expiring_soon` threshold (not specified in CONTEXT.md — record below cites V001's own operational practice, see Assumptions Log A2).
- Whether the account-hash/token ciphertext live in one row or split further.
- What "a genuinely successful sync" means operationally in Phase 4, before Phase 6's real ingest exists (see Open Questions).
- Table name and exact column layout (no name given in CONTEXT.md).

### Deferred Ideas (OUT OF SCOPE)

- Notification delivery — recorded as due here (D4-13), delivered in a later phase.
- Live Schwab integration testing — deferred with the 7-day-window observation (D4-14, D4-15).
- `get_option_chain`/`get_quotes` usage — named in the `Protocol` for Phase 8, not exercised by this phase's tests.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-01 | User connects their own Schwab account via self-started OAuth | `get_auth_context`/`client_from_received_url` signatures verified from source (Architecture Patterns, Pattern 1); FastAPI route split (authenticated initiate route + unauthenticated callback route) |
| CONN-02 | OAuth CSRF state is single-use, TTL'd, atomic-delete nonce | D4-07 reuse of `setup_tokens` — concrete `TokenPurpose.OAUTH_STATE` addition, no new table (Architecture Patterns, Pattern 2) |
| CONN-03 | Code/redirect URL never in log, error response, or body | Verified: no logging on the OAuth exchange path in `schwab.auth` or `authlib`'s httpx client; the real leak vectors are the app's own route code and the ASGI access log (Common Pitfalls 1, 2) |
| CONN-04 | Connection health readable as healthy/expiring-soon/expired with `expires_at` | Pure function over `token_created_at` + `now`; threshold sourced from V001 (Code Examples, Pattern 4) |
| CONN-05 | Self-service re-authorisation repairs the existing row | `INSERT ... ON CONFLICT (user_id) DO UPDATE` or explicit `UPDATE`-first flow (Architecture Patterns, Pattern 3) |
| CONN-06 | Per-user refresh lock, never blocks another user | `pg_advisory_xact_lock(hashtext(user_id::text))`, verified live against local Postgres 18 (Code Examples, Pattern 5) |
| CONN-07 | Last-successful-sync timestamp, queryable | Written only after a real vendor round-trip succeeds; what counts as "a sync" in this phase is an Open Question |

</phase_requirements>

## Summary

This phase's real difficulty is not OAuth — it's making an untyped, synchronous-token-callback vendor SDK behave inside an async, `mypy --strict`/basedpyright-strict, no-`Any` codebase without either (a) suppressing type errors everywhere, or (b) silently losing a token write. Both problems have concrete, verified answers this session, from the actual downloaded `schwab-py` 1.5.1 wheel and a real basedpyright/mypy run against this project's exact pinned versions and exact `pyproject.toml` strictness config — not from documentation or memory.

Two findings are load-bearing and change the plan materially from a naive reading of D4-02–D4-04:

1. **A small local `.pyi` stub package for the ~6 vendor symbols the adapter uses eliminates every basedpyright/mypy diagnostic from `schwab-py`'s untyped surface — verified this session, zero suppressions needed for that half of the problem.** The *only* diagnostic that survives is `reportAny` on `httpx.Response.json()`'s own, legitimate, intentional `Any` return (httpx is typed; `.json()` is `Any` by design since JSON has no static shape) — and that fires once per call site unless funneled through one shared private helper. Routed through one helper function, this is genuinely the *one* suppression D4-04 asks for, not four.
2. **`schwab-py`'s `token_write_func`/`token_read_func` must be plain synchronous callables — not `async def` — even when `asyncio=True`.** Verified by reading `schwab/auth.py` directly: the library's own internal wrapping calls these closures without `await`, and `schwab-py`'s own test suite for the `asyncio=True` path (`tests/auth_test.py::ClientFromReceivedUrl::test_success_async`) only ever exercises a plain sync lambda. An `async def` closure here is a silently-skipped token write — the coroutine object is created and immediately discarded, no error, no log line. This means the adapter cannot hand schwab-py a closure that awaits the project's `AsyncSession`; it must capture the token synchronously into a plain in-memory holder, then perform the real async DB write itself, explicitly, after the vendor call returns.

**Primary recommendation:** Ship a local `typings/schwab/{__init__,auth,client}.pyi` partial-stub package (wired via basedpyright's `stubPath` and mypy's `mypy_path`) covering exactly the symbols in the `Protocol` plus `get_auth_context`/`AuthContext`/`client_from_received_url`/`client_from_access_functions`. Build the adapter around a single `_response_json(resp: httpx.Response) -> object` helper carrying the one permitted `# pyright: ignore[reportAny]`. Never pass an `async def` closure into `schwab.auth.*`; capture tokens synchronously into a holder and persist them from the caller's own async code.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth authorize-URL construction, state issuance | API/Backend | — | `get_auth_context` runs server-side; no browser code exists in this project (backend-only milestone) |
| OAuth callback / code exchange | API/Backend | — | Must run server-side to hold `app_secret`; the redirect target is a FastAPI route, not a client |
| CSRF state storage/consumption | Database/Storage | API/Backend | Reuses `setup_tokens`, a Postgres table; the atomic consume is a single SQL statement |
| Token encryption/storage | Database/Storage | API/Backend | Same DEK/envelope as Phase 3's `fills`/`events`; API layer only orchestrates |
| Per-user refresh serialization | Database/Storage | API/Backend | `pg_advisory_xact_lock` is a Postgres primitive; the API process merely opens the transaction that holds it |
| Connection health derivation | API/Backend | — | Pure function over stored `token_created_at`; no new tier, no cron needed for this phase |
| Vendor HTTP calls (`get_transactions` etc.) | API/Backend | — | One adapter module, server-side; `schwab-py` never runs in a browser context |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `schwab-py` | 1.5.1 [VERIFIED: PyPI `pip index versions schwab-py`, this session — 1.5.1 is current, next-newest is 1.5.0] | Schwab OAuth + trading API client | Already an explicit project constraint (CLAUDE.md, REBUILD-BRIEF.md); pinned from v1's 3 months of live production use |
| `authlib` | `>=1.6.0` per schwab-py's own `Requires-Dist` [VERIFIED: `schwab_py-1.5.1.dist-info/METADATA`, this session] — do not pin lower elsewhere | OAuth2 client primitives, used internally by `schwab.auth` | Transitive only — do not add as a direct dependency for this flow (CLAUDE.md's own "What NOT to Use" already says so); `schwab-py` already wraps what's needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| none new | — | — | Everything else (encryption, RLS, tokens, locking) reuses Phase 2/3 modules already in the tree |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Local `.pyi` stub package for the vendor boundary | Per-call-site `# pyright: ignore` comments | Verified this session: the per-call-site approach needs one suppression *per untyped attribute access and per untyped local variable* — at least 4–6 per Protocol method, not one. It cannot satisfy D4-04's "one suppression in the whole module" on its own. The stub package does, and produces a genuinely typed boundary rather than a hidden gap. |
| Synchronous token-write closures + explicit post-call DB persist | Passing an `async def` closure directly to `client_from_access_functions` | Verified this session (source read + schwab-py's own test suite): an async closure here is never awaited by schwab-py's internal wrapping, regardless of `asyncio=True`. It silently drops the write. |

**Installation:**
```bash
uv add schwab-py==1.5.1
```
No `authlib` line is added directly — it arrives transitively.

**Version verification:** `pip index versions schwab-py` was run live this session; 1.5.1 is current. `pip download schwab-py==1.5.1 --no-deps` was used to obtain and inspect the real wheel contents (see Package Legitimacy Audit and Sources).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `schwab-py` | PyPI | Published 2025-06-30 [VERIFIED: seam `publishedAt`] | Not exposed by PyPI's API — seam reports `null` | `github.com/alexgolec/schwab-py` [VERIFIED: seam `repoUrl`, and independently confirmed — this is the wheel's own `Project-URL: Source` in its METADATA] | **SUS** (`reasons: ["unknown-downloads"]`) | **Flagged — planner must add `checkpoint:human-verify` before `uv add`, per protocol.** See note below. |

**Note on this SUS verdict, for the human doing that checkpoint:** the flag fires because PyPI's public API doesn't expose a weekly-download count the seam can read — a data gap, not a signal about the package itself. Independent evidence gathered directly this session, not from training data: the wheel was downloaded and its full contents inspected (`schwab/auth.py`, `client/`, `orders/`, `debug.py`, etc. — real, substantial, working OAuth+HTTP-client code, not a stub or placeholder); its own test suite (`tests/auth_test.py` et al.) is real and exercises the code paths this phase depends on; and this exact package and version is already an explicit, pre-existing project constraint carried forward from v1's three months of live production use (CLAUDE.md, REBUILD-BRIEF.md §2 "apps/sidecar... `schwab-py` pinned to exactly 1.5.1"). This is not a fresh discovery via web search — treat the SUS flag as procedurally required, not as new doubt about the package.

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `schwab-py` — see above; human checkpoint required before install, per protocol, despite the corroborating evidence.

## Architecture Patterns

### System Architecture Diagram

```
                    Browser (already logged in, morai_session cookie)
                         │
                         │ 1. POST /schwab/connect  (authenticated)
                         ▼
              ┌─────────────────────────┐
              │   FastAPI route          │
              │   (routes_connections)   │
              │  - get_current_user      │
              │  - issue_token(purpose=  │
              │    OAUTH_STATE)          │──────► setup_tokens (reused table,
              │  - schwab.auth.          │        new TokenPurpose value)
              │    get_auth_context()    │
              └───────────┬──────────────┘
                          │ 2. authorization_url
                          ▼
                 Schwab's own login/consent UI
                          │ 3. redirect: GET /schwab/callback?code=...&state=...
                          ▼
              ┌─────────────────────────┐
              │   FastAPI route          │   UNAUTHENTICATED — the consumed
              │   (routes_connections)   │   state IS the credential (same
              │  - consume_token(purpose │   shape as /setup, D4-07)
              │    =OAUTH_STATE) -> uid  │
              │  - adapter.exchange_code │──────► schwab.auth.client_from_received_url()
              │    (uid, received_url)   │        (ONE outbound HTTPS call, real network,
              │  - adapter.resolve_      │        never exercised in this phase's tests —
              │    account_hash(client)  │        D4-14; a Protocol fake stands in)
              │  - encrypt + upsert      │──────► schwab_connections (RLS, per-user DEK,
              │    schwab_connections    │        D4-11, D4-17)
              └───────────┬──────────────┘
                          │ 4. GET /schwab/connection  (authenticated, any time after)
                          ▼
              ┌─────────────────────────┐
              │  derive_connection_      │   pure function: token_created_at + now
              │  health(token_created_at,│   -> healthy | expiring_soon | expired
              │  now) -> HealthStatus    │   (D4-12 — never a stored column)
              └─────────────────────────┘

                (separately, any time a Schwab call is needed:)
              ┌─────────────────────────┐
              │  adapter.with_refresh_   │
              │  lock(user_id):          │──────► pg_advisory_xact_lock(hashtext(user_id))
              │   - read+decrypt token   │        (D4-10 — per-user, xact-scoped)
              │   - client_from_access_  │
              │     functions(sync       │
              │     read/write closures) │
              │   - call vendor method   │──────► Schwab Trader API (no live call in tests)
              │   - if token changed,    │
              │     re-encrypt + UPDATE  │──────► schwab_connections
              └─────────────────────────┘
```

### Recommended Project Structure

```
src/morai/
├── schwab/                       # the ONE package that imports `schwab` (D4-02)
│   ├── __init__.py
│   ├── protocol.py                # SchwabClient Protocol + response models
│   ├── adapter.py                 # SchwabAdapter (real, imports `schwab`), auth wrappers
│   └── connections.py             # DB read/write for schwab_connections, health derivation, lock
├── api/
│   └── routes_connections.py      # /schwab/connect, /schwab/callback, /schwab/connection
typings/
└── schwab/                        # local partial stubs — the typing fix, see Code Examples
    ├── __init__.pyi
    ├── auth.pyi
    └── client.pyi
alembic/versions/
└── 0010_schwab_connections.py
tests/
├── schwab/
│   ├── conftest.py                 # FakeSchwabClient implementing the Protocol (D4-05)
│   ├── test_oauth_flow.py          # criteria 1, 2, 3
│   ├── test_reauth.py              # criterion 3 (D4-09 row-count-stays-1)
│   ├── test_refresh_lock.py        # criterion 4 (positive control on scoping)
│   └── test_health.py              # criterion 5, D4-15's injected-`now` proof
└── gate/fixtures/
    └── violation_schwab_json_boundary.py   # proves reportAny fires without the suppression
```

**Why not more packages:** one adapter package, following the project's own established pattern (`morai.crypto`, `morai.identity`, `morai.ledger` are each one flat module or a small handful) — not a `ports`/`adapters` hexagon (REBUILD-BRIEF.md §4 "Drop: Four packages as the default shape... split again only when a second consumer actually appears").

### Pattern 1: The auth handshake, using the real verified signatures

**What:** `get_auth_context`/`client_from_received_url` as actually defined in `schwab/auth.py` (source read directly from the downloaded 1.5.1 wheel, not from docs).

```python
# Source: schwab-py 1.5.1 wheel, schwab/auth.py (downloaded and read this session)
AuthContext = collections.namedtuple(
    'AuthContext', ['callback_url', 'authorization_url', 'state'])

def get_auth_context(api_key, callback_url, state=None):
    oauth = OAuth2Client(api_key, redirect_uri=callback_url)
    authorization_url, state = oauth.create_authorization_url(
        'https://api.schwabapi.com/v1/oauth/authorize', state=state)
    return AuthContext(callback_url, authorization_url, state)

def client_from_received_url(
        api_key, app_secret, auth_context, received_url, token_write_func,
        asyncio=False, enforce_enums=True):
    # Reconstructs its own OAuth2Client -- auth_context must be serializable,
    # and only its `.callback_url` and `.state` fields are actually read here.
    oauth = OAuth2Client(api_key, redirect_uri=auth_context.callback_url)
    token = oauth.fetch_token(
        TOKEN_ENDPOINT, authorization_response=received_url,
        client_id=api_key, auth=(api_key, app_secret), state=auth_context.state)
    ...
```

**Critical, verified consequence:** pass **our own** `state` into `get_auth_context(api_key, callback_url, state=our_raw_nonce)` — if `state` is omitted, `authlib`'s `OAuth2Client.create_authorization_url` mints its own random one, which is not the value our `setup_tokens`-shaped nonce table can validate. At callback time, `client_from_received_url` needs an `AuthContext` — but only `.callback_url` and `.state` are read from it (confirmed by reading the function body above: `authorization_url` is never touched). This means the callback route does **not** need to persist the original `AuthContext` object across the redirect; it only needs the fixed, known `callback_url` and the `state` value it gets back from `consume_token()`. Reconstruct a throwaway one:

```python
auth_context = schwab.auth.AuthContext(
    callback_url=CALLBACK_URL, authorization_url="", state=consumed_state
)
```

### Pattern 2: The `state` nonce reuses `setup_tokens` (D4-07)

No new table. Add one enum member:

```python
# morai/identity/setup_tokens.py
class TokenPurpose(StrEnum):
    SETUP = "setup"
    PASSWORD_RESET = "password_reset"
    OAUTH_STATE = "oauth_state"   # new — no DB migration needed
```

`setup_tokens.purpose` is a bare `sa.String()` with no CHECK constraint [VERIFIED: `alembic/versions/0003_identity_and_rls.py:161`, `sa.Column("purpose", sa.String(), nullable=False)` — no `CheckConstraint` on this column anywhere in that migration] — adding a new Python-level enum value needs zero schema change. `setup_tokens` also carries no RLS policy at all, deliberately [VERIFIED: `alembic/versions/0003_identity_and_rls.py:215-219`, comment: "Deliberately NOT on `sessions` and `setup_tokens`: possession of the opaque, 256-bit token IS the authorization for those two"] — exactly the property the OAuth callback needs, since it arrives with no session cookie.

```python
raw_state = await issue_token(
    session, user_id=current_user.user_id,
    purpose=TokenPurpose.OAUTH_STATE, ttl=_OAUTH_STATE_TTL,
)
# ... later, in the unauthenticated callback route:
user_id = await consume_token(
    session, raw_token=received_state, purpose=TokenPurpose.OAUTH_STATE
)
if user_id is None:
    raise HTTPException(status_code=400)
```

### Pattern 3: Re-auth repairs the row, never inserts a second one (D4-09)

Since `schwab_connections.user_id` is the primary key (one row per user by construction, not by a runtime check), an `UPDATE` naturally repairs; there is no `INSERT` path at all for re-auth. Recommend `session.merge()`-free explicit branching to keep the "does a row exist" question visible in the code, matching this codebase's style of explicit `SELECT`-then-branch elsewhere (`/admin/users` duplicate-username handling) rather than reaching for `ON CONFLICT DO UPDATE` (which would also work, but this table's PK-is-user_id shape makes a plain `UPDATE ... WHERE user_id = :uid`, falling back to `INSERT` only if `rowcount == 0`, the more auditable choice — matching `/setup`'s own `rowcount != 1` guard pattern in `routes_identity.py`).

### Pattern 4: Health derivation — pure function, `now` as a parameter (D4-12, D4-15)

No `Clock` abstraction needed. This codebase's own existing idiom for "prove expiry logic without waiting" is simpler: `test_expired_token_returns_none_and_row_is_left_in_place` in `tests/identity/test_setup_tokens.py` passes `ttl=timedelta(seconds=-1)` directly — no clock injection machinery at all. The equivalent here is a pure function taking `now` explicitly:

```python
from enum import StrEnum
from datetime import datetime, timedelta

class ConnectionHealth(StrEnum):
    HEALTHY = "healthy"
    EXPIRING_SOON = "expiring_soon"
    EXPIRED = "expired"

_REFRESH_TOKEN_LIFETIME = timedelta(days=7)          # V001, server-side, hard, unextendable
_EXPIRING_SOON_THRESHOLD = timedelta(hours=12)        # see Assumptions Log A2

def derive_connection_health(
    token_created_at: datetime, now: datetime
) -> tuple[ConnectionHealth, datetime]:
    expires_at = token_created_at + _REFRESH_TOKEN_LIFETIME
    remaining = expires_at - now
    if remaining <= timedelta(0):
        return ConnectionHealth.EXPIRED, expires_at
    if remaining <= _EXPIRING_SOON_THRESHOLD:
        return ConnectionHealth.EXPIRING_SOON, expires_at
    return ConnectionHealth.HEALTHY, expires_at
```

Tests call `derive_connection_health(token_created_at=fixed_datetime, now=fixed_datetime + timedelta(days=6, hours=13))` directly — no mocking `datetime.now()`, no clock protocol, no freezegun. This is D4-15's honest boundary made explicit in code: the function is proven correct for arbitrary `(token_created_at, now)` pairs; the real 7-day vendor window itself has still never been observed, and the docstring should say so plainly, matching D4-15's instruction.

**Why `token_created_at`, not "the most recent refresh":** `schwab-py`'s own `TokenMetadata` class distinguishes these explicitly [VERIFIED: `schwab/auth.py`, `TokenMetadata.__init__` docstring]: *"creation_timestamp: Timestamp at which this token was initially created. Notably, this timestamp does not change when the token is updated."* Every token write this project's `token_write_func` receives is already wrapped as `{'creation_timestamp': int, 'token': {...}}` by `TokenMetadata.wrap_token_in_metadata` — the app does not need to compute or track this itself; it needs to **read it out of what the vendor already hands back** and store it once, at initial connect (and again at each *re*-auth, since re-auth is a fresh grant), never touching it on ordinary automatic refreshes.

### Pattern 5: The per-user refresh lock (D4-10, CONN-06)

```python
await session.execute(
    text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
    {"uid": str(user_id)},
)
```

[VERIFIED: run live against local Postgres 18 this session] — `hashtext('...')` returns `integer` (int4); `pg_advisory_xact_lock` accepts it directly via Postgres's automatic int4→bigint widening (the exact same one-argument shape `tools/create_admin.py` already uses with a fixed string key). A bind parameter works here — unlike `SET LOCAL`, `pg_advisory_xact_lock(hashtext(...))` is an ordinary function call in expression position, not special `SET`-statement grammar, so `$1`/`:uid` binding is not the `identity/sessions.py`-documented trap. Also verified live with an actual bound parameter, not just a literal.

**Collision probability, computed, not asserted:** int4 space is `2^32 ≈ 4.29×10^9` buckets. For "a handful of users" (4–5, per the project's own stated scope), the birthday-style collision probability is `n(n-1)/2 / 2^32` — for n=5, `10 / 4.295×10^9 ≈ 2.3×10^-9`. If a collision ever did occur, its effect is a *false extra serialization* between two unrelated users' refreshes (safe, just briefly slower) — never a false *sharing* of token data, since the lock only gates the critical section; it never becomes a join key or a cache key. Criterion 4 does not need to defend against this; it needs to prove that with distinct keys, two refreshes run concurrently.

**Proving criterion 4 (positive control, not a naive assertion):** mirror `test_concurrent_consume_produces_exactly_one_winner`'s two-independent-engines-plus-`asyncio.gather` shape (`tests/identity/test_setup_tokens.py`) but invert the assertion's shape: start user A's "refresh" holding the lock for a controlled duration (an `asyncio.Event` the test sets after user B's attempt has already completed, not a `pg_sleep` which would block inside the DB connection itself), and assert user B's attempt completes and commits *while A's transaction is still open* — proving B never queued behind A. A naive test that only checks "both eventually succeed, no error" would also pass under one single global lock; the timing/ordering assertion is what a single-global-lock bug would fail.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth2 authorization-code exchange | A hand-rolled `httpx` POST to Schwab's token endpoint | `schwab.auth.client_from_received_url()` (wraps `authlib`) | Already handles PKCE-adjacent state plumbing, token metadata wrapping, and the client construction; re-deriving it duplicates a maintained library for zero benefit |
| CSRF nonce storage/consumption | A second `oauth_state` table with its own atomic-consume function | `setup_tokens` + a new `TokenPurpose` | D4-07 — a second implementation of a solved, already-concurrency-tested problem is the exact duplicated-write shape `L060`/this project's history warns against |
| Vendor-response validation | `TypedDict` + `cast()` | Pydantic `model_validate()`/`TypeAdapter` | D4-03, and this project's own established `_STR`/`_BYTES` `TypeAdapter` idiom (`identity/rls.py`, `ledger/fills.py`) — `cast` asserts a shape without checking it |
| Per-user mutual exclusion | A Python-level `asyncio.Lock`/`threading.Lock`, or a Redis lock | `pg_advisory_xact_lock` | The lock must hold across process boundaries (multiple Hypercorn workers, or web + a future worker process) and release automatically on crash — an in-process lock does neither; this project has already standardized on the Postgres advisory-lock primitive (`tools/create_admin.py`) |

**Key insight:** every "don't hand-roll" here already has a load-bearing precedent elsewhere in this exact codebase. This phase's actual novel work is the vendor-typing boundary (Code Examples below) and the two-role (authenticated-initiate, unauthenticated-callback) route split — everything else is applying patterns that already have tests proving they work.

## Common Pitfalls

### Pitfall 1: The ASGI access log, not `schwab-py`, is the likeliest real leak of the code/redirect URL (CONN-03, NN-34)

**What goes wrong:** Hypercorn's (and uvicorn's) default access-log line format includes the full request line — path *and query string* (`%(r)s`) — verbatim. An OAuth callback's query string **is** `?code=...&state=...`. If access logging is ever turned on for the production Hypercorn process without first stripping the query string from the format, every callback leaks the code and state to stdout/Railway logs the instant the feature is enabled.

**Why it happens:** access logging is off by default [VERIFIED: `hypercorn==0.18.0` — this project's exact pinned version — `Config().accesslog` is `None` unless explicitly set, and `Config().access_log_format` (`'%(h)s %(l)s %(l)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'`) includes the full request line by default, confirmed live via `uv run python3 -c "import hypercorn.config as c; print(c.Config().accesslog, c.Config().access_log_format)"`], so this pitfall is dormant today but becomes live the moment anyone reaches for `--access-logfile -` to debug a Railway request in production.

**How to avoid:** never enable Hypercorn access logging on the `/schwab/callback` route's process without a format string that excludes the query string, or route access logging through middleware that redacts query params on that one path. Document this in the adapter/route module so a future "just turn on access logs to debug" instinct is met with a warning, not a leak.

**Warning signs:** any Railway service config or `Procfile`/start-command diff that adds `--access-logfile`.

### Pitfall 2: The log-capture test structurally cannot prove the production access log is clean (D4-08, honest gap)

**What goes wrong:** the natural D4-08 test drives the FastAPI app over `httpx.ASGITransport` — the same pattern every existing identity test uses (`tests/identity/test_login_logout.py`). `ASGITransport` is in-process; it never spins up a real Hypercorn server and therefore never produces an access log line at all.

**Why it happens:** this is the correct, fast, local-first test shape (matches `.claude/rules/workflow.md`'s "test locally" mandate) — but it means the test proves the *application's own* logger (and anything `schwab.auth`/`authlib` log, which is nothing, per Pitfall 1's sibling finding below) never contains the secret. It cannot prove Pitfall 1's scenario is unreachable in production, because that requires a real server.

**How to avoid:** state this gap explicitly in the phase's SUMMARY, per D4-15's own precedent for honest gaps — don't claim NN-34 "verified end-to-end" when only the application layer was exercised. If closing this gap is ever wanted, it needs an actual Hypercorn subprocess test (out of scope here per D4-14's own preference for fast, local tests).

**Warning signs:** a SUMMARY claiming "no secret leaks anywhere in the system" rather than "no secret leaks from any code this project wrote."

### Pitfall 3: `schwab.auth`/`authlib`'s own code does not log the code or redirect URL at all — verified, not assumed

**What goes wrong:** nothing, if the app trusts this without checking. But CONTEXT.md's own required reading flagged `debug.py` as a suspect.

**What was actually found:** `schwab/debug.py`'s `LogRedactor`/`register_redactions` mechanism is **opt-in only** — it does nothing to the standard `logging` module's output unless `enable_bug_report_logging()` is explicitly called (which nothing in `client_from_received_url`/`client_from_access_functions` does). Separately, and independently: `schwab/client/asynchronous.py` **shadows its own import** of `register_redactions_from_response` with a local no-op `def register_redactions_from_response(x): pass` two lines below the import [VERIFIED: `schwab/client/asynchronous.py:2-6`, read directly from the downloaded wheel] — meaning even the opt-in redaction path is dead code for the async client specifically. Grepping every `logger.debug`/`logger.info` call in `schwab/auth.py` and `schwab/client/*.py` [VERIFIED, this session, exhaustive grep of the wheel] shows: `auth.py` only logs `token_path` (a filesystem path, never used by this project's `client_from_access_functions`-based design) and generic status strings; `client/asynchronous.py` and `synchronous.py` log `Req %s: GET/POST to %s, params=%s` **but only from inside `_get_request`/`_post_request`/etc.**, which are only reached by `Client`/`AsyncClient` *trading-API* method calls (`get_transactions`, `get_option_chain`, ...) — never by the OAuth exchange, which goes through `authlib`'s `OAuth2Client.fetch_token` on a completely separate code path. Grepping `authlib`'s `integrations/httpx_client/oauth2_client.py` [VERIFIED, `authlib` 1.8.0, this session] found **zero logging calls anywhere in that module.**

**Consequence for the adapter:** the OAuth code/redirect URL is never at risk from schwab-py's or authlib's own logging, in this design, because those libraries never log inside the one function (`client_from_received_url`) that ever touches them. The one real risk is the application's own code (don't log `received_url`, don't put it in an exception message) and Pitfall 1's access-log scenario. Once real API calls begin (Phase 6+), the `Req %s: ... params=%s` DEBUG line **does** apply and will log full request parameters (potentially including account data) at DEBUG level — set `logging.getLogger("schwab.client.base").setLevel(logging.WARNING)` (or higher) at boot, and never call `enable_bug_report_logging()` in this project.

### Pitfall 4: `token_write_func`/`token_read_func` must be synchronous — an `async def` closure is silently never awaited

**What goes wrong:** the natural instinct in an all-async codebase is to write `async def token_write_func(token): await persist_to_db(token)` and hand it to `client_from_access_functions(..., asyncio=True, token_write_func=token_write_func)`.

**Why it happens (verified, not assumed):** reading `schwab/auth.py` line by line: in `client_from_received_url`, the initial post-exchange write is `token_write_func(token)` — called directly, never awaited, regardless of `asyncio`. In `client_from_access_functions`'s `asyncio=True` branch: `async def oauth_client_update_token(t, *a, **kw): wrapped_token_write_func(t, *a, **kw)` — note `wrapped_token_write_func` (our closure, wrapped) is called **without `await`** inside this `async def`. Calling an `async def` function without awaiting it creates a coroutine object and runs *none* of its body — no exception, no warning surfaced to the caller, the write simply never happens. This is corroborated independently by `schwab-py`'s own test suite: `tests/auth_test.py::ClientFromReceivedUrl::test_success_async` [VERIFIED, read directly from the wheel] passes `lambda token: token_capture.append(token)` — a plain synchronous lambda — as `token_write_func`, even while testing the `asyncio=True` path. The library's own tests never exercise an async write closure, which is itself circumstantial confirmation it isn't supported.

**How to avoid:** never pass an `async def` to `token_write_func`/`token_read_func`. Capture the token into a plain mutable holder (a one-element list, or a small mutable dataclass) synchronously; after the `await client.some_method(...)` call returns (control has by then returned from all of schwab-py's internal synchronous callback plumbing), read the holder's current value from the *caller's* own async code and persist it explicitly with `await session.execute(...)`. `token_read_func` similarly just returns an already-decrypted-in-memory dict captured by closure — the actual async DB read to fetch and decrypt the stored token happens *before* constructing the client, not inside the closure.

**Warning signs:** a token that is visibly refreshed (the client keeps working past what should be a stale-token failure) but the stored `schwab_connections` row's ciphertext never changes between requests — the surest sign the write callback is a no-op coroutine being garbage-collected.

### Pitfall 5: `accounts[0]` (or the first `get_account_numbers()` entry) is not necessarily the trading account (V006, D4-17)

**What goes wrong:** `get_account_numbers()` returns a list of `{accountNumber, hashValue}` pairs [VERIFIED: `schwab/client/base.py:154-161`, docstring: "Returns a mapping from account IDs available to this token to the account hash..."]. Array order is not a documented contract.

**Cost, previously paid:** V001 (this project's own record) — the account resolver in v1 read an empty account instead of the real one, purely from array-position assumption.

**How to avoid:** if the response contains exactly one entry, use it. If it contains more than one, this phase cannot silently pick — surface all returned entries back to the connecting user (in the connect/callback response) and require an explicit choice, or fail loudly and record an open item, rather than defaulting to index 0. v1's fix (`SCHWAB_ACCOUNT_NUMBER` env var) does not translate to a multi-user system — there is no single global answer.

### Pitfall 6: `authlib`'s httpx integration is mid-deprecation upstream — noise now, a real pin risk soon

**What was found:** installing `authlib` unpinned (as `schwab-py`'s `Requires-Dist: authlib>=1.6.0` allows) resolves to 1.8.0 today, which emits `AuthlibDeprecationWarning: The httpx module is deprecated; please use httpx2 instead` on import [VERIFIED: observed directly this session, installing schwab-py's real dependency tree]. `schwab-py` itself is described in this project's own CLAUDE.md as slow-moving (no release since 2025-06-30, per PyPI). If `authlib` removes its `httpx_client` module in some future major version before `schwab-py` migrates, an unpinned `authlib` resolution could break this project's `client_from_access_functions` import at the next `uv sync`, with no code change on this project's side.

**How to avoid:** the project need not pin `authlib` explicitly today (it isn't a direct dependency, and `schwab-py`'s own constraint is already a floor), but this is worth a one-line note in `docs/learnings/vendors-and-infra.md` as a Schwab-adjacent trap to watch, and a reason to re-run `uv lock --upgrade` deliberately rather than blindly before any production deploy.

## Code Examples

### The local partial-stub package — verified to fully clear both checkers

```python
# Source: this session's own verification run — basedpyright 1.39.10 and
# mypy 2.3.1 (this project's exact pinned versions) both report zero errors
# against a fixture using these stubs, with this project's exact strict
# config (reportAny=error, reportExplicitAny=error, strict=true).
# typings/schwab/client.pyi
import httpx

class AsyncClient:
    async def get_account_numbers(self) -> httpx.Response: ...
    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: object | None = ...,
        end_date: object | None = ...,
        symbol: str | None = ...,
    ) -> httpx.Response: ...
    async def get_option_chain(self, symbol: str, **kwargs: object) -> httpx.Response: ...
    async def get_quotes(
        self, symbols: list[str] | str, **kwargs: object
    ) -> httpx.Response: ...
```

```python
# typings/schwab/auth.pyi
from collections.abc import Callable
from typing import NamedTuple
from schwab.client import AsyncClient

class AuthContext(NamedTuple):
    callback_url: str
    authorization_url: str
    state: str

def get_auth_context(
    api_key: str, callback_url: str, state: str | None = ...
) -> AuthContext: ...
def client_from_received_url(
    api_key: str,
    app_secret: str,
    auth_context: AuthContext,
    received_url: str,
    token_write_func: Callable[[object], None],
    asyncio: bool = ...,
    enforce_enums: bool = ...,
) -> AsyncClient: ...
def client_from_access_functions(
    api_key: str,
    app_secret: str,
    token_read_func: Callable[[], object],
    token_write_func: Callable[[object], None],
    asyncio: bool = ...,
    enforce_enums: bool = ...,
) -> AsyncClient: ...
```

Wire-up (matches this project's existing `pyproject.toml` sections — additive only):

```toml
[tool.basedpyright]
stubPath = "typings"   # add alongside the existing keys

[tool.mypy]
mypy_path = "typings"  # add alongside the existing keys
```

### The one permitted suppression, and nothing else

```python
# Source: this session's own verification run. Removing the suppression
# comment below reproduces exactly:
#   "fixture.py:10:12 - error: Return type is Any (reportAny)"
# under basedpyright 1.39.10 in this project's exact strict config.
# mypy --strict reports zero issues on this line with or without the
# comment -- confirmed both ways this session -- matching this project's
# own documented division of labour (pyproject.toml's `[tool.mypy]` comment
# block: basedpyright owns Any-detection).

def _response_json(resp: httpx.Response) -> object:
    return resp.json()  # pyright: ignore[reportAny]  # why: httpx.Response.json() legitimately returns Any -- this is the untrusted-input boundary D4-03 names, funneled through one shared helper so it is the adapter module's only suppression (D4-04).
```

Every Protocol method then parses through a `TypeAdapter`, never a bare cast:

```python
_ACCOUNT_NUMBERS: TypeAdapter[list[AccountNumberEntry]] = TypeAdapter(
    list[AccountNumberEntry]
)

async def get_account_numbers(self) -> list[AccountNumberEntry]:
    resp = await self._client.get_account_numbers()
    return _ACCOUNT_NUMBERS.validate_python(_response_json(resp))
```

[VERIFIED, this session: this exact pattern — stub package + one `_response_json` helper + `TypeAdapter.validate_python` — produces `0 errors, 0 warnings, 0 notes` from `basedpyright` and `Success: no issues found in 1 source file` from `mypy --strict`, and `All checks passed!` from `ruff check` with this project's exact `select = ["E", "F", "PGH", "TID"]` lint config.]

### DDL for `schwab_connections`

```python
# Source: modeled directly on alembic/versions/0007_data_key_and_fills.py's
# own RLS/grant shape -- same ENABLE+FORCE+user_isolation+narrowed-grant
# pattern, applied to a table whose PK is the user_id itself (D4-09: exactly
# one row per user, by construction, not by a runtime uniqueness check).
op.create_table(
    "schwab_connections",
    sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), primary_key=True),
    sa.Column("account_hash_ciphertext", sa.LargeBinary(), nullable=False),
    sa.Column("account_hash_nonce", sa.LargeBinary(), nullable=False),
    sa.Column("token_ciphertext", sa.LargeBinary(), nullable=False),
    sa.Column("token_nonce", sa.LargeBinary(), nullable=False),
    sa.Column("key_version", sa.SmallInteger(), nullable=False),
    # Plaintext by design (D3-02-style call): schwab-py's own
    # TokenMetadata.creation_timestamp, never touched by ordinary refresh --
    # only ever rewritten by a fresh re-auth (D4-09). Not trading data;
    # CRYPT-02's scope is prices/quantities/P&L/free text, not connection
    # metadata timestamps -- same plaintext-timestamp precedent as
    # positions.opened_at/closed_at.
    sa.Column("token_created_at", sa.DateTime(timezone=True), nullable=False),
    # CONN-07, D4-16: NULL until the first genuinely successful sync.
    sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    # D4-13: records a notification is due; delivery is a later phase.
    sa.Column("reauth_notified_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column(
        "created_at", sa.DateTime(timezone=True),
        server_default=sa.func.now(), nullable=False,
    ),
)

# Unlike fills/events/positions, this table genuinely needs UPDATE --
# D4-09's repair-in-place is the requirement, not an artifact of the ORM.
bind.execute(sa.text(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON schwab_connections TO morai_app"
))

bind.execute(sa.text("ALTER TABLE schwab_connections ENABLE ROW LEVEL SECURITY"))
bind.execute(sa.text("ALTER TABLE schwab_connections FORCE ROW LEVEL SECURITY"))
bind.execute(sa.text(
    "CREATE POLICY user_isolation ON schwab_connections "
    "FOR ALL "
    "USING (user_id = current_setting('app.current_user_id', true)::uuid) "
    "WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid)"
))
```

**Also required, same migration or a follow-up task:** `morai/identity/account.py::delete_account` must gain one line — `await session.execute(delete(SchwabConnection).where(SchwabConnection.user_id == user_id))` — in the "identity rows" block, alongside `sessions`/`setup_tokens`. Without it, AUTH-06's crypto-shred flow (already shipped, Phase 3) leaves an orphaned `schwab_connections` row with a foreign key to a deleted `users.id`, and the account-deletion transaction fails on the FK constraint the moment this table exists — this is a real, concrete change to an existing function, not a hypothetical.

## State of the Art

| Old Approach (v1) | Current Approach (this phase) | When Changed | Impact |
|--------------------|-------------------------------|---------------|--------|
| One global token-refresh lock, one process owning the Schwab sidecar entirely (V002, L051) | Per-user `pg_advisory_xact_lock`, many users, no dedicated sidecar process | This phase (D4-10) | Multi-user was explicitly out of scope for v1 (REBUILD-BRIEF.md §1: "Multi-user, tenant isolation... One trader. Bearer token plus JWT sufficed.") — this is new ground, not a port |
| File-based token storage, read once at container boot (V001's own cited operational gotcha: a freshly seeded token needs a redeploy before anything uses it) | DB-backed token storage via `client_from_access_functions`, re-read fresh on every use | This phase | The v1 staleness trap does not carry forward — there is no long-lived process holding a stale in-memory token; each refresh attempt reads current ciphertext from Postgres |
| `easy_client()`/`client_from_login_flow()` (interactive, local-browser flows) | `get_auth_context()` + `client_from_received_url()` (server-side, remote-user-safe) | Already decided (D4-06), reconfirmed by reading the actual source this session | `client_from_login_flow` literally spins up a local Flask server via `multiprocess.Process` — confirmed unusable for a multi-user hosted service by reading its implementation directly, not just its docs |

**Deprecated/outdated:** nothing in this specific domain has moved since CLAUDE.md's tech-stack doc was written — `schwab-py` has shipped no release since 2025-06-30 (confirmed again this session).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OAuth `state` nonce TTL of ~15 minutes is long enough to cover a real user's browser round-trip (login + 2FA + consent at Schwab) without inviting a stale-state failure | Architecture Patterns, Pattern 2 | No record anywhere (`refuted.md`, `process-and-verification.md`, `LAWS.md` all grepped, zero hits on OAuth/CSRF/nonce TTL) states a specific number. Too short: real users fail the flow on slow logins/2FA. Too long: a wider window for a leaked `state` value (low severity, since it's still single-use and bound to one user) |
| A2 | `expiring_soon` fires at ≤12 hours remaining (i.e., token age ≥ 6.5 days) | Architecture Patterns, Pattern 4 | [CITED: `docs/learnings/vendors-and-infra.md` V001 — "the re-auth path itself was iteratively lowered in friction... a freshly seeded token needs..." and specifically "notification...when the stored token's age crosses ~6.5 days"] This is v1's own operational practice for a *notification*, repurposed here as a *display threshold* for CONN-04 — a reasonable adaptation, but CONTEXT.md does not itself specify a CONN-04 threshold, so treat this as a recommendation, not a locked number |
| A3 | "A genuinely successful sync" for CONN-07's purposes, in this phase (before Phase 6's real ingest exists), means a successful `get_account_numbers()` and/or narrow-window `get_transactions()` connectivity probe, with results discarded rather than stored | Open Questions | If the planner instead wants CONN-07 to mean nothing until Phase 6 ships, `last_synced_at` simply stays NULL through this whole phase — also defensible, and cheaper. Either reading satisfies the locked decisions; CONTEXT.md doesn't settle it |
| A4 | `schwab_connections` is the right table name (not `connections`, `schwab_tokens`, etc.) | Code Examples | Pure naming; zero functional risk, trivial to change before the migration lands |

**If this table is empty:** it is not — see above. The rest of this document's claims are `[VERIFIED]` (tool-run this session, cited) or `[CITED]` (the project's own prior record, cited by number).

## Open Questions

1. **What does "a genuinely successful sync" mean in Phase 4, before Phase 6's ingest exists?**
   - What we know: CONN-07 requires `last_synced_at` to be a queryable, honest fact; D4-16 requires it be written only on real success. Phase 6 (INGEST) is where fills actually get pulled and stored.
   - What's unclear: whether this phase should perform *any* real vendor round-trip at all beyond the one-time account-hash resolution at connect (D4-17), or whether `last_synced_at` should simply stay `NULL` throughout this phase, honestly representing "no sync has run yet, because no sync job exists yet."
   - Recommendation: the cheaper, more honest answer is very likely a **`NULL` column with a test proving it's correctly written when set (via direct DB manipulation or a placeholder sync function), not a phase-4 feature that calls the live vendor for a job that isn't wired up until Phase 6.** Leave the actual population of this column to whichever phase first has something real to report. Flag for the planner/discuss-phase rather than deciding unilaterally here, since it changes phase scope.

2. **Does the OAuth `state` nonce need its own, shorter default TTL constant separate from `_SETUP_TOKEN_TTL`/`_RESET_TOKEN_TTL`?**
   - What we know: `routes_identity.py` already has a "not specified by any measured constant — a judgment call" comment for its own two TTLs (7 days, 1 hour). The state nonce's natural TTL is much shorter than either.
   - What's unclear: the exact number (Assumptions Log A1).
   - Recommendation: pick something in the 10–20 minute range and name the constant `_OAUTH_STATE_TTL`, matching the existing `_SETUP_TOKEN_TTL`/`_RESET_TOKEN_TTL` naming convention in the same file.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Postgres 18 | RLS policy, advisory lock, migration testing | ✓ | 18 (Homebrew) [VERIFIED: `hashtext`/`pg_advisory_xact_lock` queries run live this session] | — |
| `schwab-py` | The adapter | ✗ (not yet a project dependency — confirmed via `uv pip show schwab-py` this session) | to be added, 1.5.1 | `uv add schwab-py==1.5.1` — see Package Legitimacy Audit for the required human checkpoint first |
| Live Schwab sandbox/API | — | Deliberately not used (D4-14) | — | Protocol fake (D4-05) |
| `basedpyright`/`mypy` at project-pinned versions | Verifying the suppression marker | ✓ | 1.39.10 / 2.3.1 [VERIFIED: installed and run live this session in a scratch venv matching the project's exact pins] | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `schwab-py` itself — not yet installed; installing it is this phase's own first task, gated by the `checkpoint:human-verify` the Package Legitimacy Audit requires.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0 [VERIFIED: `pyproject.toml`] |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` — `asyncio_mode = "auto"`, session-scoped event loop, `markers = ["db: ..."]` |
| Quick run command | `uv run pytest tests/schwab -q` |
| Full suite command | `export DATABASE_URL=postgresql://morai:morai@localhost:5432/morai MORAI_APP_DB_PASSWORD=localdevpassword MORAI_ENV_FILE=""; uv run pytest -q` (~12s per CLAUDE.md, ~245 tests before this phase adds more) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONN-01 | Two concurrent OAuth callbacks land on two distinct connection rows | integration (`@pytest.mark.db`, two-engine concurrency, mirroring `test_concurrent_consume_produces_exactly_one_winner`) | `uv run pytest tests/schwab/test_oauth_flow.py -x` | ❌ Wave 0 |
| CONN-02 | Replayed `state` is rejected via the atomic consume | integration | `uv run pytest tests/schwab/test_oauth_flow.py::test_replayed_state_is_rejected -x` | ❌ Wave 0 |
| CONN-03 | No log/response/body contains the code or redirect URL | integration, `caplog`-based, mirroring `test_no_log_record_from_login_contains_password_token_or_hash` | `uv run pytest tests/schwab/test_oauth_flow.py::test_no_log_contains_code_or_url -x` | ❌ Wave 0 |
| CONN-04 | Health derives correctly across all three bands | unit, pure function, no DB | `uv run pytest tests/schwab/test_health.py -x` | ❌ Wave 0 |
| CONN-05 | Re-auth repairs the row; count stays 1 | integration | `uv run pytest tests/schwab/test_reauth.py -x` | ❌ Wave 0 |
| CONN-06 | User A's refresh never blocks User B's | integration, timing-based positive control | `uv run pytest tests/schwab/test_refresh_lock.py -x` | ❌ Wave 0 |
| CONN-07 | `last_synced_at` written only on real success | unit + integration | `uv run pytest tests/schwab/test_health.py -x` (or a dedicated file — planner's call, see Open Question 1) | ❌ Wave 0 |
| D4-04 (suppression marker) | `reportAny` fires without the suppression, is silenced with it | type-gate meta-test, mirrors `tests/gate/test_type_gate.py`'s existing pattern | `uv run pytest tests/gate/test_type_gate.py -x` (after adding the new fixture+case) | ❌ Wave 0 (new fixture) |
| D4-02 (vendor-boundary isolation) | Only the one adapter module imports `schwab` | gate meta-test, mirrors `tests/gate/test_suppressions.py`'s `git ls-files` scan | `uv run pytest tests/gate/test_vendor_boundary.py -x` | ❌ Wave 0 (new file) |

### Sampling Rate

- **Per task commit:** `uv run pytest tests/schwab -q`
- **Per wave merge:** full suite + `bash tools/gate.sh`
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/schwab/conftest.py` — `FakeSchwabClient` implementing the Protocol (success, `invalid_grant`-shaped failure, expired-refresh-shaped failure, rate-limit-shaped failure — D4-05, item 9 of the research brief)
- [ ] `tests/schwab/test_oauth_flow.py`, `test_reauth.py`, `test_refresh_lock.py`, `test_health.py`
- [ ] `tests/gate/fixtures/violation_schwab_json_boundary.py` + a new `CASES` entry in `tests/gate/test_type_gate.py` asserting `reportAny`
- [ ] `tests/gate/test_vendor_boundary.py` — new gate meta-test for "only one module imports `schwab`"
- [ ] `typings/schwab/__init__.pyi`, `auth.pyi`, `client.pyi` — not a test, but a Wave-0 prerequisite every other test in this phase depends on to typecheck at all

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Session cookie auth already shipped (Phase 2); this phase adds a second, vendor-facing OAuth flow layered on top, not a new user-auth mechanism |
| V3 Session Management | yes (indirectly) | The OAuth `state` nonce is a session-scoped CSRF control, reusing the already-audited `setup_tokens` mechanism |
| V4 Access Control | yes | RLS `user_isolation` policy on `schwab_connections`, no admin clause (D4-19) — same posture as every other user-data table since Phase 3 |
| V5 Input Validation | yes | Every vendor response validated via Pydantic `model_validate()`/`TypeAdapter` at the one adapter boundary (D4-03) |
| V6 Cryptography | yes | AES-256-GCM via the existing `crypto/envelope.py` primitives and the user's existing DEK (D4-11) — never a new key domain, never hand-rolled |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSRF via a forged/replayed OAuth `state` | Spoofing | Single-use, TTL'd, atomic `DELETE ... RETURNING` (D4-07, `NN-35`) |
| Token/code leakage via logs or error bodies | Information Disclosure | No app-code path ever logs `received_url`/the raw code (D4-08); vendor libraries verified this session to log nothing on this path (Common Pitfalls 3); ASGI access logging kept off (Common Pitfalls 1) |
| Cross-user data exposure via a shared/missing RLS policy | Information Disclosure, Elevation of Privilege | `ENABLE`+`FORCE` RLS, `user_isolation` policy, no admin clause (D4-19), matching migrations 0007/0008 exactly |
| Refresh-race corrupting a shared token | Tampering | `pg_advisory_xact_lock(hashtext(user_id))`, per-user, xact-scoped (D4-10, CONN-06) |
| A stolen DB dump yielding a usable Schwab token | Information Disclosure | Token ciphertext under the user's own DEK, wrapped by the master KEK held outside the DB (D4-11, inherits Phase 3's threat model) |

## Sources

### Primary (HIGH confidence)

- `schwab-py` 1.5.1 wheel, downloaded live this session via `pip download schwab-py==1.5.1 --no-deps` and fully unpacked — `schwab/auth.py`, `schwab/client/base.py`, `schwab/client/asynchronous.py`, `schwab/debug.py`, and `tests/auth_test.py` all read directly, in full or by targeted grep, not summarized from any secondary source.
- `authlib` 1.8.0, downloaded live this session, `authlib/integrations/httpx_client/oauth2_client.py` read/grepped directly for logging calls (none found).
- `hypercorn` 0.18.0 (this project's own exact pinned version, installed via `uv run`), `hypercorn.config.Config` inspected live for `accesslog`/`access_log_format` defaults.
- Local Postgres 18 (`postgresql://morai:morai@localhost:5432/morai`), queried live via `asyncpg` this session for `hashtext()`'s return type and `pg_advisory_xact_lock`'s accepted argument shapes, both with and without a bound parameter.
- `basedpyright` 1.39.10 and `mypy` 2.3.1 (this project's exact pinned versions), installed into a scratch venv and run live this session against fixtures matching this project's exact `pyproject.toml` strictness configuration (`typeCheckingMode = "strict"`, `reportAny = "error"`, `reportExplicitAny = "error"`, `reportIgnoreCommentWithoutRule = "error"`, `[tool.mypy] strict = true`).
- This project's own source, read directly this session: `src/morai/identity/setup_tokens.py`, `crypto/envelope.py`, `identity/rls.py`, `identity/audit.py`, `identity/sessions.py`, `identity/account.py`, `identity/tokens.py`, `ledger/fills.py`, `db/models.py`, `db/session.py`, `settings.py`, `api/routes_identity.py`, `api/models.py`; `alembic/versions/0003`, `0007`, `0008`; `tools/create_admin.py`; `tests/identity/conftest.py`, `test_login_logout.py`, `test_setup_tokens.py`; `tests/gate/test_type_gate.py`, `test_suppressions.py`.
- PyPI JSON/index API, queried live this session (`pip index versions schwab-py`) for current version.
- `gsd-tools query package-legitimacy check --ecosystem pypi schwab-py`, run this session.

### Secondary (MEDIUM confidence)

- `docs/learnings/vendors-and-infra.md` V001–V015, V069, V078 — this project's own prior record, read this session, cited by number throughout.
- `docs/learnings/LAWS.md` L051 — read this session.
- CLAUDE.md's own "Technology Stack" section — cross-checked against this session's direct source reading; one correction identified (see Summary point 1 re: `reportAny` vs the actual `reportMissingTypeStubs`/`reportUnknown*` family that fires on genuinely untyped-vendor-derived local variables, as distinct from httpx's own legitimate `Any`).

### Tertiary (LOW confidence)

- None used for load-bearing claims. Every number in this document is either sourced from a live tool run this session, from this project's own prior record (cited), or explicitly logged in the Assumptions Log as unverified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — version and package identity confirmed live against PyPI and the real wheel.
- Vendor typing boundary (D4-01–D4-04 mechanics): HIGH — a real basedpyright/mypy run against this project's exact pinned versions and exact strictness config, not a guess.
- Async token-write hazard (Pitfall 4): HIGH — confirmed by direct source read plus the vendor's own test suite's behavior.
- Log-leak surface (Pitfalls 1–3): HIGH for what was checked (grepped exhaustively); MEDIUM for "nothing else could ever leak it" (an absence-of-evidence claim, scoped honestly in Pitfall 2).
- Operational thresholds (OAuth state TTL, `expiring_soon` band): LOW/MEDIUM — no record specifies these; see Assumptions Log A1/A2.
- RLS/DDL/lock mechanics: HIGH — modeled directly on two already-shipped, already-tested migrations, and the lock primitive independently verified live against local Postgres.

**Research date:** 2026-08-31
**Valid until:** 30 days for the Postgres/RLS/lock mechanics (stable); 7–14 days for the `schwab-py`/`authlib` version pins specifically, since `authlib`'s unpinned resolution is actively moving (Pitfall 6) and re-running `pip index versions schwab-py` costs nothing before planning starts.
