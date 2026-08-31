"""The two `Protocol`s this project owns, and the response shapes vendor
JSON validates into (D4-02, D4-03).

Imports nothing from `schwab` -- that import lives in exactly one module,
`schwab_adapter.py` (D4-02). `SchwabClient` names **exactly** the four
methods this project calls; `SchwabAuth` names exactly the two this plan's
OAuth handshake actually invokes. A wider `Protocol` is a larger lie about
what this project depends on.

The vendor token itself is modelled as `JsonValue`, never `dict[str, Any]`
and never a `TypedDict` cast -- a `TypedDict` asserts a shape to the checker
without checking it at runtime (D4-03); `JsonValue` is honest about "this is
whatever JSON schwab-py handed back", and this project never inspects the
token's internal shape -- it is captured, encrypted and stored as an opaque
blob, then handed back to schwab-py unchanged on the next read.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, JsonValue


@dataclass(frozen=True)
class ExchangedToken:
    """The vendor token blob captured from one completed OAuth exchange,
    plus its creation time -- read out of schwab-py's own `TokenMetadata`
    wrapper, never computed by this project. `created_at` is the anchor
    D4-12's `derive_connection_health` reads; schwab-py's own
    `TokenMetadata.creation_timestamp` explicitly does not change on an
    ordinary refresh (verified against the real 1.5.1 wheel)."""

    token: JsonValue
    created_at: datetime


class AccountNumberEntry(BaseModel):
    """One entry from `get_account_numbers()`'s response. Schwab's own JSON
    keys are camelCase (`accountNumber`, `hashValue`); `populate_by_name`
    is on so the `Protocol` fake (D4-05) can construct this directly from
    Python kwargs by field name, while real vendor JSON still validates
    through the alias (D4-03)."""

    model_config = ConfigDict(populate_by_name=True)

    account_number: str = Field(alias="accountNumber")
    hash_value: str = Field(alias="hashValue")


class WrappedToken(BaseModel):
    """The shape schwab-py's own `TokenMetadata.wrap_token_in_metadata`
    exchanges with both `token_write_func` and `token_read_func` --
    `{'creation_timestamp': int, 'token': ...}` (verified against the real
    1.5.1 wheel). Lives here, not `schwab_adapter.py`, because `TokenHolder`
    below needs it too, and this module is the shared home for every shape
    vendor JSON validates into (D4-03)."""

    creation_timestamp: int
    token: JsonValue


@dataclass
class TokenHolder:
    """A mutable holder for one user's current vendor token, read and
    written by plain synchronous closures handed to schwab-py's
    `client_from_access_functions`. `wrote` records whether the vendor ever
    called `write`, so a caller knows whether there is anything new to
    persist.

    Both closures below are plain `def`, **never** `async def` --
    schwab-py's own wrapping in `schwab/auth.py` calls them with no
    `await` anywhere in the real 1.5.1 wheel, even on the `asyncio=True`
    path. An `async def` closure here would return a coroutine that is
    assigned and immediately discarded -- no exception, no warning until
    Python's own "coroutine was never awaited" message fires at
    garbage-collection time, and the rotated token would silently never
    persist (landmine 1, T-04-17). Do not make these `async def` for
    consistency with the rest of this async codebase -- that is the exact
    mistake this comment exists to head off.

    `token` is the raw, opaque vendor token blob -- schwab-py's own wrapped
    shape (`WrappedToken`), never inspected further here."""

    token: object

    wrote: bool = field(default=False, init=False)

    def read(self) -> object:
        return self.token

    def write(self, token: object) -> None:
        self.token = token
        self.wrote = True


class SchwabClient(Protocol):
    """Exactly the four methods this project calls (D4-02). `get_option_chain`
    and `get_quotes` are named for Phase 8's snapshot capture -- this
    phase's tests exercise only `get_transactions`/`get_account_numbers`."""

    async def get_account_numbers(self) -> list[AccountNumberEntry]: ...

    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        symbol: str | None = None,
    ) -> JsonValue: ...

    async def get_option_chain(self, symbol: str) -> JsonValue: ...

    async def get_quotes(self, symbols: list[str]) -> JsonValue: ...


class SchwabAuth(Protocol):
    """Exactly the three methods this project's OAuth handshake and refresh
    path call -- building the authorize URL for a given raw state,
    exchanging a received callback URL for a token plus a live
    `SchwabClient` (D4-06), and building a `SchwabClient` from an existing
    token via a pair of synchronous read/write closures (CONN-06). A wider
    `Protocol` is a larger lie about what this project depends on (D4-02).

    `exchange_callback` takes `raw_state` explicitly rather than an
    `AuthContext` the caller would have to persist across the redirect:
    `client_from_received_url` only ever reads `.callback_url` and `.state`
    off the `AuthContext` it is handed (verified against the real 1.5.1
    wheel), and this project's own fixed callback URL plus the state
    `consume_token()` just returned are the only two values that throwaway
    object needs.

    `build_client`'s two callables mirror `client_from_access_functions`'s
    own `token_read_func`/`token_write_func` parameters exactly -- verified
    against the real 1.5.1 wheel, neither is ever awaited by the library, so
    both must be plain synchronous callables here too (see `TokenHolder`'s
    own docstring)."""

    def build_authorize_url(self, raw_state: str) -> str: ...

    async def exchange_callback(
        self, received_url: str, *, raw_state: str
    ) -> tuple[ExchangedToken, SchwabClient]: ...

    async def build_client(
        self,
        token_read_func: Callable[[], object],
        token_write_func: Callable[[object], None],
    ) -> SchwabClient: ...
