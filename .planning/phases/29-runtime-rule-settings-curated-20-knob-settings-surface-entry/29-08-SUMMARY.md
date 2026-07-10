---
phase: 29-runtime-rule-settings
plan: 08
subsystem: adapters
tags: [postgres, settings, persistence, jsonb, contract-test]
dependency-graph:
  requires: ["29-01", "29-02", "29-09"]
  provides:
    - "ruleOverrides pgTable + migration 0022 (rule_overrides table, live in local DB)"
    - "makePostgresRuleOverridesRepo(db) / makeMemoryRuleOverridesRepo() satisfying 29-09's ForReadingRuleOverrides/ForWritingRuleOverrides"
  affects:
    - "packages/adapters barrel (@morai/adapters)"
tech-stack:
  added: []
  patterns:
    - "singleton-row JSONB table (broker_tokens convention, no DB CHECK)"
    - "onConflictDoUpdate upsert (calendar-event-annotations D-10 convention)"
    - "Zod-parse-on-read-and-write at the adapter boundary (picker_snapshot/exit_verdicts T-19-10 convention)"
key-files:
  created:
    - packages/adapters/src/postgres/migrations/0022_rule_overrides.sql
    - packages/adapters/src/postgres/repos/rule-overrides.ts
    - packages/adapters/src/memory/rule-overrides.ts
    - packages/adapters/src/__contract__/rule-overrides.contract.ts
    - packages/adapters/src/postgres/repos/rule-overrides.contract.test.ts
    - packages/adapters/src/memory/rule-overrides.contract.test.ts
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - packages/adapters/src/postgres/migrations/meta/0022_snapshot.json
    - packages/adapters/src/index.ts
decisions:
  - "Shared contract-test logic lives in __contract__/rule-overrides.contract.ts (not itemized in the plan's files_modified list) — matches the codebase-wide convention used by every other multi-adapter repo (calendar-event-annotations, exit-verdicts, picker-snapshot, etc.); the two listed *.contract.test.ts files are thin per-adapter runners over it."
  - "RuleOverrides (contracts, nullable-per-group) -> StoredRuleOverrides (core, generic JsonObject) conversion uses a JSON.parse(JSON.stringify(...)) round-trip behind a typed isJsonObject guard — drops zod's optional `| undefined` fields so the result structurally satisfies StoredRuleOverrides' index signature under exactOptionalPropertyTypes, with zero `as`/`any`."
  - "Corrupted-row test seeding: postgres adapter seeds via raw SQL INSERT in the *.contract.test.ts file (mirrors exit-verdicts.contract.test.ts); memory adapter exposes a seedRawOverrides(rawBlob) method on the repo itself (mirrors memory/exit-verdicts.ts) — matches existing precedent exactly, not a new pattern."
metrics:
  duration: "~25 min"
  completed: 2026-07-10
status: complete
---

# Phase 29 Plan 08: Rule-Overrides Persistence Summary

Single-row JSONB `rule_overrides` table + Postgres repo + in-memory twin, both Zod-validated
on read and write via the 29-02 contract, backing the 29-09 settings ports.

## What Was Built

**Task 1 — `ruleOverrides` table + migration 0022 (BLOCKING):**
- Added `ruleOverrides` pgTable to `packages/adapters/src/postgres/schema.ts`: `id: text("id")
  .primaryKey()` (app always writes the literal `"default"`), `overrides: jsonb("overrides")
  .$type<Record<string, unknown>>().notNull()`, `updatedAt` with `.defaultNow()`, `.enableRLS()`
  — mirrors `broker_tokens`' singleton convention exactly (no DB CHECK constraint).
- Generated `0022_rule_overrides.sql` via `bunx drizzle-kit generate` (renamed from the
  auto-generated slug name to the plan's required filename; journal tag updated to match).
- Applied locally via `bun run migrate` — succeeded with the full worker env already present
  in `.env` (no gotcha hit this run; `bootWorkerConfig()` validated cleanly).

**Task 2 — postgres repo + memory twin + shared contract test:**
- `makePostgresRuleOverridesRepo(db)`: `readRuleOverrides` selects the `"default"` row
  (absent → `ok({})`, not an error), Zod-parses `overrides` through `@morai/contracts`'
  `ruleOverrides` schema, and converts the validated per-group-nullable shape into the
  core `StoredRuleOverrides` (generic JsonObject, no null groups). `writeRuleOverrides`
  Zod-validates the incoming blob first (rejecting an invalid write outright, zero rows
  touched), then `insert(...).onConflictDoUpdate({ target: id, set: { overrides, updatedAt }
  })` on the fixed `"default"` key.
- `makeMemoryRuleOverridesRepo()`: identical read/write validation semantics over a single
  in-memory `unknown` value (no Map needed — one row by construction). Exposes a test-only
  `seedRawOverrides(rawBlob)` to bypass its own write validation, mirroring the Postgres
  side's raw-SQL seed in the contract test.
- `packages/adapters/src/__contract__/rule-overrides.contract.ts` — one shared suite run
  against both adapters: absent-row `ok({})`, partial-blob round-trip, upsert-replace (a
  second write with a group removed replaces the whole row, proving it's not append-only),
  invalid-write rejection (prior row untouched), and corrupt-stored-row → `StorageError`
  on read (T-29-12).
- Both factories exported from `packages/adapters/src/index.ts`.

## Verification

- `bun run typecheck` — clean (0 errors).
- `bunx eslint` on all touched files — clean (0 errors; 1 pre-existing repo-wide boundary
  warning unrelated to this plan).
- `bunx vitest run` on the two contract test files — **10/10 passed** (5 assertions ×
  2 adapters).
- Full `packages/adapters` suite (`bunx vitest run`) — **77 test files / 681 tests passed**,
  zero regressions.
- `rule_overrides` table confirmed live in the local DB (migration applied without error;
  `bun run migrate` exit 0).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical structure] Added the shared `__contract__/rule-overrides.contract.ts` file**
- **Found during:** Task 2
- **Issue:** The plan's `files_modified` list itemizes only the two thin `*.contract.test.ts`
  runner files, but "ONE shared contract test exercised against BOTH repos" (the plan's own
  action text) requires a shared-logic file — every other multi-adapter repo in this codebase
  (calendar-event-annotations, exit-verdicts, picker-snapshot, broker-tokens, ...) puts that
  shared logic in `packages/adapters/src/__contract__/<name>.contract.ts`. Omitting it would
  mean duplicating the 5 assertions across two files, diverging from an established,
  universal codebase convention.
- **Fix:** Added `__contract__/rule-overrides.contract.ts` following the exact structure of
  `__contract__/exit-verdicts.contract.ts` (closest analog: single JSONB blob, corrupt-row
  assertion via a `seedRaw*` bypass).
- **Files modified:** `packages/adapters/src/__contract__/rule-overrides.contract.ts` (new)
- **Commit:** 66df926

**2. [Rule 1 - type-correctness bug] Compiler-forced JSON-safe conversion for `StoredRuleOverrides`**
- **Found during:** Task 2, `bun run typecheck`
- **Issue:** `@morai/contracts`' `RuleOverrides` type has optional/nullable group fields
  (`picker?: PickerOverrides | null`); `@morai/core`'s `StoredRuleOverrides` is a generic
  recursive `JsonObject` whose index-signature value type excludes `undefined`. Direct
  assignment of a parsed `RuleOverrides` group into a `StoredRuleOverrides`-typed slot failed
  `tsc` under `exactOptionalPropertyTypes` (every optional sub-field's `T | undefined` type
  isn't assignable to `JsonValue`).
- **Fix:** Added a small `isJsonObject` type guard (not a cast) + a `JSON.parse(JSON.stringify(...))`
  round-trip (`toJsonSafe`) that drops the optional-`undefined` fields before assignment —
  zero `as`, zero `any`, satisfying `typescript.md`'s strictness rules. Applied identically in
  both the Postgres and memory repos (kept the two implementations independent rather than
  extracting a shared helper module, since it's ~10 lines and neither file was in the plan's
  scope to introduce a new shared module for).
- **Files modified:** `packages/adapters/src/postgres/repos/rule-overrides.ts`,
  `packages/adapters/src/memory/rule-overrides.ts`
- **Commit:** 66df926

No architectural changes (Rule 4) were needed.

## Known Stubs

None — this plan ships persistence only; no UI or consumption-path stubs.

## Threat Flags

None — both threats in the plan's own threat_model (T-29-12 corrupt blob, T-29-13 out-of-band
prod migration) are the mitigations this plan implements, not new unmitigated surface.

## Self-Check: PASSED

- `packages/adapters/src/postgres/migrations/0022_rule_overrides.sql` — FOUND
- `packages/adapters/src/postgres/repos/rule-overrides.ts` — FOUND
- `packages/adapters/src/memory/rule-overrides.ts` — FOUND
- `packages/adapters/src/__contract__/rule-overrides.contract.ts` — FOUND
- `packages/adapters/src/postgres/repos/rule-overrides.contract.test.ts` — FOUND
- `packages/adapters/src/memory/rule-overrides.contract.test.ts` — FOUND
- Commit `2144f3b` (Task 1: schema + migration) — FOUND in `git log`
- Commit `66df926` (Task 2: repos + contract tests) — FOUND in `git log`
