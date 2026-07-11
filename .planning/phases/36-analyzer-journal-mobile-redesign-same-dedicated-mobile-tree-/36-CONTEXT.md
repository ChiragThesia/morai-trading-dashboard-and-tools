---
phase: 36-analyzer-journal-mobile-redesign
status: locked
created: 2026-07-11
source: user directive 2026-07-11 ("Yes analyzer and journal mobile as well please go
  for it") after Phase 35.1's Overview rebuild passed the phone check
---

# Phase 36 Context — Analyzer + Journal Mobile Redesign

## Why (user-locked)

Phase 35.1 proved the recipe on Overview: dedicated mobile-only components beat
responsive reflow, and the user's phone check passed. Analyzer and Journal are still in
Phase-35 reflow state (stacked desktop panels). User ordered the same treatment.

## Ground truth — what fails at 390px today (agent screenshots 2026-07-11, live bundle
index-CXLMcvFl.js)

### Analyzer
1. **Hollow desktop panels**: with no candidate selected, RISK PROFILE / TERM STRUCTURE
   + YOUR LEGS / WHY THIS CALENDAR / ENTRY–EXIT PLAN render as four empty boxed shells
   eating the whole screen. Empty states must collapse or explain, not occupy.
2. **Desktop chart chrome at phone width**: the risk-profile panel mounts the desktop
   PayoffControls (Date rail + legend + BE pills) — the exact chrome Overview killed in
   35.1. The MobileRiskPanel pattern (slim ‹ date-pill › + ⋯ row, Projection dialog,
   full-bleed chart) already exists and should be the reference.
3. **No mobile flow**: paste input + Analyze is the top action (good) but the picker
   candidates list, scorecard, and detail panels have no phone hierarchy.

### Journal
1. **Trade rows are redundant**: each row shows an OPEN badge + "open" status text +
   an entry/exit chip — three affordances for two facts. Rows should be cards in the
   PositionCard idiom (label + status + P&L focal, tap = select).
2. **Lifecycle chart block broken at 390px**: the 4 stacked mini-charts (P&L
   attribution, vol & term structure, greeks, price vs strike) render ~60% viewport
   width with a dead right margin — a fixed-width/desktop-sized chart mount, not
   responsive. Labels illegible. Must be full-bleed width like the 35.1 chart.
3. **"Rebuild journal…" (destructive red) is the most prominent control** on the
   snapshots panel at mobile — demote it (into an overflow/confirm affordance).
4. **Footnote text wall** (attribution/gap explanations) sits mid-flow between chart
   and verdict sections — demote to a disclosure or trailing fine print.
5. What already works (keep): verdict hero (headline + NET P&L), THE EDGE / GREEKS ·
   NOW / THE BEATS / NOTES text panels stack legibly.

## Deliverable

Mobile-first (<1024px) Analyzer and Journal flows as dedicated mobile component trees
(`apps/web/src/screens/analyzer-mobile/`, `apps/web/src/screens/journal-mobile/` — or
shared `*-mobile` structure mirroring `overview-mobile/`), rendered via the existing
`useIsDesktop` switch pattern. Desktop ≥1024px render output unchanged.

Design intent (UI-SPEC owns the final contract):
- **Analyzer**: paste/Analyze stays first (it is the screen's verb); candidates as
  tappable cards; once analyzed/selected → scorecard verdict hero (grade + key numbers),
  full-bleed risk chart with the 35.1 slim-chrome pattern (reuse/adapt MobileRiskPanel
  composition or its idioms — shared logic single-sourced), term structure + why + plan
  as stacked disclosures. Empty states are one-line prompts, not hollow panels.
- **Journal**: trades as cards (open first, History disclosure kept); verdict hero
  unchanged in spirit; lifecycle charts full-bleed and legible at 390px (container
  sizing only — chart INTERNALS stay untouched); Rebuild journal demoted behind
  overflow with its existing confirm; footnotes behind a disclosure.

## Constraints (locked — inherited from 35.1, all still binding)

- Mobile-only view components allowed/expected; data/logic (hooks, engines, formatters)
  single-sourced — extract `useAnalyzerModel`/`useJournalModel` style hooks if the
  screens' inline logic needs sharing, same as `useOverviewModel`.
- Data layer untouched. Chart internals untouched (PayoffChart additive-prop surface
  from 35.1 — showBePills/aspectRatio — is available; lifecycle chart may gain
  equivalent PURE-presentational additive props with byte-identical defaults if its
  container cannot be fixed from outside).
- MORAI design system; existing primitives (Button, ChipRail, PositionCard idiom,
  Dialog, Stat, SectionLabel); zero new dependencies.
- `useIsDesktop` is the sanctioned branch mechanism; catch #24 law (real open/state
  attributes, never CSS reveals); catch #23 law (expand/select never gated on optional
  data like verdicts).
- Desktop ≥1024px: zero visual regression; desktop tests migrate to the matchMedia
  stub IN THE SAME COMMIT as each screen's switch (35.1's byte-identity-guard pattern).
- Executors: explicit `git add <paths>` only; never touch `apps/web/src/screens/
  Analyzer 2.tsx` (stray).
- UI-SPEC gate before implementation. 35-RESEARCH + 35.1-UI-SPEC patterns are valid
  inputs — no generic mobile-UX re-research; spec effort goes to THESE two screens.

## Acceptance (UAT)

- Agent pre-check at 390×844 (+320 spot, +1440 tripwires): no horizontal scroll; no
  hollow panels; Analyzer chart chrome ≤1 slim row; Journal lifecycle charts edge-to-
  edge and legible; desktop pixel-consistent.
- User phone check on morai.wtf Analyzer + Journal — the only bar.
