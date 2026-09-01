# Phase 6: Raw Ingest and Backfill - Research

**Researched:** 2026-09-01
**Domain:** Scheduled vendor ingest (Schwab transactions), Procrastinate periodic fan-out, raw immutable storage
**Confidence:** HIGH for the mechanics verified against installed source and this repo's own migrations; LOW for anything requiring a live Schwab response, none of which exists yet.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D6-01 — The Railway execution model: one long-running Procrastinate worker.**
Keep the long-running `procrastinate worker` service Phase 1 already built. `src/morai/worker/app.py`
already carries `@app.periodic` and its own psycopg v3 pool, held deliberately separate from the web
process's SQLAlchemy/asyncpg engine — two pools against one Postgres connection ceiling (`NN-28`), each
its own budget line. Criterion 1 requires the model to survive a redeploy "without losing or
double-firing a cycle." Procrastinate's `procrastinate_periodic_defers` table carries a unique
constraint on `(task, periodic_id, defer_timestamp)`. That makes the guarantee a database constraint
rather than a scheduling promise. Railway cron offers no exactly-once guarantee. Verify the constraint
exists in the installed Procrastinate 3.9.0 schema rather than trusting the note.

**D6-02 — Broker transactions get their own table and their own single-writer gate.**
Criterion 2 requires the broker's own transaction records to be fed directly from Schwab and never
written by the derivation pipeline. Create a `broker_transactions` table with its own `_write_token`
sentinel gate, mirroring the gate `Fill` already carries, plus a gate meta-test asserting only the
ingest module imports its writer. A second writer becomes a type error and a gate-test failure rather
than something review has to catch.

**D6-03 — The backfill window constants carry forward marked UNMEASURED.**
`SCHWAB_TX_LOOKBACK_MAX_DAYS = 365` and `SCHWAB_TX_MAX_RANGE_DAYS = 90` are UNJUSTIFIED — never
confirmed against Schwab's real API limits. Carry both forward as named, injectable settings whose
docstring states plainly that neither is verified against the vendor. Log Schwab's actual per-call
behaviour on the first live run so the number gets measured rather than re-guessed.

### Claude's Discretion

- Idempotency mechanism (`ON CONFLICT DO NOTHING` follows directly from `INGEST-02`; `DO UPDATE` is
  excluded by the requirement, not by preference). `RETURNING` yields the true landed-count for
  `INGEST-06` — check the `fills` RLS policy permits that read first (`V092`).
- The sync-run record's shape for `INGEST-06`.
- How per-user scheduling fans out across connected users within one cycle.
- Where the pure/shell split falls, following `derive_connection_health` and `derive_events`.

### Deferred Ideas (OUT OF SCOPE)

- The measured Schwab per-call range limit (`D6-03`) — owed by the first live run against a real
  connection, which needs the Railway secrets set.
- Phase 8's 30-minute RTH cadence — inherits `D6-01`'s execution model; the cadence itself is Phase 8's.
- Deriving anything from what lands here — Phase 5 owns derivation, Phase 7 the read models.
- The fee gap (`D5-04`) — Phase 5 derives fee-free with commission as an explicit `None`. The broker's
  transaction records landing in this phase are fee-inclusive, which is exactly what makes them the
  independent comparison source Phase 9 needs. Phase 9 owns the resolution.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGEST-01 | The system pulls each connected user's fills from Schwab on a schedule | Q1/Q2 — `D6-01`'s periodic-defer constraint verified; per-user fan-out via one deferred job per connected user |
| INGEST-02 | A raw fill is stored immutably as the broker reported it, including its signed amount and its position effect | Q3/Q5 — vendor field mapping (`NN-9`, `NN-10`), `ON CONFLICT DO NOTHING` (never `DO UPDATE`) |
| INGEST-03 | Re-running ingest over an overlapping window is a no-op past the first successful write | Q5 — `ON CONFLICT DO NOTHING` on both `fills` and `broker_transactions` |
| INGEST-04 | User can trigger a re-sync manually, and running it repeatedly is safe | Q2/Q5 — same idempotent write path; new API route needs its own job-deferral connector (Pitfall 6) |
| INGEST-05 | A user connecting for the first time gets existing open positions and recent history backfilled | Q7 — `last_synced_at IS NULL` as the first-connect signal, chunked `D6-03` windows |
| INGEST-06 | User can see what a sync did — when it ran, how many fills landed, and what errored | Q6 — dedicated `sync_runs` table, not `procrastinate_jobs` |
| OPS-05 | A batch insert never exceeds the Postgres bind-parameter ceiling | `insert_fills`'s existing `_CHUNK_SIZE = 2000` already satisfies this; `broker_transactions` needs the same discipline |
</phase_requirements>

## Summary

This phase adds no new dependency. `schwab-py` 1.5.1, Procrastinate 3.9.0, SQLAlchemy 2.0.52 are
already pinned and installed — `uv pip show` confirms all three match `CLAUDE.md`'s recorded versions
exactly `[VERIFIED: local .venv install]`. The work is entirely composition: read `schwab-py`'s installed
source directly (not its docs, which this project has learned not to trust blindly — `NN-23`) to confirm
`get_transactions`'s real signature and default window, fan a Procrastinate periodic task out into one
deferred job per connected user, and write two independent tables — `fills` (already exists, extend with
`ON CONFLICT DO NOTHING`) and `broker_transactions` (new, `D6-02`) — from the same vendor response.

Two findings change the shape of the plan from what `salvage/` alone would suggest. First, reading the
real installed `schwab-py` wheel's `get_transactions` source shows Schwab's own SDK default lookback is
**60 days**, and its docstring claims a 60-day range constraint — smaller than either of `D6-03`'s carried
-forward constants (365/90). This does not override `D6-03` (both constants still carry forward
unverified, per the locked decision), but it is a concrete signal to log against on the first live run,
stronger than anything `salvage/` itself records. Second, this project's `SchwabClient` `Protocol` names
exactly one data-fetching method for trade data — `get_transactions` — unlike v1, which polled a separate
`sync-fills` job against a different endpoint. There is no second call to derive fills from. Both `fills`
and `broker_transactions` must be populated from the same `get_transactions` response, in the same job,
in the same transaction — which means v1's "`sync-transactions` runs 5 minutes ahead of `sync-fills`"
cron-offset precedent does not carry forward as a cron offset at all. The ordering it protected is now a
write-order-within-one-function concern, not a cross-job timing concern.

Procrastinate's own installed `Worker.__init__` defaults `concurrency` to `1`
`[VERIFIED: procrastinate 3.9.0 installed package]`, and the deployed worker's start command
(`.railway/railway.ts:69`) passes no `--concurrency` override — so today's worker already executes every
job strictly serially, whether that job is the heartbeat, a per-user ingest, or anything else deferred
onto it. This resolves the fan-out isolation-vs-throughput tradeoff `06-CONTEXT.md` names: per-user jobs
cost nothing in concurrent-connection pressure today (nothing runs concurrently regardless), while still
buying Procrastinate's own per-job retry/failure isolation — one user's `invalid_grant` fails that job
without touching the other `N-1` jobs already queued behind it.

**Primary recommendation:** one Procrastinate periodic task that defers one `sync_user(user_id)` job per
row in `schwab_connections`; `sync_user` calls `get_transactions` once through the existing
`schwab_client_for_user` context manager (which already holds the per-user advisory lock and handles
token rotation), writes `broker_transactions` then `fills` from the same response inside one DB
transaction, then updates `last_synced_at` and a `sync_runs` row only if that transaction commits.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scheduled trigger (cron tick) | Worker (Procrastinate periodic task) | — | `D6-01` — the worker already owns the scheduler in-process |
| Per-user fan-out | Worker (deferred jobs) | — | Isolates one user's vendor failure from the other `N-1`; free under `concurrency=1` |
| Manual re-sync trigger (INGEST-04) | API/Backend (new route) | Worker (deferred job) | The web process has no Procrastinate connector today (Pitfall 6) — this phase must add one |
| Vendor OAuth / token refresh | Backend (`vendor/connections.py`, `vendor/schwab_adapter.py`) | — | Already built by Phase 4. Do not open a second client path |
| Raw fill storage | Database (`fills`, extended) | Backend (`ledger/fills.py`) | `insert_fills` is already the sole write path; this phase adds `ON CONFLICT DO NOTHING` |
| Raw broker transaction storage | Database (`broker_transactions`, new) | Backend (new ingest module) | `D6-02` — independent of the derivation pipeline by construction |
| Sync-run record (INGEST-06) | Database (`sync_runs`, new) | API (read route) | Not `procrastinate_jobs` — that table is worker-internal, unscoped by RLS, and not app schema (Q6) |
| Backfill window chunking | Backend (pure functions) | — | `chunk_date_range`-style pure function, unit-testable with no network or DB |

## Standard Stack

### Core

No new package this phase. All three libraries below are already pinned in this project and installed:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `schwab-py` | 1.5.1 `[VERIFIED: local .venv install, matches CLAUDE.md pin]` | The one `get_transactions` call this phase needs | Already the sole importer boundary (`schwab_adapter.py`, D4-02) — reuse it, do not add a second vendor path |
| `procrastinate` | 3.9.0 `[VERIFIED: local .venv install, matches CLAUDE.md pin]` | Periodic scheduling + per-user job fan-out | `D6-01` — already the deployed worker |
| `sqlalchemy` | 2.0.52 `[VERIFIED: local .venv install, matches CLAUDE.md pin]` | `broker_transactions`/`sync_runs` ORM models, `ON CONFLICT` via `dialects.postgresql.insert` | Already the project's ORM; `pg_insert(...).on_conflict_do_nothing()` is the same import `vendor/connections.py` already uses for `.on_conflict_do_update()` |

### Supporting

No new supporting library. `pydantic.TypeAdapter` (already used throughout `vendor/`, `ledger/`) is the
correct tool for validating whatever raw shape `get_transactions` returns at the untrusted-input
boundary — do not add a second JSON-validation library.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deferred per-user Procrastinate jobs | One task looping all users in-process | Rejected by `06-CONTEXT.md`'s own framing: one user's vendor error would starve the rest, and Procrastinate's per-job retry/failure isolation is free once jobs are already per-user |
| A dedicated `sync_runs` table | Reading `procrastinate_jobs`/`procrastinate_events` directly | `procrastinate_jobs` is the worker's own psycopg-pool schema, has no RLS and no `user_id` column, and per `worker/app.py`'s own docstring is deliberately kept separate from the RLS-protected app schema. A user-facing `INGEST-06` read needs a table the app's RLS can scope |
| A new lightweight web-process Procrastinate connector for manual re-sync | Reusing the worker's own `PsycopgConnector`/pool from the web process | Procrastinate ships no `asyncpg` connector (`worker/app.py`'s own docstring) — the web process's `AsyncEngine` cannot defer a Procrastinate job directly. A second, small `PsycopgConnector`-based `App` instance in the web process, deferral-only (never `run_worker_async`), is the documented Procrastinate pattern for a producer process that isn't the consumer |

**Installation:** none — no new dependency.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new external packages; every library used is already pinned,
installed, and audited as part of this project's existing stack (see `CLAUDE.md`'s own Numbered Findings
section, itself sourced from live PyPI JSON API queries). `npm view`/`pip index versions`-style
verification was performed locally instead, against the actual installed environment
(`uv pip show schwab-py procrastinate sqlalchemy pydantic fastapi`), confirming exact version match with
no drift.

## Architecture Patterns

### System Architecture Diagram

```
Cron tick (Procrastinate periodic, "* * * * *" heartbeat cadence today,
Phase 8 owns the real 30-min RTH cron)
        |
        v
[sync_all_connected_users]  (worker, periodic task)
        |  SELECT user_id FROM schwab_connections
        |  for each row: app.configure_task("sync_user").defer_async(user_id=...)
        v
[sync_user(user_id)]  (worker, deferred job -- one per connected user, isolated failure)
        |
        v
[schwab_client_for_user(session, user_id, auth)]   <- already built, Phase 4
        |  pg_advisory_xact_lock(hashtext(user_id))   <- per-user single-writer lock, free reuse
        |  read + decrypt stored token
        v
[client.get_transactions(account_hash, start_date=..., end_date=...)]
        |  one call, chunked per D6-03 window on first connect; one call, narrow window on routine sync
        v
[TypeAdapter validation]  <- untrusted-input boundary, this phase's own new model(s)
        |
        +---------------------------+
        v                           v
[insert_broker_transactions]   [extract FillWrite rows from transferItems]
  (new, D6-02, own              (NN-9/NN-10: side from signed amount,
   _write_token gate)            never abs() first)
        |                           v
        |                    [insert_fills]  <- already exists, add ON CONFLICT DO NOTHING
        |                           |
        +------------ same DB transaction ------------+
                                    |
                                    v
                    commit  ->  update schwab_connections.last_synced_at
                            ->  write sync_runs row (landed count, errors)
```

### Recommended Project Structure

```
src/morai/
├── ingest/                      # new package -- this phase's own domain
│   ├── __init__.py
│   ├── schwab_sync.py           # shell: sync_user(), sync_all_connected_users();
│   │                             # pure: chunk_date_range(), extract_fills_from_transaction()
│   ├── broker_transactions.py   # mirrors ledger/fills.py exactly: insert path,
│   │                             # its own _write_token gate (D6-02)
│   └── sync_runs.py             # sync-run record write/read (INGEST-06)
├── worker/
│   └── app.py                   # imports morai.ingest.schwab_sync, registers
│                                 # @app.periodic + @app.task("sync_all_connected_users")
│                                 # and @app.task("sync_user")
└── api/
    └── routes_connections.py    # add POST /schwab/sync (INGEST-04) and
                                  # GET /schwab/sync-runs (INGEST-06)
```

This mirrors the existing split: `ledger/fills.py` and `ledger/pairing.py` already separate the
single-write-path module (with its own gate) from the shell/pure orchestration module. `ingest/` follows
the same convention for a new domain rather than growing `vendor/` (which Phase 4 scoped tightly to the
OAuth/client boundary) or `ledger/` (whose `_write_token` gate on `Fill` is already a compile-time
guarantee this phase must not weaken by adding a second call site inside an unrelated package).

### Pattern 1: Fan-out via `app.configure_task(...).defer_async(...)`

**What:** The periodic task queries connected users and defers one job per user, rather than looping
inline inside the periodic task's own body.
**When to use:** Any per-tenant scheduled work where one tenant's failure must not block the others.
**Example**, following the exact shape `tests/test_worker_heartbeat.py` already proves works against this
project's own `App`:

```python
# Source: existing project pattern, tests/test_worker_heartbeat.py:102
# (app.configure_task(...).defer_async(...) already proven against this
# codebase's own Procrastinate App instance)
@app.periodic(cron="* * * * *")
@app.task(name="sync_all_connected_users")
async def sync_all_connected_users(timestamp: int) -> None:
    async with app.connector.get_sync_connector()... # or a short-lived session
        user_ids = ...  # SELECT user_id FROM schwab_connections
    for user_id in user_ids:
        await app.configure_task("sync_user").defer_async(user_id=str(user_id))


@app.task(name="sync_user")
async def sync_user_task(user_id: str) -> None:
    ...  # the shell: schwab_client_for_user, get_transactions, write both tables
```

### Pattern 2: `ON CONFLICT DO NOTHING` with `RETURNING` for the landed-count

**What:** Idempotent insert that both satisfies `INGEST-03`/`INGEST-04` and reports how many rows
actually landed (for `INGEST-06`), instead of the row count handed in.
**When to use:** Any re-runnable batch insert into an immutable table with a real composite PK.
**Example**, following the exact `pg_insert(...).on_conflict_do_update(...)` shape `vendor/connections.py`
already uses (swap `do_update` for `do_nothing`, add `.returning(...)`):

```python
# Source: existing project pattern, src/morai/vendor/connections.py:253-275
# (pg_insert + on_conflict_* already proven against this codebase's RLS setup)
from sqlalchemy.dialects.postgresql import insert as pg_insert

stmt = (
    pg_insert(Fill)
    .values([...])  # one dict per FillWrite, same shape insert_fills already builds
    .on_conflict_do_nothing(
        index_elements=["user_id", "order_id", "occ_symbol", "leg_index", "execution_time"]
    )
    .returning(Fill.order_id)
)
result = await session.execute(stmt)
landed_count = len(result.fetchall())
```

Verify this against the `fills` RLS policy before relying on it: migration `0007_data_key_and_fills.py`
creates `CREATE POLICY user_isolation ON fills FOR ALL USING (...) WITH CHECK (...)` — `FOR ALL` already
includes `SELECT`, so the implicit read `RETURNING` performs is permitted
`[VERIFIED: alembic/versions/0007_data_key_and_fills.py:152-161, quoted next]`:

> `f"CREATE POLICY user_isolation ON {table_name} " "FOR ALL " "USING (user_id = " "current_setting('app.current_user_id', true)::uuid) " "WITH CHECK (user_id = " "current_setting('app.current_user_id', true)::uuid)"`

`V092` does not bite here specifically because `fills`'s policy is `FOR ALL`, not the `audit_log`-style
INSERT-only policy `V092` was written against. Give `broker_transactions` the identical `FOR ALL`
`user_isolation` policy, not an INSERT-only one — see Pitfall 5.

### Anti-Patterns to Avoid

- **A second per-user lock inside the ingest module:** `schwab_client_for_user` already wraps the whole
  vendor-call body in `pg_advisory_xact_lock(hashtext(:uid))`
  `[VERIFIED: src/morai/vendor/connections.py:377-380]`. Calling it from `sync_user` gets this lock for
  free. Do not add a second lock acquisition — `sync_events`'s own docstring already documents this exact
  reuse for the identical class of race (Phase 5, `CR-02`).
- **Looping all users inside one periodic task body:** defeats the isolation `06-CONTEXT.md` explicitly
  asks for, and makes one user's slow vendor call block every other user's cycle even though the worker
  already runs jobs serially at `concurrency=1` — a single hung `await` inside the periodic task itself
  has no job-boundary for Procrastinate's own retry logic to act on.
- **A stored `has_backfilled` boolean on `schwab_connections`:** a second writer for something already
  derivable from `last_synced_at IS NULL`, the exact anti-pattern `Position`'s own docstring names for why
  it carries no status column, and `derive_connection_health`'s own precedent of deriving state at read
  time rather than storing it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotent batch insert | A manual `SELECT existing THEN INSERT the rest` pre-check | `pg_insert(...).on_conflict_do_nothing().returning(...)` | `NN-3`/`NN-4` — this project has already paid for the TOCTOU/wrong-conflict-target lesson once, in a different table |
| Per-tenant serialization | An in-process asyncio lock or a new advisory-lock call site | `schwab_client_for_user`'s existing `pg_advisory_xact_lock` | Already built, already transaction-scoped, already proven live against Postgres 18 with a bound parameter |
| Vendor JSON parsing | Trusting `response.json()`'s `Any` return type directly | A `TypeAdapter`/Pydantic model at the boundary inside `schwab_adapter.py`'s existing `_response_json` funnel | Matches `D4-03`/`D4-04`'s existing convention: exactly one legitimate `Any` suppression, funneled through one helper |
| First-connect detection | A new boolean/enum column | `schwab_connections.last_synced_at IS NULL` | Already nullable, already proven null by Phase 4, already named as this phase's signal to write |

**Key insight:** every idempotency and concurrency primitive this phase needs already exists in this
codebase, proven against real Postgres, in `vendor/connections.py` and `ledger/pairing.py`. This phase's
job is composition, not invention.

## Common Pitfalls

### Pitfall 1: `NN-10` — never `abs()` the vendor's signed amount

**What goes wrong:** `transferItems[].amount` is Schwab's signed per-leg contract quantity — positive for
contracts received (bought), negative for delivered (sold) `[CITED: salvage/vendor-notes.md:134-141,
itself citing the deleted v1 transactions adapter]`. Taking `abs()` before capturing direction into `side`
destroys the only field carrying it — this is the exact mechanism behind v1's "+$395 trade displayed as
−$319,850" production incident (`NN-10`, `V008`).
**Why it happens:** `quantity` in `FillWrite` is a plain unsigned-looking `Decimal | None` field; it is
tempting to write `abs(amount)` directly into it without first branching on the sign into `side`.
**How to avoid:** Read the sign first, write it into `side` ("buy"/"sell"), and only then take the
magnitude into `quantity`. If `amount` is missing or zero, v1's own fallback used `cost`'s sign instead
(Schwab sends `cost` as the negation of `amount`'s intent), and if neither signal is usable, the leg is
dropped rather than guessed `[CITED: salvage/vendor-notes.md:142-150]` — this exact fallback chain is not
verified against a live payload this session and belongs in the Assumptions Log.
**Warning signs:** Any test fixture where every OPENING leg is a buy and every CLOSING leg is a sell — a
real calendar can buy-to-close and sell-to-open in the same order, and `positionEffect` alone cannot
distinguish that (`NN-9`).

### Pitfall 2: `schwab-py`'s own default lookback is 60 days, not `D6-03`'s 365/90

**What goes wrong:** Calling `get_transactions(account_hash)` with no `start_date`/`end_date` silently
returns only the last 60 days — reading the real installed 1.5.1 source directly confirms this default
and its own docstring's claim of a 60-day range constraint
`[VERIFIED: schwab-py 1.5.1 installed wheel, schwab/client.py AsyncClient.get_transactions source,
quoted]`:

> `":param start_date: Only transactions after this date will be returned. Date must be within 60 days of the current date. If this parameter is not set, it will be set to 60 days prior to now."`

`D6-03`'s carried-forward constants (`SCHWAB_TX_LOOKBACK_MAX_DAYS = 365`, `SCHWAB_TX_MAX_RANGE_DAYS = 90`)
remain the correct thing to carry forward exactly as locked — this finding does not override that
decision — but it is a much stronger, more specific signal than anything `salvage/` records on its own,
and worth logging against explicitly on the first live run rather than treated as a coincidence if the
365/90-day chunked calls come back truncated or erroring.
**Why it happens:** `schwab-py`'s docstring language ("must be within 60 days") reads like Schwab's own
documented API constraint, not merely the SDK's convenience default — but this session did not verify it
against a live call, only against the SDK's own source comment, which the SDK's author wrote, not Schwab.
**How to avoid:** Never call `get_transactions` without explicit `start_date`/`end_date` for anything but
the narrowest routine-sync window. On first-connect backfill, always pass explicit dates chunked to
`SCHWAB_TX_MAX_RANGE_DAYS`, and log the requested window plus the returned element count on every call —
this is the measurement `D6-03` already asks for, and this docstring gives a concrete number to compare
against.
**Warning signs:** A backfill that "succeeds" (200 response, no error) but returns suspiciously few rows
for a 90-day chunked window — that is exactly what a silent >60-day truncation would look like, and
`NN-16`'s discipline (an honest gap, never a fabricated value) applies here too: log the actual returned
count per window, do not assume the requested window was honored.

### Pitfall 3: not every element `get_transactions` returns is a fill

**What goes wrong:** This project's `SchwabClient.get_transactions` Protocol method takes no
`transaction_types` filter, so the real adapter's underlying call defaults to fetching every
`TransactionType` Schwab has — `TRADE`, `RECEIVE_AND_DELIVER` (assignment/exercise), `DIVIDEND_OR_INTEREST`,
`ACH_RECEIPT`, `CASH_RECEIPT`, `JOURNAL`, `MARGIN_CALL`, and eight others
`[VERIFIED: schwab-py 1.5.1 installed wheel, schwab.client.Client.Transactions.TransactionType enum,
inspected directly]`. Treating every returned element as a fill and forcing it through OCC-symbol parsing
will raise or silently corrupt on the first non-trade transaction (a cash disbursement, a margin call).
**Why it happens:** The Protocol's minimal surface (D4-02) hides the `transaction_types` parameter that
exists on the real vendor call, so nothing in this codebase's own types signals that the response is
heterogeneous.
**How to avoid:** `broker_transactions` (D6-02) should store the raw element regardless of type — it
exists to be an independent, complete copy. The fill-extraction step should skip elements it cannot parse
as a trade with valid `transferItems`, per row, and log the skip rather than aborting the whole batch —
the same "parse per row with skip-and-warn" discipline `NN-14` already names for this class of problem.
**Warning signs:** An ingest run whose fill count is unexpectedly lower than its `broker_transactions`
count in a way that isn't explained by expected non-trade activity (dividends, cash movements) for that
account.

### Pitfall 4: the v1 "5-minute cron offset" precedent does not carry forward as a cron offset

**What goes wrong:** `salvage/measured-constants.md` records `sync-transactions` running 5 minutes ahead
of `sync-fills` specifically so transactions land before fills are paired against them — but v1 had two
separate jobs hitting two different code paths. This project's `SchwabClient` Protocol names exactly one
transaction-data method, so both `broker_transactions` and `fills` must be populated from the same
`get_transactions` call, inside the same job. There is no second job to offset against.
**Why it happens:** Reading the salvage precedent literally suggests scheduling two Procrastinate tasks
with a time gap, reproducing an ordering guarantee this design no longer needs.
**How to avoid:** Write `broker_transactions` then `fills` inside one DB transaction, in one function call,
from one vendor response. The reasoning carries forward (write the independent copy before the derived
rows, so a partial failure never leaves fills referencing transactions that never landed); the mechanism
does not (no cron offset needed — CONTEXT.md's own guidance already says to carry the reasoning, not the
exact offset).
**Warning signs:** A plan that proposes two separate periodic tasks or two separate cron expressions for
this phase — that is a sign the v1 precedent was copied too literally.

### Pitfall 5: `V092` — do not make `broker_transactions` INSERT-only

**What goes wrong:** `D6-02`'s own phrasing ("its own single-writer gate") could be misread as calling for
an `audit_log`-style INSERT-only RLS policy. `audit_log`'s policy is deliberately `FOR INSERT` only, with
no `SELECT` grant — and `V092` documents exactly how that combination breaks any ORM insert whose model
has a `server_default` column, because SQLAlchemy silently appends an implicit `RETURNING`, which Postgres
treats as a read the policy set has no `SELECT` clause to permit
`[VERIFIED: src/morai/identity/audit.py:92-103, quoted]`:

> `"the ORM-style insert(AuditLog).values(...) looked right and type-checked, but failed at runtime with InsufficientPrivilegeError... because AuditLog.id's server_default makes SQLAlchemy append an implicit RETURNING audit_log.id... and a RETURNING clause is itself a read that Postgres RLS checks against the table's SELECT policies."`

**Why it happens:** "Single-writer" (a *code-level* guarantee — only the ingest module imports the write
function, enforced by a gate meta-test) is a different property from "INSERT-only" (a *database-level*
RLS restriction). `D6-02` asks only for the former.
**How to avoid:** Give `broker_transactions` the same `FOR ALL` `user_isolation` RLS policy `fills`
already carries (Pattern 2 above), not an INSERT-only one. Users need to read their own broker
transactions back — for `INGEST-06`'s sync-run detail and for Phase 9's reconciliation — so a `SELECT`
grant is required functionally as well as to sidestep `V092`.
**Warning signs:** `InsufficientPrivilegeError` naming a `SELECT` permission on an INSERT statement that
never asked for one.

### Pitfall 6: the web process has no Procrastinate connector — `INGEST-04` needs one added

**What goes wrong:** `worker/app.py`'s own docstring states plainly: "The web process gets no Procrastinate
connector this phase — nothing defers a job from a request yet"
`[VERIFIED: src/morai/worker/app.py:10-11]`. `INGEST-04` ("user can trigger a re-sync manually") needs the
web process to defer a `sync_user` job from an authenticated API route. Procrastinate ships no `asyncpg`
connector `[VERIFIED: src/morai/worker/app.py:4-6, matches this project's own 01-RESEARCH.md connector
table]`, so the web process's existing `AsyncEngine` cannot defer a job directly.
**Why it happens:** Phase 1 scoped the worker's own pool deliberately narrowly and explicitly deferred
this connection for "nothing defers a job from a request **yet**" — this phase is where "yet" ends.
**How to avoid:** Add a second, small `PsycopgConnector`-backed `procrastinate.App` instance to the web
process, used only to `.configure_task(...).defer_async(...)` — never `.run_worker_async()` from the web
process. This is a third connection pool against `NN-28`'s ceiling (the worker's own pool, the web
process's `asyncpg` pool, and now this small deferral-only pool) — size it minimally (e.g. `min_size=1,
max_size=1`, mirroring the worker's own capped-explicitly reasoning) and update the pool-budget accounting
this phase's plan should carry.
**Warning signs:** An `INGEST-04` route implementation that tries to reuse `get_db_session`'s `AsyncSession`
to defer a Procrastinate job, or that inserts directly into `procrastinate_jobs` via raw SQL instead of
going through Procrastinate's own `defer_async` (which also handles the `procrastinate_jobs_notify_queue_job_inserted_v1`
trigger's `pg_notify` — a raw insert would silently skip the wakeup notification the live worker listens
for, per migration `0002`'s own trigger).

### Pitfall 7: an expired refresh token mid-cycle must fail one job, not the tick

**What goes wrong:** The Schwab refresh token expires after 7 days, hard, server-side (`V001`). If a
user's token expires between cron ticks, that user's `sync_user` job will raise from inside
`schwab_client_for_user`/`build_client`. If all users were processed inside one periodic task body (the
anti-pattern above), this one failure would abort the whole cycle for every other connected user.
**Why it happens:** Nothing in `schwab_client_for_user` catches or classifies this failure — by design, it
propagates so the caller's transaction rolls back cleanly (its own docstring: "If the body raises, this
step never runs and nothing here is persisted").
**How to avoid:** With per-user deferred jobs (this phase's own recommendation), Procrastinate's own job
failure semantics already isolate this — a failed `sync_user` job records `status='failed'` in
`procrastinate_jobs` and does not touch the other deferred jobs. The `sync_runs` row for that user should
record the failure (INGEST-06's "what errored"), classified by error type per `NN-20` (never map every
non-2xx/exception to one generic code), never rendering the raw exception text if it could carry a token
or credential (`NN-34`).
**Warning signs:** A `sync_runs.error_detail` column containing what looks like a stack trace or a raw
vendor response body — that is a `NN-34` leak vector waiting to happen, the same class of risk
`routes_connections.py`'s own docstring names for the OAuth callback's query string.

## Code Examples

### Chunking a lookback window (pure function, no network/DB)

```python
# Pattern only -- this phase's own function, following the pure/shell split
# derive_events and derive_connection_health already establish in this codebase.
from datetime import datetime, timedelta

def chunk_date_range(
    start: datetime, end: datetime, *, max_range_days: int
) -> list[tuple[datetime, datetime]]:
    """Splits [start, end) into consecutive windows no wider than
    max_range_days. Pure -- no clock read, no I/O -- so it is testable with
    fixed inputs exactly like derive_connection_health's own now-as-a-parameter
    idiom."""
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    step = timedelta(days=max_range_days)
    while cursor < end:
        window_end = min(cursor + step, end)
        windows.append((cursor, window_end))
        cursor = window_end
    return windows
```

### Registering the ingest tasks on the existing worker `App`

```python
# Source: existing project pattern, src/morai/worker/app.py:38-45
# (the same app instance, same decorator order the heartbeat already proves)
from morai.ingest.schwab_sync import sync_all_connected_users, sync_user

app.periodic(cron="* * * * *")(app.task(name="sync_all_connected_users")(sync_all_connected_users))
app.task(name="sync_user")(sync_user)
```

(Or, more idiomatically, decorate `sync_all_connected_users`/`sync_user` directly in `ingest/schwab_sync.py`
if that module imports `app` from `worker/app.py` — decide based on whether `worker/app.py` should stay
the single place task names are declared, matching its own current role, or whether task registration
should live beside the task's own logic. Either is defensible; `worker/app.py`'s current docstring frames
it as "its own psycopg v3 pool, and one periodic heartbeat" — a plan choosing to keep registration
centralized there is consistent with that framing.)

## State of the Art

Not applicable in the "library upgrade" sense — no library changed. The one relevant shift is internal to
this project's own design: v1's two-job (`sync-transactions` / `sync-fills`) split with a cron-offset
hack is superseded by this phase's one-job, one-transaction design, because the `Protocol` surface this
project chose (Phase 4, D4-02) exposes only one transaction-data method. See Pitfall 4.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Schwab's raw transaction JSON carries `activityId` as a per-transaction unique identifier suitable as (part of) `broker_transactions`'s primary key | Q4 (below), Architecture Patterns | If `activityId` is not unique per user/account, the proposed PK needs a defense-in-depth column added (e.g. `order_id` + an index within the transaction) before the first live run, per `NN-1`'s own discipline |
| A2 | The vendor field mapping for `FillWrite` (`quantity` = magnitude of `transferItems[].amount`, `side` from its sign with `cost`-sign fallback, dropped if neither usable) matches Schwab's real current payload shape | Pitfall 1, Q3 | This entire mapping is carried from `salvage/`'s citation of the *deleted* v1 adapter, never re-verified against a live 2026 Schwab response this session. A field rename or shape change on Schwab's side would silently misclassify direction — exactly the class of bug `NN-9`/`NN-10` already cost real money once |
| A3 | `transferItems[].price` is the field `FillWrite.price_usd` should read | Q3 | Not cited in any file read this session — recalled from general Schwab API familiarity, not verified. Confirm against the first live payload before trusting it |
| A4 | Schwab's real per-call transactions range limit is closer to the 60-day figure `schwab-py`'s own docstring claims than to `D6-03`'s carried-forward 90-day estimate | Pitfall 2 | If wrong, the 90-day chunking already carries forward correctly regardless (D6-03 is locked); if right, a plan that only chunks at 90 days risks a first-connect backfill silently losing 30 days per window until the first live run surfaces it via the logging this phase adds |
| A5 | The web process's second Procrastinate `App` (deferral-only, for `INGEST-04`) should use `min_size=1, max_size=1` | Pitfall 6 | Sized by analogy to the worker's own capped-explicitly reasoning, not measured. If manual re-syncs are frequent under real usage, this may need raising — re-derive against `NN-28`'s combined ceiling before raising it |

**None of these are compliance, retention, or performance-target claims** — all five are vendor-shape or
sizing judgments that the first live Schwab connection (owed, per `06-CONTEXT.md`, to a later session with
Railway secrets set) will directly confirm or refute.

## Open Questions

1. **Is `activityId` actually unique per user, or only per account, or not guaranteed unique at all?**
   - What we know: `salvage/oracle-fixtures.md` treats it as an identifying value for a real order's
     activity, citing "real `activityId`, real `orderId`" as what makes the 13-calendar oracle trustworthy.
   - What's unclear: uniqueness was never stated as a vendor-documented guarantee in any source read this
     session, only used as if it holds.
   - Recommendation: use `(user_id, activity_id)` as `broker_transactions`'s primary key per `NN-1`, and
     treat any live-run `IntegrityError` on this constraint as the measurement that closes this question,
     rather than assuming it will never fire.

2. **What is Schwab's actual rate limit on `get_transactions`, and does a 365-day backfill chunked at
   90-day windows (five calls) risk it?**
   - What we know: nothing measured in this repo. `salvage/` records rate-limit traps for other Schwab
     endpoints (chain body-size limits, V004/V005) but not transactions specifically.
   - What's unclear: whether five sequential calls per first-connect backfill, across a handful of users,
     is anywhere near a real ceiling.
   - Recommendation: log request/response timing and any `429`/rate-limit-shaped response explicitly on
     the first live run; do not add a delay/backoff mechanism preemptively for a limit that has not been
     observed.

3. **Should `sync_runs` carry its own `_write_token` gate, matching `broker_transactions`?**
   - What we know: `D6-02` mandates the gate for `broker_transactions` specifically, citing Phase 9's
     reconciliation independence as the reason. `06-CONTEXT.md` leaves `sync_runs`'s shape to discretion
     and says nothing about a gate for it.
   - What's unclear: whether a future second writer to `sync_runs` (e.g., a manual-resync route writing a
     row directly instead of through the same shell function) is a real risk this phase should defend
     against now.
   - Recommendation: no gate for `sync_runs` this phase, following `Event`'s own precedent (no gate until a
     second writer becomes a real temptation) — but route `INGEST-04`'s manual trigger through the same
     `sync_user` job the periodic task defers, rather than writing a parallel code path, so the question
     of a second writer never actually arises.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Postgres 18 | All DB-marked tests, `bash tools/gate.sh` | Yes `[VERIFIED: brew services, per CLAUDE.md]` | 18 | — |
| Live Schwab connection | Measuring `D6-03`'s real per-call limits, confirming A1-A4 above | No — Railway secrets not set | — | `Protocol` fake (`tests/vendor/conftest.py`'s `FakeSchwabClient`), extended with a `get_transactions` fixture returning representative raw JSON. Every fact this session could not verify against a live payload is logged in the Assumptions Log and named explicitly as owed to a later live-run session, per `06-CONTEXT.md`'s own constraint |
| `schwab-py` installed wheel | Reading real source for `get_transactions`'s signature/defaults (this session did this directly) | Yes `[VERIFIED: uv pip show schwab-py -> 1.5.1]` | 1.5.1 | — |

**Missing dependencies with no fallback:** none — the live Schwab connection's absence is explicitly
in-scope-to-defer per this phase's own constraints, not a blocker to planning or building against the fake.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1, `pytest-asyncio` (`asyncio_mode = "auto"`) `[VERIFIED: pyproject.toml:85-95]` |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `uv run pytest -q -m "not db"` (skips the one `@pytest.mark.db`-gated class) |
| Full suite command | `export DATABASE_URL=... MORAI_APP_DB_PASSWORD=... MORAI_MASTER_KEY=... MORAI_ENV_FILE="" && uv run pytest -q` (~13s, per `CLAUDE.md`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INGEST-01 | Periodic task defers one job per connected user | unit + `@pytest.mark.db` | `pytest tests/ingest/test_fanout.py -x` | ❌ Wave 0 |
| INGEST-02 | A raw fill preserves signed direction and `position_effect` unmodified | unit (pure extraction function) | `pytest tests/ingest/test_extract_fills.py -x` | ❌ Wave 0 |
| INGEST-03 | Re-running over an overlapping window lands zero new rows the second time | `@pytest.mark.db` | `pytest tests/ingest/test_idempotency.py -x` | ❌ Wave 0 |
| INGEST-04 | Manual re-sync route defers the same job the periodic task defers | `@pytest.mark.db` (route + Procrastinate `open_async`) | `pytest tests/api/test_sync_route.py -x` | ❌ Wave 0 |
| INGEST-05 | First-connect backfill chunks the full lookback window; routine sync does not | unit (pure `chunk_date_range`) + `@pytest.mark.db` | `pytest tests/ingest/test_backfill.py -x` | ❌ Wave 0 |
| INGEST-06 | `sync_runs` row reflects landed count and errors, queryable per-user | `@pytest.mark.db` (RLS-scoped read) | `pytest tests/ingest/test_sync_runs.py -x` | ❌ Wave 0 |
| OPS-05 | `broker_transactions` insert chunks at ≤2,000 rows | unit (parametrize a >2,000-row batch, assert flush-call count) | `pytest tests/ingest/test_broker_transactions_chunking.py -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `uv run pytest -q -m "not db" tests/ingest/`
- **Per wave merge:** full suite (`bash tools/gate.sh`)
- **Phase gate:** full suite green before `/gsd-verify-work`, exactly as `CLAUDE.md` already states

### Wave 0 Gaps

- [ ] `tests/ingest/__init__.py`, `tests/ingest/conftest.py` — new test package, needs a `FakeSchwabClient`
      fixture returning representative raw `get_transactions` JSON (extend `tests/vendor/conftest.py`'s
      existing `FakeSchwabClient.get_transactions`, which today unconditionally returns `[]`)
- [ ] `tests/ingest/test_fanout.py`, `test_extract_fills.py`, `test_idempotency.py`, `test_backfill.py`,
      `test_sync_runs.py`, `test_broker_transactions_chunking.py` — none exist yet
- [ ] `tests/api/test_sync_route.py` — none exists yet
- [ ] `tests/gate/fixtures/violation_second_broker_transactions_writer.py` — the `D6-02`-mandated gate
      meta-test needs a negative-control fixture, mirroring `tests/gate/fixtures/violation_second_fill_writer.py`
      exactly, per the pattern `tests/gate/test_vendor_boundary.py`/`test_type_gate.py` already establish
- [ ] Framework install: none — pytest/pytest-asyncio already present

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial | The new `POST /schwab/sync` route reuses `get_current_user`/session-cookie auth already built (Phase 2) — no new auth mechanism |
| V3 Session Management | No | No change to session handling this phase |
| V4 Access Control | Yes | RLS `user_isolation` policy on `broker_transactions`/`sync_runs`, scoped via `app.current_user_id`, matching `fills`'s existing enforcement exactly |
| V5 Input Validation | Yes | `TypeAdapter`/Pydantic model at the `get_transactions` boundary, following `D4-03`'s existing convention (never trust `response.json()`'s `Any` directly) |
| V6 Cryptography | No new decision | This phase writes plaintext-by-design columns (`order_id`, `activity_id`, `time`, `type`) mirroring `fills`'s own precedent for the same columns; if any field here is judged a position-size-equivalent secret (e.g. a raw dollar `netAmount`), encrypt it exactly as `quantity`/`price_usd` already are, using the same `crypto/envelope.py` helpers, not a new primitive |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A raw vendor error (containing a token fragment or full response body) written into `sync_runs.error_detail` | Information Disclosure | Classify the error type before storing (`NN-20`); never store `str(exc)` verbatim for anything touching the OAuth/token path (`NN-34`), mirroring `routes_connections.py`'s own discipline for the callback route |
| A second, unaudited writer inserting into `broker_transactions` from the derivation pipeline | Tampering | `D6-02`'s `_write_token` gate + meta-test — a compile-time and test-time guarantee, not a review-time one, exactly like `Fill`'s existing gate |
| A manual-resync route triggerable without rate limiting, hammering the vendor and burning the 7-day refresh-token's single-writer lock contention | Denial of Service (of the user's own connection, not the system) | Not addressed by any existing code this session found — worth an explicit plan decision: either accept it at this project's scale (a handful of trusted users) or add a simple per-user cooldown (e.g. reject a second manual trigger within N seconds of `last_synced_at`) |

## Sources

### Primary (HIGH confidence)
- `schwab-py` 1.5.1 installed wheel, read directly via `inspect.getsource` this session — `get_transactions`'s real signature, its default 60-day window, and the `TransactionType` enum's 15 members
- `alembic/versions/0002_procrastinate_schema.py` — read directly this session; confirms
  `procrastinate_periodic_defers_unique UNIQUE (task_name, periodic_id, defer_timestamp)` at line 128
- `alembic/versions/0007_data_key_and_fills.py` — read directly this session; confirms `fills`'s `FOR ALL`
  RLS policy (not INSERT-only)
- `src/morai/vendor/connections.py`, `src/morai/vendor/schwab_adapter.py`, `src/morai/vendor/protocol.py`,
  `src/morai/ledger/fills.py`, `src/morai/ledger/pairing.py`, `src/morai/db/models.py`,
  `src/morai/worker/app.py`, `src/morai/settings.py`, `src/morai/api/routes_connections.py` — read
  directly this session
- `procrastinate` 3.9.0 installed package — `Worker.__init__`'s `concurrency: int = 1` default, read via
  `inspect.signature` this session
- `.railway/railway.ts` — read directly this session; confirms the deployed worker start command carries no
  `--concurrency` override

### Secondary (MEDIUM confidence)
- `docs/learnings/vendors-and-infra.md` (`V001`, `V008`, `V092`, `V093`) and `REBUILD-BRIEF.md` (`NN-1`,
  `NN-5`, `NN-9`, `NN-10`, `NN-16`, `NN-28`) — this project's own prior research, cited by ID per project
  convention
- `salvage/vendor-notes.md`, `salvage/oracle-fixtures.md`, `salvage/measured-constants.md` — citations of
  the *deleted* v1 codebase's own comments; treated as historical record, not independently re-verified
  against a live Schwab payload this session (flagged throughout as `[CITED: salvage/...]`)

### Tertiary (LOW confidence)
- `transferItems[].price` as the source field for `FillWrite.price_usd` (Assumption A3) — recalled, not
  found cited in any file read this session; flagged in the Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new library, every version confirmed against the actual installed environment
- Architecture (fan-out, locking, RLS reuse): HIGH — every mechanism cited here already exists in this
  codebase, read directly, and is proven by an existing green test suite
- Vendor payload shape (Pitfalls 1/3, Assumptions A1-A3): LOW — no live Schwab connection exists this
  session; every specific field name beyond what `salvage/`'s citations confirm is either `[CITED]` from a
  deleted codebase's comments or `[ASSUMED]`, and is explicitly named as owed to the first live run

**Research date:** 2026-09-01
**Valid until:** 30 days for the architecture/mechanism claims (stable, this project's own code); the
vendor-shape assumptions (A1-A4) are valid only until the first live Schwab connection, whichever comes
first — treat them as provisional the moment Railway secrets are set
