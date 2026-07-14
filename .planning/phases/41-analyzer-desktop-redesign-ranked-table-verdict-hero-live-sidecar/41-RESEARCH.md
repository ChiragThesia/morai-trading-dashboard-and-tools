# Phase 41: Analyzer Cleanup — Research

**Researched:** 2026-07-14
**Domain:** Frontend restructure (React/TypeScript) — no new libraries, no new backend surface. One
existing hook (`useLiveStream`) gains a new consumer (`useAnalyzerModel`).
**Confidence:** HIGH — every finding below is a direct read of the files this phase touches; no
external package research was needed (UI-SPEC already locks "zero new dependency").

## Summary

This phase has one real risk (AUI-07's live-spot wiring) and six mechanical UI-restructure
requirements (AUI-01..06) that the UI-SPEC has already fully specified down to Tailwind classes and
copy strings. The codebase already contains every pattern this phase needs:

- **Live spot seam (AUI-07):** `useOverviewModel.ts` (`apps/web/src/screens/overview-mobile/useOverviewModel.ts:449`)
  already solved this exact problem for Overview in Phase 38 (LIVE-04). `useAnalyzerModel.ts` needs
  the identical one-line seam — `useLiveStream()` called once, `spot = liveStatus === "live" &&
  liveSpot !== null ? liveSpot : (snapshot?.spot ?? 0)` — and it is safe to add a second
  `useLiveStream()` consumer because `Shell.tsx`/`App.tsx` render exactly one of Overview/Analyzer/
  Journal at a time (verified below), so only one `EventSource` is ever open.
- **Table (AUI-01):** Overview's positions `<table>` (`apps/web/src/screens/Overview.tsx:160-372`)
  is the direct precedent for every mechanic the picker table needs — row click, `stopPropagation`
  on the action cell, `border-l-2 border-l-violet` selected styling is new to this table but
  `CandidateCard.tsx`'s `selected ? "border-violet bg-violet/[0.06]" : ...` (line 155) is the exact
  tint UI-SPEC asks to be ported to a `<tr>`.
- **Verdict hero (AUI-02):** `MobileScorecard.tsx` is a near-complete existing implementation of the
  D-02 verdict-hero idiom (score + checklist rows using `scoreStatus`), just flat instead of
  Edge/Risk/Fit-grouped and single-column instead of a 3-column grid. Reuse its row derivation
  logic verbatim; only the grouping/layout is new.
- **Rounding (AUI-04):** exactly 5 call sites use `exactAbs` for Analyzer dollars/vega (3 desktop in
  `Analyzer.tsx`, 2 mobile in `MobileScorecard.tsx`) — all in the "selected candidate context line"
  string. `CandidateCard.tsx` and `WhyPanel.tsx`/`EntryExitPlan.tsx` are already `.toFixed()`-based
  and compliant; UI-SPEC's audit is confirmed complete, no additional call sites found.
- **Term structure (AUI-05):** three numeric-literal edits (`H`, `r`, `opacity`) plus one new
  `label` prop on the existing event `ReferenceLine` — `TermStructureChart.tsx` needs no structural
  change, and because it is imported unchanged by both `Analyzer.tsx` and `AnalyzerMobile.tsx`, the
  fix is automatically shared.
- **Mobile (AUI-06):** UI-SPEC already resolves every mobile row as "no change" or "automatic via
  shared component" except the verdict-hero regrouping — confirmed correct by reading
  `MobileScorecard.tsx`/`AnalyzerMobile.tsx`/`MobileAnalyzerChart.tsx` in full.

**Primary recommendation:** Build AUI-07's live-spot seam first (it's the one piece with a real
correctness risk — reusing 38-04's exact code shape, not inventing a new pattern), then the table
(AUI-01) and verdict hero (AUI-02) as the two structural UI tasks, then the mechanical numeric edits
(AUI-04, AUI-05) as a single low-risk pass, with mobile parity (AUI-06) landing alongside each
desktop task rather than as its own separate plan (per Phase 36 convention — data/logic lives once
in `useAnalyzerModel`, only view JSX forks).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (AUI-01) Ranked table + detail pane.** Candidates become a compact sortable table — one
  row per candidate: score, strikes/dates, debit, Θ/d, key event flag. Clicking a row loads that
  candidate into the center/right detail panels (risk profile chart, term structure, WHY THIS
  CALENDAR, entry/exit plan). Combine/Copy survive as row actions or detail-pane buttons.
- **D-02 (AUI-02) Verdict hero + grouped factors.** One dominant verdict (✓ FAVORABLE / caution /
  skip + score + Θ gate headline), factors clustered under Edge / Risk / Fit groups with existing
  pass/fail marks. Chips die. Verdict wording must stay evidence-honest (no fabricated confidence;
  existing scoring verdicts only). Calibrating banner + dropped-quotes line → quiet ⓘ/footer.
- **D-03 (AUI-03) Sticky layout rebalance.** Center chart + right panels stay usable while the
  table scrolls; no dead columns; page height content-driven.
- **D-04 (AUI-04) Round the numbers.** Dollars whole, greeks ≤2dp, theta/vega ≤1dp across the tab.
  Formatting at display layer only — never mutate stored/computed values.
- **D-05 (AUI-05) Paste-flow polish + term-structure cleanup.** Bigger paste target, clear Analyze
  affordance; term-structure chart taller, clearer short/long leg markers, event chips visually
  tied to curve kinks.
- **D-06 (AUI-06) Mobile friendly.** Every new idiom gets a designed mobile treatment through the
  EXISTING analyzer-mobile tree (Phase 36 conventions: dedicated mobile components behind
  useIsDesktop, useAnalyzerModel shared hook, no dual desktop/mobile branches inside one component).
  Desktop redesign must not degrade mobile; matchMedia/jsdom test discipline per Phase 35/36 LAWs.
- **D-07 (AUI-07) Fully sidecar-driven — EXPLICIT OVERRIDE** of Phase 38's "Analyzer scoring stays
  snapshot-spot (marker-only live)". The Analyzer's marks/spot/risk-profile inputs consume the live
  sidecar stream (useLiveStream seam from 38-04) with honest stale-fallback (quiet/stalled → snapshot
  values + stale badge, catch #26 law). Regime/entry gates still obey DISPLAY-LIVE/GATE-EOD. Never
  let a live tick silently change a stored score's meaning; if the displayed score was computed on
  snapshot data, its as-of says so.

### Claude's Discretion

Table column set/order details, sort affordances, sticky implementation, detail-pane transitions,
ⓘ placement, exact rounding table, mobile fold structure — follow Phase 36/39 conventions and the
design system (Button primitive, BulletGauge idiom, panel chrome).

**RESOLVED by the approved UI-SPEC (rev 2)** — column set/order, sort cycling, sticky mechanism,
rounding table, and mobile fold structure are all now LOCKED contract, not open discretion. See
`41-UI-SPEC.md` for the exact values; this research treats them as fixed and focuses on
implementation seams, not further design choices.

### Deferred Ideas (OUT OF SCOPE)

- Scoring-engine changes (weights, gates, new factors) — engine untouched this phase.
- Overview/Journal styling drift — separate passes.
- Compare mode (2-3 candidates side-by-side) — user chose table+detail instead; revisit only if
  the table proves insufficient.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUI-01 | Ranked sortable table replaces the card rail; row click drives detail panels | Overview.tsx `<table>` precedent (§Table Implementation); `CandidateCard.tsx` selected-tint reuse; `useAnalyzerModel`'s existing `onSelect`/`selectedId`/`combinedIds` state needs zero changes — only the rail's JSX swaps from cards to `<tr>`s |
| AUI-02 | Verdict hero + Edge/Risk/Fit grouped factors replace the chip row | `MobileScorecard.tsx`'s existing verdict-hero-shaped component (§Verdict Hero); `scoreStatus()`/`CHIP_LABELS` reuse, zero new derivation |
| AUI-03 | Sticky/bounded layout — no dead columns | Pure CSS (`max-h-[70vh] overflow-y-auto` + `sticky top-0`) on the existing 3-col grid (`Analyzer.tsx:547`) — no new layout primitive |
| AUI-04 | Dollars whole / greeks ≤2dp / theta ≤1dp everywhere on the tab | Exhaustive 5-call-site `exactAbs` audit (§Rounding Contract) — confirms UI-SPEC's audit is complete |
| AUI-05 | Paste target size, Analyze affordance, taller/clearer term-structure chart | `CandidateRail`'s paste `<input>`/`Button` (`Analyzer.tsx:134-144`); `TermStructureChart.tsx` numeric-literal edits (§Term Structure Chart) |
| AUI-06 | Every new idiom gets a mobile treatment via `analyzer-mobile/` | `AnalyzerMobile.tsx`/`MobileScorecard.tsx`/`MobileAnalyzerChart.tsx` full read (§Mobile Tree) — UI-SPEC's per-row disposition table independently confirmed correct |
| AUI-07 | Analyzer marks/spot consume the live sidecar stream, honest stale-fallback, score provenance never silently swapped | `useOverviewModel.ts`'s LIVE-04 seam (§Live Sidecar Seam) is the exact pattern to port; `LiveStatusBadge`/`PanelHeading badge=` wiring (`Overview.tsx:774-786`) is the exact mount point |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Candidate ranking table (AUI-01) | Browser / Client | — | Pure client-side render of already-fetched `PickerSnapshotResponse.candidates`; sort state is local UI state, never persisted or sent to the API |
| Verdict hero / factor groups (AUI-02) | Browser / Client | — | Re-layout of already-computed `candidate.breakdown`/`candidate.score` — no new computation, no new endpoint |
| Sticky layout (AUI-03) | Browser / Client | — | CSS-only |
| Number rounding (AUI-04) | Browser / Client | — | Display-layer formatting; the underlying `PickerCandidate` domain values are untouched (API/DB unaffected) |
| Paste + term-structure polish (AUI-05) | Browser / Client | — | Existing `TermStructureChart`/paste `<input>` — visual/numeric-literal tuning only |
| Mobile parity (AUI-06) | Browser / Client | — | `analyzer-mobile/` tree, same tier as desktop |
| Live sidecar spot (AUI-07) | Browser / Client | API (SSE fan-out, unchanged) | The `useLiveStream()` EventSource consumer and the live-aware `spot` seam are 100% client-side; the SSE `spot` event itself was built in Phase 38 (API tier) and needs zero changes here — this phase only adds a second client-side *consumer* of an already-shipped stream |

No API, adapter, or database changes anywhere in this phase — confirmed by reading every file the
UI-SPEC references: all are under `apps/web/src/`.

## Standard Stack

### Core

No new libraries. This phase's "stack" is the codebase's own existing primitives:

| Component/Hook | Location | Purpose |
|---|---|---|
| `useLiveStream` | `apps/web/src/hooks/useLiveStream.ts` | SSE stream — `liveSpot`, `status`, badge props (Phase 38, unchanged) |
| Native `<table>` | `apps/web/src/screens/Overview.tsx:160` | Ranked candidate table precedent (AUI-01) |
| `scoreStatus()` | `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts:74` | ✓/~/✗ tier classifier, reused verbatim for the verdict word |
| `LiveStatusBadge` | `apps/web/src/components/LiveStatusBadge.tsx` | LIVE/QUIET/STALLED badge, unchanged component |
| `PanelHeading` (`badge=` slot) | `apps/web/src/components/system/index.tsx:148` | Mount point for `LiveStatusBadge` next to a panel title |
| `Button` (`variant="toggle"`, `size="xs"` default) | `apps/web/src/components/system/Button.tsx` | The ⊕ Combine column button — `size="xs"` needs no explicit prop, it's the default |
| Recharts 3.9.2 | `apps/web/src/components/picker/TermStructureChart.tsx` | Already in use; AUI-05 is numeric-literal tuning, not a new chart |

### Supporting

None — no new supporting libraries.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `<table>` | shadcn `Table` primitive | UI-SPEC already rejected this (Design System table, Registry Safety) — Overview's own precedent means zero new dependency and identical styling conventions; adding a shadcn Table for one screen when a working pattern exists violates the codebase's own reuse-first discipline |
| `useLiveStream()` called a second time in `useAnalyzerModel` | A new shared "live spot" context/provider | Overkill — Overview's own comment (`useOverviewModel.ts:429-432`) already establishes that calling the hook per-model is safe BECAUSE only one screen tree mounts at a time (verified below); a shared provider would be unrequested infrastructure for a problem that doesn't exist |

**Installation:** None — zero `npm install` needed this phase.

**Version verification:** N/A — no new packages.

## Package Legitimacy Audit

**Not applicable.** This phase adds zero new npm packages (UI-SPEC's own Registry Safety section
confirms "No third-party registries. No new dependency of any kind. No new shadcn component"). No
package-legitimacy check was run because there is nothing to check.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              useAnalyzerModel()               │
                    │  (apps/web/src/screens/analyzer-mobile/       │
                    │   useAnalyzerModel.ts — SINGLE shared hook)   │
                    │                                                │
  usePicker() ──────┼─▶ snapshot (30-min picker_snapshot, unchanged) │
  (existing)         │       │                                      │
                    │       ├─▶ sortedCandidates / pastedCandidates  │──▶ Table rows (AUI-01)
                    │       ├─▶ selected / selectedId / combinedIds  │──▶ Row selection state
                    │       └─▶ candidate.score/breakdown (NEVER     │──▶ Verdict hero (AUI-02)
                    │            touched by the live tick — D-07)   │     (snapshot-derived only)
                    │                                                │
  useLiveStream() ──┼─▶ liveStatus / liveSpot  (NEW consumer, AUI-07)│
  (existing hook,    │       │                                      │
   Phase 38)         │       └─▶ spot = live? liveSpot : snapshot.spot│──▶ PayoffChart spot prop
                    │              (LIVE-04 seam, ported verbatim)  │     (T+0 marker only)
                    │       └─▶ liveBadgeProps                       │──▶ LiveStatusBadge
                    │                                                │     (Risk-profile PanelHeading)
                    └─────────────────────────────────────────────┘
                              │                       │
                    AnalyzerDesktop (table+hero)   AnalyzerMobile (cards+stacked hero)
                    Analyzer.tsx                    analyzer-mobile/AnalyzerMobile.tsx
```

A reader can trace the primary use case: `useAnalyzerModel` fans out to BOTH the picker snapshot
(scoring, unchanged) and the live stream (display-only spot/badge, new). The two never cross —
`candidate.score` has no path through `liveSpot`, which is exactly what D-07's "never let a live
tick silently change a stored score's meaning" requires by construction, not by a runtime guard.

### Recommended Project Structure

No new files/folders required — every change lands inside the existing tree:

```
apps/web/src/
├── screens/
│   ├── Analyzer.tsx                       # desktop: rail cards → table; chip row → verdict hero
│   └── analyzer-mobile/
│       ├── useAnalyzerModel.ts            # + useLiveStream() consumer, + live-aware spot, + liveBadgeProps
│       ├── MobileScorecard.tsx            # flat checklist → Edge/Risk/Fit stacked groups
│       ├── AnalyzerMobile.tsx             # unchanged structurally (cards stay cards, D-06 resolution)
│       └── MobileAnalyzerChart.tsx        # + LiveStatusBadge in chrome row
├── components/
│   └── picker/
│       ├── CandidateCard.tsx              # UNCHANGED (still used by both mobile trees)
│       └── TermStructureChart.tsx         # numeric-literal edits only (H, r, opacity, +label)
```

### Pattern 1: Live-aware spot seam (LIVE-04, ported to Analyzer for AUI-07)

**What:** A single derived value that reads `liveSpot` ONLY while `status === "live"`, else falls
back to the existing stored value — never a silent `??` chain that could paint a stale value as if
it were live.

**When to use:** Any number in the Analyzer that is allowed to go live per UI-SPEC (T+0 payoff
spot / any Risk Profile marker). NOT for `candidate.score`/`candidate.breakdown` — those stay
snapshot-derived always (see Pitfall 1 below).

**Example (the exact pattern already proven in production for Overview):**
```typescript
// Source: apps/web/src/screens/overview-mobile/useOverviewModel.ts:449-451 (LIVE-04, Phase 38)
const spot = liveStatus === "live" && liveSpot !== null ? liveSpot : (gex?.spot ?? 5800);
const displaySpot = liveStatus === "live" && liveSpot !== null ? liveSpot : (gex?.spot ?? null);
```

Ported to `useAnalyzerModel.ts`, replacing the current `const spot = snapshot?.spot ?? 0;`
(`useAnalyzerModel.ts:156`):
```typescript
const {
  status: liveStatus,
  liveSpot,
  lastTickAt: liveLastTickAt,
  isRth: liveIsRth,
  hasReceivedFirstTick: liveHasReceivedFirstTick,
  isReconnecting: liveIsReconnecting,
  reconnectNow: liveReconnectNow,
} = useLiveStream();

const spot = liveStatus === "live" && liveSpot !== null ? liveSpot : (snapshot?.spot ?? 0);
```
Return a `liveBadgeProps` object shaped exactly like Overview's (`useOverviewModel.ts:637-644`) so
the desktop tree can spread it straight into `<LiveStatusBadge {...liveBadgeProps} />` with zero
prop-mapping glue.

### Pattern 2: LiveStatusBadge mount point (Risk Profile panel header)

**What:** `PanelHeading`'s `badge` prop is the exact slot Overview already uses for this component.

**Example:**
```tsx
// Source: apps/web/src/screens/Overview.tsx:774-786 (existing production wiring)
<PanelHeading
  title="Positions"
  badge={
    <LiveStatusBadge
      status={liveStatus}
      lastTickAt={liveLastTickAt}
      isRth={liveIsRth}
      hasReceivedFirstTick={liveHasReceivedFirstTick}
      isReconnecting={liveIsReconnecting}
      onReconnect={liveReconnectNow}
    />
  }
  action={/* existing action slot, e.g. Combine button per UI-SPEC Detail Pane Composition */}
/>
```
`Analyzer.tsx`'s "Risk profile" panel currently uses a hand-rolled `<div className="mb-1 flex
items-center justify-between gap-2">` instead of `PanelHeading` (`Analyzer.tsx:557-571`) — the
planner should decide whether to swap to `PanelHeading` (gets the `badge` slot for free) or keep the
hand-rolled div and place the badge inline; UI-SPEC doesn't mandate which, both satisfy the visual
contract identically since `PanelHeading` is just `flex items-center justify-between` internally
(`components/system/index.tsx:160`).

### Pattern 3: Sortable native `<table>` with sticky thead in a bounded Panel

**What:** UI-SPEC's exact mechanism — `Panel` wrapper gets `max-h-[70vh] overflow-y-auto`, `<thead>`
gets `sticky top-0 z-10 bg-panel`. This is standard CSS (`position: sticky` relative to its own
nearest scrolling ancestor, which the `overflow-y-auto` Panel provides) — no library, no known
cross-browser gap for the target browsers (`morai.wtf` traffic is a single desktop operator).

**When to use:** AUI-01's table, exactly as UI-SPEC's Table Contract section specifies.

**Example (adapting Overview's row/selection pattern to sort state):**
```tsx
// Row selection + stopPropagation pattern — Source: apps/web/src/screens/Overview.tsx:189-211
// (existing production code, the exact click/stopPropagation shape to reuse for the new table)
<tr
  onClick={() => onSelectRow(r.key)}   // → onSelect(candidate) for the picker table
  className={cn(
    "cursor-pointer border-b border-line/50 transition-opacity hover:bg-raise/30",
    highlightedRowKey === r.key && "bg-raise/20",   // → violet selected tint per UI-SPEC
  )}
>
  <td onClick={(e) => { e.stopPropagation(); }}>{/* checkbox in Overview; ⊕/× in the picker table */}</td>
  {/* ... */}
</tr>
```
Sort state itself has no existing precedent in this codebase (Overview's table isn't sortable) —
it's genuinely new, but trivial: a local `useState<{ key: "score" | "debit" | "theta"; dir: "asc" |
"desc" }>` with a `useMemo` over `sortedCandidates`/`railCandidates`, matching UI-SPEC's exact cycle
(default score-desc → asc → desc → back to that column's desc). This is Claude's Discretion
territory the UI-SPEC left open ("Table column set/order details, sort affordances ... follow Phase
36/39 conventions") — no existing sort-state hook to reuse, write it inline in `useAnalyzerModel.ts`
or a tiny new `useSortState` local to `Analyzer.tsx` (ladder rung 6/7 — one `useState` + one
`useMemo`, no new file needed).

### Pattern 4: Verdict-hero grouping (lifting MobileScorecard's row logic to 3 columns)

**What:** `MobileScorecard.tsx`'s `scoreItems` derivation (ruleSet-driven with `FALLBACK_SCORE_ITEMS`
fallback) and its per-row `scoreStatus(contribution)` lookup are ALREADY the exact per-criterion
logic AUI-02 needs — only the container changes from a flat `flex flex-col gap-1` list to a `grid
grid-cols-3 gap-4` (desktop) / stacked groups (mobile, unchanged from today's stack since mobile is
already single-column).

**Example:**
```typescript
// Source: apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx:69-77 (existing, reuse verbatim)
const scoreRules = ruleSet.filter((r) => r.kind === "score" && r.status === "active");
const scoreItems =
  scoreRules.length > 0
    ? scoreRules.map((r) => ({ key: r.id, label: CHIP_LABELS[r.id] ?? r.label, weight: r.weight }))
    : FALLBACK_SCORE_ITEMS.map((item) => ({
        key: item.key, label: CHIP_LABELS[item.key] ?? item.label, weight: null,
      }));
```
The NEW piece is a static grouping table (locked in UI-SPEC's Factor groups section) mapping
`criterion` name → `"EDGE" | "RISK" | "FIT"`:
```typescript
const GROUP_OF: Record<string, "EDGE" | "RISK" | "FIT"> = {
  fwdEdge: "EDGE", slope: "EDGE", vrp: "EDGE",
  eventAdjustment: "RISK", beVsEm: "RISK", debitFit: "RISK",
  gexFit: "FIT", deltaNeutral: "FIT", thetaVega: "FIT",
};
```
Filter `scoreItems` by `GROUP_OF[item.key] === "EDGE"` etc. to build each column/stack — no new
data source, pure client-side partition of the already-fetched `scoreItems` array.

### Anti-Patterns to Avoid

- **Recomputing score/verdict from `liveSpot`:** D-07 explicitly forbids this. `candidate.score`
  and every `candidate.breakdown[].contribution` value comes from the stored `PickerSnapshotResponse`
  — there is no client-side scoring function to accidentally re-run; the only risk is a future
  refactor that threads `spot` into `WhyPanel`/`EntryExitPlan`/the verdict hero. Keep `spot` scoped
  to ONLY the `PayoffChart`/`repriceScenario` call path, exactly as it is today (`useAnalyzerModel.ts:235-238,343-351`).
- **A second `sticky` context on the center/right columns:** UI-SPEC explicitly rejects this
  ("No `position: sticky` on the center/right columns is needed ... avoids the known
  sticky-inside-CSS-grid interaction quirks"). Capping ONLY the left column's height is sufficient
  and is the locked contract — don't add sticky to the grid row itself.
- **Reusing `exactAbs`/`usd`/`signedUsd` for Analyzer dollars:** these are the Journal/Overview
  "show the exact broker value" contract (their own locked UI-SPECs). UI-SPEC is explicit that
  reusing them here would "silently regress that law" — write a local `Math.round()`-based
  formatter instead (see Rounding Contract below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sortable/selectable table | A table component/library | Native `<table>` + local `useState` sort | Overview's own precedent proves this scales fine at this row count (17 rows); a table library would be unrequested infrastructure |
| Live/stale badge | A new badge component | `LiveStatusBadge` (unchanged) | Exact component Phase 20/38 already built and hardened (3-state model, cold-start CONNECTING copy-only condition, last-known-good guard) |
| Live-aware value fallback | A new "liveOr" utility function | The 2-line ternary pattern inline (LIVE-04) | It's already a 1-line idiom used in exactly one place per model (`useOverviewModel.ts:449`); a shared utility for a 2-token expression is over-abstraction for one call site (there is exactly one live-eligible value in Analyzer: `spot`) |
| Number rounding | A new `formatMoney`/`formatGreek` shared module | Inline `Math.round()`/`.toFixed()` at each of the 5 call sites | UI-SPEC's own words: "a LOCAL `Math.round()`-based formatter (inline one-liner is enough — ladder rung 6, no new shared helper file justified for one screen)" |

**Key insight:** every "don't hand-roll" risk in this phase already has a working, production-proven
answer inside this same codebase (built in Phases 20/36/38). The work here is porting an existing
pattern to a second screen, not inventing anything new — which is also why the risk profile is low
despite the requirement count.

## Common Pitfalls

### Pitfall 1: Threading `spot`/`liveSpot` into the scoring/verdict path by accident

**What goes wrong:** A future edit passes `spot` (now live-aware) into `WhyPanel`, `EntryExitPlan`,
or the verdict-hero grouping component "for consistency," and the displayed score/verdict starts
silently drifting from what the engine actually computed on the stored snapshot.

**Why it happens:** `spot` becomes a much more prominent/live-feeling value once AUI-07 lands, and
it's tempting to pass "the current spot" everywhere for a unified feel.

**How to avoid:** `candidate.score`, `candidate.breakdown`, `candidate.theta`, `candidate.vega`,
`candidate.debit` are ALL fields already computed server-side and stored in `PickerSnapshotResponse`
— they take zero live inputs today and must take zero live inputs after this phase. Only
`repriceScenario`'s `params.spot` (feeding `PayoffChart`) is allowed to read the live-aware `spot`.
Grep for `spot` usages in the new verdict-hero component during code review — it should not appear.

**Warning signs:** A verdict-hero snapshot test failing intermittently in CI (would indicate spot is
somehow reaching a supposedly-pure render), or the hero's `as of {HH:MM}` footer timestamp updating
on every live tick instead of only on a new `usePicker()` fetch.

### Pitfall 2: `liveSpot` non-null but `liveStatus !== "live"` (stale spot, still displayed)

**What goes wrong:** `liveSpot` is a `useState` that retains its LAST value even after the stream
goes `quiet`/`stalled` (per `useLiveStream.ts`'s "retain last-known-good" convention throughout the
file). A naive `liveSpot ?? snapshotSpot` (missing the `liveStatus === "live"` guard) would keep
showing a frozen live value forever after a disconnect, looking live when it isn't — this is
precisely catch #26 (referenced by both Phase 38's LIVE-04 and this phase's D-07).

**Why it happens:** `liveSpot !== null` alone is NOT sufficient — it only means "a tick arrived at
some point since mount," not "the stream is currently healthy."

**How to avoid:** Always gate on BOTH conditions together, exactly as `useOverviewModel.ts:449` does:
`liveStatus === "live" && liveSpot !== null`. Never drop the `liveStatus === "live"` half.

**Warning signs:** A test that sets `liveSpot` non-null but `status: "stalled"` and expects the
snapshot fallback — if that test doesn't exist yet for the Analyzer seam, it needs writing (mirrors
whatever regression test protects `useOverviewModel`'s spot seam, if one exists — check before
assuming coverage).

### Pitfall 3: A second `EventSource` accidentally opening

**What goes wrong:** If a future change ever mounts Overview and Analyzer simultaneously (e.g. a
side-by-side view, or a portal), calling `useLiveStream()` in both models would open two
`EventSource` connections to the same ticket-minting endpoint.

**Why it happens:** `useLiveStream()` has no built-in singleton guard — its safety today comes ENTIRELY
from the app-level invariant that `Shell.tsx`/`App.tsx` render exactly one of Overview/Analyzer/
Journal at a time (verified: `Shell.tsx:12` `ScreenName = "Overview" | "Analyzer" | "Journal"`,
`App.tsx:43-55` renders one screen keyed by `activeScreen`).

**How to avoid:** Do not change `Shell.tsx`'s single-screen-at-a-time rendering model as part of
this phase. If a future phase ever needs concurrent screens, `useLiveStream` will need an explicit
singleton/context wrapper at that point — out of scope here.

**Warning signs:** Two `ping`/`ticks` SSE connections visible in the Network tab simultaneously.

### Pitfall 4: `sticky top-0` failing silently inside the `overflow-y-auto` Panel

**What goes wrong:** `position: sticky` requires an ancestor chain with no `overflow: hidden`/`auto`
ancestor OTHER than the one it's meant to stick within, and no ancestor with `display: contents` or
certain transform/filter properties breaking the containing block. If `Panel` itself (the shared
system component) has any `overflow` or `transform` set that isn't the literal element the `<thead>`
needs, the sticky effect silently does nothing (no error, just a non-sticky header).

**Why it happens:** `Panel`'s own styling isn't shown in this research (not read in full) — the
planner/executor should verify `Panel`'s own class list doesn't already set `overflow-hidden` or a
transform before assuming `max-h-[70vh] overflow-y-auto` can be added directly to it without
conflict.

**How to avoid:** Read `apps/web/src/components/system/index.tsx`'s `Panel` implementation (line 34)
before wiring AUI-03; if `Panel` already sets an incompatible property, the `max-h-[70vh]
overflow-y-auto` may need to go on an inner wrapper div instead of the `Panel` root.

**Warning signs:** Sticky thead visually not sticking during manual/chrome-devtools UAT.

### Pitfall 5: Test suite migration undercounted

**What goes wrong:** Assuming only `Analyzer.test.tsx`'s obviously-card-related tests need
migration, missing that MANY of its 28 `it()` blocks assert on `data-testid="candidate-card-*"`,
`scoring-checklist`, `checklist-*`, and `scoring-pills` — ALL of which disappear when AUI-01/AUI-02
land. `CandidateCard.test.tsx` (917 lines) tests the CARD component directly and stays fully valid
(it's still used by both mobile trees, UNCHANGED); `MobileScorecard.test.tsx` (160 lines) will need
new group-related assertions added but its existing row-derivation tests stay valid.

**Why it happens:** The rail/hero component names don't change (`CandidateRail`/
`ScoringMethodologyPanel` could keep their names even after their internals become a table/hero), so
a search for "tests that reference the old component name" undercounts — the right search is for the
specific DOM testids (`candidate-card-`, `checklist-`, `scoring-checklist`, `scoring-pills`) that the
locked UI-SPEC retires.

**How to avoid:** Grep `Analyzer.test.tsx` for `data-testid` literal strings before writing the
plan's task list; budget a full-suite pass through this file as its own task, not a side-effect of
the component-rewrite task.

**Warning signs:** `bun run test` green on a stale suite that never actually re-renders the new
table/hero (i.e., tests pass because they're asserting on retired testids that simply don't exist to
fail against — a false-green, matching this codebase's own "green-suite catch" pattern documented
in project memory, most recently catches #26-#29).

## Code Examples

### AUI-04 Rounding Contract — exhaustive call-site enumeration (verified via grep, not UI-SPEC's own audit alone)

```typescript
// Desktop — Analyzer.tsx:577-582 (3 call sites, all exactAbs)
selected.breakdown.length === 0
  ? ` · debit $${exactAbs(selected.debit)}`
  : ` · debit $${exactAbs(selected.debit)} · θ ${selected.theta >= 0 ? "+" : ""}${selected.theta.toFixed(1)}/d · vega +${exactAbs(selected.vega)}`;
// + combined-book summary line:
`+ ${bookCount - 1} more → combined debit $${exactAbs(bookDebit)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${exactAbs(bookVega)}`;

// Mobile — MobileScorecard.tsx:96,99 (2 call sites, same shape)
` · debit $${exactAbs(candidate.debit)} · θ ${candidate.theta >= 0 ? "+" : ""}${candidate.theta.toFixed(1)}/d · vega +${exactAbs(candidate.vega)}`;
`+ ${bookCount - 1} more → combined debit $${exactAbs(bookDebit)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${exactAbs(bookVega)}`;
```
Replace each `exactAbs(X.debit)` with `Math.round(X.debit)` and each `exactAbs(X.vega)`/
`exactAbs(bookVega)` with `X.vega.toFixed(2)`/`bookVega.toFixed(2)` — `theta.toFixed(1)` calls are
ALREADY correct and untouched. No other `exactAbs` call sites exist anywhere under
`apps/web/src/screens/Analyzer*` or `apps/web/src/screens/analyzer-mobile/` (verified by grep across
the whole `apps/web/src` tree, non-test files only).

### AUI-07 — the full useAnalyzerModel wiring diff shape

```typescript
// apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts
import { useLiveStream } from "../../hooks/useLiveStream.ts"; // NEW import

export function useAnalyzerModel(): AnalyzerModel {
  const { data, isPending, isError, refetch } = usePicker();
  const snapshot = data ?? null;
  // ... sortedCandidates unchanged ...

  // NEW — single useLiveStream() consumer (safe: Shell renders one screen at a time)
  const {
    status: liveStatus,
    liveSpot,
    lastTickAt: liveLastTickAt,
    isRth: liveIsRth,
    hasReceivedFirstTick: liveHasReceivedFirstTick,
    isReconnecting: liveIsReconnecting,
    reconnectNow: liveReconnectNow,
  } = useLiveStream();

  // CHANGED — was `const spot = snapshot?.spot ?? 0;`
  const spot = liveStatus === "live" && liveSpot !== null ? liveSpot : (snapshot?.spot ?? 0);

  // ... unchanged: selectedId, combinedIds, pastedCandidates, railCandidates, selected ...
  // ... unchanged: params/scenarioResult/payoffDomain — they already close over `spot`,
  //     so they automatically become live-aware with ZERO further changes (useMemo deps
  //     already include `spot`, see useAnalyzerModel.ts:235-238, 343-351) ...

  return {
    // ...existing fields...
    spot,
    liveBadgeProps: {              // NEW — mirrors useOverviewModel.ts:637-644 shape exactly
      status: liveStatus,
      lastTickAt: liveLastTickAt,
      isRth: liveIsRth,
      hasReceivedFirstTick: liveHasReceivedFirstTick,
      isReconnecting: liveIsReconnecting,
      onReconnect: liveReconnectNow,
    },
  };
}
```

Because `params`/`payoffDomain`/`scenarioResult` in `useAnalyzerModel.ts` already `useMemo` on
`spot` (lines 235-238, 343-351), NO further change is needed for the live spot to reach
`PayoffChart` — the existing memoization chain propagates it automatically. This is the single
biggest reason this requirement is lower-risk than it first appears: the "plumbing" already exists,
only the SOURCE of `spot` changes.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Analyzer spot = snapshot-only (`snapshot?.spot ?? 0`) | Live-aware spot via `useLiveStream` (LIVE-04 pattern) | This phase (AUI-07), pattern established Phase 38 for Overview | Payoff T+0 marker/curve reflects live SPX tick instead of the last 30-min snapshot; explicit user override of the Phase 38 lock that kept Analyzer snapshot-only |
| Flat 11-chip scorecard row | Verdict hero + Edge/Risk/Fit grouped factors | This phase (AUI-02) | Same underlying `scoreStatus()`/breakdown data, restructured presentation only |
| 17-card scroll rail | Sortable ranked table | This phase (AUI-01) | Same `PickerCandidate[]` data, restructured presentation only — no data-shape change |

**Deprecated/outdated:** None — no library or API deprecations touch this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Panel`'s own class list does not already set an incompatible `overflow`/`transform` that would break `sticky top-0` inside it (Pitfall 4) — NOT verified by reading `Panel`'s full implementation in this research session | Common Pitfalls, Pitfall 4 | If wrong, AUI-03's sticky thead silently fails to stick; low severity (visual-only), easy to catch in the phase's own UAT screenshot review, and trivially fixed by moving the `overflow-y-auto` wrapper one level in |
| A2 | No existing regression test protects `useOverviewModel`'s LIVE-04 spot-fallback ternary against the "liveSpot non-null but status stalled" case (Pitfall 2) — this research did not open `useOverviewModel.test.ts` to confirm one way or the other | Common Pitfalls, Pitfall 2 | If a test already exists, the planner can point the new Analyzer test at the same fixture pattern instead of authoring one from scratch; if none exists, this phase should add the first one (for Analyzer) and note the gap for Overview as a follow-up, not silently assume coverage |

**All other claims in this research are `[VERIFIED]`** by direct `Read`/`grep` of the referenced
file and line — this is a codebase-internal research pass with no external package or documentation
lookups (UI-SPEC already locked "zero new dependency," which was independently confirmed rather
than merely trusted).

## Open Questions (RESOLVED)

> Both questions RESOLVED at planning (plan-checker pass 2026-07-14): OQ1 — keep the hand-rolled header div, no PanelHeading swap (41-01/41-02 implement this). OQ2 — sort state stays local to Analyzer.tsx, never the shared hook (41-02 Task 1 implements this).

1. **Does `Analyzer.tsx`'s "Risk profile" panel header get refactored to use `PanelHeading` (gaining
   the `badge=` slot for free), or does the badge get inlined into the existing hand-rolled header
   div?**
   - What we know: Both approaches render identically (`PanelHeading` is just a thin `flex
     items-center justify-between` wrapper around `SectionLabel` + `badge` + `action`,
     `components/system/index.tsx:159-167`); UI-SPEC's Detail Pane Composition section already
     specifies a SECOND button (Combine) landing in this same header, alongside the existing Copy
     button and the new badge.
   - What's unclear: Whether swapping to `PanelHeading` is worth the diff churn vs. keeping the
     hand-rolled div and adding the badge inline (both are ≤5-line changes).
   - Recommendation: Leave as Claude's Discretion for the planner — either is correct, pick whichever
     produces the smaller diff once the Combine-button addition is also accounted for.

2. **Sort-state ownership: `useAnalyzerModel.ts` (shared hook) or local to `Analyzer.tsx` (desktop
   view only)?**
   - What we know: Mobile has NO table (UI-SPEC's Mobile Parity table explicitly keeps
     `CandidateCard` tap-to-select, "no table on mobile" — a deliberate, already-resolved decision,
     not a gap). Sort state therefore has exactly one consumer: the desktop table.
   - What's unclear: Whether the codebase's own convention (Phase 36 D-02: "ALL non-trivial
     state/derivation lives in the model hook") extends to state that only ONE tree will ever read.
   - Recommendation: Keep sort state local to `Analyzer.tsx` (the desktop-only view file), NOT in
     `useAnalyzerModel.ts` — it has zero mobile consumer, so lifting it to the shared hook would
     violate the "single-use code gets no shared abstraction" principle for no benefit. This is a
     deliberate divergence from the D-02 "everything in the model hook" convention, justified by
     sort state's mobile-exclusivity (unlike every other piece of state in that hook, which both
     trees consume).

## Environment Availability

Skipped — this phase has zero new external dependencies. It reuses two already-shipped, already-live
production surfaces verbatim: `GET /api/picker/candidates` (existing) and the `/api/stream` SSE
endpoint's `spot`/`ping`/`ticks` events (Phase 38, live in production per STATE.md's Phase 38
deferred-human-verification note — the stream itself is deployed, only its live RTH UAT is still
pending as of this research date). No new CLI, service, or runtime is introduced.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-wide `vitest run`) + `@testing-library/react` |
| Config file | `apps/web/vitest.config.ts` |
| Quick run command | `bun run test apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/analyzer-mobile` (scoped) |
| Full suite command | `bun run test` (root workspace) — repo convention (`package.json:8`), always the phase-gate command |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| AUI-01 | Table renders one row per candidate, score-desc default sort, row click drives `onSelect`, ⊕/× stopPropagation | unit (RTL) | `bun run test apps/web/src/screens/Analyzer.test.tsx -t "candidate rail"` (renamed describe block) | ❌ Wave 0 — existing card-rail tests (`Analyzer.test.tsx:169-206`) need FULL rewrite against `<tr>`/table testids, not incremental patching |
| AUI-01 | Sort-column click cycles desc→asc→desc, `aria-sort` reflects state | unit (RTL) | new `it()` blocks in `Analyzer.test.tsx` | ❌ Wave 0 — no existing sort-state test anywhere in this codebase (genuinely new behavior) |
| AUI-02 | Verdict word derives from `scoreStatus(candidate.score)`, groups render EDGE/RISK/FIT with correct criterion membership | unit (RTL) | `Analyzer.test.tsx` (desktop) + `MobileScorecard.test.tsx` (mobile) | ❌ Wave 0 for grouping; existing `checklist-*` tests in both files are the migration base, not new coverage |
| AUI-02 | Not-scored candidate renders only `PASTED_NOT_SCORED_NOTE`, no verdict word (catch #23 gate) | unit (RTL) | existing pattern already covered — `MobileScorecard.tsx:58-65`'s early-return has a mirror test in `MobileScorecard.test.tsx` today; extend to the new hero's grouped variant | ✅ pattern exists, extend |
| AUI-03 | Table `Panel` height caps at `70vh`, `<thead>` sticky — visual, not meaningfully unit-testable (jsdom has no real layout/scroll) | manual/UAT only | chrome-devtools screenshot at 1280×900+ (per UI-SPEC's own "or equivalent" allowance) | manual-only, justified: CSS layout properties (`sticky`, `max-h`) are not observable through jsdom's layout-less DOM |
| AUI-04 | Rounding: `Math.round()`/`.toFixed(2)` replace `exactAbs` at all 5 call sites, no `+61.9536112`-class output anywhere on the tab | unit (RTL) — string-content assertion on the context line | `Analyzer.test.tsx` + `MobileScorecard.test.tsx`, extend existing `risk-profile-selected-name`-adjacent text assertions | ✅ existing test infra (the subline is already asserted via `container.textContent`/`getByTestId`), extend value not structure |
| AUI-05 | Term-structure chart: `H=320`, `r=7`, in-chart event `label` renders with the SAME name as the below-chart legend chip | unit (RTL) via `TermStructureChart.test.tsx` | `bun run test apps/web/src/components/picker/TermStructureChart.test.tsx` | ✅ file exists (`TermStructureChart.test.tsx`, 284-line sibling of the component) — extend, not create |
| AUI-06 | Mobile verdict-hero grouping mirrors desktop's Edge/Risk/Fit membership; no table renders on mobile (assert `CandidateCard`s still used, no `<table>` in `AnalyzerMobile` DOM) | unit (RTL) | `AnalyzerMobile.test.tsx` | ✅ file exists, extend |
| AUI-07 | Live status "live" + non-null `liveSpot` → `PayoffChart` receives the live value; "quiet"/"stalled" → falls back to `snapshot.spot`; never `liveSpot` reaching `PayoffChart` when status isn't "live" | unit (RTL), mock `useLiveStream` the same way `useOverviewModel.test.ts` mocks it (if it does — see Assumption A2) | `Analyzer.test.tsx` new describe block, pattern-matched off whatever `useOverviewModel`/`Overview.test.tsx` already does for LIVE-04 | ❌ Wave 0 — new `useLiveStream` mock needs adding to `Analyzer.test.tsx`'s existing `vi.mock` block (alongside the existing `usePicker`/`useRepullChains`/`useAnalyzeCalendar` mocks at lines 58-81) |
| AUI-07 | `LiveStatusBadge` mounts in the Risk Profile panel header with the exact prop shape `useOverviewModel`'s badge uses | unit (RTL) | `Analyzer.test.tsx`, assert `LiveStatusBadge` receives the `liveBadgeProps` object | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** scoped `bun run test` invocation for the touched file(s), per `tdd.md`'s
  red→green discipline.
- **Per wave merge:** `bun run test apps/web/src` (the whole web workspace) — this phase touches
  enough shared cross-file state (`useAnalyzerModel.ts` consumed by BOTH trees) that a scoped run
  risks missing a mobile regression from a desktop-only change.
- **Phase gate:** Full `bun run test` (root workspace) green + `bun run typecheck` + `bun run lint`
  before `/gsd-verify-work 41`, per this repo's `workflow.md` "Verification Before Done" rule.

### Wave 0 Gaps

- [ ] `Analyzer.test.tsx` — the existing 28-`it()` suite needs a full pass to identify which blocks
      assert retired DOM (`candidate-card-*` inside the rail describe blocks, `scoring-checklist`/
      `checklist-*`/`scoring-pills` inside the scoring-checklist describe block) vs. which stay valid
      unmodified (payoff center, right column, pasted-calendars, copy-out, payoff controls,
      live-data-states, rule-registry describe blocks — these test data flow, not the retired DOM
      shape, and should survive largely intact).
- [ ] `Analyzer.test.tsx` — add a `useLiveStream` mock to the existing `vi.mock` block
      (`Analyzer.test.tsx:58-81` already mocks `usePicker`/`useRepullChains`/`useAnalyzeCalendar` the
      same way; `useLiveStream` needs the identical treatment, likely copyable from however
      `Overview.test.tsx` mocks it for the LIVE-04 tests — read that file's mock shape before
      authoring the Analyzer one, to keep the pattern consistent, not reinvented).
- [ ] No new test framework/config needed — Vitest + RTL already fully wired for this file tree.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Unchanged — `useLiveStream`'s ticket-mint flow (Supabase JWT via `apiFetch`) is Phase-20/38 infrastructure, not touched by this phase |
| V3 Session Management | No | Unchanged |
| V4 Access Control | No | No new route, no new permission surface |
| V5 Input Validation | No new surface | The paste-flow input (`AUI-05`) is a SIZE/styling change only (`px-2 py-1` → `px-3 py-2`, `text-[10px]` → `text-[12px]`) — the underlying `parseTosOrder`/Zod validation path is completely untouched |
| V6 Cryptography | No | Not applicable — no crypto in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Stale/frozen live value displayed as fresh (this phase's own core risk) | Tampering (of trust, not data) | The `liveStatus === "live" && liveSpot !== null` double-gate (Pitfall 2) — already the established, hardened pattern from Phase 38; no new mitigation to invent, just don't drop the guard |
| Malformed SSE frame crashing the render | Denial of Service (client-side) | Already handled by `useLiveStream.ts`'s existing `safeParse`-and-drop pattern on every event listener (`spot`/`indices`/`ticks`/`ping`) — this phase adds a consumer, not a parser, so it inherits the existing hardening for free |

This phase introduces no new attack surface: it consumes two already-authenticated, already-Zod-
validated data sources (`usePicker()`'s HTTP fetch and `useLiveStream()`'s SSE stream) through their
existing, unmodified client contracts. `security_enforcement: true` in `.planning/config.json` is
satisfied by inheritance — no new ASVS control is required because no new trust boundary is crossed.

## Project Constraints (from CLAUDE.md)

- **Dependencies point inward** — not applicable to this phase (pure `apps/web` frontend change,
  `web` already correctly imports only `@morai/contracts` types + `apps/web` internal modules; no
  new cross-package import is introduced).
- **TDD red→green** — every behavioral change (table sort, live-spot fallback, rounding) needs a
  failing test first per `tdd.md`; pure Tailwind/CSS-only edits (AUI-03's sticky/max-h, AUI-05's
  chart numeric literals with no new branch) are the `tdd.md` "styling-only UI tweaks" exemption —
  confirm each task's classification before skipping RED.
- **No `any`, no `as`, no `!`** — every new piece of code in this research (the sort-state type, the
  `GROUP_OF` lookup, the live-spot ternary) is expressible with plain unions/`ReadonlyArray`/
  optional chaining; no assertion is needed anywhere in the patterns above.
- **Docs before architecture changes** — not triggered; this phase makes no architecture change
  (no new table, no new port, no new adapter, no new bounded context).

## Sources

### Primary (HIGH confidence — direct file reads, this session)

- `apps/web/src/screens/Analyzer.tsx` (644 lines, full read) — current desktop tree, exact JSX/state
  wiring for every AUI-01..05/07 touch point.
- `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts` (400 lines, full read) — the shared
  model hook every requirement funnels through.
- `apps/web/src/hooks/useLiveStream.ts` (408 lines, full read) — the SSE hook AUI-07 consumes.
- `apps/web/src/screens/overview-mobile/useOverviewModel.ts` (674 lines, full read) — the LIVE-04
  precedent this phase ports.
- `apps/web/src/screens/Overview.tsx` (lines 100-372, 750-800 read) — table + `LiveStatusBadge`
  wiring precedents.
- `apps/web/src/components/LiveStatusBadge.tsx` (208 lines, full read).
- `apps/web/src/lib/position-format.ts` (52 lines, full read) — `exactAbs`/`usd`/`signedUsd` contract.
- `apps/web/src/components/picker/CandidateCard.tsx` (290 lines, full read).
- `apps/web/src/components/picker/TermStructureChart.tsx` (284 lines, full read).
- `apps/web/src/screens/analyzer-mobile/MobileScorecard.tsx` (185 lines, full read).
- `apps/web/src/screens/analyzer-mobile/AnalyzerMobile.tsx` (362 lines, full read).
- `apps/web/src/screens/analyzer-mobile/MobileAnalyzerChart.tsx` (104 lines, full read).
- `apps/web/src/components/system/BulletGauge.tsx` (115 lines, full read) — GAUGE-01 extraction
  precedent, referenced for the "shared component extraction" convention.
- `apps/web/src/components/system/index.tsx` — `PanelHeading` signature (grep + targeted read).
- `apps/web/src/components/system/Button.tsx` — `size`/`variant`/`tone` defaults (grep).
- `apps/web/src/screens/Analyzer.test.tsx` (structure scan: 28 `describe`/`it` blocks, `vi.mock`
  block lines 53-81, `stubDesktopMatchMedia` lines 121-138).
- `apps/web/src/App.tsx` + `apps/web/src/components/Shell.tsx` (grep) — confirmed single-screen
  rendering invariant that makes a second `useLiveStream()` consumer safe.
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`.
- `apps/web/package.json` (`typecheck`), root `package.json` (`test`, `lint`).

### Secondary (MEDIUM confidence)

- None — no web search or external documentation was needed for this phase; every question resolved
  against the codebase itself.

### Tertiary (LOW confidence)

- Assumption A1 (`Panel`'s own class list) and A2 (`useOverviewModel.test.ts` coverage) — see
  Assumptions Log, both flagged rather than asserted as verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every primitive already exists and was read in full.
- Architecture: HIGH — the exact seam (LIVE-04) this phase needs to port already exists in
  production for a sibling screen; this is porting, not designing.
- Pitfalls: HIGH for Pitfalls 1-3 (directly observed in the live-stream/model code); MEDIUM for
  Pitfall 4 (Panel's own CSS not fully read this session, flagged as Assumption A1).

**Research date:** 2026-07-14
**Valid until:** 30 days (stable internal codebase research, not fast-moving external dependency)
