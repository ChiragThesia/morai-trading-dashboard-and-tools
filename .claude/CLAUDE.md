<!-- GSD:project-start source:PROJECT.md -->

## Project

**Morai Journal**

A multi-user trading journal for delta-neutral SPX calendar and diagonal traders. Each user connects
their own Charles Schwab account, and the system ingests their fills, builds a correct P&L ledger
across rolls and settlements, and holds an immutable record of what they said they would do before
they did it. Built for its author and three or four friends who trade the same structure.

This milestone builds the **backend only**. No rendered UI. The API is designed to be consumed by a
mobile-friendly web app that gets designed separately once the backend is done.

**Core Value:** **The ledger is correct across rolls and settlements.** The sum of realised P&L over any window must
equal the broker's cash delta over that same window, net of transfers — checked every ingest cycle,
as a test. If that fails, no other number in the system is trustworthy.

### Constraints

- **Language, backend**: Python. Pydantic v2 models, `mypy --strict`. No `Any`, no `cast`, no bare
  `# type: ignore`. — The user's explicit instruction, and a typed boundary is the only cheap defence
  against the unit and direction bugs that cost v1 the most.

- **Language, frontend (future)**: TypeScript `strict`. No `any`, no `as` assertions, no `!`
  non-null assertions. — Same instruction. Recorded now so the UI phase inherits it.

- **Process**: Test-driven. Red → green, test written before implementation. — The user's explicit
  instruction. Reinforced by the record: v1 shipped production bugs past a green suite at least ten
  times, so tests are necessary and not sufficient.

- **Verification gate**: The 13-calendar oracle passes before any money code ships. — It is the only
  genuine oracle the old system produced, and its expected values were computed independently of the
  code under test.

- **Vendor**: `schwab-py`, pinned. Hypercorn in production, not uvicorn — it dual-stack binds `[::]`
  and uvicorn cannot from the CLI. — Measured in v1 production.

- **Vendor**: Token refresh takes a **per-user** single-writer lock. Concurrent refresh of the same
  token triggers `invalid_grant`. — v1 held one global lock for one user; five users need five locks,
  not one queue.

- **Vendor**: The Schwab refresh token expires after 7 days, server-side and hard. Re-auth recurs
  weekly, forever, per user. It must be self-service with a notification, not an operator runbook.

- **Security**: Envelope encryption, per-user data key wrapped by a master key outside the database.
  No cross-user view. Audit log on privileged reads.

- **Security**: An OAuth code and its redirect URL are bearer-equivalent secrets — never rendered,
  never logged, never echoed in an error (`NN-34`). The CSRF `state` is a single-use TTL'd
  server-side nonce consumed by one atomic `DELETE ... RETURNING`, not a string comparison (`NN-35`).

- **Correctness**: All 45 non-negotiables in `REBUILD-BRIEF.md` §3 apply. Load-bearing for the
  ledger: `NN-1` (every discriminating column in the composite key), `NN-8` (every money field's unit
  is named, never inferred), `NN-9` (direction from the vendor's own signed field), `NN-10` (never
  `abs()` a signed vendor amount), `NN-11` (order-anchor disambiguation, never a guess), `NN-16` (a
  gap is honest, never a fabricated value), `NN-5` (chunk batch inserts at ≤2,000 rows).

- **Cadence**: 30-minute RTH snapshot slots. This is a system-wide fact, not a tunable.
- **Hosting**: Railway containers plus Postgres. `NN-28`/`NN-29` were written against Supavisor and
  only carry forward if a Supabase pooler does.

- **Environment**: The repo sits on an iCloud-synced Desktop, which silently duplicates files with a
  ` 2` suffix and has already put one into git history. `V091` has the mechanism and the fix.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Python** | 3.12 or 3.13 | Runtime | `schwab-py`, `procrastinate`, and `mypy` 2.x all support 3.10+; 3.12/3.13 give faster asyncio and better error messages. No library in this stack forces a specific minor above 3.10. |
| **FastAPI** | 0.141.1 (PyPI, live) | HTTP API | Native Pydantic v2 request/response validation is the actual reason to pick it here — every route boundary becomes a forced parse point, which is exactly the choke point a no-`Any` policy needs. |
| **Pydantic** | 2.13.5 (PyPI, live) | Data validation / models | Already an explicit project constraint. v2's Rust core (`pydantic-core`) is fast enough that "validate everything at every boundary" is not a performance argument against. |
| **Uvicorn / Hypercorn** | Hypercorn 0.18.0 for prod; Uvicorn 0.52.4 for local dev only | ASGI server | See §10 below — this is not a routine choice, it is a Railway-specific correctness constraint. |

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **PostgreSQL** | 16 or 17 (Railway-provided) | Primary store + job queue backend | Already the project's stated database. Using it as the queue backend too (via Procrastinate, below) means one connection pool, one backup, one failure domain — not two infra dependencies. |
| **SQLAlchemy** | 2.0.52 (PyPI, live) — Core + `Mapped[]` declarative ORM, no legacy plugin | ORM / typed data access | See §4 below for the full argument. Short version: 2.0's native `Mapped[T]` annotations type-check under `mypy --strict` and basedpyright strict **without** the deprecated mypy plugin (removed in 2.1). |
| **asyncpg** | 0.31.0 (PyPI, live) | Postgres async driver under SQLAlchemy's `AsyncEngine` | Fastest mature async Postgres driver for Python; install as `sqlalchemy[asyncpg]`. `psycopg` 3.3.4 is the credible alternative — see Alternatives table. |
| **Alembic** | 1.19.1 (PyPI, live) | Migrations | The de facto SQLAlchemy migration tool; no serious alternative exists for SQLAlchemy 2.0 projects. |

### Background Jobs / Scheduler

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Procrastinate** | 3.9.0 (PyPI, live) | Postgres-backed job queue + cron | The direct Python equivalent of pg-boss. Postgres-only (no Redis), tasks enqueued transactionally with your data (`LISTEN/NOTIFY` + `FOR UPDATE SKIP LOCKED`), actively maintained, ships a CLI worker process (`procrastinate worker`) deployable as its own Railway service, and `app.periodic()` gives Unix-cron scheduling natively — a direct fit for the 30-minute RTH cadence. See §5. |

### Encryption

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **`cryptography`** | 50.0.1 (PyPI, live) — use `hazmat.primitives.ciphers.aead.AESGCM` directly, not `Fernet` | Envelope encryption (DEK wraps data, KEK wraps DEK) | See §6. AES-256-GCM is the actual primitive AWS/GCP KMS use internally for envelope encryption; Fernet is AES-128-CBC + HMAC, a fine general-purpose recipe but not the standard shape for a KEK/DEK key-wrap. |

### Auth

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **`argon2-cffi`** | 25.1.0 (PyPI, live) | Password hashing | Argon2id is the OWASP-recommended default over bcrypt for new systems (see §7 for parameters). |
| **`authlib`** | already a transitive dependency of `schwab-py` (`authlib>=1.6.0`) | OAuth2 primitives | Do not add it as a direct project dependency for the Schwab OAuth dance — `schwab-py` already wraps the pieces you need (see §1). Only reach for it directly if the app later needs its *own* third-party OAuth (e.g. Google sign-in), which is not in scope. |
| Postgres table, not a library | — | OAuth `state`/nonce storage, session storage | Already decided in `PROJECT.md`/`NN-35`: the CSRF `state` is a single-use, TTL'd, server-side nonce consumed by one atomic `DELETE ... RETURNING`. A plain table does this; no Redis, no signed-JWT nonce library needed. |

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **pytest** | 9.1.1 (PyPI, live) | Test runner | Already the ecosystem standard; no alternative considered. |
| **Hypothesis** | 6.166.0 (PyPI, live) | Property-based testing | The Python equivalent of fast-check named in the brief. v1 had 59 files of property tests judged worth keeping — Hypothesis is the only mature property-testing library for Python. |
| pytest fixtures + `@pytest.mark.parametrize` | (pytest itself) | The 13-fixture oracle suite | No new library needed. Load the 13 fixed fixtures (plus the synthetic negative control) as one parametrized test — `pytest.param(fixture, id=fixture.orderId)` — so a failing fixture reports by name, not by index. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `httpx` | (pulled in by `schwab-py`, `>=0.28.1`) | HTTP client | Already required transitively; don't add a second HTTP client. |
| `python-dotenv` or Railway's own env injection | — | Config | Railway injects env vars directly; a `.env` loader is only needed for local dev. |
| `pytest-asyncio` | 1.4.0 (PyPI, live) | Async test support | Needed the moment any test awaits an async SQLAlchemy session or a `schwab-py` async client call. |
| `ruff` | 0.16.5 (PyPI, live) | Lint + format | One tool, replaces flake8/isort/black; not asked for explicitly but is the current default and costs nothing to add. |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Database access | SQLAlchemy 2.0 typed ORM | SQLModel | SQLModel is a thin Pydantic-v1-flavored wrapper over SQLAlchemy 1.x-style declarative; its typing story lags SQLAlchemy 2.0 native `Mapped[]`, and mixing "SQLModel model = both ORM row and API schema" collides with wanting the ledger's stored shape (immutable fills) and its API shape (derived events) to be *different* types on purpose. Current version 0.0.42 — the `0.0.x` line after years of development is itself a signal of how unsettled its API still is. |
| Database access | SQLAlchemy 2.0 typed ORM | Raw `asyncpg` + hand-written row-mappers | Viable and was explicitly asked about. `asyncpg.Record` is dict-like and untyped (`Record.__getitem__` returns `Any`), so every query needs a hand-written `Row -> PydanticModel` mapper function at the boundary — which is exactly what SQLAlchemy's `Mapped[]` + `select()` already gives you for free, typed, with no plugin. Raw asyncpg is the right call only if the team wants zero ORM overhead and is willing to write (and keep in sync) a mapper per query; for a solo-plus-friends project, that's discipline with no payoff SQLAlchemy 2.0 doesn't already provide. |
| Postgres driver | `asyncpg` | `psycopg` 3 (3.3.4) | psycopg3 has full native async support and is SQLAlchemy's other first-class async driver. Choose psycopg3 instead if the team wants one driver that also has a good sync-mode story (e.g., for one-off scripts or the Alembic migration runner, which SQLAlchemy still often runs sync) — asyncpg has no sync mode at all. Either is a defensible pick; asyncpg is listed first because it's faster and is what the domain's own research (`salvage/`) already names as the ecosystem default. |
| Job queue | Procrastinate | `SAQ` | SAQ had a January 2026 release adding Postgres support alongside its original Redis backend, is reported faster than arq, and ships a web UI. But its Postgres backend is the newer, less-proven of its two brokers, versus Procrastinate's Postgres-only design from day one. Revisit if Procrastinate's throughput becomes a bottleneck — unlikely at this project's volume (a handful of users, 30-minute cadence). |
| Job queue | Procrastinate | `arq` | Explicitly avoid. Reported in maintenance-only status with users advised to migrate off it. Also Redis-based, which fails the "Postgres-only, no new infra" constraint outright. |
| Job queue | Procrastinate | `Celery` | Celery is the heaviest option (broker + result backend + worker + beat, usually RabbitMQ or Redis) and is overkill for 14-ish scheduled/triggered job types run by one small team. Only reconsider if the job graph grows to need Celery's canvas/chaining features Procrastinate doesn't have. |
| Job queue | Procrastinate | `APScheduler` | APScheduler is an in-process scheduler, not a distributed job queue — it has no durable job table, no `SKIP LOCKED` worker-safe dequeue, and no natural fit for "web process enqueues, separate worker process executes" on two Railway services. Wrong tool for this shape. |
| Type checker | basedpyright (strict) | mypy --strict | See §3. Recommend basedpyright as the **primary gate**; keep mypy in CI as a second, cheap check, since the two catch different edge cases and both are fast enough to run in the same pipeline. |
| Encryption primitive | `cryptography` AESGCM | `cryptography` Fernet | Fernet is the right call for "encrypt-and-forget" data blobs where you don't need to reuse the same key across many independent ciphertexts with your own nonce discipline. It's the wrong shape for a KEK/DEK envelope specifically because Fernet bakes in its own token format (versioned, timestamped, base64) that doesn't compose cleanly with "this ciphertext IS a wrapped key, store it as raw bytes in a `bytea` column." |
| Encryption primitive | `cryptography` AESGCM | Postgres `pgcrypto` | Rejected. `pgcrypto`'s `pgp_sym_encrypt`/`pgp_sym_decrypt` require passing the key into the SQL statement itself — the key transits the query log, `pg_stat_statements`, and any connection-level logging unless carefully suppressed. That directly conflicts with "audit log on privileged reads" and "a stolen dump yields no readable history" — if the key ever touched the database process, a dump plus a query-log leak both become live threats. Keep encryption entirely in the app layer; the DB only ever sees ciphertext. |
| Master key location | Railway env var (KEK held outside the DB, inside the app process's env) | A hosted KMS (AWS KMS / GCP KMS) | LOW confidence, architectural judgment, not a technology fact. A hosted KMS is unambiguously stronger (key never leaves the KMS, envelope-unwrap is an API call, rotation is a KMS-native operation) and costs about $1/month plus fractions of a cent per call. The reason not to reach for it *yet*: it adds a second cloud account, IAM policy surface, and network dependency (the app can't decrypt if AWS is unreachable) to a project explicitly scoped as "one trader plus three or four friends," and the project's own stated threat model (`PROJECT.md` Key Decisions) already excludes protecting against app-server compromise — only against a stolen DB dump/backup. An env-var KEK defeats exactly that threat. Revisit if the user base grows past a handful of trusted friends, or if "app-server compromise" enters the threat model. |
| Session storage | Postgres `sessions` table, opaque token in an `httpOnly`+`Secure` cookie, no signing library | Starlette `SessionMiddleware` / `starsessions` / `fastapi-sessions` | For 4-5 known users, a server-side session row (`user_id`, `expires_at`, `created_at`) looked up by an opaque random token (stdlib `secrets.token_urlsafe(32)`) gives instant, auditable revocation — delete the row, the session is dead everywhere — which a signed-but-unrevokable cookie (Starlette's default) does not give you without also maintaining a server-side denylist, at which point you've built the table anyway. Skip the middleware library entirely; this is a five-line dependency and a `sessions` table, not a package. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `schwab-py`'s `easy_client()` / `client_from_login_flow()` for the multi-user Schwab-connect flow | Both spin up a **local Flask server and/or open a browser on the machine running the process** to catch the OAuth redirect — an interactive, single-machine CLI pattern. It cannot work when the redirect needs to land on a FastAPI route serving many remote users. Confirmed from `schwab-py`'s own source: it depends on `flask` specifically for this. | `schwab.auth.get_auth_context()` to build the per-user authorize URL + state, then `schwab.auth.client_from_received_url()` inside your own FastAPI callback route, handing it a `token_write_func` closure that writes the encrypted token to that user's DB row. This is a real, documented, non-interactive function in `schwab-py` — it is exactly the low-level primitive this project needs, and it means no `authlib`/OAuth code needs to be hand-rolled. |
| One global token-refresh lock across all users | v1's own constraint (`PROJECT.md`) — one process, one user, one lock. `schwab-py`'s docs independently confirm the mechanism: "if the token file is shared between applications, one of them will beat the other to refreshing, locking the slower one out." Refresh races are a per-token problem. | A lock keyed **per user** (e.g. `pg_advisory_xact_lock(hashtext(user_id))` or a `SELECT ... FOR UPDATE` on that user's token row) around any refresh path. Five users need five independent locks, not one queue serializing all five. |
| SQLAlchemy's mypy plugin | Deprecated by SQLAlchemy itself, scheduled for removal in 2.1, and already reported broken on mypy ≥1.11. | SQLAlchemy 2.0's native `Mapped[T]` declarative typing, which needs no plugin. |
| `arq` | Reported in maintenance-only status; Redis-based, which the project doesn't otherwise need. | Procrastinate (Postgres-native). |
| Fabricating a value on a missing snapshot slot or a failed IV solve | Already a project law (`NN-16`), not a library choice — named here because the *type system* is how you enforce it: a snapshot row's price/greek fields should be `Decimal | None`, never defaulted to `0` or a carried-forward value, so "no data" is representable and `None`-handling is forced at every read site. | Model gaps as `None` in Pydantic/SQLAlchemy, not as sentinel numbers. |
| `float` anywhere in the money/greeks path | Standard float rounding error compounding across a ledger is the exact failure class this project exists to prevent. | `decimal.Decimal` end to end — see §9. |

## Numbered Findings (matching the research questions)

### 1. `schwab-py`

- **Current PyPI version: 1.5.1**, last uploaded 2025-06-30 (verified directly against the PyPI JSON API). This is the same version the deleted v1 system pinned — the library has not shipped a release since, and its GitHub repo shows continued commit activity and 38 open issues, so treat it as slow-moving but not abandoned. **Confidence: HIGH** (PyPI API is a primary source).
- **OAuth acquisition/refresh:** access tokens last 30 minutes and refresh automatically in-process; refresh tokens last exactly 7 days server-side, matching the project's own stated constraint, and cannot be extended — re-auth is unavoidable weekly, forever, per user.
- **Multi-user token storage:** the library supports **callable-based storage** via `client_from_access_functions(api_key, app_secret, token_read_func, token_write_func, asyncio=...)` — read/write closures instead of a fixed file path. This is the mechanism that makes multi-user work: give each user's client instance closures bound to that user's encrypted DB row, and there is no shared file to race on.
- **The multi-user OAuth handshake itself** cannot use `easy_client()`/`client_from_login_flow()` — see "What NOT to Use" above. Use `get_auth_context()` + `client_from_received_url()` instead; both are real, public, documented functions (verified against `schwab/auth.py` source).
- **`get_transactions`, `get_account_numbers` (account hash resolution), `get_option_chain`, `get_quote(s)`** are all synchronous-by-default methods (async available via `asyncio=True` on client construction) that return **raw `httpx.Response` objects**, not typed models. This is the single most important fact for the no-`Any` policy: `response.json()` types as `Any` in every Python type checker's stdlib stubs. **Every `schwab-py` call must be wrapped in a Pydantic `model_validate()` immediately at the call site** — this is the untrusted-input boundary for this entire project, and it is a hard boundary, not a style preference.
- **Async vs sync:** `asyncio=True` is supported across all client constructors; since FastAPI + SQLAlchemy async engine are both async-first, request `asyncio=True` clients so a slow Schwab call doesn't block the event loop.
- **Alternative/direct HTTP client:** not warranted. `schwab-py` already wraps auth, rate-limit-aware retry, and endpoint shapes that would otherwise need re-deriving from Schwab's raw API docs. The project's own `REBUILD-BRIEF.md` already pins it. **Confidence: HIGH** for version/API surface (verified against live source and official docs); **MEDIUM** for "no newer alternative is warranted" (a judgment call, not a vendor fact).

### 2. Web framework

- **FastAPI 0.141.1**, **Pydantic 2.13.5** — both verified live against PyPI. **Confidence: HIGH.**
- **No-`Any` configuration for Pydantic under strict mypy:** Pydantic's own mypy plugin synthesizes an `__init__` typed with `Any` for every field unless configured otherwise. Fix in `pyproject.toml`:
- **FastAPI-specific practice:** declare `response_model=` on every route (never return a bare `dict`), and never accept a request body typed as `dict[str, Any]` — always a Pydantic model. This turns every route boundary into the forced-validation point the untrusted-input rule wants.

### 3. Type checking: mypy --strict vs basedpyright strict

- **Recommendation: basedpyright strict as the primary gate, mypy --strict as a secondary CI check.** Confidence: MEDIUM (this is a reasoned synthesis of vendor docs, not a benchmarked head-to-head found in a single authoritative source).
- **The decisive difference for a hard no-`Any` policy:** pyright/basedpyright distinguish **explicit** `Any` (written directly, e.g. `x: Any`) from **implicit** `Any` (unannotated, which pyright calls `Unknown`) — and basedpyright adds two rules pyright itself doesn't have: **`reportAny`**, which flags *every expression* whose type resolves to `Any` regardless of where the `Any` came from (including from an untyped third-party call like `schwab-py`'s `response.json()`), and **`reportExplicitAny`**, which bans writing `Any` in source at all. mypy has no equivalent of `reportAny` — it can ban *writing* `Any` (`--disallow-any-explicit`) and ban *unannotated generics* (`--disallow-any-generics`, part of `--strict`) and warn on functions that *return* `Any` (`--warn-return-any`, part of `--strict`), but it cannot catch an `Any` that silently flows through an intermediate expression without ever being explicitly written or returned from a directly-checked function. Given that `schwab-py` is a major untyped-boundary source in this specific project, `reportAny` is the single feature that most directly serves the stated policy.
- **mypy strict-mode flags relevant here** (verified flag names, not all bundled into `--strict`): `--strict` itself bundles `disallow_any_generics`, `disallow_subclassing_any`, `warn_return_any`, plus the untyped-def family; `disallow_any_explicit` and `disallow_any_expr` are **not** in the `--strict` bundle and must be added by name if wanted alongside mypy.
- **Practical setup:** run both in CI (basedpyright is fast enough that this costs seconds), since they occasionally disagree on edge cases (e.g. SQLAlchemy 2.0's `Mapped[]` descriptors, `partial()`-wrapped functions) and a real bug caught by only one is still a caught bug.
- **Pydantic v2 / basedpyright conflict resolution without `cast`:** where a third-party stub genuinely under-types a return (this is expected from `schwab-py`), resolve with a Pydantic model boundary (`ModelXYZ.model_validate(response.json())`) rather than `cast()` — `model_validate` is itself the type-narrowing operation, and unlike `cast` it actually checks the shape at runtime instead of merely asserting it to the type checker.

### 4. Database layer

- **Recommendation: SQLAlchemy 2.0.52, native declarative `Mapped[T]` style, no mypy plugin.** Confidence: HIGH for "SQLAlchemy 2.0 native typing needs no plugin and works under mypy --strict" (official SQLAlchemy 2.0 docs, plugin deprecation confirmed independently via GitHub issue tracker); MEDIUM for "this is better than SQLModel/raw asyncpg for this project specifically" (architectural judgment).
- SQLAlchemy's own docs state the mypy plugin "is deprecated and will be removed in the SQLAlchemy 2.1 release"; the plugin "only works up until mypy version 1.10.1," so any project on a current mypy must not depend on it regardless of preference.
- A model declared with `Mapped[Decimal]`, `Mapped[str]`, `Mapped[datetime]` etc. gives correctly-typed attribute access with zero `Any` leakage on both mypy --strict and basedpyright strict, without stubs or a plugin — this is the load-bearing fact that settles the comparison against SQLModel (typing story trails SQLAlchemy 2.0 native) and raw asyncpg (would need a hand-written mapper doing the same job SQLAlchemy already does).
- **Async driver:** `sqlalchemy[asyncpg]` (asyncpg 0.31.0) for the `AsyncEngine`/`AsyncSession`. `Numeric` columns round-trip as `decimal.Decimal` by default (`asdecimal=True` is `Numeric`'s default) — this is what makes §9 work without extra configuration.
- **Migrations: Alembic 1.19.1.** No serious alternative in the SQLAlchemy ecosystem.

### 5. Background jobs / scheduler

- **Recommendation: Procrastinate 3.9.0.** Confidence: HIGH for "Procrastinate is Postgres-only with no Redis dependency and supports cron" (official docs, `App.periodic()` with Unix cron syntax including an optional 6th seconds column); MEDIUM for "it's the best fit versus SAQ/Celery/APScheduler for this project" (reasoned comparison, see Alternatives table).
- **Postgres-backed (no Redis):** Procrastinate, yes — by design, its only backend. **Not Postgres-backed:** Celery (broker-based, typically Redis/RabbitMQ), arq (Redis-only), APScheduler (in-process, no distributed backend at all). **Both:** SAQ, as of a January 2026 release, supports Postgres alongside its original Redis backend.
- **30-minute RTH cadence:** `app.periodic(cron="*/30 6,7,8,9,10,11,12,13 * * mon-fri")`-style Unix cron (adjust hours to RTH in the app's timezone handling) maps directly onto `App.periodic()`.
- **Per-job time budgets, batch commits:** these are patterns to implement inside the task function itself (a wall-clock deadline computed at task start, `ok`-return-early-on-budget-exhaustion, one DB transaction per batch) — no queue library provides this as a built-in; Procrastinate's job model just needs to tolerate a task that legitimately completes "successfully, but only partially done this cycle," which its normal task-success semantics already allow (return normally; the next cron tick picks up remaining rows via the same `WHERE ... IS NULL` pattern v1 used).
- **Railway deployment:** Procrastinate ships a CLI worker (`procrastinate worker`), runnable as a second Railway service pointed at the same Postgres database as the FastAPI web service — directly matching "web process and worker process as separate Railway services."

### 6. Encryption

- **Recommendation: `cryptography` 50.0.1, `hazmat.primitives.ciphers.aead.AESGCM` directly for both the KEK-wraps-DEK step and the DEK-encrypts-data step.** Confidence: HIGH for the library/version and for AES-GCM being the standard envelope-encryption primitive (this is literally how AWS KMS/GCP KMS implement envelope encryption internally, per vendor documentation of the pattern); MEDIUM for "AESGCM over Fernet" being the right call here specifically (reasoned, see Alternatives table) — both are legitimate `cryptography`-library primitives, not a vendor-vs-vendor claim.
- **Mechanics:** generate a random 256-bit DEK per user (`AESGCM.generate_key(bit_length=256)` or `os.urandom(32)`); encrypt trading data with the DEK (random 96-bit nonce per encryption, **never reused** — AES-GCM's security collapses under nonce reuse, store nonce alongside ciphertext); wrap (encrypt) that DEK with a single server-held KEK (from the Railway env var); store the wrapped DEK per user in the DB, never the raw DEK.
- **Master key location — Railway env var vs hosted KMS:** recommend env var *for now*, given this project's explicit threat model already excludes app-server compromise. See the Alternatives table entry above; this is the one recommendation in this file most likely to need revisiting as the user count grows. **Confidence: LOW-MEDIUM** — architectural judgment weighed against the project's own stated non-goals, not a technology fact.
- **Key rotation:** rotating the KEK means re-wrapping every user's DEK (cheap — one AESGCM operation per user, DEKs themselves never move); rotating a user's DEK means re-encrypting all of that user's stored ciphertext (expensive — budget it as an explicit, rare, offline operation, not something that runs live).
- **`pgcrypto`:** does not belong in this design — see "What NOT to Use." It is the wrong tool specifically *because* this project needs the key to never be visible to Postgres at all, and `pgcrypto`'s functions take the key as a SQL argument.

### 7. Auth

- **Password hashing: Argon2id via `argon2-cffi` 25.1.0.** OWASP's current published minimum is memory=19 MiB, iterations=2, parallelism=1; OWASP's higher-security band (relevant for a system protecting brokerage-linked accounts) is 128 MiB / 3–5 iterations, tuned so a single hash takes roughly 250–400ms on the actual production hardware — measure this on the real Railway container, don't copy a number measured on a laptop. **Confidence: MEDIUM** (multiple 2026 sources converge on the same OWASP baseline figures, but the "tune to 250-400ms" guidance is best-practice synthesis, not a single canonical spec).
- **Session management:** see "Alternatives Considered" — a Postgres `sessions` table with an opaque `secrets.token_urlsafe(32)` token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. No session library needed; this is a table and a dependency (FastAPI `Depends`) that looks the token up. **Confidence: MEDIUM-LOW** (architectural judgment sized for "4-5 known users," not a vendor recommendation — reconsider if the user count or session volume grows enough that a lookup-per-request becomes a real cost, at which point an in-memory cache in front of the same table, not a new library, is the fix).
- **OAuth state/nonce storage:** already decided in `PROJECT.md`/`NN-35` — a Postgres table, single-use, TTL'd, consumed by an atomic `DELETE ... RETURNING`. Carried forward, not re-researched.

### 8. Testing

- **pytest 9.1.1**, **Hypothesis 6.166.0** — both verified live against PyPI. **Confidence: HIGH.**
- **The 13-fixture deterministic oracle suite:** the idiomatic pytest pattern is one parametrized test function over the 13 (plus the 14th synthetic negative control) fixtures, each `pytest.param(fixture_data, id=fixture_data["orderId"])` so a failure reports by the real order ID, not a numeric index — and each fixture's independently-computed `openNetDebit`/`closeNetCredit` becomes the `assert actual == expected` on the pipeline's output. No new library — this is pytest's own `parametrize`, used as a fixed-oracle regression gate rather than a generative one.
- **Hypothesis vs the oracle suite are complementary, not competing:** Hypothesis property tests check invariants across a *generated* space (e.g. "for any valid fill sequence, sum of realized P&L equals broker cash delta"); the 13-fixture suite checks *specific, real, previously-wrong* cases stay right. Keep both.

### 9. Decimal handling

- **Postgres column type: `NUMERIC(p, s)`** (explicit precision/scale — do not leave it unconstrained as bare `NUMERIC`, which allows unbounded digits and defeats the purpose of declaring a scale at all). For USD cents-level money, `NUMERIC(14, 4)` gives headroom (10 integer digits, 4 decimal places) well past what a small account's P&L will ever need, while explicit scale still catches a garbage value at the column level.
- **Python type: `decimal.Decimal`**, everywhere in the money/greeks path — model fields, function signatures, arithmetic. Never `float`.
- **Round-trip:** SQLAlchemy's `Numeric` column type returns `Decimal` by default (`asdecimal=True` is the default), and both `asyncpg` and `psycopg3` natively support binding/returning `Decimal` for `NUMERIC` columns — no manual `str()`/`float()` conversion needed at the driver layer. Pydantic v2 validates `Decimal` fields natively, converting via `str(value)` internally (not via `float()`, which is what preserves precision) — use `Field(max_digits=..., decimal_places=...)` on any Pydantic model wrapping a money field so the same precision constraint exists in both layers. **Confidence: HIGH** for the SQLAlchemy/asyncpg/psycopg3 Decimal round-trip (official docs, well-established); **MEDIUM** for the exact `NUMERIC(14,4)` sizing (reasoned for this project's account size, not a vendor spec — resize if actual position sizes warrant it).
- One documented Pydantic pitfall to watch for across version bumps: there have been reports of precision-loss regressions in `pydantic-core`'s `Decimal` handling in some point releases — pin the exact patch version in the lockfile and add a round-trip unit test (`Decimal("123.4567") -> model -> Decimal("123.4567")`) as a canary, not a one-time check.

### 10. Containerisation on Railway

- **ASGI server: Hypercorn 0.18.0 in production; Uvicorn 0.52.4 is fine for local dev.** The original constraint (`V039`): Railway needs an IPv4 health check and an IPv6 private network simultaneously, and Hypercorn can bind both explicitly (`hypercorn --bind '[::]:8000'` dual-stack binds one socket that accepts both protocol families). **Update since v1:** Uvicorn has since (0.30.6+) grown an undocumented dual-stack workaround — `uvicorn app:app --host "" --port 8000` — but the project itself calls this "both not very explicit and can be challenging in some environments," it isn't in Uvicorn's documented CLI reference, and its behavior varies by OS/Python version. **Recommendation unchanged: Hypercorn for production** — its multi-bind is an explicit, documented feature (`Config.bind = ["[::]:8000"]` or repeated `--bind`), not an empty-string side effect. **Confidence: MEDIUM** (the original V039 mechanism is corroborated by multiple independent sources on Uvicorn's IPv6 history, and Hypercorn's documented multi-bind is confirmed against its own official docs; whether Railway's specific health-check behavior has changed since v1's measurement was not independently re-verified this session — if a fresh Railway health check test is cheap to run early in the rebuild, do it, since this is exactly the kind of platform detail that drifts).
- **Two-service split:** the FastAPI web process and the Procrastinate worker process deploy as two separate Railway services from the same repo/image, both pointed at the same `DATABASE_URL` — this is a standard Railway pattern (distinct start commands per service, e.g. `hypercorn app.main:app` vs `procrastinate --app app.tasks.app worker`), not a special integration.
- **Container base:** a slim official Python image (`python:3.12-slim`) with dependencies installed via `pip`/`uv` at build time is sufficient; nothing in this stack needs a compiled toolchain beyond what `cryptography`'s and `pydantic-core`'s prebuilt wheels already ship.

## Installation

# Core

# Dev / test / type-check

# Local dev server only (not production)

## Stack Patterns by Variant

- Use the callback URL registered with Schwab's developer portal pointed at the FastAPI route (e.g. `https://api.example.com/schwab/callback`), not a locally-bound redirect.
- Because `client_from_received_url()` only needs the *string* of the full received URL — it doesn't care whether the request that produced it came from a local machine or a public server.
- Use the same `get_auth_context()` / `client_from_received_url()` pair, keyed to that user, triggered by a self-service "reconnect Schwab" button plus a notification (email or in-app) when the stored token's age crosses ~6.5 days.
- Because re-auth is not a one-time setup step here — it recurs weekly, forever, per user, and must never require operator involvement (explicit project constraint).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `schwab-py` 1.5.1 | Python ≥3.9 (per its own metadata); this project targets 3.12/3.13 | No known incompatibility; `schwab-py` pins `httpx>=0.28.1`, `authlib>=1.6.0` — don't pin a lower `httpx`/`authlib` elsewhere in the lockfile. |
| SQLAlchemy 2.0.52 | `asyncpg` 0.31.0 via `sqlalchemy[asyncpg]` extra | Confirmed compatible; this is SQLAlchemy's own documented async driver pairing. |
| SQLAlchemy 2.0.x | mypy plugin | **Do not use** — deprecated, broken past mypy 1.10.1, removed entirely in SQLAlchemy 2.1. Use native `Mapped[]` typing instead. |
| Pydantic 2.13.5 | mypy 2.3.1 | Requires `[tool.pydantic-mypy]` config (`init_typed = true` etc., see §2) for the `--disallow-any-explicit` family of flags to pass on Pydantic models. |
| Procrastinate 3.9.0 | Python ≥3.10, PostgreSQL ≥13 | From Procrastinate's own stated requirements. |
| Hypercorn 0.18.0 | Any Railway container exposing both an IPv4 health-check port and the IPv6 private network | This is the specific combination `V039` names; re-verify against current Railway networking docs early in the rebuild, since platform behavior is the kind of fact most likely to have drifted. |

## Sources

- PyPI JSON API (`https://pypi.org/pypi/<package>/json`), queried live this session, for every version number in this file — HIGH confidence, primary source, not recalled from training data: `schwab-py`, `fastapi`, `pydantic`, `mypy`, `basedpyright`, `pyright`, `sqlalchemy`, `sqlmodel`, `asyncpg`, `psycopg`, `alembic`, `arq`, `saq`, `procrastinate`, `celery`, `apscheduler`, `dramatiq`, `cryptography`, `argon2-cffi`, `bcrypt`, `pytest`, `hypothesis`, `hypercorn`, `uvicorn`, `pytest-asyncio`, `ruff`.
- `schwab-py` official docs (`schwab-py.readthedocs.io/en/latest/auth.html`, `.../client.html`) — MEDIUM-HIGH confidence, official vendor documentation, fetched directly this session.
- `schwab-py` source (`schwab/auth.py` on GitHub, `main` branch) — HIGH confidence for the exact function list (`get_auth_context`, `client_from_received_url`, `client_from_access_functions`, etc.) and its `flask`/`authlib`/`httpx` dependency list (cross-checked against the PyPI `requires_dist` metadata for 1.5.1) — this is source code, not a summary.
- SQLAlchemy official docs (`docs.sqlalchemy.org/en/20/orm/extensions/mypy.html`, changelog) — MEDIUM-HIGH confidence for the mypy-plugin-deprecation claim.
- basedpyright official docs (`docs.basedpyright.com`, "new diagnostic rules" page) — MEDIUM confidence (via WebSearch summary of the docs, not a direct fetch of the page bytes; re-verify exact rule names — `reportAny`, `reportExplicitAny` — against the live docs before writing lint config).
- Procrastinate official docs (`procrastinate.readthedocs.io`) — MEDIUM confidence (WebSearch summary of docs pages) for cron syntax and Postgres-only architecture.
- Pydantic official mypy-integration docs (`docs.pydantic.dev/.../integrations/mypy/`) — MEDIUM confidence (WebSearch summary).
- OWASP Password Storage Cheat Sheet, cross-checked against multiple independent 2026 practitioner write-ups converging on the same Argon2id parameter bands — MEDIUM confidence (aggregated secondary sources, not a single direct fetch of the OWASP page itself this session).
- This project's own `salvage/measured-constants.md` and `REBUILD-BRIEF.md` — HIGH confidence, primary source, for every carried-forward v1 fact (`schwab-py` pin, the Hypercorn/uvicorn constraint, the per-user lock requirement, the 30-minute cadence).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
