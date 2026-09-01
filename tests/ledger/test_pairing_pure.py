"""Task 2: the derivation is pure and no broker call is reachable from it
(LEDGER-12). No `pytest.mark.db` on this module -- it is the proof that
`derive_events` needs nothing but data, and a database marker would hide
that.

The import gate below walks the AST of `pairing.py`'s own source rather
than text-searching it, deliberately: this module's own docstring has to
be able to explain that it never reaches a broker and never reads position
state, and a text search would make that explanation trip the very rule it
explains (the string "morai.vendor" appearing in a comment would fail a
grep but is invisible to an AST walk, which only sees real `import`
statements). AST measures the code, not its prose.

The `Position` half of this gate is criterion 2's structural leg (D5-02):
`positions` carries no status column, so nothing can read one, and this
test makes that absence a fact the suite checks rather than a fact someone
has to remember. Plan 05-02 adds the behavioural half (mutating a
position's status changes no derived event -- there being no column to
mutate, this half stays structural, not behavioural).

Honest limit: this proves no broker module is imported by the derivation,
not that no broker call happens anywhere in a request that also derives.
"""

from __future__ import annotations

import ast
import inspect
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import morai.ledger.pairing as pairing
from morai.ledger.fills import FillRecord
from morai.ledger.pairing import EventType, FillKey, derive_events, hash_fill_ids
from tests.ledger.oracle_seed import ORACLE_CALENDARS, ORACLE_FILLS

_USER_ID = UUID("00000000-0000-4000-8000-000000000002")
_POSITION_ID = UUID("00000000-0000-4000-8000-000000000001")


def _fill_record(
    order_id: str,
    occ_symbol: str,
    execution_time: datetime,
    position_effect: str,
    side: str,
) -> FillRecord:
    return FillRecord(
        user_id=_USER_ID,
        order_id=order_id,
        occ_symbol=occ_symbol,
        leg_index=0,
        execution_time=execution_time,
        position_effect=position_effect,
        side=side,
        quantity=Decimal("1"),
        price_usd=Decimal("1"),
        key_version=1,
    )


def test_derive_events_no_session_or_db_reproduces_oracle_figures() -> None:
    """Four hand-built `FillRecord`s for `65aac62e`, built from
    `ORACLE_FILLS` rather than re-typing prices -- a second transcription
    of the same numbers is a second place for a transposition to hide.
    No `AsyncSession` constructed anywhere, no database fixture requested.
    """
    oracle_fills = [f for f in ORACLE_FILLS if f.calendar_id == "65aac62e"]
    assert len(oracle_fills) == 4

    fill_records = [
        FillRecord(
            user_id=_USER_ID,
            order_id=f.order_id,
            occ_symbol=f.occ_symbol,
            leg_index=0,
            execution_time=f.execution_time,
            position_effect=f.position_effect,
            side=f.side,
            quantity=Decimal("1"),
            price_usd=f.price_usd,
            key_version=1,
        )
        for f in oracle_fills
    ]
    resolutions: dict[FillKey, UUID | None] = {
        (f.order_id, f.occ_symbol, 0, f.execution_time): _POSITION_ID
        for f in oracle_fills
    }

    derivation = derive_events(fill_records, resolutions)

    assert derivation.unresolved == ()
    assert derivation.unclassified == ()
    assert len(derivation.events) == 2

    calendar = next(c for c in ORACLE_CALENDARS if c.calendar_id == "65aac62e")
    open_event = next(e for e in derivation.events if e.event_type is EventType.OPEN)
    close_event = next(e for e in derivation.events if e.event_type is EventType.CLOSE)

    assert open_event.open_debit_usd == calendar.open_net_debit
    assert open_event.close_credit_usd is None
    assert close_event.close_credit_usd == calendar.close_net_credit
    assert close_event.open_debit_usd is None
    assert open_event.commission_usd is None
    assert close_event.commission_usd is None


def test_unresolved_fill_contributes_to_nothing() -> None:
    fill = _fill_record(
        "ORDER-1",
        "SPXW260618P07275000",
        ORACLE_FILLS[0].execution_time,
        "OPENING",
        "BUY",
    )
    key: FillKey = (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)

    derivation = derive_events([fill], {key: None})

    assert derivation.unresolved == (key,)
    assert derivation.unclassified == ()
    assert derivation.events == ()


def test_fill_whose_role_the_broker_did_not_report_contributes_to_nothing() -> None:
    fill = _fill_record(
        "ORDER-2",
        "SPXW260618P07275000",
        ORACLE_FILLS[0].execution_time,
        "MYSTERY",
        "BUY",
    )
    key: FillKey = (fill.order_id, fill.occ_symbol, fill.leg_index, fill.execution_time)

    derivation = derive_events([fill], {key: _POSITION_ID})

    assert derivation.unclassified == (key,)
    assert derivation.unresolved == ()
    assert derivation.events == ()


def test_hash_fill_ids_is_order_independent() -> None:
    keys: list[FillKey] = [
        (f.order_id, f.occ_symbol, 0, f.execution_time)
        for f in ORACLE_FILLS
        if f.calendar_id == "65aac62e"
    ]
    assert len(keys) == 4
    assert hash_fill_ids(keys) == hash_fill_ids(list(reversed(keys)))


def _pairing_source_tree() -> ast.Module:
    source_path = Path(inspect.getsourcefile(pairing) or "")
    return ast.parse(source_path.read_text(), filename=str(source_path))


def test_pairing_imports_no_vendor_broker_or_http_module() -> None:
    """An AST walk of `src/morai/ledger/pairing.py`'s import statements
    finds nothing under `morai.vendor`, `schwab` or `httpx` -- no broker
    call is reachable from the derivation (LEDGER-12, criterion 4)."""
    forbidden_prefixes = ("morai.vendor", "schwab", "httpx")
    imported_names: set[str] = set()
    for node in ast.walk(_pairing_source_tree()):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported_names.add(node.module)

    for name in imported_names:
        assert not any(
            name == prefix or name.startswith(f"{prefix}.")
            for prefix in forbidden_prefixes
        ), f"pairing.py imports {name!r} -- LEDGER-12's no-broker-call gate"


def test_pairing_never_imports_or_references_position() -> None:
    """An AST walk finds no import of `Position` from `morai.db.models`
    and no reference to that name anywhere in the module -- the
    derivation cannot read a position's state because it never even names
    the model (D5-02's structural half)."""
    tree = _pairing_source_tree()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "morai.db.models":
            assert all(alias.name != "Position" for alias in node.names)
        if isinstance(node, ast.Name) and node.id == "Position":
            raise AssertionError(
                "pairing.py references 'Position' -- D5-02's structural gate"
            )
