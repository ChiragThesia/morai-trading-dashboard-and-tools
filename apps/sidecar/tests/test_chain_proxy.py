"""
RED scaffold — /sidecar/chain endpoint contract tests (GW-02).

These tests import the FastAPI app from apps/sidecar/main.py which does not exist yet.
They MUST fail with ImportError on this commit (TDD red-first).

Expected failure:
    ModuleNotFoundError: No module named 'main'

Turn these green in Phase 11 plan 03 when main.py + chain_proxy.py are implemented.
"""
import pytest
from fastapi.testclient import TestClient

# RED: This import fails until main.py is created (11-03).
from main import app  # noqa: F401

client = TestClient(app)

# Canonical chain shape that the TS Zod schema at packages/adapters/src/sidecar/
# chain-adapter.test.ts pins. Both sides must match (D-08 contract test).
EXPECTED_CHAIN_KEYS = {"root", "observedAt", "spot", "quotes", "source"}
EXPECTED_QUOTE_KEYS = {
    "occSymbol",
    "contractType",
    "strike",
    "expiry",
    "bid",
    "ask",
    "mark",
    "iv",
    "delta",
    "gamma",
    "theta",
    "vega",
    "openInterest",
    "volume",
}


def test_chain_shape() -> None:
    """
    GW-02: GET /sidecar/chain returns a JSON body that mirrors the RawChain shape
    consumed by the TS adapter.

    Expected shape (D-08 contract / Pattern 5 in RESEARCH.md):
      { root, observedAt, spot, quotes: [...], source: "schwab_chain" }

    Each quote in quotes must include occSymbol, contractType, strike, expiry,
    bid, ask, mark, iv, delta, gamma, theta, vega, openInterest, volume.
    """
    response = client.get("/sidecar/chain?root=SPX")
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    body = response.json()
    assert EXPECTED_CHAIN_KEYS == set(body.keys()) or EXPECTED_CHAIN_KEYS.issubset(body.keys()), (
        f"Response missing required top-level keys. Got: {set(body.keys())!r}"
    )
    assert body["source"] == "schwab_chain", (
        f"source must be 'schwab_chain', got {body['source']!r}"
    )
    assert isinstance(body["quotes"], list), "quotes must be a list"
    if body["quotes"]:
        quote = body["quotes"][0]
        missing = EXPECTED_QUOTE_KEYS - set(quote.keys())
        assert not missing, f"Quote missing keys: {missing!r}"


def test_auth_expired() -> None:
    """
    GW-02: When the Schwab token is expired, GET /sidecar/chain returns HTTP 503
    with body {"error": "AUTH_EXPIRED"}.

    The TS adapter maps 503 + AUTH_EXPIRED to err({kind:"fetch-error", message:"AUTH_EXPIRED"})
    which triggers selectChainSource to route to CBOE on the next call (JRNL-02 / D-08).
    """
    # This test requires a test fixture / mock that simulates AUTH_EXPIRED.
    # Implemented in 11-03 via pytest fixture / dependency injection.
    response = client.get("/sidecar/chain?root=SPX&_test_auth_expired=true")
    assert response.status_code == 503, (
        f"Expected 503 on AUTH_EXPIRED, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert body == {"error": "AUTH_EXPIRED"}, (
        f"Expected {{\"error\": \"AUTH_EXPIRED\"}}, got {body!r}"
    )
