"""The Decimal round-trip proof, repointed onto the encrypted fill path
(D3-17, `OPS-03`, T-03-37).

The old proof ran a value through `POST /gate/money-roundtrip` and the
`NUMERIC(14,4)` `gate_money_probe` table, both dropped in this plan's Task 3.
The round trip this file proves now is strictly *longer* than the one it
replaces: `Decimal` -> `str` -> UTF-8 bytes -> AES-GCM ciphertext ->
Postgres `bytea` -> decryption -> `Decimal`, plus the JSON leg through
`UsdField` (`StrictDecimalField`) -- the whole path a money value actually
crosses on the encrypted fill write path, not the shorter `NUMERIC`-column
path the retired probe proved.

**What is lost, stated plainly.** `POST /gate/money-roundtrip` was the only
surface that proved this round trip on the *deployed* Railway service, not
only in CI. This plan does not replace that deployed proof -- a deployed
money surface belongs to Phase 5's read API or Phase 6's ingest, both out of
this phase's scope. Deployed money round-trip coverage is absent from this
merge until a real fills API lands; the local proof below does not cover it
and is not represented as covering it.

`@pytest.mark.db` -- runs only where Postgres is reachable (CI's
`test-pytest` job, or the local Postgres this project's own CLAUDE.md
documents). This file lives at `tests/` top level, so the trading-table
fixtures are imported directly from `tests.ledger.conftest`, the same
convention `tests/test_crypto_shred.py` and `tests/test_key_rotation.py`
already use for the same reason (`tests/identity/conftest.py`'s own
docstring: directory-scoped conftests don't reach a module living one level
above them).
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic import Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models import ApiModel
from morai.ledger.fills import FillWrite, insert_fills, read_fills
from morai.money.api_types import UsdField
from tests.ledger.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)

# Re-exported, not merely imported -- pytest resolves these by name lookup in
# this module's namespace when a test module imports them from here, same
# convention `tests/test_crypto_shred.py` already established.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

# The retired NUMERIC(14,4) ceiling and CONTEXT.md's mid-range example (R-01)
# -- still meaningful reference values for the money value's *logical* shape
# (D-04), even though nothing physically stores them as NUMERIC any more.
CEILING = "9999999999.9999"
MID_RANGE = "1234567890.1234"
# One decimal digit past MID_RANGE's own precision -- 15 significant digits,
# 5 decimal places, over both halves of the NUMERIC(14,4)-shaped contract.
TOO_PRECISE = "1234567890.12345"

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)


class _MoneyValue(ApiModel):
    """A minimal local stand-in for the retired `MoneyRoundtripRequest` /
    `MoneyRoundtripResponse` -- proves the JSON leg through `UsdField`
    (`StrictDecimalField`) survives on its own, independent of any one
    route."""

    amount_usd: UsdField


class _MoneyValueWithSchema(ApiModel):
    """The same field, with the `NUMERIC(14,4)`-shaped precision contract
    (`Field(max_digits=14, decimal_places=4)`) applied explicitly. D3-12's
    point generalizes here too: the precision constraint is a property of
    the *value*, not of a storage type, so it is asserted at the Pydantic
    boundary rather than relying on a `NUMERIC` column that no longer
    exists to enforce it."""

    amount_usd: Annotated[UsdField, Field(max_digits=14, decimal_places=4)]


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


@pytest.mark.parametrize("amount", [CEILING, MID_RANGE])
async def test_decimal_survives_the_encrypted_fill_path_and_an_independent_read(
    app_db_session: AsyncSession,
    db_session: AsyncSession,
    provisioned_users: SeededUsers,
    amount: str,
) -> None:
    """`Decimal` -> `insert_fills` (encrypts) -> Postgres `bytea` -> a fresh
    `SELECT` through `read_fills`, on a connection independent of the
    writer's own -> the same `Decimal`, byte-for-byte."""
    value = Decimal(amount)
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(
        app_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="money-roundtrip-1",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=value,
            )
        ],
    )
    await app_db_session.commit()

    # `db_session` (tests/conftest.py) is its own engine, opened independently
    # of `app_db_session` above -- this proves persistence through Postgres,
    # not an in-memory echo.
    records = await read_fills(db_session, provisioned_users.user_a)
    assert len(records) == 1
    assert records[0].price_usd == value


def test_the_json_leg_survives_the_strict_decimal_boundary() -> None:
    parsed = _MoneyValue.model_validate({"amount_usd": MID_RANGE})
    assert parsed.amount_usd == Decimal(MID_RANGE)

    reparsed = _MoneyValue.model_validate_json(parsed.model_dump_json())
    assert reparsed.amount_usd == Decimal(MID_RANGE)


def test_a_value_with_more_precision_than_the_schema_allows_is_rejected() -> None:
    """Rejected, not silently truncated (NN-16) -- one decimal digit past the
    schema's own precision raises at the Pydantic boundary, rather than being
    quietly rounded away the way an unconstrained `NUMERIC` insert would."""
    with pytest.raises(ValidationError):
        _MoneyValueWithSchema.model_validate({"amount_usd": TOO_PRECISE})


async def test_health_returns_200_with_no_database_call(client: AsyncClient) -> None:
    """`/health`'s handler never depends on `get_db_session` (D-14) -- confirmed by
    code review of `morai.api.app.health`. This test proves the endpoint answers;
    the "no database call" half of the claim is a property of the handler's code,
    not something a passing DB-backed test alone can prove."""
    response = await client.get("/health")
    assert response.status_code == 200
