"""
GET /sidecar/chain — Schwab option-chain proxy (GW-02, D-08).

Calls the market schwab-py client's get_option_chain() and returns the response in a
shape that exactly mirrors the TS SidecarChainResponseSchema (Pattern 5, RESEARCH.md).

On any auth failure (expired/invalid token), returns HTTP 503 {"error": "AUTH_EXPIRED"}.
The TS adapter maps 503+AUTH_EXPIRED to err({kind:"fetch-error",message:"AUTH_EXPIRED"})
which triggers selectChainSource to route to CBOE (JRNL-02).

Security constraints (T-11-05-02):
  - The 503 body is always the fixed {"error": "AUTH_EXPIRED"} — no token values or
    internal detail is echoed.
  - The exception message is logged at error level but never returned to the caller.

Contract (D-08):
  - Response shape is pinned to the TS SidecarChainResponseSchema in
    packages/adapters/src/sidecar/chain-adapter.ts.
  - The Python contract test (test_chain_proxy.py) validates this shape explicitly.
  - Any change to the shape MUST update both sides simultaneously.
"""

import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Response models (Pydantic = Zod safeParse equivalent, T-11-05-05) ────────
# These mirror the TS SidecarChainResponseSchema exactly.
# Field names and nullability MUST stay in sync with chain-adapter.ts (D-08).


class ChainQuote(BaseModel):
    occSymbol: str
    contractType: str   # "C" or "P"
    strike: float
    expiry: str         # ISO-8601 datetime string
    bid: Optional[float] = None
    ask: Optional[float] = None
    mark: Optional[float] = None
    iv: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    openInterest: int
    volume: int


class ChainResponse(BaseModel):
    root: str
    observedAt: str     # ISO-8601 datetime string
    spot: float
    quotes: list[ChainQuote]
    source: str = "schwab_chain"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _is_auth_error(exc: Exception) -> bool:
    """
    Heuristic to distinguish auth failures from other schwab-py exceptions.

    schwab-py raises different exception types for auth errors depending on context.
    We treat 401/403 HTTP errors and token-related ValueErrors as auth failures.
    Any other exception is also surfaced as AUTH_EXPIRED to avoid leaking internals.
    """
    msg = str(exc).lower()
    return any(kw in msg for kw in ("401", "403", "unauthorized", "token", "auth"))


def _map_option_chain_to_response(raw: dict, root: str) -> ChainResponse:
    """
    Map the schwab-py get_option_chain() response JSON to ChainResponse.

    The schwab-py market data API returns a complex nested structure.
    We extract only the fields needed by the TS adapter (D-08 contract).

    Parameters
    ----------
    raw : dict
        The JSON body from schwab-py's get_option_chain() .json() call.
    root : str
        The underlying symbol (e.g. "SPX").
    """
    spot = float(raw.get("underlyingPrice", 0.0))
    observed_at = datetime.datetime.now(tz=datetime.timezone.utc).isoformat()

    quotes: list[ChainQuote] = []

    # Schwab option chain: putExpDateMap and callExpDateMap are nested dicts
    # keyed by expiry date, then by strike.
    for contract_type, date_map_key in (("C", "callExpDateMap"), ("P", "putExpDateMap")):
        date_map = raw.get(date_map_key, {})
        for expiry_str, strikes in date_map.items():
            # expiry_str format: "2026-06-20:30" (date:daysToExpiry)
            expiry_date = expiry_str.split(":")[0]
            expiry_iso = f"{expiry_date}T00:00:00.000Z"
            for strike_str, option_list in strikes.items():
                for option in option_list:
                    occ_symbol = option.get("symbol", "")
                    quotes.append(
                        ChainQuote(
                            occSymbol=occ_symbol,
                            contractType=contract_type,
                            strike=float(strike_str),
                            expiry=expiry_iso,
                            bid=_float_or_none(option.get("bid")),
                            ask=_float_or_none(option.get("ask")),
                            mark=_float_or_none(option.get("mark")),
                            iv=_float_or_none(option.get("volatility")),
                            delta=_float_or_none(option.get("delta")),
                            gamma=_float_or_none(option.get("gamma")),
                            theta=_float_or_none(option.get("theta")),
                            vega=_float_or_none(option.get("vega")),
                            openInterest=int(option.get("openInterest", 0)),
                            volume=int(option.get("totalVolume", 0)),
                        )
                    )

    return ChainResponse(
        root=root,
        observedAt=observed_at,
        spot=spot,
        quotes=quotes,
        source="schwab_chain",
    )


def _float_or_none(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)  # type: ignore[arg-type]
        return None if f == -999.0 else f  # Schwab uses -999 as sentinel for N/A
    except (TypeError, ValueError):
        return None


# ── Route ─────────────────────────────────────────────────────────────────────


@router.get("/sidecar/chain", response_model=ChainResponse)
async def get_chain(
    request: Request,
    root: str = "SPX",
    _test_auth_expired: bool = False,
) -> ChainResponse | JSONResponse:
    """
    Proxy the Schwab option chain for the given root (default: SPX).

    On auth failure: HTTP 503 {"error": "AUTH_EXPIRED"}.

    Parameters
    ----------
    root : str
        The underlying symbol to fetch the chain for (e.g. "SPX", "SPXW").
    _test_auth_expired : bool
        Test-only seam: when True, immediately returns 503 AUTH_EXPIRED without
        calling the schwab-py client.  MUST NOT be used in production.
    """
    if _test_auth_expired:
        # Test seam: simulate auth failure without a real client call.
        # Returns the fixed body directly (no FastAPI detail wrapper).
        return JSONResponse(
            status_code=503,
            content={"error": "AUTH_EXPIRED"},
        )

    client = getattr(request.app.state, "market_client", None)

    if client is None:
        # Sidecar is in degraded state (not seeded or failed lifespan).
        logger.error(
            "chain proxy: market_client not available on app.state — "
            "sidecar may be degraded (not_seeded)"
        )
        return JSONResponse(
            status_code=503,
            content={"error": "AUTH_EXPIRED"},
        )

    try:
        resp = await client.get_option_chain(root)
        raw = resp.json()
    except Exception as exc:
        # Log only the exception type — never str(exc) which may contain response body
        # text from httpx.HTTPStatusError (token-adjacent content) (T-11-05-02, WR-02).
        logger.error(
            "chain proxy: get_option_chain failed — %s (message redacted)",
            type(exc).__name__,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "AUTH_EXPIRED"},
        )

    try:
        chain = _map_option_chain_to_response(raw, root)
        return chain
    except Exception as exc:
        logger.error(
            "chain proxy: failed to map schwab response — %s (message redacted)",
            type(exc).__name__,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "AUTH_EXPIRED"},
        )
