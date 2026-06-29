"""
GET /sidecar/events — internal SSE endpoint (sidecar → apps/server).
POST /sidecar/subscribe — ad-hoc OCC symbol activation for the live stream (D-05, SC6).

INTERNAL ONLY (GW-05): These endpoints run on the Railway private network and
MUST NOT be exposed on a public domain. No public ingress.

Security (threat_model 12-03-PLAN.md):
  T-12-03-01: Private-net only; documented via module docstring (GW-05).
  T-12-03-02: Errors log type(exc).__name__ only — never str(exc) or token values.
  T-12-03-05: OCC validator rejects malformed symbols (422) before reaching StreamClient.
"""

import asyncio
import json
import logging
import re
from typing import AsyncGenerator, Annotated

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator

from streamer import event_queue

logger = logging.getLogger(__name__)
router = APIRouter()

# Idle timeout before emitting a keep-alive ping (Assumption A4 — 25s in production).
# Exposed as a module attribute so tests can monkeypatch it without 25s waits.
_SSE_IDLE_TIMEOUT: float = 25.0

# OCC option symbol: 6-char root (space-padded) + 6-char YYMMDD + C/P + 8-char strike (x1000).
# Example: "SPX   260620C05000000" (21 chars total).
_OCC_RE = re.compile(r"^[A-Z ]{6}\d{6}[CP]\d{8}$")


# ─── Request models ───────────────────────────────────────────────────────────


class SubscribeRequest(BaseModel):
    """POST /sidecar/subscribe request body — OCC symbol validated at the boundary."""

    symbol: str

    @field_validator("symbol")
    @classmethod
    def _validate_occ_symbol(cls, v: str) -> str:
        if not _OCC_RE.match(v):
            raise ValueError(
                f"symbol must be a 21-char OCC option symbol "
                f"(e.g. 'SPX   260620C05000000'), got: {v!r}"
            )
        return v


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.get("/sidecar/events")
async def stream_events(request: Request) -> StreamingResponse:
    """
    Internal SSE endpoint: drains streamer.event_queue to apps/server.

    Framing: "data: <json>\\n\\n" per queued event.
    Keep-alive: "event: ping\\ndata: \\n\\n" on _SSE_IDLE_TIMEOUT idle (Assumption A4).
    Disconnect: stops cleanly when await request.is_disconnected() is True (Pitfall 10).

    PRIVATE NET ONLY (GW-05) — no public ingress; Railway internal network.
    """

    async def _generator() -> AsyncGenerator[str, None]:
        while True:
            if await request.is_disconnected():
                logger.info("sidecar events: client disconnected — stopping SSE generator")
                break
            try:
                event = await asyncio.wait_for(event_queue.get(), timeout=_SSE_IDLE_TIMEOUT)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                # Keep-alive ping so the TS server's HTTP client doesn't time out.
                yield "event: ping\ndata: \n\n"

    return StreamingResponse(_generator(), media_type="text/event-stream")


@router.post("/sidecar/subscribe")
async def subscribe(request: Request, body: SubscribeRequest) -> JSONResponse:
    """
    Ad-hoc activation: add an OCC symbol to the live Schwab stream (D-05, SC6).

    Validates the OCC symbol (422 on malformed), guards 503 when the stream is not
    active, then delegates to request_ad_hoc_subscription() which calls
    level_one_option_add (never level_one_option_subs — Pitfall 11).

    Returns: { subscribed: str, evicted: list[str] }

    PRIVATE NET ONLY (GW-05) — no public ingress; auth enforced one hop up at the
    JWT-gated server route (12-05, SC6).
    """
    stream_client = getattr(request.app.state, "stream_client", None)

    if stream_client is None:
        logger.error(
            "subscribe: stream_client not available on app.state — "
            "streamer not yet active (not_seeded or pre-lock)"
        )
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})

    # Lazy import: request_ad_hoc_subscription is added to streamer.py in Task 4.
    from streamer import request_ad_hoc_subscription  # noqa: PLC0415

    try:
        result = await request_ad_hoc_subscription(request.app, body.symbol)
    except Exception as exc:
        logger.error(
            "subscribe: request_ad_hoc_subscription failed — %s (message redacted)",
            type(exc).__name__,
        )
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})

    if result is None:
        # request_ad_hoc_subscription returned the not-streaming sentinel
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})

    return JSONResponse(
        status_code=200,
        content={"subscribed": result["subscribed"], "evicted": result["evicted"]},
    )
