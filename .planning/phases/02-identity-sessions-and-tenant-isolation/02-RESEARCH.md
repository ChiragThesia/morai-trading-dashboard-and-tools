# Phase 2: Identity, Sessions, and Tenant Isolation - Research

**Researched:** 2026-08-31
**Domain:** Postgres-backed multi-user identity (accounts, one-time links, sessions) and structural
tenant isolation (RLS vs. app-level scoping) on Railway, plus Argon2id parameter tuning and a
structurally-audited privileged-read path.
**Confidence:** HIGH on the spike (settled by a live read of the actual provisioned service, not
inference) and on every library-API claim (read from installed source this session). MEDIUM on the
isolation-mechanism recommendation's *edge-case completeness* (RLS itself is HIGH-confidence
standard practice; the exact SET LOCAL wiring pattern for a per-request FastAPI dependency is this
researcher's own synthesis from verified primitives, not a single authoritative worked example).
LOW-MEDIUM on the audit-log "does not compile" claim, and said so plainly rather than overclaiming.

## Summary

The phase's owned spike resolves cleanly and definitively: **Railway's Postgres, as actually
provisioned for this project, has no connection pooler in front of it at all.** Not session-mode,
not transaction-mode — direct TCP to `postgres.railway.internal:5432`, confirmed both from Railway's
own documentation (pooling is opt-in, added later as a separate "Connection Pooling" feature) and
from a live read of the deployed Postgres service's own environment variables, which carry a single
`DATABASE_URL` pointed straight at the database host with no `DATABASE_UNPOOLED_URL` or second
pooler endpoint present. `V027`/`V028` (Supavisor transaction-pooler traps) do not apply to this
project today. This means the only connection-multiplexing layer between the FastAPI app and Postgres
is SQLAlchemy's own `AsyncEngine` pool, whose default reset-on-return behavior (`rollback`) is a
second, independent guarantee — on top of Postgres's own transaction semantics — that a `SET LOCAL`
value can never leak from one request's connection checkout into another's.

That resolves D2-09's deferred question. **Recommendation: Postgres Row-Level Security, not an
application-level scoping layer**, as the primary, structural enforcement for AUTH-07. RLS is DB-level
and blind to *how* a query was written — an ORM call, a raw SQL debug script, or a future admin tool
all get filtered identically — which an app-level "remember to add `.where(user_id == ...)`" layer
cannot promise. The one finding that makes-or-breaks this recommendation, verified against official
Postgres documentation this session: **superusers and `BYPASSRLS` roles always bypass row security,
full stop, and `FORCE ROW LEVEL SECURITY` does not change that** — it only binds the table *owner*.
Railway's Postgres template creates exactly one role, `postgres`, via the official Postgres image's
standard `initdb` bootstrap process, which is definitionally a superuser — **inferred from two
independently-verified facts, not from a direct query against the live role** (no live connection was
made this session; see the full caveat and the one-line check the plan should run below). **The app's
runtime `DATABASE_URL` must not be `postgres` once RLS is the enforcement mechanism, or every policy
is silently inert** — this is the single most important finding in this document, and it is the kind
of mistake that would pass every application-level test while providing zero real isolation. A new,
least-privilege Postgres role is a required Phase 2 deliverable, not an optional hardening step.

The remaining three success criteria resolve to patterns this codebase has already established and
this research verifies against primary sources: `NN-35`'s atomic `DELETE ... RETURNING` consumption
(exact SQLAlchemy 2.0 async form given below) for both the one-time setup link and the admin password
reset, since CONTEXT.md's D2-01/D2-02 collapse both into the same single-use-token mechanism; a
Postgres `sessions` table with an opaque `secrets.token_urlsafe(32)` token, storing only its
SHA-256 hash (never the raw token) so a stolen row cannot be replayed; and, for AUTH-08, the honest
answer that basedpyright/mypy cannot verify "an audit row was written" — no type checker reasons about
side effects — but a **capability-object pattern** (a type that can only be constructed by the
audit-writing factory function) gets close: a caller who omits the factory gets a real, today,
`tests/gate/`-provable type error identical in shape to this repo's own `violation_unit_confusion.py`,
and only a deliberately-forged capability object escapes to a runtime guard instead. That is the
honest ceiling, stated as such.

Argon2id tuning was measured locally (Apple M1 Pro, 10-core) as a methodology reference, not a
substitute for the Railway measurement CONTEXT.md explicitly requires: 128 MiB / t=3 / p=1 measured
276ms here, inside OWASP's 250-400ms target band, but a Railway container's shared vCPU is very
likely slower per-core than this machine, so this number is a floor, not the deployed answer. Memory
is not the real risk (128 MiB is trivial against any Railway plan's minimum); wall-clock latency on
constrained CPU is, and the honest fallback is documented below.

**Primary recommendation:** create a least-privilege `morai_app` Postgres role (`NOSUPERUSER
NOBYPASSRLS`) for the FastAPI web service's runtime connection, separate from the `postgres` role
Alembic keeps for DDL; enable and `FORCE` RLS on every user-scoped table, policy driven by
`current_setting('app.current_user_id', true)`; set that value via `SET LOCAL` issued by the auth
dependency on the same per-request `AsyncSession`, immediately after validating the session cookie
and before any other query runs; and build the isolation suite against a permanent `gate_`-prefixed
probe table in this phase, exactly mirroring Phase 1's `gate_money_probe` precedent, since Phase 2
has no real trading table to prove isolation against yet.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Account creation, setup links, password reset (AUTH-01, 02, 05) | API/Backend | Database/Storage | FastAPI routes write/consume rows; the atomicity guarantee is a DB-level `DELETE ... RETURNING`, not app logic |
| Password hashing (D2-03) | API/Backend | — | `argon2-cffi` runs in-process; no DB or network round trip |
| Session issuance and validation (AUTH-03, 04) | API/Backend | Database/Storage | Opaque token in a cookie; the row that makes it revocable lives in Postgres |
| Tenant isolation (AUTH-07) | Database/Storage | API/Backend | RLS is enforced by Postgres itself, at the query-planner level — the API layer's only job is to set the per-request context correctly |
| Audit logging (AUTH-08) | API/Backend | Database/Storage | The write itself is a normal INSERT; the *structural* guarantee (no read without audit) is a Python type-system pattern, not a DB feature |
| Connection topology (the spike) | Database/Storage | — | Settled entirely at the infrastructure layer; no app code changes based on the answer, since the answer is "no pooler" |

There is still no Browser/Client, Frontend-Server, or CDN/Static tier — this milestone ships no UI.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Admin can create a user account and issue a single-use setup link | NN-35 atomic-consume pattern, exact SQLAlchemy 2.0 async form given in Code Examples; `setup_tokens` table shape below |
| AUTH-02 | User can set their password from that link, consumed on first use, never works twice | Same table/mechanism as AUTH-01, `purpose` discriminator column; DELETE...RETURNING is what makes "never twice" atomic rather than racy |
| AUTH-03 | User can log in with username and password and stay logged in across sessions | Argon2id verify (exact API below) + `sessions` table + persistent cookie (D2-06: no sliding renewal) |
| AUTH-04 | User can log out, invalidating the session server-side rather than only client-side | `DELETE FROM sessions WHERE token_hash = ...`; D2-05's test shape (row absence, not a flag) |
| AUTH-05 | Admin can reset a user's password without any email service in the loop | Same `setup_tokens` mechanism, `purpose='password_reset'`, admin-issued out of band per D2-01 |
| AUTH-07 | No endpoint returns one user's trading data to another user, including to the admin | The spike (no pooler) + the RLS recommendation + the superuser/BYPASSRLS finding, all below |
| AUTH-08 | Every privileged read of user data writes an audit entry naming reader, subject, and time | Capability-object pattern below; honest ceiling stated for what basedpyright/mypy can and cannot enforce |

AUTH-06 (account deletion, data-key destruction) is Phase 3's, per `REQUIREMENTS.md`'s own
traceability table — not addressed here.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `.claude/CLAUDE.md`. Directives with direct bearing on this phase:

- **Language**: Python, Pydantic v2, `mypy --strict` intent — but see the pyproject.toml note below:
  `disallow_any_explicit` was measured and dropped from the actual mypy config in Phase 1 because it
  false-positives on every `BaseModel`/`BaseSettings` subclass. basedpyright's `reportAny` /
  `reportExplicitAny` carry that job instead. Every Pydantic model this phase adds inherits that
  reality — do not re-add the mypy flag expecting it to work cleanly against Pydantic models.
- **Process**: test-driven, red before green.
- **Security**: envelope encryption is Phase 3's, but "no cross-user view" and "audit log on
  privileged reads" are this phase's, verbatim from `.claude/CLAUDE.md`'s own Security bullets.
- **Security**: an OAuth code/redirect URL is bearer-equivalent (`NN-34`) — Phase 4's literal
  concern, but its *principle* (a bearer-equivalent secret is never rendered, logged, or echoed)
  applies directly to this phase's session tokens, setup-link tokens, and password hashes. D2-13/
  D2-14 in CONTEXT.md make this explicit and non-negotiable.
- **Auth stack** (already decided in `.claude/CLAUDE.md` §7, carried forward by CONTEXT.md D2-03/
  D2-04): `argon2-cffi` 25.1.0 for password hashing; a Postgres `sessions` table with an opaque
  `secrets.token_urlsafe(32)` token in an `httpOnly`+`Secure`+`SameSite=Lax` cookie; OAuth
  `state`/nonce storage is Phase 4's, not this phase's, but its atomic-consume *pattern* (`NN-35`)
  is exactly what this phase's setup links reuse.
- **Hosting**: Railway containers plus Postgres — this phase's spike is specifically about this line.
- **Correctness**: `NN-1` (every discriminating column in a composite key) has a direct echo here —
  a session's lookup key must be the token hash alone (already unguessable, 256 bits of entropy), not
  a `(user_id, token)` pair that invites a weaker per-user token.

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md exists at `.planning/phases/02-identity-sessions-and-tenant-isolation/02-CONTEXT.md`,
produced 2026-08-31 in an unattended run ("the user is asleep and asked for phases 2-5 without
check-ins"). Every gray area was decided by the orchestrator, not left open — there is no "Claude's
Discretion" section in this CONTEXT.md, and the note below reflects that structure rather than the
standard template's three-section shape.

### Locked Decisions

**Identity and setup**
- **D2-01:** No email service anywhere in this phase, for any flow. The admin issues a link out of
  band. Deliberate, permanent for this milestone's user count.
- **D2-02:** A setup link is a single-use, TTL'd, server-side nonce consumed by one atomic
  `DELETE ... RETURNING` (`NN-35`, carried forward verbatim) — never a string comparison, never a
  flag flipped after a read. Tested directly, including concurrently.
- **D2-03:** Password hashing is Argon2id via `argon2-cffi`, OWASP's *higher-security* band (not its
  published minimum), tuned to ~250-400ms **on the Railway container**, measured there. This document
  owes the measurement methodology and the fallback if 128 MiB proves infeasible.

**Sessions**
- **D2-04:** Sessions are a Postgres table plus an opaque `secrets.token_urlsafe(32)` token in an
  `httpOnly`, `Secure`, `SameSite=Lax` cookie. No signing library, no JWT.
- **D2-05:** A replayed cookie after logout is rejected because the row is gone, not because a flag
  says expired. The test asserts row-absence and rejection together.
- **D2-06:** Sessions survive a browser restart (persistent cookie, explicit expiry). **Sliding
  renewal is deferred** — every renewal path is another place a revoked session can be resurrected.
- **D2-07:** Cookie attributes are decided now with the future separate-app UI in mind. `SameSite=Lax`
  holds only if the UI ends up same-site; otherwise this forks to `SameSite=None; Secure` plus a CSRF
  defence. This document must state which world we are in and what changes if it's the other one.

**Isolation**
- **D2-08:** A request authenticated as user A asking for user B's data returns **not-found, not
  forbidden**, including when A is the admin. A 403 confirms the row exists — itself a disclosure.
  Admin is not exempt: admin creates/resets accounts, and cannot read trading data. That is the whole
  point of the encryption boundary Phase 3 builds; an admin read path here would make it decorative.
- **D2-09:** The isolation mechanism — RLS+`SET LOCAL` vs. an application-level scoping layer — is
  **deferred to this document, which owes a single recommendation, not a menu.** It depends on the
  spike. Resolved below: RLS, given the spike's answer (no pooler).
- **D2-10:** Whichever mechanism wins, the isolation suite must prove itself against the **real
  Railway configuration**, not only a direct-connection test container.

**The audit log**
- **D2-11:** Every privileged read of user data writes an audit row (reader, subject, time). A
  bypassing read should "not compile or not pass review" — take the strongest rung actually
  achievable in Python and say plainly which one it is: a repository type whose only read methods
  are audited (no function to call otherwise) beats a lint rule, which beats a test, which beats a
  review convention.
- **D2-12:** The audit row is written in the **same transaction** as the read it records. A read that
  succeeds while its audit row is lost is worse than no audit log — it looks like coverage.

**Carried forward from Phase 1 — do not regress**
- **D2-13:** `settings.load_settings`'s `ValidationError`→`RuntimeError` conversion (fields only,
  never values, `raise` outside the `except`), `api/errors._ErrorLocation`'s `extra="ignore"` value
  drop, and `telemetry.capture_exception`'s type/frames/request-id-only payload are all `NN-34` in
  practice. Phase 2 introduces passwords and session tokens, which makes all three more load-bearing.
- **D2-14:** `NN-34` (never logged) outranks a phase decision that wants full detail logged. Applies
  to any code in this phase that wants to log a token, password hash, or session id.

### Claude's Discretion

None recorded — CONTEXT.md itself states every gray area was decided rather than deferred, because
this was an unattended run. Where this document still had to make an implementation-level call
CONTEXT.md didn't reach (e.g., the exact `SET LOCAL` wiring pattern, the new Postgres role's name),
it is marked `[This researcher's synthesis]` inline rather than presented as a locked decision.

### Deferred Ideas (OUT OF SCOPE)

- Sliding session renewal (D2-06).
- Any email-backed flow (D2-01) — deliberately, permanently, for this milestone.
- Rate limiting on the login path — real, but belongs with the public API surface, not identity.
  Noted in Security Domain below as a known gap, not built.
</user_constraints>

## THE SPIKE — Railway Postgres Connection Topology

**Resolved. Direct connection. No pooler of any kind is in front of this project's Postgres.**

### What was measured

1. **Official Railway documentation, fetched directly this session**
   (`curl https://docs.railway.com/guides/connection-pooling-pgbouncer.md`)
   [VERIFIED: primary source, raw markdown, this session]:

   > "Pooling is not built into Railway's standard Postgres template: a fresh Postgres service
   > accepts direct connections only. To add it, you layer PgBouncer on top, either through
   > Railway's built-in Connection Pooling feature or as a separate service you run yourself."

   Railway does offer an **opt-in** managed PgBouncer feature (`docs.railway.com/databases/postgresql-pgbouncer.md`, also fetched directly this session) — a pool-mode toggle (transaction/session/statement) under **Database → Config → Connection Pooling → Add PgBouncer**. It is not active by default and must be deliberately added.

2. **The actual provisioned service, read live this session** via
   `railway variables --service b8bb4801-b1b5-4abd-92a8-2154eb92de7b --kv`:

   ```
   DATABASE_URL=postgresql://postgres:...@postgres.railway.internal:5432/railway
   PGHOST=postgres.railway.internal
   PGPORT=5432
   PGUSER=postgres
   ```

   [VERIFIED: live `railway` CLI output, this session]. No `DATABASE_UNPOOLED_URL`, no
   `DATABASE_PUBLIC_URL`, no second host — the only connection variable present points straight at
   the database. Per Railway's own PgBouncer doc, `DATABASE_UNPOOLED_URL` exists *only once PgBouncer
   has been added* — its absence here is a positive signal, not merely a null result. The installed
   `railway` CLI (4.11.0, per Phase 1's own Environment Availability table) does not even recognize a
   `railway postgres pgbouncer` subcommand, consistent with the feature never having been touched on
   this project.

3. **The image itself**, `ghcr.io/railwayapp-templates/postgres-ssl:18`
   [VERIFIED: `github.com/railwayapp-templates/postgres-ssl`, fetched this session]: "The Dockerfiles
   contained in this repository start with the official Postgres image as base," adding only SSL —
   no pooler layered in at the image level either.

### What this means for `SET LOCAL` + RLS — the load-bearing question, answered directly

**`SET LOCAL` is safe here, unconditionally, given the current topology**, for two independent,
stacked reasons:

1. **Postgres's own guarantee**: `SET LOCAL` reverts automatically at the end of the transaction that
   set it — `COMMIT` or `ROLLBACK`, either one — regardless of any application or pooling behavior.
   This is a base Postgres semantic, not something the app has to arrange.
2. **SQLAlchemy's own pool, independent of #1**: `pool_reset_on_return` defaults to `"rollback"`
   [VERIFIED: `docs.sqlalchemy.org/en/20/core/pooling.html`, fetched this session — "The pool includes
   'reset on return' behavior which will call the `rollback()` method of the DBAPI connection when the
   connection is returned to the pool"]. Even a connection returned to SQLAlchemy's pool mid-transaction
   (an exception path that skipped an explicit commit/rollback) gets rolled back before the next
   request's session can check it out — a second, independent backstop on top of #1.

**The exact conditions that would break this, named explicitly, so they can be watched for:**

- **A pooler is added later in `session` mode.** Session-mode PgBouncer holds one server connection
  per *client connection* for its entire lifetime — indistinguishable from direct connection for
  `SET LOCAL` purposes, so this is actually safe too, just defeats the purpose of adding a pooler.
- **A pooler is added later in `transaction` mode (the default if ever added).** Per Railway's own
  doc, transaction mode releases the server connection *after each transaction* — which is exactly
  the granularity `SET LOCAL` already assumes. **`SET LOCAL` remains safe under transaction-mode
  pooling specifically because it is transaction-scoped**, provided the `SET LOCAL` and the
  RLS-guarded query it protects run in the *same* transaction. What breaks under transaction mode,
  per the same doc: `LISTEN`/`NOTIFY`, advisory locks (`pg_advisory_lock`, the session-level form —
  not the transaction-scoped `pg_advisory_xact_lock`), and asyncpg's own prepared-statement caching
  (a distinct, well-known asyncpg+PgBouncer gotcha: consecutive statements from one client can land on
  different server connections, so a server-side prepared statement created on one may not exist on
  the next — mitigated by disabling asyncpg's statement cache, e.g. `statement_cache_size=0` in the
  connect args, if a pooler is ever added). **This is not a live concern today** — recorded so it
  doesn't need re-deriving if a later phase adds pooling for scale.
- **A single AsyncSession spans multiple commits within one request.** SQLAlchemy 2.0's "autobegin"
  opens a fresh transaction immediately after a commit if more queries follow on the same session.
  `SET LOCAL` set before the *first* commit does **not** carry into the second transaction — it must
  be reissued. This is the one condition Phase 2's own code has to actively guard, independent of
  Railway's topology. See "Common Pitfalls" and the recommended `after_begin` hardening below.
- **The DB role bypasses RLS entirely (superuser/`BYPASSRLS`).** This has nothing to do with pooling
  or `SET LOCAL` — it is a separate, and more dangerous, failure mode, covered in full in the next
  section. Naming it here because it is the other half of "is `SET LOCAL` safe" that a narrow reading
  of the question would miss: `SET LOCAL` can work *perfectly* and still enforce nothing if the
  connecting role ignores RLS altogether.

**`V027`/`V028` do not apply to this project as currently configured** — both are Supavisor-specific
findings from a mandatory pooler this project's Postgres does not have. `V028`'s specific list
(LISTEN/NOTIFY, advisory locks, prepared statements break under a transaction pooler) is corroborated
almost verbatim by Railway's own PgBouncer doc, which is a useful cross-check that this is a generic
transaction-pooling property and not a Supabase quirk — worth remembering if pooling is ever added
here for scale, but not an active constraint today.

## Isolation Mechanism — RLS, the Single Recommendation D2-09 Asks For

### The decisive finding: Railway's `postgres` role is a superuser, and RLS does not apply to it

[VERIFIED: `postgresql.org/docs/current/ddl-rowsecurity.html`, fetched this session]:

> "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when
> accessing a table. Table owners normally bypass row security as well, though a table owner can
> choose to be subject to row security with `ALTER TABLE ... FORCE ROW LEVEL SECURITY`."

`FORCE ROW LEVEL SECURITY` changes the *table owner's* exemption only. It has no effect on a
superuser or a `BYPASSRLS` role — there is no table-level setting that can make RLS apply to either.

Railway's Postgres template creates exactly one role, from `POSTGRES_USER` (here, `postgres`), via
the official Postgres Docker image's standard `initdb` process — confirmed this session (the
`postgres-ssl` template adds only SSL config on top of the official image, per its own README, with
no custom role logic). Postgres's own documentation names the role `initdb` creates the **"bootstrap
superuser"** [VERIFIED: `postgresql.org/docs/current/app-initdb.html`] — superuser status is definitional
for the role `initdb` bootstraps a cluster with; there is no unprivileged variant.

**What this claim actually rests on, stated precisely so it isn't mistaken for a measurement:** this
session did **not** run `SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres'` against the live
Railway database — direct connection was explicitly out of scope for this research (no
`DATABASE_PUBLIC_URL`, instructed not to proxy one). The superuser conclusion is a two-step
**inference**, each step independently verified this session, chained together: (1) the template
adds no custom role logic on top of the stock image [VERIFIED: template README], and (2) the stock
image's bootstrap role is, by Postgres's own naming and design, always a superuser [VERIFIED: Postgres
docs]. This is about as strong as an inference gets without the direct query — but it is still an
inference, not a query result, and the plan should close that gap with a **one-line, cheap, direct
check the moment a migration can run against the real database**: `SELECT rolsuper FROM pg_roles
WHERE rolname = current_user;` inside the same Alembic migration that creates `morai_app`, asserting
`false` for whatever role Alembic itself is *not* running as — or more directly, run it once by hand
against Railway and record the literal output before trusting the RLS design on top of it. Treat the
RLS recommendation below as contingent on that one-line check passing, not as already confirmed.

**Consequence: the app's current `DATABASE_URL` (role `postgres`) would make every RLS policy on
every table silently inert.** This is not a hypothetical edge case to note in passing — it is the
central fact that decides whether RLS does anything at all here, and it means creating a new,
least-privilege role is a **required Phase 2 deliverable**, not an optional hardening step layered on
afterward.

**Recommendation, concretely:**

```sql
-- Migration, run as the existing `postgres` (superuser) role.
CREATE ROLE morai_app WITH LOGIN PASSWORD :'morai_app_password' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE railway TO morai_app;
GRANT USAGE ON SCHEMA public TO morai_app;
-- Per-table grants follow each CREATE TABLE, not a blanket ALL TABLES grant, so a future
-- table's access is a deliberate line in its own migration, not inherited silently.
```

`morai_app` does **not** own any table (Alembic/`postgres` remains the owner, since migrations —
DDL — still run as `postgres`), so `FORCE ROW LEVEL SECURITY` is not strictly required for `morai_app`
itself to be bound by RLS (non-owner, non-superuser roles are subject to RLS unconditionally once
`ENABLE ROW LEVEL SECURITY` is set). **Set `FORCE` anyway, as defense-in-depth** — it costs nothing
and protects against a future migration accidentally changing table ownership.

**Operational step this creates, stated plainly rather than hand-waved:** Railway does not know about
a role it did not create, so there is no automatic `${{Postgres.MORAI_APP_URL}}`-style reference for
it. The plan needs an explicit step: generate a strong password for `morai_app` (e.g.
`secrets.token_urlsafe(32)`, entered once, by a human, into Railway's variable store — never
committed, matching this repo's public-repo posture), construct its DSN
(`postgresql://morai_app:<password>@postgres.railway.internal:5432/railway`), and set it as a new
Railway variable (e.g. `APP_DATABASE_URL`) on the **web service only**. The existing `DATABASE_URL`
(role `postgres`) stays exactly as-is for Alembic. `Settings` (D-15's `extra="forbid"` model) gains a
second field for this — see Code Examples.

### Why RLS over an application-level scoping layer — the direct comparison D2-09 asked for

| Criterion | Postgres RLS | App-level scoping layer |
|---|---|---|
| Survives a pooled connection | Yes — see the spike section; transaction-scoped `SET LOCAL` is safe under transaction-mode pooling too, if ever added | N/A — pooling is irrelevant to app-level code, this criterion doesn't distinguish them |
| Can a developer bypass it by accident | Only by using the wrong (superuser) role — a one-time infrastructure mistake, not a per-query one, and testable once | Yes, trivially — forgetting one `.where(user_id == ...)` on one query is exactly the failure mode this exists to prevent, and Python has no mechanism that makes the raw `select()` unreachable |
| Works with SQLAlchemy 2.0 async | Yes — plain `session.execute(text("SET LOCAL ..."))`, verified this session | Yes, but the guarantee is only as strong as the discipline around it |
| Protects a raw SQL / future admin tool / debug script | Yes — enforced at the query-planner level, blind to how the query was issued | No — an app-level layer is bypassed by definition the moment a query doesn't go through it |
| Can the isolation suite prove it | Yes — cleanly, by asserting a policy-filtered query returns zero rows | Yes, but only proves the *tested* code paths route through the scoping layer, not that no path ever will |
| "Not-found, not forbidden" (D2-08) | Falls out naturally — a policy-filtered row simply isn't in the result set, so a lookup-by-id-and-return-404-if-absent pattern is already correct with zero extra code | Same pattern works, but only if every read consistently returns "filtered" and "absent" as the same outcome — an easy thing to get subtly wrong under time pressure |

**Recommendation: Postgres RLS is the primary, structural mechanism.** The repository/capability
pattern built for AUTH-08 (below) is *not* a competing alternative — it is complementary, solving a
different problem (audit-writing, not row-visibility) and is layered on top of RLS-protected tables,
not instead of them. This is one recommendation, not a menu — the table above is the comparison that
produced it, not two options left standing for the planner to pick between.

### What would have to be true for the app-level layer to win instead

Named explicitly, so this decision is revisitable on stated grounds later rather than re-litigated
from scratch, and so an unattended executor isn't left guessing why RLS was chosen over the more
familiar alternative:

- **If this project's own stated threat model were looser.** `.claude/CLAUDE.md`'s own Security
  bullets already require "no cross-user view" and "audit log on privileged reads" as hard
  constraints, independent of this document. Those two constraints are exactly what RLS is good at
  enforcing structurally and an app-level filter is not. A project with a casual, low-stakes data
  model and no such constraint could reasonably choose the simpler, more familiar app-level pattern
  and accept the discipline risk — this project explicitly cannot, since the data behind the
  isolation boundary is brokerage-linked.
- **If the extra moving part (a second, least-privilege DB role, provisioned and wired outside
  Alembic's normal reach) were infeasible or disproportionately costly.** It isn't here — `CREATE
  ROLE` is one migration statement run as the existing superuser, and the only real cost is one
  manually-set Railway variable (Operational step, above). A platform that made creating additional
  Postgres roles genuinely hard or unsupported would tip this calculus.
- **If the team's own familiarity and debugging speed mattered more than the enforcement guarantee.**
  RLS is a real, known Postgres criticism: a query that looks like `SELECT * FROM positions` silently
  returns fewer rows than expected, and a developer unfamiliar with the table's policy can lose real
  time before realizing *why*. An app-level `.where(user_id == ...)` is visible in the code that runs
  it, which is easier to reason about at a glance. This is the strongest legitimate argument for the
  app-level layer, and it is a real cost RLS imposes — named here rather than glossed over, and judged
  not to outweigh the enforcement guarantee for a system whose whole reason for existing is to not
  leak brokerage-linked trading data across users.
- **If queries against these tables routinely needed to run as an elevated/reporting role** (a BI tool,
  a bulk export job, an ops dashboard reading across all users by design) **that would have to bypass
  RLS as a matter of course.** At that point RLS's bypass mechanism (a second privileged role) starts
  to look like the same discipline problem app-level scoping already has, just moved one level down.
  Not this project's shape today — Phase 11's export endpoint is explicitly per-user, not cross-user —
  but worth naming as the condition under which RLS's advantage narrows.

None of these conditions hold for Morai Journal as currently scoped. If a future phase changes the
threat model, the user count, or the query patterns enough that one of them starts to hold, that is
the signal to revisit this decision — not a reason to second-guess it now.

### The isolation suite needs something to test against — Phase 2 has no real trading table yet

ROADMAP criterion 3 reads "...asks for user B's **trading data**...". Phase 2's own scope (per
CONTEXT.md's `<domain>` block) explicitly excludes any trade table beyond "what isolation needs to be
provable against" — meaning the roadmap's literal wording and the phase's actual scope both
anticipate this gap, the same way Phase 1's criterion 4 wording didn't quite fit `NUMERIC(14,4)`
and was resolved with a named substitution rather than a silent reinterpretation.

**Resolution, matching Phase 1's own precedent exactly:** build a small, permanent-for-now probe
table — `gate_user_scoped_probe` (id, `user_id` FK, a throwaway text column) — RLS-protected, exactly
the shape a real user-owned table will have. Prove the isolation suite against it, including the
admin-not-exempt case (D2-08) and the pooled-vs-direct distinction (D2-10). **Phase 3 drops this
table with an explicit migration once real trading tables exist**, identical in spirit to
`gate_money_probe`'s documented fate. This is this researcher's own synthesis, not something
CONTEXT.md stated directly — flagged in the Assumptions Log, and the planner should confirm it rather
than silently adopt it, since it is the one place this document reinterprets the roadmap's literal
wording.

## Standard Stack

### Core (carried forward, unchanged from Phase 1's live verification — same day, within its own
30-day validity window, not re-verified here)

| Library | Version | Purpose |
|---|---|---|
| FastAPI | 0.141.1 | Routes for account/session endpoints |
| Pydantic | 2.13.5 | Request/response models |
| SQLAlchemy | 2.0.52 | ORM, `text()` for `SET LOCAL`, `delete().returning()` |
| asyncpg | 0.31.0 | Postgres driver under the web service's `AsyncEngine` |
| Alembic | 1.19.1 | New migrations: `users`, `sessions`, `setup_tokens`, `audit_log`, `gate_user_scoped_probe`, RLS policies, the `morai_app` role |

### New this phase

| Library | Version (verified live, PyPI JSON API, this session) | Purpose | Why Standard |
|---|---|---|---|
| `argon2-cffi` | **25.1.0**, uploaded 2025-06-03 | Password hashing | Already the project's own decided choice (`.claude/CLAUDE.md` §7, CONTEXT.md D2-03). Version unchanged since that prior research — no drift. `PasswordHasher`'s default `type` is already `Type.ID` (Argon2id) — confirmed by reading the installed package's own signature this session, not assumed. |

No other new third-party dependency is needed. Token generation is stdlib `secrets.token_urlsafe`;
hashing a token for storage is stdlib `hashlib.sha256`; cookie handling is Starlette's own
`Response.set_cookie`, already a transitive dependency via FastAPI — its exact signature was read
directly from the installed package this session (see Code Examples), not recalled.

**Installation:**
```bash
uv add argon2-cffi==25.1.0
```

## Package Legitimacy Audit

Only one new package this phase.

| Package | Registry | Age | Repo | Verdict | Disposition |
|---|---|---|---|---|---|
| `argon2-cffi` | PyPI | First released 2015 (per its own changelog history); this exact release 2025-06-03 | `github.com/hynek/argon2-cffi` [VERIFIED: PyPI `project_urls`, this session] | OK | Approved |

**Reasoning, not a bare table row:** `argon2-cffi` is maintained by `hynek` — the same maintainer as
`attrs` and `structlog`, both ecosystem-standard Python packages — and is the reference Python binding
for the Argon2 reference implementation (`argon2-cffi-bindings`, its own single declared runtime
dependency, per `requires_dist`). It was already independently decided and pinned in this project's
own prior stack research before this session, at the identical version. `pypistats.org`'s download API
rate-limited this session's request (`429`); given the corroborating signals above (maintainer
identity, dependency graph, multi-year history, and this project's own prior independent research
landing on the same package), a download-count check was not pursued further — this is recorded as
skipped, not silently omitted. No `[SLOP]` or `[SUS]` disposition applies.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────┐
                    │  Client (future separate UI)  │
                    │  cookie: session token,        │
                    │  httpOnly+Secure+SameSite=Lax   │
                    └───────────────┬────────────────┘
                                    │ HTTPS
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │  Railway "web" service (FastAPI, Hypercorn)         │
        │                                                       │
        │  Route → Depends(get_current_user)                    │
        │     ├─ look up sessions.token_hash (unscoped —        │
        │     │  the opaque token IS the authorization)         │
        │     ├─ SET LOCAL app.current_user_id = :uid            │
        │     │  (same AsyncSession, same transaction)           │
        │     └─ returns AuthenticatedUser(id, is_admin)          │
        │                                                          │
        │  Route body → repository call, RLS-protected table       │
        │     (users, gate_user_scoped_probe, later: trades)        │
        │     admin-management reads → AuditedRead capability        │
        │     object, only constructible by open_audited_read()       │
        └───────────────────────────┬──────────────────────────────┘
                                     │ asyncpg (AsyncEngine)
                                     │ role: morai_app (NOSUPERUSER NOBYPASSRLS)
                                     ▼
        ┌────────────────────────────────────────────────────┐
        │  Railway Postgres — direct connection, no pooler       │
        │  (spike's answer)                                       │
        │                                                           │
        │  users, sessions, setup_tokens, audit_log,                │
        │  gate_user_scoped_probe — RLS ENABLE + FORCE                │
        │  policy: USING (user_id = current_setting(                  │
        │            'app.current_user_id', true)::uuid)               │
        │                                                                │
        │  role: postgres (superuser) — owns tables, runs Alembic DDL     │
        └────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

Adds one submodule to D-18's existing layout (`api/`, `worker/`, `money/`, `db/`):

```
src/
└── morai/
    ├── identity/          # NEW — everything this phase adds
    │   ├── passwords.py    # PasswordHasher wrapper, tuned params, check_needs_rehash
    │   ├── tokens.py       # secrets.token_urlsafe + sha256 hashing helpers (shared by
    │   │                    # sessions AND setup_tokens — one implementation, D-06-style)
    │   ├── sessions.py     # get_current_user dependency, cookie set/clear, SET LOCAL wiring
    │   └── audit.py        # AuditedRead capability type + open_audited_read() factory
    ├── api/
    │   └── routes_identity.py   # account, setup-link, login, logout, /me routes
    └── db/
        └── models.py        # + User, Session, SetupToken, AuditLog, GateUserScopedProbe
alembic/versions/
    └── 000X_identity_and_rls.py   # tables, morai_app role, ENABLE+FORCE RLS, policies
```

### Pattern 1: NN-35's atomic consume, exact SQLAlchemy 2.0 async form

**What:** a single-use token (setup link or password reset) is validated and destroyed in one
statement — no read-then-check-then-delete race.
**When to use:** AUTH-01, AUTH-02, AUTH-05.
**Verified pattern** [VERIFIED: `docs.sqlalchemy.org/en/20/orm/queryguide/dml.html`, this session, for
`delete().returning()`'s existence and shape; the expiry-in-the-WHERE-clause design is this
researcher's synthesis for atomicity, see inline reasoning]:

```python
from datetime import UTC, datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SetupToken


async def consume_setup_token(
    session: AsyncSession, token_hash: str
) -> SetupToken | None:
    """One atomic statement. Matches only an unexpired row, so an expired-but-
    never-used token is left alone (distinguishable later if wanted) while a
    valid one is deleted and returned in the same round trip — no window for a
    second concurrent request to consume the same row twice."""
    stmt = (
        delete(SetupToken)
        .where(
            SetupToken.token_hash == token_hash,
            SetupToken.expires_at > datetime.now(UTC),
        )
        .returning(SetupToken)
    )
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    await session.commit()
    return row  # None means "invalid, expired, or already used" -- deliberately
    # not distinguished in the response, so the failure mode itself isn't an oracle.
```

Concurrency proof this pattern relies on: Postgres's own MVCC guarantees exactly one concurrent
`DELETE` against the same row can succeed; the loser's `WHERE` simply matches zero rows once the
winner's delete commits (or is still in flight under the row lock `DELETE` takes) — this is a
database-level guarantee, not something the application code adds.

### Pattern 2: `SET LOCAL` wiring for RLS — the auth dependency issues it directly

**What:** the per-request `AsyncSession`'s RLS context is set exactly once, by the same dependency
that already has to resolve "who is this," immediately after that resolution and before any other
query in the request.
**When to use:** every route that touches an RLS-protected table.
**[This researcher's own synthesis]**, built from three independently-verified primitives (SET
LOCAL's transaction-scoping, SQLAlchemy 2.0's autobegin, and FastAPI's per-request dependency
caching) — not copied from one external worked example:

```python
from __future__ import annotations

from uuid import UUID

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Session as SessionRow
from morai.db.session import get_db_session
from morai.identity.tokens import hash_token


class AuthenticatedUser:
    def __init__(self, user_id: UUID, is_admin: bool) -> None:
        self.user_id = user_id
        self.is_admin = is_admin


async def get_current_user(
    session_token: str | None = Cookie(default=None, alias="morai_session"),
    db: AsyncSession = Depends(get_db_session),
) -> AuthenticatedUser:
    if session_token is None:
        raise HTTPException(status_code=401, detail="not authenticated")

    # Unscoped lookup -- the `sessions` table carries no RLS policy. Possession of
    # the opaque, 256-bit token IS the authorization; there is no "which user" to
    # scope this particular query by, since that's the very fact being resolved.
    row = (
        await db.execute(
            select(SessionRow).where(SessionRow.token_hash == hash_token(session_token))
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="not authenticated")

    # Same session, same already-open transaction (the SELECT above triggered
    # SQLAlchemy's autobegin) -- SET LOCAL does not need to be the first statement
    # in a transaction, only issued before the queries it must protect.
    await db.execute(
        text("SET LOCAL app.current_user_id = :uid"), {"uid": str(row.user_id)}
    )
    return AuthenticatedUser(user_id=row.user_id, is_admin=row.is_admin)
```

Because `Depends(get_db_session)` is FastAPI's own per-request-cached dependency, any route handler
that *also* declares `db: AsyncSession = Depends(get_db_session)` receives the identical session
object `get_current_user` already set the context on — no second wiring needed per route.

**Hardening not required for Phase 2's actual route set, but documented for when it is:** if any
future route calls `session.commit()` mid-handler and issues more RLS-guarded queries afterward, the
new transaction SQLAlchemy autobegins needs `SET LOCAL` reissued — it does not carry over. The
general-purpose fix is a session-class-level `after_begin` event, confirmed this session to apply
transparently to `AsyncSession` instances [VERIFIED: `docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html`
— "event handlers registered on the synchronous `Session` class will automatically apply to all
`AsyncSession` instances"], reading a `ContextVar` the auth dependency also sets, and — critically —
calling `connection.execute()`, not `session.execute()`, inside the handler
[VERIFIED: `github.com/sqlalchemy/sqlalchemy/discussions/10469` — a maintainer-confirmed fix for the
`"This session is provisioning a new connection"` `InvalidRequestError` that fires if `session` is
used instead]:

```python
from contextvars import ContextVar
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.orm import Session as SyncSession

_rls_user_ctx: ContextVar[UUID | None] = ContextVar("rls_user_ctx", default=None)


@event.listens_for(SyncSession, "after_begin")
def _set_rls_context(session: object, transaction: object, connection: object) -> None:
    user_id = _rls_user_ctx.get()
    if user_id is not None:
        connection.execute(  # type: ignore[attr-defined]  # SQLAlchemy event signature is untyped at this boundary
            text("SET LOCAL app.current_user_id = :uid"), {"uid": str(user_id)}
        )
```

Not wired in by default in the example above — do not add it speculatively ahead of a route that
needs it (ponytail: this is a documented upgrade path, not a Phase 2 requirement, since no Phase 2
route commits mid-handler).

### Pattern 3: the capability-object audit pattern (AUTH-08)

**What:** a privileged (cross-user) read requires an `AuditedRead` object as a parameter; the only
public way to obtain one is a factory that writes the audit row first, in the same transaction
(D2-12), and returns the capability.
**When to use:** the one legitimate cross-user read path in this system — admin account management
(looking up user B's account row to issue a setup link or reset a password). There is no other
privileged-read surface in Phase 2's scope: trading data has no legitimate cross-user read at all,
including for the admin (D2-08), so it never gets an `AuditedRead` path — only RLS.

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import AuditLog

_FACTORY_SENTINEL = object()


@dataclass(frozen=True)
class AuditedRead:
    """Proof that this specific cross-user read was audited. The only public
    constructor is `open_audited_read()` below -- a caller who builds one by hand
    supplies the wrong sentinel and it raises immediately, at the read call site,
    not silently later."""

    reader_id: UUID
    subject_id: UUID
    _token: Any = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._token is not _FACTORY_SENTINEL:
            raise RuntimeError(
                "AuditedRead must come from open_audited_read() -- constructing "
                "one directly bypasses the audit log (AUTH-08)."
            )


async def open_audited_read(
    session: AsyncSession, *, reader_id: UUID, subject_id: UUID
) -> AuditedRead:
    """D2-12: the audit row and the capability that unlocks the read are produced
    in the same call, on the same session -- so committing the read's own
    transaction also commits the audit row, or neither commits."""
    await session.execute(
        insert(AuditLog).values(reader_id=reader_id, subject_id=subject_id)
    )
    return AuditedRead(reader_id=reader_id, subject_id=subject_id, _token=_FACTORY_SENTINEL)


async def get_user_for_management(
    session: AsyncSession, proof: AuditedRead
) -> "User":  # noqa: F821 -- illustrative forward ref
    """The only signature this function has. There is no overload that accepts
    a bare (session, reader_id, subject_id) -- omitting the capability is a
    basedpyright/mypy error, the same shape as this repo's own
    `violation_unit_confusion.py` (tests/gate/), not a runtime surprise."""
    ...
```

**What this honestly buys, stated at the level of rigor D2-11 asked for:**

- **Type-checked (real "does not compile"):** a caller who tries `get_user_for_management(session,
  admin_id, user_id)` — three loose arguments instead of the capability — gets a basedpyright/mypy
  error today, because the parameter type doesn't match. This is exactly the same class of guarantee
  as `violation_unit_confusion.py`'s `needs_usd(amount: Usd)` rejecting an `IndexPoints` argument —
  provable with the identical `tests/gate/` subprocess pattern already established in this codebase.
- **Not type-checked (falls back to a runtime guard):** a caller who *forges* an `AuditedRead` by
  passing some other sentinel object gets a `RuntimeError`, not a type error — type checkers verify
  shapes, not which function produced a value. This is the honest ceiling. A `tests/gate/` fixture
  should assert **both** halves: the wrong-argument-shape case fails basedpyright with a named rule
  (mirroring the existing suite's marker-assertion pattern), and a forged-token case raises at
  runtime, tested as a unit test rather than claimed as a compile-time guarantee.
- **Not covered by this pattern at all:** whether a *reviewer* correctly recognizes a new privileged
  surface should route through this pattern in the first place. That is D2-11's explicit fallback
  rung ("beats a review convention") — this pattern reduces how much has to rely on review, it does
  not eliminate the need for it on brand-new code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Password hashing | A custom PBKDF2/bcrypt wrapper | `argon2-cffi`'s `PasswordHasher`, default `Type.ID` | Already the project's own decided choice; reference implementation binding, not a reimplementation |
| Single-use token consumption | A `SELECT` then a conditional `UPDATE`/`DELETE` | One `delete(...).returning(...)` statement (Pattern 1) | The read-then-write shape is exactly the race `NN-35` exists to prevent — one atomic statement removes the window entirely |
| Tenant isolation | Manually adding `.where(user_id == ...)` to every query, everywhere, forever | Postgres RLS | The whole comparison table above — an app-level filter is bypassed the moment one query forgets it; RLS is enforced by the database regardless of how the query was written |
| Session token signing | A JWT library, `itsdangerous` | Opaque token + server-side row (already decided, D2-04) | A signed-but-unrevokable token needs a denylist to support real logout — which is this same table, with extra steps |
| Setup-link AND password-reset tokens as two separate mechanisms | Two tables, two consume functions | One `setup_tokens` table with a `purpose` column, one consume function (Pattern 1) | D2-01/D2-02 describe the identical mechanism for both flows; two implementations of the same atomic-consume logic is exactly the duplicated-write shape this project's own history (`LEDGER-01`) warns against |
| Multi-tenant SQLAlchemy helper libraries (e.g. `sqlalchemy-tenants`, found via WebSearch this session) | A new third-party dependency for ~15 lines of `SET LOCAL` wiring | The hand-written dependency in Pattern 2 | Matches this project's own established judgment on session storage ("a five-line dependency and a table, not a package") — a new, less-scrutinized dependency for a small, fully-understood piece of code is a worse trade than owning those 15 lines |

**Key insight:** every entry above is the same lesson twice — once for money (Phase 1, `L060`'s "one
kernel, one carry source") and now for identity: one canonical implementation per cross-cutting
concern (token consumption, tenant scoping), enforced structurally where the tooling allows it and
by convention only where it doesn't.

## Common Pitfalls

### Pitfall 1: The app connects as `postgres` and RLS silently does nothing

**What goes wrong:** every policy is written correctly, every test that exercises the *application's*
code path passes, and cross-user data is still fully readable — because the connecting role is a
superuser and Postgres never even evaluates the policy.
**Why it happens:** Railway's Postgres template provisions exactly one role, and it is the obvious
one to reach for since it's already in `DATABASE_URL`.
**How to avoid:** the `morai_app` role (above) is a required deliverable, not an optional hardening
step. Add a migration-time or startup-time assertion that queries `current_setting('is_superuser')`
or `pg_has_role(current_user, 'pg_read_all_data', 'member')`-style checks against the connection the
web service actually uses, and fails loudly if it's a superuser — this is cheap insurance against the
single most consequential mistake this phase can make.
**Warning signs:** the isolation suite passes on a fresh `docker-compose` container (where the test
setup might also default to a superuser role) but the underlying policy was never actually exercised —
the suite must assert the *role* it's running as is not a superuser, not only that a query returns
zero rows, or a superuser connection would report the same "zero rows found... no wait, it returns
everything" — actually the inverse failure: it would report ALL rows and the test's own "expect
not-found" assertion would correctly fail loudly. The dangerous case is a superuser role that
*happens* to pass a shallow test because the test only checked its own user's row was visible, not
that another user's row was excluded.

### Pitfall 2: `SET LOCAL` issued on the `Session`, not the `Connection`, inside an event handler

**What goes wrong:** `InvalidRequestError: This session is provisioning a new connection; concurrent
operations are not permitted` — measured and documented by SQLAlchemy's own maintainers, not merely
theorized.
**Why it happens:** the `after_begin` event fires *during* the session's transition into an active
transaction; calling back into the `Session` object mid-transition (rather than the `Connection`
parameter the event already hands you) races the session's own internal state.
**How to avoid:** always `connection.execute(...)`, never `session.execute(...)`, inside an
`after_begin` handler — see the exact fix in Pattern 2's hardening section.
**Warning signs:** the error only appears on `commit()`, not on the `SET LOCAL` statement itself —
easy to misattribute to the commit path instead of the event handler that actually caused it.

### Pitfall 3: A route commits mid-handler, and the second transaction has no RLS context

**What goes wrong:** the first half of a handler's queries are correctly isolated; a later query in
the same request, issued after an explicit `session.commit()`, is not — because SQLAlchemy autobegins
a fresh transaction and `SET LOCAL`'s scope ended at the previous commit.
**Why it happens:** `SET LOCAL`'s transaction-scoping is exactly the property that makes it pooler-safe
(the spike section) — the same property means it does not survive a second transaction on the same
session without being reissued.
**How to avoid:** either avoid multiple commits per request (the natural default for Phase 2's simple
CRUD-shaped routes), or add the `after_begin` hardening from Pattern 2 before any route needs it.
**Warning signs:** an isolation-suite failure that only reproduces on a specific route, and only after
a specific sequence of writes within one request — worth a code-search for `session.commit()` calls
that aren't the last statement in their handler if this is ever seen.

### Pitfall 4: Copying the `users` table's admin-bypass RLS policy onto a future trading-data table

**What goes wrong:** the `users` table legitimately needs an admin-visible path (AUTH-01/AUTH-05
require admin to read/write other users' account rows for setup/reset) — so its RLS policy will
plausibly include an `is_admin` bypass clause. A future phase's trading-data table, built by copying
that policy as a starting template, inherits the bypass and directly violates D2-08 ("admin is not
exempt... an admin read path here would make [Phase 3's encryption boundary] decorative").
**Why it happens:** policy-copying is the natural way to move fast once one RLS table exists.
**How to avoid:** name the distinction explicitly in the migration/model comments — `users` (and only
`users`, `setup_tokens`, `audit_log`) may carry an admin-bypass clause; any table holding trading data
must not, ever, full stop.
**Warning signs:** a code review that doesn't ask "does this table's policy have an `is_admin` clause,
and should it."

### Pitfall 5: `SameSite=Lax` breaking silently the day the UI moves to a different registrable domain

**What goes wrong:** login works fine in every manual test (top-level navigations always send `Lax`
cookies), but a fetch()-based API call from the deployed UI never carries the session cookie, and it
looks exactly like a backend bug.
**Why it happens:** `SameSite=Lax` is sent on cross-*origin* requests as long as they're same-*site*
(e.g. `app.morai.example` calling `api.morai.example` — different origins, same registrable domain).
It is **not** sent on genuinely cross-site fetch/XHR requests (e.g. a UI on `morai-ui.vercel.app`
calling `api.railway.app`) unless the request is a top-level navigation.
**How to avoid:** decide the UI's eventual domain relationship *before* it's built — see the Cookie
Attributes section below, which states both worlds explicitly per D2-07's own instruction.
**Warning signs:** "works when I test it by hand, fails from the deployed frontend" is close to a
textbook description of this exact failure.

## Code Examples

### Cookie attributes — the two worlds D2-07 asked this document to name

**Verified this session, from the installed Starlette source** (`Response.set_cookie`'s signature,
read via `inspect.signature`, not recalled or paraphrased):

```
set_cookie(key, value='', max_age=None, expires=None, path='/', domain=None,
           secure=False, httponly=False, samesite='lax', partitioned=False)
```

**World A — the UI ends up same-site with the API** (e.g. `app.morai.example` and
`api.morai.example`, sharing the registrable domain `morai.example`): `SameSite=Lax` is correct and
sufficient, exactly as D2-04 already specified. This is the recommended target architecture — it
needs no CORS credential dance and no separate CSRF defence, and is the more likely shape for a
solo-plus-friends project's eventual UI.

**World B — the UI ends up on a genuinely different registrable domain** (e.g. a Vercel preview
domain calling a `railway.app` API domain): `SameSite=Lax` cookies are silently **not sent** on
cross-site `fetch()`/XHR calls. This forks into `SameSite=None` (which Starlette requires pairing
with `secure=True` — browsers reject `SameSite=None` without `Secure`), plus CORS configured with an
explicit origin (never `*`) and `Access-Control-Allow-Credentials: true`, plus a real CSRF defence
(a double-submit token, since `SameSite` itself was the CSRF mitigation in World A and is gone here).

```python
response.set_cookie(
    key="morai_session",
    value=raw_token,
    max_age=60 * 60 * 24 * 30,  # 30 days -- D2-06, persistent, no sliding renewal
    httponly=True,
    secure=True,
    samesite="lax",  # World A default -- flip to "none" only if World B is confirmed
    path="/",
)
```

**[This researcher's assumption, flagged explicitly]:** which world the project ends up in is not
yet decided — no UI exists. World A is recommended as the default to build against now, since it is
simpler and matches this project's general "no more infrastructure than the user count needs"
pattern (same reasoning already used for rejecting a session-signing library). Logged in the
Assumptions Log.

### Session token hashing before storage

```python
import hashlib
import secrets


def generate_token() -> str:
    """256 bits of entropy, URL-safe. Not guessable; the hash below protects
    against a stolen row, not against brute force -- there is nothing to brute
    force here."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256, not Argon2 -- deliberately. This token already carries 256 bits
    of entropy (unlike a password), so a fast hash costs an attacker nothing
    extra to search, while a slow hash would cost every legitimate request a
    real, unnecessary CPU tax on every lookup. The threat this defends against
    is a database dump/backup/read-only leak exposing usable session tokens
    directly -- consistent with NN-34's bearer-equivalent-secret discipline,
    applied to a table this project owns rather than a vendor's OAuth code."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
```

### Argon2id — verified API, tuned parameters

**Verified this session** by reading the installed `argon2-cffi==25.1.0` package's own signatures
directly (`inspect.signature`), not recalled from training data:

```python
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# OWASP's higher-security band, per D2-03. `type` defaults to Type.ID (Argon2id)
# -- confirmed from the installed package's own __init__ signature, not passed
# explicitly here since the default is already correct.
_hasher = PasswordHasher(time_cost=3, memory_cost=131072, parallelism=1)
# memory_cost is in KiB: 131072 KiB = 128 MiB.


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        _hasher.verify(stored_hash, password)  # raises, or returns Literal[True]
    except VerifyMismatchError:
        return False
    return True


def needs_rehash(stored_hash: str) -> bool:
    """True if `stored_hash` was produced with different parameters than
    `_hasher` is currently configured with -- call after a successful verify,
    so a parameter bump upgrades hashes lazily on next login rather than
    needing a bulk migration."""
    return _hasher.check_needs_rehash(stored_hash)
```

**Local benchmark, methodology for the planner to re-run on the real Railway container**
[VERIFIED: measured this session, Apple M1 Pro, 10-core, 32 GB RAM — a **reference point, not the
deployed answer**; CONTEXT.md D2-03 explicitly requires the Railway measurement, which cannot be
taken until the service is deployed]:

```
memory_cost=19456KiB (19MiB) time_cost=2 parallelism=1 -> 31.8ms   (OWASP minimum band)
memory_cost=131072KiB (128MiB) time_cost=3 parallelism=1 -> 276.4ms (recommended -- lands in target)
memory_cost=131072KiB (128MiB) time_cost=3 parallelism=2 -> 137.3ms
memory_cost=131072KiB (128MiB) time_cost=5 parallelism=1 -> 437.8ms (slightly over 400ms)
memory_cost=65536KiB (64MiB) time_cost=3 parallelism=1 -> 135.2ms   (fallback if 128MiB is too slow)
memory_cost=46137KiB (45MiB) time_cost=1 parallelism=1 -> 25.5ms    (OWASP's 2nd documented option)
```

**Recommended starting parameters: `time_cost=3, memory_cost=131072 (128 MiB), parallelism=1`** —
276ms locally, inside the 250-400ms target. `parallelism=2` roughly halves wall-clock time for the
same memory/security cost if the container has ≥2 vCPUs available to spend on a single request; not
recommended as the default because it multiplies concurrent memory use under a burst of simultaneous
logins (unlikely at 4-5 users, but the cheaper default is `parallelism=1` and raising it is an easy,
reversible tune).

**The honest fallback, reframed from CONTEXT.md's framing:** CONTEXT.md asks what happens "if 128 MiB
is infeasible" — measured evidence points the other way: 128 MiB is trivial against any Railway
plan's memory ceiling (the Free plan alone caps at 0.5 GB per service, comfortably above 128 MiB for
a single hash operation; concurrent logins at this project's scale — 4-5 users — will not multiply
that into real pressure). **The actual constraint on a Railway container is very likely CPU wall-clock
time, not memory**, since Railway's shared vCPUs are typically slower per-core than a laptop's Apple
Silicon. If the measured Railway time lands meaningfully over ~400ms: reduce `time_cost` first (3→2),
which is the fallback that stays *inside* OWASP's documented acceptable range rather than dropping
below it; only reduce `memory_cost` below OWASP's stated floor (19 MiB) as a last resort, and treat
that as a `checkpoint:human-verify` decision given these accounts are linked to brokerage credentials
(D2-03's own stated reason for the higher band in the first place).

**Required Wave-0-adjacent step, not yet run:** measure the exact numbers above against the deployed
Railway web service once it exists, using the identical script, and record the result the same way
Phase 1's `V092` recorded its own live-deploy measurement (Orchestrator Addendum 3) — this document
supplies the method, not the final number.

### RLS policy DDL

```sql
CREATE TABLE gate_user_scoped_probe (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    note TEXT NOT NULL
);

ALTER TABLE gate_user_scoped_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_user_scoped_probe FORCE ROW LEVEL SECURITY;

CREATE POLICY user_isolation ON gate_user_scoped_probe
    USING (user_id = current_setting('app.current_user_id', true)::uuid);
```

`current_setting(name, missing_ok := true)` returns `NULL` instead of raising when the setting has
never been set in the current session [VERIFIED via WebSearch summary of the PostgreSQL mailing list
thread that introduced the `missing_ok` argument, corroborated by multiple independent secondary
sources this session — CITED, not independently re-derived from the primary Postgres source code].
`user_id = NULL` evaluates to `NULL`, not `TRUE`, in the `USING` clause, so an unset context excludes
every row — **the policy fails closed by construction**, not by a separate check.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Assuming Railway Postgres is pooled by default (a reasonable prior, since Supabase's Supavisor *is* mandatory) | Railway's standard Postgres template is direct-connection-only; PgBouncer is a distinct, opt-in, per-service feature added via **Database → Config → Connection Pooling** | Feature exists now (fetched live this session); this project's Postgres has never had it added | `V027`/`V028` (Supavisor-specific) do not carry forward automatically the way `.claude/CLAUDE.md` flagged as a possibility — resolved definitively, not left as a caveat |
| `NN-28`/`NN-29`'s "cap every pool against the pooler's ceiling" | Still correct for SQLAlchemy's own `AsyncEngine` pool (uncapped by default), just against Postgres's own `max_connections` directly rather than a pooler's tighter ceiling, since there is no pooler layer to also cap | No platform change — a scope clarification for this project specifically | Worth a pool-size cap on `create_async_engine` regardless (not urgent at 4-5 users, but cheap to set now); not a Phase 2 blocker |

**Deprecated/outdated:** nothing in this phase's specific domain — Argon2id, opaque server-side
sessions, and Postgres RLS are all current, stable, unchanged best practice, not areas that recently
shifted.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `gate_user_scoped_probe` is the right resolution for "Phase 2 has no real trading table to test isolation against" | Isolation Mechanism | Low — this researcher's synthesis, directly mirroring an already-accepted Phase 1 pattern (`gate_money_probe`); worst case the planner picks a different placeholder shape, the mechanism (RLS + the suite structure) is unaffected |
| A2 | World A (UI ends up same-site with the API) is the right default to build cookie attributes against now | Code Examples, Cookie Attributes | Low-Medium — easy to flip `samesite="lax"` to `"none"` plus add CORS/CSRF later if World B turns out true; the cost of guessing wrong is a known, bounded rework, not a silent security gap (World B's requirements are a strict superset, not a contradiction) |
| A3 | The `SET LOCAL`-in-the-auth-dependency wiring (Pattern 2) is suffient for Phase 2's actual routes, with the `after_begin` event as a documented-but-unbuilt upgrade | Architecture Patterns | Low — if a Phase 2 route turns out to need a mid-handler commit after all, the fallback is already fully specified, just not wired in speculatively |
| A4 | `pypistats.org`'s rate limit this session doesn't hide a real red flag on `argon2-cffi`'s download count | Package Legitimacy Audit | Very low — the package was already independently vetted and pinned in this project's own prior research, at the same version, before this session |
| A5 | `current_setting`'s `missing_ok` fail-closed behavior (CITED, not independently verified against the primary Postgres source) | Code Examples, RLS policy DDL | Low — corroborated by multiple independent secondary sources describing the exact feature and its motivating use case (RLS + DEFAULT clauses); worth a two-line unit test confirming it (`SELECT current_setting('app.current_user_id', true)` with nothing set, assert NULL) before relying on it in production, which the isolation suite effectively provides for free as its first assertion |

**If this table is empty:** it is not — five real assumptions, none load-bearing enough to block
planning, all with a stated fallback.

## Open Questions

1. **Exact Railway CPU allocation for a Railway-plan web service, and how that translates to Argon2id
   wall-clock time.**
   - What we know: memory ceilings per plan (Free 0.5 GB, Hobby 48 GB, Pro 1 TB) — not the
     constraining resource here. Local M1 Pro numbers as a reference floor.
   - What's unclear: actual per-vCPU performance on the specific Railway plan this project runs on —
     not documented by Railway in a form this session could fetch (their pricing/resource docs name
     memory and general compute limits, not per-core clock/IPC figures).
   - Recommendation: measure directly, post-deploy, with the exact script this document supplies —
     this is unavoidably an empirical question, matching how Phase 1 resolved its own Railway-specific
     unknowns (V092).

2. **Whether the future UI ends up same-site or cross-site with the API (World A vs. World B).**
   - What we know: both are fully specified above, with an explicit default (World A) to build
     against now.
   - What's unclear: no UI project exists yet to answer this from.
   - Recommendation: revisit at the start of whatever phase first builds a UI; not a Phase 2 blocker
     since World A's cookie config is a strict subset of what World B needs, not a contradiction.

3. **Should `morai_app`'s connection pool size be capped explicitly in `create_async_engine`, given
   `NN-28`'s "cap every pool" law and the fact that Railway's Postgres has no pooler enforcing a
   ceiling on its behalf?**
   - What we know: Postgres's own `max_connections` is the only ceiling in this topology now; a
     handful of users makes this a low-probability problem today.
   - What's unclear: this document did not measure Railway's Postgres's configured `max_connections`
     value (would require a live query this session's scope didn't call for).
   - Recommendation: cheap to set a conservative `pool_size`/`max_overflow` now as a habit consistent
     with `NN-28`, even though the risk is low at this project's scale — the planner's call, not
     asserted as required here.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| `railway` CLI | Live topology verification, this session | ✓ | 4.11.0 (per Phase 1's own table; unchanged) | — |
| Railway Postgres service, live | Reading the actual `DATABASE_URL`/role shape | ✓ (read-only `variables` query used — no connection attempted, per explicit instruction not to) | — | — |
| Local Postgres (for RLS-policy dev/test) | Wave 0, isolation-suite authoring | ✗ — Docker's daemon was broken in Phase 1's own session; not re-checked this session, no reason to expect it changed | — | CI's `services: postgres` container (Phase 1's own established fallback) is the only usable test database; the isolation suite's D2-10 requirement ("prove itself against the real Railway configuration") additionally needs a run against the deployed service itself, not only CI |
| `argon2-cffi` | Password hashing | ✓ (installed and benchmarked live this session via `uv run --with`) | 25.1.0 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local Docker/Postgres (CI container substitutes for
development; the deployed-service run is still required separately for D2-10, same as `V092`
couldn't be fully closed without a real deploy in Phase 1).

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0 (unchanged from Phase 1) |
| Config file | existing `pyproject.toml` `[tool.pytest.ini_options]` — no changes needed |
| Quick run command | `uv run pytest tests/ -x -q --ignore=tests/gate -m "not db"` |
| Full suite command | `tools/gate.sh` (existing, per Phase 1) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| AUTH-01 | A setup link created by admin is consumable exactly once; a concurrent double-use only succeeds once | integration (db) | `uv run pytest tests/test_setup_tokens.py -x -m db` | ❌ Wave 0 |
| AUTH-02 | A consumed setup link's second use is rejected | integration (db) | same file as above | ❌ Wave 0 |
| AUTH-03 | Login succeeds with correct credentials, issues a session row + cookie; wrong password rejected | integration (db) + unit (Argon2 verify) | `uv run pytest tests/test_login.py -x -m db`, `uv run pytest tests/identity/test_passwords.py -x` | ❌ Wave 0 |
| AUTH-04 | Logout deletes the session row; a replayed cookie post-logout is rejected because the row is gone (D2-05) | integration (db) | `uv run pytest tests/test_logout.py -x -m db` | ❌ Wave 0 |
| AUTH-05 | Admin-issued password reset link works exactly once, same mechanism as AUTH-01 | integration (db) | `uv run pytest tests/test_setup_tokens.py -x -m db` (parametrized by `purpose`) | ❌ Wave 0 |
| AUTH-07 | The isolation suite: user A cannot read user B's `gate_user_scoped_probe` row, including when A `is_admin`, against **both** a direct-connection test DB (CI) and the real Railway deployment (D2-10) | integration (db) — CI run + a separate deployed-service smoke run | `uv run pytest tests/test_isolation.py -x -m db` (CI); a `curl`/`httpx`-based smoke script against the live Railway URL (deploy-time only, not part of the regular suite) | ❌ Wave 0 |
| AUTH-08 | A read via `open_audited_read()` writes exactly one audit row in the same transaction; a direct call to the protected read function with the wrong argument shape fails basedpyright/mypy (gate-fixture pattern); a forged `AuditedRead` raises at runtime | unit + `tests/gate/` meta-test | `uv run pytest tests/identity/test_audit.py -x`, `uv run pytest tests/gate/test_type_gate.py -x` (new parametrized case added) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `uv run pytest tests/ -x -q --ignore=tests/gate -m "not db"`
- **Per wave merge:** `tools/gate.sh` (full suite, including `tests/gate/` and `-m db` tests against CI's Postgres container)
- **Phase gate:** full CI suite green, **plus** the D2-10-required run of the isolation suite against
  the actual deployed Railway service — this is the one test in this phase that CI alone cannot
  satisfy, matching Phase 1's own precedent that `/gate/money-roundtrip` needed a real-deploy proof.

### Wave 0 Gaps

- [ ] `alembic/versions/000X_identity_and_rls.py` — `users`, `sessions`, `setup_tokens`, `audit_log`,
      `gate_user_scoped_probe` tables; `morai_app` role; `ENABLE`+`FORCE ROW LEVEL SECURITY`; policies
- [ ] `src/morai/identity/` — the four new modules per the Recommended Project Structure
- [ ] `src/morai/db/models.py` — the five new ORM model classes
- [ ] `tests/identity/` — new test package, `conftest.py` addition for a second, `morai_app`-role
      test session (to actually exercise RLS in CI, not only the superuser-role fixture Phase 1
      already has)
- [ ] `tests/test_isolation.py` — the phase's own 13-fixture-oracle-equivalent, per CONTEXT.md's
      Specific Ideas note ("treat it that way")
- [ ] A deploy-time smoke script proving D2-10 against the real Railway service, analogous to
      Phase 1's `V092` measurement script
- [ ] Framework install: `uv add argon2-cffi==25.1.0`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes | Argon2id (D2-03); opaque session tokens, not passwords, on every subsequent request |
| V3 Session Management | yes | Server-side revocable sessions (D2-04/D2-05); `httpOnly`+`Secure` cookie; no session ID in a URL |
| V4 Access Control | yes | Postgres RLS as the primary structural mechanism (this document's central recommendation) |
| V5 Input Validation | yes | Existing D-09/D-12 `ApiModel` base (`strict=True, extra="forbid"`) — new identity request/response models inherit it unchanged |
| V6 Cryptography | partial | Password hashing (Argon2id) is this phase's; envelope encryption for trading data is Phase 3's |
| V7 Error Handling and Logging | yes | D2-13/D2-14 — this phase's passwords and tokens raise the stakes on the already-established opaque-error/redacted-log pattern, not a new mechanism |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Session fixation (attacker sets a known token before victim logs in) | Spoofing | Not applicable to this design — the server generates the token at login time; the client never supplies one for the server to adopt |
| Session token stolen from a DB dump/backup | Information Disclosure | Store only `sha256(token)`, never the raw token (Code Examples) |
| Brute-force login attempts | Spoofing (via automation) | **Explicitly deferred** by CONTEXT.md's own `<deferred>` section — "belongs with the public API surface rather than with identity." Named here as a known, acknowledged gap, not silently missing: ASVS V2.2.1-class anti-automation control is not built in Phase 2. |
| Admin role used as a backdoor cross-user read path | Elevation of Privilege | D2-08 — RLS with no admin-bypass clause on any trading-data table, full stop; the one narrow, audited exception is account-management fields on `users` itself, via the capability pattern |
| A future migration accidentally makes `morai_app` the owner of a user-scoped table | Elevation of Privilege | `FORCE ROW LEVEL SECURITY` set on every RLS table regardless of current ownership, as defense-in-depth against exactly this drift |
| RLS policy silently inert because the connecting role is a superuser | Elevation of Privilege | This document's central finding — `morai_app`, `NOSUPERUSER NOBYPASSRLS`, is a required deliverable, with a recommended boot-time or migration-time assertion catching a regression back to the `postgres` role |
| CSRF against session-cookie-authenticated state-changing routes | Tampering | `SameSite=Lax` (World A) already blocks cross-site form/simple-request CSRF for the common case; if World B (cross-site UI) is ever confirmed, a real CSRF token becomes required — named explicitly in Pitfall 5, not assumed away |

## Sources

### Primary (HIGH confidence — fetched or executed directly this session)

- `curl https://docs.railway.com/guides/connection-pooling-pgbouncer.md` — "pooling is not built in"
- `curl https://docs.railway.com/databases/postgresql-pgbouncer.md` — pool modes, variable shapes
- `railway variables --service b8bb4801-b1b5-4abd-92a8-2154eb92de7b --kv` — live topology proof
- `github.com/railwayapp-templates/postgres-ssl` README — base image confirmation
- `postgresql.org/docs/current/ddl-rowsecurity.html` — superuser/BYPASSRLS/FORCE semantics
- `postgresql.org/docs/current/app-initdb.html` — bootstrap superuser naming
- `docs.sqlalchemy.org/en/20/core/pooling.html` — `pool_reset_on_return` default (`"rollback"`)
- `docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html` — sync-class event registration applies to `AsyncSession`
- `github.com/sqlalchemy/sqlalchemy/discussions/10469` — `after_begin` + `connection.execute()` fix, exact error text
- `docs.sqlalchemy.org/en/20/orm/queryguide/dml.html` — `delete().returning()` shape
- `curl "https://pypi.org/pypi/argon2-cffi/json"` — version 25.1.0, upload date, `project_urls`
- `uv run --with argon2-cffi==25.1.0 python3` — `PasswordHasher`/exceptions signatures, read via `inspect.signature`, and the local timing benchmark table
- `uv run python3 -c "inspect.signature(Response.set_cookie)"` against this repo's own installed `.venv` — exact Starlette cookie API
- Direct reads of this repo's own `src/morai/{settings,db/base,db/session,db/models,api/app,api/errors,money/units,money/api_types,api/models,telemetry}.py`, `pyproject.toml`, `tests/conftest.py`, `tests/gate/test_type_gate.py`, `tests/gate/fixtures/violation_unit_confusion.py` — this session
- `.planning/phases/02-identity-sessions-and-tenant-isolation/02-CONTEXT.md` — this session
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `REBUILD-BRIEF.md` (NN-1 through NN-45), `docs/learnings/vendors-and-infra.md` (V027, V028) — this session
- `.planning/phases/01-walking-skeleton/01-RESEARCH.md` and `SKELETON.md` — read in full, this session, for precedent and established conventions

### Secondary (MEDIUM confidence — WebSearch/WebFetch summary of official or semi-official sources)

- PostgreSQL mailing list thread introducing `current_setting`'s `missing_ok` argument, plus
  corroborating secondary write-ups — `missing_ok` fail-closed behavior
- `cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html` — fetched raw via curl
  this session; found session-ID *logging* guidance (salted-hash for log correlation) but not a direct
  storage-hashing statement — the storage-hashing recommendation in this document rests primarily on
  this project's own `NN-34` bearer-equivalent-secret principle, not a single OWASP quote, and is
  flagged as such rather than over-cited

### Tertiary (LOW confidence — this researcher's synthesis, not directly sourced)

- The `gate_user_scoped_probe` placeholder-table pattern (Assumption A1)
- The exact `SET LOCAL`-in-auth-dependency wiring shape, and the `after_begin` hardening as a
  documented-but-deferred upgrade (Assumption A3)
- World A as the recommended default cookie-attribute target (Assumption A2)

## Metadata

**Confidence breakdown:**
- The spike: HIGH — settled by a live read of the actual provisioned service's own variables, not
  inference from documentation alone, cross-checked against Railway's own docs fetched directly
- RLS vs. app-level scoping recommendation: HIGH on the *reasoning* (every comparison point is either
  a verified Postgres/SQLAlchemy mechanic or this project's own already-established precedent);
  MEDIUM on completeness, since multi-tenant RLS-in-production war stories were sampled via
  WebSearch, not exhaustively reviewed
- The superuser/BYPASSRLS *rule* (who RLS ignores, and that FORCE doesn't change it): HIGH — directly
  quoted from official Postgres documentation. That the live `postgres` role on this specific Railway
  instance actually has superuser status: MEDIUM — a two-step inference from verified facts, explicitly
  **not** a direct query against the live role (no connection was made this session); the plan owes
  one cheap query to close this before trusting the RLS design on top of it, per the caveat above
- Argon2id parameters: HIGH for the measured local numbers and the verified API; MEDIUM for how they
  translate to Railway's actual container, which is explicitly unmeasured and flagged as a required
  Wave-0-adjacent step
- The capability-object audit pattern: MEDIUM — the type-level guarantee is real and directly
  demonstrable against this repo's own existing gate-test pattern; the "does not compile" framing is
  deliberately not oversold beyond what a type checker can actually verify

**Research date:** 2026-08-31
**Valid until:** Railway-specific findings (pooling topology, template composition) — 7 days, same
practical reasoning as Phase 1's own Railway findings: an actively-developed platform whose pooling
feature itself is presented as a relatively new addition. Postgres RLS semantics, SQLAlchemy pooling
defaults, and the Argon2id API — 30 days, none of it is platform-dependent or showed any sign of
being mid-change.

---

## Orchestrator Addendum — CI's own Postgres user is a superuser too

The research above flags that Railway's `postgres` role is *probably* a superuser and that
this would make every RLS policy silently inert. The same hazard exists in CI, and there
it is not an inference — it is documented.

`.github/workflows/ci.yml` runs its Postgres service with
`DATABASE_URL=postgresql://morai:morai@localhost:5432/morai`, so `POSTGRES_USER=morai`.
The official Docker Postgres image's own documentation says, verbatim [VERIFIED: fetched
raw from `docker-library/docs`, this session]:

> ### `POSTGRES_USER`
> This optional environment variable is used in conjunction with `POSTGRES_PASSWORD` to
> set a user and its password. **This variable will create the specified user with
> superuser power** and a database with the same name.

**So an isolation test that connects to CI's Postgres as `morai` proves nothing.** RLS
would be bypassed for exactly the same reason as in production, every policy would be
inert, and the suite would still pass — because the application's own query filter would
mask the absence of enforcement. The test would be measuring the filter and reporting it
as the policy.

Consequences, both required:

1. **The CI isolation suite must create and connect as its own non-superuser role.** Do not
   test RLS through the container's default user. The suite needs two roles: the superuser
   to set up schema and policies, and a `NOSUPERUSER NOBYPASSRLS` role to run the
   assertions through.

2. **The suite must assert its own connection is not privileged**, before it asserts
   anything about isolation:

   ```sql
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
   ```

   Both must be false. Without this guard the suite can silently degrade — someone changes
   a fixture, the tests run as a superuser again, and a green suite now certifies an
   isolation guarantee that no longer exists. That is the same failure shape as Phase 1's
   worktree false-green, where a suite passed only because a gitignored `.env` was absent
   from the worktree, and it is worth guarding against explicitly rather than trusting a
   convention.

This makes CI a *stronger* proof of the RLS design than a smoke test against the deployed
service would be: in CI both roles are under the suite's control, so the negative case can
be asserted directly rather than merely hoped for.

---

## Orchestrator Addendum 2 — the recommended `SET LOCAL` pattern does not work

**Every `SET LOCAL app.current_user_id = :uid` example above is wrong and will not run.**
Corrected here rather than edited in place, so the reasoning that produced the error stays
visible. Measured against real Postgres in CI during plan 02-01, not inferred.

Postgres's `SET` is utility grammar, not a normal statement. Its right-hand side accepts a
literal or a keyword — never a bind parameter. Passing one raises, at execution:

    asyncpg.exceptions.PostgresSyntaxError: syntax error at or near "$1"

This is the load-bearing statement of the entire RLS design, so it would have failed on
first contact with a real database.

**Use `set_config` instead.** It is an ordinary function call, so it takes parameters
normally, and its third argument `true` gives exactly the transaction-scoped semantics
`SET LOCAL` was chosen for:

```python
await session.execute(
    text("SELECT set_config('app.current_user_id', :uid, true)"),
    {"uid": str(user_id)},
)
```

Read side is unchanged — `current_setting('app.current_user_id', true)`.

**The same grammar limit applies to `CREATE ROLE ... PASSWORD`,** which matters more,
because the obvious workaround there is an injection bug. Do **not** f-string the password
into the DDL. Pass it as a genuine bind parameter to Postgres's own `quote_literal()` and
embed only the server-escaped result, so the escaping is done by the server that will parse
it rather than by Python string formatting.

Both corrections are documented in `src/morai/identity/sessions.py`'s module docstring, at
the call site, so a later reader who copies from this research file finds the working form
in the code even if they miss this addendum. Plan 02-01's CI runs carry the red-then-green
evidence: `33358562048` failing, `33358848325` green with 83 tests passing.

**A third, smaller correction from the same wave.** `TypeAdapter(...).validate_python(response.json())`
rejects a UUID field's JSON string under `ApiModel`'s `strict=True`, because
`validate_python` applies `is_instance_of` semantics. Use `validate_json(response.content)`:
pydantic runs separate JSON-mode strict rules where a UUID's string form is correct rather
than a coercion to reject. This is the same class of trap as Phase 1's `Decimal`
`BeforeValidator` finding — strict mode means different things on the Python path and the
JSON path, and the API sits on the JSON one.
