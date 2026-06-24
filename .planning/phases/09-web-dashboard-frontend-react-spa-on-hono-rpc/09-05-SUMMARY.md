---
phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc
plan: "05"
subsystem: web-shell-overview-vercel
tags: [shell, overview, gex-hook, positions-hook, coming-soon, vercel, human-verify-pending]
status: checkpoint-pending

dependency_graph:
  requires:
    - 09-04 (Auth gate + RPC client + apiFetch pattern + useStatus hook)
  provides:
    - apps/web/src/hooks/useGex.ts (30s poll of GET /api/analytics/gex, gexSnapshotResponse.parse)
    - apps/web/src/hooks/usePositions.ts (30s poll of GET /api/positions, positionsResponse.parse)
    - apps/web/src/components/Shell.tsx (sticky header + nav tabs + live market strip + ShellWithRouter)
    - apps/web/src/screens/Overview.tsx (12-col grid, live data, locked empty state, ComingSoon stub)
    - apps/web/src/components/stubs/ComingSoon.tsx (reusable dashed-border stub)
    - apps/web/src/components/charts/EquityCurve.tsx (visx AreaClosed+LinePath equity curve)
    - apps/web/src/components/charts/MiniLine.tsx (visx LinePath mini chart for term/skew)
    - apps/web/vercel.json (SPA rewrites for Vercel deploy)
    - apps/web/src/screens/Overview.test.tsx (5 passing tests)
  affects:
    - Plan 09-06/07/08 (Wave 6 fan-out — BLOCKED pending Task 4 human approval of live Vercel)
    - All authenticated screens (Shell is the layout host)

tech_stack:
  added:
    - "@visx/curve@4.0.0" (added to apps/web as direct dep — was transitive-only)
  patterns:
    - useGex/usePositions mirror useStatus pattern (401 short-circuit, parse-don't-cast)
    - Shell: useState<ScreenName> switcher (no router dependency; Vercel SPA rewrites handle direct URLs)
    - ShellWithRouter: controlled Shell with screens Record passed from App.tsx
    - ComingSoon: reusable props-driven stub (badge/title/body) per UI-SPEC dashed-border contract
    - EquityCurve/MiniLine: visx AreaClosed+LinePath/LinePath with scalePoint+scaleLinear
    - TDD red→green: Overview.test.tsx committed at RED, GREEN after ComingSoon canonical extraction

key_files:
  created:
    - apps/web/src/hooks/useGex.ts
    - apps/web/src/hooks/usePositions.ts
    - apps/web/src/components/Shell.tsx
    - apps/web/src/components/stubs/ComingSoon.tsx
    - apps/web/src/components/charts/EquityCurve.tsx
    - apps/web/src/components/charts/MiniLine.tsx
    - apps/web/vercel.json
    - apps/web/src/screens/Overview.test.tsx
  modified:
    - apps/web/src/App.tsx (replaced placeholder shell with ShellWithRouter + Overview screen)
    - apps/web/src/screens/Overview.tsx (upgraded from Task 1 stub to canonical ComingSoon + live data)

decisions:
  - "useGex polls GET /api/analytics/gex (not /api/gex) — matched the actual server route structure from Phase 8 server code."
  - "ShellWithRouter pattern: App.tsx owns the screens Record; Shell is stateless re: which screen; separation allows lazy imports later without changing Shell API."
  - "Overview inline ComingSoonStub (Task 1) replaced by canonical ComingSoon import (Task 2) — the stub was a temporary scaffold to unblock typecheck during the TDD RED phase."
  - "@visx/curve added as explicit web dep — was installed as a transitive dep of @visx/shape but not listed in apps/web/package.json, causing TypeScript module-not-found errors."
  - "eslint-disable @typescript-eslint/consistent-type-assertions on Overview.test.tsx mockReturnValue casts — UseQueryResult discriminated union cannot be satisfied without assertion in test utilities (same pattern as AuthExpiredBanner.test.tsx in Plan 04)."

metrics:
  duration: "10min"
  completed: "2026-06-24"
  tasks_completed: 3
  tasks_total: 4
  files_created: 8
  files_modified: 2
---

# Phase 09 Plan 05: Shell + Overview + vercel.json Summary

GEX and positions hooks (30s poll, parse-don't-cast), the layout Shell (sticky frosted-glass header, MORAI brand, five locked nav tabs, live market strip), the Overview screen (12-col grid, locked empty state, ComingSoon stub for economic calendar), and vercel.json for Vercel SPA deploy — blocked at Task 4 (human-verify: live Vercel thin-slice).

**NOTE: Vercel thin-slice NOT yet deployed AND NOT yet human-approved-live.** Task 4 (checkpoint:human-verify, gate=blocking) is pending. Plans 09-06, 09-07, 09-08 MUST NOT start until the human approves the live deployment (D-02). The assertion "Vercel thin-slice deployed AND human-approved-live before any fan-out screen starts" CANNOT be made until Task 4 is approved.

## What Was Built

**Task 1 — gex + positions hooks + Shell + App.tsx (commit 2129736)**

`useGex.ts` and `usePositions.ts` mirror the `useStatus` pattern: 30s poll via `apiFetch`, parse through Zod contracts (`gexSnapshotResponse.parse`, `positionsResponse.parse`), `UnauthorizedError` non-retryable 401 short-circuit.

`Shell.tsx`: sticky frosted-glass header (height ~48px, z-50, `linear-gradient(180deg, rgba(22,29,43,0.55), rgba(10,14,20,0))` + `backdrop-filter: blur(12px)`). MOR**AI** logotype (violet "AI"). Five nav tabs in the locked order (Overview · Analyzer · Positions · Journal · Market) with the UI-SPEC locked active/inactive styling (`#161d2b` background when active, `#7b8696` when inactive). Right-aligned live market strip: SPX spot (blue `#5b9cf6`), net γ /1% (teal/coral + blood-dark bg when negative), γ flip (amber), book P&L (sign-colored). `useState<ScreenName>` screen switcher (lightweight, no router). `<AuthExpiredBanner>` always mounted. `ShellWithRouter` component composes Shell with screen map.

`App.tsx`: replaced placeholder `data-testid="app-shell"` div with `<ShellWithRouter>` that renders `<Overview>` for the Overview tab and coming-soon placeholder divs for the other four tabs.

`Overview.tsx` (Task 1 stub): 12-col grid with inline `ComingSoonStub`, live `usePositions` + `useStatus` data, locked empty state and data-range note. Fully functional stub that Task 2 upgrades.

Verification: `bun run typecheck` exit 0, `bun run lint` exit 0, `grep -q 'useGex' src/components/Shell.tsx && grep -q 'Overview' src/components/Shell.tsx` → OK.

**Task 2 — Overview screen (canonical) + ComingSoon + EquityCurve + MiniLine (TDD GREEN) (commits fcddbfc, 7c1f935)**

RED: `Overview.test.tsx` committed with 5 tests asserting: empty-state copy on empty positions, position row + net row on non-empty positions, "○ needs feed" ComingSoon badge, locked data-range note, loading skeleton. Tests pass immediately because Task 1 stub already implements the behavior correctly. The canonical test enforces the behavior contract going forward.

GREEN: `ComingSoon.tsx` — reusable badged placeholder (dashed border `#27313f`, radius 8px, `md` padding, centered flex column, `label` token title/body). `EquityCurve.tsx` — visx `AreaClosed`+`LinePath`, coral line when cumulative negative. `MiniLine.tsx` — small visx line for term/skew minis. `Overview.tsx` upgraded to import canonical `ComingSoon` (inline stub removed).

All 5 Overview tests pass. Full suite: `bun run typecheck` + `bun run lint` green.

**Task 3 — vercel.json + local build (commit e0820a6)**

Created `apps/web/vercel.json` with `$schema` + SPA rewrite `{ source: "/(.*)", destination: "/index.html" }`. No `VITE_*` secrets in the file. `bun run build` exits 0: 272 modules transformed, `dist/` produced.

**Task 4 — PENDING human-verify checkpoint (blocking)**

The human must:
1. Create/link a Vercel project with Root Directory = `apps/web`, Framework = Vite, Build = `bun run build`, Output = `dist`
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` as Vercel env vars
3. Deploy and get a live Vercel URL
4. Set `WEB_ORIGIN` on the Railway API to the Vercel origin (CORS — Pitfall 4)
5. Verify the thin-slice: Login → Overview over real API, market strip, ComingSoon stub, no CORS errors
6. Type "approved" to unblock Plans 06/07/08 (Wave 6)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @visx/curve missing as direct dependency**
- **Found during:** Task 2 typecheck
- **Issue:** `@visx/curve` was installed as a transitive dep of `@visx/shape` but not listed in `apps/web/package.json`. TypeScript could not resolve the module path for the type checker even though runtime bundling via Vite would have worked.
- **Fix:** `bun add @visx/curve` in `apps/web`, updating `package.json` and `bun.lock`.
- **Files modified:** `apps/web/package.json`, `bun.lock`
- **Commits:** 7c1f935

**2. [Rule 2 - Auto-add] eslint-disable for UseQueryResult mock casts in test file**
- **Found during:** Task 2 typecheck
- **Issue:** `Overview.test.tsx`'s `mockReturnValue` calls need to pass partial `UseQueryResult` objects. The discriminated union cannot be satisfied without a type assertion (same pattern as `AuthExpiredBanner.test.tsx` in Plan 04).
- **Fix:** Added `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions` before each `mockReturnValue({ ... } as unknown as ReturnType<typeof usePositions>)` line in test-utility code.
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Commits:** 7c1f935

**3. [Rule 1 - Bug] OCC symbol regex match (whitespace normalization)**
- **Found during:** Task 2 TDD GREEN phase
- **Issue:** RTL's `getByText` normalizes whitespace, collapsing multiple internal spaces in the 21-char OCC symbol `SPX   260612P07400000`. A plain string match fails; a regex `\s+` is needed.
- **Fix:** Used `/SPX\s+260612P07400000/` regex matcher instead of string.
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Commits:** fcddbfc

## Verification Results

```
vitest run --project web -t "Overview" → 5/5 tests pass (empty state + position row + ComingSoon badge + data-range note + loading)
bun run typecheck (apps/web) → exit 0, no errors
bun run lint (root) → exit 0, no errors (only pre-existing legacy selector warnings)
apps/web/vercel.json → rewrites present, no VITE_* secrets
bun run build (apps/web) → exit 0, dist/ produced (272 modules)
```

## Known Stubs

The Overview screen has several data fields showing "—" (skeleton placeholders for greeks, regime, strike, volatility mini charts). These are architectural stubs:
- **Net greeks card (Δ/Γ/Θ/Vega):** Shows "—" — requires computed greeks from server (POSITIONS-01 gap, documented in UI-SPEC). Plan 07 (Positions screen) resolves this.
- **Market regime / Your strike / Volatility minis:** Pending GEX data wired to display (Plan 06 Market screen covers full GEX visualization). The Overview cards show structure but no live regime text.
- **EquityCurve in P&L card:** Component created but not yet wired to real trade history (requires Journal data from Plan 08). Currently renders the card heading only.

These stubs do not prevent Plan 05's goal: the D-02 thin-slice (Shell + Overview + live positions + ComingSoon stub) is built and locally verified. The stubs are documented so Plans 06-10 can fill them in.

## Threat Surface Scan

No new network endpoints or auth paths beyond what is in Plan 05's threat register:
- `useGex` and `usePositions` call existing Phase 8 API endpoints (`/api/analytics/gex`, `/api/positions`) with the same Bearer auth pattern as `useStatus`. Both are under T-09-01 control.
- `vercel.json` contains only SPA rewrites — no env vars, no headers, no server-side config.
- CORS `WEB_ORIGIN` on Railway is a server-side control not in this plan's files.

No new threat flags.

## Self-Check: PARTIAL (checkpoint pending)

- `apps/web/src/hooks/useGex.ts` — exists, contains `gexSnapshotResponse.parse` and `refetchInterval: 30_000` ✓
- `apps/web/src/hooks/usePositions.ts` — exists, contains `positionsResponse.parse` and `refetchInterval: 30_000` ✓
- `apps/web/src/components/Shell.tsx` — exists, contains `useGex`, `Overview`, `AuthExpiredBanner` ✓
- `apps/web/src/screens/Overview.tsx` — exists, contains `ComingSoon` import and locked copy ✓
- `apps/web/src/components/stubs/ComingSoon.tsx` — exists, contains `needs feed` ✓
- `apps/web/src/components/charts/EquityCurve.tsx` — exists, contains `AreaClosed` ✓
- `apps/web/src/components/charts/MiniLine.tsx` — exists, contains `LinePath` ✓
- `apps/web/vercel.json` — exists, contains `rewrites` ✓
- `apps/web/src/screens/Overview.test.tsx` — exists, 5 tests passing ✓
- Commits 2129736, fcddbfc, 7c1f935, e0820a6 — verified in git log ✓
- Task 4 (Vercel deploy + human approval) — PENDING checkpoint ✗
