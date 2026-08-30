"""Deliberate negative control (D-07). Do not fix.

Passing an `IndexPoints` value where `Usd` is expected must fail type-check before the
process runs -- criterion 4's second half, and the exact shape of the v1 bug (`NN-8`,
D-01/D-02): a dollar value fed to a formula expecting index points. Excluded from the
real gate's own run (see `pyproject.toml`).
"""

from decimal import Decimal

from morai.money.units import IndexPoints, Usd


def needs_usd(amount: Usd) -> None:
    print(amount)


needs_usd(IndexPoints(Decimal("1")))
