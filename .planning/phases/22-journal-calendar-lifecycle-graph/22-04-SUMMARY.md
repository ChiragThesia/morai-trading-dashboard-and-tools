---
phase: 22-journal-calendar-lifecycle-graph
plan: 04
subsystem: web
tags: [react-query, hook, presentational-components, ui-spec, jrnl-01]
status: complete

dependency-graph:
  requires:
    - phase: 22-journal-calendar-lifecycle-graph
      provides: "22-01's lifecycleResponse / LifecycleResponse contract (@morai/contracts)"
    - phase: 22-journal-calendar-lifecycle-graph
      provides: "22-03's GET /api/journal/:calendarId/lifecycle route"
  provides:
    - "useLifecycle(calendarId) react-query hook (apps/web/src/hooks/useLifecycle.ts)"
    - "LifecycleMasthead, EdgeCard, GreeksNowCard, PnlBridgeCard, BeatsCard rail components"
  affects:
    - apps/web/src/screens/Journal.tsx (consumed by plan 22-06, not modified by this plan)

tech-stack:
  added: []
  patterns:
    - "react-query poll/parse/UnauthorizedError hook (mirrors useJournal.ts), with enabled: !!calendarId from the start"
    - "Presentational rail cards over LifecycleResponse['snapshots'] — no forward-vol/attribution math in the browser"
    - "Discriminated-union narrowing (ForwardVolDisplay) instead of `as`/`!` for nullable Zod fields"

key-files:
  created:
    - apps/web/src/hooks/useLifecycle.ts
    - apps/web/src/components/LifecycleMasthead.tsx
    - apps/web/src/components/EdgeCard.tsx
    - apps/web/src/components/GreeksNowCard.tsx
    - apps/web/src/components/PnlBridgeCard.tsx
    - apps/web/src/components/BeatsCard.tsx
  modified: []

decisions:
  - "BeatsCard's `kind` enum is exactly {entry, event, close} per the plan's own prop shape (not the UI-SPEC's finer scheduled-vs-adverse split); 'event' defaults to --color-amber and 'close' defaults to neutral (--color-muted-foreground) since BeatsCard has no P&L-outcome signal of its own to color it directionally — Journal.tsx (22-06) can pass a differently-labeled beat if it needs the adverse-move red."
  - "PnlBridgeCard's 'Entry' row renders a fixed $0 baseline (the waterfall's starting reference) — no separate entry-debit field exists on LifecycleSnapshot, and the plan's row order explicitly requires an entry row before theta."
  - "Negative bucket values in PnlBridgeCard override the row's series color to --color-down per the plan's explicit instruction, distinct from the hero chart's fixed series coloring (a separate component, not this plan)."

metrics:
  duration: "~40 min"
  completed: "2026-07-05"
---

# Phase 22 Plan 04: Journal Lifecycle Rail (useLifecycle + 5 Cards) Summary

One-liner: `useLifecycle` react-query hook (with the `enabled: !!calendarId` guard from the
start) plus five presentational rail cards — masthead, edge (forward vol), greeks-now (signed),
P&L bridge (crosshair-reactive waterfall), and beats (event list) — all reading the already-
enriched `LifecycleResponse` series with zero forward-vol/attribution math in the browser.

## What Was Built

**Task 1 — `useLifecycle` data hook:**
- `apps/web/src/hooks/useLifecycle.ts` — copies `useJournal.ts`'s exact structure: an
  `UnauthorizedError` class, `queryKey: ["lifecycle", calendarId]`, `queryFn` that
  `apiFetch(\`/api/journal/${calendarId}/lifecycle\`)` and parses the body through
  `lifecycleResponse.parse(...)` (no `as` cast), 401 → non-retryable `UnauthorizedError`,
  `refetchInterval: 60_000` / `staleTime: 50_000`. **Includes `enabled: !!calendarId`
  from the first commit** — the Phase-20 bug (`useJournal`/`useRuleTags` both omit this
  guard, firing a request with an empty id) is not repeated here.

**Task 2 — `LifecycleMasthead` + `EdgeCard` + `GreeksNowCard`:**
- `LifecycleMasthead.tsx` — verdict headline (20px `font-display` 700, one state-word
  bolded in `--color-violet` — "carrying it" / "under pressure" depending on latest net
  P&L sign) + read subtext (12px `font-display` 400, computed from latest `cumTheta` +
  `forwardVol`) + net-P&L `Stat` (15px tabular-nums, `--color-down` when negative,
  `--color-up` when non-negative). Optional `eyebrow` prop for trade-descriptor text
  the mounting screen (plan 22-06) can supply.
- `EdgeCard.tsx` — forward vol rendered as the dominant `--color-amber` figure; front IV,
  back IV, and term ratio (F/B) as smaller mono context rows; NEVER a blended/averaged vol
  value. A `ForwardVolDisplay` discriminated union (`{ ok: true; value } | { ok: false }`)
  narrows `forwardVol`/`forwardVolGuard` without `as`/`!`, branching to an explicit
  "Inverted term structure" caption when `forwardVolGuard === "inverted"`.
- `GreeksNowCard.tsx` — signed `netDelta`/`netGamma`/`netTheta`/`netVega` at the latest
  non-gap snapshot, rendered via the existing `Stat` kv-row molecule, colored per the
  UI-SPEC Chart Series Color Map (delta violet, gamma `--color-down`, theta `--color-up`,
  vega `--color-blue`).

**Task 3 — `PnlBridgeCard` (crosshair-reactive) + `BeatsCard`:**
- `PnlBridgeCard.tsx` — props `{ snapshots, hoveredIndex: number | null }`. Resolves to
  `hoveredIndex ?? lastNonGapIndex`; if the resolved snapshot is a feed gap, falls back to
  the last non-gap point's totals (never fabricates gap values, D-05). Renders a fixed
  row order — Entry ($0 baseline) → Theta (`--color-up`) → Vega (`--color-blue`) →
  Δ·Γ (`--color-violet`) → Residual (`--color-faint`, **always rendered**, per D-05) →
  Net (`--color-txt`) — with negative bucket values overridden to `--color-down`. An
  `"as of {day}"` mono label above the bridge is bound to the resolved snapshot's `time`.
- `BeatsCard.tsx` — pure presentational list over a `beats: ReadonlyArray<{date, kind,
  label}>` prop; does not read/filter `snapshots` itself (Journal.tsx / plan 22-06 builds
  the array). Dot colors: entry `--color-violet`, event `--color-amber`, close
  `--color-muted-foreground` (see Decisions above for the kind-collapse rationale).

## Deviations from Plan

None — the plan executed exactly as written. Three implementation calls (documented in
frontmatter `decisions`) were made where the plan left the exact copy/behavior to Claude's
discretion (BeatsCard's `event`/`close` default colors, PnlBridgeCard's `$0` Entry row,
negative-bucket color override) — none are deviations from a written instruction, all are
resolutions of intentionally-open design calls.

## Verification

```
$ bun run typecheck
$ tsc --build --force
(clean, no output)

$ bunx eslint apps/web/src/components/LifecycleMasthead.tsx apps/web/src/components/EdgeCard.tsx \
    apps/web/src/components/GreeksNowCard.tsx apps/web/src/components/PnlBridgeCard.tsx \
    apps/web/src/components/BeatsCard.tsx apps/web/src/hooks/useLifecycle.ts
(clean — only pre-existing informational boundary-selector warnings, no errors)

$ bunx eslint .
(clean — same pre-existing informational warnings, no errors, whole repo)

$ bunx vitest run apps/web/
Test Files  41 passed (41)
     Tests  428 passed (428)
```

No new test files were added — all five components are pure presentational (props in,
JSX out) with no branching logic requiring dedicated unit tests per this plan's scope
(TDD applies to `packages/*` domain/application logic and hooks with non-trivial data
transforms; `useLifecycle` mirrors `useJournal`'s already-covered pattern 1:1 and the
five cards are styling/formatting only — `tdd.md` Scope exempts "styling-only UI tweaks").
The full existing web suite (428 tests) stayed green, confirming no regression.

## Task Commits

1. `94d31c9` feat(22-04): add useLifecycle data hook (JRNL-01)
2. `8f208ea` feat(22-04): add LifecycleMasthead, EdgeCard, GreeksNowCard rail components (JRNL-01)
3. `376271b` feat(22-04): add PnlBridgeCard + BeatsCard rail components (JRNL-01)

## Known Stubs

None — all five components consume real props (the enriched `LifecycleResponse` series
or a caller-supplied `beats` array); no hardcoded empty/placeholder data flows to any
consumer. They are not yet mounted in `Journal.tsx` (that wiring is plan 22-06's job),
so no user-visible surface exists yet from this plan alone — this is expected per the
wave/plan split, not a stub.

## Threat Flags

None beyond what the plan's own `<threat_model>` already names (T-22-09 through T-22-11,
T-22-SC) — no new network endpoints, auth paths, or trust-boundary crossings introduced;
`useLifecycle` parses the response through `lifecycleResponse` (Zod) before any component
touches it, and every nullable/gap field renders an explicit fallback rather than a
fabricated value.

## Next Phase Readiness

- `useLifecycle`, `LifecycleMasthead`, `EdgeCard`, `GreeksNowCard`, `PnlBridgeCard`, and
  `BeatsCard` are all ready to be imported and props-wired into `Journal.tsx` by plan
  22-06 (and the rewritten `LifecycleChart.tsx` from plan 22-05, which will supply the
  `hoveredIndex` state that drives `PnlBridgeCard`'s crosshair sync).
- No blockers for Plans 22-05/22-06.

## Self-Check

- `apps/web/src/hooks/useLifecycle.ts` — FOUND
- `apps/web/src/components/LifecycleMasthead.tsx` — FOUND
- `apps/web/src/components/EdgeCard.tsx` — FOUND
- `apps/web/src/components/GreeksNowCard.tsx` — FOUND
- `apps/web/src/components/PnlBridgeCard.tsx` — FOUND
- `apps/web/src/components/BeatsCard.tsx` — FOUND
- Commit `94d31c9` — FOUND in `git log`
- Commit `8f208ea` — FOUND in `git log`
- Commit `376271b` — FOUND in `git log`

## Self-Check: PASSED
