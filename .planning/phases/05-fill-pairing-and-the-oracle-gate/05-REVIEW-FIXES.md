---
phase: 05-fill-pairing-and-the-oracle-gate
fixed: 2026-09-01
source_review: 05-REVIEW.md
findings_fixed: 3
findings_skipped: 0
---

# Phase 5 Review Fixes

**Fixed:** 2026-09-01
**Source review:** `.planning/phases/05-fill-pairing-and-the-oracle-gate/05-REVIEW.md`

All three verified findings (CR-01, CR-02, WR-01) are fixed. Each RED test preceded its
fix and each RED was a genuine, naturally-occurring failure — no scaffolding was built to
manufacture a more interesting one, per this repo's own speed rule.

## CR-01 (BLOCKER): order-anchor resolution could raise instead of leaving a fill unresolved

**File:** `src/morai/ledger/pairing.py` — `RESOLVE_FILL_POSITIONS_SQL`

**What changed:** The final `resolved_position_id` scalar subquery could return more than
one row when an order's other legs anchored to two different positions and the ambiguous
leg's candidate set intersected both. Postgres raised `CardinalityViolationError` (`more
than one row returned by a subquery used as an expression`), aborting the whole
`sync_events` call for that user instead of leaving the ambiguous fill explicitly
unresolved (`NN-11`). The subquery now aggregates: `CASE WHEN COUNT(*) = 1 THEN
MIN(oa.position_id::text)::uuid END`, collapsing a two-(or more)-anchor conflict to `NULL`
unconditionally instead of crashing. Kept the existing `::text` round-trip cast for the
`MIN(uuid)` (Postgres has no native `MIN` aggregate for `uuid`) — the reviewer's own
illustrative SQL used a bare `MIN(oa.position_id)`, which does not compile; the fix used
here matches the pattern the file's own `anchors` CTE already established one block above,
rather than the reviewer's fix suggestion verbatim.

**RED evidence:** Seeded a three-leg, two-anchor conflict shape in
`tests/ledger/test_pairing_shared_leg.py` (leg X uniquely anchors to position 1, leg Y
uniquely anchors to position 2, leg Z is shared by both — the exact shape CR-01
describes). Before the fix:

```
E   asyncpg.exceptions.CardinalityViolationError: more than one row returned by a subquery used as an expression
```

Genuine crash, reproduced against real Postgres 18 — not a manufactured red.

**GREEN evidence:** After the fix, `test_two_anchor_conflict_leaves_shared_leg_unresolved_without_raising`
passes: `sync_events` does not raise, leg Z's fill lands in `derivation.unresolved`
(1 entry, keyed on the shared symbol), and legs X and Y still resolve to their own
positions and land as two independent OPEN events with the correct per-leg amounts.
`tests/ledger/` run in full immediately after this fix: exit 0, no failures (see the
final full-suite run below for the exact total).

**Judgment call:** None beyond the `MIN(uuid)` cast correction above — that is a
correctness fix to the reviewer's illustrative SQL, not a design choice.

**Commits:** `119a238` (RED), `c54dab8` (GREEN)

## CR-02 (BLOCKER): `sync_events` idempotency had no concurrency guard

**File:** `src/morai/ledger/pairing.py` — `sync_events`

**What changed:** The read-compare-skip idempotency window (read `existing_triples`,
derive drafts, insert only the new ones) had no per-user serialization and no database
backstop. Two overlapping `sync_events` calls for the same user could both read the same
empty `existing_triples` under read-committed isolation and both insert, duplicating an
OPEN/CLOSE event and silently doubling that leg's contribution to realized P&L. Added
`SELECT pg_advisory_xact_lock(hashtext(:uid))` at the top of `sync_events`, before the
resolve/read/derive/write sequence — the same transaction-scoped, per-user advisory-lock
shape `vendor/connections.py::schwab_client_for_user` already uses for the identical class
of race (this project's own per-user token-refresh-lock precedent, named directly in
`CLAUDE.md`).

**Judgment call:** The review offered two options — (a) a per-user advisory lock, or (b) a
partial unique index on `events(user_id, position_id, event_type, fill_ids_hash) WHERE
fill_ids_hash IS NOT NULL` as a database-level backstop. Chose (a) only: it is cheaper,
matches an existing project pattern exactly, and — because it serializes the entire
read-compare-insert window per user rather than only catching the write — closes the race
at its actual source rather than after the fact. Did not add (b) in this pass: introducing
a new unique index and its `IntegrityError`-catching path in `insert_events` is a second,
independent change with its own migration and its own test surface, and the review itself
frames (a) and (b) as alternatives ("Either (a) ... or (b) ..."), not a required pair. If a
belt-and-suspenders backstop is wanted later, (b) is still available as a follow-up and is
unrelated to whether (a) is correct.

**RED evidence:** Two concurrent `sync_events` calls for the same user, on two independent
engines, fenced by `asyncio.Barrier(2)` immediately before each call — the same
two-engine-plus-barrier shape `tests/vendor/test_upsert_connection_race.py` and
`tests/vendor/test_refresh_lock.py` already establish. Before the fix:

```
E       AssertionError: assert 4 == 2
```

Four events landed instead of two — genuine duplication, reproduced against real Postgres
18, not a manufactured red.

**GREEN evidence:** After the fix, `test_two_concurrent_sync_events_calls_write_exactly_one_event_set`
passes: neither call raises, and exactly one event set (2 events, 2 distinct
`fill_ids_hash` values) survives. Re-ran the test three times in isolation to check for
flakiness — passed every time (this machine runs no sibling agent against the same
Postgres instance during this session, so a red here is real, per `V093`). `tests/ledger/`
run in full immediately after this fix: exit 0, no failures.

**Commits:** `296da3e` (RED), `5133fc2` (GREEN)

## WR-01 (WARNING): `_signed_leg_amount` guessed a sign for an unrecognized `side`

**File:** `src/morai/ledger/pairing.py` — `_signed_leg_amount`

**What changed:** Both branches (`OPEN`/`CLOSE`) used a binary `== "BUY"`/`== "SELL"` check
with an `else` that assumed the opposite value, so a `side` that was neither literal string
silently signed the amount as though the fill were a sell (OPEN) or a buy (CLOSE) — a guess
dressed as a gap, in the one place `_signed_leg_amount` did not already follow its own
`NN-16` convention (its missing-quantity/price handling one line above does this
correctly). Added an explicit check: `if fill.side not in ("BUY", "SELL"): return None`,
placed before the existing sign logic.

**Judgment call:** The review offered `raise ValueError(...)` as the primary fix and named
`None` as the parenthetical alternative "if a hard raise is considered too disruptive."
Chose `None`: it is consistent with this exact function's own established contract one
paragraph above (missing `quantity`/`price_usd` already returns `None`, never raises), and
with `_net_amount`'s own behavior (a `None` member already makes the whole net amount
`None` rather than a partial figure) — so a malformed `side` among many fills in an order
degrades that one event to an honest gap rather than aborting the whole derivation call for
every other fill in the batch. A raise would be a strictly more disruptive failure mode for
a single malformed row among potentially many, with no compensating benefit this module's
own design does not already get from the gap propagating through `_net_amount` and
eventually `Derivation`.

**RED evidence:** A `FillRecord` with `side="MYSTERY"`. Before the fix:

```
E       AssertionError: assert Decimal('-1') is None
```

The function silently returned a signed `Decimal` rather than surfacing the gap — genuine
red, no scaffolding.

**GREEN evidence:** After the fix, `test_signed_leg_amount_returns_none_for_unrecognized_side`
passes for both `EventType.OPEN` and `EventType.CLOSE`. `tests/ledger/` run in full
immediately after this fix: exit 0, no failures.

**Commits:** `40c16bd` (RED), `2b90659` (GREEN)

## Housekeeping commit

`372cf8b` — one CR-02 test function name exceeded ruff's 88-character line limit
(`E501`), caught by `tools/gate.sh` after all three fixes were committed. Renamed only
(`test_two_concurrent_sync_events_calls_for_one_user_write_exactly_one_event_set` →
`test_two_concurrent_sync_events_calls_write_exactly_one_event_set`); no behavior change.

## Full verification

```
export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai"
export MORAI_APP_DB_PASSWORD="localdevpassword"
export MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ="
export MORAI_ENV_FILE=""
uv run pytest -q            # exit 0, no failures (baseline was 322 passed; 3 new tests added)
bash tools/gate.sh          # ruff, basedpyright, mypy all clean; "325 passed, 36 warnings in 48.18s"; exit 0
```

`tests/ledger/` alone, run standalone after all three fixes: exit 0, no failures — 85 test
items collected (`pytest --collect-only -q tests/ledger/`, summed per-file), against the
322-passing baseline noted in this task's own prompt (322 total repo-wide, before the 3
tests this pass adds).

Oracle gate re-run explicitly (`tests/ledger/test_oracle_gate.py`): 15 passed — 13
calendars at exact `Decimal` equality, 54 fills, 27 events, zero orphans, no spurious ROLL,
all unchanged from before this fix pass. No fix in this pass touched oracle arithmetic or
any of the 13 real calendar fixtures; the two-anchor-conflict and unrecognized-`side`
scenarios both use synthetic, out-of-range symbols/values that cannot collide with real
oracle data.

`STATE.md`, `ROADMAP.md`, and `salvage/` were not touched, per this task's scope boundary.

---

_Fixed: 2026-09-01_
_Fixer: Claude (gsd-code-fixer)_
