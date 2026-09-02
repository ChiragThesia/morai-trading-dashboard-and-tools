---
gsd_state_version: 1.0
current_phase: 09
current_phase_name: Reconciliation Invariant and Status Endpoint
status: executing
stopped_at: Phase 05 complete, ready to plan Phase 1
last_updated: "2026-09-02T04:00:27.876Z"
last_activity: 2026-09-01
last_activity_desc: Phase 09 execution started
state_head: c8c851d9bd0d015a048d112ee02f0087cee18831
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 45
  completed_plans: 39
  percent: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-29)

**Core value:** The ledger is correct across rolls and settlements — the sum of realised P&L over any
window equals the broker's cash delta over that window, checked every ingest cycle.
**Current focus:** Phase 09 — Reconciliation Invariant and Status Endpoint

## Current Position

Phase: 09 (Reconciliation Invariant and Status Endpoint) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 09
Last activity: 2026-09-01 — Phase 09 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 05 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P02 | 25min | 2 tasks | 2 files |
| Phase 01 P03 | 9min | 2 tasks | 13 files |
| Phase 01 P05 | 8min | 3 tasks | 8 files |
| Phase 01-walking-skeleton P06 | 25min | 2 tasks | 4 files |
| Phase 01 P07 | 20min | 2 tasks | 4 files |
| Phase 02 P01 | 40min | 3 tasks | 17 files |
| Phase 02 P04 | 22min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Derivation (Phase 5) runs parallel to the Schwab connection (Phase 4). The oracle is
  fixture data, so the riskiest correctness work is not blocked on the flakiest vendor integration.

- [Roadmap]: Encryption and the trade-data schema are one phase (Phase 3). The plaintext column set
  is a schema decision, and it is settled before any trade row is written.

- [Roadmap]: Snapshot capture is Phase 8, immediately after its dependencies (positions plus a
  market read). It cannot be backfilled, so it does not sort to the end.

- [Roadmap]: No separate tooling phase. OPS-01 and OPS-02 are established in Phase 1 and every later
  phase is held to them.

- [Phase 1]: CI push trigger unfiltered by branch, since Task 2 needs a red run observed on a throwaway branch pushed directly
- [Phase 1]: test-pytest Postgres pinned to major 18 (postgres:18-alpine), matching the live Railway Postgres image, superseding 01-RESEARCH.md's illustrative postgres:17 example
- [Phase 1, 01-03]: Float canary asserts bit-inexactness (`Decimal(float(x)) != x`), not a visible digit flip -- NUMERIC(14,4)'s 14-sig-fig ceiling is narrower than a double's ~15.95, so no value both fits the column and visibly loses a digit
- [Phase 1, 01-03]: `StrictDecimalField` (`BeforeValidator`) fixes the R-02 gap between D-03's Decimal-as-JSON-string wire format and D-12's strict request models
- [Phase 1, 01-03]: pytest session shares one asyncio event loop (`asyncio_default_fixture_loop_scope`/`asyncio_default_test_loop_scope = "session"`) so the app's `lru_cache`d `AsyncEngine` isn't handed to a second loop mid-suite
- [Phase 1]: 01-05: tests/gate/fixtures exclusion applies to explicit checker paths too, not only glob discovery -- meta-test copies fixtures to tmp_path before invoking each checker
- [Phase 1]: 01-05: dropped the false mypy-vs-explicit-Any assertion (disallow_any_explicit deliberately off); substituted basedpyright's reportIgnoreCommentWithoutRule on the bare-ignore fixture
- [Phase 1]: 01-05: committed-secret guard uses a shape heuristic (16+ chars, letters and digits) instead of a file exclusion list, so existing test fixtures with fake passwords never trip it
- [Phase 1]: Request-id propagation uses contextvars.ContextVar[str], not request.state (State.__getattr__ returns Any, which reportAny flags)
- [Phase 1]: Negative-control response models locally set revalidate_instances='always' so model_construct() actually re-validates -- otherwise FastAPI returns a silent 200 for a broken response
- [Phase 1]: PsycopgConnector (psycopg v3) is the worker's connector -- Procrastinate ships no asyncpg connector; pool capped explicitly (min_size=1, max_size=2) as its own NN-28 budget line
- [Phase 1]: Procrastinate's schema.sql wrapped verbatim into Alembic revision 0002, split into per-statement op.execute() calls -- asyncpg's protocol rejects multi-statement strings
- [Phase 2]: [Phase 2, 02-01]: SET LOCAL cannot bind a query parameter -- use set_config(name, value, true) for RLS context, measured against real Postgres/asyncpg
- [Phase 2]: [Phase 2, 02-01]: morai_app (NOSUPERUSER NOBYPASSRLS) is a required deliverable; get_db_session runs every route through it, get_engine() stays the DDL/superuser-only engine
- [Phase 2]: 02-04: audit.py's own module docstring carries the three-paragraph honest ceiling (what type-checks, what falls back to a runtime guard, what neither covers) so a later reader of the code, not just the plan, finds the caveat
- [Phase 2]: 02-04: open_audited_read() writes via raw text() SQL, not insert(AuditLog).values(...) -- the ORM construct silently appends an implicit RETURNING for the server-generated id, and audit_log's INSERT-only RLS policy has no SELECT policy to permit that read back (found in CI, no reachable local database)

### Pending Todos

None yet.

### Blockers/Concerns

Five open decisions are assigned to owning phases rather than left floating — see ROADMAP.md
"Open Decisions and Their Owners":

- Phase 1: Hypercorn vs uvicorn dual-stack binding on real Railway hardware (`V039`, partially stale)
- Phase 2: Railway pooling topology is SETTLED — `02-RESEARCH.md` confirmed against live
  Railway docs and `railway variables` that no pooler sits in front of this Postgres, so the
  `set_config(..., true)` RLS context and its query share a transaction. What remains open is
  narrower: the isolation suite has never run against the live deployment, because none of
  `docs/operations/phase-2-operator-steps.md`'s four steps have been performed —
  `MORAI_APP_DB_PASSWORD` is not yet set on Railway, so the deployed services cannot connect
  as `morai_app` at all. Tracked as human verification in `02-VERIFICATION.md`.

- Phase 4: `schwab-py` `py.typed` coverage — **SETTLED 2026-08-31, measured not recalled.**
  The published 1.5.1 wheel was downloaded and listed: no `py.typed` marker. Neither
  `types-schwab-py` nor `schwab-py-stubs` exists on PyPI (both HTTP 404). Under PEP 561 the
  package is untyped to mypy and basedpyright, so every symbol from it is `Any` and
  `reportAny` flags every call. The project therefore owns a `Protocol` over exactly the
  four methods it uses, with one adapter module as the sole importer of `schwab` and
  `model_validate()` at every call site. Recorded as `D4-01`..`D4-05` in `04-CONTEXT.md`.

- Phase 6: Railway execution model, cron container vs long-running worker — Phase 8 inherits it
- Phase 9: Reconciliation window boundary — **SETTLED 2026-09-01 in `09-CONTEXT.md` (`D9-01`..`D9-04`).**
  A window is a **settlement-date trading day in ET**, because cash moves on the broker's settlement
  calendar; a rolling 24-hour window would split a single trading day and manufacture a false
  mismatch every day, and calendar days do the same across every weekend. A window closes when a
  later trading day's broker transaction lands — the broker's own later activity is the evidence it
  considers the prior day final, where a clock timeout would close a window the vendor may still be
  writing into. Late data reopens a closed window and the reopening is itself recorded as a finding,
  never silently absorbed. RECON-01 is now testable.

REQUIREMENTS.md recorded 62 v1 requirements; the actual count is 68. Corrected in that file.

## Deferred Verification

### Parallel re-verification sweep — 2026-09-02

All seven deferred phases (2, 3, 4, 6, 7, 8, 9) were re-verified in parallel against current HEAD,
each in its own worktree and its own database. **Every phase's original verdict still holds. Six of
the seven carried a defect that had accumulated since, and every one was silent** — nothing failing,
nothing red, all seven marked "code complete."

| Phase | Re-verified | Defect found | PR |
|-------|-------------|--------------|-----|
| 2 | 4/5 (3b still blocked) | Isolation guards' table lists were hardcoded; by Phase 9 six user-scoped tables were unwatched (`broker_transactions`, `schwab_connections`, `snapshot_marks`, `snapshot_observations`, `snapshot_runs`, `sync_runs`). Had not leaked — all six carry ENABLE+FORCE and a `user_isolation` policy — but nothing was watching. Now derived from `pg_attribute` with a `>= 12` vacuity guard. | #34 |
| 3 | 6/6 after fix | **`DELETE /me` was broken.** `delete_account()` deleted eleven tables; migrations 0015/0016 added four more with uncascaded `user_id` FKs (two also uncascaded `leg_id`). Any user who had ever had a snapshot captured got a `ForeignKeyViolationError`, the transaction rolled back, and the crypto-shred never committed either. None of the seventeen FKs on user-scoped tables has `ON DELETE CASCADE`. | #37 |
| 4 | 5/5 (criterion 5 upgraded from PARTIAL — Phase 6 supplied `last_synced_at`) | `.railway/railway.ts`'s worker block still carried only `DATABASE_URL` under a stale comment deferring the secrets to "when Phase 6's ingest starts writing". `railway config apply` strips unnamed variables, so the deployed worker would have lost all five it now needs. Silent: every scheduled sync fails forever, no token refreshes, every connection dies at 7 days, with Phase 4's code perfectly correct. | #33 |
| 6 | 5/5 | The RLS bypass guard this phase exists to enforce **had no test** — deleting `assert_connection_cannot_bypass_rls` from `sync_user_task` changed no observable behaviour, because every test already runs on a `morai_app` session. Phase 8 had written exactly this test for its own task, citing "Phase 6's own finding". | #35 |
| 7 | 4/4 | None. No second writer crept in across Phases 8/9. | — |
| 8 | 5/5 | The known flake, root-caused and fixed (see above). | #36 |
| 9 | 4/4 | `closed_trading_days`' docstring still claimed the pre-CR-01 rule ("empty when broker_cash has zero or one day"), contradicting a test shipped in the same commit. Prose only — but it points the next reader at the rule whose removal is the road back to the silently-skipped event-only day. | #38 |

**No phase's `status: human_needed` was rewritten.** Every live-infrastructure item below remains
open; a local pass proves nothing about a deployed container.

### RESOLVED 2026-09-02 — Phase 3 criterion 1 vs. Phase 9 `D9-13`/`D9-15`

**The owner ruled: narrow criterion 1, and enforce the new line mechanically.** The four columns
stay plaintext. `/reconciliation/status` is untouched. `D9-13`/`D9-15` stand.

Restated in `ROADMAP.md` (criterion 1), `REQUIREMENTS.md` (`CRYPT-02`, `CRYPT-05`), `PROJECT.md`
(the encryption success criterion) and `03-VERIFICATION.md` (criterion 1 row, `CRYPT-02`/`CRYPT-05`
rows, and a dated section). Each says the same true thing: per-user trade detail is unreadable
without the master key; the four `reconciliation_runs` aggregates are the named plaintext
exception.

The line is executable, not just written.
`tests/test_pg_dump_confidentiality.py::test_only_the_reconciliation_aggregates_store_plaintext_money`
derives every plaintext money column from `pg_attribute` and compares it to a four-entry
allow-list. A fifth fails on the migration that adds it. The same file's dump widened from five
named tables to the whole database, and its read-back from four named ciphertext columns to every
one the catalog reports. `test_key_rotation.py`'s byte-identical capture widened the same way,
from `fills`/`events` to all six ciphertext-bearing tables. All three carry a vacuity guard, the
shape PR #34 established.

`03-VERIFICATION.md` keeps `status: human_needed`. Both live-infrastructure items stay open.

The original entry, for the record:

### OPEN DECISION — Phase 3 criterion 1 vs. Phase 9 `D9-13`/`D9-15`

Measured, not inferred, during the sweep. Migration 0016 stores `realised_pnl_usd`,
`commissions_usd`, `cash_delta_usd` and `signed_difference_usd` as **plaintext** `NUMERIC(14,4)`.
A real `pg_dump` of a seeded row, no master key involved, yields readable P&L.

Phase 3 criterion 1 says a stolen dump "yields no readable ... P&L". Phase 9's `D9-13`/`D9-15` say
the status endpoint must answer "how far off, in which direction" without unwrapping a key. Both are
deliberate. Both cannot stand as written. **This needs an owner ruling** — it was not resolved by
the verifying agent, which correctly declined to re-litigate another phase's decision.

Related coverage gap, not a live defect: `test_pg_dump_confidentiality.py` still dumps only
`users`/`positions`/`fills`/`events`/`user_data_keys`, and `test_key_rotation.py`'s byte-identical
capture still covers only `fills`/`events`. Both are narrower than the schema they now describe.

Both gaps closed by the ruling above.

### UNOWNED WORK — surfaced by the sweep, assigned to no phase

1. **Re-auth notification delivery.** `reauth_notified_at` has no writer anywhere in `src/`, and no
   ROADMAP phase claims it. `D4-13` deferred delivery to "a later phase"; six phases later nobody
   picked it up. The project constraint requires re-auth be self-service **with a notification** —
   the self-service half works, the notification half is unowned.
2. **Settlement never closes a position.** `is_closed` reads only `FillRecord`s; a SETTLEMENT is an
   `Event`, never a `Fill`, so a position whose legs expire stays net-nonzero forever. Reproduced:
   after both legs settled, `is_closed=False`, `closed_at=None`. Consequences live now —
   `snapshots.read_open_legs` returns expired legs forever, and `snapshot_repair` keeps back-filling
   slots for them. Phase-sized: `DerivedSettlement` carries no leg id, so the fix must re-derive from
   expiry, giving `derive_position_state` an `as_of` clock input and breaking the purity contract
   `test_pairing_pure.py` gates, rippling to four call sites and Phase 8's open-leg set. Recorded as
   `D10-16`; Phase 10 ships without it by explicit user decision.

---

Phase 2's code is complete and its other four success criteria are verified. Criterion 3b —
"the isolation suite passes against the real Railway pooling configuration" — cannot be closed
from a development machine and is deferred by explicit user decision (2026-08-31), not skipped.
`02-VERIFICATION.md` keeps `status: human_needed`; it was NOT rewritten to `passed`.

| Phase | State | Resume |
|-------|-------|--------|
| 2 | verification_deferred_human | /gsd-verify-work 2 |
| 3 | verification_deferred_human | /gsd-verify-work 3 |
| 4 | verification_deferred_human | /gsd-verify-work 4 |
| 6 | verification_deferred_human | /gsd-verify-work 6 |
| 7 | verification_deferred_human | /gsd-verify-work 7 |
| 8 | verification_deferred_human | /gsd-verify-work 8 |
| 9 | verification_deferred_human | /gsd-verify-work 9 |

Phase 9's code is complete and all four of its success criteria are verified against live code and a
live database (659 passed, gate exit 0). Deferred by explicit user decision (2026-09-02) to keep the
autonomous run moving; `09-VERIFICATION.md` keeps `status: human_needed` and was NOT rewritten to
`passed`.

**Phase 9 enforces the project's core value**, and `D5-04`'s deferred contradiction is resolved. Phase
5 recorded that the oracle's fee-free convention (`avgPrice × qty`) and the fee-inclusive cash delta
could not both be true of the same field, set `commission_usd = None`, and wrote that it did so "so
Phase 9 does not have to rediscover it." The resolution fills that `None` from the broker's own
transaction data at reconciliation read-time and leaves every fee-free field on `events` untouched —
`src/morai/ledger/pairing.py` and `tests/ledger/test_oracle_gate.py` are byte-identical across the
whole phase, confirmed by `git diff --exit-code`.

Phase 9's two open items both need live Schwab data and are pre-declared Manual-Only in
`09-VALIDATION.md`:

1. **The real `netAmount` / commission field names.** `schwab-py` 1.5.1's installed source contains
   zero references to `netAmount`, `fees` or `commission`, and this project's fixtures never populate
   them. The names live in injectable settings (`schwab_tx_net_amount_field`,
   `schwab_tx_commission_field`), not inlined literals, so the first live payload corrects them in
   one place.
2. **Whether an OTM SETTLEMENT posts its own broker-cash row.** Unknown without live data.

Both degrade to `indeterminate`, never a false `passed` (`D9-08`, `D9-11`) — a wrong guess cannot
produce a wrong number, only an unanswerable window.

**A blocker found and fixed during review, worth remembering:** `closed_trading_days` originally
derived candidate windows from broker-cash days alone, so a trading day whose only activity was a
ledger event — an OTM expiration's SETTLEMENT with no same-day broker transaction — was never
reconciled at all. Not failed, not indeterminate: silently skipped, against a phase goal of "checked
every ingest cycle." Candidate days are now the union of event days and broker-cash days, while
closure stays broker-driven per `D9-02`.

Phase 8's code is complete and all five of its success criteria are verified against live code and
a live database (587 passed, gate exit 0). Deferred by explicit user decision (2026-09-01) to keep
the autonomous run moving; `08-VERIFICATION.md` keeps `status: human_needed` and was NOT rewritten
to `passed`.

Phase 8 carries TWO open items, both pre-declared Manual-Only in `08-VALIDATION.md` before
execution — neither is a surprise finding:

1. **The live Schwab `get_quotes` OPTION response schema.** This project has never called
   `get_quotes` live, and `08-RESEARCH.md` rates the exact response shape LOW confidence. The design
   absorbs the risk rather than assuming it away: raw payloads are stored independently (`D8-01`,
   `D8-04`) and `parse_quote_payload` never raises — so a wrong field path yields honest gaps, never
   a wrong number. Closing it needs one real capture slot against a live connection, comparing the
   stored `snapshot_observations` payload against the parser's output.

2. **Procrastinate's `MAX_DELAY` on a real worker outage.** `PeriodicDeferrer.MAX_DELAY = 600` (read
   from the installed 3.9.0 source): a worker down more than ten minutes across a slot boundary
   produces no job at all for that slot — not even a failed one. The *mechanism* is proven locally
   (`missing_capture_slots` surfaces the hole and `backfill_uncaptured_slot_gaps` writes an honest
   `slot_not_captured` gap), but the real trigger needs a deployed worker actually stopped.

Both close with the same Railway deploy items 1-4 below.

**Known test-infrastructure flake — FIXED 2026-09-02 (PR #36).**
`test_expired_connection_writes_gap` failed intermittently when run as a narrow subset. The
original diagnosis named the right mechanism (Phase 1's heartbeat periodic task sharing the
Procrastinate `app`) but the wrong trigger: it does not need a wall-clock minute boundary.
`PeriodicDeferrer.get_timestamps`, given no prior defer, yields the *previous* cron tick whenever
that is inside `MAX_DELAY` (600s) — which for a `* * * * *` cron is always. It therefore fires on
its **first pass**, and only `procrastinate_periodic_defers`' unique constraint suppresses the
repeat, so the first worker-driving test each wall-clock minute fired the fan-out.

Reproduced at 2 failures / 21 runs, fixed with one autouse fixture in `tests/conftest.py` patching
`PeriodicDeferrer.worker` to return immediately, then proved at 0 failures / 40 runs. **No
production code changed.** Fixed at the deferrer rather than per-test because eight test files
drive a real worker and all were exposed; the deferrer's *loop* is disabled rather than
`app.periodic_registry` emptied, because two tests assert on those registrations and emptying it
would demote a real production assertion to reading a snapshot.

Phase 7's code is complete and all four of its success criteria are verified against live code
and a live database (459 passed, gate exit 0). Deferred by explicit user decision (2026-09-01)
to keep the autonomous run moving; `07-VERIFICATION.md` keeps `status: human_needed` and was NOT
rewritten to `passed`.

Its one open item is narrower than the other four and is new in kind: `ZoneInfo("America/New_York")`
must be confirmed to construct on the real Railway container. macOS always ships system tz data, so
a local pass proves nothing about the deployed image — the failure, if it exists, is production-only.
`tzdata==2026.3` is now pinned explicitly in `pyproject.toml`/`uv.lock` as the fix. `07-VALIDATION.md`
lists this as Manual-Only. It closes with the same deploy as items 1-4 below: deploy this phase, run
`sync_user` for a user whose legs are past expiry, confirm no `ZoneInfoNotFoundError` and that
SETTLEMENT rows are written.

Phase 6's code is complete and all five of its success criteria are verified against live
code and a live database (383 passed, gate exit 0, clean on 114 files). Its one open item is
the same Railway blocker Phases 2, 3 and 4 carry, and it unblocks from the same action.

Phase 6 adds one NEW prerequisite to that action, and it is a security fix rather than a
convenience: `MORAI_APP_DB_PASSWORD` is now required on the Railway **worker** service, which
never needed it before. `worker/app.py` previously held only a Procrastinate pool on the
superuser DSN; an ingest job writing user-scoped rows over that role would have made every RLS
policy inert for exactly the rows this phase adds -- silently, with the whole suite green. The
`sync_user` job now opens its session as `morai_app` and calls
`assert_connection_cannot_bypass_rls` before touching a protected table, so the worker cannot
start without that password. See `06-USER-SETUP.md`.

`06-VERIFICATION.md` keeps `status: human_needed`; it was NOT rewritten to `passed`.

Phase 4's code is complete and all five of its success criteria are verified against live
code, a live database, and live test runs (283 passed, gate exit 0). The one open item is
the same Railway blocker Phases 2 and 3 carry, and it unblocks from the same action: set
the secrets on the `web` service, then `railway config apply`. Phase 4 adds three to the
list — `SCHWAB_API_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_CALLBACK_URL` — now declared with
`preserve()` in `.railway/railway.ts`, which keeps a value that is already set but cannot
create one. Deferred by explicit user decision (2026-08-31). `04-VERIFICATION.md` keeps
`status: human_needed`; it was NOT rewritten to `passed`. Items in `04-UAT.md`.

Phase 5 does not depend on any of this — the ROADMAP marks it "Parallel with Phase 4"
because fill pairing is derivation logic that needs no broker connection.

Owed on live Railway:

1. `docs/operations/phase-2-operator-steps.md` steps 1-4 (set `MORAI_APP_DB_PASSWORD`, deploy,
   bootstrap the admin), then `tools/isolation_smoke.py` against the live deployment. Until
   step 1 runs, the deployed services cannot connect as `morai_app` at all.

2. `tools/measure_argon2.py` on the real Railway container — `D2-03`'s owed measurement. The
   Argon2id band must be tuned on production hardware, not copied from a laptop.

Neither blocks Phase 3, which is local schema and encryption work with no deployment dependency.

Phase 3 verified 6/6 success criteria against live code and a live database, and carries two
NEW infrastructure-only items, deferred on the same basis as Phase 2's (user decision
2026-08-31). `03-VERIFICATION.md` keeps `status: human_needed`; it was NOT rewritten to
`passed`.

3. Confirm `MORAI_MASTER_KEY` is set on Railway's `web` and `worker` services. This is
   `CRYPT-01`'s own Manual-Only Verification in `03-VALIDATION.md`: a local test can prove the
   app reads the KEK from its environment, never that production has one configured. Without
   it the deployed services cannot unwrap any user's data key.

4. `tools/rotate_kek.py` has never been run against a real deployment (stated plainly in
   `03-04-SUMMARY.md`). Rotation is verified locally as all-or-nothing with byte-identical
   trade ciphertext, but an operator decision is owed on whether shipping an unexercised
   rotation path is acceptable.

Neither blocks Phase 4 (Schwab connection) or Phase 5 (fill pairing against the oracle), both
of which are local work. Item 3 belongs with Phase 2's item 1 — the same Railway deploy that
sets `MORAI_APP_DB_PASSWORD` should set `MORAI_MASTER_KEY`.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-08-31T05:25:23.839Z
Stopped at: Phase 05 complete, ready to plan Phase 1
Resume file: None
