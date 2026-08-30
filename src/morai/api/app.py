"""The tracer: one money value through the whole stack.

RED: `/gate/money-roundtrip` does not exist yet -- only `/health` is wired. This is
the failing half of `tests/test_money_roundtrip.py`'s red/green commit pair (D-08).
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class HealthResponse(BaseModel):
    status: str


@app.get("/health")
async def health() -> HealthResponse:
    """Liveness only — no database call (D-14). Railway checks health only at
    deploy time, so a database-dependent `/health` costs a failed deploy, not a
    restart loop."""
    return HealthResponse(status="ok")
