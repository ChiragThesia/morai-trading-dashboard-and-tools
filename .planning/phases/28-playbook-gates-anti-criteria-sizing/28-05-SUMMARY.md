---
phase: 28-playbook-gates-anti-criteria-sizing
plan: 05
subsystem: picker
tags: [picker, options, calendar-spreads, scoring, zod, vitest]

requires:
  - phase: 28-playbook-gates-anti-criteria-sizing
    provides: "Plan 03's entry gate (VIX/ratio crisis gate + anti-criteria brakes) and Plan 04's VIX-tiered sizing / autoTuneTargetDelta — the event bucket routes through the SAME gate/penalty machinery"
provides:
  - "selectEventCandidates: a thin [3,10]d-gap wrapper over selectCandidates, post-filtered to backEvents.length > 0"
  - "EVENT_RULE_SET_METADATA: a SEPARATE bucket-scoped rule registry (own sum-100 invariant) promoting backEventBonus to an active weight; the primary RULE_SET_METADATA is untouched"
  - "scoreEventCandidates: scores the event bucket at bucket-scaled weights + the backEventBonus bonus, reusing scoreCalendarCandidates's existing ablation seam — no second scoring engine"
  - "Additive `bucket` field (\"standard\" | \"event-calendar\") on PickerCandidateDomain / pickerCandidate, wired into computePickerSnapshot alongside the primary universe, routed through the same gate/brake suppression"
affects: [picker-analyzer-ui, backtest-picker-cohort-replay]

tech-stack:
  added: []
  patterns:
    - "Bucket-scoped rule registry: a SECOND RuleMetadata array reusing the primary registry's shape/invariants but with independently-rebalanced weights, never mutating the primary table"
    - "Post-scoring bonus override: scoreEventCandidates adds the backEventBonus bonus AFTER scoreCalendarCandidates, mirroring computePickerSnapshot's existing zeroEventAdjustment/applyGatePenalty post-scoring-override shape"

key-files:
  created:
    - packages/core/src/picker/domain/event-rules.test.ts
  modified:
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/candidate-selection.test.ts
    - packages/core/src/picker/domain/rules.ts
    - packages/core/src/picker/domain/scoring.ts
    - packages/core/src/picker/domain/scoring.test.ts
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/application/computePickerSnapshot.test.ts
    - packages/core/src/picker/application/ports.ts
    - packages/contracts/src/picker.ts
    - packages/contracts/src/picker.test.ts
    - packages/contracts/src/__fixtures__/picker-candidates.fixture.ts

key-decisions:
  - "backEventBonus bucket weight = 10 (top of the 8-10 UAT-pending range from 28-RESEARCH.md A5); the other 9 primary score weights are scaled by 0.9 proportionally so the bucket registry sums to 100"
  - "Event bucket is scored via scoreCalendarCandidates's existing per-criterion weights ablation seam (T-27-03) plus a post-scoring bonus add — reuses the primary formulas verbatim rather than a parallel scoring function"
  - "Event-bucket candidates ship in the SAME PickerSnapshot.candidates array (not a new top-level field), distinguished by the additive `bucket` tag — each universe ranked/capped at PICKER_TOP_N independently, then concatenated"

patterns-established:
  - "Bucket-scoped registries: future score-rule buckets should follow EVENT_RULE_SET_METADATA's shape (own sum-100 test, own refuted-criteria guard, primary registry untouched)"

requirements-completed: [PLAY-04]

coverage:
  - id: D1
    description: "selectEventCandidates emits only backEvents>0 candidates within the [3,10]d back-leg gap window; omitting gap params reproduces the primary universe exactly"
    requirement: PLAY-04
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectEventCandidates (28-05, PLAY-04 event-calendar bucket)"
        status: pass
    human_judgment: false
  - id: D2
    description: "EVENT_RULE_SET_METADATA sums to 100, promotes backEventBonus to active, carries no refuted criterion; the primary RULE_SET_METADATA and its own sum-100 test stay green and untouched"
    requirement: PLAY-04
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/event-rules.test.ts#EVENT_RULE_SET_METADATA — bucket registry invariants (T-28-13)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/rules.test.ts#RULE_SET_METADATA — registry invariants"
        status: pass
    human_judgment: false
  - id: D3
    description: "scoreEventCandidates scores the bucket at bucket-scaled weights plus the backEventBonus bonus, never exceeding 100; the primary scoreCalendarCandidates is unaffected"
    requirement: PLAY-04
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#scoreEventCandidates (28-05, PLAY-04 event-calendar bucket)"
        status: pass
    human_judgment: false
  - id: D4
    description: "computePickerSnapshot ships event-bucket candidates tagged 'event-calendar' (primary 'standard') alongside the primary universe; a blocked/blind/braked gate suppresses both; the additive bucket tag round-trips through the Zod contract with .default('standard') for old rows"
    requirement: PLAY-04
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#makeComputePickerSnapshotUseCase — event-calendar bucket (28-05, PLAY-04)"
        status: pass
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#pickerCandidate.bucket (28-05, PLAY-04 event-calendar bucket — additive)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-09
status: complete
---

# Phase 28 Plan 05: Event-Calendar Bucket Summary

**A second short-gap (3-10d) put-calendar universe that intentionally owns a scheduled economic
event between its legs, scored through a SEPARATE bucket-scoped rule registry, additively tagged
on the snapshot — the primary universe and its calibrated weights are provably untouched.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-09T17:24:00Z (approx.)
- **Completed:** 2026-07-09T17:39:25Z
- **Tasks:** 2/2 completed
- **Files modified:** 11 (1 created, 10 modified)

## Accomplishments

- `selectEventCandidates` (packages/core/src/picker/domain/candidate-selection.ts): a thin
  wrapper over `selectCandidates` with the back-leg gap window parameterized to `[3, 10]` days
  (`SelectCandidatesParams.backDteMinGap`/`backDteMaxGap`, both optional, defaulting to the
  existing `BACK_DTE_MIN_GAP`/`BACK_DTE_MAX_GAP` constants) — reproduces the primary universe
  byte-identically for every existing caller — post-filtered to `backEvents.length > 0`.
- `EVENT_RULE_SET_METADATA` (packages/core/src/picker/domain/rules.ts): a SEPARATE registry
  promoting `backEventBonus` from experimental (weight 0) to an active scored row at weight 10;
  the other 9 primary criteria are scaled by 0.9 within this table only. Own sum-100 invariant
  and refuted-criteria guard (`event-rules.test.ts`). The primary `RULE_SET_METADATA` rows,
  weights, and its own `rules.test.ts` weight-sum-100 test are byte-for-byte unchanged.
- `scoreEventCandidates` (packages/core/src/picker/domain/scoring.ts): scores the bucket by
  calling `scoreCalendarCandidates` with `EVENT_SCORE_WEIGHTS` via the existing PICK-04 ablation
  seam, then adds the `backEventBonus` bonus on top (post-scoring override, same shape as
  `zeroEventAdjustment`/`applyGatePenalty` in `computePickerSnapshot.ts`) — never a second scoring
  engine.
- `computePickerSnapshot.ts` computes the event bucket alongside the primary universe every
  cycle, tags candidates `"standard"` or `"event-calendar"`, ranks + caps each universe
  independently at `PICKER_TOP_N`, then concatenates. Both universes route through the SAME
  gate/events-degradation/gate-penalty machinery from Plan 03 — a blocked/blind/braked cohort
  suppresses event candidates too (T-28-15).
- Additive `bucket` field on `PickerCandidateDomain` (ports.ts) and `pickerCandidate`
  (contracts/picker.ts, `.default("standard")`) so pre-Plan-05 stored snapshot rows still parse.

## Task Commits

1. **Task 1: selectEventCandidates wrapper + EVENT_RULE_SET_METADATA** - `a9f2809` (feat)
2. **Task 2: Wire the event bucket into the snapshot with a bucket tag** - `87c9523` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `packages/core/src/picker/domain/candidate-selection.ts` - optional gap-window params + `selectEventCandidates`
- `packages/core/src/picker/domain/candidate-selection.test.ts` - `selectEventCandidates` coverage
- `packages/core/src/picker/domain/rules.ts` - `WEIGHT_BACK_EVENT_BONUS`, `EVENT_SCORE_WEIGHTS`, `EVENT_RULE_SET_METADATA`
- `packages/core/src/picker/domain/event-rules.test.ts` (new) - bucket registry invariants
- `packages/core/src/picker/domain/scoring.ts` - `scoreEventCandidates`
- `packages/core/src/picker/domain/scoring.test.ts` - `scoreEventCandidates` coverage
- `packages/core/src/picker/application/computePickerSnapshot.ts` - event-bucket wiring, gate suppression, bucket tagging
- `packages/core/src/picker/application/computePickerSnapshot.test.ts` - event-bucket wiring + gate-suppression coverage
- `packages/core/src/picker/application/ports.ts` - additive `bucket` field on `PickerCandidateDomain`
- `packages/contracts/src/picker.ts` - additive `bucket` enum with `.default("standard")`
- `packages/contracts/src/picker.test.ts` - `bucket` default/round-trip/enum coverage
- `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` - `bucket: "standard"` added to all 9 fixture candidates (required by the parsed-output type)

## Decisions Made

- **backEventBonus bucket weight = 10** (top of 28-RESEARCH.md's proposed 8-10 range, UAT-pending
  per CONTEXT.md — user confirms at UAT). The other 9 primary score weights are scaled by exactly
  `(100 - 10) / 100 = 0.9` so the bucket registry sums to 100 — matches 28-RESEARCH.md's explicit
  "rebalanced down proportionally" instruction verbatim.
- **Reused the ablation seam, not a second scoring function body.** `scoreEventCandidates` calls
  `scoreCalendarCandidates(..., { weights: EVENT_SCORE_WEIGHTS })` and adds the bonus after —
  every formula (fwdEdge, slope, gexFit, etc.) stays the single source of truth in `scoreOne`.
- **Event-bucket candidates live in the SAME `candidates` array**, distinguished by `bucket`,
  rather than a new top-level `PickerSnapshot.eventCandidates` field — smaller contract surface,
  matches 28-RESEARCH.md's "additive to `PickerCandidateDomain`" framing, and lets the Analyzer
  filter client-side by `bucket` for the distinct section the plan calls for.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `scoring.test.ts` coverage for `scoreEventCandidates`**
- **Found during:** Task 1
- **Issue:** The plan's Task 1 `<files>` list included `scoring.ts` but not `scoring.test.ts`, and Task 1's `<verify>` command didn't exercise the new scoring function directly. `.claude/rules/tdd.md` requires a failing test before any production code — `scoreEventCandidates` is non-trivial (it's the whole bucket's score computation), so it needed its own RED→GREEN cycle rather than only indirect coverage via Task 2's `computePickerSnapshot.test.ts`.
- **Fix:** Added a `scoreEventCandidates` describe block to the existing `scoring.test.ts` (3 tests: bonus additivity, 100-cap, primary-registry non-interference), written first and confirmed RED (`scoreEventCandidates is not a function`) before implementing.
- **Files modified:** `packages/core/src/picker/domain/scoring.test.ts`
- **Verification:** `bun run vitest run packages/core/src/picker/domain/scoring.test.ts` — green (all 3 new tests + all pre-existing tests)
- **Committed in:** `a9f2809` (part of Task 1 commit)

**2. [Rule 2 - Missing critical functionality] Added `picker.test.ts` + fixture updates for the additive `bucket` field**
- **Found during:** Task 2
- **Issue:** The plan's Task 2 `<files>` list included `contracts/picker.ts` but not `contracts/picker.test.ts` or the frozen fixture, yet adding a new Zod field with `.default()` is exactly the kind of change `tdd.md`'s numerical/behavioral-code rule and the "REJECTS"/round-trip test convention already established elsewhere in `picker.test.ts` cover. Additionally, `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` is explicitly typed as `PickerSnapshotResponse` (the parsed OUTPUT type, where `.default()` fields are non-optional) — `bun run typecheck` failed with "Property 'bucket' is missing" on all 9 fixture candidates until fixed.
- **Fix:** Added 3 tests to `picker.test.ts` (default-to-"standard", explicit round-trip, out-of-enum rejection); added `bucket: "standard"` to all 9 candidate literals in the fixture file.
- **Files modified:** `packages/contracts/src/picker.test.ts`, `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts`
- **Verification:** `bun run vitest run packages/contracts/src/picker.test.ts` — green; `bun run typecheck` — clean
- **Committed in:** `87c9523` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — TDD/typecheck completeness, no scope creep beyond what the plan's own acceptance criteria required).
**Impact on plan:** Both deviations are test/typecheck-completeness additions required to satisfy this repo's hard TDD (`.claude/rules/tdd.md`) and TypeScript-strictness (`.claude/rules/typescript.md`) rules, which take precedence over the plan's file list per CLAUDE.md enforcement. No production behavior changed beyond what Tasks 1-2 already specified.

## Issues Encountered

None beyond the two deviations above.

## TDD Gate Compliance

This plan's frontmatter is `type: tdd`. Both tasks followed the RED→GREEN loop in full (tests
written first, run, confirmed failing for the right reason — missing exports/functions — then
minimum implementation added and re-verified green) — see the RED test-run transcripts in this
session for `candidate-selection.test.ts`/`event-rules.test.ts`/`scoring.test.ts` (Task 1) and
`computePickerSnapshot.test.ts`/`picker.test.ts` (Task 2), both showing `TypeError: ... is not a
function`/`undefined` failures before implementation.

**Warning:** Per-task commits (`a9f2809`, `87c9523`) each combine the RED test additions and the
GREEN implementation into a single `feat(28-05): ...` commit, rather than separate `test(28-05):
...` (RED) and `feat(28-05): ...` (GREEN) commits. `git log` for this plan therefore does NOT
contain a standalone `test(...)` commit preceding a `feat(...)` commit — the plan-level TDD gate
sequence check (a `test(...)` commit found before a `feat(...)` commit) will not find one. The
actual RED→GREEN discipline was followed and verified (see transcripts above); only the commit
granularity deviates from the two-commit gate pattern, matching this plan's own execution
objective ("Commit at green per cycle" — one commit per task, at green).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PLAY-04 is complete: the event-calendar bucket ships on every `computePickerSnapshot` cycle,
  additively tagged, gate-suppressed identically to the primary universe.
- The Analyzer UI does not yet render a distinct "event-calendar bucket" section — the `bucket`
  field is on the wire (`pickerCandidate.bucket`), but no frontend consumer was in this plan's
  scope (not listed in `files_modified`). A future UI plan should filter
  `PickerCandidate[]` by `bucket === "event-calendar"` to render the distinct section
  28-RESEARCH.md calls for.
- `backEventBonus`'s bucket weight (10) is UAT-pending per 28-CONTEXT.md/28-RESEARCH.md A5 — the
  user should confirm it at the phase's UAT gate alongside the sizing tiers and gate hysteresis
  bands from Plans 03-04.
- No blockers for the remaining phase 28 plans (PLAY-05 `autoTuneTargetDelta`, if not already
  shipped in Plan 04, and phase-level verification).

---
*Phase: 28-playbook-gates-anti-criteria-sizing*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 12 code files + this SUMMARY.md confirmed present on disk; both task commits (`a9f2809`,
`87c9523`) confirmed present in `git log`. No missing items.
