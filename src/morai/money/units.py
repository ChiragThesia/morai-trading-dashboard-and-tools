"""Money carries its unit in its type, not its name (D-01, NN-8).

`NewType` over `Decimal`: zero runtime cost, and Pydantic v2 and SQLAlchemy handle it
natively with no serializer or `TypeDecorator`. Arithmetic decays to plain `Decimal`
by design -- `Usd(1) + Usd(2)` is a `Decimal`, not a `Usd` -- so every result is
explicitly re-wrapped at the call site. That noise is the point: each re-wrap is a
place the unit is asserted, which is exactly the check v1 was missing when it fed a
dollar value to a formula expecting index points and displayed +$395 as -$319,850.

Plan 01-04 adds the one conversion function between them (`points_to_usd`). Nothing
else belongs here yet.
"""

from __future__ import annotations

from decimal import Decimal
from typing import NewType

Usd = NewType("Usd", Decimal)
IndexPoints = NewType("IndexPoints", Decimal)

# The SPX contract multiplier. Lives here and nowhere else under `src/` -- enforced
# by tests/test_money_units.py's grep -- so every conversion names it explicitly
# rather than inheriting a bare number from a call site.
SPX_CONTRACT_MULTIPLIER = 100


def points_to_usd(pts: IndexPoints, multiplier: int) -> Usd:
    """Convert index points to dollars. The multiplier is required, never defaulted.

    v1 stored `openNetDebit` in dollars and fed it to a formula expecting index
    points, off by the contract multiplier: a +$395 trade displayed as -$319,850,
    five rounds of oracle-driven debugging before the bug was found (D-02, NN-8).
    A defaulted multiplier is how a caller stops thinking about which contract it
    is converting -- forcing it as a required argument makes that a visible
    call-site decision instead.
    """
    return Usd(Decimal(pts) * Decimal(multiplier))
