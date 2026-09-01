# Phase 5: Fill Pairing and the Oracle Gate - Research

**Researched:** 2026-08-31
**Domain:** Pure-Python domain derivation (fills → ledger events) over an existing encrypted
Postgres schema. No new library, no new vendor, no new endpoint.
**Confidence:** HIGH — every load-bearing claim in this document is either read directly from
this repo's own code this session, or transcribed verbatim from `salvage/oracle-fixtures.md`
and cross-checked against `docs/learnings/LAWS.md`'s numbered entries.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D5-01 — Build OPEN/CLOSE fully; ROLL only as the negative guard.** The oracle contains no
ROLL and no SETTLE at all — all 13 calendars are OPEN/CLOSE pairs, and the suite's own global
invariant is "exactly 4 events per calendar, all OPEN or CLOSE — never a spurious ROLL." Build
OPEN/CLOSE derivation fully. Implement `detect_roll`'s strict same-strike/same-type/same-root
requirement only as the guard that prevents a spurious ROLL — exercised through the `60c46a57`/
`24f1e72e` pair (one broker order, `1006797510202`, closing one calendar and opening another at
a *different* strike), which must be treated as 2 ordinary CLOSE fills + 2 ordinary OPEN fills,
never a single roll event. Positive ROLL and SETTLE derivation is deferred to a phase with a
real fixture for it.

**D5-02 — Prove criterion 2 by absence, not by adding a decoy column.** Phase 3's `positions`
table has no status column — only `opened_at`/`closed_at`. Satisfy the criterion's intent two
ways, without reintroducing the field: (1) a gate meta-test asserting no derivation path reads
any position state field at all; (2) the 14th synthetic fixture
(`00000000-0000-4000-8000-000000000099`) as the live negative control — a genuinely-open
calendar with exactly one OPENING order and no CLOSE anywhere must NOT be auto-closed.

**D5-03 — Seeded-fault suite for OPS-06, not a full mutation run.** No mutation tool is pinned
in `pyproject.toml`. Hand-inject exactly the three fault classes the criterion names
(sign-flip, rounding, off-by-one) into the ledger derivation and assert the suite catches each
one. Pin a full mutation tool (`mutmut`, `cosmic-ray`) later only if it fits the gate's time
budget — do not add one speculatively in this phase.

**D5-04 — Fee-free arithmetic, with fee modelled as an explicit `None`.** The oracle's
convention is fee-free: `openNetDebit`/`closeNetCredit` come from `avgPrice × qty`, never from
the broker's `netAmount` (which bakes in ~$1–2/leg commission). This collides with the
project's core value (realised P&L must equal the broker's fee-inclusive cash delta) — both
cannot be true in this phase. Derive fee-free so the oracle passes at 2 decimal places.
Represent commission as an explicit `None` — never `0`, never omitted (`NN-16`). A `None`
forces Phase 9's reconciliation invariant to confront the missing fees at a typed boundary; a
`0` would let the cash-delta check drift by 2–3¢/leg for a reason nobody can find.

### Claude's Discretion

- How the 52 oracle fills are represented as data (module of typed literals vs. a JSON
  fixture), provided they are seeded **through `insert_fills`** — never a fixture-only path.
- The exact split between the pure derivation core and the DB read/write shell, following
  `derive_connection_health`'s own precedent: a pure function with its inputs passed in
  explicitly, so the same call serves both the unit proof and the caller.
- The idempotency mechanism, given `events.fill_ids_hash` already exists in the schema.
- How an unresolved fill is represented (`NN-11` requires explicitly unresolved, never guessed).
- Decimal comparison at 2dp — `quantize` vs. an absolute-difference bound.

### Deferred Ideas (OUT OF SCOPE)

- **Positive ROLL and SETTLE derivation** (`D5-01`) — needs a fixture of its own.
- **Fee-inclusive arithmetic and the cash-delta reconciliation** (`D5-04`) — Phase 9 owns
  `RECON-01`. This phase hands it an explicit `None`, not a zero.
- **A pinned mutation-testing tool** (`D5-03`) — revisit once the seeded-fault suite exists and
  the gate's time budget is known.
- **`last_synced_at` writes** — Phase 6's ingest owns them.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEDGER-01 | Events are derived from stored fills and are never the primary source of truth | Architecture Patterns — pure/shell split; `insert_events` already has no `_write_token` gate, so a second writer is a live risk this phase's own design (one derivation entry point) must close by convention |
| LEDGER-02 | A fill's OPEN/CLOSE role is classified from `positionEffect`, never from position status | Architecture Patterns — Rule 1/Rule 2; D5-02's absence-based proof |
| LEDGER-03 | A shared-contract fill resolves via other legs in the same order, stays unresolved when no anchor exists | Architecture Patterns — Rule 3, the already-proven disambiguation SQL query |
| LEDGER-09 | Re-deriving events for a `(user, order_id)` scope is idempotent | Architecture Patterns — idempotency via `fill_ids_hash` |
| LEDGER-11 | The 13-calendar oracle passes, including both hard cases | Code Examples — `oracle_seed.py`, `salvage/oracle-fixtures.md` fixture data |
| LEDGER-12 | Recompute is a pure function of stored fills, no broker call | Architecture Patterns — `derive_connection_health` precedent |
| OPS-06 | Mutation testing runs against the ledger and reports surviving mutants | Common Pitfalls / Architecture Patterns — seeded-fault suite mechanism (D5-03) |
</phase_requirements>

## Summary

This phase has almost no research risk in the conventional sense — no new library, no new
vendor call, no new endpoint — because the two hardest artifacts it depends on already exist in
this repo, verified against real data. `salvage/oracle-fixtures.md` is the complete, numbered
specification (13 real calendars, 52 fills, expected net debit/credit to the cent, the four
disambiguation rules, both hard cases explained mechanically). And Phase 3 already proved the
hard part of Rule 3 — the shared-front-leg order-anchor SQL — against live Postgres seeded with
real oracle data, in `tests/ledger/test_plaintext_queries.py`, whose own docstring states it is
`03-RESEARCH.md`'s Code Examples query, adapted for the real `legs` table. `tests/ledger/
oracle_seed.py` already seeds all 13 calendars' 52 fills through `insert_fills` — the one write
path — and exposes each calendar's expected `open_net_debit`/`close_net_credit` as typed data,
ready for this phase's assertions with no re-transcription.

What is new in this phase is entirely in-process Python: (1) call the disambiguation query (or
an equivalent full-order-context read) to resolve each fill to a `position_id`; (2) classify
each resolved fill OPEN/CLOSE from its own `position_effect` (never `side`, never a status
column); (3) net each position's OPEN-classified fills into one `open_debit_usd` and its
CLOSE-classified fills into one `close_credit_usd`, using exact `Decimal` subtraction (the
oracle's inputs are all 2-decimal-place `Decimal`s and `qty` is always an integer, so the
arithmetic is exact — no rounding is introduced anywhere in this phase); (4) write the result
through `insert_events`, gated for idempotency by `fill_ids_hash`.

One discrepancy surfaced by reading the actual schema against the oracle doc's own words is
worth flagging up front: `salvage/oracle-fixtures.md`'s global invariant reads "exactly 4 events
per calendar." This project's `events` table (migration 0008) stores one row per OPEN action and
one row per CLOSE action, each already netting both legs into a single `open_debit_usd`/
`close_credit_usd` — a 2-events-per-calendar model, not 4. See **Assumptions Log** and **Open
Questions** for the full reasoning; the correct restated invariant for this schema is **exactly
2 events per calendar (1 OPEN + 1 CLOSE), never a spurious ROLL**, and the planner should adjust
the literal assertion accordingly rather than porting "4" unexamined.

**Primary recommendation:** Do not re-derive the disambiguation logic from scratch. Reuse the
proven SQL in `tests/ledger/test_plaintext_queries.py::_DISAMBIGUATION_QUERY` (or an equivalent
full-sweep query with the same shape) as the resolution step, wrap OPEN/CLOSE netting in one
pure function taking `fills`/`legs` as explicit arguments (the `derive_connection_health`
pattern), and drive both the 13-calendar oracle and the seeded-fault suite off that one function.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fill-to-position resolution (order-anchor disambiguation) | Database / Storage | — | Must run in SQL against the plaintext column set (`position_effect`, `occ_symbol`, `order_id`) so no ciphertext column is ever touched for a structural join — D3-02's whole purpose, already proven in `test_plaintext_queries.py`. |
| OPEN/CLOSE classification and net-debit/credit arithmetic | API / Backend | — | Pure Python domain logic over decrypted `Decimal`s (LEDGER-12: no broker call, no session inside the pure function). |
| Idempotent write of derived events | API / Backend | Database / Storage | The write itself goes through `insert_events` (Backend); the pre-write existence check for `fill_ids_hash` reads `events` (Storage) but the decision logic is Backend. |
| Oracle seeding (52 fills through the one write path) | Database / Storage | API / Backend | `insert_fills` performs the encryption (Backend logic) but the seeding is fundamentally populating Storage for the test to read back. |
| Seeded-fault suite (OPS-06) | API / Backend | — | Pure unit-level fault injection against the same pure derivation function — no new tier. |

## Project Constraints (from CLAUDE.md)

- Python 3.13, Pydantic v2 models, `mypy --strict` + basedpyright strict with `reportAny`
  [VERIFIED: `pyproject.toml:43-53`, `typeCheckingMode = "strict"`, `reportAny = "error"`,
  `strict = true`]. No `Any`, no `cast`, no bare `# type: ignore`.
- `decimal.Decimal` end to end in the money path, never `float` — already enforced by
  `tests/test_decimal_canary.py` and `tests/test_money_column_naming.py`, both read this
  session.
- Test-driven: red before green (project-level instruction, reinforced by
  `.claude/rules/workflow.md`'s "cheapest honest red" — an `ImportError` on a module that does
  not exist yet is a real red, no scaffolding needed to manufacture a more satisfying one).
- Postgres 18 native via Homebrew, not Docker. Full suite ~13s locally per `CLAUDE.md`; this
  phase's own plan should re-measure after landing (the phase's own success criteria don't name
  a time budget, but `.claude/rules/workflow.md`'s "time-box and report" rule applies).
- `NN-1`/`NN-5`/`NN-8`/`NN-9`/`NN-10`/`NN-11`/`NN-16` are explicitly named load-bearing for this
  phase in `05-CONTEXT.md`'s own domain section — see Common Pitfalls below for each, with its
  exact repo citation.
- `.claude/rules/workflow.md`: "Test locally. A CI round-trip is a last resort" and "never build
  temporary scaffolding to produce a more satisfying [red]" apply directly to this phase's
  TDD-driven oracle work.

## Standard Stack

No new external package is needed for this phase — confirmed by reading the phase's own scope
(pure Python derivation over an already-installed stack: SQLAlchemy 2.0 `AsyncSession`, Pydantic
v2 dataclasses, pytest/pytest-asyncio, already `[VERIFIED: pyproject.toml]` present since
Phase 1/3). `hashlib.sha256` (stdlib) is sufficient for `fill_ids_hash` — no new hashing library.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | — | This phase is domain logic over Phase 3's existing write path. |

### Package Legitimacy Audit

**Not applicable — no external package is added, upgraded, or newly imported in this phase.**
The Package Legitimacy Gate is a no-op here; skip straight to implementation-level research.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │   tests/ledger/oracle_seed.py            │
                    │   seed_oracle(): 52 real fills            │
                    └───────────────┬───────────────────────────┘
                                    │  insert_fills()  (the one write path,
                                    │  D3-13 — encryption happens inside it)
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │   Postgres: fills (encrypted price/qty,  │
                    │   plaintext order_id/occ_symbol/         │
                    │   position_effect), legs, positions       │
                    └───────────────┬───────────────────────────┘
                                    │  read_fills()  (decrypt)
                                    │  + disambiguation SQL (plaintext-only join)
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │   PURE CORE (new, this phase)             │
                    │   resolve fill → position_id (Rule 3)     │
                    │   classify fill → OPEN/CLOSE (Rule 1/2)   │
                    │   net per (position_id, direction)        │
                    │      → open_debit_usd / close_credit_usd  │
                    │   detect_roll() guard (Rule 4's cousin,   │
                    │      D5-01 — negative-only this phase)    │
                    │   hash_fill_ids() → fill_ids_hash          │
                    │   Inputs explicit, no session, no clock,  │
                    │   no broker call (LEDGER-12)               │
                    └───────────────┬───────────────────────────┘
                                    │  EventWrite[]
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │   SHELL: idempotency check (read_events,  │
                    │   compare fill_ids_hash) then              │
                    │   insert_events()  (the one write path)   │
                    └───────────────┬───────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │   Postgres: events (2 per calendar:       │
                    │   1 OPEN, 1 CLOSE — see Assumptions Log)  │
                    └─────────────────────────────────────────┘

     Oracle gate (test): assert openNetDebit/closeNetCredit for all 13 + the
     14th synthetic negative control, replayed in real processing order
     (positions descending by opened_at — 8a63aa81 before 6303e6af).
```

### Recommended Project Structure

```
src/morai/ledger/
├── fills.py           # existing — insert_fills/read_fills, unchanged
├── events.py           # existing — insert_events/read_events, unchanged
└── pairing.py           # NEW — pure derivation core + the shell that calls it
    #   classify_fill(position_effect) -> OPEN | CLOSE | UNKNOWN   (Rule 1)
    #   resolve_fill_positions(fills, legs) -> dict[fill_key, position_id | None]  (Rule 3)
    #   derive_events(fills, legs) -> list[EventDraft]   (pure; LEDGER-12)
    #   hash_fill_ids(fill_keys) -> str
    #   detect_roll(...) -> bool   (guard only, D5-01)
    #   sync_events(session, user_id, fills, legs) -> None   (shell: derive + idempotency + insert_events)

tests/ledger/
├── oracle_seed.py                     # existing — 52 fills, 13 calendars, expected figures
├── test_plaintext_queries.py           # existing — proves the disambiguation query itself
├── test_oracle_gate.py                 # NEW — the 13+1 parametrized oracle suite (LEDGER-11)
├── test_pairing_idempotency.py         # NEW — LEDGER-09
└── test_pairing_seeded_faults.py       # NEW — OPS-06 (D5-03)
```

This is a proposal, not a lock — `05-CONTEXT.md`'s own "Claude's Discretion" leaves the pure/
shell module split to the planner. The one hard requirement from LEDGER-12 is that the pure
part takes `fills`/`legs` as plain in-memory arguments (already-decrypted `FillRecord`s, already
read `Leg` rows) and returns data — no `AsyncSession`, no `datetime.now()`, no broker call inside
it — mirroring `derive_connection_health(token_created_at, now)`'s own shape
[VERIFIED: `src/morai/vendor/connections.py:136-169`, full function body read this session].

### Pattern 1 — Rule 1: classify a fill from `positionEffect`, never `side`

**What:** `positionEffect: "OPENING" | "CLOSING" -> "OPEN" | "CLOSE"`. `side` is not consulted.
**When to use:** Every fill, unconditionally, at the point it enters aggregation.
**Why:** `side` (buy/sell) is ambiguous for this purpose — closing a short leg is a "buy," and
closing a long leg is a "sell," mirroring the two opening sides exactly.
**Evidence:** `salvage/oracle-fixtures.md` Rule 1 [CITED: this repo,
`salvage/oracle-fixtures.md:318-336`]; `docs/learnings/LAWS.md` L071 (fill classification, four
rules) [CITED: `docs/learnings/LAWS.md:699-705`].

```python
# Illustrative — not yet in the codebase; shape only, no code example exists in this repo to cite.
def classify_fill(position_effect: str) -> Literal["OPEN", "CLOSE", "UNKNOWN"]:
    if position_effect == "OPENING":
        return "OPEN"
    if position_effect == "CLOSING":
        return "CLOSE"
    return "UNKNOWN"
```

### Pattern 2 — Rule 2: derive classification from the fill's own field, never a status column

**What:** Nothing in the derivation path reads `positions.status` — because Phase 3 never
created that column [VERIFIED: `src/morai/db/models.py:206-232`, the full `Position` class body
read this session — its only temporal columns are `opened_at: Mapped[datetime | None]` and
`closed_at: Mapped[datetime | None]`, no `status` field anywhere in the class]. This makes Rule
2 structurally impossible to violate by omission, not merely a convention — D5-02's own point.
**Evidence:** `salvage/oracle-fixtures.md` Rule 2 [CITED: `salvage/oracle-fixtures.md:338-354`];
`docs/learnings/LAWS.md` L022 (read a directional signal once at its authoritative source)
[CITED: `docs/learnings/LAWS.md:253-260`]; `NN-9` [VERIFIED: `REBUILD-BRIEF.md:136`, quoted
verbatim: "Direction comes from the vendor's own signed field, read once at the boundary and
threaded through. Never re-derived from a mutable application column."].

### Pattern 3 — Rule 3: order-anchor disambiguation, already proven in this repo

**What:** Within one broker order, a leg (`occ_symbol`) matching exactly one position is an
"anchor" for that order. Every other fill in the same order resolves to that anchor's
`position_id` **only if** the anchor set intersected with the fill's own candidate set is a
singleton — otherwise the fill stays unresolved (`NULL`), never guessed.

**This exact SQL is already proven against real Postgres 18.6, seeded with real oracle data,
in this repo** — do not re-derive it:

```sql
-- Source: tests/ledger/test_plaintext_queries.py:73-108, read verbatim this session.
-- Adapted from 03-RESEARCH.md's Code Examples: `position_legs` selects over `legs`
-- (this schema's real table).
WITH position_legs AS (
    SELECT position_id, user_id, occ_symbol FROM legs
),
fill_candidates AS (
    SELECT f.user_id, f.order_id, f.occ_symbol, f.leg_index, f.execution_time,
           pl.position_id
    FROM fills f
    JOIN position_legs pl
      ON pl.user_id = f.user_id AND pl.occ_symbol = f.occ_symbol
),
anchors AS (
    -- Postgres has no MIN(uuid) aggregate; the text-cast round trip picks
    -- an arbitrary representative, safe here only because HAVING already
    -- restricts this group to exactly one distinct value.
    SELECT user_id, order_id, occ_symbol, MIN(position_id::text)::uuid AS position_id
    FROM fill_candidates
    GROUP BY user_id, order_id, occ_symbol
    HAVING COUNT(DISTINCT position_id) = 1
),
order_anchors AS (
    SELECT DISTINCT user_id, order_id, position_id FROM anchors
)
SELECT fc.order_id, fc.occ_symbol, fc.leg_index, fc.execution_time,
    (SELECT oa.position_id FROM order_anchors oa
      WHERE oa.user_id = fc.user_id AND oa.order_id = fc.order_id
        AND oa.position_id IN (
          SELECT position_id FROM fill_candidates fc2
          WHERE fc2.user_id = fc.user_id AND fc2.order_id = fc.order_id
            AND fc2.occ_symbol = fc.occ_symbol AND fc2.leg_index = fc.leg_index
            AND fc2.execution_time = fc.execution_time
        )
    ) AS resolved_position_id
FROM fill_candidates fc
GROUP BY fc.user_id, fc.order_id, fc.occ_symbol, fc.leg_index, fc.execution_time
```

**Verified this session (re-read, not re-run):** `test_disambiguation_query_resolves_shared_
front_leg_calendars` [VERIFIED: `tests/ledger/test_plaintext_queries.py:332-370`] asserts all 8
fills across `8a63aa81`/`6303e6af` resolve correctly by exact `position_id` equality, including
the shared front symbol `SPXW260618P07275000` anchoring to the right calendar in each of its
four orders. `test_disambiguation_query_leaves_unanchored_order_unresolved`
[VERIFIED: `tests/ledger/test_plaintext_queries.py:373-388`] proves the negative case: two
positions sharing **both** legs produce `NULL`, never a guess (`NN-11`).

**What this phase must add on top:** this query resolves `(order_id, occ_symbol, leg_index,
execution_time) -> position_id`. It does not classify OPEN/CLOSE, net the amounts, or write
`events`. Those three steps are new this phase.

**Evidence:** `salvage/oracle-fixtures.md` Rule 3 and Hard Case 1 [CITED:
`salvage/oracle-fixtures.md:356-377,257-292`]; `docs/learnings/LAWS.md` L070 [CITED:
`docs/learnings/LAWS.md:691-697`]; `NN-11` [VERIFIED: `REBUILD-BRIEF.md:138`, quoted verbatim:
"Resolve an ambiguous fill-to-position match using co-occurring data from the same real
transaction (the order id), never by guessing and never by orphan-parking unconditionally."].

### Pattern 4 — Hard case 1's second layer: read the whole order, not the calendar's own legs

**What breaks:** a per-calendar *scoped* read (fetch only fills matching this calendar's own
registered legs) never sees a sibling calendar's unique back leg, so the disambiguation logic
above has no anchor to work with even when correctly written.

**Why the proven query above already avoids this bug class:** it is a **full sweep** —
`fill_candidates` joins every fill for the user against every leg for the user, not scoped to
one position's own legs first. The anchor computation groups by `(user_id, order_id,
occ_symbol)` across the whole join, so all four legs of a shared order are visible to the query
simultaneously regardless of which position "owns" the read. **The lesson from `L061`/Test C
(replaying `positions` descending by `opened_at`, which puts `8a63aa81` before `6303e6af`) is
therefore a constraint on how this phase's derivation is *invoked*, not on the query's own
shape**: if a future caller narrows this query's `fill_candidates` CTE to `WHERE position_id =
:one_position`, the exact class of bug L061 describes reappears. Do not scope-narrow that CTE.
The pure core's `derive_events(fills, legs)` should accept the *whole* fill/leg set for the
scope it's asked to process (a user, or a set of `order_id`s) — never a single position's own
registered legs.

**Evidence:** `salvage/oracle-fixtures.md`'s "second layer" narrative [CITED:
`salvage/oracle-fixtures.md:278-292`]; `docs/learnings/LAWS.md` L061 (a widened read context
needs a symmetrically widened reset context) [CITED: `docs/learnings/LAWS.md:619-625`], which
also names the reset-side half of this bug (irrelevant here since this phase never marks a fill
"processed" — recomputation always reads the same immutable `fills` table, see Pattern 6).

**Proof obligation for the plan:** a test that seeds `8a63aa81` and `6303e6af` together
(`seed_oracle(..., calendar_ids=["8a63aa81", "6303e6af"])` — the existing helper already
supports this), derives events in the real processing order (by `opened_at` ascending or
descending — the fixture's own dates put `6303e6af` opened 2026-05-19 *before* `8a63aa81`
opened 2026-06-09, so "descending by `opened_at`" processes `8a63aa81` first, matching the
oracle doc's own stated order), and asserts both converge to their correct
`open_net_debit`/`close_net_credit` with zero unresolved fills — including on a second,
idempotent re-derivation.

### Pattern 5 — Rule 4 and D5-02: what this phase does NOT need to build

Rule 4 ("net quantity per leg decides closed, never a status column") governs whether a
*position* is closed — that is `LEDGER-05`, explicitly Phase 7's requirement [VERIFIED:
`.planning/ROADMAP.md:213-228`, Phase 7's own success criteria and requirement list read this
session]. This phase does not compute or store a closed/open state. What Phase 5 must prove
instead, per D5-02, is narrower: the 14th synthetic fixture (one OPENING order, no CLOSE order
anywhere) produces exactly **one OPEN event and zero CLOSE events** — nothing in this phase's
derivation path fabricates a CLOSE for it. `open_debit_usd`/`close_credit_usd` staying `NULL`
on the fields that have no fill is already enforced at the DB layer regardless (both columns are
nullable, migration 0008), so the assertion is behavioral (event count and type), not
schema-level.

### Pattern 6 — the pure/shell split (LEDGER-12)

**Precedent, read this session:** `derive_connection_health(token_created_at: datetime, now:
datetime) -> tuple[ConnectionHealth, datetime]` [VERIFIED: `src/morai/vendor/connections.py:
136-169`]. `now` is an ordinary parameter, never read from the system clock inside the function
— "the exact same call proves this module's own boundary tests and serves `GET /schwab/
connection`, so the route cannot drift from what the tests assert" (its own docstring, quoted
verbatim).

**The analogous shape for this phase:**

```python
# Illustrative signature — not yet in the codebase.
def derive_events(
    fills: list[FillRecord],   # already-decrypted, from read_fills()
    legs: list[LegRecord],      # plaintext, no decryption needed
) -> list[EventDraft]:
    """Pure. No AsyncSession, no clock, no broker call (LEDGER-12).
    Same call serves the 13-calendar oracle test and the real sync shell."""
```

The shell (`sync_events(session, user_id)` or similar) is the only thing that touches
`AsyncSession`: it calls `read_fills`/reads `legs`, calls the pure `derive_events`, does the
idempotency check (Pattern 7), and calls `insert_events`. This is the same split
`derive_connection_health` vs. its caller in `routes_connections.py` already establishes as this
codebase's convention — reuse it, don't invent a second shape.

**Honest limit to state in the pure function's own docstring**, mirroring
`derive_connection_health`'s own "D4-15's honest limit" paragraph: this function is proven
correct against the 13 real oracle calendars plus the 14th synthetic and the seeded-fault suite
— it is not proven against Schwab's live payload shape, which Phase 6 first exercises for real.

### Pattern 7 — idempotency via `fill_ids_hash` (LEDGER-09)

**What exists:** `events.fill_ids_hash: Mapped[str | None]` [VERIFIED: `src/morai/db/models.py:
345`, quoted: `fill_ids_hash: Mapped[str | None] = mapped_column(Text, nullable=True)`],
documented in migration 0008 as "a join key making event re-derivation idempotent (LEDGER-09)"
[VERIFIED: `alembic/versions/0008_positions_legs_events.py`, docstring lines read this session].
**No uniqueness constraint exists on it** — migration 0008 defines exactly two `CHECK`
constraints (`events_event_type_check`, `roll_has_both_legs`) and no `UNIQUE`/index on
`fill_ids_hash` [VERIFIED: `alembic/versions/0008_positions_legs_events.py`, full `create_table`
call for `events` read this session — only the two named `CheckConstraint`s appear]. Idempotency
must therefore be enforced at the application layer, not by the database.

**Recommended mechanism** (this is the "Claude's Discretion" item CONTEXT.md explicitly leaves
open — proposed, not locked): compute `fill_ids_hash` as a deterministic hash of the **sorted**
natural keys of the fills composing one event — mirroring v1's own `hashFillIds`, whose
`invariants.md` entry states it "sorts ids then `':'`-joins before hashing (order-independent by
construction)" [CITED: `salvage/invariants.md:177`]. A fill has no surrogate id in this schema
(composite PK only — see Pitfall below), so the natural key tuple `(order_id, occ_symbol,
leg_index, execution_time)` is what gets sorted and joined, then hashed with `hashlib.sha256`
(stdlib — no new dependency). Before writing a derived event for a `(position_id, event_type)`
pair, read existing events for that scope; if one already carries the same `fill_ids_hash`,
skip the write entirely (no `insert_events` call for that event); if the hash differs or no
prior event exists, insert. This is a **read-compare-skip** pattern, not delete-then-rewrite —
consistent with `events`' own grants: migration 0008 grants `SELECT, INSERT, DELETE` and
explicitly no `UPDATE` [VERIFIED: `alembic/versions/0008_positions_legs_events.py`, grant loop
read this session], so a "correct an existing wrong event" path (if ever needed) would have to
be delete-then-reinsert, never an in-place update — but plain idempotent re-derivation over
unchanged fills should never reach that path at all.

**Evidence for why re-derivation must be re-runnable safely:** `docs/learnings/LAWS.md` L069 (a
two-step wipe-then-reingest is not atomic across the step boundary) [CITED:
`docs/learnings/LAWS.md:683-689`] — motivates *not* defaulting to delete-then-rewrite as the
primary idempotency mechanism, since a crash between delete and reinsert would leave a scope
with zero events rather than stale-but-present ones.

### Pattern 8 — Decimal comparison: exact equality is achievable and stronger than 2dp tolerance

The original TypeScript suite used `toBeCloseTo(expected, 2)` because JS numbers are IEEE-754
floats. This codebase is `Decimal` end to end. Every fill price in `salvage/oracle-fixtures.md`
is quoted to exactly 2 decimal places (e.g. `159.41`, `127.06`), and every oracle quantity is
`1` [VERIFIED: `tests/ledger/oracle_seed.py:548`, `quantity=Decimal("1")` for every
`FillWrite`]. Python's `decimal.Decimal` subtraction and integer-quantity multiplication are
**exact** (no floating-point rounding, arbitrary precision by default) — `Decimal("62.5") -
Decimal("52.3")` yields exactly `Decimal("10.2")`, not an approximation. This means the plan can
assert **exact** `Decimal` equality (`assert computed == expected`) rather than porting the
`toBeCloseTo`-style tolerance, which would be a weaker check than what this codebase's own
money-handling discipline already buys for free.

Still worth a defensive helper for the 2-decimal-place *contract* itself (distinct from
per-fixture exactness): `expected.quantize(Decimal("0.01")) == actual.quantize(Decimal("0.01"))`
documents that the derivation is contractually a 2dp figure and would catch a future regression
that introduces spurious extra precision (e.g. a non-integer quantity) without weakening
today's exact-equality assertions. No such helper exists yet in this repo — `tests/
test_decimal_canary.py` [VERIFIED, full file read this session] proves float-bit-inexactness,
not a 2dp-rounding convention; this phase would be the first to need one.

### Pattern 9 — seeding through `insert_fills`: already built, read it before writing anything new

`tests/ledger/oracle_seed.py` [VERIFIED, full file read this session, 557 lines] already:
- Transcribes all 13 `_CalendarSpec`s from `salvage/oracle-fixtures.md` with exact `Decimal`
  string literals for every price and every expected `open_net_debit`/`close_net_credit`.
- Builds OCC symbols programmatically (`occ_symbol_for`), never hand-typed, so a transposition
  across 52 symbols is structurally impossible.
- `seed_oracle(superuser_session, app_session, user_id, *, calendar_ids=None)` inserts
  `positions`/`legs` on the superuser session (Phase 3 landed the DDL only, no dedicated write
  path for those two tables — noted in the function's own docstring) and **every fill through
  `insert_fills`** [VERIFIED: `tests/ledger/oracle_seed.py:540-554`], returning `calendar_id ->
  position_id`.
- Supports a `calendar_ids` filter to seed a subset (already used by `test_plaintext_queries.py`
  to seed only the two shared-front-leg calendars for Rule 3's own proof).

**This phase's oracle test does not need a new seeding path.** It needs: call `seed_oracle` for
all 13 (`calendar_ids=None`) plus a new 14th synthetic-fixture seed helper (not yet built — the
14th fixture is not in `_CALENDAR_SPECS`, since it has only one OPENING order and no CLOSE, a
different shape from the other 13's open+close pair), then call the new `derive_events`/
`sync_events`, then assert against `ORACLE_CALENDARS`' own `open_net_debit`/`close_net_credit`
fields — no re-transcription of the fixture numbers.

**Chunking (`NN-5`):** `insert_fills` already chunks at `_CHUNK_SIZE = 2000`
[VERIFIED: `src/morai/ledger/fills.py:56,175-176`] — irrelevant at 52 rows, but confirms nothing
new is needed here since the oracle's full 52-fill seed is already routed through this path.

### Pattern 10 — the seeded-fault suite (OPS-06, D5-03)

No mutation-testing tool exists in this stack yet [VERIFIED: `grep` for `mutmut`/`cosmic-ray` in
`pyproject.toml` returns nothing this session]. `tests/gate/test_type_gate.py`'s own pattern
(run a real checker as a subprocess against a deliberately-broken fixture, assert it reports the
*specific* rule marker, not just a nonzero exit code) [VERIFIED, full file read this session] is
the closest existing precedent in this repo for "prove a guard has teeth," but it is a
compile-time-checker harness, not applicable to a runtime arithmetic fault.

**Recommended mechanism** (D5-03's own wording: "Hand-inject exactly the three fault classes
... into the ledger derivation and assert the suite catches each one"): a small,
`pytest.mark.parametrize`d suite that wraps the pure `derive_events` (or its innermost
arithmetic helper) with three deliberately-broken variants, constructed via `monkeypatch` or by
calling an alternate code path built only for the test:

1. **Sign-flip fault** — negate one leg's price before subtraction (`open_debit_usd = -(buy -
   sell)` or similar). Assert the oracle assertion (`computed == expected`) now fails — this is
   `LEDGER-01`'s own historical failure mode: `L022`/`NN-9` describe the real production sign
   bug this class reproduces [CITED: `docs/learnings/LAWS.md:253-260`].
2. **Rounding fault** — round an intermediate price to a coarser precision (e.g. `Decimal("1")`)
   before subtracting. Assert the oracle catches the resulting mismatch.
3. **Off-by-one fault** — swap `leg_index`/use the wrong fill in a pair (e.g. pair a CLOSE fill
   with the wrong OPEN fill, or an off-by-one slice into the fills list). Assert the oracle
   catches it.

Each case asserts `pytest.raises(AssertionError)` around a call to the *real* oracle-comparison
logic fed the *faulted* derivation output — i.e., the test proves the suite is a mutation-killer
for that fault class, not that the fault class cannot occur. This is materially different from
`tests/gate/`'s violation fixtures (which prove a *compile-time* gate fires); here the "gate" is
the oracle's own runtime assertions, and the fault injection proves those assertions are
sensitive enough to fail on a real semantic corruption, not merely well-typed.

**Where to put this:** a new `tests/ledger/test_pairing_seeded_faults.py`, separate from the
`tests/gate/` directory (which `pyproject.toml` excludes from type-checking — not the right home
for a runtime-logic test) [VERIFIED: `tests/gate/test_type_gate.py`'s own docstring, "`pyproject.
toml` excludes `tests/gate/fixtures` from basedpyright, mypy and ruff"].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shared-leg disambiguation SQL | A fresh anchor-resolution query | `tests/ledger/test_plaintext_queries.py::_DISAMBIGUATION_QUERY`, already proven against real Postgres with real oracle data | Rewriting it risks reintroducing exactly the bug (`orphan-park on 2+ candidates`) the proven query already avoids; the existing query's `HAVING COUNT(DISTINCT position_id) = 1` + anchor-intersection subquery is the whole fix (`NN-11`, `L070`). |
| Oracle fixture transcription | Re-typing 52 fills' prices/dates/order-ids from `salvage/oracle-fixtures.md` | `tests/ledger/oracle_seed.py`'s existing `_CALENDAR_SPECS`/`ORACLE_CALENDARS`/`ORACLE_FILLS` | A second transcription of the same 52 numbers is a second place for a transposition to hide — the exact failure class `NN-1`/`L002` warn about for composite keys, generalized to fixture data. |
| Fill-id hashing | A bespoke hash format | `hashlib.sha256` (stdlib) over the sorted, `:`-joined natural key tuple, mirroring v1's `hashFillIds` shape | No new dependency; the order-independence-by-sorting trick is already proven in v1 and costs nothing to reproduce. |
| Mutation testing infra | Installing `mutmut`/`cosmic-ray` this phase | Hand-injected fault cases (D5-03) | Explicitly deferred by the locked decision — no time-budget data exists yet to justify a new tool. |

**Key insight:** almost everything hard about this phase (the shared-leg SQL, the 52-fill
fixture data, the write path) was already built and proven correct in Phase 3. The actual net
new work is the OPEN/CLOSE netting arithmetic and the idempotency/fault-injection tests around
it — keep the diff scoped to that.

## Common Pitfalls

### Pitfall 1 — `Math.abs()`-equivalent on a signed price, destroying direction (`NN-10`)

**What goes wrong:** taking `abs()` of a fill's price or net amount to "normalize" it forces
every downstream reader to re-guess direction from `positionEffect`/`side` instead of the
signed value itself.
**Why it happens:** it looks like harmless normalization when writing arithmetic that "should
always be positive."
**How to avoid:** never call `abs()` on a price or a computed debit/credit in this derivation.
The convention is subtraction order (`buy_price - sell_price` for OPEN, `sell_price -
buy_price` for CLOSE, per `salvage/oracle-fixtures.md`'s own stated formula), not sign-stripping.
**Warning signs:** a computed `open_debit_usd` or `close_credit_usd` that is always positive
regardless of input ordering is a sign this rule was violated.
**Evidence:** `NN-10` [VERIFIED: `REBUILD-BRIEF.md:137`, quoted verbatim: "Never `Math.abs()` a
vendor's signed amount. It is the only field carrying direction."]; `docs/learnings/LAWS.md`
L023 [CITED: `docs/learnings/LAWS.md:261-265`].

### Pitfall 2 — deriving direction from a mutable column instead of the fill's own field (`NN-9`, `L022`)

**What goes wrong:** the round-4 root cause this whole oracle exists to catch — deriving
`positionEffect` externally (from a calendar's current status) instead of from each fill's own
broker-reported field.
**Why it happens:** it's tempting to pass one `positionEffect` value into a batch of fills
belonging to the "same" event, rather than reading each fill's own value.
**How to avoid:** `classify_fill` (Pattern 1) takes exactly one fill's own `position_effect` as
its only input — no batch-level override parameter should exist in its signature at all.
**Warning signs:** a function signature that accepts `positionEffect` as an argument *alongside*
a list of fills is the shape of the historical bug.
**Evidence:** [VERIFIED: `REBUILD-BRIEF.md:136`, `NN-9` quoted above]; `docs/learnings/LAWS.md`
L022 [CITED: `docs/learnings/LAWS.md:253-260`], quoted: "`readCalendarLegs` derived OPEN/CLOSE
from `calendars.status` and applied it uniformly to every fill: a calendar registered open but
carrying a real CLOSE order summed 159.41 − 127.06 − 123.13 + 86.78 = −4.00, exactly the
production regression figure."

### Pitfall 3 — the composite `Fill` primary key has five columns, not four

**What goes wrong:** assuming `Fill`'s PK is the three columns `salvage/oracle-fixtures.md`
emphasizes (`order_id`, `occ_symbol`, `leg_index`) and forgetting `execution_time` is also part
of it, or vice versa.
**Measured fact:** `Fill`'s primary key is `(user_id, order_id, occ_symbol, leg_index,
execution_time)` — five columns, every one marked `primary_key=True`
[VERIFIED: `src/morai/db/models.py:155-163`, quoted verbatim: `user_id: Mapped[UUID] =
mapped_column(..., primary_key=True)`, `order_id: Mapped[str] = mapped_column(Text,
primary_key=True)`, `occ_symbol: Mapped[str] = mapped_column(Text, primary_key=True)`,
`leg_index: Mapped[int] = mapped_column(SmallInteger, primary_key=True)`, `execution_time:
Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)`].
**How to avoid:** when computing `fill_ids_hash`'s natural-key tuple (Pattern 7), use all five
columns' worth of discriminating data if the derivation ever operates across users — within one
user's own derivation, `user_id` is fixed, so the practical natural key is the remaining four.
**Evidence:** `NN-1` [VERIFIED: `REBUILD-BRIEF.md:123`] — "every composite key carries every
column that genuinely discriminates a row — including one whose value is a single literal
today," directly about `leg_index` (always `0` in the oracle data, per `oracle_seed.py`'s own
seeding, but the column exists precisely because "it never varies today" is not "it can never
vary").

### Pitfall 4 — assuming pytest randomizes test order

**What goes wrong:** writing a stateful, order-dependent test (e.g. a "second run" idempotency
test) that silently relies on running immediately after a specific other test, assuming a
`pytest-randomly`-style shuffle would have caught the coupling.
**Measured fact, this session:** no `pytest-randomly` (or any test-order-randomization plugin)
is configured in this project — `pyproject.toml`'s only pytest marker is `db`, and `addopts =
"-q"` carries no `-p randomly` or seed flag [VERIFIED: `pyproject.toml:85-98`, full
`[tool.pytest.ini_options]` block read this session]. Tests run in file/definition order by
default.
**How to avoid:** do not rely on this absence — write the idempotency test (LEDGER-09) as one
self-contained test function that seeds, derives once, derives again, and asserts, rather than
two separate test functions relying on shared fixture state and execution order.
**Correction to the phase's own prompt:** the invocation's `<questions_to_answer>` names
"the `pytest-randomly` ordering already in use" as a pitfall to consider — that plugin is **not
in use** in this repo, verified this session. Treat the absence itself as the fact worth noting,
not the plugin's behavior.

### Pitfall 5 — parallel test runs against one shared local Postgres (`V093`)

**What goes wrong:** two processes (a manual test run plus a background one, or two parallel
agents) truncating/reseeding the same `fills`/`events`/`positions`/`legs` tables mid-test look
like unrelated, non-reproducible failures (`NoResultFound`, `UniqueViolationError`,
`DeadlockDetectedError`) in files neither process touched.
**Why it happens:** `clean_ledger_tables` [VERIFIED: `tests/ledger/conftest.py:44-58`] issues a
`TRUNCATE TABLE events, legs, positions, fills, user_data_keys CASCADE` before every db-marked
test — cheap and correct for one runner, actively destructive against a concurrent one.
**How to avoid:** run this phase's db-marked tests (the oracle suite especially, given its own
13-position/52-fill seed) serially, one process at a time, against local Postgres — do not
background a second `pytest -m db` run while another is in flight.
**Warning signs:** intermittent failures that vary run to run and touch tables the current
change never modified.
**Evidence:** `docs/learnings/vendors-and-infra.md` V093 [CITED:
`docs/learnings/vendors-and-infra.md:951-980`], quoted: "A git worktree isolates the filesystem,
not the database. Parallel agents collide in Postgres."

### Pitfall 6 — `ON DELETE`/rewrite semantics colliding with idempotent re-derivation (`L005`)

**What goes wrong:** if a future correction path deletes-then-reinserts events for a scope,
doing so in two non-atomic steps risks the same shape `L069` describes — a crash between delete
and insert leaves the scope with zero events, which is worse than stale-but-present ones.
**How to avoid:** prefer the read-compare-skip idempotency mechanism (Pattern 7) as the default
path; reserve delete-then-reinsert for an explicit, separately-tested correction operation, not
the routine re-derivation this phase's own criteria describe.
**Evidence:** `docs/learnings/LAWS.md` L005 [CITED: `docs/learnings/LAWS.md:67-71`] and L069
[CITED: `docs/learnings/LAWS.md:683-689`].

## Code Examples

### `FillWrite`/`FillRecord` — the shapes this phase's derivation consumes and produces from

```python
# Source: src/morai/ledger/fills.py:59-88, read verbatim this session.
@dataclass(frozen=True)
class FillWrite:
    order_id: str
    occ_symbol: str
    leg_index: int
    execution_time: datetime
    position_effect: str
    side: str
    quantity: Decimal | None
    price_usd: Decimal | None

@dataclass(frozen=True)
class FillRecord:
    user_id: UUID
    order_id: str
    occ_symbol: str
    leg_index: int
    execution_time: datetime
    position_effect: str
    side: str
    quantity: Decimal | None
    price_usd: Decimal | None
    key_version: int
```

### `EventWrite`/`EventRecord` — what this phase's shell writes and reads

```python
# Source: src/morai/ledger/events.py:60-88, read verbatim this session.
@dataclass(frozen=True)
class EventWrite:
    position_id: UUID
    event_type: str
    event_time: datetime
    fill_ids_hash: str | None
    open_debit_usd: Decimal | None
    close_credit_usd: Decimal | None

@dataclass(frozen=True)
class EventRecord:
    id: UUID
    user_id: UUID
    position_id: UUID
    event_type: str
    event_time: datetime
    fill_ids_hash: str | None
    open_debit_usd: Decimal | None
    close_credit_usd: Decimal | None
    key_version: int
```

`insert_events` raises `ValueError` before any row is added if `event_type == "ROLL"` and either
amount is `None` [VERIFIED: `src/morai/ledger/events.py:144-151`] — irrelevant to this phase's
OPEN/CLOSE-only writes, but confirms the `events` write path already refuses a netted-only ROLL
at the Python layer, matching the `roll_has_both_legs` `CHECK` as a second, DB-level backstop.

### `seed_oracle`'s own signature — reuse, do not reimplement

```python
# Source: tests/ledger/oracle_seed.py:466-494 (signature + docstring), read verbatim this session.
async def seed_oracle(
    superuser_session: AsyncSession,
    app_session: AsyncSession,
    user_id: UUID,
    *,
    calendar_ids: Iterable[str] | None = None,
) -> dict[str, UUID]:
    """Seed real oracle calendars for one user: a `positions` row and two
    `legs` rows per calendar (front/back), and every fill through
    `insert_fills()` -- the one write path (D3-13, D3-14).
    ...
    Returns `calendar_id -> position_id`.
    """
```

## State of the Art

No external state-of-the-art shift applies to this phase — it is entirely in-repo domain logic
over an already-decided stack. The one "old approach → current approach" worth recording is
internal to this project's own history, not the ecosystem:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| v1's per-calendar scoped fill read for rebuild (`readUnprocessedFillsForCalendar`) | A full-sweep/whole-order read (this phase's pure core takes the whole fill/leg set, never one position's own registered legs) | Round-5 fix, documented in `salvage/oracle-fixtures.md` and `L061` | Prevents hard case 1's "second layer" recurring — see Pattern 4. |
| v1's leg-level "4 events per calendar" model | This project's `events` table: 1 netted OPEN row + 1 netted CLOSE row per position | Phase 3's schema design (migration 0008) | See Assumptions Log A1 — the literal invariant count from the source doc does not carry over unchanged. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The correct restated global invariant for *this* schema is "exactly 2 events per calendar (1 OPEN + 1 CLOSE)," not the oracle doc's literal "4 events per calendar" | Summary, Architecture Patterns (diagram) | Medium — if the planner instead builds a leg-level 4-row-per-calendar event model to match the literal source text, it would contradict the `events` table's own design (one netted `open_debit_usd`/`close_credit_usd` per row, proven by the `roll_has_both_legs` CHECK's shape and `events.py`'s own docstring: "A ROLL's two amounts are never netted, never summed here" — implying OPEN/CLOSE amounts, by contrast, *are* netted per-event). Flagged in Open Questions for explicit confirmation before the plan locks a row count assertion. |
| A2 | `hashlib.sha256` over the sorted, colon-joined natural-key tuple is an adequate, unassumed choice for `fill_ids_hash`'s content (mirroring v1's `hashFillIds` shape) | Architecture Patterns, Pattern 7 | Low — this is explicitly left to "Claude's Discretion" in `05-CONTEXT.md`; any deterministic, order-independent hash satisfies LEDGER-09's actual requirement (same input fill set → same hash → skip re-insert). |
| A3 | Read-compare-skip (not delete-then-reinsert) is the right default idempotency mechanism, given `events` has no `UPDATE` grant and `L069`'s wipe-then-reingest non-atomicity warning | Architecture Patterns, Pattern 7 | Low-Medium — also left to discretion; if the planner prefers delete-then-reinsert for simplicity, `L069`'s risk (a crash leaves the scope with zero events) should be named and accepted explicitly, not silently inherited. |
| A4 | The 14th synthetic fixture needs new seeding code (not yet present in `oracle_seed.py`'s `_CALENDAR_SPECS`, which only models 13 open+close pairs) | Architecture Patterns, Pattern 9 | Low — mechanically verifiable by reading `oracle_seed.py`'s own `_CALENDAR_SPECS` tuple (13 entries, confirmed by count this session) against `salvage/oracle-fixtures.md`'s 14-fixture total; the gap is real, not speculative, but the exact helper shape is a planning decision. |

**All four assumptions above are startable-but-unconfirmed judgment calls, not compliance or
security claims** — none require the same escalation `security_enforcement` would demand, but
A1 in particular should be explicitly resolved (confirmed or refuted) before the plan writes a
literal event-count assertion into the oracle suite.

## Open Questions

1. **Does "exactly 4 events per calendar" in `salvage/oracle-fixtures.md` describe this
   project's own `events` table, or v1's different (leg-level) event model?**
   - What we know: this project's `events` table stores one row per OPEN action and one row per
     CLOSE action, each carrying a single netted `open_debit_usd`/`close_credit_usd` — confirmed
     by reading the full DDL (migration 0008) and both `insert_events`'s ROLL-guard logic and
     its own docstring ("A ROLL's two amounts are never netted, never summed here" — implying
     OPEN and CLOSE amounts *are* netted per event, by construction, since each event only ever
     carries one of the two).
   - What's unclear: whether "4" in the source doc refers to a *fill-bucket* concept
     (`aggregatePartialFills`'s "AggregatedFill" — one per (calendar, leg, positionEffect), which
     would be 4 per plain OPEN/CLOSE calendar: front-open, back-open, front-close, back-close)
     that never gets built as its own persisted row in this schema, or whether it is a literal
     instruction this phase is expected to reproduce with a different schema.
   - Recommendation: treat it as v1's own internal bucket count, not a row-count contract for
     this schema. Assert **exactly 2 `events` rows per calendar** (1 OPEN + 1 CLOSE, never a
     ROLL) in the oracle suite, and carry the "never a spurious ROLL" half of the invariant
     unchanged. Surface this explicitly for user confirmation if `discuss_phase`/plan-review
     wants to re-open D5-01's own quoted text.

2. **Should `detect_roll` exist as a real, callable predicate this phase, or is correct grouping
   alone (never merging fills from two different `position_id`s into one event) a sufficient
   guard?**
   - What we know: across all 13 oracle calendars, no single `position_id` ever has fills
     classified into both OPENING and CLOSING within one broker order on the same root+strike
     +type with a different expiry — the only order shared across two calendars
     (`1006797510202`) involves *two different strikes* (7425 vs 7475), so it never satisfies
     v1's own `detectRoll` predicate regardless of implementation.
   - What's unclear: whether the plan should build a real `detect_roll(fill_a, fill_b) -> bool`
     function (matching v1's documented signature: same position + same order + same root+
     strike+type + different expiry) purely to have a named, testable guard — or whether
     grouping derived events by `(position_id, classify_fill(...))` already makes a spurious
     ROLL structurally unreachable, making a dedicated function redundant.
   - Recommendation: build the small pure predicate anyway (cheap, ~10 lines, matches D5-01's own
     wording — "Implement `detect_roll`'s strict ... requirement only as the guard") and unit-test
     it directly against the `60c46a57`/`24f1e72e` pair as a *negative* case (returns `False`),
     since no positive ROLL fixture exists to test the `True` branch this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Postgres 18 (Homebrew, `postgresql@18` service) | All db-marked oracle/idempotency tests | ✓ [VERIFIED: `CLAUDE.md`'s own stated run command, this session's environment matches the project's documented local setup] | 18 (matches CI's Postgres 18 service and Railway) | — |
| No new PyPI package | — | N/A | N/A | N/A — this phase adds zero new dependencies. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0 [VERIFIED: `pyproject.toml`, `[tool.pytest.ini_options]` block] |
| Config file | `pyproject.toml`, `tests/conftest.py` (env isolation), `tests/ledger/conftest.py` (ledger fixtures) |
| Quick run command | `uv run pytest -q tests/ledger -m db` |
| Full suite command | `uv run pytest -q` (~13s baseline per `CLAUDE.md`; re-measure after this phase lands, given the oracle suite's own 52-fill/13-calendar seed weight) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LEDGER-01 | Events derived from stored fills only, never a second source of truth | db | `pytest tests/ledger/test_oracle_gate.py -x` | ❌ Wave 0 |
| LEDGER-02 | Classification from `position_effect` only; no derivation path reads position status | unit + db | `pytest tests/ledger/test_oracle_gate.py -x -k classify` | ❌ Wave 0 |
| LEDGER-03 | Shared-leg resolution via order-anchor, unresolved when ambiguous | db | `pytest tests/ledger/test_plaintext_queries.py -x` (already exists, proves the SQL) + a new consumer-level test asserting the pure core produces the same resolution | ✅ query proven / ❌ consumer test, Wave 0 |
| LEDGER-09 | Idempotent re-derivation over `(user, order_id)` scope | db | `pytest tests/ledger/test_pairing_idempotency.py -x` | ❌ Wave 0 |
| LEDGER-11 | 13-calendar oracle + 14th synthetic negative control | db | `pytest tests/ledger/test_oracle_gate.py -x` | ❌ Wave 0 |
| LEDGER-12 | Pure recompute, no broker call | unit | `pytest tests/ledger/test_oracle_gate.py -x -k pure` | ❌ Wave 0 |
| OPS-06 | Seeded sign-flip/rounding/off-by-one faults are caught | unit + db | `pytest tests/ledger/test_pairing_seeded_faults.py -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the quick run above, scoped to the file(s) the task touched.
- **Per wave merge:** `uv run pytest -q` (full suite).
- **Phase gate:** `bash tools/gate.sh` (full suite + ruff + basedpyright + mypy) green before
  `/gsd-verify-work`, matching every prior phase's own gate discipline.

### Wave 0 Gaps

- [ ] `tests/ledger/test_oracle_gate.py` — the 13+1 parametrized oracle suite (LEDGER-01,
      LEDGER-02, LEDGER-11, LEDGER-12)
- [ ] `tests/ledger/test_pairing_idempotency.py` — LEDGER-09
- [ ] `tests/ledger/test_pairing_seeded_faults.py` — OPS-06
- [ ] `src/morai/ledger/pairing.py` (or the planner's chosen module name) — the pure core +
      shell itself; nothing to test against until this exists (the natural, cheap red — no
      scaffolding needed to manufacture a more interesting failure, per `.claude/rules/
      workflow.md`'s own "cheapest honest red" rule)
- [ ] A 14th-fixture seeding helper (new — `oracle_seed.py`'s `_CALENDAR_SPECS` currently models
      only the 13 open+close pairs)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Every new function's inputs are typed dataclasses/`Decimal`/`UUID` (`FillRecord`, `EventDraft`) — no raw dict, no `Any`, matching this codebase's existing boundary discipline. No new external input enters the system this phase (fills are read back from the already-validated `fills` table, not from a fresh vendor payload). |
| V11 Cryptography (ASVS 5.0 numbering — see `03-RESEARCH.md`'s own State of the Art note on the 4.0→5.0 renumbering) | no new surface | This phase never touches AES/AAD directly — it calls the existing `insert_events`/`read_fills`, whose encryption boundary was proven in Phase 3. No new key material, no new ciphertext shape. |
| V8 Authorization | indirectly | RLS (`user_isolation` policy on `fills`/`positions`/`legs`/`events`, migration 0008/0007) continues to be what scopes every query to one user — this phase's SQL (Pattern 3) is a plain `SELECT`/join, no admin bypass, no cross-user read. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A second, ad-hoc write path into `events` (bypassing `insert_events`'s ROLL-guard `ValueError`) | Tampering | This phase's shell is the only intended caller of `insert_events` for derived data — `events.py`'s own docstring already flags that no `_write_token` sentinel gates it yet, deferring that compile-time gate to "once Phase 5 actually derives events from fills and a second writer becomes a real temptation" [VERIFIED: `src/morai/ledger/events.py:17-21`]. **This phase is that trigger.** The plan should at minimum note this as a candidate follow-up (a `_write_token`-style gate mirroring `Fill.__init__`'s), even if not built this phase, since D-07's own gate-fixture pattern exists to prove exactly this kind of guard has teeth once added. |
| Cross-user data leak via a malformed disambiguation query (e.g. omitting the `user_id` predicate) | Information Disclosure | RLS is the backstop (`FORCE ROW LEVEL SECURITY` on all four tables), but the proven query (Pattern 3) also explicitly joins/groups on `user_id` at every step — keep that discipline in any adapted version. |

## Sources

### Primary (HIGH confidence — read directly, this session)

- `salvage/oracle-fixtures.md` (full file, 413 lines) — the complete oracle specification.
- `salvage/invariants.md` (partial — Journal/Fill-pairing sections, lines 1-300) — v1's own
  property-test invariants for `fill-pairing.ts`, `syncFills.property.test.ts`.
- `.planning/phases/05-fill-pairing-and-the-oracle-gate/05-CONTEXT.md` — locked decisions
  D5-01..D5-04.
- `src/morai/ledger/fills.py`, `src/morai/ledger/events.py`, `src/morai/db/models.py` (full
  files) — the existing write path and schema.
- `tests/ledger/oracle_seed.py` (full file, 557 lines) — the existing 52-fill seed helper.
- `tests/ledger/test_plaintext_queries.py` (full file) — the proven disambiguation SQL and its
  own tests, including the negative-unresolved case.
- `tests/ledger/conftest.py` — existing ledger test fixtures (`provisioned_users`,
  `clean_ledger_tables`, `seeded_position`).
- `src/morai/vendor/connections.py` — `derive_connection_health`'s pure-function precedent.
- `alembic/versions/0008_positions_legs_events.py` (full file) — the `events`/`positions`/`legs`
  DDL, CHECK constraints, grants.
- `docs/learnings/LAWS.md` — L005, L022, L023, L061, L069, L070, L071 (all read in full this
  session).
- `docs/learnings/vendors-and-infra.md` V093 (read this session).
- `REBUILD-BRIEF.md` — NN-1, NN-5, NN-8, NN-9, NN-10, NN-11, NN-16 (all quoted verbatim, read
  this session).
- `.planning/ROADMAP.md` — Phase 5's own success criteria and Phase 7's LEDGER-05 scope.
- `.planning/REQUIREMENTS.md` — exact wording of LEDGER-01/02/03/09/11/12, OPS-06.
- `.planning/phases/03-envelope-encryption-and-the-schema-contract/03-RESEARCH.md` — Code
  Examples section (the original, scratch-schema version of the disambiguation query).
- `tests/test_decimal_canary.py`, `tests/test_money_column_naming.py` (full files) — this
  codebase's own Decimal/money conventions.
- `pyproject.toml` — type-checker config, pytest markers, confirmed no mutation-testing tool
  and no `pytest-randomly`.

### Secondary (MEDIUM confidence)

- None — no web search was needed or performed. Every claim in this document traces to an
  in-repo source read this session.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new package, confirmed by reading the phase's own scope against the
  already-installed dependency set.
- Architecture: HIGH — the hardest piece (order-anchor disambiguation) is already proven against
  real Postgres with real oracle data in this repo; the remainder is a direct, mechanical
  extension of `derive_connection_health`'s already-established pure/shell pattern.
- Pitfalls: HIGH — every pitfall traces to a numbered `docs/learnings/` entry with its own cost
  narrative, cross-checked against this phase's actual schema (not assumed from the source doc
  alone — e.g. Pitfall 3's five-column PK claim was verified by reading `models.py` directly,
  not inferred from `salvage/oracle-fixtures.md`'s three-column framing).

**Research date:** 2026-08-31
**Valid until:** No external dependency in this phase; valid until the schema (migration 0008)
or the oracle fixture data changes, which is not expected before this phase completes.
</content>
