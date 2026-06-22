---
phase: 05-jobs-fill-rebuild-integrity
plan: 11
subsystem: api
tags: [fill-pairing, realized-pnl, orphan-fills, hexagonal-boundary, calendar-scoped-sync, tdd]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: "fill-pairing domain + data-path port contracts (NewId, HashFillIds, ForReadingUnprocessedFillsForCalendar, ForReadingCalendarEvents) — plan 05-09"
provides:
  - "syncFills realizedPnl reads the prior OPEN event's netAmount as originalOpenDebit (B1/WR-01); null when no prior OPEN"
  - "ROLL realizedPnl reflects only the closed leg; the new leg's debit is cost basis, not subtracted"
  - "UNKNOWN aggregates park EACH raw fill individually with real side/filledAt/UUID; error instead of synthesizing a non-UUID PK (B5/WR-07)"
  - "Pure core: syncFills imports no node crypto — ids/hashes via injected deps.newId / deps.hashFillIds (C1)"
  - "makeSyncFillsForCalendarUseCase + ForRunningSyncFillsForCalendar — calendar-scoped sync re-pairs ONLY the target calendar (A2/CR-04)"
  - "hashFillIds reference algorithm exported from the core barrel for composition-root wiring"
affects: [05-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared pairing pipeline (pairFills) consumed by both full-sweep and calendar-scoped factories — one pipeline, two fills sources"
    - "Per-calendar prior-events cache keeps the originalOpenDebit lookup to one read per calendar"
    - "Composition root supplies node:crypto uuid/sha256 to the injected NewId/HashFillIds ports; core stays pure"

key-files:
  created:
    - .planning/phases/05-jobs-fill-rebuild-integrity/05-11-SUMMARY.md
  modified:
    - packages/core/src/journal/application/syncFills.ts
    - packages/core/src/journal/application/syncFills.test.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - apps/worker/src/main.ts

key-decisions:
  - "originalOpenDebit = the prior OPEN event's netAmount for the same (calendarId, legOccSymbol); realizedPnl null when absent (locked decision 2 / WR-01)"
  - "ROLL realizedPnl computed on the closed leg only; new leg debit excluded (locked decision 2)"
  - "UNKNOWN aggregate with zero underlying fills returns StorageError rather than fabricating a PK (WR-07)"
  - "Extracted a shared pairFills pipeline so the scoped and full-sweep use-cases share identical pairing logic (no duplication, no scope drift)"
  - "hashFillIds reference algorithm exported from the barrel so composition roots inject the sha256 hex; core imports no crypto builtin (C1)"
  - "Worker rebuildJournal.syncFillsForCalendar rewired to the scoped use-case (was a full sweep discarding calendarId) — CR-04 closed in the composition root, real fills reader stubbed pending 05-13"

requirements-completed: [JRNL-01]

# Metrics
duration: ~30min
completed: 2026-06-21
status: complete
---

# Phase 5 Plan 11: Sync-fills use-case correction (B1/B5/C1/A2) Summary

**Rewired the sync-fills use-case onto 05-09's corrected domain and injected ports: realized P&L now reads the prior OPEN event's debit (null over a wrong number), UNKNOWN aggregates park every raw fill individually with real audit fields and real UUIDs, the core imports no node crypto, and a new calendar-scoped sync re-pairs exactly one calendar so rebuild's delete scope and sync scope agree.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2 completed
- **Files modified:** 5

## What Was Built

### Task 1 — B1 realized-P&L lookup + C1 injected id/hasher + B5 orphan parking (commit 2a02b31)

- **B1 (WR-01):** `SyncFillsDeps` gains `readCalendarEvents`. A per-calendar prior-events cache
  (`originalOpenDebitFor`) finds the OPEN event matching the closed leg's `legOccSymbol`; its
  `netAmount` is the `originalOpenDebit`. On CLOSE and ROLL, `realizedPnl = computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose)`; when no prior OPEN exists `realizedPnl = null`.
  ROLL realized P&L is computed on the closed (old) leg only — the new leg's debit stays in
  `netAmount`/cost basis, never subtracted.
- **C1 (CR-01):** removed `import { createHash, randomUUID } from "crypto"` and the local
  `sha256Hex` helper. `SyncFillsDeps` gains `newId: NewId` and `hashFillIds: HashFillIds`; all
  `randomUUID()` → `deps.newId()`, all `hashFillIds(ids, sha256Hex)` → `deps.hashFillIds(ids)`.
  The core file now imports no node crypto builtin.
- **B5 (WR-07):** the UNKNOWN branch loops the aggregate's underlying raw fills (carried on
  `ClassifiedFill.rawFills`) and parks each individually with its real `side`, `filledAt`, and
  real UUID — no `agg-unknown-${orderId}` synthesis, no dropped siblings. A malformed aggregate
  with zero fills returns `StorageError` rather than fabricating a PK.
- **Composition root (Rule 3):** the worker's `makeSyncFillsUseCase(...)` now supplies the new
  required deps — `readCalendarEvents` from the real postgres calendar-events repo, and
  `newId`/`hashFillIds` built from `node:crypto` (`randomUUID` + a sha256 hasher wrapping the
  exported `hashFillIds` reference algorithm). `hashFillIds` is re-exported from the core barrels.

TDD: extended `syncFills.test.ts` with four cases — CLOSE after a seeded prior OPEN
(`realizedPnl = 500 − 300 − 2 = 198`), CLOSE with no prior OPEN (`null`), ROLL excluding the new
leg's debit (`198`), and a 2-fill UNKNOWN aggregate → 2 orphan rows with real side/filledAt/UUID.
Confirmed RED (3 failures for the right reasons), implemented GREEN (11/11).

### Task 2 — A2 calendar-scoped sync variant (CR-04) (commit d03cad1)

- Extracted the pairing pipeline into a shared `pairFills(deps, fills)` function. `makeSyncFillsUseCase`
  reads all unprocessed fills then calls it; the new `makeSyncFillsForCalendarUseCase` reads via
  `readUnprocessedFillsForCalendar(calendarId)` then calls the same pipeline — identical pairing
  logic, two fills sources, no scope drift.
- Exported `makeSyncFillsForCalendarUseCase` and the `ForRunningSyncFillsForCalendar` driver type
  (`(calendarId: string) => Promise<Result<void, StorageError>>`) from both barrels for 05-13.
- Rewired the worker's `rebuildJournal.syncFillsForCalendar` to the scoped use-case (previously
  `async (_calendarId) => syncFillsUseCase()`, a full sweep discarding the calendarId). The scoped
  reader is stubbed (empty) pending the fills repo (05-13), so rebuild remains a safe no-op until
  then but the wiring is now correct by construction.

TDD: added a `makeSyncFillsForCalendarUseCase` test with fills spanning calendars A and B; the
scoped sync for A emits only A's event and never touches B. Confirmed RED (factory absent), GREEN (12/12).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Threaded the new required deps through the worker composition root**
- **Found during:** Task 1 (GREEN) — adding required fields to `SyncFillsDeps` broke
  `apps/worker/src/main.ts` typecheck (`makeSyncFillsUseCase(...)` missing `readCalendarEvents`,
  `newId`, `hashFillIds`).
- **Fix:** supplied the three deps at the composition root (real `calendarEventsRepo.readCalendarEvents`;
  `node:crypto` uuid/sha256 for the injected ports). Pure wiring — TDD-exempt per tdd.md Scope. Real
  fills-reader wire-up remains 05-13's scope.
- **Files modified:** apps/worker/src/main.ts, packages/core/src/journal/index.ts, packages/core/src/index.ts
- **Commit:** 2a02b31

**2. [Rule 3 - Blocking] Exported hashFillIds from the core barrels**
- **Found during:** Task 1 (GREEN) — the composition root needs the reference hash algorithm to
  wire the injected `HashFillIds` port, but it was not on the public surface.
- **Fix:** re-exported `hashFillIds` from `journal/index.ts` and `core/src/index.ts`. Minimal,
  justified surface addition for C1 wiring.
- **Commit:** 2a02b31

**3. [Rule 3 - Blocking] Rewired worker rebuildJournal to the scoped sync**
- **Found during:** Task 2 (GREEN) — closing CR-04 in core is meaningless if the only consumer
  (the worker composition root) still passes the full-sweep sync as `syncFillsForCalendar`.
- **Fix:** built a `makeSyncFillsForCalendarUseCase` instance (scoped reader stubbed pending the
  fills repo) and passed it as `rebuildJournal.syncFillsForCalendar`; updated the stale wiring
  comment. CR-04 now closed end-to-end at the boundary it was reported against.
- **Files modified:** apps/worker/src/main.ts
- **Commit:** d03cad1

## Known Stubs

The worker's calendar-scoped reader `readUnprocessedFillsForCalendar` (and the full-sweep
`readUnprocessedFills` / `readCalendarLegs`) remain empty stubs in the composition root. This is
the existing, documented pending-fills-repo state inherited from prior plans — the real fills repo
wiring is plan 05-13's scope. The use-case layer this plan owns is complete and fully tested via
in-memory twins; the stub only makes the worker's sync a no-op until the fills table is populated.

## Verification

- `bunx vitest run syncFills` — 12/12 pass (RED 3 failures → GREEN; Task 2 RED 1 → GREEN).
- `bun run test` (full workspace) — 77 files, 715 tests pass.
- `bun run typecheck` — exits 0.
- `bun run lint` — exits 0 (pre-existing boundaries v6 migration warnings only).
- `grep -v '^ *\*' packages/core/src/journal/application/syncFills.ts | grep -c 'from "crypto"|node:crypto'` → 0.
- `rg "readCalendarEvents" packages/core/src/journal/application/syncFills.ts` → matches (B1 lookup wired).

## Self-Check: PASSED
