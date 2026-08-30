"""Assertions that the API boundary's error envelope structurally cannot leak
(D-10) and that each deliberately-broken response raises rather than
serialises (D-09, D-11, D-12).

Every test here runs against a throwaway ASGI app carrying no database --
`morai.db.session.get_db_session` is never wired into any app built in this
module, so nothing here can touch Postgres.

`response.json()` types as `Any` (httpx's own stub) -- every assertion below
either reads it through a typed Pydantic model (the untrusted-input boundary
this project's no-`Any` policy requires) or reads `response.text` instead,
never an indexed raw dict.
"""

from __future__ import annotations

import ast
import logging
import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, ConfigDict

from morai.api.errors import install_error_handling
from morai.api.models import ApiModel
from morai.money.api_types import UsdField
from tests.gate.routes_negative_control import router as negative_control_router

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class _RevalidatedResponse(ApiModel):
    """Local response base with `revalidate_instances='always'`.

    FastAPI skips re-validating a return value that is already an instance of
    the declared response type -- pydantic's own default is
    `revalidate_instances='never'`. `model_construct()` bypasses validation
    entirely, so without this override `missing_field_route` below would
    return 200 with a silently wrong body instead of raising, which is
    exactly the gap D-09/criterion 5 closes. Only this fixture opts into
    always-revalidate -- the real API's `ApiModel` doesn't need it, since
    real routes never call `model_construct()`.
    """

    model_config = ConfigDict(revalidate_instances="always")


class _BrokenResponse(_RevalidatedResponse):
    probe_id: int
    amount_usd: UsdField


class _NeedsCount(ApiModel):
    count: int


class _OpaqueErrorBody(BaseModel):
    """The exactly-two-key envelope D-10 promises. `extra='forbid'` plus two
    required fields makes `model_validate` itself the "no field name, no
    input value, no Pydantic message, no traceback" assertion -- either the
    body has exactly `error` and `request_id`, or this raises."""

    model_config = ConfigDict(strict=True, extra="forbid")

    error: str
    request_id: str


APP = FastAPI()
install_error_handling(APP)
APP.include_router(negative_control_router)


@APP.get("/ok")
def ok_route() -> dict[str, str]:
    return {"status": "ok"}


# negative control: response is missing a required field -- must raise, not
# serialise (criterion 5). Do not "fix" this route; it exists to fail.
@APP.get("/broken/missing-field")
def missing_field_route() -> _BrokenResponse:
    return _BrokenResponse.model_construct(probe_id=1)


# negative control: an ordinary bug, unrelated to response validation -- the
# catch-all handler must produce the same opaque shape.
@APP.get("/broken/raises")
def raises_route() -> dict[str, str]:
    raise RuntimeError("boom -- deliberately unhandled")


@APP.post("/needs-count")
def needs_count_route(body: _NeedsCount) -> _NeedsCount:
    return body


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """`raise_app_exceptions=False`: the catch-all `Exception` handler is
    dispatched through Starlette's `ServerErrorMiddleware`, which always
    re-raises after sending the response (see `errors.py`) -- httpx's default
    is to re-raise that to the caller instead of returning the response."""
    transport = ASGITransport(app=APP, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_response_validation_failure_returns_opaque_body_with_request_id(
    client: AsyncClient,
) -> None:
    response = await client.get("/broken/missing-field")
    assert response.status_code == 500
    body = _OpaqueErrorBody.model_validate(response.json())
    assert body.error == "internal"
    assert body.request_id


async def test_response_validation_failure_logs_full_detail_keyed_by_request_id(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR):
        response = await client.get("/broken/missing-field")
    body = _OpaqueErrorBody.model_validate(response.json())
    matching = [r for r in caplog.records if body.request_id in r.getMessage()]
    assert matching, "no server log line carries the response's request id"
    # the field name this test's own body omitted must be in the server-only log.
    assert "amount_usd" in matching[0].getMessage()


async def test_unhandled_exception_returns_same_opaque_shape(
    client: AsyncClient,
) -> None:
    response = await client.get("/broken/raises")
    assert response.status_code == 500
    body = _OpaqueErrorBody.model_validate(response.json())
    assert body.error == "internal"


async def test_unhandled_exception_logs_full_detail_keyed_by_request_id(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR):
        response = await client.get("/broken/raises")
    body = _OpaqueErrorBody.model_validate(response.json())
    matching = [r for r in caplog.records if body.request_id in r.getMessage()]
    assert matching, "no server log line carries the response's request id"
    assert any(r.exc_info for r in matching), "log line must carry the traceback"


async def test_successful_response_carries_a_request_id_header(
    client: AsyncClient,
) -> None:
    response = await client.get("/ok")
    assert response.status_code == 200
    assert response.headers.get("x-request-id")


async def test_request_validation_422_keeps_normal_detail(client: AsyncClient) -> None:
    """The 422 path is untouched by D-10 -- this is the one place the
    client's own submitted value legitimately belongs in the response.
    Asserted on the raw text, not the parsed body: `response.json()` types as
    `Any`, and the field name being present is all this needs to prove."""
    response = await client.post("/needs-count", json={"count": "5"})
    assert response.status_code == 422
    assert "count" in response.text


# --- D-09/D-12: request-side strict validation, via the negative-control router ---


async def test_strict_int_rejects_coerced_string(client: AsyncClient) -> None:
    response = await client.post("/gate-broken/strict-int", json={"count": "5"})
    assert response.status_code == 422


async def test_strict_decimal_accepts_the_json_string_form(client: AsyncClient) -> None:
    """The exception among these negative controls: this asserts success. If
    this raises, `StrictDecimalField`'s `BeforeValidator` protection (R-02)
    has gone missing -- D-03's own wire format must keep validating."""
    response = await client.post(
        "/gate-broken/strict-decimal", json={"amount_usd": "1234567890.1234"}
    )
    assert response.status_code == 200
    assert '"amount_usd":"1234567890.1234"' in response.text


async def test_strict_decimal_rejects_a_json_float(client: AsyncClient) -> None:
    response = await client.post(
        "/gate-broken/strict-decimal", json={"amount_usd": 1234567890.1234}
    )
    assert response.status_code == 422


async def test_strict_decimal_rejects_a_json_int(client: AsyncClient) -> None:
    response = await client.post(
        "/gate-broken/strict-decimal", json={"amount_usd": 123}
    )
    assert response.status_code == 422


async def test_unknown_request_key_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/gate-broken/strict-decimal",
        json={"amount_usd": "1.00", "unexpected": "field"},
    )
    assert response.status_code == 422


# --- D-11: contracts declared by return annotation, never `response_model` ---


async def test_missing_field_response_raises(client: AsyncClient) -> None:
    response = await client.get("/gate-broken/missing-field")
    assert response.status_code == 500
    _OpaqueErrorBody.model_validate(response.json())


async def test_extra_field_response_raises(client: AsyncClient) -> None:
    response = await client.get("/gate-broken/extra-field")
    assert response.status_code == 500
    _OpaqueErrorBody.model_validate(response.json())


def _uses_response_model_kwarg(path: Path) -> bool:
    """`True` if `path` contains a call with a `response_model=` keyword
    argument. Parsed with `ast`, not a text search -- a text search also
    matches this very file's docstrings naming the keyword in prose, which is
    not a violation."""
    tree = ast.parse(path.read_text(), filename=str(path))
    return any(
        isinstance(node, ast.Call)
        and any(kw.arg == "response_model" for kw in node.keywords)
        for node in ast.walk(tree)
    )


def test_no_route_under_src_morai_api_declares_response_model() -> None:
    """D-11: a route's contract is the return type annotation, never the
    `response_model=` kwarg -- the kwarg is invisible to the type checker.
    Scoped to `src/morai/api/` only (never repository-wide), so this plan's
    own prose naming the keyword cannot invalidate the check."""
    tracked = subprocess.run(
        ["git", "ls-files", "src/morai/api"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    offenders = [
        path
        for path in tracked
        if path.endswith(".py") and _uses_response_model_kwarg(REPO_ROOT / path)
    ]
    assert offenders == []
