"""
Postgres advisory lock tests (GW-04).

try_acquire_sidecar_lock is non-blocking and non-fatal:
  - returns None when the lock is already held by another instance (caller retries —
    this is what lets a Railway rolling-deploy rollover succeed; a fail-fast SystemExit
    would deadlock it);
  - returns the open connection when the lock is free (caller holds it; closing releases).
"""
import psycopg2

from advisory_lock import try_acquire_sidecar_lock, SIDECAR_LOCK_KEY


def test_second_instance_returns_none(db_url: str) -> None:
    """
    GW-04: when the advisory-lock key is already held (simulated via a setup connection),
    try_acquire_sidecar_lock returns None — it does NOT crash. The caller is expected to
    retry until the holder releases.
    """
    # Hold the lock on a separate connection to simulate a running sidecar instance.
    setup_conn = psycopg2.connect(db_url)
    setup_conn.autocommit = True
    with setup_conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (SIDECAR_LOCK_KEY,))

    try:
        result = try_acquire_sidecar_lock(db_url)
        assert result is None, (
            "try_acquire_sidecar_lock must return None when the lock is already held"
        )
    finally:
        # Release the setup lock so subsequent tests are clean.
        with setup_conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (SIDECAR_LOCK_KEY,))
        setup_conn.close()


def test_first_instance_acquires(db_url: str) -> None:
    """
    GW-04: with no prior lock held, try_acquire_sidecar_lock returns an open psycopg2
    connection (the lock holder). Closing it releases the lock, so a subsequent acquire
    succeeds.
    """
    conn = try_acquire_sidecar_lock(db_url)
    try:
        assert conn is not None, "try_acquire_sidecar_lock must return a connection when free"
        assert not conn.closed, "returned connection must be open (lock is held)"
    finally:
        conn.close()  # releases the advisory lock

    # After close, the lock is released — confirm by re-acquiring successfully.
    conn2 = try_acquire_sidecar_lock(db_url)
    assert conn2 is not None, "lock should be re-acquirable after the holder closed its conn"
    conn2.close()
