# Phase 6: Raw Ingest and Backfill - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

Each connected user's fills and the broker's own transaction records land immutably, on a
schedule, and repeating the work changes nothing.

This is the phase that first makes the system pull real data on its own. Everything before it
was either derivation over seeded rows (Phase 5) or a single request-driven handshake
(Phase 4). Phase 6 is where the system starts acting without a user in the loop.

**In scope:** scheduled fill ingest for every connected user; the broker's own transaction
records in their own table; immutable raw storage; idempotent re-ingest and manual re-sync;
first-connect backfill; a queryable sync-run record; batch chunking at or below 2,000 rows.

**Owns a spike:** the Railway execution model. Phase 8's 30-minute RTH cadence inherits this
decision rather than re-deciding it. Settled as `D6-01`.

**Depends on:** Phase 3's schema and encryption boundary, and Phase 4's Schwab connection and
per-user refresh lock. Parallel with Phase 5 — the ROADMAP marks them independent, and Phase 5
has already landed.

**Not in scope:** deriving events from what lands here. Phase 5 owns derivation and already
works; Phase 7 owns the read models. This phase's job ends when a raw row is stored.
</domain>

<decisions>
## Implementation Decisions

### D6-01 — The Railway execution model: one long-running Procrastinate worker

Railway's native cron starts a fresh container per run and expects it to exit. A long-running
worker holds a scheduler in-process. These conflict, and this phase settles which one wins.

**Keep the long-running `procrastinate worker` service Phase 1 already built.**
`src/morai/worker/app.py` already carries `@app.periodic` and its own psycopg v3 pool, held
deliberately separate from the web process's SQLAlchemy/asyncpg engine — two pools against one
Postgres connection ceiling (`NN-28`), each its own budget line.

**Why, and this is the load-bearing part:** criterion 1 requires the model to survive a
redeploy "without losing or double-firing a cycle." Procrastinate's
`procrastinate_periodic_defers` table carries a unique constraint on
`(task, periodic_id, defer_timestamp)`. That makes the guarantee a **database constraint**
rather than a scheduling promise. Railway cron offers no exactly-once guarantee, so choosing it
would mean rebuilding that dedupe at the job level anyway — and then owning two execution
surfaces instead of one.

Phase 1's own comment already reserved this decision for Phase 6 and flagged that its
one-minute heartbeat cron "is not a preview of it." Verify the constraint exists in the
installed Procrastinate 3.9.0 schema rather than trusting this note.

### D6-02 — Broker transactions get their own table and their own single-writer gate

Criterion 2 requires the broker's own transaction records to be fed directly from Schwab and
**never written by the derivation pipeline**, so Phase 9's reconciliation invariant has a
comparison source independent of the code it checks.

Create a `broker_transactions` table with its own `_write_token` sentinel gate, mirroring the
gate `Fill` already carries, plus a gate meta-test asserting only the ingest module imports its
writer.

**Why:** independence enforced by the type checker and the import graph, not by discipline. A
second writer becomes a type error and a gate-test failure rather than something review has to
catch. This table exists specifically to be trustworthy at the moment the derived numbers are
in doubt — a promise nobody can check is worth little there.

### D6-03 — The backfill window constants carry forward marked UNMEASURED, and the first live run measures them

`salvage/measured-constants.md` flags `SCHWAB_TX_LOOKBACK_MAX_DAYS = 365` and
`SCHWAB_TX_MAX_RANGE_DAYS = 90` as **UNJUSTIFIED** — never confirmed against Schwab's real API
limits, only chosen so the chunk-splitting path would not be an inert no-op. Its own note says
to confirm the real per-call range limit on the first live run.

Carry both forward as named, injectable settings whose docstring states plainly that neither is
verified against the vendor. Log Schwab's actual per-call behaviour on the first live run so the
number gets **measured** rather than re-guessed.

**Why:** this project's rule is that a constant carries its evidence or is labelled as lacking
it. Silently adopting an unverified number as though it were measured is how `salvage/`'s
40-constants-with-no-experiment list got that long. Turning the first real connection into the
experiment costs nothing and closes a documented gap.

### Claude's Discretion

- **Idempotency mechanism.** `insert_fills` already chunks at `_CHUNK_SIZE = 2000` (`OPS-05`,
  `NN-5`) and carries the `_write_token` gate, but has no `ON CONFLICT` handling — re-running
  today raises on the composite primary key. `ON CONFLICT DO NOTHING` follows directly from
  `INGEST-02`'s immutability ("no later write mutates it"), so `DO UPDATE` is excluded by the
  requirement rather than by preference. `RETURNING` then yields the true landed-count for
  `INGEST-06`'s sync record — check the `fills` RLS policy permits that read before relying on
  it (`V092`).
- The sync-run record's shape for `INGEST-06` (when it ran, how many landed, what errored).
- How per-user scheduling fans out across connected users within one cycle.
- Where the pure/shell split falls, following `derive_connection_health` and `derive_events`.
</decisions>

<code_context>
## Existing Code Insights

**The worker already exists and is deployed.** `src/morai/worker/app.py` holds a
`procrastinate.App` with a `PsycopgConnector` (min_size=1, max_size=2, capped explicitly
against `NN-28`) and one `@app.periodic(cron="* * * * *")` heartbeat. Procrastinate ships no
asyncpg connector; `PsycopgConnector` is the only one that is both async and able to run a
worker.

**The Schwab client path is built.** Phase 4 landed `src/morai/vendor/`: a project-owned
`Protocol` over exactly the methods used, `schwab_adapter.py` as the sole importer of `schwab`,
`schwab_client_for_user` as the async context manager that takes
`pg_advisory_xact_lock(hashtext(user_id))` before reading the token and persists a rotation only
after the body returns. **Use it. Do not open a second client path.**

**The landmine Phase 4 designed around, still live:** `schwab-py`'s `token_write_func` is never
awaited — `wrapped_token_write_func` is a plain `def` calling the closure with no `await`. An
`async def` closure returns a coroutine that is assigned, never awaited, then dropped; Python
emits only a GC-time RuntimeWarning. The call returns 200 and the token never persists. Follow
the same sync-capture / async-persist shape.

**The fills write path is built and gated.** `src/morai/ledger/fills.py::insert_fills` —
envelope encryption, per-row associated data, `_CHUNK_SIZE = 2000`, `_write_token` sentinel.
Phase 5's `pairing.py` consumes what it writes. Phase 6 feeds it.

| Table | Relevant shape |
|---|---|
| `fills` | Composite PK `(user_id, order_id, occ_symbol, leg_index, execution_time)` — five columns, `NN-1`. `position_effect` and `side` plain `Text`; `quantity` and `price_usd` encrypted |
| `schwab_connections` | `last_synced_at` and `reauth_notified_at` both nullable and **proven null** — Phase 4 shipped them as honest gaps and named Phase 6 as the phase that writes them |

**Typing is enforced:** `mypy --strict` plus basedpyright strict with `reportAny`. No `Any`, no
`cast`, no bare `# type: ignore`. `tests/gate/` holds fixtures proving the gate rejects what it
claims to, including a vendor-boundary meta-test.
</code_context>

<specifics>
## Specific Ideas

**`NN-10` is the one to watch here.** Criterion 3 requires a raw fill stored exactly as the
broker reported it — signed amount unmodified and never passed through `abs()`, `positionEffect`
preserved. This is the phase where a vendor's signed field first enters the system in bulk.
`NN-9` says direction comes from the vendor's own signed field; `NN-10` says never `abs()` it.
Phase 5's `classify_fill` already refuses to accept `side` as a parameter for the same reason.

**Ordering, carried from v1 and worth keeping:** `salvage/measured-constants.md` records that
`sync-transactions` ran 5 minutes ahead of `sync-fills` in every slot specifically so
transactions land before fills are paired against them. Tagged there as *reasoned ordering, not
measured* — carry the reasoning, not the exact offset, since this phase's cadence differs.

**`last_synced_at` is owed to Phase 4.** Phase 4 shipped it nullable and proved it null,
recording that nothing writes it until this phase. Writing it here closes that loop — and
`INGEST-06` wants the richer sync-run record alongside it.

**Backfill must reach existing open positions** (`INGEST-05`), not just fills from the moment of
connection forward. A calendar opened before the lookback window and still open is exactly the
case a short window loses silently.

**`OPS-05` is already half-satisfied.** `insert_fills` chunks at 2,000. The remaining work is
proving the ceiling holds on the new transactions path too.
</specifics>

<deferred>
## Deferred Ideas

- **The measured Schwab per-call range limit** (`D6-03`) — owed by the first live run against a
  real connection, which needs the Railway secrets set.
- **Phase 8's 30-minute RTH cadence** — inherits `D6-01`'s execution model; the cadence itself is
  Phase 8's.
- **Deriving anything from what lands here** — Phase 5 owns derivation, Phase 7 the read models.
- **The fee gap** (`D5-04`) — Phase 5 derives fee-free with commission as an explicit `None`.
  The broker's transaction records landing in this phase are fee-*inclusive*, which is exactly
  what makes them the independent comparison source Phase 9 needs. Phase 9 owns the resolution.
</deferred>
