"""Task 1: hard case 1, both layers -- the shared front leg
(`salvage/oracle-fixtures.md`'s "Hard case 1" section) and the read that
must not narrow (`L061`).

`8a63aa81` and `6303e6af` share the identical front contract
`SPXW260618P07275000`. Layer one proves the order-anchor disambiguation
resolves both calendars to their own correct figures under an unscoped
sweep. Layer two proves the harder claim -- the one that actually reached
production -- by replaying the real processing order (positions
descending by `opened_at`, which puts `8a63aa81` before `6303e6af`) and
deriving each position scoped to only its own two order ids, proving the
resolution read stays whole-user even when the derivation itself is
scoped. This module also proves the negative case (two positions sharing
BOTH legs stay explicitly unresolved, `NN-11`) and cross-user isolation
(T-05-02) on the identical shared symbol.

`pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import EventRecord, read_events
from morai.ledger.pairing import EventType, sync_events
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.oracle_seed import ORACLE_CALENDARS, ORACLE_FILLS, seed_oracle
from tests.ledger.test_plaintext_queries import (
    _seed_unresolvable_order,  # pyright: ignore[reportPrivateUsage]  # why: reusing test_plaintext_queries.py's own negative-control seed helper for the identical NN-11 claim, not reinventing it -- the leading underscore is a test-internal convention, not a real access boundary between two files in the same suite.
)

# Re-exported, not merely imported -- pytest resolves these by name lookup
# in this module's namespace, mirroring every other ledger test module's
# own convention.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `tests/test_isolation.py`'s own `_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


def _event(
    records: list[EventRecord], position_id: UUID, event_type: str
) -> EventRecord:
    return next(
        r
        for r in records
        if r.position_id == position_id and r.event_type == event_type
    )


async def test_unscoped_sweep_resolves_both_shared_front_leg_calendars_correctly(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Layer one. Without order-anchor resolution, `8a63aa81` would read
    back its unique back leg alone at 62.50 -- so the assertion that
    distinguishes the fix from the bug is the 10.20, not merely the
    absence of an error."""
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["8a63aa81", "6303e6af"],
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 4

    records = await read_events(app_db_session, provisioned_users.user_a)
    assert len(records) == 4

    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    cal_6303e6af = next(c for c in ORACLE_CALENDARS if c.calendar_id == "6303e6af")

    open_8a63aa81 = _event(records, position_ids["8a63aa81"], "OPEN")
    close_8a63aa81 = _event(records, position_ids["8a63aa81"], "CLOSE")
    open_6303e6af = _event(records, position_ids["6303e6af"], "OPEN")
    close_6303e6af = _event(records, position_ids["6303e6af"], "CLOSE")

    assert open_8a63aa81.open_debit_usd == cal_8a63aa81.open_net_debit
    assert close_8a63aa81.close_credit_usd == cal_8a63aa81.close_net_credit
    assert open_6303e6af.open_debit_usd == cal_6303e6af.open_net_debit
    assert close_6303e6af.close_credit_usd == cal_6303e6af.close_net_credit


async def test_per_position_replay_in_real_processing_order_converges_with_zero_orphans(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Layer two -- the one that actually reached production. The real
    mechanism was a per-calendar rebuild that read fills scoped to one
    calendar's own legs, so rebuilding `8a63aa81` never fetched the
    sibling `6303e6af`'s unique back leg -- no anchor to work with even
    with the disambiguation logic correctly written (`L061`).

    `sync_events`'s resolution read (`resolve_fill_positions`) is
    whole-user by construction and only narrows by `order_ids` afterward,
    in Python -- so the sibling calendar's unique back leg stays visible
    even when the derivation itself is scoped to one calendar's own two
    orders. This test replays the real processing order (positions
    descending by `opened_at`, which the fixture dates put as `8a63aa81`
    before `6303e6af`) and asserts both still converge. A future change
    that narrows `RESOLVE_FILL_POSITIONS_SQL`'s `position_legs` CTE to one
    position's own legs is exactly hard case 1's second layer, and it is
    what the real production correction script did -- this test turns red
    the moment that happens.
    """
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["8a63aa81", "6303e6af"],
    )

    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT id FROM positions WHERE id IN (:a, :b) ORDER BY opened_at DESC"
            ),
            {"a": position_ids["8a63aa81"], "b": position_ids["6303e6af"]},
        )
    ).all()
    ordered_position_ids = [_UUID.validate_python(row[0]) for row in rows]
    # Fails loudly if the fixture dates ever change, rather than silently
    # proving a weaker thing.
    assert ordered_position_ids == [
        position_ids["8a63aa81"],
        position_ids["6303e6af"],
    ]

    position_id_to_calendar = {v: k for k, v in position_ids.items()}

    async def _replay_once() -> None:
        for position_id in ordered_position_ids:
            calendar_id = position_id_to_calendar[position_id]
            order_ids = {
                fill.order_id
                for fill in ORACLE_FILLS
                if fill.calendar_id == calendar_id
            }
            derivation = await sync_events(
                app_db_session, provisioned_users.user_a, order_ids=order_ids
            )
            assert derivation.unresolved == ()

    await _replay_once()

    first_records = await read_events(app_db_session, provisioned_users.user_a)
    assert len(first_records) == 4
    first_hashes = {record.fill_ids_hash for record in first_records}
    assert len(first_hashes) == 4

    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    cal_6303e6af = next(c for c in ORACLE_CALENDARS if c.calendar_id == "6303e6af")
    assert (
        _event(first_records, position_ids["8a63aa81"], "OPEN").open_debit_usd
        == cal_8a63aa81.open_net_debit
    )
    assert (
        _event(first_records, position_ids["8a63aa81"], "CLOSE").close_credit_usd
        == cal_8a63aa81.close_net_credit
    )
    assert (
        _event(first_records, position_ids["6303e6af"], "OPEN").open_debit_usd
        == cal_6303e6af.open_net_debit
    )
    assert (
        _event(first_records, position_ids["6303e6af"], "CLOSE").close_credit_usd
        == cal_6303e6af.close_net_credit
    )

    # Idempotence under the same replay: repeat it a second time and
    # assert the events row count and the set of fill_ids_hash values are
    # unchanged.
    await _replay_once()

    second_records = await read_events(app_db_session, provisioned_users.user_a)
    assert len(second_records) == len(first_records)
    assert {record.fill_ids_hash for record in second_records} == first_hashes


async def test_two_positions_sharing_both_legs_leave_fills_explicitly_unresolved(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The negative case (`NN-11`, T-05-03). Two positions sharing BOTH
    leg symbols and one order filling both -- neither symbol nor the
    order has a unique anchor, so both fills stay unresolved and zero
    events exist. An unresolved fill is a recorded fact, not an error."""
    await _seed_unresolvable_order(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    assert len(derivation.unresolved) == 2
    assert derivation.events == ()

    records = await read_events(app_db_session, provisioned_users.user_a)
    assert records == []


async def test_cross_user_derivation_never_resolves_to_the_other_users_position(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """T-05-03. User A's `8a63aa81` and user B's `6303e6af` both carry a
    leg on the identical shared front symbol -- a resolution query missing
    its `user_id` predicate would cross them."""
    position_ids_a = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["8a63aa81"],
    )
    position_ids_b = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_b,
        calendar_ids=["6303e6af"],
    )

    # seed_oracle's own insert_fills call last set this session's RLS
    # context to user B; reset it explicitly before deriving for user A --
    # RLS enforces app.current_user_id regardless of this query's own
    # bound parameter.
    await _set_current_user(app_db_session, provisioned_users.user_a)

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    assert derivation.unresolved == ()
    assert len(derivation.events) == 2
    for event in derivation.events:
        assert event.position_id == position_ids_a["8a63aa81"]
        assert event.position_id != position_ids_b["6303e6af"]

    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    open_event = next(e for e in derivation.events if e.event_type is EventType.OPEN)
    close_event = next(e for e in derivation.events if e.event_type is EventType.CLOSE)
    assert open_event.open_debit_usd == cal_8a63aa81.open_net_debit
    assert close_event.close_credit_usd == cal_8a63aa81.close_net_credit
