# Phase 8: Snapshot Capture - Research

**Researched:** 2026-09-01
**Domain:** Vendor market-data capture on a fixed cadence, honest-gap upsert semantics, Postgres/SQLAlchemy write paths, Procrastinate periodic scheduling
**Confidence:** MEDIUM — the write-path mechanics (SQLAlchemy upsert, Procrastinate periodic behavior, this project's own established patterns) are HIGH confidence, read from source this session. The Schwab `get_quotes` response schema for OCC option symbols is LOW confidence — schwab-py itself is a thin untyped proxy over the HTTP call, this project has never called it in production, and no official-docs fetch this session returned the exact JSON field list. Design accordingly: store the raw payload verbatim (D8-04) and parse leniently, so an imperfect schema guess costs nothing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D8-01** — Two layers: raw observations, and marks derived from them. Store the raw vendor
  observation per contract per slot, and a derived mark row on top of it.
- **D8-02** — No greeks in this phase. Store the observed quote and the underlying spot only.
- **D8-03** — Fetch via `get_quotes(symbols)`, not the full option chain. Collect the OCC symbols
  of every open leg and request exactly those quotes.
- **D8-04** — Retain the raw vendor payload per slot.
- **D8-05** — The trigger assigns the slot; slots are never re-derived by a window query. The
  scheduled job knows which slot it is firing for and stamps it. The observation separately
  carries its own `observed_at`.
- **D8-06** — Cron in UTC, RTH membership computed in ET at runtime via `zoneinfo`.
- **D8-07** — The execution model is inherited from `D6-01`, not re-decided (the long-running
  Procrastinate worker, not a Railway cron container).
- **D8-08** — 30-minute RTH slots, stored as `timestamptz`.
- **D8-09** — A gap is `mark_usd IS NULL` plus a non-null `gap_reason`. Pinned once, in code, never
  a sentinel.
- **D8-10** — `DO UPDATE ... WHERE`: real may overwrite gap, gap may never overwrite real. The
  asymmetry is the requirement, not an optimisation.
- **D8-11** — Gap granularity is per leg.
- **D8-12** — A slot's gap is healed only by a real observation for that same slot, never a
  neighbouring slot's observation.
- **D8-13** — The repair path ships as both a Procrastinate task and a runnable CLI over one
  function. Ships in this phase, beside the writer.
- **D8-14** — An expired connection produces an explicit gap with its own reason (`gap_reason`
  distinguishes `connection_expired` from `no_market_data`).
- **D8-15** — A `snapshot_runs` table, mirroring Phase 6's `sync_runs`: when it ran, positions
  attempted, marks written, gaps by reason, errors.
- **D8-16** — Per-item error isolation. One failing position-leg-slot must not abort the sweep.

### Claude's Discretion

- Table and column naming, and whether raw observations and marks are two tables or one table with
  a discriminator — provided the raw layer is independently queryable enough to rebuild marks.
- Whether `snapshot_runs` reuses `sync_runs`' exact shape or a parallel one.
- The precise `gap_reason` vocabulary, provided `connection_expired` and `no_market_data` are
  distinguishable.
- Whether the CLI lives in `tools/` as a script or as a `python -m` entry point.

### Deferred Ideas (OUT OF SCOPE)

- BSM greeks and any derived analytics over the captured quotes (`D8-02`). Recomputable later from
  the stored observations, which is the whole point of storing them.
- Alerting on a stalled capture job. `D8-15` makes staleness *queryable* via `snapshot_runs`; wiring
  that to a notification channel is not in this phase's criteria.
- Backfill of any period before this phase ships. There are no stored observations for it, and
  fabricating them is exactly what `L041` forbids.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SNAP-01 | Every open position is repriced and snapshotted on a 30-minute RTH cadence | §"Cadence and RTH slot enumeration" — cron shape, `zoneinfo` RTH check, Procrastinate `periodic()` mechanics, fan-out shape mirroring `sync_all_connected_users` |
| SNAP-02 | A slot with no market data stores an explicit gap, never fabricated/interpolated/carried-forward | §"Gap semantics" — `gap_reason` vocabulary, `mark_usd IS NULL` pin, lenient-parse-then-gap design |
| SNAP-03 | A gap can be healed by a later real observation; a real observation is never replaced by a gap | §"The asymmetric upsert" — exact SQLAlchemy `on_conflict_do_update(..., where=...)` form |
| SNAP-04 | The snapshot writer ships with a runnable repair path that rebuilds snapshots from raw observations | §"Repair path shape" — pure `parse_quote_payload` shared by writer task, repair task, and CLI |
| SNAP-05 | Capture runs for a user whose connection is healthy and records an honest gap for one whose is not | §"Connection health input" — `derive_connection_health`/`ConnectionHealth` reuse, no vendor call on expired |
</phase_requirements>

## Summary

Phase 8 is a write-path phase, not an unknown-domain phase: every mechanism it needs —
per-user RLS-scoped sessions, chunked encrypted inserts, asymmetric `ON CONFLICT` upserts,
`zoneinfo`-based ET time handling, a `sync_runs`-shaped run ledger, write-token sentinels, a
pure/shell split — already exists in this codebase from Phases 3, 4, 6 and 7, built and tested
against the exact same discipline (`NN-1`, `NN-5`, `NN-16`, `L001`/`L002`/`L005`/`L020`,
`L039`-`L043`, `L048`). The work is applying those patterns to two new tables and one new
periodic task, not inventing new ones.

The one genuine unknown is `get_quotes`'s real response shape for OCC option symbols — it has
never been called against a live Schwab endpoint in this project (`D4-02`'s own comment: "this
phase's tests exercise only `get_transactions`/`get_account_numbers`"). `schwab-py`'s own source
confirms the *request* shape precisely (comma-joined symbols to `GET /marketdata/v1/quotes`) but,
being an untyped thin proxy, says nothing about the *response* shape — that lives entirely on
Schwab's side. Design accordingly: this phase's own locked decision to store the raw payload
verbatim (`D8-04`) is exactly the hedge against that unknown, and the parse step must be lenient
(`extra="ignore"`, every derived field `Optional`) so a wrong schema guess degrades to an honest
gap (`SNAP-02`) rather than a crash.

A second, higher-value finding surfaced by reading `schwab-py`'s own source rather than trusting
this project's internal OCC convention: **the internal `occ_symbol` this codebase already stores
on `legs` (e.g. `SPXW260321P07575000`, no padding) is not the wire format Schwab's own API
expects.** Schwab pads the underlying to exactly six characters with trailing spaces
(`SPXW  260321P07575000` for `SPXW`, `SPX   260321P07575000` for `SPX`). `get_quotes` must be
called with the padded form; the codec to produce it does not yet exist anywhere in this codebase
and must be written in this phase, not assumed to already exist per `V015`'s "reuse the codec"
(there is nothing yet to reuse).

A third finding, from reading Procrastinate's own `periodic.py` rather than its docs: a worker
that has been down for more than ten minutes does not backfill the missed periodic ticks on
restart — `PeriodicDeferrer.get_timestamps`'s `MAX_DELAY = 60 * 10` silently drops any tick older
than ten minutes when `last_defers` is empty (i.e., every process restart). This means a slot can
end up with **no row at all**, not even a gap row, if the worker was down more than ten minutes
across that slot's boundary — the job was simply never deferred. This is exactly the class of
failure `L042`/`L043`/`D8-15` exist to make observable: `snapshot_runs`' own row count against the
expected slot count for a session is what surfaces this, not a per-slot gap row, because
Procrastinate never gave the writer a chance to write one.

**Primary recommendation:** two new tables (`snapshot_observations` raw, `snapshot_marks`
derived), one `snapshot_runs` table mirroring `sync_runs` exactly, one pure `parse_quote_payload`
function shared by the periodic writer task, the repair task, and a `tools/` CLI, and the same
asymmetric `on_conflict_do_update(..., where=...)` clause on both tables keyed `(leg_id,
slot_time)`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 30-minute RTH cadence trigger | Worker (Procrastinate `@app.periodic`) | — | Already the established execution model (`D6-01`/`D8-07`); no HTTP request is involved in triggering capture. |
| Per-user fan-out | Worker | Database (`users`/`schwab_connections` cross-tenant read) | Mirrors `sync_all_connected_users_task`'s existing shape exactly — the one place a cross-tenant read is correct, on the superuser engine, before handing off to per-user `morai_app` sessions. |
| Open-position/leg resolution | Database / Backend (`morai.ledger.positions`) | — | `derive_position_state`/`read_position_state` (Phase 7) already compute this; this phase is a pure consumer. |
| Connection health check | Database / Backend (`morai.vendor.connections`) | — | `derive_connection_health` (Phase 4) already computes healthy/expiring/expired from `token_created_at`; this phase reuses it, does not recompute it. |
| Vendor quote fetch | Backend (`morai.vendor.schwab_adapter`) | External (Schwab `/marketdata/v1/quotes`) | One HTTP call per user per slot, through the existing `SchwabClient` protocol boundary. |
| Raw observation storage | Database (`snapshot_observations`) | Backend (encryption at the write boundary) | Mirrors `broker_transactions`' raw-ciphertext-per-row pattern exactly. |
| Mark derivation | Backend (pure function, no session/clock) | — | Mirrors `derive_events`/`derive_connection_health`/`derive_position_state`'s established pure/shell split. |
| Mark storage + gap upsert | Database (`snapshot_marks`) | — | The asymmetric `DO UPDATE ... WHERE` clause is a database-level guarantee, not an application-level one — it holds even under concurrent writers. |
| Run/liveness accounting | Database (`snapshot_runs`) | — | Mirrors `sync_runs` exactly; the only defense against `L042`. |
| Repair | Backend (Procrastinate task) + CLI (`tools/`) | Database (reads `snapshot_observations`, writes `snapshot_marks`) | No vendor call at all — pure recompute from already-stored raw rows (`D8-04`, `D8-13`). |

## Standard Stack

No new external packages this phase. Every library involved is already pinned and installed:

### Core (already present, reused)

| Library | Version (verified live, this session) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `procrastinate` | 3.9.0 [VERIFIED: `.venv/lib/python3.13/site-packages/procrastinate/__init__.py`, `__version__`] | `@app.periodic`/`@app.task` cadence | Already the project's job-queue choice (`D6-01`); `periodic.py` read directly this session (see Pitfalls). |
| `sqlalchemy` | 2.0.52 [VERIFIED: same import check] | `postgresql.insert(...).on_conflict_do_update(...)` upsert | Already the project's ORM/Core choice; the exact `.excluded` + `where=` pattern this phase needs is a documented Core feature, and this codebase already uses the non-`where` form (`vendor/connections.py`). |
| `schwab-py` | 1.5.1, pinned [VERIFIED: `pyproject.toml:19`, cross-checked against the installed wheel's `client/base.py`] | `get_quotes(symbols)` HTTP call | Already the project's vendor library; `D4-02` declared `get_quotes` specifically for this phase. |
| `zoneinfo` (stdlib) + `tzdata==2026.3` | stdlib / [VERIFIED: `pyproject.toml:20`] | RTH membership computed in ET (`D8-06`) | `tzdata` is already pinned as of Phase 7 specifically because the deployed container needs it (`STATE.md`'s Phase 7 open item); this phase's `zoneinfo` use is the same pattern `settlements.py` already established. |
| `cryptography` (`AESGCM`) | pinned upstream (Phase 3) | Encrypting `raw_payload`, `mark_usd`, `spot_usd` | Same per-user DEK envelope every trading-data column in this schema already uses; no new key domain. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `get_quotes(symbols)` per open leg | `get_option_chain(symbol)` per underlying | Rejected by `D8-03`: pulls thousands of contracts per slot against a vendor rate limit, to use a handful. Not reconsidered here. |
| One raw + one derived table | One table with a discriminator column | `D8-01`/`D8-04` require the raw layer to be independently queryable enough to rebuild marks; a single table with a "kind" column would make the repair path's own read query (`WHERE kind = 'raw'`) do the same job with worse column typing (raw payload columns would sit alongside, and be nullable next to, derived-mark columns on every row). Two tables is `Claude's Discretion` per `08-CONTEXT.md`, but two tables is recommended, matching `broker_transactions` vs `fills`' own precedent (Phase 6) for the identical reason. |
| A market-calendar dependency for half-days/holidays | No dependency; a missing slot is silently absent from the cron's own RTH window | See "RTH slot enumeration and DST" below — recommended: no dependency. |

**Installation:** none — no new packages.

## Package Legitimacy Audit

No external packages are introduced by this phase. Every library used (`procrastinate`,
`sqlalchemy`, `schwab-py`, `cryptography`, `tzdata`) is already pinned in `pyproject.toml` and was
verified live in earlier phases (04-RESEARCH.md, 06-RESEARCH.md). No `package-legitimacy check`
run is required.

## Architecture Patterns

### System Architecture Diagram

```
Procrastinate periodic tick (UTC cron, D8-06)
        |
        v
sync_all_users_style fan-out  --(cross-tenant read, superuser engine)-->  users + schwab_connections
        |  (defers one snapshot_user_task(user_id, timestamp) per connected user)
        v
snapshot_user_task(user_id, timestamp)          <-- opens morai_app session, set_config, RLS asserted
        |
        |-- ET check (zoneinfo): timestamp outside RTH?  --> return early, no row written at all
        |
        |-- read_position_state / derive_position_state (Phase 7)  --> this user's open legs
        |
        |-- derive_connection_health (Phase 4)
        |        |
        |        |-- EXPIRED --> write one snapshot_marks + snapshot_observations gap row
        |        |                per open leg, gap_reason=connection_expired (D8-14). No vendor call.
        |        |
        |        `-- HEALTHY/EXPIRING_SOON --> continue
        |
        |-- build wire symbols (codec: occ_symbol -> Schwab's space-padded form, NEW this phase)
        |
        |-- get_quotes(symbols) via schwab_client_for_user  --(one HTTP call)-->  Schwab /marketdata/v1/quotes
        |        |
        |        |-- whole call raises (network/HTTP/429) --> per-item isolation: every open leg for
        |        |                                             this user/slot gets a gap row (gap_reason
        |        |                                             chosen from Claude's-discretion vocabulary,
        |        |                                             e.g. fetch_error), never an absent row (D8-16)
        |        |
        |        `-- call succeeds --> per-symbol response element
        |                 |
        |                 |-- symbol missing / in an errors bucket / parse fails
        |                 |        --> gap_reason=no_market_data for that leg only (D8-16 isolation)
        |                 |
        |                 `-- symbol parses --> parse_quote_payload (PURE) --> mark_usd, spot_usd
        |
        |-- insert_snapshot_observations (encrypted raw, asymmetric upsert, D8-01/D8-04)
        |-- insert_snapshot_marks         (encrypted mark, asymmetric upsert, D8-09/D8-10/D8-12)
        |
        `-- record_snapshot_run (D8-15) -- always, success or per-user failure, mirrors sync_runs

Repair path (D8-13), no vendor call, same parse_quote_payload:
tools/repair_snapshots.py  --or--  Procrastinate repair_snapshot_marks task
        |
        v
read snapshot_observations (decrypt raw) --> parse_quote_payload --> re-upsert snapshot_marks
        (same asymmetric WHERE clause; a repaired real value can overwrite an earlier real value
         too -- this is the corrective-backfill case L005 describes, not just gap-healing)
```

### Recommended Project Structure

```
src/morai/
├── ingest/
│   ├── snapshots.py          # NEW: snapshot_user_task shell, wire-symbol codec, fan-out
│   └── snapshot_runs.py      # NEW: mirrors ingest/sync_runs.py exactly (D8-15)
├── ledger/                   # (no change -- snapshots are not ledger/money-derivation data)
├── worker/
│   └── app.py                # ADD: @app.periodic RTH-cadence task, repair task
alembic/versions/
├── 0015_snapshot_observations_and_marks.py   # NEW migration
tools/
├── repair_snapshots.py       # NEW: CLI over the same repair function (D8-13)
tests/
├── ingest/
│   ├── test_snapshot_capture.py
│   ├── test_snapshot_gap_upsert.py
│   ├── test_snapshot_repair.py
│   └── test_snapshot_wire_symbol_codec.py
```

`snapshots.py` lives under `ingest/`, not `ledger/`, mirroring `broker_transactions.py`'s own
placement: this is vendor-observation capture, not money derivation from stored fills. The
`Established Patterns` in `08-CONTEXT.md` already name this split.

### Pattern 1: Pure parse, thin shell (reuse this codebase's own established convention)

**What:** `parse_quote_payload(raw: JsonValue, requested_symbol: str) -> ParsedQuote` takes no
session, no clock, imports nothing that could reach a broker. Returns a dataclass carrying
`mark_usd: Decimal | None`, `spot_usd: Decimal | None`, `gap_reason: str | None`. Never raises on
malformed input — a symbol that doesn't parse returns `gap_reason="no_market_data"`, not an
exception (`NN-16`, `L041`).

**When to use:** Every place this phase turns vendor JSON into a mark. Both the live writer path
and the repair path call the exact same function.

**Example, mirroring the established shape exactly** (compare `derive_connection_health` in
`vendor/connections.py` and `derive_position_state` in `ledger/positions.py`, both read this
session):

```python
# Source: this codebase's own convention, not an external doc.
# See vendor/connections.py::derive_connection_health and
# ledger/positions.py::derive_position_state for the precedent this mirrors.

@dataclass(frozen=True)
class ParsedQuote:
    mark_usd: Decimal | None
    spot_usd: Decimal | None
    gap_reason: str | None  # None means a real quote; SnapshotGapReason otherwise


def parse_quote_payload(raw: JsonValue, requested_symbol: str) -> ParsedQuote:
    """Pure. No AsyncSession, no clock read, no import that could reach a
    broker (mirrors derive_connection_health's own purity contract).
    `raw` is the whole decrypted get_quotes response for one user/slot;
    requested_symbol is this leg's own Schwab wire-format symbol.
    """
    element = raw.get(requested_symbol) if isinstance(raw, dict) else None
    if not isinstance(element, dict):
        return ParsedQuote(None, None, gap_reason=SnapshotGapReason.NO_MARKET_DATA.value)
    quote = element.get("quote")
    if not isinstance(quote, dict):
        return ParsedQuote(None, None, gap_reason=SnapshotGapReason.NO_MARKET_DATA.value)
    mark = quote.get("mark")
    underlying_price = quote.get("underlyingPrice")
    if mark is None:
        return ParsedQuote(None, None, gap_reason=SnapshotGapReason.NO_MARKET_DATA.value)
    return ParsedQuote(
        mark_usd=Decimal(str(mark)),
        spot_usd=Decimal(str(underlying_price)) if underlying_price is not None else None,
        gap_reason=None,
    )
```

The exact field names `quote.mark` / `quote.underlyingPrice` are [ASSUMED] — see Assumptions Log
A1. The function's *shape* (pure, `dict.get`-defensive, never raises, degrades to a named gap
reason) is what this phase must ship regardless of which field names turn out to be right; a
wrong field name under this design produces an honest, loud `no_market_data` gap on the very
first live run rather than a crash — cheap to fix once observed.

### Pattern 2: The Schwab wire-format symbol codec (NEW — nothing to reuse yet)

**What:** `to_schwab_wire_symbol(occ_symbol: str) -> str` — pads the root left-justified to six
characters with spaces, leaves the rest of the OCC string unchanged.

**Why it must exist:** [VERIFIED: `.venv/lib/python3.13/site-packages/schwab/orders/options.py:43-58`]
— `schwab-py`'s own `OptionSymbol` docstring states the format explicitly: `"[Underlying left
justified with spaces to 6 positions][Two digit year][Two digit month][Two digit
day]['P' or 'C'][Strike price]"`, with worked examples `QQQ   240420P00500000` and
`SPXW  240420C05040000`. This project's own internal `occ_symbol` convention
[VERIFIED: `src/morai/ledger/pairing.py:780-785`, `_OCC_SYMBOL_RE = re.compile(r"^(?P<root>SPXW|SPX)(?P<yy>\d{2})(?P<mm>\d{2})(?P<dd>\d{2})(?P<option_type>[A-Z])(?P<strike>\d{8})$")`]
has **no padding at all** — `SPXW260321P07575000`, not `SPXW  260321P07575000`. Sending the
unpadded form to `get_quotes` is untested and, per `OptionSymbol`'s own docstring, wrong.

```python
# Source: this codebase's own parse_occ_symbol (ledger/pairing.py) + the
# wire-format contract read directly from the installed schwab-py 1.5.1
# wheel (schwab/orders/options.py).
def to_schwab_wire_symbol(occ_symbol: str) -> str:
    contract = parse_occ_symbol(occ_symbol)  # existing, ledger/pairing.py
    padded_root = contract.root.ljust(6)
    yy = str(contract.expiry.year % 100).zfill(2)
    mm = str(contract.expiry.month).zfill(2)
    dd = str(contract.expiry.day).zfill(2)
    strike_thousandths = str(int(contract.strike * 1000)).zfill(8)
    return f"{padded_root}{yy}{mm}{dd}{contract.option_type}{strike_thousandths}"
```

Round-trip this against `parse_occ_symbol` in a unit test before it ever reaches a live call —
that is the "cheapest honest red" this project's own `workflow.md` already asks for.

### Pattern 3: The asymmetric upsert (D8-10, the single highest-risk line in the phase)

**What:** `INSERT ... ON CONFLICT (leg_id, slot_time) DO UPDATE ... WHERE` such that a real
observation always may overwrite a gap, and a gap may never overwrite a real observation.

**When to use:** Both `snapshot_observations` and `snapshot_marks` writes, and the repair path's
re-upsert into `snapshot_marks`.

**Example**, extending this codebase's own existing (non-conditional) `on_conflict_do_update` in
`vendor/connections.py:264-274` with a `where=` clause:

```python
# Source: SQLAlchemy 2.0's documented postgresql.insert().on_conflict_do_update
# API (dialect-specific INSERT...ON CONFLICT), same base form already used
# in this codebase at vendor/connections.py:264-274 -- extended here with a
# `where=` clause, which is the documented mechanism for a conditional upsert.
insert_stmt = pg_insert(SnapshotMark).values(values)  # one row per chunk element
stmt = insert_stmt.on_conflict_do_update(
    index_elements=["leg_id", "slot_time"],
    set_={
        "mark_ciphertext": insert_stmt.excluded.mark_ciphertext,
        "mark_nonce": insert_stmt.excluded.mark_nonce,
        "spot_ciphertext": insert_stmt.excluded.spot_ciphertext,
        "spot_nonce": insert_stmt.excluded.spot_nonce,
        "key_version": insert_stmt.excluded.key_version,
        "gap_reason": insert_stmt.excluded.gap_reason,
        "observed_at": insert_stmt.excluded.observed_at,
    },
    where=(
        # incoming write is real (heals a gap, or corrects an earlier real
        # value via repair -- L005's "later, more complete write" case)
        insert_stmt.excluded.gap_reason.is_(None)
    )
    | (
        # OR the existing row is already a gap -- any incoming write
        # (including another gap, with a corrected reason) may proceed
        SnapshotMark.gap_reason.isnot(None)
    ),
)
```

The blocked case, by construction: `excluded.gap_reason IS NOT NULL AND
SnapshotMark.gap_reason IS NULL` — an incoming gap against an existing real row. Neither
disjunct is true, so the `WHERE` fails, `DO UPDATE` does not fire, and Postgres reports the
insert as a no-op — exactly `L005`'s discriminator applied correctly. Write a unit test asserting
this exact case stays unchanged (mirrors `test_roll_check_constraint.py`'s own discipline of
testing a database-level guard directly, not just through application code).

### Pattern 4: Repair path shape, same function two entry points (D8-13)

**What:** `repair_snapshot_marks(session, user_id, *, since=None) -> RepairOutcome` — reads
`snapshot_observations` rows for that user (optionally windowed), decrypts each, calls
`parse_quote_payload`, and re-runs the same asymmetric upsert into `snapshot_marks`. No vendor
call. Exposed as:

1. A Procrastinate `@app.task` (`worker/app.py`), callable on demand or chained after the writer.
2. A CLI, `tools/repair_snapshots.py`, mirroring `tools/create_admin.py`'s own doc-comment
   convention (`uv run python tools/repair_snapshots.py <user_id>` /
   `railway run --service worker uv run python tools/repair_snapshots.py <user_id>`), calling the
   identical async function — not a reimplementation.

The CLI needs a superuser-engine, cross-tenant *listing* step (iterate every `user_id` with at
least one `snapshot_observations` row) before calling `repair_snapshot_marks` once per user under
that user's own `morai_app` + `set_config` session — the exact two-tier shape
`sync_all_connected_users`'s own docstring already justifies for the identical reason (one
legitimate cross-tenant read, then per-user RLS-scoped work).

### Anti-Patterns to Avoid

- **A half-open `[anchor, anchor + interval)` window to resolve which slot an observation
  belongs to.** This is `L048`, verbatim the bug this phase's `D8-05` exists to prevent. The
  trigger's own `timestamp` argument (Procrastinate periodic tasks already receive this — see
  `worker/app.py`'s existing `heartbeat(timestamp: int)`) *is* the slot; never recompute it from
  `observed_at` via a window query.
- **`ON CONFLICT DO NOTHING` on the mark tables.** Blocks every corrective backfill and every
  gap-heal past the first write (`L005`). This phase's whole reason to exist is healing gaps —
  `DO NOTHING` here reproduces the exact production bug this phase cites as its own justification.
- **Keying a snapshot row by `occ_symbol` instead of `leg_id`.** A trader can re-enter a closed
  contract in a new position later; two different `Leg` rows can share one `occ_symbol` over the
  system's lifetime. Keying by `occ_symbol` would silently collide two positions' history onto one
  key — the same shape of bug `L001`/`L002` catalog at length, just with a different discriminator
  missing. `leg_id` is a UUID, globally unique per leg, and already carries `root` on the `legs`
  row (Phase 7) — no separate `root` column is needed in the snapshot key for this reason.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RTH slot / DST arithmetic | A custom EST/EDT offset table | `zoneinfo.ZoneInfo("America/New_York")`, same as `settlements.py`'s `_EASTERN` constant | Two fixed offsets is wrong roughly half the year and was already rejected once in this codebase (`settlements.py`'s own comment, `D7-08`'s reasoning applies identically here). |
| Half-day / holiday calendar | A hand-maintained market-calendar table or a new dependency | Nothing — see "RTH slot enumeration and DST" below | The gap semantics (`SNAP-02`) already make "no data for this slot" a correctly-representable, honest state. A half-day where the market closes at 13:00 ET naturally produces `no_market_data` gaps for the 13:30-16:00 slots with zero special-casing. Building a calendar to *avoid* those honest gaps would violate `L041`'s whole point. |
| Detecting a stalled job vs. a real vendor outage | Ad-hoc heuristics on gap density | `snapshot_runs` (`D8-15`), the same shape `L042` names as the actual fix | A count of `no_market_data` gaps alone cannot distinguish "market genuinely had nothing" from "the job silently stopped." A `snapshot_runs` row proving the job *ran* at all is the only thing that resolves the ambiguity — this is `L042`'s exact mechanism. |
| Money/quantity encryption | A second AESGCM key scheme for this phase's two new tables | The existing per-user DEK envelope (`crypto/envelope.py`'s `encrypt_field`/`decrypt_field`, `_current_dek`) | Every money-bearing column in this schema already goes through this one path; a second scheme is a second thing to audit for no benefit. |

**Key insight:** every "don't hand-roll" item in this phase is something this codebase has already
built once, correctly, in an earlier phase. The discipline for Phase 8 is recognising the reuse,
not inventing a variant.

## Common Pitfalls

### Pitfall 1: Sending the unpadded internal `occ_symbol` to `get_quotes`

**What goes wrong:** `get_quotes(["SPXW260321P07575000"])` — no space padding — either returns no
match for that symbol, or (worse) silently matches nothing and the response comes back with the
symbol simply absent, which a naive parser reads as `no_market_data` for every single slot,
forever, with the job reporting SUCCESS the whole time.

**Why it happens:** this project's own OCC convention (`ledger/pairing.py`) was designed for
internal storage and fill-matching, not as a wire format — nothing about it needed to match
Schwab's own symbol grammar until this phase.

**How to avoid:** the `to_schwab_wire_symbol` codec above, unit-tested round-trip against
`parse_occ_symbol`, and a live smoke test against one real open position before trusting the
cadence in production (this project's own `workflow.md`: verify against the thing itself).

**Warning signs:** `snapshot_runs` showing `marks_written: 0` and `gaps_no_market_data: N` (N =
every open leg) on every single run, with no errors logged — this is `L043`'s exact "logs nothing
useful" failure mode, and it is the single most likely first-week symptom of this pitfall.

### Pitfall 2: A worker restart silently drops more than the intended slot

**What goes wrong:** `PeriodicDeferrer` [VERIFIED: `.venv/lib/python3.13/site-packages/procrastinate/periodic.py:151-198`]
only backfills the single most recent missed tick, and only if it is under ten minutes old
(`MAX_DELAY = 60 * 10`, `periodic.py:22`). A worker down for 25 minutes across two 30-minute RTH
slot boundaries gets **zero** jobs deferred for either missed slot on restart — not one, not a
gap-row-producing job, none at all — because `get_timestamps`'s `since is None` branch (the
process-restart case) computes `delay = until - timestamp` against only the single most recent
scheduled tick, and returns nothing if that delay already exceeds ten minutes.

**Why it happens:** `last_defers` (the dict that tracks "how far have I already caught up") lives
only in the running process's memory, not in the database. A process restart resets it to empty,
which is indistinguishable, from Procrastinate's own point of view, from "this cron was just
registered for the first time."

**How to avoid:** this phase cannot fix Procrastinate's own behavior, and should not try to. What
it can do: make the absence observable. A `snapshot_runs` row exists only for slots the job
actually fired for; a monitoring/read-model query (not in this phase's own scope, but worth
naming for the plan) comparing "expected RTH slots since the last known `snapshot_runs` row" against
"actual `snapshot_runs` rows" is what surfaces this class of loss — the same principle `L042`
names, extended to a scheduler-level gap rather than a per-item one.

**Warning signs:** a `snapshot_runs` gap wider than 30 minutes between consecutive rows for an
otherwise-connected user, with no corresponding `FAILED` row.

### Pitfall 3: A batch `get_quotes` HTTP failure isolated at the wrong grain

**What goes wrong:** `get_quotes` is one HTTP call for a whole user's open legs (`D8-03`). If that
one call raises (network error, `429`, `5xx`), naive code either (a) crashes the whole periodic
fan-out for every user, or (b) silently skips writing anything for the failed user's legs this
slot, leaving them as an absent row rather than an honest gap.

**Why it happens:** the failure isolation this phase needs operates at two different grains
simultaneously — per-user (one user's vendor call failing must not abort other users' captures)
and per-symbol (one malformed element inside an otherwise-successful response must not abort the
other legs in that same response) — and it is easy to build only one of the two.

**How to avoid:** mirror `sync_user_task`'s own two-grain handling exactly: catch the whole-call
exception at the per-user task boundary (write the user's `snapshot_runs` row as `FAILED`,
consider writing a per-leg gap for that user's slot so it never reads as "position did not exist,"
mirroring criterion 5's own reasoning beyond just the `connection_expired` case it names
explicitly — flag this as an open question for the plan/discuss step, see Open Questions below);
catch per-symbol parse failures inside `parse_quote_payload` itself, which already never raises by
design (`D8-16`).

**Warning signs:** a test that only exercises "the vendor call succeeds and one symbol is
malformed" and never exercises "the vendor call itself raises" has not proven `D8-16`.

### Pitfall 4: Treating `L001`'s "single literal value" trap as resolved because `leg_id` is used

**What goes wrong:** believing `(leg_id, slot_time)` is self-evidently sufficient because
`leg_id` is a UUID, without checking whether `user_id` needs to be *part of the unique
constraint* rather than merely a denormalized column.

**Why it happens:** every other user-scoped table in this schema denormalizes `user_id` for RLS
convenience, and it is easy to reflexively fold it into the composite key too, "for safety,"
without checking whether it changes the discrimination at all.

**How to avoid:** it doesn't need to. `leg_id` already functionally determines `user_id` (a leg
belongs to exactly one position, which belongs to exactly one user — enforced by the existing FK
chain, Phase 7). Including `user_id` in the unique index adds no discrimination and is not the
kind of hidden single-value trap `L001`/`L002` warn about (those were about a column that *should*
discriminate but silently doesn't, e.g. `root` — here `user_id` genuinely doesn't need to
discriminate, because `leg_id` already does the whole job). Keep `user_id` as a denormalized,
non-unique column for RLS, matching `legs`' own `UniqueConstraint("position_id", "leg_role")`,
which also omits `user_id` for the identical reason.

## Code Examples

### The migration shape (mirrors `alembic/versions/0012_sync_runs.py` exactly)

```python
# Source: this codebase's own 0012_sync_runs.py, read this session, adapted.
revision = "0015"
down_revision = "0014"

def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "snapshot_observations",
        sa.Column("id", _UUID, primary_key=True, server_default=_GEN_UUID),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("leg_id", _UUID, sa.ForeignKey("legs.id"), nullable=False),
        sa.Column("slot_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("gap_reason", sa.Text(), nullable=True),
        sa.Column("raw_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("raw_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("key_version", sa.SmallInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "gap_reason IN ('no_market_data', 'connection_expired', 'fetch_error')",
            name="snapshot_observations_gap_reason_check",
        ),
        sa.UniqueConstraint("leg_id", "slot_time", name="snapshot_observations_leg_slot_key"),
    )
    op.create_index(
        "ix_snapshot_observations_user_id_slot_time",
        "snapshot_observations", ["user_id", sa.text("slot_time DESC")],
    )
    # GRANT SELECT, INSERT, UPDATE ON snapshot_observations TO morai_app --
    # UPDATE is required here, unlike sync_runs/broker_transactions, because
    # this table's own asymmetric upsert (D8-10) IS an UPDATE path, not an
    # append-only or DO-NOTHING one.
    # ENABLE + FORCE RLS, FOR ALL policy, identical body to every prior
    # user-scoped table in this schema (V092).
    ...  # snapshot_marks table: identical shape, mark_ciphertext/mark_nonce/
         # spot_ciphertext/spot_nonce instead of raw_ciphertext/raw_nonce.
         # snapshot_runs table: copy 0012_sync_runs.py's body near-verbatim,
         # swapping fills_landed/broker_transactions_landed for
         # positions_attempted/marks_written/gaps_by_reason (jsonb or three
         # int columns -- Claude's Discretion, D8-15) and adding no new
         # constraint beyond the existing trigger/status CHECKs.
```

Bind-parameter arithmetic (`NN-5`, mirroring `0011_broker_transactions.py`'s own worked
example): `snapshot_marks` at roughly 9 columns per row gives `floor(65534 / 9) = 7281` rows per
statement before the Postgres bind-parameter cap; the existing `_CHUNK_SIZE = 2000` convention
sits at about a quarter of that ceiling, same margin the fills/broker_transactions writers already
carry. Reuse `_CHUNK_SIZE = 2000` unchanged (`NN-5`).

## State of the Art

| Old Approach (v1) | Current Approach (this phase) | When Changed | Impact |
|--------------------|-------------------------------|---------------|--------|
| Live-write-only snapshot pipeline, no raw layer | Raw observations stored independently, marks derived and rebuildable | This phase, by design (`D8-01`, `L039`) | An outage or a parsing bug is repairable rather than permanent. |
| Gap defined by sentinel (`spot = "0"` or non-finite greek) | Gap defined by `mark_usd IS NULL` + non-null `gap_reason`, pinned once in a `CHECK` constraint and one pure function | This phase (`D8-09`, `L041`) | "Is this row a gap" is a single, database-enforced predicate, not a convention every read site has to remember. |
| `ON CONFLICT DO NOTHING` self-heal writer | Asymmetric `DO UPDATE ... WHERE` | This phase (`D8-10`, `L005`/`L020`) | Corrective backfills and gap-heals both work; a real value is still protected from a later gap. |
| Half-open window slot resolution | Trigger-assigned slot, `observed_at` stored separately | This phase (`D8-05`, `L048`) | Removes the entire class of bug where an observation just before the anchor is orphaned. |
| No job-liveness signal separate from data | `snapshot_runs`, mirroring `sync_runs` | This phase (`D8-15`, `L042`) | A stalled job is now distinguishable from a real vendor outage by inspection, not inference. |

**Deprecated/outdated:** nothing in this project's own history is being carried forward
unchanged here — every v1 pattern this phase touches (`L039`-`L043`, `L048`, `L001`/`L002`,
`L005`/`L020`) is explicitly the *rejected* prior approach, replaced by the locked decisions above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `get_quotes`'s OPTION response carries `quote.mark` and `quote.underlyingPrice` at those exact paths | Pattern 1 (parse_quote_payload) | LOW as designed — the function degrades to `no_market_data` rather than raising, so a wrong field name produces loud, correct gaps on first live run (see Pitfall 1's warning signs), not silent wrong data. Confirm against one real captured payload before trusting the cadence unattended. |
| A2 | Schwab's `/marketdata/v1/quotes` has no documented hard cap on symbol count per request | Standard Stack / Architecture | MEDIUM — an account with several open calendars could send 4-10 symbols per call, well under any plausible cap; no source this session confirmed a specific number, secondary sources only describe the parameter shape, not a limit. If a live call 400s on a large batch, split per-position rather than per-user as a fallback (`P020`'s own discipline: check the wire before guessing). |
| A3 | A whole-call `get_quotes` failure should still write a per-leg gap row for that user/slot (extending criterion 5's `connection_expired` reasoning to an unexpected mid-cycle vendor failure) | Pitfall 3 | MEDIUM — if wrong, the alternative (no row at all, relying solely on `snapshot_runs`' `FAILED` record) is also defensible and matches how `sync_user_task` itself already handles a whole-run failure. Flagged explicitly as an open question for `/gsd-discuss-phase` or the planner to settle, not silently assumed into the plan. |
| A4 | Rate limit cited by secondary (non-Schwab) sources — 120 requests/minute — applies to `GET /marketdata/v1/quotes` and not only to order-mutating endpoints | Don't Hand-Roll / general | LOW — this phase's own cadence (one call per connected user per 30 minutes) is far under any plausible interpretation of that figure even at dozens of users; not load-bearing for the plan, but not verified against an authoritative Schwab source this session either. |

## Open Questions

1. **Does a whole-`get_quotes`-call failure (not `connection_expired`) still write a per-leg gap
   row, or only a `snapshot_runs` FAILED record?**
   - What we know: `D8-14` names `connection_expired` explicitly; `D8-16` requires per-item
     isolation for what it calls "one failing position-leg-slot."
   - What's unclear: whether "per-item isolation" was meant to cover a batch-call-level failure
     (all of one user's legs at once) or only a per-symbol parse failure within an otherwise
     successful response.
   - Recommendation: resolve explicitly in planning/discuss, not by silent default — see
     Assumption A3.

2. **Exact `get_quotes` OPTION response schema.**
   - What we know: the request shape (`schwab-py` source, verified); that Schwab's own quote
     envelope carries an `assetMainType` discriminator and, per multiple independent secondary
     sources, `bidPrice`/`askPrice`/`mark` fields under a `quote` object for options.
   - What's unclear: the exact field for "no market data" (a missing key? a `null` value? a
     top-level `errors`/`invalidSymbols` bucket, as some community client libraries model?) —
     no official-docs fetch this session confirmed it directly.
   - Recommendation: the lenient, never-raising `parse_quote_payload` design already absorbs this
     uncertainty; treat the first live capture as the actual verification, and update this
     research's Assumption A1 once observed (same honest-limit discipline `schwab_sync.py`'s own
     docstring already models for `get_transactions`).

## Environment Availability

No new external dependency. Postgres, the `morai_app` role, and the deployed worker service
(Phase 6) are the only infrastructure this phase needs, and all three are already provisioned —
see `STATE.md`'s Phase 6 deferred-verification note (worker's `MORAI_APP_DB_PASSWORD` requirement,
already satisfied by Phase 6's own work). This phase adds no new environment requirement beyond
what Phase 6 already established for the worker process.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 [reused from prior phases], `pytest-asyncio` (`asyncio_mode = "auto"`, session-scoped loop) [VERIFIED: `pyproject.toml:86-99`] |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `uv run pytest tests/ingest/test_snapshot_capture.py -q` (per-file, ~1-2s once written) |
| Full suite command | `uv run pytest -q` (~13s including DB-marked tests, per `CLAUDE.md`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SNAP-01 | Every open position gets a mark row per RTH slot; a non-RTH tick writes nothing | unit + db | `uv run pytest tests/ingest/test_snapshot_capture.py -x` | ❌ Wave 0 |
| SNAP-02 | No market data → `mark_usd IS NULL` + `gap_reason` set, never a fabricated value | unit | `uv run pytest tests/ingest/test_snapshot_parse_quote_payload.py -x` | ❌ Wave 0 |
| SNAP-03 | Real observation heals a gap; a gap never overwrites a real observation | db | `uv run pytest tests/ingest/test_snapshot_gap_upsert.py -x -m db` | ❌ Wave 0 |
| SNAP-04 | `repair_snapshot_marks` rebuilds marks from stored raw observations, with no vendor call, via both task and CLI | db | `uv run pytest tests/ingest/test_snapshot_repair.py -x -m db` | ❌ Wave 0 |
| SNAP-05 | Expired connection → gap row with `gap_reason=connection_expired`, no vendor call attempted | db | `uv run pytest tests/ingest/test_snapshot_capture.py::test_expired_connection_writes_gap -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the single relevant test file (`-x`, fail fast).
- **Per wave merge:** `bash tools/gate.sh` (ruff + basedpyright + mypy + full pytest).
- **Phase gate:** full suite green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/ingest/test_snapshot_wire_symbol_codec.py` — round-trips `to_schwab_wire_symbol` against
      `parse_occ_symbol`, covering both `SPX` and `SPXW` padding (Pitfall 1).
- [ ] `tests/ingest/test_snapshot_parse_quote_payload.py` — covers SNAP-02: missing symbol, missing
      `quote` object, missing `mark`, and a fully-populated element.
- [ ] `tests/ingest/test_snapshot_gap_upsert.py` — covers SNAP-03: the four-cell truth table (real
      over nothing, real over gap, gap over nothing, gap-blocked-by-real) directly against Postgres,
      mirroring `test_roll_check_constraint.py`'s own database-level-guard test discipline.
- [ ] `tests/ingest/test_snapshot_capture.py` — covers SNAP-01/SNAP-05: the shell, connection-health
      branch, per-user isolation.
- [ ] `tests/ingest/test_snapshot_repair.py` — covers SNAP-04: task and CLI both call the same
      function; a repair run with no vendor client available still succeeds.
- [ ] Framework install: none — pytest/pytest-asyncio already configured project-wide.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This phase adds no new auth surface — it runs inside the existing worker process under the existing `morai_app` role. |
| V3 Session Management | No | No HTTP session touches this phase. |
| V4 Access Control | Yes | RLS `FOR ALL user_isolation` policy on both new tables, `ENABLE`+`FORCE`, identical body to every existing user-scoped table (`V092`); `assert_connection_cannot_bypass_rls` called before any protected write, mirroring `sync_user_task` exactly. |
| V5 Input Validation | Yes | `parse_quote_payload` never trusts vendor JSON shape; every derived field is `Optional`, `extra="ignore"` where a Pydantic model is used at the boundary — same discipline `schwab_sync.py`'s `_Instrument` already establishes. |
| V6 Cryptography | Yes | Raw payload, `mark_usd`, `spot_usd` encrypted under the existing per-user AESGCM DEK envelope (`crypto/envelope.py`) — never a new key domain, never hand-rolled. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A vendor error message logged verbatim, potentially carrying a token or account identifier | Information Disclosure | `classify_sync_error`'s own precedent (`ingest/sync_runs.py`) — classify by exception type/status code only, never log `str(exc)` verbatim; reuse the same `SyncError`-style enum shape for a new `SnapshotError` if the writer task needs its own failure classification. |
| A cross-tenant read in the fan-out step used to also write, bypassing RLS | Elevation of Privilege | Mirror `sync_all_connected_users_task`'s own strict split: the superuser-engine read is listing-only, never a write; every write happens inside a subsequent `morai_app` + `set_config` session, exactly as Phase 6's own security finding (`STATE.md`'s Phase 6 note) already established and the worker now enforces via `assert_connection_cannot_bypass_rls`. |
| A malformed vendor payload causing an unhandled exception that aborts the whole periodic sweep | Denial of Service (self-inflicted) | `parse_quote_payload`'s never-raise design (`D8-16`), plus per-user isolation at the task boundary (Pitfall 3). |

## Sources

### Primary (HIGH confidence — read directly this session)

- `.venv/lib/python3.13/site-packages/schwab/client/base.py:477-503` — `get_quotes` request shape.
- `.venv/lib/python3.13/site-packages/schwab/orders/options.py:20-58` — Schwab's real OCC wire
  symbol format (space-padded root to six characters), with worked examples.
- `.venv/lib/python3.13/site-packages/procrastinate/periodic.py:1-275`, full file — `PeriodicDeferrer`
  behavior on worker restart, `MAX_DELAY = 60 * 10`.
- `src/morai/worker/app.py`, `src/morai/ledger/positions.py`, `src/morai/vendor/connections.py`,
  `src/morai/ingest/sync_runs.py`, `src/morai/ingest/schwab_sync.py`, `src/morai/ledger/fills.py`,
  `src/morai/ledger/settlements.py`, `src/morai/ledger/pairing.py` (OCC regex/parse),
  `src/morai/db/models.py` (`Leg`/`Position`), `alembic/versions/0011_broker_transactions.py`,
  `alembic/versions/0012_sync_runs.py`, `tests/gate/test_ledger_write_boundary.py`,
  `tests/vendor/conftest.py` — every established pattern this phase reuses.
- `docs/learnings/LAWS.md` — `L001`, `L002`, `L004`, `L005`, `L006`, `L007`, `L020`, `L039`-`L043`,
  `L048` — full text read this session.
- `docs/learnings/vendors-and-infra.md` — `V003`-`V005`, `V009`, `V014`, `V015`.
- `.planning/config.json`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `pyproject.toml`.

### Secondary (MEDIUM confidence)

- WebSearch results describing Schwab's general `assetMainType`/`quote` response envelope shape
  for OPTION quotes (`bidPrice`/`askPrice`/`mark`), corroborated across several independent
  unofficial client libraries but not fetched from `developer.schwab.com` directly this session
  (that endpoint requires an authenticated developer account).

### Tertiary (LOW confidence — flagged for validation)

- The specific `120 requests/minute` rate-limit figure — cited by several unofficial sources, not
  cross-checked against an authoritative Schwab source this session, and possibly specific to
  order-mutating endpoints rather than market-data GETs (Assumption A4).
- Exact OPTION quote field names beyond `mark`/`underlyingPrice`/`assetMainType` (Assumption A1,
  Open Question 2).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every version verified live against the installed
  environment this session.
- Architecture: HIGH — every pattern this phase reuses was read from this codebase's own source
  this session, not recalled from training data.
- Vendor response schema (`get_quotes` for OCC options): LOW — never called live in this project;
  no authoritative fetch succeeded this session. Mitigated by design (raw storage + lenient parse).
- Pitfalls: HIGH for the ones sourced from this project's own `docs/learnings/` and from reading
  `procrastinate`'s own source; MEDIUM for the vendor-schema-dependent ones.

**Research date:** 2026-09-01
**Valid until:** 30 days for the internal-pattern findings (stable, this codebase's own
conventions); effectively until first live capture for the vendor-schema findings (Assumption A1) —
re-verify against the actual first payload rather than waiting out a calendar window.
