"""settlement_names_its_leg

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-02

Hand-written, matching every prior revision. `down_revision = "0016"`.

## Why

`derive_position_state` (`morai/ledger/positions.py`) reads only
`FillRecord`s, so a leg that expires keeps its non-zero net forever and
its position never closes -- reproduced against the real functions, not
theorised. A SETTLEMENT is an `Event`, never a `Fill`, and until this
revision the event did not record *which* leg it settled: `events`
carried `position_id` and `event_time` and nothing else identifying, so
the derivation had nothing in the event stream to close a leg with.

`events.leg_id` is that missing fact. With it the derivation closes the
settled leg from the events it already reads -- no clock input, no
re-derivation from expiry, and the pure/no-`AsyncSession` contract
`tests/ledger/test_pairing_pure.py` gates stays exactly as it was.

## Shape

A nullable FK to `legs.id`, plus:

    CHECK (event_type = 'SETTLEMENT' OR leg_id IS NULL)

an implication, deliberately not the biconditional migration 0014 used
for `rolled_from_position_id`. A SETTLEMENT written before this revision
has no leg to name, and the backfill below cannot invent one for a leg
that no longer exists; the reverse direction ("a SETTLEMENT must name a
leg") would make those rows unstorable and this migration unrunnable.
An unattributed SETTLEMENT closes no leg -- an honest gap (`NN-16`), not
an assumption about which leg it must have been.

## The backfill

Every SETTLEMENT row this codebase has ever written came from
`derive_settlements` (`morai/ledger/settlements.py`), whose `event_time`
is exactly `settlement_instant(expiry, root=leg.root)` for one leg of
that position. The UPDATE below inverts that: it re-computes the same
instant in SQL from `legs.root` and the expiry embedded in
`legs.occ_symbol`, and matches it against `events.event_time`.

Both halves of the rule are restated here, in SQL, and that duplication
is the risk worth naming: `AM_SETTLEMENT_TIME`/`PM_SETTLEMENT_TIME` and
the SPX/SPXW split live in Python. This statement runs once, at the
moment the two representations are known to agree; from then on the
stored `leg_id` is the authority and nothing re-derives it. A later
change to the Python constants does not invalidate an already-backfilled
row.

`occ_symbol` is `<root><YYMMDD><type><strike>` (`parse_occ_symbol`'s own
convention), so the expiry is the six characters after the stored root --
`substring(occ_symbol from length(root) + 1 for 6)` -- and never a fixed
offset, which would read `SPXW` as `SPX` plus a stray `W`.

A position with two legs sharing one root and expiry (not a structure
this project trades -- calendars and diagonals have distinct expiries)
would match both legs; the UPDATE attributes the row to one of them, and
the other leg's settlement is minted fresh on the next sync now that the
idempotency key includes `leg_id`.

## Downgrade

Drops the CHECK, the FK and the column. The `leg_id` values are lost --
shape is reversible, data is not.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None

_UUID = postgresql.UUID(as_uuid=True)

_LEG_FK_NAME = "events_leg_id_fkey"
_LEG_CHECK_NAME = "only_settlement_names_a_leg"

# See "The backfill" above. `AT TIME ZONE 'America/New_York'` on a naive
# timestamp yields the timestamptz that wall-clock instant denotes in ET,
# which is what `settlement_instant` computes -- never a fixed UTC offset,
# wrong for roughly half the year (D7-08).
_BACKFILL_SQL = """
UPDATE events e
SET leg_id = l.id
FROM legs l
WHERE e.event_type = 'SETTLEMENT'
  AND e.leg_id IS NULL
  AND l.position_id = e.position_id
  AND e.event_time = (
        to_date(
            '20' || substring(l.occ_symbol from length(l.root) + 1 for 6),
            'YYYYMMDD'
        )
        + CASE WHEN l.root = 'SPX' THEN time '09:30' ELSE time '16:00' END
      ) AT TIME ZONE 'America/New_York'
"""


def upgrade() -> None:
    bind = op.get_bind()

    op.add_column("events", sa.Column("leg_id", _UUID, nullable=True))
    op.create_foreign_key(_LEG_FK_NAME, "events", "legs", ["leg_id"], ["id"])
    bind.execute(sa.text(_BACKFILL_SQL))
    op.create_check_constraint(
        _LEG_CHECK_NAME,
        "events",
        "event_type = 'SETTLEMENT' OR leg_id IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint(_LEG_CHECK_NAME, "events", type_="check")
    op.drop_constraint(_LEG_FK_NAME, "events", type_="foreignkey")
    op.drop_column("events", "leg_id")
