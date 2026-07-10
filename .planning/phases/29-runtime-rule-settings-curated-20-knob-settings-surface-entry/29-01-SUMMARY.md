---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
plan: 01
subsystem: docs
tags: [architecture, docs, governance, rule-overrides]

# Dependency graph
requires: []
provides:
  - "docs/architecture/rule-overrides.md documenting the override-layer architecture"
  - "stack-decisions.md D25 row overriding Phase 28 T-28-11"
  - "TOPIC-MAP.md index entry for the new doc"
affects: [29-08 (rule_overrides schema plan), 29-picker-domain-plans, 29-exits-domain-plans, 29-regime-domain-plans, 29-web-settings-modal-plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Docs Before Code: architecture decision documented before any migration/schema lands"

key-files:
  created: [docs/architecture/rule-overrides.md]
  modified: [docs/architecture/stack-decisions.md, docs/TOPIC-MAP.md]

key-decisions:
  - "D25 added to stack-decisions.md: rule_overrides is a single-row JSONB table keyed by fixed literal id \"default\" (mirrors broker_tokens.app_id), no DB CHECK constraint"
  - "This phase explicitly overrides Phase 28 T-28-11 — constants remain DEFAULTS, the overrides row is an explicit visible layer merged over them at consumption time"

patterns-established:
  - "Pattern 1 (optional-param-defaulting-to-constant): every new override param must default to the exact existing named constant it replaces, never a fresh literal — required for BT-02 backtest-oracle byte-identical reproduction"
  - "Each engine (picker, exits, regime) owns its own pure resolveXConfig(overrides?) merge function in its own domain/ module — no cross-context settings god-module"

requirements-completed: []

coverage:
  - id: D1
    description: "docs/architecture/rule-overrides.md created, documenting the override-layer architecture, merge seam, curated/excluded knob lists, hysteresis-pair validation, and reset-per-group semantics"
    verification:
      - kind: other
        ref: "test -f docs/architecture/rule-overrides.md && rg -q rule_overrides docs/architecture/stack-decisions.md && rg -q T-28-11 docs/architecture/rule-overrides.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "stack-decisions.md D25 decision row + section added, citing the T-28-11 override and the broker_tokens singleton convention"
    verification:
      - kind: other
        ref: "rg -q rule_overrides docs/architecture/stack-decisions.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "TOPIC-MAP.md indexes the new rule-overrides.md doc in the architecture section"
    verification:
      - kind: other
        ref: "rg -q rule-overrides docs/TOPIC-MAP.md"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-07-10
status: complete
---

# Phase 29 Plan 01: Runtime Rule Overrides — Docs Before Code Summary

**Documented the rule_overrides architecture and its explicit override of Phase 28's T-28-11 governance decision, gating the downstream schema plan (29-08).**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-10T03:53:05Z
- **Completed:** 2026-07-10T03:55:08Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Added a D25 decision row + section to `docs/architecture/stack-decisions.md` recording the `rule_overrides` single-row JSONB table (fixed literal id `"default"`, no DB CHECK constraint — mirrors `broker_tokens.app_id`), explicitly stating it overrides T-28-11
- Created `docs/architecture/rule-overrides.md` (145 lines): override-layer architecture, the three per-engine `resolveXConfig(overrides?)` merge functions, the optional-param-defaulting-to-constant seam pattern (required for the Phase 27 BT-02 backtest oracle), the curated ~20-knob list and excluded (code-only) knob list from CONTEXT.md, hysteresis-pair validation, and reset-per-group semantics
- Indexed the new doc in `docs/TOPIC-MAP.md`'s architecture section

## Task Commits

Each task was committed atomically:

1. **Task 1: Document the rule_overrides decision in stack-decisions.md + a dedicated architecture doc** - `5de2755` (docs)
2. **Task 2: Index the new doc in TOPIC-MAP.md** - `966100b` (docs)

## Files Created/Modified
- `docs/architecture/rule-overrides.md` - New doc: override-layer architecture, merge seam pattern, curated/excluded knob split, hysteresis validation, reset semantics
- `docs/architecture/stack-decisions.md` - D25 decision row + section for `rule_overrides`, citing the T-28-11 override
- `docs/TOPIC-MAP.md` - Architecture section index entry for `rule-overrides.md`

## Decisions Made
- D25 storage shape (single-row JSONB, `"default"` literal key, no CHECK constraint) recorded as the canonical decision — matches CONTEXT.md's user-approved Storage section and the `broker_tokens` precedent already in the codebase
- The T-28-11 override is stated in prose in both `stack-decisions.md` and `rule-overrides.md`: constants stay the defaults, the row is an explicit visible layer, never a silent one

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Docs-before-code obligation is met for the `rule_overrides` table and the runtime-override
architecture. The downstream schema plan (29-08, `packages/adapters/src/postgres/schema.ts`
+ migration) is unblocked. Later plans wiring the per-engine merge functions
(`resolvePickerRuleConfig`, `resolveExitRuleConfig`, `resolveRegimeRuleConfig`) should follow
Pattern 1 as documented here, referencing the exact named constant for every default.

---
*Phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry*
*Completed: 2026-07-10*

## Self-Check: PASSED
