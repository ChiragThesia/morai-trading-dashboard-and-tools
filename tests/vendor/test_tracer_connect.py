"""Task 1: one OAuth handshake, end to end, with the token proved to be in
Postgres (CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-07, D4-11).

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

import httpx
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
# The opaque 500 envelope from `api/errors.py`'s `_opaque_500` -- narrowed
# here rather than read via `.json()`, which types as `Any` (reportAny).
_ERROR_ENVELOPE: TypeAdapter[dict[str, str]] = TypeAdapter(dict[str, str])


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


async def test_reauth_repairs_the_row_instead_of_duplicating_it(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    install_fake_schwab_auth: FakeSchwabAuth,
) -> None:
    """CONN-05, D4-09: a second, genuinely distinct OAuth handshake for the
    same already-connected user repairs the existing row -- an `UPDATE`,
    never a second `INSERT`. Asserted two ways: the row count stays
    exactly 1, and the row's own `token_created_at` moves to the second
    handshake's later timestamp, so this is a real repair, not a no-op
    that happens to leave the count unchanged."""
    first_state = await _connect(logged_in_client)
    first_callback = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code-1", "state": first_state}
    )
    assert first_callback.status_code == 200

    later_created_at = _TOKEN_CREATED_AT + timedelta(days=1)
    install_fake_schwab_auth.fixed_created_at = later_created_at

    second_state = await _connect(logged_in_client)
    second_callback = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code-2", "state": second_state}
    )
    assert second_callback.status_code == 200

    rows = (
        (await superuser_db_session.execute(select(SchwabConnection))).scalars().all()
    )
    assert len(rows) == 1
    assert rows[0].token_created_at == later_created_at


async def test_no_log_record_or_response_body_contains_the_code_url_or_state(
    logged_in_client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
    install_fake_schwab_auth: FakeSchwabAuth,
) -> None:
    """CONN-03, D4-08, `NN-34`: widened (04-02 Task 2) from the original
    success-only proof to also cover the received URL, and to drive a
    rejected-state and a failing-exchange callback alongside the
    successful one. Still scoped to loggers under the `morai` namespace --
    plus `schwab` and `authlib`, explicit regression guards named by 04-02
    -- not the whole `caplog.text`. `httpx`'s own client-side request
    logger (`INFO HTTP Request: GET
    http://test/schwab/callback?code=...&state=...`) is an artifact of
    driving this test over `ASGITransport` in-process, not a code path
    this project wrote, and would fail this assertion for every GET
    request regardless of application behaviour -- that reasoning from the
    original test is sound and is kept, not weakened.

    Raises the root logger to DEBUG via `caplog.at_level`, and explicitly
    raises the `schwab` and `authlib` loggers to DEBUG by name too, so a
    leak from either would be caught rather than filtered out by a
    module-level level setting. Research grepped both and found no logging
    on the OAuth exchange path, so this stays green -- that is the honest
    result, not a weakened assertion manufacturing a red.

    Proves the application's own logger, and the vendor/OAuth-library
    loggers, never carry the bearer-equivalent code, state or received URL
    across a successful callback, a rejected-state callback, and a
    callback whose vendor exchange raises -- and that none of the three
    response bodies does either. It cannot prove Hypercorn's access log
    stays off in production -- that gap is recorded honestly as
    Manual-Only in `04-VALIDATION.md`, not claimed here."""
    from morai.api.app import app

    raw_code = "fake-auth-code-should-never-be-logged"
    never_issued_state = "state-never-issued-should-never-be-logged"

    with (
        caplog.at_level(logging.DEBUG),
        caplog.at_level(logging.DEBUG, logger="schwab"),
        caplog.at_level(logging.DEBUG, logger="authlib"),
    ):
        raw_state = await _connect(logged_in_client)
        success = await logged_in_client.get(
            "/schwab/callback", params={"code": raw_code, "state": raw_state}
        )
        assert success.status_code == 200

        rejected = await logged_in_client.get(
            "/schwab/callback",
            params={"code": raw_code, "state": never_issued_state},
        )
        assert rejected.status_code == 400

        failing_state = await _connect(logged_in_client)
        install_fake_schwab_auth.raise_on_exchange = RuntimeError(
            "exchange failed -- proving the opaque-500 path leaks nothing"
        )
        # The callback route is unauthenticated (`test_callback_with_no_
        # session_cookie_still_succeeds` proves this) -- no cookie needed
        # on this fresh client, which exists only for its
        # `raise_app_exceptions=False`.
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as rc:
            failing = await rc.get(
                "/schwab/callback", params={"code": raw_code, "state": failing_state}
            )
        assert failing.status_code == 500

    app_log_text = "\n".join(
        record.getMessage()
        for record in caplog.records
        if record.name.startswith(("morai", "schwab", "authlib"))
    )
    received_url_fragment = f"code={raw_code}&state="
    for secret in (raw_state, raw_code, never_issued_state, received_url_fragment):
        assert secret not in app_log_text
        assert secret not in success.text
        assert secret not in rejected.text
        assert secret not in failing.text

    # The leak-free path still gives an operator something to correlate on.
    body = _ERROR_ENVELOPE.validate_json(failing.content)
    assert body["error"] == "internal"
    assert "request_id" in body


async def test_no_log_record_contains_the_code_from_a_real_vendor_exception_shape(
    logged_in_client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
    install_fake_schwab_auth: FakeSchwabAuth,
) -> None:
    """CR-02 (`04-REVIEW.md`): the sibling test above proves the opaque-500
    path is clean for a synthetic, author-controlled `RuntimeError` message
    that deliberately carries none of the three secrets -- it cannot prove
    anything about `unhandled_exception_handler`'s actual bug, since that
    handler's `exc_info=exc` renders a formatted traceback whose last line
    is `str(exc)`, and `str(exc)` for a *real* vendor exception is not under
    this codebase's control.

    This test raises a real `httpx.HTTPStatusError` -- the exact exception
    type `SchwabAuthAdapter.exchange_callback` would see from a failing
    real token exchange -- built by calling `Response.raise_for_status()`
    on a 400 whose request URL embeds a fake authorization code. httpx's
    own formatter produces the message text, not this test, so `str(exc)`
    genuinely contains the code the way a real Schwab 400 response would.
    """
    from morai.api.app import app

    fake_code = "FAKE-AUTH-CODE-MUST-NEVER-LEAK-9f3d2a"
    raw_state = await _connect(logged_in_client)

    bad_request = httpx.Request(
        "GET",
        "https://api.schwabapi.com/v1/oauth/token",
        params={"code": fake_code, "grant_type": "authorization_code"},
    )
    bad_response = httpx.Response(400, request=bad_request)
    with pytest.raises(httpx.HTTPStatusError) as raised:
        bad_response.raise_for_status()
    vendor_exc = raised.value
    # Sanity: prove the fixture itself carries the secret, so a later green
    # result means the handler redacted it -- not that the fixture never
    # had it.
    assert fake_code in str(vendor_exc)

    install_fake_schwab_auth.raise_on_exchange = vendor_exc

    with (
        caplog.at_level(logging.DEBUG),
        caplog.at_level(logging.DEBUG, logger="schwab"),
        caplog.at_level(logging.DEBUG, logger="authlib"),
    ):
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as rc:
            failing = await rc.get(
                "/schwab/callback", params={"code": "irrelevant", "state": raw_state}
            )
    assert failing.status_code == 500

    # Formatting each record the way a real handler would -- `getMessage()`
    # alone does not render `exc_info` into text, and the CR-02 bug lives
    # entirely inside that rendering.
    formatter = logging.Formatter()
    app_log_text = "\n".join(
        formatter.format(record)
        for record in caplog.records
        if record.name.startswith(("morai", "schwab", "authlib"))
    )
    assert fake_code not in app_log_text
    assert fake_code not in failing.text


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
