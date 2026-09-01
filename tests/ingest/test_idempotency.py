"""Re-ingest changes nothing past the first successful write, and the
do-nothing conflict clause is safe for the reason claimed, not merely
assumed (06-02 Task 2, INGEST-02, INGEST-03, WR-A3).

`@pytest.mark.db` on the whole module -- every test drives real writes
through `sync_user`/`insert_fills`/`insert_broker_transactions` against
Postgres.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import JsonValue
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import BrokerTransaction, Fill
from morai.ingest.broker_transactions import (
    BrokerTransactionWrite,
    insert_broker_transactions,
)
from morai.ingest.schwab_sync import (
    _Transaction,  # pyright: ignore[reportPrivateUsage]  # why: WR-A3's own proof needs to exercise extract_fills' real key construction from a validated element, not a hand-assembled FillWrite -- the plan's own action text requires building through extract_fills wherever the payload shape allows it.
)
from morai.ingest.schwab_sync import (
    extract_fills,
    sync_user,
)
from morai.ledger.fills import insert_fills
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TX_PAYLOAD, TxFakeSchwabAuth

pytestmark = pytest.mark.db

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)
_NOW = datetime(2026, 6, 20, tzinfo=UTC)

# A second TRADE, activityId distinct from TX_PAYLOAD's, one option leg --
# the "genuinely new" transaction the extend test lands on top of TX_PAYLOAD.
_TX2: list[JsonValue] = [
    {
        "activityId": 1006681717678,
        "type": "TRADE",
        "time": "2026-06-19T14:30:00+00:00",
        "orderId": "1006681717678",
        "transferItems": [
            {
                "instrument": {
                    "symbol": "SPXW  260618P07280000",
                    "assetType": "OPTION",
                },
                "amount": -1,
                "price": 20.0,
                "cost": 2000.0,
                "positionEffect": "OPENING",
            },
        ],
    }
]

# Two option transferItems, same symbol, same everything but position in
# the list -- the WR-A3 proof needs two fills differing ONLY in
# `leg_index`, `fills`' own least-significant discriminating column.
_SAME_LEG_TX: JsonValue = {
    "activityId": "9990001",
    "type": "TRADE",
    "time": "2026-06-18T14:30:00+00:00",
    "orderId": "9990001",
    "transferItems": [
        {
            "instrument": {"symbol": "SPXW  260618P07275000", "assetType": "OPTION"},
            "amount": -1,
            "price": 10.0,
            "cost": 1000.0,
            "positionEffect": "OPENING",
        },
        {
            "instrument": {"symbol": "SPXW  260618P07275000", "assetType": "OPTION"},
            "amount": -1,
            "price": 10.0,
            "cost": 1000.0,
            "positionEffect": "OPENING",
        },
    ],
}


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `test_sync_tracer.py::_seed_connection`."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": "fake-refresh-user-a"},
            created_at=_TOKEN_CREATED_AT,
        ),
        account_hash="fake-account-hash",
    )
    await superuser_db_session.commit()


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _fill_ciphertext_rows(
    session: AsyncSession, user_id: UUID
) -> list[tuple[bytes | None, bytes | None, bytes | None, bytes | None]]:
    """Raw ciphertext/nonce bytes, ordered by `leg_index` for a stable
    comparison -- the byte comparison is the assertion that matters
    (INGEST-02's immutability), not just a row count that would also hold
    if the second run had deleted and rewritten every row under a fresh
    nonce."""
    rows = (
        await session.execute(
            select(Fill).where(Fill.user_id == user_id).order_by(Fill.leg_index)
        )
    ).scalars()
    return [
        (
            row.quantity_ciphertext,
            row.quantity_nonce,
            row.price_usd_ciphertext,
            row.price_usd_nonce,
        )
        for row in rows
    ]


async def _tx_ciphertext_rows(
    session: AsyncSession, user_id: UUID
) -> list[tuple[bytes, bytes]]:
    rows = (
        await session.execute(
            select(BrokerTransaction)
            .where(BrokerTransaction.user_id == user_id)
            .order_by(BrokerTransaction.activity_id)
        )
    ).scalars()
    return [(row.raw_ciphertext, row.raw_nonce) for row in rows]


async def test_second_run_over_same_window_lands_nothing_and_changes_no_byte(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
) -> None:
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    first = await sync_user(app_db_session, user_id, auth=tx_fake_auth, now=_NOW)
    await app_db_session.commit()

    await _set_current_user(app_db_session, user_id)
    before_fills = await _fill_ciphertext_rows(app_db_session, user_id)
    before_tx = await _tx_ciphertext_rows(app_db_session, user_id)

    second = await sync_user(app_db_session, user_id, auth=tx_fake_auth, now=_NOW)
    await app_db_session.commit()

    await _set_current_user(app_db_session, user_id)
    after_fills = await _fill_ciphertext_rows(app_db_session, user_id)
    after_tx = await _tx_ciphertext_rows(app_db_session, user_id)

    assert first.broker_transactions_landed == 1
    assert first.fills_landed == 2
    assert second.broker_transactions_landed == 0
    assert second.fills_landed == 0
    assert len(before_fills) == len(after_fills) == 2
    assert len(before_tx) == len(after_tx) == 1
    assert before_fills == after_fills
    assert before_tx == after_tx


async def test_run_over_extending_window_lands_only_the_genuinely_new_transaction(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The second run's own payload overlaps the first (repeats TX_PAYLOAD's
    activityId) and extends past it (adds `_TX2`'s activityId) -- proving
    the no-op is real for the overlap and not merely "harmless because
    nothing changed", the property that makes the overlap-days setting
    safe rather than merely convenient."""
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    narrow_auth = TxFakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT, account_entries=[], transactions=TX_PAYLOAD
    )
    first = await sync_user(app_db_session, user_id, auth=narrow_auth, now=_NOW)
    await app_db_session.commit()

    extended_auth = TxFakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT,
        account_entries=[],
        transactions=[*TX_PAYLOAD, *_TX2],
    )
    second = await sync_user(app_db_session, user_id, auth=extended_auth, now=_NOW)
    await app_db_session.commit()

    assert first.broker_transactions_landed == 1
    assert first.fills_landed == 2
    assert second.broker_transactions_landed == 1  # only _TX2's activityId
    assert second.fills_landed == 1  # _TX2's single leg

    await _set_current_user(app_db_session, user_id)
    tx_rows = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).scalars()
    assert {row.activity_id for row in tx_rows} == {
        "1006681717677",
        "1006681717678",
    }


async def test_two_fills_differing_only_in_leg_index_both_land_and_rerun_holds(
    clean_ingest_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """WR-A3 (`salvage/invariants.md`): v1's `(activityId, legIndex)`
    natural key was hashed into a UUID whose `hexToUuid` dropped a hex
    nibble, silently colliding two distinct fills onto one identifier that
    `onConflictDoNothing` then dropped. `fills`' composite key carries
    `leg_index` directly, never a hashed surrogate (`NN-1`) -- this is the
    assertion that proves the do-nothing clause is safe for that reason,
    not merely that it is assumed to be. Built through the real
    `extract_fills`, not a hand-assembled `FillWrite`, so this exercises
    the real key construction the production path uses."""
    user_id = provisioned_users.user_a
    transaction = _Transaction.model_validate(_SAME_LEG_TX)
    fills, skip_reasons = extract_fills(transaction)

    assert skip_reasons == []
    assert len(fills) == 2
    assert fills[0].leg_index == 0
    assert fills[1].leg_index == 1
    assert fills[0].order_id == fills[1].order_id
    assert fills[0].occ_symbol == fills[1].occ_symbol
    assert fills[0].execution_time == fills[1].execution_time

    await _set_current_user(app_db_session, user_id)
    first_landed = await insert_fills(app_db_session, user_id, fills)
    assert first_landed == 2

    second_landed = await insert_fills(app_db_session, user_id, fills)
    assert second_landed == 0

    rows = (
        await app_db_session.execute(select(Fill).where(Fill.user_id == user_id))
    ).scalars()
    assert len(list(rows)) == 2


async def test_two_broker_transactions_differing_only_in_activity_id_both_land(
    clean_ingest_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Same proof, `broker_transactions`' own composite key
    `(user_id, activity_id)` -- `activity_id` is that table's own
    least-significant discriminating column."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)

    execution_time = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
    rows = [
        BrokerTransactionWrite(
            activity_id="1",
            transaction_type="TRADE",
            transaction_time=execution_time,
            order_id="shared-order",
            raw_payload={"activityId": 1},
        ),
        BrokerTransactionWrite(
            activity_id="2",
            transaction_type="TRADE",
            transaction_time=execution_time,
            order_id="shared-order",
            raw_payload={"activityId": 2},
        ),
    ]

    first_landed = await insert_broker_transactions(app_db_session, user_id, rows)
    assert first_landed == 2

    second_landed = await insert_broker_transactions(app_db_session, user_id, rows)
    assert second_landed == 0

    tx_rows = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).scalars()
    assert {row.activity_id for row in tx_rows} == {"1", "2"}
