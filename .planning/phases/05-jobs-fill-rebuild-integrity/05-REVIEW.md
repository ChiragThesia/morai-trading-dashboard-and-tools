---
phase: 05-jobs-fill-rebuild-integrity
reviewed: 2026-06-21T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - apps/auth/src/setup.ts
  - apps/server/src/adapters/http/jobs.routes.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/adapters/mcp/tools/trigger-job.ts
  - apps/server/src/main.ts
  - apps/worker/src/handlers/rebuild-journal.ts
  - apps/worker/src/handlers/refresh-tokens.ts
  - apps/worker/src/handlers/sync-fills.ts
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/broker-tokens.ts
  - packages/adapters/src/memory/calendar-events.ts
  - packages/adapters/src/memory/job-queue.ts
  - packages/adapters/src/memory/orphan-fills.ts
  - packages/adapters/src/pgboss/job-queue.ts
  - packages/adapters/src/postgres/migrations/0004_calendar_events.sql
  - packages/adapters/src/postgres/migrations/0005_broker_tokens_refresh_error.sql
  - packages/adapters/src/postgres/repos/broker-tokens.ts
  - packages/adapters/src/postgres/repos/calendar-events.ts
  - packages/adapters/src/postgres/repos/job-runs.ts
  - packages/adapters/src/postgres/repos/orphan-fills.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/jobs.ts
  - packages/contracts/src/status.ts
  - packages/core/src/brokerage/application/ports.ts
  - packages/core/src/brokerage/application/refreshToken.ts
  - packages/core/src/brokerage/application/refreshTokens.ts
  - packages/core/src/brokerage/domain/token-freshness.ts
  - packages/core/src/brokerage/index.ts
  - packages/core/src/index.ts
  - packages/core/src/journal/application/enqueueJob.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/application/rebuildJournal.ts
  - packages/core/src/journal/application/syncFills.ts
  - packages/core/src/journal/domain/calendar-event.ts
  - packages/core/src/journal/domain/dedupe-key.ts
  - packages/core/src/journal/domain/fill-pairing.ts
  - packages/core/src/journal/index.ts
findings:
  critical: 4
  warning: 8
  info: 3
  total: 15
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-21
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Reviewed the Phase 05 ("jobs, fill-pairing, rebuild integrity") source delta against the
hard project rules: dependency law (core imports only shared), no `any`/`as`/`!`,
`Result<T,E>` error handling, Zod-parse-at-boundary, plus the domain-specific correctness
focus (job idempotency, fill-pairing P&L, rebuild reconciliation, per-app token refresh).

The Zod-at-boundary discipline and the in-memory-twin coverage are good, and the OAuth
`setup.ts` CSRF/state-before-exchange ordering is correct. However several correctness
defects warrant blocking:

- The pure hexagon imports the Node `crypto` builtin via a bare specifier — an
  architecture-boundary violation that evades the `node:*` lint rule rather than fixing it.
- `refreshToken.ts` collapses transient network/parse OAuth failures into `auth-expired`,
  which is the same permanent-failure signal as `invalid_grant` and will needlessly pause
  trader endpoints on a network blip.
- `job-runs.ts` (`DISTINCT ON (name)`) structurally cannot populate both `lastSuccessAt`
  and `lastErrorAt` even though the record type and contract promise both independently.
- The wired `rebuild-journal` use-case deletes events for ONE calendar but re-syncs ALL
  calendars (the `syncFillsForCalendar` adapter ignores its `calendarId` argument), so the
  scoped-rebuild contract (D-10) is violated by the composition.

Plus several P&L-semantics and twin-divergence warnings detailed below.

## Critical Issues

### CR-01: Pure hexagon imports the Node `crypto` builtin (architecture-boundary violation)

**File:** `packages/core/src/journal/domain/fill-pairing.ts:14`, `packages/core/src/journal/application/syncFills.ts:26`
**Issue:** `architecture-boundaries.md §2` and `CLAUDE.md` non-negotiable #1 state that
`packages/core` imports ONLY `@morai/shared` — "never node I/O builtins." Both files import
from `"crypto"`:
```ts
import { createHash } from "crypto";   // fill-pairing.ts:14
import { randomUUID } from "crypto";   // syncFills.ts:26
```
The `eslint.config.js` core rule (lines 80-89) blocks the pattern `node:*`. The recent commit
`599e8af "remove type assertions and node:* imports to satisfy lint rules"` evaded the rule by
switching from `node:crypto` to the bare specifier `crypto` — which the `node:*` glob does not
match. This is a lint-evasion workaround, not a root-cause fix: core is still impure and now
depends on a non-portable bare Node builtin specifier. The in-memory adapter correctly uses
`node:crypto` (`memory/job-queue.ts:18`) because adapters may use Node; core may not.
**Fix:** Move ID/hash generation behind injected ports so core stays pure. `randomUUID` should
be supplied as a dep (the use-case already injects `now`; add `newId: () => string`).
`hashFillIds` should accept an injected hasher, OR move `hashFillIds`/event-id minting into the
adapter layer. Do NOT silence with the bare specifier — fix the design or update the
architecture doc first with rationale (per the rule's MUST NOT clause).

### CR-02: Transient OAuth network/parse errors degraded to permanent `auth-expired`

**File:** `packages/core/src/brokerage/application/refreshToken.ts:106-108`
**Issue:**
```ts
// network / parse error — also surface as auth-expired for safe degradation
return err<AuthExpiredError>({ kind: "auth-expired", appId });
```
`auth-expired` is the SAME signal returned for `invalid_grant`/`invalid_client` (a permanent
condition requiring operator re-auth). A transient `network` timeout or a `parse` error from a
malformed-but-recoverable response now produces `auth-expired`, which propagates to
`refreshTokens` outcomes, to `recordRefreshOutcome`, and ultimately makes
`get_positions`/`get_orders`/`get_transactions` return the AUTH_EXPIRED "paused" payload
(`tools.ts:285`, `:338`, `:376`). A 5-second DNS hiccup at 04:00 ET thus presents as
"re-auth required" even though the refresh token is perfectly valid. This defeats the entire
point of D-13's per-app retry isolation.
**Fix:** Distinguish recoverable from terminal failures. Only `invalid_grant`/`invalid_client`
should map to `auth-expired`; `network`/`parse` should surface as a distinct retryable error
(e.g. reuse `StorageError`/a `transient` variant) so the job retries and the status flag does
not falsely claim expiry:
```ts
if (oauthErr.code === "invalid_grant" || oauthErr.code === "invalid_client") {
  return err<AuthExpiredError>({ kind: "auth-expired", appId });
}
// network / parse: transient — let pg-boss retry; do NOT claim expiry
return err<StorageError>({ kind: "storage-error", message: `${appId}: ${oauthErr.code}` });
```

### CR-03: `readJobRuns` can never report both last-success and last-error for a job

**File:** `packages/adapters/src/postgres/repos/job-runs.ts:87-120`
**Issue:** `JobRunRecord` (and the `status.ts` contract) declare `lastSuccessAt`,
`lastErrorAt`, and `lastError` as INDEPENDENT nullable fields ("a job may have succeeded but
never failed, or vice versa" — ports.ts:340). But the query uses
`SELECT DISTINCT ON (name) ... ORDER BY name, completed_on DESC` which returns exactly ONE row
per job — the single most recent run. The mapping then sets:
```ts
lastSuccessAt: state === "completed" ? completedOn : null,
lastErrorAt:   state === "failed"    ? completedOn : null,
```
So if a job's most recent run FAILED, `lastSuccessAt` is forced to `null` even when the job
succeeded an hour earlier; if it most recently succeeded, `lastErrorAt`/`lastError` are
discarded. The status surface (D-10) can therefore never show "last succeeded at X but is now
failing" — the exact operator signal this record was designed for. This is a data-correctness
bug, not cosmetics.
**Fix:** Compute the most-recent completed and most-recent failed timestamp separately, e.g.
two `DISTINCT ON (name)` subqueries (one filtered `state='completed'`, one `state='failed'`)
joined on `name`, or aggregate with `MAX(completed_on) FILTER (WHERE state='completed')` and
`MAX(...) FILTER (WHERE state='failed')` grouped by `name`, then carry the failed run's output
message into `lastError`.

### CR-04: `rebuild-journal` deletes one calendar's events but re-syncs ALL calendars

**File:** `apps/worker/src/main.ts:264-269` (composition of `makeRebuildJournalUseCase`)
**Issue:** `rebuildJournal` (rebuildJournal.ts:40-53) is specified (D-10) to delete-then-reinsert
events for ONE `calendarId`. Step 1 (`deleteCalendarEvents(calendarId)`) is correctly scoped.
But the injected step 3 is:
```ts
syncFillsForCalendar: async (_calendarId) => syncFillsUseCase(),
```
`syncFillsUseCase()` is the FULL-sweep sync — it reads ALL unprocessed fills across ALL
calendars and re-emits events for every calendar. The `_calendarId` argument is discarded.
Consequences once the fills repo is wired: a single-calendar rebuild (a) re-processes every
calendar's fills, and (b) because `readUnprocessedFills` filters to fills "not yet reflected in
calendar_events", and we only deleted the TARGET calendar's events, the OTHER calendars' fills
are already-processed and skipped — meaning the target rebuild may pull fills it does not own
while the intended per-calendar re-pairing never happens correctly. The delete scope and the
sync scope disagree. This is currently masked because `readUnprocessedFills` is a stub returning
`[]` (main.ts:204), but the wiring is incorrect by construction and will produce wrong journals
the moment the fills repo lands.
**Fix:** Provide a genuinely calendar-scoped sync. Either add a `ForReadingUnprocessedFills`
variant that accepts a `calendarId` (and a `ForReadingFillsForCalendar`), or build a second
`makeSyncFillsUseCase` instance whose `readUnprocessedFills` is filtered to the calendar, and
pass THAT as `syncFillsForCalendar`. Do not discard the `calendarId`.

## Warnings

### WR-01: ROLL P&L subtracts the new-leg cost basis from realized P&L

**File:** `packages/core/src/journal/application/syncFills.ts:226-263`
**Issue:** For a ROLL, realized P&L is computed as
`computePnl(openDebit, closeCredit, totalFees) = |closeCredit| - openDebit - totalFees`
(fill-pairing.ts:124). `openDebit = paired.avgPrice * paired.sumQty` is the cost of the NEW
leg being opened. Subtracting the new position's cost basis from realized P&L conflates a
forward-looking cost with a backward-looking realized result: the operator's realized P&L on a
roll should reflect the closed leg's gain/loss (close credit minus the ORIGINAL open debit of
the leg being closed), not minus the new leg's premium. Here `openDebit` is the new leg, and
the original open debit of the closed leg is never referenced. The `legBreakdown` JSON is
internally consistent, but `realizedPnl` is economically wrong for a roll.
**Fix:** Clarify the D-08/D-09 roll P&L definition and implement it: realized P&L on the
closed leg = `closeCredit - originalOpenDebitOfClosedLeg - feesOnClose`. The new leg's debit
belongs to `netAmount`/cost basis, not `realizedPnl`. If the original open debit is not
available at sync time, leave `realizedPnl` null for ROLL until it can be reconciled, rather
than reporting a wrong number.

### WR-02: `detectRoll` flags any different-OCC pair in the same order as a ROLL

**File:** `packages/core/src/journal/domain/fill-pairing.ts:142-157`
**Issue:** `detectRoll` returns `true` whenever close/open share `calendarId` + `orderId` and
have different `legOccSymbol`, with a comment asserting same underlying/strike/type is
"implied." That assumption is not enforced. A calendar has TWO legs with different OCC symbols
(front + back expiry). An order that simultaneously closes the front leg and opens the back leg
of the SAME calendar (a legitimate non-roll adjustment, or a broker that bundles both legs of
one calendar under one orderId) would be misclassified as a ROLL, producing a spurious ROLL
event with `rolledFromOccSymbol` set incorrectly. The detection relies entirely on orderId
co-occurrence with no expiry/strike/type comparison.
**Fix:** Parse the OCC symbols (or carry structured leg metadata on `AggregatedFill`) and
require same root + same strike + same option type + DIFFERENT expiry before classifying a
roll, per the D-03 definition in the docstring.

### WR-03: `aggregatePartialFills` groups by `occSymbol` and always sets positionEffect UNKNOWN

**File:** `packages/core/src/journal/domain/fill-pairing.ts:53-107`
**Issue:** Two problems. (1) `aggregatePartialFills` groups by `${fill.occSymbol}|${fill.orderId}`
(line 70) and hardcodes `positionEffect: "UNKNOWN"` (line 84) and `calendarId: ""` (line 97).
The function's documented contract (group by legOccSymbol, compute positionEffect) is not
honored — it relies entirely on `syncFills` to overwrite all three fields afterward
(syncFills.ts:156-161). The grouping key (`occSymbol`) also differs from the use-case bucket
key (`legOccSymbol`, syncFills.ts:141); they happen to coincide only because the use-case
pre-buckets by leg, making the inner re-grouping redundant. This is dead/misleading logic that
will silently misbehave if `aggregatePartialFills` is ever called directly (the exported,
unit-testable surface). (2) `avgPrice` falls back to `0` when `sumQty <= 0` (line 101), which
would emit a zero-price event rather than flagging the impossible aggregate.
**Fix:** Either remove the internal grouping and make `aggregatePartialFills` aggregate a
single pre-bucketed group, or have it accept and respect a `positionEffect`/`calendarId`
parameter instead of placeholder values. Treat `sumQty <= 0` as an error, not avgPrice 0.

### WR-04: `rebuild-journal` trigger with no `calendarId` defeats dedup

**File:** `apps/server/src/adapters/http/jobs.routes.ts:35-50`, `packages/core/src/journal/application/enqueueJob.ts:59-66`, `packages/contracts/src/jobs.ts:25-27`
**Issue:** `triggerJobPayload.calendarId` is `.optional()`. For `name === "rebuild-journal"`,
`buildDedupeKey` returns `null` when `calendarId` is absent (enqueueJob.ts:65), so EVERY such
trigger enqueues a fresh job with no singletonKey. T-05-24 claims "rebuildDedupeKey inside the
use-case prevents duplicate enqueues for same calendarId," but nothing requires a calendarId
for rebuild-journal at the boundary. A client repeatedly POSTing `/api/jobs/rebuild-journal/trigger`
with an empty body floods the queue with un-deduplicated rebuilds. A rebuild without a
calendarId is also semantically undefined (rebuild what?).
**Fix:** Enforce the rebuild-journal ↔ calendarId requirement at the contract/route boundary
(a refinement: `name === 'rebuild-journal'` ⇒ `calendarId` required), and reject (400) a
rebuild trigger lacking a calendarId rather than enqueuing a null-keyed job.

### WR-05: in-memory job-queue twin diverges from pg-boss dedup return value

**File:** `packages/adapters/src/memory/job-queue.ts:44-52` vs `packages/adapters/src/pgboss/job-queue.ts:36-42`
**Issue:** The port contract (`ForEnqueueingJob`, ports.ts:450-454) says "Returns ok(jobId) on
success; ok(null) when deduplication key already active (no-op)." The pg-boss adapter honors
this: `boss.send` returns `null` on a singletonKey collision, propagated as `ok(null)`. The
memory twin instead returns the EXISTING entry's jobId on a dedup hit (`return ok(existing.jobId)`),
i.e. `ok(string)`. Tests using the twin will see a non-null jobId where production returns null,
masking the "already queued" branch (the exact behavior `triggerJobResponse.jobId` nullable is
meant to convey). Architecture-boundaries §8 requires the twin to match the real port's
contract.
**Fix:** Return `ok(null)` from the memory twin on a dedup hit to mirror pg-boss semantics.

### WR-06: `classifiedSide` fabricates fill side from positionEffect, discarding the real side

**File:** `packages/core/src/journal/application/syncFills.ts:73-75,162-163`
**Issue:** `classifiedSide` maps `positionEffect === "CLOSING" ? "sell" : "buy"`, then
`classifyFill(side, positionEffect)` is called with this synthetic side. But `classifyFill`
(fill-pairing.ts:30-42) ignores `side` entirely and branches only on `positionEffect`. So the
synthetic side is dead input, AND the real fill side (available on `RawFill.side`) is never
used for classification or cross-checking. The OPEN/CLOSE/ROLL classification therefore trusts
`leg.positionEffect` exclusively; a leg row with a stale/wrong positionEffect silently
mis-classifies the event with no buy/sell sanity check. The docstring (fill-pairing.ts:21-28)
describes a side+positionEffect matrix that the implementation does not actually use.
**Fix:** Either remove the unused `side` parameter from `classifyFill` and delete
`classifiedSide`, or implement the documented matrix and validate the aggregated fills' actual
`side` against the classification, parking mismatches as orphans.

### WR-07: UNKNOWN-classification orphan uses fabricated side/timestamp and may collide fillId

**File:** `packages/core/src/journal/application/syncFills.ts:190-203`
**Issue:** When an aggregated fill classifies UNKNOWN, it is parked as an orphan with
`side: "buy"` (hardcoded, line 196), `filledAt: now` (the clock, not the real fill time, line
198), and `fillId: cf.fillIds[0] ?? "agg-unknown-${cf.orderId}"` (line 191). The fallback
`agg-unknown-${orderId}` is not a UUID and will violate the `orphan_fills.fill_id uuid PRIMARY
KEY` (schema.ts:261) — the Postgres insert throws and propagates a StorageError, aborting the
entire sync run. Even with a real first fillId, only ONE of the aggregated fills is parked; the
other fills in the same aggregate are silently dropped (D-05: "never silently dropped"). The
hardcoded side and `now` timestamp also corrupt the orphan record's audit value.
**Fix:** Park each underlying raw fill individually (loop over `cf.fillIds`) preserving real
side/filledAt, and never synthesize a non-UUID fillId. If no fillId exists the aggregate is
malformed and should surface an error rather than a bogus PK.

### WR-08: rebuild "reconciliation" resets amounts but never recomputes calendar net debit/credit

**File:** `packages/core/src/journal/application/rebuildJournal.ts:40-53`, `apps/worker/src/main.ts:266`
**Issue:** `rebuildJournal` step 2 calls `resetCalendarAmounts(calendarId)` to NULL
`openNetDebit`/`closeNetCredit`, then re-runs sync. But `syncFills` only writes
`calendar_events` rows — it never writes back `openNetDebit`/`closeNetCredit` on the `calendars`
row (no such port is injected; `resetCalendarAmounts` is the only amounts writer and it only
clears). So after a rebuild, the calendar's derived totals are left NULL, never repopulated.
SC5 ("P&L reconciles after rebuild") cannot hold: the journal events exist but the
calendar-level aggregates are blanked. The worker wiring further uses a no-op
`resetCalendarAmounts: async () => ok(undefined)` (main.ts:266), so even the clear is fake.
**Fix:** Add a port that recomputes and writes `openNetDebit`/`closeNetCredit` from the rebuilt
events (or have `syncFills` maintain them), and call it as a final reconciliation step. Document
which component owns the calendar-level aggregate so it is not left perpetually NULL.

## Info

### IN-01: `void pgBossJobQueue` dead wiring in worker composition root

**File:** `apps/worker/src/main.ts:167-169`
**Issue:** `const pgBossJobQueue = makePgBossJobQueue(boss); void pgBossJobQueue;` — the queue
adapter is constructed and immediately discarded with a `void` to suppress the unused-var
lint. The comment says it will be wired into trigger_job in plan 05-08, but as shipped it is
dead allocation. The server composition root wires its own separate `PgBoss` for enqueueing
(main.ts:140), so the worker's enqueue path is unused.
**Fix:** Remove the construction until it is actually consumed, or wire it. Dead `void`-ed
bindings hide real unused-dependency bugs.

### IN-02: `lastError` extraction iterates object entries instead of direct property read

**File:** `packages/adapters/src/postgres/repos/job-runs.ts:61-77`
**Issue:** `extractLastError` does `Object.entries(output)` then loops to find `key === "message"`
to avoid an `as` cast. A simpler, equally type-safe read is
`"message" in output && typeof output.message === "string"` after narrowing
`typeof output === "object" && output !== null`. The loop is unnecessary complexity for a single
known key.
**Fix:** Narrow with `in` and a `typeof` guard; drop the entries loop.

### IN-03: Server boot enqueue-PgBoss `start()` has no shutdown/teardown

**File:** `apps/server/src/main.ts:140-141`
**Issue:** `const jobBoss = new PgBoss(...); await jobBoss.start();` opens a second pg-boss
pool in the server process purely for enqueueing, with no corresponding `stop()` on shutdown.
Not a correctness bug for a long-running process, but it leaks the pool on graceful restarts and
duplicates the connection budget alongside the worker's pg-boss. Worth a tracking note.
**Fix:** Register a shutdown hook that calls `jobBoss.stop()`, or document why the leak is
acceptable.

---

_Reviewed: 2026-06-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
