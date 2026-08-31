"""Tests for the admin-driven account lifecycle (AUTH-01, AUTH-02, AUTH-05,
AUTH-08): create, issue a reset link, and consume a link -- with the audited
read wired into the one legitimate cross-user route.

Eight tests: the plan's own seven named `Test:` bullets, plus one more its
`<behavior>` prose requires in plain words ("A non-existent target returns
404") without naming it as its own `Test:` bullet -- the same kind of
plan-text/`<done>`-count mismatch 02-04's SUMMARY already recorded for its
own five-vs-six count, resolved here by covering everything the plan's prose
actually asks for rather than forcing an arbitrary number.

`@pytest.mark.db` throughout -- every test drives the real ASGI app over
`httpx.ASGITransport` against real Postgres, seeding session rows directly
through the superuser session (there is no login route yet; that's plan
02-06), matching `test_tracer_scoped_read.py`'s established pattern.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import insert, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models_identity import (
    AdminCreateUserResponse,
    AdminResetPasswordResponse,
)
from morai.db.models import AuditLog, Session as SessionRow, User
from morai.identity.passwords import verify_password
from morai.identity.tokens import generate_token, hash_token
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

_CREATE_RESPONSE: TypeAdapter[AdminCreateUserResponse] = TypeAdapter(
    AdminCreateUserResponse
)
_RESET_RESPONSE: TypeAdapter[AdminResetPasswordResponse] = TypeAdapter(
    AdminResetPasswordResponse
)

_NEW_PASSWORD = "correct horse battery staple 2"


async def _seed_session(superuser_db_session: AsyncSession, user_id: UUID) -> str:
    token = generate_token()
    await superuser_db_session.execute(
        insert(SessionRow).values(
            token_hash=hash_token(token),
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(days=30),
        )
    )
    await superuser_db_session.commit()
    return token


@pytest_asyncio.fixture
async def client(clean_identity_tables: None) -> AsyncGenerator[AsyncClient, None]:
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_admin_creates_user_and_setup_sets_the_password_hash(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "brand-new-user"},
        cookies={"morai_session": admin_token},
    )
    assert created.status_code == 200
    created_body = _CREATE_RESPONSE.validate_json(created.content)

    setup = await client.post(
        "/setup",
        json={"token": created_body.setup_token, "password": _NEW_PASSWORD},
    )
    assert setup.status_code == 200

    # Read the hash back through the superuser session -- the admin has no
    # read path to another user's hash (`users` carries no such policy).
    row = (
        await superuser_db_session.execute(
            select(User).where(User.id == created_body.user_id)
        )
    ).scalar_one()
    assert row.password_hash is not None
    assert verify_password(row.password_hash, _NEW_PASSWORD) is True


async def test_consuming_the_same_token_a_second_time_returns_400(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)
    created = await client.post(
        "/admin/users",
        json={"username": "one-time-only"},
        cookies={"morai_session": admin_token},
    )
    created_body = _CREATE_RESPONSE.validate_json(created.content)

    first = await client.post(
        "/setup",
        json={"token": created_body.setup_token, "password": _NEW_PASSWORD},
    )
    second = await client.post(
        "/setup",
        json={"token": created_body.setup_token, "password": "a different password"},
    )

    assert first.status_code == 200
    assert second.status_code == 400


async def test_setup_with_a_short_password_returns_422_and_does_not_consume_the_token(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """`SetupRequest.password` carries `Field(min_length=12)` (WR-01). Pydantic
    validates the request body before the route body ever runs, so `/setup`'s
    `consume_token` call is never reached -- the token must still be usable
    afterwards, which this test proves directly rather than assuming."""
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)
    created = await client.post(
        "/admin/users",
        json={"username": "short-password-user"},
        cookies={"morai_session": admin_token},
    )
    created_body = _CREATE_RESPONSE.validate_json(created.content)

    rejected = await client.post(
        "/setup",
        json={"token": created_body.setup_token, "password": "short"},
    )
    assert rejected.status_code == 422

    retry = await client.post(
        "/setup",
        json={"token": created_body.setup_token, "password": _NEW_PASSWORD},
    )
    assert retry.status_code == 200


async def test_non_admin_calling_either_admin_route_gets_404_not_403(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """D2-08's not-found-not-forbidden posture applied to authorization, not
    only to data -- a 403 confirms the caller reached a real admin route."""
    non_admin_token = await _seed_session(superuser_db_session, seeded_users.user_a)

    create_response = await client.post(
        "/admin/users",
        json={"username": "should-not-be-created"},
        cookies={"morai_session": non_admin_token},
    )
    reset_response = await client.post(
        f"/admin/users/{seeded_users.user_b}/reset-password",
        cookies={"morai_session": non_admin_token},
    )

    assert create_response.status_code == 404
    assert reset_response.status_code == 404


async def test_unauthenticated_call_to_either_admin_route_gets_401(
    client: AsyncClient, seeded_users: SeededUsers
) -> None:
    create_response = await client.post(
        "/admin/users", json={"username": "no-session-at-all"}
    )
    reset_response = await client.post(
        f"/admin/users/{seeded_users.user_a}/reset-password"
    )

    assert create_response.status_code == 401
    assert reset_response.status_code == 401


async def test_reset_password_writes_exactly_one_audit_log_row(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    response = await client.post(
        f"/admin/users/{seeded_users.user_a}/reset-password",
        cookies={"morai_session": admin_token},
    )
    assert response.status_code == 200
    _RESET_RESPONSE.validate_json(response.content)

    # audit_log is INSERT-only under RLS (migration 0003) -- read through the
    # superuser session, which bypasses RLS regardless of FORCE.
    rows = (await superuser_db_session.execute(select(AuditLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].reader_id == seeded_users.admin
    assert rows[0].subject_id == seeded_users.user_a


async def test_reset_password_for_a_nonexistent_user_returns_404(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    response = await client.post(
        f"/admin/users/{uuid4()}/reset-password",
        cookies={"morai_session": admin_token},
    )

    assert response.status_code == 404
    # No audit row for a target that was never actually read.
    rows = (await superuser_db_session.execute(select(AuditLog))).scalars().all()
    assert rows == []


async def test_setup_with_a_password_reset_token_actually_changes_the_password(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """WR-03: every HTTP-level `/setup` test elsewhere in this file uses a
    `SETUP`-purpose token from `POST /admin/users`. `/setup` tries `SETUP`
    first, then falls back to `PASSWORD_RESET` -- this is the fallback
    branch's only end-to-end coverage, driving `POST
    /admin/users/{id}/reset-password` then `POST /setup` with the returned
    `reset_token`. The branch was already correct; this is a regression
    guard, not a bug fix."""
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    reset = await client.post(
        f"/admin/users/{seeded_users.user_a}/reset-password",
        cookies={"morai_session": admin_token},
    )
    assert reset.status_code == 200
    reset_body = _RESET_RESPONSE.validate_json(reset.content)

    setup = await client.post(
        "/setup",
        json={"token": reset_body.reset_token, "password": _NEW_PASSWORD},
    )
    assert setup.status_code == 200

    row = (
        await superuser_db_session.execute(
            select(User).where(User.id == seeded_users.user_a)
        )
    ).scalar_one()
    assert row.password_hash is not None
    assert verify_password(row.password_hash, _NEW_PASSWORD) is True


async def test_password_update_without_rls_context_matches_zero_rows(
    app_db_session: AsyncSession, seeded_users: SeededUsers
) -> None:
    """The silent-write regression (T-02-29): the exact `UPDATE` `/setup`
    performs, run against a fresh session with no `app.current_user_id` set,
    is the mechanism the route's `rowcount == 1` check exists to catch --
    Postgres's RLS policy filters the target row to nothing, and the `UPDATE`
    reports success having touched zero rows. Proves the mechanism directly,
    as a positive assertion on `rowcount`, rather than by editing or
    inspecting the route's own source text.
    """
    result = await app_db_session.execute(
        update(User)
        .where(User.id == seeded_users.user_a)
        .values(password_hash="irrelevant-context-was-never-set")
    )
    assert isinstance(result, CursorResult)
    assert result.rowcount == 0
    await app_db_session.rollback()


async def test_no_raw_token_or_password_in_any_log_record(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
    caplog: pytest.LogCaptureFixture,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    with caplog.at_level(logging.DEBUG):
        created = await client.post(
            "/admin/users",
            json={"username": "leak-check-user"},
            cookies={"morai_session": admin_token},
        )
        created_body = _CREATE_RESPONSE.validate_json(created.content)

        await client.post(
            "/setup",
            json={"token": created_body.setup_token, "password": _NEW_PASSWORD},
        )
        # reused token -- exercises the reject path's logging too
        await client.post(
            "/setup",
            json={"token": created_body.setup_token, "password": _NEW_PASSWORD},
        )

        reset = await client.post(
            f"/admin/users/{seeded_users.user_a}/reset-password",
            cookies={"morai_session": admin_token},
        )
        reset_body = _RESET_RESPONSE.validate_json(reset.content)

    log_text = caplog.text
    assert created_body.setup_token not in log_text
    assert hash_token(created_body.setup_token) not in log_text
    assert reset_body.reset_token not in log_text
    assert hash_token(reset_body.reset_token) not in log_text
    assert _NEW_PASSWORD not in log_text
