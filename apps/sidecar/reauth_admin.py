"""
Sidecar admin endpoints for the in-app Schwab re-auth wizard (Phase 37, REAUTH-01/02).

POST /sidecar/admin/reauth/start     — mint a per-app Schwab authorize URL + single-use nonce.
POST /sidecar/admin/reauth/exchange  — consume the nonce, exchange the redirect for tokens,
                                        anchor refresh_issued_at, re-init the session.

Both endpoints are gated by a constant-time compare of X-Sidecar-Admin-Token against
cfg.SIDECAR_ADMIN_TOKEN — the sidecar has no other auth (GW-05 private-net only is not
sufficient on its own, since these routes mint/exchange live Schwab tokens).

Security (threat_model, 37-04-PLAN.md):
  T-37-01: nonce consumed atomically (DELETE ... RETURNING app_id) with a 10-minute TTL —
           single-use, replay-killed; an unknown/expired/consumed state is rejected without
           guessing an app_id.
  T-37-02: exchange failures log only type(exc).__name__ — never str(exc), the redirect
           URL, or the authorization code.
  T-37-03: hmac.compare_digest (constant-time) admin-token guard on both endpoints.
  T-37-05: reinit_schwab_session (37-03) cancels+awaits old tasks before recreating new
           ones — the advisory lock is held throughout, never touched here.

INTERNAL ONLY (GW-05): Railway private network; MUST NOT be exposed on a public domain.
"""

import asyncio
import hmac
import logging
import urllib.parse
from typing import Literal, Optional

import psycopg2
import schwab.auth
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from token_store import make_reauth_writer

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
            # below is the real enforcement (ponytail: no cron needed, ~1 row per
            # wizard click).
            cur.execute("DELETE FROM reauth_nonces WHERE created_at < now() - interval '10 minutes'")
            cur.execute(
                "INSERT INTO reauth_nonces (state, app_id) VALUES (%s, %s)",
                (ctx.state, body.app),
            )
    finally:
        conn.close()

    return StartResponse(app=body.app, authUrl=ctx.authorization_url, state=ctx.state)


# ─── /exchange ────────────────────────────────────────────────────────────────


class ExchangeBody(BaseModel):
    redirectUrl: str


class ExchangeResponse(BaseModel):
    app: str
    ok: bool


def _consume_nonce(cfg: object, state: str) -> Optional[str]:
    """Atomically validate+consume the nonce (T-37-01). Returns the app_id, or None if
    the state is unknown/expired/already-consumed — reject without guessing an app_id."""
    conn = psycopg2.connect(cfg.DATABASE_URL)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM reauth_nonces WHERE state = %s "
                "AND created_at > now() - interval '10 minutes' "
                "RETURNING app_id",
                (state,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row[0] if row else None


def _is_freshly_anchored(cfg: object, app_id: str) -> bool:
    """Per-app freshness re-check — same gate as seed_token._verify_and_finish. A
    written-but-stale row (or no row) returns False, never a bare 'no exception' signal."""
    conn = psycopg2.connect(cfg.DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT refresh_issued_at > now() - interval '5 minutes' "
                "FROM broker_tokens WHERE app_id = %s",
                (app_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return bool(row and row[0])


@router.post("/sidecar/admin/reauth/exchange", response_model=ExchangeResponse)
async def reauth_exchange(
    request: Request,
    body: ExchangeBody,
    x_sidecar_admin_token: Optional[str] = Header(default=None),
) -> ExchangeResponse | JSONResponse:
    unauthorized = _require_admin_token(request, x_sidecar_admin_token)
    if unauthorized is not None:
        return unauthorized

    cfg = request.app.state.cfg
    state = urllib.parse.parse_qs(urllib.parse.urlparse(body.redirectUrl).query).get("state", [None])[0]
    app_id = _consume_nonce(cfg, state) if state else None
    if app_id is None:
        return JSONResponse(status_code=400, content={"error": "invalid_or_expired_state"})

    key, secret = _app_credentials(cfg, app_id)
    loop = asyncio.get_event_loop()
    try:
        ctx = schwab.auth.get_auth_context(key, cfg.SCHWAB_WEB_CALLBACK_URL, state=state)
        # BLOCKING HTTP POST (authlib/requests) — never call directly in the async handler
        # (mirrors main.py's run_in_executor wrapping of try_acquire_sidecar_lock).
        await loop.run_in_executor(
            None,
            schwab.auth.client_from_received_url,
            key, secret, ctx, body.redirectUrl,
            make_reauth_writer(cfg.DATABASE_URL, app_id, cfg.TOKEN_ENCRYPTION_KEY),
        )
    except Exception as exc:  # noqa: BLE001 — never log the code/redirect URL/message (T-37-02)
        logger.error(
            "reauth exchange failed for app_id=%s (%s)", app_id, type(exc).__name__
        )
        return ExchangeResponse(app=app_id, ok=False)

    fresh = _is_freshly_anchored(cfg, app_id)
    # Local import — avoids a reauth_admin<->main circular import at module-load time
    # (mirrors main.py's own lazy `from streamer import start_streamer`).
    from main import reinit_schwab_session

    await reinit_schwab_session(request.app, cfg)
    return ExchangeResponse(app=app_id, ok=fresh)
