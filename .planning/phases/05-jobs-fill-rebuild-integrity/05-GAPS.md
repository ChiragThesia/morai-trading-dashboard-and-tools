# Phase 05 — Gaps & Completion Scope (post-review)

**Date:** 2026-06-22
**Source:** `05-REVIEW.md` (4 critical + 8 warning, all confirmed against source) +
`05-VERIFICATION.md` (corrected to 3/5 — SC4 + SC5 fail).

This document scopes a completion/fix round for Phase 05. SC1 (job backbone), SC2
(refresh-tokens), SC3 (bsm drain) are genuinely done. SC4 (fill-pairing) and SC5
(rebuild) are buggy **and** unwired (no fills repo, no fills source) — they run against
stubs in `apps/worker/src/main.ts:203-208,264-269`.

## Locked decisions (from user, 2026-06-22)

1. **Scope = complete the full SC4/SC5 vertical slice**, not just patch logic. Build the
   real data path so sync-fills and rebuild-journal actually work end-to-end and SC4/SC5
   can be verified for real.
2. **Realized-P&L model = read the original open debit at close.** On CLOSE/ROLL, look up
   the prior OPEN event for the leg and compute
   `realizedPnl = closeCredit − originalOpenDebit − feesOnClose`. The new leg's premium on
   a ROLL belongs to cost basis / `netAmount`, NOT to `realizedPnl`. Update `D-08`/`D-09`
   in the architecture docs FIRST (docs-before-architecture rule), then implement.

## Work items

### A. Data path (makes SC4/SC5 operational — the main gap)
- **A1. Fills repo.** Implement `ForReadingUnprocessedFills` + `ForReadingCalendarLegs`
  + `ForResettingCalendarAmounts` against the existing `fills` table (`schema.ts:165`).
  Postgres adapter + in-memory twin + testcontainer contract tests (TDD).
- **A2. Calendar-scoped sync** (fixes CR-04). Add a calendar-scoped
  `readUnprocessedFills`/sync variant so `rebuild-journal` re-pairs ONLY the target
  calendar. Do not discard `calendarId`.
- **A3. Calendar-amounts recompute** (fixes WR-08). Add a port that recomputes and writes
  `openNetDebit`/`closeNetCredit` from the rebuilt events; call it as the final
  reconciliation step. Decide and document which component owns the calendar aggregate.
- **A4. Fills source.** Populate the `fills` table from Schwab transactions (Phase-04
  transactions adapter already exists). Confirm whether this belongs in Phase 05 or is a
  named Phase-6 dependency — but SC4/SC5 cannot be verified without a source.
- **A5. Real wiring.** Replace the stubs in `worker/main.ts` with the real repo/source.

### B. Domain correctness (fix the P&L bugs)
- **B1. Realized P&L** per the locked decision above (WR-01).
- **B2. detectRoll** — require same root + strike + type + DIFFERENT expiry, not just
  different OCC in same order (WR-02).
- **B3. aggregatePartialFills** — remove dead internal grouping / placeholder fields;
  treat `sumQty <= 0` as an error, not `avgPrice = 0` (WR-03).
- **B4. classifyFill / side** — either implement the documented side+positionEffect matrix
  and validate real `fill.side`, or drop the dead `side` param (WR-06).
- **B5. UNKNOWN orphan parking** — park each underlying raw fill individually with real
  side/`filledAt`; never synthesize a non-UUID fillId (it violates the `orphan_fills`
  uuid PK and aborts the whole sync run); never silently drop siblings (WR-07).

### C. Criticals & infra
- **C1. CR-01 (boundary).** Core (`fill-pairing.ts`, `syncFills.ts`) imports Node
  `crypto`. Inject `newId: () => string` and a hasher port (or move id/hash minting to
  the adapter layer) so `packages/core` imports only `@morai/shared`. Do NOT re-evade the
  lint with a bare specifier.
- **C2. CR-02 (token refresh).** Distinguish transient (`network`/`parse`) from terminal
  (`invalid_grant`/`invalid_client`). Only terminal → `auth-expired`; transient → a
  retryable error so pg-boss retries and status does not falsely claim expiry.
- **C3. CR-03 (job-runs).** `readJobRuns` must report last-success AND last-error
  independently per job (separate `DISTINCT ON`/`MAX FILTER` per state), per the
  `JobRunRecord` contract.
- **C4. WR-04 (dedup).** Require `calendarId` for `rebuild-journal` at the contract/route
  boundary; reject (400) a rebuild trigger lacking it rather than enqueuing a null-keyed
  job that floods the queue.
- **C5. WR-05 (twin).** Memory job-queue twin must return `ok(null)` on a dedup hit to
  mirror pg-boss singletonKey semantics (architecture-boundaries §8).
- **C6. Info (optional).** IN-01 dead `void pgBossJobQueue`; IN-02 simplify `lastError`
  extraction; IN-03 server enqueue-PgBoss shutdown hook.

## Verification target
Re-run the full suite; re-do goal-backward verification with SC4/SC5 exercised against the
REAL repo/source (not stubs); re-review the fix delta; then merge phases 04+05.
