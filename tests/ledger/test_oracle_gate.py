"""Task 1: the 13-calendar oracle, the 14th synthetic control, and the
global invariants (LEDGER-11, D5-01, D5-04) -- the gate the whole project
defers to. `CLAUDE.md` states it as a hard constraint: "The 13-calendar
oracle passes before any money code ships." Every expected figure below is
transcribed, not invented, from `salvage/oracle-fixtures.md`'s
independently-computed cash flows of 13 real Schwab orders -- computed
before the fix that made this pipeline correct was written. That is what
makes this an oracle and not a regression snapshot: a regression snapshot
freezes whatever the code under test currently outputs, and this suite's
expectations were never derived from that code at all.

Event-count translation, stated plainly so a later reader does not mistake
2-for-4 as a weakened assertion: `salvage/oracle-fixtures.md`'s "Global
invariants" section says "exactly 4 events per calendar." It is not wrong
-- it documents v1's leg-level event model, where each OPEN/CLOSE derived
two separate rows (one per leg). This schema's `events` row is
position-level: one row carries both an `open_debit_usd` and a
`close_credit_usd` column pair, keyed on `position_id`, so a plain
OPEN/CLOSE calendar produces exactly 2 rows here (one OPEN, one CLOSE),
not 4. `salvage/oracle-fixtures.md` is not edited (it records what was,
per `.claude/rules/workflow.md`) -- this paragraph is the translation. The
other two invariants -- 52 real fills stored (54 here, with the 14th
control's own 2) and zero orphans -- carry over unchanged.

Reseed-per-case, measured: each of the 13 parametrized cases and the
invariants case below re-seeds the full 13-calendar-plus-synthetic-control
sweep from scratch through `seed_oracle`/`seed_synthetic_open_calendar` --
`clean_ledger_tables` truncates before every db-marked test regardless,
and this repo configures no test-order randomisation, so sharing state
across test functions would let a coupling between two of them go
uncaught. The measured wall-clock cost of this choice is recorded in this
plan's own SUMMARY.md, not here.

Markers are per-function, not a module-wide `pytestmark`, because this
file mixes `db`-marked tests with one pure, no-database case
(`test_pure_derive_events_reproduces_the_same_26_figures`, LEDGER-12's
second proof) that must keep running under the local default `uv run
pytest -m "not db"` -- the same resolution `tests/ledger/
test_pairing_roll_guard.py` already uses for the identical mix.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.events import read_events
from morai.ledger.pairing import derive_events, sync_events
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
    SYNTHETIC_OPEN_POSITION_ID,
    assert_matches_oracle,
    oracle_fill_records,
    seed_oracle,
    seed_synthetic_open_calendar,
)

__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

_INT: TypeAdapter[int] = TypeAdapter(int)

# The two hard cases (`salvage/oracle-fixtures.md`'s own "two hard cases"
# section) are inside this parametrization, not bolted on separately:
# `8a63aa81` (10.20/10.55, the shared front-month leg) and `65aac62e`
# (32.35/36.35, the stale-status calendar) are both plain members of
# `ORACLE_CALENDARS`, covered by the same loop as the other 11.
_CALENDAR_CASES = [
    pytest.param(calendar.calendar_id, id=calendar.calendar_id)
    for calendar in ORACLE_CALENDARS
]


@pytest.mark.db
@pytest.mark.parametrize("calendar_id", _CALENDAR_CASES)
async def test_calendar_derives_to_its_recorded_figures(
    calendar_id: str,
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """One parametrized case per calendar, named by its real broker order
    id (`pytest.param(..., id=...)`) so a failure names the calendar, not
    an index. Reads the stored, decrypted row back through `read_events`
    -- this is what proves the figure survived the encrypt/store/decrypt
    round trip, not merely that `derive_events` computed it correctly in
    memory (the pure case below already proves that half)."""
    position_ids = await seed_oracle(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )
    await seed_synthetic_open_calendar(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)
    assert derivation.unresolved == ()
    assert derivation.unclassified == ()

    calendar = next(c for c in ORACLE_CALENDARS if c.calendar_id == calendar_id)
    position_id = position_ids[calendar_id]

    records = await read_events(app_db_session, provisioned_users.user_a)
    open_record = next(
        r for r in records if r.position_id == position_id and r.event_type == "OPEN"
    )
    close_record = next(
        r for r in records if r.position_id == position_id and r.event_type == "CLOSE"
    )
    assert open_record.open_debit_usd == calendar.open_net_debit, (
        f"{calendar_id}: open_debit_usd {open_record.open_debit_usd} != "
        f"expected {calendar.open_net_debit}"
    )
    assert close_record.close_credit_usd == calendar.close_net_credit, (
        f"{calendar_id}: close_credit_usd {close_record.close_credit_usd} "
        f"!= expected {calendar.close_net_credit}"
    )


@pytest.mark.db
async def test_full_sweep_global_invariants(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The four global invariants, read back from Postgres in one sweep --
    not tallied in memory, because the oracle's own claim ("Global
    invariants the suite also checks", `salvage/oracle-fixtures.md`) is a
    storage-layer claim. Neither `fills` nor `events` gets a stand-in row
    from `seeded_users` the way `positions` does (`tests/ledger/
    test_plaintext_queries.py`'s own `test_seed_oracle_produces_...`
    documents that positions-only exclusion) -- these two bare counts need
    no such adjustment.

    Both `fills`/`events` counts are read on `app_db_session` itself, not
    `superuser_db_session`: `insert_fills`/`insert_events` never commit
    (the caller owns the transaction), so the 54 fills and 27 events sit
    in `app_db_session`'s own still-open transaction -- a different
    session on a different connection, even the superuser one, cannot see
    another session's uncommitted rows under Postgres's default read-
    committed isolation. `positions`/`legs` differ: `seed_oracle`/
    `seed_synthetic_open_calendar` commit those on `superuser_session`
    directly, before `insert_fills` ever runs.
    """
    await seed_oracle(superuser_db_session, app_db_session, provisioned_users.user_a)
    await seed_synthetic_open_calendar(
        superuser_db_session, app_db_session, provisioned_users.user_a
    )

    derivation = await sync_events(app_db_session, provisioned_users.user_a)

    # Invariant one: 54 fills stored -- the oracle's own 52 plus the
    # synthetic control's 2.
    fill_count = _INT.validate_python(
        (await app_db_session.execute(text("SELECT COUNT(*) FROM fills"))).scalar_one()
    )
    assert fill_count == 54

    # Invariant two: zero unresolved, zero unclassified.
    assert derivation.unresolved == ()
    assert derivation.unclassified == ()

    # Invariant three: exactly 27 events rows -- 2 per real calendar plus
    # the synthetic control's 1 -- every one OPEN or CLOSE, never a
    # spurious ROLL (or any other value the CHECK permits).
    event_count = _INT.validate_python(
        (await app_db_session.execute(text("SELECT COUNT(*) FROM events"))).scalar_one()
    )
    assert event_count == 27
    stray_event_type_count = _INT.validate_python(
        (
            await app_db_session.execute(
                text(
                    "SELECT COUNT(*) FROM events "
                    "WHERE event_type NOT IN ('OPEN', 'CLOSE')"
                )
            )
        ).scalar_one()
    )
    assert stray_event_type_count == 0

    # Invariant four: the synthetic control has exactly one event, and it
    # is an OPEN.
    records = await read_events(app_db_session, provisioned_users.user_a)
    synthetic_events = [
        r for r in records if r.position_id == SYNTHETIC_OPEN_POSITION_ID
    ]
    assert len(synthetic_events) == 1
    assert synthetic_events[0].event_type == "OPEN"


def test_pure_derive_events_reproduces_the_same_26_figures() -> None:
    """LEDGER-12's second proof: the same 26 figures come back from
    `derive_events` called directly over in-memory `FillRecord`s built
    from `ORACLE_FILLS` via `oracle_fill_records` -- no `AsyncSession`, no
    database, no clock. This is also the harness `tests/ledger/
    test_pairing_seeded_faults.py` calls, so a fault proved fatal there is
    proved fatal by the identical assertion here. No `db` marker: this
    case must keep running under the local default `uv run pytest -m "not
    db"`.
    """
    position_ids: dict[str, UUID] = {
        calendar.calendar_id: uuid4() for calendar in ORACLE_CALENDARS
    }
    records, resolutions = oracle_fill_records(position_ids)

    derivation = derive_events(records, resolutions)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 26
    assert_matches_oracle(derivation.events, position_ids)
