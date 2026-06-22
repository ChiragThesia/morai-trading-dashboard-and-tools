---
phase: 05-jobs-fill-rebuild-integrity
reviewed: 2026-06-22T10:05:00Z
depth: standard
review_round: 3
files_reviewed: 16
files_reviewed_list:
  - apps/server/src/adapters/mcp/tools/trigger-job.ts
  - apps/worker/src/main.ts
  - packages/adapters/src/__contract__/calendar-events.contract.ts
  - packages/adapters/src/__contract__/fills.contract.ts
  - packages/adapters/src/memory/fills.ts
  - packages/adapters/src/postgres/migrations/0006_fills_processed_at.sql
  - packages/adapters/src/postgres/migrations/meta/_journal.json
  - packages/adapters/src/postgres/repos/calendar-events.ts
  - packages/adapters/src/postgres/repos/fills.ts
  - packages/adapters/src/postgres/repos/fills.contract.test.ts
  - packages/adapters/src/postgres/repos/job-runs.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/application/rebuildJournal.ts
  - packages/core/src/journal/application/syncFills.ts
  - packages/core/src/journal/application/syncTransactions.ts
  - packages/core/src/journal/domain/calendar-event.ts
  - packages/contracts/src/jobs.ts
  - apps/server/src/adapters/mcp/mcp.test.ts
  - packages/core/src/journal/application/syncFills.property.test.ts
  - packages/core/src/journal/application/syncTransactions.property.test.ts
findings:
  critical: 0
  warning: 0
  info: 1
  total: 1
status: clean
---

# Phase 5: Code Review Report — Round 3 (FINAL merge gate)

**Reviewed:** 2026-06-22
**Depth:** standard
**Files Reviewed:** 16 source files (+ contracts, contract harnesses, property/MCP tests)
**Status:** clean — **CLEAR TO MERGE 04+05**

## Summary

Final adversarial pass over the round-2 gap delta (plans 05-14/05-15/05-16) plus the
property-found `syncTransactions` follow-up fix. Verified each 05-REVIEW-2 finding is
genuinely fixed (not papered over), traced the processed-fill lifecycle across sync +
rebuild for stuck/double-emit paths, audited migration 0006, ROLL component persistence,
twin/Postgres parity, Zod-at-boundary, core purity, and the `any`/`as`/`!` ban.

**Verdict: clean bill — merge.** All five round-2 findings (CR-A1 + WR-A1..A4) are fixed
with matching tests, and the follow-up `hashFillIds(['${activityId}:${legIndex}'])`
single-element fix is correct and collision-free. No remaining BLOCKER. One INFO note
carried forward (fee-blind realized P&L), unchanged in scope from round 2 and explicitly
deferred by 05-GAPS-2 ("fix if cheap").

**Proof of green (merge-gate evidence):**
- `bun run typecheck` → clean (`tsc --build --force`, no errors).
- `bun run test` → **791 tests / 84 files, all passing**, 17.11s. Docker WAS available,
  so the testcontainers Postgres fills + calendar-events ROLL contract suites ran for
  real (not skipped), alongside the in-memory twin and the fast-check property suites.

---

## Verification of Round-2 Findings

| ID | Status | Evidence |
|----|--------|----------|
| **CR-A1** (BLOCKER) | **FIXED** | `trigger-job.ts:41-72` validates name first (`z.enum(TRIGGERABLE_JOBS)`), then runs `triggerJobBodyFor(name).safeParse({ calendarId })` — the SAME per-job refinement the HTTP route uses (`contracts/jobs.ts:48-57`: `rebuild-journal ⇒ calendarId required`). A failed parse returns MCP error content and `enqueueJob` is never reached (`:59-70`). `calendarIdRaw` read via `Reflect.get` (no `as`). MCP-level test asserts `{ name: "rebuild-journal" }` with no calendarId returns an error, contains no `jobId`, and `enqueueCalls === 0` (`mcp.test.ts:549-567`), plus the positive enqueue-once case (`:569+`). Both adapter surfaces now in sync (architecture §9). |
| **WR-A1** | **FIXED** | `recomputeCalendarAmounts` sums by `eventType`, not by sign: OPEN→`openDebit`, CLOSE→`closeCredit` (abs), ROLL splits via persisted `rollOpenDebit`/`rollCloseCredit` columns (`postgres/repos/fills.ts:326-341`; memory twin identical `memory/fills.ts:211-232`). New `roll_open_debit`/`roll_close_credit` numeric columns (schema.ts:255-256, migration 0006). `syncFills.ts:382-385` writes both components on a ROLL (`rollOpenDebit: openDebit`, `rollCloseCredit: closeCredit`), null on OPEN/CLOSE (`:452-453`). calendar-events contract round-trips a ROLL's components (`calendar-events.contract.ts:124-156`); fills contract asserts the ROLL split reconciles `openNetDebit=16, closeNetCredit=9` (`fills.contract.ts:384-422`). Property P3 reconciles arbitrary OPEN/CLOSE/ROLL sequences (`syncFills.property.test.ts:16-18`). |
| **WR-A2** | **FIXED** | Migration 0006 adds `processed_at timestamptz NULL` (additive/nullable). New `ForMarkingFillsProcessed` + `ForResettingFillsProcessedForCalendar` ports (`ports.ts:476-499`). `readUnprocessedFills` = `WHERE processed_at IS NULL AND id NOT IN orphan_fills` (`postgres/repos/fills.ts:138-158`). `syncFills` marks processed at EVERY terminal path: no-match orphan (`:139`), ambiguous orphan (`:158`), aggregation-error orphan (`:209`), UNKNOWN orphan (`:310`), ROLL (`:391`), OPEN/CLOSE (`:459`). rebuild un-marks the calendar's fills via `resetFillsProcessedForCalendar` BEFORE the scoped re-pair (`rebuildJournal.ts:62-65`) — the deviation the executor caught; without it the scoped re-sync would read zero fills and emit nothing. Reset scope (`[front,back]` from `calendarLegSymbols`) is identical to the read scope, so delete scope == sync scope. Contract suite covers: re-run does not re-emit, partial-growth forms one NEW event, mark is idempotent, empty array no-op, orphan stays excluded (`fills.contract.ts:201-269`). Property P2/P2b prove idempotent + partial-growth invariants. |
| **WR-A3** | **FIXED** | `hexToUuid` (`syncTransactions.ts:67-75`) maps the 32-hex prefix contiguously to 8-4-4-4-12 (`slice(0,8)/8,12/12,16/16,20/20,32`) — no nibble dropped, no version/variant rewrite. Property P4-totality asserts distinct 32-hex prefixes → distinct UUIDs over 1000 runs (`syncTransactions.property.test.ts:85-98`), P4b asserts UUID-regex validity. |
| **WR-A4** | **FIXED** | `MemorySeedEvent` now carries the full event shape incl. `eventType`/`legOccSymbol`/`rolledFromOccSymbol`/`fillIdsHash`/`rollOpenDebit`/`rollCloseCredit` (`memory/fills.ts:48-57`); twin's recompute sums by eventType mirroring Postgres exactly (`:211-232`). Both contract harnesses persist + read the ROLL split (`postgres .../fills.contract.test.ts:58-73`; `memory .../fills.contract.test.ts:29`), and the shared suite's ROLL recompute case runs against BOTH adapters → twin/Postgres parity proven. |

### Follow-up fix (syncTransactions) — order-sensitive fill id

**Status: FIXED — correct, no remaining non-injective key path.**
`flattenTransaction` derives the id from a SINGLE pre-combined element:
`hashFillIds(['${tx.activityId}:${legIndex}'])` (`syncTransactions.ts:134`). The root
cause was that `hashFillIds` sorts its input (it is a set-hash for unordered fill-id
sets), so a two-element key `[activityId, legIndex]` collided under transposition —
`(4,5)` and `(5,4)` both sort to `"4:5"`. A single string element removes the sort's
transposition surface entirely. The id is now order-sensitive. Verified injective by:
P4 (distinct `(activityId, legIndex)` → distinct UUID, 1000 runs) and the P4-regression
explicit `deriveFillId(4,5) !== deriveFillId(5,4)` / `(10,2) !== (2,10)`
(`syncTransactions.property.test.ts:66-107`). No other key path feeds `hexToUuid`; the
only id source is this single combined element.

---

## New-bug / regression sweep (round-2 delta)

All clear. Specific checks:

- **Migration 0006 correctness:** additive + nullable on all three columns (`fills.processed_at`,
  `calendar_events.roll_open_debit`, `calendar_events.roll_close_credit`) — no NOT NULL, no
  default, no destructive ALTER; safe on a populated table. `meta/_journal.json` HAS the
  `0006_fills_processed_at` entry (idx 6, tag matches the SQL filename), so Drizzle's
  `migrate()` (which applies by journal `tag`, not by snapshot) will run it. The absence of a
  `0006_snapshot.json` is benign — snapshots feed `drizzle-kit generate` diffing, not the
  runtime migrator. The `migrate.idempotent` test exercises re-run safety.
- **Processed-fill lifecycle (stuck / double-emit):** Every terminal branch in `pairFills`
  marks its fills processed; there is no branch that stores/parks a fill without marking it,
  and none that marks without storing/parking. Rebuild un-marks exactly the calendar's two
  leg occSymbols (same derivation as the scoped read), so a rebuilt fill is re-read, and a
  fill that was paired to that calendar is the only owner of that occSymbol (a shared leg
  across two open calendars is orphaned by the `legs.length > 1` ambiguity rule, then stays
  excluded by the orphan filter even after un-mark). A ROLL's old leg (`rolledFromOccSymbol`)
  is one of the calendar's two current legs (close-front + open-back within the same
  calendar), so it falls inside the reset scope — no ROLL fill gets stuck processed. No path
  re-reads a paired fill (kills the unbounded re-pair) and partial-growth forms a NEW event
  over only the new fills (kills the double-count) — both proven by property P1/P2b.
- **ROLL component persistence:** stored as dedicated numeric columns (not free JSON);
  `storeCalendarEvent` writes them, `readCalendarEvents` parses them, `recomputeCalendarAmounts`
  reads them. Twin and Postgres agree.
- **Twin/Postgres parity:** identical `runFillsContractTests` + `runCalendarEventsContractTests`
  suites run against both; the ROLL recompute case is in both. Green under testcontainers.
- **Zod-parse-at-boundary:** MCP tool safeParses name then per-job body; never throws.
- **No `any`/`as`/`!`:** none in the delta (only doc-comment mentions of `as`/`node:crypto`;
  `Reflect.get`/`Reflect.apply` used precisely to avoid casts). `as const` in the worker
  composition root only (allowed).
- **Core purity:** zero `node:*`/`crypto`/`require` imports under `packages/core/src`
  (grep-verified); id/sha256 injected at the worker composition root (`worker/main.ts:208-209,
  222-223,245,295`). syncTransactions reaches brokerage via its application port (architecture §7).

---

## Info

### IN-A1: realized P&L remains fee-blind; `filledAt` time-zeroed (carried from round-2 IN-A2)

**File:** `packages/core/src/journal/application/syncTransactions.ts:125,143-144`
**Issue:** `flattenTransaction` still hardcodes `commission: null` / `fees: null` and sets
`filledAt = new Date(tx.tradeDate + "T00:00:00Z")`, discarding intraday time. Fees-on-close
feed `computeRealizedPnl` (`syncFills.ts:338,414`), so realized P&L systematically omits
commissions/fees. This was explicitly deferred in 05-GAPS-2 ("IN (optional) … fix if cheap")
and is out of the round-2 fix scope. Not a blocker — it is a known, documented limitation,
not a correctness regression introduced by this delta. Track for a follow-up plan so
production realized P&L is not silently fee-blind.
**Fix:** Thread `tx.time` and the adapter's per-leg cost/fee fields into the RawFill when
available; until then, document the null-fee limitation at the call site.

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard · Round: 3 (final merge gate)_
