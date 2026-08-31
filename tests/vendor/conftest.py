"""Shared fixtures for the vendor connection test suite (Phase 4).

Reuses `app_db_session`, `superuser_db_session`, `seeded_users`,
`clean_identity_tables`, `clean_ledger_tables` and `provisioned_users` from
`tests/identity/conftest.py`/`tests/ledger/conftest.py`, the same way
`tests/identity/test_account_deletion.py` already does -- importing the
fixture functions directly rather than `pytest_plugins`. `clean_ledger_tables`
is re-exported even though no test body below references it directly:
`tests/ledger/conftest.py` is not an applicable conftest for this
directory, and `provisioned_users`'s own fixture function names
`clean_ledger_tables` as one of its parameters -- pytest resolves that name
by lookup in the *requesting* module's namespace, so it must be importable
here too (the exact convention `test_account_deletion.py` already
establishes).

`FakeSchwabAuth`/`FakeSchwabClient` implement `SchwabAuth`/`SchwabClient`
with zero network calls (D4-05) -- built complete here, in this one place,
by plan 04-01, even though that plan's own tests exercised only the success
path and the one-row replay guard. Plans 04-02, 04-03 and 04-04 all depend
on this same fake; 04-02 touches only its own new test files, but 04-03
adds `SchwabAuth.build_client` to the real `Protocol` (CONN-06) and this
fake grows the matching method here, in the one place it already lives,
rather than in a second fake.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, JsonValue, TypeAdapter
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import User
from morai.identity.passwords import hash_password
from morai.settings import get_settings
from morai.vendor.protocol import (
    AccountNumberEntry,
    ExchangedToken,
    SchwabClient,
    WrappedToken,
)
from tests.identity.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.conftest import clean_ledger_tables, provisioned_users

# Re-exported, not merely imported -- see this module's own docstring and
# `tests/ledger/conftest.py`'s identical convention.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_connection_tables",
    "clean_identity_tables",
    "clean_ledger_tables",
    "logged_in_client",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

_PASSWORD = "correct horse battery staple 4"


@pytest_asyncio.fixture
async def clean_connection_tables(
    clean_identity_tables: None,
) -> AsyncGenerator[None, None]:
    """Truncate `schwab_connections` before each db-marked test, on the
    superuser engine -- same shape as `clean_ledger_tables`. Redundant with
    `clean_identity_tables`'s own truncate list (it now includes this table
    too, so identity and connection tests cannot leak rows into each
    other), kept as its own named fixture for the same reason
    `clean_ledger_tables` is its own fixture rather than folded away."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE schwab_connections CASCADE"))
    await engine.dispose()
    yield


@pytest_asyncio.fixture
async def logged_in_client(
    clean_connection_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> AsyncGenerator[AsyncClient, None]:
    """An authenticated `AsyncClient` for `user_a`, mirroring
    `tests/identity/test_login_logout.py`'s own login setup. `user_a`
    already has a data key provisioned (`provisioned_users`) -- the DEK
    `upsert_connection` needs."""
    from morai.api.app import app

    await superuser_db_session.execute(
        update(User)
        .where(User.id == provisioned_users.user_a)
        .values(password_hash=hash_password(_PASSWORD))
    )
    await superuser_db_session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/login", json={"username": "user-a", "password": _PASSWORD}
        )
        assert login.status_code == 200
        # `login` sets `Secure`, so httpx's own cookie jar (correctly)
        # refuses to replay it over this fixture's plain `http://test`
        # base URL on later requests -- setting it directly bypasses that
        # scheme check, the same thing a real HTTPS browser session would
        # do for free.
        client.cookies.set("morai_session", login.cookies["morai_session"])
        yield client


class _FakeRefreshToken(BaseModel):
    """The shape this fake's own tokens always carry -- see
    `FakeSchwabAuth.exchange_callback`'s `{"refresh_token": ...}` payload."""

    refresh_token: str


_WRAPPED_TOKEN: TypeAdapter[WrappedToken] = TypeAdapter(WrappedToken)
_FAKE_REFRESH_TOKEN: TypeAdapter[_FakeRefreshToken] = TypeAdapter(_FakeRefreshToken)


class SchwabInvalidGrantError(RuntimeError):
    """Shaped like Schwab's own `invalid_grant` OAuth error -- raised when a
    refresh token this fake has already rotated away from is handed back."""


class SchwabExpiredRefreshTokenError(RuntimeError):
    """Shaped like a Schwab-reported expired-refresh-token failure."""


class SchwabRateLimitError(RuntimeError):
    """Shaped like a Schwab-reported rate-limit failure."""


@dataclass(frozen=True)
class CallRecord:
    """One call's own entry and exit time, keyed by whatever
    user-distinguishing value the call carried (a raw OAuth `state` for
    `exchange_callback`, a refresh token for `refresh`) -- so overlap and
    ordering can be asserted rather than inferred."""

    key: str
    entered_at: datetime
    exited_at: datetime


@dataclass
class FakeSchwabClient:
    """Implements `SchwabClient` with zero network calls (D4-05). Only
    `get_account_numbers` is exercised by this plan's own tests; the other
    three exist because the `Protocol` names them, and a fake implementing
    only some of a `Protocol`'s methods is not a real fake."""

    account_entries: list[AccountNumberEntry]

    async def get_account_numbers(self) -> list[AccountNumberEntry]:
        return self.account_entries

    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        symbol: str | None = None,
    ) -> JsonValue:
        return []

    async def get_option_chain(self, symbol: str) -> JsonValue:
        return {}

    async def get_quotes(self, symbols: list[str]) -> JsonValue:
        return {}


@dataclass
class FakeSchwabAuth:
    """Implements `SchwabAuth` with zero network calls (D4-05).

    `exchange_barrier`, if set, is awaited inside `exchange_callback`
    before it proceeds -- letting a test force two flows to overlap and
    fail loudly (via `asyncio.wait_for`'s `TimeoutError`) if they were
    serialised instead. `refresh_gate`, if set, is awaited inside
    `refresh` before it proceeds -- letting a test hold one user inside a
    critical section while another runs. `entered_refresh`, if set, is
    `.set()` by `refresh` the instant it is called, before it checks
    anything or waits on `refresh_gate` -- a test observes this to know the
    critical section has genuinely been entered (the advisory lock already
    held) before it starts a second flow, rather than guessing with a fixed
    sleep. `raise_on_exchange`, if set, is raised from `exchange_callback`
    after the barrier wait -- the `invalid_grant`/expired-refresh/rate-limit
    shapes above are what a caller sets it to."""

    fixed_created_at: datetime
    account_entries: list[AccountNumberEntry]
    exchange_barrier: asyncio.Barrier | None = None
    exchange_barrier_timeout: float = 5.0
    refresh_gate: asyncio.Event | None = None
    refresh_gate_timeout: float = 5.0
    entered_refresh: asyncio.Event | None = None
    raise_on_exchange: Exception | None = None
    calls: list[CallRecord] = field(default_factory=list)
    _rotated_refresh_tokens: set[str] = field(default_factory=set)

    def build_authorize_url(self, raw_state: str) -> str:
        return f"https://fake-schwab.test/authorize?state={raw_state}"

    async def exchange_callback(
        self, received_url: str, *, raw_state: str
    ) -> tuple[ExchangedToken, SchwabClient]:
        entered_at = datetime.now(UTC)
        if self.exchange_barrier is not None:
            await asyncio.wait_for(
                self.exchange_barrier.wait(), timeout=self.exchange_barrier_timeout
            )
        if self.raise_on_exchange is not None:
            raise self.raise_on_exchange
        exchanged = ExchangedToken(
            token={"refresh_token": f"fake-refresh-{raw_state}"},
            created_at=self.fixed_created_at,
        )
        client: SchwabClient = FakeSchwabClient(account_entries=self.account_entries)
        exited_at = datetime.now(UTC)
        self.calls.append(
            CallRecord(key=raw_state, entered_at=entered_at, exited_at=exited_at)
        )
        return exchanged, client

    async def build_client(
        self,
        token_read_func: Callable[[], object],
        token_write_func: Callable[[object], None],
    ) -> SchwabClient:
        """Implements `SchwabAuth.build_client` (CONN-06, plan 04-03) by
        reusing `refresh`'s own rotation/gate/`invalid_grant` machinery:
        reads the current wrapped token, rotates its refresh token exactly
        as `refresh` would, then writes the rotated wrapped token back.
        `creation_timestamp` passes through unchanged, matching schwab-py's
        own real behaviour of never touching it on an ordinary refresh."""
        wrapped = _WRAPPED_TOKEN.validate_python(token_read_func())
        current = _FAKE_REFRESH_TOKEN.validate_python(wrapped.token)
        rotated_refresh_token = await self.refresh(current.refresh_token)
        token_write_func(
            {
                "creation_timestamp": wrapped.creation_timestamp,
                "token": {"refresh_token": rotated_refresh_token},
            }
        )
        return FakeSchwabClient(account_entries=self.account_entries)

    async def refresh(self, refresh_token: str) -> str:
        """Not part of the `SchwabAuth` `Protocol` directly -- `build_client`
        above calls it. A plain method this fake exposes so a test can drive
        the rotation/rate-limit/expiry shapes without a second fake.
        Rotates deterministically; raises `SchwabInvalidGrantError` if
        handed a value already rotated away from."""
        entered_at = datetime.now(UTC)
        if self.entered_refresh is not None:
            self.entered_refresh.set()
        if refresh_token in self._rotated_refresh_tokens:
            raise SchwabInvalidGrantError(
                "refresh_token has already been rotated away from"
            )
        if self.refresh_gate is not None:
            await asyncio.wait_for(
                self.refresh_gate.wait(), timeout=self.refresh_gate_timeout
            )
        self._rotated_refresh_tokens.add(refresh_token)
        rotated = f"{refresh_token}-rotated"
        exited_at = datetime.now(UTC)
        self.calls.append(
            CallRecord(key=refresh_token, entered_at=entered_at, exited_at=exited_at)
        )
        return rotated
