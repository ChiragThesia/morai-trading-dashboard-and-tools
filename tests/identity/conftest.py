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

from morai.db.models import GateUserScopedProbe, User
from morai.settings import get_settings


@pytest_asyncio.fixture
async def clean_identity_tables(migrated_db: None) -> AsyncGenerator[None, None]:
    """Truncate every phase-2 table before each db-marked test, on the
    superuser engine, so tests don't leak rows into each other."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE TABLE users, sessions, setup_tokens, audit_log, "
                "gate_user_scoped_probe CASCADE"
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
    """Two non-admin users, one admin, and one `gate_user_scoped_probe` row
    per non-admin user -- inserted through the superuser session, since RLS
    has not been established for any of these rows at insert time."""

    user_a: UUID
    user_b: UUID
    admin: UUID
    probe_a: UUID
    probe_b: UUID


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
    probe_a = (
        await superuser_db_session.execute(
            insert(GateUserScopedProbe)
            .values(user_id=user_a, note="user a's probe row")
            .returning(GateUserScopedProbe.id)
        )
    ).scalar_one()
    probe_b = (
        await superuser_db_session.execute(
            insert(GateUserScopedProbe)
            .values(user_id=user_b, note="user b's probe row")
            .returning(GateUserScopedProbe.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()
    return SeededUsers(
        user_a=user_a, user_b=user_b, admin=admin, probe_a=probe_a, probe_b=probe_b
    )
