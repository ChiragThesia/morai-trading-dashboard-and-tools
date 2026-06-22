---
phase: 05-jobs-fill-rebuild-integrity
verified: 2026-06-22T10:00:00Z
status: passed
score: 5/5 success criteria verified (after 2 gap rounds + 3 code reviews)
head: 011470a
overrides_applied: 0
resolution_note: >
  TRAJECTORY: initial 5/5 was WRONG (trusted a green suite that codified buggy behavior).
  Round-1 review (05-REVIEW.md) found 4 critical + 8 warning; corrected verdict was 3/5.
  Gap round 1 (plans 05-09..05-13) built the real fills data path + fixed the P&L/orphan/
  boundary bugs. Re-review (05-REVIEW-2.md) found 1 blocker + 4 warning in the fixes; gap
  round 2 (05-14..05-16) closed them and added fast-check property tests. Those property
  tests then found a residual ordered-key id collision, fixed at root cause. Re-review #3
  (05-REVIEW-3.md) = clean bill, no blocker. SC4 + SC5 now genuinely hold, proven by
  testcontainer contract suites + property tests. Final verdict: 5/5.
  Deferred (out of scope, tracked): realized P&L is fee-blind until BrokerTransaction
  carries per-leg fees/time (docs-first change); + the live-prod checks below.
human_verification:
  - test: "Deploy worker + server; GET /api/status against production Supabase"
    expected: "lastJobRuns lists all 7 jobs; cron jobs advance their lastRun; snapshot-calendars + rebuild-journal present but cronless"
    why_human: "Requires live worker process + production DATABASE_URL; status surface is unit+contract covered but the production view needs a running deploy"
  - test: "Run rebuild-journal against a calendar with real Schwab fill history, then diff calendar_snapshots vs the rows the live snapshot job wrote for the same window"
    expected: "Row-for-row match (SC5 reconciliation) on real broker data"
    why_human: "Requires live Schwab transactions + a populated production snapshot history; in-process reconciliation is proven by rebuildJournal.test.ts + calendar-snapshots.contract.test.ts"
---

# Phase 05: Jobs, Fill-pairing & Rebuild Integrity — Verification Report

**Phase Goal:** All background jobs run behind the `JobQueue` port with deterministic dedupe keys and idempotent handlers; the `sync-fills` path pairs Schwab fills into calendar open/close events; and `rebuild-journal` can reconstruct a calendar's history entirely from broker transactions.
**Verified:** 2026-06-22 (final, after 2 gap rounds + 3 reviews)
**Status:** passed — 5/5. SC1–SC5 all hold, proven by testcontainer contract suites + fast-check property tests (791 tests green). See `resolution_note` for the full trajectory.
**Method:** Goal-backward verification → round-1 review (caught the green suite codifying bugs, 3/5) → gap round 1 (real data path + fixes) → re-review → gap round 2 (close fix-bugs + property tests) → property tests found a residual collision (fixed) → re-review #3 clean. Backend-only phase; SCs machine-verified. Lesson: green tests ≠ correct economics — the correctness came from review + property tests, not the original example tests.

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC1 | All 7 jobs registered in `schedule.ts` + visible in `GET /api/status` under `lastJobRuns` (`snapshot-calendars` chain-triggered, `rebuild-journal` on-demand — both registered, cronless); duplicate enqueues idempotent | PASS | `schedule.ts` declares all 7 via `createQueue` + `work` (lines 64–116); `snapshot-calendars` + `rebuild-journal` registered cronless with explanatory comments. `schedule.test.ts` asserts `registerAllJobs` wires every queue. Dedupe: `dedupe-key.test.ts` (deterministic keys), `job-queue.test.ts` (in-memory twin rejects duplicate singletonKey), `enqueueJob.test.ts` (use-case). Status surface: `jobs.routes.test.ts` (`/api/status` lastJobRuns shape, TRACKED_JOBS). |
| SC2 | `refresh-tokens` (04:00 ET): both Schwab apps refresh independently; one app's failure does not block the other; `/api/status` flags the failing app | PASS | `refreshTokens.test.ts` proves per-app independence via `Promise.allSettled` (one app rejects, other still rotates) + `isNearExpiry` proactive warning. Handler `refresh-tokens.test.ts`: RTH-independent (04:00 daily), surfaces `lastRefreshError` per app to status. |
| SC3 | `compute-bsm-greeks` drains `leg_observations WHERE bsm_iv IS NULL AND mark IS NOT NULL` to 0; idempotent | PASS | `leg-observations.bsm-drain.contract.test.ts` (testcontainer Postgres 16): after run, pending count = 0; re-run is a no-op. `computeBsmGreeks.test.ts`: use-case drains pending, skips already-computed rows. |
| SC4 | `sync-fills` pairs Schwab fills into calendar OPEN/CLOSE (+ROLL) events with correct net debit/credit/P&L; idempotent on re-run | **PASS** (after gap rounds) | Realized P&L now reads the prior OPEN's debit (`closeCredit − originalOpenDebit − fees`; null when no prior OPEN) — WR-01 fixed. UNKNOWN orphans park per-fill with real UUIDs — WR-07 fixed. `detectRoll` requires same root/strike/type + different expiry — WR-02 fixed. Real `fills` repo + Schwab-transactions source replace the stubs. Proven by `fills.contract` (testcontainer Postgres) + `syncFills.property.test.ts` (no double-count, idempotent across re-runs/partial-growth) + a concrete e2e: real txn → CLOSE event realizedPnl = 5−3−0 = 2.0. |
| SC5 | `rebuild-journal` (manual via `trigger_job` MCP tool / API) reconstructs a calendar's history from fills; rebuilt calendar amounts match the live path | **PASS** (after gap rounds) | Calendar-scoped rebuild (delete → reset → scoped re-pair → recompute); `recomputeCalendarAmounts` repopulates `openNetDebit`/`closeNetCredit` summed by `eventType` (ROLL split via persisted components) — WR-08/CR-04/WR-A1 fixed. Stubs removed; processed-fill tracking (`processed_at`) makes re-sync idempotent and rebuild correct. Proven by `calendar-events.contract` (testcontainer, incl. a ROLL) + property P3 (rebuilt amounts == summed events) + e2e idempotent across two rebuilds. |

**Score: 5/5 truths PASS** (final). All proven in-process by testcontainer contract suites + fast-check property tests (791 tests, 84 files). The path to here: initial 5/5 (wrong) → 3/5 (round-1 review) → real data path + fixes (gap round 1) → fix-bug review → gap round 2 + property tests → property-found collision fixed → re-review #3 clean. See `05-REVIEW.md`, `05-REVIEW-2.md`, `05-REVIEW-3.md`, `05-GAPS.md`, `05-GAPS-2.md`.

---

## Behavioral Spot-Checks

| Layer | Command | Result | Status |
|---|---|---|---|
| Unit / in-memory (domain + use-cases + handlers + routes) | `bunx vitest run dedupe-key enqueueJob syncFills rebuildJournal computeBsmGreeks refreshTokens schedule sync-fills rebuild-journal refresh-tokens jobs.routes` | 11 files / 72 tests PASS | PASS |
| Contract (testcontainer Postgres 16): BSM drain, calendar-events, orphan-fills, snapshots, job-queue, migrate idempotency | `bunx vitest run leg-observations.bsm-drain.contract calendar-events.contract orphan-fills.contract calendar-snapshots.contract job-queue orphan-fills.contract(memory) migrate.idempotent` | 7 files / 38 tests PASS | PASS |
| Full workspace suite | `bun run test` | **695/695 PASS (76 files)** | PASS |
| Typecheck | `bun run typecheck` | exit 0 — no errors | PASS |
| Lint | `bun run lint` | exit 0 — config deprecation warnings only, zero lint errors | PASS |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| JOB-01 | All jobs run behind a `JobQueue` port (pg-boss adapter) with deterministic dedupe keys + idempotent, Zod-parsed handlers | SATISFIED | `JobQueue` port + pg-boss adapter + in-memory twin; `dedupe-key` domain; `schedule.ts` (7 jobs); SC1 evidence |
| JOB-02 | `refresh-tokens` (04:00 ET) refreshes both Schwab apps independently + alerts on failure | SATISFIED | SC2 evidence — `allSettled` per-app independence + `isNearExpiry` + status flag |
| JOB-03 | `compute-bsm-greeks` drains `leg_observations WHERE bsm_iv IS NULL` and upserts computed values | SATISFIED | SC3 evidence — testcontainer drain-to-zero + idempotent re-run |
| JRNL-01 | `sync-fills` / rebuild path pairs Schwab fills into calendar OPEN/CLOSE events (net debit/credit/P&L); journal rebuilt from fills, never hand-written | SATISFIED | SC4 + SC5 evidence — pairing use-case, calendar-events/orphan-fills repos, rebuild-journal reconciliation |
| MCP-02 | Every new use-case ships both adapters (HTTP route + MCP tool) in the same change | SATISFIED (this phase) | `trigger_job` HTTP route + MCP tool share one `@morai/contracts` schema; `jobs.routes.test.ts` + RED MCP test |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| _(none)_ | No `any` / `as` / `!`; no `TBD`/`FIXME`/`XXX` in Phase 05 source; no hand-written journal data (rebuild reads fills only) | — | — |

---

## Pending Live Verification

Both items are code-complete and unit/contract tested. They require live external services to execute end-to-end.

### 1. Production `GET /api/status` job visibility
**Test:** Deploy worker + server with production `DATABASE_URL`; `GET /api/status`.
**Expected:** `lastJobRuns` lists all 7 jobs; cron jobs advance `lastRun`; `snapshot-calendars` + `rebuild-journal` present but cronless.
**Why deferred:** Needs a running worker process against production Supabase. Status shape + TRACKED_JOBS proven by `jobs.routes.test.ts`.

### 2. SC5 reconciliation on real broker data
**Test:** Run `rebuild-journal` (via `trigger_job`) on a calendar with real Schwab fill history; diff `calendar_snapshots` against the rows the live snapshot job wrote for the same window.
**Expected:** Row-for-row match.
**Why deferred:** Needs live Schwab transactions + a populated production snapshot history. In-process reconciliation proven by `rebuildJournal.test.ts` + `calendar-snapshots.contract.test.ts`.

---

_Verified: 2026-06-22T00:43:27Z_
_Verifier: Claude (goal-backward)_
_HEAD: 011470a_
