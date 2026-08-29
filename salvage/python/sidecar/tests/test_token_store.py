"""
RED scaffold — token round-trip contract tests (GW-01).

These tests import from apps/sidecar/token_store.py which does not exist yet.
They MUST fail with ImportError on this commit (TDD red-first).

Expected failure:
    ModuleNotFoundError: No module named 'token_store'

Turn these green in Phase 11 plan 03 when token_store.py is implemented.
"""
import datetime

import pytest

# RED: This import fails until token_store.py is created (11-03).
from token_store import make_token_callbacks, make_reauth_writer  # noqa: F401

# Sample wrapped token blob matching the schwab-py output shape.
# Source: schwab-py auth.py TokenMetadata.wrap_token_in_metadata
# See RESEARCH.md Pattern 1 for full field documentation.
SAMPLE_TOKEN = {
    "creation_timestamp": 1719340800,
    "token": {
        "access_token": "test-access-token-abc123",
        "refresh_token": "test-refresh-token-xyz789",
        "expires_at": 1719342600.0,
        "token_type": "Bearer",
        "scope": "api",
    },
}


def test_token_round_trip(db_url: str, app_id: str, enc_key: str) -> None:
    """
    GW-01: write a sample wrapped blob via token_write_func,
    read back via token_read_func, assert byte-for-byte equal.
    Also asserts the discrete access_token column matches the inner value.

    Requires a live DB row with the given app_id (seeded in conftest).
    """
    token_read_func, token_write_func = make_token_callbacks(db_url, app_id, enc_key)

    token_write_func(SAMPLE_TOKEN)
    result = token_read_func()

    assert result == SAMPLE_TOKEN, (
        f"Round-trip mismatch: wrote {SAMPLE_TOKEN!r}, read back {result!r}"
    )
    # The discrete access_token column must match the inner access_token.
    # (Verified separately by the contract test in 11-03 via a raw DB read.)
    assert result["token"]["access_token"] == SAMPLE_TOKEN["token"]["access_token"]


def test_token_write_accepts_authlib_refresh_kwargs(db_url: str, app_id: str, enc_key: str) -> None:
    """
    On a real token refresh, schwab-py/authlib call the write callback as
    update_token(token, refresh_token=..., access_token=...) — the wrapped writer passes those
    extra args/kwargs straight through (auth.py wrapped_token_write_func). A callback that takes
    only `token` raises TypeError and aborts EVERY refresh (chain + trader). This reproduces the
    prod failure ("trader keep-alive ping failed (TypeError)"); the writer must accept + ignore them.
    """
    token_read_func, token_write_func = make_token_callbacks(db_url, app_id, enc_key)

    # Mirror authlib's refresh-time call signature exactly — must not raise.
    token_write_func(
        SAMPLE_TOKEN,
        refresh_token=SAMPLE_TOKEN["token"]["refresh_token"],
        access_token=SAMPLE_TOKEN["token"]["access_token"],
    )

    assert token_read_func() == SAMPLE_TOKEN


def test_refresh_issued_at_unchanged(db_url: str, app_id: str, enc_key: str) -> None:
    """
    GW-01 / Phase 4 P02 invariant: calling token_write_func MUST NOT update
    refresh_issued_at. The 7-day TTL clock must not be reset on access-token rotation.

    Reads refresh_issued_at before and after a write and asserts they are identical.
    """
    import psycopg2

    token_read_func, token_write_func = make_token_callbacks(db_url, app_id, enc_key)

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT refresh_issued_at FROM broker_tokens WHERE app_id = %s",
                (app_id,),
            )
            row = cur.fetchone()
            assert row is not None, f"No broker_tokens row for app_id={app_id!r}"
            refresh_issued_at_before = row[0]
    finally:
        conn.close()

    token_write_func(SAMPLE_TOKEN)

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT refresh_issued_at FROM broker_tokens WHERE app_id = %s",
                (app_id,),
            )
            row = cur.fetchone()
            assert row is not None
            refresh_issued_at_after = row[0]
    finally:
        conn.close()

    assert refresh_issued_at_before == refresh_issued_at_after, (
        "token_write_func must NOT update refresh_issued_at on access-token rotation "
        f"(before={refresh_issued_at_before!r}, after={refresh_issued_at_after!r})"
    )


def test_make_reauth_writer_anchors_refresh_issued_at(db_url: str, app_id: str, enc_key: str) -> None:
    """
    Phase 37 REAUTH-03: a fresh OAuth dance MUST reset the 7-day TTL clock — in contrast
    to make_token_callbacks' routine writer (test above), which deliberately never touches
    refresh_issued_at. The seed row's refresh_issued_at starts at NOW() - 1 day
    (conftest.py); after make_reauth_writer runs, it must be fresh (within 5 minutes).
    """
    import psycopg2

    writer = make_reauth_writer(db_url, app_id, enc_key)
    writer(SAMPLE_TOKEN)

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT refresh_issued_at, token_json FROM broker_tokens WHERE app_id = %s",
                (app_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    assert row is not None, f"No broker_tokens row for app_id={app_id!r}"
    refresh_issued_at, token_json = row
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    assert now - refresh_issued_at < datetime.timedelta(minutes=5), (
        f"refresh_issued_at not anchored fresh by make_reauth_writer: {refresh_issued_at!r}"
    )
    assert token_json == SAMPLE_TOKEN, (
        f"token_json round-trip mismatch: wrote {SAMPLE_TOKEN!r}, read back {token_json!r}"
    )


def test_make_reauth_writer_wraps_raw_token_dict(db_url: str, app_id: str, enc_key: str) -> None:
    """
    schwab-py may hand the write callback either the wrapped {creation_timestamp, token}
    blob or the raw inner token dict — the reauth writer must tolerate both, wrapping the
    raw shape before writing (token_json must store the wrapped form the sidecar's
    client_from_access_functions expects).
    """
    writer = make_reauth_writer(db_url, app_id, enc_key)
    writer(SAMPLE_TOKEN["token"])  # raw shape — no creation_timestamp/token wrapper

    import psycopg2

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT token_json FROM broker_tokens WHERE app_id = %s", (app_id,))
            row = cur.fetchone()
    finally:
        conn.close()

    assert row is not None, f"No broker_tokens row for app_id={app_id!r}"
    stored = row[0]
    assert stored["token"] == SAMPLE_TOKEN["token"]
    assert "creation_timestamp" in stored
