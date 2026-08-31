"""Phase 2's equivalent of Phase 1's thirteen-fixture oracle (`02-CONTEXT.md`
`<specifics>`). Every zero-rows claim this file makes is bracketed by a
privilege precondition on its own connection and by a superuser positive
control running byte-identical SQL -- without both, "zero rows" only proves
the table was reachable, not that a policy fired.

`@pytest.mark.db` -- runs only where Postgres is reachable (CI's
`test-pytest` job). There is no local database (Docker's daemon is broken
here, Railway's Postgres is private-network-only).

Fixtures (`app_db_session`, `superuser_db_session`, `seeded_users`,
`clean_identity_tables`) live in `tests/identity/conftest.py`, one directory
below this file, so pytest's normal conftest-scoping does not reach them.
`pytest_plugins = ["tests.identity.conftest"]` was tried first and rejected
(Rule 1, measured): pytest already auto-loads that file as a directory
conftest for everything under `tests/identity/`, and registering the same
module a second time under a dotted name raises `ValueError: Plugin already
registered under a different name` the moment both are collected in one
session. Importing the fixture *functions* directly avoids the double
registration -- pytest resolves a fixture by name from the requesting
module's own namespace, so an imported `@pytest.fixture` object works
exactly like a locally-defined one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import Insert, insert, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.routes_identity import PositionResponse
from morai.db.models import Event, Fill, Leg, Position, UserDataKey
from morai.ledger.events import EventWrite, insert_events
from morai.ledger.fills import FillWrite, insert_fills
from tests.identity.conftest import (
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    seeded_users,
    superuser_db_session,
)
from tests.ledger.conftest import clean_ledger_tables, provisioned_users

from tests.identity.test_tracer_scoped_read import (
    _seed_session,  # pyright: ignore[reportPrivateUsage]  # why: reusing plan 02-01's own cookie/auth helper, not reinventing it -- the leading underscore is a test-internal convention, not a real access boundary between two files in the same suite
    client,
)

# Re-exported, not merely imported: these names are never referenced by an
# expression in this module -- pytest finds them by name lookup in this
# module's namespace when resolving a same-named fixture parameter. `__all__`
# tells both ruff (F401) and basedpyright (reportUnusedImport) that the
# import is the point, without a per-line noqa.
__all__ = [
    "SeededUsers",
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "client",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db


# `Row` (raw `text()` results) types every column as `Any` -- same
# untyped-boundary shape `tests/identity/test_app_role.py` already
# established. `TypeAdapter` narrows at that boundary (D-06); indexed access
# (`row[0]`), never attribute access, matching that file's own convention.
_BOOL: TypeAdapter[bool] = TypeAdapter(bool)
_UUID: TypeAdapter[UUID] = TypeAdapter(UUID)
_STR: TypeAdapter[str] = TypeAdapter(str)
_OPTIONAL_STR: TypeAdapter[str | None] = TypeAdapter(str | None)

# Shared by both arms of the positive control (the app-role arm and the
# superuser arm) -- one module-level constant so the two queries cannot drift
# apart. No `WHERE user_id = ...` anywhere: the absence is the test. Moved
# onto `positions` from `gate_user_scoped_probe` (03-06): the isolation
# proof now runs against a real trading table, not a stand-in for one.
_CROSS_TENANT_SELECT = text("SELECT id, user_id FROM positions")

# Task 2's HTTP arm parses the listing route's response the same way
# `tests/identity/test_tracer_scoped_read.py` does -- reused, not reinvented.
_POSITION_LIST: TypeAdapter[list[PositionResponse]] = TypeAdapter(
    list[PositionResponse]
)


async def _set_current_user(
    session: AsyncSession, user_id: UUID, *, is_admin: bool = False
) -> None:
    """`set_config`, not `SET LOCAL ... :uid` -- Postgres's `SET` grammar only
    accepts a literal there, never a bind parameter (`identity/sessions.py`'s
    module docstring, measured in CI during plan 02-01).

    `is_admin` mirrors `identity/sessions.py::get_current_user`'s own
    behavior: `app.is_admin` is set to `'true'` only when the caller is an
    admin, and left unset otherwise -- never explicitly set to `'false'`."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    if is_admin:
        await session.execute(text("SELECT set_config('app.is_admin', 'true', true)"))


async def test_the_test_connection_cannot_bypass_rls(
    app_db_session: AsyncSession,
) -> None:
    """Every other assertion in this file is meaningless if this one fails.

    Named first, on purpose: if the connection making a zero-rows claim can
    itself bypass RLS (superuser or `BYPASSRLS`), every "zero rows" result
    below would mean nothing -- it would be measuring an inert policy and
    reporting it as a working one. CI's own Postgres user (`morai`,
    `POSTGRES_USER`-created) is a superuser by the official image's own
    documentation, which is exactly the hazard this test exists to catch
    before it can hide behind an application-filter false green.
    """
    row = (
        await app_db_session.execute(
            text(
                "SELECT rolsuper, rolbypassrls FROM pg_roles "
                "WHERE rolname = current_user"
            )
        )
    ).one()
    assert (_BOOL.validate_python(row[0]), _BOOL.validate_python(row[1])) == (
        False,
        False,
    )
    result = await app_db_session.execute(
        text("SELECT current_setting('is_superuser')")
    )
    assert _STR.validate_python(result.scalar_one()) == "off"


async def test_raw_cross_tenant_select_as_app_role_returns_only_the_context_user_rows(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """No `WHERE` clause anywhere in `_CROSS_TENANT_SELECT` -- routing through
    a repository would re-introduce the application filter this test exists
    to look past. Raw SQL through `sa.text`, not the ORM."""
    await _set_current_user(app_db_session, seeded_users.user_a)
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows, "expected at least user A's own seeded row"
    ids = {_UUID.validate_python(row[0]) for row in rows}
    owners = {_UUID.validate_python(row[1]) for row in rows}
    assert owners == {seeded_users.user_a}
    assert seeded_users.position_b not in ids


async def test_the_identical_select_as_superuser_returns_every_seeded_row(
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The positive control. If this test ever fails, the previous test's
    green is worthless -- it proves the previous test measured a policy and
    not an empty table, a misspelled relation, or a seed fixture that
    quietly did nothing. Same `_CROSS_TENANT_SELECT` constant, same `SET
    LOCAL`-equivalent context; only the connecting role differs."""
    await _set_current_user(superuser_db_session, seeded_users.user_a)
    rows = (await superuser_db_session.execute(_CROSS_TENANT_SELECT)).all()
    ids = {_UUID.validate_python(row[0]) for row in rows}
    assert {seeded_users.position_a, seeded_users.position_b} <= ids


async def test_unset_context_returns_zero_rows(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """Confirms the policy fails closed by construction (research Assumption
    A5: `user_id = NULL` is NULL, not TRUE, so an unset context excludes
    every row). Paired with an assertion that the setting really is unset,
    so this test says *why* it got zero rows rather than only that it did."""
    setting = _OPTIONAL_STR.validate_python(
        (
            await app_db_session.execute(
                text("SELECT current_setting('app.current_user_id', true)")
            )
        ).scalar_one()
    )
    assert setting is None
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows == []


async def test_context_set_to_a_user_with_no_rows_returns_zero_rows(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """A third seeded user (the admin, who owns no `positions` row) who
    owns no rows. Distinguishes "the policy excluded rows" from "the
    context is broken and always excludes everything", which the previous
    two tests together otherwise leave open."""
    await _set_current_user(app_db_session, seeded_users.admin)
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows == []


async def test_a_write_for_another_user_is_rejected_by_the_policy(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The `WITH CHECK` half of the policy has its own test; a `USING`-only
    policy would let a user plant rows in another user's namespace, and this
    is the only thing that catches that. A plain ORM insert against
    `positions`, not the fill write path -- this is a test of the policy
    alone, and needs no data key."""
    await _set_current_user(app_db_session, seeded_users.user_a)
    with pytest.raises(DBAPIError):
        await app_db_session.execute(
            insert(Position).values(user_id=seeded_users.user_b)
        )


# --- Task 2: admin is not exempt, and the HTTP surface says not-found rather
# than forbidden (D2-08). Its own named tests, not a parameter on the tests
# above -- the admin case is the one a reasonable developer would assume is
# an exception (02-CONTEXT.md D2-08 and `<specifics>`).


async def test_admin_is_not_exempt_from_the_probe_table_policy(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The case most likely to be wrong: the admin genuinely does need
    cross-user reach on `users` for AUTH-01/AUTH-05, so the instinct is to
    grant it everywhere. `positions` carries no admin clause (migration
    0008) -- doing so here would make this phase's whole encryption boundary
    decorative (D2-08, D3-18), and now genuinely would: this is no longer a
    stand-in table proving a principle for later, it is one of the real
    trading tables the principle protects. Context set exactly as the real
    auth dependency produces it for an admin: both `app.current_user_id`
    and `app.is_admin`."""
    await _set_current_user(app_db_session, seeded_users.admin, is_admin=True)
    rows = (await app_db_session.execute(_CROSS_TENANT_SELECT)).all()
    assert rows == []


async def test_admin_can_read_another_users_account_row(
    app_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The deliberate counterpart. Proves the `users` policy's admin clause
    is real and that the previous test's zero rows is a policy difference --
    not a broken `app.is_admin` context. Two tables, two policies, opposite
    results, same connection, same context."""
    await _set_current_user(app_db_session, seeded_users.admin, is_admin=True)
    row = (
        await app_db_session.execute(
            text("SELECT id, username FROM users WHERE id = :user_id"),
            {"user_id": str(seeded_users.user_a)},
        )
    ).one_or_none()
    assert row is not None
    assert _UUID.validate_python(row[0]) == seeded_users.user_a


async def test_admin_gets_404_for_another_users_probe_row_over_http(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The HTTP arm. An admin session cookie asking for another user's
    position gets not-found, not forbidden (D2-08) -- the detail route has
    no admin path."""
    token = await _seed_session(superuser_db_session, seeded_users.admin)
    response = await client.get(
        f"/gate/positions/{seeded_users.position_b}",
        cookies={"morai_session": token},
    )
    assert response.status_code == 404


async def test_the_two_404_bodies_are_byte_identical(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """A 403, or a differing body, confirms the row exists -- the disclosure
    D2-08 forbids. `response.content` compared directly, not parsed JSON: a
    difference in key order or whitespace is still a difference an attacker
    can measure. Headers compared too, excluding only `X-Request-Id`
    (per-request by design)."""
    token = await _seed_session(superuser_db_session, seeded_users.admin)
    another_users_row = await client.get(
        f"/gate/positions/{seeded_users.position_b}",
        cookies={"morai_session": token},
    )
    truly_absent_row = await client.get(
        f"/gate/positions/{uuid4()}",
        cookies={"morai_session": token},
    )
    assert another_users_row.status_code == 404
    assert truly_absent_row.status_code == 404
    assert another_users_row.content == truly_absent_row.content
    headers_a = {
        key.lower(): value
        for key, value in another_users_row.headers.items()
        if key.lower() != "x-request-id"
    }
    headers_b = {
        key.lower(): value
        for key, value in truly_absent_row.headers.items()
        if key.lower() != "x-request-id"
    }
    assert headers_a == headers_b


async def test_admin_probe_listing_returns_only_the_admins_own_rows(
    client: AsyncClient,
    superuser_db_session: AsyncSession,
    seeded_users: SeededUsers,
) -> None:
    """The listing route, like the detail route, has no admin path. The admin
    owns no `positions` row (`SeededUsers`), so the only correct response is
    an empty list -- never A's or B's rows."""
    token = await _seed_session(superuser_db_session, seeded_users.admin)
    response = await client.get("/gate/positions", cookies={"morai_session": token})
    assert response.status_code == 200
    rows = _POSITION_LIST.validate_json(response.content)
    assert rows == []


# --- Task 3: the same guarantee across all five new tables. `positions`
# already has its own eleven guards above; this widens the cross-tenant and
# write-rejection claims to `user_data_keys`, `legs`, `fills` and `events`
# too, so a table added to this schema without a policy fails a test rather
# than passing silently (T-03-32).

_NEW_TRADING_TABLES = ("user_data_keys", "positions", "legs", "fills", "events")


@dataclass(frozen=True)
class _DualUserRows:
    """One position (with one leg on it), one fill and one event per user.
    `positions`/`legs` are seeded through the superuser session -- no
    dedicated write path exists for them this phase
    (`tests/ledger/conftest.py`'s own `seeded_position` precedent). `fills`/
    `events` go through their real write paths (`insert_fills`/
    `insert_events`), so this guard exercises the encrypted tables as they
    are actually written, not a hand-built approximation."""

    position_a: UUID
    position_b: UUID


@pytest_asyncio.fixture
async def two_user_trading_rows(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> _DualUserRows:
    position_a = (
        await superuser_db_session.execute(
            insert(Position)
            .values(user_id=provisioned_users.user_a)
            .returning(Position.id)
        )
    ).scalar_one()
    position_b = (
        await superuser_db_session.execute(
            insert(Position)
            .values(user_id=provisioned_users.user_b)
            .returning(Position.id)
        )
    ).scalar_one()
    await superuser_db_session.execute(
        insert(Leg).values(
            position_id=position_a,
            user_id=provisioned_users.user_a,
            leg_role="front",
            occ_symbol="TWO-USER-GUARD-A",
            root="SPXW",
        )
    )
    await superuser_db_session.execute(
        insert(Leg).values(
            position_id=position_b,
            user_id=provisioned_users.user_b,
            leg_role="front",
            occ_symbol="TWO-USER-GUARD-B",
            root="SPXW",
        )
    )
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="two-user-guard",
                occ_symbol="TWO-USER-GUARD-A",
                leg_index=0,
                execution_time=datetime.now(UTC),
                position_effect="OPEN",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("100.00"),
            )
        ],
    )
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_b,
        [
            FillWrite(
                order_id="two-user-guard",
                occ_symbol="TWO-USER-GUARD-B",
                leg_index=0,
                execution_time=datetime.now(UTC),
                position_effect="OPEN",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("100.00"),
            )
        ],
    )
    await insert_events(
        superuser_db_session,
        provisioned_users.user_a,
        [
            EventWrite(
                position_id=position_a,
                event_type="OPEN",
                event_time=datetime.now(UTC),
                fill_ids_hash=None,
                open_debit_usd=Decimal("100.00"),
                close_credit_usd=None,
            )
        ],
    )
    await insert_events(
        superuser_db_session,
        provisioned_users.user_b,
        [
            EventWrite(
                position_id=position_b,
                event_type="OPEN",
                event_time=datetime.now(UTC),
                fill_ids_hash=None,
                open_debit_usd=Decimal("100.00"),
                close_credit_usd=None,
            )
        ],
    )
    await superuser_db_session.commit()
    return _DualUserRows(position_a=position_a, position_b=position_b)


@pytest.mark.parametrize("table_name", _NEW_TRADING_TABLES)
async def test_cross_tenant_select_excludes_other_users_rows_on_every_new_table(
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    two_user_trading_rows: _DualUserRows,
    table_name: str,
) -> None:
    """Every table in `_NEW_TRADING_TABLES` gets the same bracketed proof
    the eleven guards above give `positions` alone: no `WHERE` clause, an
    app-role arm and a superuser positive control running byte-identical
    SQL, differing only in which role executes it. A table shipped without
    a policy fails this parametrized case rather than passing silently."""
    query = text(f"SELECT user_id FROM {table_name}")

    await _set_current_user(app_db_session, provisioned_users.user_a)
    app_owners = {
        _UUID.validate_python(row[0])
        for row in (await app_db_session.execute(query)).all()
    }
    assert app_owners == {provisioned_users.user_a}

    await _set_current_user(superuser_db_session, provisioned_users.user_a)
    superuser_owners = {
        _UUID.validate_python(row[0])
        for row in (await superuser_db_session.execute(query)).all()
    }
    assert {provisioned_users.user_a, provisioned_users.user_b} <= superuser_owners


def _plant_statement(
    table_name: str, victim_user_id: UUID, victim_position_id: UUID
) -> Insert:
    """The row a compromised or malicious `user_a` session would try to
    plant in `user_b`'s namespace -- one shape per table, with every
    NOT NULL column satisfied so the policy's `WITH CHECK` is what fails
    the insert, not an unrelated column constraint. `key_version`/PK values
    are chosen never to collide with a row `two_user_trading_rows` already
    seeded, so a collision can't be mistaken for a policy rejection."""
    if table_name == "user_data_keys":
        return insert(UserDataKey).values(
            user_id=victim_user_id,
            key_version=99,
            wrapped_dek=b"planted-wrapped-dek",
            wrap_nonce=b"planted-nonc",
        )
    if table_name == "positions":
        return insert(Position).values(user_id=victim_user_id)
    if table_name == "legs":
        return insert(Leg).values(
            position_id=victim_position_id,
            user_id=victim_user_id,
            leg_role="planted",
            occ_symbol="PLANTED",
            root="SPXW",
        )
    if table_name == "fills":
        return insert(Fill).values(
            user_id=victim_user_id,
            order_id="planted-order",
            occ_symbol="PLANTED",
            leg_index=99,
            execution_time=datetime.now(UTC),
            position_effect="OPEN",
            side="BUY",
            key_version=1,
        )
    if table_name == "events":
        return insert(Event).values(
            user_id=victim_user_id,
            position_id=victim_position_id,
            event_type="OPEN",
            event_time=datetime.now(UTC),
            key_version=1,
        )
    raise AssertionError(f"no plant statement defined for {table_name}")


@pytest.mark.parametrize("table_name", _NEW_TRADING_TABLES)
async def test_a_write_for_another_user_is_rejected_on_every_new_table(
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    two_user_trading_rows: _DualUserRows,
    table_name: str,
) -> None:
    """The `WITH CHECK` half of the policy, widened to all five tables.
    `Fill`'s own `_write_token` constructor gate is irrelevant here -- this
    uses `insert(Fill)`, a Core statement naming the table directly, the
    same bypass `Fill.__init__`'s own docstring names as its honest
    ceiling, exactly like the single-table guard above does for
    `positions`."""
    await _set_current_user(app_db_session, provisioned_users.user_a)
    statement = _plant_statement(
        table_name, provisioned_users.user_b, two_user_trading_rows.position_b
    )
    with pytest.raises(DBAPIError):
        await app_db_session.execute(statement)


@pytest.mark.parametrize("table_name", _NEW_TRADING_TABLES)
async def test_no_policy_on_a_new_table_names_the_admin_setting(
    superuser_db_session: AsyncSession, table_name: str
) -> None:
    """`users` is the one deliberate admin-clause exception in this schema
    (migration 0003) -- a data table inheriting it makes this phase's
    encryption boundary decorative (`identity/audit.py`'s own docstring,
    D3-18). Now that the encrypted tables exist, this check is mechanical
    rather than a review convention, matching
    `tests/ledger/test_schema_contract.py`'s identical assertion for
    `positions`/`legs`/`events` -- widened here to include `fills` and
    `user_data_keys` too, which that file's own scope never covered."""
    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT qual, with_check FROM pg_policies WHERE tablename = :table_name"
            ),
            {"table_name": table_name},
        )
    ).all()
    combined = " ".join(
        f"{_STR.validate_python(row[0])} {_STR.validate_python(row[1])}" for row in rows
    )
    assert "is_admin" not in combined
