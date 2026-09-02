"""The campaign-chain read model (D7-11, LEDGER-10, ROADMAP criterion 4's
read half): a thin wrapper over the `campaign_chain` view migration 0014
created. This module holds no state and reimplements no recursion -- the
chain-walking lives entirely in the view's own `WITH RECURSIVE` body;
`read_campaign_chain`/`read_campaign_for_position` below only select from
it and narrow the untyped `text()` result through `TypeAdapter`, the same
boundary discipline `pairing.py`'s `RESOLVE_FILL_POSITIONS_SQL`/
`resolve_fill_positions` already established.

D7-11 rejected a materialized view specifically because a second stored
copy of the campaign chain is the exact drift LEDGER-10 exists to prevent
(calendar `65aac62e`, the same reasoning that dropped
`positions.opened_at`/`closed_at`, ROADMAP criterion 1). Acquiring a
stored copy later, for performance, is a decision that has to be taken
explicitly -- nothing here does it implicitly.

`campaign_chain` carries `WITH (security_invoker = true)` (migration
0014), so the querying role's own RLS context is what actually filters --
`READ_CAMPAIGN_CHAIN_SQL`'s explicit `WHERE p.user_id = :user_id` is the
second belt (`resolve_fill_positions`'s own both-belts discipline), not
the first.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `pairing.py`/`events.py`/`positions.py` already established.
# `TypeAdapter` narrows it (D-06), never `cast`.
_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)
_INT: TypeAdapter[int] = TypeAdapter(int)

# The view itself carries no `user_id` column -- the recursion walks
# `events`/`positions` only -- so the explicit scope here joins to
# `positions`. Ordered by `(campaign_root_id, depth)` so two runs are
# comparable row-for-row (criterion 4's own drop-and-recompute claim).
READ_CAMPAIGN_CHAIN_SQL = """
SELECT cc.campaign_root_id, cc.position_id, cc.depth
FROM campaign_chain cc
JOIN positions p ON p.id = cc.position_id
WHERE p.user_id = :user_id
ORDER BY cc.campaign_root_id, cc.depth
"""

# No `user_id` bind: the view's own `security_invoker` clause is what
# scopes this to the caller's own rows -- callers pass a session whose
# `app.current_user_id` is already set, the same convention
# `read_position_state` (`ledger/positions.py`) follows.
READ_CAMPAIGN_FOR_POSITION_SQL = """
SELECT cc.campaign_root_id, cc.position_id, cc.depth
FROM campaign_chain cc
WHERE cc.campaign_root_id = (
    SELECT inner_cc.campaign_root_id FROM campaign_chain inner_cc
    WHERE inner_cc.position_id = :position_id
)
ORDER BY cc.campaign_root_id, cc.depth
"""


@dataclass(frozen=True)
class CampaignLink:
    """One position's place in its campaign chain."""

    campaign_root_id: UUID
    position_id: UUID
    depth: int


async def read_campaign_chain(
    session: AsyncSession, user_id: UUID
) -> list[CampaignLink]:
    """Every campaign chain link for `user_id`, computed from events via
    the `campaign_chain` view -- nothing here stores a copy (D7-11).

    The view carries `security_invoker = true` (migration 0014), so the
    session's own RLS context (`app.current_user_id`) is what actually
    filters this to the caller's own rows; the `WHERE p.user_id =
    :user_id` clause in `READ_CAMPAIGN_CHAIN_SQL` is the second belt, not
    the first -- `resolve_fill_positions`'s own both-belts discipline
    (`ledger/pairing.py`).
    """
    rows = (
        await session.execute(text(READ_CAMPAIGN_CHAIN_SQL), {"user_id": user_id})
    ).all()
    return [
        CampaignLink(
            campaign_root_id=_UUID.validate_python(row[0]),
            position_id=_UUID.validate_python(row[1]),
            depth=_INT.validate_python(row[2]),
        )
        for row in rows
    ]


async def read_campaign_for_position(
    session: AsyncSession, position_id: UUID
) -> list[CampaignLink]:
    """The whole campaign chain containing `position_id`, from any member
    -- not only the suffix from that position (D7-10: the ROLL row hangs
    on the newly opened position, so the newest position is a chain's own
    head, and a reader may ask from any member). Returns an empty list
    when `position_id` is not itself visible in `campaign_chain` under the
    caller's own RLS context (a position in another user's chain, or one
    that does not exist) -- RLS is the only scope here; there is no
    explicit `user_id` bind because this function is never handed one.
    """
    rows = (
        await session.execute(
            text(READ_CAMPAIGN_FOR_POSITION_SQL), {"position_id": position_id}
        )
    ).all()
    return [
        CampaignLink(
            campaign_root_id=_UUID.validate_python(row[0]),
            position_id=_UUID.validate_python(row[1]),
            depth=_INT.validate_python(row[2]),
        )
        for row in rows
    ]
