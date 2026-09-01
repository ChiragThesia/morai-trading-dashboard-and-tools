"""Task 3: `detect_roll` as a real, callable predicate -- proved False on
the one real order that must not be mistaken for a roll (D5-01).

Order `1006797510202` closes `60c46a57` (strike 7425) and opens `24f1e72e`
(strike 7475) in one broker order -- same root, same option type, but
different strikes, so `detect_roll`'s strict same-root/same-strike/
same-type-with-only-expiry-differing requirement is not met. It must
derive as 2 ordinary CLOSE fills + 2 ordinary OPEN fills, never a single
ROLL event.

Per D5-01, this ships as the negative guard only: no positive ROLL
fixture exists in the oracle, so no positive ROLL derivation is proved or
built here. The oracle contains no ROLL and no SETTLE at all.

Split, per this plan's own instruction: the parser round-trip and the
`detect_roll` pair assertions need no database and carry no `db` marker
-- they run against hand-built `FillRecord`s taken from `ORACLE_FILLS`,
never re-typed. The end-to-end assertion is `pytest.mark.db`-marked on
its own test function.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import read_events
from morai.ledger.fills import FillRecord
from morai.ledger.pairing import detect_roll, parse_occ_symbol, sync_events
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
    OracleFill,
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

_FAKE_USER_ID = UUID("00000000-0000-4000-8000-000000000002")

_INT: TypeAdapter[int] = TypeAdapter(int)


def _fill_record(fill: OracleFill) -> FillRecord:
    return FillRecord(
        user_id=_FAKE_USER_ID,
        order_id=fill.order_id,
        occ_symbol=fill.occ_symbol,
        leg_index=0,
        execution_time=fill.execution_time,
        position_effect=fill.position_effect,
        side=fill.side,
        quantity=Decimal("1"),
        price_usd=fill.price_usd,
        key_version=1,
    )


def test_parse_occ_symbol_round_trips_all_26_oracle_symbols() -> None:
    """26 symbols (13 calendars x front + back), never de-duplicated --
    `8a63aa81` and `6303e6af`'s identical shared front symbol counts
    twice, matching the oracle's own 26-symbol total."""
    symbols = [
        symbol
        for calendar in ORACLE_CALENDARS
        for symbol in (calendar.front_occ_symbol, calendar.back_occ_symbol)
    ]
    assert len(symbols) == 26

    for symbol in symbols:
        contract = parse_occ_symbol(symbol)
        assert contract.option_type == "P"
        assert occ_symbol_for(contract.expiry, contract.strike) == symbol


def test_parse_occ_symbol_raises_on_malformed_symbol() -> None:
    with pytest.raises(ValueError, match="BOGUS-SYMBOL"):
        parse_occ_symbol("BOGUS-SYMBOL")


def test_detect_roll_is_false_for_every_pair_within_the_shared_order() -> None:
    """Order `1006797510202` closes `60c46a57` at strike 7425 and opens
    `24f1e72e` at strike 7475 -- same root, same option type, but
    different strikes, so the strict requirement is not met."""
    fills = [f for f in ORACLE_FILLS if f.order_id == "1006797510202"]
    assert len(fills) == 4

    records = [_fill_record(f) for f in fills]
    closing = [r for r in records if r.position_effect == "CLOSING"]
    opening = [r for r in records if r.position_effect == "OPENING"]
    assert len(closing) == 2
    assert len(opening) == 2

    for close_fill in closing:
        for open_fill in opening:
            assert detect_roll(close_fill, open_fill) is False


@pytest.mark.db
async def test_shared_order_derives_to_two_close_and_two_open_events_never_a_roll(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_ids = await seed_oracle(
        superuser_db_session,
        app_db_session,
        provisioned_users.user_a,
        calendar_ids=["60c46a57", "24f1e72e"],
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)
    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 4

    records = await read_events(app_db_session, provisioned_users.user_a)
    assert len(records) == 4

    cal_60c46a57 = next(c for c in ORACLE_CALENDARS if c.calendar_id == "60c46a57")
    cal_24f1e72e = next(c for c in ORACLE_CALENDARS if c.calendar_id == "24f1e72e")

    close_60c46a57 = next(
        r
        for r in records
        if r.position_id == position_ids["60c46a57"] and r.event_type == "CLOSE"
    )
    open_24f1e72e = next(
        r
        for r in records
        if r.position_id == position_ids["24f1e72e"] and r.event_type == "OPEN"
    )
    assert close_60c46a57.close_credit_usd == cal_60c46a57.close_net_credit
    assert open_24f1e72e.open_debit_usd == cal_24f1e72e.open_net_debit

    roll_count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT COUNT(*) FROM events WHERE event_type = 'ROLL'")
            )
        ).scalar_one()
    )
    assert roll_count == 0
