# Overview Tab — Layout Redesign Proposal

Ad-hoc layout research (not a phase UI-SPEC). Decision-ready. No implementation.

## Problem restated

Overview grew by stacking full-width sections; market context and exit verdicts both
sit below the fold, and verdicts are divorced from the positions they judge. User wants:
(1) verdicts **next to the calendars in the positions queue**, (2) market data **not pushed
down**, (3) **use the left side** for macro/regime "where is the market", (4) researched UX.

## What the code already gives us (reuse, don't rebuild)

- `PositionsTable` rows key on `cal.key = ${underlyingSymbol}|${strike}|${type}`; row `label` = `${strike}${optionType}` (e.g. `7000P`). Already has hover/select highlight + row `<td>` grid → a verdict column is a natural 9th cell.
- `HeldPositionsPanel` already renders the per-calendar verdict badge (`verdictLabel`/`verdictColorClass`), CHANGED marker, rule+metric line, roll detail, as-of dot. Its row body is exactly the "expanded" detail for an in-table verdict.
- `RegimeBoard` is self-contained: 4 banded regime pills + GateChip + rates row, all pill-shaped, own loading/error/empty. `CotCard`, `SystemHealth`, `GexRail` are likewise drop-in.
- `Panel`/`SectionLabel`/`MetricChip`/`Stat` molecules cover any new container — no new atoms.

## The join (required for verdict-in-row) — see §Join design below. Additive backend change needed.

---

## Option A — Left context rail + verdict-in-row (Bloomberg Launchpad shape) — cost **L**

```
┌───────────────────────── sticky pill strip (SPX · γ · flip · VIX · book) ─────────────────────────┐
├──────────────┬─────────────────────────────────────────────────────────┬──────────────────────────┤
│ MARKET (280) │ RISK PROFILE — combined book                            │ GEX RAIL (320)           │
│ Entry gate   │  [ payoff chart + date/series controls + level strip ]  │  Dealer γ profile        │
│ Regime pills │                                                         │  GEX by strike           │
│  (2×2)       ├─────────────────────────────────────────────────────────┤  Key levels              │
│ Rates row    │ POSITIONS            [live]        Exit rules ▸ popover  │  Net book greeks         │
│ COT mini     │  ☑ Pos  Exp/DTE  Net  P&L  Δ Γ Θ V  │ VERDICT ◄─ joined  │                          │
│ ─────────    │  ☑ 7000P …                          │ STOP −25% ● CHG   │                          │
│ System health│  ☑ 6800P …                          │ HOLD              │                          │
│              │  Net · 2/2                          │                    │                          │
└──────────────┴─────────────────────────────────────────────────────────┴──────────────────────────┘
```
- **UX rationale:** persistent left + right rails is the pro-trader convention — Launchpad keeps "at-a-glance" context always beside the work, never scrolled away ([Bloomberg UX](https://www.bloomberg.com/ux/2017/11/10/relaunching-launchpad-disguising-ux-revolution-within-evolution/)). Market context lands in the F-pattern's left vertical stripe, the highest-attention zone after the top bar ([NN/g F-pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/)). Verdicts sit in the same row as the position, matching TOS Position Statement where each line item carries its own status/actions inline ([TOS Position Statement](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Monitor/Activity-and-Positions/Position-Statement)).
- **Exit rules** ladder → popover off a header `▸` button (reference list, not live). Row-expand reveals the `HeldPositionsPanel` detail (rule + metric + roll + as-of).
- **Mobile (<1024px):** rails collapse to stacked accordions — order: pill strip → Market (open) → Risk profile → Positions+verdict → GEX (collapsed).
- **Cost L:** three-column responsive shell, new `MarketRail` composing existing panels, verdict column + join, exit-rules popover. Center ≈ 880px on the 1480 canvas — payoff chart + 9-col table both fit.

## Option B — Verdict-in-row + top-strip enrichment, no new rail — cost **M**

```
┌ sticky strip: SPX γ flip VIX … │ GATE:OPEN │ VVIX● TERM● SKEW● BREADTH● (regime dots) ┐
├──────────────────────────────────────────────────────┬──────────────────────────────┤
│ RISK PROFILE hero                                      │ GEX RAIL (320)               │
├──────────────────────────────────────────────────────┤  (unchanged)                 │
│ POSITIONS + VERDICT column   Exit rules ▸              │                              │
└──────────────────────────────────────────────────────┴──────────────────────────────┘
   ↓ below fold: COT + full Regime board (detail) · Book & system
```
- **UX rationale:** cheapest path to intents 1+2 — gate + regime *summarised* as dots/chips in the always-visible sticky strip, full detail still below. Verdict-in-row identical to A.
- **Honest weakness:** contradicts intent 3 ("left side"), and the strip can't hold 4 rich regime pills (each is label+ⓘ+band+value+asof) without breaking — you get lossy dots, and users must scroll for the real board. Market is *summarised* high but not *present* high.
- **Mobile:** strip wraps; sections stack. **Cost M:** verdict column + join + strip chips; no rail.

## Option C — Single left MARKET rail merging GEX (two-column) — cost **L**

```
┌──────────────────────── sticky pill strip ────────────────────────┐
├────────────────────────┬───────────────────────────────────────────┤
│ MARKET (340)           │ RISK PROFILE — combined book (wide)        │
│ Entry gate + regime    │  [ payoff hero, more width ]               │
│ Rates · COT mini       ├───────────────────────────────────────────┤
│ Key levels             │ POSITIONS + VERDICT column   Exit rules ▸  │
│ Dealer γ ▸ / bars ▸    │                                            │
│ System health          │                                            │
└────────────────────────┴───────────────────────────────────────────┘
```
- **UX rationale:** one consolidated "where is the market" rail (regime + rates + COT + GEX key levels) on the left, freeing a single wide main column for hero + positions. Honors intent 3 strongly; GEX gamma-profile/bars demote to expand-on-demand ([NN/g progressive disclosure](https://www.nngroup.com/videos/progressive-disclosure/)).
- **Honest weakness:** rail gets tall (regime + rates + COT + levels + charts) → in-rail scroll; charts are cramped at 340 vs today's dedicated 320 rail. Merges two mental models (dealer-structure vs macro-regime) into one column.
- **Cost L:** relocate+merge GEX into left rail, progressive-disclose charts, verdict column + join.

---

## Recommendation — **Option A** (dedicated left context rail, keep the GEX right rail)

It is the only option that satisfies all four intents without compromise: market context is
**present** (not summarised) and **persistent** on the left where the F-pattern eye lands first;
verdicts are **in the position row** exactly as TOS does it; the risk-profile hero keeps its own
prominent center slot; exit-rules ladder demotes cleanly to a popover. It also maps 1:1 onto
existing components — `MarketRail` is just `GateChip`/regime pills + `RateChip` row + a COT mini +
`SystemHealth`, all already built. The GEX right rail stays untouched (lowest-risk).

Trade-off accepted: two rails on a 1480 canvas leave ~880px center. Verified fine — the payoff
chart already renders in that width and the positions table is 8 columns + one compact verdict
badge. If center ever feels tight, the GEX right rail is the collapsible one (dealer structure is
reference-grade), not the market-context left rail.

Take Option B only if the additive contract change or three-column work must be deferred — it ships
verdict-in-row now and enriches the strip, leaving the left-rail idea for a follow-up.

## Join design (verdict-in-row) — additive contract change

**Today:** `heldPositionVerdict` carries `calendarId` (opaque journal id) + `name` (free string
like `"7000P calendar"`) — no structured strike/type. Positions rows key on
`${underlyingSymbol}|${strike}|${type}`. No deterministic shared key exists → a `name`-string match
is fragile. So an additive field is required.

**Change (additive, no migration — read-side derived):**
- `packages/contracts/src/exits.ts` → `heldPositionVerdict`: add `strike: z.number()`, `optionType: z.enum(["C","P"])`. (Optional hardening: `underlyingSymbol: z.string()` to survive the SPX/SPXW root split — but the book is single-underlying SPX, so strike+type is already unique per positions row.)
- `packages/core/.../exits/application/ports.ts` `HeldPositionVerdict` + `getExitAdvice.ts` mapping: populate the two fields from the journal calendar it *already* reads to derive `name`/`pnlPct`/`basis`. Pure read-time addition; persisted JSONB blob unchanged.

**Matching rule (FE, in `Overview`):**
`verdictByRowKey = new Map(exits.positions.map(v => [`${v.strike}${v.optionType}`, v]))`, look up per
positions row by its `label` (`${strike}${optionType}`). Deterministic, root-agnostic, no fuzzy match.

**Unmatched handling:** a verdict with no live broker row (e.g. journal calendar just closed) →
render in a small "unlinked verdicts" list under the table — never silently dropped.

**Reuse:** extract `verdictLabel`/`verdictColorClass` from `HeldPositionsPanel` into a shared helper
(or import) for the in-row badge; the row-expand body reuses `HeldPositionsPanel`'s existing row
markup. `HeldPositionsPanel` as a standalone panel then goes away (its content lives in-row + expand).
