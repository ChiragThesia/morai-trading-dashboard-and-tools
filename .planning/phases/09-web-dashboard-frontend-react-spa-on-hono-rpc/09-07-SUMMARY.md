---
phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc
plan: "07"
subsystem: journal-screen
tags: [journal, lifecycle-chart, tdd, journal-01, rebuild-01]
status: complete

dependency_graph:
  requires:
    - 09-05 (apiFetch + Zod hooks pattern; useStatus; rpc.ts)
  provides:
    - apps/web/src/lib/journal-history.ts (classifyTradeHistory — pure JOURNAL-01 classifier)
    - apps/web/src/lib/journal-history.test.ts (7 passing tests for all trade-history cases)
    - apps/web/src/hooks/useJournal.ts (60s poll of GET /api/journal/:calendarId, journalResponse.parse)
    - apps/web/src/hooks/useRebuildJournal.ts (useMutation POST /api/jobs/rebuild-journal/trigger)
    - apps/web/src/components/LifecycleChart.tsx (visx LinePath+AreaClosed, 3 tabs, scrubber)
    - apps/web/src/components/RebuildButton.tsx (Dialog + locked destructive copy, REBUILD-01)
    - apps/web/src/screens/Journal.tsx (3-column UI-SPEC layout, JOURNAL-01 graceful UX)
    - apps/web/src/screens/Journal.test.tsx (4 passing tests: empty, pre-Jun-12, history, rebuild)
  affects:
    - Plan 09-08 (Journal screen added to Shell screen map)
    - Plan 09-10 (trade data wire-up — currently Journal receives trades as props)

tech_stack:
  added: []
  patterns:
    - classifyTradeHistory: pure fn, hasSnapshots is authoritative signal (date math is fallback)
    - useJournal mirrors useStatus/useGex pattern (401 short-circuit, parse-don't-cast)
    - useRebuildJournal: useMutation + onSuccess query invalidation
    - LifecycleChart: visx AreaClosed+LinePath, isLifecycleMode type guard (no as-cast)
    - RebuildButton: Dialog.Close uses render= prop pattern (not asChild — base-ui API)
    - Journal: 3-column CSS grid, classifyTradeHistory drives badge + center content

key_files:
  created:
    - apps/web/src/lib/journal-history.ts
    - apps/web/src/lib/journal-history.test.ts
    - apps/web/src/hooks/useJournal.ts
    - apps/web/src/hooks/useRebuildJournal.ts
    - apps/web/src/components/LifecycleChart.tsx
    - apps/web/src/components/RebuildButton.tsx
    - apps/web/src/screens/Journal.tsx
    - apps/web/src/screens/Journal.test.tsx
  modified: []

decisions:
  - "hasSnapshots (boolean) is the authoritative signal for classifyTradeHistory — server-side knowledge of whether any chain data exists is more reliable than client-side date math alone"
  - "LIFECYCLE_MODES as const + isLifecycleMode type guard replaces as-cast for Tabs onValueChange (no consistent-type-assertions violation)"
  - "DialogClose uses render= prop (not asChild) to wrap a Button — base-ui Dialog API does not expose asChild prop; render= is the base-ui pattern for polymorphic rendering"
  - "Journal accepts trades as props (not fetching them itself) — trade list sourced from a future positions/journal aggregation API; Plan 09-10 wires real data"
  - "Journal.test.tsx uses getAllByText for trade name assertions — name appears in both the list and the lifecycle header, causing getByText to fail on multiple matches"

metrics:
  duration: "9min"
  completed: "2026-06-25"
  tasks_completed: 3
  tasks_total: 3
  files_created: 8
  files_modified: 0
---

# Phase 09 Plan 07: Journal Screen Summary

Journal screen with 30-min snapshot lifecycle chart (Running P&L / Price & spot / Greeks tabs), scrubber, pre-Jun-12 graceful UX (JOURNAL-01), and per-calendar rebuild button behind a confirmation dialog (REBUILD-01) — proven by 11 passing tests (7 classifier + 4 screen).

## What Was Built

**Task 1 — Pre-Jun-12 history classifier + journal/rebuild hooks (commits 185ffa4, b9f4313)**

RED (`journal-history.test.ts`): 7 tests asserting `classifyTradeHistory` returns "history" for trades with `hasSnapshots: true` and "entry-exit-only" for pre-Jun-12 closed trades with no snapshots. Correctly failed at import (no implementation).

GREEN:
- `journal-history.ts`: `CHAIN_HISTORY_START = "2026-06-12"`, `classifyTradeHistory(trade)` — pure function. `hasSnapshots` is the authoritative signal (if server returned snapshots, chain data exists regardless of date). Date math is the fallback when `hasSnapshots: false`.
- `useJournal.ts`: `useQuery({ queryKey: ["journal", calendarId], refetchInterval: 60_000, staleTime: 50_000 })`, parses through `journalResponse.parse()`, 401 short-circuit matching useStatus pattern.
- `useRebuildJournal.ts`: `useMutation` POSTing `{ calendarId }` to `/api/jobs/rebuild-journal/trigger`, invalidates `["journal", calendarId]` on success. No `any`/`as`/`!`.

All 7 tests pass. `bun run typecheck` green.

**Task 2 — LifecycleChart + RebuildButton (commit 7dfd1ce)**

`LifecycleChart.tsx`: visx `AreaClosed` + `LinePath` with `curveMonotoneX`. Three locked mode tabs using shadcn `Tabs`:
- Running P&L → violet `#a78bfa` curve + area fill
- Price & spot → blue `#5b9cf6` curve
- Greeks → teal `#26a69a` vega curve

Day-separator dashed vertical lines `#27313f` with `snapDayLabel` labels. Scrubber `<input type="range">` tracks selected snapshot with highlighted circle on curve. `isLifecycleMode` type guard (no `as`-cast) for the `Tabs.onValueChange` callback.

`RebuildButton.tsx`: shadcn `Dialog` with locked destructive copy "Rebuild journal for \"{calendarId}\"? This overwrites all snapshot history. [Rebuild] [Cancel]". `DialogClose` uses `render=` prop (base-ui pattern — no `asChild`). [Rebuild] fires `useRebuildJournal.mutate(calendarId)` and closes on settle. `bun run typecheck` + `bun run lint` green.

**Task 3 — Journal screen assembled (commits 8298235, 62b23af)**

RED (`Journal.test.tsx`): 4 tests asserting: empty journal → "No journal history yet" copy; pre-Jun-12 trade → "entry/exit" badge + "no day-by-day (pre Jun-12)" stub (no error); history trade → "Lifecycle" heading + snapshot table columns; RebuildButton present. Correctly failed at import.

GREEN (`Journal.tsx`): 3-column CSS grid (`250px | 1fr | 290px`, gap 12px). Left trade list: rows with history/entry-exit/OPEN badges, `classifyTradeHistory` drives badge color. Center lifecycle: `LifecycleSection` renders `LifecycleChart` (for `kind === "history"` with >1 snapshot) OR `PreHistoryStub` (for `kind === "entry-exit-only"`) — never error, never blank (JOURNAL-01). `RebuildButton` present in center column. Right: `SnapshotTable` (Time/SPX/Net/P&L/Θ/Vega), "Why it moved" callout, Notes `<textarea>` with locked placeholder.

All 4 screen tests pass. 11/11 total plan tests pass. Full workspace: 1208/1208 tests, typecheck clean, lint clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DialogClose.asChild not valid in base-ui**
- **Found during:** Task 2 typecheck
- **Issue:** `<DialogClose asChild>` fails typecheck — base-ui `Dialog.Close` does not expose `asChild` (that is a Radix pattern). The project uses `@base-ui/react`.
- **Fix:** Used `DialogClose render={<Button ... />}` (base-ui's polymorphic render prop) pattern instead.
- **Files modified:** `apps/web/src/components/RebuildButton.tsx`
- **Commit:** 7dfd1ce

**2. [Rule 1 - Bug] getByText on trade name matched multiple elements**
- **Found during:** Task 3 test run
- **Issue:** Trade name "7375P (pre-Jun-12)" appears in both the left list and the center lifecycle header. `screen.getByText(/7375P/)` threw "multiple elements found".
- **Fix:** Changed to `screen.getAllByText(/7375P/).length > 0` to accept the multi-occurrence.
- **Files modified:** `apps/web/src/screens/Journal.test.tsx`
- **Commit:** 62b23af

**3. [Rule 2 - Auto-add] isLifecycleMode type guard instead of as-cast**
- **Found during:** Task 2 lint
- **Issue:** `val as LifecycleMode` in Tabs `onValueChange` violates `@typescript-eslint/consistent-type-assertions` rule (no `as` casts). First attempt also used `LIFECYCLE_MODES as ReadonlyArray<string>` which also failed.
- **Fix:** `LIFECYCLE_MODES.some((m) => m === val)` — no assertion, uses TypeScript narrowing.
- **Files modified:** `apps/web/src/components/LifecycleChart.tsx`
- **Commit:** 7dfd1ce

## Verification Results

```
bun run vitest run apps/web/src/lib/journal-history.test.ts → 7/7 pass
bun run vitest run apps/web/src/screens/Journal.test.tsx → 4/4 pass
bun run test (full workspace) → 128 test files, 1208 tests, all pass
bun run typecheck (apps/web) → exit 0, no errors
bun run lint (root) → exit 0, no errors (only pre-existing boundary warnings)
grep -q '2026-06-12' journal-history.ts → OK
grep -q 'Running P&L' LifecycleChart.tsx → OK
grep -qi 'overwrites all snapshot history' RebuildButton.tsx → OK
```

## Known Stubs

- **Journal receives trades as props** — the Journal screen expects its parent (Shell/App.tsx) to supply a `trades: ReadonlyArray<TradeSummary>` array. Plan 09-10 wires the real trade list from the API (GET /api/positions or a dedicated journal-trades endpoint). Currently the screen renders correctly in isolation but shows empty state when integrated until the parent supplies real trades.
- **Notes textarea** — not persisted to backend (no PUT endpoint for notes). Renders the locked placeholder and is editable in-session only. Persistence is out of scope for Phase 9.
- **"Why it moved" callout** — generic text for all trades. The per-snapshot vega-split narrative (attributing which leg drove the move) requires BSM greek delta comparison between consecutive snapshots — deferred.

## Threat Surface Scan

No new network endpoints or auth paths:
- `useJournal` calls existing `GET /api/journal/:calendarId` (Phase 3 endpoint) with the same Bearer auth as `useStatus`.
- `useRebuildJournal` calls existing `POST /api/jobs/rebuild-journal/trigger` (Phase 5 endpoint, already guarded by bearer group in Phase 5 P08). T-09-01 applies.
- No new files introduce trust-boundary crossings.

No new threat flags.

## TDD Gate Compliance

- RED gate: `test(09-07): add failing tests for classifyTradeHistory (RED)` (185ffa4) ✓
- GREEN gate: `feat(09-07): journal-history classifier + useJournal + useRebuildJournal hooks (GREEN)` (b9f4313) ✓
- RED gate (screen): `test(09-07): add failing Journal screen tests (RED)` (8298235) ✓
- GREEN gate (screen): `feat(09-07): Journal screen — 3-column layout + JOURNAL-01 + REBUILD-01 (GREEN)` (62b23af) ✓

## Self-Check: PASSED

All files exist on disk:
- `apps/web/src/lib/journal-history.ts` ✓
- `apps/web/src/lib/journal-history.test.ts` ✓
- `apps/web/src/hooks/useJournal.ts` ✓
- `apps/web/src/hooks/useRebuildJournal.ts` ✓
- `apps/web/src/components/LifecycleChart.tsx` ✓
- `apps/web/src/components/RebuildButton.tsx` ✓
- `apps/web/src/screens/Journal.tsx` ✓
- `apps/web/src/screens/Journal.test.tsx` ✓

All commits in git log:
- 185ffa4 (RED: journal-history tests) ✓
- b9f4313 (GREEN: classifier + hooks) ✓
- 7dfd1ce (Task 2: LifecycleChart + RebuildButton) ✓
- 8298235 (RED: Journal screen tests) ✓
- 62b23af (GREEN: Journal screen) ✓
