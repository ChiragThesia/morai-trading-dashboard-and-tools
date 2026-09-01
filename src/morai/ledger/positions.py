"""The missing position/leg creation path (D7-12, Pitfall 3, 07-RESEARCH.md).

Nothing under `src/` created a `positions` or `legs` row before this module:
`insert(Position)` appeared only in test seeds, and `resolve_fill_positions`
(`ledger/pairing.py`) already assumed positions existed to resolve fills
against. This module closes that gap -- group an order's unresolved OPENING
fills into one position plus its legs, `root` parsed from the OCC symbol by
the existing `parse_occ_symbol`, never re-derived by hand.

Pure/shell split, mirroring `derive_events`/`sync_events`
(`ledger/pairing.py`) exactly: `plan_positions` takes no `AsyncSession`,
reads no clock, and imports nothing that could reach a broker.
`create_positions` is the shell -- it takes this user's own
`pg_advisory_xact_lock`, resolves and reads fills, plans, and writes through
the ORM directly (unlike `insert_fills`/`insert_events`, there is no
encryption here -- `occ_symbol`/`leg_role`/`root` are plaintext by design,
migration 0008).

`_POSITION_WRITE_TOKEN`/`_LEG_WRITE_TOKEN` are this module's own write-token
sentinels, mirroring `_FILL_WRITE_TOKEN` (`ledger/fills.py`) exactly --
imported by `db/models.py`'s `Position.__init__`/`Leg.__init__` with a
local (function-body) import to break the circular import: this module
imports `Position`/`Leg` from `db/models.py` itself.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Leg, Position
from morai.ledger.fills import FillRecord, read_fills
from morai.ledger.pairing import (
    FillKey,
    FillRole,
    classify_fill,
    parse_occ_symbol,
    resolve_fill_positions,
)

_POSITION_WRITE_TOKEN = object()
_LEG_WRITE_TOKEN = object()

# Assigned by expiry order among an order's distinct OPENING occ_symbols
# (A1, resolved by planner directive -- no production fixture proves this
# against a real multi-leg order). Earlier expiry is front, later is back.
_LEG_ROLES_BY_EXPIRY_ORDER = ("front", "back")


@dataclass(frozen=True)
class PlannedLeg:
    """One leg of a `PlannedPosition`, not yet written."""

    leg_role: str
    occ_symbol: str
    root: str


@dataclass(frozen=True)
class PlannedPosition:
    """One order's worth of unresolved OPENING fills, grouped into the
    position and legs `create_positions` will write."""

    order_id: str
    legs: tuple[PlannedLeg, ...]


def plan_positions(
    fills: Sequence[FillRecord],
    resolutions: Mapping[FillKey, UUID | None],
) -> tuple[PlannedPosition, ...]:
    """Pure. No `AsyncSession`, no clock read, no import that could reach a
    broker -- the same purity contract `derive_events` states in its own
    docstring (D7-02's shape).

    Keeps only fills whose `FillKey` has no resolution yet (`resolutions.get
    (key) is None`) and whose `position_effect` classifies as
    `FillRole.OPEN` -- creation is OPENING-only (D7-12); a CLOSING fill with
    no resolution has nothing to close and plans nothing. Survivors are
    grouped by `order_id`, then collapsed to distinct `occ_symbol` values --
    an order minted from several fills against the same contract (partial
    fills) still yields one leg, not one per fill.

    Within a group, distinct symbols are parsed through `parse_occ_symbol`
    and sorted by `(expiry, occ_symbol)`. Exactly one distinct symbol plans
    one `PlannedLeg` with `leg_role="front"` and must not raise (A2, no
    production fixture proves this project ever opens a single-leg
    structure). Exactly two plans `front` (earlier expiry) and `back`
    (later expiry) per A1. Three or more distinct symbols is outside this
    project's traded structures (calendars and diagonals only) -- left out
    of the returned tuple entirely rather than guessing a role for it
    (NN-16): an absent `PlannedPosition` for that `order_id` is the honest
    gap, not a fabricated one.

    Returned sorted by `order_id` so two runs over the same input are
    comparable element-wise.
    """
    groups: dict[str, dict[str, FillRecord]] = {}
    for fill in fills:
        key: FillKey = (
            fill.order_id,
            fill.occ_symbol,
            fill.leg_index,
            fill.execution_time,
        )
        if resolutions.get(key) is not None:
            continue
        if classify_fill(fill.position_effect) is not FillRole.OPEN:
            continue
        groups.setdefault(fill.order_id, {}).setdefault(fill.occ_symbol, fill)

    planned: list[PlannedPosition] = []
    for order_id, by_symbol in groups.items():
        symbols = sorted(by_symbol, key=lambda occ: (parse_occ_symbol(occ).expiry, occ))
        if len(symbols) == 1:
            occ_symbol = symbols[0]
            legs: tuple[PlannedLeg, ...] = (
                PlannedLeg(
                    leg_role="front",
                    occ_symbol=occ_symbol,
                    root=parse_occ_symbol(occ_symbol).root,
                ),
            )
        elif len(symbols) == 2:
            legs = tuple(
                PlannedLeg(
                    leg_role=leg_role,
                    occ_symbol=occ_symbol,
                    root=parse_occ_symbol(occ_symbol).root,
                )
                for leg_role, occ_symbol in zip(
                    _LEG_ROLES_BY_EXPIRY_ORDER, symbols, strict=True
                )
            )
        else:
            continue
        planned.append(PlannedPosition(order_id=order_id, legs=legs))

    planned.sort(key=lambda p: p.order_id)
    return tuple(planned)


async def create_positions(session: AsyncSession, user_id: UUID) -> int:
    """The shell: resolve, read, plan, write. Mirrors `sync_events`'s own
    shell shape (`ledger/pairing.py`) exactly -- same per-user
    `pg_advisory_xact_lock` taken first, same resolve-then-read-whole-user
    ordering, no commit and no `app.current_user_id` set here -- the
    caller owns both (`sync_user`'s existing `set_config` call already
    covers this session).

    For each `PlannedPosition`: add the `Position` row, flush to obtain its
    server-generated `id`, then add one `Leg` row per planned leg and flush
    again. Returns the number of positions created.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
        {"uid": str(user_id)},
    )

    resolutions = await resolve_fill_positions(session, user_id)
    fills = await read_fills(session, user_id)
    planned = plan_positions(fills, resolutions)

    created = 0
    for position in planned:
        row = Position(_write_token=_POSITION_WRITE_TOKEN, user_id=user_id)
        session.add(row)
        await session.flush()
        for leg in position.legs:
            session.add(
                Leg(
                    _write_token=_LEG_WRITE_TOKEN,
                    position_id=row.id,
                    user_id=user_id,
                    leg_role=leg.leg_role,
                    occ_symbol=leg.occ_symbol,
                    root=leg.root,
                )
            )
        await session.flush()
        created += 1

    return created
