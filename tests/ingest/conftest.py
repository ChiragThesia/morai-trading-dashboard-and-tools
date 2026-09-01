"""Shared fixtures for the ingest test suite (Phase 6).

Reuses `app_db_session`, `superuser_db_session`, `seeded_users`,
`clean_identity_tables`, `clean_ledger_tables` and `provisioned_users` from
`tests/identity/conftest.py`/`tests/ledger/conftest.py`, the same way
`tests/vendor/conftest.py` already does -- importing the fixture functions
directly rather than `pytest_plugins`.

`_TxFakeSchwabClient`/`TxFakeSchwabAuth` are constructor-field subclasses of
`tests/vendor/conftest.py`'s own `FakeSchwabClient`/`FakeSchwabAuth`, not
changes to that module: Phase 4's existing tests keep the fake they already
assert against (base `get_transactions` still returns `[]`), and this
suite's own `get_transactions` fixture is parameterised from here.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from pydantic import JsonValue
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from morai.settings import get_settings
from morai.vendor.protocol import SchwabClient
from tests.identity.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.conftest import clean_ledger_tables, provisioned_users
from tests.vendor.conftest import (
    _FAKE_REFRESH_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: this fixture's TxFakeSchwabAuth.build_client reproduces FakeSchwabAuth.build_client's own rotation body exactly (see its docstring below), so it needs the same TypeAdapter that module already validates the fake token shape with -- one cooperating pair, same convention db/models.py already uses for _FILL_WRITE_TOKEN.
    _WRAPPED_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: see _FAKE_REFRESH_TOKEN above.
    FakeSchwabAuth,
    FakeSchwabClient,
)

# Re-exported, not merely imported -- see this module's own docstring and
# `tests/vendor/conftest.py`'s identical convention.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_identity_tables",
    "clean_ingest_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
    "tx_fake_auth",
]

# One real-looking TRADE element with two option transferItems -- one
# bought, one sold, so both directions are present from the first commit
# (Pitfall 1, 06-RESEARCH.md: a fixture where every opening leg is a buy
# proves nothing about NN-9). Four-decimal prices for the Decimal-precision
# canary. Symbol carries the OCC-style padding a real Schwab payload is
# assumed to send (Assumptions Log A3-adjacent) -- extraction strips it.
TX_PAYLOAD: list[JsonValue] = [
    {
        "activityId": 1006681717677,
        "type": "TRADE",
        "time": "2026-06-18T14:30:00+00:00",
        "orderId": "1006681717677",
        "transferItems": [
            {
                "instrument": {
                    "symbol": "SPXW  260618P07275000",
                    "assetType": "OPTION",
                },
                "amount": -1,
                "price": 44.8567,
                "cost": 4485.67,
                "positionEffect": "OPENING",
            },
            {
                "instrument": {
                    "symbol": "SPX   260717P07275000",
                    "assetType": "OPTION",
                },
                "amount": 1,
                "price": 30.1233,
                "cost": -3012.33,
                "positionEffect": "OPENING",
            },
        ],
    }
]


@pytest_asyncio.fixture
async def clean_ingest_tables(
    clean_ledger_tables: None,
) -> AsyncGenerator[None, None]:
    """Truncate `broker_transactions` before each db-marked test, on the
    superuser engine -- same shape as `clean_ledger_tables`/
    `clean_connection_tables`."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE broker_transactions CASCADE"))
    await engine.dispose()
    yield


@dataclass
class _TxFakeSchwabClient(FakeSchwabClient):
    """`FakeSchwabClient` with a constructor field for the
    `get_transactions` payload it returns -- the base fake's own
    `get_transactions` unconditionally returns `[]` (Phase 4's own tests
    never needed more)."""

    transactions: JsonValue = field(default_factory=list)

    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        symbol: str | None = None,
    ) -> JsonValue:
        return self.transactions


@dataclass
class TxFakeSchwabAuth(FakeSchwabAuth):
    """`FakeSchwabAuth` whose `build_client` returns a
    `_TxFakeSchwabClient` carrying this fixture's own `transactions`
    payload, instead of the base `FakeSchwabClient`. Reproduces
    `FakeSchwabAuth.build_client`'s own rotation body exactly -- only the
    returned client type differs."""

    transactions: JsonValue = field(default_factory=list)

    async def build_client(
        self,
        token_read_func: Callable[[], object],
        token_write_func: Callable[[object], None],
    ) -> SchwabClient:
        wrapped = _WRAPPED_TOKEN.validate_python(token_read_func())
        current = _FAKE_REFRESH_TOKEN.validate_python(wrapped.token)
        rotated_refresh_token = await self.refresh(current.refresh_token)
        token_write_func(
            {
                "creation_timestamp": wrapped.creation_timestamp,
                "token": {"refresh_token": rotated_refresh_token},
            }
        )
        return _TxFakeSchwabClient(
            account_entries=self.account_entries, transactions=self.transactions
        )


@pytest.fixture
def tx_fake_auth() -> TxFakeSchwabAuth:
    """A `TxFakeSchwabAuth` whose `get_transactions` returns `TX_PAYLOAD` --
    one TRADE element, two option legs, one bought one sold."""
    return TxFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        transactions=TX_PAYLOAD,
    )
