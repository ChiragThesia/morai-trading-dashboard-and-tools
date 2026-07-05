---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 02
subsystem: streaming
tags: [sse, hono, zod, rth, watchdog]

# Dependency graph
requires:
  - phase: 20-01
    provides: "streamPingEvent Zod schema + StreamPingEvent type in @morai/contracts, deriveStreamStatus in packages/core"
provides:
  - "GET /api/stream ping heartbeat carries server-authoritative { isRth: boolean } on both duplicated ping-emit sites"
  - "streamPingEvent/StreamPingEvent re-exported from the @morai/contracts package barrel (was missing since 20-01)"
affects: [20-03, 20-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-computed truth pushed over SSE heartbeat instead of trusting a client-side clock"
    - "Reuse the exact @morai/core RTH predicate (isWithinRth && !isNyseHoliday) already used by the worker's snapshot gate — never a second RTH implementation"

key-files:
  created: []
  modified:
    - apps/server/src/adapters/http/stream.routes.ts
    - apps/server/src/adapters/http/stream.routes.test.ts
    - packages/contracts/src/index.ts
    - docs/architecture/streaming-fanout.md

key-decisions:
  - "isRth computed as isWithinRth(now) && !isNyseHoliday(now), same predicate apps/worker/src/handlers/snapshot-calendars.ts already gates on — single source of RTH truth (T-20-03 mitigation)"
  - "30s stream.sleep ping interval left unchanged; ping cadence and the client's ~20s stall threshold are orthogonal (Pitfall 5)"

patterns-established:
  - "Fake timers (vi.useFakeTimers + vi.setSystemTime + vi.advanceTimersByTimeAsync) to drive a real 30s SSE ping loop in tests without a real 30s wait"

requirements-completed: [WATCH-01]

coverage:
  - id: D1
    description: "Both duplicated GET /api/stream ping-emit sites (JWT-inside streamRoutes handler and ticket-only makeStreamSseRouter handler) emit streamPingEvent JSON with isRth true under an open-market clock"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/stream.routes.test.ts#GET /api/stream — ping heartbeat carries isRth (WATCH-01, D-03) > emits a ping frame whose data parses via streamPingEvent with isRth true under an open-market clock"
        status: pass
    human_judgment: false
  - id: D2
    description: "Ping isRth is false under a holiday clock even during RTH hours (AND of isWithinRth and !isNyseHoliday, not just weekday check)"
    requirement: WATCH-01
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/stream.routes.test.ts#GET /api/stream — ping heartbeat carries isRth (WATCH-01, D-03) > emits a ping frame with isRth false under a holiday clock (RTH hours, NYSE closed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "streamPingEvent/StreamPingEvent are actually importable from @morai/contracts (barrel export gap from 20-01 fixed)"
    verification:
      - kind: unit
        ref: "packages/contracts/src/stream-events.test.ts#streamPingEvent"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 02: SSE Ping Heartbeat Carries Server RTH Truth Summary

**Both duplicated GET /api/stream ping-emit sites now push `{isRth}` computed via `@morai/core`'s `isWithinRth`/`isNyseHoliday`, replacing the empty keep-alive frame — plus a barrel-export fix so `@morai/contracts` actually exposes `streamPingEvent`.**

## Performance

- **Duration:** 25 min
- **Tasks:** 2/2 completed
- **Files modified:** 4

## Accomplishments
- Replaced `data: ""` with `data: JSON.stringify(streamPingEvent.parse({ isRth }))` on both the JWT-inside (`streamRoutes`) and ticket-only (`makeStreamSseRouter`) ping-emit sites, keeping them in sync as the file's own comment requires.
- `isRth` is computed from `isWithinRth(now) && !isNyseHoliday(now)` — the identical predicate `apps/worker/src/handlers/snapshot-calendars.ts` already gates snapshot compute on, so the badge and the snapshot job can never disagree on market state.
- Left the 30s `stream.sleep(30_000)` ping interval untouched (Pitfall 5 — ping cadence and the client's stall threshold are orthogonal).
- Documented the additive heartbeat contract change in `docs/architecture/streaming-fanout.md`.
- Fixed a real Rule 3 blocker: `streamPingEvent`/`StreamPingEvent` existed in `packages/contracts/src/stream-events.ts` since 20-01 but were never re-exported from the package's `index.ts` barrel, so the intended `import { streamPingEvent } from "@morai/contracts"` resolved to `undefined` at runtime.

## Task Commits

Each task was committed atomically:

1. **Task 1: Emit isRth on both ping call sites (D-03)** - `6e5690f` (feat)
2. **Task 2: Document the heartbeat contract change** - `37dc8d5` (docs)

_Note: Task 1 is a combined RED+GREEN commit per tdd.md (this project commits at green)._

## Files Created/Modified
- `apps/server/src/adapters/http/stream.routes.ts` - both ping-emit sites now emit `streamPingEvent.parse({ isRth })`; imports `isWithinRth`/`isNyseHoliday` from `@morai/core` and `streamPingEvent` from `@morai/contracts`
- `apps/server/src/adapters/http/stream.routes.test.ts` - two new tests: ping frame `isRth: true` under an open-market clock (Monday 11:00 ET) and `isRth: false` under a holiday clock (New Year's Day, 10:00 ET, RTH hours but NYSE closed); uses `vi.useFakeTimers()`/`vi.setSystemTime`/`vi.advanceTimersByTimeAsync(30_000)` to drive the real 30s ping loop without a real wait
- `packages/contracts/src/index.ts` - re-exports `streamPingEvent`/`StreamPingEvent` from `stream-events.ts` (was missing)
- `docs/architecture/streaming-fanout.md` - new "Ping Heartbeat Carries `isRth`" section (Hemingway style, no line-number refs)

## Decisions Made
- Reused `apps/worker/src/handlers/snapshot-calendars.ts`'s exact `isWithinRth`/`isNyseHoliday` import path rather than writing any new RTH logic (Don't-Hand-Roll #1, T-20-03 mitigation).
- Test holiday case picked New Year's Day 2026-01-01 at 10:00 ET specifically because it is within RTH clock hours but a full NYSE closure — this proves the implementation ANDs both predicates rather than only checking weekday.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `streamPingEvent`/`StreamPingEvent` barrel export in `@morai/contracts`**
- **Found during:** Task 1, first test run after implementing the ping payload change
- **Issue:** `import { streamPingEvent } from "@morai/contracts"` resolved to `undefined` at runtime (`TypeError: Cannot read properties of undefined (reading 'parse')`). 20-01 added the schema to `packages/contracts/src/stream-events.ts` and its own test imported directly from that file, but never added it to the package's `index.ts` barrel — so no consumer outside `packages/contracts` could actually import it.
- **Fix:** Added `streamPingEvent`/`StreamPingEvent` to the existing stream-events export block in `packages/contracts/src/index.ts`, alongside the other stream contracts.
- **Files modified:** `packages/contracts/src/index.ts`
- **Verification:** `bun run test -- apps/server/src/adapters/http/stream.routes.test.ts` (17/17 pass) and `bun run test -- packages/contracts/src/stream-events.test.ts` (22/22 pass)
- **Committed in:** `6e5690f` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to complete Task 1 as written; no scope creep — only the missing export line was added, no other barrel entries touched.

## Issues Encountered
- Initial test design for the ping-frame assertions needed to trigger a real 30s `stream.sleep(30_000)` loop inside a unit test. Resolved with `vi.useFakeTimers()` + `vi.setSystemTime()` (fixes both the timer heap and `new Date()` output together) + `vi.advanceTimersByTimeAsync(30_000)`, wrapped in try/finally with `vi.useRealTimers()` to avoid leaking fake timers into other tests in the file.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `ping` SSE frame now carries `{isRth}` end-to-end from server truth, ready for 20-03 (client-side `useLiveStream` hook) to consume via `es.addEventListener("ping", ...)` and feed `deriveStreamStatus` (20-01) without needing a local RTH clock.
- `@morai/contracts`'s `streamPingEvent` export gap is closed — any future plan consuming it from outside `packages/contracts` will work correctly.
- No blockers for 20-03/20-04.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*

## Self-Check: PASSED
All created/modified files found on disk; all commit hashes (6e5690f, 37dc8d5, b981332) found in git log.
