---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
plan: 05
subsystem: quant
tags: [scenario-engine, fractional-dte, implied-carry, tos-parity, overview]

requires:
  - phase: 34-02
    provides: "AnalyzerPosition optional frontDteExact/backDteExact/frontRate/frontDivYield/backRate/backDivYield fields; dteExact(occSymbol, now) in pair-calendars.ts"
  - phase: 34-04
    provides: "gexSnapshotResponse.impliedCarry: {expiration, rate, divYield}[] | null, served by GET /api/analytics/gex + get_gex MCP tool"
provides:
  - "resolveCarry(gex, expiration) — pure per-expiry {rate, divYield} lookup in apps/web/src/lib/resolve-carry.ts, exporting DEFAULT_RATE/DEFAULT_DIV as the single degrade-target source"
  - "Overview.buildCalendarPosition wires frontDteExact/backDteExact (dteExact) + per-leg carry (resolveCarry) onto every live calendar's AnalyzerPosition"
  - "34-UAT.md: smile-IV DO-NOT-BUILD decision (D-12) + RTH BE-gap measurement table seeded with the CONTEXT baseline"
affects: []

tech-stack:
  added: []
  patterns:
    - "legExpiryKey(occSymbol) — parseOccSymbol + toDateInputValue (the existing local-Date YYYY-MM-DD formatter from date-projection.ts, RESEARCH Pitfall 1 precedent) round-trips a leg's expiry back to the server's plain YYYY-MM-DD impliedCarry key; \"\" on an unparseable OCC degrades resolveCarry to DEFAULTs rather than throwing"

key-files:
  created:
    - apps/web/src/lib/resolve-carry.ts
    - apps/web/src/lib/resolve-carry.test.ts
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx
    - .planning/phases/34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f/34-UAT.md

key-decisions:
  - "resolveCarry is a pure lookup only (no client-side FRED interpolation) — 34-04's delivery shipped BOTH rate and divYield per expiry already solved together server-side; interpolating a second r client-side would desync it from the q it was solved against."
  - "Expiry→impliedCarry key formatting reuses date-projection.ts's toDateInputValue (LOCAL Date getters), not toISOString()/UTC getters — parseOccSymbol constructs its Date via the LOCAL-timezone constructor (new Date(y, m-1, d)), and this codebase has a documented Pitfall (RESEARCH Pitfall 1, date-projection.ts's own comment) that UTC-based formatting of a locally-constructed Date drifts a day in negative-UTC-offset timezones — i.e. every US timezone this app runs in. The plan's read_first said \"(UTC)\"; reusing the existing local-getter helper is the round-trip-correct choice and avoids reintroducing a bug class this project has already hit twice."
  - "On an unparseable leg OCC symbol, legExpiryKey returns \"\" rather than omitting the carry fields — resolveCarry(gex, \"\") never matches a real impliedCarry entry and degrades to DEFAULT_RATE/DEFAULT_DIV, the identical numeric result as the ScenarioParams floor the engine would otherwise fall back to. Always setting the fields (rather than conditionally omitting them under exactOptionalPropertyTypes) is the smaller diff for an identical outcome."
  - "Pinned the system clock (vi.useFakeTimers({ toFake: ['Date'] }) + vi.setSystemTime) in the two pre-existing OVW-06 tests that compare payoff curves across two separately-mounted renders (cleanup()+render() pairs). Root cause: dteExact() is fractional (not whole-day-ceiled like the pre-existing dte()), so the two mounts' independent new Date() calls — previously absorbed by Math.ceil to identical whole-day integers — now produce measurably different fractional-day values, which propagate through BSM theta into a real (non-floating-point-noise) curve difference. Faking only 'Date' (not timers/rAF) avoids touching react-query polling or Recharts animation."
  - "DEFAULT_RATE/DEFAULT_DIV moved out of Overview.tsx into resolve-carry.ts as the single source (plan requirement) — same numeric values (0.045/0.013), only the import site changed; every existing consumer (resolveLeg, netGreeksForLegs, all ScenarioParams constructions) is unaffected."

patterns-established:
  - "buildCalendarPosition is now exported (was module-private) — the least-invasive way to unit-test a pure UI data transform per .claude/rules/tdd.md scope (UI component logic / data transforms)."

requirements-completed: [TOSP-01, TOSP-02, TOSP-03, TOSP-04]

coverage:
  - id: D1
    description: "resolveCarry(gex, expiration) looks up the per-expiry {rate, divYield} from gex.impliedCarry, degrading to DEFAULT_RATE/DEFAULT_DIV when gex is undefined, impliedCarry is null, or no entry matches — total, no any/as/!"
    requirement: "TOSP-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/resolve-carry.test.ts#resolveCarry — hit + 3 degrade cases (undefined gex, null impliedCarry, no match)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Overview.buildCalendarPosition sets frontDteExact/backDteExact via dteExact() and per-leg frontRate/frontDivYield/backRate/backDivYield via resolveCarry() on every live calendar's AnalyzerPosition, threaded from useGex(); gex-undefined degrades every leg to DEFAULT_RATE/DEFAULT_DIV"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#buildCalendarPosition (34-05: fractional DTE + per-leg carry) — wires fractional frontDteExact/backDteExact and per-leg carry from the GEX impliedCarry"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#buildCalendarPosition (34-05: fractional DTE + per-leg carry) — falls back to DEFAULT_RATE/DEFAULT_DIV per leg when gex is undefined"
        status: pass
    human_judgment: false
  - id: D3
    description: "Whole workspace suite, typecheck, and lint stay green with the fractional-DTE + implied-carry wiring integrated (293 test files / 3221 tests)"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "bun run test (full workspace) — 293 test files / 3221 tests passed"
        status: pass
      - kind: other
        ref: "bun run typecheck — clean; bun run lint — clean (only pre-existing unrelated legacy-boundaries-selector warning)"
        status: pass
    human_judgment: false
  - id: D4
    description: "34-UAT.md records the smile-IV DO-NOT-BUILD decision (D-12) with rationale + revisit trigger, and the RTH BE-today parity measurement hook (before/after table seeded with the CONTEXT.md baseline, empty AFTER cells)"
    requirement: "TOSP-03"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f/34-UAT.md — Section 1 (smile-IV decision) + Section 2 (RTH BE-gap table)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The RTH BE-today parity measurement itself (live marks, same 3-calendar book, TOS Analyze comparison) — orchestrator/user-driven via /gsd-verify-work 34, not an executor step"
    requirement: "TOSP-04"
    verification: []
    human_judgment: true
    rationale: "Requires live RTH market data and a live TOS Analyze comparison on the user's actual broker session — cannot be automated or verified from the executor's environment."

duration: ~35min
completed: 2026-07-11
status: complete
---

# Phase 34 Plan 05: Overview wiring — fractional DTE + per-leg carry + phase close Summary

**`resolveCarry()` (a pure per-expiry carry lookup) wired into `Overview.buildCalendarPosition`, so the live-book payoff hero now prices every calendar leg with its own settlement-aware fractional DTE and its own parity-implied carry instead of a flat whole-day/flat-rate model — degrading byte-identically to today's behavior when GEX data is cold or missing, plus the phase-closing smile-IV DO-NOT-BUILD record and RTH BE-gap measurement hook.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (2 TDD RED→GREEN, 1 auto)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `resolveCarry(gex, expiration)` in `apps/web/src/lib/resolve-carry.ts` — a total, pure lookup over `gex.impliedCarry` (the array 34-04 added to `GexSnapshotResponse`), returning that expiry's `{rate, divYield}` on a hit and `{DEFAULT_RATE, DEFAULT_DIV}` on any miss (undefined gex, null impliedCarry, or no matching expiration). No client-side FRED interpolation — the server already solves r and q together, so re-deriving r client-side would desync it from the q it was solved against (34-04's delivery refinement, confirmed against the actual shipped contract rather than the RESEARCH.md sketch).
- `Overview.buildCalendarPosition` (now exported) gains a `gex: GexSnapshotEntry | undefined` parameter, threaded from the existing `useGex()` call at its one call site (the `calendarBuild` useMemo). For each live calendar it now sets: `frontDteExact`/`backDteExact` via `dteExact(occSymbol, now)` (34-02, always safe — degrades internally to the whole-day value on an unparseable OCC) and `frontRate`/`frontDivYield`/`backRate`/`backDivYield` via `resolveCarry(gex, legExpiryKey(occSymbol))`, a new local helper that formats `parseOccSymbol(...).expiry` to the server's `YYYY-MM-DD` key using `date-projection.ts`'s existing `toDateInputValue` (LOCAL Date getters — the round-trip-correct match for `parseOccSymbol`'s LOCAL-timezone `Date` construction; see Decisions).
- `Overview.tsx`'s local `DEFAULT_RATE`/`DEFAULT_DIV` constants were removed and replaced with imports from `resolve-carry.ts` (single source, plan requirement) — every existing consumer (`resolveLeg`, `netGreeksForLegs`, all `ScenarioParams` constructions) keeps the identical numeric values, zero behavior change there.
- `resolveLegIv`, the `ScenarioParams` construction, and the picker/pasted position-build paths are untouched, exactly as scoped — confirmed by the full-suite green run with zero changes needed outside `Overview.tsx`/`resolve-carry.ts`.
- `34-UAT.md` records the smile-aware IV deferral as DO NOT BUILD (D-12) with its rationale (TOS's default "Individual Implied Volatility" mode already holds each series' own IV fixed as spot moves — exactly this book's shape) and revisit trigger, plus the RTH BE-today before/after gap table seeded with the CONTEXT.md baseline (TOS 7413.21/7690.62 vs ours 7421/7673 BEFORE) and empty AFTER cells for the orchestrator/user-driven `/gsd-verify-work 34` measurement.

## Task Commits

Each task was committed atomically per the plan-level TDD gate:

1. **Task 1 RED** — `bd4803b` (test): add failing test for resolveCarry per-expiry lookup
2. **Task 1 GREEN** — `3462fa0` (feat): add resolveCarry — per-expiry carry lookup with DEFAULT fallback
3. **Task 2 RED** — `ba66bc4` (test): add failing test for buildCalendarPosition dteExact + carry wiring
4. **Task 2 GREEN** — `955fd4b` (feat): wire fractional DTE + per-leg carry into buildCalendarPosition
5. **Task 3** — `f5f9ebb` (docs): record smile-IV DO-NOT-BUILD decision and RTH BE-gap measurement hook

_No REFACTOR commits — both GREEN implementations matched the researched design with nothing to clean up._

## Files Created/Modified

- `apps/web/src/lib/resolve-carry.ts` — new: `resolveCarry(gex, expiration)` + `DEFAULT_RATE`/`DEFAULT_DIV`.
- `apps/web/src/lib/resolve-carry.test.ts` — new: hit case + 3 degrade cases.
- `apps/web/src/screens/Overview.tsx` — `buildCalendarPosition` exported, gains `gex` param + `legExpiryKey` helper; sets `frontDteExact`/`backDteExact`/`frontRate`/`frontDivYield`/`backRate`/`backDivYield`; local `DEFAULT_RATE`/`DEFAULT_DIV` replaced with imports; `calendarBuild` useMemo threads `gex` (added to its dep array).
- `apps/web/src/screens/Overview.test.tsx` — new `buildCalendarPosition (34-05: fractional DTE + per-leg carry)` describe block (2 tests); pinned the system clock in the two pre-existing OVW-06 cross-mount comparison tests (see Decisions).
- `.planning/phases/34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f/34-UAT.md` — new: smile-IV decision record + RTH BE-gap measurement table.

## Decisions Made

See `key-decisions` in the frontmatter (resolveCarry pure-lookup scope correction vs the RESEARCH.md sketch; local-getter `toDateInputValue` reuse over the plan's literal "(UTC)" wording, avoiding a documented Pitfall-1-class bug; the `""`-key degrade-to-DEFAULT approach for unparseable OCC symbols; the fake-clock fix for the two cross-mount OVW-06 tests; the `DEFAULT_RATE`/`DEFAULT_DIV` single-source move).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pinned the system clock in two pre-existing OVW-06 tests that compare curves across separately-mounted renders**
- **Found during:** Task 2 GREEN, full `Overview.test.tsx` run
- **Issue:** `dteExact()` is fractional (not whole-day-`Math.ceil`'d like the pre-existing `dte()`). Two OVW-06 tests (`unchecking a calendar row removes its contribution from BOTH payoff curves...` and `CR-01 regression: a non-convergent calendar contributes nothing to EITHER curve...`) each call `render(<Overview />)` twice with `cleanup()` in between, then assert `toEqual` across the two renders. Previously the whole-day `dte()` ceiling absorbed the few-millisecond wall-clock gap between the two independent `new Date()` calls (one per render); once DTE went fractional, that gap propagated through BSM theta into a small but real (non-floating-point-noise) curve difference, failing the `toEqual`.
- **Fix:** Added `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` to the `OVW-06` describe's `beforeEach` (and `vi.useRealTimers()` to a new local `afterEach`), pinning `now` identically across both mounts — restoring the determinism these tests were written to prove (exclusion equivalence), not clock drift. Faking only `'Date'` (not timers/`requestAnimationFrame`) avoids touching react-query polling or Recharts animation.
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Verification:** Full `Overview.test.tsx` suite green (58/58) before and after; `bun run test` full workspace green (293 files / 3221 tests).
- **Committed in:** `955fd4b` (bundled with the Task 2 GREEN commit, since it was required for that commit's test run to pass — the test-file edit itself was included in the earlier RED commit `ba66bc4` as part of the same file's diff, split by file per the task-commit protocol; the fake-timer addition landed with the GREEN source commit's accompanying verification).

---

**Total deviations:** 1 auto-fixed (Rule 1, bug — pre-existing test fragility exposed by making DTE fractional, not a regression in the new code itself). No scope creep — the fix is confined to two tests' clock setup in the same file the plan already modifies; no other files touched.

## Issues Encountered

None beyond the deviation documented above. Both RED steps surfaced exactly the anticipated failures (missing `resolve-carry.ts` module; `buildCalendarPosition is not a function`, since it wasn't exported yet), confirmed via actual test runs before each GREEN implementation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 34 (TOS-Parity Scenario Model) is code-complete: fractional DTE (34-02) and parity-implied carry (34-04) are both now live in the browser's payoff hero via this plan's wiring. The only remaining phase item is the RTH BE-today measurement itself (`34-UAT.md` Section 2, coverage D5) — orchestrator/user-driven via `/gsd-verify-work 34` during live RTH market hours, not an executor step.
- If the RTH measurement shows a residual gap that's demonstrably vol-attributable (not explained by DTE/carry), the smile-IV deferral (D-12) has its revisit trigger recorded in `34-UAT.md` Section 1.
- `resolveCarry`/`DEFAULT_RATE`/`DEFAULT_DIV` in `apps/web/src/lib/resolve-carry.ts` are now the single source for the flat carry floor — any future consumer of the same constants should import from there, not redeclare locally.

## Self-Check: PASSED

All created/modified files and commit hashes verified present (see below).

---
*Phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f*
*Completed: 2026-07-11*
