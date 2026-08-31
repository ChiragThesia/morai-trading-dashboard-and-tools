"""The only module in this codebase that imports `schwab` (D4-02).

`schwab-py` 1.5.1 ships no `py.typed` marker -- verified directly against
the real downloaded wheel, this phase's own research. Without the local
`typings/schwab/` stub package, every symbol here would resolve to `Any`
and this project's `reportAny` gate would fire at every call site; with the
stubs, exactly one legitimate `Any` survives -- `httpx.Response.json()`'s
own, intentional return type, since JSON has no static shape. That single
`Any` is funneled through `_response_json` below, which carries the one
suppression D4-04 budgets for the whole module.

The `Protocol` (`protocol.py`) exists alongside the stubs, not instead of
them: stubs make the vendor legible to the checkers; the `Protocol` keeps
the rest of the application decoupled from `schwab` entirely and testable
against a fake with zero network calls (D4-05).

**The token-write hazard.** `schwab-py`'s `token_write_func` is never
awaited by the library's own internal wrapping -- verified by reading
`schwab/auth.py` directly: `client_from_received_url` calls it with a plain
`token_write_func(token)`, and even on the `asyncio=True` path the internal
`async def oauth_client_update_token` wrapper calls the closure with no
`await`. An `async def` closure here returns a coroutine that is created
and immediately discarded -- no exception, no warning surfaced to the
caller until Python's own "coroutine was never awaited" message fires at
garbage-collection time, which a suite that doesn't treat warnings as
errors swallows entirely, and OAuth silently never persists. `_capture_token`
below is a plain `def` for exactly this reason -- converting it to
`async def` "for consistency" with the rest of this async codebase is the
mistake this comment exists to head off. It only ever appends to a plain
in-memory list; the real, explicit, awaited persistence happens in
`morai.vendor.connections.upsert_connection`, called by the caller's own
async code after `exchange_callback` returns.

`client_from_received_url` performs a real, synchronous network call
(`authlib`'s `OAuth2Client.fetch_token`) -- run through `asyncio.to_thread`
so it doesn't block the event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import schwab.auth
from pydantic import JsonValue, TypeAdapter
from schwab.client import AsyncClient

from morai.settings import SchwabCredentials
from morai.vendor.protocol import (
    AccountNumberEntry,
    ExchangedToken,
    SchwabClient,
    WrappedToken,
)


def _response_json(resp: httpx.Response) -> object:
    return resp.json()  # pyright: ignore[reportAny]  # why: httpx.Response.json() legitimately returns Any -- this is the untrusted-input boundary D4-03 names, funneled through one shared helper so it is the adapter module's only suppression (D4-04).


_ACCOUNT_NUMBERS: TypeAdapter[list[AccountNumberEntry]] = TypeAdapter(
    list[AccountNumberEntry]
)
_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


# `WrappedToken` itself lives in `protocol.py` -- `TokenHolder`'s own
# closures need it too, and this module and that one should not carry two
# copies of the same vendor shape.
_WRAPPED_TOKEN: TypeAdapter[WrappedToken] = TypeAdapter(WrappedToken)


class _RealSchwabClient:
    """Wraps a real `schwab.client.AsyncClient`, implementing `SchwabClient`
    structurally (D4-02). Every method parses its response through a
    module-level `TypeAdapter`, never a bare cast (D4-03)."""

    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    async def get_account_numbers(self) -> list[AccountNumberEntry]:
        resp = await self._client.get_account_numbers()
        return _ACCOUNT_NUMBERS.validate_python(_response_json(resp))

    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        symbol: str | None = None,
    ) -> JsonValue:
        resp = await self._client.get_transactions(
            account_hash, start_date=start_date, end_date=end_date, symbol=symbol
        )
        return _JSON_VALUE.validate_python(_response_json(resp))

    async def get_option_chain(self, symbol: str) -> JsonValue:
        resp = await self._client.get_option_chain(symbol)
        return _JSON_VALUE.validate_python(_response_json(resp))

    async def get_quotes(self, symbols: list[str]) -> JsonValue:
        resp = await self._client.get_quotes(symbols)
        return _JSON_VALUE.validate_python(_response_json(resp))


class SchwabAuthAdapter:
    """Wraps `schwab.auth`, implementing `SchwabAuth` structurally (D4-02,
    D4-06). No live Schwab call happens in this plan's own test suite
    (D4-14) -- routes exercise this only via the `Protocol` fake."""

    def __init__(self, credentials: SchwabCredentials) -> None:
        self._credentials = credentials

    def build_authorize_url(self, raw_state: str) -> str:
        """Passes **our own** `state` into `get_auth_context` -- omitting it
        lets `authlib` mint its own random value, which the `setup_tokens`
        nonce table cannot validate (verified against the real wheel's
        `get_auth_context` body)."""
        auth_context = schwab.auth.get_auth_context(
            self._credentials.api_key,
            self._credentials.callback_url,
            state=raw_state,
        )
        return auth_context.authorization_url

    async def exchange_callback(
        self, received_url: str, *, raw_state: str
    ) -> tuple[ExchangedToken, SchwabClient]:
        """Reconstructs a throwaway `AuthContext` from the fixed callback URL
        and the consumed state, rather than persisting the original object
        across the redirect -- `client_from_received_url` only ever reads
        `.callback_url` and `.state` off it (verified directly against the
        real wheel's function body; `.authorization_url` is never touched).
        """
        auth_context = schwab.auth.AuthContext(
            callback_url=self._credentials.callback_url,
            authorization_url="",
            state=raw_state,
        )

        captured: list[object] = []

        def _capture_token(token: object, *args: object, **kwargs: object) -> None:
            # Plain `def`, never `async def` -- see this module's docstring
            # for why. Captures synchronously into an in-memory holder; the
            # caller's own async code persists it explicitly afterward.
            captured.append(token)

        client = await asyncio.to_thread(
            schwab.auth.client_from_received_url,
            self._credentials.api_key,
            self._credentials.app_secret,
            auth_context,
            received_url,
            _capture_token,
            asyncio=True,
        )

        wrapped = _WRAPPED_TOKEN.validate_python(captured[-1])
        exchanged = ExchangedToken(
            token=wrapped.token,
            created_at=datetime.fromtimestamp(wrapped.creation_timestamp, tz=UTC),
        )
        return exchanged, _RealSchwabClient(client)

    async def build_client(
        self,
        token_read_func: Callable[[], object],
        token_write_func: Callable[[object], None],
    ) -> SchwabClient:
        """Wraps `client_from_access_functions` -- the low-level primitive
        for a caller that already holds a token (CONN-06's refresh path), as
        opposed to `exchange_callback`'s fresh-grant path. `token_read_func`/
        `token_write_func` are passed straight through: `TokenHolder`'s own
        closures already have the exact plain-synchronous signature the
        vendor calls (verified against the real 1.5.1 wheel; see
        `protocol.py`'s `TokenHolder` docstring for why neither may be
        `async def`). Same `asyncio.to_thread` wrapping as
        `exchange_callback`, for the same reason: the vendor's own
        construction is a real synchronous call, not truly async."""
        client = await asyncio.to_thread(
            schwab.auth.client_from_access_functions,
            self._credentials.api_key,
            self._credentials.app_secret,
            token_read_func,
            token_write_func,
            asyncio=True,
        )
        return _RealSchwabClient(client)
