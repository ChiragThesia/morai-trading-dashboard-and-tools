---
phase: 03-calendar-journal-mvp
plan: "04"
subsystem: core-domain / worker-handler
tags: [tdd, holiday-gate, nyse, rth, pure-data, hexagonal]
dependency_graph:
  requires: ["03-01", "03-03"]
  provides: ["isNyseHoliday from @morai/core", "RTH+holiday gate in fetch-cboe-chain"]
  affects: ["apps/worker/src/handlers/fetch-cboe-chain.ts"]
tech_stack:
  added: []
  patterns: ["Intl.DateTimeFormat America/New_York date extraction (mirrors rth-window.ts)", "combined RTH+holiday gate pattern for handler no-ops"]
key_files:
  created:
    - packages/core/src/journal/domain/nyse-holidays.ts
    - packages/core/src/journal/domain/nyse-holidays.test.ts
  modified:
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - apps/worker/src/handlers/fetch-cboe-chain.ts
    - apps/worker/src/handlers/fetch-cboe-chain.test.ts
decisions:
  - "isNyseHoliday is pure data (no imports) with a static Set of 18 dates (9x2026, 9x2027) — re-research before 2028"
  - "July 4 2026 is a Saturday; no NYSE observance; 2026-07-03 early close treated as normal day per SPEC v1"
  - "Combined !isWithinRth(now) || isNyseHoliday(now) gate replaces RTH-only check in fetch-cboe-chain; fetch-rates gate deferred to plan 05 with its wiring"
  - "isNyseHoliday added to both packages/core/src/journal/index.ts and packages/core/src/index.ts (deviation: index.ts re-export line was missing — Rule 3 fix)"
metrics:
  duration: "~8 min"
  completed: "2026-06-14"
  tasks: 2
  files: 6
---

# Phase 03 Plan 04: NYSE Holiday Gate Summary

NYSE full-closure holiday awareness (CAL-05) as pure core domain data alongside `isWithinRth()`, with the combined RTH+holiday gate wired into the existing fetch-cboe-chain handler.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 (RED) | Failing tests for isNyseHoliday | 66eec25 | nyse-holidays.test.ts |
| 1 (GREEN) | NYSE holiday domain module | 6a34f47 | nyse-holidays.ts, journal/index.ts |
| 2 (RED) | Failing holiday no-op test for handler | 051dddf | fetch-cboe-chain.test.ts |
| 2 (GREEN) | RTH + holiday gate wired in handler | 31e413e | fetch-cboe-chain.ts, core/src/index.ts |

## What Was Built

`packages/core/src/journal/domain/nyse-holidays.ts` — pure data module with no imports. Defines `NYSE_HOLIDAYS` as a `Set<string>` of 18 ISO date strings (9 full closures in 2026, 9 in 2027). Exports `isNyseHoliday(now: Date): boolean` using `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" })` + `formatToParts` to extract the ET date, then checks `NYSE_HOLIDAYS.has(key)`. Returns false defensively if any Intl part is missing.

`apps/worker/src/handlers/fetch-cboe-chain.ts` — combined RTH+holiday gate: `const now = deps.now(); if (!isWithinRth(now) || isNyseHoliday(now)) { console.warn("fetch-cboe-chain: skipping — outside RTH or NYSE holiday"); return; }`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] isNyseHoliday missing from packages/core/src/index.ts**
- **Found during:** Task 2 (tests failed with "isNyseHoliday is not a function")
- **Issue:** The plan said to add the export to `packages/core/src/journal/index.ts` (done). However `packages/core/src/index.ts` (the top-level `@morai/core` barrel) had a separate explicit re-export line for domain functions and `isNyseHoliday` was not included there. Worker tests import from `@morai/core`, which resolves to `src/index.ts`.
- **Fix:** Added `isNyseHoliday` to the re-export line in `packages/core/src/index.ts`.
- **Files modified:** packages/core/src/index.ts
- **Commit:** 31e413e (GREEN commit for Task 2)

## TDD Gate Compliance

- RED gate: `test(03-04)` commit 66eec25 (nyse-holidays) + 051dddf (handler)
- GREEN gate: `feat(03-04)` commit 6a34f47 (module) + 31e413e (handler)
- Both RED commits confirmed failing before GREEN — tests ran and failed for the correct reason

## Verification Evidence

```
Test Files  34 passed (34)
     Tests  309 passed (309)
  Duration  9.44s
```

`bun run typecheck` — clean (tsc --build --force, no errors)

Acceptance criteria checked:
- `rg '"2026-07-04"' packages/core/src/journal/domain/nyse-holidays.ts` → 0 matches (correct)
- NYSE_HOLIDAYS has 18 entries (9 x 2026, 9 x 2027)
- `isNyseHoliday` exported from journal/index.ts and core/src/index.ts
- Holiday no-op test asserts use-case not called on 2026-01-01T14:00:00Z

## Known Stubs

None — all behavior implemented and verified.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. `isNyseHoliday` is pure data; the handler gate prevents writes on holidays (T-03-08 mitigation verified by test).

## Self-Check

- [x] nyse-holidays.ts exists
- [x] nyse-holidays.test.ts exists
- [x] fetch-cboe-chain.ts modified
- [x] fetch-cboe-chain.test.ts modified
- [x] All commits exist (66eec25, 6a34f47, 051dddf, 31e413e)
- [x] Full suite green (309 tests)
- [x] typecheck clean
