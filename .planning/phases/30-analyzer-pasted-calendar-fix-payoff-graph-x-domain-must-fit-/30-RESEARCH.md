# Phase 30: Analyzer Pasted-Calendar Fix - Research

**Researched:** 2026-07-10
**Domain:** Internal — chart x-domain math (client) + picker engine ad-hoc scoring (hexagonal use-case + HTTP/MCP adapter)
**Confidence:** HIGH (every claim below verified by reading the actual source files this phase touches; zero external packages/docs involved)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
- Combining multiple pasted calendars into one scored portfolio view (Combine button
  exists; scoring combined books is out of scope)
- Persisting pasted calendars / journaling them
- Phase 31's marker-label collision redesign
- Server-side TOS-string parsing
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to Phase 30 in `.planning/REQUIREMENTS.md` — this is a
user-added defect-fix phase scoped entirely by `30-CONTEXT.md` (verified: REQUIREMENTS.md
v1.3 traceability table lists only MACRO/BOARD/OPS/EXIT/BT/PLAY IDs across Phases 23–28;
Phase 30 is absent, consistent with STATE.md's Roadmap Evolution entry "Phase 30 added
(2026-07-09)... user-added"). The planner should treat `30-CONTEXT.md`'s two locked
decisions as the acceptance criteria in lieu of REQ-IDs.
</phase_requirements>

## Summary

Two independent, verified defects, both internal (zero new dependencies):

**Defect 1 (domain-fit)** is a small, self-contained client-side change. `PayoffChart.tsx`
hardcodes `X_MIN=6900`/`X_MAX=7900` as module constants (not props) and consumes them in
four places: `buildXScale` (memoized with an empty dep array, so it never recomputes),
`buildXTicks`, `pinMarker` (GEX wall edge-pinning), and — **a consumer the CONTEXT.md scout
map did not list** — `handlePointerMove`'s crosshair hover math (`X_MIN + (innerX/INNER_W)*(X_MAX-X_MIN)`,
line 375). `scenario-engine.ts` independently hardcodes the same `6900`/`7900` as
`SPOT_GRID_MIN`/`SPOT_GRID_MAX` for `buildSpotGrid`, which is the actual *data* grid
`repriceScenario`'s curves are computed over — fixing only the chart scale without also
widening the data grid still produces a clipped/truncated curve. Both call sites must be
parameterized together. There are only **two real JSX consumers** of `<PayoffChart>`
(`Analyzer.tsx` and `Overview.tsx` — confirmed via `rg -n "<PayoffChart"`; `LifecycleChart.tsx`,
`CandidateCard.tsx`, `ScenarioStrip.tsx`, `TermStructureChart.tsx`, `PayoffControls.tsx` only
import sibling types, not the component) — so the regression surface is exactly Analyzer's
single selected/pasted candidate and Overview's multi-calendar combined book.

**Defect 2 (ad-hoc scoring)** requires a new hexagonal use-case in the picker bounded
context. The critical discovery: **`scoreOne` needs zero chain-cohort data.** Net
theta/vega/delta come from `bsmGreeks(spot, K, t, iv, r, q, "P")` — pure math over the
already-known leg data (strike/dte/iv). Slope is `(ivB-ivF)/(tb-tf)*365` — pure math.
Breakevens come from `findBreakevens` (BSM bisection, no chain read). The only genuinely
*external* reads scoring needs are: GEX context (`readGexContext`), economic events
(`readEconomicEvents`), RV20 closes (`readDailySpotCloses`), slope history
(`readPickerSlopeHistory`), and rule overrides (`readRuleOverrides`) — all cheap,
single-row/bounded reads, none of which re-run `selectCandidates`'s O(chain²) band scan.
The entry gate and sizing verdict should be **reused verbatim** from the latest persisted
`PickerSnapshotRow` (never recomputed — recomputing the gate needs macro/open-calendars/
recent-closed reads that exist only to feed the *cohort-level*, once-per-cycle gate,
which T-28-10 explicitly forbids computing per-candidate).

Two real gaps the CONTEXT.md scout map did not flag, both load-bearing for planning:

1. `tos-parser.ts`'s `impliedFlatIv` solves ONE flat IV for both legs (Rule 8) — so a
   pasted calendar's `slope` criterion will almost always score `0` (`ivB === ivF`).
   This is a pre-existing parser limitation, not something this phase should silently
   "fix" by adding chain lookups (out of scope per CONTEXT.md's "no client-side path can
   score... needs chain cohort").
2. `RawCandidateLeg.putCall` in `packages/core/src/picker/domain/types.ts` is typed as the
   literal `"P"` only ("puts only in scope this milestone") — but `tos-parser.ts` parses
   BOTH calls and puts (Rule 9). A pasted CALL calendar cannot be scored through the
   existing `RawCandidate`/`scoreOne` pipeline without widening that type. Recommend
   scoping ad-hoc engine-scoring to PUT calendars only (matching the engine's own existing
   universe scope) and keeping today's "not engine-scored" fallback for pasted calls —
   this is the KISS-compliant answer per the locked decision, but it is a real scope call
   the planner/discuss step should confirm, since CONTEXT.md's decisions did not
   anticipate it.

**Primary recommendation:** Parameterize `buildXScale`/`buildSpotGrid`/`pinMarker`/
crosshair math with an explicit `{min, max}` domain computed by a new pure function from
leg strikes + spot + real breakevens (found via the existing `findZeroCrossings` two-pass
pattern, not a hand-rolled analytic solver); add `makeAnalyzeAdHocCalendarUseCase` in
`packages/core/src/picker/application/` that builds one `RawCandidate` from the parsed
legs and calls the existing `scoreCalendarCandidates`/`resolvePickerRuleConfig` verbatim,
reusing the latest snapshot's gate/sizing; wire `POST /api/picker/analyze` (HTTP,
zValidator) + an `analyze_ad_hoc_calendar` MCP tool in the same PR per architecture rule 9.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Payoff x-domain computation (strikes/BEs/spot → min/max) | Browser/Client | — | Pure math over already-fetched client state (`scenario-engine.ts`); no server round-trip needed, matches existing `repriceScenario`/`buildScenarioStrip` client-side-compute precedent |
| Payoff chart x-scale/ticks/wall-pinning/crosshair | Browser/Client | — | `PayoffChart.tsx` is a pure-render visx component; already receives all levels as props |
| Ad-hoc calendar scoring (score + breakdown + exit plan) | API/Backend | — | Requires GEX/events/RV20/slope-history/rule-overrides reads that only exist server-side (hexagon: `packages/core` picker bounded context) |
| Rule-config resolution for ad-hoc scoring (Phase 29 parity) | API/Backend | — | `resolvePickerRuleConfig` + `readRuleOverrides` already live in `packages/core`/`packages/adapters`; ad-hoc use-case is a new caller, not new infra |
| Entry-gate/sizing verdict for the ad-hoc candidate | API/Backend | — | Reused verbatim from the latest persisted `PickerSnapshotRow.gate`/`.sizing` — never recomputed (T-28-10: gate is cohort-level, never per-candidate) |
| TOS-order text parsing + flat-IV bisection | Browser/Client | — | Existing `tos-parser.ts`/`iv-bisection.ts`; CONTEXT.md explicitly keeps parsing client-side ("server stays free of TOS-format knowledge") |
| Rendering the scored pasted card (score, bars, θ chip, exit plan) | Browser/Client | — | `CandidateCard.tsx`/`ScoringMethodologyPanel`/`RightColumn` already render this exact shape for engine candidates; pasted candidates need the same `PickerCandidate` contract shape, not new components |

## Project Constraints (from CLAUDE.md)

- Dependencies point inward: `packages/core` may import only `packages/shared` + sibling
  domain/application modules within its own bounded context, plus other bounded contexts'
  `application/ports.ts` (never their `domain/`) — the new ad-hoc use-case must follow the
  same cross-context-via-ports pattern `computePickerSnapshot.ts` already uses for
  `journal`'s `ForGettingOpenCalendars`/`ForReadingMacroObservations` and `settings`'s
  `ForReadingRuleOverrides`.
- TDD red→green: every new pure function (domain-fit algorithm, the new use-case) needs a
  failing test first; numerical code (the domain-fit padding math, the ad-hoc RawCandidate
  builder) needs fast-check property tests per `tdd.md`'s "Numerical code" rule.
- No `any`, no `as`, no `!`: the new HTTP route must Zod-parse the request body
  (`zValidator("json", ...)`, matching `settings.routes.ts`'s precedent exactly); the MCP
  tool input schema must mirror the same Zod schema (MCP-02 convention: one schema, two
  adapters).
- Docs before architecture changes: this phase does not introduce a new table, job, or
  swapped tech — no `docs/architecture/stack-decisions.md` update needed. It DOES add a
  new HTTP route + MCP tool, which is normal adapter-surface growth (architecture rule 9),
  not an architecture change.
- Architecture rule 9 ("new use-case ⇒ HTTP route + MCP tool in the same PR"): the plan
  MUST include both `apps/server/src/adapters/http/picker.routes.ts` (a new `POST
  /picker/analyze` handler) and the MCP router (`apps/server/src/adapters/mcp/server.ts`)
  in the same plan/PR, mirroring the `get_picker_candidates` precedent at
  `main.ts:295-301` and `main.ts:516-531`.
- Architecture rule 8 ("ship the in-memory twin"): if any new driven port is introduced,
  `packages/adapters/memory/` needs the twin in the same PR — but see Don't Hand-Roll
  below: this phase should need ZERO new driven ports (every read it needs already has a
  port + Postgres repo + in-memory twin from Phase 19/28/29).

## Standard Stack

### Core (existing internal modules to reuse verbatim — zero new packages)

| Module | Path | Purpose | Why Standard |
|--------|------|---------|--------------|
| `scoreCalendarCandidates` / `scoreOne` | `packages/core/src/picker/domain/scoring.ts` | Scores a `RawCandidate` into a `ScoredCandidate` (score, breakdown, exitPlan) | The ONE scoring engine — reusing it is the whole point of the locked decision ("same as engine candidates") [VERIFIED: packages/core/src/picker/domain/scoring.ts] |
| `resolvePickerRuleConfig` | `packages/core/src/picker/domain/rule-config.ts` | Merges Phase 29 runtime overrides over code defaults into weights/bands | Required for scoring parity between pasted and engine candidates (CONTEXT.md locked) [VERIFIED: packages/core/src/picker/domain/rule-config.ts] |
| `findBreakevens` | `packages/core/src/picker/domain/breakevens.ts` | BSM-bisection breakevens, no chain dependency | Already the scoring engine's own breakeven source (`beVsEm` criterion) — same function the domain-fit x-domain algorithm should reuse client-side (via a parallel client bisection) or server-side (already wired into scoring) [VERIFIED: imported at scoring.ts:20] |
| `legSpansEvents` (exported) | `packages/core/src/picker/domain/candidate-selection.ts:159-165` | Pure ISO-interval membership test for `frontEvents`/`backEvents` | Already exported and pure — reuse directly, don't re-derive event-span logic [VERIFIED: candidate-selection.ts] |
| `bsmGreeks` / `bsmPrice` | `@morai/quant` | BSM pricing/greeks, no I/O | Same kernel `scenario-engine.ts` (client) and `candidate-selection.ts`/`scoring.ts` (server) already use — one source of truth (D-01 precedent) [VERIFIED: @morai/quant import sites] |
| `findZeroCrossings` | `apps/web/src/components/charts/PayoffChart.tsx:178-196` (already exported: `computeYDomain`, `buildXTicks`, `buildXScale`, `INNER_W`) | Zero-crossing detection over a computed payoff curve | The x-domain-fit algorithm's breakeven input should call this over a first-pass wide curve rather than invent a second breakeven solver client-side [VERIFIED: PayoffChart.tsx] |

No `npm install` — this phase adds zero third-party packages. Verification command not
applicable (internal-only change).

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All work is new internal
modules (a use-case, an HTTP route, an MCP tool, a domain-fit function) built from
existing first-party code (`@morai/core`, `@morai/quant`, `@morai/contracts`,
`@morai/shared`) already present in the monorepo. No `npm view`/`pip index`/`cargo search`
verification is needed.

**Packages removed due to [SLOP] verdict:** none (N/A — no packages proposed)
**Packages flagged as suspicious [SUS]:** none (N/A — no packages proposed)

## Architecture Patterns

### System Architecture Diagram — ad-hoc scoring request flow

```
Browser (Analyzer.tsx)
  │
  │ 1. User pastes TOS order text
  ▼
tos-parser.ts: parseTosOrder(text, today, spot, rate)
  │  (pure client parse + iv-bisection.ts flat-IV solve — UNCHANGED, stays client-side)
  ▼
ParsedCalendar { strike, type, frontDte, backDte, debit, iv, qty, frontExpiryIso?, backExpiryIso? }
  │
  │ 2. handlePasteAnalyze — NEW: fire POST /api/picker/analyze
  ▼                                  (instead of today's synchronous
  │                                   parsedCalendarToPickerCandidate)
apps/server HTTP route: POST /picker/analyze  (Zod-validated body)
  │  Pattern: Zod-parse → call use-case → map Result → parse through contract → respond
  ▼
makeAnalyzeAdHocCalendarUseCase (packages/core/picker/application/)
  │
  ├─► readPickerSnapshot()        → latest snapshot: gate, sizing, staleness bound
  ├─► readGexContext()            → GexContextForPicker | null  (gexFit criterion)
  ├─► readEconomicEvents()        → EconomicEvent[]             (frontEvents/backEvents/exitBeforeIso)
  ├─► readDailySpotCloses(21)     → realizedVol20                (vrp criterion)
  ├─► readPickerSlopeHistory(60)  → slopeHistory                 (context, display-only)
  ├─► readRuleOverrides()         → picker override group → resolvePickerRuleConfig()
  │
  ▼  build ONE RawCandidate from the request legs (bsmGreeks for theta/vega/delta,
  │  legSpansEvents + event-blackout helper for frontEvents/backEvents/exitBeforeIso)
  ▼
scoreCalendarCandidates([rawCandidate], gexContext, { weights, debitBand, realizedVol20, slopeHistory })
  │
  ▼  apply gate.penaltyMultiplier from the latest snapshot (parity with engine scoring)
  ▼
toPickerCandidateDomain(scored, "standard")  →  PickerCandidate (contracts shape)
  │
  ▼ 3. Response: { candidate: PickerCandidate }
Browser: setPastedCandidates([...prev, candidate])
  │  candidate now has real score/breakdown/context/exitPlan — CandidateCard/
  │  ScoringMethodologyPanel/RightColumn render it with ZERO special-casing beyond
  │  checking candidate.breakdown.length > 0 (not `isPastedId`) for the "not scored" note
  ▼
Same existing payoff path: candidateToAnalyzerPosition → repriceScenario → PayoffChart
```

### Recommended Project Structure

```
packages/core/src/picker/
├── application/
│   ├── analyzeAdHocCalendar.ts        # NEW — makeAnalyzeAdHocCalendarUseCase
│   └── ports.ts                       # UNCHANGED — every port this use-case needs already exists
├── domain/
│   ├── candidate-selection.ts         # extract exitBeforeIso/eventInPeakTheta into an exported
│   │                                  # helper (see Don't Hand-Roll) so both selectCandidates and
│   │                                  # the ad-hoc use-case call ONE event-blackout function
│   └── scoring.ts                     # UNCHANGED — scoreOne/scoreCalendarCandidates reused verbatim

apps/server/src/adapters/
├── http/picker.routes.ts              # add POST /picker/analyze handler
└── mcp/server.ts                      # add analyze_ad_hoc_calendar tool (same schema)

packages/contracts/src/picker.ts       # add analyzeAdHocCalendarRequest / *Response (additive)

apps/web/src/
├── lib/
│   ├── tos-parser.ts                  # extend ParsedCalendar with frontExpiry/backExpiry ISO
│   │                                  # dates (needed server-side for exitPlan/event-span logic)
│   ├── parsed-calendar-to-candidate.ts # becomes the FALLBACK builder only (score:0 path)
│   └── payoff-domain.ts               # NEW — computePayoffDomain(positions, spot) pure fn
├── hooks/
│   └── useAnalyzeCalendar.ts          # NEW — POST /api/picker/analyze mutation (mirrors useRepullChains shape)
├── components/charts/PayoffChart.tsx  # X_MIN/X_MAX → props; buildXScale/pinMarker/crosshair take domain
├── screens/Analyzer.tsx               # handlePasteAnalyze calls the new hook; isPastedId checks
│                                      # replaced with candidate.breakdown.length === 0 where the
│                                      # "not scored" note is gated
└── screens/Overview.tsx               # passes computePayoffDomain(calendarPositions, spot) to
                                       # PayoffChart — must not regress (see Common Pitfalls)
```

### Pattern 1: Two-pass domain-fit (avoid a hand-rolled analytic breakeven solver client-side)

**What:** Compute the payoff curve TWICE: once over a generously wide, cheap-to-compute
domain (e.g. strike ± a large multiple, or ± several expected-moves) to find real
breakevens via the already-existing `findZeroCrossings`, then recompute the final curve
over the TIGHT domain (`min(strikes, BEs, spot) - pad` .. `max(...) + pad`) at the same
resolution (`SPOT_GRID_STEPS`) for a smooth final render.

**When to use:** Both `Analyzer.tsx` (single selected/pasted candidate) and `Overview.tsx`
(multi-calendar combined book) need this — the domain-fit function must accept a list of
`AnalyzerPosition` (not a single candidate), since Overview's book can span several
different strikes/expiries simultaneously.

**Example (illustrative shape, not literal code to copy verbatim):**
```typescript
// apps/web/src/lib/payoff-domain.ts (NEW)
export function computePayoffDomain(
  positions: ReadonlyArray<AnalyzerPosition>,
  spot: number,
  params: ScenarioParams,
): { min: number; max: number } {
  if (positions.length === 0) return { min: spot - 500, max: spot + 500 }; // safe fallback
  const strikes = positions.map(extractStrikeForDomain); // needs a strike accessor
  // Pass 1: wide grid to find real BEs via the curve (reuses findZeroCrossings)
  const wide = repriceScenario(positions, { ...params, /* wide grid override */ });
  const bes = [...findZeroCrossings(wide.payoffCurve), ...findZeroCrossings(wide.expirationCurve)];
  const anchors = [...strikes, spot, ...bes];
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  const pad = (hi - lo) * 0.08; // sensible padding (CONTEXT.md's own sketch: "pad ~5-8%")
  return { min: lo - pad, max: hi + pad };
}
```
Source: derived from the existing `findZeroCrossings` (PayoffChart.tsx:178-196) and
`buildScenarioStrip`'s existing strike-extraction precedent (scenario-engine.ts:541-586) —
[VERIFIED: apps/web/src/components/charts/PayoffChart.tsx, apps/web/src/lib/scenario-engine.ts].

### Pattern 2: Ad-hoc use-case reuses the scoring engine, never a second scoring path

**What:** `makeAnalyzeAdHocCalendarUseCase` builds exactly one `RawCandidate` (mirroring
the shape `selectCandidates` already produces per iteration) and hands it to the SAME
`scoreCalendarCandidates` the cron job calls. No new scoring formula, no new weight table.

**When to use:** Any time the phase's own scored output must match engine-scored output
byte-for-byte for the same inputs (a hard requirement per CONTEXT.md's locked decision).

**Example:**
```typescript
// Source: packages/core/src/picker/domain/candidate-selection.ts:395-411 (existing per-candidate
// RawCandidate construction the new use-case should mirror for a SINGLE pasted candidate)
candidates.push({
  id: `${deltaLabel}-${K}-${fe}-${be}`,
  name: `${K}P ${fe} / ${be}`,
  frontLeg: { strike: K, putCall: "P", expiration: fe, dte: tf, iv: ivF },
  backLeg: { strike: K, putCall: "P", expiration: be, dte: tb, iv: ivB },
  deltaRung: deltaLabel,
  spot, theta, vega, delta: netDelta, debit, slope,
  frontEvents, backEvents, exitBeforeIso, eventInPeakTheta,
});
```

### Anti-Patterns to Avoid

- **Recomputing the entry gate per ad-hoc request:** T-28-10 exists specifically because
  an earlier retired gate design computed a gate PER CANDIDATE. The gate is cohort-level
  (`resolveEntryGate` reads macro + open-calendars + recent-closed once per compute-picker
  cycle). The ad-hoc use-case must read the ALREADY-COMPUTED `gate`/`sizing` off the latest
  `PickerSnapshotRow`, never call `resolveEntryGate` itself.
- **Reading the full chain cohort for a pasted calendar:** `readChainForPicker()` returns
  the entire chain (all strikes × all expiries) for the band-scan universe builder. The
  pasted calendar's legs are already fully specified (strike/expiry/iv/debit from the
  client parse) — there is no chain-scan step to run. Calling `readChainForPicker` here
  would be needlessly expensive and is not needed by any downstream field.
- **A second scoring formula for "ad-hoc mode":** every score/breakdown field must come
  from the existing `scoreOne` internals unmodified — do not special-case pasted-candidate
  scoring inside `scoring.ts` (matches the file's own precedent: `scoreEventCandidates`
  reuses `scoreCalendarCandidates`'s weights-ablation seam rather than writing new formula
  code).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding breakevens for the payoff domain | A new analytic/bisection BE solver in `payoff-domain.ts` | `findZeroCrossings` (already in `PayoffChart.tsx`, already tested) over a first-pass wide curve | One breakeven-detection mechanism, not two; avoids a second numerical-edge-case surface to test |
| Event-blackout / peak-theta window for the ad-hoc candidate's `exitBeforeIso`/`eventInPeakTheta` | A duplicate copy of the inline loop at `candidate-selection.ts:330-343` | Extract that loop into an exported pure function (e.g. `resolveEventExit(feDay, events)`) and call it from both `selectCandidates` and the new use-case | The codebase's own stated principle (`scoreEventCandidates` docstring: "never a second scoring engine") — this is the same discipline applied one layer down |
| Ad-hoc score/breakdown/exitPlan shape | A parallel lightweight scoring function "good enough for a paste" | `scoreCalendarCandidates` unmodified | Locked decision requires byte-parity with engine scoring; any second formula WILL drift |
| Gate/sizing verdict for the pasted candidate | Recomputing `resolveEntryGate`/`resolveSizingTier` per ad-hoc request | Read `PickerSnapshotRow.snapshot.gate` / `.sizing` verbatim | T-28-10 regression guard — gate must be cohort-level, never per-candidate |

**Key insight:** every piece this phase needs — scoring, gate, sizing, breakeven-finding,
event-span membership, BSM greeks — already exists as a pure, already-tested function
somewhere in this codebase. The entire ad-hoc-scoring task is wiring, not new math.

## Common Pitfalls

### Pitfall 1: Fixing the chart scale without fixing the data grid

**What goes wrong:** `PayoffChart.tsx`'s `X_MIN`/`X_MAX` control the visible axis, but
`scenario-engine.ts`'s `SPOT_GRID_MIN`/`SPOT_GRID_MAX` control what spot values the curve
is actually COMPUTED at. If only the chart's scale is widened, the curve still has no data
points beyond the old 6900–7900 range — the tent visually clips at the same place, just now
with empty axis space around it instead of a chart-edge crop.
**Why it happens:** the two constants live in different files and were introduced
independently (`PayoffChart.tsx` for rendering, `scenario-engine.ts` for the client-side
BSM re-pricing kernel).
**How to avoid:** thread the SAME computed `{min, max}` domain into both `buildSpotGrid`
(scenario-engine) and `buildXScale`/`buildXTicks`/`pinMarker` (PayoffChart) from a single
call site per screen.
**Warning signs:** a "fit domain" fix that only touches `PayoffChart.tsx` files.

### Pitfall 2: Missing the crosshair hover math consumer

**What goes wrong:** `PayoffChart.tsx:375`'s `handlePointerMove` computes
`hoveredSpot = X_MIN + (innerX/INNER_W) * (X_MAX-X_MIN)` — a FOURTH consumer of the module
constants that the CONTEXT.md scout map did not list (it named `buildXScale`,
`buildXTicks`, and `pinMarker` only). If domain becomes a prop but this line still reads
the old module constants, the crosshair tooltip will report the wrong hovered spot/PL the
moment the domain differs from 6900–7900.
**Why it happens:** the crosshair math is a closure over the module-level constants rather
than routing through the `xScale`/`buildXScale` the rest of the chart uses.
**How to avoid:** invert through the SAME `xScale` (visx `scaleLinear` has an `.invert()`)
instead of manually reimplementing the linear interpolation with the old constants.
**Warning signs:** any grep for `X_MIN`/`X_MAX` in `PayoffChart.tsx` returning fewer than
4 call sites after the change.

### Pitfall 3: Existing tests assert the literal 6900–7900 domain

**What goes wrong:** `PayoffChart.test.tsx:313` asserts
`buildXTicks(6900, 7900)` (fine — `buildXTicks` already takes explicit params, this test
survives unchanged) but the pinMarker tests at lines 527/545 and the `buildXScale(INNER_W)`
call at line 237 assume the OLD module-constant-baked domain — once `buildXScale` takes an
explicit domain param, those call sites must pass one explicitly or the tests will silently
compile against a changed default and mask a real regression.
**Why it happens:** the current `buildXScale(innerWidth)` signature has domain baked in as
a closure over module constants, not a parameter.
**How to avoid:** widen `buildXScale`'s signature to `buildXScale(innerWidth, domain: {min,max})`
and update every test call site explicitly (never rely on a default that quietly
reproduces 6900–7900).
**Warning signs:** green tests immediately after the change with zero test-file diffs in
`PayoffChart.test.tsx` — that means the tests are still exercising the old hardcoded path.

### Pitfall 4: Overview's multi-calendar combined book needs domain across ALL positions, not one candidate

**What goes wrong:** `Overview.tsx`'s `<PayoffChart>` renders `scenario.payoffCurve` built
from `calendarPositions` — potentially several DIFFERENT calendars at different strikes
simultaneously (the live broker book). A domain-fit function written only against "the
selected candidate's two legs" (Analyzer's mental model) will clip Overview's combined book
whenever it holds calendars at widely different strikes.
**Why it happens:** the phase's own repro screenshot and CONTEXT.md's algorithm sketch is
framed around a single pasted candidate.
**How to avoid:** design `computePayoffDomain` to take `ReadonlyArray<AnalyzerPosition>`
(N positions) from the start, verified against both call sites (Analyzer: 1 candidate +
optional combined extras; Overview: the full live book).
**Warning signs:** a domain-fit function whose signature only accepts a single
strike/BE pair.

### Pitfall 5: `RawCandidateLeg.putCall` is typed `"P"` only

**What goes wrong:** `packages/core/src/picker/domain/types.ts`'s `RawCandidateLeg.putCall`
is the literal type `"P"` (not `"C" | "P"`), documented "puts only in scope this
milestone." `tos-parser.ts` parses BOTH call and put orders (Rule 9). Attempting to build a
`RawCandidate` from a pasted CALL calendar will fail to typecheck against the existing
domain type without a deliberate widening decision.
**Why it happens:** the engine's own candidate universe (`selectCandidates`) has only ever
emitted puts; the type was narrowed to match, not designed for a future call-scoring path.
**How to avoid:** scope ad-hoc engine-scoring to PUT calendars only this phase (matches
existing engine scope exactly); pasted CALL calendars keep today's "not engine-scored"
fallback. Confirm this scope call explicitly with the user/discuss step — CONTEXT.md's
locked decisions did not anticipate this constraint.
**Warning signs:** a plan that widens `RawCandidateLeg.putCall` to `"C"|"P"` without an
explicit user decision to do so (this is more than KISS "simplest correct implementation"
— it touches a core domain type used by the live engine).

### Pitfall 6: `impliedFlatIv` means pasted-calendar `slope` will usually score 0

**What goes wrong:** `tos-parser.ts` solves ONE flat IV such that
`BSM(back,iv) − BSM(front,iv) ≈ debit` (Rule 8) — the SAME iv value is used for both
`frontLeg.iv` and `backLeg.iv`. `scoring.ts`'s `slope` criterion is
`(ivB - ivF) / (tb - tf) * 365`, which evaluates to exactly `0` whenever `ivB === ivF`.
This is not a bug in the new scoring wiring — it's an existing parser limitation that
becomes newly visible once pasted calendars are actually scored.
**Why it happens:** `impliedFlatIv` has no way to disambiguate front vs. back leg
volatility from a single observed net debit (an under-determined system — one equation,
two unknowns).
**How to avoid:** accept this as a documented, known limitation for this phase (flag it in
the plan's own docs/comments) rather than silently shipping a "scored" pasted calendar
whose slope factor bar always reads near-zero without explanation. Do NOT attempt to fix
by adding a live-chain IV lookup for the pasted strikes — CONTEXT.md explicitly scoped that
out ("no client-side path can score... needs chain cohort").
**Warning signs:** UAT surprise that every pasted calendar's slope bar is empty/zero
regardless of the actual TOS order pasted.

### Pitfall 7: `ParsedCalendar` has no ISO expiration dates, only DTE integers

**What goes wrong:** `frontLeg.expiration`/`backLeg.expiration` (ISO `YYYY-MM-DD`) are
required by `RawCandidateLeg`, consumed by `exitPlan.closeByExpiry` (defaults to
`frontLeg.expiration`) and by the event-blackout/`legSpansEvents` logic
(`candidate-selection.ts`). `ParsedCalendar` (`tos-parser.ts`) only exposes `frontDte`/
`backDte` as day-count integers — the actual parsed `DD MMM YY` dates are computed
internally (`rawDates`/`frontMs`/`backMs`) and then DISCARDED before the function returns.
**Why it happens:** `parsedCalendarToPickerCandidate`'s existing fallback path never needed
real dates (`closeByExpiry: ""` is fine for an unscored candidate).
**How to avoid:** extend `ParsedCalendar` to also return `frontExpiry`/`backExpiry` as ISO
date strings (trivial — the values already exist as `frontMs`/`backMs` before being
converted to day-counts) rather than reconstructing them server-side from `asOf + dte`
(which risks a business-day/calendar-day mismatch class bug — same bug family as the
CBOE-UTC and economic-event-timezone lessons already documented in STATE.md).
**Warning signs:** a server-side "reconstruct the expiry date from dte" helper appearing
in the new use-case instead of a `tos-parser.ts` type/return-value change.

### Pitfall 8: `CandidateCard`'s `pasted` prop hardcodes the unscored subline/header regardless of whether scoring succeeded

**What goes wrong:** `CandidateCard.tsx` branches on the boolean `pasted` prop alone —
when `pasted` is true it ALWAYS shows the "PASTED" pill instead of the numeric score, and
ALWAYS omits theta/vega/event-tags/staleness from the subline (lines 161-183, 195-226),
regardless of whether `candidate.breakdown` is actually populated. The breakdown BARS below
(lines 228-252) DO already render from `candidate.breakdown` unconditionally — so after
this phase ships, a successfully-scored pasted card would show real factor bars but STILL
show the "PASTED" pill instead of its score and STILL omit theta/vega in the subline. This
is a real gap the CONTEXT.md file:line scout list did not flag (it cited only lines
228-252 for factor bars).
**Why it happens:** `CandidateCard`'s `pasted` prop was designed when pasted meant
"definitely unscored" (Phase 18/19 era) — that assumption breaks once pasted can also mean
"scored".
**How to avoid:** the planner must decide (and likely needs a UI-SPEC note) whether to (a)
keep the "PASTED" identification badge but ALSO show the real score/subline once
`candidate.breakdown.length > 0`, or (b) drop the PASTED pill entirely for scored pastes.
CONTEXT.md's locked decision ("same as engine candidates") leans toward (a) with the badge
retained for provenance, but this is not spelled out in the user's own scout map and needs
explicit planning, not an assumption baked silently into the diff.
**Warning signs:** a plan that only touches `Analyzer.tsx`'s `isPastedId` checks
(lines 306, 409, 414, 422 per the CONTEXT scout map) without touching
`CandidateCard.tsx`'s `pasted &&` branches.

## Code Examples

### Existing per-candidate RawCandidate construction (mirror this shape, don't reinvent it)

```typescript
// Source: packages/core/src/picker/domain/candidate-selection.ts:370-411
const gF = bsmGreeks(spot, K, tf / 365, ivF, r, q, "P");
const gB = bsmGreeks(spot, K, tb / 365, ivB, r, q, "P");
const theta = (gB.theta - gF.theta) * 100;
// ... net-theta gate, then:
const vega = (gB.vega - gF.vega) * 100;
const netDelta = (gB.delta - gF.delta) * 100;
const slope = ((ivB - ivF) / (tb - tf)) * 365;
const frontEvents = legSpansEvents(fe, asOfIso, events);
const backEventsAll = legSpansEvents(be, asOfIso, events);
const backEvents = backEventsAll.filter((name) => !frontEvents.includes(name));
```

### Existing HTTP-route thin-adapter pattern to follow

```typescript
// Source: apps/server/src/adapters/http/settings.routes.ts (Phase 29 precedent)
router.put("/settings/rules", zValidator("json", setRuleOverridesRequest), async (c) => {
  const body = c.req.valid("json");
  const result = await setRuleOverrides(toOverridesPatch(body));
  if (!result.ok) {
    return c.json({ error: "internal" }, 500);
  }
  return c.json(setRuleOverridesResponse.parse(result.value));
});
```

### Existing snapshot-reuse-not-recompute pattern (T-19-17 precedent, apply the SAME discipline)

```typescript
// Source: apps/server/src/adapters/http/picker.routes.ts:29-45
router.get("/picker/candidates", async (c) => {
  const result = await getPicker();
  // ...never a recompute call here — the latest row is the sole source of truth.
});
```
Note: the NEW `POST /picker/analyze` endpoint is intentionally a different kind of
operation — it computes ONE ad-hoc candidate synchronously per request (cheap: a handful
of single-row/bounded reads + pure BSM math, no chain scan). This does not violate
T-19-17's intent (never recompute the SNAPSHOT on read); it should be documented as such in
the new route's own comment so a future reader doesn't conflate the two.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Term-structure `slope` scored as an inversion PENALTY | `slopeEntryFraction` — front-richness IS the entry edge (ORATS/SteadyOptions), 2026-07-09 user lock | 2026-07-09 | `slope`/`fwdEdge` weighting in `rules.ts` already reflects this — the ad-hoc use-case inherits it automatically via `resolvePickerRuleConfig`, no separate action needed |
| Term-inversion HARD GATE (drop candidate) | RETIRED — mild front-richness scored, only true stress inversions (`slope < -1.5`) zeroed | 2026-07-09 | Same — inherited automatically, no ad-hoc-specific work |
| Tier-1 event within blackout window = entry BLOCK | Stamps `exitBeforeIso` (forced pre-event exit) instead of blocking entry | 2026-07-09 | The ad-hoc use-case must replicate this event-blackout → `exitBeforeIso` logic (see Don't Hand-Roll: extract into a shared helper), not the old block-on-event behavior |

**Deprecated/outdated:** none relevant beyond the two above — this is a young, actively-
maintained internal engine (Phase 19 built 2026-07-04, still receiving rule changes as
late as Phase 29, 2026-07-10).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Padding for the x-domain fit should be ~5-8% of the strike/spot/BE range (per CONTEXT.md's own "Specific Ideas" sketch, not a locked decision) | Pattern 1 / domain-fit algorithm | Too little padding re-clips extreme repro cases (spot far from strikes); too much padding wastes chart real estate on thin single-strike candidates. Low risk — easily tuned post-hoc since it's a pure display constant, not a data-shape decision. |
| A2 | Ad-hoc engine-scoring should be scoped to PUT calendars only this phase (matching `RawCandidateLeg.putCall`'s existing `"P"`-only type) | Pitfall 5 | If the user actually wants call calendars scored too, this under-delivers the locked decision ("same as engine candidates") for that subset — needs explicit confirmation, not a silent scope-narrowing. |
| A3 | The gate's `penaltyMultiplier` should be applied to the ad-hoc candidate's score for full engine-scoring parity, even though CONTEXT.md's locked decision text only explicitly calls out rule-weight parity | Architecture Patterns / Pattern 2 | If the planner omits this, an ad-hoc candidate pasted during a VIX-penalty regime would score HIGHER than an identical engine candidate computed in the same cycle — a parity break the user would likely notice and consider a bug. |
| A4 | `CandidateCard.tsx`'s `pasted &&` branches (header pill + subline) should be updated to show real score/theta/vega once `candidate.breakdown.length > 0`, keeping only the "PASTED" identification badge | Pitfall 8 | If left as-is, the locked decision ("same as engine candidates") is only half-delivered — factor bars and panels update but the card header/subline still visually reads as unscored. |

## Open Questions

1. **Should a pasted calendar still render a score when the market-level entry gate is
   BLOCKED (crisis VIX) or braked (max-open/cooldown)?**
   - What we know: engine candidates simply vanish from the rail when
     `entriesAllowed === false` (`computePickerSnapshot.ts` Step 6: `candidates: []`).
     There is no existing per-card "blocked" visual state to reuse.
   - What's unclear: whether a user-pasted calendar (which they explicitly typed in,
     unlike an auto-surfaced engine suggestion) should still show its score/breakdown as
     informational even when new entries are gated, or should also fall back to the
     "not engine-scored" note in that state.
   - Recommendation: apply `gate.penaltyMultiplier` to the score regardless of gate state
     (A3 above), and let the existing pasted-card UI show it — do NOT hide/blank a pasted
     card's score just because the gate is closed, since CONTEXT.md's failure-posture rule
     ("falls back to unscored... never a hard error") is framed around missing DATA, not a
     closed gate, and a pasted calendar is user-initiated, not auto-surfaced.

2. **What HTTP status/response shape represents "scoring context unavailable" (no snapshot
   yet, or snapshot too stale) vs. a genuine 500 error?**
   - What we know: `GET /picker/candidates` uses `404 {error:"no-snapshot"}` for cold-start
     (`picker.routes.ts:37-40`), which `usePicker()` already treats as a distinct
     non-error `null` state.
   - What's unclear: whether `POST /picker/analyze` should mirror that exact
     `404`/`no-snapshot` convention, or return `200` with a `scored: false` flag inside a
     unified response shape (since the request DID succeed at parsing/computing greeks —
     only the gate/context enrichment is unavailable).
   - Recommendation: mirror the existing `404`/`{error:"no-snapshot"}` convention for
     consistency with `usePicker`'s established pattern; the client already has a
     `parsedCalendarToPickerCandidate` fallback builder ready to use as the "not
     engine-scored" display on that path.

## Environment Availability

Skipped — this phase has no new external dependencies. Every read the ad-hoc use-case
needs (`readGexContext`, `readEconomicEvents`, `readDailySpotCloses`,
`readPickerSlopeHistory`, `readRuleOverrides`, `readPickerSnapshot`) is against tables
already live in production (Postgres via `packages/adapters/postgres/`), already used by
the daily `compute-picker` cron job. No new service, tool, or runtime is introduced.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (workspace `test.projects` across `packages/*` and `apps/*`) — [VERIFIED: vitest.config.ts] |
| Config file | `vitest.config.ts` (root) + per-package `vitest.config.ts` |
| Quick run command | `bun run test -- --project=core` (or narrower: `bunx vitest run packages/core/src/picker/application/analyzeAdHocCalendar.test.ts`) |
| Full suite command | `bun run test` (`vitest run`) — [VERIFIED: package.json `"test": "vitest run"`] |

### Phase Requirements → Test Map

No REQ-IDs are mapped to this phase (see Phase Requirements above); rows below map to the
two locked decisions directly.

| Decision | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| Domain-fit (Decision 1) | `computePayoffDomain` returns a domain that contains all leg strikes + both BEs + spot, with padding | unit + fast-check property | `bunx vitest run apps/web/src/lib/payoff-domain.test.ts` | ❌ Wave 0 (new file) |
| Domain-fit (Decision 1) | `buildSpotGrid`/`buildXScale`/`pinMarker` honor an explicit domain, not module constants | unit (update existing) | `bunx vitest run apps/web/src/components/charts/PayoffChart.test.tsx apps/web/src/lib/scenario-engine.test.ts` | ✅ (existing files, needs edits per Pitfall 3) |
| Domain-fit (Decision 1) | 7500P repro case: strike 7500, BE@exp ~7150 both visible, left tail not clipped | unit (regression, literal repro values) | same as above | ❌ new test case in existing file |
| Ad-hoc scoring (Decision 2) | `makeAnalyzeAdHocCalendarUseCase` produces score/breakdown byte-identical to what `scoreOne` would produce for the equivalent `RawCandidate` | unit + fast-check (mirrors `scoring.test.ts`'s existing property-test style) | `bunx vitest run packages/core/src/picker/application/analyzeAdHocCalendar.test.ts` | ❌ Wave 0 (new file) |
| Ad-hoc scoring (Decision 2) | Gate/sizing reused verbatim from latest snapshot, never recomputed (no macro/open-calendar/recent-closed reads triggered) | unit (in-memory port call-count assertion) | same as above | ❌ Wave 0 |
| Ad-hoc scoring (Decision 2) | `POST /api/picker/analyze` — Zod-validated request, 404 on no-snapshot, 200 with `PickerCandidate` shape on success | integration (Hono route test, mirrors `settings.routes` test precedent) | `bunx vitest run apps/server/src/adapters/http/picker.routes.test.ts` | check existing file — extend if present |
| Ad-hoc scoring (Decision 2) | MCP tool `analyze_ad_hoc_calendar` — real `McpServer` + `InMemoryTransport` invocation (19-07 precedent, not a direct use-case call) | integration | `bunx vitest run apps/server/src/adapters/mcp/server.test.ts` | check existing file — extend if present |
| CandidateCard rendering (Pitfall 8) | A scored pasted card (`breakdown.length > 0`) shows real score + theta/vega, not the PASTED-pill-only subline | unit (React Testing Library) | `bunx vitest run apps/web/src/components/picker/CandidateCard.test.tsx` | check existing file — extend if present |

No testcontainers needed — no new Postgres table/migration in this phase (every read is
against existing tables). No msw needed — no new external HTTP adapter (all reads go
through existing internal ports with existing repos).

### Sampling Rate

- **Per task commit:** the narrow `vitest run <changed file>.test.ts` command for that task
- **Per wave merge:** `bun run test -- --project=core` and `--project=web` (both touched packages)
- **Phase gate:** full `bun run test` green + `bun run typecheck` + `bun run lint` before
  `/gsd-verify-work 30`

### Wave 0 Gaps

- [ ] `apps/web/src/lib/payoff-domain.test.ts` — covers Decision 1 (domain-fit algorithm)
- [ ] `packages/core/src/picker/application/analyzeAdHocCalendar.test.ts` — covers Decision 2
      (use-case), needs an in-memory-port test fixture (Rule 8: "ship the in-memory twin" —
      but this use-case needs no NEW port, so no new twin file, only new test wiring against
      existing `packages/adapters/memory/` twins)
- [ ] Framework install: none — Vitest/fast-check already present project-wide

## Security Domain

### Applicable ASVS Categories (security_asvs_level: 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes (indirect) | `POST /picker/analyze` must mount inside the same authenticated `apiRouter`/Bearer-token group as `/api/picker/candidates` (`main.ts` precedent) — no new unauthenticated surface |
| V3 Session Management | no | No session state introduced; stateless request/response |
| V4 Access Control | no | Single-bearer-token model (documented v1 deferred-item, unchanged by this phase) |
| V5 Input Validation | yes | Request body Zod-parsed (`zValidator("json", analyzeAdHocCalendarRequest)`) — strike/dte/iv/debit must be finite numbers, `dte` positive integers, matching `pickerCandidateLeg`'s existing constraints; MCP tool input schema must be the SAME Zod schema (MCP-02) |
| V6 Cryptography | no | No crypto/secrets touched |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Unbounded/abusive `POST /picker/analyze` calls (each triggers 5-6 DB reads + BSM math per request) | Denial of Service | This is a single-bearer-token authenticated internal tool (not public), and each request is cheap (bounded single-row reads, no chain scan) — no rate limiting exists elsewhere in this codebase for authenticated internal endpoints (e.g. `/picker/candidates`, `/settings/rules` have none), so this phase should NOT introduce new rate-limiting infra (YAGNI/KISS) but the plan should note the endpoint's cost profile explicitly so a future abuse-pattern review has the baseline documented |
| Malformed/adversarial pasted leg data reaching `bsmGreeks`/`bsmPrice` (e.g. `iv: 0`, `dte: 0`, negative strike) producing `NaN`/`Infinity` that propagates into a persisted structure | Tampering / Information Disclosure (NaN-poisoned scores surfacing as a fabricated-looking clean score) | Zod schema on the request (V5) rejects non-finite/non-positive values before they reach domain math; the domain's own never-silent guard-tagging convention (fwdIv guard, D-17 gexContextStatus) already handles degraded UPSTREAM context — the NEW input surface (client-supplied leg data) needs its OWN validation layer since it's the first user-supplied numeric input this bounded context has ever accepted (every prior input was chain-derived, not user-typed) |
| Server trusting a client-supplied `spot` for pricing-critical greeks/gexFit math | Tampering | Do not accept `spot` in the request body at all — derive it server-side from the SAME `readPickerSnapshot().spot` the client's own `tos-parser.ts` bisection already used (both draw from the identical 30-min-cadence snapshot in practice), removing the spoofable input entirely rather than validating it |

## Sources

### Primary (HIGH confidence — read directly, this session)
- `packages/core/src/picker/domain/scoring.ts` — `scoreOne`/`scoreCalendarCandidates`/`ScoringParams`
- `packages/core/src/picker/domain/types.ts` — `RawCandidate`/`RawCandidateLeg`/`ScoredCandidate`
- `packages/core/src/picker/domain/candidate-selection.ts` — `selectCandidates`, `legSpansEvents`, event-blackout logic
- `packages/core/src/picker/application/ports.ts` — every driven port (`ForReadingGexContext`, `ForReadingEconomicEvents`, `ForReadingPickerSnapshot`, etc.)
- `packages/core/src/picker/application/computePickerSnapshot.ts` — full use-case read/compute/persist shape, gate/sizing wiring
- `packages/core/src/picker/domain/rule-config.ts` — `resolvePickerRuleConfig`
- `packages/core/src/settings/application/ports.ts` — `ForReadingRuleOverrides`
- `packages/contracts/src/picker.ts` — `pickerCandidate`, `pickerSnapshotResponse` Zod schemas
- `apps/server/src/adapters/http/picker.routes.ts` — existing thin-adapter pattern, T-19-17
- `apps/server/src/adapters/http/settings.routes.ts` — Zod-validated PUT route pattern (29-13)
- `apps/server/src/main.ts` (lines 280-350) — composition-root wiring precedent
- `apps/web/src/screens/Analyzer.tsx` — full paste flow, `isPastedId` gating, all consumer sites
- `apps/web/src/screens/Overview.tsx` (lines 880-1160) — second `<PayoffChart>` consumer, multi-position combined book
- `apps/web/src/components/charts/PayoffChart.tsx` — `X_MIN`/`X_MAX` consumers (verified 4, not 3)
- `apps/web/src/lib/scenario-engine.ts` — `SPOT_GRID_MIN`/`MAX`, `buildSpotGrid`, `repriceScenario`
- `apps/web/src/lib/tos-parser.ts` — `parseTosOrder`, `ParsedCalendar` shape, flat-IV limitation
- `apps/web/src/lib/parsed-calendar-to-candidate.ts` — existing unscored fallback builder
- `apps/web/src/components/picker/CandidateCard.tsx` — `pasted` prop branches (Pitfall 8)
- `apps/web/src/components/picker/EntryExitPlan.tsx` — confirms `sizing` is snapshot-level, not per-candidate
- `apps/web/src/hooks/usePicker.ts` — 404/cold-start convention to mirror
- `.planning/phases/30-.../30-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.claude/rules/*.md`, `.planning/config.json`

### Secondary / Tertiary
- None — no web search or external documentation was needed; this is a 100% internal
  codebase-archaeology phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every module cited was read directly this session, zero external packages
- Architecture: HIGH — hexagon pattern (use-case + ports + thin adapters) is an exact match
  to 4+ existing precedents in this same bounded context (Phase 19/26/28/29)
- Pitfalls: HIGH — every pitfall traces to a specific file:line read this session, not
  inferred/assumed

**Research date:** 2026-07-10
**Valid until:** 14 days (fast-moving phase of an actively-developed picker engine —
Phase 29 shipped rule-override plumbing the day before this research; a Phase 31 already
scheduled to touch the same Overview marker/label code)
