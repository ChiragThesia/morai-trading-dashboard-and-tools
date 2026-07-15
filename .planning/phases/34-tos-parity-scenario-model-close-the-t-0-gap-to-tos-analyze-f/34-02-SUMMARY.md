---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
plan: 02
subsystem: quant
tags: [scenario-engine, fractional-dte, day-count, settlement, tos-parity]

requires:
  - phase: 34-01
    provides: "settlementTimestamp(root, expiry): Date from @morai/shared"
provides:
  - "dteExact(occSymbol, now): number exported from pair-calendars.ts — settlement-aware fractional DTE, integer-day fallback"
  - "AnalyzerPosition optional frontDteExact/backDteExact/frontRate/frontDivYield/backRate/backDivYield fields"
  - "scenario-engine's resolveDte(exact, whole) fallback pattern, reused by calendarNetPrice/bookGreekAt/positionGreeksAt"
  - "Day-count uniformly 365.25 across scenario-engine.ts (matches iv-calibration.ts/position-greeks.ts, D-02)"
affects: ["34-05 (wires frontDteExact/backDteExact + per-leg carry from the live book into AnalyzerPosition construction)"]

tech-stack:
  added: []
  patterns:
    - "resolveDte(exact, whole) — optional-field-with-fallback pattern for fractional-DTE consumption, mirrors the per-leg carry fallback (pos.backRate ?? params.rate)"

key-files:
  created: []
  modified:
    - apps/web/src/lib/pair-calendars.ts
    - apps/web/src/lib/pair-calendars.test.ts
    - apps/web/src/lib/scenario-engine.ts
    - apps/web/src/lib/scenario-engine.test.ts

key-decisions:
  - "calendarNetPrice's existing (unused-by-any-current-caller) overrideFrontDte parameter still wins over frontDteExact when supplied — it represents an explicit full override of the day count (used for the @exp single-horizon evaluation), not a fallback candidate; resolveDte only applies when no override is given."
  - "Fixed three OTHER independent test oracles (the pre-existing top-of-file kernel-parity test, the mixed-expiry expirationCurve test, and the entry-anchoring test) from /365 to /365.25 — these compute expected values independently of the engine and would have silently diverged once the engine's real divisor changed. The pre-existing kernel-parity test doubles as the plan's required 'no-new-fields position matches prior behavior save the divisor' regression proof (LIVE_POS carries none of the new optional fields), so no separate duplicate test was added for that half of Task 2's RED step."

patterns-established:
  - "Pattern 3 from 34-RESEARCH.md (kernel-parity oracle, T computed independently via settlementTimestamp) extended one level deeper: T itself (not just the greeks call) is now cross-checked against a fractional-DTE + per-leg-carry position."

requirements-completed: [TOSP-01]

coverage:
  - id: D1
    description: "pair-calendars.ts exports dteExact(occSymbol, now), a settlement-aware fractional-days twin of the whole-day dte(); dte() and CalendarGroup stay unchanged/integer"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/pair-calendars.test.ts#dteExact — settlement-aware fractional days"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/pair-calendars.test.ts#dte() (via CalendarGroup) — unchanged whole-day integers"
        status: pass
    human_judgment: false
  - id: D2
    description: "dteExact never negative (past settlement clamps to 0) and degrades to dte()'s value on an unparseable OCC symbol — never throws, never NaN"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/pair-calendars.test.ts#dteExact — settlement-aware fractional days (clamp + degrade cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AnalyzerPosition gains optional frontDteExact/backDteExact and per-leg frontRate/frontDivYield/backRate/backDivYield; calendarNetPrice/bookGreekAt/positionGreeksAt resolve them via resolveDte(exact, whole) and per-leg carry fallback to ScenarioParams, with the day-count switched to 365.25"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#repriceScenario — kernel parity with fractional DTE + per-leg carry (34-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A position without any of the new optional fields (LIVE_POS) reprices identically to before, save the 365→365.25 divisor — proven against an independent oracle, not the engine's own output"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/scenario-engine.test.ts#repriceScenario — kernel parity (D-01) — per-position greeks equal a direct bsmGreeks call AND the Plan-06 computePositionGreeks output"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-11
status: complete
---

# Phase 34 Plan 02: scenario-engine fractional DTE + per-leg carry kernel plumbing Summary

**`dteExact()` (settlement-aware fractional days) in pair-calendars.ts, plus optional `frontDteExact`/`backDteExact` and per-leg carry fields on `AnalyzerPosition`, wired through `calendarNetPrice`/`bookGreekAt`/`positionGreeksAt` via one `resolveDte(exact, whole)` fallback and a uniform 365.25 day-count — every existing caller stays byte-identical except the divisor.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files modified:** 4 (all existing, no new files)

## Accomplishments

- `dteExact(occSymbol, now): number` in `apps/web/src/lib/pair-calendars.ts` — composes `parseOccSymbol` with 34-01's `settlementTimestamp(root, expiry)` to return exact fractional days to a leg's settlement instant. Clamps at 0 for a past settlement (mirrors `dte()`'s `Math.max`); degrades to the existing whole-day `dte()` value on an unparseable OCC symbol — never throws, never `NaN`. `dte()` and `CalendarGroup.dteFront`/`dteBack` are byte-unchanged (proven by a new explicit integer assertion, not just left alone).
- `AnalyzerPosition` (`scenario-engine.ts`) gains six optional fields: `frontDteExact`, `backDteExact`, `frontRate`, `frontDivYield`, `backRate`, `backDivYield`. All omitted by every existing construction site in the codebase (picker/pasted/current Overview/Analyzer callers) — typecheck confirms no caller needed updating.
- A private `resolveDte(exact, whole)` helper (`exact ?? whole`) is shared by `calendarNetPrice`, `bookGreekAt`, and `positionGreeksAt` (and therefore `entryNetPrice`, which calls `calendarNetPrice`) — one consistent kernel reads the same fallback logic for the payoff curve, greek strips, and per-position greeks (D-01).
- Per-leg carry resolves the same way: `pos.backRate ?? rate`, `pos.backDivYield ?? divYield` (and front), so the back leg can price with different carry than the front leg once 34-05 wires real per-expiry values, while today's callers (no per-leg carry set) get the identical single-pair `ScenarioParams` carry as before.
- The `/365` divisor in all three pricing helpers is now `/365.25` (`DAYS_PER_YEAR` constant), matching `iv-calibration.ts`/`position-greeks.ts` so the IV that gets calibrated and the IV that gets re-priced share one T convention (D-02, 34-RESEARCH.md Pitfall 1).
- Kernel-parity oracle (Pattern 3, extended one level deeper than the existing D-01 test): a position carrying `frontDteExact`/`backDteExact` and distinct per-leg `rate`/`divYield` reprices identically to a direct `bsmGreeks` call where `T` is computed independently in the test via `settlementTimestamp`, not via `dteExact()` (avoids coupling the oracle to Task 1's own implementation).
- `calendarNetPrice`'s pre-existing `overrideFrontDte` parameter (present in the signature but unused by any current caller) still wins over `frontDteExact` when supplied — an explicit override of the day count, not a fallback candidate.

## Task Commits

Each task was committed atomically per the plan-level TDD gate:

1. **Task 1 RED** — `80fc7da` (test): add failing test for pair-calendars dteExact
2. **Task 1 GREEN** — `8368e69` (feat): add pair-calendars dteExact — settlement-aware fractional DTE
3. **Task 2 RED** — `6b493ad` (test): add failing test for scenario-engine fractional DTE + per-leg carry
4. **Task 2 GREEN** — `f797705` (feat): scenario-engine gains optional fractional DTE + per-leg carry, 365.25

_No REFACTOR commits — both GREEN implementations matched the researched design (34-RESEARCH.md Pattern 1/Pattern 3, "Code Examples" `resolveDte` snippet) with nothing to clean up._

## Files Created/Modified

- `apps/web/src/lib/pair-calendars.ts` — new exported `dteExact(occSymbol, now)`; `dte()` and `CalendarGroup` untouched.
- `apps/web/src/lib/pair-calendars.test.ts` — 3 new `dteExact` cases (hand-computed PM-settlement oracle, past-settlement clamp, unparseable-OCC degrade) + 1 new `dte()`-unchanged integer assertion.
- `apps/web/src/lib/scenario-engine.ts` — `AnalyzerPosition` gains 6 optional fields; new `resolveDte` helper + `DAYS_PER_YEAR` constant; `calendarNetPrice`/`bookGreekAt`/`positionGreeksAt` resolve exact DTE and per-leg carry; two stale `/365` doc comments updated to `/365.25`.
- `apps/web/src/lib/scenario-engine.test.ts` — new kernel-parity block (fractional DTE + per-leg carry, Pattern 3); existing kernel-parity test's independent oracle divisor fixed `365→365.25` (doubles as the no-new-fields regression proof); two other independent-oracle tests (mixed-expiry `expirationCurve`, entry-anchoring) had their own `/365` computations fixed to `/365.25` to keep tracking the engine's corrected math.

## Decisions Made

- Reused the pre-existing top-of-file kernel-parity test (fixed to `365.25`) as the plan's required "no-new-fields position matches prior behavior save the divisor" proof, rather than writing a second near-duplicate test — same fixture (`LIVE_POS`, no 34-02 fields), same assertion shape, smaller diff.
- The new Pattern-3 oracle test computes `T` via `settlementTimestamp()` directly in the test (not via calling `dteExact()`), so the scenario-engine test suite doesn't depend on Task 1's own implementation being correct — an independent cross-check, per the plan's stated method.
- `overrideFrontDte` (unused by any current caller, confirmed via `rg`) keeps taking precedence over `frontDteExact` in `calendarNetPrice` — preserves its existing "explicit full override" semantics rather than silently changing behavior for a parameter no one calls yet.

## Deviations from Plan

None beyond the anticipated in-file consistency fixes the plan itself flagged as necessary (the divisor propagating to independent test oracles). No architectural changes, no new dependencies, no files touched beyond what Tasks 1/2 specified.

## Issues Encountered

None — RED failures were exactly the anticipated ones (missing `dteExact` export; missing `AnalyzerPosition` fields; stale `/365` oracles vs. the new `/365.25` engine math), confirmed via actual test runs before each GREEN implementation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Exact new `AnalyzerPosition` field names for 34-05:** `frontDteExact?: number`, `backDteExact?: number`, `frontRate?: number`, `frontDivYield?: number`, `backRate?: number`, `backDivYield?: number` — all optional, all fall back gracefully (integer DTE / `ScenarioParams.rate`/`divYield`) when omitted.
- `dteExact(occSymbol, now): number` is importable from `apps/web/src/lib/pair-calendars.ts` — 34-05 (or wherever Overview's `buildCalendarPosition` lives) can call it per leg to populate `frontDteExact`/`backDteExact` on the live-book construction path.
- Per-leg carry fields are pure plumbing this plan — no caller sets them yet (34-04/34-05's job to source parity-implied `q` and FRED-interpolated `r` per leg and wire them in).
- Full workspace gate green: `bun run typecheck` clean, `bun run lint` clean (only the pre-existing legacy-boundaries-selector warning, unrelated), `bun run test` — 292 test files / 3203 tests passed (includes the 4 new/modified `pair-calendars.test.ts` cases and the 1 new + 3 fixed `scenario-engine.test.ts` cases).
- Picker/pasted paths (`candidate-to-position.ts`, `parsed-calendar-to-candidate.ts`, `tos-parser.ts`) are unaffected by design — they never set the new optional fields and keep their exact current behavior (Pitfall 4, confirmed by the full-suite green run with zero changes needed in those files).

## Self-Check: PASSED

All created/modified files and commit hashes verified present (see below).

---
*Phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f*
*Completed: 2026-07-11*
