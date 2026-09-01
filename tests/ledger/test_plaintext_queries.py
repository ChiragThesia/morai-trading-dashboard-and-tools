"""Criterion 2's two required proofs: the shared-front-leg disambiguation
query and the reconciliation window query, executed against real Postgres,
seeded with real oracle data, using only the plaintext-by-design column
set (D3-02, CRYPT-03).

Both queries are `03-RESEARCH.md`'s Code Examples queries, already proven
against real oracle data during research. Query 1's `position_legs` CTE is
adapted here to select over `legs` (this schema's real table) rather than
the scratch schema's `front_occ_symbol`/`back_occ_symbol` position
columns research used -- the one required adaptation the plan names.

Task 1's seeding proof (`test_seed_oracle_produces_...`) lives in this
module rather than a file of its own, per this plan's own instruction:
the seed helper's correctness is exactly what these queries depend on.

`@pytest.mark.db` -- runs only where Postgres is reachable.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Leg, Position
from morai.ledger.events import EventWrite, insert_events, read_events
from morai.ledger.fills import FillWrite, insert_fills, read_fills
from morai.ledger.pairing import RESOLVE_FILL_POSITIONS_SQL
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.oracle_seed import (
    ORACLE_CALENDARS,
    ORACLE_FILLS,
    occ_symbol_for,
    seed_oracle,
)

__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape this codebase's other db-marked tests already established.
# `TypeAdapter` narrows at that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)
_STR: TypeAdapter[str] = TypeAdapter(str)
_DATETIME: TypeAdapter[datetime] = TypeAdapter(datetime)
_UUID_OR_NONE: TypeAdapter[UUID | None] = TypeAdapter(UUID | None)

# --- Query 1: shared-front-leg disambiguation (order-anchor resolution, --
# Rule 3 of salvage/oracle-fixtures.md). Promoted to
# `morai.ledger.pairing.RESOLVE_FILL_POSITIONS_SQL` (05-01) -- this module
# now proves that production constant rather than a private copy.

# --- Query 2: reconciliation window (row selection only; the sum happens
# in Python after decrypt, D3-04). Unchanged from 03-RESEARCH.md's Code
# Examples -- `events` already matched the real schema.
_RECONCILIATION_WINDOW_QUERY = """
SELECT user_id, position_id, event_type, event_time
FROM events
WHERE user_id = :user_id
  AND event_time >= :window_start
  AND event_time <  :window_end
ORDER BY event_time
"""

_WINDOW_START = datetime(2026, 6, 1, tzinfo=UTC)
_WINDOW_END = datetime(2026, 7, 1, tzinfo=UTC)

# Two positions sharing BOTH leg symbols, so neither symbol nor the order
# has a unique anchor -- the negative control for "leave unresolved rather
# than guess" (NN-11, LEDGER-03). Dates far outside any real oracle
# calendar so a collision with real data is structurally impossible.
_SYNTH_SYM_A = "SPXW261231P09999000"
_SYNTH_SYM_B = "SPXW261231P09998000"
_SYNTH_ORDER_ID = "SYNTH-UNRESOLVABLE-0000000001"
_SYNTH_TIME = datetime(2026, 12, 1, 12, 0, tzinfo=UTC)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `tests/test_isolation.py`/`test_tracer_encrypted_fill.py`'s
    own `_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _bytea_column_names(session: AsyncSession) -> set[str]:
    """Every `bytea` column across the schema -- ciphertext, nonce, and
    wrapped-key columns alike (T-03-29). Derived from
    `information_schema.columns` rather than hard-coded, so a column added
    later is covered automatically without anyone remembering to update
    this list."""
    rows = (
        await session.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND data_type = 'bytea'"
            )
        )
    ).all()
    return {_STR.validate_python(row[0]) for row in rows}


async def _seed_unresolvable_order(
    superuser_session: AsyncSession,
    app_session: AsyncSession,
    user_id: UUID,
) -> None:
    """Two positions, each with front=`_SYNTH_SYM_A`/back=`_SYNTH_SYM_B` --
    identical symbol pairs, so no leg is unique to either position. One
    order fills both symbols; neither has a unique anchor, so the order
    itself has none. Proves the disambiguation query leaves a fill
    unresolved (NULL) rather than guessing when no single anchor exists.
    """
    for _ in range(2):
        position_id = (
            await superuser_session.execute(
                insert(Position).values(user_id=user_id).returning(Position.id)
            )
        ).scalar_one()
        await superuser_session.execute(
            insert(Leg).values(
                position_id=position_id,
                user_id=user_id,
                leg_role="front",
                occ_symbol=_SYNTH_SYM_A,
                root="SPXW",
            )
        )
        await superuser_session.execute(
            insert(Leg).values(
                position_id=position_id,
                user_id=user_id,
                leg_role="back",
                occ_symbol=_SYNTH_SYM_B,
                root="SPXW",
            )
        )
    await superuser_session.commit()

    await _set_current_user(app_session, user_id)
    await insert_fills(
        app_session,
        user_id,
        [
            FillWrite(
                order_id=_SYNTH_ORDER_ID,
                occ_symbol=_SYNTH_SYM_A,
                leg_index=0,
                execution_time=_SYNTH_TIME,
                position_effect="OPENING",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("1.00"),
            ),
            FillWrite(
                order_id=_SYNTH_ORDER_ID,
                occ_symbol=_SYNTH_SYM_B,
                leg_index=0,
                execution_time=_SYNTH_TIME,
                position_effect="OPENING",
                side="SELL",
                quantity=Decimal("1"),
                price_usd=Decimal("1.00"),
            ),
        ],
    )


async def _seed_reconciliation_events(
    app_session: AsyncSession,
    user_id: UUID,
    position_ids: dict[str, UUID],
) -> None:
    """OPEN/CLOSE events for calendars `8a63aa81` and `6303e6af`, with
    `event_time` set to each calendar's own real OPEN/CLOSE order date and
    amounts taken from the oracle's own recorded `openNetDebit`/
    `closeNetCredit` -- nothing invented."""
    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    cal_6303e6af = next(c for c in ORACLE_CALENDARS if c.calendar_id == "6303e6af")
    await insert_events(
        app_session,
        user_id,
        [
            EventWrite(
                position_id=position_ids["8a63aa81"],
                event_type="OPEN",
                event_time=cal_8a63aa81.opened_at,
                fill_ids_hash=None,
                open_debit_usd=cal_8a63aa81.open_net_debit,
                close_credit_usd=None,
            ),
            EventWrite(
                position_id=position_ids["8a63aa81"],
                event_type="CLOSE",
                event_time=cal_8a63aa81.closed_at,
                fill_ids_hash=None,
                open_debit_usd=None,
                close_credit_usd=cal_8a63aa81.close_net_credit,
            ),
            EventWrite(
                position_id=position_ids["6303e6af"],
                event_type="OPEN",
                event_time=cal_6303e6af.opened_at,
                fill_ids_hash=None,
                open_debit_usd=cal_6303e6af.open_net_debit,
                close_credit_usd=None,
            ),
            EventWrite(
                position_id=position_ids["6303e6af"],
                event_type="CLOSE",
                event_time=cal_6303e6af.closed_at,
                fill_ids_hash=None,
                open_debit_usd=None,
                close_credit_usd=cal_6303e6af.close_net_credit,
            ),
        ],
    )


# --- Task 1: the oracle's fills enter through the one write path --------


async def test_seed_oracle_produces_52_fills_13_positions_26_legs(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await seed_oracle(superuser_db_session, app_db_session, provisioned_users.user_a)

    # Excludes `provisioned_users.position_a`/`position_b` -- `seeded_users`
    # (tests/identity/conftest.py) now seeds one stand-in `positions` row
    # per non-admin user in place of the retired probe rows (03-06 Task 1),
    # so a bare `COUNT(*)` would count 15, not 13. This test's own claim is
    # about what `seed_oracle` produces, not the fixture stack underneath.
    position_count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT COUNT(*) FROM positions WHERE id NOT IN (:pa, :pb)"),
                {
                    "pa": provisioned_users.position_a,
                    "pb": provisioned_users.position_b,
                },
            )
        ).scalar_one()
    )
    leg_count = _INT.validate_python(
        (
            await superuser_db_session.execute(text("SELECT COUNT(*) FROM legs"))
        ).scalar_one()
    )
    assert position_count == 13
    assert leg_count == 26

    records = await read_fills(app_db_session, provisioned_users.user_a)
    assert len(records) == 52

    # Every price reads back as the exact Decimal the fixture file
    # records, to the cent -- no float ever touched this round trip.
    by_key = {(record.order_id, record.occ_symbol): record for record in records}
    for fill in ORACLE_FILLS:
        assert by_key[(fill.order_id, fill.occ_symbol)].price_usd == fill.price_usd

    # The expected per-calendar debit/credit are exposed as data, ready
    # for Phase 5's oracle suite without re-transcribing.
    assert len(ORACLE_CALENDARS) == 13
    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    assert cal_8a63aa81.open_net_debit == Decimal("10.2")
    assert cal_8a63aa81.close_net_credit == Decimal("10.55")


# --- Task 2: both queries run in SQL against the plaintext set ----------


async def test_disambiguation_query_resolves_shared_front_leg_calendars(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["8a63aa81", "6303e6af"],
    )

    rows = (
        await app_db_session.execute(
            text(RESOLVE_FILL_POSITIONS_SQL),
            {"user_id": provisioned_users.user_a},
        )
    ).all()
    resolved: dict[tuple[str, str], UUID | None] = {
        (
            _STR.validate_python(row[0]),
            _STR.validate_python(row[1]),
        ): _UUID_OR_NONE.validate_python(row[4])
        for row in rows
    }

    cal_8a63aa81 = position_ids["8a63aa81"]
    cal_6303e6af = position_ids["6303e6af"]

    # The shared front leg (identical SPXW260618P07275000 on both
    # calendars) resolves via its order's own unique back-leg anchor.
    shared_symbol = occ_symbol_for(date(2026, 6, 18), Decimal("7275"))
    assert resolved[("1006681717677", shared_symbol)] == cal_8a63aa81
    assert resolved[("1006687566650", shared_symbol)] == cal_8a63aa81
    assert resolved[("1006417446601", shared_symbol)] == cal_6303e6af
    assert resolved[("1006622444775", shared_symbol)] == cal_6303e6af

    # Each calendar's own unique back leg resolves to itself.
    back_8a63aa81 = occ_symbol_for(date(2026, 6, 23), Decimal("7275"))
    back_6303e6af = occ_symbol_for(date(2026, 7, 17), Decimal("7275"))
    assert resolved[("1006681717677", back_8a63aa81)] == cal_8a63aa81
    assert resolved[("1006687566650", back_8a63aa81)] == cal_8a63aa81
    assert resolved[("1006417446601", back_6303e6af)] == cal_6303e6af
    assert resolved[("1006622444775", back_6303e6af)] == cal_6303e6af


async def test_disambiguation_query_leaves_unanchored_order_unresolved(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await _seed_unresolvable_order(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )

    rows = (
        await app_db_session.execute(
            text(RESOLVE_FILL_POSITIONS_SQL),
            {"user_id": provisioned_users.user_a},
        )
    ).all()
    synthetic_rows = [
        row for row in rows if _STR.validate_python(row[0]) == _SYNTH_ORDER_ID
    ]
    assert len(synthetic_rows) == 2
    for row in synthetic_rows:
        assert _UUID_OR_NONE.validate_python(row[4]) is None


async def test_reconciliation_window_selects_correct_events(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["8a63aa81", "6303e6af"],
    )
    await _seed_reconciliation_events(
        app_db_session, provisioned_users.user_a, position_ids
    )

    rows = (
        await app_db_session.execute(
            text(_RECONCILIATION_WINDOW_QUERY),
            {
                "user_id": provisioned_users.user_a,
                "window_start": _WINDOW_START,
                "window_end": _WINDOW_END,
            },
        )
    ).all()
    selected = {
        (
            _STR.validate_python(row[2]),
            _DATETIME.validate_python(row[3]),
        )
        for row in rows
    }

    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    cal_6303e6af = next(c for c in ORACLE_CALENDARS if c.calendar_id == "6303e6af")
    expected = {
        ("CLOSE", cal_6303e6af.closed_at),
        ("OPEN", cal_8a63aa81.opened_at),
        ("CLOSE", cal_8a63aa81.closed_at),
    }
    assert selected == expected
    # 6303e6af's OPEN (May 19) falls just outside the window's start and
    # must be excluded.
    assert ("OPEN", cal_6303e6af.opened_at) not in selected


async def test_reconciliation_window_total_summed_in_python_matches_oracle(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The window's total is computed here, in Python, from `Decimal`s
    read back through `read_events()` -- no SQL aggregate ever touches a
    money value, and no plaintext cash-delta column exists or is to be
    added (D3-04). The expected figure is derived from the oracle's own
    recorded per-calendar debit/credit, never invented."""
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["8a63aa81", "6303e6af"],
    )
    await _seed_reconciliation_events(
        app_db_session, provisioned_users.user_a, position_ids
    )

    records = await read_events(app_db_session, provisioned_users.user_a)
    window_records = [
        record for record in records if _WINDOW_START <= record.event_time < _WINDOW_END
    ]
    assert len(window_records) == 3

    total = sum(
        (
            amount
            for record in window_records
            for amount in (record.open_debit_usd, record.close_credit_usd)
            if amount is not None
        ),
        start=Decimal("0"),
    )

    cal_8a63aa81 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "8a63aa81")
    cal_6303e6af = next(c for c in ORACLE_CALENDARS if c.calendar_id == "6303e6af")
    expected_total = (
        cal_6303e6af.close_net_credit
        + cal_8a63aa81.open_net_debit
        + cal_8a63aa81.close_net_credit
    )
    assert total == expected_total


async def test_neither_query_names_a_ciphertext_or_nonce_column(
    superuser_db_session: AsyncSession,
) -> None:
    """Mechanical, not by inspection (T-03-29): the column list comes from
    `information_schema.columns` itself, so a column added later is
    covered without anyone remembering to update this test."""
    bytea_columns = await _bytea_column_names(superuser_db_session)
    assert bytea_columns  # sanity: the schema does have some, or this proves nothing
    for column_name in bytea_columns:
        assert column_name not in RESOLVE_FILL_POSITIONS_SQL
        assert column_name not in _RECONCILIATION_WINDOW_QUERY
