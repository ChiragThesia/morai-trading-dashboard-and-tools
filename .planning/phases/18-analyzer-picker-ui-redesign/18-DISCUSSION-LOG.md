# Phase 18: Analyzer → Picker UI Redesign - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 18-analyzer-picker-ui-redesign
**Areas discussed:** Contract shape, Payoff compute, Fixtures, Old Analyzer disposition, wrap-up

---

## Contract shape (PickerCandidate schema)

| Option | Description | Selected |
|--------|-------------|----------|
| Rich, display-complete | Candidate carries score + structured per-criterion breakdown array + greeks + debit + fwdIV + slope + fwdEdge + EM + event flags + legs. UI near pure-render; engine sole authority. | ✓ |
| Minimal legs + score | Candidate carries legs + strike + total score; UI recomputes greeks/debit/breakdown client-side. Leaks scoring logic into frontend. | |

**User's choice:** Rich, display-complete
**Notes:** Contract-first lock — Phase 19's engine must emit exactly this shape, fixtures satisfy it. fwdIV nullable + guard-tagged (mirrors Phase-19 radicand-guard requirement); exit plan folded into contract as `exitPlan` object (rich-contract consistent).

---

## Payoff compute (risk profile / ⊕-compare / EM band / scenario strip)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse scenario-engine | Adapt candidate legs → AnalyzerPosition, feed the SAME repriceScenario/bookPL + Phase-17 PayoffChart. Contract carries legs, not curve points. | ✓ |
| Contract-provided curve | PickerCandidate ships precomputed payoff points; UI plots them. Second payoff path diverging from scenario-engine; bloats contract/fixtures. | |

**User's choice:** Reuse scenario-engine
**Notes:** Candidates are hypothetical/view-only; the adapter builds a throwaway `included:true` position purely to draw the curve. Single ⊕-compare candidate by default (matches mockup CMP).

---

## Fixtures (contract-first stand-in until Phase-19 engine)

| Option | Description | Selected |
|--------|-------------|----------|
| Freeze mockup's real candidates | Port the exact 6-8 candidates playground-v4 computes over the real 2026-07-01 chain into a static typed fixture. Shipped UI matches approved mockup; no scoring logic in app. | ✓ |
| Small synthetic set | Hand-author 3-4 fake candidates covering display edge cases. Less realistic; deliberate branch coverage. | |
| Fixture generator | Port buildCandidates() into a fixture builder. Most 'real' but re-implements scoring in UI — what contract-first avoids. | |

**User's choice:** Freeze mockup's real candidates
**Notes:** Only the mockup's OUTPUT is captured, not `buildCandidates()` logic. Add one guard-case candidate (inverted structure → fwdIV null) to exercise the UI's null-FwdIV branch.

---

## Old Analyzer disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Full replace, retire tools | Analyzer route becomes picker-only. Drop paste/roll-sim/ad-hoc/sliders — Overview owns book payoff, Positions owns legs. Cleanest. | ✓ |
| Replace but keep ad-hoc greeks | Picker takes the route; preserve only ad-hoc greeks lookup. | |
| Keep old Analyzer too | Add picker as new route; leave position-analyzer intact. Larger surface, duplication. | |

**User's choice:** Full replace, retire tools
**Notes:** Delete-if-orphaned only for shared helpers — repriceScenario/AnalyzerPosition/PayoffChart stay (Overview + picker use them); remove only code unreferenced after the picker lands (e.g. rollScenario, parseTosOrder). Verify callers before deleting.

---

## Wrap-up (3 smaller items)

| Option | Description | Selected |
|--------|-------------|----------|
| Default them, write context | Accept defaults: 4 card bars from the breakdown array, exitPlan in contract, one guard-case fixture. Write CONTEXT.md now. | ✓ (no response — proceeded on recommendation) |
| Discuss the 3 items | Go deeper on card bars / exit-plan placement / guard-case. | |

**User's choice:** No response after 60s — proceeded on the recommended defaults (low-risk, reversible at UI-spec/plan time).
**Notes:** Card renders the mockup's 4 primary bars (slope/fwd-edge/GEX-fit/event-adj) from the structured breakdown array; the 5th score term (BE-vs-EM) surfaces in why-panel/scenario strip, not as a card bar.

## Claude's Discretion

- Exact card/why-panel/term-structure layout, spacing, tokens (defer to `gsd-ui-phase` UI-SPEC — phase has UI hint) against playground-v4 variant B + MORAI design system.
- ⊕-compare cardinality — default single; multi-overlay only if trivially free.
- Exact Zod field names / contract module location under `packages/contracts`.
- Specific inverted-structure numbers for the guard-case fixture candidate.

## Deferred Ideas

- Real `scoreCalendarCandidates` engine + `/api/picker/candidates` + `get_picker_candidates` MCP + economic-events adapter — Phase 19 (PICK-01..03).
- Variant A (screener table) — not selected.
- Screener filters (strike-view buttons, DTE range as user filter) — Phase 19+ once live candidates exist.
- In-house backtest of slope signal over leg_observations; threshold calibration — research backlog.
