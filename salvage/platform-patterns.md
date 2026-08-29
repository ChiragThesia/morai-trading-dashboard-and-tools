# Platform patterns worth keeping — apps/server, apps/worker

Salvaged before the driving-adapter code (`apps/server/`, `apps/worker/`) is deleted and
rebuilt. This is not a structure to copy — the classes, DI wiring, and file layout are
gone on purpose. What follows are the six mechanisms with real reasoning or real
production damage behind them. Everything else in these two apps is boilerplate the
rebuild can reinvent in five minutes.

---

## 1. Auth: opaque tickets for SSE, JWKS for everything else

### Ticket-gated SSE (no JWT in the URL)

`EventSource` cannot send an `Authorization` header, so a query-param JWT is the naive
fix — and it's the wrong one: it leaks into access logs and browser history. The fix
used here is a **second, narrower credential** minted from the real one.

Flow, from `apps/server/src/adapters/http/stream.routes.ts` and
`apps/server/src/adapters/http/ticket-store.ts`:

1. Client already holds a Supabase JWT. It calls `POST /api/stream/ticket` (inside the
   JWT-gated route group) with `Authorization: Bearer <jwt>`.
2. The handler reads `jwtPayload.sub` (the userId) and calls `mintTicket(userId)`, which
   does `crypto.randomUUID()` and stores `{ userId, exp: now()+30_000, used: false }` in
   an in-memory `Map<string, TicketRecord>`. Returns just `{ ticket }`.
3. Client opens `GET /api/stream?ticket=<uuid>` — an `EventSource`, no headers needed.
   This route is mounted **outside** the JWT group.
4. `redeemTicket(ticket)` looks up the record: unknown ticket → null; `used === true` →
   null (replay blocked); `now() > exp` → null (30s TTL expired). On success it sets
   `used = true` then deletes the record — single-use even if somehow raced, because JS
   is single-threaded and the flag flips before the delete.

The record type is deliberately minimal: `{ userId, exp, used }` — **no JWT, no secret,
no claim is ever stored in the ticket table**. The ticket string itself is just a random
UUID; if it leaked into a log, it's a dead 30-second single-use token bound to nothing
an attacker can extract. Comment from the source: *"The TicketRecord holds ONLY
{userId, exp, used} — NO JWT, secret, or extractable claim."*

The store is intentionally in-memory (no Postgres/Drizzle import) — the code notes this
only works because it assumes a single server instance. That constraint carries forward:
multi-instance would need a shared ticket store (Redis, or a signed-and-short-lived
alternative) before this pattern still holds.

Route-mounting is the fragile part reimplementers will get wrong: `POST /stream/ticket`
and `POST /stream/subscribe` must be **inside** the JWT-verifying route group;
`GET /stream` must be **outside** it (ticket auth only) — and Hono's first-match-wins
routing means if you mount the full route factory outside the group, the POST routes
silently 401 for everyone because they never see the JWT middleware. The source works
around this by exporting two separate factories (`streamRoutes` for the two inside
routes, `makeStreamSseRouter` for the outside GET) that both delegate to one shared
handler function, so the SSE logic itself can't drift between the two mounts.

### Asymmetric JWKS verification, not a shared secret

`apps/server/src/adapters/http/supabase-auth.ts`: verifies Supabase user access tokens
with `jose`'s `jwtVerify(token, getKey, { audience: "authenticated" })`, where `getKey`
is a `JWTVerifyGetKey` — in production `createRemoteJWKSet(supabaseJwksUrl)` pointed at
`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`; in tests, `createLocalJWKSet` over a
fixture keyset. Algorithm is ES256.

Why this over a shared HS256 secret: with HS256 the server needs the *same* secret
Supabase used to sign the token — a shared secret that must be distributed, rotated in
lockstep, and if it ever leaks, forges auth for the whole system. With JWKS/ES256 the
server only ever holds Supabase's **public** key, fetched live from a well-known
endpoint; nothing secret is deployed to this codebase's config at all, and Supabase can
rotate its signing key without the server's involvement. The injectable `getKey` is what
makes this testable — offline in tests, live in prod, same code path.

---

## 2. SSE fan-out and the unresolved watchdog gap

Two SSE layers exist, and they should not be confused:

- **Upstream consumer** (`apps/server/src/adapters/http/sidecar-sse.ts`):
  `connectToSidecarStream` fetches `GET {sidecarUrl}/sidecar/events`, reads the response
  body as a raw stream, splits on the SSE frame delimiter (`\n\n`), extracts the
  `data: ` line, `JSON.parse`s it, and routes it through Zod (`sidecarIndicesSchema`
  checked *before* `sidecarTickSchema` — order matters, the tick schema would silently
  reject and drop an indices frame if checked first). Valid ticks flow through an
  injected `recompute` (BSM) and then `bufferTick`; malformed/ping/unmatched frames are
  dropped silently, never thrown.

- **Downstream fan-out** (`apps/server/src/adapters/http/stream-fan-out.ts`): a module-
  level `Set<SSEClient>` plus a per-symbol coalescing `Map`. `bufferTick` overwrites any
  prior tick for the same OCC symbol (latest-wins); a `setInterval` every **1000ms**
  (`startFlushInterval`) drains the buffer to every client as one `"ticks"` event —
  bounding update rate to at most 1/sec per symbol regardless of upstream tick rate.
  Two sibling lanes (`spot`, `indices`) use the same latest-wins staging but add an
  **on-change skip**: if the new value equals the last one actually sent, nothing is
  written. The spot lane's equality check has an explicit `ponytail:` comment: *"value-
  equality skip, no epsilon — Schwab spot is already conflated ~1/sec"* — i.e. don't add
  a fuzzy-equals here, the upstream data is already coarse enough that exact equality is
  the right filter.

  Dead-client cleanup happens on two independent paths so a closed browser tab can never
  leak forever: (1) if `client.aborted` is true when the flush loop reaches it, it's
  deleted before any write is attempted; (2) if `writeSSE()` itself rejects, the
  `.catch()` deletes it. The route handler adds a third, `stream.onAbort(() =>
  unregisterClient(...))`, for the clean-disconnect case.

**Reconnect on upstream disconnect**: `connectToSidecarStream` throws on non-200/no-body
and simply *resolves* when the stream ends (reader hits `done: true`) — it does not loop
on its own. `runSidecarStreamWithReconnect` is the wrapper that does: catches every
outcome (throw or clean resolve) and reconnects after a **2000ms** default backoff,
forever, never itself throwing. The comment names exactly the bug this replaced: *"A bare
`void connectToSidecarStream(...)` therefore dies permanently on the first disconnect —
live greeks AND event-snapshot detection stop until the process restarts."* Backoff is
injectable (`sleep`, `shouldContinue`) purely so it's testable without real timers.

**Keep-alive**: the client-facing `GET /api/stream` handler sends a `ping` event
immediately after the initial `reconcile` event (so the browser's `isRth` flag is never
stale for the first 30 seconds), then loops `stream.sleep(30_000)` → ping → repeat until
`stream.aborted`. This also exists to stop Railway/nginx from killing an idle connection.

**The watchdog gap named in project history was never closed.** Phase 12's memory note
records it explicitly as an open gap: *"reusable SSE-offline test harness; open gap: no
silent-stall watchdog."* Grepping the entire TypeScript tree for `watchdog` at time of
writing returns zero matches. Concretely: `connectToSidecarStream`'s `while(true)` loop
only notices trouble when `reader.read()` either throws or returns `done: true` — a
sidecar that keeps the TCP connection open but stops sending frames (a silent stall, not
a disconnect) is invisible to this code forever. There is no idle timer that would
detect "no frame in N seconds" and force a reconnect. If the rebuild wants this closed,
it needs a fresh timer reset on every received frame (tick, indices, or otherwise) that
aborts and reconnects the stream if it fires — nothing like that exists to copy from.

---

## 3. pg-boss operational patterns

### Chain-triggered vs. scheduled jobs

Most of the 20 queues in `apps/worker/src/schedule.ts` are cron-scheduled with
`boss.schedule(name, cronExpr, null, { tz: "America/New_York", key? })`. But five are
deliberately **never scheduled** — they only run when the previous stage in the pipeline
succeeds and enqueues them:

```
fetch-schwab-chain → compute-bsm-greeks → snapshot-calendars → compute-analytics
                                                              → compute-gex-snapshot
                                                              → compute-picker
                                                              → compute-exit-advice
```

Each handler follows the identical shape (e.g.
`apps/worker/src/handlers/compute-bsm-greeks.ts`): run the use-case; on failure `throw`
(pg-boss marks the job failed for retry); on success, fire-and-forget
`void deps.boss.send(nextQueueName, {}, { singletonKey: "triggered-by-X" }).catch(e =>
console.warn(...))` — a failed enqueue of the *next* stage does **not** fail the
*current* job. Every chain link uses a distinct `singletonKey` string so pg-boss
collapses duplicate enqueues within its dedup window (v12's default: same name+key can't
be enqueued twice while a prior instance is still pending).

One queue is the deliberate exception that proves the rule:
`persist-calendar-ranking` is cron-only (`"25,55 * * * *"`, 25 minutes after each
half-hourly chain fetch), explicitly **not** chain-triggered off the same pipeline
`compute-picker` rides. The comment explains why with a measured number: a chain-trigger
would fire the instant a new cohort's first leg solves, while `compute-bsm-greeks` is
still draining the rest of that cohort — and because the ranking write is first-write-
wins, a starved partial cohort would become the permanent record for that cycle.
*"Measured 2026-07-28: the 18:00:22Z cohort carried 853 unsolved put legs at 18:05Z and 0
by 18:14Z."* The 25/55-minute offset is chosen to sit ~25 minutes behind the half-hourly
fetch and 5 minutes ahead of the next one — enough drain time, verified against that
measurement.

`createQueue` calls for all queues must complete before any `schedule`/`work` calls — a
pg-boss v12 foreign-key constraint on the schedule table (referred to in comments as
"CR-01"). The registration function does all `createQueue`s in phase 1, all `schedule`s
in phase 2, all `work`s in phase 3, in that order.

**A duplicate-schedule trap the code hit in production**: pg-boss v12 upserts schedules
on `(name, key)`, with `key` defaulting to `''`. The `fetch-rates` queue is scheduled
twice a day (09:00 ET morning, 18:30 ET evening) on the *same* queue name — the second
`schedule()` call with no distinct key would silently overwrite the first, so only the
evening run would ever fire. The fix: pass `key: "morning"` / `key: "evening"`. The
comment also flags an unresolved production cleanup: the pre-fix keyless row (`key: ''`)
is never deleted by this code and keeps firing at whatever cron it last held —
`DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';` was the manual
fix, never automated.

### Error listeners — the 81-minute incident

`apps/worker/src/main.ts` and `apps/server/src/main.ts` both carry this comment
verbatim: *"In Node an 'error' event with no listener is rethrown as an uncaught
exception, which is precisely what killed this worker on 07-23."* On 2026-07-23,
Supabase was unreachable and the worker process died with no error logging at all,
because pg-boss's `PgBoss` instance emits `'error'` on runtime failures and nothing was
listening — the outage lasted **81 minutes**. Both `main.ts` files now register:

```
boss.on("error", (error) => {
  console.error("worker: pg-boss error (non-fatal, pg-boss will recover)", error);
});
```

placed **before** `boss.start()`. The listener never exits the process — pg-boss
recovers connection errors on its own — it exists purely so Node doesn't escalate the
event to an uncaught exception. This one line is the entire fix for that failure mode;
its absence is what caused the incident.

### Handler idempotency

Every handler in the pipeline is written so that pg-boss's at-least-once delivery and
the chain-trigger's own retries cost nothing on a re-run:

- `fetch-schwab-chain` / `fetch-cboe-chain`: writes land on a `(time, contract)` primary
  key — re-fetches are idempotent no-ops.
- `compute-gex-snapshot`: `onConflictDoNothing` on the `cycle_time` primary key.
- `fetch-cot`: `ON CONFLICT (contract_code, as_of) DO NOTHING`.
- `fetch-news`: `ON CONFLICT (id) DO UPDATE` (refresh, not duplicate).
- `wipe-derived-fills` / re-derived fills: `onConflictDoNothing` on the fill id PK.
- `compute-picker`: first-write-wins on the cohort's `observedAt` — deliberately *not*
  upsert-and-overwrite, because a later, staler write should never clobber an earlier
  complete one (this is exactly the failure mode `persist-calendar-ranking`'s cron-only
  design above is protecting against on the ranking side too).

None of the 24/7 compute jobs (`compute-bsm-greeks`, `compute-analytics`,
`compute-gex-snapshot`) gate on regular trading hours anymore — the code notes the RTH
gate was retired from these stages specifically *because* the writes are idempotent, so
an off-hours or holiday re-run on a frozen cohort is a safe no-op; the only place an RTH
gate still matters is inside `snapshot-calendars`, which is the one stage that writes to
the user-facing journal.

---

## 4. Process-level resilience

Both `apps/server/src/main.ts` and `apps/worker/src/main.ts` open with the same
three-class response, written directly against the 2026-07-23 outage:

**Class 3 — uncaught exception / unhandled rejection.** Installed at the very top of
`main.ts`, before anything else runs:

```
process.on("uncaughtException", (error) => {
  console.error("...: uncaught exception — exiting for a clean restart", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("...: unhandled rejection — exiting for a clean restart", reason);
  process.exit(1);
});
```

Rationale in the comment: after an uncaught exception the process state is undefined, so
continuing risks writing corrupt journal data — better to log the cause (there was
*none* before) and exit non-zero so Railway restarts clean, than limp on half-alive.

**Class 1 — boot-time I/O that can't succeed yet.** A shared `retryWithBackoff` (from
`@morai/shared`) wraps the one or two operations that must succeed before the process is
useful: `runMigrations` and `boss.start()` in the worker; `jobBoss.start()` in the
server (the server runs no migrations of its own). Retry config, used identically in
both apps:

```
const BOOT_RETRY = { attempts: 10, baseDelayMs: 1_000, maxDelayMs: 30_000 };
```

The comment frames the intent precisely: *"~4 minutes of in-process patience; past that
we exit and let Railway restart, which retries again — so an outage of any length is
ridden out without hot-looping."* In other words the 10-attempt exponential backoff
inside the process is not meant to survive an arbitrarily long outage by itself — it's
meant to absorb short blips without paying a full container restart, while the outer
Railway restart loop is what actually rides out a long one.

**Class 2 — pg-boss runtime errors.** Covered above (§3) — the `boss.on("error", ...)`
listener, present in both apps, non-fatal, exists solely to prevent Node's default
escalate-to-uncaught-exception behavior for an unlistened `'error'` event.

**Graceful shutdown**: there isn't one, and it's not an oversight — it's a stated
assumption. `apps/server/src/main.ts` says outright, next to the flush-interval start:
*"runs indefinitely; no cleanup needed (Railway SIGTERM kills the process)."* Neither
`main.ts` registers a `SIGTERM`/`SIGINT` handler, and there is no `boss.stop()` call
anywhere in either app. If the rebuild wants in-flight jobs to drain before a deploy
kills the process, that's new work, not something to carry forward — the existing code
relies entirely on Railway's hard kill plus pg-boss's own crash-recovery (`maintenance`
job that reclaims jobs stuck `active` past their expiration) to make that safe.

---

## 5. The one contracts pattern worth keeping

`packages/contracts` is being rewritten (hand-mirrored Zod shapes with no import path
back to `packages/core`, so the schema and the core return type are two independently
maintained shapes with zero structural connection between them). One narrow pattern
inside `apps/server` restores a compile-time link across that gap, and it's worth
reapplying verbatim in the rebuild.

`apps/server/src/adapters/calendar-rank-dto.ts`:

```ts
export function toRankedCalendarBody(ranking: CalendarRanking): RankedCalendarResponse {
  const body: RankedCalendarResponse = {
    ...ranking,
    asOf: ranking.asOf.toISOString(),
    candidates: [...ranking.candidates],
  };
  return rankedCalendarResponse.parse(body);
}
```

The load-bearing part is the `: RankedCalendarResponse` type annotation on `body` — a
type imported from the contracts package, applied to a value built from the *core*
domain type (`CalendarRanking`). Without that annotation, `body` would just be `unknown`
until `.parse()` runs, and `.parse()` type-checks fine no matter how far the two shapes
have drifted — the mismatch would only surface as a runtime `ZodError` on the first real
request. With the annotation, TypeScript checks the object literal against the
contract's inferred type at the assignment itself: drop a field the engine no longer
produces, or change its nullability, and `tsc` fails **at that line**, in CI, before
deploy.

The source's own doc (`docs/learnings/LAWS.md`, L059) records the proof: a wrong field
was deliberately injected to verify the guard has teeth, and `bun run typecheck` failed
with **TS2741** at the annotated line — exactly the failure mode this pattern exists to
convert from a first-request 500 into a build failure. The same doc also records the
counterfactual: *"Four other core-type/contract pairs in the same repo carry no such
annotation — for those, adding a field is a four-file edit guarded only by a runtime
parse."* — i.e. this is not automatic, it has to be applied deliberately at every
adapter seam that maps a core type onto a hand-mirrored contract type, or the same class
of drift reopens.

Concrete rule for the rebuild: **every function that maps a core/domain type onto a
contracts-package response type should declare its return variable's type as the
contracts type before calling `.parse()` on it** — not just return the parse result
untyped.

---

## 6. MCP server: tool shape (forward-looking)

`apps/server/src/adapters/mcp/server.ts` mounts one Hono router at `/mcp`, gated by a
pre-shared bearer token (`apps/server/src/adapters/mcp/bearer.ts` — exact string
comparison against `Bearer {token}`, 401 on mismatch or absence, token value itself never
logged). Uses `@modelcontextprotocol/sdk`'s `McpServer` +
`WebStandardStreamableHTTPServerTransport` (the native-Fetch-API transport, no
node-bridge needed since Bun/Hono are already web-standard). Both `POST /mcp` and
`GET /mcp` build a **fresh** `McpServer` + transport per request — explicitly stateless,
no `sessionIdGenerator` — and register every tool the caller injected before calling
`transport.handleRequest(c.req.raw)`. One documented gotcha: the handler must **not**
close or await-drain synchronously after `handleRequest` — the SDK returns a `Response`
wrapping an open SSE stream still being written asynchronously; closing early yields an
empty response the client sees as "failed to connect."

Every tool is registered by its own small `registerXTool(server, useCase)` function
(`apps/server/src/adapters/mcp/tools.ts`, ~30 tools, 1574 lines total — but each function
is the same handful of lines). The shape every one of them follows:

```ts
server.registerTool(
  "get_journal",
  {
    title: "Get Journal",
    description: "Returns ... Same payload as GET /api/journal/:calendarId.",
    inputSchema: { calendarId: z.string().uuid() },   // raw Zod shape, not z.object()
  },
  async (args) => {
    const parsed = z.object({ calendarId: z.string().uuid() }).safeParse(args);
    if (!parsed.success) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "..." }) }] };
    }
    const result = await getJournal(parsed.data.calendarId);
    // ... map result to the SAME contracts schema the HTTP route uses ...
    const payload = journalResponse.parse({ ...serialize dates to ISO... });
    return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
  },
);
```

Points worth carrying into a rebuilt MCP surface:

- **`inputSchema` is a raw Zod shape** (`{ calendarId: z.string().uuid() }`), not a
  `z.object(...)` — the SDK's own type (`ZodRawShapeCompat`) wants
  `Record<string, AnySchema>`. An empty-params tool passes `inputSchema: {}`.
- **Every handler re-`safeParse`s `args` at the top of the callback**, even though the
  SDK's own schema validation runs first — belt-and-suspenders because the callback is
  reachable from other code paths too, and the rule here is a tool handler must never
  `throw` on bad input, only return an error-shaped `content` payload.
- **The response payload is always the same Zod contract schema the sibling HTTP route
  parses through** (`journalResponse`, `gexSnapshotResponse`, `rankedCalendarResponse`,
  etc.) — the comment convention calls this "MCP-02: same contract as GET
  /api/whatever," and the reasoning is explicit: a one-sided field rename on either side
  fails `tsc` because both adapters import the same inferred type, instead of the two
  surfaces silently returning different shapes for the same logical resource.
- **Tools that depend on an optionally-wired use-case are registered conditionally**
  (`if (getGex !== undefined) registerGetGexTool(server, getGex)`) inside the per-request
  `makeServerAndTransport()` closure — every tool the router was constructed with gets
  attached fresh on every request, since the transport itself is stateless.
- **Multi-step validation defers the second Zod schema until the first field is known**:
  `trigger_job`'s handler validates `name` against `z.enum(TRIGGERABLE_JOBS)` first, then
  picks a *per-job* body schema (`triggerJobBodyFor(name)`) — e.g. `rebuild-journal`
  requires `calendarId`, others don't — and only calls the use-case if both parses
  succeed. This mirrors the HTTP route's `POST /jobs/:name/trigger` byte-for-byte via a
  shared `triggerJobBodyFor` helper, so the two adapters can't drift on which jobs
  require which fields.
- **Every payload is `content: [{ type: "text" as const, text: JSON.stringify(...) }]`**
  — the MCP text-content convention. No other content type appears anywhere in this
  codebase's tools.

---

## Unjustified constants found

Two numeric literals in `apps/server/src/main.ts`, wiring the sidecar SSE consumer, carry
no measurement — only a `ponytail:` shortcut comment naming them as proxies:

```ts
riskFreeRate: 0.045, // ponytail: SOFR proxy; add config field if FRED integration added
dividendYield: 0.013, // ponytail: SPX 12m trailing yield proxy
```

Both are explicitly flagged by the original author as stand-ins, not measured constants
— free to change, and arguably should become config-driven (the comment says as much)
rather than hardcoded, in the rebuild.
