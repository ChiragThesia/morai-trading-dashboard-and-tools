---
phase: 05-fill-pairing-and-the-oracle-gate
reviewed: 2026-09-01T11:01:34Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/morai/ledger/pairing.py
  - src/morai/ledger/fills.py
  - src/morai/ledger/events.py
  - src/morai/db/models.py
  - tests/ledger/oracle_seed.py
  - tests/ledger/test_oracle_gate.py
  - tests/ledger/test_pairing_tracer.py
  - tests/ledger/test_pairing_pure.py
  - tests/ledger/test_pairing_idempotency.py
  - tests/ledger/test_pairing_shared_leg.py
  - tests/ledger/test_pairing_no_position_state.py
  - tests/ledger/test_pairing_roll_guard.py
  - tests/ledger/test_pairing_seeded_faults.py
  - tests/ledger/conftest.py
findings:
  critical: 2
  warning: 1
  info: 0
  total: 3
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-09-01T11:01:34Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

This is careful, self-aware code — the honest-limit paragraphs throughout `pairing.py` and the test
docstrings are unusually candid about what is and isn't proven. The core arithmetic (`_signed_leg_amount`,
`_net_amount`), the two disambiguation rules that are implemented (Rule 1: role from `position_effect`
only; Rule 2: `position_effect` read from the fill, never derived from position state), the purity gate,
and the oracle's own assertions all check out under direct tracing — I verified the sign convention by
hand against three of the thirteen real calendars (`65aac62e`, `8a63aa81`, `60c46a57`/`24f1e72e`) and the
arithmetic reproduces the recorded `open_net_debit`/`close_net_credit` figures exactly. The seeded-fault
suite genuinely patches the module-global `_signed_leg_amount` (Python resolves it at call time, so
`monkeypatch.setattr` on the module object is effective, not cosmetic), and the shared-front-leg test
asserts the real disambiguated figure (`10.20`), not merely "no exception" — none of the oracle assertions
are decorative.

Two real problems remain, both in the highest-stakes function in this codebase
(`resolve_fill_positions`/`sync_events`), and both are the kind of thing this file's own honest-limit
paragraphs did *not* name:

1. **The order-anchor disambiguation SQL can crash with a Postgres runtime error, instead of leaving the
   fill explicitly unresolved, on a specific real-world order shape the fixture suite does not cover.**
2. **`sync_events`'s idempotency is read-compare-skip with no per-user serialization and no database
   backstop** — the module's own docstring says "no DB uniqueness constraint" on `fill_ids_hash`, and
   nothing else closes that window.

## Critical Issues

### CR-01: The order-anchor resolution query can raise instead of leaving an ambiguous fill unresolved

**File:** `src/morai/ledger/pairing.py:89-104` (`RESOLVE_FILL_POSITIONS_SQL`, the `order_anchors` CTE and
the final correlated scalar subquery)

**Issue:** `order_anchors` is `DISTINCT user_id, order_id, position_id` collected across *every* anchor
symbol in one order — so one order can legitimately produce **two or more distinct anchor positions** in
`order_anchors` when it contains two or more different legs, each uniquely anchoring to a *different*
position. The final `SELECT`'s `resolved_position_id` is a **scalar** subquery:

```sql
(SELECT oa.position_id FROM order_anchors oa
  WHERE oa.user_id = fc.user_id AND oa.order_id = fc.order_id
    AND oa.position_id IN (
      SELECT position_id FROM fill_candidates fc2
      WHERE fc2.user_id = fc.user_id AND fc2.order_id = fc.order_id
        AND fc2.occ_symbol = fc.occ_symbol AND fc2.leg_index = fc.leg_index
        AND fc2.execution_time = fc.execution_time
    )
) AS resolved_position_id
```

Consider one order with three legs: leg X (symbol unique to position P1), leg Y (symbol unique to
position P2), and leg Z (symbol shared by *both* P1 and P2 — the genuinely ambiguous leg Rule 3 exists to
resolve). `order_anchors` for this order now contains **both** P1 and P2 (one row per anchor symbol,
deduped by `DISTINCT`). When resolving leg Z's fill, the inner `fc2` subquery returns `{P1, P2}` (both
positions hold that symbol), so the outer `IN (...)` no longer narrows `order_anchors` to one row — it
returns **both** P1 and P2. A scalar subquery that returns more than one row is a Postgres runtime error
("more than one row returned by a subquery used as an expression"), not a `NULL`. `resolve_fill_positions`
has no `try`/`except` around this call, so `sync_events` — and therefore the whole ledger sync for that
user — raises and aborts, rather than leaving leg Z's fill explicitly unresolved the way `NN-11` requires.

This is exactly the order shape Rule 3 is written for (a genuinely shared leg, disambiguated by the
order's *other* legs) — it is not a contrived case. The fixture suite's own negative control
(`_seed_unresolvable_order`, exercised via `tests/ledger/test_pairing_shared_leg.py::
test_two_positions_sharing_both_legs_leave_fills_explicitly_unresolved`) only covers the *zero*-anchor
case (both legs shared, no anchor for any symbol in the order), where `order_anchors` is empty and the
scalar subquery correctly returns `NULL`. It does not cover the *two-conflicting-anchors* case, so this
path is untested and will crash the first time a real order has this shape — e.g., a multi-leg roll order
that closes one calendar's front leg, opens a new calendar sharing that same front leg with a second
existing position, while also touching a leg unique to each side. Given rolls are explicitly the highest-
risk transaction type named in this project's own history (`LEDGER-01`, the `-$319,850` incident), this is
squarely in the blast radius the module is trying to guard.

**Fix:** Make the correlated subquery aggregate to a single scalar unconditionally, and only return a
position when exactly one candidate anchor survives the `IN` filter — collapsing the ambiguous case to
`NULL` (explicitly unresolved) instead of raising:

```sql
(SELECT CASE WHEN COUNT(*) = 1 THEN MIN(oa.position_id) END
 FROM order_anchors oa
 WHERE oa.user_id = fc.user_id AND oa.order_id = fc.order_id
   AND oa.position_id IN (
     SELECT position_id FROM fill_candidates fc2
     WHERE fc2.user_id = fc.user_id AND fc2.order_id = fc.order_id
       AND fc2.occ_symbol = fc.occ_symbol AND fc2.leg_index = fc.leg_index
       AND fc2.execution_time = fc.execution_time
   )
) AS resolved_position_id
```

Add a test seeding this three-leg, two-anchor, one-shared-leg shape (mirroring
`_seed_unresolvable_order` but with the third and fourth legs each uniquely anchored) and assert the
shared leg comes back unresolved rather than the call raising.

### CR-02: `sync_events`'s read-compare-skip idempotency has no concurrency guard, and no DB backstop exists

**File:** `src/morai/ledger/pairing.py:359-404` (`sync_events`, the "Idempotency (LEDGER-09)" paragraph and
its implementation)

**Issue:** The module's own docstring states plainly: `events.fill_ids_hash` has no DB uniqueness
constraint, so idempotency is enforced purely in application code by reading existing
`(position_id, event_type, fill_ids_hash)` triples and skipping drafts that already match. Between that
read (`existing = await read_events(...)`) and the write (`await insert_events(...)`), there is no
per-user serialization anywhere in this call path — no `pg_advisory_xact_lock`, no `SELECT ... FOR UPDATE`,
nothing analogous to the per-user Schwab-token-refresh lock this same project already treats as
load-bearing for exactly this class of race (`CLAUDE.md`'s own "Token refresh takes a per-user
single-writer lock" constraint). If two `sync_events` calls for the same `(user_id)` overlap — a manual
"resync now" while the scheduled worker's own sweep is still in flight, a retried job dispatched before the
first attempt's outcome is known, or simply two requests racing — both read the same `existing_triples`
set (neither sees the other's not-yet-committed insert under Postgres's default read-committed isolation),
both derive the same drafts, and both insert them. There is no unique index on
`(user_id, position_id, event_type, fill_ids_hash)` to catch this at the database layer, so the result is
two rows: a duplicated OPEN or CLOSE event for the same real trade, silently doubling that leg's
contribution to realized P&L — the exact core-value violation this project states as its reason to exist
("the sum of realized P&L over any window must equal the broker's cash delta... If that fails, no other
number in the system is trustworthy").

**Fix:** Either (a) take a per-user advisory lock at the top of `sync_events`
(`SELECT pg_advisory_xact_lock(hashtext(:user_id))`) so two concurrent calls for the same user serialize
around the read-compare-skip window, mirroring the project's own per-user-lock precedent for token
refresh, or (b) add a partial unique index on `events(user_id, position_id, event_type, fill_ids_hash)
WHERE fill_ids_hash IS NOT NULL` as a database-level backstop and catch the resulting `IntegrityError` in
`insert_events` as a benign duplicate. (a) is cheaper and matches an existing project pattern; (b) is the
belt this project otherwise insists on everywhere else money is at stake (`insert_events`'s own ROLL guard
is described as "the database `CHECK` constraint... is the backstop, not the only guard" — the same
belt-and-suspenders reasoning applies here and is currently missing on this specific path).

## Warnings

### WR-01: `_signed_leg_amount` silently treats any non-`"BUY"`/non-`"SELL"` side as a SELL

**File:** `src/morai/ledger/pairing.py:187-192`

**Issue:**

```python
if event_type is EventType.OPEN:
    return amount if fill.side == "BUY" else -amount
return amount if fill.side == "SELL" else -amount
```

Both branches are a binary `== "BUY"`/`== "SELL"` check with an `else` that assumes the opposite value.
`side` is an unconstrained `Text` column in the DB (`src/morai/db/models.py:165`), sourced from the
vendor's own field per `NN-9`. If a fill ever arrives with a `side` value that is neither the literal
string `"BUY"` nor `"SELL"` — a vendor typo, a new value Schwab's API introduces, a malformed row from a
future ingestion bug — this function does not raise or return `None` (the project's own stated convention
for a gap, `NN-16`); it silently signs the amount as though the fill were a sell (for OPEN) or a buy (for
CLOSE). That is a guess dressed as a gap, which is precisely what `NN-16` and this module's own stated
philosophy exist to prevent elsewhere (e.g. `_signed_leg_amount`'s `None`-on-missing-quantity/price
handling one paragraph above it does this correctly). The module's own docstring already names "not proven
against Schwab's live payload shape" as an honest limit for Phase 6 — this is the concrete spot where an
unrecognized value silently produces a wrong-signed dollar figure rather than surfacing as a gap.

**Fix:**

```python
if fill.side not in ("BUY", "SELL"):
    raise ValueError(f"unrecognized fill side: {fill.side!r}")
if event_type is EventType.OPEN:
    return amount if fill.side == "BUY" else -amount
return amount if fill.side == "SELL" else -amount
```

(Or thread it through as another `None`-producing gap, consistent with the quantity/price handling
immediately above, if a hard raise is considered too disruptive for a single malformed fill among many.)

## Clean

Verified directly and found no issue:

- **Sign convention** (`_signed_leg_amount`/`_net_amount`): hand-traced against calendars `65aac62e`
  (32.35/36.35), `8a63aa81` (10.20/10.55), and `60c46a57`/`24f1e72e` — arithmetic reproduces the recorded
  figures exactly in each case. No `abs()` anywhere in `pairing.py`, `fills.py`, or `events.py`.
- **Rule 1** (`classify_fill`): single-parameter signature, takes only `position_effect`; `side` is not
  passed to it and does not influence role anywhere in `derive_events`.
- **Rule 2**: `position_effect` is read from `FillRecord.position_effect` (a plaintext DB column written
  from the vendor payload), never derived from `positions` state — confirmed structurally by
  `test_pairing_never_imports_or_references_position`'s AST walk, which is a real gate (it correctly flags
  both an `ImportFrom morai.db.models import Position` and any bare `Position` name reference; it does not
  false-positive on the module's own docstring prose, which never uses the capitalized identifier).
- **Purity** (`derive_events`): no `AsyncSession`, no clock read, no I/O. The AST-based no-broker-import
  gate (`test_pairing_imports_no_vendor_broker_or_http_module`) correctly matches `ImportFrom` module
  prefixes including dotted submodules, not just exact names.
- **Idempotency happy path**: `test_pairing_idempotency.py` and the shared-leg replay test both prove
  repeated `sync_events` calls (sequential, not concurrent) converge on stable row counts and stable
  `fill_ids_hash` sets. The gap is concurrency (`CR-02`), not the single-caller logic.
- **Oracle assertions are real, not decorative**: exact `Decimal` equality throughout (no
  `pytest.approx`/tolerance); the shared-front-leg test asserts `8a63aa81`'s OPEN event equals `10.20`
  (the correct disambiguated figure), not merely that resolution completes without error; the 14th
  synthetic fixture is asserted to produce exactly one event of type `OPEN` with no CLOSE; the four global
  invariants (54 fills, 27 events, zero unresolved/unclassified, zero non-OPEN/CLOSE event types) are all
  read back from Postgres, not tallied in memory.
- **Seeded-fault suite is genuinely adversarial**: `monkeypatch.setattr(pairing, "_signed_leg_amount",
  fault)` is effective because `_net_amount` looks up `_signed_leg_amount` as a module-global at call time,
  not a bound reference captured at import time — confirmed by reading both functions. Each fault wraps
  the real function over a mutated/copied input rather than reimplementing arithmetic, so it differs from
  the truth by exactly the one named defect. The control case runs first (file order, no test-order
  randomization) and again last, proving `monkeypatch` reverted cleanly.
- **`detect_roll`**: correctly proven `False` on the one real order that must not be mistaken for a roll
  (`1006797510202`); intentionally unreachable from any derivation path this phase, and that is documented
  rather than left implicit.
- **Typing**: no `Any`, no `cast`, no bare `# type: ignore` in any reviewed file; the `# pyright:
  ignore[reportPrivateUsage]` occurrences all carry a `why:` justification and follow the codebase's
  existing convention for two cooperating modules sharing a private helper.
- **RLS/session discipline**: `insert_fills`/`insert_events`/`sync_events` correctly never commit, for the
  documented reason (an internal commit would reset the transaction-local `app.current_user_id` GUC).
  `RESOLVE_FILL_POSITIONS_SQL`'s `position_legs` CTE is correctly scoped only by `user_id`, never narrowed
  per-position — confirmed this is what makes the shared-front-leg disambiguation work at all (`L061`).

---

_Reviewed: 2026-09-01T11:01:34Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
