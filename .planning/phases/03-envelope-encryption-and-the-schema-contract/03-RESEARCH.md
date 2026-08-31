# Phase 3: Envelope Encryption and the Schema Contract - Research

**Researched:** 2026-08-31
**Domain:** Envelope encryption (AES-256-GCM) in Python over SQLAlchemy 2.0 / Postgres, applied to a multi-user trading ledger schema
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The encryption boundary**

- **D3-01:** Encryption is **per-column**, each money and free-text field its own `bytea`. Not one
  encrypted JSON blob per row. A blob makes a gap unrepresentable (`NN-16` requires absence to be
  `NULL`, never a sentinel) and pushes units back to being inferred at the call site, which is
  exactly `NN-8`'s failure — a +$395 trade displayed as −$319,850.
- **D3-02:** The **plaintext-by-design column set** is `user_id`, `order_id`, `occ_symbol`,
  `position_effect`, every timestamp, every join/foreign key, and `event_type`. Each column is
  documented in the migration with the query it exists to serve (`CRYPT-03`, criterion 2).
  `quantity` is **encrypted**, not plaintext — it is a position size, and leaving it readable
  leaks strategy to a dump-holder for a SQL-grouping convenience Python can do after decrypt.
- **D3-03:** The nonce lives in an **adjacent `bytea` column** per encrypted field, explicit and
  greppable, not prefixed into the ciphertext bytes. Criterion 1 requires a test proving no two
  ciphertext rows share a `(key, nonce)` pair; that test is written against a column it can
  select, not against bytes it must first parse.
- **D3-04:** Reconciliation selects its **window and rows in SQL**; the **sum happens in Python
  after decrypt**. No plaintext `cash_delta_usd` shortcut — that would put the exact figure
  `CRYPT-05` protects back in the dump. Phase 9 inherits this shape.

**Key management**

- **D3-05:** One **DEK per user**, AES-256-GCM, generated at account creation (`CRYPT-01`). Not
  per-year or per-table — four or five users do not need that rotation granularity.
- **D3-06:** The **KEK is a Railway environment variable**, held outside the database, per the
  stack decision and the project's stated threat model (a stolen dump/backup, explicitly not
  app-server compromise). Recorded as the decision most likely to need revisiting: a hosted KMS is
  unambiguously stronger and costs about $1/month, and becomes the right call if the user base
  grows past a handful of trusted friends or app-server compromise enters the threat model.
- **D3-07:** A **`key_version` smallint column** on every encrypted row, so a versioned row reads
  under the key it was written with (`CRYPT-04`, criterion 3). Not a version prefix inside the
  ciphertext — that is invisible to SQL, so the distribution of versions across rows could not be
  audited or migrated in batches.
- **D3-08:** Account deletion (`AUTH-06`) **destroys the wrapped DEK**, then deletes the rows.
  Destroying the key is what makes the claim a crypto-shred rather than a row delete; criterion 5
  requires that after deletion the rows decrypt to nothing.

**The schema contract**

- **D3-09:** The netted-ROLL prohibition (`LEDGER-04`, criterion 4) is a **database `CHECK`
  constraint**, not application validation a later caller could bypass:
  `CHECK (event_type <> 'ROLL' OR (open_debit IS NOT NULL AND close_credit IS NOT NULL))`. This is
  the code class that cost v1 −$319,850.
- **D3-10:** The fill table's composite key carries **every discriminating column, including ones
  whose value is a single literal today** (`NN-1`): `(user_id, order_id, occ_symbol, leg_index,
  execution_time)`. "It never varies today" is not "it can never vary" — the narrower key is what
  silently discarded 49.6% of every smile in v1.
- **D3-11:** A missing value is **`NULL`** in a nullable ciphertext column. Never a sentinel, never
  zero, never carried forward (`NN-16`). `None`-handling is forced at every read site.
- **D3-12:** The `_usd` / `_pts` unit suffix **survives onto the encrypted columns** (`D-04`,
  `NN-8`). A column being `bytea` does not excuse it from naming its unit; the unit is a property
  of the value, not of its storage type.

**The single write path**

- **D3-13:** One `insert_fills()` function is the only way into the fill table. A `tests/gate/`
  fixture proves a **second writer fails type-check**, matching Phase 1's `D-05`/`D-07` gate
  discipline — a gate that has never rejected anything is decoration.
- **D3-14:** Phase 5's oracle seeds its 52 fills **through that same function**, never a test-only
  fast path. Two implementations of one write is the shape that made a +$395 trade read as
  −$319,850 (`LEDGER-01`).
- **D3-15:** **Encryption happens inside the write path.** Callers hand it `Decimal` and never
  touch AES. Encryption at call sites means every caller must remember, and one will not.
- **D3-16:** Batch inserts chunk at **≤2,000 rows** (`NN-5`).

**Carried forward from Phases 1-2 — do not regress**

- **D3-17:** `Decimal` end to end in the money path, never `float` (`D-01`, `D-02`). Money carries
  its unit as a `NewType` over `Decimal`.
- **D3-18:** New tables get RLS `ENABLE` + `FORCE` and a `user_id`-scoped policy, and `morai_app`
  is granted only the verbs it needs — the narrowing Phase 2's `WR-05` fix established for
  `audit_log`.
- **D3-19:** Migrations are append-only. 0001-0006 are applied; this phase adds 0007+. Never edit
  an applied migration in place.

### Claude's Discretion

CONTEXT.md carries no separate `## Claude's Discretion` header for this phase — its `<specifics>`
section is treated as strongly-recommended implementation guidance rather than a distinct
discretion list, and is reproduced here verbatim rather than paraphrased:

- Criterion 1's dump test should be a **real `pg_dump`**, restored with the master key
  unavailable, then grepped — not an assertion about column types.
- Criterion 2 names two queries that must run in SQL against the plaintext set: the
  **shared-front-leg disambiguation** query and the **reconciliation window** query. Both should
  be written and executed in this phase, not merely designed for. If either cannot be expressed
  against the chosen plaintext set, the plaintext set is wrong and D3-02 needs revisiting before
  the schema lands.
- Criterion 3's rotation test must show trade ciphertext **byte-identical** before and after a KEK
  rotation — the DEKs are re-wrapped, the data is not touched.
- The `(key, nonce)` uniqueness claim in criterion 1 wants a real query across the stored nonce
  columns, not a reasoning argument about `os.urandom`.

Where this research itself makes a call CONTEXT.md leaves open (`side`'s plaintext/encrypted
status, the `associated_data` binding format, the module split between `db/models.py` and a new
`crypto`/`ledger` tree, and whether `kek_version` is worth persisting), each is flagged explicitly
in the body below as this research's own recommendation, not a locked decision.

### Deferred Ideas (OUT OF SCOPE)

- **Hosted KMS instead of an env-var KEK.** Revisit if the user base grows past a handful of
  trusted friends, or if app-server compromise enters the threat model (`D3-06`).
- **Per-year or per-table DEKs.** Not needed at this scale (`D3-05`).
- **Column-level RLS restriction on `users`** — `IN-01` from Phase 2's review. Not exploitable
  today; only `password_hash` is ever self-written.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRYPT-01 | Each user gets a data key at account creation, wrapped by a master key held outside the database | Pattern 1 (`generate_dek`/`wrap_dek`), Pattern 2 (`user_data_keys` DDL) |
| CRYPT-02 | Prices, quantities, P&L, and free-text entry fields are stored encrypted under that user's key | Pattern 2 (`fills`/`events` DDL, per-column `bytea` pairs), Pattern 1 (`encrypt_field`) |
| CRYPT-03 | The plaintext column set is explicit and documented with the reason each column must stay readable | Pattern 2's column comments; Code Examples (both SQL queries proven against the proposed set) |
| CRYPT-04 | The master key can be rotated without re-encrypting any user's trade data | Pattern 3 (`key_version` tracks the DEK, not the KEK), Pattern 4 (`rotate_kek`) |
| CRYPT-05 | A database dump taken without the master key yields no readable price, quantity, or P&L | Pitfall 1 (the corrected `pg_dump` test methodology), Pitfall 2 (`(key, nonce)` uniqueness query, birthday bound) |
| AUTH-06 | User can delete their own account, purging their data and destroying their data key | Architectural Responsibility Map (crypto-shred split), Security Domain threat table (crypto-shred ordering vs. L069) |
| LEDGER-04 | A ROLL stores its open debit and its close credit as two separate fields, with a database constraint making a netted-only value impossible to store | Pattern 2 (`roll_has_both_legs` `CHECK`), Pitfall 3 (what it does and does not catch) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives from both `CLAUDE.md` (root) and `.claude/CLAUDE.md` that bind this phase's plans,
beyond the D3-decisions already reproduced above. The planner should verify every plan against
these, the same authority as a locked decision.

- **No `Any`, no `cast`, no bare `# type: ignore`.** `mypy --strict` + basedpyright strict. A
  suppression needs a scoped rule name and a same-line `# why:` reason. Applies to every new
  module this phase adds (`crypto/`, `ledger/`, the new `db/models.py` classes).
- **TDD, red before green.** Every task adding behavior needs a failing-test commit before the
  implementation commit (`test(<plan-id>): ...`, checked by `git log --grep`, per `P035`). The
  cheapest honest red is enough — an `ImportError` on a module that doesn't exist yet costs
  nothing; do not build scaffolding to manufacture a more satisfying failure (`.claude/rules/workflow.md`).
- **`Decimal` end to end in the money path, never `float`.** Every plaintext `Decimal` that gets
  encrypted must still be `Decimal` right up to the `encrypt_field()` call; the ciphertext boundary
  is not a license to round-trip through `float`.
- **Test locally against the real local Postgres 18 (Homebrew), not Docker (broken on this
  machine) and not a CI round-trip.** `DATABASE_URL=postgresql://morai:morai@localhost:5432/morai`,
  `MORAI_APP_DB_PASSWORD=localdevpassword`, `MORAI_ENV_FILE=""`. Full suite currently ~13s local
  vs. ~3 minutes in CI — push when the local gate is green, never to find out whether it is.
- **Migrations are append-only (`D3-19` restates this); this phase adds `0007+`.** Never edit
  0001-0006 in place.
- **Batch inserts chunk at ≤2,000 rows** against Postgres's 65,534 bind-parameter ceiling (`NN-5`,
  `D3-16`) — relevant the moment Phase 5/6 seeds 52+ fills or a real ingest lands many rows at
  once; Phase 3 itself seeds no bulk data, but the column count on `fills`/`events` should be
  checked against `floor(65534 / columns)` if a bulk-insert helper is added here.
- **Grep `docs/learnings/` before deciding anything this phase might already have an answer for.**
  Done this session — no existing `L###`/`V###`/`R###`/`P###` entry covers AES-GCM, nonce
  discipline, or envelope encryption specifically; this is genuinely new ground for the project's
  own record, not a re-derivation of something already settled.
- **Evidence discipline (`V065`): never invent a number, quote, path, or citation.** `WebFetch`
  paraphrases — this research used `curl` directly for every load-bearing quote (the AESGCM docs,
  the NIST PDF, the ASVS chapter files), consistent with this rule.
- **Security: envelope encryption, per-user data key wrapped by a master key outside the
  database. No cross-user view. Audit log on privileged reads.** This phase's entire mandate;
  "audit log on privileged reads" is already built (Phase 2, `identity/audit.py`) and this phase's
  new tables get **no** admin-exempt read path (Pattern 5) — trading data has no legitimate
  cross-user read at all, matching `identity/audit.py`'s own stated boundary.
- **`pgcrypto` is rejected** (`.claude/CLAUDE.md` "What NOT to Use") — the key must never transit a
  SQL statement or the Postgres query log. Every encrypt/decrypt call happens in the app process
  only.
- **The repo sits on an iCloud-synced Desktop (`V091`).** Not directly relevant to this phase's
  code, but worth a reminder for whoever writes the migration file: a stray ` 2`-suffixed copy of
  a new migration file would silently duplicate DDL history if not caught before commit.

## Summary

The phase has one real risk and it is not the encryption. AES-256-GCM via `cryptography`'s
`AESGCM` is a five-function API, verified this session against the library's own docs: generate a
256-bit key, encrypt with a 12-byte random nonce and an `associated_data` binder, store the
16-byte tag as part of the returned ciphertext, never touch a key in SQL. The real risk is
`CRYPT-03` — whether the plaintext-by-design column set can actually answer the two queries this
project's own ledger logic depends on. It can. Both queries were written against a `user_id,
order_id, occ_symbol, leg_index, execution_time, position_effect, event_type` column set and
**executed against real local Postgres 18.6 this session**, seeded from the two real oracle
calendars that share a front-leg contract (`8a63aa81` / `6303e6af`, salvage/oracle-fixtures.md).
Both queries returned the correct rows with zero collisions. D3-02's plaintext set is sufficient.

The second finding worth flagging before any DDL is written: `src/morai/db/models.py`'s own
docstrings say, twice, that this phase must drop `GateMoneyProbe` and `GateUserScopedProbe` with
an explicit migration once real trading tables exist to prove isolation against instead. That is
not a suggestion — it is an obligation the code carries forward from Phase 1 and Phase 2,
[VERIFIED: src/morai/db/models.py:5-6,113-119].

The third finding is a methodology correction to CONTEXT.md's own test design. `pg_dump`'s plain
SQL/COPY format hex-encodes `bytea` columns. A test that greps a dump file for the literal
plaintext string (`"1234.5678"`, a thesis sentence) will pass even in the worst case — no
encryption happened at all — because the plaintext substring is never present in the dump text,
only its hex encoding is. **Verified live this session**: inserting the literal ASCII bytes of a
known marker string directly into a `bytea` column, with zero encryption, and grepping the
resulting `pg_dump` output for that marker returned **zero matches** — a false pass on a real
leak. The correct test restores into a scratch database and compares raw `bytes` in Python
(`asyncpg`/`psycopg` return `bytea` as real `bytes`, not hex text), or greps the dump for the
plaintext's **hex encoding**, not the plaintext itself. See Pitfall 1.

**Primary recommendation:** `cryptography` 50.0.1's `hazmat.primitives.ciphers.aead.AESGCM`,
one `key_version`-versioned DEK per user wrapped by an env-var KEK, per-field nonces, `bytea`
ciphertext/nonce column pairs named with the `_usd`/`_pts` suffix intact, a `CHECK` constraint on
NULL-ness only (not value) for the ROLL split, and the `AuditedRead`-shaped sentinel-token pattern
already proven in this codebase (`identity/audit.py`) reused to gate the fill table's `__init__`
against a second writer.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DEK generation, wrap/unwrap, field encrypt/decrypt | API/Backend (app process) | — | The KEK never leaves the app process's env; Postgres must never see a key, only ciphertext (rejected `pgcrypto` for exactly this reason, `.claude/CLAUDE.md` "What NOT to Use"). |
| Ciphertext/nonce/key_version storage | Database / Storage | — | Postgres stores only opaque `bytea`; it performs no cryptographic operation. |
| Plaintext-column query resolution (disambiguation, reconciliation window) | Database / Storage | — | D3-02's whole purpose: these two queries must run in SQL, never require a decrypt-then-filter pass in the app tier. |
| Sum of decrypted P&L over a window | API/Backend | — | D3-04: the window is selected in SQL, the sum happens in Python after decrypt. SQL cannot sum ciphertext. |
| RLS tenant isolation on new tables | Database / Storage | API/Backend (sets `app.current_user_id`) | Same split as Phase 2 — the policy lives in Postgres, the session variable is set by the request-scoped dependency. |
| Single write path into `fills` | API/Backend | — | D3-13/D3-15: encryption happens inside `insert_fills()`; no tier below the app process is involved in enforcing this. |
| Crypto-shred on account deletion | API/Backend (key destruction) | Database (row deletion) | Key destruction is an app-tier operation (delete the `user_data_keys` row); it must complete and be provably effective before the database-tier row deletion is even attempted (L069). |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cryptography` | 50.0.1 (PyPI, confirmed live this session) | AES-256-GCM envelope encryption (`hazmat.primitives.ciphers.aead.AESGCM`) | Already the project's own locked stack decision (`.claude/CLAUDE.md` §6, `.claude/CLAUDE.md` root Technology Stack doc). The `cryptography` project *is* PyOpenSSL/most of the Python ecosystem's TLS and crypto foundation — not a discretionary pick. |
| SQLAlchemy `LargeBinary` / `Mapped[bytes]` | 2.0.52 (already a project dependency) | `bytea` columns for ciphertext/nonce, typed with zero `Any` leakage | Same native-`Mapped[]` pattern already proven for `Mapped[Decimal]`/`Mapped[str]` in `src/morai/db/models.py` — no new typing story needed. [CITED: docs.sqlalchemy.org/en/20/core/type_basics.html] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| stdlib `os.urandom` | — | 12-byte (96-bit) nonce generation | Per-field, per-encryption. Never reuse, never derive. |
| stdlib `secrets` | — | Not needed for nonces (CSPRNG parity with `os.urandom` on this platform), but is the project's existing idiom for opaque tokens (`sessions.py`) — mentioned for consistency, not required here. | — |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `AESGCM` (random nonce) | `AESGCMSIV` (nonce-misuse-resistant variant, same module) [VERIFIED: cryptography.io/en/latest/hazmat/primitives/aead/, fetched via curl this session] | Genuinely stronger against accidental nonce reuse — a repeated nonce under GCM-SIV degrades gracefully instead of catastrophically. Not adopted: `.claude/CLAUDE.md` already locked "AES-256-GCM" by name (D3-05 says "AES-256-GCM"), and at this project's scale (see Pitfall 2) plain GCM's nonce-collision risk is already many orders of magnitude below the threshold that would justify the swap. Worth a one-line note in the migration for a future reader who wonders why GCM-SIV wasn't used. |
| `AESGCM` | `Fernet` | Already rejected in `.claude/CLAUDE.md`'s own Alternatives table — Fernet bakes in its own versioned/timestamped token format that doesn't compose with "this ciphertext is a `bytea` column with its own adjacent nonce column." Not re-litigated here. |
| Per-user DEK, one version at a time | A per-row DEK, or a per-column DEK | Rejected as unnecessary complexity for "a handful of users" — D3-05 already locks one DEK per user. A per-row/column DEK would need its own wrap-storage per row, which is exactly the ciphertext-bloat CRYPT-01's "per-user data key" design avoids. |

**Installation:**
```bash
uv add cryptography==50.0.1
```

**Version verification:** `curl -s https://pypi.org/pypi/cryptography/json` this session — latest
version `50.0.1`, uploaded 2026-08-25. [VERIFIED: PyPI JSON API, fetched this session]. Not yet a
project dependency — `pyproject.toml`'s current `[project.dependencies]` list does not include it;
this phase adds it for the first time.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `cryptography` | PyPI | **First release 2014-01-08 — 12.6 years, 159 total releases** [VERIFIED: PyPI JSON API `releases` object, fetched this session] | Unknown to the automated seam (metadata gap, not a real signal — see below) | `https://github.com/pyca/cryptography/` [VERIFIED: PyPI `project_urls.source`, fetched this session] | **SUS (automated) → OK (manual override, evidenced)** | Approved with evidence; see note |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `cryptography` — flagged by the automated legitimacy
seam (`gsd_run query package-legitimacy check`) for `too-new`, `unknown-downloads`,
`no-repository`. **This is a false positive from the heuristic, not a real risk signal**, for a
documented reason: the seam's `publishedAt` field reads the *latest release's* upload timestamp
(50.0.1, uploaded 2026-08-25 — six days before this research), not the package's first-ever
release, and its repo-detection apparently checks `info.home_page` (which PyPI now reports `null`
for this package) rather than `info.project_urls.source`/`.homepage`, both of which resolve to the
canonical `github.com/pyca/cryptography` [VERIFIED: PyPI JSON API `project_urls`, fetched this
session]. `cryptography` is maintained by the Python Cryptographic Authority, has shipped 159
releases since 2014, and is already the locked stack decision in this project's own
`.claude/CLAUDE.md`. Per the Package Legitimacy Gate protocol, the SUS verdict is still recorded
here rather than silently overridden — **the planner should add a `checkpoint:human-verify` task
before the install**, but the verification work is already done and attached above, so that
checkpoint should be a fast confirm, not new research.

*No other packages are newly introduced by this phase.* `argon2-cffi`, `sqlalchemy`, `alembic`,
`asyncpg`, `psycopg` are all already project dependencies from Phases 1-2.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │              API process (app tier)          │
                     │                                               │
  caller (Phase 5/6) │  Decimal / str  ┌──────────────┐              │
  ─────────────────► │ ───────────────►│ insert_fills()│              │
                     │                 │ (single write │              │
                     │                 │  path, D3-13) │              │
                     │                 └──────┬───────┘              │
                     │                        │ calls                │
                     │                 ┌──────▼───────┐              │
                     │                 │ encrypt_field()│◄── DEK (unwrapped
                     │                 │ crypto/envelope│    in-process only,
                     │                 └──────┬───────┘    never persisted
                     │                        │ (ciphertext, nonce)   raw)
                     │                 ┌──────▼───────────────┐      │
                     │                 │ SQLAlchemy INSERT      │      │
                     │                 │ (plaintext cols verbatim,     │
                     │                 │  ciphertext/nonce cols bytea) │
                     │                 └──────┬───────────────┘      │
                     └────────────────────────┼──────────────────────┘
                                               │  morai_app role (RLS-scoped,
                                               │  NOSUPERUSER NOBYPASSRLS)
                                    ┌──────────▼──────────────┐
                                    │   Postgres (storage tier) │
                                    │                            │
                                    │  fills / legs / positions / │
                                    │  events (plaintext + bytea) │
                                    │  user_data_keys (wrapped DEK)│
                                    │  RLS: ENABLE + FORCE,        │
                                    │  user_id-scoped policy       │
                                    └──────────┬────────────────┘
                                               │  pg_dump (criterion 1)
                                    ┌──────────▼────────────────┐
                                    │  dump / restore / grep test │
                                    │  runs with NO KEK in its    │
                                    │  own environment — proves   │
                                    │  the dump alone is inert    │
                                    └──────────────────────────┘

  Read path (Phase 5's reconciliation, Phase 9):
  SQL selects the WINDOW using plaintext (user_id, execution_time) only
  → rows (ciphertext + nonce + key_version) cross back into the app tier
  → decrypt_field() per row, using the DEK for that row's key_version
  → SUM happens in Python (D3-04) — never in SQL.
```

### Recommended Project Structure

```
src/morai/
├── crypto/                 # NEW this phase
│   ├── __init__.py
│   └── envelope.py         # generate_dek, wrap_dek, unwrap_dek, encrypt_field,
│                            # decrypt_field. The ONLY module that imports AESGCM.
├── ledger/                 # NEW this phase
│   ├── __init__.py
│   ├── models.py           # or extend db/models.py -- see Pitfall 6
│   └── writes.py           # insert_fills() -- the single write path (D3-13)
├── db/
│   └── models.py           # extend with Fill/Leg/Position/Event/UserDataKey,
│                            # OR split -- see Pitfall 6 for the tradeoff
alembic/versions/
└── 0007_ledger_schema_and_envelope_encryption.py   # next revision after 0006
tests/
├── crypto/
│   └── test_envelope.py    # AESGCM round-trip, nonce-uniqueness query, AAD binding
├── ledger/
│   ├── test_fill_composite_key.py     # NN-1 proof against oracle fixtures
│   ├── test_roll_check_constraint.py  # D3-09 DDL proof
│   └── test_isolation.py              # RLS six-guard pattern, mirrors tests/test_isolation.py
├── test_pg_dump_confidentiality.py    # criterion 1, restore-and-compare-bytes
├── test_key_rotation.py               # criterion 3, byte-identical ciphertext proof
├── test_crypto_shred.py               # criterion 5, AUTH-06
└── gate/fixtures/
    └── violation_second_fill_writer.py  # D3-13's type-gate negative control
```

### Pattern 1: Envelope encryption primitives (`crypto/envelope.py`)

**What:** Every function this module exposes takes and returns plain `bytes`/`Decimal`/`str`, never an `AESGCM` instance — callers never touch the primitive directly (mirrors `money/units.py`'s "one conversion function, nothing else belongs here" discipline).

**When to use:** Any code that needs to turn a `Decimal` or `str` field into a stored ciphertext, or back.

**Example** (API verified against `cryptography.io`'s official docs, fetched via `curl` this session — not paraphrased by a summarizing tool, per this project's own `V065`):
```python
# Source: cryptography.io/en/latest/hazmat/primitives/aead/ (fetched via curl this session)
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def generate_dek() -> bytes:
    """A fresh 256-bit data-encryption key. CRYPT-01, D3-05."""
    return AESGCM.generate_key(bit_length=256)

def wrap_dek(dek: bytes, kek: bytes) -> tuple[bytes, bytes]:
    """Wrap a DEK under the KEK. Returns (wrapped_dek, wrap_nonce)."""
    nonce = os.urandom(12)
    return AESGCM(kek).encrypt(nonce, dek, None), nonce

def unwrap_dek(wrapped_dek: bytes, wrap_nonce: bytes, kek: bytes) -> bytes:
    return AESGCM(kek).decrypt(wrap_nonce, wrapped_dek, None)

def encrypt_field(plaintext: bytes, dek: bytes, associated_data: bytes) -> tuple[bytes, bytes]:
    """One fresh nonce per call -- never per row, never per user, never reused
    (see Pitfall 3). Returns (ciphertext_with_16_byte_tag, nonce)."""
    nonce = os.urandom(12)
    return AESGCM(dek).encrypt(nonce, plaintext, associated_data), nonce

def decrypt_field(ciphertext: bytes, nonce: bytes, dek: bytes, associated_data: bytes) -> bytes:
    """Raises cryptography.exceptions.InvalidTag if the ciphertext, nonce, key
    or associated_data is wrong -- including a ciphertext copied from a
    different row (see Pitfall 4, associated_data binding)."""
    return AESGCM(dek).decrypt(nonce, ciphertext, associated_data)
```
Confirmed from the official docs text (verbatim, fetched this session): `encrypt(nonce, data,
associated_data)` returns "the ciphertext bytes with the 16 byte tag appended" — no separate tag
column is needed. `nonce` is documented as "NIST recommends a 96-bit IV length for best
performance... NEVER REUSE A NONCE with a key." `decrypt` raises
`cryptography.exceptions.InvalidTag` "when the ciphertext has been changed, but... also... when
the key, nonce, or associated data are wrong" [VERIFIED: cryptography.io/en/latest/hazmat/primitives/aead/].

### Pattern 2: Every money/text field gets its own `(ciphertext, nonce)` column pair, one `key_version` per row

**What:** D3-01/D3-03/D3-07/D3-12, made concrete as DDL.

```sql
-- alembic/versions/0007_ledger_schema_and_envelope_encryption.py (upgrade())

-- One wrapped DEK per (user, key_version). A row is added, never edited in
-- place, on rotation of the *user's own* DEK (rare, offline, D3-05's own
-- reasoning in .claude/CLAUDE.md §6). KEK rotation re-wraps in place (Pattern 4)
-- and does NOT add a new key_version row -- the DEK bytes are unchanged.
CREATE TABLE user_data_keys (
    user_id      uuid NOT NULL REFERENCES users(id),
    key_version  smallint NOT NULL DEFAULT 1,
    wrapped_dek  bytea NOT NULL,
    wrap_nonce   bytea NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key_version)
);

CREATE TABLE positions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id),
    opened_at   timestamptz,
    closed_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id  uuid NOT NULL REFERENCES positions(id),
    user_id      uuid NOT NULL REFERENCES users(id),
    leg_role     text NOT NULL,   -- 'front' | 'back'
    occ_symbol   text NOT NULL,   -- plaintext by design (D3-02)
    root         text NOT NULL,   -- 'SPX' (AM) | 'SPXW' (PM) -- settlement style
                                    -- discriminator per analyzer-and-journal-spec.md §5.4
    UNIQUE (position_id, leg_role)
);

-- The composite key is NN-1's whole argument, verified against all 52 real
-- oracle fills this session (see Common Pitfalls / Pitfall 5).
CREATE TABLE fills (
    user_id             uuid NOT NULL REFERENCES users(id),
    order_id            text NOT NULL,           -- plaintext (D3-02)
    occ_symbol          text NOT NULL,            -- plaintext (D3-02)
    leg_index           smallint NOT NULL,        -- plaintext, defensive (NN-1)
    execution_time      timestamptz NOT NULL,     -- plaintext (D3-02)
    position_effect     text NOT NULL,            -- plaintext -- LEDGER-02 needs
                                                    -- it queryable, D3-02
    quantity_ciphertext bytea NOT NULL,            -- CRYPT-02: quantity is encrypted
    quantity_nonce      bytea NOT NULL,
    price_usd_ciphertext bytea NOT NULL,
    price_usd_nonce     bytea NOT NULL,
    key_version         smallint NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, order_id, occ_symbol, leg_index, execution_time)
);

CREATE TABLE events (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     uuid NOT NULL REFERENCES users(id),
    position_id                 uuid NOT NULL REFERENCES positions(id),
    event_type                  text NOT NULL
                                 CHECK (event_type IN ('OPEN','CLOSE','ROLL','SETTLEMENT')),
    event_time                  timestamptz NOT NULL,   -- plaintext (D3-02)
    fill_ids_hash                text,                    -- plaintext join key,
                                                            -- LEDGER-09 idempotent re-derivation
    open_debit_usd_ciphertext   bytea,   -- NULL for non-ROLL events that never open
    open_debit_usd_nonce        bytea,
    close_credit_usd_ciphertext bytea,   -- NULL for non-ROLL events that never close
    close_credit_usd_nonce      bytea,
    key_version                 smallint NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    -- D3-09, LEDGER-04, criterion 4. See Pitfall 7 for exactly what this does
    -- and does not catch.
    CONSTRAINT roll_has_both_legs CHECK (
        event_type <> 'ROLL'
        OR (open_debit_usd_ciphertext IS NOT NULL AND close_credit_usd_ciphertext IS NOT NULL)
    )
);
```

`side` (buy/sell) is **not** in D3-02's enumerated plaintext-by-design list (`user_id, order_id,
occ_symbol, position_effect`, timestamps, join keys, `event_type`), and CRYPT-02 enumerates
"prices, quantities, P&L, and free-text" — not `side`. This research recommends `side` stay
plaintext (it is a two-value categorical field that reveals no dollar amount or position size on
its own, and Rule 1 of the fill-pairing algorithm, salvage/oracle-fixtures.md, only ever compares
it to itself, never joins on it), but flags this explicitly as **Claude's discretion, not a locked
D3 decision** — CONTEXT.md's plaintext enumeration does not name `side` either way.

### Pattern 3: `key_version` tracks the **DEK**, not the KEK

**What:** D3-07's `key_version` column identifies which row of `user_data_keys` (i.e. which
generation of that *user's own* DEK) encrypted a given row. KEK rotation (Pattern 4) never touches
`key_version` on trade rows at all, because it re-wraps the *same* DEK bytes — a rotated KEK
changes how the DEK is wrapped, never what the DEK is. This is the mechanism behind criterion 3's
"versioned rows still read under the key they were written with": after a KEK rotation, a fill's
`key_version` still points at the same `user_data_keys` row, whose unwrapped DEK bytes are
byte-identical to before.

**When to use:** Every encrypted-field write reads the user's *current* `key_version` (the highest
row in `user_data_keys` for that `user_id`) and stamps it onto the new row. A DEK rotation (rare,
offline, D3-05) inserts a new `key_version` row and re-encrypts existing ciphertext in batches
(`NN-5`, ≤2,000 rows) under the new DEK, updating `key_version` on each migrated row.

### Pattern 4: KEK rotation re-wraps `user_data_keys` only

**What:** For every row in `user_data_keys`: unwrap `wrapped_dek` with the OLD KEK, re-wrap with
the NEW KEK, write back `wrapped_dek`/`wrap_nonce`. **No table other than `user_data_keys` is
touched.**

```python
# Source: this research, following cryptography.io's documented AESGCM.encrypt/decrypt
async def rotate_kek(session: AsyncSession, old_kek: bytes, new_kek: bytes) -> None:
    rows = await session.execute(select(UserDataKey))
    for row in rows.scalars():
        dek = unwrap_dek(row.wrapped_dek, row.wrap_nonce, old_kek)
        wrapped, nonce = wrap_dek(dek, new_kek)
        row.wrapped_dek, row.wrap_nonce = wrapped, nonce
    await session.commit()
```

Cheap by construction: "a handful of users" (`.claude/CLAUDE.md`) means a handful of `AESGCM`
operations, not a batch job. This is an operator-run script (`L018`'s "bulk operation belongs in
an operator CLI, not a queue job" pattern — though at this row count the distinction barely
matters), invoked with the old and new KEK as explicit parameters (env vars or CLI args), not
persisted anywhere. **This research recommends against persisting a `kek_version` column at
all** — with exactly one live KEK at any time and a single-invocation rotation script, there is no
concurrent multi-KEK window to track, and a persisted `kek_version` would be complexity with no
consumer (ponytail: skipped, add if the KEK is ever moved to a multi-key KMS where more than one
KEK can be live at once — `.claude/CLAUDE.md`'s own noted future revisit for the KEK's location).

**The proof for criterion 3** ("versioned rows still read under the key they were written with"):
a test that encrypts a known `Decimal`, records the exact ciphertext bytes, calls `rotate_kek`,
then asserts (a) the trade-table ciphertext bytes are **byte-identical** before and after, and (b)
`decrypt_field` on that row, using the newly-unwrapped DEK, still returns the original `Decimal`.

### Pattern 5: RLS on every new table — the exact migration-0003 shape, no admin clause

**What:** D3-18, following `alembic/versions/0003_identity_and_rls.py` verbatim.

```sql
-- for EACH of: user_data_keys, positions, legs, fills, events
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY user_isolation ON <table>
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO morai_app;
```

**Deliberately no admin clause on any of these tables** — `identity/audit.py`'s own docstring
states this precisely: "a future data table that inherits [`users`' admin clause] makes Phase 3's
encryption boundary decorative" [VERIFIED: src/morai/identity/audit.py:29-32]. `legs` has no
independent `user_id` value of its own beyond what it inherits from its parent `position` — it is
still given an explicit `user_id` column (denormalized) so its own RLS policy does not need a join
to `positions` to evaluate, matching `gate_user_scoped_probe`'s existing shape rather than
inventing a join-based policy pattern this codebase has not used yet.

### Pattern 6: The single write path, enforced by the type gate (D3-13)

**What:** `insert_fills()` is the only public entry into the `fills` table. Blocking a *second*
`insert_fills`-shaped function is a code-review concern, not this pattern's job — what the type
gate can mechanically block is a caller who tries to construct a `Fill` ORM instance directly
(`Fill(...)`/`session.add(Fill(...))`), bypassing `insert_fills()` and its mandatory
`encrypt_field()` call (D3-15).

The `AuditedRead` sentinel-token pattern (`src/morai/identity/audit.py`, already proven in this
codebase) generalizes directly, applied to the ORM model's own `__init__` rather than a plain
dataclass:

```python
# Source: this research, extending the AuditedRead pattern in identity/audit.py
_FILL_WRITE_SENTINEL = object()

class Fill(Base):
    __tablename__ = "fills"
    # ... Mapped[] columns ...

    def __init__(self, *, _write_token: object = None, **kwargs: object) -> None:
        if _write_token is not _FILL_WRITE_SENTINEL:
            raise RuntimeError(
                "Fill must be constructed by insert_fills() -- constructing "
                "one directly bypasses encryption (D3-13, D3-15)."
            )
        super().__init__(**kwargs)
```

**Why this is safe for normal reads:** SQLAlchemy's ORM does **not** call `__init__` when
reconstructing objects from a query result — it uses `__new__` plus direct attribute restoration
(the same low-level mechanism `pickle` uses), documented via `InstanceEvents.load()` /
`@reconstructor()` as the hook for load-time logic instead of `__init__`
[CITED: docs.sqlalchemy.org/en/13/orm/constructors.html, corroborated by WebSearch this session —
this is long-standing, stable SQLAlchemy ORM behavior, not something specific to 1.3]. A `SELECT`
that loads `Fill` rows is unaffected; only application code that tries to *construct* a new `Fill`
directly is gated.

**The negative-control fixture**, following `tests/gate/fixtures/violation_unaudited_read.py`'s
own shape exactly:
```python
# tests/gate/fixtures/violation_second_fill_writer.py
"""Deliberate negative control (D-07). Do not fix.

Constructing a Fill directly bypasses insert_fills() -- the single write path
into the fill table (D3-13, D3-15). Excluded from the real gate's own run
(see pyproject.toml).
"""
from morai.db.models import Fill

def _build() -> Fill:
    return Fill(user_id=..., order_id="1", occ_symbol="SPXW260618P07275000", ...)
```
This fixture omits the required `_write_token` keyword argument, which both basedpyright and mypy
should reject as a missing-argument error (basedpyright's `reportCallIssue`; mypy's `call-arg`).
**Confidence note:** this exact marker pairing is reasoned by analogy to the codebase's own
established pattern and to each checker's documented diagnostic taxonomy, not executed against a
real checker this session (the `Fill` model does not exist yet to test against). Per this
project's own `test_type_gate.py` docstring discipline — "a bare exit-code assertion would pass on
a syntax error... the marker is what proves the *right* guard fired" — the executor implementing
this fixture must run the real checker and pin whatever marker it actually names, exactly as every
other case in that file already does. Tag: `[ASSUMED: exact diagnostic marker name]`.

### Anti-Patterns to Avoid

- **One nonce reused across multiple ciphertext columns on the same row.** `open_debit_usd_nonce`
  and `close_credit_usd_nonce` on one `events` row are both encrypted under the *same* user's
  *same* `key_version` DEK — reusing one `os.urandom(12)` call for both would violate GCM's
  "never reuse a nonce with a key" invariant even though they are different *columns*. Generate a
  fresh nonce per `encrypt_field()` call, always, never per row.
- **Grepping a `pg_dump` file for a plaintext literal.** See Pitfall 1 — this passes even on a
  total encryption failure, because `bytea` dumps as hex text.
- **A `CHECK` constraint that tries to inspect a decrypted value.** Postgres cannot decrypt; a
  `CHECK` on an encrypted column can only test presence/absence, never a numeric relationship. See
  Pitfall 3.
- **Persisting the raw DEK anywhere, ever — including in a log line, an error message, or a test
  fixture committed to git.** Only the *wrapped* DEK is ever written to Postgres.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AEAD cipher construction | A hand-rolled AES-CTR + HMAC composition | `cryptography`'s `AESGCM` | GCM's authenticated-encryption composition (encrypt-then-MAC via GHASH) is exactly the kind of thing `.claude/CLAUDE.md` already forbids hand-rolling, and ASVS 5.0 `11.2.1`/`11.3.2` require an industry-validated implementation with an approved mode. |
| Key wrapping | A custom key-wrap format (length-prefixed concatenation, XOR-based) | `AESGCM(kek).encrypt(nonce, dek, None)` | The DEK is just another 32 bytes of "data" to `AESGCM` — no separate "key wrap algorithm" (e.g. RFC 3394 AES-KW) is needed when the wrapping primitive is already an AEAD cipher with its own nonce and tag. |
| Ciphertext-to-row binding | Nothing (bare ciphertext with no context check) | `associated_data` on every `encrypt_field`/`decrypt_field` call | See Pitfall 4 — this is a real, cheap defense against a ciphertext-substitution attack that a bare `bytea` column has no other protection against. |
| Duplicate-nonce detection | An application-level in-memory nonce cache | A SQL `GROUP BY ... HAVING COUNT(*) > 1` query over every ciphertext column's nonce, unioned (see Pitfall 3) | The invariant is a property of what's stored, not of what one process has seen — an app-level cache is blind across restarts and across the worker/web process split this project already has. |

**Key insight:** every one of the "don't hand-roll" items above already has a locked answer in
this project's own prior research (`.claude/CLAUDE.md` §6, "What NOT to Use"). This phase's job is
applying that decision to a concrete schema, not re-deciding it.

## Common Pitfalls

### Pitfall 1: A `pg_dump`-and-grep test can pass on a total encryption failure

**What goes wrong:** `pg_dump`'s plain SQL format writes `bytea` columns as `\x` + hex digits
inside a `COPY ... FROM stdin` block. A raw plaintext string stored with **zero encryption**
therefore never appears as its own ASCII substring in the dump — only its hex encoding does. A
test that does `grep "1234.5678" dump.sql` will report success (string not found) even when the
column holds the literal unencrypted value.

**Why it happens:** `pg_dump`'s text-format encoding of binary data is a Postgres implementation
detail unrelated to whether encryption ran. The two facts ("the value is unencrypted" and "the
value's ASCII bytes are a substring of the dump file") are independent, and it is easy to conflate
them when writing the test.

**How to avoid:** **Verified live this session** — inserted the literal UTF-8 bytes of
`PLAINTEXT_LEAK_MARKER_98765.4321` directly into a `bytea` column with no encryption, ran a real
`pg_dump --format=plain`, and grepped the output for that marker: **zero matches**. The dump
instead contained `\x504c41494e544558545f4c45414b5f4d41524b45525f39383736352e34333231`, confirmed
byte-for-byte equal to `"PLAINTEXT_LEAK_MARKER_98765.4321".encode('utf-8').hex()`. Two correct test
shapes, either is sufficient:
1. Restore the dump into a scratch database, then read the `bytea` column back through
   `asyncpg`/`psycopg` (which decode `bytea` to real Python `bytes`, not hex text) and assert the
   known plaintext bytes are not a substring of the raw ciphertext bytes.
2. Grep the dump file for the plaintext's **hex encoding** (`plaintext.encode().hex()`), not the
   plaintext itself.
CONTEXT.md's own `<specifics>` already point at option 1 ("a real pg_dump, restored... then
grepped") — this finding confirms *what* "grepped" must mean for that instruction to actually
prove anything, and confirms it as a Python-bytes comparison after restore, not a naive dump-file
text grep.

**Warning signs:** A dump-confidentiality test that passes on the very first run, before any
encryption code has been written, is not testing what it claims to.

### Pitfall 2: The `(key, nonce)` uniqueness invariant must be checked across **every** ciphertext column, unioned — not once per column

**What goes wrong:** Checking each encrypted column's nonce column independently for duplicates
(`SELECT nonce, COUNT(*) FROM fills GROUP BY nonce HAVING COUNT(*)>1`, run separately against
`quantity_nonce`, `price_usd_nonce`, `open_debit_usd_nonce`, ...) misses the case where the *same*
nonce value was independently generated for *two different columns* on rows encrypted under the
*same* user's *same* `key_version` — which is exactly a nonce reuse under one key, since GCM's
uniqueness requirement is scoped to `(key, nonce)`, not `(key, column, nonce)`.

**How to avoid:**
```sql
WITH all_nonces AS (
  SELECT user_id, key_version, quantity_nonce      AS nonce FROM fills  WHERE quantity_nonce IS NOT NULL
  UNION ALL
  SELECT user_id, key_version, price_usd_nonce      AS nonce FROM fills  WHERE price_usd_nonce IS NOT NULL
  UNION ALL
  SELECT user_id, key_version, open_debit_usd_nonce  AS nonce FROM events WHERE open_debit_usd_nonce IS NOT NULL
  UNION ALL
  SELECT user_id, key_version, close_credit_usd_nonce AS nonce FROM events WHERE close_credit_usd_nonce IS NOT NULL
  -- one UNION ALL branch per encrypted column, across every encrypted table
)
SELECT user_id, key_version, nonce, COUNT(*)
FROM all_nonces
GROUP BY user_id, key_version, nonce
HAVING COUNT(*) > 1;
-- criterion 1 requires this to return zero rows
```
`[ASSUMED: not executed this session — elementary GROUP BY/HAVING, reasoned from the schema design above rather than run against seeded data]`.

**The birthday-bound number, not a vibe (research question 2):** NIST SP 800-38D §8.3 states, in
its own words, fetched and read directly from the primary PDF this session: *"The total number of
invocations of the authenticated encryption function shall not exceed 2^32, including all IV
lengths and all instances of the authenticated encryption function with the given key"*
[VERIFIED: nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf, page 21, §8.3,
fetched via curl and read directly this session]. 2^32 ≈ 4.29 billion encryptions under one DEK.
This project's realistic ceiling — a handful of users, generously 5,000 fills/user/year, ~10
encrypted fields/fill, over a 10-year horizon — is on the order of 2.5×10^5 to 5×10^5 encryptions
per user's DEK, roughly **13,000× below** the NIST ceiling. The birthday-bound collision
probability at that scale is `n²/(2×2^96)` ≈ `(5×10^5)² / (2×7.92×10^28)` ≈ 1.6×10^-18 — vanishing.
**A monotonic counter nonce is not justified at this scale**; `os.urandom(12)` per field is
sufficient, HIGH confidence.

### Pitfall 3: A `CHECK` constraint on an encrypted column can only prove NULL-ness, never a value

**What goes wrong (the direct answer to research question 7):** `roll_has_both_legs` (Pattern 2)
proves that a `ROLL` event row **cannot be stored** with only one of `open_debit_usd_ciphertext` /
`close_credit_usd_ciphertext` populated — which is precisely the historical failure shape this
project is guarding against (`analyzer-and-journal-spec.md` §5.2: "a compound event that nets its
two legs into one number loses information... a compound event keeps its split"). **What it does
not, and structurally cannot, catch:** whether the *decrypted value* inside either ciphertext is
correct, or whether application code accidentally encrypted an already-netted figure into one
field while writing a placeholder non-null value into the other. Postgres never sees plaintext; a
`CHECK` expression has no way to compare, bound, or validate a value it cannot read. That semantic
correctness is entirely the responsibility of the single write path (`insert_fills`/its
`events`-table equivalent, D3-13) and the tests that exercise it (the 13-calendar oracle,
LEDGER-11, Phase 5). This is not a gap in the constraint — it is the honest limit of what a
database-level guard can do against ciphertext, and criterion 4's own wording ("rejected by a
database `CHECK` constraint, not by application code a later caller could bypass") is satisfied:
the *structural* failure mode (one field silently missing) is now impossible to store regardless
of which caller writes the row; the *semantic* failure mode (wrong-but-present values) was never
claimed to be a `CHECK`'s job.

### Pitfall 4: A bare ciphertext column has no defense against being copied into a different row

**What goes wrong:** Without `associated_data`, a `bytea` value that decrypts correctly for row A
also decrypts correctly if copied (by a bug, or by someone with write access to a stolen dump who
also somehow obtains the DEK) into row B of the same column, on the same user, under the same
`key_version` — GCM's authentication tag proves the bytes were produced by *some* legitimate
encryption under that key, not that they belong in *this* row.

**How to avoid:** Bind every `encrypt_field`/`decrypt_field` call to an `associated_data` value
derived from the row's own identity and the column being encrypted — for example
`f"{table_name}:{column_name}:{primary_key_repr}".encode()`. `AESGCM.decrypt` raises `InvalidTag`
"when... the key, nonce, or **associated data** are wrong" [VERIFIED: cryptography.io docs, fetched
this session] — a ciphertext copied to the wrong row now fails to decrypt instead of silently
returning a plausible wrong number. **This is this research's own recommendation, not a locked D3
decision** — CONTEXT.md does not mention `associated_data` binding. Flagged for the planner as a
concrete, low-cost strengthening of D3-01's per-column design; the exact AAD string format is an
implementation detail to fix once and record in the migration (the same discipline D3-02 already
applies to *why* each plaintext column exists).

### Pitfall 5: The composite key needs `leg_index`/`execution_time` for cases the oracle does not exercise

**Verified this session, by hand, against all 52 real fills in `salvage/oracle-fixtures.md`:**
every one of the 25 real broker orders in the 13 oracle calendars contains fills whose
`occ_symbol` values are **pairwise distinct within that order** — including the four-leg shared
order (`1006797510202`, closing `60c46a57` and opening `24f1e72e` at once) and the two calendars
sharing front-leg contract `SPXW 260618P07275000` (`8a63aa81`/`6303e6af`, resolved by their
*different* `order_id`s, not by `occ_symbol`). So `(user_id, order_id, occ_symbol)` alone already
discriminates all 52 real fills with zero collisions — the oracle does not, by itself, force the
need for `leg_index` or `execution_time`.

Both are still correctly required, per `NN-1`'s own doctrine ("it never varies today is not it can
never vary"): a **partial fill** — the same logical leg reported by Schwab as two separate
transaction records because it filled in two prints — would produce two rows sharing
`(order_id, occ_symbol)` but differing in `execution_time`, which the oracle's fixtures (qty
always 1, no partial fills) never exercise. `leg_index` guards the residual case of two
`transferItem`s for the same `occ_symbol` inside one order sharing an identical `execution_time`
(a raw-payload structural possibility, not something confirmed against a live Schwab response this
session — `[ASSUMED: Schwab's exact multi-leg transferItem timestamp granularity]`, flagged for
confirmation once Phase 4/6 has a live connection).

### Pitfall 6: `db/models.py`'s own comments require dropping two tables this phase

**What goes wrong if missed:** silently leaving two probe tables in the schema past the phase that
was supposed to retire them, breaking the obligation the code itself states.

**Verified, exact quotes:**
- `GateMoneyProbe`: *"Phase 3 drops this table with an explicit migration when the real schema
  lands."* [VERIFIED: src/morai/db/models.py:5-6]
- `GateUserScopedProbe`: *"**Phase 3 must drop this table with an explicit migration** once real
  trading tables exist to prove isolation against instead."* [VERIFIED: src/morai/db/models.py:113-119]

**How to avoid:** the migration that lands `fills`/`legs`/`positions`/`events`/`user_data_keys`
must also `DROP TABLE gate_money_probe` and `DROP TABLE gate_user_scoped_probe` (with matching
`GRANT`/policy teardown, mirroring migration 0003's own `downgrade()` cleanup order), and
`db/models.py` must remove the `GateMoneyProbe`/`GateUserScopedProbe` classes in the same change.
`tests/test_isolation.py` and any test importing these two models will need updating in the same
plan — grep every consumer first (`L009`).

### Pitfall 7: Where the new tables live in `db/models.py` is a real tradeoff, not a formality

**What goes wrong:** blindly appending five new table classes to the existing single
`db/models.py` file risks the file becoming a 300+ line grab-bag with no organizing principle,
while splitting into a new `crypto`/`ledger` module tree risks inconsistency with the
one-file-per-concern-so-far convention this project has used through Phases 1-2 (six tables, one
file).

**How to avoid:** This research recommends extending `db/models.py` for the new SQLAlchemy models
(keeping the established single-source-of-truth-for-the-schema pattern), while putting the
*behavior* — `crypto/envelope.py`'s wrap/encrypt functions and `ledger/writes.py`'s
`insert_fills()` — in new, purpose-named modules (mirroring how `money/units.py` holds behavior
while `db/models.py` holds only declarative shape). This is a discretion call for the planner, not
a locked decision; either organization is defensible, and the wrong one costs a refactor, not a
correctness bug.

## Code Examples

### The two SQL queries (research question 4) — executed against real Postgres 18.6 this session

**Setup:** a scratch schema seeded with the real occ_symbols, order_ids, and dates from oracle
calendars `8a63aa81` and `6303e6af` (`salvage/oracle-fixtures.md`), using only the plaintext
columns D3-02 proposes: `user_id`, `order_id`, `occ_symbol`, `leg_index`, `execution_time`,
`position_effect` (for `fills`) and `user_id`, `position_id`, `event_type`, `event_time` (for
`events`). No `bytea` column was created or needed to prove either query.

**Query 1 — shared-front-leg disambiguation (order-anchor resolution, Rule 3 of
`salvage/oracle-fixtures.md`):**
```sql
-- Source: this research, executed against local Postgres 18.6 this session
WITH position_legs AS (
  SELECT id AS position_id, user_id, front_occ_symbol AS occ_symbol FROM positions
  UNION ALL
  SELECT id AS position_id, user_id, back_occ_symbol  AS occ_symbol FROM positions
),
fill_candidates AS (
  SELECT f.user_id, f.order_id, f.occ_symbol, f.leg_index, f.execution_time, pl.position_id
  FROM fills f
  JOIN position_legs pl ON pl.user_id = f.user_id AND pl.occ_symbol = f.occ_symbol
),
anchors AS (   -- an (order, occ_symbol) is an anchor iff it has exactly one candidate position
  SELECT user_id, order_id, occ_symbol, MIN(position_id) AS position_id
  FROM fill_candidates GROUP BY user_id, order_id, occ_symbol
  HAVING COUNT(DISTINCT position_id) = 1
),
order_anchors AS (SELECT DISTINCT user_id, order_id, position_id FROM anchors)
SELECT fc.order_id, fc.occ_symbol, fc.leg_index,
  (SELECT oa.position_id FROM order_anchors oa
    WHERE oa.user_id = fc.user_id AND oa.order_id = fc.order_id
      AND oa.position_id IN (SELECT position_id FROM fill_candidates fc2
                               WHERE fc2.user_id=fc.user_id AND fc2.order_id=fc.order_id
                                 AND fc2.occ_symbol=fc.occ_symbol AND fc2.leg_index=fc.leg_index
                                 AND fc2.execution_time=fc.execution_time)
  ) AS resolved_position_id
FROM fill_candidates fc
GROUP BY fc.user_id, fc.order_id, fc.occ_symbol, fc.leg_index, fc.execution_time;
```
**Result, verified this session:** all 8 fills across the two shared-front-leg calendars resolved
correctly — the ambiguous shared symbol `SPXW260618P07275000` (2 candidates in every order)
correctly anchored to `8a63aa81` in orders `1006681717677`/`1006687566650` and to `6303e6af` in
orders `1006417446601`/`1006622444775`, matching the oracle's documented expected resolution
exactly.

**Query 2 — reconciliation window (row selection only; the sum happens in Python after decrypt,
D3-04):**
```sql
-- Source: this research, executed against local Postgres 18.6 this session
SELECT user_id, position_id, event_type, event_time
FROM events
WHERE user_id = :user_id
  AND event_time >= :window_start
  AND event_time <  :window_end
ORDER BY event_time;
```
**Result, verified this session:** correctly returned exactly the 3 events falling inside a June
2026 window (`6303e6af` CLOSE on Jun 5, `8a63aa81` OPEN on Jun 9, `8a63aa81` CLOSE on Jun 10),
correctly excluding `6303e6af`'s OPEN on May 19 — proving the window boundary works against
plaintext timestamps with no ciphertext column touched.

**D3-02's plaintext set is sufficient for both queries this project's own success criteria name.**
No revision to the plaintext column list is needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| OWASP ASVS 4.0.3's chapter numbering (`V6` Stored Cryptography, `V8` Data Protection) | OWASP ASVS 5.0's renumbering: **`V11` Cryptography, `V14` Data Protection, `V8` Authorization** | ASVS 5.0.0 released May 2025 [VERIFIED: raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/, directory listing fetched this session] | This document's own `output_format` template example uses the *old* (4.0) numbering (`V2` Auth, `V6` Cryptography). The Security Domain section below uses the *current* 5.0 numbers — do not cite `V6`/`V8` for cryptography/data-protection in any planning artifact without checking which ASVS version is meant. |
| `cryptography`'s `Fernet` as the default "just encrypt this" recipe | Direct `hazmat.primitives.ciphers.aead.AESGCM` for anything needing its own nonce/AAD discipline (key wrapping, per-column envelope encryption) | Not a version change — a shape-of-problem distinction already correctly made in `.claude/CLAUDE.md`'s own Alternatives table | Re-confirmed, not re-litigated, this session. |

**Deprecated/outdated:** none directly encountered in this narrow domain beyond the ASVS
renumbering above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `side` (buy/sell) should stay plaintext rather than encrypted | Pattern 2 | Low — CRYPT-02 doesn't name it either way; if wrong, it's a one-column migration to add ciphertext/nonce, not a design failure. |
| A2 | The `(key,nonce)` uniqueness UNION query (Pitfall 2) is correct SQL | Pitfall 2 | Low — elementary GROUP BY/HAVING over a UNION ALL, not executed against seeded data this session (no ciphertext columns exist yet to seed). Should be run for real once the migration lands. |
| A3 | basedpyright reports `reportCallIssue` and mypy reports `call-arg` for a missing required keyword argument on the `Fill.__init__` sentinel gate | Pattern 6 | Medium — if the actual marker differs, the gate test's assertion needs a one-line marker-name fix, not a redesign; `test_type_gate.py`'s own discipline already requires running the real checker to pin the marker before trusting it. |
| A4 | Schwab's raw multi-leg transaction payload can produce two `transferItem`s for the same `occ_symbol` within one order sharing an identical `execution_time`, which is what `leg_index` defends against | Pitfall 5 | Low-Medium — this is why `leg_index` exists per NN-1's "defend before it's proven" doctrine; if Schwab's real payload never does this, `leg_index` is inert but harmless (a smallint column that's always `0`, same shape as `underlying` always being `SPX` in the historical `L001` example). Confirm against a live Schwab response once Phase 4/6 lands. |
| A5 | `associated_data` binding to row identity is worth the added design surface at this project's scale | Pitfall 4 | Low — this is an additive recommendation beyond the locked D3 decisions; skipping it does not violate any of the six success criteria, it only forgoes a defense against ciphertext substitution. |

## Open Questions

1. **Exact `associated_data` string format for row-binding (Pitfall 4).**
   - What we know: it should include table name, column name, and the row's own primary/natural
     key.
   - What's unclear: the exact serialization (delimited string vs. a stable JSON encoding), and
     whether it needs to be versioned itself if the primary key shape ever changes.
   - Recommendation: pick one format in the plan, document it in the migration next to D3-02's own
     column-provenance documentation, and treat it as part of the schema contract — changing it
     later requires re-encrypting every row (same cost class as a DEK rotation).

2. **Where `insert_fills()`'s equivalent for the `events` table lives, and whether it is the same
   function or a sibling.**
   - What we know: D3-13 names `insert_fills()` specifically; Phase 5 derives `events` from
     `fills`, which is out of this phase's scope.
   - What's unclear: whether Phase 3 needs an `insert_events()` write path too, or whether landing
     the `events` table with its `CHECK` constraint is sufficient and the write path itself is
     Phase 5's job (per the phase boundary: "the tables the ledger writes exist... and a fill can
     be written and read back through exactly one write path" — singular, naming fills only).
   - Recommendation: land the `events` table's DDL and `CHECK` constraint this phase (criterion 4
     requires it work), but treat a dedicated `insert_events()` gate as Phase 5's concern unless
     the planner judges otherwise — the phase's own stated boundary only names the fill table's
     write path.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Postgres | All new DDL, RLS, and query verification | ✓ | 18.6 (Homebrew) | — |
| `cryptography` (PyPI) | AES-256-GCM envelope encryption | Not yet installed in this venv — confirmed absent this session (`ModuleNotFoundError`) | 50.0.1 on PyPI, not yet in `pyproject.toml` | None needed — this phase's first task installs it. |
| `psql`/`pg_dump`/`pg_restore` (Homebrew `postgresql@18`) | Criterion 1's dump-and-restore test | ✓ (not on default `PATH` — must be added, e.g. `/opt/homebrew/opt/postgresql@18/bin`) | 18.6 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — `cryptography` is simply not yet added; no
alternative is needed since it is the already-locked stack choice.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0 (already configured, `pyproject.toml [tool.pytest.ini_options]`) |
| Config file | `pyproject.toml` (`[tool.pytest.ini_options]`), `tests/conftest.py` (env isolation, `migrated_db` fixture) |
| Quick run command | `uv run pytest -q tests/crypto tests/ledger -m db` |
| Full suite command | `uv run pytest -q` (~13s currently; expect a small increase from the new `db`-marked tests, still well under the 3-minute CI figure `CLAUDE.md` warns against relying on) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRYPT-01 | Each user gets a DEK at account creation, wrapped by an env-var KEK | unit + db | `pytest tests/crypto/test_envelope.py -x` | ❌ Wave 0 |
| CRYPT-02 | Prices/quantities/P&L/free-text stored encrypted | db | `pytest tests/ledger/test_fill_composite_key.py -x` | ❌ Wave 0 |
| CRYPT-03 | Plaintext column set documented + both SQL queries run | db | `pytest tests/ledger/test_plaintext_queries.py -x` | ❌ Wave 0 (queries themselves proven this session, see Code Examples — the test just needs to encode them) |
| CRYPT-04 | KEK rotation re-wraps DEKs only, byte-identical ciphertext | db | `pytest tests/test_key_rotation.py -x` | ❌ Wave 0 |
| CRYPT-05 | Real `pg_dump`, restored, no readable value; no `(key,nonce)` collision | db | `pytest tests/test_pg_dump_confidentiality.py -x` | ❌ Wave 0 |
| AUTH-06 | Account deletion destroys the DEK; rows decrypt to nothing | db | `pytest tests/test_crypto_shred.py -x` | ❌ Wave 0 |
| LEDGER-04 | `ROLL` `CHECK` constraint rejects a netted-only row | db | `pytest tests/ledger/test_roll_check_constraint.py -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the quick run above, scoped to the file(s) the task touched.
- **Per wave merge:** `uv run pytest -q` (full suite).
- **Phase gate:** `bash tools/gate.sh` (full suite + ruff + basedpyright + mypy) green before
  `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/crypto/test_envelope.py` — AESGCM round-trip, `InvalidTag` on tampered
      ciphertext/wrong AAD, nonce-uniqueness query (Pitfall 2)
- [ ] `tests/ledger/test_fill_composite_key.py` — seeds all 13 oracle calendars' fills through
      `insert_fills()` and asserts 52 rows, zero collisions, mirroring
      `salvage/oracle-fixtures.md`'s own stated invariants
- [ ] `tests/ledger/test_roll_check_constraint.py` — direct `INSERT` attempts proving the `CHECK`
      fires exactly on the netted-only shape and permits the both-populated shape
- [ ] `tests/ledger/test_plaintext_queries.py` — encodes the two queries proven in Code Examples
      (shared-front-leg disambiguation, reconciliation window) as executable tests, seeded from
      the same oracle fixtures used this session
- [ ] `tests/ledger/test_isolation.py` — the six-guard RLS pattern from `tests/test_isolation.py`,
      applied to `fills`/`positions`/`events`/`user_data_keys`
- [ ] `tests/test_pg_dump_confidentiality.py` — real `pg_dump` + restore-to-scratch-db + Python
      `bytes` comparison (Pitfall 1's corrected methodology)
- [ ] `tests/test_key_rotation.py` — byte-identical ciphertext before/after `rotate_kek`
- [ ] `tests/test_crypto_shred.py` — decrypt raises after DEK destruction, before row deletion
- [ ] `tests/gate/fixtures/violation_second_fill_writer.py` + a new parametrized case in
      `tests/gate/test_type_gate.py`
- [ ] Framework install: none — pytest/pytest-asyncio already present; `cryptography` is a
      runtime dependency, not a test dependency

## Security Domain

### Applicable ASVS Categories

**Using OWASP ASVS 5.0's current chapter numbering, confirmed against the live repository this
session** — not the older 4.0 numbering (see State of the Art table above).

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V11 Cryptography | yes | `cryptography`'s `AESGCM`, never hand-rolled (11.2.1, 11.2.3); AES-GCM specifically (11.3.1, 11.3.2, both Level 1); nonce/data-element uniqueness (11.3.4, Level 3 — this project meets it via criterion 1's own test, exceeding the configured Level 1 floor); documented key-management lifecycle (11.1.1, Level 2 — satisfied by this document plus the migration's own comments) |
| V14 Data Protection | yes | Sensitive-data classification into protection levels (14.1.1, Level 2) — directly satisfied by D3-02's plaintext-vs-encrypted column documentation requirement; documented protection requirements per level (14.1.2, Level 2) |
| V8 Authorization | yes (carried forward from Phase 2) | RLS `ENABLE`+`FORCE`+policy+narrowed `GRANT`, same pattern as migration 0003/0006, applied to every new table (D3-18) |
| V2 Validation and Business Logic | yes | The `CHECK` constraint (LEDGER-04) is itself a V2-shaped business-logic invariant enforced at the data layer, not the application layer |
| V6 Authentication | no | Not touched this phase — Phase 2 already landed it |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Stolen `pg_dump`/backup readable without the app | Information Disclosure | Envelope encryption with the KEK held outside the database (D3-06) — the project's own explicitly stated threat model target |
| Ciphertext copied from one row into another (row substitution) | Tampering, Spoofing | `associated_data` binding to row identity (Pitfall 4) |
| Nonce reuse under one key collapsing GCM's confidentiality guarantee | Information Disclosure | Fresh `os.urandom(12)` per field, checked by the `(key, nonce)` uniqueness query (Pitfall 2), well within NIST's 2^32-invocation ceiling at this project's scale |
| A second, unencrypted write path into `fills` | Tampering | The type-gate sentinel pattern (Pattern 6) — a compile-time-checked single write path, not a review convention |
| Account deletion leaving readable ciphertext behind because rows outlive the key | Information Disclosure | Crypto-shred ordering: destroy the wrapped DEK first, delete rows second (D3-08, explained via L069 in Pitfall discussion above) — confidentiality holds even if the row-deletion step is interrupted |

## Sources

### Primary (HIGH confidence)
- `cryptography.io/en/latest/hazmat/primitives/aead/` — fetched via `curl` this session (not
  WebFetch/WebSearch summarization, per this project's own `V065` discipline); `AESGCM` class,
  `generate_key`, `encrypt`/`decrypt` signatures and exact warning text quoted verbatim above.
- NIST SP 800-38D (`nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf`) —
  fetched via `curl` and read directly (pages 7-11, 19-22) this session; §8.3's 2^32-invocation
  ceiling quoted verbatim.
- `raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/` — directory listing and `0x20-V11-*`/`0x23-V14-*` file contents fetched via `curl` this session; exact requirement IDs and text quoted.
- PyPI JSON API (`pypi.org/pypi/cryptography/json`) — fetched this session; version, release
  history, `project_urls` all read directly.
- Local Postgres 18.6 (Homebrew, `postgresql@18` service) — the two SQL queries (disambiguation,
  reconciliation window) and the `pg_dump`-hex-encoding finding were both executed against this
  real database this session, not merely designed.
- `src/morai/db/models.py`, `src/morai/identity/audit.py`, `src/morai/identity/rls.py`,
  `src/morai/db/session.py`, `src/morai/settings.py`, `alembic/versions/0003_identity_and_rls.py`,
  `alembic/versions/0006_audit_log_grant.py`, `tests/test_isolation.py`,
  `tests/gate/test_type_gate.py`, `tests/gate/fixtures/violation_unaudited_read.py` — read directly
  this session, exact patterns and quoted docstrings verified against the actual files, not
  recalled.
- `salvage/oracle-fixtures.md` — all 13 calendars' real order IDs, occ_symbols, and dates read
  directly and hand-traced for composite-key collisions; two of them re-seeded into a real scratch
  Postgres schema and queried.

### Secondary (MEDIUM confidence)
- SQLAlchemy ORM `__init__`-not-called-on-load behavior — WebSearch summary corroborated by the
  official docs page title (`docs.sqlalchemy.org/en/13/orm/constructors.html`) appearing directly
  in results; not fetched and read verbatim this session the way the cryptography/NIST/ASVS docs
  were.
- SQLAlchemy 2.0 `LargeBinary`/`Mapped[bytes]` → `bytea` mapping — WebSearch-summarized against
  `docs.sqlalchemy.org/en/20/core/type_basics.html`; consistent with this project's own already-
  proven `Mapped[Decimal]`/`Mapped[str]` pattern, so treated as low-risk despite not being fetched
  verbatim.

### Tertiary (LOW confidence)
- None carried into a recommendation without a HIGH/MEDIUM corroborating source above.

## Metadata

**Confidence breakdown:**
- Standard stack (AESGCM API, versions): HIGH — fetched and read verbatim from official sources
  this session, cross-checked against PyPI's live JSON API.
- Architecture (schema DDL, RLS pattern, single-write-path gate): HIGH for the RLS/GRANT shape
  (verbatim from applied migrations 0003/0006); MEDIUM for the type-gate exact diagnostic marker
  (reasoned by analogy, not executed against a real checker this session).
- Pitfalls (pg_dump hex-encoding, composite-key collision-freedom, birthday bound): HIGH — every
  one was executed or hand-traced against real data/real Postgres this session, not merely
  designed.
- Security domain (ASVS 5.0 categories): HIGH — fetched directly from the OWASP ASVS GitHub
  repository this session, including the version-renumbering correction noted in State of the Art.

**Research date:** 2026-08-31
**Valid until:** ~30 days for the schema/architecture content (stable once the migration lands);
~7 days for the `cryptography` PyPI version pin specifically, since it shipped a point release six
days before this research and this project's own convention is to re-verify a fast-moving pin
before trusting it stale.
