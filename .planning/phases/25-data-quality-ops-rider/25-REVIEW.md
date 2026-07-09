---
phase: 25-data-quality-ops-rider
reviewed: 2026-07-09T08:38:55Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - packages/core/src/journal/application/snapshotCalendars.ts
  - packages/core/src/journal/application/computeBsmGreeks.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/index.ts
  - packages/core/src/index.ts
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts
  - packages/adapters/src/postgres/repos/leg-observations.ts
  - packages/adapters/src/memory/leg-observations.ts
  - packages/adapters/src/memory/calendar-snapshots.ts
  - packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts
  - packages/adapters/src/__contract__/leg-observations.contract.ts
  - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
findings:
  blocker: 0
  warning: 1
  info: 2
  total: 3
status: fixed
fixed_at: 2026-07-09T03:42:00Z
fixed_commit: 7e6e7f8
---

# Phase 25: Code Review Report

**Reviewed:** 2026-07-09T08:38:55Z
**Depth:** deep
**Files Reviewed:** 12
**Status:** issues_found (no blockers)

## Summary

Reviewed the Phase 25 pipeline-critical changes: the OPS-01 snapshot freshness gate
(`snapshotCalendars.ts`) and the OPS-02 BSM batch-commit loop (`computeBsmGreeks.ts`),
plus the `LegSnapshot.time` type widening and the two Postgres mappers that feed the gate.

This diff holds up under adversarial review. I hunted specifically for the failure modes
this repo has been bitten by (reused-`now()`, vacuous freshness gates, budget loops that
overshoot the pg-boss expire cap, mappers that stub `now()` instead of the real DB column,
green suites hiding prod bugs). None are present:

- **Freshness gate is real, not vacuous.** `now` is injected and called exactly once per
  run (`snapshotCalendars.ts:183`), used consistently for the gate, DTE, and `row.time`.
  `isLegFresh` compares epoch ms (`getTime()` on both sides) — fully tz-safe. Boundary is
  inclusive and explicitly tested (Test C). Skip path `continue`s **before**
  `buildSnapshotRow`, so no partial/started row leaks.
- **CRITICAL mapper check PASSES.** Both Postgres mappers map the real column
  (`obsRow.time` / `row.time` from `legObservations.time`, a `timestamptz` → Drizzle
  default `mode:"date"` → `Date`), never `new Date()`. The memory twin maps `latest.time`.
  The round-trip is proven against **real Postgres** by new contract assertions
  (`calendar-snapshots.contract.ts` `leg.time.getTime()===obsTime.getTime()`;
  `leg-observations.contract.ts` `...===laterTime.getTime()`). A `grep` for
  `time: new Date()` across non-test production code returns **zero** hits — the gate
  cannot be silently always-fresh in prod.
- **Batch loop is bounded and error-safe.** `while now < deadline` cannot run forever;
  `readPending` err → `return err`, `writeBsm` err → `return err` (Test D proves the first
  batch's checkpoint still stands), empty batch → `ok`, budget exhaustion → clean `ok`
  (Test C proves no retry-storm). Newest-first bound preserved; `rateCache` memoized across
  the whole run (RC#1). Worst-case in-flight batch overshoot (~56s) lands ~756s, under the
  900s expire cap.
- **Deviation soundness.** `makeSingleBatchReadPending` models the `IS NULL` predicate
  honestly (serves once, then empty — solved rows never reappear). The 25-01 test rewrite
  retains D-05 formula coverage and D-06 NaN continuity (Test E: both legs fresh but
  `bsmIv='NaN'` still writes the row) alongside the new gate tests.
- **jobs.md matches code.** `COMMIT_BATCH_SIZE` (800), `BSM_TIME_BUDGET_MS` (700,000ms),
  tolerance (~45min = 1.5×30min), and expire (900s) all agree with constants and the worker
  handler.

**Verification performed:** `tsc --noEmit` clean on `@morai/core` and `@morai/adapters`
(confirms every `LegSnapshot` construction site supplies the now-required `time` — no
missing-field fallout). `vitest run` on both suites: 38 passed, 0 failed, 0 skipped.

No blockers. Findings below are observability/documentation quality only.

## Warnings

### WR-01: Freshness-gate warn is under-informative for the ops signal this phase exists to add

**Status:** fixed (commit `7e6e7f8`) — `assessLegFreshness`/`describeLegFreshness` now
label "missing" / "stale (Nm, observed ..., now ...)" / "resolve-error" distinctly; tests
extended to assert reason strings.

**File:** `packages/core/src/journal/application/snapshotCalendars.ts:210-216`
**Issue:** The skip-warn names the calendar id and a per-leg reason, but the reason is only
`"missing"` vs `"stale"` — it omits the actual staleness age and the leg observation
timestamps. Worse, a transient `resolveLegs` **storage error** is collapsed to `null` and
therefore logged as `"missing"` (line 211-212: `front === null ? "missing" : "stale"`),
indistinguishable from a genuine no-observation miss. In a phase whose entire purpose is
data-quality/ops visibility into snapshot stalls, this weakens the exact diagnostic the gate
was added to provide: an operator reading the log cannot tell "1 minute over tolerance
(transient)" from "3 hours stale (pipeline dead)", nor "DB hiccup" from "leg never
observed." Behavior is correct (safe skip, self-heals) — this is a diagnostic-quality gap,
not incorrect logic.
**Fix:** Include the observed age when the leg is present-but-stale, e.g. compute
`Math.round((now.getTime() - leg.time.getTime())/60000)` minutes and interpolate it; and
distinguish the storage-error case from a genuine `ok(null)` miss (thread the error branch
through as a third reason, e.g. `"resolve-error"`), so `console.warn` reads
`front leg stale (137m), back leg fresh` or `front leg resolve-error`.

## Info

### IN-01: File header claims "no I/O" but the gate now calls console.warn

**Status:** fixed (commit `7e6e7f8`) — header now reads "Pure domain apart from a single
console.warn skip diagnostic; no other I/O, no Date.now()...".

**File:** `packages/core/src/journal/application/snapshotCalendars.ts:23` (comment) vs `:213`
**Issue:** The module docstring still asserts *"Pure domain: no I/O, no Date.now()..."*, but
the OPS-01 skip path now does `console.warn` — which writes to stderr (I/O). The
`console.warn` itself is permitted (typescript.md gates console to warn/error and it's a
global, not a node builtin import), so this is a stale-comment accuracy nit, not a boundary
violation.
**Fix:** Amend the header to note the one sanctioned side effect, e.g. *"Pure domain apart
from a single `console.warn` skip diagnostic; no other I/O, no Date.now()."*

### IN-02: Redundant re-evaluation of isLegFresh in the warn branch

**Status:** fixed (commit `7e6e7f8`) — `isLegFresh` now called once per leg inside
`assessLegFreshness`; result reused for the gate condition and the warn message.

**File:** `packages/core/src/journal/application/snapshotCalendars.ts:210,214`
**Issue:** `isLegFresh(front, now)` / `isLegFresh(back, now)` are each evaluated in the guard
condition (line 210) and again inside the warn template (line 214) — three+ calls per
skipped calendar. The function is pure and cheap, so this is purely a readability/DRY nit,
not a correctness or perf issue.
**Fix:** Compute `const frontFresh = isLegFresh(front, now); const backFresh =
isLegFresh(back, now);` once above the guard and reuse in both the condition and the message
(this also composes cleanly with the WR-01 fix).

---

_Reviewed: 2026-07-09T08:38:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
