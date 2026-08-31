"""Bootstrap script: creates the first admin account and issues its `SETUP`
token (AUTH-01). The chicken-and-egg is real and there is no way around it --
the very first admin cannot be created by an admin, since none exists yet.
This script therefore connects on the superuser engine (`get_engine()`),
which bypasses RLS entirely, rather than the `morai_app` engine every route
uses.

Refuses, with a clear message and a non-zero exit, if an admin already
exists (T-02-32). This is a bootstrap tool, not an admin-management tool --
a second unnoticed admin is a second unnoticed cross-user reach.

Prints the raw `SETUP` token to stdout, once, and nothing else that is
secret: no DSN, no password, no hash (`NN-34`). The token is
bearer-equivalent -- it is handed to the new admin out of band, is never
stored anywhere in raw form, and cannot be reissued. Losing it means running
this again after deleting the row it belongs to.

Invocations:

    uv run python tools/create_admin.py <username>
    railway run --service web uv run python tools/create_admin.py <username>
"""

from __future__ import annotations

import asyncio
import sys
from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from morai.db.models import User
from morai.db.session import get_engine
from morai.identity.setup_tokens import TokenPurpose, issue_token

# Matches `routes_identity.py`'s own setup-token TTL -- the admin hands this
# off out of band and it may sit unread for a few days.
_SETUP_TOKEN_TTL = timedelta(days=7)


async def main(username: str) -> int:
    session_maker = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with session_maker() as session:
        # WR-06: the check below and the insert further down are otherwise
        # check-then-act -- two concurrent invocations could both observe zero
        # admins and both proceed. `pg_advisory_xact_lock`, not
        # `SELECT ... FOR UPDATE`: `FOR UPDATE` locks rows that already exist,
        # and the state this guard exists to protect is exactly zero admin
        # rows, so `FOR UPDATE` would lock nothing and not prevent the race at
        # all. The advisory lock takes effect the instant it is acquired
        # regardless of what rows exist, and releases automatically at the end
        # of this transaction (commit, or the implicit rollback on session
        # close below when an admin already exists) -- a fixed key because
        # this script guards one global condition ("does any admin exist"),
        # not a per-row resource.
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('morai:create_admin'))")
        )

        existing_admin = (
            await session.execute(select(User.id).where(User.is_admin.is_(True)))
        ).first()
        if existing_admin is not None:
            print(
                "Refusing: an admin already exists. This is a bootstrap "
                "tool, not an admin-management tool.",
                file=sys.stderr,
            )
            return 1

        admin = User(username=username, is_admin=True)
        session.add(admin)
        await session.flush()
        raw_token = await issue_token(
            session,
            user_id=admin.id,
            purpose=TokenPurpose.SETUP,
            ttl=_SETUP_TOKEN_TTL,
        )
        await session.commit()

    print(raw_token)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python tools/create_admin.py <username>", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
