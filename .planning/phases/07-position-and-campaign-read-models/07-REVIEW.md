---
phase: 07-position-and-campaign-read-models
reviewed: 2026-09-01T18:22:12Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - alembic/versions/0014_derived_position_state_and_campaign_chain.py
  - pyproject.toml
  - src/morai/api/routes_identity.py
  - src/morai/db/models.py
  - src/morai/ingest/schwab_sync.py
  - src/morai/ledger/campaigns.py
  - src/morai/ledger/events.py
  - src/morai/ledger/pairing.py
  - src/morai/ledger/positions.py
  - src/morai/ledger/settlements.py
  - tests/crypto/test_nonce_uniqueness.py
  - tests/gate/test_ledger_write_boundary.py
  - tests/ingest/test_sync_tracer.py
  - tests/ledger/oracle_seed.py
  - tests/ledger/test_campaigns.py
  - tests/ledger/test_closed_state.py
  - tests/ledger/test_pairing_no_position_state.py
  - tests/ledger/test_pairing_shared_leg.py
  - tests/ledger/test_position_creation.py
  - tests/ledger/test_roll_check_constraint.py
  - tests/ledger/test_roll_derivation.py
  - tests/ledger/test_schema_contract.py
  - tests/ledger/test_settlements.py
  - tests/test_crypto_shred.py
  - tests/test_key_rotation.py
  - tests/test_pg_dump_confidentiality.py
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-09-01T18:22:12Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

The migration (`campaign_chain`'s `security_invoker = true`, its `CYCLE` guard, the
`roll_has_rolled_from_position` CHECK), the write-token gates on `Position`/`Leg`/`Event`, the
widened `sync_events` idempotency 4-tuple, and the ROLL money arithmetic (`_signed_leg_amount`/
`_net_amount` reused unmodified, split storage across `open_debit_usd`/`close_credit_usd`, never
netted) are all correctly implemented and match their own stated design intent. The RLS/security-
invoker behavioural proof (`test_campaign_view_respects_rls`, with its own disjointness-not-emptiness
negative control) and the `CYCLE`-termination proof (`test_cyclic_chain_terminates_instead_of_hanging`,
with the `p0` lead-in that makes it a real proof rather than a vacuous one) are both sound. The
test suite throughout this phase is unusually disciplined about negative controls and drift guards
— no vacuous-pass pattern was found in any of the 13 test files reviewed.

Two real defects were found in the settlement-derivation path, one of which means the SETTLEMENT
feature this phase built (D7-05 through D7-08) never actually runs in production despite being
fully implemented and thoroughly unit-tested in isolation. Two further defects were found in how
derived position/campaign state handles a ROLL event, both narrower in impact.

## Critical Issues

### CR-01: `sync_user` never passes `as_of` to `sync_events` — SETTLEMENT derivation is dead code in production

**File:** `src/morai/ingest/schwab_sync.py:452-453`

**Issue:** `sync_events` only derives and writes SETTLEMENT events when its `as_of` keyword argument
is non-`None` (`src/morai/ledger/pairing.py:672-688`); with `as_of=None` (the default), "settlement
derivation is skipped entirely" by the function's own docstring. `sync_user` — the only production
call site of `sync_events` (confirmed by `grep -rn "sync_events(" src/`, one hit outside the
function's own definition) — calls it as `await sync_events(session, user_id)` with no `as_of`
argument at all, even though `sync_user` already has a `now: datetime` parameter in scope (used
for `sync_windows` a few lines earlier) that is the obvious value to thread through. The worker task
that calls `sync_user` (`src/morai/worker/app.py:165-167`) does supply `now=started_at` to
`sync_user` itself, so the value exists at every layer above `sync_events` — it simply never
reaches it.

The practical effect: every piece of this phase's settlement machinery (`settlement_instant`,
`derive_settlements`, the AM/PM-by-root rule, the DST-correct `zoneinfo` conversion, the
mixed-front/back-style two-draft fix) is fully implemented and covered by `tests/ledger/
test_settlements.py`'s pure tests and its `db`-marked `sync_events(..., as_of=...)` fold-in tests —
but no code path under `src/` ever calls `sync_events` with a non-`None` `as_of`, so no `events` row
with `event_type = 'SETTLEMENT'` is ever written by a real sync. `tests/ingest/test_sync_tracer.py`,
the one test that exercises `sync_user` end-to-end through the real worker/job path, only asserts on
OPEN events (`len(open_event_rows) >= 1`) and does not notice the gap.

This is exactly the class of bug the phase's own stated core value warns about: not an incorrect
number, but a feature that looks shipped (schema, derivation, tests all green) and is silently
unreachable from the one path a real user's data travels.

**Fix:**
```python
# src/morai/ingest/schwab_sync.py, inside sync_user
await create_positions(session, user_id)
await sync_events(session, user_id, as_of=now)
```

### CR-02: `derive_settlements` mints a SETTLEMENT event for a leg whose position was already closed by ordinary fills

**File:** `src/morai/ledger/settlements.py:99-138`

**Issue:** `derive_settlements` iterates every leg the user has (`read_legs` returns all of them,
unconditionally) and, for each leg whose parsed expiry's `settlement_instant` is `<= as_of`, emits a
SETTLEMENT draft unless that exact `(position_id, event_time)` pair already has a SETTLEMENT row.
It never checks whether the position was already closed by real fills before that expiry — there is
no reference to `net_quantity_for_leg`/`derive_position_state` or to `fills` anywhere in this
function or in its caller's fold-in (`sync_events`, `src/morai/ledger/pairing.py:672-688`).

This project's own trading style routinely closes calendars well before the front leg's expiry (front
legs run 8-45 DTE and are actively managed, per `CLAUDE.md`'s own description of the strategy) — so
this is not an edge case, it is the common case. Once `as_of` passes a leg's own expiry date (which
CR-01 currently prevents, but which is the very next fix), every already-closed position whose front
leg has since expired will pick up a fabricated SETTLEMENT event on next sync, permanently. Because
`derive_position_state` computes `closed_at` as `max(event_time for event in events) if is_closed`
(`src/morai/ledger/positions.py:310-312`), and a settlement instant on an already-closed position is
by construction later than the real close (you can only close *before* expiry), this SETTLEMENT event
silently overrides the position's real close date with the leg's nominal expiry date — the exact
failure class (`closed_at` disagreeing with what the fills actually show) that motivated dropping
`positions.opened_at`/`closed_at` as stored columns in this same migration (calendar `65aac62e`,
this migration's own docstring). The SETTLEMENT event itself carries no money fields (correctly
`NULL` per D7-07), so it does not corrupt P&L, but it does corrupt the derived lifecycle fact this
phase exists to get right, and it is inserted permanently (idempotency prevents a second insert, not
removal of the first).

No test in `tests/ledger/test_settlements.py` exercises a leg belonging to an already-closed
position — every fixture there (`_leg`, `seeded_position`) is legs-only or open-only, so this gap is
untested as well as unfixed.

**Fix:** Gate settlement emission on the leg's own position not already being closed at `as_of`,
e.g. compute `derive_position_state` (or at minimum `net_quantity_for_leg`) per position from the
already-available `fills`/`legs`/`events` before iterating, and skip any leg whose position's
`is_closed` is `True`:
```python
# sync_events, before calling derive_settlements — thread positions' closed
# state through so a leg on an already-closed position is never offered to
# derive_settlements at all, or pass it in and filter there explicitly.
```

## Warnings

### WR-01: `derive_position_state`'s `opened_at` ignores ROLL events, so a rolled-into position reports no open date

**File:** `src/morai/ledger/positions.py:307-308`

**Issue:** `opened_at` is derived as `min(event_time for event in events if event.event_type ==
"OPEN")`, `None` if there is none. A position that was opened via a ROLL (D7-10: the ROLL event
hangs on the *newly opened* position) has no `"OPEN"` event at all — only a `"ROLL"` event — so
`derive_position_state` reports `opened_at=None` for it even though the position was opened at a
perfectly well-defined, known time (the ROLL's own `event_time`). `routes_identity.py`'s
`PositionResponse.opened_at` (`src/morai/api/routes_identity.py:80-110`) surfaces this directly: a
position that is genuinely open, and genuinely was opened by a specific dated transaction, reads as
"no open date" through the one read route this phase exposes for it. `tests/ledger/
test_roll_derivation.py` proves the campaign chain links correctly through a roll but never asserts
`opened_at`/`read_position_state` on the newly-opened side of a chain, so this gap is unexercised by
the test suite.

This is not a fabricated value (`NN-16` is respected — it is an honest `None`, not a guess), so it is
a Warning rather than a Blocker, but it is an avoidable gap: the data needed to fill it correctly is
already in `events`.

**Fix:** Include `ROLL` alongside `OPEN` when computing `opened_at`:
```python
open_times = [
    event.event_time
    for event in events
    if event.event_type in ("OPEN", "ROLL")
]
```

### WR-02: A single-order roll of both calendar legs is undetectable and silently falls back to ordinary OPEN/CLOSE

**File:** `src/morai/ledger/pairing.py:215-326` (`_roll_pairs`), `749-793` (`detect_roll`)

**Issue:** `detect_roll` matches a candidate ROLL pair purely on `(root, strike, option_type)` plus
differing expiry. A calendar's front and back legs share the same strike and root by construction, so
when a trader rolls *both* legs of one calendar in a single broker order (a plausible, common way to
"roll the whole calendar forward" — four fills: close-front, close-back, open-new-front,
open-new-back, all sharing one strike/root), `close-front` matches *both* `open-new-front` and
`open-new-back` under `detect_roll` (both differ from `close-front`'s expiry, and strike/root/type
are identical across all four legs), giving it two candidates. `_roll_pairs`'s own ambiguity rule
(`if len(matches) != 1: continue`) then correctly refuses to guess — but the practical result is that
*neither* leg of the roll forms a ROLL pair at all, and both closing/opening pairs fall through to
the ordinary per-leg OPEN/CLOSE grouping instead. The new calendar is created as an entirely
unrelated position with no `rolled_from_position_id`, so `campaign_chain` never links it to the one
it replaced — the exact continuity criterion 4 exists to provide is lost for what is likely the most
common single-order roll shape for this project's own trading style, with no error, log line, or
test coverage naming it as a known limitation the way other exclusions in this module are (e.g. the
"no fixture proves a single-leg structure" note in `positions.py`, or the `1006797510202`
negative-control fixture, which is a *different*-strike two-calendar collision, not this same-strike
four-leg case).

This falls squarely inside NN-11's "leave unformed rather than guess" discipline, so it is not
incorrect data — but it is a real, silent gap in the one feature (campaign continuity) this phase
was built to deliver, and it is currently undocumented as a limitation anywhere near the code that
produces it.

**Fix:** At minimum, document the limitation next to `detect_roll`/`_roll_pairs` the way this
module's other known gaps are documented. If continuity for this case matters before Phase 8, extend
the disambiguation to also require `leg_index`/relative-position matching (e.g. pair same-`leg_index`
closing/opening fills first) before falling back to the strike/root/type-only predicate.

---

_Reviewed: 2026-09-01T18:22:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
