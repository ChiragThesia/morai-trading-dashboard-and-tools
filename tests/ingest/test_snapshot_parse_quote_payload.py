"""`parse_quote_payload`: every malformed vendor shape degrades to an
honest gap (Task 3, SNAP-02, D8-16, `NN-16`, `L041`).

No `pytest.mark.db` -- this is the pure half of SNAP-02 and needs no
Postgres, mirroring `tests/ledger/test_pairing_pure.py`'s own convention.

Test 9 uses Hypothesis (added to this project's dev dependencies this
plan -- `pyproject.toml`, pinned `6.166.0`, matching
`.claude/CLAUDE.md`'s own Technology Stack decision, which had named it
without yet adding it to the lockfile). A recursive JSON strategy over
mappings, lists, strings, integers, floats and booleans/null asserts only
the two invariants `<behavior>` names -- never a specific gap reason for
generated input, which would be asserting the generator rather than the
function.
"""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st
from pydantic import JsonValue

from morai.ingest.snapshots import SnapshotGapReason, parse_quote_payload
from tests.ingest.conftest import QUOTE_PAYLOAD

_WIRE_SYMBOL = "SPXW  260618P07275000"


def test_a_fully_populated_element_returns_the_exact_mark_and_spot() -> None:
    """A fully-populated element returns the exact `Decimal` mark and spot
    with identical digits and a null gap reason -- this phase's own
    positive canary, drawn from `QUOTE_PAYLOAD`."""
    parsed = parse_quote_payload(QUOTE_PAYLOAD, _WIRE_SYMBOL)
    assert parsed.gap_reason is None
    assert parsed.mark_usd == Decimal("44.8567")
    assert parsed.spot_usd == Decimal("6203.1234")


def test_the_requested_symbol_absent_from_the_response_is_a_gap() -> None:
    parsed = parse_quote_payload({"SOME  OTHER0000000000": {}}, _WIRE_SYMBOL)
    assert parsed.gap_reason is SnapshotGapReason.NO_MARKET_DATA
    assert parsed.mark_usd is None
    assert parsed.spot_usd is None


def test_element_present_with_no_quote_object_is_a_gap() -> None:
    raw: JsonValue = {_WIRE_SYMBOL: {"assetMainType": "OPTION"}}
    parsed = parse_quote_payload(raw, _WIRE_SYMBOL)
    assert parsed.gap_reason is SnapshotGapReason.NO_MARKET_DATA
    assert parsed.mark_usd is None
    assert parsed.spot_usd is None


def test_quote_object_present_with_no_mark_is_a_gap() -> None:
    raw: JsonValue = {_WIRE_SYMBOL: {"quote": {"underlyingPrice": 6203.1234}}}
    parsed = parse_quote_payload(raw, _WIRE_SYMBOL)
    assert parsed.gap_reason is SnapshotGapReason.NO_MARKET_DATA
    assert parsed.mark_usd is None
    assert parsed.spot_usd is None


def test_mark_present_with_absent_underlying_price_is_a_real_quote() -> None:
    """A missing spot is an honest absence on a real quote, not a gap for
    the whole row."""
    raw: JsonValue = {_WIRE_SYMBOL: {"quote": {"mark": 44.8567}}}
    parsed = parse_quote_payload(raw, _WIRE_SYMBOL)
    assert parsed.gap_reason is None
    assert parsed.mark_usd == Decimal("44.8567")
    assert parsed.spot_usd is None


_NON_MAPPING_TOP_LEVEL_PAYLOADS: tuple[JsonValue, ...] = (
    [1, 2, 3],
    "not a mapping",
    42,
    None,
    {},
)


def test_non_mapping_top_level_payloads_never_raise() -> None:
    for raw in _NON_MAPPING_TOP_LEVEL_PAYLOADS:
        parsed = parse_quote_payload(raw, _WIRE_SYMBOL)
        assert parsed.gap_reason is SnapshotGapReason.NO_MARKET_DATA
        assert parsed.mark_usd is None
        assert parsed.spot_usd is None


_NON_MAPPING_QUOTE_VALUES: tuple[JsonValue, ...] = ([1, 2, 3], "not a mapping")


def test_quote_value_that_is_a_list_or_string_never_raises() -> None:
    for quote_value in _NON_MAPPING_QUOTE_VALUES:
        raw: JsonValue = {_WIRE_SYMBOL: {"quote": quote_value}}
        parsed = parse_quote_payload(raw, _WIRE_SYMBOL)
        assert parsed.gap_reason is SnapshotGapReason.NO_MARKET_DATA
        assert parsed.mark_usd is None
        assert parsed.spot_usd is None


def test_mark_precision_survives_both_string_and_high_precision_forms() -> None:
    """A mark expressed as a JSON string, and a mark carrying more decimal
    places than a double can hold, both parse to a `Decimal` with the
    digits preserved exactly. A `float` anywhere in this path is the
    failure class this project exists to prevent (D3-17)."""
    string_raw: JsonValue = {_WIRE_SYMBOL: {"quote": {"mark": "44.8567"}}}
    assert parse_quote_payload(string_raw, _WIRE_SYMBOL).mark_usd == Decimal("44.8567")

    high_precision_raw: JsonValue = {
        _WIRE_SYMBOL: {"quote": {"mark": "44.856789012345678901"}}
    }
    assert parse_quote_payload(high_precision_raw, _WIRE_SYMBOL).mark_usd == Decimal(
        "44.856789012345678901"
    )


_json_scalars = st.none() | st.booleans() | st.integers() | st.text()
_json_numeric = st.floats(allow_nan=False, allow_infinity=False)
_json_leaves = _json_scalars | _json_numeric
_json_values = st.recursive(
    _json_leaves,
    lambda children: (
        st.lists(children, max_size=3)
        | st.dictionaries(st.text(), children, max_size=3)
    ),
    max_leaves=10,
)


@given(raw=_json_values, wire_symbol=st.text())
def test_never_raises_and_gap_reason_correlates_with_money_field_nullity(
    raw: object, wire_symbol: str
) -> None:
    """For arbitrary JSON-shaped input, the function returns a
    `ParsedQuote` and never raises, and every returned value has either a
    null gap reason with a non-null mark, or a non-null gap reason with
    both money fields null."""
    parsed = parse_quote_payload(raw, wire_symbol)  # type: ignore[arg-type]  # pyright: ignore[reportArgumentType]  # why: Hypothesis's recursive JSON strategy is not itself typed as JsonValue -- the whole point of this test is proving the function survives an untyped/malformed shape, so a cast here would defeat it.
    if parsed.gap_reason is None:
        assert parsed.mark_usd is not None
    else:
        assert parsed.mark_usd is None
        assert parsed.spot_usd is None
