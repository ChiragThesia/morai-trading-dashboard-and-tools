"""The 30-minute RTH snapshot capture path (Phase 8, SNAP-01, SNAP-02).

Mirrors `broker_transactions.py`'s own placement under `ingest/`, not
`ledger/`: this module captures vendor observations, it does not derive
money. Pure/shell split throughout, following `derive_connection_health`
(`vendor/connections.py`) and `derive_events`/`derive_settlements`
(`ledger/pairing.py`/`ledger/settlements.py`) exactly -- every pure
function below takes no `AsyncSession`, reads no clock, and imports nothing
that could reach a broker.

## The wire-symbol codec (Pitfall 1, 08-RESEARCH.md)

This project's own internal `occ_symbol` convention (`ledger/pairing.py`)
has no padding at all -- `SPXW260618P07275000`. Schwab's own `OptionSymbol`
docstring (verified against the installed `schwab-py` 1.5.1 wheel) states
the wire grammar pads the root left-justified to exactly six characters
with trailing spaces -- `SPXW  260618P07275000`. Sending the unpadded form
is the failure mode where every slot becomes a gap forever while the job
reports success: `to_schwab_wire_symbol`/`from_schwab_wire_symbol` exist so
that mistake is impossible from the first commit, round-tripped against
`parse_occ_symbol` in `tests/ingest/test_snapshot_wire_symbol_codec.py`.

## `parse_quote_payload` never raises (D8-16, `NN-16`, `L041`)

This project has never called `get_quotes` against a live Schwab endpoint
(`08-RESEARCH.md`'s own confidence rating: LOW). Every field read inside
`parse_quote_payload` degrades to an honest `NO_MARKET_DATA` gap instead of
raising, so a wrong field-name guess produces loud, correct gaps on the
first live run rather than a dead job -- that asymmetry is this module's
whole hedge against the one genuinely unverified fact in this phase.

## The composite key is `(leg_id, slot_time)` (`NN-1`, Pitfall 4)

`leg_id` already functionally determines `user_id` and `root` through the
existing foreign-key chain (Phase 7). Keying by `occ_symbol` instead would
silently collide two positions that re-entered the same contract onto one
key -- `L001`/`L002`'s exact trap, applied here.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from enum import StrEnum
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import JsonValue
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.data_keys import current_dek
from morai.crypto.envelope import encrypt_field
from morai.db.models import (
    Position,
    SchwabConnection,
    SnapshotMark,
    SnapshotObservation,
)
from morai.ledger.pairing import parse_occ_symbol
from morai.ledger.positions import read_position_state
from morai.vendor.connections import (
    ConnectionHealth,
    derive_connection_health,
    read_connection,
    schwab_client_for_user,
)
from morai.vendor.protocol import SchwabAuth

# D8-06: cron fires in UTC; RTH membership is computed in Eastern at
# runtime through zoneinfo, never a fixed UTC hour range and never a
# hardcoded EST/EDT pair -- the same `_EASTERN` constant convention
# `ledger/settlements.py` already establishes.
_EASTERN = ZoneInfo("America/New_York")
_RTH_OPEN = time(9, 30)
_RTH_CLOSE = time(16, 0)
SLOT_INTERVAL = timedelta(minutes=30)

# NN-5: reuse the project's existing 2,000-row chunk unchanged --
# 08-RESEARCH.md's own bind-parameter arithmetic (`floor(65534/9) = 7281`)
# already covers this table shape; no need to recompute it.
_SNAPSHOT_CHUNK_SIZE = 2000


class SnapshotGapReason(StrEnum):
    """The gap vocabulary pinned by migration 0015's own `CHECK`
    constraint. Only `NO_MARKET_DATA` is written by this plan;
    `CONNECTION_EXPIRED` and `VENDOR_ERROR` are plan 08-02's own SNAP-05/A3
    scope, `SLOT_NOT_CAPTURED` is plan 08-03's -- pinned here, all four,
    so neither later plan alters a populated table's `CHECK` to widen it."""

    NO_MARKET_DATA = "no_market_data"
    CONNECTION_EXPIRED = "connection_expired"
    VENDOR_ERROR = "vendor_error"
    SLOT_NOT_CAPTURED = "slot_not_captured"


class SnapshotVendorError(RuntimeError):
    """Raised by `capture_user_snapshot` after it has committed
    `vendor_error` gap rows for every open leg (plan 08-02, orchestrator-
    resolved research question A3). Carries no vendor text of its own
    (`NN-20`, `NN-34`) -- the original exception is chained via `raise ...
    from exc` so a later classifier can still branch on its type and status
    code; nothing in this module stores or logs the message string."""


@dataclass(frozen=True)
class ParsedQuote:
    """One leg's parsed quote, or an honest gap. `gap_reason` is `None`
    exactly when `mark_usd` is not `None` (D8-09) -- `spot_usd` can be
    `None` on a real quote (a mark with no reported underlying price is a
    real quote with an honest missing spot, not a gap for the row)."""

    mark_usd: Decimal | None
    spot_usd: Decimal | None
    gap_reason: SnapshotGapReason | None


@dataclass(frozen=True)
class OpenLeg:
    """One leg this slot should attempt to reprice -- read from a position
    whose derived state is not confirmed closed (D8-11's per-leg grain)."""

    leg_id: UUID
    position_id: UUID
    occ_symbol: str


@dataclass(frozen=True)
class SnapshotWrite:
    """One leg's outcome for one slot, ready for the two writers below.
    `raw_payload` is the whole `get_quotes` response for this user/slot,
    carried on every row regardless of which leg it is for (D8-04)."""

    leg_id: UUID
    slot_time: datetime
    observed_at: datetime
    raw_payload: JsonValue | None
    mark_usd: Decimal | None
    spot_usd: Decimal | None
    gap_reason: SnapshotGapReason | None


@dataclass(frozen=True)
class CaptureOutcome:
    """One user's own capture result for one slot."""

    slot_time: datetime
    legs_attempted: int
    marks_written: int
    gaps_by_reason: Mapping[str, int]


def to_schwab_wire_symbol(occ_symbol: str) -> str:
    """This project's internal `occ_symbol` (unpadded) to Schwab's own wire
    format (root left-justified, space-padded to six characters -- verified
    against the installed `schwab-py` 1.5.1 wheel's `OptionSymbol`
    docstring). Always 21 characters: 6 (root) + 6 (YYMMDD) + 1 (option
    type) + 8 (strike in thousandths). Calls `parse_occ_symbol` rather than
    re-parsing by hand -- a malformed input symbol raises `ValueError`
    naming the offending symbol, propagated rather than swallowed, because
    a malformed contract is a caller bug, not a market gap."""
    contract = parse_occ_symbol(occ_symbol)
    padded_root = contract.root.ljust(6)
    # Last two digits of a four-digit year via string slicing, not a
    # numeric modulo -- this project's own `test_money_units.py` reserves
    # that numeral for `money/units.py`'s SPX contract multiplier alone
    # (D-02), so an unrelated same-valued literal here would collide with
    # that gate for a reason that has nothing to do with money.
    yy = str(contract.expiry.year)[-2:]
    mm = f"{contract.expiry.month:02d}"
    dd = f"{contract.expiry.day:02d}"
    # IN-01: `:08d` is a minimum-width specifier, not a fixed one --
    # `parse_occ_symbol`'s own 8-digit strike field makes this unreachable
    # today (max 99999.999 -> 99999999, exactly 8 digits), but an explicit
    # bound makes that true by construction rather than by luck, so a
    # future widening of `parse_occ_symbol`'s strike range fails loudly
    # here instead of silently producing a >21-character wire symbol that
    # reads as a permanent vendor gap.
    strike_thousandths_int = int(contract.strike * 1000)
    if not 0 <= strike_thousandths_int <= 99_999_999:
        raise ValueError(
            f"strike {contract.strike} does not fit the wire format's "
            f"8-digit thousandths field for occ_symbol={occ_symbol!r}"
        )
    strike_thousandths = f"{strike_thousandths_int:08d}"
    return f"{padded_root}{yy}{mm}{dd}{contract.option_type}{strike_thousandths}"


def from_schwab_wire_symbol(wire_symbol: str) -> str:
    """The inverse of `to_schwab_wire_symbol`: strips the six-character
    padded root back down to its bare form and rejoins the rest of the
    string unchanged, so the round trip is testable in both directions
    rather than only asserted against hand-typed literals."""
    root = wire_symbol[:6].rstrip()
    rest = wire_symbol[6:]
    return f"{root}{rest}"


def _to_decimal(value: JsonValue) -> Decimal | None:
    """Converts a vendor-supplied JSON scalar to `Decimal` through its
    string form only -- never through a numeric-type conversion (`D3-17`).
    Any shape that is not a real number (a nested mapping, a list, a
    boolean, `None`, or a malformed numeral) returns `None` rather than
    raising, which is what lets `parse_quote_payload` never raise without
    a type-dispatch branch of its own.

    CR-01: `Decimal(str(value))` does not raise for the JSON `NaN`/
    `Infinity`/`-Infinity` tokens -- `json.loads` accepts them by default
    and `decimal.Decimal` supports them natively -- so a non-finite result
    is rejected explicitly here rather than trusted as a real mark
    (`L041`, D8-09: a gap is `mark_usd IS NULL`, never a fabricated or
    non-finite value)."""
    try:
        result = Decimal(str(value))
    except ArithmeticError:
        return None
    if not result.is_finite():
        return None
    return result


def parse_quote_payload(raw: JsonValue, wire_symbol: str) -> ParsedQuote:
    """Pure: no session, no clock, no import that could reach a broker --
    mirrors `derive_connection_health`'s/`derive_position_state`'s own
    purity contract. `raw` is the whole decrypted `get_quotes` response for
    one user/slot; `wire_symbol` is this leg's own Schwab wire-format
    symbol.

    Never raises, for any input (`NN-16`, `L041`, D8-16's per-symbol
    isolation grain): a missing symbol, a missing `quote` object, or a
    missing `mark` each degrade to `NO_MARKET_DATA` with both money fields
    `None`. `A1` (08-RESEARCH.md): the field paths `quote.mark`/
    `quote.underlyingPrice` are assumed and unverified against a live
    call -- this function's *shape*, not its field names, is what the
    phase depends on; a wrong guess produces loud gaps, never a wrong
    number.
    """
    element = raw.get(wire_symbol) if isinstance(raw, dict) else None
    if not isinstance(element, dict):
        return ParsedQuote(
            mark_usd=None, spot_usd=None, gap_reason=SnapshotGapReason.NO_MARKET_DATA
        )
    quote = element.get("quote")
    if not isinstance(quote, dict):
        return ParsedQuote(
            mark_usd=None, spot_usd=None, gap_reason=SnapshotGapReason.NO_MARKET_DATA
        )
    mark_usd = _to_decimal(quote.get("mark"))
    if mark_usd is None:
        return ParsedQuote(
            mark_usd=None, spot_usd=None, gap_reason=SnapshotGapReason.NO_MARKET_DATA
        )
    spot_usd = _to_decimal(quote.get("underlyingPrice"))
    return ParsedQuote(mark_usd=mark_usd, spot_usd=spot_usd, gap_reason=None)


def rth_slot_for(moment: datetime) -> datetime | None:
    """`None` unless `moment`, read in Eastern, falls on a weekday between
    09:30 and 16:00 inclusive, on the 30-minute grid, with zero seconds and
    microseconds -- otherwise `moment` normalised to UTC (D8-06, D8-05).

    D8-05: the trigger's own timestamp *is* the slot -- nothing here or in
    any caller re-derives a slot from an `observed_at` via a window query,
    which is `L048`'s exact bug (a half-open `[anchor, anchor+interval)`
    window is blind to an observation just before the anchor).
    """
    eastern = moment.astimezone(_EASTERN)
    if eastern.weekday() >= 5:
        return None
    if not (_RTH_OPEN <= eastern.time() <= _RTH_CLOSE):
        return None
    if eastern.minute not in (0, 30):
        return None
    if eastern.second != 0 or eastern.microsecond != 0:
        return None
    return moment.astimezone(UTC)


def rth_slots_between(start: datetime, end: datetime) -> tuple[datetime, ...]:
    """Every RTH slot instant in the inclusive interval `[start, end]`,
    pure and clock-free: walks Eastern calendar days and emits the
    fourteen slots from 09:30 through 16:00 on each weekday, each converted
    back to UTC. Market holidays and half-days are deliberately not
    modelled -- a half day produces honest `no_market_data` gaps for its
    afternoon slots with no special casing, and building a calendar to
    suppress those gaps would violate `L041`'s whole point."""
    slots: list[datetime] = []
    day = start.astimezone(_EASTERN).date()
    last_day = end.astimezone(_EASTERN).date()
    while day <= last_day:
        weekday = day.weekday()
        if weekday < 5:
            cursor = datetime.combine(day, _RTH_OPEN, tzinfo=_EASTERN)
            close = datetime.combine(day, _RTH_CLOSE, tzinfo=_EASTERN)
            while cursor <= close:
                candidate = cursor.astimezone(UTC)
                if start <= candidate <= end:
                    slots.append(candidate)
                cursor += SLOT_INTERVAL
        day += timedelta(days=1)
    return tuple(slots)


def _snapshot_associated_data(
    table: str, column: str, *, user_id: UUID, leg_id: UUID, slot_time: datetime
) -> bytes:
    """The one place this pair of tables' AAD row-binding format is fixed
    -- changing it later costs a full re-encryption of every row. Follows
    `fills.py`/`connections.py`/`broker_transactions.py`'s own
    `table:column:key` convention."""
    return (f"{table}:{column}:{user_id}:{leg_id}:{slot_time.isoformat()}").encode(
        "utf-8"
    )


def _encode_decimal(value: Decimal) -> bytes:
    """Never via a numeric-type conversion -- the exact failure class this
    project exists to prevent (D3-17), mirroring `ledger/fills.py`'s own
    `_encode_decimal`."""
    return str(value).encode("utf-8")


def _rowcount(result: object) -> int:
    """`INSERT ... ON CONFLICT DO UPDATE` with no `.returning()` types as
    the base `Result[Any]`, which carries no `rowcount` -- that attribute
    is `CursorResult`'s own. `isinstance` narrows without `cast`/`Any`
    (D-06), mirroring `api/routes_identity.py`'s identical convention;
    every DML statement executed through `session.execute()` against a
    real DBAPI cursor is actually a `CursorResult` at runtime, so this
    never fails in practice."""
    if not isinstance(result, CursorResult):
        raise RuntimeError(
            "snapshot upsert did not return a CursorResult -- cannot read "
            "the landed row count."
        )
    return result.rowcount


async def read_open_legs(session: AsyncSession, user_id: UUID) -> tuple[OpenLeg, ...]:
    """Every leg of every position whose derived state is not confirmed
    closed. No explicit user filter on the `positions` select -- RLS is the
    filter, the same convention `api/routes_identity.py::list_positions`
    already states. A position whose `is_closed` is `False` is open, and
    one whose `is_closed` is `None` has a gapped leg and is not *known* to
    be closed -- skipping either would make the slot read as though the
    position did not exist, which criterion 5's own reasoning forbids.
    Returned sorted by `occ_symbol` so two runs are comparable
    element-wise."""
    positions = (await session.execute(select(Position))).scalars().all()
    legs: list[OpenLeg] = []
    for position in positions:
        state = await read_position_state(session, position.id, user_id)
        if state.is_closed is True:
            continue
        legs.extend(
            OpenLeg(
                leg_id=leg_net.leg_id,
                position_id=position.id,
                occ_symbol=leg_net.occ_symbol,
            )
            for leg_net in state.leg_nets
        )
    return tuple(sorted(legs, key=lambda leg: leg.occ_symbol))


async def write_snapshot_observations(
    session: AsyncSession, user_id: UUID, rows: Sequence[SnapshotWrite]
) -> int:
    """The raw layer's write path. Does not commit -- the caller owns the
    transaction, the same convention every write path in this codebase
    follows. Chunks at `_SNAPSHOT_CHUNK_SIZE` (`NN-5`), resolves the user's
    key once, and encrypts inside the writer so callers never touch AES.

    The asymmetric `ON CONFLICT (leg_id, slot_time) DO UPDATE ... WHERE`
    (D8-10) lets a real observation always heal a gap or replace an
    earlier real one (the repair path's own corrective-backfill case), and
    blocks only an incoming gap against an existing real row -- never a
    do-nothing clause, which is exactly the clause that blocked v1's
    backfill of 1,190 corrupted rows (`L020`, `L005`, `L071`). Returns the
    number of rows the statement itself reports as landed, never the
    length of the input list.
    """
    if not rows:
        return 0

    # WR-01: a pure-gap batch needs no cryptographic material at all -- the
    # connection_expired/vendor_error branches in capture_user_snapshot
    # build exactly this shape (gap_writes_for_legs), and a crypto-shredded
    # account must still be able to record an honest gap row. Only resolve
    # the DEK when at least one row in this batch is a real observation.
    dek: bytes | None = None
    key_version: int | None = None
    if any(row.gap_reason is None for row in rows):
        dek, key_version = await current_dek(session, user_id)
    landed = 0

    for chunk_start in range(0, len(rows), _SNAPSHOT_CHUNK_SIZE):
        chunk = rows[chunk_start : chunk_start + _SNAPSHOT_CHUNK_SIZE]
        values: list[dict[str, object]] = []
        for row in chunk:
            if row.gap_reason is not None:
                values.append(
                    {
                        "user_id": user_id,
                        "leg_id": row.leg_id,
                        "slot_time": row.slot_time,
                        "observed_at": row.observed_at,
                        "gap_reason": row.gap_reason.value,
                        "raw_ciphertext": None,
                        "raw_nonce": None,
                        "key_version": None,
                    }
                )
                continue
            assert dek is not None  # gap_reason is None implies the DEK was resolved
            raw_ciphertext, raw_nonce = encrypt_field(
                json.dumps(row.raw_payload).encode("utf-8"),
                dek,
                _snapshot_associated_data(
                    "snapshot_observations",
                    "raw_ciphertext",
                    user_id=user_id,
                    leg_id=row.leg_id,
                    slot_time=row.slot_time,
                ),
            )
            values.append(
                {
                    "user_id": user_id,
                    "leg_id": row.leg_id,
                    "slot_time": row.slot_time,
                    "observed_at": row.observed_at,
                    "gap_reason": None,
                    "raw_ciphertext": raw_ciphertext,
                    "raw_nonce": raw_nonce,
                    "key_version": key_version,
                }
            )

        insert_stmt = pg_insert(SnapshotObservation).values(values)
        stmt = insert_stmt.on_conflict_do_update(
            index_elements=["leg_id", "slot_time"],
            set_={
                "observed_at": insert_stmt.excluded.observed_at,
                "gap_reason": insert_stmt.excluded.gap_reason,
                "raw_ciphertext": insert_stmt.excluded.raw_ciphertext,
                "raw_nonce": insert_stmt.excluded.raw_nonce,
                "key_version": insert_stmt.excluded.key_version,
            },
            where=(insert_stmt.excluded.gap_reason.is_(None))
            | (SnapshotObservation.gap_reason.isnot(None)),
        )
        result = await session.execute(stmt)
        landed += _rowcount(result)

    return landed


async def write_snapshot_marks(
    session: AsyncSession, user_id: UUID, rows: Sequence[SnapshotWrite]
) -> int:
    """The derived layer's write path -- same shape, chunking, AAD
    convention and asymmetric upsert as `write_snapshot_observations`
    above, over `snapshot_marks`' own five-column payload (mark pair, spot
    pair, `key_version`). A real row with `spot_usd` `None` writes the mark
    pair and leaves the spot pair `NULL` -- an honest missing spot on a
    real quote, not a gap (D8-09)."""
    if not rows:
        return 0

    # WR-01: same reasoning as write_snapshot_observations above -- only
    # resolve the DEK when this batch actually contains a real row.
    dek: bytes | None = None
    key_version: int | None = None
    if any(row.gap_reason is None for row in rows):
        dek, key_version = await current_dek(session, user_id)
    landed = 0

    for chunk_start in range(0, len(rows), _SNAPSHOT_CHUNK_SIZE):
        chunk = rows[chunk_start : chunk_start + _SNAPSHOT_CHUNK_SIZE]
        values: list[dict[str, object]] = []
        for row in chunk:
            if row.gap_reason is not None:
                values.append(
                    {
                        "user_id": user_id,
                        "leg_id": row.leg_id,
                        "slot_time": row.slot_time,
                        "observed_at": row.observed_at,
                        "gap_reason": row.gap_reason.value,
                        "mark_usd_ciphertext": None,
                        "mark_usd_nonce": None,
                        "spot_usd_ciphertext": None,
                        "spot_usd_nonce": None,
                        "key_version": None,
                    }
                )
                continue
            assert dek is not None  # gap_reason is None implies the DEK was resolved
            assert row.mark_usd is not None  # gap_reason is None implies a real mark
            mark_usd_ciphertext, mark_usd_nonce = encrypt_field(
                _encode_decimal(row.mark_usd),
                dek,
                _snapshot_associated_data(
                    "snapshot_marks",
                    "mark_usd_ciphertext",
                    user_id=user_id,
                    leg_id=row.leg_id,
                    slot_time=row.slot_time,
                ),
            )
            spot_usd_ciphertext: bytes | None = None
            spot_usd_nonce: bytes | None = None
            if row.spot_usd is not None:
                spot_usd_ciphertext, spot_usd_nonce = encrypt_field(
                    _encode_decimal(row.spot_usd),
                    dek,
                    _snapshot_associated_data(
                        "snapshot_marks",
                        "spot_usd_ciphertext",
                        user_id=user_id,
                        leg_id=row.leg_id,
                        slot_time=row.slot_time,
                    ),
                )
            values.append(
                {
                    "user_id": user_id,
                    "leg_id": row.leg_id,
                    "slot_time": row.slot_time,
                    "observed_at": row.observed_at,
                    "gap_reason": None,
                    "mark_usd_ciphertext": mark_usd_ciphertext,
                    "mark_usd_nonce": mark_usd_nonce,
                    "spot_usd_ciphertext": spot_usd_ciphertext,
                    "spot_usd_nonce": spot_usd_nonce,
                    "key_version": key_version,
                }
            )

        insert_stmt = pg_insert(SnapshotMark).values(values)
        stmt = insert_stmt.on_conflict_do_update(
            index_elements=["leg_id", "slot_time"],
            set_={
                "observed_at": insert_stmt.excluded.observed_at,
                "gap_reason": insert_stmt.excluded.gap_reason,
                "mark_usd_ciphertext": insert_stmt.excluded.mark_usd_ciphertext,
                "mark_usd_nonce": insert_stmt.excluded.mark_usd_nonce,
                "spot_usd_ciphertext": insert_stmt.excluded.spot_usd_ciphertext,
                "spot_usd_nonce": insert_stmt.excluded.spot_usd_nonce,
                "key_version": insert_stmt.excluded.key_version,
            },
            where=(insert_stmt.excluded.gap_reason.is_(None))
            | (SnapshotMark.gap_reason.isnot(None)),
        )
        result = await session.execute(stmt)
        landed += _rowcount(result)

    return landed


def gap_writes_for_legs(
    legs: Sequence[OpenLeg],
    *,
    slot_time: datetime,
    observed_at: datetime,
    gap_reason: SnapshotGapReason,
) -> tuple[SnapshotWrite, ...]:
    """Pure -- no session, no clock read. One `SnapshotWrite` per leg, both
    money fields `None`, `raw_payload` `None`. The one place a whole-slot
    gap fan-out is built, so `capture_user_snapshot`'s `connection_expired`
    and `vendor_error` branches produce structurally identical rows
    differing only in their `gap_reason` (D8-14, A3)."""
    return tuple(
        SnapshotWrite(
            leg_id=leg.leg_id,
            slot_time=slot_time,
            observed_at=observed_at,
            raw_payload=None,
            mark_usd=None,
            spot_usd=None,
            gap_reason=gap_reason,
        )
        for leg in legs
    )


async def capture_user_snapshot(
    session: AsyncSession,
    user_id: UUID,
    *,
    slot_time: datetime,
    observed_at: datetime,
    auth: SchwabAuth,
) -> CaptureOutcome:
    """The shell: lock, resolve open legs, check connection health, call
    `get_quotes` once, parse per leg, write raw then derived (D8-01's own
    ordering).

    Sets `app.current_user_id` transaction-locally as its first action,
    before any protected-table read, exactly as `sync_user` does. Takes
    this user's own `pg_advisory_xact_lock` next, the same ordering
    `sync_user`/`create_positions` already use -- this is what serialises
    two overlapping capture runs for one user (SNAP-05's own concurrency
    half).

    Three gap branches, each producing an honest row rather than a skipped
    one (criterion 5, `L043`):

    - A missing connection or an expired one (`D8-14`) writes a
      `connection_expired` gap per leg and returns *without* entering
      `schwab_client_for_user` at all -- no vendor call is attempted.
    - A whole-`get_quotes`-call failure (orchestrator-resolved research
      question A3) writes a `vendor_error` gap per leg, **commits them
      immediately**, and then raises `SnapshotVendorError`. The commit here
      is deliberate and the one place this function departs from "the
      caller owns the transaction": this branch raises instead of
      returning, so `worker/app.py::snapshot_user_task`'s own commit line is
      never reached, and an uncommitted transaction rolls back on the
      session's own exception exit (`AsyncSession`'s default context-
      manager behaviour). Criterion 5's "the row must exist" is false if it
      does not survive past this function.
    - A malformed or missing element for one symbol inside an otherwise
      successful response degrades to a `no_market_data` gap for that leg
      alone -- `parse_quote_payload` never raises, so this is D8-16's
      per-symbol isolation grain and needs no boundary of its own here.
    """
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
        {"uid": str(user_id)},
    )

    legs = await read_open_legs(session, user_id)
    if not legs:
        return CaptureOutcome(
            slot_time=slot_time, legs_attempted=0, marks_written=0, gaps_by_reason={}
        )

    connection = await read_connection(session, user_id)
    health = (
        derive_connection_health(connection.token_created_at, now=observed_at)[0]
        if connection is not None
        else None
    )
    if connection is None or health is ConnectionHealth.EXPIRED:
        # D8-14, criterion 5: a missing connection and an expired one both
        # mean "no vendor call is possible" -- both get an honest
        # connection_expired gap per leg rather than a skipped row, so the
        # slot does not later read as though the position did not exist.
        gap_writes = gap_writes_for_legs(
            legs,
            slot_time=slot_time,
            observed_at=observed_at,
            gap_reason=SnapshotGapReason.CONNECTION_EXPIRED,
        )
        await write_snapshot_observations(session, user_id, gap_writes)
        marks_written = await write_snapshot_marks(session, user_id, gap_writes)
        return CaptureOutcome(
            slot_time=slot_time,
            legs_attempted=len(legs),
            marks_written=marks_written,
            gaps_by_reason={SnapshotGapReason.CONNECTION_EXPIRED.value: len(legs)},
        )

    wire_symbols = {leg.leg_id: to_schwab_wire_symbol(leg.occ_symbol) for leg in legs}
    try:
        async with schwab_client_for_user(session, user_id, auth) as client:
            raw = await client.get_quotes(list(wire_symbols.values()))
    except Exception as exc:
        # Do not widen this boundary to cover the writers themselves -- a
        # write failure must roll the transaction back, not become a gap.
        gap_writes = gap_writes_for_legs(
            legs,
            slot_time=slot_time,
            observed_at=observed_at,
            gap_reason=SnapshotGapReason.VENDOR_ERROR,
        )
        await write_snapshot_observations(session, user_id, gap_writes)
        await write_snapshot_marks(session, user_id, gap_writes)
        # See this function's own docstring for why this commit is here,
        # not left to the caller.
        await session.commit()
        raise SnapshotVendorError(
            f"get_quotes failed for user_id={user_id} slot_time={slot_time.isoformat()}"
        ) from exc

    writes: list[SnapshotWrite] = []
    gaps_by_reason: dict[str, int] = {}
    for leg in legs:
        # D8-16's per-symbol isolation grain: parse_quote_payload never
        # raises, so a malformed or missing element degrades to a
        # no_market_data gap for its own leg and leaves every other leg
        # untouched. Do not add a try/except around this call -- that would
        # destroy the guarantee this loop already has for free.
        parsed = parse_quote_payload(raw, wire_symbols[leg.leg_id])
        if parsed.gap_reason is not None:
            gaps_by_reason[parsed.gap_reason.value] = (
                gaps_by_reason.get(parsed.gap_reason.value, 0) + 1
            )
        writes.append(
            SnapshotWrite(
                leg_id=leg.leg_id,
                slot_time=slot_time,
                observed_at=observed_at,
                raw_payload=raw,
                mark_usd=parsed.mark_usd,
                spot_usd=parsed.spot_usd,
                gap_reason=parsed.gap_reason,
            )
        )

    # Raw before derived (D8-01) -- the same ordering sync_user writes the
    # broker's own copy before the extracted fills, for the same reason.
    await write_snapshot_observations(session, user_id, writes)
    marks_written = await write_snapshot_marks(session, user_id, writes)

    return CaptureOutcome(
        slot_time=slot_time,
        legs_attempted=len(legs),
        marks_written=marks_written,
        gaps_by_reason=gaps_by_reason,
    )


async def capture_all_connected_users(
    session: AsyncSession, *, slot_time: datetime
) -> list[UUID]:
    """Fans out one `snapshot_user` job per row in `schwab_connections`,
    mirroring `sync_all_connected_users`'s own shape and its own docstring
    argument for why this one cross-tenant read is correct: it reads
    exactly one column, `user_id`, touches no encrypted value, and writes
    nothing on this session. Every per-user job it defers runs under that
    user's own RLS context (`capture_user_snapshot`'s own `set_config`
    call), which is where this phase's isolation actually lives.

    Imports `app` from `morai.worker.app` inside the function body, not at
    module scope, to break the same import cycle `sync_all_connected_users`
    already breaks the identical way.
    """
    from morai.worker.app import app

    user_ids = list(
        (await session.execute(select(SchwabConnection.user_id))).scalars().all()
    )
    for user_id in user_ids:
        await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_id), slot_time=slot_time.isoformat()
        )
    return user_ids
