---
phase: 19-picker-engine-economic-events
plan: 05
subsystem: database
tags: [postgres, drizzle, jsonb, zod, testcontainers, hexagonal, picker, migration]

# Dependency graph
requires:
  - phase: 19-01
    provides: "picker ports.ts (PickerSnapshotRow, ChainQuoteForPicker, ForPersisting/ReadingPickerSnapshot, ForReadingChainForPicker) + pickerSnapshotResponse contract"
  - phase: 19-04
    provides: "economic_events table + migration 0014 + picker/index.ts barrel"
provides:
  - "picker_snapshot append-history table (migration 0015) — one JSONB blob per observedAt, live-applied"
  - "makePostgresPickerSnapshotRepo — append-only insert + readLatest, Zod-validated on write and read"
  - "makeMemoryPickerSnapshotRepo twin + runPickerSnapshotContractTests shared suite"
  - "makePostgresPickerChainRepo — latest put cohort with per-strike IV + provider source"
  - "makeMemoryPickerChainRepo twin"
  - "migrations 0014 + 0015 applied and verified against the LIVE schema"
affects: [19-06, 19-07, 19-08, compute-picker, getPicker, picker.routes, get_picker_candidates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-history JSONB persistence (INSERT-only, no conflict target) — distinct from GEX's upsert-by-cycleTime"
    - "Boundary Zod validation on BOTH write and read of a JSONB blob (parse-don't-cast at both seams, T-19-10)"
    - "Read-only port twin as a plain seed array (no separate contract suite when there is no write path to cross-check)"

key-files:
  created:
    - packages/adapters/src/postgres/repos/picker-snapshot.ts
    - packages/adapters/src/postgres/repos/picker-snapshot.contract.test.ts
    - packages/adapters/src/memory/picker-snapshot.ts
    - packages/adapters/src/memory/picker-snapshot.contract.test.ts
    - packages/adapters/src/__contract__/picker-snapshot.contract.ts
    - packages/adapters/src/postgres/repos/picker-chain.ts
    - packages/adapters/src/postgres/repos/picker-chain.contract.test.ts
    - packages/adapters/src/memory/picker-chain.ts
    - packages/adapters/src/postgres/migrations/0015_picker_snapshot.sql
    - packages/adapters/src/postgres/migrations/meta/0015_snapshot.json
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - packages/core/src/picker/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "picker_snapshot uses observed_at as the PRIMARY KEY (not a separate uuid + unique index) — the exact-instant uniqueness IS the append-idempotency guard, no surrogate key needed"
  - "insertPickerSnapshot wraps pickerSnapshotResponse.parse INSIDE the try/catch (parse throws → mapped to StorageError) rather than a separate safeParse branch — one error path, satisfies the acceptance-criteria `pickerSnapshotResponse.parse` rg check and rejects-then-never-stores in one place"
  - "picker-chain source maps leg_observations.source (schwab_chain|cboe|computed_only) → schwab|cboe with computed_only falling back to cboe, mirroring snapshotCalendars.ts's identical mapping (never invents a new scheme)"
  - "picker-chain memory twin ships as a plain seed array with NO separate contract suite — the plan explicitly scopes it as a read-only port with no write path to cross-check; the postgres testcontainers test carries the JOIN/cohort/source assertions"

patterns-established:
  - "Append-history table: timestamptz PK + jsonb blob + RLS, INSERT-only repo, readLatest = ORDER BY <instant> DESC LIMIT 1"
  - "JSONB blob integrity: validate through the shared contract Zod schema at the adapter boundary on write AND read — a contract-violating blob is rejected, never silently stored or served"

requirements-completed: [PICK-02]

coverage:
  - id: D1
    description: "picker_snapshot append-history repo — INSERT one Zod-validated JSONB blob per observedAt (no upsert), readLatest returns newest by observedAt (null when empty), proven across memory + Postgres"
    requirement: "PICK-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/picker-snapshot.contract.test.ts (testcontainers, real Postgres 16)"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/picker-snapshot.contract.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "JSONB blob boundary validation (T-19-10) — a contract-violating snapshot is rejected on write (0 rows land) and a corrupted stored row surfaces StorageError on read (never served)"
    requirement: "PICK-02"
    verification:
      - kind: integration
        ref: "picker-snapshot.contract.test.ts#rejects an insert whose snapshot violates pickerSnapshotResponse / rejects a read of a legacy/corrupted row"
        status: pass
    human_judgment: false
  - id: D3
    description: "readChainForPicker — latest leg_observations put cohort with per-strike bsmIv + cohort source (schwab|cboe) via the contracts JOIN (D-15)"
    requirement: "PICK-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/picker-chain.contract.test.ts (testcontainers)"
        status: pass
    human_judgment: false
  - id: D4
    description: "migrations 0014 (economic_events) + 0015 (picker_snapshot) applied to the LIVE schema with correct column types"
    requirement: "PICK-02"
    verification:
      - kind: manual_procedural
        ref: "bun run migrate → 'migrate: all migrations applied' (0 errors); information_schema confirms economic_events.event_date=date, picker_snapshot.observed_at=timestamp with time zone, picker_snapshot.snapshot=jsonb"
        status: pass
    human_judgment: true
    rationale: "Production database write — must be run and confirmed by a human against the live schema; build+typecheck pass without the live tables (Drizzle types come from schema.ts), so only a live apply proves it"

# Metrics
duration: 22min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 05: Picker Read/Write Persistence Layer Summary

**Append-history `picker_snapshot` table (whole `pickerSnapshotResponse` as one Zod-validated JSONB blob per instant) + the `readChainForPicker` latest-put-cohort read, both contract-tested against real Postgres, with migrations 0014+0015 applied to the live schema.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-04T22:19:00Z
- **Completed:** 2026-07-04T22:41:00Z
- **Tasks:** 3 (2 auto/TDD + 1 blocking human-verify)
- **Files modified:** 14 (10 created, 4 modified)

## Accomplishments
- **picker_snapshot append-history substrate** — `observed_at timestamptz` PK + `snapshot jsonb` + RLS; the Postgres repo INSERTs one blob per instant (never upserts — D-06 keeps history for PICK-04's future slope backtest) and `readLatest` is a pure `ORDER BY observed_at DESC LIMIT 1`.
- **Blob integrity at both seams (T-19-10)** — the snapshot round-trips through `pickerSnapshotResponse` on write (a contract-violating blob is rejected before insert, 0 rows land) and on read (a legacy/corrupted row surfaces a `StorageError`, never served).
- **readChainForPicker** — resolves the latest `leg_observations` cohort with `bsm_iv IS NOT NULL`, JOINs `contracts` for strike/expiration, puts only, projecting per-strike `bsmIv` + provider `source` (schwab|cboe) for the compute layer (D-15).
- **In-memory twins + shared suite** — `makeMemoryPickerSnapshotRepo` (append array + max-observedAt readLatest) runs the SAME `runPickerSnapshotContractTests` suite as the Postgres repo; `makeMemoryPickerChainRepo` seed twin ships alongside.
- **Live schema migrated** — `bun run migrate` applied 0014 + 0015; both tables exist with verified column types.

## Task Commits

Each task committed atomically (single commit per TDD task at green, project tdd.md rule):

1. **Task 1: picker_snapshot table + append-history repo + memory twin + shared suite** — `2b36dcd` (feat)
2. **Task 2: readChainForPicker — latest put cohort with IV + source** — `4a2b3a2` (feat)
3. **Task 3 [BLOCKING]: apply migrations 0014 + 0015 to the live schema** — checkpoint recorded `dd85cea` (docs); applied by orchestrator (user-authorized) and verified.

**Plan metadata:** (this SUMMARY + STATE + ROADMAP commit follows)

## Files Created/Modified
- `packages/adapters/src/postgres/schema.ts` — added `pickerSnapshots` table (observed_at timestamptz PK, snapshot jsonb, RLS)
- `packages/adapters/src/postgres/migrations/0015_picker_snapshot.sql` (+ meta snapshot + _journal entry) — drizzle-generated DDL: jsonb + timestamptz + RLS
- `packages/adapters/src/postgres/repos/picker-snapshot.ts` — append-only insert + readLatest, Zod-validated both seams
- `packages/adapters/src/postgres/repos/picker-snapshot.contract.test.ts` — testcontainers: append-history + boundary-validation (write reject + read reject)
- `packages/adapters/src/memory/picker-snapshot.ts` + `.contract.test.ts` — in-memory twin + shared-suite wiring
- `packages/adapters/src/__contract__/picker-snapshot.contract.ts` — `runPickerSnapshotContractTests` shared suite (append-history, latest-wins, empty→null)
- `packages/adapters/src/postgres/repos/picker-chain.ts` — latest put cohort read with IV + source
- `packages/adapters/src/postgres/repos/picker-chain.contract.test.ts` — testcontainers: empty→[], latest-cohort/puts-only, source projection (schwab + cboe)
- `packages/adapters/src/memory/picker-chain.ts` — seed twin
- `packages/core/src/picker/index.ts` + `packages/core/src/index.ts` — re-export the picker-snapshot + chain-read ports (were declared in ports.ts but not surfaced through the barrels)

## Decisions Made
- **observed_at as PRIMARY KEY** (not surrogate uuid + unique index) — the exact-instant uniqueness is the append-idempotency guard; a duplicate instant is the only conflict, and there is nothing to update.
- **parse-inside-try** — `pickerSnapshotResponse.parse` (throwing form) inside the repo's try/catch gives one error path and satisfies the plan's `rg 'pickerSnapshotResponse.parse'` acceptance check while still rejecting-then-never-storing a bad blob.
- **source mapping reuse** — `computed_only → cboe` fallback mirrors `snapshotCalendars.ts` verbatim rather than inventing a picker-specific scheme.
- **chain twin has no separate contract suite** — plan-scoped: read-only port with no write path to cross-check; the postgres testcontainers test owns the JOIN/cohort/source assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Picker-snapshot/chain ports not exported from the core barrels**
- **Found during:** Task 1 (adapters could not import `PickerSnapshotRow`/`ForPersistingPickerSnapshot`/`ForReadingPickerSnapshot`/`ChainQuoteForPicker`/`ForReadingChainForPicker` from `@morai/core`)
- **Issue:** These types were declared in `packages/core/src/picker/application/ports.ts` but 19-04's barrel additions only surfaced the economic-events ports; the new adapters need them through `@morai/core`.
- **Fix:** Added the 6 type re-exports to `packages/core/src/picker/index.ts` and `packages/core/src/index.ts` (additive, mirrors 19-04's own Rule-3 barrel decision).
- **Files modified:** `packages/core/src/picker/index.ts`, `packages/core/src/index.ts`
- **Verification:** `bun run typecheck` clean; full suite green.
- **Committed in:** `2b36dcd` (part of Task 1 commit)

## Verification Evidence

- **`bun run test`** — full monorepo: **1770/1770 passing**, 193 test files, including ALL Postgres testcontainers tests run against a real Postgres 16 (Docker Desktop started locally for this verification run — earlier runs skipped Postgres tests when Docker was down).
- **`bun run typecheck`** — clean (no `any`/`as`/`!`; Result<T,E> + Zod parsing throughout).
- **`bun run lint`** — clean (only pre-existing boundaries legacy-selector warnings, unrelated).
- **Acceptance-criteria `rg` checks:**
  - `rg 'onConflictDoUpdate' packages/adapters/src/postgres/repos/picker-snapshot.ts` → **0 matches** (append only) ✓
  - `rg 'pickerSnapshotResponse.parse' packages/adapters/src/postgres/repos/picker-snapshot.ts` → matches (boundary validation, write + read) ✓
  - `rg 'source' packages/adapters/src/postgres/repos/picker-chain.ts` → source column projected into ChainQuoteForPicker ✓
- **Live schema (Task 3, orchestrator-run, user-authorized):** `bun run migrate` → `migrate: all migrations applied`, 0 errors. `information_schema` confirms:
  - `economic_events.event_date` = **`date`** ✓
  - `picker_snapshot.observed_at` = **`timestamp with time zone`** ✓
  - `picker_snapshot.snapshot` = **`jsonb`** ✓
  - Both tables exist.

## Known Stubs

None — both repos are fully wired against real schema columns; no placeholder/mock data paths.

## Threat Flags

None — the two trust boundaries touched (JSONB blob read/write, migration apply) are exactly those in the plan's threat register; T-19-10 (untyped JSONB tampering) is mitigated by the boundary Zod validation on both seams, and T-19-11 (storage-error leakage) is mitigated by the flat `StorageError` mapping.

## Self-Check: PASSED
