"""
GET /sidecar/positions — STRM-05 cold-start reconcile endpoint (trader client).

Mirrors chain_proxy.py pattern exactly: Pydantic response models, trader_client null
guard returning 503 AUTH_EXPIRED, type(exc).__name__-only error logging, Z-suffix asOf.

The TS server calls this on first client connect and every reconnect to seed the
reconcile SSE event (STRM-05 / D-04 reconnect UX).  The trader token is kept fresh by
the Phase 11 keep-alive task — no additional refresh needed.

Security (threat_model 12-03-PLAN.md):
  T-12-03-01: Private-net only (GW-05); module docstring attests this.
  T-12-03-02: log type(exc).__name__ only — never str(exc) or token values.
  T-12-03-03: asOf uses utc_now_z() to ensure 'Z' suffix (not '+00:00') so
              Zod .datetime() on the TS boundary accepts the payload (Pitfall 5).

INTERNAL ONLY (GW-05): Railway private network; MUST NOT be exposed on a public domain.
"""

import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Timestamp helper ─────────────────────────────────────────────────────────


def _utc_now_z() -> str:
    """
    Current UTC time as ISO-8601 string always ending in 'Z' (never '+00:00').

    Zod's z.string().datetime() on the TS side rejects the '+00:00' offset format.
    Mirrors chain_proxy.py lines 98-102 (observedAt lesson, Pitfall 5).
    """
    return (
        datetime.datetime.now(tz=datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


# ─── Response models ─────────────────────────────────────────────────────────


class PositionItem(BaseModel):
    """
    One open option position for the STRM-05 reconcile.

    Field names mirror brokerage.ts brokerPosition so 12-05 can map to
    ReconciledPosition / streamReconcileEvent without additional translation:
      occSymbol      → brokerPosition.occSymbol (21-char OCC format)
      longQty        → brokerPosition.longQty
      shortQty       → brokerPosition.shortQty
      marketValue    → brokerPosition.marketValue (nullable)
      underlyingSymbol → brokerPosition.underlyingSymbol
    """

    occSymbol: str
    longQty: float
    shortQty: float
    marketValue: Optional[float] = None
    underlyingSymbol: str


class PositionsResponse(BaseModel):
    positions: list[PositionItem]
    asOf: str  # ISO-8601 always ending in 'Z' (Pitfall 5 / T-12-03-03)


# ─── Mapping helper ──────────────────────────────────────────────────────────


def _extract_positions(accounts_json: list) -> list[PositionItem]:
    """
    Extract OPTION positions from the schwab-py get_accounts() response.

    The response is a list of accounts, each with
    ``securitiesAccount.positions`` containing raw position dicts.
    Only positions with assetType == "OPTION" are included; equity and
    other asset types are filtered out.

    Returns an empty list if the JSON shape is unexpected.
    """
    result: list[PositionItem] = []
    for account in accounts_json:
        securities_account = account.get("securitiesAccount", {}) or {}
        raw_positions = securities_account.get("positions") or []
        for pos in raw_positions:
            instrument = pos.get("instrument") or {}
            if instrument.get("assetType") != "OPTION":
                continue
            occ_symbol: str = instrument.get("symbol", "")
            if not occ_symbol:
                continue
            result.append(
                PositionItem(
                    occSymbol=occ_symbol,
                    longQty=float(pos.get("longQuantity") or 0),
                    shortQty=float(pos.get("shortQuantity") or 0),
                    marketValue=pos.get("marketValue"),
                    underlyingSymbol=instrument.get("underlyingSymbol", ""),
                )
            )
    return result


# ─── Route ───────────────────────────────────────────────────────────────────


@router.get("/sidecar/positions", response_model=PositionsResponse)
async def get_positions(request: Request) -> PositionsResponse | JSONResponse:
    """
    STRM-05 reconcile: return current open option positions with a Z-stamped asOf.

    Uses the trader client (kept fresh by Phase 11 keep-alive).
    Returns 503 AUTH_EXPIRED if trader_client is absent or any call fails.

    PRIVATE NET ONLY (GW-05) — no public ingress.
    """
    client = getattr(request.app.state, "trader_client", None)

    if client is None:
        logger.error(
            "positions proxy: trader_client not available on app.state — "
            "sidecar may be degraded (not_seeded)"
        )
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})

    try:
        # schwab-py defaults to enforce_enums=True → the field MUST be the enum member,
        # not the string "positions" (which raises ValueError and silently emptied the
        # reconcile + leg subscription end-to-end).
        resp = await client.get_accounts(fields=[client.Account.Fields.POSITIONS])
        raw = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "positions proxy: get_accounts failed — %s (message redacted)",
            type(exc).__name__,
        )
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})

    try:
        positions = _extract_positions(raw)
        return PositionsResponse(positions=positions, asOf=_utc_now_z())
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "positions proxy: failed to map positions response — %s (message redacted)",
            type(exc).__name__,
        )
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
