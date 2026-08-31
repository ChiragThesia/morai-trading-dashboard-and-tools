"""Task 1: genuinely concurrent OAuth callbacks, and one `oauth_state` nonce
consumed exactly once (CONN-01, CONN-02, `NN-35`, D4-06, D4-07).

`@pytest.mark.db` throughout -- every test that reaches the route drives the
real ASGI app over `httpx.ASGITransport` against real Postgres, matching
`tests/vendor/test_tracer_connect.py`'s established pattern. The
concurrent-consume test instead calls `consume_token` directly on two
independent engines, mirroring
`tests/identity/test_setup_tokens.py::test_concurrent_consume_produces_exactly_one_winner`
exactly -- the race lives inside that one statement, and two sessions on one
engine would not prove it: a single connection serialises the two
statements and the race never happens.

No live Schwab call happens anywhere in this file (D4-14) -- every
assertion runs against a local `SchwabAuth` fake, installed via FastAPI's
`dependency_overrides` against `routes_connections.get_schwab_auth`.
"""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.api.models_connections import ConnectResponse
from morai.api.routes_connections import get_schwab_auth
from morai.db.models import SchwabConnection, User
from morai.identity.passwords import hash_password
from morai.identity.setup_tokens import TokenPurpose, consume_token, issue_token
from morai.settings import get_settings
from morai.vendor.connections import read_connection
from morai.vendor.protocol import AccountNumberEntry, ExchangedToken, SchwabClient
from tests.vendor.conftest import FakeSchwabAuth, FakeSchwabClient, SeededUsers

pytestmark = pytest.mark.db

_PASSWORD = "correct horse battery staple 4"
_TOKEN_CREATED_AT = datetime(2026, 8, 31, 12, 0, tzinfo=UTC)

_CONNECT_RESPONSE: TypeAdapter[ConnectResponse] = TypeAdapter(ConnectResponse)


@pytest_asyncio.fixture(autouse=True)
async def install_fake_schwab_auth() -> AsyncGenerator[FakeSchwabAuth, None]:
    """The plain, non-barrier fake -- installed for every test in this
    module, mirroring `test_tracer_connect.py`'s own fixture, so a test
    that only needs one ordinary handshake doesn't have to install its own
    override. The concurrent-callback test below overrides this with its
    own barrier-gated fake for the duration of that one test; this
    fixture's teardown still pops whatever key is installed by then."""
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


async def _login_client(
    superuser_db_session: AsyncSession, user_id: UUID, username: str
) -> AsyncClient:
    """One authenticated `AsyncClient` for `username`, mirroring
    `tests/vendor/conftest.py`'s own `logged_in_client` -- generalised to
    either seeded user, since the concurrent-callback test below needs both
    at once and `logged_in_client` only ever logs in `user_a`."""
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
    # `login` sets `Secure`; see `logged_in_client`'s own comment for why
    # this bypasses httpx's scheme check the same way a real HTTPS browser
    # session would for free.
    client.cookies.set("morai_session", login.cookies["morai_session"])
    return client


@dataclass
class _BarrierGatedSchwabAuth:
    """A minimal `SchwabAuth`, local to this test, that waits on a size-2
    `asyncio.Barrier` before returning from `exchange_callback` -- if the
    two callbacks were serialised instead of genuinely overlapping, the
    first blocks on a barrier the second never reaches, and
    `asyncio.wait_for`'s `TimeoutError` is the failure. 04-VALIDATION.md
    names this as criterion 1's trap: a version of this test without the
    barrier passes just as readily against a serialised implementation.

    Returns account entries keyed by `raw_state`, not a fixed shared list
    -- what makes the account-hash cross-check below meaningful. If the
    route ever crossed one user's exchange result onto the other's row,
    the stored hash would not match the state that row's own callback
    carried.
    """

    barrier: asyncio.Barrier
    fixed_created_at: datetime
    timeout: float = 5.0

    def build_authorize_url(self, raw_state: str) -> str:
        return f"https://fake-schwab.test/authorize?state={raw_state}"

    async def exchange_callback(
        self, received_url: str, *, raw_state: str
    ) -> tuple[ExchangedToken, SchwabClient]:
        await asyncio.wait_for(self.barrier.wait(), timeout=self.timeout)
        exchanged = ExchangedToken(
            token={"refresh_token": f"fake-refresh-{raw_state}"},
            created_at=self.fixed_created_at,
        )
        client: SchwabClient = FakeSchwabClient(
            account_entries=[
                AccountNumberEntry.model_validate(
                    {
                        "accountNumber": f"ACCT-{raw_state}",
                        "hashValue": f"HASH-{raw_state}",
                    }
                )
            ]
        )
        return exchanged, client


async def test_two_overlapping_callbacks_each_land_their_own_users_row(
    provisioned_users: SeededUsers,
    superuser_db_session: AsyncSession,
) -> None:
    """Criterion 1, CONN-01, T-04-13: two users' callbacks in flight at
    once each land their own row, cross-checked by the account hash their
    own callback's `raw_state` produced. Asserting only "two rows exist"
    would pass even if the route swapped the two payloads under
    concurrency -- the account-hash and token-content checks are what
    make a swap fail loudly instead."""
    from morai.api.app import app

    client_a = await _login_client(
        superuser_db_session, provisioned_users.user_a, "user-a"
    )
    client_b = await _login_client(
        superuser_db_session, provisioned_users.user_b, "user-b"
    )
    try:
        state_a = await _connect(client_a)
        state_b = await _connect(client_b)

        barrier = asyncio.Barrier(2)
        barrier_auth = _BarrierGatedSchwabAuth(
            barrier=barrier, fixed_created_at=_TOKEN_CREATED_AT
        )
        app.dependency_overrides[get_schwab_auth] = lambda: barrier_auth

        async def _callback(client: AsyncClient, code: str, state: str) -> Response:
            return await client.get(
                "/schwab/callback", params={"code": code, "state": state}
            )

        # Wraps the gather in a timeout so a serialised implementation --
        # the first coroutine blocked forever on a barrier the second
        # never reaches -- fails loudly here rather than hanging the test
        # run.
        async with asyncio.timeout(10):
            response_a, response_b = await asyncio.gather(
                _callback(client_a, "code-for-user-a", state_a),
                _callback(client_b, "code-for-user-b", state_b),
            )

        assert response_a.status_code == 200
        assert response_b.status_code == 200

        record_a = await read_connection(
            superuser_db_session, provisioned_users.user_a
        )
        record_b = await read_connection(
            superuser_db_session, provisioned_users.user_b
        )
        assert record_a is not None
        assert record_b is not None
        assert record_a.account_hash == f"HASH-{state_a}"
        assert record_b.account_hash == f"HASH-{state_b}"
        assert record_a.token == {"refresh_token": f"fake-refresh-{state_a}"}
        assert record_b.token == {"refresh_token": f"fake-refresh-{state_b}"}
    finally:
        await client_a.aclose()
        await client_b.aclose()


async def test_concurrent_consume_of_one_oauth_state_produces_exactly_one_winner(
    seeded_users: SeededUsers,
    app_db_session: AsyncSession,
) -> None:
    """CONN-02, `NN-35`: mirrors
    `test_setup_tokens.py::test_concurrent_consume_produces_exactly_one_winner`
    exactly, changing only the purpose to `OAUTH_STATE`. Tested at the
    `consume_token` level, not the route level, on purpose -- the race
    lives inside that one atomic `DELETE ... RETURNING` statement, and the
    two-independent-engines shape is what makes it real. The route's own
    use of that mechanism is covered separately, by the replay test below,
    which proves the route passes `OAUTH_STATE` through and honours a
    `None` return with 400."""
    raw = await issue_token(
        app_db_session,
        user_id=seeded_users.user_a,
        purpose=TokenPurpose.OAUTH_STATE,
        ttl=timedelta(minutes=15),
    )
    await app_db_session.commit()

    async def _consume() -> UUID | None:
        engine = create_async_engine(get_settings().app_async_dsn)
        try:
            async with AsyncSession(engine) as session:
                return await consume_token(
                    session, raw_token=raw, purpose=TokenPurpose.OAUTH_STATE
                )
        finally:
            await engine.dispose()

    results = await asyncio.gather(_consume(), _consume())

    # Asserted on the sorted pair, not on which coroutine won -- which is
    # not deterministic and must not be asserted.
    non_none = [r for r in results if r is not None]
    none_count = sum(1 for r in results if r is None)
    assert non_none == [seeded_users.user_a]
    assert none_count == 1


async def test_replayed_unknown_and_expired_states_are_rejected_identically_with_no_row(
    provisioned_users: SeededUsers,
    superuser_db_session: AsyncSession,
) -> None:
    """CONN-02: the failure mode is not an oracle -- a state replayed after
    a successful callback, a state that never existed, and a state past
    its TTL are all rejected with the same 400 and an identical body, and
    none of the three creates a row. The expired case uses a negative TTL,
    this codebase's own existing idiom
    (`test_setup_tokens.py::test_expired_token_returns_none_and_row_is_left_in_place`)
    for proving expiry without waiting."""
    client = await _login_client(
        superuser_db_session, provisioned_users.user_a, "user-a"
    )
    try:
        raw_state = await _connect(client)
        first = await client.get(
            "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
        )
        assert first.status_code == 200

        replay = await client.get(
            "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
        )

        never_issued = secrets.token_urlsafe(32)
        unknown = await client.get(
            "/schwab/callback",
            params={"code": "fake-auth-code", "state": never_issued},
        )

        expired_state = await issue_token(
            superuser_db_session,
            user_id=provisioned_users.user_a,
            purpose=TokenPurpose.OAUTH_STATE,
            ttl=timedelta(seconds=-1),
        )
        await superuser_db_session.commit()
        expired = await client.get(
            "/schwab/callback",
            params={"code": "fake-auth-code", "state": expired_state},
        )

        assert replay.status_code == 400
        assert unknown.status_code == 400
        assert expired.status_code == 400
        assert replay.content == unknown.content == expired.content

        rows = (
            (
                await superuser_db_session.execute(
                    select(SchwabConnection).where(
                        SchwabConnection.user_id == provisioned_users.user_a
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
    finally:
        await client.aclose()
