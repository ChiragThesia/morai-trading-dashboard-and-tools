"""Deliberate negative control (D-07). Do not fix.

`typing.cast` must fail the gate — ruff bans it by name (`TID251`, D-06). Excluded from
the real gate's own run (see `pyproject.toml`).
"""

from typing import cast


def uses_cast(value: object) -> int:
    return cast(int, value)
