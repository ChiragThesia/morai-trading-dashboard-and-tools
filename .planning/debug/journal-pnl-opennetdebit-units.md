---
slug: journal-pnl-opennetdebit-units
status: resolved
trigger: "Journal P&L shows −$319,850 for calendar 65aac62e (7425P) when real P&L ≈ +$415 — openNetDebit stored in dollars, snapshot formula expects points"
created: 2026-07-05
updated: 2026-07-05T00:10:00-07:00
tdd_mode: true
goal: find_and_fix
bug_2_trigger: "validate-on-one FAILED after deploy: rebuild-journal on 65aac62e changed open_net_debit 3235 -> 286.47, still wrong (correct: 32.35) — a SECOND, deeper root cause in the same area"
---

# Debug Session: journal-pnl-opennetdebit-units

## Symptoms

**Expected:** Journal P&L for calendar 65aac62e (SPXW 7425P, Aug 7 / Aug 31, opened Jun 22)
should read ≈ **+$415** (a small winner): current net value 36.5 pts × $100 − entry debit
$3235 = +$415.

**Actual:** Prod Journal (morai.wtf) shows Net P&L **−$319,850** on the P&L-bridge/masthead.
The attribution buckets (theta/vega/Δ-Γ ≈ $0) don't reconcile with the huge negative Net.

**Error:** No exception — silently wrong number. `pnlOpen` stored per-snapshot is wrong.

**Timeline:** Present since the calendars were backfilled (backfill-transactions). Surfaced
at Phase-22 Journal UAT (2026-07-05).

**Reproduction:** morai.wtf → Journal → select 7425P (or any backfilled calendar) → the
P&L-bridge "Net" and masthead "NET P&L" show ~−$3XX,XXX. Or `GET /api/journal/:id/lifecycle`
→ last snapshot `pnlOpen:"-319850"`.

## Diagnosis-so-far (orchestrator pre-investigation — treat as strong leads, verify)

**Root cause (high confidence):** unit mismatch on `openNetDebit`.

The snapshot P&L formula at `packages/core/src/journal/application/snapshotCalendars.ts:88`:
```
const pnlOpen = String((netMark - cal.openNetDebit) * cal.qty * 100);
```
expects BOTH `netMark` and `openNetDebit` in option **points** (the ×100 is SPX's $100/point).
- `netMark` = backMark − frontMark = 129.1 − 92.6 = **36.5 points** ✅ correct
- `openNetDebit` should be **32.35 points** but is stored as **3235** (the DOLLAR debit, $3235)
→ `(36.5 − 3235) × 1 × 100 = −319,850`. With correct 32.35 → `(36.5 − 32.35) × 100 = +415`.

**Evidence the canonical unit is POINTS (not dollars):**
- `get_transactions` order 1006855414174 (Jun 22, the 7425P open): leg prices are **points**
  (back SPXW 260831P07425000 @ **159.41**, front SPXW 260807P07425000 @ **127.06** → net
  **32.35 pts**). The order's DOLLAR `netAmount` (−15942.22 / +12704.78 → −$3237) is what
  matches the stored `openNetDebit` 3235.
- `syncFills.ts` derives event `netAmount` from `avgPrice * sumQty` (points) — lines ~336-405.
- `recomputeCalendarAmounts` contract test (`packages/adapters/src/__contract__/fills.contract.ts`)
  asserts `openNetDebit ≈ 20.5` from `+15.5` and `+5.0` events → **point-scale**.
- Greeks use the same `(back − front) * qty * 100` pattern → net_mark/greeks are points→dollars.

**So:** the backfilled calendars carry a 100× dollar-scale `openNetDebit`, and the point-scale
`recomputeCalendarAmounts` apparently never ran on them (they were seeded directly by backfill).
Affects **ALL backfilled calendars' P&L**, not just this one.

## Open questions for the debugger (verify, don't assume)

1. **Exact source of the dollar-scale openNetDebit** — is it (a) the `backfill-transactions`
   CLI / register path writing the order's dollar `netAmount` directly into `openNetDebit`, or
   (b) the fills themselves stored at dollar scale (→ `recomputeCalendarAmounts` would reproduce
   the error)? This determines whether `rebuild-journal` (which runs recompute) actually corrects
   `openNetDebit` or reproduces the bug. Find the backfill-transactions writer + registerCalendar
   + recomputeCalendarAmounts SQL and trace what unit each writes.
2. **Does rebuild-journal fix it?** If (a): rebuild → recompute produces 32.35, fixes going
   forward. If (b): rebuild reproduces 3235. Confirm against the actual fills scale in prod.
3. **Historical per-snapshot pnlOpen** is frozen (snapshots aren't recomputed by rebuild).
   Fixing requires re-running the pnl formula over stored snapshot rows (`net_mark` is already
   stored — no online fetch). Design a tested recompute/migration path.

## Constraints

- **Money path → TDD mandatory** (`.claude/rules/tdd.md`): failing regression test FIRST, then fix.
- **No `any`/`as`/`!`; Result<T,E>; parse-don't-cast** (`.claude/rules/typescript.md`).
- **Hexagonal boundaries** (`.claude/rules/architecture-boundaries.md`): core imports shared only;
  migrations/adapters at the edge; in-memory twin updated in same PR.
- **Prod financial data — no hand-edits.** Any correction to existing prod rows must be a tested,
  repeatable migration/recompute, not a manual UPDATE.
- **Do NOT conflate with the separate gap-snapshot problem** (spot=0/NaN rows Jun 23-26 + the
  Jun 27-30 worker-down hole). Flag it, keep it out of scope for this unit-bug fix. See the
  [[morai-journal-snapshot-data-gaps]] memory.

## Current Focus

```yaml
reasoning_checkpoint:
  hypothesis: >
    openNetDebit is stored in DOLLARS instead of POINTS for backfilled calendars because
    registerCalendar (POST /api/calendars) accepts a raw, unvalidated, unit-undocumented
    operator-supplied number and persists it verbatim — nothing ever converts or checks it.
    backfill-transactions.ts NEVER touches calendars.open_net_debit (it only writes `fills`).
    The ONLY code path that overwrites open_net_debit after registration is
    recomputeCalendarAmounts (postgres/repos/fills.ts), invoked solely by rebuild-journal's
    step 5, deriving strictly from calendar_events.netAmount — which syncFills.ts computes as
    avgPrice*sumQty (points, no x100). So unless rebuild-journal has run for a calendar since
    it was registered, whatever value was typed in at registration time stands unchanged.
  confirming_evidence:
    - "registerCalendar.ts -> calendar.routes.ts -> postgres/repos/calendars.ts: openNetDebit flows straight from request body to `openNetDebit: String(input.openNetDebit)` with zero validation/conversion. packages/contracts/src/calendar.ts's Zod schema has no unit annotation (openNetDebit: z.number())."
    - "backfill-transactions.ts read in full: only calls makeSyncTransactionsUseCase -> writeFills. No call to registerCalendar, no call to recomputeCalendarAmounts. No MCP tool or script auto-registers calendars from Schwab order data either (grepped apps/server + apps/worker for register_calendar — HTTP route is the only registration entry point)."
    - "syncFills.ts lines ~403-405: netAmount = isClose ? -(avgPrice*sumQty) : avgPrice*sumQty — POINTS scale (avgPrice is per-contract option price, sumQty is contract count, no x100 multiplier anywhere in this path)."
    - "postgres/repos/fills.ts recomputeCalendarAmounts: sums calendar_events.netAmount by eventType, writes openNetDebit=String(openDebit) — confirmed points-scale by the EXISTING fills.contract.ts assertion (openNetDebit ~= 20.5 from +15.5/+5.0 point-scale test events, unchanged by me)."
    - "snapshotCalendars.ts buildSnapshotRow: pnlOpen = (netMark - cal.openNetDebit) * cal.qty * 100 — confirmed unchanged/correct; netMark is always points (backMark-frontMark from leg marks). This is the formula the debug file's arithmetic already matches exactly: (36.5-3235)*1*100 = -319850."
    - "rebuildJournal.ts docstring (own comment, not mine): 'This does NOT re-derive the 30-min greeks in calendar_snapshots' — confirms rebuild-journal, even when it fixes calendars.open_net_debit, never touches historical calendar_snapshots.pnl_open rows. getCalendarLifecycle.ts (the exact endpoint in the repro steps) spreads `...row` from the stored SnapshotRow with no recomputation — pnlOpen reaches the API verbatim from the DB."
  falsification_test: >
    If calendar_events rows for 65aac62e already exist with net_amount at DOLLAR scale
    (~3235 rather than ~32.35), that would disprove the "registration-time-only" theory and
    implicate the fills/events pipeline itself (meaning rebuild-journal would REPRODUCE the
    bug, not fix it). I attempted to check this directly (querying calendar_events / fills
    for 65aac62e in the prod DB via a read-only script) — the sandbox's auto-mode classifier
    DENIED this as a "Production Reads" action requiring explicit user approval naming the
    prod target. This is the one piece of direct evidence I could not obtain; see blind_spots.
  fix_rationale: >
    Two independent problems, two independent fixes: (1) calendars.open_net_debit itself
    must be corrected for affected calendars — the EXISTING rebuild-journal job already does
    this correctly (verified via its own untouched contract/unit tests) PROVIDED the
    calendar's fills exist and pair successfully into calendar_events. (2) Even after (1),
    the FROZEN historical calendar_snapshots.pnl_open rows do NOT retroactively update
    (rebuild-journal by design never touches calendar_snapshots) — so a NEW, fully-TDD'd
    capability (recompute-snapshot-pnl: core use-case + port + memory twin + postgres
    adapter + testcontainers contract tests + worker handler + trigger_job/HTTP wiring +
    calendar-scoped dedupe key) re-derives every historical row's pnl_open from its
    already-stored net_mark and the calendar's corrected openNetDebit/qty, sharing the EXACT
    D-05 formula (computeSnapshotPnl, extracted from snapshotCalendars.ts) the live snapshot
    writer uses — no formula drift, no online fetch, no hand-edited SQL.
  blind_spots:
    - "Could not directly confirm, for calendar 65aac62e specifically, whether its calendar_events already exist with correct point-scale netAmount (rebuild-journal fixes it cleanly) OR whether its fills were never successfully paired at all (e.g. parked as orphans on a leg/OCC-symbol mismatch — in which case rebuild-journal's recompute would produce openNetDebit=0 from zero events, NOT 32.35). Prod DB read access was blocked by the sandbox's auto-mode classifier."
    - "Did not enumerate/verify whether OTHER backfilled calendars beyond 65aac62e are similarly affected — the orchestrator's note that this 'affects ALL backfilled calendars' P&L' is a carried-forward hypothesis, not independently re-verified by me against prod data."
    - "recompute-snapshot-pnl's postgres adapter does N sequential per-row UPDATEs (not one bulk SQL UPDATE) — correct and fully tested, fine for a one-time on-demand correction on a handful of calendars, but would be slow on a calendar with a very large snapshot history."
```

- next_action (BUG #1, superseded by BUG #2 below): RESOLVED (code) — orchestrator chose PROCEED/validate-on-one; this triggered BUG #2 (see below). Do NOT deploy or trigger prod jobs from this session.

## Current Focus — BUG #2 (journal-pnl-opennetdebit-units #2)

```yaml
reasoning_checkpoint:
  hypothesis: >
    calendars.open_net_debit sums two POSITIVE debits (159.41 + 127.06 = 286.47) instead of
    netting a debit against a credit (159.41 - 127.06 = 32.35) because syncFills.ts signs
    calendar_event.netAmount purely from OPEN/CLOSE classification (isClose ? negative :
    positive) — never from the fill's actual buy/sell direction. A calendar's two OPEN legs
    are NOT both debits: one leg (back) is bought-to-open (a real debit), the other (front)
    is SOLD-to-open (a credit) — but the old code forced both positive. Tracing one level
    deeper: even the fills.side column feeding this is itself wrong for already-ingested
    data — syncTransactions.ts's flattenTransaction synthesized side from positionEffect
    (OPENING->buy, CLOSING->sell) instead of reading it from the broker, and the Schwab
    adapter's mapTransaction discarded transferItems[].amount's SIGN via Math.abs() — the
    one field that carries the real per-leg BUY/SELL direction (positive=bought/received,
    negative=sold/delivered; corroborated by cost's sign in the same transferItem: -1250.00
    for a bought leg, +800.00 for a sold leg, in packages/adapters/src/test/fixtures/
    schwab-transactions.fixture.json).
  confirming_evidence:
    - "syncFills.ts lines ~402-405 (pre-fix): `const netAmount = isClose ? -(avgPrice*sumQty) : avgPrice*sumQty` — sign depends ONLY on OPEN/CLOSE classification, never on cf.side. Both legs of a calendar's initial entry classify OPEN (positionEffect derived from the CALENDAR's overall status, 'open' -> OPENING for both legs), so both got netAmount = +avgPrice*sumQty regardless of direction."
    - "recomputeCalendarAmounts (postgres/repos/fills.ts AND memory/fills.ts, byte-identical logic) sums calendar_events.netAmount by eventType with NO further sign massaging: `case OPEN: openDebit += amount`. This function was ALREADY CORRECT — verified by adding a mixed-sign contract test (fills.contract.ts, +159.41/-127.06 -> 32.35) that PASSES against the unmodified recompute logic. The bug is entirely upstream, in how netAmount is computed, not in how it's summed."
    - "syncTransactions.ts flattenTransaction (pre-fix): `const side = leg.positionEffect === 'OPENING' ? 'buy' : 'sell'` — its OWN docstring admitted this was an assumption ('side derives from positionEffect'). This is a SECOND instance of the identical wrong assumption, one layer further upstream, and it is what actually determines cf.side."
    - "transactions-adapter.ts mapTransaction (pre-fix): `const qty = Math.abs(item.amount ?? 0)` — discards item.amount's sign. Schwab's transferItem convention (confirmed via packages/adapters/src/test/fixtures/schwab-transactions.fixture.json, which predates this session): amount +1 for a BOUGHT/received leg (cost -1250.00, a debit) and amount -1 for a SOLD/delivered leg (cost +800.00, a credit) — the real direction signal, discarded, and never plumbed into BrokerTransaction.legs[] at all (the domain port type had no side field)."
    - "BrokerTransaction.legs[] (packages/core/src/brokerage/application/ports.ts) had occSymbol/qty/price/positionEffect but NO side field — direction was architecturally nowhere to be carried from the adapter to the journal ingestion pipeline, confirming this is the deeper root cause the investigation directive anticipated ('if direction isn't currently persisted... that is the deeper root cause')."
  falsification_test: >
    Added a fixture transaction with positionEffect=OPENING + transferItem.amount=-1 (a
    sold-to-open leg, using the REAL order 1006855414174 front-leg numbers: price 127.06,
    cost +12704.78) and asserted the mapped leg.side is 'sell', not 'buy'. RED under the old
    positionEffect-based inference (produced 'buy'), GREEN after reading amount's sign.
    Symmetric RED/GREEN check performed at syncFills.ts (mixed buy+sell OPEN legs ->
    netAmount 159.41 / -127.06, nets to 32.35) and at syncTransactions.ts (OPENING+sell,
    CLOSING+buy fixture). All three layers independently reverted-and-reproduced RED before
    the fix, then confirmed GREEN after — see Evidence entries below for exact commands/output.
  fix_rationale: >
    Fixed at the SIGNAL SOURCE (Schwab adapter reads amount's real sign) and threaded the
    real value through every layer that previously re-derived or discarded it
    (BrokerTransaction.legs[].side added to the domain port; syncTransactions.ts reads
    leg.side instead of inferring it; AggregatedFill.side added and propagated by
    aggregatePartialFills; syncFills.ts signs netAmount from cf.side instead of isClose).
    This is a root-cause fix, not a bandaid: recomputeCalendarAmounts and the calendar-event
    domain model were never touched, because they were never wrong — only the direction
    signal feeding them was corrupted, and is now corrected at its origin.
  blind_spots: >
    ROLL events (rollOpenDebit/rollCloseCredit in syncFills.ts, ~lines 336-338) have the
    IDENTICAL latent bug (openDebit/closeCredit assumed positive by open/close role, not by
    actual side) and are NOT fixed in this session — no reported symptom exercises a ROLL of
    a sold-to-open or bought-to-close leg, and every existing ROLL test only covers the
    "close=sell, open=buy" case that happens to match the flawed assumption. Flagged as a
    known, separate, out-of-scope follow-up (see Eliminated/Corrected-framing note below) —
    do NOT assume ROLL-involving calendars are fixed by this change.

    RESOLVED in the money-path-review follow-up round (see "Current Focus — Money-Path
    Review Follow-up" and "Resolution — Money-Path Review Follow-up" below): the ROLL branch
    now signs closeCredit/openDebit by cf.side/paired.side, mirroring OPEN/CLOSE exactly.
    This blind_spot no longer applies — ROLL-involving calendars ARE covered by the fix as
    of that round. Left here verbatim for the historical record of what this original round
    did and did not cover.

    CRITICAL — prod data implication (surfaced per the investigation directive, NOT acted
    on): the code fix corrects all FUTURE fills ingestion. It does NOT retroactively correct
    ALREADY-INGESTED fills.side data for calendars already backfilled (including 65aac62e) —
    their fills.side rows were written by the OLD (positionEffect-derived) logic and are
    already wrong for any sold-to-open/bought-to-close leg. The fills table stores no raw
    broker JSON (schema HAS a `raw` column but RawFill/writeFills never populate it) — the
    true sign is UNRECOVERABLE from stored fills rows alone. rebuild-journal re-PAIRS
    existing fills into new calendar_events; it does not re-fetch from Schwab, so it will NOT
    fix already-ingested calendars' side data. Correcting 65aac62e (and any other
    already-backfilled calendar) requires a NEW, not-yet-built capability: delete the
    affected calendar's existing fills rows (writeFills is onConflictDoNothing, so a bare
    re-run of backfill-transactions/syncTransactions is a no-op against existing ids) then
    re-run syncTransactions against Schwab with the fixed adapter, then rebuild-journal. This
    is explicitly out of scope for this session (no prod job triggered) and is a required
    orchestrator follow-up, not a "deploy and it just works" situation.
```

- next_action: Orchestrator-owned. (1) Review/merge this fix. (2) Decide on a
  fills-side-correction capability for already-backfilled calendars (65aac62e and any
  others) — deletion + re-sync from Schwab, tested and repeatable, NOT a hand-edit. (3) Only
  after that capability runs for 65aac62e will `rebuild-journal` -> `recompute-snapshot-pnl`
  produce openNetDebit ≈ 32.35. Do NOT deploy or trigger rebuild-journal/recompute-snapshot-pnl
  from this session — self-verified in dev/test only (2115/2115 tests green, typecheck clean,
  lint clean).

## Evidence

- timestamp: 2026-07-05 — 7425P last snapshot `netMark:"36.5"`, `pnlOpen:"-319850"`; `openNetDebit:3235`; `qty:1`. `(36.5-3235)*100 = -319850` exactly.
- timestamp: 2026-07-05 — source order 1006855414174 leg prices 159.41 / 127.06 (points), net 32.35 pts; order dollar netAmount ≈ −$3237 ≈ stored openNetDebit 3235.
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/registerCalendar.ts`, `apps/server/src/adapters/http/calendar.routes.ts`, `packages/adapters/src/postgres/repos/calendars.ts`: `openNetDebit` is caller-supplied at registration, written verbatim (`String(input.openNetDebit)`), zero unit validation/conversion. `packages/contracts/src/calendar.ts`'s Zod schema (`openNetDebit: z.number()`) carries no unit documentation.
- timestamp: 2026-07-05 — read `apps/worker/src/backfill-transactions.ts` in full: only orchestrates `makeSyncTransactionsUseCase` -> `writeFills`. Zero calls to `registerCalendar` or `recomputeCalendarAmounts`. Grepped for `register_calendar`/`registerCalendar` across apps/server + apps/worker: the HTTP route (`POST /api/calendars`) is the ONLY registration entry point — no auto-registration script exists.
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/syncFills.ts` lines ~398-422: OPEN/CLOSE `netAmount = avgPrice * sumQty` (points scale, no ×100). ROLL's `rollOpenDebit`/`rollCloseCredit` same scale.
- timestamp: 2026-07-05 — read `packages/adapters/src/postgres/repos/fills.ts` `recomputeCalendarAmounts`: sums `calendar_events.netAmount` by `eventType`, writes `calendars.open_net_debit`/`close_net_credit`. Confirmed points-scale by the EXISTING (untouched) `fills.contract.ts` assertion `openNetDebit ~= 20.5`.
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/rebuildJournal.ts` + `docs/architecture/jobs.md` rebuild-journal section: 5-step delete-then-reinsert; explicitly documented as NOT touching `calendar_snapshots`.
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/getCalendarLifecycle.ts` (the exact endpoint named in the repro steps, `GET /api/journal/:id/lifecycle`): spreads `...row` from the stored `SnapshotRow` — `pnlOpen` reaches the API response verbatim from the DB, never recomputed at read-time. This explains the reported symptom precisely: attribution buckets (theta/vega/Δ-Γ, derived from small period-over-period mark/greek changes) look tiny/correct while "Net" (straight passthrough of the stored, wrong-scale `pnlOpen`) is huge and negative.
- timestamp: 2026-07-05 — attempted a read-only query against the prod `DATABASE_URL` (from `.env`) to inspect `calendar_events`/`fills` for calendar 65aac62e and settle the one remaining open question (does rebuild-journal actually fix THIS calendar, or are its fills missing/orphaned). BLOCKED: the sandbox's auto-mode classifier denied the action as "Production Reads... without explicit user approval naming that prod target." No workaround attempted (per harness policy) — documented as a blind spot instead.
- timestamp: 2026-07-05 — built + TDD'd (RED->GREEN at every step, full output captured) a new `recompute-snapshot-pnl` data-correction capability: core use-case (`recomputeSnapshotPnl.ts`, 5 unit tests), new port `ForRecomputingSnapshotPnl`, shared pure formula `computeSnapshotPnl` (extracted from `snapshotCalendars.ts`, used by both the live writer and the new recompute path — no formula drift), in-memory adapter implementation + postgres adapter implementation (both covered by the shared `__contract__/calendar-snapshots.contract.ts` suite, 4 new cases each, postgres run against REAL Postgres via testcontainers), worker handler (`recompute-snapshot-pnl.ts`, 7 tests, mirrors `rebuild-journal.ts` exactly), full wiring into `apps/worker/src/main.ts` + `schedule.ts` (13th queue, on-demand only, no cron) + `trigger_job` MCP tool + `POST /api/jobs/:name/trigger` HTTP route (both already generic over `TRIGGERABLE_JOBS`/`triggerJobBodyFor`, only `@morai/contracts/jobs.ts` needed a new entry) + a calendar-scoped dedupe key (`recomputeSnapshotPnlDedupeKey`) — WITHOUT this, the job's default 10-min-window dedupe key would have silently collapsed two DIFFERENT calendars triggered in the same window into one no-op (caught by a RED test before the fix, see enqueueJob.test.ts). Full monorepo suite: 2107/2107 tests pass, typecheck clean, lint clean.

- timestamp: 2026-07-05 — BLIND SPOT RESOLVED by orchestrator (independent of this session): `GET /api/journal/65aac62e/rules` returns 2 OPEN `calendar_events` — both legs paired (back 260831P07425000, front 260807P07425000, created by syncFills on Jun 23). Events EXIST and paired point-scale; `openNetDebit` is still 3235 only because `rebuild-journal` never ran on this calendar. So `rebuild-journal` WILL recompute the correct point-scale `openNetDebit` (~32.35) — NO `openNetDebit:0` risk for 65aac62e. Confirms fix path (1) applies cleanly to this calendar.
- timestamp: 2026-07-05 — MONEY-PATH REVIEW (specialist, TDD-mode gate): reviewed the full fix diff. One blocking (🔴) finding addressed — the `recomputeSnapshotPnl` postgres adapter did N sequential per-row UPDATEs with NO transaction, so a mid-loop failure could leave a calendar's snapshots half-corrected. Fixed: wrapped the SELECT + per-row UPDATE loop in a single `db.transaction()` (all-or-nothing; `rowsUpdated` now reflects one committed atomic batch). This also resolves the earlier blind_spot re: N-sequential-UPDATE partial-write risk. Three non-blocking (🟡/❓) findings were speculative future-proofing (helper extraction for a hypothetical 3rd job, N+1 perf on bounded per-calendar data, `${name}` message templating) — deliberately NOT applied per the repo's "no abstractions for single-use code / no perf not requested" discipline. Re-verified: 2107/2107 tests pass, typecheck + lint clean after the atomicity fix.

- timestamp: 2026-07-05 (BUG #2 session) — orchestrator finding: validate-on-one deployed BUG #1's fix and ran `rebuild-journal` on 65aac62e (full UUID 65aac62e-901d-4edf-8281-02691b615285). open_net_debit changed 3235 -> 286.47. STILL WRONG (correct: 32.35). Arithmetic: 286.47 = 159.41 (back leg avgPrice, bought) + 127.06 (front leg avgPrice, sold) — SUMMED; should be NETTED (159.41 - 127.06 = 32.35). Source order 1006855414174 confirms signs via transaction netAmount: back -15942.22 (debit), front +12704.78 (credit).
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/syncFills.ts` lines ~398-422 (netAmount signing) in full: `const netAmount = isClose ? -(avgPrice*sumQty) : avgPrice*sumQty` — confirmed sign depends ONLY on OPEN/CLOSE classification, never on the fill's actual buy/sell direction. Both of a calendar's OPEN legs get netAmount = +avgPrice*sumQty regardless of which was bought vs sold.
- timestamp: 2026-07-05 — read `packages/adapters/src/postgres/repos/fills.ts` `recomputeCalendarAmounts` and `packages/adapters/src/memory/fills.ts` (byte-identical logic): sums `calendar_events.netAmount` by eventType with no further sign massaging. Added a NEW mixed-sign contract test (`fills.contract.ts`, seeding OPEN netAmount +159.41 and -127.06) — PASSES against the UNMODIFIED recompute logic (nets to 32.35). Conclusion: recomputeCalendarAmounts was never buggy; the defect is entirely in how netAmount is computed upstream, confirming the earlier "recompute-journal fixes it" assumption from BUG #1 was based on an untested blind spot.
- timestamp: 2026-07-05 — traced fill direction end-to-end per the investigation directive. `packages/adapters/src/postgres/repos/fills.ts` `mapFillRow`: `side: row.side === "sell" ? "sell" : "buy"` — read verbatim from the `fills.side` DB column (schema: `side: varchar("side", {length:4}).notNull()`), so direction IS a real persisted column. But traced its ORIGIN: `packages/core/src/journal/application/syncTransactions.ts` `flattenTransaction` (pre-fix): `const side = leg.positionEffect === "OPENING" ? "buy" : "sell"` — side was SYNTHESIZED from positionEffect, not read from the broker. Traced one level further: `packages/core/src/brokerage/application/ports.ts` `BrokerTransaction.legs[]` had occSymbol/qty/price/positionEffect but NO side field at all — direction had architecturally nowhere to flow from the Schwab adapter into the journal pipeline.
- timestamp: 2026-07-05 — read `packages/adapters/src/schwab/trader/transactions-adapter.ts` `mapTransaction` (pre-fix): `const qty = Math.abs(item.amount ?? 0)` — Schwab's transferItem `amount` field is SIGNED (positive = contracts received/bought, negative = contracts delivered/sold), discarded via `Math.abs()`. Corroborated via `packages/adapters/src/test/fixtures/schwab-transactions.fixture.json` (pre-existing fixture, not authored this session): row 1 (OPENING) has `amount: 1, cost: -1250.00` (bought, debit); row 2 (CLOSING) has `amount: -1, cost: 800.00` (sold, credit) — `cost`'s sign independently confirms `amount`'s sign convention. This is the deeper root cause anticipated by the investigation directive: direction was technically "persisted" as a `fills.side` column, but the VALUE was synthesized, never sourced from the broker.
- timestamp: 2026-07-05 — TDD RED->GREEN at every layer (full command output captured, each reverted-and-reproduced to confirm RED before restoring the fix):
  1. `fill-pairing.test.ts` — `aggregatePartialFills` didn't return `side` (RED: `expected undefined to be 'buy'`). Fixed: added `side` to `AggregatedFill` domain type (`calendar-event.ts`) and propagated `first.side` in `aggregatePartialFills` (`fill-pairing.ts`).
  2. `syncFills.test.ts` — new test "calendar with a bought-to-open leg AND a sold-to-open leg": back BUY @159.41 + front SELL @127.06, both OPENING. RED (front netAmount +127.06, expected -127.06). Fixed: `syncFills.ts` netAmount signing changed from `isClose ? -(..) : (..)` to `cf.side === "sell" ? -(..) : (..)`. GREEN: back +159.41, front -127.06, sum 32.35 exactly.
  3. `syncFills.test.ts` — new test for realizedPnl on a bought-to-close SHORT leg (sold-to-open @127.06, prior OPEN netAmount now correctly -127.06, bought-to-close @50, fees 2): RED under old `closeCredit = Math.abs(avgPrice*sumQty)` (produced realizedPnl 175.06, backwards). Fixed: `closeCredit = -netAmount` (reuses the now-correctly-signed CLOSE netAmount). GREEN: realizedPnl 75.06 (127.06 credit - 50 debit - 2 fees).
  4. `syncTransactions.test.ts` — rewrote OPEN_TX/CLOSE_TX fixtures to the OPPOSITE of the old inference (OPENING+side=sell front leg, CLOSING+side=buy). RED under `positionEffect === "OPENING" ? "buy" : "sell"` (produced "buy"/"sell", expected "sell"/"buy"). Fixed: `flattenTransaction` now reads `leg.side` directly. GREEN.
  5. `trader-adapter.test.ts` — new test: OPENING + `transferItem.amount: -1` (using real order 1006855414174 front-leg numbers, price 127.06). RED under positionEffect-derived side (produced "buy"). Fixed: `mapSide(amount)` derives from amount's sign. GREEN: side "sell".
  6. `syncFills.property.test.ts` P3 (fast-check, 300 runs) failed immediately after the syncFills.ts fix (counterexample: single front-leg OPENING sell fill, qty=1, price=0.05 -> expected -0.05, got +0.05) — the property's OWN "expected" reconstruction encoded the same pre-fix assumption (unsigned economics summed by open/close role). Fixed the test's expected-value derivation to sign by `f.side` for OPEN/CLOSE (non-ROLL) events, matching the corrected implementation; left ROLL's reconstruction unsigned (matches the still-unfixed ROLL code, see blind_spots). GREEN, 300 runs.
- timestamp: 2026-07-05 — added the explicitly-requested `fills.contract.ts` coverage-gap test ("nets a bought-to-open leg against a sold-to-open (credit) leg") seeding OPEN netAmount +159.41/-127.06 directly — run against BOTH `packages/adapters/src/memory/fills.contract.test.ts` and `packages/adapters/src/postgres/repos/fills.contract.test.ts` (testcontainers). PASSES on both (expected — recomputeCalendarAmounts itself was never the bug; this closes the "existing test only covers same-direction legs" gap the orchestrator flagged).
- timestamp: 2026-07-05 — full verification: `bun run typecheck` clean (tsc --build --force, zero errors across all project references). `bun run test` (vitest, whole monorepo): 2115/2115 pass (was 2107 before this session's changes — +8 net new/rewritten assertions across fill-pairing.test.ts, syncFills.test.ts, trader-adapter.test.ts). `bun run lint`: clean (only pre-existing boundaries-plugin informational warnings, zero errors).
- timestamp: 2026-07-05 — mechanical follow-through: `BrokerTransaction.legs[].side` is a new REQUIRED domain field; fixed every construction site across the monorepo (`getTransactions.test.ts`, `backfill-transactions.test.ts`, `journal-e2e.test.ts`, `brokerage.routes.test.ts`, `get-transactions.test.ts` under apps/server/mcp). Deliberately did NOT touch `packages/contracts/src/brokerage.ts` (the `brokerTransactionLeg` Zod wire schema) or the HTTP/MCP mapping code — Zod `.parse()` strips unknown keys by default (no `.passthrough()` on that schema), so the new domain-only `side` field is silently dropped from the `get_transactions` API/MCP response with zero behavior change to that unrelated feature; confirmed via unmodified brokerage.routes.test.ts/get-transactions.test.ts staying green.

## Eliminated

- hypothesis: "rebuild-journal (unmodified) correctly recomputes openNetDebit for any calendar with paired calendar_events, including 65aac62e" (BUG #1's stated fix_rationale)
  evidence: "Disproven by the orchestrator's validate-on-one run: rebuild-journal DID recompute (confirming BUG #1's diagnosis that registration-time openNetDebit was stale/unused) but produced 286.47, not 32.35 — recomputeCalendarAmounts faithfully summed the calendar_events, but those events themselves carried wrongly-signed netAmount (both legs positive) because syncFills.ts never signed by actual buy/sell direction. BUG #1's fix was necessary but not sufficient — a second, independent defect in the SAME netAmount computation path was masked because the original registration value (3235) was never overwritten until this rebuild ran."
  timestamp: 2026-07-05

- hypothesis: "Corrected framing of the original 3235 registration value (superseded framing from BUG #1)"
  evidence: >
    BUG #1's Resolution described 3235 as simply "the DOLLAR debit" entered at registration
    with "zero validation/conversion" — true, but incomplete. Re-examined given BUG #2: 3235
    = 32.35 (the CORRECT net debit) × 100. The registration value was not an arbitrary wrong
    number — it encoded the right economics at the wrong scale (dollars vs points), which is
    why BUG #1's framing ("units mismatch") was directionally correct for the SNAPSHOT
    formula bug. But it means rebuild-journal's recompute did NOT converge on the
    already-correct-up-to-scale 3235 — it diverged further, to a WRONG (summed, not netted)
    286.47, because the recompute path has its own independent bug (BUG #2) unrelated to
    units. The two bugs are orthogonal: BUG #1 = wrong SCALE (dollars vs points) in a
    hand-entered value that was never recomputed; BUG #2 = wrong SIGN (summed vs netted) in
    every value recomputeCalendarAmounts DOES produce, for every calendar with one bought and
    one sold leg (i.e. every calendar).
  timestamp: 2026-07-05

(BUG #1's original Eliminated note, preserved: the original hypothesis was confirmed by direct
code evidence, not disproven. The one genuinely-unverified blind_spot for 65aac62e — do its
fills pair or are they orphaned — was resolved by the orchestrator: 2 OPEN paired
calendar_events exist. That confirmed rebuild-journal would RUN cleanly on 65aac62e — it did
not confirm rebuild-journal would produce the CORRECT number, which is BUG #2.)

## Resolution

root_cause: >
  `calendars.open_net_debit` for backfilled calendars (confirmed for 65aac62e; the ORIGINAL
  hypothesis that this "affects ALL backfilled calendars" is carried forward, not
  independently re-verified against prod — see blind_spots) was entered in DOLLARS at
  calendar-registration time via `POST /api/calendars`, which accepts a raw, unit-undocumented
  operator-supplied number with zero validation or conversion. `backfill-transactions.ts`
  never touches this column. The point-scale `snapshotCalendars.ts` pnl formula
  (`pnlOpen = (netMark - openNetDebit) * qty * 100`) then produces a ~100x-wrong `pnlOpen` on
  every 30-min snapshot row, which is frozen at write time and reaches the journal-lifecycle
  API verbatim (no read-time recomputation) — silently wrong, no exception.

fix: >
  Code-complete, fully tested, and COMMITTED (not yet deployed; prod data not yet corrected —
  operational rollout is orchestrator-owned):
  (1) EXISTING, unmodified `rebuild-journal` job corrects `calendars.open_net_debit` from the
  real fill-derived, point-scale `calendar_events`. Confirmed applicable to 65aac62e — it has 2
  OPEN paired calendar_events, so recompute yields ~32.35 (no openNetDebit:0 risk).
  (2) NEW `recompute-snapshot-pnl` job (built this session, full TDD) re-derives the frozen
  historical `calendar_snapshots.pnl_open` on every row for a calendar from its corrected
  `openNetDebit`/`qty`, sharing the exact D-05 formula with the live writer. No prod data has
  been touched — this is a tested, repeatable, idempotent, on-demand job (dedupe-keyed per
  calendar), not a hand-edit, satisfying the "no hand-edit trade history" constraint. Its
  postgres multi-row UPDATE runs inside a single transaction (money-path atomicity hardening
  from the specialist review — all-or-nothing).

  Operational rollout (orchestrator-owned; NOT run from this session): deploy the `worker`
  (new handler + queue registration) and `server` (trigger_job enum gained a 4th job), then
  per affected calendarId trigger `rebuild-journal` (fixes open_net_debit) followed by
  `recompute-snapshot-pnl` (fixes frozen snapshot pnl_open). Both jobs are idempotent and
  dedupe-keyed per calendar; safe to re-run.

verification: >
  Self-verified in dev/test only: 2107/2107 tests pass (including the exact regression numbers
  from this bug — 36.5/32.35/1 -> +415, matching the debug file's arithmetic), typecheck clean,
  lint clean, postgres adapter verified against REAL Postgres via testcontainers. Re-verified
  green after the money-path-review atomicity fix (transaction-wrapped recompute UPDATE). NOT
  yet verified against prod data — final prod verification is the orchestrator's post-deploy step.

files_changed:
  - packages/core/src/journal/application/ports.ts (+ForRecomputingSnapshotPnl port)
  - packages/core/src/journal/application/snapshotCalendars.ts (extracted computeSnapshotPnl, no behavior change)
  - packages/core/src/journal/application/recomputeSnapshotPnl.ts (new use-case)
  - packages/core/src/journal/application/recomputeSnapshotPnl.test.ts (new, 5 tests)
  - packages/core/src/journal/application/enqueueJob.ts (calendar-scoped dedupe for the new job)
  - packages/core/src/journal/application/enqueueJob.test.ts (+2 tests)
  - packages/core/src/journal/domain/dedupe-key.ts (+recomputeSnapshotPnlDedupeKey)
  - packages/core/src/journal/domain/dedupe-key.test.ts (+2 tests)
  - packages/core/src/journal/index.ts, packages/core/src/index.ts (barrel exports)
  - packages/adapters/src/memory/calendar-snapshots.ts (+recomputeSnapshotPnl impl)
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts (+recomputeSnapshotPnl impl, transaction-wrapped multi-row UPDATE per money-path review)
  - packages/adapters/src/__contract__/calendar-snapshots.contract.ts (+4 shared contract tests)
  - packages/adapters/src/memory/calendar-snapshots.contract.test.ts, packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts (wiring)
  - packages/contracts/src/jobs.ts (+"recompute-snapshot-pnl" to TRIGGERABLE_JOBS + triggerJobBodyFor)
  - packages/contracts/src/jobs.test.ts (+2 tests)
  - apps/server/src/adapters/mcp/tools/trigger-job.ts (dynamic per-job error message, description update)
  - apps/server/src/adapters/http/jobs.routes.test.ts (TRIGGERABLE_JOBS length assertion 3->4)
  - apps/worker/src/handlers/recompute-snapshot-pnl.ts (new handler)
  - apps/worker/src/handlers/recompute-snapshot-pnl.test.ts (new, 7 tests)
  - apps/worker/src/schedule.ts, apps/worker/src/schedule.test.ts (13th queue, on-demand only)
  - apps/worker/src/main.ts (composition wiring)
  - docs/architecture/jobs.md (new job section)

## Resolution — BUG #2 (journal-pnl-opennetdebit-units #2)

root_cause: >
  `calendar_events.netAmount` (and therefore `calendars.open_net_debit`/`close_net_credit`
  via `recomputeCalendarAmounts`, which is itself correct) was signed purely by OPEN/CLOSE
  classification (`syncFills.ts`: `isClose ? -(avgPrice*sumQty) : avgPrice*sumQty`) instead
  of by the fill's actual buy/sell direction. Every calendar has one bought leg (a real
  debit) and one sold leg (a real credit) opened together — both were forced positive, so
  recomputeCalendarAmounts SUMMED two debits (159.41 + 127.06 = 286.47) instead of NETTING a
  debit against a credit (159.41 - 127.06 = 32.35).

  Tracing one layer deeper (the actual defect that made the syncFills.ts fix a no-op against
  already-ingested data): `AggregatedFill`/`RawFill.side` — the value the netAmount fix reads
  — was itself wrong. `syncTransactions.ts` synthesized `side` from `positionEffect`
  (OPENING->buy, CLOSING->sell) instead of reading it from the broker. One layer deeper
  still: `BrokerTransaction.legs[]` (the shared domain port type) never carried a `side`
  field at all, and the Schwab adapter (`transactions-adapter.ts`) discarded the ONE field
  that carries real per-leg direction — `transferItems[].amount`'s SIGN — via `Math.abs()`.
  This is the deepest root cause: direction data was available at the broker boundary,
  architecturally dropped at the very first mapping step, and never recoverable downstream.

fix: >
  Code-complete, fully TDD'd (RED confirmed at every layer via revert-and-reproduce, then
  restored to GREEN — see Evidence), NOT committed, NOT deployed, NO prod job triggered:
  (1) `packages/adapters/src/schwab/trader/transactions-adapter.ts`: `mapSide(amount)` reads
  `transferItems[].amount`'s real sign (positive=bought, negative=sold) instead of inferring
  from positionEffect.
  (2) `packages/core/src/brokerage/application/ports.ts`: added `side: "buy"|"sell"` to
  `BrokerTransaction.legs[]` (the domain type had nowhere to carry direction before).
  (3) `packages/core/src/journal/application/syncTransactions.ts`: `flattenTransaction` reads
  `leg.side` directly instead of `leg.positionEffect === "OPENING" ? "buy" : "sell"`.
  (4) `packages/core/src/journal/domain/calendar-event.ts` + `fill-pairing.ts`: added `side`
  to `AggregatedFill`, propagated from the bucket's first fill in `aggregatePartialFills`
  (a bucket is one order on one leg — one direction, like orderId/legOccSymbol already are).
  (5) `packages/core/src/journal/application/syncFills.ts`: OPEN/CLOSE `netAmount` now signed
  by `cf.side` (buy=+debit, sell=-credit) instead of by classification; the CLOSE-path
  `closeCredit` used for `realizedPnl` now derives from the corrected `netAmount`
  (`-netAmount`) instead of an unconditional `Math.abs(...)`, so a leg sold-to-open then
  later bought-to-close also gets a correct realized P&L, not just the open-side sum.

  Deliberately NOT touched: `recomputeCalendarAmounts` (postgres + memory, byte-identical) —
  proven correct-as-is via a new mixed-sign contract test; `packages/contracts/src/brokerage.ts`
  and the `get_transactions` HTTP route/MCP tool — the new `side` field is additive-only on
  the domain type and is silently stripped by Zod `.parse()` (no `.passthrough()`), zero
  behavior change to that unrelated feature; ROLL's `rollOpenDebit`/`rollCloseCredit` — same
  latent bug, but unexercised by any reported symptom or existing test, explicitly flagged
  as an out-of-scope follow-up (see blind_spots in Current Focus above), not silently fixed
  or silently ignored.

verification: >
  Self-verified in dev/test only: `bun run typecheck` clean (tsc --build --force, zero
  errors). `bun run test`: 2115/2115 pass (monorepo-wide; was 2107 before this session).
  `bun run lint`: clean. Every new/changed assertion was confirmed RED (for the exact
  expected reason, output captured) before being confirmed GREEN — at the fill-pairing
  layer, the syncFills layer (both the netAmount-sum regression AND the short-leg
  realizedPnl regression), the syncTransactions layer, the Schwab-adapter layer, and the
  fast-check property layer (P3, 300 runs). NOT verified against prod data — see the
  critical blind_spot in Current Focus: a code fix alone does NOT correct already-ingested
  fills.side data (no raw broker JSON is stored to recover it from), so `rebuild-journal` on
  65aac62e will NOT yet produce 32.35 without an additional, not-yet-built fills
  re-ingestion capability. This is the single most important caveat in this entire
  resolution — do not treat "code fixed + tests green" as "65aac62e is now correct".

files_changed:
  - packages/core/src/brokerage/application/ports.ts (+side on BrokerTransaction.legs[])
  - packages/core/src/brokerage/application/getTransactions.test.ts (fixture: +side)
  - packages/adapters/src/schwab/trader/transactions-adapter.ts (mapSide from amount's sign, root-cause fix)
  - packages/adapters/src/schwab/trader/trader-adapter.test.ts (+2 tests: side-from-amount, sold-to-open regression)
  - packages/core/src/journal/application/syncTransactions.ts (flattenTransaction reads leg.side, not positionEffect)
  - packages/core/src/journal/application/syncTransactions.test.ts (fixtures rewritten to opposite-of-old-inference; assertions updated)
  - packages/core/src/journal/domain/calendar-event.ts (+side on AggregatedFill)
  - packages/core/src/journal/domain/fill-pairing.ts (aggregatePartialFills propagates side)
  - packages/core/src/journal/domain/fill-pairing.test.ts (+2 tests: side propagation buy/sell)
  - packages/core/src/journal/application/syncFills.ts (netAmount signed by cf.side; closeCredit derived from corrected netAmount)
  - packages/core/src/journal/application/syncFills.test.ts (+2 tests: mixed-direction OPEN netting, short-leg realizedPnl)
  - packages/core/src/journal/application/syncFills.property.test.ts (P3 expected-value derivation made side-aware for OPEN/CLOSE; ROLL left unsigned, comments updated)
  - packages/adapters/src/__contract__/fills.contract.ts (+1 coverage-gap test: bought-vs-sold-open nets to 32.35, not 286.47 — run against both postgres+memory)
  - apps/worker/src/backfill-transactions.test.ts (fixture: +side)
  - apps/worker/src/journal-e2e.test.ts (fixtures: +side)
  - apps/server/src/adapters/http/brokerage.routes.test.ts (fixture: +side, mechanical, unenforced by tsc but fixed for correctness)
  - apps/server/src/adapters/mcp/get-transactions.test.ts (fixture: +side, same)

- timestamp: 2026-07-05 — MONEY-PATH SPECIALIST REVIEW (2nd pass, on the BUG #2 diff): one
  blocking (🔴) and one non-blocking-but-required (🟡) finding, plus a coverage gap (🔵) and
  a separate adapter hardening item (🟡). 🔴 `syncFills.ts` ROLL branch (~line 336):
  `closeCredit = Math.abs(cf.avgPrice*cf.sumQty)` unconditionally — a bought-to-close ROLL
  leg (a DEBIT paid) got a POSITIVE rollCloseCredit, corrupting `rollCloseCredit`/`realizedPnl`
  for bought-to-close rolls. 🟡 same branch's `netAmount = openDebit - closeCredit` therefore
  wrong for any roll with a bought-to-close or sold-to-open leg; no test covered it. 🔵
  `syncFills.test.ts`'s only ROLL tests covered close=sell exclusively. 🟡
  `transactions-adapter.ts` `mapSide` defaulted a missing/zero `amount` to `"buy"`, silently
  corrupting direction if Schwab ever omits `amount`.
- timestamp: 2026-07-05 — TDD RED->GREEN, ROLL branch (2 new tests in `syncFills.test.ts`,
  full output captured, reverted-and-reproduced to confirm RED before restoring the fix):
  "ROLL: CLOSE leg bought-to-close → rollCloseCredit is a NEGATIVE debit, not a positive
  credit" — RED under the old `Math.abs(...)` (produced +50, expected -50). "ROLL: OPEN leg
  sold-to-open → rollOpenDebit is a NEGATIVE credit, not a positive debit" — RED under the
  old unconditional `paired.avgPrice*paired.sumQty` (produced +20, expected -20). Fixed:
  `closeCredit = cf.side === "sell" ? cf.avgPrice*cf.sumQty : -(cf.avgPrice*cf.sumQty)`;
  `openDebit = paired.side === "sell" ? -(paired.avgPrice*paired.sumQty) : paired.avgPrice*paired.sumQty`
  — the exact same sign convention as the already-approved OPEN/CLOSE fix, applied to both
  ROLL legs. `legBreakdown`'s per-leg `netAmount` (same ROLL block) had the identical
  unconditional-sign bug and was fixed in the same edit to reuse the now-correct
  `closeCredit`/`openDebit` values (`-closeCredit` / `openDebit`) — no new logic, same
  variables. GREEN: both new tests pass; all 8 pre-existing ROLL/CLOSE tests in the same
  file still pass unchanged (their fixtures happen to use close=sell/open=buy, the case
  that was never wrong).
- timestamp: 2026-07-05 — the ROLL fix exposed a STALE property test: `syncFills.property.test.ts`
  P3's own comment had explicitly documented ROLL as "still unsigned — a documented,
  separate, out-of-scope limitation" and reconstructed expected ROLL economics unsigned.
  Running the full property suite (300 runs) after the ROLL fix produced a real counterexample
  (`front OPENING+sell` / `back CLOSING+buy` — the exact "open leg sold-to-open, close leg
  bought-to-close" case now fixed) confirming the property's reconstruction, not the
  implementation, was stale. Fixed the property's expected-value derivation to sign ROLL
  contributions by `f.side` (mirroring OPEN/CLOSE): opening-role fills use the
  rollOpenDebit convention (debit positive/credit negative), closing-role fills use the
  rollCloseCredit convention (credit positive/debit negative). Re-ran: GREEN, 300/300 runs,
  all 4 properties (P1/P2/P2b/P3) pass.
- timestamp: 2026-07-05 — TDD RED->GREEN, mapSide hardening (2 new tests in
  `trader-adapter.test.ts`): "a MISSING transferItem.amount falls back to cost's sign, not a
  silent 'buy' default" — RED under the old `(amount ?? 0) < 0 ? sell : buy` (produced "buy"
  for a missing-amount, cost-positive/credit leg that is actually a sale; expected "sell").
  "amount AND cost both missing → the leg is DROPPED, never fabricated as 'buy'" — RED (old
  code produced a leg with fabricated side "buy"; expected zero legs). Fixed:
  `mapSide(amount, cost)` — uses `amount`'s sign when `amount` is defined and nonzero
  (unchanged, still the authoritative signal); falls back to `cost`'s sign when `amount` is
  missing/zero (`cost < 0` = money paid = bought, `cost > 0` = money received = sold —
  corroborated by the same schwab-transactions fixture used for the original mapSide fix:
  amount+1/cost-1250.00 bought, amount-1/cost+800.00 sold — cost's sign is the exact negation
  of amount's); returns `null` when NEITHER carries a usable signal, and the caller (`mapTransaction`'s
  leg loop) now `continue`s past a `null` side — dropping the leg entirely rather than
  fabricating a direction, mirroring the existing skip-on-unparseable-symbol pattern in the
  same loop. GREEN: both new tests pass; all 26 pre-existing trader-adapter tests unchanged
  and still pass (fixture rows always have a defined nonzero `amount`, so the `amount`-path
  is unaffected).
- timestamp: 2026-07-05 — full re-verification after both fixes: `bun run typecheck` clean
  (tsc --build --force, zero errors). `bun run test` (vitest, whole monorepo): 2119/2119 pass
  (was 2115 before this follow-up round; +4 net new tests: 2 ROLL sign tests + 2 mapSide
  tests). `bun run lint`: clean (same pre-existing boundaries-plugin informational warnings
  as every prior round, zero errors). Confirmed via `git diff` that the OPEN/CLOSE netting
  fix (BUG #2's `netAmount = cf.side === "sell" ? ... : ...` at the non-ROLL emit path, and
  its CLOSE-path `closeCredit = -netAmount`) was NOT touched by this follow-up — the diff's
  only changes to `syncFills.ts` are inside the ROLL branch (closeCredit/openDebit/legBreakdown).

## Current Focus — Money-Path Review Follow-up (ROLL sign + mapSide hardening)

```yaml
reasoning_checkpoint:
  hypothesis: >
    The money-path specialist review's 🔴/🟡 findings on the BUG #2 diff were both correct
    and both were exactly the blind_spot BUG #2 itself had already flagged and left
    unresolved: (1) the ROLL branch's closeCredit/openDebit used unconditional
    Math.abs/positive assumptions instead of cf.side/paired.side, the IDENTICAL bug class
    the OPEN/CLOSE fix corrected, just unfixed one branch over; (2) mapSide's
    `(amount ?? 0) < 0 ? sell : buy` silently defaulted an undeterminable direction to
    "buy" instead of surfacing the missing signal.
  confirming_evidence:
    - "syncFills.ts ROLL branch (pre-fix): `const closeCredit = Math.abs(cf.avgPrice*cf.sumQty)` and `const openDebit = paired.avgPrice*paired.sumQty` — both unconditional, ignoring cf.side/paired.side entirely, in the exact same file/function where the OPEN/CLOSE path 20 lines below already reads cf.side correctly."
    - "New RED tests (syncFills.test.ts) confirmed the exact predicted failure: a bought-to-close ROLL leg produced rollCloseCredit=+50 (expected -50); a sold-to-open ROLL leg produced rollOpenDebit=+20 (expected -20)."
    - "recomputeCalendarAmounts (fills.ts, untouched, re-read to confirm): sums rollOpenDebit into openDebit and rollCloseCredit into closeCredit with NO re-negation — proving these two fields must already carry the same debit-positive/credit-negative (openDebit) and credit-positive/debit-negative (closeCredit) conventions as OPEN/CLOSE netAmount, which the old unconditional code did not provide."
    - "syncFills.property.test.ts P3's own comment admitted ROLL was left unsigned as 'a documented, separate, out-of-scope limitation' — running the full 300-run property suite after the ROLL fix produced a real counterexample in the exact scenario that comment described, confirming the property (not the implementation) needed updating, not narrowing."
    - "transactions-adapter.ts mapSide (pre-hardening): `(amount ?? 0) < 0 ? 'sell' : 'buy'` — an undefined or zero amount silently resolves to 'buy' with no signal at all. New RED test with amount omitted + cost=+12704.78 (a real credit/sale) produced 'buy' (wrong) before the fix."
    - "schwab-transactions.fixture.json (pre-existing, both BUG #2 rounds' own evidence): amount+1/cost-1250.00 (bought/debit), amount-1/cost+800.00 (sold/credit) — cost's sign is the exact negation of amount's, confirming cost is a valid corroborating fallback signal, not a guess."
  falsification_test: >
    For the ROLL fix: reverted syncFills.ts's ROLL closeCredit/openDebit to the old
    Math.abs/unconditional form and re-ran the 2 new tests — both failed for the exact
    predicted reason (sign inversion), confirming the tests exercise the bug, not a tautology.
    Restored the fix — both green. For mapSide: reverted mapSide to the old
    `(amount ?? 0) < 0 ? sell : buy` and re-ran the 2 new tests — both failed (one produced
    "buy" instead of "sell", one produced a fabricated leg instead of zero legs). Restored
    the fix — both green.
  fix_rationale: >
    Both fixes are root-cause, not bandaids, and both directly close the gap the SAME
    prior round had already identified and explicitly deferred: (1) ROLL's
    closeCredit/openDebit now read cf.side/paired.side using the IDENTICAL formula the
    OPEN/CLOSE path already uses — no new convention invented, just applied consistently to
    the branch that was missed. legBreakdown's per-leg netAmount (same ROLL block) reuses
    the same now-correct closeCredit/openDebit values rather than re-deriving with the old
    broken formula, closing a second instance of the same bug in the same block. (2)
    mapSide now treats "no signal" as "no signal" — falling back to a real, independently
    verified corroborating field (cost) rather than fabricating a coin-flip default, and
    returning null (leg dropped) only when truly nothing is known, mirroring the file's own
    existing convention (skip an unparseable symbol, don't guess one).
  blind_spots: >
    The mapSide fallback to `cost`'s sign is itself unverified against a LIVE Schwab
    response that actually omits `amount` — no such payload has been observed in this
    investigation (the schwab-transactions fixture, used as evidence for the sign
    convention, always has amount defined; the "missing amount" scenario is a defensive
    hardening for an undocumented edge case, not a reproduction of an observed prod
    payload). If Schwab's real schema differs from the assumed cost-sign convention in some
    untested edge case (e.g. a fee-only transferItem with cost set but no amount and no real
    contract transfer), the fallback could still misclassify that item — dropping the leg
    (this fix's failure mode) is the safe direction, since it can never fabricate a wrong
    debit/credit into the money path, but it is not proof the fallback's sign logic is
    correct for every conceivable Schwab payload shape, only for the ones evidenced so far.

    The already-documented, still-open prod-data blind_spot from the prior round is
    UNCHANGED by this follow-up: already-ingested fills.side data for backfilled calendars
    (including 65aac62e) is still not retroactively correctable from stored fills rows
    alone (no raw broker JSON persisted) — this follow-up is a pure code-correctness fix
    (ROLL sign + mapSide hardening), not a prod data migration, and does not touch that gap.
```

- next_action: Orchestrator-owned. Same operational rollout as BUG #2's next_action (deploy
  worker+server, then per-calendar rebuild-journal -> recompute-snapshot-pnl), now ALSO
  covering ROLL-involving calendars correctly. Do NOT deploy or trigger any prod job from
  this session — self-verified in dev/test only (2119/2119 tests green, typecheck clean,
  lint clean). Not committed — the session manager commits.

## Resolution — Money-Path Review Follow-up (ROLL sign + mapSide hardening)

root_cause: >
  Two residual defects surfaced by a money-path specialist review of the BUG #2 diff, both
  already anticipated as blind_spots in that round and left unresolved:
  (1) `syncFills.ts`'s ROLL branch signed `closeCredit`/`openDebit` unconditionally
  (`Math.abs(...)` / plain `avgPrice*sumQty`) instead of by `cf.side`/`paired.side` — the
  identical defect class the OPEN/CLOSE fix corrected, just missed in the ROLL branch, so a
  bought-to-close or sold-to-open ROLL leg still corrupted `rollCloseCredit`/`rollOpenDebit`/
  `realizedPnl`/`netAmount`.
  (2) `transactions-adapter.ts`'s `mapSide` silently defaulted an undefined/zero `amount` to
  `"buy"`, fabricating a direction with no real signal instead of surfacing the gap.

fix: >
  Code-complete, fully TDD'd (RED confirmed for the exact predicted reason at every step,
  then restored to GREEN — see Evidence), NOT committed, NOT deployed, NO prod job
  triggered:
  (1) `packages/core/src/journal/application/syncFills.ts` ROLL branch: `closeCredit` now
  `cf.side === "sell" ? cf.avgPrice*cf.sumQty : -(cf.avgPrice*cf.sumQty)`; `openDebit` now
  `paired.side === "sell" ? -(paired.avgPrice*paired.sumQty) : paired.avgPrice*paired.sumQty`
  — mirrors the OPEN/CLOSE convention exactly. The ROLL block's `legBreakdown` JSON
  (`closing.netAmount`/`opening.netAmount`) now derives from these same corrected values
  (`-closeCredit` / `openDebit`) instead of re-deriving with the old unconditional formula.
  `netAmount = openDebit - closeCredit` is unchanged in FORM — only its now-correctly-signed
  inputs changed.
  (2) `packages/adapters/src/schwab/trader/transactions-adapter.ts`: `mapSide(amount, cost)`
  uses `amount`'s sign when defined and nonzero (unchanged, authoritative signal); falls
  back to `cost`'s sign when `amount` is missing/zero (`cost < 0` = bought, `cost > 0` =
  sold — corroborated by the schwab-transactions fixture); returns `null` when neither
  signal is usable. `mapTransaction`'s leg loop now `continue`s (drops the leg) on a `null`
  side instead of pushing a fabricated one — mirrors the existing skip-on-unparseable-symbol
  pattern in the same loop.

  Deliberately NOT touched (per the explicit task scope): the already-approved OPEN/CLOSE
  netting logic (`isClose`/`cf.side`-based `netAmount` at the non-ROLL emit path, and its
  CLOSE-path `closeCredit = -netAmount`) — confirmed via `git diff` to be byte-identical to
  the pre-follow-up state; `recomputeCalendarAmounts` (postgres + memory) — untouched,
  already proven correct and already consuming rollOpenDebit/rollCloseCredit in the exact
  convention this fix now supplies; any contract/HTTP/MCP surface.

verification: >
  Self-verified in dev/test only: `bun run typecheck` clean (tsc --build --force, zero
  errors). `bun run test` (vitest, whole monorepo): 2119/2119 pass (was 2115 before this
  follow-up round — +4 net new tests: 2 ROLL sign-regression tests in `syncFills.test.ts`,
  2 mapSide-hardening tests in `trader-adapter.test.ts`). `bun run lint`: clean (same
  pre-existing boundaries-plugin informational warnings as every prior round, zero errors).
  Every new assertion was confirmed RED (for the exact predicted reason, output captured)
  before being confirmed GREEN. The pre-existing `syncFills.property.test.ts` P3 property
  (300 runs) required updating its own stale "ROLL left unsigned" expected-value
  reconstruction to match the fix — a real counterexample was produced and captured before
  the property was corrected, not silently narrowed. All 8 pre-existing ROLL/CLOSE tests and
  all 26 pre-existing trader-adapter tests pass unchanged (their fixtures never exercised the
  buggy paths). NOT verified against prod data — same standing caveat as BUG #2: this is a
  pure code fix; already-ingested fills.side data for backfilled calendars is not
  retroactively corrected by this change (see the unchanged prod-data blind_spot above).

files_changed:
  - packages/core/src/journal/application/syncFills.ts (ROLL branch: closeCredit/openDebit signed by cf.side/paired.side; legBreakdown reuses corrected values)
  - packages/core/src/journal/application/syncFills.test.ts (+2 tests: ROLL bought-to-close closeCredit sign, ROLL sold-to-open openDebit sign)
  - packages/core/src/journal/application/syncFills.property.test.ts (P3 ROLL expected-value reconstruction updated from stale-unsigned to side-signed, matching the fix)
  - packages/adapters/src/schwab/trader/transactions-adapter.ts (mapSide(amount, cost): cost-sign fallback + null-on-no-signal, leg dropped instead of fabricated)
  - packages/adapters/src/schwab/trader/trader-adapter.test.ts (+2 tests: missing-amount cost fallback, amount+cost both missing → leg dropped)
