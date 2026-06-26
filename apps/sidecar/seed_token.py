"""
One-time OAuth seed for the Schwab sidecar (D-03).

Runs the interactive schwab-py manual OAuth flow for BOTH the trader and market
apps and writes the resulting token into the live `broker_tokens` table:

  - token_json         JSONB  — full schwab-py wrapped blob (the sidecar reads this)
  - access_token       BYTEA  — pgp_sym_encrypt(inner access token, key)  (D-01 TS trader reader)
  - refresh_token      BYTEA  — pgp_sym_encrypt(inner refresh token, key)
  - issued_at / expires_at / updated_at
  - refresh_issued_at  = NOW  — the 7-day TTL anchor, set ONLY here at the initial dance.
                                (token_store.token_write_func intentionally never touches it;
                                 a fresh dance resets the clock — Phase 4 P02 / D-03.)

This mirrors token_store.token_write_func's dual-write contract and adds the
refresh_issued_at anchor + INSERT-or-UPDATE (the row may not exist yet).

WHY a separate script: the sidecar runtime only READS tokens (client_from_access_functions);
it has no OAuth endpoint (lock-only + chain proxy). apps/auth (the old TS OAuth app) was
retired in 11-07. This is the operator bootstrap.

USAGE (run from the repo root so Railway resolves the project link):

    railway run --service worker \\
      apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py

  `railway run --service worker` injects the worker service's env vars (DATABASE_URL,
  TOKEN_ENCRYPTION_KEY, SCHWAB_TRADER/MARKET_APP_KEY/SECRET/CALLBACK_URL) — so no
  secrets are read from .env. The venv supplies schwab-py + psycopg2. The flow is
  interactive: for each app it prints a Schwab auth URL; log in, authorize, then paste
  the FULL redirected URL back at the prompt.

  ORDER: deploy the 11-06 worker cutover (retire refresh-tokens) BEFORE running this,
  so the sidecar becomes the sole token writer (no dual-refresher race).

SECURITY: the temp token file schwab-py writes is deleted in a finally block (tokens
never linger on disk). The encryption key is only ever a bound %s parameter. No token
value is printed.
"""

import datetime
import json
import os
import sys
import tempfile

import psycopg2

try:
    import schwab
except ImportError:
    sys.exit(
        "schwab-py not importable. Run via the sidecar venv:\n"
        "  railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py"
    )


# (app_id, key_env, secret_env, callback_env) — app_id is the broker_tokens PK.
APPS = [
    ("trader", "SCHWAB_TRADER_APP_KEY", "SCHWAB_TRADER_APP_SECRET", "SCHWAB_TRADER_CALLBACK_URL"),
    ("market", "SCHWAB_MARKET_APP_KEY", "SCHWAB_MARKET_APP_SECRET", "SCHWAB_MARKET_CALLBACK_URL"),
]

UPSERT_SQL = """
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


def require_env(names: list[str]) -> dict[str, str]:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        sys.exit(
            "Missing required env vars: "
            + ", ".join(missing)
            + "\nRun via: railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py"
        )
    return {n: os.environ[n] for n in names}


def seed_app(db_url: str, key: str, app_id: str, api_key: str, secret: str, callback: str) -> None:
    """Run the manual OAuth dance for one app and dual-write its token to broker_tokens."""
    with tempfile.NamedTemporaryFile("w+", suffix=f"-{app_id}.json", delete=False) as tf:
        token_path = tf.name
    try:
        print(f"\n{'=' * 64}\n  OAuth dance — {app_id} app  (callback: {callback})\n{'=' * 64}")
        # Interactive: prints the auth URL, then input() for the pasted redirect URL.
        schwab.auth.client_from_manual_flow(api_key, secret, callback, token_path)

        with open(token_path) as f:
            blob = json.load(f)

        inner = blob["token"]
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        expires = datetime.datetime.fromtimestamp(inner["expires_at"], tz=datetime.timezone.utc)

        conn = psycopg2.connect(db_url)
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    UPSERT_SQL,
                    {
                        "app_id": app_id,
                        "token_json": json.dumps(blob),
                        "access": inner["access_token"],
                        "refresh": inner["refresh_token"],
                        "key": key,
                        "now": now,
                        "expires": expires,
                    },
                )
        finally:
            conn.close()
        print(f"[{app_id}] token_json + discrete columns seeded; refresh_issued_at anchored to {now.isoformat()}.")
    finally:
        try:
            os.remove(token_path)  # never leave a token file on disk
        except OSError:
            pass


def main() -> None:
    env = require_env(
        ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY"]
        + [e for _, k, s, c in APPS for e in (k, s, c)]
    )
    db_url = env["DATABASE_URL"]
    key = env["TOKEN_ENCRYPTION_KEY"]

    for app_id, key_env, secret_env, cb_env in APPS:
        seed_app(db_url, key, app_id, env[key_env], env[secret_env], env[cb_env])

    # Verify: token_json NOT NULL for both rows (no token values read).
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT app_id, token_json IS NOT NULL FROM broker_tokens "
                "WHERE app_id IN ('trader', 'market') ORDER BY app_id"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    print("\nVerification (token_json present):")
    for app_id, seeded in rows:
        print(f"  {app_id}: {'seeded' if seeded else 'MISSING'}")
    print("\nDone. Check the sidecar: GET /sidecar/health should now report status=ok, tokenFreshness=fresh.")


if __name__ == "__main__":
    main()
