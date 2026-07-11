---
phase: 35
slug: mobile-experience-redesign
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-11
---

# Phase 35 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 + @testing-library/react 16.3.0, jsdom (apps/web) |
| **Config** | `apps/web/vitest.config.ts` — existing, unchanged |
| **Quick run command** | `bunx vitest run apps/web/src/screens/Overview.test.tsx` (or the touched file) |
| **Full suite command** | `bun run test` (root workspace) |
| **Structural limit** | jsdom has NO layout engine: wrap/clip/scroll/order/touch-target-size claims are jsdom-blind by construction. Automatable = class/attribute presence, DOM order, dual-render branch existence, component behavior (expand, checkbox wiring). Everything layout-pixel goes through the manual chrome-devtools checklist. |

## Sampling Rate

- **Per task commit:** `bunx vitest run <changed test file>`
- **Per wave:** `bun run test` (full workspace)
- **Phase gate:** full suite + typecheck + lint green, then the manual chrome-devtools
  390px + ≥1024px checklists (35-06 aggregates; MOBILE-01/02/06 have no jsdom
  equivalent) before verify/UAT.

## Per-Task Verification Map

REQ IDs MOBILE-01..06 (RESEARCH provisional, adopted into ROADMAP + plan frontmatter).

| Requirement | Concern | Test file / command | Test Type |
|-------------|---------|---------------------|-----------|
| MOBILE-01 | First mobile screen = nav + priority KPI row + hero, no scroll needed | chrome-devtools 390px checklist (35-06) | manual |
| MOBILE-02 | No horizontal scroll/clip on any screen at <1024px; chart chrome on one rail | `document.body.scrollWidth === window.innerWidth` smoke via emulation + checklist; ChipRail class assertions `vitest run apps/web/src/components/system/ChipRail.test.tsx` (35-01) | manual + unit |
| MOBILE-03 | Ticker condensed: 4-chip priority row + 6-chip snap rail (`overflow-x-auto`, `lg:hidden` pairing); PayoffControls on ChipRail + touch size | `vitest run apps/web/src/screens/Overview.test.tsx` + `apps/web/src/components/charts/PayoffControls.test.tsx` (35-01/35-03) | unit (class/DOM assertions) |
| MOBILE-04 | MarketRail `<details>` WITHOUT hardcoded `open` (collapsed default) + `lg:` force-open CSS; Shell touch nav + 100dvh; AuthExpiredBanner inline-style safe-area paddingBottom | `vitest run apps/web/src/screens/MarketRail.test.tsx` (extend — the exact Pitfall-1 bug) + `AuthExpiredBanner.test.tsx` style assertion (35-02) | unit |
| MOBILE-05 | Positions dual-render: `hidden lg:table` table + `lg:hidden` PositionCard list; card fields, tap-expand via verdict per row, checkbox wiring, ≥44px targets | `vitest run apps/web/src/components/PositionCard.test.tsx` (new) + Overview.test.tsx branch-pairing assertions (35-04) | unit |
| MOBILE-06 | Desktop ≥1024px unchanged — 10-item tripwire checklist (PillHeader lg:sticky, MarketRail lg:-open, PayoffControls exact pre-phase classes at lg:, Analyzer display:contents/order computed styles, table render, etc.) | chrome-devtools ≥1024px/1440px spot-check per UI-SPEC tripwires (35-06) | manual |

## Wave 0 Requirements

| Wave 0 item | Closed by |
|-------------|-----------|
| `ChipRail` component + test (new) | 35-01 |
| `Button` SIZE_CLASS "touch" entry + test (extend Button.test) | 35-01 |
| `MarketRail.test.tsx` extension: `<details>` renders without `open` (currently untested — the Pitfall-1 bug) | 35-02 |
| `AuthExpiredBanner` style-object assertion (new/extend) | 35-02 |
| `PositionCard` component + test (new); `lib/position-format.ts` extraction | 35-04 |
| Overview.test.tsx: dual-render class-pairing assertions | 35-04 |

No new framework/config needed — existing Vitest + jsdom covers all automatable assertions.

## Security Domain

Presentation-only phase: no new input parsing, no auth surface, zero new dependencies
(RESEARCH audit). Each plan carries a STRIDE threat model; all rows low/none-new.

## Manual-Only Verifications (chrome-devtools emulation; jsdom-blind)

- [ ] 390px: no horizontal body scroll on Overview / Analyzer / Journal
- [ ] 390px Overview first screen: nav + 4-chip KPI row + payoff hero visible without scrolling
- [ ] 390px: ticker secondary chips on one snap rail (no 4-row wrap); chart chrome single rail
- [ ] 390px: positions render as cards; tap expands greeks/verdict; checkboxes ≥44px
- [ ] 390px: MarketRail collapsed by default, expandable; GEX rail panels stack readable
- [ ] 390px Analyzer: rail → scorecard → chart → term structure visual order; no clipped columns
- [ ] 390px Journal: list → detail stack, nothing clipped by overflow-hidden
- [ ] iOS safe-area: AuthExpiredBanner clears the home indicator (device or emulated inset)
- [ ] ≥1024px + 1440px: full UI-SPEC desktop-regression tripwire checklist (10 items) — pixel-identical
- [ ] User phone check (final): the two screenshot scenarios re-taken and compared
