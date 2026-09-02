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

`gate_user_scoped_probe` no longer needs clearing here. Plan 03-04 added a
`delete(GateUserScopedProbe)` step to the identity-rows block below because
the table carried an uncascaded `user_id -> users.id` foreign key and
`seeded_users`'s own fixture seeded one probe row per user, so `DELETE FROM
users` failed on that foreign key otherwise -- a real blocker, documented as
such at the time, pointing at 03-VALIDATION.md's "Carried Obligation" section
for the actual fix. Migration 0009 (plan 03-07) is that fix: it drops
`gate_user_scoped_probe` outright, so the foreign key it carried is gone with
it, and the step that once cleared it is no longer merely unnecessary --
its justification no longer exists. Recorded here, not deleted silently, so
a future reader can see why the step was there and why it left.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import (
    BrokerTransaction,
    Event,
    Fill,
    Leg,
    Position,
    ReconciliationRun,
    SchwabConnection,
    SnapshotMark,
    SnapshotObservation,
    SnapshotRun,
    SyncRun,
)
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
    2. Trade rows (`snapshot_marks`, `snapshot_observations`, `events`,
       `legs`, `positions`, `fills`, `broker_transactions`,
       `reconciliation_runs`, children before parents so no foreign key is
       violated) -- now provably inert ciphertext, with one exception named
       below. Deleted for storage and RLS-simplicity reasons, not for
       confidentiality; confidentiality was already won by step 1.
       `broker_transactions` carries an uncascaded `user_id -> users.id`
       foreign key exactly like `fills` does (D6-02, migration 0011), so it
       belongs in this same block for the same reason `fills` does -- this
       file's own docstring already records what happens when a new table
       with that foreign key is added without doing this.

       The two snapshot tables (D8-01, migration 0015) carry a second
       uncascaded foreign key, `leg_id -> legs.id`, so they must be deleted
       **before** `legs`, not merely somewhere in this block. Ordering here
       is load-bearing twice over, then: once for the crypto-shred, once
       for this foreign key.

       `reconciliation_runs` (D9-13, migration 0016) is the exception to
       "confidentiality was already won by step 1". Its four money columns
       are plaintext `Numeric` on purpose -- the status endpoint has to
       answer "how far off, and in which direction" without unwrapping a
       data key -- so step 1 does not make them unreadable. Deleting the
       row is the only thing that removes a deleted account's realised P&L
       from the database.
    3. Identity rows (`sessions`, `setup_tokens`, `schwab_connections`,
       `sync_runs`, `snapshot_runs`) -- revokes any live session, any
       outstanding setup or reset token, and any live Schwab connection
       for this user (Phase
       4). A Schwab connection's stored token is a bearer credential
       against a real brokerage account, so removing the row revokes that
       access too -- but exactly as with the trade rows in step 2, the
       encrypted token is already made unreadable by step 1 destroying the
       wrapped data key. `sync_runs` carries an uncascaded
       `user_id -> users.id` foreign key exactly like `schwab_connections`
       does (Phase 6, migration 0012), and is plaintext operational
       metadata rather than ciphertext, so it belongs in this block for
       storage reasons, not confidentiality ones. `snapshot_runs` (Phase
       8, migration 0015) is the same shape as `sync_runs` -- counts, a
       status and an error code about one capture cycle, no money and no
       ciphertext -- and belongs here for the identical reason. This
       delete exists so the final `DELETE FROM users` has no dangling
       child, and for storage, not for confidentiality. See the module
       docstring for why this step used to also clear
       `gate_user_scoped_probe`, and no longer needs to.
    4. `users` itself, last -- every foreign key above points at this row.
    """
    await session.execute(delete(UserDataKey).where(UserDataKey.user_id == user_id))

    await session.execute(delete(SnapshotMark).where(SnapshotMark.user_id == user_id))
    await session.execute(
        delete(SnapshotObservation).where(SnapshotObservation.user_id == user_id)
    )
    await session.execute(delete(Event).where(Event.user_id == user_id))
    await session.execute(delete(Leg).where(Leg.user_id == user_id))
    await session.execute(delete(Position).where(Position.user_id == user_id))
    await session.execute(delete(Fill).where(Fill.user_id == user_id))
    await session.execute(
        delete(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
    )
    await session.execute(
        delete(ReconciliationRun).where(ReconciliationRun.user_id == user_id)
    )

    await session.execute(delete(SessionRow).where(SessionRow.user_id == user_id))
    await session.execute(delete(SetupToken).where(SetupToken.user_id == user_id))
    await session.execute(
        delete(SchwabConnection).where(SchwabConnection.user_id == user_id)
    )
    await session.execute(delete(SyncRun).where(SyncRun.user_id == user_id))
    await session.execute(delete(SnapshotRun).where(SnapshotRun.user_id == user_id))

    await session.execute(delete(User).where(User.id == user_id))
