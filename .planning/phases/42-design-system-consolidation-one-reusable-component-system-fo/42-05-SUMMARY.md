---
phase: 42-design-system-consolidation-one-reusable-component-system-fo
plan: "05"
subsystem: docs
tags: [documentation, design-system, verification]

requires:
  - phase: 42-design-system-consolidation-one-reusable-component-system-fo (Plan 01)
    provides: "DataTable<T> primitive"
  - phase: 42-design-system-consolidation-one-reusable-component-system-fo (Plan 02)
    provides: "CandidateTable → DataTable wrapper"
  - phase: 42-design-system-consolidation-one-reusable-component-system-fo (Plan 03)
    provides: "Overview PositionsTable → DataTable migration"
  - phase: 42-design-system-consolidation-one-reusable-component-system-fo (Plan 04)
    provides: "components/system/Button as the sole Button; ui/button.tsx deleted"
provides:
  - "docs/architecture/design-system.md documents DataTable + corrected Atoms/Molecules rows"
  - "docs/TOPIC-MAP.md indexes design-system.md (fixed pre-existing docs.md-rule violation)"
  - ".claude/rules/architecture-boundaries.md links design-system.md from Where to Look"
  - "Phase gate evidence: full suite green, apps/web tsc at 9-error pre-existing baseline, lint clean"
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - docs/architecture/design-system.md
    - docs/TOPIC-MAP.md
    - .claude/rules/architecture-boundaries.md
    - apps/web/src/components/system/DataTable.test.tsx

key-decisions:
  - "DataTable documented as its own '## DataTable' section (not folded into 'Rules for screens') matching the doc's existing pattern of one section per concern (Layers/Tokens/Rules/Reference)"
  - "Fixed 2 pre-existing 'as Element' lint violations in DataTable.test.tsx (Plan 01 artifact, never lint-checked until this phase-gate run) using the codebase's existing assertDefined(@morai/shared) narrowing pattern rather than leaving lint red"

requirements-completed: []

coverage:
  - id: D1
    description: "design-system.md documents DataTable as a system-layer molecule; Atoms row no longer lists Button (ui/button.tsx deleted, system/Button sole)"
    verification:
      - kind: other
        ref: "rg -n \"DataTable\" docs/architecture/design-system.md (5 matches); rg -n \"Atoms\" docs/architecture/design-system.md (no Button)"
        status: pass
    human_judgment: false
  - id: D2
    description: "docs/TOPIC-MAP.md's Architecture table has a row for design-system.md"
    verification:
      - kind: other
        ref: "rg -n \"design-system.md\" docs/TOPIC-MAP.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "architecture-boundaries.md's Where to Look links docs/architecture/design-system.md"
    verification:
      - kind: other
        ref: "rg -n \"design-system\" .claude/rules/architecture-boundaries.md"
        status: pass
    human_judgment: false
  - id: D4
    description: "Phase gate: full web suite green, apps/web tsc at pre-existing baseline, lint clean"
    verification:
      - kind: unit
        ref: "bun run test (293 test files passed, 3389 tests passed, 32 skipped — testcontainers-dependent, no Docker in this environment)"
        status: pass
      - kind: other
        ref: "cd apps/web && bunx tsc --noEmit (9 distinct pre-existing errors: GexBars x2, PayoffChart x1, ErrorBoundary x2, parsed-calendar x1, Overview.test x1, Overview.tsx x1, system/Button.tsx x1 — matches the phase's documented baseline exactly)"
        status: pass
      - kind: other
        ref: "cd apps/web && bunx eslint . (0 problems after DataTable.test.tsx fix)"
        status: pass
  - id: D5
    description: "Dual-viewport visual parity (1512x860, 2056x1329) — Overview + Analyzer, no page scroll, indistinguishable table chrome"
    verification: []
    human_judgment: true
    rationale: "Orchestrator-owned per this plan's execution notes — the dual-viewport visual parity check is a browser-driven check (chrome-devtools) to be run by the orchestrator after deploy, not by this sequential executor. Deferred, not attempted."
  - id: D6
    description: "Dialog focus-return smoke test (carried over from Plan 04, also gated on browser access)"
    verification: []
    human_judgment: true
    rationale: "Orchestrator-owned per this plan's execution notes, same as D5. Plan 04's code-trace evidence (base-ui DialogClose/useRenderElement source + the existing production-proven DialogTrigger+Button pattern) still stands; only the literal click-through remains open."

duration: 20min
completed: 2026-07-16
status: complete
---

# Phase 42 Plan 05: Design-System Docs + Phase Gate Summary

**Updated `docs/architecture/design-system.md` to document DataTable as a system-layer molecule and drop the now-deleted `ui/button.tsx` from the Atoms example list, indexed it in TOPIC-MAP.md (a pre-existing docs.md-rule violation), linked it from architecture-boundaries.md, and ran the phase gate: full suite green (3389 tests), apps/web tsc at the 9-error pre-existing baseline, lint clean (after fixing 2 stray `as Element` assertions the gate surfaced in Plan 01's test file).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-16
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments

- `docs/architecture/design-system.md`: Molecules row now lists `DataTable, Button`; Atoms row no longer names `Button` (it lived at `ui/button.tsx`, deleted in Plan 04); added a `## DataTable` section describing the column-def primitive (`{ key, header, align?, mono?, sortable?, width?, render(row) }`, caller-owned sort/selection, `renderRowDetail`/`footer` slots), citing `index.css @theme` + `components/system` as the source — no hex restated.
- `docs/TOPIC-MAP.md`: added the missing Architecture-table row for `design-system.md` (it existed on disk since before this phase but was never indexed — a pre-existing `docs.md` cross-reference violation, fixed regardless of the button/table work per the plan's Pitfall 1 note).
- `.claude/rules/architecture-boundaries.md`: added a Where-to-Look link to `docs/architecture/design-system.md` (the rule governing `apps/web` component layering).
- Phase gate run: `bun run test` → 293 test files passed, 3389 tests passed, 32 skipped (testcontainers-dependent, no Docker runtime in this environment — pre-existing, unrelated to this phase). `cd apps/web && bunx tsc --noEmit` → 9 distinct errors, matching the phase's documented pre-existing baseline verbatim (GexBars×2, PayoffChart×1, ErrorBoundary×2, `parsed-calendar-to-candidate.ts`×1, `Overview.test.tsx`×1, `Overview.tsx`×1, `system/Button.tsx`×1). `cd apps/web && bunx eslint .` → 0 problems (after the DataTable.test.tsx fix below).

## Task Commits

Each task was committed atomically:

1. **Task 1: update design-system.md + TOPIC-MAP row + rule Where-to-Look** - `f53c4f0` (docs)
2. **Task 2 (deviation, Rule 1): fix pre-existing lint violations surfaced by the phase gate** - `36affb5` (fix)

_Task 2's own action produces no file changes (it is the verification gate); the lint-fix commit above is the one production-adjacent change it triggered._

## Files Created/Modified

- `docs/architecture/design-system.md` - Molecules row gains DataTable/Button, Atoms row drops Button, new `## DataTable` section
- `docs/TOPIC-MAP.md` - new Architecture-table row for design-system.md
- `.claude/rules/architecture-boundaries.md` - new Where-to-Look link
- `apps/web/src/components/system/DataTable.test.tsx` - 2 `as Element` assertions replaced with `assertDefined()` narrowing

## Decisions Made

- Documented DataTable as its own `## DataTable` section rather than folding it into "Rules for screens" — matches the doc's existing one-section-per-concern structure (Layers / Tokens / Rules / Reference).
- Fixed the 2 pre-existing `as Element` lint violations in `DataTable.test.tsx` (a Plan 01 artifact — `bunx eslint .` across the full `apps/web` tree had never been run until this phase-gate task) rather than deferring them: the plan's own Task 2 acceptance criteria require lint clean, `typescript.md` forbids `as` with no exception, and the fix is a 2-line, test-only, zero-behavior-change swap to the `assertDefined()` pattern already used identically in `CotCard.test.tsx`/`RegimeBoard.test.tsx`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 2 pre-existing `as Element` type assertions in DataTable.test.tsx**
- **Found during:** Task 2 (phase-gate lint run)
- **Issue:** `bunx eslint .` on the full `apps/web` tree (never run against this file before) surfaced 2 `@typescript-eslint/consistent-type-assertions` errors at lines 131 and 146 — `screen.getAllByRole("columnheader")[1] as Element` — a direct violation of `typescript.md`'s "no `as`" rule, shipped in Plan 01 and undetected since (that plan verified targeted files, not the whole-tree lint).
- **Fix:** Replaced both `as Element` casts with `assertDefined(header, "...")` from `@morai/shared`, matching the exact pattern already used in `CotCard.test.tsx` and `RegimeBoard.test.tsx` for the same "possibly-undefined array index, need a narrowed non-null value" shape.
- **Files modified:** apps/web/src/components/system/DataTable.test.tsx
- **Verification:** `bunx eslint src/components/system/DataTable.test.tsx` → 0 problems; `bunx vitest run src/components/system/DataTable.test.tsx` → 13/13 passing (same as before the fix); full `bunx eslint .` → 0 problems; full `bun run test` re-run → still 293 test files / 3389 tests passing.
- **Committed in:** `36affb5`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary to satisfy this plan's own Task 2 acceptance criteria ("lint clean"). Zero behavior change, test-file-only, no scope creep beyond the 2 flagged lines.

## Issues Encountered

None beyond the lint deviation above. `bun run test`'s Docker-unavailable warnings (`[globalSetup] Docker error: Could not find a working container runtime strategy`) are environment-level (no local Docker daemon), pre-existing, and correctly degrade to skipped testcontainers-dependent tests rather than failures — not a regression introduced by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 42's Migration Manifest is complete: DataTable primitive (01) → CandidateTable wrapper (02) → Overview PositionsTable migration (03) → Button consolidation (04) → docs + phase gate (05, this plan).
- `docs/architecture/design-system.md` now reflects the shipped one-DataTable / one-Button reality and is cross-referenced per `docs.md`.
- Full suite green, tsc at documented baseline, lint clean — all machine-checkable gates pass.
- **Open, orchestrator-owned:** the dual-viewport visual parity check (1512×860 / 2056×1329, Overview + Analyzer, no page scroll, indistinguishable table chrome) and the Plan 04 dialog focus-return smoke test both require a browser (chrome-devtools MCP), which this sequential executor does not have in-session per this plan's execution notes. Both are flagged `human_judgment: true` in the coverage block above — hand off to `/gsd-verify-work 42` or an orchestrator pass with browser tooling before closing the phase.

---
*Phase: 42-design-system-consolidation-one-reusable-component-system-fo*
*Completed: 2026-07-16*

## Self-Check: PASSED
All modified/created files confirmed present on disk; commit hashes f53c4f0, 36affb5, c368c24 confirmed in git log.
