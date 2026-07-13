---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
plan: 01
subsystem: api
tags: [zod, contracts, sse, streaming]

requires: []
provides:
  - "streamSpotEvent Zod schema + StreamSpotEvent type"
  - "streamIndicesEvent Zod schema + StreamIndicesEvent type"
affects: [38-03, 38-04]

tech-stack:
  added: []
  patterns:
    - "Additive SSE event schema alongside streamLiveGreekEvent/streamPingEvent in ONE contracts module"

key-files:
  created: []
  modified:
    - packages/contracts/src/stream-events.ts
    - packages/contracts/src/stream-events.test.ts

key-decisions:
  - "One batched streamIndicesEvent for all four VIX-family symbols (vix/vvix/vix9d/vix3m), each nullable — they always poll together and Schwab per-symbol failure must omit, not fabricate (Claude's discretion per CONTEXT Area 1 Q1)."

patterns-established: []

requirements-completed: [LIVE-01]

coverage:
  - id: D1
    description: "streamSpotEvent accepts a Z-suffixed {spot, ts} frame and rejects +00:00 / non-number spot / missing fields"
    requirement: "LIVE-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/stream-events.test.ts#streamSpotEvent"
        status: pass
    human_judgment: false
  - id: D2
    description: "streamIndicesEvent accepts a Z-suffixed frame with all-present or per-symbol-null VIX values and rejects +00:00 / wrong-typed fields"
    requirement: "LIVE-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/stream-events.test.ts#streamIndicesEvent"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing streamLiveGreekEvent / streamPingEvent schemas unchanged — additive only"
    verification:
      - kind: unit
        ref: "packages/contracts/src/stream-events.test.ts#streamLiveGreekEvent"
        status: pass
    human_judgment: false

duration: 2min
completed: 2026-07-13
status: complete
---

# Phase 38 Plan 01: Additive Spot + Indices SSE Contracts Summary

**Added `streamSpotEvent` and `streamIndicesEvent` Zod schemas to the shared stream-events contract module — the Z-suffix-enforced foundation for the server fan-out (38-03) and web hook (38-04) to build against.**

## Performance

- **Duration:** 2 min (commit-to-commit)
- **Started:** 2026-07-13T11:57:57-05:00
- **Completed:** 2026-07-13T11:58:47-05:00
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `streamSpotEvent = z.object({ spot: z.number(), ts: z.string().datetime() })` — dedicated live SPX spot SSE lane.
- `streamIndicesEvent` — one batched event for `vix`/`vvix`/`vix9d`/`vix3m` (each `.number().nullable()`) + `ts`, keyed by the four regime symbols since they always poll together.
- Both enforce the Z-suffix timestamp law (`z.string().datetime()` rejects a `+00:00` suffix, mirroring `streamLiveGreekEvent`'s existing case).
- Proved additive: a test asserts `streamLiveGreekEvent` still parses a known-good payload unchanged; a diff/grep check confirms zero lines were removed from the existing schema definitions.

## Task Commits

Both tasks landed together since the two schemas were added in one implementation pass after a single combined RED test file:

1. **Task 1 + 2: streamSpotEvent + streamIndicesEvent — RED** - `1112f38` (test)
2. **Task 1 + 2: streamSpotEvent + streamIndicesEvent — GREEN** - `ca121f6` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP updates are out of this agent's scope per the assignment — packages/contracts/** only).

## Files Created/Modified
- `packages/contracts/src/stream-events.ts` - Added `streamSpotEvent`/`StreamSpotEvent` and `streamIndicesEvent`/`StreamIndicesEvent` schemas + types, additive, placed between `streamFillEvent` and `streamPingEvent`.
- `packages/contracts/src/stream-events.test.ts` - Added `describe("streamSpotEvent")` and `describe("streamIndicesEvent")` blocks with accept/reject cases (Z-suffix accept, `+00:00` reject, wrong-type reject, missing-field reject, per-symbol-null accept) plus one assertion proving `streamLiveGreekEvent` still parses.

## Decisions Made
- One batched `streamIndicesEvent` (not four per-symbol events) — matches RESEARCH's recommendation cited in 38-PATTERNS.md and the fact that all four VIX-family symbols poll together in the sidecar.
- Fixture spot value `5842.375` (non-round) per catch #20 jsdom-honesty law, so downstream tests never coincide with a rounded production constant.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' RED tests were written together in a single edit (both describe blocks depend on the same two new imports), then both schemas implemented together — functionally equivalent to two sequential TDD cycles since neither schema depends on the other, and the combined RED run showed exactly the 9 expected failures (all `TypeError: Cannot read properties of undefined` from the two missing exports) with the 23 pre-existing tests still green.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`streamSpotEvent` and `streamIndicesEvent` are ready to import in 38-03 (server fan-out: `bufferSpot`/`flushSpot`, sidecar-sse dispatch branch) and 38-04 (web `useLiveStream` `"spot"`/`"indices"` event listeners). Full `bun run test -- --run packages/contracts` suite green (328 tests), `bun run typecheck` clean, lint clean on both touched files. No blockers.

---
*Phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar*
*Completed: 2026-07-13*
