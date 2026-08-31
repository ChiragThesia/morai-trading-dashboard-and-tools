"""Direct proof that a netted-only ROLL cannot be stored (D3-09, LEDGER-04,
criterion 4).

The `roll_has_both_legs` CHECK constraint (migration 0008) rejects a ROLL
row missing either amount ciphertext -- proven here through raw
`sa.text()` INSERT statements executed on the superuser session, never
through the ORM and never through any write path, because criterion 4's
whole point is that the guard holds for a caller who never touches
application code. It proves nothing about whether the two *values* inside
the ciphertext are correct: the amount columns are `bytea`, so the rejected
and accepted rows below carry arbitrary non-null bytes, and Postgres has no
way to inspect what they decrypt to. That is Phase 5's 13-calendar oracle's
job.

`@pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    SeededPosition,
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
    seeded_users,
    superuser_db_session,
)

__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_position",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

# `Row`/`scalar_one()` results type as `Any` -- same untyped-boundary shape
# `fills.py`'s own tests already established. `TypeAdapter` narrows it (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)

_EVENT_TIME = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)

_INSERT_EVENT_SQL = """
INSERT INTO events (
    id, user_id, position_id, event_type, event_time, key_version,
    open_debit_usd_ciphertext, open_debit_usd_nonce,
    close_credit_usd_ciphertext, close_credit_usd_nonce
) VALUES (
    gen_random_uuid(), :user_id, :position_id, :event_type, :event_time, 1,
    :open_ciphertext, :open_nonce, :close_ciphertext, :close_nonce
)
"""


async def _insert_event_raw(
    session: AsyncSession,
    *,
    user_id: UUID,
    position_id: UUID,
    event_type: str,
    open_ciphertext: bytes | None,
    open_nonce: bytes | None,
    close_ciphertext: bytes | None,
    close_nonce: bytes | None,
) -> None:
    """Raw SQL, no ORM, no write path -- criterion 4's own required proof
    shape: the guard must hold for a caller who never touches application
    code."""
    await session.execute(
        text(_INSERT_EVENT_SQL),
        {
            "user_id": user_id,
            "position_id": position_id,
            "event_type": event_type,
            "event_time": _EVENT_TIME,
            "open_ciphertext": open_ciphertext,
            "open_nonce": open_nonce,
            "close_ciphertext": close_ciphertext,
            "close_nonce": close_nonce,
        },
    )


async def test_roll_missing_close_credit_is_rejected(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await _insert_event_raw(
            superuser_db_session,
            user_id=provisioned_users.user_a,
            position_id=seeded_position.position_id,
            event_type="ROLL",
            open_ciphertext=b"\x01\x02",
            open_nonce=b"\x03\x04",
            close_ciphertext=None,
            close_nonce=None,
        )
    # The constraint's own name, not a bare exception type -- a future
    # unrelated integrity error must not make this test pass for the wrong
    # reason (the same discipline test_type_gate.py applies to marker names).
    assert "roll_has_both_legs" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_roll_missing_open_debit_is_rejected(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await _insert_event_raw(
            superuser_db_session,
            user_id=provisioned_users.user_a,
            position_id=seeded_position.position_id,
            event_type="ROLL",
            open_ciphertext=None,
            open_nonce=None,
            close_ciphertext=b"\x05\x06",
            close_nonce=b"\x07\x08",
        )
    assert "roll_has_both_legs" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_roll_with_both_amounts_is_accepted(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    await _insert_event_raw(
        superuser_db_session,
        user_id=provisioned_users.user_a,
        position_id=seeded_position.position_id,
        event_type="ROLL",
        open_ciphertext=b"\x01\x02",
        open_nonce=b"\x03\x04",
        close_ciphertext=b"\x05\x06",
        close_nonce=b"\x07\x08",
    )
    count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT COUNT(*) FROM events WHERE event_type = 'ROLL'")
            )
        ).scalar_one()
    )
    assert count == 1


async def test_open_with_only_open_debit_is_accepted(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """The constraint binds ROLL alone -- a one-sided OPEN is not the shape
    it exists to catch."""
    await _insert_event_raw(
        superuser_db_session,
        user_id=provisioned_users.user_a,
        position_id=seeded_position.position_id,
        event_type="OPEN",
        open_ciphertext=b"\x01\x02",
        open_nonce=b"\x03\x04",
        close_ciphertext=None,
        close_nonce=None,
    )
    count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT COUNT(*) FROM events WHERE event_type = 'OPEN'")
            )
        ).scalar_one()
    )
    assert count == 1


async def test_settlement_with_both_amounts_null_is_accepted(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """NN-16, D3-11: absence is NULL, never a sentinel."""
    await _insert_event_raw(
        superuser_db_session,
        user_id=provisioned_users.user_a,
        position_id=seeded_position.position_id,
        event_type="SETTLEMENT",
        open_ciphertext=None,
        open_nonce=None,
        close_ciphertext=None,
        close_nonce=None,
    )
    count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT COUNT(*) FROM events WHERE event_type = 'SETTLEMENT'")
            )
        ).scalar_one()
    )
    assert count == 1
