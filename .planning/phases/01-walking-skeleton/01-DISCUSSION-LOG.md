# Phase 1: Walking Skeleton - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-29
**Phase:** 1-Walking Skeleton
**Areas discussed:** Money unit types, Strict type gate stack, Response-model teeth, Skeleton slice +
CI gate, V091 / iCloud, Layout + packaging, Railway topology + secrets, Root CLAUDE.md rewrite

---

## Money unit types

### How should a money value carry its unit in the type system?

| Option | Description | Selected |
|--------|-------------|----------|
| NewType over Decimal | Zero runtime cost, native Pydantic/SQLAlchemy support, arithmetic decays to `Decimal` so results must be re-wrapped | ✓ |
| Frozen value object | Typed `__add__`/`__sub__`, arithmetic preserves unit, runtime-real; needs Pydantic serializer + SQLAlchemy `TypeDecorator` | |
| Phantom generic `Money[U]` | One class, unit as type parameter; same serialization cost plus generics surface where the two checkers disagree | |

**User's choice:** NewType over Decimal
**Notes:** The re-wrap noise was accepted as a feature — each re-wrap is a place the unit is asserted.

### Where does the contract multiplier live, and how do the two units convert?

| Option | Description | Selected |
|--------|-------------|----------|
| One fn, explicit arg | Single `units.py`, multiplier required and never defaulted, `100` grep-asserted to appear once | ✓ |
| One fn, constant default | Same function with `multiplier = SPX_MULTIPLIER`; cleaner call sites, silently wrong for a non-100 instrument | |
| Defer to Phase 5 | Types only in Phase 1; conversion arrives with real fills | |

**User's choice:** One fn, explicit arg
**Notes:** Directly targets the v1 mechanism — dollars fed to a formula expecting index points.

### How does a Decimal cross the wire in API responses?

| Option | Description | Selected |
|--------|-------------|----------|
| String, always | Pydantic v2's JSON-mode default; only option that survives a float64 JS client | ✓ |
| Number, with a guard | Nicer for naive clients; needs a serializer override and a runtime range guard on every money field | |
| String + scale in the field name | Self-describing for the future UI; two places that can drift from the column | |

**User's choice:** String, always

### How is the unit named on Postgres columns and JSON fields?

| Option | Description | Selected |
|--------|-------------|----------|
| Suffix + metadata test | `_usd`/`_pts` mandatory, enforced by a test walking SQLAlchemy metadata | ✓ |
| Suffix by convention | Documented in the migration and rules, enforced by review | |
| Type only, plain columns | Unit lives in the Python `NewType` alone | |

**User's choice:** Suffix + metadata test
**Notes:** Chosen because the v1 bug lived in a value read straight out of SQL, where no Python type
was in play.

**Flagged during this area:** `NUMERIC(14,4)` caps at 14 significant digits, so criterion 4's float
canary must be chosen for binary non-representability, not digit count. Carried to CONTEXT.md as R-01.

---

## Strict type gate stack

**Conflict surfaced before questioning:** `PROJECT.md` names `mypy --strict`; `research/STACK.md`
argues basedpyright must be primary because only `reportAny` catches an `Any` flowing through an
intermediate expression out of an untyped vendor call.

### Which type checker is the merge gate?

| Option | Description | Selected |
|--------|-------------|----------|
| Both, basedpyright primary | basedpyright strict with `reportAny`/`reportExplicitAny` plus `mypy --strict`, both blocking | ✓ |
| mypy --strict only | Exactly what PROJECT.md says; accepts the `Any`-through-an-expression hole | |
| basedpyright only | Strictest single tool; drops the tool PROJECT.md names | |

**User's choice:** Both, basedpyright primary
**Notes:** Running both satisfies the PROJECT.md constraint rather than overriding it.

### What makes a suppression "justified", mechanically?

| Option | Description | Selected |
|--------|-------------|----------|
| Rule code + `# why:` | ruff `PGH003` forces the rule code, a test requires the comment, `Any`/`cast` banned by name | ✓ |
| Zero suppressions | No escape hatch at all; pressure goes to an untyped `object` plus runtime asserts | |
| Ratcheted baseline | Allowlist with counts that can only shrink; identical to a ban on an empty codebase | |

**User's choice:** Rule code + `# why:`

### How does CI prove the type gate still has teeth?

| Option | Description | Selected |
|--------|-------------|----------|
| Negative-control suite | `tests/gate/` violating fixtures, asserting non-zero exit and the expected rule code | ✓ |
| One-time manual proof | Push a violating branch once, paste the failing run into VERIFICATION.md | |
| Mutate the config instead | Flip each strictness knob off and assert the error count drops | |

**User's choice:** Negative-control suite
**Notes:** Same shape as the oracle's 14th synthetic negative control — a pattern the project already
trusts.

### What form does red-then-green evidence take, per phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Commit pair + pasted output | `test:` commit then `feat:` commit; both runs pasted with SHAs | ✓ |
| CI replays the red commit | Mechanical and unfakeable; breaks under squash-merge | |
| Pasted output only | Least ceremony; nothing ties the red output to a real commit | |

**User's choice:** Commit pair + pasted output

---

## Response-model teeth

**Correction issued mid-area:** FastAPI's `response_model` *does* raise on a missing or wrongly-typed
field. It silently drops extras and, in non-strict mode, coerces. The earlier framing ("does not
raise") was too broad, and it narrowed what this area had to solve.

### How do response models get teeth beyond FastAPI's defaults?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict base + control route | One `ApiModel` with `strict`, `extra="forbid"`, `frozen`; negative-control routes assert a raise | ✓ |
| Defaults + documented limits | Take FastAPI as it ships and write down that extras are dropped | |
| Custom APIRoute re-validate | Re-parse serialized bytes through the declared model; double parse per response | |

**User's choice:** Strict base + control route

### What does the client get when a response fails validation?

| Option | Description | Selected |
|--------|-------------|----------|
| Opaque 500 + request id | `{"error":"internal","request_id":...}`, detail to logs only | ✓ |
| Detailed 500 in dev only | Fast local loop; one env var between `exc.errors()` and the wire | |
| Typed error envelope | Machine-readable codes for every error path; front-runs Phases 2 and 4 | |

**User's choice:** Opaque 500 + request id
**Notes:** Chosen as the structural half of `NN-34` — a validation error is the path most likely to
have a token in scope.

### How is a route's response contract declared?

| Option | Description | Selected |
|--------|-------------|----------|
| Return annotation only | FastAPI infers `response_model`; checker and runtime both enforce it | ✓ |
| `response_model=` kwarg | What STACK.md currently says; contract invisible to the type checker | |
| Both, asserted equal | Belt and braces plus a sync test; two declarations of one fact | |

**User's choice:** Return annotation only
**Notes:** Explicitly supersedes `research/STACK.md` §2. Flagged so the planner does not inherit the
stale advice.

### Do request bodies inherit the same strictness as responses?

| Option | Description | Selected |
|--------|-------------|----------|
| Same base, both ways | Unknown client key is a 422, not a silent drop | ✓ |
| Strict out, lenient in | Postel's law; a client typo is accepted and the value never arrives | |
| Forbid extras, allow coercion | Sidesteps the Decimal-as-string tension; quiet type conversion inbound | |

**User's choice:** Same base, both ways
**Notes:** The `Decimal`-as-string versus strict-mode tension was flagged unresolved and carried to
CONTEXT.md as R-02.

---

## Skeleton slice + CI gate

### What does the deployed slice actually contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Alembic + live probe route | Baseline migration, `gate_money_probe` table, `/gate/money-roundtrip` hit by the deploy smoke test, worker heartbeat | ✓ |
| Alembic + test-only table | Migration lands, round-trip proven in CI only, deploy proves connectivity | |
| No Alembic until Phase 3 | Thinnest skeleton; Phase 3 then lands migrations, encryption and four tables at once | |

**User's choice:** Alembic + live probe route

### Where does the merge gate live?

| Option | Description | Selected |
|--------|-------------|----------|
| Actions + ruleset + PRs | Required checks on `main`, phase branches, `branching_strategy` flips from `none` | ✓ |
| Actions + pre-push hook | Same, plus a local hook calling one shared script | |
| Actions on push, advisory | Zero ceremony; explicitly fails criterion 2's "cannot be merged" | |

**User's choice:** Actions + ruleset + PRs
**Notes:** Ruleset availability on this repo's plan was flagged as needing verification, not
assumption. Carried to CONTEXT.md as R-03.

### How does the Hypercorn/uvicorn dual-stack result get recorded?

| Option | Description | Selected |
|--------|-------------|----------|
| New entry + pointer | Append `V092`, add a cross-reference line to `V039` | ✓ |
| Amend V039 in place | One place to read; merges the two measurements into one conclusion | |
| VERIFICATION.md only | Leaves `docs/learnings/` untouched; roadmap criterion says "recorded against V039" | |

**User's choice:** New entry + pointer

### Where does Postgres come from for tests and local dev?

| Option | Description | Selected |
|--------|-------------|----------|
| Actions service + compose | `services: postgres` in CI, two-line compose locally, same pinned version | ✓ |
| testcontainers-python | CI and local identical by construction; a dependency and Docker inside the test run | |
| Railway dev database | Same managed Postgres and pooler as production; cost, latency, shared mutable state | |

**User's choice:** Actions service + compose

---

## V091 / iCloud

The user asked what `V091` was. Explained, then verified live rather than quoted: `~/Desktop` carries
`com.apple.file-provider-domain-id`, the working tree holds 0 collision artifacts today (the
producers went with the deleted application), and 2 collisions are already in git history.

### Does Phase 1 do anything about V091?

| Option | Description | Selected |
|--------|-------------|----------|
| Gitignore only, defer move | `* 2` / `* 2.*` plus cache dirs, and a test asserting nothing matching is tracked | ✓ |
| Move the repo in Phase 1 | The real fix, at its cheapest moment; three documented repairs | |
| Nothing, note it only | Record the risk, change nothing | |

**User's choice:** Gitignore only, defer move
**Notes:** Stops anything new reaching history — which was the real damage — while keeping the phase
on its goal. The move is recorded as a deferred idea.

---

## Layout + packaging

### What shape does the Python project take?

| Option | Description | Selected |
|--------|-------------|----------|
| src layout, one pkg, uv | `src/morai/` with api/worker/money/db submodules, `uv.lock` committed | ✓ |
| Flat app/ package, uv | One less level; loses the src-layout import guarantee | |
| Two packages, one repo | Explicit web/worker boundary; three pyproject files for two co-deployed processes | |

**User's choice:** src layout, one pkg, uv

### How does Railway build the image?

| Option | Description | Selected |
|--------|-------------|----------|
| Dockerfile | Pins the Python version; CI and Railway run the same artifact | |
| Nixpacks (Railway default) | Nothing to maintain; Railway owns the base image and Python patch version | ✓ |
| Dockerfile + railway.json | Most reproducible; most config surface | |

**User's choice:** Nixpacks (Railway default) — **against the recommendation.**
**Notes:** Consequence agreed and carried forward: the `V092` entry must record the exact Python
version and base image nixpacks produced alongside the bind result, or the next builder drift is
undetectable.

---

## Railway topology + secrets

### What does the health check actually check?

| Option | Description | Selected |
|--------|-------------|----------|
| Liveness only | 200 if the process is up, no DB call; avoids the restart cascade | ✓ |
| Liveness + DB reachability | Honest single signal; a Postgres blip cycles containers | |
| Split /health and /ready | Kubernetes' distinction; two endpoints where one would ship | |

**User's choice:** Liveness only

### How does config reach the process?

| Option | Description | Selected |
|--------|-------------|----------|
| Settings model, fail fast | One `pydantic-settings` model, `extra="forbid"`, `SecretStr`, boot fails naming the field | ✓ |
| os.environ at use site | No dependency; everything `str`, fails on the first request that touches it | |
| Settings + startup contract test | Also asserts `.env.example` and Railway variables cover every field | |

**User's choice:** Settings model, fail fast

---

## Root CLAUDE.md rewrite

### How far does the root CLAUDE.md rewrite go?

| Option | Description | Selected |
|--------|-------------|----------|
| Surgical: add app section | Replace the false opening, add "The application", leave the rest intact | ✓ |
| Restructure, code first | Better for a code reader; demotes "grep docs/learnings/ first" below the fold | |
| Split into two files | One job per file; 337 entries are cited from five other files that would need auditing | |

**User's choice:** Surgical: add app section

---

## Claude's Discretion

None. Every question was answered explicitly; no "you decide" option was taken, and none was offered.

## Deferred Ideas

- Move the repository off the iCloud-synced Desktop — `V091`'s real fix, with its three documented
  repairs.
- Purge the two collision artifacts already in git history (needs a history rewrite).
- A typed error envelope with machine-readable codes — Phases 2 and 4 will have real error cases.
- A `/ready` endpoint checking DB, migration head and worker heartbeat freshness.
- A startup contract test asserting settings fields are covered by `.env.example` and Railway
  variables.
- Logging format, request-id origin, OpenAPI schema snapshot testing, and whether `tests/` is held to
  the same strictness as `src/` — surfaced, not discussed.
