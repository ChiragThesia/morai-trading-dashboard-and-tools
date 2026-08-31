---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 03
subsystem: database
tags: [encryption, aes-gcm, cryptography, sqlalchemy, postgres, pg_dump, testing]

# Dependency graph
requires:
  - phase: 03-01
    provides: "src/morai/crypto/envelope.py's AES-256-GCM primitives, user_data_keys/fills (migration 0007), insert_fills()/read_fills()"
  - phase: 03-02
    provides: "positions/legs/events (migration 0008), insert_events()/read_events(), the roll_has_both_legs CHECK"
provides:
  - "tests/test_pg_dump_confidentiality.py: criterion 1a proved by a real pg_dump restored into a scratch database with no master key present, raw-bytes comparison via a real AsyncEngine, and an independent hex-encoding grep arm, plus the named negative control demonstrating the naive literal grep's false pass"
  - "tests/crypto/test_nonce_uniqueness.py: criterion 1b proved by one UNION ALL query over every ciphertext-nonce column grouped by (user_id, key_version, nonce), a planted cross-column collision proving the query can fail, and an information_schema-derived schema-drift guard"
affects: [03-04, 03-05, 03-06, 03-07, phase-9]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 8490
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Blocking subprocess calls inside a shared session-scoped asyncio event loop routed through asyncio.to_thread, not called synchronously -- calling pg_dump/createdb/psql/dropdb directly stalled the loop long enough to intermittently corrupt unrelated tests' AsyncEngine state elsewhere in the same pytest session"
    - "Scratch-database reads through sqlalchemy.ext.asyncio.create_async_engine against the scratch DSN, not a raw asyncpg.connect() -- asyncpg ships no type stubs, and the codebase's existing TypeAdapter-narrowed text() boundary covers the same untyped-driver problem without a second, differently untyped dependency"
    - "A schema-drift guard derived from information_schema.columns by name suffix, proven capable of failing via a throwaway planted column before being trusted to guard the real schema"

key-files:
  created:
    - tests/test_pg_dump_confidentiality.py
    - tests/crypto/test_nonce_uniqueness.py

key-decisions:
  - "No dedicated free-text column exists on fills/events yet (CRYPT-02's 'free-text entry fields' land with a real notes-shaped column in a later phase, and this plan's files_modified names no schema change). The free-text case in criterion 1a is proved with the exact primitive and per-user DEK insert_fills() uses internally (encrypt_field, _current_dek, _fill_associated_data), applied to a distinctive marker string instead of a Decimal -- proving the encryption boundary is content-agnostic without adding a schema column outside this plan's scope."
  - "user_data_keys.wrap_nonce is deliberately excluded from the nonce-collision query and its schema-drift guard. It is encrypted under the single global KEK, not a per-(user_id, key_version) DEK -- folding it into the same (user_id, key_version, nonce) grouping would be a modeling error, not an omission: two different users sharing a wrap_nonce value would collide under the real key (the KEK) but land in different groups here and never be flagged. Documented in the module docstring as a different invariant with a different key domain."
  - "Subprocess calls in the pg_dump test route through asyncio.to_thread rather than calling subprocess.run synchronously. Discovered mid-task: calling pg_dump/createdb/psql/dropdb directly blocked the suite's shared session-scoped event loop for real wall-clock time, and this intermittently corrupted unrelated tests elsewhere in the same run (observed as flaky FK-violation, RLS-violation and duplicate-key failures in tests/identity and tests/ledger with no logical relation to this file) -- confirmed by isolating each new test file against the rest of the suite independently, then fixed before either task commit landed."

requirements-completed: [CRYPT-05]

coverage:
  - id: D1
    description: "A real pg_dump, restored into a scratch database by a process with no master key in its environment, yields no readable price, quantity, P&L or free-text field"
    requirement: CRYPT-05
    verification:
      - kind: integration
        ref: "tests/test_pg_dump_confidentiality.py#test_real_dump_restored_without_master_key_yields_no_readable_bytes"
        status: pass
    human_judgment: false
  - id: D2
    description: "The naive dump-file literal grep passes on an unencrypted marker while the hex-encoding grep catches it -- the methodology proof that keeps a future reader from mistaking the wrong test shape for criterion 1a's proof"
    requirement: CRYPT-05
    verification:
      - kind: integration
        ref: "tests/test_pg_dump_confidentiality.py#test_naive_literal_grep_passes_but_hex_grep_catches_unencrypted_marker"
        status: pass
    human_judgment: false
  - id: D3
    description: "No two ciphertext values anywhere in the schema share a (user_id, key_version, nonce) triple, checked by one query unioning every ciphertext column in every encrypted table"
    requirement: CRYPT-05
    verification:
      - kind: integration
        ref: "tests/crypto/test_nonce_uniqueness.py#test_union_query_returns_zero_rows_over_several_hundred_real_values"
        status: pass
      - kind: integration
        ref: "tests/crypto/test_nonce_uniqueness.py#test_union_query_returns_exactly_the_planted_cross_column_collision"
        status: pass
    human_judgment: false
  - id: D4
    description: "A ciphertext nonce column added later without a matching UNION branch fails the schema-drift guard, not merely passes the union query silently missing it"
    requirement: CRYPT-05
    verification:
      - kind: integration
        ref: "tests/crypto/test_nonce_uniqueness.py#test_nonce_column_drift_guard_matches_the_union_query"
        status: pass
      - kind: integration
        ref: "tests/crypto/test_nonce_uniqueness.py#test_drift_guard_fails_when_a_nonce_column_is_uncovered"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 3: The pg_dump and Nonce-Uniqueness Proofs Summary

**Criterion 1's two dump-confidentiality and nonce-uniqueness claims proved the only two ways that can actually fail on a leak — a real `pg_dump` restored into a scratch database with no master key present, and one query unioning every ciphertext-nonce column across `fills`/`events`.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- `tests/test_pg_dump_confidentiality.py`: seeds two fills, one ROLL event, and a free-text marker (all through the real `insert_fills`/`insert_events`/`encrypt_field` paths) for one user, takes a real `pg_dump` of `users`/`positions`/`fills`/`events`/`user_data_keys`, restores it into a freshly-created scratch database, and reads the ciphertext back as real Python `bytes` through a real `AsyncEngine` from a process with `MORAI_MASTER_KEY` removed from its environment. Asserts no seeded plaintext's UTF-8 bytes are a substring of any stored ciphertext, and — independently — that no seeded plaintext's hex encoding appears in the dump text itself. A fresh `Settings` instance built after the master key is removed raises `RuntimeError` naming `morai_master_key` rather than returning a value. A second test, entirely isolated in its own throwaway scratch database and table, demonstrates the naive literal-string grep passing on a completely unencrypted marker while the hex-encoding grep catches it — the named negative control the plan requires.
- `tests/crypto/test_nonce_uniqueness.py`: one `UNION ALL` query, written once as a module-level constant, unions `quantity_nonce`/`price_usd_nonce` from `fills` and `open_debit_usd_nonce`/`close_credit_usd_nonce` from `events`, grouped by `(user_id, key_version, nonce)`. Proven to return zero rows over 640 real nonces seeded across two users through the real write paths, and proven capable of firing by a planted cross-column collision (a fill's `quantity_nonce` copied onto an event's `open_debit_usd_nonce` via raw SQL on the superuser session, bypassing the write path deliberately). A schema-drift guard derives the covered-column set from `information_schema.columns` by name suffix and is itself proven capable of failing via a throwaway planted column, before being trusted against the real schema.
- Both scratch databases (the real-restore one and the negative-control one) are dropped in `finally` blocks, named with random suffixes so a leftover from a crashed run cannot collide with a future one.

## Task Commits

1. **Task 1: a real dump, restored without the key, yields nothing readable** - `1fe7315` (test)
2. **Task 2: no two ciphertext values share a key and a nonce** - `9fc3452` (test)

Both tasks were `tdd="true"` with no corresponding production-code change in `files_modified` (all underlying encryption, write paths and migrations already landed in 03-01/03-02) — the natural red for each was the test module simply not existing yet on disk; each was written complete and committed once it reached green, per this plan's own "cheapest honest red" instruction, since fabricating an intermediate failing state on top of already-correct production code would have been scaffolding, not TDD.

## Files Created/Modified

- `tests/test_pg_dump_confidentiality.py` - criterion 1a's dump-and-restore proof, the free-text case, and the naive-grep negative control
- `tests/crypto/test_nonce_uniqueness.py` - criterion 1b's nonce-collision query, the planted-collision proof, and the schema-drift guard

## Decisions Made

- **No dedicated free-text column exists yet** — CRYPT-02's "free-text entry fields" land with a real notes-shaped column in a later phase, and this plan added no schema. The free-text case is proved with the exact primitive and per-user DEK `insert_fills()` uses internally, applied to a distinctive marker string rather than a `Decimal`, demonstrating the encryption boundary is content-agnostic.
- **`user_data_keys.wrap_nonce` is deliberately excluded** from the nonce-collision query and its drift guard — it is encrypted under the single global KEK, not a per-`(user_id, key_version)` DEK, and folding it into the same grouping would be a modeling error (it could hide a real cross-user KEK-nonce collision by scoping the group to `user_id` first). Documented in the module docstring.
- **Subprocess calls route through `asyncio.to_thread`**, not synchronous `subprocess.run` — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Blocking subprocess calls stalled the shared event loop and intermittently corrupted unrelated tests**
- **Found during:** Task 1, running the full suite after both test files were written and individually green
- **Issue:** `pg_dump`/`createdb`/`psql`/`dropdb` were invoked via synchronous `subprocess.run()` inside an `async def` test. This project's suite shares one session-scoped `asyncio` event loop across every test's own `AsyncEngine` (`pyproject.toml`'s own documented reason for that scope: "one process, one event loop, one pool for its life"). Calling a blocking subprocess directly stalls that shared loop's thread for the full duration of each subprocess call, starving any other engine's own scheduled maintenance running on it. This manifested as intermittent, non-reproducible failures scattered across unrelated files (`tests/identity/test_admin_routes.py`, `tests/identity/test_login_logout.py`, `tests/identity/test_audit.py`, `tests/test_isolation.py`, `tests/ledger/test_tracer_encrypted_fill.py`) — FK violations, RLS violations and duplicate-key errors with no logical connection to this plan's own tables.
- **Fix:** Routed every `_run()` invocation through `asyncio.to_thread(subprocess.run, ...)` in `tests/test_pg_dump_confidentiality.py`, so the blocking call happens off the event loop's own thread.
- **Files modified:** `tests/test_pg_dump_confidentiality.py`
- **Verification:** Full local suite (`uv run pytest -q`) run five consecutive times after the fix, all green with no flaky failures anywhere in the suite; `bash tools/gate.sh` green (206 passed).
- **Committed in:** `1fe7315` (part of Task 1's commit — caught and fixed before any commit landed)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact on plan:** Necessary for correctness of the whole suite, not merely this plan's own two tests — an unfixed shared-loop stall would have made every subsequent phase's test run nondeterministically flaky. No scope creep: the fix is confined to this plan's own new file.

## Issues Encountered

`asyncpg` ships no type stubs of its own; an initial implementation using `asyncpg.connect()` directly for scratch-database reads produced 20 basedpyright `reportUnknown*` errors. Resolved by reading through `sqlalchemy.ext.asyncio.create_async_engine` against the scratch database's own DSN instead — the same `TypeAdapter`-narrowed `text()` boundary this codebase already uses everywhere else for raw SQL, rather than introducing a second, differently untyped dependency. Not a deviation from the plan's behavior; a type-safety implementation detail.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Criterion 1 (both 1a and 1b) is proved. This is the phase's headline security claim (CRYPT-05).
- The `asyncio.to_thread` subprocess pattern is now the established convention for any future test in this suite that needs to shell out to a real client binary from inside an `async def` test — future plans (03-04's crypto-shred work, 03-06's KEK rotation proof) should follow it if they add their own subprocess-based tests.
- Ready for 03-04.

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- Both created files verified present on disk with `ls -la`.
- Both task commit hashes (`1fe7315`, `9fc3452`) verified present in `git log --oneline`.
- Full local suite re-confirmed green five consecutive times (no flaky failures) before this summary was written; `bash tools/gate.sh` green (206 passed, ruff/ruff format/basedpyright/mypy clean across 66 source files).
