"""
Tests for stream_proxy.py — GET /sidecar/events (Task 1) and
POST /sidecar/subscribe ad-hoc activation (Task 4).

TDD: RED tests written first; GREEN only after implementation is in place.

Test strategy:
  - Route handlers called directly (async tests) with fake Request objects so
    the generator behaviour can be driven without a live stream or real DB.
  - event_queue cleared per-test via autouse fixture.
  - Timeout path tested via monkeypatching _SSE_IDLE_TIMEOUT.
  - Task 3 TestClient checks are appended here (route-mount assertions).
"""
import asyncio
import json
import types
from unittest.mock import AsyncMock, MagicMock

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────


def _make_app_state(**kwargs) -> types.SimpleNamespace:
    """SimpleNamespace so getattr() works correctly (not MagicMock dynamic attrs)."""
    return types.SimpleNamespace(**kwargs)


def _make_fake_request(disconnect_after_n: int = 1, **state_kwargs) -> MagicMock:
    """
    Fake FastAPI Request with an awaitable is_disconnected().

    disconnect_after_n=0 → first call returns True (immediate disconnect).
    disconnect_after_n=1 → first call False, second call True (one iteration).
    disconnect_after_n=N → first N calls False, then True.
    """
    call_count = 0

    async def _is_disconnected() -> bool:
        nonlocal call_count
        call_count += 1
        return call_count > disconnect_after_n

    req = MagicMock()
    req.is_disconnected = _is_disconnected
    req.app.state = _make_app_state(**state_kwargs)
    return req


async def _collect_chunks(response, max_chunks: int = 5) -> list[str]:
    """Drain body_iterator up to max_chunks; breaks after that to avoid hanging."""
    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
        if len(chunks) >= max_chunks:
            break
    return chunks


@pytest.fixture(autouse=True)
def _clear_event_queue():
    """Drain event_queue before (and after) each test to prevent test bleed."""
    from streamer import event_queue

    def _drain():
        while True:
            try:
                event_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    _drain()
    yield
    _drain()


# ─────────────────────────────────────────────────────────────────────────────
# Task 1: GET /sidecar/events — SSE generator behaviour
# ─────────────────────────────────────────────────────────────────────────────


class TestStreamEvents:
    """GET /sidecar/events — drains event_queue with ping keep-alive."""

    async def test_seeded_event_drains_as_data_block(self):
        """A pre-seeded event in event_queue appears as 'data: {json}\\n\\n'."""
        from stream_proxy import stream_events
        from streamer import event_queue

        payload = {
            "type": "level_one_option",
            "ts": "2026-06-28T12:00:00.000Z",
            "occSymbol": "SPX   260620C05000000",
        }
        event_queue.put_nowait(payload)

        # disconnect_after_n=1: first is_disconnected()=False → yield event;
        # second call would be True but we break after max_chunks=1.
        req = _make_fake_request(disconnect_after_n=1)
        response = await stream_events(req)

        chunks = await _collect_chunks(response, max_chunks=1)
        assert len(chunks) == 1, f"Expected 1 chunk, got {len(chunks)}: {chunks!r}"
        assert chunks[0].startswith("data: "), f"Chunk must start with 'data: ': {chunks[0]!r}"
        assert chunks[0].endswith("\n\n"), f"Chunk must end with '\\n\\n': {chunks[0]!r}"

        body = json.loads(chunks[0][len("data: ") :].strip())
        assert body["type"] == "level_one_option"
        assert body["occSymbol"] == "SPX   260620C05000000"

    async def test_idle_timeout_yields_ping(self, monkeypatch):
        """When the queue is idle and the timeout fires, 'event: ping\\ndata: \\n\\n' is yielded."""
        import stream_proxy
        from streamer import event_queue  # noqa: F401 — ensure it's imported for clarity

        # Use a tiny timeout so the test doesn't block for 25 real seconds.
        monkeypatch.setattr(stream_proxy, "_SSE_IDLE_TIMEOUT", 0.02)

        # Queue is empty (cleared by autouse fixture); timeout fires immediately.
        req = _make_fake_request(disconnect_after_n=1)
        response = await stream_proxy.stream_events(req)

        chunks = await _collect_chunks(response, max_chunks=1)
        assert len(chunks) == 1, f"Expected 1 ping chunk, got {len(chunks)}: {chunks!r}"
        assert chunks[0] == "event: ping\ndata: \n\n", (
            f"Expected SSE keep-alive format, got: {chunks[0]!r}"
        )

    async def test_disconnected_request_stops_generator_immediately(self):
        """When is_disconnected() returns True on the first call, no chunks are yielded."""
        from stream_proxy import stream_events

        req = _make_fake_request(disconnect_after_n=0)  # immediately disconnected
        response = await stream_events(req)

        chunks = await _collect_chunks(response, max_chunks=5)
        assert chunks == [], f"Expected no chunks from disconnected request, got: {chunks!r}"

    async def test_response_media_type_is_event_stream(self):
        """StreamingResponse must carry media_type='text/event-stream'."""
        from stream_proxy import stream_events

        req = _make_fake_request(disconnect_after_n=0)
        response = await stream_events(req)
        assert response.media_type == "text/event-stream"


# ─────────────────────────────────────────────────────────────────────────────
# Task 3: TestClient route-mount assertions (GET /sidecar/events not 404)
# These tests pass once main.py includes the new routers (Task 3).
# ─────────────────────────────────────────────────────────────────────────────


class TestRoutesMounted:
    """Verify /sidecar/events, /sidecar/positions, and /sidecar/subscribe are mounted (not 404).

    Uses the no-lifespan test harness: TestClient(app) without the 'with' context so the
    lifespan (which needs real env vars) is not triggered.  This matches the pattern used
    by test_chain_proxy.py.
    """

    def test_events_route_registered_in_app(self):
        """GET /sidecar/events must be resolvable via FastAPI's URL path table."""
        from main import app

        # url_path_for raises NoMatchFound if the route isn't registered.
        url = app.url_path_for("stream_events")
        assert str(url) == "/sidecar/events", (
            f"Expected /sidecar/events, got {url!r}"
        )

    def test_positions_route_returns_503_not_404(self):
        """GET /sidecar/positions returns 503 AUTH_EXPIRED (trader_client absent) — not 404."""
        from fastapi.testclient import TestClient
        from main import app

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/sidecar/positions")
        assert resp.status_code != 404, (
            "GET /sidecar/positions returned 404 — route not mounted"
        )
        assert resp.status_code == 503, (
            f"Expected 503 AUTH_EXPIRED (no trader_client), got {resp.status_code}"
        )

    def test_subscribe_route_mounted(self):
        """POST /sidecar/subscribe resolves (not 404); body validation triggers 422."""
        from fastapi.testclient import TestClient
        from main import app

        client = TestClient(app, raise_server_exceptions=False)
        # Malformed body → 422 (not 404) means the route is registered.
        resp = client.post("/sidecar/subscribe", json={"symbol": "INVALID"})
        assert resp.status_code != 404, "POST /sidecar/subscribe returned 404 — route not mounted"
        # Expect 422 (OCC validation fails) or 503 (stream not active) — both confirm routing.
        assert resp.status_code in (422, 503), (
            f"Expected 422 or 503 for malformed/inactive subscribe, got {resp.status_code}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Task 4: POST /sidecar/subscribe — ad-hoc activation
# ─────────────────────────────────────────────────────────────────────────────


def _make_mock_stream_client() -> AsyncMock:
    """
    Mock StreamClient with awaitable level_one_option_add / level_one_option_unsubs.
    level_one_option_subs is also mocked so tests can assert it is NOT called (Pitfall 11).
    """
    sc = AsyncMock()
    sc.level_one_option_add = AsyncMock(return_value=None)
    sc.level_one_option_unsubs = AsyncMock(return_value=None)
    sc.level_one_option_subs = AsyncMock(return_value=None)  # must NOT be called
    return sc


class TestSubscribeRoute:
    """POST /sidecar/subscribe — OCC validation, 503 guard, level_one_option_add path."""

    async def test_valid_symbol_returns_200_and_calls_add(self):
        """
        Valid OCC symbol with an active stream → 200 {subscribed, evicted}
        and level_one_option_add is called; level_one_option_subs is NOT called (Pitfall 11).
        """
        from stream_proxy import subscribe
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        mock_sc = _make_mock_stream_client()

        req = _make_fake_request(
            stream_client=mock_sc,
            subscription_manager=sm,
            trader_client=MagicMock(),
        )

        symbol = "SPX   260620C05000000"
        body = MagicMock()
        body.symbol = symbol

        result = await subscribe(request=req, body=body)
        assert result.status_code == 200

        data = json.loads(result.body)
        assert data["subscribed"] == symbol
        assert data["evicted"] == []

        # level_one_option_add must be called; subs must NOT (Pitfall 11)
        mock_sc.level_one_option_add.assert_awaited_once_with([symbol])
        mock_sc.level_one_option_subs.assert_not_called()

    async def test_stream_not_active_returns_503(self):
        """When stream_client is absent (not yet streaming), returns 503 AUTH_EXPIRED."""
        from stream_proxy import subscribe

        req = _make_fake_request(
            stream_client=None,
            subscription_manager=None,
            trader_client=MagicMock(),
        )

        body = MagicMock()
        body.symbol = "SPX   260620C05000000"

        result = await subscribe(request=req, body=body)
        assert result.status_code == 503
        data = json.loads(result.body)
        assert data == {"error": "AUTH_EXPIRED"}

    async def test_malformed_symbol_returns_422(self):
        """
        A symbol that doesn't match the OCC format raises a 422 via Pydantic validation.
        Tested via the Pydantic model directly (FastAPI converts ValidationError to 422).
        """
        from stream_proxy import SubscribeRequest
        import pydantic

        with pytest.raises(pydantic.ValidationError) as exc_info:
            SubscribeRequest(symbol="INVALID")

        errors = exc_info.value.errors()
        assert any(e["loc"] == ("symbol",) for e in errors), (
            f"Expected validation error on 'symbol' field, got: {errors!r}"
        )

    async def test_already_subscribed_returns_200_no_add_churn(self):
        """
        A symbol already in the subscription set → 200 with evicted=[] and
        level_one_option_add is NOT called (no-op per SubscriptionManager).
        """
        from stream_proxy import subscribe
        from streamer import SubscriptionManager

        sm = SubscriptionManager()
        symbol = "SPX   260620C05000000"
        sm.request_ad_hoc(symbol)  # pre-subscribe it

        mock_sc = _make_mock_stream_client()
        req = _make_fake_request(
            stream_client=mock_sc,
            subscription_manager=sm,
            trader_client=MagicMock(),
        )

        body = MagicMock()
        body.symbol = symbol

        result = await subscribe(request=req, body=body)
        assert result.status_code == 200

        data = json.loads(result.body)
        assert data["subscribed"] == symbol
        assert data["evicted"] == []

        # No subscription churn — add must NOT be called
        mock_sc.level_one_option_add.assert_not_called()
        mock_sc.level_one_option_subs.assert_not_called()
