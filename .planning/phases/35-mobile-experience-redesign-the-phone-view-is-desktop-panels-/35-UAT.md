---
status: passed_pending_user_phone_check
phase: 35-mobile-experience-redesign
source: [35-VERIFICATION.md, 35-06-SUMMARY.md checklists]
started: 2026-07-11T16:00:00Z
updated: 2026-07-11T16:25:00Z
---

## Tests (chrome-devtools emulation, bundle index-9sIDPLrA.js)

### 1. Mobile 390px — Overview (MOBILE-01/02/03/04/05)
result: PASSED 2026-07-11 ~16:10Z. First screen = nav + 4-chip priority row (SPX,
NET Γ, VIX, BOOK) + secondary chip snap-rail + payoff hero — "how am I doing" answered
without scrolling. document.documentElement.scrollWidth === innerWidth (no horizontal
overflow); 2 active snap rails detected. MarketRail renders as a collapsed MARKET
disclosure below the hero. Positions render as cards; tapping the verdict-less 7450P
card expands its Δ/Γ/Θ/Vega grid (CR-01 fix verified live) and highlights its curve on
the chart (same handler as desktop row-select). Chart chrome on one scrollable rail.
result_detail: agent-verified live

### 2. Mobile 390px — Analyzer + Journal (MOBILE-02)
result: PASSED. Analyzer: paste rail first, panels stacked, scrollWidth 390 == 390.
Journal: trades list → verdict hero → lifecycle charts stacked full-width — the two
panes that were clipped INVISIBLE pre-phase both render; scrollWidth 390 == 390.
result_detail: agent-verified live

### 3. Desktop ≥1024px tripwires (MOBILE-06)
result: PASSED at 1440px AFTER one live-caught blocker (catch #24, fixed bda2254 —
see Gaps). Post-fix: MarketRail column fully rendered (MARKET REGIME + COT + SYSTEM
HEALTH), 10-chip pill header on one row, positions TABLE with all 9 columns (no card
list), GEX rail + key levels + net greeks intact, chart chrome unwrapped, layout
matches pre-phase structure. WR-01 minmax(0,1fr) eyeball: center column width normal.
result_detail: agent-verified live

## Summary

total: 3 · passed: 3 · issues: 0 · pending: 1 (user phone re-take of the two
original screenshot scenarios — the phase's origin complaint)

## Gaps

**Catch #24 (live-UAT desktop blocker, fixed in-loop, bda2254):** 35-02's
`lg:[&>div]:!block` CSS could not reveal the closed `<details>` at desktop — the UA
hides closed-details content in an internal slot that child display overrides never
reach, so the ENTIRE left MarketRail column rendered empty at ≥1024px. jsdom class
assertions were structurally blind (the exact failure mode 35-RESEARCH's validation
architecture predicted for layout claims; the desktop tripwire checklist caught it
first try). Fix: new `useIsDesktop` hook (matchMedia min-width:1024px via
useSyncExternalStore, jsdom-safe) drives the real `open` attribute; uncontrolled
below lg so mobile tap-toggle still works. Regression tests stub matchMedia both ways.

**Polish nits (recorded, not blocking):** "GEX as of <ts>" freshness chip wraps to two
lines at 390px; whitespace band below the payoff chart's x-labels at mobile (panel
taller than chart content); NET Γ/1% chip label wraps 3 lines making the priority row
ragged. Candidates for a small follow-up pass if the user wants them tightened.
