"""Phase 2's equivalent of Phase 1's thirteen-fixture oracle (`02-CONTEXT.md`
`<specifics>`). Every zero-rows claim this file makes is bracketed by a
privilege precondition on its own connection and by a superuser positive
control running byte-identical SQL -- without both, "zero rows" only proves
the table was reachable, not that a policy fired.

`@pytest.mark.db` -- runs only where Postgres is reachable (CI's
`test-pytest` job). There is no local database (Docker's daemon is broken
here, Railway's Postgres is private-network-only).

Fixtures (`app_db_session`, `superuser_db_session`, `seeded_users`,
`clean_identity_tables`) live in `tests/identity/conftest.py`, one directory
below this file, so pytest's normal conftest-scoping does not reach them.
`pytest_plugins = ["tests.identity.conftest"]` was tried first and rejected
(Rule 1, measured): pytest already auto-loads that file as a directory
conftest for everything under `tests/identity/`, and registering the same
module a second time under a dotted name raises `ValueError: Plugin already
registered under a different name` the moment both are collected in one
session. Importing the fixture *functions* directly avoids the double
registration -- pytest resolves a fixture by name from the requesting
module's own namespace, so an imported `@pytest.fixture` object works
exactly like a locally-defined one.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import insert, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.routes_identity import UserScopedProbeResponse
from morai.db.models import GateUserScopedProbe
from tests.identity.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    seeded_users,
    superuser_db_session,
)

from tests.identity.test_tracer_scoped_read import (
    _seed_session,  # pyright: ignore[reportPrivateUsage]  # why: reusing plan 02-01's own cookie/auth helper, not reinventing it -- the leading underscore is a test-internal convention, not a real access boundary between two files in the same suite
    client,
)

# Re-exported, not merely imported: these names are never referenced by an
# expression in this module -- pytest finds them by name lookup in this
# module's namespace when resolving a same-named fixture parameter. `__all__`
# tells both ruff (F401) and basedpyright (reportUnusedImport) that the
# import is the point, without a per-line noqa.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_identity_tables",
    "client",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db


# `Row` (raw `text()` results) types every column as `Any` -- same
# untyped-boundary shape `tests/identity/test_app_role.py` already
# established. `TypeAdapter` narrows at that boundary (D-06); indexed access
# (`row[0]`), never attribute access, matching that file's own convention.
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)
_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)
_STR: TypeAdapter[str] = TypeAdapter(str)
_OPTIONAL_STR: TypeAdapter[str | None] = TypeAdapter(str | None)

# Shared by both arms of the positive control (the app-role arm and the
# superuser arm) -- one module-level constant so the two queries cannot drift
# apart. No `WHERE user_id = ...` anywhere: the absence is the test.
_CROSS_TENANT_SELECT = text("SELECT id, user_id FROM gate_user_scoped_probe")

# Task 2's HTTP arm parses the listing route's response the same way
# `tests/identity/test_tracer_scoped_read.py` does -- reused, not reinvented.
_PROBE_LIST: TypeAdapter[list[UserScopedProbeResponse]] = TypeAdapter(
    list[UserScopedProbeResponse]
)


async def _set_current_user(
    session: AsyncSession, user_id: UUID, *, is_admin: bool = False
) -> None:
    """`set_config`, not `SET LOCAL ... :uid` -- Postgres's `SET` grammar only
    accepts a literal there, never a bind parameter (`identity/sessions.py`'s
    module docstring, measured in CI during plan 02-01).

    `is_admin` mirrors `identity/sessions.py::get_current_user`'s own
    behavior: `app.is_admin` is set to `'true'` only when the caller is an
    admin, and left unset otherwise -- never explicitly set to `'false'`."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    if is_admin:
        await session.execute(text("SELECT set_config('app.is_admin', 'true', true)"))


async def test_the_test_connection_cannot_bypass_rls(
    app_db_session: AsyncSession,
) -> None:
    """Every other assertion in this file is meaningless if this one fails.

    Named first, on purpose: if the connection making a zero-rows claim can
    itself bypass RLS (superuser or `BYPASSRLS`), every "zero rows" result
    below would mean nothing -- it would be measuring an inert policy and
    reporting it as a working one. CI's own Postgres user (`morai`,
    `POSTGRES_USER`-created) is a superuser by the official image's own
    documentation, which is exactly the hazard this test exists to catch
    before it can hide behind an application-filter false green.
    """
    row = (
        await app_db_session.execute(
            text(
                "SELECT rolsuper, rolbypassrls FROM pg_roles "
                "WHERE rolname = current_user"
            )
        )
    ).one()
    assert (_BOOL.validate_python(row[0]), _BOOL.validate_python(row[1])) == (
        False,
        False,
    )
    result = await app_db_session.execute(
        text("SELECT current_setting('is_superuser')")
    )
    assert _STR.validate_python(result.scalar_one()) == "off"


async def test_raw_cross_tenant_select_as_app_role_returns_only_the_context_user_rows(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """No `WHERE` clause anywhere in `_CROSS_TENANT_SELECT` -- routing through
    a repository would re-introduce the application filter this test exists
    to look past. Raw SQL through `sa.text`, not the ORM."""
    await _set_current_user(app_db_session, seeded_users.user_a)
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows, "expected at least user A's own seeded row"
    ids = {_UUID.validate_python(row[0]) for row in rows}
    owners = {_UUID.validate_python(row[1]) for row in rows}
    assert owners == {seeded_users.user_a}
    assert seeded_users.probe_b not in ids


async def test_the_identical_select_as_superuser_returns_every_seeded_row(
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The positive control. If this test ever fails, the previous test's
    green is worthless -- it proves the previous test measured a policy and
    not an empty table, a misspelled relation, or a seed fixture that
    quietly did nothing. Same `_CROSS_TENANT_SELECT` constant, same `SET
    LOCAL`-equivalent context; only the connecting role differs."""
    await _set_current_user(superuser_db_session, seeded_users.user_a)
    rows = (await superuser_db_session.execute(_CROSS_TENANT_SELECT)).all()
    ids = {_UUID.validate_python(row[0]) for row in rows}
    assert {seeded_users.probe_a, seeded_users.probe_b} <= ids


async def test_unset_context_returns_zero_rows(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """Confirms the policy fails closed by construction (research Assumption
    A5: `user_id = NULL` is NULL, not TRUE, so an unset context excludes
    every row). Paired with an assertion that the setting really is unset,
    so this test says *why* it got zero rows rather than only that it did."""
    setting = _OPTIONAL_STR.validate_python(
        (
            await app_db_session.execute(
                text("SELECT current_setting('app.current_user_id', true)")
            )
        ).scalar_one()
    )
    assert setting is None
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows == []


async def test_context_set_to_a_user_with_no_rows_returns_zero_rows(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """A third seeded user (the admin, who owns no `gate_user_scoped_probe`
    row) who owns no rows. Distinguishes "the policy excluded rows" from
    "the context is broken and always excludes everything", which the
    previous two tests together otherwise leave open."""
    await _set_current_user(app_db_session, seeded_users.admin)
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows == []


async def test_a_write_for_another_user_is_rejected_by_the_policy(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The `WITH CHECK` half of the policy has its own test; a `USING`-only
    policy would let a user plant rows in another user's namespace, and this
    is the only thing that catches that."""
    await _set_current_user(app_db_session, seeded_users.user_a)
    with pytest.raises(DBAPIError):
        await app_db_session.execute(
            insert(GateUserScopedProbe).values(
                user_id=seeded_users.user_b, note="planted by A"
            )
        )


# --- Task 2: admin is not exempt, and the HTTP surface says not-found rather
# than forbidden (D2-08). Its own named tests, not a parameter on the tests
# above -- the admin case is the one a reasonable developer would assume is
# an exception (02-CONTEXT.md D2-08 and `<specifics>`).


async def test_admin_is_not_exempt_from_the_probe_table_policy(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The case most likely to be wrong: the admin genuinely does need
    cross-user reach on `users` for AUTH-01/AUTH-05, so the instinct is to
    grant it everywhere. `gate_user_scoped_probe` carries no admin clause
    (migration 0003) -- doing so here would make Phase 3's whole encryption
    boundary decorative (D2-08, 02-RESEARCH.md Pitfall 4). Context set exactly
    as the real auth dependency produces it for an admin: both
    `app.current_user_id` and `app.is_admin`."""
    await _set_current_user(app_db_session, seeded_users.admin, is_admin=True)
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows == []


async def test_admin_can_read_another_users_account_row(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The deliberate counterpart. Proves the `users` policy's admin clause
    is real and that the previous test's zero rows is a policy difference --
    not a broken `app.is_admin` context. Two tables, two policies, opposite
    results, same connection, same context."""
    await _set_current_user(app_db_session, seeded_users.admin, is_admin=True)
    row = (
        await app_db_session.execute(
            text("SELECT id, username FROM users WHERE id = :user_id"),
            {"user_id": str(seeded_users.user_a)},
        )
    ).one_or_none()
    assert row is not None
    assert _UUID.validate_python(row[0]) == seeded_users.user_a


async def test_admin_gets_404_for_another_users_probe_row_over_http(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The HTTP arm. An admin session cookie asking for another user's probe
    row gets not-found, not forbidden (D2-08) -- the detail route has no
    admin path."""
    token = await _seed_session(superuser_db_session, seeded_users.admin)
    response = await client.get(
        f"/gate/user-scoped-probe/{seeded_users.probe_b}",
        cookies={"morai_session": token},
    )
    assert response.status_code == 404


async def test_the_two_404_bodies_are_byte_identical(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """A 403, or a differing body, confirms the row exists -- the disclosure
    D2-08 forbids. `response.content` compared directly, not parsed JSON: a
    difference in key order or whitespace is still a difference an attacker
    can measure. Headers compared too, excluding only `X-Request-Id`
    (per-request by design)."""
    token = await _seed_session(superuser_db_session, seeded_users.admin)
    another_users_row = await client.get(
        f"/gate/user-scoped-probe/{seeded_users.probe_b}",
        cookies={"morai_session": token},
    )
    truly_absent_row = await client.get(
        f"/gate/user-scoped-probe/{uuid4()}",
        cookies={"morai_session": token},
    )
    assert another_users_row.status_code == 404
    assert truly_absent_row.status_code == 404
    assert another_users_row.content == truly_absent_row.content
    headers_a = {
        key.lower(): value
        for key, value in another_users_row.headers.items()
        if key.lower() != "x-request-id"
    }
    headers_b = {
        key.lower(): value
        for key, value in truly_absent_row.headers.items()
        if key.lower() != "x-request-id"
    }
    assert headers_a == headers_b


async def test_admin_probe_listing_returns_only_the_admins_own_rows(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The listing route, like the detail route, has no admin path. The admin
    owns no `gate_user_scoped_probe` row (`SeededUsers`), so the only correct
    response is an empty list -- never A's or B's rows."""
    token = await _seed_session(superuser_db_session, seeded_users.admin)
    response = await client.get(
        "/gate/user-scoped-probe", cookies={"morai_session": token}
    )
    assert response.status_code == 200
    rows = _PROBE_LIST.validate_json(response.content)
    assert rows == []
