---
phase: 36
slug: analyzer-journal-mobile-redesign-same-dedicated-mobile-tree
status: approved
reviewed_at: 2026-07-11
created: 2026-07-11
shadcn_initialized: true
preset: base-nova (neutral base, lucide icons) — detected from apps/web/components.json, unchanged
extends: 35.1-UI-SPEC.md (dedicated-mobile-tree recipe, user phone-check PASSED) — with the
  post-approval LIVE chart-chrome state (ghost ‹ [date pill] › + ⋯ row, Projection dialog,
  @ exp inside ⋯) as the reference, per MobileRiskPanel.tsx, NOT 35.1's superseded D-05 row
---

# Phase 36 — UI Design Contract: Analyzer + Journal Mobile, Dedicated Component Trees

> Phase 35.1 proved the recipe on Overview: dedicated mobile-only trees beat responsive
> reflow. This spec extends the same treatment to Analyzer and Journal, designed against
> the agent-verified 390px ground-truth failures in 36-CONTEXT.md. Desktop ≥1024px render
> output stays byte-identical on both screens. Same data hooks, same engines, same MORAI
> tokens; only the view trees are new.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn (already initialized — `apps/web/components.json`) — no `shadcn add` this phase |
| Component library | Existing `ui/*` (Badge, Dialog) + MORAI molecules (`Panel`, `PanelHeading`, `SectionLabel`, `Stat`, `Button`, `buttonClass`) + proven mobile primitives from 35.1 (`MobileRiskPanel` chrome, `PositionCard` idiom) |
| Icon library | none — text glyphs only (`‹ › ▸ ▾ ⋯ ●`), matching MobileRiskPanel convention |
| Font | Space Grotesk (`font-display`) / JetBrains Mono (`font-mono`, all numerals) |
| New dependencies | **zero** (locked constraint) |

---

## Diagnosis: the Journal lifecycle 60%-width bug (ground truth §Journal-2)

`LifecycleChart.tsx` renders ONE `<svg viewBox="0 0 840 700" preserveAspectRatio="xMinYMin meet" style={{width:"100%",height:"auto"}}>` containing all five stacked regions. Empirical check (headless Chrome, exact container chain reproduced: flex-col page → `Panel` `flex min-h-[300px] flex-1 flex-col` → `position:relative;width:100%` div → the svg): the svg fills its container at the correct 840:700 ratio — **the component is NOT intrinsically fixed-width**. The ~60%-width render with a dead RIGHT margin is the fingerprint of `xMinYMin meet` receiving a box wider than 840:700 — i.e. the svg's CSS height resolving SHORT of `width × 700/840` in the emulated/live environment, so `meet` scales the drawing to the height and left-aligns it (`xMin`), leaving dead space on the right. Confidence: **high** that the mechanism is a `meet`-vs-box mismatch (the dead-RIGHT-margin signature admits no other reading), **moderate** on exactly which ancestor shorts the height in the live page.

**The fix doesn't need the missing detail** — and full-width scaling wouldn't be enough anyway: 840 logical px compressed to ~390 renders the chart's 8.5–10px labels at ~3.5–4.6px, illegible regardless of container. D-12 mounts the chart at a **fixed 840px CSS width inside a full-bleed horizontal pan container**, which (a) makes a `meet` mismatch impossible (definite width → `height:auto` from a definite basis), (b) keeps every label at designed size, (c) touches zero chart internals. C4 verifies live.

---

## Decisions

| ID | Decision |
|----|----------|
| **D-01** | **Analyzer switch + dedicated tree.** New directory `apps/web/src/screens/analyzer-mobile/`. `Analyzer.tsx` becomes the thin switch (verbatim Overview pattern): `useIsDesktop()` → `<AnalyzerDesktop/>` (today's JSX renamed in-file, byte-identical DOM at ≥1024px) or `<AnalyzerMobile/>`. Only one tree mounts at a time. |
| **D-02** | **`useAnalyzerModel()` extraction.** All non-trivial state/derivation inline in `Analyzer()` moves to `apps/web/src/screens/analyzer-mobile/useAnalyzerModel.ts` (the `useOverviewModel` precedent): picker query + `sortedCandidates`, pasted-candidates state + `handlePasteAnalyze`/`handleRemovePasted`/`handleClearAllPasted`, selection + combine, `copiedId`/`handleCopyCandidate`, `today`/`bounds`/`dateControl`/`toggles`/`handleToggle`, `params`/`payoffDomain`/`scenarioResult`/`selectedPosition`, book totals (`bookCount`/`bookDebit`/`bookTheta`/`bookVega`), `positionSetSignature`, `repull`. Module constants `PASTED_NOT_SCORED_NOTE`, `PASTE_ERROR_COPY`, `CHIP_LABELS`, `EXPERIMENTAL_SHORT`, `FALLBACK_SCORE_ITEMS` and helper `scoreStatus` move/export alongside — never re-implemented. Both trees call the hook; view JSX duplicates per tree (sanctioned), logic never does. |
| **D-03** | **Journal switch + dedicated tree.** New directory `apps/web/src/screens/journal-mobile/`. `Journal({trades})` becomes the switch → `<JournalDesktop trades/>` (today's JSX renamed in-file) or `<JournalMobile trades/>`. `JournalContainer` and the `TradeSummary` prop contract are untouched. |
| **D-04** | **`useJournalModel(trades)` extraction** to `apps/web/src/screens/journal-mobile/useJournalModel.ts`: open/closed split, `selectedId`/`selectedTrade`, `historyOpen`/override logic, `hoveredIndex`, `useLifecycle` slice, `useRuleTags` slice + `openEvent`/`closeEvent`/`rollEvents`, `selectedTradeTagLabels`, `beats`. Module helpers `fmtDate`, `fmtPnl`, `fmtSnapTime`, `tagLabel`/`RULE_TAG_LABELS`, `HeadingPill`, `RuleTagChips`, `DashedStub`/`PreHistoryStub`/`BuildingLifecycleStub` export for the mobile tree (from `Journal.tsx` or the model file — planner picks one home; single source either way). |
| **D-05** | **`MobileChartControls` extraction — the shared chrome, not a fork.** The slim control row (`‹` ghost stepper · date-pill `DialogTrigger` · `›` · right-aligned `⋯`), the Projection dialog (Today/+1w/+2w/+1m/Expiry chips + 0..maxDays slider + exact date input) and the `⋯` toggles dialog (@ exp/Fan/Walls/Profit zone) move VERBATIM out of `MobileRiskPanel.tsx` into `apps/web/src/components/charts/MobileChartControls.tsx` (desktop sibling: `PayoffControls.tsx`). Props: `{ dateControl, bounds, toggles, onToggle }` — exactly the slice whose props line up between Overview and Analyzer. `MobileRiskPanel` becomes a thin consumer; its rendered DOM is byte-identical (existing `MobileRiskPanel.test.tsx` stays green unmodified — that IS the guard). The Overview-specific freshness caption stays in `MobileRiskPanel`. |
| **D-06** | **Analyzer mobile flow order** (CONTEXT-locked): paste/Analyze row (the screen's verb, first) → candidates → scorecard verdict hero → full-bleed risk chart → detail disclosures. No `Panel` wrappers anywhere in the mobile Analyzer tree except inside reused components that already carry them. |
| **D-07** | **Candidates: reuse `CandidateCard` verbatim; top-3 + state-backed disclosure.** `CandidateCard` (already a tappable card with select/⊕-combine/copy/×-remove) renders unchanged. Pasted cards pin on top (all always visible), then the top 3 scored candidates; the rest fold behind an `▸ All candidates (N)` toggle (Journal's `history-toggle` idiom: real `<button aria-expanded>` + React state — catch #24). The five rail states keep their copy VERBATIM (including two-line heading+sub states) but render as bare prompts with no `Panel` shells (ground truth §Analyzer-1) — "bare" means unboxed, not literally one line. The `rail-legend` 9px line renders below the visible cards, verbatim. |
| **D-08** | **Scorecard verdict hero.** Once a candidate is selected (existing auto-select of rank-1 preserved): `SectionLabel` `Scorecard` → 32px mono bold rounded `candidate.score` (hero scale from 35.1 D-03; `text-txt`, no accent — accents stay reserved) → 11px mono context line (name violet + debit/θ/vega, string verbatim from today's selected-name line, incl. the amber `combined-book-summary` when `bookCount > 1`) → the checklist as stacked ROWS (one per score rule; identical `scoreStatus` icons/colors, `CHIP_LABELS` labels, `w{weight}`, `%` values, `θ GATE` row, `fwdEdge`-null `— n/a` guard, AH `SESSION` line, dim `CALIBRATING` line, gate-drops fine print — every string verbatim from the chip contract). `MetricChip` is not mounted in the mobile Analyzer tree. |
| **D-09** | **Analyzer chart block = MobileChartControls + full-bleed PayoffChart.** Chart section `px-0`; controls row + caption own `px-4`. PayoffChart mounts with the Analyzer-specific props it has TODAY (`todayCurveColor`/`expirationCurveColor`/`expectedMoveBand`, picker gex walls) PLUS the 35.1 mobile props `showBePills={false}` / `aspectRatio={1.3}` / `highlightedPositionId={null}`. Caption (9px, worst-of dot): `● {source} · {asOf}` + ` · AH — indicative` when after-hours; dot `bg-up` when both context statuses `"ok"` and session RTH, `bg-amber` otherwise. The center-panel `⧉ Copy TOS order` button does NOT render on mobile — each `CandidateCard` already carries its own copy affordance (no duplicate). |
| **D-10** | **Term/Why/Plan = closed native `<details>` disclosures** (catch #24: real `open` attribute, user-toggled). Summaries reuse the exact desktop panel titles: `Term structure + your legs` / `Why this calendar` / `Entry / exit plan`. Contents reuse `TermStructureChart` / `WhyPanel` / `EntryExitPlan` VERBATIM. Catch #23: the disclosures render whenever a candidate is selected — never gated on scoring; a `breakdown.length === 0` candidate shows `PASTED_NOT_SCORED_NOTE` inside (same gate as desktop). With NO candidate at all, the hero/chart/disclosure region renders nothing — the rail states carry the messaging (no hollow shells). |
| **D-11** | **Journal `TradeCard` — PositionCard idiom, kills the triple affordance.** New `journal-mobile/TradeCard.tsx` fed the same `TradeSummary`. Row 1: name left (`font-display text-sm font-bold text-txt`) + focal right: closed → `fmtPnl(realizedPnl)` 16px mono bold sign-colored (`—` in `text-dim` when the list endpoint gave `""` — same data path as today, no new fetch); open → the single `OPEN` badge (existing classes `rounded-[3px] border border-cyan/30 px-[5px] text-[8px] text-cyan`) and NOTHING else — no "open" text, no chip. Row 2 muted meta: `{fmtDate(openedAt)} → {fmtDate(closedAt)}` (or `{fmtDate(openedAt)} · open`), plus ` · entry/exit only` appended when `classifyTradeHistory` ≠ `"history"` (the badge dies, the fact survives as text). Card surface: `rounded-lg bg-raise/30 p-3 ring-1 ring-line`; selected: `ring-violet bg-violetd`. Tap anywhere = select (existing `role="button"`/`tabIndex`/Enter-Space handler pattern), min-h-11, never gated (catch #23). The D-22 rule-tags pill keeps its behavior/testid (selected trade only). Open trades first; the `▸ History (N)` toggle + auto-open-when-no-open-trades logic reused verbatim from the model. |
| **D-12** | **Lifecycle chart: full-bleed horizontal pan mount, internals ZERO-diff.** Mobile mount: `<div className="overflow-x-auto" …><div className="w-[840px]"><LifecycleChart snapshots strike onCrosshairChange/></div></div>` in a `px-0` section — the scroll container spans viewport edge-to-edge; the chart renders at its designed 840px (≈ its desktop rendered size → labels at designed legibility). Initial scroll position = the END (latest snapshots): `ref` + layout effect `el.scrollLeft = el.scrollWidth`. Pan hint caption below (9px dim, `px-4`): `‹ swipe for earlier days` — rendered only in the `history`-with-chart state. The document itself must not scroll horizontally (the container clips — C2). `LifecycleChart.tsx` is untouched; the additive-props escape hatch in 36-CONTEXT stays unused. |
| **D-13** | **Rebuild demoted behind `⋯` overflow.** The lifecycle heading row (`px-4`): left = existing kind caption (`30-min snapshots` / `entry/exit only`, 10px dim, verbatim); right = `⋯` `Button size="touch" variant="ghost"` (aria-label `More journal actions`) opening a Dialog (title `Journal`, SectionLabel style) whose body renders `<RebuildButton calendarId/>` VERBATIM — its own confirm dialog, copy, and mutation semantics unchanged (nested shadcn dialogs; C6 verifies the stack live). `RebuildButton` does not render anywhere else in the mobile tree. |
| **D-14** | **Footnotes → `Chart notes` disclosure.** The two honest-caveat lines (attribution 2nd-order / feed-gap lines, copy verbatim) move inside a native `<details>` (summary `Chart notes`, 10px tracked style), closed by default, placed directly under the pan-hint caption. Desktop keeps them always-visible (its tree is untouched). |
| **D-15** | **Masthead + rail reused verbatim, mobile order.** `LifecycleMasthead` (same render gate: history kind, not pending/error) → chart block → `PnlBridgeCard` (crosshair-synced via the same `hoveredIndex`) → `EdgeCard` → `GreeksNowCard` → `BeatsCard` → Notes `Panel` (with `RuleTagChips` control, verbatim). Ground truth: these already stack legibly — zero redesign. |
| **D-16** | **jsdom defaults to the mobile trees; same-commit test migration.** `useIsDesktop` returns `false` under jsdom → tests render the mobile trees by default. `Analyzer.test.tsx` and `Journal.test.tsx` desktop assertions migrate to the `window.matchMedia` stub IN THE SAME COMMIT as each screen's switch (35.1 D-10 byte-identity-guard pattern); each screen gets a stubbed desktop DOM guard test (structural assertions on grid/panels). |
| **D-17** | **Desktop dead-branch cleanup (final task).** Once the switches land, the Phase-35 reflow arms in the desktop paths are unreachable: Analyzer's `order-*` classes + `contents lg:grid` split (becomes plain `grid grid-cols-[300px_minmax(0,1fr)_330px] gap-4`) + the `-mx-3 lg:mx-0` chart bleed wrapper; Journal's mobile flex arm on `journal-positions` (becomes plain `grid h-full grid-cols-[250px_minmax(0,1fr)_290px] overflow-hidden …`). Removed in one dedicated last task, gated by 1440px before/after screenshot identity (C7). |
| **D-18** | **iOS focus-zoom guard on the mobile paste input.** iOS Safari auto-zooms any focused text input with font-size < 16px. The mobile paste input renders at `text-base` (16px) — the one deliberate size deviation from the desktop input's `text-[10px]`. (The Notes textarea keeps its size — reused verbatim, out of redesign scope.) |

### Open questions — resolved inline (no user available)

1. *Show all candidates or fold?* → Top 3 + `All candidates (N)` toggle (D-07): rank-1 auto-selects, so the scorecard/chart must stay reachable without scrolling past ~10 cards; pasted cards always show (they're user-created, freshest intent).
2. *Where does `⧉ Copy TOS order` go on mobile?* → Nowhere (D-09): every `CandidateCard` already has a per-card copy button; the center-panel button is a desktop duplicate.
3. *Lifecycle chart: shrink-to-fit or pan?* → Pan at designed width (D-12). Internals are frozen; a 390px-wide render of an 840-unit drawing is ~3.5px type — "full-bleed AND legible" is only satisfiable by 1:1 rendering inside an edge-to-edge pan container.
4. *Term-structure chart at 390px?* → Reused verbatim inside its disclosure. It's a Recharts `LineChart` with explicit W/H — C-claim C3 spot-checks its fit; if it clips, follow-up (its internals are equally out of scope this phase).
5. *Analyzer rail-legend line?* → Kept verbatim below the cards (9px, wraps fine); it's teaching copy the cards depend on (`◂f`/`◂b` glyphs).
6. *State reset on 1024px cross?* → Accepted, same as 35.1 D-02 (tree remount; phones never cross it).

---

## Spacing Scale

Inherits the 35.1 table wholesale (section gap 24px/`gap-6`, section `px-4`, chart sections `px-0`, intra-block `gap-3`, card list `gap-2`, card padding `p-3`, touch targets `min-h-11`/`size="touch"`, control-row `gap-1`). Additions this phase:

| Token | Value | Usage |
|-------|-------|-------|
| Paste row gap | 8px (`gap-2`) | input ↔ Analyze button |
| Checklist row gap | 4px (`gap-1`) | scorecard hero rows |
| Disclosure row padding | 12px vertical (`py-3`) on `<summary>` | ≥44px effective tap target with the 10px label |

---

## Typography

No new sizes beyond the established scale; the 32px hero size (35.1) is reused for the Analyzer score.

| Role | Classes | Notes |
|------|---------|-------|
| Scorecard score | `font-mono text-[32px] font-bold tabular-nums leading-none text-txt` | No sign color — a score is not a P&L |
| Scorecard context | `font-mono text-[11px] text-dim` — name span `text-violet` (testid `risk-profile-selected-name`), combined-book span `text-amber` (testid `combined-book-summary`) | Strings verbatim from desktop |
| Checklist row | `font-mono text-[11px]` — icon+status colored via `scoreStatus` (`text-up`/`text-amber`/`text-down`/`text-dim`), label `text-muted-foreground`, `w{n}` `text-dim` | Copy identical to the chips |
| TradeCard name | `font-display text-sm font-bold text-txt` | PositionCard row-1 parity |
| TradeCard focal P&L | `font-mono text-base font-bold tabular-nums` + sign class | 16px, PositionCard parity; `text-dim` for `—` |
| TradeCard meta | `font-mono text-[10px] text-dim truncate` | PositionCard row-2 parity |
| Disclosure summary | `font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase` | SectionLabel style + `▸` glyph (native marker hidden) |
| Captions (chart/pan hint) | `font-mono text-[9px] text-dim` | 35.1 freshness-caption parity |
| Mobile paste input | `font-mono text-base text-txt` | 16px — D-18 iOS zoom guard |

---

## Color

LOCKED palette (`apps/web/src/index.css` `@theme`) — **zero new hex values**. 60/30/10 unchanged.

| Accent | Reserved for (these screens) |
|--------|------------------------------|
| `--color-up #26a69a` / `--color-down #ef5350` | Checklist ✓/✗ + θ GATE sign, TradeCard closed P&L sign, caption fresh dot, Rebuild confirm (existing) |
| `--color-violet #a78bfa` | Selected candidate name, selected TradeCard ring/`bg-violetd`, projected date pill, focus rings, active toggles, T+0/@exp picker curves (existing chart constants) |
| `--color-amber #f0b429` | `~` partial checklist status, AH — indicative, stale caption dot, combined-book summary, event `◂f`/`◂b` glyphs (existing) |
| `--color-cyan` | `OPEN` badge (existing token usage, unchanged) |
| `--color-blue #5b9cf6` | Analyzer T+0 curve color constant (existing) |

---

## Copywriting Contract

All reused strings are VERBATIM from current code — listed here as the executor's checklist.

### Analyzer mobile

| Element | Exact copy |
|---------|-----------|
| Paste placeholder | `Paste a TOS calendar order…` |
| Analyze button | `Analyze` |
| Paste error | `Couldn't read that. Paste a TOS calendar order, e.g. BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC` |
| Candidates section label | `Candidates` (SectionLabel — replaces the panel title "Suggested calendars", which described a panel that no longer exists) |
| Clear-all button | `Clear all` (testid `picker-paste-clear-all`) |
| Re-pull control | `↻ Re-pull` / `Queuing…` / `queued · ~4 min` / `failed` (testids `repull-chains-button`, `repull-status`) |
| Loading state | `Loading candidates…` (testid `picker-loading`) — one line, no Panel |
| Error state | `Couldn't load candidates.` + `Retry` button (testid `picker-error`) |
| Cold start | `Picker warming up` + `First scoring run pending — check back after the next chain snapshot.` (testid `picker-empty-cold-start`) |
| Zero filtered | `No candidates in this snapshot` + `No put calendars meet net-θ>0 over the {asOf} snapshot.` (testid `picker-empty-filtered`) |
| All-candidates toggle | `▸ All candidates ({N})` / `▾ All candidates ({N})` — N = scored candidates beyond the top 3 |
| Rail legend | `θ = daily $ decay · vega = $ per vol-pt · ◂f/◂b = event on front / back leg · bars = scored factors (higher = better)` (testid `rail-legend`, amber glyphs) |
| Scorecard label | `Scorecard` (SectionLabel) |
| Scorecard empty | `Select a calendar to see its scorecard.` |
| Not scored | `Pasted calendar — not engine-scored.` |
| Checklist labels | `FWD-IV EDGE` `SLOPE` `GEX FIT` `EVENT RISK` `BE : EM` `Δ NEUTRAL` `θ/VEGA` `VRP` `DEBIT` + `w{weight}` + `{✓\|~\|✗\|—} {n}%` / `n/a` — verbatim `CHIP_LABELS`/`scoreStatus` |
| θ gate row | `θ GATE` + `{✓\|✗} {±n.n}/d` |
| Session line | `SESSION` `AH — indicative` (after-hours only) |
| Calibrating line | `CALIBRATING` + `{EXPERIMENTAL_SHORT id} {value}` joined ` · ` (dim, opacity-60) |
| Gate drops | `{n} illiquid quote{s} · {n} negative-θ pair{s} dropped this run` (testid `checklist-gate-drops`) |
| Chart caption | `● {source} · {asOf}` + ` · AH — indicative` when after-hours; dot `bg-up` iff both `gexContextStatus`/`eventsContextStatus` === `"ok"` and session RTH, else `bg-amber` |
| Disclosure summaries | `Term structure + your legs` / `Why this calendar` / `Entry / exit plan` |
| Control-row aria | `Previous day` / `Next day` / `Projection date` / `More chart options` (existing, via MobileChartControls) |
| Destructive actions | none on Analyzer |

### Journal mobile

| Element | Exact copy |
|---------|-----------|
| Empty screen | `No journal history yet.` + `Trades before Jun 12 have entry/exit only.` |
| Trades section | `Trades` (SectionLabel) + `SPXW put calendars` HeadingPill |
| OPEN badge | `OPEN` (single open affordance, D-11) |
| Meta suffix (non-history) | ` · entry/exit only` |
| History toggle | `History ({N})` with `▸`/`▾` (testid `history-toggle`, aria-expanded) |
| Kind caption | `30-min snapshots` / `entry/exit only` |
| Overflow trigger | `⋯` aria-label `More journal actions` |
| Overflow dialog title | `Journal` |
| Rebuild (inside ⋯) | `Rebuild journal…` → confirm `Rebuild journal for "{calendarId}"?` / `This overwrites all snapshot history.` / `Rebuild` / `Rebuilding…` / `Cancel` — RebuildButton verbatim |
| Loading | skeleton block, aria-label `Loading lifecycle` (verbatim) |
| Error | `Couldn't load this calendar's lifecycle.` + `Retry` |
| Pre-history stub | `no day-by-day (pre Jun-12)` + `Chain history starts 2026-06-12. Only entry and exit events are available for this trade.` |
| Too-new stub | `Building the lifecycle.` + `Check back after the next snapshot — captured every 30 minutes during RTH.` |
| Pan hint | `‹ swipe for earlier days` |
| Chart-notes summary | `Chart notes` |
| Chart-notes body | `Attribution is a 2nd-order approximation — the faint residual band is the unexplained part, never hidden.` + `Line breaks are real feed gaps (spot=0 / NaN), drawn as gaps, never interpolated.` |
| Rail/Notes copy | LifecycleMasthead, PnlBridge/Edge/GreeksNow/Beats, ENTER/EXIT/ROLL rule-tag blocks, `Available at close.`, `Add a short note for "Other."`, textarea placeholder — all verbatim (components reused) |

---

## Screen Composition

### Analyzer mobile — `AnalyzerMobile` root: `flex flex-col gap-6 pb-10 pt-4` (sections own `px-4`; chart section owns `px-0`)

```
┌─────────────────────────────────────────┐
│ MOR·AI   Overview  Analyzer  Journal    │ ← Shell, sticky 48px (unchanged)
├─────────────────────────────────────────┤
│ [ Paste a TOS calendar order…] [Analyze]│ ← the screen's verb, first; 16px input,
│                                         │   44px targets; error line below when set
│ CANDIDATES                   ↻ Re-pull  │ ← SectionLabel + repull control
│ ┌─────────────────────────────────────┐ │
│ │ #1  SPX 7425P Aug14/Sep18   … 87    │ │ ← CandidateCard VERBATIM (pasted cards
│ └─────────────────────────────────────┘ │   pinned above; selected = existing ring)
│ ┌ #2 … ─────────────────────────────┐   │
│ ┌ #3 … ─────────────────────────────┐   │ ← top 3 scored
│ ▸ All candidates (6)                    │ ← aria-expanded toggle (D-07)
│ θ = daily $ decay · vega = $/vol-pt · … │ ← rail-legend, 9px
│                                         │
│ SCORECARD                               │
│ 87                                      │ ← 32px mono bold
│ SPX 7425P Aug14/Sep18 · debit $840 ·    │ ← 11px context (violet name; amber
│   θ +12.4/d · vega +48                  │   combined-book summary when 2+)
│ ✓ FWD-IV EDGE w25              84%      │ ← checklist rows (chip copy verbatim)
│ ~ SLOPE w15                    41%      │
│ ✓ θ GATE                    +12.4/d     │
│ 2 illiquid quotes · 1 negative-θ pair … │ ← 9px gate-drops fine print
│                                         │
│ ‹  [ Jul 14 · today ]  ›            ⋯   │ ← MobileChartControls (SHARED, D-05)
│┌───────────────────────────────────────┐│
││   payoff chart — EDGE TO EDGE         ││ ← aspectRatio 1.3, showBePills false,
││   (picker colors + EM band kept)      ││   EM band, walls; internals frozen
│└───────────────────────────────────────┘│
│ ● schwab · 2026-07-11 · AH — indicative │ ← 9px caption, worst-of dot
│ ▸ TERM STRUCTURE + YOUR LEGS            │ ← native <details>, closed (D-10)
│ ▸ WHY THIS CALENDAR                     │
│ ▸ ENTRY / EXIT PLAN                     │
└─────────────────────────────────────────┘
```

**Acceptance geometry:** with nothing selected, NOTHING below the candidates section renders (no hollow shells); with rank-1 auto-selected, paste row + cards + scorecard start inside the first 844px; exactly one chrome row above the chart.

### Journal mobile — `JournalMobile` root: `flex flex-col gap-6 pb-10 pt-4` (sections own `px-4`; chart section owns `px-0`)

```
┌─────────────────────────────────────────┐
│ MOR·AI   Overview  Analyzer  Journal    │ ← Shell (unchanged)
├─────────────────────────────────────────┤
│ TRADES               SPXW put calendars │ ← SectionLabel + HeadingPill
│ ┌─────────────────────────────────────┐ │
│ │ SPXW 7425P Cal            [OPEN]    │ │ ← row 1: name + single OPEN badge
│ │ Jun 20 2026 · open                  │ │ ← row 2: muted meta
│ └─────────────────────────────────────┘ │   (selected = ring-violet bg-violetd)
│ ▸ History (11)                          │ ← existing toggle idiom, kept
│   ┌ SPXW 7350P Cal          +$395.00 ┐  │ ← closed: focal P&L 16px sign-colored
│   │ Jun 12 2026 → Jun 27 2026        │  │
│   └──────────────────────────────────┘  │
│                                         │
│ ┌ Theta's carrying it — no adverse    ┐ │ ← LifecycleMasthead VERBATIM
│ │ move has hit yet.        NET P&L    │ │
│ └ Forward vol is holding…    +$412    ┘ │
│ 30-min snapshots                    ⋯   │ ← slim row; ⋯ = overflow (Rebuild inside)
│┌───────────────────────────────────────┐│
││ P&L ATTRIBUTION ▓▓▓▓▓▓▓▓▓ →→ (pan)   ││ ← LifecycleChart @ 840px CSS width in an
││ VOL & TERM STRUCTURE ~~~~~           ││   overflow-x-auto FULL-BLEED container,
││ GREEKS ---- · PRICE vs STRIKE ----   ││   scrolled to latest; internals ZERO-diff
│└───────────────────────────────────────┘│
│ ‹ swipe for earlier days                │ ← 9px pan hint
│ ▸ Chart notes                           │ ← footnotes disclosure (D-14)
│ [ P&L BRIDGE — crosshair-synced       ] │ ← rail cards stacked, VERBATIM (D-15)
│ [ THE EDGE ] [ GREEKS · NOW ]           │
│ [ THE BEATS ] [ NOTES + rule tags ]     │
└─────────────────────────────────────────┘
```

**Acceptance geometry:** trade cards + masthead inside the first 844px; lifecycle chart edge-to-edge with designed-size labels; `Rebuild journal…` invisible until `⋯` is tapped; no document horizontal scroll (pan container clips).

---

## Component Specifications

### 1. `Analyzer.tsx` — the switch (D-01/D-02)

```tsx
export function Analyzer(): React.ReactElement {
  const isDesktop = useIsDesktop();
  return isDesktop ? <AnalyzerDesktop /> : <AnalyzerMobile />;
}
```

`AnalyzerDesktop` = today's `Analyzer` body renamed in-file, JSX untouched (except D-17 cleanup in the final task). `CandidateRail`, `ScoringMethodologyPanel`, `RightColumn` stay in the file for the desktop tree. Both trees call `useAnalyzerModel()`.

### 2. `useAnalyzerModel()` (new — `analyzer-mobile/useAnalyzerModel.ts`)

Returns (names indicative, planner may adjust): `{ snapshot, isPending, isError, refetch, sortedCandidates, railCandidates, pastedCandidates, pasteText, setPasteText, pasteError, handlePasteAnalyze, handleRemovePasted, handleClearAllPasted, selected, selectedId, handleSelect, combinedIds, handleToggleCombine, copiedId, handleCopyCandidate, selectedPosition, bounds, dateControl, toggles, handleToggle, payoffDomain, scenarioResult, spot, bookCount, bookDebit, bookTheta, bookVega, positionSetSignature, repull: { mutate, isPending, isSuccess, isError } }`. Exports the D-02 constants/helpers; `Analyzer.tsx` re-imports them (single source).

### 3. `MobileChartControls` (extraction — `components/charts/MobileChartControls.tsx`, D-05)

Props: `{ dateControl: PayoffDateControl; bounds: { minIso: string; maxIso: string }; toggles: PayoffChartToggles; onToggle: (key: keyof PayoffChartToggles) => void }`.

Body = the EXACT current `MobileRiskPanel` control row + both dialogs, moved: the ghost `‹`/`›` `Button size="touch" variant="ghost" className="px-2 text-txt"` steppers; the date-pill `DialogTrigger` (`buttonClass({size:"touch",variant:"ghost"})` + `px-2 font-mono text-[11px] text-txt`, `projected && "text-violet ring-1 ring-violet"`, label `{MMM d} · {+Nd|today}`, testid `date-pill`); the Projection `DialogContent max-w-xs` (Today disabled-when-today, `+1w/+2w/+1m` quick jumps disabled past `maxDays`, `Expiry` col-span-2, `date-readout`, `date-slider` range 0..maxDays `accent-violet`, `date-picker-input` native date min/max); the `ml-auto` `⋯` trigger (aria `More chart options`) + Chart `DialogContent` with the four full-width `variant="toggle"` buttons (`@ exp`/`Fan`/`Walls`/`Profit zone`, `active`/`aria-pressed` from `toggles`). All classes, testids, aria-labels, `QUICK_JUMPS`, `DIALOG_TITLE_CLASS`, and the local-date math (`parseLocalDateInput`/`toDateInputValue`/`daysBetween`, catch #22) move verbatim. **Guard: `MobileRiskPanel.test.tsx` passes with zero test edits.**

### 4. `AnalyzerMobile` (new — `analyzer-mobile/AnalyzerMobile.tsx`)

Root `data-testid="analyzer-mobile-root"`, `flex flex-col gap-6 pb-10 pt-4`.

- **Paste block** (`px-4`): `flex items-center gap-2` → `<input data-testid="picker-paste-input" type="text" … className="min-h-11 min-w-0 flex-1 rounded-[3px] border border-line2 bg-transparent px-2 font-mono text-base text-txt" />` (D-18) + `Button variant="primary" size="touch" data-testid="picker-paste-analyze"` `Analyze`. Error: existing `picker-paste-error` line (`font-mono text-[9px] text-down`) below the row.
- **Candidates section** (`px-4`): heading row `flex items-center justify-between gap-2` → `SectionLabel` `Candidates` + `flex gap-1.5` [`Clear all` ghost when pasted > 0, repull control verbatim]. Body = the five rail states: loading/error/cold-start branches as bare prompts (copy + testids verbatim, no `Panel`); settled → `flex flex-col gap-2` of `CandidateCard`s — all `pastedCandidates` first, then `sortedCandidates.slice(0, 3)`, then when `sortedCandidates.length > 3` the `All candidates (N)` `<button type="button" aria-expanded data-testid="all-candidates-toggle">` (history-toggle classes: `flex w-full items-center gap-1.5 rounded-md px-[9px] py-[6px] font-mono text-[10px] tracking-wide text-dim hover:text-txt`) revealing `sortedCandidates.slice(3)` via React state; zero-filtered branch verbatim. `rail-legend` line below the list (candidates > 0). Every `CandidateCard` prop wires exactly as `CandidateRail` does today.
- **`MobileScorecard`** (new — `analyzer-mobile/MobileScorecard.tsx`, `px-4`, D-08): props `{ candidate, ruleSet, gateDrops, marketSession, bookCount, bookDebit, bookTheta, bookVega }`. `candidate === null` → render nothing (rail states carry messaging). `breakdown.length === 0` → SectionLabel + `PASTED_NOT_SCORED_NOTE` line only. Scored → label, 32px score (`Math.round(candidate.score)`, testid `mobile-score`), context line (verbatim strings + testids `risk-profile-selected-name`/`combined-book-summary`), then `flex flex-col gap-1` checklist rows (testids `checklist-{key}` preserved): `{icon} {label} w{weight}` left, `{n}%`/`n/a`/`{±n.n}/d` right (`justify-between`), AH `SESSION` row first when after-hours, `CALIBRATING` row + gate-drops fine print last. Row derivation reuses `scoreStatus`/`CHIP_LABELS`/`FALLBACK_SCORE_ITEMS`/`EXPERIMENTAL_SHORT` from the model module — not re-implemented.
- **Chart block** (new — `analyzer-mobile/MobileAnalyzerChart.tsx`, section `px-0`, D-09): renders only when `selected !== null && scenarioResult !== null`. `MobileChartControls` row (`px-4`) → `mt-2 w-full` PayoffChart:

```tsx
<PayoffChart
  todayCurve={scenarioResult.payoffCurve}
  fanCurves={[]}
  expirationCurve={scenarioResult.expirationCurve}
  rollCurve={null}
  gex={{ callWall: snapshot?.gex.callWall ?? null, putWall: snapshot?.gex.putWall ?? null, flip: snapshot?.gex.flip ?? null }}
  domain={payoffDomain}
  spot={spot}
  toggles={toggles}
  fitY={false}
  onFitYConsumed={noop}
  positionSetSignature={positionSetSignature}
  baseExpirationCurve={scenarioResult.expirationCurve}
  todayCurveColor={TODAY_CURVE_COLOR}
  expirationCurveColor={EXPIRATION_CURVE_COLOR}
  expectedMoveBand={selected.expectedMove > 0 ? { spot, em: selected.expectedMove } : null}
  highlightedPositionId={null}
  showBePills={false}
  aspectRatio={1.3}
/>
```

  → caption (`px-4 mt-1.5`, testid `analyzer-mobile-caption`): dot + `{source} · {asOf}` + AH segment per the contract.
- **Disclosures** (`px-4`, D-10): three `<details className="border-t border-line/40">` with `<summary className="flex min-h-11 cursor-pointer items-center gap-1.5 py-3 …">` (SectionLabel-styled text, `▸` via `[&::-webkit-details-marker]:hidden` + rotate-on-open using the `open` state — a `group-open:` class, never CSS-revealing content). Contents: `TermStructureChart` (needs `snapshot !== null`), `WhyPanel` (needs `gex`), `EntryExitPlan` (with `sizing`) — each guarded by `notScored → PASTED_NOT_SCORED_NOTE` exactly as `RightColumn` does today.

### 5. `Journal.tsx` — the switch (D-03/D-04)

```tsx
export function Journal({ trades }: JournalProps): React.ReactElement {
  const isDesktop = useIsDesktop();
  return isDesktop ? <JournalDesktop trades={trades} /> : <JournalMobile trades={trades} />;
}
```

`JournalDesktop` = today's body renamed in-file (empty-state branch included), consuming `useJournalModel(trades)`. `TradeSummary` export and `JournalContainer` untouched.

### 6. `JournalMobile` (new — `journal-mobile/JournalMobile.tsx`)

Root `data-testid="journal-mobile-root"`, `flex flex-col gap-6 pb-10 pt-4`. Empty state (`trades.length === 0`): existing two lines verbatim, centered.

- **Trades section** (`px-4`): heading row → `SectionLabel` `Trades` + `HeadingPill` `SPXW put calendars`. `flex flex-col gap-2` of `TradeCard` (open trades), then the `History (N)` toggle (existing classes/testid/aria-expanded, `historyOpen` from the model incl. auto-open) revealing closed `TradeCard`s.
- **`TradeCard`** (new — `journal-mobile/TradeCard.tsx`, D-11): props `{ trade: TradeSummary; isSelected: boolean; tagLabels: ReadonlyArray<string>; onSelect: (id: string) => void }` (TradeRow parity). Surface `cn("rounded-lg p-3 ring-1 transition-colors cursor-pointer", isSelected ? "ring-violet bg-violetd" : "ring-line bg-raise/30")`, `role="button" tabIndex={0}` + Enter/Space handler, testid `trade-card-{trade.id}`. Row 1 `flex items-center justify-between gap-2`: name span; right = open → OPEN badge (classes verbatim) / closed → `<span className={cn("font-mono text-base font-bold tabular-nums", pnl focal class)}>{fmtPnl(realizedPnl)}</span>` (`—` → `text-dim`). Row 2 `mt-1 font-mono text-[10px] text-dim truncate`: dates + optional ` · entry/exit only`. Tags pill: existing `rule-tags-pill` block verbatim (selected only), moved under row 2.
- **Lifecycle block** (new — `journal-mobile/MobileLifecycle.tsx`; renders when `selectedTrade !== null`):
  1. `LifecycleMasthead` (`px-4`; same gate: `!isPending && !isError && kind === "history"`; same `eyebrow` string).
  2. Heading row (`px-4`, `flex items-center justify-between`): kind caption verbatim + `⋯` overflow → Dialog (`max-w-xs`, `DialogTitle` `Journal` in `DIALOG_TITLE_CLASS` style) containing `<RebuildButton calendarId={trade.calendarId} />` (D-13).
  3. States (all `px-4`): loading skeleton / error+Retry / `PreHistoryStub` / `BuildingLifecycleStub` — components and copy verbatim, no `Panel` wrapper.
  4. Chart (`history` && `snapshots.length > 1`, D-12): `<div data-testid="lifecycle-pan" className="overflow-x-auto"><div className="w-[840px]"><LifecycleChart snapshots={snapshots} strike={trade.strike} onCrosshairChange={setHoveredIndex} /></div></div>` + layout effect scrolling to `scrollWidth`. Pan hint caption (`px-4 mt-1.5`, 9px dim) below.
  5. `Chart notes` `<details data-testid="chart-notes">` (`px-4`, closed): the two footnote lines verbatim (D-14).
- **Rail stack** (`px-4`, `flex flex-col gap-3`, D-15): `PnlBridgeCard snapshots hoveredIndex` → `EdgeCard` → `GreeksNowCard` → `BeatsCard beats` → Notes `Panel` with ENTER/EXIT/ROLL `RuleTagChips` blocks + textarea — the entire Notes JSX reused/duplicated verbatim from the desktop tree (strings identical; `RuleTagChips` imported from its D-04 home).

### 7. Desktop cleanup (final task, D-17)

Analyzer: drop `order-*` on the four wrappers; `analyzer-inner-grid` → `grid grid-cols-[300px_minmax(0,1fr)_330px] gap-4`; `analyzer-payoff-chart-bleed` → plain `div` (or remove the wrapper). Journal: `journal-positions` → `grid h-full grid-cols-[250px_minmax(0,1fr)_290px] gap-3 overflow-hidden p-3` with columns keeping `min-h-0 overflow-y-auto` (no `lg:` prefixes needed once the tree only mounts ≥1024px). Gate: 1440px before/after screenshots pixel-identical, both screens.

---

## Interaction Specs

| Interaction | Behavior |
|-------------|----------|
| Paste + Analyze | Existing `handlePasteAnalyze` semantics: parse-fail → error line, no card; success → pasted card pinned + auto-selected; CALL never sent to endpoint |
| Tap CandidateCard | `handleSelect` — scorecard/chart/disclosures re-render below (existing select semantics; ⊕/copy/× per-card buttons unchanged) |
| `All candidates (N)` | React-state reveal, `aria-expanded` flips, glyph `▸`→`▾`; second tap folds |
| `‹` / date pill / `›` / `⋯` | MobileChartControls — identical to live Overview behavior (Projection dialog quick-jumps/slider/date input; toggles dialog flips shared `toggles`) |
| Analyzer disclosures | Native `<details>` toggle; one tab stop closed; chart/panels mount only when open (real `open` attr — catch #24) |
| Tap TradeCard | `onSelect(trade.id)` — masthead/chart/rail re-render; selection never gated on snapshots/verdicts (catch #23) |
| `History (N)` | Existing toggle semantics + auto-open when zero open trades |
| Lifecycle pan | Horizontal swipe inside `overflow-x-auto`; initial position = latest; document never scrolls horizontally |
| Lifecycle crosshair | Touch-drag fires the existing `pointermove` path (localPoint math is width-agnostic); `PnlBridgeCard` syncs via `hoveredIndex`; tooltip positions within the 840px inner box |
| `⋯` (Journal) | Opens overflow Dialog → `Rebuild journal…` → nested confirm Dialog with existing Rebuild/Cancel semantics; Cancel unwinds one layer |
| `Chart notes` | Native `<details>` toggle |
| Scroll | Single document vertical scroll; only the Shell header is sticky |

---

## Accessibility Notes

- All disclosure states are REAL state: native `<details open>`, `aria-expanded` on the candidates/history toggles, Dialog portal state — no CSS reveals anywhere (catch #24).
- Paste input at 16px prevents iOS focus-zoom (D-18); all buttons route through `Button`/`buttonClass` (`size="touch"`, focus-visible violet ring baked in).
- TradeCard keeps keyboard operability (`role="button"`, `tabIndex`, Enter/Space) — parity with today's TradeRow.
- Nested Rebuild dialogs: each shadcn Dialog carries its own focus trap/escape/title; escape closes the topmost only.
- The lifecycle SVG keeps its existing `role="img"` + aria-label; the pan container is a plain scroll region (native semantics).
- Tab order = DOM order = visual order in both mobile trees; no CSS `order` anywhere in them.

---

## Validation Architecture

`36-VALIDATION.md` extracts from this section. jsdom asserts DOM structure/classes/attributes/behavior — never layout, bleed, scroll, or paint.

### jsdom-assertable (Vitest + @testing-library)

| # | Claim | Assertion sketch |
|---|-------|------------------|
| J1 | Analyzer default renders the MOBILE tree | `analyzer-mobile-root` present; `analyzer-inner-grid` absent |
| J2 | Analyzer matchMedia-stubbed desktop = today's tree | stub `(min-width: 1024px)` → `analyzer-inner-grid` + scorecard chips + `PayoffControls` present, `analyzer-mobile-root` absent; **existing Analyzer.test.tsx desktop tests migrate to the stub in the same plan as the switch** (byte-identity guard) |
| J3 | Journal default renders MOBILE; stubbed desktop = today's tree | `journal-mobile-root` vs `journal-positions`; **Journal.test.tsx migrates in the same plan as ITS switch** |
| J4 | Analyzer mobile DOM order | paste input precedes card list precedes `mobile-score` precedes `MobileChartControls` row precedes the three `<details>` (`compareDocumentPosition`) |
| J5 | Candidates fold | top 3 + pasted rendered; `all-candidates-toggle` shows `All candidates (N)`, `aria-expanded` flips and reveals the rest; absent when ≤3 scored |
| J6 | Rail states are bare prompts | loading/error/cold-start/zero-filtered testids + copy verbatim; no `Panel` gradient classes in those branches; `candidate === null` → no scorecard/chart/disclosure nodes |
| J7 | Scorecard contract | `mobile-score` = rounded score; checklist testids/icons/`w{n}`/`%` per `scoreStatus`; `fwdEdge` null → `— n/a`; θ GATE row; AH SESSION row iff after-hours; not-scored → note only; combined-book summary iff `bookCount > 1` |
| J8 | MobileChartControls extraction is byte-identical | **`MobileRiskPanel.test.tsx` passes with zero edits**; Analyzer mobile mounts the same testids (`date-pill`, `date-slider`, `date-picker-input`) driven by ITS `dateControl`/`toggles` |
| J9 | Analyzer mobile PayoffChart props | receives `todayCurveColor`/`expirationCurveColor`/`expectedMoveBand` AND `showBePills={false}`/`aspectRatio={1.3}`/`highlightedPositionId={null}`; desktop call sites pass neither mobile prop (grep/unit) |
| J10 | Analyzer disclosures | three `<details>` lack `open` by default; opening renders `TermStructureChart`/`WhyPanel`/`EntryExitPlan`; notScored candidate → `PASTED_NOT_SCORED_NOTE` inside each |
| J11 | TradeCard contract | open → OPEN badge and NO P&L span, no "open" text, no entry/exit chip node; closed → focal P&L with sign class (`—` dim on `""`); meta suffix ` · entry/exit only` iff non-history; select fires un-gated; selected → `ring-violet` |
| J12 | History + tags | `history-toggle` aria-expanded; auto-open when no open trades; `rule-tags-pill` on selected card only |
| J13 | Lifecycle mount | `lifecycle-pan` has `overflow-x-auto`; inner wrapper `w-[840px]`; `LifecycleChart` mounted with unchanged props; **`LifecycleChart.tsx` has zero diff this phase** (grep/git) |
| J14 | Journal states + demotion | four state branches verbatim; `RebuildButton` NOT in the top-level mobile flow; `⋯` dialog opens containing the `Rebuild journal for {id}` aria-label button; `chart-notes` details closed with both lines verbatim |
| J15 | Rail sync | crosshair callback wires `setHoveredIndex` → `PnlBridgeCard` receives it; Notes rule-tag blocks render per event fixtures (copy verbatim) |
| J16 | Full suite green | `bun run test` |

### chrome-devtools manual (390×844 emulation unless noted; 320px + 1440px spot checks)

| # | Claim |
|---|-------|
| C1 | Analyzer, nothing selected (cold start / zero candidates): paste+Analyze at top, one-line prompts only — ZERO hollow boxed shells anywhere on the screen |
| C2 | Both screens: `document.body.scrollWidth === window.innerWidth` at 390 AND 320 — including with the lifecycle pan container present |
| C3 | Analyzer: chart edge-to-edge (~300px tall), exactly one slim chrome row above it; Projection + ⋯ dialogs thumb-usable; term-structure chart fits its open disclosure without clipping (log follow-up if not — internals frozen) |
| C4 | **Journal lifecycle: the 60%-width dead-right-margin render is GONE** — chart fills the pan viewport edge-to-edge at designed 840px scale, labels legible at 1:1, initial position shows the latest days, swipe pans smoothly, touch-drag drives crosshair + P&L-bridge sync |
| C5 | Journal cards: focal P&L reads as THE number on closed trades; open trades show exactly one OPEN affordance; History folds/unfolds; selected card visibly violet |
| C6 | `⋯` → `Rebuild journal…` → confirm dialog stack works; Cancel unwinds one layer; confirm copy verbatim |
| C7 | 1440px: Analyzer AND Journal screenshots pixel-identical vs pre-phase baseline (run again after the D-17 cleanup task) |
| C8 | 320px: paste row, control row, checklist rows, trade cards — no wrap-break, no clip, no horizontal scroll |
| C9 | iOS-profile emulation: focusing the paste input does not zoom the page (16px input) |
| C10 | Resize across 1024px swaps trees on both screens without crash (state reset accepted) |
| C11 | **User phone check (the only bar): morai.wtf Analyzer + Journal read as designed mobile app screens on the real phone** |

---

## Desktop Regression Tripwires (1024px+ / 1440px)

### Analyzer
- [ ] Stubbed-desktop render: scorecard chip strip on top; 3-col `300px/minmax(0,1fr)/330px` grid; `Suggested calendars` Panel with paste row + full card rail (no top-3 fold); Risk profile Panel with `⧉ Copy TOS order` + `PayoffControls` ChipRail + BE pills; Term-structure Panel; Why/Entry-exit right column — all present, DOM byte-identical pre-cleanup.
- [ ] Desktop PayoffChart call site: `showBePills`/`aspectRatio` NOT passed; `be-pills` renders; picker curve colors/EM band unchanged.
- [ ] `PayoffControls.tsx`, `CandidateCard.tsx`, `WhyPanel.tsx`, `TermStructureChart.tsx`, `EntryExitPlan.tsx`, `PayoffChart.tsx` internals: zero diff this phase.
- [ ] `useAnalyzerModel` extraction: migrated Analyzer tests green under the stub; paste/combine/copy/repull behaviors identical.

### Journal
- [ ] Stubbed-desktop render: 3-col `250px/minmax(0,1fr)/290px` grid; TradeRow rows (OPEN badge + status text + history chip — desktop keeps ALL of today's affordances); `RebuildButton` visible in the chart heading row; always-visible footnotes; full rail — DOM byte-identical pre-cleanup.
- [ ] `LifecycleChart.tsx`, `LifecycleMasthead.tsx`, `PnlBridgeCard.tsx`, `EdgeCard.tsx`, `GreeksNowCard.tsx`, `BeatsCard.tsx`, `RebuildButton.tsx`: zero diff this phase.
- [ ] `JournalContainer.tsx` + `TradeSummary` contract: zero diff.

### Shared
- [ ] `MobileRiskPanel` post-extraction: `MobileRiskPanel.test.tsx` green with zero test edits; Overview mobile chart row pixel-identical (35.1's phone-checked state preserved).
- [ ] `useIsDesktop.ts`, `usePayoffDateControl.ts`, `Button.tsx`, `dialog.tsx`: zero diff.
- [ ] After D-17 cleanup: 1440px screenshots pixel-identical to pre-cleanup, both screens.

---

## What does NOT change

- Chart internals: `PayoffChart` (both additive props already exist), `LifecycleChart` (zero diff — D-12 is container-only), `TermStructureChart`, `MiniLine`/`EquityCurve`.
- Data layer & hooks: `usePicker`, `useAnalyzeCalendar`, `useRepullChains`, `useLifecycle`, `useRuleTags`, `useRebuildJournal`, `useJournal`; scenario engine, `tos-parser`, `candidate-to-position`, `payoff-domain`, `date-projection`.
- Overview (both trees) — except the byte-identical `MobileChartControls` extraction inside `MobileRiskPanel`.
- Shell, AuthExpiredBanner, Login, tokens, fonts, tracking scale — no new hex, no new fonts, no new deps.
- Desktop Analyzer + Journal visuals at ≥1024px — byte-identical (D-17 cleanup is `display`-invisible, screenshot-gated).
- `Analyzer 2.tsx` — stray file, never touched, never `git add`ed (executors: explicit `git add <paths>` only).

---

## Plan slicing suggestion (planner may adjust — 5 plans)

1. **Analyzer switch + model + shared chrome (byte-identity-guard plan)** — extract `useAnalyzerModel`, `Analyzer` switch (D-01), extract `MobileChartControls` from `MobileRiskPanel` (D-05, MobileRiskPanel tests untouched-green), migrate `Analyzer.test.tsx` to the matchMedia stub in the SAME commit as the switch, desktop DOM guard test (J1/J2/J8 partial).
2. **AnalyzerMobile tree** — paste block, candidates section + fold, `MobileScorecard`, `MobileAnalyzerChart`, disclosures (J4–J7, J9, J10).
3. **Journal switch + model (byte-identity-guard plan)** — extract `useJournalModel`, `Journal` switch (D-03), migrate `Journal.test.tsx` to the stub in the SAME commit, desktop DOM guard test (J3).
4. **JournalMobile tree** — `TradeCard`, trades section + History, `MobileLifecycle` (masthead/states/pan mount/⋯-Rebuild/chart-notes), rail stack (J11–J15).
5. **Cleanup + verification** — D-17 dead-branch removal on both desktop trees, 1440px screenshot gates, chrome-devtools pass C1–C10, then hand C11 to the user (J16).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none new — reuses installed Badge, Dialog | not required |
| third-party | none | not applicable |
