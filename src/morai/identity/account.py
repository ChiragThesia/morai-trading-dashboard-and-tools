"""Account deletion is a crypto-shred, not a row delete (AUTH-06, D3-08,
criterion 5, T-03-19).

**The order is the claim, not an implementation detail.** Destroy the
wrapped data key first, then the trade rows, then the identity rows, then
the user row last. Reversed or interleaved, an interrupted deletion (a
crash, a killed process, a connection drop) leaves readable ciphertext
behind with its key still present -- the exact opposite of the guarantee
this function exists to make. A later reader tidying these deletes into one
statement per table in schema order, or reordering them alphabetically,
must not: that reordering silently undoes the crypto-shred property, and
nothing downstream would notice until an incident report asked why deleted
account's trade data was still readable.

`gate_user_scoped_probe` (Phase 2's isolation-proof scaffolding, `user_id ->
users.id` foreign key) is deleted alongside the identity rows even though
this plan's own `<behavior>` block does not name it: `users.id` cannot be
deleted while any row still references it, and `seeded_users`'s own fixture
seeds one probe row per user, so leaving this out makes every deletion in
this plan's own test suite fail on a foreign-key violation, not a crypto
concern -- a real blocker (Rule 3), not scope creep. 03-VALIDATION.md's own
"Carried Obligation" section already names dropping this table outright as
owed elsewhere in this phase; until that migration lands, any row here is a
real foreign key this function must clear.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Event, Fill, GateUserScopedProbe, Leg, Position
from morai.db.models import Session as SessionRow
from morai.db.models import SetupToken, User, UserDataKey


async def delete_account(session: AsyncSession, user_id: UUID) -> None:
    """Deletes every row belonging to `user_id`, in the order the module
    docstring above explains. Does not commit -- same convention as
    `morai.ledger.fills.insert_fills`/`identity/audit.py::open_audited_read`:
    the caller owns the transaction.

    1. `user_data_keys` -- destroying the wrapped data key first is what
       makes everything after this line a crypto-shred rather than a plain
       row delete. Every trade row this user ever wrote becomes unreadable
       the instant this statement commits, even if the process crashes
       before any later step runs.
    2. Trade rows (`events`, `legs`, `positions`, `fills`, children before
       parents so no foreign key is violated) -- now provably inert
       ciphertext. Deleted for storage and RLS-simplicity reasons, not for
       confidentiality; confidentiality was already won by step 1.
    3. Identity rows (`sessions`, `setup_tokens`, `gate_user_scoped_probe` --
       see the module docstring for why the last of these is here at all)
       -- revokes any live session and any outstanding setup or reset token
       for this user, and clears the one other foreign key `users.id`
       still carries.
    4. `users` itself, last -- every foreign key above points at this row.
    """
    await session.execute(delete(UserDataKey).where(UserDataKey.user_id == user_id))

    await session.execute(delete(Event).where(Event.user_id == user_id))
    await session.execute(delete(Leg).where(Leg.user_id == user_id))
    await session.execute(delete(Position).where(Position.user_id == user_id))
    await session.execute(delete(Fill).where(Fill.user_id == user_id))

    await session.execute(delete(SessionRow).where(SessionRow.user_id == user_id))
    await session.execute(delete(SetupToken).where(SetupToken.user_id == user_id))
    await session.execute(
        delete(GateUserScopedProbe).where(GateUserScopedProbe.user_id == user_id)
    )

    await session.execute(delete(User).where(User.id == user_id))
