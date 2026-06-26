"""
FastAPI sidecar service entry point (GW-01, GW-02, GW-05).

Lifespan order (RESEARCH Pattern 4 / PATTERNS.md § main.py):
  1. Parse config (pydantic-settings from env)
  2. Acquire the Postgres advisory lock (must succeed before client init — GW-04)
  3. Init two schwab-py clients (trader + market, D-05) via client_from_access_functions
     catching ValueError("No token found") → graceful not-seeded degrade (Open Question 2)
  4. Store clients on app.state for use by route handlers
  5. On shutdown: close the advisory-lock connection (releases the session-level lock)

Prohibitions:
  - MUST NOT call streamer login() or subscribe() — lock-only this phase (Phase 12)
  - MUST NOT read DATABASE_POOL_URL — advisory lock requires the direct connection
  - MUST NOT log any config value — only field names on failure (CLAUDE.md)
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from typing import AsyncIterator, Optional

import schwab
from fastapi import FastAPI

logger = logging.getLogger(__name__)

# Seconds between advisory-lock acquisition attempts while another instance holds it
# (e.g. during a Railway rolling-deploy rollover). Bounded so rollover completes quickly.
LOCK_RETRY_SECONDS = 5.0


async def _acquire_lock_and_init(app: FastAPI, cfg: object) -> None:
    """
    Background task: acquire the advisory lock (retrying), then init the schwab clients.

    Runs concurrently with the app serving /sidecar/health. The app is healthy WITHOUT the
    lock; this task acquires it once it frees up (GW-04 single-writer; breaks the
    rolling-deploy rollover deadlock — see advisory_lock.py). Until the lock is held,
    app.state.has_lock stays False and no Schwab clients exist, so /sidecar/chain returns
    503 (caller falls back to CBOE).
    """
    from advisory_lock import try_acquire_sidecar_lock
    from token_store import make_token_callbacks

    loop = asyncio.get_event_loop()

    # 1. Acquire the advisory lock, retrying while another instance holds it.
    #    psycopg2 is blocking → run in the default executor so the event loop (and the
    #    health endpoint) stays responsive.
    lock_conn = None
    while lock_conn is None:
        lock_conn = await loop.run_in_executor(
            None, try_acquire_sidecar_lock, cfg.DATABASE_URL  # type: ignore[attr-defined]
        )
        if lock_conn is None:
            logger.warning(
                "sidecar: advisory lock held by another instance — retrying in %ss "
                "(serving /sidecar/health in degraded mode meanwhile)",
                LOCK_RETRY_SECONDS,
            )
            await asyncio.sleep(LOCK_RETRY_SECONDS)

    app.state.lock_conn = lock_conn
    app.state.has_lock = True
    logger.info("sidecar: advisory lock acquired — this instance is the active writer")

    # 2. Init two schwab-py clients (D-05). Degrade gracefully if token_json not seeded.
    trader_read, trader_write = make_token_callbacks(
        cfg.DATABASE_URL, "trader", cfg.TOKEN_ENCRYPTION_KEY  # type: ignore[attr-defined]
    )
    market_read, market_write = make_token_callbacks(
        cfg.DATABASE_URL, "market", cfg.TOKEN_ENCRYPTION_KEY  # type: ignore[attr-defined]
    )

    try:
        app.state.trader_client = schwab.auth.client_from_access_functions(
            cfg.SCHWAB_TRADER_APP_KEY, cfg.SCHWAB_TRADER_APP_SECRET,  # type: ignore[attr-defined]
            trader_read, trader_write, asyncio=True,
        )
        logger.info("sidecar: trader client initialised")
    except ValueError as exc:
        logger.warning(
            "sidecar: trader client not initialised — token not seeded. "
            "Run the manual OAuth dance (D-03) to seed token_json. Error type: %s",
            type(exc).__name__,
        )

    try:
        app.state.market_client = schwab.auth.client_from_access_functions(
            cfg.SCHWAB_MARKET_APP_KEY, cfg.SCHWAB_MARKET_APP_SECRET,  # type: ignore[attr-defined]
            market_read, market_write, asyncio=True,
        )
        logger.info("sidecar: market client initialised")
    except ValueError as exc:
        logger.warning(
            "sidecar: market client not initialised — token not seeded. "
            "Run the manual OAuth dance (D-03) to seed token_json. Error type: %s",
            type(exc).__name__,
        )

    app.state.degraded = app.state.market_client is None
    if app.state.degraded:
        logger.warning(
            "sidecar: holding the lock but degraded — market client not available "
            "(token not seeded). /sidecar/chain returns 503 until token_json is seeded "
            "and this instance restarts."
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Composition root: parse config → start background lock-acquire task → yield → cleanup.

    The advisory lock is acquired in a BACKGROUND task (not blocking startup) so the app
    serves /sidecar/health immediately, lock-free. This is what makes Railway zero-downtime
    rolling deploys work: the new instance becomes healthy without the lock, Railway stops
    the old instance (releasing its lock), and the background task then acquires it. Blocking
    startup on the lock would deadlock the rollover. Degrades gracefully if token_json is not
    yet seeded (D-03 first-deploy state).
    """
    # Import here so tests that don't use lifespan can import `app` without valid env.
    from config import SidecarConfig

    # Parse config (env vars must be set at this point).
    try:
        cfg = SidecarConfig()
    except Exception as exc:
        # pydantic-settings ValidationError exposes .errors() for field-level detail.
        # Log only field names (loc) — never values (CLAUDE.md).
        import pydantic_core
        if isinstance(exc, pydantic_core.ValidationError):
            field_names = [str(e["loc"]) for e in exc.errors()]
        else:
            field_names = [type(exc).__name__]
        logger.error(
            "sidecar: config validation failed — check env vars: %s",
            field_names,
        )
        raise

    # Reset app.state for this lifespan run; clients/lock arrive via the background task.
    app.state.db_url = cfg.DATABASE_URL
    app.state.market_app_id = "market"
    app.state.has_lock = False
    app.state.trader_client = None
    app.state.market_client = None
    app.state.degraded = True

    # Start the background lock-acquire + client-init task. It owns app.state.lock_conn.
    task = asyncio.create_task(_acquire_lock_and_init(app, cfg))

    try:
        yield
    finally:
        # Shutdown: stop the background task, then close the lock connection (releases the
        # session-level advisory lock). Closing on ANY exit path (clean or crash).
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        lock_conn: Optional[object] = getattr(app.state, "lock_conn", None)
        if lock_conn is not None:
            lock_conn.close()  # type: ignore[attr-defined]
            logger.info("sidecar: advisory lock released; shutdown complete")
        else:
            logger.info("sidecar: shutdown complete (lock was never acquired)")


# ── Application ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Morai Sidecar",
    description="Schwab schwab-py proxy — internal-only (GW-05)",
    lifespan=lifespan,
)

# Initialise app.state defaults so route handlers can access them safely even
# when the lifespan has not run (e.g. unit tests using TestClient without the
# context manager).
app.state.market_client = None
app.state.trader_client = None
app.state.degraded = True
app.state.has_lock = False
app.state.db_url = ""
app.state.market_app_id = "market"

# ── Routers ───────────────────────────────────────────────────────────────────

from health import router as health_router  # noqa: E402
from chain_proxy import router as chain_router  # noqa: E402

app.include_router(health_router)
app.include_router(chain_router)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="::",      # IPv4+IPv6 for Railway private networking (RESEARCH Pitfall 5)
        port=port,
        log_level="info",
    )
