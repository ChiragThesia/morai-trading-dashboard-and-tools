# Phase 20: Stream Watchdog, Event Snapshot & Strategy Rules - Pattern Map

**Mapped:** 2026-07-05
**Files analyzed:** 20 (new + modified)
**Analogs found:** 20 / 20

Ground truth for this map is RESEARCH.md's already-verified attach points (line numbers,
excerpts read directly from this repo). This file re-verifies the highest-leverage analogs
against actual source and adds copy-paste-ready excerpts for the planner.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/src/lib/deriveStreamStatus.ts` (new) | utility (pure fn) | transform | `packages/core/src/journal/domain/rth-window.ts` (`isWithinRth`) — pure predicate shape | role-match (cross-package, same purity idiom) |
| `packages/contracts/src/stream-events.ts` (modify: add `streamPingEvent`) | config/contract | request-response | existing schemas in same file (`streamLiveGreekEvent`, `streamReconcileEvent`) | exact |
| `apps/web/src/hooks/useLiveStream.ts` (modify) | hook | streaming (SSE) | itself — extend `es.addEventListener("ticks"/"reconcile")` pattern with a new `"ping"` listener + elapsed-time interval | exact (self-analog) |
| `apps/web/src/components/LiveStatusBadge.tsx` (modify: 4→3 state) | component | request-response (presentational) | itself — extend `STATUS_CONFIG` map | exact (self-analog) |
| `apps/server/src/adapters/http/stream.routes.ts` (modify: ping payload x2) | route (SSE emitter) | streaming | itself — two existing `writeSSE({event:"ping", data:""})` call sites | exact (self-analog) |
| `packages/core/src/streaming/domain/spot-move-detector.ts` (new) | model/domain (pure) | transform | `packages/core/src/journal/domain/rth-window.ts` (pure, no I/O, `Date` passed in not read) | role-match |
| `packages/core/src/journal/domain/snapshot-cooldown.ts` (new) | model/domain (pure) | transform | `packages/core/src/journal/domain/dedupe-key.ts` (`scheduledDedupeKey` — time-windowed pure fn) | exact |
| `packages/core/src/journal/domain/rule-tags.ts` (new) | model/domain (Zod enums) | validation | `packages/core/src/journal/domain/calendar-event.ts` (Zod-boundary domain type) | exact |
| `packages/core/src/journal/application/ports.ts` (modify: add `ForReadingLatestSnapshotTime`) | port (interface) | CRUD | existing `ForReadingCalendarEvents` / `ForRunningRegisterCalendar` style ports in same file | exact |
| `packages/core/src/journal/application/getCalendarEventsWithRules.ts` (new) | service (use-case) | CRUD (read) | `packages/core/src/journal/application/snapshotCalendars.ts` (thin use-case over ports, `Result`-returning) | role-match |
| `packages/core/src/journal/application/setRuleTags.ts` (new) | service (use-case) | CRUD (write) | `packages/core/src/journal/application/rebuildJournal.ts` / `syncFills.ts` (write use-case pattern) | role-match |
| `packages/adapters/src/postgres/schema.ts` (modify: +trigger col, +`calendarEventAnnotations` table) | model (Drizzle schema) | CRUD | itself — existing `calendarSnapshots`/`calendarEvents` table defs (~lines 72, 266) | exact |
| `packages/adapters/src/postgres/repos/calendar-snapshots.ts` (modify) | model (repo) | CRUD | itself — existing `persistSnapshot` mapping | exact |
| `packages/adapters/src/postgres/repos/calendar-event-annotations.ts` (new) | model (repo) | CRUD | `packages/adapters/src/postgres/repos/calendar-events.ts` (`storeCalendarEvent`, `onConflictDoNothing` pattern) | exact |
| `packages/adapters/src/memory/calendar-event-annotations.ts` (new) | model (memory twin) | CRUD | `packages/adapters/src/memory/calendar-events.ts` (existing twin for the read port) | exact |
| `packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` (new) | test (contract parity) | CRUD | `packages/adapters/src/__contract__/calendar-events.contract.ts` (memory-vs-Postgres parity harness) | exact |
| `apps/server/src/adapters/http/journal-rules.routes.ts` (new) | route (controller) | CRUD (request-response) | `apps/server/src/adapters/http/calendar.routes.ts` (Hono router factory, Zod-validate → use-case → map Result → respond) | exact |
| `apps/server/src/adapters/mcp/tools.ts` (modify: +`get_rule_tags`/`set_rule_tags`) | controller (MCP tool) | request-response | itself — existing `registerListCalendarsTool`/`registerGetJournalTool` (`server.registerTool(...)` pattern) | exact |
| `apps/server/src/adapters/http/sidecar-sse.ts` (modify: `observeSpot` hook in `dispatchFrame`) | controller (SSE ingest) | event-driven | itself — existing `recomputeLiveGreek` call site right after Zod parse | exact (self-analog) |
| `apps/server/src/main.ts` (modify: wire `observeSpot` → `detectLargeMove` → cooldown → `jobBoss.send`) | config (composition root) | event-driven | itself — existing `jobBoss` instantiation (~line 216) + `pgBossJobQueue` wiring | exact (self-analog) |
| `apps/worker/src/handlers/snapshot-calendars.ts` (modify: accept/persist `trigger` reason) | job handler | batch/event-driven | itself — existing `boss.send("compute-analytics", {}, {singletonKey:...})` fire-and-forget pattern | exact (self-analog) |

## Pattern Assignments

### `apps/web/src/lib/deriveStreamStatus.ts` (utility, transform)

**Analog:** `packages/core/src/journal/domain/rth-window.ts` (`isWithinRth`) — same idiom:
pure function, no `Date.now()` inside, caller passes `now`, single clear return, no I/O.

**Core pattern (from RESEARCH, already grounded against `useLiveStream.ts` + `LiveStatusBadge.tsx`):**
```typescript
export type DerivedStatus = "live" | "quiet" | "connecting" | "stalled";

export function deriveStreamStatus(input: {
  readonly hasReceivedFirstTick: boolean;
  readonly msSinceLastTickOrConnect: number;
  readonly isRth: boolean | null; // null = no ping received yet
  readonly stallThresholdMs: number; // ~20_000, tunable
}): DerivedStatus {
  if (input.isRth === false) return "quiet";
  if (input.isRth === null) return "connecting";
  if (input.msSinceLastTickOrConnect < input.stallThresholdMs) {
    return input.hasReceivedFirstTick ? "live" : "connecting";
  }
  return "stalled";
}
```
No imports needed — framework-free, keep it in `apps/web/src/lib` (not `hooks/`) so it is
unit-testable without React (`tdd.md` requires RED test first: `deriveStreamStatus.test.ts`).

---

### `apps/web/src/hooks/useLiveStream.ts` (hook, streaming) — modify in place

**Existing pattern verified directly** (lines 140-209):
```typescript
// es.onopen / es.onerror — transport lifecycle, must NOT set red/alarm state directly
es.onerror = (): void => {
  hasEverDisconnectedRef.current = true;
  setStatus("stale");           // Pitfall 1: this direct-set pattern must NOT be reused for "stalled"
  es.close();
  if (esRef.current === es) esRef.current = null;
  scheduleReconnect();
};

// Named SSE events use addEventListener, never onmessage:
es.addEventListener("ticks", (event: Event): void => {
  if (!(event instanceof MessageEvent)) return;
  let raw: unknown;
  try { raw = JSON.parse(event.data); } catch { return; }
  const parsed = streamLiveGreekEvent.array().safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) return;
  // ...
  setStatus("live");
  setLastTickAt(new Date());
});
```
**What to copy for WATCH-01:** add a new `es.addEventListener("ping", ...)` following the exact
same try/JSON.parse/safeParse/drop-on-failure shape as `"ticks"`/`"reconcile"` above, storing
`isRth` in state. Then add a `setInterval` (1-5s) that calls `deriveStreamStatus` with
`(hasReceivedFirstTick, Date.now() - lastTickOrConnectAt, isRth, 20_000)` — this is the "shared
timer" from RESEARCH Pattern 1. Critically, `es.onerror` must stop touching status directly
(Pitfall 1) — only clear the "connected" flag; the interval derives the displayed state.

**Ignored `ping` comment (line 171) to replace:**
```typescript
//   event:"ping"      → keep-alive (ignored)
```

---

### `apps/web/src/components/LiveStatusBadge.tsx` (component, presentational) — modify in place

**Existing pattern verified directly (full file read):** pure presentational component, no
hooks, `STATUS_CONFIG` record keyed by status literal, `as const satisfies Record<LiveStreamStatus, StatusConfig>` for exhaustiveness (matches `typescript.md`'s `switch-exhaustiveness-check`
spirit), `Badge`/`Tooltip` from `@/components/ui`.

```typescript
const STATUS_CONFIG = {
  live: { label: "LIVE", textColor: "#26a69a", background: "transparent", showDot: true },
  stale: { label: "STALE", textColor: "#f0b429", background: "#161d2b", showDot: false },
  reconnecting: { label: "RECONNECTING", textColor: "#7b8696", background: "#161d2b", showDot: false },
  poll: { label: "POLL", textColor: "#566273", background: "transparent", showDot: false },
} as const satisfies Record<LiveStreamStatus, StatusConfig>;
```

**What to copy:** same `Record<..., StatusConfig> as const satisfies` shape, replacing the 4
keys with `live | quiet | connecting | stalled` per `20-UI-SPEC.md`'s locked tokens (STALLED =
`--color-down`/`--color-downd` alarm tone, never amber — this retires the `stale`/amber entry
entirely). Keep the `formatTime`/tooltip helper structure unchanged. Add the D-17
force-reconnect action using the Phase-21 `Button` primitive (`apps/web/src/components/system/Button.tsx`) inside the STALLED tooltip/action slot — new import, first use of `Button` in this file.

---

### `apps/server/src/adapters/http/stream.routes.ts` (route, streaming) — modify in place

Both duplicated ping-emit call sites (per file's own "kept in sync manually" comment) change
from `data: ""` to the new Zod-validated payload:
```typescript
await stream.writeSSE({
  event: "ping",
  data: JSON.stringify(streamPingEvent.parse({
    isRth: isWithinRth(new Date()) && !isNyseHoliday(new Date()),
  })),
});
```
`isWithinRth`/`isNyseHoliday` are already exported from `@morai/core` — same import path
already used by `apps/worker/src/handlers/snapshot-calendars.ts`'s gate. Reuse verbatim, do not
write a second RTH check (Don't-Hand-Roll #1).

---

### `packages/core/src/streaming/domain/spot-move-detector.ts` (domain, pure) — new

**Analog:** `packages/core/src/journal/domain/rth-window.ts` — pure, framework-free, `now`
passed by caller, single exported function, no `packages/shared` import beyond `Result` if
needed (this one returns a plain object, no `Result` needed — no I/O, cannot fail).

```typescript
export type SpotSample = { readonly ts: number; readonly price: number };

/** Pure ring-buffer prune + threshold check. No I/O, no Date.now() (caller passes nowMs). */
export function detectLargeMove(
  window: ReadonlyArray<SpotSample>,
  newSample: SpotSample,
  windowMs: number,
  thresholdPct: number,
): { readonly triggered: boolean; readonly nextWindow: ReadonlyArray<SpotSample> } {
  const pruned = window.filter((s) => newSample.ts - s.ts <= windowMs);
  const nextWindow = [...pruned, newSample];
  const oldest = pruned[0];
  if (oldest === undefined) return { triggered: false, nextWindow };
  const pctMove = Math.abs(newSample.price - oldest.price) / oldest.price;
  return { triggered: pctMove >= thresholdPct, nextWindow };
}
```
Tunables: `windowMs = 5 * 60_000`, `thresholdPct = 0.01` (both Claude's Discretion per
CONTEXT.md D-05). Test file: `spot-move-detector.test.ts` — fast-check property tests for
window-pruning invariant + threshold-boundary monotonicity (`tdd.md` numerical-code rule).

---

### `packages/core/src/journal/domain/snapshot-cooldown.ts` (domain, pure) — new

**Analog:** `packages/core/src/journal/domain/dedupe-key.ts` (`scheduledDedupeKey`) — same
family: a pure time-windowed boundary check, no I/O, `Date` objects passed in.

```typescript
export function isWithinCooldown(now: Date, lastSnapshotAt: Date | null, cooldownMs: number): boolean {
  if (lastSnapshotAt === null) return false;
  return now.getTime() - lastSnapshotAt.getTime() < cooldownMs;
}
```
**Important (Pitfall 2 / Don't-Hand-Roll):** this pure function alone is not sufficient — the
`lastSnapshotAt` value MUST come from a Postgres `SELECT MAX(time) FROM calendar_snapshots`
read (new `ForReadingLatestSnapshotTime` port in `packages/core/src/journal/application/ports.ts`), never an in-memory variable, because the detector (`apps/server`) and the scheduled
cadence (`apps/worker`) are separate OS processes. `cooldownMs = 15 * 60_000`.

---

### `packages/core/src/journal/domain/rule-tags.ts` (domain, Zod enums) — new

**Analog:** `packages/core/src/journal/domain/calendar-event.ts` — existing Zod-boundary
domain module (enum + type inferred via `z.infer`).

```typescript
export const enterRuleTag = z.enum([
  "iv-skew-favorable", "term-structure-edge", "event-window-play", "gex-fit", "other",
]);
export const exitRuleTag = z.enum([
  "profit-target", "max-loss", "time-stop", "thesis-invalidated", "other",
]);
export const rollRuleTag = z.enum(["defend-tested-side", "roll-for-duration", "other"]);
```
Keyed to `CalendarEvent` type per D-07 (OPEN→enter, CLOSE→exit, ROLL→roll — see
`calendar-event.ts`'s existing event-type discriminant for the switch/exhaustiveness pattern to
mirror when routing which enum applies). D-21 (OTHER requires note) is a contract-level
`.refine()`, not encoded in this file's plain enums — put the refine in the request schema in
`packages/contracts`.

---

### `packages/adapters/src/postgres/schema.ts` (model, Drizzle) — modify

**Analog:** existing `calendarEvents`/`calendars`/`calendarSnapshots` table defs in the same
file (~lines 72, 266) — same `pgTable(...).enableRLS()` shape, `varchar`/`text`/`timestamp`
column conventions.

```typescript
export const calendarEventAnnotations = pgTable("calendar_event_annotations", {
  // Soft reference to calendar_events.fill_ids_hash — deliberately NOT a foreign key
  // (rebuildJournal is delete-then-reinsert; a real FK would CASCADE-wipe or RESTRICT-break
  // the rebuild — see Pitfall 3 / D-09). Comment this in the migration too.
  fillIdsHash: varchar("fill_ids_hash", { length: 64 }).primaryKey(),
  ruleTags: text("rule_tags").array().notNull().default([]),
  otherNote: text("other_note"), // D-21 conditional-required, contract-level .refine only
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```
`calendarSnapshots` gets an additive nullable column: `trigger: text("trigger")` (values
`"scheduled" | "event-move"`, default null/`"scheduled"` at the application layer, not a DB
default — keep migration purely additive per D-12).

**Migration:** next file is `0016_*.sql` (last existing was `0015_*`, confirmed by RESEARCH).

---

### `packages/adapters/src/postgres/repos/calendar-event-annotations.ts` (repo) — new

**Analog:** `packages/adapters/src/postgres/repos/calendar-events.ts` — `storeCalendarEvent`'s
`onConflictDoNothing` idempotent-write shape is the closest precedent, though annotations need
an upsert (write-many-times, editable-anytime per D-10) rather than insert-once — use
`.onConflictDoUpdate({ target: calendarEventAnnotations.fillIdsHash, set: {...} })` instead of
`onConflictDoNothing`, same Drizzle call shape.

---

### `packages/adapters/src/__contract__/calendar-event-annotations.contract.ts` (test) — new

**Analog:** `packages/adapters/src/__contract__/calendar-events.contract.ts` — the existing
memory-twin-vs-testcontainers-Postgres parity harness. Mirror its structure exactly: same
`describe.each([["memory", memoryImpl], ["postgres", postgresImpl]])` (or equivalent) shape
running the identical assertion set against both implementations.

---

### `apps/server/src/adapters/http/journal-rules.routes.ts` (route) — new

**Analog:** `apps/server/src/adapters/http/calendar.routes.ts` (verified directly, lines 1-100)
— factory function returning a `Hono` router, `zValidator("json", <schema>)` middleware,
Zod-parsed body → build use-case input → call use-case → branch on `result.ok` → map
`result.error.kind` to HTTP status → `c.json(<contractSchema>.parse(...), <status>)`.

```typescript
export function calendarRoutes(
  registerCalendar: ForRunningRegisterCalendar,
  listCalendars: ForListingCalendars,
  closeCalendar: ForClosingCalendar,
) {
  const router = new Hono();
  router.post(
    "/calendars",
    zValidator("json", registerCalendarRequest),
    async (c) => {
      const body = c.req.valid("json");
      const result = await registerCalendar(input);
      if (!result.ok) {
        if (result.error.kind === "validation-error") {
          return c.json({ error: result.error.message }, 400);
        }
        return c.json({ error: "internal" }, 500);
      }
      return c.json(calendarResponse.parse({ ...cal, openedAt: cal.openedAt.toISOString() }), 201);
    },
  );
  router.get("/calendars", async (c) => { /* ... */ });
  return router;
}
```
**Copy exactly** for `GET /api/journal/:calendarId/rules` (list-shaped response per D-14, uses
`ForReadingCalendarEvents` + new annotations read port) and `PUT /api/journal/events/:hash/rules`
(`tags[]` + optional `otherNote`, D-21 conditional-required validated by the request Zod schema
before the route body runs). Mount inside the same `authReadGroup` JWT middleware group as
`calendar.routes.ts` (Security V4 requirement).

---

### `apps/server/src/adapters/mcp/tools.ts` (MCP tools) — modify

**Analog:** `registerListCalendarsTool` / `registerGetJournalTool` (verified directly, lines
51-140) — `server.registerTool(name, {title, description, inputSchema}, async (args) => {...})`,
`safeParse` args at the boundary (never throw on invalid input), reuse the SAME contract schema
as the HTTP route's response (MCP-02 convention), return `{content:[{type:"text", text: JSON.stringify(payload)}]}`.

```typescript
export function registerListCalendarsTool(server: McpServer, listCalendars: ForListingCalendars): void {
  server.registerTool(
    "list_calendars",
    { title: "List Calendars", description: "...", inputSchema: {} },
    async () => {
      const result = await listCalendars(undefined);
      if (!result.ok) return { content: [{ type: "text" as const, text: "internal error" }] };
      const payload = listCalendarsResponse.parse({ /* ISO-serialize Dates */ });
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
```
**Copy exactly** for `get_rule_tags` (inputSchema: `{ calendarId: z.string().uuid() }`, mirrors
`registerGetJournalTool`'s arg-parsing at line ~137-140) and `set_rule_tags` (write tool,
inputSchema includes `fillIdsHash`, `tags: z.array(...)`, optional `otherNote`).

---

### `apps/server/src/adapters/http/sidecar-sse.ts` (SSE ingest) — modify

**Analog:** itself — the existing `recomputeLiveGreek` call site immediately after
`sidecarTickSchema.safeParse` succeeds inside `dispatchFrame`.

```typescript
export type ConnectToSidecarStreamDeps = {
  // ...existing fields...
  readonly observeSpot?: (spot: number, ts: string) => void;
};

if (rawTick.underlyingPrice !== null && rawTick.underlyingPrice > 0) {
  deps.observeSpot?.(rawTick.underlyingPrice, rawTick.ts);
}
```
Add this call right after the existing Zod-parse success branch, alongside (not replacing) the
`recomputeLiveGreek` call — `observeSpot` must fire even when `recomputeLiveGreek` fails
(bad-symbol/expired), per RESEARCH.

---

### `apps/server/src/main.ts` (composition root) — modify

**Analog:** itself — existing `jobBoss` client (line 216) and its use for enqueue-only jobs.

```typescript
const jobBoss = new PgBoss({ connectionString: config.DATABASE_URL, max: 2 });
await jobBoss.start();
```
**Copy the fire-and-forget enqueue shape** (from `apps/worker/src/handlers/snapshot-calendars.ts`, see below) for the new `onSpotObserved` wiring:
```typescript
void jobBoss.send("snapshot-calendars", {}, { singletonKey: "event-move" }).catch((e: unknown) => {
  console.warn("snapshot-calendars: event-move enqueue failed", e);
});
```
Module-level mutable `moveWindow` state here follows the same pattern as `stream-fan-out.ts`'s
tick buffer (both are composition-root/adapter-level mutable state holding no business logic
themselves — the pure `detectLargeMove`/`isWithinCooldown` calls do the actual logic).

---

### `apps/worker/src/handlers/snapshot-calendars.ts` (job handler) — modify

**Analog:** itself — existing fire-and-forget `boss.send` pattern to reuse for the new
`trigger` field being persisted (thin-adapter template already used for chaining
`compute-analytics`):
```typescript
void deps.boss.send("compute-analytics", {}, {
  singletonKey: "triggered-by-snapshot",
}).catch((e: unknown) => {
  console.warn("snapshot-calendars: failed to enqueue compute-analytics", e);
});
```
No new enqueue needed here — this file only needs to accept an optional `trigger` job-payload
field and pass it through to `persistSnapshot`/the use-case so the row gets `trigger: "event-move"` vs default `"scheduled"`. RTH+holiday gate at the top of the handler is UNCHANGED
(already reused by both scheduled and event-move triggers, per D-15).

## Shared Patterns

### RTH/holiday gating
**Source:** `packages/core/src/journal/domain/rth-window.ts` (`isWithinRth`) +
`isNyseHoliday` (co-located export from `@morai/core`), already consumed by
`apps/worker/src/handlers/snapshot-calendars.ts`.
**Apply to:** `stream.routes.ts` ping payload (D-03), `main.ts`'s `onSpotObserved` gate (D-15).
Never write a second RTH check — two independent implementations WILL drift.

### Result-based error handling + Zod parse-don't-cast
**Source:** `apps/server/src/adapters/http/calendar.routes.ts` — `result.ok` branch,
`result.error.kind` switch to HTTP status, `zValidator("json", <schema>)` at every route entry.
**Apply to:** `journal-rules.routes.ts`, all new use-cases (`getCalendarEventsWithRules.ts`,
`setRuleTags.ts`), the `streamPingEvent`/rule-tag Zod schemas.

### Fire-and-forget pg-boss enqueue
**Source:** `apps/worker/src/handlers/snapshot-calendars.ts` — `void deps.boss.send(...).catch((e: unknown) => console.warn(...))`.
**Apply to:** `main.ts`'s `onSpotObserved` → `jobBoss.send("snapshot-calendars", ...)`.

### MCP tool mirrors HTTP route contract (MCP-02 convention)
**Source:** `apps/server/src/adapters/mcp/tools.ts` (`registerListCalendarsTool`,
`registerGetJournalTool`) — same Zod contract schema parsed/returned by both the HTTP route and
the MCP tool for a given use-case.
**Apply to:** `get_rule_tags`/`set_rule_tags` MCP tools sharing schemas with
`journal-rules.routes.ts` (D-13's "same PR" requirement).

### Memory-twin parity for every driven port
**Source:** `packages/adapters/src/memory/calendar-events.ts` +
`packages/adapters/src/__contract__/calendar-events.contract.ts`.
**Apply to:** new `calendar-event-annotations.ts` memory twin + contract test (RULE-01), and
`ForReadingLatestSnapshotTime`'s memory-twin implementation (SNAP-01, internal port only, no
HTTP/MCP surface per RESEARCH's architecture-boundaries note).

## No Analog Found

None — every file in scope has at least a role-match analog; most are exact matches or
self-analogs (modifying existing files following their own established internal pattern).

## Metadata

**Analog search scope:** `apps/web/src/{hooks,components,lib}`, `apps/server/src/adapters/{http,mcp}`, `apps/worker/src/handlers`, `packages/core/src/{journal,streaming}/{domain,application}`, `packages/adapters/src/{postgres/{schema,repos},memory,__contract__}`.
**Files scanned:** ~20 (all read directly this session or in RESEARCH.md's cited primary sources).
**Pattern extraction date:** 2026-07-05
