from __future__ import annotations

import os
from collections.abc import AsyncGenerator, Iterator
from pathlib import Path

# `morai.settings` instantiates a module-level `Settings` singleton at import time
# (D-15 — boot fails loudly, not on first request). That means `DATABASE_URL` must be
# present *before* pytest collects any test module that imports `morai.settings`,
# since monkeypatch fixtures only run inside a test, after collection already happened.
# This placeholder never touches a database — individual tests override it with their
# own monkeypatch.setenv/delenv and construct their own `Settings` instances.
os.environ.setdefault(
    "DATABASE_URL", "postgresql://placeholder:placeholder@localhost:5432/placeholder"
)

# The autouse fixture below isolates each *test* from the developer's `.env`, but some
# modules read configuration at import time -- `morai.worker.app` builds its
# Procrastinate App, and therefore its connector DSN, at module scope, because the
# `procrastinate ... worker` CLI needs a module-level `app` to find. Import happens
# during collection, before any fixture can run.
#
# Point the settings model at a non-existent env file for the whole test session, so
# that import-time load reads the environment only. chdir is NOT the tool here: doing
# it at conftest import runs before pytest resolves its relative `testpaths`, and
# discovery then finds nothing and the suite silently passes zero tests.
os.environ.setdefault("MORAI_ENV_FILE", "")

# ruff: noqa: E402 -- the environment setup above must run before `morai.settings`
# is imported. `Settings.model_config` resolves `env_file` at class-definition
# time, so importing first would bake in `.env` before the override is visible.
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from procrastinate import periodic
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.settings import get_settings


@pytest.fixture(autouse=True)
def no_periodic_deferrer(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never let Procrastinate's periodic deferrer run inside a test.

    Every test that drains a job with `app.run_worker_async(wait=False)` runs a real
    Procrastinate worker against the real module-level `morai.worker.app.app`, and a
    real worker starts a real periodic deferrer as a side task. That deferrer fires on
    its *first* pass, not only on a minute boundary: with no prior defer recorded,
    `PeriodicDeferrer.get_timestamps` yields the previous cron tick whenever that tick
    is within `MAX_DELAY` (600s), which for Phase 1's `* * * * *` crons it always is.
    Across runs only `procrastinate_periodic_defers`' unique constraint suppresses the
    repeat -- so the first worker-driving test in each wall-clock minute fires them and
    the rest do not, which is what made the resulting contamination intermittent.

    What it contaminates: `sync_all_connected_users` fans out a genuine `sync_user` job
    for whatever connection the test just seeded, and `sync_user_task` resolves
    `get_schwab_auth()` at call time -- so it runs through whatever vendor seam that
    test monkeypatched, for a task the test never invoked. Measured cost: roughly
    1-in-20 spurious failures of
    `tests/ingest/test_snapshot_capture.py::test_expired_connection_writes_gap`, whose
    `fake_auth.last_client is None` is its proof that no vendor call was attempted.

    Disabling the deferrer's loop rather than emptying `app.periodic_registry` is
    deliberate: the registrations are themselves under test
    (`test_worker_heartbeat.py::test_heartbeat_is_registered_as_a_periodic_task`,
    `tests/ingest/test_fanout.py::test_sync_all_connected_users_is_registered_as_a_periodic_task`),
    and those two must keep reading the live registry rather than a snapshot. Returning
    immediately is also the vendor's own no-op path -- `PeriodicDeferrer.worker` returns
    exactly this way when the registry is empty, so the worker's side-task monitor
    already treats a completed deferrer as normal.

    A test that wants a periodic tick defers it explicitly by name, as every test here
    already does; none relies on the deferrer's clock.
    """

    async def _do_not_defer(_self: periodic.PeriodicDeferrer) -> None:
        return None

    monkeypatch.setattr(periodic.PeriodicDeferrer, "worker", _do_not_defer)


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
async def clean_fills_table(migrated_db: None) -> AsyncGenerator[None, None]:
    """Truncate `fills` before each db-marked test, so tests don't leak rows into
    each other. Replaces the retired `clean_gate_money_probe` (03-07) now that the
    money round-trip proof runs against the encrypted fill path instead of
    `gate_money_probe` -- nothing reachable from this fixture names that table any
    more. Truncating rather than recreating the schema, per plan."""
    engine = create_async_engine(get_settings().async_dsn)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE fills RESTART IDENTITY CASCADE"))
    await engine.dispose()
    yield


@pytest_asyncio.fixture
async def db_session(
    clean_fills_table: None,
) -> AsyncGenerator[AsyncSession, None]:
    """One `AsyncSession` per test, on its own engine — a connection independent of
    the app's own (`morai.db.session.get_engine`), so a test reading through this
    fixture after an HTTP call proves persistence, not an in-memory echo."""
    engine = create_async_engine(get_settings().async_dsn)
    async with AsyncSession(engine) as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(clean_fills_table: None) -> AsyncGenerator[AsyncClient, None]:
    """An httpx client against the real ASGI app over `ASGITransport` — no network
    socket, but the full FastAPI/Pydantic/SQLAlchemy stack runs for real."""
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
