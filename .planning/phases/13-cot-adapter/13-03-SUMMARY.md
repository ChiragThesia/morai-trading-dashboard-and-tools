---
phase: 13-cot-adapter
plan: "03"
subsystem: adapters/cot-observations
tags: [cot, persistence, postgres, memory-twin, tdd, idempotency]
status: complete

dependency_graph:
  requires: [13-01, 13-02]
  provides: [makePostgresCotObservationsRepo, makeMemoryCotObservationsRepo, runCotObservationsContractTests]
  affects: [packages/adapters/src/index.ts]

tech_stack:
  added: []
  patterns:
    - Drizzle onConflictDoNothing with column-pair target (UNIQUE constraint idempotency)
    - Shared contract pattern: runCotObservationsContractTests runs against both Postgres + memory
    - beforeEach truncate in Postgres contract test for row-level isolation

key_files:
  created:
    - packages/adapters/src/__contract__/cot-observations.contract.ts
    - packages/adapters/src/postgres/repos/cot-observations.ts
    - packages/adapters/src/postgres/repos/cot-observations.contract.test.ts
    - packages/adapters/src/memory/cot-observations.ts
    - packages/adapters/src/memory/cot-observations.contract.test.ts
  modified:
    - packages/adapters/src/index.ts

decisions:
  - "beforeEach truncate in Postgres contract test wrapper for row-level isolation — shared contract includes an empty-array test; the Postgres DB is shared across tests in a testcontainers run so each test needs a clean slate"
  - "localeCompare for asOf DESC sort in memory twin — YYYY-MM-DD lexicographic order = chronological order; avoids Date parsing in pure in-memory code"
  - "Filter by contractCode+asOf in ordering/idempotency tests rather than asserting total row counts — makes contract tests resilient without depending on truncation in every environment"

metrics:
  duration_minutes: 8
  completed_date: "2026-06-29"
  tasks_completed: 2
  files_created: 5
  files_modified: 1

commits:
  - hash: df0b5bc
    type: test
    message: "add failing contract for cot-observations persistence port (RED Task 1)"
  - hash: 8ca480e
    type: feat
    message: "makePostgresCotObservationsRepo — insert + list cot-observations (GREEN Task 1)"
  - hash: 7a5157f
    type: test
    message: "add failing contract for memory cot-observations twin (RED Task 2)"
  - hash: 7acc179
    type: feat
    message: "makeMemoryCotObservationsRepo — in-memory cot-observations twin (GREEN Task 2)"
---

# Phase 13 Plan 03: COT Observations Repository Summary

One-liner: Drizzle parameterized insert with onConflictDoNothing (COT-01 idempotency) + in-memory twin; shared 6-case contract proven against real Postgres (testcontainers) and memory.

## What Was Built

### Task 1: makePostgresCotObservationsRepo + shared contract

`packages/adapters/src/postgres/repos/cot-observations.ts` — Postgres implementation of `ForPersistingCotObservation` + `ForReadingCotObservations`.

- `insertCotObservation(row)`: Drizzle parameterized insert into `cot_observations` with `onConflictDoNothing({ target: [cotObservations.contractCode, cotObservations.asOf] })`. Maps `CotObservationRow` fields directly — `asOf` (string) to `date` column, `publishedAt` (Date) to `timestamptz`. Wraps in try/catch → `err(StorageError)`.
- `listCotObservations(limit?)`: Select all columns from `cot_observations`, `orderBy(desc(cotObservations.asOf))`, apply `.limit(limit)` when provided. Maps DB rows back to `CotObservationRow`. Wraps in try/catch → `err(StorageError)`.

`packages/adapters/src/__contract__/cot-observations.contract.ts` — shared contract runner with 6 test cases:
1. Insert + read-back: all 13 fields persisted (contractCode, asOf, openInterest, all 10 legs)
2. D-07/D-08 distinctness: `published_at` (Friday Date) ≠ `as_of` (Tuesday YYYY-MM-DD)
3. COT-01 idempotency: re-insert same contractCode+asOf with different openInterest → exactly 1 row for that week, original value preserved
4. Ordering: two rows with different asOf → `listCotObservations()` returns them newest-first
5. Limit: two rows → `listCotObservations(1)` returns exactly 1 (the newest)
6. Empty: fresh store → `listCotObservations()` returns `[]`

`packages/adapters/src/postgres/repos/cot-observations.contract.test.ts` — Postgres wrapper: `inject("dbUrl")` + `describe.skipIf(!dbUrl)` + `beforeEach(await db.delete(cotObservations))` for isolation.

### Task 2: makeMemoryCotObservationsRepo

`packages/adapters/src/memory/cot-observations.ts` — in-memory twin backed by `Map<string, CotObservationRow>` keyed by `${contractCode}|${asOf}`. Second insert for same key is a no-op (mirrors `onConflictDoNothing`). Sort by `b.asOf.localeCompare(a.asOf)` for DESC ordering.

`packages/adapters/src/memory/cot-observations.contract.test.ts` — runs the same `runCotObservationsContractTests` with no Docker dependency.

### Exports

Both repos exported from `packages/adapters/src/index.ts`:
- `makePostgresCotObservationsRepo` / `PostgresCotObservationsRepo`
- `makeMemoryCotObservationsRepo` / `MemoryCotObservationsRepo`

## Test Results

| Suite | Tests | Result |
|---|---|---|
| postgres cot-observations adapter (testcontainers) | 6/6 | PASS |
| memory cot-observations adapter | 6/6 | PASS |
| typecheck | — | CLEAN |
| lint | — | CLEAN |

Docker was available; testcontainers Postgres ran and the full 12-case suite passed. The Postgres tests ran on a fresh container with all migrations (including 0012 which creates `cot_observations`) applied in globalSetup.

## COT-01 Idempotency Proof

The idempotency case in the contract:
1. Insert `{ contractCode: "13874A", asOf: "2026-06-24", openInterest: 2987456, ... }`
2. Re-insert `{ contractCode: "13874A", asOf: "2026-06-24", openInterest: 9999999, ... }` (different value)
3. Assert: `rowsForWeek.length === 1` (not 2) AND `rowsForWeek[0].openInterest === 2987456` (not 9999999)

Proven against real Postgres via `ON CONFLICT (contract_code, as_of) DO NOTHING`. The Drizzle `onConflictDoNothing({ target: [...] })` resolves to the named unique constraint `cot_observations_contract_code_as_of_unique`.

## D-07/D-08 Distinctness Proof

`asOf = "2026-06-24"` (Tuesday YYYY-MM-DD string) and `publishedAt = new Date("2026-06-27T17:00:00Z")` (Friday timestamptz). The contract asserts `found.asOf !== found.publishedAt.toISOString().slice(0, 10)`, which is `"2026-06-24" !== "2026-06-27"`. Proven to round-trip through Postgres without date-math or coercion.

## Threat Mitigations

| Threat ID | Mitigation | Verified |
|---|---|---|
| T-13-05 (SQL injection) | Drizzle parameterized insert — no string interpolation of contractCode/asOf | Contract tests pass with arbitrary contractCode values |
| T-13-06 (duplicate rows) | `onConflictDoNothing` on (contractCode, asOf) | COT-01 idempotency test asserts exactly 1 row after re-insert |

## Deviations from Plan

### Auto-fix — beforeEach truncate in Postgres contract test

The shared contract includes an "empty array" test and a limit test that require a clean table state. Without truncation, a shared testcontainers DB would accumulate rows across tests, causing these assertions to fail.

**Fix:** Added `beforeEach(async () => { await db.delete(cotObservations); })` in the Postgres contract test wrapper (not in the shared contract, which stays database-agnostic). The memory twin naturally gets a fresh store per `makeRepo()` call in `beforeEach`.

This is a Rule 2 auto-add (missing critical functionality for correctness) — the plan's contract requirement implied row isolation without spelling it out.

## Known Stubs

None — all contract behaviors implemented fully.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary surface introduced. The Drizzle insert surface was already in the threat model (T-13-05, T-13-06).

## Self-Check

### Created files exist
- `packages/adapters/src/__contract__/cot-observations.contract.ts` — FOUND
- `packages/adapters/src/postgres/repos/cot-observations.ts` — FOUND
- `packages/adapters/src/postgres/repos/cot-observations.contract.test.ts` — FOUND
- `packages/adapters/src/memory/cot-observations.ts` — FOUND
- `packages/adapters/src/memory/cot-observations.contract.test.ts` — FOUND

### Commits exist
- df0b5bc — FOUND (test RED Task 1)
- 8ca480e — FOUND (feat GREEN Task 1)
- 7a5157f — FOUND (test RED Task 2)
- 7acc179 — FOUND (feat GREEN Task 2)

## Self-Check: PASSED
