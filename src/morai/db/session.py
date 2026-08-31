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
    """The DDL/superuser engine, built once on first call.

    Used by Alembic and by `tests/conftest.py`'s fixtures -- never by a route.
    The web process's own runtime connection is `get_app_engine()` below,
    which connects as the least-privilege `morai_app` role so RLS is actually
    evaluated for its queries (phase 2). A superuser-capable session sitting
    in the web process is precisely the backdoor RLS exists to close.
    """
    return create_async_engine(get_settings().async_dsn)


@lru_cache(maxsize=1)
def get_app_engine() -> AsyncEngine:
    """The web process's runtime `AsyncEngine`, connected as `morai_app`
    (`NOSUPERUSER NOBYPASSRLS`) rather than the superuser role `get_engine()`
    uses. `get_db_session` -- the dependency every route uses -- is switched
    wholesale to this engine; there is no second, superuser-capable session
    lying around in the web process to bypass a policy by accident.

    Pool capped explicitly (`NN-28`): Railway's Postgres has no pooler in
    front of it (`02-RESEARCH.md`'s spike), so SQLAlchemy's own pool is the
    only ceiling on connection count. A handful of users makes this a
    low-probability problem today; capping it costs one keyword argument now
    against a production incident later.
    """
    return create_async_engine(
        get_settings().app_async_dsn, pool_size=5, max_overflow=5
    )


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_app_engine(), expire_on_commit=False)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding one `AsyncSession` per request, on the
    app-role engine (`get_app_engine`) -- not the superuser engine."""
    async with get_session_maker()() as session:
        yield session
