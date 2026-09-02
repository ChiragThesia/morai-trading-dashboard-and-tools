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

Scope, by phase. Phase 5 (D5-01) shipped OPEN and CLOSE only, deferring
positive ROLL derivation because no real oracle fixture existed for it --
`detect_roll` shipped that phase as a negative guard only, proving one
real order (`1006797510202`) that shares two calendars is NOT a roll.
Phase 7 resolves that deferral (D7-09): ROLL is now derived by
`_roll_pairs`/`derive_events`'s roll pass below, reusing
`_signed_leg_amount`/`_net_amount` unmodified -- no new money arithmetic
is introduced, which is the whole basis on which the deferral is
resolved rather than overridden. SETTLEMENT (D7-05/D7-06) is derived
separately, by `ledger/settlements.py::derive_settlements`, and folded
into `sync_events` below -- no fill, no broker call.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventRecord, EventWrite, insert_events, read_events
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
    -- CR-01 (05-REVIEW.md): one order can anchor to more than one
    -- position (each via a different leg), so a plain scalar subquery
    -- here can return more than one row for a genuinely shared leg and
    -- Postgres raises instead of leaving the fill unresolved. Aggregating
    -- with COUNT(*) = 1 collapses that conflict to NULL -- explicitly
    -- unresolved (NN-11) -- rather than crashing the whole sync. Same
    -- text-cast MIN(uuid) trick as the `anchors` CTE above: Postgres has
    -- no MIN(uuid) aggregate, and COUNT(*) = 1 already guarantees the
    -- single surviving row makes MIN a no-op pick, never an arbitrary one.
    (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(oa.position_id::text)::uuid END
     FROM order_anchors oa
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
    """The event types this module derives. Values are exactly the
    strings migration 0008's `events_event_type_check` permits.
    `SETTLEMENT` (D7-05/D7-06) is derived by
    `ledger/settlements.py::derive_settlements` and folded into
    `sync_events` below -- no fill, no broker call. `ROLL` (D7-09) is
    derived by `_roll_pairs`/`derive_events`'s roll pass below, reusing
    `_signed_leg_amount`/`_net_amount` unmodified -- see `detect_roll`'s
    own docstring for what changed and on what condition."""

    OPEN = "OPEN"
    CLOSE = "CLOSE"
    SETTLEMENT = "SETTLEMENT"
    ROLL = "ROLL"


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
    # `None` for OPEN/CLOSE/SETTLEMENT. Set for ROLL only, to the closed
    # position's id (D7-10) -- a ROLL hangs on the newly opened position
    # (`position_id` above) and points back at the closed one through
    # this field, mirroring `EventWrite.rolled_from_position_id`
    # (`ledger/events.py`) exactly, which `sync_events` below copies this
    # field onto.
    rolled_from_position_id: UUID | None = None


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


@dataclass(frozen=True)
class RollPair:
    """One candidate ROLL: a CLOSING fill and an OPENING fill that
    `detect_roll` has already proved share a broker order and a contract
    (root, strike, option type) differing only in expiry, resolved to two
    different positions (D7-09)."""

    closing: FillRecord
    opening: FillRecord
    closed_position_id: UUID
    opened_position_id: UUID


def _roll_pairs(
    fills: Sequence[FillRecord],
    resolutions: Mapping[FillKey, UUID | None],
) -> tuple[RollPair, ...]:
    """Finds every candidate ROLL pair before the ordinary OPEN/CLOSE
    grouping in `derive_events` runs (D7-09). Groups resolved fills by
    `order_id`; within each order, a CLOSING fill pairs with an OPENING
    fill only when `detect_roll(closing, opening)` is `True` and the two
    resolve to different position ids. `detect_roll` already encodes the
    full strict predicate -- same order, roles from each fill's own
    `position_effect`, matching root/strike/option type, differing
    expiries -- so this function calls it rather than restating any part
    of it.

    A fill may belong to at most one pair. When a CLOSING fill matches
    more than one candidate OPENING fill, or an OPENING fill matches more
    than one candidate CLOSING fill, within the same order, that is an
    ambiguity and the pair is left unformed rather than guessed (NN-11):
    those fills then fall through to the ordinary OPEN/CLOSE path,
    exactly as they do today.

    Known, documented limitation (WR-02, `07-REVIEW.md`): a single-order
    roll of *both* legs of one calendar is undetectable by this
    predicate, and that is deliberate, not an oversight. A calendar's
    front and back legs share `root`/`strike`/`option_type` by
    construction, so "roll the whole calendar forward" in one broker
    order (close-front, close-back, open-new-front, open-new-back, all
    at one strike/root) makes `close-front` match *both*
    `open-new-front` and `open-new-back` under `detect_roll` -- two
    candidates, not one. The ambiguity rule above then correctly refuses
    to guess which is which, so *neither* leg of the roll forms a pair
    at all; both closing/opening fills fall through to the ordinary
    OPEN/CLOSE path instead, and the new calendar is created with no
    `rolled_from_position_id`. Consequence: `campaign_chain` never links
    the new calendar to the one it replaced -- campaign continuity
    breaks silently for this roll shape, with no error or log line
    naming it. This is NN-11's "leave unformed rather than guess"
    discipline working as intended, not a bug to loosen the predicate
    for. If continuity for this shape matters before Phase 8, the fix is
    to extend disambiguation with `leg_index`/relative-position matching
    (pair same-`leg_index` closing/opening fills first), not to relax
    the strike/root/type-only predicate itself.
    """
    by_order: dict[str, list[FillRecord]] = {}
    for fill in fills:
        key: FillKey = (
            fill.order_id,
            fill.occ_symbol,
            fill.leg_index,
            fill.execution_time,
        )
        if resolutions.get(key) is None:
            continue
        by_order.setdefault(fill.order_id, []).append(fill)

    def _position_id(fill: FillRecord) -> UUID | None:
        return resolutions.get(
            (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)
        )

    pairs: list[RollPair] = []
    for order_fills in by_order.values():
        closing_fills = [
            fill
            for fill in order_fills
            if classify_fill(fill.position_effect) is FillRole.CLOSE
        ]
        opening_fills = [
            fill
            for fill in order_fills
            if classify_fill(fill.position_effect) is FillRole.OPEN
        ]

        candidates: dict[FillKey, list[FillRecord]] = {}
        for closing in closing_fills:
            closing_key: FillKey = (
                closing.order_id,
                closing.occ_symbol,
                closing.leg_index,
                closing.execution_time,
            )
            candidates[closing_key] = [
                opening
                for opening in opening_fills
                if detect_roll(closing, opening)
                and _position_id(opening) != _position_id(closing)
            ]

        opening_match_counts: dict[FillKey, int] = {}
        for matches in candidates.values():
            for opening in matches:
                opening_key: FillKey = (
                    opening.order_id,
                    opening.occ_symbol,
                    opening.leg_index,
                    opening.execution_time,
                )
                opening_match_counts[opening_key] = (
                    opening_match_counts.get(opening_key, 0) + 1
                )

        for closing in closing_fills:
            closing_key = (
                closing.order_id,
                closing.occ_symbol,
                closing.leg_index,
                closing.execution_time,
            )
            matches = candidates[closing_key]
            if len(matches) != 1:
                continue
            opening = matches[0]
            opening_key = (
                opening.order_id,
                opening.occ_symbol,
                opening.leg_index,
                opening.execution_time,
            )
            if opening_match_counts[opening_key] != 1:
                continue
            closed_position_id = _position_id(closing)
            opened_position_id = _position_id(opening)
            if closed_position_id is None or opened_position_id is None:
                continue
            pairs.append(
                RollPair(
                    closing=closing,
                    opening=opening,
                    closed_position_id=closed_position_id,
                    opened_position_id=opened_position_id,
                )
            )

    return tuple(pairs)


def _signed_leg_amount(fill: FillRecord, event_type: EventType) -> Decimal | None:
    """`price_usd * quantity`, signed from the fill's own `side` --
    never `abs()`, here or anywhere in this module (NN-10): the sign is
    the only thing carrying direction, and direction comes from the
    vendor's own `side` field, read once, never re-derived (NN-9). For an
    OPEN event a buy is positive and a sell negative; for a CLOSE event a
    sell is positive and a buy negative -- the convention
    `salvage/oracle-fixtures.md` states as `openNetDebit = buy - sell`,
    `closeNetCredit = sell - buy`.

    Returns `None` when either `quantity` or `price_usd` is `None`, or
    when `side` is neither `"BUY"` nor `"SELL"` (WR-01, `05-REVIEW.md`) --
    a gap is `None`, never `0` and never a guess (NN-16). `side` is an
    unconstrained `Text` column sourced from the vendor's own field; an
    unrecognized value here must surface as a gap, not silently sign the
    amount as though it were the opposite of whatever the vendor sent.
    """
    if fill.quantity is None or fill.price_usd is None:
        return None
    if fill.side not in ("BUY", "SELL"):
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

    Runs the roll pass first (D7-09): `_roll_pairs` finds every candidate
    ROLL, and each is priced by calling `_net_amount` once per half --
    the opening half with `EventType.OPEN`, the closing half with
    `EventType.CLOSE` -- the same oracle-validated function the ordinary
    path below calls, never a new formula. If either half returns `None`
    the pair forms no ROLL at all and both its fills are left for the
    ordinary path below (NN-16: a half-priced ROLL is worse than no
    ROLL). Otherwise one `DerivedEvent` is emitted with `event_type`
    ROLL, `position_id` the *opened* position, and
    `rolled_from_position_id` the *closed* one (D7-10); its two amounts
    are stored split across `open_debit_usd`/`close_credit_usd`, never
    netted (LEDGER-04). The fills of every pair that did form a ROLL are
    then removed from the set that reaches the ordinary grouping below,
    so no fill ever contributes to both a ROLL and a separate OPEN or
    CLOSE.

    For each remaining fill: look up its key in `resolutions`. A `None`
    or absent value leaves the fill explicitly unresolved and it
    contributes to nothing (NN-11 -- never guessed, never orphan-parked
    silently). Classify the resolved fill from its own `position_effect`;
    an unknown role goes to the unclassified tuple and contributes to
    nothing either.

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

    Events are returned sorted by `(position_id, event_type, fill_ids_hash)`;
    the ROLL pass above never produces two events sharing that key for
    one input, since `fill_ids_hash` is a digest over both of a ROLL's
    own fills, so two runs over the same input remain comparable
    element-wise.
    """
    unresolved: list[FillKey] = []
    unclassified: list[FillKey] = []
    events: list[DerivedEvent] = []
    paired_keys: set[FillKey] = set()

    for pair in _roll_pairs(fills, resolutions):
        opening_amount = _net_amount([pair.opening], EventType.OPEN)
        closing_amount = _net_amount([pair.closing], EventType.CLOSE)
        if opening_amount is None or closing_amount is None:
            continue
        closing_key: FillKey = (
            pair.closing.order_id,
            pair.closing.occ_symbol,
            pair.closing.leg_index,
            pair.closing.execution_time,
        )
        opening_key: FillKey = (
            pair.opening.order_id,
            pair.opening.occ_symbol,
            pair.opening.leg_index,
            pair.opening.execution_time,
        )
        event_time = min(pair.closing.execution_time, pair.opening.execution_time)
        fill_ids_hash = hash_fill_ids((closing_key, opening_key))
        events.append(
            DerivedEvent(
                position_id=pair.opened_position_id,
                event_type=EventType.ROLL,
                event_time=event_time,
                fill_ids_hash=fill_ids_hash,
                open_debit_usd=opening_amount,
                close_credit_usd=closing_amount,
                commission_usd=None,
                rolled_from_position_id=pair.closed_position_id,
            )
        )
        paired_keys.add(closing_key)
        paired_keys.add(opening_key)

    groups: dict[tuple[UUID, FillRole, str], list[FillRecord]] = {}

    for fill in fills:
        key: FillKey = (
            fill.order_id,
            fill.occ_symbol,
            fill.leg_index,
            fill.execution_time,
        )
        if key in paired_keys:
            continue
        position_id = resolutions.get(key)
        if position_id is None:
            unresolved.append(key)
            continue
        role = classify_fill(fill.position_effect)
        if role is FillRole.UNKNOWN:
            unclassified.append(key)
            continue
        groups.setdefault((position_id, role, fill.order_id), []).append(fill)

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
    as_of: datetime | None = None,
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

    `as_of` (D7-06) is this function's own clock -- it never reads
    `datetime.now()` itself. When `None` (the default), settlement
    derivation is skipped entirely and this function behaves exactly as
    it did before this phase: the oracle suite and every existing caller
    need no change, and the 13-calendar gate stays byte-identical (D7-13).
    When supplied, `read_legs`/`derive_settlements`
    (`ledger/settlements.py`) run after the OPEN/CLOSE derivation, over
    the same `existing` events already read below, and their drafts join
    the same `insert_events` call -- still the one write path into
    `events`. Before calling `derive_settlements`, this function also
    computes each referenced position's own `derive_position_state`
    (`ledger/positions.py`) from the whole-user `all_fills`/`existing`
    already in hand, and hands the result in as `closed_positions` (CR-02,
    `07-REVIEW.md`) -- a leg whose position was already closed by real
    fills before its own expiry must never mint a SETTLEMENT, or the
    derived `closed_at` would silently move from the real close date to
    the leg's nominal expiry.

    Idempotency (LEDGER-09, widened by D7-05/Pitfall 2): before inserting,
    reads existing `events` for the user and builds the set of
    already-stored `(position_id, event_type, event_time, fill_ids_hash)`
    4-tuples, then inserts only the drafts whose tuple is absent. The key
    widened from a 3-tuple to include `event_time` because a SETTLEMENT's
    `fill_ids_hash` is always `None` (D7-05) and `events` carries no
    `leg_id` column -- two legs of one position would otherwise produce an
    identical 3-tuple and the second leg's SETTLEMENT would be silently
    skipped as "already exists" on the very first sync. Adding
    `event_time` is redundant-but-harmless for OPEN/CLOSE, where it is
    already fully determined by the fill group that produced a given
    `fill_ids_hash` (LEDGER-09), and load-bearing for SETTLEMENT.

    This is read-compare-skip, not delete-then-reinsert, for two recorded
    reasons: migration 0008 grants `events` no `UPDATE` at all, and a
    two-step wipe-then-reingest is not atomic across the step boundary,
    so a crash between the delete and the insert would leave the scope
    with zero events rather than stale-but-present ones (L069, L005).

    Honest limit: a draft whose `position_id`, `event_type` and
    `event_time` already exist under a *different* hash is inserted as a
    second row rather than replacing the first, because correcting a
    stored event would need a delete-then-reinsert this phase
    deliberately does not own. Fills are immutable, so this phase cannot
    reach that path; naming it here is what stops a later reader from
    assuming it was handled.

    Concurrency (CR-02, `05-REVIEW.md`): takes this user's own
    `pg_advisory_xact_lock` before the read-compare-skip window below, the
    same per-user-lock shape `vendor/connections.py::schwab_client_for_user`
    already uses for the identical class of race (`CLAUDE.md`'s own
    "per-user single-writer lock" constraint). Transaction-scoped, so it
    releases on the caller's own commit or rollback -- no separate unlock
    to forget. Without it, two overlapping calls for the same user could
    both read the same `existing_triples` under read-committed isolation
    and both insert, duplicating an OPEN or CLOSE event.
    """
    # Local import: `ledger/settlements.py` imports `parse_occ_symbol` from
    # this module, so a module-level import here would be circular. Same
    # precedent as `db/models.py`'s constructor sentinels (`ledger/events.py`'s
    # own docstring).
    from morai.ledger.settlements import derive_settlements, read_legs

    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
        {"uid": str(user_id)},
    )

    resolutions = await resolve_fill_positions(session, user_id)
    # `all_fills` stays whole-user, unnarrowed by `order_ids` -- CR-02's
    # closed-position gate (below) needs every fill a position has, not
    # only the subset a narrow resync happens to be scoped to, or a leg
    # closed by a fill outside that scope would read as still open.
    all_fills = await read_fills(session, user_id)
    fills = all_fills
    if order_ids is not None:
        wanted = set(order_ids)
        fills = [fill for fill in fills if fill.order_id in wanted]

    derivation = derive_events(fills, resolutions)

    existing = await read_events(session, user_id)
    existing_keys = {
        (record.position_id, record.event_type, record.event_time, record.fill_ids_hash)
        for record in existing
    }

    drafts = [
        EventWrite(
            position_id=event.position_id,
            event_type=event.event_type.value,
            event_time=event.event_time,
            fill_ids_hash=event.fill_ids_hash,
            open_debit_usd=event.open_debit_usd,
            close_credit_usd=event.close_credit_usd,
            rolled_from_position_id=event.rolled_from_position_id,
        )
        for event in derivation.events
        if (
            event.position_id,
            event.event_type.value,
            event.event_time,
            event.fill_ids_hash,
        )
        not in existing_keys
    ]

    if as_of is not None:
        # `derive_settlements` already excludes any leg whose
        # `(position_id, event_time)` matches an existing SETTLEMENT row in
        # `existing` (D7-06) -- no second idempotency check needed here.
        legs = await read_legs(session, user_id)

        # CR-02 (`07-REVIEW.md`): compute each referenced position's own
        # derived closed state from the same fills/events already read
        # above, and pass it to `derive_settlements` rather than letting
        # it query -- the function stays pure (D7-06); this shell owns
        # the one DB read each of its inputs needs.
        from morai.ledger.positions import LegRow, derive_position_state

        legs_by_position: dict[UUID, list[LegRow]] = {}
        for leg in legs:
            legs_by_position.setdefault(leg.position_id, []).append(
                LegRow(
                    id=leg.id,
                    position_id=leg.position_id,
                    occ_symbol=leg.occ_symbol,
                )
            )

        fills_by_position: dict[UUID, list[FillRecord]] = {}
        for fill in all_fills:
            position_id = resolutions.get(
                (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)
            )
            if position_id is not None:
                fills_by_position.setdefault(position_id, []).append(fill)

        events_by_position: dict[UUID, list[EventRecord]] = {}
        for record in existing:
            events_by_position.setdefault(record.position_id, []).append(record)

        closed_positions: dict[UUID, bool | None] = {
            position_id: derive_position_state(
                position_id,
                position_legs,
                fills_by_position.get(position_id, []),
                events_by_position.get(position_id, []),
            ).is_closed
            for position_id, position_legs in legs_by_position.items()
        }

        settlement_drafts = derive_settlements(
            legs, existing, as_of=as_of, closed_positions=closed_positions
        )
        drafts.extend(
            EventWrite(
                position_id=draft.position_id,
                event_type=EventType.SETTLEMENT.value,
                event_time=draft.event_time,
                fill_ids_hash=None,
                open_debit_usd=None,
                close_credit_usd=None,
                leg_id=draft.leg_id,
            )
            for draft in settlement_drafts
        )

    if drafts:
        await insert_events(session, user_id, drafts)

    return derivation


# --- detect_roll: the ROLL predicate, negative-only through Phase 5, ------
# --- given its first caller by _roll_pairs in Phase 7 (D5-01, D7-09) ------
#
# Inverts `tests/ledger/oracle_seed.py::occ_symbol_for`'s own stated
# convention: root ("SPXW" or "SPX" -- this project's two roots, tried
# longest-first so "SPXW" is never mistaken for "SPX" plus a stray "W"),
# then six digits of YYMMDD, then a single option-type letter, then eight
# digits of strike in thousandths.
_OCC_SYMBOL_RE = re.compile(
    r"^(?P<root>SPXW|SPX)"
    r"(?P<yy>\d{2})(?P<mm>\d{2})(?P<dd>\d{2})"
    r"(?P<option_type>[A-Z])"
    r"(?P<strike>\d{8})$"
)


@dataclass(frozen=True)
class OccContract:
    """One OCC-convention option contract, parsed from its symbol."""

    root: str
    expiry: date
    option_type: str
    strike: Decimal


def parse_occ_symbol(occ_symbol: str) -> OccContract:
    """Inverts `occ_symbol_for`'s own stated convention exactly: root,
    then six digits of `YYMMDD`, then a single option-type letter, then
    eight digits of strike in thousandths. Divides the strike by
    `Decimal(1000)`, never a float (D3-17). Raises `ValueError` naming the
    offending symbol when the shape does not match -- a malformed
    contract is a gap and a gap is honest, never a guess (`NN-16`)."""
    match = _OCC_SYMBOL_RE.match(occ_symbol)
    if match is None:
        raise ValueError(f"malformed OCC symbol: {occ_symbol!r}")
    try:
        expiry = date(
            2000 + int(match.group("yy")),
            int(match.group("mm")),
            int(match.group("dd")),
        )
    except ValueError as exc:
        raise ValueError(f"malformed OCC symbol: {occ_symbol!r}") from exc
    strike = Decimal(match.group("strike")) / Decimal(1000)
    return OccContract(
        root=match.group("root"),
        expiry=expiry,
        option_type=match.group("option_type"),
        strike=strike,
    )


def detect_roll(closing: FillRecord, opening: FillRecord) -> bool:
    """D5-01's negative guard only. Returns True only when every part of
    the strict requirement holds: the two fills share an `order_id`, the
    first is classified CLOSE and the second OPEN from their own
    `position_effect` values, their parsed contracts share a root, a
    strike and an option type, and their expiries differ. Anything else
    is False.

    Per D5-01 this shipped as the negative guard only, Phase 5: proved
    False on the one real order that shares a broker order across two
    calendars (`1006797510202`, closing `60c46a57` at strike 7425 and
    opening `24f1e72e` at strike 7475), with no positive ROLL derivation
    that phase because the oracle contains no ROLL and no SETTLE at all.
    Building the positive path then, verified only against fixtures
    written by the same reasoning that wrote the code, would have
    reproduced the exact conditions of the -$319,850 loss. `insert_events`
    already refuses a ROLL missing either amount and migration 0008's
    `roll_has_both_legs` CHECK is the database-level backstop; this
    predicate is the third guard and the only one that runs before a
    draft is built.

    Phase 7 (D7-09) gives this predicate its first caller: `_roll_pairs`
    calls it, unmodified, to find every candidate ROLL before
    `derive_events`'s ordinary OPEN/CLOSE grouping runs. What changed is
    only that a caller now exists -- the predicate's own logic is
    untouched, and the money it enables is priced by
    `_signed_leg_amount`/`_net_amount`, the same oracle-proven functions,
    also unmodified. That is the condition D7-09 resolves the deferral
    on: no new arithmetic, only a new caller for an already-strict guard.

    Known, documented limitation (WR-02, `07-REVIEW.md`), stated fully in
    `_roll_pairs`'s own docstring: because this predicate matches purely
    on `(root, strike, option_type)`, a single-order roll of *both* legs
    of one calendar (which share all three) is undetectable -- each
    closing fill matches two opening candidates, `_roll_pairs`'s
    ambiguity rule correctly refuses to guess between them, and neither
    leg forms a ROLL at all. Deliberate per NN-11, not a bug.
    """
    if closing.order_id != opening.order_id:
        return False
    if classify_fill(closing.position_effect) is not FillRole.CLOSE:
        return False
    if classify_fill(opening.position_effect) is not FillRole.OPEN:
        return False
    closing_contract = parse_occ_symbol(closing.occ_symbol)
    opening_contract = parse_occ_symbol(opening.occ_symbol)
    if closing_contract.root != opening_contract.root:
        return False
    if closing_contract.option_type != opening_contract.option_type:
        return False
    if closing_contract.strike != opening_contract.strike:
        return False
    return closing_contract.expiry != opening_contract.expiry
