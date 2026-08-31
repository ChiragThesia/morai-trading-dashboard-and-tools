# Phase 2: Identity, Sessions, and Tenant Isolation - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning
**Mode:** Auto-decided (unattended run; the user is asleep and asked for phases 2-5 without check-ins)

<domain>
## Phase Boundary

Accounts exist, sessions are invalidated server-side, and no request can reach another
user's data.

In this phase: the account record, admin-issued one-time setup links, password auth,
server-side sessions, tenant isolation, and the audit log on privileged reads.

Not in this phase: envelope encryption (Phase 3), the Schwab connection (Phase 4), any
trade table beyond what isolation needs to be provable against. `gate_money_probe` from
Phase 1 stays until Phase 3 replaces it.

</domain>

<decisions>
## Implementation Decisions

Every grey area below was decided by the orchestrator rather than asked, because this run
is deliberately unattended. Each carries its reason so a later reader can overturn it on
evidence rather than taste. Where a decision depends on the spike, it says so and defers
to `02-RESEARCH.md` instead of guessing.

### Identity and setup

- **D2-01:** No email service anywhere in this phase, for any flow — account creation,
  setup, or password reset. Criterion 1 states it outright. The admin issues a link out of
  band (they know these four or five people personally). This removes an entire vendor,
  its deliverability failure modes, and a class of account-takeover surface, at the cost of
  the admin doing something manual for a handful of users. That trade is obviously right at
  this size and would be obviously wrong at a thousand users. — **Reversibility:** easy.

- **D2-02:** A setup link is a single-use, TTL'd, server-side nonce consumed by one atomic
  `DELETE ... RETURNING`, never a string comparison and never a flag flipped after a read.
  This is `NN-35`, carried forward verbatim. The atomicity is the point: check-then-update
  races, and a setup link that can be used twice is an account-takeover primitive.
  Criterion 1 requires the second use to be rejected, so this is tested directly, including
  concurrently. — **Reversibility:** easy.

- **D2-03:** Password hashing is Argon2id via `argon2-cffi`, at OWASP's higher-security
  band rather than its published minimum, because these accounts are linked to brokerage
  credentials. Parameters are tuned so one hash costs roughly 250-400 ms **on the Railway
  container**, measured there, not on a laptop — a laptop-tuned cost is meaningless and a
  memory cost that a small container cannot afford will fail at boot rather than degrade.
  `02-RESEARCH.md` owes the measurement and the fallback if 128 MiB is infeasible.

### Sessions

- **D2-04:** Sessions are a Postgres table plus an opaque `secrets.token_urlsafe(32)`
  token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. No signing library, no JWT.
  A server-side row means logout deletes it and the session is dead everywhere,
  immediately, which a signed-but-unrevokable cookie cannot do without a denylist — and a
  denylist is this table with extra steps. Criterion 2 requires exactly that revocation.

- **D2-05:** A replayed cookie after logout is rejected because the row is gone, not
  because a flag says expired. The test asserts the row's absence and the rejection
  together, so an implementation that only clears the client cookie fails.

- **D2-06:** Sessions survive a browser restart, so the cookie is persistent with an
  explicit expiry rather than a session cookie. Sliding renewal is deferred — it is a
  comfort feature, and every renewal path is another place a revoked session can be
  resurrected. — **Reversibility:** easy.

- **D2-07:** The future UI is a separate application, so cookie attributes are decided now
  with that in mind rather than retrofitted. `SameSite=Lax` holds only if the UI is
  same-site; if it is not, this becomes `SameSite=None; Secure` plus a CSRF defence, and
  that is a real fork. `02-RESEARCH.md` should state which world we are in and what changes
  if it is the other one.

### Isolation — the phase's hardest requirement

- **D2-08:** A request authenticated as user A that asks for user B's data returns
  **not-found, not forbidden**, including when A is the admin. Criterion 3 says not-found
  and the distinction is load-bearing: a 403 confirms the row exists, which is itself a
  disclosure. Admin is not exempt — an admin can create and reset accounts, and cannot read
  trading data. That is the whole point of the encryption boundary Phase 3 builds; an admin
  read path here would make it decorative.

- **D2-09:** The isolation mechanism — Postgres RLS with `SET LOCAL` versus an
  application-level scoping layer — is **deferred to `02-RESEARCH.md`, which owes a single
  recommendation, not a menu.** It depends on this phase's spike (Railway's connection
  topology), because `SET LOCAL` is transaction-scoped and a pooled connection reused
  across requests breaks it. `NN-28`/`NN-29` were written against Supabase's Supavisor and
  carry forward only if a pooler is actually in the path. Deciding this before the spike is
  exactly the mistake the roadmap put the spike here to prevent. — **Reversibility:**
  one-way in practice; it shapes every query in every later phase.

- **D2-10:** Whichever mechanism wins, the isolation suite must prove it against the
  **real Railway configuration**, not only a direct-connection test container. Criterion 3
  says so explicitly, and it is the difference between testing the design and testing the
  deployment.

### The audit log

- **D2-11:** Every privileged read of user data writes an audit row naming reader, subject
  and time. Criterion 4 additionally wants a bypassing read to "not compile or not pass
  review". Take the strongest rung that is actually achievable in Python and be honest
  about which one it is: a repository type whose only read methods are audited, so an
  unaudited read has no function to call, beats a lint rule, which beats a test, which
  beats a review convention. `02-RESEARCH.md` owes a straight answer on what
  basedpyright/mypy can enforce structurally versus what falls back to a test.

- **D2-12:** The audit row is written in the same transaction as the read it records. A
  read that succeeds while its audit row is lost is worse than no audit log, because it
  looks like coverage.

### Carried forward from Phase 1 — do not regress

- **D2-13:** `settings.load_settings` converts pydantic's `ValidationError` into a
  `RuntimeError` naming fields only, never values, with the `raise` deliberately outside
  the `except` block. `api/errors._ErrorLocation` declares only `loc` and `type` with
  `extra="ignore"`, so the offending value is dropped at the parse boundary.
  `telemetry.capture_exception` sends type, frames and request id — never `str(exc)`.
  All three are `NN-34`, all three have guarding tests, and Phase 2 introduces passwords
  and session tokens, which makes them more load-bearing, not less.

- **D2-14:** `NN-34` outranks a phase decision. Phase 1 hit a conflict where D-10 said full
  detail goes to the server log and cited `NN-34` as justification, while `NN-34` says
  "never logged". Project law won. The same resolution applies to anything in this phase
  that wants to log a token, a password hash, or a session id.

</decisions>

<code_context>
## Existing Code Insights

Phase 1 is complete, deployed, and green. `src/morai/` holds:

- `settings.py` — `get_settings()`, an `lru_cache`d accessor. **No module-level singleton**;
  one was removed because it failed at import rather than at boot. `env_file` comes from
  `MORAI_ENV_FILE`, defaulting to `.env`; tests set it empty.
- `db/base.py` — the declarative `Base`. `db/models.py`, `db/session.py`.
- `api/app.py` — the FastAPI app, `/health` (liveness only, no DB call) and the Phase 1
  money-roundtrip gate route. `api/errors.py` — request-id middleware and the opaque error
  envelope. `api/models.py` — `Annotated[Decimal, BeforeValidator(...)]` money fields that
  accept `str`/`Decimal` and reject `float`/`int`.
- `money/units.py` — `Usd`/`IndexPoints` `NewType`s and `points_to_usd`, whose multiplier
  argument is required with no default.
- `worker/app.py` — Procrastinate on its own psycopg pool. Procrastinate ships no asyncpg
  connector, so the worker's pool is separate from the web app's by necessity.
- `telemetry.py` — PostHog, optional, a no-op with no API key.

Tests: 60 passing. `tests/conftest.py` isolates every test from the ambient `.env` and
runs DB-marked tests only where a database is reachable, failing loudly rather than
skipping. `tests/gate/` holds the violation fixtures that prove the type gate bites.

Alembic owns all migrations, including Procrastinate's schema, wrapped into revision 0002.
There is exactly one migration authority.

</code_context>

<specifics>
## Specific Ideas

- The isolation suite is this phase's equivalent of Phase 1's 13-fixture oracle: the test
  that has to be right before anything downstream can be trusted. Treat it that way.
- Criterion 3's "including when A is the admin" deserves its own named test, not a
  parameter on an existing one. It is the case a reasonable developer would assume is an
  exception.
- Phase 3 needs the account record this phase creates, and its envelope encryption wraps a
  per-user data key. Whatever identifies a user here is what that key is keyed by, so the
  identifier's shape and stability matter beyond this phase.

</specifics>

<deferred>
## Deferred Ideas

- Sliding session renewal (D2-06).
- Any email-backed flow (D2-01) — deliberately, permanently for this milestone.
- Rate limiting on the login path. Real, and not what this phase is for; it belongs with
  the public API surface rather than with identity.

</deferred>
