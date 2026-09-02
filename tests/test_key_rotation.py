"""Master-key rotation touches no trade ciphertext (D3-07, CRYPT-04,
criterion 3). The byte-identical-ciphertext assertion is load-bearing --
captured into a dict keyed by primary key, compared as a whole dict, not a
sample (03-VALIDATION.md's own trap: "it still decrypts" would pass even if
every row had been rewritten).

`@pytest.mark.db` -- runs only where Postgres is reachable. Lives at
`tests/` top level (not `tests/ledger/`), so every identity/ledger fixture
it needs is imported from `tests.ledger.conftest`, which already re-exports
the full identity set plus its own ledger fixtures -- neither
`tests/identity/conftest.py` nor `tests/ledger/conftest.py` auto-applies to
a sibling top-level test file.
"""

from __future__ import annotations

import base64
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from cryptography.exceptions import InvalidTag
from pydantic import TypeAdapter
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import unwrap_dek
from morai.crypto.rotation import rotate_kek
from morai.db.models import Event, Fill, Position, UserDataKey
from morai.ledger.events import EventWrite, insert_events, read_events
from morai.ledger.fills import FillWrite, insert_fills, read_fills
from morai.settings import get_settings
from tests.ledger.conftest import (
    SeededPosition,
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
    seeded_users,
    superuser_db_session,
)

__all__ = [
    "SeededPosition",
    "SeededUsers",
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_position",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
_EVENT_TIME = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)

# The capture below reads raw SQL, so every value crosses an untyped
# boundary -- narrowed the same way `morai.ledger.fills` and every raw-SQL
# test in this suite already narrows one.
_STR: TypeAdapter[str] = TypeAdapter(str)
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)
_BYTES_OR_NONE: TypeAdapter[bytes | None] = TypeAdapter(bytes | None)


@pytest.fixture(autouse=True)
def restore_settings_cache() -> Iterator[None]:
    """Some tests below repoint `get_settings().master_key_bytes` at a
    freshly-rotated key by monkeypatching `MORAI_MASTER_KEY` and clearing
    the `lru_cache` -- clear it again on teardown so a rotated-key
    `Settings` object never leaks into a later test."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- Postgres's
    `SET` grammar only accepts a literal there. Mirrors
    `tests/ledger/test_tracer_encrypted_fill.py::_set_current_user`."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _ciphertext_columns_by_table(
    session: AsyncSession,
) -> dict[str, tuple[list[str], list[str]]]:
    """Per table: its primary-key columns and its ciphertext/nonce columns,
    read from `pg_attribute` and `pg_index`.

    Derived rather than written down, following PR #34's fix to
    `tests/test_isolation.py`. The hand-written `fills`/`events` pair this
    replaced named two of the six tables that carry ciphertext by Phase 9 --
    `broker_transactions`, `schwab_connections`, `snapshot_marks` and
    `snapshot_observations` were the four nothing watched.

    `user_data_keys` is excluded by name, and only it: rotation is *supposed*
    to rewrite `wrapped_dek`/`wrap_nonce`, and the test below asserts exactly
    that separately. Everything else must come out byte-identical."""
    rows = (
        await session.execute(
            text(
                "SELECT c.relname, a.attname, i.indisprimary IS NOT NULL "
                "FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "JOIN pg_attribute a ON a.attrelid = c.oid "
                "LEFT JOIN pg_index i ON i.indrelid = c.oid "
                "AND i.indisprimary AND a.attnum = ANY(i.indkey::smallint[]) "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' "
                "AND c.relname <> 'user_data_keys' "
                "AND a.attnum > 0 AND NOT a.attisdropped "
                "AND EXISTS (SELECT 1 FROM pg_attribute x "
                "WHERE x.attrelid = c.oid AND x.attname ~ '_ciphertext$') "
                "AND (i.indisprimary OR a.attname ~ '_(ciphertext|nonce)$') "
                "ORDER BY c.relname, a.attnum"
            )
        )
    ).all()

    by_table: dict[str, tuple[list[str], list[str]]] = {}
    for row in rows:
        table = _STR.validate_python(row[0])
        column = _STR.validate_python(row[1])
        keys, values = by_table.setdefault(table, ([], []))
        (keys if _BOOL.validate_python(row[2]) else values).append(column)
    return by_table


async def _capture_trade_ciphertext(
    session: AsyncSession,
) -> dict[tuple[str, ...], bytes | None]:
    """Every ciphertext and nonce value in the schema, keyed by table,
    primary key and column name -- a full dict compare, not a sample
    (03-VALIDATION.md's own trap).

    Only `fills` and `events` carry seeded rows here, so the four tables this
    widening adds prove the shape of the claim, not more data. That is the
    right scope: rotation's guarantee is structural -- `rotate_kek()` names no
    trade table at all -- and the capture should describe the schema it runs
    against, not the two tables Phase 3 happened to have."""
    by_table = await _ciphertext_columns_by_table(session)
    # Guards the guard. An empty derivation makes the whole-dict compare in
    # the test below a comparison of two empty dicts.
    assert len(by_table) >= 6

    captured: dict[tuple[str, ...], bytes | None] = {}
    for table, (key_columns, value_columns) in sorted(by_table.items()):
        assert key_columns and value_columns
        # Every identifier came out of the catalog, never out of a test
        # parameter -- but interpolating one at all earns the check.
        assert all(
            name.isidentifier() for name in (table, *key_columns, *value_columns)
        )
        selected = [f"{name}::text" for name in key_columns] + value_columns
        rows = (
            await session.execute(text(f"SELECT {', '.join(selected)} FROM {table}"))
        ).all()
        for row in rows:
            row_key = tuple(
                _STR.validate_python(row[index]) for index in range(len(key_columns))
            )
            for offset, column in enumerate(value_columns):
                captured[(table, *row_key, column)] = _BYTES_OR_NONE.validate_python(
                    row[len(key_columns) + offset]
                )
    return captured


async def test_rotation_touches_no_trade_ciphertext(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    position_b = (
        await superuser_db_session.execute(
            insert(Position)
            .values(user_id=provisioned_users.user_b)
            .returning(Position.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()

    await _set_current_user(superuser_db_session, provisioned_users.user_a)
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="rot-a-1",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("159.41"),
            )
        ],
    )
    await insert_events(
        superuser_db_session,
        provisioned_users.user_a,
        [
            EventWrite(
                position_id=seeded_position.position_id,
                event_type="ROLL",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=Decimal("125.50"),
                close_credit_usd=Decimal("110.25"),
                rolled_from_position_id=seeded_position.position_id,
            )
        ],
    )

    await _set_current_user(superuser_db_session, provisioned_users.user_b)
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_b,
        [
            FillWrite(
                order_id="rot-b-1",
                occ_symbol="SPX260717P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="SELL",
                quantity=Decimal("2"),
                price_usd=Decimal("42.10"),
            )
        ],
    )
    await insert_events(
        superuser_db_session,
        provisioned_users.user_b,
        [
            EventWrite(
                position_id=position_b,
                event_type="SETTLEMENT",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=None,
                close_credit_usd=None,
            )
        ],
    )
    await superuser_db_session.commit()

    before_ciphertext = await _capture_trade_ciphertext(superuser_db_session)
    # Guards the guard: two fills and two events, four ciphertext/nonce
    # columns each. Two empty dicts compare equal, and the assertion below
    # would certify nothing.
    assert len(before_ciphertext) >= 16

    key_rows_before = (
        (
            await superuser_db_session.execute(
                select(UserDataKey).order_by(
                    UserDataKey.user_id, UserDataKey.key_version
                )
            )
        )
        .scalars()
        .all()
    )
    old_kek = get_settings().master_key_bytes
    dek_before = {
        (row.user_id, row.key_version): unwrap_dek(
            row.wrapped_dek, row.wrap_nonce, old_kek
        )
        for row in key_rows_before
    }
    wrapped_before = {
        (row.user_id, row.key_version): (row.wrapped_dek, row.wrap_nonce)
        for row in key_rows_before
    }

    new_kek = os.urandom(32)
    count = await rotate_kek(superuser_db_session, old_kek, new_kek)
    await superuser_db_session.commit()
    assert count == len(key_rows_before)

    # Criterion 3's load-bearing assertion: the whole dict, not a sample.
    after_ciphertext = await _capture_trade_ciphertext(superuser_db_session)
    assert after_ciphertext == before_ciphertext

    key_rows_after = (
        (
            await superuser_db_session.execute(
                select(UserDataKey).order_by(
                    UserDataKey.user_id, UserDataKey.key_version
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(key_rows_after) == len(key_rows_before)
    for row in key_rows_after:
        wrap_key = (row.user_id, row.key_version)
        assert (row.wrapped_dek, row.wrap_nonce) != wrapped_before[wrap_key]
        assert (
            unwrap_dek(row.wrapped_dek, row.wrap_nonce, new_kek) == dek_before[wrap_key]
        )

    fill_key_versions = (
        (await superuser_db_session.execute(select(Fill.key_version).distinct()))
        .scalars()
        .all()
    )
    assert set(fill_key_versions) == {1}
    event_key_versions = (
        (await superuser_db_session.execute(select(Event.key_version).distinct()))
        .scalars()
        .all()
    )
    assert set(event_key_versions) == {1}

    # A row written under key_version 1 still decrypts after rotating to the
    # new master key (D3-07) -- read it back through the normal write path.
    monkeypatch.setenv("MORAI_MASTER_KEY", base64.b64encode(new_kek).decode())
    get_settings.cache_clear()
    await _set_current_user(superuser_db_session, provisioned_users.user_a)
    fills = await read_fills(superuser_db_session, provisioned_users.user_a)
    events = await read_events(superuser_db_session, provisioned_users.user_a)

    assert len(fills) == 1
    assert fills[0].price_usd == Decimal("159.41")
    assert fills[0].quantity == Decimal("1")
    assert len(events) == 1
    assert events[0].open_debit_usd == Decimal("125.50")
    assert events[0].close_credit_usd == Decimal("110.25")


async def test_rotating_with_the_wrong_old_key_raises_without_writing(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    key_rows_before = (
        (
            await superuser_db_session.execute(
                select(UserDataKey).order_by(
                    UserDataKey.user_id, UserDataKey.key_version
                )
            )
        )
        .scalars()
        .all()
    )
    wrapped_before = {
        (row.user_id, row.key_version): (row.wrapped_dek, row.wrap_nonce)
        for row in key_rows_before
    }

    wrong_old_kek = os.urandom(32)
    new_kek = os.urandom(32)
    with pytest.raises(InvalidTag):
        await rotate_kek(superuser_db_session, wrong_old_kek, new_kek)
    await superuser_db_session.rollback()

    key_rows_after = (
        (
            await superuser_db_session.execute(
                select(UserDataKey).order_by(
                    UserDataKey.user_id, UserDataKey.key_version
                )
            )
        )
        .scalars()
        .all()
    )
    for row in key_rows_after:
        assert (row.wrapped_dek, row.wrap_nonce) == wrapped_before[
            (row.user_id, row.key_version)
        ]
