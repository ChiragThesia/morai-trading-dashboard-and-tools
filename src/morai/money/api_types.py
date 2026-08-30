"""The strict-Decimal field for money-carrying Pydantic models (R-02, measured).

D-03 makes `Decimal` cross the wire as a JSON string. D-12 makes every request model
strict. Those two decisions conflict for a bare `Decimal` field: read directly from
the installed `fastapi==0.141.1` source (`routing.py:439,446`,
`dependencies/utils.py:951-998`, `_compat/v2.py:173-188`), FastAPI's request-body
pipeline always calls `TypeAdapter.validate_python` on a pre-parsed dict, never
`validate_json`. Strict mode's dict-path `Decimal` validator accepts only an actual
`Decimal` instance -- a `str`, `float` or `int` in the dict all raise. So a bare
strict `Decimal` field would reject `{"amount_usd": "123.4567"}`, which is D-03's own
wire format and this API's own response shape. The API's output would not validate as
its own input.

`BeforeValidator` runs before pydantic-core's strict type check, so by the time
strict mode inspects the value it is already a `Decimal` regardless of entry point.
Every money-carrying Pydantic field uses `StrictDecimalField` (or the `UsdField`
alias), never a bare `Decimal`, `Usd` or `IndexPoints` -- function signatures and
non-Pydantic code keep the plain `NewType`s from `units.py`.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from pydantic import BeforeValidator


def _parse_decimal_strict(v: object) -> Decimal:
    """Accept a `Decimal` unchanged or parse a `str`; reject everything else.

    Rejecting `float` and `int` is the point, not an oversight (T-01-11): a `float`
    that reached the money path already lost precision, and silently coercing it here
    is the exact failure this project exists to prevent.
    """
    if isinstance(v, Decimal):
        return v
    if isinstance(v, str):
        return Decimal(v)
    raise ValueError(f"expected Decimal or str, got {type(v).__name__}")


StrictDecimalField = Annotated[Decimal, BeforeValidator(_parse_decimal_strict)]
UsdField = StrictDecimalField
