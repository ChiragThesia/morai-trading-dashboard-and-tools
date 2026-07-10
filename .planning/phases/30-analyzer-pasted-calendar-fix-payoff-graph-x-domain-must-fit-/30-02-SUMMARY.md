---
phase: 30-analyzer-pasted-calendar-fix
plan: 02
subsystem: ui
tags: [react, visx, payoff-chart, scenario-engine]

requires:
  - phase: 30-01
    provides: "computePayoffDomain, domain-aware repriceScenario, PayoffChart required domain prop"
provides:
  - "Analyzer.tsx and Overview.tsx both compute ONE payoffDomain via computePayoffDomain and thread it into repriceScenario + <PayoffChart domain=>"
  - "includedForT0 exported from scenario-engine.ts — the same pl-contribution predicate now gates payoff-domain.ts's strike anchors"
affects: [30-06 (paste-flow real engine scoring, unrelated to domain wiring)]

tech-stack:
  added: []
  patterns:
    - "Screen-level payoffDomain useMemo, deps [positions, spot, params] — one domain per screen, fed to every repriceScenario call AND the chart (Pitfall 1)"
    - "Domain-anchor strikes filtered through includedForT0 (excluded/non-convergent legs never widen a domain they don't draw)"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx
    - apps/web/src/lib/payoff-domain.ts
    - apps/web/src/lib/scenario-engine.ts

key-decisions:
  - "computePayoffDomain's strike anchors are filtered through includedForT0 (exported from scenario-engine.ts) — an excluded/non-convergent position must not widen the domain since it never contributes to either curve; caught by the existing CR-01 Overview regression test the moment the real domain replaced the 6900-7900 placeholder"
  - "Overview's highlightedScenario (row-hover overlay curve) also takes the SAME payoffDomain as the main scenario — an overlay curve computed on a stale/independent grid would visually mismatch the now-dynamic chart x-scale"
  - "Analyzer.test.tsx's 5 existing repriceScenario-comparison tests rebuild their `expected` curve via the same computePayoffDomain(positions, spot, params) call Analyzer.tsx now makes, rather than asserting against the old hardcoded 6900-7900 grid"

requirements-completed: [D-01]

coverage:
  - id: D1
    description: "Analyzer's selected/combined-book payoff chart computes one domain via computePayoffDomain and threads it into both repriceScenario's data grid and <PayoffChart domain=>"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — payoff center (Task 3, ANLZ-02) — feeds candidateToAnalyzerPosition(selected) into repriceScenario and passes the picker curve colors"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — pasted calendars (multi-paste) — the pasted candidate drives the shared center Risk-profile chart via the same candidate→position→repriceScenario path"
        status: pass
    human_judgment: false
  - id: D2
    description: "Overview's combined-book payoff chart computes one domain from the FULL live book (not a single-candidate slice) and threads it the same way; multi-strike book does not regress"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#OVW-06: unified calendar inclusion (single lifted source of truth) — D-01: combined book at widely-different strikes (7000/7600) gets a domain that brackets BOTH — no clip (Pitfall 4)"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#OVW-06: unified calendar inclusion (single lifted source of truth) — CR-01 regression: a non-convergent calendar contributes nothing to EITHER curve even with its checkbox left checked"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full web project (Analyzer, Overview, PayoffChart, scenario-engine, payoff-domain suites) stays green, typecheck and lint clean — no regression from the domain-threading change"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "bun run test -- --project=web (537 tests, 47 files, all pass)"
        status: pass
      - kind: other
        ref: "bun run typecheck (tsc --build --force, exit 0) && bun run lint (eslint ., exit 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Manual UAT: paste the user's literal 7500P order and confirm the left tail + both breakevens render on morai.wtf's Analyzer"
    verification: []
    human_judgment: true
    rationale: "Visual chart-rendering confirmation requires a human looking at the rendered SVG in a browser — deferred to /gsd-verify-work per this plan's own verification section."

duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 30 Plan 02: Wire Domain Primitives into Analyzer + Overview Summary

**Both real `<PayoffChart>` consumers now compute a single dynamic x-domain from their own book (computePayoffDomain) and feed it to both the pricing grid and the chart scale, replacing the 30-01 hardcoded {min:6900,max:7900} placeholder — the visible half of Defect 1.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-10T14:03:00Z
- **Completed:** 2026-07-10T14:15:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Analyzer's `payoffDomain` memo (`computePayoffDomain(combinedPositions, spot, params)`) now
  drives both `repriceScenario`'s 3rd-arg grid and `<PayoffChart domain=>` — a pasted 7500P's
  left tail and both breakevens are no longer clipped by a fixed 6900-7900 window.
- Overview's `payoffDomain` memo is computed from the FULL live combined book (`calendarPositions`,
  not a single-candidate slice — Pitfall 4) and threads through the main `scenario` grid, the
  row-hover `highlightedScenario` overlay grid, and the chart scale — all three now follow the
  same window.
- Root-caused and fixed a domain-fitting bug surfaced by the existing CR-01 regression test: a
  position excluded by `included:false` or IV non-convergence was still contributing its strike
  as a domain anchor even though `bookPL`/`bookPLAtExpiry` already drop it from both curves.
  Exported `includedForT0` (scenario-engine.ts's existing pl-contribution predicate) and filtered
  `payoff-domain.ts`'s strike anchors through it — an excluded leg no longer widens a tent it
  never draws.
- New Overview test proves a multi-strike combined book (7000P + 7600P calendars, 600 points
  apart) gets a domain that brackets both strikes and that the data grid's own endpoints equal
  the domain bounds exactly (the SpotDomain and the chart scale are the same window, not two
  independently-computed ranges).

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread the domain through the Analyzer payoff path** - `3272a49` (feat)
2. **Task 2: Thread the domain through the Overview combined book + non-regression test** - `1e95bb7` (feat)

## Files Created/Modified

- `apps/web/src/screens/Analyzer.tsx` - `payoffDomain` memo threaded into `repriceScenario`'s 3rd arg and `<PayoffChart domain=>`, replacing the 30-01 placeholder
- `apps/web/src/screens/Analyzer.test.tsx` - 5 `expected`-curve builds now call `computePayoffDomain` the same way Analyzer.tsx does, instead of asserting against the old hardcoded grid
- `apps/web/src/screens/Overview.tsx` - `payoffDomain` memo from the full combined book, threaded into `scenario`, `highlightedScenario`, and `<PayoffChart domain=>`
- `apps/web/src/screens/Overview.test.tsx` - new CAL3/CAL4 (7000P/7600P) fixtures + multi-strike domain-fit test; existing CR-01 test now exercises the real domain path
- `apps/web/src/lib/payoff-domain.ts` - strike anchors filtered through `includedForT0` (Rule 1 fix)
- `apps/web/src/lib/scenario-engine.ts` - `includedForT0` exported (was module-private)

## Decisions Made

- `computePayoffDomain`'s strike anchors are filtered through `includedForT0` — an excluded or
  non-convergent position must not widen the domain any more than it moves the curve. This
  keeps the domain-fitting anchor set consistent with the exact predicate `bookPL`/
  `bookPLAtExpiry` already use to decide what's actually drawn.
- Overview's `highlightedScenario` (the row-hover overlay curve) takes the same `payoffDomain`
  as the main scenario — an overlay computed on a stale/independent grid would visually
  mismatch the chart's now-dynamic x-scale.
- Analyzer.test.tsx's pre-existing `repriceScenario`-comparison tests were updated (not
  rewritten) to build their `expected` curve via the same `computePayoffDomain` call
  Analyzer.tsx itself makes — this is the literal migration path 30-01's own SUMMARY.md called
  out as this plan's job, not a new behavior under test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] computePayoffDomain's strike anchors included excluded/non-convergent positions**
- **Found during:** Task 2 (Overview combined-book wiring)
- **Issue:** `payoff-domain.ts`'s `computePayoffDomain` (built in 30-01) used
  `positions.map(extractStrike)` unconditionally — including positions with `included: false`
  or a non-convergent front/back leg IV. Overview's existing CR-01 regression test ("a
  non-convergent calendar contributes nothing to EITHER curve") failed once the real dynamic
  domain replaced the placeholder: the non-convergent calendar's strike still widened the
  domain relative to the convergent-only scenario, producing a spot grid shifted by a few
  hundredths of a point even though its pl-contribution was correctly zero in both cases.
- **Fix:** Exported `includedForT0` from `scenario-engine.ts` (the exact predicate `bookPL`/
  `bookPLAtExpiry` already use to decide inclusion) and filtered `payoff-domain.ts`'s strike
  anchors through it before computing `baseAnchors`/`baseLo`/`baseHi`. Falls back to `[spot]`
  when zero positions contribute (matches the existing zero-position empty-domain fallback).
- **Files modified:** `apps/web/src/lib/scenario-engine.ts`, `apps/web/src/lib/payoff-domain.ts`
- **Verification:** `bunx vitest run apps/web/src/screens/Overview.test.tsx` — the CR-01 test
  and all 56 others pass; `bun run test -- --project=web` (537 tests) green; `bun run typecheck`
  and `bun run lint` clean.
- **Committed in:** `1e95bb7` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Necessary to satisfy this plan's own acceptance criterion ("Overview
combined-book payoff chart still renders correctly for a multi-strike live book — no
regression"). The bug was latent in 30-01's pure function and only became observable once a
real dynamic domain (rather than the literal placeholder) was wired to a screen that has a
pre-existing test for this exact invariant. No scope creep — fix is scoped to the one predicate
that was inconsistent between domain-fitting and pl-computation.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both `<PayoffChart>` screens now fit the full tent for any book (single pasted candidate,
  multi-strike Overview book, or a mix of included/excluded/non-convergent legs). Defect 1 is
  visibly fixed pending the deferred manual UAT (paste the user's literal 7500P order on
  morai.wtf and confirm the left tail/breakeven render — `/gsd-verify-work 30`).
- `includedForT0` is now a reusable exported predicate — any future domain-fitting or
  pl-filtering code in this bounded context should call it rather than re-deriving
  `pos.included && !isIvExcludedFromT0(pos)`.
- No blockers for 30-03..06 (contracts, ad-hoc analyze use-case, HTTP/MCP wiring, real-engine
  paste scoring) — none of that work touches the domain primitives this plan and 30-01 shipped.

## Self-Check: PASSED

All 6 modified files verified present on disk with the expected changes; both task commits
(3272a49, 1e95bb7) verified present in `git log --oneline`.

---
*Phase: 30-analyzer-pasted-calendar-fix*
*Completed: 2026-07-10*
