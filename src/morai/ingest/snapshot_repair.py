"""The repair path: rebuild `snapshot_marks` from the raw payloads already
stored in `snapshot_observations`, with no vendor call (Phase 8, plan
08-03, SNAP-04, `D8-13`).

A sibling of `snapshots.py` under `ingest/`, deliberately its own module:
the repair path and the live writer never contend for the same file, and
the import direction is one-way -- this module depends on `snapshots.py`'s
parser and its two writer functions, and `snapshots.py` knows nothing
about this module.

## Why this exists (`L039`, `L040`)

08-01 stored `snapshot_observations` as a raw layer separate from
`snapshot_marks` precisely so a mark could be rebuilt from what was
actually observed, without a second vendor call. A parsed-fields-only
store can only ever rebuild what was already parsed correctly, so a
parsing bug becomes as permanent as an outage (`L039`). Stopping bad
writes without a repair path just moves the failure mode to a later,
possibly-cut phase (`L040`) -- this is why the repair ships beside the
writer, in the same wave.

## No vendor call, structurally (`D8-04`)

This module imports nothing from `morai.vendor` and nothing from
`schwab`. `tests/ingest/test_snapshot_repair.py` asserts this by walking
this file's own AST, not by trusting this docstring.

## Never fabricates a mark (`L041`, `NN-16`)

`repair_snapshot_marks` only ever rebuilds a mark from a stored
observation -- a gap observation rewrites the same gap, carrying its own
stored reason forward unchanged, never a generic one. A slot with no
stored observation at all is not this function's concern:
`backfill_uncaptured_slot_gaps` is what turns that absence into an
honest `slot_not_captured` gap, and it never writes a value either.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from pydantic import JsonValue, TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.data_keys import dek_for_version
from morai.crypto.envelope import decrypt_field
from morai.ingest.snapshots import (
    SnapshotGapReason,
    SnapshotWrite,
    _snapshot_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: the repair must decrypt each stored raw payload using the exact AAD helper the writer used to bind ciphertext to its own row -- a copied AAD would fail the tag (D8-04's own point), not a coincidence to route around.
    parse_quote_payload,
    to_schwab_wire_symbol,
    write_snapshot_marks,
)

_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `vendor/connections.py`/`ledger/fills.py` already established.
# `TypeAdapter` narrows at that boundary (D-06).
_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)
_STR: TypeAdapter[str] = TypeAdapter(str)
_DATETIME: TypeAdapter[datetime] = TypeAdapter(datetime)
_OPTIONAL_STR: TypeAdapter[str | None] = TypeAdapter(str | None)
_OPTIONAL_BYTES: TypeAdapter[bytes | None] = TypeAdapter(bytes | None)
_OPTIONAL_INT: TypeAdapter[int | None] = TypeAdapter(int | None)

READ_SNAPSHOT_OBSERVATIONS_SQL = (
    "SELECT so.leg_id, l.occ_symbol, so.slot_time, so.observed_at, "
    "so.gap_reason, so.raw_ciphertext, so.raw_nonce, so.key_version "
    "FROM snapshot_observations so JOIN legs l ON l.id = so.leg_id"
)


@dataclass(frozen=True)
class StoredObservation:
    """One decrypted (or gap) row read back from `snapshot_observations`,
    joined to its leg's own `occ_symbol` -- the repair needs it to rebuild
    the wire symbol the parser looks the payload up by, and re-deriving it
    any other way would be a second source of truth."""

    leg_id: UUID
    occ_symbol: str
    slot_time: datetime
    observed_at: datetime
    raw_payload: JsonValue | None
    gap_reason: SnapshotGapReason | None


@dataclass(frozen=True)
class RepairOutcome:
    """One repair run's own result, for one user."""

    observations_read: int
    marks_written: int
    gaps_by_reason: Mapping[str, int]


async def read_snapshot_observations(
    session: AsyncSession, user_id: UUID, *, since: datetime | None = None
) -> tuple[StoredObservation, ...]:
    """Joins `snapshot_observations` to `legs` on `leg_id` so each row
    carries its own `occ_symbol`. Filters on `slot_time` when `since` is
    given. Adds no explicit user predicate beyond the one already needed
    for the join; RLS is the filter, the same convention `read_fills`,
    `read_connection` and `read_sync_runs` all state.

    For each row with no gap reason, resolves its own `key_version`
    through `dek_for_version` -- never `current_dek`, because a row's
    own stored version is what unwraps it, even after a hypothetical
    future DEK rotation -- decrypts `raw_ciphertext` under the AAD helper
    the writer used, and JSON-decodes. For each row with a gap reason,
    carries the reason through with a null payload. Ordered by
    `slot_time` then `leg_id` so two runs are comparable element-wise.
    """
    sql = READ_SNAPSHOT_OBSERVATIONS_SQL
    params: dict[str, object] = {}
    if since is not None:
        sql += " WHERE so.slot_time >= :since"
        params["since"] = since
    sql += " ORDER BY so.slot_time, so.leg_id"

    rows = (await session.execute(text(sql), params)).all()

    observations: list[StoredObservation] = []
    for row in rows:
        leg_id = _UUID.validate_python(row[0])
        occ_symbol = _STR.validate_python(row[1])
        slot_time = _DATETIME.validate_python(row[2])
        observed_at = _DATETIME.validate_python(row[3])
        gap_reason_value = _OPTIONAL_STR.validate_python(row[4])
        raw_ciphertext = _OPTIONAL_BYTES.validate_python(row[5])
        raw_nonce = _OPTIONAL_BYTES.validate_python(row[6])
        key_version = _OPTIONAL_INT.validate_python(row[7])

        if gap_reason_value is not None:
            observations.append(
                StoredObservation(
                    leg_id=leg_id,
                    occ_symbol=occ_symbol,
                    slot_time=slot_time,
                    observed_at=observed_at,
                    raw_payload=None,
                    gap_reason=SnapshotGapReason(gap_reason_value),
                )
            )
            continue

        assert raw_ciphertext is not None  # gap_reason is None implies a real row
        assert raw_nonce is not None
        assert key_version is not None
        dek = await dek_for_version(session, user_id, key_version)
        raw_payload = _JSON_VALUE.validate_json(
            decrypt_field(
                raw_ciphertext,
                raw_nonce,
                dek,
                _snapshot_associated_data(
                    "snapshot_observations",
                    "raw_ciphertext",
                    user_id=user_id,
                    leg_id=leg_id,
                    slot_time=slot_time,
                ),
            )
        )
        observations.append(
            StoredObservation(
                leg_id=leg_id,
                occ_symbol=occ_symbol,
                slot_time=slot_time,
                observed_at=observed_at,
                raw_payload=raw_payload,
                gap_reason=None,
            )
        )

    return tuple(observations)


async def repair_snapshot_marks(
    session: AsyncSession, user_id: UUID, *, since: datetime | None = None
) -> RepairOutcome:
    """Rebuilds `snapshot_marks` from the raw observations actually
    stored, with no vendor call.

    Takes this user's own `pg_advisory_xact_lock` as its first action,
    mirroring `sync_user`/`capture_user_snapshot`, so a repair and a live
    capture for one user serialise rather than interleave. Does not set
    `app.current_user_id` itself -- the caller (the worker task, the CLI,
    or a test) owns that, the same way `insert_broker_transactions`
    leaves session state to its caller.

    For each real observation, rebuilds the leg's wire symbol through
    `to_schwab_wire_symbol` and calls `parse_quote_payload` -- the
    identical pure function the live writer calls, so a repair can never
    derive a different mark from the same bytes than the writer would
    have. A gap observation carries its own stored reason straight
    through, never rewritten to a generic one. Hands every result to
    `write_snapshot_marks`, which applies the same asymmetric clause the
    live writer uses: a rebuilt real value heals a gap and corrects an
    earlier real one, and a rebuilt gap can never replace a real mark.

    Does not commit -- the caller owns the transaction, the same
    convention every write path here states.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
        {"uid": str(user_id)},
    )

    observations = await read_snapshot_observations(session, user_id, since=since)
    if not observations:
        return RepairOutcome(observations_read=0, marks_written=0, gaps_by_reason={})

    writes: list[SnapshotWrite] = []
    gaps_by_reason: dict[str, int] = {}
    for observation in observations:
        if observation.gap_reason is not None:
            gaps_by_reason[observation.gap_reason.value] = (
                gaps_by_reason.get(observation.gap_reason.value, 0) + 1
            )
            writes.append(
                SnapshotWrite(
                    leg_id=observation.leg_id,
                    slot_time=observation.slot_time,
                    observed_at=observation.observed_at,
                    raw_payload=None,
                    mark_usd=None,
                    spot_usd=None,
                    gap_reason=observation.gap_reason,
                )
            )
            continue

        assert observation.raw_payload is not None  # gap_reason is None implies real
        wire_symbol = to_schwab_wire_symbol(observation.occ_symbol)
        parsed = parse_quote_payload(observation.raw_payload, wire_symbol)
        if parsed.gap_reason is not None:
            gaps_by_reason[parsed.gap_reason.value] = (
                gaps_by_reason.get(parsed.gap_reason.value, 0) + 1
            )
        writes.append(
            SnapshotWrite(
                leg_id=observation.leg_id,
                slot_time=observation.slot_time,
                observed_at=observation.observed_at,
                raw_payload=observation.raw_payload,
                mark_usd=parsed.mark_usd,
                spot_usd=parsed.spot_usd,
                gap_reason=parsed.gap_reason,
            )
        )

    marks_written = await write_snapshot_marks(session, user_id, writes)
    return RepairOutcome(
        observations_read=len(observations),
        marks_written=marks_written,
        gaps_by_reason=gaps_by_reason,
    )
