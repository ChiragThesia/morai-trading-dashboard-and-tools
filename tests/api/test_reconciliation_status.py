"""`GET /reconciliation/status` (Phase 9, `RECON-03`, `RECON-04`, `API-01`,
`D9-13`..`D9-15`).

Every row this file seeds goes through `record_reconciliation_run`, the
real write path (`D3-14`), never a direct table insert -- on the superuser
session, which bypasses RLS the same way `tests/ingest/test_sync_tracer.py`'s
own `_seed_connection` does, so no `app.current_user_id` context needs
setting first.

Test 11 is this task's own named RED: seeded, run and its real (failing)
output recorded in `09-03-SUMMARY.md` *before* `reconciliation_standing`
read every window's own latest verdict rather than only the newest row.

Most assertions parse the response through the real
`ReconciliationStatusResponse` -- exactly what a client does, and typed
end to end with no `Any` (`response.json()` types as `Any`, httpx's own
stub, the same untyped boundary `tests/gate/test_api_boundary.py`'s own
docstring names). Test 2's money-as-string proof is the deliberate
exception: parsing through the real model would coerce a numeric literal
on the wire into `Decimal` via `UsdField`'s `BeforeValidator` without ever
revealing the mistake, so that one test narrows the raw JSON through a
`TypeAdapter[dict[str, JsonValue]]` instead (`D-06`'s own convention for
narrowing an untyped boundary, never `cast`).
"""

from __future__ import annotations

import ast
import asyncio
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.routing import BaseRoute

from morai.api.routes_reconciliation import ReconciliationStatusResponse
from morai.ingest.reconciliation_runs import record_reconciliation_run
from morai.ledger.reconciliation import (
    IndeterminateReason,
    ReconciliationResult,
    ReconciliationVerdict,
)
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

# Repo-root-relative, resolved from this file's own location -- robust
# regardless of the process cwd (`tests/conftest.py`'s own
# `isolate_from_ambient_dotenv` never chdirs, but this is cheap insurance
# against that changing later).
_ROUTES_FILE = (
    Path(__file__).resolve().parent.parent.parent
    / "src/morai/api/routes_reconciliation.py"
)

_WINDOW_START = (9, 30)
_WINDOW_END = (16, 0)

_JSON_OBJECT: TypeAdapter[dict[str, JsonValue]] = TypeAdapter(dict[str, JsonValue])


def _window_for(trading_day: date) -> tuple[datetime, datetime]:
    start = datetime(
        trading_day.year, trading_day.month, trading_day.day, *_WINDOW_START, tzinfo=UTC
    )
    end = datetime(
        trading_day.year, trading_day.month, trading_day.day, *_WINDOW_END, tzinfo=UTC
    )
    return start, end


async def _seed_passed(
    superuser_db_session: AsyncSession,
    user_id: UUID,
    *,
    trading_day: date,
    checked_at: datetime,
    is_reopening: bool = False,
) -> None:
    window_start, window_end = _window_for(trading_day)
    result = ReconciliationResult(
        trading_day=trading_day,
        window_start=window_start,
        window_end=window_end,
        realised_pnl_usd=Decimal("100.0000"),
        commissions_usd=Decimal("5.0000"),
        cash_delta_usd=Decimal("95.0000"),
        signed_difference_usd=Decimal("0.0000"),
        verdict=ReconciliationVerdict.PASSED,
        reason=None,
    )
    await record_reconciliation_run(
        superuser_db_session,
        user_id,
        result=result,
        checked_at=checked_at,
        is_reopening=is_reopening,
    )
    await superuser_db_session.commit()


async def _seed_failed(
    superuser_db_session: AsyncSession,
    user_id: UUID,
    *,
    trading_day: date,
    checked_at: datetime,
    difference: Decimal,
    is_reopening: bool = False,
) -> None:
    window_start, window_end = _window_for(trading_day)
    result = ReconciliationResult(
        trading_day=trading_day,
        window_start=window_start,
        window_end=window_end,
        realised_pnl_usd=Decimal("100.0000"),
        commissions_usd=Decimal("5.0000"),
        cash_delta_usd=Decimal("95.0000") - difference,
        signed_difference_usd=difference,
        verdict=ReconciliationVerdict.FAILED,
        reason=None,
    )
    await record_reconciliation_run(
        superuser_db_session,
        user_id,
        result=result,
        checked_at=checked_at,
        is_reopening=is_reopening,
    )
    await superuser_db_session.commit()


async def _seed_indeterminate(
    superuser_db_session: AsyncSession,
    user_id: UUID,
    *,
    trading_day: date,
    checked_at: datetime,
    reason: IndeterminateReason = IndeterminateReason.COMMISSION_UNAVAILABLE,
    is_reopening: bool = False,
) -> None:
    window_start, window_end = _window_for(trading_day)
    result = ReconciliationResult(
        trading_day=trading_day,
        window_start=window_start,
        window_end=window_end,
        realised_pnl_usd=None,
        commissions_usd=None,
        cash_delta_usd=None,
        signed_difference_usd=None,
        verdict=ReconciliationVerdict.INDETERMINATE,
        reason=reason,
    )
    await record_reconciliation_run(
        superuser_db_session,
        user_id,
        result=result,
        checked_at=checked_at,
        is_reopening=is_reopening,
    )
    await superuser_db_session.commit()


async def _get_status(client: AsyncClient) -> ReconciliationStatusResponse:
    response = await client.get("/reconciliation/status")
    assert response.status_code == 200
    return ReconciliationStatusResponse.model_validate_json(response.content)


# --- Test 1 -----------------------------------------------------------


async def test_never_run_returns_200_with_trustworthy_false_and_no_last_run(
    logged_in_client: AsyncClient,
) -> None:
    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is False
    assert parsed.last_run is None
    assert parsed.unresolved_run is None


# --- Test 2 -----------------------------------------------------------


async def test_passed_row_reports_trustworthy_true_with_money_as_json_strings(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    trading_day = date(2026, 6, 18)
    checked_at = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=trading_day,
        checked_at=checked_at,
    )

    response = await logged_in_client.get("/reconciliation/status")
    assert response.status_code == 200

    parsed = ReconciliationStatusResponse.model_validate_json(response.content)
    assert parsed.trustworthy is True
    assert parsed.unresolved_run is None
    assert parsed.last_run is not None
    assert parsed.last_run.trading_day == trading_day
    assert parsed.last_run.verdict == ReconciliationVerdict.PASSED
    assert parsed.last_run.reason is None
    assert parsed.last_run.realised_pnl_usd == Decimal("100.0000")
    assert parsed.last_run.commissions_usd == Decimal("5.0000")
    assert parsed.last_run.cash_delta_usd == Decimal("95.0000")
    assert parsed.last_run.signed_difference_usd == Decimal("0.0000")

    # D-03: money crosses the wire as a JSON string, never a numeric
    # literal -- narrowed from the *raw* response body through a
    # `TypeAdapter`, not the real model (`UsdField`'s own
    # `BeforeValidator` accepts either shape and would hide a wire-format
    # regression), and not `response.json()` (types as `Any`).
    raw = _JSON_OBJECT.validate_json(response.content)
    last_run_raw = raw["last_run"]
    assert isinstance(last_run_raw, dict)
    for field in (
        "realised_pnl_usd",
        "commissions_usd",
        "cash_delta_usd",
        "signed_difference_usd",
    ):
        assert isinstance(last_run_raw[field], str), field


# --- Test 3 -----------------------------------------------------------


async def test_failed_row_reports_trustworthy_false_with_signed_difference(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    trading_day = date(2026, 6, 18)
    checked_at = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)
    await _seed_failed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=trading_day,
        checked_at=checked_at,
        difference=Decimal("0.0100"),
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is False
    assert parsed.last_run is not None
    assert parsed.last_run.verdict == ReconciliationVerdict.FAILED
    assert parsed.last_run.signed_difference_usd == Decimal("0.0100")
    assert parsed.unresolved_run is not None
    assert parsed.unresolved_run.trading_day == trading_day


# --- Test 4 -----------------------------------------------------------


async def test_indeterminate_row_reports_trustworthy_false_with_null_money(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    trading_day = date(2026, 6, 18)
    checked_at = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)
    await _seed_indeterminate(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=trading_day,
        checked_at=checked_at,
        reason=IndeterminateReason.SETTLEMENT_UNPRICED,
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is False
    assert parsed.last_run is not None
    assert parsed.last_run.verdict == ReconciliationVerdict.INDETERMINATE
    assert parsed.last_run.reason == IndeterminateReason.SETTLEMENT_UNPRICED
    assert parsed.last_run.realised_pnl_usd is None
    assert parsed.last_run.commissions_usd is None
    assert parsed.last_run.cash_delta_usd is None
    assert parsed.last_run.signed_difference_usd is None


# --- Test 5 -----------------------------------------------------------


async def test_last_run_is_the_window_with_the_latest_checked_at(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=date(2026, 6, 10),
        checked_at=datetime(2026, 6, 10, 20, 0, tzinfo=UTC),
    )
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=date(2026, 6, 18),
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.last_run is not None
    assert parsed.last_run.trading_day == date(2026, 6, 18)


# --- Test 6 -----------------------------------------------------------


async def test_no_recompute_when_events_and_broker_transactions_are_emptied(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=date(2026, 6, 18),
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
    )

    before = await logged_in_client.get("/reconciliation/status")
    assert before.status_code == 200

    await superuser_db_session.execute(
        text("DELETE FROM events WHERE user_id = :uid"),
        {"uid": str(provisioned_users.user_a)},
    )
    await superuser_db_session.execute(
        text("DELETE FROM broker_transactions WHERE user_id = :uid"),
        {"uid": str(provisioned_users.user_a)},
    )
    await superuser_db_session.commit()

    after = await logged_in_client.get("/reconciliation/status")
    assert after.status_code == 200
    # Behavioural half: an endpoint that recomputed would return the
    # never-run answer (or a different verdict) once its inputs vanished.
    assert after.content == before.content

    # Structural half: the route module cannot reach the compute path at
    # all -- it imports nothing from `morai.ledger.reconciliation` beyond
    # the two enums.
    tree = ast.parse(_ROUTES_FILE.read_text())
    names = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        and node.module == "morai.ledger.reconciliation"
        for alias in node.names
    }
    assert names <= {"ReconciliationVerdict", "IndeterminateReason"}


# --- Test 7 -----------------------------------------------------------


async def test_cross_user_isolation_a_never_sees_bs_row(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_b,
        trading_day=date(2026, 6, 18),
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is False
    assert parsed.last_run is None
    assert parsed.unresolved_run is None


# --- Test 8 -----------------------------------------------------------


async def test_unauthenticated_request_gets_401(client: AsyncClient) -> None:
    response = await client.get("/reconciliation/status")
    assert response.status_code == 401


# --- Test 9 -----------------------------------------------------------


async def test_uncommitted_write_is_invisible_until_commit(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    trading_day = date(2026, 6, 18)
    window_start, window_end = _window_for(trading_day)
    result = ReconciliationResult(
        trading_day=trading_day,
        window_start=window_start,
        window_end=window_end,
        realised_pnl_usd=Decimal("100.0000"),
        commissions_usd=Decimal("5.0000"),
        cash_delta_usd=Decimal("95.0000"),
        signed_difference_usd=Decimal("0.0000"),
        verdict=ReconciliationVerdict.PASSED,
        reason=None,
    )
    await record_reconciliation_run(
        superuser_db_session,
        provisioned_users.user_a,
        result=result,
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
        is_reopening=False,
    )
    # Deliberately not committed yet -- Postgres's read-committed isolation
    # is the mechanism proved below, bounded by `asyncio.wait_for` so a
    # lock-ordering mistake fails as a timeout rather than a hang.

    before = await asyncio.wait_for(_get_status(logged_in_client), timeout=10)
    assert before.last_run is None

    await superuser_db_session.commit()

    after = await asyncio.wait_for(_get_status(logged_in_client), timeout=10)
    assert after.last_run is not None
    assert after.last_run.trading_day == trading_day


# --- Test 10 ------------------------------------------------------------


def test_route_accepts_no_path_or_query_parameter() -> None:
    from fastapi.routing import APIRoute
    from fastapi.routing import (
        _IncludedRouter,  # pyright: ignore[reportPrivateUsage]  # why: FastAPI 0.141.1's own `include_router` wraps each included router in this private wrapper on `app.routes` rather than flattening its routes directly (measured this session, a change from older FastAPI versions) -- there is no public API to reach the real `APIRoute` objects it wraps.
    )

    from morai.api.app import app

    def _flatten(routes: Sequence[BaseRoute]) -> list[APIRoute]:
        found: list[APIRoute] = []
        for route in routes:
            if isinstance(route, APIRoute):
                found.append(route)
            elif isinstance(route, _IncludedRouter):
                found.extend(_flatten(route.original_router.routes))
        return found

    paths = [
        route.path
        for route in _flatten(app.routes)
        if route.path.startswith("/reconciliation")
    ]
    assert paths == ["/reconciliation/status"]


# --- Test 11 (the expected RED) -----------------------------------------


async def test_older_unresolved_window_makes_trustworthy_false_despite_newer_pass(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Against a latest-row-only implementation this reports `trustworthy:
    true` -- the older window failed but was never repaired, and only the
    newest window's own verdict is checked. That is the exact failure
    `RECON-04` forbids: a P&L spanning the broken older window served as
    trustworthy. Distinct `trading_day` AND distinct `checked_at`, so
    "older window" and "older row" cannot be confused."""
    older_day = date(2026, 6, 10)
    newer_day = date(2026, 6, 18)
    await _seed_failed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=older_day,
        checked_at=datetime(2026, 6, 10, 20, 0, tzinfo=UTC),
        difference=Decimal("0.0100"),
    )
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=newer_day,
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.last_run is not None
    assert parsed.last_run.trading_day == newer_day
    assert parsed.trustworthy is False
    assert parsed.unresolved_run is not None
    assert parsed.unresolved_run.trading_day == older_day


# --- Test 12 --------------------------------------------------------------


async def test_superseded_window_restores_trustworthy_true(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """The pair to Test 11: without this case, Test 11's own rule would
    mark a *repaired* window untrustworthy forever. `D9-03` makes the
    re-check a new row for the same `trading_day`, which is exactly what
    `run_reconciliation` does when reopening finds a restated window."""
    trading_day = date(2026, 6, 10)
    await _seed_failed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=trading_day,
        checked_at=datetime(2026, 6, 10, 20, 0, tzinfo=UTC),
        difference=Decimal("0.0100"),
    )
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=trading_day,
        checked_at=datetime(2026, 6, 11, 9, 0, tzinfo=UTC),
        is_reopening=True,
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is True
    assert parsed.unresolved_run is None
    assert parsed.last_run is not None
    assert parsed.last_run.trading_day == trading_day
    assert parsed.last_run.verdict == ReconciliationVerdict.PASSED


# --- Test 13 ----------------------------------------------------------


async def test_earliest_unresolved_window_is_named_when_two_are_outstanding(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    earliest_day = date(2026, 6, 5)
    await _seed_failed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=date(2026, 6, 10),
        checked_at=datetime(2026, 6, 10, 20, 0, tzinfo=UTC),
        difference=Decimal("0.0100"),
    )
    await _seed_failed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=earliest_day,
        checked_at=datetime(2026, 6, 5, 20, 0, tzinfo=UTC),
        difference=Decimal("0.0200"),
    )
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=date(2026, 6, 18),
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is False
    assert parsed.unresolved_run is not None
    assert parsed.unresolved_run.trading_day == earliest_day


# --- Test 14 -------------------------------------------------------------


async def test_indeterminate_window_counts_as_unresolved_like_failed(
    logged_in_client: AsyncClient,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    older_day = date(2026, 6, 10)
    newer_day = date(2026, 6, 18)
    await _seed_indeterminate(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=older_day,
        checked_at=datetime(2026, 6, 10, 20, 0, tzinfo=UTC),
    )
    await _seed_passed(
        superuser_db_session,
        provisioned_users.user_a,
        trading_day=newer_day,
        checked_at=datetime(2026, 6, 18, 20, 0, tzinfo=UTC),
    )

    parsed = await _get_status(logged_in_client)
    assert parsed.trustworthy is False
    assert parsed.unresolved_run is not None
    assert parsed.unresolved_run.trading_day == older_day


# --- Cost proof: one awaited read, not N --------------------------------


def test_reconciliation_standing_makes_exactly_one_awaited_read() -> None:
    tree = ast.parse(_ROUTES_FILE.read_text())
    fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef)
        and node.name == "reconciliation_standing"
    )
    awaits = [n for n in ast.walk(fn) if isinstance(n, ast.Await)]
    assert len(awaits) == 1, len(awaits)
