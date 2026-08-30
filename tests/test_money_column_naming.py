"""D-04: every `Numeric` column names its unit with a `_usd` or `_pts` suffix.

Column names are the only unit carrier once a value is in the database (T-01-17,
`NN-8`) -- v1's `openNetDebit` bug lived in a value read straight out of SQL,
where no Python type is in play. D-01's `NewType`s catch a unit mix-up in Python;
this catches it in SQL.

This walks SQLAlchemy's in-memory `MetaData`, not a live database, so it runs on
this machine where nothing else DB-shaped can. No database. No `db` marker.
"""

from __future__ import annotations

from sqlalchemy import Column, Integer, MetaData, Numeric, Table

import morai.db.models as _models
from morai.db.base import Base

assert _models  # imported for its side effect: populates Base.metadata

_UNIT_SUFFIXES = ("_usd", "_pts")


def _numeric_columns_missing_unit_suffix(metadata: MetaData) -> list[str]:
    """Report every `Numeric` column not ending in a known unit suffix, as
    `table.column` strings -- a failure must answer the next question without
    re-running anything."""
    return [
        f"{table.name}.{column.name}"
        for table in metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, Numeric) and not column.name.endswith(_UNIT_SUFFIXES)
    ]


def _numeric_column_count(metadata: MetaData) -> int:
    return sum(
        1
        for table in metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, Numeric)
    )


def test_real_schema_names_every_money_column() -> None:
    metadata = Base.metadata

    # D-07's pattern: a guard that cannot fire is not a guard. If this trips, the
    # loop below iterated nothing and the assertion after it would pass vacuously
    # -- most likely because a future refactor moved the import that populates
    # Base.metadata.
    assert _numeric_column_count(metadata) > 0, (
        "Base.metadata has zero Numeric columns -- the unit-suffix check would "
        "pass vacuously; confirm morai.db.models is imported before this walk"
    )

    assert _numeric_columns_missing_unit_suffix(metadata) == []


def test_gate_money_probe_amount_usd_passes() -> None:
    assert "gate_money_probe.amount_usd" not in _numeric_columns_missing_unit_suffix(
        Base.metadata
    )


def test_unsuffixed_numeric_column_is_reported() -> None:
    """Negative control: a synthetic table with a `Numeric` column that does not
    name its unit must be caught by the same helper the real schema uses -- proof
    the check has teeth, not just that it passed today."""
    synthetic = MetaData()
    Table(
        "synthetic_probe",
        synthetic,
        Column("id", Integer, primary_key=True),
        Column("amount", Numeric(14, 4)),
    )

    assert _numeric_columns_missing_unit_suffix(synthetic) == ["synthetic_probe.amount"]
