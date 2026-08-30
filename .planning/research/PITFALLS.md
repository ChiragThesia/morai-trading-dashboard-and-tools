# Pitfalls Research

**Domain:** Multi-user, encrypted, broker-fed trading-journal backend — strictly-typed Python, envelope encryption, per-user OAuth, Railway deployment.
**Researched:** 2026-08-29
**Confidence:** MEDIUM overall — HIGH where a claim cites this repo's own record (`NN-`, `V-`, `P-`) or an official library doc; MEDIUM where it rests on general community practice; flagged UNVERIFIED where it is a decision this project has not yet made and this research cannot make for it.

This file covers pitfalls the project's own `REBUILD-BRIEF.md` §3 (45 non-negotiables) and
`docs/learnings/` (337 entries) do **not** already cover, because those were written against a
single-user TypeScript system. Existing entries are cited by id, never restated.

---

## Critical Pitfalls

### Pitfall 1: `Any` re-enters through Pydantic v2's synthesized `__init__`, JSON boundaries, and untyped vendor stubs

**What goes wrong:**
`mypy --strict` with no `Any`, no `cast`, no bare `# type: ignore` looks airtight until three specific seams reintroduce `Any` without anyone writing the word: (1) Pydantic v2's mypy plugin synthesizes a model's `__init__` using `Any` for every field unless `init_typed` is set or the model itself is in `strict` mode — the plugin, not the model author, is the source; (2) anything read from `response.json()`, an ORM row, or a third-party client without a `py.typed` marker types as `Any` (or `dict[str, Any]`) at the exact boundary where a money field first enters the system; (3) `schwab-py` — pinned per `PROJECT.md` constraints — has no confirmed typed interface (**UNVERIFIED**: check for a `py.typed` marker at Phase 0), so every field it returns is `Any` unless wrapped.

**Why it happens:**
`mypy --strict` checks what it can see. A synthesized `__init__`, a `.json()` call, and an unstubbed third-party import are all outside the checker's static view, so the ban on writing `Any` is trivially honored while `Any` still flows through the program. This is not a slip — it is where the two type systems (Pydantic's runtime validation, mypy's static checking) genuinely disagree about what's known.

**How to avoid:**
- Enable the Pydantic mypy plugin's strict flags explicitly: `init_forbid_extra = true`, `init_typed = true` in `[tool.pydantic-mypy]`. This is documented, not a workaround (Pydantic docs, HIGH confidence).
- Never let an untyped dict travel past the boundary that produced it. Parse every JSON response and every ORM row into a Pydantic model in the same function that received it — "parse, don't validate" as a structural rule, not a style preference.
- For `schwab-py`, write one `Protocol` covering only the methods actually called, and have every call site depend on the `Protocol`, never the vendor class directly. This makes the untyped SDK's surface area exactly as wide as what you use, and gives mypy a real interface to check call sites against even though the library itself may not ship one.
- Use `NewType` to tag units at the type level, not just in a comment: `Dollars = NewType("Dollars", Decimal)`, `IndexPoints = NewType("IndexPoints", Decimal)`. This turns `NN-8` ("every stored money field's unit is fixed and named") into something mypy enforces — a `Dollars` cannot be silently passed where `IndexPoints` is expected, even though both are `Decimal` underneath.
- Use `TypeGuard`/`TypeIs` to narrow an untyped JSON field to a known shape at the one point it is inspected, and `assert isinstance(x, T)` (a checked runtime narrowing) rather than `cast(T, x)` (an unchecked static claim) at any trust boundary — the constraint bans `cast`, not `assert`.
- Use `@overload` for functions whose return type depends on a literal argument (for example, a fill parser that returns a stricter type in strict mode than in lenient/backfill mode).

**Warning signs:**
- `mypy --strict` passes but a `dict[str, Any]` or an unstubbed import appears anywhere in a `git diff` touching money code.
- A Pydantic model's `model_config` does not set `strict=True`, and the plugin config lacks `init_typed`.
- A new vendor call site imports `schwab_client.Client` directly instead of a project-owned `Protocol`.

**Phase to address:**
The typed-boundary discipline (Pydantic plugin config, the vendor `Protocol`, the `NewType` unit tags) belongs in whichever phase establishes the domain model and the Schwab adapter — before the ledger phase, since the ledger is the money code this whole constraint exists to protect.

---

### Pitfall 2: The Decimal/float boundary is drawn correctly in principle and crossed silently in practice

**What goes wrong:**
Three distinct boundaries each have their own silent-corruption failure mode, and all three are Python-specific, not covered by `NN-8`'s general "name the unit" rule:

1. **Python ↔ Postgres.** `Decimal("0.1")` stored as `NUMERIC` round-trips exactly. A column declared `FLOAT`/`DOUBLE PRECISION` — whether by an ORM default, a lazy migration, or a driver's default type caster — does not, and the corruption happens at the schema level, invisibly to any Python-side type check.
2. **Python ↔ JSON.** `json.dumps` has no native `Decimal` support and raises `TypeError` by default. Pydantic v2's actual default is safe — `Decimal` serializes to a JSON **string** in `model_dump_json()`, preserving precision (Pydantic GitHub issue #7457, HIGH confidence) — but a well-meaning "fix" for a frontend that expects a JSON number (`PlainSerializer(lambda v: float(v), when_used="json")`) reintroduces the exact float corruption at the one boundary Pydantic protected by default.
3. **Decimal ↔ a float-only math library.** Black-Scholes greeks need `math.exp`, `math.log`, and a normal-CDF — none accept `Decimal`. The ledger must never do this; the pricing/analytics path must always do this. The trap is not "which type to use" (that part is well understood) but an implicit coercion at an unmarked call site, so the boundary is invisible in a diff.

**Why it happens:**
`Decimal(0.1)` and `Decimal("0.1")` are not the same call — the first captures the binary float's imprecision before `Decimal` ever sees it, and nothing about the syntax flags this. Combined with an ORM or JSON layer that "just works" until a value is compared bit-for-bit, the corruption ships silently and is found only when a reconciliation check (this project's own Core Value) disagrees with the broker by fractions of a cent.

**How to avoid:**
- Every money or index-point column is `NUMERIC` in the schema, enforced by migration review, never inferred from an ORM's column-type default. Verify the actual driver behavior (does it hand back `Decimal` or coerce to `float`?) in Phase 0 against the real driver chosen — do not assume.
- One named, one-directional conversion function at the pricing boundary — `to_float_for_pricing(x: Dollars) -> float` — called only inside the pricing/analytics module. Nothing computed there is ever written back into the ledger; greeks and IV live in a separate, explicitly-float domain.
- Never call `Decimal(some_float)`. If a float genuinely needs to become a `Decimal` (for example, a computed greek being logged, never a ledger value), go through `Decimal(str(some_float))` and comment why — the string round-trip is the honest version of the same call.
- Treat any `PlainSerializer`/`field_serializer` that converts a `Decimal` to `float` for JSON output as a reviewable event, not a routine ergonomics fix — it is disabling Pydantic's safe default.

**Warning signs:**
- A migration adds a money column without an explicit `NUMERIC(precision, scale)`.
- Any `field_serializer` or custom JSON encoder converts `Decimal` to `float`.
- A `Decimal(` call anywhere is fed a variable whose static type is `float`, not `str` or `int`.

**Phase to address:**
The schema and serialization conventions belong in the same phase as the ledger/events model — before the reconciliation invariant is written, since that invariant is the thing this pitfall silently breaks.

---

### Pitfall 3: Envelope-encryption implementation traps — nonce reuse and master-key custody

**What goes wrong:**
Two failure modes that are individually well documented but easy to under-budget for a first implementation. First, AES-GCM (or any nonce-based AEAD) with a repeated `(key, nonce)` pair is catastrophic, not merely weak — it leaks the XOR of the two plaintexts and can hand an attacker a forgery key (MEDIUM confidence, general cryptography practice). A predictable nonce scheme — a counter that resets on redeploy, or one derived from a row id — reintroduces exactly this risk under load or after a crash-restart. Second, the master key that wraps every per-user data key is, by this project's own design (`PROJECT.md` Key Decisions: envelope encryption, master key held outside the database), the single point of failure for every user's entire trading history at once. Losing it is not a data-loss incident scoped to one table; it is total and, without a tested recovery procedure, permanent.

**Why it happens:**
Envelope encryption's happy path (encrypt a DEK, wrap it with a KEK, store both) is the easy 80%. The edge cases — a DEK generated correctly but logged somewhere in a debug trace, a nonce scheme that looks unique in testing but collides under concurrent snapshot writes, a master-key backup procedure that was never actually exercised — are what production teams report getting wrong (WorkOS, MEDIUM confidence, vendor blog but consistent with cryptography fundamentals).

**How to avoid:**
- Generate a fresh, CSPRNG-sourced nonce for every single encryption operation, stored alongside the ciphertext. Never a counter, never derived from anything predictable, never reused across a key's lifetime.
- Treat the master key's custody and backup as a first-class Phase-1 deliverable, not an operational afterthought — this project has already rejected the alternative that would make this less critical (zero-knowledge encryption, per `PROJECT.md` Out of Scope), so the envelope design's stated limit ("does not protect against app-server access") makes master-key durability the actual remaining safety net.
- A stolen-dump test is not optional: take a real `pg_dump`, load it into a fresh environment with the master key deliberately unavailable, and confirm nothing decrypts. This is the only way to verify the design does what the requirement ("a stolen database dump or backup yields no readable trading history") claims.
- Key rotation: distinguish shallow rotation (master key changes, DEKs are re-wrapped — cheap, touches no trade data) from deep rotation (a DEK itself changes — requires re-encrypting that user's data). Version every ciphertext row with which DEK version encrypted it, so a rotation in progress can read old rows under the old DEK and write new rows under the new one without a stop-the-world migration.

**Warning signs:**
- Any code path that logs a DEK, a nonce, or a decrypted value at debug level, even temporarily.
- A nonce generation scheme that is anything other than a fresh CSPRNG call per encryption.
- No documented, rehearsed master-key backup procedure by the time real user data exists.
- No `dek_version` (or equivalent) column on any encrypted table before the first key rotation is needed.

**Phase to address:**
The encryption phase, before any real trading data is written under it. The stolen-dump drill and the rotation-versioning scheme should both exist before the first user connects a live Schwab account, not retrofitted after.

---

### Pitfall 4: Encrypted columns break the queries the ledger and campaign view structurally need

**What goes wrong:**
An opaque ciphertext blob cannot be indexed, filtered, sorted, or joined by Postgres. This collides directly with several of this project's own stated requirements: the reconciliation invariant must run "every ingest cycle... while nobody is logged in," the campaign view is "a read model over events" built by grouping rolled positions, and drift detection filters by DTE window and declared caps. If the columns those operations need — `user_id` for isolation, timestamps for the 30-minute snapshot cadence and reconciliation windows, and the identity/join keys that let a campaign be reconstructed from its constituent fills and rolls — are encrypted as opaque blobs, none of these queries can run in SQL at all.

**Why it happens:**
"Encrypt everything for defense in depth" is the naive first instinct, and it is exactly backwards for a system whose core value is a SQL-computable invariant. The project has not yet decided, in writing, which columns must stay plaintext to keep that invariant queryable — this is a decision this research surfaces but cannot make.

**How to avoid:**
- Decide explicitly, in the ledger/encryption phase, which columns are plaintext by design: `user_id` (every table, for isolation and RLS), all timestamps used for windowing (fill time, snapshot slot, event `created_at`), and the identity/join keys the campaign read model groups by (position id, campaign id, the OCC contract symbol). These are not sensitive on their own and the system cannot function with them encrypted.
- Keep genuinely sensitive content encrypted: the pre-commitment thesis/invalidation/exit-plan free text, and — if the per-user threat model calls for it — the money amounts themselves.
- If money amounts are encrypted, do not push the reconciliation `SUM` into SQL. At this project's stated scale (one trader plus three or four friends), decrypting each user's own rows in application code and summing there is cheap and avoids needing a plaintext money column purely to make an aggregate query possible. This is the concrete resolution to "encryption breaks aggregates" at this project's scale — it would not hold at a materially larger user count.
- Treat "search encrypted data" as an anti-feature for this milestone (no full-text search requirement is in scope). If it becomes necessary later, use a separate blind-index (HMAC) column — never a `LIKE` against ciphertext, which cannot work and will not error, it will simply return nothing.
- A backup/restore runbook must include a decrypt-one-known-row smoke test after restore, not just a clean exit code from `pg_restore` — a restore into an environment where the master key is unavailable "succeeds" and is silently useless.

**Warning signs:**
- A migration encrypts a column that a `WHERE`, `JOIN`, `ORDER BY`, or `GROUP BY` elsewhere in the codebase depends on.
- The reconciliation invariant's implementation contains a SQL `SUM` over an encrypted amount column.
- No written list, anywhere in the repo, of which columns are plaintext by design and why.

**Phase to address:**
Must be decided before the ledger/events schema is finalized — retrofitting plaintext columns after money code depends on an encrypted one is a schema migration under load, not a design review.

---

### Pitfall 5: Multi-tenant leaks through the two jobs that structurally read across every user

**What goes wrong:**
This project's own requirements name two jobs that must, by their nature, touch every user's data in a single run: the 30-minute snapshot writer (every open position, every user) and the reconciliation check (every ingest cycle). A "process all rows" job is the single most common place a per-user filter gets forgotten, because the job's whole purpose is to *not* filter by user — the trap is failing to re-scope isolation *inside* the loop (decrypting under the right DEK, writing audit rows under the right actor) once the outer loop has, correctly, iterated across users.

A second, narrower version: a cache for repriced quotes or computed greeks. Market data (SPX/SPXW prices, greeks for a given contract) is genuinely shared across users and *should* be cached by contract, not namespaced by user — the trap is the opposite mistake of over-scoping a cache that has no user-specific content, which wastes cache hits for no isolation benefit. The isolation bug is specifically in *derived, user-owned* values (a user's campaign P&L, a user's drift computation) landing in a cache keyed only by contract or only by a global key.

**Why it happens:**
Reviewers and structural defenses (RLS, a mandatory repository parameter) are built around "one request, one user" and don't automatically cover a background job's internal loop, which is the one place in the system explicitly designed to span users. An admin/debug endpoint built for operator support during an incident is the third recurring source — built under time pressure, outside the normal request path, and easy to wire as a raw query "just this once."

**How to avoid:**
- Every per-user step inside a cross-user job (the snapshot writer, the reconciliation job) unwraps that user's DEK and writes through that user's scoped connection/session explicitly — never a single query spanning users' encrypted data.
- Cache market data (contract-keyed, shared, correct to share) separately from any cache of user-derived values (must be user-keyed, never shared). Name this distinction in code, not just in a comment — a cache module that only accepts contract keys structurally cannot leak a user-derived value into it.
- Route every admin/debug read through the same repository method (and the same audit-log write) a normal privileged read uses. `PROJECT.md`'s own requirement — "every privileged read of user data is written to an audit log" — is the enforcement mechanism if it is implemented at the repository layer; it is not enforced at all if an operator can still reach the data with raw `psql`.

**Warning signs:**
- A background job's query has no `user_id` in its `WHERE` clause anywhere in its call chain, even if the outer loop iterates per user.
- A cache key format that mixes contract identity and user identity inconsistently across call sites.
- Any admin/debug tooling that connects to Postgres directly rather than through the application's own repository layer.

**Phase to address:**
The ingest/snapshot phase (where these two jobs are built) and the identity/access phase (where the audit-log requirement is implemented) both own a piece of this — the audit-log enforcement point should exist before the snapshot writer ships, so the writer is built against it rather than around it.

---

### Pitfall 6: Row-Level Security's session-variable mechanism collides with a transaction-mode pooler — verify which this project has

**What goes wrong:**
Postgres RLS enforced via `current_setting('app.current_user_id')` depends on session state being set before the query runs. A transaction-mode connection pooler (PgBouncer/Supavisor in transaction mode) drops session state between statements — this is the exact mechanism `NN-29`/`V028` already documented for `statement_timeout`, and it applies identically to an RLS session variable. If the read path ever runs through a pooled, transaction-mode connection, an RLS policy checking an unset variable either fails open (matches nothing, looks like an empty result) or fails closed (matches nothing, looks like a bug) depending on how the policy is written — neither is "isolation," both are silent.

**Why it happens:**
RLS-via-session-variable is the textbook multi-tenant Postgres pattern, and most writeups don't mention the pooler interaction because most examples assume a direct connection. This project's own hosting constraint (`PROJECT.md`: "runs in containers on Railway with a Postgres database") does not yet specify whether a transaction-mode pooler sits in front of it — `REBUILD-BRIEF.md`'s own `NN-28`/`NN-29` are explicitly conditional on "only if a Supabase pooler does" carry forward.

**How to avoid:**
- Determine, in the deployment/infra phase, whether the chosen Postgres setup has a transaction-mode pooler in front of it. If not (a direct connection, or a session-mode pooler), RLS via `SET LOCAL` inside the same transaction as the query is safe by the identical mechanism `V027` already proved for `statement_timeout` (it reverts at `COMMIT`, so it cannot leak into the next session a pooler hands out).
- If a transaction-mode pooler is ever introduced, `SET LOCAL app.current_user_id = ...` must be the first statement of the same transaction as every query that follows, with no exceptions — enforce this by wrapping all data access through one context manager that begins the transaction and sets the variable atomically, rather than trusting each call site to remember.
- Pair RLS (database-enforced, the real backstop) with a mandatory `user_id` constructor parameter on every repository (code-review-enforced, defense in depth) — at this project's user count (one trader plus three or four friends), the overhead of both is trivial and the failure modes of each are different enough to be worth having both.

**Warning signs:**
- Any raw SQL query or migration script that does not go through the transaction-scoped context manager.
- No test that runs the full suite against a transaction-mode pooler if one is in use — a direct-connection test suite (like a local Postgres testcontainer) cannot reproduce this class, by the same logic as `V027`'s own local-suite blind spot.

**Phase to address:**
The infra/deployment decision (pooler or not) should be settled before or alongside the identity/access phase that implements RLS, since the RLS design's safety depends on the answer.

---

### Pitfall 7: OAuth per-user routing, refresh-token custody, and revocation-vs-expiry conflation

**What goes wrong:**
Three traps beyond the vendor-specific ones already in `vendors-and-infra.md` (V001, V002, V069, NN-34, NN-35):

1. **State routing across concurrent users.** The OAuth callback URL is shared across all users. The `state` nonce (per `NN-35`, a single-use TTL'd server-side value consumed by an atomic `DELETE ... RETURNING`) is the *only* reliable signal for which user's flow a given callback belongs to. Keying the pending-flow lookup by session or cookie instead of by the `state` value itself breaks the moment two users (or one user with two tabs) are mid-flow at once — the callback can silently resolve to the wrong user's flow.
2. **Refresh-token custody.** A user's Schwab refresh token is arguably more sensitive than their trade history: it is a live bearer credential to their brokerage account, not just a read of past activity. It must be wrapped under that user's own per-user DEK, the same as trading data — never a service-wide secret — or the "stolen dump yields no readable trading history" requirement is technically met while a stolen dump still yields ongoing account access.
3. **Revocation vs. routine expiry.** A user revoking access at Schwab's own dashboard and the routine 7-day refresh expiry (`V001`) both surface identically at the HTTP layer (`invalid_grant`) but call for different handling — one is expected and recurring, the other is a deliberate account-level action the user took outside the app. Collapsing both into one generic "please reconnect" response loses information the user (and the app's own monitoring) needs.

**Why it happens:**
`NN-35` and `V001`/`V002` were written for a single user, where "which user" was never a question and revocation vs. expiry was never distinguished because there was only ever one relationship to a single Schwab account. Multi-user makes both distinctions load-bearing for the first time.

**How to avoid:**
- The state store maps `state -> (user_id, created_at)`, and the atomic `DELETE ... RETURNING` (already required by `NN-35`) returns the `user_id` directly — the callback handler never infers the user from session/cookie state, which can be stale or ambiguous with multiple tabs.
- Wrap refresh tokens under the connecting user's own DEK, established by the encryption phase, not a separate or weaker mechanism.
- Apply `NN-20`'s "classify by actual response semantics, never collapse every case to one code" per-user here: distinguish a fresh `invalid_grant` following exactly 7 days of use (routine) from one following an unexpected gap or an explicit disconnect signal from Schwab, if one is available (**UNVERIFIED**: confirm what, if anything, Schwab's API surfaces to distinguish these before committing to a UX difference).

**Warning signs:**
- The pending-OAuth-flow lookup keys off anything other than the `state` value returned in the callback.
- A refresh token stored in a shared table without a per-user wrapping key distinct from the master key alone.
- Every `invalid_grant` in logs/monitoring renders identically regardless of how long since the last successful refresh.

**Phase to address:**
The identity/access phase (OAuth flow, state handling) and the encryption phase (token wrapping) jointly own this — the state-routing fix in particular must exist before more than one user can connect an account, which is this milestone's headline reversal from v1.

---

### Pitfall 8: Mixing sync and async I/O stalls every user's request, and the failure hides at this project's scale

**What goes wrong:**
`schwab-py` uses `httpx` and defaults to synchronous requests unless `asyncio=True` is passed explicitly. If the API layer is built async (a common FastAPI/Starlette default) and the Schwab adapter is left in its default sync mode, every Schwab call inside an `async def` handler blocks the entire event loop for its duration — stalling every other concurrent user's request on that process, not just the one making the call. The same applies to any sync Postgres driver call (`psycopg2` rather than an async driver or `psycopg3`'s async mode) and to CPU-bound Decimal/BSM batch math run inline during a snapshot cycle — blocking is blocking whether the cause is I/O or computation.

A second, related failure: connection-pool exhaustion. The snapshot writer (all open positions, all users, every 30 minutes) and per-user request handlers can spike concurrent Postgres usage at the same tick if the cadence is not staggered, and an uncapped or under-capped pool starves whichever process loses the race — the same mechanism as `V030`/`NN-28`, restated for a Python async stack where every process (API server, worker, any admin CLI) must be summed against the real `max_connections`.

**Why it happens:**
At four or five users, low concurrency during manual testing hides an event-loop stall almost entirely — a blocking call "works fine" until two users' requests happen to overlap, which is easy to never observe in development and easy to hit in production the first time two friends check their positions within the same few hundred milliseconds.

**How to avoid:**
- Decide one I/O model for the whole backend at Phase 0 and state it explicitly: either async throughout (`schwab-py` with `asyncio=True`, an async Postgres driver, `asyncio.to_thread` for any remaining sync call) or sync throughout with a thread-pool WSGI server (simpler, defensible at this scale). Do not mix silently.
- Enforce the choice with a lint rule that flags a blocking call inside an `async def` (a `ruff`/`flake8-async`-style check), not review vigilance alone — vigilance is exactly what fails at low concurrency, because the bug does not manifest locally.
- Route CPU-bound batch computation (BSM/greeks over every open position at a snapshot tick) through `asyncio.to_thread` or a process pool if the backend is async — it blocks the loop identically to a slow network call, and is easy to overlook because it "isn't I/O."
- Cap and sum every process's connection pool against Postgres's actual `max_connections`, with margin, per `NN-28`.

**Warning signs:**
- Any `schwab-py` client constructed without an explicit `asyncio=` argument.
- A `psycopg2` import anywhere in an async code path.
- No lint rule or CI check for blocking calls inside `async def`.
- Manual testing only ever exercises one user's session at a time.

**Phase to address:**
The Schwab-adapter and API-scaffolding phase, before the ingest/ledger phase that will be the first to run real batch computation under this constraint.

---

### Pitfall 9: A green test suite for money code can pass while sharing the implementation's own bug

**What goes wrong:**
This project's own record already names the mechanism twice — `P007` (a property test generates the exact adversarial input for a bug and asserts only on the one output field the author was watching, missing every sibling field the same computation feeds) and `P008` (a property test's own hand-written expected-value reconstruction encodes the same wrong assumption the implementation makes, so the two agree with each other and both are wrong). Both are confirmed, not speculative — `P008`'s fix made a previously-passing 300-run property suite fail once the *production* code was corrected, because the test's own "independent" reconstruction had never actually been independent.

**Why it happens:**
A property test that reconstructs an expected value by re-deriving the same formula the implementation uses is not an oracle — it is a second copy of the implementation, and a bug in the domain's shared understanding (a sign convention, a unit, an off-by-one) tends to appear in both copies at once, because both were written by someone reasoning about the same (wrong) mental model.

**How to avoid:**
- Prefer an independently-sourced ground truth over a reconstruction wherever one exists. This project already has one: `salvage/oracle-fixtures.md`'s 13 real calendars, with expected values computed independently of the pipeline before the fix that produced them was written (`P018`). Any new money-path implementation is graded against that oracle first.
- Where no independent oracle exists, write **invariant** properties instead of **reconstruction** properties. An invariant checks a relationship that must hold regardless of the specific numbers — this project's own stated Core Value ("the sum of realized P&L over any window equals the broker's cash delta over that window, net of transfers") is exactly this shape. An invariant cannot share the implementation's bug the way a reconstruction can, because it never re-derives the value; it checks two independently-computed things against each other.
- When a property test generates adversarial input for a shared computation, assert on every output that computation feeds, per `P007` — keep a short, explicit list per money function of what it feeds, and check new tests against that list.
- Run a mutation-testing tool (for example `mutmut` or `cosmic-ray`) against the ledger/reconciliation module specifically: seed a fault (flip a sign, swap open/close, shift a rounding boundary) and confirm the full suite — oracle, property, and unit tests together — actually kills it. A mutant that survives the suite is the same failure mode `P007`/`P008` describe, made mechanical and repeatable rather than discovered by accident (general practice, MEDIUM confidence — no equivalent tool is mentioned anywhere in this project's own record, so this is a new recommendation rather than a ported lesson).
- Verify red-green discipline itself is real, not assumed, per `P035`: `git log --grep="^test("` for every money-path plan should show a failing-test commit before the implementation commit. An agent or a developer under time pressure can silently skip this and nothing in a green suite signals it.

**Warning signs:**
- A property test's expected-value function shares a name, a formula, or a code review comment with the implementation under test.
- A property test asserts on one field of a multi-field output.
- No mutation-testing pass exists anywhere in the ledger module's CI.
- `git log --grep="^test(<plan-id>):"` returns nothing for a plan that added money-path behavior.

**Phase to address:**
The ledger/reconciliation phase, gated by the 13-calendar oracle per `PROJECT.md`'s own Key Decision ("the 13-calendar oracle is the gate on money code") — the invariant-vs-reconstruction distinction and the mutation-testing check should both be verification-loop requirements for that phase, not left to individual plan authors to rediscover.

---

### Pitfall 10: Railway's execution model for scheduled work does not match a long-running worker by default

**What goes wrong:**
Railway's own cron product starts a container fresh per scheduled run and expects it to exit — a fundamentally different model from a single long-running worker process holding an internal scheduler for the 30-minute RTH snapshot cadence, which is how v1 was built (pg-boss on a persistent worker) and which `PROJECT.md`'s "from day one" cadence language most naturally implies. Building the scheduler as a long-running internal loop while also registering Railway's native per-service cron for the same work — or the reverse, assuming a long-running worker survives redeploys the way a v1 Railway service did without checking whether the deployment now targets Railway's cron primitive — risks two processes both believing they hold the single-writer Schwab refresh lock (`V002`) at the same moment, or the cadence silently running twice.

Three Python-specific deployment traps compound this, none currently covered by the existing `V035`/`V036`/`V038`/`V039`/`V071`/`V079`/`V082` entries (which are language-agnostic Railway traps, all still applicable and citable as-is):

- **Build caching.** Python's dependency install step (`pip install`, especially if `numpy`/`scipy` are pulled in for BSM math rather than hand-rolled) must be layered before the application code copy in the build config, or every deploy reinstalls the full dependency set from scratch — turning a routine deploy into a multi-minute build and compounding `V033`'s already-documented ~15-minute mid-job restart gap.
- **Container size.** A full Python base image plus a scientific numeric stack is heavier than v1's Node/TypeScript sidecar; a slim base image and a multi-stage build (install in one stage, copy only `site-packages` and app code into the runtime stage) keeps image size and redeploy time down.
- **Health checks.** Railway's health check runs once at deploy time to gate traffic cutover. For an async Python app, the health endpoint itself must not perform a live Schwab call or a full DB round-trip that could hang under a cold pool — keep it a trivial liveness check, and put deeper dependency checks (DB reachable, master key loadable) behind a separate endpoint, following the same liveness/readiness split `NN-30` already establishes for job monitoring.

**Why it happens:**
The v1 architecture and this project's own vocabulary ("30-minute RTH snapshot cadence... from day one," "runs in containers on Railway") both read naturally as a persistent worker, but Railway now offers a distinct cron-as-a-primitive product that a developer reaching for "the platform's own scheduler" might pick instead, without registering that it changes the process lifetime assumption everything else (the single-writer lock, in-memory state, connection pooling) was built against.

**How to avoid:**
- Decide explicitly, in the deployment phase: one long-running worker with an internal scheduler (matches v1, carries forward `V033`/`V034`'s handler-cap and per-batch-commit lessons directly), or Railway's native per-run cron container, which requires every snapshot cycle's state to be safely reconstructable from cold on every single invocation with nothing assumed to survive between runs. Do not use both for the same cadence.
- Whichever model is chosen, extend the Schwab single-writer lock discipline (`V002`) to guard the snapshot cycle itself if a long-running worker is used, and add a startup check that refuses to proceed if another instance already holds it — this is the concrete guard against the double-run failure mode.
- Order the Dockerfile/build config so dependency installation is cached separately from application code changes.
- Use a slim Python base image and a multi-stage build for the runtime container.
- Keep the health-check endpoint a pure liveness check; do not couple it to a live Schwab or full DB round-trip.
- On deploy, prefer a graceful-shutdown (`SIGTERM`) handler that lets the current snapshot batch finish or checkpoints its progress, combined with the existing per-batch-commit pattern (`NN-27`/`V034`), so an interrupted run resumes from the last committed batch rather than restarting the whole cycle — the concrete Python-side answer to "zero-downtime deploy with a running worker mid-job."

**Warning signs:**
- Both an internal `asyncio`/APScheduler-style loop and a Railway-dashboard-configured cron schedule exist for the same job.
- No lock-acquisition check at worker startup before the snapshot or refresh cycle begins.
- The Dockerfile/nixpacks config `COPY`s the full source tree before installing dependencies.
- `/health` performs a live vendor call or an uncached DB query.

**Phase to address:**
The deployment/infra phase, decided before the ingest/snapshot phase is built against an assumed process-lifetime model — retrofitting the execution model after the scheduler is written risks discovering the mismatch only under a real redeploy.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Skip `mypy --strict` on the vendor-adapter layer "temporarily" | Faster to wire up `schwab-py` | `Any` leaks into every caller through inference, defeating the constraint everywhere downstream | Never — wrap the vendor call behind one `Protocol`-typed boundary function instead |
| Store a money value as `float` in a scratch/reporting table "just for a quick chart" | Fast to build, no `Decimal` friction | The value visibly disagrees with the `Decimal` ledger once compared, eroding trust in every number the system reports | Acceptable only for values that never feed the reconciliation invariant and are clearly labeled derived/lossy |
| Bypass the RLS/session-scope guard in an internal admin script "since only the trader runs it" | Faster iteration on operator tooling | The exact cross-user read path `PROJECT.md` explicitly forbids, and it leaks at the first slip | Never |
| Defer mutation testing on the ledger module until "later" | Ships the phase sooner | Ships exactly the class of bug `P001`/`P007`/`P008` document as this project's own recurring failure mode | Acceptable to defer tool *setup*; never acceptable to skip on the reconciliation invariant before that invariant ships |
| Register Railway's native cron for the snapshot job "to try it" alongside the existing internal scheduler | Quick to test | Two processes can believe they hold the single-writer lock at once (`V002`), double-running the cadence | Never run both for the same job simultaneously — pick one per Pitfall 10 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Schwab (`schwab-py`) | Calling the default sync client from inside an `async def` route "because it was easier to wire up" | Decide `asyncio=True` project-wide at Phase 0; enforce with a lint rule against blocking calls in async functions |
| Schwab OAuth | Keying the pending-flow lookup by session/cookie instead of by the `state` value | Store `state -> user_id` server-side; the atomic `DELETE ... RETURNING` (`NN-35`) resolves the user, never client-side session state |
| Postgres (money columns) | Letting an ORM default or a lazy migration leave a money/index-point column as `float`/`double precision` | Every such column is `NUMERIC(precision, scale)`, enforced by migration review |
| Postgres (RLS + pooler) | Assuming an RLS session variable survives a transaction-mode pooler the way it does on a direct connection | Verify the pooling model first (`V028`); use `SET LOCAL` inside the same transaction if a pooler is present |
| Railway | Assuming the platform's native cron product runs the same process-lifetime model as a persistent worker | Pick one execution model explicitly before writing the scheduler (Pitfall 10) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| A plaintext-needed column got encrypted, forcing a decrypt-scan to satisfy a `WHERE`/`JOIN` | Reconciliation or campaign queries slow proportionally to a user's total trade history | Keep `user_id`, timestamps, and join/identity keys plaintext by design (Pitfall 4); never encrypt a column a filter or join needs | Once a single user's fill history exceeds a few thousand rows and a query starts decrypting the whole table to filter it |
| An event-loop-blocking BSM/greeks batch runs inline during a snapshot tick | Fine with a handful of open positions; every other request stalls the moment the batch runs | Route CPU-bound batch math through `asyncio.to_thread` or a process pool, same discipline as blocking I/O (Pitfall 8) | Once open-position count or concurrent-user count grows past what fits in the snapshot tick's slack time |
| An uncapped connection pool shared across the API server, the worker, and any admin CLI | Fine in isolation; fails only when two or three processes are live under load at once | Cap and sum every process's pool against Postgres's real `max_connections`, with margin (`NN-28`, restated for this stack) | The first time the snapshot writer, a live user session, and a manual reconciliation run overlap |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Wrapping a user's Schwab refresh token under a weaker or shared key than trading-history data | A stolen dump grants ongoing live brokerage account access, not just historical read access | Wrap refresh tokens under the same per-user DEK as trading data, never a service-wide secret (Pitfall 7) |
| Logging or echoing the OAuth code, `state`, or redirect URL anywhere (`NN-34`) | Bearer-equivalent secret exposure in logs or error responses | Generic error responses on the re-auth endpoint; never interpolate these values into any log line |
| An admin/debug endpoint that reads across users "to fix one customer's data" | The one cross-user read path `PROJECT.md` explicitly forbids | Route every privileged read through the same audited repository method a normal read uses, with an actor+reason parameter enforced at the function boundary (Pitfall 5) |
| A backup/restore runbook untested against the master key being unavailable | A "successful" restore that is silently undecryptable | Every restore drill includes a decrypt-one-known-row smoke test, not just a clean `pg_restore` exit code (Pitfall 3) |
| Reusing a nonce/IV under the same DEK, even accidentally via a counter reset on redeploy | Catastrophic: leaks plaintext XOR and can enable forgery | Always a fresh CSPRNG nonce per encryption operation, never a counter or predictable derivation (Pitfall 3) |

## UX Pitfalls

This milestone ships an API, not a rendered UI (`PROJECT.md` Out of Scope), so these are pitfalls in what the API *communicates* to whatever client — human or `mcp` — eventually consumes it.

| Pitfall | Consumer Impact | Better Approach |
|---------|-------------------|-------------------|
| Collapsing "7-day routine expiry" and "user revoked access" into one generic "please reconnect Schwab" response | The consumer can't distinguish scheduled maintenance from a deliberate account-level action the user took | Distinguish `invalid_grant` causes in the API's status field per user, applying `NN-20`'s per-call classification discipline (Pitfall 7) |
| Returning a reconciliation "OK" or a cohort comparison with no sample size or window bounds | A future UI renders false confidence from a thin sample | Every reconciliation/campaign/cohort response carries its own `n` and window bounds, the same fix `NN-17` already applies to rank tables |
| Rendering an honest snapshot gap identically to a real measured value | A consumer can't tell "no data" from "measured and it was zero" | A three-state representation at the API boundary (gap / attempted-and-failed / a value), never a fabricated fallback, per `NN-16` |

## "Looks Done But Isn't" Checklist

- [ ] **Reconciliation invariant "runs as a test":** often means it ran once against the 13-calendar oracle fixtures. Verify it runs against live ingested data every cycle, with the cutoff-pinned check pattern (`P036`) — not just green in CI.
- [ ] **`mypy --strict` clean:** often means clean on whatever files the config's discovery glob actually lists. Verify the `[tool.mypy] files =` (or equivalent) config covers every source file, not a partial include-list — the Python-specific version of `P009`'s "an aggregate typecheck is only as complete as its references array."
- [ ] **Encryption "at rest":** often means the ciphertext columns exist in the schema, not that a stolen-dump test was ever run. Verify by taking a real `pg_dump`, dropping the master key, and confirming nothing decrypts (Pitfall 3).
- [ ] **OAuth re-auth "self-service":** often means the single-user happy path was tested. Verify with two users mid-flow concurrently, in the same browser and in different browsers, before calling it done (Pitfall 7).
- [ ] **TDD red-green discipline:** often means tests exist alongside the implementation, not that a failing-test commit preceded it. Verify with `git log --grep="^test(<plan-id>):"` per money-path plan (`P035`).
- [ ] **"Per-user isolation" on a background job:** often means the outer loop iterates per user while an inner cache, log line, or connection is still shared. Verify every step inside the loop, not just the loop's existence (Pitfall 5).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Nonce reuse discovered in production | HIGH | Re-encrypt every affected row under a fresh DEK and nonce; audit for any plaintext exposure in the interim; treat as a full incident, not a patch |
| Master key lost or unavailable | HIGH, often unrecoverable | Restore from a documented, tested out-of-band key backup; absent one, the affected users' ledger history is permanently unreadable — this is why the backup procedure is a Phase-1 requirement |
| A missing `WHERE user_id` shipped and leaked one user's data to another | HIGH | Use the audit log (if the read path enforced it) to scope duration and extent; rotate the affected user's exposed secrets (refresh token); ship the fix with a regression test asserting that specific query's scope |
| A property test's reconstruction shared the implementation's bug (`P008`-style) | MEDIUM | Treat the newly-failing property as confirmation the reconstruction was stale, not evidence the fix broke something (`P008`'s exact lesson); replace the reconstruction with an invariant or the independent oracle |
| Railway execution-model mismatch double-runs the snapshot cadence | MEDIUM | Extend the single-writer lock (`V002`) to guard the cadence itself; kill the redundant process; add a startup check refusing to run while another instance holds the lock |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase (descriptive — final numbering set by roadmap) | Verification |
|---------|--------------------------------------------------------------------|----------------|
| 1. `Any` re-entry through Pydantic/JSON/vendor stubs | Domain model + Schwab adapter phase | `mypy --strict` config review; `Protocol` boundary exists for every vendor call site |
| 2. Decimal/float boundary crossings | Ledger/events schema phase | Schema review confirms `NUMERIC` on every money column; no bare `Decimal(float)` calls in a repo-wide grep |
| 3. Envelope encryption nonce/master-key traps | Encryption phase, before real user data | Stolen-dump decrypt-test performed and documented; nonce generation code-reviewed |
| 4. Encrypted columns break ledger queries | Ledger/events schema phase, alongside encryption | Written list of plaintext-by-design columns exists and matches what queries actually use |
| 5. Multi-tenant leaks via cross-user jobs | Ingest/snapshot phase + identity/access phase (audit log) | Every cross-user job's inner loop reviewed for per-user scoping; admin tooling routes through the audited repository |
| 6. RLS vs. transaction pooler | Deployment/infra phase, alongside identity/access | Pooling model documented; full suite run against the real pooling configuration, not only a direct-connection testcontainer |
| 7. OAuth per-user routing and token custody | Identity/access phase + encryption phase | Two-users-concurrent-flow test passes; refresh tokens confirmed wrapped under per-user DEK |
| 8. Sync/async mixing | Schwab-adapter + API-scaffolding phase | Lint rule for blocking calls in `async def` passes in CI; `schwab-py` client construction reviewed for explicit `asyncio=` |
| 9. Weak test oracles on money code | Ledger/reconciliation phase | 13-calendar oracle passes; mutation-testing pass against the ledger module shows no surviving mutants on seeded sign/rounding/off-by-one faults |
| 10. Railway execution-model mismatch | Deployment/infra phase | Single execution model documented and implemented; lock-acquisition check present at worker startup |

## Sources

**This project's own record (HIGH confidence — cited by id, not restated):**
- `REBUILD-BRIEF.md` §3 — NN-8, NN-16, NN-17, NN-20, NN-27, NN-28, NN-29, NN-30, NN-34, NN-35
- `docs/learnings/vendors-and-infra.md` — V001, V002, V013, V027, V028, V030, V033, V034, V035, V036, V038, V039, V069, V071, V079, V082
- `docs/learnings/process-and-verification.md` — P001, P007, P008, P009, P018, P035, P036
- `.planning/PROJECT.md` — requirements, key decisions, and constraints as of 2026-08-29

**External, HIGH confidence (official documentation / primary source):**
- [Pydantic — Mypy plugin docs](https://docs.pydantic.dev/latest/integrations/mypy/) — `init_typed`, `init_forbid_extra` strict-mode configuration
- [Pydantic GitHub issue #7457 — Decimal serializes as string by default](https://github.com/pydantic/pydantic/issues/7457)
- [schwab-py — HTTP Client docs](https://schwab-py.readthedocs.io/en/latest/client.html) — httpx-based, `asyncio=True` opt-in, sync by default
- [Railway — Build & Deploy docs](https://docs.railway.com/build-deploy) and [Railway cron/scheduled-jobs product page](https://railway.com/deploy/scheduled-jobs-cron-on-the-platforms-scheduler-with-a-run-history--scheduled-jobs-or-cron-on-the-platforms-) — cron starts a fresh container and expects it to exit; health check runs once at deploy time

**External, MEDIUM confidence (community/vendor writeups, consistent with fundamentals but not primary-sourced):**
- [WorkOS — Envelope encryption explained](https://workos.com/blog/envelope-encryption-explained) — implementation-mistake patterns, shallow vs. deep key rotation
- [Crunchy Data — Row Level Security for tenants in Postgres](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres) — RLS as database-enforced isolation, BYPASSRLS caveat
- [Nango — Handling concurrency with OAuth token refreshes](https://nango.dev/blog/concurrency-with-oauth-token-refreshes/) — concurrent-refresh `invalid_grant` shape in multi-tenant OAuth
- General FastAPI/asyncio blocking-call and connection-pool-exhaustion community writeups (multiple Medium/dev.to sources returned by search; treated as corroborating well-established asyncio semantics, not as a unique finding)
- Property-based testing / mutation testing oracle-strength literature (arXiv survey material) — corroborates this project's own `P007`/`P008` mechanism from the general testing-research literature

**UNVERIFIED — flagged explicitly, not treated as fact:**
- Whether `schwab-py` ships a `py.typed` marker or usable type stubs (check at Phase 0)
- Whether Schwab's API surfaces any signal distinguishing a user-initiated revocation from routine token expiry
- Which Postgres connection topology (direct, session-mode pooler, or transaction-mode pooler) this project's Railway deployment will actually use

---
*Pitfalls research for: multi-user encrypted broker-fed trading-journal backend (Python, strict typing)*
*Researched: 2026-08-29*
