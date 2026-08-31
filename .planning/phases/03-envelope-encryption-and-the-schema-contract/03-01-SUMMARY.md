---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 01
subsystem: database
tags: [encryption, aes-gcm, cryptography, sqlalchemy, alembic, rls, postgres]

# Dependency graph
requires:
  - phase: 02-identity-and-rls
    provides: "morai_app least-privilege role, RLS ENABLE+FORCE+policy pattern (migration 0003), the AuditedRead sentinel-token pattern (identity/audit.py), and the tests/gate/ type-gate discipline"
provides:
  - "src/morai/crypto/envelope.py: generate_dek/wrap_dek/unwrap_dek/encrypt_field/decrypt_field over AES-256-GCM"
  - "user_data_keys and fills tables (migration 0007), RLS ENABLE+FORCE, no admin clause, verb-narrowed grants"
  - "insert_fills()/read_fills() -- the single write path into fills, encryption inside the write path"
  - "Fill's write-token sentinel gate: compile-time via a required keyword arg, runtime via a RuntimeError, matching AuditedRead's own split"
  - "Settings.master_key_bytes -- the KEK, base64-decoded and validated to 32 bytes, never rendered on failure"
affects: [03-02, 03-03, 03-04, 03-05, 03-06, 03-07, phase-5, phase-6, phase-9]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 5470
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: ["cryptography==50.0.1"]
  patterns:
    - "Per-column bytea ciphertext/nonce pairs, one key_version smallint per row (not one JSON blob per row)"
    - "AAD row-binding: every encrypt_field/decrypt_field call binds to a colon-delimited string of table:column:composite-key, execution_time as integer microsecond epoch"
    - "Single-write-path gate: a required keyword-only constructor arg with no default (compile-time, via a real checker's missing-argument diagnostic) plus a runtime sentinel check (the AuditedRead pattern generalized to an ORM __init__)"
    - "insert_fills()/provision_data_key() never commit -- caller's transaction decides durability, same convention as identity/audit.py::open_audited_read"

key-files:
  created:
    - src/morai/crypto/envelope.py
    - alembic/versions/0007_data_key_and_fills.py
    - src/morai/ledger/fills.py
    - tests/ledger/conftest.py
    - tests/ledger/test_tracer_encrypted_fill.py
    - tests/crypto/test_envelope.py
    - tests/gate/fixtures/violation_second_fill_writer.py
  modified:
    - pyproject.toml
    - uv.lock
    - src/morai/settings.py
    - src/morai/db/models.py
    - tests/test_settings.py
    - tests/gate/test_type_gate.py

key-decisions:
  - "insert_fills()/provision_data_key() do not commit internally -- discovered mid-Task-1: Postgres resets a set_config(..., is_local=true) custom GUC to '' (empty string, not NULL) at the end of the transaction that set it, so an internal commit silently broke app.current_user_id for whatever RLS-protected query the caller ran next on the same session. Fixed to match the codebase's existing open_audited_read convention (caller controls the transaction) before any commit landed."
  - "The write-token sentinel (_FILL_WRITE_TOKEN) lives in ledger/fills.py, not db/models.py -- Fill.__init__ imports it with a function-local import to break the otherwise-circular module dependency, and the cross-module access to the underscore-prefixed name is suppressed with # pyright: ignore[reportPrivateUsage] # why: ..., the same convention tests/test_isolation.py already established for _seed_session."
  - "side stays plaintext on fills -- CONTEXT.md's D3-02 enumeration names neither way; 03-RESEARCH.md's own discretion recommendation followed as-is."

requirements-completed: [CRYPT-01, CRYPT-02, CRYPT-03]

coverage:
  - id: D1
    description: "A Decimal handed to insert_fills() comes back from read_fills() as the identical Decimal, and the bytes stored in the fills table never contain that Decimal's own bytes"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_decimal_round_trips_through_insert_and_read"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_stored_ciphertext_does_not_contain_the_plaintext_bytes"
        status: pass
    human_judgment: false
  - id: D2
    description: "A user's data key exists only wrapped under the KEK; no column anywhere holds the unwrapped DEK"
    requirement: CRYPT-01
    verification:
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_user_data_keys_holds_only_the_wrapped_dek"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every encrypted field carries its own nonce column; two encrypted fields on one row carry different nonces"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_two_encrypted_fields_on_one_row_carry_different_nonces"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_repeated_encryption_produces_distinct_nonces_and_ciphertexts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The composite key rejects a duplicate row and accepts one differing only in leg_index or execution_time"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_duplicate_composite_key_raises_integrity_error"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_differing_only_in_leg_index_is_a_distinct_row"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_differing_only_in_execution_time_is_a_distinct_row"
        status: pass
    human_judgment: false
  - id: D5
    description: "Another user's RLS context reads nothing"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_tracer_encrypted_fill.py#test_another_users_context_reads_nothing"
        status: pass
    human_judgment: false
  - id: D6
    description: "Tamper, wrong key, wrong nonce, and wrong-row associated data all raise InvalidTag; wrap/unwrap round-trips byte-exactly"
    requirement: CRYPT-02
    verification:
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_tampered_ciphertext_raises_invalid_tag"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_wrong_key_raises_invalid_tag"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_wrong_nonce_raises_invalid_tag"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_wrong_row_associated_data_raises_invalid_tag"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_wrap_unwrap_round_trips_dek_exactly"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_unwrap_under_wrong_kek_raises_invalid_tag"
        status: pass
    human_judgment: false
  - id: D7
    description: "Constructing a Fill outside the write path is rejected by basedpyright and mypy, with the marker confirmed from a real checker run"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/gate/test_type_gate.py#test_checker_rejects_fixture_with_expected_marker[basedpyright-second_fill_writer-reportCallIssue]"
        status: pass
      - kind: integration
        ref: "tests/gate/test_type_gate.py#test_checker_rejects_fixture_with_expected_marker[mypy-second_fill_writer-call-arg]"
        status: pass
      - kind: unit
        ref: "tests/crypto/test_envelope.py#test_constructing_fill_directly_with_wrong_token_raises_runtime_error"
        status: pass
    human_judgment: false
  - id: D8
    description: "The KEK never appears in a configuration error message, whether unset or the wrong length"
    requirement: CRYPT-01
    verification:
      - kind: unit
        ref: "tests/test_settings.py#test_master_key_bytes_raises_when_unset"
        status: pass
      - kind: unit
        ref: "tests/test_settings.py#test_master_key_bytes_raises_when_wrong_length"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 1: One Encrypted Fill, Written and Read Back Through the Real Path Summary

**AES-256-GCM envelope encryption (per-user DEK wrapped by an env-var KEK) proven end to end through a single `insert_fills()`/`read_fills()` write path, with a compile-time-checked single-writer gate on the ORM model.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 17 (7 created, 10 modified/extended)

## Accomplishments

- `src/morai/crypto/envelope.py`: five pure-`bytes` primitives (`generate_dek`, `wrap_dek`, `unwrap_dek`, `encrypt_field`, `decrypt_field`) over `cryptography`'s `AESGCM`, verified against the library's own docs in research and now exercised by both the tracer and the negative-case suite.
- Migration `0007_data_key_and_fills.py`: `user_data_keys` and `fills`, RLS `ENABLE`+`FORCE`, a `user_isolation` policy on both halves, no admin clause, verb-narrowed grants (`SELECT, INSERT, DELETE` — no `UPDATE` on `user_data_keys`). Docstring documents every plaintext-by-design column with the query it serves, the cipher-choice rationale (GCM over GCM-SIV), and the AAD row-binding format, fixed once.
- `src/morai/ledger/fills.py`: `provision_data_key`, `insert_fills`, `read_fills` — the only path into the `fills` table. Encryption happens inside `insert_fills`; callers never touch AES. Chunked at 2,000 rows (`NN-5`).
- `Fill.__init__` in `db/models.py` requires a `_write_token` keyword with no default — omission is a real basedpyright/mypy error (`reportCallIssue`/`call-arg`, confirmed from a real checker run, not the research's `[ASSUMED]` guess), and a forged token raises `RuntimeError` at runtime — the same split `identity/audit.py`'s `AuditedRead` already documents.
- Full end-to-end proof: a `Decimal("159.41")` price and `Decimal("1")` quantity written through `insert_fills()` and read back unchanged; the stored ciphertext bytes never contain `b"159.41"`; the two encrypted fields on one row carry different nonces; the composite key rejects a duplicate and accepts a row differing only in `leg_index` or `execution_time`; another user's RLS context reads nothing.

## Task Commits

1. **Task 1: One encrypted fill, written and read back through the real path** - `c879b00` (feat)
2. **Task 2: The envelope's negative cases — tamper, wrong key, wrong row** - `fc04085` (test)
3. **Task 3: A second writer into the fill table fails type-check** - `2441bf8` (test)

_Task 1 was TDD: the tracer test was written first and observed failing with `ModuleNotFoundError: No module named 'morai.ledger.fills'` (natural red, no scaffolding built to manufacture a more interesting one), then implemented to green — all within one commit per this plan's own convention for `type="tracer"` tasks._

## Files Created/Modified

- `src/morai/crypto/envelope.py` - AES-256-GCM primitives (generate/wrap/unwrap/encrypt/decrypt)
- `alembic/versions/0007_data_key_and_fills.py` - `user_data_keys` + `fills` DDL, RLS, grants
- `src/morai/db/models.py` - `UserDataKey`, `Fill` ORM models (write-token-gated `Fill.__init__`)
- `src/morai/ledger/fills.py` - `provision_data_key`, `insert_fills`, `read_fills`, the AAD helper
- `src/morai/settings.py` - `morai_master_key` field, `master_key_bytes` property
- `pyproject.toml` / `uv.lock` - `cryptography==50.0.1`
- `tests/ledger/conftest.py`, `tests/ledger/test_tracer_encrypted_fill.py` - the tracer suite
- `tests/crypto/test_envelope.py` - the envelope's negative-case suite
- `tests/gate/fixtures/violation_second_fill_writer.py`, `tests/gate/test_type_gate.py` - the type-gate proof
- `tests/test_settings.py` - `master_key_bytes` unset/wrong-length cases

## Decisions Made

- **`insert_fills()`/`provision_data_key()` never commit.** Discovered mid-Task-1: an internal `session.commit()` ends the transaction that a prior `set_config('app.current_user_id', ..., true)` call was scoped to, and Postgres resets that custom GUC to `''` (empty string, not `NULL`) at transaction end — not to its prior unset state. The next RLS-protected query on the same session then fails with `invalid input syntax for type uuid: ""` instead of correctly evaluating the policy. Fixed to match `identity/audit.py::open_audited_read`'s existing convention (caller controls the transaction) before this ever reached a commit.
- **The write-token sentinel lives in `ledger/fills.py`, not `db/models.py`.** `Fill.__init__` imports it with a function-local (not module-level) import, breaking the otherwise-circular dependency (`ledger/fills.py` imports `Fill` from `db/models.py` at module scope). The cross-module access to the underscore-prefixed name is suppressed with a `# pyright: ignore[reportPrivateUsage]  # why: ...` comment, the exact convention `tests/test_isolation.py` already established for `_seed_session`.
- **`side` stays plaintext.** `03-CONTEXT.md`'s `D3-02` plaintext enumeration names neither way for it; followed `03-RESEARCH.md`'s own discretion recommendation (a two-value categorical compared only to itself by the fill-pairing algorithm, discloses no dollar amount or position size) without revisiting it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `insert_fills()`'s internal commit broke RLS context for the caller's next query**
- **Found during:** Task 1, first tracer test run (`test_decimal_round_trips_through_insert_and_read`)
- **Issue:** `insert_fills()` called `session.commit()` at the end, which reset the transaction-local `app.current_user_id` GUC to `''` rather than leaving it set for `read_fills()`'s subsequent query on the same session — a real `InvalidTextRepresentationError: invalid input syntax for type uuid: ""` from Postgres, not a test-only artifact.
- **Fix:** Removed the internal `session.commit()`; `insert_fills()` now only flushes per chunk, matching `open_audited_read`'s existing "caller controls the transaction" convention. Documented in the function's own docstring so a future caller doesn't reintroduce it.
- **Files modified:** `src/morai/ledger/fills.py`
- **Verification:** Full tracer suite green after the fix; `bash tools/gate.sh` green.
- **Committed in:** `c879b00` (part of Task 1's commit — caught before any commit landed)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact on plan:** Necessary for correctness — the plan didn't specify commit behavior explicitly, so this isn't a plan-text deviation, but it is a genuine bug that would have silently broken every RLS-protected read following a write on the same session. No scope creep.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required. `MORAI_MASTER_KEY` is a local-only env var for this plan; the Railway production value is a separate, already-noted manual verification item in `03-VALIDATION.md`'s "Manual-Only Verifications" table, not owed by this plan.

## Next Phase Readiness

- The envelope-encryption boundary is proven end to end on one real path (`insert_fills`/`read_fills`), which every later plan in this phase (03-02 through 03-07) and Phases 5, 6, 9 write and read through.
- `positions`, `legs` and `events` (migration 0008) are 03-02's job — deliberately not started here, per D3-19's append-only migration rule and to avoid branching the Alembic revision chain.
- Ready for 03-02 (`positions`/`legs`/`events` schema, the ROLL `CHECK` constraint).

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- All 7 created files verified present on disk with `ls -la`.
- All 3 task commit hashes (`c879b00`, `fc04085`, `2441bf8`) verified present in `git log --oneline --all`.
- `bash tools/gate.sh` re-confirmed green (171 passed) before this summary was written.
