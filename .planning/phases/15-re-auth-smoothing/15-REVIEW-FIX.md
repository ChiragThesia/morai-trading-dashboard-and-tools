---
phase: 15-re-auth-smoothing
fixed_at: 2026-07-02T15:05:00Z
review_path: .planning/phases/15-re-auth-smoothing/15-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-07-02T15:05:00Z
**Source review:** .planning/phases/15-re-auth-smoothing/15-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (fix_scope: critical_warning — WR-01..WR-04; 6 Info findings out of scope)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### WR-01: `seed_token.py exchange` reports success after a failed exchange

**Files modified:** `apps/sidecar/seed_token.py`
**Commit:** d8cacd4
**Applied fix:** `step_exchange` now passes its `failures` list to `_verify_and_finish`,
which exits non-zero naming the failed app(s) ("do NOT restart the sidecar") and suppresses
the "Done. Now restart" instruction when any exchange failed. Verification query changed
from `token_json IS NOT NULL` to `refresh_issued_at > now() - interval '5 minutes'`, so a
stale row from a previous seed prints `STALE — not written by this run` instead of `seeded`.
Verified with `python3 ast.parse` (clean).

### WR-02: Web UI is completely silent when the market app is AUTH_EXPIRED

**Files modified:** `apps/web/src/components/AuthExpiredBanner.tsx`, `apps/web/src/components/AuthExpiredBanner.test.tsx`
**Commit:** b3d3470
**Applied fix:** Added an `isMarketExpired` gate: a market-only AUTH_EXPIRED now keeps the
amber banner up with accurate copy ("Schwab market app auth expired — chain data fell back
to CBOE. Re-auth per `docs/operations/schwab-reauth-runbook.md`."). Red (trader) keeps
precedence. Doc comment updated to reflect the new gate. TDD: the review's suggested
market-expired test plus a both-expired red-precedence test were added first and run RED,
then the gate change — suite GREEN 12/12 (`bunx vitest run` in `apps/web`).

### WR-03: Architecture docs still describe the retired `refresh-tokens` job as an active daily cron

**Files modified:** `docs/architecture/deployment.md`, `docs/architecture/jobs.md`
**Commit:** d6d835f
**Applied fix:** `deployment.md` token-persistence bullet now states the schwab-py sidecar
is the sole token refresher (GW-03, `refresh-tokens` cron retired). `jobs.md`: cron-table
row marked RETIRED (GW-03) pointing at the section; the "Token refresh at 04:00 ET" notes
bullet reconciled; the full `refresh-tokens` section replaced with a RETIRED section
recording the Phase 5 origin, Phase 11 sidecar cutover, and Phase 15 trigger-surface
removal, plus the surviving 7-day re-auth facts (runbook + `refreshExpiresIn` warning).

### WR-04: Memory twin cannot clear `lastRefreshError` to null (`??` swallows the explicit null)

**Files modified:** `packages/adapters/src/memory/broker-tokens.ts`, `packages/adapters/src/memory/broker-tokens.test.ts`
**Commit:** 21da1e0
**Applied fix:** Replaced the `??`-based merge with the review's `has()`-based merge in both
`readTokens` and `readTokenFreshness`, so an explicitly recorded `null` ("last refresh
succeeded — clear the flag") wins over the row's stale value — matching the Postgres repo.
TDD: created `broker-tokens.test.ts` (twin had no test file) with two null-clear regression
tests (run RED first) plus a non-null flag-ownership baseline — GREEN 3/3. Root
`bun run typecheck` reports no errors in the touched files (pre-existing TS2307
workspace-resolution noise from raw `bunx tsc` confirmed pre-existing via stash baseline).

---

_Fixed: 2026-07-02T15:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
