# Architecture Research

**Domain:** Multi-user, encrypted, broker-fed trading-journal backend (Python)
**Researched:** 2026-08-29
**Confidence:** MEDIUM — encryption and locking patterns cross-checked against current industry
practice (2 independent web sources per claim); ledger and token-lifecycle conclusions are HIGH,
argued directly from this project's own measured record (`REBUILD-BRIEF.md`, `docs/learnings/`,
`salvage/oracle-fixtures.md`).

This document does not re-derive hexagonal-architecture doctrine. `REBUILD-BRIEF.md` §4 already
argued that from the postmortem — pure domain functions wrapped by thin use cases, function-type
ports with one in-memory adapter each, two packages not four. Treat that as settled. Everything
below is new: what multi-user and Python add on top of it.

---

## System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│  SCHEDULER (Railway cron)                                                  │
│  - fire 30-min RTH snapshot tick                                           │
│  - fire ingest-cycle tick (per user)                                       │
│  - fire refresh-ahead token check (per user)                               │
└───────────────┬─────────────────────────────────┬─────────────────────────┘
                │ enqueues                         │ enqueues
                ▼                                  ▼
┌───────────────────────────────┐   ┌───────────────────────────────────────┐
│  WORKER (single deployable,    │   │  WEB (horizontally scaled, stateless) │
│  horizontally scaled by job    │   │  - FastAPI, Pydantic v2 request/      │
│  type, not by user)            │   │    response models                    │
│                                │   │  - OAuth connect/callback (per user)  │
│  Schwab client (library, not   │   │  - reads: reconciliation status,      │
│  a separate process — no       │   │    campaign view, drift, review       │
│  streaming session in a        │   │  - writes: entry-intent form (once),  │
│  journal, so V002/L051's       │   │    plan-followed at close             │
│  "one process owns the token"  │   │  - unwraps DEK per request via        │
│  no longer forces a process    │   │    per-user cache, never persists     │
│  boundary — see §2)            │   │    plaintext                          │
│                                │   └───────────────┬───────────────────────┘
│  per-user pg_advisory_lock     │                   │ reads/writes (same
│  around refresh (§2)           │                   │ boundary, same encryption
│                                │                   │ rules)
│  Ingest → RawFill writer       │                   │
│  Event derivation (pure,       │                   │
│  recompute-from-fills)         │                   │
│  Campaign read-model refresh   │                   │
│  Snapshot/reprice writer       │                   │
│  Reconciliation invariant      │                   │
│  (runs every ingest cycle)     │                   │
└───────────────┬────────────────┘                   │
                │ writes                              │
                ▼                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  POSTGRES (Railway)                                                        │
│  - users, schwab_tokens (encrypted, per-user DEK ref)                     │
│  - broker_transactions (raw, plaintext-adjacent — see §1)                 │
│  - raw_fills (immutable atom)                                             │
│  - events (OPEN/CLOSE/ROLL/SETTLEMENT, content-addressed by fillIdsHash)  │
│  - positions (aggregate), campaign read model (view/materialized)        │
│  - snapshots (30-min RTH marks, gap-honest)                               │
│  - entry_records (write-once pre-commitment fields)                      │
│  - audit_log (every privileged read)                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Notes |
|-----------|-----------------|-------|
| Scheduler | Fires ticks on a fixed cadence; does no work itself | Railway cron service, or a `pg_cron`-style loop in the worker if Railway cron proves unreliable across redeploys |
| Worker | Owns every write path: ingest, derivation, snapshot, token refresh, reconciliation | One deployable. Scale by adding job-type concurrency, not by user — the per-user Postgres lock is what makes N users safe on shared workers |
| Web | Stateless API only. No write path writes trading data directly except the two intent-capture endpoints (entry form, plan-followed) | Horizontally scalable because nothing it holds is per-process state; the token lock and the DEK are both externalized to Postgres and to the KEK, respectively |
| Postgres | System of record for everything, including the wrapped per-user DEKs | Single database. No second store — an event-derivation ledger with a read-model view does not need a separate OLAP or cache layer at this scale (a handful of users, dozens of trades a year each) |

---

## §1. The encryption boundary

### Where encrypt/decrypt sits

Not the database layer (no `pgcrypto`-only scheme) and not the domain layer. It sits at the
**repository boundary** — the same seam `REBUILD-BRIEF.md` §4 already keeps thin and swappable.
A repository function takes a domain object, encrypts the fields flagged for encryption using the
caller's already-unwrapped DEK, and writes ciphertext columns (`bytea`, AES-256-GCM, nonce stored
alongside). Reading does the inverse. The domain layer never sees a KEK, a wrapped DEK, or a
decision about which columns are encrypted — it hands the repository a typed object and gets one
back. This keeps the encryption concern testable with an in-memory repository, per the pattern
`REBUILD-BRIEF.md` §4 already validated for other ports.

`pgcrypto`-only (encrypt at the SQL statement) was rejected: the master key would have to reach
every connection that runs a query, which is a wider blast radius than a key reaching one
application-layer unwrap point, and it gives up the ability to batch-decrypt in application memory
for the derivation pass without a round trip per row.

### Envelope encryption, concretely

- **KEK**: one master key, held outside the database — a Railway secret / environment variable in
  this milestone (a managed KMS is the natural upgrade path but adds a network dependency this
  system doesn't need yet at four or five users; note it as the first thing to swap if the user
  count or compliance bar rises).
- **DEK**: one per user, generated at account creation, wrapped by the KEK (AES-256 key-wrap or
  AEAD-with-KEK-as-key), stored in the `users` table as ciphertext. Never stored or logged
  unwrapped.
- **Unwrap point**: any process holding the KEK (web and worker both do, since both need to
  read/write user data) unwraps a user's DEK on first touch and holds it in an in-process,
  per-user, TTL'd cache (a few minutes is enough — it bounds exposure window without paying an
  unwrap on every one of the ~48 snapshot writes a day per user). The DEK is never written to
  disk, logged, or included in an error message.

This is the standard multi-tenant BYOK-style shape — a KMS-held KEK per scope, an application-held
DEK per scope, unwrapped on demand and passed to the query rather than delegating per-row
encryption to the KMS itself (cross-checked against current published patterns; MEDIUM confidence,
industry-standard construction, not project-specific).

### How background jobs get the key — this is the decision `PROJECT.md` already made

Zero-knowledge was rejected explicitly because "the server reprices every 30 minutes while you are
logged out" (`PROJECT.md` Key Decisions). That answers this question by construction: the worker
process holds the KEK exactly the way the web process does. There is no user session to derive a
key from, so there cannot be one — the worker unwraps a user's DEK the same way, on its own
schedule, using the same cache.

**State the limit rather than soften it**: an attacker with RCE on the app server (web or worker)
can read everything, because both hold the KEK. What this scheme defends against is a stolen
database dump, a stolen backup, and casual Postgres browsing — not a compromised application
process. That is the tradeoff `PROJECT.md` already accepted in writing. Restate it in the API/ops
docs so nobody re-litigates it as a bug later.

### Key rotation — two different operations, two different costs

| Rotation | What moves | Cost | Mechanism |
|---|---|---|---|
| **KEK rotation** | Only the wrapped DEK blobs (one small ciphertext per user) | Seconds, zero downtime | Decrypt each DEK under the old KEK, re-encrypt under the new one, in place. No user data is touched. Cross-checked: this is the entire point of the two-key indirection — a KEK rotation that would otherwise mean re-encrypting a whole dataset instead re-encrypts N small keys (MEDIUM confidence, standard construction) |
| **Per-user DEK rotation** (suspected compromise, or policy-driven) | That one user's encrypted columns, in full | A background job, scoped to one user, running over minutes to hours depending on row count | Add a `dek_version` column next to every encrypted column (or scope it at the row's owning table). The rotation job reads under the old DEK, writes under the new one, row by row or in batches (respecting NN-5's ≤2,000-row chunking), and the read path checks `dek_version` to know which key to unwrap for a given row until the job finishes. No outage: reads and writes during rotation resolve their DEK per row, not globally |

The per-user scope is the actual payoff of choosing per-user DEKs over one global DEK: a
compromise or a rotation is bounded to one user's blast radius and one user's background job,
never a whole-table lock.

### Which columns must stay plaintext, and why — this is the sharp constraint

This is not a generic "some columns can't be encrypted" caveat. It is forced by the oracle's hard
case 1 (`salvage/oracle-fixtures.md`, "the shared front-month leg"). The production fix for that
case required **`readUnprocessedFillsForCalendar` to widen its read to every fill in the same
broker order, not just fills matching the calendar's own registered legs** — the scoped read that
only looked at "this position's legs" never found the sibling calendar's anchoring fill, so
disambiguation had no anchor to work with even with the correct algorithm.

That means the derivation query is fundamentally a **query that spans positions and spans users'
own contract identity**, keyed on:

- `order_id` — must be plaintext and indexed. It is the join key for "every fill in this broker
  order," which is the entire mechanism that resolves hard case 1. Encrypting it makes the
  disambiguation query impossible to express in SQL; it would require decrypting every fill row in
  the table to find matches, which defeats indexing at any user's fill volume.
- `occ_symbol` — must be plaintext and indexed for the same reason: hard case 1 is two different
  calendars sharing the identical OCC contract as their front leg, found by symbol match. Encrypt
  this and the shared-leg lookup — the mechanism the hard case exists to test — cannot run as a
  database query.
- `user_id`, all foreign keys, and every timestamp used for scheduling (fill trade date, snapshot
  slot time, token expiry) — plaintext, for the ordinary reason that FKs must be joinable and a
  scheduler must be able to filter "due now" without decrypting every row.
- Everything genuinely money-shaped and free-text — `price`, `qty`, `net_amount`, `thesis`,
  `invalidation`, `exit plan` text — is encrypted. These carry no structural role in the
  derivation query.

**What plaintext `order_id` and `occ_symbol` leak**: which contracts a user traded, when, and which
fills co-occurred in one broker order (i.e., a user's position structure and rough trade frequency)
— but not price, size, or P&L. That is the concrete, stated cost of keeping the ledger's own hard
case solvable. It is a smaller leak than "which contract" would be if `occ_symbol` also encoded
strike granularity finer than it does, and it is the leak this project chose to accept rather than
make hard case 1 unsolvable at the storage layer.

---

## §2. The ledger: event-derivation, not event-sourcing

### The shape, restated for Postgres specifically

- `raw_fills` — immutable, append-only, one row per broker execution leg. `order_id` and
  `occ_symbol` plaintext (§1).
- `events` — `OPEN` / `CLOSE` / `ROLL` / `SETTLEMENT`, identity is `fill_ids_hash` (SHA-256 of the
  sorted composing fill UUIDs, plus a synthetic seed for `SETTLEMENT`, which has no fills). Same
  fills always rebuild to the same event row. This gives **idempotent event identity**, not
  idempotent **re-derivation** — see below, this is the trap.
- `positions` — the aggregate, one row per `calendar_id`, holds current net-qty-per-leg and status
  derived from events, never a hand-set status column read as an input (NN-9, and the whole point
  of the `65aac62e` hard case).
- `campaigns` — a **read model**, not a table with its own primary write path. A campaign is a
  chain of rolled `calendar_id`s. Build it as a view or a materialized view refreshed after every
  derivation pass, never as a table another process writes into directly. This is the one place a
  second source of truth could accidentally form; the rule that prevents it is "campaigns has no
  writer except the derivation job's refresh step."

### `ROLL` — enforce the two-field rule as a constraint, not a convention

`rollOpenDebit` and `rollCloseCredit` are separate `NOT NULL` numeric columns on the `events`
table, with a `CHECK` constraint requiring both non-null when `event_type = 'ROLL'` and both null
otherwise. This is the direct database-level version of NN-8 ("every money field's unit is named,
never inferred") and the concrete fix for the mechanism that produced the −$319,850 display: a
convention that says "don't net these" is a comment; a `CHECK` constraint is the only thing that
makes netting them structurally impossible to persist.

### Idempotent re-derivation is a different property than idempotent event identity, and Postgres needs a scope rule for it

`fillIdsHash` guarantees that the same set of fills always produces the same event row. It does
**not** guarantee that re-running derivation twice produces the same *set* of events, because the
input set of fills a derivation pass reads can legitimately widen (hard case 1, again: the round-5
fix widened the read from "this calendar's own legs" to "every fill in the same broker order").
When the read widens, the correct output changes, and the old event row is now wrong, not merely
duplicate.

**The reap rule**: scope every derivation pass to `(user_id, order_id)`, and make it
delete-then-insert inside a single transaction for that scope — never an upsert-and-leave-orphans.
Concretely: `DELETE FROM events WHERE user_id = $1 AND order_id = ANY($2::text[])` immediately
followed by inserting the freshly-derived events for that same order-id set, in one transaction.
This is NN-12 applied directly: a scoped rebuild that widens its READ context (all fills in the
order) must widen its RESET context by the identical rule (all events derived from that order),
or a stale event from the narrow read survives next to the correct one from the wide read.

Practically, this makes the derivation job pure and safely re-runnable: given the full set of
`raw_fills` for a `(user, order_id)` scope, it always produces the same events, and any prior
events for that scope are always fully replaced, never merged.

### Reconciliation invariant — where it runs and against what

Every ingest cycle, per user, as an automated check (not a UI tile — `PROJECT.md` is explicit):
sum of realized P&L across all `events` for a user in a time window must equal the signed cash
delta in `broker_transactions` for that same user and window, net of transfers. It runs against
`broker_transactions` — the raw store fed directly from Schwab's `get_transactions`, independent of
`raw_fills` and independent of the derivation pipeline — because a check that reads its own
pipeline's output can never catch a bug in that pipeline. This is the direct lesson of the
`trading-journal-research.md` §4 "invariant that would have caught −$319,850": it needs a second,
independently-sourced ledger to compare against, not a formula applied to the same series it is
checking.

### Recompute is a pure function of stored fills — no broker call

Both the derivation pass and the reconciliation check operate entirely on already-ingested rows
(`raw_fills`, `broker_transactions`). Neither ever calls Schwab. This is what makes derivation safe
to re-run on demand (e.g., after a bug fix) without touching rate limits or token state, and it is
what `PROJECT.md` requires directly ("Recompute is a pure function of stored fills, requiring no
broker call").

---

## §3. Per-user Schwab token lifecycle

### What changes from v1, and what doesn't

V002/L051's conclusion — "exactly one process owns the token's whole lifecycle, because the vendor
also allows only one active streaming session, and token ownership and session ownership were made
the same process by construction" — was forced by **two** constraints acting together: concurrent
refresh invalidates the other refresher's token, *and* only one streaming session may exist at all.
A journal does not stream. Removing the second constraint removes the reason the first constraint
had to become a process boundary. What survives, narrowed correctly, is: **one refresher at a time
per user's token row.** That is a lock, not a topology.

### The lock: per-user, in Postgres, session-scoped, with a reaper

Use `pg_advisory_lock(namespace, hashtext(user_id::text))` — the two-key form, with a fixed
constant `namespace` reserved for token-refresh locks, so this lock can never collide with any
other advisory lock the system takes for an unrelated purpose. `hashtext` returns an `int4`;
collisions across users are possible in principle but inconsequential here at a handful of users
each holding the lock for a sub-second HTTP round trip.

This must be a **session-scoped** lock (`pg_advisory_lock`, not `pg_advisory_xact_lock`), following
this project's own primary-source record at `V029`, not the generic multi-tenant advice a web
search surfaces (which recommends the transaction-scoped form "to avoid leaks"). A token refresh
is an HTTP call to Schwab; holding a database transaction open for its duration to get
transaction-scoped lock semantics is strictly worse than a session lock with a reaper. `V029`'s
fix — `idle_session_timeout = 60s` on the lock-holding session, plus a 20-second `SELECT 1`
heartbeat from the holder — is the concrete, already-measured version of "crashed refresher must
not wedge the lock forever." Carry that fix forward unchanged; it is more specific than anything a
fresh search will produce, because it is calibrated against this exact production incident
(one zombie lock survived two days before the fix).

Two things this lock's location implies:

- **The lock-holding connection must use the direct/session Postgres URL, not the transaction
  pooler** (`V028` — the pooler cannot do advisory locks; session state does not survive it).
- **The lock lives in Postgres, not in process memory**, which is exactly what makes a horizontally
  scaled web process safe: whichever process instance handles a given refresh takes the per-user
  lock from the database, so two web replicas (or a web replica and the worker) racing to refresh
  the same user's token serialize correctly without either knowing the other exists.

### Refresh-ahead scheduling and N users in one cycle

A scheduler tick (worker-owned) enumerates users whose token expiry is inside a refresh-ahead
window (well before the 7-day hard cliff — e.g., refresh once daily rather than waiting for
imminent expiry, since Schwab's expiry is server-side and hard with no benefit to waiting). For
each due user, the worker attempts `pg_advisory_lock` for that user, refreshes, releases. This is
naturally sequential-safe and cheaply made concurrent (a small worker pool, each user's refresh
independent) because the lock is per-user: one user's refresh never blocks another's, unlike v1's
single global lock for its single user.

**Three failure classes, three responses** (NN-25/26, `L`-numbered general form) apply per user,
independently: `invalid_grant` on one user's refresh pauses that user's jobs and flips a status
flag surfaced to that user and to `/reconciliation` — it must never abort the scheduler tick for
every other user. This is where multi-user actually simplifies the fault domain versus v1: no
single vendor error can take down every user's ingest, because there is no shared process or shared
token to take down.

### Does the Schwab client need to be a separate process?

No, and this is the one place v1's architecture guidance does not carry forward unchanged. V002's
process-isolation requirement was answered above: it was forced by streaming-session exclusivity,
which does not exist in this scope. The Schwab client (`schwab-py`, pinned) is a library imported
by the worker. The worker is still the only process that ever calls it — web never touches Schwab
directly — but that separation is achieved by not wiring the dependency into web, not by running a
second deployable. One fewer service to deploy, monitor, and keep alive on Railway.

---

## §4. Process topology on Railway

| Process | Runs | Scales | Holds |
|---|---|---|---|
| **web** | FastAPI under Hypercorn (not uvicorn — `V039`, Railway's IPv6 health check needs the dual-stack bind uvicorn cannot do from the CLI) | Horizontally, any number of replicas | KEK (env var), per-user DEK cache (in-process, TTL'd, replica-local — a cache miss just re-unwraps, no correctness issue) |
| **worker** | Ingest, derivation, snapshot writer, token refresh, reconciliation check | One replica is sufficient at this user count; if scaled, jobs must be idempotent per the reap rule in §2 so two workers racing on the same `(user, order_id)` scope converge, not corrupt | KEK, DEK cache, the direct/session Postgres URL (required for advisory locks per `V028`) |
| **scheduler** | Fires ticks: 30-min RTH snapshot, ingest cycle, refresh-ahead check | Single instance; Railway cron, or a lightweight loop inside the worker if Railway's own cron behavior across redeploys proves unreliable (undetermined at research time — treat as a build-phase spike, not a research gap that blocks the roadmap) | Nothing stateful — it only enqueues |

No fourth "sidecar" process. v1's sidecar existed because token lifecycle and the one streaming
session had to share a process boundary (§3). Neither constraint holds here.

`Postgres` is Railway-hosted, per `PROJECT.md`'s deployment requirement. `NN-28`/`NN-29`
(connection pool caps, direct URL for session state) carry forward as constraints on whatever
Postgres offering Railway provides, independent of whether it is Supabase-flavored — cap every
pool, and route the worker (and any advisory-lock-taking web code path) through the direct/session
URL, never the transaction pooler.

---

## §5. Component boundaries and data flow

```
Schwab (per-user OAuth token)
   │  get_transactions (raw, signed netAmount, per-user)
   ▼
broker_transactions  (raw store; independent of everything downstream;
   │                   this is what the reconciliation invariant checks against)
   │  parsed into individual fill legs
   ▼
raw_fills  (immutable atom; order_id + occ_symbol plaintext, §1)
   │  derivation pass, scoped to (user_id, order_id), delete-then-insert (§2)
   ▼
events  (OPEN/CLOSE/ROLL/SETTLEMENT; content-addressed by fill_ids_hash;
   │      ROLL's two components in separate NOT NULL columns)
   ▼
positions  (aggregate; status derived from net-qty-per-leg, never a stored flag)
   │
   ├──► campaigns  (read model: chain of rolled positions)
   │
   └──► API (web) ◄── entry_records (write-once, captured before position opens)
                  ◄── snapshots (30-min RTH reprice; attaches here, not to events —
                        it reads the position aggregate + a market-data fetch,
                        writes a gap-honest mark row, never touches raw_fills)
```

**Where the snapshot/reprice job attaches**: to `positions`, not to the event stream. It needs to
know which legs are currently open (from the aggregate) and their contract identity (`occ_symbol`,
plaintext) to fetch marks; it writes to its own `snapshots` table on the fixed 30-minute RTH
cadence, independent of whether an ingest cycle ran that slot. A slot with no market data writes an
honest gap (NN-16) — never inferred from the last good value.

**Where the reconciliation invariant runs**: after each ingest cycle, per user, comparing summed
`events` P&L against `broker_transactions` cash delta for the same window (§2). Its result is
exposed at `/reconciliation` and is the first thing any client renders (`PROJECT.md`).

**Data flow direction is strictly one-way** from Schwab through to the read models. The only writes
that do not originate from this pipeline are the two human-typed surfaces: the entry-intent form
(write-once, before a position opens) and the plan-followed binary (write-once, at close). Neither
ever touches `raw_fills` or `events`.

---

## §6. Repair path — per writer, because the three writers are genuinely different

`REBUILD-BRIEF.md` §4 "Add": a repair path ships with every writer, not a milestone later, because
v1's snapshot writer was live-write-only and its holes are now permanent. Applied to this system's
three writers, the repair path is a different shape for each, because their upstream sources differ:

| Writer | Does it have an upstream source to re-pull from? | Repair path |
|---|---|---|
| **Fill ingest** (`broker_transactions`, `raw_fills`) | Yes — Schwab's own transaction history | Re-pull the broker's transaction window for the affected date range and re-run the same parse. The raw source survives at the vendor; a bug here is always recoverable by re-ingesting |
| **Event derivation** (`events`, `positions`) | Yes — the already-stored `raw_fills` | Pure recompute, no broker call (`PROJECT.md`, §2 above). A bug fix here means re-running the scoped derivation pass for the affected `(user, order_id)` scopes; the delete-then-insert reap rule (§2) makes this safe to run any number of times |
| **Snapshot writer** (`snapshots`) | **No** — a 30-minute mark is an observation of a moment that will never recur. Once missed, it cannot be re-fetched from anywhere | Its repair path is not "re-pull," it is "rebuild the derived mark from whatever raw observation was actually stored" — e.g., if the *reprice formula* had a bug but the raw quote/greeks inputs were captured correctly, recompute the mark from the stored raw inputs, matching the "recompute is pure" discipline already applied to P&L. A genuinely missing slot (no raw observation captured at all) heals only forward: NN-16's rule that a gap row may be replaced by a later healed row, never the reverse, and an upsert must never silently no-op a corrected backfill (NN-6) |

The snapshot writer is the one that needs its repair path designed *before* its first write ships,
not after, because it is the one writer in this system with no independent source of truth to fall
back on. This is the concrete, per-writer version of the brief's general "Add" item.

---

## §7. Suggested build order

```
1. User/auth (accounts, login/session)
       │
2. Encryption boundary (KEK held, per-user DEK generated+wrapped at account
   creation, repository-layer encrypt/decrypt, DEK cache)                      ─┐
       │                                                                        │
3. Schwab OAuth + per-user token store + per-user advisory lock (§3)           │  can build
       │                                                                        │  3 and the
4. Raw ingest: broker_transactions writer, raw_fills writer                    │  oracle-driven
       │                                                                        │  parts of 5/6
5. Event derivation (pure, oracle-driven — see note below)                    ─┘  in parallel
       │
6. Positions aggregate + campaign read model
       │
7. Reconciliation invariant (needs 4 + 5/6 to compare against)
       │
8. API surface: reconciliation status, campaign view, drift, review
       │
9. Entry-intent capture + plan-followed capture (write-once forms; can land
   any time after user/auth, genuinely independent of the ledger pipeline)
```

**Parallelizable, explicitly:**

- **Derivation against the oracle needs no Schwab connection at all.** The 13-calendar oracle
  (`salvage/oracle-fixtures.md`) is 13 seeded fixtures with independently-computed expected values.
  Steps 5 and 6 (event derivation, the campaign read model, and the ROLL/status disambiguation
  rules) can be built and proven green against the oracle in parallel with step 3 (OAuth), before
  any real Schwab connection exists. This is deliberate: it means the riskiest correctness work
  — the exact code class that produced −$319,850 — is not blocked on the flakiest, most
  operationally fragile part of the system (vendor auth).
- **The snapshot writer** only needs the `positions` table (step 6) and a market-data read (which
  can itself use the same Schwab per-user client built in step 3, or a stub for early development).
  It can be built alongside derivation rather than strictly after it, and per `PROJECT.md` and the
  brief's "Add" item, it should start early — snapshot data is the one thing in this system that
  cannot be backfilled once missed (§6).
- **Entry-intent capture (step 9)** touches no fill, event, or position table. It is a write-once
  form gated only by "does a position exist and is it still open," so it can be built any time
  after user/auth without waiting on the ledger pipeline.

**What is genuinely sequential:** the encryption boundary must exist before anything writes trading
data (every table downstream has encrypted columns), and the per-user token lock must exist before
any real ingest runs (concurrent refresh corrupts a real user's session). The reconciliation
invariant is the one component that structurally cannot be built until both its inputs —
`broker_transactions` and the derived `events` — exist, since it exists to compare them.

---

## Anti-Patterns to avoid

### Anti-Pattern: encrypting the join keys the derivation query needs

**What people do:** encrypt every column that "looks like user data," including `order_id` and
`occ_symbol`, on the reasoning that more encryption is safer.
**Why it's wrong:** it makes hard case 1 unsolvable at the storage layer — the disambiguation query
that resolves a shared front-month leg needs to `WHERE order_id = ANY(...)` and `WHERE occ_symbol =
...` as indexed SQL, not as an application-side decrypt-then-filter over the whole table.
**Do this instead:** encrypt money and free-text fields; leave identity/join/timestamp columns
plaintext, and say what that leaks (§1) rather than pretending it doesn't happen.

### Anti-Pattern: `pg_advisory_xact_lock` for a lock held across an HTTP call

**What people do:** follow generic advice to prefer transaction-scoped advisory locks over session
locks "to avoid leaks."
**Why it's wrong:** a token refresh is a network round trip to Schwab. Holding a database
transaction open for its duration to get transaction-scoped lock semantics ties up a connection and
gains nothing; `V029`'s already-measured failure mode (a crashed session leaving the lock held) is
solved by an idle-session timeout and heartbeat, not by switching lock type.
**Do this instead:** session-scoped `pg_advisory_lock`, reaped by `idle_session_timeout` plus an
application heartbeat, exactly as `V029` specifies.

### Anti-Pattern: campaigns as a table with its own writer

**What people do:** give the campaign view its own INSERT/UPDATE path once it needs to be "fast," on
the reasoning that a materialized view is slower than a table.
**Why it's wrong:** a second writer for data that is fully derivable from `events` is a second
source of truth waiting to drift, which is exactly the failure class `REBUILD-BRIEF.md` §4 spent a
whole "Drop" section warning against for DDD-lite structuring — the cost shows up, the benefit
doesn't.
**Do this instead:** a view or materialized view refreshed by the derivation job. If it is
measurably too slow at real data volume (dozens of trades a year, a handful of users — unlikely),
that is the moment to add a refresh trigger, not before.

---

## Sources

- `REBUILD-BRIEF.md` §3 (NN-1 through NN-45), §4 (Architecture guidance) — primary, this project's
  own measured record. HIGH confidence.
- `docs/learnings/vendors-and-infra.md` — V001–V002 (Schwab token single-writer), V028–V030
  (Postgres pooler/advisory-lock/pool-cap traps), V039 (Hypercorn). HIGH confidence, measured in
  this project's own v1 production deployment.
- `docs/learnings/LAWS.md` — L051 (single-process vendor ownership), NN-numbered laws throughout.
  HIGH confidence.
- `salvage/oracle-fixtures.md` — the 13-calendar oracle and its two hard cases, which is the direct
  source for the plaintext-column constraint in §1 and the reap rule in §2. HIGH confidence,
  computed independently of the pipeline it tests.
- `docs/rebuild-research/trading-journal-research.md` §4 — fill/event/campaign data model argument,
  the reconciliation invariant, settlement mechanics. HIGH confidence for the parts already argued
  there; used directly rather than re-derived.
- [Multi-tenant BYOK encryption in PostgreSQL with pgcrypto — Xata](https://xata.io/blog/multi-tenant-byok-encryption-in-postgresql-with-pgcrypto) — per-tenant DEK/KEK pattern, cross-checked. MEDIUM confidence.
- [AWS KMS envelope encryption deep dive](https://dev.to/aws-builders/aws-kms-deep-dive-the-mystery-of-envelope-encryption-2lc8) — general envelope-encryption construction, cross-checked. MEDIUM confidence.
- [PostgreSQL advisory locks, explained — Flavio Del Grosso](https://flaviodelgrosso.com/blog/postgresql-advisory-locks) — `hashtext`-keyed advisory lock pattern; the "prefer xact lock" recommendation there is explicitly overridden above by this project's own `V029` record. MEDIUM confidence, superseded where it conflicts with a primary source.
- [Rotating encryption keys without re-encrypting data — HashiCorp Vault case study](https://medium.com/@panayot.atanasov/rotating-encryption-keys-for-bank-data-with-hashicorp-vault-without-re-encrypting-a-single-record-f12c1ed923db) — confirms KEK rotation re-wraps DEKs only. MEDIUM confidence.

---
*Architecture research for: multi-user encrypted trading-journal backend*
*Researched: 2026-08-29*
