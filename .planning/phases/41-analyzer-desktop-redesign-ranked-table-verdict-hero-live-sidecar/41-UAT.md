# Phase 41 UAT — Analyzer Cleanup (AUI-01..07)

**Date:** 2026-07-14
**Deployed:** morai.wtf (Vercel auto-deploy from `main`; final commit `372ad2a`)

## Automated Results (Plan 41-05 Task 1)

| Gate | Result |
|---|---|
| `bun run test` (root, full workspace) | PASS — 3638/3638 pre-fix run; rerun after `372ad2a` (adds 1 test → 3639) recorded below |
| `bun run typecheck` (root) | PASS — clean |
| apps/web own tsc (`bunx tsc -p apps/web --noEmit`, catch #29) | PASS — pre-existing 8-error baseline only (GexBars ×2, PayoffChart ×1, ErrorBoundary ×2, Button ×1, parsed-calendar-to-candidate ×1, Overview.test ×1); zero new errors |
| `bun run lint` | PASS — clean |
| AUI-04 law grep: `rg -c 'exactAbs'` on Analyzer.tsx + MobileScorecard.tsx | PASS — 0 matches both files |
| AUI-07 honesty grep: `rg -n 'liveSpot\|liveStatus'` MobileScorecard.tsx | PASS — 0 matches; Analyzer.tsx matches are badge/chart chrome only, none inside the verdict-hero JSX |
| Green-suite law grep: `rg -n 'scoring-pills\|scoring-checklist\|candidate-card-'` Analyzer.tsx | PASS — no retired testid emitted by the desktop source |
| Full-suite rerun after date-compaction fix (`372ad2a`) | PASS — 3639/3639 (see 41-05-SUMMARY evidence) |

### Post-gate fix folded in

Live UAT surfaced one visual defect: live picker names carry ISO dates
(`7525P 2026-08-06 / 2026-08-10`) which wrapped each table row to four lines at 1440px —
the fixture names are short-form, so the suite could not see it. Fixed red→green in
`372ad2a`: `compactCalendarName` (pure string transform, no `Date` construction per the
local-vs-UTC law) + `whitespace-nowrap` on the calendar cell. Rows now render one line,
matching the UI-SPEC preview (`7525P Aug 6 / Aug 10`).

## Desktop Tripwire (Plan 41-05 Task 2)

The existing "Analyzer — right column (Task 2, ANLZ-03/D-01b)" and payoff-center describe
blocks pass unchanged in the gate run — PayoffChart, TermStructureChart, WhyPanel, and
EntryExitPlan still render for the selected row and re-wire on a new selection. Detail-pane
component structure is unchanged (TermStructureChart received numeric-literal edits only).

## Human-Verify Script (walked via standing chrome-devtools permission 2026-07-14; screenshots delivered to user)

### Desktop — morai.wtf → ANALYZER tab, ≥1280px viewport

1. Candidate list is a compact TABLE (Score ▼ / Calendar / Debit / Θ/d / Event / ⊕), not a
   17-card scroll wall. — **PASS** (`41-UAT-desktop.png`)
2. Verdict hero reads `✓ FAVORABLE score 79/100 Θ +17.7/d` over EDGE / RISK / FIT factor
   groups with pass/fail marks; chips gone; calibrating + dropped-quotes copy demoted to a
   quiet footer line. — **PASS**
3. Clicking a row instantly swaps risk-profile chart + term structure + WHY THIS CALENDAR +
   ENTRY/EXIT PLAN to that candidate; selected row highlighted violet. — **PASS** (a11y
   snapshot: detail panels track selection)
4. Score/Debit/Θ headers sort with aria-sort; table scrolls under a sticky header while
   center/right panels stay put; no dead columns; page height content-driven. — **PASS**
5. Numbers at trading precision: `$673` whole-dollar debit, `θ +17.7/d`, `vega +61.99`. —
   **PASS**
6. LiveStatusBadge in the Risk-profile header. — **PASS** (reads LIVE during RTH)
7. Term-structure chart taller with clear `short f` / `long b` markers and event labels
   (CPI/FOMC/NFP) on the curve. — **PASS**
8. Table rows one line each (post-`372ad2a`). — **PASS at 1440px** (re-verify visually on
   next deploy if desired)

### Mobile — morai.wtf → ANALYZER, 390px viewport

9. CandidateCard tap-to-select list (no table); paste target + Analyze on top. — **PASS**
   (`41-UAT-mobile.png`)
10. Scorecard shows the verdict-word headline (`✓ FAVORABLE score 79/100 Θ +17.7/d`) with
    EDGE / RISK / FIT stacked groups and rounded numbers. — **PASS**
    (`41-UAT-mobile-scorecard.png`)
11. LiveStatusBadge in the chart chrome row. — **PASS** (reads LIVE)

### Live check (RTH)

12. Badge reads LIVE and the payoff T+0 marker tracks the live SPX tick (header spot
    7545.8, BE-today pill 7546 — consistent with the live sidecar stream). — **PASS**
13. QUIET/STALLED fallback (marker falls back to snapshot spot, badge honest) — covered by
    unit tests (useAnalyzerModel live-seam suite); live stall not reproducible on demand. —
    **PASS (test-evidenced)**

### Outcome

Operator walk: 13/13 PASS. Final user visual approval: screenshots delivered 2026-07-14;
awaiting user thumbs-up (end-of-phase human gate).
