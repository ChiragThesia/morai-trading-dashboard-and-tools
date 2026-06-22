---
phase: 06-derived-analytics
plan: 01
subsystem: analytics
tags: [drizzle, zod, postgres, hexagonal, mcp, tdd, skew, term-structure, risk-reversal]

# Dependency graph
requires:
  - phase: 03-calendar-journal-mvp
    provides: calendar_snapshots (term_slope, front_iv, back_iv) + leg_observations (bsm_iv, delta) — the analytics read sources
  - phase: 05-jobs-fill-rebuild-integrity
    provides: chain-trigger job pattern (compute-bsm-greeks → snapshot-calendars) + TRACKED_JOBS status surface
provides:
  - three analytics observation tables in schema.ts (skew_observations, risk_reversal_observations, term_structure_observations) with per-grain UNIQUE keys
  - ONE shared @morai/contracts analytics schema set (skew/risk-reversal/term-structure) for HTTP + MCP parity (MCP-02)
  - analytics bounded-context skeleton in packages/core (application/ports.ts + index.ts), hexagon-pure
  - eight ForVerbingNoun analytics ports declared (read smile/snapshots/history/series + write three tables)
  - three RED test scaffolds (interpolateRiskReversal, percentileRank, makeComputeAnalyticsUseCase) for downstream plans to turn green
  - architecture docs (data-model, jobs, hexagonal-ddd, api-design) describing the locked Phase 6 design
affects: [06-02 migration, 06-03 domain math, 06-04 term-structure slice, 06-05 skew/RR slice]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Foundation plan ships docs-first + schema + ONE shared contract + ports + RED scaffolds (no production logic)"
    - "RED scaffolds committed intentionally failing on unresolved SUT import; later plans turn them green"
    - "Shared StorageError shape per context defined locally (not re-exported through core barrel) to avoid duplicate-export collision with journal"

key-files:
  created:
    - packages/contracts/src/analytics.ts
    - packages/contracts/src/analytics.test.ts
    - packages/core/src/analytics/application/ports.ts
    - packages/core/src/analytics/index.ts
    - packages/core/src/analytics/domain/risk-reversal.test.ts
    - packages/core/src/analytics/domain/percentile-rank.test.ts
    - packages/core/src/analytics/application/computeAnalytics.test.ts
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/contracts/src/index.ts
    - packages/contracts/src/journal.test.ts
    - packages/core/src/index.ts
    - docs/architecture/data-model.md
    - docs/architecture/jobs.md
    - docs/architecture/hexagonal-ddd.md
    - docs/architecture/api-design.md

key-decisions:
  - "skew_observations PK (snapshot_time, underlying, expiration, strike); risk_reversal_observations PK (snapshot_time, underlying, expiration); term_structure_observations PK (snapshot_time, calendar_id) — each composite PK doubles as the per-grain UNIQUE idempotency key"
  - "Analytics StorageError defined locally in analytics/application/ports.ts (same shape as journal), NOT re-exported through the core barrel — re-exporting would duplicate the journal StorageError export and fail typecheck"
  - "Old typed-empty analytics contract ({ observations: [] }) fully replaced with array response schemas; the stale assertions in journal.test.ts moved to a dedicated analytics.test.ts with the new array shape"
  - "Analytics response schemas are bare z.array(entry) so .parse([]) is the contract-valid empty-array no-data case (SPEC R5), not a wrapper object"

patterns-established:
  - "Per-context StorageError local definition for hexagon-purity when the shared name already lives in another context's barrel"
  - "Contract test asserts both valid-entry parse and empty-array acceptance to lock MCP-02 + no-data-not-error in one file"

requirements-completed: [ANLY-01, ANLY-02, ANLY-03, MCP-02]

# Metrics
duration: 12min
completed: 2026-06-22
status: complete
---

# Phase 6 Plan 1: Derived Analytics Foundation Summary

**Docs-first analytics foundation: three idempotent observation tables (skew/risk-reversal/term-structure), ONE shared Zod contract for HTTP+MCP parity (MCP-02), a hexagon-pure analytics bounded context with eight ports, and three RED test scaffolds for downstream slices.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-22T15:52:53Z
- **Completed:** 2026-06-22T16:05:00Z
- **Tasks:** 3
- **Files modified:** 15 (7 created, 8 modified)

## Accomplishments
- Four architecture docs now describe the locked Phase 6 design BEFORE any code (CLAUDE.md rule #4): the three analytics tables with UNIQUE grains and the two invariants, the chain-triggered idempotent `compute-analytics` job, the `analytics` per-context directory shape + cross-context rule, and the two GET routes with the empty-array-not-error rule + MCP-02 note.
- `schema.ts` gains `skewObservations`, `riskReversalObservations`, `termStructureObservations` — each append-only, time-leading, `.enableRLS()`, with a composite PK that is the per-grain idempotency key; nullable `riskReversal`/`rrRank`. No migration generated (06-02 owns it).
- ONE shared `@morai/contracts` analytics schema set (`skewEntry`/`riskReversalEntry`/`termStructureEntry` + array responses, `z.infer` types) — the single source both the HTTP routes and MCP tools will import. The Phase-3 typed-empty stubs were removed.
- The `analytics` bounded context exists: `application/ports.ts` (imports only `@morai/shared`) declares the row domain types and all eight `ForVerbingNoun` ports; `index.ts` + the core barrel re-export the surface.
- Three RED scaffolds run and fail for the right reason (unresolved SUT import): `interpolateRiskReversal`, `percentileRank`, `makeComputeAnalyticsUseCase`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — four architecture docs** - `c3ef139` (docs)
2. **Task 2: schema.ts — three analytics tables** - `ce9de2c` (feat)
3. **Task 3: shared contract + ports + RED scaffolds** - `bc995c4` (feat, tdd foundation)

**Plan metadata:** (final docs commit — SUMMARY/STATE/ROADMAP/REQUIREMENTS)

_Note: Task 3 is a TDD foundation commit — GREEN contract tests + production-clean ports + intentionally-RED domain/use-case scaffolds in one commit per the plan._

## Files Created/Modified
- `packages/contracts/src/analytics.ts` - skew/risk-reversal/term-structure Zod entry + array response schemas (MCP-02 single source)
- `packages/contracts/src/analytics.test.ts` - 10 GREEN tests: valid-entry parse + empty-array accepted
- `packages/contracts/src/index.ts` - barrel re-exports the six analytics schemas + types (replaced typed-empty line)
- `packages/contracts/src/journal.test.ts` - removed stale `{ observations: [] }` analytics assertions
- `packages/core/src/analytics/application/ports.ts` - row domain types + 8 ports; imports only `@morai/shared`
- `packages/core/src/analytics/index.ts` - analytics context public surface
- `packages/core/src/index.ts` - core barrel re-exports analytics surface (StorageError intentionally not re-exported)
- `packages/core/src/analytics/domain/risk-reversal.test.ts` - RED scaffold for `interpolateRiskReversal`
- `packages/core/src/analytics/domain/percentile-rank.test.ts` - RED scaffold for `percentileRank`
- `packages/core/src/analytics/application/computeAnalytics.test.ts` - RED scaffold for `makeComputeAnalyticsUseCase`
- `packages/adapters/src/postgres/schema.ts` - three analytics tables
- `docs/architecture/{data-model,jobs,hexagonal-ddd,api-design}.md` - locked Phase 6 design

## Decisions Made
- **Local analytics `StorageError`** (same shape as journal) defined in `analytics/application/ports.ts` and NOT re-exported through the core barrel — re-exporting collides with the existing journal `StorageError` export (duplicate-export typecheck failure). Documented inline in the barrel.
- **Bare array response schemas** (`z.array(entry)`) so `.parse([])` is the contract-valid no-data case (SPEC R5), rather than a `{ observations: [] }` wrapper.
- **Replaced, not extended, the typed-empty stubs** — the plan explicitly removes them; the stale `journal.test.ts` assertions for the old shape were relocated to a dedicated `analytics.test.ts` with the new array shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale analytics contract tests broke on the new array shape**
- **Found during:** Task 3 (contract replacement)
- **Issue:** `packages/contracts/src/journal.test.ts` asserted the OLD typed-empty shape `termStructureResponse.parse({ observations: [] })`. Replacing the contract with array schemas (the plan's explicit goal) makes those assertions fail.
- **Fix:** Removed the stale analytics `describe` blocks (and the now-unused import) from `journal.test.ts`; created `analytics.test.ts` with the new array-shape assertions (valid entry + empty array).
- **Files modified:** packages/contracts/src/journal.test.ts, packages/contracts/src/analytics.test.ts
- **Verification:** `journal.test.ts` 9/9 GREEN; `analytics.test.ts` 10/10 GREEN.
- **Committed in:** bc995c4 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — stale-test reconciliation required by the planned contract replacement)
**Impact on plan:** Necessary to keep the suite consistent with the planned contract change. No scope creep — the analytics surface is exactly as specified.

## Issues Encountered
- **data-model.md exceeded the 250-line docs limit.** The new analytics block pushed the file to 262 lines (CLAUDE.md/docs.md hard cap is 250). Tightened the analytics prose (intro, per-table descriptions, rr_rank paragraph, invariants collapsed to a compact two-sentence block) down to 249 lines while preserving all required content (three tables, UNIQUE grains, both invariants).
- **Out-of-scope tooling noise (deferred, NOT fixed):** ~45 untracked `* 2.ts` cloud-sync duplicate files across `packages/`/`apps/` pollute both `bun run typecheck` and `bun run lint`. A pre-existing `orphan-fills.contract.ts(128) TS2454 'seed' used before assigned` (Phase 5) also remains. Both verified independent of 06-01 and logged in `.planning/phases/06-derived-analytics/deferred-items.md`. 06-01's own files are typecheck-clean and lint-clean.

## Verification Status
- **Production code typecheck:** CLEAN (zero errors in non-test files attributable to 06-01).
- **RED scaffolds:** the only 06-01 typecheck failures are the three intended `TS2307 Cannot find module './risk-reversal.ts' | './percentile-rank.ts' | './computeAnalytics.ts'` — the not-yet-implemented SUTs. They RUN and FAIL for the right reason (unresolved SUT import), not syntax.
- **Contract tests:** analytics.test.ts 10/10 GREEN; journal.test.ts 9/9 GREEN.
- **Lint:** no errors in 06-01 files (all 15 reported problems are in untracked `* 2.ts` artifacts).
- **Docs gate:** DOCS_OK (all three table names + term_slope + compute-analytics + empty-array rule present).

## Known Stubs
The three RED scaffolds intentionally reference not-yet-implemented functions — this is the documented foundation pattern, not an accidental stub:
- `packages/core/src/analytics/domain/risk-reversal.ts` (`interpolateRiskReversal`) — implemented by 06-03.
- `packages/core/src/analytics/domain/percentile-rank.ts` (`percentileRank`) — implemented by 06-03.
- `packages/core/src/analytics/application/computeAnalytics.ts` (`makeComputeAnalyticsUseCase`) — implemented by 06-04 (term-structure half) / 06-05 (skew/RR half).
The contract's typed-empty stubs are GONE — replaced with real array schemas.

## Next Phase Readiness
- 06-02 (migration) can run `drizzle generate` against the three new tables and apply `0007_analytics_observations.sql`.
- 06-03 (domain) turns the two domain RED scaffolds green (interpolation + percentile rank).
- 06-04/06-05 implement the use-cases (turning the computeAnalytics scaffold green), the Postgres + memory adapters for the eight ports, the routes, and the MCP tools — all over the shared contract.
- Out-of-scope blockers: stray `* 2.ts` cleanup and the pre-existing orphan-fills typecheck error (deferred-items.md) — neither blocks downstream analytics plans.

## Self-Check: PASSED

All 7 created files + SUMMARY.md exist on disk; all three task commits (c3ef139, ce9de2c, bc995c4) exist in git history; all three analytics table names present in schema.ts.

---
*Phase: 06-derived-analytics*
*Completed: 2026-06-22*
