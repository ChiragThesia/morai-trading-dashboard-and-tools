"""
Sidecar admin endpoints for the in-app Schwab re-auth wizard (Phase 37, REAUTH-01/02).

POST /sidecar/admin/reauth/start — mint a per-app Schwab authorize URL + single-use nonce.
(POST /sidecar/admin/reauth/exchange lands in Task 2 of this plan.)

Both endpoints are gated by a constant-time compare of X-Sidecar-Admin-Token against
cfg.SIDECAR_ADMIN_TOKEN — the sidecar has no other auth (GW-05 private-net only is not
sufficient on its own, since these routes mint/exchange live Schwab tokens).

Security (threat_model, 37-04-PLAN.md):
  T-37-01: nonce persisted with a 10-minute TTL, enforced at consumption time (Task 2).
  T-37-03: hmac.compare_digest (constant-time) admin-token guard on both endpoints.

INTERNAL ONLY (GW-05): Railway private network; MUST NOT be exposed on a public domain.
"""

import hmac
import logging
from typing import Literal, Optional

import psycopg2
import schwab.auth
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# (app_id, key_attr, secret_attr) — resolves an app's Schwab credentials off cfg. Mirrors
# seed_token.py's APPS list, minus the per-app callback (Phase 37 uses ONE shared
# SCHWAB_WEB_CALLBACK_URL for both apps — RESEARCH Assumption A3).
_APPS = (
    ("trader", "SCHWAB_TRADER_APP_KEY", "SCHWAB_TRADER_APP_SECRET"),
    ("market", "SCHWAB_MARKET_APP_KEY", "SCHWAB_MARKET_APP_SECRET"),
)


def _app_credentials(cfg: object, app_id: str) -> tuple[str, str]:
    """Resolve (key, secret) for app_id off cfg. Raises KeyError if app_id is unknown."""
    for candidate_id, key_attr, secret_attr in _APPS:
        if candidate_id == app_id:
            return getattr(cfg, key_attr), getattr(cfg, secret_attr)
    raise KeyError(f"unknown app_id: {app_id!r}")


def _require_admin_token(request: Request, x_sidecar_admin_token: Optional[str]) -> Optional[JSONResponse]:
    """Constant-time compare the header against cfg.SIDECAR_ADMIN_TOKEN (T-37-03).
    Returns a 401 JSONResponse on mismatch/absence, or None if the token is valid."""
    cfg = request.app.state.cfg
    token = x_sidecar_admin_token or ""
    if not hmac.compare_digest(token, cfg.SIDECAR_ADMIN_TOKEN):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return None


# ─── /start ───────────────────────────────────────────────────────────────────


class StartBody(BaseModel):
    app: Literal["trader", "market"]


class StartResponse(BaseModel):
    app: str
    authUrl: str
    state: str


@router.post("/sidecar/admin/reauth/start", response_model=StartResponse)
async def reauth_start(
    request: Request,
    body: StartBody,
    x_sidecar_admin_token: Optional[str] = Header(default=None),
) -> StartResponse | JSONResponse:
    unauthorized = _require_admin_token(request, x_sidecar_admin_token)
    if unauthorized is not None:
        return unauthorized

    cfg = request.app.state.cfg
    key, _secret = _app_credentials(cfg, body.app)
    ctx = schwab.auth.get_auth_context(key, cfg.SCHWAB_WEB_CALLBACK_URL)

    conn = psycopg2.connect(cfg.DATABASE_URL)
    try:
        with conn, conn.cursor() as cur:
            # Best-effort TTL sweep — housekeeping only. The WHERE-clause on consume
            # (Task 2) is the real enforcement (ponytail: no cron needed, ~1 row per
            # wizard click).
            cur.execute("DELETE FROM reauth_nonces WHERE created_at < now() - interval '10 minutes'")
            cur.execute(
                "INSERT INTO reauth_nonces (state, app_id) VALUES (%s, %s)",
                (ctx.state, body.app),
            )
    finally:
        conn.close()

    return StartResponse(app=body.app, authUrl=ctx.authorization_url, state=ctx.state)
