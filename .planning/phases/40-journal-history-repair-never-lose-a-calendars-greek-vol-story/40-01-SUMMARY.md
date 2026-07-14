---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 01
subsystem: journal
tags: [pure-domain-fn, occ-symbol, rth, dst, docs, tdd]

# Dependency graph
requires: []
provides:
  - "resolveRootCandidates(underlying: string): ReadonlyArray<'SPX' | 'SPXW'> — ordered OCC root candidates for a leg, exported via @morai/core"
  - "roundDownToRthSlot(instant: Date): Date — floors an instant to its nominal 30-min RTH slot boundary, DST-safe, exported via @morai/core"
  - "docs/architecture/jobs.md documents self-heal-journal + repair-journal-history and corrects the snapshot-calendars backfill-policy language"
affects: [40-02, 40-03, 40-04, 40-05, 40-06, 40-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DST-safe instant construction via Intl 'shortOffset' read directly from the actual instant being converted (not a guessed candidate) — proven idempotent across DST transitions by fast-check, mirrors @morai/shared/settlement-timestamp.ts's technique"
    - "Two-tier domain barrel (domain/*.ts -> journal/index.ts -> core/index.ts) confirmed as the ONLY re-export convention in this codebase — no domain/index.ts intermediate barrel exists anywhere"

key-files:
  created:
    - packages/core/src/journal/domain/occ-root.ts
    - packages/core/src/journal/domain/occ-root.test.ts
    - packages/core/src/journal/domain/rth-slot.ts
    - packages/core/src/journal/domain/rth-slot.test.ts
  modified:
    - docs/architecture/jobs.md
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "No domain/index.ts barrel created — the plan named this file, but the codebase's real, established convention re-exports domain/*.ts files directly from journal/index.ts (verified against isGapRow, computeForwardVol, isThirdFriday, etc.). Followed the real convention instead of inventing a new barrel layer."
  - "roundDownToRthSlot reads the UTC offset directly from the instant being floored (not a guessed candidate, unlike settlement-timestamp.ts's two-step guess) — simpler here because the input is already a real instant, and it makes idempotency provably correct even inside DST fall-back's doubled hour."

patterns-established:
  - "Journal-specific pure domain fns needing DST-safe instant math should copy settlement-timestamp.ts's Intl shortOffset-read technique locally (it isn't exported from @morai/shared) rather than hand-rolling calendar-based DST rules like dte.ts's private etUtcOffsetHours."

requirements-completed: [HIST-01, HIST-05]

coverage:
  - id: D1
    description: "resolveRootCandidates pure fn — ordered OCC root candidates (SPX -> [SPX,SPXW], SPXW -> [SPXW]), the one shared fix reused by all four HIST-01 root-mismatch call sites in plans 02/04"
    requirement: "HIST-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/domain/occ-root.test.ts#resolveRootCandidates"
        status: pass
    human_judgment: false
  - id: D2
    description: "roundDownToRthSlot pure fn — floors a scheduled-trigger instant to its nominal 30-min RTH slot boundary, DST-safe, idempotent; the fix plan 03/05 apply so the existing calendar_snapshots composite-PK onConflictDoNothing collapses same-slot duplicate writes"
    requirement: "HIST-05"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/domain/rth-slot.test.ts#roundDownToRthSlot"
        status: pass
    human_judgment: false
  - id: D3
    description: "docs/architecture/jobs.md documents the two new jobs this phase adds (self-heal-journal, repair-journal-history) and corrects snapshot-calendars' backfill-policy language ahead of any job code (docs-before-code, CLAUDE.md rule 4)"
    verification:
      - kind: other
        ref: "grep -q self-heal-journal / repair-journal-history / 'Historical backfill is not implemented' docs/architecture/jobs.md"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-14
status: complete
---

# Phase 40 Plan 01: Journal History Repair Foundations Summary

**Two DST-safe, fast-check-proven pure functions (resolveRootCandidates, roundDownToRthSlot) plus corrected jobs.md documentation for the two new jobs plans 02-07 will add.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-14T07:28:29Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `resolveRootCandidates("SPX")` returns `["SPX", "SPXW"]`, `resolveRootCandidates("SPXW")` returns `["SPXW"]` — the one shared fix the four HIST-01 back-leg-NaN call sites (plans 02/04) will all reuse instead of four separate copies of the `underlying === "SPXW" ? "SPXW" : "SPX"` bug.
- `roundDownToRthSlot` floors any instant to its nominal 30-min RTH slot boundary, proven idempotent by fast-check across 2024-2028 (spans multiple DST spring-forward/fall-back transitions) — the fix plan 03/05 apply so the existing `calendar_snapshots` composite-PK `onConflictDoNothing` naturally absorbs HIST-05's duplicate-row bug with zero new dedup logic.
- `docs/architecture/jobs.md` now documents `self-heal-journal` and `repair-journal-history` in the Job Catalog and no longer claims historical journal gaps are never backfilled — landed ahead of any job code per CLAUDE.md rule 4 (docs before architecture changes).

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — jobs.md Job Catalog** - `70bcab3` (docs)
2. **Task 2: resolveRootCandidates pure function** - `3d804cc` (feat, TDD red confirmed then green)
3. **Task 3: roundDownToRthSlot pure function** - `12a8586` (feat, TDD red confirmed then green)

## Files Created/Modified

- `packages/core/src/journal/domain/occ-root.ts` - `resolveRootCandidates`, pure/total, no I/O
- `packages/core/src/journal/domain/occ-root.test.ts` - example + fast-check property tests
- `packages/core/src/journal/domain/rth-slot.ts` - `roundDownToRthSlot`, DST-safe via Intl offset-read
- `packages/core/src/journal/domain/rth-slot.test.ts` - example + 2 fast-check property tests (idempotency, same-slot collapse)
- `docs/architecture/jobs.md` - Job Catalog: corrected `snapshot-calendars` row, added `self-heal-journal` + `repair-journal-history` rows
- `packages/core/src/journal/index.ts` - re-exports both new functions (direct domain re-export, existing convention)
- `packages/core/src/index.ts` - re-exports both new functions to the top-level `@morai/core` barrel

## Decisions Made

- **No `domain/index.ts` barrel created.** The plan's frontmatter named `packages/core/src/journal/domain/index.ts` as a file to modify, but no such file exists anywhere in this codebase — every existing domain function (`isGapRow`, `computeForwardVol`, `isThirdFriday`, `hashFillIds`, etc.) is re-exported directly from `packages/core/src/journal/index.ts` via a relative import, with no intermediate domain barrel. Creating one would be a new, unrequested abstraction layer inconsistent with every other domain export in the file. Followed the real, established two-tier convention (`domain/*.ts` → `journal/index.ts` → `core/index.ts`) instead.
- **`roundDownToRthSlot` reads its DST offset from the actual instant being floored**, not a guessed candidate (unlike `settlement-timestamp.ts`'s two-step guess-then-verify, which needs the guess because it's constructing an instant from scratch for an arbitrary future settlement time). Since the input here is already a real `Date`, reading its offset directly is simpler and makes idempotency correct even inside DST fall-back's doubled local hour — verified by the fast-check property across a 4-year range.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/convention mismatch] Plan named a non-existent `domain/index.ts` barrel file**
- **Found during:** Task 2 (read_first gate — reading `packages/core/src/journal/domain/index.ts` returned "File does not exist")
- **Issue:** The plan's frontmatter (`files_modified`) and both tasks' `<files>` lists named `packages/core/src/journal/domain/index.ts` as a barrel to create/modify. Grepping `packages/core/src/journal/index.ts` showed every existing domain function is re-exported directly (`export { X } from "./domain/foo.ts"`) with no intermediate domain barrel anywhere in the codebase.
- **Fix:** Exported `resolveRootCandidates` and `roundDownToRthSlot` directly from `packages/core/src/journal/index.ts` (mirroring `isGapRow`/`computeForwardVol`'s exact pattern), then re-exported both from `packages/core/src/index.ts` — the same two-tier chain every other domain function uses. No `domain/index.ts` file was created.
- **Files modified:** `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` (in place of the non-existent barrel)
- **Verification:** `bun -e` runtime import check from `packages/adapters` (a real workspace consumer) confirms both functions resolve correctly through `@morai/core`; `bun run typecheck` (whole build) and `bun run lint` (whole repo) both clean.
- **Committed in:** `3d804cc`, `12a8586` (part of each task's commit)

---

**Total deviations:** 1 auto-fixed (1 convention/reuse correction, Rule 1).
**Impact on plan:** Zero functional impact — both functions are exported and importable from `@morai/core` exactly as the plan's `key_links` required. The only change is which file carries the re-export statement, correcting the plan to match the codebase's actual, consistent convention rather than introducing a new one.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `resolveRootCandidates` and `roundDownToRthSlot` are exported through `@morai/core` and ready for plans 02 (four root-mismatch call-site fixes), 03 (snapshotCalendars.ts slot-rounding), 04, and 05 (rebuild use-case) to consume.
- `docs/architecture/jobs.md` now accurately describes the two new jobs this phase adds, satisfying docs-before-code ahead of plan 03's `self-heal-journal` implementation.
- No blockers. Ready for 40-02.

## Self-Check: PASSED

- `packages/core/src/journal/domain/occ-root.ts` — FOUND
- `packages/core/src/journal/domain/occ-root.test.ts` — FOUND
- `packages/core/src/journal/domain/rth-slot.ts` — FOUND
- `packages/core/src/journal/domain/rth-slot.test.ts` — FOUND
- Commit `70bcab3` — FOUND in `git log --oneline`
- Commit `3d804cc` — FOUND in `git log --oneline`
- Commit `12a8586` — FOUND in `git log --oneline`
- All plan-level `<verification>` commands re-run and passing (test green 10/10, typecheck clean, lint clean, both fns importable from `@morai/core`, jobs.md greps pass).

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*
