"""Deliberate negative control (D-07). Do not fix.

The one diagnostic the `typings/schwab/` stub package legitimately leaves
behind: `httpx.Response.json()` returns `Any` by design (JSON has no static
shape). Every real call site in `schwab_adapter.py` funnels through one
private `_response_json` helper carrying the single suppression D4-04
budgets for the whole tree; this fixture is that same call with no
suppression at all, so a real basedpyright run must reject it and name the
rule. This file is excluded from the real gate's own run (see
`pyproject.toml`'s `exclude`/`extend-exclude` for `tests/gate/fixtures`).
"""

import httpx


def unsuppressed_response_json(resp: httpx.Response) -> object:
    return resp.json()
