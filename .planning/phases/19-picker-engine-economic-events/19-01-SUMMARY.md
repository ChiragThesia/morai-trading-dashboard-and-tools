---
phase: 19-picker-engine-economic-events
plan: 01
subsystem: contracts
tags: [zod, hexagonal, ports, picker, typescript]

# Dependency graph
requires:
  - phase: 18-analyzer-picker-ui-redesign
    provides: pickerSnapshotResponse/pickerCandidate contract + frozen Analyzer fixture (D-01/D-03)
provides:
  - "pickerSnapshotResponse additive fields: source (D-15), gexContextStatus/eventsContextStatus (D-17)"
  - "Frozen Phase-18 fixture updated to satisfy the additive contract (zero candidate/event/termStructure edits)"
  - "packages/core/src/picker/application/ports.ts — complete hexagon-pure picker driven-port + row/domain type set"
affects: [19-02, 19-03, 19-04, 19-05, 19-06, 19-07, 19-08, 19-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ForVerbingNoun driven-port naming (picker context), copied verbatim from analytics/journal ports.ts"
    - "Local StorageError/FetchError re-declaration per bounded context (no cross-context domain import)"

key-files:
  created:
    - packages/core/src/picker/application/ports.ts
  modified:
    - packages/contracts/src/picker.ts
    - packages/contracts/src/picker.test.ts
    - packages/contracts/src/__fixtures__/picker-candidates.fixture.ts

key-decisions:
  - "Task 1 and Task 2 landed in one commit — both touch picker.test.ts's single suite; splitting them would have required an intentionally-red intermediate commit, violating tdd.md's 'commit at green only' rule. Matches this phase's own 17.1-01/18-03 precedent."
  - "ports.ts exports 9 ForVerbingNoun ports (not the 8 the plan's acceptance criteria stated) — the plan's own action text and 'Artifacts this phase produces' section both list 9 named ports; the acceptance criteria's count is a plan authoring bug, not an implementation gap. All 9 are needed by downstream plans (19-02..19-09) per 19-PATTERNS.md."
  - "NOT marking PICK-01/PICK-02 complete despite them appearing in this plan's requirements frontmatter — this plan ships only the contract/ports foundation; the actual scoring engine, HTTP route, MCP tool, and Analyzer live-data swap land in 19-02..19-09. Matches the 18-01 precedent (STATE.md)."

patterns-established:
  - "Comments describing hexagon-purity constraints must avoid literal substrings the acceptance-criteria grep checks for (e.g. write 'no ORM' not 'no drizzle') so documentation doesn't false-positive its own lint gate."

requirements-completed: []  # PICK-01/PICK-02 appear in this plan's frontmatter but are NOT
  # marked complete here — this plan ships only the contract/ports foundation (no
  # scoreCalendarCandidates domain logic, no HTTP route, no MCP tool, no Analyzer live-data
  # swap). Matches the 18-01 precedent (STATE.md): defer completion to the plan(s) that
  # actually ship the rendered/queryable feature (19-02..19-09).

coverage:
  - id: D1
    description: "pickerSnapshotResponse.parse accepts source/gexContextStatus/eventsContextStatus and rejects a payload missing any of them or using an out-of-enum value"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#pickerSnapshotResponse.source / gexContextStatus / eventsContextStatus (Phase 19, D-15/D-17)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Phase-18 frozen fixture updated to satisfy the additive contract fields with zero candidate/event/termStructure changes"
    requirement: "PICK-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#pickerSnapshotFixture (frozen fixture — D-03) > parses the frozen pickerSnapshotFixture clean"
        status: pass
    human_judgment: false
  - id: D3
    description: "packages/core/src/picker/application/ports.ts compiles hexagon-pure (imports only @morai/shared) and exports the full picker driven-port + row-type set for downstream plans"
    requirement: "PICK-01"
    verification:
      - kind: other
        ref: "bun run typecheck (tsc --build --force, exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: ~12min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 01: Picker Contract Additive Fields + Core Ports Module Summary

**Additive `source`/`gexContextStatus`/`eventsContextStatus` fields on `pickerSnapshotResponse` plus a hexagon-pure `packages/core/src/picker/application/ports.ts` exporting 9 driven ports and 6 row/domain types for every downstream Phase-19 plan to import.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-04T21:27:11Z
- **Tasks:** 3 (Task 1+2 combined into one commit, Task 3 its own commit)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `pickerSnapshotResponse` now carries `source: z.enum(["schwab","cboe"])` (D-15) and
  `gexContextStatus`/`eventsContextStatus: z.enum(["ok","stale","missing"])` (D-17) — all three
  required, enum-guarded, inserted between `spot` and `termStructure` per 19-PATTERNS.md ordering.
  Every existing field (`asOf`, `spot`, `termStructure`, `gex`, `events`, `candidates`, and every
  field inside `pickerCandidate`/`breakdownEntry`/`exitPlan`) is byte-identical.
- The frozen Phase-18 fixture (`picker-candidates.fixture.ts`) now supplies
  `source: "schwab"`, `gexContextStatus: "ok"`, `eventsContextStatus: "ok"` at the snapshot level —
  zero edits to any candidate, the guard-case row, events, or termStructure.
- New `packages/core/src/picker/application/ports.ts`: imports only `@morai/shared`; re-declares
  `StorageError`/`FetchError` locally; declares 6 row/domain types (`EconomicEvent`,
  `ChainQuoteForPicker`, `GexContextForPicker`, `PickerCandidateDomain`, `PickerSnapshot`,
  `PickerSnapshotRow`) and 9 `ForVerbingNoun` ports (`ForReadingChainForPicker`,
  `ForReadingGexContext`, `ForFetchingEconomicEvents`, `ForReadingEconomicEvents`,
  `ForPersistingEconomicEvents`, `ForPersistingPickerSnapshot`, `ForReadingPickerSnapshot`,
  `ForRunningComputePicker`, `ForRunningGetPicker`).

## Task Commits

1. **Task 1+2: Add source + context-status fields to pickerSnapshotResponse (additive) + update fixture** - `0be797a` (test)
2. **Task 3: Create the picker core ports module (driven ports + row/domain types)** - `200680b` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified

- `packages/contracts/src/picker.ts` - added `source`/`gexContextStatus`/`eventsContextStatus` fields to `pickerSnapshotResponse`
- `packages/contracts/src/picker.test.ts` - RED→GREEN test block asserting parse-success with the new fields present and parse-failure/out-of-enum rejection for each
- `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` - added the three new snapshot-level fields, satisfying the post-Task-1 type
- `packages/core/src/picker/application/ports.ts` - new hexagon-pure picker driven-port + row-type module

## Decisions Made

- **Task 1+2 combined into one commit.** Both tasks edit the same `picker.test.ts` suite (Task 1's
  new tests plus the plan's pre-existing frozen-fixture assertion, which the new required fields
  break until the fixture is updated). Per tdd.md's "commit only at green" and this phase's own
  17.1-01/18-03 precedent (documented in STATE.md), landing them separately would require an
  intentionally-red intermediate commit. Ran RED (6 new tests failing for the right reason) →
  updated `picker.ts` → confirmed the pre-existing fixture test broke as an anticipated side
  effect → updated the fixture in the same pass → GREEN (134/134 passing) → single commit.
- **`ports.ts` exports 9 ports, not the 8 the plan's acceptance criteria stated.** The plan's own
  `<action>` text and the file's "Artifacts this phase produces" section both enumerate 9 named
  ports (`ForReadingChainForPicker` through `ForRunningGetPicker`), and 19-PATTERNS.md confirms
  all 9 are required by downstream plans (compute-picker, get-picker, economic-events adapters).
  Treated the acceptance criteria's count as a plan-authoring miscount (Rule 1 — the criteria
  itself is the bug, not the implementation) rather than dropping a port the plan's own action
  text and downstream consumers require.
- **Reworded hexagon-purity comments to avoid literal `drizzle`/`@morai/contracts` substrings.**
  The acceptance criteria's forbidden-import grep (`rg -n '@morai/contracts|drizzle|process.env'`)
  is a blind text search with no comment-awareness; writing "no drizzle" in a header comment about
  what the file must NOT import would false-positive that same grep. Reworded to "no ORM"/"no
  contracts-package import" — same intent, doesn't trip the check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan's acceptance criteria] ports.ts port count is 9, not 8**
- **Found during:** Task 3 verification
- **Issue:** Acceptance criteria stated `rg -c 'export type For' ... returns 8`, but the plan's
  own action text and artifacts list name 9 distinct ports.
- **Fix:** Implemented all 9 ports as specified in the action text (the authoritative spec);
  documented the acceptance-criteria mismatch here rather than silently dropping a port.
- **Files modified:** `packages/core/src/picker/application/ports.ts`
- **Verification:** `bun run typecheck` exits 0; all 9 ports are hexagon-pure Result-typed
  functions consumable by downstream plans per 19-PATTERNS.md.
- **Committed in:** `200680b`

---

**Total deviations:** 1 auto-fixed (plan acceptance-criteria bug, Rule 1)
**Impact on plan:** No scope creep — implementation matches the plan's own action text and
downstream needs exactly. The single miscounted acceptance criterion does not indicate a
functional gap.

## Issues Encountered

None beyond the documented deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `pickerSnapshotResponse` additive fields and the frozen fixture are ready for 19-02..19-09 to
  build against without ever re-opening `picker.ts` or the fixture.
- `packages/core/src/picker/application/ports.ts` is the complete, stable interface surface for
  the domain (fwd-iv, scoring, candidate-selection), use-case (computePickerSnapshot, getPicker),
  and adapter (HTTP economic-events, Postgres/memory repos) plans that follow — no blockers.
- No REFUTED picker criteria were introduced; `breakdownEntry`'s closed enum
  (`slope|fwdEdge|gexFit|eventAdjustment|beVsEm`) is untouched.

---
*Phase: 19-picker-engine-economic-events*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created/modified files and both task commits (`0be797a`, `200680b`) verified present.
