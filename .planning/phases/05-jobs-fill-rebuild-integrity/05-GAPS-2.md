# Phase 05 — Gap Round 2 (post re-review)

**Date:** 2026-06-22
**Source:** `05-REVIEW-2.md` — re-review of the round-1 gap delta. Round-1 fixes verified
genuine (4/4 critical, 7/8 warning). This round closes the new findings.
**Decision (user, 2026-06-22):** Full round-2 fix — all items below + fast-check property
tests over random fill/roll/partial sequences. Then re-review #3 → merge.

## Findings to close

### CR-A1 (BLOCKER) — WR-04 not applied to the MCP adapter
`apps/server/src/adapters/mcp/tools/trigger-job.ts` validates with its own inline schema
that leaves `calendarId` optional; a `trigger_job {name:"rebuild-journal"}` with no
calendarId still enqueues a null-keyed job (queue flood). The HTTP route was fixed; the MCP
tool was not. Architecture-boundaries §9: both adapter surfaces share one contract.
**Fix:** Route the MCP tool through the same `triggerJobBodyFor(name)` / refinement the HTTP
route uses; reject a rebuild-journal trigger lacking calendarId (typed error, no enqueue).
Add an MCP-level test mirroring the route test.

### WR-A1 — ROLL events break calendar-amount reconciliation
A ROLL event stores a combined `netAmount = openDebit − closeCredit`.
`recomputeCalendarAmounts` buckets by sign, so a roll collapses into one aggregate and SC5
reconciliation fails for any calendar containing a roll.
**Decision/Fix:** `recomputeCalendarAmounts` sums by `eventType`, not by sign:
OPEN.netAmount → `openNetDebit`; CLOSE.netAmount → `closeNetCredit`; ROLL → split via its
leg components (opening-leg debit → `openNetDebit`, closing-leg credit → `closeNetCredit`).
Persist the ROLL's open/close components explicitly (dedicated columns or structured
`legBreakdown` the recompute reads) rather than re-parsing free JSON. Add a contract test
with a roll in the calendar.

### WR-A2 — "processed" defined as "in orphan_fills" → re-pair forever + partial-fill double-count
`fills.ts` `readUnprocessedFills` returns all fills NOT in `orphan_fills`, relying on the
`fill_ids_hash` UNIQUE to absorb re-emission. Paired fills are re-read every sync; a grown
partial-fill bucket changes the hash → a SECOND event → the position is double-counted.
**Decision/Fix:** Track processed fills explicitly.
- Migration: add `processed_at timestamptz NULL` to the `fills` table.
- New port `ForMarkingFillsProcessed(fillIds)`; `syncFills` marks a bucket's fills processed
  once their event is stored (and orphans are already parked → also "processed").
- `readUnprocessedFills` = `WHERE processed_at IS NULL AND id NOT IN (SELECT fill_id FROM orphan_fills)`.
- Semantics: each fill is incorporated into exactly ONE event; fills arriving in a later
  sync for the same order/leg form a new event covering only the new fills (no fill is
  counted twice). Document this so "partial-fill growth across syncs" is well-defined.
- Update the in-memory twin + the shared contract test to cover: re-run does not re-emit;
  a fill added in a second sync produces exactly one additional event covering only it.

### WR-A3 — `hexToUuid` drops a hex nibble → id collisions → silent fill drop
`syncTransactions.ts:66-67`: `timeMid = h.slice(8,12)` then `"5" + h.slice(13,16)` skips
`h[12]`. Two distinct `(activityId, legIndex)` keys can map to the same UUID →
`onConflictDoNothing` on the fills id PK silently drops a real fill.
**Fix:** Use a contiguous, total mapping of the hash (e.g. `h.slice(12,15)` for the
version field, or build all 32 nibbles with version/variant overwritten in place) so every
input nibble contributes. Add a test: two keys differing only at the previously-dropped
nibble yield different UUIDs.

### WR-A4 — memory `seedEvent` discards eventType/legOccSymbol/fillIdsHash
The twin can't represent a ROLL, so contract parity is undermined once WR-A1 lands.
**Fix:** `seedEvent` carries all event fields (eventType, legOccSymbol, rolledFromOccSymbol,
fillIdsHash, the open/close components for ROLL). The shared contract test seeds a roll and
asserts recompute parity between postgres and memory.

### IN (optional) — IN-02 (round 1) still open; sync-transactions hardcodes fees=null and zeroes filledAt
`syncTransactions.ts:140-141` sets commission/fees null and time-zeroes `filledAt`, making
realized P&L fee-blind and the orphan audit time wrong. Fix if cheap: carry real
commission/fees and the real fill timestamp from the BrokerTransaction.

## Property tests (locked decision — this round)
Add fast-check property tests over randomized fill sequences feeding sync-fills + rebuild:
- No fill is ever counted in more than one event (sum of event qty == sum of distinct fills).
- Re-running sync over the same fills is a no-op (idempotent: event count stable).
- After rebuild, `openNetDebit`/`closeNetCredit` equal the summed events for OPEN/CLOSE/ROLL.
- Distinct `(activityId, legIndex)` → distinct fill UUID (no collisions).

## Verification target
Full suite green; the property tests above pass; re-review #3 finds no blocker; then merge 04+05.
