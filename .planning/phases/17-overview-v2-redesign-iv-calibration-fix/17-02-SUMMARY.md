---
phase: 17-overview-v2-redesign-iv-calibration-fix
plan: 02
subsystem: analytics
tags: [scenario-engine, calendar-spread, payoff-curve, gex-levels, fast-check, tdd]

# Dependency graph
requires:
  - phase: 17-overview-v2-redesign-iv-calibration-fix
    provides: "17-01: AnalyzerPosition.frontIvStatus/backIvStatus contract this plan defines is consumed by resolveLegIv (iv-calibration.ts) — no direct import, just the shared status-field shape"
provides:
  - "AnalyzerPosition.frontIvStatus / backIvStatus (optional, 'ok' | 'non-convergent', default 'ok') — the leg-level IV convergence contract"
  - "bookPL (T+0) excludes a position when either leg is non-convergent"
  - "bookPLAtExpiry (@exp) excludes a position only when the back leg is non-convergent (front-only non-convergence still draws @exp — Pitfall 1)"
  - "t0ExcludedPositions(positions) -> { count, ids } for the UI's 'T+0 excludes N position(s)' self-flag (D-02)"
  - "buildScenarioStrip(levels, positions, spot) -> { levels, expiryLabel } — bounded/deduped/capped D-06 key-level set with D-07 front-expiry header"
affects: [17-04, overview-v2-redesign]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared per-leg predicate helpers (includedForT0/includedForExpiry) instead of duplicating the exclusion check inline in bookPL and bookPLAtExpiry"
    - "Optional status fields with an implicit 'ok' default so existing AnalyzerPosition construction sites (Analyzer.tsx) don't need updating in this plan — Plan 04 wires them"

key-files:
  created: []
  modified:
    - apps/web/src/lib/scenario-engine.ts
    - apps/web/src/lib/scenario-engine.test.ts

key-decisions:
  - "frontIvStatus/backIvStatus made OPTIONAL (not required) on AnalyzerPosition, defaulting to 'ok' when absent — Analyzer.tsx has 3 existing AnalyzerPosition construction sites that don't set these fields; making them required would force out-of-scope edits to a file explicitly owned by a later plan (Plan 04, per this plan's objective: 'it only defines the status fields that Plan 04 populates')"
  - "bookPL excludes on EITHER frontIvStatus OR backIvStatus being non-convergent, not just front as the task action text's shorthand implied — required to satisfy the plan's own <behavior> spec ('Back-leg non-convergent... dropped from BOTH the T+0 sum AND the @exp sum') and threat T-17-03's mitigation intent; implemented via a single includedForT0() predicate shared with t0ExcludedPositions()"
  - "'each position's short/long strikes' (D-06) collapses to ONE strike per position in buildScenarioStrip: the current AnalyzerPosition/calendarNetPrice model prices both legs of a calendar at the same strike (extractStrike(pos) is the sole strike input to both backPrice and frontPrice calls) — there is no separate front-strike field to diverge from the back-strike today, so 'short/long' is descriptive of the two option legs, not two distinct strike values to plot"
  - "t0ExcludedPositions() counts only IV-driven exclusions (frontIvStatus/backIvStatus === 'non-convergent'), not positions the user manually unchecked via included:false — keeps the UI self-flag message ('T+0 excludes N position(s): IV n/a') accurate to its own wording"

requirements-completed: [OVW-01, OVW-02]

coverage:
  - id: D1
    description: "Front-leg-non-convergent position excluded from T+0 aggregate, still contributes to @exp (Pitfall 1)"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#bookPL/bookPLAtExpiry — leg-level non-convergence exclusion (Pitfall 1 / D-02) — front-leg-non-convergent position: excluded from T+0, still contributes to @exp"
        status: pass
    human_judgment: false
  - id: D2
    description: "Back-leg-non-convergent position excluded from BOTH T+0 and @exp"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#bookPL/bookPLAtExpiry — leg-level non-convergence exclusion (Pitfall 1 / D-02) — back-leg-non-convergent position: excluded from BOTH T+0 and @exp"
        status: pass
    human_judgment: false
  - id: D3
    description: "t0ExcludedPositions() reports the count/ids of positions dropped from T+0 for the UI self-flag (D-02)"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#bookPL/bookPLAtExpiry — leg-level non-convergence exclusion (Pitfall 1 / D-02) — t0ExcludedPositions reports the count and ids of positions dropped from T+0"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#bookPL/bookPLAtExpiry — leg-level non-convergence exclusion (Pitfall 1 / D-02) — t0ExcludedPositions ignores positions already excluded via `included: false`"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildScenarioStrip emits the D-06 bounded/deduped/sorted/capped key-level set (put wall/flip/spot/call wall + position strikes)"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#buildScenarioStrip — bounded key-level set (D-06 / D-07) — caps overflowing position strikes to the 4 closest to spot"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#buildScenarioStrip — bounded key-level set (D-06 / D-07) — dedupes a position strike equal to a GEX level"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#buildScenarioStrip — bounded key-level set (D-06 / D-07) — output is sorted strictly ascending"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#buildScenarioStrip — bounded key-level set (D-06 / D-07) — omits a null put/call wall instead of rendering it as 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "@exp column header resolves to the book's front (earliest) expiry across included positions, formatted short month/day (D-07)"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#buildScenarioStrip — bounded key-level set (D-06 / D-07) — front-expiry label equals the earliest included frontDte, formatted month/day"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-03
status: complete
---

# Phase 17 Plan 02: Scenario Engine — Leg-Level IV Exclusion + Scenario Strip Summary

**Extended `scenario-engine.ts` with leg-aware (front/back) non-convergence exclusion in `bookPL`/`bookPLAtExpiry` and a new `buildScenarioStrip()` producing the bounded D-06 key-level set with a D-07 front-expiry header**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-03T22:15:00Z (approx.)
- **Completed:** 2026-07-03T22:20:00Z (approx.)
- **Tasks:** 2 (both TDD red→green, no refactor commits needed)
- **Files modified:** 2

## Accomplishments

- `AnalyzerPosition` gains optional `frontIvStatus`/`backIvStatus` (`"ok" | "non-convergent"`,
  default `"ok"` when omitted) — the leg-level IV convergence contract Plan 04 will populate from
  Plan 01's `resolveLegIv`.
- `bookPL` (T+0 aggregate) now excludes a position when either leg is non-convergent.
  `bookPLAtExpiry` (@exp aggregate) excludes a position only when the **back** leg is
  non-convergent — a front-only non-convergent position still draws its `@exp` curve normally,
  correcting the UI-SPEC's blanket rule per RESEARCH.md Pitfall 1 (the back leg still carries real
  time value at the front expiry: `backT = max((backDte - frontDte)/365, 1e-6)`).
- Exported `t0ExcludedPositions(positions)` returning `{ count, ids }` for positions dropped from
  the T+0 aggregate due to IV non-convergence (not manual `included: false` toggles) — feeds the
  UI's "T+0 excludes N position(s): IV n/a" self-flag (D-02).
- Exported `buildScenarioStrip(levels, positions, spot)` — the bounded D-06 key-level set: non-null
  GEX levels (put wall/γ flip/call wall) + spot + each included position's strike, deduped within
  an epsilon, sorted ascending, capped at 8 total (keeping the 4 position strikes closest to spot
  when more remain). Also returns the D-07 `@exp` header label — the earliest included position's
  front expiry, formatted short month/day matching `Market.tsx`'s `gexAsOf` convention.

## Task Commits

Each task was committed atomically (TDD red→green):

1. **Task 1: Leg-level (front vs back) non-convergence exclusion (Pitfall 1 / D-02)**
   - RED: `76b381d` — `test(17-02): add leg-level non-convergence exclusion fixtures`
   - GREEN: `162fffe` — `feat(17-02): leg-level IV non-convergence exclusion in payoff engine`
2. **Task 2: buildScenarioStrip — bounded key-level set + front-expiry header (D-06 / D-07)**
   - RED: `1d0e7ad` — `test(17-02): add scenario-strip level-set tests`
   - GREEN: `d034f69` — `feat(17-02): buildScenarioStrip bounded key-level set`

_Note: no REFACTOR commits — both GREEN implementations used a shared predicate helper
(`includedForT0`/`includedForExpiry`) from the start, so nothing needed cleaning up afterward._

## Files Created/Modified

- `apps/web/src/lib/scenario-engine.ts` — added `AnalyzerPosition.frontIvStatus`/`backIvStatus`,
  `isIvExcludedFromT0`/`includedForT0`/`includedForExpiry` predicates, exported
  `t0ExcludedPositions()`, `ScenarioStripLevels`/`ScenarioStrip` types, and exported
  `buildScenarioStrip()`. `bookPL`/`bookPLAtExpiry` now route through the new predicates instead of
  the bare `!pos.included` check.
- `apps/web/src/lib/scenario-engine.test.ts` — added `CONTROL_POS`/`FRONT_NON_CONVERGENT_POS`/
  `BACK_NON_CONVERGENT_POS` fixtures + 5 tests for the leg-level exclusion behavior and
  `t0ExcludedPositions`, plus `occSymbolForStrike`/`makeStripPosition` helpers + 5 tests for
  `buildScenarioStrip` (overflow cap, dedup, sort order, null-level omission, front-expiry label).

## Decisions Made

- **`frontIvStatus`/`backIvStatus` are optional, default `"ok"`** — `Analyzer.tsx` has 3 existing
  `AnalyzerPosition` construction sites (`brokerToAnalyzerPosition`, `calendarToAnalyzerPosition`,
  the synthetic-position handler) that this plan does not touch (explicitly Plan 04's job per the
  plan's own objective text). Making the fields required would have broken `Analyzer.tsx`'s
  typecheck, forcing an out-of-scope edit. Optional-with-default preserves "existing tests still
  pass unchanged" (an explicit acceptance criterion) and keeps this plan's file scope to exactly
  `scenario-engine.ts` + its test file, per the plan's Wave 1 parallelism claim.
- **`bookPL` excludes on either leg's non-convergence, not just the front** — the task's `<action>`
  prose only explicitly said "skip a position when `pos.frontIvStatus === 'non-convergent'`" for
  `bookPL`, but the plan's own `<behavior>` block and the threat register (T-17-03) require
  back-leg non-convergence to drop the position from **both** T+0 and @exp. Implemented a single
  `includedForT0()` predicate checking both fields (shared with `t0ExcludedPositions`), rather than
  literally implementing only the front-leg check and leaving back-leg-non-convergent positions
  incorrectly priced into the T+0 curve. Documented as Rule 1 (bug — the literal action text would
  have produced behavior contradicting the plan's own acceptance criteria).
- **"Short/long strikes" (D-06) = one strike per position** — `AnalyzerPosition`/`calendarNetPrice`
  price both legs of a calendar at the same `extractStrike(pos)` value; there is no separate
  front-strike field today. `buildScenarioStrip` adds one strike column per included position, not
  two, since there is nothing to diverge from in the current data model. This matches every
  acceptance-criteria test case (single strike per position fixture) and is the only interpretation
  consistent with the existing pricing code this plan explicitly must not fork.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `bookPL` exclusion extended to cover back-leg non-convergence**
- **Found during:** Task 1, writing the GREEN implementation
- **Issue:** The task's literal `<action>` instructions described `bookPL` skipping only on
  `frontIvStatus === "non-convergent"`, but the plan's `<behavior>` block and acceptance criteria
  require back-leg non-convergence to exclude a position from BOTH T+0 and @exp. Implementing only
  the front-leg check would leave a back-leg-non-convergent position still priced into the T+0
  curve using its untrustworthy `backIv` value — contradicting the plan's own stated behavior and
  the T-17-03 threat mitigation.
- **Fix:** `bookPL` now uses a shared `includedForT0()` predicate that excludes on either
  `frontIvStatus === "non-convergent"` OR `backIvStatus === "non-convergent"`.
- **Files modified:** `apps/web/src/lib/scenario-engine.ts`
- **Verification:** `back-leg-non-convergent position: excluded from BOTH T+0 and @exp` test passes;
  full `scenario-engine.test.ts` suite green (16/16).
- **Committed in:** `162fffe` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (bug — behavior spec vs. literal action-text mismatch)
**Impact on plan:** Necessary to satisfy the plan's own `<behavior>`/acceptance criteria and threat
mitigation. No scope creep — only `bookPL`'s skip condition changed.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `AnalyzerPosition.frontIvStatus`/`backIvStatus` and `t0ExcludedPositions()` are ready for Plan 04
  to wire `Analyzer.tsx`'s construction sites to Plan 01's `resolveLegIv` results and render the
  "T+0 excludes N position(s)" self-flag.
- `buildScenarioStrip()` is ready for Plan 04/03 (Overview.tsx rewrite) to render the scenario
  strip's key-level columns and `@exp (Mon DD)` header.
- No blockers for Plan 03 (independent Wave 1 plan) or Plan 04 (Wave 2, depends on this plan's
  exports).

---
*Phase: 17-overview-v2-redesign-iv-calibration-fix*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: `apps/web/src/lib/scenario-engine.ts`
- FOUND: `apps/web/src/lib/scenario-engine.test.ts`
- FOUND: `.planning/phases/17-overview-v2-redesign-iv-calibration-fix/17-02-SUMMARY.md`
- FOUND commit: `76b381d` (test — leg-level exclusion fixtures)
- FOUND commit: `162fffe` (feat — leg-level exclusion)
- FOUND commit: `1d0e7ad` (test — scenario-strip level-set tests)
- FOUND commit: `d034f69` (feat — buildScenarioStrip)
