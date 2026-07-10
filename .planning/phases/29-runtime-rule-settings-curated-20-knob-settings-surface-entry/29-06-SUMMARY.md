---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 06
subsystem: api
tags: [typescript, vitest, fast-check, analytics, regime]

requires:
  - phase: 24-regime-breadth-board
    provides: regime.ts's four band functions (bandVixTermStructure/bandVvix/bandVix9dRatio/bandHyOas) and their WARN/CRISIS constants
provides:
  - Optional RegimeThresholds override param on all four regime band functions
  - packages/core/src/analytics/domain/rule-config.ts with resolveRegimeRuleConfig(overrides?)
affects: [29-12 (server regime-wiring), analytics regime board]

tech-stack:
  added: []
  patterns:
    - "resolveXRuleConfig(overrides?) pure merge over named constants, mirroring exits/domain/rule-config.ts"

key-files:
  created:
    - packages/core/src/analytics/domain/rule-config.ts
    - packages/core/src/analytics/domain/rule-config.test.ts
  modified:
    - packages/core/src/analytics/domain/regime.ts
    - packages/core/src/analytics/domain/regime.test.ts

key-decisions:
  - "Exported the eight WARN/CRISIS constants from regime.ts (were module-private) so rule-config.ts can reference them by name in its ?? fallback idiom"
  - "rule-config.ts imports only regime.ts (no @morai/shared needed for this pure numeric merge)"

patterns-established:
  - "resolveXRuleConfig(overrides?) pure merge over named constants, mirroring exits/domain/rule-config.ts"

requirements-completed: []

coverage:
  - id: D1
    description: "bandVixTermStructure/bandVvix/bandVix9dRatio/bandHyOas accept an optional {warn,crisis} threshold pair; omission uses today's module constants"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/domain/regime.test.ts — omission-regression + overridden-boundary + fast-check monotonicity under arbitrary thresholds"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveRegimeRuleConfig(overrides?) produces the four threshold pairs; omission reproduces regime.ts defaults, single-field override touches exactly that field"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/domain/rule-config.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every pre-existing regime test passes UNMODIFIED"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/domain/regime.test.ts (original 32 tests untouched, all pass)"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 06: Regime Threshold Override Seam Summary

**Analyzer regime board's four warn/crisis threshold pairs (VIX term structure, VVIX, VIX9D ratio, HY OAS) get an optional per-call override plus a pure `resolveRegimeRuleConfig` merge function — omission reproduces today's banding byte-identically.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-10T04:33:00Z
- **Completed:** 2026-07-10T04:37:06Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- All four `bandX(value, thresholds?)` functions in `regime.ts` accept an optional `{warn, crisis}` pair, defaulting to their exported named constants
- New `packages/core/src/analytics/domain/rule-config.ts` — `RegimeRuleOverrides`, `RegimeRuleConfig`, and `resolveRegimeRuleConfig(overrides?)` mirroring the `exits/domain/rule-config.ts` per-field `?? CONSTANT` idiom
- Full test suite (268 files, 2863 tests) green; typecheck and lint clean

## Task Commits

Each task was committed atomically (TDD RED confirmed then GREEN, single commit per task per project TDD precedent — matches 17.1-01/18-03/29-05):

1. **Task 1: regime.ts — optional {warn,crisis} threshold param on all four band functions** - `995b843` (feat)
2. **Task 2: analytics/domain/rule-config.ts — RegimeRuleConfig + resolveRegimeRuleConfig** - `90c472a` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/core/src/analytics/domain/regime.ts` - exported the eight WARN/CRISIS constants; each of the four band functions takes an optional `RegimeThresholds` second param
- `packages/core/src/analytics/domain/regime.test.ts` - added omission-regression + overridden-boundary tests per function, plus a fast-check monotonicity property under arbitrary thresholds (pre-existing tests untouched)
- `packages/core/src/analytics/domain/rule-config.ts` (new) - `RegimeRuleOverrides` / `RegimeRuleConfig` types + `resolveRegimeRuleConfig(overrides?)`
- `packages/core/src/analytics/domain/rule-config.test.ts` (new) - omission-deep-equal + single-field-override tests

## Decisions Made
- Exported the eight WARN/CRISIS constants from `regime.ts` (were module-private) so `rule-config.ts` can reference them by name in its `?? CONSTANT` fallback — required by Task 2's action text and keeps the default byte-identical to the named constant (not a re-typed literal)
- `rule-config.ts` imports only `./regime.ts` — no `@morai/shared` import needed for this pure numeric merge (plan said "only `./regime.ts` + `@morai/shared`" as an upper bound, not a requirement to import both)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `resolveRegimeRuleConfig`'s four pairs are ready for `getRegimeBoard` to consume at server request time (29-12) — that plan reads overrides fresh per `GET /api/analytics/regime` request per this plan's `key_links`
- No wiring into `getRegimeBoard.ts` yet — this plan is domain-layer only, as scoped

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED
