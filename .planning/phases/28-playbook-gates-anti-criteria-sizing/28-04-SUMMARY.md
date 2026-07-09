---
phase: 28-playbook-gates-anti-criteria-sizing
plan: 04
subsystem: picker
tags: [vix, sizing, entry-gate, delta-band, autotune, fast-check, tdd]

requires:
  - phase: 28-playbook-gates-anti-criteria-sizing
    provides: "Plan 01's VIX_LADDER (entry-gate.ts) + Plan 03's PickerSnapshot.gate (gate.vix, the shared cohort VIX)"
provides:
  - "resolveSizingTier / SIZING_TIERS — the VIX-tiered discrete contract-count registry (picker/domain/sizing.ts), reusing VIX_LADDER"
  - "PickerSnapshot.sizing / pickerSnapshotResponse.sizing — additive {tier, contracts, vix} snapshot field, resolved from the SAME cohort VIX the gate reads"
  - "autoTuneTargetDelta / SelectCandidatesParams.effectiveDeltaMin — the shipped (not deferred) VIX-tuned deep band-edge tilt, universe-membership only, never a scoring criterion"
affects: [28-05, 28-06]

tech-stack:
  added: []
  patterns:
    - "Sizing/autotune both resolve from gate.vix (Plan 03's already-read cohort VIX) — one shared macro read, no second lookup"
    - "autoTuneTargetDelta is a universe-membership preference (optional selectCandidates param, clamped inside the function itself), not a scoring tilt — sidesteps the research-flagged risk of fighting slope/fwdEdge entirely, since it never touches RULE_SET_METADATA or the score breakdown"

key-files:
  created:
    - packages/core/src/picker/domain/sizing.ts
    - packages/core/src/picker/domain/sizing.test.ts
  modified:
    - packages/contracts/src/picker.ts
    - packages/contracts/src/picker.test.ts
    - packages/contracts/src/__fixtures__/picker-candidates.fixture.ts
    - packages/core/src/picker/application/ports.ts
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/application/computePickerSnapshot.test.ts
    - packages/core/src/picker/application/getPicker.test.ts
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/candidate-selection.test.ts
    - apps/web/src/hooks/usePicker.test.ts
    - docs/architecture/playbook-gates.md

key-decisions:
  - "autoTuneTargetDelta ships as a UNIVERSE-MEMBERSHIP tilt (an optional effectiveDeltaMin param on selectCandidates), not a scoring-layer tilt. The research's own risk flag was 'a superimposed VIX-delta tilt risks fighting slope/fwdEdge' — that risk only exists if the tilt lives INSIDE the score. Nudging the band's deep edge at the universe-selection stage (before scoring ever runs) structurally cannot fight slope/fwdEdge: it only changes WHICH strikes are scored, never HOW they're scored. This sidesteps the deferral question the research raised, rather than needing to invoke the time-box."
  - "The tuning range (VIX 15-25) reuses VIX_LADDER's own normal-floor and crisis-floor edges, not a new constant pair. Past VIX 25 the gate hard-blocks entries anyway (candidates: [] regardless of the universe), so tilting further would be inert — the SAME 'one shared ladder, never a second band system' discipline PLAY-01/03 established."
  - "sizing and autoTuneTargetDelta both read gate.vix (Plan 03's already-resolved cohort VIX) rather than re-reading macro_observations — one shared read per cycle, consistent null-propagation for free (GATE BLIND / gate-read-error / cold-start all resolve vix: null, which both resolveSizingTier and autoTuneTargetDelta already treat as 'no recommendation' / 'no tilt')."
  - "Crisis-tier sizing (0 contracts) and the VIX>=25 hard block are DELIBERATELY redundant, not deduplicated — sizing still resolves the tier/count even when candidates: [] from the block, so the Analyzer can show 'Crisis: 0 contracts' as an explicit label rather than a blank field."

patterns-established:
  - "A VIX-tuned universe-membership preference (effectiveDeltaMin) is architecturally distinct from a VIX-tuned score preference — the former can never violate the 9-criteria sum-100 invariant or interact with existing score terms, making it the lower-risk default whenever a future 'nudge X toward Y as VIX rises' feature is proposed."

requirements-completed: [PLAY-03, PLAY-05]

coverage:
  - id: D1
    description: "resolveSizingTier(vix) resolves a discrete, named-constant contract count per VIX_LADDER tier — correct at each tier and at the 15/20/25 half-open boundaries; null/NaN vix resolves no recommendation, never a guessed tier"
    requirement: "PLAY-03"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/sizing.test.ts#resolveSizingTier"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/sizing.test.ts#resolveSizingTier — property: every finite, non-negative vix resolves exactly one SIZING_TIERS row's own contract count"
        status: pass
    human_judgment: false
  - id: D2
    description: "SIZING_TIERS reuses VIX_LADDER's edges exactly — one shared ladder, never a second band system"
    requirement: "PLAY-03"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/sizing.test.ts#SIZING_TIERS — reuses VIX_LADDER's edges exactly"
        status: pass
    human_judgment: false
  - id: D3
    description: "The additive PickerSnapshot.sizing / pickerSnapshotResponse.sizing field round-trips {tier, contracts, vix}; old rows parse via .default()"
    requirement: "PLAY-03"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts (existing suite, re-verified green post-change)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#makeComputePickerSnapshotUseCase — sizing (28-04, PLAY-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "computePickerSnapshot resolves the sizing tier from the SAME cohort VIX the gate reads (gate.vix) and attaches it to the snapshot — calm VIX 15 -> normal/2, penalty VIX 22 -> elevated/1, crisis VIX 26 (gate blocked) -> crisis/0, GATE BLIND -> no recommendation"
    requirement: "PLAY-03"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#makeComputePickerSnapshotUseCase — sizing (28-04, PLAY-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "autoTuneTargetDelta linearly nudges the band's deep (min) delta edge toward DELTA_BAND_MAX as VIX rises through VIX_LADDER's 15-25 range; ALWAYS stays inside [DELTA_BAND_MIN, DELTA_BAND_MAX] (fast-check proven); null/NaN vix is a no-op"
    requirement: "PLAY-05"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#autoTuneTargetDelta"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#autoTuneTargetDelta — property: for any finite vix, the result never leaves [DELTA_BAND_MIN, DELTA_BAND_MAX]"
        status: pass
    human_judgment: false
  - id: D6
    description: "selectCandidates' effectiveDeltaMin param is additive (omitting it reproduces the DELTA_BAND_MIN universe byte-identically) and clamped inside the function itself, so an out-of-band value never escapes [DELTA_BAND_MIN, DELTA_BAND_MAX]; it never becomes a new weighted criterion (RULE_SET_METADATA untouched)"
    requirement: "PLAY-05"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectCandidates — effectiveDeltaMin (28-04, PLAY-05 wiring)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#makeComputePickerSnapshotUseCase — autoTuneTargetDelta wiring (28-04, PLAY-05)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The proposed default contract counts (2/2/1/0) and tier edges (15/20/25, inherited from VIX_LADDER) are UAT-pending — [ASSUMED] flagged in sizing.ts and playbook-gates.md for user confirmation, never silently locked"
    verification: []
    human_judgment: true
    rationale: "28-CONTEXT.md explicitly requires the user to confirm the sizing counts/edges at UAT — this is a product-taste decision, not something a passing test can validate."

duration: ~50min
completed: 2026-07-09
status: complete
---

# Phase 28 Plan 04: VIX-Tiered Sizing + autoTuneTargetDelta Summary

**sizing.ts VIX-tiered discrete contract-count registry (2/2/1/0, reusing VIX_LADDER) wired onto the snapshot, plus a shipped (not deferred) autoTuneTargetDelta universe-membership tilt on selectCandidates' band-scan deep edge.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 (both TDD)
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments

- `packages/core/src/picker/domain/sizing.ts` — `SIZING_TIERS` (a typed registry importing
  `VIX_LADDER` from `entry-gate.ts`, so the tier edges are the ONE shared ladder) and
  `resolveSizingTier(vix)`, a half-open `[min, max)` lookup that returns `null` (never a
  guessed tier) for a null/NaN vix. Proposed default counts (Low 2, Normal 2, Elevated 1,
  Crisis 0) are commented `[ASSUMED]`, UAT-pending per 28-CONTEXT.md.
- The additive `{tier, contracts, vix}` sizing field ships on `PickerSnapshot` /
  `pickerSnapshotResponse` with a `.default()` fallback so pre-Plan-04 stored rows still parse.
- `computePickerSnapshot.ts` resolves the sizing tier from the SAME cohort VIX the gate already
  reads (`gate.vix`) — no second macro lookup — so the null-propagation (GATE BLIND / gate-
  read-error / cold-start all resolve `vix: null`) is automatic and consistent between the gate
  and the sizing recommendation.
- `autoTuneTargetDelta` (PLAY-05, the milestone's most-optional requirement) shipped rather than
  deferred: a pure linear nudge of the band-scan's deep (min) delta edge toward the far-OTM edge
  as VIX rises through `VIX_LADDER`'s 15→25 range — the SAME ladder the gate/sizing use.
  Wired via a new optional `effectiveDeltaMin` param on `selectCandidates`, clamped into
  `[DELTA_BAND_MIN, DELTA_BAND_MAX]` inside the function itself. Because the tilt operates at
  universe SELECTION (before scoring ever runs), it structurally cannot fight `slope`/`fwdEdge`
  the way a superimposed score-layer tilt could — sidestepping the exact risk 28-RESEARCH.md
  flagged as the reason to consider deferring.
- 15 new sizing tests + 6 new `autoTuneTargetDelta`/`effectiveDeltaMin` tests +  5 new
  computePickerSnapshot wiring tests, all green; full suite (2728 tests), typecheck, and lint
  all clean.

## Task Commits

1. **Task 1: sizing.ts — VIX-tiered discrete contract-count registry + additive snapshot
   field (TDD)** - RED confirmed (`sizing.ts` temporarily removed, module-not-found failure)
   before implementation, then GREEN - `9510194` (feat)
2. **Task 2: Wire sizing into the snapshot + minimal autoTuneTargetDelta tilt (TDD)** - RED
   confirmed for both `candidate-selection.ts`'s new exports and the wiring tests (both
   reverted to HEAD, failures confirmed for the right reason) before implementation, then
   GREEN - `42e6f22` (feat)
3. **Docs: document the shipped autoTuneTargetDelta design** - `c54bd3c` (docs)

## Files Created/Modified

- `packages/core/src/picker/domain/sizing.ts` - `SIZING_TIERS`, `resolveSizingTier`
- `packages/core/src/picker/domain/sizing.test.ts` - 15 tests (boundaries, null-honesty, fast-check)
- `packages/contracts/src/picker.ts` - `pickerSizing` schema, additive `sizing` field on `pickerSnapshotResponse`
- `packages/core/src/picker/application/ports.ts` - `PickerSizing` domain type, `PickerSnapshot.sizing` field
- `packages/core/src/picker/application/computePickerSnapshot.ts` - `toPickerSizing` helper, `effectiveDeltaMin` wiring into `selectCandidates`
- `packages/core/src/picker/application/computePickerSnapshot.test.ts` - sizing + autotune wiring tests; one pre-existing gate-penalty test updated (id-lookup, not positional/count equality)
- `packages/core/src/picker/domain/candidate-selection.ts` - `autoTuneTargetDelta`, `SelectCandidatesParams.effectiveDeltaMin`
- `packages/core/src/picker/domain/candidate-selection.test.ts` - `autoTuneTargetDelta` + `effectiveDeltaMin` wiring tests (concrete narrowing + fast-check band-clamp)
- `packages/core/src/picker/application/getPicker.test.ts`, `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts`, `apps/web/src/hooks/usePicker.test.ts` - fixtures gained the `sizing` default (Rule 3, mechanical consequence of the additive field)
- `docs/architecture/playbook-gates.md` - new "autoTuneTargetDelta (Plan 04, PLAY-05 — shipped, not deferred)" section + `sizing.ts`/`candidate-selection.ts` references

## Decisions Made

- **autoTuneTargetDelta ships as a universe-membership tilt, not a scoring-layer tilt.** See
  `key-decisions` in the frontmatter — this was the single most consequential design choice in
  this plan: it turns "should we defer this?" into "this can't fight slope/fwdEdge by
  construction," which is why the plan shipped it rather than invoking the time-box.
- **The tuning range (15-25) reuses `VIX_LADDER`'s own floors** rather than introducing a new
  constant pair — one ladder, three consumers (gate, sizing, autotune).
- **`sizing` and `autoTuneTargetDelta` both read `gate.vix`**, not a second macro-observations
  read — Plan 03 already resolved the cohort VIX once per cycle; reusing it keeps the
  T-28-10-style "computed once, never per-candidate" discipline and gives free, consistent
  null-propagation across all three consumers.
- **Crisis-tier sizing (0 contracts) is intentionally shipped even though `candidates: []`
  already suppresses entries there** — the Analyzer can render an explicit "Crisis: 0" label
  instead of a blank sizing field when the gate is blocked.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fixed 4 downstream fixtures broken by the additive
`PickerSnapshot.sizing` field**
- **Found during:** Task 1's typecheck verification pass
- **Issue:** `picker-candidates.fixture.ts`, `getPicker.test.ts`, `computePickerSnapshot.test.ts`
  (the `previousSnapshotWithGate` helper), and `usePicker.test.ts` all construct
  `PickerSnapshot`/`PickerSnapshotResponse` object literals — a mechanical consequence of the
  new required field, mirroring 28-03's own precedent for the `gate` field.
- **Fix:** Added `sizing: { tier: null, contracts: null, vix: null }` to each literal.
- **Files modified:** the four files listed above.
- **Verification:** `bun run typecheck` clean; each file's own test suite green.
- **Committed in:** `9510194` (Task 1)

**2. [Rule 3 - Blocking issue] Updated one pre-existing gate-penalty test's assumption
broken by the new additive PLAY-05 tilt**
- **Found during:** Task 2's full-suite verification pass
- **Issue:** `computePickerSnapshot.test.ts`'s "penalty band -> every candidate's score is
  scaled down" test used `PENALTY_MACRO_ROWS` (VIX 22) and asserted the penalty run's
  candidate list was the SAME LENGTH as the calm run's, reshuffled only by score. Wiring
  `autoTuneTargetDelta` into `selectCandidates` means VIX 22 now ALSO narrows the universe
  (a separate, correct, additive effect) — the assumption of equal-length lists no longer
  holds now that both PLAY-01 (penalty) and PLAY-05 (autotune) are wired together.
- **Fix:** Rewrote the test to look up matching candidates by `id` (never positional index),
  asserting every candidate surviving the narrower penalty-run universe is a SUBSET of the
  calm run's candidates with an equal-or-lower score and an untouched breakdown — isolating
  the score-penalty axis from the universe-narrowing tilt, which is what the test was always
  meant to verify.
- **Files modified:** `packages/core/src/picker/application/computePickerSnapshot.test.ts`
- **Verification:** full suite (2728 tests) green.
- **Committed in:** `42e6f22` (Task 2)

---

**Total deviations:** 2 (both Rule 3, mechanical consequences of two additive contract/behavior
changes landing together). No scope creep — `entry-gate.ts` and `brakes.ts` (Plans 01/02) were
left untouched.

## TDD Gate Compliance

Both tasks are `type="tdd"`. RED was confirmed for every new export by temporarily reverting
the implementation file to its pre-task `HEAD` state and running the target test file, watching
it fail for the right reason (module-not-found / `TypeError: ... is not a function`), then
restoring the implementation and re-running to GREEN — for `sizing.ts` (Task 1) and for
`candidate-selection.ts`'s `autoTuneTargetDelta`/`effectiveDeltaMin` plus the
`computePickerSnapshot.ts` wiring (Task 2). No production code was written before its test
existed and failed for the right reason; the suite was never committed red.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Both PLAY-03 (sizing) and PLAY-05 (autotune) are fully wired, live, tested behavior on
every computed snapshot — not a pending wiring step for a future plan.

## Threat Flags

None beyond what the plan's own threat_model already covers (T-28-11/T-28-12 — both mitigated:
counts come from the visible `sizing.ts` source file with null/NaN-honest resolution, and the
autotune tilt is fast-check-proven to never escape `[DELTA_BAND_MIN, DELTA_BAND_MAX]`, is
additive-only, and is never a new weighted criterion).

## Next Phase Readiness

- `PickerSnapshot.sizing` (tier/contracts/vix) is ready for Plan 06's Analyzer rendering.
- The proposed default contract counts (2/2/1/0) and VIX tier edges (15/20/25, inherited from
  `VIX_LADDER`) are `[ASSUMED]` — flagged for user confirmation at UAT per 28-CONTEXT.md.
- No blockers.

---
*Phase: 28-playbook-gates-anti-criteria-sizing*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created files confirmed on disk (`packages/core/src/picker/domain/sizing.ts`,
`sizing.test.ts`, this SUMMARY.md); all 3 commit hashes (`9510194`, `42e6f22`, `c54bd3c`)
confirmed in `git log`.
