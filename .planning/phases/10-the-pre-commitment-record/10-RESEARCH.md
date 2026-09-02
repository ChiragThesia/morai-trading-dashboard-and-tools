# Phase 10: The Pre-commitment Record - Research

**Researched:** 2026-09-02
**Domain:** Postgres structural immutability (trigger + grant discipline), envelope-encrypted
free-text/money fields, closed-vocabulary tag enforcement, FastAPI capture routes
**Confidence:** HIGH for schema/trigger/grant mechanics (verified against this repo's own migrations
and models this session); MEDIUM for the API surface shape (no existing precedent in this codebase
for a "linked after the fact" table); LOW for one tag vocabulary's member values (see Open
Questions) and for two design inferences that resolve a tension inside `10-CONTEXT.md` itself
(flagged explicitly below, not smoothed over)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D10-01 — "Opened" means an OPEN or ROLL event exists for the position.** The immutability gate
reads the existence of an `OPEN` or `ROLL` row in `events` for that `position_id`. Those columns —
`position_id`, `event_type` — are plaintext. `derive_position_state` cannot be the gate: it is a
pure Python function over *decrypted* quantities and no Postgres trigger can decrypt. The opening
side of position state, unlike the closing side, needs no quantity at all.

**D10-02 — A `BEFORE UPDATE` trigger, plus `REVOKE UPDATE` as defence in depth.** The trigger raises
when an entry-intent row is updated while its position has an opening event. `REVOKE UPDATE` on the
entry-intent columns for `morai_app` backs it up. Criterion 2 names "a constraint or a trigger, not
a service-layer conditional a later caller could route around" — a `CHECK` constraint cannot see
another table, so a trigger is the only constraint-class mechanism that can consult `events`.
Revoking UPDATE alone would also block the legitimate pre-open edits INTENT-01..05 depend on, so it
is the second layer rather than the first.

**D10-03 — Immutability covers DELETE, not only UPDATE.** A record that can be deleted and
re-created is not immutable; it is mutable through a different verb.

**D10-04 — Intent is written standalone and linked when a position opens.** The entry-intent row
carries a nullable `position_id`, set once when the position it describes comes into existence.
`create_positions` only writes a `positions` row once fills land, so a NOT NULL foreign key at
insert time is impossible; a client-generated position id would invent an identifier the ingest
path has no way to match.

**D10-05 — The tag vocabulary is enforced in Postgres AND in Pydantic.** A Postgres enum or `CHECK`
for each of the four vocabularies, plus a Pydantic `StrEnum` at the API boundary. The database is
the layer no caller can route around; Pydantic turns a raw integrity error into a useful 422 that
names the offending field.

**D10-06 — A bad tag fails the write. No `other` bucket, no coercion, no silent drop.** INTENT-08's
wording is deliberate — free text is "rejected rather than stored."

**D10-07 — Tags are plaintext.** They are the axis Phase 11's drift and cohort queries aggregate on,
and they carry no free text by construction (D10-06).

**D10-08 — The four vocabularies' member values come from the project's own record.** INTENT-08
names the four: structure, entry trigger, exit reason, plan-followed. Their member values are to be
derived from `knowledge-base/`, `salvage/`, and the v1 record — not invented during planning. Where
the record is silent, research decides and records its source.

**D10-09 — Thesis and invalidation trigger are encrypted.** Per the per-user DEK envelope Phase 3
established. These are the free-text fields the security constraint was written for.

**D10-10 — Profit target, stop, combo mid and net price are encrypted `Decimal`s.** Following the
money-path pattern, with NN-8 applying: every money field's unit is named in the column, never
inferred.

**D10-11 — The planned DTE window stays plaintext.** Two integers, unencrypted. Phase 11 must
compare the window against elapsed time in SQL; encrypting it turns that into a full decrypt scan.
The governing rule for the whole split: **encrypted unless Phase 11 must aggregate on it**, and
where both pull, the threat model wins.

**D10-12 — Ingest never blocks on user input; a missing close note is an outstanding obligation.** A
position closes when the broker's fills say so. The at-close record is captured separately, and a
closed position lacking its note is surfaced as outstanding rather than blocking anything.

**D10-13 — The incompleteness surfaces through Phase 9's trustworthiness envelope.** Reusing
`DependentNumbersModel`'s established pattern rather than inventing a second signal.

**D10-14 — Entry intent is frozen; the at-close note stays editable.** `INTENT-06` freezes entry
intent because its entire value is that it was recorded before the outcome was known. A retrospective
note has no such property.

**D10-15 — Plan-followed is a boolean AND a sentence, required together.** A bare boolean is
unanalysable later. The sentence carries the reason; the boolean carries the aggregation.

### Claude's Discretion

- Table naming and whether entry intent and the close record are one table or two.
- Whether the tag vocabularies are Postgres enums or `CHECK` constraints over `text`, provided both
  layers enforce the same closed set.
- The exact trigger name and error message, provided the message names the offending field.
- How the outstanding-close-note obligation is exposed on the envelope, provided it reuses Phase 9's
  mechanism rather than adding a parallel one.

### Deferred Ideas (OUT OF SCOPE)

- The review and drift surface that consumes this data (Phase 11's criterion 2). `D10-11` keeps the
  DTE window plaintext specifically so that query is possible later.
- Any UI for capture. This milestone is backend only.
- Reminders or nudges to fill in a missing close note. `D10-12` makes the obligation visible; acting
  on it is not in this phase's criteria.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTENT-01 | User records a thesis before the position opens | `entry_intent.thesis_ciphertext`/`_nonce`, encrypted via the existing `envelope.py`/`data_keys.py` pattern — see Pattern 4 |
| INTENT-02 | User records an invalidation condition as a structured if-then trigger before the position opens | `entry_intent.invalidation_trigger_ciphertext`/`_nonce`, free text (the "if-then form" is a client-side convention, not a parsed structure — no source names a machine-checkable if/then schema) — see Pattern 4 and Open Questions |
| INTENT-03 | User records an exit plan with a numeric profit target and a numeric stop before the position opens | `entry_intent.profit_target_usd_ciphertext`/`_nonce`, `stop_usd_ciphertext`/`_nonce` — see Pattern 4, Pitfall 1 (column-suffix gate) |
| INTENT-04 | User records a planned DTE window as two integers before the position opens | `entry_intent.planned_dte_min`, `planned_dte_max` (`SmallInteger`, plaintext) — see D10-11 |
| INTENT-05 | User records the combo mid at submit and the net price submitted | `entry_intent.combo_mid_usd_ciphertext`/`_nonce`, `net_price_usd_ciphertext`/`_nonce` — see Pattern 4 |
| INTENT-06 | Entry-intent fields cannot be edited once the position opens, enforced structurally rather than by convention | `BEFORE UPDATE OR DELETE` trigger reading `events` for `OPEN`/`ROLL`, plus column-scoped GRANT — see Pattern 1, Pattern 2 |
| INTENT-07 | User records a plan-followed yes/no plus one sentence at close | `close_record.plan_followed` (`Boolean`), `close_record.close_note_ciphertext`/`_nonce` — see Pattern 3, D10-14/D10-15 |
| INTENT-08 | Tags come from a closed vocabulary of four — structure, entry trigger, exit reason, plan-followed — and free text is rejected | `CHECK` constraints + Pydantic `StrEnum`, per D10-05 — see Pattern 3, Open Questions (entry-trigger member values) |
</phase_requirements>

## Summary

This phase adds one migration (`0017`) and a small, self-contained API surface. Nothing it needs is
a new library: the encryption envelope, the encrypted-`Decimal` round-trip, the `ApiModel`/
`DependentNumbersModel` base classes, the `StrEnum` tag pattern, and the RLS/GRANT discipline all
already exist in this codebase and are reused verbatim, not reinvented.

The one genuinely new mechanism is criterion 2's structural immutability gate: a `BEFORE UPDATE OR
DELETE` trigger on the new `entry_intent` table that queries `events` for an `OPEN` or `ROLL` row
matching `OLD.position_id`, and raises if one exists. This is the first `CREATE TRIGGER` this
project has hand-written (the only other trigger DDL in the codebase is Procrastinate's own vendored
`schema.sql`, wrapped verbatim into migration `0002`) — Pattern 1 below gives the exact PL/pgSQL
shape, matching that file's own dialect (`LANGUAGE plpgsql`, `RETURNS trigger`, `$$`-quoted body).

Two design points in `10-CONTEXT.md` are read literally and reconciled explicitly, not silently
resolved, because they are in tension on their face:

1. D10-04 says intent is "linked when a position opens," but the phase description says this phase
   "touches no fill, event, or position write path." Those two statements are only consistent if the
   position-id link is a **user-triggered API write to `entry_intent` alone** (see Pattern 2), not a
   change to `create_positions`/`sync_events`/`schwab_sync.py`. Verified this session: `create_positions`
   runs before `sync_events` in the same transaction (`schwab_sync.py:471-472`), so a position exists
   with no `OPEN`/`ROLL` event for a window inside that same sync call — but nothing outside that
   transaction can observe or act inside it, so the link cannot be piggybacked on that window even if
   it wanted to. The link is necessarily a separate, later, user- or client-initiated call once the
   user can see the new position's id.
2. D10-02 says "REVOKE UPDATE... would also block the legitimate pre-open edits INTENT-01..05 depend
   on" — which only makes sense if REVOKE UPDATE is scoped to something narrower than "every
   entry-intent column." Pattern 2 below resolves this the way this codebase's own GRANT discipline
   already resolves it elsewhere (`0011`, `0012`, `0016` all just never grant `UPDATE` table-wide for
   an append-mostly table): grant `UPDATE` only on the `position_id` column, and never grant table-wide
   `UPDATE` at all — every other entry-intent field is insert-once by construction, so no legitimate
   caller ever needs `UPDATE` on it, pre-open or otherwise. Postgres's own docs, fetched this session,
   confirm column-level `GRANT UPDATE (column) ON table TO role` is real, standard syntax, distinct
   from a table-wide grant.

**Primary recommendation:** two tables (`entry_intent`, `close_record`), migration `0017`, reusing
the encrypted-field and RLS/GRANT patterns verbatim; one hand-written `BEFORE UPDATE OR DELETE`
trigger function per D10-01/D10-02/D10-03; `CHECK` constraints (not native Postgres enums) for the
three text-tag vocabularies, matching `0016`'s own convention exactly; `plan_followed` as a plain
`Boolean` column, which is itself the fourth vocabulary's closed set (D10-15).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Entry-intent capture (thesis, invalidation, exit plan, DTE window, submit prices) | API / Backend | Database / Storage | FastAPI route validates shape and encrypts; Postgres stores ciphertext and enforces the tag vocabulary as a second, unbypassable layer (D10-05) |
| Structural immutability after open | Database / Storage | — | Criterion 2 explicitly forbids a service-layer-only gate; must live in Postgres as a trigger, per D10-02 |
| Position-id linkage | API / Backend | Database / Storage | A dedicated write to `entry_intent` alone, never inside the ingest pipeline (see Summary point 1) |
| Close-record capture (plan-followed, note) | API / Backend | Database / Storage | Mutable by design (D10-14) — a normal FastAPI write path, Pydantic validates the boolean+sentence pair together |
| Outstanding-close-note signal | API / Backend | — | Computed at read time from `close_record` absence against closed positions, surfaced inline in a response payload per D10-13, never a separate poll target |
| Tag vocabulary enforcement | Database / Storage | API / Backend | `CHECK` constraint is the layer no caller can route around; Pydantic `StrEnum` is the ergonomic 422 in front of it (D10-05) |

## Standard Stack

### Core

No new dependency. Every library this phase needs is already pinned in `pyproject.toml` and used
elsewhere in this codebase for the identical job:

| Library | Version | Purpose | Why Standard (already established here) |
|---------|---------|---------|--------------|
| SQLAlchemy | 2.0.52 `[VERIFIED: pyproject.toml]` | ORM models for `entry_intent`/`close_record` | Every existing table uses `Mapped[T]` declarative style (`db/models.py`) |
| Alembic | 1.19.1 `[VERIFIED: pyproject.toml]` | Migration `0017` | Hand-written, sequentially numbered, matching `0001`-`0016` |
| Pydantic | 2.13.5 `[VERIFIED: pyproject.toml]` | Request/response models, `StrEnum` tag types | `ApiModel`/`DependentNumbersModel` in `api/models.py`; `StrEnum` already used for `ReconciliationVerdict`/`IndeterminateReason` (`ledger/reconciliation.py:97,109`) |
| `cryptography` (AESGCM) | pinned per Phase 3 | Encrypt thesis, invalidation, money fields, close note | `crypto/envelope.py`'s `encrypt_field`/`decrypt_field`, reused verbatim |
| FastAPI | 0.141.1 `[VERIFIED: pyproject.toml]` | Capture routes | Return-type-annotation routing convention (`api/app.py`'s own docstring, D-11) |

### Supporting

Nothing beyond what is already imported project-wide. No new supporting library.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A hand-written `BEFORE UPDATE OR DELETE` trigger | A service-layer guard (`if position_is_open: raise`) | Explicitly forbidden by criterion 2's own wording ("not by a service-layer conditional a later caller could route around") — not a real alternative for this phase |
| `CHECK` constraints for the three text-tag vocabularies | Native Postgres `CREATE TYPE ... AS ENUM` | `0016`'s reason table (`reconciliation_runs_reason_check`) already chose `CHECK` over enum for an identical closed-vocabulary need on this project; `ALTER TYPE ... ADD VALUE` is a heavier, less-reversible schema operation than editing a `CHECK`'s `IN (...)` list in a later migration, and this project has zero precedent for a native enum anywhere in its 16 existing migrations — `CHECK` is the established idiom, not a new one |
| One `entry_intent`/`close_record` table | One combined table with nullable close-fields | A single BEFORE UPDATE trigger would then have to distinguish "only close columns changed" (allow) from "an entry column changed" (block) via `OLD.col IS DISTINCT FROM NEW.col` on every frozen column — strictly more trigger complexity than two tables, for no benefit `10-CONTEXT.md` names; two tables is this research's recommendation, left as Claude's Discretion by `10-CONTEXT.md` |

**Installation:** none — no `pyproject.toml` change for this phase.

**Version verification:** confirmed live against this project's own `pyproject.toml` this session
(`fastapi==0.141.1`, `pydantic==2.13.5`, `sqlalchemy[postgresql-asyncpg]==2.0.52`,
`alembic==1.19.1`) `[VERIFIED: pyproject.toml]`.

## Package Legitimacy Audit

**Not applicable.** This phase installs no new external package. Every library it uses is already
present in `pyproject.toml` and verified in prior phases' own audits.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────┐
  Before order        │  POST /intent                │
  is placed  ───────▶ │  (thesis, invalidation,      │──▶ encrypt_field() per   ──▶ INSERT entry_intent
                     │   profit target, stop,        │    encrypted column       (position_id = NULL)
                     │   DTE window, combo mid,       │
                     │   net price submitted,         │
                     │   structure tag, entry-        │
                     │   trigger tag)                 │
                     └─────────────────────────────┘

  After the broker    ┌─────────────────────────────┐
  order lands and     │  GET /gate/positions          │──▶ reads position_id
  create_positions/   │  (existing route, Phase 2)     │    (user sees it)
  sync_events already ├─────────────────────────────┤
  ran (separate        │  POST /intent/{id}/link       │──▶ UPDATE entry_intent  ──▶ trigger checks
  transaction,          │  {position_id}                │    SET position_id     events for OPEN/ROLL
  earlier)             └─────────────────────────────┘    (only grant: column-  on OLD.position_id
                                                             level UPDATE on         (NULL ⇒ passes)
                                                             position_id)

  Any later edit        ┌─────────────────────────────┐
  attempt (any          │  Any UPDATE/DELETE on          │──▶ BEFORE UPDATE OR   ──▶ RAISE if OLD.position_id
  path, including       │  entry_intent, even raw SQL     │    DELETE trigger        has an OPEN/ROLL event;
  a bypass of the       │  on a morai_app connection      │    (D10-01/02/03)        else allowed (covers the
  service layer)        └─────────────────────────────┘                              pre-open window too)

  When the position    ┌─────────────────────────────┐
  actually closes       │  POST /intent/{position_id}/    │──▶ encrypt close note  ──▶ INSERT close_record
  (fills say so,         │  close                          │    (plan_followed +      (mutable — D10-14,
  independent of         │  {plan_followed, note}          │    close_note)            no trigger)
  this write)           └─────────────────────────────┘

  Any position          ┌─────────────────────────────┐
  listing / detail      │  Extended PositionResponse       │──▶ close_note_outstanding:
  read                  │  or a small status route          │    bool, computed from
                        │  (D10-13 pattern reuse)           │    is_closed AND no
                        └─────────────────────────────┘      close_record row (D10-12)
```

### Recommended Project Structure

```
src/morai/
├── ledger/
│   └── intent.py          # write_entry_intent, link_entry_intent, write_close_record,
│                           # read_entry_intent, outstanding_close_notes — mirrors
│                           # ledger/fills.py's encrypt-at-write-path shape
├── api/
│   ├── models_intent.py   # ApiModel subclasses: EntryIntentRequest/Response,
│   │                      # CloseRecordRequest/Response, the four StrEnum tag types
│   └── routes_intent.py   # POST /intent, POST /intent/{id}/link,
│                           # POST /intent/{position_id}/close
alembic/versions/
└── 0017_entry_intent_and_close_record.py
tests/
├── ledger/
│   └── test_intent.py             # encrypt/decrypt round trip, tag CHECK rejection
├── test_intent_immutability.py    # criterion 2's own proof, mirroring
│                                   # tests/ledger/test_roll_check_constraint.py's
│                                   # raw-SQL-on-morai_app-connection shape
└── api/
    └── test_intent_routes.py
```

### Pattern 1: The `BEFORE UPDATE OR DELETE` trigger (D10-01, D10-02, D10-03)

**What:** A PL/pgSQL trigger function that raises when a row's `OLD.position_id` has an `OPEN` or
`ROLL` event, fired on both `UPDATE` and `DELETE`, checking `OLD` (never `NEW`) so the very write
that performs the position-id link (transitioning `NULL` → a real id, while no `OPEN`/`ROLL` event
yet exists for that id) is itself unaffected.

**When to use:** The one place in this codebase's 16 migrations where a `CHECK` constraint cannot
express the rule, because the rule depends on a second table.

**Example** (matches this project's own PL/pgSQL dialect, verified against
`alembic/versions/0002_procrastinate_schema.py:445-475`, the only other hand-authored trigger DDL in
this repo):

```sql
-- Source: this project's own migration 0002 (Procrastinate schema, vendored)
-- establishes the LANGUAGE plpgsql / RETURNS trigger / $$ ... $$ dialect this
-- migration follows.

CREATE FUNCTION entry_intent_immutable_after_open()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    checked_position_id uuid;
BEGIN
    checked_position_id := OLD.position_id;

    IF checked_position_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM events
        WHERE position_id = checked_position_id
          AND event_type IN ('OPEN', 'ROLL')
    ) THEN
        RAISE EXCEPTION
            'entry_intent is immutable once its position has opened (position_id=%)',
            checked_position_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER entry_intent_immutable_after_open_trigger
    BEFORE UPDATE OR DELETE ON entry_intent
    FOR EACH ROW
    EXECUTE FUNCTION entry_intent_immutable_after_open();
```

Ported into an Alembic migration through `bind.execute(sa.text(...))`, exactly like `0002` wraps
Procrastinate's own `schema.sql` — one `op.execute()` call per statement (function, then trigger),
never both in one call, matching `0002`'s own `_split_sql_statements` reasoning (asyncpg's extended
query protocol rejects multiple commands in one prepared statement).

**Why `OLD`, never `NEW`, and why this correctly permits the link write:** `create_positions` runs
before `sync_events` in the same transaction (`ingest/schwab_sync.py:471-472`
`[VERIFIED: src/morai/ingest/schwab_sync.py:471-472]`, quoted verbatim: `await create_positions(session, user_id)` then
`await sync_events(session, user_id, as_of=now)`), so a position can exist with zero `OPEN`/`ROLL`
events for a window inside that call. The link write (`UPDATE entry_intent SET position_id = ...`)
happens later, in a separate transaction, once the user has seen the position id — by which point
`sync_events` has long since run and the `OPEN` event for that position typically already exists.
Checking `OLD.position_id` (which is `NULL` at the moment of linking) rather than `NEW.position_id`
is what makes the link itself pass the trigger regardless of whether the position has already opened
by the time the user links it — the trigger is answering "was this row already committed to a
now-open position," not "is the position I'm about to attach already open." This matches D10-04's
plain reading: the row is inert (no position, so nothing to freeze) until linked, and frozen from the
instant a real, opened-or-rolled position is attached to it, not from the instant the position itself
opened.

### Pattern 2: Column-scoped GRANT as the second layer (D10-02)

**What:** Never grant table-wide `UPDATE` on `entry_intent`. Grant `UPDATE` on the `position_id`
column alone.

```sql
GRANT SELECT, INSERT, DELETE ON entry_intent TO morai_app;
GRANT UPDATE (position_id) ON entry_intent TO morai_app;
```

**When to use:** Whenever an append-mostly table has exactly one column that legitimately needs a
post-insert write, and every other column is genuinely insert-once. `entry_intent`'s content columns
(thesis, invalidation, profit target, stop, DTE window, submit prices, structure tag, entry-trigger
tag) are all submitted together in one `POST /intent` call per criterion 1's own wording ("Before a
position opens, the user records a thesis, ... plus the net price submitted" — one sentence, one
act); nothing in `10-CONTEXT.md` describes an incremental multi-step capture flow for them. If the
user gets a pre-open field wrong, the correct move is delete-and-resubmit (allowed pre-link, since
the trigger's own `OLD.position_id IS NOT NULL` guard passes when it is still `NULL`), not an
in-place edit.

**Why this resolves D10-02's own internal tension:** D10-02's decision text says both (a) `REVOKE
UPDATE` on entry-intent columns backs up the trigger, and (b) revoking `UPDATE` alone would ALSO
block the legitimate pre-open edits INTENT-01..05 depend on. Read literally, a blanket table-wide
`REVOKE UPDATE` cannot simultaneously forbid all UPDATEs and permit the one UPDATE that legitimately
needs to happen (the position-id link) — Postgres privileges are not row- or time-conditional.
Column-scoping the grant is the only reading that makes both sentences true at once: `position_id`
keeps its `UPDATE` grant (so the link is possible at all — the trigger is what still blocks it once
the position has opened), and every other column never had an `UPDATE` grant to revoke from in the
first place, so "defence in depth" for those columns is structurally automatic rather than a second
enforcement point. Confirmed this session that column-level `GRANT`/`REVOKE UPDATE (column)` is real,
current Postgres syntax, distinct from and independent of a table-level grant `[CITED:
postgresql.org/docs/current/sql-grant.html; postgresql.org/docs/current/ddl-priv.html]` — a
subtlety worth flagging for the plan: revoking a table-level grant does cascade down to per-column
grants, but the reverse is not true, so this migration must never grant table-wide `UPDATE` at all
(not grant-then-revoke), matching the pattern several existing migrations already use for
append-only tables (`broker_transactions`, `sync_runs`, `reconciliation_runs` — all `GRANT SELECT,
INSERT, DELETE`, no `UPDATE`, `[VERIFIED: alembic/versions/0011_broker_transactions.py:104,
0012_sync_runs.py:129, 0016_reconciliation_runs.py:212]`).

**This pattern is this research's own inference, not a literal instruction from `10-CONTEXT.md`.**
`10-CONTEXT.md` says "provided both layers enforce the same closed set" about the *tag* vocabulary
(a different decision, D10-05) — it does not spell out which columns `REVOKE UPDATE` covers for
D10-02. Flagged in the Assumptions Log below; the planner should treat the column list (which fields
are "content, insert-once" vs. `position_id`) as confirmable but not re-litigate the trigger, which
is directly required by criterion 2's own wording.

### Pattern 3: Closed-vocabulary tags — `CHECK` constraint + Pydantic `StrEnum` (D10-05, D10-06)

**What:** One `CHECK (column IN (...))` per vocabulary on the owning table, plus a matching
`StrEnum` in Pydantic, mirroring `0016`'s own `reconciliation_runs_verdict_check`/
`reconciliation_runs_reason_check` pattern exactly `[VERIFIED: alembic/versions/0016_reconciliation_runs.py:164-171]`
(quoted: `sa.CheckConstraint(_in_list_sql("verdict", _VERDICT_VALUES), name="reconciliation_runs_verdict_check")`).

```python
# Source: this project's own ledger/reconciliation.py:97 (StrEnum precedent)
from enum import StrEnum

class StructureTag(StrEnum):
    CALENDAR = "calendar"
    DIAGONAL = "diagonal"

class ExitReasonTag(StrEnum):
    TARGET = "target"
    STOP = "stop"
    ROLL = "roll"
    SETTLEMENT = "settlement"
```

`plan_followed` is a plain `Boolean` column (D10-15), not a `CHECK`-constrained text column — a
`bool` type is itself a closed two-member vocabulary with no CHECK needed. `entry_trigger`'s member
values are the one vocabulary this project's record does not enumerate — see Open Questions; do not
invent domain terms per D10-08's own instruction.

**Why `CHECK` over a native Postgres enum:** this project has zero precedent for `CREATE TYPE ... AS
ENUM` across 16 existing migrations; every closed-vocabulary column (`event_type`,
`reconciliation_runs.verdict`, `reconciliation_runs.reason`, `sync_runs.status`,
`snapshot_runs.status`) uses `Text` + `CHECK (... IN (...))`. Matching that idiom keeps this phase's
migration reviewable against the same pattern a reader already recognizes, and a `CHECK`'s value list
is a one-line edit in a later migration versus an enum's `ALTER TYPE ... ADD VALUE` (which cannot run
inside the same transaction as other DDL on older Postgres, and is a heavier operation generally).

### Pattern 4: Encrypted free-text and money fields (D10-09, D10-10)

**What:** Reuse `crypto/envelope.py`'s `encrypt_field`/`decrypt_field` and `_encode_decimal`/
`_decode_decimal` verbatim, following `ledger/fills.py`'s exact shape — a dedicated write function
(`write_entry_intent`) is the sole path into the table, gated by a `_write_token` sentinel on the ORM
model's `__init__`, mirroring `Fill.__init__`/`Position.__init__`/`Event.__init__`
`[VERIFIED: src/morai/db/models.py:184-208, 242-269, 552-577]` (all three share the identical
docstring shape: "`_write_token` has no default... Passing anything but the sentinel... holds raises
here, at runtime").

```python
# Source: this project's own ledger/fills.py:113-121 (verbatim pattern to reuse)
def _encode_decimal(value: Decimal) -> bytes:
    """Never via `float` -- the exact failure class this project exists to
    prevent (D3-17)."""
    return str(value).encode("utf-8")

def _decode_decimal(value: bytes) -> Decimal:
    return Decimal(value.decode("utf-8"))
```

The associated-data (AAD) row-binding format should follow `fills.py`'s own convention — a
colon-delimited string naming the table, column, and every discriminating key column, so a
ciphertext copied from a different row fails to decrypt (`fills.py`'s own documented Pitfall 4). For
`entry_intent`, the natural binding key is the row's own `id` (a UUID primary key, unlike `fills`'
composite key) plus `user_id`: `f"entry_intent:{column}:{user_id}:{row_id}"`.

**Why this matters for the close-record note too:** although `10-CONTEXT.md` does not explicitly say
whether `close_record.close_note` is encrypted, D10-09's own stated reason — "these are the free-text
fields the security constraint was written for... the most sensitive content in the system" —
applies identically to a one-sentence retrospective note. This research recommends encrypting it for
consistency with D10-09's rationale, flagged in the Assumptions Log as an extension of a stated
decision rather than the decision itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Envelope encryption for a new free-text/money column | A second `AESGCM` call site, a new nonce scheme | `crypto/envelope.py::encrypt_field`/`decrypt_field`, unchanged | Five call sites already share this exact function; a sixth copy is the thing `crypto/data_keys.py`'s own docstring calls out as the smell that triggers promotion — this phase adds a sixth *call site*, not a sixth *copy* |
| DEK lookup | A new "current key" query | `crypto/data_keys.py::current_dek`/`dek_for_version` | Already the promoted, shared helper as of Phase 8 |
| API response shape for a value derived from an incomplete state | A bespoke boolean flag with its own name/semantics | Extend `DependentNumbersModel` or follow its embedded-flag pattern | D10-13 explicitly forbids "a parallel ad-hoc flag" |
| Structural write-once enforcement | A service-layer `if` check | A DB trigger + a `_write_token` constructor sentinel, both already established patterns in this codebase | Criterion 2's own wording forbids the service-layer path; the sentinel pattern is proven four times over (`Fill`, `Position`, `Leg`, `Event`, `BrokerTransaction`) |
| Tag validation | A free-text column with app-side regex checking | `CHECK (col IN (...))` + Pydantic `StrEnum` | D10-05 requires the database layer specifically, because it is the layer "no caller can route around" |

**Key insight:** every mechanism this phase needs already has exactly one canonical implementation
somewhere in this codebase. The work is composition (a new table shaped like the existing ones, a new
call site into existing crypto helpers, a new trigger following the existing PL/pgSQL dialect), not
invention.

## Common Pitfalls

### Pitfall 1: `tests/test_money_column_naming.py` will fail on any new money column without the `_usd` suffix, including on ciphertext columns
**What goes wrong:** Adding `profit_target_ciphertext`/`profit_target_nonce` (without `_usd`) passes
review but fails this project's own metadata-walking test.
**Why it happens:** `_columns_missing_unit_suffix` strips `_ciphertext`/`_nonce` and requires what
remains to end in `_usd` or `_pts` `[VERIFIED: tests/test_money_column_naming.py:89-107]` (quoted:
`if not base_name.endswith(_UNIT_SUFFIXES): missing.append(qualified)`), for every `LargeBinary`
column not explicitly listed in `_UNIT_EXEMPT_BINARY_COLUMNS`.
**How to avoid:** Name the four encrypted money fields `profit_target_usd`, `stop_usd`,
`combo_mid_usd`, `net_price_usd` as the base, giving `profit_target_usd_ciphertext`/`_nonce`, etc.
Add `thesis_ciphertext`/`_nonce`, `invalidation_trigger_ciphertext`/`_nonce`, and
`close_note_ciphertext`/`_nonce` (if encrypted per Pattern 4) to `_UNIT_EXEMPT_BINARY_COLUMNS`
`[VERIFIED: tests/test_money_column_naming.py:35-64]` — they carry no unit, the same class as
`fills.quantity_ciphertext` (already exempted there).
**Warning signs:** `test_real_schema_names_every_money_column` fails immediately after the migration
lands, with the exact offending `table.column` name in the assertion output.

### Pitfall 2: Assuming the position-id link can piggyback on `create_positions`/`sync_events`
**What goes wrong:** Modifying `ingest/schwab_sync.py`, `ledger/positions.py`, or `ledger/pairing.py`
to set `entry_intent.position_id` automatically during sync violates the phase's own stated boundary
("touches no fill, event, or position write path") and reopens files two other in-flight/parallel
phases (8, 9) also touch.
**Why it happens:** D10-04's prose ("linked when a position opens") reads, on a fast pass, like an
automatic trigger tied to ingest.
**How to avoid:** The link is its own, separate, user- or client-initiated API write (`POST
/intent/{id}/link`), issued after the caller has already seen the new position's id via the existing
`GET /gate/positions` route. See Pattern 1/Summary point 1.
**Warning signs:** A plan task that edits `ingest/schwab_sync.py` for this phase is a signal to stop
and re-check this boundary.

### Pitfall 3: A blanket `REVOKE UPDATE ON entry_intent FROM morai_app` breaks the position-id link
**What goes wrong:** If the migration grants table-wide `UPDATE` and then issues a table-wide
`REVOKE UPDATE`, no caller — including the legitimate link write — can ever update `position_id`
again.
**Why it happens:** Every other append-mostly table in this schema (`fills`, `events`,
`broker_transactions`, `sync_runs`, `reconciliation_runs`) simply never grants `UPDATE` at all
(D10-02's own "second layer" framing invites copying that pattern reflexively).
**How to avoid:** Grant `UPDATE` at column scope only, on `position_id`, per Pattern 2. Never issue a
table-wide `UPDATE` grant for this table at all — there is nothing to revoke from later, and
column-level grants are unaffected by the absence of a table-level one.
**Warning signs:** `has_table_privilege('morai_app', 'entry_intent', 'UPDATE')` should read `false`
(matching this project's own `test_grants_are_verb_narrowed` convention
`[VERIFIED: tests/ledger/test_schema_contract.py:72-94]`), while a column-scoped
`has_column_privilege('morai_app', 'entry_intent', 'position_id', 'UPDATE')` should read `true`. A
plan that asserts only the table-level check for this table will under-specify the actual guarantee.

### Pitfall 4: Testing the trigger only through the service layer proves nothing
**What goes wrong:** A test that calls the intended `write_entry_intent`/API path and asserts an
error is caught by a Python-level guard, not the trigger — silently reintroducing the exact
service-layer-conditional criterion 2 forbids.
**Why it happens:** It is the natural, cheapest test to write first.
**How to avoid:** Mirror `tests/ledger/test_roll_check_constraint.py`'s own convention — a raw
`sa.text()` `UPDATE`/`DELETE` executed directly on an `app_db_session` (a `morai_app`-role
connection), never through the ORM write path, never through the service layer
`[VERIFIED: tests/ledger/test_roll_check_constraint.py:1-20]` (quoted: "proven here through raw
`sa.text()` INSERT statements executed on the superuser session, never through the ORM and never
through any write path, because criterion 4's whole point is that the guard holds for a caller who
never touches application code").
**Warning signs:** A test file for this phase with no raw-SQL statement anywhere in it is a signal
the structural proof is missing.

### Pitfall 5: Postgres `SET`/session-context gotchas already documented elsewhere in this codebase apply here unchanged
**What goes wrong:** Binding `app.current_user_id` with `SET LOCAL ... :param` instead of
`set_config(name, value, true)`.
**Why it happens:** It is the natural first attempt.
**How to avoid:** Already solved project-wide (`identity/sessions.py`'s own docstring, `set_config`
used everywhere); this phase's routes reuse `get_current_user`/`get_db_session` unchanged and never
re-implement this.
**Warning signs:** N/A — flagged only so a plan does not attempt to re-derive this.

## Code Examples

### Migration skeleton (`0017`)

```python
# Pattern verified against alembic/versions/0016_reconciliation_runs.py's own shape
_STRUCTURE_VALUES = ("calendar", "diagonal")
_EXIT_REASON_VALUES = ("target", "stop", "roll", "settlement")

def _in_list_sql(column: str, values: tuple[str, ...]) -> str:
    rendered = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({rendered})"

# entry_intent: nullable position_id FK, structure/entry_trigger CHECK constraints,
# thesis/invalidation/profit_target_usd/stop_usd/combo_mid_usd/net_price_usd
# ciphertext+nonce pairs, planned_dte_min/max plaintext SmallInteger, key_version.
#
# close_record: NOT NULL position_id FK (position already exists by close time),
# plan_followed Boolean NOT NULL, close_note ciphertext+nonce, exit_reason CHECK,
# key_version. No trigger -- D10-14 keeps this table mutable.
```

### Encrypted-field write path (reuse, not new code)

```python
# Source: this project's own ledger/fills.py insert_fills() shape (D3-13, D3-15) --
# same encrypt-inside-the-write-function discipline, same _write_token gate on the
# ORM model's __init__.
```

### Structural immutability proof (test shape)

```python
# Source: this project's own tests/ledger/test_roll_check_constraint.py and
# tests/test_isolation.py -- raw sa.text() UPDATE/DELETE on an app_db_session,
# asserting sqlalchemy.exc.DBAPIError / IntegrityError, never through the ORM
# write path or the service layer.
```

## State of the Art

Not applicable — this phase uses no external API or vendor surface with its own version history.
Every pattern reused is this project's own, established within the last two weeks of its own
history (Phases 1-9).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The position-id link is a separate, user- or client-initiated API call (`POST /intent/{id}/link`), not automatic during `create_positions`/`sync_events` | Summary point 1, Pattern 1, Pitfall 2 | If wrong, the plan would need to touch `schwab_sync.py`, violating the phase's own stated boundary and creating merge risk with parallel Phases 8/9 — worth a one-line confirmation from the user before planning locks it |
| A2 | `REVOKE UPDATE`'s scope in D10-02 resolves to "column-level grant on `position_id` only, no table-wide `UPDATE` ever granted" rather than some other split | Pattern 2, Pitfall 3 | If the user intended a different column split (e.g., allowing iterative edits to `thesis` before position-link), the migration's grant list needs to change; the trigger itself is unaffected either way since it doesn't depend on which columns have `UPDATE` grants |
| A3 | `close_record.close_note` is encrypted, following D10-09's stated rationale by extension, though CONTEXT.md does not say so explicitly for this specific field | Pattern 4 | If the user intended the close note plaintext (e.g., because Phase 11's drift/cohort review needs to read it without decrypting), the column split changes — low risk either way since it's a single column, easy to correct later, but changes the plaintext-column inventory CRYPT-03 must document |
| A4 | The `entry trigger` tag vocabulary's member values are genuinely undetermined by the project's record and must be confirmed with the user before the migration's `CHECK` constraint is written | Open Questions | High risk if skipped: inventing values here is exactly what D10-08 forbids ("Inventing a plausible vocabulary would fabricate domain terms the user already has") — this is the one place this research explicitly declines to decide |
| A5 | Two tables (`entry_intent`, `close_record`) rather than one combined table | Alternatives Considered, Standard Stack | Explicitly Claude's Discretion per CONTEXT.md; if the user prefers one table, the trigger function needs `OLD.col IS DISTINCT FROM NEW.col` guards per frozen column instead of applying to the whole row |

**If this table is empty:** N/A — five assumptions recorded above, none load-bearing for whether the
phase can be planned, but A1 and A4 should be confirmed before the plan is executed rather than after.

## Open Questions

1. **What are the closed-vocabulary member values for the `entry trigger` tag?**
   - What we know: `structure` = {calendar, diagonal} `[CITED:
     docs/rebuild-research/trading-journal-research.md:789-790]` (quoted: "structure (calendar or
     diagonal)"). `exit reason` = {target, stop, roll, settlement} `[CITED: same source, same
     lines]` (quoted: "exit reason (target, stop, roll, settlement)"). `plan-followed` = {yes, no}
     `[CITED: same source]` (quoted: "plan-followed (yes/no, the one set at close)") — modeled as a
     `Boolean`, not a CHECK-constrained text column, per D10-15.
   - What's unclear: `entry trigger` is described only as "which rule fired"
     `[CITED: docs/rebuild-research/trading-journal-research.md:789]` — no enumeration exists
     anywhere searched (`docs/learnings/`, `knowledge-base/`, `salvage/`, `docs/rebuild-research/`).
     The nearest adjacent material — `R008`'s four refuted *automated selection* heuristics
     (IV-rank gate, back-minus-front differential, fair-debit percentage, OTM-strike monotonicity,
     `[VERIFIED: docs/learnings/refuted.md:86-96]`) — describes criteria that were killed as
     *automated picker rules*, not proposed as a manual entry-trigger tag vocabulary, and reusing
     them here would misattribute a refuted claim's context to an unrelated field.
   - Recommendation: do not invent this vocabulary during planning. Confirm with the user directly
     (a short, cheap question) before the migration's `CHECK` constraint for `entry_trigger` is
     written — this is exactly the situation D10-08 anticipated ("Where the record is silent,
     research decides and records its source" — this research's honest finding is that the record
     is silent and the safe default is to ask, not to fabricate). If the plan must proceed without
     that confirmation, the least-risky placeholder is a single-member vocabulary (e.g., only
     `"manual"`) that a later migration can widen — never a plausible-sounding invented set, since
     D10-06 makes every member of this list a permanent, hard-to-walk-back commitment (rejecting a
     legitimate value the user actually uses is the opposite failure from D10-06's own stated
     concern, but no less real).

2. **Is `invalidation_trigger`'s "if-then form" (INTENT-02) validated as a parsed structure, or
   free text?**
   - What we know: the source material calls it "text, if-then form" with an example — "*if SPX
     closes below X, close the calendar*" `[CITED: docs/rebuild-research/analyzer-and-journal-spec.md:674]`.
   - What's unclear: nothing in the record proposes a machine-parseable if/then schema (two
     structured fields, a condition type enum, etc.) — every mention treats it as prose the user
     writes in a conventional shape.
   - Recommendation: treat as free text (one encrypted `Text` column), matching `thesis`. Do not
     build a parser or a structured condition type — nothing in `10-CONTEXT.md` or the source
     material asks for one, and doing so would be exactly the "flexibility that wasn't requested"
     this project's own engineering discipline warns against.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (new) | Unchanged — reuses existing `get_current_user`/session-cookie dependency |
| V3 Session Management | no (new) | Unchanged |
| V4 Access Control | yes | RLS `user_isolation` policy on both new tables (matching every existing user-scoped table), plus the column-scoped GRANT for the immutability gate (Pattern 2) |
| V5 Input Validation | yes | Pydantic `ApiModel` (`strict=True`, `extra="forbid"`) at the API boundary; `StrEnum` for tag fields; `StrictDecimalField`/`UsdField` for money fields, matching `money/api_types.py`'s existing pattern |
| V6 Cryptography | yes | AES-256-GCM via `crypto/envelope.py`, unchanged — never hand-rolled; fresh nonce per `encrypt_field` call, per-row AAD binding |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A caller bypasses the service layer and edits/deletes a frozen entry-intent row directly via SQL | Tampering | The `BEFORE UPDATE OR DELETE` trigger (Pattern 1) — this is precisely the threat criterion 2 names, and the reason a trigger rather than an app-level guard is required |
| A ciphertext row is copied onto a different row (row-substitution) | Tampering | Per-row AAD binding on `encrypt_field`, following `fills.py`'s existing convention (Pattern 4) |
| A free-text tag value smuggled past validation | Tampering / Elevation via bad data | `CHECK` constraint at the database layer (D10-05) — the layer "no caller can route around" |
| Cross-tenant read/write of another user's entry-intent or close-record row | Information Disclosure / Tampering | `ENABLE`+`FORCE` RLS with a `user_isolation` policy, no admin clause, matching every existing trading table (`tests/test_isolation.py`'s existing parametrized guard should be widened to include the two new tables) |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest, per `pyproject.toml` (`pytest==9.1.1`), already configured |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` (existing) |
| Quick run command | `uv run pytest -q` (~13s locally, per `CLAUDE.md`) |
| Full suite command | `bash tools/gate.sh` (pytest + ruff + basedpyright + mypy) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTENT-01..05 | Entry-intent capture round-trips encrypted, rejects invalid tags | unit + db | `uv run pytest tests/ledger/test_intent.py -x` | ❌ Wave 0 |
| INTENT-06 | A raw SQL UPDATE/DELETE against an opened position's intent row is rejected | db | `uv run pytest tests/test_intent_immutability.py -x` | ❌ Wave 0 |
| INTENT-07 | Close record requires `plan_followed` + note together, editable after write | unit + db | `uv run pytest tests/ledger/test_intent.py -x -k close_record` | ❌ Wave 0 |
| INTENT-08 | A tag outside the closed vocabulary is rejected at both the Postgres and Pydantic layers | unit + db | `uv run pytest tests/ledger/test_intent.py -x -k tag` | ❌ Wave 0 |
| (cross-cutting) | Money-column naming gate covers every new encrypted money column | unit | `uv run pytest tests/test_money_column_naming.py -x` | ✅ (existing file, extend `_UNIT_EXEMPT_BINARY_COLUMNS`) |
| (cross-cutting) | RLS isolation covers the two new tables | db | `uv run pytest tests/test_isolation.py -x -k entry_intent` | ✅ (existing file, widen `_NEW_TRADING_TABLES`-equivalent parametrization) |

### Sampling Rate

- **Per task commit:** `uv run pytest -q` (targeted to the new test files as they're written)
- **Per wave merge:** `bash tools/gate.sh`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/ledger/test_intent.py` — covers INTENT-01..05, INTENT-07, INTENT-08's Pydantic layer
- [ ] `tests/test_intent_immutability.py` — covers INTENT-06's structural proof (criterion 2), the
      raw-SQL-bypass shape from Pitfall 4
- [ ] `tests/api/test_intent_routes.py` — covers the three new routes end-to-end
- Framework install: none — pytest, pytest-asyncio, and every fixture convention already exist
      (`tests/ledger/conftest.py`, `tests/identity/conftest.py`)

## Sources

### Primary (HIGH confidence — read directly this session)

- `src/morai/db/models.py` (full file) — every existing table's ORM shape, the `_write_token`
  sentinel pattern, the `Event`/`Position` docstrings establishing D10-01's own reasoning
- `src/morai/crypto/envelope.py`, `src/morai/crypto/data_keys.py` — the encryption primitives to reuse
- `src/morai/ledger/fills.py`, `src/morai/ledger/positions.py` — the encrypt-at-write-path and
  `create_positions`/`derive_position_state` shapes
- `src/morai/api/models.py`, `src/morai/api/routes_reconciliation.py`, `src/morai/api/app.py`,
  `src/morai/api/errors.py` — API conventions to follow
- `src/morai/identity/sessions.py` — `get_current_user`/RLS-context wiring to reuse unchanged
- `src/morai/ingest/schwab_sync.py:471-472` — confirmed `create_positions` runs before `sync_events`
  in the same transaction, settling Pitfall 2/Summary point 1
- `alembic/versions/0002_procrastinate_schema.py:440-660` — the only existing trigger DDL in this
  repo, establishing the PL/pgSQL dialect Pattern 1 follows
- `alembic/versions/0016_reconciliation_runs.py` (full file) — the closest existing migration analog
  (CHECK-constrained closed vocabulary, RLS, GRANT discipline)
- `alembic/versions/0007_data_key_and_fills.py`, `0011_broker_transactions.py`,
  `0012_sync_runs.py` — GRANT pattern precedent (no table-wide UPDATE on append-mostly tables)
- `tests/test_isolation.py`, `tests/ledger/test_roll_check_constraint.py`,
  `tests/ledger/test_schema_contract.py`, `tests/test_money_column_naming.py` (full files) — test
  conventions, and the exact gate Pitfall 1 will trip
- `docs/rebuild-research/trading-journal-research.md:640-800` — the tag vocabulary source (D10-08)
- `docs/rebuild-research/analyzer-and-journal-spec.md:990-1070` — the pre-trade record spec (write-
  once at OPEN, thesis/invalidation/DTE/stop shape)
- `docs/learnings/refuted.md:86-96` (R008) — checked and ruled out as a source for `entry_trigger`
  member values
- `pyproject.toml` — live version pins for every library this phase reuses
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`,
  `security_asvs_level: 1`

### Secondary (MEDIUM confidence)

- WebSearch, this session, confirming Postgres column-level `GRANT`/`REVOKE UPDATE (column)` syntax
  and its asymmetric interaction with table-level grants, cross-checked against
  `postgresql.org/docs/current/sql-grant.html` and `postgresql.org/docs/current/ddl-priv.html`
  (titles returned by the search, not independently refetched byte-for-byte this session — treat the
  exact wording as MEDIUM, the existence and direction of the behavior as settled)

### Tertiary (LOW confidence)

- None used as a load-bearing claim. The one genuine gap (`entry_trigger` member values) is left
  explicitly open rather than filled from a low-confidence source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new library, every version pin read live from `pyproject.toml`
- Architecture (trigger, grant, encryption reuse): HIGH — every pattern verified against this
  codebase's own source, not recalled from training data
- Architecture (position-link timing, table split): MEDIUM — resolves a real tension in
  `10-CONTEXT.md`'s own text via direct evidence (`schwab_sync.py`'s call order) but the resolution
  itself is this research's inference, not a restated decision — flagged in Assumptions Log
- Pitfalls: HIGH — each one is either a real, existing project test (`test_money_column_naming.py`,
  `test_roll_check_constraint.py`) or a directly quoted tension in the source CONTEXT.md
- Tag vocabulary (`entry_trigger`): LOW, deliberately left open rather than guessed

**Research date:** 2026-09-02
**Valid until:** No expiry driver — nothing in this phase depends on an external vendor API or a
fast-moving library; the only staleness risk is a future migration changing `events.event_type`'s
CHECK values or the `create_positions`/`sync_events` call order, which would be a Phase 7/9-touching
change orthogonal to this phase.
