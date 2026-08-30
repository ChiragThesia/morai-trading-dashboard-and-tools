from __future__ import annotations

import os
from collections.abc import AsyncGenerator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.settings import get_settings

# `morai.settings` instantiates a module-level `Settings` singleton at import time
# (D-15 — boot fails loudly, not on first request). That means `DATABASE_URL` must be
# present *before* pytest collects any test module that imports `morai.settings`,
# since monkeypatch fixtures only run inside a test, after collection already happened.
# This placeholder never touches a database — individual tests override it with their
# own monkeypatch.setenv/delenv and construct their own `Settings` instances.
os.environ.setdefault(
    "DATABASE_URL", "postgresql://placeholder:placeholder@localhost:5432/placeholder"
)


@pytest.fixture(autouse=True)
def isolate_from_ambient_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    """Run every test in an empty directory, so no test ever reads the developer's
    real `.env`.

    `Settings` is configured with `env_file=".env"`, which pydantic-settings resolves
    relative to the *current working directory*. A suite run from the repository root
    therefore loads whatever that developer happens to have in `.env` — here, a v1-era
    file carrying live Schwab credentials that this backend does not declare. Under
    `extra="forbid"` those keys fail validation, so the result of the suite depends on
    a file that is deliberately untracked and differs on every machine.

    That is how this suite reported green when it was first written: it ran inside a
    git worktree, which had no `.env` because the file is gitignored and so never
    propagated. The same commit failed the moment it ran from the primary checkout.
    A test whose outcome turns on an untracked file is not a test.

    Tests that *want* an env file write their own into `tmp_path` — they are already
    running inside it, so they need no chdir of their own.
    """
    monkeypatch.chdir(tmp_path)
    yield


REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def migrated_db() -> None:
    """Run `alembic upgrade head` once per test session, against the real database
    named by `DATABASE_URL`.

    No `try`/`except` here that turns a connection failure into a skip. A
    silently-skipped round-trip test is the exact failure this phase exists to
    prevent (T-01-15) — if Postgres is unreachable, this fails loudly, and so does
    every test that depends on it.

    Absolute path to `alembic.ini`, not a relative one: `isolate_from_ambient_dotenv`
    chdirs every test into a tmp dir, and `alembic.ini`'s own `%(here)s` token only
    resolves the *script* location relative to the ini file, not the ini file itself
    relative to the process cwd.
    """
    command.upgrade(Config(str(REPO_ROOT / "alembic.ini")), "head")


@pytest_asyncio.fixture
async def clean_gate_money_probe(migrated_db: None) -> AsyncGenerator[None, None]:
    """Truncate `gate_money_probe` before each db-marked test, so tests don't leak
    rows into each other. Truncating rather than recreating the schema, per plan."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE gate_money_probe RESTART IDENTITY"))
    await engine.dispose()
    yield


@pytest_asyncio.fixture
async def db_session(
    clean_gate_money_probe: None,
) -> AsyncGenerator[AsyncSession, None]:
    """One `AsyncSession` per test, on its own engine — a connection independent of
    the app's own (`morai.db.session.get_engine`), so a test reading through this
    fixture after an HTTP call proves persistence, not an in-memory echo."""
    engine = create_async_engine(get_settings().async_dsn)
    async with AsyncSession(engine) as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(clean_gate_money_probe: None) -> AsyncGenerator[AsyncClient, None]:
    """An httpx client against the real ASGI app over `ASGITransport` — no network
    socket, but the full FastAPI/Pydantic/SQLAlchemy stack runs for real."""
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
