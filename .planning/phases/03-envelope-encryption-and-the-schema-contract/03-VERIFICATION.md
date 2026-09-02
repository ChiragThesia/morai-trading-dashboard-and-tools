---
phase: 03-envelope-encryption-and-the-schema-contract
verified: 2026-08-31T17:35:06Z
status: human_needed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Confirm MORAI_MASTER_KEY is set on the Railway `web` and `worker` services (32 raw bytes, base64-encoded), and that it is not the local dev value (`bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ=`)."
    expected: "The env var exists on both Railway services, with a production-only value that never appears in any repo file, commit, or log."
    why_human: "The KEK lives outside the database by design (D3-06) — a local test can only prove the app reads it from the environment, not that the production environment is actually configured with a real, secret value. This is 03-VALIDATION.md's own Manual-Only Verification for CRYPT-01, newly introduced by this phase (not a Phase 2 carryover)."
  - test: "Run `tools/rotate_kek.py` once against the real Railway/production database as a dry run (or at least confirm the runbook for doing so exists and an operator knows to use it)."
    expected: "The script runs cleanly against a real deployed Postgres, re-wrapping every live user's data key, with the old and new KEK values never appearing in a log line."
    why_human: "03-04's SUMMARY states plainly that `tools/rotate_kek.py` 'has not been run against a deployment' — it is committed and tested locally (`tests/test_key_rotation.py`) but the operator procedure against production is unexercised. Confirming the local unit is proven and the operational path is real is a live-infrastructure check, not a code check."
---

# Phase 3: Envelope Encryption and the Schema Contract Verification Report

**Phase Goal:** The tables the ledger writes exist, trading data in them is unreadable without
the master key, the columns that must stay readable are decided and written down, and the
database makes a netted ROLL impossible to store.

**Verified:** 2026-08-31T17:35:06Z
**Status:** human_needed
**Re-verification:** No — initial verification

**A process note on this report's own scope.** `ROADMAP.md` marks this phase `Mode: mvp`, but
its goal text is not in `As a <role>, I want <capability>, so that <outcome>.` form —
confirmed programmatically (`gsd-tools query user-story.validate` on the phase goal returns
`valid: false`). MVP-mode verification (a User Flow Coverage table against the story's
`[outcome]` clause) does not apply to a goal in this shape. This report instead runs the
standard goal-backward methodology against the roadmap's six numbered success criteria, which
is what the goal text and the verification brief both actually call for. Flagging this as an
info note, not a gap: the roadmap's `mode: mvp` field on this phase looks like a labeling
artifact worth fixing, not a defect in the phase's own work.

## Method

Every claim below was checked against the codebase and a live Postgres 18 instance, not
against SUMMARY.md prose:

- Read all 7 PLAN/SUMMARY pairs, `03-CONTEXT.md`, `03-VALIDATION.md`, `03-REVIEW.md`.
- Ran the full local suite myself: `uv run pytest -q` → **245 passed, 0 failed, exit 0**.
- Ran the full gate myself: `bash tools/gate.sh` → **ruff, ruff format, basedpyright (0 errors,
  73 files), mypy (0 issues, 73 files), pytest 245 passed** — exit 0.
- Queried the live database directly (`psql`) for RLS flags, the `CHECK` constraint text, the
  table list, and `alembic current` (head: `0009`) — not the migration files' stated intent.
- Read the actual encryption, rotation, account-deletion, and gate-test source files, not their
  SUMMARYs' descriptions of them.
- Cross-checked the two `03-REVIEW.md` findings this task flagged (WR-01: `wrap_nonce` excluded
  from every nonce check) against the current state of `tests/crypto/test_nonce_uniqueness.py`.

## Goal Achievement

### Observable Truths (the six roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Real `pg_dump` restored w/o master key yields no readable per-user trade detail — price/qty/per-trade P&L/free-text — with the four `reconciliation_runs` aggregates the named plaintext exception; no two ciphertext rows share `(key, nonce)` | ✓ VERIFIED (criterion narrowed 2026-09-02 — see below) | `tests/test_pg_dump_confidentiality.py` restores a real dump into a scratch DB, reads `bytea` back as real Python `bytes` through a real `AsyncEngine` with `MORAI_MASTER_KEY` unset, asserts no plaintext (incl. a free-text marker) is a substring of any ciphertext, and independently asserts no plaintext's **hex encoding** appears in the dump text — the correct test shape per 03-VALIDATION.md's own trap. A named negative control (`test_naive_literal_grep_passes_but_hex_grep_catches_unencrypted_marker`) demonstrates the naive literal-grep false pass live. Nonce uniqueness: `tests/crypto/test_nonce_uniqueness.py` now runs **two** queries — a per-user `(user_id, key_version, nonce)` UNION over `fills`/`events`, and a separate `GROUP BY wrap_nonce` over `user_data_keys` for the KEK domain — each with its own planted-collision positive control, and the schema-drift guard's expected-column set now includes `user_data_keys.wrap_nonce`. This is the WR-01 review fix, applied: the module's own docstring narrates "an earlier version of this module drew the wrong conclusion... Found in Phase 3's code review as WR-01," and the fixed code matches. All tests pass. |
| 2 | Plaintext-by-design columns documented in the migration with the query each serves; both disambiguation and reconciliation queries run in SQL against it | ✓ VERIFIED | `alembic/versions/0007_data_key_and_fills.py` and `0008_positions_legs_events.py` each carry a `## Plaintext-by-design columns... and the query each serves` docstring section naming every plaintext column and its serving query, confirmed by direct read of the migration files (not a paraphrase). `tests/ledger/test_plaintext_queries.py` runs `_DISAMBIGUATION_QUERY` and `_RECONCILIATION_WINDOW_QUERY` as real SQL against real Postgres, seeded with all 13 oracle calendars' 52 real fills through `insert_fills()` (`tests/ledger/oracle_seed.py`). The disambiguation query resolves both calendars sharing front-leg `SPXW260618P07275000`; an unanchored order resolves to `NULL`, not a guess. The window query selects the correct real June-2026 events by `event_time` alone; the total is summed in Python from decrypted `Decimal`s, never in SQL. `test_neither_query_names_a_ciphertext_or_nonce_column` proves this mechanically against `information_schema.columns`, not by inspection. |
| 3 | KEK rotation re-wraps every DEK without touching trade ciphertext; versioned rows still read under the key they were written with | ✓ VERIFIED | `src/morai/crypto/rotation.py`'s `rotate_kek()` contains no statement naming a trade table — read directly, confirmed. `tests/test_key_rotation.py::test_rotation_touches_no_trade_ciphertext` captures **every** fill/event ciphertext+nonce value into a dict keyed by row identity, before and after rotation, and asserts the **whole dict** is unchanged (`after_ciphertext == before_ciphertext`) — not a sample, closing 03-VALIDATION.md's own named trap ("it still decrypts" would pass even if every row were rewritten). The same test confirms every wrapped DEK changed while its unwrapped bytes did not, and that a `key_version=1` row still decrypts correctly after rotating to a brand-new KEK, through the normal `read_fills`/`read_events` path. `test_rotating_with_the_wrong_old_key_raises_without_writing` confirms a bad old key raises `InvalidTag` before any row is touched — `rotate_kek()`'s single `session.flush()` at the end of the loop (not per-row) makes this structurally all-or-nothing, confirmed by reading the function body. |
| 4 | Netted-only ROLL insert rejected by a database `CHECK`, not application code | ✓ VERIFIED | Live query against Postgres confirms `roll_has_both_legs` exists on `events`: `CHECK (((event_type <> 'ROLL') OR ((open_debit_usd_ciphertext IS NOT NULL) AND (close_credit_usd_ciphertext IS NOT NULL))))`. `tests/ledger/test_roll_check_constraint.py` inserts via raw `sa.text()` on the superuser session — never through the ORM or a write path — and both one-sided-ROLL shapes raise `IntegrityError` naming the constraint; a both-populated ROLL, a one-sided OPEN, and an all-NULL SETTLEMENT all insert cleanly. `insert_events()` separately raises before reaching the DB for a one-sided ROLL, so the CHECK is a backstop, not the only guard. The migration's own docstring states plainly what the CHECK can and cannot catch (presence, never the decrypted value) — no overclaim. |
| 5 | Account deletion destroys the data key; rows then decrypt to nothing | ✓ VERIFIED | `tests/test_crypto_shred.py::test_reads_raise_with_the_key_destroyed_and_rows_still_present` asserts the **middle state directly**: after deleting only `user_data_keys`, the fill/event rows are confirmed still present (`len(fill_rows) == 1`), then `read_fills`/`read_events` are confirmed to raise `DataKeyMissing` — closing 03-VALIDATION.md's named trap (asserting only the end state would pass against a plain row delete with no crypto-shred at all). A second test confirms user B's rows are unaffected by user A's key destruction. `src/morai/identity/account.py::delete_account()` destroys `user_data_keys` first, trade rows second, identity rows third, `users` last — read directly, matches the documented order. `DELETE /me` (routes_identity.py) wraps this in one transaction, commits once; the code review (IN-01) correctly notes the actual crash-safety property is single-transaction atomicity, not statement order alone — a non-actionable observation, not a defect. |
| 6 | Fill/leg/position/event tables exist with the plaintext/ciphertext split; exactly one write path into fills | ✓ VERIFIED | Live `\dt` confirms `fills`, `events`, `positions`, `legs`, `user_data_keys` all exist; live RLS query confirms all five have `relrowsecurity=t, relforcerowsecurity=t`. `insert_fills()`/`read_fills()` (`src/morai/ledger/fills.py`) is the only path into `fills` — `Fill.__init__` requires a `_write_token` keyword with no default (`src/morai/db/models.py:179`), confirmed by direct read. The gate proof (`tests/gate/test_type_gate.py`, `tests/gate/fixtures/violation_second_fill_writer.py`) asserts the **specific** diagnostic marker from a real subprocess checker run — `reportCallIssue` (basedpyright) and `call-arg` (mypy) — not a bare non-zero exit code, matching 03-VALIDATION.md's own trap warning about a bare exit-code check being decoration. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/morai/crypto/envelope.py` | AES-256-GCM primitives | ✓ VERIFIED | Read directly; 5 pure-bytes functions; negative-case suite (`tests/crypto/test_envelope.py`) proves tamper/wrong-key/wrong-nonce/wrong-row-AAD all raise `InvalidTag` |
| `src/morai/crypto/rotation.py` | `rotate_kek()`, no trade-table statement | ✓ VERIFIED | Read directly, confirmed no trade table named |
| `alembic/versions/0007_data_key_and_fills.py` | `user_data_keys`, `fills`, RLS, documented plaintext set | ✓ VERIFIED | Read directly; live DB confirms table/RLS state matches |
| `alembic/versions/0008_positions_legs_events.py` | `positions`, `legs`, `events`, `roll_has_both_legs` CHECK | ✓ VERIFIED | Read directly; live DB confirms CHECK constraint text matches exactly |
| `alembic/versions/0009_drop_gate_probe_tables.py` | Drops both probe tables, reversibly | ✓ VERIFIED | Live `\dt` confirms both tables are gone; `alembic current` reports `0009 (head)` |
| `src/morai/ledger/fills.py` | `insert_fills`/`read_fills`, the one write path | ✓ VERIFIED | Read directly; encryption happens inside the write path |
| `src/morai/ledger/events.py` | `insert_events`/`read_events`, ROLL's two amounts split | ✓ VERIFIED | Read directly |
| `src/morai/identity/account.py` | `delete_account()`, crypto-shred ordering | ✓ VERIFIED | Read directly; `GateUserScopedProbe` cleanup step correctly removed by 03-07 with the reasoning documented, not silently deleted |
| `tools/rotate_kek.py` | Operator entry point | ✓ VERIFIED (exists, tested locally) | Not yet exercised against Railway — see Human Verification |
| `src/morai/db/models.py` | `GateMoneyProbe`/`GateUserScopedProbe` removed | ✓ VERIFIED | `grep` across `src/tests/tools` confirms zero executable references remain — only docstring prose and migration files 0001/0003/0009 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `Settings.master_key_bytes` | `wrap_dek`/`unwrap_dek` | KEK never reaches Postgres | ✓ WIRED | `master_key_bytes` raises before decoding on unset/wrong-length, never renders the value (confirmed in `settings.py` and `tests/test_settings.py`) |
| `insert_fills()` | `encrypt_field()` | encryption inside the write path | ✓ WIRED | Confirmed by reading `fills.py` |
| `fills.key_version` | `user_data_keys(user_id, key_version)` | versioned reads | ✓ WIRED | Confirmed by `read_fills()`'s per-row key_version lookup and by the rotation test reading a `key_version=1` row correctly post-rotation |
| `events.roll_has_both_legs CHECK` | the netted-ROLL class | unstorable at the data layer | ✓ WIRED | Live DB query confirms constraint text |
| `GET /gate/positions` | `positions` table's own RLS policy | deployed isolation surface | ✓ WIRED | `tests/identity/test_tracer_scoped_read.py` — 401/404/byte-identical-body/scoping tests all pass |
| `DELETE /me` | `delete_account()` → crypto-shred order | ✓ WIRED | `tests/identity/test_account_deletion.py` full suite passes |

### Behavioral Spot-Checks (self-run, not from SUMMARY)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite green | `uv run pytest -q` (env: `DATABASE_URL`, `MORAI_APP_DB_PASSWORD`, `MORAI_MASTER_KEY` set) | 245 passed, exit 0 | ✓ PASS |
| Full gate green | `bash tools/gate.sh` | ruff/ruff format/basedpyright/mypy clean across 73 files; 245 passed | ✓ PASS |
| Probe tables actually gone | `psql \dt` | `gate_money_probe`, `gate_user_scoped_probe` absent from table list | ✓ PASS |
| RLS actually enabled+forced on all 5 new tables | `psql` query on `pg_class` | all 5 report `t, t` | ✓ PASS |
| `roll_has_both_legs` CHECK actually exists | `psql` query on `pg_constraint` | text matches migration exactly | ✓ PASS |
| Migration chain at head | `alembic current` | `0009 (head)` | ✓ PASS |
| No executable reference to either probe model/table remains | `grep -rn` across `src tests tools` | only docstrings/comments and migrations 0001/0003/0009 | ✓ PASS |
| `test_app_role.py` runs clean in isolation (sanity check after an unrelated multi-file selection produced spurious fixture-not-found errors) | `pytest tests/identity/test_app_role.py -v` | 15 passed | ✓ PASS |

*Note on the spurious fixture errors:* running an ad hoc subset of test files together (a custom
list I picked for spot-checking, not this project's own invocation) produced 15
`fixture 'app_db_session' not found` errors in `test_app_role.py` — a pytest module-resolution
artifact of that particular file combination, not a real defect. Confirmed by (a) the full-suite
run passing 245/245 including this exact file, and (b) `test_app_role.py` run alone passing
15/15. Recorded here for transparency since it appeared during this verification session, not
because it reflects on the phase's own work.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CRYPT-01 | Per-user data key at account creation, wrapped by an env-held master key | ✓ SATISFIED | `provision_data_key()`, tested in `tests/identity/test_account_deletion.py` (creation tests) |
| CRYPT-02 | Per-user trade detail (prices/quantities/per-trade P&L/free-text) stored encrypted; the four `reconciliation_runs` aggregates deliberately plaintext | ✓ SATISFIED | `fills`/`events` ciphertext columns; pg_dump confidentiality proof; allow-list guard on the plaintext set |
| CRYPT-03 | Plaintext column set explicit, documented, with reason | ✓ SATISFIED | Migration docstrings; both SQL queries proven against real data |
| CRYPT-04 | Master key rotatable without re-encrypting trade data | ✓ SATISFIED | Byte-identical rotation proof |
| CRYPT-05 | Dump without master key yields no readable price/qty/per-trade P&L, outside the four allow-listed `reconciliation_runs` aggregates | ✓ SATISFIED | Real pg_dump + scratch restore + hex-grep proof, over the whole database; catalog-derived allow-list guard |
| AUTH-06 | Account deletion purges data, destroys data key | ✓ SATISFIED | Crypto-shred middle-state proof; `DELETE /me` |
| LEDGER-04 | ROLL stores two separate fields; DB constraint blocks netted-only | ✓ SATISFIED | `roll_has_both_legs` CHECK, live-verified |

No orphaned requirements found against `.planning/REQUIREMENTS.md`'s Phase 3 row.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in the phase's modified
files. No stub returns, no hardcoded-empty stand-ins flowing to output. The one deliberately
retired surface (`POST /gate/money-roundtrip`) is a recorded, accepted decision — not a stub or
an oversight (see below).

### The Carried Obligation (Phase 1/2 debt this phase owed)

`db/models.py` required this phase to drop `GateMoneyProbe` and `GateUserScopedProbe`. Confirmed
discharged: both tables are gone from the live database (`\dt`), both models are gone from
`db/models.py` (grep confirms zero executable references anywhere), and — the harder half —
Phase 2's eleven isolation guards were moved onto the real `positions` table **before** the drop
(`tests/test_isolation.py`, confirmed 11 originally-named tests still present, plus 3 new
parametrized guards spanning all 5 phase-3 tables). `AUTH-07` was not silently weakened by this
move; it is stronger than before (now covers 5 real tables instead of 1 probe table).

### A Known, Accepted Loss (not a gap)

`POST /gate/money-roundtrip` — the only proof of `OPS-03` against the **deployed** Railway
service — was removed in migration 0009's plan. Confirmed recorded honestly, not silently
dropped: `src/morai/api/app.py`'s own module docstring states "That deployed-surface proof is
not replaced here — recorded, not softened, in this plan's own SUMMARY," and 03-07-SUMMARY.md's
own coverage table (D5) states the same with `human_judgment: true`. Per this task's own
instruction, this is **not treated as a gap** — it is a decision the user accepted, correctly
documented as a live, deployed-coverage gap for a future phase to close (Phase 5's read API or
Phase 6's ingest), not this one.

### Human Verification Required

1. **Confirm `MORAI_MASTER_KEY` is actually set on the Railway `web` and `worker` services**
   - Test: Check Railway's environment variable configuration for both services.
   - Expected: A real, production-only 32-byte base64 value is present on both, distinct from
     the local dev value used throughout this session's test runs.
   - Why human: The KEK is deliberately held outside the database and outside the repo — no
     local test can observe Railway's actual configuration. This is 03-VALIDATION.md's own
     named Manual-Only Verification for `CRYPT-01`, and it is **new to this phase** (Phase 2's
     outstanding manual items — the Railway operator steps, the Argon2 hardware measurement —
     are not re-opened here).

2. **Confirm an operational path exists for running `tools/rotate_kek.py` against production**
   - Test: Either run the script once against a real/staging deployment, or confirm an operator
     runbook exists for doing so when the KEK needs rotating.
   - Expected: The script's local proof (`tests/test_key_rotation.py`, verified passing above)
     is backed by a real deployment path, not only a local unit test.
   - Why human: 03-04-SUMMARY.md states plainly that this script "has not been run against a
     deployment" — an accurate, intentional statement, not an oversight, but it means the
     production rotation path is unexercised and needs a human decision about whether that's
     acceptable to ship as-is or needs a dry run first.

### Gaps Summary

None found. All six roadmap success criteria are verified against live code and a live
database, not against SUMMARY claims. The one code-review finding this task specifically asked
about (WR-01, the `wrap_nonce` nonce-check gap) was confirmed fixed by direct inspection of the
current test file, with the fix's own docstring narrating the history. The phase's carried
obligation from Phase 1/2 is fully discharged with the isolation proof strengthened, not
weakened, in the process. The two items in Human Verification are pre-existing, explicitly
acknowledged deferrals (not discovered defects) that require access to Railway's live
configuration to close — hence `status: human_needed` rather than `passed`.

### Criterion 1 narrowed — 2026-09-02

This report verified criterion 1 as written on 2026-08-31. Migration 0016 landed with Phase 9
and made the criterion's original wording false. `reconciliation_runs` stores
`realised_pnl_usd`, `commissions_usd`, `cash_delta_usd` and `signed_difference_usd` as
plaintext `NUMERIC(14,4)`. A real `pg_dump` of a seeded row, no master key involved, yields
readable P&L. The verification sweep measured it; it did not infer it.

The plaintext is deliberate. `D9-13` requires the stored row to answer "how far off, and in
which direction" on its own. `D9-15` requires `GET /reconciliation/status` to be cheap enough
to poll before rendering. A wrapped data key in the path defeats both.

The owner ruled on 2026-09-02: narrow criterion 1, keep the columns plaintext, leave
`/reconciliation/status` alone. The criterion's row above now says what is true — per-user trade
detail is unreadable without the master key, and the four reconciliation aggregates are the
named exception.

The narrowed line is enforced, not just written down.
`tests/test_pg_dump_confidentiality.py::test_only_the_reconciliation_aggregates_store_plaintext_money`
derives every plaintext money column in the schema from `pg_attribute` and compares it to a
four-entry allow-list. A fifth plaintext money column fails that test on the migration that adds
it. The same file's dump now covers the whole database instead of five named tables, and reads
back every ciphertext column the catalog reports instead of the four it used to name.

**This narrowing changes no `status`.** `human_needed` stands, and both live-infrastructure
items above remain open. A local pass proves nothing about a deployed container.

---

_Verified: 2026-08-31T17:35:06Z_
_Verifier: Claude (gsd-verifier)_
_Criterion 1 narrowed on owner ruling: 2026-09-02_
