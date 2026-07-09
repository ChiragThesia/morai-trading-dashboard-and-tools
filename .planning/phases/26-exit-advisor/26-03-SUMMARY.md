---
phase: 26-exit-advisor
plan: 03
subsystem: database
tags: [drizzle, postgres, zod, testcontainers, journal, exits, tdd]

requires:
  - phase: 26-exit-advisor plan 01
    provides: exits/application/ports.ts driven-port TYPE declarations (ExitVerdictRow, ForPersistingExitVerdict, ForReadingLatestVerdictsPerCalendar, ForReadingLatestSnapshotPerOpenCalendar exits-owned re-declaration) and contracts/src/exits.ts (exitMetric, exitVerdictEnum, exitRollDetail)
provides:
  - Migration 0020_exit_verdicts.sql — append-only exit_verdicts table, composite PK (observed_at, calendar_id)
  - packages/contracts/src/exits.ts exitVerdict Zod schema (the persisted verdict blob, distinct from heldPositionVerdict the API response row)
  - journal/application/ports.ts ForReadingLatestSnapshotPerOpenCalendar (SnapshotRow-shaped, aliased ForReadingLatestSnapshotPerOpenCalendarForJournal at the core barrel)
  - Postgres + memory repos for both new ports, exported from the packages/adapters barrel
affects: [26-exit-advisor plan 04 (computeExitAdvice use-case wires these ports)]

tech-stack:
  added: []
  patterns:
    - "DISTINCT ON (col) ORDER BY col, time DESC for latest-per-group reads (mirrors picker-chain.ts / gex-snapshot.repo.ts)"
    - "onConflictDoNothing composite-PK idempotency for append-only per-cohort-per-entity tables (mirrors picker_snapshot/calendar_snapshots)"
    - "seedRawVerdict test-only backdoor on the memory twin so a shared contract test can exercise 'corrupted stored row' identically on both Postgres (raw SQL bypass) and memory (no SQL layer to bypass)"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0020_exit_verdicts.sql
    - packages/adapters/src/postgres/repos/exit-verdicts.ts
    - packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts
    - packages/adapters/src/memory/exit-verdicts.ts
    - packages/adapters/src/memory/exit-verdicts.contract.test.ts
    - packages/adapters/src/__contract__/exit-verdicts.contract.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
    - packages/adapters/src/memory/calendar-snapshots.contract.test.ts
    - packages/adapters/src/postgres/schema.ts
    - packages/contracts/src/exits.ts
    - packages/contracts/src/index.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "journal's own ForReadingLatestSnapshotPerOpenCalendar (SnapshotRow-shaped) collides by name with exits' own re-declaration (LatestSnapshotForCalendar-shaped, from 26-01) at the core barrel — aliased journal's export to ForReadingLatestSnapshotPerOpenCalendarForJournal, since exits already claimed the bare name first"
  - "exitVerdict.ruleId gets a .min(1) Zod constraint (EXIT-04: every verdict must name its firing rule) — this is what makes a genuine TS-legal-but-Zod-illegal write-rejection test possible without violating the no-`as`-assertions rule (typescript.md)"
  - "exit_verdicts.calendar_id has no FK — mirrors calendar_snapshots.calendar_id, the existing codebase convention of never FK-ing the calendars table (see D24 note in schema.ts)"
  - "memory twin's readLatestSnapshotPerOpenCalendar does not model closed-calendar exclusion (the memory calendar-snapshots repo has no status concept at all, only 'known' ids) — every seedCalendar-registered id is treated as open, matching the Postgres seed helper which always inserts status='open'; parity holds at the level the shared contract actually exercises"

requirements-completed: [EXIT-01, EXIT-02]

coverage:
  - id: D1
    description: "Journal exposes a NEW latest-snapshot-per-open-calendar read (DISTINCT ON, no source filter) that does not drop schwab_chain-sourced rows — the RESEARCH Pitfall 1 regression, proven on both Postgres and the memory twin"
    requirement: "EXIT-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts — readLatestSnapshotPerOpenCalendar Pitfall-1 regression"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/calendar-snapshots.contract.test.ts — readLatestSnapshotPerOpenCalendar Pitfall-1 regression"
        status: pass
    human_judgment: false
  - id: D2
    description: "exit_verdicts persists append-only, keyed (observed_at, calendar_id), onConflictDoNothing — a second write for the same cohort+calendar with a different blob never overwrites the first (WR-01/T-26-07)"
    requirement: "EXIT-01"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts — WR-01 dual-write no-overwrite"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/exit-verdicts.contract.test.ts — WR-01 dual-write no-overwrite"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every exit_verdicts blob is Zod-parsed on BOTH write and read — a corrupted stored row surfaces a StorageError, never a silently-invalid shape (T-26-08)"
    requirement: "EXIT-01"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts — corrupted-row-on-read + empty-ruleId write rejection"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/exit-verdicts.contract.test.ts — corrupted-row-on-read + empty-ruleId write rejection"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Postgres repo and its memory twin pass the SAME shared contract suite for both new ports (architecture rule 8)"
    verification:
      - kind: unit
        ref: "bun run test — full suite 2454/2454 passing"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-09
status: complete
---

# Phase 26 Plan 03: Exit-Advisor Persistence Layer Summary

**Migration 0020 + exit_verdicts Postgres/memory repos (composite-PK idempotency, Zod-guarded both ways) and a journal-owned latest-snapshot-per-open-calendar read that never drops schwab_chain rows.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 (each RED→GREEN)
- **Files modified/created:** 22 (see key-files above)

## Accomplishments

- `ForReadingLatestSnapshotPerOpenCalendar` on `journal/application/ports.ts`, implemented via a fresh `DISTINCT ON (calendar_id) ... WHERE calendars.status='open'` query on both Postgres and memory — proven (contract regression test) to return a calendar's latest row even when its source is `schwab_chain`, the exact bug `readJournal`/`mapSnapshotRow` has (RESEARCH Pitfall 1). `readJournal`/`mapSnapshotRow` themselves are untouched — out of scope per the plan.
- Migration `0020_exit_verdicts.sql` (generated via `drizzle-kit generate`, verified byte-identical to the hand-authored expectation): append-only `exit_verdicts` table, composite PK `(observed_at, calendar_id)`, no FK on `calendar_id` (matches the codebase's existing calendar_snapshots convention).
- `packages/contracts/src/exits.ts` gains `exitVerdict` — the Zod schema for the persisted verdict blob (`ExitVerdict` domain shape: verdict/rung/ruleId/metric/indicative/escalate/roll), distinct from `heldPositionVerdict` (the API response row assembled at read time in 26-04, carrying calendarId/name/changed/pnlPct/basis on top).
- `makePostgresExitVerdictsRepo` + `makeMemoryExitVerdictsRepo`: `insertExitVerdict` validates via `exitVerdict.parse` before writing and uses `onConflictDoNothing` on the composite PK (first-write-wins, WR-01); `readLatestVerdictsPerCalendar` does `DISTINCT ON (calendar_id)` (Postgres) / max-by-observedAt (memory) and re-validates each stored blob via `exitVerdict.parse` on read, mapping a parse failure to `StorageError`.
- Both new repo pairs exported from the `packages/adapters` barrel (`packages/adapters/src/index.ts`), matching every other repo in the codebase.
- Full suite: 2454/2454 passing (up from the pre-phase baseline of 2383 — 71 net new tests across this plan). `bun run typecheck` and `bun run lint` both clean.

## Task Commits

Each task followed RED→GREEN (TDD rule: commit at green only, plus the RED commit convention this orchestrator's TDD flow calls for):

1. **Task 1: Journal latest-snapshot-per-open-calendar port**
   - `bb06243` — test(26-03): RED — journal latest-snapshot-per-open-calendar port
   - `cb99a54` — feat(26-03): journal latest-snapshot-per-open-calendar read (Postgres + memory)
2. **Task 2: exit_verdicts migration + Postgres repo + memory twin + shared contract**
   - `dce4830` — test(26-03): RED — exit_verdicts migration 0020 + shared repo contract
   - `730deed` — feat(26-03): exit_verdicts Postgres repo + memory twin (idempotent, Zod-guarded)

_No separate "plan metadata" commit exists per this project's `commit_docs` setting — see State Updates below._

## Files Created/Modified

- `packages/adapters/src/postgres/migrations/0020_exit_verdicts.sql` - append-only exit_verdicts table, composite PK
- `packages/adapters/src/postgres/schema.ts` - exitVerdicts pgTable definition
- `packages/adapters/src/postgres/repos/exit-verdicts.ts` - Postgres repo (insert + latest-per-calendar read, Zod both ways)
- `packages/adapters/src/memory/exit-verdicts.ts` - in-memory twin + seedRawVerdict test backdoor
- `packages/adapters/src/__contract__/exit-verdicts.contract.ts` - shared contract suite (round-trip, WR-01, latest-per-calendar, corrupted-row, empty-ruleId rejection)
- `packages/adapters/src/postgres/repos/exit-verdicts.contract.test.ts` - testcontainers wiring + Postgres-specific idempotency-by-count test
- `packages/adapters/src/memory/exit-verdicts.contract.test.ts` - memory twin wiring
- `packages/contracts/src/exits.ts` - exitVerdict Zod schema (+ ruleId.min(1) constraint)
- `packages/contracts/src/index.ts` - export exitVerdict/ExitVerdictBlob
- `packages/core/src/journal/application/ports.ts` - LatestSnapshotForOpenCalendar + ForReadingLatestSnapshotPerOpenCalendar
- `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` - barrel exports (aliased at the top-level core barrel)
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` - readLatestSnapshotPerOpenCalendar (DISTINCT ON, no source filter, joined to open calendars)
- `packages/adapters/src/memory/calendar-snapshots.ts` - twin implementation
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` - Pitfall-1 regression test added to the shared suite
- `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts`, `packages/adapters/src/memory/calendar-snapshots.contract.test.ts` - wire the new port into both test files
- `packages/adapters/src/index.ts` - export the exit-verdicts repo pair

## Decisions Made

- **Name-collision alias:** journal's own `ForReadingLatestSnapshotPerOpenCalendar` (SnapshotRow-shaped) and exits' pre-existing re-declaration of the same bare name (26-01, `LatestSnapshotForCalendar`-shaped) cannot both be exported bare from `packages/core/src/index.ts`. Exits claimed the bare name first (already committed in 26-01), so journal's export is aliased to `ForReadingLatestSnapshotPerOpenCalendarForJournal` at the top-level barrel only — both contexts' own `application/ports.ts` and `index.ts` keep the un-aliased name internally.
- **exitVerdict.ruleId gets `.min(1)`:** needed a genuine TS-legal/Zod-illegal case to test write-side rejection without an unsafe type assertion (forbidden by `typescript.md`). An empty ruleId is also independently justified by EXIT-04 ("every verdict names the firing rule") — not an artificial constraint invented just for test coverage.
- **No FK on exit_verdicts.calendar_id:** matches the existing `calendar_snapshots.calendar_id` convention (no FK anywhere on that column either) — this codebase's established pattern for calendar references (see the D24 note already in `schema.ts` for why annotations avoid FKs).
- **RED via module-not-found is treated as valid RED for Task 2:** the shared contract + both test files were written and run BEFORE `exit-verdicts.ts` existed on either adapter, producing "Cannot find module" rather than an assertion failure. This is the natural RED for a brand-new repo module (the test cannot even resolve the implementation that doesn't exist yet) — not a Task 1-style trailing-property miss, but genuinely failing for the intended reason (missing implementation), so it was accepted rather than manufacturing an artificial "half-wrong" stub purely to get a different failure shape.

## Deviations from Plan

None — plan executed exactly as written. Two Rule-2-adjacent additions were made proactively (not deviations from stated behavior, but required infrastructure the plan's action text implied but didn't spell out as separate files):
- `packages/contracts/src/exits.ts` `exitVerdict` schema (the plan's read_first note said "the blob schema to parse both ways" already existed in contracts — it didn't; the existing schemas there covered the API response shape, not the persisted domain blob, so this was added).
- `packages/adapters/src/index.ts` barrel exports for the new repo pair (not in `files_modified`, but every other repo in this codebase is exported from there, and 26-04 will need to import these).

## Issues Encountered

None blocking. The name-collision (see Decisions above) surfaced as a `bun run typecheck` failure immediately after wiring the adapters to the bare `ForReadingLatestSnapshotPerOpenCalendar` import — caught and fixed before any commit landed with broken types.

## User Setup Required

None — no external service configuration required. Migration 0020 has NOT been applied to prod; per the orchestrator's instructions, `bun run migrate` is the deploy step's responsibility, not this plan's. It was, however, exercised locally via testcontainers on every contract test run in this plan (proving the migration itself is correct and applies cleanly).

## Next Phase Readiness

- 26-04's `computeExitAdvice` use-case can now wire: `ForReadingLatestSnapshotPerOpenCalendar` (journal, aliased `ForReadingLatestSnapshotPerOpenCalendarForJournal` at the core barrel) to build `MarketContext`, and `ForPersistingExitVerdict` + `ForReadingLatestVerdictsPerCalendar` (exits, from `makePostgresExitVerdictsRepo`/`makeMemoryExitVerdictsRepo`) for the writer + hysteresis self-read.
- No blockers. Migration 0020 must be applied via `bun run migrate` locally before the next Railway deploy that includes 26-04+ (validates ALL worker env incl SIDECAR_URL — the known Phase 13/14 gotcha, documented in the plan's verification block).

---
*Phase: 26-exit-advisor*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 12 key files found on disk; all 4 task commits (`bb06243`, `cb99a54`, `dce4830`, `730deed`) found in git history. Full suite 2454/2454 passing, `bun run typecheck` and `bun run lint` both clean at time of writing.
