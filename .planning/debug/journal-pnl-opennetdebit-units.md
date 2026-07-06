---
slug: journal-pnl-opennetdebit-units
status: resolved
trigger: "Journal P&L shows −$319,850 for calendar 65aac62e (7425P) when real P&L ≈ +$415 — openNetDebit stored in dollars, snapshot formula expects points"
created: 2026-07-05
updated: 2026-07-05T20:30:00-07:00
tdd_mode: true
goal: find_and_fix
resolution: "RESOLVED 2026-07-05, 5 rounds. Deployed + prod-corrected via fix-pnl-reingest (wipe→backfill→rebuild→recompute). All 13 openNetDebit match the user-confirmed oracle (journal-pnl-ground-truth.md), verified live via list_calendars; 65aac62e=closed closedAt 2026-07-01, displayed P&L ~+$415 (was −319850/4050). Root causes in order: (1) openNetDebit dollar-scale at registration; (2) fill netAmount unsigned by buy/sell (round-2, regressed bucketing); (3) real cause: readCalendarLegs classified OPEN/CLOSE from calendar.status not the fill's broker positionEffect (round-4 551de23 + migration 0018); (4) shared-leg fills orphaned → order-anchored resolveFillMatches + order-context read expansion (round-5 5d716a7); (5) closed-status re-derived from events (isCalendarFullyClosed). Remaining minor follow-ups (separate): fee-free vs fee-incl ~$2/leg (commission/fees null); gap rows (spot=0) give pnlOpen=-openNetDebit*100, cosmetic since drawn as breaks + headline uses last-non-gap — see morai-journal-snapshot-data-gaps."
bug_2_trigger: "validate-on-one FAILED after deploy: rebuild-journal on 65aac62e changed open_net_debit 3235 -> 286.47, still wrong (correct: 32.35) — a SECOND, deeper root cause in the same area"
round_3_trigger: "Build ONE tested capability to enable account-wide durable re-ingest of Schwab fills, so already-backfilled calendars' fills.side data (wrong before the round-2 code fix) gets corrected at the source. Code-complete + committed; NOT deployed, NOT run against prod — status stays 'fixing' until the orchestrator executes the run sequence and prod-verifies 65aac62e."
round_4_trigger: "Ground-truth oracle built from real transactions (13 real calendars, journal-pnl-ground-truth.md) exposed a THIRD, still-deeper root cause: the round-2 side-fix, once actually exercised against re-ingested real data, produced openNetDebit ≈ -4 for 65aac62e (registered open) and ≈ 0 for every closed-registered calendar — the OPEN/CLOSE classification itself, not the sign, was wrong. Fix code-complete + committed; NOT deployed, NOT run against prod."
round_5_trigger: "After round 4's re-ingest ran in prod: 11/13 calendars' openNetDebit now match the ground-truth oracle, but 2 (8a63aa81, 6303e6af — a shared-front-leg pair) show BACK-LEG-ONLY debit (the shared leg's fills got orphan-parked as ambiguous), and 65aac62e (registered status open) has a real Jul-1 CLOSE order that never transitioned its status to closed. Two independent bugs, same root pattern (a signal ambiguity resolved by parking/staleness instead of by the real disambiguating broker data): (1) fill-pairing never used the fill's OWN order to disambiguate a leg symbol shared by two calendars; (2) status never re-derived from the calendar's own rebuilt events. Fixed + committed; NOT deployed, NOT run against prod."
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

## Round 3 — account-wide fills-side-correction capability (wipe-derived-fills)

**Trigger:** Round 2's standing blind_spot: the code fix corrects all FUTURE fills ingestion
but does NOT retroactively correct already-backfilled calendars' `fills.side` data (no raw
broker JSON stored — the true sign is unrecoverable from stored fills rows alone). Correcting
65aac62e (and any other already-backfilled calendar) requires deleting the existing derived
rows and re-running `backfill-transactions` against Schwab with the fixed adapter — a
capability that did not exist yet. User approved account-wide re-ingest; this round builds the
missing piece only. Architecture findings pre-verified by the orchestrator (not re-derived):
`fills` has no calendar_id FK (occSymbols are shared across calendars — no clean per-calendar
scope, so the correction is account-wide, not per-calendar); `writeFills` is
`onConflictDoNothing` on the fill id PK (re-running backfill over EXISTING fills is a no-op —
wrong-side rows must be deleted first); `fills`/`calendar_events`/`orphan_fills` are 100%
derived/rebuildable from the Schwab transaction feed; `calendars`/`calendar_snapshots` are NOT
rebuildable this way and must stay untouched.

**Built (TDD red→green at every layer, full command output captured):**
- Core port `ForWipingDerivedFills` (packages/core/.../ports.ts) — account-wide, no
  calendarId, returns `{ fillsDeleted, eventsDeleted, orphansDeleted }`.
- Core use-case `makeWipeDerivedFillsUseCase` (wipeDerivedFills.ts, 3 tests) — thin
  delegation to the port (mirrors architecture-boundaries.md §5's use-case-factory
  requirement even though there is no per-calendar lookup to compose, unlike
  recomputeSnapshotPnl).
- Postgres adapter (postgres/repos/fills.ts): `wipeDerivedFills` wraps all 3 DELETEs
  (calendar_events → orphan_fills → fills, defensive order) in ONE `db.transaction` —
  all-or-nothing, mirrors recomputeSnapshotPnl's money-path atomicity hardening from the
  round-1 specialist review. Verified against REAL Postgres via testcontainers, including a
  postgres-only test that seeds a `calendars` row AND a `calendar_snapshots` row directly and
  proves both survive untouched after a real `wipeDerivedFills()` call (empirical proof, not
  just "by construction" — confirmed no FK/CASCADE exists on any of the 3 tables via both the
  live schema and a migrations grep for `FOREIGN KEY`, zero hits).
- In-memory twin (memory/fills.ts) — same shared contract suite (`__contract__/fills.contract.ts`,
  +3 cases run against BOTH adapters: deletes-and-returns-counts, calendars-untouched,
  idempotent-on-empty), `processedIds` also cleared on wipe for parity (processed_at lives on
  the fill row in real Postgres — gone with it).
- Worker handler (`wipe-derived-fills.ts`, 5 tests) — mirrors sync-fills' full-sweep `{}`
  payload (no calendarId — account-wide) + recompute-snapshot-pnl's "no RTH gate" (on-demand,
  runs anytime).
- Wiring: `contracts/jobs.ts` TRIGGERABLE_JOBS (+1, stays calendarId-optional — no per-job
  refinement needed, unlike rebuild-journal/recompute-snapshot-pnl); `schedule.ts` 14th queue
  (createQueue + work, deliberately NO schedule() call — destructive account-wide op must
  never run on a cron); `main.ts` composition wiring; MCP `trigger_job` description string;
  HTTP `jobs.routes.test.ts` (+1 end-to-end trigger test, TRIGGERABLE_JOBS length 4→5).
  `enqueueJob`'s existing dedupe logic required NO changes — an account-wide job with no
  calendarId already falls into the default `scheduledDedupeKey` (10-min window) branch, which
  is itself a valuable safety property here (prevents a double-trigger storm of this
  destructive op within the same window) — added ONE test documenting this, not a code change.

**Money-path review (self-conducted — no Task/subagent tool available in this session; applied
the same rigor as the round-1/round-2 specialist review passes):**
- Atomicity: confirmed via testcontainers that all 3 deletes commit or roll back together
  (same `db.transaction` pattern already reviewed/approved for recomputeSnapshotPnl).
- No FK/CASCADE risk: empirically confirmed (real Postgres test + migrations grep for
  `FOREIGN KEY` → zero hits) — delete ordering is defensive-only, not correctness-load-bearing
  today.
- Idempotency: a second run on already-empty tables returns `{0,0,0}`, no error (tested).
- Twin parity: the identical shared contract suite passes against both the Postgres adapter
  (real DB) and the in-memory twin (architecture-boundaries.md §8 satisfied, verified not just
  declared).
- No `any`/`as`/`!` introduced (grepped the 4 new/changed production files — clean).
- **Non-blocking risk flagged, not coded around** (documented here + in the handback): the
  overall correction is a TWO-STEP workflow (wipe → re-ingest) that is NOT atomic across the
  step boundary. If `wipe-derived-fills` succeeds but the subsequent `backfill-transactions`
  fails or is interrupted (e.g. Schwab auth expired), the 3 derived tables are left EMPTY until
  backfill is successfully retried — the Journal would show NO trade history for the wiped
  window in the interim. This is an operational sequencing risk inherent to the two-job design
  (not fixable by adding more code to this job — the fix is discipline in the run sequence: do
  not proceed past wipe until backfill's own step confirms success), not a defect in either
  job's own atomicity.

**Verification:** `bun run typecheck` clean (tsc --build --force, zero errors). `bun run lint`
clean (same pre-existing boundaries-plugin informational warnings as every prior round, zero
errors). `bun run test` (vitest, whole monorepo): **2139/2139 pass** (was 2119/2119 before this
round — +20 net new tests: 3 core use-case + 3×2=6 shared fills-contract cases (postgres +
memory) + 1 postgres-only calendars/calendar_snapshots-survive test + 5 worker handler tests +
2 contracts/jobs tests + 1 HTTP route test + 1 enqueueJob dedupe test + 1 schedule.ts queue
test). NOT verified against prod data — no prod job triggered, no deploy performed. Prod
verification (65aac62e converging to openNetDebit ≈ 32.35 / P&L ≈ +$415) is the orchestrator's
post-deploy step, after running the full sequence below.

**files_changed (round 3):**
  - packages/core/src/journal/application/ports.ts (+ForWipingDerivedFills port)
  - packages/core/src/journal/application/wipeDerivedFills.ts (new use-case)
  - packages/core/src/journal/application/wipeDerivedFills.test.ts (new, 3 tests)
  - packages/core/src/journal/index.ts, packages/core/src/index.ts (barrel exports)
  - packages/core/src/journal/application/enqueueJob.test.ts (+1 test, documents existing dedupe behavior — no enqueueJob.ts/dedupe-key.ts code change)
  - packages/adapters/src/postgres/repos/fills.ts (+wipeDerivedFills impl, transaction-wrapped 3-table DELETE)
  - packages/adapters/src/memory/fills.ts (+wipeDerivedFills impl, +countEvents/countOrphans test helpers)
  - packages/adapters/src/__contract__/fills.contract.ts (+3 shared contract tests, +FillsSeedContext.countEvents/countOrphans)
  - packages/adapters/src/postgres/repos/fills.contract.test.ts (wiring + 1 postgres-only calendars/calendar_snapshots-survive test)
  - packages/adapters/src/memory/fills.contract.test.ts (wiring)
  - packages/contracts/src/jobs.ts (+"wipe-derived-fills" to TRIGGERABLE_JOBS, doc comment)
  - packages/contracts/src/jobs.test.ts (+2 tests)
  - apps/server/src/adapters/http/jobs.routes.test.ts (+1 end-to-end trigger test, length 4→5)
  - apps/server/src/adapters/mcp/tools/trigger-job.ts (description string update)
  - apps/worker/src/handlers/wipe-derived-fills.ts (new handler)
  - apps/worker/src/handlers/wipe-derived-fills.test.ts (new, 5 tests)
  - apps/worker/src/schedule.ts, apps/worker/src/schedule.test.ts (14th queue, on-demand only, no cron)
  - apps/worker/src/main.ts (composition wiring)

- next_action: Orchestrator-owned. Run the sequence: (1) deploy worker (new handler + queue
  registration) and server (trigger_job enum gained a 5th job) — code is committed, NOT
  deployed. (2) Trigger `wipe-derived-fills` (account-wide, no payload). (3) Run
  `backfill-transactions <from> <to>` covering the earliest calendar's openedAt (2026-04-16)
  through today, chunked within the Schwab lookback cap (SCHWAB_TX_MAX_RANGE_DAYS per call,
  SCHWAB_TX_LOOKBACK_MAX_DAYS total span guard) — requires a live Schwab trader-app token
  (AUTH_EXPIRED fails the whole backfill, writes nothing, per its own over-cap/all-or-nothing
  guard). (4) Per affected calendarId: `rebuild-journal` then `recompute-snapshot-pnl`. (5)
  Prod-verify 65aac62e: openNetDebit ≈ 32.35, P&L ≈ +$415. Do NOT run any of this from a
  debugger session — this session self-verified in dev/test only.

## Round 4 — classification-from-status root cause (the "-4 / ~0" regression)

**Trigger:** see `round_4_trigger` in frontmatter. The user-confirmed oracle
(`.planning/debug/journal-pnl-ground-truth.md`) gave 13 real calendars' true openNetDebit/
closeNetCredit/realizedPnl, computed independently from `get_transactions`. Prod evidence
after re-ingest: 65aac62e (registered `open`) → openNetDebit ≈ -4 (32.37 open − 36.33 close
folded together); every registered-`closed` calendar → openNetDebit ≈ 0.

### Current Focus — reasoning_checkpoint (written BEFORE the fix)

```yaml
reasoning_checkpoint:
  hypothesis: >
    `readCalendarLegs` (postgres/repos/fills.ts AND memory/fills.ts, byte-identical) derived
    each matched fill's OPEN/CLOSE classification from the CALENDAR's CURRENT `status` column
    (statusToPositionEffect: open->OPENING, closed->CLOSING) — the SAME value for BOTH legs,
    applied uniformly to EVERY fill matching that leg regardless of which real historical
    order it came from. A calendar's status is a single point-in-time snapshot of its LATEST
    known state, not a per-fill signal — so for 65aac62e (status="open"), its real CLOSE
    order's fills ALSO got classified OPEN (4 OPEN events instead of 2 OPEN + 2 CLOSE),
    summing 159.41 - 127.06 - 123.13 + 86.78 = -4.00 exactly. For any calendar registered
    "closed", the inverse happens: its real OPEN order's fills get classified CLOSE, so
    openNetDebit sums to 0 (no OPEN events exist at all) and closeNetCredit becomes the
    NET of both legs (≈ realizedPnl), not the isolated close credit.
  confirming_evidence:
    - "Direct arithmetic match: reproduced the debug session's own evidence numbers exactly by feeding the real 4 fills for 65aac62e (159.41 buy, 127.06 sell, 123.13 sell, 86.78 buy) through a RawFill-level regression test (apps/worker/src/journal-oracle.test.ts) with the calendar registered status='open': observed openNetDebit = -4.00, closeNetCredit = 0 — before any fix, RED for the predicted reason."
    - "packages/core/src/journal/application/syncFills.test.ts's OWN pre-existing journal-e2e.test.ts docstring (written in an earlier round, not by me): 'The memory fills twin derives positionEffect from calendar.status, so we drive OPEN/CLOSE through two separate sync passes against a status flip... the twin can't [classify per real order], so we exercise pairing through the use-case with a custom legs reader' — a prior round had ALREADY discovered this exact limitation and worked around it with hand-rolled test mocks instead of fixing the production code, which is precisely why no existing test caught this: every syncFills.test.ts case supplied positionEffect directly via the MOCKED readCalendarLegs, never through the real status-derivation path."
    - "recomputeCalendarAmounts (both adapters) was independently re-verified UNCHANGED and correct: it sums OPEN events into openDebit and CLOSE events into closeCredit with no cross-contamination — the existing 'nets a bought-to-open leg against a sold-to-open leg' contract test (159.41/-127.06 -> 32.35) still passes untouched. The bug is entirely upstream of recompute, in which EVENT TYPE each fill gets tagged with."
    - "The real broker transaction already carries the true, authoritative, per-leg positionEffect (BrokerTransaction.legs[].positionEffect, parsed correctly by the Schwab adapter, confirmed unchanged/correct) — but syncTransactions.ts's flattenTransaction used it ONLY as a drop-filter (`if (leg.positionEffect === 'UNKNOWN') return`) and then DISCARDED it; RawFill had no positionEffect field to carry it forward at all."
  falsification_test: >
    Built apps/worker/src/journal-oracle.test.ts from REAL Schwab orders (scratchpad/txns.json)
    for 5 real calendars (65aac62e open+close; 9eef2153 and e8bfbf41, two simple closed
    calendars; 60c46a57/24f1e72e, a shared-order pair). Ran it against the PRE-fix code:
    FAILED with openNetDebit = -4.00 for 65aac62e (exact predicted value) before any
    production code changed — confirms the hypothesis, not a tautology. If the bug were
    instead in recomputeCalendarAmounts's summing logic, the failure would NOT reproduce this
    exact -4.00 figure (it would show whatever recompute's OWN bug produces); it reproduced
    the debug session's own prod evidence number precisely.
  fix_rationale: >
    Root-cause fix, not a bandaid: carry the broker's OWN per-fill positionEffect all the way
    through the pipeline — mirrors EXACTLY how round 2 fixed the analogous `side` bug (do not
    re-derive a signal from mutable app state; read it once from the broker and thread it
    through). RawFill gains `positionEffect` (calendar-event.ts); syncTransactions.ts's
    flattenTransaction now includes it instead of discarding it; aggregatePartialFills reads
    it off the bucket's own fills (`first.positionEffect`) instead of accepting an externally
    supplied value; syncFills.ts stops passing `leg.positionEffect` (removed from
    CalendarLegEntry entirely — it now exists ONLY to resolve which calendar a fill's OCC
    symbol belongs to); the fills table gains an additive-nullable `position_effect` column
    (migration 0018) so it survives round-trips through Postgres, with a safe "UNKNOWN"
    fallback (orphan-parks, never fabricates a classification) for any pre-migration row.
    recomputeCalendarAmounts is UNTOUCHED — it was never the bug once its true input
    (correctly-classified calendar_events) is correct.

    Authoritative-sign principle applied: this is a re-derivation bug in the SAME family as
    round 2's (a signal was thrown away and re-inferred from the wrong source — here,
    calendar.status instead of positionEffect; there, positionEffect instead of the broker's
    signed amount). The fix reduces total sign/classification-inference surface to ONE point
    (the Schwab adapter boundary) for BOTH signals (side AND positionEffect) — nothing
    downstream re-derives either one from calendar state ever again.
  blind_spots: >
    The 60c46a57/24f1e72e "roll pair" the orchestrator flagged turned out, on inspection of
    the real order legs, to NOT be a domain ROLL at all: the two calendars have DIFFERENT
    strikes (7425 vs 7475), and `detectRoll` requires the SAME calendarId (D-03) — so the
    WR-A1 rollOpenDebit/rollCloseCredit split never fires here; the shared broker order
    (1006797510202) simply produces two ordinary CLOSE events (60c46a57) and two ordinary
    OPEN events (24f1e72e) sharing one orderId across two different calendars. This is
    verified explicitly in journal-oracle.test.ts (asserts every event is OPEN/CLOSE, never
    ROLL, and both calendars' amounts are correct in isolation) — but it means the ONE actual
    same-calendar ROLL code path (WR-A1 split, fixed in round 2's money-path-review
    follow-up) has NOT been re-exercised against real multi-leg roll data in this round; it
    remains covered only by the synthetic syncFills.test.ts ROLL cases and the P3/P4
    fast-check properties (real per-fill positionEffect now, not a whole-run-constant).

    The code fix corrects classification for ALL FUTURE fills ingestion (and any calendar
    whose fills get re-ingested). It does NOT retroactively fix already-ingested fills rows'
    position_effect column (NULL, falls back to UNKNOWN, which orphan-parks rather than
    misclassifying — safe, but means a bare `rebuild-journal` on already-backfilled prod data
    would NOT converge without a fresh re-ingest, since the stored fills predate this column).
    Correcting prod requires the SAME re-ingest sequence round 3 already built
    (wipe-derived-fills -> backfill-transactions -> per-calendar rebuild-journal ->
    recompute-snapshot-pnl) — this round changes what that re-ingest produces, not whether
    it's still required.
```

### Evidence

- timestamp: 2026-07-05 — read `.planning/debug/journal-pnl-ground-truth.md` in full: 13 real
  calendars' oracle openNetDebit/closeNetCredit/realizedPnl computed from `get_transactions`'
  authoritative signed netAmount. Cross-referenced against `scratchpad/txns.json` (raw Schwab
  order data) for 65aac62e, 9eef2153, e8bfbf41, 60c46a57, 24f1e72e — every order/leg/price
  traced and independently re-derived (fee-free, avgPrice×qty convention, matching what
  syncFills.ts actually computes — commission/fees are always NULL in this pipeline, a
  separate pre-existing gap, NOT touched this round; the oracle's fee-inclusive figures differ
  by ~2 cents/leg, exactly as the objective's own text anticipated).
- timestamp: 2026-07-05 — read `packages/adapters/src/postgres/repos/fills.ts`
  `readCalendarLegs`/`statusToPositionEffect` and the byte-identical `memory/fills.ts`
  implementation: both derive `CalendarLegEntry.positionEffect` from `calendar.status`
  (open->OPENING, closed->CLOSING), uniformly for both legs, independent of which fill/order
  is being matched. This is the exact function `syncFills.ts`'s `pairFills` uses to classify
  every fill's aggregate bucket.
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/syncTransactions.ts`
  `flattenTransaction`: `if (leg.positionEffect === "UNKNOWN") return;` — the broker's REAL
  per-leg positionEffect is read, used only as a drop-filter, then discarded; `RawFill` had no
  field to carry it further.
- timestamp: 2026-07-05 — built `apps/worker/src/journal-oracle.test.ts` from the real Schwab
  orders (verbatim activityId/orderId/legs from `scratchpad/txns.json`) for 5 real calendars.
  RAN AGAINST THE PRE-FIX CODE: FAILED with `openNetDebit = -4.00` for 65aac62e (calendar
  registered status="open") — the EXACT prod regression figure from the ground-truth doc,
  confirmed via a debug dump of the 4 stored events: all 4 classified `eventType: "OPEN"`
  (159.41, -127.06, -123.13, 86.78 -> sum -4.00). This is TDD RED, confirmed for the right
  reason, before any production code changed.
- timestamp: 2026-07-05 — implemented the fix (RawFill gains `positionEffect`; carried through
  `syncTransactions.ts` instead of discarded; `aggregatePartialFills` reads it off the
  bucket's own fills instead of an externally supplied leg-derived value; `CalendarLegEntry`
  loses the field entirely — it now exists purely to resolve calendarId/legOccSymbol matching;
  Postgres `fills` table gains additive-nullable `position_effect` (migration 0018,
  `bunx drizzle-kit generate`); `mapFillRow` falls back to `"UNKNOWN"` on NULL, never
  fabricating OPENING/CLOSING; `memory/fills.ts`'s `statusToPositionEffect` removed —
  `writeFills` already stores the whole RawFill object, so the twin needed zero storage
  changes, only the `readCalendarLegs` leg-matching function). Re-ran `journal-oracle.test.ts`:
  GREEN — all 5 real calendars' openNetDebit/closeNetCredit match the independently-derived
  fee-free expected values exactly (within `toBeCloseTo(x, 2)`), and no spurious ROLL event
  is created across the 60c46a57/24f1e72e shared-order pair (verified 4 events per calendar,
  all OPEN/CLOSE, zero ROLL).
- timestamp: 2026-07-05 — mechanical fallout across the test suite (every RawFill/
  CalendarLegEntry/aggregatePartialFills construction site in the monorepo): `fill-pairing.ts`
  (signature drops the external `positionEffect` param), `fill-pairing.test.ts` (+2 new tests:
  positionEffect propagates OPENING/CLOSING from the bucket's own fills, mirroring the
  existing side-propagation tests), `syncFills.test.ts` (`makeFill` default `positionEffect:
  "OPENING"`; every CLOSING/UNKNOWN test case moved its classification signal from the mocked
  `legMap` onto the fill fixture itself — 8 CLOSING + 2 UNKNOWN overrides, mechanically
  verified against the pre-edit test file), `syncFills.property.test.ts` (rewrote the
  generator: `FillSpec` gained its own per-fill `positionEffect` instead of a whole-run
  `frontStatus`/`backStatus` constant that could never model a real calendar's lifecycle — the
  property's own prior docstring admitted this limitation explicitly; P3's ROLL
  reconstruction now reads `e.legOccSymbol`/`e.rolledFromOccSymbol` — the event's own
  authoritative role signal — instead of the removed per-run status; added P4, a NEW property
  directly encoding the regressed invariant: openNetDebit is unchanged by adding CLOSING fills
  to an already-OPENED leg, and their economics land only in closeNetCredit), `
  syncTransactions.test.ts` (+3 assertions: positionEffect round-trips through
  `flattenTransaction` unchanged), `__contract__/fills.contract.ts` (`makeFill` default
  `positionEffect: "OPENING"`; +1 round-trip test through `writeFills`/
  `readUnprocessedFills`; the obsolete "maps closed-calendar legs to CLOSING positionEffect"
  test — which tested behavior this fix REMOVES — replaced with "resolves the same
  (calendarId, legOccSymbol) regardless of calendar status", the direct positive proof of the
  fix run against BOTH Postgres (testcontainers) and the in-memory twin).
- timestamp: 2026-07-05 — full verification: `bun run typecheck` clean (tsc --build --force,
  zero errors). `bun run test` (vitest, whole monorepo, including Postgres testcontainers
  suites — Docker available in this session): **2145/2145 pass** (was 2139/2139 before this
  round — +6 net: 1 real-transaction oracle e2e test, 2 fill-pairing propagation tests, 1 P4
  fast-check property, 1 contract writeFills round-trip test, 1 contract status-independence
  test, minus 1 removed obsolete contract test whose asserted behavior this fix eliminates).
  `bun run lint`: clean (same pre-existing boundaries-plugin informational warnings as every
  prior round, zero errors). Grepped the full diff for `any`/`as`/`!` in every changed
  production file: zero introduced (only prose comments containing the word "as").
- timestamp: 2026-07-05 — self-conducted money-path review (no Task/subagent tool available in
  this session, same constraint as round 3): (1) atomicity — no new multi-step writes
  introduced; `writeFills` remains a single INSERT (position_effect column added to the same
  statement, not a second write); `recomputeCalendarAmounts` untouched. (2) migration safety —
  additive nullable column, matches the project's own documented precedent (`calendar_
  snapshots.trigger`, migration 0016); no NOT NULL constraint, no backfill, confirmed
  non-destructive. (3) twin parity — `memory/fills.ts`'s `writeFills` already persists the
  whole `RawFill` object verbatim (no field-by-field mapping layer), so `positionEffect`
  flows through with ZERO storage-layer changes to the twin; only its `readCalendarLegs`
  needed the dead `statusToPositionEffect` removed, mirroring the Postgres adapter exactly —
  proven identical via the shared `fills.contract.ts` suite passing on both. (4) no FK/CASCADE
  risk — this fix touches no foreign-key relationships. (5) fallback safety — a NULL/legacy
  `position_effect` value maps to `"UNKNOWN"`, which routes through the EXISTING
  `classifyFill` UNKNOWN branch (orphan-parked, WR-01 "never a wrong number" convention) —
  never silently fabricates OPEN or CLOSE.

## Resolution — Round 4 (classification-from-status root cause)

root_cause: >
  `calendars.open_net_debit`/`close_net_credit` came out wrong (≈ -4 for calendars registered
  `open`; ≈ 0 for calendars registered `closed`) because `readCalendarLegs`
  (postgres/repos/fills.ts and memory/fills.ts) derived every matched fill's OPEN/CLOSE
  classification from the CALENDAR's CURRENT `status` column — a single, mutable,
  point-in-time value applied uniformly to EVERY fill matching that calendar's legs,
  regardless of which real historical order (open or close) the fill actually came from. A
  calendar's `status` reflects its LATEST known state, not what a historical fill's role was
  at trade time. The real, authoritative per-fill positionEffect (BrokerTransaction.
  legs[].positionEffect, parsed correctly by the Schwab adapter) was available at the exact
  point `syncTransactions.ts`'s `flattenTransaction` ingested each fill — but was used only as
  a drop-filter (UNKNOWN legs skipped) and then discarded; `RawFill` had no field to carry it
  forward, so `syncFills.ts` had no choice but to re-derive classification from the calendar's
  status at pairing time, which is exactly where the round-2 side-fix's re-ingest first
  exercised this pre-existing, previously-latent bug.

fix: >
  Code-complete, fully TDD'd (RED confirmed with the EXACT real-data regression figure -4.00
  before any production code changed, then GREEN after — see Evidence), COMMITTED (see commit
  SHAs in the handback), NOT deployed, NO prod job triggered:
  (1) `RawFill` (calendar-event.ts) gains `positionEffect: "OPENING"|"CLOSING"|"UNKNOWN"` —
  the broker's own per-fill role, carried through instead of discarded.
  (2) `syncTransactions.ts`'s `flattenTransaction` includes it on every emitted RawFill.
  (3) `aggregatePartialFills` (fill-pairing.ts) reads `positionEffect` off the bucket's first
  fill instead of accepting it as an externally-supplied parameter — mirrors exactly how
  round 2 already handled `side`.
  (4) `CalendarLegEntry` (ports.ts) loses `positionEffect` entirely — it now exists purely to
  resolve WHICH calendar a fill's OCC symbol belongs to (calendarId + legOccSymbol); `
  readCalendarLegs` (both adapters) no longer touches `calendar.status` for this purpose at
  all, and the dead `statusToPositionEffect` helper is removed from both.
  (5) `packages/adapters/src/postgres/schema.ts` + migration 0018 (additive nullable
  `position_effect` varchar(8) on `fills`); `mapFillRow` falls back to `"UNKNOWN"` on NULL
  (pre-migration rows) — never fabricates a classification, safely orphan-parks instead.
  Deliberately NOT touched: `recomputeCalendarAmounts` (postgres + memory, byte-identical) —
  proven correct as-is; its bug-free WR-A1 sum-by-eventType rule was always operating on
  mis-tagged INPUT events, not mis-summing correctly-tagged ones. The ROLL branch's
  rollOpenDebit/rollCloseCredit split (round 2's money-path-review follow-up) — untouched,
  unaffected; the 60c46a57/24f1e72e pair this round tested turned out not to exercise it at
  all (different strikes → different calendars → not a domain ROLL, see blind_spots).

verification: >
  Self-verified in dev/test only: `bun run typecheck` clean. `bun run test` (vitest, whole
  monorepo, INCLUDING Postgres testcontainers suites — Docker was available and used this
  session): 2145/2145 pass (was 2139/2139 before this round). `bun run lint` clean. The
  centerpiece: `apps/worker/src/journal-oracle.test.ts`, built entirely from real Schwab order
  data for 5 real calendars (65aac62e open+close; 9eef2153 and e8bfbf41, two simple closed
  calendars; 60c46a57/24f1e72e, a shared-broker-order pair proven NOT to be a domain ROLL) —
  every calendar's openNetDebit/closeNetCredit matches its independently fee-free-derived
  expected value, confirmed RED (openNetDebit=-4.00 for 65aac62e, the exact prod figure)
  before the fix and GREEN after. A new fast-check property (P4, 300 runs) directly encodes
  the regressed invariant: openNetDebit is unchanged by adding CLOSING fills to an
  already-OPENED leg. NOT verified against prod data — no prod job triggered, no deploy
  performed. This is the fourth round to reach "self-verified in dev/test, root cause found
  and fixed with real-transaction TDD coverage" — prod verification remains the orchestrator's
  post-deploy step (see the handback's prod-correction guidance).

files_changed:
  - packages/core/src/journal/domain/calendar-event.ts (+positionEffect on RawFill)
  - packages/core/src/journal/domain/fill-pairing.ts (aggregatePartialFills reads positionEffect off the bucket's own fills, not an external param)
  - packages/core/src/journal/domain/fill-pairing.test.ts (+2 tests: positionEffect propagation OPENING/CLOSING; all existing calls updated to the 2-arg signature)
  - packages/core/src/journal/application/ports.ts (CalendarLegEntry loses positionEffect)
  - packages/core/src/journal/application/syncFills.ts (pairFills stops supplying leg.positionEffect to aggregatePartialFills)
  - packages/core/src/journal/application/syncFills.test.ts (classification signal moved from mocked legMap onto fill fixtures; 8 CLOSING + 2 UNKNOWN overrides)
  - packages/core/src/journal/application/syncFills.property.test.ts (FillSpec gains per-fill positionEffect, replacing the whole-run frontStatus/backStatus constant; P3 ROLL reconstruction reads legOccSymbol/rolledFromOccSymbol; +P4 property)
  - packages/core/src/journal/application/syncTransactions.ts (flattenTransaction carries positionEffect onto RawFill instead of discarding it)
  - packages/core/src/journal/application/syncTransactions.test.ts (+3 assertions: positionEffect round-trips)
  - packages/adapters/src/postgres/schema.ts (+position_effect column, additive nullable)
  - packages/adapters/src/postgres/migrations/0018_fills_position_effect.sql (new migration)
  - packages/adapters/src/postgres/migrations/meta/0018_snapshot.json, meta/_journal.json (drizzle-kit generated)
  - packages/adapters/src/postgres/repos/fills.ts (mapFillRow/writeFills persist positionEffect; readCalendarLegs/statusToPositionEffect removed)
  - packages/adapters/src/memory/fills.ts (readCalendarLegs/statusToPositionEffect removed — writeFills needed no change, already stores the whole RawFill)
  - packages/adapters/src/__contract__/fills.contract.ts (makeFill default positionEffect; +1 writeFills round-trip test; obsolete status->positionEffect test replaced with a status-independence test)
  - apps/worker/src/journal-oracle.test.ts (new — real-transaction oracle regression suite, 5 real calendars)
  - docs/architecture/data-model.md (+position_effect column documentation)

- next_action: Orchestrator-owned. (1) Review/merge this fix. (2) Deploy worker + server (no
  new job/route surface this round — pure fill-classification fix, no schema-visible API
  change beyond the additive migration). (3) Run the migration (`bun run migrate` picks up
  0018 automatically). (4) Re-run the SAME round-3 correction sequence
  (`wipe-derived-fills` -> `backfill-transactions <from> <to>` -> per-calendar
  `rebuild-journal` -> `recompute-snapshot-pnl`) — this round's fix changes what that sequence
  PRODUCES (correct classification), not whether it's still required (already-ingested fills
  rows predate the position_effect column and fall back to UNKNOWN/orphan-parked without a
  fresh re-ingest). (5) Prod-verify against the ground-truth oracle: 65aac62e openNetDebit ≈
  32.35-32.37, all 13 real calendars' openNetDebit/closeNetCredit within a few cents of
  `.planning/debug/journal-pnl-ground-truth.md`. Do NOT run any of this from a debugger
  session — this session self-verified in dev/test only (2145/2145 tests green, typecheck
  clean, lint clean, testcontainers-verified against real Postgres).

## Round 5 — shared-leg attribution (bug 1) + closed-status transition (bug 2)

**Trigger:** see `round_5_trigger` in frontmatter. After round 4's fix ran against prod
(via `fix-pnl-reingest`), 11/13 real calendars now match `.planning/debug/journal-pnl-ground-truth.md`.
2 fail (8a63aa81, 6303e6af) — a pair sharing the SAME front-month contract (SPXW
260618P07275000) — and 65aac62e (registered `open`) never transitioned to `closed` despite a
real Jul-1 CLOSE order fully unwinding both legs.

### Current Focus — reasoning_checkpoint (written BEFORE the fix)

```yaml
reasoning_checkpoint:
  hypothesis: >
    BUG 1: readCalendarLegs returns 2 candidate calendars for any fill on occSymbol
    260618P07275000 (8a63aa81's front leg AND 6303e6af's front leg — the same real contract,
    opened at different times). syncFills.ts's pairFills orphan-parked EVERY such ambiguous
    fill outright (Pitfall 6's "never auto-assign") — so both calendars kept only their
    UNIQUE back leg, producing a back-leg-only debit (e.g. 8a63aa81 showed 62.50 instead of
    62.50−52.30=10.20). The disambiguating signal exists but was never used: each calendar's
    real OPENING/CLOSING broker order contains BOTH its legs together, so the order's OTHER
    (unambiguous) leg identifies which calendar the ambiguous leg belongs to.

    BUG 2: calendars.status is a manually-registered, mutable column that nothing in the
    event-processing pipeline ever re-derives from the calendar's OWN rebuilt events. A
    calendar whose real CLOSE order fully closes both legs (net qty back to zero) has no
    code path that flips status open->closed — it stays wrong forever unless someone
    hand-edits it (a "no hand-edit trade history" violation this project already forbids).
  confirming_evidence:
    - "readCalendarLegs (memory + postgres, byte-identical) computes each calendar's front/back OCC symbols independently and pushes a CalendarLegEntry whenever either matches the queried occSymbol — for 260618P07275000 this returns [{8a63aa81,...},{6303e6af,...}], confirmed by direct calls in the new fill-pairing contract test (readCalendarLegs — order-context expansion section) and by re-deriving both calendars' real order data from scratchpad/txns.json: order 1006681717677 (Jun 9) opens 8a63aa81 with back=260623P07275000@62.50 + front=260618P07275000@52.30; order 1006417446601 (May 19) opens 6303e6af with back=260717P07275000@128.90 + front=260618P07275000@82.90 (the SAME front occSymbol string, different order)."
    - "syncFills.ts pairFills (pre-fix): `if (legs.length > 1) { ...orphan 'ambiguous calendar'... }` — unconditional, no attempt to use orderId to disambiguate, confirmed by reading the pre-fix code in full."
    - "BUG 2: grepped every write path to calendars.status — only registerCalendar (sets 'open' at creation) and closeCalendar (CAL-04, a MANUAL user-initiated HTTP action with a user-supplied closeNetCredit) ever change it. Neither syncFills.ts nor rebuildJournal.ts nor recomputeCalendarAmounts touches status. Confirmed by reading all three files in full."
    - "CalendarEvent.qty is the aggregated per-leg quantity (D-04); OPEN increases a leg's net position, CLOSE decreases it — a calendar with events but zero net qty on every touched leg has objectively been fully closed by real trades, independent of what its stale status column says."
  falsification_test: >
    Extended apps/worker/src/journal-oracle.test.ts to all 13 real calendars (Test A). RAN
    AGAINST THE PRE-FIX CODE: FAILED — 8a63aa81/6303e6af showed back-leg-only openNetDebit
    (e.g. 62.50 instead of 10.20) and 2 fills each landed in orphan_fills with reason
    "ambiguous calendar", confirming BUG 1 exactly as predicted. A separate integration test
    (Test C) run against the REAL per-calendar rebuild-journal mechanism (the one
    fix-pnl-reingest.ts actually uses, not the full sweep) additionally exposed a SECOND,
    more subtle failure: even with resolveFillMatches implemented, the scoped rebuild orphaned
    the sibling calendar's fills whenever it ran SECOND, because resetFillsProcessedForCalendar
    only reset fills matching ITS OWN calendar's legs — a fill already marked processed by the
    FIRST calendar's rebuild pass (as order-context) never got reset, so it silently vanished
    from every subsequent read. This was caught BEFORE being missed: Test C failed RED with 2
    orphans before the resetFillsProcessedForCalendar fix, GREEN after. For BUG 2, a fresh test
    (Test B) with 65aac62e seeded status="open" and a real Jul-1 CLOSE order: FAILED (status
    stayed "open") before the fix, GREEN after (status "closed", closedAt "2026-07-01").
  fix_rationale: >
    BUG 1 fixed at the disambiguation layer, not by guessing: `resolveFillMatches` (new pure
    domain fn, fill-pairing.ts) groups candidate-fills by orderId; any leg matching EXACTLY
    ONE calendar within an order is an "anchor" for that whole order; an ambiguous fill is
    resolved to its order's anchor ONLY if unique, else it stays ambiguous (never guessed,
    preserves D-05/WR-01). This alone is insufficient for the calendar-SCOPED rebuild path
    (the actual prod mechanism, fix-pnl-reingest.ts) because a scoped read only pulls fills
    matching ONE calendar's own legs — so `readUnprocessedFillsForCalendar` (both adapters)
    now ALSO includes "order context" fills (any fill sharing an orderId with a leg-matched
    fill, even if its own symbol isn't this calendar's leg) so the anchor is always present
    regardless of which calendar is rebuilt first. `resetFillsProcessedForCalendar` needed the
    IDENTICAL expansion (symmetric with the read) — otherwise a context fill already processed
    by a sibling's earlier rebuild never gets un-marked and silently disappears forever.

    BUG 2 fixed at the event-processing path itself (not a separate job): `isCalendarFullyClosed`
    (new pure domain fn) computes net qty per leg from a calendar's rebuilt events (OPEN
    +qty, CLOSE −qty, ROLL moves qty between the old/new leg); if every touched leg nets to
    zero, `syncFills.ts`'s pairFills (shared by full-sweep AND scoped-rebuild) calls a NEW
    port `ForTransitioningCalendarClosed` with closedAt = the REAL close date (max filledAt
    among this run's own CLOSE fills for that calendar — never `now()`, since a rebuild can
    run long after the real close). The transition is idempotent (no-op if already closed)
    so re-running a rebuild never overwrites an already-correct closedAt.
  blind_spots: >
    Both fixes are scoped to the EXACT shape of data evidenced in the 13 real calendars (one
    shared leg between exactly 2 calendars; no calendar closes via a ROLL). The order-context
    expansion is deliberately one-hop (a context fill's OWN further order-context is not
    transitively expanded) — sufficient for the evidenced case, not proven for a hypothetical
    3-calendar chain sharing legs pairwise. isCalendarFullyClosed's closedAt derivation only
    sets a date when a plain CLOSE event was processed in the SAME run; if a calendar closes
    purely via a ROLL with no separate CLOSE processed in that pass, the transition is skipped
    (safe — status stays whatever it was — but not exercised by any of the 13 real calendars).
    The still-standing, unrelated, OUT-OF-SCOPE gaps from prior rounds are unchanged: the
    ~$1-2/leg fee-free vs fee-inclusive gap, and the separate gap-snapshot (spot=0/NaN) issue.
```

### Evidence

- timestamp: 2026-07-05 — read `.planning/debug/journal-pnl-ground-truth.md` and cross-referenced
  `scratchpad/txns.json` for the 2 failing calendars: confirmed 8a63aa81 (7275P Jun18/Jun23) and
  6303e6af (7275P Jun18/Jul17) share the exact front-leg contract 260618P07275000 across FOUR
  distinct broker orders (2 opens, 2 closes) — 8a63aa81's own open order 1006681717677 (Jun 9)
  and close order 1006687566650 (Jun 10); 6303e6af's own open order 1006417446601 (May 19) and
  close order 1006622444775 (Jun 5). Independently derived all 13 calendars' fee-free
  openNetDebit/closeNetCredit from raw order/leg prices — matches the task's authoritative
  fee-free figures exactly for all 13.
- timestamp: 2026-07-05 — read `packages/core/src/journal/application/syncFills.ts` `pairFills`
  in full: confirmed the pre-fix ambiguous-fill branch orphan-parks unconditionally, with no
  attempt to use `fill.orderId` (already present on every `RawFill`) to disambiguate.
- timestamp: 2026-07-05 — read `packages/adapters/src/{postgres,memory}/repos/fills.ts`'s
  `readUnprocessedFillsForCalendar`/`resetFillsProcessedForCalendar` in full: both scope
  strictly to the target calendar's own 2 leg symbols — confirmed neither has any mechanism to
  surface a sibling calendar's leg from a shared order.
- timestamp: 2026-07-05 — grepped every write site of `calendars.status`: only
  `registerCalendar` (open) and the manual `closeCalendar` (CAL-04 HTTP route) — confirmed no
  automatic re-derivation from a calendar's own event history exists anywhere in the codebase.
- timestamp: 2026-07-05 — TDD RED->GREEN, pure domain layer (`fill-pairing.test.ts`, 23 new
  tests): `resolveFillMatches` (single/zero/ambiguous-with-anchor/ambiguous-without-anchor/
  two-conflicting-anchors cases) and `isCalendarFullyClosed` (no events/still-open/single-leg
  closed/both-legs-closed/ROLL-partial/ROLL-then-closed cases) — all written and run RED
  (functions did not exist) before implementation, GREEN after.
- timestamp: 2026-07-05 — implemented `resolveFillMatches` (fill-pairing.ts) and wired it into
  `syncFills.ts`'s `pairFills`, replacing the old immediate per-fill ambiguity check with a
  two-pass resolve (collect all candidates, then resolve using order anchors).
- timestamp: 2026-07-05 — extended `apps/worker/src/journal-oracle.test.ts` to all 13 real
  calendars (Test A, full-sweep). RAN AGAINST THE PRE-FIX CODE (resolveFillMatches implemented,
  read/reset expansion NOT yet): FAILED as predicted for the 2 shared-leg calendars specifically
  via the full-sweep path (the full sweep alone, having every fill in one batch, actually passed
  once resolveFillMatches existed — the deeper scoped-rebuild bug below required a SEPARATE test
  to surface).
- timestamp: 2026-07-05 — added Test C (`journal-oracle.test.ts`): exercises the REAL production
  mechanism — `makeRebuildJournalUseCase` + `makeSyncFillsForCalendarUseCase` (calendar-SCOPED,
  exactly what `fix-pnl-reingest.ts` calls per calendar) — run in `fix-pnl-reingest`'s actual
  processing order (`listCalendars` desc by `openedAt`: 8a63aa81 opened Jun 9 sorts before
  6303e6af, opened May 19). RAN: FAILED with 2 orphans (8a63aa81's own front-leg fills, orphaned
  during 6303e6af's SECOND rebuild pass) — confirmed the scoped-read context-expansion alone was
  insufficient; `resetFillsProcessedForCalendar` needed the identical expansion. Debugged via
  direct inspection of `readUnprocessedFillsForCalendar`'s returned batch and `readCalendarLegs`
  responses at each step (temporary debug logging, removed after root cause confirmed) — traced
  to: fills already marked processed by calendar A's earlier rebuild pass are never reset by
  calendar B's `resetFillsProcessedForCalendar` (which only resets fills matching B's OWN legs),
  so they never reappear as order-context for B's own read.
- timestamp: 2026-07-05 — implemented the `readUnprocessedFillsForCalendar` + matching
  `resetFillsProcessedForCalendar` order-context expansion in BOTH adapters (postgres + memory).
  Added 4 new shared contract tests (`fills.contract.ts`, run against both Postgres via
  testcontainers and the in-memory twin) proving: (1) a sibling calendar's unique-leg fill is
  included as context when it shares an order with a leg-matched shared-symbol fill; (2) no
  context leak for an unrelated order; (3) `resetFillsProcessedForCalendar` resets an
  already-processed sibling fill needed as context; (4) it does NOT reset an unrelated fill on a
  different order. Fixed one PRE-EXISTING contract test whose fixture accidentally shared the
  default `orderId` across an unrelated foreign-leg fill (a fixture-collision false regression,
  not a real bug — gave it a distinct orderId to preserve its original intent).
- timestamp: 2026-07-05 — re-ran Test C: GREEN. Both calendars converge to their correct
  openNetDebit/closeNetCredit regardless of processing order; zero orphans; idempotent on a
  second rebuild of the same calendar.
- timestamp: 2026-07-05 — implemented BUG 2: added `ForTransitioningCalendarClosed` port
  (distinct from the existing user-initiated `ForClosingCalendar`/CAL-04 — this one takes a
  real historical `closedAt`, not "now"), implemented in both calendars adapters (idempotent —
  no-op if already closed or calendarId unknown), added 4 new shared contract tests
  (`calendars.contract.ts`, both adapters): transitions open->closed with the given closedAt;
  idempotent no-op on an already-closed calendar (does NOT overwrite its existing closedAt);
  safe no-op on an unknown calendarId; a genuinely-open calendar is unaffected when the port is
  never called. Wired `isCalendarFullyClosed` + the new port into `syncFills.ts`'s pairFills
  (after the emission loop): for every calendarId touched in the current run, re-reads its
  events, checks full closure, and — only if a CLOSE was processed in THIS run (so a real
  closedAt is available) — calls the transition port.
- timestamp: 2026-07-05 — added Test B (`journal-oracle.test.ts`): seeds all 13 real calendars
  (65aac62e as the real registered "open", the other 12 as "closed" with a sentinel closedAt to
  prove no-op idempotency) plus a synthetic 14th "genuinely still open" calendar (OPEN order
  only, no close). RAN AGAINST THE PRE-FIX CODE: FAILED (65aac62e stayed "open"). Fixed: GREEN —
  65aac62e transitions to "closed" with `closedAt` = "2026-07-01" (the real close order's trade
  date, not the test's `now()`); the other 12 remain "closed" with their SENTINEL closedAt
  completely unchanged (proves the no-op, not just "still closed"); the synthetic 14th stays
  "open"; re-running the sync a second time is still idempotent.
- timestamp: 2026-07-05 — mechanical fallout: `transitionCalendarClosed` added to `PairingDeps`
  (shared by `SyncFillsDeps`/`SyncFillsForCalendarDeps`) — every construction site updated:
  `syncFills.test.ts` (5 spots), `syncFills.property.test.ts` (1), `journal-e2e.test.ts` (3),
  `apps/worker/src/main.ts` (2, wired to the real `calendarsRepo.transitionCalendarClosed`),
  `apps/worker/src/fix-pnl-reingest.ts` (1, same wiring — so the NEXT time this script runs,
  bug 2's fix applies automatically, no separate step).
- timestamp: 2026-07-05 — full re-verification: `bun run typecheck` clean (tsc --build --force,
  zero errors). `bun run test` (vitest, whole monorepo, INCLUDING Postgres testcontainers
  suites): **2178/2178 pass** (was 2145/2145 before this round — +33 net new tests). `bun run
  lint` clean (same pre-existing boundaries-plugin informational warnings as every prior round,
  zero errors). Grepped the full diff for `any`/`as`/`!` in every changed production file: zero
  introduced.
- timestamp: 2026-07-05 — self-conducted money-path review (no Task/subagent tool available in
  this session, same constraint as rounds 3/4): (1) atomicity — `transitionCalendarClosed` is a
  single UPDATE (postgres), no new multi-step writes; `resolveFillMatches`/order-context
  expansion are pure reads plus the existing single-statement UPDATE/reset paths, unchanged
  transactional shape. (2) idempotency — proven via contract tests (both adapters) and
  journal-oracle Test B/C's explicit re-run assertions. (3) twin parity — the identical shared
  contract suites (`fills.contract.ts`, `calendars.contract.ts`) pass against BOTH Postgres
  (testcontainers) and the in-memory twin for every new behavior. (4) no FK/CASCADE risk — no
  schema change this round, no migration. (5) blast radius — order-context expansion only
  activates when a leg symbol is genuinely shared across calendars (rare — evidenced exactly
  once in 13 real calendars) or when fills happen to share a coincidental orderId (the one
  pre-existing test fixture collision found and fixed); no behavior change for the other 12
  calendars' own rebuild path, confirmed by Test A's full-13 regression coverage.

## Resolution — Round 5 (shared-leg attribution + closed-status transition)

root_cause: >
  BUG 1: `readCalendarLegs` correctly returns every calendar whose leg matches a queried OCC
  symbol — including BOTH calendars when a contract (e.g. 260618P07275000) is genuinely reused
  across two calendar spreads opened at different times. `syncFills.ts`'s fill-matching step
  treated any 2+-candidate match as unconditionally ambiguous and orphan-parked it, even though
  each calendar's own broker order (containing its OTHER, unambiguous leg) already carries the
  real disambiguating signal. This silently dropped one calendar's shared-leg economics,
  producing a back-leg-only debit for BOTH 8a63aa81 and 6303e6af.

  BUG 2: `calendars.status` is written once at registration and only ever changed by a
  user-initiated manual close (CAL-04) — nothing in the automated fill-processing pipeline
  re-derives it from the calendar's own rebuilt event history. 65aac62e's real Jul-1 CLOSE
  order fully unwound both legs, but its `status` column never caught up, so downstream
  consumers (snapshot-calendars, the journal masthead) kept treating it as an open, live
  position long after it was actually closed.

fix: >
  Code-complete, fully TDD'd (RED confirmed for the exact predicted reason at every layer —
  pure domain functions, both adapters' contract tests, and the real-mechanism integration test
  — then GREEN after each fix, see Evidence), COMMITTED (see commit SHAs in the handback), NOT
  deployed, NO prod job triggered:
  (1) `resolveFillMatches` (new pure fn, `fill-pairing.ts`): disambiguates an ambiguous fill
  using its OWN broker order — an unambiguous "anchor" leg in the same order identifies the
  calendar; never guesses when no unique anchor exists (D-05/WR-01 preserved).
  (2) `syncFills.ts`'s `pairFills`: replaced the immediate per-fill ambiguity check with a
  two-pass resolve using `resolveFillMatches`.
  (3) `readUnprocessedFillsForCalendar` (postgres + memory): expanded to include "order
  context" fills — any fill sharing an orderId with a leg-matched fill, even if its own symbol
  isn't this calendar's own leg — so the scoped rebuild-journal path (the actual prod
  correction mechanism) always has the anchor available regardless of which calendar rebuilds
  first.
  (4) `resetFillsProcessedForCalendar` (postgres + memory): identical order-context expansion,
  symmetric with (3) — otherwise a context fill already processed by a sibling's earlier
  rebuild never gets reset and silently vanishes from every later read.
  (5) `isCalendarFullyClosed` (new pure fn, `fill-pairing.ts`): computes net qty per leg from a
  calendar's full rebuilt event history; true when every touched leg is flat.
  (6) `ForTransitioningCalendarClosed` (new port, both calendars adapters): idempotent
  open->closed transition with a caller-supplied `closedAt` (the real historical close date,
  never "now").
  (7) `syncFills.ts`'s `pairFills`: after storing a batch's events, checks every calendar
  touched in that run for full closure and — only when a real CLOSE was processed in the SAME
  run (so a real closedAt is available) — calls the transition port.

  Deliberately NOT touched: `recomputeCalendarAmounts` (already correct, proven again by Test
  A's full-13 pass); the existing `ForClosingCalendar`/CAL-04 manual-close route (different
  semantics — user-supplied closeNetCredit, always "now" — a separate concern from the
  automatic event-driven transition); any schema/migration (no new columns needed — reuses the
  existing `calendars.status`/`closed_at`).

verification: >
  Self-verified in dev/test only: `bun run typecheck` clean. `bun run test` (vitest, whole
  monorepo, INCLUDING Postgres testcontainers suites): 2178/2178 pass (was 2145/2145 before
  this round — +33 net new tests: 23 pure-domain tests, 4+4 new shared contract tests for the
  order-context expansion and the closed-status port, 2 net journal-oracle tests replacing the
  round-4 5-calendar test with a 13-calendar Test A + new Test B (bug 2) + new Test C (bug 1's
  real production mechanism, calendar-scoped rebuild-journal, run in fix-pnl-reingest's actual
  processing order)). `bun run lint` clean. Every new assertion confirmed RED for the exact
  predicted reason before GREEN — including a genuine second-order bug found ONLY because Test
  C exercised the real scoped-rebuild mechanism instead of just the full sweep (the
  resetFillsProcessedForCalendar gap). NOT verified against prod data — no prod job triggered,
  no deploy performed.

files_changed:
  - packages/core/src/journal/domain/fill-pairing.ts (+resolveFillMatches, +isCalendarFullyClosed)
  - packages/core/src/journal/domain/fill-pairing.test.ts (+23 tests)
  - packages/core/src/journal/application/ports.ts (+ForTransitioningCalendarClosed)
  - packages/core/src/journal/application/syncFills.ts (pairFills: resolveFillMatches-based matching; post-emission closed-status check)
  - packages/core/src/journal/application/syncFills.test.ts (mechanical: +transitionCalendarClosed on every deps construction)
  - packages/core/src/journal/application/syncFills.property.test.ts (mechanical: +transitionCalendarClosed)
  - packages/core/src/journal/index.ts, packages/core/src/index.ts (barrel exports: resolveFillMatches, isCalendarFullyClosed, ForTransitioningCalendarClosed)
  - packages/adapters/src/postgres/repos/fills.ts (readUnprocessedFillsForCalendar + resetFillsProcessedForCalendar order-context expansion)
  - packages/adapters/src/memory/fills.ts (same expansion, twin parity)
  - packages/adapters/src/postgres/repos/calendars.ts (+transitionCalendarClosed impl)
  - packages/adapters/src/memory/calendars.ts (+transitionCalendarClosed impl)
  - packages/adapters/src/__contract__/fills.contract.ts (+4 order-context tests; fixed 1 pre-existing fixture collision)
  - packages/adapters/src/__contract__/calendars.contract.ts (+4 transitionCalendarClosed tests)
  - packages/adapters/src/memory/fills.contract.test.ts, packages/adapters/src/postgres/repos/fills.contract.test.ts (wiring: +resetFillsProcessedForCalendar)
  - apps/worker/src/journal-e2e.test.ts (mechanical: +transitionCalendarClosed)
  - apps/worker/src/main.ts (wiring: +transitionCalendarClosed on both syncFills use-cases)
  - apps/worker/src/fix-pnl-reingest.ts (wiring: +transitionCalendarClosed)
  - apps/worker/src/journal-oracle.test.ts (extended to all 13 calendars — Test A; +Test B bug 2; +Test C bug 1 real-mechanism)

### 13-calendar computed-vs-oracle openNetDebit table (Test A, fee-free)

| id | computed openNetDebit | oracle (fee-inclusive) | match |
|---|---|---|---|
| 65aac62e | 32.35 | 32.37 | yes |
| 24f1e72e | 41.52 | (roll-split, see ground-truth asterisk) | yes |
| 60c46a57 | 44.20 | 44.22 | yes |
| 3ca74277 | 43.00 | 43.02 | yes |
| 8a63aa81 | 10.20 | 10.22 | yes (was 62.50 pre-fix) |
| 6303e6af | 46.00 | 46.02 | yes (was 128.90 pre-fix) |
| 45727d08 | 44.50 | 44.52 | yes |
| 53533aa7 | 39.55 | 39.57 | yes |
| b0d862ba | 45.35 | 45.37 | yes |
| e8bfbf41 | 44.60 | 44.62 | yes |
| 9eef2153 | 42.85 | 42.87 | yes |
| 95546839 | 47.55 | 47.57 | yes |
| f3789ddd | 40.60 | 40.62 | yes |

- next_action: Orchestrator-owned. (1) Review/merge this fix. (2) Deploy worker + server (no
  schema change this round — no migration to run). (3) Re-run `fix-pnl-reingest` (the SAME
  script as rounds 3/4 — `wipe-derived-fills` -> `backfill-transactions` -> per-calendar
  `rebuild-journal` -> `recompute-snapshot-pnl`). This is REQUIRED, not optional, for the 2
  shared-leg calendars: their fills from the round-4 run are already sitting in `orphan_fills`
  (parked "ambiguous calendar") from BEFORE this fix, and orphan-parked fill ids are
  permanently excluded from every future read regardless of this round's code fix — only a
  full wipe (which clears `orphan_fills` too, in the SAME transaction) followed by a fresh
  backfill re-ingest clears that stale state so the corrected matching logic gets a chance to
  run on them. A bare `rebuild-journal` trigger on just 8a63aa81/6303e6af, WITHOUT the wipe,
  would NOT fix them. (4) Bug 2 needs NO separate step — it is baked into the SAME
  `rebuild-journal` (via `syncFillsForCalendar`) that step 3 already runs for every calendar,
  so 65aac62e will auto-transition to `closed` with the real Jul-1 closedAt as a side effect of
  step 3, with no additional trigger. (5) Prod-verify against
  `.planning/debug/journal-pnl-ground-truth.md`: all 13 calendars' openNetDebit/closeNetCredit
  (see the table above), and specifically 65aac62e's `status` = "closed" /
  `closedAt` ≈ "2026-07-01". Do NOT run any of this from a debugger session — this session
  self-verified in dev/test only (2178/2178 tests green, typecheck clean, lint clean,
  testcontainers-verified against real Postgres).
