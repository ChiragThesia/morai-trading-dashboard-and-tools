# Laws

Stack-independent truths. Each one was paid for. Cite them by number.

Domain-trading facts live in [domain-trading.md](domain-trading.md) (`D###`).
Vendor traps live in [vendors-and-infra.md](vendors-and-infra.md) (`V###`).
Verification and process live in [process-and-verification.md](process-and-verification.md) (`P###`).
Disproved beliefs live in [refuted.md](refuted.md) (`R###`).

---

## The ten that cost the most

Ranked on damage done, not on how the law reads.

| Law | What it cost |
|---|---|
| [L001](#l001-a-composite-key-missing-a-true-discriminator-silently-drops-30-50-of-every-batch) | ~30% then 49.6% of every batch silently dropped, one day apart (migrations 0029, 0030) |
| [L021](#l021-pin-the-unit-of-a-stored-numeric-field-not-just-its-type) | A +$395 trade displayed as −$319,850 |
| [L033](#l033-an-eventemitter-error-event-with-no-listener-kills-the-process) | 81-minute production outage, both services, 2026-07-23 |
| [L035](#l035-gate-a-fallback-on-the-calls-outcome-never-on-a-proxy-signal) | 5-day pipeline freeze behind a healthy token |
| [L002](#l002-identity-comes-from-the-rows-own-symbol-never-from-the-request-that-fetched-it) | 1,294 of 26,115 contracts wrong; every affected leg's T and greeks biased high (migration 0028) |
| [V030](vendors-and-infra.md#v030-cap-every-pool-supavisors-session-pooler-stops-at-15-clients) | One cause, five simultaneous unrelated-looking outages |
| [L045](#l045-latest-is-not-best-the-newest-row-can-be-a-placeholder-zero) | Both GEX walls null; ~2,971 contracts/day zeroed |
| [L003](#l003-on-conflict-do-update-dies-on-an-in-batch-duplicate-key-do-nothing-survives-it) | ~80-minute production outage (commit 0224db1) |
| [P002](process-and-verification.md#p002-two-sides-of-a-contract-can-both-be-green-against-fixtures-neither-producer-emits) | "Authorize with Schwab" silently did nothing; both suites green |
| [D021](domain-trading.md#d021-a-backtest-that-prices-entry-and-exit-from-the-same-chain-slice-measures-the-spread-not-edge) | An entire backtest feature measured transaction cost, not edge |

---

## A. Keys, writes, and silent row loss

The worst category. Nothing errors. Rows just stop existing.

### L001. A composite key missing a true discriminator silently drops 30-50% of every batch.

**Mechanism.** Two structurally different rows collide onto one key. `ON CONFLICT DO NOTHING` discards the loser; `DO UPDATE` overwrites it. Postgres reports success either way. A column that holds a single literal value today still belongs in the key if it is a true discriminator — "it never varies" is not "it can never vary".

**Cost.** Three tables, three separate incidents. `skew_observations` without `root`: 709 colliding keys, 1,632 rows, roughly 30% of every snapshot discarded, plus 629k rows left unattributable (migration 0029). The same table without `contract_type` one day later: 1,748 of 3,521 quotes, 49.6%, thrown away — the put wing read 3.7% of the table before the fix and 50.1% after (migration 0030). `SPX`/`SPXW` colliding on the chain wire contract: 242 duplicate React keys, derived columns blanking by network arrival order, and one row measuring an SPXW back leg at 68.89% IV against an SPX front at 24.69%, fabricating an H-Skew of −44.21. Two operational notes. When auditing a composite key for a missing discriminator, look first at the columns holding one literal value for this dataset — `underlying` is always `SPX` here. Such a column sits in the key, contributes no discrimination, and makes the key look complete. And where the missing column correlates with one already present, history can sometimes be recovered instead of deleted: migration 0030 rebuilt `contract_type` from the sign of delta, verified across 7.2M call legs with zero negative deltas and 7.0M put legs with zero positive ones.

**Source.** Migrations `0029_skew_rr_root_key.sql`, `0030_skew_contract_type_key.sql`; `docs/architecture/data-model.md`; `docs/architecture/api-design.md`; `plans/analyzer-chain-uat-findings.md`.

### L002. Identity comes from the row's own symbol, never from the request that fetched it.

**Mechanism.** One vendor call returns contracts from more than one book. Stamping each row with the label you *asked for* mislabels whatever else came back. The error reaches the derived math, not just a display column: a wrong `root` picks the wrong settlement branch, so time-to-expiry is short by up to a day and every solved IV and greek on those rows biases high.

**Cost.** 1,190 contracts whose OCC symbol read `SPXW` were stamped `root='SPX'`; every one of them also carried an expiration one day early (1,290 off-by-one rows total, 1,294 of 26,115 rows wrong overall — a second source reports the denominator as 26,109; both are preserved rather than reconciled). Root-only mismatches: zero — proof of one writer bug, not two. After the repair, candidates rose 7,314 → 9,465 and root-mismatch drops fell 1,028 → 126 on the same chain, because phantom sparse cohorts merged back into their real book. Two more shapes of the same error, both on the parent side. A calendar row storing one `underlying` and rebuilding both legs from it cannot represent a mixed-root calendar — the two November 7200P/7600P calendars carry an SPX front and an SPXW back, and their back leg mis-resolves in both fill pairing and snapshot leg resolution while the entry debit stays correct. Store per-leg roots, or the full leg OCC symbols. Separately, matching legs on `contracts.underlying`, which is always the plain index symbol, instead of on `contracts.root` returns zero rows for anything in the weekly family: every downstream journal snapshot then wrote 0 or NaN for months with no error, because an empty join does not fail.

**Source.** Migration `0028_repair_contract_root_expiration.sql`; `docs/calendar-engine/measurements.md`; `docs/calendar-engine/spec.mdx`.

### L003. ON CONFLICT DO UPDATE dies on an in-batch duplicate key; DO NOTHING survives it.

**Mechanism.** Two rows sharing the conflict key *inside one INSERT statement* raise `command cannot affect row a second time`. This is not a collision against existing table state. `DO NOTHING` absorbs it first-write-wins; `DO UPDATE` cannot.

**Cost.** Roughly 80 minutes of production outage before the one-clause difference was diagnosed (commit 0224db1, `calendar_ranking`).

**Source.** `docs/architecture/data-model.md`.

### L004. An ON CONFLICT target that does not match the real unique constraint does not dedupe at all.

**Mechanism.** `DO UPDATE` only fires when the stated conflict target lines up with how uniqueness is actually enforced. Mismatched, it inserts instead of updating, and the intended upsert becomes an append.

**Cost.** 75-minute chain-ingest outage, roughly 100 duplicated `occ_symbol` rows. The fix needed application-level dedup plus a Postgres regression test asserting no duplicate `occ_symbol` survives re-ingest — trusting the SQL upsert was the bug.

**Source.** `packages/core` leg-observations write path; `.remember` daily logs 2026-07-27, 2026-07-28.

### L005. ON CONFLICT DO NOTHING makes a corrective backfill a silent no-op.

**Mechanism.** The same clause that makes ingest idempotent also refuses every corrected re-write of an existing key. Fixing the writer and re-running the job inserts nothing. Correcting bad history needs the insert flipped to an upsert for the backfill window, or a delete-then-reinsert.

**Cost.** `upsertContracts` blocked the backfill of the 1,190 corrupted contracts from L002 until the clause was flipped. `writeFills` blocked the same way after the fill-side sign fix; the recovery needed an account-wide `wipe-derived-fills` transaction across `calendar_events` → `orphan_fills` → `fills`. That wipe is not atomic with the reingest that follows it: if the reingest fails or the token expires mid-run, the journal shows no trade history for the wiped window. See also L069. The same clause has a second failure mode, and it is the mirror of L020. A snapshot whose inputs are still filling in — an early GEX compute over a partially-solved BSM cohort, then a later recompute over the full one — discards the *later, more complete* write under DO NOTHING and keeps the wrong early one (fixed in commit dfc7e17 with an upsert). The discriminator against L020: DO NOTHING is right when a duplicate trigger recomputes from identical inputs, and wrong when the later write is strictly more complete. Ask which of the two a re-trigger actually is before picking the clause.

**Source.** `docs/calendar-engine/current-state.md`; `.planning/debug/journal-pnl-opennetdebit-units.md`.

### L006. SELECT-then-INSERT under READ COMMITTED is a TOCTOU race.

**Mechanism.** A SELECT does not lock a row that does not exist. Two callers both see "absent" and both insert; the loser hits the constraint unhandled. This fires whenever two schedules can legitimately target the same composite key — an hourly cron and a ~30-minute writer both round down to the same slot.

**Cost.** One collision aborted an entire calendar's remaining slots, then propagated up and aborted the whole hourly self-heal run across every open calendar. Fixed by `onConflictDoNothing` plus re-read-and-apply, mirroring the sibling writer in the same file that already did it correctly (commit d588a9f). See P013 for how the race was actually reproduced.

**Source.** Phase 40 review, journal history repair.

### L007. Chunk every bulk insert. Postgres caps a statement at 65,534 bind parameters.

**Mechanism.** A parameterized INSERT carries one bind parameter per column per row. A wide table times a large batch crosses the cap and the statement fails.

**Cost.** A Phase 2 regular-trading-hours run generated roughly 175k bind parameters in one query and failed. Fix was chunking at ≤2,000 rows, not raising any limit. Carried forward as a standing regression gate through three milestones.

**Source.** `.planning/STATE.md` regression gates; `.remember` 2026-06-12.

### L008. The dangerous defects are the ones that cannot null themselves. Enforce identity by signature.

**Mechanism.** Most degraded inputs announce themselves — a missing field nulls its own column and renders a dash. A row-identity collision does not. Every value is present and finite, so the join returns a wrong but plausible number. No runtime null check sees it. The only defense is making the full identity a required parameter, so a caller physically cannot construct the ambiguous call.

**Cost.** An SPXW quote at 68.89% IV joined against an SPX quote at 24.69% at the same strike, expiry and type, fabricating a clean-looking H-Skew of −44.21. Nothing dashed. Nothing errored.

**Source.** `plans/analyzer-chain-HANDOFF.md` law 2.

### L009. Widening a shared read makes every key-based lookup a latent wrong match. Grep every consumer — before, and again after fixing the first.

**Mechanism.** Adding a distinguishing field to a shared row type turns every existing lookup key, join and cache into an ambiguous match until it is updated. Fixing one consumer does not prove the rest are fine; it hides that they are still broken.

**Cost.** Widening one chain contract by a single field (`root`) surfaced five separate defects across two sessions, because each was found and fixed individually instead of audited in one pass. Named, so the pattern is recognisable next time. Widening the chain contract by `root` was fixed at the wire contract and the row key (PR #23), and two more consumers stayed root-blind for another session: the chain-math at-the-money IV lookup, which filtered its cohort on expiry and wing only, and the risk-reversal builder, which built one smile out of two books. Both were finally closed by making `root` a *required* parameter rather than an optional filter — see L008.

**Source.** `plans/analyzer-chain-HANDOFF.md` law 1.

### L010. Never foreign-key a satellite table to rows that a rebuild deletes and recreates.

**Mechanism.** A rebuild job that re-derives rows from a source of truth deletes and reinserts them by design. A real FK forces one of two bad outcomes: `ON DELETE CASCADE` wipes the annotation the instant its parent is deleted, before the reinsert restores it; `ON DELETE RESTRICT` blocks the delete and breaks the rebuild. Referential integrity is the wrong tool here. Use a content-addressed soft reference — a hash of the sorted source ids — with no FK. A rebuild reproducing the same source set reproduces the same hash and re-attaches. A genuinely different set orphans the row, which the read path logs and omits but never auto-deletes.

**Cost.** Designed correctly the first time (migration 0017, `calendar_event_annotations`). The alternative was analysed and rejected in the same change.

**Source.** Migration `0017_calendar_event_annotations.sql`; `docs/architecture/stack-decisions.md` D24.

### L011. Money and strike columns are numeric, never integer.

**Mechanism.** An integer column truncates a fractional strike silently on write. Nothing errors.

**Cost.** `gex_snapshots.call_wall` / `put_wall` shipped as integer and were widened two migrations later; a contract test pins the failure (a value of 7412500 divided by 1000 truncating to 7412 instead of 7412.5).

**Source.** Migration `0010_gex_wall_numeric.sql`.

### L012. Append-only observation tables with time-leading composite keys keep the time-series decision cheap to defer.

**Mechanism.** Choosing plain Postgres over a time-series extension is safe if the schema is already time-series-shaped. The upgrade path then needs zero application code — provision the extension, run a hypertable migration, add compression, all inside the adapter.

**Cost.** Nothing. The projection held: journal ~33k rows/year, full chain capture ~1.6M rows/year, against an explicit numeric revisit trigger of 10M rows in any observation table or p95 query latency over 500ms. `leg_observations` measured 824,198 rows at audit. The trigger never approached firing.

**Source.** `docs/architecture/stack-decisions.md` D7; `docs/architecture/data-model.md`.

### L013. A window function evaluates before DISTINCT. Use that to max one column while newest-row-wins the rest.

**Mechanism.** In `SELECT DISTINCT ON (key) … ORDER BY time DESC`, adding `max(col) OVER (PARTITION BY key)` gets the partition max of that one field while every other column still resolves by newest-row-wins. One query, no subselect. Valid only for a monotonic, non-negative field.

**Cost.** This is the fix for L045. Open interest is a once-daily figure and never negative, so `max(open_interest)` beats a fresh zero.

**Source.** `plans/analyzer-chain-HANDOFF.md`.

### L091. Join identity metadata at read time, and one repair fixes every historical row.

**Mechanism.** If an observation row stores only a contract id, and the read joins its root, expiration and settlement style from a metadata table, then repairing that metadata corrects cohort grouping, root scoping and time-to-expiry for every row ever written — with no backfill of the observations at all. Only values actually *computed* at write time carry the old error forward and need their own backfill. Deciding where identity is resolved is therefore deciding how expensive the inevitable repair will be.

**Cost.** Nothing, and that is the point. Migration 0028 repaired 1,294 contracts. Root mismatches on the ranking read fell 1,028 → 126 and no-ATM-reference drops 49 → 0 the moment it landed, without touching roughly 1.58M `leg_observations` rows. The IVs solved at write time under the wrong root stayed biased, deliberately — see L092 for why they were not blanked.

**Source.** Migration `0028_repair_contract_root_expiration.sql`; project memory, calendar-engine build.

### L092. Never blank a column to force a recompute.

**Mechanism.** Setting a derived column to NULL so the solver redoes it looks like a clean backfill. It is two failures at once. The recompute is bounded per pass, so blanking a large history puts every new cohort behind a backlog it can never clear. And every downstream consumer filters `IS NOT NULL`, so a blanked row does not read as slightly wrong — it disappears. Size the existing error along the dimension that matters before deciding a recompute is worth anything.

**Cost.** A proposed fix would have NULLed `bsm_iv` on 1.58M rows and left an 800-row-per-pass drain to redo them: about 41 days to clear, with every live cohort starved behind it (L014). The error being corrected was 16.5 vol points at 1 DTE and at most 0.43 above 15 DTE — and 1.1M of the 1.58M rows sit above 15 DTE. The population was very nearly clean already.

**Conflict.** This is not L041 reversed. L041 forbids *fabricating* a value for a slot that has no data. L092 forbids *destroying* a value that exists and is very nearly right. A gap you never had stays a gap; a number you already have does not get deleted on the hope of a better one.

**Source.** Project memory, calendar-engine build 2026-07-27.

### L100. Processed and orphan-parked is terminal. Register the parent before the sync runs.

**Mechanism.** A sync that stamps `processed_at` and *also* writes the unmatched row into an orphan table has excluded it twice. The pending read skips it for both reasons, so creating the missing parent afterwards does nothing — nothing re-reads it. Ordering is the whole fix: the parent record exists before the sync that attaches to it. Where a content hash records which source rows an event consumed, that hash must be released from the wrong parent before the right one can claim them.

**Cost.** Running `sync-fills` before any calendar was registered parked all 50 fills as orphans and marked them processed, with no reprocess path anywhere in the code; recovery was manual SQL. The same shape then recurred by design, because `register-open-calendars` chains *after* `sync-fills` in the same cycle: every brand-new calendar's first fills orphan on "no matching calendar", leaving OPEN events missing and `realizedPnl` stuck null. The repair order that works: rebuild the old calendar first to release its `fillIdsHash`, delete the stale orphan rows, then rebuild the new one.

**Source.** Project memory, trade ledger and production pipeline work.

---

## B. Backlog, batch, and job shape

### L014. Bound the batch and read newest-first, or the live cohort is never reached.

**Mechanism.** An unbounded oldest-first read under sustained new arrivals puts the current cycle at the tail. Every run "succeeds" and the newest data stays unprocessed forever. Two changes together are required: cap the batch, and flip the order.

**Cost.** Found twice. 2026-07-07: GEX put wall was wrong because the newest chain cohort's puts never got BSM-priced — `putWall: null`, `flip: null`, `poi: 0` at every strike, with the default `(time ASC, contract ASC)` index order to blame. Batch bounded 2,000 → 12,000, later 24,000 as the cohort grew. The same regression recurred 2026-08-06. The trade-off is documented in the code: the pre-existing old backlog then drains slowly. The ordering came from the index the read happened to use — `leg_obs_pending_bsm_idx` on `(time ASC, contract ASC)` — so inside a partially-reached cohort even the contract tie-break biased which rows got done, calls before puts. Fixed in commit 2d41092 by ordering on `desc(time)`. Live-confirmed the same day at 13:42Z: put wall 7455, flip 7360, call wall 7550, all three non-null for the first time.

**Source.** `.planning/debug/resolved/gex-schwab-bsm-null-puts.md`; `.remember` 2026-07-07, 2026-08-06.

### L015. Per-row I/O plus one atomic end-write inside a timeout-bounded handler is a death loop.

**Mechanism.** Read the whole backlog with no LIMIT, do an I/O round trip per row even when rows share a lookup key, write everything at the end. Once the backlog exceeds what fits in the handler timeout, every attempt fails at the same point and the end-write throws away all the work. Retries redo the same doomed run. Zero forward progress, forever.

**Cost.** 56,232 pending rows, all sharing one observation date, calling `readRate()` once per row. Every retry blew the pg-boss 900s handler cap (`handler execution exceeded 900s`, retry_count exhausted). Fix: memoize by distinct key (56k calls → 1) and bound the batch.

**Source.** `.planning/debug/resolved/market-data-pipeline-stalled.md`.

### L016. Commit each bounded batch in its own transaction, exit ok on budget exhaustion, and resume for free off the pending predicate.

**Mechanism.** Four rules together. Loop while now < deadline. Commit each batch separately so a mid-run kill preserves the completed ones. On budget exhaustion return ok, not err — the remaining rows are still pending and will be picked up naturally, so the job is not failed. Rely on a `WHERE … IS NULL` predicate so the next invocation skips solved rows automatically. That is idempotent resume with zero cursor bookkeeping.

**Cost.** Nothing, once built. Sized as `COMMIT_BATCH_SIZE=800` and a 700s time budget against a 900s pg-boss expire cap, leaving ~756s of worst-case in-flight overshoot safely under it. A real-Postgres contract test kills the run after batch 1, proves batch 1 stays committed, and proves the second invocation drains to zero with no rework. Measured throughput was 14.3-20 rows/sec.

**Source.** Phase 25 verification and review, data-quality ops rider.

### L017. An index built to speed a filtered query can become the slow part once it bloats.

**Mechanism.** A partial index grows with the table. "There is an index" is not "it is still fast". Check index size against table size.

**Cost.** `compute-bsm-greeks` timed out at 120s finding rows still needing pricing, backlog 11.8k. The index intended to make that lookup fast had reached 222MB. Dropping it (migration 0025) and raising the worker timeout to 600s collapsed the backlog 11.8k → 584 in one cycle. There is a stronger version of this. `leg_obs_pending_bsm_idx` had `idx_scan = 0` in production for its entire life — the planner always chose a primary-key backward scan and never touched it — while the transient predicate rows bloated it to 222MB of pure write amplification. The comment above it named the query it supposedly served, and that comment was the only evidence anyone had. Audit an index against `pg_stat_user_indexes`, never against its own docstring.

**Source.** Migration `0025`; `.remember` 2026-07-20.

### L018. A bulk history scan belongs in an operator CLI, not a timeout-capped queue handler.

**Mechanism.** A full historical scan has no natural completion bound and grows over time. A handler cap will eventually beat it no matter how it is tuned. A queue is also the wrong shape for an on-demand, non-recurring analysis.

**Cost.** The backtest shipped as an operator CLI following the existing `fix-pnl-reingest` and `backfill-transactions` precedent, explicitly because the same 900s cap that caused L015 would throttle a full-history scan.

**Source.** `.planning/research/ARCHITECTURE.md` anti-pattern 4; `.planning/research/STACK.md`.

### L019. A single item's failure must not abort the whole batch.

**Mechanism.** A loop over independent units that returns `err` on the first failure cancels every other unit's work in that run. Accumulate a per-item error count and continue; surface partial-failure counts to the caller.

**Cost.** One colliding slot on one calendar aborted the entire hourly self-heal across every open calendar (Phase 40 WR-01, fixed commit 8518c32). Same shape as L038 on the read side. The streaming version of this kills more than a batch. A tick handler that parsed an incoming timestamp with a `z.string()`-only schema and ran its regular-hours gate synchronously inside the loop threw a `RangeError` on one unparseable timestamp; the exception rejected the bare-`void` connection promise and permanently killed live greeks and snapshot detection, with no reconnect. Extract the handler, guard the timestamp before the gate, and wrap the connection in a self-healing reconnect loop.

**Source.** Phase 40 review.

### L020. Key a derived row's timestamp to the cohort's own data clock, never to wall-clock now().

**Mechanism.** A recurring job computing over a specific upstream batch should stamp the result with the instant that batch's data used — the chain quote time — not the moment the job ran. Combined with `onConflictDoNothing` on (cohort time, entity id), a duplicate or overlapping trigger becomes a harmless no-op instead of a PK violation that retry-loops the job, or a double write of conflicting values for one logical observation.

**Cost.** Learned once on `picker_snapshot` (WR-01) and reused deliberately for `exit_verdicts`.

**Source.** `.planning/research/ARCHITECTURE.md` pattern 3.

### L090. A budget-limited drain does not process the same subset every run.

**Mechanism.** A batch job whose row budget is smaller than its workload finishes a different slice each cycle. Nothing in the design pins which one. So per-slice completeness has to be measured as a coverage matrix — cycle against slice — and never inferred from a single sample. A slice that was complete an hour ago can be empty now while a slice that was empty is complete.

**Cost.** About 11,971 legs needed pricing each cycle and roughly 4,000-5,600 got it. The 14:00Z cycle priced 2026-08-17 through 08-28 in full and left 09-18 at 530 of 1,044. The 12:30Z cycle priced 09-11 through 09-17 instead and left 08-24 through 08-28 at zero. The monthly GEX line therefore runs on about 48% of its own book, and which 48% changes every thirty minutes.

**Source.** Project memory, BSM coverage audit 2026-08-17.

### L096. A job that must run after an event, but only runs on demand, is stale after every event.

**Mechanism.** A registration or reconciliation step that exists to run after a state change, and is wired to nothing, is correct exactly once — the day someone remembers. Every recurrence of the event re-opens the gap silently, because the stale state is a plausible state. Chain it off the upstream job whose success implies the event happened.

**Cost.** `register-open-calendars` ran only when triggered by hand. After the 2026-07-10 and 2026-07-16 rolls nobody triggered it, so the registry sat entirely closed while the broker book held two live calendars, and the exit advisor answered "No open positions" for both.

**Source.** Project memory, payoff mixed-source work.

---

## C. Numbers that lie

### L021. Pin the UNIT of a stored numeric field, not just its type.

**Mechanism.** A field typed `number` carries no unit. Stored in dollars and consumed by a formula expecting index points, it is off by the contract multiplier.

**Cost.** `openNetDebit` stored in dollars, read as points against the $100 SPX multiplier: a +$395 trade displayed as −$319,850, roughly 100x. Pinning it down took a five-round oracle-driven debug, because units were only one of several compounding bugs (sign, calendar-status regression, shared-leg attribution, closed-status transitions). Units alone would not have explained the full discrepancy. All 13 real calendars matched the ground-truth oracle within $0.02 after the whole chain was fixed.

**Source.** `.planning/debug/journal-pnl-opennetdebit-units.md`; `.planning/debug/journal-pnl-ground-truth.md`.

### L022. Read a directional signal once at its authoritative source. Never re-derive it from mutable app state.

**Mechanism.** A parent record's current status column is a point-in-time value. Deriving a historical event's direction from it is correct only while that mutable state has not changed — and silently wrong the moment it has.

**Cost.** Two independent bugs, same shape, same pipeline. `syncFills` signed `netAmount` from OPEN/CLOSE classification instead of the fill's real buy/sell direction: `openNetDebit` came out 286.47 (two debits summed) instead of 32.35 (a debit netted against a credit). `readCalendarLegs` derived OPEN/CLOSE from `calendars.status` and applied it uniformly to every fill: a calendar registered open but carrying a real CLOSE order summed 159.41 − 127.06 − 123.13 + 86.78 = −4.00, exactly the production regression figure. The replay case is worse than the live case. Re-running history with every parent in its *final* state misclassifies every event the same way — one `sync-fills` sweep with all calendars marked open classified every fill as opening and produced zero realized P&L across the whole book. A historical replay has to stage the parent's status transitions along the real timeline, which is a second reason not to derive direction from that column at all.

**Source.** `.planning/debug/journal-pnl-opennetdebit-units.md`.

### L023. Math.abs() on a vendor's signed amount destroys the only field carrying direction.

**Mechanism.** Schwab's `transferItems[].amount` is signed: positive means contracts received, negative means delivered. The `cost` sign in the same item independently corroborates it — negative cost is a debit, a buy. Taking the absolute value to get a quantity forces every downstream consumer to guess direction from a weaker signal. See L022 for what that guess costs.

**Cost.** The fixture proves the convention: an OPENING row with `amount:1, cost:-1250.00`, a CLOSING row with `amount:-1, cost:800.00`.

**Source.** `packages/adapters` Schwab transactions adapter; `schwab-transactions.fixture.json`.

### L024. Three states, not two. NULL means never processed. 'NaN' means permanently failed.

**Mechanism.** If a solver writes NULL both for "not yet reached" and for "solved and failed to converge", no reader can tell "wait, it is coming" from "this will never resolve". Write the string `NaN` for a permanent failure and reserve NULL for unprocessed. Every consumer then filters `IS NOT NULL AND <> 'NaN'` explicitly.

**Cost.** This distinction ruled out a whole class of investigation for free. The BSM solver always NaN-stamps a failed inversion, so finding `bsm_iv` NULL for the Schwab cohort's puts proved the rows had never reached the inversion step at all — a starvation bug (L014), not a math bug. No one had to read the math. Roughly 10% of legs carry no solved IV on any given cycle (3,558 legs, 3,200 with IV), so a NULL never means "no such contract".

**Source.** `.planning/debug/resolved/gex-schwab-bsm-null-puts.md`; `docs/calendar-engine/current-state.md`.

### L025. An unguarded division makes Infinity, which passes a NaN-only gate and poisons JSONB forever.

**Mechanism.** `z.number()` accepts Infinity; only `.finite()` rejects it. A `Number.isNaN` guard lets a divide-by-zero through untouched. Persisted as JSONB, `JSON.stringify` converts Infinity to `null` because JSON has no Infinity literal. The next read re-parses with the strict schema, `null` fails `z.number()`, and the whole batch read errors — taking down the endpoint for every row, not just the corrupt one, until manual SQL cleanup. Fix at both ends: guard the denominator at the source, and tighten the schema to `z.number().finite()` so a bad value is rejected at the write boundary.

**Cost.** `pnlPct = (netMark − openNetDebit) / openNetDebit` with `openNetDebit` reaching 0 through three separate paths — a reset during every sync-fills pass, a NULL mapped to 0 on read, and equal-average-price registration (CR-01, Phase 26, fixed 0708de8 / d893f47). The identical class was found independently in Phase 24's regime-board ratio indicators (WR-01, fixed a3da1de).

**Source.** Phase 26 and Phase 24 reviews.

### L026. `Number("")` is 0, not NaN.

**Mechanism.** A save handler that special-cases only `raw === undefined` misses the far more common case: a user clicks into a field, clears it to retype, and the draft becomes the empty string. `Number('')` is 0, which passes `Number.isFinite`, so 0 silently replaces the previous value.

**Cost.** A live trading parameter — a VIX threshold, an HY OAS crisis level — could be saved as 0 with no error anywhere (WR-02, Phase 29, fixed 323ceaa).

**Source.** Phase 29 review.

### L027. A zero-width linear-scale domain silently produces NaN for every point.

**Mechanism.** A domain of `[spot, spot]` divides by zero inside the scale. `scale(x)` and `invert(x)` both return NaN. The chart renders broken and empty with no error. Guarding only the empty-input case misses the case where the input list is non-empty but every item is filtered out of contribution.

**Cost.** `computePayoffDomain` special-cased `positions.length === 0` but not "positions exist and none contribute" — user-excluded checkboxes, or legs whose IV did not converge. No test covered it (WR-01, Phase 30).

**Source.** Phase 30 review.

### L028. An unclamped percentage fed into a CSS width goes negative, and the element vanishes.

**Mechanism.** Browsers drop an invalid negative width declaration instead of erroring. For an absolutely-positioned box with only `left` set, that collapses it to nothing. No exception, no console warning, no failing test unless the test asserts on that element's computed style.

**Cost.** A regime gauge clamped its value marker but not its band thresholds. A legal override (`vvixWarn: 140`, `vvixCrisis: 200`) against a fixed 70-150 axis yields `crisisPct = 162.5` and `width: -62.5%` — so the "approaching crisis" band disappears exactly when it fires. Reachable without any override too: VVIX has printed above 150 (cited around 200+ in February 2018) against that same fixed axis (CR-01, Phase 31).

**Source.** Phase 31 review.

### L029. Construct and read a Date with matched methods. Never mix UTC and local.

**Mechanism.** `new Date("YYYY-MM-DDT00:00:00.000Z")` is a UTC instant; reading it with `getFullYear()/getMonth()/getDate()` returns the previous calendar day at any negative UTC offset. `new Date(y, m, d)` constructs in the server's local timezone, which works by coincidence in local dev and breaks in production. The only invariant pattern is a closed round trip: local constructor with local getters, or `Date.UTC` with UTC getters.

**Cost.** Hit three times. The third instance fed a UTC-anchored Date to a function contractually expecting local input: ~1% relative error in T for a ~98-day expiry, corrupting rate interpolation and the implied-carry parity solve (CR-01, Phase 34, fixed 091b419). The test's own "independent oracle" reproduced the identical buggy construction, so it could not catch it (WR-02). The same class also co-occurred with L002 in migration 0028. A related footgun: `toISOString().slice(0,10)` day-bucketing is safe here only because US regular trading hours (13:30-21:00 UTC) never straddle UTC midnight — that assumption does not travel to another market.

**Source.** Phase 34 review; Phase 40 review; `.planning/todos/pending/03-code-review-followups.md`.

### L030. A rank over a nearly-empty history is a random number wearing a confident label.

**Mechanism.** A percentile needs roughly a full seasonal cycle — about 250 daily observations for a one-year lookback — to mean what its name implies. Below that, the value is noise. The fix is structural: every rank carries its own sample count `n`, and the consumer renders null below a floor.

**Cost.** The second row `risk_reversal_observations` ever wrote reported `rrRank = 100` — it had exactly one prior value to beat. History depth at audit: `leg_observations` 30 days, `skew_observations` 23, `risk_reversal_observations` 23, `term_structure_observations` 17, macro VIXCLS 17 rows. All far short of the ~252 any percentile gate needed.

**Source.** `docs/calendar-engine/measurements.md`; `docs/calendar-engine/current-state.md`.

### L031. Uniform scaling of every weight is a no-op under sum-normalized scoring.

**Mechanism.** If the score is `sum(w_i · c_i) / sum(w_i)`, multiplying every `w_i` by the same constant leaves the ratio unchanged. Only a change in the relative mix can move the score. A preview that "simulates" a weight change by scaling all weights shows a fake, suspiciously uniform delta.

**Cost.** A settings preview re-scored event-bucket candidates with weights scaled ×0.9 and every candidate showed a uniform −5. Hand-verification against all 8 live event candidates recovered the real formula: `round(sum(standard_w · c) / 100 + 10 · bonus)`. Fixed by using the actual per-field values (commit a7e4fe9). The tell is the uniform delta.

**Source.** Phase 32 UAT.

### L088. Two functions computing the same boundary from opposite directions need one shared threshold check.

**Mechanism.** "When does X start being true" and "when does X stop being true" derived independently, with the same-looking but differently-directioned inequality, produce an off-by-one. One used `>= N` days inclusive; the other found the first date where `businessDaysSince >= N`. Derive both from one comparison, or test them against each other directly across the whole window.

**Cost.** A loss on Monday, evaluated Wednesday: the trading brake was still **active** on Wednesday while the displayed "lifts on" date read Wednesday too — telling the operator the cooldown lifts today while it was still blocking today (WR-01, Phase 28, fixed 9770068 by switching to strictly greater, plus a boundary-agreement regression test comparing the two functions across the full window).

**Source.** Phase 28 review.

### L095. One position, one mark source. Every leg or none.

**Mechanism.** A calendar is hedged, so staleness in its marks cancels — but only when both legs are priced from the same source at the same instant. Price one leg from a live tick and its partner from the broker's `marketValue`, because that expiry sits outside the chain-fetch window, and the mismatch does not cancel. It lands as P&L. Resolve the whole row from one source, or fall back for the whole row.

**Cost.** One calendar showed a +$1,372 phantom: the position chip read +$1,490 against a true −$40. Fixed in commit 647d91e by requiring every leg ticked before a row prices from ticks, and pricing the whole row from the broker payload otherwise.

**Source.** Project memory, payoff mixed-source work.

### L097. A zero volatility does not throw. It prices forward intrinsic.

**Mechanism.** `bsmPrice(sigma = 0)` returns the forward-intrinsic value, and returns NaN when the strike sits at spot with rate equal to carry. Neither is an error. So a pipeline that stamps `iv = 0` on a leg whose inversion failed to converge reprices that leg silently instead of refusing. Guarding the math is the wrong fix: exclude a non-convergent leg from the inclusion set entirely, mirroring whatever the T+0 path already excludes.

**Cost.** A regression test measured roughly $18.2k of book-P&L error at expiry from exactly this path. The existing fixture could not have caught it — it set `status: "non-convergent"` while keeping a non-zero IV, a combination production never produces.

**Source.** Project memory, Phase 17 close.

---

## D. Failure handling and degraded modes

### L032. Three failure classes need three different responses. One blanket try/catch is worse than none.

**Mechanism.** Boot-time I/O that cannot succeed yet deserves exponential backoff, then a deliberate exit so the host restarts. A recoverable runtime error the library already self-heals from deserves a log and nothing else. A genuinely unexpected error means process state is now undefined and could corrupt data if the process limps on — log it with cause, then `exit(1)`. Catching all three the same way either masks a state that should crash and restart, or crashes a state that would have healed itself.

**Cost.** On 2026-07-23 the database was unreachable for 81 minutes. Both services died on their first unguarded await, logged nothing but a driver stack trace, and restart-looped into the same dead connection. The redesign settled on 10 attempts, 1s base, 30s cap — about four minutes of in-process patience.

**Source.** `docs/architecture/deployment.md`.

### L033. An EventEmitter 'error' event with no listener kills the process.

**Mechanism.** Node rethrows an unlistened `error` event as an uncaught exception. A library that recovers from a connection blip on its own never gets the chance, because Node's rethrow pre-empts it. Attach a listener even when there is nothing to do in it.

**Cost.** Half of the 81-minute outage in L032. pg-boss recovers from pooler blips by itself; nobody was listening. The fix was not a library fix — it was `jobBoss.on('error', …)` in both composition roots, plus process-level `uncaughtException` and `unhandledRejection` handlers, plus a retry loop around boot-time migration (three files, TDD).

**Source.** `docs/architecture/deployment.md`; `.remember` 2026-07-24.

### L034. Never collapse every non-200 to one error code.

**Mechanism.** Mapping any non-2xx — a 400 bad parameter, a 502 gateway overflow, a real 401 — to the same downstream code as a credential failure makes every unrelated failure masquerade as a dead token. Debugging then goes to the auth system while the real cause sits unexamined.

**Cost.** A malformed symbol returned 400, was relabelled `AUTH_EXPIRED`, and misdirected debugging for over five days while the token refreshed cleanly (`last_refresh_error` NULL, `issued_at` current) and a raw GET with that same token returned 200. Fixed so only a real 401 maps to `AUTH_EXPIRED`; every other status returns `SCHWAB_FETCH_ERROR_{status}`.

**Source.** `.planning/debug/resolved/chain-frozen-schwab-symbol.md`.

### L035. Gate a fallback on the call's outcome, never on a proxy signal.

**Mechanism.** Choosing between a primary and a fallback source from the credential's state at the *start* of an invocation means a healthy credential with a failing call gets no fallback. The pipeline goes dark behind a green token and the safety net never engages, because it was wired to the wrong signal.

**Cost.** Zero rows had ever been written from the primary source while its token stayed fresh, because the chosen fetch kept 400-ing with no retry inside the same invocation. Five-day pipeline freeze from 2026-07-01. Fixed by composing a try-primary-then-fallback fetcher inside the healthy-token branch. There is a nastier corollary. If the fallback is gated on the credential looking unhealthy, then *repairing* the credential routes traffic onto the broken primary. The pipeline had been running fine on the fallback for days precisely because the token was expired; every re-seed flipped routing onto the 400-ing Schwab path and killed it again. The maintenance action was the outage. Before any routine credential repair, check which path is actually serving data.

**Source.** `.planning/debug/resolved/chain-frozen-schwab-symbol.md`.

### L036. A null vendor payload is a fetch failure, not "no new data".

**Mechanism.** Treating a null response as an empty result set means the pipeline goes stale silently instead of erroring. The same missing guard recurs in every module that consumes the job's data.

**Cost.** Schwab's fills API returned null for a period; the journal went stale and left three verdicts unlinked to any real position. The fix needed both an explicit null-payload branch and a per-run reconciliation window. Four days later the same missing guard — `safeParse(null)` with no `?? {}` fallback — was found in a *different* module consuming the same job's data.

**Source.** `.remember` 2026-07-10, 2026-07-14.

### L037. A staleness log must separate a storage error from a genuine miss, and must carry the age.

**Mechanism.** If a null read collapses both causes into one label, an operator cannot tell "database hiccup, will self-heal" from "leg never observed, pipeline may be dead". A boolean stale flag is equally useless: `stale (137m)` and `stale (2m)` are very different operational signals.

**Cost.** The skip-warn in `snapshotCalendars` reported `missing` for both cases with no third branch, and omitted the age entirely (WR-01, Phase 25, fixed 7e6e7f8). This is the diagnostic distinction a data-quality phase exists to provide.

**Source.** Phase 25 review.

### L038. A batch read parses per row. One corrupt row must not fail the read for every row.

**Mechanism.** Wrapping a whole parse loop in one try/catch with `.parse` makes all-or-nothing the failure shape. For a per-entity advisory or status read that is wrong: one bad blob should degrade one entity, not 500 the endpoint for every entity indefinitely. Use `.safeParse` per row and skip-and-warn.

**Cost.** `readLatestVerdictsPerCalendar` had the all-or-nothing shape, which is exactly what the Infinity-to-null poisoning in L025 would have triggered (WR-01, Phase 26, fixed 4499087). The correct pattern already existed in the codebase — `readJournal`'s unknown-source skip.

**Source.** Phase 26 review.

### L039. A live-write-only pipeline turns every outage into a permanent hole.

**Mechanism.** Writing only forward and never backfilling makes every outage, late registration, and transient skip permanent — even when the raw source needed to reconstruct those rows still exists elsewhere in the system. If the raw source survives, build the rebuild path.

**Cost.** One open calendar held 46 snapshots with only 12 non-gap rows: 10 on one day, 2 on another, four days entirely gap (spot 0/NaN), four days entirely empty from a worker-down window. Live diagnosis on 2026-07-14 found open calendars 100% gap on the back leg with zero rows written since 2026-07-08.

**Source.** `.planning/REQUIREMENTS.md` Phase 40 intro; `.planning/STATE.md`.

### L040. Stopping bad writes without a repair path just moves the failure mode.

**Mechanism.** A fix that stops the pipeline writing bad rows removes the visible symptom and introduces a worse one — silent skips with no backfill — unless the repair lands in the same change.

**Cost.** Phase 25 stopped `snapshot-calendars` writing gap/NaN rows. The actual repair (self-heal plus a rebuild CLI) landed a full milestone later in Phase 40. In between, affected calendars carried silent, unrecoverable holes.

**Source.** `.planning/STATE.md` open follow-ups.

### L041. An honest gap beats a fabricated value. Fill only; never overwrite.

**Mechanism.** When a slot genuinely has no market data, the correct render is a gap — never an interpolated or carried-forward value, even though the chart looks less complete. Repair logic may fill a gap only once real data exists for it, and upserts must never overwrite an existing non-gap row.

**Cost.** Adopted as a locked invariant, which is why the self-heal window bug (L048) was fixed by adding observability first rather than widening the window speculatively — a wider window risks fabricating a row for a genuinely empty slot from a prior slot's stale observation. Pin what counts as a gap, in code, once. Here a snapshot is a gap when `spot = "0"` or any greek or IV is non-finite. A gap interval is then skipped entirely — the line breaks, and every cumulative attribution field spanning it stays null rather than carrying a value forward. See L092 for the inverse error: deleting a value that does exist in order to force a recompute.

**Source.** `.planning/REQUIREMENTS.md` HIST-01, HIST-02.

### L042. A stalled job is indistinguishable from a vendor outage until you check job liveness.

**Mechanism.** "The data stopped" has two causes that look identical from the data: the upstream died, or your scheduler did. Check whether the job is still running, separately from whether the endpoint is reachable.

**Cost.** GEX open interest read 0 for an extended period. The endpoint was confirmed live. The adapter's own scheduled job had silently stopped at 04:00Z and never resumed. No alerting existed to tell the two apart. Which job you check decides whether the answer means anything. Prove liveness only with jobs on their own cron — the chain fetch, rates, BSM greeks, the transaction and fill syncs, COT. Chain-triggered jobs such as `snapshot-calendars`, `compute-analytics` and `compute-gex-snapshot` sit idle by design whenever their upstream fetch fails, so their idleness is expected baseline and not a deploy regression. A container reporting SUCCESS only proves it booted.

**Source.** `.remember` 2026-07-31.

### L043. A job that logs nothing on success makes "healed nothing", "never ran", and "errored per-slot" identical.

**Mechanism.** Production is blind to which of the three happened. Before deciding how to fix a repair job that appears to do nothing, make it log an explicit per-run coverage line — rows healed, honest gaps, errors — so the failure mode becomes observable first.

**Cost.** Gap rows at 14:00Z and 15:00Z were unchanged after two cron cycles with no errors logged anywhere. Root cause was L048, but nothing in production could have shown that.

**Source.** `.planning/debug/self-heal-journal-no-op.md`.

---

## E. Reads: staleness, provenance, freshness

### L044. A freshness flag computed at write time must be re-checked at read time against the same tolerance.

**Mechanism.** If an upstream stage stalls, a status row written at T freezes at its write-time flags forever. The read use-case must independently re-check `(now − observedAt)` against the same tolerance the writer used and force the safe state when stale. Export the tolerance constant so both paths share one number.

**Cost.** `getExitAdvice` served the persisted verdict straight through with no re-check against a 45-minute staleness tolerance — a verdict written as `indicative: false, escalate: true` stayed that way indefinitely if `compute-picker` failed. The reviewer flagged it as "exactly the worker-down failure mode this repo has hit twice" (WR-02, Phase 26, fixed a86e5bd).

**Source.** Phase 26 review.

### L045. "Latest" is not "best". The newest row can be a placeholder zero.

**Mechanism.** `SELECT DISTINCT ON (…) ORDER BY observed_at DESC` returns the chronologically newest row, including one carrying a structural zero. Off-hours rows shadow the last known-good value from the prior session. The read layer is the bug — the vendor and the write were both correct. Fix with L013.

**Cost.** Open interest zeroed for roughly 2,971 contracts per day and nulled both GEX walls. Measured: 0.0% of contracts carried non-zero OI between 04:00Z and 10:00Z, against 86.3% non-zero from 10:30Z onward. The same naive pattern existed in three separate repos — picker-chain, gex-snapshot, backtest-chain — all fixed together.

**Source.** `.remember` 2026-07-27; `docs/calendar-engine/current-state.md`.

### L046. A batch-freshness cursor anchored on the first completed unit captures a half-written batch.

**Mechanism.** A downstream job that anchors "latest cycle" on the newest row with a non-null derived value advances the moment the *first* item of a large batch finishes, while another job is still draining the rest. A write timed into that gap captures a cohort that looks complete — nothing errors, nothing nulls — and is missing hundreds of rows. Nothing in the persisted data can tell afterwards. Two layers are needed and neither alone is sufficient: schedule the write after the typical drain window (reduces the probability), and store an explicit count of still-unsolved rows at write time (makes a miss identifiable afterwards).

**Cost.** Measured 2026-07-28: the 18:00:22Z cohort carried 853 unsolved put legs at 18:05Z and zero by 18:14Z. The cron's 25,55 offset keeps writes out of that window; the soundness counter is what makes a write that landed in it anyway detectable. Two refinements from the BSM drain. Anchor on the newest cycle whose *front* slice is fully priced — `HAVING count(priced) = count(*)` over the near-term expiries — rather than on the newest cycle carrying any priced row at all; the 14:30Z cohort held 1,600 priced gamma rows and 0 of 424 on the 0DTE. And reconcile the recompute against an independent read of the same aggregate before trusting it: `get_gex.byExpiry` disagreeing 38.89 against 35.47 is what surfaced the half-written read, and the corrected run reproduced byExpiry to four decimals on all twelve expiries. A quantized output count is its own tell. A pricer working a fixed at-the-money window per cohort produces either about a window's worth of rows or none, so a single-digit count means you read mid-write — two separate agents saw 3 of 254 strikes priced and both concluded the expiry was unscoreable, and the next cycle showed 50 of 254 with every metric computed.

**Source.** `docs/architecture/data-model.md`, `calendar_ranking`.

### L047. Verify data provenance, not just a health endpoint.

**Mechanism.** Check which upstream produced a specific row. A parsing bug in one timestamp field can silently route the whole pipeline to a degraded secondary source while every health check and dashboard stays green.

**Cost.** A sidecar serialized UTC as `+00:00` where the receiving Zod schema accepted only a literal `Z`. The mismatch broke the primary→fallback data-source routing silently for days. The symptom looked like a fallback bug; the cause was a cross-language ISO-8601 format assumption never pinned to one canonical form at the service boundary.

**Source.** `.planning/RETROSPECTIVE.md` key lesson 2; `.remember` 2026-06-28.

### L048. A half-open slot window is blind to an observation just before the anchor.

**Mechanism.** Resolving a slot from `[anchor, anchor + interval)` misses an observation timestamped just *before* the anchor. That happens systematically when a periodic trigger collides with a fixed-cadence fetch — an hourly cron against an every-30-minute fetch pairs the slot with the globally-latest observation from the *previous* fetch cycle.

**Cost.** Reproduced in both directions: an observation at anchor+50s heals (rowsHealed 1); the identical case at anchor−30s stays NaN (rowsHealed 1, honestGaps 69, 14:00 frontIv NaN). Traced to `compute-bsm-greeks` on `0 * * * *` colliding with `fetch-schwab-chain` on `*/30 * * * *` at the top of the hour.

**Source.** `.planning/debug/self-heal-journal-no-op.md`.

### L049. A client-cached "done" flag is not ground truth for anything with its own expiry.

**Mechanism.** A UI that seeds state from a persisted completed-set will keep showing an item as fresh after its real credential re-expired, if the operator never completed the whole flow and the tab stayed open. Derive current state from a live status check; use the cache only to bridge a redirect round trip.

**Cost.** A re-auth wizard trusted `sessionStorage` alone. A token re-authorized and left in an open tab for a full 7-day cycle would reopen showing that app green while it was actually re-expired (WR-03, Phase 37, fixed a87bc9a). Fixed by requiring both the cache *and* a live `tokenFreshness` check.

**Source.** Phase 37 review.

### L050. A preview that substitutes stored data's own timestamp for "now" defeats every staleness check.

**Mechanism.** `businessDaysSince(asOf, asOf)` is always 0. A reconstruction that reads a persisted snapshot and feeds that snapshot's own `asOf` as the current clock makes every age comparison trivially pass.

**Cost.** A gate persisted as blind *because its macro data was stale* silently un-blinds in preview, always — the stale path carries real non-null values, so it is exactly the path this breaks. This directly contradicted the code's own comment claiming the preview reproduces the blind state. Tests using a fresh fixture gave zero coverage of it (CR-01, Phase 32, fixed c064009 by injecting a real `now()` port). The real compute path used actual wall-clock all along.

**Source.** Phase 32 review.

### L087. A ratio built from two different observation times can flip a band spuriously.

**Mechanism.** A numerator refreshed near-real-time divided by a denominator that is the prior session's close is not observed at one instant. Stamping `asOf` to the **older** input keeps the UI from overstating freshness — but the ratio still divides today's intraday reading by yesterday's stale close. During a fast intraday move the stale denominator inflates or deflates the ratio and flips a calm/warning/crisis classification that nothing real justifies. A same-vendor, same-cadence ratio does not have this problem.

**Cost.** Caught in review before it did damage, and deliberately left as a documented display-only limitation rather than a code change — with the next phase explicitly gated from wiring the indicator into a hard gate until both legs share an observation time (WR-02, Phase 24, documented in commit 95498f4 as a known-limitations section).

**Check any cross-vendor ratio for this before it reaches an actionable gate.**

**Source.** Phase 24 review.

### L093. Never group multi-source cycle data into fixed calendar slots.

**Mechanism.** Two vendors answering the same 30-minute cycle do not answer at the same speed. Bucket their rows by which `:00`/`:30` slot they landed in and a cycle that straddles the boundary puts each source on a different side of it. The slot read then sees one source per cycle, every cycle, and still looks like a working union. Take the cohort as a rolling lookback from the newest observation instead — a window has no boundary to straddle.

**Cost.** CBOE answers about 60 seconds faster than Schwab. The slot-grouped union read single-source every cycle: both GEX walls collapsed onto 7500 and net gamma printed a −18 Bn artefact. Fixed in commit 1e3a8e7 by taking the cohort as `[newest solved time − 10 min, newest solved time]`.

**Source.** Project memory, GEX model upgrade.

---

## F. Architecture and boundaries

### L051. Isolate a vendor that demands single-process ownership in its own service.

**Mechanism.** When a vendor requires one process to own authentication and one live session, no distributed lock fixes it — remove the second writer entirely. Make every other service a thin HTTP client. Where the vendor also allows only one streaming session, token ownership and session ownership must be the same process by construction.

**Cost.** Two independent refreshers against one rotating-grant token produced `invalid_grant` within a single 30-minute cycle, because each refresh invalidated the other's cached token. See V002.

**Source.** `docs/architecture/stack-decisions.md` D16, D22; `.planning/RETROSPECTIVE.md`.

### L052. Advise and execute are separated in code, not in policy.

**Mechanism.** A system that can compute a verdict must be structurally unable to act on it. No port resembling an order-placing port exists. Verdicts are hysteresis-banded to stop flip-flopping near a threshold, and gated to indicative-only during after-hours and gap conditions.

**Cost.** Nothing, because it was built this way. Carried as a checked regression gate at every phase, not a policy line in a doc: the advisor and the backtest never place or modify an order. The backtest is separately stamped never-writes-weights — its only write path is one append-only row per run.

**Source.** `.planning/REQUIREMENTS.md` EXIT-10; `.planning/STATE.md`; `docs/architecture/backtest-harness.md`.

### L053. A live tick may change what the UI displays. It must never change what a gate decides.

**Mechanism.** A fast noisy stream and a slow stable computed layer must not merge. Letting a live tick flip a gate or band introduces flapping from feed noise and makes verdicts non-reproducible from stored data. Display the live value with an honest live/stale badge; keep every gate, band and hysteresis calculation reading the stored, already-validated source. On a quiet or stalled stream, display reverts to the stored value rather than freezing a stale live number.

**Cost.** Nothing, because the law was written before the feature. Enforced by a repo-wide grep: the live-facing constants appear only inside the two owning display components, never in a gate, hook, server or core file. The same separation applies to pricing inputs, not only to gates. Server-side tick IVs are solved under the server's own rate, dividend, spot and T — parameters the browser cannot reproduce — so feeding ticks into the client's own curve breaks the identity even when every leg is ticked: live breakevens read [7375, 7642] against the all-REST engine's [7466, 7571]. Calibrate the client curve from broker REST data only and let ticks drive per-leg display greeks and badges (commit f8421f7, with tests proving a tick never changes curve output).

**Source.** `docs/architecture/stack-decisions.md` D27; `.planning/REQUIREMENTS.md` LIVE-05; ROADMAP Phase 38; Phase 39 GATE-BLIND grep law; Phase 41 AUI-07 verification.

### L054. A backtest replays the live functions untouched. It never forks the logic.

**Mechanism.** Structure the live decision logic as pure functions with zero I/O, wrapped by a thin use-case that does the reads and writes. The harness then loads history and calls the same pure functions per cohort. If it needs a helper the engine does not expose, the *engine* exports it — the harness never copies. A forked copy drifts, and once it does, the backtest validates a strategy that is not the one running.

**Cost.** Nothing, because the picker engine was already shaped this way, so the backtest CLI swapped the I/O source from latest cohort to every historical cohort with zero rule duplication.

**Source.** `docs/architecture/backtest-harness.md`; `.planning/research/ARCHITECTURE.md`.

### L055. A settings knob can validate, persist, and echo back "effective" while nothing reads it.

**Mechanism.** Round-trip tests exercise the resolve and merge layers, not the consuming call site. The only way to catch a dead knob is tracing the value from the write boundary to its literal use in the scoring call graph.

**Cost.** `picker.deltaBandMin` passed the Zod contract, resolved into the effective config, and displayed to the user as active — while `computePickerSnapshot` only ever read `.max`, and the band-edge interpolation used hardcoded module constants rather than the config object at all. An operator setting it got a 200 OK and zero effect on live trading candidates. The grep that found it returned only `.max` matches (CR-01, Phase 29, fixed 203e2e4 with an end-to-end test asserting the override narrows the emitted candidate set). Same class as L076: a computed value that never reaches its consuming field.

**Source.** Phase 29 review.

### L056. Cross-field ordering invariants do not generalize across field groups.

**Mechanism.** A schema can enforce a sum-to-100 refine and hysteresis-pair refines meticulously while an adjacent field group is checked only for type. The consequence is silent semantic corruption, not a validation error: an inverted tier boundary makes that tier's range unreachable by any real value, and a band function testing `value >= crisis` before `value >= warn` misclassifies the whole `[crisis, warn)` range if `warn > crisis` is ever accepted. Fixtures that only construct ascending thresholds never exercise it.

**Cost.** A VIX ladder's `normalMin`/`elevatedMin`/`crisisMin` and four warn/crisis pairs validated for type only, sitting in the same file as meticulous refines on other fields (CR-02, Phase 29, fixed 27c337e).

**Source.** Phase 29 review.

### L057. A new caller with client input moves an invariant guard's trust boundary.

**Mechanism.** `assertDefined` guards an engine invariant and throws on failure. That is safe while every caller feeds engine-produced data. A new caller passing a client-supplied string turns a safe invariant into an unhandled crash that bypasses the app's own `Result`-typed error contract. The fix belongs at the new trust boundary — a format check on the request schema — not inside the reused helper.

**Cost.** An ad-hoc pasted-calendar analyzer validated expiry dates as bare `z.string()` with no format check, reaching `isoDayNumber`'s `assertDefined` transitively. Neither the HTTP route nor the MCP tool wrapped the call, so a malformed date surfaced as an unhandled exception. No test exercised it. The same request also trusted client-supplied DTE verbatim with no cross-check against the expiry dates, unlike every other candidate (CR-01/WR-02, Phase 30).

**Source.** Phase 30 review.

### L058. Zod `.parse()` silently strips unknown keys.

**Mechanism.** Without `.passthrough()`, a key not declared in the schema is dropped with no error. Convenient for additive-only migrations — a new domain field costs nothing at an existing boundary. A trap when you rely on an extra field surviving.

**Cost.** Nothing, deliberately: a new required domain field was added without touching the wire schema, and the unmodified route and tool tests stayed green because the field was silently dropped from the response. That was the intended behavior, verified by reasoning about the schema before relying on it.

**Source.** `.planning/debug/journal-pnl-opennetdebit-units.md`.

### L059. A hand-mirrored contract needs one type-annotated adapter to restore the compile-time link.

**Mechanism.** Where a contracts package cannot import the core layer, the Zod schema and the core return type are two independently maintained shapes with no structural connection. A single adapter function annotated with the contract's response type restores it: if the core type drops or renames a field, `tsc` fails at that one line instead of the drift surviving to a runtime parse failure on the first live request. Prove the guard has teeth by injecting a wrong field and confirming the build fails there.

**Cost.** Verified by injection: `bun run typecheck` failed with TS2741 at the annotated line. Four other core-type/contract pairs in the same repo carry no such annotation — for those, adding a field is a four-file edit guarded only by a runtime parse.

**Source.** `docs/calendar-engine/spec.mdx`; `docs/calendar-engine/current-state.md`.

### L060. One math kernel, one T function, one carry source. Three implementations will drift.

**Mechanism.** When a browser client and a server engine both price the same structure, two implementations diverge in unit convention, time convention, and null handling — and the user sees two different numbers for the same quantity on the same screen. Promote the pure math into one shared module, keep exactly one time-convention function that callers pass a settlement flag into, and make every cohort function take its scoping context as a required parameter so it cannot be called out of context.

**Cost.** Roughly 20 quantities were computed 2-4 times across a browser chain-math module, the server picker engine, and an ad-hoc analyzer — including net greeks computed with ×100 dollar scaling in one engine and no scaling in another, displayed side by side. A verbatim ~20-line block existed in two files, one citing the wrong line range for the original in its own comment. Nine different T conventions coexisted in one codebase, three inside a single GEX path. See D014 for what mixing T conventions costs numerically.

**Source.** `docs/calendar-engine/current-state.md`.

### L061. A widened read context needs a symmetrically widened reset context.

**Mechanism.** If a per-entity rebuild expands its read query to include context rows owned by a sibling entity, its "mark unprocessed" step must expand by the same rule. Otherwise entity A's rebuild marks a shared context row processed, and entity B's rebuild resets only rows matching B's own keys — the context row vanishes from every future read.

**Cost.** Reproduced red: with the real processing order, the first calendar's own front-leg fills silently disappeared during the second calendar's rebuild, leaving 2 orphans. Green after mirroring the expansion in the reset.

**Source.** `.planning/debug/journal-pnl-opennetdebit-units.md`.

### L062. A joined row-per-key display is an implicit inner join. Unmatched rows vanish with no marker.

**Mechanism.** Pairing two series into one row per key silently drops anything present on one side only — no dash, no null marker, plain absence. A hidden filter is the worst possible default on a screen whose premise is that the reader does the judging. Split it: an unfiltered per-cohort listing, plus a separate view that computes derived math only for legs the user explicitly picked. That moves the join from a silent default into a deliberate action.

**Cost.** The first shipped chain browser did exactly this: a strike quoted in one expiry but not the other got no row at all.

**Source.** `docs/architecture/stack-decisions.md` D29.

### L063. Function-type ports made TDD fast. That is where hexagonal earned its keep — not swaps.

**Mechanism.** Defining every port as a plain function type rather than an interface makes a test double a one-line function with no mocking framework. Every driven port also got a maintained in-memory adapter, so unit, use-case and acceptance tests all ran fast with real business logic wired in.

**Cost.** The promised swap flexibility — stated as the architecture's primary driver — was barely exercised. The database host moved as a connection-string change. The queue adapter and the broker adapter were never replaced. Their swap-cost estimates stayed theoretical for the life of the project.

**Source.** `docs/architecture/hexagonal-ddd.md`; `docs/architecture/monorepo-layout.md`; `docs/architecture/stack-decisions.md`.

### L064. A strict import law needs one narrow, mechanically-enforced carve-out — not zero, and not many.

**Mechanism.** Duplicated string literals across two packages drift silently. A narrowly-scoped import does not. The carve-out must be restricted to plain value and enum modules — never ports, use-cases, or any type carrying business logic — and enforced by the same lint rule scoped to exactly that one edge, not by an honor-system comment.

**Cost.** The counter-example is the price of refusing a carve-out: satisfying "the web never imports core" for roughly 30 lines of shared BSM math required a whole new zero-dependency workspace package, plus new project references and a new lint boundary element. The payoff — the same kernel behind the server's stored P&L and the browser's live preview — is real, but a scoped exception would have bought the same guarantee for less.

**Source.** `docs/architecture/monorepo-layout.md` RULE-01; `docs/architecture/stack-decisions.md` D21.

### L065. A positional wire format stays compatible if fields are only ever appended.

**Mechanism.** Append new fields at the end, never insert in the middle — an insert silently shifts the meaning of every later field. Omit an absent optional field entirely rather than emitting an empty segment; a trailing delimiter parses as one unparseable field instead of clean absence. Consumers parse by minimum required length, so an old reader ignores a new trailing field and a new reader still parses an old blob.

**Cost.** Nothing. A per-strike profile field was appended to a five-field GEX blob and blobs written before it existed still parse, because the parser only requires the first three fields.

**Source.** `tools/tradingview/push-gex.ts`; `tools/tradingview/gamma-levels.pine`.

### L066. A breakpoint-driven tree swap unmounts local state and reconnects streams.

**Mechanism.** One boolean at the root of a screen conditionally rendering two entirely separate trees means crossing that breakpoint discards every local UI state — filters, selected row, picked date, expanded card — and re-opens any stream the unmounted tree owned. Safe only if server-fetched data survives in the query cache, and if a single-consumer invariant on the stream holds through unmount-before-mount ordering. Verify both; do not assume.

**Cost.** Accepted as a documented trade-off after confirming React flushes the removed tree's cleanup before the new tree's mount effects, so exactly one EventSource exists at any instant, and after a UAT check proved repeated resizing across the boundary does not crash.

**Source.** Phase 35.1 review and UAT.

### L067. A dedicated mobile tree makes states reachable that the desktop structure made impossible.

**Mechanism.** A design decision made for one surface alone can open a path the other surface's structure prevented. Any downstream fallback that was only safe because the path was unreachable — `spot ?? 0`, `source ?? "schwab"` — then renders plausible garbage with no error and no unavailability cue. Re-audit every fallback for a newly reachable state. Gate the render on the real optional value, never on "a row is selected".

**Cost.** A mobile analyzer rendered its paste block unconditionally, letting a user analyze during cold start with no snapshot at all: `spot` fell back to 0, fed the IV bisection, produced a degenerate `0 → strike` payoff domain, and the caption fabricated a data-provenance label. Same class recurred with a net-greeks grid priced at a `spot = 5800` fallback with no cold-start cue.

**Source.** Phase 36 review (catch #26 class); Phase 35.1 review.

### L068. The journal is the anchor. One user, by design.

**Mechanism.** One feature must always work: a fully automated, never hand-edited per-calendar journal answering how price and greeks moved over the life of a trade. Everything else — picker, exit advisor, backtest, macro board — is secondary and serves it. Separately, the system serves exactly one trader, so bearer token plus JWT is sufficient and multi-tenancy, RLS-as-authz and API versioning were excluded rather than speculatively built.

**Cost.** Nothing. Stated up front and held.

**Source.** `.planning/PROJECT.md`.

### L069. A two-step wipe-then-reingest is not atomic across the step boundary.

**Mechanism.** Correcting bad derived rows means deleting then re-running ingest (see L005). If the wipe succeeds and the reingest fails or is interrupted — an auth expiry, a crash — the system holds empty derived tables, not old-but-wrong data. Name that risk before running it.

**Cost.** Documented as a non-blocking risk on the fills wipe: the journal would show no trade history for the wiped window until a successful retry.

**Source.** `.planning/debug/journal-pnl-opennetdebit-units.md`.

### L070. Resolve an ambiguous foreign key from co-occurring data in the same real-world event. Never guess, and never orphan unconditionally.

**Mechanism.** When a lookup key matches more than one parent, use another field from the same transaction to find an unambiguous anchor. If exactly one candidate has a second unique match inside that event, it is the answer. If no unique anchor exists, still refuse.

**Cost.** Two calendars shared one front-leg contract symbol, opened at different times. Orphan-parking every ambiguous fill produced a back-leg-only debit: 62.50 instead of the correct 10.20. Fixed by grouping candidate fills by order id and anchoring the whole order on the leg that matched exactly one calendar. All 13 real calendars then matched the ground-truth oracle within $0.02. The tie-break is on the intersection, not on the candidate count. Gating on "exactly one candidate calendar" orphans the shared leg of every roll order, because a roll legitimately anchors two calendars at once and therefore always looks ambiguous. Test whether the candidate set intersected with the order's anchors is a singleton (commit ddfe112).

**Source.** `.planning/debug/journal-pnl-opennetdebit-units.md`; `.planning/debug/journal-pnl-ground-truth.md`.

### L071. Fill classification: four rules, learned in five rounds.

**Mechanism.** Classify a fill from `positionEffect` alone, never from `side`. Derive a partial-fill aggregate's `positionEffect` from the first fill, never from the parent's current status column (L022). Disambiguate shared-leg fills by order-anchor intersection (L070). Decide whether a calendar is fully closed by netting quantity per leg, never by trusting a status column. A roll is detected as same calendar, same order, same root, same strike, same type, different expiry.

**Cost.** These four rules are the residue of the five-round bug chain that produced the −$319,850 display in L021. The algorithms are worth porting verbatim; the ledger they protect is the money path. A fifth rule belongs with these four. Anchor a calendar's `openedAt` to its **front-leg** fills only. A back leg can survive a roll and carry the previous calendar's open date: a new 7400 calendar inherited a 2026-07-02 `openedAt` from the closed 4 Aug / 31 Aug calendar it shared a 31 Aug 7400P back leg with.

**Source.** `packages/core/src/journal/domain/fill-pairing.ts`; `apps/worker/src/journal-oracle.test.ts`.

### L098. A contract with no as-of field is not frozen. Every consumer will invent one.

**Mechanism.** Declaring a data contract frozen promises the producer can be swapped with no consumer change. A contract carrying values but no reference date does not keep that promise: the first consumer that needs to place those values in time hardcodes a literal date, and the swap now breaks a chart. Time-anchoring fields are part of freezing a contract, not an addition to it.

**Cost.** A frozen term-structure contract shipped without `asOf`, so the chart consuming it hardcoded `2026-07-02`. That silently voided the following phase's import-only-swap plan.

**Source.** Project memory, Phase 18.

### L099. A platform healthcheck is an unauthenticated caller.

**Mechanism.** Wrapping every read route in one auth group is the right default, and it captures the healthcheck path along with them. The platform's probe then gets a 401 and rejects the deploy, while the application is fine and every local test passes. Mount the healthcheck publicly and register it *before* the auth group, so the router resolves the public handler first.

**Cost.** A phase that moved all read routes behind JWT auth moved `/api/status` — the configured `healthcheckPath` — behind it too, and every deploy was rejected until the route was lifted back out.

**Source.** Project memory, Phase 8-9 deploy.

### L101. Build on someone else's surface only what your own surface cannot do.

**Mechanism.** A panel that displays numbers your own system already computed, pushed onto a third-party chart, is a screenshot with extra failure modes. It ages between pushes, it duplicates a view you maintain better, and it inherits every trap of the host platform. The test is structural: does plotting this against the host's live price axis do something your own system cannot? If not, do not build it there.

**Cost.** A pushed TradingView board was written, shipped and then deleted as "a text table on a chart" mirroring stale numbers. What replaced it reads data TradingView already carries and computes on-platform with no dependency on us at all. The one thing still pushed in — gamma levels — is pushed because drawing them against a live price axis is precisely what our own charts cannot do.

**Source.** Project memory, TradingView studies rebuild; `tools/tradingview/README.md`.

---

## G. UI correctness

### L072. A safety-critical indicator must render outside every sibling's early-return branch.

**Mechanism.** An alarm emitted only inside another component's success-path render is hidden whenever that component is loading, erroring, or empty — including the worst case, where one root cause triggers both the alarm condition and the sibling's empty state, so the alarm disappears exactly when it fires. Lift it above the early returns, or render it in its own always-evaluated block.

**Cost.** The only surface rendering the market entry gate, including a loud `GATE BLIND` alarm, sat inside a regime board's success branch after its pending/error/empty returns — despite the component's own doc comment claiming independence. An empty `macro_observations` table would have triggered both (WR-02, Phase 28, fixed 818227d).

**Source.** Phase 28 review.

### L073. A gate boolean correct for one feature breaks when copy-pasted for another.

**Mechanism.** `selectedRowKey === r.key && verdict !== null` is correct for gating a verdict-detail row, which has nothing to show without a verdict. Reusing it to gate an unrelated feature silently disables that feature for every row without a verdict. Review the precondition each gated feature actually needs, not whether the code compiles or matches a spec — the spec's own reference implementation is as likely a source of this bug as the executor's code.

**Cost.** Tap-to-expand greeks on a mobile position card was permanently dead for any position with no linked exit verdict. Traced to the UI spec's own reference implementation. No test exercised the tap path end to end (CR-01, Phase 35).

**Source.** Phase 35 review.

### L074. Swap a CSS value to a newer unit by stacking both, never by replacing.

**Mechanism.** A browser drops an entire declaration containing a value it does not recognize. There is no partial fallback within one declaration. A 1:1 substitution therefore loses the property completely on an unsupporting browser rather than keeping the old behavior. Keep both declarations in source order: the later wins where supported, the earlier survives where it is not.

**Cost.** `<main>` lost its `min-height` entirely after a straight `100vh` → `100dvh` class substitution (WR-02, Phase 35, fixed 4d3f89b).

**Source.** Phase 35 review.

### L075. A closed `<details>` cannot be revealed by CSS.

**Mechanism.** The browser hides closed-details content in an internal rendering slot that child-targeting rules cannot reach. `display: block !important` on the children does nothing. Control the real `open` attribute from a `matchMedia` listener instead.

**Cost.** A `lg:[&>div]:!block` trick could not open a rail at desktop width, so the entire left column rendered empty at ≥1024px. Invisible to jsdom class assertions — the structurally blind failure mode the phase's own validation architecture had predicted (catch #24, fixed bda2254).

**Source.** Phase 35 UAT.

### L076. Adjacent inline elements with no whitespace have no wrap opportunity.

**Mechanism.** A run of short inline chips rendered as directly adjacent siblings, with no whitespace text nodes and no flex gap, has no soft-wrap break point. The browser treats the whole run as one unbreakable sequence. Invisible in a short-content fixture; it appears only with real chip-heavy data. Fix with `flex flex-wrap` or an explicit gap so every chip boundary is a legal break.

**Cost.** A pasted candidate card with 9 event badges blew a 390px viewport out to 533px. The same latent bug had sat unnoticed on a 300px desktop rail (catch #27, fixed 31340a6).

**Source.** Phase 36 UAT.

### L077. A form that submits its whole state cannot detect change by key presence.

**Mechanism.** `key in submittedForm` is true for every field on every submission if the form POSTs its full state rather than a sparse patch. Compare against the known baseline value instead.

**Cost.** A preview's honest change-note fired on presence and suppressed every real staged-change delta (Phase 32 UAT, fixed 0d8c153).

**Source.** Phase 32 UAT.

### L078. A deleted utility class fails silently. Only a lint rule catches it.

**Mechanism.** The CSS framework emits nothing for an unknown class name — no build error, no console warning. On a dark theme that means invisible black-on-black text. Code review and the type checker are both blind to it: it is invisible in the source diff and invisible in the rendered output until someone looks at that exact element.

**Cost.** Pre-token utility names were deleted after a 708-call-site token migration. A build-time lint script scanning for the deleted pattern is what stops one reappearing.

**Source.** `docs/architecture/design-system.md`.

### L079. Reserve color for what is abnormal.

**Mechanism.** Color is preattentive — processed instantly, without conscious effort. Using the same color for every value means color carries no information. A panel where everything shares one size, weight and color has no way to draw the eye anywhere. Keep values quiet by default and spend a distinct color only on what needs attention now.

**Cost.** Applied after a UI rework had been rejected twice.

**Source.** `.planning/notes/market-rail-ux.md`, citing NN/g visual-hierarchy and dashboard research.

### L080. A real charting library kills the overflow bug class structurally.

**Mechanism.** Hand-rolled SVG charts relying on manual clamps re-manifest the same failure family — content bleeding outside the plot area, marker pile-up, fixed-domain clipping — and each occurrence gets its own one-off clamp. A library that owns clipping, responsive sizing and tooltips enforces bounds by construction, so the class ends instead of recurring. A recurring bug class that keeps needing hand-clamps is a signal the abstraction level is wrong, not that the next patch is the last one.

**Cost.** This reversed a locked architecture decision (visx/uPlot/ECharts only) after repeated evidence. Named instances: an expected-move band bleeding off the page (commit 2563bd6) and marker label pile-up in Phase 31. See [V040-V044](vendors-and-infra.md#recharts) for the traps the replacement library brought with it.

**Source.** `docs/architecture/stack-decisions.md` D3.

### L081. React 19 forwards a ref through a plain function component's props spread.

**Mechanism.** Under the ref-as-prop model, `function Button(props) { return <button {...props} /> }` forwards a caller-supplied ref onto the real DOM node with no `React.forwardRef`, as long as the component does not strip it from the spread. A library's render-prop clone-merge pattern reaches the node correctly.

**Cost.** Confirmed two ways rather than assumed: by tracing the UI library's own `useRenderElement` clone call, and empirically by an existing render-merge usage producing zero ref warnings across 35 passing tests.

**Source.** Phase 42 summary; `.planning/STATE.md` Phase 42-04.

### L082. Setting `.value` on a React-controlled input is silently ignored.

**Mechanism.** React tracks its own value through synthetic event handlers. A raw DOM `.value` assignment is invisible to it and gets overwritten. Any browser-automation script targeting a controlled input must dispatch real input events, or use the framework's native value setter followed by an `input` event.

**Cost.** Injecting source into an editor by assigning `.value` failed and wiped the buffer.

**Source.** `.remember` 2026-08-05.

### L086. Responsive reflow is not mobile design. No mechanical check can tell them apart.

**Mechanism.** Building a mobile pass under the constraint "reuse the desktop DOM, adapt with responsive classes" caps the outcome at desktop panels reflowed. That is technically correct against every mechanically-checkable claim — no horizontal scroll, tap targets at least 44px, elements present and visible — and is not a page designed for mobile. Automated checks cannot detect the gap, because the gap is not in anything they measure.

**Cost.** All three agent-driven checks passed, at 390px and against a desktop tripwire. The first live phone check failed verbatim: "still look ass, if you have to design components for mobile only then do that." The real fix was a from-scratch, dedicated mobile-only component tree, which then passed. Budget for that tree up front rather than iterating on the reflow.

**Related.** The dedicated tree brings its own costs — see [L066](#l066-a-breakpoint-driven-tree-swap-unmounts-local-state-and-reconnects-streams) and [L067](#l067-a-dedicated-mobile-tree-makes-states-reachable-that-the-desktop-structure-made-impossible).

**Source.** Phase 35 UAT; Phase 35.1 UAT.

### L089. No verdict coloring on an indicator without a documented source first.

**Mechanism.** Threshold banding — calm, warning, crisis — is a claim that the threshold means something. An indicator whose threshold has no research backing renders as a neutral, position-only track: no color, no bands, even though a colored treatment looks more informative. Color earns its place by citation, not by availability.

**Cost.** Nothing, because it was a gate rather than a repair. Every indicator on the regime board was admitted only after a documented source and rationale was recorded; rate indicators shipped with no band segments and no verdict colors on exactly this rule. No indicator ships without a citation.

**Distinct from** [L079](#l079-reserve-color-for-what-is-abnormal), which governs where color goes once you have earned the right to use it.

**Source.** `.planning/REQUIREMENTS.md` GAUGE-02; ROADMAP Phase 24.

### L094. Series on different scales get their own signed panels, never one overlay.

**Mechanism.** Overlaying delta, gamma, theta and vega on one axis flattens every series but the largest into a straight line. Split them into small multiples, one per series, each keeping its own sign — the reader then compares shapes across panels instead of magnitudes inside one. Horizon graphs compress the same information into less vertical space without discarding sign.

**Cost.** Nothing. Adopted as the layout rule for the journal lifecycle graph before it was built, on Javed and Elmqvist (IEEE InfoVis 2010) for the split and Heer, Kong and Agrawala (CHI 2009) for the compression.

**Source.** Project memory, journal lifecycle graph.

---

## H. Security

### L083. Authenticate an SSE stream with a short-lived opaque ticket, never a JWT in the query string.

**Mechanism.** Query parameters leak into access logs and intermediary proxies. Mint a single-use, short-lived opaque ticket server-side and have the client exchange it for the stream.

**Cost.** Nothing. Decided before shipping (Phase 12 D-01).

**Source.** `.planning/RETROSPECTIVE.md`; `.planning/PROJECT.md`.

### L084. OAuth CSRF state is a single-use nonce, consumed by one atomic DELETE … RETURNING.

**Mechanism.** A bare string comparison can be replayed. A TTL'd server-side nonce row validated *and* consumed in one statement cannot succeed twice, even under a race between concurrent exchange requests.

**Cost.** Nothing. Built this way (migration 0024, `reauth_nonces`, 10-minute TTL).

**Source.** `.planning/REQUIREMENTS.md` REAUTH-02.

### L085. An OAuth code and its redirect URL never render or log anywhere.

**Mechanism.** During their short validity window they are bearer-equivalent secrets. That includes the client console, server logs, and error messages. Error responses on a privileged reauth endpoint stay generic and never echo the code, state or redirect URL back to the caller. The Schwab OAuth client likewise never logs Basic-auth headers or token values.

**Cost.** Nothing. Held as a requirement from the start.

**Source.** `.planning/REQUIREMENTS.md` REAUTH-05, REAUTH-06; `.planning/STATE.md` Phase 37; `packages/adapters` Schwab OAuth client.

**Related.** Verifying the live issuer's actual JWT algorithm is [R005](refuted.md#r005-hs256-is-what-the-auth-provider-issues) — that belief was held, shipped, and disproved.

---

## Cross-references out of this file

| Topic | Lives in |
|---|---|
| Options, vol, calendar-spread math and measured market facts | [domain-trading.md](domain-trading.md) |
| Schwab, CBOE, FRED, CFTC, Alpaca, TradingView, Recharts, Tailwind, Supabase, pg-boss, Bun, Vitest, Railway, Vercel, harness | [vendors-and-infra.md](vendors-and-infra.md) |
| Green suites, oracles, review catches, TDD, audit discipline | [process-and-verification.md](process-and-verification.md) |
| Beliefs that were held, acted on, and disproved | [refuted.md](refuted.md) |
