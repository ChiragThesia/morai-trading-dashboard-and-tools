"""
/sidecar/chain endpoint contract tests (GW-02, D-08).

Originally a RED scaffold (11-01) — now GREEN after main.py + chain_proxy.py are implemented (11-05).

Includes the manual-mirror contract test that pins the Python response shape to the
TS SidecarChainResponseSchema in packages/adapters/src/sidecar/chain-adapter.ts (D-08).
Both sides MUST be updated together if the shape changes.
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
    response = client.get("/sidecar/chain?root=SPX&_test_auth_expired=true")
    assert response.status_code == 503, (
        f"Expected 503 on AUTH_EXPIRED, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert body == {"error": "AUTH_EXPIRED"}, (
        f"Expected {{\"error\": \"AUTH_EXPIRED\"}}, got {body!r}"
    )


def test_contract_chain_shape_pins_ts_schema() -> None:
    """
    D-08 manual-mirror contract test: pins the Python /sidecar/chain response shape to
    the TS SidecarChainResponseSchema in packages/adapters/src/sidecar/chain-adapter.ts.

    Both sides MUST be updated together. This test is the canary: if the Python shape
    drifts from the TS Zod schema, this test catches it before the TS adapter breaks.

    TS schema (as of 11-03):
      root: z.enum(["SPX", "SPXW"])
      observedAt: z.string().datetime()
      spot: z.number()
      quotes: z.array(z.object({
        occSymbol: z.string(),
        contractType: z.enum(["C", "P"]),
        strike: z.number(),
        expiry: z.string().datetime(),
        bid: z.number().nullable(),
        ask: z.number().nullable(),
        mark: z.number().nullable(),
        iv: z.number().nullable(),
        delta: z.number().nullable(),
        gamma: z.number().nullable(),
        theta: z.number().nullable(),
        vega: z.number().nullable(),
        openInterest: z.number(),
        volume: z.number(),
      }))
      source: z.literal("schwab_chain")
    """
    response = client.get("/sidecar/chain?root=SPX")
    assert response.status_code == 200, (
        f"Contract test: expected 200, got {response.status_code}: {response.text}"
    )
    body = response.json()

    # ── Top-level field names (exact match) ───────────────────────────────────
    assert set(body.keys()) == EXPECTED_CHAIN_KEYS, (
        f"Contract: top-level keys mismatch. "
        f"Expected {EXPECTED_CHAIN_KEYS!r}, got {set(body.keys())!r}"
    )

    # ── source must be the literal "schwab_chain" ─────────────────────────────
    assert body["source"] == "schwab_chain", (
        f"Contract: source must be literal 'schwab_chain', got {body['source']!r}"
    )

    # ── root must be a string (SPX or SPXW) ───────────────────────────────────
    assert isinstance(body["root"], str), (
        f"Contract: root must be a str, got {type(body['root']).__name__}"
    )

    # ── observedAt must be an ISO-8601 datetime string ────────────────────────
    assert isinstance(body["observedAt"], str), (
        f"Contract: observedAt must be str, got {type(body['observedAt']).__name__}"
    )

    # ── spot must be a number ─────────────────────────────────────────────────
    assert isinstance(body["spot"], (int, float)), (
        f"Contract: spot must be a number, got {type(body['spot']).__name__}"
    )

    # ── quotes array and quote field shapes ───────────────────────────────────
    assert isinstance(body["quotes"], list), "Contract: quotes must be a list"

    if body["quotes"]:
        quote = body["quotes"][0]

        # Exact field set (no extras, no missing)
        assert set(quote.keys()) == EXPECTED_QUOTE_KEYS, (
            f"Contract: quote field set mismatch. "
            f"Expected {EXPECTED_QUOTE_KEYS!r}, got {set(quote.keys())!r}"
        )

        # Required non-nullable fields
        assert isinstance(quote["occSymbol"], str), "Contract: occSymbol must be str"
        assert quote["contractType"] in ("C", "P"), (
            f"Contract: contractType must be 'C' or 'P', got {quote['contractType']!r}"
        )
        assert isinstance(quote["strike"], (int, float)), "Contract: strike must be number"
        assert isinstance(quote["expiry"], str), "Contract: expiry must be str (ISO-8601)"
        assert isinstance(quote["openInterest"], int), "Contract: openInterest must be int"
        assert isinstance(quote["volume"], int), "Contract: volume must be int"

        # Nullable fields (must be float or None — z.number().nullable())
        for nullable_field in ("bid", "ask", "mark", "iv", "delta", "gamma", "theta", "vega"):
            val = quote[nullable_field]
            assert val is None or isinstance(val, (int, float)), (
                f"Contract: {nullable_field} must be float or None, got {type(val).__name__}: {val!r}"
            )
