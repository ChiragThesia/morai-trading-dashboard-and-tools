---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 01
subsystem: streaming
tags: [zod, vitest, fast-check, contracts, stream-status]

# Dependency graph
requires: []
provides:
  - "streamPingEvent/StreamPingEvent Zod schema in @morai/contracts — wire shape for the SSE ping heartbeat"
  - "deriveStreamStatus/DerivedStatus pure function in apps/web/src/lib — the single LIVE/QUIET/CONNECTING/STALLED derivation"
affects: [20-02, 20-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive Zod schema appended to an existing multi-schema contract file, mirroring the file's own schema/type-export idiom"
    - "Pure state-derivation function with caller-supplied elapsed time (no Date.now() inside), mirroring packages/core/src/journal/domain/rth-window.ts"

key-files:
  created:
    - apps/web/src/lib/deriveStreamStatus.ts
    - apps/web/src/lib/deriveStreamStatus.test.ts
  modified:
    - packages/contracts/src/stream-events.ts
    - packages/contracts/src/stream-events.test.ts

key-decisions:
  - "deriveStreamStatus lives in apps/web/src/lib (not hooks/) so it has zero React import and is unit-testable standalone (D-01/D-11)"
  - "Branch order locked exactly as RESEARCH Pattern 1: quiet (isRth===false) wins first, then connecting (isRth===null), then elapsed-vs-threshold — no reordering, no 4th enum member (D-01)"

patterns-established:
  - "Pattern 1: unified grace-then-escalate timer — deriveStreamStatus.ts (see RESEARCH.md for full rationale)"

requirements-completed: [WATCH-01]

coverage:
  - id: D1
    description: "streamPingEvent Zod schema round-trips {isRth:boolean}, rejects missing/non-boolean isRth, strips extra keys"
    requirement: "WATCH-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/stream-events.test.ts#streamPingEvent"
        status: pass
    human_judgment: false
  - id: D2
    description: "deriveStreamStatus pure function implements the four-branch LIVE/QUIET/CONNECTING/STALLED derivation with locked branch order and threshold boundary semantics"
    requirement: "WATCH-01"
    verification:
      - kind: unit
        ref: "apps/web/src/lib/deriveStreamStatus.test.ts#deriveStreamStatus: branch examples"
        status: pass
      - kind: unit
        ref: "apps/web/src/lib/deriveStreamStatus.test.ts#deriveStreamStatus: fast-check properties"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 01: WATCH-01 Foundation Primitives Summary

**Additive `streamPingEvent` Zod schema in `@morai/contracts` plus a pure `deriveStreamStatus` state-derivation function in `apps/web/src/lib`, both test-first, locking the wire shape and status logic that 20-02 (server) and 20-03 (client) build on in parallel.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-05T00:04Z (approx, local execution — no init timestamp available)
- **Completed:** 2026-07-05T05:08Z
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Added `streamPingEvent`/`StreamPingEvent` to `packages/contracts/src/stream-events.ts`, following the file's existing schema/type-export idiom exactly — the SSE ping heartbeat now has a single, additive-safe source of truth (`isRth: boolean` only, per T-20-01).
- Extracted `deriveStreamStatus`/`DerivedStatus` as a pure, framework-free function in `apps/web/src/lib/deriveStreamStatus.ts` — implements the unified grace-then-escalate timer (RESEARCH Pattern 1): quiet dominates, then connecting (no ping / cold-start grace), then elapsed-vs-threshold stall check with `== threshold` resolving to stalled.
- Locked the branch order and boundary semantics with example tests for every branch plus two fast-check properties (`numRuns: 1000` each): quiet-dominates (isRth===false ⇒ quiet for all other inputs) and stall-monotonic-in-elapsed (once stalled at some elapsed time, never returns to live at a larger elapsed time).

## Task Commits

Each task was committed atomically (RED+GREEN combined per commit, per `tdd.md` "commit at green only"):

1. **Task 1: streamPingEvent contract schema (D-03)** - `d499cef` (feat)
2. **Task 2: deriveStreamStatus pure function (D-01/D-02/D-11, Pattern 1)** - `2090dac` (feat)

_Note: RED test run and GREEN implementation were verified via `bun run test` before each commit; both are folded into a single commit per this repo's `tdd.md` convention ("commit at green only")._

## Files Created/Modified
- `packages/contracts/src/stream-events.ts` - added `streamPingEvent`/`StreamPingEvent` (isRth-only schema)
- `packages/contracts/src/stream-events.test.ts` - added round-trip/rejection/extra-keys tests for `streamPingEvent`
- `apps/web/src/lib/deriveStreamStatus.ts` - new pure `deriveStreamStatus` function + `DerivedStatus` type
- `apps/web/src/lib/deriveStreamStatus.test.ts` - branch-example tests + 2 fast-check properties

## Decisions Made
- Kept `deriveStreamStatus` in `apps/web/src/lib/` rather than `hooks/` so it carries zero React import and is directly unit-testable (matches PATTERNS.md guidance and the `rth-window.ts` analog).
- Did not add an automated "no Date.now()/no React import" source-text test — vitest's `import.meta.url` did not resolve to a `file://` scheme reliably in this environment (attempted, reverted). Verified manually via `grep` instead (no `Date.now()` call, no `react` import in the file) since this is a structural, not behavioral, property already guaranteed by the implementation being a single pure expression with a caller-supplied `msSinceLastTickOrConnect` parameter.

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed RED (test written and run first, confirmed failing for the right reason — missing export / unresolved module) → GREEN (minimal implementation, confirmed passing) exactly as specified.

## Issues Encountered

One test-authoring dead-end (not a deviation from the plan's task scope): an initial attempt to add a runtime "no `Date.now()`/no React import" purity test via `fs.readFile(new URL(..., import.meta.url))` failed with `TypeError: The URL must be of scheme file` under this repo's Vitest/Vite config. Removed the flaky test and verified the same property manually via `grep` (see Decisions Made). Does not affect the required behaviors, all of which are covered by the example + property tests specified in the plan's `<behavior>` blocks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`streamPingEvent` and `deriveStreamStatus` are both exported, typed, and covered by passing tests — ready for 20-02 (server: emit `{isRth}` on the existing ping SSE event using `isWithinRth`) and 20-03 (client: `es.addEventListener("ping", ...)` parsing via `streamPingEvent.safeParse` + interval calling `deriveStreamStatus`, per PATTERNS.md). No blockers.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commits (`d499cef`, `2090dac`) verified present in git log.
