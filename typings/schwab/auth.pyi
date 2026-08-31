# Verified against the real 1.5.1 wheel's `schwab/auth.py` (D4-01, D4-06).
# `AuthContext` is a real `collections.namedtuple` at runtime; declared here
# as a `NamedTuple` for the identical field access shape under both
# checkers. `client_from_received_url` only reads `.callback_url` and
# `.state` off the passed `AuthContext` -- confirmed by reading the function
# body directly -- so the callback route reconstructs a throwaway one rather
# than persisting the original object across the OAuth redirect.
#
# `token_write_func`/`token_read_func` are typed as plain (non-async)
# callables here on purpose: `client_from_received_url`/
# `client_from_access_functions` call `token_write_func` with no `await`
# anywhere in the wheel, even on the `asyncio=True` path (verified directly
# in `schwab/auth.py`). A caller handing an `async def` closure here gets a
# silently-discarded coroutine, never a type error -- this stub cannot
# express that hazard, only the adapter's own docstring and design can.

from collections.abc import Callable
from typing import NamedTuple

from schwab.client import AsyncClient

class AuthContext(NamedTuple):
    callback_url: str
    authorization_url: str
    state: str

def get_auth_context(
    api_key: str, callback_url: str, state: str | None = ...
) -> AuthContext: ...
def client_from_received_url(
    api_key: str,
    app_secret: str,
    auth_context: AuthContext,
    received_url: str,
    token_write_func: Callable[[object], None],
    asyncio: bool = ...,
    enforce_enums: bool = ...,
) -> AsyncClient: ...
def client_from_access_functions(
    api_key: str,
    app_secret: str,
    token_read_func: Callable[[], object],
    token_write_func: Callable[[object], None],
    asyncio: bool = ...,
    enforce_enums: bool = ...,
) -> AsyncClient: ...
