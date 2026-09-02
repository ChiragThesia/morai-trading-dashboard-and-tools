"""Vertical skew for one expiry, from a Schwab option-chain payload: the
25-delta risk reversal, its 10-delta wing pair, and ATM IV. Pure -- no
session, no clock, no network, no import of `morai.vendor` or `schwab`.

IV stays in the vendor's own percent unit (18.5 meaning 18.5%); every
IV-bearing field and local carries the `_pct` suffix rather than converting,
so there is no scale to invert (`NN-8`).

`_DECIMAL`/`_parse_decimal` is the same idiom as
`morai.ledger.reconciliation`'s pair: `None` on a missing key, an explicit
JSON `null`, or a value that fails to parse -- never `0`, never a guess
(`NN-16`). This is the third copy of the idiom in the codebase;
`connections.py`'s own docstring already records the convention that a
fourth copy is the signal to promote it into a shared helper, so it stays
copied here rather than promoted now.
"""

from __future__ import annotations

from datetime import date

from decimal import Decimal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    TypeAdapter,
    ValidationError,
)

_DECIMAL: TypeAdapter[Decimal] = TypeAdapter(Decimal)


def _parse_decimal(raw: JsonValue | None) -> Decimal | None:
    """`None` for a missing key, an explicit JSON `null`, or a value that
    does not parse as a `Decimal` -- never `0`, never a guess (`NN-16`).
    `TypeAdapter(Decimal).validate_python` already raises on `"NaN"`,
    `"Infinity"` and `"-Infinity"` on the installed pydantic -- that is the
    whole NaN/Infinity defence, no hand-rolled `is_nan()` check needed."""
    if raw is None:
        return None
    try:
        return _DECIMAL.validate_python(raw)
    except ValidationError:
        return None


class ChainContract(BaseModel):
    """One strike's entry under a `*ExpDateMap` key. Field names match the
    vendor's own camelCase keys directly -- Schwab sends dozens of other
    keys per contract (bid/ask/mark among them, deliberately not read
    here), all ignored by `extra="ignore"`.

    The three fields this module reads are typed `JsonValue`, not
    `Decimal`: typing them `Decimal` would make one illiquid `"NaN"` strike
    fail validation for the whole chain, which is the opposite of the
    required per-strike degrade-honestly behavior. The structure parses
    strictly; the per-strike numbers degrade through `_parse_decimal`."""

    model_config = ConfigDict(extra="ignore")

    strikePrice: JsonValue = None
    volatility: JsonValue = None
    delta: JsonValue = None


class ChainPayload(BaseModel):
    """The subset of a Schwab `get_option_chain` response this module
    reads. Every other top-level key the vendor sends is ignored."""

    model_config = ConfigDict(extra="ignore")

    underlyingPrice: JsonValue = None
    putExpDateMap: dict[str, dict[str, list[ChainContract]]] = Field(
        default_factory=dict
    )
    callExpDateMap: dict[str, dict[str, list[ChainContract]]] = Field(
        default_factory=dict
    )


class SkewMetric(BaseModel):
    """One computed number, or the honest reason it could not be computed.
    Exactly one of `value`/`reason` is set."""

    value: Decimal | None = None
    reason: str | None = None


class SkewSnapshot(BaseModel):
    """One expiry's skew read: the 25-delta risk reversal, its 10-delta
    wing pair, and ATM IV. `atm_put_iv_pct` is read from the put side only
    -- this system trades puts, so the put chain is the honest default;
    averaging both sides would report a number neither side of the chain
    sent."""

    expiry: date
    underlying_price: Decimal | None
    atm_put_iv_pct: SkewMetric
    put_iv_25_pct: SkewMetric
    call_iv_25_pct: SkewMetric
    rr_25_pct: SkewMetric
    put_iv_10_pct: SkewMetric
    call_iv_10_pct: SkewMetric
    rr_10_pct: SkewMetric


def _match_expiry_key(
    exp_map: dict[str, dict[str, list[ChainContract]]], expiry_iso: str
) -> str | None:
    """Map keys are `"YYYY-MM-DD:DTE"`; match on the part before the first
    `:` against `expiry.isoformat()`."""
    for key in exp_map:
        if key.split(":", 1)[0] == expiry_iso:
            return key
    return None


def _side_records(
    strikes: dict[str, list[ChainContract]],
) -> list[tuple[Decimal, Decimal, Decimal]]:
    """`(strike, abs_delta, iv_pct)` for every contract whose `strikePrice`,
    `volatility` and `delta` all parsed -- sorted by `abs_delta` ascending.
    Puts arrive signed negative; the target is a magnitude, so `abs()` is
    taken here."""
    records: list[tuple[Decimal, Decimal, Decimal]] = []
    for contracts in strikes.values():
        for contract in contracts:
            strike = _parse_decimal(contract.strikePrice)
            iv_pct = _parse_decimal(contract.volatility)
            delta = _parse_decimal(contract.delta)
            if strike is None or iv_pct is None or delta is None:
                continue
            records.append((strike, abs(delta), iv_pct))
    records.sort(key=lambda record: record[1])
    return records


def _interpolate_iv_pct(
    points: list[tuple[Decimal, Decimal]], target_abs_delta: Decimal, side: str
) -> SkewMetric:
    """A point whose own `abs_delta` equals the target returns that point's
    IV unmodified -- checked first so a single-point exact hit (no second
    point to form a pair with) still resolves, not only a hit that happens
    to sit on the edge of a two-point bracket. Otherwise scans adjacent
    sorted pairs for the first `lo_d < target < hi_d` and linearly
    interpolates: weight `(target - lo_d) / (hi_d - lo_d)`. Never extends
    the line past the last point -- no bracket means `value=None` with a
    reason naming the side, the target and the observed range."""
    for abs_delta, iv_pct in points:
        if abs_delta == target_abs_delta:
            return SkewMetric(value=iv_pct)
    for (lo_d, lo_iv), (hi_d, hi_iv) in zip(points, points[1:]):
        if lo_d < target_abs_delta < hi_d:
            weight = (target_abs_delta - lo_d) / (hi_d - lo_d)
            return SkewMetric(value=lo_iv + weight * (hi_iv - lo_iv))
    if points:
        observed = f"{points[0][0]} to {points[-1][0]}"
    else:
        observed = "no strikes with a parseable strike, volatility and delta"
    return SkewMetric(
        value=None,
        reason=(
            f"No {side} strike bracketing |delta|={target_abs_delta}; "
            f"observed |delta| range: {observed}."
        ),
    )


def _risk_reversal(
    put_metric: SkewMetric, call_metric: SkewMetric, *, label: str
) -> SkewMetric:
    if put_metric.value is not None and call_metric.value is not None:
        return SkewMetric(value=put_metric.value - call_metric.value)
    missing = [
        side
        for side, metric in (("put", put_metric), ("call", call_metric))
        if metric.value is None
    ]
    missing_sides = " and ".join(missing)
    return SkewMetric(
        value=None,
        reason=f"{label} risk reversal unavailable -- missing {missing_sides} side IV.",
    )


def _atm_put_iv_pct(
    put_records: list[tuple[Decimal, Decimal, Decimal]],
    underlying_price: Decimal | None,
) -> SkewMetric:
    """The put-side contract whose strike is nearest `underlyingPrice`,
    among those whose IV parsed. Ties resolve to the lower strike, matching
    the `WR-02` tiebreaker precedent from Phase 9."""
    if underlying_price is None:
        return SkewMetric(value=None, reason="No underlyingPrice in the chain payload.")
    if not put_records:
        return SkewMetric(
            value=None,
            reason="No put strike with a parseable strike and volatility.",
        )
    best_strike, best_iv_pct = put_records[0][0], put_records[0][2]
    best_distance = abs(best_strike - underlying_price)
    for strike, _abs_delta, iv_pct in put_records[1:]:
        distance = abs(strike - underlying_price)
        if distance < best_distance or (
            distance == best_distance and strike < best_strike
        ):
            best_strike, best_iv_pct, best_distance = strike, iv_pct, distance
    return SkewMetric(value=best_iv_pct)


_TARGET_25: Decimal = Decimal("0.25")
_TARGET_10: Decimal = Decimal("0.10")


def compute_skew(payload: JsonValue, *, expiry: date) -> SkewSnapshot:
    """Returns a `SkewSnapshot` for one expiry of a Schwab option-chain
    payload. A structurally-wrong payload raises `ValidationError`. An
    expiry present in neither side's map raises `ValueError` naming the
    available expiries -- a typo deserves to be loud. An expiry present in
    only one side's map leaves that side's metrics `None` with a reason,
    and does not raise."""
    parsed = ChainPayload.model_validate(payload)
    expiry_iso = expiry.isoformat()

    put_key = _match_expiry_key(parsed.putExpDateMap, expiry_iso)
    call_key = _match_expiry_key(parsed.callExpDateMap, expiry_iso)

    if put_key is None and call_key is None:
        available = sorted(
            {
                key.split(":", 1)[0]
                for key in (*parsed.putExpDateMap, *parsed.callExpDateMap)
            }
        )
        raise ValueError(
            f"Expiry {expiry_iso} not found in chain. Available expiries: {available}"
        )

    put_records = (
        _side_records(parsed.putExpDateMap[put_key]) if put_key is not None else []
    )
    call_records = (
        _side_records(parsed.callExpDateMap[call_key]) if call_key is not None else []
    )
    put_points = [(abs_delta, iv_pct) for _, abs_delta, iv_pct in put_records]
    call_points = [(abs_delta, iv_pct) for _, abs_delta, iv_pct in call_records]

    if put_key is None:
        no_put = SkewMetric(
            value=None, reason=f"No put-side data for expiry {expiry_iso}."
        )
        put_iv_25_pct, put_iv_10_pct = no_put, no_put
    else:
        put_iv_25_pct = _interpolate_iv_pct(put_points, _TARGET_25, "put")
        put_iv_10_pct = _interpolate_iv_pct(put_points, _TARGET_10, "put")

    if call_key is None:
        no_call = SkewMetric(
            value=None, reason=f"No call-side data for expiry {expiry_iso}."
        )
        call_iv_25_pct, call_iv_10_pct = no_call, no_call
    else:
        call_iv_25_pct = _interpolate_iv_pct(call_points, _TARGET_25, "call")
        call_iv_10_pct = _interpolate_iv_pct(call_points, _TARGET_10, "call")

    rr_25_pct = _risk_reversal(put_iv_25_pct, call_iv_25_pct, label="25-delta")
    rr_10_pct = _risk_reversal(put_iv_10_pct, call_iv_10_pct, label="10-delta")

    underlying_price = _parse_decimal(parsed.underlyingPrice)
    atm_put_iv_pct = _atm_put_iv_pct(put_records, underlying_price)

    return SkewSnapshot(
        expiry=expiry,
        underlying_price=underlying_price,
        atm_put_iv_pct=atm_put_iv_pct,
        put_iv_25_pct=put_iv_25_pct,
        call_iv_25_pct=call_iv_25_pct,
        rr_25_pct=rr_25_pct,
        put_iv_10_pct=put_iv_10_pct,
        call_iv_10_pct=call_iv_10_pct,
        rr_10_pct=rr_10_pct,
    )
