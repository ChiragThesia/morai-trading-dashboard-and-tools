# Walking Skeleton — Morai Journal

**Phase:** 1
**Generated:** 2026-08-30

## Capability Proven End-to-End

A money value posted to the deployed Railway service is written to a Postgres `NUMERIC(14,4)`
column, read back by a fresh `SELECT`, and returned as a JSON string with identical digits — while
a separate worker process, against the same database, dequeues and completes a scheduled job.

There is no user-facing capability, and that is deliberate. This milestone builds the backend only;
no rendered UI ships. The ROADMAP's Phase 1 goal is written as a system outcome, not as a user
story, and no story was invented for it.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | Python 3.13, pinned via `.python-version` | The user's explicit instruction. The pin matters: the ambient interpreter on the build machine is 3.14.7, and a 3.14-vs-3.13 behaviour difference must not enter the build silently. |
| Framework | FastAPI 0.141.1 | Every route boundary becomes a forced Pydantic parse point, which is the choke point a no-`Any` policy needs. |
| Route contracts | Return type annotation, never the `response_model` keyword (D-11) | One declaration, two gates — basedpyright at build time and FastAPI at runtime. The keyword is invisible to the type checker. Supersedes `research/STACK.md` §2. |
| Request/response base | `ApiModel` with `strict=True, extra="forbid", frozen=True` (D-09, D-12) | Closes both real gaps: a coerced value and a silently-dropped extra field now raise. |
| Money type | `Usd` / `IndexPoints` `NewType` over `Decimal` (D-01) | Zero runtime cost, native Pydantic and SQLAlchemy support, no serializer plumbing. Arithmetic decays to `Decimal`, so every result is explicitly re-wrapped — each re-wrap is a place the unit is asserted. |
| Money on the wire | `Decimal` as a JSON **string** (D-03) | A JSON number is float64 in every browser. The future TypeScript client parses with a Decimal library, never `JSON.parse` alone. |
| Money at the API field | `StrictDecimalField` — `Annotated[Decimal, BeforeValidator]` accepting `Decimal` or `str`, rejecting `float` and `int` (R-02) | FastAPI routes request bodies through `validate_python` on a pre-parsed dict, never `validate_json`. Without this, the API's own response format fails to validate as its own request. Measured against FastAPI 0.141.1's source. |
| Money in SQL | `NUMERIC(14,4)`, column name suffixed `_usd` or `_pts` (D-04) | The only `NN-8` enforcement that reaches SQL, where no Python type is in play — and v1's `openNetDebit` bug lived in a value read straight out of SQL. |
| Data layer | SQLAlchemy 2.0.52 `Mapped[]` + asyncpg, no mypy plugin | Native typing under both checkers with no plugin; the plugin is deprecated and removed in 2.1. |
| Migrations | Alembic, single system of record, Procrastinate's own SQL wrapped in a revision | `procrastinate schema --apply` as a deploy step would be a second untracked migration path — the same shape as the duplicated-write bug this project avoids everywhere. |
| Job queue | Procrastinate 3.9.0 on `PsycopgConnector` (psycopg v3) | Postgres-only, no Redis. **No asyncpg connector exists**, so the worker holds its own pool, separate from the web process's `AsyncEngine`. |
| Type gate | basedpyright strict **with `reportAny` and `reportExplicitAny` set explicitly**, plus `mypy --strict` with `disallow_any_explicit` (D-05) | Measured: `typeCheckingMode: "strict"` alone reports zero errors on a file containing `Any`. Both checkers block. `reportAny` catches an `Any` flowing through an intermediate expression out of an untyped vendor call — which `schwab-py` will be in Phase 4. |
| Suppression policy | Rule code required by ruff `PGH003`, reason comment required by a test; `typing.Any` and `typing.cast` banned by name (D-06) | A valve exists for a genuinely wrong vendor stub, and using it costs a written reason visible in the diff. |
| Error responses | Opaque body carrying only an error marker and a request id (D-10) | Structurally cannot echo a secret, which is what `NN-34` wants. A validation error is the path most likely to have a token in scope. |
| Configuration | One `pydantic-settings` model, `extra="forbid"`, secrets typed `SecretStr` (D-15) | A missing variable kills boot and names the field instead of surfacing as a 500 on the first request that needs it. |
| Health check | `/health` liveness only, no database call (D-14) | Railway checks health only at deploy time, so a database-dependent `/health` costs a failed deploy. Reachability lives on a separate endpoint Railway does not probe. |
| Deployment target | Railway, two services from one repo, nixpacks builder, no Dockerfile (D-19) | Web: `hypercorn --bind '[::]:$PORT'`. Worker: `procrastinate worker`. Railway owns the base image, so `V092` records the Python version and base image alongside the bind result. |
| Address family | One `[::]` dual-stack bind, non-negotiable | **V039 re-measured and CONFIRMED.** Railway's public edge is IPv4-only (`healthcheck.railway.app` has no AAAA from three independent resolvers); Railway's private network is IPv6. One dual-stack socket serves both, which uvicorn's CLI could not do. A public `curl -6` failing is the expected control, not a reason to change the bind. Trap: `railway.app` returns Cloudflare AAAA records fronting the marketing site — dig the deployment edge, not the homepage. |
| Railway config | `.railway/railway.ts` Infrastructure as Code | Config-as-code is deprecated and **new services cannot opt into it at all**. Both services here are new. |
| Directory layout | `src/` layout, one installable package `morai`, submodules `api/`, `worker/`, `money/`, `db/`, managed by uv with a committed `uv.lock` (D-18) | pytest imports the installed package, so a test cannot pass by accidentally importing from the working directory. |
| Merge gate | GitHub Actions jobs `typecheck-basedpyright`, `typecheck-mypy`, `lint-ruff`, `test-pytest`, plus a branch ruleset on `main` with zero required approvals (D-16) | Public repo, so rulesets are available on the free plan and Actions minutes are unmetered. Separate job names give precise failure attribution and are the exact strings the ruleset references. Zero required approvals means `gh pr merge --squash --auto` closes the loop hands-off, which every later phase depends on. The ruleset is created only after all four checks are observed reporting — a required check that has never reported blocks every pull request forever, with no error. |
| Test database | **GitHub Actions `services: postgres`, pinned to major 18.** `docker-compose.yml` ships per D-17 but is unverified — Docker's daemon is broken on the authoring machine and Railway's Postgres is private-network-only, so there is no local database at all | Matches the live Railway Postgres (`ghcr.io/railwayapp-templates/postgres-ssl:18`, read 2026-08-30). A Railway TCP proxy was deliberately not created: widening the production database's attack surface to fix local tooling is the wrong trade. Rejected: testcontainers (a dependency plus Docker inside the test run) and a Railway dev database (cost, latency, shared mutable state). |
| Where each test runs | Pure-Python tests and the type gate run anywhere; DB-backed tests are `@pytest.mark.db` and run in CI; the authoritative money round-trip runs on the deployed Railway service | Follows from having no local database. `uv run pytest -m "not db"` is the local default. DB fixtures fail loudly rather than skipping — a silently-skipped round-trip test is the exact failure this phase exists to prevent. |

## Stack Touched in Phase 1

- [x] Project scaffold — uv, `src/` layout, pinned interpreter, ruff, both type checkers, pytest
- [x] Routing — `GET /health` and `POST /gate/money-roundtrip`, contracts by return annotation
- [x] Database — one real write and one real read, through Alembic-managed schema, proven in CI and again on real Railway Postgres
- [x] Background worker — a second process on its own pool, dequeuing and completing a real job
- [x] Deployment — two Railway services against the existing Postgres
- [x] CI and merge gate — four required checks and a ruleset that refuses a merge

No UI. There is no interactive element to wire, because this milestone ships no rendered client.

## Out of Scope (Deferred to Later Slices)

Recorded so a later phase does not re-litigate this one's minimalism:

- Accounts, sessions, tenant isolation, audit logging — Phase 2
- Envelope encryption, the plaintext column set, the real trade schema — Phase 3
- Schwab OAuth, per-user refresh locks, connection health — Phase 4
- Event derivation and the 13-calendar oracle — Phase 5
- `/ready` (database reachability, migration head, worker heartbeat freshness) — grows into Phase 4's connection-health endpoint
- A typed error envelope with machine-readable codes — Phases 2 and 4, which have real error cases
- A startup contract test asserting every settings field exists in Railway's variable list — needs a Railway API call in CI
- Moving the repository off the iCloud-synced Desktop (`V091`'s real fix) — Phase 1 takes the `.gitignore` bandaid instead
- Purging the two collision artifacts already in git history — needs a history rewrite, judged not worth it for two files
- Hypothesis property tests — Phase 5, when the ledger needs them
- Mutation testing — Phase 5 owns OPS-06
- A working local database. Docker is broken on this machine and the production Postgres is
  private-network-only. Repairing Docker, or exposing Railway Postgres publicly, are both out of
  scope. CI is the test database.

## Permanent Surface, Not Scaffolding

`/gate/money-roundtrip` and its `gate_money_probe` table are deliberate production surface for the
life of this phase, not a prototype. They are what prove OPS-03 on the deployed service rather than
only in CI. Phase 3 drops the table with an explicit migration when the real schema lands.

`tests/gate/` is a first-class directory. Every gate this phase installs ships with a fixture that
must fail — the same pattern as the oracle's fourteenth synthetic negative control.

## Two Criteria Met in Substance, Not in Literal Wording

Both are recorded in `01-RED-GREEN-EVIDENCE.md`; the ROADMAP is not edited.

**Criterion 4** asks for a value carrying more precision than a float can hold. `NUMERIC(14,4)` holds
at most 14 significant digits and a double carries about 15.95, so no such value exists inside the
column. Met by asserting bit-inexactness instead.

**Criterion 1** asks for the health check to answer over both IPv4 and IPv6 from one `[::]` bind.
Railway's public edge has no IPv6 at all, so the IPv6 half is proven over the private network, from
the worker to `http://<web>.railway.internal:$PORT/health` — which is the path the dual-stack bind
exists for.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of these decisions without altering them:

- Phase 2: a user logs in, stays logged in across a browser restart, and cannot see another user's data
- Phase 3: trading data is written and read back under a per-user key, and a netted ROLL cannot be stored
- Phase 4: a user connects their own Schwab account and repairs it themselves when the token dies
- Phase 5: events derived from seeded fills pass the 13-calendar oracle, with no broker connection
- Phase 6: fills land on a schedule, idempotently
- Phase 7: open/closed state, per-leg settlement, and rolled-position chains, computed from events
- Phase 8: every open position repriced on the 30-minute RTH cadence, with honest gaps
- Phase 9: realised P&L checked against the broker's cash delta, every cycle, as a test
- Phase 10: the pre-commitment record, immutable once the position opens
- Phase 11: the review API surface
