"""revoke_public_login_lookup

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-31

Revoke the `PUBLIC` `EXECUTE` grant Postgres attaches to every new function,
which migration 0004 left in place on `login_lookup`.

**Found at Phase 2's post-merge gate, by reading `pg_proc.proacl` rather than
the migration text.** 0004 created the function and granted `EXECUTE` to
`morai_app` explicitly, but `CREATE FUNCTION` already grants `EXECUTE` to
`PUBLIC` by default, so the explicit grant was redundant and the default was
never removed. The observed ACL was `{=X/morai,morai=X/morai,morai_app=X/morai}`
-- the leading `=X` is `PUBLIC`.

**Why it matters.** `login_lookup` is `SECURITY DEFINER`, owned by a superuser,
and superusers bypass row level security unconditionally. So the default grant
let *any* role in the database read `(id, password_hash)` for any username it
could name, straight past migration 0003's `self_or_admin` policy on `users` --
the one policy this phase exists to make load-bearing. `morai_app` is granted
either way, so nothing in the running application changes; what changes is that
a role added later does not inherit a credential read by default. Phase 3 adds
more roles under this boundary, which is why this is fixed now rather than
carried.

`SET search_path = public` (0004) and revoking `PUBLIC` are the two halves of
the same hardening recipe -- postgresql.org/docs/current/sql-createfunction.html,
"Writing SECURITY DEFINER Functions Safely". 0004 applied only the first.

Fixed forward in its own revision rather than by editing 0004, which is already
applied both locally and in CI; an in-place edit would never run where 0004
already has.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("REVOKE EXECUTE ON FUNCTION login_lookup(text) FROM PUBLIC"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("GRANT EXECUTE ON FUNCTION login_lookup(text) TO PUBLIC"))
