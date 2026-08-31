"""Deliberate negative control (D-07). Do not fix.

Calling `get_user_for_management` with a bare `UUID` instead of an `AuditedRead`
must fail type-check before the process runs -- the natural bypass of the
audited read path (AUTH-08, D2-11): a developer holding the subject's id
reaches for the read directly instead of going through `open_audited_read()`
first. `session` is annotated correctly so the only diagnostic either checker
reports is the wrong-argument-type violation on the second argument, not a
second, unrelated one on the first. Excluded from the real gate's own run
(see `pyproject.toml`).
"""

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from morai.identity.audit import get_user_for_management


async def _call(session: AsyncSession) -> None:
    await get_user_for_management(session, uuid4())
