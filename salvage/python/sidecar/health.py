"""
GET /sidecar/health — token freshness check (GW-01, SC1).

Reads broker_tokens to determine whether the sidecar's Schwab token is fresh.
NEVER decrypts token values — only reads expires_at and related metadata columns.

Security constraints (T-11-05-02):
  - No token value (access_token, refresh_token, token_json content) appears in
    the response or logs.
  - Only the timing/status metadata is surfaced.

Degrade behaviour (RESEARCH Open Question 2):
  - If token_json IS NULL (not yet seeded via OAuth dance), returns:
      { "status": "degraded", "tokenFreshness": "not_seeded" }
  - If the row is absent, same degraded response.
  - This keeps the sidecar alive before the first OAuth dance (D-03).
"""

import datetime
import logging

import psycopg2
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _read_token_freshness(db_url: str, app_id: str) -> str:
    """
    Query broker_tokens for the market app_id and return a human-readable freshness
    string.  Never reads or returns any token value.

    Returns
    -------
    str
        "not_seeded"  — token_json IS NULL or row absent (first-deploy state)
        "fresh"       — access token is not yet expired
        "expired"     — access token expiry has passed
        "unknown"     — could not determine (e.g. expires_at NULL)
    """
    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT token_json IS NOT NULL, expires_at
                    FROM broker_tokens
                    WHERE app_id = %s
                    """,
                    (app_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()
    except Exception as exc:
        logger.error("health: DB read failed — %s", type(exc).__name__)
        return "unknown"

    if row is None:
        return "not_seeded"

    token_seeded, expires_at = row

    if not token_seeded:
        return "not_seeded"

    if expires_at is None:
        return "unknown"

    now = datetime.datetime.now(tz=datetime.timezone.utc)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)

    return "fresh" if now < expires_at else "expired"


@router.get("/sidecar/health")
async def health(request: Request) -> JSONResponse:
    """
    Return token freshness status without decrypting any token value.

    Response shape:
      { "status": "ok" | "degraded",
        "tokenFreshness": "fresh" | "expired" | "not_seeded" | "unknown",
        "hasLock": <bool> }

    "degraded" is returned when token_json is NULL (pre-OAuth dance) or DB is unreachable.
    "hasLock" reports whether this instance holds the advisory lock (is the active writer);
    a healthy instance may be lock-free transiently during a rolling-deploy rollover.
    The sidecar stays alive in degraded state; chain requests will return 503.
    """
    db_url: str = request.app.state.db_url
    app_id: str = getattr(request.app.state, "market_app_id", "market")
    # has_lock: whether THIS instance holds the advisory lock (is the active writer).
    # During a rolling-deploy rollover a new instance is healthy but lock-free until the
    # old one releases — hasLock=False then, even with a fresh token. Informational; the
    # chain endpoint independently 503s while no market client exists.
    has_lock: bool = bool(getattr(request.app.state, "has_lock", False))

    freshness = _read_token_freshness(db_url, app_id)

    # Degraded when token is absent, expired, or status is unknown — only a fresh
    # token means chain requests will succeed (WR-03).
    if freshness in ("not_seeded", "expired", "unknown"):
        return JSONResponse(
            content={"status": "degraded", "tokenFreshness": freshness, "hasLock": has_lock}
        )

    return JSONResponse(
        content={"status": "ok", "tokenFreshness": freshness, "hasLock": has_lock}
    )
