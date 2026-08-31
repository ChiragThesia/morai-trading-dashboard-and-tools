"""Shared fixtures for the ledger test suite (phase 3).

Reuses `app_db_session`, `superuser_db_session`, `seeded_users` and
`clean_identity_tables` from `tests/identity/conftest.py` the same way
`tests/test_isolation.py` already does -- importing the fixture functions
directly rather than `pytest_plugins`, for the same double-registration
reason that file's own docstring explains.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from uuid import UUID

import pytest_asyncio
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import Leg, Position
from morai.ledger.fills import provision_data_key
from morai.settings import get_settings
from tests.identity.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- pytest resolves these by name lookup in
# this module's namespace when a test module imports them from here. See
# tests/test_isolation.py's own identical convention.
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


@pytest_asyncio.fixture
async def clean_ledger_tables(
    clean_identity_tables: None,
) -> AsyncGenerator[None, None]:
    """Truncate the new phase-3 tables before each db-marked test, on the
    superuser engine, so tests don't leak rows into each other."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE TABLE events, legs, positions, fills, user_data_keys CASCADE"
            )
        )
    await engine.dispose()
    yield


@pytest_asyncio.fixture
async def provisioned_users(
    clean_ledger_tables: None,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> SeededUsers:
    """`seeded_users`, with a data key provisioned for each non-admin user --
    through `provision_data_key`, the same write path production code uses,
    never a test-only fast path (D3-14's own discipline, applied early)."""
    await provision_data_key(superuser_db_session, seeded_users.user_a)
    await provision_data_key(superuser_db_session, seeded_users.user_b)
    await superuser_db_session.commit()
    return seeded_users


@dataclass(frozen=True)
class SeededPosition:
    """One position and its two legs, owned by `user_a`."""

    position_id: UUID
    front_leg_id: UUID
    back_leg_id: UUID


@pytest_asyncio.fixture
async def seeded_position(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> SeededPosition:
    """One position and its two legs for `user_a`, inserted through the
    superuser session -- this phase lands `positions`/`legs`' DDL only, no
    `insert_positions()`/`insert_legs()` write path is in its scope."""
    position_id = (
        await superuser_db_session.execute(
            insert(Position)
            .values(user_id=provisioned_users.user_a)
            .returning(Position.id)
        )
    ).scalar_one()
    front_leg_id = (
        await superuser_db_session.execute(
            insert(Leg)
            .values(
                position_id=position_id,
                user_id=provisioned_users.user_a,
                leg_role="front",
                occ_symbol="SPXW260618P07275000",
                root="SPXW",
            )
            .returning(Leg.id)
        )
    ).scalar_one()
    back_leg_id = (
        await superuser_db_session.execute(
            insert(Leg)
            .values(
                position_id=position_id,
                user_id=provisioned_users.user_a,
                leg_role="back",
                occ_symbol="SPX260717P07275000",
                root="SPX",
            )
            .returning(Leg.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()
    return SeededPosition(
        position_id=position_id, front_leg_id=front_leg_id, back_leg_id=back_leg_id
    )
