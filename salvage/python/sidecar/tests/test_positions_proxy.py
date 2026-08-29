"""
Tests for positions_proxy.py — GET /sidecar/positions (STRM-05).

TDD: RED tests written first; GREEN only after implementation is in place.

Test strategy:
  - Route handler called directly with fake Request objects so there's no live
    Schwab session or DB connection required.
  - Z-suffix tested via regex matching Zod's z.string().datetime() rule (Pitfall 5).
  - 503 guard tested for both trader_client=None and trader_client call raising.
  - Field names verified to mirror brokerage.ts brokerPosition contract.
"""
import re
import types
from unittest.mock import AsyncMock, MagicMock

import pytest


# ── Zod datetime regex (must end in 'Z', not '+00:00') ────────────────────────
ZOD_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")


def _make_app_state(**kwargs) -> types.SimpleNamespace:
    return types.SimpleNamespace(**kwargs)


def _make_fake_request(**state_kwargs) -> MagicMock:
    req = MagicMock()
    req.app.state = _make_app_state(**state_kwargs)
    return req


def _make_trader_client_with_positions(positions_json: list) -> AsyncMock:
    """
    Build an AsyncMock trader client whose get_accounts() returns canned positions JSON.
    """
    mock_resp = MagicMock()
    mock_resp.json.return_value = positions_json
    client = AsyncMock()
    client.get_accounts.return_value = mock_resp
    return client


_CANNED_ACCOUNTS_JSON = [
    {
        "securitiesAccount": {
            "positions": [
                {
                    "longQuantity": 2.0,
                    "shortQuantity": 0.0,
                    "averagePrice": 5.50,
                    "marketValue": 1200.0,
                    "instrument": {
                        "assetType": "OPTION",
                        "symbol": "SPX   260620C05000000",
                        "putCall": "CALL",
                        "underlyingSymbol": "SPX",
                    },
                },
                {
                    "longQuantity": 0.0,
                    "shortQuantity": 1.0,
                    "averagePrice": 3.25,
                    "marketValue": -350.0,
                    "instrument": {
                        "assetType": "OPTION",
                        "symbol": "SPX   260620P04500000",
                        "putCall": "PUT",
                        "underlyingSymbol": "SPX",
                    },
                },
                # Non-option (equity) — must be filtered out
                {
                    "longQuantity": 100.0,
                    "shortQuantity": 0.0,
                    "instrument": {
                        "assetType": "EQUITY",
                        "symbol": "AAPL",
                        "underlyingSymbol": "AAPL",
                    },
                },
            ]
        }
    }
]


# ─────────────────────────────────────────────────────────────────────────────
# GET /sidecar/positions — success path
# ─────────────────────────────────────────────────────────────────────────────


class TestGetPositionsSuccess:
    """Happy-path tests for GET /sidecar/positions."""

    async def test_returns_positions_response_shape(self):
        """Response has {positions: [...], asOf} top-level keys."""
        from positions_proxy import get_positions

        trader = _make_trader_client_with_positions(_CANNED_ACCOUNTS_JSON)
        req = _make_fake_request(trader_client=trader)

        result = await get_positions(req)
        # Success path returns PositionsResponse (not JSONResponse)
        assert hasattr(result, "positions"), "Response must have 'positions' attribute"
        assert hasattr(result, "asOf"), "Response must have 'asOf' attribute"

    async def test_asOf_ends_in_Z(self):
        """asOf must end in 'Z' — Zod .datetime() rejects '+00:00' (Pitfall 5)."""
        from positions_proxy import get_positions

        trader = _make_trader_client_with_positions(_CANNED_ACCOUNTS_JSON)
        req = _make_fake_request(trader_client=trader)

        result = await get_positions(req)
        assert ZOD_DATETIME_RE.match(result.asOf), (
            f"asOf must match Zod datetime format (end in 'Z'), got: {result.asOf!r}"
        )

    async def test_filters_options_only(self):
        """Only OPTION-type positions appear in the response (EQUITY is filtered out)."""
        from positions_proxy import get_positions

        trader = _make_trader_client_with_positions(_CANNED_ACCOUNTS_JSON)
        req = _make_fake_request(trader_client=trader)

        result = await get_positions(req)
        # Canned JSON has 2 OPTION + 1 EQUITY; expect 2 positions
        assert len(result.positions) == 2, (
            f"Expected 2 option positions, got {len(result.positions)}: {result.positions!r}"
        )

    async def test_position_fields_match_brokerage_contract(self):
        """
        PositionItem fields mirror brokerage.ts brokerPosition contract:
        occSymbol, longQty, shortQty, marketValue, underlyingSymbol.
        """
        from positions_proxy import get_positions

        trader = _make_trader_client_with_positions(_CANNED_ACCOUNTS_JSON)
        req = _make_fake_request(trader_client=trader)

        result = await get_positions(req)
        pos = next(p for p in result.positions if "C05000000" in p.occSymbol)

        assert pos.occSymbol == "SPX   260620C05000000"
        assert pos.longQty == 2.0
        assert pos.shortQty == 0.0
        assert pos.marketValue == 1200.0
        assert pos.underlyingSymbol == "SPX"

    async def test_empty_positions_returns_empty_list(self):
        """An account with no positions returns positions=[]."""
        from positions_proxy import get_positions

        empty = [{"securitiesAccount": {"positions": []}}]
        trader = _make_trader_client_with_positions(empty)
        req = _make_fake_request(trader_client=trader)

        result = await get_positions(req)
        assert result.positions == []


# ─────────────────────────────────────────────────────────────────────────────
# GET /sidecar/positions — 503 guard paths
# ─────────────────────────────────────────────────────────────────────────────


class TestGetPositionsAuthExpired:
    """503 AUTH_EXPIRED returned when trader_client is absent or the call fails."""

    async def test_trader_client_none_returns_503(self):
        """If trader_client is None, 503 {error: AUTH_EXPIRED} is returned immediately."""
        from positions_proxy import get_positions
        from fastapi.responses import JSONResponse

        req = _make_fake_request(trader_client=None)
        result = await get_positions(req)

        assert isinstance(result, JSONResponse)
        assert result.status_code == 503
        import json
        body = json.loads(result.body)
        assert body == {"error": "AUTH_EXPIRED"}

    async def test_get_accounts_exception_returns_503(self):
        """If get_accounts() raises, the exception type is logged and 503 is returned."""
        from positions_proxy import get_positions
        from fastapi.responses import JSONResponse
        import json

        client = AsyncMock()
        client.get_accounts.side_effect = RuntimeError("network error (redacted)")

        req = _make_fake_request(trader_client=client)
        result = await get_positions(req)

        assert isinstance(result, JSONResponse)
        assert result.status_code == 503
        body = json.loads(result.body)
        assert body == {"error": "AUTH_EXPIRED"}
