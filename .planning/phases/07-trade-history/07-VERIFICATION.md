---
phase: 07-trade-history
verified: 2026-06-22
status: passed
score: 2/2 success criteria verified (offline) + 1 review round
overrides_applied: 0
human_verification:
  - test: "After Schwab auth + healthy deploy, call MCP get_transactions for a date range"
    expected: "Returns a transactionsResponse-valid array of the user's trades; default last-90d when params omitted"
    why_human: "Requires live Schwab tokens (OAuth dance) + a deploy with db up; the tool + contract are unit-tested offline"
  - test: "Run `bun run backfill-transactions <from> <to>` against live Schwab"
    expected: "fills populated across the range (chunked by per-call window); re-run adds 0 rows; range > 365d rejected; CONFIRM Schwab's real per-call range limit and adjust SCHWAB_TX_MAX_RANGE_DAYS (default 90) if different"
    why_human: "Requires live Schwab tokens + DATABASE_URL; chunk math + idempotency + over-cap proven offline (fast-check + in-memory twin)"
---

# Phase 7: Trade History — Verification Report

**Phase Goal:** MCP `get_transactions` (date-ranged, shared contract) + a historical `sync-transactions` backfill (chunked, idempotent) so trade history flows into `fills` → calendar events.
**Verified:** 2026-06-22 (offline; live pull deferred to operator prerequisites)
**Status:** passed — 2/2. Built + proven OFFLINE (msw/faked use-case + in-memory twin + fast-check). A live pull additionally needs the Schwab OAuth dance + a healthy deploy (db up).

## Observable Truths (Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC1 | MCP `get_transactions` returns date-ranged trades over the shared `transactionsResponse` contract (default 90d); AUTH_EXPIRED → typed payload | PASS | The tool already existed (Phase 4); 07-01 added behavioral coverage: explicit range, default-90d, AUTH_EXPIRED → typed `brokerageAuthExpiredPayload`, contract-validates the success payload. WR-02 fix: fetch-error now returns a structured `{error}` envelope (not a bare string) — tested. No live call (faked use-case). |
| SC2 | Backfill runs `sync-transactions` over an arbitrary past range, chunked within Schwab's lookback cap, writing `fills`; re-run idempotent (0 dup rows) | PASS | `chunkDateRange` pure domain (fast-check 1000 runs: no gaps, no overlap-dupes, window ≤ cap, contiguous inclusive boundaries; typed err on bad input). `runBackfill` CLI: full-range write across chunk boundaries, idempotent (in-memory twin: 0 new rows on re-run), errors (no silent truncation) when total span > 365d. WR-04 fix: per-call window (`SCHWAB_TX_MAX_RANGE_DAYS`=90) is now distinct from total lookback (365) so chunking actually splits in prod. |

**Score: 2/2 PASS (offline).** Full suite 976 tests / 106 files green; typecheck + lint clean. Live execution deferred — see human_verification.

## Requirements Coverage
| Requirement | Status | Evidence |
|---|---|---|
| BRK-03 (get_transactions MCP, shared contract) | SATISFIED | SC1; tool verified + documented + structured-error fix |
| BRK-04 (historical chunked idempotent backfill) | SATISFIED | SC2; chunkDateRange + backfill CLI |

## Review
1 round (07-REVIEW.md): 0 blockers, 4 warnings + 3 info — date math verified correct by hand + fast-check. All warnings fixed (07-REVIEW-FIXES.md): WR-01 Zod-parse CLI args, WR-02 structured error envelope, WR-03 test stabilization, WR-04 per-call vs total cap separation (chunking now live in prod).

## Deferred / operator prerequisites (the live frontier)
- Schwab OAuth dance (`auth setup trader`/`market`) — no live Schwab call works without tokens.
- Healthy prod deploy — the deployed server currently reports `db: down` + stale (pre-Phase-5/6); needs redeploy + DATABASE_URL fix before live data flows.
- First live backfill: confirm Schwab's real per-call transactions range limit; adjust `SCHWAB_TX_MAX_RANGE_DAYS` if it differs from the conservative 90d default.

---
_Verified: 2026-06-22 · Verifier: Claude (goal-backward + 1 review + fix round) · offline-proven_
