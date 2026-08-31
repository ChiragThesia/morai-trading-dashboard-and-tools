"""Criterion 5: connection health, its band boundaries, and the two honest
gaps (CONN-04, CONN-07, D4-12, D4-15, D4-16).

Task 1 proves `derive_connection_health` as a pure function over
`(token_created_at, now)`, with both boundaries -- the twelve-hour
`expiring_soon` threshold and the seven-day `expired` mark -- asserted on
both sides, one second either way, with named case ids (D-06's own idiom,
`tests/identity/test_setup_tokens.py::test_expired_token_returns_none_and_row_is_left_in_place`'s
negative-offset-as-parameter shape, not clock injection machinery). It then
reads the same three bands back through `GET /schwab/connection`, so the
route and the unit proof cannot drift apart, and proves a real refresh
through `schwab_client_for_user` leaves the reported `expires_at` unchanged
-- `tests/vendor/test_refresh_lock.py`'s own
`test_two_concurrent_refreshes_of_one_user_serialise_and_neither_fails`
(04-03) already asserts the *stored* `token_created_at` is untouched; this
asserts the consequence a user actually sees through the route.

Task 2 proves `last_synced_at` and `reauth_notified_at` read back `null`,
in Postgres and in the API response, after both a connect and a refresh --
an honest gap (NN-16), not a fabricated value. Nothing in this phase writes
either column.

No live Schwab call happens anywhere in this file (D4-14) -- every
assertion runs against `FakeSchwabAuth`/`FakeSchwabClient`. The real
seven-day window is not observed here and cannot be inside a test run
(D4-15) -- what is proven is the derivation and its boundaries.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.api.models_connections import ConnectionResponse, ConnectResponse
from morai.api.routes_connections import get_schwab_auth
from morai.db.models import SchwabConnection
from morai.settings import get_settings
from morai.vendor.connections import (
    ConnectionHealth,
    derive_connection_health,
    schwab_client_for_user,
)
from morai.vendor.connections import (
    _EXPIRING_SOON_THRESHOLD as _THRESHOLD,  # pyright: ignore[reportPrivateUsage]  # why: the test boundaries must track the real threshold, not a hand-copied duplicate that could silently drift from it.
)
from morai.vendor.connections import (
    _REFRESH_TOKEN_LIFETIME as _LIFETIME,  # pyright: ignore[reportPrivateUsage]  # why: same as _EXPIRING_SOON_THRESHOLD above.
)
from morai.vendor.protocol import AccountNumberEntry
from tests.vendor.conftest import FakeSchwabAuth, SeededUsers

_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)
_TOKEN_CREATED_AT = datetime(2026, 8, 31, 12, 0, tzinfo=UTC)

_CONNECT_RESPONSE: TypeAdapter[ConnectResponse] = TypeAdapter(ConnectResponse)
_CONNECTION_RESPONSE: TypeAdapter[ConnectionResponse] = TypeAdapter(ConnectionResponse)


@pytest_asyncio.fixture(autouse=True)
async def install_fake_schwab_auth() -> AsyncGenerator[FakeSchwabAuth, None]:
    """Mirrors `test_tracer_connect.py`'s own fixture -- installed for every
    test in this module."""
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


async def _run_a_refresh(user_id: UUID, auth: FakeSchwabAuth) -> None:
    """One full `schwab_client_for_user` cycle on its own engine and
    session, connected as `morai_app` -- the same shape
    `test_refresh_lock.py::_refresh_over_own_engine` already establishes."""
    engine = create_async_engine(get_settings().app_async_dsn)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user_id)},
            )
            async with schwab_client_for_user(session, user_id, auth):
                pass
            await session.commit()
    finally:
        await engine.dispose()


# --- Task 1: bands, boundaries, and the anchor -----------------------------


@pytest.mark.parametrize(
    ("offset_from_created", "expected_health"),
    [
        pytest.param(
            timedelta(days=1), ConnectionHealth.HEALTHY, id="healthy-well-within-window"
        ),
        pytest.param(
            _LIFETIME - _THRESHOLD - timedelta(seconds=1),
            ConnectionHealth.HEALTHY,
            id="healthy-1s-before-expiring_soon-threshold",
        ),
        pytest.param(
            _LIFETIME - _THRESHOLD + timedelta(seconds=1),
            ConnectionHealth.EXPIRING_SOON,
            id="expiring_soon-1s-after-expiring_soon-threshold",
        ),
        pytest.param(
            _LIFETIME - timedelta(hours=6),
            ConnectionHealth.EXPIRING_SOON,
            id="expiring_soon-mid-band",
        ),
        pytest.param(
            _LIFETIME - timedelta(seconds=1),
            ConnectionHealth.EXPIRING_SOON,
            id="expiring_soon-1s-before-expiry",
        ),
        pytest.param(_LIFETIME, ConnectionHealth.EXPIRED, id="expired-at-expiry-exact"),
        pytest.param(
            _LIFETIME + timedelta(seconds=1),
            ConnectionHealth.EXPIRED,
            id="expired-1s-after-expiry",
        ),
        pytest.param(
            _LIFETIME + timedelta(days=30),
            ConnectionHealth.EXPIRED,
            id="expired-30d-after-expiry",
        ),
    ],
)
def test_health_bands_and_boundaries(
    offset_from_created: timedelta, expected_health: ConnectionHealth
) -> None:
    """Both boundaries -- the twelve-hour threshold and the seven-day mark
    -- asserted on both sides. `expires_at` is checked on every case,
    including the expired ones: a past `expires_at` is a fact, never an
    absence."""
    now = _CREATED_AT + offset_from_created
    health, expires_at = derive_connection_health(_CREATED_AT, now)
    assert health == expected_health
    assert expires_at == _CREATED_AT + _LIFETIME


@pytest.mark.db
@pytest.mark.parametrize(
    ("age_offset", "expected_health"),
    [
        pytest.param(timedelta(hours=1), "healthy", id="healthy-via-route"),
        pytest.param(
            _LIFETIME - timedelta(hours=6),
            "expiring_soon",
            id="expiring_soon-via-route",
        ),
        pytest.param(timedelta(days=8), "expired", id="expired-via-route"),
    ],
)
async def test_connection_health_bands_read_through_the_route(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    age_offset: timedelta,
    expected_health: str,
) -> None:
    """The same three bands, read back through `GET /schwab/connection`
    rather than only through the pure function -- ageing the stored
    `token_created_at` is the same lever
    `test_reauth.py::test_expired_connection_reads_expired_then_healthy_after_reauth`
    already uses."""
    raw_state = await _connect(logged_in_client)
    callback = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert callback.status_code == 200

    aged_created_at = datetime.now(UTC) - age_offset
    await superuser_db_session.execute(
        update(SchwabConnection)
        .where(SchwabConnection.user_id == provisioned_users.user_a)
        .values(token_created_at=aged_created_at)
    )
    await superuser_db_session.commit()

    response = await logged_in_client.get("/schwab/connection")
    assert response.status_code == 200
    body = _CONNECTION_RESPONSE.validate_json(response.content)
    assert body.health == expected_health
    assert body.expires_at == aged_created_at + _LIFETIME


@pytest.mark.db
async def test_refresh_does_not_move_the_reported_expires_at(
    logged_in_client: AsyncClient,
    provisioned_users: SeededUsers,
) -> None:
    """T-04-20, D4-12: `test_refresh_lock.py`'s own
    `test_two_concurrent_refreshes_of_one_user_serialise_and_neither_fails`
    (04-03) already asserts the *stored* `token_created_at` is untouched by
    a real refresh; this asserts the consequence a user actually sees
    through the route -- a derivation that ever started reading a
    different anchor would still pass the stored-column assertion and fail
    only here."""
    raw_state = await _connect(logged_in_client)
    callback = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert callback.status_code == 200

    before = await logged_in_client.get("/schwab/connection")
    assert before.status_code == 200
    before_body = _CONNECTION_RESPONSE.validate_json(before.content)

    refresh_auth = FakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT, account_entries=[]
    )
    await _run_a_refresh(provisioned_users.user_a, refresh_auth)

    after = await logged_in_client.get("/schwab/connection")
    assert after.status_code == 200
    after_body = _CONNECTION_RESPONSE.validate_json(after.content)
    assert after_body.expires_at == before_body.expires_at


# --- Task 2: the two honest gaps --------------------------------------------


@pytest.mark.db
async def test_last_synced_at_and_reauth_notified_at_are_null_after_connect(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """CONN-07, D4-16, NN-16: an honest gap, not a fabricated value. A
    future change that starts writing either column on *attempt* rather
    than on success fails this test rather than passing a plausible-looking
    timestamp through unnoticed -- the same reason
    `morai.ledger.fills.DataKeyMissing`'s own docstring gives for why an
    absence must stay distinguishable."""
    raw_state = await _connect(logged_in_client)
    callback = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert callback.status_code == 200

    response = await logged_in_client.get("/schwab/connection")
    assert response.status_code == 200
    body = _CONNECTION_RESPONSE.validate_json(response.content)
    assert body.last_synced_at is None
    assert body.reauth_notified_at is None

    row = (
        await superuser_db_session.execute(
            select(SchwabConnection).where(
                SchwabConnection.user_id == provisioned_users.user_a
            )
        )
    ).scalar_one()
    assert row.last_synced_at is None
    assert row.reauth_notified_at is None


@pytest.mark.db
async def test_last_synced_at_and_reauth_notified_at_stay_null_after_refresh(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """A refresh is not a sync -- both columns are still null afterward,
    both in Postgres and through the route."""
    raw_state = await _connect(logged_in_client)
    callback = await logged_in_client.get(
        "/schwab/callback", params={"code": "fake-auth-code", "state": raw_state}
    )
    assert callback.status_code == 200

    refresh_auth = FakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT, account_entries=[]
    )
    await _run_a_refresh(provisioned_users.user_a, refresh_auth)

    response = await logged_in_client.get("/schwab/connection")
    assert response.status_code == 200
    body = _CONNECTION_RESPONSE.validate_json(response.content)
    assert body.last_synced_at is None
    assert body.reauth_notified_at is None

    row = (
        await superuser_db_session.execute(
            select(SchwabConnection).where(
                SchwabConnection.user_id == provisioned_users.user_a
            )
        )
    ).scalar_one()
    assert row.last_synced_at is None
    assert row.reauth_notified_at is None
