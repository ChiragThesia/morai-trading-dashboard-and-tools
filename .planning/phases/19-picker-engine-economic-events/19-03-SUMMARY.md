---
phase: 19-picker-engine-economic-events
plan: 03
subsystem: api
tags: [bsm, fast-check, vitest, options-pricing, calendar-spread, scoring-engine]

# Dependency graph
requires:
  - phase: 19-01
    provides: packages/core/src/picker/application/ports.ts (ChainQuoteForPicker/EconomicEvent/GexContextForPicker shapes)
  - phase: 19-02
    provides: computeFwdIv (fwd-iv.ts) + findBreakevens (breakevens.ts) — the two math kernels scoring.ts composes
provides:
  - "types.ts — RawCandidate/ScoredCandidate/BreakdownEntry/ExitPlan/EventPenaltyWeights domain shapes"
  - "candidate-selection.ts — selectCandidates (delta-targeted OTM-put universe, DTE grid, net-theta>0 filter, event-span flags), nearestStrikeByDelta, legSpansEvents, DELTA_RUNGS/FRONT_DTE_*/BACK_DTE_* named constants"
  - "scoring.ts — scoreCalendarCandidates (named 40/25/15/10/10 weighted score, closed-enum breakdown, real beVsEm via findBreakevens), WEIGHT_*/EVENT_PENALTY/exit-plan-default named constants"
affects: [19-04, 19-05, 19-06, 19-07, 19-08, 19-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dedupe-by-construction: a (deltaRung, frontExpiry) pair resolves to exactly one candidate by always choosing the NEAREST qualifying back expiry, rather than emitting one candidate per valid back expiry and deduping post-hoc by score (which selection can't do -- it has no score)"
    - "ISO calendar-day arithmetic via Date.UTC on regex-parsed components, never a Date-instant constructor call, for both DTE calculation and event-span (today, legExpiry] membership (Pitfall 3)"
    - "Never-silent guard zeroing (extends the fwdIv-guard precedent): inverted term structure zeroes the fwdEdge CONTRIBUTION outright (not just fwdEdge=0 run through the normal window), missing/null GEX context zeroes gexFit's tiers, fewer-than-2 breakevens zeroes beVsEm -- every guard path is a documented fallback, never NaN, never a fabricated clean value"

key-files:
  created:
    - packages/core/src/picker/domain/types.ts
    - packages/core/src/picker/domain/candidate-selection.ts
    - packages/core/src/picker/domain/candidate-selection.test.ts
    - packages/core/src/picker/domain/scoring.ts
    - packages/core/src/picker/domain/scoring.test.ts
  modified: []

key-decisions:
  - "Dedupe (Pitfall 5) implemented as dedupe-by-construction inside selectCandidates, not a post-hoc pass: since a resolved strike is a pure function of (deltaRung, frontExpiry) via nearestStrikeByDelta, the loop picks the NEAREST qualifying back expiry (smallest back DTE satisfying the [21,80]/gap-21 window) for each (rung, front) pair instead of emitting every valid back-expiry combination. The mockup's own dedupe ran AFTER scoring (kept the best-scoring back-expiry per K+front); this architecture splits selection from scoring, so a score-based tiebreak isn't available at this stage -- nearest-back-expiry is the deterministic, scoreless substitute."
  - "Calendars are single-strike (front strike === back strike), matching the mockup's own definition and standard calendar-spread practice: nearestStrikeByDelta resolves ONE strike from the FRONT leg's delta at its own DTE, then the back leg is priced at that same strike (found in the back expiry's own chain, or the pairing is skipped if absent)."
  - "No `new Date(...)` construction anywhere in candidate-selection.ts (grep-verified, including comments) -- calendar-day arithmetic uses Date.UTC on regex-parsed ISO components (isoDayNumber), and the cohort's asOf date is derived by calling .toISOString().slice(0,10) on the port's own pre-existing Date instance (a method call on existing data, not a construction)."
  - "An inverted candidate's fwdEdge criterion contributes 0 to the score OUTRIGHT (not merely fwdEdge=0 normalized through the (fwdEdge+0.02)/0.04 window, which would have yielded a misleading 50% credit) -- inverted term structure is a warning sign, never rewarded."
  - "beVsEm's real ratio (D-09) documented-tunable normalizer BE_VS_EM_TARGET_RATIO=1.5 is an authored default (not derived from the mockup, which faked this term entirely) -- flagged, per RESEARCH.md, as the uncalibrated piece; the METRIC itself (breakeven-width/expectedMove via findBreakevens) is honest and real."
  - "NOT marking PICK-01/PICK-03 complete despite both appearing in this plan's requirements frontmatter -- this plan ships the scoring ENGINE (selectCandidates + scoreCalendarCandidates), matching 19-01/19-02/18-01's precedent of deferring requirement completion to the plan that ships the composed, live-wired, user-facing deliverable. PICK-01's remaining scope (compute-picker use-case, HTTP route, MCP tool, persisted snapshot) and PICK-03's entire scope (the economic-events external adapter/DB table -- this plan only consumes an already-shaped EconomicEvent[] parameter) land in 19-04..19-09."

patterns-established:
  - "scoring.ts composes fwd-iv.ts and breakevens.ts (19-02's kernels) rather than re-deriving forward-IV or breakeven math -- the intended composition point RESEARCH.md anticipated."

requirements-completed: []  # PICK-01/PICK-03 appear in this plan's frontmatter but are NOT
  # marked complete here -- see key-decisions above. The live-wired engine (compute-picker
  # use-case, HTTP route, MCP tool) and the economic-events adapter/table land in 19-04..19-09.

coverage:
  - id: D1
    description: "selectCandidates converts ×1000 chain strikes to points once at the boundary, resolves delta-targeted strikes per rung via nearestStrikeByDelta, pairs front/back expiries over the DTE grid (front [21,36], back gap>=21 and <=80), drops net-theta<=0 calendars (criterion 6), and dedupes to one candidate per (deltaRung, frontExpiry) by construction"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectCandidates > only pairs front legs in [21,36] DTE with back legs where (backDTE-frontDTE)>=21 and backDTE<=80"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectCandidates > drops any calendar with net theta <= 0 (criterion 6)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#selectCandidates > dedupes to one candidate per (deltaRung, frontExpiry), never keyed on resolved strike"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#nearestStrikeByDelta > picks the strike whose bsmGreeks put delta is closest to each target rung"
        status: pass
    human_judgment: false
  - id: D2
    description: "legSpansEvents is a pure ISO YYYY-MM-DD string-interval membership test for (today, legExpiry] (D-10), never Date-object arithmetic across a timezone (Pitfall 3)"
    requirement: "PICK-03"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#legSpansEvents > returns exactly the events whose date is in (today, legExpiry]"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/candidate-selection.test.ts#legSpansEvents > property: every returned name's event date is strictly after today and <= expiry"
        status: pass
    human_judgment: false
  - id: D3
    description: "scoreCalendarCandidates emits the named 40/25/15/10/10 weighted score with a closed-enum breakdown, zeroes the fwdEdge contribution outright for an inverted term structure (never NaN), and computes the REAL beVsEm ratio via findBreakevens instead of the mockup's fixed-strike proxy"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#scoreCalendarCandidates > emits exactly the 5 closed-enum criteria with the named weights, score = rounded weighted sum"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#scoreCalendarCandidates > the breakdown criterion set is always a subset of the closed enum (REFUTED criteria structurally excluded)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#scoreCalendarCandidates > an inverted candidate gets fwdEdge contribution 0 and a finite score (never NaN)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#scoreCalendarCandidates > beVsEm rawValue equals the REAL breakeven-width/expectedMove ratio via findBreakevens (D-09)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/scoring.test.ts#scoreCalendarCandidates > property: for arbitrary in-range candidates, score and every contribution stay finite and within [0,100]"
        status: pass
    human_judgment: false

# Metrics
duration: ~16min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 03: Picker Scoring Engine (Candidate Selection + Scoring) Summary

**Two pure domain modules — `selectCandidates` (delta-targeted OTM-put calendar universe over the live chain, DTE-grid pairing, net-θ>0 filter, event-span flags) and `scoreCalendarCandidates` (the named 40/25/15/10/10 weighted score with a closed-enum breakdown and the REAL breakeven-width/expected-move ratio replacing the mockup's faked term) — the picker engine's actual scoring brain, fast-check covered, zero new dependencies.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-07-04T21:45:31Z (approx, following 19-02)
- **Completed:** 2026-07-04T22:01:40Z
- **Tasks:** 2
- **Files modified:** 5 (all created)

## Accomplishments

- `types.ts` declares `RawCandidate`/`ScoredCandidate`/`BreakdownEntry`/`ExitPlan`/`EventPenaltyWeights` — the shapes candidate-selection produces and scoring consumes/extends, mirroring `PickerCandidateDomain` (application/ports.ts).
- `candidate-selection.ts`'s `selectCandidates` converts the chain's ×1000 strikes to points ONCE at the boundary (Pitfall 1), resolves the cohort spot/asOf from the quote cohort, and for each front expiry in [21,36] DTE and each delta rung (ATM/-0.30/-0.20/-0.10) finds the nearest-delta strike via `nearestStrikeByDelta` (real `@morai/quant` `bsmGreeks`, no second BSM), pairs it with the nearest qualifying back expiry at the SAME strike (gap>=21, backDTE<=80), prices both legs, drops any net-θ<=0 pair (criterion 6), and flags each leg's spanned economic events via `legSpansEvents` — a pure ISO string-interval `(today, legExpiry]` test with zero `Date`-instant construction anywhere in the file (Pitfall 3).
- `scoring.ts`'s `scoreCalendarCandidates` ports the mockup's score formula as named tunable constants (`WEIGHT_SLOPE=40`, `WEIGHT_FWD_EDGE=25`, `WEIGHT_GEX_FIT=15`, `WEIGHT_EVENT=10`, `WEIGHT_BE_VS_EM=10`), composes 19-02's `computeFwdIv` (fwdEdge, criterion 1) and `findBreakevens` (the D-09 real beVsEm ratio, replacing the mockup's `K===7500?1:0.7` proxy), applies the D-11 front-leg-only event penalty, and emits a closed-enum `breakdown[]` whose criterion labels can never include a REFUTED metric.
- Both modules are hexagon-pure (imports limited to `@morai/quant`, `@morai/shared`, this bounded context's own `application/ports.ts`, and their own domain siblings) and carry fast-check property tests proving their invariants (never NaN, always in [0,100]).

## Task Commits

Each task was committed atomically at TDD green:

1. **Task 1: candidate-selection — delta-targeted universe, DTE grid, theta filter, event spans** - `88daa32` (feat)
2. **Task 2: scoreCalendarCandidates — named-weight score + closed-enum breakdown + real beVsEm** - `cc3bb4d` (feat)

_Note: both tasks were RED->GREEN in-session (RED confirmed via module-not-found failures before implementation existed) but committed once at green per tdd.md's commit-at-green-only rule and the 17.1-01/18-03/19-02 precedent of a single commit per TDD task._

## Files Created/Modified

- `packages/core/src/picker/domain/types.ts` - `RawCandidate`/`ScoredCandidate`/`BreakdownEntry`/`ExitPlan`/`EventPenaltyWeights` domain shapes
- `packages/core/src/picker/domain/candidate-selection.ts` - `selectCandidates`, `nearestStrikeByDelta`, `legSpansEvents`, DTE-grid + delta-rung named constants
- `packages/core/src/picker/domain/candidate-selection.test.ts` - example tests (delta-nearest, DTE window, net-θ filter, dedupe) + fast-check property (legSpansEvents)
- `packages/core/src/picker/domain/scoring.ts` - `scoreCalendarCandidates`, `WEIGHT_*`/`EVENT_PENALTY`/exit-plan-default named constants
- `packages/core/src/picker/domain/scoring.test.ts` - example tests (weights/breakdown, inverted guard, real beVsEm, exit-plan defaults) + fast-check property (score/contribution bounds)

## Decisions Made

- **Dedupe-by-construction, not post-hoc:** since a resolved strike is a pure function of `(deltaRung, frontExpiry)`, `selectCandidates` picks the nearest qualifying back expiry for each `(rung, front)` pair instead of emitting every valid back-expiry combination and deduping later by score (which this module can't do — it has no score). Documented in the file's own header comment referencing Pitfall 5.
- **Single-strike calendars:** the front leg's delta-targeted strike is reused for the back leg (found in the back expiry's own chain; the pairing is skipped if absent) — matches the mockup's and standard practice's calendar-spread definition (same strike, two expiries).
- **Inverted fwdEdge contributes 0 outright:** an inverted term structure zeroes the fwdEdge score contribution directly, rather than running `fwdEdge=0` through the normal `(fwdEdge+0.02)/0.04` normalization window (which would have produced a misleading ~50% credit). Matches the plan's explicit must_haves truth.
- **No Date-instant construction, including in comments:** early drafts of candidate-selection.ts's doc comments contained the literal substring `new Date(` while describing what to avoid, which would have failed the acceptance criteria's own grep check. Reworded to describe the constraint without the literal pattern (same class of self-referential-grep issue documented in 19-01's SUMMARY).
- **PICK-01/PICK-03 not marked complete** — this plan ships the scoring engine only; the live-wired compute-picker use-case, HTTP route, MCP tool, and the economic-events adapter/table are 19-04..19-09's scope (matches 18-01/19-01/19-02 precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded candidate-selection.ts doc comments to avoid the literal `new Date(` substring**
- **Found during:** Task 1, running the acceptance-criteria grep check (`rg -n 'new Date\(' packages/core/src/picker/domain/candidate-selection.ts` must return no match)
- **Issue:** Three doc comments explaining the "no Date-instant construction" discipline (Pitfall 3) contained the literal text `new Date(` while describing what NOT to do, which the grep check flags regardless of code-vs-comment context.
- **Fix:** Reworded all three comments to describe the constraint ("no Date-instant construction", "never a Date-instant constructor call") without the literal substring. No functional change — the implementation never used `new Date(` to begin with.
- **Files modified:** packages/core/src/picker/domain/candidate-selection.ts
- **Verification:** `rg -n 'new Date\(' packages/core/src/picker/domain/candidate-selection.ts` returns no match; full suite still green.
- **Committed in:** 88daa32 (Task 1 commit)

**2. [Rule 1 - Bug] Corrected the theta-filter test fixture to a genuinely pathological (front-low-iv, back-extreme-iv) chain**
- **Found during:** Task 1, while authoring the "drops any calendar with net theta <= 0" test
- **Issue:** The first fixture attempt (identical iv, then a lower back-iv than front) produced POSITIVE net theta at every strike when checked against the real `bsmGreeks` engine via a probe script (longer-dated options decay slower per day even at lower iv, so `backTheta - frontTheta > 0` held) — the test would have been vacuously true or wrong.
- **Fix:** Verified via probe script that a front iv of 0.05 paired with an extreme back iv of 2.5 (same strike, dte 30/51) produces negative net theta at every strike in the fixture's range, and rewrote the test to use those values with a strong `candidates.length === 0` assertion.
- **Files modified:** packages/core/src/picker/domain/candidate-selection.test.ts
- **Verification:** Test passes; `theta<=0` branch is genuinely exercised (confirmed empty output, not a false-pass).
- **Committed in:** 88daa32 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both bugs caught while authoring/verifying the RED test, before any GREEN commit)
**Impact on plan:** Both fixes are test-authoring corrections that make the test suite actually prove the specified behavior; no production-code scope creep.

## Issues Encountered

None beyond the two deviations documented above.

## Next Phase Readiness

- `selectCandidates` + `scoreCalendarCandidates` are ready for 19-04+ to compose into `computePickerSnapshot` (the chain-triggered use-case that reads the chain/GEX/events ports, calls both functions, maps `ScoredCandidate[]` into `PickerCandidateDomain[]`, and persists a `PickerSnapshotRow`).
- The economic-events external adapter (PICK-03's actual research-required scope: FRED `releases/dates` + FOMC seed, per D-12/D-13) is still entirely unbuilt — `selectCandidates`/`scoreCalendarCandidates` only consume an already-shaped `ReadonlyArray<EconomicEvent>` parameter and have no opinion on where it comes from.
- No blockers for 19-04.

---
*Phase: 19-picker-engine-economic-events*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 5 created files and both task commit hashes (88daa32, cc3bb4d) verified present on disk/in git log.
