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

`derive_position_state`/`net_quantity_for_leg` (D7-01/D7-02/D7-03,
LEDGER-05) are this module's second half: the closed-state read model.
Nothing here stores the derived state -- it is recomputed on every read by
design, the same way `plan_positions` above is recomputed rather than
cached. Acquiring a stored copy for performance is a decision that has to
be taken explicitly, not slipped in -- storing it is the exact drift this
phase exists to prevent (calendar `65aac62e`, ROADMAP criterion 1).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Leg, Position
from morai.ledger.events import EventRecord, read_events
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


@dataclass(frozen=True)
class LegRow:
    """One leg, read-model shape -- defined here rather than imported as
    `db/models.py`'s `Leg`, so `derive_position_state` never names the ORM
    model and the existing AST gate in `tests/ledger/test_pairing_pure.py`
    (which proves the derivation module never even names `Position`) stays
    meaningful for this read model too."""

    id: UUID
    position_id: UUID
    occ_symbol: str


@dataclass(frozen=True)
class LegNet:
    """One leg's net quantity, signed and gap-honest."""

    leg_id: UUID
    occ_symbol: str
    net_quantity: Decimal | None


@dataclass(frozen=True)
class PositionState:
    """A position's derived open/closed state -- never stored, always
    recomputed (D7-01)."""

    position_id: UUID
    opened_at: datetime | None
    closed_at: datetime | None
    is_closed: bool | None
    leg_nets: tuple[LegNet, ...]


def net_quantity_for_leg(fills: Sequence[FillRecord]) -> Decimal | None:
    """Signs each fill's quantity from its own `side` -- BUY positive,
    SELL negative -- mirroring `_signed_leg_amount`'s (`ledger/pairing.py`)
    exact convention, and never taking an absolute value (D7-03, NN-9,
    NN-10): the sign is the only thing carrying direction, and direction
    comes from the vendor's own `side` field, read once, never re-derived.

    Returns `None` if any fill's `quantity` is `None` or its `side` is
    neither `"BUY"` nor `"SELL"`, propagating the gap the same way
    `_net_amount` does: a partial gap makes the whole net a gap, never a
    partially-computed figure (NN-16). Never consults `position_effect`:
    closing a short leg is a buy and closing a long leg is a sell, which
    is the round-4 production bug (L022) this function must not
    reproduce.
    """
    total = Decimal("0")
    for fill in fills:
        if fill.quantity is None:
            return None
        if fill.side not in ("BUY", "SELL"):
            return None
        total += fill.quantity if fill.side == "BUY" else -fill.quantity
    return total


def derive_position_state(
    position_id: UUID,
    legs: Sequence[LegRow],
    fills: Sequence[FillRecord],
    events: Sequence[EventRecord],
) -> PositionState:
    """Pure. No `AsyncSession`, no clock read, no import that could reach
    a broker (D7-02, LEDGER-12's own shape) -- `read_position_state` below
    is the thin shell that supplies real data.

    Computes one `LegNet` per leg by grouping `fills` on `occ_symbol` and
    calling `net_quantity_for_leg`. Derives `is_closed` as `True` when
    every leg's net is exactly `Decimal("0")`, `False` when every net is
    known and at least one is non-zero, and `None` when any leg's net is
    `None` -- a position with any gapped leg is not reported closed, and
    is not reported open either (D7-03). Derives `opened_at` from the
    earliest `event_time` among events whose `event_type` is `"OPEN"`, and
    `None` when there is none (D7-01). Derives `closed_at` as the latest
    `event_time` among the events present when `is_closed` is `True`, and
    `None` otherwise. `leg_nets` is sorted by `occ_symbol` so two runs are
    comparable element-wise.
    """
    leg_nets = tuple(
        sorted(
            (
                LegNet(
                    leg_id=leg.id,
                    occ_symbol=leg.occ_symbol,
                    net_quantity=net_quantity_for_leg(
                        [fill for fill in fills if fill.occ_symbol == leg.occ_symbol]
                    ),
                )
                for leg in legs
            ),
            key=lambda leg_net: leg_net.occ_symbol,
        )
    )

    nets = [leg_net.net_quantity for leg_net in leg_nets]
    is_closed: bool | None
    if any(net is None for net in nets):
        is_closed = None
    elif all(net == Decimal("0") for net in nets):
        is_closed = True
    else:
        is_closed = False

    open_times = [event.event_time for event in events if event.event_type == "OPEN"]
    opened_at = min(open_times) if open_times else None

    closed_at: datetime | None = None
    if is_closed and events:
        closed_at = max(event.event_time for event in events)

    return PositionState(
        position_id=position_id,
        opened_at=opened_at,
        closed_at=closed_at,
        is_closed=is_closed,
        leg_nets=leg_nets,
    )


async def read_position_state(
    session: AsyncSession, position_id: UUID, user_id: UUID
) -> PositionState:
    """The thin shell: queries this position's own legs, reads this
    user's whole-user fills and events, scopes both to this position (via
    `resolve_fill_positions` for fills, and a `position_id` filter for
    events -- a shared leg symbol can otherwise belong to a sibling
    position, `07-RESEARCH.md`'s hard case 1), and hands the result to
    `derive_position_state`. No commit, no `app.current_user_id` set --
    the caller owns both, the same convention `sync_events` and
    `create_positions` already follow.
    """
    leg_rows = (
        await session.execute(
            select(Leg).where(Leg.position_id == position_id, Leg.user_id == user_id)
        )
    ).scalars()
    legs = tuple(
        LegRow(id=row.id, position_id=row.position_id, occ_symbol=row.occ_symbol)
        for row in leg_rows
    )

    resolutions = await resolve_fill_positions(session, user_id)
    all_fills = await read_fills(session, user_id)
    fills = [
        fill
        for fill in all_fills
        if resolutions.get(
            (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)
        )
        == position_id
    ]

    all_events = await read_events(session, user_id)
    events = [event for event in all_events if event.position_id == position_id]

    return derive_position_state(position_id, legs, fills, events)
