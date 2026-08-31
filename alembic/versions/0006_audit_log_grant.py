"""audit_log_grant

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-31

Narrow `morai_app`'s table-level grant on `audit_log` to `INSERT` only.

**Found at Phase 2's code review (WR-05), not at a runtime failure.** Migration
0003 grants `SELECT, INSERT, UPDATE, DELETE` uniformly to `morai_app` across
all five identity tables in one loop, `audit_log` included. `audit_log` then
gets a single `append_only` policy -- `FOR INSERT WITH CHECK (true)` -- with
no `SELECT`/`UPDATE`/`DELETE` policy at all. Today that is safe:
`FORCE ROW LEVEL SECURITY` plus the absence of a matching policy means those
three verbs default-deny for `morai_app` regardless of the table-level grant.

**Why fixed anyway.** `identity/audit.py`'s own docstring states the
guarantee -- "the app role can append and cannot read its own trail back" --
and today that guarantee rests entirely on RLS being correctly configured,
with no independent floor at the GRANT layer. A single future migration that
added an overly permissive `SELECT`/`UPDATE`/`DELETE` policy on `audit_log`
(easy to do by copy-pasting `gate_user_scoped_probe`'s `FOR ALL` shape, which
migration 0003 explicitly warns readers not to do for a different reason)
would, combined with the grant already in place, immediately make the audit
trail readable and alterable by the app role -- no second line of defense
would need to fail, only one. Granting only `INSERT` closes that gap at the
grant layer itself, independent of whatever policy exists or is added later,
matching the "named individually per table" discipline migration 0003
already applies to which *tables* get access.

Fixed forward in its own revision rather than by editing 0003, which is
already applied both locally and in CI; an in-place edit would never run
where 0003 already has.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("REVOKE SELECT, UPDATE, DELETE ON audit_log FROM morai_app"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("GRANT SELECT, UPDATE, DELETE ON audit_log TO morai_app"))
