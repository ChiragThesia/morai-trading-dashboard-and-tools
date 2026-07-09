# Phase 24: Regime & Breadth Board - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Source:** User-locked standing decisions (milestone kickoff) + docs/tos-studies-learnings.md + .planning/research/SUMMARY.md

<domain>
## Phase Boundary

Overview tab gains a regime/breadth board: each indicator shows current value, threshold band
(calm/warning/crisis), and as-of date. Indicators are admitted ONLY with documented online
evidence (source + threshold rationale recorded in docs, mirroring picker-rules.md
discipline). Data ships HTTP + MCP. Daily cadence, as-of stamped — EOD data never presented
as intraday. Requirements: MACRO-02, MACRO-03, BOARD-01, BOARD-02, BOARD-03.

</domain>

<decisions>
## Implementation Decisions

### Evidence discipline (USER-LOCKED)
- Every indicator needs documented online evidence BEFORE it ships — research first, cite
  sources in a docs/architecture doc (new `regime-board.md` or extension), mirroring
  picker-rules.md's per-row source/rationale format.
- Candidate set (user-named): RSP:SPY equal-weight breadth ratio, VIX9D/VIX, VVIX/VIX,
  term-structure state (VIX/VIX3M), FRED movement series. Candidates FAILING evidence or
  data-availability checks are dropped with the refutation documented — not shipped anyway.
- User's own calibrated thresholds exist in docs/tos-studies-learnings.md (battle-tested
  TOS studies): fragility composite (RSP/SPY < 20d avg; VIX/VIX3M 0.90 warn / 0.95 danger;
  VVIX 100 warn / 115 stress; close < 20d avg; HYG < 20d avg). These are the user's priors —
  online evidence must confirm or refine, and each shipped threshold cites both.

### Data constraints (hard)
- ZERO new npm dependencies. New indicators must be computable from: existing FRED adapter
  (parameterized by series id), existing CBOE adapters, existing Schwab sidecar surfaces,
  or data already in `macro_observations`/`spx_observations`/`leg_observations`/GEX tables.
  A new public HTTP endpoint fetch following the existing FRED/CBOE adapter pattern is
  acceptable ONLY if research verifies the endpoint live (status 200, stable format) —
  document the verification like STACK.md did for VXVCLS.
- VIX3M = FRED `VXVCLS` (Phase 23, accreting since 2026-07-09). VIX = FRED `VIXCLS`.
  VVIX already ingested via CBOE (Phase 14).
- Daily cadence piggybacks existing fetch-rates/macro cron where possible — avoid new jobs
  unless an indicator's source demands one.
- EOD as-of stamping: board must show observation date, never imply intraday freshness
  (MACRO-03).

### Board mechanics
- Banding: calm/warning/crisis per indicator with documented threshold rationale. Bands are
  DISPLAY guidance this phase — Phase 28 wires crisis gates into the picker (do NOT gate
  the picker here).
- Provenance: each indicator exposes its "why" (source + threshold rationale) the way the
  Analyzer scorecard exposes rule provenance (BOARD-02) — payload carries rationale/source
  fields rendered in UI, not hardcoded UI copy.
- HTTP route + MCP tool (BOARD-03, MCP-02 convention): follow existing route+tool pattern
  (e.g. get_macro / get_picker_candidates pairs).

### UI (USER-LOCKED)
- Overview tab, MetricChip visual language (existing component in
  apps/web/src/components/system/) — the board is chips/cards in Overview's existing grid
  system, not a new page.
- AH/staleness chips consistent with existing conventions (as-of date visible).

### Claude's Discretion
- Whether indicators persist to a new table vs computed-on-read from macro_observations
  history (lean computed-on-read if inputs already persist; new table only if an indicator
  needs history that isn't already accreting).
- Exact banding hysteresis (display-only this phase; hard hysteresis lands with Phase 28
  gates).
- Which FRED "movement series" (if any) survive evidence review.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Evidence + thresholds
- `docs/tos-studies-learnings.md` — user's calibrated fragility composite + regime
  thresholds (RSP/SPY, VIX/VIX3M 0.90/0.95, VVIX 100/115) — the priors to confirm online
- `docs/architecture/picker-rules.md` — the evidence-discipline format to mirror (source +
  rationale per row)

### Pipeline to extend
- `packages/core/src/journal/application/fetchMacroSeries.ts` — FRED series list (now 8 ids
  incl. VXVCLS) + VVIX task
- `packages/adapters/src/http/fred.ts` — parameterized FRED adapter
- `packages/contracts/src/macro.ts` — macro series enum (9 ids)
- `apps/worker/src/schedule.ts` — cron cadences
- `apps/server/src/adapters/mcp/tools.ts` — MCP tool registration pattern
- `apps/web/src/components/system/` — MetricChip component
- `apps/web/src/screens/Overview.tsx` — target screen (has latestMacroValue helper)

### Requirements
- `.planning/REQUIREMENTS.md` — MACRO-02, MACRO-03, BOARD-01..03

</canonical_refs>

<specifics>
## Specific Ideas

- Board payload shape idea: `{ id, label, value, band: calm|warning|crisis, asOf, source,
  rationale, inputs: {…} }[]` — Zod-parsed at adapter edge both ways.
- VIX9D/VIX: check FRED for a VIX9D series id (candidate `VIX9DCLS`) — live-verify like
  VXVCLS; if FRED lacks it, CBOE publishes index history CSVs — verify endpoint stability
  before admitting.
- RSP:SPY and HYG need equity/ETF closes — FRED does not carry ETF prices. Research MUST
  verify an existing in-system source (Schwab sidecar quote capability?) or a stable public
  endpoint before admitting these; otherwise drop with documented refutation.

</specifics>

<deferred>
## Deferred Ideas

- Crisis gates wiring into picker (VIX ≥ 25, VIX/VIX3M ≥ 0.95 blocks) → Phase 28
- Hysteresis banding enforcement → Phase 28 (display-only banding here)
- Intraday regime updates → contradicts EOD cadence, out of scope

</deferred>

---

*Phase: 24-regime-breadth-board*
*Context gathered: 2026-07-09 from user-locked milestone decisions + in-repo TOS learnings*
