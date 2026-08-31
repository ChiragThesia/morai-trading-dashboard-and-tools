"""Task 3: re-authorisation leaves exactly one row per user -- the other
user's row untouched, and an expired connection repaired to healthy
(CONN-05, D4-09, D4-12).

`tests/vendor/test_tracer_connect.py::test_reauth_repairs_the_row_instead_of_duplicating_it`
(04-01) already proves the core repair-in-place property directly: the row
count stays exactly 1 across a second, genuinely distinct handshake, and
`token_created_at` advances to the new grant's own timestamp, so a no-op
update cannot pass it. This file does not re-prove that. It covers the two
behaviours 04-VALIDATION.md's criterion-3 row and this plan's own
`<behavior>` list name that the existing test does not exercise: that a
second user's row is byte-identical before and after the first user's
re-auth, and that a connection whose token has aged past seven days reads
`expired`, then reads `healthy` again after a real re-auth -- with the row
count for that user still exactly 1 throughout, asserted with `SELECT
count(*)` rather than `scalar_one_or_none`, per the plan's own instruction
that a count is what makes a duplicate-row failure visible rather than
merely surprising.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models_connections import ConnectionResponse, ConnectResponse
from morai.api.routes_connections import get_schwab_auth
from morai.db.models import SchwabConnection, User
from morai.identity.passwords import hash_password
from morai.vendor.protocol import AccountNumberEntry
from tests.vendor.conftest import FakeSchwabAuth, SeededUsers

pytestmark = pytest.mark.db

_PASSWORD = "correct horse battery staple 4"
_TOKEN_CREATED_AT = datetime(2026, 8, 31, 12, 0, tzinfo=UTC)

_CONNECT_RESPONSE: TypeAdapter[ConnectResponse] = TypeAdapter(ConnectResponse)
_CONNECTION_RESPONSE: TypeAdapter[ConnectionResponse] = TypeAdapter(ConnectionResponse)

_Snapshot = tuple[
    bytes,
    bytes,
    bytes,
    bytes,
    int,
    datetime,
    datetime | None,
    datetime | None,
    datetime,
]


@pytest_asyncio.fixture(autouse=True)
async def install_fake_schwab_auth() -> AsyncGenerator[FakeSchwabAuth, None]:
    """Mirrors `test_tracer_connect.py`'s own fixture -- installed for
    every test in this module."""
    from morai.api.app import app

    fake = FakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT,
        account_entries=[
            AccountNumberEntry.model_validate(
                {"accountNumber": "12345678", "hashValue": "ABC123HASH"}
            )
        ],
    )
    app.dependency_overrides[get_schwab_auth] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_schwab_auth, None)


def _extract_state(authorize_url: str) -> str:
    from urllib.parse import parse_qs, urlparse

    query = parse_qs(urlparse(authorize_url).query)
    return query["state"][0]


async def _connect(client: AsyncClient) -> str:
    response = await client.post("/schwab/connect")
    assert response.status_code == 200
    body = _CONNECT_RESPONSE.validate_json(response.content)
    return _extract_state(body.authorize_url)


async def _login_client(
    superuser_db_session: AsyncSession, user_id: UUID, username: str
) -> AsyncClient:
    """Mirrors `tests/vendor/conftest.py`'s own `logged_in_client`,
    generalised to either seeded user -- the other-user-untouched test
    needs both at once."""
    from morai.api.app import app

    await superuser_db_session.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=hash_password(_PASSWORD))
    )
    await superuser_db_session.commit()

    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    login = await client.post(
        "/login", json={"username": username, "password": _PASSWORD}
    )
    assert login.status_code == 200
    client.cookies.set("morai_session", login.cookies["morai_session"])
    return client


async def _row_for(session: AsyncSession, user_id: UUID) -> SchwabConnection:
    return (
        await session.execute(
            select(SchwabConnection).where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one()


def _snapshot(row: SchwabConnection) -> _Snapshot:
    """Every column, so an update that touches a field this test wouldn't
    otherwise check still fails the byte-identical assertion."""
    return (
        row.account_hash_ciphertext,
        row.account_hash_nonce,
        row.token_ciphertext,
        row.token_nonce,
        row.key_version,
        row.token_created_at,
        row.last_synced_at,
        row.reauth_notified_at,
        row.created_at,
    )


async def _row_count_for(session: AsyncSession, user_id: UUID) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(SchwabConnection)
            .where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one()


async def test_reauth_leaves_the_other_users_row_byte_identical(
    provisioned_users: SeededUsers,
    superuser_db_session: AsyncSession,
    install_fake_schwab_auth: FakeSchwabAuth,
) -> None:
    """CONN-05, T-04-14: a second user's row is untouched by the first
    user's re-auth. 04-VALIDATION.md names the trap for this criterion as
    an assertion scoped to "a valid connection exists" rather than to that
    specific user's own row -- which a cross-user write would still pass;
    this test snapshots every column of `user_b`'s row and asserts it is
    identical after `user_a` re-authorises."""
    client_a = await _login_client(
        superuser_db_session, provisioned_users.user_a, "user-a"
    )
    client_b = await _login_client(
        superuser_db_session, provisioned_users.user_b, "user-b"
    )
    try:
        state_a1 = await _connect(client_a)
        first_a = await client_a.get(
            "/schwab/callback", params={"code": "code-a1", "state": state_a1}
        )
        assert first_a.status_code == 200

        state_b = await _connect(client_b)
        callback_b = await client_b.get(
            "/schwab/callback", params={"code": "code-b", "state": state_b}
        )
        assert callback_b.status_code == 200

        before = _snapshot(
            await _row_for(superuser_db_session, provisioned_users.user_b)
        )

        later = _TOKEN_CREATED_AT + timedelta(days=1)
        install_fake_schwab_auth.fixed_created_at = later
        state_a2 = await _connect(client_a)
        second_a = await client_a.get(
            "/schwab/callback", params={"code": "code-a2", "state": state_a2}
        )
        assert second_a.status_code == 200

        after = _snapshot(
            await _row_for(superuser_db_session, provisioned_users.user_b)
        )
        assert after == before

        assert await _row_count_for(superuser_db_session, provisioned_users.user_a) == 1
    finally:
        await client_a.aclose()
        await client_b.aclose()


async def test_expired_connection_reads_expired_then_healthy_after_reauth(
    provisioned_users: SeededUsers,
    superuser_db_session: AsyncSession,
    install_fake_schwab_auth: FakeSchwabAuth,
) -> None:
    """CONN-05, D4-12: a connection whose `token_created_at` is eight days
    old reads `expired`, and re-authorising it repairs the same row to
    `healthy` -- no operator step anywhere in the flow, and the row count
    for that user stays exactly 1 throughout. This is criterion 3's
    remaining half: `test_reauth_repairs_the_row_instead_of_duplicating_it`
    (04-01) proves the repair-in-place shape; this proves it is what a
    real user hits when their connection has actually expired, not just
    when they choose to reconnect early."""
    client = await _login_client(
        superuser_db_session, provisioned_users.user_a, "user-a"
    )
    try:
        state = await _connect(client)
        first = await client.get(
            "/schwab/callback", params={"code": "code-1", "state": state}
        )
        assert first.status_code == 200

        eight_days_ago = _TOKEN_CREATED_AT - timedelta(days=8)
        await superuser_db_session.execute(
            update(SchwabConnection)
            .where(SchwabConnection.user_id == provisioned_users.user_a)
            .values(token_created_at=eight_days_ago)
        )
        await superuser_db_session.commit()

        expired_response = await client.get("/schwab/connection")
        assert expired_response.status_code == 200
        expired_body = _CONNECTION_RESPONSE.validate_json(expired_response.content)
        assert expired_body.health == "expired"
        assert expired_body.expires_at < datetime.now(UTC)

        now = datetime.now(UTC)
        install_fake_schwab_auth.fixed_created_at = now
        second_state = await _connect(client)
        second = await client.get(
            "/schwab/callback", params={"code": "code-2", "state": second_state}
        )
        assert second.status_code == 200

        healthy_response = await client.get("/schwab/connection")
        assert healthy_response.status_code == 200
        healthy_body = _CONNECTION_RESPONSE.validate_json(healthy_response.content)
        assert healthy_body.health == "healthy"
        assert healthy_body.expires_at > datetime.now(UTC)

        assert await _row_count_for(superuser_db_session, provisioned_users.user_a) == 1
    finally:
        await client.aclose()
