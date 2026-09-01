"""Task 2: the seeded-fault suite for OPS-06 (D5-03, criterion 5) --
proves the oracle's own comparison, `assert_matches_oracle`
(`tests/ledger/oracle_seed.py`), is sensitive enough to raise on a real
semantic corruption, not merely to pass when the pipeline happens to be
right.

This is a hand-seeded fault suite covering exactly the three fault classes
criterion 5 names -- sign flip, rounding, quantity off-by-one -- not a
full mutation-tool run. Per D5-03, no mutation tool (`mutmut`,
`cosmic-ray`) is pinned this phase: pinning one waits until the seeded
suite exists and the gate's own time budget is known, and this phase adds
no new dependency for it. A surviving mutant here means one of the three
parametrized cases below did not raise; zero surviving mutants is the
whole suite passing.

What this suite proves, and what it does not: each case proves the real
`assert_matches_oracle` comparison is sensitive enough to fail on a real
semantic corruption. It does NOT prove the fault cannot occur in
production -- that is a different claim, the one `tests/gate/` makes about
its compile-time checkers. The oracle's own 13-calendar suite (`tests/
ledger/test_oracle_gate.py`) is what proves the real pipeline is currently
correct; this suite proves the proof itself has teeth.

Why `_signed_leg_amount` is the seam (`src/morai/ledger/pairing.py`): it
is the one module-level function `_net_amount`/`derive_events` route every
fill's own contribution through, so patching it is patching the single
place all three fault classes live, never a wider surface. The three
named classes are all arithmetic faults on one fill's own contribution,
and each is the class that cost real money:

- **Sign flip** -- direction lost (`NN-9`, `NN-10`, `L023`). This is
  `LEDGER-01`'s own historical failure mode: the class of bug that made a
  real +$395 trade read as -$319,850.
- **Rounding** -- precision lost in the money path, exactly what
  `decimal.Decimal` end to end (D3-17) exists to prevent.
- **Quantity off-by-one** -- the unit error the ledger exists to catch.

A pairing-level fault -- attributing a fill to the wrong position -- is a
different guard, already covered by plan 05-02's shared-front-leg and
explicitly-unresolved tests (`tests/ledger/test_pairing_shared_leg.py`).
This suite is arithmetic-only, on purpose.

No `db` marker: every case runs over in-memory `FillRecord`s from
`oracle_fill_records`, so the whole suite is a fast unit run.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID, uuid4

import pytest

import morai.ledger.pairing as pairing
from morai.ledger.fills import FillRecord
from morai.ledger.pairing import (
    EventType,
    derive_events,
)
from morai.ledger.pairing import (
    _signed_leg_amount as _real_signed_leg_amount,  # pyright: ignore[reportPrivateUsage]  # why: the single seam D5-03 injects all three named faults through -- see the module docstring. Wrapping the real function, never reimplementing it, is what makes each faulted variant differ from the truth by exactly the one named defect and nothing else.
)
from tests.ledger.oracle_seed import (
    ORACLE_CALENDARS,
    assert_matches_oracle,
    oracle_fill_records,
)

_SignedLegAmount = Callable[[FillRecord, EventType], Decimal | None]

# Synthetic position ids, one per calendar -- no database, so these need
# not be real stored ids (mirrors tests/ledger/test_oracle_gate.py's own
# pure case).
_POSITION_IDS: dict[str, UUID] = {
    calendar.calendar_id: uuid4() for calendar in ORACLE_CALENDARS
}


def _sign_flipped(fill: FillRecord, event_type: EventType) -> Decimal | None:
    """Negates the real result. `LEDGER-01`'s own historical failure mode
    -- direction lost (`NN-9`, `NN-10`, `L023`)."""
    amount = _real_signed_leg_amount(fill, event_type)
    return None if amount is None else -amount


def _rounded_to_whole_dollars(
    fill: FillRecord, event_type: EventType
) -> Decimal | None:
    """Quantizes the real result to whole dollars before returning --
    precision lost in the money path."""
    amount = _real_signed_leg_amount(fill, event_type)
    if amount is None:
        return None
    return amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _off_by_one_quantity(fill: FillRecord, event_type: EventType) -> Decimal | None:
    """Multiplies by `quantity` plus one -- the unit error the ledger
    exists to catch. Wraps the real function over a copy of `fill` with
    its own `quantity` inflated by one, rather than reimplementing the
    arithmetic, so the only difference from the truth is the one named
    defect."""
    if fill.quantity is None:
        return _real_signed_leg_amount(fill, event_type)
    inflated_fill = replace(fill, quantity=fill.quantity + Decimal("1"))
    return _real_signed_leg_amount(inflated_fill, event_type)


_FAULTS = [
    pytest.param(_sign_flipped, id="sign-flip"),
    pytest.param(_rounded_to_whole_dollars, id="rounding"),
    pytest.param(_off_by_one_quantity, id="off-by-one-quantity"),
]


def test_control_passes_with_no_fault_injected() -> None:
    """The control, defined and collected first in this module (this repo
    configures no test-order randomisation, `pyproject.toml`) -- a green
    fault case below can never be a green-because-broken-harness case,
    because this proves the unfaulted harness itself passes first."""
    records, resolutions = oracle_fill_records(_POSITION_IDS)
    derivation = derive_events(records, resolutions)
    assert_matches_oracle(derivation.events, _POSITION_IDS)


@pytest.mark.parametrize("fault", _FAULTS)
def test_seeded_fault_makes_the_oracle_comparison_raise(
    fault: _SignedLegAmount, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Injects one named fault via `monkeypatch.setattr` against
    `morai.ledger.pairing._signed_leg_amount` -- `monkeypatch` undoes
    itself at this test's own teardown, which is what makes the closing
    control assertion (`test_control_passes_again_after_the_parametrized_
    faults`, below) meaningful. Asserts that the real
    `assert_matches_oracle` raises `AssertionError` when fed the faulted
    derivation's own output -- proof the oracle's own assertions are
    sensitive enough to fail on a real semantic corruption, not merely
    that the fault "exists"."""
    monkeypatch.setattr(pairing, "_signed_leg_amount", fault)

    records, resolutions = oracle_fill_records(_POSITION_IDS)
    derivation = derive_events(records, resolutions)

    with pytest.raises(AssertionError):
        assert_matches_oracle(derivation.events, _POSITION_IDS)


def test_control_passes_again_after_the_parametrized_faults() -> None:
    """No fault leaked: `monkeypatch` reverted `_signed_leg_amount` at
    each parametrized case's own teardown, so this, run last, proves the
    real function is back and correct -- not merely assumed to be."""
    records, resolutions = oracle_fill_records(_POSITION_IDS)
    derivation = derive_events(records, resolutions)
    assert_matches_oracle(derivation.events, _POSITION_IDS)
