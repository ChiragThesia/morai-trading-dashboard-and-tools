"""The async engine and per-request session (D-13).

`get_engine()` is built once on first call, not at import time — deliberately not a
module-level singleton, for the same reason `get_settings()` in `morai.settings`
isn't one: a singleton built at import time reads `DATABASE_URL` before any test
fixture can isolate the environment, and fires during test collection rather than at
process boot.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from morai.settings import get_settings


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    """The process-wide `AsyncEngine`, built once on first call."""
    return create_async_engine(get_settings().async_dsn)


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding one `AsyncSession` per request."""
    async with get_session_maker()() as session:
        yield session
