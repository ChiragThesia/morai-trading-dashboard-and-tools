---
phase: 07-position-and-campaign-read-models
plan: 03
subsystem: database
tags: [zoneinfo, tzdata, sqlalchemy, postgres, pydantic, settlement, idempotency]

# Dependency graph
requires:
  - phase: 07-02
    provides: closed-state derivation (derive_position_state), positions.py module layout
provides:
  - "src/morai/ledger/settlements.py: settlement_instant, LegRecord, DerivedSettlement, derive_settlements, read_legs"
  - "EventType.SETTLEMENT member on pairing.py"
  - "sync_events(..., as_of: datetime | None = None) folding settlement drafts into the one write path"
  - "sync_events idempotency key widened from a 3-tuple to a 4-tuple including event_time"
affects: [07-04, 07-05, phase-8-snapshot-repricing, phase-9-reconciliation]

# Actuals (#2632)
actuals:
  tokens: 3918
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: ["tzdata==2026.3"]
  patterns:
    - "Pure derivation + thin async shell (derive_settlements/read_legs), mirroring derive_events/sync_events exactly"
    - "Local (function-body) import inside sync_events to break the pairing.py <-> settlements.py circular import"

key-files:
  created:
    - src/morai/ledger/settlements.py
    - tests/ledger/test_settlements.py
  modified:
    - src/morai/ledger/pairing.py
    - pyproject.toml
    - uv.lock

key-decisions:
  - "tzdata provenance verified live against the PyPI JSON API (github.com/python/tzdata, no requires_dist, wheel+sdist only) before install, per the blocking-human checkpoint the orchestrator had already approved"
  - "Settlement style read from legs.root only (D7-08); AM_SETTLEMENT_TIME/PM_SETTLEMENT_TIME are named zoneinfo constants, never a hardcoded UTC offset"
  - "Idempotency key widened to (position_id, event_type, event_time, fill_ids_hash) -- closes the Pitfall 2 collision where two legs' SETTLEMENT drafts shared an identical 3-tuple"
  - "sync_events' as_of defaults to None, which skips settlement derivation entirely -- the 13-calendar oracle and every existing caller need no change"

requirements-completed: [LEDGER-06, LEDGER-07]

coverage:
  - id: D1
    description: "A leg past its expiry generates a persisted SETTLEMENT event from its expiry and strike, no fill, no broker call"
    requirement: LEDGER-06
    verification:
      - kind: unit
        ref: "tests/ledger/test_settlements.py#test_derive_settlements_produces_one_draft_at_or_after_expiry"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_settlements.py#test_sync_events_mixed_style_position_lands_two_settlement_rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "A PM-settled SPXW front and an AM-settled SPX back in one position each settle on their own style and date, producing two SETTLEMENT rows with distinct event_time values"
    requirement: LEDGER-07
    verification:
      - kind: unit
        ref: "tests/ledger/test_settlements.py#test_derive_settlements_mixed_style_position_produces_two_distinct_drafts"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_settlements.py#test_sync_events_mixed_style_position_lands_two_settlement_rows"
        status: pass
    human_judgment: false
  - id: D3
    description: "SETTLEMENT rows carry NULL fill_ids_hash and NULL money fields, never zero"
    verification:
      - kind: integration
        ref: "tests/ledger/test_settlements.py#test_sync_events_settlement_rows_have_null_money_and_hash"
        status: pass
    human_judgment: false
  - id: D4
    description: "13-calendar oracle stays byte-identical -- exactly 4 events per calendar, all OPEN or CLOSE, file unmodified"
    verification:
      - kind: integration
        ref: "tests/ledger/test_oracle_gate.py -x -q (git diff --stat shows no change)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-01
status: complete
---

# Phase 7 Plan 3: Per-leg Settlement Derivation Summary

**A pure `derive_settlements(legs, events, *, as_of)` function generates SETTLEMENT events from each leg's own expiry and `root`-based style, folded into `sync_events` behind a widened 4-tuple idempotency key that closes the silent two-legs-one-triple collision.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-09-01T (see git log timestamps)
- **Completed:** 2026-09-01
- **Tasks:** 3 (1 checkpoint, 2 TDD)
- **Files modified:** 5 (settlements.py new, test_settlements.py new, pairing.py, pyproject.toml, uv.lock)

## Accomplishments

- `tzdata==2026.3` provenance verified against the live PyPI JSON API (name, version, upload date, `github.com/python/tzdata` source repo, zero `requires_dist`, wheel+sdist only) before install — matches the checkpoint's expected facts exactly, no anomaly found
- `settlement_instant(expiry, *, root)`: `SPX` → 09:30 ET, `SPXW` → 16:00 ET, via `zoneinfo.ZoneInfo("America/New_York")`, DST proven by differing UTC offsets between a winter and summer expiry, never a hardcoded offset
- Style is read from `legs.root` alone — an SPXW expiry on a real third Friday still settles PM, proving the D026 mistagging bug cannot recur
- `derive_settlements` is pure (no `AsyncSession`, no clock read — `as_of` is the only time input, asserted via `inspect.signature`) and returns `DerivedSettlement`, a type that structurally cannot carry a money field
- `EventType.SETTLEMENT` added; `sync_events` gained a keyword-only `as_of: datetime | None = None` — `None` (the default) skips settlement derivation entirely, so the oracle suite and every pre-existing caller are unaffected
- The idempotency key widened from `(position_id, event_type, fill_ids_hash)` to `(position_id, event_type, event_time, fill_ids_hash)`, closing Pitfall 2: a SETTLEMENT's `fill_ids_hash` is always `None` and `events` has no `leg_id` column, so two legs of one position previously collapsed to an identical triple and the second row was silently dropped on the very first sync
- Mixed-style regression test (`test_sync_events_mixed_style_position_lands_two_settlement_rows`) asserts a count of exactly `2` with two distinct `event_time` values — the test shape Pitfall 2 explicitly names as the warning sign when missing

## Task Commits

Each task was committed atomically, TDD tasks as separate test → feat commits:

1. **Task 1: Verify `tzdata` before installing it** — checkpoint verified via live `curl` to the PyPI JSON API (no separate commit; the install itself lands in Task 2's feat commit)
2. **Task 2: Settlement style, instants, and the pure derivation**
   - `fdc9e6d` `test(07-03): failing test for settlement style and pure derive_settlements` — RED: `ModuleNotFoundError`
   - `46372ab` `feat(07-03): settlement style, DST-correct instants, pure derive_settlements` — GREEN: 9/9 pure tests, `bash tools/gate.sh` green (427 passed)
3. **Task 3: Fold settlement drafts into `sync_events` and broaden the idempotency key**
   - `6f055de` `test(07-03): failing test for settlement fold-in and 4-tuple idempotency` — RED: `TypeError`/`AttributeError`
   - `f67c0ca` `feat(07-03): fold SETTLEMENT into sync_events, widen idempotency key` — GREEN: full suite 433 passed, `bash tools/gate.sh` green

**Plan metadata:** this commit (SUMMARY.md only — STATE.md/ROADMAP.md are the orchestrator's, per this plan's parallel-wave instructions)

## Files Created/Modified

- `src/morai/ledger/settlements.py` — new: `settlement_instant`, `AM_SETTLEMENT_TIME`/`PM_SETTLEMENT_TIME`, `LegRecord`, `DerivedSettlement`, `derive_settlements`, `read_legs`
- `tests/ledger/test_settlements.py` — new: 9 pure tests + 5 db-marked `sync_events` fold-in tests + 1 `EventType.SETTLEMENT` member test, all fixtures labelled synthetic (D7-13)
- `src/morai/ledger/pairing.py` — `EventType.SETTLEMENT` added; `sync_events` gained `as_of`; idempotency key widened to a 4-tuple; docstring updated to record both changes and their rationale
- `pyproject.toml` / `uv.lock` — `tzdata==2026.3` added as an explicit dependency

## Decisions Made

- Used a local (function-body) import of `derive_settlements`/`read_legs` inside `sync_events`, mirroring `db/models.py`'s constructor-sentinel precedent — `settlements.py` already imports `parse_occ_symbol` from `pairing.py`, so a module-level import in the other direction would be circular.
- Kept the drafts loop's dedup check inside `derive_settlements` itself rather than re-filtering a second time in `sync_events` — `derive_settlements` is already the single source of truth for "is this leg's settlement already stored," so a second filter would only duplicate that logic without adding safety.
- Split the plan's Task 2 and Task 3 into their own strict RED→GREEN pairs against the single `test_settlements.py` file (moving `settlements.py` aside to observe the true `ModuleNotFoundError` before writing it), rather than writing the whole file in one pass — matches this repo's own commit-history convention on `positions.py`/`test_position_creation.py` (07-01/07-02) exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `app_db_session` needs `app.current_user_id` set explicitly before an RLS-scoped `sync_events` call**
- **Found during:** Task 3, first `pytest` run of the db-marked tests
- **Issue:** `seeded_position` seeds legs through `superuser_db_session`, which never sets `app.current_user_id` on the separate `app_db_session` connection the new tests use to call `sync_events`. Without it, `legs`' RLS `user_isolation` policy returns zero rows and every settlement test read `[]` legs.
- **Fix:** Added a `_set_current_user` helper (mirroring `tests/ledger/test_position_creation.py`'s and `tests/test_isolation.py`'s own identically-named function) and called it before each `sync_events(app_db_session, ...)` invocation, including a second call after each intermediate `commit()` since `set_config(..., true)` is transaction-local.
- **Files modified:** tests/ledger/test_settlements.py
- **Verification:** all 5 db-marked tests pass; full gate green (433 passed)
- **Committed in:** `f67c0ca` (Task 3 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to make the plan's own specified db tests runnable at all; no scope creep — the fixture wiring gap is orthogonal to the settlement logic itself.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None — no external service configuration required. `tzdata` is a pure-data PyPI package with no build steps or runtime configuration.

## Next Phase Readiness

- `EventType.SETTLEMENT` and the widened 4-tuple idempotency key are now load-bearing for any later plan touching `sync_events` (07-04's ROLL/campaign work runs in the same wave against a disjoint file set and was not touched here).
- Settlement *value* (against the SOQ) remains NULL by design (D7-07) — Phase 8's market read is the next consumer of these rows.
- No blockers. `tests/ledger/test_oracle_gate.py` and `tests/ledger/test_pairing_idempotency.py` are byte-identical to before this plan and both green.

---
*Phase: 07-position-and-campaign-read-models*
*Completed: 2026-09-01*

## Self-Check: PASSED

- FOUND: src/morai/ledger/settlements.py
- FOUND: tests/ledger/test_settlements.py
- FOUND: fdc9e6d, 46372ab, 6f055de, f67c0ca (all four task commits, `git log --oneline -5`)
