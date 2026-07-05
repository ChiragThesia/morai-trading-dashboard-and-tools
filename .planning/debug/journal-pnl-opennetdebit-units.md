---
slug: journal-pnl-opennetdebit-units
status: resolved
trigger: "Journal P&L shows −$319,850 for calendar 65aac62e (7425P) when real P&L ≈ +$415 — openNetDebit stored in dollars, snapshot formula expects points"
created: 2026-07-05
updated: 2026-07-05T00:00:00-07:00
tdd_mode: true
goal: find_and_fix
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

- next_action: RESOLVED (code) — orchestrator chose PROCEED/validate-on-one and resolved the prod-DB blind spot (see Evidence 2026-07-05 blind-spot resolution). Fix committed. Remaining work is orchestrator-owned operational rollout: deploy worker+server, then trigger `rebuild-journal` -> `recompute-snapshot-pnl` per affected calendar. Do NOT deploy or trigger prod jobs from this session.

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

## Eliminated

(none — the original hypothesis was confirmed by direct code evidence, not disproven. The one genuinely-unverified blind_spot for 65aac62e — do its fills pair or are they orphaned — was resolved by the orchestrator: 2 OPEN paired calendar_events exist, so rebuild-journal fixes it cleanly.)

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
