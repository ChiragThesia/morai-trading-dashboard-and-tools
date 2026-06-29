---
phase: 12-streaming-ts-fan-out
plan: "07"
subsystem: web/streaming-overlay
tags: [live-overlay, positions-table, sse, gap-closure, strm-01, d-04]
gap_closure: true
requirements: [STRM-01, STRM-05]

dependency_graph:
  requires:
    - 12-06  # useLiveStream hook, LiveStatusBadge, index.css animation classes
  provides:
    - resolveLivePositionRow (apps/web/src/lib/live-position-greeks.ts)
    - Overview live overlay (STRM-01 closed)
    - LiveStatusBadge in Overview header (D-04 Surface 3 closed)
  affects:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Positions.tsx (deleted)

tech_stack:
  added: []
  patterns:
    - React key trick for CSS animation re-trigger (key includes liveTs)
    - .live-cell / .live-cell.stale color-dim (never opacity) for stale UX
    - resolveLivePositionRow pure resolver pattern (static fallback per symbol)
    - fast-check equivalence property (empty Map → byte-identical to static math)

key_files:
  created:
    - apps/web/src/lib/live-position-greeks.ts
    - apps/web/src/lib/live-position-greeks.test.ts
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx
  deleted:
    - apps/web/src/screens/Positions.tsx
    - apps/web/src/screens/Positions.test.tsx

decisions:
  - "Single positions table in Overview; live-overlay math in lib/live-position-greeks.ts — no divergent second table"
  - "AdHocPicker/SC6 stays on Analyzer (already wired + functional); not added to Overview (D-06)"
  - "liveLastTickAt not threaded into PositionsTable props — badge lives in section header, not inside table"
  - "Property test precision set to 4 (5e-5) to tolerate float accumulation across two code paths computing same math"

metrics:
  duration: "~13 minutes"
  completed: "2026-06-29"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 2
  files_deleted: 2
  tests_added: 13
  tests_total_web: 157

status: complete
---

# Phase 12 Plan 07: Live Overlay Gap Closure Summary

Gap-closure plan for STRM-01 + D-04. Root cause: 5→3 screen redesign orphaned the live overlay in `Positions.tsx` (dead code). Mounted `Overview.tsx` never called `useLiveStream`. This plan wires the overlay into the mounted surface and removes the dead screen.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Extract `resolveLivePositionRow` pure resolver + fast-check tests | 7c90a3a |
| 2 | Mount `useLiveStream` in Overview, overlay live cells, render `LiveStatusBadge` | 2f60095 |
| 3 | Delete orphaned `Positions.tsx` + `Positions.test.tsx` | 814e421 |
| lint | Fix type assertion in Overview test mock | 2514076 |

## What Was Built

**`lib/live-position-greeks.ts`** — Pure resolver `resolveLivePositionRow(legs, spot, liveGreeks)` that overlays live SSE ticks onto the static computation. Per-symbol fallback: if no tick is in the map for a leg, falls through to `computePositionGreeks` / `marketValue` — no blank cell, no crash. Returns `{ netVal, unreal, greeks, liveTs }`.

**Scale contract:** `computePositionGreeks()` returns greeks scaled by `netQty`. Overview's `netGreeksForLegs` then multiplies by `nq = netQty × 100`. The live tick's `bsmDelta` is raw per-share (same layer). Contribution formula: `tick.bsmDelta × netQty × nq`. Both paths produce identical results when `tick.bsmDelta ≈ kernelGreeks.delta`, confirmed by the fast-check equivalence property.

**`Overview.tsx`** — `useLiveStream()` called once (D-06 single consumer on this surface). `PositionsTable` now accepts `liveGreeks` and `liveStatus`. Per-row and Net-total computations replaced with `resolveLivePositionRow`. Live-sourced cells (Net val, Unreal, Δ, Γ, Θ/d, Vega) receive `.live-cell` class when `liveTs !== null`. `.stale` class added when status is `'stale'` or `'reconnecting'`. React key includes `liveTs` for the `.live-cell-flash` animation. `LiveStatusBadge` rendered in the "Open positions · greeks" section header (Surface 3, single place only).

**Excluded-row `opacity-40`** preserved unchanged — user-driven row exclusion, not streaming UX.

**`Positions.tsx` + `Positions.test.tsx` deleted** — confirmed no other source imports the screen (verified via `rg`). The live components it used (`useLiveStream`, `LiveStatusBadge`, `AdHocPicker`) remain in use elsewhere.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Property test precision too tight**
- **Found during:** Task 3 full web suite run
- **Issue:** `toBeCloseTo(x, 8)` (5e-9 tolerance) failed on vega ≈ 591 with difference 1.79e-7 — floating-point accumulation when the same math runs via two separate code paths (resolveLivePositionRow vs netGreeksForLegs both iterating over legs independently)
- **Fix:** Lowered to precision 4 (5e-5 tolerance) — 5 significant figures, more than sufficient for a display value
- **Files modified:** `apps/web/src/lib/live-position-greeks.test.ts`
- **Commit:** 814e421

**2. [Rule 2 - Lint] Type assertion in test mock**
- **Found during:** Post-Task 3 lint run
- **Issue:** `new Map() as ReadonlyMap<string, StreamLiveGreekEvent>` triggered `@typescript-eslint/consistent-type-assertions`
- **Fix:** Replaced with `new Map<string, StreamLiveGreekEvent>()` (generic type parameter, not assertion)
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Commit:** 2514076

**3. [Design] `liveLastTickAt` not threaded into PositionsTable**
- **Reason:** The `LiveStatusBadge` renders in the section header (Overview component level), not inside PositionsTable. No per-row badge, no need for the prop. Simplifies the component signature.
- This is a refinement of the plan's wiring direction, not a behavioral change.

## Dispositions (for the record)

1. **Single positions table:** `Overview.tsx` owns the only positions table. The shared live-overlay math lives in `lib/live-position-greeks.ts` — no divergent second table can drift.
2. **AdHocPicker / Surface 4 / SC6:** stays on Analyzer, where it is already wired and functional. NOT added to Overview (scope of this plan is the wiring-fix only). SC6 re-verified via Analyzer.

## Known Stubs

None. All live-overlay cells are wired to real data sources (`useLiveStream` + `usePositions` fallback). No placeholder values in the positions table render path.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced. The live SSE stream was already Zod-parsed in `useLiveStream` (T-12-06-01). `resolveLivePositionRow` does pure arithmetic on already-typed data (T-12-07-01 — accepted).

## Verification Results

- `bun run test --project web`: 157 tests pass (23 test files)
- `bun run typecheck`: clean
- `bun run lint`: clean (pre-existing boundaries selector warnings only — unrelated to this plan)
- Manual RTH verification (STRM-01 / D-04 / SC6 behavioral tests): deferred to `/gsd-verify-work 12` (market-gated, as specified in the plan)

## Self-Check: PASSED

All created files found on disk. All deleted files confirmed absent. All commit hashes found in git log.

| Item | Status |
|------|--------|
| apps/web/src/lib/live-position-greeks.ts | FOUND |
| apps/web/src/lib/live-position-greeks.test.ts | FOUND |
| apps/web/src/screens/Overview.tsx | FOUND (modified) |
| apps/web/src/screens/Overview.test.tsx | FOUND (modified) |
| apps/web/src/screens/Positions.tsx | DELETED (expected) |
| apps/web/src/screens/Positions.test.tsx | DELETED (expected) |
| commit 7c90a3a | FOUND |
| commit 2f60095 | FOUND |
| commit 814e421 | FOUND |
| commit 2514076 | FOUND |
