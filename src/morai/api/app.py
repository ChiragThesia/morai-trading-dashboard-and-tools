"""The tracer: one money value through the whole stack.

Both routes declare their contract by return type annotation, never the
`response_model=` keyword (D-11) — the keyword is invisible to the type checker;
FastAPI 0.89+ infers `response_model` from the annotation, so one declaration gets
two gates: basedpyright at build time and FastAPI at runtime.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.errors import install_error_handling
from morai.api.models import MoneyRoundtripRequest, MoneyRoundtripResponse
from morai.api.routes_identity import router as identity_router
from morai.db.models import GateMoneyProbe
from morai.db.session import get_db_session

app = FastAPI()
install_error_handling(app)
app.include_router(identity_router)


class HealthResponse(BaseModel):
    status: str


@app.get("/health")
async def health() -> HealthResponse:
    """Liveness only — no database call (D-14). Railway checks health only at
    deploy time, so a database-dependent `/health` costs a failed deploy, not a
    restart loop."""
    return HealthResponse(status="ok")


@app.post("/gate/money-roundtrip")
async def money_roundtrip(
    body: MoneyRoundtripRequest,
    session: AsyncSession = Depends(get_db_session),
) -> MoneyRoundtripResponse:
    """Insert, commit, then re-read through a fresh `SELECT` — the response is built
    from what the database gave back, never from what the client sent."""
    probe = GateMoneyProbe(amount_usd=body.amount_usd)
    session.add(probe)
    await session.commit()

    fresh = (
        await session.execute(
            select(GateMoneyProbe).where(GateMoneyProbe.id == probe.id)
        )
    ).scalar_one()

    return MoneyRoundtripResponse(probe_id=fresh.id, amount_usd=fresh.amount_usd)
