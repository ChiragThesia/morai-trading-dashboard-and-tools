# Phase 8: Snapshot Capture - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — four grey areas proposed in batch, all accepted

<domain>
## Phase Boundary

Every open position is repriced on the 30-minute RTH cadence from day one, and a slot without
data is recorded as a gap rather than invented.

In scope: the capture job on the 30-minute RTH cadence (SNAP-01); explicit gaps, never fabricated
values (SNAP-02); gap healing with a strict one-directional upsert (SNAP-03); a repair path that
ships in this phase alongside the writer (SNAP-04); and an honest gap for a user whose connection
is expired (SNAP-05).

Out of scope: BSM greeks and derived analytics — this phase captures observations, it does not
analyse them. The reconciliation invariant is Phase 9's. The review surface is Phase 11's.

**Why this phase sits here and not later:** snapshot data is the one thing in this system that
cannot be backfilled once missed. `L039` — a live-write-only pipeline turns every outage into a
permanent hole. v1's largest permanent regret was capturing marks live-write-only and losing them.

</domain>

<decisions>
## Implementation Decisions

### D8-01 — Two layers: raw observations, and marks derived from them

Store the raw vendor observation per contract per slot, and a derived mark row on top of it.

**Why:** criterion 4 says the repair "rebuilds marks from the raw observations actually stored."
That is only possible if raw is a separately stored layer. `L039` states the rule directly: if the
raw source survives, build the rebuild path. This mirrors Phase 6's decision to store broker
transactions independently of derived fills, for the same reason.

### D8-02 — No greeks in this phase

Store the observed quote and the underlying spot. No BSM greeks, no derived analytics.

**Why:** the irreplaceable thing is the *observation* — a greek can be recomputed from a stored
quote at any later time, but a quote never observed is gone forever (`L039`). Computing greeks here
would also add a second thing that can independently gap, doubling the gap surface for no gain in
this phase's own criteria. v1 computed greeks server-side at snapshot time; that is not a reason to
repeat it inside a phase whose goal is capture.

### D8-03 — Fetch via `get_quotes(symbols)`, not the full option chain

Collect the OCC symbols of every open leg and request exactly those quotes.

**Why:** both `get_option_chain` and `get_quotes` already exist on `SchwabClient` in
`src/morai/vendor/protocol.py` and in the adapter, declared in Phase 4 explicitly "for Phase 8's
snapshot capture" (`D4-02`). A chain fetch pulls thousands of contracts per slot to use a handful;
quotes fetch exactly what is open, which matters against a vendor rate limit on a 30-minute cadence
across every connected user.

### D8-04 — Retain the raw vendor payload per slot

**Why:** it is what makes the repair path real rather than nominal. Phase 6 set this precedent with
`broker_transactions`, and it is the same argument: a parsed-fields-only store can only ever rebuild
what was already parsed correctly, so a parsing bug becomes as permanent as an outage.

### D8-05 — The trigger assigns the slot; slots are never re-derived by a window query

The scheduled job knows which slot it is firing for and stamps it. The observation separately
carries its own `observed_at`.

**Why:** `L048` — resolving a slot from a half-open `[anchor, anchor + interval)` window is blind to
an observation timestamped just *before* the anchor, and that happens systematically when a periodic
trigger collides with a fixed-cadence fetch. It was reproduced in both directions in v1: an
observation at anchor+50s healed, the identical case at anchor−30s stayed NaN. Stamping at trigger
time sidesteps the whole class rather than tuning a window.

### D8-06 — Cron in UTC, RTH membership computed in ET at runtime

Procrastinate's `periodic` cron runs in UTC; whether a given firing falls inside the RTH session is
computed in `America/New_York` at runtime through `zoneinfo`.

**Why:** cron has no timezone. A fixed UTC cron silently drifts by an hour twice a year, and
hardcoding two ranges for EST and EDT just moves the bug to the changeover dates. `tzdata` is
already an explicit dependency as of Phase 7, so the tz database is available on the deployed
container.

### D8-07 — The execution model is inherited from `D6-01`, not re-decided

The long-running Procrastinate worker Phase 1 built. Not a Railway cron container.

**Why:** Phase 6 owned this spike and settled it — Railway's native cron starts a fresh container
per run and expects it to exit, which does not fit a Procrastinate worker. Phase 8 defines only the
cadence, which is the part `D6-01` explicitly left to this phase. The ROADMAP's open-decisions table
records the inheritance.

### D8-08 — 30-minute RTH slots, stored as `timestamptz`

**Why:** the 30-minute RTH cadence is a system-wide fact in this project's constraints, not a
tunable. Making it configurable would invite a second cadence to exist somewhere and disagree.

### D8-09 — A gap is `mark_usd IS NULL` plus a non-null `gap_reason`

Pinned once, in code. Never a sentinel.

**Why:** `L041` says pin what counts as a gap in code, once. v1's definition was `spot = "0"` or a
non-finite greek — a sentinel that had to be re-recognised correctly at every read site, and was
not. A nullable `Decimal` makes "no data" structurally unrepresentable as a number and forces
`None`-handling at every read site at the type level (`NN-16`, and the same reasoning as `D7-07`'s
NULL settlement amount).

### D8-10 — `DO UPDATE ... WHERE`: real may overwrite gap, gap may never overwrite real

The upsert is deliberately asymmetric and the asymmetry is the requirement, not an optimisation.

**Why:** `L020`/`L071` — `DO NOTHING` is correct when a duplicate trigger recomputes from identical
inputs, and wrong when the later write is strictly more complete. In v1 that clause blocked the
backfill of 1,190 corrupted contracts until it was flipped, and separately discarded a later, more
complete GEX recompute in favour of an early partial one. `NN-6` and criterion 3 together demand
exactly this asymmetry: a later real observation heals a gap; a real observation is never replaced
by a gap; and an upsert never silently no-ops a corrected backfill.

### D8-11 — Gap granularity is per leg

**Why:** `L002` — a mixed-root calendar carrying an SPX front and an SPXW back mis-resolves in
snapshot leg resolution when state is held per position. Phase 7 already stores `root` per leg for
precisely this reason, and criterion 3 of that phase exists to prove the two coexist.

### D8-12 — A slot's gap is healed only by a real observation for that same slot

Never by a neighbouring slot's observation, however close in time.

**Why:** `L041` records that the self-heal window bug (`L048`) was fixed by adding observability
first rather than widening the window speculatively, because a wider window risks fabricating a row
for a genuinely empty slot from a prior slot's stale observation. Healing that reaches across slots
is fabrication wearing the costume of repair.

### D8-13 — The repair path ships as both a Procrastinate task and a runnable CLI over one function

Same function, two entry points. Ships in this phase, beside the writer.

**Why:** `L040` — stopping bad writes without a repair path just moves the failure mode. In v1,
Phase 25 stopped `snapshot-calendars` writing gap/NaN rows and the actual repair landed a full
milestone later in Phase 40; in between, affected calendars carried silent, unrecoverable holes.
Criterion 4 says "runnable" and says it ships "in this phase alongside the writer rather than a
phase later" — that wording is a direct citation of this failure.

### D8-14 — An expired connection produces an explicit gap with its own reason

`gap_reason` distinguishes `connection_expired` from `no_market_data`.

**Why:** criterion 5 requires the row to exist, so the slot does not later read as though the
position did not exist. `L043` — a job that logs nothing on success makes "healed nothing", "never
ran" and "errored per-slot" indistinguishable; a single undifferentiated gap reason reproduces that
same ambiguity in the data.

### D8-15 — A `snapshot_runs` table, mirroring Phase 6's `sync_runs`

When it ran, positions attempted, marks written, gaps by reason, errors.

**Why:** `L042` — a stalled job and a vendor outage look identical from the data alone. v1's GEX
open interest read 0 for an extended period with the endpoint confirmed live; the adapter's own
scheduled job had silently stopped and never resumed, and no alerting existed to tell the two apart.
Phase 6 already established the shape with `sync_runs` and `INGEST-06`.

### D8-16 — Per-item error isolation

One failing position-leg-slot must not abort the sweep.

**Why:** in v1 one colliding slot on one calendar aborted the entire hourly self-heal across every
open calendar. The blast radius of a single bad item must be that item.

### Claude's Discretion

Left to implementation, guided by the codebase's established patterns:

- Table and column naming, and whether raw observations and marks are two tables or one table with
  a discriminator — provided the raw layer is independently queryable enough to rebuild marks.
- Whether `snapshot_runs` reuses `sync_runs`' exact shape or a parallel one.
- The precise `gap_reason` vocabulary, provided `connection_expired` and `no_market_data` are
  distinguishable.
- Whether the CLI lives in `tools/` as a script or as a `python -m` entry point.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/morai/vendor/protocol.py` — `SchwabClient.get_quotes(symbols)` and `get_option_chain(symbol)`
  already declared, explicitly for this phase (`D4-02`); `src/morai/vendor/schwab_adapter.py`
  implements both. `tests/vendor/conftest.py` already has a fake implementing them.
- `src/morai/worker/app.py` — `procrastinate.App` with `@app.periodic(cron=...)` and `@app.task`;
  the `sync_all_connected_users` fan-out plus per-user `sync_user` is the established shape for
  "do this for every connected user on a cadence". Its current `* * * * *` crons are Phase 1
  heartbeats and explicitly not a preview of this phase's cadence.
- `src/morai/ingest/sync_runs.py` — the run-record pattern `snapshot_runs` should mirror.
- `src/morai/ledger/positions.py` — `derive_position_state` / `net_quantity_for_leg` give "which
  positions are open right now", which is this phase's input set. Phase 7 built it.
- `src/morai/vendor/connections.py` — connection health, which `SNAP-05` reads to decide whether a
  slot is a `connection_expired` gap.
- `src/morai/ledger/pairing.py` — `parse_occ_symbol` for leg symbol handling; `settlements.py` for
  the established `zoneinfo` + named-ET-constant pattern (`AM_SETTLEMENT_TIME`/`PM_SETTLEMENT_TIME`).

### Established Patterns
- Pure derivation function plus a thin async shell, with an explicit `as_of` and no `datetime.now()`
  in the pure half (`derive_events`/`sync_events`, `derive_settlements`).
- Write-token sentinels gate a table's single write path (`Fill`, `Position`, `Leg`, `Event`), with
  an AST gate test in `tests/gate/test_ledger_write_boundary.py` that detects a second writer.
- Every user-scoped table denormalises `user_id` so its RLS policy evaluates without a join, and a
  view over such a table needs `WITH (security_invoker = true)` or it silently bypasses RLS.
- Money and quantity are ciphertext columns with a plaintext `key_version`; anything summing them
  must decrypt first.
- Gaps are `None`, never `0` (`NN-16`), enforced at the type level.
- Migrations are Alembic, sequentially numbered; 0014 is current, so this phase writes 0015.
- Batch inserts chunk at ≤2,000 rows (`NN-5`).

### Integration Points
- `src/morai/worker/app.py` — where the periodic capture job and its fan-out land.
- `src/morai/ingest/schwab_sync.py` — the precedent for a per-user job that opens a `morai_app`
  session, asserts it cannot bypass RLS, and writes user-scoped rows.
- Phase 7's `derive_position_state` — the source of "every open position", this phase's work list.

</code_context>

<specifics>
## Specific Ideas

- The laws this phase is written against are unusually specific and all come from the same v1
  failure: `L039` (live-write-only makes outages permanent), `L040` (stopping bad writes without a
  repair path moves the failure mode), `L041` (an honest gap beats a fabricated value; fill only,
  never overwrite), `L042` (a stalled job is indistinguishable from a vendor outage), `L043` (a job
  that logs nothing on success makes three different failures identical), `L048` (a half-open slot
  window is blind to an observation just before the anchor). Cite them by number in the plans.
- Criterion 4's wording — "ships in this phase alongside the writer rather than a phase later" — is
  a direct reference to `L040`'s cost line. Treat it as a hard constraint on plan ordering, not a
  preference: the repair path may not be deferred to a later wave that could get cut.

</specifics>

<deferred>
## Deferred Ideas

- BSM greeks and any derived analytics over the captured quotes (`D8-02`). Recomputable later from
  the stored observations, which is the whole point of storing them.
- Alerting on a stalled capture job. `D8-15` makes staleness *queryable* via `snapshot_runs`; wiring
  that to a notification channel is not in this phase's criteria.
- Backfill of any period before this phase ships. There are no stored observations for it, and
  fabricating them is exactly what `L041` forbids.

</deferred>
