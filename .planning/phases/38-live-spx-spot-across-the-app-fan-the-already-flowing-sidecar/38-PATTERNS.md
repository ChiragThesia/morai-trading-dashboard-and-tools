# Phase 38: Live Market Data via Sidecar (SPX Spot + VIX Family) - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 15 (new/modified across sidecar · contracts · server · web)
**Analogs found:** 15 / 15 — every layer has an exact in-repo analog. This phase adds
a second event lane to the SAME sidecar→server→browser SSE spine the live greeks ride;
copy the greeks path, don't invent.

---

## THE MASTER ANALOG — greeks ticks path, end to end

The live-greeks stream is the phase's north star. It is a working, deployed, tested
sidecar→contracts→server→hook→component pipeline. Phase 38 adds a **spot** lane (and a
**VIX-family** lane) alongside it, additively. Trace every hop and copy it:

| Hop | File | Symbol / lines | What to copy for spot/indices |
|-----|------|----------------|-------------------------------|
| 1. Sidecar acquire | `apps/sidecar/streamer.py` | `_on_level_one_option` (195-243); `REQUIRED_OPTION_FIELDS` (72-83); subscribe in `start_streamer` (416-433); `utc_now_z` (43-54) | A `_on_level_one_index` handler + an index field list + a subscribe/poll call |
| 2. Sidecar emit | `apps/sidecar/stream_proxy.py` | `stream_events` `/sidecar/events` generator (63-87) | UNCHANGED — it drains `event_queue` generically; the new event dicts ride the same queue |
| 3. Contract | `packages/contracts/src/stream-events.ts` | `streamPingEvent` (109-113), `streamLiveGreekEvent` (36-50), `ts: z.string().datetime()` Z-suffix law (5-9) | `streamSpotEvent` + `streamIndicesEvent` (additive `z.object`s) |
| 4. Server consume | `apps/server/src/adapters/http/sidecar-sse.ts` | `dispatchFrame` (217-284); `sidecarTickSchema` (42-49); `observeSpot` hook (77, 252-269) | A second frame schema + a route branch in `dispatchFrame`; `observeSpot` already IS the piggyback spot site |
| 5. Server fan-out | `apps/server/src/adapters/http/stream-fan-out.ts` | `bufferTick`/`flushTicks`/`tickBuffer` coalescer (52, 71-105); `startFlushInterval` 1/sec (116-118) | A `bufferSpot`/`flushSpot` (or `bufferIndex`) with **on-change** + 1/sec throttle |
| 6. Server route | `apps/server/src/adapters/http/stream.routes.ts` | `handleStreamSse` named-event writes (104-183) | UNCHANGED — fan-out pushes named events to already-registered clients |
| 7. Web hook | `apps/web/src/hooks/useLiveStream.ts` | `es.addEventListener("ticks"…)` (236-259) + `("ping"…)` (222-234); Zod-parse-per-frame; `deriveStreamStatus` interval (271-281) | `es.addEventListener("spot"…)` + `("indices"…)`; expose `liveSpot`/`liveIndices` |
| 8. Web derive | `apps/web/src/lib/deriveStreamStatus.ts` | pure 3-state status (25-37) | UNCHANGED — reuse for spot/index staleness (`lastTickAt` already covers it) |
| 9. Web consume | `apps/web/src/screens/overview-mobile/useOverviewModel.ts` | `spot = gex?.spot ?? 5800` (392); `liveGreeks` map consumed (420-428) | swap `spot` for a **live-preferred** spot with honest gating |

**Key fact that shapes the whole phase:** today the app's spot is the 30-min GEX snapshot
(`gex.spot`), NOT the live tick. The `underlyingPrice` already reaches the server
(`sidecar-sse.ts:260`, `observeSpot`) but is **never fanned to the browser** — it only
feeds the event-snapshot detector. Phase 38 fans it out and re-points every spot reader.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `apps/sidecar/streamer.py` | adapter (streaming) | streaming / event-driven | itself (`_on_level_one_option`) | exact |
| `apps/sidecar/tests/test_streamer.py` | test (pytest) | — | itself | exact |
| `packages/contracts/src/stream-events.ts` | contract (schema) | transform | `streamPingEvent` / `streamLiveGreekEvent` | exact |
| `packages/contracts/src/stream-events.test.ts` | test (vitest) | — | itself | exact |
| `apps/server/src/adapters/http/sidecar-sse.ts` | adapter (SSE consumer) | streaming | `dispatchFrame` / `observeSpot` | exact |
| `apps/server/src/adapters/http/stream-fan-out.ts` | adapter (pub-sub) | pub-sub / streaming | `bufferTick` / `flushTicks` | exact |
| `apps/server/src/adapters/http/stream-fan-out.test.ts` | test (vitest) | — | itself + `strm04-regression.test.ts` | exact |
| `apps/web/src/hooks/useLiveStream.ts` | hook | streaming | itself (`ticks`/`ping` listeners) | exact |
| `apps/web/src/hooks/useLiveStream.test.ts` | test (vitest/jsdom) | — | itself | exact |
| `apps/web/src/screens/overview-mobile/useOverviewModel.ts` | hook (model) | transform | itself (`spot` derivation) | exact |
| `apps/web/src/screens/Overview.tsx` | component (desktop) | request-response | itself + `MobileHero.tsx` | exact |
| `apps/web/src/components/RegimeBoard.tsx` | component | request-response | itself (`Row`/`GateChip`/freshness) | exact |
| `apps/web/src/screens/MarketRail.tsx` | component (wiring) | — | itself (lifts `RegimeBoard`) | role-match |
| `apps/web/src/components/charts/PayoffChart.tsx` | component (chart) | transform | itself (`spot` prop, `spotReadout`) | exact — prop-driven, source swap only |
| `apps/web/src/components/charts/GammaProfile.tsx` | component (chart) | transform | itself (`spot` prop → `ReferenceLine`) | exact — prop-driven, source swap only |

---

## Pattern Assignments

### `apps/sidecar/streamer.py` (adapter, streaming/event-driven)

**Analog:** itself — `_on_level_one_option` is the exact template for a new index handler.

**Emit-to-queue pattern** (`_on_level_one_option`, lines 195-243):
```python
async def _on_level_one_option(msg: dict) -> None:
    for item in msg.get("content", []):
        occ_symbol = item.get("key", "")
        if not occ_symbol:
            continue
        # Named key first (production), numeric string fallback (tests/raw frames).
        # dict.get(k, default) avoids the falsy-0.0 bug that `a or b` has.
        mark = item.get("MARK", item.get("37"))            # None if absent — Pitfall 4
        underlying_price = item.get("UNDERLYING_PRICE", item.get("35"))
        tick: dict = { "type": "level_one_option", "ts": utc_now_z(),
                       "occSymbol": occ_symbol, "mark": mark, ... }
        try:
            event_queue.put_nowait(tick)
        except asyncio.QueueFull:
            logger.warning("streamer: event_queue full — dropping ... for %s", occ_symbol)
```
New `_on_level_one_index` (or `_on_index_quote`) mirrors this exactly: loop `content`,
pull the index `LAST`/quote field via `item.get(NAMED, item.get(NUMERIC))`, build a
Z-suffixed dict `{ "type": "spot", "ts": utc_now_z(), "symbol": ..., "value": ... }` (or
one `"indices"` dict), `event_queue.put_nowait` with the same `QueueFull` guard.

**Z-suffix timestamp law** (`utc_now_z`, lines 43-54) — MANDATORY on every emitted ts:
```python
def utc_now_z() -> str:
    return (datetime.datetime.now(tz=datetime.timezone.utc)
            .isoformat(timespec="milliseconds").replace("+00:00", "Z"))
```

**Subscription field list + subscribe call** (lines 72-83, 416-433). For the streamer
path, add an index field constant like `REQUIRED_OPTION_FIELDS` and, in `start_streamer`,
a subscribe call mirroring line 422 — **but** `fields` is keyword-only on schwab-py
(`subs(symbols, *, fields=...)`); passing it positionally raised TypeError and killed the
session (see the inline warning at 420-422). Handlers register via
`add_..._handler(lambda msg: asyncio.ensure_future(_on_...(msg)))` (428-433).

> **Q3 research gate (CONTEXT.md):** whether schwab-py's level-one accepts index symbols
> (`$SPX`, `$VIX`…) is unverified. If it does NOT, the accepted fallback is a REST
> `get_quotes` **poll loop** — a new `asyncio` background task shaped like `start_streamer`
> (362-468): `while True:` fetch → build Z-suffixed dict → `event_queue.put_nowait` →
> `await asyncio.sleep(1-5s)`, with the same reconnect/backoff + `type(exc).__name__`-only
> logging discipline. The REST-call analog for auth + client access is
> `apps/sidecar/chain_proxy.py` / `positions_proxy.py` (they already hold a Schwab client
> off `app.state` and Z-stamp their timestamps).

**Prohibition to carry forward** (module docstring, 18-22): MUST NOT write any Postgres
row; MUST NOT branch on undocumented message-type strings.

---

### `apps/sidecar/tests/test_streamer.py` (test, pytest)

**Analog:** itself. Class-per-concern, `from streamer import X` lazy imports inside each
test, `unittest.mock` `AsyncMock`/`MagicMock`/`patch` for the StreamClient, no live Schwab.
```python
class TestSubscriptionManagerBasic:
    def test_request_ad_hoc_new_symbol(self):
        from streamer import SubscriptionManager
        sm = SubscriptionManager()
        to_add, to_evict = sm.request_ad_hoc("SPX   260620C05000000")
        assert to_add == ["SPX   260620C05000000"]
```
New handler test: build a fake `msg` dict with `content`, `await _on_level_one_index(msg)`,
drain `event_queue.get_nowait()`, assert the Z-suffixed dict shape (assert `ts.endswith("Z")`).

---

### `packages/contracts/src/stream-events.ts` (contract, transform)

**Analog:** `streamPingEvent` (minimal) and `streamLiveGreekEvent` (fuller), lines 36-113.

**Additive event schema** (copy `streamPingEvent`, 109-113 + the ts law):
```typescript
export const streamSpotEvent = z.object({
  spot: z.number(),
  /** ISO-8601 UTC timestamp. MUST end in "Z" — "+00:00" is rejected. */
  ts: z.string().datetime(),
});
export type StreamSpotEvent = z.infer<typeof streamSpotEvent>;
```
VIX family (Claude's discretion — one `indices` event vs per-symbol). One-event shape,
keyed by the four regime symbols:
```typescript
export const streamIndicesEvent = z.object({
  vix: z.number().nullable(),
  vvix: z.number().nullable(),
  vix9d: z.number().nullable(),
  vix3m: z.number().nullable(),
  ts: z.string().datetime(),
});
```
**Additive-only law** (header 3, and WR-03 Phase 18 precedent): new optional events, never
break `streamLiveGreekEvent`/`streamPingEvent`. Old clients unaffected (CONTEXT Q1).

---

### `packages/contracts/src/stream-events.test.ts` (test, vitest)

**Analog:** itself — the `+00:00` rejection is the load-bearing case to replicate:
```typescript
const validLiveGreekPayload = { occSymbol: "SPX   260620C05000000", ts: "...Z", ... };
// accepts valid Z-suffixed ts; rejects "+00:00"; rejects missing field
```
Add a `describe("streamSpotEvent")` with: accepts `{spot, ts:"…Z"}`; **rejects a
`+00:00` ts**; rejects a non-number spot; rejects a missing field. Mirror for indices.

---

### `apps/server/src/adapters/http/sidecar-sse.ts` (adapter, streaming consumer)

**Analog:** `dispatchFrame` (217-284) + the existing `observeSpot` hook.

**Local wire schema + safeParse routing** (42-49, 244-269). The new sidecar frame gets its
OWN local schema (like `sidecarTickSchema` — "intentionally local, raw wire format, not the
browser-facing event", 41-49):
```typescript
const sidecarSpotSchema = z.object({ type: z.literal("spot"), value: z.number(), ts: z.string() });
```
Then a branch in `dispatchFrame` BEFORE the option-tick parse (order matters — the option
schema would reject a spot frame and drop it silently at 245-248). Route: safeParse spot →
`deps.bufferSpot(value, ts)`; else fall through to the existing option-tick path.

**The `observeSpot` seam already exists** (77, 252-269) — it fires on every valid option
tick's `underlyingPrice`. This is the *piggyback* spot source (CONTEXT: "redundant, never
the sole one"). The DEDICATED spot lane is a new fan-out buffer; do not delete `observeSpot`
(it feeds the event-snapshot detector, a different consumer):
```typescript
if (rawTick.underlyingPrice !== null && rawTick.underlyingPrice > 0) {
  try { deps.observeSpot?.(rawTick.underlyingPrice, rawTick.ts); }
  catch (e: unknown) { console.error("... observeSpot threw (swallowed) —",
    e instanceof Error ? e.name : "UnknownError"); }
}
```
**Swallow-throw discipline** (REVIEW CR-01, 259-268): any new callback invoked in
`dispatchFrame` MUST be wrapped in try/catch that logs `.name` only — a throw rejects
`connectToSidecarStream` and permanently kills the stream.

**No `any`/`as`/`!`, Zod safeParse at the boundary** (243-248) — `typescript.md` law.

---

### `apps/server/src/adapters/http/stream-fan-out.ts` (adapter, pub-sub)

**Analog:** `bufferTick`/`flushTicks`/`tickBuffer` (52, 71-118). This is the exact
coalescer to copy — but the phase adds **on-change** semantics (CONTEXT Q2: on-change only,
max 1 frame/sec per symbol, no unchanged keepalives).

**Latest-wins coalescer + named-event fan-out** (71-105):
```typescript
const tickBuffer = new Map<string, LiveGreekTick>();
export function bufferTick(tick: LiveGreekTick): void { tickBuffer.set(tick.occSymbol, tick); }
export function flushTicks(): void {
  if (tickBuffer.size === 0 || clients.size === 0) return;
  const ticks = [...tickBuffer.values()]; tickBuffer.clear();
  const data = JSON.stringify(ticks);
  for (const stream of clients) {
    if (stream.aborted) { clients.delete(stream); continue; }
    void stream.writeSSE({ event: "ticks", data }).catch(() => { clients.delete(stream); });
  }
}
```
New `bufferSpot`/`flushSpot` (event name `"spot"`) copies this shape. **On-change throttle**
is the one NEW bit: hold a `let lastSentSpot: number | null` and a per-symbol last-sent map
for indices; `flushSpot` skips the write when the buffered value equals the last sent
(`// ponytail: value-equality skip, no epsilon — Schwab spot is already conflated ~1/sec`).
Register the new flush on the existing 1/sec interval or a sibling `startFlushInterval`
(116-118). **STRM-04 law:** no Postgres import — pure in-memory (header 18-20).
`resetForTesting` (131-134) must clear the new buffers too.

---

### `apps/server/src/adapters/http/stream-fan-out.test.ts` (test) + `strm04-regression.test.ts`

**Analog:** `strm04-regression.test.ts` — the `makeSilentClient()` fake SSEClient +
`registerClient`/`bufferTick`/`flushTicks` drive-and-assert harness:
```typescript
function makeSilentClient(): SSEClient {
  return { aborted: false, onAbort(_l) {}, writeSSE(_m) { return Promise.resolve(); } };
}
```
New tests: buffer a spot, flush, assert ONE `{event:"spot"}` write; buffer the SAME value
twice, assert the second flush is a no-op (on-change law); assert dead-client cleanup on
`aborted`/rejection carries to the spot path. The `strm04` no-persistence gate (testcontainers)
must extend to prove the spot lane writes zero `leg_observations` rows.

---

### `apps/web/src/hooks/useLiveStream.ts` (hook, streaming)

**Analog:** itself — the `"ticks"` and `"ping"` `addEventListener` blocks (222-259).

**Named-event listener + Zod-parse + state** (236-259):
```typescript
es.addEventListener("ticks", (event: Event): void => {
  if (!(event instanceof MessageEvent)) return;
  let raw: unknown;
  try { raw = JSON.parse(event.data); } catch { return; }   // malformed → drop
  const parsed = streamLiveGreekEvent.array().safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) return;
  setGreeks((prev) => { const next = new Map(prev); for (const t of parsed.data) next.set(t.occSymbol, t); return next; });
  hasReceivedFirstTickRef.current = true; setHasReceivedFirstTick(true);
  lastTickOrConnectAtRef.current = Date.now(); setLastTickAt(new Date());
});
```
New `"spot"` and `"indices"` listeners copy this: parse `streamSpotEvent`/`streamIndicesEvent`,
`setLiveSpot`/`setLiveIndices`. Add `liveSpot: number | null` and `liveIndices` (+ their own
`lastSpotAt`) to `UseLiveStreamResult` (74-99). **Whether a spot tick bumps the shared
`lastTickOrConnectAtRef`** is a design call — the greeks staleness clock is what the badge
reads; keep spot on its own freshness stamp so a spot-only feed doesn't paint the greeks
badge LIVE (honest-badge law, catch #26). **EventSource named-event trap** (217-221): named
events go to `addEventListener`, NEVER `onmessage`. Do NOT set status in `es.onerror`
(Pitfall 1, 207-215) — the interval owns status.

---

### `apps/web/src/hooks/useLiveStream.test.ts` (test, vitest/jsdom)

**Analog:** itself. jsdom EventSource harness dispatches named `MessageEvent`s and asserts
hook state. Catch #20 law (jsdom-honest): if a test would pass only because jsdom coincides
with a constant, it is not a real test. Add: dispatch a `"spot"` event → `liveSpot` updates;
malformed JSON → dropped, last-known-good retained; `+00:00`-ts (bad shape) → dropped.

---

### `apps/web/src/screens/overview-mobile/useOverviewModel.ts` (hook, model) — THE SPOT SEAM

**Analog:** itself. This is the single most important consumer edit — it is the model both
the desktop and mobile Overview trees consume (D-02).

**Current spot source** (line 392):
```typescript
const spot = gex?.spot ?? 5800;
```
**Phase 38 seam:** prefer live spot with honest fallback — never a silent lie (catch #26):
```typescript
const { greeks: liveGreeks, ..., liveSpot, liveStatus } = useLiveStream();
// live only while the stream is live AND a spot tick exists; else the EOD/snapshot spot.
const spot = (liveStatus === "live" && liveSpot !== null) ? liveSpot : (gex?.spot ?? 5800);
```
This one change flows into `buildCalendarPosition` (457), `payoffDomain`/`scenario` (509-529
— the T+0 recompute CONTEXT asks for is automatic, they already `useMemo` on `spot`),
`railGreeks` (537-540, net greeks), and `macroValues` — so the mobile hero + payoff hero
+ net-greeks all go live from this seam. Expose `liveSpot`/`liveStatus` on `OverviewModel`
(315-384) so views can render the honest live/EOD tint. **Do NOT** feed live spot into any
stored/gate path — `railGreeks` and payoff are display; that is the whole point.

> `netGreeksForLegs` (175-199) and `resolveLivePositionRow` (Overview.tsx:146) already take
> `spot` as a param — swapping the source needs no signature change.

---

### `apps/web/src/screens/Overview.tsx` (component, desktop) + `MobileHero.tsx`

**Analog:** `MobileHero.tsx` (SPX display, 44-45) and Overview's own chip/chart sites.

Desktop reads `gex.spot` **directly** in several render sites (not via `model.spot`):
```
:468  <MetricChip label="SPX" value={gex !== undefined ? gex.spot.toFixed(1) : "—"} valueClassName="text-blue" />
:395  <GammaProfile profile={gex.profile} spot={gex.spot} flip={gex.flip} compact />
:402  spot={gex.spot}   (PayoffChart)
:728,:774  spot={spot}  (payoff hero — already model.spot)
```
Re-point the direct `gex.spot` reads to the model's live-preferred `spot` (the payoff hero
at 728/774 already uses it). Mobile hero analog (`MobileHero.tsx:44-45`):
```tsx
<span>SPX </span>
<span className="text-blue">{spot !== null ? spot.toFixed(1) : "—"}</span>
```
The honest live/EOD tint belongs next to these numbers — reuse the LiveStatusBadge grammar
(below), not a new bespoke badge.

---

### `apps/web/src/components/RegimeBoard.tsx` (component) — THE display-live/gate-EOD SEAM

**Analog:** itself. This is where the LAW is enforced. Two visibly distinct sources by design.

**How the rail gets its values today:** `useRegimeBoard()` → `GET /api/analytics/regime` →
EOD `macro_observations` (useRegimeBoard.ts:22-45, daily cadence, `staleTime 900_000`). The
gauge renders `indicator.value` and the freshness footer says `"EOD · as of {newest}"`:
```typescript
// RegimeBoard.tsx:153 (printed value), :104 (valuePct marker), :162 (aria) — all indicator.value
// :366-370 — the honest footer:
const newest = data.map((i) => i.asOf).reduce((m, d) => (d > m ? d : m));
const freshness = `EOD · as of ${newest}` + stale.map(...).join("");
```
**The entry-gate verdict is a SEPARATE source** (`usePicker().gate`, 297-299 → `GateChip`,
216-255) and stays EOD-driven — untouched. `indicator.band` is server-computed
(T-31-05: "never recomputed from value/thresholds client-side", 44-51) — the stored regime
verdict, also untouched.

**Phase 38 seam (CONTEXT Q1/Q2):** thread the live VIX-family values (from `useLiveStream`,
lifted at `MarketRail`/Shell) into `RegimeBoard` as an optional `liveIndices` + `liveStatus`
prop. For the three broker-quotable rows ONLY — `vvix`, `vix-term-structure` (VIX/VIX3M),
`vix9d-vix` (`hy-oas` stays FRED, not broker data) — override the DISPLAYED `indicator.value`
with the live value while:
- The gate chip (`GateChip`) and `indicator.band` stay EOD (LAW).
- Band WARN/CRISIS coloring MAY reflect the live value (Q1) — if so, recompute the band
  client-side from the live value against the response's `indicator.bandWarn`/`bandCrisis`
  (both already present, used at 102-103) — a deliberate, scoped exception to the T-31-05
  "never client-recompute band" rule, allowed ONLY for the live-display tint.
- The footer flips from `"EOD · as of …"` to a live marker while `liveStatus === "live"`,
  and reverts to `"EOD · as of …"` (with existing dim styling) on quiet/stalled. Never mix
  silently (catch #26 / Q2). The freshness footer (366-382) is the honest-badge site.

**Value formatting to preserve:** `.toFixed(2)` (153), `MARKER_CLASSES[band]` marker (174-181),
`GAUGE_SCALE` axis (56-61) — the VIX symbols map: `$VVIX`→`vvix`, `$VIX`/`$VIX3M`→`vix-term-structure`,
`$VIX9D`/`$VIX`→`vix9d-vix`.

---

### `apps/web/src/screens/MarketRail.tsx` (component, wiring)

**Analog:** itself (mounts `<RegimeBoard dense />`, line 62). Only ONE `useLiveStream`
consumer may mount per surface (D-06 / OverviewModel note at useOverviewModel.ts:416-419).
The rail already renders on the Overview surface next to the model's hook — so **lift**
`liveIndices`/`liveStatus` from the existing `useOverviewModel` call and pass them down as
props to `RegimeBoard`; do NOT call `useLiveStream()` a second time inside the rail (that
opens a second EventSource). If the rail also renders on the standalone `Market` screen
(no model), that screen needs its own single hook call at the screen root.

---

### `PayoffChart.tsx` / `GammaProfile.tsx` (chart components) — SOURCE SWAP ONLY

Both are already `spot`-prop-driven; no internal change needed — the live value arrives via
the model seam.
- `PayoffChart.tsx`: `spot` prop (91), `spotReadout` T+0 line + dot (334-336, 360-373,
  595-602 `plAtSpot`). The T+0 recompute CONTEXT wants happens upstream in the model's
  `scenario` memo — the chart just re-renders on the new `spot`/`scenario`.
- `GammaProfile.tsx`: `spot` prop → `<ReferenceLine x={spot} ifOverflow="hidden">` (149) +
  `ReferenceDot` (151-154). Same — feed it the live-preferred spot.

---

## Shared Patterns

### Z-suffix timestamp contract (every emitted/parsed ts)
**Source:** `streamer.py:43-54` (`utc_now_z`) + `stream-events.ts:5-9` + its test's `+00:00`
rejection. **Apply to:** every new sidecar emit, every new contract event, every new test.
`z.string().datetime()` REQUIRES a trailing `Z`; Python `isoformat()` emits `+00:00` →
must `.replace("+00:00", "Z")`. This is the single most-repeated landmine in the codebase.

### Zod safeParse at every trust boundary, no `any`/`as`/`!`
**Source:** `sidecar-sse.ts:243-248`, `useLiveStream.ts:230-247`. **Apply to:** server frame
dispatch, hook frame listeners. Malformed JSON / bad shape → drop silently, retain
last-known-good. `typescript.md` law — enforced by eslint.

### Named SSE events + fan-out coalescer
**Source:** `stream-fan-out.ts:88-118` (buffer→flush→named `writeSSE`) +
`useLiveStream.ts:217-221` (named `addEventListener`, never `onmessage`). **Apply to:** the
new spot/indices lane. Dead-client cleanup two ways (`aborted` + `.catch`), 1/sec flush.

### Honest badge — display-live / gate-EOD (catch #26 LAW)
**Source:** `LiveStatusBadge.tsx` (3-state grammar) + `deriveStreamStatus.ts:25-37` +
RegimeBoard's `"EOD · as of …"` footer (366-382). **Apply to:** SPX chip, mobile hero,
regime gauges. Live tint ONLY while `status === "live"`; quiet/stalled → stored EOD/snapshot
value with existing stale styling. NEVER `liveSpot ?? gex.spot` as a silent fallback that
paints stale as live — gate on `status === "live"`, then choose (mirrors catch #26: "gate
views, never `?? fallback` lies"). Gates/verdicts (`usePicker().gate`, `indicator.band`,
stored regime) keep reading EOD — two visibly distinct sources by design.

### Self-healing reconnect + `.name`-only logging
**Source:** `sidecar-sse.ts:178-208` (`runSidecarStreamWithReconnect`), `streamer.py:400-468`
(backoff+jitter loop). **Apply to:** any new sidecar poll loop. Never log `str(exc)` / token
values — `type(exc).__name__` / `err.name` only.

---

## No Analog Found

None. Every layer has an exact in-repo analog. The only genuinely new *logic* (not a new
file) is:
1. The **on-change throttle** in the fan-out spot buffer (a value-equality skip on top of
   the existing latest-wins coalescer).
2. The **live-preferred spot with honest gate** in `useOverviewModel` (a gated ternary on
   top of the existing `gex?.spot ?? 5800`).
3. The optional **client-side band recompute for live display** in `RegimeBoard` (a scoped,
   CONTEXT-approved exception to T-31-05, display-tint only).
4. The **index quote acquisition** in the sidecar — subscription IF schwab-py supports index
   symbols (research gate Q3), else a REST `get_quotes` poll task modeled on `start_streamer`
   + `chain_proxy.py`'s client access.

---

## Metadata

**Analog search scope:** `apps/sidecar/`, `packages/contracts/src/`,
`apps/server/src/adapters/http/`, `apps/web/src/hooks|lib|screens|components/`.
**Files scanned:** ~20 read in full or targeted; the greeks path traced hop-by-hop.
**Pattern extraction date:** 2026-07-13
