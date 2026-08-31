"""Tests for the bootstrap script that creates the first admin account
(AUTH-01, T-02-32) -- without which nobody can log in at all.

`main(username: str) -> int` is called directly, not through a subprocess:
a subprocess test would need the test database's environment plumbed
through a child process and would prove less than calling the same
coroutine this module's own `if __name__ == "__main__":` block calls.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SetupToken, User
from morai.identity.setup_tokens import TokenPurpose, consume_token
from tools.create_admin import main

pytestmark = pytest.mark.db


async def test_creates_exactly_one_admin_and_a_consumable_setup_token(
    superuser_db_session: AsyncSession, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = await main("first-admin")

    assert exit_code == 0
    printed_token = capsys.readouterr().out.strip()
    assert printed_token

    admins = (
        (
            await superuser_db_session.execute(
                select(User).where(User.is_admin.is_(True))
            )
        )
        .scalars()
        .all()
    )
    assert len(admins) == 1
    assert admins[0].username == "first-admin"
    # Read before `consume_token`'s own commit: `superuser_db_session` is a
    # plain `AsyncSession` with the default `expire_on_commit=True` (see
    # `tests/identity/conftest.py`), so an ORM attribute read after a commit
    # re-triggers a lazy-refresh query outside an awaited context and raises
    # `MissingGreenlet` -- the identical trap 02-04's SUMMARY already
    # recorded, a test-file mistake, not a claim about production code.
    admin_id = admins[0].id

    tokens = (await superuser_db_session.execute(select(SetupToken))).scalars().all()
    assert len(tokens) == 1

    consumed_user_id = await consume_token(
        superuser_db_session, raw_token=printed_token, purpose=TokenPurpose.SETUP
    )
    assert consumed_user_id == admin_id


async def test_running_a_second_time_exits_nonzero_and_creates_nothing(
    superuser_db_session: AsyncSession,
) -> None:
    first_exit_code = await main("first-admin")
    assert first_exit_code == 0

    second_exit_code = await main("second-admin")
    assert second_exit_code != 0

    admins = (
        (
            await superuser_db_session.execute(
                select(User).where(User.is_admin.is_(True))
            )
        )
        .scalars()
        .all()
    )
    assert len(admins) == 1
    assert admins[0].username == "first-admin"
