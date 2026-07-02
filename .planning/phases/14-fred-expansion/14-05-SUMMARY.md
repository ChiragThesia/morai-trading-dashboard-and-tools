---
phase: 14-fred-expansion
plan: 05
subsystem: macro-data
tags: [worker, pg-boss, fred, cboe, vvix, macro, cron, composition-root, tdd]

# Dependency graph
requires:
  - phase: 14-fred-expansion
    provides: "makeFredSeriesAdapter/makeCboeVvixAdapter/makePostgresMacroObservationsRepo (14-03); makeFetchMacroSeries/ForRunningFetchMacroSeries (14-04)"
provides:
  - "fetch-rates worker job runs the macro fetch additively (MAC-01 scheduled ingestion)"
  - "fetch-rates twice-daily cron (09:00 ET + 18:30 ET, Mon-Fri, D-06)"
  - "worker composition root wires the FRED-series adapter, VVIX adapter, macro repo, and fetchMacroSeries use-case"
affects: [14-06-route-mcp]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin job handler extended with a second additive use-case call sharing the same holiday gate — same array-guard/gate/use-case/throw-on-err shape as the original single-use-case handler"
    - "Single pg-boss queue served by two schedule() cron registrations (no new queue/handler) for a twice-daily cadence"

key-files:
  created:
    - apps/worker/src/handlers/fetch-rates.test.ts
  modified:
    - apps/worker/src/handlers/fetch-rates.ts
    - apps/worker/src/schedule.ts
    - apps/worker/src/schedule.test.ts
    - apps/worker/src/main.ts

key-decisions:
  - "FetchMacroSeriesUseCase local type mirrors FetchRateUseCase's existing local shape ({ ok, error? }) rather than importing ForRunningFetchMacroSeries directly — keeps the handler decoupled from @morai/core's Result<T,E> type, matching the plan's explicit instruction and the file's pre-existing convention"
  - "Second fetch-rates schedule() call reuses the same queue and handler — no new queue, no new job name; twice-daily cadence is purely a scheduling change"
  - "Macro adapters/repo/use-case wired directly after the existing fredAdapter/fetchRateUseCase block in main.ts, with a comment marking the boundary — keeps the D-02 diff auditable (git diff shows zero deletions in main.ts)"

patterns-established: []

requirements-completed: [MAC-01]

coverage:
  - id: D1
    description: "fetch-rates handler calls fetchRateUseCase AND fetchMacroSeriesUseCase on a normal weekday, throws on macro Result err (D-07) with the rate path unchanged (D-02 regression), and skips BOTH use-cases on an NYSE holiday"
    requirement: MAC-01
    verification:
      - kind: unit
        ref: "apps/worker/src/handlers/fetch-rates.test.ts (5 tests: both-called, macro-err->throw, rate-err->throw regression, holiday->skip-both, array-guard)"
        status: pass
      - kind: other
        ref: "rg -n 'fetchMacroSeriesUseCase' apps/worker/src/handlers/fetch-rates.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "fetch-rates is scheduled TWICE daily (09:00 ET + 18:30 ET, Mon-Fri, D-06) — single queue, two cron registrations, no other job's schedule changed"
    requirement: MAC-01
    verification:
      - kind: unit
        ref: "apps/worker/src/schedule.test.ts (13 tests, 2 new: 7-schedule-calls count, fetch-rates-scheduled-twice with both crons + tz)"
        status: pass
      - kind: other
        ref: "rg -n '30 18 \\* \\* 1-5' apps/worker/src/schedule.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Worker composition root wires makeFredSeriesAdapter + makeCboeVvixAdapter + makePostgresMacroObservationsRepo + makeFetchMacroSeries and injects fetchMacroSeriesUseCase into makeFetchRatesHandler; existing makeFredRateAdapter/makeFetchRateUseCase wiring is untouched (D-02, pure wiring, TDD-exempt per architecture-boundaries.md §6)"
    requirement: MAC-01
    verification:
      - kind: other
        ref: "rg -n 'makeFredSeriesAdapter|makeCboeVvixAdapter|makePostgresMacroObservationsRepo|makeFetchMacroSeries' apps/worker/src/main.ts"
        status: pass
      - kind: other
        ref: "bun run typecheck"
        status: pass
      - kind: integration
        ref: "bun run test -- --project apps/worker (76/76 tests, whole worker suite)"
        status: pass
      - kind: other
        ref: "git diff apps/worker/src/main.ts shows zero deletions (D-02 verified)"
        status: pass
    human_judgment: true
    rationale: "The macro fetch's live behavior against real FRED/CBOE endpoints can only be confirmed once FRED_API_KEY is set in prod (D-13, tracked in 14-USER-SETUP.md) — the wiring itself is proven correct by typecheck + rg + the full suite, but end-to-end live-fetch verification is an operator-gated UAT step, not something this plan's automated checks can prove."

# Metrics
duration: 20min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 05: Worker Job Wiring (fetch-rates macro fetch + twice-daily cron) Summary

**Extended the fetch-rates pg-boss handler to run the macro fetch additively alongside the unchanged rate fetch, scheduled it twice daily (09:00 + 18:30 ET), and wired the FRED-series/VVIX adapters + macro repo + fetchMacroSeries use-case into the worker composition root.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-02T21:26:00Z (approx)
- **Completed:** 2026-07-02T21:46:00Z (approx)
- **Tasks:** 3 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- Extended `makeFetchRatesHandler`: after the existing (byte-for-byte unchanged, D-02)
  `fetchRateUseCase()` call, the handler now calls `fetchMacroSeriesUseCase()`. A macro
  `Result` err throws so pg-boss marks the job failed and `/api/status` surfaces
  `lastErr` (D-07 — no silent holes). The same NYSE-holiday gate covers both calls
  (D-06's cadence stays Mon-Fri only) and the pg-boss v12 array-guard is preserved.
  Full TDD RED->GREEN, with a rate-err regression test proving the original path is
  untouched.
- Added a second `fetch-rates` cron (`30 18 * * 1-5`, `America/New_York`) alongside the
  existing `0 9 * * 1-5` run (D-06) — same queue, same handler, no new job. The morning
  run catches SOFR's T+1 publication lag; the evening run catches same-day
  VIXCLS/treasury prints. `schedule.test.ts` now asserts both crons explicitly and the
  total scheduled-call count (6→7).
- Wired the worker composition root (`apps/worker/src/main.ts`, pure wiring, TDD-exempt
  per architecture-boundaries.md §6): `makeFredSeriesAdapter` (parameterized FRED
  adapter reading `config.FRED_API_KEY`), `makeCboeVvixAdapter` (reusing the existing
  `USER_AGENT` constant), `makePostgresMacroObservationsRepo`, and `makeFetchMacroSeries`
  (relying on its default 7-series id list) — then injected the resulting
  `fetchMacroSeriesUseCase` into the existing `makeFetchRatesHandler` call. The
  `git diff` on `main.ts` shows zero deletions — the existing `makeFredRateAdapter` +
  `makeFetchRateUseCase` wiring is provably untouched.

## Task Commits

Each TDD task followed the full RED->GREEN cycle (no REFACTOR commits needed — each
implementation was already minimal at GREEN); Task 3 is pure wiring (TDD-exempt, single
commit):

1. **Task 1: extend fetch-rates handler to run the macro fetch**
   - RED: `2035aaa` (test) — `bun run test -- --project apps/worker fetch-rates` failed (2/5, macro use-case not wired)
   - GREEN: `3d56fec` (feat) — 5/5 tests pass
2. **Task 2: schedule fetch-rates twice daily (D-06)**
   - RED: `1507217` (test) — `bun run test -- --project apps/worker schedule` failed (2/13, second cron missing)
   - GREEN: `7dc9c8c` (feat) — 13/13 tests pass
3. **Task 3: worker composition wiring (FRED-series + VVIX adapters + macro repo + use-case)**
   - `ed22737` (feat) — `bun run typecheck` clean; `bun run test -- --project apps/worker` 76/76 pass

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `apps/worker/src/handlers/fetch-rates.test.ts` - new: 5 tests covering both-called, macro-err, rate-err regression, holiday gate, array-guard
- `apps/worker/src/handlers/fetch-rates.ts` - extended `FetchRatesHandlerDeps` + handler body to call `fetchMacroSeriesUseCase` additively
- `apps/worker/src/schedule.ts` - added the second `fetch-rates` cron (`30 18 * * 1-5`, D-06); updated header/count comments
- `apps/worker/src/schedule.test.ts` - asserts both fetch-rates crons + updated total schedule-call count (6→7)
- `apps/worker/src/main.ts` - composed `makeFredSeriesAdapter`/`makeCboeVvixAdapter`/`makePostgresMacroObservationsRepo`/`makeFetchMacroSeries`, injected `fetchMacroSeriesUseCase` into `makeFetchRatesHandler`

## Decisions Made

- `FetchMacroSeriesUseCase`'s local type in `fetch-rates.ts` mirrors `FetchRateUseCase`'s
  existing `{ ok, error? }` shape rather than importing `ForRunningFetchMacroSeries`
  directly — keeps the handler decoupled from `@morai/core`'s `Result<T,E>` type,
  matching both the plan's explicit instruction and the file's pre-existing convention.
- The second `fetch-rates` `schedule()` call reuses the same queue and handler — no new
  queue, no new job name. The twice-daily cadence is purely a scheduling addition.
- Macro adapters/repo/use-case are wired directly after the existing
  `fredAdapter`/`fetchRateUseCase` block in `main.ts` with a comment marking the
  boundary, keeping the D-02 diff auditable — `git diff apps/worker/src/main.ts` shows
  zero deletions.

## Deviations from Plan

None - plan executed exactly as written. `fetch-rates.test.ts` did not exist yet on
disk (the plan's `<read_first>` described it as an existing file to extend); it was
created fresh in Task 1's RED phase, following the same array-guard/holiday/use-case
test structure the plan referenced.

## Issues Encountered

None.

## User Setup Required

**External service requires manual configuration.** See
[14-USER-SETUP.md](./14-USER-SETUP.md) for:
- `FRED_API_KEY` — set on the Railway `WORKER` service and in local `.env` (D-13).
  Unlike the existing DGS3MO→BSM fallback path (unchanged), the new macro fetch
  hard-requires this key (D-09) — until it's set, every `fetch-rates` run throws on
  the macro call and pg-boss marks the job failed. This is expected, tracked, and does
  not block build/test/typecheck (carried forward from STATE.md Blockers/Concerns).

## Next Phase Readiness

- `fetch-rates` now runs the macro fetch on the twice-daily cron; worker composition is
  fully wired. 14-06 (route + MCP `get_macro` contract exposure) can proceed
  independently — it only needs `makeGetMacroUseCase` (already shipped in 14-04), not
  anything from this plan.
- No blockers to further plan execution. `rate_observations`/`readRate`/BSM path stays
  untouched (D-02, verified via zero-deletion diff on `main.ts` and the rate-err
  regression test in `fetch-rates.test.ts`).
- Full `apps/worker` suite (13 files / 76 tests) green; `bun run typecheck` and
  `bun run lint` clean (only pre-existing boundaries-plugin legacy-selector warnings,
  unrelated to this plan).
- Carried blocker (STATE.md, unchanged by this plan): `FRED_API_KEY` still unset in prod
  — must be set (14-USER-SETUP.md) before the live-fetch UAT in `/gsd-verify-work`.

## Self-Check: PASSED

- All 5 created/modified files verified present on disk.
- All 5 task commit hashes (`2035aaa`, `3d56fec`, `1507217`, `7dc9c8c`, `ed22737`)
  verified in `git log`.
- Re-ran plan-level `<verification>`: `bun run test -- --project apps/worker` (76/76
  pass), `bun run typecheck` (clean), `bun run lint` (clean, only pre-existing
  boundaries-plugin warnings).

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*
