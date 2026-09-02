# Phase 7: Position and Campaign Read Models - Research

**Researched:** 2026-09-01
**Domain:** Postgres RLS-under-views, recursive CTEs, Alembic schema evolution against a live
reader, settlement-event derivation, single-writer gates
**Confidence:** HIGH for the Postgres/RLS/CTE mechanics (fetched directly from postgresql.org);
HIGH for in-repo signatures and call sites (all read this session); MEDIUM for the settlement/roll
derivation shape, which extends a pattern rather than following one already proven in this repo.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D7-01** — Closed state is derived; `positions.opened_at`/`closed_at` are dropped in migration
  0014. `opened_at` from the earliest OPEN event, `closed_at` from the event that takes every leg
  to net zero.
- **D7-02** — Net quantity per leg is computed in Python, not SQL (money/quantity are ciphertext;
  Postgres cannot sum them).
- **D7-03** — Direction comes from the vendor's own `side`, reusing `_signed_leg_amount`'s
  convention (BUY positive, SELL negative, never `abs()`). A gapped leg (`None` quantity or
  unrecognized `side`) makes the whole position not-closed, never guessed.
- **D7-04** — No new API surface. The one existing `/gate/positions` route in
  `routes_identity.py` is updated to serve the derived value; the real read API is Phase 11's.
- **D7-05** — SETTLEMENT is a persisted `events` row, `fill_ids_hash` NULL. No schema change needed
  for the type itself — migration 0008 already permits it.
- **D7-06** — Settlement generation is a pure function `derive_settlements(legs, events, *,
  as_of: datetime)` — no `datetime.now()` inside. The existing `sync_events` pass calls it.
- **D7-07** — A SETTLEMENT's `open_debit_usd`/`close_credit_usd` are both NULL, never `0` (NN-16).
  Settlement *value* is Phase 8's, once a market read exists.
- **D7-08** — Settlement style comes from `legs.root` only: `SPX` = AM, `SPXW` = PM, every date,
  third Fridays included. Named constants `AM_SETTLEMENT = 09:30 ET`, `PM_SETTLEMENT = 16:00 ET`,
  applied to the leg's own expiry date, converted through `zoneinfo`, never a hardcoded UTC offset.
  09:30 ET is a documented lower bound, not a citable instant (CBOE: the SOQ is "not anchored to a
  specific time of day").
- **D7-09** — Positive ROLL derivation lands here. The two halves are priced by the same
  `_signed_leg_amount`/`_net_amount` the oracle already validates, stored split across the two
  column pairs, never netted. No new money arithmetic.
- **D7-10** — Migration 0014 adds a nullable `events.rolled_from_position_id` FK, CHECK non-NULL
  iff `event_type = 'ROLL'`. The ROLL row hangs on the **newly opened** position, pointing back at
  the closed one — newest position is the campaign head.
- **D7-11** — The campaign read model is a Postgres `VIEW` over `events`, recursive CTE walking
  `rolled_from_position_id`. Not materialized — a MATERIALIZED view is a second stored copy that
  can drift, the thing this phase exists to prevent.
- **D7-12** — Phase 7 adds the missing position/leg creation path: group an order's unresolved
  OPENING fills into one position plus its legs, `root` parsed from the OCC symbol via the
  existing `parse_occ_symbol`. Named as a scope addition — nothing under `src/` creates a
  `positions`/`legs` row today.
- **D7-13** — ROLL and SETTLEMENT fixtures are synthetic and labelled so. The 13-calendar oracle
  must keep passing byte-identically, including its global invariant (exactly 4 events per
  calendar, all OPEN or CLOSE, never a spurious ROLL).
- **D7-14** — "No second writer" enforced by a `tests/gate/` meta-test, the same AST-scanning shape
  D5-02/D6-02's gate tests already establish.
- **D7-15** — One migration (0014) carries all three schema changes: drop the two `positions`
  columns; add `events.rolled_from_position_id` + its CHECK; create the campaign view.

### Claude's Discretion

- Module layout under `src/morai/ledger/` — one module or three for closed state, settlement,
  campaigns.
- Whether the campaign view is queried through SQLAlchemy Core `select()` against a
  `Table`-mapped view or raw `text()`, following whichever pattern `pairing.py`'s
  `RESOLVE_FILL_POSITIONS_SQL` already sets.
- Exact synthetic fixture ids, provided they cannot be confused with the 13 real oracle calendar
  ids.

### Deferred Ideas (OUT OF SCOPE)

- The settlement **value** against the SOQ — needs Phase 8's market read. Represented as NULL here
  (D7-07), deliberately.
- Commission stays `None` throughout (D5-04). Phase 9's reconciliation confronts the collision.
- A full mutation-testing tool (D5-03 stands; a seeded-fault suite is pinned instead).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEDGER-05 | A position's closed state is derived from net quantity per leg, never a stored status column | `derive_events`'s existing OPEN/CLOSE grouping shape (pure function, no session) is the pattern to mirror; §"Architecture Patterns" gives the exact `_signed_leg_amount` reuse and the `None`-on-gap rule already proven for money, now applied to quantity |
| LEDGER-06 | A SETTLEMENT event is generated from a leg's expiry and strike, no fill required | `parse_occ_symbol` already returns `(root, expiry, option_type, strike)` from `legs.occ_symbol` — nothing new to parse; §"Code Examples" gives the `derive_settlements` skeleton and the idempotency-key defect it must avoid |
| LEDGER-07 | Settlement style recorded per leg (PM SPXW front + AM SPX back coexist in one position) | `legs.root` is already the discriminator column (migration 0008); §"Common Pitfalls" covers the `zoneinfo`/`tzdata` dependency this needs on Railway |
| LEDGER-10 | Campaign is a read model computed from events, never a separately maintained table | §"Postgres RLS and recursive-CTE views" is the load-bearing finding — the view MUST be created `WITH (security_invoker = true)` or it silently bypasses RLS when the migration's own DDL role owns it |
</phase_requirements>

## Summary

Three findings dominate this phase's risk, and none of them is money arithmetic — Phase 7 reuses
proven money code (`_signed_leg_amount`/`_net_amount`) rather than inventing new arithmetic, per
D7-09/D7-02.

**First, the recursive-CTE campaign view (D7-11) has one silent-bypass failure mode, and Postgres's
own docs name it in one sentence.** A `CREATE VIEW` owned by whichever role runs the Alembic
migration (this project's DDL/superuser engine) applies *that owner's* row-level-security policies
by default — and the superuser bypasses RLS entirely (`rolbypassrls`). Without
`WITH (security_invoker = true)` on the view, every user querying the campaign view through
`morai_app` would see every other user's chain, silently, past a green test suite that only ever
queried as one user. This is exactly the class of bug Phase 6's worker fix (RLS-bypass assertion)
exists to catch, one layer higher in the stack. `CYCLE` (Postgres 14+) is the built-in guard against
a corrupt chain hanging the query — no hand-rolled depth counter needed.

**Second, the existing idempotency dedup key silently collapses two different SETTLEMENT events
into one.** `sync_events`'s read-compare-skip logic keys on `(position_id, event_type,
fill_ids_hash)`. A SETTLEMENT's `fill_ids_hash` is always NULL (D7-05) and `events` has no `leg_id`
column, so a position's two legs — the whole point of criterion 3 — produce two SETTLEMENT drafts
with an *identical* triple. The second is silently skipped as "already exists" on the very first
sync. The fix is a one-line broadening of the existing tuple to include `event_time`, which is
already deterministic per event and costs nothing for OPEN/CLOSE.

**Third, wiring is incomplete two layers deep, not one.** `sync_events` (`pairing.py`) is never
called from the real ingest path (`worker/app.py::sync_user_task` → `ingest/schwab_sync.py`) —
only tests call it. D7-12 already names the position/leg-creation gap as this phase's scope; this
research adds that the derivation call itself is *also* unwired, and both gaps must close together
or positions/events stay production-empty after this phase ships, exactly the failure D7-12's own
rationale warns against.

**Primary recommendation:** Add `WITH (security_invoker = true)` to the campaign view's `CREATE
VIEW` and a `CYCLE` clause to its recursive CTE; broaden `sync_events`'s idempotency triple to a
4-tuple including `event_time`; and wire position/leg creation *and* the (now-extended)
`sync_events` call into `sync_user_task` in the same task, inside the existing session.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Closed-state derivation (LEDGER-05) | API/Backend (pure Python function) | — | Money/quantity are ciphertext; Postgres cannot compute this (D7-02) |
| SETTLEMENT event generation (LEDGER-06) | API/Backend (pure Python function) | — | No fill, no broker call; a scheduled/derivation-time fact, not a request-time one |
| Settlement style resolution (LEDGER-07) | API/Backend | — | `legs.root` is plaintext and already stored; no new tier needed |
| Campaign chain (LEDGER-10) | Database (Postgres VIEW) | API/Backend (thin read) | Every column the chain needs is plaintext (D7-11); pushing this to SQL is a genuine capability gain over LEDGER-05/06, which cannot use SQL |
| Position/leg creation (D7-12) | API/Backend (worker job) | Database (INSERT via the one write path) | Runs inside the existing `sync_user_task` transaction, same tier as fill/event writes |

## Standard Stack

### Core

No new core dependency. This phase is pure extension of the existing SQLAlchemy 2.0 /
asyncpg / Alembic stack already pinned project-wide.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tzdata` | 2026.3 [VERIFIED: PyPI registry, `pypi.org/pypi/tzdata/json`, fetched live] | IANA time zone database as a Python-installable fallback for `zoneinfo.ZoneInfo("America/New_York")` | Add as an explicit dependency — see Common Pitfalls. Not needed if Railway's base image is confirmed to ship system tzdata, but confirming that is more expensive than adding a ~500KB pure-data package. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `zoneinfo` + named constants (`AM_SETTLEMENT`, `PM_SETTLEMENT`) | `pytz` | `pytz` is stdlib-superseded and explicitly not the ecosystem default since Python 3.9's `zoneinfo`; would be a new dependency for a solved problem. Not considered further. |
| A recursive-CTE `VIEW` for the campaign chain | A materialized view, refreshed on write | Rejected explicitly by D7-11 — a second stored copy that can drift is the exact failure LEDGER-10 exists to prevent. |
| A recursive-CTE `VIEW` for the campaign chain | Walking the chain in Python after `read_events` | Would require decrypting every user's full event history to walk a chain that only touches plaintext columns — strictly worse than pushing the walk into SQL, and the `DROP VIEW`/recompute test (criterion 4) becomes metaphorical instead of literal. |

**Installation:**
```bash
uv add tzdata==2026.3
```

**Version verification:** `tzdata` version and publish date confirmed live against the PyPI JSON
API this session (`pypi.org/pypi/tzdata/json`) — `2026.3`, uploaded 2026-07-10.
`security_invoker`/`CYCLE` are Postgres server features, not packages; no version pin needed beyond
the project's already-fixed Postgres 18.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|-------------|
| `tzdata` | PyPI | published 2026-07-10 (latest release; package itself is a long-running CPython-org project) | not reported by the legitimacy check (`unknown-downloads`) | `github.com/python/tzdata` | SUS | Flagged — `reasons: ["unknown-downloads"]` only. `repoUrl` resolves to the official CPython organization, and `docs.python.org/3/library/zoneinfo.html` itself directs readers to this exact package as PEP 615's official fallback. The planner should still add a `checkpoint:human-verify` before `uv add`, per protocol, but the SUS verdict here is a tooling gap (PyPI download-count lookup failed), not a real slopsquat signal. |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `tzdata` — see disposition above; low-risk false positive, verify-before-install still required by protocol.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │  worker/app.py :: sync_user_task          │
                         │  (existing — Phase 6)                      │
                         └───────────────┬─────────────────────────┘
                                          │ same session, same transaction
                                          ▼
                  ┌───────────────────────────────────────────────────┐
                  │ ingest/schwab_sync.py :: sync_user                  │
                  │  writes broker_transactions, fills (existing)        │
                  └───────────────┬───────────────────────────────────┘
                                  │ NEW: after fills land
                                  ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ NEW: position/leg creation (D7-12)                            │
        │  group unresolved OPENING fills per order → INSERT position,  │
        │  legs (root via parse_occ_symbol)                              │
        └───────────────┬────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ ledger/pairing.py :: resolve_fill_positions (existing, unchanged) │
        └───────────────┬────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ ledger/pairing.py :: derive_events (existing)                  │
        │  EXTENDED: detect_roll pairs pulled out before OPEN/CLOSE       │
        │  grouping → produce ROLL drafts (D7-09) instead of a CLOSE+OPEN  │
        │  pair for that fill pair                                        │
        └───────────────┬────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ NEW: derive_settlements(legs, events, *, as_of) (D7-06)        │
        │  pure function — leg.expiry past as_of, no existing SETTLEMENT  │
        │  row for that leg's event_time → draft SETTLEMENT               │
        └───────────────┬────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ ledger/events.py :: insert_events (existing, EXTENDED)          │
        │  EventWrite gains rolled_from_position_id; idempotency triple   │
        │  broadened to (position_id, event_type, event_time,             │
        │  fill_ids_hash) — closes the SETTLEMENT dedup collision          │
        └───────────────┬────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ Postgres: events table (RLS: user_isolation)                    │
        └───────────────┬────────────────────────────────────────────┘
                          │ read at request time (Phase 11) or by tests
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ NEW: campaign_chain VIEW, WITH (security_invoker = true)        │
        │  WITH RECURSIVE ... CYCLE position_id SET is_cycle USING path    │
        │  walks rolled_from_position_id                                  │
        └─────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/morai/ledger/
├── events.py           # existing — EventWrite/insert_events, extended (rolled_from_position_id, dedup key)
├── fills.py             # existing — unchanged
├── pairing.py            # existing — derive_events extended for ROLL detection; parse_occ_symbol reused as-is
├── positions.py          # NEW — position/leg creation (D7-12), closed-state derivation (LEDGER-05)
├── settlements.py        # NEW — derive_settlements (D7-06/07/08), AM/PM constants
└── campaigns.py           # NEW — thin read wrapper over the campaign_chain VIEW (D7-11)
```
Module split shown above is one reasonable option under CONTEXT.md's "Claude's Discretion" — a
single `positions.py` covering all three is equally defensible; the load-bearing constraint is
that closed-state derivation stays a pure function with no `AsyncSession` parameter (D7-02
mirrors LEDGER-12's own shape), not the file boundary.

### Pattern 1: Postgres RLS and recursive-CTE views — the silent-bypass trap

**What:** By default, `CREATE VIEW` makes the view's row-level-security behavior follow the
**view owner's** privileges, not the querying role's. [CITED: postgresql.org/docs/current/rules-privileges.html,
fetched via curl 2026-09-01] states: *"With the exception of SELECT rules associated with security
invoker views ... all relations that are used due to rules get checked against the privileges of
the rule owner, not the user invoking the rule."* [CITED:
postgresql.org/docs/current/sql-createview.html, fetched via curl 2026-09-01] states further:
*"If any of the underlying base relations has row-level security enabled, then by default, the
row-level security policies of the view owner are applied ... However, if the view has
security_invoker set to true, then the policies and permissions of the invoking user are used
instead, as if the base relations had been referenced directly from the query."*

**Why this matters here specifically:** this project's migrations run through the DDL/superuser
engine (`get_engine()`), so whoever runs `alembic upgrade` owns every object the migration creates,
including this view. A Postgres superuser has `rolbypassrls`, which — per
`identity/rls.py::assert_connection_cannot_bypass_rls`'s own check — makes every RLS policy inert
for that role's queries. `FORCE ROW LEVEL SECURITY` (already applied to `events`/`legs`/`positions`
in migration 0008) does not help here: `FORCE` makes RLS apply to the table *owner's own direct
queries*; it does not touch how a view's owner-vs-invoker privilege model works, and a
`BYPASSRLS`-flagged role bypasses `FORCE` too. Left at its default, the campaign view would run
every query as the superuser, see every user's `events` rows regardless of who queries the view
through `morai_app`, and pass every single-user test green while leaking cross-user campaign data
in production — the same shape of bug Phase 6's worker fix (`assert_connection_cannot_bypass_rls`)
was written to close one layer down.

**When to use:** every view created over an RLS-`FORCE`d table in this codebase, not only this one.

**Example:**
```sql
-- Source: postgresql.org/docs/current/sql-createview.html (fetched via curl), plus
-- postgresql.org/docs/current/queries-with.html (fetched via curl) for the CYCLE clause syntax.
-- Migration 0014 shape -- verify column/table names against the migration actually written.
CREATE VIEW campaign_chain
WITH (security_invoker = true)  -- REQUIRED: without this, the view runs as its owner
                                   -- (the migration's DDL role), which bypasses RLS entirely.
AS
WITH RECURSIVE chain AS (
    -- Base case: a position that is not itself the target of any ROLL --
    -- i.e. it was opened directly, not rolled into. It is its own campaign root.
    SELECT p.id AS campaign_root_id, p.id AS position_id, 0 AS depth
    FROM positions p
    WHERE NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.event_type = 'ROLL' AND e.position_id = p.id
    )
  UNION ALL
    -- Recursive case: walk forward via rolled_from_position_id.
    SELECT c.campaign_root_id, e.position_id, c.depth + 1
    FROM chain c
    JOIN events e
      ON e.event_type = 'ROLL' AND e.rolled_from_position_id = c.position_id
)
CYCLE position_id SET is_cycle USING path
SELECT campaign_root_id, position_id, depth
FROM chain;
```
`CYCLE` is a Postgres 14+ feature [CITED: postgresql.org/docs/current/queries-with.html]. It
"specifies first the list of columns to track for cycle detection, then a column name that will
show whether a cycle has been detected, and finally the name of another column that will track the
path" — a corrupt chain (a `ROLL` pointing back into its own ancestry) then terminates the query
instead of hanging it, with no hand-rolled visited-set needed.

### Pattern 2: The idempotency-triple collision for legless-fill events

**What:** `sync_events`'s existing dedup logic (`pairing.py::sync_events`) builds
`existing_triples = {(record.position_id, record.event_type, record.fill_ids_hash) for record in
existing}` and skips any draft whose triple is already present [VERIFIED:
src/morai/ledger/pairing.py:415-420, read this session — `existing_triples = {(record.position_id,
record.event_type, record.fill_ids_hash) for record in existing}`]. For OPEN/CLOSE this is safe:
`fill_ids_hash` is a real, distinct digest per group of fills (`hash_fill_ids`). For SETTLEMENT,
D7-05 fixes `fill_ids_hash` to `NULL` on every row, and `events` carries no `leg_id` column
[VERIFIED: alembic/versions/0008_positions_legs_events.py:142-172, read this session — the `events`
table's column list has no `leg_id`]. Two legs of one position (criterion 3's whole point) each
produce a SETTLEMENT draft with the identical triple `(position_id, 'SETTLEMENT', None)`. The
second is silently treated as a duplicate and never inserted, even though its `event_time` differs
(AM vs PM, possibly a different date).

**When to use:** apply this fix the moment `derive_settlements` drafts are folded into
`sync_events`'s existing insert path, not after.

**Fix:** broaden the tuple to a 4-tuple including `event_time`:
```python
# pairing.py::sync_events, existing_triples construction -- broadened, one line changed.
existing_triples = {
    (record.position_id, record.event_type, record.event_time, record.fill_ids_hash)
    for record in existing
}
# ... and the matching drafts filter:
drafts = [
    EventWrite(...)
    for event in derivation.events
    if (event.position_id, event.event_type.value, event.event_time, event.fill_ids_hash)
    not in existing_triples
]
```
This is safe for OPEN/CLOSE too: `event_time` is already fully determined by the fill group that
produced a given `fill_ids_hash` (LEDGER-09), so adding it to the key is redundant-but-harmless
there and load-bearing for SETTLEMENT.

### Pattern 3: Extending the single-write-path sentinel to Position/Leg (D7-14)

**What:** `Fill.__init__` and `BrokerTransaction.__init__` both gate construction on a
module-private sentinel object, checked with `is not`, imported via a local (function-body) import
to break a circular-import [VERIFIED: src/morai/db/models.py:180-204 (`Fill.__init__`), read this
session]. `tests/gate/test_ingest_write_boundary.py` proves via `ast.walk` that only the sentinel's
own defining module and `db/models.py` ever reference it [VERIFIED:
tests/gate/test_ingest_write_boundary.py:42-50, read this session — `_ALLOWED_IMPORTERS =
frozenset({Path("src/morai/ingest/broker_transactions.py"), Path("src/morai/db/models.py")})`].
`Position`, `Leg` and `Event` currently carry **no** such gate [VERIFIED: src/morai/db/models.py
— `Position`, `Leg` and `Event` class bodies have no `__init__` override, unlike `Fill` and
`BrokerTransaction`].

**When to use:** D7-14 requires a gate test proving no module outside the derivation writes
position/leg/event state. The precedent is add a `_write_token`-style sentinel to `Position.__init__`
and `Leg.__init__` (mirroring `Fill`'s exact shape), held by whichever new module owns position/leg
creation, and copy `test_ingest_write_boundary.py`'s AST-walk shape (`git ls-files`-scoped, never a
directory walk, fixtures excluded) for the new gate test. `Event` already has an insert path
(`insert_events`) but no sentinel; whether to add one to `Event.__init__` too is in scope now that
ROLL/SETTLEMENT writers are being added — 03-RESEARCH.md's Open Question 2 named exactly this
moment as the trigger.

### Anti-Patterns to Avoid

- **A materialized campaign view refreshed on write:** explicitly rejected by D7-11 — reintroduces
  the drift risk this phase exists to remove.
- **Inferring settlement style from "is this a third Friday":** `D026` names this exact bug —
  correct only until SPXW and SPX coexist, which criterion 3 forces immediately.
- **Computing settlement T as `(expiry - now) / 86400000`:** `D016` — always use the real
  settlement timestamp (`AM_SETTLEMENT`/`PM_SETTLEMENT` applied to the leg's expiry date), never
  naive calendar-day subtraction, even though Phase 7 doesn't compute T itself — the timestamp this
  phase writes is exactly what a later T computation (Phase 8) will read.
- **A hardcoded UTC offset for ET:** ET is UTC-4 or UTC-5 depending on DST; D7-08 already mandates
  `zoneinfo`, not an offset constant.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Cycle detection in the campaign chain | A manually-tracked "visited position_ids" array threaded through the recursive CTE | Postgres's native `CYCLE ... SET ... USING ...` clause | Built-in since PG14, handles the tracking and the termination in one clause; hand-rolling this is exactly the kind of query Postgres's own docs show as the manual fallback for versions that lack it — this project's Postgres 18 doesn't need the fallback. |
| ET/UTC conversion for settlement timestamps | A hardcoded `timedelta(hours=4)` or `hours=5)` offset | `zoneinfo.ZoneInfo("America/New_York")` | DST transitions make a fixed offset wrong roughly half the year; `zoneinfo` is stdlib since Python 3.9 and already the only timezone tool this project should reach for. |
| Enforcing "no second writer" | A code-review convention or a comment | The AST-walk gate test pattern already proven in `test_ingest_write_boundary.py`/`test_vendor_boundary.py` | This project has already had this exact class of drift caught only by a structural test, twice (`D5-02`, `D6-02`) — a third hand-written convention with no test is the regression this phase's own D7-14 exists to prevent. |

**Key insight:** every "don't hand-roll" item above already has a proven, in-repo precedent to copy
rather than a first invention — the risk in this phase is *not following* an existing pattern, not
inventing a broken one from scratch.

## Common Pitfalls

### Pitfall 1: The campaign view silently bypasses RLS without `security_invoker`
**What goes wrong:** every user querying `campaign_chain` through `morai_app` sees every other
user's campaign chain.
**Why it happens:** the migration's DDL role owns the view; Postgres applies the *owner's*
RLS-and-privilege model to a view by default, and the owner here is a superuser with
`rolbypassrls`.
**How to avoid:** `WITH (security_invoker = true)` on `CREATE VIEW` — see Pattern 1.
**Warning signs:** any test that queries the view through a *second* user and expects to see
nothing. If that test is missing from the plan, this bug ships. This is exactly the shape of test
Phase 2's isolation suite and Phase 6's `assert_connection_cannot_bypass_rls` already established
as this codebase's standard defence — the campaign view needs its own instance of it.

### Pitfall 2: The SETTLEMENT idempotency-triple collision
**What goes wrong:** a position's second leg's SETTLEMENT event is silently never written, on the
very first sync.
**Why it happens:** `fill_ids_hash` is NULL for every SETTLEMENT, and `events` has no `leg_id`
column — the existing 3-tuple dedup key cannot distinguish two legs' settlement rows.
**How to avoid:** broaden the idempotency key to include `event_time` — see Pattern 2.
**Warning signs:** a test seeding a calendar with two different settlement styles (criterion 3's
own fixture) that asserts exactly one SETTLEMENT event and never notices the second is missing —
the test must assert **two** SETTLEMENT rows, one per leg, with different `event_time` values.

### Pitfall 3: `sync_events` (and now settlement/roll derivation) is never actually called from the ingest path
**What goes wrong:** after this phase ships, `positions`/`legs`/`events` still stay empty in
production, because nothing in `worker/app.py::sync_user_task` or
`ingest/schwab_sync.py::sync_user` calls `sync_events` today [VERIFIED: grep of `sync_events(` across
`src/` and `tests/` this session — every call site is under `tests/ledger/`; zero call sites under
`src/`].
**Why it happens:** Phase 5 built `sync_events` and proved it against the oracle but was never
asked to wire it into the worker; Phase 6 wired ingest (`broker_transactions`/`fills`) but stopped
there. D7-12 already names the position/leg-creation half of this gap; the *derivation-call* half
is a second, separate gap this research surfaces.
**How to avoid:** the plan must include a task wiring position/leg creation **and** the (extended)
`sync_events` call into `sync_user_task`'s existing transaction, in that order, inside
`ingest/schwab_sync.py::sync_user` or immediately after it returns, on the same session.
**Warning signs:** a plan whose tasks all pass green against `tests/ledger/` but includes no
worker-level integration test asserting that `positions`/`events` rows exist after a
`sync_user_task` run against seeded fills.

### Pitfall 4: `zoneinfo.ZoneInfo("America/New_York")` raises on a minimal container
**What goes wrong:** `ZoneInfoNotFoundError` at runtime on Railway, if the base image's system
tzdata is missing or stripped.
**Why it happens:** `zoneinfo` looks for system tz data first and only falls back to the `tzdata`
PyPI package if that package is installed [CITED: docs.python.org/3/library/zoneinfo.html]. This
project's `pyproject.toml` has no Dockerfile and no explicit `tzdata` dependency today [VERIFIED:
`pyproject.toml` dependencies list, read this session — no `tzdata` entry].
**How to avoid:** add `tzdata` as an explicit dependency (see Standard Stack) rather than relying on
Railway's Nixpacks base image happening to include system tz data.
**Warning signs:** this fails in production only, never locally on macOS (which always ships system
tz data) — a classic "works on my machine" gap. A CI test asserting `ZoneInfo("America/New_York")`
constructs without error is cheap insurance and should run on the same Postgres-18 container class
CI already uses.

### Pitfall 5: Migration 0014 breaks three test files that write or order by the dropped columns
**What goes wrong:** `tests/ledger/oracle_seed.py`'s two `insert(Position)` call sites pass
`opened_at=`/`closed_at=` kwargs that no longer exist as columns
[VERIFIED: tests/ledger/oracle_seed.py:606-616 (`seed_oracle`) and :708-715
(`seed_synthetic_open_calendar`), read this session — both call
`insert(Position).values(..., opened_at=..., closed_at=...)`]. `tests/ledger/test_pairing_shared_leg.py`
orders by the dropped column directly [VERIFIED: tests/ledger/test_pairing_shared_leg.py:266-270,
read this session — `text("SELECT id FROM positions WHERE id IN (:a, :b) ORDER BY opened_at
DESC")`]. `tests/ledger/test_pairing_no_position_state.py`'s entire premise — mutate
`opened_at`/`closed_at` and assert no derived event moves — has nothing left to mutate once the
columns are gone; its behavioral half of D5-02's proof is retired by this phase's own change, not
broken by an oversight.
**Why it happens:** these three files predate Phase 7 and were written against the schema Phase 7
now changes.
**How to avoid:** the plan must include an explicit task updating `oracle_seed.py`'s two insert call
sites (drop the two kwargs), replacing `test_pairing_shared_leg.py`'s `ORDER BY opened_at DESC`
with an ordering that still proves the same processing-order claim (e.g. `ORDER BY created_at DESC`
if seed insertion order still matches the fixture's intended real-world order, or a join against
the newly-derived `opened_at`), and retiring `test_pairing_no_position_state.py`'s behavioral half
in favor of a Phase-7-owned equivalent that mutates whatever *does* remain queryable and asserts
closed-state derivation still ignores it.
**Warning signs:** `mypy`/`basedpyright` will not catch any of these — `insert(Position).values()`
and raw `text()` SQL are both untyped at the column-name level. Only `bash tools/gate.sh`'s
`pytest` run surfaces them, as either a `TypeError`/`ProgrammingError` (unknown column) or a
`UndefinedColumn` from Postgres. Confirm this locally before pushing (project rule: never push to
CI to find out).

## Code Examples

### The CHECK constraint for `rolled_from_position_id` (D7-10)

```python
# Source: composed from migration 0008's own CHECK style
# [VERIFIED: alembic/versions/0008_positions_legs_events.py:161-171, read this session --
# `sa.CheckConstraint("event_type <> 'ROLL' OR (open_debit_usd_ciphertext IS NOT NULL AND
# close_credit_usd_ciphertext IS NOT NULL)", name="roll_has_both_legs")`].
# D7-10 asks for a true biconditional (non-NULL iff ROLL), not merely an implication -- boolean
# equality between two always-non-NULL boolean expressions expresses that directly:
op.create_check_constraint(
    "roll_has_rolled_from_position",
    "events",
    "(event_type = 'ROLL') = (rolled_from_position_id IS NOT NULL)",
)
```
This composes independently with the existing `roll_has_both_legs` CHECK -- multiple `CHECK`
constraints on one table are implicitly ANDed by Postgres; neither references the other's columns,
so there is no ordering or interaction to reason about.

### `derive_settlements` skeleton (D7-06)

```python
# New. Mirrors derive_events's own purity contract (LEDGER-12's shape, D7-02's rationale for
# closed-state applied here to settlement too) -- no AsyncSession, no datetime.now() inside.
from datetime import datetime
from morai.ledger.pairing import parse_occ_symbol, EventType  # EventType gains SETTLEMENT

def derive_settlements(
    legs: Sequence[LegRecord],           # new read-model type: id, position_id, leg_role, occ_symbol, root
    events: Sequence[EventRecord],        # existing events, for the idempotency check below
    *,
    as_of: datetime,
) -> tuple[DerivedSettlement, ...]:
    """One draft per leg whose expiry has passed as_of and which has no
    existing SETTLEMENT event at that leg's own settlement instant yet.
    Pure -- as_of is the caller's only clock input (D7-06)."""
    existing_settlement_times = {
        (e.position_id, e.event_time)
        for e in events
        if e.event_type == "SETTLEMENT"
    }
    drafts: list[DerivedSettlement] = []
    for leg in legs:
        contract = parse_occ_symbol(leg.occ_symbol)  # .expiry, .root already parsed
        settlement_time = _settlement_instant(contract.expiry, root=leg.root)  # AM_SETTLEMENT/PM_SETTLEMENT via zoneinfo
        if settlement_time > as_of:
            continue  # not expired yet
        if (leg.position_id, settlement_time) in existing_settlement_times:
            continue  # already derived -- idempotency, keyed the same broadened way sync_events now is
        drafts.append(
            DerivedSettlement(
                position_id=leg.position_id,
                event_type=EventType.SETTLEMENT,
                event_time=settlement_time,
                fill_ids_hash=None,          # D7-05
                open_debit_usd=None,          # D7-07, NN-16 -- never 0
                close_credit_usd=None,        # D7-07, NN-16 -- never 0
            )
        )
    return tuple(drafts)
```

### `AM_SETTLEMENT`/`PM_SETTLEMENT` constants (D7-08)

```python
# New. zoneinfo, never a hardcoded UTC offset -- D7-08's own requirement.
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

_EASTERN = ZoneInfo("America/New_York")
AM_SETTLEMENT_TIME = time(9, 30)   # lower bound only -- see D7-08's own caveat, docs/rebuild-research/phase0-measurements.md §5
PM_SETTLEMENT_TIME = time(16, 0)

def settlement_instant(expiry: date, *, root: str) -> datetime:
    """`root` must be exactly 'SPX' or 'SPXW' -- this project's two roots
    (parse_occ_symbol already validates the OCC symbol shape upstream).
    AM for SPX, PM for SPXW, every date, third Fridays included (D026)."""
    settlement_time = AM_SETTLEMENT_TIME if root == "SPX" else PM_SETTLEMENT_TIME
    return datetime.combine(expiry, settlement_time, tzinfo=_EASTERN)
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.1.1, `pytest-asyncio` 1.4.0 (session-scoped event loop) |
| Config file | `pyproject.toml` (`[tool.pytest.ini_options]`) — `pytest.mark.db` gates DB tests |
| Quick run command | `uv run pytest -m "not db"` (no Postgres needed) |
| Full suite command | `export DATABASE_URL=... && uv run pytest -q` (~12-13s locally, per `CLAUDE.md`, measured against native Postgres 18) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| LEDGER-05 | Closed state derives from net quantity per leg; a stray status/timestamp column mutation changes nothing | unit + db | `uv run pytest tests/ledger/test_closed_state.py -x` | ❌ Wave 0 — new module |
| LEDGER-05 | The AST structural gate (mirrors D5-02) proves closed-state derivation never reads a stored position timestamp | unit | `uv run pytest tests/ledger/test_pairing_pure.py -x` (extend, don't replace) | ✅ existing file, extend |
| LEDGER-06 | A leg past its expiry with no fill produces exactly one SETTLEMENT event, no broker call | unit + db | `uv run pytest tests/ledger/test_settlements.py -x` | ❌ Wave 0 — new module |
| LEDGER-06 | The 13-calendar oracle still passes byte-identically, 4 events/calendar, no spurious ROLL | db | `uv run pytest tests/ledger/test_oracle_gate.py -x` | ✅ existing, must stay green unmodified |
| LEDGER-07 | One position holds a PM-settled SPXW front and an AM-settled SPX back, each on its own event_time; **exactly two SETTLEMENT rows land, not one** (Pitfall 2's regression test) | db | `uv run pytest tests/ledger/test_settlements.py::test_mixed_settlement_style_position -x` | ❌ Wave 0 |
| LEDGER-10 | Campaign view returns the correct chain; `DROP VIEW` + re-run migration reproduces it row-for-row | db | `uv run pytest tests/ledger/test_campaigns.py -x` | ❌ Wave 0 |
| LEDGER-10 | A second user querying the campaign view sees nothing of the first user's chain (Pitfall 1's regression test) | db | `uv run pytest tests/ledger/test_campaigns.py::test_campaign_view_respects_rls -x` | ❌ Wave 0 |
| D7-12 | Position/leg creation groups an order's OPENING fills correctly; end-to-end `sync_user_task` populates `positions`/`events` (Pitfall 3's regression test) | integration | `uv run pytest tests/worker/test_sync_user_task.py -x` | check — may already exist from Phase 6, extend if so |
| D7-14 | No module outside the derivation writes position/leg/event state | unit (AST gate) | `uv run pytest tests/gate/test_ledger_write_boundary.py -x` | ❌ Wave 0 — mirrors `test_ingest_write_boundary.py` |

### Sampling Rate

- **Per task commit:** `uv run pytest -m "not db"` locally if no Postgres reachable, else the
  targeted file above.
- **Per wave merge:** `bash tools/gate.sh` (ruff, ruff format, basedpyright, mypy, full pytest
  including `db`-marked tests) against local Postgres 18.
- **Phase gate:** Full suite green before `/gsd-verify-work` — **never push to CI to find out**
  (project rule, `CLAUDE.md` and `.claude/rules/workflow.md`; a CI round-trip is ~3min against ~12s
  locally, and Phase 2's isolation work lost four hours to that loop).

### Wave 0 Gaps

- [ ] `tests/ledger/test_closed_state.py` — covers LEDGER-05
- [ ] `tests/ledger/test_settlements.py` — covers LEDGER-06, LEDGER-07, and Pitfall 2's regression
- [ ] `tests/ledger/test_campaigns.py` — covers LEDGER-10 and Pitfall 1's regression
- [ ] `tests/gate/test_ledger_write_boundary.py` — covers D7-14
- [ ] Extend `tests/ledger/oracle_seed.py`'s two `Position` insert sites (Pitfall 5)
- [ ] Extend or add a worker-level integration test proving `sync_user_task` actually populates
      `positions`/`legs`/`events` end to end (Pitfall 3)
- [ ] Framework install: `uv add tzdata==2026.3` (Pitfall 4) — verify-before-install per the
      Package Legitimacy Audit's SUS flag

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V1 Architecture | yes | Same-tier reuse (pure derivation functions, no new service boundary); the campaign view is the one new architectural surface, and it is a read-only database object, not a new trust boundary |
| V4 Access Control | yes | `security_invoker = true` on the campaign view (Pattern 1) — the single highest-value control this phase adds. RLS `user_isolation` policies already cover `events`/`legs`/`positions` (migration 0008); this phase adds no new table, only a view over them |
| V5 Input Validation | yes | `parse_occ_symbol` already raises `ValueError` on a malformed OCC symbol (NN-16-consistent honest gap); the new `events_event_type_check`/roll-link CHECK constraints are database-level input validation on `event_type`/`rolled_from_position_id` co-occurrence |
| V6 Cryptography | no (unchanged) | This phase writes no new ciphertext columns; `open_debit_usd`/`close_credit_usd` reuse `insert_events`'s existing AESGCM path unmodified |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Cross-user data disclosure via a view that inherits the DDL owner's RLS-bypass privileges | Information Disclosure | `WITH (security_invoker = true)` (Pattern 1) — the load-bearing fix; verify with a real second-user query test, not a code read alone |
| A corrupt/cyclic ROLL chain hanging or crashing the campaign query | Denial of Service | Postgres's native `CYCLE` clause (PG14+) — terminates recursion on a detected cycle instead of looping |
| A SETTLEMENT event silently never written (data integrity, not disclosure) | Tampering (of the derived record, by omission) | Broaden the idempotency key (Pattern 2) — verified by an explicit two-settlement-rows test |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | Leg-role assignment for the new position/leg creation path (D7-12) is "earlier parsed expiry among an order's OPENING fills = front, later = back" | Architecture Patterns / Open Questions | If a real order's leg semantics differ (e.g. a diagonal where role is defined by something other than expiry ordering), the created legs' `leg_role` values would be swapped, which does not break LEDGER-05/06/07 (those key off `root`, not `leg_role`) but would misrepresent the position to any later reader (Phase 11) expecting `leg_role` to mean "near-term" |
| A2 | A single-leg opening order (no matching "back" contract) should still create exactly one `Leg` row, with no special-cased `leg_role` value | Architecture Patterns / Open Questions | Untested edge case — if this project never actually has single-leg openings (it trades calendars/diagonals exclusively per `CLAUDE.md`), this assumption may be moot, but the code should not crash if it happens |
| A3 | `test_pairing_shared_leg.py`'s `ORDER BY opened_at DESC` can be safely replaced with `ORDER BY created_at DESC` and preserve the same processing-order intent | Common Pitfalls / Pitfall 5 | If `seed_oracle`'s insertion order for the two named calendars (`8a63aa81`, `6303e6af`) doesn't already match `created_at` ascending in fixture-declaration order, the replacement ordering silently proves a different (possibly trivially-true) claim than the original test intended — must be checked against the real `ORACLE_CALENDARS` tuple order, not assumed |
| A4 | Railway's Nixpacks Python base image does not reliably ship system IANA tz data, so `tzdata` should be added explicitly rather than relying on the base image | Common Pitfalls / Pitfall 4 | Low risk either way — `tzdata` is cheap (~500KB, pure data, official CPython project) even if the base image already has system tz data; the assumption only affects whether the dependency is "needed" or merely "harmless insurance," not correctness |

## Open Questions

1. **Leg-role assignment rule for the new position/leg creation path (D7-12).**
   - What we know: `Leg.leg_role` is an unconstrained `Text` column; existing fixtures use exactly
     `"front"`/`"back"`; `parse_occ_symbol` gives each fill's contract `expiry`.
   - What's unclear: CONTEXT.md's "Claude's Discretion" section does not name this rule explicitly,
     and no production fixture proves it against a real multi-leg order.
   - Recommendation: assign `"front"` to the earlier-expiry contract and `"back"` to the later one
     among an order's distinct OPENING `occ_symbol`s, matching every existing test fixture's
     convention; write a fixture-based unit test asserting this explicitly so a future reader who
     changes the rule sees it fail loudly rather than silently.

2. **Whether `Event.__init__` should gain a `_write_token` sentinel in this phase, given D7-14.**
   - What we know: `Fill`/`BrokerTransaction` both have one; `Event` deliberately does not yet,
     per 03-RESEARCH.md's Open Question 2, which named "once Phase 5 derives events and a second
     writer becomes a real temptation" as the trigger.
   - What's unclear: Phase 7 adds ROLL/SETTLEMENT writers, which is arguably that exact trigger —
     but D7-14 phrases the requirement as a **gate test**, not explicitly a constructor sentinel.
   - Recommendation: add the sentinel to `Event.__init__` too, mirroring `Fill`'s exact shape,
     since the gate test is strongest when it has a structural mechanism to check against (the same
     reasoning `Fill`'s own gate combines an AST scan with a runtime `RuntimeError`) rather than
     relying on the AST scan alone to catch a second writer that never imports any sentinel at all.

## Sources

### Primary (HIGH confidence)
- postgresql.org/docs/current/sql-createview.html — fetched via `curl` this session (not
  paraphrased through WebFetch, per this project's own `V065`/workflow.md discipline) — exact
  `security_invoker` semantics and default-owner-privilege behavior
- postgresql.org/docs/current/rules-privileges.html — fetched via `curl` this session — the
  view-owner-vs-invoker privilege rule, quoted verbatim
- postgresql.org/docs/current/queries-with.html — fetched via `curl` this session — `CYCLE` clause
  exact syntax and PG14+ availability
- `pypi.org/pypi/tzdata/json` — fetched live this session via the PyPI JSON API — `tzdata` version
  2026.3, uploaded 2026-07-10
- This repo, read directly this session: `src/morai/ledger/pairing.py`, `src/morai/ledger/events.py`,
  `src/morai/ledger/fills.py`, `src/morai/db/models.py`, `src/morai/api/routes_identity.py`,
  `src/morai/worker/app.py`, `src/morai/ingest/schwab_sync.py` (partial),
  `src/morai/identity/rls.py`, `alembic/versions/0008_positions_legs_events.py`,
  `tests/gate/test_ingest_write_boundary.py`, `tests/ledger/test_pairing_pure.py`,
  `tests/ledger/test_pairing_no_position_state.py`, `tests/ledger/oracle_seed.py`,
  `tests/ledger/test_pairing_shared_leg.py`, `tests/ledger/conftest.py`, `tools/gate.sh`,
  `docs/learnings/domain-trading.md` (D014, D016, D026), `docs/learnings/LAWS.md` (L022, NN-5,
  NN-9, NN-10, NN-11, NN-16), `docs/learnings/vendors-and-infra.md` (V093),
  `docs/rebuild-research/phase0-measurements.md` §5, `.planning/phases/07-.../07-CONTEXT.md`,
  `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Secondary (MEDIUM confidence)
- docs.python.org/3/library/zoneinfo.html — WebSearch-surfaced, content matches well-established
  stdlib documentation (system-tz-first, `tzdata`-package fallback, `ZoneInfoNotFoundError` on
  neither being present)

### Tertiary (LOW confidence)
- pganalyze.com blog post on `security_invoker`/RLS — used only to orient the search, not cited for
  any factual claim in this document; every claim actually used was cross-checked against the
  official docs above

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — one new package (`tzdata`), version verified live against PyPI; everything
  else is the existing pinned stack
- Architecture: HIGH for the RLS/view/CTE mechanics (official docs, fetched directly); MEDIUM for
  the settlement/roll derivation module shape (extends a proven pattern, not itself proven yet)
- Pitfalls: HIGH — all five pitfalls are either read directly from this session's own file reads
  (Pitfalls 2, 3, 5) or from official Postgres/Python documentation fetched this session
  (Pitfalls 1, 4)

**Research date:** 2026-09-01
**Valid until:** 30 days (stable stack; the one time-sensitive fact — `tzdata`'s exact PyPI version
— should be re-verified if this research is reused past that window)
