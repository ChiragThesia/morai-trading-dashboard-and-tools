# Deferred Items — Phase 31 Plan 01

Pre-existing, out-of-scope failures discovered while running `bun run typecheck` during
31-01 execution. None of these files are touched by 31-01's scope
(`PayoffChart.tsx`/`PayoffChart.test.tsx`/`Overview.tsx`), and none reference
`PinnedMarker`/`marker.label`/`marker.anchorEnd`/`EDGE_ARROW_LANE_Y`. Confirmed pre-existing
via `git diff --stat HEAD -- apps/web/src` (only the two 31-01-owned files show as changed).
Not fixed per the execution scope-boundary rule ("only auto-fix issues directly caused by
the current task's changes").

| File | Error |
|------|-------|
| `src/components/ErrorBoundary.test.tsx:70,71` | TS7006 implicit-any params |
| `src/components/ErrorBoundary.tsx:29,33` | TS4114 missing `override` modifier |
| `src/components/system/Button.tsx:97` | TS2379 `exactOptionalPropertyTypes` className |
| `src/hooks/useMacro.test.ts:60,61` | TS4111 index-signature property access |
| `src/lib/candidate-to-position.test.ts:117` | TS2741 missing `thetaCapturePct` |
| `src/lib/parsed-calendar-to-candidate.test.ts:13` | TS2739 missing `frontExpiry`/`backExpiry` |
| `src/lib/parsed-calendar-to-candidate.ts:18` | TS2739 missing `context`/`bucket` |
| `src/lib/tos-order.test.ts:44` | TS2741 missing `thetaCapturePct` |
| `src/screens/Analyzer.test.tsx:650,845` | TS2322/TS2739 candidate/liquidity type mismatch |
| `src/screens/JournalContainer.test.tsx:99` | TS2322 possibly-undefined calendars |
| `src/screens/Overview.test.tsx:121` | TS2345 query-result mock shape mismatch |

`bunx vitest run apps/web/src/components/charts/PayoffChart.test.tsx` (31-01's own
verification gate) is green — 38/38 passing, including the new fast-check/repro/edge-arrow
tests.
