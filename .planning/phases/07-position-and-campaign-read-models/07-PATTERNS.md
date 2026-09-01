# Phase 7: Position and Campaign Read Models - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/morai/ledger/positions.py` (NEW — closed-state, D7-12 creation) | service (pure fn + shell) | transform / CRUD | `src/morai/ledger/pairing.py` (`derive_events` / `sync_events`) | exact |
| `src/morai/ledger/settlements.py` (NEW — `derive_settlements`) | service (pure fn) | transform | `src/morai/ledger/pairing.py::derive_events` | exact |
| `src/morai/ledger/campaigns.py` (NEW — thin VIEW read) | service (read wrapper) | request-response | `src/morai/ledger/pairing.py::resolve_fill_positions` (raw `text()` + `TypeAdapter`) | exact |
| `alembic/versions/0014_*.py` (NEW migration) | migration | batch/DDL | `alembic/versions/0008_positions_legs_events.py` | exact |
| `tests/gate/test_ledger_write_boundary.py` (NEW) | test (AST gate) | — | `tests/gate/test_ingest_write_boundary.py` | exact |
| `tests/ledger/test_closed_state.py`, `test_settlements.py`, `test_campaigns.py` (NEW) | test | db | `tests/ledger/test_pairing_pure.py` + `tests/ledger/conftest.py` | exact |
| `src/morai/ledger/events.py` (MODIFIED — dedup key, `rolled_from_position_id`) | service | CRUD | itself (extend in place) | exact |
| `src/morai/ledger/pairing.py` (MODIFIED — `sync_events` idempotency 4-tuple, ROLL wiring) | service | CRUD | itself (extend in place) | exact |
| `src/morai/api/routes_identity.py` (MODIFIED — derived `opened_at`) | route/controller | request-response | itself (extend in place) | exact |
| `src/morai/worker/app.py` / `src/morai/ingest/schwab_sync.py` (MODIFIED — wire derivation) | worker/job | event-driven | `sync_user_task` / `sync_user` (itself, extend) | exact |
| `src/morai/db/models.py` (MODIFIED — `Position.__init__`/`Leg.__init__` sentinel, drop 2 columns) | model | CRUD | `Fill.__init__`'s `_write_token` sentinel | exact |
| `tests/ledger/oracle_seed.py`, `test_pairing_shared_leg.py`, `test_pairing_no_position_state.py` (MODIFIED — Pitfall 5) | test | db | themselves (fix in place) | exact |

## Pattern Assignments

### `src/morai/ledger/positions.py` / `settlements.py` (pure-fn + shell)

**Analog:** `src/morai/ledger/pairing.py`

**Purity contract to mirror** (`derive_events`, lines 242-325): a `@dataclass(frozen=True)` input/output
pair, no `AsyncSession`, no `datetime.now()` — every clock value is an explicit parameter
(`derive_settlements(..., *, as_of: datetime)` per D7-06). Sort output deterministically so two runs
are comparable:
```python
events.sort(key=lambda e: (str(e.position_id), e.event_type.value, e.fill_ids_hash))
```

**Signed-amount reuse for D7-09 (ROLL, no new arithmetic)** — `_signed_leg_amount`/`_net_amount`
(pairing.py:184-221) are the money functions to call as-is, never reimplemented:
```python
def _signed_leg_amount(fill: FillRecord, event_type: EventType) -> Decimal | None:
    if fill.quantity is None or fill.price_usd is None:
        return None
    if fill.side not in ("BUY", "SELL"):
        return None
    amount = fill.price_usd * fill.quantity
    if event_type is EventType.OPEN:
        return amount if fill.side == "BUY" else -amount
    return amount if fill.side == "SELL" else -amount
```
A `None`-on-gap return, never `abs()`, is the shape closed-state's net-quantity function (D7-02/D7-03)
must copy exactly — same `side not in ("BUY", "SELL")` guard, same `None` propagation through
`_net_amount`'s loop (never a partial sum).

**Shell pattern** (`sync_events`, lines 350-437): resolve → read → derive → idempotency-filter →
`insert_events`. No commit, no `app.current_user_id` set — caller owns both:
```python
async def sync_events(session, user_id, *, order_ids=None) -> Derivation:
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:uid))"), {"uid": str(user_id)})
    ...
    if drafts:
        await insert_events(session, user_id, drafts)
    return derivation
```
The per-user `pg_advisory_xact_lock` here is the exact concurrency guard the D7-12 position/leg
creation shell must also take before its own read-compare-insert window.

**OCC parsing reuse (D7-12, D7-08):** `parse_occ_symbol` (pairing.py:465-489) already returns
`OccContract(root, expiry, option_type, strike)` — call this directly for both leg `root` assignment
and settlement style; do not reparse.

### `src/morai/ledger/settlements.py` — `AM_SETTLEMENT`/`PM_SETTLEMENT` + `derive_settlements`

RESEARCH.md's Code Examples section already gives the exact skeleton to copy verbatim (constants,
`settlement_instant`, `derive_settlements`) — reproduced here for convenience:
```python
from zoneinfo import ZoneInfo
_EASTERN = ZoneInfo("America/New_York")
AM_SETTLEMENT_TIME = time(9, 30)   # documented lower bound only, D7-08
PM_SETTLEMENT_TIME = time(16, 0)

def settlement_instant(expiry: date, *, root: str) -> datetime:
    settlement_time = AM_SETTLEMENT_TIME if root == "SPX" else PM_SETTLEMENT_TIME
    return datetime.combine(expiry, settlement_time, tzinfo=_EASTERN)
```
`open_debit_usd`/`close_credit_usd` are always `None` on a SETTLEMENT draft (D7-07, NN-16) — never `0`.

### `src/morai/ledger/events.py` (MODIFY — dedup key + `rolled_from_position_id`)

**Analog:** itself, `insert_events`/`EventWrite` (lines 60-186).

Add `rolled_from_position_id: UUID | None` to `EventWrite`/`EventRecord`/`Event` construction,
mirroring how `open_debit_usd`/`close_credit_usd` are already threaded through unchanged from
dataclass → `session.add(Event(...))`. The ROLL-completeness guard to extend, not replace:
```python
if event.event_type == "ROLL" and (
    event.open_debit_usd is None or event.close_credit_usd is None
):
    raise ValueError(...)
```

**Dedup-key broadening (Pattern 2, RESEARCH.md) — the one required change in `pairing.py::sync_events`:**
```python
existing_triples = {
    (record.position_id, record.event_type, record.event_time, record.fill_ids_hash)
    for record in existing
}
drafts = [
    EventWrite(...)
    for event in derivation.events
    if (event.position_id, event.event_type.value, event.event_time, event.fill_ids_hash)
    not in existing_triples
]
```

### `alembic/versions/0014_*.py` (migration)

**Analog:** `alembic/versions/0008_positions_legs_events.py` (full file read; 212 lines, all load-bearing).

Copy shape wholesale: hand-written (not autogenerated), module docstring naming every schema
decision and its rationale, `revision`/`down_revision` header, `_UUID`/`_GEN_UUID` module constants,
explicit per-table `GRANT`/RLS blocks. The CHECK to add for `rolled_from_position_id` (D7-10),
composed independently of the existing `roll_has_both_legs` CHECK (multiple CHECKs on one table are
implicitly ANDed):
```python
op.create_check_constraint(
    "roll_has_rolled_from_position",
    "events",
    "(event_type = 'ROLL') = (rolled_from_position_id IS NOT NULL)",
)
```
Column drop for D7-01:
```python
op.drop_column("positions", "opened_at")
op.drop_column("positions", "closed_at")
```
**Campaign view — the one genuinely new DDL shape this migration adds**, not present in 0008.
`security_invoker = true` is non-negotiable (Pattern 1, RESEARCH.md) — the migration's DDL role is a
superuser with `rolbypassrls`, so a view without this clause silently leaks cross-user data even
though `events`/`positions` themselves are correctly RLS-`FORCE`d:
```sql
CREATE VIEW campaign_chain
WITH (security_invoker = true)
AS
WITH RECURSIVE chain AS (
    SELECT p.id AS campaign_root_id, p.id AS position_id, 0 AS depth
    FROM positions p
    WHERE NOT EXISTS (
        SELECT 1 FROM events e WHERE e.event_type = 'ROLL' AND e.position_id = p.id
    )
  UNION ALL
    SELECT c.campaign_root_id, e.position_id, c.depth + 1
    FROM chain c
    JOIN events e ON e.event_type = 'ROLL' AND e.rolled_from_position_id = c.position_id
)
CYCLE position_id SET is_cycle USING path
SELECT campaign_root_id, position_id, depth FROM chain;
```
Emit via `bind.execute(sa.text(...))`, same as 0008's grant/RLS blocks — no `op.execute` string
literal elsewhere in this repo's migrations, stay consistent. `downgrade()` must `DROP VIEW
campaign_chain` before dropping `events`/`positions` (dependency order, mirroring 0008's own
reverse-order table drops).

### `src/morai/db/models.py` (MODIFY — `Position`/`Leg` write-token sentinels)

**Analog:** `Fill.__init__` (models.py lines ~180-206, read this session).

```python
def __init__(self, *, _write_token: object, **kwargs: object) -> None:
    from morai.ledger.fills import _FILL_WRITE_TOKEN  # pyright: ignore[reportPrivateUsage]
    if _write_token is not _FILL_WRITE_TOKEN:
        raise RuntimeError(
            "Fill must be constructed by insert_fills() -- constructing "
            "one directly bypasses encryption (D3-13, D3-15)."
        )
    super().__init__(**kwargs)
```
Copy this exact shape onto `Position.__init__` and `Leg.__init__`, each importing its own sentinel
(function-body import to break the circular import, `is not` check, `RuntimeError` on mismatch) from
whichever new module (`positions.py`) owns position/leg creation. `Position`/`Leg` currently have no
`__init__` override at all — this is new code, not an extension. `Event.__init__` should get the same
sentinel too, per RESEARCH.md Open Question 2's recommendation (D7-14's gate is strongest with a
runtime mechanism, not an AST scan alone).

Also: drop `opened_at`/`closed_at` `Mapped[...]` columns from the `Position` class body (D7-01) —
paired with the migration's `op.drop_column` calls above.

### `tests/gate/test_ledger_write_boundary.py` (NEW)

**Analog:** `tests/gate/test_ingest_write_boundary.py` (full file, 169 lines — copy wholesale, retarget
the four module-level constants).

Retarget these five names/constants for each new sentinel (one gate test per sentinel, or one
parametrized test over all three — `Position`, `Leg`, `Event`):
```python
_SENTINEL_MODULE = "morai.ledger.positions"   # or wherever the sentinel is defined
_SENTINEL_NAME = "_POSITION_WRITE_TOKEN"       # etc.
_ALLOWED_IMPORTERS = frozenset({
    Path("src/morai/ledger/positions.py"),
    Path("src/morai/db/models.py"),
})
```
Everything else — `_tracked_python_files` (git-ls-files-scoped, fixtures excluded), the AST-walk
`_references_sentinel` (handles both `ast.Assign` definition and multi-line `ast.ImportFrom`), and
the four test functions (positive, synthetic-offender, multiline-form, negative-control-on-public-name)
— copies unchanged in structure, only the constants differ.

### `tests/ledger/test_closed_state.py`, `test_settlements.py`, `test_campaigns.py` (NEW)

**Analog:** `tests/ledger/conftest.py` (fixtures) + `tests/ledger/test_pairing_pure.py` (pure-function
test shape, not read this session but named directly by RESEARCH.md's test map as the file to extend
for LEDGER-05's AST gate).

Fixture reuse from `conftest.py` — `provisioned_users`, `seeded_position` (a real `Position` + two
`Leg` rows, front `SPXW`/back `SPX`, inserted via the superuser session directly with `insert(Position)`
— exactly the shape criterion 3's mixed-settlement-style fixture needs):
```python
@pytest_asyncio.fixture
async def seeded_position(superuser_db_session, provisioned_users) -> SeededPosition:
    position_id = (await superuser_db_session.execute(
        insert(Position).values(user_id=provisioned_users.user_a).returning(Position.id)
    )).scalar_one()
    ...
```
`test_campaigns.py::test_campaign_view_respects_rls` must query the view as a *second* user
(`app_db_session` scoped to `user_b`) and assert zero rows — this is the literal regression test
Pitfall 1 requires; a code read alone does not prove `security_invoker` works.

### `src/morai/api/routes_identity.py` (MODIFY — derived `opened_at`)

Current `list_positions`/`get_position` read `row.opened_at` directly off the ORM row
(`PositionResponse(position_id=row.id, opened_at=row.opened_at)`). Replace with a call into the new
closed-state module's derivation to compute `opened_at` from events instead of the dropped column —
same response shape, same route signature, only the value's source changes.

### `worker/app.py::sync_user_task` / `ingest/schwab_sync.py::sync_user` (MODIFY — wire derivation)

**Analog:** `sync_user`'s existing `insert_broker_transactions` → `insert_fills` sequencing
(schwab_sync.py, per-window loop ending `fills_landed += await insert_fills(session, user_id, fill_rows)`).

Add position/leg creation and the (now 4-tuple-keyed) `sync_events` call immediately after fills land,
inside the same session/transaction `sync_user_task` already opens — do not open a second session.
This closes Pitfall 3: today `sync_events` has zero callers under `src/`.

## Shared Patterns

### Pure-function / thin-shell split
**Source:** `src/morai/ledger/pairing.py` (`derive_events` + `sync_events`)
**Apply to:** `positions.py` (closed-state), `settlements.py` (`derive_settlements`)
No `AsyncSession`, no `datetime.now()` in the pure half; the shell resolves/reads/derives/writes and
owns the clock and the session.

### `None`-on-gap, never `abs()`, never `0`
**Source:** `_signed_leg_amount` (pairing.py:184-208), `EventWrite.open_debit_usd`/`close_credit_usd`
**Apply to:** every new money/quantity function this phase adds — closed-state net quantity, ROLL
amounts, SETTLEMENT amounts (always `None` per D7-07).

### Write-token sentinel gate
**Source:** `Fill.__init__` (models.py) + `tests/gate/test_ingest_write_boundary.py`
**Apply to:** `Position.__init__`, `Leg.__init__`, `Event.__init__`; new gate test
`tests/gate/test_ledger_write_boundary.py`.

### Raw SQL as a named module-level constant, `TypeAdapter` narrowing
**Source:** `RESOLVE_FILL_POSITIONS_SQL` + `resolve_fill_positions` (pairing.py:62-114, 328-347)
**Apply to:** `campaigns.py`'s query against `campaign_chain` (raw `text()` per RESEARCH.md's noted
discretion point — `pairing.py` already sets this precedent over a SQLAlchemy Core `Table`-mapped
view).

### Migration shape: docstring-as-rationale-record, explicit per-table GRANT/RLS blocks
**Source:** `alembic/versions/0008_positions_legs_events.py`
**Apply to:** `0014_*.py` in full — including `security_invoker = true` as this migration's
one genuinely new DDL pattern (no 0008 precedent for a view).

## No Analog Found

None — every file this phase touches has a direct in-repo precedent (RESEARCH.md's own "Don't
Hand-Roll" table independently confirms this: cycle detection, ET conversion, and the no-second-writer
gate each have a proven pattern to copy, not invent).

## Metadata

**Analog search scope:** `src/morai/ledger/`, `src/morai/db/models.py`, `src/morai/api/`,
`src/morai/worker/`, `src/morai/ingest/`, `alembic/versions/`, `tests/gate/`, `tests/ledger/`
**Files scanned:** 12 read directly this session (pairing.py, events.py, models.py [partial],
test_ingest_write_boundary.py, 0008 migration, conftest.py, routes_identity.py/schwab_sync.py/
worker/app.py greps) plus RESEARCH.md's own already-cited excerpts (fills.py, oracle_seed.py,
test_pairing_shared_leg.py, test_pairing_no_position_state.py) reused without re-reading, per the
required-reading instruction not to re-derive RESEARCH.md.
**Pattern extraction date:** 2026-09-01
