---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
verified: 2026-07-14T18:47:10Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "One-time trigger_job/CLI repair RUN of the ~15 mid-June CLOSED calendars (SPXW/SPXW, archive intact since Jun-12) to rebuild their calendar_snapshots rows"
    addressed_in: "Operator follow-up (mechanism shipped + tested this phase)"
    evidence: "40-08-SUMMARY key-decisions: in-session MCP trigger_job enum predates the deploy + direct-endpoint invocation needs prod secrets the permission layer correctly refused. Runnable any time via MCP `trigger_job repair-journal-history` (no calendarId, heal-only) or `bun apps/worker/src/repair-journal-history.ts --all`. Their leg_observations archive is intact, so the story is recoverable, not lost."
  - truth: "Top-of-hour rows built from a pre-anchor observation (obs timestamped just before the floored slot anchor) heal to non-gap"
    addressed_in: "Tracked known-minor follow-up (window-widen)"
    evidence: "40-08-SUMMARY §Residual bug; encoded as a live-flipping known-limitation test in self-heal-journal.prod-repro.contract.test.ts test 3 (obs at 13:59:30Z leaves the 14:00 gap unhealed). Heal window widening flips it to a heal-assert."
---

# Phase 40: Journal history repair — never lose a calendar's greek/vol story — Verification Report

**Phase Goal:** Every calendar — open, closed, or registered late — carries its full 30-min greek/vol/price/P&L story in the journal: the back-leg NaN is root-caused and fixed, missing/gap slots heal automatically from `leg_observations` (same pure metric functions as the live writer, fill-only, honest gaps only), a repair CLI rebuilds all existing calendars' histories, and the lifecycle chart shows the trade's actual life instead of frozen NaN rows.
**Verified:** 2026-07-14T18:47:10Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (roadmap contract — HIST-01..05)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| HIST-01 | Back-leg NaN root-caused (SPX/SPXW OCC-root mismatch) and fixed so any leg with a usable mark resolves to IV+greeks; honest-gap law preserved | ✓ VERIFIED | `resolveRootCandidates` (occ-root.ts) reused at all leg-resolution sites: `getOpenCalendarLegs` (pg+memory), `resolveLegSnapshot` (pg+memory, `inArray(contracts.root, …)`), `resolveLegObservationForSlot` (pg+memory), `getLiveGreeks`. Prod-repro contract test resolves BOTH mixed-root legs (SPX front `261120`, SPXW back `261130`) for the 14:00 slot through real SQL. Live: 09:21Z back leg resolves SPXW-rooted with finite IV/delta/gamma/theta/vega (40-08-SUMMARY). `mapSnapshotRow` made source-inclusive (schwab_chain no longer dropped, Pitfall 1). |
| HIST-02 | Pure rebuild use-case derives snapshot rows from `leg_observations` using the SAME `computeLegPairMetrics`+`computeSnapshotPnl` as the live writer (no drift); fill-only; honest gaps only | ✓ VERIFIED | `rebuildCalendarHistory.ts` imports the two metric fns verbatim from `snapshotCalendars.ts`; slot where either leg unresolved → `honestGapSlots++`, no heal call (D-04); calls `healSnapshot` only, never `persistSnapshot` (D-03). Byte-identical-to-live-writer + honest-gap-skip tests green (84 core tests). |
| HIST-03 | Recurring self-heal repairs OPEN calendars over a bounded lookback (7d) from `leg_observations`; OPS-01 live gate untouched | ✓ VERIFIED | `selfHealJournal.ts` OPEN-only (`getOpenCalendars`), window `[now−7d, now]`, aggregates coverage; `self-heal-journal` handler (null-payload guard, no RTH gate) + hourly cron registered in schedule.ts + wired in main.ts. LIVE 18:01Z: `slots=140 healed=16 honestGaps=124 errors=0`; stuck 14:00/15:00Z gap rows healed to full greeks. |
| HIST-04 | Operator repair CLI + job rebuild one/all calendars (before/after coverage); on-register backfill from `openedAt` | ✓ VERIFIED (mechanism); one-time CLOSED-calendar RUN deferred to operator | `repairJournalHistory.ts` one/all scope, before/after coverage via `readJournal`+`isGapRow`, opt-in `trimOutsideWindow`. `repair-journal-history` in TRIGGERABLE_JOBS + handler + `repair-journal-history.ts` CLI (`parseRepairArgs`: explicit `--all`, opt-in `--trim`). On-register backfill in `registerOpenCalendars` (`rebuildCalendarHistory({from: openedAt, to: now})`, non-fatal → `backfilledSlots: number\|null`). All tested. One-time RUN for ~15 closed calendars is an operator follow-up (see Deferred). |
| HIST-05 | At most one scheduled row per 30-min slot; event-move rows stay distinct; never write outside `openedAt..closedAt` | ✓ VERIFIED | `roundDownToRthSlot` (idempotent, DST-safe via Intl offset) applied in `snapshotCalendars` for `trigger==='scheduled'` only (`rowTime = scheduled ? round(now) : now`); freshness gate keeps REAL now. `enumerateRebuildSlots` clamps to `[max(openedAt,from), min(closedAt??now,to)]` (D-08). LIVE 13:30Z: both calendars wrote first-ever non-gap rows at exact `13:30:00.000Z` boundary, one per slot. |

**Score:** 5/5 requirements verified (0 present, behavior-unverified)

### Deferred Items

Items addressed by an operator follow-up / tracked known-minor — not actionable code gaps.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | One-time repair RUN of the ~15 CLOSED calendars' snapshot rows | Operator follow-up (mechanism shipped+tested) | Blocked in-session only by MCP-enum-predates-deploy + secrets-permission; runnable any time via `trigger_job repair-journal-history` or the CLI. Archive intact → story recoverable, not lost. |
| 2 | Pre-anchor observation blind spot (top-of-hour rows from an obs before the floored anchor) | Tracked known-minor (window-widen) | Encoded as a live-flipping known-limitation test (prod-repro test 3). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/journal/domain/occ-root.ts` | `resolveRootCandidates` | ✓ VERIFIED | Pure total fn, closed `"SPX"\|"SPXW"` union, exported via @morai/core, reused at 6 leg sites |
| `packages/core/src/journal/domain/rth-slot.ts` | `roundDownToRthSlot` | ✓ VERIFIED | Idempotent, DST-safe (Intl offset), no Date.now(); property-tested |
| `packages/core/src/journal/application/rebuildCalendarHistory.ts` | rebuild engine | ✓ VERIFIED | D-02 verbatim reuse, D-04 honest-gap skip, D-03 heal-only, D-08 clamp, WR-01 errorCount |
| `packages/core/src/journal/application/selfHealJournal.ts` | OPEN-only bounded self-heal | ✓ VERIFIED | 7d lookback, aggregates coverage; live-proven |
| `packages/core/src/journal/application/repairJournalHistory.ts` | one/all orchestrator | ✓ VERIFIED | before/after coverage, opt-in trim |
| `packages/core/src/journal/application/registerOpenCalendars.ts` | on-register backfill | ✓ VERIFIED | non-fatal `backfilledSlots` on RegisteredCalendarSummary |
| `packages/core/src/journal/application/ports.ts` | 3 new ports | ✓ VERIFIED | ForResolvingLegObservationForSlot / ForHealingSnapshot / ForDeletingSnapshotsOutsideWindow exported |
| `packages/adapters/src/postgres/repos/leg-observations.ts` | as-of-slot read (pg) | ✓ VERIFIED | candidate-root join; contract-tested |
| `packages/adapters/src/postgres/repos/calendar-snapshots.ts` | heal-write + delete (pg) | ✓ VERIFIED | race-safe fill-only tx via shared isGapRow; windowed delete |
| `packages/adapters/src/memory/{leg-observations,calendar-snapshots}.ts` | in-memory twins | ✓ VERIFIED | rule-8 twins present, contract-tested |
| `apps/worker/src/handlers/self-heal-journal.ts` | thin handler | ✓ VERIFIED | array-guard → null-payload `?? {}` → Zod → use-case → throw on !ok; observability log |
| `apps/worker/src/handlers/repair-journal-history.ts` | thin handler | ✓ VERIFIED | trim not reachable via trigger_job contract |
| `apps/worker/src/repair-journal-history.ts` | operator CLI | ✓ VERIFIED | explicit `--all`, opt-in `--trim`, before/after table, exit codes |
| `apps/worker/src/schedule.ts` | job registration | ✓ VERIFIED | both queues created + worked; self-heal hourly, repair no-cron |
| `packages/contracts/src/jobs.ts` | TRIGGERABLE_JOBS | ✓ VERIFIED | `repair-journal-history` added; `triggerJobPayload` carries NO trim field (T-40-15) |
| `docs/architecture/jobs.md` | docs-before-code | ✓ VERIFIED | 2 new job rows; snapshot-calendars backfill language corrected; macro "Historical backfill is not implemented" untouched |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| leg-resolution sites | occ-root.ts | `resolveRootCandidates` (one definition, @morai/core) | ✓ WIRED |
| snapshotCalendars | rth-slot.ts | `roundDownToRthSlot(now)` for scheduled only | ✓ WIRED |
| healSnapshot (pg+memory) | attribution.ts | `isGapRow` (LOCKED predicate, no second def) | ✓ WIRED |
| rebuild engine | snapshotCalendars metric fns | `computeLegPairMetrics`+`computeSnapshotPnl` verbatim | ✓ WIRED |
| self-heal/repair/on-register | rebuild engine | main.ts composes ONE engine, three consumers | ✓ WIRED |
| repair job/CLI | repairJournalHistory | schedule.ts + TRIGGERABLE_JOBS + CLI import.meta.main | ✓ WIRED |
| trigger_job → repair | (trim blocked) | `triggerJobPayload` has no trim field → CLI-only trim | ✓ WIRED |

### Behavioral Spot-Checks (phase-scoped tests run this verification)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Domain + all use-cases (idempotency, D-02 byte-identical, honest-gap skip, fill-only, same-slot collapse, coverage, on-register backfill) | `bun run test -- <8 core journal test files>` | 84 passed | ✓ PASS |
| Memory contract (heal insert/update-gap/no-op-live, as-of-slot read, windowed delete) + worker handlers + contracts | `bun run test -- <5 files>` | 73 passed | ✓ PASS |
| Postgres contract (real-SQL heal tx, as-of-slot, delete, candidate-root) | `bun run test -- <3 contract files>` | 85 passed | ✓ PASS |
| Prod-repro end-to-end (mixed-root SPX/SPXW → 14:00 gap heals to finite greeks; pre-anchor blind spot documented) | `bun run test -- self-heal-journal.prod-repro.contract.test.ts` | 3 passed | ✓ PASS |

245 phase-scoped tests green. Full workspace suite (3639/3639) already green per plan 08 gate — not re-run.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none) | TBD/FIXME/XXX/TODO/HACK/placeholder in phase source | — | Clean scan across all 15 phase source files |
| `snapshotCalendars.ts:282` | comment "historical rows are never backfilled" | ℹ️ Info | Stale doc-comment in the live-writer path — technically true FOR the live writer (self-heal backfills separately), but reads misleading now. Authoritative jobs.md IS corrected. Non-functional; not a gap. |

### Human Verification Required

None outstanding for goal achievement. Plan-08 blocking human-verify checkpoints (deploy + diagnostic SQL + open-calendar lifecycle) were executed by the operator and recorded in 40-08-SUMMARY (13:30Z first healthy rows, 18:01Z heal run, Open-Question-3 = data-absent-forward-capture-live). Per verification scope, prod evidence was accepted, not re-verified.

### Gaps Summary

No code gaps. The root-cause fix, self-heal, repair mechanism, on-register backfill, slot hygiene, and docs are all present, substantive, wired, and behaviorally proven (245 phase tests + live prod evidence). Two documented deferrals remain — both operator/known-minor follow-ups, not defects: (1) the one-time repair RUN of the ~15 closed calendars (mechanism shipped+tested, archive intact, runnable any time; in-session blocked only by MCP-enum-predates-deploy + secrets-permission); (2) the pre-anchor observation blind spot (encoded as a live-flipping known-limitation test). Both were scored as documented deferrals per the phase plan and the SUMMARY, consistent with the verification scope.

---

_Verified: 2026-07-14T18:47:10Z_
_Verifier: Claude (gsd-verifier)_
