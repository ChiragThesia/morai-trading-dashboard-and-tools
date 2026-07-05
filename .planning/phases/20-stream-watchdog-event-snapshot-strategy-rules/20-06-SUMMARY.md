---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 06
subsystem: streaming
tags: [hexagonal, tdd, snapshot, cooldown, move-detection, sse, pg-boss, composition-root]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "20-04's detectLargeMove/isWithinCooldown/ForReadingLatestSnapshotTime + SnapshotRow.trigger passthrough; 20-05's trigger column + Postgres/memory readLatestSnapshotTime"
provides:
  - "observeSpot hook on ConnectToSidecarStreamDeps — fires on every valid SPX tick, independent of recompute outcome"
  - "onSpotObserved composition-root wiring in apps/server/src/main.ts (RTH gate -> detectLargeMove -> DB cooldown -> jobBoss.send)"
  - "Worker snapshot-calendars handler accepts an optional Zod-parsed trigger job-payload field"
  - "Missing @morai/core barrel re-exports for detectLargeMove/SpotSample/MOVE_WINDOW_MS/MOVE_THRESHOLD_PCT/isWithinCooldown/SNAPSHOT_COOLDOWN_MS (20-04 gap, same class as 20-05's ForReadingLatestSnapshotTime fix)"
affects: ["SNAP-01 deploy + UAT cycle (D-18) — this SUMMARY marks the feature code-complete"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composition-root wiring is TDD-exempt (tdd.md Scope) — Task 3's glue logic is covered by the pure-fn tests in 20-04 and the handler test in Task 2, not a new main.ts unit test"
    - "Fire-and-forget async chain from a synchronous tick-dispatch call site: onSpotObserved is called synchronously per tick from dispatchFrame, so the async cooldown-read + enqueue chain is void-ed with a terminal .catch to guarantee it never throws into the tick loop"
    - "Fail-safe skip on cooldown-read error — a DB read error on the cooldown check suppresses firing rather than risking an errant/duplicate snapshot"

key-files:
  created: []
  modified:
    - apps/server/src/adapters/http/sidecar-sse.ts
    - apps/server/src/adapters/http/sidecar-sse.test.ts
    - apps/worker/src/handlers/snapshot-calendars.ts
    - apps/worker/src/handlers/snapshot-calendars.test.ts
    - apps/server/src/main.ts
    - packages/core/src/streaming/index.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "observeSpot is called BEFORE the recompute call in dispatchFrame (not after), independent of recomputeLiveGreek's ok/err outcome — a bad option contract does not mean the spot itself is bad, and the plan's must_haves require the spot feed to survive a recompute failure."
  - "onSpotObserved's cooldown-read chain is voided with a terminal .catch (not just the inner result.ok check) even though the Postgres/memory readLatestSnapshotTime implementations never throw (they catch internally and return Result) — defense in depth against the plan's 'MUST NOT throw into the tick loop' prohibition, since dispatchFrame calls observeSpot synchronously per tick."
  - "Fixed the same barrel-export gap class 20-05 hit for ForReadingLatestSnapshotTime: 20-04 defined detectLargeMove/SpotSample/MOVE_WINDOW_MS/MOVE_THRESHOLD_PCT (streaming) and isWithinCooldown/SNAPSHOT_COOLDOWN_MS (journal) but never re-exported them through packages/core's barrels, so apps/server could not import them for the composition-root wiring required by this plan's must_haves. Added the re-exports (Rule 3 — blocking issue)."

requirements-completed: [SNAP-01]

coverage:
  - id: D1
    description: "dispatchFrame calls deps.observeSpot(underlyingPrice, ts) after a successful Zod parse whenever underlyingPrice is non-null and > 0, independent of recomputeLiveGreek's ok/err outcome; observeSpot is optional and its absence never throws"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/sidecar-sse.test.ts#observeSpot hook (SNAP-01, 20-06, Pattern 2) — 5 tests (valid tick, recompute-skip tick, null price, <=0 price, observeSpot absent)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Worker snapshot-calendars handler Zod-parses an optional trigger job-payload field (scheduled|event-move), defaults absent/invalid to scheduled, passes it to the use-case; RTH+holiday gate and compute-analytics chain enqueue are unchanged"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "apps/worker/src/handlers/snapshot-calendars.test.ts#propagates/defaults trigger — 4 new tests + all 6 pre-existing tests still pass (10/10 total)"
        status: pass
    human_judgment: false
  - id: D3
    description: "main.ts wires onSpotObserved: RTH+holiday gate -> detectLargeMove over a module-level moveWindow -> on trigger, DB cooldown read (fail-safe skip on error) -> fire-and-forget jobBoss.send('snapshot-calendars', {trigger:'event-move'}, {singletonKey:'event-move'}) — reuses the existing enqueue-only jobBoss, no new PgBoss client"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "bun run typecheck (monorepo, tsc --build --force) — clean"
        status: pass
      - kind: other
        ref: "rg -n \"onSpotObserved|moveWindow|event-move|isWithinCooldown|detectLargeMove\" apps/server/src/main.ts — all present"
        status: pass
    human_judgment: true
    rationale: "The composition-root wiring itself is TDD-exempt per tdd.md Scope (pure glue, covered by 20-04's pure-fn tests + this plan's Task 2 handler test) and typechecks/greps clean, but the manual SNAP-01 ship UAT in the plan's <verification> section (a real/injected >1% RTH move fires exactly one snapshot; a second move within 15min is cooldown-suppressed; off-hours no-op) requires a live or injected sidecar stream and has not been exercised end-to-end in this plan — deferred to the D-18 deploy + UAT cycle per the plan's <output> note."

duration: 6min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 06: SNAP-01 Wiring — Event-Triggered Snapshot Summary

**Server-side headless detector (observeSpot -> detectLargeMove -> DB cooldown -> jobBoss.send) wires the already-arriving SPX tick to a provenance-stamped supplemental snapshot, completing SNAP-01 code.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-05T01:13:00-05:00
- **Completed:** 2026-07-05T01:19:00-05:00
- **Tasks:** 3/3 completed
- **Files modified:** 8

## Accomplishments
- `observeSpot` hook added to `ConnectToSidecarStreamDeps` — fires on every valid tick with a priced underlying (`>0`), independent of `recomputeLiveGreek`'s ok/err outcome (a bad option contract does not mean the spot is bad).
- Worker `snapshot-calendars` handler now Zod-parses an optional `trigger` job-payload field and passes the resolved value to the use-case; empty/invalid payloads default to `"scheduled"`. The RTH+holiday gate and the `compute-analytics` chain enqueue are untouched.
- `main.ts` composes the full detection chain: RTH+holiday gate → `detectLargeMove` over a module-level `moveWindow` → on trigger, a DB cooldown read via the existing `calendarSnapshotsRepo.readLatestSnapshotTime` (fail-safe skip on read error) → `isWithinCooldown` → fire-and-forget `jobBoss.send("snapshot-calendars", {trigger:"event-move"}, {singletonKey:"event-move"})`. No new PgBoss client, no HTTP hop to the worker.
- Fixed a blocking barrel-export gap (Rule 3): `detectLargeMove`/`SpotSample`/`MOVE_WINDOW_MS`/`MOVE_THRESHOLD_PCT` and `isWithinCooldown`/`SNAPSHOT_COOLDOWN_MS` were defined in 20-04 but never re-exported through `packages/core`'s barrels — the same gap class 20-05 hit for `ForReadingLatestSnapshotTime`.

## Task Commits

Each task was committed atomically (TDD RED+GREEN combined per commit, per this repo's established pattern):

1. **Task 1: observeSpot hook in dispatchFrame (Pattern 2)** - `7ad1d9a` (feat)
2. **Task 2: Worker handler accepts optional trigger payload (D-12/D-15)** - `2b2f7dd` (feat)
3. **Task 3: main.ts wire onSpotObserved -> detect -> cooldown -> jobBoss.send** - `495e31a` (feat)

_Note: Tasks 1 and 2 are TDD (RED confirmed failing for the right reason — assertion failures on absent hook calls / uncalled-with-args — before implementing; test run output captured for both). Task 3 is composition-root wiring (TDD-exempt per tdd.md Scope), verified via typecheck + rg per the plan's own acceptance criteria; each commit includes both the test file and the implementation._

## Files Created/Modified
- `apps/server/src/adapters/http/sidecar-sse.ts` - added optional `observeSpot?: (spot: number, ts: string) => void` to `ConnectToSidecarStreamDeps`; guarded call right after Zod-parse success, before the recompute call
- `apps/server/src/adapters/http/sidecar-sse.test.ts` - 5 new tests: valid tick invokes observeSpot; recompute-skip tick still invokes it; null/<=0 underlyingPrice does not; observeSpot absent does not throw
- `apps/worker/src/handlers/snapshot-calendars.ts` - added a local Zod schema for the optional `trigger` job-payload field; parse-don't-cast, default `"scheduled"`; passes `{ trigger }` to `snapshotCalendarsUseCase`
- `apps/worker/src/handlers/snapshot-calendars.test.ts` - 4 new tests: event-move payload propagates; empty payload defaults to scheduled; invalid payload defaults to scheduled; event-move payload still no-ops off-hours (RTH gate unchanged)
- `apps/server/src/main.ts` - module-level `moveWindow` state + `onSpotObserved` composing the RTH gate, `detectLargeMove`, the DB cooldown read/check, and the fire-and-forget `jobBoss.send`; wired into the existing `connectToSidecarStream` deps as `observeSpot: onSpotObserved`
- `packages/core/src/streaming/index.ts` - re-exported `detectLargeMove`, `MOVE_WINDOW_MS`, `MOVE_THRESHOLD_PCT`, `SpotSample`
- `packages/core/src/journal/index.ts` - re-exported `isWithinCooldown`, `SNAPSHOT_COOLDOWN_MS`
- `packages/core/src/index.ts` - re-exported the above six symbols at the top-level `@morai/core` barrel

## Decisions Made
- **observeSpot fires before/independent of recompute, not after a successful recompute.** Placed the guarded `deps.observeSpot?.()` call immediately after the Zod-parse success branch, before `deps.recompute(...)` is invoked. This satisfies the plan's explicit must-have ("observeSpot fires even when recomputeLiveGreek fails") without needing to inspect the recompute result at all.
- **Terminal `.catch` on the whole async chain, not just the `.then` callback's inner logic.** Although the Postgres and memory `readLatestSnapshotTime` implementations never throw (both catch internally and return `Result`), `onSpotObserved` is invoked synchronously per tick from `dispatchFrame`. A defensive top-level `.catch` guarantees the plan's "MUST NOT throw into the tick loop" prohibition holds even if a future implementation regresses that guarantee.
- **Extended the barrel-export fix pattern from 20-05.** Rather than importing from the deep domain paths (`@morai/core/streaming/domain/spot-move-detector.ts`), added the missing re-exports to `packages/core`'s existing barrel chain (`streaming/index.ts` → `journal/index.ts` → top-level `index.ts`) so `apps/server` imports everything from the single `@morai/core` entrypoint, consistent with every other cross-package import in `main.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `@morai/core` barrel re-exports for the 20-04 pure detectors**
- **Found during:** Task 3, before writing any `main.ts` code (checked import surface first per the plan's `read_first` guidance)
- **Issue:** `detectLargeMove`, `SpotSample`, `MOVE_WINDOW_MS`, `MOVE_THRESHOLD_PCT` (from `packages/core/src/streaming/domain/spot-move-detector.ts`) and `isWithinCooldown`, `SNAPSHOT_COOLDOWN_MS` (from `packages/core/src/journal/domain/snapshot-cooldown.ts`) were implemented and tested in 20-04 but never added to `packages/core/src/streaming/index.ts`, `packages/core/src/journal/index.ts`, or the top-level `packages/core/src/index.ts` barrels. `apps/server/src/main.ts` therefore could not import them from `@morai/core` at all — this is the identical gap class 20-05 hit and fixed for `ForReadingLatestSnapshotTime`.
- **Fix:** Added the six missing re-exports across the three barrel files (streaming → journal → top-level), matching the existing export style and grouping used for sibling SNAP-01 exports (`ForReadingLatestSnapshotTime`, `isWithinRth`, `isNyseHoliday`).
- **Files modified:** `packages/core/src/streaming/index.ts`, `packages/core/src/journal/index.ts`, `packages/core/src/index.ts`
- **Verification:** Full monorepo `bun run typecheck` (`tsc --build --force`) clean before and after; full `bun run test` (203 files, 1926 tests) green after.
- **Commit:** `495e31a` (Task 3 commit)

No other deviations — plan executed exactly as written otherwise.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The barrel-export fix was strictly necessary for Task 3's `main.ts` imports to compile at all — no scope creep, no behavior change beyond making the already-shipped 20-04 pure functions importable from their public package entrypoint.

## Issues Encountered
None beyond the barrel-export gap above.

## User Setup Required
None — no new dependencies, no new migrations (migration 0016 from 20-05 was already generated; its live-DB application is tracked as a separate 20-05 deploy step, not this plan's scope). No new environment variables.

## Next Phase Readiness
- SNAP-01 is now code-complete: a large SPX move on the live sidecar stream, during RTH and outside NYSE holidays, will fire exactly one supplemental journal snapshot with `trigger:'event-move'` provenance, cooldown-correct across the server and worker processes via the shared Postgres `MAX(time)` ground truth.
- Ready for the D-18 deploy + UAT cycle: the plan's manual verification (an injected/real >1% SPX move during RTH enqueues exactly one supplemental snapshot; a second move within 15 min is cooldown-suppressed; off-hours no-op) has not been exercised end-to-end and requires a live or injected sidecar stream — flagged as `human_judgment: true` on coverage item D3.
- No blockers. Full monorepo suite (203 test files, 1926 tests), `bun run typecheck`, and `bun run lint` all green after this plan's changes.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*

## Self-Check: PASSED

All 8 created/modified source files and the SUMMARY.md file verified present on disk.
All 3 commit hashes (7ad1d9a, 2b2f7dd, 495e31a) verified present in git log.
