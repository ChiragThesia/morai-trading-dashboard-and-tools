---
phase: 07-trade-history
plan: 02
subsystem: jobs
tags: [backfill, chunking, fast-check, sync-transactions, idempotency, schwab, cli]

# Dependency graph
requires:
  - phase: 05-jobs (JRNL-01)
    provides: makeSyncTransactionsUseCase (deterministic fill ids), ForWritingFills, in-memory fills twin
  - phase: 04-brokerage (BRK-02)
    provides: Schwab transactions adapter, account-hash resolver, ForFetchingTransactions port
provides:
  - chunkDateRange pure domain fn (contiguous ≤maxDays windows, no gaps/overlap) exported from @morai/core
  - runBackfill orchestrator + backfill-transactions CLI driving sync-transactions per chunk
  - bun run backfill-transactions <from> <to> script in apps/worker
  - Documented Schwab lookback cap (SCHWAB_TX_LOOKBACK_MAX_DAYS = 365) + backfill in jobs.md
affects: [trade-history, fills, calendar-events, jobs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure date-window chunker in core; cap-policy (over-cap rejection) enforced by the CLI orchestrator, not the chunker — chunkDateRange stays total over any valid range"
    - "Thin CLI orchestrator (runBackfill) extracted as the testable unit; the import.meta.main entrypoint is TDD-exempt wiring guarded so the test import does not boot the CLI"
    - "Offline backfill test: faked ForFetchingTransactions records per-chunk (from,to) + in-memory fills twin asserts countFills (no live Schwab, no testcontainer)"

key-files:
  created:
    - packages/core/src/journal/application/chunkDateRange.ts
    - packages/core/src/journal/application/chunkDateRange.test.ts
    - packages/core/src/journal/application/chunkDateRange.property.test.ts
    - apps/worker/src/backfill-transactions.ts
    - apps/worker/src/backfill-transactions.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - apps/worker/package.json
    - docs/architecture/jobs.md

key-decisions:
  - "RangeError (the chunkDateRange domain error) is re-exported from the top-level core index aliased as ChunkRangeError, to avoid shadowing the global RangeError at consumers."
  - "Over-cap policy lives in the CLI orchestrator (runBackfill rejects a TOTAL span > 365d up front, writing nothing), not in chunkDateRange — keeping the chunker total over any valid range for a positive maxDays, exactly as the plan's Property D specifies."
  - "Backfill rejection (over-cap or inverted range) returns a typed BackfillError via Result and writes zero fills — no silent truncation (SPEC constraint, T-07-04/T-07-07)."
  - "Used `bun run test <pattern>` (vitest run) from repo root — apps/worker and packages/core have no per-package test script; the plan's `cd <pkg> && bun run test` form does not exist here."

patterns-established:
  - "Pure chunk math + thin loop: chunk-boundary logic in core under fast-check, the CLI only loops chunks and runs the existing use-case per window"

requirements-completed: [BRK-04]

# Metrics
duration: 7min
completed: 2026-06-23
status: complete
---

# Phase 7 Plan 02: Historical Trade-History Backfill (BRK-04) Summary

**A pure `chunkDateRange(from,to,maxDays)` domain fn (fast-check: no gaps, no overlap-dupes, each window ≤ maxDays) plus a thin `backfill-transactions` CLI that runs the existing `sync-transactions` use-case once per chunk over an operator-supplied `[from,to]` — idempotent (0 rows on re-run via deterministic fill ids), rejecting an over-cap range with a clear error instead of silently truncating.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-23T02:27:00Z
- **Completed:** 2026-06-23T02:34:00Z
- **Tasks:** 3
- **Files:** 9 (5 created, 4 modified)

## Accomplishments

- **Docs-first (Task 1):** Added a "Historical backfill (Phase 7, BRK-04)" subsection to
  `docs/architecture/jobs.md` (now 196 lines, under the 250 budget — no new doc file, so
  TOPIC-MAP unchanged). Documents: on-demand CLI (not a pg-boss job), `SCHWAB_TX_LOOKBACK_MAX_DAYS = 365`,
  chunking via `chunkDateRange`, error-on-over-cap (no silent truncation), and idempotency.
- **chunkDateRange (Task 2):** Pure core fn returning `Result<ReadonlyArray<DateWindow>, RangeError>`.
  Contiguous inclusive windows, last may be short, typed err (never throws) on `from > to` or
  `maxDays ≤ 0`. Imports only `@morai/shared`, no `node:*`. Exported from core (RangeError
  aliased ChunkRangeError on the public surface).
- **backfill CLI (Task 3):** `runBackfill` orchestrator chunks `[from,to]` and runs
  `makeSyncTransactionsUseCase` per window; rejects an over-cap total span before any write.
  Thin `import.meta.main`-guarded CLI entrypoint mirrors the worker's sync-transactions wiring
  (trader token → account-hash resolver → transactions adapter → fills repo → sha256-injected
  hashFillIds). Added `bun run backfill-transactions` to `apps/worker/package.json`.

## fast-check Results

`chunkDateRange.property.test.ts` — all properties green at **numRuns = 1000**:

- **A (no gaps):** the ordered union of all chunk day-spans equals the inclusive `[from,to]` day set.
- **B (no overlap):** every covered day is unique (pairwise-disjoint windows).
- **C (cap per window):** every window spans ≤ maxDays days inclusive.
- **C2 (contiguity):** each window's `from` = previous window's `to` + 1 day; first.from == from, last.to == to.
- **D / D2 (invalid input):** `maxDays ≤ 0` → err; inverted range (`from > to`) → err.

## Verification

| Check | Command | Result |
|---|---|---|
| chunkDateRange example + property | `bun run test chunkDateRange` | 13 passed (2 files) |
| backfill orchestrator | `bun run test backfill-transactions` | 6 passed |
| full workspace suite | `bun run test` | **968 passed (106 files)** incl. testcontainers Postgres |
| typecheck | `bun run typecheck` | clean (exit 0) |
| lint | `bun run lint` | clean (no errors; only pre-existing boundary v5→v6 migration warnings) |

Backfill tests confirm: a 90-day range chunks into 3 windows matching `chunkDateRange` output and
writes one fill per chunk; a second run adds 0 fills (idempotent); an over-cap (~731-day) range
and an inverted range both return a `backfill-error` and write nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong hasher shape in a backfill test assertion**
- **Found during:** Task 3 typecheck (caught before commit-at-green of the impl).
- **Issue:** A sanity-check test passed `testHashFillIds` (a `ReadonlyArray<string> => string`
  fn) as the second arg to `hashFillIds(ids, hasher)`, but that arg is a `string => string`
  hex hasher. `tsc` flagged TS2345.
- **Fix:** Wrapped it as `(input) => testHashFillIds([input])` to match the production wiring
  shape (the CLI passes `sha256Hex`).
- **Files modified:** `apps/worker/src/backfill-transactions.test.ts`
- **Commit:** folded into `3b010bd` (fixed before the green commit).

No other deviations — the plan executed as written.

## Authentication Gates

None. The backfill was built and tested entirely offline (faked fetch + in-memory fills twin).
A live run requires valid Schwab trader tokens (operator prerequisite, out of code scope); the
`import.meta.main`-guarded CLI entrypoint constructs only when run directly, so importing the
module (tests, typecheck) never needs runtime env.

## Known Stubs

None. No placeholder data, no hardcoded empties flowing to output. The CLI's live fetch fires
only at run time with real tokens; this is documented behavior (offline build/test by design),
not a stub.

## TDD Gate Compliance

Both behavior-adding tasks followed RED→GREEN with the RED run shown:

- Task 2: RED = both chunkDateRange test files fail with "Cannot find module './chunkDateRange.ts'";
  GREEN after implementing the fn (13 passed). Single `feat` commit `21d19e5`.
- Task 3: RED = backfill test fails with "Cannot find module './backfill-transactions.ts'";
  GREEN after implementing runBackfill + CLI (6 passed). Single `feat` commit `3b010bd`.

Note: per this repo's executor convention (Phase 3 lesson), RED and GREEN are committed together
at green rather than as separate `test`/`feat` commits — the RED run output is the gate evidence
(shown in-session), and the suite is green at every commit. Task 1 is docs (TDD-exempt).

## Self-Check: PASSED

All 5 created source/test files and the SUMMARY exist on disk; all 3 commits
(63739b8, 21d19e5, 3b010bd) present in git history.
