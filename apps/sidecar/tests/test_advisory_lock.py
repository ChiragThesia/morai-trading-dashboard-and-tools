"""
RED scaffold — Postgres advisory lock tests (GW-04).

These tests import from apps/sidecar/advisory_lock.py which does not exist yet.
They MUST fail with ImportError on this commit (TDD red-first).

Expected failure:
    ModuleNotFoundError: No module named 'advisory_lock'

Turn these green in Phase 11 plan 04 when advisory_lock.py is implemented.
"""
import pytest

# RED: This import fails until advisory_lock.py is created (11-04).
from advisory_lock import acquire_sidecar_lock, SIDECAR_LOCK_KEY  # noqa: F401


def test_second_instance_fails(db_url: str) -> None:
    """
    GW-04: When the advisory lock key is already held (simulated via a setup connection),
    acquire_sidecar_lock must raise SystemExit and log a message containing
    "another sidecar instance is running".

    The setup connection holds pg_advisory_lock (blocking version) before calling the SUT.
    The SUT tries pg_try_advisory_lock (non-blocking) and must fail immediately.
    """
    import psycopg2
    import logging

    # Hold the lock on a separate connection to simulate a running sidecar instance.
    setup_conn = psycopg2.connect(db_url)
    setup_conn.autocommit = True
    with setup_conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (SIDECAR_LOCK_KEY,))

    try:
        with pytest.raises(SystemExit) as exc_info:
            acquire_sidecar_lock(db_url)

        assert exc_info.value.code == 1, (
            "SystemExit code must be 1 when lock acquisition fails"
        )
    finally:
        # Release the setup lock so subsequent tests are clean.
        with setup_conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (SIDECAR_LOCK_KEY,))
        setup_conn.close()


def test_first_instance_acquires(db_url: str) -> None:
    """
    GW-04: With no prior lock held, acquire_sidecar_lock must return an open
    psycopg2 connection (the lock holder). Closing it releases the lock.
    """
    import psycopg2

    conn = acquire_sidecar_lock(db_url)
    try:
        assert conn is not None, "acquire_sidecar_lock must return an open connection"
        assert not conn.closed, "Returned connection must be open (lock is held)"
    finally:
        conn.close()  # releases the advisory lock

    # After close, the lock is released — confirm by re-acquiring successfully.
    conn2 = acquire_sidecar_lock(db_url)
    conn2.close()
