"""Tests for the one token mechanism shared by setup links and password
resets (AUTH-01, AUTH-02, AUTH-05, `NN-35`).

Six tests, matching `02-05-PLAN.md`'s six named `Test:` bullets exactly. The
plan's own `<done>` block says "seven" -- this is that plan's own off-by-one
(see this plan's SUMMARY for the note), not a seventh behavior named anywhere
in the plan's `<behavior>` list, the same discrepancy 02-04's SUMMARY recorded
for its own five-vs-six count.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import SetupToken
from morai.identity.setup_tokens import TokenPurpose, consume_token, issue_token
from morai.identity.tokens import hash_token
from morai.settings import get_settings
from tests.identity.conftest import SeededUsers

_TTL = timedelta(minutes=30)


@pytest.mark.db
async def test_issued_token_consumes_once_and_returns_the_right_user_id(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    raw = await issue_token(
        app_db_session,
        user_id=seeded_users.user_a,
        purpose=TokenPurpose.SETUP,
        ttl=_TTL,
    )
    await app_db_session.commit()

    result = await consume_token(
        app_db_session, raw_token=raw, purpose=TokenPurpose.SETUP
    )

    assert result == seeded_users.user_a


@pytest.mark.db
async def test_second_consume_returns_none_and_the_row_is_gone(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    """Asserts row absence as well as the `None`, so an implementation that
    flipped a used flag instead of deleting the row would fail here."""
    raw = await issue_token(
        app_db_session,
        user_id=seeded_users.user_a,
        purpose=TokenPurpose.SETUP,
        ttl=_TTL,
    )
    await app_db_session.commit()

    first = await consume_token(
        app_db_session, raw_token=raw, purpose=TokenPurpose.SETUP
    )
    second = await consume_token(
        app_db_session, raw_token=raw, purpose=TokenPurpose.SETUP
    )

    assert first == seeded_users.user_a
    assert second is None
    remaining = (
        (
            await app_db_session.execute(
                select(SetupToken).where(SetupToken.token_hash == hash_token(raw))
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []


@pytest.mark.db
async def test_expired_token_returns_none_and_row_is_left_in_place(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    """An expired-but-never-used token stays distinguishable in the table for
    anyone debugging -- it is left alone, not deleted."""
    raw = await issue_token(
        app_db_session,
        user_id=seeded_users.user_a,
        purpose=TokenPurpose.SETUP,
        ttl=timedelta(seconds=-1),
    )
    await app_db_session.commit()

    result = await consume_token(
        app_db_session, raw_token=raw, purpose=TokenPurpose.SETUP
    )

    assert result is None
    remaining = (
        (
            await app_db_session.execute(
                select(SetupToken).where(SetupToken.token_hash == hash_token(raw))
            )
        )
        .scalars()
        .all()
    )
    assert len(remaining) == 1


@pytest.mark.db
async def test_wrong_purpose_returns_none(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    """Without this, `purpose` is decoration and a reset link would grant
    initial setup, or the reverse."""
    raw = await issue_token(
        app_db_session,
        user_id=seeded_users.user_a,
        purpose=TokenPurpose.SETUP,
        ttl=_TTL,
    )
    await app_db_session.commit()

    result = await consume_token(
        app_db_session, raw_token=raw, purpose=TokenPurpose.PASSWORD_RESET
    )

    assert result is None


@pytest.mark.db
async def test_concurrent_consume_produces_exactly_one_winner(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    """Two independent engines, two independent sessions, `asyncio.gather`.
    Two sessions on one engine would not prove this -- a single connection
    serialises the two statements and the race never happens."""
    raw = await issue_token(
        app_db_session,
        user_id=seeded_users.user_a,
        purpose=TokenPurpose.SETUP,
        ttl=_TTL,
    )
    await app_db_session.commit()

    async def _consume() -> UUID | None:
        engine = create_async_engine(get_settings().app_async_dsn)
        try:
            async with AsyncSession(engine) as session:
                return await consume_token(
                    session, raw_token=raw, purpose=TokenPurpose.SETUP
                )
        finally:
            await engine.dispose()

    results = await asyncio.gather(_consume(), _consume())

    # Asserted on the sorted pair, not on which coroutine won -- which is not
    # deterministic and must not be asserted.
    non_none = [r for r in results if r is not None]
    none_count = sum(1 for r in results if r is None)
    assert non_none == [seeded_users.user_a]
    assert none_count == 1


@pytest.mark.db
async def test_no_raw_token_or_hash_in_any_log_record(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG):
        raw = await issue_token(
            app_db_session,
            user_id=seeded_users.user_a,
            purpose=TokenPurpose.SETUP,
            ttl=_TTL,
        )
        await app_db_session.commit()
        await consume_token(app_db_session, raw_token=raw, purpose=TokenPurpose.SETUP)
        # second call, over the already-consumed token -- exercises the
        # not-found path's logging too, not only the success path's.
        await consume_token(app_db_session, raw_token=raw, purpose=TokenPurpose.SETUP)

    assert raw not in caplog.text
    assert hash_token(raw) not in caplog.text
