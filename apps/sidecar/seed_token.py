"""
One-time OAuth seed for the Schwab sidecar (D-03) — split into two non-interactive steps
so an operator (or an agent) can drive it without a blocking input() prompt:

  Step A  `python seed_token.py authurl`
      Prints the Schwab authorization URL for BOTH apps (trader, market). No input,
      no DB write.

  --- you open each URL, log into Schwab, authorize, and copy the FULL redirected URL ---

  Step B  `python seed_token.py exchange "<trader_redirect_url>" "<market_redirect_url>"`
      Reconstructs each app's auth context (state taken from the pasted redirect URL),
      exchanges the redirect URL for
      tokens via schwab-py, and dual-writes the result into the live `broker_tokens` row:
        - token_json        JSONB  — full schwab-py wrapped blob (the sidecar reads this)
        - access_token      BYTEA  — pgp_sym_encrypt(inner access token, key)  (D-01 TS reader)
        - refresh_token     BYTEA  — pgp_sym_encrypt(inner refresh token, key)
        - issued_at / expires_at / updated_at
        - refresh_issued_at = NOW  — the 7-day TTL anchor, set ONLY at the initial dance
                                     (token_store.token_write_func never touches it; a fresh
                                      dance resets the clock — Phase 4 P02 / D-03).

USAGE (run from the repo root so Railway resolves the project link; `railway run --service
worker` injects the worker's env — DB + both apps' keys/secrets/callbacks — so no secret is
read from .env):

    railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py authurl
    # ...log in, copy both redirect URLs...
    railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py \\
        exchange "<trader_redirect_url>" "<market_redirect_url>"

ORDER: deploy the 11-06 worker cutover (retire refresh-tokens) BEFORE this, so the sidecar is
the sole token writer (no dual-refresher race). After exchange, restart the sidecar
(`railway redeploy --service sidecar -y`) so it re-inits its Schwab clients and /sidecar/chain
goes live. This restarts the existing deployment image only — no rebuild.

SECURITY: nothing is persisted between steps (step B takes the OAuth `state` from the pasted
redirect URL). No token value is printed. The encryption key is only ever a bound %s parameter.
"""

import datetime
import json
import os
import sys
import tempfile
import time
import urllib.parse

import psycopg2

try:
    import schwab
except ImportError:
    sys.exit(
        "schwab-py not importable. Run via the sidecar venv:\n"
        "  railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py <authurl|exchange ...>"
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
            "Missing required env vars: " + ", ".join(missing)
            + "\nRun via: railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py ..."
        )
    return {n: os.environ[n] for n in names}


def step_authurl() -> None:
    """Print the Schwab authorization URL for each app. Nothing is persisted —
    step B takes the OAuth `state` from the pasted redirect URL."""
    env = require_env([k for _, k, _, _ in APPS] + [c for _, _, _, c in APPS])
    print("\nOpen each URL below, log into Schwab, authorize, then copy the FULL redirected URL.\n")
    for app_id, key_env, _secret_env, cb_env in APPS:
        ctx = schwab.auth.get_auth_context(env[key_env], env[cb_env])
        print(f"--- {app_id} app -------------------------------------------------------")
        print(ctx.authorization_url)
        print()
    print(
        "\nNext, re-run with the two redirect URLs in trader,market order:\n"
        '  railway run --service worker apps/sidecar/.venv/bin/python apps/sidecar/seed_token.py '
        'exchange "<trader_redirect_url>" "<market_redirect_url>"'
    )


def _make_seed_writer(db_url: str, key: str, app_id: str):
    """Return a schwab-py write callback that UPSERTs the wrapped token blob + anchors TTL.

    Tolerant of either shape schwab-py may hand the callback: the wrapped
    {creation_timestamp, token:{...}} blob, or the raw token dict. token_json stores the
    WRAPPED form (the sidecar's client_from_access_functions expects creation_timestamp).
    """
    def write(blob: dict, *_args, **_kwargs) -> None:
        if "token" in blob and isinstance(blob["token"], dict):
            wrapped = blob
        else:
            wrapped = {"creation_timestamp": int(time.time()), "token": blob}
        inner = wrapped["token"]
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        expires = datetime.datetime.fromtimestamp(inner["expires_at"], tz=datetime.timezone.utc)
        conn = psycopg2.connect(db_url)
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    UPSERT_SQL,
                    {
                        "app_id": app_id,
                        "token_json": json.dumps(wrapped),
                        "access": inner["access_token"],
                        "refresh": inner["refresh_token"],
                        "key": key,
                        "now": now,
                        "expires": expires,
                    },
                )
        finally:
            conn.close()
        print(f"[{app_id}] token_json + discrete columns written; refresh_issued_at anchored to {now.isoformat()}.")
    return write


def step_exchange(trader_url: str, market_url: str) -> None:
    """Exchange each redirect URL for tokens and dual-write to broker_tokens."""
    env = require_env(
        ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY"]
        + [e for _, k, s, c in APPS for e in (k, s, c)]
    )
    db_url, key = env["DATABASE_URL"], env["TOKEN_ENCRYPTION_KEY"]

    received = {"trader": trader_url, "market": market_url}
    failures = []
    for app_id, key_env, secret_env, cb_env in APPS:
        url = received[app_id]
        # Use the state embedded in the redirect URL (operator tool — the pasted redirect is
        # the trusted input; this also tolerates a trader/market URL mix-up). Schwab then
        # validates the code against this app's client_id, so a wrong-app code fails loudly.
        state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("state", [None])[0]
        try:
            ctx = schwab.auth.get_auth_context(env[key_env], env[cb_env], state=state)
            schwab.auth.client_from_received_url(
                env[key_env], env[secret_env], ctx, url,
                _make_seed_writer(db_url, key, app_id),
            )
        except Exception as exc:  # noqa: BLE001 — report per-app, keep going
            failures.append(app_id)
            print(f"[{app_id}] EXCHANGE FAILED: {type(exc).__name__}: {exc}")

    _verify_and_finish(db_url, failures)


def step_login() -> None:
    """
    One-shot local-server login (RECOMMENDED — run in your own terminal).

    schwab-py opens your browser and runs a temporary HTTPS server on the 127.0.0.1:8182
    callback that auto-catches the redirect and exchanges the code immediately — no copy-paste,
    no 30s expiry race. Does both apps in sequence (trader, then market). Requires a browser on
    this machine (so it can't run in a headless agent shell — run it yourself).
    """
    env = require_env(
        ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY"]
        + [e for _, k, s, c in APPS for e in (k, s, c)]
    )
    db_url, key = env["DATABASE_URL"], env["TOKEN_ENCRYPTION_KEY"]

    for app_id, key_env, secret_env, cb_env in APPS:
        with tempfile.NamedTemporaryFile("w+", suffix=f"-{app_id}.json", delete=False) as tf:
            token_path = tf.name
        try:
            print(f"\n{'=' * 64}\n  {app_id} app — opening browser; log into Schwab + authorize\n{'=' * 64}")
            schwab.auth.client_from_login_flow(
                env[key_env], env[secret_env], env[cb_env], token_path,
                token_write_func=_make_seed_writer(db_url, key, app_id),
                interactive=False,  # auto-open browser, no input() prompt (runnable headlessly)
                callback_timeout=float(os.environ.get("SEED_CALLBACK_TIMEOUT", "600")),
            )
        finally:
            try:
                os.remove(token_path)  # never leave a token file on disk
            except OSError:
                pass

    _verify_and_finish(db_url)


def _verify_and_finish(db_url: str, failures: list[str] | None = None) -> None:
    # Freshness check, not mere presence: on a re-auth the STALE row from the previous
    # seed still has token_json, so `IS NOT NULL` would report "seeded" even when every
    # exchange failed. A row only counts if THIS run anchored refresh_issued_at.
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT app_id, refresh_issued_at > now() - interval '5 minutes' "
                "FROM broker_tokens "
                "WHERE app_id IN ('trader', 'market') ORDER BY app_id"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    print("\nVerification (refresh_issued_at anchored within the last 5 minutes):")
    for app_id, fresh in rows:
        print(f"  {app_id}: {'seeded' if fresh else 'STALE — not written by this run'}")
    if failures:
        sys.exit(
            "\nExchange FAILED for: " + ", ".join(failures)
            + " — do NOT restart the sidecar; re-run authurl/exchange for the failed app(s)."
        )
    print(
        "\nDone. Now restart the sidecar so it re-inits its Schwab clients and\n"
        "/sidecar/chain goes live (restarts the existing image, no rebuild):\n"
        "  railway redeploy --service sidecar -y"
    )


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "login":
        step_login()
    elif mode == "authurl":
        step_authurl()
    elif mode == "exchange":
        if len(sys.argv) != 4:
            sys.exit('Usage: seed_token.py exchange "<trader_redirect_url>" "<market_redirect_url>"')
        step_exchange(sys.argv[2], sys.argv[3])
    else:
        sys.exit(
            "Usage:\n"
            "  seed_token.py login                                          # recommended (browser auto-capture)\n"
            "  seed_token.py authurl                                        # print auth URLs (agent two-step)\n"
            '  seed_token.py exchange "<trader_redirect_url>" "<market_redirect_url>"'
        )


if __name__ == "__main__":
    main()
