"""Migration 0003's central claim, proven from each connection's own point of
view (`02-RESEARCH.md`'s decisive finding, and the Orchestrator Addendum's
matching hazard for CI's own Postgres user).

`@pytest.mark.db` -- runs only where Postgres is reachable (CI's `test-pytest`
job). There is no local database (Docker's daemon is broken here, Railway's
Postgres is private-network-only), so this module cannot run on the authoring
machine at all.
"""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.db

# `Row` (raw `text()` results) types every column as `Any` -- same
# untyped-boundary shape as `api/errors.py`'s `_ErrorLocation`/`_ERROR_LIST`.
# `TypeAdapter` is this project's narrowing at such a boundary (D-06): it
# actually checks the shape at runtime, unlike `cast`, which only asserts it
# to the checker. Indexed access (`row[0]`), not attribute access
# (`row.rolsuper`) -- the latter reads as `Any` at the access point itself,
# before `TypeAdapter` ever sees it, and trips `reportAny` regardless.
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)


async def test_app_connection_reports_is_superuser_off(
    app_db_session: AsyncSession,
) -> None:
    result = await app_db_session.execute(
        text("SELECT current_setting('is_superuser')")
    )
    assert result.scalar_one() == "off"


async def test_app_connection_role_cannot_bypass_rls(
    app_db_session: AsyncSession,
) -> None:
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


async def test_superuser_connection_is_actually_a_superuser(
    superuser_db_session: AsyncSession,
) -> None:
    """Records the literal observation, so "CI's default user is a superuser"
    is a measured fact in the suite rather than an assumption in a comment
    (the Orchestrator Addendum's own hazard)."""
    result = await superuser_db_session.execute(
        text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
    )
    assert result.scalar_one() is True


@pytest.mark.parametrize(
    ("table_name", "expected"),
    [
        ("users", True),
        ("audit_log", True),
        ("gate_user_scoped_probe", True),
        ("sessions", False),
        ("setup_tokens", False),
    ],
)
async def test_rls_enable_and_force_match_the_migration(
    superuser_db_session: AsyncSession, table_name: str, expected: bool
) -> None:
    row = (
        await superuser_db_session.execute(
            text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname = :table_name"
            ),
            {"table_name": table_name},
        )
    ).one()
    assert (
        _BOOL.validate_python(row[0]),
        _BOOL.validate_python(row[1]),
    ) == (expected, expected)


async def test_login_lookup_is_not_executable_by_public(
    app_db_session: AsyncSession,
) -> None:
    """`login_lookup` is `SECURITY DEFINER` and owned by a superuser, so its
    body reads `users` past migration 0003's `self_or_admin` policy. The
    default `PUBLIC` `EXECUTE` grant that `CREATE FUNCTION` attaches would
    hand that read to every role in the database, including ones added later
    for unrelated reasons. Migration 0005 revokes it; this asserts the revoke
    is still in force rather than that it once ran.
    """
    row = (
        await app_db_session.execute(
            text(
                "SELECT has_function_privilege('public', 'login_lookup(text)', "
                "'EXECUTE')"
            )
        )
    ).one()
    assert _BOOL.validate_python(row[0]) is False


async def test_login_lookup_is_still_executable_by_the_app_role(
    app_db_session: AsyncSession,
) -> None:
    """The counterpart to the revoke: narrowing the grant must not have taken
    login with it. Without this, a revoke that removed `morai_app`'s access too
    would still pass the test above.
    """
    row = (
        await app_db_session.execute(
            text(
                "SELECT has_function_privilege('morai_app', "
                "'login_lookup(text)', 'EXECUTE')"
            )
        )
    ).one()
    assert _BOOL.validate_python(row[0]) is True


async def test_app_role_can_insert_but_not_read_or_alter_audit_log(
    app_db_session: AsyncSession,
) -> None:
    """WR-05: migration 0006 narrows `morai_app`'s table-level grant on
    `audit_log` to `INSERT` only, so the "app role can append and cannot
    read its own trail back" guarantee (`identity/audit.py`'s own docstring)
    has an independent floor at the GRANT layer, not only at RLS. Checks the
    grant directly via `has_table_privilege`, the same mechanism the two
    `has_function_privilege` tests above use for the login_lookup grant.
    """
    insertable = (
        await app_db_session.execute(
            text("SELECT has_table_privilege('morai_app', 'audit_log', 'INSERT')")
        )
    ).one()
    selectable = (
        await app_db_session.execute(
            text("SELECT has_table_privilege('morai_app', 'audit_log', 'SELECT')")
        )
    ).one()
    updatable = (
        await app_db_session.execute(
            text("SELECT has_table_privilege('morai_app', 'audit_log', 'UPDATE')")
        )
    ).one()
    deletable = (
        await app_db_session.execute(
            text("SELECT has_table_privilege('morai_app', 'audit_log', 'DELETE')")
        )
    ).one()
    assert _BOOL.validate_python(insertable[0]) is True
    assert _BOOL.validate_python(selectable[0]) is False
    assert _BOOL.validate_python(updatable[0]) is False
    assert _BOOL.validate_python(deletable[0]) is False
