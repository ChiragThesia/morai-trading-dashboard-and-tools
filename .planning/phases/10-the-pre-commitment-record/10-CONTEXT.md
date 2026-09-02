# Phase 10: The Pre-commitment Record - Context

**Gathered:** 2026-09-02
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — four grey areas proposed in batch, all accepted

<domain>
## Phase Boundary

What the user said they would do is captured before the position opens, and structurally cannot
change afterwards.

In scope: the entry-intent capture surface (INTENT-01..05); structural immutability once the
position opens (INTENT-06); at-close plan-followed capture (INTENT-07); and the closed tag
vocabulary with free text rejected rather than stored (INTENT-08).

Out of scope: the review and drift surface that reads this data (Phase 11). This phase touches no
fill, event, or position write path — the ROADMAP marks it parallel with Phases 8 and 9 for exactly
that reason.

</domain>

<decisions>
## Implementation Decisions

### D10-01 — "Opened" means an OPEN or ROLL event exists for the position

The immutability gate reads the existence of an `OPEN` or `ROLL` row in `events` for that
`position_id`. Those columns — `position_id`, `event_type` — are plaintext.

**Why this and not `derive_position_state`:** criterion 2 requires enforcement by a constraint or a
trigger. `derive_position_state` is a pure Python function over *decrypted* quantities (`D7-02`,
because `fills.quantity` is ciphertext) and no Postgres trigger can decrypt. The opening side of
position state, unlike the closing side, does not need quantity at all — an opening event either
exists or it does not. That asymmetry is what makes a structural gate possible here.

Adding a plaintext status column to make this easier would reintroduce exactly the field Phase 7
dropped in migration 0014, for exactly the reason it dropped it.

### D10-02 — A `BEFORE UPDATE` trigger, plus `REVOKE UPDATE` as defence in depth

The trigger raises when an entry-intent row is updated while its position has an opening event.
`REVOKE UPDATE` on the entry-intent columns for `morai_app` backs it up.

**Why:** criterion 2 names "a constraint or a trigger, not a service-layer conditional a later
caller could route around." A `CHECK` constraint cannot see another table, so a trigger is the only
constraint-class mechanism that can consult `events`. Revoking UPDATE alone would also block the
legitimate pre-open edits INTENT-01..05 depend on, so it is the second layer rather than the first.

### D10-03 — Immutability covers DELETE, not only UPDATE

**Why:** an intent record that can be deleted and re-created is not immutable; it is mutable through
a different verb. The whole value of a pre-commitment record is that it was written before the
outcome was known, and a delete-and-rewrite destroys that guarantee as completely as an edit.

### D10-04 — Intent is written standalone and linked when a position opens

The entry-intent row carries a nullable `position_id`, set once when the position it describes comes
into existence. The trigger fires on that transition and on any later update.

**Why:** intent is recorded *before* the position exists. `create_positions` only writes a
`positions` row once fills land, so a NOT NULL foreign key at insert time is impossible. A
client-generated position id would invent an identifier the ingest path has no way to match.

### D10-05 — The tag vocabulary is enforced in Postgres AND in Pydantic

A Postgres enum or `CHECK` for each of the four vocabularies, plus a Pydantic `StrEnum` at the API
boundary.

**Why:** criterion 4 says a tag outside the vocabulary is *rejected*. The database is the only layer
no caller can route around — the same argument criterion 2 makes for immutability. Pydantic is not
redundant: it turns a raw integrity error into a useful 422 that names the offending field.

### D10-06 — A bad tag fails the write. No `other` bucket, no coercion, no silent drop.

**Why:** INTENT-08's wording is deliberate — free text is "rejected rather than stored." An `other`
member defeats the point of a closed vocabulary, and silently dropping the field loses the user's
input without telling them. A rejected value the user must correct is strictly better than a stored
value nobody can aggregate.

### D10-07 — Tags are plaintext

**Why:** tags are the axis Phase 11's drift and cohort queries aggregate on. Encrypting them would
force decrypting every row to group by one. They carry no free text by construction (`D10-06`), so
they expose nothing a stolen dump could read as narrative.

### D10-08 — The four vocabularies' member values come from the project's own record

INTENT-08 names the four: **structure**, **entry trigger**, **exit reason**, **plan-followed**.
Their member values are to be derived from `knowledge-base/`, `salvage/`, and the v1 record — not
invented during planning. Where the record is silent, research decides and records its source.

**Why:** this is a single trader's system with established language for its own strategy. Inventing
a plausible vocabulary would fabricate domain terms the user already has, and the resulting tags
would not match how they actually think about their trades.

### D10-09 — Thesis and invalidation trigger are encrypted

Per the per-user DEK envelope Phase 3 established.

**Why:** these are the free-text fields the security constraint was written for. A thesis states what
someone believes and why they are risking money on it; it is the most sensitive content in the
system. The project's threat model explicitly defends against a stolen dump.

### D10-10 — Profit target, stop, combo mid and net price are encrypted `Decimal`s

Following the money-path pattern, with `NN-8` applying: every money field's unit is named in the
column, never inferred.

**Why:** they are position-sized figures that reveal account scale, which is exactly what the dump
threat model protects.

### D10-11 — The planned DTE window stays plaintext

Two integers, unencrypted.

**Why:** Phase 11 must answer "which positions were held past their stated DTE window," which means
comparing the window against elapsed time in SQL. Encrypting it turns that query into a full decrypt
scan of every intent row. The exposure is two small integers describing a strategy parameter this
project already states publicly in its own README ("front legs typically 8-45 DTE").

The governing rule for the whole split: **encrypted unless Phase 11 must aggregate on it**, and where
both pull, the threat model wins.

### D10-12 — Ingest never blocks on user input; a missing close note is an outstanding obligation

A position closes when the broker's fills say so. The at-close record is captured separately, and a
closed position lacking its note is surfaced as outstanding rather than blocking anything.

**Why:** criterion 3 says "the close is not complete without it," which is a statement about the
*record*, not about the ledger. Blocking ingest on a user's note would let a trader on holiday halt
their own P&L. Treating the note as optional, on the other hand, would make criterion 3 vacuous. The
honest reading is that the close is a complete fact and an incomplete record, and the system says so.

### D10-13 — The incompleteness surfaces through Phase 9's trustworthiness envelope

Reusing `DependentNumbersModel`'s established pattern rather than inventing a second signal.

**Why:** Phase 9 already built the mechanism for "this number carries a caveat you must not ignore."
A parallel ad-hoc flag saying a closely-related thing would leave a client having to check two
mechanisms to learn whether a number is safe to render.

### D10-14 — Entry intent is frozen; the at-close note stays editable

The asymmetry is deliberate.

**Why:** `INTENT-06` freezes entry intent because its entire value is that it was recorded *before*
the outcome was known — an editable pre-commitment is not a pre-commitment. A retrospective note has
no such property. Correcting "I followed the plan" to "actually I did not" a day later is honesty,
not a loophole, and freezing it would only encourage leaving it blank.

### D10-15 — Plan-followed is a boolean AND a sentence, required together

**Why:** a bare boolean is unanalysable later — "did not follow plan" with no reason teaches nothing
on review. INTENT-08 already places `plan-followed` in the closed vocabulary, so the boolean carries
the aggregation and the sentence carries the reason.

### D10-16 — INTENT-07 gates fill-closed positions only; the expiry hole is recorded, not closed

**Decided 2026-09-02, during planning, by the user.**

Phase 7's re-verification found that `is_closed` reads only `FillRecord`s. A SETTLEMENT is an
`Event`, never a `Fill`, so a position whose legs expire stays net-nonzero forever — reproduced
against the real functions: after both legs settled, `is_closed=False`, `closed_at=None`. A front
short put expiring worthless is a normal exit for these calendars, so at-close capture built on
`is_closed` will never fire for that class of close.

**Decision:** ship Phase 10 anyway. INTENT-07's gate applies to fill-closed positions. Expiry-closed
positions get no at-close capture, and that gap is documented as a known limitation in this phase's
SUMMARY and VERIFICATION rather than papered over.

**Why this is a real cost, stated plainly:** this is the same failure shape as Phase 9's CR-01
blocker — work that is not failed and not indeterminate, just silently skipped. It is accepted here
as a scoping decision, not because it is harmless.

**What closes it:** the settlement-to-closed fix is phase-sized and belongs to its own work item.
`DerivedSettlement` carries only `(position_id, event_time)` and no leg id, so the fix cannot read
which leg settled off the event — it must re-derive from expiry, which gives `derive_position_state`
an `as_of` clock input and breaks the purity contract `test_pairing_pure.py` gates, rippling to four
call sites and Phase 8's open-leg set.

**Do NOT attempt that fix in this phase.** It is outside the stated boundary ("touches no fill,
event, or position write path").

### D10-17 — INTENT-07's gate is service-layer, and that is within criteria

`is_closed` is pure Python over *decrypted* quantities (`fills.quantity` is ciphertext), so no
Postgres trigger can compute it. INTENT-07's "the close is not complete without it" is therefore a
service-layer gate, unlike INTENT-06's structural trigger.

This does not violate the phase's success criteria: criterion 2 demands a structural constraint for
**entry-intent immutability** only. Criterion 3 asks that the close not be complete without the
record, and does not require a database-level mechanism. State the asymmetry in the plan rather than
implying criterion 3 is structurally enforced.

### D10-18a — `entry_trigger`'s member values, supplied by the owner 2026-09-02

**RESOLVED.** The vocabulary is:

```
iv_rank, term_structure, technical_level, event_catalyst
```

**Provenance, stated exactly:** these are the **owner's own choice**, given directly during planning.
They are NOT derived from `docs/learnings/`, `knowledge-base/`, `salvage/`, or
`docs/rebuild-research/` — the research confirmed the record is silent on this. `D10-08` forbade
*inventing* domain terms; the trader choosing their own vocabulary is authoritative in a way an
invented set never is. Record them as owner-supplied, never cite them to a document.

**Consequence — the pending-value workaround is no longer needed.** `D10-18`'s "one `StrEnum` the
migration imports" existed only to make an unknown value fillable in one line. With the values known,
the migration hardcodes them like all 16 existing migrations do (self-contained, no application
import), and a contract test asserting each live `CHECK` definition equals its enum's members
supplies the same anti-drift guarantee `D10-05` requires. Fold the third migration into the first.

### D10-18 — [SUPERSEDED by D10-18a] `entry_trigger`'s member values were pending at plan time

`D10-08` requires the vocabularies come from the project's own record and forbids inventing domain
terms. The research confirmed `entry_trigger`'s values are absent from `docs/learnings/`,
`knowledge-base/`, `salvage/`, and `docs/rebuild-research/`. The user elected to supply them
directly rather than accept a proposed set.

**Consequence for planning:** the vocabulary's member values MUST live in exactly one place — a
single `StrEnum` that the Pydantic layer and the migration's `CHECK` constraint both derive from —
so that filling in the real values is a one-line change and cannot drift between the two layers
(`D10-05` already requires both layers enforce the same closed set).

The task that writes those values is blocked on user input and must be marked as such. The other
three vocabularies are sourced and are not blocked.

### Claude's Discretion

Left to implementation, guided by the codebase's established patterns:

- Table naming and whether entry intent and the close record are one table or two.
- Whether the tag vocabularies are Postgres enums or `CHECK` constraints over `text`, provided both
  layers enforce the same closed set.
- The exact trigger name and error message, provided the message names the offending field.
- How the outstanding-close-note obligation is exposed on the envelope, provided it reuses Phase 9's
  mechanism rather than adding a parallel one.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/morai/crypto/envelope.py` and `src/morai/crypto/data_keys.py` — the per-user DEK envelope and
  the promoted `current_dek`/`dek_for_version` helper (Phase 8). Five call sites already exist; this
  phase adds a sixth, not a sixth copy.
- `src/morai/ledger/fills.py` — `_encode_decimal`/`_decode_decimal`, the established encrypted-money
  round trip.
- `src/morai/api/models.py` — `ApiModel` with `strict=True`, `extra="forbid"`, `frozen=True`, and
  `DependentNumbersModel` carrying `trustworthy` (Phase 9, `D9-14`).
- `src/morai/api/routes_identity.py` / `routes_reconciliation.py` — the route and `response_model`
  discipline, including return-type-annotation-only routing.
- `alembic/versions/0016_reconciliation_runs.py` — the most recent migration analog: RLS enabled AND
  forced, `user_isolation` policy, per-table GRANTs, CHECK constraints.
- `src/morai/db/models.py::Event` — `position_id` and `event_type` are plaintext, which is what makes
  `D10-01`'s trigger possible.
- `tests/api/` — created in Phase 9; the API test conventions to follow.

### Established Patterns
- Structural enforcement in the database beats a service-layer guard a later caller can route around
  — the same argument Phase 7's write-token sentinels and Phase 9's CHECK constraints make.
- Every user-scoped table denormalises `user_id` for its RLS policy; RLS enabled AND forced; writes
  go through a `morai_app` session with `assert_connection_cannot_bypass_rls`.
- Encrypted columns carry a plaintext `key_version`; money columns carry a named unit suffix (`NN-8`).
- Migrations are Alembic, sequentially numbered; 0016 is current, so this phase writes 0017.
- Unknowns are `None`, never `0` and never a sentinel (`NN-16`).

### Integration Points
- `events` — the trigger reads it to decide whether a position has opened.
- `positions` — the nullable link target set when a position comes into existence.
- The FastAPI app — the capture routes and the envelope field for an outstanding close note.

</code_context>

<specifics>
## Specific Ideas

- Criterion 2's wording is the phase's defining constraint and should be quoted in the plans:
  "rejected structurally — by a constraint or a trigger, not by a service-layer conditional a later
  caller could route around." The test that proves it must attempt the update through a path that
  bypasses the service layer entirely — a raw SQL `UPDATE` on a `morai_app` connection — or it
  proves only that the service layer works.
- The tag vocabulary values are owed to research against `knowledge-base/` and `salvage/`. If the
  record does not settle them, that is a finding to surface, not a gap to fill by invention.

</specifics>

<deferred>
## Deferred Ideas

- The review and drift surface that consumes this data — "positions held past their stated DTE
  window, exits that overrode the declared stop, sizes outside the declared cap" — is Phase 11's
  criterion 2, and `D10-11` keeps the DTE window plaintext specifically so that query is possible.
- Any UI for capture. This milestone is backend only.
- Reminders or nudges to fill in a missing close note. `D10-12` makes the obligation visible; acting
  on it is not in this phase's criteria.

</deferred>
