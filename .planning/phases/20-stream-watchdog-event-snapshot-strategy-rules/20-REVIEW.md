---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
reviewed: 2026-07-05T14:04:15Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - apps/server/src/adapters/http/journal-rules.routes.ts
  - apps/server/src/adapters/http/journal-rules.routes.test.ts
  - apps/server/src/adapters/http/sidecar-sse.ts
  - apps/server/src/adapters/http/sidecar-sse.test.ts
  - apps/server/src/adapters/http/stream.routes.ts
  - apps/server/src/adapters/http/stream.routes.test.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/adapters/mcp/tools.test.ts
  - apps/server/src/main.ts
  - apps/web/src/components/LiveStatusBadge.tsx
  - apps/web/src/components/LiveStatusBadge.test.tsx
  - apps/web/src/hooks/useLiveStream.ts
  - apps/web/src/hooks/useLiveStream.test.ts
  - apps/web/src/hooks/useRuleTags.ts
  - apps/web/src/hooks/useRuleTags.test.ts
  - apps/web/src/lib/deriveStreamStatus.ts
  - apps/web/src/lib/deriveStreamStatus.test.ts
  - apps/web/src/screens/Journal.tsx
  - apps/worker/src/handlers/snapshot-calendars.ts
  - apps/worker/src/handlers/snapshot-calendars.test.ts
  - eslint.config.js
  - packages/adapters/src/memory/calendar-event-annotations.ts
  - packages/adapters/src/postgres/repos/calendar-event-annotations.ts
  - packages/adapters/src/postgres/migrations/0016_snapshot_trigger.sql
  - packages/adapters/src/postgres/migrations/0017_calendar_event_annotations.sql
  - packages/adapters/src/postgres/schema.ts
  - packages/contracts/src/journal-rules.ts
  - packages/core/src/journal/application/setRuleTags.ts
  - packages/core/src/journal/application/getCalendarEventsWithRules.ts
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-07-05T14:04:15Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

Reviewed WATCH-01 (stream watchdog), SNAP-01 (event-move snapshot), and RULE-01 (strategy
rules) across core domain, contracts, adapters, MCP tools, HTTP routes, and the web hook/badge.

The pure domain pieces are sound: `deriveStreamStatus` (three-state, boundary-correct),
`detectLargeMove` (prune/threshold/cold-start), `isWithinCooldown`, and the RULE-01 Zod
contract (bounded arrays, `otherNote.max(280)`, OTHER-requires-note refine + a defense-in-depth
re-check in the use-case). The annotations table is correctly orthogonal (varchar PK, no FK, so
it survives `rebuildJournal`), and the upsert is idempotent. The new test suites are genuine —
`useLiveStream.test.ts` drives the interval-based stall/live transitions under fake timers, and
the snapshot-handler tests exercise real branches. No vacuous/tautological tests were found.

The serious problem is in the new server-side wiring: the SNAP-01 `observeSpot` path
(`onSpotObserved` in `main.ts`) runs a synchronous RTH gate on an unvalidated sidecar
timestamp, and that gate can throw into the synchronous tick loop — the exact thing the code's
own comment says must never happen — with no top-level catch to recover the stream. Secondary
findings cluster around badge accuracy at connect, the contracts→core boundary widening, and an
untested business-logic blob living in the composition root.

Not scored (structural/pre-pass): no `<structural_findings>` block was supplied.

## Critical Issues

### CR-01: `observeSpot` can throw into the synchronous tick loop and permanently kill the live stream

**File:** `apps/server/src/main.ts:371-374` (with `packages/core/src/journal/domain/rth-window.ts:23` and `nyse-holidays.ts`)

**Issue:** `onSpotObserved` is invoked synchronously per tick from `dispatchFrame`
(`sidecar-sse.ts:192`, `deps.observeSpot?.(...)`). Its first lines are:

```ts
const now = new Date(tsIso);
if (!isWithinRth(now) || isNyseHoliday(now)) return;
```

`tsIso` is `rawTick.ts`, validated only as `z.string()` (`sidecar-sse.ts:47` — not
`.datetime()`). Any string `new Date` cannot parse yields an **Invalid Date**. Both
`isWithinRth` and `isNyseHoliday` call `Intl.DateTimeFormat(...).formatToParts(now)`, which
throws `RangeError: Invalid time value` on an Invalid Date. The author guarded the *async*
cooldown/enqueue path with `.catch`, but left the *synchronous* RTH gate exposed — directly
violating the in-file invariant: *"dispatchFrame calls observeSpot synchronously per tick — this
MUST NOT throw into the tick loop"* (`main.ts:385`).

The throw propagates out of `dispatchFrame` → the `for (const frame of frames)` loop →
`connectToSidecarStream`, rejecting its promise. `main.ts:411` calls
`void connectToSidecarStream(...)` with **no `.catch` and no reconnect loop** (see WR-02), so the
rejection is unhandled and the sidecar SSE consumer dies permanently. Consequence: live BSM
greeks *and* event-snapshot detection both stop until the process is restarted. A single
malformed/drifted sidecar timestamp is enough.

**Fix:** Validate the timestamp before gating, and/or isolate the callback so it can never throw
into the tick loop. Minimal:

```ts
function onSpotObserved(spot: number, tsIso: string): void {
  const now = new Date(tsIso);
  if (Number.isNaN(now.getTime())) return;          // reject Invalid Date first
  if (!isWithinRth(now) || isNyseHoliday(now)) return;
  // ...
}
```

Prefer also tightening `sidecarTickSchema.ts` field to `z.string().datetime()` so a bad `ts` is
dropped at the Zod boundary, and wrap the `observeSpot?.(...)` call site in `sidecar-sse.ts` in a
try/catch that swallows (logs name only) so no future callback can sever the stream.

## Warnings

### WR-01: Badge shows "QUIET / Market closed" during RTH for up to 30s while live ticks stream

**File:** `apps/server/src/adapters/http/stream.routes.ts:241-254` (and `makeStreamSseRouter` 322-335); interacts with `apps/web/src/lib/deriveStreamStatus.ts:32` and `LiveStatusBadge.tsx:142`

**Issue:** The server ping loop does `await stream.sleep(30_000)` *before* the first ping, so
`isRth` stays `null` on the client for the first ~30s after connect (the reconcile event carries
no `isRth`). During that window `deriveStreamStatus` hits the `isRth === null → "connecting"`
branch, which the hook collapses to `"quiet"`. Because the badge's `isConnecting` guard requires
`isRth === true` (`LiveStatusBadge.tsx:142`), it renders label **QUIET** with tooltip
**"Market closed — outside regular trading hours."** — even though the market is open and live
SPX ticks are already arriving. This is a WATCH-01 status-accuracy defect at market open,
self-correcting only after the first 30s ping.

**Fix:** Emit one ping immediately after the reconcile event (before entering the 30s sleep loop)
so `isRth` is populated on connect:

```ts
// after writeSSE({ event: "reconcile", ... })
const now0 = new Date();
await stream.writeSSE({ event: "ping",
  data: JSON.stringify(streamPingEvent.parse({ isRth: isWithinRth(now0) && !isNyseHoliday(now0) })) });
while (!stream.aborted) { await stream.sleep(30_000); /* ... */ }
```

Apply to both `streamRoutes` and `makeStreamSseRouter` (they are hand-synced duplicates).

### WR-02: `void connectToSidecarStream(...)` has no catch/reconnect, contradicting its documented contract

**File:** `apps/server/src/main.ts:409-419`

**Issue:** The comment above the call states *"reconnect/backoff is handled inside
connectToSidecarStream."* This is false: `sidecar-sse.ts:18-21` explicitly says *"the CALLER
(main.ts) is responsible for reconnect logic … If the fetch fails (non-200 or network error) it
throws — main.ts catches and handles reconnect."* The call site does neither — it is bare
`void connectToSidecarStream(...)` with no `.catch` and no retry loop. Any sidecar disconnect,
non-200, or null body throws, the rejection is unhandled, and the live stream is gone until
process restart. This is a pre-existing gap (only `observeSpot:` was added to the deps this
phase), but it is what escalates CR-01 from a transient error to permanent stream death.

**Fix:** Wrap in a self-healing reconnect loop with backoff, e.g.:

```ts
async function runSidecarLoop(): Promise<void> {
  for (;;) {
    try { await connectToSidecarStream(config.SIDECAR_URL, deps); }
    catch (e) { console.error("sidecar stream error", e instanceof Error ? e.name : "unknown"); }
    await new Promise((r) => setTimeout(r, 2000)); // backoff
  }
}
void runSidecarLoop();
```

Then correct the misleading comment.

### WR-03: `contracts → core` boundary is wider than the documented "values-only" carve-out

**File:** `eslint.config.js:66`, `packages/contracts/src/journal-rules.ts:2`, `packages/contracts/package.json`

**Issue:** The D-07 carve-out is intended to let `contracts` import only core's *plain Zod
enum values* (`enterRuleTag`/`exitRuleTag`/`rollRuleTag`). But the enforcement is weaker than the
intent in two ways: (1) the ESLint rule `{ from: "contracts", allow: ["shared","contracts","core"] }`
permits importing **any** core export — ports, use-case factories, domain logic — so a future
`import { makeSetRuleTagsUseCase } from "@morai/core"` in contracts would pass lint while
silently violating the hexagon; (2) the actual import targets the full `@morai/core` barrel
(`src/index.ts`, which re-exports the entire core surface), so `contracts` — a leaf that
`apps/web` depends on — now type-couples to all of core. The current usage is compliant
(values only), but the guard rail does not encode the constraint the docs promise.

**Fix:** Import the enums from a narrow subpath the boundary rule can scope to (e.g. a
`@morai/core/rule-tags` export or a dedicated values-only entrypoint), and/or add a
`no-restricted-imports` rule under `files: ["packages/contracts/**"]` that blocks
`@morai/core` deep paths outside the rule-tags module. This makes "values only" mechanical, not
comment-enforced.

### WR-04: Untested business logic embedded in the composition root

**File:** `apps/server/src/main.ts:369-406`

**Issue:** `main.ts:1-6` declares *"No business logic in this file; only composition"* and
`architecture-boundaries.md §3` requires adapters/roots to hold no business logic. Yet
`onSpotObserved` embeds a real decision pipeline: RTH+holiday gate → rolling-window move
detection → mutable `moveWindow` state → cross-process cooldown read → conditional enqueue. As a
composition-root function it is TDD-exempt and has **no test**, so the highest-risk glue in
SNAP-01 (the observe→detect→cooldown→enqueue orchestration) is entirely unverified — which is
also how CR-01 slipped through. The individual pure pieces are tested; the orchestration is not.

**Fix:** Extract the orchestration into a testable unit — e.g. a `makeSpotObserver({ detect,
readLatestSnapshotTime, enqueue, isWithinRth, isNyseHoliday, now })` factory in an adapter/use-case
module — and cover the branches (off-hours no-op, sub-threshold no-op, cooldown suppression,
single-enqueue-per-move, bad-timestamp no-op). `main.ts` then only wires it.

### WR-05: `reconnectNow` can race an in-flight backoff reconnect and open a second EventSource

**File:** `apps/web/src/hooks/useLiveStream.ts:289-309` (with `scheduleReconnect` 143-150)

**Issue:** `reconnectInFlightRef` guards only re-entrant `reconnectNow` calls; it does not guard
against a `scheduleReconnect` timer whose `connect()` has already fired and is mid-`await` (ticket
mint). Sequence: `es.onerror` → `scheduleReconnect` sets the timer → timer fires
(`reconnectTimerRef = undefined`) → `connect()` awaits the mint; the user then clicks
"Reconnect now" (STALLED state). `reconnectNow` sees `reconnectTimerRef === undefined` (nothing to
cancel) and starts a **second** concurrent `connect()`. Both create an `EventSource`; the second
overwrites `esRef`, leaking the first live connection (its `onerror` will later close itself and
schedule yet another reconnect). Result: a transient double-connection / redundant reconnect. Narrow
window, but it lands exactly in the STALLED-with-dead-transport case where `reconnectNow` exists.

**Fix:** Gate `connect()` on a single in-flight guard shared by both paths (set a
`connectInFlightRef` at the top of `connect()` and bail if already set; clear in a `finally`), so
a manual reconnect and a timer-driven reconnect cannot both be in flight.

## Info

### IN-01: Orphan-annotation branch is unreachable under the current adapters

**File:** `packages/core/src/journal/application/getCalendarEventsWithRules.ts:52-62`

**Issue:** The use-case calls `readAnnotationsByHashes(eventHashes)` and then filters returned
annotations with `if (!eventHashSet.has(annotation.fillIdsHash))`, where `eventHashSet` is the
same `eventHashes`. Both adapters (Postgres `inArray`, memory `wanted` set) return only rows whose
hash is in the passed set, so the condition is always false — the `console.warn` orphan branch is
dead code today. The comment claims it is defense-in-depth against a looser future adapter; that
is defensible, but as written it is unreachable and untestable via the real ports.

**Fix:** Either drop the branch (the port contract already guarantees the filter) or add a fake
adapter in the test that returns an out-of-set hash so the branch is actually exercised.

### IN-02: Rule tags are not de-duplicated

**File:** `packages/contracts/src/journal-rules.ts:34`, `packages/core/src/journal/application/setRuleTags.ts:65-72`

**Issue:** `tags: z.array(ruleTag).max(5)` and the use-case's per-tag membership check both
accept duplicates, so `["profit-target","profit-target"]` validates and is written verbatim to
`rule_tags text[]`. Not a security or correctness bug, but it lets low-quality duplicated arrays
persist.

**Fix:** Consider a `.transform((t) => [...new Set(t)])` on the tags array (or dedupe in the
use-case before `writeAnnotations`).

---

_Reviewed: 2026-07-05T14:04:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
