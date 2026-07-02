---
phase: 14-fred-expansion
plan: 03
subsystem: macro-data
tags: [fred, cboe, vvix, postgres, drizzle, testcontainers, msw, macro, hexagonal-adapters]

# Dependency graph
requires:
  - phase: 14-fred-expansion
    provides: "MacroObservationRow domain type + ForFetchingFredSeries/ForFetchingVvixQuote/ForPersistingMacroObservation/ForReadingMacroObservations ports (14-01); live macro_observations table (14-02)"
provides:
  - "makeFredSeriesAdapter — parameterized, no-fallback, raw-value FRED series adapter (MAC-01)"
  - "makeCboeVvixAdapter — VVIX index-level quote adapter implementing ForFetchingVvixQuote (MAC-01, D-15)"
  - "makePostgresMacroObservationsRepo + makeMemoryMacroObservationsRepo — idempotent upsert on (date, series_id), one shared contract suite"
  - "runMacroObservationsContractTests shared contract-test suite"
affects: [14-04-usecases, 14-05-job, 14-06-route-mcp]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared low-level fetch/parse/'.'-filter helper extracted from an existing lenient-fallback adapter, exposing a second no-fallback factory parameterized by seriesId"
    - "onConflictDoUpdate on a composite (date, series_id) PK for last-write-wins upsert idempotency, mirrored 1:1 in the in-memory twin via Map replace-by-key"
    - "z.string() (not enum) DB column with a narrow-at-read ternary instead of an `as` cast, honoring typescript.md no-as rule for a text-typed provenance column"

key-files:
  created:
    - packages/adapters/src/http/cboe-vvix.ts
    - packages/adapters/src/http/cboe-vvix.test.ts
    - packages/adapters/src/postgres/repos/macro-observations.ts
    - packages/adapters/src/postgres/repos/macro-observations.contract.test.ts
    - packages/adapters/src/memory/macro-observations.ts
    - packages/adapters/src/memory/macro-observations.contract.test.ts
    - packages/adapters/src/__contract__/macro-observations.contract.ts
  modified:
    - packages/adapters/src/http/fred.ts
    - packages/adapters/src/http/fred.test.ts
    - packages/adapters/src/index.ts

key-decisions:
  - "Shared FRED fetch helper returns a discriminated ok/reason result (not Result<T,E>) internally — makeFredRateAdapter maps it to its fallback branch, makeFredSeriesAdapter maps it to err(); keeps both factories' distinct failure semantics (D-02 fallback vs D-09 no-fallback) without duplicating URL-build/fetch/parse/filter logic"
  - "CBOE VVIX Zod schema kept adapter-local (not in packages/contracts) per the plan's read_first guidance — mirrors cboe.ts's own local schema convention"
  - "Postgres repo maps the plain-text `source` column to the 'fred'|'cboe' union via a ternary narrow at read time (no `as` cast) since the schema column is text, not a pgEnum"

patterns-established:
  - "Parameterized-adapter-with-shared-helper pattern (RESEARCH Pattern 1) now has two live instances in this codebase (fred.ts here, existing cboe.ts precedent) — future series/quote adapters needing both lenient and strict variants can follow the same extraction shape"

requirements-completed: [MAC-01]

coverage:
  - id: D1
    description: "makeFredSeriesAdapter fetches a series by id, filters '.' rows, returns the raw value with NO /100 division, and returns err (no fabricated fallback) on missing key / network / all-'.' rows (D-09/D-14); makeFredRateAdapter (DGS3MO) unchanged (D-02)"
    requirement: MAC-01
    verification:
      - kind: unit
        ref: "packages/adapters/src/http/fred.test.ts (17 tests: 8 pre-existing makeFredRateAdapter regression + 9 new makeFredSeriesAdapter)"
        status: pass
      - kind: other
        ref: "rg -n 'makeFredSeriesAdapter' packages/adapters/src/http/fred.ts"
        status: pass
      - kind: other
        ref: "bun run typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "makeCboeVvixAdapter parses _VVIX.json, resolves current_price ?? close ?? prev_day_close, derives the date from the UTC timestamp (not last_trade_time), and returns seriesId VVIX / source cboe"
    requirement: MAC-01
    verification:
      - kind: unit
        ref: "packages/adapters/src/http/cboe-vvix.test.ts (9 tests: raw-value, spot fallthrough, null/0-spot->err, non-2xx/network/parse->err, UTC-date derivation vs last_trade_time)"
        status: pass
      - kind: other
        ref: "rg -n '_VVIX.json' packages/adapters/src/http/cboe-vvix.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "macro_observations repo (Postgres + in-memory) upserts on (date, series_id) so a second same-key write revises the value, reads back all rows across multiple series, and one shared contract suite passes against both implementations"
    requirement: MAC-01
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/macro-observations.contract.test.ts (testcontainers, real Postgres)"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/macro-observations.contract.test.ts"
        status: pass
      - kind: other
        ref: "rg -n 'onConflictDoUpdate' packages/adapters/src/postgres/repos/macro-observations.ts"
        status: pass
      - kind: other
        ref: "rg -n 'makePostgresMacroObservationsRepo|makeMemoryMacroObservationsRepo' packages/adapters/src/index.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 03: Macro Adapters (FRED series, CBOE VVIX, macro_observations repo) Summary

**Parameterized no-fallback FRED series adapter, CBOE VVIX quote adapter, and a macro_observations Postgres/memory repo pair sharing one idempotent-upsert contract suite — full TDD RED->GREEN across three tasks.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-02T02:05:00Z (approx)
- **Completed:** 2026-07-02T02:12:30Z
- **Tasks:** 3 completed
- **Files modified:** 10 (7 created, 3 modified)

## Accomplishments

- Extracted a shared low-level FRED fetch/parse/`.`-filter helper out of the existing
  `makeFredRateAdapter`, then added `makeFredSeriesAdapter(seriesId)` — a parameterized,
  no-fallback factory that returns the RAW source value (no `/100`, D-14) and hard-fails
  on a missing/empty API key (D-09), never fabricating a value. `makeFredRateAdapter`
  (DGS3MO, silent 4.5% fallback, `/100` decimal) is behaviorally unchanged (D-02) — its
  full 17-test regression suite (8 original + 9 new) is green.
- Added `makeCboeVvixAdapter` implementing `ForFetchingVvixQuote`: parses
  `_VVIX.json` (D-15), resolves the spot via the same `current_price ?? close ??
  prev_day_close` fallthrough as the existing SPX chain adapter, and derives the `date`
  column from the top-level UTC `timestamp` — explicitly NOT from the unverified
  `last_trade_time` field (Pitfall 6, covered by a dedicated regression test).
- Added the `macro_observations` Postgres repo (`onConflictDoUpdate` on the composite
  `(date, series_id)` PK — last-write-wins, D-05) and its in-memory twin (Map keyed by
  `date|seriesId`, replace-on-conflict), both proven against one shared
  `runMacroObservationsContractTests` suite covering round-trip persist, upsert-revises,
  multi-series read, and the empty-store case.
- Wired all four new factories into the `packages/adapters/src/index.ts` barrel exactly
  once (`makeFredSeriesAdapter`, `makeCboeVvixAdapter`,
  `makePostgresMacroObservationsRepo`, `makeMemoryMacroObservationsRepo`).

## Task Commits

Each task followed the full TDD RED->GREEN cycle (no REFACTOR commits needed — each
implementation was already minimal at GREEN):

1. **Task 1: FRED series adapter (parameterized, no-fallback, raw value)**
   - RED: `ba3cf17` (test) — `bun run test -- packages/adapters/src/http/fred.test.ts` failed (`makeFredSeriesAdapter is not a function`)
   - GREEN: `262dda3` (feat) — 17/17 tests pass
2. **Task 2: CBOE VVIX quote adapter**
   - RED: `83cc89c` (test) — module-not-found failure (`./cboe-vvix.ts` did not exist)
   - GREEN: `0e2a8ac` (feat) — 9/9 tests pass (fixed a `??`-vs-explicit-null test-fixture bug along the way)
3. **Task 3: macro_observations Postgres repo + in-memory twin + shared contract suite**
   - RED: `87c577c` (test) — both contract runners failed (`./macro-observations.ts` did not exist)
   - GREEN: `daa0530` (feat) — 8/8 contract tests pass (4 Postgres via testcontainers + 4 memory)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/adapters/src/http/fred.ts` - extracted shared fetch helper; added `makeFredSeriesAdapter`
- `packages/adapters/src/http/fred.test.ts` - added 9 tests for `makeFredSeriesAdapter`
- `packages/adapters/src/http/cboe-vvix.ts` - new `makeCboeVvixAdapter`
- `packages/adapters/src/http/cboe-vvix.test.ts` - 9 tests covering spot fallthrough, error paths, UTC-date derivation
- `packages/adapters/src/postgres/repos/macro-observations.ts` - `makePostgresMacroObservationsRepo`
- `packages/adapters/src/postgres/repos/macro-observations.contract.test.ts` - testcontainers runner
- `packages/adapters/src/memory/macro-observations.ts` - `makeMemoryMacroObservationsRepo`
- `packages/adapters/src/memory/macro-observations.contract.test.ts` - memory runner
- `packages/adapters/src/__contract__/macro-observations.contract.ts` - shared contract suite
- `packages/adapters/src/index.ts` - barrel exports for all four new factories

## Decisions Made

- Shared FRED fetch helper returns a lightweight internal discriminated result
  (`{ ok: true; date; value } | { ok: false; reason }`) rather than `Result<T,E>` —
  each public factory maps it to its own failure semantics (fallback vs `err`) without
  either factory duplicating URL-build/fetch/parse/`.`-filter logic.
- Kept the CBOE VVIX Zod schema adapter-local (not in `packages/contracts`), mirroring
  `cboe.ts`'s own local-schema convention per the plan's `read_first` guidance.
- Mapped the Postgres `source` text column to the `'fred' | 'cboe'` union via a ternary
  narrow at read time instead of an `as` cast, since the schema column is plain `text`
  (not a `pgEnum`) — satisfies the no-`as` rule in `typescript.md`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Fixed a test-fixture bug in `cboe-vvix.test.ts`: the `vvixResponse` helper used the
  `??` operator for optional overrides, which falls through an explicitly-passed `null`
  to the default value instead of preserving it — three "spot fallthrough" tests
  reported the wrong resolved spot as a result. Fixed with an `"key" in overrides ?
  overrides.key : default` check per field before implementing `makeCboeVvixAdapter`,
  confirmed the corrected fixtures still drove the adapter through the intended
  fallthrough/null-spot paths.

## User Setup Required

None - no external service configuration required in this plan (FRED_API_KEY prod
operator step remains tracked at phase level for the job-wiring plan, per D-13).

## Next Phase Readiness

- `makeFredSeriesAdapter`, `makeCboeVvixAdapter`,
  `ForPersistingMacroObservation`/`ForReadingMacroObservations` implementations are all
  stable for 14-04 (`fetchMacroSeries`/`getMacro` use-cases) to inject directly.
- No blockers. `rate_observations`/`readRate`/BSM path untouched (D-02, verified — no
  edits to `rate-observations.ts` or `fred.ts`'s `makeFredRateAdapter` behavior; its
  full pre-existing test suite stays green).
- Full `packages/adapters` suite (53 files / 463 tests) green; `bun run typecheck` and
  `bun run lint` clean.

## Self-Check: PASSED

- All 10 created/modified files verified present on disk.
- All 6 task commit hashes (`ba3cf17`, `262dda3`, `83cc89c`, `0e2a8ac`, `87c577c`,
  `daa0530`) verified in `git log`.
- Re-ran plan-level `<verification>`: `bun run test -- packages/adapters/src/http/fred.test.ts packages/adapters/src/http/cboe-vvix.test.ts` (26/26 pass), `bun run test -- --project packages/adapters macro-observations` (8/8 pass), `bun run typecheck` (clean), `bun run lint` (clean, only pre-existing boundaries-plugin warnings).

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*
