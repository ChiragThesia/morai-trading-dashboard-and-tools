"""Fill-to-event derivation: fills are the only input, `events` the only
output (LEDGER-01). This module owns three things -- the order-anchor
disambiguation SQL (a plaintext-only structural join, D3-02), the pure
OPEN/CLOSE derivation core (LEDGER-12: no session, no clock, no broker
call), and the shell that reads fills, resolves them, derives, and writes
through `insert_events` -- the one write path.

Honest limit, mirroring `derive_connection_health`'s own (`vendor/
connections.py`): this module is proven against the 13 real oracle
calendars in `salvage/oracle-fixtures.md` plus the 14th synthetic negative
control and the seeded-fault suite. It is not proven against Schwab's live
payload shape, which Phase 6 first exercises for real.

Scope this phase (D5-01): OPEN and CLOSE only. Positive ROLL and SETTLE
derivation are deferred to a phase with a real fixture for them; nothing
here builds a ROLL-detection guard or emits a ROLL/SETTLEMENT event.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventWrite, insert_events
from morai.ledger.fills import FillRecord, read_fills

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `fills.py`/`events.py`/`test_plaintext_queries.py` already
# established. `TypeAdapter` narrows at that boundary (D-06).
_STR: TypeAdapter[str] = TypeAdapter(str)
_INT: TypeAdapter[int] = TypeAdapter(int)
_DATETIME: TypeAdapter[datetime] = TypeAdapter(datetime)
_UUID_OR_NONE: TypeAdapter[UUID | None] = TypeAdapter(UUID | None)

# The four columns of `fills`' five-column composite primary key that
# discriminate within one user (NN-1; `user_id` is fixed for one
# derivation -- a single call always operates over one user's own fills --
# so it is not part of this tuple).
FillKey = tuple[str, str, int, datetime]

# Order-anchor disambiguation (Rule 3, LEDGER-03, NN-11), already proven
# against real Postgres 18 seeded with real oracle data in
# `tests/ledger/test_plaintext_queries.py`. Taken verbatim from that
# module's former private copy, with exactly one change: `WHERE user_id =
# :user_id` on `position_legs` and `WHERE f.user_id = :user_id` on
# `fill_candidates`, so the query names its own scope rather than relying
# on RLS alone -- the same both-belts discipline `read_fills` already
# uses. Every existing comment is kept.
RESOLVE_FILL_POSITIONS_SQL = """
WITH position_legs AS (
    -- Never narrow this CTE to one position's own legs. A per-calendar
    -- scoped read here is the second layer of hard case 1 (L061): it
    -- would never see a sibling calendar's unique anchor leg, so the
    -- disambiguation logic below would have nothing to resolve an
    -- ambiguous fill against, even written correctly. This CTE must
    -- always see every leg the user has, for every call.
    SELECT position_id, user_id, occ_symbol FROM legs WHERE user_id = :user_id
),
fill_candidates AS (
    SELECT f.user_id, f.order_id, f.occ_symbol, f.leg_index, f.execution_time,
           pl.position_id
    FROM fills f
    JOIN position_legs pl
      ON pl.user_id = f.user_id AND pl.occ_symbol = f.occ_symbol
    WHERE f.user_id = :user_id
),
anchors AS (
    -- Postgres has no MIN(uuid) aggregate; the text-cast round trip picks
    -- an arbitrary representative, which is safe here only because
    -- HAVING already restricts this group to exactly one distinct value.
    SELECT user_id, order_id, occ_symbol, MIN(position_id::text)::uuid AS position_id
    FROM fill_candidates
    GROUP BY user_id, order_id, occ_symbol
    HAVING COUNT(DISTINCT position_id) = 1
),
order_anchors AS (
    SELECT DISTINCT user_id, order_id, position_id FROM anchors
)
SELECT fc.order_id, fc.occ_symbol, fc.leg_index, fc.execution_time,
    (SELECT oa.position_id FROM order_anchors oa
      WHERE oa.user_id = fc.user_id AND oa.order_id = fc.order_id
        AND oa.position_id IN (
          SELECT position_id FROM fill_candidates fc2
          WHERE fc2.user_id = fc.user_id AND fc2.order_id = fc.order_id
            AND fc2.occ_symbol = fc.occ_symbol AND fc2.leg_index = fc.leg_index
            AND fc2.execution_time = fc.execution_time
        )
    ) AS resolved_position_id
FROM fill_candidates fc
GROUP BY fc.user_id, fc.order_id, fc.occ_symbol, fc.leg_index, fc.execution_time
"""


class FillRole(StrEnum):
    """A fill's own role, classified from its own `position_effect` --
    never `side` (Rule 1, `classify_fill` below)."""

    OPEN = "OPEN"
    CLOSE = "CLOSE"
    UNKNOWN = "UNKNOWN"


class EventType(StrEnum):
    """The two event types this phase derives. Values are exactly the
    strings migration 0008's `events_event_type_check` permits; `ROLL` and
    `SETTLEMENT` are also permitted by that CHECK but are out of this
    phase's scope (D5-01) and have no member here."""

    OPEN = "OPEN"
    CLOSE = "CLOSE"


@dataclass(frozen=True)
class DerivedEvent:
    """One OPEN or CLOSE event, derived but not yet written."""

    position_id: UUID
    event_type: EventType
    event_time: datetime
    fill_ids_hash: str
    open_debit_usd: Decimal | None
    close_credit_usd: Decimal | None
    # Always `None` this phase. Per D5-04 the arithmetic here is
    # deliberately fee-free (avgPrice x qty, never the broker's
    # netAmount), so the fee is a known gap and a gap is `None`, never `0`
    # (NN-16). This field has no column in `events` and is not persisted
    # this phase -- that is deliberate. Phase 9's reconciliation
    # invariant is what has to confront it, at this typed boundary,
    # rather than rediscovering the gap itself.
    commission_usd: Decimal | None


@dataclass(frozen=True)
class Derivation:
    """The result of one `derive_events` call: the events produced, plus
    every fill that could not contribute to one -- explicitly, never
    silently (NN-11)."""

    events: tuple[DerivedEvent, ...]
    # A fill whose key had no resolution (or resolved to `None`) in the
    # `resolutions` mapping -- left unresolved rather than guessed.
    unresolved: tuple[FillKey, ...]
    # A fill whose `position_effect` was neither "OPENING" nor "CLOSING".
    unclassified: tuple[FillKey, ...]


def classify_fill(position_effect: str) -> FillRole:
    """Rule 1: classify a fill from its own `position_effect` only. `side`
    is not a parameter here and must never become one -- a signature
    accepting a role alongside a list of fills is the exact shape of the
    round-4 production bug (NN-9, L022): closing a short leg is a buy and
    closing a long leg is a sell, so `side` carries no role information.
    """
    if position_effect == "OPENING":
        return FillRole.OPEN
    if position_effect == "CLOSING":
        return FillRole.CLOSE
    return FillRole.UNKNOWN


def _signed_leg_amount(fill: FillRecord, event_type: EventType) -> Decimal | None:
    """`price_usd * quantity`, signed from the fill's own `side` --
    never `abs()`, here or anywhere in this module (NN-10): the sign is
    the only thing carrying direction, and direction comes from the
    vendor's own `side` field, read once, never re-derived (NN-9). For an
    OPEN event a buy is positive and a sell negative; for a CLOSE event a
    sell is positive and a buy negative -- the convention
    `salvage/oracle-fixtures.md` states as `openNetDebit = buy - sell`,
    `closeNetCredit = sell - buy`.

    Returns `None` when either `quantity` or `price_usd` is `None` -- a
    gap is `None`, never `0` (NN-16).
    """
    if fill.quantity is None or fill.price_usd is None:
        return None
    amount = fill.price_usd * fill.quantity
    if event_type is EventType.OPEN:
        return amount if fill.side == "BUY" else -amount
    return amount if fill.side == "SELL" else -amount


def _net_amount(fills: Sequence[FillRecord], event_type: EventType) -> Decimal | None:
    """Sums `_signed_leg_amount` over a group of fills composing one
    event. Returns `None` if any member returned `None` -- a partial gap
    makes the whole net amount a gap, not a partially-computed figure."""
    total = Decimal("0")
    for fill in fills:
        amount = _signed_leg_amount(fill, event_type)
        if amount is None:
            return None
        total += amount
    return total


def hash_fill_ids(keys: Iterable[FillKey]) -> str:
    """A deterministic, order-independent digest of the fills composing
    one event (LEDGER-09's idempotency key). Each key renders as its four
    parts joined by colons, with `execution_time` as its integer
    microsecond epoch -- the same rendering `fills.py::_fill_associated_data`
    already fixed, so no timezone or formatting drift between two runs can
    make them disagree. The rendered strings are then sorted before
    joining and hashing, which is what makes the digest order-independent
    by construction -- mirroring v1's own `hashFillIds` shape.
    """
    rendered = sorted(
        f"{order_id}:{occ_symbol}:{leg_index}:"
        f"{int(execution_time.timestamp() * 1_000_000)}"
        for order_id, occ_symbol, leg_index, execution_time in keys
    )
    return hashlib.sha256(":".join(rendered).encode("utf-8")).hexdigest()


def derive_events(
    fills: Sequence[FillRecord],
    resolutions: Mapping[FillKey, UUID | None],
) -> Derivation:
    """Pure. No `AsyncSession`, no `datetime.now()`, no import that could
    reach a broker (LEDGER-12) -- the same shape `derive_connection_health`
    established, so the one call serves both the oracle suite and the
    shell below and the two cannot drift.

    For each fill: look up its key in `resolutions`. A `None` or absent
    value leaves the fill explicitly unresolved and it contributes to
    nothing (NN-11 -- never guessed, never orphan-parked silently).
    Classify the resolved fill from its own `position_effect`; an unknown
    role goes to the unclassified tuple and contributes to nothing either.

    Survivors are grouped by `(position_id, role, order_id)`. Grouping by
    `order_id` is deliberate: each derived event then corresponds to one
    real broker transaction, which is what makes re-derivation over a
    `(user, order_id)` scope produce the same rows as a full sweep. Honest
    limit: with the oracle's own data every position has exactly one
    order per role, so this grouping and a plain per-position grouping are
    indistinguishable here -- that is an untested equivalence, not a
    proven one.

    Each group becomes one `DerivedEvent`: `event_time` is the minimum
    `execution_time` in the group, so it is the broker order's own time
    and never `now()` and never a `positions` column. The open-role group
    sets `open_debit_usd` from `_net_amount` and leaves `close_credit_usd`
    `None`; the close-role group does the reverse.

    Events are returned sorted by `(position_id, event_type, fill_ids_hash)`
    so two runs over the same input are comparable element-wise.
    """
    unresolved: list[FillKey] = []
    unclassified: list[FillKey] = []
    groups: dict[tuple[UUID, FillRole, str], list[FillRecord]] = {}

    for fill in fills:
        key: FillKey = (
            fill.order_id,
            fill.occ_symbol,
            fill.leg_index,
            fill.execution_time,
        )
        position_id = resolutions.get(key)
        if position_id is None:
            unresolved.append(key)
            continue
        role = classify_fill(fill.position_effect)
        if role is FillRole.UNKNOWN:
            unclassified.append(key)
            continue
        groups.setdefault((position_id, role, fill.order_id), []).append(fill)

    events: list[DerivedEvent] = []
    for (position_id, role, _order_id), group_fills in groups.items():
        event_type = EventType.OPEN if role is FillRole.OPEN else EventType.CLOSE
        event_time = min(fill.execution_time for fill in group_fills)
        keys = tuple(
            (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)
            for fill in group_fills
        )
        fill_ids_hash = hash_fill_ids(keys)
        net_amount = _net_amount(group_fills, event_type)
        events.append(
            DerivedEvent(
                position_id=position_id,
                event_type=event_type,
                event_time=event_time,
                fill_ids_hash=fill_ids_hash,
                open_debit_usd=net_amount if event_type is EventType.OPEN else None,
                close_credit_usd=(
                    net_amount if event_type is EventType.CLOSE else None
                ),
                commission_usd=None,
            )
        )

    events.sort(key=lambda e: (str(e.position_id), e.event_type.value, e.fill_ids_hash))
    return Derivation(
        events=tuple(events),
        unresolved=tuple(unresolved),
        unclassified=tuple(unclassified),
    )


async def resolve_fill_positions(
    session: AsyncSession, user_id: UUID
) -> dict[FillKey, UUID | None]:
    """Executes `RESOLVE_FILL_POSITIONS_SQL` with the `user_id` bind and
    narrows the untyped `text()` row values through `TypeAdapter`, exactly
    as `test_plaintext_queries.py` and `fills.py` already do -- no `cast`,
    no `Any`."""
    rows = (
        await session.execute(text(RESOLVE_FILL_POSITIONS_SQL), {"user_id": user_id})
    ).all()
    resolutions: dict[FillKey, UUID | None] = {}
    for row in rows:
        key: FillKey = (
            _STR.validate_python(row[0]),
            _STR.validate_python(row[1]),
            _INT.validate_python(row[2]),
            _DATETIME.validate_python(row[3]),
        )
        resolutions[key] = _UUID_OR_NONE.validate_python(row[4])
    return resolutions


async def sync_events(
    session: AsyncSession,
    user_id: UUID,
    *,
    order_ids: Collection[str] | None = None,
) -> Derivation:
    """The shell: resolve, read, derive, write. Calls
    `resolve_fill_positions` and `read_fills` for the whole user, always,
    and only then filters the fill list by `order_ids` in Python if one
    was given. Reading whole-user and narrowing afterwards is load-bearing,
    not laziness: the anchor for an ambiguous fill can live on a sibling
    position's leg, so a read narrowed before resolution has no anchor to
    work with even with the resolution logic correctly written (L061).

    Honest ceiling, stated rather than left implicit: this reads every
    fill for the user on every call, which is correct and cheap at this
    project's volume and would need revisiting at a volume this project
    does not have.

    Does not commit and does not set `app.current_user_id` -- the caller
    owns both, the same convention `insert_fills`, `insert_events` and
    `identity/audit.py::open_audited_read` all already follow. An internal
    commit here would reset the transaction-local GUC the caller's next
    RLS-scoped query depends on.
    """
    resolutions = await resolve_fill_positions(session, user_id)
    fills = await read_fills(session, user_id)
    if order_ids is not None:
        wanted = set(order_ids)
        fills = [fill for fill in fills if fill.order_id in wanted]

    derivation = derive_events(fills, resolutions)

    drafts = [
        EventWrite(
            position_id=event.position_id,
            event_type=event.event_type.value,
            event_time=event.event_time,
            fill_ids_hash=event.fill_ids_hash,
            open_debit_usd=event.open_debit_usd,
            close_credit_usd=event.close_credit_usd,
        )
        for event in derivation.events
    ]
    if drafts:
        await insert_events(session, user_id, drafts)

    return derivation
