"""D-02: `points_to_usd` converts index points to dollars, multiplier required.

v1 stored `openNetDebit` in dollars and fed it to a formula expecting index points,
off by the contract multiplier -- a +$395 trade displayed as -$319,850, five rounds
of oracle-driven debugging before the bug was found (`NN-8`, app-postmortem.md).
The multiplier has no default so a caller can never inherit a wrong contract; it
must always be named at the call site.

Pure Python -- no database, no `db` marker.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

import pytest

from morai.money.units import IndexPoints, Usd, points_to_usd

SRC = Path(__file__).resolve().parents[1] / "src" / "morai"
UNITS_FILE = SRC / "money" / "units.py"


def test_points_to_usd_converts_correctly() -> None:
    result = points_to_usd(IndexPoints(Decimal("4.45")), multiplier=100)
    assert result == Decimal("445.00")


def test_points_to_usd_returns_a_decimal_value() -> None:
    # `Usd` is a `NewType` over `Decimal` (D-01) -- it IS a `Decimal` at runtime, so
    # "re-wrapped as Usd, not left bare" is a static claim the `-> Usd` return
    # annotation carries under basedpyright/mypy, not a runtime distinction this
    # test can observe. This only confirms the value itself round-trips as Decimal.
    result = points_to_usd(IndexPoints(Decimal("1")), multiplier=100)
    assert isinstance(result, Decimal)


def test_points_to_usd_requires_the_multiplier() -> None:
    # Called through a `Callable[..., Usd]` reference so the missing-argument call
    # below is not itself a statically-typed call site the checkers would flag --
    # the point of this test is the runtime TypeError, not a mistyped call.
    fn: Callable[..., Usd] = points_to_usd
    with pytest.raises(TypeError):
        fn(IndexPoints(Decimal("4.45")))


def test_contract_multiplier_literal_appears_in_exactly_one_file() -> None:
    """Grep scoped to `src/`, excluding `units.py` itself -- never repository-wide,
    so plan prose, docs and learnings entries that legitimately discuss the SPX
    contract multiplier cannot invalidate this test (D-02)."""
    literal = re.compile(r"\b100\b")

    other_files_with_literal = [
        path
        for path in SRC.rglob("*.py")
        if path != UNITS_FILE and literal.search(path.read_text())
    ]

    assert other_files_with_literal == [], (
        f"contract multiplier literal must appear only in {UNITS_FILE}, "
        f"also found in: {other_files_with_literal}"
    )
    assert literal.search(UNITS_FILE.read_text()) is not None, (
        f"expected the contract multiplier literal in {UNITS_FILE}"
    )
