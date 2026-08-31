# Phase 1: Walking Skeleton - Context

**Gathered:** 2026-08-29
**Status:** Ready for planning

<domain>
## Phase Boundary

A typed FastAPI web service and a separate Procrastinate worker run on Railway against Postgres, and
the build fails when the project's engineering constraints are violated.

This phase delivers the enforcement machinery every later phase inherits: the strict type gate, the
test-first evidence convention, the money-unit type system, the API validation boundary, and a
deployed vertical slice that proves a `Decimal` survives Python → Postgres `NUMERIC` → JSON → Python
unchanged on real Railway hardware.

Not in this phase: accounts, sessions, encryption, Schwab, trade tables, fill pairing. Each owns
its own phase. The `gate_money_probe` table is the only table Phase 1 creates.

</domain>

<decisions>
## Implementation Decisions

### Money and Units

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

### The Type Gate (OPS-01)

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

### API Boundary (API-07)

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

### Deployed Slice and Migrations (OPS-03, OPS-04)

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

### CI and Merge Gate (criteria 2, 3)

- **D-16:** GitHub Actions runs basedpyright, `mypy --strict`, ruff and pytest. A **ruleset on
  `main`** marks them required and requires a pull request. Phase work moves to `gsd/phase-N-slug`
  branches, which means flipping `.planning/config.json` `git.branching_strategy` from `none` to
  phase branches. This is the only option that satisfies criterion 2's "cannot be merged" literally.
  `/gsd-pr-branch` already exists to keep `.planning/` commits out of the PR.

- **D-17:** Postgres for tests comes from a GitHub Actions `services: postgres` container in CI and a
  two-line `docker-compose.yml` locally, pinned to the same version in both places, one
  `DATABASE_URL` shape. Rejected: `testcontainers-python` (a dependency and Docker inside the test
  run) and a Railway dev database (cost, latency, shared mutable state between CI and local work).

### Project Layout and Build

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

### Repo Hygiene and Documentation (criterion 6)

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

### Open for Research (not decided here)

These three were surfaced during discussion and deliberately left for `gsd-phase-researcher`:

- **R-01:** The float canary for criterion 4. `NUMERIC(14,4)` caps at 14 significant digits, so the
  "more precision than a float can hold" value must be chosen for **binary non-representability**
  (e.g. `Decimal("1234567890.1234")`), not digit count. A 14-digit value alone proves nothing.
- **R-02:** Pydantic v2 strict-mode semantics for `Decimal` with JSON input. D-03 serializes
  `Decimal` as a string and D-12 makes request models strict; if strict mode rejects a JSON string
  for a `Decimal` field, the system's own response will not validate as a request. Pin the actual
  behaviour before writing the API models.
- **R-03:** Whether branch rulesets / required status checks are available on this repository's
  GitHub plan for a private repo. D-16 depends on it. If they are not, criterion 2 needs either a
  plan change or a rewording — do not assume either.

### Claude's Discretion

None. Every gray area presented was answered explicitly; no "you decide" was taken.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project law — read first
- `REBUILD-BRIEF.md` §3 — the 45 non-negotiables. Load-bearing here: `NN-8` (every money field's
  unit is named, never inferred), `NN-34` (an OAuth code and its redirect URL are bearer-equivalent
  secrets — never rendered, logged, or echoed in an error).
- `docs/learnings/LAWS.md` — 101 stack-independent laws. Directly cited by these decisions: `L058`
  (`.parse()` silently strips unknown keys, and the adapter-function fix), `L076` (a computed value
  that never reaches its consuming field).
- `.claude/rules/workflow.md` — order of authority, evidence discipline, minimal-impact change rule.
  Governs D-20, D-21 and D-22.
- `docs/docs-on-docs/hemingway-style.md` — prose style, enforced on all documentation this phase
  writes or edits.

### Vendor and platform traps
- `docs/learnings/vendors-and-infra.md` `V039` — Railway needs an IPv4 health check and an IPv6
  private network at once; uvicorn could not bind both from the CLI in v1. Flagged partially stale;
  this phase re-measures it and appends `V092` (D-22).
- `docs/learnings/vendors-and-infra.md` `V091` — iCloud-synced folders produce ` 2` duplicate files
  and one reached git history. Mechanism, bandaid and real fix. Governs D-20.

### Stack decisions carried in
- `.planning/research/STACK.md` — versions, the basedpyright-vs-mypy argument behind D-05, the
  Hypercorn/uvicorn dual-bind argument behind D-19. **§2 is superseded by D-11** on
  `response_model=` versus the return annotation.
- `.planning/research/ARCHITECTURE.md` — service topology and the boundaries later phases inherit.
- `.planning/research/PITFALLS.md`, `.planning/research/FEATURES.md`,
  `.planning/research/SUMMARY.md` — the rest of the pre-roadmap research.

### The money bug this phase types against
- `docs/learnings/app-postmortem.md` — `openNetDebit` stored in dollars fed to a formula expecting
  index points; +$395 displayed as −$319,850, five rounds of oracle-driven debugging. D-01 through
  D-04 exist for this.
- `salvage/measured-constants.md` — 31 constants with the experiment behind them, and 40 with none,
  marked as such. Read before inventing a number.
- `salvage/oracle-fixtures.md` — 13 real Schwab calendars plus a synthetic negative control. Not used
  in Phase 1, but D-07's negative-control pattern is copied from it.
- `salvage/invariants.md` — the invariants the ledger must hold.

### Scope and requirements
- `.planning/ROADMAP.md` — Phase 1 goal, six success criteria, the owned V039 spike.
- `.planning/REQUIREMENTS.md` — OPS-01, OPS-02, OPS-03, OPS-04, LEDGER-08, API-07.
- `.planning/PROJECT.md` — constraints and Key Decisions. Source of the `mypy --strict` constraint
  that D-05 reconciles.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

**None. This is a greenfield phase in a repository with no application code.** The v1 system was
deleted at `fd4f8d3` — 1,594 files, ~170,000 lines. There is no `pyproject.toml`, no lockfile, no
test suite, no CI. Phase 1 creates all of it.

What exists instead is a written record, and it is load-bearing: 337 numbered learnings, 3,853 lines
of salvage, and the rebuild research. The habit the repo asks for — grep `docs/learnings/` before
making a decision this project has already made — applies to every task in this phase.

### Established Patterns

- **Learning IDs are append-only.** They are cross-cited between five files and from
  `REBUILD-BRIEF.md`. Renumbering breaks those citations silently. D-22 follows from this.
- **Evidence before "done".** `.claude/rules/workflow.md` forbids claiming complete without running
  the proof and showing the output. D-08's commit-pair convention is this rule applied to TDD.
- **`docs/architecture/` is history, not authority.** 18 files describing the deleted system. Do not
  plan against it.
- **Negative controls are how this project proves a gate works** — the oracle ships a 14th synthetic
  fixture that must fail. D-07 copies the pattern for the type gate.

### Integration Points

None inside the repo. The external ones this phase creates:

- Railway — two services from one repo, differing only in start command, both pointed at one
  `DATABASE_URL`. Web: `hypercorn --bind '[::]:8000' morai.api.app:app`. Worker:
  `procrastinate --app morai.worker.app.app worker`.
- GitHub — `origin` is `git@github.com:ChiragThesia/morai-trading-dashboard-and-tools.git`, currently
  solo on `main` with `git.branching_strategy: "none"`. D-16 changes both.

</code_context>

<specifics>
## Specific Ideas

- The `/gate/money-roundtrip` route is a deliberate, permanent piece of production surface, not
  scaffolding. It is what proves criterion 4 on the deployed service rather than only in CI. Its
  table is dropped by an explicit migration when Phase 3 lands the real schema.
- `tests/gate/` is a first-class directory holding negative controls for the type gate, the response
  models, and repo hygiene. Every gate this phase installs ships with a fixture that must fail.
- One script, `tools/gate.sh`, holds the gate commands so CI and any local hook call the same thing
  and cannot drift.
- The `V092` entry must name the Python version and base image nixpacks produced, not only the bind
  result — see D-19.

</specifics>

<deferred>
## Deferred Ideas

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

</deferred>

---

*Phase: 1-Walking Skeleton*
*Context gathered: 2026-08-29*
