# Phase 30: Analyzer Pasted-Calendar Fix - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Source:** User request with 3 annotated screenshots (2026-07-09/10) + read-only code scout (verbatim file:line map below).

<domain>
## Phase Boundary

Two user-reported defects on the Analyzer screen for PASTED calendars (user pastes a TOS
calendar order → "Analyze"):

1. **Payoff graph doesn't fit the tent.** The Risk Profile x-domain is hardcoded
   6900–7900; a pasted strike near the window edge (or drifted spot) clips the tent's
   tail and breakevens. Screenshot: 7500P pasted, apex at right edge, left tail cut.
2. **Pasted calendars bypass the engine entirely.** No factor bars
   (slope/fwdEdge/gexFit/eventAdjustment), no θ GATE chip, no entry gates, no
   WHY THIS CALENDAR analysis, no ENTRY/EXIT PLAN — all replaced by
   "Pasted calendar — not engine-scored." User wants pasting an order to produce the
   SAME entry analysis an engine-suggested candidate gets (scoring + gates + exit plan).

NOT in scope: changing how the engine scores its own chain-derived candidates; Overview
Risk Profile marker/label UX (that is Phase 31); persisting pasted calendars server-side
beyond what scoring requires.
</domain>

<decisions>
## Implementation Decisions

### USER LOCKED
- Payoff x-domain must fit the FULL tent (both tails + both breakevens) for whatever is
  displayed — pasted or engine calendar — with sensible padding. No more fixed 6900–7900.
- Pasted calendars run through REAL engine scoring and gates: score + breakdown factor
  bars + θ GATE chip + entry-gate verdict + exit plan, same as engine candidates. The
  "Pasted calendar — not engine-scored." placeholder disappears for successfully scored
  pastes.
- KISS: no speculative config; simplest correct implementation.

### Claude's Discretion (with guidance from scout)
- **Domain derivation:** compute from displayed positions (strikes, BEs, spot) with
  padding; both `PayoffChart` x-scale AND `scenario-engine` spot grid must follow (the
  data grid is also hardcoded 6900–7900 — fixing only the scale still clips curve DATA).
  PayoffChart is shared with Overview combined book — Overview must not regress; GEX
  wall edge-pinning behavior must adapt to a dynamic domain.
- **Scoring path:** no client-side path can score (needs chain cohort, GEX, events,
  macro, RV20, slope history — all server-side). Expected shape: a server endpoint
  (e.g. POST /api/picker/analyze) + core use-case that scores ONE ad-hoc calendar
  (front/back leg: strike, expiry, iv, debit) against the latest stored context, reusing
  `scoreOne`/`scoreCalendarCandidates` and the latest snapshot's gate/context rather than
  recomputing the world. Planner decides exact port/use-case shape; must respect hexagon
  (core use-case + ports, HTTP adapter thin, MCP tool in same PR per architecture rule 9).
- **Rule overrides (Phase 29):** ad-hoc scoring must resolve the same effective rule
  config (readRuleOverrides) so pasted scoring matches engine scoring.
- **Failure posture:** if scoring context is unavailable (no snapshot, stale chain), the
  UI falls back to today's un-scored display with the existing note — never a hard error.
- **Client fallback for domain:** pasted calendars with strikes far outside the SPX range
  should still render (domain follows the tent, not a hardcoded index range).

### Deferred
- Combining multiple pasted calendars into one scored portfolio view (Combine button
  exists; scoring combined books is out of scope)
- Persisting pasted calendars / journaling them
- Phase 31's marker-label collision redesign
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**
Scout (read-only, 2026-07-10) verified every path below with file:line.

### Defect 1 — hardcoded domain (BOTH must change together)
- `apps/web/src/components/charts/PayoffChart.tsx:126-127` — `X_MIN = 6900; X_MAX = 7900`
- `PayoffChart.tsx:143-145` — `buildXScale` (fixed domain); `:320` memo with empty deps (never recomputes)
- `PayoffChart.tsx:235-244/401` — `buildXTicks(X_MIN, X_MAX)`
- `PayoffChart.tsx:159-171` — `pinMarker`: GEX walls edge-pinned to X_MIN/X_MAX (24a0185) — must adapt
- `apps/web/src/lib/scenario-engine.ts:137-139` — `SPOT_GRID_MIN/MAX = 6900/7900, STEPS = 170`; `:151-157` buildSpotGrid; consumed at `:410` (payoffCurve), `:435` (expirationCurve)
- Flow: `Analyzer.tsx:585-593` combinedPositions → repriceScenario → PayoffChart `:761-780`; spot from `snapshot.spot` (`Analyzer.tsx:448`) — never used for domain today

### Defect 2 — paste path (client-only today)
- `apps/web/src/screens/Analyzer.tsx:154-164` — paste input + Analyze button; `:532-546` handlePasteAnalyze (no fetch)
- `apps/web/src/lib/tos-parser.ts:89-183` — parseTosOrder (pure client parse + local IV bisection)
- `apps/web/src/lib/parsed-calendar-to-candidate.ts:16-45` — synthetic PickerCandidate with score:0, breakdown:[], theta/vega/delta:0, events:[]
- `Analyzer.tsx:69` — PASTED_NOT_SCORED_NOTE; rendered at `:306-312` (scorecard), `:414-415` (WHY panel), `:422-423` (ENTRY/EXIT panel); isPastedId gate `:62-64`
- Factor bars: `apps/web/src/components/picker/CandidateCard.tsx:228-252` reads `candidate.breakdown` (BAR_ORDER `:35`); θ GATE chip `Analyzer.tsx:352-360` reads `candidate.theta`; CALIBRATING chip `:361-381` reads `candidate.context`

### Engine scoring path (what ad-hoc scoring must reuse)
- `packages/core/src/picker/domain/scoring.ts:308` scoreCalendarCandidates / `:115` scoreOne; ScoringParams `:86-108` (r, q, realizedVol20, slopeHistory, weights, debitBand)
- `packages/core/src/picker/application/computePickerSnapshot.ts:474-543` — ports consumed: readChainForPicker, readGexContext, readEconomicEvents, readMacroObservations, readOpenCalendars, readRecentClosedCalendars, readPickerSnapshot, readRuleOverrides (Phase 29), daily spot closes + slope history
- Ports: `packages/core/src/picker/application/ports.ts:230-303`
- Existing read-only route: `apps/server/src/adapters/http/picker.routes.ts:29-45` GET /picker/candidates (never recomputes — T-19-17; the new analyze endpoint must NOT violate that constraint for the snapshot path, it computes only the one ad-hoc calendar)
- Client hook: `apps/web/src/hooks/usePicker.ts`

### Phase 29 patterns to reuse
- `apps/server/src/adapters/http/settings.routes.ts` — newest route pattern (auth, Zod, Result mapping)
- `packages/core/src/picker/domain/rule-config.ts` — resolvePickerRuleConfig (effective config for ad-hoc scoring)
- `.claude/rules/architecture-boundaries.md` rule 9 — new use-case ⇒ HTTP route + MCP tool same PR

### Rules
- `.claude/rules/architecture-boundaries.md`, `.claude/rules/tdd.md`, `.claude/rules/typescript.md`
</canonical_refs>

<specifics>
## Specific Ideas

- Domain algorithm sketch: min/max over (all leg strikes, both BEs today/@exp, spot),
  pad ~5-8% each side, round to clean tick steps; grid steps stay ~170 but span the new
  domain. Assert: for the user's 7500P repro (strike 7500, BE@exp 7150), left BE and
  full left tail visible.
- Scoring an ad-hoc calendar must produce a candidate payload shape-compatible with
  `PickerCandidate` contract (breakdown, theta, context, exit plan fields) so
  CandidateCard/panels render with ZERO special-casing beyond removing the pasted gate.
- Keep parse client-side (tos-parser works); send parsed legs to the endpoint, not the
  raw TOS string (server stays free of TOS-format knowledge).
</specifics>

<deferred>
## Deferred Ideas

- Scoring combined/multi-calendar books
- Persisting/journaling pasted calendars
- Server-side TOS-string parsing
</deferred>

---

*Phase: 30-analyzer-pasted-calendar-fix*
*Context gathered: 2026-07-10 from user screenshots + code scout*
