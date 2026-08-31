# Phase 3: Envelope Encryption and the Schema Contract - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — four grey areas proposed in batch, all accepted as recommended

<domain>
## Phase Boundary

The tables the ledger writes exist, trading data in them is unreadable without the master
key, the columns that must stay readable are decided and written down, and the database
makes a netted ROLL impossible to store.

**Requirements:** CRYPT-01, CRYPT-02, CRYPT-03, CRYPT-04, CRYPT-05, AUTH-06, LEDGER-04

In scope: the per-user data key and its wrapping, the encrypted trade-data columns, the
documented plaintext column set, key rotation and crypto-shredding, the fill/leg/position/
event tables, the ROLL `CHECK` constraint, and the single write path into fills.

Out of scope: ingesting real fills (Phase 6), deriving events from them (Phase 5), the
reconciliation invariant itself (Phase 9). This phase lands the tables and the boundary
those phases write and read through.

**The tension this phase resolves.** `CRYPT-05` demands a dump yield no readable price,
quantity or P&L, which makes those columns `bytea` rather than `NUMERIC(14,4)`. Criterion 2
demands the reconciliation window query run in SQL. SQL cannot sum ciphertext. So the
plaintext column set is not documentation — it decides which queries stay in SQL and which
move into Python after decrypt, and it constrains Phases 5, 6 and 9.

</domain>

<decisions>
## Implementation Decisions

### The encryption boundary

- **D3-01:** Encryption is **per-column**, each money and free-text field its own `bytea`.
  Not one encrypted JSON blob per row. A blob makes a gap unrepresentable (`NN-16` requires
  absence to be `NULL`, never a sentinel) and pushes units back to being inferred at the
  call site, which is exactly `NN-8`'s failure — a +$395 trade displayed as −$319,850.

- **D3-02:** The **plaintext-by-design column set** is `user_id`, `order_id`, `occ_symbol`,
  `position_effect`, every timestamp, every join/foreign key, and `event_type`. Each column
  is documented in the migration with the query it exists to serve (`CRYPT-03`, criterion 2).
  `quantity` is **encrypted**, not plaintext — it is a position size, and leaving it readable
  leaks strategy to a dump-holder for a SQL-grouping convenience Python can do after decrypt.

- **D3-03:** The nonce lives in an **adjacent `bytea` column** per encrypted field, explicit
  and greppable, not prefixed into the ciphertext bytes. Criterion 1 requires a test proving
  no two ciphertext rows share a `(key, nonce)` pair; that test is written against a column
  it can select, not against bytes it must first parse.

- **D3-04:** Reconciliation selects its **window and rows in SQL**; the **sum happens in
  Python after decrypt**. No plaintext `cash_delta_usd` shortcut — that would put the exact
  figure `CRYPT-05` protects back in the dump. Phase 9 inherits this shape.

### Key management

- **D3-05:** One **DEK per user**, AES-256-GCM, generated at account creation (`CRYPT-01`).
  Not per-year or per-table — four or five users do not need that rotation granularity.

- **D3-06:** The **KEK is a Railway environment variable**, held outside the database, per
  the stack decision and the project's stated threat model (a stolen dump/backup, explicitly
  not app-server compromise). Recorded as the decision most likely to need revisiting: a
  hosted KMS is unambiguously stronger and costs about $1/month, and becomes the right call
  if the user base grows past a handful of trusted friends or app-server compromise enters
  the threat model.

- **D3-07:** A **`key_version` smallint column** on every encrypted row, so a versioned row
  reads under the key it was written with (`CRYPT-04`, criterion 3). Not a version prefix
  inside the ciphertext — that is invisible to SQL, so the distribution of versions across
  rows could not be audited or migrated in batches.

- **D3-08:** Account deletion (`AUTH-06`) **destroys the wrapped DEK**, then deletes the
  rows. Destroying the key is what makes the claim a crypto-shred rather than a row delete;
  criterion 5 requires that after deletion the rows decrypt to nothing.

### The schema contract

- **D3-09:** The netted-ROLL prohibition (`LEDGER-04`, criterion 4) is a **database `CHECK`
  constraint**, not application validation a later caller could bypass:
  `CHECK (event_type <> 'ROLL' OR (open_debit IS NOT NULL AND close_credit IS NOT NULL))`.
  This is the code class that cost v1 −$319,850.

- **D3-10:** The fill table's composite key carries **every discriminating column, including
  ones whose value is a single literal today** (`NN-1`): `(user_id, order_id, occ_symbol,
  leg_index, execution_time)`. "It never varies today" is not "it can never vary" — the
  narrower key is what silently discarded 49.6% of every smile in v1.

- **D3-11:** A missing value is **`NULL`** in a nullable ciphertext column. Never a sentinel,
  never zero, never carried forward (`NN-16`). `None`-handling is forced at every read site.

- **D3-12:** The `_usd` / `_pts` unit suffix **survives onto the encrypted columns**
  (`D-04`, `NN-8`). A column being `bytea` does not excuse it from naming its unit; the unit
  is a property of the value, not of its storage type.

### The single write path

- **D3-13:** One `insert_fills()` function is the only way into the fill table. A
  `tests/gate/` fixture proves a **second writer fails type-check**, matching Phase 1's
  `D-05`/`D-07` gate discipline — a gate that has never rejected anything is decoration.

- **D3-14:** Phase 5's oracle seeds its 52 fills **through that same function**, never a
  test-only fast path. Two implementations of one write is the shape that made a +$395 trade
  read as −$319,850 (`LEDGER-01`).

- **D3-15:** **Encryption happens inside the write path.** Callers hand it `Decimal` and
  never touch AES. Encryption at call sites means every caller must remember, and one will not.

- **D3-16:** Batch inserts chunk at **≤2,000 rows** (`NN-5`).

### Carried forward from Phases 1-2 — do not regress

- **D3-17:** `Decimal` end to end in the money path, never `float` (`D-01`, `D-02`). Money
  carries its unit as a `NewType` over `Decimal`.
- **D3-18:** New tables get RLS `ENABLE` + `FORCE` and a `user_id`-scoped policy, and
  `morai_app` is granted only the verbs it needs — the narrowing Phase 2's `WR-05` fix
  established for `audit_log`.
- **D3-19:** Migrations are append-only. 0001-0006 are applied; this phase adds 0007+.
  Never edit an applied migration in place.

</decisions>

<code_context>
## Existing Code Insights

- `src/morai/db/models.py` — six tables so far (`gate_money_probe`, `users`, `sessions`,
  `setup_tokens`, `audit_log`, `gate_user_scoped_probe`), SQLAlchemy 2.0 `Mapped[]`
  declarative, no mypy plugin.
- `src/morai/db/session.py` — `get_app_engine` (the `morai_app` least-privilege engine every
  route runs through) and `get_engine` (superuser, DDL only).
- `src/morai/money/units.py` — `points_to_usd`, the one conversion function (`D-02`).
- `src/morai/money/api_types.py` — `StrictDecimalField`, the `Decimal`-as-JSON-string
  boundary (`D-03`).
- `src/morai/identity/rls.py` — `require_rls_context`, which turns RLS's silent
  under-fetch into a named error. New read paths should use it.
- `src/morai/identity/audit.py` — `open_audited_read`, with `ReaderId`/`SubjectId` `NewType`s.
  Note its recorded trap: `insert(...).values(...)` appends an implicit `RETURNING` that an
  INSERT-only RLS policy rejects; it uses raw `text()` for that reason.
- `alembic/versions/` — 0001 baseline, 0002 Procrastinate schema, 0003 identity + RLS,
  0004 `login_lookup`, 0005 revoke PUBLIC, 0006 narrow `audit_log` grant.
- `tests/gate/` — fixture files that must fail type-check, with `tests/gate/test_type_gate.py`
  running each checker as a subprocess and asserting the specific rule marker.
- `salvage/oracle-fixtures.md` — 22.2K, the 13 real calendars Phase 5 seeds through this
  phase's write path. Read it when shaping the fill table's columns.

</code_context>

<specifics>
## Specific Ideas

- Criterion 1's dump test should be a **real `pg_dump`**, restored with the master key
  unavailable, then grepped — not an assertion about column types.
- Criterion 2 names two queries that must run in SQL against the plaintext set: the
  **shared-front-leg disambiguation** query and the **reconciliation window** query. Both
  should be written and executed in this phase, not merely designed for. If either cannot be
  expressed against the chosen plaintext set, the plaintext set is wrong and D3-02 needs
  revisiting before the schema lands.
- Criterion 3's rotation test must show trade ciphertext **byte-identical** before and after
  a KEK rotation — the DEKs are re-wrapped, the data is not touched.
- The `(key, nonce)` uniqueness claim in criterion 1 wants a real query across the stored
  nonce columns, not a reasoning argument about `os.urandom`.

</specifics>

<deferred>
## Deferred Ideas

- **Hosted KMS instead of an env-var KEK.** Revisit if the user base grows past a handful of
  trusted friends, or if app-server compromise enters the threat model (`D3-06`).
- **Per-year or per-table DEKs.** Not needed at this scale (`D3-05`).
- **Column-level RLS restriction on `users`** — `IN-01` from Phase 2's review. Not
  exploitable today; only `password_hash` is ever self-written.

</deferred>
