---
phase: 19-picker-engine-economic-events
plan: 09
subsystem: web
tags: [react-query, analyzer, picker, candidate-card, live-data, staleness, ui]
status: complete

# Dependency graph
requires:
  - phase: 19-picker-engine-economic-events (19-01)
    provides: pickerSnapshotResponse contract (asOf/spot/source/gexContextStatus/eventsContextStatus/termStructure/gex/events/candidates)
  - phase: 19-picker-engine-economic-events (19-07)
    provides: GET /api/picker/candidates HTTP route (reads the latest persisted picker_snapshot row, 404 on cold start)
provides:
  - usePicker() react-query hook (apps/web/src/hooks/usePicker.ts)
  - Analyzer.tsx live-data rail (loading/error/cold-start/zero-filtered/populated states)
  - CandidateCard per-card staleness+source tag and GEX/events context-status tags
affects: [picker-ui-final-uat, 19-VALIDATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "usePicker mirrors useCot's queryFn/401/retry scaffold exactly, but returns PickerSnapshotResponse | null (404 -> null, not a thrown Error) so a genuinely-empty cold-start snapshot never collapses into the generic fetch-error UI state"
    - "Analyzer derives a unified `snapshot = data ?? null` sentinel so downstream logic only distinguishes 'no snapshot' from 'a real snapshot', instead of juggling undefined/null separately"
    - "Rail state precedence computed once into a `railBody` variable above the JSX return (loading -> error -> cold-start -> CandidateRail-handles-zero-filtered -> populated), avoiding IIFEs in JSX"
    - "CandidateCard's gexFit/eventAdjustment guard bars reuse the exact fwdEdge guard-bar visual (zero-width, 'n/a' caption) — no new zero-state invented for the two new degraded-context cases"

key-files:
  created:
    - apps/web/src/hooks/usePicker.ts
    - apps/web/src/hooks/usePicker.test.ts
  modified:
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
    - apps/web/src/components/picker/CandidateCard.tsx
    - apps/web/src/components/picker/CandidateCard.test.tsx

# Key decisions
decisions:
  - "usePicker's queryFn returns `null` (not a thrown Error) on a 404 response — the route's `{error:'no-snapshot'}` cold-start response is a valid, honest 'nothing computed yet' state, distinct from a real fetch failure; conflating the two would make the rail show the generic error message instead of 'Picker warming up' (D-18)"
  - "Analyzer.tsx collapses `data` (PickerSnapshotResponse | null | undefined` from usePicker) into a single `snapshot: PickerSnapshotResponse | null` local via `data ?? null`, simplifying every downstream guard to a single `snapshot !== null` check instead of juggling undefined vs null"
  - "AdHocCalendarAnalysis's gex prop (non-nullable numbers) falls back to 0 for a null putWall/flip/callWall or a not-yet-loaded snapshot — that ad-hoc panel is best-effort/never scored and needs concrete numeric levels; this also fixed 3 pre-existing `bun run typecheck` errors on the exact lines this plan was already rewriting (Rule 1)"
  - "CandidateCard's staleness tag is implemented literally against `pickerSnapshotResponse.asOf` (a YYYY-MM-DD date string) per this plan's own task text — NOT against the picker_snapshot row's `observedAt` timestamp (which the HTTP route currently discards). See 'Known Limitation' below."

# Metrics
metrics:
  duration: ~20min
  tasks_completed: 3
  files_changed: 6
  completed: 2026-07-04
---

# Phase 19 Plan 09: Analyzer live-data swap + per-card staleness/context tags Summary

Swapped the Analyzer picker rail from the Phase-18 frozen fixture to live `usePicker()` data with
zero layout change, added the four D-18/D-19 rail states (loading/error/cold-start/zero-filtered),
and gave every `CandidateCard` an honest per-card "as of {HH:MM} · {source}" staleness tag plus
amber "GEX unavailable"/"events unavailable" tags when the snapshot's context is degraded.

## What Was Built

**Task 1 — `usePicker()` hook** (`apps/web/src/hooks/usePicker.ts`): a near-verbatim copy of
`useCot`'s scaffold (`apiFetch`, 401 → non-retryable `UnauthorizedError`, `pickerSnapshotResponse.parse`)
against `GET /api/picker/candidates`, `queryKey: ["picker"]`. One deliberate divergence from the
`useCot` template: a 404 response (`{error:"no-snapshot"}`, the route's cold-start response) resolves
the query to `null` instead of throwing — a query-level "nothing computed yet" state distinct from a
genuine fetch failure. `staleTime`/`refetchInterval` tuned to the ~30-min chain-triggered snapshot
cadence (D-04/D-06), tighter than COT's hourly values. Verified with a genuine TDD RED→GREEN cycle: a
stub implementation was swapped in, the 4-case test suite (success/401/404-null/generic-error) was
run and 3 of 4 failed for the right reason, then the real implementation was restored and the suite
went green.

**Task 2 — `Analyzer.tsx` fixture→live swap** (`apps/web/src/screens/Analyzer.tsx`,
`Analyzer.test.tsx`): replaced the synchronous `pickerSnapshotFixture` import with
`usePicker()`. Every fixture reference (`SORTED_CANDIDATES`, `PARAMS.spot`, the GEX levels fed to
`PayoffChart`/`ScenarioStrip`/`AdHocCalendarAnalysis`, `TermStructureChart`'s termStructure/events/
asOf, `WhyPanel`'s gex context) now derives from a single `snapshot = data ?? null` local. Added the
five mutually-exclusive rail states inside the existing "Suggested calendars" `Panel`/`PanelHeading`
shell:
- **Loading** (`isPending && data === undefined`) — text-only "Loading candidates…" (`data-testid="picker-loading"`), no shadcn `Skeleton`.
- **Error** (`isError`) — "Couldn't load candidates." (text-down) + a Retry mini-button calling `refetch()` (`data-testid="picker-error"`).
- **Cold-start** (settled, `snapshot === null` from a 404) — "Picker warming up" heading + body copy (`data-testid="picker-empty-cold-start"`).
- **Zero-candidates-passed-filter** (real snapshot, `candidates.length === 0`) — the existing "No candidates in this snapshot" heading, now with body copy interpolating the live `asOf` (`data-testid="picker-empty-filtered"`), rendered inside `CandidateRail` itself.
- **Populated** — the unchanged Phase-18 ranked rail, now sourced from `snapshot.candidates`.

`CandidateRail` and `RightColumn` gained `asOf`/`source`/`gexContextStatus`/`eventsContextStatus`/`gex`
props (previously read the fixture module directly). The 3-column grid, card anatomy, breakdown bars,
why-panel, term-structure chart, and entry/exit plan are byte-for-byte unchanged (PICK-02 "no layout
change") — confirmed by re-running every pre-existing Analyzer.test.tsx suite against a mocked
`usePicker()` returning the frozen fixture as `data` (all pass unmodified in behavior, only the data
source changed).

**Task 3 — `CandidateCard` staleness+context tags** (`apps/web/src/components/picker/CandidateCard.tsx`,
`CandidateCard.test.tsx`): appended two new tag groups to the existing sub-line row (same row as the
`DTE … · debit … · θ … · vega …` text and the `{ev}◂f`/`{ev}◂b`/`clean` tags):
- A staleness+source tag: `<span>` with a `size-1.5` dot (`bg-up` fresh / `bg-amber` stale, threshold
  reused from `Market.tsx`'s `GEX_FRESH_MS`) + text `as of {HH:MM} · {source}`. An unparseable `asOf`
  renders `as of —` (em-dash), never `Invalid Date`.
- Conditional amber `GEX unavailable` / `events unavailable` tags when `gexContextStatus`/
  `eventsContextStatus !== "ok"`. When either fires, the corresponding breakdown bar (`gexFit` /
  `eventAdjustment`) renders the existing `fwdEdge` guard-bar visual (zero-width, "n/a" caption) — no
  new zero-state invented.

Zero new npm dependencies, zero new shadcn components — every new element is a hand-rolled
`<span>` reusing existing Tailwind tokens, matching the `CandidateCard.tsx` precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — pre-existing bug on lines this task rewrites] Fixed 3 `bun run typecheck` errors in `AdHocCalendarAnalysis`'s gex prop wiring**
- **Found during:** Task 2 (swapping the `gex` prop source from the fixture to `snapshot?.gex`)
- **Issue:** `AdHocCalendarAnalysisProps.gex` requires non-nullable `{ putWall: number; flip: number; callWall: number }`, but `pickerGexContext`'s fields are nullable (`number | null`). This was already a pre-existing `tsc --noEmit` error on `apps/web` (confirmed via a typecheck run against the pre-plan HEAD) on the exact three lines this task needed to rewrite anyway.
- **Fix:** `putWall: snapshot?.gex.putWall ?? 0`, same for `flip`/`callWall` — that panel is best-effort/ad-hoc (never scored) and needs concrete numeric levels regardless of snapshot state.
- **Files modified:** `apps/web/src/screens/Analyzer.tsx`
- **Commit:** `3da99ba`

### Known Limitation (documented, not auto-fixed — outside this plan's declared file scope)

`pickerSnapshotResponse.asOf` is a `YYYY-MM-DD` date string (`computePickerSnapshot.ts`'s
`asOfIso = latestTime.toISOString().slice(0, 10)`), not a timestamp — even though D-04 explicitly
names the stored snapshot's `observedAt` (a real `Date`, carried on `PickerSnapshotRow` per
`packages/core/src/picker/application/ports.ts`) as the intended staleness source. The HTTP route
(`apps/server/src/adapters/http/picker.routes.ts`) currently parses and returns only
`row.snapshot` (the `pickerSnapshotResponse` blob), discarding `row.observedAt` — so no
timestamp-granularity field reaches the browser today.

This plan's own task text (19-09-PLAN.md Task 3 `<action>`) scopes the staleness tag explicitly to
`asOf`/`source` (not `observedAt`), so the tag is implemented literally as specified: `formatAsOf`
parses `asOf` and computes a clock time + freshness threshold from it. The practical effect: for a
same-day snapshot fetched after local midnight UTC, the freshness dot will typically read amber
("stale") even when the underlying chain snapshot is actually fresh, because a date-only value
collapses to midnight UTC of that day. This is the *safe* failure direction per T-19-21 (a stale
snapshot must never read as fresh) — it never falsely shows green — but it is not fully accurate.

**Recommended follow-up:** add `observedAt` to `pickerSnapshotResponse` (additive field, same pattern
as D-15's `source`/D-17's context-status fields) and thread it through `picker.routes.ts` /
`get_picker_candidates` MCP tool / the Phase-18 fixture, then swap `CandidateCard`'s `formatAsOf`
input from `asOf` to the new field. Not done in this plan because it requires touching
`packages/contracts/src/picker.ts` and `apps/server/src/adapters/http/picker.routes.ts`, both outside
this plan's declared `files_modified` scope, and is not itself a blocking correctness bug (the
failure direction is safe, not dishonest-clean).

## Auth Gates

None — no authentication prompts encountered during this plan.

## Verification

- `bun run test --project web -- usePicker.test.ts` — 4/4 green (success, 401, 404→null, generic error).
- `bun run test --project web -- Analyzer.test.tsx` — all pre-existing suites green against a mocked `usePicker()`, plus 6 new tests covering the loading/error/cold-start/zero-filtered/populated states and state precedence.
- `bun run test --project web -- CandidateCard.test.tsx` — all pre-existing suites green, plus 6 new tests covering the fresh/stale dot, em-dash guard, and both context-status tag cases (individually and combined).
- `bun run test --project web` (full web suite) — 357/357 green.
- `bun run typecheck` (root, `tsc --build --force`) — 0 errors.
- `apps/web && bun run typecheck` (`tsc --noEmit`) — the 3 pre-existing `Analyzer.tsx` errors are now fixed; 5 remaining pre-existing errors in unrelated files (`ErrorBoundary.tsx`/`.test.tsx`, `AdHocCalendarAnalysis.tsx:113`, `useMacro.test.ts`, `JournalContainer.test.tsx`) are untouched by this plan and out of scope (Rule 1 scope boundary — not on lines this plan rewrote).
- `bun run lint` (root) — 0 errors (pre-existing config warnings only).
- Manual UAT (per 19-VALIDATION.md: load Analyzer against a live picker_snapshot row, force cold-start/zero-candidate/stale-context paths) — **not performed this session** (requires a live prod/staging picker_snapshot row); flagged for the phase-level UAT pass.

## Self-Check: PASSED

- FOUND: apps/web/src/hooks/usePicker.ts
- FOUND: apps/web/src/hooks/usePicker.test.ts
- FOUND: apps/web/src/screens/Analyzer.tsx (no `pickerSnapshotFixture` reference remains)
- FOUND: apps/web/src/components/picker/CandidateCard.tsx (staleness tag + context tags present)
- FOUND commit 952c67c (usePicker hook)
- FOUND commit 3da99ba (Analyzer swap)
- FOUND commit 54a54d9 (CandidateCard tags)
