"""
Sidecar service configuration (pydantic-settings).

Mirrors the field set of apps/worker/src/config.ts.

Security rules (from CLAUDE.md + RESEARCH.md § Project Constraints):
  - Config values are NEVER logged — only field names are logged on validation failure.
  - TOKEN_ENCRYPTION_KEY is passed ONLY as a bound psycopg2 %s parameter to pgp_sym_encrypt.
    It must never appear in an f-string, log call, or SQL format string.
  - DATABASE_URL must be the direct connection (port 5432) — NOT the PgBouncer pool URL
    (port 6543). The advisory lock (advisory_lock.py) is incompatible with PgBouncer
    transaction-mode pooling (RESEARCH Pitfall 2 / RESEARCH § Project Constraints).
"""

from pydantic_settings import BaseSettings


class SidecarConfig(BaseSettings):
    # Direct Postgres connection (port 5432 / session-pooler).
    # MUST NOT be the PgBouncer transaction-mode URL (port 6543):
    # PgBouncer resets session-level advisory locks between transactions.
    DATABASE_URL: str

    # AES key for pgp_sym_encrypt.  Min 32 chars.
    # Passed ONLY as a bound %s parameter — never interpolated into SQL or logged.
    TOKEN_ENCRYPTION_KEY: str

    # Schwab Developer Portal → trader app credentials.
    SCHWAB_TRADER_APP_KEY: str
    SCHWAB_TRADER_APP_SECRET: str

    # Schwab Developer Portal → market app credentials.
    SCHWAB_MARKET_APP_KEY: str
    SCHWAB_MARKET_APP_SECRET: str

    # Port to bind uvicorn on Railway.  Railway sets $PORT at deploy time.
    PORT: int = 8000


# Module-level singleton — parsed once at import time (composition-root pattern).
# On validation failure pydantic-settings raises ValidationError; never log values,
# only field names.
config = SidecarConfig()
