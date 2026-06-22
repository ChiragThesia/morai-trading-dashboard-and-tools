---
phase: 06-derived-analytics
verified: 2026-06-22
status: passed
score: 4/4 success criteria verified (after 1 gap round + 2 code reviews)
overrides_applied: 0
merge_status: NOT MERGED — left on branch plan/06-derived-analytics for operator review (per operator choice)
resolution_note: >
  Phase 6 shipped 5 plans (06-01..06-05), then code review (06-REVIEW.md) found 2 BLOCKER +
  4 WARNING — a cycle-resolution seam (compute-analytics read the smile by exact now() and
  stamped now(), so it wrote 0 skew/RR rows in prod and broke idempotency on retry) that the
  green suite hid because tests reused one now() Date. Gap round (06-06..06-08) fixed it:
  data-anchored single cycle instant (never now()), bounded latest-≤-anchor smile read,
  structural single-anchor (skew/term share one snapshot_time), empty-rank→null, bracket-width
  gate, delta-sign sanity, moneyness populated. Re-review #2 (06-REVIEW-2.md) = clean bill.
  SC1-SC4 now hold, proven by testcontainer contract suites + fast-check property tests.
human_verification:
  - test: "Run `bun run migrate` against production Supabase (migration 0007_analytics_observations)"
    expected: "3 analytics tables (skew_observations, risk_reversal_observations, term_structure_observations) created; second run is a no-op"
    why_human: "Requires production DATABASE_URL; deferred per operator (same as phases 03/04/05). Validated idempotent on testcontainer Postgres 16."
  - test: "After a live snapshot-calendars cycle in production, GET /api/analytics/skew + /api/analytics/term-structure"
    expected: "Both return contract-valid JSON arrays with ≥1 entry; skew + term rows for the cycle share one snapshot_time"
    why_human: "Requires a deployed worker + live chain/snapshot data; the logic is testcontainer + property proven."
---

# Phase 06: Derived Analytics — Verification Report

**Phase Goal:** A `compute-analytics` job, chained after each `snapshot-calendars` cycle, writes skew + term-structure observations; `GET /api/analytics/skew` and `/api/analytics/term-structure` (and MCP `get_skew` / `get_term_structure`) return current + historical series over a shared contract.
**Verified:** 2026-06-22 (after 1 gap round + 2 code reviews)
**Status:** passed — 4/4. NOT merged (left on branch for operator review).
**Method:** Goal-backward, then corrected by code review + gap round. The first green suite hid a production-breaking cycle-resolution seam; correctness came from the review + the testcontainer/property tests, not the original example tests.

---

## Observable Truths (Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC1 | After `snapshot-calendars` completes, `skew_observations` gains append-only rows for that snapshot time; duplicate runs produce no duplicate rows | PASS | Full per-strike smile written per (underlying, expiration, strike); idempotent on the composite PK. **Production seam fixed** (06-06): cycle instant resolved from DATA (not `now()`), bounded latest-≤-anchor smile read. Proven by the Postgres testcontainer seam suite (distinct broker/snapshot/now instants — FAILS on old exact-`now()` code) + a fast-check run-twice idempotency property (0 new rows). |
| SC2 | After a cycle, `term_structure_observations` captures `back_iv − front_iv` per calendar; matches the `term_slope` in the corresponding `calendar_snapshots` row | PASS | term value = `term_slope` passed through unchanged (no recompute); testcontainer contract asserts `written === source term_slope`; idempotent on (calendar_id, snapshot_time). Skew + term share one `snapshot_time` per cycle (structural single-anchor, 06-06). |
| SC3 | `GET /api/analytics/skew` + `/api/analytics/term-structure` return JSON arrays of `{ time, value, … }` | PASS | Both routes return contract-valid arrays (value = 25Δ risk-reversal + `rrRank` for skew; term value for term-structure); empty array (not error) when no data; route tests green. |
| SC4 | MCP `get_skew` / `get_term_structure` return the same series as HTTP, validated against the shared `contracts` Zod schema | PASS | Both surfaces import ONE `@morai/contracts` analytics schema (MCP-02); a one-sided schema change fails `bun run typecheck`; MCP tests green. |

**Score: 4/4 PASS.** Proven in-process by testcontainer Postgres 16 contract suites + fast-check property tests (945 tests / 102 files). Live-prod checks (migration push, deployed read surface) deferred — see human_verification.

---

## Behavioral Spot-Checks

| Layer | Result | Status |
|---|---|---|
| Skew numerics domain (RR interpolation incl. null-when-unbracketable + bracket-width gate; percentile rank incl. empty→null) — fast-check 1000 runs | green | PASS |
| Analytics repos (skew, risk_reversal, term_structure, smile read) — testcontainer Postgres 16 contract suites | green (not skipped) | PASS |
| compute-analytics seam suite (distinct broker/snapshot/now timestamps + run-twice idempotency) — testcontainer | green; reproduced the bug on old code | PASS |
| HTTP routes + MCP tools over shared contract | green | PASS |
| Full workspace suite `bun run test` | **945 / 102 files PASS** | PASS |
| Typecheck / Lint | clean / clean (deprecation warnings only) | PASS |

---

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| ANLY-01 (skew smile + RR + rank, idempotent) | SATISFIED | SC1; 06-01/03/05 + 06-06/07/08 fixes |
| ANLY-02 (term-structure observations) | SATISFIED | SC2; 06-04 |
| ANLY-03 (GET /api/analytics/* current + historical) | SATISFIED | SC3; 06-04/06-05 |
| MCP-02 (one shared schema, HTTP↔MCP) | SATISFIED | SC4; 06-01/04/05 |

---

## Trajectory (audit trail in-repo)
5 plans (06-01..06-05) → review found the cycle-resolution seam (06-REVIEW.md, 2 blocker) → gap round (06-06..06-08, 06-GAPS.md) → re-review #2 clean (06-REVIEW-2.md). Lesson (again): a green suite that reuses `now()` can hide a real production seam — testcontainers with distinct timestamps + property tests caught it.

## Deferred (tracked)
- Live production migration `0007_analytics_observations` push (operator runs `bun run migrate`) — `deferred-items.md`.
- Live deployed read-surface check — human_verification above.

---

_Verified: 2026-06-22 · Verifier: Claude (goal-backward + 2 reviews) · NOT merged — operator review pending_
