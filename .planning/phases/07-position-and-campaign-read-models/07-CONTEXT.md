# Phase 7: Position and Campaign Read Models - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — four grey areas proposed in batch, all accepted

<domain>
## Phase Boundary

Open/closed state, per-leg settlement, and rolled-position chains are computed from events, with
no second writer for anything derivable.

In scope: closed-state derivation from net quantity per leg (LEDGER-05); SETTLEMENT event
generation from a leg's expiry, strike and root with no fill and no broker call (LEDGER-06);
per-leg settlement style so a PM-settled SPXW front and an AM-settled SPX back coexist in one
position (LEDGER-07); positive ROLL derivation and the campaign chain read model (LEDGER-10);
and the minimal position/leg creation path the pipeline is currently missing.

Out of scope: the review API surface (Phase 11), snapshot repricing (Phase 8), the
reconciliation invariant (Phase 9), and any settlement *value* — that needs the market read
Phase 8 owns.

</domain>

<decisions>
## Implementation Decisions

### D7-01 — Closed state is derived; the stored timestamps go

`positions.opened_at` and `positions.closed_at` are dropped in migration 0014. Both are derived
from the event stream instead — `opened_at` from the earliest OPEN, `closed_at` from the event
that takes every leg to net zero.

**Why:** criterion 1 says "no status column exists anywhere that could disagree with it." A
stored timestamp is exactly that column. Calendar `65aac62e` is the bug it caused in v1 — it
reported open after its real close order had fully unwound both legs, because the stored field
had drifted from the fills. Phase 3 already declined to add a `status` column for this reason
(`Position`'s own docstring says so); `closed_at` is the same field wearing a different type.
Keeping the columns and merely not writing them is weaker: the column still exists to disagree.

### D7-02 — Net quantity per leg is computed in Python, not SQL

The closed-state read model is a pure function over decrypted `FillRecord`s, the same shape
`derive_events` established — no `AsyncSession`, no `datetime.now()`, no import that could reach
a broker.

**Why:** this is decisive rather than stylistic. `fills.quantity` is stored as
`quantity_ciphertext` + `quantity_nonce`. Postgres never sees the plaintext, so no view, no
generated column and no SQL aggregate can sum it. Any design that put closed-state in SQL would
have to leak quantity into a plaintext column, which is a schema regression against CRYPT-02.

### D7-03 — Direction comes from the vendor's own `side`, reusing the proven function

Net quantity is signed exactly as `_signed_leg_amount` already signs money: from the fill's own
`side`, BUY positive, SELL negative, never `abs()` (`NN-9`, `NN-10`). A `side` that is neither
`"BUY"` nor `"SELL"`, or a `None` quantity, makes that leg's net an honest gap — and a position
with any gapped leg is **not** reported closed.

**Why:** `position_effect` cannot carry direction — closing a short leg is a buy and closing a
long leg is a sell. That is the round-4 production bug (`L022`) and `WR-01` from `05-REVIEW.md`
already forced the same `None`-on-unrecognised-side handling in the money path.

### D7-04 — Phase 7 does not add API surface beyond repairing what it breaks

The read models are internal functions. The one existing `/positions` route in
`routes_identity.py` returns `opened_at` from the dropped column, so it is updated to serve the
derived value. No new endpoints. The review surface is Phase 11's requirement set.

### D7-05 — SETTLEMENT is a persisted event row, not a computed-on-read one

`event_type = 'SETTLEMENT'`, `fill_ids_hash` NULL. Migration 0008's CHECK already permits the
type and the column is already nullable, so no schema change is needed for this.

**Why:** one event stream, read by the campaign chain and by Phase 9's reconciliation. A
computed-on-read settlement would be a second derivation surface for the same fact, and the two
would drift.

### D7-06 — Settlement generation is a pure function taking an explicit `as_of`

`derive_settlements(legs, events, *, as_of: datetime)` — no `datetime.now()` inside. The
existing `sync_events` pass calls it; a periodic job supplies the real clock.

**Why:** the same purity that lets `derive_events` serve both the oracle suite and the shell
without the two drifting. A function that reads the clock internally cannot be tested at an
expiry boundary without freezing time globally.

### D7-07 — A SETTLEMENT's money amount is NULL, and that is the point

`open_debit_usd` and `close_credit_usd` are both NULL on a SETTLEMENT row. Never `0`.

**Why:** a cash-settled index option settles against the SOQ, and no SOQ or market read exists
until Phase 8 — which depends on Phase 7, so waiting is a deadlock. `NN-16`: a gap is honest,
never fabricated. This mirrors `D5-04`'s `commission_usd = None` exactly, and for the same
reason: it forces Phase 9's reconciliation to confront the missing value at a typed boundary
rather than letting a `0` drift the cash-delta check for a reason nobody can find.

### D7-08 — Settlement style comes from `legs.root`; the anchor minute ships with its caveat

Style is read from `legs.root` and nothing else: `SPX` is AM-settled, `SPXW` is PM-settled on
every date it lists, third Fridays included. Timestamps come from named constants —
`AM_SETTLEMENT = 09:30 ET`, `PM_SETTLEMENT = 16:00 ET` — applied to the leg's expiry date and
converted through `zoneinfo`, never a hardcoded UTC offset.

The docstring records that 09:30 ET is a documented **lower bound**, not a citable instant:
CBOE states the SOQ "is not anchored to a specific time of day," and the practitioner record has
it delayed an hour or more on order imbalances (`docs/rebuild-research/phase0-measurements.md`
§5).

**Why:** `D026` — inferring AM/PM from "is this a third Friday" is only safe while the code never
sees SPXW. Once both roots coexist, which is the whole point of criterion 3, a real SPXW third
Friday gets tagged AM.

### D7-09 — Positive ROLL derivation lands here, adding no new money arithmetic

`D5-01` deferred positive ROLL "to a phase that owns a real fixture for it." Criterion 4 needs
ROLL events to exist, so the deferral resolves here — but the two halves of a roll are priced by
the *same* `_signed_leg_amount` / `_net_amount` the 13-calendar oracle already validates, stored
split across the two column pairs, never netted.

**Why:** `D5-01`'s objection was specific — building unvalidated money math for the failure that
cost v1 $319,850. Reusing the oracle-proven function answers that objection without weakening
it. No new arithmetic is introduced; the `roll_has_both_legs` CHECK from migration 0008 already
makes a netted-only ROLL unstorable regardless of caller.

### D7-10 — The roll link is an explicit column, not an inference

Migration 0014 adds a nullable `rolled_from_position_id` FK to `events`, with a CHECK making it
non-NULL if and only if `event_type = 'ROLL'`. A ROLL row hangs on the **newly opened** position
and points back at the closed one.

**Why:** the link must be a stored fact, not something re-inferred per query — `events` carries
no `order_id`, and a hash is one-way. A separate link table is precisely the "separately
maintained table" LEDGER-10 forbids. Hanging the row on the new position makes the newest
position the campaign head, which is the direction a reader actually asks in.

### D7-11 — The campaign read model is a recursive-CTE VIEW

A Postgres `VIEW` over `events` walking `rolled_from_position_id` recursively.

**Why:** unlike closed state, every column this needs — `position_id`, `event_type`,
`rolled_from_position_id` — is plaintext, so SQL is available here. It makes criterion 4 a
literal runnable test rather than a metaphor: `DROP VIEW`, re-run the migration, compare the
chain. A MATERIALIZED view would be a second stored copy that can drift, which is the thing this
phase exists to prevent.

### D7-12 — Phase 7 adds the missing position/leg creation path

Nothing under `src/` ever creates a `positions` or `legs` row today. `insert(Position)` appears
only in test seeds; `resolve_fill_positions` resolves against positions that must already exist;
and no later ROADMAP phase claims this work. Phase 7 adds the minimal path: group an order's
unresolved OPENING fills into one position plus its legs, with `root` parsed from the OCC symbol
by the existing `parse_occ_symbol`.

**Why:** this is a scope addition, named as one. Without it the position table is empty in
production, so Phase 8 reprices nothing, Phase 9 reconciles nothing, and Phase 11 renders
nothing. Phase 7 owns the position aggregate; the gap belongs here or nowhere.

### D7-13 — ROLL and SETTLEMENT fixtures are synthetic and say so

No independent oracle exists for either event type. The fixtures are synthetic and labelled
synthetic in the file itself. The 13-calendar oracle must continue to pass byte-identically as
the regression gate, including its global invariant — exactly 4 events per calendar, all OPEN or
CLOSE, never a spurious ROLL.

### D7-14 — "No second writer" is enforced by a gate meta-test

A test in `tests/gate/` asserts no module outside the derivation writes derived state, the same
shape `D5-02`'s gate test already established for position-state reads.

**Why:** the drift this guards against is exactly what code review missed in v1.

### D7-15 — One migration

Migration 0014 carries all three schema changes: drop `positions.opened_at` and
`positions.closed_at`; add `events.rolled_from_position_id` plus its CHECK; create the campaign
view.

### Claude's Discretion

Left to implementation, guided by the codebase's established patterns:

- Module layout under `src/morai/ledger/` — whether closed state, settlement and campaigns are
  one module or three.
- Whether the campaign view is queried through SQLAlchemy Core `select()` against a
  `Table`-mapped view or raw `text()`, following whichever pattern `pairing.py`'s
  `RESOLVE_FILL_POSITIONS_SQL` already sets.
- The exact synthetic fixture ids, provided they cannot be confused with the 13 real oracle
  calendar ids.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/morai/ledger/pairing.py` — `parse_occ_symbol` / `OccContract` (expiry, strike, root
  already parsed), `detect_roll` (strict same-strike/same-type/same-root guard, currently used
  negative-only), `_signed_leg_amount` / `_net_amount` (oracle-validated money arithmetic),
  `hash_fill_ids` (LEDGER-09's idempotency key), `derive_events` (the pure-function shape to
  mirror), `sync_events` (the shell that wires derivation to the DB).
- `src/morai/ledger/events.py` — `insert_events` is the single write path into `events`;
  `EventWrite` / `EventRecord` carry the encrypted money pair; chunking at 2,000 rows (`NN-5`)
  already implemented.
- `src/morai/ledger/fills.py` — `read_fills` returns decrypted `FillRecord`s with `quantity`,
  `price_usd`, `side`, `position_effect`, `order_id`, `occ_symbol`, `leg_index`,
  `execution_time`.
- `tests/ledger/oracle_seed.py` — the 13-calendar oracle plus the 14th synthetic negative
  control; `seed_oracle_calendars` is the precedent for how fixtures reach the DB.

### Established Patterns
- Pure derivation function + thin async shell, so one call serves both the oracle suite and
  production (`derive_events` / `sync_events`, and `derive_connection_health` before it).
- Money and quantity are ciphertext columns with a plaintext `key_version`; anything summing
  them must decrypt first.
- Raw SQL lives as a module-level named constant (`RESOLVE_FILL_POSITIONS_SQL`), not inline.
- Every user-scoped table denormalises `user_id` so its RLS policy evaluates without a join —
  `legs` does this deliberately.
- Migrations are Alembic, sequentially numbered; 0013 is current, so this phase writes 0014.
- Gaps are `None`, never `0` and never a sentinel (`NN-16`), enforced at the type level.

### Integration Points
- `sync_events` in `pairing.py` — where settlement and roll derivation hook into the existing
  pass.
- `insert_events` in `events.py` — the only write path the new event types may use.
- `routes_identity.py` `/positions` — reads `opened_at` from a column this phase drops; must be
  updated to the derived value.
- `worker/app.py` — the `sync_user` job that runs derivation on the `morai_app` role with the
  RLS bypass assertion Phase 6 added.
- Migration 0008 already permits `ROLL` and `SETTLEMENT` in `events_event_type_check` and
  already enforces `roll_has_both_legs`.

</code_context>

<specifics>
## Specific Ideas

- Criterion 4's "dropping the campaign read model and recomputing it from events yields the
  identical chain" is to be implemented as a literal test: `DROP VIEW`, re-run the migration,
  compare the chain row-for-row. D7-11 chose a plain view specifically so this is runnable
  rather than metaphorical.
- Criterion 3 wants one position holding a PM-settled SPXW front and an AM-settled SPX back,
  each settling on its own style and its own date. That is the fixture that would have caught
  `D026`'s mistagging bug, and it is the one that proves per-leg (not per-position) style.

</specifics>

<deferred>
## Deferred Ideas

- The settlement **value** — what a leg actually settled at against the SOQ. Needs the market
  read Phase 8 owns. Represented as NULL here (D7-07), deliberately.
- Commission remains `None` throughout, per `D5-04`. Phase 9's reconciliation invariant is where
  the fee-free-versus-cash-delta collision has to be confronted.
- A full mutation-testing tool. `D5-03` pinned a seeded-fault suite instead and declined to add
  one speculatively; nothing in this phase changes that reasoning.

</deferred>
