---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
plan: 04
subsystem: web
tags: [react-hook, sse, streaming, model-seam]

requires: ["38-01"]
provides:
  - "useLiveStream: liveSpot (number | null) + liveIndices (StreamIndicesEvent | null)"
  - "OverviewModel: live-aware engine spot + nullable displaySpot + liveSpot/liveIndices"
affects: [38-05, 38-06]

tech-stack:
  added: []
  patterns:
    - "Named SSE event listener + Zod safeParse + own freshness ref (copied from the ticks/ping pair)"
    - "Live-gated ternary seam: liveStatus==='live' && liveX!==null ? liveX : eodFallback"

key-files:
  created:
    - apps/web/src/screens/overview-mobile/useOverviewModel.test.ts
  modified:
    - apps/web/src/hooks/useLiveStream.ts
    - apps/web/src/hooks/useLiveStream.test.ts
    - apps/web/src/screens/overview-mobile/useOverviewModel.ts
    - packages/contracts/src/index.ts

key-decisions:
  - "Fixed a blocking bug inherited from 38-01: streamSpotEvent/streamIndicesEvent were added to stream-events.ts but never re-exported from the contracts package's public index.ts, so @morai/contracts resolved both as undefined at runtime (Rule 3 auto-fix, scoped commit to packages/contracts/src/index.ts only)."
  - "lastSpotAtRef is a private ref (not a public useState/exposed field) — no downstream consumer (38-05/38-06) reads a spot freshness timestamp, so the plan's optional 'expose lastSpotAt if a consumer needs it' clause was left unexposed (YAGNI)."
  - "Moved the single `const spot = ...` line to directly after the useLiveStream() destructure (no code between the two previously read `spot`), instead of moving the hook call itself — smaller diff, same effect."

patterns-established: []

requirements-completed: [LIVE-04]

coverage:
  - id: D1
    description: "A 'spot' SSE event updates liveSpot; malformed JSON or a bad-shape (+00:00 ts) frame is dropped, retaining last-known-good"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#4b. \"spot\"/\"indices\" events"
        status: pass
    human_judgment: false
  - id: D2
    description: "An 'indices' SSE event updates liveIndices, preserving a per-symbol null; malformed/bad-shape frames dropped, last-known-good retained"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#4b. \"spot\"/\"indices\" events"
        status: pass
    human_judgment: false
  - id: D3
    description: "A 'spot' frame stamps its own freshness ref and does NOT set hasReceivedFirstTick or bump the greeks clock — a spot-only feed never flips the greeks badge live (catch #26)"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useLiveStream.test.ts#a 'spot' event does not set hasReceivedFirstTick or affect status"
        status: pass
    human_judgment: false
  - id: D4
    description: "The model's engine spot is live-aware (live only while status==='live' AND liveSpot!==null), else gex.spot ?? 5800 unchanged"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/overview-mobile/useOverviewModel.test.ts#live branch / fallback branch / non-null-liveSpot-while-quiet"
        status: pass
    human_judgment: false
  - id: D5
    description: "The model exposes a nullable displaySpot — never the 5800 engine fallback — for honest header/hero rendering"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/overview-mobile/useOverviewModel.test.ts#cold-start branch"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 38 Plan 04: Web Hook + Model Seam (useLiveStream liveSpot/liveIndices + useOverviewModel live-aware spot) Summary

**Added `liveSpot`/`liveIndices` named-event listeners to `useLiveStream` (own freshness stamp, never the greeks clock) and collapsed `useOverviewModel`'s spot derivation onto a live-gated seam with a new nullable `displaySpot` — the single hook+model surface every Wave-3/4 spot/VIX consumer will read.**

## Interface for downstream plans (38-05, 38-06)

- `useLiveStream()` returns `liveSpot: number | null` and `liveIndices: StreamIndicesEvent | null` (both `null` until the first well-formed frame).
- `useOverviewModel()` returns:
  - `spot: number` — live-aware engine spot (live→`liveSpot`, else `gex?.spot ?? 5800`). Feeds `buildCalendarPosition`/`payoffDomain`/`scenario`/`railGreeks` unchanged.
  - `displaySpot: number | null` — honest display seam (live→`liveSpot`, else `gex?.spot`, else `null`). **Never** 5800. Use this for the header/hero chip.
  - `liveSpot` / `liveIndices` — passthrough from the hook, for the display + regime-gauge plans.
  - `liveStatus` was already exposed (unchanged) — the live gate for all of the above.

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 4 (+1 created)

## Accomplishments

- `useLiveStream.ts`: two new `es.addEventListener` blocks (`"spot"`, `"indices"`) mirroring the existing `"ticks"`/`"ping"` pattern — Zod `safeParse` per frame, malformed JSON or bad-shape dropped with last-known-good retained. A private `lastSpotAtRef` gives spot its own freshness anchor, deliberately never touching `lastTickOrConnectAtRef`/`hasReceivedFirstTick`, so a spot-only feed can never paint the greeks badge live.
- `useOverviewModel.ts`: the single `spot` derivation is now `liveStatus === "live" && liveSpot !== null ? liveSpot : (gex?.spot ?? 5800)`; a new `displaySpot` sibling drops the 5800 fallback for `null` instead. Both flow through the model's return and the `OverviewModel` interface.
- 30 tests green across both files (25 in `useLiveStream.test.ts`, 5 in the new `useOverviewModel.test.ts`); `bun run typecheck` and `bun run lint` both clean.

## Task Commits

1. **Task 1: useLiveStream liveSpot/liveIndices + own freshness stamp** — `4236ee2` (feat) — includes the `packages/contracts/src/index.ts` export fix (see Deviations).
2. **Task 2: useOverviewModel live-aware spot + displaySpot** — `efea981` (feat)

## Files Created/Modified

- `apps/web/src/hooks/useLiveStream.ts` — `liveSpot`/`liveIndices` state, `lastSpotAtRef`, two new named-event listeners, both added to `UseLiveStreamResult` and the returned object.
- `apps/web/src/hooks/useLiveStream.test.ts` — `dispatchSpot`/`dispatchIndices` FakeEventSource helpers, `SAMPLE_SPOT`/`SAMPLE_INDICES` fixtures (non-round, catch #20), 7 new test cases (update, malformed-JSON drop, bad-shape drop for both events, per-symbol-null preservation, and the "does not flip the greeks badge" proof).
- `apps/web/src/screens/overview-mobile/useOverviewModel.ts` — moved the single `spot` line to after the `useLiveStream()` destructure, added the live-gated ternary + `displaySpot`, added `liveSpot`/`liveIndices`/`displaySpot` to the `OverviewModel` interface and return.
- `apps/web/src/screens/overview-mobile/useOverviewModel.test.ts` (NEW) — `renderHook(() => useOverviewModel())` unit test with all data hooks mocked (mirrors `Overview.test.tsx`'s mock blocks); 5 cases covering live/fallback/cold-start branches, the "non-null liveSpot while quiet doesn't leak through" gate proof, and the liveSpot/liveIndices passthrough.
- `packages/contracts/src/index.ts` — added `streamSpotEvent`/`streamIndicesEvent` (+ their inferred types) to the existing stream-events barrel export block (see Deviations).

## Decisions Made

- Fixture spot values chosen to never coincide with any fallback constant (catch #20): `5842.375` in the hook test (no gex fixture in that file, but distinct from 5800); `7402.875` in the model test (distinct from both `GEX_FIXTURE.spot` 7381.12 and 5800).
- Kept `lastSpotAtRef` private — the plan's action text made exposing it conditional ("if a consumer needs it"), and neither 38-05 nor 38-06 reads a spot-freshness timestamp, so it stays an internal-only anchor (YAGNI).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `streamSpotEvent`/`streamIndicesEvent` never reached `@morai/contracts` at runtime**
- **Found during:** Task 1, first test run (RED confirmed for the wrong reason — `TypeError: Cannot read properties of undefined (reading 'safeParse')`).
- **Issue:** 38-01 added both schemas to `packages/contracts/src/stream-events.ts` and covered them in that file's own test, but never added them to `packages/contracts/src/index.ts`'s barrel export list — the package's `package.json` `"module"`/`"main"` point at `src/index.ts`, so any consumer importing from `@morai/contracts` (as this plan's `useLiveStream.ts` does) received `undefined` for both symbols.
- **Fix:** Added `streamSpotEvent`, `streamIndicesEvent` (+ `StreamSpotEvent`, `StreamIndicesEvent` types) to the existing stream-events export block in `packages/contracts/src/index.ts`, alongside the pre-existing `streamTicketResponse`/`streamLiveGreekEvent`/etc. entries.
- **Files modified:** `packages/contracts/src/index.ts`.
- **Commit:** `4236ee2` (pathspec-scoped alongside the Task 1 hook/test files — this is the only `packages/**` file touched, a one-line-per-export wiring fix with no overlap with the concurrent reauth work in that package).

## Issues Encountered

None beyond the above (which is documented as a deviation, not a blocker — resolved inline).

## User Setup Required

None.

## Next Phase Readiness

`useLiveStream`'s `liveSpot`/`liveIndices` and `useOverviewModel`'s `spot`/`displaySpot`/`liveSpot`/`liveIndices` are ready for 38-05 (Overview PillHeader/GexRail + OverviewMobile/MobileHero spot display consumers) and 38-06 (RegimeBoard/MarketRail live VIX-family gauges). Full plan-scoped suite green (30/30), `bun run typecheck` clean, `bun run lint` clean (exit 0). `Overview.test.tsx`'s pre-existing 85 tests re-verified green — its `useLiveStream` mock doesn't yet include `liveSpot`/`liveIndices`, and the model's live gate safely treats the resulting `undefined` as not-live, so no breakage. No blockers.

---
*Phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar*
*Completed: 2026-07-13*
