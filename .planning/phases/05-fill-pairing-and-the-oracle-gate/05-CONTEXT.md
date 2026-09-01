# Phase 5: Fill Pairing and the Oracle Gate - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

The broker's individual leg fills are paired into events with the correct net debit and
credit — correctly enough to pass the only genuine oracle this project owns, before any
real Schwab connection exists.

Schwab reports four unrelated rows for a calendar (buy back leg, sell front leg, sell back
leg, buy front leg) and never says they belong together or what the trade earned. This
phase turns those rows into `OPEN net debit 10.20` / `CLOSE net credit 10.55` → +$35.

This is the code class that cost v1 −$319,850 by netting a ROLL into one event instead of
recording the close and the open separately.

**In scope:** OPEN and CLOSE derivation; the four disambiguation rules from
`salvage/oracle-fixtures.md`; the 13-calendar oracle plus its 14th synthetic negative
control; idempotent re-derivation; the seeded-fault suite.

**Out of scope, by decision (D5-01):** positive ROLL and SETTLE derivation.

**Depends on:** Phase 3's `fills` / `positions` / `legs` / `events` tables and the single
write path into them (`ledger/fills.py::insert_fills`, `ledger/events.py::insert_events`).
No Schwab connection is needed or permitted — criterion 4 requires the whole derivation to
complete with no broker call made from the process.
</domain>

<decisions>
## Implementation Decisions

### D5-01 — Build OPEN/CLOSE fully; ROLL only as the negative guard

The ROADMAP goal names OPEN, CLOSE, ROLL and SETTLE. The oracle contains **no ROLL and no
SETTLE at all** — all 13 calendars are OPEN/CLOSE pairs, and the suite's own global
invariant is "exactly 4 events per calendar, all `OPEN` or `CLOSE` — never a spurious
`ROLL`."

Build OPEN/CLOSE derivation fully. Implement `detect_roll`'s strict
same-strike/same-type/same-root requirement **only** as the guard that prevents a spurious
ROLL — which is precisely what the oracle exercises through the `60c46a57` / `24f1e72e`
pair, one broker order (`1006797510202`) whose four legs close one calendar and open
another at a *different strike*, and which must therefore be treated as 2 ordinary CLOSE
fills plus 2 ordinary OPEN fills, never a single roll event.

Positive ROLL and SETTLE derivation is deferred to a phase that owns a real fixture for it.

**Why:** v1 lost $319,850 to a ROLL netted into one event. Building that path now, verified
only against fixtures written by the same reasoning that wrote the code, reproduces the
exact conditions of the original loss. An independent oracle is what makes this phase
trustworthy; ROLL does not have one yet.

### D5-02 — Prove criterion 2 by absence, not by adding a decoy column

Criterion 2 says "mutating a position's status column changes no derived event." **Phase 3's
`positions` table has no status column** — only `opened_at` and `closed_at`. The criterion
was written against v1's schema, which had one, and whose staleness *is* hard case 2
(`65aac62e`, registered `status: "open"` while its real broker history had fully closed it).

Satisfy the criterion's intent two ways, and do not reintroduce the field:

1. A gate meta-test asserting no derivation path reads any position state field at all.
2. The 14th synthetic fixture (`00000000-0000-4000-8000-000000000099`) as the live negative
   control: a genuinely-open calendar with exactly one OPENING order and no CLOSE anywhere
   must NOT be auto-closed by the closure check.

**Why:** Phase 3 already made the right call by never adding the column. Adding one back
purely so a test can mutate it would reintroduce the exact field whose staleness caused the
bug, on the argument that an unused column is harmless.

### D5-03 — Seeded-fault suite for OPS-06, not a full mutation run

Criterion 5 wants "zero surviving mutants for seeded sign-flip, rounding, and off-by-one
faults." No mutation tool is pinned in `pyproject.toml`.

Hand-inject exactly the three fault classes the criterion names into the ledger derivation
and assert the suite catches each one. Deterministic, fast enough for the local gate and
CI, and aimed directly at the failure classes that cost v1 real money — a sign flip is
`LEDGER-01`'s own failure mode.

Pin a full mutation tool (`mutmut`, `cosmic-ray`) later only if it fits the gate's time
budget. Do not add one speculatively in this phase.

### D5-04 — Fee-free arithmetic, with fee modelled as an explicit `None`

The oracle's convention is **fee-free**: `openNetDebit` and `closeNetCredit` come from
`avgPrice × qty`, never from the broker's `netAmount`, which bakes in ~$1–2/leg commission.
The ground-truth document's figures are 2–3 cents per leg higher for exactly this reason,
and the oracle's own header flags the difference as a known, separate, out-of-scope gap.

This collides with the project's core value: realised P&L must equal the broker's cash
delta, which is fee-*inclusive*. **Both cannot be true.**

Derive fee-free so the oracle passes at 2 decimal places (criterion 1). Represent
commission as an explicit `None` — never `0`, never omitted — per `NN-16`.

**Why:** a `None` forces Phase 9's reconciliation invariant to confront the missing fees at
a typed boundary. A `0` would let the cash-delta check drift by 2–3¢ per leg and fail for a
reason nobody can find. This is the single most important consequence of this phase for
later work, and it is recorded here so Phase 9 does not have to rediscover it.

### Claude's Discretion

Left to implementation, guided by the codebase's established patterns:

- How the 52 oracle fills are represented as data (module of typed literals vs. a JSON
  fixture), provided they are seeded **through `insert_fills`** — the same write path
  Phase 6's ingest will use, never a fixture-only path.
- The exact split between the pure derivation core and the DB read/write shell, following
  `derive_connection_health`'s own precedent from Phase 4: a pure function with its inputs
  passed in explicitly, so the same call serves both the unit proof and the caller.
- The idempotency mechanism, given `events.fill_ids_hash` already exists in the schema.
- How an unresolved fill is represented (`NN-11` requires explicitly unresolved, never
  guessed).
- Decimal comparison at 2dp — `quantize` vs. an absolute-difference bound.
</decisions>

<code_context>
## Existing Code Insights

**Phase 3 landed the whole schema this phase writes into.** No new migration should be
needed for the core work.

| Table | Shape relevant here |
|---|---|
| `fills` | Composite PK `(user_id, order_id, occ_symbol, leg_index)` — `NN-1`. `position_effect` and `side` stored as plain `Text`; `quantity` and `price_usd` are encrypted (`*_ciphertext` + `*_nonce`) |
| `positions` | `id`, `user_id`, `opened_at`, `closed_at`, `created_at`. **No status column** — see `D5-02` |
| `legs` | `position_id`, `user_id`, `leg_role`, `occ_symbol`, `root` |
| `events` | `position_id`, `event_type`, `event_time`, `fill_ids_hash`, encrypted `open_debit_usd` and `close_credit_usd`, `key_version` |

**The write path already exists:** `src/morai/ledger/fills.py` (`insert_fills`, `read_fills`,
`provision_data_key`) and `src/morai/ledger/events.py` (`insert_events`, `read_events`).
Both handle envelope encryption and per-row associated data. `events.fill_ids_hash` is
already there and unused — it is the natural idempotency key.

**Money is `Decimal` end to end**, `NUMERIC(14,4)` in Postgres, with a round-trip canary
test (`tests/test_decimal_canary.py`) and a column-naming gate
(`tests/test_money_column_naming.py`) already enforcing `NN-8`.

**Pattern to follow for the pure core:** Phase 4's `derive_connection_health(token_created_at,
now)` — a pure function with `now` an explicit parameter, never read from the clock inside,
so the same call serves the boundary unit tests and the route. Its docstring states its own
honest limit. Do the same here.

**The type gate is real and enforced:** no `Any`, no `cast`, no bare `# type: ignore`;
`mypy --strict` plus basedpyright strict with `reportAny`. `tests/gate/` holds fixtures that
prove the gate rejects what it claims to.
</code_context>

<specifics>
## Specific Ideas

**The four disambiguation rules** are written out in `salvage/oracle-fixtures.md` with what
breaks without each. They are the spec for this phase:

1. Classify a fill from `positionEffect` only, never `side` (`LEDGER-02`).
2. Derive `positionEffect` from the first fill, never from the calendar's status column.
3. Disambiguate shared legs by **order-anchor intersection** (`LEDGER-03`, `NN-11`).
4. Net quantity per leg decides "closed," never a status column.

**Hard case 1 — the shared front leg.** `8a63aa81` (7275P Jun18/Jun23) and `6303e6af`
(7275P Jun18/Jul17) share the exact same front contract `SPXW 260618P07275000`. A lookup
keyed on OCC symbol returns two candidates for every fill on that symbol. The naive
behaviour orphan-parked them, dropping `8a63aa81` to a back-leg-only debit of 62.50 instead
of the true `62.50 − 52.30 = 10.20`.

The fix: within one broker order, the *back* leg is unique to one calendar and anchors the
order; every other fill in that order, including the ambiguous front leg, resolves to that
anchor.

**There is a second layer, and it is the one that actually bit production.** The real
mechanism was a per-calendar rebuild that read fills scoped to one calendar's own legs — so
rebuilding `8a63aa81` never fetched the sibling's unique back leg, and had no anchor to work
with *even with the disambiguation logic correctly written*. The scoped read must be widened
to include **every fill in the same broker order**, not only fills matching the calendar's
own registered legs. Prove this by replaying the real processing order (calendars descending
by `opened_at`, which puts `8a63aa81` before `6303e6af`) and asserting both converge with
zero orphans, including on a second idempotent rebuild.

**Global invariants the suite must also check:**
- **52 fills** written from 13 calendars × 4 fills, even though `60c46a57`/`24f1e72e` share
  one 4-leg broker order (fewer distinct `order_id`s, never fewer fills).
- **Zero orphaned fills** after a full sweep — a storage-layer assertion, so the fills must
  really be stored.
- **Exactly 4 events per calendar**, all OPEN or CLOSE, never a spurious ROLL.

**Tolerance:** the original suite used `toBeCloseTo(expected, 2)` — two decimal places.

**Report each fixture by its real order id**, not a numeric index, so a failure names the
calendar (`pytest.param(..., id=...)`).
</specifics>

<deferred>
## Deferred Ideas

- **Positive ROLL and SETTLE derivation** (`D5-01`) — needs a fixture of its own. The
  negative guard against a spurious ROLL ships in this phase; the positive path does not.
- **Fee-inclusive arithmetic and the cash-delta reconciliation** (`D5-04`) — Phase 9 owns
  `RECON-01`. This phase hands it an explicit `None`, not a zero.
- **A pinned mutation-testing tool** (`D5-03`) — revisit once the seeded-fault suite exists
  and the gate's time budget is known.
- **`last_synced_at` writes** — Phase 6's ingest owns them; Phase 4 shipped the column
  proven null.
</deferred>
