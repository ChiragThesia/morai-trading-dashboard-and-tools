# Exact P&L display sweep

Quick task (no PLAN.md): every human-read P&L/money value in `apps/web` now shows the
exact value, no rounding, no fixed-decimal padding.

`position-format.ts`'s `signed`/`signedUsd`/`usd` dropped their `dp` param and now go
through `exactAbs` (round at 8dp to kill float noise, trim trailing zeros/dot). New
`exactAbs` export covers sentence idioms that already supply their own +/$ literal.

Sites covered: `useJournalModel.fmtPnl`, `LifecycleMasthead`, `PnlBridgeCard`,
`LifecycleChart`'s crosshair tooltip, `PayoffChart`'s spot-readout pill + hover tooltip,
Analyzer/MobileScorecard debit+vega sentences, plus every dp-arg call site in
Overview/MobileMarketSection/MobileHero.

**Axis-tick exception:** `PayoffChart.fmtPl` stays compact (k/M, fixed 0dp) — it only
drives the chart's structural y-axis tick labels, which the design decision explicitly
carved out. Everything else human-read (chips, tables, cards, heroes, tooltips,
sentences) is exact.

Out of scope (left untouched, per site map): strike/spot/index levels, GEX $B chips,
percentages, unit-less greeks already routed through `signed()`, theta rate displays
(`toFixed(1)/d`), server/backend values.
