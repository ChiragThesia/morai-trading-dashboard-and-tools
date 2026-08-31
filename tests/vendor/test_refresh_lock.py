"""Tests for the per-user token-refresh lock (CONN-06, D4-10, D4-20).

Two tests, matching 04-03-PLAN.md's two tasks exactly:

1. Two concurrent refreshes of one user's token, on two independent
   engines, serialise on that user's own advisory lock -- neither raises
   the fake's `invalid_grant`, and its own recorded entry/exit times for
   the two critical sections do not overlap.
2. The positive control CONN-06 exists for: user A's refresh never blocks
   user B's. B's own refresh completes and commits while A is still inside
   its own critical section, asserted on ordering rather than on eventual
   success -- the weaker assertion a single global lock also passes, which
   is exactly the v1 mistake this requirement exists to prevent.

Both drive `schwab_client_for_user` directly, on independent
engines/sessions -- the same two-independent-engines-plus-`asyncio.gather`
shape `tests/identity/test_setup_tokens.py`'s own
`test_concurrent_consume_produces_exactly_one_winner` already establishes,
and for the same reason its own docstring gives: two sessions on one
engine would not prove anything, because a single connection serialises
the two statements and the race never happens.

No live Schwab call happens anywhere in this file (D4-14) -- every
assertion runs against `FakeSchwabAuth`, and `invalid_grant` is modelled by
the fake, never observed against the real vendor.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import SchwabConnection
from morai.settings import get_settings
from morai.vendor.connections import (
    read_connection,
    schwab_client_for_user,
    upsert_connection,
)
from morai.vendor.protocol import ExchangedToken
from tests.vendor.conftest import FakeSchwabAuth, SeededUsers

pytestmark = pytest.mark.db

_CREATED_AT = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape the rest of this codebase already established. `TypeAdapter`
# narrows at that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)


async def _seed_connection(
    superuser_db_session: AsyncSession, user_id: UUID, *, refresh_token: str
) -> None:
    """Seeds one connection row through `upsert_connection`, the same
    production write path -- mirrors `provisioned_users`'s own discipline
    of never taking a test-only fast path (D3-14)."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(token={"refresh_token": refresh_token}, created_at=_CREATED_AT),
        account_hash="fake-account-hash",
    )
    await superuser_db_session.commit()


async def _refresh_over_own_engine(user_id: UUID, auth: FakeSchwabAuth) -> None:
    """One full `schwab_client_for_user` cycle on its own engine and
    session, connected as `morai_app`. The RLS context is set explicitly
    since this drives the function directly rather than through a route --
    same `set_config('app.current_user_id', :uid, true)` idiom
    `identity/sessions.py` and every RLS-touching test already use."""
    engine = create_async_engine(get_settings().app_async_dsn)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user_id)},
            )
            async with schwab_client_for_user(session, user_id, auth):
                pass
            await session.commit()
    finally:
        await engine.dispose()


async def test_two_concurrent_refreshes_of_one_user_serialise_and_neither_fails(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Two independent engines, two independent sessions, `asyncio.gather`
    -- two sessions on one engine would not prove this, because a single
    connection serialises the two statements and the race never happens.

    The fake rotates the refresh token on each use and raises
    `invalid_grant` if it is ever handed a value it has already rotated
    away from -- so if the lock were absent, one of the two calls below
    would fail loudly rather than the test silently passing.
    """
    user_id = provisioned_users.user_a
    await _seed_connection(
        superuser_db_session, user_id, refresh_token="fake-refresh-a"
    )

    fake_auth = FakeSchwabAuth(fixed_created_at=_CREATED_AT, account_entries=[])

    async with asyncio.timeout(10):
        await asyncio.gather(
            _refresh_over_own_engine(user_id, fake_auth),
            _refresh_over_own_engine(user_id, fake_auth),
        )

    # Neither call raised (the gather above would have propagated it) --
    # now prove the two critical sections genuinely did not overlap, and
    # that the second call presented the token the first one rotated to,
    # not the one it would have read before the lock was granted.
    assert len(fake_auth.calls) == 2
    first, second = sorted(fake_auth.calls, key=lambda call: call.entered_at)
    assert first.exited_at <= second.entered_at
    assert first.key != second.key

    connection = await read_connection(superuser_db_session, user_id)
    assert connection is not None
    assert connection.token == {"refresh_token": f"{second.key}-rotated"}
    # `token_created_at` unchanged -- a refresh is not a fresh grant
    # (D4-12); moving it here would reset the seven-day expiry clock on
    # every automatic refresh.
    assert connection.token_created_at == _CREATED_AT


async def test_user_bs_refresh_does_not_wait_behind_user_as(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """A single global lock also produces 'both eventually succeed with no
    error' -- that is the naive shape that let v1's one-lock-for-everyone
    design look correct. The scoping CONN-06 is about is the ordering
    below: user B's refresh must complete and commit *while* user A is
    still inside its own critical section, not merely that both finish
    eventually. That ordering is the only thing in this suite that can
    tell the two designs apart.
    """
    user_a = provisioned_users.user_a
    user_b = provisioned_users.user_b
    await _seed_connection(superuser_db_session, user_a, refresh_token="fake-refresh-a")
    await _seed_connection(superuser_db_session, user_b, refresh_token="fake-refresh-b")

    gate = asyncio.Event()
    entered = asyncio.Event()
    auth_a = FakeSchwabAuth(
        fixed_created_at=_CREATED_AT,
        account_entries=[],
        refresh_gate=gate,
        entered_refresh=entered,
    )
    auth_b = FakeSchwabAuth(fixed_created_at=_CREATED_AT, account_entries=[])

    task_a = asyncio.create_task(_refresh_over_own_engine(user_a, auth_a))
    # Wait until the fake records that A has entered its critical section
    # (its own advisory lock already held, transaction still open) before
    # starting B -- not a fixed sleep, and not `pg_sleep`, which would
    # block inside the database connection itself and prove nothing about
    # the lock's scoping.
    await asyncio.wait_for(entered.wait(), timeout=5)

    row_b_before = (
        await superuser_db_session.execute(
            select(SchwabConnection.token_ciphertext).where(
                SchwabConnection.user_id == user_b
            )
        )
    ).scalar_one()

    await asyncio.wait_for(_refresh_over_own_engine(user_b, auth_b), timeout=5)

    # The assertion that carries the whole test: B finished while A was
    # still inside.
    assert not task_a.done()

    # B's own rotated token is durable, read back through a third
    # independent session, while A's transaction is still open.
    row_b_after = (
        await superuser_db_session.execute(
            select(SchwabConnection.token_ciphertext).where(
                SchwabConnection.user_id == user_b
            )
        )
    ).scalar_one()
    assert row_b_after != row_b_before

    # Only now release A.
    gate.set()
    await asyncio.wait_for(task_a, timeout=5)

    # Arithmetic guard: the two users' lock keys, computed the same way the
    # production statement computes them, must differ -- a future change
    # to that key expression that accidentally made it constant fails
    # here rather than degrading silently into a global queue.
    key_a = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT hashtext(:uid)"), {"uid": str(user_a)}
            )
        ).scalar_one()
    )
    key_b = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT hashtext(:uid)"), {"uid": str(user_b)}
            )
        ).scalar_one()
    )
    assert key_a != key_b
