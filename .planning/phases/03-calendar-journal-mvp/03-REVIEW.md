---
phase: 03-calendar-journal-mvp
reviewed: 2026-06-14T00:00:00Z
depth: standard
files_reviewed: 57
files_reviewed_list:
  - apps/server/src/adapters/http/calendar.routes.test.ts
  - apps/server/src/adapters/http/calendar.routes.ts
  - apps/server/src/adapters/http/journal.routes.test.ts
  - apps/server/src/adapters/http/journal.routes.ts
  - apps/server/src/adapters/mcp/mcp.test.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/main.ts
  - apps/worker/src/handlers/compute-bsm-greeks.test.ts
  - apps/worker/src/handlers/compute-bsm-greeks.ts
  - apps/worker/src/handlers/fetch-cboe-chain.test.ts
  - apps/worker/src/handlers/fetch-cboe-chain.ts
  - apps/worker/src/handlers/fetch-rates.ts
  - apps/worker/src/handlers/snapshot-calendars.test.ts
  - apps/worker/src/handlers/snapshot-calendars.ts
  - apps/worker/src/main.ts
  - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
  - packages/adapters/src/__contract__/calendars.contract.ts
  - packages/adapters/src/__contract__/leg-observations.contract.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/calendar-snapshots.ts
  - packages/adapters/src/memory/calendars.ts
  - packages/adapters/src/memory/leg-observations.test.ts
  - packages/adapters/src/memory/leg-observations.ts
  - packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql
  - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts
  - packages/adapters/src/postgres/repos/calendars.contract.test.ts
  - packages/adapters/src/postgres/repos/calendars.ts
  - packages/adapters/src/postgres/repos/leg-observations.contract.test.ts
  - packages/adapters/src/postgres/repos/leg-observations.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/adapters/vitest.config.ts
  - packages/contracts/src/analytics.ts
  - packages/contracts/src/calendar.test.ts
  - packages/contracts/src/calendar.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/journal.test.ts
  - packages/contracts/src/journal.ts
  - packages/contracts/src/live-greeks.ts
  - packages/core/src/index.ts
  - packages/core/src/journal/application/closeCalendar.test.ts
  - packages/core/src/journal/application/closeCalendar.ts
  - packages/core/src/journal/application/fetchChain.test.ts
  - packages/core/src/journal/application/fetchChain.ts
  - packages/core/src/journal/application/getJournal.test.ts
  - packages/core/src/journal/application/getJournal.ts
  - packages/core/src/journal/application/getLiveGreeks.test.ts
  - packages/core/src/journal/application/getLiveGreeks.ts
  - packages/core/src/journal/application/listCalendars.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/application/registerCalendar.test.ts
  - packages/core/src/journal/application/registerCalendar.ts
  - packages/core/src/journal/application/snapshotCalendars.test.ts
  - packages/core/src/journal/application/snapshotCalendars.ts
  - packages/core/src/journal/domain/dte.test.ts
  - packages/core/src/journal/domain/dte.ts
  - packages/core/src/journal/domain/nyse-holidays.test.ts
  - packages/core/src/journal/domain/nyse-holidays.ts
findings:
  critical: 5
  warning: 7
  info: 3
  total: 15
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 57
**Status:** issues_found

## Summary

Phase 03 ships the calendar journal MVP: CRUD for calendar spreads, the snapshot pipeline
(fetch-chain → compute-bsm → snapshot-calendars), journal read endpoints, live-greeks, and
six MCP tools. The overall shape is sound — hexagonal boundaries are respected, Zod is used
at all external boundaries, and the D-06 NaN-stamp behaviour is correctly propagated through
the snapshot pipeline. However, five blockers require attention before this ships:

1. The `mapSnapshotRow` mapper uses a dead conditional that silently casts any non-`"cboe"`
   `source` to `"cboe"` rather than narrowing it.
2. `get_journal` and `get_live_greeks` MCP tools throw a Zod parse error to the MCP caller
   on bad input, violating the "analytics tools must never error" contract.
3. `snapshotCalendars` correctly computes `pnlOpen` from marks regardless of NaN, but
   **silently defaults `frontMark` / `backMark` to `0`** when a leg is entirely missing.
   This produces fabricated, non-NaN mark and pnlOpen values — economically wrong, not just
   aesthetically wrong.
4. The `readPendingObs` two-step join skips any observation whose contract is not in the
   `contracts` table (silent data loss if a race window removes the contract row).
5. `writeBsmResults` issues one `UPDATE` per row with no batching. At the BSM scale
   (thousands of pending rows), this is a correctness risk: a mid-batch DB error leaves the
   table partially written with no way to know which rows were updated.

---

## Critical Issues

### CR-01: `mapSnapshotRow` source narrowing is a no-op — always coerces to `"cboe"`

**File:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts:192`

**Issue:** The conditional `row.source === "cboe" ? "cboe" : "cboe"` is unconditional. Both
branches return `"cboe"`. If the DB schema ever stores a different `snapshot_source` enum
value (`"schwab_chain"` or `"computed_only"` — both valid per the Drizzle schema), this
mapper silently misreports the source. The type annotation `const source: "cboe"` is also an
implicit `as`-equivalent assertion that the project's no-`as` rule prohibits.

**Fix:**
```typescript
// Either fail loudly on unexpected source values:
const source = row.source;
// Or, if only "cboe" is produced by this code path, add an explicit runtime guard:
if (row.source !== "cboe") {
  // This path should not be reachable today; surface it if it is:
  return err<StorageError>({ kind: "storage-error", message: `unexpected source: ${row.source}` });
}
const source: "cboe" = row.source;
```

---

### CR-02: MCP tools `get_journal` and `get_live_greeks` throw on invalid `calendarId` input

**File:** `apps/server/src/adapters/mcp/tools.ts:121-123` and `174-176`

**Issue:** Both tools call `z.object({ calendarId: z.string().uuid() }).parse(args)` inside
the handler. If `args` does not contain a valid UUID (e.g. MCP caller sends a plain string),
`parse` **throws a ZodError**, which propagates out of the tool handler. The project convention
for MCP analytics tools is "never an error — always return typed-empty or descriptive text".
A thrown exception causes the MCP SDK to return an error response to the caller instead of
a graceful text payload. This is especially harmful for `get_live_greeks`, which the UI will
call frequently.

**Fix:** Use `z.safeParse` and return a descriptive text content on failure:
```typescript
const parsed = z.object({ calendarId: z.string().uuid() }).safeParse(args);
if (!parsed.success) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid calendarId" }) }] };
}
const { calendarId } = parsed.data;
```

---

### CR-03: Missing-leg marks silently default to `0`, producing fabricated non-NaN pnlOpen

**File:** `packages/core/src/journal/application/snapshotCalendars.ts:63-65` and `84`

**Issue:** When a leg is `null` (resolve error or `ok(null)`), `frontMark` and `backMark`
default to `0` via `front?.mark ?? 0`. The `pnlOpen` formula then computes as
`(0 - openNetDebit) * qty * 100` — a fully fabricated P&L value that appears numeric (not
NaN) in the journal. A downstream consumer (chart, alert) has no way to distinguish this
from a real zero-mark leg. D-06 specifies "marks and pnlOpen still populate", implying a
leg that was successfully fetched with mark=0 — not a leg that was never fetched. A missing
leg should NaN-stamp `netMark`, `frontMark`, `backMark`, and `pnlOpen` too, or at minimum
the snapshot should be annotated to signal mark-unavailability.

Per the domain spec (D-06): IV/greek columns get `NAN_STAMP` when a leg is null. Marks are
supposed to "still populate from whatever data exists". When there is no data (leg is null),
the mark column also has no data — writing `"0"` is not "populating from data that exists".

**Fix:** Add a `markDataAvailable` flag:
```typescript
const frontMarkAvailable = front !== null;
const backMarkAvailable = back !== null;
const frontMark = front?.mark ?? 0;
const backMark = back?.mark ?? 0;
const netMark = backMark - frontMark;

// NaN-stamp mark columns when the leg itself is missing
const frontMarkStr = frontMarkAvailable ? String(frontMark) : NAN_STAMP;
const backMarkStr  = backMarkAvailable  ? String(backMark)  : NAN_STAMP;
const netMarkStr   = (frontMarkAvailable && backMarkAvailable) ? String(netMark) : NAN_STAMP;
const pnlOpen      = (frontMarkAvailable && backMarkAvailable)
  ? String((netMark - cal.openNetDebit) * cal.qty * 100)
  : NAN_STAMP;
```

---

### CR-04: `readPendingObs` silently drops observations missing from `contracts` table

**File:** `packages/adapters/src/postgres/repos/leg-observations.ts:155-156`

**Issue:** The two-step join in `readPendingObs` fetches all pending `leg_observations`, then
fetches `contracts` for the relevant OCC symbols, and then **skips any observation row whose
contract is not in the contracts map** (`if (meta === undefined) continue`). The comment
says "shouldn't happen in practice", but there is a real race: `fetch-cboe-chain` calls
`persistObservations` and `upsertContracts` in two separate DB calls (lines 250-258 of
`fetchChain.ts`). If the worker crashes between those two calls, or if the contracts insert
fails silently (it uses `onConflictDoNothing`, which swallows errors per-row), observations
accumulate without matching contract metadata, and those rows are silently skipped forever by
the pending scan — BSM will never be computed for them.

The missing observation is also omitted from the returned `ReadonlyArray<PendingObs>` with
no log, no metric, and no error, making this invisible in production.

**Fix:** Either log a `console.warn` with the orphaned symbol for observability, or make
`readPendingObs` a single SQL join (eliminating the race):
```sql
SELECT lo.time, lo.contract, lo.mark, lo.underlying_price,
       c.root, c.contract_type, c.expiration, c.strike
FROM leg_observations lo
INNER JOIN contracts c ON c.occ_symbol = lo.contract
WHERE lo.bsm_iv IS NULL AND lo.mark IS NOT NULL
```
This collapses the two-step into one query and eliminates the orphan window entirely.

---

### CR-05: `writeBsmResults` — N individual UPDATEs, partial-write on mid-batch error

**File:** `packages/adapters/src/postgres/repos/leg-observations.ts:210-227`

**Issue:** `writeBsmResults` issues one `db.update(...).where(...)` call per row in a plain
`for` loop with no transaction. If the DB throws (network hiccup, deadlock) midway through a
batch of, say, 1,000 rows, the first 500 rows are committed and the last 500 are not. The
next invocation of `readPendingObs` will still see those 500 rows as pending (bsm_iv IS NULL)
and re-compute them — which is correct for idempotency — but the initial partial state is
observable for up to 30 minutes (the next fetch cycle), and any monitoring that checks "did
this batch fully succeed?" will receive `ok(undefined)` from the partial run because the error
occurs mid-loop and is caught per-call.

At high row counts this also generates N round-trips, which is a latency problem that
compounds the correctness risk.

**Fix:** Wrap the loop in a transaction, or use a single SQL `UPDATE ... FROM (VALUES ...)`:
```typescript
await db.transaction(async (tx) => {
  for (const write of writes) {
    await tx.update(legObservations)
      .set({ bsmIv: write.bsmIv, ... })
      .where(and(eq(legObservations.time, write.time), eq(legObservations.contract, write.contract)));
  }
});
```

---

## Warnings

### WR-01: `get_journal` tool re-parses `args` twice — double Zod parse

**File:** `apps/server/src/adapters/mcp/tools.ts:116-123`

**Issue:** The tool's `inputSchema` already declares `calendarId: z.string().uuid()`, so the
MCP SDK validates the input before calling the handler. The handler then calls
`z.object({ calendarId: z.string().uuid() }).parse(args)` again. This is redundant and adds
a second failure point with a different error surface (thrown ZodError vs. SDK validation
error). The same pattern appears in `get_live_greeks` (lines 173-175).

**Fix:** Remove the inner `z.object({...}).parse(args)` and destructure directly:
```typescript
// The SDK has already validated — args is typed by inputSchema
const { calendarId } = args as { calendarId: string };
```
Or — if the "parse don't cast" rule demands re-parsing — switch to `safeParse` (see CR-02).

---

### WR-02: `calendar.routes.ts` — `calendarId` path param not validated as UUID before use

**File:** `apps/server/src/adapters/http/calendar.routes.ts:99`

**Issue:** `POST /api/calendars/:id/close` reads `const id = c.req.param("id")` without Zod
validation. A non-UUID string reaches `closeCalendar(id, ...)`, which then reaches the
Postgres adapter, where it throws `"invalid input syntax for type uuid"` and is caught/mapped
to `not-found`. This works functionally, but it relies on an error message substring match
(`message.includes("invalid input syntax for type uuid")`) deep in the adapter — a brittle
pattern. The correct mitigation is `zValidator("param", z.object({ id: z.string().uuid() }))`
at the route layer.

**Fix:**
```typescript
router.post(
  "/calendars/:id/close",
  zValidator("param", z.object({ id: z.string().uuid() })),
  zValidator("json", closeCalendarRequest),
  async (c) => {
    const { id } = c.req.valid("param");
    ...
  },
);
```

---

### WR-03: `journal.routes.ts` — `calendarId` path param not validated as UUID before use

**File:** `apps/server/src/adapters/http/journal.routes.ts:23`

**Issue:** `GET /api/journal/:calendarId` passes the raw path param directly to the use-case
without Zod validation. The Postgres adapter handles a non-UUID id gracefully (it queries
with a parameterized `eq()` that will return no rows, so `readJournal` returns `ok(null)` →
404), but this relies on Drizzle's parameterization silently coercing a malformed UUID to
a no-match rather than throwing. For the same reasons as WR-02, an explicit `zValidator`
at the route layer is the correct defense.

**Fix:**
```typescript
router.get(
  "/journal/:calendarId",
  zValidator("param", z.object({ calendarId: z.string().uuid() })),
  async (c) => {
    const { calendarId } = c.req.valid("param");
    ...
  },
);
```

---

### WR-04: `snapshotCalendars.ts` — floating-point arithmetic in `netGreek` without NaN guard on `parseFloat`

**File:** `packages/core/src/journal/application/snapshotCalendars.ts:73-76`

**Issue:** The `netGreek` helper calls `parseFloat(b)` and `parseFloat(f)` on BSM greek
strings. If a BSM greek string is somehow a non-numeric string that is not `null` and not
`NAN_STAMP` (for example, a DB corruption or future vendor format change returns an empty
string `""`), `parseFloat("")` returns `NaN`, and `String(NaN)` is `"NaN"`. This would
silently write `"NaN"` to a greek column that has `anyNaN === false`, masking the source of
the issue. There is no test covering the `parseFloat("")` edge case.

**Fix:** Add a NaN guard after parsing:
```typescript
const netGreek = (b: string | null, f: string | null): string => {
  if (anyNaN || b === null || f === null) return NAN_STAMP;
  const bVal = parseFloat(b);
  const fVal = parseFloat(f);
  if (isNaN(bVal) || isNaN(fVal)) return NAN_STAMP;
  return String((bVal - fVal) * cal.qty * 100);
};
```

---

### WR-05: `readPendingObs` — local `Date` construction uses local-time months (off-by-one risk on server TZ)

**File:** `packages/adapters/src/postgres/repos/leg-observations.ts:168-173`

**Issue:** The expiry date is parsed from a `YYYY-MM-DD` string as:
```typescript
const expiry = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
```
`new Date(year, month, day)` constructs a **local-time** Date. If the server runs in a
timezone west of UTC (e.g. `TZ=America/New_York`, UTC-4 or UTC-5), `new Date(2026, 5, 20)`
is `2026-06-20T04:00:00Z` — not midnight UTC. Later code (`computeT` in `dte.ts`) reads
`expiry.getFullYear()` / `getMonth()` / `getDate()` (local components) for the expiry day,
so for servers in ET this is internally consistent. However, the `PendingObs.expiry` field
travels to `makeComputeBsmGreeksUseCase` where it is passed to `computeT` — which reads
**local** date components from `expiry`. Any server TZ other than ET would produce a wrong
expiry date for BSM computation.

The worker `main.ts` does not set `process.env.TZ`, and Railway/Docker may not guarantee an
ET timezone. The safer construction is UTC-midnight:
```typescript
const expiry = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
```

---

### WR-06: `compute-bsm-greeks.ts` — `ComputeBsmGreeksUseCase` type is a structural duck-type, not the port

**File:** `apps/worker/src/handlers/compute-bsm-greeks.ts:6`

**Issue:** The handler imports no port type from `@morai/core` for `computeBsmGreeks`. Instead
it defines a local structural type:
```typescript
type ComputeBsmGreeksUseCase = () => Promise<{ ok: boolean; error?: { message: string } }>;
```
This is a weakened version of the actual `Result<void, StorageError>` return type. It
accepts any object with `ok: boolean` — including malformed results. Similarly,
`fetch-rates.ts` uses the same pattern. This undermines the type-safety that `Result<T,E>`
provides and means future changes to the error shape in the use-case won't be caught by the
type checker here.

**Fix:** Import and use the actual port type:
```typescript
import type { ForRunningComputeBsmGreeks } from "@morai/core";
// (export it from core/src/journal/index.ts if not already exported)
```

---

### WR-07: `memory/calendar-snapshots.ts` — `readJournal` returns `[]` for unknown calendarId (parity gap)

**File:** `packages/adapters/src/memory/calendar-snapshots.ts:62-70`

**Issue:** The comment acknowledges this intentionally: "Memory returns [] for unknown
calendarIds (no FK enforcement)." However, this means the Postgres contract test
(`readJournal: unknown calendarId → null`) passes only against the Postgres adapter, while
the memory adapter diverges. Use-cases that rely on the `null` sentinel to signal 404 would
behave incorrectly in unit tests that use the memory adapter.

The architecture rule (architecture-boundaries.md §8) requires the in-memory twin to have
parity with the Postgres adapter. The current divergence means a unit test using the memory
twin cannot exercise the 404 path for `readJournal`.

**Fix:** Add a `knownCalendarIds: Set<string>` to the memory adapter (seeded via a
`seedCalendar(id)` helper, mirroring the contract test's seed pattern):
```typescript
const knownIds = new Set<string>();
const readJournal: ForReadingJournal = async (calendarId) => {
  if (!knownIds.has(calendarId)) return ok(null); // unknown → null (matches Postgres)
  const rows = [...store.values()]
    .filter((r) => r.calendarId === calendarId)
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  return ok(rows);
};
```

---

## Info

### IN-01: `snapshotCalendars.ts` — `calendarDte` called with `new Date(cal.frontExpiry)` (local-time parse)

**File:** `packages/core/src/journal/application/snapshotCalendars.ts:117-118`

**Issue:** `calendarDte(now, new Date(cal.frontExpiry))` parses the `YYYY-MM-DD` expiry
string via `new Date(string)`. In browsers, `new Date("2026-07-18")` is UTC midnight.
In Node/Bun, `new Date("2026-07-18")` is also UTC midnight (ISO date-only strings are parsed
as UTC per ECMA-262). This is actually safe today. However, `calendarDte` internally snaps
both dates to UTC midnight, so the result is correct regardless. No change needed, but worth
noting that this relies on ES2015+ date-only string parsing semantics.

---

### IN-02: `nyse-holidays.ts` — holiday list expires after 2027

**File:** `packages/core/src/journal/domain/nyse-holidays.ts:19`

**Issue:** The inline comment states "Re-research before 2028." There is no automated
enforcement (no test that fails when today's year approaches 2028, no CI check). Before the
2027 holiday season this list should be extended and the comment updated.

**Suggestion:** Add a compile-time or test-time assertion:
```typescript
// In a test file:
it("nyse-holidays list covers the current year", () => {
  const currentYear = new Date().getUTCFullYear();
  expect(currentYear).toBeLessThanOrEqual(2027);
});
```

---

### IN-03: `mcp/server.ts` — `void server.close()` on every request leaks cleanup errors silently

**File:** `apps/server/src/adapters/mcp/server.ts:72` and `82`

**Issue:** `void server.close()` fire-and-forgets the close operation. If the MCP server's
`close()` throws or rejects (e.g. during shutdown under load), the error is silently
discarded. This is consistent with the existing codebase pattern for fire-and-forget but
differs from `boss.send(...).catch(...)` elsewhere, which at least logs the failure.

**Suggestion:** Add a `.catch` to surface errors:
```typescript
void server.close().catch((e: unknown) => {
  console.warn("mcp: server.close() failed", e);
});
```

---

_Reviewed: 2026-06-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
