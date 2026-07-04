# Phase 18: Analyzer → Picker UI Redesign - Research

**Researched:** 2026-07-04
**Domain:** Contract-first React/TypeScript UI redesign (Zod schema authoring + payoff-engine reuse + screen replacement) — zero new dependencies
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Picker contract shape (ANLZ-01)**
- **D-01:** `PickerCandidate` is rich / display-complete — the engine (Phase 19) is the sole scoring
  authority; the UI is pure-render, never recomputes scores. The contract carries every value the
  mockup displays: `score` (0–100) + a structured per-criterion breakdown array — each entry
  `{ criterion, weight, rawValue, contribution }` so the card bars are data-driven and
  forward-compatible with the engine (not four hard-coded fields). Summary analytics: `debit`
  (= max loss), net `theta`/`vega`/`delta`, `fwdIV` (nullable), `slope`, `fwdEdge`, `expectedMove`
  (±1σ by front expiry). Per-leg event flags (`fEvts`/`bEvts`) as data. The two legs (strike,
  put/call, front/back expiry or DTE, per-leg IV, qty) — enough to reconstruct an `AnalyzerPosition`
  for the payoff engine (see D-02).
- **D-01a:** `fwdIV` is nullable + guard-tagged — an inverted term structure (radicand < 0) yields
  a tagged guard result, never `NaN`. This mirrors the Phase-19 hard requirement so the contract
  shape and the UI's null-FwdIV branch are settled now, not retrofitted. See D-06.
- **D-01b:** Fold the exit plan into the contract as an `exitPlan` object (`profitTargetPct: 0.25`,
  `stopPct: 0.175`, `manageShortDte: 21`, `closeByExpiry`). Phase 18 renders fixed defaults; Phase
  19 can compute the close-by date. Rich-contract consistent.

**Payoff / risk-profile compute (ANLZ-02)**
- **D-02:** Reuse the existing `repriceScenario` engine. Adapt a candidate's legs →
  `AnalyzerPosition[]`, feed the SAME `repriceScenario`/`bookPL` that already powers Overview and
  the (old) Analyzer, and render through the Phase-17 `PayoffChart`. No second payoff code path.
  The contract carries legs, not curve points.
- **D-02a:** The ⊕-compare overlay, the ±1σ EM band, and the scenario strip all derive from that
  same engine output — compare = a second candidate adapted to `AnalyzerPosition[]` and overlaid
  (Phase-17 `PayoffChart` highlight/curve props). EM band uses the candidate's `expectedMove`.
- **D-02b:** Candidates are hypothetical / view-only — no broker positions, no editing, no
  simulated-trade persistence. The candidate→`AnalyzerPosition` adapter builds a throwaway
  `included:true` position purely to draw the curve.

**Fixture set (contract-first stand-in)**
- **D-03:** Freeze `playground-v4`'s real candidates into a static typed fixture. Port the exact
  6–8 candidates the mockup computes over the real 2026-07-01 chain snapshot (spot 7498.85, GEX
  flip 7473 / walls 7400·7525 / netγ +26.2B, the real ATM-IV term structure, FOMC 7/29 · CPI
  7/14+8/12 · NFP 7/3+8/7 event flags) as fixture DATA that satisfies the D-01 contract. No scoring
  logic in the app — the mockup's `buildCandidates()` is NOT ported; only its output is captured.
- **D-03a:** Include one guard-case candidate in the fixture (inverted structure → `fwdIV = null`,
  guard tag set) so the UI's null-FwdIV/guard-render path is exercised by a test. See D-06.

**Old Analyzer disposition**
- **D-04:** Full replace. The Analyzer route becomes picker-only. Retire the position-analyzer
  machinery — pasted/synthetic positions, `RollSimulator`, `AdHocPicker` (ad-hoc greeks lookup),
  the spot/days-forward/IV-shift `ScenarioPanel` sliders, `BookGreeksTable`, roll overlay.
  Rationale: Overview (Phase 17.1) now owns book payoff + future-date projection; Positions owns
  live legs. Smallest surface, no duplication.
- **D-04a:** Retiring shared helpers is delete-if-orphaned only — `repriceScenario`,
  `AnalyzerPosition`, `PayoffChart`, `pairPositionsIntoCalendars` stay (Overview + the picker use
  them). Remove only code that becomes unreferenced after the picker lands (e.g. `rollScenario`,
  `parseTosOrder` if no other caller). Verify callers before deleting.

**Card breakdown bars (ANLZ-01 display)**
- **D-05:** The card renders the mockup's 4 primary bars — slope · forward-IV edge · GEX fit ·
  event adjustment — read FROM the D-01 structured breakdown array (not hard-coded). The 5th score
  term (BE-vs-EM) stays in the breakdown data and surfaces in the why-panel/scenario strip, not as
  a 5th card bar. Keep the card scannable.

### Claude's Discretion
- Exact card/why-panel/term-structure layout, spacing, and tokens — resolved by the approved
  `18-UI-SPEC.md` (this research treats that spec as locked; do not re-derive).
- ⊕-compare cardinality — default single compare candidate at a time (matches the mockup's `CMP`);
  multi-overlay only if trivially free. UI-SPEC confirms single-slot as the shipped behavior.
- Exact contract field names/Zod structure and the fixture module location under
  `packages/contracts` — planner's call within D-01 (this research proposes concrete names/paths
  below, grounded in existing repo conventions — still the planner's call to finalize).
- D-06 fixture guard values — the specific inverted-structure numbers for the guard-case candidate
  are the planner's to pick, provided `fwdIV` resolves to the null/guard branch.

### Deferred Ideas (OUT OF SCOPE)
- Real `scoreCalendarCandidates` engine + `/api/picker/candidates` + `get_picker_candidates` MCP +
  economic-events adapter — Phase 19 (PICK-01..03). The contract authored here is what they fill;
  the UI swaps fixture→live with no layout change.
- Variant A (screener table) — the mockup's alternative; not selected. Ranked-cards variant B is
  the approved design.
- Screener filters (strike-view all/ATM/put-wall buttons, DTE range as user filter) — treat as
  Phase-19+ once live candidates exist. Not required by ANLZ-01/02/03.
- In-house backtest of the slope signal over `leg_observations` and threshold calibration
  (BE-vs-EM, θ/vega) — research backlog, not this milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANLZ-01 | User sees a ranked candidate-cards rail with per-criterion score-breakdown bars, rendered from contract-typed fixtures until the engine lands (contract-first: `packages/contracts` picker schema defined in this phase) | Standard Stack (contract module pattern + Zod idioms), Architecture Patterns (fixture module, breakdown-array shape), Don't Hand-Roll (no re-implementing `buildCandidates` scoring), Old-Analyzer Retirement list |
| ANLZ-02 | User can overlay a candidate on the payoff center (⊕ compare) with expected-move band and scenario strip | Architecture Patterns (`PayoffChart` additive props: `compareCurve`/`compareCurveColor`, `expectedMoveBand`), Code Examples (candidate→`AnalyzerPosition` adapter, `repriceScenario` reuse), Validation Architecture (adapter invariant tests) |
| ANLZ-03 | User sees a why-panel per candidate: term structure with leg dots + forward-vol bracket + event markers, and an entry/exit plan card (+25% / −17.5% defaults) | Architecture Patterns (fixture term-structure/event data shape), Common Pitfalls (guard-case rendering), Code Examples (exit-plan math) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Dependencies point inward: `packages/contracts` may import **zod + `@morai/shared` only** — no
  React, no app code, no core. The picker fixture, if placed under `packages/contracts`, must obey
  this (data-only, no JSX, no React types in that package).
- TDD red→green: every new Zod schema, adapter function, and additive `PayoffChart` prop needs a
  failing test written and run BEFORE the implementation, per `.claude/rules/tdd.md`. Numerical
  code (the candidate→`AnalyzerPosition` adapter, EM-band math) requires fast-check property tests
  in addition to example tests (`fast-check` is already a workspace devDependency, confirmed
  installed — see Standard Stack).
- No `any`, no `as`, no `!` — parse with Zod, use `Result<T,E>`/`assertDefined` from
  `packages/shared` where fallible logic lives in `apps/web/src/lib/`.
- Docs before architecture changes: none needed this phase — no new bounded context, no new table,
  no new job. `packages/contracts` gains a new schema module, which is the existing established
  pattern (no doc update required per `docs/architecture/stack-decisions.md`'s trigger list).
- Commits at green only; single commit per task per the 17.1 precedent recorded in STATE.md
  (`Decisions` log: "single commit per task at green" — no separate RED/GREEN commits required by
  policy, but the RED test must still be run and shown failing first).

## Summary

This phase authors a new Zod contract (`PickerCandidate`) in `packages/contracts`, freezes the
approved mockup's real candidate data into a typed fixture, and replaces `Analyzer.tsx` wholesale
with a ranked-cards picker screen that reuses the **existing, already well-tested**
`repriceScenario`/`PayoffChart` payoff stack. Zero new npm dependencies are needed — `zod`, `visx`,
`fast-check`, `vitest`, and `@testing-library/react` are all already installed and already used in
exactly the patterns this phase needs.

Three findings materially change what CONTEXT.md assumed, and the planner needs all three:

1. **`repriceScenario` is NOT untested.** CONTEXT.md's canonical_refs claims "`repriceScenario` has
   no covering test" — this is factually wrong. `apps/web/src/lib/scenario-engine.test.ts` already
   covers kernel-parity (cross-checked against direct `bsmGreeks` calls and the Plan-06
   `computePositionGreeks` helper), payoff-shape (peak near strike), the `expirationCurve`
   daysForward-invariance, per-leg IV non-convergence exclusion, and a 1000-run fast-check property
   test on the heatmap cells. What is genuinely untested — and what this phase's own risk actually
   is — is the **candidate→`AnalyzerPosition` adapter function that does not exist yet**, and the
   **debit-equals-max-loss invariant** the entry/exit plan card assumes (D-01b). Plan the Nyquist
   validation around those two gaps, not around "covering `repriceScenario`" (see Validation
   Architecture and Common Pitfalls).
2. **There is no reusable `calendarToAnalyzerPosition` to import.** The function CONTEXT.md and the
   UI-SPEC point to is a **private, unexported function inside `Analyzer.tsx`** built for
   `CalendarGroup` (paired *broker* positions with `longQty`/`shortQty`, `front`/`back`
   `BrokerPositionResponse`). A `PickerCandidate`'s two legs are hypothetical fixture data with no
   broker fields. The picker needs its **own** adapter (`candidateToAnalyzerPosition` or similar)
   that follows the same *pattern* (`id`, `name`, `occSymbol` synthesized to carry the strike,
   `frontDte`/`backDte`/`frontIv`/`backIv`, `qty`, `included: true`) but cannot literally import or
   call the existing private function, and does not need `CalendarGroup`/`pairPositionsIntoCalendars`
   at all (the picker never groups broker legs — it takes two `PickerCandidate` legs directly).
3. **The mockup's actual 5th score term is NOT "BE-vs-EM."** `playground-v4.html`'s `buildCandidates()`
   computes the 5th weighted term as `10 * (K === 7500 ? 1 : 0.7)` (a strike-proximity bonus), not
   a breakeven-vs-expected-move term. D-05 explicitly directs the breakdown array's 5th entry to
   represent "BE-vs-EM" and surface it in the why-panel/scenario strip. The mockup DOES compute a
   BE-vs-EM ratio, but only for its table-variant column (`beWidth(c)/(2*c.em)`), never wired into
   the score. **Treat D-05's BE-vs-EM instruction as authoritative and synthesize the 5th breakdown
   entry from `beWidth`/`expectedMove`, not from the mockup's literal K-proximity term** — this is
   a deliberate improvement over the throwaway mockup, not a fixture-fidelity bug. Flag this for the
   planner explicitly so no one "fixes" the fixture to match the mockup's literal code.

**Primary recommendation:** Author `packages/contracts/src/picker.ts` (Zod schema + inferred type +
`*.test.ts`, re-exported via `index.ts`, mirroring `gex.ts`/`analytics.ts` exactly), freeze the
mockup's real numbers into `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` as
plain typed data (no logic), write a new `candidateToAnalyzerPosition` adapter in
`apps/web/src/lib/` (own TDD cycle, own test file), overwrite `Analyzer.tsx` in place (same export
name, so `App.tsx`'s route wiring needs zero changes), and extend `PayoffChartProps` with two
additive optional prop pairs (`compareCurve`/`compareCurveColor`, `expectedMoveBand`) that default
to `undefined`/`null` so `Overview.tsx`'s existing call site is untouched.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Picker candidate schema (`PickerCandidate`) | API contracts (`packages/contracts`) | — | Zod schema is the single source of truth both the fixture (this phase) and the real engine response (Phase 19) must satisfy — MCP-02 pattern used by every existing contract module |
| Frozen candidate fixture data | API contracts (`packages/contracts/src/__fixtures__/`) or Browser (`apps/web/src/fixtures/`) | — | Pure data, no logic; either location is hexagon-legal since it imports nothing beyond the schema. This research recommends `packages/contracts` for symmetry with the schema it satisfies (see Architecture Patterns) |
| Candidate→AnalyzerPosition adapter | Browser (`apps/web/src/lib/`) | — | Pure function, client-only, no I/O — same tier as `scenario-engine.ts`, `pair-calendars.ts` |
| Payoff/EM-band/scenario-strip compute | Browser (`apps/web/src/lib/scenario-engine.ts`) | — | `repriceScenario`/`bookPL` already own this; D-02 is explicit "no second payoff code path" |
| Ranked-cards rail, why-panel, term-structure chart rendering | Browser (`apps/web/src/screens/Analyzer.tsx` + new components) | — | Pure presentational React, consumes fixture-typed data, zero network |
| Route wiring (`/analyzer` → picker) | Browser (`apps/web/src/App.tsx`) | — | Unchanged this phase — same component export name avoids touching this file at all |
| Real scoring, chain-snapshot staleness, economic-events adapter | Core + Adapters (Phase 19) | API/MCP (Phase 19) | Explicitly out of scope (D-01: engine is sole scoring authority; contract this phase is display-complete but inert) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | `^4.4.3` (verified installed, `packages/contracts/package.json`) | Picker candidate schema | Already the sole contract-schema tool in this repo (MCP-02 pattern); zero new dependency |
| `@morai/shared` | workspace (verified `packages/shared/src/result.ts`, `assert.ts`) | `Result<T,E>`, `assertDefined` for the new adapter function in `apps/web/src/lib/` | Existing project-wide non-null/error-handling convention; `packages/contracts` itself may import this too per architecture-boundaries.md |
| `@morai/quant` | workspace (`bsmPrice`, `bsmGreeks`, imported by `scenario-engine.ts`) | Underlying pricing kernel `repriceScenario` already wraps | Reused transitively — the picker never imports `@morai/quant` directly, it goes through `repriceScenario` (D-02) |
| `visx` (`@visx/shape`, `@visx/scale`, `@visx/gradient`, `@visx/group`, `@visx/event`) | Already installed (used by `PayoffChart.tsx`) | Payoff chart rendering, extended with compare-curve + EM-band layers | Locked charting library per `18-UI-SPEC.md`; this phase adds zero new visx sub-packages — plain inline SVG (matching the mockup's own hand-rolled SVG) is used for the term-structure mini-chart and breakdown bars instead |

### Supporting (test tooling — already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fast-check` | `^4.8.0` (root `package.json` devDependency, verified `grep`) | Property tests for the candidate→AnalyzerPosition adapter and any EM-band math | Numerical/invariant code per `.claude/rules/tdd.md` — already the pattern in `scenario-engine.test.ts`'s 1000-run heatmap property test |
| `vitest` | `^4.1.8` | Test runner (root `vitest.config.ts` declares `test.projects` globs covering `packages/*/vitest.config.ts` and `apps/*/vitest.config.ts`) | All new tests |
| `@testing-library/react` | Already installed (used in `PayoffChart.test.tsx`, `GexBars.test.tsx`) | Component-level assertions for the new ranked-cards, why-panel, guard-tag rendering | Component tests — visx renders plain SVG under jsdom, no chart-library mock needed (confirmed comment in `PayoffChart.test.tsx`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Freezing fixture under `packages/contracts/src/__fixtures__/` | Freezing under `apps/web/src/fixtures/` | Both are hexagon-legal (pure data). `packages/contracts` keeps the fixture co-located with the schema it satisfies (matches `packages/core/src/__fixtures__/` and `packages/adapters/src/test/fixtures/` naming precedent found in this repo); `apps/web` keeps it closer to the only consumer. Either is fine — planner's call per CONTEXT.md discretion, this research recommends `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` for schema/fixture symmetry |
| A new `compareCurve`/`compareCurveColor` prop pair on `PayoffChart` | Repurposing `rollCurve` for the compare overlay | Rejected by the UI-SPEC itself (`rollCurve` is solid/no-dash and semantically "roll"; `highlighted*Curve` props are non-amber and drive the unrelated Overview row-highlight feature) — confirmed by reading `PayoffChartProps`: `rollCurve: ReadonlyArray<PayoffPoint> \| null` has no color-override prop and is rendered as a distinct, non-dashed layer (`PayoffChart.tsx` layer 5 comment) |
| A `Result<T,E>`-style discriminated union for the guard-tagged `fwdIV` in the Zod contract | A single nullable number with no tag | Rejected — D-01a requires the tag be visible in transport. This repo's own convention for this exact shape (nullable value + sibling enum-tag field) already exists: `AnalyzerPosition.frontIvStatus?: "ok" \| "non-convergent"` in `scenario-engine.ts`, and `status.ts`'s `status: z.enum([...])` pattern at the contracts layer — follow that, not a Result import (contracts stays zod+shared only; a full `Result<T,E>` object is a core/adapter-tier concept, not a wire-format idiom used anywhere in `packages/contracts` today) |

**Installation:** none — zero new dependencies (v1.2 lock, confirmed no `npm install`/`bun add`
needed; every library above is already present in `package.json`/lockfile).

**Version verification:** `zod@^4.4.3` confirmed via `packages/contracts/package.json` (installed,
not training-data-assumed). `fast-check@^4.8.0` confirmed via root `package.json` devDependencies
(`grep -n '"fast-check"' package.json`). `vitest@^4.1.8` confirmed via root `package.json`. All
`[VERIFIED: package.json]` — read directly from the lockfile-adjacent manifest, not npm registry
lookups, since these are already-installed workspace dependencies and this phase adds none.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** Every library used (`zod`,
`visx`, `fast-check`, `vitest`, `@testing-library/react`, `@morai/shared`, `@morai/quant`) is
already a workspace dependency confirmed present in `package.json`/`packages/*/package.json`. No
`npm view`/`pip index`/`cargo search` legitimacy check is needed because no new package name is
being introduced. If the planner's task breakdown surfaces a need for any new package, treat that
as an out-of-scope escalation — CONTEXT.md's "zero new dependencies (v1.2 lock)" constraint is
explicit and locked.

**Packages removed due to [SLOP] verdict:** none (n/a — no new packages).
**Packages flagged as suspicious [SUS]:** none (n/a — no new packages).

## Architecture Patterns

### System Architecture Diagram

```
                         packages/contracts/src/picker.ts
                         (Zod: pickerCandidate, pickerCandidateLeg,
                          breakdownEntry, exitPlan — the shared TYPE)
                                        │
                    satisfies the schema (compile-time + .parse() test)
                                        │
        ┌───────────────────────────────────────────────────────┐
        │                                                       │
packages/contracts/src/__fixtures__/          (Phase 19, OUT OF SCOPE)
picker-candidates.fixture.ts                  GET /api/picker/candidates
(frozen playground-v4 real data,              scoreCalendarCandidates()
 6-8 candidates + 1 guard case)               → same schema, live chain data
        │                                                       │
        │  import (only this line changes in Phase 19)          │
        ▼                                                       ▼
apps/web/src/screens/Analyzer.tsx  ◄───────── (fixture swap, no layout change)
  ├─ renders ranked-cards rail (ANLZ-01, reads candidate.breakdown[])
  ├─ on select/compare → candidateToAnalyzerPosition(candidate.legs)
  │        │
  │        ▼
  │  apps/web/src/lib/scenario-engine.ts
  │     repriceScenario(AnalyzerPosition[], params)  ◄── UNCHANGED, reused verbatim (D-02)
  │        │
  │        ▼
  │  apps/web/src/components/charts/PayoffChart.tsx
  │     todayCurve / expirationCurve (selected)
  │     + compareCurve / compareCurveColor (NEW additive prop pair, ANLZ-02)
  │     + expectedMoveBand (NEW additive prop, ANLZ-02)
  │
  ├─ why-panel (ANLZ-03): reads candidate.fwdIV/slope/theta/vega directly (no compute)
  ├─ term-structure mini-chart (ANLZ-03): reads candidate's fixture term-structure array
  └─ entry/exit plan card (ANLZ-03): reads candidate.exitPlan, computes debit×pct locally
```

### Recommended Project Structure
```
packages/contracts/src/
├── picker.ts                          # NEW — PickerCandidate + leg + breakdown + exitPlan schemas
├── picker.test.ts                     # NEW — oracle-payload parse tests (mirrors gex.test.ts)
├── __fixtures__/
│   └── picker-candidates.fixture.ts   # NEW — frozen playground-v4 data, typed to picker.ts, +1 guard case
└── index.ts                           # add picker.ts export block (existing pattern)

apps/web/src/
├── screens/
│   └── Analyzer.tsx                   # REWRITTEN — picker screen, same export name (App.tsx untouched)
├── lib/
│   ├── candidate-to-position.ts       # NEW — candidateToAnalyzerPosition adapter (own TDD cycle)
│   └── candidate-to-position.test.ts  # NEW — unit + fast-check invariant tests
└── components/charts/
    └── PayoffChart.tsx                # EXTENDED — additive compareCurve/expectedMoveBand props only
```

### Pattern 1: Per-contract Zod module (existing repo convention)
**What:** One `*.ts` file per contract concern (schema + `z.infer` type), one `*.test.ts` with an
oracle payload, re-exported from `index.ts`. Both HTTP routes and MCP tools import the same schema
(MCP-02 pattern) — though Phase 18 has no route/MCP consumer yet, author the schema exactly as if
it did, since Phase 19 will point both surfaces at it unchanged.
**When to use:** Any new wire-format shape.
**Example (mirrors `gex.ts`'s nullable-field precedent for the D-01a guard tag):**
```typescript
// Source: packages/contracts/src/gex.ts (existing pattern, read this session)
import { z } from "zod";

export const pickerCandidateLeg = z.object({
  strike: z.number(),
  putCall: z.enum(["C", "P"]),
  dte: z.number().int(),
  iv: z.number(),
});
export type PickerCandidateLeg = z.infer<typeof pickerCandidateLeg>;

export const breakdownEntry = z.object({
  criterion: z.enum(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"]),
  weight: z.number(),
  rawValue: z.number(),
  contribution: z.number(),
});
export type BreakdownEntry = z.infer<typeof breakdownEntry>;

export const exitPlan = z.object({
  profitTargetPct: z.number(),
  stopPct: z.number(),
  manageShortDte: z.number().int(),
  closeByExpiry: z.string(), // ISO date
});
export type ExitPlan = z.infer<typeof exitPlan>;

export const pickerCandidate = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number().min(0).max(100),
  breakdown: z.array(breakdownEntry),
  debit: z.number(),
  theta: z.number(),
  vega: z.number(),
  delta: z.number(),
  // D-01a: nullable value + sibling enum-tag, matching the repo's existing
  // AnalyzerPosition.frontIvStatus / status.ts status-enum idiom — not a Result<T,E> import.
  fwdIv: z.number().nullable(),
  fwdIvGuard: z.enum(["ok", "inverted"]),
  slope: z.number(),
  fwdEdge: z.number(),
  expectedMove: z.number(),
  frontEvents: z.array(z.string()),
  backEvents: z.array(z.string()),
  frontLeg: pickerCandidateLeg,
  backLeg: pickerCandidateLeg,
  exitPlan: exitPlan,
});
export type PickerCandidate = z.infer<typeof pickerCandidate>;
```
Field names above are this research's proposal — CONTEXT.md leaves exact naming to the planner.
Cross-field validity (`fwdIvGuard === "inverted"` implies `fwdIv === null`) can be enforced with
`.refine()` mirroring `jobs.ts`'s `triggerJobPayload.refine(...)` precedent, or left as a documented
invariant asserted only in the fixture's own test (simpler; matches repo's existing lightness —
none of the current 15 nullable-field contracts in this repo cross-validate their nullable+tag
pairs with `.refine()`).

### Pattern 2: Additive optional props on a shared component (existing repo precedent)
**What:** `PayoffChartProps` has grown three times already (D-02 exclusion note, D-03 curve-color
override, D-05 row-highlight) purely by adding **optional props with defaults**, never touching
existing callers. `Overview.tsx` calls `PayoffChart` without `highlightedPositionId`,
`todayCurveColor`, etc., and those calls remain correct because every new prop has a default
(`= null` / `= VIOLET` / `= GRAY_MUTED`) in the destructured function signature
(`PayoffChart.tsx:221-239`).
**When to use:** Any time the picker needs `PayoffChart` to do something new.
**Example — the two prop pairs this phase needs, following the exact same idiom:**
```typescript
// Source: apps/web/src/components/charts/PayoffChart.tsx (PayoffChartProps, read this session)
export interface PayoffChartProps {
  // ...existing fields unchanged...
  /** ⊕-compare overlay: single dashed amber front-expiry curve for a second candidate (ANLZ-02). */
  compareCurve?: ReadonlyArray<PayoffPoint> | null;
  compareCurveColor?: string; // default "#f0b429" (amber)
  /** ±1σ expected-move band: two tick marks + connector at the zero-P&L line (ANLZ-02). */
  expectedMoveBand?: { spot: number; em: number } | null;
}
```
Draw `expectedMoveBand` between the existing "Zero line" layer (`PayoffChart.tsx:453-459`) and
layer 2 (T+0 curve, `PayoffChart.tsx:488`) so it never occludes a curve, per the UI-SPEC's explicit
z-order instruction. Draw `compareCurve` alongside the existing amber `rollCurve` layer
(`PayoffChart.tsx:517-527`, layer 5) since both are single dashed amber overlays — but as a
**separate** conditional block, not a repurposing of `rollCurve` (the picker always passes
`rollCurve={null}` since the roll feature is retired per D-04).

### Pattern 3: Candidate → AnalyzerPosition adapter (new, follows an existing pattern, does not reuse existing code)
**What:** `Analyzer.tsx`'s current `calendarToAnalyzerPosition(cal: CalendarGroup)` (private,
unexported, `Analyzer.tsx:120-135`) is the *pattern* to imitate, not a function to import. It
cannot be reused directly — `CalendarGroup` requires two real `BrokerPositionResponse` legs with
`longQty`/`shortQty`; a `PickerCandidate`'s legs are fixture data with no broker fields.
**When to use:** Converting a selected/compared `PickerCandidate` into the one `AnalyzerPosition`
`repriceScenario` needs (D-02: "a candidate is expressible as one `AnalyzerPosition`").
**Example:**
```typescript
// New file: apps/web/src/lib/candidate-to-position.ts
// Pattern source: apps/web/src/screens/Analyzer.tsx calendarToAnalyzerPosition (read this session)
import type { AnalyzerPosition } from "./scenario-engine.ts";
import type { PickerCandidate } from "@morai/contracts";

function occSymbolForStrike(strike: number, putCall: "C" | "P"): string {
  const thousandths = Math.round(strike * 1000).toString().padStart(8, "0");
  return `SPX   000000${putCall}${thousandths}`; // synthetic — never a real broker symbol (D-02b)
}

export function candidateToAnalyzerPosition(candidate: PickerCandidate): AnalyzerPosition {
  return {
    id: candidate.id,
    name: candidate.name,
    live: false, // D-02b: hypothetical, never a live broker position
    occSymbol: occSymbolForStrike(candidate.backLeg.strike, candidate.backLeg.putCall),
    putCall: candidate.backLeg.putCall,
    frontDte: candidate.frontLeg.dte,
    backDte: candidate.backLeg.dte,
    frontIv: candidate.frontLeg.iv,
    backIv: candidate.backLeg.iv,
    qty: 1,
    included: true,
  };
}
```
This needs its own RED→GREEN cycle (`.claude/rules/tdd.md`) and its own test file — it is new
production code, not a reused helper.

## Old-Analyzer Retirement — Caller-Verified Keep/Delete List (D-04/D-04a)

Verified via `grep -rl` across `apps/web/src` this session (non-test importers only; test files
always accompany their subject and are deleted alongside it):

| Symbol/File | Non-test importers found | Disposition |
|---|---|---|
| `RollSimulator` (`components/RollSimulator.tsx`) | `Analyzer.tsx` only | **DELETE** — orphaned after Analyzer rewrite |
| `AdHocPicker` (`components/AdHocPicker.tsx`) | `Analyzer.tsx` only (Overview.tsx/useLiveStream.ts references are **comments only**, not imports — verified by reading the matched lines) | **DELETE** — orphaned after Analyzer rewrite; update the two stale comments in `Overview.tsx`/`useLiveStream.ts` that reference "AdHocPicker" as prose if touched, but this is not required by ANLZ-01/02/03 |
| `BookGreeksTable` (inline function, `Analyzer.tsx:376`) | `Analyzer.tsx` only (never a separate file) | **DELETE** — goes away with the file rewrite, no separate deletion step needed |
| `ScenarioPanel` (inline function, `Analyzer.tsx:283`) | `Analyzer.tsx` only (never a separate file) | **DELETE** — same as above |
| `rollScenario` (`lib/scenario-engine.ts`) | `Analyzer.tsx`, `RollSimulator.tsx`, its own test file | **DELETE** function + its describe block in `scenario-engine.test.ts` once both callers are gone — confirm no Overview.tsx usage first (confirmed: Overview.tsx does not import `rollScenario`) |
| `parseTosOrder` (`lib/tos-parser.ts`) | `Analyzer.tsx` only (+ its own test file) | **DELETE** `tos-parser.ts` + `tos-parser.test.ts` entirely once Analyzer.tsx no longer imports it |
| `AttributionWaterfall` (`components/AttributionWaterfall.tsx`) | `Analyzer.tsx` only (+ its own test file) | **DELETE** — orphaned after Analyzer rewrite |
| `GreekStrips` (`components/charts/GreekStrips.tsx`) | `Analyzer.tsx` only (+ own test file); also referenced by `scenario-engine.ts`'s `bookGreekStrips` output shape, but that's a data shape, not a component import | **DELETE the component**; the `bookGreekStrips` field on `ScenarioResult` can stay unused in `repriceScenario`'s output (D-02: no second payoff code path — cheaper to leave the field than to touch `repriceScenario`'s tested shape) |
| `PnlHeatmap` (`components/charts/PnlHeatmap.tsx`) | `Analyzer.tsx` only (+ own test file) | **DELETE** — orphaned; leave `buildHeatmapCells`/`heatmapCells` in `scenario-engine.ts` alone for the same reason as above |
| `LevelBar` (`components/LevelBar.tsx`) | `Analyzer.tsx` only (+ own test file) | **DELETE** — orphaned after Analyzer rewrite |
| `repriceScenario`, `AnalyzerPosition`, `bookPL`, `t0ExcludedPositions`, `buildScenarioStrip` (`lib/scenario-engine.ts`) | `Analyzer.tsx` **and** `Overview.tsx` | **KEEP** (D-04a explicit) |
| `PayoffChart` (`components/charts/PayoffChart.tsx`) | `Analyzer.tsx` **and** `Overview.tsx` | **KEEP**, extend additively (D-04a explicit) |
| `pairPositionsIntoCalendars`, `CalendarGroup` (`lib/pair-calendars.ts`) | `Analyzer.tsx` **and** `Overview.tsx` | **KEEP** — the picker does NOT need this (candidates aren't paired broker legs), but Overview still uses it, so it stays regardless |
| `GammaProfile`, `GexBars` (`components/charts/`) | `Analyzer.tsx` **and** `Overview.tsx` (`GexBars` also `Market.tsx`) | **KEEP** — if the picker's right-rail reuses these for context, fine; if not, they still stay for Overview/Market |
| `usePositions`, `useGex`, `useLiveStream` (hooks) | `Analyzer.tsx` **and** `Overview.tsx`/`Shell.tsx`/`Market.tsx`/`LiveStatusBadge.tsx`/`AdHocPicker.tsx` | **KEEP** — the picker screen itself likely stops calling `usePositions`/`useGex` (fixture data, D-02b: no broker positions), but the hooks stay for other screens; simply stop importing them in the new `Analyzer.tsx` |
| `Analyzer.test.tsx` (7 existing `describe`/`it` blocks, verified count) | Old `Analyzer.tsx` | **REWRITE ENTIRELY** — every existing test asserts old-Analyzer behavior (paste positions, roll simulator, etc.) that no longer exists; this is not an incremental edit |

**Route wiring:** `apps/web/src/App.tsx` imports `{ Analyzer }` from `./screens/Analyzer.tsx` and
renders it under the unchanged nav key `"Analyzer"` (D-04: nav label unchanged). **Keep the same
export name `Analyzer`** when rewriting the file so `App.tsx` needs zero changes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Payoff/P&L curve math for a candidate | A second BSM re-pricing path in the picker screen | `repriceScenario` (`apps/web/src/lib/scenario-engine.ts`), fed one `AnalyzerPosition` per candidate | D-02 hard constraint; `repriceScenario` is already kernel-parity-tested against `@morai/quant` directly — a second path would need its own parity proof and would drift |
| Scenario-strip 5-level P&L table | A bespoke level-selection/dedup routine | `buildScenarioStrip`'s dedup/cap logic conceptually, or the function itself if the picker's single-candidate case fits its signature (`levels`, `positions`, `spot`) | Already handles GEX-level + position-strike dedup with an 8-level cap and a documented tie-break rule; re-deriving it risks silently diverging on the dedup epsilon or the 4-strike cap |
| Guard-tagged nullable numeric fields in a Zod schema | A custom `Result<T,E>`-shaped Zod union for `fwdIV` | Nullable value + sibling `z.enum` tag field (`fwdIv: z.number().nullable()`, `fwdIvGuard: z.enum(["ok","inverted"])`) | Matches the repo's own established idiom (`AnalyzerPosition.frontIvStatus`, `status.ts`'s enum-tag fields) — inventing a new discriminated-union wire shape for one field is unnecessary complexity |
| Forward-IV computation, term-structure slope, event-window flagging | Porting `playground-v4.html`'s `fwdIV()`/`legEvents()`/scoring functions into the app | Freeze their OUTPUT as fixture data only (D-03 explicit: "No scoring logic in the app") | This is the entire point of contract-first: Phase 19 owns the real computation; Phase 18 renders numbers, it never derives them |
| Candidate card breakdown-bar layout math | Hard-coded 4 bars reading 4 named fields | Filter `PickerCandidate.breakdown[]` by `criterion` name at render time (D-05 explicit) | Keeps the UI forward-compatible with however Phase 19's real engine orders/extends the breakdown array |

**Key insight:** every numerical building block this phase needs — pricing, greeks, scenario-strip
levels, non-convergence handling — already exists and is already tested. The only genuinely new
numerical code is the candidate→`AnalyzerPosition` adapter (a straightforward field mapping, no
new math) and whatever glue computes `debit × pct` for the entry/exit plan card (arithmetic only,
no BSM). Resist the temptation to "improve" or "generalize" `repriceScenario`/`PayoffChart` beyond
the two additive prop pairs — D-02's "no second payoff code path" is a hard constraint, and the
existing engine's test suite is the safety net this phase inherits for free.

## Common Pitfalls

### Pitfall 1: Trusting CONTEXT.md's "repriceScenario has no covering test" note literally
**What goes wrong:** A planner reads that note and schedules a task to "add basic coverage to
`repriceScenario`" — duplicating already-existing, already-passing tests, or worse, writing tests
that don't match the existing kernel-parity/heatmap-property style and create false confidence.
**Why it happens:** The note in CONTEXT.md's canonical_refs is stale/inaccurate — verified this
session by reading `apps/web/src/lib/scenario-engine.test.ts` in full: it has 7+ describe blocks
covering kernel parity, payoff shape, expiration-curve invariance, non-convergence exclusion
(both front-leg and back-leg), a 1000-run fast-check heatmap property test, and `rollScenario`.
**How to avoid:** Plan the actual gap — a test for the NEW `candidateToAnalyzerPosition` adapter
(does it produce a position whose T+0 entry price equals the candidate's `debit`? does the
resulting curve's max-loss equal `debit` at/before front expiry, matching D-01b's "Debit = max
loss" plan-card claim?) and a test for the EM-band/compare-curve additive `PayoffChart` props.
**Warning signs:** A task titled "test repriceScenario" with no reference to the adapter or the
debit-invariant — that's the tell this pitfall is being walked into.

### Pitfall 2: Reusing `calendarToAnalyzerPosition` or `CalendarGroup` directly for candidates
**What goes wrong:** Importing `CalendarGroup`/`calendarToAnalyzerPosition` (or trying to export
the private function from `Analyzer.tsx`) to save writing a new adapter — but `CalendarGroup`
requires `front`/`back` as full `BrokerPositionResponse` objects (with `longQty`, `shortQty`,
`marketValue`, etc.) that a hypothetical fixture candidate simply doesn't have. Forcing candidate
data into that shape means fabricating broker fields that mean nothing (D-02b: "no broker
positions").
**Why it happens:** The names are extremely close (`calendarToAnalyzerPosition` vs. what the
picker needs) and the CONTEXT.md/UI-SPEC prose reads as if it's a ready-made reusable function.
**How to avoid:** Write a new, small adapter (`candidateToAnalyzerPosition`, shown in Code
Examples) that takes `PickerCandidate` legs directly — no `CalendarGroup`, no
`pairPositionsIntoCalendars` involvement at all.
**Warning signs:** Any import of `BrokerPositionResponse` or `pairPositionsIntoCalendars` inside
picker-specific code — the picker never touches broker data.

### Pitfall 3: Wiring the guard-case candidate's `fwdIvGuard` tag but forgetting `expectedMove`
**What goes wrong:** D-01a/D-03a focus attention on `fwdIV = null` for the guard candidate, but
`expectedMove` (`SPOT * frontIv * sqrt(frontDte/365)` per the mockup's `em` field) is computed from
`frontIv` alone and stays valid even when `fwdIV` is null (inverted structure is a BACK-vs-FRONT
relationship; front IV alone is never undefined). If the fixture-builder conflates "guard case" with
"blank out every derived field," the EM band and scenario strip for that one card will silently
disappear too, which the UI-SPEC never asked for — only the `fwd edge` bar/term-structure bracket
should be affected (see UI-SPEC's own guard-render table).
**Why it happens:** Guard-casing by field name (`fwdIV`) is easy to over-apply once you're in
"nullable defensive" mode while hand-authoring the fixture.
**How to avoid:** Cross-check every guard-case fixture value against the UI-SPEC's "Null-FwdIV /
guard-case render branch" table (5 surfaces listed: card breakdown bar, why-panel Fwd IV stat,
why-panel forward-edge sentence, term structure, score) — nothing else on that candidate should be
null.
**Warning signs:** A guard-case fixture candidate with `expectedMove: null` or a `theta`/`vega` of
0/null — those should be normal computed values same as every other candidate.

### Pitfall 4: Breaking `Overview.tsx`'s `PayoffChart` call site with the new props
**What goes wrong:** Adding `compareCurve`/`expectedMoveBand` as **required** props (no default,
no `?`) breaks `Overview.tsx`'s existing call, which doesn't pass them.
**Why it happens:** Easy to forget the `?` and default value when adding new interface fields,
especially with `exactOptionalPropertyTypes` in the tsconfig (per `.claude/rules/typescript.md`) —
under that flag, `prop?: T` and passing `undefined` explicitly are NOT the same thing, and a
destructuring default (`compareCurve = null`) combined with an optional `?` in the interface is the
pattern every existing additive prop in `PayoffChartProps` already uses (`highlightedPositionId?`,
`excludedFromT0Count?`, `todayCurveColor?`) — copy that exact idiom.
**How to avoid:** Mark every new prop optional (`?`) in `PayoffChartProps` and give it a default in
the destructured function parameters, exactly like the three prior additive-prop rounds did. Run
`Overview.test.tsx`'s existing `PayoffChart`-related assertions after the change — they must still
pass untouched.
**Warning signs:** A typecheck failure in `Overview.tsx` after touching `PayoffChartProps` — that's
the `exactOptionalPropertyTypes` gate catching a missing default.

## Code Examples

### Debit = max-loss invariant (the untested gap this phase actually introduces)
```typescript
// New test in apps/web/src/lib/candidate-to-position.test.ts (RED first)
// D-01b's plan-card math (target = debit*0.25, stop = debit*0.175) implicitly assumes
// `debit` really is the position's max loss when closed at front expiry — this was never
// asserted for a *candidate*-derived position before this phase (Pitfall 1).
import { repriceScenario } from "./scenario-engine.ts";
import { candidateToAnalyzerPosition } from "./candidate-to-position.ts";

it("a candidate's max loss on the expirationCurve does not exceed its debit (within pricing tolerance)", () => {
  const position = candidateToAnalyzerPosition(SOME_FIXTURE_CANDIDATE);
  const result = repriceScenario([position], BASE_PARAMS);
  const worstCase = Math.min(...result.expirationCurve.map((p) => p.pl));
  expect(worstCase).toBeGreaterThanOrEqual(-SOME_FIXTURE_CANDIDATE.debit - TOLERANCE);
});
```

### Entry/exit plan math (ANLZ-03, pure arithmetic, no new pricing)
```typescript
// Source pattern: mockups/playground-v4.html renderPlan() (read this session)
const target = candidate.debit * candidate.exitPlan.profitTargetPct; // 0.25
const stop = candidate.debit * candidate.exitPlan.stopPct;           // 0.175
// manageShortDte (21) and closeByExpiry are pre-computed dates carried on the fixture (D-01b) —
// Phase 18 formats them, it does not compute "expiry minus 21 days" itself (that's fixture-authoring work).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Position-analyzer with pasted/synthetic positions, roll simulator, ad-hoc greeks lookup | Contract-typed candidate picker, view-only, hypothetical legs | This phase (D-04) | Analyzer.tsx's entire surface area changes meaning — "Analyzer" now means "trade-idea picker," not "position risk cockpit" (Overview absorbed the latter in Phase 17.1) |
| Raw front−back IV subtraction for term-structure edge | Forward-variance identity `√[(T₂σ₂²−T₁σ₁²)/(T₂−T₁)]` with radicand-guard | Locked by `.planning/research/calendar-selection-criteria.md` (verified research, HIGH confidence, 3-0×3 adversarial vote) | Any fixture/engine code computing `fwdIV` must use this formula, never a raw subtraction — REFUTED criteria list in the same research doc must never be encoded (IV-rank gates, −1..−3% IV-diff band, debit-%-of-back band) |

**Deprecated/outdated:** The mockup's own 5th score term (`K===7500?1:0.7` strike-proximity bonus)
is effectively superseded by D-05's explicit "BE-vs-EM" instruction for the breakdown array's 5th
entry — do not port the literal mockup formula for that one term (see Summary finding #3).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Proposed Zod field names (`pickerCandidate`, `breakdownEntry`, `exitPlan`, `fwdIvGuard`, etc.) are this research's naming proposal, not a locked decision | Architecture Patterns, Pattern 1 | Low — CONTEXT.md explicitly leaves exact field names to the planner; any consistent naming that satisfies D-01/D-01a/D-01b works |
| A2 | Fixture module location (`packages/contracts/src/__fixtures__/`) is a recommendation based on repo precedent (`packages/core/src/__fixtures__/`, `packages/adapters/src/test/fixtures/`), not the only valid choice | Standard Stack, Alternatives Considered | Low — `apps/web/src/fixtures/` is equally hexagon-legal; CONTEXT.md defers this to the planner |
| A3 | The 5th breakdown entry ("BE-vs-EM") should be computed from a `beWidth`/`expectedMove` ratio (following the mockup's table-variant `beWidth(c)/(2*c.em)` calculation) rather than the mockup's literal 5th score term — this is this research's interpretation of D-05's intent, cross-checked against the actual mockup source code this session | Summary (finding #3), State of the Art | Medium — if the planner instead ports the mockup's literal K-proximity term as "BE-vs-EM," the breakdown array's `criterion: "beVsEm"` entry will carry semantically wrong data (a strike-proximity score mislabeled as a breakeven-width score); low blast radius since it's fixture-only data this phase, corrected when Phase 19's real engine lands |
| A4 | `.refine()`-style cross-field validation between `fwdIv`/`fwdIvGuard` is optional, not required, for the Zod schema — based on the observation that no existing contract in this repo cross-validates a nullable+tag pair this way | Architecture Patterns, Pattern 1 | Low — omitting it doesn't break anything; adding it is also fine and arguably safer, purely a style choice |

**If this table is empty:** N/A — see rows above; all four are LOW-to-MEDIUM risk, non-blocking style/naming choices explicitly deferred to the planner by CONTEXT.md, except A3 which the planner should read carefully before authoring the fixture.

## Open Questions

1. **Should the picker screen keep any read from `usePositions`/`useGex` at all?**
   - What we know: D-02b says candidates are hypothetical/view-only with no broker positions. The
     UI-SPEC's GEX-fit why-panel sentence references "the fixture's static GEX snapshot... NOT
     re-fetched live" — implying the picker's GEX numbers come from the frozen fixture, not
     `useGex()`.
   - What's unclear: Whether the picker screen needs `useGex()` at all (e.g., to show a live GEX
     rail elsewhere on the screen) or whether it is 100% fixture-driven with zero live data hooks.
   - Recommendation: Default to zero live-data hooks in the picker screen this phase (matches
     "contract-first, fixture-only" framing most literally); if the UI-SPEC's layout implies a
     live GEX context strip, the planner should verify against `18-UI-SPEC.md`'s exact panel list
     (it lists only "Suggested calendars," "Risk profile," "Scoring methodology," "Why this
     calendar," "Term structure + your legs," "Entry / exit plan" — no live GEX rail is named,
     supporting zero live hooks).

2. **Does `bookGreekStrips`/`heatmapCells` staying unused in `repriceScenario`'s output for the
   picker's single-position case need any pruning?**
   - What we know: D-02/D-04a say "no second payoff code path" and "delete-if-orphaned only" for
     shared helpers, not for output fields within a still-used function.
   - What's unclear: Whether leaving `bookGreekStrips`/`heatmapCells` computed-but-unrendered in
     the picker's `repriceScenario` call is acceptable overhead, or whether the planner should add
     a lighter picker-specific variant.
   - Recommendation: Leave it — `repriceScenario` is a single well-tested function reused by both
     Overview and the picker; adding a second entry point risks exactly the code-path duplication
     D-02 forbids. The computational cost (a few extra array builds) is negligible for a
     client-side single-candidate call.

## Environment Availability

Skipped — this phase has no external tool/service dependencies beyond already-installed workspace
packages (no new CLI, database, or API dependency is introduced; `zod`/`visx`/`fast-check`/`vitest`
are already present and already used in the exact patterns this phase needs).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (`vitest.config.ts` at repo root, `test.projects` glob over `packages/*/vitest.config.ts` + `apps/*/vitest.config.ts`) |
| Config file | `packages/contracts/vitest.config.ts` (contract/fixture tests), `apps/web/vitest.config.ts` (adapter + component tests) |
| Quick run command | `bunx vitest run packages/contracts/src/picker.test.ts` (contract), `bunx vitest run apps/web/src/lib/candidate-to-position.test.ts` (adapter) |
| Full suite command | `bun run test` (root — runs every `vitest.config.ts` project) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANLZ-01 | `pickerCandidate` schema parses the frozen fixture's oracle payload; rejects a malformed breakdown entry | unit (oracle-payload, mirrors `gex.test.ts`) | `bunx vitest run packages/contracts/src/picker.test.ts` | ❌ Wave 0 |
| ANLZ-01 | Card breakdown bars render from `candidate.breakdown` filtered by `criterion` name, never a hard-coded index | component (`@testing-library/react`) | `bunx vitest run apps/web/src/screens/Analyzer.test.tsx` | ❌ Wave 0 (full rewrite) |
| ANLZ-01 | Guard-case candidate (`fwdIv: null`) renders `n/a` caption, zero-width bar, no throw/NaN | component | same as above | ❌ Wave 0 |
| ANLZ-02 | `candidateToAnalyzerPosition` produces a position whose expiration-curve worst case does not exceed `debit` (the debit-equals-max-loss invariant, Pitfall 1) | unit + fast-check property (numRuns ≥ 100) | `bunx vitest run apps/web/src/lib/candidate-to-position.test.ts` | ❌ Wave 0 |
| ANLZ-02 | `PayoffChart` renders `compareCurve` as a dashed amber single line when supplied; renders nothing extra when `compareCurve` is `null`/absent (`Overview.tsx` regression) | component | `bunx vitest run apps/web/src/components/charts/PayoffChart.test.tsx` | ❌ Wave 0 additions to existing file |
| ANLZ-02 | `expectedMoveBand` ticks render at `spot ± em`, at the zero-P&L y-position, and never occlude the curve layers (z-order) | component (assert SVG element ordering) | same as above | ❌ Wave 0 additions |
| ANLZ-03 | Why-panel forward-edge sentence branches correctly on `fwdEdge > 0` vs guard case | component | `bunx vitest run apps/web/src/screens/Analyzer.test.tsx` | ❌ Wave 0 |
| ANLZ-03 | Entry/exit plan card computes `debit × profitTargetPct`/`debit × stopPct` correctly and formats `manageShortDte`/`closeByExpiry` | unit | same as above | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** run the specific new/changed test file's quick command above.
- **Per wave merge:** `bun run test` (full suite) + `bun run typecheck` + `bun run lint`.
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus a manual check that
  `Overview.tsx`'s existing `PayoffChart`/`repriceScenario` call sites are untouched (no diff in
  `Overview.tsx` beyond, at most, stale-comment cleanup referencing `AdHocPicker`).

### Wave 0 Gaps
- [ ] `packages/contracts/src/picker.ts` + `picker.test.ts` — the schema does not exist yet.
- [ ] `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` — the frozen fixture does
  not exist yet (needs the 6-8 real candidates + 1 guard-case candidate per D-03/D-03a).
- [ ] `apps/web/src/lib/candidate-to-position.ts` + `.test.ts` — the adapter does not exist yet;
  this is the genuinely untested numerical surface this phase introduces (Pitfall 1).
- [ ] `PayoffChart.test.tsx` needs new test cases for `compareCurve`/`expectedMoveBand` — the
  existing file/framework/conventions are otherwise sufficient (no new test infrastructure).
- [ ] `Analyzer.test.tsx` needs a full rewrite (all 7 existing test blocks assert retired behavior).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged — `useAuthSession()`/Supabase session gate in `App.tsx` is untouched by this phase; no new auth surface |
| V3 Session Management | No | Same as above |
| V4 Access Control | No | The `/analyzer` route's access control is identical before/after (same session-gated `<ErrorBoundary>` wrapper in `App.tsx`); no new server endpoint is added this phase (Phase 19 adds the real API route) |
| V5 Input Validation | Yes | `packages/contracts`' `pickerCandidate` Zod schema is the input-validation boundary for whatever the fixture (this phase) or the real API (Phase 19) provides — `.parse()` at the point of use, matching every existing contract module's pattern |
| V6 Cryptography | No | No cryptographic operation in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/incomplete fixture data silently rendering wrong numbers (e.g., a missing `exitPlan` field defaulting to `undefined` and producing `NaN` in the plan card) | Tampering (data integrity, not adversarial — but same mitigation) | Zod `.parse()` (not `.safeParse()` silently ignored) on the fixture at import/test time so a malformed fixture fails the test suite, never reaches render |
| A future live API response (Phase 19) not matching the frozen schema, causing a runtime crash in production | Tampering / Denial of Service | Same Zod schema enforced at the Phase-19 API boundary — this phase's contract-first authoring is itself the mitigation, provided Phase 19 actually parses against `pickerCandidate` rather than trusting the engine's raw output |
| Client-side-only "hypothetical position" data being mistaken for a real broker position downstream (e.g., accidentally wired into a future order-placement flow) | Spoofing / Repudiation | `AnalyzerPosition.live: false` for every candidate-derived position (matches D-02b's "hypothetical/view-only" framing) — no code path in this phase writes candidate-derived positions anywhere persistent |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/18-analyzer-picker-ui-redesign/18-CONTEXT.md` — locked decisions D-01 through
  D-06, canonical refs (read in full this session)
- `.planning/phases/18-analyzer-picker-ui-redesign/18-UI-SPEC.md` — verified visual/interaction
  contract, guard-case render table (read in full this session)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — ANLZ-01/02/03 scope, project decision log
  (read in full this session)
- `.claude/rules/architecture-boundaries.md`, `.claude/rules/tdd.md`, `.claude/rules/typescript.md`
  — mandatory project rules (read in full this session)
- `.planning/research/calendar-selection-criteria.md` — verified SPX put-calendar scoring criteria,
  REFUTED list (read in full this session)
- `packages/contracts/src/gex.ts`, `analytics.ts`, `gex.test.ts`, `jobs.ts`, `index.ts` — existing
  contract-module conventions, `.refine()` precedent, nullable/enum-tag idiom (read in full this
  session)
- `apps/web/src/lib/scenario-engine.ts`, `scenario-engine.test.ts` — `repriceScenario`,
  `AnalyzerPosition`, `bookPL`, `buildScenarioStrip`, and their FULL existing test coverage (read
  in full this session — this is the source of Summary finding #1)
- `apps/web/src/screens/Analyzer.tsx` — `calendarToAnalyzerPosition`, `CalendarGroup` usage,
  `ScenarioPanel`/`BookGreeksTable` inline components (read relevant sections this session — source
  of Summary finding #2)
- `apps/web/src/lib/pair-calendars.ts` — `CalendarGroup`, `pairPositionsIntoCalendars` type shape
  (read this session)
- `apps/web/src/components/charts/PayoffChart.tsx` — full `PayoffChartProps` interface, z-order
  comment, existing additive-prop precedent (read this session)
- `apps/web/src/App.tsx` — route wiring confirmation (read this session)
- `mockups/playground-v4.html` — `buildCandidates()`, `fwdIV()`, scoring formula, `beWidth()`,
  `renderPlan()` full source (read this session — source of Summary finding #3)
- `package.json`, `packages/contracts/package.json`, `apps/web/vitest.config.ts`,
  `vitest.config.ts` (root) — dependency/version/test-framework verification via direct file read
  and `grep` (this session)

### Secondary (MEDIUM confidence)
- None — every claim in this document traces to a file read or grep run this session against the
  actual repository state, not to external web sources (this phase's domain is entirely internal
  codebase conventions plus already-locked CONTEXT/UI-SPEC decisions).

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency confirmed already-installed via direct file read, zero
  new packages needed
- Architecture: HIGH — every pattern (contract module, additive props, adapter function) is
  grounded in an existing, working precedent read in full this session
- Pitfalls: HIGH — three of four pitfalls were discovered by directly reading code that
  contradicted CONTEXT.md's own prose (repriceScenario test coverage, the private
  `calendarToAnalyzerPosition` function, the mockup's literal 5th score term)

**Research date:** 2026-07-04
**Valid until:** 30 days (stable internal-codebase domain; no fast-moving external dependency)
</content_placeholder>
