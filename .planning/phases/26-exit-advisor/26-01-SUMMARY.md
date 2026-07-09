---
phase: 26-exit-advisor
plan: 01
subsystem: api
tags: [zod, hexagonal, exits, picker, contracts, docs-first]

requires: []
provides:
  - docs/architecture/exit-rules.md — the exit rule ladder, precedence order, and hysteresis bands (docs-before-code)
  - exported haircutFill(quote, side) pure function in candidate-selection.ts
  - packages/contracts/src/exits.ts — exitsResponse Zod contract (heldPositionVerdict, exitMetric, exitRuleSetEntry)
  - packages/core/src/exits/domain/types.ts + application/ports.ts — the exits interface surface
affects: [26-02, 26-03, 26-04, 26-05, 26-06]

tech-stack:
  added: []
  patterns:
    - "exits bounded context sibling to picker — own application ports, never a foreign domain/ import"
    - "haircutFill(quote, side) shared between entry (picker) and exit (ROLL) pricing — one source of truth for the fill model"

key-files:
  created:
    - docs/architecture/exit-rules.md
    - packages/contracts/src/exits.ts
    - packages/contracts/src/exits.test.ts
    - packages/core/src/exits/domain/types.ts
    - packages/core/src/exits/application/ports.ts
    - packages/core/src/exits/index.ts
  modified:
    - docs/architecture/jobs.md
    - docs/TOPIC-MAP.md
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/candidate-selection.test.ts
    - packages/contracts/src/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "exitRuleSetEntry uses kind enum trigger|profit-take|roll|hold (no 'gate' kind — exits has no hard filters, only triggers)"
  - "ForReadingEconomicEvents re-declared exits-owned (Tier1Event, no source field) and aliased ForReadingEconomicEventsForExits at the top-level core barrel to avoid colliding with picker's own export of the same name"
  - "StorageError in exits/application/ports.ts is structurally identical to journal's and intentionally NOT re-exported from the exits barrel or the top-level core barrel (analytics/picker precedent)"

requirements-completed: [EXIT-01, EXIT-04, EXIT-06]

coverage:
  - id: D1
    description: "docs/architecture/exit-rules.md documents the seven exit rules, the STOP>EVT>GAMMA>TERM>TAKE>ROLL>HOLD precedence order, and the hysteresis band table, before any exits code lands"
    requirement: "EXIT-01"
    verification:
      - kind: other
        ref: "grep -q 'STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD' docs/architecture/exit-rules.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "haircutFill is an exported pure function; picker entry pricing is behavior-identical (every pre-existing picker candidate-selection test passes unchanged, plus 4 new unit tests)"
    requirement: "EXIT-06"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#haircutFill (Phase 26, extracted for exits/ROLL pricing reuse — Pitfall 2)"
        status: pass
    human_judgment: false
  - id: D3
    description: "exitsResponse parses a valid verdict payload, rejects one missing metric or ruleId, and carries no confidence field anywhere in the schema"
    requirement: "EXIT-04"
    verification:
      - kind: unit
        ref: "packages/contracts/src/exits.test.ts#exitsResponse"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-09
status: complete
---

# Phase 26 Plan 01: Docs-first + haircutFill extraction + exits contracts/types/ports Summary

**exit-rules.md documents the seven-rule ladder before code; haircutFill is now a shared exported pricing function; the exits contract/type/port surface is defined and typechecks clean.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-09T04:19:42-05:00
- **Completed:** 2026-07-09T04:24:59-05:00
- **Tasks:** 3
- **Files modified:** 12 (6 created, 6 modified)

## Accomplishments
- `docs/architecture/exit-rules.md` — the seven exit rule rows, the STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD precedence order (one-line rationale per rung), the per-rung hysteresis arm/disarm band table, P&L basis, and the read-only STRM-04/EXIT-10 boundary. `jobs.md`'s chain line extended with `compute-exit-advice` as the new terminal step; `TOPIC-MAP.md` indexes the new doc.
- `haircutFill(quote, side)` promoted from picker's private `buyFill`/`sellFill` closures to an exported pure function using the already-exported `FILL_WIDTH_FRACTION` constant. `selectCandidates` calls it in place of the closures — mechanical extraction, no formula change. All 14 pre-existing picker candidate-selection tests pass unchanged; 4 new unit tests cover buy/sell direction and the zero-width market case.
- `packages/contracts/src/exits.ts` — `exitMetric`, `exitVerdictEnum` (closed enum HOLD/TAKE/STOP/ROLL/EXIT_PRE_EVENT), `exitRollDetail`, `heldPositionVerdict`, `exitRuleSetEntry`, `exitsResponse`. No confidence/probability field anywhere. 7 new contract tests: accepts a well-formed payload, rejects missing metric/ruleId, rejects an unknown verdict, round-trips ROLL detail, and confirms `heldPositionVerdict.parse` strips an injected `confidence` key.
- `packages/core/src/exits/domain/types.ts` + `application/ports.ts` + `index.ts` barrel — `HeldPosition`, `MarketContext` (incl. `RollChainContext` for ROLL pricing), `ExitVerdict`, `PreviousVerdict`, and the six driven port TYPE declarations (`ForReadingHeldPositions`, `ForReadingLatestSnapshotPerOpenCalendar`, `ForReadingEconomicEvents`, `ForReadingChainForRoll`, `ForReadingLatestVerdictsPerCalendar`, `ForPersistingExitVerdict`) — declarations only, no logic. Re-exported through `packages/core/src/index.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — exit-rules.md + jobs.md chain line + TOPIC-MAP** - `d2e0247` (docs)
2. **Task 2: Extract haircutFill from picker's private closures (behavior-identical)** - `e2efcb8` (feat)
3. **Task 3: Exits interface surface — contracts + domain types + application ports** - `219bf24` (feat)

_Note: TDD tasks (2 and 3) were verified RED-then-GREEN per `.claude/rules/tdd.md` (RED confirmed by running the suite before implementing) but committed as ONE commit at green each, matching Phase 25's precedent (see plan `<execution_context>`)._

## Files Created/Modified
- `docs/architecture/exit-rules.md` - the exit rule ladder doc (new)
- `docs/architecture/jobs.md` - chain line extended with compute-exit-advice + new job catalog row
- `docs/TOPIC-MAP.md` - exit-rules.md row added
- `packages/core/src/picker/domain/candidate-selection.ts` - haircutFill exported, selectCandidates rewired
- `packages/core/src/picker/domain/candidate-selection.test.ts` - 4 new haircutFill unit tests
- `packages/contracts/src/exits.ts` - the exitsResponse Zod schema surface (new)
- `packages/contracts/src/exits.test.ts` - 7 contract tests (new)
- `packages/contracts/src/index.ts` - re-exports exits.ts schemas + types
- `packages/core/src/exits/domain/types.ts` - HeldPosition/MarketContext/ExitVerdict/PreviousVerdict (new)
- `packages/core/src/exits/application/ports.ts` - the six driven port declarations (new)
- `packages/core/src/exits/index.ts` - exits bounded-context barrel (new)
- `packages/core/src/index.ts` - re-exports the exits barrel (ForReadingEconomicEvents aliased to avoid a name collision with picker's own export)

## Decisions Made
- `exitRuleSetEntry.kind` enum is `trigger | profit-take | roll | hold` (no `gate` kind) — exits has no hard entry-style filters, only triggers/profit-take/roll/default, unlike picker's gate/score/experimental taxonomy.
- `ForReadingEconomicEvents` is re-declared exits-owned (a `Tier1Event` shape with no `source` field, vs. picker's `EconomicEvent` which has one) and re-exported from the top-level `core/src/index.ts` barrel under the alias `ForReadingEconomicEventsForExits` to avoid colliding with picker's identically-named but structurally different export.
- `StorageError` in `exits/application/ports.ts` is structurally identical to journal's `StorageError` and intentionally not re-exported a second time from either the exits barrel or the top-level core barrel — same precedent as `analytics/index.ts` and `picker/index.ts`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The exits interface surface is complete and typechecks clean end to end. 26-02 can now build the exit-rule registry + pure evaluator against `HeldPosition`/`MarketContext`/`ExitVerdict`/`PreviousVerdict` and import `haircutFill` directly for ROLL pricing (no re-derivation). 26-03 implements the driven ports declared here (`ForReadingLatestSnapshotPerOpenCalendar` must use a fresh `DISTINCT ON` query, never `readJournal`, per RESEARCH Pitfall 1). No blockers.

---
*Phase: 26-exit-advisor*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 7 created files found on disk; all 3 task commits (`d2e0247`, `e2efcb8`, `219bf24`) found in
git history.
