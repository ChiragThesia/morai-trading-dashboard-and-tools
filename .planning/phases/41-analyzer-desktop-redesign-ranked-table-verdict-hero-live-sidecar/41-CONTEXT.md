# Phase 41: Analyzer Cleanup — Context

**Gathered:** 2026-07-14
**Status:** Ready for UI-SPEC + planning
**Mode:** Live discuss — user answered AskUserQuestion 2026-07-14 (options + previews shown, selections verbatim)

<domain>
## Phase Boundary

User (2026-07-14): "the analyze tab needs clean up and better UI/UX."

Current desktop state (screenshot: `41-CURRENT-STATE.png` in this dir, live morai.wtf capture):
- Top: 11 micro-chips (FWD-IV EDGE ✓69%, SLOPE ✓83%, GEX FIT ✓80%, EVENT RISK ~50%,
  BE:EM −43%, DEBIT ✓70%, Δ NEUTRAL ✓98%, VRP ✗0%, Θ/VEGA ✓100%, Θ GATE +18.1/d,
  CALIBRATING…) — no hierarchy, no verdict; plus a bare debug line ("1143 illiquid quotes
  dropped this run").
- Left rail: 17+ near-identical candidate cards, ~10 micro-text rows + 4 unlabeled bars +
  Combine/Copy each → ~1,900px scroll; comparison impossible; score de-emphasized.
- Center/right columns end ~600px; page is 3,274px tall — dead columns beside one endless rail.
- Raw floats everywhere (`vega +61.9536112`, `debit $652.2`).
- Selection linkage between rail card and WHY THIS CALENDAR panel implicit/unclear.

In scope: desktop Analyzer redesign + mobile parity for the new idioms + live sidecar-fed
data for the tab's marks/spot. Out of scope: picker engine/scoring math, rule settings,
Overview/Journal tabs.

</domain>

<decisions>
## Implementation Decisions (USER-LOCKED 2026-07-14, live AskUserQuestion)

- **D-01 (AUI-01) Ranked table + detail pane.** Candidates become a compact sortable table —
  one row per candidate: score, strikes/dates, debit, Θ/d, key event flag. Clicking a row
  loads that candidate into the center/right detail panels (risk profile chart, term
  structure, WHY THIS CALENDAR, entry/exit plan). User saw and picked this preview:
  ```
  │ 81 │ 7525P Aug 6 / Aug 10 │ $652│ +18/d │ FOMC⚡│
  │ 76 │ 7500P Aug 5 / Aug 10 │ $919│ +21/d │ FOMC⚡│
  Selected row drives RISK PROFILE + WHY panels →
  ```
  Combine/Copy survive as row actions or detail-pane buttons.
- **D-02 (AUI-02) Verdict hero + grouped factors.** One dominant verdict (✓ FAVORABLE /
  caution / skip + score + Θ gate headline), factors clustered under Edge / Risk / Fit
  groups with existing pass/fail marks. Chips die. User-picked preview:
  ```
  ✓ FAVORABLE   score 81/100    Θ +18.1/d
  EDGE            RISK            FIT
  fwd-iv ✓ 69%    event  ~ 50%    gex    ✓ 80%
  slope  ✓ 83%    be:em  − 43%    Δneut  ✓ 98%
  vrp    ✗ 0%     debit  ✓ 70%    θ/vega ✓ 100%
  ```
  Verdict wording must stay evidence-honest (no fabricated confidence; existing scoring
  verdicts only). Calibrating banner + dropped-quotes line → quiet ⓘ/footer.
- **D-03 (AUI-03) Sticky layout rebalance.** Center chart + right panels stay usable while
  the table scrolls; no dead columns; page height content-driven.
- **D-04 (AUI-04) Round the numbers.** Dollars whole, greeks ≤2dp, theta/vega ≤1dp across
  the tab. Formatting at display layer only — never mutate stored/computed values.
- **D-05 (AUI-05) Paste-flow polish + term-structure cleanup.** Bigger paste target, clear
  Analyze affordance; term-structure chart taller, clearer short/long leg markers, event
  chips visually tied to curve kinks.
- **D-06 (AUI-06) Mobile friendly — user's explicit addition.** Every new idiom gets a
  designed mobile treatment through the EXISTING analyzer-mobile tree (Phase 36 conventions:
  dedicated mobile components behind useIsDesktop, useAnalyzerModel shared hook, no dual
  desktop/mobile branches inside one component). Desktop redesign must not degrade mobile;
  matchMedia/jsdom test discipline per Phase 35/36 LAWs.
- **D-07 (AUI-07) Fully sidecar-driven — user's explicit addition, EXPLICIT OVERRIDE.**
  User: "NEED TO BE DRIVEN FULLY BY THE side car where we pull info from." This overrides
  Phase 38's user-locked "Analyzer scoring stays snapshot-spot (marker-only live)". The
  Analyzer's marks/spot/risk-profile inputs consume the live sidecar stream (useLiveStream
  seam from 38-04) with honest stale-fallback (quiet/stalled → snapshot values + stale
  badge, catch #26 law). Regime/entry gates still obey DISPLAY-LIVE/GATE-EOD. Research must
  define exactly which scoring inputs may go live vs which must stay point-in-time honest
  (as-of provenance on every displayed number) — never let a live tick silently change a
  stored score's meaning; if the displayed score was computed on snapshot data, its as-of
  says so.

### Claude's Discretion

Table column set/order details, sort affordances, sticky implementation, detail-pane
transitions, ⓘ placement, exact rounding table, mobile fold structure — follow Phase 36/39
conventions and the design system (Button primitive, BulletGauge idiom, panel chrome).

</decisions>

<code_context>
## Existing Code Insights

- Desktop tree: `apps/web/src/screens/Analyzer.tsx` + candidate cards/scorecard components;
  shared model: `useAnalyzerModel` (Phase 36 extraction) — single consumer discipline.
- Mobile tree: `apps/web/src/screens/analyzer-mobile/` (AnalyzerMobile, MobileScorecard —
  the verdict-hero idiom D-02 mirrors, MobileChartControls) behind `useIsDesktop`.
- Live stream seam: `useLiveStream` (liveSpot/liveIndices, 38-04) + live-aware model spot in
  `useOverviewModel` — the pattern AUI-07 extends to the Analyzer model.
- Design system: `components/system/Button.tsx`, `components/system/BulletGauge.tsx`,
  panel/chip idioms; Recharts 3.9.2 for charts (laws: ifOverflow="hidden", zIndex presets,
  useXAxisScale/usePlotArea for custom layers — catches #18-#20).
- Picker data: candidates from picker snapshots (computePickerSnapshot), WHY panel +
  entry/exit plan render scored-factor provenance; Re-pull affordance exists.
- LAWs to respect: verdict-gated affordances (catch #23), no `?? fallback` lies on gated
  views (catch #26), flex-wrap on adjacent inline chips (catch #27), force-open needs real
  `open` attr via matchMedia (catch #24), UseQueryResult full mock builder in web tests.
</code_context>

<specifics>
## Specific Ideas

- Current-state screenshot committed as `41-CURRENT-STATE.png` — UI researcher starts there.
- Acceptance shape: user visually approves the new desktop + mobile Analyzer on morai.wtf
  (user drives UAT or standing chrome-devtools permission); no candidate scroll wall; row
  click → detail swap is instant and obvious; numbers read at trading precision everywhere.
</specifics>

<deferred>
## Deferred Ideas

- Scoring-engine changes (weights, gates, new factors) — engine untouched this phase.
- Overview/Journal styling drift — separate passes.
- Compare mode (2-3 candidates side-by-side) — user chose table+detail instead; revisit
  only if the table proves insufficient.
</deferred>
