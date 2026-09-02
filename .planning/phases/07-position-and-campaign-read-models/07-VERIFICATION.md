---
phase: 07-position-and-campaign-read-models
verified: 2026-09-01T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Exercise a settlement-generating sync on the real Railway container (deploy this phase, run `sync_user` for a user whose legs are past expiry) and confirm no `ZoneInfoNotFoundError` is raised."
    expected: "`ZoneInfo(\"America/New_York\")` constructs successfully and SETTLEMENT events are written, exactly as they are locally."
    why_human: "macOS always ships system tz data, so a local pass proves nothing about the deployed image. `tzdata==2026.3` is now pinned as an explicit dependency (`pyproject.toml`, `uv.lock`), which should fix this on a minimal container, but `07-VALIDATION.md` itself lists this as Manual-Only and it has not been exercised on Railway. No production deploy or Railway log evidence for phase 7 was available to check during this verification."
---

# Phase 7: Position and Campaign Read Models Verification Report

**Phase Goal:** Open/closed state, per-leg settlement, and rolled-position chains are computed from events, with no second writer for anything derivable.
**Verified:** 2026-09-01
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A position's closed state is computed from net quantity per leg, and no status column exists anywhere that could disagree with it | ✓ VERIFIED | Live DB: `positions` has only `id`, `user_id`, `created_at` (no `opened_at`/`closed_at`); `information_schema.columns` scan for `%status%`/`%opened_at%`/`%closed_at%`/`%state%` across the whole schema returns only `procrastinate_jobs.status` and `sync_runs.status` (job-queue/sync-run bookkeeping, not position state). `derive_position_state`/`net_quantity_for_leg` (`src/morai/ledger/positions.py`) are pure Python over decrypted `FillRecord`s, signed from `side` only (never `abs()`), gapping to `is_closed = None` on an unrecognised `side` or `None` quantity — proven by `tests/ledger/test_closed_state.py::test_unrecognised_side_makes_leg_net_none_and_neither_open_nor_closed` and `::test_none_quantity_produces_the_same_none_net_for_its_leg`, both of which ran green in this session. |
| 2 | A leg that reaches expiry generates a SETTLEMENT event from its expiry and strike with no fill present and no broker call made | ✓ VERIFIED | `derive_settlements` (`src/morai/ledger/settlements.py`) is a pure function (`legs`, `events`, `as_of`, `closed_positions` — no `AsyncSession`, asserted structurally by `test_derive_settlements_takes_no_session_and_reads_no_clock`). CR-01's dead-code defect (settlement derivation built and unit-tested but never reachable from production because `sync_user` never passed `as_of`) is fixed and confirmed live at `src/morai/ingest/schwab_sync.py:461` (`await sync_events(session, user_id, as_of=now)`). Exercised through the *real* production path — not a unit test on `derive_settlements` — by `tests/ingest/test_sync_tracer.py::test_sync_user_job_derives_settlement_for_an_expired_open_leg`, which defers the actual `sync_user` Procrastinate task, drains a real worker run, and asserts 2 SETTLEMENT rows land. Ran green in this session. |
| 3 | A PM-settled SPXW front leg and an AM-settled SPX back leg sit inside one position, each settling on its own style and its own date | ✓ VERIFIED | Style is read from `legs.root` only (`settlement_instant`, `src/morai/ledger/settlements.py`) — `SPX` → 09:30 ET, `SPXW` → 16:00 ET, including on a real third Friday (`test_settlement_instant_spxw_third_friday_is_still_pm`, guarding `D026`). `seeded_position` fixture (`tests/ledger/conftest.py`) is exactly this shape: one position, SPXW front (`SPXW260618P07275000`) and SPX back (`SPX260717P07275000`). `test_sync_events_mixed_style_position_lands_two_settlement_rows` asserts **two distinct** SETTLEMENT rows with two distinct `event_time`s land through the real `sync_events` path (Pitfall 2's collision regression, which the widened 4-tuple idempotency key fixes). Ran green in this session. |
| 4 | A campaign returns as a chain of rolled positions computed from events, and dropping the campaign read model and recomputing it from events yields the identical chain | ✓ VERIFIED | Live DB: `campaign_chain` is `relkind='v'` (plain VIEW, not materialized) with `reloptions = {security_invoker=true}` — confirmed by direct `pg_class` query. `test_recompute_from_events_matches_original_row_for_row` (`tests/ledger/test_campaigns.py`) is the literal test: seeds a 3-position roll chain, reads it, `DROP VIEW campaign_chain`, re-executes migration 0014's own `_CAMPAIGN_CHAIN_VIEW_SQL` verbatim (loaded by path, not retyped), re-reads, asserts row-for-row equality, and restores the view in a `finally`. Ran green in this session. RLS isolation (`test_campaign_view_respects_rls`) has a genuine disjointness-not-emptiness negative control (`test_campaign_view_returns_own_chain_not_vacuously_empty`) so the pass isn't vacuous. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### "No second writer for anything derivable" (phase goal's own wording)

D7-14's gate test (`tests/gate/test_ledger_write_boundary.py`) is an AST scan (not a line regex, so it survives the sentinel imports wrapping across lines) parametrized over the three write-token sentinels (`_POSITION_WRITE_TOKEN`, `_LEG_WRITE_TOKEN`, `_EVENT_WRITE_TOKEN`), asserting the exact set of tracked files that reference each sentinel equals exactly the sentinel's own defining module plus `db/models.py`. Each parametrization carries its own positive control (a synthetic offending file that must be caught, single-line and multi-line import forms both) and a negative control (importing a public name must never be mistaken for importing the sentinel). Not vacuous — the scanner is proven to fire. Ran green in this session (part of the 459-test full suite and the 81-test targeted run).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `alembic/versions/0014_derived_position_state_and_campaign_chain.py` | Drops `positions.opened_at`/`closed_at`, adds `events.rolled_from_position_id` + CHECK, creates `campaign_chain` view | ✓ VERIFIED | Migration applied; live DB confirms all three effects. `alembic_version` reads `0014`. |
| `src/morai/ledger/positions.py` | Pure closed-state derivation, position/leg creation path (D7-12) | ✓ VERIFIED | `derive_position_state`, `net_quantity_for_leg`, `create_positions` all present and exercised by `tests/ledger/test_closed_state.py`, `tests/ledger/test_position_creation.py`. |
| `src/morai/ledger/settlements.py` | Pure `derive_settlements`, `settlement_instant`, `read_legs` shell | ✓ VERIFIED | All present; `open_debit_usd`/`close_credit_usd` are type-level absent from `DerivedSettlement` (no money field to accidentally populate), matching D7-07. |
| `src/morai/ledger/campaigns.py` | `read_campaign_chain`/`read_campaign_for_position` over the view | ✓ VERIFIED | Present, exercised by `tests/ledger/test_campaigns.py`. |
| `src/morai/ledger/pairing.py` | Positive ROLL derivation (D7-09), `sync_events` fold-in of settlement + closed-position gating (CR-02) | ✓ VERIFIED | `_roll_pairs`/`detect_roll` reuse `_signed_leg_amount`/`_net_amount` unmodified; `sync_events` computes `closed_positions` via `derive_position_state` before calling `derive_settlements`, confirmed at `pairing.py:741-752`. |
| `tests/gate/test_ledger_write_boundary.py` | D7-14 no-second-writer gate | ✓ VERIFIED | Present, non-vacuous (see above), green. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `worker/app.py` `sync_user_task` | `ingest/schwab_sync.py::sync_user` | Procrastinate task dispatch | WIRED | `test_sync_user_job_derives_settlement_for_an_expired_open_leg` exercises this exact path end to end. |
| `schwab_sync.py::sync_user` | `pairing.py::sync_events(..., as_of=now)` | CR-01 fix | WIRED | Confirmed at `schwab_sync.py:461`; was the phase's one dead-code defect, now live. |
| `pairing.py::sync_events` | `settlements.py::derive_settlements` | `closed_positions` computed via `derive_position_state` first (CR-02 fix) | WIRED | Confirmed at `pairing.py:741-752`; `test_sync_events_closed_early_position_produces_no_settlement` proves the gate actually withholds settlement on an already-closed position, paired with a positive control so the fix can't degenerate into "never settle anything." |
| `api/routes_identity.py` `/positions`, `/positions/{id}` | `ledger/positions.py::read_position_state` | D7-04 route repair | WIRED | Confirmed — both routes call `read_position_state` and return `state.opened_at`, not a dropped column. |
| Migration 0014 `campaign_chain` VIEW | `ledger/events.py` (via `rolled_from_position_id`) | Recursive CTE over `events` | WIRED, DATA FLOWS | Confirmed live: view exists, `security_invoker=true`, row-for-row recompute proof passes. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LEDGER-05 | 07-02 | Closed state derived from net quantity per leg, never a stored status column | ✓ SATISFIED | Truth 1 above; live DB confirms no status/timestamp column. |
| LEDGER-06 | 07-03 | SETTLEMENT event generated from a leg's expiry, no fill required | ✓ SATISFIED | Truth 2 above; production path confirmed reachable (CR-01 fixed). |
| LEDGER-07 | 07-03 | Settlement style per leg, PM SPXW front + AM SPX back coexist | ✓ SATISFIED | Truth 3 above. |
| LEDGER-10 | 07-04, 07-05 | Campaign is a read model computed from events, not a separately maintained table | ✓ SATISFIED | Truth 4 above; positive ROLL derivation (07-05) reuses oracle-proven money functions unmodified. |

No orphaned requirements found for this phase in `.planning/REQUIREMENTS.md`'s Phase 7 mapping.

### Anti-Patterns Found

None. Scanned every `src/morai/ledger/*.py` file touched this phase plus `schwab_sync.py`, `routes_identity.py`, `db/models.py`, and migration 0014 for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero matches.

WR-02 (a single-order roll of both calendar legs is undetectable, per `NN-11`'s "leave unformed rather than guess" discipline) is a **documented limitation**, not a gap — confirmed present in both `pairing.py:236-255` (near `_roll_pairs`) and `pairing.py:855+` (near `detect_roll`), per the review's own fix instruction. Not counted against this phase per the task's own explicit instruction.

### Behavioral Spot-Checks / Full Suite

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full local suite | `uv run pytest -q` (env vars from `CLAUDE.md`) | 459 passed | ✓ PASS |
| Full gate (ruff, ruff format, basedpyright, mypy, pytest) | `bash tools/gate.sh` | "All checks passed!" — 459 passed, 0 type errors | ✓ PASS |
| Targeted phase 7 suite | `uv run pytest -q tests/ledger/test_oracle_gate.py tests/ledger/test_settlements.py tests/ledger/test_campaigns.py tests/ledger/test_closed_state.py tests/gate/test_ledger_write_boundary.py tests/ledger/test_roll_derivation.py tests/ingest/test_sync_tracer.py` | 81 passed | ✓ PASS |
| Live DB: `positions` schema | `psql \d positions` | No `opened_at`/`closed_at` | ✓ PASS |
| Live DB: `campaign_chain` view kind + reloptions | `SELECT relkind, reloptions FROM pg_class WHERE relname='campaign_chain'` | `v`, `{security_invoker=true}` | ✓ PASS |
| Live DB: migration head | `SELECT version_num FROM alembic_version` | `0014` | ✓ PASS |

### Code Review Findings (07-REVIEW.md) — Fix Confirmation

| Finding | Fix Commit | Verified In Code | Status |
|---------|-----------|-------------------|--------|
| CR-01 (SETTLEMENT dead code — `sync_user` never passed `as_of`) | `5659d56` | `schwab_sync.py:461` | ✓ FIXED, exercised by real `sync_user` job path test |
| CR-02 (SETTLEMENT minted for already-closed positions) | `4101640` | `settlements.py::derive_settlements`'s `closed_positions` gate; `pairing.py:741-752` computes it | ✓ FIXED, positive + negative control tests both green |
| WR-01 (`opened_at` ignores ROLL events) | `a45b1af` | `positions.py`: `open_times` includes `"OPEN"` and `"ROLL"` | ✓ FIXED, tested |
| WR-02 (undetectable single-order both-legs roll) | `4b0963f` | Documented at `pairing.py:236-255` and near `detect_roll` | ✓ DOCUMENTED per review's own instruction (not required to be fixed) |

### Human Verification Required

### 1. `tzdata`/`ZoneInfo` behaviour on the real Railway container

**Test:** After deploying this phase, run (or trigger) a settlement-generating `sync_user` pass on Railway for a user whose legs are past expiry.
**Expected:** `ZoneInfo("America/New_York")` constructs without error and SETTLEMENT events land, matching local behaviour.
**Why human:** macOS ships system tz data by default, so every local and CI Postgres/pytest run proves nothing about the deployed container's tz database. `07-VALIDATION.md` itself lists this as the phase's one Manual-Only verification. `tzdata==2026.3` is now pinned as an explicit dependency (verified live against the PyPI JSON API per the SUMMARY, `pyproject.toml`/`uv.lock` both confirm the pin), which is the documented fix — but its effect on the actual Railway image has not been exercised, and no deploy/log evidence for this specific check was available during this verification session.

### Gaps Summary

No gaps. All four ROADMAP success criteria are verified against the live database, the real production call path (not merely unit tests of the pure functions), and a green 459-test gate. Both Critical findings and both Warnings from `07-REVIEW.md` have confirmed fix commits, verified directly in the current source — CR-01 and CR-02 particularly, since they were the findings that would have made this phase's headline feature (SETTLEMENT generation) either unreachable in production or silently corrupting `closed_at` on already-closed positions. WR-02 is an intentional, documented limitation under `NN-11`, not a defect.

The only reason this report is not `passed` is the one item this phase's own validation plan already named as Manual-Only: confirming `ZoneInfo` construction on the actual Railway container post-deploy. That is a real gap in verification coverage, not a defect in the code — flagging it honestly rather than inferring a pass, per this project's own verification discipline (`.claude/rules/workflow.md`).

---

_Verified: 2026-09-01_
_Verifier: Claude (gsd-verifier)_
