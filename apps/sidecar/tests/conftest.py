"""
pytest fixtures for sidecar token-store, advisory-lock, chain-proxy and health tests.

Provides:
  db_url         – connection string for the test Postgres container
  app_id         – the seeded app_id ('test-trader')
  enc_key        – AES encryption key for pgp_sym_encrypt
  mock_market_client_on_app_state (autouse) – patches app.state.market_client with a
                   stub for chain-proxy and health tests so they don't require a live
                   Schwab session or lifespan execution.

Design constraints:
  - Uses a real Postgres via Docker/psycopg2 (no mocks — SQL must be real per tdd.md)
  - Requires pgcrypto extension (CREATE EXTENSION IF NOT EXISTS pgcrypto)
  - Mirrors the broker_tokens schema in packages/adapters/src/postgres/schema.ts exactly
  - No Schwab credentials; token values in tests are synthetic constants (workflow.md)
  - db_url fixture must point to direct connection (port 5432, not 6543 pool — RESEARCH Pitfall 2)
"""

import datetime
import unittest.mock

import pytest
import psycopg2

# ── Test DB configuration ─────────────────────────────────────────────────────
# Override via env vars if needed; defaults match the Docker container started in
# the developer notes (11-04 plan) and CI setup.
import os

TEST_DB_HOST = os.environ.get("TEST_DB_HOST", "localhost")
TEST_DB_PORT = os.environ.get("TEST_DB_PORT", "5499")
TEST_DB_NAME = os.environ.get("TEST_DB_NAME", "testdb")
TEST_DB_USER = os.environ.get("TEST_DB_USER", "testuser")
TEST_DB_PASSWORD = os.environ.get("TEST_DB_PASSWORD", "testpw")

_DB_URL = (
    f"postgresql://{TEST_DB_USER}:{TEST_DB_PASSWORD}"
    f"@{TEST_DB_HOST}:{TEST_DB_PORT}/{TEST_DB_NAME}"
)

# Synthetic constants — never real Schwab values (workflow.md data-discipline rule)
_APP_ID = "test-trader"
_ENC_KEY = "test-encryption-key-32-bytes-xx!"  # 32+ chars; synthetic, never logged


# ── Schema DDL ────────────────────────────────────────────────────────────────
# Mirror of packages/adapters/src/postgres/schema.ts § brokerTokens.
# Access/refresh stored as bytea via pgp_sym_encrypt (pgcrypto extension required).
# token_json JSONB holds the full schwab-py wrapped blob (D-02 / GW-01 additive column).
# refresh_issued_at is set once at row seed and NEVER updated by token_write_func (Phase 4 P02).
_CREATE_TABLE_SQL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS broker_tokens;

CREATE TABLE broker_tokens (
    app_id              TEXT        PRIMARY KEY,
    access_token        BYTEA       NOT NULL,
    refresh_token       BYTEA       NOT NULL,
    issued_at           TIMESTAMPTZ NOT NULL,
    refresh_issued_at   TIMESTAMPTZ NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    last_refresh_error  TEXT,
    token_json          JSONB
);
"""

# Seed row: synthetic encrypted tokens, refresh_issued_at anchored to a fixed past time.
# The seed has an access_token + refresh_token populated so token_write_func can UPDATE.
# token_json starts NULL (not seeded); token_write_func populates it in test_token_round_trip.
_SEED_ROW_SQL = """
INSERT INTO broker_tokens (
    app_id,
    access_token,
    refresh_token,
    issued_at,
    refresh_issued_at,
    expires_at,
    updated_at,
    last_refresh_error,
    token_json
) VALUES (
    %s,
    pgp_sym_encrypt('seed-access-token', %s),
    pgp_sym_encrypt('seed-refresh-token', %s),
    NOW() - INTERVAL '10 minutes',
    NOW() - INTERVAL '1 day',   -- fixed anchor; must survive token_write_func writes
    NOW() + INTERVAL '20 minutes',
    NOW() - INTERVAL '10 minutes',
    NULL,
    NULL
);
"""


@pytest.fixture(scope="session", autouse=True)
def _setup_db() -> None:
    """
    Session-scoped autouse fixture: creates the broker_tokens table (with pgcrypto)
    and seeds one row for _APP_ID.  Runs once before any test in the session.
    """
    conn = psycopg2.connect(_DB_URL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(_CREATE_TABLE_SQL)
            cur.execute(_SEED_ROW_SQL, (_APP_ID, _ENC_KEY, _ENC_KEY))
    finally:
        conn.close()


@pytest.fixture()
def db_url() -> str:
    """Direct DB connection URL (port 5432 equivalent — never pool URL; RESEARCH Pitfall 2)."""
    return _DB_URL


@pytest.fixture()
def app_id() -> str:
    """The seeded app_id for all token-store tests."""
    return _APP_ID


@pytest.fixture()
def enc_key() -> str:
    """Synthetic encryption key bound as a psycopg2 %s parameter — never logged."""
    return _ENC_KEY


# ── Chain-proxy and health test fixtures ──────────────────────────────────────


def _make_mock_chain_response(root: str = "SPX") -> dict:
    """
    Minimal valid Schwab get_option_chain() response shape used by the mock client.
    Mirrors the fields that _map_option_chain_to_response() expects.
    """
    expiry_key = "2026-06-20:30"
    strike = "5950.0"
    return {
        "underlyingPrice": 5950.0,
        "callExpDateMap": {
            expiry_key: {
                strike: [
                    {
                        "symbol": "SPX   260620C05950000",
                        "bid": 12.50,
                        "ask": 13.00,
                        "mark": 12.75,
                        "volatility": 0.18,
                        "delta": 0.45,
                        "gamma": 0.002,
                        "theta": -0.85,
                        "vega": 1.2,
                        "openInterest": 1500,
                        "totalVolume": 320,
                    }
                ]
            }
        },
        "putExpDateMap": {},
    }


@pytest.fixture(autouse=True)
def _patch_app_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Autouse fixture: patch app.state with test stubs so chain-proxy and health
    tests can run without a live lifespan (no DB connection or Schwab session).

    Sets:
      app.state.market_client  – an AsyncMock whose get_option_chain() returns a
                                  response-like object wrapping _make_mock_chain_response().
      app.state.degraded       – False (client is available)
      app.state.db_url         – _DB_URL (so health endpoint can read from the test DB)
      app.state.market_app_id  – "market" (health endpoint app_id)
    """
    try:
        from main import app
    except ImportError:
        # main.py not yet created — skip patching (RED state for chain-proxy tests).
        return

    # Build a mock response object that supports .json() synchronously.
    mock_resp = unittest.mock.MagicMock()
    mock_resp.json.return_value = _make_mock_chain_response()

    # market_client is async (asyncio=True in schwab-py).
    mock_market_client = unittest.mock.AsyncMock()
    mock_market_client.get_option_chain.return_value = mock_resp

    # Use monkeypatch.setattr so pytest registers teardown undo-hooks and state
    # is restored after each test regardless of fixture scope changes (WR-06).
    monkeypatch.setattr(app.state, "market_client", mock_market_client)
    monkeypatch.setattr(app.state, "degraded", False)
    monkeypatch.setattr(app.state, "db_url", _DB_URL)
    monkeypatch.setattr(app.state, "market_app_id", "market")
