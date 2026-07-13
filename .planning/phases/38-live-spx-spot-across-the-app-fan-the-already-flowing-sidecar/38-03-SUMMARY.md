---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
plan: 03
subsystem: api
tags: [sse, streaming, fan-out, zod]

requires: ["streamSpotEvent/streamIndicesEvent contract shapes (38-01)"]
provides:
  - "bufferSpot/flushSpot + bufferIndices/flushIndices coalescer lanes (stream-fan-out.ts)"
  - "broadcastSpot/broadcastIndices deps + dispatchFrame indices branch (sidecar-sse.ts)"
  - "main.ts composition-root wiring (broadcastSpot→bufferSpot, broadcastIndices→bufferIndices)"
affects: [38-04]

tech-stack:
  added: []
  patterns:
    - "On-change throttle: flush compares the staged value against a last-sent tracker and no-ops on an exact repeat, riding the SAME 1s flush interval as the existing ticks lane"
    - "Sidecar frame-type dispatch order: a new local wire schema is safeParsed BEFORE the existing schema it would otherwise be mistaken-rejected by"

key-files:
  created: []
  modified:
    - apps/server/src/adapters/http/stream-fan-out.ts
    - apps/server/src/adapters/http/stream-fan-out.test.ts
    - apps/server/src/adapters/http/strm04-regression.test.ts
    - apps/server/src/adapters/http/sidecar-sse.ts
    - apps/server/src/adapters/http/sidecar-sse.test.ts
    - apps/server/src/main.ts

key-decisions:
  - "Indices on-change comparison uses serialized (JSON.stringify) equality against a last-sent snapshot object, not a per-field diff — simpler and equivalent since the snapshot always has the same 4 keys in the same order (Task 1 action note offered either; picked serialized for one line instead of four field comparisons)."
  - "sidecarIndicesSchema uses a type: z.literal(\"indices\") discriminator (matches the sidecar wire shape from 38-02-PLAN.md: {type:'indices', vix, vvix, vix9d, vix3m, ts}) so safeParse cleanly rejects any tick frame (which has no type field) before it reaches the tick schema."

patterns-established: []

requirements-completed: [LIVE-02]

coverage:
  - id: T1
    description: "bufferSpot/flushSpot sends one named 'spot' SSE event on first buffer, no-ops on an unchanged repeat, sends again on a changed value, and cleans up dead clients (aborted + rejecting writeSSE) the same two ways as flushTicks"
    requirement: "LIVE-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/stream-fan-out.test.ts#bufferSpot / flushSpot — on-change throttle"
        status: pass
    human_judgment: false
  - id: T2
    description: "bufferIndices/flushIndices sends one named 'indices' SSE event, no-ops on an unchanged snapshot repeat (including when only one field changes vs. all four), preserves null fields, and cleans up dead clients"
    requirement: "LIVE-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/stream-fan-out.test.ts#bufferIndices / flushIndices — on-change throttle"
        status: pass
    human_judgment: false
  - id: T3
    description: "resetForTesting clears the new last-sent trackers so a repeated value sends fresh post-reset"
    requirement: "LIVE-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/stream-fan-out.test.ts#resetForTesting — clears spot/indices state"
        status: pass
    human_judgment: false
  - id: T4
    description: "The spot and indices lanes write zero leg_observations rows (STRM-04 pure in-memory) — extended the existing testcontainers regression gate"
    requirement: "LIVE-02"
    verification:
      - kind: integration
        ref: "apps/server/src/adapters/http/strm04-regression.test.ts#spot lane / indices lane write zero rows"
        status: pass
    human_judgment: false
  - id: T5
    description: "broadcastSpot fires alongside observeSpot at the same guarded underlyingPrice > 0 site; a throwing broadcastSpot is swallowed and does not sever the stream or block observeSpot"
    requirement: "LIVE-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/sidecar-sse.test.ts#broadcastSpot (Phase 38, LIVE-02)"
        status: pass
    human_judgment: false
  - id: T6
    description: "A valid indices frame Zod-parses against the new local sidecarIndicesSchema, calls broadcastIndices, and returns early (never reaches the option-tick schema/recompute path); a malformed indices frame is dropped silently; a throwing broadcastIndices is swallowed"
    requirement: "LIVE-02"
    verification:
      - kind: unit
        ref: "apps/server/src/adapters/http/sidecar-sse.test.ts#indices frame dispatch (Phase 38, LIVE-02)"
        status: pass
    human_judgment: false
  - id: T7
    description: "main.ts wires broadcastSpot→bufferSpot and broadcastIndices→bufferIndices beside the existing observeSpot line; typecheck and lint clean"
    requirement: "LIVE-02"
    verification:
      - kind: unit
        ref: "bun run typecheck (exit 0), bun run lint (exit 0, pre-existing config warnings only)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 38 Plan 03: Server Spot+Indices Fan-Out with On-Change Throttle Summary

**Added a dedicated `spot` SSE lane and a batched `indices` (VIX-family) SSE lane to the existing greeks fan-out hub, riding the same 1-second flush interval with a new on-change throttle so repeats of the same value are never re-sent.**

## Performance

- **Duration:** ~25 min (commit-to-commit across 3 tasks)
- **Completed:** 2026-07-13
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments

- `bufferSpot(spot, ts)` / `flushSpot()` — mirrors `bufferTick`/`flushTicks` exactly, plus an on-change throttle: a `lastSentSpot` tracker skips the write when the staged value equals the last one actually sent. Registered on the SAME `setInterval` as `flushTicks` (one timer, three siblings) — no second interval.
- `bufferIndices(values, ts)` / `flushIndices()` — same shape for the batched VIX-family snapshot (`vix`/`vvix`/`vix9d`/`vix3m`), compared for on-change via serialized equality against a `lastSentIndices` snapshot. Null fields pass through untouched (per-symbol omit, never fabricated).
- Both lanes reuse the existing two dead-client cleanup paths (`aborted` pre-check, `writeSSE` rejection `.catch`) and `resetForTesting()` clears all four new module-level state slots.
- `strm04-regression.test.ts` extended with two testcontainers tests proving the new lanes write zero `leg_observations` rows — the STRM-04 no-persistence gate now covers ticks, spot, AND indices.
- `sidecar-sse.ts`: `broadcastSpot` fires alongside `observeSpot` at the existing `underlyingPrice > 0` guard (a sibling call, `observeSpot` untouched — it still feeds SNAP-01). A new local `sidecarIndicesSchema` (`type: z.literal("indices")` discriminator) is `safeParse`d BEFORE the option-tick schema in `dispatchFrame` — order matters, since the tick schema has no `type` field check and would otherwise treat an indices frame as a malformed tick and drop it. On a successful indices parse, `broadcastIndices` fires and the function returns early, never reaching `recompute`/`bufferTick`.
- Both new callbacks (`broadcastSpot`, `broadcastIndices`) are wrapped in the same swallow-and-log-name-only try/catch discipline as `observeSpot` (REVIEW CR-01) — a throw in either can never reject `connectToSidecarStream` and sever the stream for every browser.
- `main.ts`: `broadcastSpot: (spot, ts) => bufferSpot(spot, ts)` and `broadcastIndices: (values, ts) => bufferIndices(values, ts)` wired into `runSidecarStreamWithReconnect`'s deps object, beside the existing `observeSpot` line. Pure composition-root wiring (TDD-exempt) — no second `startFlushInterval()` call needed since Task 1 already folded the new flushes into the existing one.

## Task Commits

1. **Task 1: spot+indices fan-out lanes with on-change throttle** — `f5d97fe` (feat, includes RED+GREEN in one commit — tests were written first and run to confirm the 14 new cases failed on missing exports before implementation)
2. **Task 2: sidecar-sse broadcastSpot + indices frame dispatch** — `fe455df` (feat, same RED-then-GREEN discipline — 3 new cases confirmed failing before the dep/dispatch changes landed)
3. **Task 3: main.ts wiring** — `d47375e` (feat, composition-root only, TDD-exempt per plan)

## Files Created/Modified

- `apps/server/src/adapters/http/stream-fan-out.ts` — `bufferSpot`/`flushSpot`, `bufferIndices`/`flushIndices`, `IndicesValues` type, `startFlushInterval` now drains all three lanes, `resetForTesting` clears the new state.
- `apps/server/src/adapters/http/stream-fan-out.test.ts` — 14 new tests: first-flush send, on-change no-op, changed-value resend, no-op conditions, both dead-client cleanup paths for BOTH lanes, plus a `resetForTesting` case proving the last-sent tracker clears.
- `apps/server/src/adapters/http/strm04-regression.test.ts` — 2 new testcontainers tests: spot lane and indices lane each write zero `leg_observations` rows.
- `apps/server/src/adapters/http/sidecar-sse.ts` — `sidecarIndicesSchema`, `IndicesValues` export, `broadcastSpot`/`broadcastIndices` optional deps, the guard-site sibling broadcast, and the `dispatchFrame` indices branch (checked before the tick schema).
- `apps/server/src/adapters/http/sidecar-sse.test.ts` — 9 new tests: broadcastSpot fires/doesn't-fire per the underlyingPrice guard, works when absent, survives a throw (with observeSpot still firing); indices frame parses/broadcasts/returns-early, preserves nulls, drops malformed frames, survives a throwing callback, and never reaches the tick path.
- `apps/server/src/main.ts` — import + deps wiring for `broadcastSpot`/`broadcastIndices`.

## Decisions Made

- Indices on-change comparison via `JSON.stringify` equality rather than four separate field comparisons — the snapshot object always has the same 4 keys in a stable order, so serialized equality is exactly equivalent and is the smaller diff (plan action text offered either as acceptable).
- `sidecarIndicesSchema` keys off a `type: z.literal("indices")` discriminator to match the sidecar's actual wire shape from 38-02-PLAN.md (`{type:'indices', vix, vvix, vix9d, vix3m, ts}`) rather than a bare shape-match — this makes the schema self-documenting and lets `safeParse` reject any tick frame instantly (ticks have no `type` field) without relying on subtler structural mismatches.

## Deviations from Plan

None — plan executed exactly as written. Both TDD tasks followed RED (tests written and run to confirm failure on missing exports/no-op dep wiring) then GREEN (implementation, tests passing) within a single commit per task, matching the precedent set by 38-01.

## Issues Encountered

None. Docker was available in this environment, so the STRM-04 testcontainers regression gate ran for real (not skipped) and confirmed zero `leg_observations` writes from both new lanes.

## User Setup Required

None — no external service configuration required. This plan is server-side wiring only.

## Next Phase Readiness

`bufferSpot`/`bufferIndices` are live in the fan-out hub and wired end-to-end from the sidecar tick/indices frames through to any registered SSE client via the existing `stream.routes.ts` route (unchanged — confirmed via grep, zero commits touched it in this plan). 38-04 (web `useLiveStream` hook) can now add `es.addEventListener("spot", ...)` / `("indices", ...)` listeners against a real, tested, on-change-throttled server-side source. Full targeted suite (`stream-fan-out.test.ts` + `sidecar-sse.test.ts` + `strm04-regression.test.ts`) green at 53 tests; `bun run typecheck` and `bun run lint` both clean. No blockers.

---
*Phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar*
*Completed: 2026-07-13*

## Self-Check: PASSED
- FOUND: `apps/server/src/adapters/http/stream-fan-out.ts`
- FOUND: `apps/server/src/adapters/http/sidecar-sse.ts`
- FOUND: `apps/server/src/main.ts`
- FOUND: commit `f5d97fe`
- FOUND: commit `fe455df`
- FOUND: commit `d47375e`
