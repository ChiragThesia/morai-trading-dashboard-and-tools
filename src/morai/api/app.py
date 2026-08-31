"""The app entrypoint: lifespan RLS check, health, and the identity router.

`POST /gate/money-roundtrip` -- Phase 1's tracer, one money value through the
whole stack -- is dropped in migration 0009 alongside `gate_money_probe`
(D3-17, T-03-37); its Decimal round-trip proof moved onto the encrypted fill
path in `tests/test_money_roundtrip.py`. That deployed-surface proof is not
replaced here -- recorded, not softened, in this plan's own SUMMARY.

Every route declares its contract by return type annotation, never the
`response_model=` keyword (D-11) — the keyword is invisible to the type checker;
FastAPI 0.89+ infers `response_model` from the annotation, so one declaration gets
two gates: basedpyright at build time and FastAPI at runtime.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from morai.api.errors import install_error_handling
from morai.api.routes_connections import router as connections_router
from morai.api.routes_identity import router as identity_router
from morai.db.session import get_session_maker
from morai.identity.rls import assert_connection_cannot_bypass_rls


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Refuses to start if the runtime connection can bypass RLS
    (`02-RESEARCH.md` Pitfall 1). Cost is nil: the web service's start
    command already runs `alembic upgrade head` before hypercorn, so the
    database must be reachable at boot regardless -- this is a check on a
    connection that has to work anyway, not a new failure mode.

    `/health` stays liveness-only with no database call (D-14); this gate is
    at startup, not on the probe path.
    """
    async with get_session_maker()() as session:
        await assert_connection_cannot_bypass_rls(session)
    yield


app = FastAPI(lifespan=lifespan)
install_error_handling(app)
app.include_router(identity_router)
app.include_router(connections_router)


class HealthResponse(BaseModel):
    status: str


@app.get("/health")
async def health() -> HealthResponse:
    """Liveness only — no database call (D-14). Railway checks health only at
    deploy time, so a database-dependent `/health` costs a failed deploy, not a
    restart loop."""
    return HealthResponse(status="ok")
