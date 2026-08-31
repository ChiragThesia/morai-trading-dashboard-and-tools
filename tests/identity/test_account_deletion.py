"""The account's whole key lifecycle: provisioned with the account (Task 1)
and destroyed before its rows on deletion (Task 3) -- CRYPT-01, AUTH-06,
D3-05, D3-08. One module, not two, so the create and delete halves of
AUTH-06's lifecycle sit together.

`@pytest.mark.db` throughout -- every HTTP-driven test runs the real ASGI
app over `httpx.ASGITransport` against real Postgres, matching
`tests/identity/test_admin_routes.py`'s established pattern.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models_identity import AdminCreateUserResponse
from morai.crypto.envelope import unwrap_dek
from morai.db.models import Session as SessionRow
from morai.db.models import User, UserDataKey
from morai.identity.tokens import generate_token, hash_token
from morai.settings import get_settings
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

_CREATE_RESPONSE: TypeAdapter[AdminCreateUserResponse] = TypeAdapter(
    AdminCreateUserResponse
)

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)


async def _seed_session(superuser_db_session: AsyncSession, user_id: UUID) -> str:
    token = generate_token()
    await superuser_db_session.execute(
        insert(SessionRow).values(
            token_hash=hash_token(token),
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(days=30),
        )
    )
    await superuser_db_session.commit()
    return token


@pytest_asyncio.fixture
async def client(clean_identity_tables: None) -> AsyncGenerator[AsyncClient, None]:
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# --- Task 1: account creation provisions the data key -----------------


async def test_account_creation_provisions_exactly_one_key_at_version_one(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "fresh-account"},
        cookies={"morai_session": admin_token},
    )
    assert created.status_code == 200
    body = _CREATE_RESPONSE.validate_json(created.content)

    rows = (
        (
            await superuser_db_session.execute(
                select(UserDataKey).where(UserDataKey.user_id == body.user_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].key_version == 1
    assert rows[0].wrapped_dek is not None
    assert rows[0].wrap_nonce is not None


async def test_the_provisioned_key_unwraps_to_thirty_two_bytes(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "unwrap-check"},
        cookies={"morai_session": admin_token},
    )
    body = _CREATE_RESPONSE.validate_json(created.content)

    row = (
        await superuser_db_session.execute(
            select(UserDataKey).where(UserDataKey.user_id == body.user_id)
        )
    ).scalar_one()
    dek = unwrap_dek(row.wrapped_dek, row.wrap_nonce, get_settings().master_key_bytes)
    assert len(dek) == 32


async def test_the_admin_cannot_read_the_new_users_key_through_the_app_role(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "admin-cannot-read"},
        cookies={"morai_session": admin_token},
    )
    body = _CREATE_RESPONSE.validate_json(created.content)

    await app_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(seeded_users.admin)},
    )
    rows = (
        await app_db_session.execute(
            select(UserDataKey).where(UserDataKey.user_id == body.user_id)
        )
    ).all()
    assert rows == []


async def test_a_failure_provisioning_the_key_leaves_no_user_row_behind(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import morai.api.routes_identity as routes_identity

    async def _boom(session: AsyncSession, user_id: UUID) -> None:
        raise RuntimeError("simulated provisioning failure")

    monkeypatch.setattr(routes_identity, "provision_data_key", _boom)
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    # `install_error_handling` catches everything into an opaque 500, but
    # Starlette's outer ServerErrorMiddleware re-raises after sending it so
    # a process supervisor still sees the crash -- httpx's ASGITransport
    # re-raises that same exception back to the caller by default
    # (api/errors.py's own module docstring).
    with pytest.raises(RuntimeError, match="simulated provisioning failure"):
        await client.post(
            "/admin/users",
            json={"username": "should-not-exist"},
            cookies={"morai_session": admin_token},
        )

    rows = (
        (
            await superuser_db_session.execute(
                select(User).where(User.username == "should-not-exist")
            )
        )
        .scalars()
        .all()
    )
    assert rows == []
