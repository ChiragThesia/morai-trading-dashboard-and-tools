"""Per-leg settlement (LEDGER-06, LEDGER-07): a SETTLEMENT event derived
from a leg's own expiry, strike and root -- no fill, no broker call. This
module mirrors `derive_events`/`sync_events`'s pure/shell split
(`ledger/pairing.py`) exactly: `derive_settlements` takes no `AsyncSession`
and reads no clock -- `as_of` is its caller's only time input (D7-06).
`read_legs` is the thin async shell, following `resolve_fill_positions`'s
own convention -- raw SQL held as a module-level named constant, results
narrowed through `TypeAdapter` at the untyped `text()` boundary.

Settlement style is read from `legs.root` and nothing else: `SPX` is
AM-settled, `SPXW` is PM-settled on every date it lists, third Fridays
included (D7-08). `D026` records the bug this rule prevents -- inferring
AM/PM from "is this a third Friday" is only safe while the code never sees
SPXW; once both roots coexist (criterion 3's whole point), a real SPXW
third Friday gets mistagged AM.

A SETTLEMENT's `open_debit_usd`/`close_credit_usd` are always `None`
(D7-07, NN-16) -- a cash-settled index option settles against the SOQ, and
no SOQ or market read exists until Phase 8. `DerivedSettlement` carries no
money fields at all, so this is a type-level fact, not a caller
convention.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventRecord
from morai.ledger.pairing import parse_occ_symbol

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `pairing.py`/`fills.py`/`events.py` already established.
# `TypeAdapter` narrows at that boundary (D-06).
_STR: TypeAdapter[str] = TypeAdapter(str)
_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)

READ_LEGS_SQL = (
    "SELECT id, position_id, leg_role, occ_symbol, root FROM legs "
    "WHERE user_id = :user_id"
)

# ET, never a fixed UTC offset -- Eastern is UTC-4 or UTC-5 depending on
# the date, so a constant offset is wrong roughly half the year (D7-08).
_EASTERN = ZoneInfo("America/New_York")
AM_SETTLEMENT_TIME = time(9, 30)
PM_SETTLEMENT_TIME = time(16, 0)


def settlement_instant(expiry: date, *, root: str) -> datetime:
    """`root` must be exactly `"SPX"` or `"SPXW"` -- this project's two
    roots (`parse_occ_symbol` already validates the OCC symbol shape
    upstream). AM for `SPX`, PM for `SPXW`, on every date `SPXW` lists,
    third Fridays included -- style comes from the root and nothing else
    (D7-08). `D026` is the bug this rule prevents: inferring AM/PM from
    "is this a third Friday" is only correct while the code never sees
    SPXW; once both roots coexist, a real SPXW third Friday gets tagged
    AM.

    Caveat that ships with the code, not only with the plan that wrote it:
    09:30 ET is a documented **lower bound**, not a citable instant. CBOE
    states the SOQ "is not anchored to a specific time of day," and the
    practitioner record has it delayed an hour or more on order
    imbalances (`docs/rebuild-research/phase0-measurements.md` §5).
    """
    settlement_time = AM_SETTLEMENT_TIME if root == "SPX" else PM_SETTLEMENT_TIME
    return datetime.combine(expiry, settlement_time, tzinfo=_EASTERN)


@dataclass(frozen=True)
class LegRecord:
    """One leg, read-model shape for settlement derivation."""

    id: UUID
    position_id: UUID
    leg_role: str
    occ_symbol: str
    root: str


@dataclass(frozen=True)
class DerivedSettlement:
    """One SETTLEMENT event, derived but not yet written. Deliberately
    carries no money fields -- a SETTLEMENT's amounts are always `None`
    (D7-07), and the type is the place that makes that unmistakable
    rather than a caller convention."""

    position_id: UUID
    event_time: datetime


def derive_settlements(
    legs: Sequence[LegRecord],
    events: Sequence[EventRecord],
    *,
    as_of: datetime,
) -> tuple[DerivedSettlement, ...]:
    """Pure: no `AsyncSession` parameter, no clock read inside -- `as_of`
    is the caller's only time input (D7-06).

    Builds the set of already-settled `(position_id, event_time)` pairs
    from `events` whose `event_type` is `"SETTLEMENT"`. For each leg,
    parses its `occ_symbol` through `parse_occ_symbol` to get the expiry,
    computes its settlement instant through `settlement_instant` using the
    leg's own stored `root`, skips it if that instant is later than
    `as_of` (not expired yet), skips it if its `(position_id, event_time)`
    pair is already present (idempotency), otherwise emits one draft.

    Returned sorted by `(str(position_id), event_time)` so two runs over
    the same input are comparable element-wise.
    """
    existing_settlement_times = {
        (event.position_id, event.event_time)
        for event in events
        if event.event_type == "SETTLEMENT"
    }

    drafts: list[DerivedSettlement] = []
    for leg in legs:
        contract = parse_occ_symbol(leg.occ_symbol)
        instant = settlement_instant(contract.expiry, root=leg.root)
        if instant > as_of:
            continue
        if (leg.position_id, instant) in existing_settlement_times:
            continue
        drafts.append(
            DerivedSettlement(position_id=leg.position_id, event_time=instant)
        )

    drafts.sort(key=lambda draft: (str(draft.position_id), draft.event_time))
    return tuple(drafts)


async def read_legs(session: AsyncSession, user_id: UUID) -> list[LegRecord]:
    """Executes `READ_LEGS_SQL` with the `user_id` bind and narrows the
    untyped `text()` row values through `TypeAdapter`, exactly as
    `resolve_fill_positions` (`ledger/pairing.py`) already does -- no
    `cast`, no `Any`. RLS `user_isolation` on `legs` (migration 0008) is
    the second layer scoping this read; the explicit `WHERE user_id =
    :user_id` bind names the scope rather than relying on RLS alone, the
    same both-belts discipline `resolve_fill_positions` uses."""
    rows = (await session.execute(text(READ_LEGS_SQL), {"user_id": user_id})).all()
    return [
        LegRecord(
            id=_UUID.validate_python(row[0]),
            position_id=_UUID.validate_python(row[1]),
            leg_role=_STR.validate_python(row[2]),
            occ_symbol=_STR.validate_python(row[3]),
            root=_STR.validate_python(row[4]),
        )
        for row in rows
    ]
