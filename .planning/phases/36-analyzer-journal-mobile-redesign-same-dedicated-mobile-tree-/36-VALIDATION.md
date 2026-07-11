---
phase: 36
slug: analyzer-journal-mobile-redesign
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-11
source: extracted from 36-UI-SPEC.md "Validation Architecture" (approved 2026-07-11)
---

# Phase 36 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 + @testing-library/react 16.3.0, jsdom (apps/web) |
| **Config** | `apps/web/vitest.config.ts` — existing, unchanged |
| **Quick run command** | `bunx vitest run apps/web/src/screens/Analyzer.test.tsx` (or touched file) |
| **Full suite command** | `bun run test` (root workspace) |
| **Structural limit** | jsdom has NO layout engine: bleed/pan/scroll/zoom/paint claims are jsdom-blind. Automatable = DOM structure, classes, attributes, order, behavior, prop assertions, zero-diff greps. Layout claims go through the chrome-devtools checklist (C1–C11). |
| **Branch mechanism** | `useIsDesktop` FALSE under jsdom default → mobile trees are jsdom's default render. Desktop assertions need the matchMedia stub (established pattern: MarketRail.test.tsx / Overview.test.tsx `stubDesktopMatchMedia`). Existing Analyzer.test.tsx and Journal.test.tsx desktop tests MIGRATE to the stub IN THE SAME PLAN as each screen's switch (J2/J3 — the per-screen byte-identity guards). |

## Sampling Rate

- **Per task commit:** `bunx vitest run <changed test file>`
- **Per wave:** `bun run test` (full workspace)
- **Phase gate:** full suite + typecheck + lint green, then chrome-devtools 390×844 +
  320px + 1440px checklists (C1–C10), then user phone check (C11 — the only bar).

## Per-Task Verification Map

Claims J1–J16 (jsdom) and C1–C11 (manual) from 36-UI-SPEC.md §Validation Architecture.

| Claim | Concern | Test file / command | Type |
|-------|---------|---------------------|------|
| J1/J2 | Analyzer branch: jsdom-default = mobile; stub = today's desktop tree (test migration same plan as switch) | `Analyzer.test.tsx` | unit |
| J3 | Journal branch ditto (migration same plan as ITS switch) | `Journal.test.tsx` | unit |
| J4 | Analyzer mobile DOM order paste→cards→score→chart-row→details | `analyzer-mobile/AnalyzerMobile.test.tsx` (new) or Analyzer.test.tsx | unit |
| J5 | Candidates top-3 fold + `All candidates (N)` aria-expanded | AnalyzerMobile tests | unit |
| J6 | Rail states bare prompts (copy verbatim, no Panel classes); null candidate → no hero/chart/details nodes | AnalyzerMobile tests | unit |
| J7 | Scorecard contract (score, checklist rows, θ GATE, `— n/a`, SESSION, CALIBRATING, combined-book) | `analyzer-mobile/MobileScorecard.test.tsx` (new) | unit |
| J8 | MobileChartControls extraction byte-identical — **MobileRiskPanel.test.tsx passes with ZERO edits**; Analyzer mounts same testids off its own state | existing `MobileRiskPanel.test.tsx` + AnalyzerMobile tests | unit |
| J9 | Analyzer mobile PayoffChart props (picker colors/EM band + showBePills=false/aspectRatio=1.3); desktop call sites pass neither | unit + grep | unit/grep |
| J10 | Three `<details>` closed by default; contents mount on open; notScored → `PASTED_NOT_SCORED_NOTE` inside | AnalyzerMobile tests | unit |
| J11 | TradeCard contract (single OPEN affordance, focal P&L, un-gated select — catch #23) | `journal-mobile/TradeCard.test.tsx` (new) | unit |
| J12 | History toggle + auto-open + rule-tags pill on selected only | JournalMobile tests | unit |
| J13 | Lifecycle mount: `lifecycle-pan` overflow-x-auto + `w-[840px]` wrapper + **LifecycleChart.tsx zero diff** | JournalMobile tests + `git diff --stat` grep | unit/grep |
| J14 | Journal states + Rebuild demoted into ⋯ dialog (aria-label verbatim) + `chart-notes` details | JournalMobile tests | unit |
| J15 | Crosshair→PnlBridgeCard rail sync; Notes rule-tag blocks | JournalMobile tests | unit |
| J16 | Full suite green | `bun run test` | gate |
| C1–C10 | Layout/bleed/pan/zoom/1440px pixel-identity (incl. post-D-17 re-run) | chrome-devtools checklist | manual |
| C11 | User phone check on morai.wtf Analyzer + Journal — acceptance bar | user | manual |

## Wave 0 Requirements

| Wave 0 item | Closed by plan (spec slicing) |
|-------------|-------------------------------|
| Analyzer.test.tsx matchMedia-stub migration (J2) | #1 (same plan as Analyzer switch) |
| MobileChartControls extraction guard = untouched MobileRiskPanel.test.tsx (J8) | #1 |
| Journal.test.tsx stub migration (J3) | #3 (same plan as Journal switch) |
| New test files: AnalyzerMobile / MobileScorecard | #2 |
| New test files: TradeCard / JournalMobile | #4 |

No new framework/config — existing Vitest + jsdom + matchMedia-stub pattern covers all automatable claims.

## Security Domain

Presentation-only phase: no new input parsing (paste flow reuses existing tos-parser
path), no auth surface, zero new dependencies. STRIDE per plan; expected all low.
RebuildButton demotion MUST preserve existing confirm semantics (destructive action
stays confirm-gated — verify in J14/C6).

## Manual-Only Verifications (chrome-devtools; jsdom-blind)

- [ ] C1 Analyzer cold-start: paste+Analyze top, bare prompts, ZERO hollow shells (390×844)
- [ ] C2 no horizontal page scroll both screens at 390 AND 320 (incl. lifecycle pan present)
- [ ] C3 Analyzer chart edge-to-edge, one slim chrome row; dialogs thumb-usable; term-structure fits open disclosure
- [ ] C4 Journal lifecycle 60%-width bug GONE — 840px pan mount, labels legible, opens at latest, swipe pans, crosshair syncs P&L bridge
- [ ] C5 Journal cards: focal P&L, single OPEN affordance, History folds, selected violet
- [ ] C6 ⋯ → Rebuild → confirm stack; Cancel unwinds one layer; copy verbatim
- [ ] C7 1440px pixel-identity both screens vs pre-phase baseline (re-run after D-17)
- [ ] C8 320px: no wrap-break/clip on paste row, control row, checklist, cards
- [ ] C9 iOS profile: paste-input focus does not zoom (16px input, D-18)
- [ ] C10 resize across 1024px swaps trees both screens without crash
- [ ] C11 user phone check — the only bar
