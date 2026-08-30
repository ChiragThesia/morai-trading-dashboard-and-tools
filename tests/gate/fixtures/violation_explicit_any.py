"""Deliberate negative control (D-07). Do not fix.

An explicit `typing.Any` annotation must fail the gate — both basedpyright
(`reportExplicitAny` on the annotation, `reportAny` on the parameter's resolved type)
and ruff (`TID251`, D-06's banned-api). This file is excluded from the real gate's own
run (see `pyproject.toml`'s `exclude`/`extend-exclude` for `tests/gate/fixtures`).
"""

from typing import Any


def uses_any(value: Any) -> None:
    print(value)
