"""The one token mechanism for both flows this phase names (`NN-35`, D2-01,
D2-02): a setup link and a password reset are the identical shape --
generate, hash, store with a purpose and an absolute expiry; consume in one
atomic statement that matches only an unexpired, correctly-purposed row.

Building two tables and two consume functions for "setup" and "reset" would
be two implementations of the same atomic-consume logic -- the duplicated-
write shape this project's own history warns against (`L060`, the money
kernel's one carry source). One `setup_tokens` table with a `purpose`
discriminator, one `issue_token`, one `consume_token`, used by both routes in
`api/routes_identity.py`.

`TokenPurpose` is a `StrEnum`, not bare strings passed around as `str`, so a
typo in a call site is a type error rather than a token that can never be
consumed by anything.

`consume_token` follows `02-RESEARCH.md` Pattern 1's exact form: one
`delete(...).where(...).returning(...)` statement. `SELECT` then check then
`DELETE`/`UPDATE` is three statements with a window between the first and the
third where a second concurrent request can pass the identical check --
exactly the race `NN-35` exists to prevent. Postgres's own MVCC guarantees
exactly one concurrent `DELETE` against the same row can succeed; the
loser's `WHERE` simply matches zero rows. That is a database guarantee, this
function does not add it.

`consume_token` commits, because the delete-and-return is the atomic unit
its callers depend on -- a caller that went on to do more work and then
rolled back must not un-consume the token underneath them. This is the
opposite of `identity/audit.py`'s `open_audited_read()`, which deliberately
does *not* commit, so that its audit row shares the fate of the read it
unlocks (D2-12). Two functions in this package with opposite commit
behaviour need the reason written down here, or a future reader will make
them consistent and break one of them.

`issue_token` does not commit -- the caller's own commit (creating the user
row, or nothing else at all for a bare reissue) covers it, matching the
"commit once, at the natural end of the unit of work" shape the rest of this
package follows.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SetupToken
from morai.identity.tokens import generate_token, hash_token


class TokenPurpose(StrEnum):
    SETUP = "setup"
    PASSWORD_RESET = "password_reset"


async def issue_token(
    session: AsyncSession, *, user_id: UUID, purpose: TokenPurpose, ttl: timedelta
) -> str:
    """Generates a raw token, stores only its hash with `purpose` and an
    absolute `expires_at`, and returns the raw token. The raw token is
    returned and never stored; the hash is stored and never returned
    (`NN-34`)."""
    raw = generate_token()
    session.add(
        SetupToken(
            token_hash=hash_token(raw),
            user_id=user_id,
            purpose=purpose.value,
            expires_at=datetime.now(UTC) + ttl,
        )
    )
    return raw


async def consume_token(
    session: AsyncSession, *, raw_token: str, purpose: TokenPurpose
) -> UUID | None:
    """One atomic `DELETE ... RETURNING`. Returns the user id, or `None` for
    invalid, expired, already-used, or wrong-purpose -- all four
    indistinguishable to the caller, by design, so the failure mode itself is
    not an oracle an attacker can query."""
    stmt = (
        delete(SetupToken)
        .where(
            SetupToken.token_hash == hash_token(raw_token),
            SetupToken.purpose == purpose.value,
            SetupToken.expires_at > datetime.now(UTC),
        )
        .returning(SetupToken.user_id)
    )
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    await session.commit()
    return row
