"""Tests for the audited-read capability (AUTH-08, D2-11, D2-12).

Five tests cover the five distinct behaviors this plan names: the commit case, the
rollback case (D2-12), the capability actually unlocking the RLS-gated admin read,
the forged-capability runtime guard, and that the capability's `repr` carries no
token value. Naming five here rather than six against the plan's own "six named
tests" wording in its `<done>` block -- the plan's `<behavior>` list names five
distinct `Test:` bullets, and each is covered exactly once below; see this plan's
SUMMARY for the discrepancy note.

Four of the five need `app_db_session`/`superuser_db_session`/`seeded_users` from
`tests/identity/conftest.py` and run only where Postgres is reachable (CI). Only the
forged-capability test needs no database -- constructing an `AuditedRead` by hand and
observing it raise is a pure-Python assertion. The repr test reads a *genuine*
capability from `open_audited_read()` rather than reaching for the module's private
`_FACTORY_SENTINEL` directly, which is both the honest way to get a valid instance and
what keeps basedpyright's `reportPrivateUsage` from firing on this test file.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import AuditLog
from morai.identity.audit import AuditedRead, get_user_for_management, open_audited_read
from tests.identity.conftest import SeededUsers


@pytest.mark.db
async def test_open_audited_read_commit_writes_one_row_naming_reader_subject_and_time(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    before = datetime.now(UTC)
    await open_audited_read(
        app_db_session, reader_id=seeded_users.admin, subject_id=seeded_users.user_a
    )
    await app_db_session.commit()
    after = datetime.now(UTC)

    # `audit_log` carries an INSERT-only RLS policy and no SELECT policy (migration
    # 0003) -- the app role cannot read its own audit trail back. Verification reads
    # through the superuser session, which is what migration 0003's own docstring
    # says superusers always bypass regardless of FORCE ROW LEVEL SECURITY.
    rows = (await superuser_db_session.execute(select(AuditLog))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.reader_id == seeded_users.admin
    assert row.subject_id == seeded_users.user_a
    assert before <= row.created_at <= after


@pytest.mark.db
async def test_open_audited_read_rollback_leaves_zero_rows(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """D2-12's real assertion: the audit row and the read share one fate. An
    implementation that opened its own transaction for the INSERT would still
    leave a row here, after the caller's own transaction rolled back -- that is
    exactly the failure this test exists to catch.
    """
    await open_audited_read(
        app_db_session, reader_id=seeded_users.admin, subject_id=seeded_users.user_a
    )
    await app_db_session.rollback()

    rows = (await superuser_db_session.execute(select(AuditLog))).scalars().all()
    assert rows == []


@pytest.mark.db
async def test_get_user_for_management_returns_subject_row_for_admin_reader(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """Requires `app.is_admin` set, since the `users` table's `self_or_admin`
    policy is what makes the cross-user read visible at all -- this proves the
    capability and the policy agree, rather than the capability quietly
    returning `None` because the row was invisible to begin with.
    """
    await app_db_session.execute(
        text("SELECT set_config('app.is_admin', 'true', true)")
    )
    proof = await open_audited_read(
        app_db_session, reader_id=seeded_users.admin, subject_id=seeded_users.user_a
    )

    subject = await get_user_for_management(app_db_session, proof)
    await app_db_session.commit()

    assert subject is not None
    assert subject.id == seeded_users.user_a
    assert subject.username == "user-a"


def test_constructing_auditedread_directly_raises_runtime_error() -> None:
    """The runtime guard for the forged case -- D2-11's honest ceiling. A type
    checker verifies shapes, not which function produced a value, so a forged
    `AuditedRead` has the right shape and is caught here instead, at the call
    site, not by basedpyright or mypy.
    """
    with pytest.raises(RuntimeError, match="AUTH-08"):
        AuditedRead(reader_id=uuid4(), subject_id=uuid4(), _token=object())


@pytest.mark.db
async def test_repr_excludes_token_value(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    """`_token` never appears in `repr()`. This test prints nothing containing a
    user id or a token itself (`NN-34`) -- the only thing checked is the string
    `repr()` produces, never logged or printed.
    """
    proof = await open_audited_read(
        app_db_session, reader_id=seeded_users.admin, subject_id=seeded_users.user_a
    )
    await app_db_session.rollback()
    assert "_token" not in repr(proof)
