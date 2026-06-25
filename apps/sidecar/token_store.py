"""
Token-store callbacks for schwab-py (GW-01 dual-write, D-02).

Public API
----------
make_token_callbacks(db_url, app_id, encryption_key)
    Returns (token_read_func, token_write_func) bound to one broker_tokens row.

Dual-write contract (D-02)
--------------------------
token_write_func writes:
  - token_json        JSONB  – full schwab-py wrapped blob byte-for-byte (round-trip safe)
  - access_token      BYTEA  – pgp_sym_encrypt(inner access token, key) for TS reader (D-01)
  - refresh_token     BYTEA  – pgp_sym_encrypt(inner refresh token, key)
  - issued_at         NOW()  – when the access token was issued
  - expires_at              – decoded from token['token']['expires_at'] unix float
  - updated_at        NOW()

  NEVER updates refresh_issued_at — the 7-day TTL clock is anchored at the initial OAuth
  dance (Phase 4 P02 rule).  Updating it here would reset the clock on every access-token
  rotation (~every 30 min), which would prevent AUTH_EXPIRED from ever firing.

Security constraints (V6 / T-11-04-01, T-11-04-02)
----------------------------------------------------
- encryption_key is ALWAYS passed as a bound %s parameter to pgp_sym_encrypt.
  It is NEVER interpolated into an f-string or format string.
- No token value (access_token, refresh_token) appears in any logging call.
- Logs only app_id and issued_at on write.
"""

import json
import logging
import datetime
from typing import Callable

import psycopg2

logger = logging.getLogger(__name__)


def make_token_callbacks(
    db_url: str,
    app_id: str,
    encryption_key: str,
) -> tuple[Callable[[], dict], Callable[[dict], None]]:
    """
    Return (token_read_func, token_write_func) bound to the given app_id row.

    Parameters
    ----------
    db_url : str
        Direct Postgres connection URL (port 5432).
        MUST NOT be the PgBouncer pool URL (port 6543) — session-level advisory-lock
        requirement; also avoids round-trip overhead for the blocking token write.
    app_id : str
        The broker_tokens primary key ('trader' | 'market' in production).
    encryption_key : str
        AES key for pgp_sym_encrypt.  Passed only as a bound %s parameter — never
        interpolated into SQL or logged.

    Returns
    -------
    token_read_func : () -> dict
        Reads token_json from broker_tokens and returns the schwab-py wrapped blob dict.
        Raises ValueError if the row is absent or token_json is NULL (graceful-degrade
        signal for the lifespan — RESEARCH Open Question 2).
    token_write_func : (dict) -> None
        Writes the full blob to token_json and decomposes access/refresh tokens into the
        encrypted discrete columns.  Never touches refresh_issued_at (Phase 4 P02).
    """

    def token_read_func() -> dict:
        """
        Read the schwab-py token blob from broker_tokens.

        Returns the dict stored in token_json (psycopg2 deserialises JSONB to dict).
        Raises ValueError if no row or token_json is NULL so the caller (lifespan) can
        surface a clear 'not_seeded' degraded state rather than an opaque exception.
        """
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT token_json FROM broker_tokens WHERE app_id = %s",
                    (app_id,),
                )
                row = cur.fetchone()
                if row is None or row[0] is None:
                    raise ValueError(
                        f"No token found for app_id={app_id!r} — "
                        "token_json is NULL or row absent. "
                        "Run the manual OAuth dance to seed the token."
                    )
                return row[0]  # psycopg2 returns JSONB as a Python dict
        finally:
            conn.close()

    def token_write_func(token: dict) -> None:
        """
        Dual-write the schwab-py token blob (GW-01, D-02).

        Writes token_json + decomposes access_token/refresh_token into encrypted discrete
        columns.  Never updates refresh_issued_at (Phase 4 P02).
        Logs only app_id + issued_at — never token values (V6).

        Parameters
        ----------
        token : dict
            The full schwab-py wrapped blob received by the write callback:
            {
                "creation_timestamp": <int>,
                "token": {
                    "access_token": "...",
                    "refresh_token": "...",
                    "expires_at": <unix float>,
                    "token_type": "Bearer",
                    "scope": "...",
                }
            }
        """
        inner = token["token"]
        access_token = inner["access_token"]
        refresh_token = inner["refresh_token"]
        expires_at_dt = datetime.datetime.fromtimestamp(
            inner["expires_at"], tz=datetime.timezone.utc
        )
        now = datetime.datetime.now(tz=datetime.timezone.utc)

        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE broker_tokens SET
                        token_json    = %s,
                        access_token  = pgp_sym_encrypt(%s, %s),
                        refresh_token = pgp_sym_encrypt(%s, %s),
                        issued_at     = %s,
                        expires_at    = %s,
                        updated_at    = %s
                    WHERE app_id = %s
                    """,
                    (
                        json.dumps(token),   # full blob → token_json (JSONB)
                        # access_token and encryption_key as bound params — never interpolated
                        access_token, encryption_key,
                        # refresh_token and encryption_key as bound params
                        refresh_token, encryption_key,
                        now,               # issued_at
                        expires_at_dt,     # expires_at from blob
                        now,               # updated_at
                        app_id,            # WHERE clause
                    ),
                )
            conn.commit()
        finally:
            conn.close()

        # Log only app_id + issued_at — never token values (V6 / T-11-04-01)
        logger.info(
            "token_write_func: wrote token for app_id=%s issued_at=%s",
            app_id,
            now.isoformat(),
        )

    return token_read_func, token_write_func
