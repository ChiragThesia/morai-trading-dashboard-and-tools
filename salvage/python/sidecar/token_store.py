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
import time
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

    def token_write_func(token: dict, *args: object, **kwargs: object) -> None:
        """
        Dual-write the schwab-py token blob (GW-01, D-02).

        Writes token_json + decomposes access_token/refresh_token into encrypted discrete
        columns.  Never updates refresh_issued_at (Phase 4 P02).
        Logs only app_id + issued_at — never token values (V6).

        On a real refresh, schwab-py/authlib invoke this as
        ``update_token(token, refresh_token=..., access_token=...)`` (auth.py
        wrapped_token_write_func passes its *args/**kwargs straight through). We extract
        everything we need from ``token`` itself, so the extra positional/keyword args are
        accepted and ignored — but they MUST be in the signature or every refresh raises
        TypeError and aborts (chain + trader token rotation alike).

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
                if cur.rowcount == 0:
                    raise ValueError(
                        f"token_write_func: no broker_tokens row for app_id={app_id!r} — "
                        "row absent. Cannot write token. Run schema migration or seed the row."
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


# UPSERT shape lifted from seed_token.py's `_make_seed_writer` (same 8-column write,
# one anchoring writer instead of a hand-copy) — anchors refresh_issued_at on every call,
# unlike token_write_func above which deliberately never touches it.
_REAUTH_UPSERT_SQL = """
    INSERT INTO broker_tokens
        (app_id, token_json, access_token, refresh_token,
         issued_at, refresh_issued_at, expires_at, updated_at)
    VALUES
        (%(app_id)s, %(token_json)s,
         pgp_sym_encrypt(%(access)s, %(key)s),
         pgp_sym_encrypt(%(refresh)s, %(key)s),
         %(now)s, %(now)s, %(expires)s, %(now)s)
    ON CONFLICT (app_id) DO UPDATE SET
        token_json        = EXCLUDED.token_json,
        access_token      = EXCLUDED.access_token,
        refresh_token     = EXCLUDED.refresh_token,
        issued_at         = EXCLUDED.issued_at,
        refresh_issued_at = EXCLUDED.refresh_issued_at,
        expires_at        = EXCLUDED.expires_at,
        updated_at        = EXCLUDED.updated_at
"""


def make_reauth_writer(db_url: str, app_id: str, encryption_key: str) -> Callable[[dict], None]:
    """
    Return a schwab-py write callback for the in-app re-auth wizard (Phase 37, REAUTH-03).

    Unlike token_write_func above (which deliberately never touches refresh_issued_at, to
    protect the 7-day TTL from routine access-token rotation), this writer ANCHORS
    refresh_issued_at = now() on every call — a fresh OAuth dance must reset the 7-day
    clock, or the wizard's own freshness gate (refresh_issued_at within 5 minutes) never
    passes.

    Tolerates both shapes schwab-py may hand the callback: the wrapped
    {creation_timestamp, token:{...}} blob, or the raw token dict (wrapped here before
    writing — token_json stores the wrapped form client_from_access_functions expects).

    Security: encryption_key and token values are passed ONLY as bound %s params (never
    an f-string). Logs only app_id + issued_at, never a token value (V6).
    """

    def write(blob: dict, *_args: object, **_kwargs: object) -> None:
        if "token" in blob and isinstance(blob["token"], dict):
            wrapped = blob
        else:
            wrapped = {"creation_timestamp": int(time.time()), "token": blob}
        inner = wrapped["token"]
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        expires_at_dt = datetime.datetime.fromtimestamp(
            inner["expires_at"], tz=datetime.timezone.utc
        )

        conn = psycopg2.connect(db_url)
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    _REAUTH_UPSERT_SQL,
                    {
                        "app_id": app_id,
                        "token_json": json.dumps(wrapped),
                        "access": inner["access_token"],
                        "refresh": inner["refresh_token"],
                        "key": encryption_key,
                        "now": now,
                        "expires": expires_at_dt,
                    },
                )
        finally:
            conn.close()

        # Log only app_id + issued_at — never token values (V6 / T-37-02)
        logger.info(
            "make_reauth_writer: wrote token for app_id=%s refresh_issued_at anchored to %s",
            app_id,
            now.isoformat(),
        )

    return write
