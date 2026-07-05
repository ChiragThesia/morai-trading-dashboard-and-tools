# Phase 22: Journal Calendar-Lifecycle Graph - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Mode:** Captured from live design session + deep-research (task wzp28eyel). Approved sketch: `mockups/journal-lifecycle-v3.html`.

<domain>
## Phase Boundary

**JRNL-01.** The Journal shows how ONE calendar trade evolved over its holding period (entry → now/exit)
as a stacked column of TIME-aligned panels, so a trader reads "how did this play out, and why" at a
glance. This is the project's north-star value ("how did price and greeks move over the life of this
trade?") made visual.

**In scope:**
- A read-only, per-calendar lifecycle visualization over the ALREADY-COLLECTED snapshot series
  (`GET /api/journal/:calendarId` / `leg_observations`). No new data collection.
- Two computed additions over that series: implied FORWARD vol, and per-interval greek-P&L ATTRIBUTION.
- Frontend (`apps/web` Journal screen) + whatever thin read use-case/route/contract is needed to serve
  the enriched series.

**Out of scope (do NOT build):**
- The price-on-x PAYOFF diagram — that is the Overview/Analyzer's job (forward scenario projection). This
  chart is TIME-on-x realized HISTORY. (Every prior-art tool — thinkorswim Risk Profile, OptionStrat,
  SpotGamma — is a forward price-on-x projection; the realized lifecycle view is the gap none fill.)
- New data collection / new snapshot cadence (SNAP-01 in Phase 20 already enriches the same series).
- Multi-trade comparison, an IV surface, or rule-tag overlays on the timeline (deferred).
</domain>

<decisions>
## Implementation Decisions

Grounded in deep-research (task wzp28eyel, adversarially verified) + the approved v3 sketch. These are
LOCKED — do not relitigate. Full research conclusions: memory `morai-journal-lifecycle-graph`.

### Design (research-grounded, verified)

- **D-01 — HERO = P&L ATTRIBUTION over time.** The top/dominant panel decomposes P&L into theta / vega /
  delta-gamma buckets PLUS an explicit unexplained RESIDUAL, over the trade's life. A calendar's story is
  "theta accrues, then one late move erases it" (Moontower: a 2.3% final-day move wiped all prior profit),
  so the chart MUST make the gamma-vs-theta collision near front expiry visible — not smooth theta accrual.

- **D-02 — The edge is implied FORWARD VOL, NOT the naive front-minus-back IV spread.** The "front minus
  back spread = edge" framing was adversarially REFUTED (0-3) across sources. Plot front IV, back IV,
  implied forward vol, and the front/back ratio as DISTINCT series; NEVER a blended/averaged vol line.
  Forward vol is surfaced as the edge; front/back are context.

- **D-03 — Greeks are SIGNED small-multiples, each on its own axis.** Delta / gamma / theta / vega each get
  their own panel (Javed & Elmqvist, IEEE 2010: different-scale series → split panels, never one overlay).
  Surface the long-vega / short-gamma / +theta calendar signature and the theta/gamma sign-flip. Horizon
  graphs are the sanctioned compression technique if vertical space is tight (Heer/Kong/Agrawala, CHI 2009).

- **D-04 — TIME on the x-axis; realized history entry→now/exit.** All panels share ONE date axis and a
  synced crosshair.

- **D-05 — Honest data.** Feed gaps (spot=0 / NaN snapshots — days the worker or IV-calibration lapsed)
  render as LINE BREAKS, never interpolated. The attribution residual is always shown, never hidden
  (attribution is only a 2nd-order Taylor approximation).

- **D-06 — Attribution is per-interval (local), accumulated.** Each interval's P&L ≈ greek × move in its
  variable (theta×Δt, vega×ΔIV, delta×ΔS + ½·gamma×ΔS², …), summed over the life; an explicit residual
  absorbs cross-terms (vanna/volga/charm) and higher-order error. Pick ONE decomposition convention
  (OAT / sequential-updating) and document it — results are convention-dependent.

- **D-07 — Forward vol formula:** σ_fwd = sqrt( (σ_back²·t_back − σ_front²·t_front) / (t_back − t_front) ),
  computed per snapshot from front/back IV + DTEs.

- **D-08 — Layout (from v3 sketch):** stacked column — (1) P&L attribution (hero), (2) vol & term structure
  (front/back/forward vol), (3) four signed greek small-multiple rows, (4) price vs strike. Right rail:
  P&L bridge (entry→theta→vega→Δ·Γ→residual→net), the forward-vol read, the greek signature, the beats.
  MORAI dark palette (violet/blue/amber/teal on `#0c0f16`). Verdict-first editorial masthead.

- **D-09 — One calendar at a time.** The graph shows the currently-selected calendar; a calendar picker
  drives it (list_calendars — open + closed).

### Claude's Discretion (planner/ui territory — not user-locked)
- Exact panel heights, crosshair/tooltip mechanics, event-annotation styling.
- Whether forward-vol + attribution compute in a core use-case (hexagon) or client-side (see Open Questions).
- Horizon-graph vs simple signed sparkline for the greek rows.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (ui-researcher, planner) MUST read these before planning.**

### Phase-level source of truth
- `mockups/journal-lifecycle-v3.html` — the APPROVED design sketch (layout, panels, palette, copy, crosshair).
  v1/v2 (`journal-lifecycle-v1.html`, `-v2.html`) are superseded — v2's "edge = spread" premise is WRONG (D-02).
- Deep-research report: task `wzp28eyel` output (prior art, dataviz best practices, calendar mental model,
  6 refuted claims). Conclusions distilled in memory `morai-journal-lifecycle-graph`.
- `.planning/REQUIREMENTS.md` → JRNL-01.

### Data (the series this chart draws)
- `GET /api/journal/:calendarId` (MCP `get_journal`) returns `{snapshots:[…]}`, ordered. Each snapshot has:
  `time, calendarId, spot, netMark, frontMark, backMark, frontIv, backIv, frontIvRaw, backIvRaw,
   netDelta, netGamma, netTheta, netVega, termSlope, dteFront, dteBack, pnlOpen, source`.
  REALITY CHECK: the series is SPARSE — early snapshots carry `spot:"0"` + `NaN` greeks/IV; only later
  snapshots have clean greeks. The chart must handle that (D-05). `pnlOpen` is unrealized P&L in cents.
- `list_calendars` / `GET /api/calendars` — the calendar picker source (open + closed; strike, front/back
  expiry, openNetDebit, openedAt/closedAt, status).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/src/screens/Journal.tsx` — the current (list/empty) Journal screen this replaces/augments.
- `apps/web/src/hooks/useRuleTags.ts` / a `useJournal`-style hook — react-query pattern for `/api/journal/:id`
  (NOTE: fix the empty-`calendarId` guard bug — `enabled: !!calendarId` — see memory `morai-phase20-executed-deployed`).
- `apps/web/src/components/PayoffChart.tsx` + Overview payoff — the project's SVG chart idioms (scales, paths,
  breakeven markers, crosshair) to match style.
- `@morai/quant` bsm engine + `packages/core` scenario-engine — greek/IV math already in-repo (for any
  server-side forward-vol / attribution compute).
- `apps/web/src/lib/deriveStreamStatus.ts` — precedent for a pure, test-first derivation fn (attribution
  math should be a pure, unit-tested function the same way).

### Established Patterns
- Hexagonal: if compute moves server-side, it's a `ForVerbing…` port + core use-case (e.g.
  `getCalendarLifecycle`) + adapter + contract (Zod), consumed by a web hook — mirror Phase 19's picker path
  (19-07/19-09) and Phase 20's `getCalendarEventsWithRules` read use-case.
- Contracts-first, TDD red→green, no `any`/`as`/`!`. Feed gaps parsed honestly (NaN/0 → typed gap markers).

### Integration Points
- Journal nav tab already exists (Overview / Analyzer / Journal). This is the Journal screen's content.
- The snapshot series is already served; the phase adds forward-vol + attribution on top of it.
</code_context>

<specifics>
## Specific Ideas
- Match the v3 sketch closely: verdict-first masthead ("Theta's carrying it — then the move took a bite"),
  attribution hero with the "gamma bit −$X" callout, forward-vol as the amber hero line, signed greek rows,
  P&L bridge in the rail, honest-caveats footer.
- Copy is verdict/plain-language (per frontend-design): name what the trader controls, describe what happened.

## Open Questions (for ui-phase / plan-phase to resolve)
- **Placement:** is this the DEFAULT Journal view (replacing today's empty list), or a per-calendar drill-down
  you click into from a calendar list? (Leaning: calendar picker at top → lifecycle below.)
- **Compute location:** forward-vol + per-interval attribution in a core use-case (hexagon-pure, testable,
  reusable by MCP) vs client-side in the web hook. (Leaning: core use-case, for testability + MCP reuse.)
- **Attribution idiom:** the hero cumulative panel is stacked-area (v3); the rail is a waterfall bridge. Keep
  both, or consolidate? Research left this unresolved (stacked-area = cumulative; waterfall = entry→now bridge).
- **Attribution algorithm:** OAT vs sequential-updating — pick one, document; state the residual convention.
- **New route vs extend `get_journal`:** add `GET /api/journal/:calendarId/lifecycle` (enriched) vs enrich the
  existing snapshot payload.
</specifics>

<deferred>
## Deferred Ideas
- Rule-tag (RULE-01) overlay as event beats on the lifecycle timeline — fold in once RULE-01 data accrues.
- Multi-calendar comparison / small-multiples across trades.
- IV surface / full term-structure ribbon at a point-in-time.
- Realized-vs-implied move overlay, GEX walls at each snapshot.
</deferred>
