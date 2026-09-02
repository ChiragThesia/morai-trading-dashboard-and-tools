---
phase: 08-snapshot-capture
fixed_at: 2026-09-01T23:58:47Z
review_path: .planning/phases/08-snapshot-capture/08-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-09-01T23:58:47Z
**Source review:** .planning/phases/08-snapshot-capture/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (CR-01, WR-01, WR-02, IN-01)
- Fixed: 4 (WR-02 includes one coordinator-flagged follow-up commit, `b52edb1`,
  closing a classification gap the WR-02 fix itself introduced in
  `snapshot_runs.py::classify_snapshot_error` -- not a fifth finding, but named
  separately below since it landed as its own commit)
- Skipped: 0

## Fixed Issues

### CR-01: `parse_quote_payload` accepted NaN/Infinity as a real mark instead of degrading to a gap

**Files modified:** `src/morai/ingest/snapshots.py`, `tests/ingest/test_snapshot_parse_quote_payload.py`
**Commit:** `5739abd`
**Applied fix:** `_to_decimal` now calls `Decimal.is_finite()` after the `Decimal(str(value))` conversion and
returns `None` for any non-finite result, so `parse_quote_payload` degrades to `NO_MARKET_DATA`
instead of storing `Decimal('NaN')`/`Decimal('Infinity')` as a real mark. Widened the Hypothesis
property test's numeric strategy (dropped `allow_nan=False, allow_infinity=False`) and added an
explicit test asserting the bare `NaN`/`Infinity`/`-Infinity` JSON tokens (which `json.loads`
accepts by default) degrade to a gap. Red was observed first: before the fix, the new explicit test
failed with `parsed.gap_reason is None` / `mark_usd == Decimal('NaN')`.

**Zero-mark question, decided deliberately:** `L041` (v1's own gap definition) paired non-finite
with `spot = "0"`. This phase's own locked decision, `D8-09` ("A gap is `mark_usd IS NULL` plus a
non-null `gap_reason`... Never a sentinel"), explicitly rejects v1's sentinel-value approach and
pins the gap definition to `None` alone. A zero `mark_usd` (e.g. a deep-OTM option legitimately
worth $0.00) is therefore a valid real value under this phase's own gap definition, not a gap --
treating it as one would reintroduce the exact sentinel-recognition problem D8-09 was written to
avoid. No zero-handling was added to `_to_decimal`; only non-finite values are rejected.

### WR-01: Writing an all-gap batch required a healthy DEK, and the failure wasn't classifiable

**Files modified:** `src/morai/ingest/snapshots.py`, `tests/ingest/test_snapshot_gap_upsert.py`
**Commit:** `da9e13d`
**Applied fix:** `write_snapshot_observations`/`write_snapshot_marks` now only call `current_dek`
when the batch contains at least one non-gap row (`any(row.gap_reason is None for row in rows)`).
A pure-gap batch (the shape `capture_user_snapshot`'s `connection_expired`/`vendor_error` branches
always build) writes with no cryptographic material at all, so a crypto-shredded account can still
get an honest gap row. Added `test_all_gap_batch_writes_without_a_dek` (parametrized over both
writers) using `seeded_users` (deliberately unprovisioned, unlike `provisioned_users`) to reproduce
the crypto-shredded shape. Red was observed first by stashing the fix and re-running: both writers
raised `sqlalchemy.exc.NoResultFound` before the fix.

### WR-02: `current_dek` and `dek_for_version` disagreed on whether a missing key is a domain error

**Files modified:** `src/morai/crypto/data_keys.py`, `tests/crypto/test_data_keys.py` (new)
**Commit:** `fa7059b`
**Applied fix:** `current_dek` now uses `.one_or_none()` and raises the module's own
`DataKeyMissing` when no row exists, matching `dek_for_version`'s existing behaviour, instead of
letting `sqlalchemy.exc.NoResultFound` escape. Documented the now-consistent contract in the
module's own docstring and in `DataKeyMissing`'s docstring. Added `tests/crypto/test_data_keys.py`
proving both functions raise `DataKeyMissing` for the identical missing-row shape. Red was observed
first: before the fix, `current_dek` raised `NoResultFound`, not `DataKeyMissing`.

**Scope respected:** only `data_keys.py` was touched. The four pre-existing `_current_dek` copies
in `fills.py`, `events.py`, `connections.py`, `broker_transactions.py` were not modified, per this
phase's own explicit scope boundary (`data_keys.py`'s own module docstring).

**Follow-up, closed in this iteration:** WR-02 changing which exception `current_dek` raises
created a classification gap in `snapshot_runs.py::classify_snapshot_error`, which only recognised
`morai.vendor.connections.ConnectionDataKeyMissing`. A real (non-gap) snapshot write hitting a
genuinely missing DEK would have classified as `SnapshotError.UNKNOWN` instead of
`DATA_KEY_MISSING` -- the coordinator flagged this as a direct consequence of the WR-02 fix rather
than a pre-existing, out-of-scope gap, and it was closed in the same iteration. See "Fixed Issues"
below.

### Follow-up: `classify_snapshot_error` did not recognize `data_keys.DataKeyMissing`

**Files modified:** `src/morai/ingest/snapshot_runs.py`, `tests/ingest/test_snapshot_runs.py`
**Commit:** `b52edb1`
**Applied fix:** Added a `DataKeyMissing` (`morai.crypto.data_keys`) isinstance branch to
`_classify_by_type_and_status`, mapping to the same `SnapshotError.DATA_KEY_MISSING` member
`ConnectionDataKeyMissing` already maps to -- both exceptions represent the identical
crypto-shredded-account shape over the identical `user_data_keys` table, so the same classification
is the honest answer; no new `SnapshotError` member was needed. Added
`test_classify_snapshot_error_maps_data_keys_missing_to_data_key_missing`, asserting
`classify_snapshot_error(DataKeyMissing(...))` returns `DATA_KEY_MISSING`, not `UNKNOWN`. Red was
observed first via `git stash` on the fix: the test failed with `unknown` before the branch existed.
Scope unchanged from WR-02: the four pre-existing `_current_dek` copies remain untouched.

### IN-01: `to_schwab_wire_symbol`'s strike formatting had no explicit bound

**Files modified:** `src/morai/ingest/snapshots.py`, `tests/ingest/test_snapshot_wire_symbol_codec.py`
**Commit:** `da79ceb`
**Applied fix:** Added an explicit `0 <= strike_thousandths_int <= 99_999_999` guard before the
`:08d` format call, raising `ValueError` if a strike would overflow the 8-digit wire field --
making the 21-character invariant true by construction rather than by luck of
`parse_occ_symbol`'s current strike bounds. Added a test that monkeypatches `parse_occ_symbol` to
return an out-of-range `OccContract` (the only way to exercise this guard, since no real
`occ_symbol` string can produce an out-of-range strike through the real parser today). Red was
observed first: before the fix, the test's `pytest.raises` failed with "DID NOT RAISE".

## Skipped Issues

None -- all four in-scope findings were fixed.

---

_Fixed: 2026-09-01T23:58:47Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
