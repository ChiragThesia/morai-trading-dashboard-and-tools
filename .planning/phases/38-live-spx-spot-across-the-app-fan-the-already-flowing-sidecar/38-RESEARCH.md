# Phase 38: Live Market Data via Sidecar (SPX Spot + VIX Family) - Research

**Researched:** 2026-07-13
**Domain:** SSE plumbing (Python sidecar → Hono server fan-out → EventSource React hook), Schwab
quote/streaming API surface for cash indices
**Confidence:** MEDIUM-HIGH (plumbing: HIGH, verified against live code; VIX-family Schwab symbol
format: MEDIUM, pattern-consistent but not live-smoke-tested this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stream semantics (Area 1):**
- Q1: New dedicated SSE event type(s) alongside `ticks`/`fills`/`reconcile`/`ping` — additive
  contract, old clients unaffected. Spot event `{spot, ts}`; VIX-family frames may share one
  `indices` event or per-symbol events (Claude's discretion, keep additive).
- Q2: Server throttle: on-change only, max 1 frame/sec per symbol. No unchanged-value
  keepalives — `ping` already proves liveness.
- Q3 (discretion, user deferred): Dedicated sidecar subscriptions/polls for `$SPX` + VIX family —
  research verifies whether the streamer's level-one service accepts index symbols; REST
  `get_quotes` polling (~1-5s spot, ~15-30s VIX family is fine) is the accepted fallback path.
  Existing `underlyingPrice` piggyback remains a redundant spot source; never the sole one.
  User's architecture intent is explicit: pull through the sidecar, sole live source.
- Q4: No server-side RTH gating — forward what the feed sends; the UI's existing quiet/stalled
  badge machinery owns staleness display.

**Web consumption + display (Area 2):**
- Q1: ALL surfaces go live: header SPX chip, Overview payoff spot marker + T+0 recompute,
  gamma-profile spot marker, net-greeks calc, mobile Overview hero, AND the regime-rail
  VIX/VVIX/ratio gauges show live values. Gauge WARN/CRISIS band coloring may reflect the live
  value visually, but the ENTRY GATE verdict chip and any stored regime state remain EOD-driven
  (display-live/gate-EOD LAW).
- Q2: Honest badges (catch #26 law): live tint only while stream status = live; quiet/stalled →
  stored EOD/snapshot value with existing stale styling ("EOD · as of…"). Never silently mix
  live and stale.
- Q3: Recompute per frame (≤1/sec by server design); no extra client debounce unless profiling
  shows jank.
- Q4 (discretion, user deferred): Analyzer = display marker only. Candidate scoring/scenario
  baselines stay on picker-snapshot spot — deterministic analysis, no re-score churn. Re-scoring
  on live spot explicitly deferred.

**Locked earlier (2026-07-13 conversation, pre-discuss):**
- `underlyingPrice` already reaches the server per option tick (sidecar-sse.ts:260, `observeSpot`
  site) — broadcast hook goes there for the piggyback path.
- Contract-first: schemas in `packages/contracts` (stream-events.ts), additive only.
- `useLiveStream` exposes the new live values (e.g. `liveSpot`, `liveIndices`).
- AH/weekend honesty via existing `deriveStreamStatus` (live/quiet/stalled) machinery.
- Sidecar is the sole Schwab boundary — TS never talks to Schwab directly (arch law).

### Claude's Discretion
- Exact event naming/shape (one `indices` event vs per-symbol), sidecar poll vs subscribe per
  symbol (research-driven — **research recommends REST poll, see below**), hook API shape,
  gauge live-tint styling.

### Deferred Ideas (OUT OF SCOPE)
- Candidate re-scoring on live spot (engine work, flapping risk — own phase if ever).
- Ticking GEX walls/term-structure curves (chain-wide recompute cost — separate).
- Live HY OAS/rates alternatives (not broker data; FRED cadence stands).
</user_constraints>

<phase_requirements>
## Phase Requirements

No `REQUIREMENTS.md` IDs are mapped to this phase (user-added phase; scope is fully defined by
`38-CONTEXT.md`'s locked decisions above). The planner should use the CONTEXT.md decisions as
the requirement set.
</phase_requirements>

## Summary

Two independent data flows, and they are **not symmetric in implementation cost**:

**SPX spot needs zero new Schwab calls.** The sidecar's existing `LEVELONE_OPTIONS` subscription
already carries `UNDERLYING_PRICE` on every option tick (`apps/sidecar/streamer.py:77,215`), and
that value already reaches the server today at the `observeSpot` call site
(`apps/server/src/adapters/http/sidecar-sse.ts:260-269`) — it is just never broadcast to
browsers. Task 1 is purely additive plumbing: one new SSE event type, one new broadcast hook
next to the existing `observeSpot` call, one new `useLiveStream` field, and rewiring the handful
of places that read `gex.spot`/`spot` to prefer the live value when the stream is live.

**The VIX family requires new sidecar work.** `schwab-py` 1.5.1 (the pinned, installed version —
verified against `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py`) exposes
these streaming services: `ACCT_ACTIVITY`, `CHART_EQUITY`, `CHART_FUTURES`, `LEVELONE_EQUITIES`,
`LEVELONE_FOREX`, `LEVELONE_FUTURES`, `LEVELONE_FUTURES_OPTIONS`, `LEVELONE_OPTIONS`,
`NASDAQ_BOOK`, `NYSE_BOOK`, `OPTIONS_BOOK`, `SCREENER_EQUITY`, `SCREENER_OPTION`. **There is no
dedicated indices streaming service**, and there is no codebase precedent or verified evidence
that `LEVELONE_EQUITIES` accepts `$`-prefixed cash-index symbols. REST polling via
`Client.get_quotes(symbols, ...)` is the verified-safe path: its docstring states it "supports
all symbols, including those containing non-alphanumeric characters" (`client/base.py:477-503`),
and this exact codebase already proves the `$`-prefixed index-symbol convention works against
Schwab's live API — `apps/sidecar/chain_proxy.py:35-40` hard-codes `$SPX` after a live 400 error
on bare `SPX`/`SPXW`. Recommend: **do not attempt a live `LEVELONE_EQUITIES` subscription for
indices this phase** — build a REST poll loop (~20s) in the sidecar instead, matching the user's
own accepted fallback (Q3).

**Primary recommendation:** Ship spot and indices as two independent additive SSE event types
riding the *same* existing `event_queue` → `/sidecar/events` → `sidecar-sse.ts` →
`stream-fan-out.ts` → `/api/stream` → `useLiveStream` pipe already proven for greeks. No new
sidecar routes, no new server routes, no new EventSource connection. The hardest part of this
phase is not the plumbing — it's the fact that **two independent "spot" values already exist** in
`useOverviewModel.ts`/`Overview.tsx` today (see Pitfall 1) and the plan must collapse them to one
live-aware source, not bolt live spot onto only one of the two.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SPX spot capture (from option ticks) | Driven adapter (sidecar, unchanged) | — | Already flows; `UNDERLYING_PRICE` field on `LEVELONE_OPTIONS` |
| VIX-family capture (new) | Driven adapter (sidecar) | — | New REST poll loop against `market_client.get_quotes` |
| Sidecar → server event transport | Driven adapter (sidecar `stream_proxy.py`) | API/Backend (server `sidecar-sse.ts`) | Existing `/sidecar/events` SSE generator is payload-agnostic (any dict on `event_queue` is framed) — no proxy change needed |
| Browser fan-out + throttle | API/Backend (`stream-fan-out.ts`) | — | Same 1s coalescer interval already running (`startFlushInterval`); add sibling buffers, on-change gate |
| Live display (spot, VIX gauges) | Browser/Client | — | `useLiveStream` + `Overview.tsx`/`MarketRail.tsx`/`RegimeBoard.tsx` |
| Regime gate verdict / crisis bands (state) | API/Backend (`getRegimeBoard.ts`, `entry-gate.ts`) | — | UNCHANGED — stays EOD `macro_observations`-driven per display-live/gate-EOD LAW |
| Client-side visual re-banding of live gauge value | Browser/Client | Core (pure fn reuse) | Reuse `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio` from `@morai/core` — same functions the server uses, already re-exported for exactly this purpose (see Pattern 3) |

## Standard Stack

No new runtime dependencies for either language. This phase is wiring, not new tooling.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| schwab-py | 1.5.1 (pinned, installed — verified `apps/sidecar/requirements.txt:6`) | REST `get_quotes` for VIX family | Already the sole Schwab boundary; do not upgrade (D22 pin note in requirements.txt) |
| zod | existing (`packages/contracts`) | New event schemas | Existing contract-first pattern |
| hono/streaming | existing | SSE fan-out | Existing `streamSSE`/`writeSSE` already used for `ticks`/`ping`/`reconcile` |
| EventSource (browser built-in) | — | Client stream consumption | Existing `useLiveStream.ts` — no new client library |

### Supporting
No new supporting libraries. `asyncio` (stdlib) for the new sidecar poll loop, matching the
existing `_trader_token_keepalive` shape in `apps/sidecar/main.py:61-92`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| REST poll for VIX family | `LEVELONE_EQUITIES` streaming subscription with `$VIX` etc. | Unverified against live Schwab API this session (no codebase precedent, no official doc found); higher implementation/testing risk for a ~15-30s-acceptable cadence the user already blessed as REST. **Recommend REST.** |
| One `indices` event (batched) | 4 separate per-symbol events (`vix`, `vvix`, `vix9d`, `vix3m`) | Batched is simpler (1 schema, 1 poll response maps 1:1), matches how the poll naturally returns all 4 at once, and matches `getRegimeBoard.ts`'s existing "read all series, compute what's present" idiom. Per-symbol events add ceremony with no benefit since all 4 always poll together. **Recommend one batched `indices` event.** |

**Installation:** None — no `npm install` / `pip install` needed.

**Version verification:** `schwab-py` pinned at exactly `1.5.1` per `apps/sidecar/requirements.txt:6`
comment ("D22 — never upgrade without research review"); confirmed installed at
`apps/sidecar/.venv/lib/python3.14/site-packages/schwab/version.py` (`version = '1.5.1'`). Do not
bump for this phase.

## Package Legitimacy Audit

**Not applicable** — this phase installs no new packages in any ecosystem. No `npm install` /
`pip install` step exists in the recommended approach.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SIDECAR (Python, apps/sidecar/)                                         │
│                                                                           │
│  Schwab WSS (existing)                    Schwab REST (new poll, ~20s)  │
│   LEVELONE_OPTIONS tick                     market_client.get_quotes(   │
│   → UNDERLYING_PRICE field                    ["$VIX","$VVIX",         │
│   (streamer.py:_on_level_one_option)           "$VIX9D","$VIX3M"])     │
│         │ (unchanged, already flows)                │ (NEW loop)        │
│         ▼                                           ▼                   │
│  event_queue.put_nowait(                    event_queue.put_nowait(     │
│    {type:"level_one_option", ..., ts})  {type:"indices", values:{...},ts}│
│         └──────────────────┬───────────────────────┘                   │
│                             ▼                                           │
│              GET /sidecar/events (stream_proxy.py — UNCHANGED,          │
│              payload-agnostic: any dict on event_queue is JSON-framed)  │
└──────────────────────────────┬──────────────────────────────────────────┘
                                ▼ (HTTP SSE, private network)
┌─────────────────────────────────────────────────────────────────────────┐
│ SERVER (apps/server/src/adapters/http/)                                 │
│                                                                          │
│  sidecar-sse.ts: dispatchFrame()                                        │
│    existing tick branch → deps.observeSpot?.(spot, ts)  [UNCHANGED]     │
│                          → deps.broadcastSpot?.(spot, ts)  [NEW]        │
│    new "indices" branch → deps.broadcastIndices?.(values, ts)  [NEW]    │
│         │                              │                                │
│         ▼                              ▼                                │
│  stream-fan-out.ts: bufferTick()  bufferSpot()/bufferIndices() [NEW]    │
│  (existing 1s interval, startFlushInterval — same timer, new siblings) │
│         │                              │                                │
│         ▼ event:"ticks"                ▼ event:"spot" / event:"indices"│
│  GET /api/stream (stream.routes.ts — UNCHANGED, same SSE connection)   │
└──────────────────────────────┬──────────────────────────────────────────┘
                                ▼ (EventSource, browser)
┌─────────────────────────────────────────────────────────────────────────┐
│ WEB (apps/web/src/)                                                     │
│                                                                          │
│  useLiveStream.ts: existing "ticks"/"ping" listeners                    │
│                     + new "spot"/"indices" listeners → liveSpot,        │
│                       liveIndices state                                 │
│         │                                                               │
│         ▼                                                               │
│  useOverviewModel.ts: ONE spot computation                              │
│    spot = (liveStatus==="live" && liveSpot!==null) ? liveSpot           │
│                                                    : (gex?.spot ?? 5800)│
│         │                          consumed by ALL of:                 │
│         ├─ PayoffChart (T+0 marker)      ├─ PillHeader SPX chip (NEW:  │
│         ├─ PositionsTable / net-greeks   │   must switch off gex.spot) │
│         ├─ GammaProfile spot marker      ├─ MobileHero / MobileRiskPanel│
│         └─ GexBars spot marker (parity)  └─ keyLevelsFor "Spot" row    │
│                                                                          │
│  MarketRail.tsx → RegimeBoard.tsx: liveIndices threaded in, live ratio  │
│    computed client-side, re-banded via imported bandVixTermStructure/  │
│    bandVvix/bandVix9dRatio (@morai/core, pure fns) — value + marker    │
│    live-tinted; indicator.band (server EOD) untouched for the entry    │
│    gate (display-live/gate-EOD LAW)                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Pattern 1: Additive SSE event via the existing payload-agnostic sidecar generator
**What:** `stream_proxy.py`'s `stream_events` generator (`apps/sidecar/stream_proxy.py:75-87`) does
`yield f"data: {json.dumps(event)}\n\n"` for **whatever dict** comes off `event_queue` — it has no
schema/type switch. Any new frame shape can be pushed onto `event_queue` without touching this
file.
**When to use:** Every new sidecar-originated event this phase (`indices`, and the `spot` field
riding the existing tick dict, or a separate `spot`-typed dict if you choose to emit one).
**Example:**
```python
# apps/sidecar/streamer.py or a new indices-poll module — pattern only, not exact code:
event_queue.put_nowait({
    "type": "indices",
    "ts": utc_now_z(),          # streamer.py:43-54 — MUST end in "Z", never "+00:00"
    "values": {"VIX": 15.2, "VVIX": 92.1, "VIX9D": 14.8, "VIX3M": 16.5},
})
```

### Pattern 2: Dispatch-by-shape at the sidecar-sse.ts trust boundary
**What:** `dispatchFrame()` (`apps/server/src/adapters/http/sidecar-sse.ts:217-284`) currently
Zod-parses every frame against ONE schema (`sidecarTickSchema`) and silently drops anything that
doesn't match (T-12-05-04). An `indices` frame will fail that schema and be dropped **by design**
today — this is correct/safe, but means the new frame type needs its OWN schema + its own
`safeParse` branch before (or instead of) the existing one, mirroring how `observeSpot` is an
optional injected callback fired only on a successful tick parse+condition
(`rawTick.underlyingPrice !== null && rawTick.underlyingPrice > 0`, line 260).
**When to use:** Adding the `indices` frame type. The `spot` broadcast does NOT need a new schema
— reuse the already-parsed `rawTick.underlyingPrice`/`rawTick.ts` at the exact same guarded site
as the existing `observeSpot` call (lines 260-269), adding one sibling call:
```typescript
// apps/server/src/adapters/http/sidecar-sse.ts — pattern at the existing observeSpot site:
if (rawTick.underlyingPrice !== null && rawTick.underlyingPrice > 0) {
  try {
    deps.observeSpot?.(rawTick.underlyingPrice, rawTick.ts);   // UNCHANGED (SNAP-01)
  } catch (e: unknown) { /* unchanged swallow */ }
  try {
    deps.broadcastSpot?.(rawTick.underlyingPrice, rawTick.ts); // NEW — same guard, same swallow
  } catch (e: unknown) { /* swallow, log name only, never sever the stream (CR-01 precedent) */ }
}
```
For the new `indices` frame type, add a **second, independent** Zod schema
(`sidecarIndicesSchema = z.object({ type: z.literal("indices"), values: z.record(z.string(),
z.number()), ts: z.string() })`) and try that `safeParse` in `dispatchFrame` — on success, call
`deps.broadcastIndices?.(values, ts)` and return early (don't fall through to the tick schema).

### Pattern 3: Reuse the server's own pure banding functions client-side (already-established precedent)
**What:** `bandVixTermStructure`, `bandVvix`, `bandVix9dRatio` (`packages/core/src/analytics/domain/regime.ts:27-58`)
are pure functions (`(value, {warn, crisis}?) => "calm"|"warning"|"crisis"`) with **zero
ports/adapters** — the file's own docstring states "imports nothing." They are already
re-exported from `@morai/core`'s root index specifically for client-side use: `packages/core/src/index.ts:592`'s
comment reads *"32-06: regime band classifiers, re-exported so the web modal's client-side
preview re-band..."* — and `apps/web/src/hooks/useRuleSettingsPreview.ts` already imports and
calls all three today for the Rule Settings modal's staged-change preview.
**When to use:** Computing the LIVE band tint for the 3 broker-quotable regime-rail gauges
(`vix-term-structure`, `vvix`, `vix9d-vix`) without duplicating threshold logic. Call the imported
function with `{ warn: indicator.bandWarn, crisis: indicator.bandCrisis }` (the indicator's own
Phase-29-effective thresholds, already in the `RegimeIndicator` payload — `packages/contracts/src/regime.ts:21-22`)
so a live tint reflects the SAME effective bands the server would compute, without importing
`getRegimeBoard.ts` or any port.
**Example:**
```typescript
// apps/web/src/hooks/useRuleSettingsPreview.ts:12-14,55-57 — the EXISTING precedent:
import { bandVixTermStructure, bandVvix, bandVix9dRatio } from "@morai/core";
const BANDERS = {
  "vix-term-structure": bandVixTermStructure,
  vvix: bandVvix,
  "vix9d-vix": bandVix9dRatio,
};
// Phase 38 usage — same import, same call shape, only the input value changes (live vs staged):
const liveBand = BANDERS[indicator.id]?.(liveRatioOrLevel, { warn: indicator.bandWarn, crisis: indicator.bandCrisis });
```

### Recommended Sidecar Poll Loop Placement
Add a new function `start_indices_poll(app)` in `apps/sidecar/streamer.py` (co-located with the
`event_queue` it pushes to, mirroring `start_streamer`'s shape/naming), created via
`asyncio.create_task` in `apps/sidecar/main.py`'s `_acquire_lock_and_init` **alongside**
`keepalive_task` and `streamer_task` (main.py:201-207) — same lifecycle: created after
`_init_schwab_clients`, cancelled in the same `finally` block on lock loss/shutdown
(main.py:229-237). Use `app.state.market_client` (NOT `trader_client` — quotes are a market-data
call, matching the existing chain-fetch convention in `chain_proxy.py` which also calls
`app.state.market_client`). Poll interval: a module constant (e.g. `INDICES_POLL_INTERVAL_S =
20.0`), matching the existing style of hardcoded interval constants in `main.py`
(`TRADER_KEEPALIVE_MARGIN`, `HEARTBEAT_SECONDS`) rather than a new `SidecarConfig` field — no
existing precedent adds a config field for a tunable that doesn't vary per environment.

### Anti-Patterns to Avoid
- **Don't gate the entry-gate/regime `band` field on live values.** `RegimeBoard.tsx`'s
  `indicator.band` (server-computed, EOD) must keep driving the marker-color CSS classes
  (`BAND_CLASSES`/`MARKER_CLASSES`) for anything that isn't an explicit visual live-tint overlay.
  The picker's `PickerGate`/`GateChip` (`RegimeBoard.tsx:216-255`) reads a **separate** data
  source (`usePicker()`) and must not be touched at all this phase — it's out of scope structurally,
  not just by convention.
- **Don't let a bad/malformed `indices` frame kill the stream.** Follow the existing
  `dispatchFrame` swallow-and-drop discipline (T-12-05-04) and the `observeSpot` swallow-and-log
  discipline (CR-01, sidecar-sse.ts:256-269) for the new `broadcastIndices`/`broadcastSpot`
  callbacks — a throwing callback must never propagate into `connectToSidecarStream`'s reader
  loop.
- **Don't add a second EventSource connection.** `useLiveStream.ts`'s docstring and D-06/D-01
  precedent are explicit: exactly one stream consumer per surface. New event types ride the
  SAME `es` instance via `es.addEventListener("spot", ...)` / `es.addEventListener("indices",
  ...)`, exactly like the existing `"ticks"`/`"ping"` listeners (useLiveStream.ts:222-259).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client-side regime banding | A new threshold-comparison function in web | `bandVixTermStructure`/`bandVvix`/`bandVix9dRatio` from `@morai/core` | Already pure, already exported, already used client-side (Phase 32 preview) — reimplementing risks the live tint drifting from the server's Phase-29-overridden thresholds |
| SSE fan-out to N browsers | A new pub-sub registry | Extend `stream-fan-out.ts`'s existing `clients: Set<SSEClient>` + the same 1s `startFlushInterval` timer | One fan-out hub already handles dead-client cleanup (2 paths) and coalescing; a second hub duplicates that logic and risks drift |
| Sidecar → server transport for a new payload shape | A second `/sidecar/*` endpoint | The existing `event_queue` + `/sidecar/events` generator (Pattern 1) | The generator is already payload-agnostic; a second endpoint means a second SSE consumer connection server-side, doubling reconnect/backoff logic for no benefit |

**Key insight:** This phase's entire risk surface is in NOT duplicating existing infrastructure —
every piece needed (fan-out hub, coalescing timer, EventSource hook, dead-client cleanup, Zod
trust boundary, band-classifier functions) already exists for the greeks path and was built to be
extended. The only genuinely new code is the sidecar's VIX-family REST poll loop.

## Common Pitfalls

### Pitfall 1: Two "spot" values already coexist in Overview — the plan must collapse both, not just one
**What goes wrong:** `useOverviewModel.ts:392` computes `const spot = gex?.spot ?? 5800;` and
threads it into the payoff chart, `PositionsTable`/net-greeks, and mobile hero/risk-panel. But
`Overview.tsx`'s `PillHeader` (desktop header SPX chip, line 468) and `GexRail` (`GammaProfile`
line 395, `GexBars` line 401) read `gex.spot` **directly** — bypassing the model's `spot`
entirely. `keyLevelsFor`'s "Spot" row (`useOverviewModel.ts:287`) also reads raw `gex.spot`. If
the plan only makes the model's `spot` live-aware, the header chip and GEX-rail spot markers
(which CONTEXT.md Q1 explicitly names as in-scope: "header SPX chip", "gamma-profile spot
marker") will silently stay on the 30-min GEX snapshot value while the payoff chart goes live —
a visible inconsistency (two different "SPX" numbers on screen at once).
**Why it happens:** `PillHeader` and `GexRail` were written before any live-spot concept existed;
they take `gex` as a whole prop rather than a resolved `spot` value.
**How to avoid:** Compute the live-aware `spot` ONCE inside `useOverviewModel()` (already the
single state/derivation owner per its own docstring), return it as today, AND pass it explicitly
into `PillHeader`/`GexRail` as a new prop (replacing their internal `gex.spot`/`gex !== undefined
? gex.spot... : "—"` reads). `GammaProfile`'s `spot` prop and `GexBars`' `spot` prop are visual
markers overlaid on the (unchanged, 30-min) wall/flip lines — going live only moves the marker
position, it does not touch wall computation, so this is safe and matches "gamma-profile spot
marker" being explicitly in scope.
**Warning signs:** Grep for `gex.spot` and `gex?.spot` in `Overview.tsx`/`useOverviewModel.ts`
after the change — any remaining direct read outside the honest-badge fallback expression itself
is a live surface the plan missed.

### Pitfall 2: The VIX-family Schwab quote symbol format is verified for `$SPX` only — treat the other three as unconfirmed
**What goes wrong:** `$SPX` is proven live in this exact codebase (`chain_proxy.py:35-40`,
"proven live" comment after a 400 error on bare `SPX`). The `$`-prefix convention for cash
indices is corroborated by Schwab's own Index Symbols documentation and multiple independent
sources (dollar-prefix format, e.g. `$DJI`, `$COMPX`, `$SPX`) found via web search this session —
but no source or codebase evidence confirms the EXACT tickers for VIX3M/VIX9D on Schwab's
`/marketdata/v1/quotes` (is VIX3M `$VIX3M`, or something else? CBOE's own ticker for this index is
`VIX3M`; FRED's series id `VXVCLS` is a Fed-internal name, not a market symbol). This is the one
genuinely unverified fact in this research — everything else is confirmed against installed
source or live-proven codebase precedent.
**Why it happens:** Verifying this needs a live authenticated call against Schwab's REST API,
which this research session cannot make (no sidecar credentials/running instance available to
the researcher).
**How to avoid:** Ship the poll loop defensively: request all 4 symbols in ONE `get_quotes` call
(`["$SPX", "$VIX", "$VVIX", "$VIX9D", "$VIX3M"]`), and treat each symbol's presence/absence in the
response **independently** — a symbol Schwab doesn't recognize either 400s the whole batch call
(requiring a fallback to per-symbol calls with individual try/except) or returns a per-symbol
error-shaped entry in the response body (Schwab's typical multi-symbol quote behavior). The FIRST
plan task touching this should include a `checkpoint:human-verify` step: hit the real
`get_quotes(["$VIX","$VVIX","$VIX9D","$VIX3M"])` once against a live authenticated sidecar and
record the actual response shape/symbol validity BEFORE building the parsing/mapping logic
around an assumed shape.
**Warning signs:** A 400 from `get_quotes` on the batched call (Schwab quote endpoints sometimes
reject a whole batch if one symbol is invalid, unlike `get_option_chain`'s single-symbol
behavior) — if this happens, the fallback is 4 individual `get_quote(symbol)` calls, each
independently try/excepted so one bad symbol doesn't drop the other three.

### Pitfall 3: Schwab index quotes may not populate `mark`/bid/ask — only `lastPrice`
**What goes wrong:** Cash indices (unlike equities/options) have no market maker quoting a
bid/ask — Schwab's quote response for `$SPX`/`$VIX` is documented (developer-portal quote schema,
general knowledge of Schwab/TDA quote responses) to populate `quote.lastPrice` reliably but
`bid`/`ask`/`mark` may be null or absent for index symbols. If the poll-response parser assumes
the same shape as the equity/option quote schema, it may silently read `undefined`/`null` for the
one field it actually needs.
**Why it happens:** Assuming index quotes look like equity quotes.
**How to avoid:** In the sidecar's parsing of the `get_quotes` response for indices, read
`quote.lastPrice` (or `quote.mark` if present, falling back to `lastPrice`) — do not require
`bid`/`ask` to be present. This mirrors the existing option-tick handler's own defensive
`item.get("MARK", item.get("37"))` fallback style (`streamer.py:212-220`) — same "field may be
absent, degrade gracefully" discipline already established in this codebase.
**Warning signs:** All-null VIX values reaching the browser despite a 200 response from
`get_quotes` — check which field name the sidecar is actually reading.

### Pitfall 4: React re-render cost of a 1/sec spot tick across many consumers
**What goes wrong:** `useOverviewModel()` already re-renders `OverviewDesktop`/`OverviewMobile`
on every greek tick (existing behavior, unchanged) — adding a `liveSpot` state update on the SAME
cadence via the SAME hook does not introduce a NEW re-render category, but the "gauge live-tint"
work in `RegimeBoard.tsx` (rendered inside `MarketRail`, a sibling that re-renders independently
today) would newly become tick-coupled if `liveIndices` is threaded through `MarketRail` naively
via prop-drilling from `Overview.tsx`, potentially causing the whole three-column grid
(`MarketRail`/center/`GexRail`) to re-render together at 1/sec instead of each column updating
independently as before.
**Why it happens:** The codebase has no existing global stream-state provider — `useLiveStream()`
is called once per screen inside `useOverviewModel()` (D-06 single-consumer rule) and its return
value flows down through props/the hook's own return object. There's no React Context for stream
data.
**How to avoid:** `MarketRail`/`RegimeBoard` currently have ZERO props threading indicator data
(`RegimeBoard` calls its own `useRegimeBoard()`/`usePicker()`/`useMacro()` hooks internally,
independent of `Overview`'s render). Preserve that isolation: call `useLiveStream()`'s
live-indices slice from a NEW small hook consumed directly inside `RegimeBoard.tsx` (or accept
`liveIndices`/`liveStatus` as props ONLY if `useLiveStream` truly must stay a single call site
per D-06 — in which case memoize the passed-down value so `MarketRail`'s child tree doesn't
re-render on every OTHER live-greek tick, only on an actual VIX-family change, which is ~20s not
1s). Do not let a 1/sec spot tick force the entire regime board to re-render 3x more often than
its own ~20s VIX-poll cadence warrants.
**Warning signs:** React DevTools Profiler showing `RegimeBoard` re-rendering at greek-tick
cadence (1/sec) rather than at indices-poll cadence (~20s).

### Pitfall 5: jsdom test doubles must not coincide with the new live values (catch #20 lesson, restated)
**What goes wrong:** Phase 33's catch #20 (documented in project memory) found that custom chart
layers using module-constant scales instead of the real coordinate-system hooks passed tests
ONLY because jsdom's test fixture values coincidentally matched the constants — the bug was
invisible in the suite and only surfaced in a real browser. The equivalent risk here: if a test
fixture for `liveSpot` happens to equal `gex.spot` (e.g. both default to some round test number
like 5800), a test asserting "the live spot renders" could pass even if the code is actually
still reading the stale `gex.spot` path.
**Why it happens:** Convenient round numbers in test fixtures collide with fallback defaults.
**How to avoid:** In every new/updated test for live-spot display, use a `liveSpot` value that is
DELIBERATELY DIFFERENT from any `gex.spot`/`DEFAULT` fallback value in the same test (e.g.
`gex.spot = 5800`, `liveSpot = 5842.375`) so an assertion on the rendered number can only pass if
the live path is actually wired.
**Warning signs:** A test where `liveSpot` and the EOD fallback spot share the same literal value.

### Pitfall 6: VIX-family symbols outside RTH / weekend — don't assume the poll always returns fresh data
**What goes wrong:** `chain_proxy.py`'s own established discipline is "forward what the feed
sends; let the client-side stale badge own honesty" (matches CONTEXT.md Q4: "No server-side RTH
gating"). A naive implementation might try to skip polling outside RTH to save API calls, which
then means the FIRST poll after market open has a multi-hour-stale `ts`, silently violating the
honest-badge law (Q2) if the client doesn't independently validate freshness. Schwab quote
responses for indices outside RTH typically freeze at the prior session's close value with a
stale `quoteTime` — some equity indices don't even update after-hours the way options do.
**Why it happens:** Reasoning "why poll a closed market" without considering the badge-honesty
contract.
**How to avoid:** Keep polling on the SAME fixed interval regardless of RTH (mirrors the existing
`_trader_token_keepalive`'s "always run, ping regardless of market state" pattern) — let the
EXISTING `deriveStreamStatus`/quiet-badge machinery (unchanged, Q4) be the only place staleness
is decided, using the frame's own `ts`. Never have the sidecar special-case RTH for the poll
loop itself.
**Warning signs:** A `if is_rth():` guard anywhere in the new poll loop.

## Code Examples

### Existing SPX spot capture (already live — cite, do not rebuild)
```python
# apps/sidecar/streamer.py:205-243 — _on_level_one_option (UNCHANGED this phase)
underlying_price = item.get("UNDERLYING_PRICE", item.get("35"))
tick: dict = {
    "type": "level_one_option",
    "ts": utc_now_z(),
    "occSymbol": occ_symbol,
    # ...
    "underlyingPrice": underlying_price,
    # ...
}
event_queue.put_nowait(tick)
```

### Existing spot-observation site to extend (server)
```typescript
// apps/server/src/adapters/http/sidecar-sse.ts:260-269 — the exact insertion point
if (rawTick.underlyingPrice !== null && rawTick.underlyingPrice > 0) {
  try {
    deps.observeSpot?.(rawTick.underlyingPrice, rawTick.ts);
  } catch (e: unknown) {
    console.error("sidecar-sse: observeSpot threw (swallowed) —", e instanceof Error ? e.name : "UnknownError");
  }
  // NEW sibling call goes here, same guard, same swallow-and-log discipline.
}
```

### Existing fan-out coalescer to extend (server)
```typescript
// apps/server/src/adapters/http/stream-fan-out.ts:42-118 — existing tickBuffer/flushTicks shape
// to mirror for a new latestSpot/latestIndices sibling buffer + on-change flush.
const tickBuffer = new Map<string, LiveGreekTick>();
export function bufferTick(tick: LiveGreekTick): void { tickBuffer.set(tick.occSymbol, tick); }
export function flushTicks(): void { /* ... broadcasts "ticks" event, clears buffer ... */ }
export function startFlushInterval(): ReturnType<typeof setInterval> {
  return setInterval(flushTicks, 1_000); // SAME interval a spot/indices flush can share
}
```

### Existing client-side pure-function reuse precedent (regime re-banding)
```typescript
// apps/web/src/hooks/useRuleSettingsPreview.ts:12-14 — the EXACT precedent to copy
import { bandVixTermStructure, bandVvix, bandVix9dRatio } from "@morai/core";
```

## State of the Art

No framework/library version changes are relevant here — schwab-py stays pinned, Hono SSE
patterns are unchanged, EventSource is a browser built-in. This phase is pure application-level
plumbing extension; there is no "old approach → new approach" migration to document.

**Deprecated/outdated:** None.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Schwab's exact quote tickers for VIX3M/VIX9D/VVIX on `/marketdata/v1/quotes` are `$VIX3M`, `$VIX9D`, `$VVIX` (dollar-prefix, matching the proven `$SPX`/`$DJI`/`$COMPX` convention) | Pitfall 2, Summary | A wrong symbol either 400s the batched call or returns an empty/error entry for that symbol — degrades to a missing gauge (safe, since each indicator is independently omitted per existing `getRegimeBoard.ts` "omit, never fabricate" discipline), not a crash. Low blast radius, but wastes a plan task if unverified before implementation. |
| A2 | Schwab's index quote response populates `quote.lastPrice` reliably (may omit `bid`/`ask`/`mark`) | Pitfall 3 | If the parser reads the wrong field, VIX values silently stay null (safe-degrade, not a crash), just delivers zero value instead of the live feature working. |
| A3 | A `get_quotes` call with one invalid/unrecognized symbol among several either 400s the WHOLE batch or returns a per-symbol error entry (not confirmed which) | Pitfall 2 | If it 400s the whole batch, ALL 4 VIX-family values silently fail even if 3 of the 4 symbols are valid — the plan should build the per-symbol-fallback path defensively regardless, cheap insurance either way. |

**If this table is empty:** N/A — see above; all three items are LOW blast-radius (each degrades
to "gauge omitted/absent," never a crash or an incorrect gate/trading decision) because the
existing `getRegimeBoard.ts`-style "omit rather than fabricate" discipline is straightforward to
carry into the client-side live path.

## Open Questions

1. **Exact Schwab REST symbol/response shape for `$VIX3M`/`$VIX9D`/`$VVIX`**
   - What we know: `$SPX` is proven live in this codebase; the `$`-prefix convention for cash
     indices is corroborated by Schwab's own documentation and community sources.
   - What's unclear: The literal ticker strings for VIX9D and VIX3M on Schwab's platform, and
     whether `get_quotes` fails the whole batch or degrades per-symbol on one bad ticker.
   - Recommendation: First implementation task should be a `checkpoint:human-verify` — run
     `get_quotes(["$SPX","$VIX","$VVIX","$VIX9D","$VIX3M"])` against a live authenticated sidecar
     instance ONCE, log (not persist) the raw response shape, and confirm/correct symbol strings
     before writing the parsing logic. This is the single highest-value 5-minute check available
     to de-risk the rest of the phase.

2. **Should `GexBars`' spot marker go live too, or only `GammaProfile`'s?**
   - What we know: CONTEXT.md Q1 explicitly names "gamma-profile spot marker" as in scope but
     does not explicitly name `GexBars`' spot marker (`Overview.tsx:401`, same `GexRail`).
   - What's unclear: Whether the omission is deliberate (GexBars is a strike-bar chart, not a
     dealer-gamma profile — visually different) or incidental (both are GEX-rail spot overlays,
     same rationale).
   - Recommendation: Apply the SAME live-spot value to both for visual consistency within the
     GEX rail (one spot number should never differ between two charts in the same column) —
     low-risk, Claude's-discretion-eligible, flag explicitly in the plan for a quick user
     confirmation if the planner wants to be conservative.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| schwab-py | VIX-family REST poll | ✓ | 1.5.1 (pinned) | — |
| Running sidecar + live Schwab auth | Verifying Open Question 1 (symbol/response shape) | ✗ (not available to this research session) | — | `checkpoint:human-verify` task in the plan, run once against the real deployed sidecar before/during execution |
| Existing SSE fan-out infra (`stream-fan-out.ts`, `useLiveStream.ts`) | Everything | ✓ | n/a (in-repo) | — |

**Missing dependencies with no fallback:** None — the one live-verification gap (Open Question 1)
has a fallback (defensive per-symbol handling + a human-verify checkpoint), not a blocker.

**Missing dependencies with fallback:** A live Schwab-authenticated sidecar to smoke-test the VIX
symbols — fallback is to code defensively (batch call + per-symbol fallback + null-tolerant
parsing) and verify at first live deploy via the recommended checkpoint.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS: contracts/server/web) + pytest (Python: sidecar) |
| Config file | `vitest.config.ts` (root); sidecar uses `pytest` defaults (no dedicated ini found) |
| Quick run command | `bun run test -- --run <changed-file>.test.ts` / `cd apps/sidecar && .venv/bin/pytest tests/test_streamer.py -x` |
| Full suite command | `bun run test` (TS workspace) + `cd apps/sidecar && .venv/bin/pytest` (Python) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| Q1 (spot broadcast) | `broadcastSpot` fires at the existing guarded site alongside `observeSpot` | unit | `bun run test -- --run apps/server/src/adapters/http/sidecar-sse.test.ts` | ✅ (extend existing file) |
| Q1 (indices broadcast) | New `indices` frame Zod-parses and calls `broadcastIndices` | unit | same file | ✅ (extend existing file) |
| Q2 (on-change 1/sec throttle) | `stream-fan-out.ts` spot/indices sibling buffers only emit on value change | unit | `bun run test -- --run apps/server/src/adapters/http/stream-fan-out.test.ts` | ✅ (extend existing file) |
| Contract (Z-suffix, additive) | New `streamSpotEvent`/`streamIndicesEvent` reject `+00:00`, accept `Z` | unit | `bun run test -- --run packages/contracts/src/stream-events.test.ts` | ✅ (extend existing file, mirrors existing Z-suffix test cases) |
| `useLiveStream` new fields | `liveSpot`/`liveIndices` parse + update from new named SSE events | unit | `bun run test -- --run apps/web/src/hooks/useLiveStream.test.ts` | ✅ (extend existing file) |
| Sidecar poll loop | `start_indices_poll` pushes a well-shaped `indices` dict onto `event_queue` on a mocked `market_client.get_quotes` | unit | `cd apps/sidecar && .venv/bin/pytest tests/test_streamer.py -x` | ✅ (extend existing file, mirrors `test_streamer.py`'s existing `_on_level_one_option` tests) |
| Pitfall 1 (two-spot collapse) | `PillHeader`/`GexRail` render the SAME live-aware spot as the payoff hero, not `gex.spot` | unit/component | `bun run test -- --run apps/web/src/screens/Overview.test.tsx` (or equivalent) | Check for existing Overview test file before assuming — grep first |
| Honest badge (Q2/catch #26) | Live tint only while `status === "live"`; falls back to EOD styling otherwise | unit | Same Overview/RegimeBoard test files, new cases | New test cases in existing files |

### Sampling Rate
- **Per task commit:** targeted `bun run test -- --run <file>` / `pytest <file> -x`
- **Per wave merge:** `bun run test` (full TS workspace) + `pytest` (full sidecar suite)
- **Phase gate:** Full suite green (both languages) + `bun run typecheck && bun run lint` before
  `/gsd-verify-work`

### Wave 0 Gaps
None — existing test infrastructure (`sidecar-sse.test.ts`, `stream-fan-out.test.ts`,
`stream-events.test.ts`, `useLiveStream.test.ts`, `test_streamer.py`, `test_stream_proxy.py`) all
already exist and already test the exact seams this phase extends. The planner should confirm
whether an `Overview.tsx`-level component test file exists before assuming one needs to be
created from scratch for Pitfall 1's regression coverage.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged — ticket-gated `/api/stream` auth flow untouched |
| V3 Session Management | no | Unchanged |
| V4 Access Control | no | `/sidecar/events` stays private-network-only (GW-05), unchanged |
| V5 Input Validation | yes | New `indices`/`spot` frames MUST Zod-parse at the `sidecar-sse.ts` trust boundary before use, matching the existing `sidecarTickSchema` discipline (T-12-05-04) — no `any`/`as` on the new frame shape |
| V6 Cryptography | no | No new secrets/tokens involved — quote data is public market data |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/unexpected `indices` frame from a compromised or buggy sidecar killing the live stream for all browsers | Denial of Service | Zod `safeParse` + silent-drop discipline (T-12-05-04), swallow-and-log any callback throw (CR-01 precedent) — never let one bad frame propagate an exception out of `connectToSidecarStream`'s reader loop |
| A future public exposure of `/sidecar/events` leaking VIX/spot data (low sensitivity, but still) | Information Disclosure | Unchanged — GW-05 private-network-only constraint on the sidecar already covers this; this phase adds no new sidecar routes, only new payload shapes on the existing internal-only endpoint |

## Sources

### Primary (HIGH confidence — verified against installed/live code this session)
- `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py` (installed schwab-py
  1.5.1) — confirmed the exact list of streaming services (no dedicated indices service)
- `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/client/base.py:449-503` — `get_quote`/
  `get_quotes` signatures and docstrings; `client/base.py:984-991` — `Movers.Index.SPX = '$SPX'`
  enum confirming the `$`-prefix convention inside schwab-py itself
- `apps/sidecar/chain_proxy.py:35-40` — live-proven `$SPX` symbol requirement (400 on bare `SPX`)
- `apps/sidecar/streamer.py`, `apps/sidecar/main.py`, `apps/sidecar/stream_proxy.py` — full read,
  current architecture
- `apps/server/src/adapters/http/sidecar-sse.ts`, `stream-fan-out.ts`, `stream.routes.ts`,
  `apps/server/src/main.ts` — full read, current wiring
- `packages/contracts/src/stream-events.ts` + `.test.ts` — existing schema/Z-suffix contract
- `apps/web/src/hooks/useLiveStream.ts` — full read, existing hook shape
- `apps/web/src/screens/Overview.tsx`, `overview-mobile/useOverviewModel.ts`,
  `overview-mobile/MobileHero.tsx`, `MobileRiskPanel.tsx` — every spot consumer site, cited by
  line
- `apps/web/src/screens/MarketRail.tsx`, `apps/web/src/components/RegimeBoard.tsx`,
  `packages/core/src/analytics/application/getRegimeBoard.ts`, `packages/contracts/src/regime.ts`
  — exact regime indicator formulas (VIXCLS/VXVCLS ratio, raw VVIX, VIX9D/VIXCLS ratio) and
  contract shape
- `packages/core/src/analytics/domain/regime.ts`, `packages/core/src/index.ts:592`,
  `apps/web/src/hooks/useRuleSettingsPreview.ts` — confirmed the pure banding functions are
  already exported and already reused client-side (Phase 32 precedent)
- `apps/sidecar/requirements.txt` — pinned schwab-py version + D22 no-upgrade note

### Secondary (MEDIUM confidence — WebSearch cross-referenced with codebase evidence)
- WebSearch: Schwab Trader API index symbol format (`$`-prefix convention) — corroborates, does
  not contradict, the codebase's own `$SPX` finding
- WebSearch: `schwab-py get_quotes` supports arbitrary/index symbols — corroborates the
  docstring already read directly from installed source

### Tertiary (LOW confidence — not independently verified this session, flagged in Assumptions Log)
- Exact VIX9D/VIX3M/VVIX ticker strings on Schwab's live quote endpoint (WebFetch to Schwab's
  own Index Symbols help page failed — DNS blocked in this sandboxed research session; relied on
  WebSearch summaries only, which did not surface the specific VIX-family tickers)
- Whether a `get_quotes` batch call with one bad symbol 400s entirely vs. degrades per-symbol —
  no source found either way; plan should code defensively regardless (see Pitfall 2)

## Metadata

**Confidence breakdown:**
- Standard stack / plumbing reuse: HIGH — every file cited was read directly this session; no
  new dependencies
- Spot broadcast path: HIGH — the exact insertion point, existing guard, and existing swallow
  discipline are all directly quoted from live code
- VIX-family Schwab symbol format: MEDIUM — `$`-prefix pattern strongly corroborated
  (codebase-proven for `$SPX` + cross-referenced via search), but the 3 non-SPX literal tickers
  are unverified against a live authenticated call this session (Assumption A1, Open Question 1)
- Architecture/integration map (spot consumers, regime formulas): HIGH — every consumer site
  and every regime formula was read directly from source, not inferred

**Research date:** 2026-07-13
**Valid until:** 30 days (stable internal plumbing; the one MEDIUM-confidence item — VIX-family
Schwab symbols — should be confirmed via the recommended `checkpoint:human-verify` task at
execution time regardless of how fresh this research is, since it depends on a live external API
this research could not call)
