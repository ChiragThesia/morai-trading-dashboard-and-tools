"""The Schwab wire-symbol codec (Task 2, Pitfall 1, 08-RESEARCH.md).

No `pytest.mark.db` -- this codec needs nothing but data, the same reason
`tests/ledger/test_pairing_pure.py` carries none. Round-tripped against
`parse_occ_symbol`, the parser this codec inverts, so the suite is checked
against this project's own parsing logic rather than only against
hand-typed literals that could silently drift from it.

Schwab's own `OptionSymbol` docstring (`.venv/lib/python3.13/site-packages/
schwab/orders/options.py`, verified against the installed 1.5.1 wheel)
states the wire grammar explicitly: "[Underlying left justified with
spaces to 6 positions][Two digit year][Two digit month][Two digit
day]['P' or 'C'][Strike price]", with two worked examples --
`QQQ   240420P00500000` and `SPXW  240420C05040000`. `QQQ` is not one of
this project's two supported roots (`parse_occ_symbol`'s own regex admits
only `SPX`/`SPXW`), so it cannot round-trip through this codec -- it is
cited here as the vendor's own evidence for the general "pad to six"
rule, which Test 1/2 below already prove for both roots this project
actually trades. The `SPXW` example is a project-supported root and is
asserted literally in `test_to_schwab_wire_symbol_matches_vendors_own_worked_example`.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from morai.ingest.snapshots import from_schwab_wire_symbol, to_schwab_wire_symbol
from morai.ledger.pairing import parse_occ_symbol
from tests.ledger.oracle_seed import occ_symbol_for

# Front leg (SPXW, PM-settled weekly) and back leg (SPX, AM-settled
# monthly, a real third Friday) -- the same two contracts
# `tests/ledger/conftest.py::seeded_position` and `tests/ingest/conftest.py`'s
# own `TX_PAYLOAD`/`QUOTE_PAYLOAD` already use, so this suite feeds from
# fixtures this project already trusts rather than inventing new dates.
_SPXW_EXPIRY = date(2026, 6, 18)
_SPX_EXPIRY = date(2026, 7, 17)

# At least six symbols, built through `occ_symbol_for` where it fits (both
# roots, one strike with a fractional thousandths component) plus two
# hand-built call symbols -- `occ_symbol_for` only ever builds puts, and
# Test 3/4 need "both option types" coverage the helper cannot give.
_ROUND_TRIP_SYMBOLS = (
    occ_symbol_for(_SPXW_EXPIRY, Decimal("7275")),
    occ_symbol_for(_SPX_EXPIRY, Decimal("7275")),
    occ_symbol_for(_SPXW_EXPIRY, Decimal("7275.5")),
    occ_symbol_for(_SPX_EXPIRY, Decimal("6800.25")),
    "SPXW240420C05040000",
    "SPX260717C07575000",
)


def test_spxw_wire_symbol_pads_the_four_character_root_with_two_spaces() -> None:
    """`SPXW260618P07275000` becomes a 21-character wire symbol whose
    first six characters are the root followed by two spaces."""
    wire = to_schwab_wire_symbol("SPXW260618P07275000")
    assert len(wire) == 21
    assert wire[:6] == "SPXW  "
    assert wire == "SPXW  260618P07275000"


def test_spx_wire_symbol_pads_the_three_character_root_with_three_spaces() -> None:
    """`SPX260717P07275000` becomes a 21-character wire symbol whose first
    six characters are the root followed by three spaces -- the padding
    differs by root, which is the whole reason this codec exists."""
    wire = to_schwab_wire_symbol("SPX260717P07275000")
    assert len(wire) == 21
    assert wire[:6] == "SPX   "
    assert wire == "SPX   260717P07275000"


def test_to_schwab_wire_symbol_matches_vendors_own_worked_example() -> None:
    """Schwab's own `OptionSymbol` docstring worked example,
    `SPXW  240420C05040000` -- cited above, asserted literally so this
    suite fails if someone later decides the padding is cosmetic."""
    assert to_schwab_wire_symbol("SPXW240420C05040000") == "SPXW  240420C05040000"


@pytest.mark.parametrize("occ_symbol", _ROUND_TRIP_SYMBOLS)
def test_round_trip_returns_the_original_symbol_byte_for_byte(occ_symbol: str) -> None:
    """`from_schwab_wire_symbol(to_schwab_wire_symbol(s)) == s` for every
    case in the parametrised set."""
    assert from_schwab_wire_symbol(to_schwab_wire_symbol(occ_symbol)) == occ_symbol


@pytest.mark.parametrize("occ_symbol", _ROUND_TRIP_SYMBOLS)
def test_round_trip_preserves_every_parsed_field(occ_symbol: str) -> None:
    """`parse_occ_symbol(from_wire(to_wire(s)))` equals `parse_occ_symbol(s)`
    field for field -- root, expiry, option type and strike, the strike
    compared as `Decimal` -- proving the round trip against this project's
    own parser, not only against string equality."""
    round_tripped = from_schwab_wire_symbol(to_schwab_wire_symbol(occ_symbol))
    original_contract = parse_occ_symbol(occ_symbol)
    round_tripped_contract = parse_occ_symbol(round_tripped)
    assert round_tripped_contract.root == original_contract.root
    assert round_tripped_contract.expiry == original_contract.expiry
    assert round_tripped_contract.option_type == original_contract.option_type
    assert round_tripped_contract.strike == original_contract.strike


@pytest.mark.parametrize("occ_symbol", _ROUND_TRIP_SYMBOLS)
def test_every_produced_wire_symbol_is_exactly_21_characters(occ_symbol: str) -> None:
    assert len(to_schwab_wire_symbol(occ_symbol)) == 21


@pytest.mark.parametrize("occ_symbol", _ROUND_TRIP_SYMBOLS)
def test_padded_root_width_is_six_computed_from_the_parsed_roots_own_length(
    occ_symbol: str,
) -> None:
    """The padded root is always six characters wide -- two trailing
    spaces for the four-character root, three for the three-character
    root -- computed here from the parsed root's own length, so a
    per-root branch in the codec could not satisfy both cases by
    coincidence. (`parse_occ_symbol`'s regex admits only this project's
    two roots, so a synthetic third root is not a reachable input.)"""
    root = parse_occ_symbol(occ_symbol).root
    expected_padding = " " * (6 - len(root))
    wire = to_schwab_wire_symbol(occ_symbol)
    assert wire[:6] == f"{root}{expected_padding}"


def test_malformed_input_symbol_raises_value_error_naming_the_symbol() -> None:
    """A malformed contract is a caller bug, not a market gap -- the
    `ValueError` propagates from `parse_occ_symbol` rather than being
    swallowed."""
    with pytest.raises(ValueError, match="not-a-real-symbol"):
        to_schwab_wire_symbol("not-a-real-symbol")
