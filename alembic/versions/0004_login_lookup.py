"""login_lookup

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-31

A `SECURITY DEFINER` function for the one read that has to precede
authentication: `/login`'s lookup of a row by *username*, before any
`app.current_user_id` exists to satisfy migration 0003's `self_or_admin`
policy on `users`.

**Found as a Rule 1 bug during 02-06's own RED, not designed for in 0003.**
`self_or_admin` is `USING (id = current_setting('app.current_user_id', true)
::uuid OR current_setting('app.is_admin', true) = 'true')`. With `FORCE ROW
LEVEL SECURITY` (0003), that policy governs every command including SELECT,
for every role except a superuser or the exempted table owner -- and
`morai_app` is neither. With no context set (which is exactly login's own
situation: the whole point of the route is to establish one), the policy
evaluates to `NULL OR NULL`, which permits nothing. Every `/login` attempt,
correct password or not, got zero rows back and a 401 -- confirmed against
real Postgres this session, not reasoned from the policy text alone.

**Why a function, not a wider `USING` clause.** Migration 0003's own
`sessions`/`setup_tokens` precedent already accepts "no RLS at all, because
possession of the token IS the authorization" -- login's analogous
authorization is "the correct username+password pair", checked by the
application, not by Postgres. The straightforward RLS fix -- a second
`FOR SELECT` policy that fires whenever no context is set -- was rejected
after writing it out: PERMISSIVE policies OR together, and Postgres RLS
policies see row content and session settings, never the query's own WHERE
clause, so a policy that lets an anonymous caller read *one* row by username
necessarily lets an anonymous caller read *every* row (id, username,
password_hash, is_admin) the moment any code runs an unscoped `SELECT` with
no context set. That is strictly worse than what this function does: an
anonymous caller gets exactly the two columns login needs (`id`,
`password_hash`), for exactly the one row `p_username` names, and nothing
else in `users` is reachable without an established context.

**The mechanism.** `SECURITY DEFINER` makes the function execute as its
*owner* -- here, whichever role runs this migration, asserted by 0003's own
first statement to be a superuser. `current_user` becomes that owner only
for the function's own execution; superusers bypass RLS unconditionally,
`FORCE ROW LEVEL SECURITY` binds only the table owner and ordinary roles,
never a superuser (0003's own docstring, quoting the Postgres docs). Once
`login()` (`routes_identity.py`) has verified the password, it sets
`app.current_user_id` itself, in the same transaction, before touching
`users` again (the lazy Argon2 rehash) -- mirroring `/setup`'s own
consume-then-establish-context ordering, so every OTHER write to `users`
still goes through the normal, RLS-respecting `morai_app` path unchanged.

`SET search_path = public` pins name resolution inside the function body so
a caller cannot redirect `users` to a different schema via a session-level
`search_path` -- the standard `SECURITY DEFINER` hardening
(postgresql.org/docs/current/sql-createfunction.html, "Writing SECURITY
DEFINER Functions Safely").
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "CREATE FUNCTION login_lookup(p_username text) "
            "RETURNS TABLE(id uuid, password_hash text) "
            "LANGUAGE sql "
            "SECURITY DEFINER "
            "SET search_path = public "
            "AS $$ "
            "  SELECT users.id, users.password_hash FROM users "
            "  WHERE users.username = p_username "
            "$$"
        )
    )
    bind.execute(sa.text("GRANT EXECUTE ON FUNCTION login_lookup(text) TO morai_app"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DROP FUNCTION login_lookup(text)"))
