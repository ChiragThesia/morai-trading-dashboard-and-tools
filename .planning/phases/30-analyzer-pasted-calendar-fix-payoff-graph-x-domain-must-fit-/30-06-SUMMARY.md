---
phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
plan: 06
subsystem: ui
tags: [react, tanstack-query, picker, tos-parser, tdd]

# Dependency graph
requires:
  - phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-
    provides: "POST /api/picker/analyze HTTP route (30-05) + analyzeAdHocCalendarRequest/Response contracts (30-03)"
provides:
  - "ParsedCalendar.frontExpiry/backExpiry ISO expiry dates (apps/web/src/lib/tos-parser.ts)"
  - "useAnalyzeCalendar() mutation hook (apps/web/src/hooks/useAnalyzeCalendar.ts)"
  - "Analyzer.tsx paste flow POSTs PUT pastes to the real engine; breakdown.length===0 note-gates"
  - "CandidateCard shows a scored pasted card's real score/subline while keeping the PASTED badge"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["breakdown.length>0 as the 'is this candidate scored' predicate (replaces id-prefix checks)"]

key-files:
  created:
    - apps/web/src/hooks/useAnalyzeCalendar.ts
    - apps/web/src/hooks/useAnalyzeCalendar.test.ts
  modified:
    - apps/web/src/lib/tos-parser.ts
    - apps/web/src/lib/tos-parser.test.ts
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/components/picker/CandidateCard.tsx
    - apps/web/src/components/picker/CandidateCard.test.tsx

key-decisions:
  - "isPastedId() helper removed entirely — all 4 of its call sites (3 note-gates + the Risk-profile debit/theta/vega subline) now key off candidate.breakdown.length===0, which is a strictly more correct predicate (identifies 'not scored', not 'was pasted')"
  - "A network/HTTP error from the analyze endpoint adds NO card (mirrors a parse failure) — id/seq reservation is deferred inside addCandidate so a failed request never consumes a paste-sequence number or auto-selects a card that was never added"
  - "apps/web has no msw dependency and no established web-hook msw usage — mirrored the codebase's actual convention (vi.mock('../lib/rpc.ts') mocking apiFetch, per useRuleSettings.test.ts/useRuleTags.test.ts) instead of the plan's 'msw for hook tests' note"

requirements-completed: [D-02]

coverage:
  - id: D1
    description: "ParsedCalendar carries real ISO frontExpiry/backExpiry dates derived from the already-computed frontMs/backMs (never reconstructed from asOf+dte)"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/tos-parser.test.ts#parseTosOrder: frontExpiry/backExpiry ISO dates"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pasting a PUT calendar calls useAnalyzeCalendar with the parsed legs; scored:true adds a candidate with a populated breakdown; scored:false/network-error falls back to parsedCalendarToPickerCandidate; a pasted CALL never calls the endpoint"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useAnalyzeCalendar.test.ts#useAnalyzeCalendar"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#Analyzer — pasted calendars (multi-paste)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The three 'not engine-scored' render gates (scorecard, WHY panel, ENTRY/EXIT panel) plus the Risk-profile debit/theta/vega subline key off candidate.breakdown.length===0, not the pasted id — a scored pasted candidate renders full panels"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Analyzer.test.tsx#scored:true renders the real breakdown bars, θ GATE, WHY THIS CALENDAR, and ENTRY/EXIT PLAN"
        status: pass
    human_judgment: false
  - id: D4
    description: "CandidateCard shows a scored pasted card's real score + theta/vega subline while keeping the PASTED provenance badge; an unscored pasted card keeps today's pill-only display"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/CandidateCard.test.tsx#CandidateCard — scored pasted variant (Phase 30-06, D-02, Pitfall 8)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Manual: paste the user's 7500P order on morai.wtf produces the full engine analysis (score + bars + θ GATE + gate verdict + exit plan)"
    verification: []
    human_judgment: true
    rationale: "Requires a live browser session against the deployed server with a real stored picker snapshot — cannot be proven by the unit suite alone (plan's own <verification> block marks this Manual/UAT)."

duration: ~30min
completed: 2026-07-10
status: complete
---

# Phase 30 Plan 06: Pasted Calendar Real Entry Analysis Summary

**Pasting a PUT calendar now POSTs to `/api/picker/analyze` and renders the SAME entry analysis an engine candidate gets (real breakdown bars, θ GATE, WHY panel, exit plan) — the "not engine-scored" placeholder disappears once scored, gated everywhere by `candidate.breakdown.length > 0` instead of the pasted id.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-10T15:50Z
- **Tasks:** 3
- **Files modified:** 8 (2 new, 6 modified)

## Accomplishments
- `ParsedCalendar` gained `frontExpiry`/`backExpiry` ISO dates, derived from the parser's own already-computed `frontMs`/`backMs` (Pitfall 7 — never reconstructed server-side from `asOf+dte`).
- `useAnalyzeCalendar()` — a TanStack Query mutation hook that POSTs `analyzeAdHocCalendarRequest` to `/api/picker/analyze`; `{scored:false}` resolves normally (not an error, binding #2), only a genuine HTTP/network failure throws.
- `Analyzer.tsx`'s `handlePasteAnalyze` rewired: a parsed PUT order calls the hook and, on `{scored:true}`, adds the returned engine candidate (id remapped to the `pasted-N` provenance prefix); `{scored:false}` or a network error falls back to the existing `parsedCalendarToPickerCandidate` unscored builder; a parsed CALL never reaches the endpoint at all (D-03, puts-only).
- All 4 `isPastedId(...)` call sites (the 3 "not engine-scored" note-gates plus the Risk-profile debit/theta/vega subline) replaced with `candidate.breakdown.length === 0` — the `isPastedId` helper itself is gone (made unused by this change).
- `CandidateCard`'s header-pill and subline branches now gate the score/theta/vega/event-tag display on `candidate.breakdown.length > 0` rather than the raw `pasted` boolean, while still rendering the "PASTED" badge (and its own remove button) whenever `pasted` is true — a scored pasted card reads like an engine card with provenance intact.

## Task Commits

Each task was committed atomically:

1. **Task 1: ParsedCalendar carries ISO expiry dates** - `e4b6480` (feat)
2. **Task 2: useAnalyzeCalendar hook + rewired paste flow** - `66fe559` (feat)
3. **Task 3: CandidateCard shows a scored pasted card's real numbers (Pitfall 8)** - `2b20e42` (feat)

_All three tasks were TDD red→green: for Task 1/3 the new test cases were written first and run to confirm failure for the right reason before the implementation landed in the same commit. For Task 2, `useAnalyzeCalendar.ts` was temporarily stubbed to a `throw new Error("not implemented")` body to verify the new hook test failed for the right reason, then the real implementation was restored — same single-commit-at-green convention as 30-03/30-05 (17.1-01 precedent)._

## Files Created/Modified
- `apps/web/src/lib/tos-parser.ts` - `ParsedCalendar` gains `frontExpiry`/`backExpiry` ISO fields
- `apps/web/src/lib/tos-parser.test.ts` - 2 new tests (exact ISO dates, frontExpiry < backExpiry)
- `apps/web/src/hooks/useAnalyzeCalendar.ts` - new mutation hook for `POST /api/picker/analyze`
- `apps/web/src/hooks/useAnalyzeCalendar.test.ts` - 3 tests (success, scored:false non-error, HTTP-error throw)
- `apps/web/src/screens/Analyzer.tsx` - rewired `handlePasteAnalyze`; `isPastedId` removed; 4 gates → `breakdown.length===0`
- `apps/web/src/screens/Analyzer.test.tsx` - mocked `useAnalyzeCalendar`; converted the paste describe block to async; added scored:true / CALL-fallback / network-error tests
- `apps/web/src/components/picker/CandidateCard.tsx` - header-pill/subline branches gate on `breakdown.length>0`
- `apps/web/src/components/picker/CandidateCard.test.tsx` - 4 new tests for the scored-pasted variant

## Decisions Made
- `isPastedId()` removed entirely rather than kept alongside the new gate — after replacing all 4 call sites with `candidate.breakdown.length === 0`, it had zero remaining callers (CLAUDE.md: "remove only imports/variables your changes made unused").
- A failed `POST /api/picker/analyze` request (network/HTTP error, distinct from a normal `scored:false` response) adds **no** card to the rail — `handlePasteAnalyze` defers id/seq reservation into the same closure that adds the card, so a failed request never consumes a `pasted-N` sequence number or auto-selects a card that doesn't exist. This mirrors the existing parse-failure behavior (also adds nothing, just shows the error copy) rather than adding a synthetic fallback card on top of an error message.
- Server-scored candidates arrive with their own `adhoc-*` id (`analyzeAdHocCalendar.ts`); the client always overwrites it with the reserved `pasted-N` id before storing, per the plan's explicit "keep the pasted-prefix id for provenance" instruction — CandidateRail's removal/combine logic and the rail's key stability depend on that prefix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Also fixed the Risk-profile subline's `isPastedId(selected.id)` gate**
- **Found during:** Task 2
- **Issue:** `Analyzer.tsx`'s Risk-profile panel (the debit/theta/vega line directly under "Risk profile", not one of the plan's 3 named "not engine-scored" note-gates) had its own 4th `isPastedId(...)` check that hid theta/vega for every pasted candidate regardless of score. Leaving it on the old id-based gate would mean a successfully SCORED pasted card still shows debit-only in the one place users read debit/theta/vega together — directly contradicting the plan's own objective ("renders the SAME entry analysis an engine candidate gets").
- **Fix:** Changed the gate from `isPastedId(selected.id)` to `selected.breakdown.length === 0`, consistent with the other 3 gates.
- **Files modified:** apps/web/src/screens/Analyzer.tsx
- **Verification:** `bun run test -- --project=web` green (Analyzer.test.tsx covers the scored-paste path); `bun run typecheck && bun run lint` clean.
- **Committed in:** 66fe559 (Task 2 commit)

**2. [Rule 3 - Blocking] Used the codebase's established apiFetch-mock hook-test convention instead of msw**
- **Found during:** Task 2
- **Issue:** The plan's `<critical_constraint>` said "msw for hook tests", but `msw` is not a dependency of `apps/web` (only `packages/adapters` has it, per `tdd.md`'s scope: "External HTTP adapters → msw"). No existing web hook test in this repo uses msw — every mutation-hook test (`useRuleSettings.test.ts`, `useRuleTags.test.ts`) mocks `apiFetch` directly via `vi.mock("../lib/rpc.ts")`. Adding msw as a new `apps/web` dependency to follow the plan's note verbatim would have introduced an unrequested new dependency and deviated from this file's own established test convention.
- **Fix:** `useAnalyzeCalendar.test.ts` mirrors `useRuleSettings.test.ts`'s `mockApiFetch`/`vi.hoisted` harness exactly (same pattern already used for every other web mutation hook in this codebase).
- **Files modified:** apps/web/src/hooks/useAnalyzeCalendar.test.ts
- **Verification:** 3/3 tests pass; matches the pre-existing precedent byte-for-byte.
- **Committed in:** 66fe559 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 blocking/convention-alignment)
**Impact on plan:** Both fixes make the plan's own stated objective ("pasting a PUT calendar produces the SAME entry analysis an engine candidate gets") actually hold everywhere Analyzer renders theta/vega for the selected candidate, and keep the test suite consistent with this repo's real conventions. No scope creep.

## Issues Encountered
None — all 3 tasks' automated verification (unit tests, typecheck, lint) passed on the first implementation attempt after the initial TDD RED confirmation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Defect 2 (D-02, USER LOCKED) is fully delivered: pasting a PUT calendar now runs through the real engine end-to-end (client parse → `POST /api/picker/analyze` → server use-case → scored `PickerCandidate` → the same `CandidateCard`/`WhyPanel`/`EntryExitPlan`/`ScoringMethodologyPanel` components an engine-suggested candidate uses).
- `bun run test -- --project=web` (549/549) and the full workspace suite (`bun run test`, 3011/3011 across 280 files) are both green after this plan; `bun run typecheck && bun run lint` clean.
- Manual UAT still outstanding (plan's own `<verification>` block, D5 above): paste the user's 7500P order on morai.wtf and confirm the full tent + real score card renders, including with a Phase-29 rule-override active. This is the phase's closing verification step, not a blocker for any future plan.
- No blockers for Phase 31 (Overview Risk Profile marker/label UX, explicitly out of this phase's scope per 30-CONTEXT.md).

---
*Phase: 30-analyzer-pasted-calendar-fix-payoff-graph-x-domain-must-fit-*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 8 created/modified files found on disk; all three task commits (e4b6480, 66fe559, 2b20e42) verified present in git log.
