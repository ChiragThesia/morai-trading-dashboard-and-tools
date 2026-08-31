"""Shared fixtures for the identity test suite (phase 2).

`clean_identity_tables`, `app_db_session` and `superuser_db_session` all
depend on `migrated_db` (`tests/conftest.py`) -- no `try`/`except` that turns a
connection failure into a skip. `tests/conftest.py`'s own `migrated_db`
docstring explains why, and the same reasoning holds harder here: a silently
skipped isolation test is worse than no isolation test at all, because it
looks like coverage.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from uuid import UUID

import pytest_asyncio
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import Position, User
from morai.settings import get_settings


@pytest_asyncio.fixture
async def clean_identity_tables(migrated_db: None) -> AsyncGenerator[None, None]:
    """Truncate every phase-2 table, plus the phase-3 trading tables
    `seeded_users` now seeds a position into, before each db-marked test, on
    the superuser engine, so identity tests and ledger tests don't leak rows
    into each other (03-06 Task 1)."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE TABLE users, sessions, setup_tokens, audit_log, "
                "user_data_keys, fills, positions, legs, events CASCADE"
            )
        )
    await engine.dispose()
    yield


@pytest_asyncio.fixture
async def app_db_session(
    clean_identity_tables: None,
) -> AsyncGenerator[AsyncSession, None]:
    """One `AsyncSession` connected as `morai_app`, its own engine, disposed
    after the test. This is the connection the isolation suite makes its
    claims through."""
    engine = create_async_engine(get_settings().app_async_dsn)
    async with AsyncSession(engine) as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def superuser_db_session(
    clean_identity_tables: None,
) -> AsyncGenerator[AsyncSession, None]:
    """One `AsyncSession` connected as the superuser role. Used only for
    seeding and for plan 02-02's positive control -- never for an assertion
    this suite makes about isolation."""
    engine = create_async_engine(get_settings().async_dsn)
    async with AsyncSession(engine) as session:
        yield session
    await engine.dispose()


@dataclass(frozen=True)
class SeededUsers:
    """Two non-admin users, one admin, and one `positions` row per
    non-admin user -- inserted through the superuser session, since RLS has
    not been established for any of these rows at insert time. Replaces
    `gate_user_scoped_probe`'s two probe rows (03-06 Task 1): nothing seeds
    or truncates that table any more, which is what makes 03-07's drop a
    schema change rather than a coverage loss."""

    user_a: UUID
    user_b: UUID
    admin: UUID
    position_a: UUID
    position_b: UUID


@pytest_asyncio.fixture
async def seeded_users(superuser_db_session: AsyncSession) -> SeededUsers:
    user_a = (
        await superuser_db_session.execute(
            insert(User).values(username="user-a", is_admin=False).returning(User.id)
        )
    ).scalar_one()
    user_b = (
        await superuser_db_session.execute(
            insert(User).values(username="user-b", is_admin=False).returning(User.id)
        )
    ).scalar_one()
    admin = (
        await superuser_db_session.execute(
            insert(User).values(username="admin", is_admin=True).returning(User.id)
        )
    ).scalar_one()
    position_a = (
        await superuser_db_session.execute(
            insert(Position).values(user_id=user_a).returning(Position.id)
        )
    ).scalar_one()
    position_b = (
        await superuser_db_session.execute(
            insert(Position).values(user_id=user_b).returning(Position.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()
    return SeededUsers(
        user_a=user_a,
        user_b=user_b,
        admin=admin,
        position_a=position_a,
        position_b=position_b,
    )
