---
phase: 05-jobs-fill-rebuild-integrity
reviewed: 2026-06-21T23:35:00Z
depth: standard
review_round: 2
files_reviewed: 19
files_reviewed_list:
  - apps/server/src/adapters/http/jobs.routes.ts
  - apps/server/src/adapters/mcp/tools/trigger-job.ts
  - apps/worker/src/handlers/sync-transactions.ts
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/fills.ts
  - packages/adapters/src/memory/job-queue.ts
  - packages/adapters/src/postgres/repos/fills.ts
  - packages/adapters/src/postgres/repos/job-runs.ts
  - packages/adapters/src/postgres/repos/orphan-fills.ts
  - packages/adapters/src/schwab/trader/transactions-adapter.ts
  - packages/adapters/src/__contract__/fills.contract.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/jobs.ts
  - packages/core/src/brokerage/application/refreshToken.ts
  - packages/core/src/journal/application/enqueueJob.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/application/rebuildJournal.ts
  - packages/core/src/journal/application/syncFills.ts
  - packages/core/src/journal/application/syncTransactions.ts
  - packages/core/src/journal/domain/calendar-event.ts
  - packages/core/src/journal/domain/fill-pairing.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 5: Code Review Report — Round 2 (gap-closure re-review)

**Reviewed:** 2026-06-21
**Depth:** standard
**Files Reviewed:** 19 (+ tests, contracts, supporting types)
**Status:** issues_found

## Summary

Re-review of the Phase 05 gap-closure round (plans 05-09..05-13) against the 4 critical +
8 warning findings of round 1, plus an adversarial pass over the new fills data-path code
(fills repo + memory twin, sync-transactions use-case + handler, worker wiring).

**Verdict: strong round.** All 4 criticals and 7 of the 8 warnings from round 1 are
genuinely fixed (not papered over) with matching tests. `bun run typecheck` is clean and
the full suite is green (281 tests, including the Postgres + memory fills contract suites).
Core is now provably pure: no `crypto`/`node:*` import remains anywhere under
`packages/core/src`. The Schwab transactions adapter Zod-parses at the network boundary,
fill ids are deterministic (idempotent re-sync), and the in-memory fills twin shares the
exact contract suite with the Postgres repo.

**One BLOCKER remains:** the WR-04 fix is only half-applied. The HTTP route now requires
`calendarId` for `rebuild-journal`, but the MCP `trigger_job` tool — the *other* adapter
that shares this contract (architecture-boundaries §9) — does NOT apply the per-job
refinement and still enqueues a null-keyed, un-deduplicated rebuild. The exact queue-flood
WR-04 described is still reachable through MCP.

Plus four warnings: a ROLL net-amount that gets mis-bucketed in `recomputeCalendarAmounts`,
a full-table scan of `fills` on every sync (correctness-adjacent: unbounded re-pairing),
an unused `lastError` helper signature, and a small twin/contract shape drift.

---

## Verification of Round-1 Findings

| ID | Status | Evidence |
|----|--------|----------|
| CR-01 | **FIXED** | `fill-pairing.ts:14` imports only `@morai/shared`; `hashFillIds` takes an injected `hasher` (`fill-pairing.ts:180-187`). `syncFills.ts` uses `deps.newId`/`deps.hashFillIds` (`:63-64`, `:293`, `:330`, `:355`). Adapter supplies `randomUUID`/sha256 at the composition root (`worker/main.ts:208-209,220-221`). Grep confirms zero `crypto`/`node:` imports under `packages/core/src`. |
| CR-02 | **FIXED** | `refreshToken.ts:101-112` — only `invalid_grant`/`invalid_client` → `auth-expired`; `network`/`parse` → retryable `storage-error`. The catch block (`:115-118`) also maps unexpected throws to `storage-error`, not expiry. |
| CR-03 | **FIXED** | `job-runs.ts:84-100` — `MAX(...) FILTER (WHERE state='completed')` and `FILTER (WHERE state='failed')` compute the two timestamps independently; a correlated subselect carries the latest failed run's output into `lastError` (`:89-95`). `lastError` is non-null only when `lastErrorAt` is non-null (`:116-119`). |
| CR-04 | **FIXED** | New `makeSyncFillsForCalendarUseCase` reads `readUnprocessedFillsForCalendar(calendarId)` (`syncFills.ts:435-443`); `rebuildJournal.ts:32,57` injects it as `syncFillsForCalendar`; worker wires the genuinely scoped instance (`worker/main.ts:233-243,354`). The `calendarId` is no longer discarded. |
| WR-01 | **FIXED** | `originalOpenDebitFor` reads the prior OPEN event's `netAmount` (`syncFills.ts:208-224`); `realizedPnl` is `null` when no prior OPEN exists (`:307-310`, `:374-377`). On ROLL, the new leg's premium is `netAmount`/cost basis, never subtracted from realized P&L (`:295-310`, `:341`). |
| WR-02 | **FIXED** | `detectRoll` now parses both OCC symbols and requires same root + strike + type and a DIFFERENT expiry (`fill-pairing.ts:148-166`); unparseable/same-expiry pairs return false. |
| WR-03 | **FIXED** | `aggregatePartialFills` takes `calendarId` + `positionEffect` as params (no placeholders), returns `err(FillAggregationError)` on empty group and on `sumQty <= 0` (`fill-pairing.ts:62-93`). No internal re-grouping / dead grouping remains. |
| WR-04 | **PARTIAL — see CR-A1** | HTTP route enforces it (`jobs.routes.ts:41-48` via `triggerJobBodyFor`, `contracts/jobs.ts:45-53`). MCP `trigger_job` tool does NOT — it uses an inline `calendarId.optional()` schema and never calls `triggerJobBodyFor`, so a null-keyed rebuild is still enqueueable via MCP. |
| WR-05 | **FIXED** | `memory/job-queue.ts:44-53` — dedup hit returns `ok(null)`, mirroring pg-boss singletonKey collision semantics. |
| WR-06 | **FIXED** | `classifyFill` now takes only `positionEffect` (`fill-pairing.ts:35-46`); the fabricated `classifiedSide` and the dead `side` param are gone. |
| WR-07 | **FIXED** | UNKNOWN branch loops over `cf.rawFills`, parking each with real `side`/`filledAt`/`fill.id` (`syncFills.ts:259-270`); empty-rawFills aggregate surfaces an error instead of synthesizing a non-UUID PK (`:251-258`). |
| WR-08 | **FIXED** | New `ForRecomputingCalendarAmounts` port (`ports.ts:456-463`); `rebuildJournal.ts:62` calls `recomputeCalendarAmounts` as the final step; fills repo sums `calendar_events.netAmount` and writes `openNetDebit`/`closeNetCredit` (`postgres/repos/fills.ts:243-275`); memory twin mirrors it (`memory/fills.ts:165-186`); contract test asserts non-null totals (`fills.contract.ts:267-321`). |
| IN-01 (`void pgBossJobQueue`) | **FIXED** (incidental) | The dead `void pgBossJobQueue` binding is gone from `worker/main.ts`; the worker no longer constructs an unused queue adapter. |
| IN-02 (`extractLastError` loop) | **NOT FIXED** | `job-runs.ts:63-69` still iterates `Object.entries` to find `"message"` instead of a direct `in`+`typeof` narrow. Cosmetic; carried below as IN-A1. |
| IN-03 (server enqueue PgBoss teardown) | **OUT OF SCOPE** | `apps/server/src/main.ts` not in this delta; not re-verified. |

---

## Critical Issues

### CR-A1: WR-04 fix bypassed at the MCP boundary — null-keyed rebuild flood still reachable

**File:** `apps/server/src/adapters/mcp/tools/trigger-job.ts:38-59`, vs `apps/server/src/adapters/http/jobs.routes.ts:41-48`
**Issue:** Round 1's WR-04 required `calendarId` for `rebuild-journal` "at the contract/route
boundary." The HTTP route does this via `triggerJobBodyFor(name)` (which refines
`rebuild-journal ⇒ calendarId required`). The MCP `trigger_job` tool is the *second* adapter
sharing the same contract (architecture-boundaries §9: "keep adapter surfaces in sync"), but
it validates with an inline schema that leaves `calendarId` optional and never calls
`triggerJobBodyFor`:
```ts
const parsed = z.object({
  name: z.enum(TRIGGERABLE_JOBS),
  calendarId: z.string().uuid().optional(),   // optional — refinement NOT applied
}).safeParse(args);
```
A `trigger_job` MCP call with `{ name: "rebuild-journal" }` and no `calendarId` therefore
passes validation, reaches `enqueueJob`, where `buildDedupeKey` returns `null` for a
rebuild without a calendarId (`enqueueJob.ts:59-66`), so EVERY such call enqueues a fresh,
un-deduplicated rebuild. This is the exact queue-flood WR-04 was raised to close — the
HTTP hole is patched but the MCP hole is wide open, and MCP is bearer-guarded but
agent-driven (Claude can call it in a loop). The fix is also semantically incomplete: a
rebuild with no calendarId is undefined ("rebuild what?").
**Fix:** Route the MCP tool through the same per-job refinement. Either call
`triggerJobBodyFor(parsed.data.name).safeParse({ calendarId })` after the name is known,
or hoist the rebuild⇒calendarId rule into a shared validator both adapters import. Return
the MCP error content on failure, exactly as the route returns 400. Add an MCP-level test
asserting `{ name: "rebuild-journal" }` with no calendarId is rejected.

---

## Warnings

### WR-A1: ROLL `netAmount` is mis-bucketed by `recomputeCalendarAmounts`

**File:** `packages/adapters/src/postgres/repos/fills.ts:252-261`, `packages/adapters/src/memory/fills.ts:170-179`, `packages/core/src/journal/application/syncFills.ts:341`
**Issue:** A ROLL event stores a *combined* net amount: `netAmount = openDebit − closeCredit`
(`syncFills.ts:341`) — the new open leg minus the closed leg, netted into one number.
`recomputeCalendarAmounts` then buckets each event's `netAmount` purely by sign: `>= 0`
adds to `openNetDebit`, `< 0` adds to `closeNetCredit`. For a ROLL this is wrong twice
over: (a) the roll's open-leg debit and close-leg credit collapse into a single signed
value, so only ONE of the two aggregates is touched, and (b) the sign of a roll is
arbitrary (depends on whether the new leg costs more than the old leg returned), so a
net-credit roll lands in `closeNetCredit` and a net-debit roll in `openNetDebit`, neither
reflecting the true open/close components. SC5 ("P&L reconciles after rebuild") will not
hold for any calendar that contains a ROLL. The WR-08 fix is correct for pure OPEN/CLOSE
calendars but silently wrong once a roll exists. Tests only cover OPEN/CLOSE events
(`fills.contract.ts:267-321`), so this is untested.
**Fix:** Either persist the roll's open and close components separately (e.g. derive them
from `legBreakdown`, or split a ROLL into the open and close contributions when summing),
or define recompute to read per-leg amounts rather than the combined `netAmount`. At
minimum add a contract-test case with a ROLL event and assert both aggregates.

### WR-A2: `readUnprocessedFills` scans the entire `fills` table forever; paired fills are never marked processed

**File:** `packages/adapters/src/postgres/repos/fills.ts:130-149`, `packages/adapters/src/__contract__/fills.contract.ts:16-21`
**Issue:** "Processed" is defined as "id present in `orphan_fills`." A successfully PAIRED
fill is written to `calendar_events` as a `fill_ids_hash` (a hash, not per-fill ids) and is
NOT added to `orphan_fills`. So a paired fill remains "unprocessed" on every subsequent
sync and is re-read and re-paired indefinitely. Re-emission is absorbed by the
`fill_ids_hash` UNIQUE constraint — but ONLY if the exact same fill set re-aggregates to the
same hash. Two correctness consequences: (1) every 10-minute sync re-reads and re-pairs the
full lifetime fills table (the `notInArray(fills.id, parkedIds)` filter only removes
orphans), which is unbounded work that grows without limit; and (2) partial-fill growth
breaks idempotency — if a bucket had fills {A} at run N (hash(A)) and {A,B} at run N+1
(hash(A,B)), the run N+1 emits a SECOND event for the now-larger aggregate while the run-N
event for {A} still exists, double-counting the leg in `recomputeCalendarAmounts`. The
documented rationale ("re-emission is absorbed by the UNIQUE constraint") only holds for an
unchanging fill set, which partial fills violate. This is the v1 "performance is out of
scope" caveat colliding with a real correctness edge.
**Fix:** Track processed fills explicitly — e.g. a join table of (fill_id → event), or store
the composing fill ids alongside the event, or mark fills with a `processed_at` column —
so paired fills are excluded from the next `readUnprocessedFills` and a grown bucket
replaces (not duplicates) the prior event. At minimum, add a regression test for the
partial-fill-growth case and document the constraint loudly until fixed.

### WR-A3: `hexToUuid` can collide across distinct activity/leg keys (only 31 of 32 hex nibbles used)

**File:** `packages/core/src/journal/application/syncTransactions.ts:63-75`
**Issue:** `hexToUuid` builds the UUID from `h = hex.slice(0,32)` but DROPS nibble index 12:
`timeHiVersion = "5" + h.slice(13,16)` skips `h[12]`. It also overwrites nibble 16 with a
variant digit derived from `h[16]` (`:69-72`). So the fill id is a function of 30 of the
sha256's 32 leading nibbles plus 2 synthesized nibbles. Dropping a full input nibble shrinks
the effective key space and makes two distinct `(activityId, legIndex)` digests that differ
ONLY in nibble 12 map to the SAME fill id — a silent collision that drops a real fill (the
second is absorbed by `onConflictDoNothing` on the id PK). Collision probability is low but
the loss is silent and the id is a primary key for trade data. The version/variant rewrite
is unnecessary here (the column is a plain `uuid`, not validated as RFC-4122 v5).
**Fix:** Use all 32 leading hex nibbles for the 32 UUID hex positions (insert the dashes
without skipping a nibble and without rewriting version/variant), or — simpler and
collision-free — store the full sha256 hex in a text id column, or derive the id with a
real namespaced UUIDv5. Add a property test asserting distinct keys → distinct ids.

### WR-A4: in-memory `seedEvent` discards `eventType`/`legOccSymbol`/`fillIdsHash`, weakening twin fidelity

**File:** `packages/adapters/src/memory/fills.ts:43-46,194-196` vs `packages/adapters/src/__contract__/fills.contract.ts:50-57`
**Issue:** The contract `SeedEvent` carries `eventType`, `fillIdsHash`, `legOccSymbol`, and
`netAmount`. The memory twin's `MemorySeedEvent` keeps only `calendarId` + `netAmount` and
`seedEvent` pushes just those. It compiles (the param type is a supertype-compatible
structural subset) and the current recompute only needs `netAmount`, so today's tests pass.
But the twin is meant to be a faithful stand-in for the Postgres contract
(architecture-boundaries §8). The moment recompute is corrected to handle ROLL per-leg
amounts (WR-A1) or any test asserts on `eventType`/`legOccSymbol`, the twin will silently
diverge from Postgres and the shared contract suite will no longer exercise equivalent
behavior. Note also `MemorySeedEvent` lacks `eventType`/`fillIdsHash`/`legOccSymbol`
entirely, so the twin cannot represent a ROLL at all.
**Fix:** Mirror the full `SeedEvent` shape in `MemorySeedEvent` and store it, so the twin
can model the same events the Postgres adapter does (and support the WR-A1 fix).

---

## Info

### IN-A1: `extractLastError` still loops `Object.entries` instead of a direct narrow (round-1 IN-02 not addressed)

**File:** `packages/adapters/src/postgres/repos/job-runs.ts:63-69`
**Issue:** Carries the round-1 IN-02 suggestion unchanged. The single-known-key extraction
loops over all entries.
**Fix:** `if (typeof output === "object" && output !== null && "message" in output && typeof output.message === "string") return output.message;`

### IN-A2: `flattenTransaction` hardcodes `commission`/`fees` to null and time-zeroes `filledAt`

**File:** `packages/core/src/journal/application/syncTransactions.ts:125,140-141`
**Issue:** `filledAt = new Date(tx.tradeDate + "T00:00:00Z")` discards intraday time (the
adapter parses `tx.time` but the use-case ignores it, using only `tradeDate`), and
`commission`/`fees` are always `null`. Fees-on-close feed `computeRealizedPnl`
(`syncFills.ts:301,370`), so realized P&L will systematically omit commissions/fees until a
later plan populates them. Not wrong for this delta's scope (the source is a stub-grade
flattener), but worth a tracking note so realized P&L is not silently fee-blind in
production. The fixed `T00:00:00Z` also means all of a day's fills share a `filledAt`,
which is fine for date-grained pairing but loses ordering.
**Fix:** Thread `tx.time` (and per-leg cost/fee fields the adapter already parses) into the
RawFill when available; document the null-fee limitation until then.

---

## Cross-cutting checks (passed)

- **Dependency law:** `packages/core` imports only `@morai/shared` and intra-context types;
  no `node:*`/`crypto`/drizzle/hono/pg-boss leaked in (grep-verified). syncTransactions
  reaches the brokerage context through its application `ports.ts` (architecture §7), not its
  domain.
- **No `any`/`as`/`!`:** none in the new non-test code; only `as const` in the worker
  composition root (allowed).
- **Zod-parse-at-boundary:** the Schwab transactions adapter `safeParse`s the network body
  (`transactions-adapter.ts:158-164`) and never throws across the port; the sync-transactions
  handler Zod-parses `job.data` (`sync-transactions.ts:51-56`).
- **Idempotency:** `writeFills` is `onConflictDoNothing` on the id PK (Postgres + memory
  twin); deterministic fill ids make a re-run of the same window a no-op (modulo WR-A3).
- **Twin parity:** `memory/fills.ts` runs the identical `runFillsContractTests` suite as the
  Postgres repo; both green.
- **Adapters thin:** `sync-transactions` handler and `jobs.routes` are parse→call→map only.
- **Typecheck + tests:** `bun run typecheck` clean; 281 tests pass (incl. Postgres + memory
  fills contracts).

---

_Reviewed: 2026-06-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard · Round: 2_
