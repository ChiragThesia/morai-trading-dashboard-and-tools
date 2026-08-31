# Verified against the real 1.5.1 wheel's `schwab/client/base.py` and
# `schwab/client/asynchronous.py` (D4-01). `AsyncClient`'s methods are plain
# `def`s in `BaseClient` that return whatever `self._get_request(...)`
# returns; `AsyncClient._get_request` is `async def` and returns the
# coroutine, so `await client.get_account_numbers()` resolves to the real
# `httpx.Response` -- declaring these as `async def` here is the correct
# caller-facing shape for a stub, even though the real implementation
# doesn't spell it that way.
#
# Covers only the four methods `SchwabClient` (protocol.py) names -- a wider
# stub is a larger lie about what this project depends on (D4-02).

import httpx

class AsyncClient:
    async def get_account_numbers(self) -> httpx.Response: ...
    async def get_transactions(
        self,
        account_hash: str,
        *,
        start_date: object | None = ...,
        end_date: object | None = ...,
        symbol: str | None = ...,
    ) -> httpx.Response: ...
    async def get_option_chain(self, symbol: str, **kwargs: object) -> httpx.Response: ...
    async def get_quotes(
        self, symbols: list[str] | str, **kwargs: object
    ) -> httpx.Response: ...
