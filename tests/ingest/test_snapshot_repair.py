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
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.data_keys import dek_for_version
from morai.crypto.envelope import decrypt_field, generate_dek, wrap_dek
from morai.db.models import SnapshotMark, SnapshotObservation, UserDataKey
from morai.ingest.snapshot_repair import repair_snapshot_marks
from morai.ingest.snapshots import (
    SnapshotGapReason,
    SnapshotWrite,
    _snapshot_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this suite decrypts the stored mark back to prove digit-for-digit fidelity with the seeded observation's own payload -- it needs the exact AAD helper the writers use, the same cooperating-test convention test_snapshot_capture.py already uses.
    write_snapshot_marks,
    write_snapshot_observations,
)
from morai.settings import get_settings
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import QUOTE_PAYLOAD
from tests.ledger.conftest import SeededPosition

pytestmark = pytest.mark.db

# Monday, 10:30 ET (EDT, UTC-4) -- on the RTH grid (D8-06), the same slot
# `test_snapshot_capture.py` uses.
_SLOT_TIME = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)

# The two decrypted mark values `QUOTE_PAYLOAD` (tests/ingest/conftest.py)
# carries for `seeded_position`'s own two legs.
_FRONT_MARK = Decimal("44.8567")
_BACK_MARK = Decimal("30.1233")


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
