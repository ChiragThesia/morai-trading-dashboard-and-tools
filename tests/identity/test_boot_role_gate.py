"""The boot-time gate on the runtime role, and `require_rls_context`'s named
error (`02-RESEARCH.md` Pitfall 1: "add a migration-time or startup-time
assertion... and fails loudly if it's a superuser").

`assert_connection_cannot_bypass_rls`'s negative control runs on
`superuser_db_session` -- a gate that has never rejected anything is
decoration, and CI's own Postgres user is exactly the superuser this gate
exists to catch before it ever serves traffic.

`@pytest.mark.db` -- runs only where Postgres is reachable. There is no local
database in CI's sense; `tests/conftest.py::migrated_db` explains why a
`try`/`except` around an unreachable Postgres is forbidden here.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.app import app
from morai.identity.rls import (
    RlsContextMissing,
    assert_connection_cannot_bypass_rls,
    require_rls_context,
)
from tests.identity.conftest import (
    app_db_session,
    clean_identity_tables,
    superuser_db_session,
)

__all__ = ["app_db_session", "clean_identity_tables", "superuser_db_session"]

pytestmark = pytest.mark.db


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def test_assert_connection_cannot_bypass_rls_passes_on_the_app_role(
    app_db_session: AsyncSession,
) -> None:
    await assert_connection_cannot_bypass_rls(app_db_session)


async def test_assert_connection_cannot_bypass_rls_rejects_the_superuser(
    superuser_db_session: AsyncSession,
) -> None:
    """The negative control. Without this, the gate is decoration -- it has
    to be observed rejecting the exact connection it exists to catch."""
    with pytest.raises(RuntimeError) as exc_info:
        await assert_connection_cannot_bypass_rls(superuser_db_session)
    message = str(exc_info.value)
    assert "morai" in message


async def test_the_rejection_message_names_no_dsn_or_password(
    superuser_db_session: AsyncSession,
) -> None:
    """`NN-34`: the message carries the role name and nothing else."""
    with pytest.raises(RuntimeError) as exc_info:
        await assert_connection_cannot_bypass_rls(superuser_db_session)
    message = str(exc_info.value).lower()
    assert "postgresql://" not in message
    assert "localdevpassword" not in message
    assert "@localhost" not in message


async def test_require_rls_context_returns_the_set_user_id(
    app_db_session: AsyncSession,
) -> None:
    user_id = UUID("00000000-0000-0000-0000-000000000001")
    await _set_current_user(app_db_session, user_id)
    assert await require_rls_context(app_db_session) == user_id


async def test_require_rls_context_raises_by_name_on_an_unset_context(
    app_db_session: AsyncSession,
) -> None:
    with pytest.raises(RlsContextMissing):
        await require_rls_context(app_db_session)


async def test_the_app_lifespan_startup_completes_against_the_app_engine(
    clean_identity_tables: None,
) -> None:
    """Drives the real app's lifespan directly -- no new dependency for a
    LifespanManager equivalent. If the app engine were ever reverted to the
    superuser engine, this raises instead of the process quietly starting."""
    async with app.router.lifespan_context(app):
        pass
