---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
plan: 05
subsystem: web
tags: [react, live-data, honest-badge, spot-display]

requires: ["38-04"]
provides:
  - "keyLevelsFor(gex, spot?): the shared desktop+mobile Key-levels 'Spot' row seam, now live-aware"
  - "Overview PillHeader SPX chip, GexRail markers, and MobileHero SPX segment all read the model's live-aware spot/displaySpot"
affects: [38-06, 38-07]

tech-stack:
  added: []
  patterns:
    - "Optional override parameter default-preserves every existing caller (keyLevelsFor(gex, spot?) -> spot ?? gex.spot)"
    - "Honest live tint reuses the existing .live-dot CSS grammar (LiveStatusBadge) instead of inventing a bespoke badge"

key-files:
  modified:
    - apps/web/src/screens/overview-mobile/useOverviewModel.ts
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx
    - apps/web/src/screens/overview-mobile/OverviewMobile.tsx
    - apps/web/src/screens/overview-mobile/MobileHero.tsx
    - apps/web/src/screens/overview-mobile/MobileHero.test.tsx
    - apps/web/src/screens/overview-mobile/MobileMarketSection.tsx
    - apps/web/src/screens/overview-mobile/MobileMarketSection.test.tsx

key-decisions:
  - "The SPX chip's live marker reuses the exact .live-dot class already defined in index.css and rendered by LiveStatusBadge — placed inside MetricChip's label ReactNode slot (no new component, no bespoke badge, no edit to the shared MetricChip primitive which sits outside this plan's file scope)."
  - "Dropped a planned 4th test asserting GammaProfile/GexBars marker position directly — Recharts ReferenceLine renders the spot as an internal scale-computed SVG coordinate, not a queryable text/attribute value, so a real assertion there would require reverse-engineering chart internals for no additional signal beyond what the PayoffChart-props + Key-levels-row tests already prove (same `spot` variable feeds all three)."
  - "MobileHero's new liveStatus prop is optional (defaults to undefined -> EOD styling) so pre-38-05 callers/tests keep compiling without passing it; the BASE test fixture now sets it explicitly to 'quiet' for clarity."

requirements-completed: [LIVE-04]

coverage:
  - id: D1
    description: "Desktop SPX chip renders displaySpot with a live tint (text-blue + live-dot) while liveStatus==='live', and the honest EOD styling (text-dim, no dot) otherwise"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#LIVE-04: live-aware spot on the SPX chip + Key-levels Spot row + payoff hero (38-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "keyLevelsFor(gex, spot?) is called with the live-aware spot at BOTH sites (desktop GexRail, mobile MobileMarketSection) — the 'Spot' key-level row is no longer a bare gex.spot read at either call site"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx (Key-levels Spot row assertions) + MobileMarketSection.test.tsx#J13e"
        status: pass
      - kind: static
        ref: "grep -n 'keyLevelsFor(gex)' Overview.tsx MobileMarketSection.tsx -> 0 matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "GexRail's GammaProfile + GexBars spot markers read the model's live-aware engine spot, never gex.spot directly"
    requirement: "LIVE-04"
    verification:
      - kind: static
        ref: "grep -nE 'gex\\??\\.spot' Overview.tsx -> 0 matches"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mobile hero SPX shows the live value while live, else gex.spot (via displaySpot), else '—' — never the 5800 engine fallback; tints text-blue only while liveStatus==='live'"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/overview-mobile/MobileHero.test.tsx#LIVE-04 tests"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-13
status: complete
---

# Phase 38 Plan 05: Spot Display Consumers (PillHeader/GexRail + OverviewMobile/MobileHero) Summary

**Collapsed every remaining direct `gex.spot` read across the desktop and mobile Overview trees onto the model's live-aware seam from 38-04 — the SPX chip, GEX-rail chart markers, and both Key-levels "Spot" rows (desktop + mobile) now render the same one SPX number, live-tinted only while the stream is actually live.**

## What changed

- **`keyLevelsFor(gex, spot?)`** (`useOverviewModel.ts`) gained an optional live-spot override. Default (`spot ?? gex.spot`) preserves every existing caller untouched; both real call sites (`Overview.tsx`'s desktop `GexRail`, `MobileMarketSection.tsx`) now pass the model's live-aware spot so the "Spot" row matches the chip/hero.
- **Desktop `PillHeader`** SPX chip renders `displaySpot` (honest, never-5800) instead of `gex.spot`, with `valueClassName` gated on `liveStatus`: `text-blue` + a `.live-dot` marker (reusing `LiveStatusBadge`'s existing CSS class) only while `liveStatus === "live"`, `text-dim` (EOD) otherwise.
- **Desktop `GexRail`** now takes a `spot: number` prop (the model's live-aware engine spot) and threads it into `GammaProfile`, `GexBars`, and `keyLevelsFor` — replacing three bare `gex.spot` reads.
- **`OverviewMobile`** passes `m.displaySpot` (was `m.gex?.spot ?? null`) + `m.liveStatus` into `MobileHero`, and `m.spot` into `MobileMarketSection`.
- **`MobileHero`** gained an optional `liveStatus?: LiveStreamStatus` prop; the SPX segment tints `text-blue` only while live, `text-dim` otherwise (spot value itself unchanged: null → "—").
- **`MobileMarketSection`** gained a `spot: number | null` prop, passed as `keyLevelsFor(gex, spot ?? undefined)`.

## Verification

- `bun run test -- --run apps/web/src/screens/Overview.test.tsx apps/web/src/screens/overview-mobile/MobileHero.test.tsx apps/web/src/screens/overview-mobile/MobileMarketSection.test.tsx` — 3 files, 107 tests, all pass.
- Full workspace suite (regression check, `useOverviewModel.ts` is shared): 312 files, 3483 tests, all pass.
- `bun run typecheck` — clean. `bun run lint` — clean (only pre-existing project-wide boundary-config warnings, unrelated).
- `grep -nE 'gex\??\.spot' apps/web/src/screens/Overview.tsx` — 0 matches (no bare live-surface read survives).
- `grep -n 'keyLevelsFor(gex)' apps/web/src/screens/Overview.tsx apps/web/src/screens/overview-mobile/MobileMarketSection.tsx` — 0 matches (every call site passes the spot override).

## Task Commits

1. **Task 1: Desktop — `keyLevelsFor` spot override + PillHeader SPX chip + GexRail markers** — `20b4d5a` (feat)
2. **Task 2: Mobile — hero SPX + MobileMarketSection Key-levels on the live-aware seam** — `1252123` (feat)

## Files Modified

- `apps/web/src/screens/overview-mobile/useOverviewModel.ts` — `keyLevelsFor(gex, spot?)` signature change (the only edit in this shared file for this plan).
- `apps/web/src/screens/Overview.tsx` — `GexRail` takes `spot`; `PillHeader` takes `displaySpot`/`liveStatus` and renders the live-tinted SPX chip; `OverviewDesktop` threads `displaySpot` through.
- `apps/web/src/screens/Overview.test.tsx` — `useLiveStream` mock (factory + `setLiveStream` helper + `afterEach` reset) extended with `liveSpot`/`liveIndices`; new `LIVE-04` describe block (3 tests: live-status render, quiet-status fallback, live-dot honest marker).
- `apps/web/src/screens/overview-mobile/OverviewMobile.tsx` — `MobileHero` gets `spot={m.displaySpot}` + `liveStatus={m.liveStatus}`; `MobileMarketSection` gets `spot={m.spot}`.
- `apps/web/src/screens/overview-mobile/MobileHero.tsx` — optional `liveStatus` prop; SPX segment tint gated on it.
- `apps/web/src/screens/overview-mobile/MobileHero.test.tsx` — `BASE` fixture gains `liveStatus: "quiet"`; 2 new tests (live tint / EOD tint).
- `apps/web/src/screens/overview-mobile/MobileMarketSection.tsx` — `spot` prop; `keyLevelsFor(gex, spot ?? undefined)`.
- `apps/web/src/screens/overview-mobile/MobileMarketSection.test.tsx` — `renderSection()` default gains `spot: GEX_FIXTURE.spot`; 1 new test (J13e, live-spot override with a non-round fixture value).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Two pre-existing `mockUseLiveStream.mockReturnValue(...)` call sites in `Overview.test.tsx` needed `liveSpot`/`liveIndices` added**
- **Found during:** Task 1, extending the `useLiveStream` mock shape.
- **Issue:** Beyond the module-level `vi.mock` factory and the `setLiveStream` helper (both explicitly named in the plan), one more inline `mockUseLiveStream.mockReturnValue({...})` call (the "live-mark badge amber" test) constructs the full mock object by hand and would fail to typecheck against `UseLiveStreamResult` once `liveSpot`/`liveIndices` are required fields.
- **Fix:** Added `liveSpot: null, liveIndices: null` to that call site too.
- **Files modified:** `apps/web/src/screens/Overview.test.tsx` (same file already in scope).
- **Commit:** `20b4d5a` (same commit as the rest of Task 1's mock work).

None beyond the above — no architectural changes, no auth gates, no scope creep.

## Known Stubs

None — every changed surface reads real model data (`displaySpot`/`spot`/`liveStatus`), no hardcoded placeholders introduced.

## Threat Flags

None — this plan only re-points existing display reads onto an already-reviewed live-gated seam (38-04); it introduces no new network endpoint, auth path, or schema surface. The one threat register item (T-38-07, stale-as-live spoofing) is the honest-badge behavior this plan implements and tests directly.

## Next Phase Readiness

The desktop and mobile Overview trees now render exactly one SPX number, live-tinted only when the stream is actually live. 38-06 (regime gauges display-live/gate-EOD) can proceed independently — it consumes `liveIndices` from the same model seam, untouched by this plan. No blockers.

## Self-Check: PASSED

- `apps/web/src/screens/overview-mobile/useOverviewModel.ts` — FOUND
- `apps/web/src/screens/Overview.tsx` — FOUND
- `apps/web/src/screens/Overview.test.tsx` — FOUND
- `apps/web/src/screens/overview-mobile/OverviewMobile.tsx` — FOUND
- `apps/web/src/screens/overview-mobile/MobileHero.tsx` — FOUND
- `apps/web/src/screens/overview-mobile/MobileHero.test.tsx` — FOUND
- `apps/web/src/screens/overview-mobile/MobileMarketSection.tsx` — FOUND
- `apps/web/src/screens/overview-mobile/MobileMarketSection.test.tsx` — FOUND
- Commit `20b4d5a` — FOUND in `git log --oneline --all`
- Commit `1252123` — FOUND in `git log --oneline --all`

---
*Phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar*
*Completed: 2026-07-13*
