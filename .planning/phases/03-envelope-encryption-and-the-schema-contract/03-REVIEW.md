---
phase: 03-envelope-encryption-and-the-schema-contract
reviewed: 2026-08-31T17:17:20Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - alembic/versions/0007_data_key_and_fills.py
  - alembic/versions/0008_positions_legs_events.py
  - alembic/versions/0009_drop_gate_probe_tables.py
  - pyproject.toml
  - src/morai/api/app.py
  - src/morai/api/models.py
  - src/morai/api/routes_identity.py
  - src/morai/crypto/envelope.py
  - src/morai/crypto/rotation.py
  - src/morai/db/models.py
  - src/morai/identity/account.py
  - src/morai/ledger/events.py
  - src/morai/ledger/fills.py
  - src/morai/settings.py
  - src/morai/worker/app.py
  - tests/conftest.py
  - tests/crypto/test_envelope.py
  - tests/crypto/test_nonce_uniqueness.py
  - tests/gate/fixtures/violation_second_fill_writer.py
  - tests/gate/test_type_gate.py
  - tests/identity/conftest.py
  - tests/identity/test_account_deletion.py
  - tests/identity/test_app_role.py
  - tests/identity/test_login_logout.py
  - tests/identity/test_tracer_scoped_read.py
  - tests/ledger/conftest.py
  - tests/ledger/oracle_seed.py
  - tests/ledger/test_plaintext_queries.py
  - tests/ledger/test_roll_check_constraint.py
  - tests/ledger/test_schema_contract.py
  - tests/ledger/test_tracer_encrypted_fill.py
  - tests/test_crypto_shred.py
  - tests/test_decimal_canary.py
  - tests/test_isolation.py
  - tests/test_key_rotation.py
  - tests/test_money_column_naming.py
  - tests/test_money_roundtrip.py
  - tests/test_pg_dump_confidentiality.py
  - tests/test_settings.py
  - tools/isolation_smoke.py
  - tools/rotate_kek.py
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-31T17:17:20Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Reviewed the envelope-encryption core (`crypto/envelope.py`, `crypto/rotation.py`,
`tools/rotate_kek.py`), the single write paths into `fills`/`events`, crypto-shredding
account deletion, the three migrations, and the full identity/ledger/crypto test suite at
standard depth, tracing call chains where a bug in a called function would surface as a
defect in the file under review.

No Critical findings. This is a deliberately adversarial pass, not a validation of the
team's own claims, so the specific failure scenarios asked for in the review brief were
traced through rather than taken on faith:

- **Nonce reuse / decrypt-failure indistinguishability** (`crypto/envelope.py`):
  `decrypt_field`/`unwrap_dek` are thin wrappers over `AESGCM.decrypt`, which verifies the
  GCM tag before ever returning plaintext -- there is no code path in this module that can
  return a partially-decrypted value, and every failure mode (tamper, wrong key, wrong
  nonce, wrong AAD) raises the identical `InvalidTag`. Confirmed by tracing the four
  negative-case tests in `tests/crypto/test_envelope.py`, each of which isolates exactly one
  of those four variables.
- **KEK rotation crash safety** (`crypto/rotation.py`, `tools/rotate_kek.py`): `rotate_kek`
  fetches every `user_data_keys` row once, mutates ORM objects in memory across the loop,
  and calls `session.flush()` exactly once, after every row has unwrapped successfully. A
  raised `InvalidTag` on a bad `old_kek`, or a killed process, occurs before that single
  flush -- no `UPDATE` statement has been sent to Postgres yet, so nothing is written,
  half-written, or double-wrapped. The one-transaction shape (rotate + `session.commit()` in
  `tools/rotate_kek.py::_run`) makes this genuinely all-or-nothing, not merely
  documented as such -- `tests/test_key_rotation.py::test_rotating_with_the_wrong_old_key_raises_without_writing`
  proves it.
- **Crypto-shred ordering** (`identity/account.py`): `delete_account` does not commit
  internally; the caller (`DELETE /me`) wraps every statement plus the final commit in one
  transaction. Because Postgres transactions are all-or-nothing on commit, the actual
  crash-safety guarantee here comes from that single-transaction shape, not from the
  DELETE statement order the module docstring emphasizes -- see IN-01 below.
- **Migrations**: all three (`0007`, `0008`, `0009`) apply `ENABLE`+`FORCE` RLS with a single
  user-scoped policy and no `is_admin` clause on every new table, narrow grants to exactly
  `SELECT, INSERT, DELETE` (no `UPDATE` anywhere new tables are declared), and `0009`'s drop
  reverses grants and the policy before dropping each probe table, matching `0003`'s own
  precedent. Nothing in `0009` touches an object migrations `0007`/`0008` still depend on.
- **`tests/test_pg_dump_confidentiality.py`**: the negative control
  (`test_naive_literal_grep_passes_but_hex_grep_catches_unencrypted_marker`) genuinely
  demonstrates the false pass -- it plants a fully unencrypted marker in its own scratch
  table, dumps it, and asserts the literal grep finds nothing while the hex grep does. The
  positive arms read back through a real `AsyncEngine` against a scratch database restored
  from the live dump, so a regression that stored plaintext would fail both the raw-bytes
  assertion and the hex-grep assertion, not just one.
- **`tests/crypto/test_nonce_uniqueness.py`**: the UNION query and its drift guard correctly
  span every ciphertext-column nonce across `fills`/`events`, and the planted-collision test
  proves the query can actually fail (WR-01 below is the one gap in this file's own stated
  scope, not a defect in what it does cover).

## Warnings

### WR-01: `wrap_nonce` is excluded from every nonce-uniqueness check, not just re-scoped

**File:** `tests/crypto/test_nonce_uniqueness.py:14-22, 83-122`
**Issue:** `_NONCE_COLLISION_QUERY` and `_EXPECTED_NONCE_COLUMNS` both deliberately omit
`user_data_keys.wrap_nonce`. The module docstring's reasoning is that `wrap_nonce` lives
under a different key domain (the single global KEK, not a per-`(user_id, key_version)`
DEK) and that grouping it into the existing per-user query "would be a modeling error." That
part is correct -- but the conclusion drawn from it is not: a different key domain needs a
*different* query, not *no* query. `wrap_nonce` is generated the same way as every other
nonce in this codebase (`os.urandom(12)` in `crypto/envelope.py::wrap_dek`) and is an
AES-GCM nonce under the one live KEK shared by every user's `user_data_keys` row.

Concrete failure scenario: if a future regression -- a broken RNG, a nonce accidentally
hardcoded or copied during a fixture/migration, or a bug in a not-yet-written per-user DEK
rotation path -- ever produced two `user_data_keys` rows sharing the same `wrap_nonce`,
that is a real `(key, nonce)` reuse under the live master key: GCM's confidentiality
guarantee breaks for both wrapped DEKs (the XOR of their keystreams becomes recoverable),
which is exactly as serious a break as the collision this file exists to catch inside
`fills`/`events`. Nothing in this test module, or anywhere else in the reviewed 41 files,
would ever detect it -- `test_nonce_column_drift_guard_matches_the_union_query` and
`test_drift_guard_fails_when_a_nonce_column_is_uncovered` both hard-code the exclusion as
the expected state rather than flagging it as an open gap.

**Fix:** Add a second, independent query scoped to the KEK's own domain -- global, not
per-user, since there is exactly one live KEK at a time:

```sql
SELECT wrap_nonce, COUNT(*) AS collision_count
FROM user_data_keys
GROUP BY wrap_nonce
HAVING COUNT(*) > 1
```

paired with its own planted-collision test (two rows sharing a `wrap_nonce`, inserted via
raw SQL on the superuser session, mirroring this file's existing pattern for the DEK-level
query). This closes the gap the module docstring correctly identifies but stops short of
covering.

## Info

### IN-01: Crypto-shred ordering claims a guarantee that transaction atomicity already provides

**File:** `src/morai/identity/account.py:1-26`
**Issue:** The module docstring states "Reversed or interleaved, an interrupted deletion (a
crash, a killed process, a connection drop) leaves readable ciphertext behind with its key
still present." As implemented, `delete_account()` issues every `DELETE` in one session with
no internal commit, and its only caller (`DELETE /me` in `routes_identity.py`) commits once
after it returns. Because a Postgres transaction is all-or-nothing on commit, a crash or
dropped connection before that single commit rolls back *every* statement regardless of
which order they were issued in -- the key would not be "destroyed with rows still present"
in that scenario, because nothing would have been durably applied at all. The actual
property that prevents the failure mode the docstring names is the single-transaction shape,
not the statement order.

This is not a live bug -- the code is correct, and the order is harmless to keep. It is
worth naming because the docstring's own reasoning, if trusted at face value by a future
maintainer, could justify splitting this into multiple separately-committed statements
(believing order alone preserves the guarantee) in a way that would genuinely reintroduce
the failure mode it currently prevents only by accident of also being atomic.

**Fix:** No code change needed. Consider rewording the docstring's justification to name
the single-transaction/single-commit contract as the actual safety property, with the
statement order kept as a secondary belt-and-braces convention (e.g., for a future caller
that might, for some reason, commit `delete_account()`'s work across more than one
transaction).

### IN-02: `wrap_dek`/`unwrap_dek` bind no associated data, unlike every other encrypt/decrypt call site

**File:** `src/morai/crypto/envelope.py:38-48`
**Issue:** `wrap_dek`/`unwrap_dek` pass `None` for `associated_data`, while every other
encrypt/decrypt pair in this codebase (`encrypt_field`/`decrypt_field`, used by
`ledger/fills.py` and `ledger/events.py`) binds AAD to the row's own composite identity
specifically so that a ciphertext copied between rows fails to decrypt (proven in
`tests/crypto/test_envelope.py::test_wrong_row_associated_data_raises_invalid_tag`). Because
`wrap_dek` uses no AAD, swapping the `(wrapped_dek, wrap_nonce)` pair between two
`user_data_keys` rows at the storage layer would go undetected -- both wrap under the same
KEK, so the swapped ciphertext still authenticates and unwraps to a valid-looking (but
wrong) DEK.

This requires direct write access to the `user_data_keys` table bypassing the app role's
RLS-scoped grants -- outside this project's own stated threat model, which explicitly
excludes protecting against app-server/DB-owner-level compromise (`WHAT-NOT-TO-USE` /
`TECH-DECISIONS.md`'s master-key-location discussion makes the same exclusion for the KEK
itself). Not actionable today; named because the row-binding discipline is otherwise applied
uniformly everywhere else in this same module.

**Fix:** None required under the current threat model. If the threat model is ever widened
to include an attacker who can write to tables but not decrypt data outright (e.g., a
still-narrower DB role than today's `morai_app`), bind `wrap_dek`'s AAD to `user_id` the
same way `_fill_associated_data`/`_event_associated_data` bind to their own row identity.

---

_Reviewed: 2026-08-31T17:17:20Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
