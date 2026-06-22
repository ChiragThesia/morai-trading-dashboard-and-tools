---
phase: 05-jobs-fill-rebuild-integrity
plan: 12
subsystem: adapters
tags: [fills-repo, data-path, testcontainers, hexagonal-boundary, occ-symbol, idempotency, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: "data-path port contracts declared in 05-09 (ForWritingFills, ForRecomputingCalendarAmounts, ForReadingUnprocessedFillsForCalendar) + brokerage transactions adapter (Phase 04)"
provides:
  - "A1: Postgres fills repo (readUnprocessedFills +ForCalendar, readCalendarLegs, reset/recomputeCalendarAmounts, writeFills) — SQL contract-tested under testcontainers"
  - "A1: in-memory fills twin mirroring every port with Maps + seed helpers"
  - "A3: ForRecomputingCalendarAmounts derives open_net_debit/close_net_credit from calendar_events"
  - "A4: makeSyncTransactionsUseCase maps BrokerTransaction legs → RawFill rows, idempotent on deterministic UUID fill ids"
  - "05-09 data-path ports barreled through core (journal/index + index)"
affects: [05-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Calendar legs are derived (formatOccSymbol over strike/expiry/optionType), not stored — leg matching computes the two OCC symbols per calendar and filters in TS, mirroring getOpenCalendarLegs"
    - "Documented unprocessed-fills exclusion rule: a fill is processed iff parked in orphan_fills; calendar_events idempotency (fill_ids_hash UNIQUE) absorbs re-emission"
    - "Deterministic UUID fill id: sha256(activityId:legIndex) hex formatted into canonical 8-4-4-4-12 UUID (v5 nibble) → re-run = no dup rows, valid uuid PK"
    - "Cross-context import through the brokerage APPLICATION port boundary (journal use-case imports brokerage/application/ports.ts), permitted by architecture §7"

key-files:
  created:
    - packages/adapters/src/__contract__/fills.contract.ts
    - packages/adapters/src/postgres/repos/fills.ts
    - packages/adapters/src/postgres/repos/fills.contract.test.ts
    - packages/adapters/src/memory/fills.ts
    - packages/adapters/src/memory/fills.contract.test.ts
    - packages/core/src/journal/application/syncTransactions.ts
    - packages/core/src/journal/application/syncTransactions.test.ts
    - .planning/phases/05-jobs-fill-rebuild-integrity/05-12-SUMMARY.md
  modified:
    - packages/adapters/src/index.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "Unprocessed = NOT in orphan_fills. calendar_events stores only fill_ids_hash (not per-fill ids) so fills cannot be joined to events by id; the calendar_events UNIQUE constraint makes re-emission a no-op, so the orphan-only exclusion is correct and simplest (plan-authorized)."
  - "Deterministic fill ids are UUID-shaped (fills.id is a uuid PK): hash (activityId, legIndex) with the injected sha256 hasher and format the hex into a canonical UUID. Random ids would break re-run idempotency; raw 'activityId:legIndex' strings would violate the uuid column."
  - "side derives from positionEffect (OPENING→buy, CLOSING→sell). UNKNOWN-effect legs are dropped at the source (no authoritative side); genuine misses are parked as orphans downstream by sync-fills."
  - "recomputeCalendarAmounts: open_net_debit = sum of positive net_amounts; close_net_credit = absolute sum of negative net_amounts (D-08 sign convention)."
  - "Memory twin defines its own seed-input types (MemorySeedCalendar/Event/Orphan) rather than importing from __contract__ — production code must not depend on test-only modules (mirrors the orphan-fills twin)."

patterns-established:
  - "Shared __contract__ suite run against both the Postgres adapter (testcontainers) and the in-memory twin guarantees behavioral parity (architecture-boundaries §8)."

requirements-completed: [JRNL-01]

# Metrics
duration: ~10min
completed: 2026-06-22
status: complete
---

# Phase 5 Plan 12: Fills data-path repo + sync-transactions source Summary

**Built the real fills data path so SC4/SC5 are verifiable against actual fills, not stubs: a SQL-contract-tested Postgres fills repo (A1) with calendar-amounts recompute (A3), an in-memory twin with behavioral parity, and an idempotent sync-transactions source (A4) that flattens Schwab BrokerTransaction legs into the fills table.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-06-22
- **Tasks:** 2 completed (both TDD red→green)
- **Files created:** 8 · **modified:** 3

## What Was Built

### Task 1 — A1 fills repo + A3 recompute amounts (commit 7253fa6)

- **`__contract__/fills.contract.ts`** — shared suite (`runFillsContractTests`) covering writeFills
  idempotency, the orphan-exclusion unprocessed rule (all + calendar-scoped), readCalendarLegs
  (open→OPENING, closed→CLOSING, foreign symbol → empty), resetCalendarAmounts, and
  recomputeCalendarAmounts (non-null totals summed from events + per-calendar scoping).
- **`postgres/repos/fills.ts`** — `makePostgresFillsRepo`: all six ports, every method wrapped in
  the StorageError try/catch pattern. Leg matching reuses the `formatOccSymbol` derivation from
  `getOpenCalendarLegs` (calendars.ts). recomputeCalendarAmounts sums calendar_events.net_amount by
  sign into open_net_debit / close_net_credit (A3 / WR-08).
- **`postgres/repos/fills.contract.test.ts`** — testcontainers harness (inject dbUrl, skipIf no
  Docker, TRUNCATE fills/calendar_events/orphan_fills/calendars between tests).
- **`memory/fills.ts`** — `makeMemoryFillsRepo`: Maps + seed helpers, mirrors every port with the
  same leg-derivation logic. **`memory/fills.contract.test.ts`** runs the same suite.
- Exported postgres + memory repos from `packages/adapters/src/index.ts`.

RED: both contract files failed (repos absent). GREEN: 34/34 contract tests pass (Postgres via
testcontainers + memory twin).

### Task 2 — A4 sync-transactions fills source (commit 5f33b63)

- **`journal/application/syncTransactions.ts`** — `makeSyncTransactionsUseCase(deps)`: fetches the
  window's BrokerTransaction[], flattens each tx's OPENING/CLOSING legs into RawFill rows, writes via
  ForWritingFills (idempotent). Deterministic UUID fill ids from (activityId, legIndex) via the
  injected sha256 hasher → re-running the same window adds zero rows. AUTH_EXPIRED → ok(undefined)
  (degrade); transient FetchError → retryable err (pg-boss retries).
- **`syncTransactions.test.ts`** — proves leg flattening (occSymbol/qty/price/side), UUID-shaped
  ids, second-run idempotency (3 fills, then 0 new), AUTH_EXPIRED no-write, FetchError → err.
- Exported from journal + core barrels.

RED: test failed (use-case absent). GREEN: 5/5 pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Barreled the 05-09 data-path ports through core**
- **Found during:** Task 1 (typecheck)
- **Issue:** 05-09 declared `ForReadingUnprocessedFillsForCalendar`, `ForRecomputingCalendarAmounts`,
  and `ForWritingFills` in `journal/application/ports.ts` but never re-exported them through
  `journal/index.ts` / `core/index.ts`. The adapters could not import them from `@morai/core`.
- **Fix:** Added the three type exports to both barrels. No new types — only surfacing existing
  05-09 contract.
- **Files modified:** packages/core/src/journal/index.ts, packages/core/src/index.ts
- **Commit:** 7253fa6

**2. [Rule 3 - Blocking] Memory twin must not import from __contract__**
- **Found during:** Task 1 (typecheck — TS6307: __contract__ is excluded from the adapters tsconfig)
- **Issue:** the in-memory twin (production code) initially imported its seed-input types from the
  test-only `__contract__/fills.contract.ts`, which is excluded from the build and would couple
  production code to test code.
- **Fix:** defined standalone `MemorySeedCalendar/Event/Orphan` types in `memory/fills.ts` (mirrors
  the orphan-fills twin). The shared contract test passes structurally-compatible objects.
- **Files modified:** packages/adapters/src/memory/fills.ts
- **Commit:** 7253fa6

**3. [Rule 1 - Bug] Cross-context import + forbidden type assertions in syncTransactions (Task 2)**
- **Found during:** Task 2 (typecheck + lint)
- **Issue:** (a) `syncTransactions.ts` imported `BrokerTransaction`/`ForFetchingTransactions` from
  the journal `./ports.ts`, where they do not live; (b) the test imported types from `@morai/core`
  (a self-reference that breaks the core build) and used `as OccSymbol` casts (typescript rule:
  no `as`).
- **Fix:** import the brokerage types from `../../brokerage/application/ports.ts` (architecture §7,
  matching the plan's key_links); switch the test to relative imports and construct OCC symbols via
  `formatOccSymbol` instead of casts.
- **Files modified:** packages/core/src/journal/application/syncTransactions.ts, syncTransactions.test.ts
- **Commit:** 5f33b63

### Environment note (not a code change)

A stale `dist/` build state produced transient TS5055 "would overwrite input file" errors from
`tsc --build --force`. Cleared the untracked (gitignored) `dist/` directories; typecheck then ran
clean. No source change required.

## Authentication Gates

None.

## Verification

- `cd packages/adapters && bunx vitest run fills.contract` — 34/34 pass (Postgres testcontainers + memory twin).
- `bunx vitest run syncTransactions` — 5/5 pass.
- `bun run test` (full workspace) — 80 files, 744 tests pass.
- `bun run typecheck` — exits 0.
- `bun run lint` — exits 0 (pre-existing boundaries v6 migration warnings only).
- `rg -c "ForReadingCalendarLegs" packages/adapters/src/postgres/repos/fills.ts` → ≥ 1.
- `rg -c "ForFetchingTransactions" packages/core/src/journal/application/syncTransactions.ts` → ≥ 1.

## Self-Check: PASSED
