"""The one boot gate and the one named error RLS's design imposes.

Two functions, one exception, deliberately no more. Machinery that tried to
enforce `require_rls_context` globally -- a session subclass, a decorator, a
metaclass -- would need to know which tables carry policies, would be wrong
the first time a table is added, and would be debugged at 3am. These are
called explicitly by the code that needs them.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `tests/test_isolation.py` and `tests/identity/test_app_role.py`
# already established. `TypeAdapter` narrows at that boundary (D-06).
_STR: TypeAdapter[str] = TypeAdapter(str)
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)
_OPTIONAL_STR: TypeAdapter[str | None] = TypeAdapter(str | None)


class RlsContextMissing(RuntimeError):
    """Raised by `require_rls_context` when `app.current_user_id` is unset."""


async def assert_connection_cannot_bypass_rls(session: AsyncSession) -> None:
    """Raises `RuntimeError` if the connection's own role is `rolsuper` or
    `rolbypassrls` -- either flag makes every RLS policy in the system inert
    for this connection, silently.

    The message names the observed role and both flags, and nothing else --
    no DSN, no host, no password (`NN-34`). The role name is not a secret;
    the connection string is.
    """
    row = (
        await session.execute(
            text(
                "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles "
                "WHERE rolname = current_user"
            )
        )
    ).one()
    role = _STR.validate_python(row[0])
    rolsuper = _BOOL.validate_python(row[1])
    rolbypassrls = _BOOL.validate_python(row[2])
    if rolsuper or rolbypassrls:
        raise RuntimeError(
            f"Refusing to start: connection role {role!r} can bypass row-level "
            f"security (rolsuper={rolsuper}, rolbypassrls={rolbypassrls}). "
            "Every RLS policy in this system would be inert for this "
            "connection. Check DATABASE_URL / MORAI_APP_DB_PASSWORD and the "
            "engine get_db_session uses."
        )


async def require_rls_context(session: AsyncSession) -> UUID:
    """Reads `app.current_user_id` and raises `RlsContextMissing` if it is
    unset, returning the UUID otherwise.

    What this buys: called at the top of a function that touches an
    RLS-protected table outside a request (no auth dependency has run), a
    zero-row result afterwards means "no rows" rather than "you forgot the
    context". What it does not do: it does not detect a context set to the
    *wrong* user, and it does not fire for code that never calls it. That is
    the honest ceiling -- the cheap half of the mitigation for RLS's one real
    cost, silent under-fetching, not a general solution to it.
    """
    setting = _OPTIONAL_STR.validate_python(
        (
            await session.execute(
                text("SELECT current_setting('app.current_user_id', true)")
            )
        ).scalar_one()
    )
    if setting is None:
        raise RlsContextMissing(
            "app.current_user_id is not set on this session. A read against "
            "an RLS-protected table here would silently return fewer rows "
            "than expected, with no indication why. Call get_current_user "
            "(or set the context directly) before touching a protected table "
            "outside a request."
        )
    return UUID(setting)
