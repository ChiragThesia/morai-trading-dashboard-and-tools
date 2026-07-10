---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
plan: 03
subsystem: api
tags: [zod, contracts, picker, tdd]

# Dependency graph
requires:
  - phase: 29-runtime-rule-settings
    provides: rule-config overrides pattern (additive schema precedent reused for analyze contract)
provides:
  - analyzeAdHocCalendarRequest/Response Zod contract pair (packages/contracts/src/picker.ts), barrel-exported
  - resolveEventExit exported pure helper (packages/core/src/picker/domain/candidate-selection.ts)
affects: [30-04-analyze-ad-hoc-calendar-use-case, 30-05-http-mcp-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns: ["additive Zod contract schema (settings.ts precedent)", "extract-and-reuse pure domain helper"]

key-files:
  created: []
  modified:
    - packages/contracts/src/picker.ts
    - packages/contracts/src/picker.test.ts
    - packages/contracts/src/index.ts
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/candidate-selection.test.ts

key-decisions:
  - "analyzeAdHocCalendarRequest omits spot entirely (never a client-supplied price) and is .strict() so an extra spot key is rejected — T-30-06 threat mitigation"
  - "resolveEventExit extracted verbatim (same day-number math, same earliest-event selection) — selectCandidates calls it, zero behavior change"
  - "barrel-exported both new schemas through packages/contracts/src/index.ts — plumbing not itemized in files_modified but required for 30-04/30-05 to consume them"

patterns-established:
  - "Ad-hoc analyze contract pair follows the settings.ts additive-schema precedent (Phase 29): one Zod request/response pair, .strict(), shared by HTTP route + MCP tool (MCP-02)"

requirements-completed: [D-02]

coverage:
  - id: D1
    description: "analyzeAdHocCalendarRequest rejects non-finite/non-positive leg numbers, non-put calendars, backDte <= frontDte, and a client-supplied spot key"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#analyzeAdHocCalendarRequest"
        status: pass
    human_judgment: false
  - id: D2
    description: "analyzeAdHocCalendarResponse carries {scored, candidate, reason} — full pickerCandidate when scored, null otherwise"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#analyzeAdHocCalendarResponse"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveEventExit is one exported pure function reused by selectCandidates; existing candidate-selection suite stays green after the extraction"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#resolveEventExit"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectCandidates (regression suite)"
        status: pass
    human_judgment: false

duration: ~8min
completed: 2026-07-10
status: complete
---

# Phase 30 Plan 03: Ad-hoc Analyze Contract + Event-Exit Extraction Summary

**Additive `analyzeAdHocCalendarRequest`/`Response` Zod schemas (no client spot, puts-only) plus an extracted `resolveEventExit` pure helper reused by the live engine — the Wave-1 foundations for pasted-calendar scoring.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-07-10T14:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `analyzeAdHocCalendarRequest`: `.strict()` Zod schema (putCall literal "P", finite/positive strike+iv, positive-int dte/qty, finite debit, ISO expiry strings, refined `backDte > frontDte`) — deliberately carries no `spot` field so a client-supplied price is structurally rejected.
- `analyzeAdHocCalendarResponse`: `{scored, candidate: pickerCandidate.nullable(), reason: nullable string}` — wraps the existing rich `pickerCandidate` schema, zero new shape for the UI to special-case.
- `resolveEventExit(frontExpiryIso, events)`: extracted from `selectCandidates`' inline event-blackout loop, exported so the 30-04 ad-hoc use-case reuses the exact same `exitBeforeIso`/`eventInPeakTheta` logic instead of a second copy.

## Task Commits

Each task was committed atomically:

1. **Task 1: Additive analyze request/response contract schemas** - `ebc4482` (feat)
2. **Task 2: Extract the event-blackout helper resolveEventExit** - `be5b33f` (refactor)

_Both tasks were TDD red→green: test file written and run to confirm failure for the right reason (missing export) before the implementation landed in the same commit, per this repo's tdd.md single-commit-at-green convention (17.1-01 precedent)._

## Files Created/Modified
- `packages/contracts/src/picker.ts` - adds `analyzeAdHocCalendarRequest`/`analyzeAdHocCalendarResponse` + inferred types
- `packages/contracts/src/picker.test.ts` - 9 new tests (valid parse, 6 reject cases, 2 response shapes)
- `packages/contracts/src/index.ts` - barrel-exports both new schemas/types
- `packages/core/src/picker/domain/candidate-selection.ts` - exports `resolveEventExit`; `selectCandidates` now calls it instead of an inline loop
- `packages/core/src/picker/domain/candidate-selection.test.ts` - 6 new direct `resolveEventExit` tests

## Decisions Made
- No `spot` field on the request schema at all (not merely optional) — the server derives spot from the latest stored snapshot; `.strict()` makes a client-supplied `spot` key a parse error, matching the plan's threat-mitigation requirement (T-30-06).
- `resolveEventExit` preserves the exact original day-number math and earliest-event tie-break — proven byte-identical by the unchanged `selectCandidates` regression suite (44/44 green) plus the picker-wide 312/312 test run.
- Barrel-exported both new contract symbols through `packages/contracts/src/index.ts` even though it wasn't in the plan's `files_modified` list — required plumbing so 30-04/30-05 can import them from `@morai/contracts` (matches every prior additive-schema precedent in this codebase).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Barrel-exported new schemas from packages/contracts/src/index.ts**
- **Found during:** Task 1
- **Issue:** Plan's `files_modified` only listed `picker.ts`/`picker.test.ts`, but every consumer in this codebase imports contract schemas from `@morai/contracts` (the barrel), not the individual file — omitting the export would block 30-04/30-05 from reaching the new schemas.
- **Fix:** Added `analyzeAdHocCalendarRequest`/`Response` + their inferred types to the existing picker export block in `index.ts`.
- **Files modified:** packages/contracts/src/index.ts
- **Verification:** `bun run typecheck` clean; picker test suite green.
- **Committed in:** ebc4482 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (blocking/plumbing)
**Impact on plan:** Necessary for the schemas to be consumable by downstream plans. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 30-04 (ad-hoc use-case) can now import `analyzeAdHocCalendarRequest`/`Response` from `@morai/contracts` and call `resolveEventExit` from `@morai/core`'s picker domain for hard-close-date parity with the live engine.
- No blockers.

---
*Phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created/modified files found on disk; both task commits (ebc4482, be5b33f) verified present in git log.
