---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
plan: 04
subsystem: api
tags: [picker, scoring, tdd, fast-check, hexagonal]

# Dependency graph
requires:
  - phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
    provides: analyzeAdHocCalendarRequest/Response Zod contract pair + resolveEventExit exported helper (30-03)
provides:
  - makeAnalyzeAdHocCalendarUseCase — scores ONE user-pasted PUT calendar with byte-parity to the engine
  - ForAnalyzingAdHocCalendar driver port + AdHocCalendarInput/AdHocCalendarAnalysis application types
  - toPickerCandidateDomain/applyGatePenalty/zeroEventAdjustment/isPickerRuleOverrides exported from computePickerSnapshot.ts for reuse
affects: [30-05-http-mcp-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ad-hoc analyze use-case: build ONE RawCandidate mirroring selectCandidates' own construction, score via the SAME scoreCalendarCandidates function (byte-parity, never a second formula)"
    - "reuse-not-rederive: gate/sizing/spot/asOf AND the gex/events freshness verdict come off the latest persisted snapshot verbatim (T-28-10) — no clock dependency in this use-case at all"

key-files:
  created:
    - packages/core/src/picker/application/analyzeAdHocCalendar.ts
    - packages/core/src/picker/application/analyzeAdHocCalendar.test.ts
  modified:
    - packages/core/src/picker/application/ports.ts
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "No packages/core/src/picker/application/index.ts barrel created — no such file exists anywhere in this codebase (every bounded context re-exports straight from its own top-level index.ts); the plan's files_modified list named it, but the existing convention wins (docs.md: reconcile code vs. doc before proceeding)."
  - "readGexContext/readEconomicEvents are critical reads (a failure returns err(StorageError), mirrors computePickerSnapshot's own posture); readDailySpotCloses/readPickerSlopeHistory/readRuleOverrides degrade honestly to null/[]/defaults on failure, same non-critical posture as compute-picker."
  - "The snapshot's gexContextStatus/eventsContextStatus is trusted as the freshness VERDICT (never re-derived with now()) while the GEX/events VALUES are still read fresh for scoring inputs — this use-case has no clock dependency at all."

requirements-completed: [D-02]

coverage:
  - id: D1
    description: "makeAnalyzeAdHocCalendarUseCase scores one ad-hoc PUT calendar with score/breakdown/exitPlan byte-identical to scoreCalendarCandidates on the equivalent RawCandidate (fast-check property over strike/iv/dte/debit ranges)"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/analyzeAdHocCalendar.test.ts#scores byte-identically to scoreCalendarCandidates on the equivalent RawCandidate (T-30-10 parity)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Gate penalty and events-degradation reuse the snapshot's own gate.penaltyMultiplier/eventsContextStatus verbatim (never resolveEntryGate, never re-derived)"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/analyzeAdHocCalendar.test.ts#applies the gate penalty verbatim: score(0.5) = round(0.5 * score(1)) (A3)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/analyzeAdHocCalendar.test.ts#zeroes eventAdjustment when the snapshot's eventsContextStatus is stale (D-17 reused verbatim)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No snapshot yet degrades to {scored:false, reason:'no-snapshot'} with no throw and no extra reads; gate BLOCKED still scores (never a hidden analysis); the use-case's deps structurally exclude the cohort-gate reads (T-30-09)"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/analyzeAdHocCalendar.test.ts#no snapshot yet -> ok({scored:false, reason:'no-snapshot'}), never a throw, no further reads fire (D-02)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/analyzeAdHocCalendar.test.ts#gate BLOCKED still returns scored:true with the penalty applied (binding #1 -- never hide the analysis)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/analyzeAdHocCalendar.test.ts#port hygiene: deps structurally exclude the cohort-gate reads (T-30-09) and only the 6 provided reads fire"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-10
status: complete
---

# Phase 30 Plan 04: Ad-Hoc Analyze Use-Case — Byte-Parity Scoring Summary

**`makeAnalyzeAdHocCalendarUseCase` scores one user-pasted PUT calendar through the SAME `scoreCalendarCandidates` function the engine uses, reusing the latest snapshot's gate/sizing/context verbatim and fresh Phase-29 rule overrides — proven byte-identical via a fast-check property test.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-10T14:40Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `makeAnalyzeAdHocCalendarUseCase(deps): ForAnalyzingAdHocCalendar` builds ONE `RawCandidate` mirroring `selectCandidates`' own construction (candidate-selection.ts:370-411 — `bsmGreeks` theta/vega/delta, ORATS-style slope, `legSpansEvents`/`resolveEventExit` for event fields), then scores it with the exact `scoreCalendarCandidates` function `computePickerSnapshot.ts` calls — a fast-check property test over strike/iv/dte/debit ranges proves score/breakdown/fwdIv/exitPlan are byte-identical to a hand-built equivalent candidate.
- Gate/sizing/spot/asOf and the gex/events freshness VERDICT come verbatim off the latest persisted `PickerSnapshotRow` (T-28-10) — `resolveEntryGate` is structurally absent from the use-case's deps, never called. A gate `BLOCKED` state still returns `scored:true` with the penalty-applied score (binding #1 — the client's chip renders the block, the analysis is never withheld).
- Rule-config overrides resolve FRESH via `resolvePickerRuleConfig(readRuleOverrides())` on every call (Phase-29 parity), mirroring `computePickerSnapshot.ts`'s own per-invocation posture.
- No snapshot yet degrades cleanly to `ok({scored:false, reason:"no-snapshot"})` — no throw, no persist, and no further reads fire (proven by a call-count spy).
- `toPickerCandidateDomain`/`applyGatePenalty`/`zeroEventAdjustment`/`isPickerRuleOverrides` are now exported from `computePickerSnapshot.ts` (were private) so the ad-hoc use-case reuses the exact same mapping/penalty/zeroing/override-narrowing logic — one formula, never a second copy.

## Task Commits

Each task was committed atomically:

1. **Task 1: makeAnalyzeAdHocCalendarUseCase — build one RawCandidate + score with parity** - `47dfde7` (feat)
2. **Task 2: Degradation + port-hygiene guarantees; barrel exports** - `cf4fcb8` (test)

_Both tasks were TDD red→green: the test file was moved aside temporarily to confirm a genuine RED (missing-module import failure) before the implementation landed, then restored to GREEN — same single-commit-at-green convention as 30-03 (17.1-01 precedent)._

## Files Created/Modified
- `packages/core/src/picker/application/analyzeAdHocCalendar.ts` - `makeAnalyzeAdHocCalendarUseCase` + `AnalyzeAdHocCalendarDeps`
- `packages/core/src/picker/application/analyzeAdHocCalendar.test.ts` - 8 tests: fast-check parity property, gate-penalty parity, stale-events zeroing, flat-IV honesty, StorageError propagation, no-snapshot degradation, gate-blocked-still-scores, port hygiene
- `packages/core/src/picker/application/ports.ts` - adds `AdHocCalendarInput`, `AdHocCalendarAnalysis`, `ForAnalyzingAdHocCalendar`
- `packages/core/src/picker/application/computePickerSnapshot.ts` - exports `toPickerCandidateDomain`, `applyGatePenalty`, `zeroEventAdjustment`, `isPickerRuleOverrides` (were private)
- `packages/core/src/picker/index.ts` - re-exports the new use-case/port/types
- `packages/core/src/index.ts` - re-exports the new use-case/port/types through the `@morai/core` top-level barrel (30-05's wiring point)

## Decisions Made
- No `application/index.ts` barrel created — that file doesn't exist anywhere in this codebase; every bounded context (journal, analytics, exits, streaming, picker) re-exports straight from its own top-level `<context>/index.ts`. The plan's `files_modified` list named `application/index.ts`, but the real, already-established convention (confirmed via `find packages/core/src -path "*/application/index.ts"` → zero hits) takes precedence — matches this repo's `docs.md` "code that contradicts the doc set is a bug in one of them, reconcile before proceeding" rule.
- `readGexContext`/`readEconomicEvents` are critical reads (failure → `err(StorageError)`, whole call fails) — mirrors `computePickerSnapshot.ts`'s own posture for these same two reads. `readDailySpotCloses`/`readPickerSlopeHistory`/`readRuleOverrides` degrade honestly (null/`[]`/defaults) on failure — same non-critical posture compute-picker already established, not a new policy invented for this use-case.
- The snapshot's `gexContextStatus`/`eventsContextStatus` is trusted as the freshness VERDICT (governs whether GEX/events credit the score) while the actual GEX/events VALUES are still read fresh for the candidate's frontEvents/backEvents/exitBeforeIso resolution — this use-case injects no clock (`now()`) at all, a stronger structural guarantee than computePickerSnapshot's own `now` dep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `isPickerRuleOverrides` from `computePickerSnapshot.ts` (not itemized in the plan's artifact list)**
- **Found during:** Task 1
- **Issue:** The plan named `toPickerCandidateDomain`/`applyGatePenalty`/`zeroEventAdjustment` as the three exports to add, but resolving fresh rule overrides (D-02's "config resolved FRESH via readRuleOverrides" requirement) needs the SAME narrowing/validation logic `computePickerSnapshot.ts` already uses to turn the untyped stored `picker` group into `PickerRuleOverrides` — hand-rolling a second narrowing function would violate the parity guarantee this whole plan exists for.
- **Fix:** Exported the existing private `isPickerRuleOverrides` type guard alongside the three named exports; the ad-hoc use-case imports and reuses it verbatim.
- **Files modified:** packages/core/src/picker/application/computePickerSnapshot.ts, packages/core/src/picker/application/analyzeAdHocCalendar.ts
- **Verification:** `bun run typecheck && bun run lint` clean; parity fast-check property green.
- **Committed in:** 47dfde7 (Task 1 commit)

**2. [Rule 1 - Bug] Skipped the non-existent `application/index.ts` barrel; exported through the real precedent (`picker/index.ts` + top-level `packages/core/src/index.ts`)**
- **Found during:** Task 2
- **Issue:** The plan's `files_modified` and Task 2's action text both reference `packages/core/src/picker/application/index.ts` — a file that does not exist anywhere in this codebase (verified: zero `application/index.ts` files across all 8 bounded contexts). Creating one would introduce a new, unprecedented barrel layer.
- **Fix:** Added the re-exports to `picker/index.ts` (the ONE existing top-level barrel for this bounded context) and to `packages/core/src/index.ts` (the `@morai/core` package barrel 30-05 will actually import from) — matching every other use-case's export precedent (`makeGetPickerUseCase`, `makeComputePickerSnapshotUseCase`) exactly.
- **Files modified:** packages/core/src/picker/index.ts, packages/core/src/index.ts
- **Verification:** `rg -n "makeAnalyzeAdHocCalendarUseCase|ForAnalyzingAdHocCalendar" packages/core/src/picker/index.ts` shows both re-exports; `bun run test -- --project=core` (93 files, 1093 tests) green.
- **Committed in:** cf4fcb8 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/reuse, 1 bug — plan referenced a file that doesn't exist in this codebase's actual layout)
**Impact on plan:** Both fixes keep the codebase's ONE established barrel-export convention intact; no scope creep, no new architectural layer.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 30-05 (HTTP/MCP adapters) can now import `makeAnalyzeAdHocCalendarUseCase`, `ForAnalyzingAdHocCalendar`, `AdHocCalendarInput`, and `AdHocCalendarAnalysis` from `@morai/core`, wire the 30-03 `analyzeAdHocCalendarRequest`/`Response` Zod contracts at the boundary, and compose deps from the existing picker/settings postgres repos (no new driven ports, no new in-memory twins needed — every read this use-case needs already has one).
- No blockers.

---
*Phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created/modified files found on disk; both task commits (47dfde7, cf4fcb8) verified present in git log.
