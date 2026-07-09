---
phase: 26-exit-advisor
plan: 06
subsystem: ui
tags: [react, react-query, tailwind, exits, analyzer, mcp-consumer]

requires:
  - phase: 26-exit-advisor plan 05
    provides: "GET /api/exits (exitsResponse payload) — the live route this plan's useExits hook reads"
provides:
  - apps/web/src/hooks/useExits.ts — GET /api/exits react-query hook (401/404-cold-start/parse, mirrors usePicker.ts)
  - apps/web/src/screens/HeldPositionsPanel.tsx — per-calendar verdict row (severity/escalation/indicative/changed/ROLL)
  - apps/web/src/screens/ExitRulesPanel.tsx — engine ruleSet rendered verbatim in precedence order
  - Analyzer.tsx wiring — both panels mounted below the existing 3-col grid, 5-state precedence (loading/error/cold-start/empty/loaded)
affects: []

tech-stack:
  added: []
  patterns:
    - "Escalated-chip color override via cn()/twMerge, not a new MetricChip prop: EXIT_PRE_EVENT's
      filled-amber chip is built by passing MetricChip alert={true} (bg-downd base) + a className
      override (bg-amber/15 ring-1 ring-amber/40) that twMerge resolves in favor of the later
      classes — no change to the shared MetricChip molecule, no new component prop, matching the
      UI-SPEC's 'new combinator built from existing tokens only' instruction."
    - "Indicative-forced render guard: HeldPositionsPanel checks row.indicative BEFORE rendering
      the verdict value — an indicative row always renders 'AH — indicative'/'STALE — indicative'
      (never the underlying verdict's escalated label), even though the chip's alert(bg-downd)
      background is intentionally shared with STOP's own escalated fill (same 'alert MetricChip'
      construction as Analyzer.tsx's existing session-badge). The value TEXT is the actionability
      guard, not the chip fill."
    - "Panel-owns-states, component-owns-rows split (mirrors CandidateRail/railBody): Analyzer.tsx
      owns all 5 states (loading/error/cold-start/empty/loaded) inline, the same D-18/D-19
      precedence pattern as the picker rail; HeldPositionsPanel only renders the Loaded case's
      rows, given a guaranteed non-empty positions array."

key-files:
  created:
    - apps/web/src/hooks/useExits.ts
    - apps/web/src/screens/HeldPositionsPanel.tsx
    - apps/web/src/screens/ExitRulesPanel.tsx
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx

key-decisions:
  - "Commit split deviated from the plan's literal per-task file list: Task 1's own <verify>
    (`vitest run Analyzer.test.tsx -t \"held positions\"`) and its stated test cases (severity/
    indicative/changed/roll/EXIT-10/empty/cold-start, all asserted via `render(<Analyzer />)`)
    cannot pass without Task 2's Analyzer.tsx wiring already landed — the two tasks are code-
    dependent, not just file-scope-dependent. Commit 1 shipped the 3 new files (hook + 2 panels,
    self-contained, typecheck/lint clean, unconsumed); commit 2 shipped Analyzer.tsx's wiring
    together with ALL new Analyzer.test.tsx cases (both plans' test scope) so every commit stays
    green (workflow.md 'Verification Before Done' / 'commits at green only') — no commit landed
    with a test asserting on not-yet-wired behavior. This is a Rule 3 (auto-fix blocking issue)
    adjustment to commit ORDER only; no test case, component, or requirement was dropped."
  - "No packages/contracts fixture added for ExitsResponse (26-05 shipped the route, not a
    fixture, and this plan's file list doesn't list packages/contracts). EXITS_FIXTURE is defined
    inline in Analyzer.test.tsx — matches this same test file's own precedent (the inline
    RULESET/snapshotWithRegistry() fixture a few describe blocks up) rather than adding a new
    package-level file for one consumer."
  - "verdictLabel()'s STOP/TAKE rung display swaps the server's ASCII-hyphen rung string
    (exit-rules.ts STOP_RUNGS/TAKE_RUNGS labels, e.g. \"-25%\") for the UI-SPEC's minus-sign
    glyph (\"−25%\") at render time only — the payload itself is unchanged (still the engine's
    own string), this is display-only formatting, same pattern EntryExitPlan.tsx's
    fixedSignUsd/debitUsd already establish for signed dollar values on this same screen."
  - "formatMetric()'s rule/metric line is a GENERIC renderer over ExitMetric's own {name, value}
    fields (fraction-vs-count heuristic: pnlPct/termInversion/gammaOffStrike ×100 with a %
    suffix, everything else a plain signed count) rather than a per-metric-name lookup table
    matching the UI-SPEC's illustrative copy examples (\"stop-25\", \"FOMC in 2d\") verbatim —
    those examples aren't literally reproducible from the payload's actual field set (ExitMetric
    carries no event-name field, and ruleId is the plain \"stop\"/\"evt\"/… ExitRuleId, not a
    rung-suffixed \"stop-25\"). The raw-metric-only constraint (EXIT-04, \"never a fabricated
    confidence/probability\") is satisfied; the exact prose shape was illustrative, not a
    literal copy contract for this field."

requirements-completed: [EXIT-07, EXIT-09, EXIT-10]

coverage:
  - id: D1
    description: "HeldPositionsPanel renders one row per open calendar (name, verdict chip, rule/metric line, staleness dot) from the exitsResponse payload"
    requirement: "EXIT-07"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'renders one held-position row per fixture position + the exit rules list in payload order'"
        status: pass
    human_judgment: false
  - id: D2
    description: "STOP and EXIT — pre-event render on distinct filled/alert chips (red-fill vs amber-fill); HOLD/TAKE/ROLL render on the plain chip"
    requirement: "EXIT-07"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'STOP escalates to the down-alert chip...', 'EXIT — pre-event escalates to the filled-amber chip...', 'HOLD/TAKE/ROLL render on the plain (non-alert) chip background'"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-26-16: an indicative verdict is FORCED to the INDICATIVE treatment (amber, 'AH — indicative'/'STALE — indicative') regardless of the underlying verdict — an indicative STOP never renders escalated STOP colors"
    requirement: "EXIT-09"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'T-26-16: an indicative STOP is FORCED to the INDICATIVE treatment...', 'indicative marker reads AH — indicative when...after-hours'"
        status: pass
    human_judgment: false
  - id: D4
    description: "changed:true renders a CHANGED marker colored to the verdict's own value color — the entire EXIT-09 alert surface, no toast/banner"
    requirement: "EXIT-09"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'EXIT-09: a changed verdict shows the CHANGED marker in the verdict's own value color'"
        status: pass
    human_judgment: false
  - id: D5
    description: "T-26-17/EXIT-10: the held-positions panel has zero button/order/onSelect affordance in any row"
    requirement: "EXIT-10"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'EXIT-10: the held-positions panel has no button/order affordance anywhere in its rows'"
        status: pass
    human_judgment: false
  - id: D6
    description: "ExitRulesPanel renders the payload's ruleSet verbatim in its own (precedence) array order — never a client-side copy or re-sort"
    requirement: "EXIT-07"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'renders one held-position row per fixture position + the exit rules list in payload order' (asserts exit-rule-* testid order equals EXITS_FIXTURE.ruleSet order)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Analyzer wires all 5 states (Loading/Error/Cold-start/Empty/Loaded) with the exact UI-SPEC copy, below the unchanged 3-col grid"
    requirement: "EXIT-07"
    verification:
      - kind: unit
        ref: "Analyzer.test.tsx — 'cold-start: null data shows...', 'empty: a settled snapshot with zero positions shows...', 'loading: shows...', 'error: shows...+ a Retry button wired to refetch'"
        status: pass
    human_judgment: false
  - id: D8
    description: "Visual verdict-chip/escalation/CHANGED-marker rendering matches 26-UI-SPEC pixel-for-pixel on the live Analyzer screen"
    human_judgment: true
    rationale: "Requires a browser-driven visual pass (chrome-devtools MCP) against a running dev server with live/seeded exit-verdict data; no MCP browser tool was available in this execution's tool surface, so this deliverable is left for the standing UAT step rather than auto-passed on unit-test evidence alone."
    verification: []

duration: ~20min
completed: 2026-07-09
status: complete
---

# Phase 26 Plan 06: Analyzer Held-Positions + Exit-Rules Panels Summary

**Analyzer now surfaces per-calendar exit verdicts (STOP/EXIT-pre-event escalated red/amber-fill chips, forced-INDICATIVE AH/stale marks, CHANGED alert marker, ROLL suggestion) plus the engine's exit-rule registry, entry-methodology-symmetric with the picker's scoring panel — read-only, zero order affordance.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both execute type, no TDD gate — UI/wiring scope per plan)
- **Files modified/created:** 5 (3 created, 2 modified)

## Accomplishments

- `useExits.ts`: byte-for-byte mirror of `usePicker.ts`'s fetch/parse/retry contract against
  `GET /api/exits` — 401 throws (non-retryable), 404 resolves `null` (cold start, status-only
  check per 26-05's decision), any other error throws, body parsed through `exitsResponse.parse()`.
- `HeldPositionsPanel.tsx`: one non-clickable, `CandidateCard`-styled row per open calendar.
  Verdict chip severity is exactly per the Color contract — HOLD/TAKE/ROLL on the plain chip,
  STOP on the red-fill `alert` chip, `EXIT — pre-event` on a distinct filled-amber chip (built
  from `MetricChip`'s existing `alert`/`className` props via `cn()`/twMerge, no new component
  prop). `indicative: true` FORCES the "AH — indicative"/"STALE — indicative" value text
  regardless of the underlying verdict (T-26-16) — the chip's alert-weight background is
  intentionally shared with STOP's own fill (same construction as the existing session-badge),
  but the value TEXT is the render-time actionability guard. `changed: true` adds a `"CHANGED"`
  marker colored to the verdict's own value color. A `ROLL` verdict adds a suggested-front/
  est.-debit detail row. Zero click handlers, zero buttons anywhere in the panel (EXIT-10).
- `ExitRulesPanel.tsx`: renders `exitsResponse.ruleSet` as a flat list in the payload's own array
  (precedence) order — id/kind label + the registry's own `rationale` sentence, never re-sorted
  or hardcoded.
- `Analyzer.tsx`: calls `useExits()`, mounts both panels as new full-width sibling sections BELOW
  the existing 3-col grid (rail/risk-profile/why-panel columns untouched — PICK-02 guarantee),
  and owns all 5 states (Loading "Loading exit verdicts…" / Error "Couldn't load exit verdicts."
  + Retry / Cold-start "Exit advisor warming up" / Empty "No open positions" / Loaded), mirroring
  the picker rail's existing D-18/D-19 precedence pattern.
- Full suite: 2500/2500 passing (up from the 26-05 baseline of 2487 — 13 net new tests, all in
  `Analyzer.test.tsx`). `bun run typecheck` and `bun run lint` both clean.

## Task Commits

1. **Task 1: useExits hook + HeldPositionsPanel/ExitRulesPanel components**
   - `7aa75bd` — feat(26-06): useExits hook + HeldPositionsPanel/ExitRulesPanel components
2. **Task 2: wire both panels into Analyzer.tsx + rendering tests**
   - `d3f3696` — feat(26-06): wire held-positions + exit-rules panels into Analyzer + rendering tests

_No separate "plan metadata" commit exists per this project's `commit_docs` setting — see State
Updates below. STATE.md/ROADMAP.md updates are explicitly out of scope for this execution per the
orchestrator's instructions._

## Files Created/Modified

- `apps/web/src/hooks/useExits.ts` - GET /api/exits react-query hook
- `apps/web/src/screens/HeldPositionsPanel.tsx` - per-calendar verdict row component
- `apps/web/src/screens/ExitRulesPanel.tsx` - engine ruleSet list component
- `apps/web/src/screens/Analyzer.tsx` - useExits wiring + 5-state handling + panel mount
- `apps/web/src/screens/Analyzer.test.tsx` - 15 new rendering tests (13 net after the 2
  pre-existing suites' baseline shift)

## Decisions Made

- **Commit split deviated from the plan's literal per-task file list** (Task 1's tests require
  Task 2's Analyzer.tsx wiring to pass) — see key-decisions above.
- **No new `packages/contracts` fixture** — `EXITS_FIXTURE` is inline in `Analyzer.test.tsx`,
  matching this file's own existing inline-fixture precedent.
- **STOP/TAKE rung glyph swap is display-only** (ASCII hyphen → minus-sign glyph at render time).
- **`formatMetric()` is a generic fraction-vs-count renderer**, not a per-metric-name copy table —
  see key-decisions above for why the UI-SPEC's illustrative "stop-25"/"FOMC in 2d" examples
  aren't literally reproducible from the payload's actual field shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Commit-order split moved Task 1's test file changes to Task 2's commit**
- **Found during:** Task 1 (attempting to run `vitest run Analyzer.test.tsx -t "held positions"`
  per Task 1's own `<verify>` before Analyzer.tsx was wired)
- **Issue:** Task 1's stated test cases assert on `render(<Analyzer />)` output that only exists
  once Task 2's Analyzer.tsx wiring lands — running Task 1's verify command against Task 1's
  file list alone (no Analyzer.tsx change) would fail (RED), violating "never commit red."
- **Fix:** Committed the 3 new component/hook files alone as Task 1 (self-contained, typecheck/
  lint clean, unconsumed until wiring lands); committed Analyzer.tsx's wiring together with ALL
  new Analyzer.test.tsx cases (both tasks' full test scope) as Task 2, so both commits are green.
- **Files modified:** apps/web/src/screens/Analyzer.test.tsx (moved to the Task-2 commit)
- **Verification:** `bun run vitest run apps/web/src/screens/Analyzer.test.tsx` — 63/63 passing
  after Task 2's commit; full workspace suite 2500/2500 passing.
- **Committed in:** `d3f3696` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking, commit-ordering only — no test, component, or
requirement was dropped or altered from what the plan specified).
**Impact on plan:** Zero scope change. Every test case, component, and copy string the plan
specified for Task 1 exists exactly as described; only which git commit it landed in moved.

## Issues Encountered

One test-authoring mistake, self-caught by the test run itself (not a code bug): the first draft
of the T-26-16 indicative test asserted `"AH — indicative"` against `EXITS_FIXTURE`'s
`marketSession: "rth"` row, which correctly renders `"STALE — indicative"` (the session-agnostic
string). Fixed the assertion and added a companion test exercising the `after-hours` case so both
locked strings (`"AH — indicative"` / `"STALE — indicative"`) have direct coverage.

## User Setup Required

None — no external service configuration required. The panels activate automatically against the
already-deployed `GET /api/exits` route (26-05) the next time this code ships.

## Next Phase Readiness

- The Analyzer screen's exit-advisor surface (EXIT-07/EXIT-09/EXIT-10) is code-complete and fully
  unit-tested; D8 (pixel-level visual UAT against 26-UI-SPEC) is the one open item — no
  chrome-devtools MCP browser tool was available in this execution's tool surface, so it's
  deferred to the standing `/gsd-verify-work 26` visual-UAT step rather than auto-passed.
- No blockers for closing phase 26 pending that visual UAT pass.

---
*Phase: 26-exit-advisor*
*Completed: 2026-07-09*

## Self-Check: PASSED

Verified on disk: `apps/web/src/hooks/useExits.ts`, `apps/web/src/screens/HeldPositionsPanel.tsx`,
`apps/web/src/screens/ExitRulesPanel.tsx` all FOUND. Both task commits (`7aa75bd`, `d3f3696`)
FOUND in `git log --oneline --all`. Full workspace suite 2500/2500 passing, `bun run typecheck`
and `bun run lint` both clean at time of writing.
