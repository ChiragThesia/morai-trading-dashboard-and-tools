"""Tests for login, logout and `/me` (AUTH-02, AUTH-03, AUTH-04): a session
that survives a client restart, a logout that deletes the row rather than
flags it, and the two login failure branches made indistinguishable.

Twelve tests: Task 1's seven (login), plus Task 2's five covering six named
behaviors -- Task 2's row-absence and replayed-cookie-rejection checks are
one function by the plan's own explicit instruction (D2-05), so splitting
them apart is not an option: split, both halves would pass against a
client-side-only logout.

`@pytest.mark.db` throughout -- every test drives the real ASGI app over
`httpx.ASGITransport` against real Postgres, matching
`test_admin_routes.py`'s established pattern. Passwords are set directly
through the superuser session (there is no admin-driven password-setting
flow independent of `/setup`'s token consumption, and testing login doesn't
need to also exercise `/setup`).

Task 1's client-restart test proves persistence against
`/gate/user-scoped-probe` (an existing authenticated route, plan 02-01)
rather than `/me`, so that test doesn't reach forward into this task's own
deliverable.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.routes_identity import MeResponse
from morai.db.models import Session as SessionRow
from morai.db.models import User
from morai.identity.passwords import hash_password
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

_PASSWORD = "correct horse battery staple 4"

_ME_RESPONSE: TypeAdapter[MeResponse] = TypeAdapter(MeResponse)


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


# --- Task 1: login ---


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


# --- Task 2: logout and /me ---


async def test_logout_deletes_the_row_and_the_replayed_cookie_is_rejected(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """D2-05, bound into one function on purpose: split apart, both halves
    pass against a client-side-only logout that never touches the row."""
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)
    login = await client.post(
        "/login", json={"username": "user-a", "password": _PASSWORD}
    )
    raw_token = login.cookies["morai_session"]

    logout = await client.post("/logout", cookies={"morai_session": raw_token})
    assert logout.status_code == 204

    # Read through the superuser session -- sessions carries no RLS policy,
    # so this is "the row is gone", not "the row is invisible to me".
    rows = (
        (
            await superuser_db_session.execute(
                select(SessionRow).where(SessionRow.user_id == seeded_users.user_a)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []

    replay = await client.get("/me", cookies={"morai_session": raw_token})
    assert replay.status_code == 401


async def test_logging_out_twice_returns_the_same_result_the_second_time(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)
    login = await client.post(
        "/login", json={"username": "user-a", "password": _PASSWORD}
    )
    raw_token = login.cookies["morai_session"]

    first = await client.post("/logout", cookies={"morai_session": raw_token})
    second = await client.post("/logout", cookies={"morai_session": raw_token})

    assert first.status_code == 204
    # The row is already gone by the second call -- the identical 401 an
    # unauthenticated request gets (see the no-cookie case below), not a
    # crash.
    assert second.status_code == 401


async def test_logout_with_no_cookie_returns_401(client: AsyncClient) -> None:
    response = await client.post("/logout")
    assert response.status_code == 401


async def test_one_users_logout_does_not_touch_another_users_session(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)
    await _set_password(superuser_db_session, seeded_users.user_b, _PASSWORD)

    login_a = await client.post(
        "/login", json={"username": "user-a", "password": _PASSWORD}
    )
    token_a = login_a.cookies["morai_session"]
    login_b = await client.post(
        "/login", json={"username": "user-b", "password": _PASSWORD}
    )
    token_b = login_b.cookies["morai_session"]

    logout_a = await client.post("/logout", cookies={"morai_session": token_a})
    assert logout_a.status_code == 204

    still_valid = await client.get("/me", cookies={"morai_session": token_b})
    assert still_valid.status_code == 200


async def test_me_returns_the_callers_own_record_and_nothing_names_another(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    await _set_password(superuser_db_session, seeded_users.user_a, _PASSWORD)
    login = await client.post(
        "/login", json={"username": "user-a", "password": _PASSWORD}
    )
    raw_token = login.cookies["morai_session"]

    response = await client.get("/me", cookies={"morai_session": raw_token})

    assert response.status_code == 200
    body = _ME_RESPONSE.validate_json(response.content)
    assert body.user_id == seeded_users.user_a
    assert body.username == "user-a"
    assert body.is_admin is False
