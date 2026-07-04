---
phase: 18-analyzer-picker-ui-redesign
plan: 01
subsystem: api
tags: [zod, contracts, picker, calendar-selection, fixtures]

# Dependency graph
requires:
  - phase: 08-web-dashboard-backend-gex-auth-rpc
    provides: gex.ts's nested-object composition + z.infer-per-concern contract pattern (the exact analog followed here)
provides:
  - "PickerCandidate/PickerSnapshotResponse Zod contract (packages/contracts/src/picker.ts)"
  - "Frozen pickerSnapshotFixture (8 real + 1 guard-case candidates) satisfying that contract"
  - "packages/contracts/src/index.ts re-export block for both"
affects: [18-02, 18-03, 18-04, 18-05, phase-19-picker-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "packages/contracts/src/__fixtures__/ subdirectory (new — first fixtures dir in this package)"
    - "Closed Zod enum as structural guarantee against REFUTED criteria (breakdownEntry.criterion)"
    - "Nullable value + sibling enum-tag (fwdIv/fwdIvGuard) instead of NaN or a Result-shaped union"

key-files:
  created:
    - packages/contracts/src/picker.ts
    - packages/contracts/src/picker.test.ts
    - packages/contracts/src/__fixtures__/picker-candidates.fixture.ts
  modified:
    - packages/contracts/src/index.ts

key-decisions:
  - "Guard-case candidate (id 7450-guard-inverted) is a constructed example, not a literal mockup row — front IV 15.5% > back IV 10.5% at 21/45 DTE drives the forward-variance radicand negative (per D-06, planner's discretion on the specific numbers)"
  - "Guard-case debit computes to -802.82 (a credit, not a debit) — this is the mathematically consistent output of the mockup's own BSM formula under term-structure inversion (short-dated option pricier than long-dated), not an authoring error; schema has no debit>0 constraint"
  - "beVsEm breakdown entry contribution synthesized as min(100, beWidth/(2*expectedMove)*100) per RESEARCH Assumption A3 — not the mockup's literal K===7500 strike-proximity term"

requirements-completed: [ANLZ-01, ANLZ-02, ANLZ-03]

coverage:
  - id: D1
    description: "pickerCandidate Zod schema parses a valid oracle payload and REJECTS malformed breakdown entries (out-of-enum criterion, missing numeric field) via .parse()"
    requirement: "ANLZ-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#pickerCandidate"
        status: pass
    human_judgment: false
  - id: D2
    description: "breakdownEntry.criterion is a CLOSED enum {slope, fwdEdge, gexFit, eventAdjustment, beVsEm} that structurally rejects REFUTED criteria (IV-rank gate, IV-diff band, debit-%-of-back band)"
    requirement: "ANLZ-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#breakdownEntry.criterion (closed enum, structurally excludes REFUTED criteria)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Frozen pickerSnapshotFixture (8 real candidates + 1 guard-case) parses clean against pickerSnapshotResponse; guard-case carries fwdIv=null/fwdIvGuard='inverted' with finite expectedMove/theta/vega/score"
    requirement: "ANLZ-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#pickerSnapshotFixture (frozen fixture — D-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "index.ts re-exports pickerCandidate/pickerSnapshotResponse/pickerSnapshotFixture so apps/web can import from @morai/contracts with no cross-boundary reach into __fixtures__"
    requirement: "ANLZ-03"
    verification:
      - kind: unit
        ref: "bun run typecheck (tsc --build --force) — clean"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-04
status: complete
---

# Phase 18 Plan 01: Picker Contract + Fixture Summary

**`PickerCandidate`/`pickerSnapshotResponse` Zod contract with a closed breakdown-criterion enum, plus a frozen 9-candidate fixture (8 real + 1 guard-case) ported from `playground-v4.html`'s real chain-snapshot output.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-04T23:28:00Z
- **Completed:** 2026-07-04T23:34:30Z
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- Authored `picker.ts`: `pickerCandidateLeg`, `breakdownEntry` (closed criterion enum), `exitPlan`, `pickerCandidate` (with nullable `fwdIv` + `fwdIvGuard` enum tag), `termStructurePoint`, `pickerGexContext`, `pickerEvent`, `pickerSnapshotResponse` — mirroring `gex.ts`'s nested-composition + per-concern `z.infer` idiom exactly.
- Froze `mockups/playground-v4.html`'s real `buildCandidates()` OUTPUT (spot 7498.85, GEX flip 7472.65/walls 7400·7525, 31-point ATM-IV term structure, FOMC/CPI/NFP events) into `pickerSnapshotFixture` — 8 real candidates plus 1 constructed guard-case candidate exercising the fwdIv-null branch.
- Re-exported everything from `packages/contracts/src/index.ts` in a new "Picker contracts (Phase 18 — D-01; MCP-02...)" block, matching the file's existing per-module block convention.
- 17/17 tests green in `picker.test.ts`, each RED-confirmed first (module/fixture temporarily hidden, verified the correct import-error failure, then restored to GREEN).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the pickerCandidate Zod contract + barrel re-export (RED→GREEN)** - `49efed5` (feat)
2. **Task 2: Freeze playground-v4 candidates into the typed fixture + parse test (RED→GREEN)** - `f3781bd` (feat)

_Note: per the 17.1 STATE.md precedent ("single commit per task at green"), each task is one commit; RED was demonstrated by temporarily moving the not-yet-committed implementation file aside, running vitest to confirm the correct failure (`Cannot find module`), then restoring it before the GREEN run shown in the commit._

## Files Created/Modified
- `packages/contracts/src/picker.ts` - Zod schemas + inferred types for the picker contract (D-01/D-01a/D-01b)
- `packages/contracts/src/picker.test.ts` - Oracle-parse, malformed-reject, guard-case, closed-enum, and fixture-parse tests (17 assertions, `.parse()` only, never a swallowed `.safeParse`)
- `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` - Frozen `pickerSnapshotFixture` (pure data, no functions/scoring logic)
- `packages/contracts/src/index.ts` - New Picker contracts + fixture re-export block

## Decisions Made
- Guard-case candidate (`7450-guard-inverted`) is a deliberately constructed data point (front IV 15.5% > back IV 10.5% at 21/45 DTE), not a literal `buildCandidates()` row, per D-06's "planner's to pick" discretion — the real 2026-07-01 chain snapshot never produces an inverted structure for the 8 top-scored real candidates, so a guard case had to be authored.
- Its debit is -802.82 (schema-legal, no `debit > 0` constraint) — the mathematically honest consequence of running the mockup's own BSM formula under term-structure inversion, not an error to be "fixed."
- `beVsEm` breakdown contribution synthesized as `min(100, beWidth/(2*expectedMove)*100)`, per RESEARCH Assumption A3, rather than porting the mockup's literal `K===7500` strike-proximity term.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>`/`<behavior>` specs; all `<acceptance_criteria>` and the plan's `<verification>`/`<threat_model>` mitigations (T-18-01/T-18-02/T-18-03) are satisfied by the test suite as authored.

## Issues Encountered
- Deriving real oracle numbers required running `mockups/playground-v4.html`'s `buildCandidates()`/`putGreeks`/`fwdIV` logic in a throwaway Node script (scratchpad only, never committed) to get exact real BSM-derived values — per D-03, only the OUTPUT was ported into the fixture; no scoring logic exists in `packages/contracts`.
- The first few candidate guard-case parameter attempts (front IV moderately > back IV) produced a negative computed debit paired with a zero breakeven-width (degenerate P&L curve, since a negative debit means the position starts profitable everywhere) — resolved by accepting this as the mathematically correct, schema-legal behavior rather than searching for parameters that also keep `debit > 0` (which the exploration showed is essentially impossible for a genuinely inverted near-ATM put calendar).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `packages/contracts` now exports `pickerCandidate`/`pickerSnapshotResponse`/`pickerSnapshotFixture` — ready for 18-02 (PayoffChart additive props) and 18-03 (candidate→AnalyzerPosition adapter) to import from `@morai/contracts`.
- Phase 19's `/api/picker/candidates` route + `get_picker_candidates` MCP tool can satisfy `pickerSnapshotResponse` with zero shape change (MCP-02) — swapping the fixture import for a live response is import-only.
- No blockers for 18-02 through 18-05.

---
*Phase: 18-analyzer-picker-ui-redesign*
*Completed: 2026-07-04*

## Self-Check: PASSED

All created files confirmed on disk (`picker.ts`, `picker.test.ts`, `__fixtures__/picker-candidates.fixture.ts`, `index.ts`, this SUMMARY). All 3 commit hashes (`49efed5`, `f3781bd`, `028330d`) confirmed in `git log`.
