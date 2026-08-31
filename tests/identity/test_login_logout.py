"""Tests for login (AUTH-02, AUTH-03): a session that survives a client
restart, and the two login failure branches made indistinguishable.

`@pytest.mark.db` throughout -- every test drives the real ASGI app over
`httpx.ASGITransport` against real Postgres, matching
`test_admin_routes.py`'s established pattern. Passwords are set directly
through the superuser session (there is no admin-driven password-setting
flow independent of `/setup`'s token consumption, and testing login doesn't
need to also exercise `/setup`).

The client-restart test proves persistence against `/gate/user-scoped-probe`
(an existing authenticated route, plan 02-01) rather than `/me` -- `/me`
belongs to plan 02-06's own logout task and does not exist yet when this
task's tests run.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Session as SessionRow
from morai.db.models import User
from morai.identity.passwords import hash_password
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

_PASSWORD = "correct horse battery staple 4"


async def _set_password(
    superuser_db_session: AsyncSession, user_id: UUID, password: str
) -> None:
    await superuser_db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=hash_password(password))
    )
    await superuser_db_session.commit()


@pytest_asyncio.fixture
async def client(clean_identity_tables: None) -> AsyncGenerator[AsyncClient, None]:
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_correct_credentials_return_200_and_a_well_formed_cookie(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)

    response = await client.post(
        "/login", json={"username": "user-a", "password": _PASSWORD}
    )

    assert response.status_code == 200
    # Asserted from the raw header, not httpx's cookie jar -- the jar
    # discards attributes, which are the whole point of this test.
    raw_cookie = response.headers["set-cookie"].lower()
    assert "morai_session=" in raw_cookie
    assert "httponly" in raw_cookie
    assert "secure" in raw_cookie
    assert "samesite=lax" in raw_cookie
    assert "path=/" in raw_cookie
    assert "max-age=" in raw_cookie or "expires=" in raw_cookie


async def test_persistent_cookie_survives_a_client_restart(
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
    clean_identity_tables: None,
) -> None:
    """Criterion 2's 'across a browser restart', expressed as the only thing
    an HTTP test can actually assert about it: a fresh `AsyncClient` with
    only the cookie value carried forward, no other client-side state."""
    from morai.api.app import app

    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as first:
        login = await first.post(
            "/login", json={"username": "user-a", "password": _PASSWORD}
        )
        assert login.status_code == 200
        raw_token = login.cookies["morai_session"]

    async with AsyncClient(transport=transport, base_url="http://test") as second:
        probe_response = await second.get(
            "/gate/user-scoped-probe", cookies={"morai_session": raw_token}
        )

    assert probe_response.status_code == 200


async def test_stored_token_hash_is_sha256_of_raw_and_raw_appears_nowhere(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)

    response = await client.post(
        "/login", json={"username": "user-a", "password": _PASSWORD}
    )
    raw_token = response.cookies["morai_session"]

    rows = (await superuser_db_session.execute(select(SessionRow))).scalars().all()
    assert len(rows) == 1
    assert rows[0].token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
    assert raw_token not in rows[0].token_hash


async def test_wrong_password_returns_401_with_an_opaque_body(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)

    response = await client.post(
        "/login", json={"username": "user-a", "password": "definitely-wrong"}
    )

    assert response.status_code == 401
    assert "user-a" not in response.text


async def test_unknown_username_returns_a_body_byte_identical_to_wrong_password(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)

    wrong_password = await client.post(
        "/login", json={"username": "user-a", "password": "definitely-wrong"}
    )
    unknown_username = await client.post(
        "/login", json={"username": "no-such-user", "password": "definitely-wrong"}
    )

    assert wrong_password.status_code == unknown_username.status_code == 401
    assert wrong_password.content == unknown_username.content


async def test_a_user_never_set_up_cannot_log_in_with_any_password(
    client: AsyncClient, seeded_users: SeededUsers
) -> None:
    """`seeded_users.user_b` has a null `password_hash` -- never consumed a
    `/setup` token."""
    empty_password = await client.post(
        "/login", json={"username": "user-b", "password": ""}
    )
    real_looking_password = await client.post(
        "/login", json={"username": "user-b", "password": "any-password-at-all"}
    )

    assert empty_password.status_code == 401
    assert real_looking_password.status_code == 401


async def test_no_log_record_from_login_contains_password_token_or_hash(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
    caplog: pytest.LogCaptureFixture,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)

    with caplog.at_level(logging.DEBUG):
        response = await client.post(
            "/login", json={"username": "user-a", "password": _PASSWORD}
        )
        raw_token = response.cookies["morai_session"]
        await client.post(
            "/login", json={"username": "user-a", "password": "a-second-wrong-one"}
        )

    row = (
        await superuser_db_session.execute(
            select(SessionRow).where(SessionRow.user_id == seeded_users.user_a)
        )
    ).scalar_one()

    log_text = caplog.text
    assert _PASSWORD not in log_text
    assert "a-second-wrong-one" not in log_text
    assert raw_token not in log_text
    assert row.token_hash not in log_text
