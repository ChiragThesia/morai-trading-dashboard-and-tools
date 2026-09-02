"""derived_position_state_and_campaign_chain

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-01

Carries all three of Phase 7's schema changes as one revision (D7-15).
Hand-written, matching every prior revision. `down_revision = "0013"`.

## Change one: drop `positions.opened_at`/`positions.closed_at` (D7-01)

ROADMAP criterion 1 for this phase reads "no status column exists anywhere
that could disagree with it." A stored timestamp is exactly that column --
calendar `65aac62e` (`salvage/oracle-fixtures.md`) reported open in v1 after
its real close order had fully unwound both legs, because the stored field
had drifted from the fills that actually closed it. Phase 3 already
declined to add a `status` column on the identical reasoning (`Position`'s
own docstring, migration 0008); `closed_at` is that column wearing a
different type. Keeping the columns and merely not writing them is weaker
than dropping them -- the column still exists to disagree. Closed state is
derived instead, from net quantity per leg (`morai.ledger.positions.
derive_position_state`, LEDGER-05, 07-02-PLAN.md Task 1).

**Why the loss is provably empty, checked two ways, not one, before this
migration ran:**

1. `git log --all -S "insert(Position)" -- src/` returns exactly one
   commit (07-01's `create_positions`), and `git log --all -S "INSERT INTO
   positions" -- src/` returns nothing -- no production code path has ever
   inserted a `positions` row before this phase, and 07-01's own
   `create_positions` leaves both columns `NULL` by construction (it never
   names `opened_at`/`closed_at` at all). Every `insert(Position)` call
   that ever *did* pass the two kwargs lived in test seeds
   (`tests/ledger/oracle_seed.py`), removed by 07-02 Task 2, before this
   migration.
2. Live local Postgres, checked immediately before writing this migration:
   `SELECT count(*), count(opened_at), count(closed_at) FROM positions` ->
   `16 | 0 | 0`. Sixteen rows, zero non-NULL values in either column.
   Railway holds no `positions` rows either (that deploy is still blocked
   on `MORAI_APP_DB_PASSWORD`, and no code path ever wrote the columns
   regardless of deploy status).

So the DDL below destroys no data -- there was none to destroy. The
operation is still rated `one-way` (07-02-PLAN.md Task 3) because the *DDL
itself* is irreversible in the general case: `downgrade()` re-adds both
columns, nullable, but restores no value that might have been present.
Schema shape is reversible; data is not. This migration's own upgrade
happens to run against a database where that distinction is moot -- the
next migration that drops a column with real data in it will not have this
migration's luxury, and should not assume it does.

## Change two: `events.rolled_from_position_id` + its CHECK (D7-10)

A nullable FK to `positions.id`, non-NULL if and only if `event_type =
'ROLL'` -- a biconditional, not merely an implication, so the CHECK states
exactly what D7-10 asks for:

    CHECK ((event_type = 'ROLL') = (rolled_from_position_id IS NOT NULL))

Composes independently with migration 0008's existing `roll_has_both_legs`
CHECK -- multiple `CHECK` constraints on one table are implicitly ANDed by
Postgres, and neither constraint references the other's columns, so there
is no ordering or interaction to reason about. The ROLL row hangs on the
**newly opened** position and points back at the closed one (D7-10) --
this makes the newest position in a chain its own campaign head, which is
the direction `campaign_chain` (change three) actually walks from.

## Change three: the `campaign_chain` view (D7-11, Pitfall 1)

A recursive-CTE `VIEW`, not a materialized one -- a materialized view is a
second stored copy that can drift, the exact failure LEDGER-10 exists to
prevent (D7-11). `WITH (security_invoker = true)` is **non-negotiable, the
single highest-risk line in this migration**: this project's migrations run
as a superuser via the DDL engine, and a Postgres view's row-level-security
behaviour follows the *view owner's* privileges by default, not the
querying role's [CITED: postgresql.org/docs/current/sql-createview.html,
fetched via curl, 07-RESEARCH.md Pattern 1]. The superuser owner has
`rolbypassrls`, so without this clause every user querying `campaign_chain`
through `morai_app` would silently see every other user's campaign chain,
past a green single-user test suite that never noticed. `FORCE ROW LEVEL
SECURITY` on `events`/`positions` (migration 0008) does not help here --
`FORCE` only changes how the table owner's own *direct* queries are
treated, not how a view's owner-vs-invoker privilege model resolves, and a
`BYPASSRLS` role bypasses `FORCE` too. Asserted structurally here (from
`pg_class.reloptions`, `tests/ledger/test_schema_contract.py`); proven
behaviourally by a real second user in 07-04.

`CYCLE position_id SET is_cycle USING path` is Postgres's native cycle
guard (PG14+, this project runs 18) [CITED: postgresql.org/docs/current/
queries-with.html] -- a corrupt chain (a ROLL pointing back into its own
ancestry) terminates the recursion instead of hanging the query, with no
hand-rolled visited-set. `SELECT` granted to `morai_app` individually, not
`ALL TABLES IN SCHEMA` (matching 0003/0007/0008's own discipline).

## Downgrade

Reverses in dependency order (mirroring 0008's own reverse-order drops):
view first (nothing else depends on it), then the CHECK and FK constraints
on `events.rolled_from_position_id`, then the column itself, then the two
`positions` timestamp columns are re-added, nullable, empty -- shape
restored, no data restored (see Change one above).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None

_UUID = postgresql.UUID(as_uuid=True)

_ROLLED_FROM_FK_NAME = "events_rolled_from_position_id_fkey"
_ROLLED_FROM_CHECK_NAME = "roll_has_rolled_from_position"

_CAMPAIGN_CHAIN_VIEW_SQL = """
CREATE VIEW campaign_chain
WITH (security_invoker = true)
AS
WITH RECURSIVE chain AS (
    -- Base case: a position that is not itself the target of any ROLL --
    -- i.e. it was opened directly, not rolled into. It is its own
    -- campaign root.
    SELECT p.id AS campaign_root_id, p.id AS position_id, 0 AS depth
    FROM positions p
    WHERE NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.event_type = 'ROLL' AND e.position_id = p.id
    )
  UNION ALL
    -- Recursive case: walk forward via rolled_from_position_id.
    SELECT c.campaign_root_id, e.position_id, c.depth + 1
    FROM chain c
    JOIN events e
      ON e.event_type = 'ROLL' AND e.rolled_from_position_id = c.position_id
)
CYCLE position_id SET is_cycle USING path
SELECT campaign_root_id, position_id, depth
FROM chain
"""


def upgrade() -> None:
    bind = op.get_bind()

    # Change one (D7-01) -- see module docstring for the two-way-checked,
    # provably-empty-data argument for why this is safe today.
    op.drop_column("positions", "opened_at")
    op.drop_column("positions", "closed_at")

    # Change two (D7-10).
    op.add_column(
        "events",
        sa.Column("rolled_from_position_id", _UUID, nullable=True),
    )
    op.create_foreign_key(
        _ROLLED_FROM_FK_NAME,
        "events",
        "positions",
        ["rolled_from_position_id"],
        ["id"],
    )
    op.create_check_constraint(
        _ROLLED_FROM_CHECK_NAME,
        "events",
        "(event_type = 'ROLL') = (rolled_from_position_id IS NOT NULL)",
    )

    # Change three (D7-11, Pitfall 1) -- op has no create-view primitive;
    # bind.execute(sa.text(...)) is this repo's own convention for
    # anything op doesn't support (0008's grant/RLS blocks).
    bind.execute(sa.text(_CAMPAIGN_CHAIN_VIEW_SQL))
    bind.execute(sa.text("GRANT SELECT ON campaign_chain TO morai_app"))


def downgrade() -> None:
    bind = op.get_bind()

    bind.execute(sa.text("REVOKE SELECT ON campaign_chain FROM morai_app"))
    bind.execute(sa.text("DROP VIEW campaign_chain"))

    op.drop_constraint(_ROLLED_FROM_CHECK_NAME, "events", type_="check")
    op.drop_constraint(_ROLLED_FROM_FK_NAME, "events", type_="foreignkey")
    op.drop_column("events", "rolled_from_position_id")

    # Shape restored, not data -- see module docstring, Change one.
    op.add_column(
        "positions",
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "positions",
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
