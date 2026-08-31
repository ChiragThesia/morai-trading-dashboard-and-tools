"""Schema contract for `positions`, `legs` and `events` (migration 0008):
every bullet in plan 03-02 Task 1's `<behavior>` block gets its own
assertion here, following `tests/identity/test_app_role.py`'s own
`pg_class`/`has_table_privilege` idiom.

`@pytest.mark.db` -- runs only where Postgres is reachable, same convention
as every other db-marked module in this project.
"""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.db

# `Row` (raw `text()` results) types every column as `Any` -- same
# untyped-boundary shape `tests/identity/test_app_role.py` already
# established. `TypeAdapter` narrows it (D-06).
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)
_STR: TypeAdapter[str] = TypeAdapter(str)

_NEW_TABLES = ("positions", "legs", "events")


@pytest.mark.parametrize("table_name", _NEW_TABLES)
async def test_rls_enabled_and_forced(
    superuser_db_session: AsyncSession, table_name: str
) -> None:
    row = (
        await superuser_db_session.execute(
            text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname = :table_name"
            ),
            {"table_name": table_name},
        )
    ).one()
    assert (
        _BOOL.validate_python(row[0]),
        _BOOL.validate_python(row[1]),
    ) == (True, True)


@pytest.mark.parametrize("table_name", _NEW_TABLES)
async def test_exactly_one_admin_free_policy(
    superuser_db_session: AsyncSession, table_name: str
) -> None:
    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT policyname, qual, with_check FROM pg_policies "
                "WHERE tablename = :table_name"
            ),
            {"table_name": table_name},
        )
    ).all()
    assert len(rows) == 1
    row = rows[0]
    qual = _STR.validate_python(row[1])
    with_check = _STR.validate_python(row[2])
    combined = f"{qual} {with_check}"
    # D2-08/D3-18: a data table that inherits an admin clause makes the
    # whole encryption boundary decorative -- `users` is the one deliberate
    # exception (migration 0003), never a trading table.
    assert "is_admin" not in combined


@pytest.mark.parametrize(
    ("table_name", "verb", "expected"),
    [
        (table_name, verb, expected)
        for table_name in _NEW_TABLES
        for verb, expected in (
            ("SELECT", True),
            ("INSERT", True),
            ("DELETE", True),
            ("UPDATE", False),
        )
    ],
)
async def test_grants_are_verb_narrowed(
    app_db_session: AsyncSession, table_name: str, verb: str, expected: bool
) -> None:
    row = (
        await app_db_session.execute(
            text("SELECT has_table_privilege('morai_app', :table_name, :verb)"),
            {"table_name": table_name, "verb": verb},
        )
    ).one()
    assert _BOOL.validate_python(row[0]) is expected


async def test_legs_unique_constraint_covers_position_and_leg_role(
    superuser_db_session: AsyncSession,
) -> None:
    row = (
        await superuser_db_session.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'legs'::regclass AND contype = 'u'"
            )
        )
    ).one()
    definition = _STR.validate_python(row[0])
    assert "position_id" in definition
    assert "leg_role" in definition


async def test_events_event_type_constrained_to_four_values(
    superuser_db_session: AsyncSession,
) -> None:
    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'events'::regclass AND contype = 'c'"
            )
        )
    ).all()
    definitions = " ".join(_STR.validate_python(row[0]) for row in rows)
    for value in ("OPEN", "CLOSE", "ROLL", "SETTLEMENT"):
        assert value in definitions


async def test_events_has_the_roll_check_constraint(
    superuser_db_session: AsyncSession,
) -> None:
    """Proves only that the named constraint exists -- what it actually
    catches (and does not) is Task 2's job, not this schema-shape test's."""
    row = (
        await superuser_db_session.execute(
            text(
                "SELECT 1 FROM pg_constraint WHERE conrelid = 'events'::regclass "
                "AND conname = 'roll_has_both_legs'"
            )
        )
    ).one_or_none()
    assert row is not None
