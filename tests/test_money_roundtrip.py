"""The tracer: one money value through HTTP -> strict Pydantic -> Postgres
`NUMERIC(14,4)` -> a fresh `SELECT` -> a JSON string -> parsed back.

`@pytest.mark.db` — runs only where Postgres is reachable (CI's `test-pytest` job).
There is no local database (Docker's daemon is broken here, Railway's Postgres is
private-network-only), so this file cannot run on the authoring machine at all; the
whole module is marked accordingly.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models import MoneyRoundtripRequest, MoneyRoundtripResponse
from morai.db.models import GateMoneyProbe

pytestmark = pytest.mark.db

# The NUMERIC(14,4) ceiling and CONTEXT.md's mid-range example (R-01).
CEILING = "9999999999.9999"
MID_RANGE = "1234567890.1234"


@pytest.mark.parametrize("amount", [CEILING, MID_RANGE])
async def test_money_roundtrips_through_http_and_postgres(
    client: AsyncClient, db_session: AsyncSession, amount: str
) -> None:
    response = await client.post("/gate/money-roundtrip", json={"amount_usd": amount})
    assert response.status_code == 200

    # The response body's amount_usd is a JSON *string* -- asserted on the raw
    # bytes, not the parsed object, which would silently accept a JSON number too
    # (D-03).
    assert f'"amount_usd":"{amount}"' in response.text

    # `response.json()` types as `Any` (httpx's own stub) -- immediately validated
    # through the response model, the untrusted-input boundary this project's own
    # no-`Any` policy requires, rather than indexed as a raw dict.
    parsed = MoneyRoundtripResponse.model_validate(response.json())

    # The API's own output re-validates as its own input (D-03, R-02).
    MoneyRoundtripRequest.model_validate({"amount_usd": parsed.amount_usd})

    # Asserted separately from the HTTP assertion, on a fresh session independent of
    # the app's own, so a failure localises to the database layer or the transport
    # layer.
    fresh = (
        await db_session.execute(
            select(GateMoneyProbe).where(GateMoneyProbe.id == parsed.probe_id)
        )
    ).scalar_one()
    assert fresh.amount_usd == Decimal(amount)


async def test_float_body_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/gate/money-roundtrip", json={"amount_usd": 9999999999.9999}
    )
    assert response.status_code == 422


async def test_int_body_is_rejected(client: AsyncClient) -> None:
    response = await client.post("/gate/money-roundtrip", json={"amount_usd": 123})
    assert response.status_code == 422


async def test_extra_key_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/gate/money-roundtrip",
        json={"amount_usd": MID_RANGE, "unexpected": "field"},
    )
    assert response.status_code == 422


async def test_health_returns_200_with_no_database_call(client: AsyncClient) -> None:
    """`/health`'s handler never depends on `get_db_session` (D-14) -- confirmed by
    code review of `morai.api.app.health`. This test proves the endpoint answers;
    the "no database call" half of the claim is a property of the handler's code,
    not something a passing DB-backed test alone can prove."""
    response = await client.get("/health")
    assert response.status_code == 200
