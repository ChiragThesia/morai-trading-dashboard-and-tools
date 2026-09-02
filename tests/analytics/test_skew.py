"""Pure tests for `morai.analytics.skew` -- no database, no vendor call,
no `pytest.mark.db`. `compute_skew` takes a Schwab-shaped chain payload and
an expiry, and returns a `SkewSnapshot`; these five tests prove the exact
hit, the interpolation, the NaN/Infinity defence, the no-extrapolation
rule, and that the vendor's own percent unit survives untouched
end to end.

Honest limit: the payloads below are hand-built fixtures shaped like a
real Schwab `get_option_chain` response, not a captured one -- this module
has never seen live Schwab data (see the plan's own carried-forward
facts)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import JsonValue

from morai.analytics.skew import compute_skew

_EXPIRY = date(2026, 10, 16)
_EXPIRY_KEY = "2026-10-16:44"


def _contract(
    strike: float, iv: JsonValue, signed_delta: JsonValue
) -> dict[str, JsonValue]:
    """One chain contract entry. `signed_delta` is passed through exactly
    as given -- callers pass the vendor's own sign (negative for puts) so
    the tests prove `compute_skew` does the un-signing, not this helper."""
    return {"strikePrice": strike, "volatility": iv, "delta": signed_delta}


def _strike_map(contracts: list[dict[str, JsonValue]]) -> dict[str, JsonValue]:
    """Every test contract below carries its own distinct strike, so a
    one-contract-per-strike map is enough -- the vendor's own shape (a list
    per strike) is preserved, just never exercised with more than one
    entry here."""
    return {str(contract["strikePrice"]): [contract] for contract in contracts}


def _payload(
    *,
    put_contracts: list[dict[str, JsonValue]] | None,
    call_contracts: list[dict[str, JsonValue]] | None,
    underlying_price: float = 7500.0,
) -> dict[str, JsonValue]:
    """Assembles the nested `{"underlyingPrice": ..., "putExpDateMap":
    {"2026-10-16:44": {"7500.0": [ {...} ]}}}` shape. Passing `None` for a
    side omits that side's `*ExpDateMap` key entirely -- the "matches in
    one map but not the other" case the plan calls out."""
    payload: dict[str, JsonValue] = {"underlyingPrice": underlying_price}
    if put_contracts is not None:
        payload["putExpDateMap"] = {_EXPIRY_KEY: _strike_map(put_contracts)}
    if call_contracts is not None:
        payload["callExpDateMap"] = {_EXPIRY_KEY: _strike_map(call_contracts)}
    return payload


def test_exact_hit_returns_the_strikes_own_iv_unmodified() -> None:
    payload = _payload(
        put_contracts=[
            _contract(7400.0, 20.0, -0.20),
            _contract(7450.0, 21.5, -0.25),
            _contract(7500.0, 24.0, -0.30),
        ],
        call_contracts=None,
    )

    snapshot = compute_skew(payload, expiry=_EXPIRY)

    assert snapshot.put_iv_25_pct.value == Decimal("21.5")
    assert snapshot.put_iv_25_pct.reason is None


def test_gap_between_brackets_is_linearly_interpolated() -> None:
    payload = _payload(
        put_contracts=[
            _contract(7400.0, 20.0, -0.20),
            _contract(7500.0, 24.0, -0.30),
        ],
        call_contracts=None,
    )

    snapshot = compute_skew(payload, expiry=_EXPIRY)

    assert snapshot.put_iv_25_pct.value == Decimal("22")


def test_nan_and_infinity_strikes_are_dropped_not_zeroed() -> None:
    payload = _payload(
        put_contracts=[
            _contract(7400.0, 20.0, -0.20),
            _contract(7500.0, 24.0, -0.30),
            _contract(7450.0, "NaN", -0.25),
            _contract(7460.0, 19.0, "Infinity"),
        ],
        call_contracts=None,
    )

    snapshot = compute_skew(payload, expiry=_EXPIRY)

    assert snapshot.put_iv_25_pct.value == Decimal("22")


def test_missing_bracket_yields_none_and_a_reason_never_an_extrapolation() -> None:
    payload = _payload(
        put_contracts=[
            _contract(7300.0, 18.0, -0.40),
            _contract(7350.0, 19.0, -0.55),
            _contract(7360.0, 19.5, -0.70),
        ],
        call_contracts=None,
    )

    snapshot = compute_skew(payload, expiry=_EXPIRY)

    assert snapshot.put_iv_25_pct.value is None
    assert isinstance(snapshot.put_iv_25_pct.reason, str)
    assert snapshot.put_iv_25_pct.reason

    assert snapshot.rr_25_pct.value is None
    assert isinstance(snapshot.rr_25_pct.reason, str)
    assert snapshot.rr_25_pct.reason


def test_iv_stays_in_the_vendors_own_percent_unit_end_to_end() -> None:
    payload = _payload(
        put_contracts=[_contract(7450.0, 22.0, -0.25)],
        call_contracts=[_contract(7450.0, 18.5, 0.25)],
    )

    snapshot = compute_skew(payload, expiry=_EXPIRY)

    assert snapshot.put_iv_25_pct.value == Decimal("22")
    assert snapshot.call_iv_25_pct.value == Decimal("18.5")
    assert snapshot.rr_25_pct.value == Decimal("3.5")
    assert isinstance(snapshot.put_iv_25_pct.value, Decimal)
    assert isinstance(snapshot.call_iv_25_pct.value, Decimal)
    assert isinstance(snapshot.rr_25_pct.value, Decimal)
