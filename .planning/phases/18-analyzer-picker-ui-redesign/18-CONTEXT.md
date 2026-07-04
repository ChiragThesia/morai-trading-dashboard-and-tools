# Phase 18: Analyzer → Picker UI Redesign - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the position-analyzer screen with the **ranked-cards calendar PICKER** — the approved
`mockups/playground-v4.html` **variant B** (ranked cards rail). The system scores *candidate* put
calendars over the chain and presents them; this is the "analyze NEW trade ideas" surface, the
counterpart to the view-only Overview (which shows the real book).

**Contract-first:** the `packages/contracts` picker schema is **authored in this phase** and locked
BEFORE Phase 19's real `scoreCalendarCandidates` engine lands. The UI ships against **typed
fixtures** that satisfy the contract. This decouples UX risk from scoring-correctness risk.

In scope (ANLZ-01/02/03):
- Ranked candidate-cards rail with per-criterion score-breakdown bars (ANLZ-01)
- ⊕-compare overlay on the payoff center, with ±1σ expected-move band + scenario strip (ANLZ-02)
- Why-panel per candidate: term structure with leg dots + forward-vol bracket + event markers,
  plus an entry/exit plan card with +25% / −17.5% defaults (ANLZ-03)

Out of scope (Phase 19+):
- The real `scoreCalendarCandidates` engine, `GET /api/picker/candidates`, `get_picker_candidates`
  MCP — the UI swaps its fixture import for live data with NO layout change later.
- The economic-events adapter (FOMC/CPI/NFP feed). Event flags are fixture data this phase.
- REFUTED criteria (IV-rank gates, −1..−3% IV-diff band, debit-%-of-back band) — never encoded.

</domain>

<decisions>
## Implementation Decisions

### Picker contract shape (ANLZ-01)
- **D-01:** `PickerCandidate` is **rich / display-complete** — the engine (Phase 19) is the sole
  scoring authority; the UI is pure-render, never recomputes scores. The contract carries every
  value the mockup displays:
  - `score` (0–100) + a **structured per-criterion breakdown array** — each entry
    `{ criterion, weight, rawValue, contribution }` so the card bars are data-driven and
    forward-compatible with the engine (not four hard-coded fields).
  - Summary analytics: `debit` (= max loss), net `theta`/`vega`/`delta`, `fwdIV` (nullable),
    `slope`, `fwdEdge`, `expectedMove` (±1σ by front expiry).
  - Per-leg event flags (`fEvts` / `bEvts`) as data.
  - The **two legs** (strike, put/call, front/back expiry or DTE, per-leg IV, qty) — enough to
    reconstruct an `AnalyzerPosition` for the payoff engine (see D-02).
- **D-01a:** `fwdIV` is **nullable + guard-tagged** — an inverted term structure (radicand < 0)
  yields a tagged guard result, never `NaN`. This mirrors the Phase-19 hard requirement so the
  contract shape and the UI's null-FwdIV branch are settled now, not retrofitted. See D-06.
- **D-01b:** Fold the **exit plan into the contract** as an `exitPlan` object
  (`profitTargetPct: 0.25`, `stopPct: 0.175`, `manageShortDte: 21`, `closeByExpiry`). Phase 18
  renders fixed defaults; Phase 19 can compute the close-by date. Rich-contract consistent.

### Payoff / risk-profile compute (ANLZ-02)
- **D-02:** **Reuse the existing `repriceScenario` engine.** Adapt a candidate's legs →
  `AnalyzerPosition[]`, feed the SAME `repriceScenario` / `bookPL` that already powers Overview and
  the (old) Analyzer, and render through the Phase-17 `PayoffChart`. **No second payoff code path.**
  The contract carries **legs, not curve points**.
- **D-02a:** The ⊕-compare overlay, the ±1σ EM band, and the scenario strip all **derive from that
  same engine output** — compare = a second candidate adapted to `AnalyzerPosition[]` and overlaid
  (Phase-17 `PayoffChart` highlight/curve props). EM band uses the candidate's `expectedMove`.
- **D-02b:** Candidates are **hypothetical / view-only** — no broker positions, no editing, no
  simulated-trade persistence. The candidate→`AnalyzerPosition` adapter builds a throwaway
  `included:true` position purely to draw the curve.

### Fixture set (contract-first stand-in)
- **D-03:** **Freeze `playground-v4`'s real candidates into a static typed fixture.** Port the exact
  6–8 candidates the mockup computes over the real 2026-07-01 chain snapshot (spot 7498.85, GEX flip
  7473 / walls 7400·7525 / netγ +26.2B, the real ATM-IV term structure, FOMC 7/29 · CPI 7/14+8/12 ·
  NFP 7/3+8/7 event flags) as fixture DATA that satisfies the D-01 contract. **No scoring logic in
  the app** — the mockup's `buildCandidates()` is NOT ported; only its output is captured.
- **D-03a:** Include **one guard-case candidate** in the fixture (inverted structure → `fwdIV = null`,
  guard tag set) so the UI's null-FwdIV / guard-render path is exercised by a test. See D-06.

### Old Analyzer disposition
- **D-04:** **Full replace.** The Analyzer route becomes **picker-only**. Retire the position-analyzer
  machinery — pasted/synthetic positions, `RollSimulator`, `AdHocPicker` (ad-hoc greeks lookup), the
  spot/days-forward/IV-shift `ScenarioPanel` sliders, `BookGreeksTable`, roll overlay. Rationale:
  Overview (Phase 17.1) now owns book payoff + future-date projection; Positions owns live legs.
  Smallest surface, no duplication.
- **D-04a:** Retiring shared helpers is **delete-if-orphaned only** — `repriceScenario`,
  `AnalyzerPosition`, `PayoffChart`, `pairPositionsIntoCalendars` stay (Overview + the picker use
  them). Remove only code that becomes unreferenced after the picker lands (e.g. `rollScenario`,
  `parseTosOrder` if no other caller). Verify callers before deleting.

### Card breakdown bars (ANLZ-01 display)
- **D-05:** The card renders the mockup's **4 primary bars** — slope · forward-IV edge · GEX fit ·
  event adjustment — read FROM the D-01 structured breakdown array (not hard-coded). The 5th score
  term (BE-vs-EM) stays in the breakdown data and surfaces in the why-panel / scenario strip, not as
  a 5th card bar. Keep the card scannable.

### Claude's Discretion
- **Exact card/why-panel/term-structure layout, spacing, and tokens** — a `gsd-ui-phase` UI-SPEC
  (this phase has `UI hint: yes`) or the planner fixes these against `playground-v4.html` variant B
  and the MORAI design system. Match the mockup.
- **⊕-compare cardinality** — default **single** compare candidate at a time (matches the mockup's
  `CMP`); multi-overlay only if trivially free.
- **Exact contract field names / Zod structure** and the fixture module location under
  `packages/contracts` — planner's call within D-01.
- **D-06:** fixture guard values — the specific inverted-structure numbers for the guard-case
  candidate are the planner's to pick, provided `fwdIV` resolves to the null/guard branch.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 18 entry (goal + ANLZ-01/02/03 success criteria; Phase 19 shows
  what stays out of scope — the engine the contract is authored against)
- `.planning/REQUIREMENTS.md` — Analyzer Redesign section (ANLZ-01/02/03) + Picker Engine (PICK-01
  context for the contract the engine will fill)

### Design target (approved mockup)
- `mockups/playground-v4.html` — **THE design contract for this phase, variant B (ranked cards
  rail).** Header comment documents the real data + which criteria are scored vs refuted. Ported as
  fixture DATA (D-03), not as logic.
- `mockups/overview-v2.html` — sibling surface (context; the picker's nav links to it)

### Scoring research (contract must anticipate; engine implements Phase 19)
- `.planning/research/calendar-selection-criteria.md` — the 8–9 verified criteria + the 6 REFUTED
  ones. Defines what the score-breakdown array (D-01) must be able to represent and what must NEVER
  appear. FwdIV identity + radicand-guard requirement (D-01a/D-06) live here (criterion 1).

### In-repo code (reuse targets + the surface being replaced)
- `apps/web/src/screens/Analyzer.tsx` — the screen being **replaced** (D-04); also the source of the
  `AnalyzerPosition` conversion pattern and `repriceScenario` wiring the picker reuses
- `apps/web/src/lib/scenario-engine.ts` — `repriceScenario` / `bookPL` / `AnalyzerPosition` — the
  payoff engine the picker feeds candidate legs into (D-02); ⚠ `repriceScenario` has no covering test
- `apps/web/src/components/charts/PayoffChart.tsx` — `PayoffChart` + `PayoffChartProps` (Phase-17
  highlight/curve props) — reused to draw the risk profile + ⊕-compare overlay
- `packages/contracts/src/` — where the new picker schema lands (existing pattern: one `*.ts` +
  `*.test.ts` per contract, e.g. `analytics.ts`, `gex.ts`, `journal.ts`; re-export via `index.ts`)

### Rules (mandatory)
- `.claude/rules/architecture-boundaries.md` — contracts import zod + shared only
- `.claude/rules/tdd.md`, `.claude/rules/typescript.md` — red→green, no `any`/`as`/`!`, Zod at
  boundaries, `Result<T,E>`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`repriceScenario` + `AnalyzerPosition`** (`scenario-engine.ts`) — a candidate is expressible as
  one `AnalyzerPosition` (occSymbol/putCall/frontDte/backDte/frontIv/backIv/qty/included); feed it
  straight into the engine. This is the whole payoff/EM/scenario-strip story (D-02) — zero new curve
  math.
- **`PayoffChart`** (Phase-17) — highlight + curve props already support an overlaid comparison
  curve; the ⊕-compare is a second adapted candidate (D-02a).
- **`packages/contracts` per-contract module pattern** — mirror `gex.ts`/`analytics.ts` (Zod schema
  + inferred type + `*.test.ts`, re-exported from `index.ts`) for the picker schema (D-01).
- **`pairPositionsIntoCalendars` / `calendarToAnalyzerPosition`** — the front/back-leg pairing shape
  the candidate→`AnalyzerPosition` adapter can follow.

### Established Patterns
- Client-side, zero-network scenario compute (`useMemo` over `repriceScenario`) — the picker runs
  the same way; the fixture import (later the API query) is the only data source.
- Contract-first: contracts are authored + property/unit-tested independently, then consumed — the
  fixture satisfies the Zod schema so the swap to live data in Phase 19 is import-only, no layout
  change.

### Integration Points
- Picker screen (replacing `Analyzer.tsx`) imports the frozen fixture (typed to the new contract) →
  adapts selected/compare candidates to `AnalyzerPosition[]` → `repriceScenario` → `PayoffChart`.
- New picker schema added to `packages/contracts/src/` + `index.ts` re-export. Phase 19's engine
  output and the `/api/picker/candidates` response both type to it.
- App router: the `/analyzer` route now renders the picker (D-04).

### Constraints
- **Zero new dependencies** (v1.2 lock) — native controls / existing primitives only.
- Contracts layer may import **zod + shared only** (hexagon boundary).
- TDD red→green, no `any`/`as`/`!`, `Result<T,E>`, Zod at boundaries.
- MORAI design system (violet/blue/amber) — the mockup already uses it; the retired 17.1 TOS-neon
  override does NOT apply to the picker.

</code_context>

<specifics>
## Specific Ideas

- The picker IS `playground-v4.html` variant B, made real against a typed fixture. The mockup's real
  data anchors (spot 7498.85, GEX flip 7473 / walls 7400·7525 / netγ +26.2B, the 31-point ATM-IV
  term structure, the FOMC/CPI/NFP event set) become the fixture's baseline so the shipped screen
  reads like the approved mockup.
- Score formula the mockup encodes (for breakdown reference, NOT to re-implement in the app):
  slope (40) + forward-IV edge (25) + GEX fit (15) + event adjustment (10) + BE-vs-EM (10).
- Why-panel copy is candidate-conditional in the mockup (front-rich-vs-forward vs slope-tailwind
  wording; event-premium warning when the front leg spans FOMC/CPI). Fixture must carry enough for
  the UI to pick the right branch.

</specifics>

<deferred>
## Deferred Ideas

- **Real `scoreCalendarCandidates` engine + `/api/picker/candidates` + `get_picker_candidates`
  MCP + economic-events adapter** — Phase 19 (PICK-01..03). The contract authored here is what they
  fill; the UI swaps fixture→live with no layout change.
- **Variant A (screener table)** — the mockup's alternative; not selected. Ranked-cards variant B is
  the approved design.
- **Screener filters** (strike-view all/ATM/put-wall buttons, DTE range as user filter) — mockup
  hints at these; treat as Phase-19+ once live candidates exist. Not required by ANLZ-01/02/03.
- **In-house backtest of the slope signal over `leg_observations`** and threshold calibration
  (BE-vs-EM, θ/vega) — research backlog, not this milestone.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 18-analyzer-picker-ui-redesign*
*Context gathered: 2026-07-04*
