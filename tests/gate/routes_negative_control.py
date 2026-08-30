"""Deliberately-broken routes for the API boundary (D-07 applied to API-07).

Mounted only inside `tests/gate/test_api_boundary.py`, onto a throwaway FastAPI
app. Nothing under `src/` imports this module, and nothing here touches a
database -- each route returns a literal object, which is the whole point:
the failure under test is in serialisation, not in data.

Every route here must itself type-check clean under both checkers. Only its
runtime behaviour is deliberately wrong -- a route that satisfies the type
checker and still fails at the boundary is exactly what criterion 5 asks
about. Do not "fix" any route below; each one exists to fail (or, for the
strict-Decimal success case, to prove it still does not).
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import ConfigDict

from morai.api.models import ApiModel
from morai.money.api_types import UsdField

router = APIRouter(prefix="/gate-broken")


class _RevalidatedResponse(ApiModel):
    """Local response base with `revalidate_instances='always'`.

    FastAPI skips re-validating a return value that is already an instance of
    the declared response type -- pydantic's own default is
    `revalidate_instances='never'`. `model_construct()` bypasses validation
    entirely, so without this override the two routes below would return 200
    with a silently wrong body instead of raising, which is exactly the gap
    D-09/criterion 5 closes. Only this fixture opts into always-revalidate --
    the real API's `ApiModel` doesn't need it, since real routes never call
    `model_construct()`.
    """

    model_config = ConfigDict(revalidate_instances="always")


class BrokenResponse(_RevalidatedResponse):
    probe_id: int
    amount_usd: UsdField


# negative control: response is missing a required field -- must raise, not
# serialise (criterion 5). Do not "fix" this route.
@router.get("/missing-field")
def missing_field_route() -> BrokenResponse:
    return BrokenResponse.model_construct(probe_id=1)


# negative control: response carries a key the model forbids -- must raise,
# not silently drop it (criterion 5's other half). `model_construct` itself
# drops an unrecognised kwarg under `extra="forbid"` (measured), so the extra
# key is attached directly to `__dict__`, bypassing the frozen-model
# `__setattr__` -- the only way to get an actually-extra attribute onto an
# instance of a model that forbids one.
@router.get("/extra-field")
def extra_field_route() -> BrokenResponse:
    obj = BrokenResponse.model_construct(probe_id=1, amount_usd="1.00")
    object.__setattr__(obj, "__dict__", {**obj.__dict__, "unexpected": "oops"})
    return obj


class StrictIntRequest(ApiModel):
    count: int


# negative control: the route itself is fine -- the client payload the test
# sends it (a string for a strict int field) is what is deliberately wrong.
@router.post("/strict-int")
def strict_int_route(body: StrictIntRequest) -> StrictIntRequest:
    return body


class StrictDecimalRequest(ApiModel):
    amount_usd: UsdField


# negative control by convention only: the JSON-string case is the one
# assertion in this file that must succeed (R-02) -- everything else here
# proves a rejection.
@router.post("/strict-decimal")
def strict_decimal_route(body: StrictDecimalRequest) -> StrictDecimalRequest:
    return body
