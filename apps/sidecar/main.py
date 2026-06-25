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

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import schwab
from fastapi import FastAPI

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Composition root: acquire lock → init clients → yield → release lock.

    Degrades gracefully if token_json is not yet seeded (D-03 first-deploy state).
    """
    # Import here so tests that don't use lifespan can import `app` without valid env.
    from config import SidecarConfig
    from advisory_lock import acquire_sidecar_lock
    from token_store import make_token_callbacks

    # 1. Parse config (env vars must be set at this point).
    try:
        cfg = SidecarConfig()
    except Exception as exc:
        logger.error("sidecar: config validation failed — field names: %s", [
            f.alias or f.field_name
            for f in type(exc).__mro__  # best-effort; pydantic will print fields
        ])
        raise

    # 2. Acquire advisory lock (GW-04).
    #    Uses direct DATABASE_URL (port 5432) — MUST NOT be pool URL (RESEARCH Pitfall 2).
    lock_conn = acquire_sidecar_lock(cfg.DATABASE_URL)

    # Store db_url on app.state for health + chain handlers.
    app.state.db_url = cfg.DATABASE_URL
    app.state.market_app_id = "market"

    # 3. Init two schwab-py clients (D-05).
    trader_read, trader_write = make_token_callbacks(
        cfg.DATABASE_URL, "trader", cfg.TOKEN_ENCRYPTION_KEY
    )
    market_read, market_write = make_token_callbacks(
        cfg.DATABASE_URL, "market", cfg.TOKEN_ENCRYPTION_KEY
    )

    trader_client: Optional[object] = None
    market_client: Optional[object] = None

    try:
        trader_client = schwab.auth.client_from_access_functions(
            cfg.SCHWAB_TRADER_APP_KEY,
            cfg.SCHWAB_TRADER_APP_SECRET,
            trader_read,
            trader_write,
            asyncio=True,
        )
        logger.info("sidecar: trader client initialised")
    except ValueError as exc:
        # token_json is NULL (not yet seeded) — degrade gracefully.
        logger.warning(
            "sidecar: trader client not initialised — token not seeded. "
            "Run the manual OAuth dance (D-03) to seed token_json. "
            "Error type: %s",
            type(exc).__name__,
        )

    try:
        market_client = schwab.auth.client_from_access_functions(
            cfg.SCHWAB_MARKET_APP_KEY,
            cfg.SCHWAB_MARKET_APP_SECRET,
            market_read,
            market_write,
            asyncio=True,
        )
        logger.info("sidecar: market client initialised")
    except ValueError as exc:
        logger.warning(
            "sidecar: market client not initialised — token not seeded. "
            "Run the manual OAuth dance (D-03) to seed token_json. "
            "Error type: %s",
            type(exc).__name__,
        )

    # Store clients on app.state (None if not seeded — handlers degrade gracefully).
    app.state.trader_client = trader_client
    app.state.market_client = market_client
    app.state.degraded = market_client is None

    if app.state.degraded:
        logger.warning(
            "sidecar: running in degraded mode — market client not available. "
            "/sidecar/chain will return 503 until token_json is seeded."
        )

    try:
        yield
    finally:
        # Shutdown: close the advisory-lock connection — releases the session-level lock.
        lock_conn.close()
        logger.info("sidecar: advisory lock released; shutdown complete")


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
