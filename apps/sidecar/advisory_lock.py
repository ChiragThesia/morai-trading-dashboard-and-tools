"""
Postgres advisory-lock guard for the single-streamer invariant (GW-04).

Public API
----------
SIDECAR_LOCK_KEY : int
    Stable bigint used as the advisory-lock key.  Documented here as the canonical value.

acquire_sidecar_lock(direct_db_url) -> psycopg2.extensions.connection
    Acquires a session-level pg_try_advisory_lock.
    Returns the open connection (caller holds it; lock is released when conn closes).
    Raises SystemExit(1) if the lock is already held (second instance).

Single-streamer invariant (GW-04)
----------------------------------
Only one sidecar process may hold the advisory lock.  A second sidecar instance that
cannot acquire it logs a clear error and refuses to start, preventing dual Schwab
streaming sessions (which would trigger Schwab's invalid_grant on the next refresh).

Connection constraint (RESEARCH Pitfall 2)
------------------------------------------
MUST use the direct DATABASE_URL (port 5432), NOT the PgBouncer pool URL (port 6543).
PgBouncer transaction-mode pooler resets session state (including advisory locks) when
it returns a connection to the pool.  Using the pool URL silently releases the lock
between requests, defeating the single-instance guarantee.

Don't hand-roll unlock (§ Don't Hand-Roll)
------------------------------------------
PostgreSQL releases session-level advisory locks automatically when the holding
connection is closed — including on process crash.  Do not add an explicit
pg_advisory_unlock call.  The caller (main.py lifespan) holds the connection open for
the process lifetime and closes it on graceful shutdown.
"""

import logging

import psycopg2
import psycopg2.extensions

logger = logging.getLogger(__name__)

# ── Lock key ──────────────────────────────────────────────────────────────────
# Stable bigint; one sidecar session permitted at a time (GW-04).
# Chosen to be unlikely to collide with any application-level advisory locks.
SIDECAR_LOCK_KEY: int = 8876543210


def acquire_sidecar_lock(
    direct_db_url: str,
) -> psycopg2.extensions.connection:
    """
    Acquire a session-level Postgres advisory lock for the sidecar process (GW-04).

    Uses pg_try_advisory_lock (non-blocking) so a second instance fails immediately
    with a clear error rather than blocking indefinitely.

    Parameters
    ----------
    direct_db_url : str
        Direct Postgres connection URL (port 5432 / session-pooler).
        MUST NOT be the PgBouncer transaction-mode URL (port 6543) — the pooler
        silently releases session-level locks between transactions (RESEARCH Pitfall 2).

    Returns
    -------
    psycopg2.extensions.connection
        The open connection that holds the advisory lock.  The caller MUST keep this
        reference alive for the process lifetime.  The lock is released automatically
        when this connection is closed (graceful shutdown or crash).

    Raises
    ------
    SystemExit(1)
        If pg_try_advisory_lock returns False — another sidecar instance is already
        running.  Logs a clear error message before raising.
    """
    conn = psycopg2.connect(direct_db_url)
    conn.autocommit = True  # session-level lock requires autocommit (no tx boundary)

    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", (SIDECAR_LOCK_KEY,))
        acquired: bool = cur.fetchone()[0]

    if not acquired:
        conn.close()
        logger.error(
            "sidecar: failed to acquire advisory lock %s — "
            "another sidecar instance is running. "
            "Refusing to start to prevent dual Schwab streaming sessions.",
            SIDECAR_LOCK_KEY,
        )
        raise SystemExit(1)

    logger.info("sidecar: advisory lock %s acquired", SIDECAR_LOCK_KEY)
    return conn  # caller holds reference; lock released on conn.close()
