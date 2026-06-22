---
phase: 05-jobs-fill-rebuild-integrity
plan: 10
subsystem: jobs
tags: [oauth-refresh, job-runs, dedup, contract-refinement, tdd, testcontainers]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: "refreshToken use-case (05-04), job-runs repo (05-02), enqueueJob + jobs.routes + trigger_job (05-04/05-08)"
provides:
  - "CR-02: transient OAuth network/parse errors (and unexpected throws) map to retryable storage-error, never auth-expired"
  - "CR-03: readJobRuns reports lastSuccessAt and lastErrorAt independently per job via FILTER aggregates"
  - "WR-05: memory job-queue twin returns ok(null) on a dedup hit (mirrors pg-boss singletonKey collision)"
  - "WR-04: triggerJobBodyFor(name) enforces rebuild-journal ⇒ calendarId required at the boundary (400, no enqueue)"
  - "IN-01: dead void pgBossJobQueue wiring removed from the worker composition root"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-job request-body schema factory (triggerJobBodyFor) threads the route-param name into a Zod refinement without mutating the base payload schema"
    - "FILTER aggregates (MAX(...) FILTER (WHERE state=...)) compute independent per-state timestamps in one GROUP BY query"
    - "Transient vs terminal error mapping: only invalid_grant/invalid_client are terminal; everything else is retryable"

key-files:
  created:
    - packages/contracts/src/jobs.test.ts
    - .planning/phases/05-jobs-fill-rebuild-integrity/05-10-SUMMARY.md
  modified:
    - packages/core/src/brokerage/application/refreshToken.ts
    - packages/core/src/brokerage/application/refreshToken.test.ts
    - packages/adapters/src/postgres/repos/job-runs.ts
    - packages/adapters/src/postgres/repos/job-runs.contract.test.ts
    - packages/adapters/src/memory/job-queue.ts
    - packages/adapters/src/memory/job-queue.test.ts
    - packages/contracts/src/jobs.ts
    - packages/contracts/src/index.ts
    - apps/server/src/adapters/http/jobs.routes.ts
    - apps/server/src/adapters/http/jobs.routes.test.ts
    - apps/worker/src/main.ts

key-decisions:
  - "CR-02: network/parse and unexpected throws return storage-error with message `${appId}: ${code}` (or the throw message) so pg-boss retries and the status flag never falsely claims expiry; invalid_grant/invalid_client stay auth-expired"
  - "CR-03: a single GROUP BY query with two MAX(...) FILTER aggregates plus a correlated subselect for the latest failed output — avoids two DISTINCT ON subqueries while keeping the empty-schema Pitfall-6 guard"
  - "lastError is only populated when lastErrorAt is non-null (a job with only completed runs has lastError=null)"
  - "WR-04: triggerJobBodyFor(name) is a factory returning a refined schema rather than refining triggerJobPayload in place — keeps triggerJobPayload.shape.calendarId intact for the MCP tool (MCP-02)"
  - "jobs.routes parses the body manually with triggerJobBodyFor(name) (not zValidator json) because the schema depends on the validated route-param name; a parse failure returns 400 before enqueueJob is called"
  - "IN-01: the worker does not enqueue triggers (only the server does) — the dead pgBossJobQueue construction was deleted rather than wired, and its now-unused import removed"

patterns-established:
  - "Name-dependent request-body validation: validate the param first, then safeParse the body against a per-name schema factory inside the handler"

requirements-completed: [JOB-01, MCP-02]

# Metrics
duration: ~10min
completed: 2026-06-21
status: complete
---

# Phase 5 Plan 10: Independent Gap Closures (CR-02/CR-03/WR-04/WR-05/IN-01) Summary

Closed the four review findings independent of the fills data path plus the IN-01 dead-wiring
cleanup. A transient 04:00 ET DNS blip no longer presents as "re-auth required" (CR-02); the
status surface can now show "last succeeded at X but now failing" (CR-03); an empty-body
rebuild trigger is rejected at the boundary instead of flooding the queue with a null-keyed job
(WR-04); and the in-memory twin returns the same ok(null) the real pg-boss adapter returns on a
dedup collision (WR-05).

## Tasks

### Task 1 — CR-02 token refresh error mapping + CR-03 independent job-runs (commit 7baeb71)

- **CR-02 (`refreshToken.ts`):** replaced the catch-all `auth-expired` on the network/parse
  branch and the unexpected-throw branch with a retryable `storage-error`. Terminal
  `invalid_grant`/`invalid_client` still map to `auth-expired`. Regression tests assert
  network → `storage-error` ("trader: network"), parse → `storage-error`, an unexpected throw →
  `storage-error`, and that neither writes half-state.
- **CR-03 (`job-runs.ts`):** replaced `DISTINCT ON (name)` (one row per job) with a `GROUP BY name`
  query using `MAX(completed_on) FILTER (WHERE state='completed')` and the same filtered on
  `'failed'`, plus a correlated subselect carrying the latest failed run's output into
  `lastError`. The Pitfall-6 empty/absent-schema guard (`ok({})`) is preserved. New testcontainer
  cases seed a completed-then-failed sequence for one job and assert both timestamps populate
  independently, and that a completed-only job has `lastErrorAt`/`lastError` null. Removed the
  now-unused `extractString` helper.

### Task 2 — WR-05 twin dedup + WR-04 rebuild calendarId boundary + IN-01 (commit 5e614e3)

- **WR-05 (`memory/job-queue.ts`):** the dedup-hit branch now returns `ok(null)` instead of
  `ok(existingJobId)`, mirroring the pg-boss singletonKey collision contract. Test updated to
  assert `first.value` is a string and `second.value` is null.
- **WR-04 (`contracts/jobs.ts` + `jobs.routes.ts`):** added `triggerJobBodyFor(name)` — a factory
  that returns `triggerJobPayload` refined to require `calendarId` only for `rebuild-journal`.
  `triggerJobPayload` (and its `.shape`) is untouched so the MCP tool keeps working. The route
  parses the body with this per-name schema and returns 400 (without calling `enqueueJob`) when a
  rebuild trigger omits `calendarId`. Other jobs remain calendarId-optional.
- **IN-01 (`worker/src/main.ts`):** deleted the dead `const pgBossJobQueue = ...; void pgBossJobQueue;`
  construction and removed the now-unused `makePgBossJobQueue` import. The worker consumes jobs; it
  does not enqueue triggers (the server does).

## Deviations from Plan

None for Rules 1-4. One in-scope tidy: removed the `extractString` helper in `job-runs.ts` that
became unused after the query rewrite (its only caller was the deleted DISTINCT ON mapping).

## Verification

- `bunx vitest run refreshToken` — 14/14 green.
- `cd packages/adapters && bunx vitest run job-runs.contract` — 7/7 green (testcontainers, Docker up).
- `bunx vitest run job-queue` (adapters) — 5/5 green.
- `bunx vitest run jobs` (contracts) — 6/6 green.
- `bunx vitest run jobs.routes` (server) — 7/7 green.
- `rg "void pgBossJobQueue" apps/worker/src/main.ts` — no matches (IN-01 removed).
- `rg -c "FILTER" packages/adapters/src/postgres/repos/job-runs.ts` — 2.
- `bun run typecheck` — clean.
- `bun run lint` — clean (only pre-existing boundaries v5→v6 legacy-selector warning).
- `bun run test` (full workspace) — 710/710 green.

## Self-Check: PASSED
