"""Criterion 1b (CRYPT-05): no two ciphertext values anywhere in the schema
share a `(user_id, key_version, nonce)` triple.

03-RESEARCH.md Pitfall 2: checking each ciphertext column's nonce for
duplicates independently misses a collision *between* two different
columns encrypted under the same user's same `key_version` DEK -- which is
exactly a nonce reuse under one key, since AES-GCM's uniqueness requirement
is scoped to `(key, nonce)`, not `(key, column, nonce)`. `_NONCE_COLLISION_QUERY`
is written once, as a module-level constant, and used unmodified by both the
clean assertion and the planted-collision assertion, so the two cannot drift
apart -- and by the drift-guard proof, so a schema change cannot silently
outrun it either.

Scope note: `user_data_keys.wrap_nonce` is deliberately EXCLUDED from this
query and from the drift guard's expected column set. It is encrypted under
the single global KEK, not a per-`(user_id, key_version)` DEK -- grouping it
into this exact triple would be a modeling error, not an omission: two
different users legitimately sharing a `wrap_nonce` value would collide
under the *real* key (the one global KEK) but land in different
`(user_id, key_version)` groups here and never be flagged. Wrapped-DEK nonce
uniqueness is a different invariant with a different key domain; not this
plan's scope.

NIST SP 800-38D Sec 8.3 caps random-nonce GCM at 2^32 invocations per key.
This project's realistic volume -- a handful of users, generously 5,000
fills/user/year, ~10 encrypted fields/fill, over a 10-year horizon -- sits
roughly 13,000x below that ceiling (03-RESEARCH.md Pitfall 2's own
calculation). A counter-based nonce is not warranted at this scale, and none
is added here or elsewhere in this phase.

`@pytest.mark.db` -- needs a live Postgres, migrations 0007/0008 applied.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventWrite, insert_events
from morai.ledger.fills import FillWrite, insert_fills
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

# Re-exported, not merely imported -- this module lives under `tests/crypto/`,
# a sibling of `tests/ledger/`, not a descendant, so pytest's ancestor-conftest
# auto-discovery does not reach `tests/ledger/conftest.py`. Same convention
# `tests/ledger/test_roll_check_constraint.py` already uses.
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

_INT: TypeAdapter[int] = TypeAdapter(int)
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)
_UUID_ADAPTER: TypeAdapter[UUID] = TypeAdapter(UUID)

# One UNION ALL branch per ciphertext-nonce column, across every encrypted
# table -- written once and reused unmodified by both the clean assertion
# and the planted-collision assertion (see module docstring for the
# user_data_keys.wrap_nonce exclusion).
_NONCE_COLLISION_QUERY = """
WITH all_nonces AS (
    SELECT user_id, key_version, quantity_nonce AS nonce
    FROM fills WHERE quantity_nonce IS NOT NULL
    UNION ALL
    SELECT user_id, key_version, price_usd_nonce AS nonce
    FROM fills WHERE price_usd_nonce IS NOT NULL
    UNION ALL
    SELECT user_id, key_version, open_debit_usd_nonce AS nonce
    FROM events WHERE open_debit_usd_nonce IS NOT NULL
    UNION ALL
    SELECT user_id, key_version, close_credit_usd_nonce AS nonce
    FROM events WHERE close_credit_usd_nonce IS NOT NULL
)
SELECT user_id, key_version, nonce, COUNT(*) AS collision_count
FROM all_nonces
GROUP BY user_id, key_version, nonce
HAVING COUNT(*) > 1
"""

# The schema-drift guard's ground truth: every (table, nonce column) pair
# the query above unions over, excluding user_data_keys.wrap_nonce (see
# module docstring).
_EXPECTED_NONCE_COLUMNS: frozenset[tuple[str, str]] = frozenset(
    {
        ("fills", "quantity_nonce"),
        ("fills", "price_usd_nonce"),
        ("events", "open_debit_usd_nonce"),
        ("events", "close_credit_usd_nonce"),
    }
)

_DRIFT_GUARD_QUERY = """
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name ~ '_nonce$'
  AND table_name <> 'user_data_keys'
ORDER BY table_name, column_name
"""

_EVENT_TIME = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `tests/ledger/test_roll_check_constraint.py`'s own
    `_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _insert_position_for_user(
    superuser_db_session: AsyncSession, user_id: UUID
) -> UUID:
    """No `insert_positions()` write path exists this phase (03-02
    SUMMARY) -- mirrors `tests/ledger/conftest.py`'s own `seeded_position`
    fixture, which is hard-coded to `user_a` only; this test needs a second
    user's position too."""
    return _UUID_ADAPTER.validate_python(
        (
            await superuser_db_session.execute(
                text("INSERT INTO positions (user_id) VALUES (:user_id) RETURNING id"),
                {"user_id": user_id},
            )
        ).scalar_one()
    )


async def _seed_many_fills(
    app_db_session: AsyncSession, user_id: UUID, *, count: int, label: str
) -> None:
    base_time = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
    fills = [
        FillWrite(
            order_id=f"nonce-test-{label}-{i}",
            occ_symbol="SPXW260618P07275000",
            leg_index=0,
            execution_time=base_time + timedelta(seconds=i),
            position_effect="OPEN",
            side="SELL",
            quantity=Decimal(f"{i}.0001"),
            price_usd=Decimal(f"{100 + i}.5000"),
        )
        for i in range(count)
    ]
    await insert_fills(app_db_session, user_id, fills)


async def _seed_many_roll_events(
    app_db_session: AsyncSession, user_id: UUID, position_id: UUID, *, count: int
) -> None:
    base_time = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)
    events = [
        EventWrite(
            position_id=position_id,
            event_type="ROLL",
            event_time=base_time + timedelta(seconds=i),
            fill_ids_hash=None,
            open_debit_usd=Decimal(f"{i}.1100"),
            close_credit_usd=Decimal(f"{i}.2200"),
        )
        for i in range(count)
    ]
    await insert_events(app_db_session, user_id, events)


async def test_union_query_returns_zero_rows_over_several_hundred_real_values(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_b_position_id = await _insert_position_for_user(
        superuser_db_session, provisioned_users.user_b
    )
    await superuser_db_session.commit()

    await _set_current_user(app_db_session, provisioned_users.user_a)
    await _seed_many_fills(
        app_db_session, provisioned_users.user_a, count=150, label="a"
    )
    await _seed_many_roll_events(
        app_db_session,
        provisioned_users.user_a,
        seeded_position.position_id,
        count=10,
    )

    await _set_current_user(app_db_session, provisioned_users.user_b)
    await _seed_many_fills(
        app_db_session, provisioned_users.user_b, count=150, label="b"
    )
    await _seed_many_roll_events(
        app_db_session, provisioned_users.user_b, user_b_position_id, count=10
    )
    await app_db_session.commit()

    # 150 + 150 fills x 2 nonces + 10 + 10 events x 2 nonces = 640 nonces --
    # "several hundred" (task <behavior>).
    rows = (await superuser_db_session.execute(text(_NONCE_COLLISION_QUERY))).all()
    assert rows == [], f"Nonce collision(s) found across {len(rows)} group(s): {rows}"


async def test_union_query_returns_exactly_the_planted_cross_column_collision(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """The planted pair spans two DIFFERENT columns on two different tables
    (a fill's `quantity_nonce`, an event's `open_debit_usd_nonce`) -- the
    shape a per-column check cannot see (Pitfall 2). Goes in through the
    superuser session as raw SQL, deliberately bypassing the write path: the
    real write path always generates a fresh random nonce, making a genuine
    collision impossible to produce through it. The point is to prove the
    detector fires, not to test the write path's own (already-proven, see
    `tests/crypto/test_envelope.py`) nonce freshness.
    """
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(
        app_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="collision-fill",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EVENT_TIME,
                position_effect="OPEN",
                side="SELL",
                quantity=Decimal("1.0000"),
                price_usd=Decimal("100.0000"),
            )
        ],
    )
    await insert_events(
        app_db_session,
        provisioned_users.user_a,
        [
            EventWrite(
                position_id=seeded_position.position_id,
                event_type="ROLL",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=Decimal("50.0000"),
                close_credit_usd=Decimal("25.0000"),
            )
        ],
    )
    await app_db_session.commit()

    shared_nonce = _BYTES.validate_python(
        (
            await superuser_db_session.execute(
                text(
                    "SELECT quantity_nonce FROM fills WHERE order_id = 'collision-fill'"
                )
            )
        ).scalar_one()
    )
    await superuser_db_session.execute(
        text(
            "UPDATE events SET open_debit_usd_nonce = :nonce "
            "WHERE event_type = 'ROLL' AND user_id = :user_id"
        ),
        {"nonce": shared_nonce, "user_id": provisioned_users.user_a},
    )
    await superuser_db_session.commit()

    rows = (await superuser_db_session.execute(text(_NONCE_COLLISION_QUERY))).all()
    assert len(rows) == 1, f"Expected exactly one collision group, got {rows}"
    row = rows[0]
    assert _UUID_ADAPTER.validate_python(row[0]) == provisioned_users.user_a
    assert _INT.validate_python(row[1]) == 1
    assert _BYTES.validate_python(row[2]) == shared_nonce
    assert _INT.validate_python(row[3]) == 2


async def test_nonce_column_drift_guard_matches_the_union_query(
    superuser_db_session: AsyncSession,
) -> None:
    """The set of `(table, nonce column)` pairs the query unions over must
    equal every `_nonce`-suffixed column `information_schema.columns`
    actually reports (excluding `user_data_keys.wrap_nonce`, see module
    docstring) -- a new ciphertext column added in a later phase without a
    matching branch fails this, not just the union query silently missing
    it."""
    rows = (await superuser_db_session.execute(text(_DRIFT_GUARD_QUERY))).all()
    actual = frozenset((row[0], row[1]) for row in rows)
    assert actual == _EXPECTED_NONCE_COLUMNS, (
        "A ciphertext nonce column exists that the union query does not "
        f"cover, or vice versa. Query covers: {sorted(_EXPECTED_NONCE_COLUMNS)}, "
        f"information_schema reports: {sorted(actual)}"
    )


async def test_drift_guard_fails_when_a_nonce_column_is_uncovered(
    superuser_db_session: AsyncSession,
) -> None:
    """Proves the drift-guard comparison above is itself capable of failing
    (T-03-17) -- not merely observed passing. A throwaway table with a
    `_nonce`-suffixed column no UNION branch covers is created, the same
    `information_schema` query scoped to it is run, and the comparison
    against `_EXPECTED_NONCE_COLUMNS` is shown to fail, before the table is
    dropped. Never touches the real schema."""
    await superuser_db_session.execute(
        text(
            "CREATE TABLE gate_dump_negative_control_nonce_drift (planted_nonce bytea)"
        )
    )
    try:
        rows = (
            await superuser_db_session.execute(
                text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND column_name ~ '_nonce$' "
                    "AND table_name = 'gate_dump_negative_control_nonce_drift'"
                )
            )
        ).all()
        actual = frozenset((row[0], row[1]) for row in rows)
        assert actual == frozenset(
            {("gate_dump_negative_control_nonce_drift", "planted_nonce")}
        )
        # The comparison the real guard performs (actual == expected) would
        # have failed here -- this planted column is not a subset of what
        # the query covers.
        assert not actual <= _EXPECTED_NONCE_COLUMNS
    finally:
        await superuser_db_session.execute(
            text("DROP TABLE IF EXISTS gate_dump_negative_control_nonce_drift")
        )
        await superuser_db_session.commit()
