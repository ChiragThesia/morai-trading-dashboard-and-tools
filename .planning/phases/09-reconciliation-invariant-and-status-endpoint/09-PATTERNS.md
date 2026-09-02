# Phase 9: Reconciliation Invariant and Status Endpoint - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 8 (2 new modules, 1 migration, 1 route file, 2 test files, 2 modified files)
**Analogs found:** 8 / 8 — this phase is pure composition, every analog is a direct, exact-shape
match already read in full this session (per RESEARCH.md's own headline).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/morai/ledger/reconciliation.py` (pure `reconcile_window`) | service (pure derivation) | transform | `src/morai/ledger/settlements.py::derive_settlements` | exact |
| `src/morai/ledger/reconciliation.py` (shell `run_reconciliation`) | service (async shell) | CRUD (read+write) | `src/morai/ledger/settlements.py::read_legs` + `src/morai/ingest/schwab_sync.py::sync_user` | exact |
| `src/morai/ingest/reconciliation_runs.py` | model/service (run-ledger) | CRUD | `src/morai/ingest/snapshot_runs.py` (3-state, error classify) + `src/morai/ingest/sync_runs.py` (append-only, table shape) | exact |
| `alembic/versions/0016_reconciliation_runs.py` | migration | batch (DDL) | `alembic/versions/0015_snapshot_capture.py` | exact |
| `src/morai/api/routes_reconciliation.py` | route | request-response | `src/morai/api/routes_identity.py` (`/me`, `PositionResponse`) | exact |
| `src/morai/api/models.py` (extend/mixin for `trustworthy`) | config/model | request-response | `src/morai/api/models.py::ApiModel` itself | exact |
| `tests/ledger/test_reconciliation.py` | test | transform | `tests/ledger/test_settlements.py` (implied sibling; same pure-fn testing shape as `derive_settlements`) | exact |
| `tests/api/test_reconciliation_status.py` | test | request-response | existing `tests/api/` route tests (implied; same `ApiModel` + `get_current_user` shape as `routes_identity.py` tests) | role-match |
| `src/morai/ingest/schwab_sync.py::sync_user` (MODIFIED) | service (shell, one new call) | event-driven | itself — the seam is `sync_events(as_of=now)`'s own CR-01 precedent | exact |
| `tests/ingest/test_sync_tracer.py` (EXTENDED) | test | event-driven | `test_sync_user_job_derives_settlement_for_an_expired_open_leg` (same file, same shape) | exact |

## Pattern Assignments

### `src/morai/ledger/reconciliation.py` — pure `reconcile_window`

**Analog:** `src/morai/ledger/settlements.py::derive_settlements` (lines 99–160)

**Imports pattern** (settlements.py:24–37, adapt for reconciliation):
```python
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from enum import StrEnum
from uuid import UUID
from zoneinfo import ZoneInfo

from morai.ledger.events import EventRecord
# broker_transactions read model — new, reconciliation-local (D9-10)
```

**Signature/purity discipline to copy verbatim** (settlements.py:99–113):
```python
def derive_settlements(
    legs: Sequence[LegRecord],
    events: Sequence[EventRecord],
    *,
    as_of: datetime,
    closed_positions: Mapping[UUID, bool | None],
) -> tuple[DerivedSettlement, ...]:
    """Pure: no `AsyncSession` parameter, no clock read inside -- `as_of`
    is the caller's only time input (D7-06)...."""
```
`reconcile_window` must mirror this exactly: `events: Sequence[EventRecord]`,
`broker_transactions: Sequence[BrokerTransactionRecord]` (new local dataclass, see below),
`*, window_start: datetime, window_end: datetime` — never `AsyncSession`, never
`datetime.now()`. Per D9-12, this is the one function both the pytest suite and the ingest
cycle call — no second copy anywhere.

**Timezone pattern to copy verbatim** (settlements.py:50–54, D9-01/D9-04):
```python
# ET, never a fixed UTC offset -- Eastern is UTC-4 or UTC-5 depending on
# the date, so a constant offset is wrong roughly half the year (D7-08).
_EASTERN = ZoneInfo("America/New_York")
AM_SETTLEMENT_TIME = time(9, 30)
PM_SETTLEMENT_TIME = time(16, 0)
```
Reconciliation's own module-level constant: `_EASTERN = ZoneInfo("America/New_York")`,
reused for `transaction_time.astimezone(_EASTERN).date()` to derive trading-day boundaries
(D9-02, D9-03) — same import, same non-hardcoded-offset discipline, no new dependency.

**Three-state verdict `StrEnum`** (`src/morai/vendor/connections.py:121-124`, verbatim precedent):
```python
class ConnectionHealth(StrEnum):
    HEALTHY = "healthy"
    EXPIRING_SOON = "expiring_soon"
    EXPIRED = "expired"
```
Copy this shape exactly for:
```python
class ReconciliationVerdict(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    INDETERMINATE = "indeterminate"
```
D9-08 is explicit: never collapse `INDETERMINATE` into either terminal state.

**Exact-Decimal comparison, no epsilon (D9-07)** — no analog code needed; Python's native
`==` on two `Decimal` values, per RESEARCH.md's own "Don't Hand-Roll" table. The arithmetic
to restate in the docstring, matching `_signed_leg_amount`'s own convention of documenting
the sign convention it depends on (D9-05):
```python
# Σ(fee-free realised P&L, events in window)
#   − Σ(commissions, broker_transactions in window)
#   == Σ(allow-listed cash amounts, broker_transactions in window)
```

**The decrypt-then-sum-in-Python pattern for money (D9-10)** — analog: `src/morai/ledger/
events.py::read_events` (lines 216–291) and `src/morai/ledger/fills.py:113-120`
`_encode_decimal`/`_decode_decimal`. Reconciliation's shell must decrypt every
`broker_transactions` row in the window and sum `Decimal`s in Python — no SQL `SUM()`.
Reuse `_decode_decimal`/`_encode_decimal` by importing from `fills.py` exactly the way
`events.py` does (never re-implement — see events.py:1–32 docstring on why a second
serialization is a drift risk):
```python
from morai.ledger.fills import (
    _decode_decimal,  # pyright: ignore[reportPrivateUsage]  # why: same Decimal-as-UTF-8-text encoding fills.py already established (D3-17).
    _encode_decimal,  # pyright: ignore[reportPrivateUsage]  # why: see _decode_decimal above.
)
```

**DEK unwrap — the promoted helper (D9-06/D9-10), NOT a sixth copy:**
```python
# Source: src/morai/crypto/data_keys.py:65-119 (read this session)
from morai.crypto.data_keys import current_dek, dek_for_version
```
`data_keys.py`'s own docstring: "Four copies of this exact query pair already existed
before this phase... This phase adds a **fifth call site**... not a fifth copy." Phase 9's
`reconciliation.py` is the *sixth* call site and must import `current_dek`/`dek_for_version`
from `morai.crypto.data_keys` — never duplicate the `SELECT key_version, wrapped_dek,
wrap_nonce FROM user_data_keys` query a fifth time.

---

### `src/morai/ingest/reconciliation_runs.py`

**Analog A (three-state error classification, D9-08 shape):** `src/morai/ingest/
snapshot_runs.py` full file (esp. lines 73–134).

Copy `classify_snapshot_error`'s two-layer type-then-cause branching shape verbatim,
adapted to reconciliation's own error surface (missing commission, unrecognised
`transaction_type`, unpriced SETTLEMENT → all map to `INDETERMINATE`, never a generic
classification):
```python
# Source: src/morai/ingest/snapshot_runs.py:87-134 (read this session)
def _classify_by_type_and_status(exc: BaseException) -> SnapshotError | None:
    ...  # branches on type(exc), then on exc.response.status_code for HTTPStatusError
    return None  # not UNKNOWN -- lets the caller try exc.__cause__ next

def classify_snapshot_error(exc: BaseException) -> SnapshotError:
    direct = _classify_by_type_and_status(exc)
    if direct is not None:
        return direct
    if exc.__cause__ is not None:
        chained = _classify_by_type_and_status(exc.__cause__)
        if chained is not None:
            return chained
    return SnapshotError.UNKNOWN
```
Reconciliation's own `indeterminate` *reason* vocabulary (Claude's Discretion, D9-08) is
not exception-driven the way `SnapshotError` is — it is driven by data gaps (missing
commission row, unrecognised `transaction_type`, unpriced SETTLEMENT). Model it the same
way `gaps_by_reason` does on `snapshot_runs` (see migration 0015's docstring, "gap_reason
carries all four values from the start") — a fixed, enumerated `StrEnum` of reasons, never
free text derived from an exception message (`NN-20`, `NN-34`).

**Analog B (append-only run-ledger shape, no `UPDATE` grant):** `src/morai/ingest/
sync_runs.py` full file — `record_sync_run`/`read_sync_runs`.

Copy the "does not commit — caller owns the transaction" convention and the
frozen-dataclass read-record shape verbatim:
```python
# Source: src/morai/ingest/sync_runs.py:99-159 (read this session)
async def record_sync_run(
    session: AsyncSession, user_id: UUID, *, ..., error_code: SyncError | None,
) -> None:
    """Writes exactly one ... row. Does not commit -- the caller owns the transaction."""
    await session.execute(insert(SyncRun).values(...))

async def read_sync_runs(session: AsyncSession, user_id: UUID, *, limit: int) -> list[SyncRunRecord]:
    rows = (await session.execute(
        select(SyncRun).where(SyncRun.user_id == user_id)
        .order_by(SyncRun.started_at.desc()).limit(limit)
    )).scalars()
    ...
```
For `reconciliation_runs`, order by `window_start.desc()` (RESEARCH.md's own recommended
index, `(user_id, window_start DESC)`) for the most-recent-first status read (D9-15).

**D9-03's "reopening is itself a finding" → a new row, never an `UPDATE`.** Follow
`snapshot_runs`' own reasoning quoted verbatim in `0015_snapshot_capture.py:77-78`:
"No unique constraint on `(user_id, slot_time)`: a repair run legitimately produces a
second row for a slot already captured." `reconciliation_runs` needs no unique constraint
on `(user_id, window_start)` for the identical reason — a reopened window's re-check is a
new row.

---

### `alembic/versions/0016_reconciliation_runs.py`

**Analog:** `alembic/versions/0015_snapshot_capture.py` full file (most recent migration;
copy its RLS+GRANT boilerplate verbatim, table-name substituted).

**RLS + GRANT boilerplate to copy verbatim** (already excerpted in RESEARCH.md, confirmed
against 0015's own tail, lines ~236–260):
```sql
-- append-only, no UPDATE (matches sync_runs, not snapshot_observations/marks)
GRANT SELECT, INSERT, DELETE ON reconciliation_runs TO morai_app;

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON reconciliation_runs
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);
```

**`CheckConstraint` pattern for a fixed enum column** (0015_snapshot_capture.py:105–119,
136–152, the `trigger`/`status`/`gap_reason` `CHECK`s):
```python
sa.CheckConstraint(
    "trigger IN ('scheduled', 'manual')",
    name="snapshot_runs_trigger_check",
),
sa.CheckConstraint(
    "status IN ('succeeded', 'failed')",
    name="snapshot_runs_status_check",
),
```
Adapt for `reconciliation_runs.verdict`:
```python
sa.CheckConstraint(
    "verdict IN ('passed', 'failed', 'indeterminate')",
    name="reconciliation_runs_verdict_check",
),
```

**Table skeleton to copy the shape of** (0015_snapshot_capture.py:135–163, `snapshot_runs`
itself is the nearer analog than the encrypted tables — plaintext money columns per
RESEARCH.md's Pattern 4 / Assumption A3):
```python
op.create_table(
    "snapshot_runs",
    sa.Column("id", _UUID, primary_key=True, server_default=_GEN_UUID),
    sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
    sa.Column("slot_time", sa.DateTime(timezone=True), nullable=False),
    ...
    sa.Column("error_code", sa.Text(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.CheckConstraint(...),
)
op.create_index(
    "ix_snapshot_runs_user_id_slot_time", "snapshot_runs",
    ["user_id", sa.text("slot_time DESC")],
)
```
For `reconciliation_runs`: `window_start`/`window_end` (`timestamptz NOT NULL`),
`realised_pnl_usd`/`commissions_usd`/`cash_delta_usd`/`signed_difference`
(`numeric(14,4)`, nullable per D9-08's indeterminate case), `verdict` (`text NOT NULL` +
CHECK), `reason` (`text NULL`), `checked_at` (`timestamptz NOT NULL`), index on
`(user_id, window_start DESC)`.

**Down-revision chain:** `down_revision = "0015"` — 0001 through 0015 are applied and
never edited in place (0015's own docstring, carried convention).

---

### `src/morai/api/routes_reconciliation.py`

**Analog:** `src/morai/api/routes_identity.py` — the `/me` route (lines 441–459) is the
nearest shape: authenticated, reads exactly this user's own row, no path parameter that
could name another user.

**Route + response-model discipline to copy verbatim:**
```python
# Source: src/morai/api/routes_identity.py:1-7, 441-459 (read this session)
"""Every route declares its contract by return type annotation, never
`response_model=` (D-11), matching `api/app.py`'s existing routes."""

class MeResponse(ApiModel):
    user_id: UUID
    username: str
    is_admin: bool

@router.get("/me")
async def me(
    user: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> MeResponse:
    """Reads the caller's own row..."""
    row = (await session.execute(select(User).where(User.id == user.user_id))).scalar_one()
    return MeResponse(user_id=row.id, username=row.username, is_admin=row.is_admin)
```
For `GET /reconciliation/status`: same `Depends(get_current_user)` + `Depends
(get_db_session)` signature, return a new `ReconciliationStatusResponse(ApiModel)`. D9-15
means the body is a single indexed read via `reconciliation_runs`' own read function
(mirroring `read_sync_runs`/`read_snapshot_runs`, `limit=1`, most-recent-first) — never a
call into `reconcile_window`/`run_reconciliation`. If no row exists yet for this user,
follow the `PositionResponse`/`get_position` 404 convention (routes_identity.py:113–131)
or return an explicit "never run" state — Claude's Discretion, not locked.

---

### `src/morai/api/models.py` — the `trustworthy` typed field (D9-14)

**Analog:** `ApiModel` itself (models.py:14–15) — the base every response already derives
from.
```python
# Source: src/morai/api/models.py:1-16 (full file, read this session)
class ApiModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)
```
D9-14 requires `trustworthy: bool` (or a small typed verdict) to live *inside* every
response envelope carrying dependent numbers, not behind a separate opt-in call. The
cheapest, most consistent shape given `ApiModel`'s existing `frozen=True`/`strict=True`/
`extra="forbid"` discipline is a small mixin class other response models compose in,
following the same "every model derives from `ApiModel`" convention this file's own
docstring states — populated from the same latest-`reconciliation_runs`-row lookup the
status route itself uses (D9-15: read, never recompute).

---

### `tests/ledger/test_reconciliation.py`

**Analog:** the pure-function testing shape already established for `derive_settlements`
(implied sibling `tests/ledger/test_settlements.py`, same package) — construct
`LegRecord`/`EventRecord`-equivalent fixtures by hand, call the pure function directly, no
`AsyncSession`, no Postgres marker needed for the pure-path tests. RESEARCH.md's own test
map confirms: `pytest tests/ledger/test_reconciliation.py -k "matches" -x` and
`-k "seeded_discrepancy" -x` as the two target cases (RECON-01, D9-07's anti-vacuous-pass
control). Never touch `tests/ledger/oracle_seed.py` or `salvage/oracle-fixtures.md` — this
phase's own Pitfall 1 names exactly this boundary.

### `tests/ingest/test_sync_tracer.py` (EXTENDED)

**Analog:** the same file's own `test_sync_user_job_derives_settlement_for_an_expired_open_
leg` (lines 217–259) — the exact CR-01 guard precedent this phase must repeat, not merely
cite:
```python
# Source: tests/ingest/test_sync_tracer.py:217-259 (read this session)
async def test_sync_user_job_derives_settlement_for_an_expired_open_leg(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("sync_user").defer_async(user_id=str(user_id))
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    settlement_rows = (await app_db_session.execute(
        select(Event).where(Event.user_id == user_id, Event.event_type == "SETTLEMENT")
    )).scalars().all()
    assert len(settlement_rows) == 2
```
Mirror this exactly for reconciliation: defer the real `sync_user` task by name onto
`worker.app.app`, drain with `run_worker_async(wait=False)` under `asyncio.wait_for(...,
timeout=30)`, then assert a `reconciliation_runs` row actually landed. This is the
mandatory CR-01 guard RESEARCH.md's own Anti-Patterns and Pitfall 2 sections require — a
plan whose only reconciliation test imports `reconcile_window`/`run_reconciliation`
directly, with no test through `sync_user`/the worker task, fails this phase's own bar.

---

### `src/morai/ingest/schwab_sync.py::sync_user` (MODIFIED)

**Exact current call order and transaction boundaries** (schwab_sync.py:335–467, read in
full this session — this is the seam):
```python
# Source: src/morai/ingest/schwab_sync.py:400-467
await session.execute(
    text("SELECT set_config('app.current_user_id', :uid, true)"),
    {"uid": str(user_id)},
)
await session.execute(
    text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
    {"uid": str(user_id)},
)

connection = await read_connection(session, user_id)
if connection is None:
    raise ConnectionNotFound(...)

settings = get_settings()
windows = sync_windows(connection.last_synced_at, now, settings)
...
async with schwab_client_for_user(session, user_id, auth) as client:
    for start, end in windows:
        response = await client.get_transactions(...)
        ...
        broker_transactions_landed += await insert_broker_transactions(session, user_id, broker_rows)
        fills_landed += await insert_fills(session, user_id, fill_rows)

await create_positions(session, user_id)
await sync_events(session, user_id, as_of=now)   # <-- CR-01's exact fix, and the
                                                   #     current last two lines before return

return SyncOutcome(...)
```
**This is exactly where reconciliation hooks in** — RESEARCH.md's own architecture diagram
places it as step 5, immediately after `sync_events(as_of=now)`, before the `return
SyncOutcome(...)`:
```python
await create_positions(session, user_id)
await sync_events(session, user_id, as_of=now)
await run_reconciliation(session, user_id, as_of=now)   # NEW — the exact CR-01 seam
```
`run_reconciliation` must take `as_of=now` explicitly, the same clock `sync_windows` and
`sync_events` both already use in this function — never a second `datetime.now()`. Do not
open a second session and do not commit inside `run_reconciliation` — D7-12's own
"neither opens a second session and neither commits" convention, restated verbatim in
`sync_user`'s own docstring, applies identically to this new call.

## Shared Patterns

### Pure/shell split (applies to `reconciliation.py` as a whole)
**Source:** `src/morai/ledger/settlements.py` (full file)
**Apply to:** `reconcile_window` (pure) / `run_reconciliation` (shell)
```python
# no AsyncSession, no clock read in the pure half; as_of/window bounds are
# the caller's only time input (D7-06's own convention, D9-12's own requirement)
```

### DEK unwrap
**Source:** `src/morai/crypto/data_keys.py::current_dek`/`dek_for_version`
**Apply to:** `run_reconciliation`'s broker_transactions read — never a sixth copy of the
`SELECT key_version, wrapped_dek, wrap_nonce ...` query.

### Decimal encode/decode
**Source:** `src/morai/ledger/fills.py:113-120` (`_encode_decimal`/`_decode_decimal`)
**Apply to:** any commission amount decrypted from `broker_transactions`, imported not
re-implemented — same convention `events.py` already follows.

### Append-only run-ledger + no-commit-inside convention
**Source:** `src/morai/ingest/sync_runs.py::record_sync_run` / `src/morai/ingest/
snapshot_runs.py::record_snapshot_run`
**Apply to:** `reconciliation_runs.py`'s own write function — "does not commit, the caller
owns the transaction," identical wording to copy into the new module's docstring.

### RLS + GRANT boilerplate
**Source:** `alembic/versions/0015_snapshot_capture.py` (tail, GRANT/ENABLE/FORCE/POLICY
block)
**Apply to:** migration `0016_reconciliation_runs.py`, table name substituted, no `UPDATE`
grant (append-only per D9-03's new-row-not-update reasoning).

### Route + `ApiModel` discipline
**Source:** `src/morai/api/routes_identity.py` (`/me`), `src/morai/api/models.py::ApiModel`
**Apply to:** `routes_reconciliation.py` and every response model carrying the
`trustworthy` field — return-type-annotation-only routing (D-11), `strict=True`/
`extra="forbid"`/`frozen=True` on every model.

### Three-state `StrEnum`, never collapsed
**Source:** `src/morai/vendor/connections.py::ConnectionHealth` (the precedent),
`src/morai/ingest/snapshot_runs.py::SnapshotError` (the classification shape)
**Apply to:** `ReconciliationVerdict` (`passed`/`failed`/`indeterminate`) and the
`indeterminate` reason vocabulary.

## No Analog Found

None. RESEARCH.md's own headline — "this phase is pure composition, no new dependency
anywhere" — held under this pattern search too: every file this phase creates or modifies
has a direct, already-read analog in the existing codebase.

## Metadata

**Analog search scope:** `src/morai/ledger/`, `src/morai/ingest/`, `src/morai/api/`,
`src/morai/crypto/`, `src/morai/vendor/`, `alembic/versions/`, `tests/ledger/`,
`tests/ingest/`, `tests/api/` — all already enumerated and read in full by 09-RESEARCH.md
this session; this pass re-read the six files RESEARCH.md excerpted only partially
(`schwab_sync.py`, `snapshot_runs.py`, `sync_runs.py`, `settlements.py`,
`routes_identity.py`, `api/models.py`, `data_keys.py`, `broker_transactions.py`,
`events.py`, `test_sync_tracer.py`, `0015_snapshot_capture.py` tail, `connections.py`'s
`ConnectionHealth`) to pull exact excerpts and line-anchored code blocks for the planner.
**Files scanned this pass:** 12 read directly, 0 additional Glob/Grep needed — RESEARCH.md
already named every analog by file:line citation; this pass confirmed and excerpted them.
**Pattern extraction date:** 2026-09-01
