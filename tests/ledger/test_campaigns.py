"""The campaign-chain read model (D7-11, LEDGER-10, ROADMAP criterion 4's
read half). Task 1 proves `read_campaign_chain`/`read_campaign_for_position`
walk the `campaign_chain` view correctly -- roots, depths, independent
chains, and the native `CYCLE` guard. Task 2 proves the two hardest claims:
criterion 4's literal drop-and-recompute equivalence, and Pitfall 1's
behavioural cross-user isolation, with its own negative control.

Every chain here is seeded through `insert_events` (the one write path),
never raw SQL -- the ROLL CHECK guards are part of what makes a seeded
chain trustworthy the same way a production chain would be. Amounts are
synthetic `Decimal`s (D7-13).

`@pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

import importlib.util
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Position
from morai.ledger.campaigns import (
    CampaignLink,
    read_campaign_chain,
    read_campaign_for_position,
)
from morai.ledger.events import EventWrite, insert_events
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- pytest resolves these by name lookup
# in this module's namespace, the same convention every other ledger test
# module in this project already follows.
__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

# `text()` results type every column as `Any` -- same untyped-boundary
# shape `pairing.py`/`events.py` already established. `TypeAdapter` narrows
# it (D-06), never `cast`.
_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)
_STR: TypeAdapter[str] = TypeAdapter(str)

_EVENT_TIME = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)

_MIGRATION_0014_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "0014_derived_position_state_and_campaign_chain.py"
)

# No `WHERE` clause -- routing through `read_campaign_chain` would
# reintroduce the explicit `user_id` filter that is this test file's own
# second belt (`campaigns.py`'s module docstring), which would make Test 7
# below prove nothing about the view's own `security_invoker` behaviour.
_CROSS_TENANT_CAMPAIGN_SELECT = text(
    "SELECT campaign_root_id, position_id, depth FROM campaign_chain"
)


def _load_migration_0014() -> ModuleType:
    """Loads migration 0014 by file path -- module names in
    `alembic/versions/` start with a digit, so a normal `import` statement
    cannot name them. Used by the recompute test (criterion 4) to re-issue
    the migration's own `CREATE VIEW` statement verbatim, so a future edit
    to the migration cannot leave this test silently comparing against a
    stale copy."""
    spec = importlib.util.spec_from_file_location(
        "morai_migration_0014", _MIGRATION_0014_PATH
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `tests/test_isolation.py`/`test_roll_check_constraint.py`'s
    own `_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _create_bare_position(session: AsyncSession, user_id: UUID) -> UUID:
    """A position with no legs -- `campaign_chain` only depends on
    `positions.id` and `events.rolled_from_position_id`, mirroring
    `test_roll_check_constraint.py`'s own bare-position precedent (no
    dedicated write path for a leg-less position exists this phase)."""
    return (
        await session.execute(
            insert(Position).values(user_id=user_id).returning(Position.id)
        )
    ).scalar_one()


async def _seed_chain(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    user_id: UUID,
    length: int,
) -> list[UUID]:
    """`length` bare positions for `user_id`, chained root-to-newest by
    `length - 1` ROLL events through `insert_events` -- the one write
    path. Returns position ids in root-to-newest order; index 0 is the
    chain's own root (the position no ROLL event ever targets)."""
    position_ids = [
        await _create_bare_position(superuser_db_session, user_id)
        for _ in range(length)
    ]
    await superuser_db_session.commit()

    if length > 1:
        await _set_current_user(app_db_session, user_id)
        await insert_events(
            app_db_session,
            user_id,
            [
                EventWrite(
                    position_id=position_ids[i],
                    event_type="ROLL",
                    event_time=_EVENT_TIME + timedelta(days=i),
                    fill_ids_hash=None,
                    open_debit_usd=Decimal("100.00"),
                    close_credit_usd=Decimal("90.00"),
                    rolled_from_position_id=position_ids[i - 1],
                )
                for i in range(1, length)
            ],
        )
        await app_db_session.commit()
    return position_ids


# --- Task 1: the read wrapper itself -----------------------------------


async def test_three_position_chain_returns_depths_0_1_2_at_one_root(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_ids = await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=3
    )

    await _set_current_user(app_db_session, provisioned_users.user_a)
    chain = await read_campaign_chain(app_db_session, provisioned_users.user_a)

    assert chain == [
        CampaignLink(
            campaign_root_id=position_ids[0], position_id=position_ids[0], depth=0
        ),
        CampaignLink(
            campaign_root_id=position_ids[0], position_id=position_ids[1], depth=1
        ),
        CampaignLink(
            campaign_root_id=position_ids[0], position_id=position_ids[2], depth=2
        ),
    ]


async def test_position_with_no_roll_anywhere_is_its_own_campaign_at_depth_0(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_ids = await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=1
    )

    await _set_current_user(app_db_session, provisioned_users.user_a)
    chain = await read_campaign_chain(app_db_session, provisioned_users.user_a)

    assert chain == [
        CampaignLink(
            campaign_root_id=position_ids[0], position_id=position_ids[0], depth=0
        )
    ]


async def test_two_independent_chains_for_one_user_never_interleave(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    chain_one = await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=2
    )
    chain_two = await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=2
    )

    await _set_current_user(app_db_session, provisioned_users.user_a)
    chain = await read_campaign_chain(app_db_session, provisioned_users.user_a)

    roots = {link.campaign_root_id for link in chain}
    assert roots == {chain_one[0], chain_two[0]}
    for link in chain:
        expected_members = (
            chain_one if link.campaign_root_id == chain_one[0] else chain_two
        )
        assert link.position_id in expected_members


async def test_read_campaign_for_position_from_any_member_returns_the_whole_chain(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_ids = await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=3
    )
    await _set_current_user(app_db_session, provisioned_users.user_a)

    for position_id in position_ids:
        chain = await read_campaign_for_position(app_db_session, position_id)
        assert {link.position_id for link in chain} == set(position_ids)
        assert {link.depth for link in chain} == {0, 1, 2}


async def test_cyclic_chain_terminates_instead_of_hanging(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """`p0` is a genuine root; `p1`/`p2` form the mutual loop (T-07-18). A
    pure two-position mutual pair -- each the target of the other's ROLL
    -- is never reachable at all: the view's base case excludes any
    position that is ever a ROLL target, so without `p0` leading in, no
    recursion would ever begin and this test would pass vacuously
    regardless of whether `CYCLE` actually works. `p0` is what makes this
    a real proof of the guard rather than an accidental one."""
    user_id = provisioned_users.user_a
    p0 = await _create_bare_position(superuser_db_session, user_id)
    p1 = await _create_bare_position(superuser_db_session, user_id)
    p2 = await _create_bare_position(superuser_db_session, user_id)
    await superuser_db_session.commit()

    await _set_current_user(app_db_session, user_id)
    await insert_events(
        app_db_session,
        user_id,
        [
            EventWrite(
                position_id=p1,
                event_type="ROLL",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=Decimal("100.00"),
                close_credit_usd=Decimal("90.00"),
                rolled_from_position_id=p0,
            ),
            EventWrite(
                position_id=p2,
                event_type="ROLL",
                event_time=_EVENT_TIME + timedelta(days=1),
                fill_ids_hash=None,
                open_debit_usd=Decimal("100.00"),
                close_credit_usd=Decimal("90.00"),
                rolled_from_position_id=p1,
            ),
            EventWrite(
                position_id=p1,
                event_type="ROLL",
                event_time=_EVENT_TIME + timedelta(days=2),
                fill_ids_hash=None,
                open_debit_usd=Decimal("100.00"),
                close_credit_usd=Decimal("90.00"),
                rolled_from_position_id=p2,
            ),
        ],
    )
    await app_db_session.commit()

    started = time.monotonic()
    chain = await read_campaign_chain(app_db_session, user_id)
    elapsed = time.monotonic() - started

    assert elapsed < 10.0
    assert len(chain) == 4
    assert [link.position_id for link in chain].count(p1) == 2


# --- Task 2: the two proofs ----------------------------------------------


async def test_recompute_from_events_matches_original_row_for_row(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Criterion 4, taken literally (D7-11): drop the view, re-issue the
    migration's own `CREATE VIEW` statement, and assert the recomputed
    chain equals the original row-for-row. Restores the view in a
    `finally` -- a failure here must not leave the rest of the db-marked
    suite running against a missing view."""
    await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=3
    )
    await _set_current_user(app_db_session, provisioned_users.user_a)
    chain_before = await read_campaign_chain(app_db_session, provisioned_users.user_a)

    migration = _load_migration_0014()
    view_sql = _STR.validate_python(migration._CAMPAIGN_CHAIN_VIEW_SQL)  # pyright: ignore[reportPrivateUsage]  # why: re-issuing the migration's own CREATE VIEW verbatim (criterion 4), not retyping it, so a future edit to the migration cannot leave this test comparing against a stale copy.

    await superuser_db_session.execute(text("DROP VIEW campaign_chain"))
    view_restored = False
    try:
        await superuser_db_session.execute(text(view_sql))
        await superuser_db_session.execute(
            text("GRANT SELECT ON campaign_chain TO morai_app")
        )
        await superuser_db_session.commit()
        view_restored = True

        chain_after = await read_campaign_chain(
            app_db_session, provisioned_users.user_a
        )
        assert chain_after == chain_before
    finally:
        if not view_restored:
            await superuser_db_session.rollback()
            await superuser_db_session.execute(text(view_sql))
            await superuser_db_session.execute(
                text("GRANT SELECT ON campaign_chain TO morai_app")
            )
            await superuser_db_session.commit()

    row = (
        await superuser_db_session.execute(
            text(
                "SELECT count(*) FROM pg_class WHERE relname = 'campaign_chain' "
                "AND relkind = 'v'"
            )
        )
    ).one()
    assert row[0] == 1


async def test_campaign_view_respects_rls(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Pitfall 1's behavioural proof -- the single highest-severity check
    in this phase (T-07-17). A view created by the migration's superuser
    applies the *owner's* privileges by default, and the owner carries
    `rolbypassrls`; without `security_invoker = true` (migration 0014)
    this query would return every row of user_a's chain to user_b, past a
    green single-user test suite that never noticed."""
    await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=3
    )

    await _set_current_user(app_db_session, provisioned_users.user_b)
    rows = (await app_db_session.execute(_CROSS_TENANT_CAMPAIGN_SELECT)).all()
    assert rows == []


async def test_campaign_view_returns_own_chain_not_vacuously_empty(
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The negative control on `test_campaign_view_respects_rls`. Without
    this, a view returning nothing to anyone -- a broken join, a wrong
    column -- would pass the isolation test above while being entirely
    useless."""
    await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_a, length=2
    )
    position_ids_b = await _seed_chain(
        superuser_db_session, app_db_session, provisioned_users.user_b, length=2
    )

    await _set_current_user(app_db_session, provisioned_users.user_b)
    rows = (await app_db_session.execute(_CROSS_TENANT_CAMPAIGN_SELECT)).all()
    assert rows != []
    position_ids = {_UUID.validate_python(row[1]) for row in rows}
    assert position_ids == set(position_ids_b)
