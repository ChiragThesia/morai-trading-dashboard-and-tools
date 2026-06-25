"""
GET /sidecar/health endpoint tests (GW-01, SC1).

Tests:
  test_health_ok         – with a seeded token_json that is not yet expired,
                           GET /sidecar/health returns 200 {status:'ok', tokenFreshness:'fresh'}.
  test_health_not_seeded – with token_json IS NULL, returns
                           {status:'degraded', tokenFreshness:'not_seeded'} and does not crash.

These tests require the live test DB (via conftest _setup_db session fixture).
The _patch_app_state autouse fixture sets app.state.db_url to the test DB URL.
"""

import pytest
import psycopg2
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

# Shared test DB config (mirrored from conftest for direct SQL access).
import os

_TEST_DB_URL = (
    "postgresql://{user}:{pw}@{host}:{port}/{db}".format(
        user=os.environ.get("TEST_DB_USER", "testuser"),
        pw=os.environ.get("TEST_DB_PASSWORD", "testpw"),
        host=os.environ.get("TEST_DB_HOST", "localhost"),
        port=os.environ.get("TEST_DB_PORT", "5499"),
        db=os.environ.get("TEST_DB_NAME", "testdb"),
    )
)
_ENC_KEY = "test-encryption-key-32-bytes-xx!"
_MARKET_APP_ID = "market"


def _upsert_market_row(token_json_value: object) -> None:
    """
    Insert or update the 'market' row in broker_tokens for health tests.
    Sets token_json to the given value (None → NULL; dict → JSONB).
    expires_at is set 1 hour in the future so tokenFreshness is 'fresh'.
    """
    conn = psycopg2.connect(_TEST_DB_URL)
    try:
        with conn.cursor() as cur:
            if token_json_value is None:
                cur.execute(
                    """
                    INSERT INTO broker_tokens (
                        app_id, access_token, refresh_token,
                        issued_at, refresh_issued_at, expires_at, updated_at,
                        last_refresh_error, token_json
                    ) VALUES (
                        %s,
                        pgp_sym_encrypt('seed-access', %s),
                        pgp_sym_encrypt('seed-refresh', %s),
                        NOW(), NOW() - INTERVAL '1 day',
                        NOW() + INTERVAL '1 hour', NOW(),
                        NULL, NULL
                    )
                    ON CONFLICT (app_id) DO UPDATE SET
                        token_json = NULL,
                        expires_at = NOW() + INTERVAL '1 hour'
                    """,
                    (_MARKET_APP_ID, _ENC_KEY, _ENC_KEY),
                )
            else:
                import json as _json
                cur.execute(
                    """
                    INSERT INTO broker_tokens (
                        app_id, access_token, refresh_token,
                        issued_at, refresh_issued_at, expires_at, updated_at,
                        last_refresh_error, token_json
                    ) VALUES (
                        %s,
                        pgp_sym_encrypt('seed-access', %s),
                        pgp_sym_encrypt('seed-refresh', %s),
                        NOW(), NOW() - INTERVAL '1 day',
                        NOW() + INTERVAL '1 hour', NOW(),
                        NULL, %s
                    )
                    ON CONFLICT (app_id) DO UPDATE SET
                        token_json = %s,
                        expires_at = NOW() + INTERVAL '1 hour'
                    """,
                    (
                        _MARKET_APP_ID, _ENC_KEY, _ENC_KEY,
                        _json.dumps(token_json_value),
                        _json.dumps(token_json_value),
                    ),
                )
        conn.commit()
    finally:
        conn.close()


def test_health_ok() -> None:
    """
    GW-01 / SC1: with a seeded token_json and a future expires_at,
    GET /sidecar/health returns 200 {status:'ok', tokenFreshness:'fresh'}.

    Does not decrypt any token value — only reads expires_at metadata.
    """
    _upsert_market_row(
        {
            "creation_timestamp": 1719340800,
            "token": {
                "access_token": "test-access",
                "refresh_token": "test-refresh",
                "expires_at": 9999999999.0,
                "token_type": "Bearer",
                "scope": "api",
            },
        }
    )

    response = client.get("/sidecar/health")
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert "status" in body, f"Response missing 'status' key: {body!r}"
    assert "tokenFreshness" in body, f"Response missing 'tokenFreshness' key: {body!r}"
    assert body["status"] == "ok", f"Expected status='ok', got {body['status']!r}"
    assert body["tokenFreshness"] == "fresh", (
        f"Expected tokenFreshness='fresh', got {body['tokenFreshness']!r}"
    )


def test_health_not_seeded() -> None:
    """
    GW-01 / Open Question 2: with token_json IS NULL (pre-OAuth dance state),
    GET /sidecar/health returns {status:'degraded', tokenFreshness:'not_seeded'}
    and does NOT crash.  This is the correct first-deploy degrade behaviour.
    """
    _upsert_market_row(None)  # token_json = NULL

    response = client.get("/sidecar/health")
    assert response.status_code == 200, (
        f"Expected 200 even in not-seeded state, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert body.get("status") == "degraded", (
        f"Expected status='degraded', got {body.get('status')!r}"
    )
    assert body.get("tokenFreshness") == "not_seeded", (
        f"Expected tokenFreshness='not_seeded', got {body.get('tokenFreshness')!r}"
    )
