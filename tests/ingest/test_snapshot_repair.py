"""Repair path tests (Phase 8, plan 08-03, SNAP-04).

`repair_snapshot_marks` rebuilds `snapshot_marks` from the raw payloads
already stored in `snapshot_observations`, with no vendor call -- the
raw layer 08-01 stored is only worth its cost if something reads it back
(`L039`). `backfill_uncaptured_slot_gaps` (Task 3) writes an honest
`slot_not_captured` gap for a slot Procrastinate's own worker never fired
a job for at all (`PeriodicDeferrer.MAX_DELAY`, `L041`).

`@pytest.mark.db` -- runs only where Postgres is reachable, same
convention as every other db-marked suite in this repo. Every write in
this file goes through the real write paths
(`write_snapshot_observations`/`write_snapshot_marks`) rather than a
hand-written insert, so the encryption, the AAD binding and the
gap-xor-payload `CHECK` constraints are all exercised exactly as
production writes them (mirrors `test_snapshot_capture.py`'s own
discipline).
"""

from __future__ import annotations

import ast
import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from procrastinate.jobs import Status
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.crypto.data_keys import dek_for_version
from morai.crypto.envelope import decrypt_field, generate_dek, wrap_dek
from morai.db.models import (
    Leg,
    Position,
    SnapshotMark,
    SnapshotObservation,
    UserDataKey,
)
from morai.identity.rls import (
    assert_connection_cannot_bypass_rls as real_assert_connection_cannot_bypass_rls,
)
from morai.ingest import snapshot_repair
from morai.ingest.snapshot_repair import (
    BackfillOutcome,
    RepairOutcome,
    backfill_uncaptured_slot_gaps,
    repair_snapshot_marks,
)
from morai.ingest.snapshots import (
    SnapshotGapReason,
    SnapshotWrite,
    _snapshot_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this suite decrypts the stored mark back to prove digit-for-digit fidelity with the seeded observation's own payload -- it needs the exact AAD helper the writers use, the same cooperating-test convention test_snapshot_capture.py already uses.
    write_snapshot_marks,
    write_snapshot_observations,
)
from morai.ledger.fills import FillWrite, insert_fills
from morai.ledger.pairing import sync_events
from morai.settings import get_settings
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import QUOTE_PAYLOAD
from tests.ledger.conftest import SeededPosition
from tools.repair_snapshots import main as tools_main

pytestmark = pytest.mark.db

# Monday, 10:30 ET (EDT, UTC-4) -- on the RTH grid (D8-06), the same slot
# `test_snapshot_capture.py` uses.
_SLOT_TIME = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)

# The two decrypted mark values `QUOTE_PAYLOAD` (tests/ingest/conftest.py)
# carries for `seeded_position`'s own two legs.
_FRONT_MARK = Decimal("44.8567")
_BACK_MARK = Decimal("30.1233")

# Four consecutive RTH slots on the same Monday (D8-06) -- the backfill
# window Task 3's own tests examine.
_BACKFILL_SLOTS = (
    datetime(2026, 6, 15, 14, 0, tzinfo=UTC),
    datetime(2026, 6, 15, 14, 30, tzinfo=UTC),
    datetime(2026, 6, 15, 15, 0, tzinfo=UTC),
    datetime(2026, 6, 15, 15, 30, tzinfo=UTC),
)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- mirrors
    `test_snapshot_capture.py::_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _seed_observation(
    session: AsyncSession,
    user_id: UUID,
    *,
    leg_id: UUID,
    slot_time: datetime,
    observed_at: datetime,
    raw_payload: object = None,
    gap_reason: SnapshotGapReason | None = None,
) -> None:
    """Seeds one `snapshot_observations` row through the real write path
    (`write_snapshot_observations`) -- never a hand-written insert.

    Re-asserts the RLS context on every call: `set_config(..., true)` is
    transaction-local and a prior `session.commit()` in this same test
    reverts `app.current_user_id` to `''`, not unset, so a second write on
    the same session needs it set again."""
    await _set_current_user(session, user_id)
    await write_snapshot_observations(
        session,
        user_id,
        [
            SnapshotWrite(
                leg_id=leg_id,
                slot_time=slot_time,
                observed_at=observed_at,
                raw_payload=raw_payload,  # type: ignore[arg-type]  # why: test-only JsonValue literals (dicts) narrow correctly at runtime; a precise TypeAdapter round-trip here would only restate what write_snapshot_observations already validates.
                mark_usd=None,
                spot_usd=None,
                gap_reason=gap_reason,
            )
        ],
    )
    await session.commit()


async def _seed_mark(
    session: AsyncSession,
    user_id: UUID,
    *,
    leg_id: UUID,
    slot_time: datetime,
    observed_at: datetime,
    mark_usd: Decimal | None = None,
    gap_reason: SnapshotGapReason | None = None,
) -> None:
    """Seeds one `snapshot_marks` row through the real write path
    (`write_snapshot_marks`) -- never a hand-written insert. Re-asserts
    the RLS context on every call -- see `_seed_observation`'s own
    docstring for why."""
    await _set_current_user(session, user_id)
    await write_snapshot_marks(
        session,
        user_id,
        [
            SnapshotWrite(
                leg_id=leg_id,
                slot_time=slot_time,
                observed_at=observed_at,
                raw_payload=None,
                mark_usd=mark_usd,
                spot_usd=None,
                gap_reason=gap_reason,
            )
        ],
    )
    await session.commit()


async def _read_mark_row(
    session: AsyncSession, user_id: UUID, leg_id: UUID, slot_time: datetime
) -> SnapshotMark:
    """Re-asserts the RLS context before reading -- see
    `_seed_observation`'s own docstring: a prior commit on this same
    session reverts `app.current_user_id` to `''`, and a read is subject
    to the same RLS `SELECT` policy a write is."""
    await _set_current_user(session, user_id)
    return (
        await session.execute(
            select(SnapshotMark).where(
                SnapshotMark.leg_id == leg_id, SnapshotMark.slot_time == slot_time
            )
        )
    ).scalar_one()


async def _decrypt_mark_usd(
    session: AsyncSession, user_id: UUID, mark: SnapshotMark
) -> Decimal:
    """Re-asserts the RLS context before reading `user_data_keys` -- see
    `_seed_observation`'s own docstring."""
    await _set_current_user(session, user_id)
    assert mark.mark_usd_ciphertext is not None
    assert mark.mark_usd_nonce is not None
    assert mark.key_version is not None
    dek = await dek_for_version(session, user_id, mark.key_version)
    return Decimal(
        decrypt_field(
            mark.mark_usd_ciphertext,
            mark.mark_usd_nonce,
            dek,
            _snapshot_associated_data(
                "snapshot_marks",
                "mark_usd_ciphertext",
                user_id=user_id,
                leg_id=mark.leg_id,
                slot_time=mark.slot_time,
            ),
        ).decode("utf-8")
    )


async def _seed_leg_for_user(session: AsyncSession, user_id: UUID) -> UUID:
    """A second user's own position/leg, inserted the same way
    `tests/ledger/conftest.py::seeded_position` does -- `seeded_position`
    itself seeds only `user_a`; the CLI's no-user-id fan-out needs a real
    leg under `user_b` too, to prove a second user's rows are repaired."""
    position_id = (
        await session.execute(
            insert(Position).values(user_id=user_id).returning(Position.id)
        )
    ).scalar_one()
    leg_id = (
        await session.execute(
            insert(Leg)
            .values(
                position_id=position_id,
                user_id=user_id,
                leg_role="front",
                occ_symbol="SPXW260618P07275000",
                root="SPXW",
            )
            .returning(Leg.id)
        )
    ).scalar_one()
    await session.commit()
    return leg_id


async def _seed_leg_with_lifetime(
    session: AsyncSession,
    user_id: UUID,
    *,
    occ_symbol: str,
    root: str,
    opened_at: datetime,
    closed_at: datetime | None = None,
) -> UUID:
    """A position and one leg with a real, derived `opened_at` (and,
    optionally, `closed_at`) -- through `insert_fills` and `sync_events`,
    the real write paths, never a hand-written `events` insert. Each
    caller uses its own distinct `occ_symbol` so `resolve_fill_positions`
    has nothing ambiguous to resolve against a sibling test's rows."""
    await _set_current_user(session, user_id)
    position_id = (
        await session.execute(
            insert(Position).values(user_id=user_id).returning(Position.id)
        )
    ).scalar_one()
    leg_id = (
        await session.execute(
            insert(Leg)
            .values(
                position_id=position_id,
                user_id=user_id,
                leg_role="front",
                occ_symbol=occ_symbol,
                root=root,
            )
            .returning(Leg.id)
        )
    ).scalar_one()

    fills = [
        FillWrite(
            order_id=f"backfill-open-{leg_id}",
            occ_symbol=occ_symbol,
            leg_index=0,
            execution_time=opened_at,
            position_effect="OPENING",
            side="BUY",
            quantity=Decimal("1"),
            price_usd=Decimal("10.0000"),
        )
    ]
    if closed_at is not None:
        fills.append(
            FillWrite(
                order_id=f"backfill-close-{leg_id}",
                occ_symbol=occ_symbol,
                leg_index=0,
                execution_time=closed_at,
                position_effect="CLOSING",
                side="SELL",
                quantity=Decimal("1"),
                price_usd=Decimal("12.0000"),
            )
        )
    await insert_fills(session, user_id, fills)
    as_of = (closed_at or opened_at) + timedelta(days=1)
    await sync_events(session, user_id, as_of=as_of)
    await session.commit()
    return leg_id


async def test_repair_writes_real_marks_from_stored_observations_with_no_prior_marks(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.back_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.observations_read == 2
    assert outcome.marks_written == 2
    assert outcome.gaps_by_reason == {}

    front_mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    back_mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.back_leg_id, _SLOT_TIME
    )
    assert front_mark.gap_reason is None
    assert back_mark.gap_reason is None
    assert await _decrypt_mark_usd(app_db_session, user_id, front_mark) == _FRONT_MARK
    assert await _decrypt_mark_usd(app_db_session, user_id, back_mark) == _BACK_MARK


async def test_repair_heals_an_existing_gap_mark_from_a_real_observation(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_mark(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        gap_reason=SnapshotGapReason.NO_MARKET_DATA,
    )
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.marks_written == 1
    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert mark.gap_reason is None
    assert await _decrypt_mark_usd(app_db_session, user_id, mark) == _FRONT_MARK


async def test_repair_corrects_a_wrong_real_mark_from_the_stored_observation(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_mark(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        mark_usd=Decimal("999.9999"),
    )
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.marks_written == 1
    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    decrypted = await _decrypt_mark_usd(app_db_session, user_id, mark)
    assert decrypted == _FRONT_MARK
    assert decrypted != Decimal("999.9999")


def test_snapshot_repair_module_imports_no_vendor_or_schwab_module() -> None:
    """The no-vendor-call property, structural rather than aspirational
    (D8-04): walks the module's own AST rather than trusting a comment."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    source = (repo_root / "src/morai/ingest/snapshot_repair.py").read_text()
    tree = ast.parse(source)
    modules = [
        node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
    ] + [
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    ]
    offenders = [
        m for m in modules if m.startswith("morai.vendor") or m.startswith("schwab")
    ]
    assert offenders == []


async def test_repair_rewrites_a_stored_gap_observation_into_a_gap_mark(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=None,
        gap_reason=SnapshotGapReason.NO_MARKET_DATA,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.gaps_by_reason == {"no_market_data": 1}
    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert mark.gap_reason == "no_market_data"
    assert mark.mark_usd_ciphertext is None


async def test_repair_blocked_by_an_existing_real_mark_leaves_it_byte_identical(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_mark(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        mark_usd=_FRONT_MARK,
    )
    before = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    before_ciphertext = before.mark_usd_ciphertext
    before_nonce = before.mark_usd_nonce

    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=None,
        gap_reason=SnapshotGapReason.NO_MARKET_DATA,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.observations_read == 1
    after = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert after.gap_reason is None
    assert after.mark_usd_ciphertext == before_ciphertext
    assert after.mark_usd_nonce == before_nonce


async def test_since_windows_the_read_and_leaves_older_marks_untouched(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    old_slot = _SLOT_TIME - timedelta(minutes=30)
    await _set_current_user(app_db_session, user_id)
    await _seed_mark(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=old_slot,
        observed_at=old_slot,
        mark_usd=Decimal("1.0000"),
    )
    before = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, old_slot
    )
    before_ciphertext = before.mark_usd_ciphertext
    before_nonce = before.mark_usd_nonce

    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=old_slot,
        observed_at=old_slot,
        raw_payload=QUOTE_PAYLOAD,
    )
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id, since=_SLOT_TIME)
    await app_db_session.commit()

    assert outcome.observations_read == 1

    after = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, old_slot
    )
    assert after.mark_usd_ciphertext == before_ciphertext
    assert after.mark_usd_nonce == before_nonce

    new_mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert new_mark.gap_reason is None


async def test_repair_over_zero_observations_returns_zero_outcome_and_raises_nothing(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)

    assert outcome.observations_read == 0
    assert outcome.marks_written == 0
    assert outcome.gaps_by_reason == {}


async def test_repair_decrypts_an_older_key_version_and_reencrypts_under_current(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )
    await _set_current_user(app_db_session, user_id)
    observation_before = (
        await app_db_session.execute(
            select(SnapshotObservation).where(
                SnapshotObservation.leg_id == seeded_position.front_leg_id,
                SnapshotObservation.slot_time == _SLOT_TIME,
            )
        )
    ).scalar_one()
    assert observation_before.key_version == 1

    dek = generate_dek()
    wrapped_dek, wrap_nonce = wrap_dek(dek, get_settings().master_key_bytes)
    await superuser_db_session.execute(
        insert(UserDataKey).values(
            user_id=user_id,
            key_version=2,
            wrapped_dek=wrapped_dek,
            wrap_nonce=wrap_nonce,
        )
    )
    await superuser_db_session.commit()

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.observations_read == 1
    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert mark.key_version == 2
    assert await _decrypt_mark_usd(app_db_session, user_id, mark) == _FRONT_MARK


async def test_repair_produces_no_market_data_gap_when_payload_no_longer_parses(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload={"unexpected": "shape"},
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await repair_snapshot_marks(app_db_session, user_id)
    await app_db_session.commit()

    assert outcome.gaps_by_reason == {"no_market_data": 1}
    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert mark.gap_reason == "no_market_data"
    assert mark.mark_usd_ciphertext is None


async def test_repair_snapshot_marks_job_rebuilds_marks_via_a_drained_worker(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Defers `repair_snapshot_marks` by name onto the real `worker.app.app`
    and drains it with a bounded `run_worker_async(wait=False)`, mirroring
    `test_snapshot_capture.py`'s own tracer -- the genuine production call
    path, not a direct function call."""
    user_id = provisioned_users.user_a
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    async with app.open_async():
        job_id = await app.configure_task("repair_snapshot_marks").defer_async(
            user_id=str(user_id)
        )
        status_before = await app.job_manager.get_job_status_async(job_id)
        assert status_before is Status.TODO

        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)

        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert mark.gap_reason is None
    assert await _decrypt_mark_usd(app_db_session, user_id, mark) == _FRONT_MARK


async def test_repair_task_asserts_rls_before_touching_a_protected_table(
    clean_snapshot_tables: None,
    provisioned_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`repair_snapshot_marks_task` opens a `morai_app` session and asserts
    it cannot bypass RLS before touching a protected table -- the same
    call `snapshot_user_task` already makes (Phase 6's own finding, T-08-16)."""
    calls: list[bool] = []

    async def spy(session: AsyncSession) -> None:
        calls.append(True)
        await real_assert_connection_cannot_bypass_rls(session)

    monkeypatch.setattr(worker_app, "assert_connection_cannot_bypass_rls", spy)

    user_id = provisioned_users.user_a
    async with app.open_async():
        job_id = await app.configure_task("repair_snapshot_marks").defer_async(
            user_id=str(user_id)
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)
        assert status is Status.SUCCEEDED

    assert calls == [True]


async def test_both_entry_points_call_the_identical_repair_function(
    clean_snapshot_tables: None,
    provisioned_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Patches `repair_snapshot_marks` at its defining module
    (`morai.ingest.snapshot_repair`) and observes both the drained worker
    job and the CLI's `main` call it -- a wrapper that grew its own copy
    of the logic would still pass a behavioural test and would fail this
    one (D8-13)."""
    calls: list[UUID] = []

    async def fake_repair(
        session: AsyncSession, user_id: UUID, *, since: datetime | None = None
    ) -> RepairOutcome:
        calls.append(user_id)
        return RepairOutcome(observations_read=0, marks_written=0, gaps_by_reason={})

    monkeypatch.setattr(snapshot_repair, "repair_snapshot_marks", fake_repair)

    user_id = provisioned_users.user_a
    async with app.open_async():
        job_id = await app.configure_task("repair_snapshot_marks").defer_async(
            user_id=str(user_id)
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)
        assert status is Status.SUCCEEDED

    exit_code = await tools_main([str(user_id)])
    assert exit_code == 0

    assert calls == [user_id, user_id]


async def test_cli_main_with_one_user_id_rebuilds_marks_and_exits_zero(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_id = provisioned_users.user_a
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    exit_code = await tools_main([str(user_id)])
    assert exit_code == 0

    mark = await _read_mark_row(
        app_db_session, user_id, seeded_position.front_leg_id, _SLOT_TIME
    )
    assert mark.gap_reason is None
    assert await _decrypt_mark_usd(app_db_session, user_id, mark) == _FRONT_MARK


async def test_cli_main_with_no_user_id_repairs_every_user_with_stored_observations(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    user_a = provisioned_users.user_a
    user_b = provisioned_users.user_b
    await _seed_observation(
        app_db_session,
        user_a,
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )
    user_b_leg_id = await _seed_leg_for_user(superuser_db_session, user_b)
    await _seed_observation(
        app_db_session,
        user_b,
        leg_id=user_b_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload=QUOTE_PAYLOAD,
    )

    exit_code = await tools_main([])
    assert exit_code == 0

    mark_a = await _read_mark_row(
        app_db_session, user_a, seeded_position.front_leg_id, _SLOT_TIME
    )
    mark_b = await _read_mark_row(app_db_session, user_b, user_b_leg_id, _SLOT_TIME)
    assert mark_a.gap_reason is None
    assert mark_b.gap_reason is None
    assert await _decrypt_mark_usd(app_db_session, user_a, mark_a) == _FRONT_MARK
    assert await _decrypt_mark_usd(app_db_session, user_b, mark_b) == _FRONT_MARK


async def test_cli_rejects_a_non_uuid_user_id_without_echoing_it(
    clean_snapshot_tables: None,
    provisioned_users: SeededUsers,
    capsys: pytest.CaptureFixture[str],
) -> None:
    bad_value = "not-a-uuid-value-98765"
    exit_code = await tools_main([bad_value])
    assert exit_code != 0
    combined = "".join(capsys.readouterr())
    assert bad_value not in combined


async def test_cli_help_exits_zero_and_names_every_option(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        await tools_main(["--help"])
    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "user_id" in out
    assert "--since" in out
    assert "--backfill-gaps" in out


def test_cli_module_reimplements_no_parser() -> None:
    """The anti-drift assertion for the CLI's own half of D8-13: no
    parser reimplemented locally, only the shared function called."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    source = (repo_root / "tools/repair_snapshots.py").read_text()
    tree = ast.parse(source)
    offenders = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name.startswith("parse_quote")
    ]
    assert offenders == []


async def test_backfill_writes_slot_not_captured_gaps_for_missing_slots_only(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Over a window containing four RTH slots where only two have any
    snapshot row, the backfill writes `slot_not_captured` gap rows for
    the two missing slots, leaves the two existing rows untouched, and
    writes a row in both `snapshot_observations` and `snapshot_marks` for
    each missing slot -- every written row's mark and spot are both
    null."""
    user_id = provisioned_users.user_a
    leg_id = await _seed_leg_with_lifetime(
        app_db_session,
        user_id,
        occ_symbol="SPXW261016P07000000",
        root="SPXW",
        opened_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=leg_id,
        slot_time=_BACKFILL_SLOTS[0],
        observed_at=_BACKFILL_SLOTS[0],
        raw_payload=QUOTE_PAYLOAD,
    )
    await _seed_mark(
        app_db_session,
        user_id,
        leg_id=leg_id,
        slot_time=_BACKFILL_SLOTS[0],
        observed_at=_BACKFILL_SLOTS[0],
        mark_usd=Decimal("5.0000"),
    )
    await _seed_observation(
        app_db_session,
        user_id,
        leg_id=leg_id,
        slot_time=_BACKFILL_SLOTS[2],
        observed_at=_BACKFILL_SLOTS[2],
        raw_payload=QUOTE_PAYLOAD,
    )
    await _seed_mark(
        app_db_session,
        user_id,
        leg_id=leg_id,
        slot_time=_BACKFILL_SLOTS[2],
        observed_at=_BACKFILL_SLOTS[2],
        mark_usd=Decimal("6.0000"),
    )
    before_mark_0 = await _read_mark_row(
        app_db_session, user_id, leg_id, _BACKFILL_SLOTS[0]
    )
    before_ciphertext_0 = before_mark_0.mark_usd_ciphertext
    before_nonce_0 = before_mark_0.mark_usd_nonce

    await _set_current_user(app_db_session, user_id)
    outcome = await backfill_uncaptured_slot_gaps(
        app_db_session, user_id, start=_BACKFILL_SLOTS[0], end=_BACKFILL_SLOTS[-1]
    )
    await app_db_session.commit()

    assert outcome.slots_examined == 4
    assert outcome.gap_rows_written == 2

    after_mark_0 = await _read_mark_row(
        app_db_session, user_id, leg_id, _BACKFILL_SLOTS[0]
    )
    assert after_mark_0.mark_usd_ciphertext == before_ciphertext_0
    assert after_mark_0.mark_usd_nonce == before_nonce_0

    for missing_slot in (_BACKFILL_SLOTS[1], _BACKFILL_SLOTS[3]):
        mark = await _read_mark_row(app_db_session, user_id, leg_id, missing_slot)
        assert mark.gap_reason == "slot_not_captured"
        assert mark.mark_usd_ciphertext is None
        assert mark.spot_usd_ciphertext is None

        await _set_current_user(app_db_session, user_id)
        observation = (
            await app_db_session.execute(
                select(SnapshotObservation).where(
                    SnapshotObservation.leg_id == leg_id,
                    SnapshotObservation.slot_time == missing_slot,
                )
            )
        ).scalar_one()
        assert observation.gap_reason == "slot_not_captured"
        assert observation.raw_ciphertext is None


async def test_backfill_skips_a_slot_before_the_legs_position_opened(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    opened_at = _BACKFILL_SLOTS[1] + timedelta(minutes=1)
    leg_id = await _seed_leg_with_lifetime(
        app_db_session,
        user_id,
        occ_symbol="SPXW261017P07000000",
        root="SPXW",
        opened_at=opened_at,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await backfill_uncaptured_slot_gaps(
        app_db_session, user_id, start=_BACKFILL_SLOTS[0], end=_BACKFILL_SLOTS[-1]
    )
    await app_db_session.commit()

    assert outcome.gap_rows_written == 2

    await _set_current_user(app_db_session, user_id)
    for excluded_slot in (_BACKFILL_SLOTS[0], _BACKFILL_SLOTS[1]):
        row = (
            await app_db_session.execute(
                select(SnapshotMark).where(
                    SnapshotMark.leg_id == leg_id,
                    SnapshotMark.slot_time == excluded_slot,
                )
            )
        ).scalar_one_or_none()
        assert row is None


async def test_backfill_skips_a_slot_after_the_legs_position_closed(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    closed_at = _BACKFILL_SLOTS[1] + timedelta(minutes=1)
    leg_id = await _seed_leg_with_lifetime(
        app_db_session,
        user_id,
        occ_symbol="SPXW261018P07000000",
        root="SPXW",
        opened_at=datetime(2026, 6, 1, tzinfo=UTC),
        closed_at=closed_at,
    )

    await _set_current_user(app_db_session, user_id)
    outcome = await backfill_uncaptured_slot_gaps(
        app_db_session, user_id, start=_BACKFILL_SLOTS[0], end=_BACKFILL_SLOTS[-1]
    )
    await app_db_session.commit()

    assert outcome.gap_rows_written == 2

    await _set_current_user(app_db_session, user_id)
    for excluded_slot in (_BACKFILL_SLOTS[2], _BACKFILL_SLOTS[3]):
        row = (
            await app_db_session.execute(
                select(SnapshotMark).where(
                    SnapshotMark.leg_id == leg_id,
                    SnapshotMark.slot_time == excluded_slot,
                )
            )
        ).scalar_one_or_none()
        assert row is None


async def test_backfill_is_idempotent_on_a_second_run(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    leg_id = await _seed_leg_with_lifetime(
        app_db_session,
        user_id,
        occ_symbol="SPXW261019P07000000",
        root="SPXW",
        opened_at=datetime(2026, 6, 1, tzinfo=UTC),
    )

    await _set_current_user(app_db_session, user_id)
    first = await backfill_uncaptured_slot_gaps(
        app_db_session, user_id, start=_BACKFILL_SLOTS[0], end=_BACKFILL_SLOTS[-1]
    )
    await app_db_session.commit()
    assert first.gap_rows_written == 4

    await _set_current_user(app_db_session, user_id)
    created_before = (
        (
            await app_db_session.execute(
                select(SnapshotMark.created_at).where(SnapshotMark.leg_id == leg_id)
            )
        )
        .scalars()
        .all()
    )

    await _set_current_user(app_db_session, user_id)
    second = await backfill_uncaptured_slot_gaps(
        app_db_session, user_id, start=_BACKFILL_SLOTS[0], end=_BACKFILL_SLOTS[-1]
    )
    await app_db_session.commit()

    assert second.gap_rows_written == 0

    await _set_current_user(app_db_session, user_id)
    created_after = (
        (
            await app_db_session.execute(
                select(SnapshotMark.created_at).where(SnapshotMark.leg_id == leg_id)
            )
        )
        .scalars()
        .all()
    )
    assert sorted(created_before) == sorted(created_after)


async def test_cli_backfill_gaps_flag_reaches_the_shared_function(
    clean_snapshot_tables: None,
    provisioned_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Patches `backfill_uncaptured_slot_gaps` at its defining module and
    asserts the CLI's `--backfill-gaps` flag reaches it -- the same
    anti-drift discipline Task 2's own patch test applies to
    `repair_snapshot_marks` (D8-13)."""
    calls: list[tuple[UUID, datetime, datetime]] = []

    async def fake_backfill(
        session: AsyncSession, user_id: UUID, *, start: datetime, end: datetime
    ) -> BackfillOutcome:
        calls.append((user_id, start, end))
        return BackfillOutcome(slots_examined=0, gap_rows_written=0)

    monkeypatch.setattr(snapshot_repair, "backfill_uncaptured_slot_gaps", fake_backfill)

    user_id = provisioned_users.user_a
    exit_code = await tools_main(
        [
            str(user_id),
            "--backfill-gaps",
            _BACKFILL_SLOTS[0].isoformat(),
            _BACKFILL_SLOTS[-1].isoformat(),
        ]
    )
    assert exit_code == 0
    assert calls == [(user_id, _BACKFILL_SLOTS[0], _BACKFILL_SLOTS[-1])]
