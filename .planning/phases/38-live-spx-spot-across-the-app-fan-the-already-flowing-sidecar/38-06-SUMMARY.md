---
phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar
plan: 06
subsystem: ui
tags: [react, live-data, honest-badge, regime-rail, react-memo]

requires:
  - phase: 38-04
    provides: "useLiveStream liveIndices + useOverviewModel passthrough"
  - phase: 38-05
    provides: "Overview.tsx model destructure pattern + live-tint precedent (live-dot CSS class)"
provides:
  - "RegimeBoard optional liveIndices/liveStatus props: live display value + client-recomputed band for the 3 broker-quotable rows (vix-term-structure, vvix, vix9d-vix), gated on liveStatus==='live' with per-symbol null degrade to EOD"
  - "MarketRail liveIndices/liveStatus prop forwarding to RegimeBoard (no useLiveStream call, D-06)"
  - "RegimeBoard wrapped in React.memo — a 1/sec spot tick elsewhere on the Overview tree does not re-render the regime rail"
affects: [38-07]

tech-stack:
  added: []
  patterns:
    - "Client band recompute via the same id->bander lookup idiom as useRuleSettingsPreview.ts's REGIME_BAND_FNS, restricted to the 3 broker-quotable ids (T-31-05 scoped, display-only exception)"
    - "liveValue ?? indicator.value / liveBand ?? indicator.band fallback seam — byte-identical to pre-38-06 rendering when the live props are absent (existing callers untouched)"

key-files:
  modified:
    - apps/web/src/components/RegimeBoard.tsx
    - apps/web/src/components/RegimeBoard.test.tsx
    - apps/web/src/screens/MarketRail.tsx
    - apps/web/src/screens/MarketRail.test.tsx
    - apps/web/src/screens/Overview.tsx

key-decisions:
  - "Footer 'flip to a live marker' implemented as a full text swap (live-dot span + \"LIVE\") rather than appending to the existing 'EOD · as of …' string — avoids ever rendering a string that visually claims both live and EOD in one line (catch #26); the exact EOD string is untouched when not live."
  - "Live overlay computed once per RegimeBoard render (a Map from id -> live value) rather than inline per-Row — avoids duplicating the liveStatus==='live' && liveIndices!==null gate at each of the 3 call sites."
  - "Divide-by-zero/NaN ratios (vix/vix3m, vix9d/vix) guarded with Number.isFinite rather than an explicit divisor!==0 check — one check covers both the 0-divisor and 0/0 cases, degrading that row to EOD rather than fabricating Infinity/NaN."

patterns-established: []

requirements-completed: [LIVE-05]

coverage:
  - id: D1
    description: "The 3 broker-quotable regime rows (vix-term-structure, vvix, vix9d-vix) display a live value with a client-recomputed band while liveStatus==='live' and the required inputs are finite"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#shows a live value + client-recomputed band for the 3 broker-quotable rows while liveStatus is live"
        status: pass
    human_judgment: false
  - id: D2
    description: "Quiet/stalled (or no liveIndices) reverts every row to the stored EOD value/band and the exact 'EOD · as of …' footer, even when liveIndices is present but the status isn't live"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#stays on the EOD value/band and the 'EOD · as of …' footer while liveStatus is quiet, even with liveIndices present"
        status: pass
    human_judgment: false
  - id: D3
    description: "The entry-gate chip (usePicker().gate) and the hy-oas row never read liveIndices — both stay on their independent EOD/FRED sources"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#never lets liveIndices reach the gate chip or the hy-oas row (separate FRED-only sources)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A per-symbol null input (e.g. a Schwab failure for one VIX-family quote) degrades only that one row to EOD; unaffected rows stay live"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#degrades only the affected row to EOD when one required live input is null (per-symbol Schwab failure)"
        status: pass
    human_judgment: false
  - id: D5
    description: "MarketRail forwards liveIndices/liveStatus to RegimeBoard as props and never imports/calls useLiveStream itself (D-06 one-hook-per-surface)"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/MarketRail.test.tsx#forwards liveIndices/liveStatus to RegimeBoard — the live regime value reaches the rail"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/MarketRail.test.tsx#never calls useLiveStream itself — receives liveIndices/liveStatus as props only (D-06 one-hook-per-surface)"
        status: pass
    human_judgment: false
  - id: D6
    description: "RegimeBoard is memoized — an unchanged liveIndices/liveStatus reference on a parent re-render does not re-run RegimeBoard's render (no 1/sec regime-rail churn)"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/MarketRail.test.tsx#RegimeBoard is memoized — an unchanged liveIndices/liveStatus reference on parent re-render does not re-run it (RESEARCH Pitfall 4)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-13
status: complete
---

# Phase 38 Plan 06: Regime Gauges Display-Live/Gate-EOD (RegimeBoard + MarketRail + Overview) Summary

**RegimeBoard's 3 broker-quotable gauges (VIX/VIX3M, VVIX, VIX9D/VIX) now show live values with a client-recomputed band while the stream is live, forwarded through MarketRail as props and memoized against 1/sec spot-tick re-renders — the entry gate, stored `indicator.band`, and hy-oas never see the live stream.**

## Accomplishments

- `RegimeBoard.tsx`: optional `liveIndices?: StreamIndicesEvent | null` / `liveStatus?: LiveStreamStatus` props. A new `liveValueFor(id, liveIndices)` computes the live ratio/level for `vix-term-structure`, `vvix`, `vix9d-vix` only (hy-oas always returns `null` — not broker-quotable, stays FRED); a per-symbol `null` or non-finite ratio degrades that row alone to EOD. `Row` takes optional `liveValue`/`liveBand` and falls back to `indicator.value`/`indicator.band` when absent — byte-identical rendering for every pre-38-06 caller. The freshness footer flips from the exact `"EOD · as of …"` string to a `live-dot` + `"LIVE"` marker only while `liveStatus==="live"` AND at least one row actually rendered live (never a silent live/EOD mix, catch #26).
- `MarketRail.tsx`: takes the same optional `liveIndices`/`liveStatus` props and forwards them straight to `<RegimeBoard dense liveIndices={liveIndices} liveStatus={liveStatus} />` — no `useLiveStream` import or call (D-06, verified by both a grep-style source assertion and a passing-values integration test).
- `RegimeBoard` is now `export const RegimeBoard = memo(RegimeBoardImpl)` — an unchanged `liveIndices`/`liveStatus` reference on a parent re-render (simulating the 1/sec spot tick elsewhere on the Overview tree) does not re-invoke `useRegimeBoard()`/`usePicker()`/`useMacro()` inside it (RESEARCH Pitfall 4), verified via a mock-call-count spy across a `rerender()`.
- `Overview.tsx`: `liveIndices` added to the `useOverviewModel()` destructure (alongside the already-present `liveStatus`) and threaded into the `<MarketRail>` mount — the only edit to this shared file in this plan.

## Task Commits

1. **Task 1: RegimeBoard — live display value + client band recompute** — `1ab050c` (feat)
2. **Task 2: MarketRail forwards liveIndices/liveStatus (no hook) + Overview wiring + React.memo guard** — `04361b3` (feat)

## Files Created/Modified

- `apps/web/src/components/RegimeBoard.tsx` — `liveIndices`/`liveStatus` props, `LIVE_BAND_FNS` map, `liveValueFor()`, `Row`'s `liveValue`/`liveBand` overlay, live footer marker, `React.memo` wrap.
- `apps/web/src/components/RegimeBoard.test.tsx` — new describe block: live value + band (3 rows), quiet-stays-EOD, gate/hy-oas independence, per-symbol-null degrade.
- `apps/web/src/screens/MarketRail.tsx` — `liveIndices`/`liveStatus` props forwarded to `RegimeBoard`.
- `apps/web/src/screens/MarketRail.test.tsx` — new describe block: forwarding integration test, no-`useLiveStream`-call source guard, memo re-render-count guard.
- `apps/web/src/screens/Overview.tsx` — `liveIndices` added to the model destructure; passed into the `<MarketRail>` mount alongside the existing `liveStatus`.

## Decisions Made

See `key-decisions` in frontmatter: footer full-text-swap over string-append, one Map computed per RegimeBoard render rather than per-Row inline gating, and `Number.isFinite` as the single divide-by-zero/NaN guard for both live ratios.

## Deviations from Plan

### Process note (not a Rule 1-4 deviation)

The plan's tasks were implemented and their tests written together rather than strict test-first — given the mechanical, additive nature of the prop/overlay addition (no new business logic beyond a lookup + arithmetic already proven in `packages/core`), the RED step was effectively subsumed by writing the full test suite against the already-typed implementation and confirming every assertion (including the ones designed to catch a wrong band/value) passes for the right reason. All 4 new RegimeBoard tests and 3 new MarketRail tests were run and are green; no test was weakened or skipped to reach green.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `import.meta.url` is not a real `file://` URL inside a Vitest-transformed test module**
- **Found during:** Task 2, writing the "never calls useLiveStream" source-grep guard in `MarketRail.test.tsx`.
- **Issue:** `readFileSync(fileURLToPath(new URL("./MarketRail.tsx", import.meta.url)), ...)` threw `TypeError: The URL must be of scheme file` — Vitest's SSR module transform gives test files a virtual `import.meta.url`, not a real filesystem path.
- **Fix:** Read the file via a path relative to the vitest root (`readFileSync("apps/web/src/screens/MarketRail.tsx", "utf-8")`), and narrowed the guard to `.not.toContain("useLiveStream(")` (a call-site check) instead of a blanket substring check — the file legitimately imports the `LiveStreamStatus` *type* from `"../hooks/useLiveStream.ts"`, which a naive substring check would have flagged as a false failure.
- **Files modified:** `apps/web/src/screens/MarketRail.test.tsx` (already in scope).
- **Verification:** Test passes; `grep -n "useLiveStream" apps/web/src/screens/MarketRail.tsx` confirms the only two matches are the type import and a doc comment, never a call.
- **Committed in:** `04361b3` (Task 2 commit).

---

**Total deviations:** 1 auto-fixed (blocking, test-tooling only — no production code affected).
**Impact on plan:** No scope creep; the fix only changed how the D-06 guard test locates the source file.

## Issues Encountered

None beyond the above.

## Verification

- `bun run test -- --run apps/web/src/components/RegimeBoard.test.tsx apps/web/src/screens/MarketRail.test.tsx apps/web/src/screens/Overview.test.tsx` — 3 files, 128 tests, all pass.
- Full `apps/web` regression check (shared files: `RegimeBoard.tsx`, `MarketRail.tsx`, `Overview.tsx`, `useOverviewModel.ts`): 68 files, 821 tests, all pass.
- `bun run typecheck` — clean (`tsc --build --force`, no output).
- `bun run lint` — clean (exit 0; only pre-existing project-wide `[boundaries]` legacy-selector-syntax warnings, unrelated to this plan).
- `grep -n "useLiveStream" apps/web/src/screens/MarketRail.tsx` — 2 matches, both the type import and a doc comment; no call.
- `git diff --stat` against `apps/web/src/hooks/useRegimeBoard.ts` and `packages/core/src/analytics/application/getRegimeBoard.ts` — no changes; the EOD source is untouched.

## Known Stubs

None — every changed surface reads real data (the model's `liveIndices`/`liveStatus`, the existing regime-board/picker/macro hooks); no hardcoded placeholders introduced.

## Threat Flags

None new. The plan's own threat register (T-38-09, T-38-07, T-38-10) is the display-live/gate-EOD boundary this plan implements and tests directly — no additional network endpoint, auth path, or schema surface introduced.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The regime rail's 3 broker-quotable gauges read live while the stream is live (client-recomputed band), the gate/verdict/stored-band/EOD source and hy-oas stay EOD/FRED, and the footer honestly reverts on quiet/stalled — matching the plan's success criteria. 38-07 (integration gate + deploy notes + live RTH UAT) can proceed; no blockers.

## Self-Check: PASSED

- `apps/web/src/components/RegimeBoard.tsx` — FOUND
- `apps/web/src/components/RegimeBoard.test.tsx` — FOUND
- `apps/web/src/screens/MarketRail.tsx` — FOUND
- `apps/web/src/screens/MarketRail.test.tsx` — FOUND
- `apps/web/src/screens/Overview.tsx` — FOUND
- Commit `1ab050c` — FOUND in `git log --oneline --all`
- Commit `04361b3` — FOUND in `git log --oneline --all`

---
*Phase: 38-live-spx-spot-across-the-app-fan-the-already-flowing-sidecar*
*Completed: 2026-07-13*
