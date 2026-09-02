"""The account's whole key lifecycle: provisioned with the account (Task 1)
and destroyed before its rows on deletion (Task 3) -- CRYPT-01, AUTH-06,
D3-05, D3-08. One module, not two, so the create and delete halves of
AUTH-06's lifecycle sit together.

`@pytest.mark.db` throughout -- every HTTP-driven test runs the real ASGI
app over `httpx.ASGITransport` against real Postgres, matching
`tests/identity/test_admin_routes.py`'s established pattern.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models_identity import AdminCreateUserResponse
from morai.crypto.envelope import unwrap_dek
from morai.db.models import (
    Event,
    Fill,
    Leg,
    Position,
    ReconciliationRun,
    SchwabConnection,
    SnapshotMark,
    SnapshotObservation,
    SnapshotRun,
)
from morai.db.models import Session as SessionRow
from morai.db.models import SetupToken, User, UserDataKey
from morai.identity.account import delete_account
from morai.identity.setup_tokens import TokenPurpose, issue_token
from morai.identity.tokens import generate_token, hash_token
from morai.ingest.reconciliation_runs import record_reconciliation_run
from morai.ingest.snapshot_runs import (
    SnapshotRunStatus,
    SnapshotTrigger,
    record_snapshot_run,
)
from morai.ingest.snapshots import (
    SnapshotWrite,
    write_snapshot_marks,
    write_snapshot_observations,
)
from morai.ledger.fills import FillWrite, insert_fills
from morai.ledger.reconciliation import (
    ReconciliationResult,
    ReconciliationVerdict,
    window_bounds,
)
from morai.settings import get_settings
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    SeededPosition,
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
)

# Re-exported, not merely imported -- pytest resolves a fixture's own
# dependencies (`provisioned_users`/`seeded_position` both need
# `clean_ledger_tables`) by name lookup in the *requesting* module's
# namespace. `tests/ledger/conftest.py` is not an applicable conftest for
# this directory, so `clean_ledger_tables` must be importable here too,
# even though no test body below references it directly (matching
# `tests/ledger/test_tracer_encrypted_fill.py`'s own convention).
__all__ = ["clean_ledger_tables", "provisioned_users", "seeded_position"]

pytestmark = pytest.mark.db

_CREATE_RESPONSE: TypeAdapter[AdminCreateUserResponse] = TypeAdapter(
    AdminCreateUserResponse
)

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
# 14:30 UTC on a June weekday is 10:30 America/New_York -- a real RTH slot
# boundary, so `slot_time` is a value the capture path could itself produce.
_SLOT_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
_TRADING_DAY = date(2026, 6, 18)


async def _seed_session(superuser_db_session: AsyncSession, user_id: UUID) -> str:
    token = generate_token()
    await superuser_db_session.execute(
        insert(SessionRow).values(
            token_hash=hash_token(token),
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(days=30),
        )
    )
    await superuser_db_session.commit()
    return token


@pytest_asyncio.fixture
async def client(clean_identity_tables: None) -> AsyncGenerator[AsyncClient, None]:
    from morai.api.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# --- Task 1: account creation provisions the data key -----------------


async def test_account_creation_provisions_exactly_one_key_at_version_one(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "fresh-account"},
        cookies={"morai_session": admin_token},
    )
    assert created.status_code == 200
    body = _CREATE_RESPONSE.validate_json(created.content)

    rows = (
        (
            await superuser_db_session.execute(
                select(UserDataKey).where(UserDataKey.user_id == body.user_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].key_version == 1
    assert rows[0].wrapped_dek is not None
    assert rows[0].wrap_nonce is not None


async def test_the_provisioned_key_unwraps_to_thirty_two_bytes(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "unwrap-check"},
        cookies={"morai_session": admin_token},
    )
    body = _CREATE_RESPONSE.validate_json(created.content)

    row = (
        await superuser_db_session.execute(
            select(UserDataKey).where(UserDataKey.user_id == body.user_id)
        )
    ).scalar_one()
    dek = unwrap_dek(row.wrapped_dek, row.wrap_nonce, get_settings().master_key_bytes)
    assert len(dek) == 32


async def test_the_admin_cannot_read_the_new_users_key_through_the_app_role(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    created = await client.post(
        "/admin/users",
        json={"username": "admin-cannot-read"},
        cookies={"morai_session": admin_token},
    )
    body = _CREATE_RESPONSE.validate_json(created.content)

    await app_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(seeded_users.admin)},
    )
    rows = (
        await app_db_session.execute(
            select(UserDataKey).where(UserDataKey.user_id == body.user_id)
        )
    ).all()
    assert rows == []


async def test_a_failure_provisioning_the_key_leaves_no_user_row_behind(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import morai.api.routes_identity as routes_identity

    async def _boom(session: AsyncSession, user_id: UUID) -> None:
        raise RuntimeError("simulated provisioning failure")

    monkeypatch.setattr(routes_identity, "provision_data_key", _boom)
    admin_token = await _seed_session(superuser_db_session, seeded_users.admin)

    # `install_error_handling` catches everything into an opaque 500, but
    # Starlette's outer ServerErrorMiddleware re-raises after sending it so
    # a process supervisor still sees the crash -- httpx's ASGITransport
    # re-raises that same exception back to the caller by default
    # (api/errors.py's own module docstring).
    with pytest.raises(RuntimeError, match="simulated provisioning failure"):
        await client.post(
            "/admin/users",
            json={"username": "should-not-exist"},
            cookies={"morai_session": admin_token},
        )

    rows = (
        (
            await superuser_db_session.execute(
                select(User).where(User.username == "should-not-exist")
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


# --- Task 3: deletion destroys the key first and the rows second ------


async def test_delete_account_removes_every_row_across_every_table(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """`seeded_position` already seeds a position and two legs for user_a --
    covers positions/legs without extra seeding here."""
    await superuser_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(provisioned_users.user_a)},
    )
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="del-a-1",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="BUY",
                quantity=None,
                price_usd=None,
            )
        ],
    )
    await _seed_session(superuser_db_session, provisioned_users.user_a)
    await issue_token(
        superuser_db_session,
        user_id=provisioned_users.user_a,
        purpose=TokenPurpose.SETUP,
        ttl=timedelta(days=1),
    )
    await superuser_db_session.commit()

    await delete_account(superuser_db_session, provisioned_users.user_a)
    await superuser_db_session.commit()

    assert (
        await superuser_db_session.execute(
            select(UserDataKey).where(UserDataKey.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(Fill).where(Fill.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(Event).where(Event.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(Leg).where(Leg.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(Position).where(Position.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(SessionRow).where(SessionRow.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(SetupToken).where(SetupToken.user_id == provisioned_users.user_a)
        )
    ).all() == []
    assert (
        await superuser_db_session.execute(
            select(User).where(User.id == provisioned_users.user_a)
        )
    ).scalar_one_or_none() is None


async def test_delete_me_with_a_valid_session_deletes_the_account_and_clears_cookie(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    token = await _seed_session(superuser_db_session, seeded_users.user_a)

    response = await client.delete("/me", cookies={"morai_session": token})

    assert response.status_code == 204
    raw_cookie = response.headers["set-cookie"].lower()
    assert "morai_session=" in raw_cookie

    row = (
        await superuser_db_session.execute(
            select(User).where(User.id == seeded_users.user_a)
        )
    ).scalar_one_or_none()
    assert row is None


async def test_delete_me_without_a_session_returns_401(client: AsyncClient) -> None:
    response = await client.delete("/me")
    assert response.status_code == 401


async def test_deleting_an_account_with_a_schwab_connection_leaves_no_orphan_row(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Phase 4: `schwab_connections.user_id -> users.id` is an uncascaded
    foreign key -- without the delete Task 2 adds, this transaction fails
    on that constraint the moment a connection row exists for the account
    being deleted."""
    await superuser_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(provisioned_users.user_a)},
    )
    await upsert_connection(
        superuser_db_session,
        provisioned_users.user_a,
        ExchangedToken(
            token={"refresh_token": "user-a-token"}, created_at=_EXECUTION_TIME
        ),
        "user-a-account-hash",
    )
    await superuser_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(provisioned_users.user_b)},
    )
    await upsert_connection(
        superuser_db_session,
        provisioned_users.user_b,
        ExchangedToken(
            token={"refresh_token": "user-b-token"}, created_at=_EXECUTION_TIME
        ),
        "user-b-account-hash",
    )
    await superuser_db_session.commit()

    await delete_account(superuser_db_session, provisioned_users.user_a)
    await superuser_db_session.commit()

    assert (
        await superuser_db_session.execute(
            select(SchwabConnection).where(
                SchwabConnection.user_id == provisioned_users.user_a
            )
        )
    ).all() == []
    remaining = (
        await superuser_db_session.execute(
            select(SchwabConnection).where(
                SchwabConnection.user_id == provisioned_users.user_b
            )
        )
    ).scalar_one_or_none()
    assert remaining is not None


async def test_deleting_ones_own_account_does_not_touch_another_users(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """No route shape names another user's account -- proven the only way an
    HTTP test can: deleting the caller's own account leaves a second user's
    row and session fully intact."""
    token_a = await _seed_session(superuser_db_session, seeded_users.user_a)
    token_b = await _seed_session(superuser_db_session, seeded_users.user_b)

    response = await client.delete("/me", cookies={"morai_session": token_a})
    assert response.status_code == 204

    row_a = (
        await superuser_db_session.execute(
            select(User).where(User.id == seeded_users.user_a)
        )
    ).scalar_one_or_none()
    assert row_a is None

    still_there = await client.get("/me", cookies={"morai_session": token_b})
    assert still_there.status_code == 200


async def test_deleting_an_account_with_snapshot_and_reconciliation_rows(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Phases 8 and 9 added four more tables carrying an uncascaded
    `user_id -> users.id` foreign key -- `snapshot_observations` and
    `snapshot_marks` (both also uncascaded to `legs.id`), `snapshot_runs`
    and `reconciliation_runs`. Same shape as the Phase 4 case above:
    without a delete for each, the whole transaction fails on those
    constraints the moment a user has ever had a snapshot captured or a
    window reconciled, so `DELETE /me` deletes nothing at all -- the data
    key included.

    `reconciliation_runs` raises the stakes past an orphan row. Migration
    0016 stores its four money columns as plaintext `Numeric`, on purpose
    (`D9-13`, `D9-15`), so step 1's crypto-shred does not reach them.
    Deleting the row is the only thing that removes that user's realised
    P&L from the database.
    """
    await superuser_db_session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(provisioned_users.user_a)},
    )
    snapshot_write = SnapshotWrite(
        leg_id=seeded_position.front_leg_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        raw_payload={"mark": "1.2500"},
        mark_usd=Decimal("1.2500"),
        spot_usd=Decimal("6050.0000"),
        gap_reason=None,
    )
    assert (
        await write_snapshot_observations(
            superuser_db_session, provisioned_users.user_a, [snapshot_write]
        )
        == 1
    )
    assert (
        await write_snapshot_marks(
            superuser_db_session, provisioned_users.user_a, [snapshot_write]
        )
        == 1
    )
    await record_snapshot_run(
        superuser_db_session,
        provisioned_users.user_a,
        slot_time=_SLOT_TIME,
        started_at=_SLOT_TIME,
        finished_at=_SLOT_TIME,
        trigger=SnapshotTrigger.SCHEDULED,
        status=SnapshotRunStatus.SUCCEEDED,
        legs_attempted=1,
        marks_written=1,
        gaps_by_reason=None,
        error_code=None,
    )
    window_start, window_end = window_bounds(_TRADING_DAY)
    await record_reconciliation_run(
        superuser_db_session,
        provisioned_users.user_a,
        result=ReconciliationResult(
            trading_day=_TRADING_DAY,
            window_start=window_start,
            window_end=window_end,
            realised_pnl_usd=Decimal("125.5000"),
            commissions_usd=Decimal("2.6000"),
            cash_delta_usd=Decimal("125.5000"),
            signed_difference_usd=Decimal("0.0000"),
            verdict=ReconciliationVerdict.PASSED,
            reason=None,
        ),
        checked_at=_SLOT_TIME,
        is_reopening=False,
    )
    await superuser_db_session.commit()

    await delete_account(superuser_db_session, provisioned_users.user_a)
    await superuser_db_session.commit()

    for model in (SnapshotObservation, SnapshotMark, SnapshotRun, ReconciliationRun):
        assert (
            await superuser_db_session.execute(
                select(model).where(model.user_id == provisioned_users.user_a)
            )
        ).all() == [], f"{model.__name__} still holds a deleted user's rows"
    assert (
        await superuser_db_session.execute(
            select(User).where(User.id == provisioned_users.user_a)
        )
    ).scalar_one_or_none() is None
