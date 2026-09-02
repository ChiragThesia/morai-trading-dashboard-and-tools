"""The security and integrity contract for `reconciliation_runs` -- the one
new user-scoped table this phase adds (Phase 9, migration 0016). Proves
its RLS enforcement, its append-only grant, its two indexes and its four
data-integrity `CHECK` constraints against the live catalog, not against a
docstring's claim about them.

Phase 6 found the worker writing user-scoped rows over a superuser DSN,
which made every RLS policy on those rows inert while the whole suite
stayed green (`identity/rls.py::assert_connection_cannot_bypass_rls` is
the fix this project carries forward). This module is what would have
caught that shape here, on this table, before it shipped.

`@pytest.mark.db` -- runs only where Postgres is reachable, same
convention as every other db-marked module in this project.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import insert, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import ReconciliationRun
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import (
    app_db_session,
    clean_reconciliation_tables,
    provisioned_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- tests/ingest/ is not an ancestor
# conftest of this module for these fixture names to resolve without it
# (same convention `tests/ingest/test_sync_tracer.py` already follows).
__all__ = [
    "app_db_session",
    "clean_reconciliation_tables",
    "provisioned_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

# `Row` (raw `text()` results) types every column as `Any` -- same
# untyped-boundary shape `tests/ledger/test_schema_contract.py` already
# established. `TypeAdapter` narrows it (D-06).
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)
_STR: TypeAdapter[str] = TypeAdapter(str)
_INT: TypeAdapter[int] = TypeAdapter(int)

_WINDOW_START = datetime(2026, 6, 18, 4, 0, tzinfo=UTC)
_WINDOW_END = _WINDOW_START + timedelta(days=1)
_TRADING_DAY = _WINDOW_START.date()
_CHECKED_AT = datetime(2026, 6, 19, 12, 0, tzinfo=UTC)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config` with a bound parameter, never a literal in a `SET
    LOCAL` -- mirrors `tests/test_isolation.py`'s own `_set_current_user`
    exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def test_rls_enabled_and_forced(
    clean_reconciliation_tables: None, superuser_db_session: AsyncSession
) -> None:
    row = (
        await superuser_db_session.execute(
            text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname = 'reconciliation_runs'"
            )
        )
    ).one()
    assert (
        _BOOL.validate_python(row[0]),
        _BOOL.validate_python(row[1]),
    ) == (True, True)


async def test_exactly_one_admin_free_policy(
    clean_reconciliation_tables: None, superuser_db_session: AsyncSession
) -> None:
    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT policyname, qual, with_check FROM pg_policies "
                "WHERE tablename = 'reconciliation_runs'"
            )
        )
    ).all()
    assert len(rows) == 1
    row = rows[0]
    assert _STR.validate_python(row[0]) == "user_isolation"
    # D2-08/D3-18: a data table that inherits an admin clause makes the
    # whole encryption boundary decorative -- never a trading table.
    combined = f"{_STR.validate_python(row[1])} {_STR.validate_python(row[2])}"
    assert "is_admin" not in combined


async def test_grants_are_verb_narrowed(
    clean_reconciliation_tables: None, app_db_session: AsyncSession
) -> None:
    """`morai_app` holds `SELECT`/`INSERT`/`DELETE` and not `UPDATE` --
    the append-only grant `D9-03` requires: a reopening is a new row, so no
    writer ever needs to modify a stored verdict."""
    for verb, expected in (
        ("SELECT", True),
        ("INSERT", True),
        ("DELETE", True),
        ("UPDATE", False),
    ):
        row = (
            await app_db_session.execute(
                text(
                    "SELECT has_table_privilege('morai_app', "
                    "'reconciliation_runs', :verb)"
                ),
                {"verb": verb},
            )
        ).one()
        assert _BOOL.validate_python(row[0]) is expected


async def test_both_expected_indexes_exist(
    clean_reconciliation_tables: None, superuser_db_session: AsyncSession
) -> None:
    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = 'reconciliation_runs'"
            )
        )
    ).all()
    names = {_STR.validate_python(row[0]) for row in rows}
    assert names == {
        "reconciliation_runs_pkey",
        "ix_reconciliation_runs_user_id_trading_day_checked_at",
    }


async def test_a_row_inserted_for_user_a_is_invisible_to_user_b(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The bracketed cross-user proof shape (`tests/test_isolation.py`):
    user A's context sees its own row, user B's context sees zero rows for
    the same table."""
    await superuser_db_session.execute(
        insert(ReconciliationRun).values(
            user_id=provisioned_users.user_a,
            trading_day=_TRADING_DAY,
            window_start=_WINDOW_START,
            window_end=_WINDOW_END,
            realised_pnl_usd=Decimal("10.0000"),
            commissions_usd=Decimal("1.0000"),
            cash_delta_usd=Decimal("9.0000"),
            signed_difference_usd=Decimal("0.0000"),
            verdict="passed",
            reason=None,
            is_reopening=False,
            checked_at=_CHECKED_AT,
        )
    )
    await superuser_db_session.commit()

    await _set_current_user(app_db_session, provisioned_users.user_a)
    count_a = _INT.validate_python(
        (
            await app_db_session.execute(
                text("SELECT COUNT(*) FROM reconciliation_runs")
            )
        ).scalar_one()
    )
    assert count_a == 1

    await _set_current_user(app_db_session, provisioned_users.user_b)
    count_b = _INT.validate_python(
        (
            await app_db_session.execute(
                text("SELECT COUNT(*) FROM reconciliation_runs")
            )
        ).scalar_one()
    )
    assert count_b == 0


async def test_indeterminate_without_a_reason_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_END,
                realised_pnl_usd=None,
                commissions_usd=None,
                cash_delta_usd=None,
                signed_difference_usd=None,
                verdict="indeterminate",
                reason=None,
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    # The constraint's own name, not a bare exception type -- a future
    # unrelated integrity error must not make this test pass for the wrong
    # reason (`tests/ledger/test_roll_check_constraint.py`'s own
    # discipline). `str(exc_info.value)` rather than `.orig.constraint_name`:
    # `asyncpg` ships no `py.typed` marker, so `.orig` types as `Any` under
    # basedpyright strict's `reportAny` -- the same untyped-boundary reason
    # this codebase already resolves this exact pattern the same way in
    # `test_roll_check_constraint.py`/`test_fanout.py`.
    assert "reconciliation_runs_reason_iff_indeterminate_check" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_passed_with_a_nonzero_difference_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_END,
                realised_pnl_usd=Decimal("10.0000"),
                commissions_usd=Decimal("1.0000"),
                cash_delta_usd=Decimal("8.0000"),
                signed_difference_usd=Decimal("1.0000"),
                verdict="passed",
                reason=None,
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_passed_iff_zero_check" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_passed_with_a_missing_amount_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_END,
                realised_pnl_usd=Decimal("10.0000"),
                commissions_usd=Decimal("1.0000"),
                cash_delta_usd=None,
                signed_difference_usd=Decimal("0.0000"),
                verdict="passed",
                reason=None,
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_amounts_present_check" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_an_unrecognised_reason_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_END,
                realised_pnl_usd=None,
                commissions_usd=None,
                cash_delta_usd=None,
                signed_difference_usd=None,
                verdict="indeterminate",
                reason="not_a_real_reason",
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_reason_check" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_window_end_at_or_before_start_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_START,  # not strictly greater
                realised_pnl_usd=Decimal("10.0000"),
                commissions_usd=Decimal("1.0000"),
                cash_delta_usd=Decimal("9.0000"),
                signed_difference_usd=Decimal("0.0000"),
                verdict="passed",
                reason=None,
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_window_order_check" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_an_unrecognised_verdict_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_END,
                realised_pnl_usd=Decimal("10.0000"),
                commissions_usd=Decimal("1.0000"),
                cash_delta_usd=Decimal("9.0000"),
                # Nonzero so this row satisfies passed_iff_zero_check on its
                # own terms ((verdict = 'passed') is False here, so
                # (signed_difference_usd = 0) must be False too) -- this
                # test's own claim is verdict_check alone, isolated from
                # every other constraint.
                signed_difference_usd=Decimal("5.0000"),
                verdict="unknown",
                reason=None,
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_verdict_check" in str(exc_info.value)
    await superuser_db_session.rollback()
