# Phase 06 — Gap Round (post-review)

**Date:** 2026-06-22
**Source:** `06-REVIEW.md` — 2 BLOCKER + 4 WARNING + 2 INFO. Numeric core (RR interpolation,
percentile rank, term_slope passthrough, migration grains) verified sound. The defect is the
**cycle-resolution seam** in `computeAnalytics`, hidden by tests that reuse the same `now()` Date.
**Decision (user, 2026-06-22):** full fix round, then re-review + verify, leave Phase 6 unmerged.

## Root cause (CR-01 + CR-02)

`computeAnalytics.ts` does `const cycle = deps.now()` (wall-clock) then:
- `readSmile(cycle)` — but Postgres `readSmile` matches `leg_observations.time` EXACTLY, and that
  column is the broker `observedAt` (`fetchChain` writes it), never equal to compute-analytics'
  `now()`. → 0 skew rows + 0 RR rows in production (CR-01).
- stamps skew/RR rows `snapshotTime = cycle = now()` → PK `(snapshot_time, …)` never collides on a
  retry/re-trigger (new `now()`), so `onConflictDoNothing` is defeated → duplicate rows every run,
  and skew `snapshot_time` ≠ term `snapshot_time` for the same cycle (CR-02).

Term-structure is immune: it uses `readSnapshotsForCycle` (latest snapshot ≤ now) and stamps
`snap.snapshotTime`. The fix makes the smile/RR half follow the same data-anchored pattern.

## Locked design decision (cycle resolution)

`computeAnalytics` must resolve ONE canonical cycle instant from DATA, never from `now()`, and
stamp all three tables (skew, risk_reversal, term_structure) with that SAME instant:

1. Resolve the cycle anchor = the snapshot cycle's `snapshotTime` from `readSnapshotsForCycle(now)`
   (the latest snapshot cycle ≤ now). This is the canonical cycle instant.
2. Smile read = the latest `leg_observations` cycle **at or before** the anchor (a "latest ≤ cycle"
   read, NOT exact equality) — mirror `readSnapshotsForCycle`'s resolution. Add the bounded read
   to the leg-observations repo + twin + contract.
3. Stamp skew_observations, risk_reversal_observations, AND term_structure_observations all with the
   resolved anchor instant, so a re-run hits the PKs (idempotent: 0 new rows) and all three tables
   share one `snapshot_time` per cycle.
4. Edge — no snapshots for the cycle: anchor falls back to the smile's own latest `leg_observations`
   time (skew/RR still computed from the chain; no term rows). If neither snapshots nor smile exist,
   the job is a clean no-op. Document this.
5. `now()` stays injected only to bound "≤ now" resolution — it is NEVER a stamped value.

**Tests MUST catch the seam:** use DISTINCT timestamps — broker `observedAt` (smile) and snapshot
`snapshotTime` BOTH different from the injected wall-clock `now()`. The contract/use-case test must
FAIL on today's code (exact-`now()` read → 0 rows; now()-stamp → dup on re-run) and pass after the
fix. Add an idempotency property: running the job twice for one cycle yields identical row counts.

## Work items

- **B1 (CR-01)**: data-anchored smile read — add `readSmileForCycle`/bounded "latest ≤ cycle" read to
  leg-observations repo + twin + contract; `computeAnalytics` uses it. RED test with broker
  `observedAt` ≠ `now()` proving 0-rows today.
- **B2 (CR-02)**: stamp skew/RR/term with the resolved anchor instant (not `now()`); idempotency
  property test (run twice → 0 new rows; PKs collide). Verify skew & term share one snapshot_time.
- **W1 (WR-01)**: `percentileRank` empty history → null (not 100); `computeAnalytics`/`getSkew` carry
  null rank through the contract; update the 06-03 example test to the corrected contract.
- **W2 (WR-02)**: `interpolateRiskReversal` — guard/notes on bracket width (don't interpolate across
  an excessively wide non-adjacent bracket; decide a sane max gap or document why unbounded is fine).
- **W3 (WR-04)**: smile read — delta-sign sanity (a put must have delta ≤ 0, call ≥ 0) so a mis-signed
  row can't land in the wrong wing; drop/park bad rows.
- **W4 (WR-03)**: `moneyness` is hardcoded null end-to-end — either populate it (strike/spot) or drop
  it from schema + contract. Pick one; no dead nullable surface.
- **INFO**: fix stale "7 queues / 5 crons" comments (now 9 queues / 6 crons after compute-analytics);
  relocate the ordering-guarantee claim or assert it.

## Verification target
Full suite green with the new seam-catching tests; re-review (#2) finds no blocker; write/refresh
06-VERIFICATION (SC1-SC4 goal-backward, testcontainer-proven). Leave Phase 6 unmerged for operator
review. The live prod migration 0007 remains deferred.
