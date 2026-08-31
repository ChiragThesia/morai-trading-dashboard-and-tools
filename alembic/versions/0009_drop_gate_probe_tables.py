"""drop_gate_probe_tables

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-31

Discharges the obligation `src/morai/db/models.py` has carried in its own
docstrings since Phase 1 (`GateMoneyProbe`) and Phase 2 (`GateUserScopedProbe`):
each was permanent production surface for the life of its own phase, not
scaffolding, and each said plainly -- in the code, not only in a plan -- that
it would be dropped once real trading tables existed to prove the same thing
against. That real schema landed across migrations 0007 (`fills`) and 0008
(`positions`, `legs`, `events`). Plan 03-06 then moved every proof either
probe table carried -- the Decimal round-trip and the RLS isolation
guarantee -- onto those real tables *first*, observed the suite green against
them, and only after that does this revision drop the tables the proofs used
to depend on. That ordering (03-06 before 03-07) is what makes this drop a
schema change rather than a coverage loss.

Reverses in the order `0003_identity_and_rls.py`'s own `downgrade()` reasons
about its grants: drop the policy on `gate_user_scoped_probe`, revoke its
grants, revoke `gate_money_probe`'s table and sequence grants, then drop both
tables. Never edit 0001 through 0008 -- they are applied, and this phase
fixes forward (D3-19).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None

_UUID = postgresql.UUID(as_uuid=True)
_GEN_UUID = sa.text("gen_random_uuid()")


def upgrade() -> None:
    bind = op.get_bind()

    # The policy, then the grants -- both must go before the table itself so
    # the drop below is dropping an object with no remaining dependents,
    # mirroring 0003's own downgrade() shape rather than relying on CASCADE
    # to do this implicitly.
    bind.execute(sa.text("DROP POLICY user_isolation ON gate_user_scoped_probe"))
    bind.execute(
        sa.text(
            "REVOKE SELECT, INSERT, UPDATE, DELETE ON gate_user_scoped_probe "
            "FROM morai_app"
        )
    )
    bind.execute(sa.text("REVOKE SELECT, INSERT ON gate_money_probe FROM morai_app"))
    bind.execute(
        sa.text("REVOKE USAGE, SELECT ON gate_money_probe_id_seq FROM morai_app")
    )

    op.drop_table("gate_user_scoped_probe")
    op.drop_table("gate_money_probe")


def downgrade() -> None:
    bind = op.get_bind()

    # Recreates both tables with their original columns -- matches
    # 0001_gate_money_probe.py's upgrade() and 0003_identity_and_rls.py's
    # gate_user_scoped_probe create_table() exactly, so the chain stays
    # genuinely reversible rather than approximately so.
    op.create_table(
        "gate_money_probe",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("amount_usd", sa.Numeric(14, 4), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_table(
        "gate_user_scoped_probe",
        sa.Column("id", _UUID, primary_key=True, server_default=_GEN_UUID),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
    )

    bind.execute(sa.text("GRANT SELECT, INSERT ON gate_money_probe TO morai_app"))
    bind.execute(sa.text("GRANT USAGE, SELECT ON gate_money_probe_id_seq TO morai_app"))
    bind.execute(
        sa.text(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON gate_user_scoped_probe "
            "TO morai_app"
        )
    )

    bind.execute(
        sa.text("ALTER TABLE gate_user_scoped_probe ENABLE ROW LEVEL SECURITY")
    )
    bind.execute(sa.text("ALTER TABLE gate_user_scoped_probe FORCE ROW LEVEL SECURITY"))
    bind.execute(
        sa.text(
            "CREATE POLICY user_isolation ON gate_user_scoped_probe "
            "FOR ALL "
            "USING (user_id = current_setting('app.current_user_id', true)::uuid) "
            "WITH CHECK "
            "(user_id = current_setting('app.current_user_id', true)::uuid)"
        )
    )
