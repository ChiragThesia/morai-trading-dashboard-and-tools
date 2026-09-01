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

Two key domains, two queries. `user_data_keys.wrap_nonce` is excluded from
`_NONCE_COLLISION_QUERY` above and checked by `_KEK_NONCE_COLLISION_QUERY`
instead. It is encrypted under the single global KEK, not a
per-`(user_id, key_version)` DEK, so folding it into that triple would be a
modeling error: two different users sharing a `wrap_nonce` collide under the
*real* key -- the one live KEK -- but land in different
`(user_id, key_version)` groups and would never be flagged.

That reasoning is right, and an earlier version of this module drew the
wrong conclusion from it: it excluded `wrap_nonce` from the query AND from
the drift guard, and stopped there. The domain mismatch is a reason to write
a second, correctly-scoped query -- not a reason to leave the invariant
unchecked. A `wrap_nonce` reuse across two users is the most damaging
collision available in this schema (it forfeits confidentiality and
authenticity for two wrapped DEKs at once, and every user's trade data hangs
off those DEKs), and until `test_no_two_users_share_a_wrap_nonce_under_the_live_kek`
existed, nothing in this suite would have reported it. Found in Phase 3's
code review as WR-01.

NIST SP 800-38D Sec 8.3 caps random-nonce GCM at 2^32 invocations per key.
This project's realistic volume -- a handful of users, generously 5,000
fills/user/year, ~10 encrypted fields/fill, over a 10-year horizon -- sits
roughly 13,000x below that ceiling (03-RESEARCH.md Pitfall 2's own
calculation). A counter-based nonce is not warranted at this scale, and none
is added here or elsewhere in this phase.

`@pytest.mark.db` -- needs a live Postgres, migrations 0007/0008 applied.
"""

from __future__ import annotations

import os
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
    UNION ALL
    SELECT user_id, key_version, token_nonce AS nonce
    FROM schwab_connections WHERE token_nonce IS NOT NULL
    UNION ALL
    SELECT user_id, key_version, account_hash_nonce AS nonce
    FROM schwab_connections WHERE account_hash_nonce IS NOT NULL
    UNION ALL
    SELECT user_id, key_version, raw_nonce AS nonce
    FROM broker_transactions WHERE raw_nonce IS NOT NULL
)
SELECT user_id, key_version, nonce, COUNT(*) AS collision_count
FROM all_nonces
GROUP BY user_id, key_version, nonce
HAVING COUNT(*) > 1
"""

# The schema-drift guard's ground truth for the per-user DEK domain: every
# (table, nonce column) pair the query above unions over. Phase 4 adds
# `schwab_connections.token_nonce`/`account_hash_nonce` -- both encrypted
# under the connecting user's own Phase 3 DEK (D4-11, same domain as
# fills/events), so both belong in this union, not the KEK-scoped query
# below. Phase 6 adds `broker_transactions.raw_nonce` -- same domain, same
# reasoning (D6-02).
_EXPECTED_NONCE_COLUMNS: frozenset[tuple[str, str]] = frozenset(
    {
        ("fills", "quantity_nonce"),
        ("fills", "price_usd_nonce"),
        ("events", "open_debit_usd_nonce"),
        ("events", "close_credit_usd_nonce"),
        ("schwab_connections", "token_nonce"),
        ("schwab_connections", "account_hash_nonce"),
        ("broker_transactions", "raw_nonce"),
    }
)

# The KEK domain. `user_data_keys.wrap_nonce` is encrypted under the single
# global KEK, so its uniqueness scope is the whole table -- NOT
# `(user_id, key_version)`. Two different users sharing a `wrap_nonce` is a
# real AES-GCM `(key, nonce)` reuse under the one live key, and the per-user
# query above structurally cannot see it: those rows land in different
# groups. It needs its own query, not an exemption.
#
# No `key_version` partitioning, and the reason is not obvious:
# `crypto/rotation.py` overwrites `wrapped_dek` and `wrap_nonce` in place and
# does NOT bump `key_version`, so `key_version` here tracks the DEK
# generation, not the KEK's. Every live row is wrapped under the current KEK
# at all times, so the collision scope is simply every row in the table.
# Partitioning by `key_version` would hide a real cross-generation collision;
# there is only ever one live KEK to collide under.
_EXPECTED_KEK_NONCE_COLUMNS: frozenset[tuple[str, str]] = frozenset(
    {("user_data_keys", "wrap_nonce")}
)

_KEK_NONCE_COLLISION_QUERY = """
SELECT wrap_nonce, COUNT(*) AS n
FROM user_data_keys
GROUP BY wrap_nonce
HAVING COUNT(*) > 1
"""

_DRIFT_GUARD_QUERY = """
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name ~ '_nonce$'
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
            # D7-10: a ROLL requires a non-NULL rolled_from_position_id;
            # this module's own claim is about nonce uniqueness, not
            # roll-chain semantics, so the FK target need not differ from
            # position_id itself.
            rolled_from_position_id=position_id,
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
                rolled_from_position_id=seeded_position.position_id,
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
    """Every `_nonce`-suffixed column `information_schema.columns` reports
    must be covered by one of the two collision queries -- the per-user DEK
    union, or the KEK-scoped `user_data_keys` query. A new ciphertext column
    added in a later phase without a matching branch fails this, not just
    the union query silently missing it.

    The guard scans the WHOLE schema, `user_data_keys` included. It used to
    exclude that table outright, which meant a second nonce column added
    there later would have escaped both queries and this guard as well."""
    rows = (await superuser_db_session.execute(text(_DRIFT_GUARD_QUERY))).all()
    actual = frozenset((row[0], row[1]) for row in rows)
    covered = _EXPECTED_NONCE_COLUMNS | _EXPECTED_KEK_NONCE_COLUMNS
    assert actual == covered, (
        "A ciphertext nonce column exists that neither collision query "
        f"covers, or vice versa. Queries cover: {sorted(covered)}, "
        f"information_schema reports: {sorted(actual)}"
    )


async def test_no_two_users_share_a_wrap_nonce_under_the_live_kek(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Criterion 1b in the KEK domain. Every row of `user_data_keys` is
    wrapped under the one live master key, so two users sharing a
    `wrap_nonce` is an AES-GCM `(key, nonce)` reuse against that key -- the
    catastrophic case, since it leaks the XOR of two wrapped DEKs and
    forfeits the authentication guarantee for both.

    The per-user union query cannot catch this: it groups by
    `(user_id, key_version, nonce)`, so two users colliding land in two
    different groups and are never compared."""
    rows = (await superuser_db_session.execute(text(_KEK_NONCE_COLLISION_QUERY))).all()
    assert rows == [], (
        f"wrap_nonce reused across {len(rows)} group(s) under the live KEK: {rows}"
    )


async def test_the_kek_query_reports_a_planted_wrap_nonce_collision(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The positive control for the query above. Without it, a query that
    can never return a row is indistinguishable from one whose subject never
    collides -- and this project's own standard is that a gate which has
    never rejected anything is decoration.

    Forces two users' `wrap_nonce` values equal, asserts the query reports
    exactly that one group, then rolls back so nothing is left behind."""
    duplicate_nonce = os.urandom(12)
    await superuser_db_session.execute(
        text("UPDATE user_data_keys SET wrap_nonce = :n WHERE user_id = :u"),
        {"n": duplicate_nonce, "u": provisioned_users.user_a},
    )
    await superuser_db_session.execute(
        text("UPDATE user_data_keys SET wrap_nonce = :n WHERE user_id = :u"),
        {"n": duplicate_nonce, "u": provisioned_users.user_b},
    )
    try:
        rows = (
            await superuser_db_session.execute(text(_KEK_NONCE_COLLISION_QUERY))
        ).all()
        assert len(rows) == 1, f"expected exactly one collision group, got {rows}"
        # Raw `text()` Rows type every column as `Any`; `TypeAdapter` is this
        # project's narrowing at such a boundary (D-06) -- it checks the shape
        # at runtime, unlike `cast`, which only asserts it to the checker.
        assert _BYTES.validate_python(rows[0][0]) == duplicate_nonce
        assert _INT.validate_python(rows[0][1]) == 2
    finally:
        await superuser_db_session.rollback()


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
