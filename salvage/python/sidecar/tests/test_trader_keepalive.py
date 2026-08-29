"""
Trader-token keep-alive tests.

The sidecar holds a trader schwab-py client but only ever calls the chain (market) API, so the
trader token would otherwise never refresh — the server reads the discrete access_token directly
for positions/orders/transactions and would 401 once it expires (the server-side refresher was
retired in the GW-03 cutover). The keep-alive proactively pings a cheap trader endpoint shortly
before expiry so schwab-py refreshes (within its 300s leeway) and dual-writes the fresh token.
"""
import asyncio
import time
import types

from unittest.mock import AsyncMock

import main
from main import _trader_token_keepalive, _keepalive_sleep_seconds, TRADER_KEEPALIVE_MARGIN


def test_sleep_seconds_future_wakes_before_expiry() -> None:
    now = 1000.0
    # Wake `margin` before expiry so the refresh lands inside schwab-py's leeway.
    assert _keepalive_sleep_seconds(now + 1800, now, margin=180, min_sleep=30) == 1620.0


def test_sleep_seconds_expired_floors_to_min() -> None:
    now = 1000.0
    # Already expired → refresh promptly, but never busy-loop (floor at min_sleep).
    assert _keepalive_sleep_seconds(now - 100, now, margin=180, min_sleep=30) == 30


def test_sleep_seconds_within_margin_floors_to_min() -> None:
    now = 1000.0
    assert _keepalive_sleep_seconds(now + 60, now, margin=180, min_sleep=30) == 30


async def test_keepalive_pings_trader_client(monkeypatch) -> None:
    # Tiny floor so the test pings within milliseconds instead of the 30s production floor.
    monkeypatch.setattr(main, "TRADER_KEEPALIVE_MIN_SLEEP", 0.01)

    client = AsyncMock()
    # Token within the refresh margin → keep-alive should ping right away.
    client.session.token = {"expires_at": time.time() + TRADER_KEEPALIVE_MARGIN - 1}
    app = types.SimpleNamespace(state=types.SimpleNamespace(trader_client=client))

    task = asyncio.create_task(_trader_token_keepalive(app))
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    client.get_account_numbers.assert_awaited()


async def test_keepalive_noop_without_trader_client() -> None:
    app = types.SimpleNamespace(state=types.SimpleNamespace(trader_client=None))
    # Returns immediately (nothing to keep alive) — must not hang or raise.
    await asyncio.wait_for(_trader_token_keepalive(app), timeout=1.0)
