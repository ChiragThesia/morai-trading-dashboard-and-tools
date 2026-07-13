# Phase 38: Live Market Data via Sidecar (SPX Spot + VIX Family) - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the sidecar the sole LIVE market-data source for the whole app — user-locked
principle 2026-07-13: "the sidecar just gives us all." Two data flows:

1. **SPX spot** — fan the tick out to browsers as a dedicated SSE event; every spot
   display in the app goes live at the positions-LIVE cadence (~1s Schwab conflation).
2. **VIX family** — `$VIX`, `$VVIX`, `$VIX9D`, `$VIX3M` live quotes via the sidecar
   (exact Schwab symbols/service verified in research), replacing days-stale FRED EOD
   values on the regime rail **for display only**.

**LAW — display-live, gate-EOD:** regime/entry gates, crisis bands, and hysteresis
keep consuming the stored EOD `macro_observations` series untouched. Feeding intraday
ticks into gates recreates the flapping failure v1.3 risk #3 exists to prevent.
FRED ingestion continues unchanged (history has no backfill; backtest replays it).

Out of scope: ticking GEX walls/term-structure/dealer-gamma curves (30-min chain
compute stays), candidate re-scoring on live spot, HY OAS/rates/COT/econ events
(not broker-quotable — FRED/CFTC stay), any change to picker/exit/regime engine math.

</domain>

<decisions>
## Implementation Decisions

### Stream semantics (Area 1 — resolved 2026-07-13, Q1/Q2/Q4 user-picked, Q3 discretion)
- **Q1:** New dedicated SSE event type(s) alongside `ticks`/`fills`/`reconcile`/`ping` —
  additive contract, old clients unaffected. Spot event `{spot, ts}`; VIX-family frames
  may share one `indices` event or per-symbol events (Claude's discretion, keep additive).
- **Q2:** Server throttle: on-change only, max 1 frame/sec per symbol. No unchanged-value
  keepalives — `ping` already proves liveness.
- **Q3 (discretion, user deferred):** Dedicated sidecar subscriptions/polls for `$SPX` +
  VIX family — research verifies whether the streamer's level-one service accepts index
  symbols; REST `get_quotes` polling (~1-5s spot, ~15-30s VIX family is fine) is the
  accepted fallback path. Existing `underlyingPrice` piggyback remains a redundant spot
  source; never the sole one. User's architecture intent is explicit: pull through the
  sidecar, sole live source.
- **Q4:** No server-side RTH gating — forward what the feed sends; the UI's existing
  quiet/stalled badge machinery owns staleness display.

### Web consumption + display (Area 2 — Q1/Q2/Q3 user-picked, Q4 discretion)
- **Q1:** ALL surfaces go live: header SPX chip, Overview payoff spot marker + T+0
  recompute, gamma-profile spot marker, net-greeks calc, mobile Overview hero, AND the
  regime-rail VIX/VVIX/ratio gauges show live values. Gauge WARN/CRISIS band coloring
  may reflect the live value visually, but the ENTRY GATE verdict chip and any stored
  regime state remain EOD-driven (display-live/gate-EOD LAW).
- **Q2:** Honest badges (catch #26 law): live tint only while stream status = live;
  quiet/stalled → stored EOD/snapshot value with existing stale styling ("EOD · as
  of…"). Never silently mix live and stale.
- **Q3:** Recompute per frame (≤1/sec by server design); no extra client debounce
  unless profiling shows jank.
- **Q4 (discretion, user deferred):** Analyzer = display marker only. Candidate
  scoring/scenario baselines stay on picker-snapshot spot — deterministic analysis,
  no re-score churn. Re-scoring on live spot explicitly deferred.

### Locked earlier (2026-07-13 conversation, pre-discuss)
- `underlyingPrice` already reaches the server per option tick (sidecar-sse.ts:260,
  `observeSpot` site) — broadcast hook goes there for the piggyback path.
- Contract-first: schemas in `packages/contracts` (stream-events.ts), additive only.
- `useLiveStream` exposes the new live values (e.g. `liveSpot`, `liveIndices`).
- AH/weekend honesty via existing `deriveStreamStatus` (live/quiet/stalled) machinery.
- Sidecar is the sole Schwab boundary — TS never talks to Schwab directly (arch law).

### Claude's Discretion
- Exact event naming/shape (one `indices` event vs per-symbol), sidecar poll vs
  subscribe per symbol (research-driven), hook API shape, gauge live-tint styling.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/sidecar/streamer.py` — streamer session, LEVELONE_OPTIONS handling
  (UNDERLYING_PRICE at :215); extend for index subs or add a REST poll loop.
- `apps/server/src/adapters/http/sidecar-sse.ts` — sidecar event consumer; :260 is
  the spot observation site; Zod raw-tick schema at :47.
- `packages/contracts/src/stream-events.ts` — event schemas + Z-suffix timestamp
  contract (see its test's +00:00 rejection case).
- `apps/web/src/hooks/useLiveStream.ts` — EventSource hook, ticket mint, status
  derivation (`deriveStreamStatus` in apps/web/src/lib), reconnect w/ fresh ticket.
- MarketRail regime gauges (Phase 31 band-gauges) — where VIX family displays.
- `packages/core/src/journal/application/observeSpot.ts` — event-move snapshot
  trigger; unchanged, but the broadcast must not disturb it.

### Established Patterns
- Additive contract change precedent: WR-03 Phase 18 (unfroze contract for approved
  `asOf` addition) — new optional fields/events, never breaking.
- Server SSE fan-out to N browsers already exists (greeks/fills) — copy that path.
- TDD: contracts tests, sidecar-sse harness (strm04-regression.test.ts pattern),
  useLiveStream.test.ts EventSource harness, sidecar pytest.

### Integration Points
- Sidecar `/sidecar/events` stream → server consumer → browser SSE `/api/stream`.
- Regime rail reads live values from the stream hook; gates keep reading
  `/api/regime` (EOD macro_observations) — two visibly distinct sources by design.

</code_context>

<specifics>
## Specific Ideas

- User 2026-07-13: "I want it live like that across whole app… full tick updates of
  all things" + "why can't the sidecar just give us all?" — liveness parity with the
  positions LIVE feed is the acceptance feel; ~1s conflation is the known ceiling.
- Regime rail currently shows "as of 2026-07-09" on 07-13 — the staleness this phase
  kills (for display).

</specifics>

<deferred>
## Deferred Ideas

- Candidate re-scoring on live spot (engine work, flapping risk — own phase if ever).
- Ticking GEX walls/term-structure curves (chain-wide recompute cost — separate).
- Live HY OAS/rates alternatives (not broker data; FRED cadence stands).

</deferred>
