# Roadmap: Morai Journal

## Overview

This milestone builds a backend and nothing else — an API, its jobs, and its stored invariants. It
starts with a deployed walking skeleton that makes the engineering constraints enforceable, then
lays identity and tenant isolation, then the encryption boundary and the schema contract that the
encryption boundary constrains. From there the two riskiest workstreams run side by side: the
Schwab connection, which is the most operationally fragile part of the system, and fill pairing,
which is the money code. Derivation is deliberately not blocked on the connection — the 13-calendar
oracle in `salvage/oracle-fixtures.md` is fixture data with independently-computed expected values,
so the code class that produced v1's −$319,850 can be proven correct before OAuth exists. Ingest
lands next, then the read models, then snapshot capture — placed as early as its dependencies allow,
because a 30-minute mark is the one thing in this system that cannot be backfilled once missed. The
reconciliation invariant follows, since it structurally cannot exist until both of its inputs do.
The pre-commitment record follows, gated only on the open/closed
state its immutability rule reads. The review API comes last because it aggregates all of it.

**Project mode:** mvp — every phase ships the thinnest thing that satisfies its criteria.

**Inherited by every phase:** OPS-01 (strict typing, no `Any`/`cast`/unjustified ignore) and OPS-02
(test-first) are established in Phase 1 and every later phase is held to them. There is no separate
tooling phase that defers them.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Walking Skeleton** - A typed web service and worker deployed on Railway, with the build failing on any violation of the project's engineering constraints
- [ ] **Phase 2: Identity, Sessions, and Tenant Isolation** - Accounts, server-side sessions, and no path from one user to another user's data
- [ ] **Phase 3: Envelope Encryption and the Schema Contract** - Per-user data keys, a documented plaintext column set, and a database that cannot store a netted ROLL
- [ ] **Phase 4: Schwab Connection and Token Lifecycle** - Self-service OAuth, per-user refresh locks, and queryable connection health
- [x] **Phase 5: Fill Pairing and the Oracle Gate** - Broker leg fills paired into OPEN/CLOSE/ROLL/SETTLE events with correct net debit and credit, proven against the 13-calendar oracle before any broker connection exists (completed 2026-09-01)
- [ ] **Phase 6: Raw Ingest and Backfill** - Immutable fills and independent broker transactions landing on a schedule, idempotently
- [x] **Phase 7: Position and Campaign Read Models** - Open/closed state, per-leg settlement, and rolled-position chains computed from events
- [x] **Phase 8: Snapshot Capture** - Every open position repriced on the 30-minute RTH cadence, with honest gaps and a repair path
- [x] **Phase 9: Reconciliation Invariant and Status Endpoint** - Realised P&L checked against the broker's cash delta every cycle, and queryable
- [ ] **Phase 10: The Pre-commitment Record** - What the user said they would do, captured before the position opens and unable to change afterwards
- [ ] **Phase 11: Review API Surface** - Campaigns, drift, cohort baselines, and lossless export
- [ ] **Phase 12: Settlement Closes the Position** - A position whose legs expire is closed by the same derivation that closes one sold out (found by the 2026-09-02 sweep, not by a failing test)
- [ ] **Phase 13: Re-auth Notification Delivery** - The notification half of the re-auth constraint, unowned since `D4-13` deferred it

## Phase Details

### Phase 1: Walking Skeleton

**Goal**: A typed FastAPI web service and a separate worker run on Railway against Postgres, and the build fails when the project's engineering constraints are violated.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Parallel with**: Nothing — every phase depends on this one
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, LEDGER-08, API-07
**Owns spike**: Hypercorn vs uvicorn dual-stack binding on real Railway hardware. Measured in v1 (`V039`), flagged partially stale. A cheap live smoke test against the deployed service settles it — this is the first phase that deploys anything.
**Success Criteria** (what must be TRUE):

  1. The deployed Railway web service answers its health check over both IPv4 and IPv6 from a single `[::]` bind, and the result is recorded against `V039` as re-measured or refuted.
  2. A branch that introduces `Any`, a `cast`, or an unjustified `# type: ignore` fails CI under the strict type gate, and cannot be merged.
  3. The test suite runs in CI on every push, a red test blocks merge, and each phase's verification output carries its own red-then-green evidence.
  4. A money value round-trips Python → Postgres `NUMERIC` → JSON → Python with identical digits, including a value carrying more precision than a float can hold, and passing an index-point value where dollars are expected fails type-check before the process runs.
  5. A route that returns an object not matching its declared response model raises inside the process rather than serialising it to a client.
  6. The repository's root `CLAUDE.md` no longer tells a reader there is no application, no test suite and no CI, because after this phase that is false. It is stale the moment this phase lands, so it is updated inside it.

**Plans:** 4/10 plans executed

Plans:

- [x] 01-01-PLAN.md — Scaffold: 3.13 pin, dependency stack, both type checkers, gate script, settings, Alembic env. No database needed
- [x] 01-02-PLAN.md — CI: four named jobs plus the Postgres service container that is this project's only usable test database
- [x] 01-03-PLAN.md — Tracer: the float canary, then one money value end to end through HTTP, strict Pydantic, asyncpg and `NUMERIC(14,4)`, proven in CI
- [x] 01-04-PLAN.md — Money unit safety: `points_to_usd` with a required multiplier, and the column-suffix metadata guard
- [x] 01-05-PLAN.md — Gate teeth: violating fixtures with rule-code assertions, the suppression-reason scan, repo hygiene
- [x] 01-06-PLAN.md — API boundary: request id, opaque error envelope, and routes that are supposed to fail
- [x] 01-07-PLAN.md — Worker: Procrastinate on its own psycopg pool, one heartbeat, schema owned by Alembic
- [ ] 01-08-PLAN.md — Railway deploy; criterion 4 on real Railway Postgres and criterion 1's V039 measurement, as separate evidence; V092
- [ ] 01-09-PLAN.md — Root docs made true, red-then-green evidence, and both criterion wording notes
- [ ] 01-10-PLAN.md — Branch ruleset after the checks are seen reporting, a PR GitHub refuses, an auto-merge that needs no human, then the branching flip

**UI hint**: no

### Phase 2: Identity, Sessions, and Tenant Isolation

**Goal**: Accounts exist, sessions are invalidated server-side, and no request can reach another user's data.
**Mode:** mvp
**Depends on**: Phase 1
**Parallel with**: Nothing — Phase 3 needs the account record this phase creates
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-07, AUTH-08
**Owns spike**: Postgres connection topology on Railway — direct connection, session-mode pooler, or transaction-mode pooler. Row-level-security safety via `SET LOCAL` depends on the answer (`V027`, `V028`), so it is settled here, before the isolation design is written against an assumption. **RESOLVED 2026-08-31 (`02-RESEARCH.md`): direct connection, no pooler of any kind.** Read live from the provisioned service's own variables — one `DATABASE_URL` to `postgres.railway.internal:5432`, no unpooled variant — and cross-checked against Railway's own documentation that pooling is opt-in. `V027`/`V028` are Supavisor-specific and do not apply. `SET LOCAL` is safe, backed by transaction scoping and SQLAlchemy's `pool_reset_on_return="rollback"` default. Do not re-run this spike.
**Success Criteria** (what must be TRUE):

  1. Admin can create an account and issue a setup link that works exactly once — a second use of the same link is rejected — and can reset a user's password with no email service anywhere in the loop.
  2. A logged-in user stays logged in across a browser restart, and after logout a replayed session cookie is rejected because the session was destroyed server-side, not only client-side.
  3. A request authenticated as user A that asks for user B's trading data returns not-found, including when A is the admin, and the isolation suite passes against the real Railway pooling configuration rather than only a direct-connection test container.
  4. Every privileged read of user data writes an audit row naming reader, subject, and time, and a privileged read that bypasses the audited path does not compile or does not pass review.

**Plans**: 6/6 plans executed, 4 waves

Plans:

- [x] 02-01-PLAN.md — Wave 1. Tracer: the least-privilege `morai_app` role, migration 0003 (five tables, RLS enable + force, policies), and one authenticated RLS-filtered request end to end
- [x] 02-02-PLAN.md — Wave 2. The isolation suite made capable of failing: a superuser positive control behind every zero-rows claim, admin-not-exempt by name, and a boot gate on the runtime role
- [x] 02-03-PLAN.md — Wave 2. Argon2id at OWASP's higher-security band, with the Railway measurement scripted and recorded as owed
- [x] 02-04-PLAN.md — Wave 2. The audit capability object, with a `tests/gate/` fixture proving both checkers reject the natural bypass by name
- [x] 02-05-PLAN.md — Wave 3. Setup and reset links: one atomic `DELETE ... RETURNING` mechanism, three routes, and the admin bootstrap script
- [x] 02-06-PLAN.md — Wave 4. Login, logout with server-side destruction, and the operator runbook for the four steps this session could not perform

**Criterion 3, pooling clause — met in substance.** The spike's answer is that there is no
pooling configuration on Railway. CI's `services: postgres` container is therefore the same
topology in kind, not a lesser stand-in. The deploy-time run D2-10 asks for ships as
`tools/isolation_smoke.py` and an operator step; deploys are blocked by the permission
classifier, so it is recorded as unrun rather than claimed. Same precedent as Phase 1's two
criteria met in substance.
**UI hint**: no

### Phase 3: Envelope Encryption and the Schema Contract

**Goal**: The tables the ledger writes exist, trading data in them is unreadable without the master key, the columns that must stay readable are decided and written down, and the database makes a netted ROLL impossible to store.
**Mode:** mvp
**Depends on**: Phase 2
**Parallel with**: Nothing — Phases 4, 5 and 10 all write or read under this boundary
**Requirements**: CRYPT-01, CRYPT-02, CRYPT-03, CRYPT-04, CRYPT-05, AUTH-06, LEDGER-04
**Success Criteria** (what must be TRUE):

  1. A real `pg_dump` restored with the master key unavailable yields no readable per-user trade detail — price, quantity, per-trade P&L, or free-text entry field — and no two ciphertext rows share a `(key, nonce)` pair. **The `reconciliation_runs` aggregates are the one exception, and they are plaintext on purpose**: `realised_pnl_usd`, `commissions_usd`, `cash_delta_usd` and `signed_difference_usd` are readable in a dump so `GET /reconciliation/status` can report drift without unwrapping a data key (`D9-13`, `D9-15`, migration 0016). The owner ruled on 2026-09-02 to narrow this criterion rather than encrypt those columns. The line is an allow-list, enforced mechanically: `tests/test_pg_dump_confidentiality.py::test_only_the_reconciliation_aggregates_store_plaintext_money` derives every plaintext money column from the catalog and fails on a fifth.
  2. The plaintext-by-design column set — `user_id`, `order_id`, `occ_symbol`, timestamps, join keys — is documented in the migration with the query each column exists to serve, and both the shared-front-leg disambiguation query and the reconciliation window query run in SQL against it.
  3. Rotating the master key re-wraps every user's data key without touching a single row of trade ciphertext, and versioned rows still read under the key they were written with.
  4. Inserting a ROLL row carrying only a netted amount is rejected by a database `CHECK` constraint, not by application code that a later caller could bypass.
  5. Deleting an account destroys that user's data key, after which their rows decrypt to nothing.
  6. The raw fill, leg, position and event tables exist with the plaintext/ciphertext split applied, and a fill can be written and read back through exactly one write path — the same one Phase 6's ingest will use and Phase 5's oracle will seed through. A second path into the fill table does not exist.

**Plans**: 7/7 plans executed, 5 waves

Plans:

- [x] 03-01-PLAN.md — Wave 1. Tracer: `cryptography`, the env-held master key, `crypto/envelope.py`, migration 0007 (`user_data_keys` and `fills`, RLS, documented plaintext columns), and one `Decimal` written and read back through the single write path
- [x] 03-02-PLAN.md — Wave 2. Migration 0008 (`positions`, `legs`, `events`), the netted-ROLL `CHECK` proved by raw SQL on a connection that bypasses the application, and the events write path that keeps a compound event's two amounts split
- [x] 03-03-PLAN.md — Wave 3. Criterion 1: a real `pg_dump` restored into a scratch database and compared as raw bytes with no key present, plus the `(key, nonce)` invariant unioned across every ciphertext column
- [x] 03-04-PLAN.md — Wave 3. The data key's lifecycle: provisioned with the account, re-wrapped on master-key rotation with trade ciphertext proved byte-identical, and destroyed before the rows on account deletion
- [x] 03-05-PLAN.md — Wave 3. Criterion 2: both SQL queries executed against real Postgres over the plaintext set, seeded from the 52 oracle fills through `insert_fills()`
- [x] 03-06-PLAN.md — Wave 4. The carried obligation, first half: the eleven isolation guards repointed at the real trading tables and observed green, widened to all five, before anything is dropped
- [x] 03-07-PLAN.md — Wave 5. The carried obligation, second half: migration 0009 drops both probe tables, and the `Decimal` round-trip and unit-suffix proofs move onto the encrypted schema

**UI hint**: no

### Phase 4: Schwab Connection and Token Lifecycle

**Goal**: Each user connects their own Schwab account and repairs it themselves when the 7-day refresh token dies, without operator help.
**Mode:** mvp
**Depends on**: Phase 3
**Parallel with**: Phase 5 (derivation needs no broker connection)
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-06, CONN-07
**Owns open question**: `schwab-py` type coverage — whether it ships a `py.typed` marker. **SETTLED (D4-01, measured):** the published 1.5.1 wheel was downloaded and listed and contains no `py.typed` anywhere; `types-schwab-py` and `schwab-py-stubs` both 404 on PyPI. Under PEP 561 that makes every vendor symbol resolve to `Any`. The answer shapes the phase: a local `typings/schwab/` partial stub package makes the vendor legible to both checkers, and the project-owned `Protocol` sits alongside it — complementary, not alternatives — keeping OPS-01 honest at the vendor boundary with exactly one suppression in the tree.
**Success Criteria** (what must be TRUE):

  1. Two users can run OAuth callbacks concurrently and each lands on their own connection record; a `state` value replayed a second time is rejected because the first use consumed it in one atomic `DELETE ... RETURNING` (`NN-35`).
  2. After a complete OAuth flow, no captured log line, error response, or response body contains the authorization code or the redirect URL — proven by a test that searches the captured output (`NN-34`).
  3. A user whose connection has expired re-authorises themselves and the existing connection record is repaired, not duplicated — the row count for that user stays at one.
  4. Two concurrent refreshes of one user's token serialise on that user's own lock and neither produces `invalid_grant`, while a refresh for user A never blocks a refresh for user B.
  5. Connection health reads back as healthy, expiring-soon, or expired with an `expires_at`, alongside the timestamp of the last successful sync, so a silent gap is a queryable fact rather than an absence.

**Plans**: 4/4 plans executed, 3 waves

Plans:

- [x] 04-01-PLAN.md — Wave 1. Tracer: `schwab-py` pinned, the local `typings/schwab/` stubs that make the untyped vendor legible to both checkers, migration 0010 (`schwab_connections`, RLS, encrypted token and account hash), the `Protocol` pair and the one adapter that imports the vendor, and one full OAuth handshake against the fake proved to land its token in Postgres — plus account deletion and the two gate meta-tests
- [x] 04-02-PLAN.md — Wave 2. Criteria 1, 2 and 3: barrier-enforced concurrent callbacks each landing their own row, one `oauth_state` nonce consumed exactly once across two engines, no code or redirect URL in any captured log or body, and a re-auth that repairs one row instead of accumulating two
- [x] 04-03-PLAN.md — Wave 2. Criterion 4: the `pg_advisory_xact_lock(hashtext(user_id))` critical section acquired before the token read, with both positive controls — one user's concurrent refreshes serialise with no `invalid_grant`, and user A's refresh never blocks user B's
- [x] 04-04-PLAN.md — Wave 3. Criterion 5: all three health bands proven at their boundaries with an injected `now`, an `expires_at` a refresh cannot move, and `last_synced_at` left honestly null because no sync exists until Phase 6

**UI hint**: no

### Phase 5: Fill Pairing and the Oracle Gate

**Goal**: The broker's individual leg fills are paired into OPEN, CLOSE, ROLL and SETTLE events with the correct net debit and credit — correctly enough to pass the only genuine oracle this project owns, before any real Schwab connection exists.

Concretely: Schwab reports four unrelated rows for a calendar (buy back leg, sell front leg, sell back leg, buy front leg) and never says they belong together or what the trade earned. This phase turns those rows into `OPEN net debit 10.20` / `CLOSE net credit 10.55` → +$35. It is the code class that cost v1 −$319,850 by netting a ROLL into one event instead of recording the close and the open separately, and it is where the two documented hard cases live: a front-month leg shared by two calendars (`8a63aa81` / `6303e6af`, identical OCC symbol `SPXW 260618P07275000`) and a stale status column (`65aac62e`).
**Mode:** mvp
**Depends on**: Phase 3 — specifically its criterion 6, the fill/leg/position/event tables and the single write path into them
**Parallel with**: Phase 4, Phase 6
**Note**: The oracle seeds 52 fills across 13 calendars directly into the Phase 3 schema, through the same write path Phase 6's ingest will later use — never a fixture-only path. `salvage/oracle-fixtures.md` asserts 52 fills written and **zero orphaned fills after a full sweep**, which is a storage-layer assertion, so the fills must be really stored. Seeding through a second path would be two implementations of the same write, which is the shape of the bug that made a +$395 trade read as −$319,850 (`LEDGER-01`). This is what lets the phase run with no Schwab connection, and it is why Phase 3 must land the tables rather than only the encryption boundary.
**Requirements**: LEDGER-01, LEDGER-02, LEDGER-03, LEDGER-09, LEDGER-11, LEDGER-12, OPS-06
**Success Criteria** (what must be TRUE):

  1. All 13 real Schwab calendars in `salvage/oracle-fixtures.md` produce their expected `openNetDebit` and `closeNetCredit` matched to two decimal places, including the shared-front-leg case and the stale-status case, and the 14th synthetic negative control fails as designed.
  2. A fill's OPEN/CLOSE role comes from the broker's own reported `positionEffect`; mutating a position's status column changes no derived event, because no derivation path reads it.
  3. A fill on a contract shared by two positions resolves through the other legs of the same broker order, and is left explicitly unresolved rather than guessed when no single anchor exists (`NN-11`).
  4. Re-running derivation over the same `(user, order_id)` scope produces an identical event set, and the whole derivation completes with no broker call made from the process.
  5. A mutation-testing pass against the ledger module reports zero surviving mutants for seeded sign-flip, rounding, and off-by-one faults.

**Plans**: 3/4 plans executed, 3 waves

Plans:

- [ ] 05-PLAN-CHECK.md

- [x] 05-01-PLAN.md — Wave 1. Tracer: `ledger/pairing.py` holding the promoted disambiguation SQL, the pure derivation core and the session shell, with one real calendar proved end to end at 32.35 and 36.35; the purity and no-broker-call gates; idempotent re-derivation over a `(user, order_id)` scope
- [x] 05-02-PLAN.md — Wave 2. The two hard cases: the shared front leg in both layers including the read that must never narrow to one calendar's own legs, the explicitly-unresolved negative case, cross-user isolation, position state mutated and proved inert, the 14th synthetic control, and `detect_roll` as a negative-only guard
- [x] 05-03-PLAN.md — Wave 3. The gate: 13 parametrized oracle cases named by their real broker order ids, the global invariants counted from Postgres, and the three seeded faults proved fatal

**UI hint**: no

### Phase 6: Raw Ingest and Backfill

**Goal**: Each connected user's fills and the broker's own transaction records land immutably, on a schedule, and repeating the work changes nothing.
**Mode:** mvp
**Depends on**: Phase 3, Phase 4
**Parallel with**: Phase 5
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, INGEST-06, OPS-05
**Owns spike**: Railway execution model. Native cron starts a fresh container per run and expects it to exit, which conflicts with a long-running worker holding a 30-minute scheduler. This is the first phase that needs scheduled work, so the model is decided once here and Phase 8's cadence inherits the decision rather than re-deciding it.
**Success Criteria** (what must be TRUE):

  1. Fills pull on a schedule for every connected user under one documented execution model, and that model survives a redeploy without losing or double-firing a cycle.
  2. The broker's own transaction records land in their own table, fed directly from Schwab and never written by the derivation pipeline, so the reconciliation invariant has a comparison source independent of the code it checks.
  3. A raw fill is stored exactly as the broker reported it — signed amount unmodified and never passed through `abs()` (`NN-10`), `positionEffect` preserved — and no later write mutates it.
  4. Running ingest twice over an overlapping window, and running a manual re-sync repeatedly, changes nothing past the first successful write.
  5. A user connecting for the first time gets existing open positions and recent history backfilled; a sync run is queryable for when it ran, how many fills landed and what errored; and a batch insert chunks at or below 2,000 rows so the Postgres bind-parameter ceiling is never reached (`NN-5`).

**Plans**: 2/3 plans executed, 3 waves

Plans:

- [x] 06-01-PLAN.md — Wave 1. Tracer: one deferred job pulling one Schwab transaction into the broker's own raw table and its fills, plus the raw-fidelity proofs, the 2,000-row ceiling, and the single-writer gate
- [x] 06-02-PLAN.md — Wave 2. The cycle: one job per connected user, the no-double-fire constraint proved against the installed schema, idempotent re-ingest, and the chunked first-connect backfill
- [ ] 06-03-PLAN.md — Wave 3. The sync record, `last_synced_at`, and the manual re-sync — enqueued from the web process without a superuser connection

**UI hint**: no

### Phase 7: Position and Campaign Read Models

**Goal**: Open/closed state, per-leg settlement, and rolled-position chains are computed from events, with no second writer for anything derivable.
**Mode:** mvp
**Depends on**: Phase 5, Phase 6
**Parallel with**: Nothing — Phases 8, 9 and 10 all wait on this one
**Requirements**: LEDGER-05, LEDGER-06, LEDGER-07, LEDGER-10
**Success Criteria** (what must be TRUE):

  1. A position's closed state is computed from net quantity per leg, and no status column exists anywhere that could disagree with it.
  2. A leg that reaches expiry generates a SETTLEMENT event from its expiry and strike with no fill present and no broker call made.
  3. A PM-settled SPXW front leg and an AM-settled SPX back leg sit inside one position, each settling on its own style and its own date.
  4. A campaign returns as a chain of rolled positions computed from events, and dropping the campaign read model and recomputing it from events yields the identical chain.

**Plans**: 5 plans

Plans:
- [x] 07-01-PLAN.md — Tracer: one Schwab order becomes a position, its legs and an OPEN event, end to end through the real worker (D7-12, Pitfall 3)
- [x] 07-02-PLAN.md — Closed state derived from net quantity per leg, and migration 0014 drops the stored timestamps, adds the roll link and creates the campaign view (LEDGER-05, D7-01, D7-15)
- [x] 07-03-PLAN.md — Per-leg SETTLEMENT derivation with AM/PM style from `legs.root`, and the broadened idempotency key (LEDGER-06, LEDGER-07)
- [x] 07-04-PLAN.md — Campaign chain read model over the view, with the drop-and-recompute and cross-user isolation proofs (LEDGER-10, Pitfall 1)
- [x] 07-05-PLAN.md — Positive ROLL derivation reusing the oracle-proven money functions, closing the campaign chain end to end (LEDGER-10, D7-09)

**UI hint**: no

### Phase 8: Snapshot Capture

**Goal**: Every open position is repriced on the 30-minute RTH cadence from day one, and a slot without data is recorded as a gap rather than invented.
**Mode:** mvp
**Depends on**: Phase 4, Phase 7
**Parallel with**: Phase 9, Phase 10
**Note**: Placed as early as its dependencies allow. It needs the position aggregate and a market read, and nothing else. Snapshot data is the one thing in this system that cannot be backfilled — v1's largest permanent regret was capturing marks live-write-only and losing them.
**Requirements**: SNAP-01, SNAP-02, SNAP-03, SNAP-04, SNAP-05
**Success Criteria** (what must be TRUE):

  1. Every open position under a healthy connection has a mark row for each 30-minute RTH slot, on the cadence inherited from Phase 6's execution-model decision.
  2. A slot with no market data stores an explicit gap; no row anywhere carries an interpolated, fabricated, or carried-forward value (`NN-16`).
  3. A later real observation heals a gap, a real observation is never replaced by a gap, and an upsert never silently no-ops a corrected backfill (`NN-6`).
  4. The repair path is runnable and rebuilds marks from the raw observations actually stored, and it ships in this phase alongside the writer rather than a phase later.
  5. A user whose connection is expired gets an honest gap row for that slot rather than a skipped row that later reads as if the position did not exist.

**Plans**: 4 plans, 3 waves

Plans:

- [x] 08-01-PLAN.md — Wave 1. Tracer: migration 0015, the Schwab wire-symbol codec nothing existed to reuse, the never-raising quote parser, and one open leg repriced end to end through a real periodic tick and a real deferred job
- [x] 08-02-PLAN.md — Wave 2. Gap semantics: the four-cell asymmetric-upsert truth table against real Postgres, three distinguishable gap causes, isolation at both grains, and the Eastern grid across both daylight-saving transitions
- [x] 08-03-PLAN.md — Wave 2. The repair path, shipped beside the writer per criterion 4 and `L040`: one function, a Procrastinate task and a CLI, plus an honest gap for a slot the scheduler never fired
- [x] 08-04-PLAN.md — Wave 3. `snapshot_runs` and the query that separates a stalled job from a vendor outage — including the slots Procrastinate's ten-minute backfill ceiling drops entirely

**UI hint**: no

### Phase 9: Reconciliation Invariant and Status Endpoint

**Goal**: The core value is enforced and queryable — realised P&L equals the broker's cash delta, checked every ingest cycle.
**Mode:** mvp
**Depends on**: Phase 6, Phase 7
**Parallel with**: Phase 8, Phase 10
**Owns open question**: The window boundary — RTH trading days, calendar days, or rolling 24 hours. The principle ("a closed window is never re-checked") is settled; the exact delineation is not, and RECON-01 is untestable until it is. Decided at the start of this phase and written down.
**Requirements**: RECON-01, RECON-02, RECON-03, RECON-04, API-01
**Success Criteria** (what must be TRUE):

  1. Over any closed window, the sum of realised P&L derived from events equals the broker's cash delta from the independently-sourced transaction table, net of transfers.
  2. That check runs automatically at the end of every ingest cycle, per user, as a test rather than a displayed number, and a deliberately seeded discrepancy of one cent fails it.
  3. A failure names the failing window, not a bare boolean, so the next question is answerable without re-running anything.
  4. Reconciliation status is its own endpoint, cheap enough to poll before rendering anything, and while it is failing the API marks the dependent numbers untrustworthy rather than serving them plain.

**Plans**: 3 plans, 2 waves

Plans:

- [x] 09-01-PLAN.md — Wave 1. Tracer: migration 0016, the pure/shell reconciliation pair, the commission read at read-time so the oracle's fee-free fields never move (`D5-04`/`D9-05`), and one real deferred `sync_user` job landing a verdict row under RLS — the CR-01 guard
- [x] 09-02-PLAN.md — Wave 2. The arithmetic proven: exact agreement passes, a seeded one-cent discrepancy fails, a four-point sweep rules out any tolerance, all five `indeterminate` causes get their own case, and every instant belongs to exactly one window across both daylight-saving states
- [x] 09-03-PLAN.md — Wave 2. `GET /reconciliation/status` as one indexed row read that provably never recomputes, and `trustworthy` carried inside the envelope of every response holding a ledger-derived number

**UI hint**: no

### Phase 10: The Pre-commitment Record

**Goal**: What the user said they would do is captured before the position opens, and structurally cannot change afterwards.
**Mode:** mvp
**Depends on**: Phase 3 (capture surface and encrypted free-text fields), Phase 7 (open/closed state, which INTENT-06's immutability gate reads)
**Parallel with**: Phases 8 and 9 — it touches no fill, event, or position write path
**Note**: INTENT-01 through INTENT-05 and INTENT-08 need only Phase 3 and could be built earlier. INTENT-06's immutability gate and INTENT-07's at-close capture both read open/closed state, which Phase 7's LEDGER-05 is the only thing that supplies — so the phase as a whole lands after Phase 7.
**Requirements**: INTENT-01, INTENT-02, INTENT-03, INTENT-04, INTENT-05, INTENT-06, INTENT-07, INTENT-08
**Success Criteria** (what must be TRUE):

  1. Before a position opens, the user records a thesis, a structured if-then invalidation trigger, an exit plan with a numeric profit target and a numeric stop, a planned DTE window as two integers, and the combo mid at submit plus the net price submitted.
  2. An update to any entry-intent field after the position has opened is rejected structurally — by a constraint or a trigger, not by a service-layer conditional a later caller could route around.
  3. At close the user records plan-followed yes or no plus one sentence, and the close is not complete without it.
  4. A tag outside the closed vocabulary of four is rejected, and a free-text value submitted into a tag field is rejected rather than stored.

**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md — Tracer: one pre-commitment recorded over HTTP, encrypted, linked, and frozen by a trigger (INTENT-01..06)
- [ ] 10-02-PLAN.md — The close record, its service-layer gate, and the outstanding-note obligation on the envelope (INTENT-07, INTENT-08)
- [ ] 10-03-PLAN.md — The `entry_trigger` vocabulary, blocked on developer input (INTENT-08)

**UI hint**: no

### Phase 11: Review API Surface

**Goal**: A client can render the entire review surface from this API alone, with nothing computed on the client and no misleading statistics offered.
**Mode:** mvp
**Depends on**: Phase 7, Phase 9, Phase 10
**Parallel with**: Nothing — it aggregates everything upstream
**Requirements**: API-02, API-03, API-04, API-05, API-06
**Success Criteria** (what must be TRUE):

  1. The campaign endpoint returns one row per campaign with its roll events nested underneath, each roll showing its open debit and close credit separately.
  2. Drift is queryable against the immutable entry record — positions held past their stated DTE window, exits that overrode the declared stop, and sizes outside the declared cap.
  3. A cohort's numbers come back alongside the user's own trailing baseline, in the same response.
  4. No response attaches a confidence interval, a p-value, or a significance claim to any ratio.
  5. An export returns the user's complete data losslessly as JSON and tabular objects as CSV, and re-reading the JSON reproduces every stored value with no precision loss.

**Plans**: TBD
**UI hint**: no

### Phase 12: Settlement Closes the Position

**Goal**: A position whose legs expire is closed by the same derivation that closes a position sold out, so nothing downstream keeps treating a dead contract as live.

**Mode:** mvp
**Depends on**: Phase 7 (the derivation this changes), Phase 8 (its open-leg set moves as a result)
**Parallel with**: Nothing — it changes a contract three phases read
**Origin**: Found 2026-09-02 by the parallel re-verification sweep, not by a failing test. Recorded as `D10-16`; Phase 10 shipped around it by explicit user decision.
**Requirements**: TBD — carve from LEDGER-05's existing scope rather than minting new IDs

**Why this is not a bug fix**: `is_closed` reads only `FillRecord`s. A SETTLEMENT is an `Event`, never a `Fill`, so a leg that expires stays net-nonzero forever. Reproduced against the real functions: after both legs settled, `is_closed=False`, `closed_at=None`. A front short put expiring worthless is a **normal** exit for these calendars, so this is the common case, not an edge.

**Live consequences already running**: `snapshots.read_open_legs` returns expired legs forever, so quote lookups run against dead contracts and write perpetual gap rows; `snapshot_repair` keeps back-filling slots for them.

**Why it is phase-sized**: `DerivedSettlement` carries only `(position_id, event_time)` and no leg id, so the fix cannot read which leg settled off the event — it must re-derive from expiry. That gives `derive_position_state` an `as_of` clock input, which breaks the purity contract `tests/test_pairing_pure.py` gates, rippling to four call sites and changing Phase 8's open-leg set. It is also a money decision: `D7-07` deliberately deferred settlement value to Phase 8's SOQ.

**Success Criteria** (what must be TRUE):

  1. A position whose every leg is past expiry reports `is_closed` true and a non-null `closed_at`, derived — not written by a second writer.
  2. `read_open_legs` stops returning a leg once that leg has settled, so no quote is requested for a dead contract.
  3. The purity contract is either preserved or replaced by an equally mechanical guard, and the choice is recorded with its reason — not silently dropped.
  4. Phase 10's INTENT-07 at-close capture fires for an expiry-closed position, closing the `D10-16` gap.

**Plans**: TBD
**UI hint**: no

### Phase 13: Re-auth Notification Delivery

**Goal**: A user whose Schwab refresh token is about to die is told, without an operator being involved.

**Mode:** mvp
**Depends on**: Phase 4 (`reauth_notified_at` and the health derivation already exist)
**Parallel with**: Phase 12 — different subsystem entirely
**Origin**: Found 2026-09-02 by the parallel re-verification sweep. `D4-13` deferred delivery to "a later phase"; six phases later no phase had claimed it.
**Requirements**: TBD — belongs with AUTH/CONN, carve from the existing re-auth requirement

**Why this is owed**: the project constraint is that re-auth be self-service **with a notification**, because the refresh token expires after 7 days, server-side and hard, forever, per user. The self-service half works. `reauth_notified_at` has no writer anywhere in `src/` — the column exists and nothing sets it. Until this ships, a user finds out their connection died by noticing their data stopped.

**Success Criteria** (what must be TRUE):

  1. A connection crossing roughly 6.5 days of token age produces exactly one notification, and `reauth_notified_at` records when.
  2. Re-running the notifier does not re-notify — the write is idempotent per connection per expiry cycle.
  3. The notification names the reconnect action and carries no OAuth code, token, or redirect URL (`NN-34`).
  4. A delivery failure is recorded and retried, and never silently swallows the obligation.

**Plans**: TBD
**UI hint**: no

## Parallelisation

Per `research/ARCHITECTURE.md` §7. Phases execute in numeric order by default; these are the pairs
that can genuinely overlap.

| Phase | Can run alongside | Why |
|-------|-------------------|-----|
| 4 — Schwab Connection | 5 | Derivation is proven against fixture data and needs no broker connection |
| 5 — Fill Pairing | 4, 6 | The oracle is 13 seeded fixtures with independently-computed expected values |
| 6 — Raw Ingest | 5 | Ingest needs the schema and the connection, not the derivation code |
| 8 — Snapshot Capture | 9, 10 | Snapshots attach to the position aggregate, not to the event stream |
| 9 — Reconciliation | 8, 10 | Needs its two inputs, not the snapshot writer |
| 10 — Pre-commitment | 8, 9 | Touches no fill, event, or position write path; gated only on Phase 7's open/closed state |

**Genuinely sequential:** the encryption boundary (Phase 3) must exist before any trading data is
written; the per-user token lock (Phase 4) must exist before real ingest runs; the reconciliation
invariant (Phase 9) cannot be built until both of its inputs exist, because comparing them is the
whole of what it does.

## Open Decisions and Their Owners

Named here so they are settled inside a phase rather than floating.

| Decision | Owning phase | Why there |
|----------|--------------|-----------|
| Hypercorn vs uvicorn dual-stack binding | 1 | First phase that deploys anything; a cheap live smoke test settles a v1 measurement flagged partially stale (`V039`) |
| Postgres pooling topology on Railway | 2 | UNVERIFIED. Row-level-security safety via `SET LOCAL` depends on it (`V027`, `V028`) |
| `schwab-py` type coverage (`py.typed`) | 4 | UNVERIFIED. Sets the shape of the project-owned vendor `Protocol` that keeps OPS-01 honest at the boundary |
| Railway execution model — cron container vs long-running worker | 6 | First phase needing scheduled work. Phase 8's 30-minute cadence inherits the decision |
| Reconciliation window boundary — RTH days, calendar days, or rolling 24h | 9 | RECON-01 is untestable until the boundary is fixed |

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

Phases 12 and 13 were added on 2026-09-02 from the parallel re-verification sweep. Both were found
by re-reading shipped phases against current code, not by a failing test. They sit after Phase 11 by
explicit user decision, so the backend milestone finishes on its existing scope first.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Walking Skeleton | 4/10 | In Progress|  |
| 2. Identity, Sessions, and Tenant Isolation | 6/6 | In Progress|  |
| 3. Envelope Encryption and the Schema Contract | 7/7 | In Progress|  |
| 4. Schwab Connection and Token Lifecycle | 4/4 | In Progress|  |
| 5. Fill Pairing and the Oracle Gate | 3/3 | Complete    | 2026-09-01 |
| 6. Raw Ingest and Backfill | 2/3 | In Progress|  |
| 7. Position and Campaign Read Models | 5/5 | Executed | 2026-09-01 |
| 8. Snapshot Capture | 4/4 | Executed | 2026-09-01 |
| 9. Reconciliation Invariant and Status Endpoint | 3/3 | Executed | 2026-09-02 |
| 10. The Pre-commitment Record | 0/TBD | Not started | - |
| 11. Review API Surface | 0/TBD | Not started | - |
| 12. Settlement Closes the Position | 0/TBD | Not started | - |
| 13. Re-auth Notification Delivery | 0/TBD | Not started | - |

## Coverage

All 68 v1 requirements in `.planning/REQUIREMENTS.md` map to exactly one phase. No orphans, no
duplicates. The requirement-to-phase table lives in `REQUIREMENTS.md` under Traceability.

Note: `REQUIREMENTS.md` previously recorded a total of 62. The actual count of v1 requirement IDs is

68. The count has been corrected there.

---
*Roadmap created: 2026-08-29*
