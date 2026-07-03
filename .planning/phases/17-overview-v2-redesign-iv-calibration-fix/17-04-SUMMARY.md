---
phase: 17-overview-v2-redesign-iv-calibration-fix
plan: 04
subsystem: ui
tags: [react, tos-dock, iv-calibration, staleness, row-highlight, tdd]

# Dependency graph
requires:
  - phase: 17-overview-v2-redesign-iv-calibration-fix (plan 01)
    provides: "resolveLegIv(occSymbol, spot, rate, divYield, liveTick, restMarketValue, netQty, now) -> Result<number, CalibrationError> — the per-leg price->IV bridge this plan wires into Overview"
  - phase: 17-overview-v2-redesign-iv-calibration-fix (plan 02)
    provides: "AnalyzerPosition.frontIvStatus/backIvStatus, t0ExcludedPositions(), buildScenarioStrip() — the leg-level exclusion contract and D-06/D-07 scenario-strip builder this plan feeds calibrated positions into"
  - phase: 17-overview-v2-redesign-iv-calibration-fix (plan 03)
    provides: "PayoffChart highlightedPositionId/highlightedTodayCurve/highlightedExpirationCurve/excludedFromT0Count props — the row-highlight dim/overlay and T+0 exclusion note this plan drives with real data"
provides:
  - "Overview.tsx rewritten to the TOS-dock layout (OVW-01): pill header, payoff hero + docked positions table (left), 320px GEX rail (right), positioning/macro + book/system rows below"
  - "Payoff hero prices via resolveLegIv-calibrated per-leg IV, never flat DEFAULT_IV on that path (OVW-02, T-17-05)"
  - "Row-level 'IV n/a' Badge+Tooltip for genuine non-convergence, net-book 'T+0 excludes N position(s): IV n/a' self-flag, cold-start legs excluded from honest pricing without a misleading badge (D-02, Pitfall 2/T-17-09)"
  - "Two-channel staleness badges: GEX 'as of' (reused relAge/GEX_FRESH_MS from Market.tsx, now exported) + new independent live-mark 'as of' badge (5-min amber threshold) (D-03/D-04)"
  - "Docked-table row hover/click highlights that position's T+0/@exp curve and dims the net-book curves (D-05)"
  - "Scenario strip with D-07 front-expiry @exp header, fed by buildScenarioStrip"
affects: [overview-v2-redesign, phase-18-analyzer-picker-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-commit split within a single-file rewrite: layout skeleton on a temporary flat-IV placeholder (non-TDD), then TDD RED/GREEN swaps in the real calibration/staleness/highlight behavior — keeps each commit independently verifiable"
    - "Mock the calibration collaborator (resolveLegIv), not the math — Overview.test.tsx controls Result outcomes directly via vi.mock, since resolveLegIv's own math is already covered by 17-01's property/unit tests"

key-files:
  created: []
  modified:
    - apps/web/src/screens/Overview.tsx
    - apps/web/src/screens/Overview.test.tsx
    - apps/web/src/screens/Market.tsx

key-decisions:
  - "Both a genuine IvError AND the wrapper's 'no-price' cold-start state map to AnalyzerPosition status 'non-convergent' (excluded from T+0/@exp pricing) — but only a genuine IvError sets the row-level 'IV n/a' badge flag. AnalyzerPosition's status field is a 2-state union with no 'no-data-yet' variant, and the alternative (treating cold-start as 'ok' with placeholder IV) would fabricate a guessed number into the hero calc, violating T-17-05. This means a cold-start leg is honestly excluded from T+0 (net-book exclusion note appears) but never shows the misleading 'did not converge' badge language on its own row."
  - "Payoff hero (repriceScenario) prices calendars only, built via pairPositionsIntoCalendars — the scenario engine models calendar spreads (front/back legs), and single unpaired legs have no natural front/back split to price through the same math. Singles remain visible as rows in the docked table (existing PositionsTable behavior, unchanged) but do not contribute a curve to the payoff hero. The current prod book (2 put calendars) has zero singles, so this is not an observed gap; documented as a scoping decision, not a silent omission."
  - "Live-mark badge timestamp source simplified to useLiveStream()'s own lastTickAt (the hook's already-computed 'most recent tick received' value) rather than re-deriving it from resolveLivePositionRow's per-row/total liveTs. Semantically equivalent for this purpose (the badge only needs 'how stale is the most recent tick'), and avoids threading a second live-total computation through the component tree just for the badge."
  - "'Analyzer →' in the payoff hero header renders as static (non-interactive) text, not a navigation link. Overview has no onNavigate prop — App.tsx mounts <Overview /> via ShellWithRouter's screens map with no navigation callback threaded in, and Shell.tsx/App.tsx are out of this plan's file scope. Wiring real cross-tab navigation is a Shell.tsx-level change belonging to a future plan, not this one."
  - "Task 1 (layout rewrite) is committed as a non-TDD `type=auto` task including necessary migration edits to the pre-existing Overview.test.tsx assertions (updated GEX mock fixture, replaced stale 'Market embed'/'Open positions · greeks' assertions with TOS-dock equivalents) — these are structural test updates caused directly by the layout rewrite, not new-behavior coverage. Task 2's TDD RED/GREEN cycle owns all NEW test coverage (calibration, staleness, highlight, D-07)."

requirements-completed: [OVW-01, OVW-02]

coverage:
  - id: D1
    description: "Overview renders the TOS-dock layout: pill header, payoff hero + docked positions table (left), 320px GEX rail (right), CotCard/MacroCard/BookSummary/SystemHealth below"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#renders the TOS-dock section headers"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#renders the live COT card and the live MacroCard"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#renders the payoff hero risk profile chart (visx SVG) for the combined book"
        status: pass
    human_judgment: true
    rationale: "Layout fidelity vs mockups/overview-v2.html (spacing, visual grammar, pill header placement) is a visual-fidelity judgment call the plan explicitly assigns to a human-check step — automated tests can only assert structural presence (headers, testids), not pixel/visual conformance."
  - id: D2
    description: "The payoff hero T+0 curve uses per-leg calibrated IV (live tick bsmIv, else REST-fallback invertIv via resolveLegIv), never a flat DEFAULT_IV on the hero path"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#a non-convergent leg renders an 'IV n/a' badge on its row and the net-book T+0 exclusion note"
        status: pass
      - kind: other
        ref: "grep resolveLegIv apps/web/src/screens/Overview.tsx — imported and called in resolveLeg(); grep DEFAULT_IV confirms it appears only in netGreeksForLegs (OQ2-deferred BookSummary path), never in the calendarBuild/repriceScenario call chain"
        status: pass
    human_judgment: false
  - id: D3
    description: "A non-convergent leg shows an 'IV n/a' badge on its docked-table row and the net-book self-flag note; a cold-start leg (no tick, marketValue===null) does NOT render the badge (Pitfall 2/T-17-09)"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#a non-convergent leg renders an 'IV n/a' badge on its row and the net-book T+0 exclusion note"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#a cold-start leg (no tick, marketValue===null) does NOT render an 'IV n/a' badge (Pitfall 2 / T-17-09)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The GEX 'as of' badge (reused verbatim) and a NEW live-mark 'as of' badge each show a timestamp and tint amber past their independent thresholds"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#renders the GEX 'as of' staleness badge (amber — the fixture snapshot is stale)"
        status: pass
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#renders the live-mark badge amber when the last tick is older than 5 minutes"
        status: pass
    human_judgment: true
    rationale: "Live behavior during/outside RTH (mark freezing to last known value without ever blanking the payoff, GEX badge amber-tinting on the real 30-min refresh cadence) is a manual-only verification per 17-VALIDATION.md — the unit tests prove the threshold/formatting logic, not live production timing."
  - id: D5
    description: "Hovering/selecting a positions-table row highlights that position's payoff contribution (full-emphasis overlay curve) and dims the net-book curves (stroke-opacity 0.3, distinct from the opacity-40 row-exclusion class)"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#selecting a docked-table row highlights that position's curve in PayoffChart (dims the net book)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The scenario-strip @exp column header names the book's FRONT expiry date"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx#the scenario-strip @exp column header names the front expiry date (D-07)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-03
status: complete
---

# Phase 17 Plan 04: Overview TOS-Dock Integration + IV-Calibration Wiring Summary

**Rewrote Overview.tsx into the TOS-dock layout and wired the payoff hero to price via per-leg calibrated IV (resolveLegIv), replacing the flat DEFAULT_IV guess with honest non-convergence badging, two-channel staleness, and row-highlight — the Wave-2 integration plan that lands all four Phase-17 ROADMAP success criteria on screen**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 (Task 1 layout rewrite, Task 2 TDD calibration/staleness/highlight wiring)
- **Files modified:** 3 (Overview.tsx, Overview.test.tsx, Market.tsx)

## Accomplishments

- **TOS-dock layout (OVW-01):** pill header (SPX spot, net γ/1% + regime chip, γ flip, VIX,
  VVIX, Fed funds, 10y−2y, COT lev, book P&L) using the shipped `MetricChip` pill language;
  two-column body — payoff hero (`PayoffChart`) + docked positions table on the left, 320px
  GEX rail (compact `GammaProfile`, `GexBars` locked to `mode="gex"`, key levels, net book
  greeks) on the right; `CotCard`/`MacroCard`/`BookSummary`/`SystemHealth` reused unmodified
  below, only their page position shifted.
- **Calibrated payoff hero (OVW-02, D-01):** each calendar's front/back leg IV resolves via
  `resolveLegIv` — trusts an already-converged live tick's `bsmIv`, else calibrates from the
  REST-fallback price. `frontIv`/`backIv`/`frontIvStatus`/`backIvStatus` feed `repriceScenario`
  directly; `DEFAULT_IV` never appears on this path (verified by grep — it exists only in
  `netGreeksForLegs`, the OQ2-deferred `BookSummary` path).
- **Honest non-convergence (D-02, Pitfall 2/T-17-09):** a genuine `IvError` renders an amber
  "IV n/a" `Badge`+`Tooltip` on the docked-table row and contributes to the net-book "T+0
  excludes N position(s): IV n/a" self-flag (via `t0ExcludedPositions` → `PayoffChart`'s
  `excludedFromT0Count`). A cold-start leg (`no-price`, no tick + `marketValue===null`) is
  still honestly excluded from T+0 pricing — never a fabricated guess — but does NOT get the
  misleading "did not converge" badge.
- **Two-channel staleness (D-03/D-04):** the GEX "as of" badge reuses `relAge`/`GEX_FRESH_MS`
  from `Market.tsx` verbatim (now exported, pure additive change); a new, independent live-mark
  "as of" badge amber-tints past 5 minutes — both convert to local time (CBOE-UTC regression
  gate held).
- **Row-highlight (D-05):** hover/click on a docked-table row spotlights that position's T+0/@exp
  curve in `PayoffChart` at full emphasis and dims the net-book curves to `stroke-opacity: 0.3`
  (chart-layer, distinct from `PositionsTable`'s `opacity-40` row-exclusion class) — mirrors
  `AdHocPicker`'s `clearHovered` toggle (re-click clears, different row switches).
- **Scenario strip (D-06/D-07):** renders below the payoff chart via `buildScenarioStrip`, with
  the `@exp` column header naming the book's front expiry (e.g. `@ exp (Nov 20)`).
- **Single `useLiveStream()` invariant preserved** — grep-confirmed one call site, threaded into
  the payoff hero + docked table only.

## Task Commits

1. **Task 1: TOS-dock layout rewrite (OVW-01)** — `ea56e24` — `feat(17-04): TOS-dock layout rewrite for Overview (OVW-01)`
   (non-TDD `type=auto`; payoff hero temporarily priced via a flat `DEFAULT_IV` placeholder,
   explicitly documented inline as superseded by Task 2 in the same plan/file)
2. **Task 2: Wire calibrated IV + staleness badges + row-highlight (OVW-02, D-01..D-07)** — TDD:
   - RED: `24da999` — `test(17-04): add failing tests for calibrated IV, staleness badges, row-highlight`
   - GREEN: `012520f` — `feat(17-04): wire calibrated IV, staleness badges, row-highlight into Overview`

## Files Created/Modified

- `apps/web/src/screens/Overview.tsx` — rewritten: TOS-dock layout, per-leg calibrated
  `AnalyzerPosition` build (`resolveLeg`/`buildCalendarPosition`), "IV n/a" `Badge`+`Tooltip`,
  net-book T+0 exclusion wiring, GEX + live-mark staleness badges, row-highlight local state
  threaded into `PositionsTable` + `PayoffChart`, `buildScenarioStrip`-driven scenario strip.
- `apps/web/src/screens/Overview.test.tsx` — full `GexSnapshotEntry` fixture (GEX rail needs
  `profile`/`strikes`/`computedAt`, not just `spot`), TOS-dock structural assertions, and 6 new
  TDD tests for calibration/staleness/highlight/D-07 (`resolveLegIv` mocked to control Result
  outcomes deterministically per test).
- `apps/web/src/screens/Market.tsx` — exported `relAge`/`GEX_FRESH_MS` (previously module-private)
  so `Overview.tsx` reuses them verbatim per the plan's explicit interface contract; pure
  additive change, no behavior difference for `Market.tsx` itself.

## Decisions Made

See `key-decisions` in frontmatter for the full rationale on each:
- Cold-start ("no-price") legs are excluded from T+0/@exp pricing (never a guessed IV) but do
  NOT get the "IV n/a" badge — only a genuine `IvError` does.
- Payoff hero prices calendars only (via `pairPositionsIntoCalendars`); singles remain
  table-only rows (no observed gap — prod book is currently 2 calendars, 0 singles).
- Live-mark badge uses `useLiveStream()`'s own `lastTickAt` rather than re-deriving a
  per-row/total live timestamp.
- "Analyzer →" renders as static text (Overview has no navigation callback wired from
  `App.tsx`/`Shell.tsx`, both out of this plan's scope).
- Task 1 included necessary migration edits to pre-existing `Overview.test.tsx` assertions
  (structural, caused directly by the layout rewrite) — Task 2's TDD cycle owns all new
  behavior coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `relAge`/`GEX_FRESH_MS` from `Market.tsx`**
- **Found during:** Task 2 GREEN implementation
- **Issue:** The plan's own interfaces contract says "Existing — `apps/web/src/screens/Market.tsx`
  (reuse verbatim): `relAge(ms): string`, `GEX_FRESH_MS`" — but both were module-private
  (no `export` keyword), so `Overview.tsx` could not import them without either reimplementing
  the same logic (explicitly forbidden by the plan/UI-SPEC: "do not invent a second staleness
  language") or adding the export. `Market.tsx` is not in this plan's `files_modified` list.
- **Fix:** Added `export` to both `relAge` and `GEX_FRESH_MS` in `Market.tsx` — a pure additive,
  zero-behavior-change edit (same function body, same constant value).
- **Files modified:** `apps/web/src/screens/Market.tsx`
- **Verification:** `bun run typecheck` clean; `Market.test.tsx` suite still green (unaffected).
- **Committed in:** `012520f` (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] `Overview.test.tsx`'s pre-existing `useGex` mock upgraded to a full fixture**
- **Found during:** Task 1, writing the layout
- **Issue:** The pre-existing test mock (`useGex: vi.fn(() => ({ data: { spot: 7381 } }))`) only
  supplied `spot` — the new GEX rail (`GammaProfile`/`GexBars`) reads `profile`/`strikes`/
  `computedAt`/`callWall`/`putWall`/`flip`/`netGammaAtSpot`, all `undefined` under the old mock,
  which crashes those components at render time (e.g. `gex.profile.length` on `undefined`).
- **Fix:** Replaced the mock with a complete, realistic `GexSnapshotEntry` fixture matching the
  contract's own test fixture shape (`packages/contracts/src/gex.test.ts`).
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Verification:** Full `Overview.test.tsx` suite green (9/9 after Task 1, 15/15 after Task 2).
- **Committed in:** `ea56e24` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues required to satisfy the plan's
own explicit interface contract and to render the new GEX-dependent components at all). No scope
creep — `Market.tsx`'s only change is adding two `export` keywords; the test fixture upgrade is
required test infrastructure, not new production behavior.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. The payoff hero, staleness badges, row-highlight, and scenario strip all render from real
computed data (repriceScenario over calibrated positions, live GEX/COT/macro hook data) — no
hardcoded empty values or placeholder text on the delivered surfaces.

## Next Phase Readiness

- All four Phase-17 ROADMAP success criteria are now visible on the Overview screen: TOS-dock
  layout (OVW-01), calibrated per-leg T+0 IV never falling back to flat `DEFAULT_IV` on the hero
  (OVW-02), tagged non-convergence shown on screen (D-02), and stale GEX + live-mark timestamps
  (D-03/D-04).
- `BookSummary`/`netGreeksForLegs`'s `DEFAULT_IV` deferral (OQ2) is recorded here — a future,
  lower-priority follow-up plan can migrate that tile to calibrated per-leg IV using the same
  `resolveLeg`/`buildCalendarPosition` helpers already established in this plan.
- Remaining Phase-17 verification: end-of-phase human checks (layout fidelity vs
  `mockups/overview-v2.html`, live staleness behavior during/outside RTH) per
  `17-VALIDATION.md`'s Manual-Only Verifications — no further plans in this phase.
- No blockers for Phase 18 (Analyzer → picker UI).

---
*Phase: 17-overview-v2-redesign-iv-calibration-fix*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: apps/web/src/screens/Overview.tsx
- FOUND: apps/web/src/screens/Overview.test.tsx
- FOUND: apps/web/src/screens/Market.tsx
- FOUND: .planning/phases/17-overview-v2-redesign-iv-calibration-fix/17-04-SUMMARY.md
- FOUND commit: ea56e24 (Task 1 — TOS-dock layout rewrite)
- FOUND commit: 24da999 (Task 2 RED — calibration/staleness/highlight tests)
- FOUND commit: 012520f (Task 2 GREEN — calibrated IV/staleness/highlight wiring)
