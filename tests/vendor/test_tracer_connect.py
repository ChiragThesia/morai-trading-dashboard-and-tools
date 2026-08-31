"""Task 1: one OAuth handshake, end to end, with the token proved to be in
Postgres (CONN-01, CONN-02, CONN-03, CONN-04, CONN-07, D4-11).

`@pytest.mark.db` throughout -- every test drives the real ASGI app over
`httpx.ASGITransport` against real Postgres, matching
`tests/identity/test_login_logout.py`'s established pattern. The token
write is read back through `superuser_db_session` -- an engine independent
of the app's -- so persistence is proven rather than an in-memory echo
(landmine 1: an `async def` `token_write_func` would leave this row absent
while the callback still returned 200).

No live Schwab call happens anywhere in this file (D4-14) -- every
assertion runs against `FakeSchwabAuth`/`FakeSchwabClient`, installed via
FastAPI's `dependency_overrides` against `routes_connections.get_schwab_auth`.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models_connections import ConnectionResponse, ConnectResponse
from morai.api.routes_connections import get_schwab_auth
from morai.db.models import SchwabConnection
from morai.vendor.protocol import AccountNumberEntry
from tests.vendor.conftest import FakeSchwabAuth

pytestmark = pytest.mark.db

_TOKEN_CREATED_AT = datetime(2026, 8, 31, 12, 0, tzinfo=UTC)

_CONNECT_RESPONSE: TypeAdapter[ConnectResponse] = TypeAdapter(ConnectResponse)
_CONNECTION_RESPONSE: TypeAdapter[ConnectionResponse] = TypeAdapter(ConnectionResponse)


@pytest_asyncio.fixture(autouse=True)
async def install_fake_schwab_auth() -> AsyncGenerator[FakeSchwabAuth, None]:
    """Installed for every test in this module -- the one place
    `get_schwab_auth` is overridden, so a test that forgets to install its
    own fake still runs against zero network calls rather than a real
    adapter that would need real credentials."""
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
    """POSTs `/schwab/connect` and returns the raw `state` embedded in the
    authorize URL -- every test below needs this same first step."""
    response = await client.post("/schwab/connect")
    assert response.status_code == 200
    body = _CONNECT_RESPONSE.validate_json(response.content)
    return _extract_state(body.authorize_url)


async def test_full_handshake_lands_one_encrypted_row_read_back_independently(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    install_fake_schwab_auth: FakeSchwabAuth,
) -> None:
    raw_state = await _connect(logged_in_client)

    callback_response = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert callback_response.status_code == 200

    rows = (
        (await superuser_db_session.execute(select(SchwabConnection))).scalars().all()
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.token_ciphertext
    assert row.token_nonce
    assert row.account_hash_ciphertext
    assert row.account_hash_nonce
    assert row.key_version == 1
    assert row.token_created_at == _TOKEN_CREATED_AT

    # Confidentiality (D4-11): the plaintext refresh-token bytes are not a
    # substring of the stored ciphertext.
    assert f"fake-refresh-{raw_state}".encode() not in row.token_ciphertext


async def test_callback_response_is_deliberately_empty_and_names_nothing(
    logged_in_client: AsyncClient,
) -> None:
    raw_state = await _connect(logged_in_client)

    callback_response = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )

    assert callback_response.status_code == 200
    assert callback_response.content == b"{}"


async def test_connection_reads_healthy_with_expires_at_seven_days_out(
    logged_in_client: AsyncClient,
) -> None:
    raw_state = await _connect(logged_in_client)
    callback_response = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert callback_response.status_code == 200

    connection_response = await logged_in_client.get("/schwab/connection")

    assert connection_response.status_code == 200
    body = _CONNECTION_RESPONSE.validate_json(connection_response.content)
    assert body.health == "healthy"
    assert body.last_synced_at is None
    assert body.expires_at == _TOKEN_CREATED_AT + timedelta(days=7)


async def test_replaying_the_same_callback_returns_400_and_adds_no_second_row(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
) -> None:
    raw_state = await _connect(logged_in_client)

    first = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert first.status_code == 200

    replay = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert replay.status_code == 400

    rows = (
        (await superuser_db_session.execute(select(SchwabConnection))).scalars().all()
    )
    assert len(rows) == 1


async def test_no_log_record_contains_the_code_or_state(
    logged_in_client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """CONN-03, D4-08, `NN-34`: mirrors
    `test_no_log_record_from_login_contains_password_token_or_hash`'s own
    shape, scoped to loggers under the `morai` namespace -- not the whole
    `caplog.text`. `httpx`'s own client-side request logger (`INFO
    HTTP Request: GET http://test/schwab/callback?code=...&state=...`) is
    an artifact of driving this test over `ASGITransport` in-process, not
    a code path this project wrote, and would fail this assertion for
    every GET request regardless of application behaviour. Proves the
    application's own logger never carries the bearer-equivalent code or
    state; it cannot prove Hypercorn's access log stays off in production
    -- that gap is recorded honestly as Manual-Only in `04-VALIDATION.md`,
    not claimed here."""
    raw_code = "fake-auth-code-should-never-be-logged"
    with caplog.at_level(logging.DEBUG):
        raw_state = await _connect(logged_in_client)
        callback_response = await logged_in_client.get(
            "/schwab/callback", params={"code": raw_code, "state": raw_state}
        )
    assert callback_response.status_code == 200

    app_log_text = "\n".join(
        record.getMessage()
        for record in caplog.records
        if record.name.startswith("morai")
    )
    assert raw_state not in app_log_text
    assert raw_code not in app_log_text


async def test_callback_with_no_session_cookie_still_succeeds(
    logged_in_client: AsyncClient,
) -> None:
    """CONN-02: the consumed state is the only credential -- the callback
    is reachable with no `morai_session` cookie at all, exactly as a real
    OAuth redirect from Schwab's own domain would arrive."""
    from morai.api.app import app

    raw_state = await _connect(logged_in_client)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        callback_response = await client.get(
            "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
        )
    assert callback_response.status_code == 200
