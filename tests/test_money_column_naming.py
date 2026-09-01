"""D-04: every `Numeric` column names its unit with a `_usd` or `_pts` suffix,
and — since D3-12 makes the unit a property of the *value*, not its storage
type — so does every money-carrying `LargeBinary` (ciphertext/nonce) column.

Column names are the only unit carrier once a value is in the database (T-01-17,
`NN-8`) -- v1's `openNetDebit` bug lived in a value read straight out of SQL,
where no Python type is in play. D-01's `NewType`s catch a unit mix-up in Python;
this catches it in SQL, for both a plaintext `NUMERIC` column and an encrypted
`bytea` one.

A `bytea` column is not automatically money-carrying -- key material
(`user_data_keys.wrapped_dek`/`wrap_nonce`) and a dimensionless quantity
(`fills.quantity_ciphertext`/`quantity_nonce`) are both `LargeBinary` and both
carry no unit at all. `_UNIT_EXEMPT_BINARY_COLUMNS` enumerates those explicitly
rather than pattern-matching around them, so a new binary column added later
forces a deliberate decision here instead of a silent pass or a silent false
positive.

This walks SQLAlchemy's in-memory `MetaData`, not a live database, so it runs on
this machine where nothing else DB-shaped can. No database. No `db` marker.
"""

from __future__ import annotations

from sqlalchemy import Column, Integer, LargeBinary, MetaData, Numeric, Table

import morai.db.models as _models
from morai.db.base import Base

assert _models  # imported for its side effect: populates Base.metadata

_UNIT_SUFFIXES = ("_usd", "_pts")
_BINARY_ENDINGS = ("_ciphertext", "_nonce")

_UNIT_EXEMPT_BINARY_COLUMNS = frozenset(
    {
        "user_data_keys.wrapped_dek",
        "user_data_keys.wrap_nonce",
        "fills.quantity_ciphertext",
        "fills.quantity_nonce",
        # Phase 4: a Schwab account hash and an OAuth token are connection
        # metadata, not money -- no more a unit-carrying value than
        # `fills.quantity_ciphertext` is (D4-11).
        "schwab_connections.account_hash_ciphertext",
        "schwab_connections.account_hash_nonce",
        "schwab_connections.token_ciphertext",
        "schwab_connections.token_nonce",
        # Phase 6, D6-02: the whole raw vendor element (activity type, time,
        # order id, and every transfer item -- money and non-money alike),
        # serialized as one JSON document and encrypted as one opaque blob.
        # No single unit applies to it, the same reasoning that exempts
        # `schwab_connections.token_ciphertext` above.
        "broker_transactions.raw_ciphertext",
        "broker_transactions.raw_nonce",
        # Phase 8, D8-04: the whole raw `get_quotes` response element for
        # one leg at one slot, serialized and encrypted as one opaque
        # blob -- the identical shape and reasoning as
        # `broker_transactions.raw_ciphertext` above. `snapshot_marks`'
        # own `mark_usd_ciphertext`/`spot_usd_ciphertext` are NOT exempt:
        # those are single-value USD fields and correctly carry the
        # `_usd` suffix instead.
        "snapshot_observations.raw_ciphertext",
        "snapshot_observations.raw_nonce",
    }
)


def _strip_binary_ending(column_name: str) -> str | None:
    """Return `column_name` with its `_ciphertext`/`_nonce` ending removed,
    or `None` if it carries neither -- such a column is not one of the
    binary money/identity columns this check reasons about at all (D3-12's
    "the suffix precedes the ciphertext or nonce ending")."""
    for ending in _BINARY_ENDINGS:
        if column_name.endswith(ending):
            return column_name[: -len(ending)]
    return None


def _is_money_carrying_binary_column(qualified_name: str, column_name: str) -> bool:
    """A `LargeBinary` column this check must hold to the same unit-naming
    standard as a `Numeric` one: it has a ciphertext/nonce ending, and it
    isn't on the explicit exemption list for key material or a dimensionless
    quantity."""
    if qualified_name in _UNIT_EXEMPT_BINARY_COLUMNS:
        return False
    return _strip_binary_ending(column_name) is not None


def _columns_missing_unit_suffix(metadata: MetaData) -> list[str]:
    """Report every `Numeric` column, and every money-carrying `LargeBinary`
    column, not ending in a known unit suffix, as `table.column` strings --
    a failure must answer the next question without re-running anything."""
    missing: list[str] = []
    for table in metadata.tables.values():
        for column in table.columns:
            qualified = f"{table.name}.{column.name}"
            if isinstance(column.type, Numeric):
                if not column.name.endswith(_UNIT_SUFFIXES):
                    missing.append(qualified)
            elif isinstance(column.type, LargeBinary):
                if not _is_money_carrying_binary_column(qualified, column.name):
                    continue
                base_name = _strip_binary_ending(column.name)
                assert base_name is not None  # guaranteed by the check above
                if not base_name.endswith(_UNIT_SUFFIXES):
                    missing.append(qualified)
    return missing


def _money_column_count(metadata: MetaData) -> int:
    """`Numeric` columns plus money-carrying `LargeBinary` columns -- the
    vacuity guard's own count, widened to both column types (T-03-38) so
    dropping every `Numeric` column from the schema cannot make the check
    below pass vacuously."""
    count = 0
    for table in metadata.tables.values():
        for column in table.columns:
            qualified = f"{table.name}.{column.name}"
            if isinstance(column.type, Numeric):
                count += 1
            elif isinstance(
                column.type, LargeBinary
            ) and _is_money_carrying_binary_column(qualified, column.name):
                count += 1
    return count


def test_real_schema_names_every_money_column() -> None:
    metadata = Base.metadata

    # D-07's pattern: a guard that cannot fire is not a guard. If this trips, the
    # loop below iterated nothing and the assertion after it would pass vacuously
    # -- most likely because a future refactor moved the import that populates
    # Base.metadata, or dropped every money-carrying column from the schema.
    assert _money_column_count(metadata) > 0, (
        "Base.metadata has zero money-carrying Numeric/LargeBinary columns -- "
        "the unit-suffix check would pass vacuously; confirm morai.db.models "
        "is imported before this walk"
    )

    assert _columns_missing_unit_suffix(metadata) == []


def test_fills_price_usd_ciphertext_passes() -> None:
    missing = _columns_missing_unit_suffix(Base.metadata)
    assert "fills.price_usd_ciphertext" not in missing
    assert "fills.price_usd_nonce" not in missing


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

    assert _columns_missing_unit_suffix(synthetic) == ["synthetic_probe.amount"]


def test_unsuffixed_binary_money_column_is_reported() -> None:
    """Negative control, mirrored onto a ciphertext column (D3-12): a `bytea`
    column is not excused from naming its unit just because it isn't
    `Numeric`."""
    synthetic = MetaData()
    Table(
        "synthetic_probe",
        synthetic,
        Column("id", Integer, primary_key=True),
        Column("amount_ciphertext", LargeBinary),
    )

    assert _columns_missing_unit_suffix(synthetic) == [
        "synthetic_probe.amount_ciphertext"
    ]
