# Phase 9: Reconciliation Invariant and Status Endpoint - Research

**Researched:** 2026-09-01
**Domain:** Money-invariant checking over encrypted, per-user Postgres data; a read-only status
endpoint; no new external dependency.
**Confidence:** MEDIUM overall. HIGH on every codebase pattern (all read live this session).
LOW on the one thing no source in this repo settles: the exact shape of a live Schwab
`get_transactions` element for a non-`TRADE` type.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D9-01** — The window is a settlement-date trading day, in ET (`America/New_York`).
- **D9-02** — A window closes when a later trading day's broker transaction has landed. Not on a
  clock timeout.
- **D9-03** — Late data reopens a closed window, and the reopening is itself a finding. Never
  absorbed silently.
- **D9-04** — Timezone via `zoneinfo`, never a hardcoded offset. Follows
  `src/morai/ledger/settlements.py`'s `AM_SETTLEMENT_TIME`/`PM_SETTLEMENT_TIME` pattern. `tzdata`
  is already an explicit dependency (Phase 8).
- **D9-05** — The fee collision resolves by filling `commission_usd`, not by changing the oracle.
  Populate `commission_usd` from the broker's own transaction data. Leave every fee-free money
  field on `events` untouched. Reconciliation compares `Σ(fee-free realised P&L) − Σ(commissions)`
  against the broker's cash delta.
- **D9-06** — Commissions come from the broker's own payload — the same independently-sourced
  `broker_transactions` rows the cash delta comes from. Never recomputed from a per-leg constant.
- **D9-07** — Exact equality on `Decimal`. No epsilon. A deliberately seeded one-cent discrepancy
  must FAIL the check.
- **D9-08** — An unknown input makes a window `indeterminate`, never `passing`. Applies to a
  missing commission, an unrecognised transaction type, and an unpriced settlement alike.
- **D9-09** — Cash-delta membership is an allow-list, not a deny-list of transfers. An
  unrecognised `transaction_type` routes to `indeterminate` (D9-08), not silent inclusion.
- **D9-10** — Amounts are summed in Python over decrypted rows, not in SQL. Postgres never sees
  plaintext money; no SQL aggregate can sum it.
- **D9-11** — An unpriced SETTLEMENT (D7-07's NULL money fields) makes its window
  `indeterminate`, not failing.
- **D9-12** — One function, two callers: a pytest test and the ingest cycle. `D8-13` established
  this shape in Phase 8 and it held.
- **D9-13** — A persisted `reconciliation_runs` row per user per window, carrying window bounds,
  both sides of the comparison, the signed difference, and the verdict (`passed`/`failed`/
  `indeterminate`, with a reason).
- **D9-14** — Trustworthiness is a typed field on the response envelope, not a separate opt-in
  call.
- **D9-15** — The status endpoint reads the latest persisted verdict and never recomputes.

### Claude's Discretion

- Table and column naming, and whether `reconciliation_runs` mirrors `sync_runs`/`snapshot_runs`
  exactly or diverges where the shape genuinely differs.
- Where `commission_usd` is stored — on `events`, on a sibling table, or derived at read time —
  provided the fee-free fields the oracle reads are untouched.
- The precise `indeterminate` reason vocabulary, provided the causes are distinguishable.
- Whether the trading-day calendar is derived from observed broker activity or from a fixed
  session definition, provided no new dependency is added for it.

### Deferred Ideas (OUT OF SCOPE)

- Pricing the settlements whose money fields are NULL (`D7-07`). Needs Phase 8's captured market
  data applied to expiries; until then an affected window is `indeterminate` (`D9-11`).
- Alerting when reconciliation fails. This phase makes the verdict queryable and marks dependent
  numbers untrustworthy; routing that to a notification channel is not in its criteria.
- Reconciling anything other than cash — position quantities against the broker's own position
  report. RECON-01 is specifically about cash.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RECON-01 | Sum of realised P&L over a window equals the broker's cash delta, net of transfers | §"The window boundary in code", §"The allow-list", §"The comparison arithmetic" |
| RECON-02 | Check runs automatically every ingest cycle as a test, not a displayed number | §"Hooking into the ingest cycle", §"One function, two callers" |
| RECON-03 | Reconciliation status queryable cheaply, failure names the window | §"reconciliation_runs migration", §"The status endpoint" |
| RECON-04 | On failure, API reports it and marks dependent numbers untrustworthy | §"The response envelope" |
| API-01 | Reconciliation status its own lightweight endpoint, cheap enough to poll | §"The status endpoint" |
</phase_requirements>

## Summary

This phase adds one new pure/shell pair (`morai/ledger/reconciliation.py`, following
`derive_settlements`/`read_legs`'s exact split), one migration (`0016`, a `reconciliation_runs`
table mirroring `sync_runs`' shape with three-state verdict instead of two), one call site inside
`sync_user` (after `sync_events`, before the function returns), and one FastAPI route plus a
typed field threaded onto the existing response envelope.

Every piece of this phase composes existing, already-proven codebase patterns — there is no new
library, no new dependency, and no schema change to any table the 13-calendar oracle reads.
`commission_usd` (already `Decimal | None` on `DerivedEvent` since Phase 5, specifically for this
phase per `D5-04`) is best computed **at reconciliation read-time**, from `broker_transactions`
directly, rather than persisted onto `events` — this keeps `insert_events`/`read_events`, the
`events` table's schema, and `derive_events`'s pure derivation completely untouched, which is the
lowest-risk way to satisfy D9-05's instruction to leave every fee-free field alone.

The one genuinely open question this research could not settle from any source in this repo,
its dependencies, or the public web this session is the **exact field names Schwab uses for a
transaction's net cash amount and its commission/fee breakdown** on a live `get_transactions`
response. `schwab-py` is a thin, unmodeled HTTP wrapper (confirmed: no response schema anywhere in
its installed source) and this project's own fixtures only ever populate `amount`/`cost`/`price`
on `transferItems[]` — the same three fields `extract_fills` already reads for fills, never
`netAmount`. This is not a new gap invented by this research; it is the same "owed to the first
live run" honest ceiling `schwab_sync.py`'s own module docstring already states for the sign
convention. The plan should treat the transaction-level cash amount and commission field names
as **named, injectable constants** the way `sync_windows`' range settings already are, verified
against the first live payload, not guessed here.

**Primary recommendation:** build `reconciliation.py` as a pure function
`reconcile_window(events, broker_transactions, *, window_start, window_end) -> ReconciliationResult`
taking already-decrypted, already-narrowed-to-window Python values (mirroring `derive_settlements`
exactly), a thin async shell `run_reconciliation` that reads/decrypts/windows/calls it/persists,
call that shell from `sync_user` right after `sync_events`, and unit-test the pure function
directly with a fixture that seeds a one-cent discrepancy — never touching `oracle_seed.py` or
`salvage/oracle-fixtures.md`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Window derivation (trading-day boundaries) | Backend (pure function) | — | No client input; deterministic function of `broker_transactions.transaction_time` and `zoneinfo`. |
| Reconciliation arithmetic (sum, compare, verdict) | Backend (pure function) | — | Money-path logic; must be unit-testable with no DB (D9-12). |
| Reconciliation persistence (`reconciliation_runs`) | Database / Storage | Backend (worker shell) | RLS-protected row per user per window; written once, from the ingest worker. |
| Trigger on every ingest cycle | API / Backend (worker) | — | `sync_user`'s own transaction is where the write-order guarantee (commissions before comparison) actually lives. |
| Status read | API / Backend | Database | One indexed row read (D9-15) — cheap enough to poll, no decryption of the full window on every request. |
| Trustworthiness signal | API / Backend | — | Carried on the response envelope (D9-14), not a separate call a client can forget. |

## Standard Stack

### Core

No new library. Every dependency this phase needs is already installed and pinned:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sqlalchemy` (async) | 2.0.52 (already pinned) | `reconciliation_runs` ORM model, session I/O | Same `Mapped[]` declarative style every table in `db/models.py` already uses. |
| `zoneinfo` (stdlib) + `tzdata` | `tzdata==2026.3` (already pinned, `pyproject.toml:20` [VERIFIED: pyproject.toml:20], `"tzdata==2026.3",`) | Settlement-date trading-day boundaries in ET (D9-01, D9-04) | Already the project's own pattern (`settlements.py`'s `_EASTERN = ZoneInfo("America/New_York")`). No market-calendar package needed — see "The trading-day calendar" below. |
| `decimal.Decimal` (stdlib) | — | Exact-equality comparison (D9-07) | Already end-to-end in this codebase; `_encode_decimal`/`_decode_decimal` (`fills.py:113-120` [VERIFIED: src/morai/ledger/fills.py:113-120], `return str(value).encode("utf-8")` / `return Decimal(value.decode("utf-8"))`) round-trip through `str()`, never `float()`. |
| `pydantic` v2 | 2.13.5 (already pinned) | `ApiModel` response envelope field, `StrEnum` verdict | Already the project's convention (`api/models.py`). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `enum.StrEnum` (stdlib) | — | Three-state verdict (`passed`/`failed`/`indeterminate`) | Same shape as `SyncStatus`/`SnapshotRunStatus`/`ConnectionHealth`, the last of which is already a *three*-state `StrEnum` precedent (`vendor/connections.py:121-124` [VERIFIED: src/morai/vendor/connections.py:121-124], `class ConnectionHealth(StrEnum): HEALTHY = "healthy" / EXPIRING_SOON = "expiring_soon" / EXPIRED = "expired"`). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `zoneinfo`-derived trading days from observed broker activity | A market-calendar package (`pandas_market_calendars`, `exchange_calendars`) | Rejected — new dependency for a fact this project can derive from data it already has (D9-02 makes a *later transaction's arrival* the close signal, not a calendar lookup). See "The trading-day calendar" below for the full argument. |
| Deriving commission from `broker_transactions` at reconciliation read-time | Persisting `commission_usd` on `events` via a migration 0016 column | Viable, and closer to literally "filling" `DerivedEvent.commission_usd`, but touches the one table the 13-calendar oracle reads (`events`) and forces `derive_events`'s pure function to accept a second input stream it has never taken. Read-time computation achieves the identical invariant with zero schema risk to oracle-critical code. Left as Claude's Discretion in `09-CONTEXT.md`; this research recommends read-time. |
| Exact `Decimal` equality (D9-07, locked) | An epsilon tolerance | Explicitly rejected by the user's own decision — any epsilon loose enough to absorb float/rounding noise is loose enough to absorb the seeded one-cent discrepancy criterion 2 requires to fail. |

**Installation:** none. No `pyproject.toml` change is needed for this phase.

**Version verification:** `tzdata==2026.3` confirmed already pinned by direct read of
`pyproject.toml:20` this session — `[VERIFIED: pyproject.toml:20]`. No other package needs
verification since none is newly introduced.

## Package Legitimacy Audit

**Not applicable.** This phase introduces zero new external packages. No `npm view`/`pip index
versions` check is needed; nothing to audit.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │  sync_user (schwab_sync.py, per-cycle)   │
                    │                                           │
  Schwab windows →  │  1. insert_broker_transactions            │
                    │  2. insert_fills                          │
                    │  3. create_positions                      │
                    │  4. sync_events(as_of=now)                │
                    │  5. ── NEW: run_reconciliation(as_of=now)─┼──┐
                    └─────────────────────────────────────────┘  │
                                                                   │
                    ┌──────────────────────────────────────────┐ │
                    │  run_reconciliation (shell, new)          │◄┘
                    │                                            │
                    │  a. read_events(user)         (decrypt)   │
                    │  b. read broker_transactions   (decrypt   │
                    │     rows in window, allow-listed types)   │
                    │  c. derive candidate windows               │
                    │     (settlement-date trading days,         │
                    │     D9-01/D9-02/D9-03)                     │
                    │  d. for each window not yet closed-and-    │
                    │     unchanged: reconcile_window(...)       │
                    │  e. insert reconciliation_runs row(s)      │
                    └──────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  reconcile_window (pure, new)              │
                    │                                             │
                    │  Σ(fee-free realised P&L, events in window) │
                    │  − Σ(commissions, broker_transactions)      │
                    │  == Σ(allow-listed cash amounts,             │
                    │       broker_transactions in window)         │
                    │                                               │
                    │  → ReconciliationVerdict:                     │
                    │     passed / failed / indeterminate + reason  │
                    └──────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  reconciliation_runs (Postgres, RLS)       │
                    └──────────────────────────────────────────┘
                                        │
                                        ▼  (read-only, D9-15)
                    ┌──────────────────────────────────────────┐
                    │  GET /reconciliation/status  (new route)  │
                    │  reads latest row, never recomputes       │
                    └──────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  Every response envelope carrying         │
                    │  dependent numbers (D9-14): typed          │
                    │  `trustworthy: bool` field, read from the  │
                    │  same latest-row lookup                    │
                    └──────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/morai/
├── ledger/
│   ├── reconciliation.py     # NEW — pure reconcile_window() + shell run_reconciliation()
│   ├── pairing.py            # UNCHANGED — DerivedEvent.commission_usd stays None here
│   ├── events.py             # UNCHANGED — no new column, no new write path
│   └── settlements.py        # Reference pattern for pure/shell split, zoneinfo usage
├── ingest/
│   ├── schwab_sync.py        # ONE new call: run_reconciliation(...) after sync_events
│   └── broker_transactions.py # UNCHANGED write path; reconciliation reads via a new
│                              #  read function, following read_legs's own convention
├── api/
│   ├── routes_reconciliation.py  # NEW — GET /reconciliation/status
│   └── models.py             # Possibly extend ApiModel-derived envelope, or a shared
│                              #  mixin, for the trustworthy field (D9-14)
alembic/versions/
└── 0016_reconciliation_runs.py   # NEW migration
tests/ledger/
└── test_reconciliation.py    # NEW — pure-function tests, including the seeded 1-cent case
tests/ingest/
└── test_sync_tracer.py       # EXTEND — prove sync_user actually calls run_reconciliation
                               #  (the CR-01 anti-pattern: "wired to nothing")
```

### Pattern 1: Pure/shell split (mirror `derive_settlements`/`read_legs` exactly)

**What:** A pure function taking already-fetched, already-decrypted domain values plus an explicit
`as_of`/window bound, with no `AsyncSession` parameter and no clock read. A thin async shell that
does the session I/O, decryption, and windowing, then calls the pure function.

**When to use:** Every money-path derivation in this codebase already does this
(`derive_events`, `derive_settlements`, `derive_connection_health`). Reconciliation is no
exception, and D9-12 requires it explicitly: the pytest suite must be able to call the checking
logic with zero database, and production must call the *identical* function, not a re-derivation.

**Example (the shape to follow, verbatim from the existing codebase):**
```python
# Source: src/morai/ledger/settlements.py:99-160 (read this session)
def derive_settlements(
    legs: Sequence[LegRecord],
    events: Sequence[EventRecord],
    *,
    as_of: datetime,
    closed_positions: Mapping[UUID, bool | None],
) -> tuple[DerivedSettlement, ...]:
    ...  # no AsyncSession, no clock read — as_of is the only time input
```
Reconciliation's own pure function should take the analogous shape: `events: Sequence[EventRecord]`,
`broker_transactions: Sequence[BrokerTransactionRecord]` (a new, reconciliation-local read model —
see "Where commission_usd should live" below), and `window_start`/`window_end` — never a session,
never `datetime.now()`.

### Pattern 2: The composite-window "closed unless a later transaction lands" shape (D9-02)

**What:** A window is not closed by a clock. It stays open until `broker_transactions` shows a
transaction whose `transaction_time` (already plaintext — `transaction_time` is a top-level
plaintext column per `alembic/versions/0011_broker_transactions.py:36` [VERIFIED:
alembic/versions/0011_broker_transactions.py:36], `` "- `transaction_time`: the window Phase 9's reconciliation compares over." ``)
falls on a *later* trading day than the window itself.

**When to use:** Deriving which windows are eligible to be checked (or re-checked, D9-03) on a
given `sync_user` run.

**Concrete derivation, no new dependency:** because `broker_transactions.transaction_time` is
already plaintext and already indexed implicitly by the table's own read path, "the set of
trading days with at least one transaction, in ET calendar-date terms" is exactly
`{transaction_time.astimezone(ZoneInfo("America/New_York")).date() for row in broker_transactions}`.
A window `[trading_day]` is closed once this set contains any date strictly greater than
`trading_day`. This needs no market-calendar package — see "The trading-day calendar" below for
the full argument, including the one case where a calendar package would become genuinely
necessary (and it is not this phase's case).

### Pattern 3: The three-state verdict, `StrEnum`, `indeterminate` never collapsing to `passed` or `failed`

**What:** `class ReconciliationVerdict(StrEnum): PASSED = "passed"; FAILED = "failed";
INDETERMINATE = "indeterminate"`, following `SyncStatus`/`SnapshotRunStatus`'s exact `StrEnum`
shape, and `ConnectionHealth`'s precedent for a *three*-member enum in this exact codebase.

**When to use:** Every verdict this phase computes. D9-08 is explicit that collapsing
`indeterminate` into either terminal state is wrong in both directions.

**Example:**
```python
# Source: src/morai/vendor/connections.py:121-124 (read this session)
class ConnectionHealth(StrEnum):
    HEALTHY = "healthy"
    EXPIRING_SOON = "expiring_soon"
    EXPIRED = "expired"
```

### Pattern 4: Run-ledger table, closest analog `sync_runs` not `snapshot_runs`

**What:** `reconciliation_runs` should mirror `sync_runs`'s table shape (Alembic migration
`0012_sync_runs.py`, read this session in full) more closely than `snapshot_runs`'s:
append-only (`GRANT SELECT, INSERT, DELETE`, no `UPDATE` — D9-03's "reopening is itself a
finding" means a reopened window's re-check is a **new row**, not an `UPDATE` of the old one,
exactly mirroring `snapshot_runs`' own "a repair run legitimately produces a second row for a slot
already captured" reasoning quoted in `0015_snapshot_capture.py:77-78` [VERIFIED:
alembic/versions/0015_snapshot_capture.py:77-78], `` "No unique constraint on `(user_id, slot_time)`: a repair run legitimately produces a second row for a slot already captured, and this table's whole job is telling those two runs apart, not collapsing them." ``).

**When to use:** The `0016_reconciliation_runs.py` migration.

**Recommended columns**, following the union of `sync_runs`' shape (`0012_sync_runs.py:94-119`
[VERIFIED: alembic/versions/0012_sync_runs.py:94-119]) and D9-13's own explicit requirement list:

```
id                  UUID PK, server_default gen_random_uuid()
user_id             UUID FK users.id, NOT NULL          -- RLS predicate
window_start        timestamptz NOT NULL                -- D9-13: window bounds
window_end          timestamptz NOT NULL
realised_pnl_usd    numeric(14,4) NOT NULL               -- Σ fee-free P&L, D9-13
commissions_usd     numeric(14,4) NULL                    -- Σ commissions (NULL if indeterminate)
cash_delta_usd      numeric(14,4) NULL                    -- broker side (NULL if indeterminate)
signed_difference   numeric(14,4) NULL                    -- D9-13: signed, not abs
verdict             text NOT NULL CHECK (verdict IN ('passed','failed','indeterminate'))
reason              text NULL                              -- populated iff verdict != 'passed'
checked_at          timestamptz NOT NULL                    -- when this run happened
created_at          timestamptz server_default now()
```
No `UPDATE` grant (append-only, matching `sync_runs`/`broker_transactions`). `ENABLE`+`FORCE` RLS,
`FOR ALL user_isolation` policy, identical boilerplate to every prior migration (see "RLS and the
worker role" below for the exact SQL to copy). Index on `(user_id, window_start DESC)` for the
most-recent-first status read (D9-15).

**Money columns as `numeric(14,4)`, not encrypted.** Unlike `events`/`fills`/`broker_transactions`,
this project's convention for *derived operational metadata* (row counts on `sync_runs`,
`gaps_by_reason` on `snapshot_runs`) is plaintext — the same call `0012_sync_runs.py`'s own
docstring makes explicitly: "Nothing on this table is encrypted... operational metadata about a
cycle, not trading data." A reconciliation run's aggregate dollar figures are a stronger case for
staying plaintext than `sync_runs`' row counts, because the whole point of D9-13 is that a reader
can answer "how far off, and in which direction" from this row *without decrypting anything* —
encrypting these columns would defeat D9-15's "cheap enough to poll" requirement by forcing a DEK
unwrap on every status read. **This is a judgment call, not verified against an explicit prior
decision for this exact table** — flag it for the planner to confirm against `CRYPT-02`/`CRYPT-03`'s
plaintext-column-list discipline (`[ASSUMED]`, see Assumptions Log).

### Anti-Patterns to Avoid

- **A second `_current_dek`-shaped copy in `reconciliation.py`.** Four independent copies already
  existed before Phase 8 (`fills.py`, `events.py`, `connections.py`, `broker_transactions.py`);
  Phase 8 promoted the pattern into `morai.crypto.data_keys.current_dek`/`dek_for_version`
  specifically so a fifth call site would **not** be a fifth copy (`data_keys.py:1-20`
  [VERIFIED: src/morai/crypto/data_keys.py:1-20], `` "Four copies of this exact query pair already existed before this phase... This phase adds a **fifth call site** into this one module... not a fifth copy." ``).
  Reconciliation's shell must import `current_dek`/`dek_for_version` from `morai.crypto.data_keys`,
  never duplicate the query.
- **Wiring the reconciliation call to nothing (the CR-01 shape).** Phase 7 shipped
  `derive_settlements`/`sync_events(as_of=...)` fully built and unit-tested, but `sync_user` never
  passed `as_of` — SETTLEMENT derivation was dead code in production for a full phase, caught only
  in review (`07-REVIEW.md:68` [VERIFIED: .planning/phases/07-position-and-campaign-read-models/07-REVIEW.md:68],
  `` "### CR-01: `sync_user` never passes `as_of` to `sync_events` — SETTLEMENT derivation is dead code in production" ``).
  The plan for this phase MUST include a test that exercises the *real* `sync_user` job — deferring
  the Procrastinate task, draining a real worker run, and asserting a `reconciliation_runs` row
  actually lands — not only a unit test of `reconcile_window` in isolation. `tests/ingest/
  test_sync_tracer.py::test_sync_user_job_derives_settlement_for_an_expired_open_leg` is the exact
  precedent to extend or mirror.
- **Collapsing an unrecognised `transaction_type` into the allow-list "for now".** D9-09 exists
  precisely to prevent this — an unrecognised type must route to `indeterminate`, never silently
  join the cash-delta sum.
- **Summing money in SQL.** `broker_transactions`' amounts live only inside `raw_ciphertext`
  (D9-10); there is no plaintext column to `SUM()`. Decrypt every row in the window in Python,
  then sum `Decimal`s.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Trading-day boundaries in ET | A custom UTC-offset table or a `datetime.timedelta(hours=...)` fixed offset | `zoneinfo.ZoneInfo("America/New_York")`, already imported in `settlements.py` | DST transitions flip the offset twice a year; a fixed offset is wrong for roughly half the year (D9-04's own stated reason). |
| Knowing which trading days are open/closed for a market-calendar-shaped rule (holidays) | A hand-rolled NYSE holiday table | Nothing — this phase does not need one. See "The trading-day calendar" below. | The window-close rule (D9-02) is data-driven (a later transaction landing), not calendar-driven — a holiday with zero broker activity produces zero transactions, so no window ever needs to reason about whether that day was a holiday at all. |
| DEK unwrap for a new table's rows | A fifth copy of the `SELECT key_version, wrapped_dek, wrap_nonce ...` query | `morai.crypto.data_keys.current_dek`/`dek_for_version` | Already the promoted shared helper — see Anti-Patterns above. |
| Exact `Decimal` comparison | A tolerance/epsilon helper | Python's native `==` on two `Decimal` values | `Decimal` equality is exact by construction; no library or helper is warranted (D9-07). |

**Key insight:** every tool this phase needs — timezone-aware dates, exact decimal arithmetic, a
three-state enum, RLS boilerplate, a pure/shell split, a promoted DEK helper — already exists in
this codebase or the Python standard library. This phase is pure composition, not new
infrastructure.

## Runtime State Inventory

**Not applicable — this is not a rename/refactor/migration phase.** This phase adds new tables
and a new call site; it does not rename, rebrand, or migrate any existing string, key, or
identifier. Skipped per the trigger condition in the research protocol.

## Common Pitfalls

### Pitfall 1: The fee-free/fee-inclusive collision reappearing as a silent unit bug

**What goes wrong:** A future reader "fixes" the apparent mismatch between `events`' fee-free
P&L and the broker's fee-inclusive cash delta by making `open_debit_usd`/`close_credit_usd`
fee-inclusive, breaking the 13-calendar oracle silently (its expected values were computed
independently, fee-free, per `salvage/oracle-fixtures.md`).

**Why it happens:** The invariant *looks* like it should hold with a plain equality between two
"P&L" numbers, and the fee split is not visually obvious once both sides are just Decimals in a
diff.

**How to avoid:** `D9-05` is explicit and load-bearing: `events`' fee-free fields are never
touched by this phase. The comparison subtracts commissions on the derived side, never adds them
on nothing on the broker side. `reconcile_window`'s own docstring should restate this arithmetic
explicitly, the same way `_signed_leg_amount`'s docstring restates the sign convention it depends
on.

**Warning signs:** Any diff that touches `open_debit_usd`/`close_credit_usd`'s stored values, or
`derive_events`'s money arithmetic, inside this phase's plan is a signal something has gone wrong
— this phase should touch *zero* lines in `pairing.py`'s money-computing functions.

### Pitfall 2: The CR-01 shape — reconciliation built, tested, and never called

**What goes wrong:** `reconcile_window`/`run_reconciliation` land fully unit-tested, but
`sync_user` never actually calls the shell — criterion 2 ("runs automatically at the end of every
ingest cycle") silently fails in production while every test stays green.

**Why it happens:** The pure function and the shell are easy to test in isolation; the wiring
into `sync_user` is one line, easy to forget, and nothing fails loudly if it's missing — exactly
what happened with `sync_events(as_of=now)` in Phase 7 (`CR-01`, confirmed above).

**How to avoid:** the plan's own verification step must include a test that runs the real
Procrastinate `sync_user` task end-to-end (mirroring `test_sync_user_job_derives_settlement_for_
an_expired_open_leg`) and asserts a `reconciliation_runs` row is actually written — not merely
that `reconcile_window` returns the right verdict when called directly.

**Warning signs:** A plan whose only reconciliation test imports `reconcile_window` or
`run_reconciliation` directly, with no test that goes through `sync_user`/the worker task.

### Pitfall 3: Treating the schwab-py `TransactionType` enum as a confirmed response schema

**What goes wrong:** Assuming `schwab.client.base.BaseClient.Transactions.TransactionType`'s 15
members (verified present in the installed package this session — see below) are guaranteed to be
the exact set of `type` values a live `get_transactions` response actually returns, or that a
`netAmount`/commission field exists with that exact name.

**Why it happens:** `schwab-py`'s enum looks authoritative because it is real, installed,
versioned code — but it is a **request-filter** enum (used to build the `type=` query parameter
for `get_transactions`), not a documented, verified response schema. `schwab-py` itself returns
raw, unmodeled `httpx.Response` objects for this endpoint — confirmed by grep of its installed
source: zero occurrences of `netAmount`, `fees`, or `commission` anywhere in
`schwab/client/base.py`.

**How to avoid:** treat the transaction-type vocabulary as `[VERIFIED: .venv/lib/python3.13/
site-packages/schwab/client/base.py:343-359]` for *which strings the vendor's own client library
names as valid filter values* — that much is real, installed code, read this session — but treat
"this is the complete and only set a real account will ever send" and "the cash amount field is
named `netAmount`" as `[ASSUMED]`, owed to the first live payload, exactly like `schwab_sync.py`'s
own module docstring already states for the sign convention.

**Warning signs:** A plan or test fixture that hardcodes a field named `netAmount` without a
comment marking it unverified, or that treats the 15-member enum as necessarily complete.

## Code Examples

### The verified `TransactionType` enum (schwab-py's own installed source)

```python
# Source: .venv/lib/python3.13/site-packages/schwab/client/base.py:343-359
# [VERIFIED: read this session] — this is schwab-py's real, installed client
# library. It is the request-filter enum for get_transactions(type=...), NOT
# a confirmed response schema (see Pitfall 3 above).
class Transactions:
    class TransactionType(Enum):
        TRADE = 'TRADE'
        RECEIVE_AND_DELIVER = 'RECEIVE_AND_DELIVER'
        DIVIDEND_OR_INTEREST = 'DIVIDEND_OR_INTEREST'
        ACH_RECEIPT = 'ACH_RECEIPT'
        ACH_DISBURSEMENT = 'ACH_DISBURSEMENT'
        CASH_RECEIPT = 'CASH_RECEIPT'
        CASH_DISBURSEMENT = 'CASH_DISBURSEMENT'
        ELECTRONIC_FUND = 'ELECTRONIC_FUND'
        WIRE_OUT = 'WIRE_OUT'
        WIRE_IN = 'WIRE_IN'
        JOURNAL = 'JOURNAL'
        MEMORANDUM = 'MEMORANDUM'
        MARGIN_CALL = 'MARGIN_CALL'
        MONEY_MARKET = 'MONEY_MARKET'
        SMA_ADJUSTMENT = 'SMA_ADJUSTMENT'
```

**Recommended allow-list (D9-09), reasoned from this enum — `[ASSUMED]`, owed to the first live
payload:**

| `transaction_type` | Allow-list membership | Reasoning |
|---|---|---|
| `TRADE` | **IN** | Already the type `extract_fills` treats as the only fill-producing element; it is the source of both the cash amount and the commission for an options trade. |
| `RECEIVE_AND_DELIVER` | **IN** (recommended, unverified) | Most likely candidate for the cash effect of an option assignment/exercise/expiration — this project's own `extract_fills` already treats it as a distinct, real transaction type it deliberately does *not* extract fills from (`test_only_the_trade_element_yields_fills_from_a_mixed_response`, `tests/ingest/test_extract_fills.py:175-192` [VERIFIED: tests/ingest/test_extract_fills.py:175-192]). If cash-settled SPX/SPXW settlement cash lands under this type, excluding it would make every window containing an expiry silently `indeterminate` forever via D9-08's unrecognised-type rule — which is the honest fallback, but confirming this on the first live payload is a real, named open question (see Open Questions below). |
| `ACH_RECEIPT`, `ACH_DISBURSEMENT`, `CASH_RECEIPT`, `CASH_DISBURSEMENT`, `ELECTRONIC_FUND`, `WIRE_OUT`, `WIRE_IN`, `JOURNAL` | **OUT** (transfers) | These are exactly the "net of transfers" carve-out RECON-01 names — deposits, withdrawals, internal transfers. |
| `DIVIDEND_OR_INTEREST`, `MARGIN_CALL`, `MONEY_MARKET`, `SMA_ADJUSTMENT`, `MEMORANDUM` | **OUT** (recommended) | Not options-trading cash flows for this account's structure (SPX/SPXW index options carry no dividends); if any of these ever appears for a real account, D9-08 routes the window to `indeterminate` rather than silently including or excluding it. |

### The `Decimal`-exact round trip through encryption (proves D9-07 is achievable)

```python
# Source: src/morai/ledger/fills.py:113-120 (read this session)
def _encode_decimal(value: Decimal) -> bytes:
    """Never via `float` -- the exact failure class this project exists to
    prevent (D3-17)."""
    return str(value).encode("utf-8")


def _decode_decimal(value: bytes) -> Decimal:
    return Decimal(value.decode("utf-8"))
```
`str(Decimal(...))` is lossless and `Decimal(str(...))` round-trips it exactly — this is already
proven by `tests/test_decimal_canary.py` and `tests/test_money_roundtrip.py` (both read/confirmed
present this session), so `open_debit_usd`/`close_credit_usd` decrypted from `events` and any
commission decrypted from `broker_transactions` compare exactly equal after their encrypted
round trip. No new canary test is strictly required for this phase — cite the existing ones —
though the plan may add one scoped to `reconciliation_runs`' own persisted `numeric(14,4)` columns
if it decides those need their own round-trip proof.

### The RLS + grant boilerplate to copy for migration 0016

```sql
-- Source: alembic/versions/0012_sync_runs.py:129-143 (read this session, structure only,
-- table name substituted)
GRANT SELECT, INSERT, DELETE ON reconciliation_runs TO morai_app;  -- no UPDATE, append-only

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON reconciliation_runs
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
```

### The RLS-bypass guard already in place for the worker (no new code needed)

```python
# Source: src/morai/worker/app.py:206-207 (read this session) — sync_user_task already
# calls this before touching any protected table. run_reconciliation, called from inside
# sync_user (not sync_user_task), inherits this guarantee for free since it runs on the
# same already-guarded session.
async with session_maker() as session:
    await assert_connection_cannot_bypass_rls(session)
    ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `commission_usd` typed `Decimal \| None`, always `None` (Phase 5) | `commission_usd` populated from `broker_transactions` at reconciliation time (this phase) | Phase 9 | The typed gap `D5-04` deliberately left is finally read; `events`' own fee-free fields are untouched. |
| No reconciliation invariant anywhere in the system | `reconcile_window` + `reconciliation_runs`, run every ingest cycle | Phase 9 | The project's stated core value ("the ledger is correct across rolls and settlements") becomes a checked, queryable fact rather than an aspiration. |

**Deprecated/outdated:** nothing in this phase deprecates prior code. It is additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The live Schwab `get_transactions` response names the trading-cash amount field `netAmount` and carries a separate, identifiable commission/fee field | Summary; "Code Examples" allow-list table | If the field is named differently, or commission is embedded inside `amount`/`cost` rather than broken out, `run_reconciliation`'s read function silently reads the wrong field or raises — the plan should treat these field names as named constants verified against the first live payload, exactly like `sync_windows`' own range settings, and every window is `indeterminate` (never wrongly `passed`) until that's confirmed, per D9-08. |
| A2 | `RECEIVE_AND_DELIVER` is the transaction type carrying a cash-settled index option's settlement cash effect, and belongs in the D9-09 allow-list | "Code Examples" allow-list table | If wrong, either a real cash movement gets silently excluded (making an otherwise-correct window `indeterminate` forever, the honest failure) or, worse, an unrelated cash movement gets wrongly included. The honest-failure direction (excluded → indeterminate) is the default outcome of getting this wrong under D9-08's own design, which bounds the risk. |
| A3 | `reconciliation_runs`' aggregate dollar columns (`realised_pnl_usd`, `commissions_usd`, `cash_delta_usd`, `signed_difference`) should be plaintext `numeric(14,4)`, not encrypted, following `sync_runs`'/`snapshot_runs`' precedent for operational metadata | "Pattern 4" | If this project's threat model actually wants these encrypted (a stronger reading of `CRYPT-02`'s "prices, quantities, P&L... encrypted" than this research assumes), D9-15's "cheap enough to poll" requirement forces a DEK unwrap on every status read, which is still achievable but changes the migration's column shapes and the status route's cost profile. Flagged explicitly for the planner/discuss-phase to confirm against `CRYPT-02`/`CRYPT-03`. |
| A4 | Deriving `commission_usd` at reconciliation read-time (never persisting it onto `events`) satisfies D9-05's "populate commission_usd" instruction | "Standard Stack — Alternatives Considered"; Summary | If the phase's real intent is a durably persisted, per-event commission value (e.g., for a later phase's UI to show fee-inclusive figures), read-time-only computation would need revisiting in that later phase. Nothing in this phase's own criteria (RECON-01..04, API-01) requires per-event commission display, so this research recommends the lower-risk reading — but it is Claude's Discretion in `09-CONTEXT.md`, not a locked decision, so flagging it here rather than silently picking. |

## Open Questions

1. **The live Schwab transaction cash-amount and commission field names.**
   - What we know: `TransactionType` has 15 members (verified from installed `schwab-py` source);
     `transferItems[].amount`/`.cost`/`.price` are the three money fields this project's own
     `_TransferItem` model already parses (verified from `schwab_sync.py`), and none of the three
     is the transaction-level net cash amount or a commission — those would live at a level this
     project's models don't currently parse at all.
   - What's unclear: whether the real payload carries a top-level `netAmount` on the transaction
     element itself (not per-`transferItem`), where a commission/fee breakout lives (a
     `transferItems[]` entry of its own, e.g. `feeType: "COMMISSION"`, or a separate top-level
     field), and whether that shape differs between a `TRADE` element and a `RECEIVE_AND_DELIVER`
     element.
   - Recommendation: treat both as named, injectable constants (field-path strings), same
     discipline `schwab_tx_max_range_days` already gets, verified and possibly corrected against
     the first live `sync_user` run — logged at info level the same way `sync_windows`' own
     window bounds already are, so the first live run is the instrument that settles this, not a
     guess made now.

2. **Does the SETTLEMENT event's cash effect ever appear as its own `broker_transactions` row at
   all, for a cash-settled index option?**
   - What we know: `D7-07` already establishes that a SETTLEMENT event carries no money fields
     until Phase 8's market data is applied (deferred, out of scope here per `09-CONTEXT.md`).
     `D9-11` already answers "what happens to an unpriced SETTLEMENT's window" (indeterminate).
   - What's unclear: whether a cash-settled index option assignment/exercise even generates a
     distinct broker transaction row, or whether the position simply expires worthless with zero
     transaction (no row at all, meaning the window's broker-side sum is correctly zero for that
     leg with no special-casing needed).
   - Recommendation: this is subsumed by D9-11's own answer — an affected window is
     `indeterminate` regardless of which sub-case is true, so this phase does not need to resolve
     it to be correct, only to be tested against both sub-cases as separate fixture scenarios.

## Environment Availability

**Skipped — no new external dependency.** This phase adds no new tool, service, or vendor
integration; it reuses the same Postgres connection, `zoneinfo`/`tzdata`, and Schwab connection
every prior phase already established as available. Local Postgres 18 confirmed running and the
existing test suite confirmed passing this session (`uv run pytest -q`, exit code 0, all
collected tests green — the project's own STATE.md records the last full count as 587 passed,
gate exit 0, from Phase 8's own verification; this session's own run reproduced a clean, all-dot,
exit-0 result without capturing the final numeric summary line due to a local terminal/output-
capture quirk unrelated to test content).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 (already pinned), `pytest-asyncio` 1.4.0, session-scoped event loop (`pyproject.toml:87-97` [VERIFIED: pyproject.toml:87-97]) |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `uv run pytest -m "not db" -q` (pure-function tests only, no Postgres) |
| Full suite command | `uv run pytest -q` (requires local Postgres per `CLAUDE.md`'s documented env vars) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECON-01 | Realised P&L sum equals broker cash delta, net of transfers, over a window | unit (pure) | `pytest tests/ledger/test_reconciliation.py -k "matches" -x` | ❌ Wave 0 |
| RECON-01 | A deliberately seeded one-cent discrepancy FAILS | unit (pure) | `pytest tests/ledger/test_reconciliation.py -k "seeded_discrepancy" -x` | ❌ Wave 0 |
| RECON-02 | Check runs automatically at the end of every real ingest cycle (not just callable) | integration (db, real worker task) | `pytest tests/ingest/test_sync_tracer.py -k "reconciliation" -x --run-db` (or project's `db` marker) | ❌ Wave 0 — extend `test_sync_tracer.py` |
| RECON-03 | A failure names the failing window | unit (pure) | `pytest tests/ledger/test_reconciliation.py -k "failure_names_window" -x` | ❌ Wave 0 |
| RECON-04 | Response envelope marks dependent numbers untrustworthy while failing | integration (db, API route) | `pytest tests/api/test_reconciliation_status.py -x` | ❌ Wave 0 |
| API-01 | Status endpoint is one indexed row read, never recomputes | unit/integration | `pytest tests/api/test_reconciliation_status.py -k "no_recompute" -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `uv run pytest -m "not db" -q` (pure `reconcile_window` logic, seconds)
- **Per wave merge:** `bash tools/gate.sh` (full suite + ruff + basedpyright + mypy, ~12-15s
  locally per `CLAUDE.md`)
- **Phase gate:** Full suite green before `/gsd-verify-work`, including the extended
  `test_sync_tracer.py` case proving `sync_user` actually calls reconciliation (Pitfall 2).

### Wave 0 Gaps

- [ ] `tests/ledger/test_reconciliation.py` — covers RECON-01, RECON-03; pure-function tests, no
      DB, following `tests/ledger/test_oracle_gate.py`'s own marker-mixing convention (one
      `db`-marked fixture-seeding case, the rest pure).
- [ ] `tests/ingest/test_sync_tracer.py` extension — covers RECON-02, proving the real
      Procrastinate `sync_user` task writes a `reconciliation_runs` row (the CR-01 guard).
- [ ] `tests/api/test_reconciliation_status.py` — covers RECON-03, RECON-04, API-01.
- [ ] No new framework install needed — pytest/pytest-asyncio already fully configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (route reuses existing `get_current_user`) | `identity/sessions.py::get_current_user`, unchanged |
| V3 Session Management | No (no new session mechanism) | — |
| V4 Access Control | Yes | RLS `user_isolation` policy on `reconciliation_runs`, `ENABLE`+`FORCE`, identical boilerplate to every prior table; `assert_connection_cannot_bypass_rls` already guards the worker session this phase's write runs on |
| V5 Input Validation | Yes | `ApiModel` (`strict=True`, `extra="forbid"`, `frozen=True`) for the status response; no new request body this phase introduces (status route is a `GET`) |
| V6 Cryptography | Conditionally (see Assumption A3) | If `reconciliation_runs`' money columns stay plaintext (recommended), no new crypto surface. If encrypted, reuse `envelope.encrypt_field`/`decrypt_field` and `current_dek`/`dek_for_version` — never hand-roll. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read of another user's reconciliation status | Information Disclosure | RLS `user_isolation` `FOR ALL` policy (same pattern every prior table uses); `assert_connection_cannot_bypass_rls` on the worker's write path |
| A reconciliation check silently reported as `passed` on missing/unparseable data | Repudiation (false assurance) | D9-08's `indeterminate` state is itself the mitigation — already a locked decision, not something this phase needs to invent |
| Reconciliation "wired to nothing" (CR-01 shape) giving false confidence the invariant is checked | Repudiation | The real-worker-task test (Pitfall 2) is the mitigation; must be in the plan's own verification steps |
| Status endpoint becoming an expensive decrypt-everything call an attacker can use to exhaust resources | Denial of Service | D9-15 already locks this: read the latest persisted row, never recompute |

## Sources

### Primary (HIGH confidence — read directly, this session)

- `src/morai/ingest/broker_transactions.py` — full file, the write path, chunk sizing, sentinel
  gate
- `src/morai/ingest/schwab_sync.py` — full file, `sync_windows`, `sync_user`, the vendor-boundary
  models, `_direction`
- `src/morai/ledger/settlements.py` — full file, the pure/shell split, `zoneinfo` usage
- `src/morai/ledger/pairing.py` — `DerivedEvent`, `_signed_leg_amount`, `sync_events` (partial),
  `commission_usd`'s two call sites
- `src/morai/ledger/events.py` — full file, `_encode_decimal`/`_decode_decimal` import,
  `insert_events`/`read_events`
- `src/morai/ledger/fills.py:113-120` — `_encode_decimal`/`_decode_decimal` definitions
- `src/morai/ingest/sync_runs.py` — full file, table shape, `StrEnum` conventions
- `src/morai/ingest/snapshot_runs.py` — full file, three-`StrEnum` and no-zero-entry conventions
- `src/morai/worker/app.py` — full file, `sync_user_task`, two-session failure-recording split,
  `assert_connection_cannot_bypass_rls` call sites
- `src/morai/api/routes_identity.py` — full file, route-by-return-type-annotation convention
  (D-11), `ApiModel` usage patterns
- `src/morai/api/models.py` — full file, `ApiModel` base
- `src/morai/crypto/data_keys.py` — full file, the promoted `current_dek`/`dek_for_version`
  helper and its own "fourth copy" rule
- `alembic/versions/0011_broker_transactions.py` — full file, plaintext-column reasoning,
  grant/RLS boilerplate
- `alembic/versions/0012_sync_runs.py` — full file, `sync_runs` table shape, `CHECK` constraints
- `alembic/versions/0015_snapshot_capture.py` — full file, gap-xor-payload `CHECK` pattern,
  no-unique-constraint reasoning for repair runs
- `src/morai/identity/rls.py:30-80` — `assert_connection_cannot_bypass_rls`,
  `require_rls_context`
- `src/morai/vendor/connections.py:121-124` — `ConnectionHealth`, the three-state `StrEnum`
  precedent
- `tests/ingest/test_extract_fills.py` — full file, confirms fixtures never populate a
  `netAmount`-shaped field
- `tests/ingest/conftest.py` — full file, `TX_PAYLOAD` fixture shape (confirms no commission/fee
  field anywhere in this project's own test fixtures)
- `tests/ledger/test_oracle_gate.py:1-50` — the 13-calendar oracle's own framing, confirms
  `tests/ledger/oracle_seed.py`/`salvage/oracle-fixtures.md` as the fixtures this phase must never
  touch
- `pyproject.toml:20,87-97` — `tzdata==2026.3` pin, pytest config
- `.venv/lib/python3.13/site-packages/schwab/client/base.py:343-359` — `TransactionType` enum,
  read directly from the installed package this session; grepped the same file for
  `netAmount`/`fees`/`commission`/`clearing`, zero matches
- `.planning/phases/07-position-and-campaign-read-models/07-REVIEW.md:68` — the CR-01 finding,
  verbatim
- `.planning/phases/09-reconciliation-invariant-and-status-endpoint/09-CONTEXT.md` — full file,
  the 15 locked decisions
- `.planning/REQUIREMENTS.md` — full file, RECON-01..04, API-01 wording and traceability table
- `.planning/STATE.md` — full file, phase status, test-count baseline, deferred-verification
  ledger
- `.planning/config.json` — `workflow.nyquist_validation: true`, `security_enforcement: true`,
  `security_asvs_level: 1` confirmed by direct read
- `docs/learnings/LAWS.md:493-499` (L048), `docs/learnings/LAWS.md:257-263` (L022),
  `docs/learnings/LAWS.md:263-267` (L023), `docs/learnings/app-postmortem.md:260-270` — grepped
  and read for reconciliation-adjacent precedent

### Secondary (MEDIUM confidence)

- `WebSearch`: "Charles Schwab trader API get transactions transactionType netAmount fees
  schema" — returned no authoritative schema (developer.schwab.com requires auth this session
  could not complete); used only to confirm no public secondary source settles field names either,
  reinforcing the LOW-confidence tag on Assumption A1 rather than resolving it.

### Tertiary (LOW confidence)

- None presented as fact in this document without a `[ASSUMED]` tag — every unverified claim is
  in the Assumptions Log above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already installed and pinned; nothing new to verify.
- Architecture (pure/shell split, RLS boilerplate, run-ledger shape, worker wiring): HIGH — every
  pattern cited was read directly from this codebase this session, not recalled from training
  data.
- The Schwab transaction cash-amount/commission field names and the D9-09 allow-list's exact
  membership: LOW — genuinely unverified by any source available this session (repo, installed
  package, or public web); explicitly flagged as owed to the first live payload, matching this
  project's own established convention for exactly this class of gap.

**Research date:** 2026-09-01
**Valid until:** 30 days (stable, in-repo patterns) for the architecture sections; the Schwab
field-name assumption should be re-verified the moment a real `get_transactions` payload is first
observed, whichever comes first.
