"""The tracer (AUTH-07) and the admin-driven account lifecycle (AUTH-01,
AUTH-02, AUTH-05, AUTH-08).

Every route declares its contract by return type annotation, never
`response_model=` (D-11), matching `api/app.py`'s existing routes.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models import ApiModel
from morai.api.models_identity import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    AdminResetPasswordResponse,
    SetupRequest,
    SetupResponse,
)
from morai.db.models import GateUserScopedProbe, User
from morai.db.session import get_db_session
from morai.identity.audit import get_user_for_management, open_audited_read
from morai.identity.passwords import hash_password
from morai.identity.rls import require_rls_context
from morai.identity.sessions import (
    AuthenticatedUser,
    get_current_admin,
    get_current_user,
)
from morai.identity.setup_tokens import TokenPurpose, consume_token, issue_token

router = APIRouter()

# Not specified by any measured constant -- a judgment call, not a security
# boundary this plan's threat register scores on TTL length (T-02-27 rests on
# the token's 256 bits, not its lifetime). Setup is handed to a known person
# out of band (D2-01) and may sit unread for a few days; reset is requested
# in the moment and consumed promptly.
_SETUP_TOKEN_TTL = timedelta(days=7)
_RESET_TOKEN_TTL = timedelta(hours=1)


class UserScopedProbeResponse(ApiModel):
    probe_id: UUID
    note: str


@router.get("/gate/user-scoped-probe")
async def list_user_scoped_probes(
    _: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> list[UserScopedProbeResponse]:
    """No `WHERE user_id` -- RLS is the filter (`identity/sessions.py`'s
    `SET LOCAL`), and the absence of that clause is the point of this route.
    Do not "fix" it; a future reader's instinct will be to add one."""
    rows = (await session.execute(select(GateUserScopedProbe))).scalars().all()
    return [UserScopedProbeResponse(probe_id=row.id, note=row.note) for row in rows]


@router.get("/gate/user-scoped-probe/{probe_id}")
async def get_user_scoped_probe(
    probe_id: UUID,
    _: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> UserScopedProbeResponse:
    """Again no `WHERE user_id`. A row belonging to another user is filtered
    out by the policy and is therefore *absent* -- so the not-found path is
    reached with no extra code (`02-RESEARCH.md`'s comparison table calls
    this out as falling out of RLS naturally)."""
    row = (
        await session.execute(
            select(GateUserScopedProbe).where(GateUserScopedProbe.id == probe_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return UserScopedProbeResponse(probe_id=row.id, note=row.note)


@router.post("/admin/users")
async def create_user(
    body: AdminCreateUserRequest,
    _: AuthenticatedUser = Depends(get_current_admin),
    session: AsyncSession = Depends(get_db_session),
) -> AdminCreateUserResponse:
    """Admin only (`get_current_admin`: 404 for a non-admin, 401 for no
    session -- D2-08's not-found-not-forbidden posture applied to
    authorization). Creates the account with a null password hash, issues a
    `SETUP` token, and returns the user id plus the raw token, once -- it is
    never stored and never returned again.

    A duplicate username is a 409 with no detail beyond the status: this
    route is admin-only, so username enumeration is not the concern here, and
    the bare body matches this API's opaque-envelope convention rather than
    signalling anything secret.
    """
    user = User(username=body.username)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409) from None

    raw_token = await issue_token(
        session, user_id=user.id, purpose=TokenPurpose.SETUP, ttl=_SETUP_TOKEN_TTL
    )
    await session.commit()
    return AdminCreateUserResponse(user_id=user.id, setup_token=raw_token)


@router.post("/admin/users/{user_id}/reset-password")
async def reset_password(
    user_id: UUID,
    admin: AuthenticatedUser = Depends(get_current_admin),
    session: AsyncSession = Depends(get_db_session),
) -> AdminResetPasswordResponse:
    """Admin only. Reads the target user's row *through*
    `open_audited_read` + `get_user_for_management` (plan 02-04's one
    privileged cross-user read) -- the audit row and the read share one
    transaction and one commit (D2-12).

    `open_audited_read`'s `INSERT` carries a foreign key to `users.id`; a
    `user_id` naming no row raises `IntegrityError` immediately, before
    `get_user_for_management` ever runs. That failure and "the row exists but
    the read found nothing" both mean the same thing to the caller -- the
    target does not exist -- so both collapse to the identical 404.
    """
    try:
        proof = await open_audited_read(
            session, reader_id=admin.user_id, subject_id=user_id
        )
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=404) from None

    target = await get_user_for_management(session, proof)
    if target is None:
        await session.rollback()
        raise HTTPException(status_code=404) from None

    raw_token = await issue_token(
        session,
        user_id=target.id,
        purpose=TokenPurpose.PASSWORD_RESET,
        ttl=_RESET_TOKEN_TTL,
    )
    await session.commit()
    return AdminResetPasswordResponse(reset_token=raw_token)


@router.post("/setup")
async def setup(
    body: SetupRequest, session: AsyncSession = Depends(get_db_session)
) -> SetupResponse:
    """No authentication -- a raw token from an untrusted caller is the only
    credential on this route. Consumes the token for either purpose (setup
    and reset are the identical mechanism, D2-01/D2-02): try `SETUP` first,
    then `PASSWORD_RESET`; at most one of the two `consume_token` calls can
    ever delete a row, since the token's own `purpose` column matches only
    one of them.

    `consume_token`'s own commit ends the transaction it ran in, so the RLS
    context set below belongs to the *next* transaction -- the one the
    `UPDATE` actually runs in. `SET LOCAL`/`set_config(..., true)` does not
    survive a commit, which is the same property that makes it pooler-safe.

    Order: consume (commits) -> set the context from the consumed token's own
    user id -> `require_rls_context` confirms it took -> the `UPDATE` ->
    `rowcount == 1` or raise -> commit. The `rowcount` check is the belt to
    `require_rls_context`'s braces (`02-RESEARCH.md`'s named RLS pitfall: a
    context-less write against `users` matches zero rows and reports success,
    silently). An invalid, expired, reused, or wrong-purpose token returns
    400 with no distinguishing detail -- the same non-oracle discipline
    `consume_token`'s own `None` return already applies.
    """
    user_id = await consume_token(
        session, raw_token=body.token, purpose=TokenPurpose.SETUP
    )
    if user_id is None:
        user_id = await consume_token(
            session, raw_token=body.token, purpose=TokenPurpose.PASSWORD_RESET
        )
    if user_id is None:
        raise HTTPException(status_code=400) from None

    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    await require_rls_context(session)

    result = await session.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=hash_password(body.password))
    )
    # `update(...)` with no `.returning()` types as the base `Result[Any]`,
    # which carries no `rowcount` -- that attribute is `CursorResult`'s own.
    # `isinstance` narrows without `cast`/`Any` (D-06); every DML statement
    # executed through `session.execute()` against a real DBAPI cursor is
    # actually a `CursorResult` at runtime, so this never fails in practice.
    if not isinstance(result, CursorResult) or result.rowcount != 1:
        raise RuntimeError(
            "setup route: password UPDATE did not match exactly one row -- "
            "the RLS context was not established correctly for this "
            "consumed token's user id."
        )
    await session.commit()
    return SetupResponse()
