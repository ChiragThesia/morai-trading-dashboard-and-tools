---
phase: 25-data-quality-ops-rider
verified: 2026-07-09T03:33:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 25: Data-Quality Ops Rider Verification Report

**Phase Goal:** The pipeline the inference features depend on stops producing silent data
corruption — journal snapshots stop gapping, and a full BSM cohort recompute reliably finishes
within one job cycle.
**Verified:** 2026-07-09
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | snapshot-calendars writes NO row for a calendar with a missing or stale (>45min) leg | ✓ VERIFIED | `snapshotCalendars.ts:53-56` (`isLegFresh`), `:207-217` (skip+`continue`, `console.warn`); unit Test A/B pass (`snapshotCalendars.test.ts:349,371`) |
| 2 | A calendar with both legs fresh writes a complete row exactly as before (D-05/D-06 unchanged, incl. fresh-but-unsolved NaN case) | ✓ VERIFIED | `buildSnapshotRow` unchanged formulas; unit Test D/E pass (`:411,425`) — pre-existing D-05/D-06 tests still green |
| 3 | LegSnapshot carries `time` on both Postgres read paths and both memory twins | ✓ VERIFIED | `ports.ts:179`, `calendar-snapshots.ts:171/192`, `leg-observations.ts:133/197`, `memory/leg-observations.ts:88`; contract-proven round-trip against real Postgres |
| 4 | compute-bsm-greeks commits each ≤COMMIT_BATCH_SIZE slice in its own writeBsm transaction (durable checkpoint) | ✓ VERIFIED | `computeBsmGreeks.ts:215-238` while-loop, one `writeBsm` per non-empty batch; unit Test B (multi-batch) pass; contract test proves a real-Postgres kill-after-batch-1 keeps batch 1 |
| 5 | Budget exhaustion returns `ok(undefined)`, not `err`, with rows still pending; next trigger resumes for free via `bsm_iv IS NULL` | ✓ VERIFIED | `computeBsmGreeks.ts:213-243` deadline loop, budget-exit returns `ok`; unit Test C pass; contract test's second invocation drains to zero with no rework |
| 6 | Normal per-cycle volume completes in one run; bulk backlog converges across runs with zero rework | ✓ VERIFIED | Unit Test A (single-batch drain) + contract durability/resume test both pass; framing matches RESEARCH OQ1 (not "24k rows in one run") |
| 7 | jobs.md documents both new behaviors accurately (freshness gate + tolerance constant; batch loop + both constants; corrected schedule/retry facts) | ✓ VERIFIED | `docs/architecture/jobs.md:25-26,305-309` — grep-confirmed; retry_limit:2/no-override claim cross-checked against `pg-boss@12.18.3` and no override in `schedule.ts` |
| 8 | No regression to unrelated callers of the widened LegSnapshot port (getLiveGreeks) or to the fresh-path snapshot write | ✓ VERIFIED | Only composition-root caller of `resolveLegSnapshot`/`getLatestLegObs` is `apps/worker/src/main.ts` (snapshotCalendars) and `apps/server/src/main.ts` (getLiveGreeks, which never reads `.time`) — no other consumer breaks on the widened type; typecheck clean |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/journal/application/snapshotCalendars.ts` | freshness gate + skip logic | ✓ VERIFIED | `isLegFresh`, `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` (45min), skip-and-continue in loop |
| `packages/core/src/journal/application/computeBsmGreeks.ts` | batch-commit while-loop | ✓ VERIFIED | `COMMIT_BATCH_SIZE` (800), `BSM_TIME_BUDGET_MS` (700_000), deadline loop, per-batch `writeBsm` |
| `packages/core/src/journal/application/ports.ts` | `LegSnapshot.time` | ✓ VERIFIED | Line 179, `readonly time: Date` |
| `docs/architecture/jobs.md` | both job rows + Retries note corrected | ✓ VERIFIED | Grep-confirmed all named constants + corrected retry facts |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `calendar-snapshots.ts` `resolveLegSnapshot` | `snapshotCalendars.ts` freshness gate | `legObservations.time` select → `leg.time` read by `isLegFresh` | ✓ WIRED | Select clause + return mapping present; contract test proves the round-trip |
| `leg-observations.ts` `getLatestLegObs` | memory twin parity | `time: latest.time` | ✓ WIRED | Both Postgres and memory twin populate `time`; memory contract test also green |
| `computeBsmGreeks.ts` `readPending(COMMIT_BATCH_SIZE)` | resume-for-free | `bsm_iv IS NULL` partial index excludes committed rows | ✓ WIRED | Contract test: second invocation after simulated kill drains to zero, no rework |
| `apps/worker/src/main.ts` | `snapshotCalendars` use-case | `resolveLegs: calendarSnapshotsRepo.resolveLegSnapshot` | ✓ WIRED | Single composition-root wiring point confirmed via grep |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit suite (both plans' core logic) | `bun run test -- snapshotCalendars.test.ts computeBsmGreeks.test.ts` | 38/38 passed | ✓ PASS |
| Contract suite vs real Postgres (LegSnapshot.time round-trip + BSM kill-mid-drain durability) | `bun run test -- calendar-snapshots.contract.test.ts leg-observations.contract.test.ts leg-observations.bsm-drain.contract.test.ts` (Docker/testcontainers) | 49/49 passed | ✓ PASS |
| Typecheck | `bun run typecheck` | clean, no errors | ✓ PASS |
| Lint | `bun run lint` | clean (only pre-existing boundaries-plugin migration warning, no errors) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| OPS-01 | 25-01-PLAN.md | snapshot-calendars root-cause gap-row fix | ✓ SATISFIED | Freshness gate implemented, tested, contract-proven, documented |
| OPS-02 | 25-02-PLAN.md | compute-bsm-greeks batch-commit durability | ✓ SATISFIED | Batch loop implemented, tested, contract-proven, documented |

### Anti-Patterns Found

None. No TODO/FIXME/TBD/XXX/placeholder markers introduced in the modified files. No empty
implementations, no hardcoded stub returns. The one `ponytail:` comment
(`computeBsmGreeks.ts:69`) documents a deliberate tunable-constant ceiling with its retune
condition per repo convention — not a debt marker requiring a tracking issue.

### Deviations Reviewed (from SUMMARYs)

- **25-01 deviation 1** (rewrote two pre-existing tests that asserted the exact bug being
  fixed): confirmed sound — read the rewritten tests directly (`snapshotCalendars.test.ts:318,
  349`); they now assert `capture.calledTimes()).toBe(0)` + a `console.warn` on skip, not a
  written NaN row. No old-bug assertion survives.
- **25-01 deviation 2/3** (getLiveGreeks.test.ts fixture + contract test-isolation fix): both
  are narrow, typecheck/test-isolation fixes with no behavior-scope creep; confirmed via direct
  read of the affected files.
- **25-02 deviation 1** (infinite-loop double fix via `makeSingleBatchReadPending`): sound —
  this was a test-double artifact of the new while-loop shape, not a change to production
  logic; the 7 affected tests still assert the same per-row solve behavior, just via a double
  that terminates.
- **25-02 deviation 2/3** (barrel re-exports for `COMMIT_BATCH_SIZE`/`BSM_TIME_BUDGET_MS`,
  redeclared contract-test constants): confirmed as unavoidable, narrow ripple effects — no
  scope creep.

### Human Verification Required

None. D7 (post-deploy zero-gap-row prod verification) in 25-01-SUMMARY.md and the equivalent
post-deploy BSM-duration check in 25-02-SUMMARY.md are correctly flagged `human_judgment: true`
in their own coverage sections as an orchestrator/deploy-time follow-up — this is standard for
an undeployed code-complete phase and does not block phase-goal verification of the code itself.
Both SUMMARYs are explicit that the phase is "code-complete... not yet deployed to prod."

### Gaps Summary

None. Both plans' must-haves are implemented, unit-tested, contract-tested against real
Postgres, documented in jobs.md, and typecheck/lint clean. Regression risk (widened
`LegSnapshot.time` port breaking other callers) was hunted directly — only two composition-root
call sites exist (`snapshotCalendars` via `resolveLegSnapshot`, `getLiveGreeks` via
`getLatestLegObs`), and `getLiveGreeks` never reads `.time`, so it's unaffected by the freshness
gate semantics. The 3 documented deviations in each SUMMARY were read directly and are sound —
in particular the two rewritten snapshotCalendars tests no longer assert the Jul-06 bug shape.

---

_Verified: 2026-07-09_
_Verifier: Claude (gsd-verifier)_
