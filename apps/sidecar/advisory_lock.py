"""
Postgres advisory-lock guard for the single-writer invariant (GW-04).

Public API
----------
SIDECAR_LOCK_KEY : int
    Stable bigint used as the advisory-lock key.  Documented here as the canonical value.

try_acquire_sidecar_lock(direct_db_url) -> psycopg2.extensions.connection | None
    Attempts a session-level pg_try_advisory_lock (non-blocking).
    Returns the open connection (caller holds it; lock released when conn closes) on success,
    or None if the lock is already held by another instance.  Never raises SystemExit — the
    caller decides whether to retry (rolling-deploy rollover) or give up.

Single-writer invariant (GW-04)
-------------------------------
Only one sidecar process may hold the advisory lock at a time, so only one instance refreshes
Schwab tokens / opens a streamer session (a second writer would trigger Schwab's invalid_grant
on the next refresh).  A second instance that cannot acquire the lock does NOT crash — it stays
alive serving /sidecar/health (degraded, no Schwab clients) and retries.  This is what lets
Railway's zero-downtime rolling deploy work: the new instance comes up healthy WITHOUT the lock,
Railway then stops the old instance, the old connection closes (releasing the lock), and the new
instance's retry acquires it.  A fail-fast SystemExit here would deadlock the rollover (the new
instance can never become healthy while the old one still holds the lock).

Connection constraint (RESEARCH Pitfall 2)
------------------------------------------
MUST use the direct DATABASE_URL (port 5432 / session pooler), NOT the PgBouncer transaction-mode
pool URL (port 6543).  The transaction pooler resets session state (including advisory locks) when
it returns a connection to the pool, silently releasing the lock and defeating the guarantee.

Don't hand-roll unlock (§ Don't Hand-Roll)
------------------------------------------
PostgreSQL releases session-level advisory locks automatically when the holding connection is
closed — including on process crash.  Do not add an explicit pg_advisory_unlock call.  The caller
(main.py lifespan) holds the connection open for the process lifetime and closes it on shutdown.
"""

import logging
from typing import Optional

import psycopg2
import psycopg2.extensions

logger = logging.getLogger(__name__)

# ── Lock key ──────────────────────────────────────────────────────────────────
# Stable bigint; one sidecar writer permitted at a time (GW-04).
# Chosen to be unlikely to collide with any application-level advisory locks.
SIDECAR_LOCK_KEY: int = 8876543210


def try_acquire_sidecar_lock(
    direct_db_url: str,
) -> Optional[psycopg2.extensions.connection]:
    """
    Try to acquire the session-level Postgres advisory lock for the sidecar (GW-04).

    Uses pg_try_advisory_lock (non-blocking): if another instance already holds the lock,
    this returns None immediately rather than blocking or crashing.  The caller is expected
    to retry (e.g. during a rolling-deploy rollover) or run as a hot standby until the lock
    frees up.

    Parameters
    ----------
    direct_db_url : str
        Direct Postgres connection URL (port 5432 / session pooler).
        MUST NOT be the PgBouncer transaction-mode URL (port 6543) — the pooler silently
        releases session-level locks between transactions (RESEARCH Pitfall 2).

    Returns
    -------
    psycopg2.extensions.connection | None
        The open connection holding the advisory lock on success — the caller MUST keep this
        reference alive for as long as it wants to hold the lock; the lock is released
        automatically when the connection is closed (graceful shutdown or crash).
        Returns None if the lock is already held by another sidecar instance (the connection
        opened for the probe is closed before returning).
    """
    conn = psycopg2.connect(direct_db_url)
    conn.autocommit = True  # session-level lock requires autocommit (no tx boundary)

    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", (SIDECAR_LOCK_KEY,))
        acquired: bool = cur.fetchone()[0]

    if not acquired:
        conn.close()
        logger.info(
            "sidecar: advisory lock %s held by another instance — not acquired this attempt",
            SIDECAR_LOCK_KEY,
        )
        return None

    logger.info("sidecar: advisory lock %s acquired", SIDECAR_LOCK_KEY)
    return conn  # caller holds reference; lock released on conn.close()
