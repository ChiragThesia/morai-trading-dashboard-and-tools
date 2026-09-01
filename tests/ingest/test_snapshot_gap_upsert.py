"""Task 1 (08-02-PLAN.md): the four-cell asymmetric upsert truth table,
plus the corrective-backfill, adjacency, ordering and key-discrimination
cases, proven directly against Postgres for both writers
(`write_snapshot_marks`/`write_snapshot_observations`).

The asymmetric upsert is the single highest-risk line in this phase
(D8-10). `L020`/`L071`: the wrong `where=` clause blocked v1's backfill of
1,190 corrupted contracts until it was flipped, and separately discarded a
later, more complete recompute in favour of an early partial one. A test
covering three cells of the truth table passes while the one clause that
matters (cell 4, `gap_blocked_by_real`) is broken -- this module tests all
four directly, mirroring `tests/ledger/test_roll_check_constraint.py`'s
own "prove the database-level guard directly" convention.

Every case drives the real writers on an `app_db_session` with
`app.current_user_id` set -- never a hand-written insert statement, since
the clause under test lives in the writer and a test that reimplements the
insert proves nothing about it.

`@pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.data_keys import current_dek
from morai.crypto.envelope import decrypt_field
from morai.db.models import Leg, Position
from morai.ingest.snapshots import (
    _snapshot_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: these tests decrypt the stored value back to prove the healed/corrected value landed, the same cooperating-test convention test_snapshot_capture.py already uses for this exact private helper.
)
from morai.ingest.snapshots import (
    SnapshotGapReason,
    SnapshotWrite,
    rth_slots_between,
    write_snapshot_marks,
    write_snapshot_observations,
)
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import SeededPosition

pytestmark = pytest.mark.db

_INT: TypeAdapter[int] = TypeAdapter(int)
_OPTIONAL_STR: TypeAdapter[str | None] = TypeAdapter(str | None)
_OPTIONAL_BYTES: TypeAdapter[bytes | None] = TypeAdapter(bytes | None)
_DATETIME: TypeAdapter[datetime] = TypeAdapter(datetime)
_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)

# One ordinary Wednesday, enumerated through `rth_slots_between` rather than
# by hand-adding thirty minutes, so these tests exercise the same grid the
# writer sees in production (the plan's own instruction for the adjacency
# case, applied to every case here for consistency).
_DAY_START = datetime(2026, 6, 17, 0, 0, tzinfo=UTC)
_DAY_END = datetime(2026, 6, 18, 0, 0, tzinfo=UTC)
_SLOTS = rth_slots_between(_DAY_START, _DAY_END)

_MARK_VALUE_A = Decimal("44.8567")
_MARK_VALUE_B = Decimal("50.1234")
_SPOT_VALUE = Decimal("6203.1234")
_RAW_VALUE_A: JsonValue = {"quote": {"mark": 44.8567}}
_RAW_VALUE_B: JsonValue = {"quote": {"mark": 50.1234}}

_WriteFn = Callable[[AsyncSession, UUID, Sequence[SnapshotWrite]], Awaitable[int]]
_DecryptFn = Callable[[bytes, bytes, bytes, UUID, UUID, datetime], object]


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """Mirrors every other db-marked test module's own identical helper."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


def _real_write(
    leg_id: UUID, slot_time: datetime, observed_at: datetime, *, tag: str = "A"
) -> SnapshotWrite:
    """A real row, carrying both a mark and a raw payload so the identical
    call works for either writer under test -- each writer reads only the
    fields its own table needs and ignores the other."""
    mark_usd = _MARK_VALUE_A if tag == "A" else _MARK_VALUE_B
    raw_payload = _RAW_VALUE_A if tag == "A" else _RAW_VALUE_B
    return SnapshotWrite(
        leg_id=leg_id,
        slot_time=slot_time,
        observed_at=observed_at,
        raw_payload=raw_payload,
        mark_usd=mark_usd,
        spot_usd=_SPOT_VALUE,
        gap_reason=None,
    )


def _gap_write(
    leg_id: UUID,
    slot_time: datetime,
    observed_at: datetime,
    *,
    reason: SnapshotGapReason = SnapshotGapReason.NO_MARKET_DATA,
) -> SnapshotWrite:
    return SnapshotWrite(
        leg_id=leg_id,
        slot_time=slot_time,
        observed_at=observed_at,
        raw_payload=None,
        mark_usd=None,
        spot_usd=None,
        gap_reason=reason,
    )


def _decrypt_mark_value(
    ciphertext: bytes,
    nonce: bytes,
    dek: bytes,
    user_id: UUID,
    leg_id: UUID,
    slot_time: datetime,
) -> object:
    return Decimal(
        decrypt_field(
            ciphertext,
            nonce,
            dek,
            _snapshot_associated_data(
                "snapshot_marks",
                "mark_usd_ciphertext",
                user_id=user_id,
                leg_id=leg_id,
                slot_time=slot_time,
            ),
        ).decode("utf-8")
    )


def _decrypt_observation_value(
    ciphertext: bytes,
    nonce: bytes,
    dek: bytes,
    user_id: UUID,
    leg_id: UUID,
    slot_time: datetime,
) -> object:
    return _JSON_VALUE.validate_json(
        decrypt_field(
            ciphertext,
            nonce,
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


@dataclass(frozen=True)
class _Row:
    gap_reason: str | None
    ciphertext: bytes | None
    nonce: bytes | None
    observed_at: datetime


async def _read_row(
    session: AsyncSession,
    *,
    table: str,
    ciphertext_col: str,
    nonce_col: str,
    leg_id: UUID,
    slot_time: datetime,
) -> _Row | None:
    """`table`/`ciphertext_col`/`nonce_col` are always one of the two fixed
    literals in `_WRITERS` below, never external input -- the same
    internal-f-string convention `alembic/versions/0015_*.py`'s own
    `_gap_reason_check_sql` already uses."""
    row = (
        await session.execute(
            text(
                f"SELECT gap_reason, {ciphertext_col}, {nonce_col}, observed_at "
                f"FROM {table} WHERE leg_id = :leg_id AND slot_time = :slot_time"
            ),
            {"leg_id": leg_id, "slot_time": slot_time},
        )
    ).one_or_none()
    if row is None:
        return None
    return _Row(
        gap_reason=_OPTIONAL_STR.validate_python(row[0]),
        ciphertext=_OPTIONAL_BYTES.validate_python(row[1]),
        nonce=_OPTIONAL_BYTES.validate_python(row[2]),
        observed_at=_DATETIME.validate_python(row[3]),
    )


_WRITERS = (
    pytest.param(
        write_snapshot_marks,
        "snapshot_marks",
        "mark_usd_ciphertext",
        "mark_usd_nonce",
        _decrypt_mark_value,
        id="marks",
    ),
    pytest.param(
        write_snapshot_observations,
        "snapshot_observations",
        "raw_ciphertext",
        "raw_nonce",
        _decrypt_observation_value,
        id="observations",
    ),
)


@pytest.mark.parametrize(
    ("write_fn", "table", "ciphertext_col", "nonce_col", "decrypt"), _WRITERS
)
async def test_real_over_nothing_inserts_one_row(
    write_fn: _WriteFn,
    table: str,
    ciphertext_col: str,
    nonce_col: str,
    decrypt: _DecryptFn,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Cell 1: a real write for a leg/slot with no existing row inserts one
    row with a null gap reason and a decryptable value."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_time = _SLOTS[0]

    landed = await write_fn(
        app_db_session, user_id, [_real_write(leg_id, slot_time, slot_time)]
    )
    assert landed == 1

    row = await _read_row(
        app_db_session,
        table=table,
        ciphertext_col=ciphertext_col,
        nonce_col=nonce_col,
        leg_id=leg_id,
        slot_time=slot_time,
    )
    assert row is not None
    assert row.gap_reason is None
    assert row.ciphertext is not None
    assert row.nonce is not None
    del decrypt  # unused in this cell -- shared parametrize tuple


@pytest.mark.parametrize(
    ("write_fn", "table", "ciphertext_col", "nonce_col", "decrypt"), _WRITERS
)
async def test_real_over_gap_heals_the_row(
    write_fn: _WriteFn,
    table: str,
    ciphertext_col: str,
    nonce_col: str,
    decrypt: _DecryptFn,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Cell 2 (criterion 3, first clause): a gap written first, then a real
    mark for the same leg and slot, leaves one row whose gap reason is
    null and whose value decrypts to the real one -- the gap is healed."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_time = _SLOTS[1]

    await write_fn(app_db_session, user_id, [_gap_write(leg_id, slot_time, slot_time)])
    await write_fn(
        app_db_session, user_id, [_real_write(leg_id, slot_time, slot_time, tag="A")]
    )

    row = await _read_row(
        app_db_session,
        table=table,
        ciphertext_col=ciphertext_col,
        nonce_col=nonce_col,
        leg_id=leg_id,
        slot_time=slot_time,
    )
    assert row is not None
    assert row.gap_reason is None
    assert row.ciphertext is not None
    assert row.nonce is not None

    dek, _key_version = await current_dek(app_db_session, user_id)
    healed_value = decrypt(row.ciphertext, row.nonce, dek, user_id, leg_id, slot_time)
    expected = _MARK_VALUE_A if table == "snapshot_marks" else _RAW_VALUE_A
    assert healed_value == expected

    count = _INT.validate_python(
        (
            await app_db_session.execute(
                text(
                    f"SELECT count(*) FROM {table} "
                    "WHERE leg_id = :leg_id AND slot_time = :slot_time"
                ),
                {"leg_id": leg_id, "slot_time": slot_time},
            )
        ).scalar_one()
    )
    assert count == 1


@pytest.mark.parametrize(
    ("write_fn", "table", "ciphertext_col", "nonce_col", "decrypt"), _WRITERS
)
async def test_gap_over_nothing_inserts_one_gap_row(
    write_fn: _WriteFn,
    table: str,
    ciphertext_col: str,
    nonce_col: str,
    decrypt: _DecryptFn,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Cell 3: a gap written for a leg/slot with no existing row inserts
    one row with the gap reason set and every money column null."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_time = _SLOTS[2]

    landed = await write_fn(
        app_db_session, user_id, [_gap_write(leg_id, slot_time, slot_time)]
    )
    assert landed == 1

    row = await _read_row(
        app_db_session,
        table=table,
        ciphertext_col=ciphertext_col,
        nonce_col=nonce_col,
        leg_id=leg_id,
        slot_time=slot_time,
    )
    assert row is not None
    assert row.gap_reason == SnapshotGapReason.NO_MARKET_DATA.value
    assert row.ciphertext is None
    assert row.nonce is None
    del decrypt  # unused in this cell -- shared parametrize tuple


@pytest.mark.parametrize(
    ("write_fn", "table", "ciphertext_col", "nonce_col", "decrypt"), _WRITERS
)
async def test_gap_blocked_by_real_leaves_row_unchanged(
    write_fn: _WriteFn,
    table: str,
    ciphertext_col: str,
    nonce_col: str,
    decrypt: _DecryptFn,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Cell 4 -- the one that matters (`L020`, `L071`): writing a real mark
    first, then a gap for the same leg and slot, leaves the row unchanged:
    same gap reason (null), same ciphertext bytes, same nonce, same
    `observed_at`. Asserted on raw bytes, never through a decrypted
    comparison -- a decrypted comparison would still pass if the row had
    been rewritten with a fresh nonce over the same plaintext, which is a
    different fact from "the write did not happen"."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_time = _SLOTS[3]
    real_observed_at = slot_time

    await write_fn(
        app_db_session,
        user_id,
        [_real_write(leg_id, slot_time, real_observed_at, tag="A")],
    )
    before = await _read_row(
        app_db_session,
        table=table,
        ciphertext_col=ciphertext_col,
        nonce_col=nonce_col,
        leg_id=leg_id,
        slot_time=slot_time,
    )
    assert before is not None

    # A distinct observed_at proves the blocked write did not touch even
    # that column, which the WHERE clause's own set_ list would otherwise
    # update -- the whole row is untouched, not merely the payload.
    gap_observed_at = real_observed_at + timedelta(seconds=1)
    await write_fn(
        app_db_session, user_id, [_gap_write(leg_id, slot_time, gap_observed_at)]
    )
    after = await _read_row(
        app_db_session,
        table=table,
        ciphertext_col=ciphertext_col,
        nonce_col=nonce_col,
        leg_id=leg_id,
        slot_time=slot_time,
    )
    assert after is not None

    assert after.gap_reason == before.gap_reason
    assert after.ciphertext == before.ciphertext
    assert after.nonce == before.nonce
    assert after.observed_at == before.observed_at
    del decrypt  # unused in this cell -- shared parametrize tuple


@pytest.mark.parametrize(
    ("write_fn", "table", "ciphertext_col", "nonce_col", "decrypt"), _WRITERS
)
async def test_corrective_backfill_replaces_real_with_real(
    write_fn: _WriteFn,
    table: str,
    ciphertext_col: str,
    nonce_col: str,
    decrypt: _DecryptFn,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Cell 5 (criterion 3, third clause; `L005`): a second, different real
    value for the same leg and slot replaces the first -- an upsert must
    never silently no-op a corrected backfill."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_time = _SLOTS[4]

    await write_fn(
        app_db_session, user_id, [_real_write(leg_id, slot_time, slot_time, tag="A")]
    )
    await write_fn(
        app_db_session, user_id, [_real_write(leg_id, slot_time, slot_time, tag="B")]
    )

    row = await _read_row(
        app_db_session,
        table=table,
        ciphertext_col=ciphertext_col,
        nonce_col=nonce_col,
        leg_id=leg_id,
        slot_time=slot_time,
    )
    assert row is not None
    assert row.ciphertext is not None
    assert row.nonce is not None

    dek, _key_version = await current_dek(app_db_session, user_id)
    landed_value = decrypt(row.ciphertext, row.nonce, dek, user_id, leg_id, slot_time)
    expected = _MARK_VALUE_B if table == "snapshot_marks" else _RAW_VALUE_B
    assert landed_value == expected

    count = _INT.validate_python(
        (
            await app_db_session.execute(
                text(
                    f"SELECT count(*) FROM {table} "
                    "WHERE leg_id = :leg_id AND slot_time = :slot_time"
                ),
                {"leg_id": leg_id, "slot_time": slot_time},
            )
        ).scalar_one()
    )
    assert count == 1


async def test_adjacency_gap_is_not_healed_by_a_neighbouring_slots_observation(
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """`D8-12`, `L048`: a gap written for slot N is untouched by a real
    observation written for slot N-1 and by one written for slot N+1 --
    healing that reaches across slots is fabrication wearing the costume
    of repair. Slot instants come from `rth_slots_between`, the same grid
    the writer sees in production, never hand-added thirty minutes."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_n_minus_1, slot_n, slot_n_plus_1 = _SLOTS[5], _SLOTS[6], _SLOTS[7]

    await write_snapshot_marks(
        app_db_session, user_id, [_gap_write(leg_id, slot_n, slot_n)]
    )
    await write_snapshot_marks(
        app_db_session,
        user_id,
        [_real_write(leg_id, slot_n_minus_1, slot_n_minus_1, tag="A")],
    )
    await write_snapshot_marks(
        app_db_session,
        user_id,
        [_real_write(leg_id, slot_n_plus_1, slot_n_plus_1, tag="A")],
    )

    row_n = await _read_row(
        app_db_session,
        table="snapshot_marks",
        ciphertext_col="mark_usd_ciphertext",
        nonce_col="mark_usd_nonce",
        leg_id=leg_id,
        slot_time=slot_n,
    )
    row_n_minus_1 = await _read_row(
        app_db_session,
        table="snapshot_marks",
        ciphertext_col="mark_usd_ciphertext",
        nonce_col="mark_usd_nonce",
        leg_id=leg_id,
        slot_time=slot_n_minus_1,
    )
    row_n_plus_1 = await _read_row(
        app_db_session,
        table="snapshot_marks",
        ciphertext_col="mark_usd_ciphertext",
        nonce_col="mark_usd_nonce",
        leg_id=leg_id,
        slot_time=slot_n_plus_1,
    )

    assert row_n is not None
    assert row_n.gap_reason == SnapshotGapReason.NO_MARKET_DATA.value
    assert row_n_minus_1 is not None
    assert row_n_minus_1.gap_reason is None
    assert row_n_plus_1 is not None
    assert row_n_plus_1.gap_reason is None


async def test_ordering_slot_n_plus_1_written_before_slot_n_leaves_both_correct(
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Writing slot N+1 before slot N leaves two independent correct rows;
    neither overwrites the other and neither is missing."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    leg_id = seeded_position.front_leg_id
    slot_n, slot_n_plus_1 = _SLOTS[8], _SLOTS[9]

    await write_snapshot_marks(
        app_db_session,
        user_id,
        [_real_write(leg_id, slot_n_plus_1, slot_n_plus_1, tag="B")],
    )
    await write_snapshot_marks(
        app_db_session, user_id, [_real_write(leg_id, slot_n, slot_n, tag="A")]
    )

    row_n = await _read_row(
        app_db_session,
        table="snapshot_marks",
        ciphertext_col="mark_usd_ciphertext",
        nonce_col="mark_usd_nonce",
        leg_id=leg_id,
        slot_time=slot_n,
    )
    row_n_plus_1 = await _read_row(
        app_db_session,
        table="snapshot_marks",
        ciphertext_col="mark_usd_ciphertext",
        nonce_col="mark_usd_nonce",
        leg_id=leg_id,
        slot_time=slot_n_plus_1,
    )
    assert row_n is not None
    assert row_n_plus_1 is not None
    assert row_n.ciphertext is not None
    assert row_n.nonce is not None
    assert row_n_plus_1.ciphertext is not None
    assert row_n_plus_1.nonce is not None

    dek, _key_version = await current_dek(app_db_session, user_id)
    value_n = _decrypt_mark_value(
        row_n.ciphertext, row_n.nonce, dek, user_id, leg_id, slot_n
    )
    value_n_plus_1 = _decrypt_mark_value(
        row_n_plus_1.ciphertext, row_n_plus_1.nonce, dek, user_id, leg_id, slot_n_plus_1
    )
    assert value_n == _MARK_VALUE_A
    assert value_n_plus_1 == _MARK_VALUE_B


async def test_key_discrimination_two_legs_sharing_one_occ_symbol_get_independent_rows(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """`NN-1`, `L001`, `L002`: two legs belonging to two different positions
    but carrying the identical `occ_symbol` get two independent rows for
    the same slot -- the composite key discriminates on `leg_id`, not
    `occ_symbol`. `user_id` is deliberately absent from the unique
    constraint `(leg_id, slot_time)` because `leg_id` already functionally
    determines it through the existing foreign-key chain -- `L001`'s named
    trap read correctly rather than reflexively widening the key."""
    user_id = provisioned_users.user_a
    second_position_id = (
        await superuser_db_session.execute(
            insert(Position).values(user_id=user_id).returning(Position.id)
        )
    ).scalar_one()
    duplicate_leg_id = (
        await superuser_db_session.execute(
            insert(Leg)
            .values(
                position_id=second_position_id,
                user_id=user_id,
                leg_role="front",
                # Identical to seeded_position's own front leg occ_symbol
                # (tests/ledger/conftest.py::seeded_position) -- the whole
                # point of this test.
                occ_symbol="SPXW260618P07275000",
                root="SPXW",
            )
            .returning(Leg.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()

    await _set_current_user(app_db_session, user_id)
    slot_time = _SLOTS[10]
    await write_snapshot_marks(
        app_db_session,
        user_id,
        [_real_write(seeded_position.front_leg_id, slot_time, slot_time, tag="A")],
    )
    await write_snapshot_marks(
        app_db_session,
        user_id,
        [_real_write(duplicate_leg_id, slot_time, slot_time, tag="B")],
    )

    count = _INT.validate_python(
        (
            await app_db_session.execute(
                text(
                    "SELECT count(*) FROM snapshot_marks WHERE slot_time = :slot_time"
                ),
                {"slot_time": slot_time},
            )
        ).scalar_one()
    )
    assert count == 2

    leg_ids = (
        (
            await app_db_session.execute(
                text(
                    "SELECT DISTINCT leg_id FROM snapshot_marks "
                    "WHERE slot_time = :slot_time"
                ),
                {"slot_time": slot_time},
            )
        )
        .scalars()
        .all()
    )
    assert len(leg_ids) == 2
