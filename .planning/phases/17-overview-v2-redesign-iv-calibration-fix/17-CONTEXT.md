# Phase 17: Overview v2 Redesign + IV Calibration Fix - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning — decisions below are **recommended defaults** (Claude's discretion; user was away during discussion). Review/override before `/gsd-plan-phase 17`.

<domain>
## Phase Boundary

Ship the payoff-centered "TOS dock" Overview (variant B) to prod, and calibrate its T+0 scenario
curve to each position's live-mark IV via bisection instead of a flat guess.

**In scope:** the Overview screen redesign to the `overview-v2.html` layout (payoff hero +
breakevens + T+0/@exp scenario strip, docked positions table, right GEX rail, pill header) and
the per-position IV-calibration fix in the scenario engine (bisection, mid-price, tagged
non-convergence result).

**Out of scope (own phases):** Analyzer/picker redesign (Phase 18), picker scoring engine +
economic events (Phase 19), the three-state LIVE/QUIET/STALLED stream watchdog (Phase 20). Phase
17 surfaces staleness with a timestamp + simple age threshold only — NOT the watchdog state machine.
</domain>

<decisions>
## Implementation Decisions

> All decisions are Claude's recommended defaults, grounded in the mockup, OVW-01/02, research
> Pitfall 4, and existing code. Each is an override point — not a locked user choice.

### IV calibration & non-convergence (OVW-02)
- **D-01:** Calibrate per-position IV by bisection against the **mid** price (never raw bid/ask),
  with a hard iteration cap and convergence tolerance; on cap/failure return a tagged
  `Result<T,E>` "did-not-converge" — never the last iterate, never a flat `DEFAULT_IV`. (Research
  Pitfall 4; mirrors existing BSM `Result` discipline.)
- **D-02:** **Non-convergence display** — for a leg whose IV does not converge, do NOT draw a
  fabricated T+0 curve for that position. Still draw its **@exp** curve (intrinsic value — needs
  no live IV) and mark the position's row/curve with a visible "IV n/a — did not converge" badge.
  The net-book T+0 aggregate excludes that position and flags itself partial (e.g. "T+0 excludes
  1 position: IV n/a") rather than silently mixing a guess in.

### Staleness surfacing (OVW-02)
- **D-03:** Two-channel staleness: **always show the source timestamp** (live mark "as of HH:MM",
  GEX snapshot time) AND tint **amber when clearly stale**. Recommended thresholds: live mark amber
  when age > 5 min (covers a stalled stream and outside-RTH); GEX amber when its snapshot age
  exceeds its refresh cadence (~> 45 min). Outside RTH / no live mark: freeze to the last mark,
  label it, tint amber — do not blank the payoff.
- **D-04:** Phase 17 does the simple timestamp+threshold only. The honest three-state
  LIVE/QUIET/STALLED badge is Phase 20 — do not build the watchdog here.

### Payoff scope & interactivity (OVW-01)
- **D-05:** The payoff hero is the **net book** (all positions aggregated) — matches OVW-01's "net
  book greeks" + "book P&L" + docked positions table. Add a **light per-position highlight**:
  hovering/selecting a row in the docked table highlights that position's contribution (dims
  others). No modal drill-down (kept out of scope — a heavier interaction is a later idea).

### Scenario strip levels (OVW-01)
- **D-06:** The T+0/@exp strip uses a **bounded key set**, not every strike: GEX put wall / gamma
  flip / spot / call wall, plus each position's short/long strikes (deduped, sorted, capped to a
  readable count). Not the full chain.
- **D-07:** For a multi-expiry / calendar book, the **"@exp" column uses the FRONT (nearest)
  expiry** — the first decision/roll point — and shows that expiry date in the header.
  scenario-engine already models `frontDte`.

### Claude's Discretion
- Exact amber thresholds (D-03), the strike-count cap (D-06), and bisection tolerance/iteration
  cap (D-01) are tuning knobs — pick sensible values in planning; expose as constants.
- Whether calibration runs client-side (in `scenario-engine.ts`) or is delivered pre-calibrated
  from the server is an architecture question for research/planning — the port is what matters.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/ROADMAP.md` §"Phase 17" — goal + 2 success criteria (TOS-dock layout; IV-calibrated T+0)
- `.planning/REQUIREMENTS.md` — OVW-01 (layout), OVW-02 (IV calibration + stale-GEX timestamp)

### Design contract
- `mockups/overview-v2.html` — the approved variant-B "TOS dock" layout (the visual source of truth)
- `mockups/gex-profile.json`, `mockups/gex-snapshot.json` — GEX rail data shape references

### Research / pitfalls
- `.planning/research/PITFALLS.md` §"Pitfall 4" — bisection IV solver hangs/garbage on deep-ITM/
  illiquid legs; mid-price convention; tagged non-convergence; property-test ATM/ITM/OTM/near-zero-vega
- `.planning/research/PITFALLS.md` §"Pitfall 1" — stale/partial snapshot must self-declare (feeds D-03)

### Existing code to build on / modify
- `apps/web/src/lib/scenario-engine.ts` — current T+0/@exp engine; takes FLAT `frontIv`/`backIv`
  per leg (`calendarNetPrice`) — this is the DEFAULT_IV path OVW-02 replaces
- `apps/web/src/screens/Overview.tsx` — current Overview screen (redesign target)
- `apps/web/src/components/charts/PayoffChart.tsx` — existing payoff chart to reuse/extend
- `packages/quant/` — BSM engine; the IV-inversion (price→IV bisection) core module lives/belongs here
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scenario-engine.ts` (`calendarNetPrice`, `entryNetPrice`, T+0/@exp curve builders) — extend to
  accept calibrated per-leg IV instead of flat `frontIv`/`backIv`.
- `PayoffChart.tsx` — existing chart component; the payoff hero builds on it.
- `packages/quant` BSM engine — the bisection IV inverter pairs with the existing `bsmPrice`.

### Established Patterns
- `Result<T,E>` discipline (no `any`/`as`/`!`, Zod parsing) — the tagged non-convergence result
  follows the same pattern already used across core.
- Staleness-timestamp surfacing already exists elsewhere (chain `observedAt`, GEX snapshot time) —
  reuse the convention, don't invent a new one.
- fast-check property tests already back the BSM engine — extend to the IV calibrator (Pitfall 4).

### Integration Points
- Overview consumes `/api/status` (pill header: netγ/flip/VIX/VVIX/DFF/10y2y/COT/book P&L) + GEX +
  positions + live greeks (streamer). The IV calibration slots into the scenario engine's per-leg
  IV input.
</code_context>

<specifics>
## Specific Ideas

- The layout is not open-ended: `mockups/overview-v2.html` is the design contract. Match it;
  deviate only where real data forces it (and record why).
- "TOS dock" = Thinkorswim-style docked layout: payoff hero on top, positions docked below, GEX
  rail right, dense pill header.
</specifics>

<deferred>
## Deferred Ideas

- Three-state LIVE/QUIET/STALLED stream-health badge → **Phase 20** (WATCH-01). Phase 17 uses
  timestamp + simple age threshold only.
- Per-position payoff drill-down modal / isolated single-position analyzer → later (Analyzer is
  Phase 18; a dedicated drill-down is its own idea).
- Full-chain scenario strip (every strike) → rejected as clutter; bounded key set chosen (D-06).

### Reviewed Todos (not folded)
- 2 pending todos weakly matched phase 17 (both "Untitled", scores 0.6 / 0.2) — not folded; too
  vague to scope. Review `.planning/todos/pending/` manually if they're meant for this phase.
</deferred>

---

*Phase: 17-overview-v2-redesign-iv-calibration-fix*
*Context gathered: 2026-07-03*
