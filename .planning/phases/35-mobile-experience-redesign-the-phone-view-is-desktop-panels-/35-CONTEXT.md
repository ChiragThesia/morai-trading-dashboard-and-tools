---
phase: 35-mobile-experience-redesign
status: locked
created: 2026-07-11
source: user directive 2026-07-11 with mobile screenshots ("THE MOBILE view of this is
  garbage... its just all the things stacked... We need to research what is good mobile
  experience and do that")
---

# Phase 35 Context — Mobile Experience Redesign

## Why (user-locked, with screenshot evidence)

The phone view is the desktop layout naively stacked in source order. Specific failures
from the user's screenshots (~390px viewport):

1. **Ticker blob**: the 9 header pills (SPX, NET Γ, 0DTE Γ, Γ FLIP, VIX, VVIX, FED
   FUNDS, 10Y−2Y, COT LEV, BOOK) wrap into a 4-row chip cloud — unreadable, eats the
   entire first screen.
2. **Buried hero**: stack order = MarketRail first (regime gauges, rates, COT, system
   health) → the payoff chart and positions land 2-3 screens below the fold. The
   most-checked info (book P&L, positions, risk profile) is the LAST thing visible.
3. **Clipped table**: the positions table keeps its 9 desktop columns → columns crush
   ("EXPIRY / DTE" wraps 4 lines) and the greeks clip off-screen into horizontal scroll.
4. **Chart chrome wraps**: panel header chips ("GEX as of ...", "mark as of") and the
   date/toggle button row wrap awkwardly above the chart.

## Deliverable

A mobile-first (<768px) experience for all three screens (Overview, Analyzer, Journal),
grounded in researched mobile trading-app UX patterns, expressed as a UI-SPEC design
contract BEFORE implementation (this repo's UI-phase discipline), then implemented.
Desktop (≥768px) stays pixel-identical — this phase adds responsive structure, it does
not redesign desktop.

## Research mandate (user explicitly asked for research first)

What do good mobile trading/brokerage apps do (TOS mobile, Robinhood, IBKR, Tastytrade,
broker dashboards) for:
- Information hierarchy: summary-first (portfolio value + P&L on top), progressive
  disclosure (tap to expand detail), not everything-at-once.
- Dense tables on phones: card-per-row transforms, column priority, inline expand —
  never horizontal scroll for primary data.
- KPI strips: which 3-4 numbers earn the top strip; the rest behind a tap.
- Navigation: bottom tab bar vs top tabs on mobile; thumb-zone actions.
- Charts on mobile: full-bleed width, reduced chrome, touch crosshair behavior,
  landscape affordance.
- Touch targets (44px), safe areas, sticky headers.

## Constraints (locked)

- Desktop unchanged at ≥768px (Tailwind `md:` boundary already in use).
- No new heavy dependencies; Tailwind + existing shadcn primitives + existing charts.
  (Recharts is already responsive via ResponsiveContainer/aspect-ratio — reuse.)
- Data layer untouched: this is layout/presentation + at most new pure view components.
- The Phase 33/34 chart stack is fresh — chart INTERNALS stay untouched; only their
  container sizing/chrome may adapt.
- MORAI design system (tokens, Panel/PanelHeading/Button primitives, mono type,
  0.09em tracking scale) stays — this is responsive re-composition, not a re-skin.
- PWA/native app/TestFlight explicitly OUT of scope (keel decision stands: mobile
  native later via Expo consuming this API; this phase is the responsive web).
- UI-SPEC gate before implementation (ui-plan-gate) — this is a UI phase.

## Acceptance (UAT)

On a ~390px viewport (chrome-devtools emulation + user's phone):
- First screen shows: nav, a tight KPI strip (spot + book P&L + 1-2 more), and the
  payoff hero or positions summary — no scroll needed to answer "how am I doing".
- No horizontal scroll/clipping anywhere; positions readable as cards or a
  priority-column table.
- Ticker chips condensed (strip + expandable, or horizontal scroll rail — per research).
- MarketRail content accessible but demoted (collapsible/below/behind a tap).
- Desktop ≥768px visually unchanged (spot-check).
