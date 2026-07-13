"""
Tests for main.py's reinit_schwab_session (Phase 37 REAUTH-04) — after a successful
re-auth wizard exchange, cancels+recreates the keepalive/streamer background tasks and
rebuilds both Schwab clients, all WITHOUT ever releasing the Postgres advisory lock
(T-37-05). No-ops (returns False) when this instance is not the lock holder (mid
rolling-deploy rollover).

TDD: RED tests written first (reinit_schwab_session doesn't exist yet); GREEN after
main.py implements it.

Test strategy:
  - Fake app.state via types.SimpleNamespace — no live lifespan, no DB, no Schwab call.
  - Old keepalive_task/streamer_task are REAL asyncio tasks (asyncio.sleep(3600)) so
    cancel+await semantics are genuine, not mocked.
  - main._init_schwab_clients and the two task coroutine factories are monkeypatched so
    no Schwab call ever happens.
"""
import asyncio
import types
from unittest.mock import MagicMock

import main
import streamer


async def _sleeper(app: object) -> None:
    await asyncio.sleep(3600)


def _make_app_state(**kwargs) -> types.SimpleNamespace:
    return types.SimpleNamespace(**kwargs)


async def test_reinit_noop_when_lock_not_held(monkeypatch) -> None:
    """reinit_schwab_session returns False and does nothing when has_lock is False."""
    init_recorder = MagicMock()
    monkeypatch.setattr(main, "_init_schwab_clients", init_recorder)

    old_keepalive = asyncio.create_task(_sleeper(None))
    old_streamer = asyncio.create_task(_sleeper(None))
    lock_conn = MagicMock()
    app = types.SimpleNamespace(
        state=_make_app_state(
            has_lock=False,
            keepalive_task=old_keepalive,
            streamer_task=old_streamer,
            lock_conn=lock_conn,
        )
    )

    result = await main.reinit_schwab_session(app, cfg=object())

    assert result is False
    init_recorder.assert_not_called()
    lock_conn.close.assert_not_called()
    assert app.state.keepalive_task is old_keepalive
    assert app.state.streamer_task is old_streamer
    assert not old_keepalive.done()
    assert not old_streamer.done()

    old_keepalive.cancel()
    old_streamer.cancel()
    for t in (old_keepalive, old_streamer):
        try:
            await t
        except asyncio.CancelledError:
            pass


async def test_reinit_cancels_old_tasks_and_creates_new_ones(monkeypatch) -> None:
    """
    When has_lock is True: old tasks are cancelled+awaited, _init_schwab_clients runs once,
    fresh tasks replace them (different identity), and the advisory lock is never touched.
    """
    init_recorder = MagicMock()
    monkeypatch.setattr(main, "_init_schwab_clients", init_recorder)
    monkeypatch.setattr(main, "_trader_token_keepalive", _sleeper)
    monkeypatch.setattr(streamer, "start_streamer", _sleeper)

    old_keepalive = asyncio.create_task(_sleeper(None))
    old_streamer = asyncio.create_task(_sleeper(None))
    lock_conn = MagicMock()
    app = types.SimpleNamespace(
        state=_make_app_state(
            has_lock=True,
            keepalive_task=old_keepalive,
            streamer_task=old_streamer,
            lock_conn=lock_conn,
        )
    )
    cfg = object()

    result = await main.reinit_schwab_session(app, cfg)

    assert result is True
    init_recorder.assert_called_once_with(app, cfg)

    # Old tasks are cancelled and finished (never left dangling).
    assert old_keepalive.done()
    assert old_streamer.done()

    # New tasks replace them (identity changed) and are still running.
    assert app.state.keepalive_task is not old_keepalive
    assert app.state.streamer_task is not old_streamer
    assert not app.state.keepalive_task.done()
    assert not app.state.streamer_task.done()

    # The advisory lock is never touched by reinit — same objects, never released.
    assert app.state.has_lock is True
    assert app.state.lock_conn is lock_conn
    lock_conn.close.assert_not_called()

    # Cleanup: cancel the freshly created tasks so pytest doesn't warn on teardown.
    app.state.keepalive_task.cancel()
    app.state.streamer_task.cancel()
    for t in (app.state.keepalive_task, app.state.streamer_task):
        try:
            await t
        except asyncio.CancelledError:
            pass
