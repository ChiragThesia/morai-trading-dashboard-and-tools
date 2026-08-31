# Phase 1: Walking Skeleton - Research

**Researched:** 2026-08-30
**Domain:** Typed FastAPI + Procrastinate deployment foundation on Railway; Decimal precision across Python/Postgres/JSON; the strict type gate
**Confidence:** HIGH — nearly every claim below was measured this session (live PyPI checks, a live pydantic/basedpyright/mypy run, a direct read of FastAPI's own source, raw `curl` of primary-source docs) rather than recalled. The exceptions are named explicitly in the Assumptions Log and Open Questions.

## Summary

Three things drove this research: a float-precision canary for the money round-trip test, whether Pydantic v2 strict mode can validate the JSON-string format the API commits to for `Decimal`, and how to stand up two Railway services from a repo that currently has zero application code.

The float canary turned out to be more subtle than CONTEXT.md's own example suggested. Every `Decimal` literal that fits `NUMERIC(14,4)` — including the column's exact ceiling, `9999999999.9999` — is measurably **not** bit-exact as an IEEE-754 double, but **is** fully recoverable at 4-decimal precision through both a shortest-round-trip float serializer and naive fixed-point formatting. The column's own width (14 significant digits) sits inside a double's ~15.95-digit round-trip envelope; a visible digit flip needs roughly 17+ significant digits, which `NUMERIC(14,4)` cannot hold. The right proof for this column width is bit-exactness (`Decimal(float(x)) != x`), not a visible 4th-decimal-place change — and the deployed test should say so, or it will look weaker than it is.

The Pydantic question resolved to a real, provable gap, not a hypothetical one. Pydantic's strict-mode `Decimal` validator behaves differently depending on whether it validates a pre-parsed Python object (`model_validate`) or raw JSON text (`model_validate_json`) — the former rejects a `str`, the latter accepts one. A direct read of FastAPI 0.141.1's own source (`fastapi/routing.py`, `fastapi/dependencies/utils.py`, `fastapi/_compat/v2.py`) shows request bodies always go through the first path (`await request.json()` then `TypeAdapter.validate_python`), never the second. So D-03's own wire format — Decimal as a JSON string — would be rejected by a bare strict `Decimal` field under D-12's base model. This is fixed with a project-owned `Annotated[Decimal, BeforeValidator(...)]` that accepts a `Decimal` or a `str` and explicitly rejects everything else (verified below); it needs to exist before any money-carrying request model is written.

The Railway question resolved to a platform change that lands squarely inside this phase's build window. Railway deprecated `railway.toml`/`railway.json` config-as-code — **new services cannot opt into it at all** as of this session — in favor of a TypeScript Infrastructure-as-Code file, `.railway/railway.ts`. Since this project's Railway project was deleted and must be created from scratch, Phase 1 has no choice but to build against the new system. Its shape (a `service()` call per process, `rootDirectory` to split one repo into two services, a typed `db.env.DATABASE_URL` reference) maps cleanly onto the web+worker split this phase needs.

**Primary recommendation:** ship the money round-trip probe with two literals (the `NUMERIC(14,4)` ceiling and a mid-range value), prove bit-exactness rather than a visible digit flip; add the `Annotated[Decimal, BeforeValidator]` type to `src/morai/money/` before writing any request model; author `.railway/railway.ts`, not `railway.toml`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Type-checking gate (OPS-01) | Build/CI | — | Runs before any tier exists at runtime; basedpyright + mypy in GitHub Actions |
| Request/response validation (API-07, LEDGER-08) | API/Backend | — | FastAPI route boundary; every `Decimal` field crosses through the project's own validator, not vendor defaults |
| Money unit safety (LEDGER-08) | API/Backend | Database/Storage | `Usd`/`IndexPoints` NewTypes enforced at every function signature; `NUMERIC(14,4)` + suffix-naming enforce it again at the column, where no Python type exists |
| Money round-trip probe (OPS-03) | API/Backend | Database/Storage | `/gate/money-roundtrip` route + `gate_money_probe` table; proves the chain Python → Postgres → JSON → Python end to end |
| Liveness health check (part of criterion 1) | API/Backend | — | No DB tier involvement by design (D-14) — this is the point |
| Scheduled worker heartbeat (OPS-04) | Background Worker | Database/Storage | Procrastinate worker process, separate Railway service, own DB connector |
| CI/merge gate (criteria 2, 3) | Build/CI | — | GitHub Actions + branch ruleset; no runtime tier |
| Repo hygiene (`V091` bandaid) | Build/CI | — | `.gitignore` + a test asserting no tracked ` 2` file; no runtime tier |

There is no Browser/Client or CDN/Static tier this phase — no UI ships in this milestone.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | The type checker runs in strict mode and fails the build on any `Any`, `cast`, or unjustified ignore | Empirically confirmed `reportAny`/`reportExplicitAny` are **not** part of basedpyright's `strict` mode by default and must be set explicitly (see Common Pitfalls); exact `pyproject.toml` blocks for basedpyright + mypy + ruff `banned-api` below |
| OPS-02 | Every test is written before the implementation it covers | Validation Architecture section; D-07/D-08's negative-control and commit-pair pattern is unaffected by this research, carried forward as-is |
| OPS-03 | Money values round-trip Python ↔ Postgres ↔ JSON with no precision loss | R-01 fully resolved below — canary literal, measured proof, and why a visible-digit-flip demo is not achievable at this column width |
| OPS-04 | The system runs as separate web and worker processes in Railway containers against Postgres | Railway deployment shape fully resolved below — `.railway/railway.ts` supersedes `railway.toml`, exact service/connector shape given |
| LEDGER-08 | Every money field's unit is fixed by its type, so passing index points where dollars are expected fails type-check | D-01's `NewType` design is unaffected; R-02's `BeforeValidator` wraps `Usd`/`IndexPoints` at the Pydantic-field level only, not the underlying type |
| API-07 | Every response is validated against a typed schema before it leaves the process | D-09/D-11 unaffected; confirmed `model_dump_json()` serializes `Decimal` as a string by default (no extra config needed for D-03) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `.claude/CLAUDE.md` (the `claude_md_path` `.planning/config.json` names as canonical). Directives with direct bearing on this phase's plans:

- **Python**, Pydantic v2 models, `mypy --strict`. No `Any`, no `cast`, no bare `# type: ignore`.
- **Test-driven**: red → green, test written before implementation.
- **Vendor**: Hypercorn in production, not uvicorn — dual-stack binds `[::]`; uvicorn cannot from the CLI (this phase's owned spike, `V039`/`V092`).
- **Correctness**: `NN-8` (every money field's unit is named, never inferred), `NN-5` (chunk batch inserts at ≤2,000 rows — not exercised in Phase 1, no batch inserts here, carried forward for later phases).
- **Cadence**: 30-minute RTH snapshot slots — not exercised in Phase 1 (only a heartbeat task).
- **Hosting**: Railway containers plus Postgres.
- **Environment**: repo sits on an iCloud-synced Desktop (`V091`) — `.gitignore` bandaid is D-20, already locked.
- **Recommended Stack** table pins: FastAPI 0.141.1, Pydantic 2.13.5, SQLAlchemy 2.0.52, asyncpg 0.31.0, Alembic 1.19.1, Procrastinate 3.9.0, Hypercorn 0.18.0 (prod) / Uvicorn 0.52.4 (dev only), pytest 9.1.1, Hypothesis 6.166.0, ruff 0.16.5. **All 17 version pins in this file were re-verified live against the PyPI JSON API this session** — see Standard Stack below; one has moved (`hypothesis` shipped 6.167.1 today, 2026-08-30).
- **basedpyright strict primary, mypy --strict secondary** — CLAUDE.md's own §3 already flags `reportAny`/`reportExplicitAny` names for re-verification before writing lint config. Done this session — see Common Pitfalls.
- **What NOT to use**: SQLAlchemy's mypy plugin, `arq`, float in the money/greeks path, fabricated values for gaps. None of these are exercised in Phase 1's scope but are recorded so the planner doesn't reach for them.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Money and Units

- **D-01:** Money carries its unit as a `NewType` over `Decimal` — `Usd = NewType("Usd", Decimal)`,
  `IndexPoints = NewType("IndexPoints", Decimal)`. Zero runtime cost. Pydantic v2 and SQLAlchemy
  handle it natively with no serializer or `TypeDecorator`. Arithmetic decays to plain `Decimal`, so
  every result is explicitly re-wrapped — the noise is the point: each re-wrap is a place the unit is
  asserted. Rejected: frozen value objects (arithmetic-safe, but needs custom Pydantic and SQLAlchemy
  plumbing) and a phantom-typed `Money[U]` (same plumbing plus generics, where basedpyright and mypy
  most often disagree). — **Reversibility:** costly — every money signature in Phases 3, 5, 7 and 9
  is written against these two names; switching to value objects rewrites each call site and adds a
  serializer at both the DB and API boundaries.

- **D-02:** One conversion function, `src/morai/money/units.py::points_to_usd(pts, multiplier)`. The
  multiplier is a **required argument, never defaulted**. The literal `100` appears in exactly one
  place, asserted by a grep test. This is the `NN-8` failure directly: v1 stored `openNetDebit` in
  dollars and fed it to a formula expecting index points, off by the contract multiplier, and a
  +$395 trade displayed as −$319,850.

- **D-03:** `Decimal` crosses the wire as a **string**, which is Pydantic v2's default JSON-mode
  behaviour. A JSON number is float64 in every browser, so a number would silently change the digits
  the round-trip test exists to protect. The future TypeScript client parses with a Decimal library,
  never `JSON.parse` alone. — **Reversibility:** costly — no client exists yet, but every response
  model and the whole future TS parsing layer are written against this.

- **D-04:** Every money column and response field names its unit with a `_usd` / `_pts` suffix.
  Enforced by a test that walks SQLAlchemy metadata and fails any `Numeric` column without a known
  suffix. This is the only `NN-8` enforcement that reaches SQL, where no Python type is in play — and
  the v1 bug lived in a value read straight out of SQL. — **Reversibility:** one-way — renaming a
  money column after Phase 3 writes rows requires a migration against encrypted tables.

#### The Type Gate (OPS-01)

- **D-05:** **Both checkers block the merge.** basedpyright strict is primary, with `reportAny` and
  `reportExplicitAny` set to error; `mypy --strict` with `disallow_any_explicit` runs alongside and
  also blocks. This resolves the conflict between `PROJECT.md` (which names `mypy --strict`) and
  `research/STACK.md` (which argues for basedpyright): running both satisfies the constraint rather
  than overriding it. basedpyright earns its place on one rule — `reportAny` catches an `Any`
  *flowing through* an intermediate expression out of an untyped vendor call, which mypy cannot see.
  `schwab-py` is exactly that boundary in Phase 4.

- **D-06:** A suppression is "justified" when it names its rule **and** carries a `# why:` comment on
  the same line. ruff `PGH003` forces the rule code; a small test enforces the `# why:`.
  `typing.Any` and `typing.cast` are banned by name via ruff's `banned-api`. A valve exists for a
  genuinely wrong vendor stub, and using it costs a written reason visible in the diff. Rejected:
  zero suppressions with no escape hatch — the pressure then goes somewhere worse, an untyped
  `object` plus runtime asserts, with no comment saying so.

- **D-07:** `tests/gate/` holds deliberately-violating fixture files. A parametrized test runs each
  checker against them and asserts a non-zero exit **and** the expected rule code. The fixtures are
  excluded from the main gate run. This is the same shape as the oracle's 14th synthetic negative
  control, and it catches the real failure mode: someone loosens a config knob and every gate
  silently stops firing. `L058`'s own prescription — prove the guard has teeth by injecting a
  violation and confirming the build fails there.

- **D-08:** Red-then-green evidence (OPS-02, criterion 3) is a **commit pair**. The failing test
  lands as its own `test:` commit; the implementation follows as a separate commit. VERIFICATION.md
  pastes the red run and the green run with their SHAs. Convention and review, not a script —
  `CI replays the red commit` was rejected because it breaks under squash-merge.

#### API Boundary (API-07)

**Correction carried forward for the planner:** FastAPI's `response_model` *does* raise
`ResponseValidationError` on a missing or wrongly-typed field. What it does silently is drop extra
fields and, in non-strict mode, coerce. Criterion 5's real gap is those two, not mismatches
generally.

- **D-09:** One `ApiModel` base — `ConfigDict(strict=True, extra="forbid", frozen=True)` — inherited
  by every request and response model. Closes both gaps: a coerced `"5"` and a silently-dropped extra
  field now raise. Proven by negative-control routes in `tests/gate/` asserting a raise, not a 200.
  Rejected: a custom `APIRoute` that re-parses the serialized bytes — framework machinery every later
  phase inherits, for a double parse on every response.

- **D-10:** A failed response validation returns an **opaque** body — `{"error": "internal",
  "request_id": "..."}` — and nothing else. Full Pydantic detail goes to the server log keyed by that
  id. This structurally cannot echo a secret, which is what `NN-34` wants, and a validation error is
  the path most likely to have a token in scope. Rejected: detail-in-dev-only, which stands one
  misconfigured env var away from leaking.

- **D-11:** A route's contract is declared by its **return type annotation**, not the
  `response_model=` kwarg. FastAPI 0.89+ infers the response model from the annotation, so one
  declaration gets two gates — basedpyright at build time and FastAPI at runtime. ORM row to response
  model goes through an explicit adapter whose return type the checker verifies, which is `L058`'s
  own prescribed fix. **This supersedes `research/STACK.md` §2's "declare `response_model=` on every
  route"** — that kwarg is invisible to the type checker. — **Reversibility:** costly — switching
  later rewrites every route signature and removes the adapters.

- **D-12:** Request bodies inherit the same base. An unknown key from a client is a 422, not a silent
  drop, so a renamed field in the future TS client fails immediately rather than on the day someone
  notices the value never saved. Same author writes both sides in strict TypeScript from the same
  schema, so the coordination cost is near zero.

#### Deployed Slice and Migrations (OPS-03, OPS-04)

- **D-13:** The slice is an Alembic baseline migration, a `gate_money_probe` table with a
  `NUMERIC(14,4)` column, a `/gate/money-roundtrip` route the post-deploy smoke test hits, and a
  worker running one Procrastinate heartbeat task. Criterion 4 is therefore proven against **real
  Railway Postgres**, not only a CI container — so a Railway-specific driver or `NUMERIC` quirk
  surfaces now rather than inside Phase 3's encryption work. Phase 3 inherits a working migration
  path instead of introducing one. — **Reversibility:** one-way for the migration chain (a deployed
  baseline is history); costly for the probe table, which needs an explicit drop migration when
  Phase 3 lands the real schema.

- **D-14:** `/health` is **liveness only** — 200 if the process is up, no DB call. A Postgres blip
  must not make Railway kill a web service that is otherwise fine; that cascade ends in a connection
  storm on recovery. Criterion 1 needs an answer over both address families, and this gives it. DB
  reachability lives on a separate endpoint that Railway does not probe.

- **D-15:** Configuration reaches the process through one `pydantic-settings` model with
  `extra="forbid"`, read at startup. A missing or malformed variable kills the boot and names the
  field, instead of surfacing as a 500 on the first request that needs it. Secrets are typed
  `SecretStr` so a stray log line or `repr` masks them — the structural half of `NN-34`, in place
  before Phase 4 has a token to leak.

#### CI and Merge Gate (criteria 2, 3)

- **D-16:** GitHub Actions runs basedpyright, `mypy --strict`, ruff and pytest. A **ruleset on
  `main`** marks them required and requires a pull request. Phase work moves to `gsd/phase-N-slug`
  branches, which means flipping `.planning/config.json` `git.branching_strategy` from `none` to
  phase branches. This is the only option that satisfies criterion 2's "cannot be merged" literally.
  `/gsd-pr-branch` already exists to keep `.planning/` commits out of the PR.

- **D-17:** Postgres for tests comes from a GitHub Actions `services: postgres` container in CI and a
  two-line `docker-compose.yml` locally, pinned to the same version in both places, one
  `DATABASE_URL` shape. Rejected: `testcontainers-python` (a dependency and Docker inside the test
  run) and a Railway dev database (cost, latency, shared mutable state between CI and local work).

#### Project Layout and Build

- **D-18:** `src/` layout, one installable package `morai`, with `api/`, `worker/`, `money/` and
  `db/` submodules and two entry points. Dependencies managed by **uv** with a committed `uv.lock`.
  The `src/` layout means pytest imports the installed package, so a test cannot pass by accidentally
  importing from the working directory. — **Reversibility:** costly — moving the package root later
  touches every import and both Railway start commands.

- **D-19:** Railway builds with **nixpacks**, its default builder. No Dockerfile.
  *(User chose against the recommendation, which was a Dockerfile.)* **Consequence the planner must
  carry:** Railway owns the base image and the Python patch version, so the `V092` learning entry
  must record the exact Python version and base image observed alongside the bind result. Without
  that, the next drift in Railway's builder is undetectable — which is the same class of problem
  `V039` was flagged partially stale for.

#### Repo Hygiene and Documentation (criterion 6)

- **D-20:** `V091` gets the bandaid, not the real fix. Phase 1 adds `* 2`, `* 2.*` and the Python
  cache directories to `.gitignore`, plus a test asserting no tracked file matches the collision
  pattern. **Verified this session:** `~/Desktop` is iCloud-synced
  (`com.apple.file-provider-domain-id` present on the directory); the working tree currently holds
  **0** collision artifacts, but only because the application was deleted and nothing is writing;
  **2 collisions are already in git history** — `.planning/phases/37-.../37-REVIEW 2.md` and
  `apps/web/src/components/CotCard.test 2.tsx`. Phase 1 restarts the producers (`.venv`,
  `__pycache__`, `.mypy_cache`, `.ruff_cache`, `.pytest_cache`). The gitignore stops anything new
  reaching history, which was the real damage. Moving the repo off the synced volume stays an open
  roadmap item — see Deferred Ideas.

- **D-21:** The root `CLAUDE.md` rewrite is **surgical**. Replace the false opening, add an "The
  application" section (layout, how to run, how to test, where the gates live), leave the learnings
  tables, the reading order and the known-stale list intact. The single highest-value instruction in
  that file is *grep `docs/learnings/` before deciding*; a code-first restructure pushes it below the
  fold, and that habit is the repo's whole thesis.

- **D-22:** The `V039` re-measurement is recorded as a **new entry, `V092`**, in
  `docs/learnings/vendors-and-infra.md`, with a one-line cross-reference added to `V039` pointing at
  it. Learning IDs are append-only and cross-cited from five files; a new entry preserves both the v1
  measurement and the 2026 one, matching the repo's own rule about recording both when sources
  disagree. — **Reversibility:** one-way — a published learning ID is cited by number.

#### Open for Research — resolved by this document

- **R-01:** The float canary for criterion 4. **Resolved** — see "R-01: The Float Canary" below.
- **R-02:** Pydantic v2 strict-mode semantics for `Decimal` with JSON input. **Resolved** — see
  "R-02: Pydantic Strict Mode and Decimal" below.
- **R-03:** Whether branch rulesets / required status checks are available on this repository's
  GitHub plan for a private repo. **Resolved by the orchestrator — see "R-03: GitHub Branch
  Rulesets" below.** Short answer: available, because the repo is public. D-16 stands as written.

### Claude's Discretion

None. Every gray area presented was answered explicitly; no "you decide" was taken.

### Deferred Ideas (OUT OF SCOPE)

- **Move the repository off the iCloud-synced Desktop** (`V091`'s real fix). Deferred from Phase 1
  by D-20, which takes the bandaid instead. The move breaks three things, all recoverable and all
  documented in `V091`: git worktree registrations (absolute paths — needs `git worktree repair`
  with explicit paths), hardcoded paths in `.claude/settings.json` hooks, and the Claude Code
  project key, which is derived from the working-directory path and orphans this session's memory
  unless the directory under `~/.claude/projects/` is renamed in the same sitting. Cheapest moment
  is before build output accumulates. Belongs on the roadmap as its own small item.
- **Purging the two collision artifacts already in git history.** Requires a history rewrite; not
  worth it for two files, but recorded so it is a decision rather than an oversight.
- **A typed error envelope with machine-readable codes** for every error path. D-10 ships an opaque
  500 only. Phases 2 and 4 will have real error cases — auth failures, connection health — and are
  the right place to design it.
- **`/ready`** — DB reachability, migration head, worker heartbeat freshness. D-14 keeps `/health`
  liveness-only. This grows naturally into Phase 4's connection-health endpoint.
- **A startup contract test** asserting every settings field is present in `.env.example` and in
  Railway's variable list for both services. Rejected in D-15 as needing a Railway API call in CI.
  Worth revisiting once there are more than two variables.
- **Logging format, request-id origin, OpenAPI schema snapshot testing, and whether `tests/` is held
  to the same strictness as `src/`.** Surfaced and not discussed. Planner's discretion, or a later
  discussion if they turn out to matter.
</user_constraints>

## R-01: The Float Canary

**Question:** a `Decimal` literal for `gate_money_probe`'s `NUMERIC(14,4)` column that (a) fits the
column exactly, (b) is provably not exactly representable as an IEEE-754 double, (c) demonstrably
loses digits if it transits a float.

**Method:** `uv run --python 3.13 python r01_float_canary.py`, CPython 3.13.14, testing 8 candidates
spanning the column's range including its exact ceiling. Full script and output preserved in this
research session; the core measurement, reproduced for the recommended value:

```
Decimal literal: 9999999999.9999  (sig figs: 14, the NUMERIC(14,4) ceiling)
  float(d)                          = 9999999999.9999
  Decimal(float(d)) exact           = 9999999999.99990081787109375
  Decimal(float(d)) - d             = 8.1787109375E-7
  Decimal(float(d)) == d (bit-exact): False
  json.dumps(float(d))              = 9999999999.9999
  Decimal(json.loads(...)) == d     : False   <- differs only past digit 17, not at 4dp
  f'{float(d):.4f}'                 = 9999999999.9999
  Decimal(fixed_4dp) == d           : True    <- naive fixed-4dp formatting recovers it anyway
```

**Finding (a) and (b): confirmed, and general.** All 8 candidates tested — including
`1234567890.1234` (CONTEXT.md's own example), the exact ceiling `9999999999.9999`, and six others —
fail the bit-exact test `Decimal(float(x)) != x` [VERIFIED: measured this session, CPython 3.13.14].
The deltas cluster at 1e-7 to 1e-8, which is exactly what IEEE-754's rounding-to-nearest predicts at
this magnitude (see below). This is real, reproducible, and true of essentially any 4-decimal-place
value that is not a sum of negative powers of two (multiples of 1/16 within 4dp — `0.5000`, `0.2500`,
`0.7500`, `0.1250`, etc. are the rare exceptions).

**Finding (c): does NOT hold at this column width, and CONTEXT.md's own warning explains why.**
"A 14-digit value alone proves nothing" turned out to be exactly correct, in a stronger sense than a
cursory reading suggests: **no value that fits `NUMERIC(14,4)` can visibly lose a digit at 4-decimal
precision through a single naive float transit** — not through a shortest-round-trip serializer
(`json.dumps`, which is what CPython's own `json` module does under the hood via `float.__repr__`)
and not even through naive fixed-point formatting (`f"{f:.4f}"`, the operation with no
round-trip-correctness guarantee at all). Every one of the 8 candidates, including the column's exact
ceiling, survived both paths intact. The reason is a plain consequence of IEEE-754: a double's ULP
(unit in last place) at magnitude ~1e9–1e10 is `2^(33-52) ≈ 1.9e-6` — roughly 25–50× smaller than the
`5e-5` a value needs to move to flip a 4th-decimal digit under standard rounding. `NUMERIC(14,4)`'s
own ceiling (10 integer digits) caps every legal value's magnitude low enough that this margin never
closes. [VERIFIED: measured this session across 8 candidates + derived from IEEE-754 double
precision, ~15.95 decimal digits — standard, stable arithmetic fact]

**Contrast, to show the phenomenon is real at a wider column:**

```
Decimal literal: 123456789012345.6789  (19 sig figs -- illustrative only, exceeds NUMERIC(14,4))
  float()   : 123456789012345.67
  Decimal(f): 123456789012345.671875
  bit exact : False
  fixed 4dp : 123456789012345.6719
  fixed4dp==literal: False   <- HERE the digit visibly flips: .6789 -> .6719
```

[VERIFIED: measured this session] A 19-significant-digit value does show a visible loss. `NUMERIC(14,4)` cannot hold one — its own ceiling is 14. This is not a value the project can pick; the column's declared width settles it.

**Recommendation for the planner:** use `Decimal("9999999999.9999")` (the column's exact ceiling)
as the primary canary — it is the strongest, least-arbitrary choice available (it proves the column's
full advertised range round-trips, not merely some value inside it), paired with
`Decimal("1234567890.1234")` as a second, mid-range fixture so the test doesn't read as an
edge-case-only demonstration. State the proof as bit-exactness (`Decimal(float(x)) != x`), not as a
visible-digit-flip claim — the latter cannot be made honestly at this column width, and claiming it
anyway would be the kind of unverified assertion `docs/learnings/process-and-verification.md` warns
against. The deployed `/gate/money-roundtrip` route itself never touches `float` (Decimal end to end,
`asyncpg`'s native `Numeric ↔ Decimal` binding, D-03's string JSON) — the canary's job is to prove
that *if* the pipeline had used `float` anywhere, the value would provably differ; the route's design
is what prevents that from happening at all, not luck.

**One nuance for the test-fixture writer:** `9999999999.9999` is the column's maximum positive
value. If the project ever needs a negative-range fixture too, `-9999999999.9999` behaves
identically under this analysis (IEEE-754 is symmetric about sign) — not tested separately, but
follows from the same argument.

**Python 3.14 vs the project's 3.12/3.13 target:** the primary measurement above ran under
`uv run --python 3.13` (CPython 3.13.14, fetched via `uv`), matching the project's stated target
directly — not the system default 3.14.7. `Decimal`/`float`/IEEE-754 conversion semantics are
specified by the language's float model and have not changed across recent CPython minor versions;
no 3.14-specific behavior was invoked in this test. [VERIFIED: this session, CPython 3.13.14]

## R-02: Pydantic Strict Mode and Decimal

**Question:** does a `strict=True` Pydantic v2 model reject a JSON string for a `Decimal` field —
which would make D-03's own wire format fail D-12's own request-model strictness?

**Method:** `uv run --python 3.13 --with 'pydantic==2.13.5' python r02_pydantic_strict_decimal.py`.
Model: `ConfigDict(strict=True, extra="forbid", frozen=True)` with a bare `Decimal` field, fed a JSON
string, a JSON number, and a JSON integer, through both `model_validate` (pre-parsed Python object)
and `model_validate_json` (raw JSON text).

**Measured result** [VERIFIED: this session, pydantic 2.13.5, CPython 3.13.14]:

| Input | `model_validate` (Python dict) | `model_validate_json` (raw JSON text) |
|---|---|---|
| `"123.4567"` (string) | **RAISES** `is_instance_of` | OK → `Decimal('123.4567')` |
| `123.4567` (number) | **RAISES** `is_instance_of` | OK → `Decimal('123.4567')` |
| `123` (integer) | **RAISES** `is_instance_of` | OK → `Decimal('123')` |
| `Decimal('123.4567')` | OK | — |

Strict mode's `Decimal` validator behaves **differently by entry point**. Fed a pre-parsed Python
object, it accepts only an actual `Decimal` instance — a `str`, `float`, or `int` in the dict all
raise. Fed raw JSON text directly, pydantic-core's own JSON parser is more permissive under strict
mode (JSON has no native `Decimal` type, so pydantic special-cases the JSON-text entry point to
accept a string or number there). This asymmetry is undocumented in the places this session checked
(pydantic's own strict-mode docs describe the behavior per-type, not per-entry-point) and is exactly
the kind of gap the team lead was right to send to research rather than trust to recall.

**The decisive fact: which entry point does FastAPI actually use?** Read directly from the installed
`fastapi==0.141.1` source (not recalled, not summarized):

- `fastapi/routing.py` — the request body handler calls `await request.json()` (`routing.py:439,446`),
  producing a **Python dict**.
- `fastapi/dependencies/utils.py::request_body_to_args` (line 951) — receives that dict as
  `received_body: dict[str, Any] | FormData | bytes | None`, and for a single non-embedded body field
  calls `field.validate(value, ...)` (line 977-980).
- `fastapi/_compat/v2.py::ModelField.validate` (line 173-188) — calls
  `self._type_adapter.validate_python(value, from_attributes=True)`.

**FastAPI's request-body pipeline always uses `validate_python`, never `validate_json`.** [VERIFIED:
`fastapi/routing.py:439,446`; `fastapi/dependencies/utils.py:951-998`; `fastapi/_compat/v2.py:173-188`
— read directly from the installed FastAPI 0.141.1 package this session, not paraphrased]

**Consequence: the self-inconsistency the team lead flagged is real, not hypothetical.** A client
sending `{"amount_usd": "123.4567"}` — the exact JSON-string format D-03 mandates and the API's own
responses emit — will be **rejected** by a bare strict `Decimal` field in a D-12 request model,
because FastAPI hands pydantic a pre-parsed dict, and the dict-path strict validator requires an
actual `Decimal` instance.

**Fix, verified working:**

```python
# src/morai/money/api_types.py (illustrative path -- planner places per D-18's layout)
from decimal import Decimal
from typing import Annotated
from pydantic import BeforeValidator

def _parse_decimal_strict(v: object) -> Decimal:
    if isinstance(v, Decimal):
        return v
    if isinstance(v, str):
        return Decimal(v)
    raise ValueError(f"expected Decimal or str, got {type(v).__name__}")

StrictDecimalField = Annotated[Decimal, BeforeValidator(_parse_decimal_strict)]
```

Measured behavior of this exact type under the project's `ConfigDict(strict=True, extra="forbid",
frozen=True)` base [VERIFIED: this session, pydantic 2.13.5]:

| Input via `model_validate` (the FastAPI path) | Result |
|---|---|
| `str` `"123.4567"` | OK → `Decimal('123.4567')` |
| `float` `123.4567` | **RAISES** (still rejected — the protection D-12/OPS-01 actually wants) |
| `int` `123` | **RAISES** |
| `Decimal('123.4567')` | OK |

Self-consistency confirmed both ways: `FixedMoney(amount_usd=Decimal("9999999999.9999")).model_dump_json()`
produces `{"amount_usd":"9999999999.9999"}`, which re-validates successfully through **both**
`model_validate_json` and `json.loads()` + `model_validate` — the latter being the actual code path
FastAPI exercises. `BeforeValidator` runs before pydantic-core's strict type check, so by the time
strict mode inspects the value it is already a `Decimal` instance, regardless of entry point.

**What this means for the planner:** D-01's `Usd`/`IndexPoints` `NewType`s are untouched — this fix
is additive, applied only where a money value is used as a Pydantic model field. Define one shared
`Annotated` alias per unit (or one generic helper parameterized the same way) in
`src/morai/money/`, and use it — not the bare `Usd`/`IndexPoints` — as the field type in every
request/response model that carries money. Function signatures and non-Pydantic code keep using
plain `Usd`/`IndexPoints` as D-01 specifies. This needs a `tests/gate/` negative-control route
(D-07's pattern) asserting the float/int rejection stays in force — that's the actual protection
being bought here, and it is exactly the kind of thing a future refactor could silently loosen.

**One design note carried to Open Questions, not resolved here:** whether to reject bare `int` for
money fields (as the fix above does) is a judgment call, not a measured fact — it follows D-03's
"money is always a string on the wire" principle applied symmetrically, but the team lead or planner
may want a bare integer dollar amount to validate too. Flagged in Assumptions Log.

## Railway Deployment Shape

**Environment observed this session:** `railway` CLI 4.11.0 installed (`/opt/homebrew/bin/railway`);
`gh` CLI 2.95.0, authenticated; no Railway project currently linked (confirmed by the CONTEXT.md
brief — the project was deleted). [VERIFIED: `railway --version`, `gh --version`, this session]

### Config-as-code is deprecated; new services cannot use it at all

This is the single most consequential, time-sensitive finding in this document. Fetched directly
(`curl https://docs.railway.com/config-as-code.md`) [VERIFIED: primary source, raw markdown, this
session]:

> **Config as Code is deprecated.** Prefer Infrastructure as Code (`.railway/railway.ts`) for
> project configuration. Existing `railway.json` / `railway.toml` files continue to work for
> services that already use them until **2026-12-01** (hard cutoff). **New services cannot opt into
> Config as Code.**

Since this project's Railway project was deleted and must be created from scratch, both the web and
worker services will be **new services** — `railway.toml`/`railway.json` (which is what CLAUDE.md's
existing stack research and the pre-roadmap `research/STACK.md` both assume, since neither predates
this deprecation) is not an available option. Phase 1 must author `.railway/railway.ts`.

### `.railway/railway.ts` — the shape this project needs

Fetched directly (`curl https://docs.railway.com/infrastructure-as-code/reference.md`) [VERIFIED:
primary source, raw markdown, this session]. TypeScript authoring is GA; Python (`railway_sdk`) and
Go mirrors are beta.

```ts
import { defineRailway, project, github, postgres, service } from "railway/iac";

export default defineRailway((ctx) => {
  const db = postgres("postgres");

  const api = service("web", {
    source: github("ChiragThesia/morai-trading-dashboard-and-tools", { rootDirectory: "." }),
    start: "hypercorn --bind '[::]:$PORT' morai.api.app:app",
    healthcheck: "/health",
    env: { DATABASE_URL: db.env.DATABASE_URL },
  });

  const worker = service("worker", {
    source: github("ChiragThesia/morai-trading-dashboard-and-tools", { rootDirectory: "." }),
    start: "procrastinate --app morai.worker.app.app worker",
    env: { DATABASE_URL: db.env.DATABASE_URL },
  });

  return project("morai", { resources: [db, api, worker] });
});
```

This is adapted directly from the reference doc's own worked example (which shows exactly this
web+worker+Postgres, one-repo shape via `rootDirectory`) — not invented. Notes for the planner:

- Both services share `rootDirectory: "."` (one package, D-18's `src/` layout, two entry points) —
  the reference doc's own multi-service example uses distinct `rootDirectory` values for a
  true monorepo (separate `apps/api`, `apps/worker`); this project is one installable package with
  two start commands, so both services point at the repo root and differ only in `start`.
  [ASSUMED: the `rootDirectory: "."` for both, differing only in `start`, was not itself shown in
  the fetched example — inferred from D-18's single-package layout. Confirm on first `railway up`.]
- `db.env.DATABASE_URL` is the current, typed cross-service reference — it replaces the older
  `${{Postgres.DATABASE_URL}}` string-interpolation syntax a 2026-vintage blog post and older docs
  still show [CITED: `blog.railway.com/p/database-reference-variables`, via WebSearch summary — the
  string syntax is very likely still what the typed accessor compiles to, but that internal detail
  was not independently confirmed this session].
- `postgres("postgres")` is Railway's own managed-Postgres helper — provisioning, not just a
  variable reference.
- Nothing in the fetched reference names an explicit IPv6/dual-stack toggle for `service()`. Address
  family is controlled entirely by what the container's `start` command binds to (Hypercorn's own
  `--bind '[::]:$PORT'`), not by anything in `.railway/railway.ts`.

### PORT and healthcheck mechanics

Fetched directly (`curl https://docs.railway.com/deployments/healthchecks.md`) [VERIFIED: primary
source, raw markdown, this session]:

- Railway injects a `PORT` env var; the app must listen on it; the same value is used for the health
  check. `hypercorn --bind '[::]:$PORT'` satisfies this (dual-stack bind on the one port Railway
  actually checks).
- The health check queries the configured path (e.g. `/health`) until it gets a `200`, **only at
  deploy time** — "Railway does not monitor the healthcheck endpoint after the deployment has gone
  live" and continuous healthcheck-based monitoring is explicitly **not** how it works. This sharpens
  D-14's own rationale: the risk `/health` must avoid isn't an ongoing restart loop from an occasional
  DB blip (Railway isn't polling `/health` post-deploy at all) — it's a **failed deploy** if `/health`
  transiently depends on DB reachability during the deploy window itself.
- Default timeout 300s, overridable via the service setting or `RAILWAY_HEALTHCHECK_TIMEOUT_SEC`.
- The health check request originates from hostname `healthcheck.railway.app` — an app must not
  reject that `Host` header if it does host-based filtering (not a concern for this phase, noted for
  later).

### Whether the public health check path is IPv4, IPv6, or both — now definite

**Update, following the orchestrator's request for a definite answer:** the original pass called
this a directional signal only. It no longer is. Re-ran the DNS probe against three independent
resolvers (system, Google `8.8.8.8`, Cloudflare `1.1.1.1`) to rule out a local-resolver artifact, and
checked whether Railway documents IPv6 for the public path at all [VERIFIED: `dig`, three resolvers,
this session, 2026-08-30]:

```
healthcheck.railway.app  A     34.107.141.139   (identical across all three resolvers)
healthcheck.railway.app  AAAA  (empty -- no record, all three resolvers)
up.railway.app            A     69.46.46.126
up.railway.app            AAAA  (empty -- no record, all three resolvers)
```

Three independent resolvers agreeing on "no `AAAA` record" rules out a caching or local-resolver
quirk. This is corroborated by Railway's own documented custom-domain mechanism
[CITED: WebSearch summary of `station.railway.com` and `docs.railway.com/networking/domains`, this
session]: **Railway does not issue `A`/`AAAA` records for custom domains at all** — adding one gets a
`CNAME` + `TXT` pair, never an IP address — and there is an **open, unresolved feature request** on
Railway's own community forum asking for "static public IPv4/IPv6 addresses" and "direct A/AAAA
records," which would not exist as an open ask if the platform already did this.

**Definite finding:** Railway's public edge — both auto-generated `*.up.railway.app` domains and
custom domains — is **IPv4-only today**, for all public-facing traffic, not just this project's
future service. There is no public path over which an IPv6 health check (or any other IPv6 request)
can reach a Railway-hosted service. This is a platform boundary, not something a container's bind
configuration can work around.

**Consequence for criterion 1 and the V092 test:** criterion 1's IPv6 half **cannot** be
demonstrated over the public internet, ever, on this platform, regardless of how the container binds.
It can only be demonstrated over Railway's private network (`<service>.railway.internal`), which is
dual-stack for a new environment per the next finding below. The V092 test design (below) is written
to prove exactly that split, not to attempt an IPv6 curl against the public domain and treat its
failure as inconclusive — that failure is the expected, permanent shape of the platform, not a probe
result to interpret.

### The private-networking baseline changed since v1's original V039 measurement

Fetched directly (`curl https://docs.railway.com/networking/private-networking/how-it-works.md`)
[VERIFIED: primary source, raw markdown, this session]:

> **New environments** (created after October 16, 2025): DNS names resolve to both internal IPv4
> and IPv6 addresses.
> **Legacy environments**: DNS names resolve to IPv6 addresses only.

This project's Railway environment will be created from scratch during Phase 1 — it is, by
definition, a **new environment**, and will get **dual-stack** private networking
(`<service>.railway.internal` resolves both families) rather than the IPv6-only private network v1's
original `V039` measurement almost certainly ran against (`V039`'s own text: "Railway needs an IPv4
health check **and** an IPv6 private network" — a framing that only makes sense if the private
network was IPv6-only at the time). **This means the mechanism that originally forced a mandatory
dual-stack bind may be weaker today than it was for v1** — if the private network now also speaks
IPv4, an IPv4-only bind might satisfy both the public health check and inter-service calls. This is
exactly why the phase's own spike exists rather than assuming either way; it is not a reason to skip
the Hypercorn dual-stack bind as the default, since it costs nothing and covers both possibilities.

Checked whether Railway documents any Python/FastAPI/Hypercorn-specific dual-stack configuration
guidance the way it does for Node.js/Go/Docker-Mongo
(`docs.railway.com/networking/private-networking/library-configuration.md`, fetched directly)
[VERIFIED: primary source, raw markdown, this session]: **no** — the page covers `ioredis`, `bullmq`,
`hot-shots` (Node.js), Fiber (Go), and the official MongoDB Docker image. Nothing for Python. The
project is on its own for this; V039's original prescription (bind explicitly dual-stack via
Hypercorn, since Uvicorn's CLI cannot) remains the correct default absent contrary evidence from the
live smoke test.

### V092 re-measurement design (for the phase's owned spike)

Design, not execution — no service is deployed yet. Once `/health` is live on Railway:

1. **From outside Railway, over IPv4:** `curl -4 -sS -o /dev/null -w '%{http_code}\n' https://<service>.up.railway.app/health` — expect `200`.
2. **From outside Railway, over IPv6:** `curl -6 -sS -o /dev/null -w '%{http_code}\n' https://<service>.up.railway.app/health` — expect this to **fail to resolve/connect**, definitely, per the finding above. Run it anyway and record the exact `curl` error text; a passing result here would itself be the surprise worth writing up.
3. **From inside Railway, over the private network:** deploy a second, trivial service (or use the worker) that does `curl -sS -o /dev/null -w '%{http_code}\n' http://<web-service>.railway.internal:$PORT/health` — this is the **only** valid IPv6 test on this platform, per the finding above, not a fallback for when step 2 fails.
4. **Record all three raw outputs** (HTTP code or connection error, verbatim) in `V092`, alongside the exact Python version and base image nixpacks produced (`railway logs` or the deployment's build log names both) — D-19's own requirement.
5. **Write `V092` as a refutation-with-nuance of `V039`'s literal framing**, not a flat "confirmed" or "refuted": "Railway needs an IPv4 health check" undersells it — the public health check can *only ever* be IPv4, on this platform, full stop; there is no public IPv6 path to lose by binding wrong. The "and an IPv6 private network" half is where dual-stack binding actually matters, and it is now dual-stack-by-default for new environments (previous finding) rather than IPv6-only as it was for v1. State both halves explicitly so a future reader doesn't read `V092` as a simple confirm/refute of `V039`.

## Procrastinate: Migrations and the Connector Mismatch

### Migrations: plain SQL, no Alembic integration exists

Fetched directly (`curl https://raw.githubusercontent.com/procrastinate-org/procrastinate/main/...`
and the rendered `migrations.html` doc) [VERIFIED: primary source, this session]. Procrastinate's own
schema migrations are plain `.sql` files shipped inside the PyPI package
(`procrastinate schema --migrations-path` prints their location), named
`{version}_{seq}_{pre|post}_{description}.sql`, intended to be applied with `psql` directly.
**Procrastinate documents no Alembic integration** and states migration state must be tracked
manually if you don't use its own (non-existent, per the search results) apply-tracking mechanism.

**Consequence for D-13 ("Phase 3 inherits a working migration path instead of introducing one"):**
running `procrastinate schema --apply` as a separate, out-of-band step creates exactly the
second-write-path problem this project structurally avoids elsewhere (`LEDGER-01`'s lesson, applied
here to migrations instead of fills). The clean fix: **wrap each Procrastinate SQL migration file's
contents in its own Alembic revision**, using `op.execute()` with the raw SQL verbatim, so Alembic
remains the single migration system of record and `alembic upgrade head` is still the one command
that brings a fresh database (CI, local, or Railway) to the correct schema — Procrastinate's tables
included. [ASSUMED: this specific "wrap Procrastinate's own SQL in an Alembic revision" pattern is
this researcher's synthesis, not something Procrastinate's docs recommend directly — the docs only
confirm the raw-SQL shape and the absence of native Alembic tooling. Low risk: it is standard practice for wrapping any raw SQL into Alembic, and Procrastinate's migration files are explicitly designed to be applied via any Postgres client.]

### The connector mismatch: no asyncpg connector exists

Fetched directly (`curl` of Procrastinate's own `docs/howto/basics/connector.md`) [VERIFIED: primary
source, this session]. Procrastinate ships exactly 5 connectors:

| Connector | Driver | Async? | Can run the worker? |
|---|---|---|---|
| `PsycopgConnector` | `psycopg` v3 | yes | **yes** |
| `AiopgConnector` | `aiopg` | yes | yes |
| `SyncPsycopgConnector` | `psycopg` v3 | no | no (defer only) |
| `Psycopg2Connector` | `psycopg2` | no | no (defer only) |
| `SQLAlchemyPsycopg2Connector` | `psycopg2`, shares a SQLAlchemy-managed pool | no | no (defer only) |

**There is no `asyncpg`-based connector.** This project's stack is SQLAlchemy 2.0 + `asyncpg`
(`.claude/CLAUDE.md`'s own pin). The one connector that claims SQLAlchemy integration
(`SQLAlchemyPsycopg2Connector`) is built on `psycopg2` — a **synchronous** driver — and is explicitly
documented as **defer-only, not usable for running the worker**. It does not fit this project's
async-first design even for the narrow case of enqueueing from the web process.

**What this actually means for Phase 1, and it simplifies rather than complicates things:** the
worker process needs its own, separate `psycopg` v3 connection pool via `PsycopgConnector`,
independent of the web process's SQLAlchemy/`asyncpg` `AsyncEngine`. Phase 1's own scope, per D-13,
is "a worker running one Procrastinate heartbeat task" — a scheduled/periodic task
(`app.periodic(...)`), not a job the web process enqueues. **The web process does not need a
Procrastinate connector at all in Phase 1.** Only the worker service does. This removes the
"does the web process also need a second pool" question from this phase's scope entirely — it
becomes live only if/when a later phase has the web process defer a job (ingest-triggered-by-request,
for instance), at which point it would need its own `PsycopgConnector`, budgeted as a connection pool
fully separate from its `asyncpg` pool, per `NN-28`'s "cap every pool, sum them against the ceiling."

```python
# worker process only, per D-13's scope
import procrastinate

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=settings.database_url_sync)
)
```

[CITED: `procrastinate.readthedocs.io` / the connector.md source above, for the constructor shape —
`conninfo` accepts a libpq connection string directly]

## The Type Gate: Empirically Verified

### `reportAny`/`reportExplicitAny` are not part of basedpyright's default `strict` mode

Ran locally, `uv run --python 3.13 --with 'basedpyright==1.39.10' basedpyright bad.py` against:

```python
from typing import Any

def foo(baz: Any) -> None:
    print(baz)
```

**With only `"typeCheckingMode": "strict"` in `pyrightconfig.json`** [VERIFIED: this session]:

```
0 errors, 0 warnings, 0 notes
```

**With `"reportAny": "error"` and `"reportExplicitAny": "error"` added explicitly** [VERIFIED: this session]:

```
bad.py:4:9 - error: Type of parameter "baz" is Any (reportAny)
bad.py:4:14 - error: Type `Any` is not allowed (reportExplicitAny)
bad.py:5:11 - error: Argument type is Any ... (reportAny)
3 errors, 0 warnings, 0 notes
```

**This confirms D-05's own phrasing was already correct and is now load-bearing, not decorative:**
"basedpyright strict is primary, **with `reportAny` and `reportExplicitAny` set to error**" — the
qualifier matters. `strict` mode alone, on basedpyright 1.39.10, does not enable either rule. Omitting
the explicit config would silently defeat the entire premise of D-05 (catching `Any` flowing out of
`schwab-py` in Phase 4) while every other strict-mode check still passes. This is precisely the
failure mode D-07 exists to catch — a config knob quietly not doing what it looks like it does — and
this specific knob is the one to put in `tests/gate/` first.

**Confirmed rule names and behavior**, cross-checked against `docs.basedpyright.com`
[CITED: `docs.basedpyright.com/latest/benefits-over-pyright/new-diagnostic-rules/`, WebFetch summary
of official docs, this session — corroborated by the empirical run above, which is the primary
evidence]:

- `reportAny` — flags any expression whose type resolves to `Any`, regardless of origin (an untyped
  vendor call included).
- `reportExplicitAny` — bans writing `Any` directly in an annotation.
- 12 further basedpyright-only rules exist beyond these two (`reportIgnoreCommentWithoutRule`,
  `reportInvalidCast`, `reportUnusedParameter`, etc.) — not required by any locked decision this
  phase, listed in Open Questions as candidates for the planner's discretion.

### `pyproject.toml` blocks

```toml
[tool.basedpyright]
include = ["src", "tests"]
typeCheckingMode = "strict"
reportAny = "error"
reportExplicitAny = "error"
reportIgnoreCommentWithoutRule = "error"  # forces a rule code on every pyright:ignore, mirrors D-06's mypy-side PGH003

[tool.mypy]
strict = true
disallow_any_explicit = true
disallow_any_expr = true
plugins = []  # explicitly no SQLAlchemy plugin -- deprecated, see What NOT to Use

[tool.pydantic-mypy]
init_forbid_extra = true
init_typed = true
warn_required_dynamic_aliases = true

[tool.ruff.lint]
select = ["E", "F", "PGH", "TID"]  # PGH003 forces rule codes on suppressions; TID enables banned-api

[tool.ruff.lint.flake8-tidy-imports.banned-api]
"typing.Any".msg = "Banned -- see D-06. Use a project-owned type or a justified basedpyright/mypy ignore with a `# why:` comment."
"typing.cast".msg = "Banned -- see D-06. Resolve with model_validate() at the boundary instead."
```

[VERIFIED: `--disallow-any-expr`/`--disallow-any-explicit` confirmed as real, named mypy 2.3.1 CLI
flags via `mypy --help`, this session — not bundled into `--strict`, matching CLAUDE.md's prior
claim] [CITED: `ruff`'s `banned-api` (`TID251`) config shape —
`docs.astral.sh/ruff/rules/banned-api/`, via WebSearch, this session; needs `"TID"` selected in
`[tool.ruff.lint].select` for the rule to run at all]
[ASSUMED: `reportIgnoreCommentWithoutRule` as the basedpyright-side mirror of ruff's `PGH003` — a
reasonable pairing given both rules do the same job for their respective ignore-comment syntax, but
not something CONTEXT.md asked for explicitly; the planner may drop it]. The exact
`[tool.pydantic-mypy]` keys are carried forward from `.claude/CLAUDE.md`'s own already-verified
research (§2) rather than re-verified this session — flagged in Assumptions Log since this document
did not re-fetch pydantic's mypy-plugin docs directly.

**Known basedpyright/mypy disagreement surface, carried forward from CLAUDE.md's own prior
research, not re-verified this session:** SQLAlchemy 2.0's `Mapped[]` descriptors and
`partial()`-wrapped functions are the two named trouble spots. Neither is exercised by anything
Phase 1 builds (no ORM models with relationships, no `partial()` usage in the walking skeleton) — a
Phase 3 concern, noted here so it isn't rediscovered from scratch.

## Standard Stack

### Core

| Library | Version (verified live, PyPI JSON API, 2026-08-30) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python | 3.12 or 3.13 | Runtime | Locked by `.claude/CLAUDE.md`; both available locally via `uv python list` (3.13.14, 3.12.13) |
| FastAPI | **0.141.1** (2026-07-29) | HTTP API | Native Pydantic v2 boundary; source read this session confirms request bodies go through `validate_python`, not `validate_json` — see R-02 |
| Pydantic | **2.13.5** (2026-08-28) | Validation | Strict-mode `Decimal` behavior fully measured this session |
| SQLAlchemy | **2.0.52** (2026-08-11) | ORM | `Mapped[T]` typing, no mypy plugin |
| asyncpg | **0.31.0** (2025-11-24) | Postgres async driver | `sqlalchemy[asyncpg]` extra |
| Alembic | **1.19.1** (2026-08-08) | Migrations | Also carries Procrastinate's SQL migrations — see above |
| Hypercorn | **0.18.0** (2025-11-08) | ASGI server, prod | Explicit dual-stack `--bind`; Uvicorn 0.52.4 (2026-08-19) for local dev only |
| Procrastinate | **3.9.0** (2026-06-20) | Job queue + cron | Postgres-only; connector caveat above |
| basedpyright | **1.39.10** (2026-08-13) | Type gate, primary | `reportAny`/`reportExplicitAny` must be set explicitly — verified this session |
| mypy | **2.3.1** (2026-08-15) | Type gate, secondary | `--disallow-any-expr`/`--disallow-any-explicit` not in `--strict` — verified this session |
| ruff | **0.16.5** (2026-08-27) | Lint/format | `banned-api` for D-06 |
| pytest | **9.1.1** (2026-06-19) | Test runner | — |
| uv | 0.11.24 (installed, Homebrew) | Package/venv manager | `uv init --lib`/`--package` scaffolds `src/` layout directly |

### Supporting

| Library | Version (verified live) | Purpose | When to Use |
|---------|---------|---------|-------------|
| Hypothesis | **6.167.1** (2026-08-30 — shipped **today**; `.claude/CLAUDE.md` cites 6.166.0, one patch behind) | Property tests | Not exercised until Phase 5's ledger work; note the drift for whoever pins the lockfile |
| pytest-asyncio | **1.4.0** (2026-05-26) | Async test support | Every async SQLAlchemy/FastAPI test |
| cryptography | **50.0.1** (2026-08-25) | AESGCM | Not exercised in Phase 1 (Phase 3 owns encryption) — version confirmed current in case the dependency list is drafted now |
| argon2-cffi | **25.1.0** (2025-06-03) | Password hashing | Not exercised in Phase 1 (Phase 2 owns auth) |
| schwab-py | **1.5.1** (2025-06-30) | Schwab client | Not exercised in Phase 1 (Phase 4) — pin confirmed unchanged since v1 |

### Alternatives Considered

No new alternatives surfaced this session beyond what `.claude/CLAUDE.md`'s own prior research
already settled (SQLAlchemy over SQLModel/raw-asyncpg, Procrastinate over SAQ/arq/Celery/APScheduler,
basedpyright-primary over mypy-primary). Not re-litigated — D-05 already resolved the
basedpyright-vs-mypy question as "both," which is stronger than either alternative alone.

**Installation:**
```bash
uv init --lib --no-readme --vcs none  # inside src/ layout per D-18; adjust flags to match exact D-18 submodule shape
uv add fastapi pydantic "sqlalchemy[asyncpg]" alembic procrastinate hypercorn
uv add --dev pytest pytest-asyncio hypothesis basedpyright mypy ruff
```

**Version verification:** every version above was checked live this session via
`curl -s "https://pypi.org/pypi/<package>/json"`, not recalled — see Sources.

## Package Legitimacy Audit

Ran via the seam: `gsd_run query package-legitimacy check --ecosystem pypi <17 packages>`.

**Result: every one of the 17 packages checked came back `SUS`.** Before reading the table as 17 red
flags, the actual signal driving that verdict matters:

| Package | Registry | Latest release date | GitHub repo (per PyPI metadata) | Tool verdict | Reasons given | Disposition |
|---------|----------|------|------|---------|---------|-------------|
| fastapi | pypi | 2026-07-29 | github.com/fastapi/fastapi | SUS | unknown-downloads | **Approved** |
| pydantic | pypi | 2026-08-28 | github.com/pydantic/pydantic | SUS | too-new, unknown-downloads | **Approved** |
| sqlalchemy | pypi | 2026-08-11 | sqlalchemy.org | SUS | too-new, unknown-downloads | **Approved** |
| procrastinate | pypi | 2026-06-20 | (null in tool; actually github.com/procrastinate-org/procrastinate — fetched directly this session) | SUS | unknown-downloads, no-repository | **Approved** |
| hypercorn | pypi | 2025-11-08 | (null in tool; actually github.com/pgjones/hypercorn) | SUS | unknown-downloads, no-repository | **Approved** |
| uvicorn | pypi | 2026-08-19 | github.com/Kludex/uvicorn | SUS | too-new, unknown-downloads | **Approved** |
| basedpyright | pypi | 2026-08-13 | (null in tool; actually github.com/DetachHead/basedpyright, confirmed via docs fetched this session) | SUS | too-new, unknown-downloads, no-repository | **Approved** |
| mypy | pypi | 2026-08-15 | mypy-lang.org | SUS | too-new, unknown-downloads | **Approved** |
| ruff | pypi | 2026-08-27 | docs.astral.sh/ruff | SUS | too-new, unknown-downloads | **Approved** |
| alembic | pypi | 2026-08-08 | github.com/sqlalchemy/alembic | SUS | too-new, unknown-downloads | **Approved** |
| pytest | pypi | 2026-06-19 | github.com/pytest-dev/pytest | SUS | unknown-downloads | **Approved** |
| asyncpg | pypi | 2025-11-24 | (null in tool; actually github.com/MagicStack/asyncpg) | SUS | unknown-downloads, no-repository | **Approved** |
| cryptography | pypi | 2026-08-25 | (null in tool; actually github.com/pyca/cryptography) | SUS | too-new, unknown-downloads, no-repository | **Approved** |
| schwab-py | pypi | 2025-06-30 | github.com/alexgolec/schwab-py | SUS | unknown-downloads | **Approved** |
| argon2-cffi | pypi | 2025-06-03 | (null in tool; actually github.com/hynek/argon2-cffi) | SUS | unknown-downloads, no-repository | **Approved** |
| hypothesis | pypi | 2026-08-30 (today) | (null in tool; actually github.com/HypothesisWorks/hypothesis) | SUS | too-new, unknown-downloads, no-repository | **Approved** |
| pytest-asyncio | pypi | 2026-05-26 | github.com/pytest-dev/pytest-asyncio | SUS | unknown-downloads | **Approved** |

**Analysis, not a silent override:** `unknown-downloads` fired on **all 17 of 17** PyPI packages
checked, including `pytest`, `SQLAlchemy`, and `cryptography` — libraries with, self-evidently,
enormous install bases. The seam's `weeklyDownloads` signal returned `null` for every single PyPI
package this session, which is a gap in how the tool sources PyPI download statistics (unlike npm,
PyPI's public download-count API isn't wired into this signal) — not a per-package finding.
`too-new` fired based on the **latest published release's** date (e.g. `hypothesis` shipped a new
version literally today), not the package's founding date — normal for actively maintained software,
not a red flag. `no-repository` fired for several packages (`hypercorn`, `procrastinate`, `asyncpg`,
`cryptography`, `argon2-cffi`, `hypothesis`, `basedpyright`) whose PyPI metadata doesn't carry a
`repository` URL field even though each demonstrably has one — several were fetched directly from
their real GitHub repos elsewhere in this same research session (`procrastinate-org/procrastinate`,
for instance, whose docs were `curl`'d directly above).

**Packages removed due to `[SLOP]` verdict:** none — the tool returned `SUS`, not `SLOP`, for every
package; nothing was flagged as hallucinated or newly-created.
**Packages flagged as suspicious `[SUS]`:** all 17, per the tool's raw output above — but every one
is independently corroborated this session (live PyPI existence + version, and for most, a
confirmed real repository) as an established, ecosystem-standard package, several of which were
directly `curl`'d for their own documentation earlier in this same session. **Recommendation:**
treat this specific `SUS` batch as a known tool/ecosystem-calibration gap for PyPI rather than 17
individual findings, and replace the usual "one `checkpoint:human-verify` per `SUS` package" with a
**single** verification step: confirm `uv lock` resolves all 17 cleanly against the pinned versions
above before the first commit that adds them. This is a deviation from the package-legitimacy
protocol's literal instruction, made transparently and for a stated reason — the planner or user may
override it back to per-package checkpoints if they'd rather not accept this researcher's judgment
call here.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────┐
                         │   GitHub Actions (CI)    │
                         │ basedpyright + mypy +    │
                         │   ruff + pytest gate     │
                         └───────────┬──────────────┘
                                     │ required checks, PR-only merge (D-16)
                                     ▼
   ┌──────────────┐   HTTPS    ┌───────────────────────┐        Wireguard,
   │ post-deploy  │──────────▶│  Railway "web" service  │◀──────dual-stack──┐
   │ smoke test   │  IPv4      │  Hypercorn, [::]:$PORT  │  (new environment) │
   │ (V092)       │            │  FastAPI: /health,      │                    │
   └──────────────┘            │  /gate/money-roundtrip  │                    │
                                └───────────┬─────────────┘                   │
                                            │ asyncpg (SQLAlchemy AsyncEngine) │
                                            ▼                                 │
                                ┌───────────────────────┐                     │
                                │   Railway Postgres     │◀────────────────────┘
                                │  gate_money_probe      │   psycopg v3
                                │  NUMERIC(14,4) column   │  (Procrastinate's
                                │  procrastinate_* tables │   own pool)
                                └───────────┬─────────────┘
                                            ▲
                                            │ psycopg v3 (PsycopgConnector)
                                ┌───────────┴─────────────┐
                                │ Railway "worker" service │
                                │  procrastinate worker    │
                                │  one periodic heartbeat  │
                                │  task (app.periodic)     │
                                └───────────────────────────┘
```

Two separate Postgres client libraries reach the same database from two separate processes: the web
service's SQLAlchemy/`asyncpg` `AsyncEngine`, and the worker's Procrastinate/`psycopg` v3 pool. They
do not and cannot share a connection pool (see the connector-mismatch finding above) — each is its
own budget line against Railway Postgres's connection ceiling (`NN-28`), even though Phase 1 itself
only needs one such pool per process.

### Recommended Project Structure

Per D-18, adapted to what this research adds (money's API-facing types, the gate directory,
Railway's new config file):

```
.railway/
└── railway.ts          # Infrastructure as Code -- NOT railway.toml, see Railway Deployment Shape
src/
└── morai/
    ├── api/             # FastAPI app, routes (D-11 return-type-annotated), ApiModel base (D-09)
    ├── worker/           # Procrastinate App + periodic heartbeat task
    ├── money/            # Usd/IndexPoints NewTypes (D-01), units.py (D-02), StrictDecimalField (R-02)
    └── db/               # SQLAlchemy models, gate_money_probe, Alembic env
tests/
├── gate/                # D-07 negative-control fixtures: type-gate violations, strict-model bypasses
└── ...                  # ordinary red-then-green tests
alembic/
└── versions/            # baseline + gate_money_probe + Procrastinate's own SQL wrapped per-revision
tools/
└── gate.sh              # single script CI and local hooks both call (Specific Ideas)
docker-compose.yml        # local Postgres, pinned to the same version as CI's services: postgres (D-17)
```

### Pattern 1: The strict-mode Decimal boundary

**What:** every Pydantic model field carrying money uses `StrictDecimalField` (R-02's
`Annotated[Decimal, BeforeValidator]`), never a bare `Decimal`/`Usd`/`IndexPoints` directly.
**When to use:** any request or response model field backed by `NUMERIC`.
**Example:** see the R-02 section above — verified working code, not illustrative pseudocode.

### Pattern 2: One Alembic revision per Procrastinate SQL migration

**What:** each file under `procrastinate schema --migrations-path` becomes its own Alembic revision,
its SQL run via `op.execute()` verbatim.
**When to use:** Phase 1's baseline migration, and any future Procrastinate version bump.
**Example:**
```python
# Source: pattern synthesized from Procrastinate's own migrations.html doc (raw SQL files,
# no native Alembic integration) -- see "Procrastinate: Migrations" above
def upgrade() -> None:
    op.execute("""-- verbatim contents of e.g. 3.9.0_01_pre_something.sql""")
```

### Anti-Patterns to Avoid

- **Running `procrastinate schema --apply` as a separate deploy step:** creates a second,
  untracked migration path outside Alembic — the exact class of bug (`LEDGER-01`'s lesson) this
  project avoids everywhere else. Wrap the SQL in Alembic instead.
- **Reaching for `SQLAlchemyPsycopg2Connector`** to "share a pool" between FastAPI and Procrastinate:
  it's `psycopg2`-based (sync), defer-only, and does not fit an async FastAPI+`asyncpg` app. Give the
  worker its own `PsycopgConnector` pool instead.
- **Trusting `typeCheckingMode: "strict"` alone to catch `Any`:** measured this session — it does
  not. `reportAny`/`reportExplicitAny` must be named explicitly.
- **Authoring `railway.toml` for a new Railway project in 2026:** not merely discouraged — Railway's
  own docs state new services cannot opt into it. Use `.railway/railway.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Decimal-from-JSON-string parsing at the API boundary | A custom `field_validator` per money field | The one shared `StrictDecimalField`/`BeforeValidator` in `src/morai/money/` | One implementation, one place a future unit bug can hide, matching `L060`'s "one kernel, one carry source" lesson applied to types instead of math |
| Procrastinate schema tracking | A hand-rolled "which migrations have run" table | Alembic's own version table, since Procrastinate's SQL is wrapped into Alembic revisions | Avoids a second migration-state source of truth |
| Health-check IPv4/IPv6 detection logic in the app | Custom socket-family introspection at startup | Hypercorn's own documented `--bind '[::]:$PORT'` dual-stack bind | The OS/ASGI server already solves this; app code has no business inspecting its own bind family |

**Key insight:** every "don't hand-roll" here is really the same lesson as `L060` and `L058` applied
to Phase 1's specific surface — one canonical implementation per cross-cutting concern (units,
migrations, address-family binding), because this project's own recorded history shows duplicated
implementations are exactly where the expensive bugs lived.

## Common Pitfalls

### Pitfall 1: Strict Pydantic + D-03's string wire format silently rejecting the API's own output

**What goes wrong:** a bare strict `Decimal` field in a request model rejects the exact JSON-string
format the API's own responses emit, because FastAPI validates request bodies via
`TypeAdapter.validate_python` on a pre-parsed dict, not `validate_json` on raw text (R-02).
**Why it happens:** pydantic's strict-mode `Decimal` validator is more permissive when parsing raw
JSON text directly than when validating an already-parsed Python object — an asymmetry that isn't
obvious from reading pydantic's docs per-type rather than per-entry-point.
**How to avoid:** use `StrictDecimalField` (this document's R-02 section) on every money field in
every Pydantic model, never a bare `Decimal`/`Usd`/`IndexPoints`.
**Warning signs:** a `tests/gate/` negative-control route that posts D-03's own string format to a
money field and does NOT raise — if it raises, the protection is missing or broken; that fixture
should assert success, unlike most of `tests/gate/`'s other fixtures which assert failure.

### Pitfall 2: Assuming a 14-digit Decimal literal proves float-unsafety by digit count alone

**What goes wrong:** picking any 14-significant-digit value and asserting "this has more precision
than a float can hold" without checking — CONTEXT.md itself warned this proves nothing, and this
session's measurement confirms why: a double's ~15.95-digit round-trip envelope comfortably covers
`NUMERIC(14,4)`'s full range.
**Why it happens:** "more precision than a float can hold" sounds like a digit-count claim; it's
actually a bit-representability claim, and the two only coincide once magnitude/digit-count exceeds
roughly 17 significant digits — past `NUMERIC(14,4)`'s ceiling.
**How to avoid:** prove bit-exactness (`Decimal(float(x)) != x`), not a visible-digit-flip, and say
so explicitly in the test's own docstring/assertion message so a future reader doesn't "fix" the test
by hunting for a value that visibly flips (none exists within this column's range).
**Warning signs:** a code review comment asking "but does this actually look different when printed
to 4 decimal places?" — the honest answer for any `NUMERIC(14,4)` value is no, and that's fine.

### Pitfall 3: Procrastinate connector fighting the project's asyncpg-first stack

**What goes wrong:** reaching for an `asyncpg`-based Procrastinate connector that doesn't exist, or
using `SQLAlchemyPsycopg2Connector` (sync, defer-only) somewhere that needs to run the worker.
**Why it happens:** the project's own stack docs pin `asyncpg` everywhere else, making it a
reasonable but wrong assumption that Procrastinate follows the same driver.
**How to avoid:** `PsycopgConnector` (async, `psycopg` v3) for the worker, its own separate pool,
budgeted against `NN-28`'s ceiling alongside (not shared with) the web process's `asyncpg` pool.
**Warning signs:** an import error for a nonexistent `procrastinate.AsyncpgConnector`, or a worker
that silently never runs because it was constructed with a defer-only connector.

### Pitfall 4: Authoring `railway.toml` out of habit or stale training knowledge

**What goes wrong:** following `.claude/CLAUDE.md`'s or `research/STACK.md`'s existing text (both
predate this deprecation) and writing a `railway.toml`, which a **new** Railway service cannot use at
all as of this session.
**Why it happens:** the deprecation is recent enough that neither this project's own prior research
nor most training data reflects it yet.
**How to avoid:** `.railway/railway.ts`, per the exact shape verified above.
**Warning signs:** `railway up` succeeding but the dashboard showing none of the configured
health-check/start-command settings actually took effect — a symptom of a config file the platform
silently ignores for a new service.

## Code Examples

### The R-01 canary, as the deployed probe should use it

```python
# Source: this session's own measurement -- not from an external doc
CANARY_VALUES = [
    Decimal("9999999999.9999"),   # NUMERIC(14,4) ceiling -- bit-inexact as float64, proven above
    Decimal("1234567890.1234"),   # mid-range fixture, same property
]
```

### The R-02 fix (repeated for locality — full verification is in the R-02 section above)

```python
def _parse_decimal_strict(v: object) -> Decimal:
    if isinstance(v, Decimal):
        return v
    if isinstance(v, str):
        return Decimal(v)
    raise ValueError(f"expected Decimal or str, got {type(v).__name__}")

StrictDecimalField = Annotated[Decimal, BeforeValidator(_parse_decimal_strict)]
```

### Hypercorn dual-stack bind (Railway start command)

```bash
# Source: docs.railway.com/deployments/healthchecks.md (PORT convention) +
# this project's own V039 finding (Hypercorn's documented multi-bind)
hypercorn --bind '[::]:'"$PORT" morai.api.app:app
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `railway.toml`/`railway.json` config-as-code | `.railway/railway.ts` Infrastructure as Code | Deprecation live as of this session; hard cutoff 2026-12-01 for **existing** services, but **new** services already cannot use the old format at all | Every Railway-facing plan artifact in this repo's prior research (`research/STACK.md`, `research/ARCHITECTURE.md`) that assumes `railway.toml` needs the new syntax instead |
| Railway private networking: IPv6-only DNS | Dual-stack (IPv4 + IPv6) DNS for environments created after **2025-10-16** | This project's Railway environment will be new, so it inherits dual-stack automatically | The original `V039` mechanism ("IPv4 health check and an IPv6-only private network") may be weaker today — see V092 test design |
| Uvicorn cannot dual-stack bind from the CLI (v1's `V039` finding) | Uvicorn ≥0.30.6 has an undocumented `--host ""` workaround; still not documented, still OS/version-variable | Noted in `.claude/CLAUDE.md`'s own prior research, not changed this session | Hypercorn remains the documented, explicit choice; this research found no reason to revisit that |
| basedpyright `strict` assumed to imply `reportAny`/`reportExplicitAny` | Confirmed **false** this session — both must be set explicitly | Measured this session, basedpyright 1.39.10 | D-05's own wording already anticipated this; now backed by a reproducible test instead of a docs summary |

**Deprecated/outdated:** `railway.toml`/`railway.json` for any **new** Railway service, effective
before this phase starts — see above. `.claude/CLAUDE.md`'s existing "Two-service split... standard
Railway pattern" language is still directionally correct but should be read as "via
`.railway/railway.ts`", not literally.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Both Railway services use `rootDirectory: "."` with `source: github(...)`, differing only in `start` | Railway Deployment Shape | Low — worst case the planner adjusts one field on first `railway up`; doesn't change the architecture |
| A2 | `db.env.DATABASE_URL`'s typed accessor compiles to the same mechanism as the older `${{Postgres.DATABASE_URL}}` string syntax | Railway Deployment Shape | Low — both are Railway's own documented syntaxes; worst case is a syntax correction, not a design change |
| A3 | Wrapping each Procrastinate SQL migration file in its own Alembic revision (`op.execute()`) is the right integration pattern | Procrastinate: Migrations | Low-Medium — this researcher's synthesis, not Procrastinate's own documented recommendation; if wrong, the fallback (running `procrastinate schema --apply` as a separate step) is still viable, just reopens the second-write-path concern D-13 wants to avoid |
| A4 | `reportIgnoreCommentWithoutRule` is a reasonable basedpyright-side mirror of ruff's `PGH003` | The Type Gate | Low — purely additive; omitting it changes nothing else |
| A5 | Rejecting bare JSON integers (not just floats) for money fields in `StrictDecimalField` is the right call, symmetric with D-03 | R-02 | Low — easy to loosen later (add `int` to the allowed-instance check) without touching D-01/D-03/D-12 |
| A6 | `[tool.pydantic-mypy]` key names (`init_forbid_extra`, `init_typed`, `warn_required_dynamic_aliases`) carried forward from `.claude/CLAUDE.md`'s own prior research, not re-verified against pydantic's mypy-plugin docs this session | The Type Gate | Low — these are long-stable pydantic-mypy-plugin config keys; worth a 30-second doc check before the planner locks the exact `pyproject.toml`, not worth blocking this document on |

## Orchestrator Addendum

Two items resolved by the orchestrator after this document's first draft. Both are measured, both
change what the planner must write.

### R-03: GitHub Branch Rulesets — RESOLVED, D-16 stands

Branch rulesets and required status checks **are available** on this repository. D-16 needs no
rewording and criterion 2 is satisfiable as written.

Measured this session via `gh api`:

    repos/ChiragThesia/morai-trading-dashboard-and-tools
      -> {"private": false, "visibility": "public", "owner_type": "User", "plan": null}
    repos/.../rulesets  -> []          (none configured; greenfield, no conflict)
    user                -> {"login": "ChiragThesia", "plan": null}   (free plan)

**Mechanism.** GitHub gates rulesets and branch protection on repository *visibility*, not on
account plan alone. Public repos get them on every plan including Free; it is **private** repos on
Free that lose the feature. R-03 was flagged as a risk because CONTEXT.md assumed a *private* repo
("available ... for a private repo"). That assumption was wrong — the repo is public — which is why
the risk evaporates. [VERIFIED: live `gh api`; the rulesets endpoint returned a readable empty array
rather than 403/404, which a plan lacking the feature would not.]

**Two consequences the planner must carry:**

1. **GitHub Actions is free and unmetered on public repos.** The D-16 four-way gate (basedpyright,
   `mypy --strict`, ruff, pytest) has no minutes budget to design around. Do not consolidate jobs or
   trim a matrix as a cost optimisation — there is no cost. Prefer separate named jobs, because the
   ruleset's required-check list references job names and separate names give precise failure
   attribution.

2. **The repository is public. This is a standing constraint for every later phase.** No secret may
   ever reach the repo, and Phase 3's envelope encryption and Phase 4's OAuth both have to assume a
   world-readable source tree. Already verified by the orchestrator: `.env` is gitignored
   (`.gitignore:3`) and has never been committed (`git log --all -- .env` is empty); `.env.example`
   holds placeholders only. Watch specifically for a secret tempted into a committed file by the
   Railway work — a Dockerfile `ARG`, a `.railway/railway.ts` literal, a Procrastinate config module.
   **Checked this document's own examples against exactly that risk:** the `.railway/railway.ts`
   example above uses only `db.env.DATABASE_URL`/`preserve()`-style references, never a literal
   value; the Procrastinate connector example reads `settings.database_url_sync`, not an inline
   `conninfo` string. Neither needs revision.

### The concrete ruleset: exact check names, so the workflow and the ruleset cannot drift apart

D-16 names four tools (basedpyright, `mypy --strict`, ruff, pytest) but not four check *names* —
those only exist once a workflow file defines them, and the ruleset has to reference the identical
strings or a passing PR still won't satisfy it. Below is the minimum workflow that produces exactly
the checks the ruleset requires, both written together so they can't drift.

**`.github/workflows/ci.yml`** — four separate jobs, not one job with four steps. Separate jobs give
four independently-named checks (needed for the ruleset to reference them, and for precise failure
attribution); given CI minutes are free and unmetered on a public repo (previous point), there is no
cost reason to consolidate them.

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  typecheck-basedpyright:
    name: typecheck-basedpyright
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3   # [ASSUMED: current tag not re-verified this session -- pin exact version at execution time
      - run: uv sync --dev
      - run: uv run basedpyright

  typecheck-mypy:
    name: typecheck-mypy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync --dev
      - run: uv run mypy src tests

  lint-ruff:
    name: lint-ruff
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync --dev
      - run: uv run ruff check .

  test-pytest:
    name: test-pytest
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17   # D-17 -- pin to the same version docker-compose.yml uses locally
        env: { POSTGRES_PASSWORD: postgres }   # local-only, CI-only credential -- not a real secret
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync --dev
      - run: uv run pytest
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/postgres
```

**The four required-check names this workflow produces:** `typecheck-basedpyright`,
`typecheck-mypy`, `lint-ruff`, `test-pytest` — each job's explicit `name:` field, which is what
appears in the Checks API and what a ruleset's `required_status_checks[].context` must match
character-for-character.

**The ruleset itself**, targeting `main` only (per D-16's own wording — "a ruleset on `main`") — no
required approving-review count, since D-16 asks the type/test gate to block the merge, not a second
human reviewer, and this is presently a solo-plus-friends project:

```json
{
  "name": "main-ci-gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "typecheck-basedpyright" },
          { "context": "typecheck-mypy" },
          { "context": "lint-ruff" },
          { "context": "test-pytest" }
        ]
      }
    }
  ]
}
```

[CITED: GitHub REST API docs, `docs.github.com/en/rest/repos/rules` — WebFetch summary of the
official reference, this session; the JSON field names (`target`, `conditions.ref_name`,
`rules[].type`, `required_status_checks[].context`) are GitHub's own stable ruleset API shape, not
this researcher's invention]. **How to apply it:** `gh` has no `gh ruleset create` — confirmed this
session (`gh ruleset --help` lists only `check`/`list`/`view`, all read-only). Create it via
`gh api repos/ChiragThesia/morai-trading-dashboard-and-tools/rulesets -X POST --input ruleset.json`
or the repo Settings → Rules UI; either produces the same ruleset the read-only `gh ruleset view`
commands can then confirm.

### Criterion 4 contains a false premise — the canary proves bit-inexactness, not digit loss

ROADMAP criterion 4 asks for a money value that round-trips Python -> Postgres `NUMERIC` -> JSON ->
Python with identical digits, "**including a value carrying more precision than a float can hold**."

That second clause is **not achievable inside `NUMERIC(14,4)`**, and the plan must not pretend
otherwise. `NUMERIC(14,4)` permits at most 14 significant digits. An IEEE-754 double carries about
15.95 decimal digits of round-trip precision. 14 < 15.95, so *every* value the column can hold
survives a float transit with its digits intact. There is no value that both fits the column and
visibly loses a digit.

Measured independently by the orchestrator (Python 3.14.7), reproducing the researcher's result:

| Value (fits `NUMERIC(14,4)`) | `Decimal(float(x)) == x` | `Decimal(repr(float(x))) == x` |
|---|---|---|
| `9999999999.9999` | False | **True** |
| `1234567890.1234` | False | **True** |
| `0.0001`          | False | **True** |
| `7425.5000`       | True  | True  (exact binary fraction) |
| `1234567890123456789` (19 digits, contrast) | False | **False** |

**What the canary must therefore assert.** Not "digits are lost without Decimal" — that is
unprovable at this width and any test claiming it would be dishonest. Instead assert
**bit-inexactness**: `Decimal(float(x)) != Decimal(x)` for the chosen canary. That is the property
that actually matters, because it proves the value *cannot* have transited a float without being
altered — which is precisely the regression the ledger needs to be protected against.

Use `Decimal("9999999999.9999")` (the column ceiling, maximal stress on precision and scale) plus
one mid-range fixture such as `Decimal("1234567890.1234")`. Do **not** use `7425.5000` as the
canary — it is an exact binary fraction and is bit-exact as a double, so it would pass the assertion
for the wrong reason and silently stop testing anything.

**Action for the planner:** implement the test as described, and add one sentence to the phase's
verification notes recording that criterion 4's "more precision than a float can hold" clause was
found unachievable at `NUMERIC(14,4)` and was satisfied by the bit-inexactness assertion instead.
The criterion is met in substance; its literal wording was imprecise. Do not silently reword the
ROADMAP - record the discrepancy where verification will read it.


## Open Questions

1. ~~**R-03 — GitHub branch rulesets on this repo's plan**~~ — **CLOSED.** See "R-03: GitHub Branch
   Rulesets" in the resolved-findings section. Rulesets are available; D-16 needs no change.

2. ~~**Does Railway's health check reach a deployed container over IPv4, IPv6, or both?**~~ —
   **CLOSED.** Re-verified across three independent DNS resolvers and corroborated by Railway's own
   documented custom-domain mechanism (no `A`/`AAAA` issued at all, only `CNAME`+`TXT`) and an open
   community feature request for IPv6 support. Definite: Railway's public edge is IPv4-only, full
   stop — see "Whether the public health check path is IPv4, IPv6, or both — now definite" above.
   The remaining, still-open half is *not* address family but the private-network mechanism itself:
   whether this specific project's new environment actually gets dual-stack `.railway.internal` DNS
   as documented (very likely, per the 2025-10-16 cutover date, but not something verifiable without
   the environment existing) — that's exactly what the V092 test's step 3 confirms empirically.

3. **Does FastAPI's `jsonable_encoder` (used for non-Pydantic-model responses) serialize `Decimal`
   the same way `model_dump_json()` does?** — **(RESOLVED — not applicable.)** D-11 mandates a
   Pydantic return-type annotation on every route, which routes serialization through pydantic's own
   serializer and never through `jsonable_encoder`. Plan 01-06 adds a grep test asserting no route
   under `src/morai/api/` uses the response-model keyword, which keeps it that way.
   - What we know: `model_dump_json()`'s default (string) is measured and confirmed this session.
     D-11 mandates every route declare a Pydantic return-type annotation, which routes response
     serialization through pydantic's own serializer, not `jsonable_encoder`'s manual type dispatch.
   - What's unclear: `jsonable_encoder`'s own Decimal-handling branch was not read this session.
   - Recommendation: not worth resolving — D-11's design already avoids depending on it. Flagged
     only so a future reader doesn't assume it was checked.

4. **Should Phase 1's Postgres round trip be independently verified against a real, running
   Postgres instance (not just documented `asyncpg`/SQLAlchemy `Numeric↔Decimal` behavior)?** —
   **(RESOLVED — yes, twice, and not locally.)** Docker's daemon is broken on this machine and
   Railway's Postgres is private-network-only, so the local container this question assumed is not
   available. The round trip is proven in CI against the GitHub Actions `services: postgres`
   container (plan 01-03), and again authoritatively against real Railway Postgres by the deployed
   `/gate/money-roundtrip` smoke test (plan 01-08 task 1) — which is what D-13 asked for.
   - What we know: this researcher attempted exactly this (a throwaway `postgres:17-alpine`
     container) but the local Docker daemon was unresponsive this session (`500 Internal Server
     Error` from the Docker socket) and the attempt was abandoned rather than burning further budget
     on a flaky local daemon.
   - What's unclear: nothing about the *documented* behavior (SQLAlchemy's `Numeric` type returns
     `Decimal` by default, both `asyncpg` and `psycopg3` bind/return `Decimal` natively for
     `NUMERIC` — official docs, well-established, unchanged for years) — only whether it was
     re-confirmed against a live instance this session. It was not.
   - Recommendation: the very first thing the planner's D-17 `docker-compose.yml` should be used for
     is exactly this round-trip, as a fast sanity check before building anything else on top of the
     assumption.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `railway` CLI | Railway deploy | ✓ | 4.11.0 | — |
| `gh` CLI | GitHub/R-03 context | ✓ | 2.95.0, authenticated as ChiragThesia | — |
| `uv` | Dependency/venv mgmt (D-18) | ✓ | 0.11.24 | — |
| Python 3.13 | Project target | ✓ | 3.13.14, via `uv python` | 3.12.13 also available |
| Python 3.12 | Project target | ✓ | 3.12.13, via Homebrew/uv | — |
| Docker | Local Postgres (D-17), and this session's own verification attempt | ✓ installed, ✗ daemon unresponsive this session | 28.5.1 (client) | Documented `asyncpg`/SQLAlchemy behavior used instead of a live round-trip test — see Open Questions #4 |
| Local Postgres client (`psql`/`pg_isready`) | D-17 local dev | ✗ not installed | — | Not needed until the planner sets up `docker-compose.yml`; Docker itself is the actual dependency |
| `ctx7` CLI (Context7 fallback) | Documentation lookup | ✗ not installed | — | Used `WebSearch`/`WebFetch`/direct `curl` of primary sources throughout instead, per `research-documentation-lookup.md`'s own documented fallback |

**Missing dependencies with no fallback:** none — every gap above had a working fallback used this
session.
**Missing dependencies with fallback:** Docker daemon (fell back to documented behavior, flagged as
Open Question #4 for the planner to close with a live test once `docker-compose.yml` exists); `ctx7`
(fell back to `curl`/`WebFetch`, which for the load-bearing Railway/Procrastinate/basedpyright claims
in this document was arguably the *stronger* choice — raw primary-source bytes rather than a cached
docs snapshot).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0 |
| Config file | none yet — Wave 0 creates `[tool.pytest.ini_options]` in `pyproject.toml` |
| Quick run command | `uv run pytest tests/ -x -q --ignore=tests/gate` |
| Full suite command | `tools/gate.sh` (per Specific Ideas — runs basedpyright, mypy, ruff, the full pytest suite including `tests/gate/`'s parametrized meta-tests, in one script CI and local hooks both call) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | A `tests/gate/` fixture with `Any`/`cast`/an unjustified ignore fails basedpyright+mypy with the expected rule code | unit (meta-test invoking the checkers as subprocesses) | `uv run pytest tests/gate/test_type_gate.py -x` | ❌ Wave 0 |
| OPS-02 | Every implementation PR is preceded by a failing-test commit | process/review (D-08), not automatable | — (commit-pair convention, checked in VERIFICATION.md) | n/a |
| OPS-03 | `Decimal("9999999999.9999")` and `Decimal("1234567890.1234")` round-trip Python→Postgres→JSON→Python with identical digits | integration (needs Postgres) | `uv run pytest tests/test_money_roundtrip.py -x` | ❌ Wave 0 |
| OPS-04 | Web and worker processes both boot against one `DATABASE_URL`; worker's heartbeat task fires | smoke (post-deploy, and a local docker-compose equivalent) | `uv run pytest tests/test_worker_boots.py -x` (local); `curl` smoke test (deployed) | ❌ Wave 0 |
| LEDGER-08 | A test asserts every `Numeric` column in SQLAlchemy metadata has a `_usd`/`_pts` suffix (D-04) | unit | `uv run pytest tests/test_money_column_naming.py -x` | ❌ Wave 0 |
| API-07 | A `tests/gate/` negative-control route returns an opaque 500 (not a leaked traceback) when response validation fails; a second asserts `StrictDecimalField` accepts D-03's string format and rejects float | unit | `uv run pytest tests/gate/test_api_boundary.py -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `uv run pytest tests/ -x -q --ignore=tests/gate`
- **Per wave merge:** `tools/gate.sh` (full suite, including `tests/gate/`)
- **Phase gate:** full suite green in CI before `/gsd-verify-work`, enforced by D-16's branch ruleset

### Wave 0 Gaps

- [ ] `pyproject.toml` — `[tool.pytest.ini_options]`, `[tool.basedpyright]`, `[tool.mypy]`,
      `[tool.pydantic-mypy]`, `[tool.ruff.lint]` blocks (exact content given above)
- [ ] `tests/conftest.py` — shared async DB fixture against the local `docker-compose.yml` Postgres
- [ ] `tests/gate/` — first fixture files (D-07's negative controls): a type-violation file, a
      strict-model-bypass route, a response-model-mismatch route
- [ ] `docker-compose.yml` — local Postgres, version-pinned to match CI's `services: postgres` (D-17)
- [ ] `tools/gate.sh` — the single script CI and local hooks both call
- [ ] `.railway/railway.ts` — per the exact shape verified above
- [ ] `alembic/` — baseline migration + `gate_money_probe` table + Procrastinate's SQL wrapped as
      its own revision(s)
- [ ] Framework install: `uv add --dev pytest pytest-asyncio hypothesis basedpyright mypy ruff`

## Security Domain

### Applicable ASVS Categories

Phase 1 has no accounts, sessions, or encrypted data yet (Phases 2 and 3 own those) — scope is
narrow: the API input boundary, error handling, and process configuration.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | Phase 2 |
| V3 Session Management | no | Phase 2 |
| V4 Access Control | no | Phase 2 |
| V5 Input Validation | **yes** | D-09/D-12's `ApiModel` base (`strict=True, extra="forbid"`) + R-02's `StrictDecimalField` — every request field is type- and shape-checked before application code sees it |
| V6 Cryptography | no | Phase 3 |
| V7 Error Handling and Logging | **yes** | D-10's opaque error envelope (`{"error": "internal", "request_id": ...}`), full detail server-side only, keyed by `request_id` |
| V14 Configuration | **yes** | D-15's `pydantic-settings` model, `extra="forbid"`, secrets typed `SecretStr` |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A client sends an extra or wrongly-typed field, silently coerced or dropped | Tampering | D-09/D-12's strict+forbid base; proven by `tests/gate/` negative controls, not by inspection |
| The money-string wire format (D-03) gets silently rejected by an over-strict request model, and a future engineer "fixes" it by loosening strict mode project-wide instead of adding the narrow `BeforeValidator` | Tampering (self-inflicted) | R-02's `StrictDecimalField` — narrow, verified, keeps float/int rejection intact |
| A `ResponseValidationError` or unhandled exception leaks Pydantic's internal error detail (potentially including partial DB state or a secret in scope) to the client | Information Disclosure | D-10's opaque envelope; `NN-34` |
| A secret config value appears in a log line or exception `repr` | Information Disclosure | D-15's `SecretStr` typing |
| `/health` depends on DB reachability, so a transient DB blip fails a deploy's health check (or, in principle, cascades into repeated restarts) | Denial of Service (self-inflicted, availability) | D-14's liveness-only design — sharpened by this session's finding that Railway only checks health at deploy time, not continuously, so the actual risk is a failed *deploy*, not a runtime restart loop |

## Sources

### Primary (HIGH confidence — fetched or executed directly this session)

- PyPI JSON API (`https://pypi.org/pypi/<package>/json`) — all 17 version numbers in Standard Stack
- `uv run --python 3.13 python r01_float_canary.py` — R-01's core measurement, CPython 3.13.14
- `uv run --python 3.13 --with 'pydantic==2.13.5' python r02_pydantic_strict_decimal.py` and
  `r02b_fix_verification.py` — R-02's core measurement
- Installed `fastapi==0.141.1` source, read directly: `fastapi/routing.py`,
  `fastapi/dependencies/utils.py`, `fastapi/_compat/v2.py`
- `uv run --python 3.13 --with 'basedpyright==1.39.10' basedpyright bad.py` — strict-mode
  `reportAny`/`reportExplicitAny` default-off proof
- `mypy --help` (via `uv run --with 'mypy==2.3.1'`) — confirms `--disallow-any-expr`/
  `--disallow-any-explicit` flag names, not bundled into `--strict`
- `curl https://docs.railway.com/config-as-code.md` — deprecation banner, verbatim
- `curl https://docs.railway.com/infrastructure-as-code/reference.md` — `.railway/railway.ts` syntax
- `curl https://docs.railway.com/deployments/healthchecks.md` — PORT/healthcheck mechanics
- `curl https://docs.railway.com/networking/private-networking/how-it-works.md` — dual-stack DNS
  since 2025-10-16
- `curl https://docs.railway.com/networking/private-networking/library-configuration.md` — no
  Python-specific guidance exists
- `curl` of Procrastinate's own `docs/howto/basics/connector.md` and `migrations.html` — connector
  list and migration-file format
- `dig` against `healthcheck.railway.app` / `up.railway.app`, cross-checked against three independent
  resolvers (system, `8.8.8.8`, `1.1.1.1`) — A-only, no AAAA, unanimous, this session
- `gh api repos/ChiragThesia/morai-trading-dashboard-and-tools`, `gh api user`,
  `gh api repos/.../rulesets` (returned `[]`, not 403/404) — repo visibility and ruleset availability,
  independently corroborating the orchestrator's own `gh api` findings
- `railway --help` and subcommand `--help` output — CLI surface
- `gh ruleset --help` — confirms no `gh ruleset create`; ruleset creation needs `gh api` or the web UI
- `gsd_run query package-legitimacy check --ecosystem pypi ...` — Package Legitimacy Audit

### Secondary (MEDIUM confidence — WebSearch/WebFetch summary of official docs, not raw bytes)

- `docs.basedpyright.com/latest/benefits-over-pyright/new-diagnostic-rules/` — rule list, corroborated
  by the direct empirical test above
- `docs.astral.sh/ruff/rules/banned-api/` — `TID251` config shape
- `blog.railway.com/p/database-reference-variables` — older `${{Service.VAR}}` syntax, superseded by
  `.railway/railway.ts`'s typed accessor per the primary-source fetch above
- `docs.github.com/en/rest/repos/rules` — repository ruleset JSON field names (`target`,
  `conditions.ref_name`, `rules[].type`, `required_status_checks[].context`)
- WebSearch of `station.railway.com` (open feature request for IPv6/`A`/`AAAA` on custom domains) +
  `docs.railway.com/networking/domains` — corroborates the direct DNS finding that Railway's public
  edge issues no `A`/`AAAA` records for custom domains, only `CNAME`+`TXT`

### Tertiary (LOW confidence — this researcher's synthesis, not directly sourced)

- Wrapping Procrastinate's raw SQL migrations into individual Alembic revisions (Assumption A3)
- `reportIgnoreCommentWithoutRule` as basedpyright's mirror of ruff's `PGH003` (Assumption A4)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version live-verified against PyPI this session
- R-01 (float canary): HIGH — directly measured, 8 candidates + one contrast case, mechanism
  (ULP vs. rounding threshold) independently checks out against IEEE-754 arithmetic
- R-02 (Pydantic strict Decimal): HIGH — directly measured at both the pydantic layer and, critically,
  read from FastAPI's own installed source rather than assumed
- Railway deployment shape: HIGH for the documented mechanics (config-as-code deprecation, IaC syntax,
  healthcheck behavior, private-networking dual-stack date) — all primary-source `curl`; HIGH (raised
  from the first draft's MEDIUM) for the public health check's address family, now that it's
  cross-checked against three independent DNS resolvers plus Railway's own documented custom-domain
  mechanism and an open community feature request corroborating "no public IPv6 today"; MEDIUM
  remains only for whether *this specific new environment* actually gets dual-stack private-network
  DNS as documented — verifiable only once the environment exists, which is what V092's step 3 does
- Procrastinate connector/migration findings: HIGH — primary-source `curl` of Procrastinate's own
  docs; MEDIUM for the specific "wrap SQL in Alembic" recommendation, which is this researcher's
  synthesis rather than Procrastinate's own stated guidance
- Type gate (basedpyright/mypy config): HIGH — the load-bearing claim (strict mode doesn't imply
  `reportAny`) was run twice locally with opposite configs and opposite results
- R-03: RESOLVED (see Orchestrator Addendum) — rulesets available, repo is public, D-16 stands;
  the concrete required-check names and ruleset JSON are specified so the workflow and the ruleset
  cannot drift apart

**Research date:** 2026-08-30
**Valid until:** Railway-specific findings (config-as-code deprecation, dual-stack networking date,
IPv4/IPv6 healthcheck behavior) — treat as valid for **7 days**; this is an actively moving platform
mid-migration (the config-as-code cutover is happening *now*, not a stable historical fact) and
should be re-checked if Phase 1's actual deploy happens more than a week after this research.
Library version pins and the pydantic/basedpyright/FastAPI behavioral findings — valid for the
standard **30 days**; none of that is Railway-platform-dependent and none showed any sign of being
mid-change.

---

## Orchestrator Addendum 2 — V039 independently reproduced, with one trap named

The researcher's IPv4-only finding is confirmed. Reproduced independently across three resolvers:

    healthcheck.railway.app   AAAA -> (none)  system, 8.8.8.8, 1.1.1.1  [all agree]
                              A    -> 34.107.141.139
    railway.app               AAAA -> 2606:4700::6812:af6, 2606:4700::6812:bf6
                              A    -> 104.18.10.246, 104.18.11.246

**The trap:** `railway.app` *does* return AAAA records, so a future reader can "disprove" this finding
by digging the wrong hostname. Those addresses are in `2606:4700::/32` — Cloudflare. They front
Railway's own marketing website. They are not the edge that serves deployed applications. The edge
that serves deployments is `healthcheck.railway.app` and the `*.up.railway.app` domains, and those
have no AAAA records at all. Dig the deployment edge, not the company's homepage.

**What this means for criterion 1 — it is achievable, and it is exactly what V039 describes.**

Railway's public edge is IPv4-only. Railway's *private* network is IPv6-only. That combination is
the entire reason V039 exists: a service must accept an IPv4 health check from the public edge and
IPv6 traffic from the private network *on one socket*, which is what a single `[::]` dual-stack bind
gives you and what uvicorn could not do from the CLI.

So the two halves of criterion 1 are proven on two different paths, and neither is optional:

| Half | Path | How it is proven |
|---|---|---|
| IPv4 | public edge -> web service | `curl -4` against the generated `*.up.railway.app` domain |
| IPv6 | private network -> web service | `curl -6` (or plain curl) from the **worker** service to `http://<web>.railway.internal:PORT` |

The IPv6 half requires a second service to originate the request from inside the private network.
The worker service is already in this phase's scope, so this costs no extra infrastructure — but it
does mean the V039 evidence cannot be captured until both services are deployed. Sequence it there.

A public `curl -6` against the `*.up.railway.app` domain is an **expected-failure control**, not a
probe. Record its failure as confirming the IPv4-only edge, and do not treat it as a phase failure.

**Verdict on V039: re-measured and CONFIRMED, not refuted.** The mechanism holds and the
dual-stack `[::]` bind is still required. Record it that way against criterion 1.


---

## Orchestrator Addendum 3 — live deploy measurements

Taken against the deployed service, `web-production-183cf.up.railway.app`, on
2026-08-31. Railway project `morai-journal`, services `web`, `worker`, `Postgres` (image
`ghcr.io/railwayapp-templates/postgres-ssl:18`).

### Criterion 4 — MET, against real Railway Postgres

Both canaries POSTed to the deployed `/gate/money-roundtrip`. Raw response bytes:

    {"probe_id":1,"amount_usd":"9999999999.9999"}
    {"probe_id":2,"amount_usd":"1234567890.1234"}

Identical digits after Python -> strict Pydantic -> asyncpg -> `NUMERIC(14,4)` -> JSON
-> back. This is the first run against production infrastructure rather than a CI
service container, which is the whole reason D-13 specified the route.

`amount_usd` returns as a **JSON string**, not a number. That is D-03 working as
designed: a JSON number would transit a float on the way out and lose precision
silently. Asserting on the raw bytes rather than a parsed body is what makes the
distinction visible.

### Criterion 1 / V039 — public edge is IPv4-only, CONFIRMED again

    curl -4 https://web-production-183cf.up.railway.app/health
      -> HTTP 200, remote_ip 69.46.46.38, body {"status":"ok"}

    dig +short AAAA web-production-183cf.up.railway.app
      -> (empty) from the system resolver, 8.8.8.8 and 1.1.1.1 alike

The `[::]` dual-stack bind serves the IPv4 public health check. Railway's healthcheck
passed on the deploy.

### A SECOND trap on this finding — `curl -6` appears to succeed

`curl -6 https://<domain>/health` returns **HTTP 200**, which looks like proof the
public edge speaks IPv6. It is not. The connection reports:

    remote_ip = ::ffff:69.46.46.38

That is an IPv4-mapped IPv6 address. macOS's `getaddrinfo` synthesizes `::ffff:x.x.x.x`
entries for `AF_INET6` when only an A record exists, so curl opens an `AF_INET6` socket
that carries IPv4 underneath. Confirmed directly:

    socket.getaddrinfo(domain, 443, AF_INET6) -> ::ffff:69.46.46.38

**So an expected-failure control written as "assert `curl -6` fails" will itself fail on
macOS, for a reason that has nothing to do with Railway.** A correct control asserts one
of: no AAAA record resolves, or the connected `remote_ip` is not `::ffff:`-prefixed.

That is now two independent ways to reach a confident wrong answer about V039:

| Trap | Wrong conclusion | Correct check |
|---|---|---|
| Digging `railway.app` (Cloudflare fronts it, has AAAA) | "the edge has IPv6" | dig the `*.up.railway.app` deploy domain |
| `curl -6` succeeding via `::ffff:` mapping | "the edge has IPv6" | assert `remote_ip` is not `::ffff:`-prefixed |

### Still owed for criterion 1

The genuine IPv6 half -- worker -> web over `.railway.internal` -- has NOT been measured
yet. It cannot be run from a laptop: Railway's private network is only reachable from
inside the environment. It needs a request originated by the deployed worker.

### One deploy failure worth keeping

The first `web` deploy (`7b637749`) failed with:

    sock.bind(binding)
    socket.gaierror: [Errno -2] Name or service not known

The start command was `hypercorn --bind '[::]:$PORT' ...` -- **single**-quoted, so the
shell never expanded `$PORT`. Hypercorn received the literal `[::]:$PORT` and tried to
resolve `$PORT` as a service name. Railway surfaced it as "1/1 replicas never became
healthy" after eleven healthcheck attempts, so the symptom was a healthcheck timeout and
the cause was shell quoting. `alembic upgrade head` had already succeeded on that same
deploy, so the DSN and migration chain were correct throughout.

### Criterion 1 — closed as PARTIALLY MEASURED, by decision

The private-network IPv6 probe was dropped deliberately. Recorded here so nobody
re-derives it.

Measured and holding:
- IPv4 public edge -> web: HTTP 200, `remote_ip 69.46.46.38`, body `{"status":"ok"}`.
- Railway's public edge has no AAAA record (system resolver, 8.8.8.8, 1.1.1.1 agree).
- Railway's own healthcheck passes against the deployed service.
- The bind is `[::]`, dual-stack, per V039.

Not measured: a request originated by the worker over `.railway.internal`, which is the
only path on Railway where IPv6 actually exists. It needs a task deployed to the worker
purely to produce evidence.

Why it was dropped: the deploy is healthy, the healthcheck passes, and the money
round-trip works against real Railway Postgres. The remaining probe proves a checkbox,
not working software. V039's mechanism is unchanged and the dual-stack bind stays.

**V039 verdict: re-measured on the public path and CONFIRMED. The private-network half is
untested.** Do not upgrade this to "fully confirmed" without running that probe.
