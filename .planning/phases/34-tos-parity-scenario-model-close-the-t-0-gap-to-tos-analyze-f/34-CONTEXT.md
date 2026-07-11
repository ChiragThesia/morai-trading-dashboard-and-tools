---
phase: 34-tos-parity-scenario-model
status: locked
created: 2026-07-11
source: user directive 2026-07-10 ("I want very close data to TOS") after live TOS
  comparison; builds on the three structural parity fixes shipped post-Phase-33
  (single-horizon @exp a54de52, fill-basis anchoring 08dde9e, per-run tx window 004148f)
---

# Phase 34 Context — TOS-Parity Scenario Model

## Why (user-locked)

After the structural fixes, live comparison against TOS Analyze still shows a
BE-today gap: TOS 7413.21 / 7690.62 vs ours 7421 / 7673 (8 and 18 points) on the same
3-calendar book. @exp BEs already agree to ~0.1% (7166/7832 vs ~7160/~7860). User wants
the T+0 line to track TOS closely. The T+0 curve is near-flat (±$400 over 700 points),
so every ~$1 of valuation error ≈ 1-2 points of BE — parity requires attacking the
model-precision residuals, ranked below.

## Scope (ranked by expected impact; research validates the ranking)

1. **Fractional DTE (highest expected impact).** `pair-calendars.ts` computes whole
   calendar days; the engine prices `days/365`. TOS uses exact time to settlement. At
   night a "98d" leg is really ~97.6d; the book carries ~$32/day theta → up to ~$16
   error ≈ 10-30 BE points. Fix: exact expiry timestamps (SPX settlement: AM-settled
   monthly SPX vs PM-settled SPXW Weeklys — research must pin the convention per leg
   from the OCC symbol) → fractional DTE flowing through scenario-engine, Analyzer,
   Overview. Integer display can stay (UI shows "98d"), math goes fractional.
2. **Parity-implied carry per expiry.** Replace flat DEFAULT_RATE (0.043) /
   DEFAULT_DIV (0.013) with the forward implied by put-call parity from our OWN stored
   chain (leg_observations has both sides per strike/expiry). One implied carry number
   per expiry kills both r and q error jointly. Fallback to the flat defaults when the
   chain row is missing/stale (degrade, never throw).
3. **Smile-aware scenario IV — RESEARCHED DECISION, not pre-committed.** Today each leg
   keeps its flat calibrated IV at every shifted spot (sticky-strike, no smile). TOS
   applies its vol model. We have per-strike IVs in the chain. Research must answer:
   what does TOS's default vol mode actually do ("Volatility Smile Approximation" vs
   individual IV), what would sticky-strike vs sticky-moneyness interpolation change on
   OUR book, and is the added complexity justified after items 1+2 land — measure
   first, build only if the remaining gap is dominated by vol. If deferred, record it
   as a follow-up with the measured residual.

## Out of scope (explicit)

- PayoffChart / any presentation code — Phase 33 just landed; this is data-layer only
  (`apps/web/src/lib/scenario-engine.ts`, `pair-calendars.ts`, possibly
  `packages/quant` inputs, IV-calibration plumbing).
- Server/worker pipeline changes beyond what carry-from-chain needs for data access
  (prefer reusing data the web already receives; if a new API field is needed, it is
  additive on an existing endpoint + MCP twin per rule 9).
- The exit advisor / picker engines (their own rule configs own their math).
- After-hours mark parity — unfixable (no live AH mark stream); the UAT gate is
  explicitly an RTH measurement.

## Hard requirements

- **UAT gate is a measurement**: during RTH with live marks, BE today within a few
  points of TOS Analyze on the same book (user's acceptance bar: "very close data").
  Record the before/after gap in the UAT doc. AH comparisons are informative only.
- Every model change TDD'd against hand-computed oracles (money-path rule: build the
  oracle before touching the math — the P&L-ledger lesson).
- Byte-honest degradation: missing chain data / unparseable expiry → current behavior
  (flat defaults, integer days), never a throw, with a visible staleness cue only if
  one already exists to reuse.
- No `any`/`as`/`!`; hexagonal boundaries hold (web imports core pure functions +
  contracts only).
- Existing suites stay green; scenario-engine's public shapes stay
  backward-compatible (AnalyzerPosition gains optional fields at most).

## Open questions for research

- SPX settlement conventions: AM-settled 3rd-Friday SPX vs PM-settled SPXW; exact
  settlement/last-trade timestamps per leg derivable from the OCC symbol; what does
  TOS display/use for DTE fractions?
- TOS Analyze defaults: which vol mode, beginning-vs-end-of-day time decay for the
  "today" line, and its rate source — pin down what "parity" is actually chasing.
- Put-call parity implied carry: robust estimator from our chain snapshot (ATM
  bracket? regression across strikes? handle wide AH quotes), and where to compute it
  (web pure function over already-fetched data vs server-computed field).
- Does the engine's 365-day year vs 365.25 vs ACT/365F materially matter at 98-143d?
- Fractional-DTE plumbing: where do dteFront/dteBack get consumed besides the engine
  (sizing? DTE badges? exit advisor via server — out of scope but must not break)?
