"""The 13 real oracle calendars, seeded through the one write path
(D3-13, D3-14, criterion 2's own seeding requirement).

Every value below is transcribed from `salvage/oracle-fixtures.md` --
real Schwab `orderId`s, real strikes/expiries, real fill prices, and each
calendar's independently-computed `openNetDebit`/`closeNetCredit`. Nothing
here is invented. OCC symbols are built from the recorded expiry and
strike via `occ_symbol_for`, never hand-typed, so a transposition across
52 symbols is structurally impossible.

A plain module, not a conftest -- Phase 5's oracle suite imports this
directly; burying it in a conftest would make it reachable only through
pytest's own fixture name resolution (this plan's own instruction).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Leg, Position
from morai.ledger.fills import FillWrite, insert_fills


def _root_for_expiry(expiry: date) -> str:
    """SPX (AM-settled, standard monthly) if `expiry` is the 3rd Friday of
    its month; SPXW (PM-settled weekly) otherwise -- the settlement-style
    rule migration 0008's own `legs.root` documentation states
    (analyzer-and-journal-spec.md Sec 5.4). The 3rd Friday of any month
    always falls between the 15th and the 21st. Computed, never
    hand-picked, so a transposed date can't silently pick the wrong root.
    """
    is_third_friday = expiry.weekday() == 4 and 15 <= expiry.day <= 21
    return "SPX" if is_third_friday else "SPXW"


def occ_symbol_for(expiry: date, strike: Decimal) -> str:
    """OCC-convention symbol: root + YYMMDD + P (put) + strike in integer
    thousandths, zero-padded to 8 digits -- `salvage/oracle-fixtures.md`'s
    own stated convention (e.g. strike 7275 -> `07275000`). All 13 oracle
    calendars are SPXW/SPX puts.
    """
    root = _root_for_expiry(expiry)
    strike_thousandths = int(strike * 1000)
    return f"{root}{expiry:%y%m%d}P{strike_thousandths:08d}"


@dataclass(frozen=True)
class OracleCalendar:
    """One of the 13 real calendars -- the aggregate a `positions` row and
    its two `legs` rows represent."""

    calendar_id: str
    front_expiry: date
    back_expiry: date
    strike: Decimal
    open_net_debit: Decimal
    close_net_credit: Decimal
    opened_at: datetime
    closed_at: datetime

    @property
    def front_occ_symbol(self) -> str:
        return occ_symbol_for(self.front_expiry, self.strike)

    @property
    def back_occ_symbol(self) -> str:
        return occ_symbol_for(self.back_expiry, self.strike)


@dataclass(frozen=True)
class OracleFill:
    """One of the 52 real fills."""

    calendar_id: str
    order_id: str
    execution_time: datetime
    expiry: date
    strike: Decimal
    position_effect: str
    side: str
    price_usd: Decimal

    @property
    def occ_symbol(self) -> str:
        return occ_symbol_for(self.expiry, self.strike)


@dataclass(frozen=True)
class _CalendarSpec:
    """Compact transcription of one calendar's own section in
    `salvage/oracle-fixtures.md` -- expiry/strike/price literals only, no
    hand-typed OCC symbol anywhere. Each fill tuple is
    `(expiry, price_usd, position_effect, side)`.
    """

    calendar_id: str
    strike: Decimal
    front_expiry: date
    back_expiry: date
    open_order_id: str
    open_date: date
    open_fills: tuple[tuple[date, Decimal, str, str], ...]
    close_order_id: str
    close_date: date
    close_fills: tuple[tuple[date, Decimal, str, str], ...]
    open_net_debit: Decimal
    close_net_credit: Decimal


def _d(value: str) -> Decimal:
    """String literal to `Decimal`, never via `float` (D3-17)."""
    return Decimal(value)


_CALENDAR_SPECS: tuple[_CalendarSpec, ...] = (
    # 1. 65aac62e -- 7425P Aug7/Aug31 -- stale status column (hard case,
    # irrelevant to this plan's queries; still real oracle data)
    _CalendarSpec(
        calendar_id="65aac62e",
        strike=_d("7425"),
        front_expiry=date(2026, 8, 7),
        back_expiry=date(2026, 8, 31),
        open_order_id="1006855414174",
        open_date=date(2026, 6, 22),
        open_fills=(
            (date(2026, 8, 31), _d("159.41"), "OPENING", "BUY"),
            (date(2026, 8, 7), _d("127.06"), "OPENING", "SELL"),
        ),
        close_order_id="1006990704540",
        close_date=date(2026, 7, 1),
        close_fills=(
            (date(2026, 8, 31), _d("123.13"), "CLOSING", "SELL"),
            (date(2026, 8, 7), _d("86.78"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("32.35"),
        close_net_credit=_d("36.35"),
    ),
    # 2. 9eef2153 -- 7100P May15/Jun8
    _CalendarSpec(
        calendar_id="9eef2153",
        strike=_d("7100"),
        front_expiry=date(2026, 5, 15),
        back_expiry=date(2026, 6, 8),
        open_order_id="1006130670569",
        open_date=date(2026, 4, 24),
        open_fills=(
            (date(2026, 5, 15), _d("81.54"), "OPENING", "SELL"),
            (date(2026, 6, 8), _d("124.39"), "OPENING", "BUY"),
        ),
        close_order_id="1006198637052",
        close_date=date(2026, 4, 30),
        close_fills=(
            (date(2026, 6, 8), _d("91.75"), "CLOSING", "SELL"),
            (date(2026, 5, 15), _d("45.15"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("42.85"),
        close_net_credit=_d("46.6"),
    ),
    # 3. e8bfbf41 -- 7175P May22/Jun15
    _CalendarSpec(
        calendar_id="e8bfbf41",
        strike=_d("7175"),
        front_expiry=date(2026, 5, 22),
        back_expiry=date(2026, 6, 15),
        open_order_id="1006216919920",
        open_date=date(2026, 5, 1),
        open_fills=(
            (date(2026, 6, 15), _d("115.12"), "OPENING", "BUY"),
            (date(2026, 5, 22), _d("70.52"), "OPENING", "SELL"),
        ),
        close_order_id="1006265261970",
        close_date=date(2026, 5, 6),
        close_fills=(
            (date(2026, 6, 15), _d("75.45"), "CLOSING", "SELL"),
            (date(2026, 5, 22), _d("31.65"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("44.6"),
        close_net_credit=_d("43.8"),
    ),
    # 4. 60c46a57 -- 7425P Jul8/Jul31 -- shares its CLOSE order with
    # 24f1e72e's OPEN (order 1006797510202, 4 legs total)
    _CalendarSpec(
        calendar_id="60c46a57",
        strike=_d("7425"),
        front_expiry=date(2026, 7, 8),
        back_expiry=date(2026, 7, 31),
        open_order_id="1006755504464",
        open_date=date(2026, 6, 15),
        open_fills=(
            (date(2026, 7, 31), _d("96.6"), "OPENING", "BUY"),
            (date(2026, 7, 8), _d("52.4"), "OPENING", "SELL"),
        ),
        close_order_id="1006797510202",
        close_date=date(2026, 6, 17),
        close_fills=(
            (date(2026, 7, 8), _d("59.7"), "CLOSING", "BUY"),
            (date(2026, 7, 31), _d("102.92"), "CLOSING", "SELL"),
        ),
        open_net_debit=_d("44.2"),
        close_net_credit=_d("43.22"),
    ),
    # 5. 24f1e72e -- 7475P Jul9/Jul31 -- shares its OPEN order with
    # 60c46a57's CLOSE (same order 1006797510202)
    _CalendarSpec(
        calendar_id="24f1e72e",
        strike=_d("7475"),
        front_expiry=date(2026, 7, 9),
        back_expiry=date(2026, 7, 31),
        open_order_id="1006797510202",
        open_date=date(2026, 6, 17),
        open_fills=(
            (date(2026, 7, 31), _d("117.84"), "OPENING", "BUY"),
            (date(2026, 7, 9), _d("76.32"), "OPENING", "SELL"),
        ),
        close_order_id="1006830552432",
        close_date=date(2026, 6, 18),
        close_fills=(
            (date(2026, 7, 9), _d("79.86"), "CLOSING", "BUY"),
            (date(2026, 7, 31), _d("124.86"), "CLOSING", "SELL"),
        ),
        open_net_debit=_d("41.52"),
        close_net_credit=_d("45.0"),
    ),
    # 6. 8a63aa81 -- 7275P Jun18/Jun23 -- shared front leg (hard case),
    # front is IDENTICAL to 6303e6af's front (SPXW 260618P07275000)
    _CalendarSpec(
        calendar_id="8a63aa81",
        strike=_d("7275"),
        front_expiry=date(2026, 6, 18),
        back_expiry=date(2026, 6, 23),
        open_order_id="1006681717677",
        open_date=date(2026, 6, 9),
        open_fills=(
            (date(2026, 6, 23), _d("62.5"), "OPENING", "BUY"),
            (date(2026, 6, 18), _d("52.3"), "OPENING", "SELL"),
        ),
        close_order_id="1006687566650",
        close_date=date(2026, 6, 10),
        close_fills=(
            (date(2026, 6, 23), _d("65.17"), "CLOSING", "SELL"),
            (date(2026, 6, 18), _d("54.62"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("10.2"),
        close_net_credit=_d("10.55"),
    ),
    # 7. 6303e6af -- 7275P Jun18/Jul17 -- shared front leg (hard case)
    _CalendarSpec(
        calendar_id="6303e6af",
        strike=_d("7275"),
        front_expiry=date(2026, 6, 18),
        back_expiry=date(2026, 7, 17),
        open_order_id="1006417446601",
        open_date=date(2026, 5, 19),
        open_fills=(
            (date(2026, 7, 17), _d("128.9"), "OPENING", "BUY"),
            (date(2026, 6, 18), _d("82.9"), "OPENING", "SELL"),
        ),
        close_order_id="1006622444775",
        close_date=date(2026, 6, 5),
        close_fills=(
            (date(2026, 7, 17), _d("66.2"), "CLOSING", "SELL"),
            (date(2026, 6, 18), _d("19.2"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("46.0"),
        close_net_credit=_d("47.0"),
    ),
    # 8. 45727d08 -- 7300P Jun5/Jun29
    _CalendarSpec(
        calendar_id="45727d08",
        strike=_d("7300"),
        front_expiry=date(2026, 6, 5),
        back_expiry=date(2026, 6, 29),
        open_order_id="1006379061928",
        open_date=date(2026, 5, 15),
        open_fills=(
            (date(2026, 6, 29), _d("100.94"), "OPENING", "BUY"),
            (date(2026, 6, 5), _d("56.44"), "OPENING", "SELL"),
        ),
        close_order_id="1006405063827",
        close_date=date(2026, 5, 18),
        close_fills=(
            (date(2026, 6, 29), _d("112.54"), "CLOSING", "SELL"),
            (date(2026, 6, 5), _d("67.54"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("44.5"),
        close_net_credit=_d("45.0"),
    ),
    # 9. 53533aa7 -- 7275P Jun5/Jun26
    _CalendarSpec(
        calendar_id="53533aa7",
        strike=_d("7275"),
        front_expiry=date(2026, 6, 5),
        back_expiry=date(2026, 6, 26),
        open_order_id="1006328241982",
        open_date=date(2026, 5, 12),
        open_fills=(
            (date(2026, 6, 26), _d("122.27"), "OPENING", "BUY"),
            (date(2026, 6, 5), _d("82.72"), "OPENING", "SELL"),
        ),
        close_order_id="1006374383514",
        close_date=date(2026, 5, 15),
        close_fills=(
            (date(2026, 6, 5), _d("59.73"), "CLOSING", "BUY"),
            (date(2026, 6, 26), _d("100.98"), "CLOSING", "SELL"),
        ),
        open_net_debit=_d("39.55"),
        close_net_credit=_d("41.25"),
    ),
    # 10. b0d862ba -- 7300P May29/Jun22
    _CalendarSpec(
        calendar_id="b0d862ba",
        strike=_d("7300"),
        front_expiry=date(2026, 5, 29),
        back_expiry=date(2026, 6, 22),
        open_order_id="1006293766875",
        open_date=date(2026, 5, 8),
        open_fills=(
            (date(2026, 6, 22), _d("108.45"), "OPENING", "BUY"),
            (date(2026, 5, 29), _d("63.1"), "OPENING", "SELL"),
        ),
        close_order_id="1006325330463",
        close_date=date(2026, 5, 12),
        close_fills=(
            (date(2026, 6, 22), _d("117.55"), "CLOSING", "SELL"),
            (date(2026, 5, 29), _d("68.7"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("45.35"),
        close_net_credit=_d("48.85"),
    ),
    # 11. 95546839 -- 7050P May20/Jun18
    _CalendarSpec(
        calendar_id="95546839",
        strike=_d("7050"),
        front_expiry=date(2026, 5, 20),
        back_expiry=date(2026, 6, 18),
        open_order_id="1006070855412",
        open_date=date(2026, 4, 20),
        open_fills=(
            (date(2026, 5, 20), _d("96.3"), "OPENING", "SELL"),
            (date(2026, 6, 18), _d("143.85"), "OPENING", "BUY"),
        ),
        close_order_id="1006078556268",
        close_date=date(2026, 4, 21),
        close_fills=(
            (date(2026, 6, 18), _d("138.8"), "CLOSING", "SELL"),
            (date(2026, 5, 20), _d("90.05"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("47.55"),
        close_net_credit=_d("48.75"),
    ),
    # 12. f3789ddd -- 6900P May7/Jun1 -- same-day open + close, different
    # orderIds -- proves pairing keys off orderId, never trade date
    _CalendarSpec(
        calendar_id="f3789ddd",
        strike=_d("6900"),
        front_expiry=date(2026, 5, 7),
        back_expiry=date(2026, 6, 1),
        open_order_id="1006028000778",
        open_date=date(2026, 4, 16),
        open_fills=(
            (date(2026, 5, 7), _d("64.81"), "OPENING", "SELL"),
            (date(2026, 6, 1), _d("105.41"), "OPENING", "BUY"),
        ),
        close_order_id="1006028001427",
        close_date=date(2026, 4, 16),
        close_fills=(
            (date(2026, 5, 7), _d("62.97"), "CLOSING", "BUY"),
            (date(2026, 6, 1), _d("103.97"), "CLOSING", "SELL"),
        ),
        open_net_debit=_d("40.6"),
        close_net_credit=_d("41.0"),
    ),
    # 13. 3ca74277 -- 7375P Jul8/Jul31
    _CalendarSpec(
        calendar_id="3ca74277",
        strike=_d("7375"),
        front_expiry=date(2026, 7, 8),
        back_expiry=date(2026, 7, 31),
        open_order_id="1006740037547",
        open_date=date(2026, 6, 12),
        open_fills=(
            (date(2026, 7, 8), _d("94.39"), "OPENING", "SELL"),
            (date(2026, 7, 31), _d("137.39"), "OPENING", "BUY"),
        ),
        close_order_id="1006753323002",
        close_date=date(2026, 6, 15),
        close_fills=(
            (date(2026, 7, 31), _d("86.5"), "CLOSING", "SELL"),
            (date(2026, 7, 8), _d("44.15"), "CLOSING", "BUY"),
        ),
        open_net_debit=_d("43.0"),
        close_net_credit=_d("42.35"),
    ),
)


def _at_noon_utc(day: date) -> datetime:
    """The fixture file records dates only, never intraday times -- noon
    UTC is an arbitrary but consistent stand-in, applied uniformly so no
    two fills in the same order ever collide on `execution_time` for a
    reason unrelated to their real distinguishing data (occ_symbol)."""
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC)


def _build_calendars() -> tuple[OracleCalendar, ...]:
    return tuple(
        OracleCalendar(
            calendar_id=spec.calendar_id,
            front_expiry=spec.front_expiry,
            back_expiry=spec.back_expiry,
            strike=spec.strike,
            open_net_debit=spec.open_net_debit,
            close_net_credit=spec.close_net_credit,
            opened_at=_at_noon_utc(spec.open_date),
            closed_at=_at_noon_utc(spec.close_date),
        )
        for spec in _CALENDAR_SPECS
    )


def _build_fills() -> tuple[OracleFill, ...]:
    fills: list[OracleFill] = []
    for spec in _CALENDAR_SPECS:
        open_time = _at_noon_utc(spec.open_date)
        close_time = _at_noon_utc(spec.close_date)
        for expiry, price_usd, position_effect, side in spec.open_fills:
            fills.append(
                OracleFill(
                    calendar_id=spec.calendar_id,
                    order_id=spec.open_order_id,
                    execution_time=open_time,
                    expiry=expiry,
                    strike=spec.strike,
                    position_effect=position_effect,
                    side=side,
                    price_usd=price_usd,
                )
            )
        for expiry, price_usd, position_effect, side in spec.close_fills:
            fills.append(
                OracleFill(
                    calendar_id=spec.calendar_id,
                    order_id=spec.close_order_id,
                    execution_time=close_time,
                    expiry=expiry,
                    strike=spec.strike,
                    position_effect=position_effect,
                    side=side,
                    price_usd=price_usd,
                )
            )
    return tuple(fills)


ORACLE_CALENDARS: tuple[OracleCalendar, ...] = _build_calendars()
ORACLE_FILLS: tuple[OracleFill, ...] = _build_fills()


async def seed_oracle(
    superuser_session: AsyncSession,
    app_session: AsyncSession,
    user_id: UUID,
    *,
    calendar_ids: Iterable[str] | None = None,
) -> dict[str, UUID]:
    """Seed real oracle calendars for one user: a `positions` row and two
    `legs` rows per calendar (front/back), and every fill through
    `insert_fills()` -- the one write path (D3-13, D3-14).

    `superuser_session` inserts `positions`/`legs` directly -- this phase
    lands their DDL only; no dedicated write path exists yet
    (03-RESEARCH.md Open Question 2, `tests/ledger/conftest.py`'s own
    `seeded_position` precedent). `app_session` must be a fresh session on
    the `morai_app` role with a data key already provisioned for
    `user_id` -- this function sets `app.current_user_id` on it itself
    before calling `insert_fills`, but does not commit `app_session`
    afterward: the caller controls that transaction, matching
    `insert_fills`'s own contract.

    `calendar_ids`, if given, seeds only those calendars (by their real
    hex id from `salvage/oracle-fixtures.md`) rather than all 13 -- Task
    2's disambiguation-query test needs only the two shared-front-leg
    calendars, not the full oracle.

    Returns `calendar_id -> position_id`.
    """
    wanted = set(calendar_ids) if calendar_ids is not None else None
    calendars = (
        ORACLE_CALENDARS
        if wanted is None
        else tuple(c for c in ORACLE_CALENDARS if c.calendar_id in wanted)
    )
    seeded_calendar_ids = {c.calendar_id for c in calendars}

    position_ids: dict[str, UUID] = {}
    for calendar in calendars:
        position_id = (
            await superuser_session.execute(
                insert(Position)
                .values(
                    user_id=user_id,
                    opened_at=calendar.opened_at,
                    closed_at=calendar.closed_at,
                )
                .returning(Position.id)
            )
        ).scalar_one()
        position_ids[calendar.calendar_id] = position_id
        await superuser_session.execute(
            insert(Leg).values(
                position_id=position_id,
                user_id=user_id,
                leg_role="front",
                occ_symbol=calendar.front_occ_symbol,
                root=_root_for_expiry(calendar.front_expiry),
            )
        )
        await superuser_session.execute(
            insert(Leg).values(
                position_id=position_id,
                user_id=user_id,
                leg_role="back",
                occ_symbol=calendar.back_occ_symbol,
                root=_root_for_expiry(calendar.back_expiry),
            )
        )
    await superuser_session.commit()

    await app_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    fill_writes = [
        FillWrite(
            order_id=fill.order_id,
            occ_symbol=fill.occ_symbol,
            leg_index=0,
            execution_time=fill.execution_time,
            position_effect=fill.position_effect,
            side=fill.side,
            quantity=Decimal("1"),
            price_usd=fill.price_usd,
        )
        for fill in ORACLE_FILLS
        if fill.calendar_id in seeded_calendar_ids
    ]
    await insert_fills(app_session, user_id, fill_writes)

    return position_ids
