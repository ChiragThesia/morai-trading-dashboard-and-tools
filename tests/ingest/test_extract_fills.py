"""Raw fidelity (06-01-PLAN.md Task 2, T-06-02): the vendor's sign, the
vendor's position effect, and everything that is not a fill.

Pure-function tests: no database, no `@pytest.mark.db`, no network. Every
case builds a validated transaction model from a Python dict through the
same `TypeAdapter` the production path uses (`_TRANSACTIONS`), never by
instantiating `_Transaction` with keyword arguments -- validating through
the real boundary is what makes the test exercise the real parse.
"""

from __future__ import annotations

import ast
import inspect
from decimal import Decimal

import morai.ingest.schwab_sync as schwab_sync
import pytest
from morai.ingest.schwab_sync import (
    _Transaction,  # pyright: ignore[reportPrivateUsage]  # why: this suite validates through the same TypeAdapter/model pair the production path uses, never by instantiating a fill directly -- the private types are the real boundary being tested.
    _TRANSACTIONS,  # pyright: ignore[reportPrivateUsage]  # why: see _Transaction above.
    extract_fills,
)
from morai.ledger.fills import FillWrite


def _leg(
    *,
    amount: Decimal | None = None,
    cost: Decimal | None = None,
    price: Decimal | None = Decimal("10.0000"),
    position_effect: str | None = "OPENING",
    symbol: str = "SPXW260618P07275000",
) -> dict[str, object]:
    """One `transferItems[]` entry, OCC-shaped. `amount`/`cost` default to
    `None` so a case only sets the signal it means to test."""
    return {
        "instrument": {"symbol": symbol, "assetType": "OPTION"},
        "amount": amount,
        "cost": cost,
        "price": price,
        "positionEffect": position_effect,
    }


def _build_transaction(
    *,
    type_: str = "TRADE",
    order_id: str | None = "1006681717677",
    activity_id: int = 1006681717677,
    legs: list[dict[str, object]] | None = None,
) -> _Transaction:
    """One `get_transactions` response element, validated through the
    real `_TRANSACTIONS` `TypeAdapter` -- never `_Transaction(**kwargs)`."""
    data: dict[str, object] = {
        "activityId": activity_id,
        "type": type_,
        "time": "2026-06-18T14:30:00+00:00",
        "orderId": order_id,
        "transferItems": legs if legs is not None else [],
    }
    return _TRANSACTIONS.validate_python([data])[0]


# --- Direction: the sign of amount, or the cost-sign fallback (NN-9, NN-10) ---


@pytest.mark.parametrize(
    "amount, cost, expected_side, expected_quantity",
    [
        pytest.param(
            Decimal("-1"), None, "SELL", Decimal("1"), id="negative-amount-sells"
        ),
        pytest.param(
            Decimal("1"), None, "BUY", Decimal("1"), id="positive-amount-buys"
        ),
        pytest.param(
            None,
            Decimal("-100"),
            "BUY",
            Decimal("100"),
            id="negative-cost-fallback-buys",
        ),
        pytest.param(
            None,
            Decimal("100"),
            "SELL",
            Decimal("100"),
            id="positive-cost-fallback-sells",
        ),
    ],
)
def test_direction_from_signed_amount_or_cost_fallback(
    amount: Decimal | None,
    cost: Decimal | None,
    expected_side: str,
    expected_quantity: Decimal,
) -> None:
    transaction = _build_transaction(legs=[_leg(amount=amount, cost=cost)])

    fills, skip_reasons = extract_fills(transaction)

    assert skip_reasons == []
    assert len(fills) == 1
    assert fills[0].side == expected_side
    assert fills[0].quantity == expected_quantity


# --- Mixed direction: a real SPX calendar sells to open and buys to close ---
# Pitfall 1's own warning sign is a fixture where every opening leg is a buy
# and every closing leg is a sell -- these two cases are deliberately their
# own named tests, not folded into the table above.


def test_buy_to_close_is_not_normalised_away() -> None:
    """A leg whose `positionEffect` is `CLOSING` and whose `amount` is
    positive yields `position_effect` `CLOSING` together with `side`
    `BUY` -- a buy-to-close, which the position effect alone cannot
    express and which no rule may normalise away."""
    transaction = _build_transaction(
        legs=[_leg(amount=Decimal("1"), position_effect="CLOSING")]
    )

    fills, skip_reasons = extract_fills(transaction)

    assert skip_reasons == []
    assert fills[0].side == "BUY"
    assert fills[0].position_effect == "CLOSING"


def test_sell_to_open_is_the_mirror_case() -> None:
    """A leg whose `positionEffect` is `OPENING` and whose `amount` is
    negative yields `position_effect` `OPENING` with `side` `SELL` -- a
    sell-to-open, the mirror case."""
    transaction = _build_transaction(
        legs=[_leg(amount=Decimal("-1"), position_effect="OPENING")]
    )

    fills, skip_reasons = extract_fills(transaction)

    assert skip_reasons == []
    assert fills[0].side == "SELL"
    assert fills[0].position_effect == "OPENING"


# --- Skips: a gap is honest, never guessed (NN-11, NN-16, NN-14) ---


def test_leg_with_no_usable_direction_is_skipped_but_siblings_still_produce_fills() -> (
    None
):
    transaction = _build_transaction(
        legs=[
            _leg(amount=None, cost=None),
            _leg(amount=Decimal("1")),
        ]
    )

    fills, skip_reasons = extract_fills(transaction)

    assert len(fills) == 1
    assert len(skip_reasons) == 1
    assert "leg 0" in skip_reasons[0]


def test_missing_order_id_produces_no_fills_and_one_skip_reason() -> None:
    transaction = _build_transaction(order_id=None, legs=[_leg(amount=Decimal("1"))])

    fills, skip_reasons = extract_fills(transaction)

    assert fills == []
    assert len(skip_reasons) == 1


def test_only_the_trade_element_yields_fills_from_a_mixed_response() -> None:
    """A response mixing a TRADE element with a cash-movement element and a
    receive-and-deliver element yields fills only for the TRADE, one skip
    reason per skipped element, and no raised exception."""
    trade = _build_transaction(legs=[_leg(amount=Decimal("-1"))])
    cash_movement = _build_transaction(type_="CASH_RECEIPT", legs=[])
    receive_and_deliver = _build_transaction(type_="RECEIVE_AND_DELIVER", legs=[])

    all_fills: list[FillWrite] = []
    all_skip_reasons: list[str] = []
    for element in (trade, cash_movement, receive_and_deliver):
        fills, skip_reasons = extract_fills(element)
        all_fills.extend(fills)
        all_skip_reasons.extend(skip_reasons)

    assert len(all_fills) == 1
    assert len(all_skip_reasons) == 2


# --- Every extracted fill is well-formed ---


def test_every_extracted_quantity_is_positive_and_every_price_is_decimal() -> None:
    transaction = _build_transaction(
        legs=[
            _leg(amount=Decimal("-3"), price=Decimal("44.8567")),
            _leg(amount=Decimal("2"), price=Decimal("30.1233")),
        ]
    )

    fills, skip_reasons = extract_fills(transaction)

    assert skip_reasons == []
    assert len(fills) == 2
    for fill in fills:
        assert fill.quantity is not None
        assert fill.quantity > 0
        assert isinstance(fill.price_usd, Decimal)


# --- The absolute-value prohibition, proven by walking the syntax tree, not
# the text (NN-10). Follows the AST-gate shape `tests/gate/test_api_boundary.py`
# already establishes for `_uses_response_model_kwarg` -- a pure helper plus
# `ast.walk`, with its own negative control proving the scanner fires. ---


def _calls_builtin_abs(source: str) -> bool:
    """`True` if `source`, parsed as Python, contains a call whose function
    is a bare name bound to the absolute-value builtin. Walks the parsed
    tree, not the text -- a comment or a docstring discussing the
    prohibition can never trip this, and a real call can never hide behind
    one."""
    tree = ast.parse(source)
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "abs"
        for node in ast.walk(tree)
    )


def test_extraction_module_never_calls_the_absolute_value_builtin() -> None:
    source = inspect.getsource(schwab_sync)
    assert _calls_builtin_abs(source) is False


def test_the_scanner_fires_on_a_synthetic_abs_call() -> None:
    """Proves the matcher fires -- a scanner that never rejects anything is
    decoration (same shape as `test_vendor_boundary.py`'s own negative
    control)."""
    assert _calls_builtin_abs("magnitude = abs(delta)\n") is True


def test_scanner_does_not_fire_on_a_comment_or_docstring_mentioning_abs() -> None:
    """Negative control on the negative control: a real call can never hide
    behind a comment or docstring discussing the prohibition, and neither
    can trip the scanner by accident."""
    source = '''
"""This module never calls abs() -- see NN-10."""
# abs() is banned here.
magnitude = -value if value < 0 else value
'''
    assert _calls_builtin_abs(source) is False
