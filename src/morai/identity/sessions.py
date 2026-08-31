"""The auth dependency and the `SET LOCAL` wiring that makes RLS evaluate for
a request (`02-RESEARCH.md` Pattern 2).

`get_current_user` reads the `morai_session` cookie, looks up the `sessions`
row unscoped (that table carries no RLS policy -- possession of the opaque
token IS the authorization, and this lookup is the very thing that
establishes the identity an RLS context is set from), then issues
`SET LOCAL app.current_user_id` on the same `AsyncSession` the route handler
will receive via FastAPI's per-request dependency caching. A route depending
on `Depends(get_db_session)` gets the identical session `get_current_user`
already set the context on -- no second wiring needed per route.

**Known gap, not an omission:** if a future route calls `session.commit()`
mid-handler and then issues another query against an RLS-protected table on
the *same* session, that query runs in a fresh transaction (SQLAlchemy 2.0's
autobegin) that never received `SET LOCAL` -- the setting does not carry
across a commit. No route in this phase's scope commits mid-handler, so the
fix is documented here rather than built speculatively (ponytail: this is a
known ceiling, not a bug). The fix, when a route needs it, is
`02-RESEARCH.md` Pattern 2's `after_begin` event listener, reading a
`ContextVar` this module would set -- and the handler must call
`connection.execute(...)`, never `session.execute(...)`, or SQLAlchemy raises
`InvalidRequestError: This session is provisioning a new connection`
(confirmed against a maintainer-reported fix, cited in Pattern 2).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Session as SessionRow
from morai.db.models import User
from morai.db.session import get_db_session
from morai.identity.tokens import hash_token


@dataclass(frozen=True)
class AuthenticatedUser:
    """Never crosses an API boundary, so it is a plain frozen dataclass, not
    an `ApiModel` -- `ApiModel` is for request and response shapes."""

    user_id: UUID
    is_admin: bool


async def get_current_user(
    morai_session: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_db_session),
) -> AuthenticatedUser:
    if morai_session is None:
        raise HTTPException(status_code=401, detail="not authenticated")

    row = (
        await session.execute(
            select(SessionRow).where(
                SessionRow.token_hash == hash_token(morai_session),
                SessionRow.expires_at > datetime.now(UTC),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="not authenticated")

    # Same session, same already-open transaction (the SELECT above triggered
    # SQLAlchemy's autobegin) -- SET LOCAL does not need to be the first
    # statement in a transaction, only issued before the queries it protects.
    await session.execute(
        text("SET LOCAL app.current_user_id = :uid"), {"uid": str(row.user_id)}
    )

    # The caller's own `users` row is visible because the SET LOCAL above just
    # made it so -- this is the self clause of the `users` policy doing its
    # job, and it is also a free live proof that the context took effect.
    caller = (
        await session.execute(select(User).where(User.id == row.user_id))
    ).scalar_one()

    if caller.is_admin:
        await session.execute(text("SET LOCAL app.is_admin = 'true'"))

    return AuthenticatedUser(user_id=row.user_id, is_admin=caller.is_admin)


async def get_current_admin(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """404, not 403, for a non-admin -- D2-08's not-found-not-forbidden
    posture applies to every authorization boundary in this phase, not only
    the RLS-filtered data one."""
    if not user.is_admin:
        raise HTTPException(status_code=404, detail="not found")
    return user
