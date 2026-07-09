---
phase: 23-vix3m-ingestion
plan: 01
subsystem: macro-pipeline
tags: [macro, fred, vix3m, ingestion, tdd]
dependency-graph:
  requires: []
  provides: [VXVCLS-ingestion]
  affects: [fetchMacroSeries, macro-contracts, get_macro-mcp, GET-api-analytics-macro]
tech-stack:
  added: []
  patterns: [additive-enum-widening, text-column-no-migration]
key-files:
  created: []
  modified:
    - packages/core/src/journal/application/fetchMacroSeries.ts
    - packages/core/src/journal/application/fetchMacroSeries.test.ts
    - packages/contracts/src/macro.ts
    - packages/contracts/src/macro.test.ts
    - packages/adapters/src/memory/fred-series.test.ts
    - packages/adapters/src/__contract__/macro-observations.contract.ts
    - apps/server/src/adapters/mcp/tools.ts
    - docs/architecture/data-model.md
    - docs/architecture/jobs.md
decisions:
  - "VXVCLS appended at the END of both DEFAULT_FRED_SERIES_IDS and MACRO_SERIES_IDS (not inserted alphabetically) — matches the plan's explicit acceptance criteria and preserves array-order stability for any positional consumers"
  - "memory-twin and Postgres contract-suite VXVCLS test cases passed on first run (no code change needed) — this is expected, not a fail-fast violation: those adapters store `series` as a plain text column with no enum gate, so they were never coupled to the contracts enum under change. This IS the behavior Task 3 sets out to prove (no migration needed for a new series id)."
metrics:
  duration: ~35min
  completed: 2026-07-09
status: complete
---

# Phase 23 Plan 01: VIX3M (VXVCLS) Ingestion Summary

VIX3M (FRED series `VXVCLS`) is now a first-class member of the macro pipeline: appended to
`DEFAULT_FRED_SERIES_IDS` (core) and `MACRO_SERIES_IDS` (contracts enum), flowing through the
existing twice-daily `fetch-rates` cron with zero new endpoint, job, or migration.

## Tasks Completed

| Task | Name | Commit | Files |
|---|---|---|---|
| 1 | Docs-first — correct macro series counts + get_macro description | 667136c | docs/architecture/data-model.md, docs/architecture/jobs.md, apps/server/src/adapters/mcp/tools.ts |
| 2 | Core ingestion — VXVCLS in DEFAULT_FRED_SERIES_IDS (RED→GREEN) | 681a922 | packages/core/src/journal/application/fetchMacroSeries.ts(.test.ts) |
| 3 | Contracts enum + adapter parity — VXVCLS in MACRO_SERIES_IDS (RED→GREEN) | 4cf9bd9 | packages/contracts/src/macro.ts(.test.ts), packages/adapters/src/memory/fred-series.test.ts, packages/adapters/src/__contract__/macro-observations.contract.ts |

## Verification Evidence

- `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts` — RED (4/4
  failed on count mismatch, constant still 7 FRED ids) → GREEN (4/4 pass, counts 9/7/8/8).
- `bun run test -- packages/contracts/src/macro.test.ts packages/adapters/src/memory/fred-series.test.ts` —
  RED (macro.test.ts "contains all nine series ids" failed; fred-series.test.ts's new VXVCLS
  case passed immediately — expected, see Deviations) → GREEN (18/18 pass after enum widened).
- `bun run test -- packages/adapters/src/memory/macro-observations.contract.test.ts
  packages/adapters/src/postgres/repos/macro-observations.contract.test.ts` — 8/8 pass both
  before and after the enum change (text column, no DB gate — proves no migration needed).
- Full workspace `bun run test` — 229 files / 2313 tests passed.
- `bun run typecheck` — clean, all packages incl. web (closed `MacroSeriesId` enum widened
  without any web change; MacroCard/Overview use it only as subset types).
- `bun run lint` — clean (pre-existing `[boundaries]` legacy-selector-syntax warning only,
  unrelated to this change).
- `rg -c '"VXVCLS"'` — 1 hit each in fetchMacroSeries.ts and macro.ts.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs found, no blocking issues, no missing critical functionality.

### Notes (not deviations, documented per plan's own fail-fast guidance)

**Task 3 RED phase — two of three suites passed before the enum change.** The plan's action
text says to confirm all three suites (`macro.test.ts`, `fred-series.test.ts`,
`macro-observations.contract.ts` via its two callers) fail before the GREEN edit. In practice
only `macro.test.ts` failed — the memory-twin and Postgres contract-suite VXVCLS rows passed
on the first run. Investigated per `tdd.md`'s fail-fast rule: this is not a test correctness
problem. `macro_observations.series` is a plain text column and the memory-twin store is keyed
generically by string — neither was ever coupled to the `MACRO_SERIES_IDS` Zod enum under
change in Task 3. Passing immediately is the exact behavior those two test additions exist to
demonstrate: proving VXVCLS needs zero DB migration. Only the contracts enum test (`macro.test.ts`)
is a true RED→GREEN case; the adapter/contract additions are confirmation coverage of already-
correct generic behavior, landed in the same PR per architecture rule 8 (ship the in-memory
twin with the port/enum change).

## Known Stubs

None.

## Threat Flags

None — this phase adds one public FRED series id to an already-hardened pipeline; no new
network endpoint, auth path, file access pattern, or schema change. All threats in the plan's
STRIDE register are inherited/accepted with no new code path (T-23-01 through T-23-SC).

## Self-Check: PASSED

- FOUND: packages/core/src/journal/application/fetchMacroSeries.ts (VXVCLS present)
- FOUND: packages/contracts/src/macro.ts (VXVCLS present)
- FOUND: packages/adapters/src/memory/fred-series.test.ts (VXVCLS seed case present)
- FOUND: packages/adapters/src/__contract__/macro-observations.contract.ts (VXVCLS row present)
- FOUND commit 667136c (docs)
- FOUND commit 681a922 (core RED→GREEN)
- FOUND commit 4cf9bd9 (contracts + adapters RED→GREEN)
