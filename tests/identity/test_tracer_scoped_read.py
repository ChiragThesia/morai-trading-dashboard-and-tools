"""One authenticated request, RLS-filtered end to end (AUTH-07). This is the
phase's equivalent of Phase 1's 13-fixture oracle -- treat it that way.

The app-role connection is what the ASGI app uses (Task 1 repointed
`get_db_session`), which is what makes this test meaningful: if the app were
still on the superuser engine, every assertion here would pass anyway, with
the policy never evaluated.

There is no login route yet (that's plan 02-06) -- every test seeds its own
`sessions` row directly, through the superuser session, then drives the real
ASGI app over `httpx.ASGITransport`.

`@pytest.mark.db` -- runs only where Postgres is reachable (CI's `test-pytest`
job). There is no local database (Docker's daemon is broken here, Railway's
Postgres is private-network-only).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.routes_identity import UserScopedProbeResponse
from morai.db.models import Session as SessionRow
from morai.identity.tokens import generate_token, hash_token
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

_PROBE_LIST: TypeAdapter[list[UserScopedProbeResponse]] = TypeAdapter(
    list[UserScopedProbeResponse]
)


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
    """An httpx client against the real ASGI app over `ASGITransport` -- the
    full FastAPI/Pydantic/SQLAlchemy stack runs for real, on the app-role
    engine, no in-memory shortcut."""
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_authenticated_user_sees_only_their_own_probe_rows(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    token = await _seed_session(superuser_db_session, seeded_users.user_a)
    response = await client.get(
        "/gate/user-scoped-probe", cookies={"morai_session": token}
    )
    assert response.status_code == 200
    # `response.json()` types as `Any` (httpx's own stub) -- validated through
    # the response model, the untrusted-input boundary this project's
    # no-`Any` policy requires, rather than indexed as a raw list of dicts.
    rows = _PROBE_LIST.validate_python(response.json())
    assert {row.probe_id for row in rows} == {seeded_users.probe_a}


async def test_requesting_another_users_row_by_id_returns_404(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    token = await _seed_session(superuser_db_session, seeded_users.user_a)
    response = await client.get(
        f"/gate/user-scoped-probe/{seeded_users.probe_b}",
        cookies={"morai_session": token},
    )
    assert response.status_code == 404


async def test_404_for_absent_row_is_byte_identical_to_404_for_another_users_row(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """A 403 would confirm the row exists, which is itself the disclosure
    D2-08 forbids -- so identical bodies is the assertion, not "both are
    404"."""
    token = await _seed_session(superuser_db_session, seeded_users.user_a)
    other_users_row = await client.get(
        f"/gate/user-scoped-probe/{seeded_users.probe_b}",
        cookies={"morai_session": token},
    )
    truly_absent_row = await client.get(
        f"/gate/user-scoped-probe/{uuid4()}",
        cookies={"morai_session": token},
    )
    assert other_users_row.status_code == 404
    assert truly_absent_row.status_code == 404
    assert other_users_row.content == truly_absent_row.content


async def test_no_cookie_returns_401(client: AsyncClient) -> None:
    response = await client.get("/gate/user-scoped-probe")
    assert response.status_code == 401


async def test_token_not_in_table_returns_401(client: AsyncClient) -> None:
    response = await client.get(
        "/gate/user-scoped-probe", cookies={"morai_session": "not-a-real-token"}
    )
    assert response.status_code == 401
