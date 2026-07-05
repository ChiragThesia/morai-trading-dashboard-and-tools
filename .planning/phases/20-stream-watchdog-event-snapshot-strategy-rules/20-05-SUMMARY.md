---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 05
subsystem: journal
tags: [adapters, postgres, drizzle, migration, testcontainers, snapshot, cooldown]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "20-04's SnapshotRow.trigger optional field + ForReadingLatestSnapshotTime port (packages/core)"
provides:
  - "calendar_snapshots.trigger column (migration 0016, additive nullable)"
  - "Postgres + memory persistSnapshot trigger mapping (default 'scheduled')"
  - "Postgres + memory readLatestSnapshotTime (SELECT MAX(time), null on cold start)"
affects: ["20-06 (wiring: SPX tick detector composes readLatestSnapshotTime + isWithinCooldown + persistSnapshot({trigger: 'event-move'}) in apps/server)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Migration authored via `drizzle-kit generate` against the updated schema.ts (not hand-typed meta JSON) to keep meta/_journal.json and meta/NNNN_snapshot.json in the exact format the runtime migrator (drizzle-orm/postgres-js/migrator) expects"
    - "drizzle-orm's max() aggregate function over the composite-PK-leading `time` column for the cooldown ground-truth read — index-only scan, no raw SQL"
    - "Default-at-the-edge pattern for an additive nullable column: DB stores NULL, the repo mapper (Postgres) / helper (memory twin) resolves NULL -> 'scheduled' at read time — no backfill, no DB default"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0016_snapshot_trigger.sql
    - packages/adapters/src/postgres/migrations/meta/0016_snapshot.json
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - docs/architecture/data-model.md
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
    - packages/adapters/src/memory/calendar-snapshots.contract.test.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "Generated migration 0016 via `bunx drizzle-kit generate --name snapshot_trigger` (after adding `trigger: text(\"trigger\")` to schema.ts) rather than hand-writing the SQL + meta JSON. Output was verified to exactly match the plan's required statement (`ALTER TABLE \"calendar_snapshots\" ADD COLUMN \"trigger\" text;` — nullable, no default). This is schema-diff tooling, not a `drizzle-kit push` against any database, so it doesn't violate the 'no drizzle-kit push' prohibition; it keeps meta/_journal.json and the snapshot JSON internally consistent with the repo's established convention (every prior migration 0000-0015 was drizzle-kit-generated), which the runtime migrator (drizzle-orm/postgres-js/migrator) depends on to resolve migration tags in order."
  - "Postgres persistSnapshot writes `row.trigger ?? null` (never `!`, never `as`) — an absent/undefined SnapshotRow.trigger is stored as SQL NULL, not defaulted at write time, matching the migration's 'no backfill, no DB default' constraint (D-12)."
  - "mapSnapshotRow and the memory twin's `withDefaultTrigger` helper both resolve trigger with the SAME guard shape: `row.trigger === \"event-move\" ? \"event-move\" : \"scheduled\"` — any NULL, undefined, or (in principle) corrupt DB value defaults safely to 'scheduled' rather than surfacing an unexpected third state."
  - "Used drizzle-orm's `max()` aggregate function (`SELECT MAX(time) FROM calendar_snapshots`) instead of raw `sql\`...\`` — keeps the query parameterized/typed through Drizzle's column types, consistent with the T-02-09 no-raw-interpolation precedent in this same file."

requirements-completed: [SNAP-01]

coverage:
  - id: D4
    description: "Migration 0016 adds calendar_snapshots.trigger as a nullable text column, additively — no NOT NULL, no DB default, no backfill; schema.ts and docs/architecture/data-model.md mirror it"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "rg -n trigger against 0016_snapshot_trigger.sql, schema.ts, data-model.md (Task 1 automated verify)"
        status: pass
    human_judgment: false
  - id: D5
    description: "persistSnapshot writes row.trigger (default null at the DB when absent); a persisted row read back carries its trigger; a legacy/NULL trigger reads as 'scheduled' — parity across Postgres (testcontainers) and memory"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-snapshots.contract.ts#trigger provenance — round-trip (SNAP-01, D-12, 20-05) — 3 cases (event-move, scheduled, legacy-null) x 2 impls"
        status: pass
    human_judgment: false
  - id: D6
    description: "ForReadingLatestSnapshotTime (Postgres: SELECT MAX(time); memory: max across stored rows) returns ok(Date) after inserts, ok(null) on an empty/cold-start table, never throws — parity across both impls"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-snapshots.contract.ts#readLatestSnapshotTime — MAX(time) cooldown ground truth (SNAP-01, Pattern 2, 20-05) — 2 cases x 2 impls"
        status: pass
      - kind: integration
        ref: "full monorepo suite (bun run test): 203 test files, 1917 tests green; bun run typecheck (tsc --build --force) clean; bun run lint clean"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 05: SNAP-01 Adapters — Provenance Column + Cooldown Read Summary

**Numbered migration 0016 lands the additive `calendar_snapshots.trigger` provenance column; the Postgres and memory repos map it (default 'scheduled') and both implement `ForReadingLatestSnapshotTime` via `MAX(time)` with proven memory/Postgres parity under testcontainers.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-05T01:00:00-05:00
- **Completed:** 2026-07-05T01:25:00-05:00
- **Tasks:** 2/2 completed
- **Files modified:** 10 (2 created, 8 modified)

## Accomplishments
- Migration `0016_snapshot_trigger.sql` — additive nullable `trigger` column on `calendar_snapshots`, generated via `drizzle-kit generate` against the updated `schema.ts` so `meta/_journal.json` and `meta/0016_snapshot.json` stay in the exact format the runtime migrator expects (verified NOT NULL/default-free; matches the plan's required SQL verbatim).
- `docs/architecture/data-model.md` amended with the `trigger` field and its two values (`scheduled` | `event-move`), per the Docs Before Code workflow rule.
- Postgres `persistSnapshot` now writes `row.trigger ?? null`; `mapSnapshotRow` resolves NULL/legacy rows to `"scheduled"` (only other valid value is `"event-move"`).
- Postgres `readLatestSnapshotTime` — `SELECT MAX(time)` via drizzle-orm's `max()` aggregate (index-only scan, `time` leads the composite PK), returns `Result<Date | null, StorageError>`, never throws.
- Memory twin: identical trigger-default (`withDefaultTrigger` helper applied at `readJournal`) and `readLatestSnapshotTime` (max across stored rows, null when empty) semantics — landed in the same commit per architecture-boundaries §8.
- Contract test extended with 5 new cases (trigger round-trip ×3, latest-time ×2), run against BOTH the Postgres testcontainers adapter and the memory twin — 39/39 green.
- Fixed a blocking gap left by 20-04: `ForReadingLatestSnapshotTime` was defined in `packages/core`'s `ports.ts` but never re-exported through `journal/index.ts` / the top-level `core/index.ts` barrels, so `packages/adapters` couldn't import it. Added the two barrel re-exports (Rule 3 — blocking issue, missing export).

## Task Commits

1. **Task 1: Migration 0016 + Drizzle trigger column (D-12) + data-model doc** — `b47ccec` (feat)
2. **Task 2: persistSnapshot trigger mapping + ForReadingLatestSnapshotTime impls** — `c6e246a` (feat)

_TDD note: Task 2's contract-test additions were written and run first against both adapters — 8 assertions/TypeErrors failed for the right reason (no trigger mapping yet; `repo.readLatestSnapshotTime is not a function`) before any implementation code was written. Implementation then turned all 39 contract-suite tests green._

## Files Created/Modified
- `packages/adapters/src/postgres/migrations/0016_snapshot_trigger.sql` — additive nullable trigger column, D-12 comment
- `packages/adapters/src/postgres/migrations/meta/0016_snapshot.json` — drizzle-kit-generated schema snapshot
- `packages/adapters/src/postgres/migrations/meta/_journal.json` — appended the 0016 migration-tag entry
- `packages/adapters/src/postgres/schema.ts` — `calendarSnapshots.trigger: text("trigger")`
- `docs/architecture/data-model.md` — `calendar_snapshots` table doc + trigger provenance note
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — persist/read trigger mapping + `readLatestSnapshotTime`
- `packages/adapters/src/memory/calendar-snapshots.ts` — twin: `withDefaultTrigger` + `readLatestSnapshotTime`
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` — `readLatestSnapshotTime` added to the shared repo type; trigger round-trip + latest-time parity assertions
- `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` — wired `readLatestSnapshotTime` into the Postgres repo object passed to the contract suite
- `packages/adapters/src/memory/calendar-snapshots.contract.test.ts` — wired `readLatestSnapshotTime` into the memory repo object passed to the contract suite
- `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` — added the missing `ForReadingLatestSnapshotTime` barrel re-export

## Decisions Made
- **Generated the migration via `drizzle-kit generate`, not hand-typed.** After adding the `trigger` column to `schema.ts`, ran `bunx drizzle-kit generate --name snapshot_trigger`. The output SQL matched the plan's required statement exactly (`ALTER TABLE "calendar_snapshots" ADD COLUMN "trigger" text;` — nullable, no default), and this keeps `meta/_journal.json`/`meta/0016_snapshot.json` in the same tool-generated format as every prior migration (0000-0015), which the runtime migrator (`drizzle-orm/postgres-js/migrator`) depends on for its `__drizzle_migrations` ledger tag resolution. This is schema-diff generation against local files, not a `drizzle-kit push` against any database — no live or test DB was touched by the generate step.
- **Write-time: `row.trigger ?? null`, never defaulted to "scheduled" at write.** Matches D-12's "no DB default, no backfill" prohibition — the default only exists at the read boundary (mapper), so a raw `SELECT * FROM calendar_snapshots` still shows true NULLs for legacy rows.
- **Read-time default guard: `=== "event-move" ? "event-move" : "scheduled"`.** Applied identically in the Postgres mapper and the memory twin's `withDefaultTrigger` helper — any unexpected DB value (not just NULL) safely resolves to "scheduled" rather than crashing or leaking a third state into the domain type.
- **`max()` from drizzle-orm, not raw `sql` template.** Consistent with this file's existing `T-02-09` "Drizzle parameterized queries, no raw template interpolation" precedent for all other queries in `calendar-snapshots.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `ForReadingLatestSnapshotTime` barrel re-export from `packages/core`**
- **Found during:** Task 2, first `bun run typecheck` after wiring the port type into the adapters
- **Issue:** 20-04 defined `ForReadingLatestSnapshotTime` in `packages/core/src/journal/application/ports.ts` but never added it to the `journal/index.ts` or top-level `core/index.ts` export barrels (unlike its sibling `ForReadingJournal`/`ForPersistingSnapshot`, which were both re-exported). `packages/adapters` therefore could not import the type at all — `tsc --build --force` failed with `TS2724: has no exported member named 'ForReadingLatestSnapshotTime'`.
- **Fix:** Added `ForReadingLatestSnapshotTime` to the existing `export type { ... } from "./application/ports.ts"` block in `journal/index.ts`, and the mirrored block in the top-level `index.ts`.
- **Files modified:** `packages/core/src/journal/index.ts`, `packages/core/src/index.ts`
- **Commit:** `c6e246a`

No other deviations — plan executed exactly as written otherwise.

## Issues Encountered
None beyond the barrel-export fix above.

## User Setup Required
Per plan frontmatter `user_setup`: migration 0016 (additive nullable trigger column) must be applied to the live Postgres database via `bun run migrate` against `DATABASE_URL` during the SNAP-01 deploy cycle (D-18), AFTER this plan's changes merge. This plan verified the migration ONLY via testcontainers (`bun run test`, Postgres 16 ephemeral container) — no live/prod database was touched. No new dependencies added.

## Next Phase Readiness
- 20-06 (wiring, apps/server) can now compose: `readLatestSnapshotTime()` -> `isWithinCooldown(now, lastTime, cooldownMs)` (from 20-04) -> if not in cooldown and `detectLargeMove` (from 20-04) fires, call the existing `snapshotCalendarsUseCase({ trigger: "event-move" })` (20-04 use-case passthrough), which will now persist through to a real `trigger = 'event-move'` column value via this plan's Postgres/memory mapping.
- No blockers. Full monorepo suite (203 test files, 1917 tests), `bun run typecheck`, and `bun run lint` all green after this plan's changes.
- Live-deploy note carried forward from `user_setup`: migration 0016 still needs `bun run migrate` run against the live `DATABASE_URL` — not done as part of this plan (adapters-only scope; deploy is a separate SNAP-01 step).

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*

## Self-Check: PASSED

All 10 created/modified files verified present on disk. Both commit hashes (b47ccec, c6e246a) verified present in git log.
