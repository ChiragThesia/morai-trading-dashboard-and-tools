"""The float canary — proves bit-inexactness, not digit loss.

`NUMERIC(14,4)` holds at most 14 significant digits. An IEEE-754 double carries
about 15.95 decimal digits. No value that fits this column width can visibly lose a
digit at four decimal places by transiting a float — R-01 in 01-RESEARCH.md measured
this across eight candidates, including the column's own ceiling, and derived the
margin independently from IEEE-754: a double's ULP at this magnitude (~1e9-1e10) is
roughly 25-50x smaller than the 5e-5 a value needs to move to flip a fourth-decimal
digit under standard rounding.

So this file asserts the property the ledger actually needs — bit-inexactness,
`Decimal(float(x)) != x` — instead of a visible digit flip, which would be
unprovable at this column width and a dishonest claim to make.

The route this canary guards (`POST /gate/money-roundtrip`) never touches `float`
itself: `Decimal` end to end, asyncpg's native `Numeric` <-> `Decimal` binding, D-03's
string-JSON wire format. This test's job is to show what *would* happen if it did —
proof of the failure mode the route's design prevents, not luck.
"""

from __future__ import annotations

from decimal import Decimal

# The column's exact ceiling: NUMERIC(14,4) allows at most 14 significant digits.
CEILING = Decimal("9999999999.9999")
# CONTEXT.md's own mid-range example.
MID_RANGE = Decimal("1234567890.1234")
# RED, DELIBERATE: this control value is 7425.5, an exact binary fraction (a sum of
# negative powers of two), which round-trips a float exactly. Asserting `!=` for it
# is a wrong expectation on purpose, so the first run of this suite fails for a real
# reason and not a typo — see the module's TDD note in 01-03-PLAN.md.
EXACT_BINARY_FRACTION = Decimal("7425.5000")


def test_ceiling_value_is_bit_inexact_through_a_float() -> None:
    assert Decimal(float(CEILING)) != CEILING


def test_mid_range_value_is_bit_inexact_through_a_float() -> None:
    assert Decimal(float(MID_RANGE)) != MID_RANGE


def test_exact_binary_fraction_control_is_bit_exact() -> None:
    """Negative control: proves the test method itself can distinguish exact from
    inexact, so a reader can trust the two assertions above mean something. Labelled
    explicitly so a future reader hunting for "a value that looks different when
    printed" does not swap this in as the canary — it would pass for the wrong reason
    and silently test nothing."""
    assert Decimal(float(EXACT_BINARY_FRACTION)) != EXACT_BINARY_FRACTION
