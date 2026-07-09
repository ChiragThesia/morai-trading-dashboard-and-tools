---
phase: 28-playbook-gates-anti-criteria-sizing
plan: 01
subsystem: picker
tags: [vix, entry-gate, hysteresis, fast-check, tdd, fred, business-days]

requires:
  - phase: 24-regime-breadth-board
    provides: macro_observations table + FRED VIXCLS/VXVCLS ingestion, regime-board.md's vix9d-vix epoch-mismatch warning
  - phase: 26-exit-advisor
    provides: exit-rules.ts hysteresis convention (ExitRung {label, arm, disarm}), evaluate-exit.ts wasArmed pattern
provides:
  - "resolveEntryGate — pure market-level entry gate (VIX/ratio banding, hysteresis, GATE BLIND fail-closed, brake passthrough)"
  - "VIX_LADDER — shared four-tier constant set for Plan 04's sizing tiers"
  - "businessDaysSince — NYSE-holiday-aware business-day age (noon-UTC probe fix)"
  - "docs/architecture/playbook-gates.md — the whole phase's design contract"
affects: [28-02-anti-criteria-brakes, 28-03-gate-wiring, 28-04-sizing-tiers]

tech-stack:
  added: []
  patterns:
    - "Market-level gate computed once per cohort, never per-candidate (fixes the retired term-inversion gate's placement mistake)"
    - "Rung-array hysteresis (worst-first scan, reasons-tag self-read) mirrors exit-rules.ts's STOP_RUNGS/wasArmed convention, generalized to two independent metrics (VIX, ratio)"
    - "Penalty multiplier is a pure continuous function of the current value; only the discrete state label carries hysteresis"

key-files:
  created:
    - packages/core/src/picker/domain/entry-gate.ts
    - packages/core/src/picker/domain/entry-gate.test.ts
    - docs/architecture/playbook-gates.md
  modified:
    - docs/architecture/picker-rules.md
    - docs/architecture/regime-board.md
    - docs/TOPIC-MAP.md

key-decisions:
  - "businessDaysSince probes each candidate day at noon UTC (not midnight) before calling isNyseHoliday — a UTC-midnight instant lands in the PREVIOUS ET calendar day for 4-5 hours (DST-dependent), which would have silently mis-checked the wrong date against the NYSE holiday table"
  - "Hysteresis is a two-rung array per metric (blocked, penalty), worst-first scan, self-read via reasons tags (vixBlocked/vixPenalty/ratioBlocked/ratioPenalty) on the previous EntryGateState — no new fields needed, mirrors exit-rules.ts's rung-array + wasArmed shape"
  - "Penalty multiplier is decoupled from state hysteresis: it is always a pure continuous function of the raw VIX/ratio value (bandMultiplier), while only the discrete open/penalty/blocked/blind label inherits arm/disarm hysteresis — documented with a ponytail: comment and an explicit upgrade path"
  - "Ratio penalty floor (0.90) re-declared by value in entry-gate.ts (not imported) — architecture rule 7 forbids a domain-to-domain cross-context import from analytics/domain/regime.ts's VIX_TERM_STRUCTURE_WARN"

patterns-established:
  - "Core-local structural mirror types (MacroSeriesRow) instead of importing another bounded context's application port type into a domain module — same convention analytics' RegimeIndicatorOut already uses one layer up"

requirements-completed: [PLAY-01]

coverage:
  - id: D1
    description: "docs/architecture/playbook-gates.md documents the whole phase's design (gate flow, shared VIX ladder, penalty bands + hysteresis, GATE BLIND, both brakes, deferred sustained-trend row) before any code"
    requirement: "PLAY-01"
    verification:
      - kind: other
        ref: "grep -qi 'GATE BLIND' docs/architecture/playbook-gates.md && grep -qi 'sustained-trend' docs/architecture/playbook-gates.md && grep -q playbook-gates docs/TOPIC-MAP.md && grep -qi playbook-gates docs/architecture/picker-rules.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveEntryGate resolves state 'blocked' at VIX >= 25 or ratio >= 0.95, the worse regime wins"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveEntryGate — hard block"
        status: pass
    human_judgment: false
  - id: D3
    description: "Linear penalty band (multiplier 1.0->0.3) across VIX 20-25 and ratio 0.90-0.95, monotonic, never a cliff at the boundary; combined multiplier = min of the two"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveEntryGate — penalty band (linear, not a cliff)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GATE BLIND: businessDaysSince(asOf, now) > 3 or macro missing entirely fails CLOSED to state 'blind', entriesAllowed false — never a silent 'open' (USER DECISION 1)"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveEntryGate — GATE BLIND (fails closed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Hysteresis holds blocked/penalty state across the disarm band without flipping on day-to-day noise, for both VIX and ratio ladders (fast-check no-flap property)"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveEntryGate — VIX hysteresis (no-flap)"
        status: pass
    human_judgment: false
  - id: D6
    description: "businessDaysSince is NYSE-holiday-aware (isNyseHoliday reuse, no calendar-day proxy), correct across a 3-day weekend and a clustered holiday"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#businessDaysSince"
        status: pass
    human_judgment: false
  - id: D7
    description: "Anti-criteria brake passthrough: maxOpenBrake/cooldownBrake true forces entriesAllowed false and names the tripped brake in reasons, even with a calm VIX/ratio"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#resolveEntryGate — anti-criteria brake passthrough"
        status: pass
    human_judgment: false
  - id: D8
    description: "One shared VIX_LADDER constant set (four contiguous, non-overlapping tiers) for later plans to import for sizing"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/entry-gate.test.ts#VIX_LADDER"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-09
status: complete
---

# Phase 28 Plan 01: Playbook Gates Docs + Shared VIX Ladder + resolveEntryGate Summary

**Pure, tested market-level entry gate (resolveEntryGate) with a linear penalty band, arm/disarm
hysteresis, and a fail-closed GATE BLIND state, plus the phase's design doc — zero wiring yet.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-09T15:35:00Z
- **Completed:** 2026-07-09T16:30:00Z
- **Tasks:** 2 (1 docs, 1 TDD)
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- `docs/architecture/playbook-gates.md` — the design contract for the whole phase: gate flow,
  shared VIX ladder, penalty bands + hysteresis table, GATE BLIND fail-closed rationale, both
  anti-criteria brakes, and the deferred sustained-trend row with its full rationale (crisis
  gates cover vol danger, deltaNeutral + GAMMA/STOP cover directional blowthrough, n=13 gives
  no calibration basis).
- `resolveEntryGate` (packages/core/src/picker/domain/entry-gate.ts) — the single pure function
  that bands VIX and VIX/VIX3M into open/penalty/blocked/blind, with independent per-metric
  hysteresis and unconditional brake passthrough.
- `VIX_LADDER` — one four-tier constant set (low/normal/elevated/crisis, contiguous, no
  gap/overlap) for the penalty band, the hard block, and Plan 04's sizing tiers to share.
- `businessDaysSince` — an exact Mon-Fri, NYSE-holiday-aware business-day loop, with a fix for
  a timezone off-by-one the research's own suggested snippet would have introduced (see
  Deviations).
- 37 example + fast-check tests, all green on first implementation pass; full suite (2663
  tests), typecheck, and lint all clean.

## Task Commits

1. **Task 1: Docs-first — playbook-gates.md + picker-rules.md gate section + regime-board.md
   note + TOPIC-MAP** - `8f6d298` (docs)
2. **Task 2: entry-gate.ts — resolveEntryGate (TDD)**
   - RED: `78fcecc` (test) — confirmed failing on missing module before implementation
   - GREEN: `1bcbb8b` (feat) — 37/37 tests green, typecheck clean

## Files Created/Modified

- `docs/architecture/playbook-gates.md` - phase design contract (gate, brakes, sizing, deferred row)
- `docs/architecture/picker-rules.md` - "Deferred to the playbook-port phase" lines replaced with a Market-Level Entry Gate pointer
- `docs/architecture/regime-board.md` - Known-limitations note that Phase 28 resolves the vix9d-vix epoch-mismatch constraint via the FRED pair
- `docs/TOPIC-MAP.md` - new row for playbook-gates.md
- `packages/core/src/picker/domain/entry-gate.ts` - VIX_LADDER, gate rungs, resolveEntryGate, extractVixPair, businessDaysSince, applyGatePenaltyScore
- `packages/core/src/picker/domain/entry-gate.test.ts` - 37 example + fast-check tests

## Decisions Made

- **businessDaysSince noon-UTC probe (bug fix, not a plan change):** 28-RESEARCH.md's own
  suggested `businessDaysSince` snippet constructs each candidate day as UTC midnight and
  passes it straight into `isNyseHoliday`, which formats in `America/New_York`. A UTC-midnight
  instant is the PREVIOUS ET calendar day for 4-5 hours (DST-dependent) — e.g. UTC midnight on
  2026-01-01 formats as `2025-12-31` in ET, silently checking the wrong date and missing New
  Year's Day entirely. Fixed by probing at noon UTC instead (always inside the same ET calendar
  day regardless of DST offset). Documented inline with a `ponytail:` comment.
- **Two-rung hysteresis array per metric, not a single blocked-only rung:** the must-have truth
  "Hysteresis holds a blocked/penalty state" requires the PENALTY label itself to resist
  flapping, not just the blocked label. Implemented as `VIX_GATE_RUNGS`/`RATIO_GATE_RUNGS`
  arrays of `{label: "blocked"|"penalty", arm, disarm}`, walked worst-first — the exact
  `STOP_RUNGS`/`evalStop` shape from `exit-rules.ts`/`evaluate-exit.ts`, generalized to two
  independent metrics. Each metric's previous-cycle label is self-read from `reasons` tags on
  the passed-in `previousState` (no new EntryGateState fields needed).
- **Penalty multiplier decoupled from state hysteresis:** the multiplier is always a pure
  continuous function of the CURRENT raw VIX/ratio value (`bandMultiplier`), independent of
  whether the discrete `state` label is being held-armed by hysteresis. This keeps the
  "monotonic linear 1.0->0.3" acceptance criterion trivially satisfiable while still giving the
  `state` enum its own no-flap guarantee. Documented as a `ponytail:` simplification with a
  named upgrade path (multiplier-level hysteresis) if a future backtest shows score-level
  flapping matters.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a timezone off-by-one in businessDaysSince's holiday check**
- **Found during:** Task 2, while implementing `businessDaysSince` from 28-RESEARCH.md's
  Pattern 4 code example
- **Issue:** The research's own suggested implementation passes a UTC-midnight `Date` directly
  into `isNyseHoliday`, which formats the instant in `America/New_York`. Since ET is behind
  UTC by 4-5 hours, a UTC-midnight instant resolves to the PREVIOUS ET calendar day for that
  window — the holiday check would silently test the wrong date (e.g. New Year's Day itself
  would never register as a holiday).
- **Fix:** Probe each candidate day at noon UTC (`dayStartMs + 12h`) before calling
  `isNyseHoliday` — noon UTC is always within the same ET calendar day regardless of DST
  offset (UTC-4 or UTC-5), so the holiday lookup targets the correct date.
- **Files modified:** packages/core/src/picker/domain/entry-gate.ts
- **Verification:** `entry-gate.test.ts`'s Thanksgiving/3-day-weekend business-day tests pass;
  added an explicit test asserting the exact NYSE-holiday-aware count across Labor Day weekend.
- **Committed in:** `1bcbb8b` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correctness of the GATE BLIND business-day age check — an
uncaught off-by-one would have under-counted staleness around every US holiday, weakening the
fail-closed guarantee USER DECISION 1 requires. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. `resolveEntryGate` is fully implemented and tested; it is simply not yet called by
`computePickerSnapshot.ts` (that wiring is explicitly Plan 03's scope, stated in the plan
objective as "ships ZERO wiring").

## Threat Flags

None beyond what the plan's own threat_model already covers (T-28-01/02/03 — all mitigated in
this plan's implementation: fail-closed GATE BLIND, hysteresis fast-check, and the gate's
placement as a standalone domain module rather than a RULE_SET_METADATA row).

## Next Phase Readiness

- `resolveEntryGate`, `VIX_LADDER`, `businessDaysSince`, and `extractVixPair` are ready for
  Plan 02 (anti-criteria brake computation) and Plan 03 (use-case wiring + snapshot payload).
- Plan 04 can import `VIX_LADDER` directly for the sizing-tier registry — no new ladder needed.
- No blockers.

---
*Phase: 28-playbook-gates-anti-criteria-sizing*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created files confirmed on disk (docs/architecture/playbook-gates.md,
packages/core/src/picker/domain/entry-gate.ts, entry-gate.test.ts, this SUMMARY.md); all 3
commit hashes (8f6d298, 78fcecc, 1bcbb8b) confirmed in git log.
