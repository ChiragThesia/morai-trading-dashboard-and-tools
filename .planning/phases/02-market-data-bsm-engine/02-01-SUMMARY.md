---
phase: 02-market-data-bsm-engine
plan: "01"
subsystem: tooling-foundation
tags: [pg-boss, msw, vitest, cboe, fixtures, wave-0]
dependency_graph:
  requires: []
  provides:
    - pg-boss@12.18.3 installed in apps/worker
    - msw@2.14.6 installed in packages/adapters devDeps
    - apps/worker vitest project (name "apps/worker") discoverable by root glob
    - cboe-spx.fixture.json — deterministic SPX payload for msw tests
    - cboe-spxw.fixture.json — deterministic SPXW-root payload for msw tests
    - SPXW endpoint finding — _SPXW.json is 403; SPXW inside _SPX.json
  affects:
    - All Phase 2 plans that use msw (Plans 02, 03)
    - All Phase 2 plans with worker handler tests (Plans 05, 06, 07)
    - Plan 04 CBOE adapter (must NOT fetch _SPXW.json; filter SPXW by root from _SPX.json)
tech_stack:
  added:
    - pg-boss@12.18.3 (apps/worker dependencies — Postgres job queue)
    - msw@2.14.6 (packages/adapters devDependencies — HTTP mocking in tests)
  patterns:
    - Worker vitest config mirrors packages/adapters shape (defineConfig, resolve.alias, globals:false)
    - CBOE fixture trimming: keep top-level shape + ~30 contracts spanning expiries + in/out-of-band strikes
key_files:
  created:
    - apps/worker/vitest.config.ts
    - packages/adapters/test/fixtures/cboe-spx.fixture.json
    - packages/adapters/test/fixtures/cboe-spxw.fixture.json
    - packages/adapters/test/fixtures/README.md
  modified:
    - apps/worker/package.json (added pg-boss@^12.18.3)
    - packages/adapters/package.json (added msw@^2.14.6 devDep)
    - bun.lock (updated workspace lockfile)
decisions:
  - "SPXW endpoint: _SPXW.json returns HTTP 403 (S3 AccessDenied); fetch only _SPX.json and filter by OSI root"
  - "Timestamp format: CBOE serves ET local time without offset (2026-06-11 15:13:25); must convert to UTC before storage"
  - "Worker vitest config: no globalSetup (handler tests use in-memory adapters; no Docker needed)"
metrics:
  duration_seconds: 348
  completed_at: "2026-06-11T15:18:15Z"
  tasks_completed: 3
  files_created: 4
  files_modified: 3
---

# Phase 02 Plan 01: Wave 0 Tooling + Fixtures Summary

**One-liner:** pg-boss + msw installed, worker vitest project wired to root glob, live CBOE fixture captures resolving the SPXW endpoint question (SPXW is inside `_SPX.json`, `_SPXW.json` is 403).

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Package legitimacy gate (human-verify) | — | None (gate only; user approved) |
| 2 | Install pg-boss + msw, scaffold worker vitest | c86e4e1 | apps/worker/package.json, packages/adapters/package.json, apps/worker/vitest.config.ts |
| 3 | Live CBOE smoke check + record fixtures | 7e897a4 | packages/adapters/test/fixtures/* |

## SPXW Endpoint Finding (CRITICAL — Plan 04 dependency)

`_SPXW.json` returns HTTP 403 (S3 AccessDenied). This is not a 404 — the path is blocked
by an AWS S3 bucket policy. The live `_SPX.json` payload contains both SPX-root (10,454)
and SPXW-root (20,788) contracts in a single response (31,242 total on capture date).

**Plan 04 instruction:** Fetch only `_SPX.json`. Distinguish SPX vs SPXW by the OSI root
prefix (3 chars = `SPX`, 4 chars = `SPXW`). Do NOT attempt to fetch `_SPXW.json`.

## CBOE Timestamp Format (CRITICAL — Plan 04 dependency)

Live payload `timestamp`: `"2026-06-11 15:13:25"` — ET local time, no timezone suffix.
Must append ET offset (or convert via `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`)
before storing as `leg_observations.time` (timestamptz). Storing as-is causes Postgres to
interpret it as UTC, placing observations 4-5 hours off.

## Fixture Coverage

| Fixture | Contracts | Expiries | Out-of-band | File Size |
|---------|-----------|----------|-------------|-----------|
| cboe-spx.fixture.json | 31 | 260611, 260709, 260918, 271217 | 6 (strikes 6525, 8025) | 8.7 KB |
| cboe-spxw.fixture.json | 31 | 260611, 260709, 260918, 270331 | present | 20 KB |

Both fixtures include:
- Near-expiry contracts (260611 = today) for TTM edge-case tests
- >90 DTE contracts for the DTE filter boundary test
- Strikes inside AND outside the ±10% spot band for filter negative-case tests

## Verification Results

```
pgboss-ok                    # bun -e "import('pg-boss')" in apps/worker
msw-ok                       # bun -e "import('msw/node')" in packages/adapters
fixture-ok 31                # cboe-spx.fixture.json: 31 options, valid OSI, 6 out-of-band
apps/worker project resolves under root vitest glob (bunx vitest run --project "apps/worker" exits cleanly with "No test files found")
```

## Deviations from Plan

None — plan executed exactly as written.

The human-verify checkpoint (Task 1) was pre-approved by the orchestrator based on registry
metadata verification (pg-boss MIT/github.com/timgit/pg-boss/2016; msw MIT/github.com/mswjs/msw/2018)
and the user responded "approved" before this executor ran.

## Self-Check: PASSED

- `apps/worker/vitest.config.ts` exists: FOUND
- `packages/adapters/test/fixtures/cboe-spx.fixture.json` exists: FOUND
- `packages/adapters/test/fixtures/cboe-spxw.fixture.json` exists: FOUND
- `packages/adapters/test/fixtures/README.md` exists: FOUND
- Commit c86e4e1 (Task 2): FOUND
- Commit 7e897a4 (Task 3): FOUND
