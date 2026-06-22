---
phase: 06-derived-analytics
plan: 06
subsystem: analytics
tags: [cycle-resolution, idempotency, smile-read, testcontainers, CR-01, CR-02]
status: complete
requires:
  - "06-04 term-structure half of computeAnalytics (readSnapshotsForCycle pattern)"
  - "06-05 skew/RR half of computeAnalytics (readSmile, writeSkew, writeRr, readRrHistory)"
provides:
  - "Bounded latest-leg-cycle <= anchor smile read (Postgres + memory + shared contract)"
  - "Data-anchored computeAnalytics: one resolved cycle instant stamps all three analytics tables"
  - "Postgres testcontainer seam suite (distinct timestamps + fast-check idempotency property)"
  - "SmileReadResult port type ({cycleTime, quotes})"
affects:
  - "apps/worker compute-analytics wiring (port shape — passthrough, no logic change)"
tech-stack:
  added: []
  patterns:
    - "Bounded latest-<=-anchor resolution mirrors readSnapshotsForCycle (two-step: resolve cycle time, then read cohort)"
    - "Structural single-anchor: snapshotAnchor ?? cycleTime stamps skew/RR/term so PKs collide on re-run"
    - "now() is a read upper bound only — never a stamped value (architecture-boundaries §2)"
key-files:
  created:
    - packages/adapters/src/__contract__/compute-analytics-seam.contract.ts
    - packages/adapters/src/postgres/repos/compute-analytics-seam.contract.test.ts
  modified:
    - packages/core/src/analytics/application/computeAnalytics.ts
    - packages/core/src/analytics/application/computeAnalytics.test.ts
    - packages/core/src/analytics/application/ports.ts
    - packages/core/src/analytics/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/memory/leg-observations.ts
    - packages/adapters/src/__contract__/smile-source.contract.ts
decisions:
  - "Split the port return-shape change (Task 2) from the bounded-resolution change (Task 1): Task 1 keeps the array return + adds resolution; Task 2 changes the return to {cycleTime, quotes}. Both adapter edits done together per the plan."
  - "Structural single-anchor (plan-checker advisory, overrides Task 2 action text): when snapshots exist, stamp skew/RR/term ALL with snapshotAnchor; only when no snapshots exist fall back to the smile's own cycleTime. Enforced in the use-case (stampInstant = snapshotAnchor ?? cycleTime), not just asserted."
  - "worker main.ts needs no logic change — it passes legObsRepo.readSmile through; the new port shape type-checks (TDD-exempt composition root)."
metrics:
  duration: "~50 min"
  completed: "2026-06-22"
  tasks: 3
  files-created: 2
  files-modified: 8
  commits: 3
---

# Phase 6 Plan 06: Cycle-Resolution Seam (CR-01/CR-02) Summary

Data-anchored cycle resolution in `computeAnalytics`: the smile read is now a bounded
"latest leg-observations cohort ≤ anchor" read (not exact-`now()` equality), and all three
analytics tables are stamped with ONE resolved cycle instant, so re-runs are idempotent and
production reads are non-empty.

## What changed

- **CR-01 (empty smile in prod):** `readSmile` on both adapters resolves the latest BSM-solved
  leg cohort at or before the anchor (two-step: `MAX(time) ≤ anchor` among solved rows, then read
  that cohort), mirroring `readSnapshotsForCycle`. The argument is now an upper bound, not an exact
  match — so a broker `observedAt` ≠ `now()` still returns the smile.
- **CR-02 (duplicate rows on retry):** `computeAnalytics` resolves ONE canonical cycle instant from
  DATA and stamps skew + risk_reversal + term_structure all with it. `now()` flows only as a read
  upper bound and is never a stamped field. PKs collide on re-run → 0 new rows; skew `snapshot_time`
  == term `snapshot_time` for the cycle (SC1).
- **Port shape:** `ForReadingSmileSource` now returns `SmileReadResult = { cycleTime, quotes }` so
  the time-less `SmileQuote` points can carry the resolved DATA instant the use-case stamps with.
- **Structural single-anchor:** when snapshots exist, all three tables share `snapshotAnchor`
  (`stampInstant = snapshotAnchor ?? cycleTime`); when no snapshots exist, skew/RR fall back to the
  smile's own resolved leg instant and 0 term rows are written; neither present → clean no-op.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Bounded latest-leg-cycle ≤ anchor smile read (repo + twin + contract) | `ae43450` | leg-observations.ts (pg+memory), smile-source.contract.ts, ports.ts (JSDoc) |
| 2 | computeAnalytics resolves one data-anchored cycle; stamps all three tables | `f189326` | computeAnalytics.ts + test, ports.ts, core index×2, smile-source.contract.ts, both adapters (return shape) |
| 3 | Postgres testcontainer seam suite (distinct ts + idempotency property); wire-check worker | `d9c9127` | compute-analytics-seam.contract.ts + Postgres runner |

## TDD red → green (per task)

- **Task 1 RED:** new contract cases (strictly-before-anchor, latest-of-two-times, skip-later-unsolved)
  failed on the exact-equality read — 6 failures across memory + Postgres. **GREEN:** 18/18.
- **Task 2 RED:** distinct-timestamp seam assertions (resolved cycle ≠ now, readSmile anchor ≠ now,
  idempotent now()-advanced re-run, snapshots-absent fallback) failed on the `now()`-based code —
  5 failures. **GREEN:** 14/14.
- **Task 3 RED (manual seam proof):** temporarily reverting to the pre-fix exact-`now()` read +
  `now()`-stamp made CR-01 write **0** skew rows (expected 4) — reproduces the production bug.
  Files restored to the committed fix; **GREEN:** 4/4 against real Postgres 16.

## Seam test reproduced the bug

Yes. The seam suite uses THREE distinct instants — broker `observedAt` (T_obs) ≠ snapshot
`snapshotTime` (T_snap) ≠ injected `now()` (N), all with T_obs/T_snap strictly < N. On the old
code: exact-`now()` read → 0 skew rows (CR-01); `now()`-stamp → duplicate rows on a now()-advanced
re-run (CR-02). On the fixed code: 4 skew rows written, run-twice adds 0 in all three tables, and
skew/term share one `snapshot_time`.

## Testcontainers ran (not skipped)

Yes. The smile-source contract (Task 1) and the compute-analytics-seam contract (Task 3) execute
against a real Postgres 16 testcontainer (Docker daemon v28.5.1). Container start/stop is visible in
the run logs; the full workspace suite reports 0 skipped.

## Deviations from Plan

**1. [Plan-checker advisory enforced] Structural single-anchor stamping**
- **Found during:** Task 2.
- **Issue:** Task 2's action text said to stamp skew/RR with `smileResult.cycleTime` always. The
  critical-rules advisory (and 06-GAPS.md locked design) requires that when snapshots exist, skew +
  RR + term ALL share the snapshot anchor by construction — not just by coincidence.
- **Fix:** `stampInstant = snapshotAnchor ?? cycleTime`. When snapshots exist → snapshot anchor for
  all three; only the snapshots-absent path uses the smile's own `cycleTime`. The advisory takes
  precedence over the task action text.
- **Files modified:** packages/core/src/analytics/application/computeAnalytics.ts
- **Commit:** `f189326`

No bugs auto-fixed (Rule 1), no missing critical functionality added (Rule 2), no blocking issues
(Rule 3), no architectural decisions required (Rule 4). No authentication gates.

## Verification

- `bun run test` — **102 files / 931 tests passed, 0 failed, 0 skipped.**
- `bun run typecheck` — clean (covers worker main.ts wiring against the new port shape).
- `bun run lint` — clean (exit 0; no any/as/!; core imports only @morai/shared).

## Self-Check: PASSED

- Created files exist: compute-analytics-seam.contract.ts, compute-analytics-seam.contract.test.ts, 06-06-SUMMARY.md ✓
- Modified file present: computeAnalytics.ts ✓
- Commits exist: ae43450, f189326, d9c9127 ✓
