# Phase 8: Snapshot Capture - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 9 new, 2 modified
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/morai/ingest/snapshots.py` (pure parse + wire codec + shell) | service | CRUD + event-driven | `src/morai/ledger/pairing.py` (`derive_events`/`sync_events`), `src/morai/ledger/settlements.py` (`derive_settlements`/`read_legs`) | exact (pure/shell split) |
| `to_schwab_wire_symbol` (in `snapshots.py`) | utility | transform | `parse_occ_symbol` in `pairing.py` (inverse direction) | role-match, inverse |
| `src/morai/ingest/snapshot_runs.py` | service | CRUD (run ledger) | `src/morai/ingest/sync_runs.py` | exact |
| `snapshot_observations` / `snapshot_marks` write path (asymmetric upsert, in `snapshots.py`) | model/service | CRUD, conditional upsert | `src/morai/vendor/connections.py::upsert_connection` (`on_conflict_do_update`, non-conditional) | role-match, extend with `where=` |
| `alembic/versions/0015_*.py` | migration | batch | `alembic/versions/0012_sync_runs.py`, `alembic/versions/0011_broker_transactions.py` | exact |
| Repair function + Procrastinate task + CLI (`repair_snapshot_marks`, `tools/repair_snapshots.py`) | service + tool | batch, request-response | `sync_all_connected_users`/`sync_user_task` shape (`worker/app.py`, `ingest/schwab_sync.py`); `tools/create_admin.py`/`tools/rotate_kek.py` for CLI shape | role-match |
| `src/morai/worker/app.py` (MODIFIED: add periodic snapshot job + repair task) | controller/worker task | event-driven (cron) | existing `sync_all_connected_users_task`/`sync_user_task` in the same file | exact |
| `src/morai/ingest/schwab_sync.py`-style per-user shell reused as template for `snapshot_user_task` | service | request-response | `sync_user_task` (`worker/app.py`) + `sync_user` (`ingest/schwab_sync.py`) | exact |
| `tests/ingest/test_snapshot_*.py` (5 files) | test | unit + db | `tests/gate/test_ledger_write_boundary.py`, `tests/ledger/conftest.py`, `tests/ledger/test_plaintext_queries.py`-style db tests | exact |

## Pattern Assignments

### `src/morai/ingest/snapshots.py` — pure parse + wire codec (service, event-driven)

**Analog:** `src/morai/ledger/settlements.py` and `src/morai/ledger/pairing.py`

**Pure/shell split** (mirror exactly — `settlements.py:99-160` `derive_settlements`, no `AsyncSession`, no clock, `as_of` as the only time input):
```python
# src/morai/ledger/settlements.py:99-105
def derive_settlements(
    legs: Sequence[LegRecord],
    events: Sequence[EventRecord],
    *,
    as_of: datetime,
    closed_positions: Mapping[UUID, bool | None],
) -> tuple[DerivedSettlement, ...]:
```
Phase 8's `parse_quote_payload` must follow the identical contract: no session, no `datetime.now()`, never raises, returns a frozen dataclass carrying `gap_reason: str | None` (see RESEARCH.md Pattern 1 for the full body — already written there, use verbatim).

**zoneinfo + named-ET-constant pattern** (mirror exactly for RTH slot enumeration — `settlements.py:50-54`):
```python
# src/morai/ledger/settlements.py:50-54
_EASTERN = ZoneInfo("America/New_York")
AM_SETTLEMENT_TIME = time(9, 30)
PM_SETTLEMENT_TIME = time(16, 0)
```
Phase 8 mirrors this with e.g. `_RTH_OPEN = time(9, 30)` / `_RTH_CLOSE = time(16, 0)`, checked against `_EASTERN` at runtime inside the periodic task per `D8-06`.

**Wire-symbol codec** — nothing to reuse directly; use `parse_occ_symbol` (inverse direction) as the shape to invert:
```python
# src/morai/ledger/pairing.py:798-822
def parse_occ_symbol(occ_symbol: str) -> OccContract:
    match = _OCC_SYMBOL_RE.match(occ_symbol)
    if match is None:
        raise ValueError(f"malformed OCC symbol: {occ_symbol!r}")
    ...
    strike = Decimal(match.group("strike")) / Decimal(1000)
    return OccContract(root=..., expiry=..., option_type=..., strike=...)
```
`to_schwab_wire_symbol` calls `parse_occ_symbol` then re-serializes with the root left-padded to 6 chars (RESEARCH.md Pattern 2 has the full body — use verbatim, and round-trip test it per Pitfall 1).

**Imports pattern** to copy (module-level shape, `pairing.py:27-51`):
```python
from __future__ import annotations
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
```

**Never-raise defensive parse shape** — copy `parse_quote_payload` from RESEARCH.md Pattern 1 verbatim (`raw.get(...)`, `isinstance` guards, degrade to `gap_reason=NO_MARKET_DATA` rather than raise).

---

### Write-token sentinel + AST gate — apply to `SnapshotObservation`/`SnapshotMark` if a single-writer table is desired

**Analog:** `src/morai/ledger/fills.py:1-38` (sentinel definition) + `tests/gate/test_ledger_write_boundary.py:1-75` (AST gate)

**Sentinel shape** (`fills.py:14-38`):
```python
# src/morai/ledger/fills.py
_FILL_WRITE_TOKEN = object()
...
# db/models.py::Fill.__init__ imports _FILL_WRITE_TOKEN locally (function-body
# import, not module-level, to break the import cycle) and checks the caller
# passed it.
```
`Fill.__init__` usage: `Fill(_write_token=_FILL_WRITE_TOKEN, **values[0])` (`pairing.py:249` shows a caller invocation shape — actually defined/enforced in `db/models.py`).

**AST gate test** (`tests/gate/test_ledger_write_boundary.py:1-75`): parametrized over a `_SENTINELS` tuple of `(sentinel_module, sentinel_name, allowed_importers)`, walks `git ls-files -- src tests`, parses each file's AST looking for the sentinel's `ast.Assign` (definition) and `ast.ImportFrom` (import), and fails if any file outside `allowed_importers` imports it. If Phase 8 gives `SnapshotObservation`/`SnapshotMark` their own write-token sentinels (in `ingest/snapshots.py`), add one new entry to `_SENTINELS` mirroring the `_EVENT_WRITE_TOKEN` triple exactly — same file, same test function, no new test file needed.

**Judgment call for the planner:** `sync_runs` and `broker_transactions` do **not** use a write-token sentinel (`sync_runs.py:110-114`'s own docstring: "No `_write_token` gate ... records why one is unnecessary here"). `snapshot_runs` should follow that same precedent (no sentinel) since it mirrors `sync_runs` exactly. Whether `snapshot_observations`/`snapshot_marks` need one is genuinely open — they are money-adjacent (encrypted mark/spot) like `fills`, but written by two entry points (writer + repair) unlike `fills`' single writer. Recommend: no sentinel, since `insert_events` already precedents "two legitimate writers into one table sharing one function" (`ledger/pairing.py::sync_events`) without a sentinel — the sentinel pattern in this codebase is reserved for tables where a *second* writer would be a bug, not where two entry points share one function.

---

### `src/morai/ingest/snapshot_runs.py` (service, CRUD run-ledger)

**Analog:** `src/morai/ingest/sync_runs.py` (copy near-verbatim, per `D8-15`/Claude's Discretion)

**Full shape to mirror** (`sync_runs.py:36-159`):
```python
# Enum for trigger/status, mirroring StrEnum precedent
class SnapshotTrigger(StrEnum):
    SCHEDULED = "scheduled"
    MANUAL = "manual"        # if a manual repair-triggered run needs distinguishing

class SnapshotRunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"

@dataclass(frozen=True)
class SnapshotRunRecord:
    id: UUID
    user_id: UUID
    started_at: datetime
    finished_at: datetime
    trigger: SnapshotTrigger
    status: SnapshotRunStatus
    positions_attempted: int | None
    marks_written: int | None
    gaps_by_reason: ...  # jsonb or three int columns, Claude's Discretion D8-15
    error_code: str | None

async def record_snapshot_run(session: AsyncSession, user_id: UUID, *, ...) -> None:
    """No commit -- caller owns the transaction. No `_write_token` gate,
    same reasoning as `record_sync_run`."""
    await session.execute(insert(SnapshotRun).values(...))

async def read_snapshot_runs(session: AsyncSession, user_id: UUID, *, limit: int) -> list[SnapshotRunRecord]:
    ...  # select().where(user_id==).order_by(started_at.desc()).limit(limit)
```

**Error classification** — mirror `classify_sync_error` (`sync_runs.py:65-81`) exactly: branch on `type(exc)` and `HTTPStatusError.response.status_code`, never on `str(exc)` (`NN-20`, `NN-34`). Add whatever `SnapshotError` members this phase's own vendor call needs (e.g. `CONNECTION_EXPIRED`, `VENDOR_RATE_LIMITED`, `VENDOR_PAYLOAD_UNPARSEABLE`, `UNKNOWN`).

---

### The asymmetric upsert (`snapshot_observations`, `snapshot_marks`)

**Analog:** `src/morai/vendor/connections.py:253-275` (`upsert_connection`, non-conditional `on_conflict_do_update`)

**Base form to extend with `where=`:**
```python
# src/morai/vendor/connections.py:253-275
insert_stmt = pg_insert(SchwabConnection).values(
    user_id=user_id,
    account_hash_ciphertext=account_hash_ciphertext,
    ...
)
await session.execute(
    insert_stmt.on_conflict_do_update(
        index_elements=[SchwabConnection.user_id],
        set_={
            "account_hash_ciphertext": insert_stmt.excluded.account_hash_ciphertext,
            ...
        },
    )
)
```
**The exact delta for Phase 8** — add a `where=` clause (already worked out in RESEARCH.md Pattern 3, copy verbatim):
```python
stmt = insert_stmt.on_conflict_do_update(
    index_elements=["leg_id", "slot_time"],
    set_={ ... },
    where=(
        insert_stmt.excluded.gap_reason.is_(None)
    ) | (
        SnapshotMark.gap_reason.isnot(None)
    ),
)
```
No `.returning()` — `connections.py`'s own docstring cites `V092` for why (an implicit `RETURNING` collides with a restricted `SELECT` policy on some tables; kept as convention regardless of whether this table grants `SELECT`).

**Test discipline for this pattern** — mirror `test_roll_check_constraint.py`'s own "test a database-level guard directly" convention: assert the four-cell truth table (real-over-nothing, real-over-gap, gap-over-nothing, gap-blocked-by-real) directly against Postgres, not through application code.

---

### `snapshot_user_task` shell — connection health branch, per-user isolation, RLS assertion

**Analog:** `src/morai/worker/app.py::sync_user_task` (lines ~121-188) + `src/morai/ingest/schwab_sync.py::sync_user`

**RLS-cannot-bypass assertion** (`identity/rls.py:30-55`, called exactly once per protected session — mirror this call site verbatim):
```python
# src/morai/worker/app.py (sync_user_task body)
session_maker = get_session_maker()
async with session_maker() as session:
    await assert_connection_cannot_bypass_rls(session)
    try:
        outcome = await run_sync_user(session, UUID(user_id), auth=get_schwab_auth(), now=started_at)
    except Exception as exc:
        await session.rollback()
        error_code = classify_sync_error(exc)
        async with session_maker() as failure_session:
            await failure_session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": user_id},
            )
            await record_sync_run(failure_session, ..., status=SyncStatus.FAILED, error_code=error_code)
            await failure_session.commit()
        raise
    await record_sync_run(session, ..., status=SyncStatus.SUCCEEDED, ...)
    await session.commit()
```
`snapshot_user_task` copies this two-session split (failure record survives the rollback that erased the rest of the run) verbatim, swapping `sync_runs` calls for `snapshot_runs` calls, and adding the RTH-membership early-return (`D8-06`) before any DB write:
```python
# early return before any row is written — per D8-06, a non-RTH tick writes
# nothing at all, not even a snapshot_runs row (mirrors D8-05's "trigger
# assigns the slot" — a non-RTH tick was never a slot to begin with)
```

**Fan-out shape** (`worker/app.py:87-102`, `sync_all_connected_users_task`):
```python
@app.periodic(cron="* * * * *")  # placeholder cadence -- swap for the RTH cron
@app.task(name="sync_all_connected_users")
async def sync_all_connected_users_task(timestamp: int) -> None:
    async with AsyncSession(get_engine()) as session:
        await run_sync_all_connected_users(session)
        await session.commit()
```
Phase 8's periodic snapshot fan-out mirrors this exactly: cross-tenant read on the superuser engine (`get_engine()`), listing-only, then one `snapshot_user_task.defer_async(user_id=..., timestamp=timestamp)` per connected user — never a write on the superuser session (Security Domain, RESEARCH.md: "A cross-tenant read in the fan-out step used to also write, bypassing RLS").

**Connection-health branch** — reuse `derive_connection_health` unmodified (`vendor/connections.py:136-169`), called from the shell, not recomputed:
```python
health, expires_at = derive_connection_health(connection.token_created_at, now=started_at)
if health is ConnectionHealth.EXPIRED:
    # write one gap row per open leg, gap_reason=connection_expired (D8-14),
    # no vendor call
```

---

### Repair path — same function, two entry points (`D8-13`)

**Analog for the task/CLI split:** `tools/create_admin.py` / `tools/rotate_kek.py` (CLI doc-comment convention) + `sync_user_task` (Procrastinate `@app.task` wrapper calling one shared async function)

Read one of the existing CLI tools directly before writing `tools/repair_snapshots.py` to confirm the exact doc-comment/argv convention (`uv run python tools/rotate_kek.py ...` style header). Both entry points must call the identical `repair_snapshot_marks(session, user_id, *, since=None)` function — no logic duplicated into either wrapper, mirroring how `sync_user_task` (worker task) is a thin wrapper over `sync_user` (pure-ish shell in `ingest/schwab_sync.py`).

---

### `alembic/versions/0015_snapshot_observations_and_marks.py` (migration, batch)

**Analog:** `alembic/versions/0012_sync_runs.py` (full file read above) + `alembic/versions/0011_broker_transactions.py` (chunking / bind-parameter arithmetic)

**GRANT + RLS boilerplate to copy verbatim per table** (`0012_sync_runs.py`, tail of `upgrade()`):
```python
bind.execute(sa.text("GRANT SELECT, INSERT, DELETE ON sync_runs TO morai_app"))
bind.execute(sa.text("ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY"))
bind.execute(sa.text("ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY"))
bind.execute(
    sa.text(
        "CREATE POLICY user_isolation ON sync_runs "
        "FOR ALL "
        "USING (user_id = current_setting('app.current_user_id', true)::uuid) "
        "WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid)"
    )
)
```
For `snapshot_observations`/`snapshot_marks`, the `GRANT` list must include `UPDATE` (unlike `sync_runs`'/`broker_transactions`' append-only grant) — RESEARCH.md's own migration sketch names this explicitly: "`UPDATE` is required here ... because this table's own asymmetric upsert (D8-10) IS an UPDATE path."

**Table shape** — see RESEARCH.md's own worked migration example (lines 518-560 of 08-RESEARCH.md) for the full `create_table` call including `CheckConstraint` on `gap_reason` and `UniqueConstraint("leg_id", "slot_time")` — copy that verbatim rather than re-deriving it.

**Chunk size** — reuse `_CHUNK_SIZE = 2000` unchanged (`NN-5`); do not recompute the bind-parameter ceiling, RESEARCH.md already did the arithmetic (`floor(65534/9) = 7281` rows/statement, 2000 sits at ~1/4 of that).

---

### Test files (`tests/ingest/test_snapshot_*.py`)

**Analog:** `tests/gate/test_ledger_write_boundary.py` (AST gate pattern, only if a write-token sentinel is added), `tests/ledger/conftest.py` (fixture conventions), Phase 6/7's own `-m db` tests for the asymmetric-upsert truth-table style (`test_roll_check_constraint.py` referenced by name in RESEARCH.md, not read this session — locate and mirror its "assert the DB-level guard directly" structure).

**Fixture conventions to copy** (`tests/ledger/conftest.py:1-90`):
```python
# Re-export pattern for shared fixtures
__all__ = [..., "app_db_session", "clean_ledger_tables", "provisioned_users", ...]

@pytest_asyncio.fixture
async def clean_ledger_tables(clean_identity_tables: None) -> AsyncGenerator[None, None]:
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE events, legs, positions, fills, user_data_keys CASCADE"))
    await engine.dispose()
    yield
```
Phase 8 needs an equivalent `clean_snapshot_tables` fixture truncating `snapshot_observations, snapshot_marks, snapshot_runs`, and a `seeded_position`-equivalent fixture (already exists, reusable directly — `seeded_position` in `tests/ledger/conftest.py`) to seed a user + open position + leg before writing a snapshot row. `pytest.mark.db` usage: every db-marked test in this codebase already follows this fixture-composition convention; no new pattern needed, just compose `provisioned_users`/`seeded_position` with a new `clean_snapshot_tables`.

## Shared Patterns

### Pure/shell split
**Source:** `src/morai/ledger/settlements.py::derive_settlements` (lines 99-160), `src/morai/ledger/pairing.py::derive_events`/`sync_events` (lines 409-461, 575-769)
**Apply to:** `parse_quote_payload`, `to_schwab_wire_symbol` (pure), `snapshot_user_task`/`repair_snapshot_marks` (shell)
No `AsyncSession`, no `datetime.now()`, no import that could reach a broker, in every pure half. Every shell takes its clock as an explicit `as_of`/`now`/`timestamp` parameter, never reads the system clock internally except at the outermost task boundary.

### RLS-cannot-bypass assertion
**Source:** `src/morai/identity/rls.py::assert_connection_cannot_bypass_rls` (lines 30-55)
**Apply to:** Every new worker task opening a `morai_app` session before touching `snapshot_observations`/`snapshot_marks`/`snapshot_runs` — call it once, immediately after opening the session, exactly as `sync_user_task` does.

### Never-log-verbatim vendor errors
**Source:** `src/morai/ingest/sync_runs.py::classify_sync_error` (lines 65-81)
**Apply to:** Any new `SnapshotError` classification — branch on exception type and status code, never `str(exc)` (`NN-20`, `NN-34`).

### Asymmetric conditional upsert
**Source:** `src/morai/vendor/connections.py::upsert_connection` (lines 253-275, extended per RESEARCH.md Pattern 3)
**Apply to:** Both `snapshot_observations` and `snapshot_marks` writes, and the repair path's re-upsert into `snapshot_marks`.

### Per-item error isolation, two grains
**Source:** `src/morai/worker/app.py::sync_user_task` (whole-call exception boundary) + `parse_quote_payload`'s own never-raise design (per-symbol grain)
**Apply to:** `snapshot_user_task` — catch the whole `get_quotes` call's exception at the per-user task boundary (mirrors `sync_user_task`'s `try`/`except Exception`); `parse_quote_payload` itself never raises, absorbing per-symbol malformed elements.

## No Analog Found

None. Every file this phase creates has at least a role-match analog already in the codebase (see table above) — this matches RESEARCH.md's own headline finding that Phase 8 applies existing patterns rather than inventing them.

## Metadata

**Analog search scope:** `src/morai/ledger/` (`pairing.py`, `settlements.py`, `fills.py`, `positions.py`, `events.py`), `src/morai/ingest/` (`sync_runs.py`, `schwab_sync.py`, `broker_transactions.py`), `src/morai/vendor/` (`connections.py`, `protocol.py`), `src/morai/worker/app.py`, `src/morai/identity/rls.py`, `alembic/versions/0011_*.py`, `0012_*.py`, `tests/gate/test_ledger_write_boundary.py`, `tests/ledger/conftest.py`, `tools/`.
**Files scanned (read directly this session):** `pairing.py`, `settlements.py`, `sync_runs.py`, `connections.py`, `fills.py` (excerpt), `worker/app.py`, `schwab_sync.py` (excerpt), `identity/rls.py` (excerpt), `alembic/versions/0012_sync_runs.py` (full), `tests/gate/test_ledger_write_boundary.py` (excerpt), `tests/ledger/conftest.py` (excerpt), `vendor/protocol.py` (excerpt).
**Pattern extraction date:** 2026-09-01
