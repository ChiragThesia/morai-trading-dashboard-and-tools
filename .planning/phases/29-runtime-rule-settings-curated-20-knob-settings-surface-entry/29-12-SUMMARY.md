---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 12
subsystem: api
tags: [regime-board, rule-overrides, analytics, hexagonal, tdd]

# Dependency graph
requires:
  - phase: 29-06
    provides: resolveRegimeRuleConfig + optional-threshold band function seams (regime.ts, rule-config.ts)
  - phase: 29-08
    provides: makePostgresRuleOverridesRepo + memory twin (rule-overrides repo pair)
  - phase: 29-09
    provides: ForReadingRuleOverrides / ForWritingRuleOverrides ports (settings/application/ports.ts)
provides:
  - GetRegimeBoardDeps.readRuleOverrides wired through makeGetRegimeBoardUseCase
  - getRegimeBoard reads overrides fresh per HTTP/MCP request and rebands accordingly
  - server composition-root wiring (apps/server/src/main.ts) constructing the rule-overrides repo
affects: [29-13-runtime-rule-settings-surface (settings HTTP route/MCP tool + web modal)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isRegimeRuleOverrides narrowing guard mirrors picker's isPickerRuleOverrides (computePickerSnapshot.ts) — reject the whole group on any field-type mismatch, fall back to defaults"
    - "readRuleOverrides read fresh inside the async use-case body (never cached in the composition-root closure) — same shape as readMacroObservations"

key-files:
  created: []
  modified:
    - packages/core/src/analytics/application/getRegimeBoard.ts
    - packages/core/src/analytics/application/getRegimeBoard.test.ts
    - apps/server/src/main.ts

key-decisions:
  - "readRuleOverrides read AFTER the readMacroObservations early-return (not before) — a macro-read failure short-circuits without an unnecessary overrides read"
  - "regimeOverrides narrowed via a flat isRegimeRuleOverrides guard (8 optional-number fields) rather than picker's multi-shape guard — regime's contract group has no nested sub-objects"

patterns-established: []

requirements-completed: []

coverage:
  - id: D1
    description: "getRegimeBoard reads rule overrides fresh per request and resolves a RegimeRuleConfig before banding; all four bandX calls receive the resolved {warn,crisis} pairs"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#a regime override rebands the vvix indicator on the next call"
        status: pass
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#reads overrides fresh on every call — invoked once per getRegimeBoard() invocation"
        status: pass
    human_judgment: false
  - id: D2
    description: "No-override board output is byte-identical to today's; a readRuleOverrides read error degrades to defaults instead of crashing the board"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#all 9 pre-existing indicator/omission/error-propagation tests (unmodified assertions, now threaded with a no-override readRuleOverrides double)"
        status: pass
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#a readRuleOverrides read error degrades to defaults — never crashes the board (T-29-15)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Server composition root wires readRuleOverrides into the regime board use-case deps; typecheck clean"
    verification:
      - kind: other
        ref: "bun run typecheck (apps/server/src/main.ts satisfies GetRegimeBoardDeps)"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 12: Regime board runtime overrides wiring Summary

**getRegimeBoard now reads rule overrides fresh per HTTP/MCP request and rebands the four regime indicators (VIX/VIX3M, VVIX, VIX9D/VIX, HY OAS) accordingly — no worker job, no snapshot, effective on the very next GET.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-10T05:34:56Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `GetRegimeBoardDeps` gained a required `readRuleOverrides: ForReadingRuleOverrides` dependency
- Use-case body reads overrides fresh (never cached), narrows the `regime` group via a type guard, resolves `resolveRegimeRuleConfig(regimeOverrides)`, and threads `config.vixTermStructure` / `config.vvix` / `config.vix9dRatio` / `config.hyOas` into the four `bandX` calls
- A `readRuleOverrides` failure or malformed stored group degrades silently to the code-default thresholds — the board still renders (T-29-15)
- Server composition root (`apps/server/src/main.ts`) constructs `makePostgresRuleOverridesRepo(db)` once at boot and injects `readRuleOverrides` into `makeGetRegimeBoardUseCase`
- All 9 pre-existing regime board tests pass unmodified in assertions (only their deps-construction call sites were threaded with a `noOverrides` double); 4 new tests cover fresh-read-per-call, override reband, and error degradation

## Task Commits

Each task was committed atomically:

1. **Task 1: getRegimeBoard — readRuleOverrides dep + resolved thresholds threaded into bandX** - `2eb68ee` (feat, TDD RED→GREEN in one commit at green per tdd.md)
2. **Task 2: server main.ts — wire readRuleOverrides into the regime board deps** - `8939551` (feat)

## Files Created/Modified
- `packages/core/src/analytics/application/getRegimeBoard.ts` - added `readRuleOverrides` dep, fresh-per-request override read + `resolveRegimeRuleConfig` resolution, `isRegimeRuleOverrides` narrowing guard, threaded config into all 4 `bandX` calls
- `packages/core/src/analytics/application/getRegimeBoard.test.ts` - added `noOverrides` test double threaded into all 9 pre-existing deps-construction call sites (assertions unchanged); added 3 new tests (fresh-read-per-call, override reband, error-degrades-to-defaults)
- `apps/server/src/main.ts` - imported `makePostgresRuleOverridesRepo`, constructed `ruleOverridesRepo` once at boot, wired `readRuleOverrides` into `makeGetRegimeBoardUseCase`'s deps

## Decisions Made
- `readRuleOverrides()` is called AFTER the `readMacroObservations` early-return guard, not before — a macro-read failure short-circuits the function without an unnecessary overrides read (minor efficiency, no behavior change since overrides never gate the macro path)
- `isRegimeRuleOverrides` is a flat 8-field optional-number guard (no nested sub-objects) — simpler than picker's `isPickerRuleOverrides`, since the `regime` contract group (`packages/contracts/src/rule-settings.ts`) has no nested pairs, matching `RegimeRuleOverrides`'s own flat shape from 29-06

## Deviations from Plan

None - plan executed exactly as written. The plan's own threading map (bandVixTermStructure/bandVvix/bandVix9dRatio/bandHyOas each receiving their resolved `{warn,crisis}` pair) was followed literally.

## Issues Encountered

None. `resolveRegimeRuleConfig`, `RegimeRuleOverrides`, `RegimeThresholds`, and the optional-threshold `bandX` function signatures were all already in place from 29-06 exactly as documented in the read-first list — this plan was pure threading + composition-root wiring, no new domain logic.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The regime board's runtime-override read path is fully wired server-side. 29-13 (settings HTTP route/MCP tool + web modal) can now write `regime` group overrides via `ForWritingRuleOverrides` and expect the very next `GET /api/analytics/regime` to reflect them — no cache, no job, no snapshot to invalidate.
- No blockers. `bun run typecheck && bun run lint` both clean across the whole workspace (not just the touched files).

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*
