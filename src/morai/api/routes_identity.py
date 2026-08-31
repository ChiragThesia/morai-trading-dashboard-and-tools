"""The tracer: one authenticated request, RLS-filtered end to end (AUTH-07).

Both routes declare their contract by return type annotation, never
`response_model=` (D-11), matching `api/app.py`'s existing routes.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models import ApiModel
from morai.db.models import GateUserScopedProbe
from morai.db.session import get_db_session
from morai.identity.sessions import AuthenticatedUser, get_current_user

router = APIRouter()


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
