---
phase: 14-fred-expansion
plan: 07
subsystem: web
tags: [react, tanstack-query, macro, tdd, d-12]

# Dependency graph
requires:
  - phase: 14-fred-expansion
    provides: "macroResponse/MacroResponse/MacroSeriesId contract (14-01); live GET /api/analytics/macro route (14-06)"
provides:
  - "useMacro TanStack query hook — GET /api/analytics/macro via apiFetch, macroResponse.parse at the boundary, 401 → UnauthorizedError non-retryable"
  - "MacroCard component — loading/empty/populated tile grid (DFF · SOFR · T10Y2Y · VIX · VVIX primary; DGS1MO · DGS3MO · T10Y3M secondary), no props, hook-driven"
  - "Overview mounts <MacroCard /> in place of the FRED-macro ComingSoon stub (D-12)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-series macro tile grid: latest point per series from the macroResponse map, index-level series (VIXCLS/VVIX) displayed raw, percent series suffixed % — respects D-14 raw-units (no /100)"

key-files:
  created:
    - apps/web/src/hooks/useMacro.ts
    - apps/web/src/hooks/useMacro.test.ts
    - apps/web/src/components/MacroCard.tsx
    - apps/web/src/components/MacroCard.test.tsx
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx

key-decisions:
  - "useMacro refetchInterval 30min / staleTime 15min — tighter than COT's hourly since macro publishes twice daily (D-06); Claude's-call per plan"
  - "MacroCard layout: plain value tiles (5 primary + 3 secondary grid rows), no sparklines — fits Overview density next to CotCard; Claude's Discretion per D-12"
  - "UnauthorizedError redeclared locally in useMacro.ts — no shared export exists across hooks (verified: all 6 sibling hooks redeclare it); matches useCot exactly"

patterns-established: []

requirements-completed: [MAC-02]

coverage:
  - id: D1
    description: "useMacro fetches GET /api/analytics/macro through apiFetch, parses macroResponse, throws non-retryable UnauthorizedError on 401"
    requirement: MAC-02
    verification:
      - kind: unit
        ref: "apps/web/src/hooks/useMacro.test.ts (3 tests: parsed map on 200, UnauthorizedError non-retry on 401, Error on 500)"
        status: pass
      - kind: other
        ref: "rg -n 'macroResponse.parse' + '/api/analytics/macro' apps/web/src/hooks/useMacro.ts (both match, no `as` cast)"
        status: pass
    human_judgment: false
  - id: D2
    description: "MacroCard renders loading/empty/populated states from useMacro without ever throwing; primary + secondary series billed per D-12"
    requirement: MAC-02
    verification:
      - kind: unit
        ref: "apps/web/src/components/MacroCard.test.tsx (4 tests: loading, empty 'run the job to populate', primary values, secondary values)"
        status: pass
      - kind: other
        ref: "rg -n 'useMacro' apps/web/src/components/MacroCard.tsx (no props, hook-driven)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Overview mounts <MacroCard /> where the FRED-macro ComingSoon stub was (D-12) — stub no longer renders"
    requirement: MAC-02
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx (stub-absence + macro-empty assertion; 9/9 pass)"
        status: pass
      - kind: other
        ref: "rg -n 'MacroCard' matches / rg -n 'title=\"FRED macro\"' returns no match in Overview.tsx"
        status: pass
      - kind: human
        ref: "Checkpoint Task 3 — user approved via localhost:5173 (empty state rendered correctly; stub gone)"
        status: pass
    human_judgment: true

# Metrics
duration: 15min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 07: MacroCard Web Wiring (D-12 / MAC-02) Summary

**Live MacroCard (useMacro TanStack hook + tile-grid component) mounted in Overview over the typed macroResponse contract, replacing the FRED-macro "needs feed" stub.**

## Performance

- **Duration:** ~15 min (execution) + human-verify checkpoint round-trip
- **Completed:** 2026-07-02
- **Tasks:** 3 completed (2 execute + 1 human-verify checkpoint)
- **Files:** 4 created, 2 modified

## Accomplishments

- Shipped `useMacro` (MAC-02 client surface): `useQuery` over `apiFetch("/api/analytics/macro")`,
  body parsed through `macroResponse.parse` (no `as` cast — T-14-17), 401 → `UnauthorizedError`
  thrown and never retried (T-14-16, useCot precedent), non-401 failures throw with the status.
  Refetch cadence 30min/15min-stale — tighter than COT's hourly since D-06 publishes twice daily.
- Shipped `MacroCard`: no-props hook-driven component (CotCard pattern) on `Panel`/`PanelHeading`
  design-system molecules. Three states — loading (`macro-loading`), empty `{}` → "Macro data
  unavailable — run the job to populate." (`macro-empty`, never an error, never omitted — T-14-18),
  and populated: a 5-tile primary row (Fed Funds · SOFR · 10Y−2Y · VIX · VVIX, top-billed per the
  stub's promise) + 3-tile secondary row (1M · 3M · 10Y−3M). Index-level series (VIXCLS/VVIX)
  render raw; percent series get a `%` suffix — D-14 raw units, no `/100` anywhere.
- Replaced the Overview "FRED macro / ○ needs feed" `ComingSoon` stub with `<MacroCard />` in the
  `md:grid-cols-2` Market cell next to `<CotCard />` (D-12); removed the now-unused `ComingSoon`
  import and updated the header comment to "live".

## Task Commits

Tasks 1 and 2 followed the full TDD RED→GREEN cycle (no REFACTOR needed — implementations
minimal at GREEN); Task 3 was the human-verify checkpoint (no code):

1. **Task 1: useMacro hook**
   - RED: `2189cce` (test) — import-resolution failure on missing useMacro.ts
   - GREEN: `a92634d` (feat) — 3/3 tests pass
2. **Task 2: MacroCard + Overview stub replacement**
   - RED: `ba92f9b` (test) — MacroCard.tsx missing + Overview still rendering the stub
   - GREEN: `05580d5` (feat) — 13/13 tests pass (MacroCard 4 + Overview 9)
3. **Task 3: human-verify checkpoint** — approved (see Verification below)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `apps/web/src/hooks/useMacro.ts` - TanStack query hook, 401-aware non-retryable, macroResponse-parsed
- `apps/web/src/hooks/useMacro.test.ts` - 3 tests (200 parse, 401 non-retry, 500 error)
- `apps/web/src/components/MacroCard.tsx` - tile-grid macro panel, loading/empty/populated
- `apps/web/src/components/MacroCard.test.tsx` - 4 render-state tests with mocked useMacro
- `apps/web/src/screens/Overview.tsx` - `<MacroCard />` replaces the ComingSoon stub; ComingSoon import removed
- `apps/web/src/screens/Overview.test.tsx` - stub assertions inverted (stub gone, macro-empty present); useMacro mock added

## Decisions Made

- **Refetch cadence 30min/15min** (Claude's call per plan): macro publishes twice daily (D-06),
  so half COT's hourly interval; no aggressive polling needed for daily-granularity data.
- **Plain value tiles, no sparklines** (Claude's Discretion per D-12): 8 series in a half-width
  Overview grid cell next to CotCard — sparklines at that density would render ~60px wide and add
  noise without signal; tiles keep the card scannable at the stub's promised scope.
- **Local UnauthorizedError redeclaration**: verified all 6 sibling hooks redeclare it (no shared
  export exists) — matched the convention instead of introducing a new shared module.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useMacro 500-error test raced React Query retry backoff**
- **Found during:** Task 1 (RED→GREEN transition)
- **Issue:** The non-401 test used `mockResolvedValueOnce` + default waitFor timeout; the hook's
  own `retry: failureCount < 3` callback (plan-mandated shape) retries 500s with exponential
  backoff, so `isError` settles after ~7s — past waitFor's 1s default.
- **Fix:** Test now mocks `mockResolvedValue` (persistent 500) with a 10s waitFor / 15s test
  timeout. Hook behavior unchanged.
- **Files modified:** apps/web/src/hooks/useMacro.test.ts
- **Commit:** included in `a92634d` GREEN cycle (test adjusted before implementation finalized)

No other deviations — plan executed as written.

## Verification (human checkpoint)

Task 3 approved by the user via localhost:5173: MacroCard renders in the Overview Market
section next to CotCard, the "FRED macro / ○ needs feed" stub is gone, and the graceful
empty state ("run the job to populate") displays correctly. **Local data was empty as
expected — live-data rendering (populated tiles, sane values, VVIX ~80-120 / D-14
regression check) is deferred to prod UAT once `FRED_API_KEY` is set in prod (D-13
operator step, tracked at phase level).**

Automated: `bun run test -- --project web useMacro MacroCard Overview` 16/16 green;
`bun run typecheck` clean; `bun run lint` clean (only pre-existing boundaries-plugin
legacy-selector warnings).

## Known Stubs

None introduced by this plan. This plan REMOVED the last "needs feed" stub in Overview
(FRED macro). The MacroCard's empty state is a data-availability state over a live wired
endpoint, not a stub — it resolves as soon as `fetch-rates` populates `macro_observations`.

## Issues Encountered

- Full-stack `bun run dev` could not boot `apps/server`/`apps/worker` locally in this session
  (env validation failed — `DATABASE_URL`, `SIDECAR_URL`, etc. not resolving); the web app
  alone (vite + existing `apps/web/.env.local`) was sufficient for the checkpoint since the
  empty-state path was the verifiable surface. No code issue.

## User Setup Required

`FRED_API_KEY` prod operator step (D-13) remains open at phase level — required before the
populated MacroCard can be verified live (prod UAT).

## Next Phase Readiness

- Phase 14 plan set complete (7/7): contracts → migration → adapters → use-cases → worker →
  server surface → web surface. MAC-01 and MAC-02 both implemented.
- Remaining before phase close: prod UAT with `FRED_API_KEY` set (operator) — live-fetch run,
  populated MacroCard visual, D-14 sanity check (VVIX index-level, no /100).

## Self-Check: PASSED

- All 6 files verified present on disk: useMacro.ts, useMacro.test.ts, MacroCard.tsx,
  MacroCard.test.tsx, Overview.tsx, Overview.test.tsx.
- All 4 task commit hashes (`2189cce`, `a92634d`, `ba92f9b`, `05580d5`) verified in `git log`.
- Acceptance greps re-run: `macroResponse.parse` + `/api/analytics/macro` in useMacro.ts;
  `useMacro` in MacroCard.tsx; `MacroCard` present / `title="FRED macro"` absent in Overview.tsx.
- Plan-level verification re-run: web suite 16/16, typecheck clean, lint clean.

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*
