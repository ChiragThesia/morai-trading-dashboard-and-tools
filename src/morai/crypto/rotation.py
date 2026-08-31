"""Master-key rotation: re-wrap every user's data key, touch no trade
ciphertext (D3-06, D3-07, CRYPT-04, criterion 3).

One function. **No statement in this module may name a trade table** --
that is what makes criterion 3's byte-identical claim structurally true
rather than true by accident (03-VALIDATION.md's own trap warning: "it
still decrypts" would pass even if every row had been rewritten). Rotating
the master key changes only how each user's already-generated DEK is
wrapped; the DEK bytes themselves, and everything encrypted under them,
never move.

Neither the old key nor the new key is persisted or logged (NN-34) -- both
arrive as parameters from the caller (an operator running
`tools/rotate_kek.py`) and never touch a column or a log line.

No `kek_version` column. With exactly one live master key at a time and a
single-invocation rotation, there is no concurrent multi-key window to
track, and the column would have no consumer. Revisit if the key ever moves
to a KMS where more than one key can be live at once (D3-06).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import unwrap_dek, wrap_dek
from morai.db.models import UserDataKey


async def rotate_kek(session: AsyncSession, old_kek: bytes, new_kek: bytes) -> int:
    """Re-wrap every `user_data_keys` row's DEK from `old_kek` to `new_kek`.
    Returns the count of rows re-wrapped.

    Intended to run on the superuser engine (`tools/rotate_kek.py` uses
    `get_engine`, not `get_app_engine`) -- this is DDL-class maintenance
    across every user's key, not a single user's request, and
    `user_data_keys` carries no `UPDATE` grant for the app role
    (migration 0007).

    Does not commit -- same convention as
    `morai.ledger.fills.insert_fills`/`identity/audit.py::open_audited_read`:
    the caller owns the transaction. `unwrap_dek` raises
    `cryptography.exceptions.InvalidTag` immediately on a wrong `old_kek`,
    before any row in this loop is written, so a bad key leaves every row
    wrapped under the old key rather than half re-wrapped under each --
    the one-transaction shape is what turns that per-row property into a
    whole-rotation guarantee.
    """
    rows = (
        (
            await session.execute(
                select(UserDataKey).order_by(
                    UserDataKey.user_id, UserDataKey.key_version
                )
            )
        )
        .scalars()
        .all()
    )

    count = 0
    for row in rows:
        dek = unwrap_dek(row.wrapped_dek, row.wrap_nonce, old_kek)
        new_wrapped_dek, new_wrap_nonce = wrap_dek(dek, new_kek)
        row.wrapped_dek = new_wrapped_dek
        row.wrap_nonce = new_wrap_nonce
        count += 1

    await session.flush()
    return count
