# Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules - Research

**Researched:** 2026-07-05
**Domain:** SSE stream-health state machine, server-side price-move detection triggering an
existing pg-boss job, and a structured trade-rule recording layer keyed off an existing
idempotency identity — all inside an already-mature hexagonal TypeScript monorepo (Hono/Bun +
Drizzle + pg-boss + React/Vite).
**Confidence:** HIGH — every recommendation below is grounded in code actually read in this
repo (attach points, existing patterns, exact line-level behavior), not generic best practice.
The only external claims (pg-boss `singletonSeconds` semantics) are `[CITED]`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**WATCH-01 — Stream Health Badge**
- **D-01:** Three-state model (LIVE / QUIET / STALLED) replaces today's 4-state badge
  (`live`/`stale`/`reconnecting`/`poll`). LIVE = ticks arriving during RTH. QUIET = market
  closed. STALLED = RTH but ticks frozen past threshold OR transport dead — both fold into one
  honest red state.
- **D-02:** Stall threshold ~20s — no `ticks` event while transport/heartbeat is alive during
  RTH → STALLED. Ticks resume → instant flip back to LIVE.
- **D-03:** Server emits RTH/market-state on the heartbeat (`ping`); client is
  authoritative-from-server. Wires the currently-ignored client `ping` handler
  (`useLiveStream.ts` ~line 172).
- **D-11 (cold-start grace):** On cold connect or mid-reconnect during RTH (transport up, no
  tick yet), hold a neutral "connecting" look (reuse QUIET styling, no red) until the first tick
  (→LIVE) or the ~20s window elapses (→STALLED).
- **D-17 (STALLED action):** STALLED exposes a manual force-reconnect action (mints a fresh
  single-use ticket, reconnects immediately). Must cancel the pending exp-backoff reconnect timer
  to avoid double-connects.
- **D-20 (STALLED tone):** Resolved by `20-UI-SPEC.md` — STALLED reuses the `down`/red alarm
  token (`text-down` on `bg-downd`, `ring-down/40`), never amber.

**SNAP-01 — Event-Triggered Supplemental Snapshot**
- **D-04:** Detection runs server-side (headless) — NOT the browser. On trigger: ad-hoc
  `boss.send('snapshot-calendars', {}, { singletonKey })`, reusing the existing
  RTH+holiday-gated job.
- **D-05:** "Large move" = SPX absolute % move over a short rolling window (~1% within ~5min).
- **D-06:** Debounce = cooldown vs ANY snapshot (scheduled OR supplemental) within the last
  ~15min.
- **D-12 (provenance):** Add a nullable trigger/reason marker on the snapshot row (`scheduled`
  default vs `event-move`), non-destructive.
- **D-15 (gating + direction):** RTH-gated (skip off-hours). Triggers on absolute % move in
  either direction.

**RULE-01 — Strategy Rule Recording**
- **D-07:** 3 enums keyed to event type — ENTER / EXIT / ROLL, each attaching to its matching
  `CalendarEvent` type (OPEN→enter, CLOSE→exit, ROLL→roll). Recording layer, NOT a DSL.
- **D-08:** Rule enum values research-proposed from the KB (`calendar_spread.md` +
  `trade_management.md`), user trims before lock.
- **D-09:** Structured tag lives in a SEPARATE annotations table keyed by `fillIdsHash` — NOT a
  column on `calendar_events` (rebuild wipes columns; latent data-loss bug for `entryThesis`
  today). Orphan-on-hash-change = log & orphan (rare).
- **D-10 (capture UX):** Per-event rule control in the Journal "thesis·review" panel, editable
  anytime. Free-text thesis retained as optional supplement. Include an OTHER/unlisted value.
- **D-13 (adapter surface):** New write use-case ships HTTP route + MCP tool (read+write) in the
  same PR.
- **D-14 (multiplicity):** Multiple rules per event — list-shaped contract.
- **D-16 (backfill):** No backfill — annotations table ships empty.
- **D-21 (OTHER value):** Selecting OTHER requires a short free-text note.
- **D-22 (review view):** Recorded rule tags render inline in the Journal review view AND stay
  editable.

**Cross-Cutting**
- **D-18 (sequencing):** WATCH-01 → SNAP-01 → RULE-01, each shipped independently to prod (three
  separate deploy+UAT cycles).
- **D-19 (UI-SPEC):** `/gsd-ui-phase 20` already run and approved — see `20-UI-SPEC.md`.

### Claude's Discretion
- Enum DB representation: `text` + Zod validation at the boundary over a rigid Postgres native
  enum.
- Exact tunable constants: WATCH stall ~20s; SNAP move %, rolling window, cooldown ~15min.
- Server-side detector placement + SPX spot tick source.
- Port shapes, memory-twin parity, exact MCP tool signature, Journal panel placement.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. RULE-02 (rule-fired → outcome correlation report)
is tracked in `.planning/REQUIREMENTS.md` §Future Requirements — needs accumulated tagged trades
first, not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WATCH-01 | Live-stream badge is a three-state, RTH-aware indicator (LIVE/QUIET/STALLED) driven by a transport-level heartbeat | §Architecture Patterns Pattern 1 (unified grace-then-escalate timer); exact attach points in `useLiveStream.ts`/`LiveStatusBadge.tsx`/`stream.routes.ts`/`stream-events.ts` documented below with line-level detail |
| SNAP-01 | A large SPX move on the live stream triggers a supplemental out-of-cycle journal snapshot (existing job, ad-hoc enqueue) | §Architecture Patterns Pattern 2; exact detector placement (`sidecar-sse.ts` dispatchFrame, apps/server's own `jobBoss` PgBoss client) and cooldown mechanism (DB-timestamp check, not pg-boss singletonSeconds alone) |
| RULE-01 | User can record enter/exit/roll rules per trade and which rule fired; thin recording layer, NOT a DSL | §Architecture Patterns Pattern 3; enum seed values grounded in `calendar-selection-criteria.md` (ENTER) + KB `trade_management.md`/`calendar_spread.md` (EXIT/ROLL); annotations-table schema + the FK pitfall that would reintroduce the D-09 data-loss bug; the missing calendar-events READ surface gap |
</phase_requirements>

## Summary

All three sub-phases attach to code that already exists and already does 90% of the work — this
phase is about wiring existing signals through, not building new infrastructure. WATCH-01 needs
the already-open (but currently empty/ignored) SSE `ping` event to start carrying a boolean, and
the client hook needs an elapsed-time timer (not just event handlers) to derive state, because
both the stall-threshold and the cold-start grace are elapsed-time conditions that must fire even
when no event arrives. SNAP-01's hardest problem is not "how to detect a move" (a simple rolling
window over a value the server already receives on every tick) but "how to make the ~15-minute
cooldown correct across two different OS processes" (`apps/server` detects the move; the existing
30-minute cadence is driven by `apps/worker`'s cron chain) — the fix is a Postgres timestamp read,
not an in-memory guard. RULE-01's actual scope gap is not the enum/UI (well-specified by
CONTEXT.md and UI-SPEC) but that **no read surface for `calendar_events` exists anywhere in this
app today** — `ForReadingCalendarEvents`/the Postgres repo/the memory twin all exist, but zero
HTTP route or MCP tool reads them, so the Journal UI cannot currently know whether a trade has a
CLOSE event or how many ROLL events it has. That surface must be built as part of this phase,
not assumed to already exist.

**Primary recommendation:** Treat all three as thin adapters over existing domain primitives —
one new client-side elapsed-time derivation for WATCH-01, one new pure rolling-window detector +
one new cross-process-safe cooldown check for SNAP-01, and one new read/write pair (route + MCP
tool, backed by a plain non-FK-constrained annotations table) for RULE-01. Zero new npm
dependencies are needed for any of the three.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stream state derivation (LIVE/QUIET/STALLED) | Browser / Client (`useLiveStream.ts`) | Frontend Server (SSE ping payload) | The state machine (elapsed-time + last-event) must live where the timer runs (the browser); the RTH truth it depends on is server-computed and pushed in, not locally derived (D-03) |
| RTH/market-state computation | API/Backend (`stream.routes.ts`, reusing `isWithinRth`) | — | `isWithinRth` already lives in `packages/core` and is already used by the worker's snapshot gate — the ping handler is a thin caller, not a new computation |
| SPX move detection | API/Backend (`apps/server`, `sidecar-sse.ts` dispatch path) | — | The SPX spot price already arrives on every option tick at this exact point (`RawOptionTick.underlyingPrice`) before being discarded by `recomputeLiveGreek` — this is the only place the value exists without a new data source |
| Snapshot cooldown/dedup check | API/Backend (new pure domain function) + Database (timestamp read) | — | Must reconcile state written by TWO separate OS processes (worker cron chain, server detector) — only Postgres is the shared ground truth |
| Ad-hoc job enqueue | API/Backend (`apps/server`'s own `jobBoss` PgBoss client, `main.ts` ~line 216) | — | `apps/server` already owns a dedicated enqueue-only PgBoss client (separate from the worker's processing client) — no new client, no HTTP hop to the worker needed |
| Rule-tag recording (write) | API/Backend (new use-case + route + MCP tool) | Database (new annotations table) | Thin recording layer per D-07 — a Zod-validated enum array write, not an evaluation engine |
| Rule-tag recording (read) | API/Backend (new use-case + route + MCP tool) | Browser (Journal UI render) | Currently MISSING entirely — `calendar_events` has no read surface today; must be built alongside the annotations read |
| Rule-tag UI (write control + read pill) | Browser / Client (`Journal.tsx`) | — | Presentational only, per `20-UI-SPEC.md` — reuses Phase-21 `Button` primitive verbatim |

## Standard Stack

**No new npm dependencies for this phase** (milestone constraint, confirmed against
`package.json` across `apps/server`, `apps/web`, `apps/worker`, `packages/adapters`).

### Reused (already installed, versions verified in this repo's lockfile-adjacent `package.json`)

| Library | Version | Purpose in this phase | Why not new |
|---------|---------|------------------------|--------------|
| `pg-boss` | `^12.18.3` | Ad-hoc `boss.send('snapshot-calendars', …)` enqueue (SNAP-01) | Already the job-queue dependency in `apps/server`, `apps/worker`, `packages/adapters` |
| `zod` | `^4.4.3` | New ping payload schema, new rule-tag request/response schemas, enum-array validation at the boundary | Already the sole validation library (`typescript.md` mandates parse-don't-cast) |
| `drizzle-orm` | `^0.45.2` | New `calendar_snapshots.trigger`/`reason` column, new `calendar_event_annotations` table | Already the sole ORM, confined to `packages/adapters/postgres/` |
| `hono` | `^4.12.23` | New rule-tag HTTP route, modified ping SSE payload | Already the HTTP framework |
| `lucide-react` | `^1.21.0` | One alarm glyph on STALLED (per `20-UI-SPEC.md`) | Already a web dependency, no new icon package |
| `vitest` / `fast-check` | `^4.1.8` / `^4.8.0` | Property tests for the rolling-window move detector and the elapsed-time badge-state derivation | Already the test stack (`tdd.md` mandates fast-check for numeric/threshold code) |

**Installation:** none required.

**Version verification:** all six versions above were read directly from this repo's
`package.json` files during research (not training-data recollection) — `[VERIFIED: package.json]`.

## Package Legitimacy Audit

**Not applicable this phase.** No external packages are installed by WATCH-01, SNAP-01, or
RULE-01 — all three reuse the existing dependency set (see Standard Stack). No legitimacy check
was run because there is nothing to check.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── WATCH-01 ────────────────────────────┐
│  Sidecar ──(LEVELONE_OPTIONS ticks)──> apps/server               │
│                                          │                        │
│                                    stream-fan-out.ts              │
│                                    (bufferTick, ~1/sec flush)      │
│                                          │                        │
│                              GET /api/stream (SSE, ticket-authed) │
│                              ┌───────────┴────────────┐           │
│                     event:"ticks" (~1/sec)   event:"ping" (30s)   │
│                              │                         │          │
│                              ▼                         ▼          │
│                     useLiveStream.ts: setGreeks   useLiveStream.ts:│
│                     lastTickAt=now                setIsRth(payload)│
│                              │                         │          │
│                              └─────────┬───────────────┘          │
│                                        ▼                          │
│                     [NEW] elapsed-time interval timer              │
│                     derives status from (isRth, msSinceLastTick,   │
│                     hasEverConnected) every ~1-5s                  │
│                                        │                          │
│                                        ▼                          │
│                            LiveStatusBadge (3-state + CONNECTING   │
│                            copy-only condition, D-20 alarm tone)   │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────────── SNAP-01 ────────────────────────────────┐
│  Sidecar ──(RawOptionTick incl. underlyingPrice=SPX spot)──>       │
│    apps/server: sidecar-sse.ts dispatchFrame()                      │
│         │                                                           │
│         ├──> recomputeLiveGreek (existing, per-OCC greeks path)      │
│         └──> [NEW] observeSpot(tick.underlyingPrice, tick.ts)        │
│                       │                                              │
│              [NEW] rolling-window ring buffer (pure, core)           │
│              detectLargeMove(buffer, newSpot, thresholdPct, windowMs)│
│                       │ (threshold crossed AND isWithinRth)           │
│                       ▼                                              │
│              [NEW] cooldown check: query MAX(time) FROM               │
│              calendar_snapshots; now − lastSnapshotTime > cooldownMs? │
│                       │ yes                                          │
│                       ▼                                              │
│              apps/server's own jobBoss.send('snapshot-calendars', {},│
│                { singletonKey: 'event-move-<flooredWindow>' })        │
│                       │                                              │
│                       ▼                                              │
│  apps/worker: snapshot-calendars handler (UNCHANGED RTH+holiday gate,│
│  existing use-case) writes calendar_snapshots row with                │
│  [NEW] trigger='event-move' (vs 'scheduled' default)                  │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────────── RULE-01 ─────────────────────────────────┐
│  Journal.tsx "Notes" panel                                           │
│    ├─ [NEW] GET /api/journal/:calendarId/rules ─┐                    │
│    │      (events list + existing annotations)  │                    │
│    └─ [NEW] PUT /api/journal/events/:hash/rules ─┤                    │
│                (tags[] + optional otherNote)      │                    │
│                                                    ▼                   │
│                                    apps/server routes + MCP tools      │
│                                    (get_rule_tags / set_rule_tags)     │
│                                                    │                   │
│                                     packages/core: new use-cases       │
│                                     over ForReadingCalendarEvents      │
│                                     (EXISTING, unused today) +          │
│                                     [NEW] ForReading/WritingAnnotations │
│                                                    │                   │
│                                                    ▼                   │
│                          packages/adapters/postgres: [NEW]              │
│                          calendar_event_annotations (keyed by            │
│                          fill_ids_hash, NO foreign-key constraint —      │
│                          see Pitfall 3)                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new top-level folders — every addition slots into existing bounded-context directories.

```
packages/core/src/
├── streaming/
│   ├── domain/
│   │   └── spot-move-detector.ts     # NEW — pure rolling-window % move detector (SNAP-01)
│   └── ports.ts                       # extend: RawOptionTick already has underlyingPrice
├── journal/
│   ├── domain/
│   │   ├── snapshot-cooldown.ts      # NEW — pure isWithinCooldown(now, last, cooldownMs)
│   │   └── rule-tags.ts              # NEW — RuleTagEnum + validation helpers (RULE-01)
│   └── application/
│       ├── getCalendarEventsWithRules.ts  # NEW — read use-case (RULE-01)
│       └── setRuleTags.ts                 # NEW — write use-case (RULE-01)
packages/adapters/src/postgres/
├── schema.ts                          # extend calendarSnapshots (+trigger/reason);
│                                       # NEW calendarEventAnnotations table
├── repos/
│   ├── calendar-snapshots.ts          # extend persistSnapshot mapping
│   └── calendar-event-annotations.ts  # NEW repo
└── migrations/0016_*.sql              # NEW migration (next number after 0015)
apps/server/src/adapters/
├── http/
│   ├── stream.routes.ts               # modify: ping payload (both duplicated loops)
│   └── journal-rules.routes.ts        # NEW — GET/PUT rule-tag routes (RULE-01)
├── http/sidecar-sse.ts                # modify: dispatchFrame calls deps.observeSpot()
└── mcp/tools.ts                       # extend: get_rule_tags / set_rule_tags tools
apps/web/src/
├── hooks/useLiveStream.ts             # modify: ping handling + elapsed-time timer
├── components/LiveStatusBadge.tsx     # modify: 3-state + CONNECTING derivation
└── screens/Journal.tsx                # modify: rule-tag control + read-view pill
```

### Pattern 1: Unified grace-then-escalate timer (WATCH-01)

**What:** D-01 (transport-dead → red) and D-11 (cold-start/reconnect → no false red for ~20s)
look like they conflict, but both resolve to a single elapsed-time model: track one anchor
timestamp — "time of the last valid tick, or connection-attempt start if none yet" — and run an
interval that re-evaluates status every 1-5 seconds against that anchor plus the server-pushed
`isRth` flag. There is no separate "just disconnected" red state; disconnection just stops the
tick clock, and the SAME ~20s threshold that detects "ticks frozen" also covers "reconnecting with
no tick yet."

**When to use:** Any state that depends on elapsed time without a corresponding event (silence is
itself the signal) — this is why `es.onerror` must NOT set state directly to a red/alarm color
today; it should only mark "no longer receiving," letting the shared timer decide LIVE/QUIET/
STALLED based on how long that silence has lasted, combined with the last known `isRth`.

**Example (derivation logic, not wired to React yet — recommend extracting as a pure function
for testability per `tdd.md`):**
```typescript
// packages/shared or apps/web/src/lib — pure, framework-free, unit-testable
export type DerivedStatus = "live" | "quiet" | "connecting" | "stalled";

export function deriveStreamStatus(input: {
  readonly hasReceivedFirstTick: boolean;
  readonly msSinceLastTickOrConnect: number;
  readonly isRth: boolean | null; // null = no ping received yet
  readonly stallThresholdMs: number; // ~20_000, tunable
}): DerivedStatus {
  if (input.isRth === false) return "quiet"; // market closed — benign, always wins
  if (input.isRth === null) return "connecting"; // no ping yet — treat as cold start
  // isRth === true from here down
  if (input.msSinceLastTickOrConnect < input.stallThresholdMs) {
    return input.hasReceivedFirstTick ? "live" : "connecting";
  }
  return "stalled";
}
```
Source: derived from `useLiveStream.ts` state machine + `20-UI-SPEC.md` CONNECTING contract
(component computes label from `(status, isRthAccordingToLastHeartbeat, hasReceivedFirstTick)`).
`[VERIFIED: apps/web/src/hooks/useLiveStream.ts, apps/web/src/components/LiveStatusBadge.tsx]`

**Ping payload contract addition (D-03):**
```typescript
// packages/contracts/src/stream-events.ts — NEW schema, additive
export const streamPingEvent = z.object({
  /** Server-computed RTH+holiday gate at ping time — reuses isWithinRth (+isNyseHoliday). */
  isRth: z.boolean(),
});
export type StreamPingEvent = z.infer<typeof streamPingEvent>;
```
Both `GET /api/stream` handlers in `stream.routes.ts` (the JWT-inside one and
`makeStreamSseRouter`'s outside-JWT one — they are deliberately duplicated per that file's own
comment, "kept in sync manually") must be updated identically:
```typescript
// stream.routes.ts — both copies, replacing `data: ""`
await stream.writeSSE({
  event: "ping",
  data: JSON.stringify(streamPingEvent.parse({
    isRth: isWithinRth(new Date()) && !isNyseHoliday(new Date()),
  })),
});
```
`isWithinRth`/`isNyseHoliday` are already exported from `@morai/core` and already used by
`snapshot-calendars.ts`'s gate — reusing them here means the badge's "market open" truth and the
snapshot job's "market open" truth can never disagree. `[VERIFIED: packages/core/src/index.ts,
apps/worker/src/handlers/snapshot-calendars.ts]`

### Pattern 2: Rolling-window move detector fed from the existing tick-recompute path (SNAP-01)

**What:** `apps/server/src/adapters/http/sidecar-sse.ts`'s `dispatchFrame` already Zod-parses
every raw sidecar tick into a `RawOptionTick` with a `underlyingPrice` field (Schwab's
UNDERLYING_PRICE, field 35 — the SPX spot) BEFORE calling `recomputeLiveGreek`. Today that value
is used only to compute BSM greeks and is then discarded. This is the only point in the system
where the SPX spot arrives without any new data source, subscription, or sidecar change.

**When to use:** Any headless (non-UI) detector that needs the live SPX price — always hook here,
not a new sidecar stream, not a new browser-side listener (D-04 explicitly rules out the browser).

**Example:**
```typescript
// apps/server/src/adapters/http/sidecar-sse.ts — extend ConnectToSidecarStreamDeps
export type ConnectToSidecarStreamDeps = {
  // ...existing fields...
  /** NEW — observes every raw underlying price tick, independent of recompute success.
   *  Called even when recompute fails (bad-symbol/expired/iv-failed) — a stale option
   *  contract does not mean the spot price itself is bad. */
  readonly observeSpot?: (spot: number, ts: string) => void;
};

// inside dispatchFrame, right after sidecarTickSchema.safeParse succeeds:
if (rawTick.underlyingPrice !== null && rawTick.underlyingPrice > 0) {
  deps.observeSpot?.(rawTick.underlyingPrice, rawTick.ts);
}
```
`[VERIFIED: apps/server/src/adapters/http/sidecar-sse.ts]`

**Pure rolling-window detector (core, property-testable):**
```typescript
// packages/core/src/streaming/domain/spot-move-detector.ts
export type SpotSample = { readonly ts: number; readonly price: number };

/** Pure ring-buffer prune + threshold check. No I/O, no Date.now() (caller passes `nowMs`). */
export function detectLargeMove(
  window: ReadonlyArray<SpotSample>,
  newSample: SpotSample,
  windowMs: number,
  thresholdPct: number,
): { readonly triggered: boolean; readonly nextWindow: ReadonlyArray<SpotSample> } {
  const pruned = window.filter((s) => newSample.ts - s.ts <= windowMs);
  const nextWindow = [...pruned, newSample];
  const oldest = pruned[0]; // approximates "price ~windowMs ago"; empty on cold start
  if (oldest === undefined) return { triggered: false, nextWindow };
  const pctMove = Math.abs(newSample.price - oldest.price) / oldest.price;
  return { triggered: pctMove >= thresholdPct, nextWindow };
}
```
Tunables (Claude's Discretion, justified): `windowMs = 5 * 60_000` (~5min, per D-05's own framing
— long enough to catch a fast spike, short enough to exclude slow all-day drift, matching the
`dataintellect.com` Poisson stall-framing already cited in `FEATURES.md` for the analogous
watchdog problem); `thresholdPct = 0.01` (1%, per D-05 — an index-level move, not a single-name
move, so 1% on SPX is already a materially large intraday swing).

**Cooldown — the cross-process problem (D-06):** The scheduled cadence is chain-triggered from
`apps/worker` (`fetch-schwab-chain`/`fetch-cboe-chain` → ... → `snapshot-calendars`, using a
FIXED `singletonKey` like `"triggered-by-chain"` with no `singletonSeconds` — confirmed by reading
`fetch-schwab-chain.ts`/`fetch-cboe-chain.ts`). The event-triggered detector runs in
`apps/server`, a **separate OS process**. An in-memory "last fired at" variable inside the
detector cannot see when the worker's cron chain last actually wrote a snapshot row. The existing
codebase's own time-windowed-dedup pattern (`packages/core/src/journal/domain/dedupe-key.ts`,
`scheduledDedupeKey`) floors `now` to a FIXED window boundary and relies on pg-boss's default
"one active job per key" — this only dedupes among calls that share the SAME process's key
generation and does not know about a snapshot fired from a different code path. **Recommendation:
query the ground truth in Postgres.**
```typescript
// packages/core/src/journal/domain/snapshot-cooldown.ts — pure, testable
export function isWithinCooldown(now: Date, lastSnapshotAt: Date | null, cooldownMs: number): boolean {
  if (lastSnapshotAt === null) return false;
  return now.getTime() - lastSnapshotAt.getTime() < cooldownMs;
}
```
```typescript
// NEW driven port, packages/core/src/journal/application/ports.ts
export type ForReadingLatestSnapshotTime = () => Promise<Result<Date | null, StorageError>>;
```
Postgres implementation: `SELECT MAX(time) FROM calendar_snapshots` — cheap, because `time` is
the LEADING column of the existing composite PK `(time, calendar_id)`, so this is an index-only
scan, not a table scan. `cooldownMs = 15 * 60_000` (~15min, per D-06 — "at most one supplemental
between 30-min scheduled runs").

**Enqueue (reuses an existing, currently-idle client):** `apps/server/src/main.ts` (~line 216)
already instantiates its OWN `PgBoss` client — `jobBoss` — with the comment "PgBoss instance for
job enqueueing only (the worker is responsible for processing)". This is exactly the client
SNAP-01's detector should call — no new PgBoss client, no HTTP call to the worker.
`[VERIFIED: apps/server/src/main.ts:216]`
```typescript
// apps/server — new small wiring near the sidecar-sse connection (main.ts)
async function onSpotObserved(spot: number, tsIso: string): Promise<void> {
  const nowDate = new Date(tsIso);
  if (!isWithinRth(nowDate) || isNyseHoliday(nowDate)) return; // D-15 RTH gate
  const { triggered, nextWindow } = detectLargeMove(moveWindow, { ts: nowDate.getTime(), price: spot }, 5 * 60_000, 0.01);
  moveWindow = nextWindow; // module-level mutable state, same pattern as stream-fan-out.ts's tickBuffer
  if (!triggered) return;
  const lastResult = await readLatestSnapshotTime();
  if (!lastResult.ok) return; // fail-safe: skip firing on a read error, never crash the tick path
  if (isWithinCooldown(nowDate, lastResult.value, 15 * 60_000)) return;
  void jobBoss.send("snapshot-calendars", {}, { singletonKey: "event-move" }).catch((e: unknown) => {
    console.warn("snapshot-calendars: event-move enqueue failed", e);
  });
}
```

### Pattern 3: Rule-tag recording as a separate table, no foreign key (RULE-01)

**What:** `rebuildJournal.ts` DELETEs all `calendar_events` rows for a calendar and re-inserts
them from `syncFillsForCalendar` (confirmed: `deleteCalendarEvents` → `syncFillsForCalendar` →
`recomputeCalendarAmounts`). D-09 requires the annotations table to be orthogonal so a rebuild
never silently wipes recorded rule tags. **This means the annotations table's `fill_ids_hash`
column must NOT be a real foreign key** to `calendar_events.fill_ids_hash` — a `REFERENCES ...
ON DELETE CASCADE` would silently delete every annotation on the next rebuild (exactly
recreating the bug D-09 exists to avoid); a `REFERENCES ... ON DELETE RESTRICT` (or no `ON
DELETE` clause, Postgres's default) would make Step 1 of `rebuildJournal` (`deleteCalendarEvents`)
FAIL outright whenever any annotated event exists, breaking rebuild entirely. The column must be
a plain indexed `varchar(64)`, with orphan detection handled at read time (D-09: "log & orphan").

**Example schema (migration `0016_*`, additive):**
```typescript
// packages/adapters/src/postgres/schema.ts
export const calendarEventAnnotations = pgTable("calendar_event_annotations", {
  // Soft reference to calendar_events.fill_ids_hash — deliberately NOT a foreign key (see above).
  fillIdsHash: varchar("fill_ids_hash", { length: 64 }).primaryKey(),
  // text + Zod parse-at-boundary (Claude's Discretion, confirmed): grows without ALTER TYPE,
  // matches the project's existing "parse, don't cast" TypeScript rule more directly than a
  // rigid Postgres native enum would (adding a value to a pg_enum requires a migration + a
  // non-transactional ALTER TYPE ... ADD VALUE in older Postgres; text + Zod is a code-only change).
  ruleTags: text("rule_tags").array().notNull().default([]),
  otherNote: text("other_note"), // D-21: required only when "other" is among ruleTags (contract-level .refine, not a DB CHECK)
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```
```typescript
// packages/core/src/journal/domain/rule-tags.ts — Zod validation, additive per event type
export const enterRuleTag = z.enum([
  "iv-skew-favorable", "term-structure-edge", "event-window-play", "gex-fit", "other",
]);
export const exitRuleTag = z.enum([
  "profit-target", "max-loss", "time-stop", "thesis-invalidated", "other",
]);
export const rollRuleTag = z.enum(["defend-tested-side", "roll-for-duration", "other"]);
```
Source of these seed values (D-08 requires KB grounding, user trims before lock):
- ENTER seeds mirror the 8 already-verified `scoreCalendarCandidates` scoring criteria from
  `.planning/research/calendar-selection-criteria.md` (criterion 1 → `iv-skew-favorable`,
  criterion 2 → `term-structure-edge`, criteria 3/4 → `event-window-play`, criterion 7 →
  `gex-fit`). Recommend this alignment explicitly: a user picking a candidate from the Picker
  (Phase 19) already saw these exact dimensions as the "why"; reusing the same vocabulary for
  "why I entered" avoids inventing a second, disconnected taxonomy. `[VERIFIED:
  .planning/research/calendar-selection-criteria.md]`
- EXIT seeds map directly to criterion 9's exit defaults ("+20-30% profit target, -15-20% mental
  stop... 21-DTE management rule for short legs") → `profit-target`, `max-loss`, `time-stop`.
  `thesis-invalidated` is a floated catch-all (illustrative, not KB-sourced) — flag as
  `[ASSUMED]`, user should confirm it earns its slot distinct from `other`.
  `[CITED: .planning/research/calendar-selection-criteria.md criterion 9]`
- ROLL seeds map to `knowledge-base/grouped-data/calendar_spread.md`: "Management decision point
  occurs 3-5 days before expiration: hold for final theta, **roll to new month**" →
  `roll-for-duration`; "Adjustment Strategy Critical for Mid-Trade Moves... **'move the tent' by
  adding calendar at new strike in direction of move**" → `defend-tested-side`. `[CITED:
  knowledge-base/grouped-data/calendar_spread.md]`

**The missing read surface (important scope finding):** `ForReadingCalendarEvents` exists in
`packages/core/src/journal/application/ports.ts`, is implemented by both
`packages/adapters/src/postgres/repos/calendar-events.ts` and
`packages/adapters/src/memory/calendar-events.ts`, but **grep across `apps/server/src` and
`apps/web/src` for any route or MCP tool calling `readCalendarEvents` returns zero matches.**
Nothing today exposes OPEN/CLOSE/ROLL events to the browser or MCP. RULE-01 must add this read
path — it is not a pre-existing gap the planner can assume away. Recommend one combined read
route (`GET /api/journal/:calendarId/rules` returning both the event list — for the UI to know
whether a CLOSE/ROLL section should render, per D-10 — and any existing annotations) rather than
two separate round trips, to keep the new adapter surface minimal per D-13's "same PR" framing.
`[VERIFIED: grep across apps/server/src, apps/web/src — no readCalendarEvents caller]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RTH/holiday gating for the ping payload | A second weekday/hour check in the SSE route | `isWithinRth` + `isNyseHoliday` from `@morai/core` (already used by `snapshot-calendars.ts`) | Two independent RTH implementations WILL drift (badge says open, job says closed, or vice versa) — this is exactly the class of bug Phase 12's "badge lies LIVE" already was |
| Time-windowed job dedup | A fresh singleton/debounce library or a bespoke Redis-style TTL cache | Reuse the reasoning (not the exact function) from `packages/core/src/journal/domain/dedupe-key.ts` — but note it alone is insufficient here (see Pattern 2); combine with the Postgres `MAX(time)` read | The codebase already solved "prevent duplicate scheduled enqueues" once; SNAP-01's twist (two OS processes) needs the DB-truth layer on top, not a replacement |
| A cross-process lock/mutex for the cooldown | A distributed lock (advisory lock, Redis lock) | A plain `SELECT MAX(time)` read plus pg-boss's own `singletonKey` as a same-process double-fire guard | Postgres is already the single source of truth for every other piece of state in this system (D-06's "ANY snapshot" requirement is itself a database fact, not a queue fact) |
| Rule-tag enum storage | A generic "tags" jsonb blob with no schema, or a fully dynamic rules table | `text[]` column + Zod `z.enum([...])` per event type, validated at the HTTP/MCP boundary | Matches `typescript.md`'s "parse, don't cast" and keeps the enum growable without `ALTER TYPE`, while still rejecting garbage values at the edge |
| Foreign-key referential integrity for annotations | A `REFERENCES calendar_events(fill_ids_hash)` constraint "for safety" | A plain indexed column, orphan-detected at read time | A real FK actively reintroduces the exact data-loss bug (CASCADE) or exactly the exact rebuild-breaking bug (RESTRICT) that D-09 is designed to prevent — see Pattern 3 |

**Key insight:** every "don't hand-roll" item above is really the same lesson restated three
times — this codebase already has a canonical implementation of "is the market open," "how do we
dedupe a scheduled job," and "how do we keep derived data safe from a destructive rebuild." The
temptation in this phase is to write a second, slightly different version of each because the
new caller (ping route, cross-process detector, annotations table) looks superficially different
from the original caller. Reuse the primitive; don't reinvent the reasoning.

## Common Pitfalls

### Pitfall 1: Flipping to red immediately on `onerror`
**What goes wrong:** The existing `useLiveStream.ts` sets `status = "stale"` synchronously inside
`es.onerror`. If WATCH-01 is implemented by a naive relabel (`"stale"` → `"stalled"`), every
transient reconnect (which happens routinely — Railway/nginx idle timeouts, brief network blips)
would flash red, violating D-11's cold-start/reconnect grace and defeating the entire point of
this phase (an honest badge that doesn't cry wolf).
**Why it happens:** The current 4-state model treats "disconnected" as a terminal visual state;
the new 3-state model treats it as one input into an elapsed-time derivation (see Pattern 1).
**How to avoid:** `onerror` should stop updating `lastTickAt`/clear a "connected" flag, but the
actual color/label must come from the shared interval-driven `deriveStreamStatus` function, not
from the error handler directly.
**Warning signs:** A code review sees `setStatus("stalled")` called directly inside `onerror` or
`onopen` — that is the old pattern re-skinned, not the new one.

### Pitfall 2: Cooldown state trapped in one process
**What goes wrong:** An in-memory `lastFiredAt` variable inside `apps/server`'s detector will
correctly debounce repeated event-triggers from the SAME process, but has no idea the worker's
cron chain fired a scheduled snapshot 3 minutes ago — so D-06 ("cooldown vs ANY snapshot") is
silently violated, and a supplemental snapshot fires needlessly close to a scheduled one.
**Why it happens:** `apps/server` (detector) and `apps/worker` (scheduled cadence) are separate
OS processes with separate memory; only Postgres is shared.
**How to avoid:** Always resolve the cooldown via `SELECT MAX(time) FROM calendar_snapshots`
(see Pattern 2) — never via an in-process variable as the sole guard.
**Warning signs:** A plan task says "track `lastSnapshotAt` as a module-level variable in the
detector" without also reading the DB before firing.

### Pitfall 3: A foreign key on the annotations table
**What goes wrong:** Adding `.references(() => calendarEvents.fillIdsHash)` (with or without
`onDelete`) either silently deletes annotations on every journal rebuild (CASCADE) or breaks
rebuild entirely by making the DELETE step fail (RESTRICT/default) whenever an annotated event
exists.
**Why it happens:** FK constraints feel like "the correct, safe" way to link two tables; here
the correct behavior is explicitly the OPPOSITE of referential integrity (D-09 wants survival
across the referenced row's deletion).
**How to avoid:** Plain `varchar(64)` column with a regular (non-FK) index; join in application
code; treat a missing match as "orphaned" and log it, per D-09.
**Warning signs:** Migration SQL contains `REFERENCES calendar_events` anywhere near this table.

### Pitfall 4: Assuming a calendar-events read surface already exists
**What goes wrong:** A plan task for "wire the Journal rule-control to the events it needs" that
assumes `GET /api/journal/:calendarId` (the snapshot-series endpoint) also returns OPEN/CLOSE/ROLL
event data. It does not — `journalResponse` only carries `SnapshotRow[]`.
**Why it happens:** `ForReadingCalendarEvents` clearly exists in the codebase (repo + memory
twin + domain type), making it easy to assume it's already wired end-to-end like every other
port in this mature codebase.
**How to avoid:** Explicitly plan a new route/MCP tool/use-case for reading events (see Pattern
3's missing-read-surface note) as its own task, not a one-line addition to an existing endpoint.
**Warning signs:** No new HTTP route file or MCP tool registration appears anywhere in the
RULE-01 plan.

### Pitfall 5: Ping-interval confusion for the stall threshold
**What goes wrong:** Assuming the ~20s stall threshold must equal or divide the ping interval
(currently a fixed 30s `stream.sleep(30_000)` loop), and "fixing" this by shortening the ping
interval to 20s or less.
**Why it happens:** Both numbers are "heartbeat-adjacent" and look like they should relate.
**How to avoid:** They are orthogonal. Ticks (not pings) are the ~1/sec liveness signal already
proven by the `"ticks"` SSE event; the ping's only new job (D-03) is carrying the `isRth` boolean,
which does not need sub-30s freshness (RTH only changes state at fixed times: 9:30/16:00 ET, and
weekday/holiday boundaries — a 30s-stale `isRth` value is never wrong in a way that matters).
Leave the 30s ping interval unchanged; the stall check is purely `Date.now() - lastTickAt >
20_000`.
**Warning signs:** A plan task proposes changing `stream.sleep(30_000)`'s interval value.

## Code Examples

### Deriving badge visual state from the 3-valued status + CONNECTING condition
```typescript
// Source: apps/web/src/components/LiveStatusBadge.tsx (existing STATUS_CONFIG pattern,
// extended per 20-UI-SPEC.md's exact contract — CONNECTING reuses QUIET's classes verbatim)
const STATUS_CONFIG = {
  live: { label: "LIVE", textColor: "var(--color-up)", background: "transparent", showDot: true },
  quiet: { label: "QUIET", textColor: "var(--color-dim)", background: "transparent", showDot: false },
  connecting: { label: "CONNECTING", textColor: "var(--color-dim)", background: "transparent", showDot: false },
  stalled: { label: "STALLED", textColor: "var(--color-down)", background: "var(--color-downd)", showDot: false },
} as const;
```

### Ad-hoc singletonKey enqueue — exact existing pattern to mirror
```typescript
// Source: apps/worker/src/handlers/snapshot-calendars.ts (existing D-03/06-04 pattern)
void deps.boss.send("compute-analytics", {}, {
  singletonKey: "triggered-by-snapshot",
}).catch((e: unknown) => {
  console.warn("snapshot-calendars: failed to enqueue compute-analytics", e);
});
// SNAP-01's detector mirrors this exact fire-and-forget shape, substituting jobBoss.send(
// "snapshot-calendars", {}, { singletonKey: "event-move" }) after the cooldown check passes.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| 4-state badge (`live`/`stale`/`reconnecting`/`poll`), amber for staleness | 3-state (LIVE/QUIET/STALLED), red for STALLED, CONNECTING as a copy-only condition | This phase (D-01/D-20) | STALLED can no longer be confused with a benign closed-market state; closes the Phase-12 "badge lies LIVE" debt |
| `ping` SSE event carries no data, is explicitly ignored client-side | `ping` carries `{isRth: boolean}`, drives client state | This phase (D-03) | The client no longer needs (or should have) a local RTH clock — server is authoritative |
| `calendar_snapshots` has no provenance — every row looks identically "scheduled" | Nullable `trigger`/`reason` column distinguishes `scheduled` vs `event-move` | This phase (D-12) | Enables future filtering/analysis of "what happened" moments without touching existing rows |
| `entryThesis` free-text column on `calendars`/`calendar_events`, silently wiped by every rebuild | Structured `calendar_event_annotations` table, orthogonal to the rebuilt ledger | This phase (D-09) | Fixes a documented latent data-loss bug for the FIRST time this phase touches that area — not a new problem introduced, but the first fix |

**Deprecated/outdated:** The `entryThesis` column stays in place (D-16: "deprecated/left in
place... the rebuild-null bug makes surviving data near-moot") — do not migrate its contents into
the new annotations table; it is simply superseded going forward.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `thesis-invalidated` earns a distinct EXIT enum slot separate from `other` | Pattern 3 / RULE-01 enum seeds | Low — D-08 explicitly requires user trim before lock; worst case is one extra enum value that's rarely used |
| A2 | A 1-5s client-side re-evaluation interval is granular enough for both the ~20s stall threshold and RTH-boundary transitions | Pattern 1 | Low — even a 5s interval means at most 5s of lag on a 20s threshold and negligible lag on RTH boundaries that only occur twice a day |
| A3 | Comparing latest spot to the OLDEST sample retained in the rolling window (rather than min/max within the window) is an adequate operationalization of "absolute % move over a short rolling window" (D-05) | Pattern 2 | Medium — a fast spike-then-partial-reversion within the window could be under- or over-counted differently than a min/max approach; recommend the planner confirm this operationalization against a UAT scenario using historical SPX tick data if available |
| A4 | pg-boss `singletonKey` without `singletonSeconds` behaves as "one active/uncompleted job per key" only (not a time-window dedup) | Pattern 2 / Don't Hand-Roll | Low-Medium — sourced from a web search of pg-boss community docs/issues, not the pinned `pg-boss@12.18.3` source directly; recommend a quick confirming read of the installed `node_modules/pg-boss` source or its CHANGELOG before relying on this for the cross-process guard's exact semantics |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Exact rolling-window comparison method for SNAP-01 (oldest-sample-in-window vs true min/max)**
   - What we know: D-05 specifies "absolute % move over a short rolling window (~1% within
     ~5min)"; the codebase has no prior art for this kind of detector to copy.
   - What's unclear: Whether comparing latest-to-oldest-in-window is what the user actually means
     by "large move," versus comparing against the window's min/max (which would catch a
     spike-and-partial-reversion pattern the oldest-sample comparison could miss).
   - Recommendation: Ship the simpler oldest-sample comparison (Pattern 2) first — it is O(1),
     easy to property-test, and matches the D-05 framing literally ("move... over a window").
     Revisit only if real SPX tick data during UAT shows it under-triggers on a known volatile
     session.

2. **Does the ping-payload change need a stream-contract version bump or is it purely additive?**
   - What we know: `streamPingEvent` is a brand-new schema (the event currently has no data
     payload at all — the client's own comment says `ping` is "ignored").
   - What's unclear: Whether any other consumer (Claude Code MCP, a mobile client, etc.) reads
     the raw ping frame today and would break on a non-empty `data` field.
   - Recommendation: Confirmed via grep that `useLiveStream.ts` never registers an
     `addEventListener("ping", ...)` — nothing consumes it today, so this is safely additive. No
     other consumer found in `apps/web/src` or `apps/server/src`. `[VERIFIED: grep across
     apps/web/src, apps/server/src for addEventListener\("ping"]`

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependencies. All three
sub-phases operate entirely within the existing Bun/Hono/Postgres/pg-boss/React stack, already
verified live in this repo (`package.json` versions above) and already deployed to prod per
`.planning/STATE.md`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`^4.1.8`) + fast-check 4 (`^4.8.0`), per-package `vitest.config.ts` under `test.projects` |
| Config file | `vitest.config.ts` (root, workspace-style `projects` glob) |
| Quick run command | `bun run test -- <path/to/file>.test.ts` (per-file, package-local) |
| Full suite command | `bun run test` (root `vitest run` across all workspace projects) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| WATCH-01 | `deriveStreamStatus` returns `quiet` whenever `isRth === false`, regardless of tick recency | unit + fast-check (property: quiet dominates) | `bun run test -- apps/web/src/lib/deriveStreamStatus.test.ts` | ❌ Wave 0 |
| WATCH-01 | Status flips `stalled` exactly at/after the threshold, never before | fast-check (property: monotonic in elapsed time) | same file as above | ❌ Wave 0 |
| WATCH-01 | Ping payload round-trips through `streamPingEvent` Zod schema; malformed ping is dropped (badge holds last-known-good) | unit | `bun run test -- packages/contracts/src/stream-events.test.ts` | ❌ Wave 0 (extend existing contract test file if present) |
| SNAP-01 | `detectLargeMove` triggers exactly at the threshold boundary, prunes samples outside the window correctly | fast-check (property: window pruning invariant + threshold boundary) | `bun run test -- packages/core/src/streaming/domain/spot-move-detector.test.ts` | ❌ Wave 0 |
| SNAP-01 | `isWithinCooldown` correctly gates on the boundary (`now - last == cooldownMs` is NOT within cooldown; `< cooldownMs` IS) | unit + fast-check | `bun run test -- packages/core/src/journal/domain/snapshot-cooldown.test.ts` | ❌ Wave 0 |
| SNAP-01 | Postgres `MAX(time)` read returns `null` when no snapshots exist yet (cold start), never throws | testcontainers (Postgres repo test, per `tdd.md`) | `bun run test -- packages/adapters/src/postgres/repos/calendar-snapshots.test.ts` | ❌ Wave 0 (extend existing repo test) |
| RULE-01 | `calendar_event_annotations` write/read round-trips via both the Postgres repo and the in-memory twin (contract parity, per the existing `.contract.ts` pattern) | testcontainers + in-memory, contract test | `bun run test -- packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` | ❌ Wave 0 |
| RULE-01 | Selecting `other` without a note is rejected at the Zod boundary; any listed enum value without a note is accepted | unit | `bun run test -- packages/core/src/journal/domain/rule-tags.test.ts` | ❌ Wave 0 |
| RULE-01 | A rebuild (`rebuildJournal`) never deletes rows in `calendar_event_annotations` (regression guard for the D-09 rationale) | integration (testcontainers) | `bun run test -- packages/core/src/journal/application/rebuildJournal.test.ts` (extend existing) | ❌ Wave 0 (extend existing file) |

### Sampling Rate

- **Per task commit:** run the specific new/changed test file(s) via the quick-run command above.
- **Per wave merge:** `bun run test` (full workspace suite).
- **Phase gate:** full suite green, plus `bun run typecheck && bun run lint`, before
  `/gsd-verify-work 20` — per `.claude/rules/workflow.md`'s "Verification Before Done."

### Wave 0 Gaps

- [ ] `apps/web/src/lib/deriveStreamStatus.test.ts` — new pure function + fast-check property
      tests for WATCH-01's status derivation (extract the function per Pattern 1 before testing
      it — do not test it embedded inside the React hook).
- [ ] `packages/contracts/src/stream-events.test.ts` — round-trip test for the new
      `streamPingEvent` schema (create if no existing test file for this contract module).
- [ ] `packages/core/src/streaming/domain/spot-move-detector.test.ts` — new file, fast-check
      property tests (window pruning, threshold boundary, monotonicity).
- [ ] `packages/core/src/journal/domain/snapshot-cooldown.test.ts` — new file, boundary-condition
      unit tests + a fast-check property (`isWithinCooldown` is monotonic in elapsed time).
- [ ] `packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` — new
      contract-parity test file, mirroring the existing `calendar-events.contract.ts` pattern
      (memory twin vs Postgres via testcontainers).
- [ ] `packages/core/src/journal/domain/rule-tags.test.ts` — new file, Zod-boundary validation
      tests for the OTHER-requires-note rule (D-21).
- Framework install: none — Vitest/fast-check/testcontainers already fully configured project-wide.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (unchanged) | Existing Supabase JWT (routes) / bearer token (jobs) — this phase adds no new auth surface beyond routes already inside `authReadGroup` |
| V3 Session Management | No (unchanged) | SSE ticket-auth pattern (single-use, 30s TTL) is untouched by the ping-payload change |
| V4 Access Control | Yes | New `GET/PUT /api/journal/*/rules` routes MUST mount inside the same `authReadGroup` JWT middleware as every other journal-adjacent route (`calendar.routes.ts` precedent) — never expose rule-tag write access unauthenticated |
| V5 Input Validation | Yes | Zod at every new boundary: `streamPingEvent` (server→client, still validated defensively client-side per the existing "drop malformed, never cast" rule), rule-tag enum arrays (client→server), `otherNote` conditional-required refinement (D-21) |
| V6 Cryptography | No (unchanged) | No new secrets, tokens, or crypto surfaces in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Unbounded `ruleTags` array / injection of arbitrary strings into `other_note` | Tampering | Zod `z.array(z.enum([...])).max(N)` for tags; `z.string().max(280)` (or similar bound) for `otherNote` — never persist an unbounded client string |
| Snapshot-enqueue flooding (a malicious or buggy client forcing repeated `event-move` triggers) | Denial of Service | Already covered by D-06's cooldown (Pattern 2) + the RTH gate (D-15) — a flood outside RTH or inside the 15-min cooldown window is a no-op by construction; no additional rate-limit needed beyond what D-06 already specifies |
| Cross-calendar tag leakage (reading/writing another user's rule tags via a guessed `fillIdsHash`) | Elevation of Privilege / Information Disclosure | `fillIdsHash` is a SHA-256 hex string (64 chars, effectively unguessable) AND the route is inside `authReadGroup` — but confirm the read/write use-case still scopes correctly if this app ever becomes multi-tenant (currently single-user per `PROJECT.md`, so this is a defense-in-depth note, not a blocking finding) |
| Ping-payload becomes an unintended data channel | Information Disclosure | `streamPingEvent` carries only a boolean (`isRth`) — no PII, no account data; keep it that minimal, resist the temptation to add more fields to "batch" other state into the ping |

## Project Constraints (from CLAUDE.md)

- **Dependencies point inward** — new core additions (`spot-move-detector.ts`,
  `snapshot-cooldown.ts`, `rule-tags.ts`) MUST import only `@morai/shared`; the Postgres repo and
  the `jobBoss`/pg-boss call MUST stay in `packages/adapters`/`apps/server` respectively, never in
  `packages/core`.
- **TDD red→green** — every new pure function above (RED test first, run it, confirm the right
  failure, then implement) per `tdd.md`; the annotations table needs both a testcontainers
  Postgres test AND an in-memory-twin test (same PR, per architecture-boundaries.md §8).
- **No `any`, no `as`, no `!`** — the new ping payload, rule-tag request bodies, and the
  `MAX(time)` read's nullable `Date | null` result must all be handled via `Result<T,E>`/explicit
  null checks, never a non-null assertion.
- **Docs before architecture changes** — if the annotations table's no-FK design (Pattern 3) is
  considered a schema-pattern decision worth generalizing, note it in
  `docs/architecture/stack-decisions.md`; at minimum, comment the migration SQL and the Drizzle
  schema definition with the D-09 rationale so a future contributor doesn't "fix" it by adding
  the FK back.
- **New use-case ⇒ HTTP route + MCP tool + in-memory twin, same PR** (architecture-boundaries.md
  §8/§9) — applies to the RULE-01 read/write use-cases; the SNAP-01 cooldown read
  (`ForReadingLatestSnapshotTime`) is an internal driven port feeding an existing job trigger, not
  a new user-facing driver port, so it does NOT need its own HTTP/MCP surface — only its own
  memory-twin implementation for testing.

## Sources

### Primary (HIGH confidence — read directly from this repo during research)
- `apps/web/src/hooks/useLiveStream.ts` — full SSE client state machine, ping handler location
- `apps/web/src/components/LiveStatusBadge.tsx` — existing 4-state config, styling tokens
- `apps/server/src/adapters/http/stream.routes.ts` — both SSE route handlers, ping loop (30s), duplication note
- `apps/server/src/adapters/http/stream-fan-out.ts` — coalescer/fan-out hub
- `apps/server/src/adapters/http/sidecar-sse.ts` — `dispatchFrame`, `RawOptionTick.underlyingPrice` discard point
- `packages/core/src/streaming/recompute-live-greek.ts`, `packages/core/src/streaming/ports.ts` — tick types
- `packages/core/src/journal/domain/rth-window.ts` — `isWithinRth`
- `apps/worker/src/handlers/snapshot-calendars.ts`, `packages/core/src/journal/application/snapshotCalendars.ts` — existing job + use-case
- `packages/core/src/journal/domain/calendar-event.ts`, `application/rebuildJournal.ts`, `application/syncFills.ts` — event domain + rebuild wipe mechanism
- `packages/adapters/src/postgres/repos/calendar-events.ts`, `packages/adapters/src/memory/calendar-events.ts` — confirmed read port exists but is unwired
- `packages/adapters/src/postgres/schema.ts` — `calendarEvents`, `calendars`, `calendarSnapshots` column definitions
- `apps/server/src/adapters/mcp/tools.ts` — MCP tool registration pattern (read-only precedent)
- `apps/server/src/adapters/http/calendar.routes.ts` — HTTP route pattern (write precedent)
- `packages/core/src/journal/application/enqueueJob.ts`, `packages/core/src/journal/domain/dedupe-key.ts` — existing job-dedupe pattern and its limits
- `apps/server/src/main.ts` (line ~216) — `jobBoss` dedicated enqueue-only PgBoss client
- `apps/web/src/components/system/Button.tsx` — Phase-21 primitive, confirms UI-SPEC's component contracts are accurate
- `.planning/research/calendar-selection-criteria.md` — 8 scoring criteria (ENTER/EXIT enum grounding)
- `knowledge-base/grouped-data/calendar_spread.md`, `trade_management.md` — ROLL/EXIT enum grounding
- `.planning/research/FEATURES.md` — stall-detection framing, anti-features (reconnect storms, snapshot flooding)
- `package.json` files across `apps/*`, `packages/*` — dependency version verification

### Secondary (MEDIUM confidence)
- [pg-boss GitHub — Unique Jobs & Debouncing issue #81](https://github.com/timgit/pg-boss/issues/81) — `singletonSeconds` vs bare `singletonKey` semantics, cross-checked against this repo's own usage pattern (no `singletonSeconds` used anywhere today, confirming the "label only" behavior matches observed code)
- [pg-boss official docs](https://timgit.github.io/pg-boss/) — job option reference

### Tertiary (LOW confidence)
- None — every claim in this document is either directly verified against this repo's source or
  cited to an official/community doc cross-checked against repo behavior.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all versions read directly from `package.json`.
- Architecture: HIGH — every attach point and pattern grounded in code actually read this session
  (line numbers and function names cited throughout), not generic SSE/job-queue best practice.
- Pitfalls: HIGH for Pitfalls 1-4 (directly derived from reading the exact existing code that
  would be modified); MEDIUM for Pitfall 5's underlying pg-boss semantics claim (see Assumption
  A4 — recommend a quick confirming read of the installed `pg-boss` package source before the
  planner locks the cooldown design).

**Research date:** 2026-07-05
**Valid until:** 30 days (stable internal codebase; the one external claim — pg-boss semantics —
is pinned to `pg-boss@12.18.3`, unlikely to change without a deliberate version bump in this repo).
