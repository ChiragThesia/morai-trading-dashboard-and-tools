"""The audited-read capability (AUTH-08, D2-11, D2-12).

**What type-checks (a real "does not compile"):** `get_user_for_management(session,
proof: AuditedRead)` has exactly one signature. A caller who reaches for the obvious
thing -- `get_user_for_management(session, subject_id)` -- passes a `UUID` where an
`AuditedRead` is required, and both basedpyright and mypy reject it. This is the same
class of guarantee as `needs_usd(IndexPoints(...))` in this repo's own
`tests/gate/fixtures/violation_unit_confusion.py`, and it is proved the identical way,
by `tests/gate/fixtures/violation_unaudited_read.py`.

**What does not type-check (falls back to a runtime guard):** a caller who *forges* an
`AuditedRead` by constructing one directly with some other sentinel gets a
`RuntimeError`, not a type error. Type checkers verify shapes, not provenance -- an
`AuditedRead` built by hand has the right shape, so nothing here is a static-analysis
problem for them to catch. This is tested as a unit test, not claimed as a
compile-time guarantee.

**What neither covers:** whether a reviewer notices that a brand-new privileged
surface should route through this pattern at all. That is D2-11's own explicit
fallback rung ("beats a review convention"). The pattern reduces how much rests on
review; it does not remove review. No docstring, comment, commit message or test name
anywhere in this module may claim the audit log "cannot be bypassed" -- that is not
what is true.

Where this does and does not apply (D2-08, `02-RESEARCH.md` Pitfall 4): the one
legitimate cross-user read in this system is admin account management -- looking up
another user's `users` row to issue a setup link or reset a password. Trading data has
no legitimate cross-user read at all, including for the admin, and never gets an
`AuditedRead` path -- only RLS. The `users` table's `self_or_admin` policy (migration
0003) is the one deliberate admin exception in this schema and is not a template; a
future data table that inherits its admin clause makes Phase 3's encryption boundary
decorative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import NewType
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import User

_FACTORY_SENTINEL = object()

# WR-04: `reader_id` and `subject_id` are both plain `UUID`s -- a transposed
# call site (`open_audited_read(reader_id=user_id, subject_id=admin_id)`)
# type-checks cleanly either way and silently inverts the audit record. A
# `NewType` per role makes that swap a real basedpyright/mypy error instead:
# passing a bare `UUID`, or the wrong role's `NewType`, where the other is
# expected is now rejected at the call site, not just at runtime.
ReaderId = NewType("ReaderId", UUID)
SubjectId = NewType("SubjectId", UUID)


@dataclass(frozen=True)
class AuditedRead:
    """Proof that this specific cross-user read was audited. The only public
    constructor is `open_audited_read()` below -- a caller who builds one by hand
    supplies the wrong sentinel and it raises immediately, at the read call site,
    not silently later.

    `_token` is typed `object`, not `Any`: `Any` is banned by name (ruff `TID251`,
    basedpyright `reportExplicitAny`), and `object` is both accurate and sufficient,
    since the only thing ever done with it is an identity comparison.
    """

    reader_id: ReaderId
    subject_id: SubjectId
    _token: object = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._token is not _FACTORY_SENTINEL:
            raise RuntimeError(
                "AuditedRead must come from open_audited_read() -- constructing "
                "one directly bypasses the audit log (AUTH-08)."
            )


async def open_audited_read(
    session: AsyncSession, *, reader_id: ReaderId, subject_id: SubjectId
) -> AuditedRead:
    """D2-12: the audit row and the capability that unlocks the read are produced
    in the same call, on the same session -- so committing the caller's own
    transaction also commits the audit row, or neither commits. This function
    deliberately does not call `session.commit()`; doing so here would let the
    audit row commit while the read that follows could still fail or roll back
    on its own, which is exactly the split-fate D2-12 forbids.

    **Measured against real Postgres in CI, this plan's own push:** the ORM-style
    `insert(AuditLog).values(...)` looked right and type-checked, but failed at
    runtime with `InsufficientPrivilegeError: new row violates row-level security
    policy for table "audit_log"` -- not because the insert was rejected, but
    because `AuditLog.id`'s `server_default` makes SQLAlchemy append an implicit
    `RETURNING audit_log.id` to fetch the generated value, and a `RETURNING`
    clause is itself a read that Postgres RLS checks against the table's SELECT
    policies. `audit_log` deliberately carries none (migration 0003's own
    `append_only` policy is INSERT-only) -- the app role can append and cannot
    read its own trail back, including via the write statement's own return
    value. Plain `text()` SQL is not augmented by SQLAlchemy's implicit-returning
    machinery, so it is what this insert uses instead.
    """
    await session.execute(
        text(
            "INSERT INTO audit_log (reader_id, subject_id) "
            "VALUES (:reader_id, :subject_id)"
        ),
        {"reader_id": reader_id, "subject_id": subject_id},
    )
    return AuditedRead(
        reader_id=reader_id, subject_id=subject_id, _token=_FACTORY_SENTINEL
    )


async def get_user_for_management(
    session: AsyncSession, proof: AuditedRead
) -> User | None:
    """The only privileged cross-user read in this phase. Exactly one signature --
    there is no overload that accepts a bare `(session, subject_id)`; omitting the
    capability is a basedpyright/mypy error, not a runtime surprise.
    """
    return (
        await session.execute(select(User).where(User.id == proof.subject_id))
    ).scalar_one_or_none()
