---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
type: uat
status: pending-rth-measurement
---

# Phase 34 UAT — TOS-Parity Scenario Model

## Section 1: Researched deferral — smile-aware scenario IV (item 3, D-12)

**Decision: DO NOT BUILD.**

TOS's Analyze tab defaults to, and forum consensus recommends for accurate P&L,
"Individual Implied Volatility" — this mode holds each *specific option series'* own
calibrated IV fixed as spot moves; it does not re-interpolate along a smile [CITED:
thinkorswim manual + Aeromir/CapitalDiscussions forum threads, 34-RESEARCH.md Open
Question #2]. For this book's shape — a calendar spread at one strike, two expiries —
"IV fixed per specific series" is exactly what `scenario-engine.ts`'s current flat
`frontIv`/`backIv` model already does. Smile interpolation only matters for
multi-strike books (verticals, condors), which this book never is. Building a
browser-side smile interpolator here would add real complexity (a per-strike
sticky-strike-vs-sticky-moneyness interpolation, a new data path from the chain's
per-strike IVs) to match a mode TOS's own default *isn't even using* for this
instrument shape — so it would not close the gap the phase set out to close.

**Revisit trigger:** only if the RTH measurement in Section 2 shows a residual gap
that is demonstrably vol-attributable (i.e., items 1 and 2 — fractional DTE and
parity-implied carry — are confirmed live and the remaining BE-today gap cannot be
explained by time-to-settlement or carry error). Absent that evidence, this stays
closed.

## Section 2: RTH BE-today parity measurement (UAT gate)

This is a measurement, not an executor step. It runs during RTH with live marks, on
the same book CONTEXT.md's baseline was measured against, via the orchestrator/
user-driven `/gsd-verify-work 34` flow — not automated here. After-hours comparisons
are informative only (no live AH mark stream to compare against, 34-CONTEXT.md "Out of
scope").

| Book | BE-today TOS (low/high) | BE-today ours BEFORE | BE-today ours AFTER | Gap AFTER (points) |
|------|--------------------------|------------------------|------------------------|---------------------|
| 3-calendar book (CONTEXT.md baseline) | 7413.21 / 7690.62 | 7421 / 7673 | _(fill during RTH UAT)_ | _(fill during RTH UAT)_ |

BEFORE gap (recorded in 34-CONTEXT.md, pre-phase): low 8 points, high 18 points.

**Acceptance bar (user-locked, 34-CONTEXT.md "Hard requirements"):** BE-today within a
few points of TOS Analyze on the same book, measured during RTH with live marks.
