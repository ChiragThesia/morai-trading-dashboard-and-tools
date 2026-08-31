# Phase 4: Schwab Connection and Token Lifecycle - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — four grey areas proposed in batch, all accepted as recommended

<domain>
## Phase Boundary

Each user connects their own Schwab account and repairs it themselves when the 7-day refresh
token dies, without operator help.

**Requirements:** CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-06, CONN-07

In scope: the per-user OAuth handshake, the CSRF `state` nonce, encrypted token storage, the
per-user refresh lock, connection health, self-service re-authorisation, and the
last-successful-sync timestamp.

Out of scope: actually ingesting fills (Phase 6), notification *delivery* (no email vendor
exists and none is added here — see D4-12), and any live call to Schwab's real endpoint
(D4-13).

</domain>

<decisions>
## Implementation Decisions

### The vendor boundary — the phase's open question, now settled

- **D4-01: `schwab-py` 1.5.1 ships NO `py.typed` marker, and no stub package exists.**
  Measured this session, not recalled: the published wheel was downloaded and its contents
  listed (`schwab/__init__.py`, `auth.py`, `debug.py`, `secrets.py`, `streaming.py`,
  `utils.py`, `version.py` — no `py.typed`), and both `types-schwab-py` and `schwab-py-stubs`
  return HTTP 404 on PyPI. This closes the roadmap's "`schwab-py` type coverage (UNVERIFIED)"
  open question with a fact.

  Under PEP 561 an absent `py.typed` makes the whole package untyped to mypy and basedpyright:
  every symbol resolves to `Any`. With `reportAny` enabled (Phase 1's `D-05`), *every* call
  into the vendor would be flagged. This is the central design constraint of the phase, not an
  edge case.

- **D4-02:** The project owns a **`Protocol`** naming exactly the methods it uses —
  `get_transactions`, `get_account_numbers`, `get_option_chain`, `get_quotes`. **Exactly one
  adapter module imports `schwab`.** Nothing else in the codebase may import it.

- **D4-03:** Every vendor response is parsed with **`model_validate()` at the call site**,
  immediately. `response.json()` is the untrusted-input boundary for this entire project, and
  it is a hard boundary, not a style preference. Never a `TypedDict` cast — that asserts a
  shape to the checker without checking it at runtime.

- **D4-04:** The suppression budget is **one narrowly-scoped `# why:` suppression inside the
  adapter module**, and none anywhere else. A blanket per-module ignore would make the type
  gate stop meaning anything (`D-06`, `tests/gate/test_suppressions.py`).

- **D4-05:** Vendor behaviour is tested with a **fake implementing the `Protocol`**, with
  **zero network calls in tests**. Not HTTP-level mocking (`respx`/`responses`) — that mocks
  the wire while the contract is what drifts.

### OAuth and the CSRF nonce

- **D4-06:** `schwab.auth.get_auth_context()` builds the per-user authorize URL; the FastAPI
  callback route hands the full received URL to `schwab.auth.client_from_received_url()` with a
  `token_write_func` closure bound to that user's row. **Never `easy_client()` or
  `client_from_login_flow()`** — both spin up a local Flask server and/or open a browser on the
  machine running the process, which cannot work for remote users.

- **D4-07:** The `state` nonce (`CONN-02`, `NN-35`) **reuses Phase 2's proven
  `setup_tokens` shape**: single-use, TTL'd, server-side, consumed by one atomic
  `DELETE ... RETURNING`, only the SHA-256 hash stored. That mechanism already ships a real
  two-engine concurrency test proving exactly one winner. A second bespoke implementation of a
  solved problem is the shape that cost v1 its worst bug.

- **D4-08:** `CONN-03`/`NN-34` is proven by a test that **captures all log output** and asserts
  the authorization code and the redirect URL appear nowhere — mirroring
  `test_no_log_record_from_login_contains_password_token_or_hash` from Phase 2. Not code review.

- **D4-09:** Re-authorisation (`CONN-05`) **repairs the existing connection row**. The test
  asserts the per-user connection row count stays exactly 1. Insert-new-and-retire-old leaves
  two rows and makes "which one is live?" a question the schema should never have to answer.

### The 7-day token lifecycle

- **D4-10:** The refresh lock (`CONN-06`) is **`pg_advisory_xact_lock(hashtext(user_id))`** —
  transaction-scoped, released on commit or crash, and the same primitive `tools/create_admin.py`
  already uses. Not `SELECT ... FOR UPDATE` on the token row: that works here (the row exists,
  unlike `create_admin`'s case) but holds a row lock across the refresh's network call.
  Five users need five independent locks, never one queue.

- **D4-11:** Tokens are encrypted under the user's **existing Phase 3 DEK**, through the same
  envelope and the same write path. Not a separate secrets table with its own key — a second
  key domain means a second set of nonce-uniqueness invariants to maintain, and Phase 3's code
  review already caught one of those going unchecked.

- **D4-12:** Connection health (`CONN-04`) is **derived from `expires_at` at read time** —
  `healthy` / `expiring_soon` / `expired`. Never a stored status column: that is a second
  writer for something derivable, which `NN-16`'s sibling rule forbids.

- **D4-13:** Re-auth notification: this phase **records that a notification is due**. Delivery
  belongs to a later phase. `D2-01` deliberately removed every email vendor from the system and
  none is added back here.

### Scope and honesty

- **D4-14: No live Schwab calls in this phase.** `.env` holds developer credentials that
  survived the v1 teardown, but the sandbox is flaky, rate-limited, and needs a human at a
  browser. The flow is proven against the `Protocol` fake.

- **D4-15:** The 7-day expiry **cannot be observed inside a test run**. Prove the *logic* with
  an injected clock, and record honestly — in the SUMMARY and in the code — that it has never
  been observed against a real 7-day window. Do not claim it verified because the arithmetic
  is right.

- **D4-16:** The last-successful-sync timestamp (`CONN-07`) is written **only on a genuinely
  successful sync**. Touching it on attempt would make a silent gap invisible, which is exactly
  what `NN-16` exists to prevent.

- **D4-17:** Schwab's account hash is resolved **once at connect time and stored encrypted**,
  not re-resolved per request.

### Carried forward — do not regress

- **D4-18:** `Decimal` end to end, never `float`. No `Any`, no `cast`, no bare
  `# type: ignore`; a suppression needs a scoped rule name and a same-line `# why:`.
- **D4-19:** New tables get RLS `ENABLE` + `FORCE`, a user-scoped policy with **no admin
  clause**, and grants narrowed to the verbs actually needed (`D3-18`, and Phase 2's `WR-05`).
- **D4-20:** Write paths do not commit internally — the caller owns the transaction. A
  `set_config(..., is_local=true)` GUC resets to the **empty string** at transaction end, not
  NULL, which breaks the caller's next RLS query. Confirmed live against Postgres in Phase 3.
- **D4-21:** Migrations are append-only. 0001-0009 are applied; this phase adds 0010+.

</decisions>

<code_context>
## Existing Code Insights

- `src/morai/crypto/envelope.py` — five pure-`bytes` AES-256-GCM primitives; `wrap_dek`/
  `unwrap_dek` for the KEK domain, and the per-DEK encrypt/decrypt pair. Token encryption
  (D4-11) goes through these.
- `src/morai/identity/setup_tokens.py` — the atomic `delete().returning()` single-use token
  mechanism with hash-only storage and a real concurrency test. **D4-07 reuses this shape.**
- `src/morai/identity/rls.py` — `require_rls_context`, which turns RLS's silent under-fetch
  into a named error.
- `src/morai/identity/audit.py` — `open_audited_read` with `ReaderId`/`SubjectId` `NewType`s.
- `src/morai/ledger/fills.py`, `events.py` — the single-write-path pattern with the
  `_write_token` gate, and the caller-owns-the-transaction convention.
- `tools/create_admin.py` — `pg_advisory_xact_lock` precedent for D4-10.
- `tests/identity/test_login_logout.py::test_no_log_record_from_login_contains_password_token_or_hash`
  — the log-capture shape D4-08 mirrors.
- `alembic/versions/0007`, `0008` — the RLS `ENABLE`+`FORCE` + narrowed-grant migration shape.
- `tests/gate/` — fixtures that must fail type-check, with the specific diagnostic marker
  asserted (`reportCallIssue`/`call-arg` confirmed against a live checker run in Phase 3).

</code_context>

<specifics>
## Specific Ideas

- The `Protocol` should name **only** the four methods actually called. A wider Protocol is a
  larger lie about what the project depends on.
- Criterion 1 requires **two users running OAuth callbacks concurrently**, each landing on
  their own connection record — a real concurrency test, like Phase 2's setup-token test, not
  a sequential simulation.
- Criterion 4 requires proving a refresh for user A **never blocks** a refresh for user B.
  That is a positive control on the lock's scoping: without it, one global lock would pass a
  naive "concurrent refreshes don't corrupt" test.
- The adapter module is the right place for a short docstring stating plainly that `schwab-py`
  is untyped, why the `Protocol` exists, and what the single suppression is for. A future
  reader should not have to rediscover D4-01.

</specifics>

<deferred>
## Deferred Ideas

- **Notification delivery** — recorded as due here, delivered in a later phase (D4-13).
- **Live Schwab integration testing** — deferred with the 7-day-window observation (D4-14,
  D4-15). Belongs with the Railway operator steps Phases 2 and 3 already owe.
- **`get_option_chain` / `get_quotes` usage** — named in the `Protocol` because Phase 8's
  snapshot capture needs them, but this phase only exercises the auth and transaction paths.

</deferred>
