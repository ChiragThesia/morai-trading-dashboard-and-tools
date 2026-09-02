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
from uuid import UUID

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
from tests.ledger.conftest import (
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
)
from tests.vendor.conftest import (
    _FAKE_REFRESH_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: this fixture's TxFakeSchwabAuth.build_client reproduces FakeSchwabAuth.build_client's own rotation body exactly (see its docstring below), so it needs the same TypeAdapter that module already validates the fake token shape with -- one cooperating pair, same convention db/models.py already uses for _FILL_WRITE_TOKEN.
    _WRAPPED_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: see _FAKE_REFRESH_TOKEN above.
    FakeSchwabAuth,
    FakeSchwabClient,
    clean_connection_tables,
    logged_in_client,
)

# Re-exported, not merely imported -- see this module's own docstring and
# `tests/vendor/conftest.py`'s identical convention. `clean_connection_tables`/
# `logged_in_client` (task 2, 06-03-PLAN.md): `tests/vendor/conftest.py` is
# not an ancestor conftest of this directory, so `logged_in_client`'s own
# fixture dependencies must be re-exported here too, not only the fixture
# itself, for pytest to resolve them by name.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_connection_tables",
    "clean_identity_tables",
    "clean_ingest_tables",
    "clean_ledger_tables",
    "clean_reconciliation_tables",
    "clean_snapshot_tables",
    "logged_in_client",
    "provisioned_users",
    "quote_fake_auth",
    "seeded_position",
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


@pytest_asyncio.fixture
async def clean_reconciliation_tables(
    clean_ingest_tables: None,
) -> AsyncGenerator[None, None]:
    """Truncate `reconciliation_runs` before each db-marked test, on the
    superuser engine -- same shape as `clean_ingest_tables`/
    `clean_snapshot_tables`."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE reconciliation_runs CASCADE"))
    await engine.dispose()
    yield


@dataclass
class _TxFakeSchwabClient(FakeSchwabClient):
    """`FakeSchwabClient` with a constructor field for the
    `get_transactions` payload it returns -- the base fake's own
    `get_transactions` unconditionally returns `[]` (Phase 4's own tests
    never needed more).

    `windows_by_call` records every `(start_date, end_date)` pair this
    instance is asked for, in call order -- 06-02 Task 3's own proof that
    `sync_user` never leaves either date unset (Pitfall 2, 06-RESEARCH.md).
    `payload_by_window`, if set, returns that window's own payload (or `[]`
    for a window with no entry) instead of the flat `transactions` field --
    06-02 Task 3's own proof that overlapping per-window payloads still
    land once."""

    transactions: JsonValue = field(default_factory=list)
    payload_by_window: dict[tuple[datetime, datetime], JsonValue] | None = None
    windows_by_call: list[tuple[datetime | None, datetime | None]] = field(
        default_factory=list
    )
    # 06-03 Task 1's own rollback-survival proof: `fail_on_call` is the
    # 0-based index of the `get_transactions` call that raises
    # `fail_exception` instead of returning data -- lets a test land at
    # least one window's writes inside the ingest transaction before a
    # later window's call fails, so the failure's rollback has something
    # real to undo.
    fail_on_call: int | None = None
    fail_exception: Exception | None = None

    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        symbol: str | None = None,
    ) -> JsonValue:
        call_index = len(self.windows_by_call)
        self.windows_by_call.append((start_date, end_date))
        if (
            self.fail_on_call is not None
            and call_index == self.fail_on_call
            and self.fail_exception is not None
        ):
            raise self.fail_exception
        if (
            self.payload_by_window is not None
            and start_date is not None
            and end_date is not None
        ):
            return self.payload_by_window.get((start_date, end_date), [])
        return self.transactions


@dataclass
class TxFakeSchwabAuth(FakeSchwabAuth):
    """`FakeSchwabAuth` whose `build_client` returns a
    `_TxFakeSchwabClient` carrying this fixture's own `transactions`
    payload, instead of the base `FakeSchwabClient`. Reproduces
    `FakeSchwabAuth.build_client`'s own rotation body exactly -- only the
    returned client type differs.

    `responses_by_user_id`, if set, selects the returned client's payload
    (or raises the mapped exception) keyed by the user id embedded in the
    connection's own refresh token -- the honest ceiling here: `build_client`
    is `SchwabAuth`'s own `Protocol` method (Phase 4, D4-02) and carries no
    `user_id` parameter, so the refresh token `token_read_func()` yields is
    the only value that can distinguish one user's connection from
    another's inside this method. A caller using this field must seed each
    connection's refresh token as `str(user_id)` (06-02 Task 1's own
    `_seed_connection`) for the lookup to resolve; a token that is not a
    valid UUID, or that has no entry, falls back to the flat `transactions`
    field, so a single-user test needs no mapping at all.

    `last_client`, set on every call, is the one `_TxFakeSchwabClient`
    instance this call actually returned -- `sync_user` opens exactly one
    client per invocation and drives every window's `get_transactions`
    call through it, so a test reads `windows_by_call` back off this
    reference after the call, since no other reference to that instance
    ever leaves `schwab_client_for_user`'s own context manager."""

    transactions: JsonValue = field(default_factory=list)
    responses_by_user_id: dict[UUID, JsonValue | Exception] = field(
        default_factory=dict
    )
    payload_by_window: dict[tuple[datetime, datetime], JsonValue] | None = None
    # Threaded straight through to the `_TxFakeSchwabClient` this auth
    # builds -- see that class's own docstring for what these do.
    fail_on_call: int | None = None
    fail_exception: Exception | None = None
    last_client: _TxFakeSchwabClient | None = field(default=None, init=False)

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

        response: JsonValue | Exception = self.transactions
        if self.responses_by_user_id:
            try:
                selector = UUID(current.refresh_token)
            except ValueError:
                selector = None
            if selector is not None and selector in self.responses_by_user_id:
                response = self.responses_by_user_id[selector]
        if isinstance(response, Exception):
            raise response

        client = _TxFakeSchwabClient(
            account_entries=self.account_entries,
            transactions=response,
            payload_by_window=self.payload_by_window,
            fail_on_call=self.fail_on_call,
            fail_exception=self.fail_exception,
        )
        self.last_client = client
        return client


@pytest.fixture
def tx_fake_auth() -> TxFakeSchwabAuth:
    """A `TxFakeSchwabAuth` whose `get_transactions` returns `TX_PAYLOAD` --
    one TRADE element, two option legs, one bought one sold."""
    return TxFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        transactions=TX_PAYLOAD,
    )


@pytest_asyncio.fixture
async def clean_snapshot_tables(
    clean_ledger_tables: None,
) -> AsyncGenerator[None, None]:
    """Truncate `snapshot_observations, snapshot_marks, snapshot_runs`
    before each db-marked test, on the superuser engine -- same shape as
    `clean_ingest_tables`."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE TABLE snapshot_observations, snapshot_marks, "
                "snapshot_runs CASCADE"
            )
        )
    await engine.dispose()
    yield


# Keyed by the two wire-format symbols `tests/ledger/conftest.py::seeded_position`'s
# legs produce (front SPXW260618P07275000, back SPX260717P07275000) -- the same
# padded literals `TX_PAYLOAD` above already uses for the identical two contracts.
# Four-decimal marks for the Decimal-precision canary (D3-17); both legs share one
# underlying price, a fair approximation for one calendar's two expiries.
QUOTE_PAYLOAD: JsonValue = {
    "SPXW  260618P07275000": {
        "quote": {"mark": 44.8567, "underlyingPrice": 6203.1234},
    },
    "SPX   260717P07275000": {
        "quote": {"mark": 30.1233, "underlyingPrice": 6203.1234},
    },
}


@dataclass
class QuoteFakeSchwabClient(FakeSchwabClient):
    """`FakeSchwabClient` with a constructor field for the `get_quotes`
    payload it returns -- the base fake's own `get_quotes` unconditionally
    returns `{}` (Phase 4's own tests never needed more)."""

    quotes: JsonValue = field(default_factory=dict)

    async def get_quotes(self, symbols: list[str]) -> JsonValue:
        return self.quotes


@dataclass
class QuoteFakeSchwabAuth(FakeSchwabAuth):
    """`FakeSchwabAuth` whose `build_client` returns a
    `QuoteFakeSchwabClient` carrying this fixture's own `quotes` payload,
    instead of the base `FakeSchwabClient`. Reproduces
    `FakeSchwabAuth.build_client`'s own rotation body exactly -- only the
    returned client type differs, the same pattern `TxFakeSchwabAuth`
    above already establishes for the sync suite."""

    quotes: JsonValue = field(default_factory=dict)
    last_client: QuoteFakeSchwabClient | None = field(default=None, init=False)

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
        client = QuoteFakeSchwabClient(
            account_entries=self.account_entries, quotes=self.quotes
        )
        self.last_client = client
        return client


@pytest.fixture
def quote_fake_auth() -> QuoteFakeSchwabAuth:
    """A fake `SchwabAuth` whose `build_client` returns a
    `QuoteFakeSchwabClient` fixed to `QUOTE_PAYLOAD` -- one connection,
    one populated `get_quotes` response for both of `seeded_position`'s
    legs."""
    return QuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        quotes=QUOTE_PAYLOAD,
    )
