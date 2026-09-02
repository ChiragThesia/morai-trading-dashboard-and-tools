---
phase: 08-snapshot-capture
reviewed: 2026-09-01T23:32:55Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - alembic/versions/0015_snapshot_capture.py
  - pyproject.toml
  - src/morai/crypto/data_keys.py
  - src/morai/db/models.py
  - src/morai/ingest/snapshot_repair.py
  - src/morai/ingest/snapshot_runs.py
  - src/morai/ingest/snapshots.py
  - src/morai/worker/app.py
  - tests/crypto/test_nonce_uniqueness.py
  - tests/ingest/conftest.py
  - tests/ingest/test_snapshot_capture.py
  - tests/ingest/test_snapshot_gap_upsert.py
  - tests/ingest/test_snapshot_parse_quote_payload.py
  - tests/ingest/test_snapshot_repair.py
  - tests/ingest/test_snapshot_runs.py
  - tests/ingest/test_snapshot_wire_symbol_codec.py
  - tests/test_money_column_naming.py
  - tools/repair_snapshots.py
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-09-01T23:32:55Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

This phase's own highest-risk surface — the asymmetric `ON CONFLICT ... DO UPDATE ... WHERE`
upsert clause in `write_snapshot_observations`/`write_snapshot_marks` — is correct. I worked the
four-cell truth table by hand against the actual `where=` expression
(`excluded.gap_reason IS NULL OR existing.gap_reason IS NOT NULL`) and it blocks exactly the
gap-over-real direction while allowing real-over-real, real-over-gap and gap-over-gap; the
database-level test suite in `test_snapshot_gap_upsert.py` proves the same four cells directly
against Postgres, including the one (`gap_blocked_by_real`) that a naive clause satisfies by
accident. The wire-symbol codec's padding (`SPX` → 3 spaces, `SPXW` → 2 spaces, 21 characters
total) is correct and round-trips through `parse_occ_symbol`. `snapshot_repair.py` imports nothing
from `morai.vendor`/`schwab`, both entry points onto `repair_snapshot_marks` are module-qualified
(`snapshot_repair.repair_snapshot_marks(...)`, never an aliased import), RLS-bypass assertion is
called on every task/CLI entry point that touches a protected table, and `snapshot_runs` genuinely
distinguishes "never ran" from "ran with zero gaps" from "ran with per-item errors" — `L042`/`L043`
are answered, with a real end-to-end test that plants the exact worker-outage shape and proves
`missing_capture_slots` + `backfill_uncaptured_slot_gaps` recover from it without fabricating a
mark.

The one real defect is in the one function the phase itself flags as its lowest-confidence surface:
`parse_quote_payload`'s `_to_decimal` helper accepts a non-finite numeric token (`NaN`, `Infinity`,
`-Infinity`) as a legitimate mark. `Decimal(str(value))` does not raise for these — `decimal.Decimal`
supports them natively — so a vendor payload carrying one is not degraded to a `NO_MARKET_DATA` gap
the way every other malformed shape is; it is written as a "real" mark, encrypted, and returned as
though it were a valid price. This directly contradicts the module's own documented invariant
("every field... degrades to an honest gap instead of raising") and the project's money-path
correctness bar. Two lower-severity findings round out the report: an unconditional `current_dek()`
call that makes writing a pure-gap row depend on the crypto subsystem being healthy, and an
inconsistency between `current_dek`/`dek_for_version` in whether a missing key raises the module's
own `DataKeyMissing` domain exception.

## Critical Issues

### CR-01: `parse_quote_payload` accepts NaN/Infinity as a real mark instead of degrading to a gap

**File:** `src/morai/ingest/snapshots.py:192-202` (`_to_decimal`), consumed by `parse_quote_payload` at `:205-237`

**Issue:** `_to_decimal` converts a vendor JSON scalar to `Decimal` via `Decimal(str(value))` and
catches `ArithmeticError` to return `None` for anything malformed. But `decimal.Decimal` accepts
`"nan"`, `"inf"`/`"infinity"`, and `"-inf"`/`"-infinity"` without raising:

```
>>> from decimal import Decimal
>>> Decimal(str(float('nan')))
Decimal('NaN')
```

If a `get_quotes` response element ever carries `"mark": NaN` (a JSON extension Python's own
`json.loads` accepts by default — confirmed live: `json.loads('{"mark": NaN}')` succeeds and yields
a Python `float('nan')`) — or the equivalent for `Infinity`/`-Infinity` — `_to_decimal` returns
`Decimal('NaN')` (or a signed infinity) instead of `None`. `parse_quote_payload` then takes the
`mark_usd is not None` branch, so `ParsedQuote.gap_reason` is `None` and `mark_usd` is a non-finite
`Decimal`. This is not caught anywhere downstream in this phase: `write_snapshot_marks` asserts only
`row.mark_usd is not None` (line 468 in `snapshots.py`) — `Decimal('NaN') is not None` is `True` — so
the value is encrypted via `_encode_decimal` (`str(Decimal('NaN')).encode()`) and written to
`snapshot_marks.mark_usd_ciphertext` as though it were a legitimate price. The vendor boundary
(`src/morai/vendor/schwab_adapter.py:104-106`) does not filter it either: `_JSON_VALUE.validate_python`
is a `TypeAdapter[JsonValue]`, and Pydantic v2's default float validation (`allow_inf_nan=True`) does
not reject non-finite floats.

This directly contradicts the module's own stated contract (`snapshots.py:23-30`: "Every field read
inside `parse_quote_payload` degrades to an honest `NO_MARKET_DATA` gap instead of raising") and the
project's own money-path bar (`decimal.Decimal` never a fabricated/sentinel value; `NN-16`). A
`Decimal('NaN')` or `Decimal('Infinity')` silently stored as a "real" mark will either raise
`decimal.InvalidOperation` the moment any downstream code performs ordinary arithmetic on it (a P&L
computation, a comparison against a neighbouring slot) or, worse, propagate silently through any
arithmetic that tolerates it, corrupting a derived number with no gap marker to explain why.

Notably, `tests/ingest/test_snapshot_parse_quote_payload.py`'s own Hypothesis property test
(`test_never_raises_and_gap_reason_correlates_with_money_field_nullity`) explicitly constructs its
JSON-numeric strategy as `st.floats(allow_nan=False, allow_infinity=False)` — the exact case this
finding describes is the one case carved out of the fuzz coverage, so the "never raises, always
correlates" claim the test's own docstring makes is unproven for non-finite input.

**Fix:**
```python
def _to_decimal(value: JsonValue) -> Decimal | None:
    try:
        result = Decimal(str(value))
    except ArithmeticError:
        return None
    if not result.is_finite():
        return None
    return result
```
And widen the Hypothesis strategy to `st.floats()` (dropping `allow_nan=False, allow_infinity=False`)
so this path is actually exercised by the property test rather than excluded from it.

## Warnings

### WR-01: Writing an all-gap batch still requires a healthy DEK, and the failure isn't classifiable

**File:** `src/morai/ingest/snapshots.py:369` (`write_snapshot_observations`), `:445` (`write_snapshot_marks`); `src/morai/crypto/data_keys.py:50-67` (`current_dek`)

**Issue:** Both writers call `dek, key_version = await current_dek(session, user_id)`
unconditionally, before inspecting whether any row in `rows` actually needs encryption. The
`connection_expired` and `vendor_error` branches in `capture_user_snapshot` (`snapshots.py:617-635`,
`:641-657`) always build an all-gap batch via `gap_writes_for_legs` — every row's `gap_reason` is
set, so no row in that batch needs a DEK at all — yet the writer still resolves one before looping.

If the user's `user_data_keys` row is absent (crypto-shredded, `D3-08`/`AUTH-06`), `current_dek`'s
`.one()` raises `sqlalchemy.exc.NoResultFound`, uncaught by `current_dek` itself. Two consequences:

1. A crypto-shredded account cannot have even an honest gap row recorded for a connection-expired or
   vendor-error slot — an operation that needs zero cryptographic material fails because of an
   unrelated crypto dependency, which is the opposite of this phase's own "a gap is honest, never
   dropped" design goal.
2. Unlike its sibling `dek_for_version` (`data_keys.py:70-96`, which explicitly raises the module's
   own `DataKeyMissing` when the key row is missing), `current_dek` lets `NoResultFound` propagate
   raw. `classify_snapshot_error` (`snapshot_runs.py:86-107`) has no branch for
   `sqlalchemy.exc.NoResultFound`, so this collapses to `SnapshotError.UNKNOWN` — defeating the
   module's own documented purpose for `DATA_KEY_MISSING` ("a crypto-shredded account must not read
   as an unknown failure").

**Fix:** Only resolve the DEK when the batch actually contains a real (non-gap) row, e.g.:
```python
dek: bytes | None = None
key_version: int | None = None
if any(row.gap_reason is None for row in rows):
    dek, key_version = await current_dek(session, user_id)
```
and raise `DataKeyMissing` from `current_dek` symmetrically with `dek_for_version` so a real failure
still classifies correctly when a DEK genuinely is needed.

### WR-02: `current_dek` and `dek_for_version` disagree on whether a missing key is a domain error

**File:** `src/morai/crypto/data_keys.py:41-47` (`DataKeyMissing`), `:50-67` (`current_dek`), `:70-96` (`dek_for_version`)

**Issue:** The module's own `DataKeyMissing` docstring says it is "Raised by `dek_for_version`" —
and only `dek_for_version` actually raises it (`data_keys.py:86-91`, an explicit `if key_row is
None: raise DataKeyMissing(...)`). `current_dek` uses `.one()` on the same query shape and lets
SQLAlchemy's own `NoResultFound` escape unwrapped. Both functions exist to answer the identical
question ("does this user have a usable DEK") over the identical table; one gives callers a typed,
catchable domain error and the other does not. This is the root cause of WR-01's classification gap,
and it also means any other current or future caller of `current_dek` (only `snapshots.py` calls it
today, at two call sites) inherits the same silent gap.

**Fix:** Wrap `current_dek`'s query result check the same way `dek_for_version` does, or factor the
`.one_or_none()` + `DataKeyMissing` raise into one private helper both functions call, so the two
functions cannot drift on this again.

## Info

### IN-01: `to_schwab_wire_symbol`'s strike formatting has no explicit bound, though the input format makes it unreachable today

**File:** `src/morai/ingest/snapshots.py:178` (`strike_thousandths = f"{int(contract.strike * 1000):08d}"`)

**Issue:** `:08d` is a minimum-width specifier, not a fixed width — if `contract.strike` ever exceeded
99999.999 (yielding a 9+-digit thousandths value), the produced wire symbol would silently exceed 21
characters rather than raising, breaking `test_every_produced_wire_symbol_is_exactly_21_characters`'s
assumption at the call site that constructed it. In practice this is not currently reachable:
`parse_occ_symbol`'s own 8-digit thousandths field constrains every strike this codec ever receives
to at most 3 decimal places and a bounded integer part, so the round trip is exact today. Recorded
for the record only, in case a future change to `parse_occ_symbol`'s strike range assumptions
(e.g., a new index root with larger strikes) silently outgrows this format string.

**Fix:** None needed now; if `parse_occ_symbol`'s strike bounds ever widen, add an explicit range
assertion here rather than relying on the format specifier to fail loudly (it won't).

---

_Reviewed: 2026-09-01T23:32:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
