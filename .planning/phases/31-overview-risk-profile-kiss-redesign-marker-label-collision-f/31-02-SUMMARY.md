---
phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f
plan: 02
subsystem: ui
tags: [react, zod, contracts, regime-board, gauges, aria, market-rail]

requires:
  - phase: 29-rule-settings-runtime-overrides
    provides: resolveRegimeRuleConfig (Phase-29 overrides-aware effective warn/crisis thresholds getRegimeBoard.ts already resolves per request)
provides:
  - "regimeIndicator.bandWarn/bandCrisis — required additive contract fields carrying the effective warn/crisis thresholds used to compute band"
  - "RegimeGauge — role=meter linear bullet gauge (warn/crisis-banded track + value marker) replacing each banded regime row's value-half"
affects: [regime-board, market-rail, overview-screen, regime-contract, regime-route]

tech-stack:
  added: []
  patterns:
    - "Effective-config-as-contract-field: a use-case that already resolves per-request overrides surfaces the resolved values themselves (not just their downstream classification) as additive required response fields — single source of truth, zero client threshold copies"
    - "role=meter styled div over native <meter> — full band-color control unavailable via ::-webkit-meter-* pseudo-elements cross-browser, ARIA semantics preserved (scalar reading in a bounded range, not progressbar)"

key-files:
  created: []
  modified:
    - packages/contracts/src/regime.ts
    - packages/contracts/src/regime.test.ts
    - packages/core/src/analytics/application/getRegimeBoard.ts
    - packages/core/src/analytics/application/getRegimeBoard.test.ts
    - apps/server/src/adapters/http/analytics.routes.test.ts
    - apps/web/src/components/RegimeBoard.tsx
    - apps/web/src/components/RegimeBoard.test.tsx
    - apps/web/src/screens/MarketRail.test.tsx

key-decisions:
  - "bandWarn/bandCrisis added as REQUIRED z.number() (not .optional()) — a stale post-deploy response missing them fails Zod parse (React Query isError) instead of rendering undefined gauge math (T-31-04)"
  - "GAUGE_SCALE (client-side visual axis min/max) stays a frontend lookup table beside SHORT_LABELS — it carries no semantic meaning to gate on, only where the ruler starts/ends; warn/crisis band positions come exclusively from the response"
  - "Marker color reads indicator.band verbatim (never recomputed from value/thresholds client-side, T-31-05) — calm/bg-txt (not the old dim bg-line2 dot, too low-contrast as a positioned marker), warning/bg-amber, crisis/bg-down"
  - "Removed the standalone size-1.5 band dot (regime-band-\${id}) — the marker now carries the same color signal on line 2; keeping both double-encoded the same fact for no added scan speed (ponytail)"
  - "One plan owns contract+core+web because the required-field change breaks every existing regimeIndicator fixture in the repo in the same wave — splitting would force two plans to edit the same fixture files for no gain"

requirements-completed: [DEFECT-2]

coverage:
  - id: G1
    description: "regimeIndicator round-trip: a full indicator (incl. bandWarn/bandCrisis) parses; an object missing either field fails safeParse (required-field enforcement, T-31-04)"
    requirement: "DEFECT-2"
    verification:
      - kind: unit
        ref: "packages/contracts/src/regime.test.ts#rejects an indicator missing bandWarn / bandCrisis — required, not optional"
        status: pass
    human_judgment: false
  - id: G2
    description: "getRegimeBoard populates bandWarn/bandCrisis from resolveRegimeRuleConfig for all 4 indicators (default values), and returns the OVERRIDDEN value when a Phase-29 regime override is present — proving the field tracks effective config, not a constant"
    requirement: "DEFECT-2"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#computes vix-term-structure/vvix/vix9d-vix/hy-oas ... (bandWarn/bandCrisis assertions added to each)"
        status: pass
      - kind: unit
        ref: "packages/core/src/analytics/application/getRegimeBoard.test.ts#a regime override shifts bandWarn on the response — proves the field tracks effective config, not a constant"
        status: pass
    human_judgment: false
  - id: G3
    description: "Each of the 4 banded regime rows renders a role=meter linear bullet gauge; band segments position from response bandWarn/bandCrisis; marker color reads indicator.band; marker clamps to [0,100]% for arbitrary value/threshold inputs"
    requirement: "DEFECT-2"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#renders a role=meter gauge per indicator, band-colored marker, aria carrying value/band (DEFECT-2)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#positions band segments from response bandWarn/bandCrisis (not client threshold constants)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#clamps the marker position at both axis ends (fast-check: value/min/max never overflow [0,100]%)"
        status: pass
    human_judgment: false
  - id: G4
    description: "ENTRY GATE, rates block, COT block, tooltip, freshness footer, and loading/empty/error branches are unchanged"
    requirement: "DEFECT-2"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx — full existing suite (gate-chip, rate-chip, regime-why, regime-freshness, loading/error/empty) still green, 28/28 passing"
        status: pass
      - kind: unit
        ref: "bun run test — full workspace (280 files, 3028 tests) green"
        status: pass
    human_judgment: true
    rationale: "Perceptual 'reads at a glance on morai.wtf' verification is deferred to 31-VALIDATION.md's manual post-deploy check per the plan's own verification section."
---

# Phase 31 Plan 02: Regime Board Linear Band-Gauges Summary

**Threaded Phase-29-effective warn/crisis thresholds through the regime contract as required additive fields (bandWarn/bandCrisis), then replaced each banded regime row's raw value with a role=meter linear bullet gauge whose band segments and marker read those response fields — never a client threshold copy.**

## Performance

- **Duration:** ~6 min (task execution; excludes read/context-gathering)
- **Completed:** 2026-07-10T18:38:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- `regimeIndicator` (contracts) gained `bandWarn`/`bandCrisis` as REQUIRED `z.number()` fields — a stale post-deploy response missing them now fails `regimeResponse.parse()` (React Query `isError`) instead of ever rendering undefined gauge math.
- `getRegimeBoard.ts` surfaces `resolveRegimeRuleConfig`'s effective per-indicator warn/crisis at all 4 push sites (`vix-term-structure`, `vvix`, `vix9d-vix`, `hy-oas`) — values the use-case already resolves for banding, now shipped in the payload too. Zero route/MCP code change (both already parse/pass the result through).
- An override-proof test confirms `bandWarn`/`bandCrisis` track the effective (overridden) config, not the module's default constants.
- Each of the 4 banded `RegimeBoard` rows now renders a two-line layout: line 1 keeps the label/tooltip/value exactly as before (minus the redundant band dot), line 2 is a `role="meter"` linear bullet gauge — warn segment (`bg-amber/30`), crisis segment (`bg-down/30`), and a value marker colored by `indicator.band` (never recomputed client-side).
- Marker position clamps to `[0, 100]%` for out-of-range values (fast-check property, 50 runs, arbitrary value/min/max); the printed numeric value on line 1 is never clamped.
- ENTRY GATE, rates block, COT block, tooltip, freshness footer, and the loading/empty/error branches are byte-untouched.

## Task Commits

Each task followed RED → GREEN (test-first commit, then implementation commit) per `.claude/rules/tdd.md`:

1. **Task 1: Thread bandWarn/bandCrisis through contract + core**
   - test: `e32589c` — safeParse rejects missing bandWarn/bandCrisis; getRegimeBoard default + override-proof assertions; backend fixtures updated
   - feat: `d42fb65` — contract + `getRegimeBoard.ts` implementation, all 4 push sites
2. **Task 2: RegimeGauge — banded bullet gauge replaces the value-half of each regime row**
   - test: `b00e37e` — fixtures gain bandWarn/bandCrisis; band-color regression retargeted to `regime-gauge-marker-${id}`; new role=meter/aria/band-segment/clamp-property assertions
   - feat: `cf63cad` — `RegimeGauge` implementation in `RegimeBoard.tsx`

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/contracts/src/regime.ts` — `regimeIndicator` gains required `bandWarn: z.number()` / `bandCrisis: z.number()`
- `packages/contracts/src/regime.test.ts` — `validIndicator` fixture + 2 new required-field rejection tests
- `packages/core/src/analytics/application/getRegimeBoard.ts` — `RegimeIndicatorOut` gains `bandWarn`/`bandCrisis`; all 4 `indicators.push({...})` sites spread `config.<group>.warn`/`.crisis`
- `packages/core/src/analytics/application/getRegimeBoard.test.ts` — bandWarn/bandCrisis assertions on all 4 default-population tests + new override-proof test
- `apps/server/src/adapters/http/analytics.routes.test.ts` — `regimeIndicator` fixture gains bandWarn/bandCrisis (so `regimeResponse.parse()` no longer throws)
- `apps/web/src/components/RegimeBoard.tsx` — `GAUGE_SCALE` map + marker-color map added beside `SHORT_LABELS`; `Row` reworked to `flex-col` two-line layout; band dot removed; new `role="meter"` gauge (warn/crisis segments + marker) per row
- `apps/web/src/components/RegimeBoard.test.tsx` — `INDICATORS` fixture gains bandWarn/bandCrisis; band-color regression retargeted from `regime-band-${id}` to `regime-gauge-marker-${id}`; 3 new tests (gauge/aria, band-segment position, clamp fast-check property)
- `apps/web/src/screens/MarketRail.test.tsx` — inline regime fixture gains bandWarn/bandCrisis

## Decisions Made
- `bandWarn`/`bandCrisis` required (not `.optional()`) per the UI-SPEC fail-loud decision — matches the plan's `<critical_constraint>` and threat T-31-04 mitigation.
- `BAND_CLASSES` simplified from `{dot, text}` to `{text}` — the `dot` variant is dead now that the marker carries the color signal; kept `MARKER_CLASSES` as a distinct map per UI-SPEC's explicit "do NOT reuse BAND_CLASSES.dot" instruction (calm needs a visible `bg-txt`, not the old low-contrast `bg-line2`).
- `GAUGE_SCALE` fallback (`{ min: 0, max: Math.max(bandCrisis, value, 1) }`) added defensively for an id not in the map — all 4 live ids are covered, so this only guards a hypothetical future 5th indicator (marked with a `ponytail:` comment).
- Band-segment positions (`warnPct`/`crisisPct`) use unclamped `axisPct` per the plan's literal formula; only the marker uses `clampedAxisPct` — matches the UI-SPEC's explicit "only the marker position is clamped" language.

## Deviations from Plan

None — plan executed exactly as written. All 8 `files_modified` in the plan frontmatter match the files actually touched; no additional files changed.

## Issues Encountered

None. `bun run typecheck`, `bun run lint`, and `bun run test` (full workspace: 280 files, 3028 tests) all ran clean on the first pass after Task 2's implementation commit — no pre-existing unrelated failures surfaced in this plan's touched files.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- DEFECT-2 closed: all 4 banded regime rows render linear bullet gauges sourced from the effective (Phase-29-aware) thresholds.
- Manual perceptual verification ("gauges read at a glance on morai.wtf left rail") remains deferred to `31-VALIDATION.md`'s post-deploy check, as scoped by the plan's own `<verification>` block.
- Both Plan 31-01 (chart marker collision) and Plan 31-02 (regime gauges) are now complete — phase 31 is ready for the next verification/deploy step.
- No blockers.

---
*Phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 8 created/modified files confirmed present on disk; all 4 task commit hashes (`e32589c`, `d42fb65`, `b00e37e`, `cf63cad`) confirmed in `git log`.
