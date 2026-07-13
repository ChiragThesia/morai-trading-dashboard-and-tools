"""
Tests for reauth_admin.py — POST /sidecar/admin/reauth/{start,exchange} (Phase 37 REAUTH-01/02).

TDD: RED tests written first; GREEN only after implementation is in place.

Test strategy:
  - Route handlers called directly with a fake Request (SimpleNamespace app.state carrying
    a fake cfg) — no live lifespan, mirrors test_positions_proxy.py's convention.
  - schwab.auth.get_auth_context / client_from_received_url monkeypatched — no real Schwab
    call, no real network.
  - Nonce persistence + single-use + TTL semantics proven against real Postgres (conftest's
    reauth_nonces table), never mocked (tdd.md).
  - main.reinit_schwab_session monkeypatched with an AsyncMock so exchange tests can assert
    it's called (or not called) without touching real streamer/lock state.
"""
import datetime
import logging
import types
from unittest.mock import AsyncMock, MagicMock

import psycopg2
import schwab.auth


def _make_cfg(db_url: str, **overrides) -> types.SimpleNamespace:
    defaults = dict(
        DATABASE_URL=db_url,
        TOKEN_ENCRYPTION_KEY="test-encryption-key-32-bytes-xx!",
        SIDECAR_ADMIN_TOKEN="test-admin-token-synthetic",
        SCHWAB_WEB_CALLBACK_URL="https://morai.wtf",
        SCHWAB_TRADER_APP_KEY="test-trader-key",
        SCHWAB_TRADER_APP_SECRET="test-trader-secret",
        SCHWAB_MARKET_APP_KEY="test-market-key",
        SCHWAB_MARKET_APP_SECRET="test-market-secret",
    )
    defaults.update(overrides)
    return types.SimpleNamespace(**defaults)


def _make_fake_request(cfg: object) -> MagicMock:
    req = MagicMock()
    req.app.state = types.SimpleNamespace(cfg=cfg)
    return req


class _FakeAuthContext:
    def __init__(self, state: str, authorization_url: str = "https://api.schwabapi.com/authorize?x=1"):
        self.state = state
        self.authorization_url = authorization_url
        self.callback_url = "https://morai.wtf"


def _sample_token(access: str = "test-access", refresh: str = "test-refresh") -> dict:
    expires_at = (
        datetime.datetime.now(tz=datetime.timezone.utc) + datetime.timedelta(minutes=30)
    ).timestamp()
    return {
        "creation_timestamp": 1719340800,
        "token": {
            "access_token": access,
            "refresh_token": refresh,
            "expires_at": expires_at,
            "token_type": "Bearer",
            "scope": "api",
        },
    }


def _upsert_broker_token(db_url: str, app_id: str, key: str, fresh: bool) -> None:
    """Seed a broker_tokens row for app_id with refresh_issued_at fresh or 1-day-stale."""
    conn = psycopg2.connect(db_url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO broker_tokens "
                "(app_id, access_token, refresh_token, issued_at, refresh_issued_at, "
                " expires_at, updated_at, token_json) "
                "VALUES (%s, pgp_sym_encrypt('x', %s), pgp_sym_encrypt('y', %s), now(), "
                "        now() - CASE WHEN %s THEN interval '0 minutes' ELSE interval '1 day' END, "
                "        now() + interval '20 minutes', now(), NULL) "
                "ON CONFLICT (app_id) DO UPDATE SET refresh_issued_at = EXCLUDED.refresh_issued_at",
                (app_id, key, key, fresh),
            )
    finally:
        conn.close()


def _read_refresh_issued_at(db_url: str, app_id: str):
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT refresh_issued_at FROM broker_tokens WHERE app_id = %s", (app_id,))
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


def _insert_nonce(db_url: str, state: str, app_id: str, stale: bool = False) -> None:
    conn = psycopg2.connect(db_url)
    try:
        with conn, conn.cursor() as cur:
            if stale:
                cur.execute(
                    "INSERT INTO reauth_nonces (state, app_id, created_at) "
                    "VALUES (%s, %s, now() - interval '11 minutes')",
                    (state, app_id),
                )
            else:
                cur.execute(
                    "INSERT INTO reauth_nonces (state, app_id) VALUES (%s, %s)",
                    (state, app_id),
                )
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# /start
# ─────────────────────────────────────────────────────────────────────────────


class TestReauthStart:
    async def test_bad_admin_token_returns_401_and_mints_nothing(self, monkeypatch, db_url):
        from reauth_admin import StartBody, reauth_start

        get_ctx = MagicMock()
        monkeypatch.setattr(schwab.auth, "get_auth_context", get_ctx)

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)

        result = await reauth_start(req, StartBody(app="trader"), x_sidecar_admin_token="wrong-token")

        assert result.status_code == 401
        get_ctx.assert_not_called()

    async def test_missing_admin_token_returns_401(self, db_url):
        from reauth_admin import StartBody, reauth_start

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)

        result = await reauth_start(req, StartBody(app="trader"), x_sidecar_admin_token=None)

        assert result.status_code == 401

    async def test_valid_request_mints_authurl_and_persists_nonce(self, monkeypatch, db_url, read_nonce):
        from reauth_admin import StartBody, reauth_start

        monkeypatch.setattr(
            schwab.auth,
            "get_auth_context",
            lambda key, cb, state=None: _FakeAuthContext(state="nonce-abc-123"),
        )

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)

        result = await reauth_start(
            req, StartBody(app="trader"), x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN
        )

        assert result.app == "trader"
        assert result.authUrl == "https://api.schwabapi.com/authorize?x=1"
        assert result.state == "nonce-abc-123"

        row = read_nonce("nonce-abc-123")
        assert row is not None
        app_id, _created_at = row
        assert app_id == "trader"

    async def test_nonce_single_use_and_ttl(self, db_url):
        """
        The persisted nonce round-trips: validate+consume exactly once; a second
        consume of the same state fails; a row older than 10 minutes fails the TTL
        predicate. Exercises the DELETE...RETURNING SQL the /exchange endpoint uses
        (Task 2) directly against the table — Task 1 only wires /start.
        """
        _insert_nonce(db_url, "fresh-state", "trader")
        _insert_nonce(db_url, "stale-state", "market", stale=True)

        def _consume(state: str):
            conn = psycopg2.connect(db_url)
            try:
                with conn, conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM reauth_nonces WHERE state = %s "
                        "AND created_at > now() - interval '10 minutes' RETURNING app_id",
                        (state,),
                    )
                    row = cur.fetchone()
                    return row[0] if row else None
            finally:
                conn.close()

        assert _consume("fresh-state") == "trader"
        assert _consume("fresh-state") is None  # replay-killed
        assert _consume("stale-state") is None  # TTL expired


# ─────────────────────────────────────────────────────────────────────────────
# /exchange
# ─────────────────────────────────────────────────────────────────────────────


class TestReauthExchange:
    async def test_bad_admin_token_returns_401(self, db_url):
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)

        result = await reauth_exchange(
            req,
            ExchangeBody(redirectUrl="https://morai.wtf/?code=x&state=y"),
            x_sidecar_admin_token="wrong",
        )
        assert result.status_code == 401

    async def test_unknown_state_rejected_generically(self, db_url):
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)

        result = await reauth_exchange(
            req,
            ExchangeBody(redirectUrl="https://morai.wtf/?code=x&state=never-existed"),
            x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN,
        )
        assert result.status_code == 400

    async def test_successful_exchange_anchors_refresh_reinits_and_returns_ok_true(
        self, monkeypatch, db_url
    ):
        import main
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)
        state = "exchange-success-state"
        _insert_nonce(db_url, state, "trader")

        monkeypatch.setattr(
            schwab.auth, "get_auth_context", lambda key, cb, state=None: _FakeAuthContext(state=state)
        )
        sample_token = _sample_token()

        def _fake_exchange(key, secret, ctx, received_url, token_write_func, **kwargs):
            token_write_func(sample_token)

        monkeypatch.setattr(schwab.auth, "client_from_received_url", _fake_exchange)

        reinit_mock = AsyncMock(return_value=True)
        monkeypatch.setattr(main, "reinit_schwab_session", reinit_mock)

        result = await reauth_exchange(
            req,
            ExchangeBody(redirectUrl=f"https://morai.wtf/?code=abc&state={state}"),
            x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN,
        )

        assert result.app == "trader"
        assert result.ok is True
        reinit_mock.assert_awaited_once_with(req.app, cfg)

        refresh_issued_at = _read_refresh_issued_at(db_url, "trader")
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        assert now - refresh_issued_at < datetime.timedelta(minutes=5)

    async def test_replay_of_consumed_state_fails(self, monkeypatch, db_url):
        """A second exchange with the SAME state (already consumed by a prior successful
        exchange) is rejected generically — replay-killed (T-37-01)."""
        import main
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)
        state = "replay-state"
        _insert_nonce(db_url, state, "market")

        monkeypatch.setattr(
            schwab.auth, "get_auth_context", lambda key, cb, state=None: _FakeAuthContext(state=state)
        )
        sample_token = _sample_token(access="replay-access", refresh="replay-refresh")
        monkeypatch.setattr(
            schwab.auth,
            "client_from_received_url",
            lambda key, secret, ctx, received_url, token_write_func, **kw: token_write_func(sample_token),
        )
        monkeypatch.setattr(main, "reinit_schwab_session", AsyncMock(return_value=True))

        redirect = f"https://morai.wtf/?code=abc&state={state}"
        first = await reauth_exchange(
            req, ExchangeBody(redirectUrl=redirect), x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN
        )
        assert first.ok is True

        second = await reauth_exchange(
            req, ExchangeBody(redirectUrl=redirect), x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN
        )
        assert second.status_code == 400

    async def test_exchange_exception_returns_ok_false_and_never_logs_code_or_url(
        self, monkeypatch, db_url, caplog
    ):
        """An exchange raise (bad/expired code) -> {app, ok:false}; nonce already consumed;
        no reinit call; the failure log carries only the exception type name (T-37-02)."""
        import main
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)
        state = "raise-state"
        _insert_nonce(db_url, state, "trader")

        monkeypatch.setattr(
            schwab.auth, "get_auth_context", lambda key, cb, state=None: _FakeAuthContext(state=state)
        )

        def _raise(*a, **kw):
            raise RuntimeError("invalid_grant: SENSITIVE-CODE-VALUE-should-never-be-logged")

        monkeypatch.setattr(schwab.auth, "client_from_received_url", _raise)
        reinit_mock = AsyncMock()
        monkeypatch.setattr(main, "reinit_schwab_session", reinit_mock)

        secret_redirect = f"https://morai.wtf/?code=SUPER-SECRET-CODE&state={state}"
        with caplog.at_level(logging.ERROR):
            result = await reauth_exchange(
                req,
                ExchangeBody(redirectUrl=secret_redirect),
                x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN,
            )

        assert result.app == "trader"
        assert result.ok is False
        reinit_mock.assert_not_awaited()

        # Nonce already consumed by the failed attempt — a retry of the same state fails too.
        retry = await reauth_exchange(
            req,
            ExchangeBody(redirectUrl=secret_redirect),
            x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN,
        )
        assert retry.status_code == 400

        for record in caplog.records:
            message = record.getMessage()
            assert "SUPER-SECRET-CODE" not in message
            assert secret_redirect not in message
            assert "invalid_grant" not in message  # str(exc) never logged — type name only

    async def test_ok_false_when_refresh_issued_at_not_freshly_anchored(self, monkeypatch, db_url):
        """
        Defensive freshness re-check: even when the exchange call raises nothing, ok is
        only true when refresh_issued_at was actually anchored fresh moments ago — never
        a bare 'no exception happened' signal (CONTEXT.md: HTTP 200 alone is not success).
        """
        import main
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)
        _upsert_broker_token(db_url, "market", cfg.TOKEN_ENCRYPTION_KEY, fresh=False)
        state = "stale-freshness-state"
        _insert_nonce(db_url, state, "market")

        monkeypatch.setattr(
            schwab.auth, "get_auth_context", lambda key, cb, state=None: _FakeAuthContext(state=state)
        )
        # "Succeeds" (raises nothing) WITHOUT invoking the writer — exercises the
        # defensive gate independent of a genuine schwab-py exchange.
        monkeypatch.setattr(schwab.auth, "client_from_received_url", lambda *a, **kw: None)
        reinit_mock = AsyncMock(return_value=True)
        monkeypatch.setattr(main, "reinit_schwab_session", reinit_mock)

        result = await reauth_exchange(
            req,
            ExchangeBody(redirectUrl=f"https://morai.wtf/?code=abc&state={state}"),
            x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN,
        )

        assert result.app == "market"
        assert result.ok is False
        reinit_mock.assert_awaited_once()  # reinit still runs — only the ok flag is gated

    async def test_partial_failure_isolation_leaves_other_app_untouched(self, monkeypatch, db_url):
        """A failed exchange for one app must not touch the other app's already-fresh
        token (partial-failure isolation, mirrors CLI behavior)."""
        import main
        from reauth_admin import ExchangeBody, reauth_exchange

        cfg = _make_cfg(db_url)
        req = _make_fake_request(cfg)
        _upsert_broker_token(db_url, "market", cfg.TOKEN_ENCRYPTION_KEY, fresh=True)
        market_refresh_before = _read_refresh_issued_at(db_url, "market")

        state = "trader-fail-state"
        _insert_nonce(db_url, state, "trader")

        monkeypatch.setattr(
            schwab.auth, "get_auth_context", lambda key, cb, state=None: _FakeAuthContext(state=state)
        )

        def _raise(*a, **kw):
            raise RuntimeError("bad code")

        monkeypatch.setattr(schwab.auth, "client_from_received_url", _raise)
        monkeypatch.setattr(main, "reinit_schwab_session", AsyncMock())

        result = await reauth_exchange(
            req,
            ExchangeBody(redirectUrl=f"https://morai.wtf/?code=abc&state={state}"),
            x_sidecar_admin_token=cfg.SIDECAR_ADMIN_TOKEN,
        )
        assert result.app == "trader"
        assert result.ok is False

        market_refresh_after = _read_refresh_issued_at(db_url, "market")
        assert market_refresh_after == market_refresh_before
