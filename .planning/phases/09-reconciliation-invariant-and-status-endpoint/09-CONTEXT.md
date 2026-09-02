# Phase 9: Reconciliation Invariant and Status Endpoint - Context

**Gathered:** 2026-09-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — four grey areas proposed in batch, all accepted

<domain>
## Phase Boundary

The core value is enforced and queryable — realised P&L equals the broker's cash delta, checked
every ingest cycle.

In scope: the window boundary decision the ROADMAP assigned to this phase (RECON-01); the
reconciliation check itself, running per user every ingest cycle as a test rather than a displayed
number (RECON-02); a failure that names its window (RECON-03); dependent numbers marked
untrustworthy while it fails (RECON-04); and a status endpoint cheap enough to poll before
rendering (API-01).

**This phase is where `D5-04`'s deferred contradiction comes due.** Phase 5 recorded that the
oracle's fee-free convention and the fee-inclusive cash delta cannot both be true, set
`commission_usd = None`, and wrote: *"a `None` forces Phase 9's reconciliation invariant to confront
the missing fees at a typed boundary."* Confronting it is in scope. Rediscovering it is not.

Out of scope: the review API surface (Phase 11), the pre-commitment record (Phase 10), and pricing
the settlements whose money fields are NULL by `D7-07` — that needs Phase 8's market data applied,
which is its own work.

</domain>

<decisions>
## Implementation Decisions

### D9-01 — The window is a settlement-date trading day, in ET

The ROADMAP assigned this open question to this phase and said RECON-01 is untestable until it is
fixed. It is fixed here: **settlement-date trading days**, delineated in `America/New_York`.

**Why:** cash moves on the broker's settlement calendar, not on wall-clock days. A rolling 24-hour
window splits a single trading day's fills across two windows and guarantees a false mismatch every
day. Calendar days do the same thing across every weekend and holiday. The principle the ROADMAP
already settled — a closed window is never re-checked — only means something if the window matches
the unit the broker actually settles in.

### D9-02 — A window closes when a later trading day's broker transaction has landed

Not on a clock timeout.

**Why:** the broker's own later activity is the evidence that it considers the prior day final. A
fixed delay after session end closes a window the vendor may still be writing into, and this project
has already been bitten by exactly that shape — `L048`'s half-open window was blind to an
observation just before its anchor because a periodic trigger and a fixed-cadence source disagreed
about when a boundary had passed.

### D9-03 — Late data reopens a closed window, and the reopening is itself a finding

Never absorbed silently.

**Why:** the ROADMAP's settled principle is that a closed window is not re-checked, but a closed
window whose inputs later change means the broker restated. That is information, not noise.
Silently absorbing it would make the ledger agree with a history that no longer exists; failing to
notice it at all would leave a wrong number standing. Record it explicitly.

### D9-04 — Timezone via `zoneinfo`, never a hardcoded offset

Following `src/morai/ledger/settlements.py`'s established `AM_SETTLEMENT_TIME`/`PM_SETTLEMENT_TIME`
pattern. `tzdata` is an explicit dependency as of Phase 8.

### D9-05 — The fee collision resolves by filling `commission_usd`, not by changing the oracle

Populate `commission_usd` from the broker's own transaction data. **Leave every fee-free money field
on `events` untouched.** Reconciliation then compares `Σ(fee-free realised P&L) − Σ(commissions)`
against the broker's cash delta.

**Why:** `D5-04` states the contradiction plainly — the oracle's convention is `avgPrice × qty`,
never `netAmount`, and the core value requires equality with a fee-inclusive cash delta. Both cannot
be true *of the same field*. Resolving it by making event amounts fee-inclusive would break the 13-
calendar oracle, which is the only genuine oracle this project owns and whose expected values were
computed independently of the code under test. Resolving it by stripping fees from the cash delta
would prove the ledger matches cash-minus-fees, which is not the core value.

Filling the `None` that `D5-04` deliberately left is the resolution it was pointing at: the oracle
reads fields that do not change, and the invariant becomes exactly true rather than approximately.

### D9-06 — Commissions come from the broker's own payload

The same independently-sourced `broker_transactions` rows the cash delta comes from.

**Why:** both sides of the check then trace to the vendor rather than to our own arithmetic. A
commission recomputed from a per-leg constant would be a fabricated input to the check that exists
to catch fabrication (`NN-16`), and the check would be comparing our arithmetic against our
arithmetic.

### D9-07 — Exact equality on `Decimal`. No epsilon.

**Why:** criterion 2 requires a deliberately seeded one-cent discrepancy to FAIL the check. Any
epsilon loose enough to absorb rounding is also loose enough to absorb a cent, which defeats the
criterion outright. This is the concrete reason `decimal.Decimal` is mandatory end to end and
`float` is banned in this path — a float comparison could not satisfy this criterion at all.

### D9-08 — An unknown input makes a window `indeterminate`, never `passing`

Applies to a missing commission, an unrecognised transaction type, and an unpriced settlement alike.

**Why:** a check that cannot be answered must not report a pass. This is the same discipline
`NN-16` applies to data — a gap is honest, never fabricated — carried up to the verdict itself.
`indeterminate` is a third state on purpose: collapsing it into `passed` hides a broken window, and
collapsing it into `failed` cries wolf on every expiry and trains the reader to ignore the alarm.

### D9-09 — Cash-delta membership is an allow-list, not a deny-list of transfers

RECON-01 says "net of transfers." Implement it as an explicit list of transaction types that COUNT
as trading cash.

**Why:** a deny-list silently admits every transaction type Schwab adds later, folding it into the
sum with no signal. An allow-list makes an unrecognised type visible and routes it to `indeterminate`
(`D9-08`). `transaction_type` is already a plaintext column on `broker_transactions`, so the filter
runs in SQL.

### D9-10 — Amounts are summed in Python over decrypted rows, not in SQL

`broker_transactions` keeps `transaction_type`, `transaction_time` and `order_id` in plaintext but
the amounts inside `raw_ciphertext`.

**Why:** the same constraint Phase 7 hit with `fills.quantity` — Postgres never sees the plaintext,
so no SQL aggregate can sum it. Adding a plaintext amount column to make SQL possible would be a
schema regression against CRYPT-02.

### D9-11 — An unpriced SETTLEMENT makes its window `indeterminate`, not failing

`D7-07` deliberately leaves a SETTLEMENT's money fields NULL until market data exists.

**Why:** that is a known, documented gap, not a ledger error. Reporting it as a failure would fire
on every expiry and teach the reader that a red reconciliation means nothing — which is worse than
no check at all.

### D9-12 — One function, two callers: a pytest test and the ingest cycle

The same reconciliation function is invoked by a test (proving the invariant on fixtures, including
the seeded one-cent discrepancy) and by the end of every ingest cycle per user (persisting a
verdict).

**Why:** criterion 2 requires it to run every cycle; criterion 4 requires it queryable. Two
implementations would drift, and the drift would be invisible precisely because both would be green.
`D8-13` established this shape in Phase 8 and it held.

### D9-13 — A persisted `reconciliation_runs` row per user per window

Carrying the window bounds, both sides of the comparison, the signed difference, and the verdict
(`passed` / `failed` / `indeterminate`, with a reason).

**Why:** criterion 3 says a failure must name the failing window "so the next question is answerable
without re-running anything." A stored boolean forces a re-run to learn anything, which is what the
criterion forbids. Storing both sides and the signed difference means the first question after a
failure — how far off, and in which direction — is already answered.

### D9-14 — Trustworthiness is a typed field on the response envelope, not a separate opt-in call

**Why:** `RECON-04` says the API marks dependent numbers untrustworthy rather than serving them
plain. If that signal lives only in a separate endpoint, a client that forgets to call it renders a
bad number confidently — which is the exact failure the requirement names. Carrying it inside the
payload makes ignoring it a deliberate act rather than an oversight.

### D9-15 — The status endpoint reads the latest persisted verdict and never recomputes

**Why:** `API-01` requires it cheap enough to poll before rendering anything. Recomputing on request
would decrypt every transaction in the window per call. The reconciliation already runs on the
ingest cycle and writes its result; the endpoint is one indexed row read.

### Claude's Discretion

Left to implementation, guided by the codebase's established patterns:

- Table and column naming, and whether `reconciliation_runs` mirrors `sync_runs`/`snapshot_runs`
  exactly or diverges where the shape genuinely differs.
- Where `commission_usd` is stored — on `events`, on a sibling table, or derived at read time —
  provided the fee-free fields the oracle reads are untouched.
- The precise `indeterminate` reason vocabulary, provided the causes are distinguishable.
- Whether the trading-day calendar is derived from observed broker activity or from a fixed session
  definition, provided no new dependency is added for it.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/morai/db/models.py::BrokerTransaction` — `transaction_type`, `transaction_time`, `order_id`,
  `activity_id` in plaintext; amounts inside `raw_ciphertext`/`raw_nonce` with a `key_version`.
  This is the independently-sourced side of the check, landed in Phase 6.
- `src/morai/ledger/pairing.py` — `derive_events`, `_signed_leg_amount`, `_net_amount`
  (oracle-validated; must NOT change), and `DerivedEvent.commission_usd`, which `D5-04` left as
  `Decimal | None` specifically for this phase.
- `src/morai/ledger/events.py` — `read_events`, the encrypted money pair, `insert_events` as the
  single write path.
- `src/morai/ingest/sync_runs.py` and `src/morai/ingest/snapshot_runs.py` — two established
  run-ledger shapes `reconciliation_runs` can follow.
- `src/morai/ingest/schwab_sync.py::sync_user` — the ingest cycle this check hooks into; already
  calls `create_positions` and `sync_events` in order on one `morai_app` session.
- `src/morai/crypto/data_keys.py` — the promoted DEK helper (Phase 8), for decrypting transaction
  payloads.
- `src/morai/api/routes_identity.py` — the existing route shape and `response_model` discipline.

### Established Patterns
- Pure derivation function plus a thin async shell with an explicit `as_of`; no `datetime.now()` in
  the pure half.
- One function, two entry points, so a test and production cannot drift (`D8-13`).
- Run-ledger tables record enough to distinguish "ran clean", "never ran", and "ran with per-item
  errors" (`L043`).
- Gaps and unknowns are `None` and a distinct state, never `0` and never silently a pass (`NN-16`).
- Every user-scoped table denormalises `user_id` for its RLS policy; RLS enabled AND forced; the
  worker opens `morai_app` sessions and calls `assert_connection_cannot_bypass_rls`.
- Migrations are Alembic, sequentially numbered; 0015 is current, so this phase writes 0016.
- Money is `Decimal` end to end, encrypted at rest, summed in Python after decryption.

### Integration Points
- `sync_user` in `schwab_sync.py` — where the per-cycle check runs, after `sync_events`.
- `read_events` and `broker_transactions` — the two sides of the comparison.
- The FastAPI app — the status endpoint and the response-envelope trustworthiness field.

</code_context>

<specifics>
## Specific Ideas

- `D5-04` is the single most important input to this phase and should be read in full before
  planning. It names the contradiction, explains why each naive resolution is wrong, and states that
  it was recorded "so Phase 9 does not have to rediscover it."
- Criterion 2's seeded one-cent discrepancy is the phase's own anti-vacuous-pass control: a check
  that cannot fail on a deliberately corrupted input proves nothing. It must be a real test, and it
  must fail before the implementation is correct.
- `L045`-adjacent caution from the record: a reconciliation step "wired to nothing" is correct
  exactly once, the day someone remembers to run it. Chain it off the ingest job whose success
  implies the event happened — do not leave it as a callable nobody calls. Phase 7 shipped exactly
  that bug (CR-01) and Phase 8 was planned specifically to avoid repeating it.

</specifics>

<deferred>
## Deferred Ideas

- Pricing the settlements whose money fields are NULL (`D7-07`). Needs Phase 8's captured market
  data applied to expiries; until then an affected window is `indeterminate` (`D9-11`).
- Alerting when reconciliation fails. This phase makes the verdict queryable and marks dependent
  numbers untrustworthy; routing that to a notification channel is not in its criteria.
- Reconciling anything other than cash — position quantities against the broker's own position
  report, for instance. RECON-01 is specifically about cash.

</deferred>
