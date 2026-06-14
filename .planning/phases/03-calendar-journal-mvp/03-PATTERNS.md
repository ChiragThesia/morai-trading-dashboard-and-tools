# Phase 3: Calendar Journal (MVP) — Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 26 (new/modified)
**Analogs found:** 26 / 26

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/journal/application/ports.ts` | model/port | — | self (extend) | exact |
| `packages/core/src/journal/application/registerCalendar.ts` | service/use-case | request-response | `fetchChain.ts` (makeFetchChainUseCase) | role-match |
| `packages/core/src/journal/application/listCalendars.ts` | service/use-case | request-response | `fetchChain.ts` | role-match |
| `packages/core/src/journal/application/closeCalendar.ts` | service/use-case | request-response | `fetchChain.ts` | role-match |
| `packages/core/src/journal/application/getJournal.ts` | service/use-case | request-response | `fetchChain.ts` | role-match |
| `packages/core/src/journal/application/getLiveGreeks.ts` | service/use-case | request-response | `fetchChain.ts` | role-match |
| `packages/core/src/journal/application/snapshotCalendars.ts` | service/use-case | batch | `computeBsmGreeks.ts` + `fetchChain.ts` | role-match |
| `packages/core/src/journal/application/fetchChain.ts` | service/use-case | batch | self (extend) | exact |
| `packages/core/src/journal/domain/nyse-holidays.ts` | utility | — | `rth-window.ts` | exact |
| `packages/core/src/journal/index.ts` | config | — | self (extend) | exact |
| `packages/adapters/src/postgres/repos/calendars.ts` | service | CRUD | self (extend) | exact |
| `packages/adapters/src/postgres/repos/calendar-snapshots.ts` | service | CRUD | `leg-observations.ts` | exact |
| `packages/adapters/src/postgres/repos/leg-observations.ts` | service | CRUD | self (extend) | exact |
| `packages/adapters/src/memory/calendars.ts` | service | CRUD | self (extend) | exact |
| `packages/adapters/src/memory/calendar-snapshots.ts` | service | CRUD | `memory/calendars.ts` | exact |
| `packages/adapters/src/memory/leg-observations.ts` | service | CRUD | `memory/calendars.ts` | role-match |
| `packages/contracts/src/calendar.ts` | model | — | `contracts/src/status.ts` | exact |
| `packages/contracts/src/journal.ts` | model | — | `contracts/src/status.ts` | exact |
| `packages/contracts/src/live-greeks.ts` | model | — | `contracts/src/status.ts` | exact |
| `packages/contracts/src/analytics.ts` | model | — | `contracts/src/status.ts` | role-match |
| `packages/contracts/src/index.ts` | config | — | self (extend) | exact |
| `apps/server/src/adapters/http/calendar.routes.ts` | controller | request-response | `status.routes.ts` | exact |
| `apps/server/src/adapters/http/journal.routes.ts` | controller | request-response | `status.routes.ts` | exact |
| `apps/server/src/adapters/mcp/tools.ts` | controller | request-response | self (extend) | exact |
| `apps/server/src/adapters/mcp/server.ts` | controller | request-response | self (extend) | exact |
| `apps/worker/src/handlers/snapshot-calendars.ts` | middleware/handler | event-driven | `fetch-cboe-chain.ts` | exact |
| `apps/worker/src/handlers/compute-bsm-greeks.ts` | middleware/handler | event-driven | self (extend) | exact |
| `apps/worker/src/main.ts` | config | — | self (extend) | exact |
| Migration: add `option_type` to `calendars` | migration | — | existing Drizzle migrations | exact |

---

## Pattern Assignments

### `packages/core/src/journal/application/ports.ts` (extend)

**Analog:** self — `packages/core/src/journal/application/ports.ts`

**Current `Calendar` domain type gap** (lines 17–20) — this is the exact delta the planner must extend:
```typescript
// CURRENT — too minimal for Phase 3:
export type Calendar = {
  readonly id: string;
  readonly underlying: string;
  readonly openedAt: Date;
};
```

**Target — replace with a richer type (all fields needed by snapshot + targeted-fetch):**
```typescript
export type Calendar = {
  readonly id: string;
  readonly underlying: string;
  readonly strike: number;          // ×1000 int (e.g. 7100000)
  readonly optionType: "C" | "P";   // D-01
  readonly frontExpiry: string;     // YYYY-MM-DD
  readonly backExpiry: string;      // YYYY-MM-DD
  readonly qty: number;
  readonly openNetDebit: number;    // stored as numeric string in DB; parsed to number at repo boundary
  readonly status: "open" | "closed";
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly notes: string | null;
};
```

**New port types to add** — follow the `ForVerbingNoun` function-type convention (lines 86–88 show the pattern):
```typescript
// Existing pattern (line 86-88):
export type ForGettingOpenCalendars = () => Promise<
  Result<ReadonlyArray<Calendar>, StorageError>
>;

// New ports follow identical structure:
export type ForRegisteringCalendar = (input: {
  readonly underlying: string;
  readonly strike: number;         // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;    // YYYY-MM-DD
  readonly backExpiry: string;     // YYYY-MM-DD
  readonly qty: number;
  readonly openNetDebit: number;
  readonly openedAt: Date;
  readonly notes?: string;
}) => Promise<Result<Calendar, StorageError>>;

export type ForListingCalendars = (filter?: "open" | "closed") => Promise<
  Result<ReadonlyArray<Calendar>, StorageError>
>;

export type ForClosingCalendar = (id: string, closeNetCredit: number) => Promise<
  Result<Calendar, StorageError | { kind: "not-found" } | { kind: "already-closed" }>
>;

export type ForGettingOpenCalendarLegs = () => Promise<
  Result<ReadonlyArray<OccSymbol>, StorageError>
>;

export type LegSnapshot = {
  readonly occSymbol: OccSymbol;
  readonly mark: number;
  readonly ivRaw: number | null;
  readonly bsmIv: string | null;       // 'NaN' | numeric string | null
  readonly bsmDelta: string | null;
  readonly bsmGamma: string | null;
  readonly bsmTheta: string | null;
  readonly bsmVega: string | null;
};

export type ForResolvingLegSnapshot = (query: {
  readonly underlying: string;
  readonly strike: number;      // ×1000 int
  readonly optionType: "C" | "P";
  readonly expiry: string;      // YYYY-MM-DD
}) => Promise<Result<LegSnapshot | null, StorageError>>;

export type SnapshotRow = {
  readonly time: Date;
  readonly calendarId: string;
  readonly spot: string;
  readonly netMark: string;
  readonly frontMark: string;
  readonly backMark: string;
  readonly frontIv: string;       // numeric string or 'NaN'
  readonly backIv: string;
  readonly frontIvRaw: string;
  readonly backIvRaw: string;
  readonly netDelta: string;
  readonly netGamma: string;
  readonly netTheta: string;
  readonly netVega: string;
  readonly termSlope: string;
  readonly dteFront: number;
  readonly dteBack: number;
  readonly pnlOpen: string;
  readonly source: "cboe";
};

export type ForPersistingSnapshot = (row: SnapshotRow) => Promise<Result<void, StorageError>>;

export type ForReadingJournal = (calendarId: string) => Promise<
  Result<ReadonlyArray<SnapshotRow>, StorageError>
>;

export type ForReadingLatestLegObs = (occSymbol: OccSymbol) => Promise<
  Result<LegSnapshot | null, StorageError>
>;
```

---

### `packages/core/src/journal/application/registerCalendar.ts` (new use-case)

**Analog:** `packages/core/src/journal/application/fetchChain.ts`

**Imports pattern** (mirror lines 1–13):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForRegisteringCalendar,
  StorageError,
} from "./ports.ts";
```

**Use-case factory pattern** (lines 180–181 and 27–29):
```typescript
// Deps type — injected at composition root:
export type RegisterCalendarDeps = {
  readonly persistCalendar: ForRegisteringCalendar;
};

// Driver port (the function callers use):
export type ForRunningRegisterCalendar = (input: {
  readonly underlying: string;
  readonly strike: number;
  readonly optionType: "C" | "P";
  readonly frontExpiry: string;
  readonly backExpiry: string;
  readonly qty: number;
  readonly openNetDebit: number;
  readonly openedAt?: Date;
  readonly notes?: string;
}) => Promise<Result<Calendar, StorageError | ValidationError>>;

// Factory (lines 180-181 pattern):
export function makeRegisterCalendarUseCase(
  deps: RegisterCalendarDeps,
): ForRunningRegisterCalendar {
  return async (input) => {
    // Domain validation (backExpiry > frontExpiry):
    if (input.backExpiry <= input.frontExpiry) {
      return err({ kind: "validation-error", message: "backExpiry must be after frontExpiry" });
    }
    return deps.persistCalendar({ ...input, openedAt: input.openedAt ?? new Date() });
  };
}
```

**Error pattern** (lines 207–210):
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

---

### `packages/core/src/journal/application/snapshotCalendars.ts` (new — most complex)

**Analog:** `packages/core/src/journal/application/fetchChain.ts` (factory shape) and `packages/core/src/journal/application/computeBsmGreeks.ts` (batch loop pattern)

**Deps type** (mirror `FetchChainDeps` lines 15–25):
```typescript
export type SnapshotCalendarsDeps = {
  readonly getOpenCalendars: ForGettingOpenCalendars;   // returns extended Calendar type
  readonly resolveLegs: ForResolvingLegSnapshot;
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly now: () => Date;
};
```

**NaN constant** — from RESEARCH.md §Focus Area 4, mirrors `computeBsmGreeks.ts` NaN stamp:
```typescript
const NAN_STAMP = "NaN";
```

**Core loop pattern** — for each open calendar, resolve front and back legs, compute net fields, write row:
```typescript
export function makeSnapshotCalendarsUseCase(
  deps: SnapshotCalendarsDeps,
): () => Promise<Result<void, StorageError>> {
  return async () => {
    const now = deps.now();
    const calendarsResult = await deps.getOpenCalendars();
    if (!calendarsResult.ok) return err(calendarsResult.error);

    for (const calendar of calendarsResult.value) {
      const frontResult = await deps.resolveLegs({
        underlying: calendar.underlying,
        strike: calendar.strike,
        optionType: calendar.optionType,
        expiry: calendar.frontExpiry,
      });
      const backResult = await deps.resolveLegs({
        underlying: calendar.underlying,
        strike: calendar.strike,
        optionType: calendar.optionType,
        expiry: calendar.backExpiry,
      });

      // D-06: always write the row; use NaN_STAMP if legs are null or bsmIv='NaN'
      const front = frontResult.ok ? frontResult.value : null;
      const back = backResult.ok ? backResult.value : null;

      // Compute net fields — D-05 formula:
      // net_mark = back_mark − front_mark
      // net_greek = (back_greek − front_greek) × qty × 100
      // pnl_open = (net_mark − open_net_debit) × qty × 100
      // term_slope = back_iv − front_iv

      const row: SnapshotRow = buildSnapshotRow(now, calendar, front, back);
      const persistResult = await deps.persistSnapshot(row);
      if (!persistResult.ok) return err(persistResult.error);
    }
    return ok(undefined);
  };
}
```

**NaN propagation in row builder** — key logic (D-06):
```typescript
function buildSnapshotRow(
  now: Date,
  cal: Calendar,
  front: LegSnapshot | null,
  back: LegSnapshot | null,
): SnapshotRow {
  const frontMark = front?.mark ?? 0;   // 0 when missing (NaN row anyway)
  const backMark = back?.mark ?? 0;
  const netMark = backMark - frontMark;

  const frontIv = front?.bsmIv ?? NAN_STAMP;
  const backIv = back?.bsmIv ?? NAN_STAMP;
  const anyNaN = frontIv === NAN_STAMP || backIv === NAN_STAMP;

  const netGreek = (b: string | null, f: string | null) =>
    anyNaN || b === null || f === null
      ? NAN_STAMP
      : String((parseFloat(b) - parseFloat(f)) * cal.qty * 100);

  const termSlope = anyNaN ? NAN_STAMP : String(parseFloat(backIv) - parseFloat(frontIv));
  const pnlOpen = String((netMark - cal.openNetDebit) * cal.qty * 100);

  return {
    time: now,
    calendarId: cal.id,
    spot: String(front?.mark ?? back?.mark ?? 0),  // spot from leg obs underlyingPrice
    netMark: String(netMark),
    frontMark: String(frontMark),
    backMark: String(backMark),
    frontIv,
    backIv,
    frontIvRaw: front?.ivRaw !== null && front?.ivRaw !== undefined ? String(front.ivRaw) : NAN_STAMP,
    backIvRaw: back?.ivRaw !== null && back?.ivRaw !== undefined ? String(back.ivRaw) : NAN_STAMP,
    netDelta: netGreek(back?.bsmDelta ?? null, front?.bsmDelta ?? null),
    netGamma: netGreek(back?.bsmGamma ?? null, front?.bsmGamma ?? null),
    netTheta: netGreek(back?.bsmTheta ?? null, front?.bsmTheta ?? null),
    netVega: netGreek(back?.bsmVega ?? null, front?.bsmVega ?? null),
    termSlope,
    dteFront: calendarDte(now, new Date(cal.frontExpiry)),
    dteBack: calendarDte(now, new Date(cal.backExpiry)),
    pnlOpen,
    source: "cboe",
  };
}
```

---

### `packages/core/src/journal/application/fetchChain.ts` (extend — D-04)

**Analog:** self

**Change 1 — extend `FetchChainDeps`** (after line 25):
```typescript
export type FetchChainDeps = {
  readonly fetchChain: ForFetchingChain;
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  readonly now: () => Date;
  readonly maxDte: number;
  readonly strikeBandPct: number;
  /** D-04: port returning OCC symbols for open calendar legs that bypass the filter */
  readonly getOpenCalendarLegs: ForGettingOpenCalendarLegs;
};
```

**Change 2 — extend `processChain` or `makeFetchChainUseCase`** to accept a `mustInclude: ReadonlySet<string>`:
```typescript
// In makeFetchChainUseCase, before processing chains (after line 185):
const legsResult = await deps.getOpenCalendarLegs();
const mustInclude: ReadonlySet<string> = legsResult.ok
  ? new Set(legsResult.value)
  : new Set();

// Extend isInFilter call in processChain to accept mustInclude:
if (!isInFilter(quote, now, chain.spot, maxDte, strikeBandPct) &&
    !mustInclude.has(quote.occSymbol)) continue;
```

---

### `packages/core/src/journal/domain/nyse-holidays.ts` (new)

**Analog:** `packages/core/src/journal/domain/rth-window.ts`

**Exact `Intl.DateTimeFormat` pattern to copy** (lines 14–21 of `rth-window.ts`):
```typescript
// rth-window.ts lines 14-21 — mirror this Intl pattern:
export function isWithinRth(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  // ...
}
```

**New function — use year/month/day parts instead of hour/minute/weekday:**
```typescript
// packages/core/src/journal/domain/nyse-holidays.ts
// No imports (pure data, no @morai/shared needed)

const NYSE_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
  "2026-05-25", "2026-06-19", "2026-07-04", "2026-09-07",
  "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
  "2027-05-31", "2027-06-18", "2027-09-06", "2027-11-25",
  "2027-12-24",
]);

export function isNyseHoliday(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return false;
  return NYSE_HOLIDAYS.has(`${year}-${month}-${day}`);
}
```

Note: RESEARCH.md §Focus Area 3 lists 9 dates for 2026, but the authoritative ICE source and RESEARCH.md text confirm July 4 (Saturday 2026) means the observed holiday is **Friday July 3, 2026** as an early close — NOT a full closure. The full closure list from the ICE source has 9 closures in 2026 (July 4 is a Saturday, no market anyway). Planner must verify the exact 2026 list against RESEARCH.md lines 358–379 (the definitive list already written there).

---

### `packages/adapters/src/postgres/repos/calendars.ts` (extend)

**Analog:** self — `packages/adapters/src/postgres/repos/calendars.ts`

**Current repo pattern** (lines 33–94) — extend by adding write methods:
```typescript
// Existing pattern (lines 33-60) — all new methods follow same try/catch/ok/err:
const getOpenCalendars: ForGettingOpenCalendars = async () => {
  try {
    const rows = await db.select({ ... }).from(calendars).where(eq(calendars.status, "open"));
    return ok(rows.map(...));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err<StorageError>({ kind: "storage-error", message });
  }
};
```

**New method patterns to add:**
```typescript
// registerCalendar — INSERT returning the new row
const registerCalendar: ForRegisteringCalendar = async (input) => {
  try {
    const [row] = await db.insert(calendars).values({
      underlying: input.underlying,
      strike: input.strike,
      optionType: input.optionType,          // new column (D-01 migration)
      frontExpiry: input.frontExpiry,
      backExpiry: input.backExpiry,
      qty: input.qty,
      openNetDebit: String(input.openNetDebit),
      status: "open",
      openedAt: input.openedAt,
      notes: input.notes ?? null,
    }).returning();
    if (row === undefined) return err({ kind: "storage-error", message: "insert returned no row" });
    return ok(mapRow(row));
  } catch (e) { ... }
};

// listCalendars — SELECT with optional status filter
// closeCalendar — UPDATE status + closedAt + closeNetCredit
// getOpenCalendarLegs — implements ForGettingOpenCalendarLegs:
//   SELECT id, underlying, strike, optionType, frontExpiry, backExpiry from calendars WHERE status='open'
//   Then construct OCC symbols via formatOccSymbol (strike / 1000) for both legs
```

**`formatOccSymbol` import** — already in `leg-observations.ts` line 1:
```typescript
import { ok, err, parseOccSymbol, formatOccSymbol } from "@morai/shared";
```

---

### `packages/adapters/src/postgres/repos/calendar-snapshots.ts` (new)

**Analog:** `packages/adapters/src/postgres/repos/leg-observations.ts`

**Imports pattern** (lines 1–14 of `leg-observations.ts`):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPersistingSnapshot, ForReadingJournal, SnapshotRow, StorageError } from "@morai/core";
import { eq, asc } from "drizzle-orm";
import { calendarSnapshots } from "../schema.ts";
import type { Db } from "../db.ts";
```

**`persistSnapshot` — idempotent INSERT** (mirror `persistObservations` lines 45–78):
```typescript
// onConflictDoNothing on composite PK (time, calendar_id):
const persistSnapshot: ForPersistingSnapshot = async (row) => {
  try {
    await db.insert(calendarSnapshots).values({
      time: row.time,
      calendarId: row.calendarId,
      spot: row.spot,
      netMark: row.netMark,
      frontMark: row.frontMark,
      backMark: row.backMark,
      frontIv: row.frontIv,
      backIv: row.backIv,
      frontIvRaw: row.frontIvRaw,
      backIvRaw: row.backIvRaw,
      netDelta: row.netDelta,
      netGamma: row.netGamma,
      netTheta: row.netTheta,
      netVega: row.netVega,
      termSlope: row.termSlope,
      dteFront: row.dteFront,
      dteBack: row.dteBack,
      pnlOpen: row.pnlOpen,
      source: row.source,
    }).onConflictDoNothing();
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err<StorageError>({ kind: "storage-error", message });
  }
};
```

**`readJournal` — SELECT ordered by time ASC:**
```typescript
const readJournal: ForReadingJournal = async (calendarId) => {
  try {
    const rows = await db
      .select()
      .from(calendarSnapshots)
      .where(eq(calendarSnapshots.calendarId, calendarId))
      .orderBy(asc(calendarSnapshots.time));
    return ok(rows.map(mapSnapshotRow));
  } catch (e) { ... }
};
```

**`ForResolvingLegSnapshot` — two-step join** (mirrors `readPendingObs` step-1/step-2 pattern, lines 118–195):
```typescript
// Step 1: query contracts by attributes (avoids guessing root):
const contractRow = await db
  .select({ occSymbol: contracts.occSymbol })
  .from(contracts)
  .where(and(
    eq(contracts.underlying, query.underlying),
    eq(contracts.strike, query.strike),        // both ×1000 int
    eq(contracts.expiration, query.expiry),
    eq(contracts.contractType, query.optionType),
  ))
  .limit(1);

// Step 2: latest leg_observation for that occSymbol:
const obsRow = await db
  .select()
  .from(legObservations)
  .where(eq(legObservations.contract, occSymbol))
  .orderBy(desc(legObservations.time))
  .limit(1);
```

---

### `packages/adapters/src/postgres/repos/leg-observations.ts` (extend — D-04)

**Analog:** self

Add `ForGettingOpenCalendarLegs` implementation that constructs OCC symbols from open calendar rows. The leg observations repo already imports `formatOccSymbol` (line 1). The new method queries `calendars` table via the injected `db` and formats both front and back OCC symbols for each open calendar.

---

### `packages/adapters/src/memory/calendars.ts` (extend)

**Analog:** self — `packages/adapters/src/memory/calendars.ts`

**Current in-memory pattern** (lines 29–57) — extend the backing `Map` to hold the full `Calendar` type and add write methods:
```typescript
// Existing pattern (lines 30-36):
export function makeMemoryCalendarsRepo(): MemoryCalendarsRepo {
  const store = new Map<string, Calendar>();

  const getOpenCalendars: ForGettingOpenCalendars = async () => {
    return ok([...store.values()]);
  };
  // ...
}
```

Add `registerCalendar`, `listCalendars`, `closeCalendar`, `getOpenCalendarLegs` following the same synchronous-map-wrapped-in-async-ok pattern. `seedOpenCalendar` must accept the full `Calendar` type (remove sentinel strike value from existing seed helper once type is extended).

---

### `packages/adapters/src/memory/calendar-snapshots.ts` (new)

**Analog:** `packages/adapters/src/memory/calendars.ts`

**Imports pattern** (mirror lines 1–8 of `memory/calendars.ts`):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPersistingSnapshot, ForReadingJournal, SnapshotRow, StorageError } from "@morai/core";
```

**Backing store** — `Map<string, SnapshotRow[]>` keyed by `calendarId`, or a `Set<string>` composite key `${time.toISOString()}-${calendarId}` for idempotency. Mirror the `onConflictDoNothing` behavior:
```typescript
export function makeMemoryCalendarSnapshotsRepo() {
  // key: `${time.toISOString()}:${calendarId}` for idempotency
  const store = new Map<string, SnapshotRow>();

  const persistSnapshot: ForPersistingSnapshot = async (row) => {
    const key = `${row.time.toISOString()}:${row.calendarId}`;
    if (!store.has(key)) store.set(key, row);   // onConflictDoNothing equivalent
    return ok(undefined);
  };

  const readJournal: ForReadingJournal = async (calendarId) => {
    const rows = [...store.values()]
      .filter((r) => r.calendarId === calendarId)
      .sort((a, b) => a.time.getTime() - b.time.getTime());
    return ok(rows);
  };

  return { persistSnapshot, readJournal };
}
```

---

### `packages/contracts/src/calendar.ts` (new)

**Analog:** `packages/contracts/src/status.ts`

**Pattern** (lines 1–28 of `status.ts` — Zod object, inferred type export, MCP-02 shared schema):
```typescript
import { z } from "zod";

// MCP-02: ONE schema source for HTTP route AND MCP tool.

export const registerCalendarRequest = z.object({
  underlying: z.string().min(1).max(16),
  strike: z.number().int().positive(),     // ×1000 int (e.g. 7100000 for SPX 7100)
  optionType: z.enum(["C", "P"]),
  frontExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  backExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.number().int().positive(),
  openNetDebit: z.number(),
  openedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});
export type RegisterCalendarRequest = z.infer<typeof registerCalendarRequest>;

export const calendarResponse = z.object({
  id: z.string().uuid(),
  underlying: z.string(),
  strike: z.number(),
  optionType: z.enum(["C", "P"]),
  frontExpiry: z.string(),
  backExpiry: z.string(),
  qty: z.number(),
  openNetDebit: z.number(),
  status: z.enum(["open", "closed"]),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});
export type CalendarResponse = z.infer<typeof calendarResponse>;

export const listCalendarsResponse = z.object({
  calendars: z.array(calendarResponse),
});
export type ListCalendarsResponse = z.infer<typeof listCalendarsResponse>;

export const closeCalendarRequest = z.object({
  closeNetCredit: z.number(),
});
export type CloseCalendarRequest = z.infer<typeof closeCalendarRequest>;
```

---

### `packages/contracts/src/journal.ts` (new)

**Analog:** `packages/contracts/src/status.ts`

```typescript
import { z } from "zod";

// MCP-02: shared between GET /api/journal/:calendarId and MCP get_journal

export const snapshotResponse = z.object({
  time: z.string().datetime(),
  calendarId: z.string().uuid(),
  spot: z.string(),
  netMark: z.string(),
  frontMark: z.string(),
  backMark: z.string(),
  frontIv: z.string(),
  backIv: z.string(),
  frontIvRaw: z.string(),
  backIvRaw: z.string(),
  netDelta: z.string(),
  netGamma: z.string(),
  netTheta: z.string(),
  netVega: z.string(),
  termSlope: z.string(),
  dteFront: z.number().int(),
  dteBack: z.number().int(),
  pnlOpen: z.string(),
  source: z.enum(["cboe", "schwab_chain", "computed_only"]),
});
export type SnapshotResponse = z.infer<typeof snapshotResponse>;

export const journalResponse = z.object({
  snapshots: z.array(snapshotResponse),
});
export type JournalResponse = z.infer<typeof journalResponse>;
```

---

### `packages/contracts/src/analytics.ts` (new — typed-empty stubs)

**Analog:** `packages/contracts/src/status.ts`

```typescript
import { z } from "zod";

// Typed-empty schemas for Phase 6 tools — always return {observations:[]}
// Never an error (SPEC §7).

export const termStructureResponse = z.object({
  observations: z.array(z.unknown()),
});
export type TermStructureResponse = z.infer<typeof termStructureResponse>;

export const skewResponse = z.object({
  observations: z.array(z.unknown()),
});
export type SkewResponse = z.infer<typeof skewResponse>;
```

---

### `apps/server/src/adapters/http/calendar.routes.ts` (new)

**Analog:** `apps/server/src/adapters/http/status.routes.ts`

**Exact route factory pattern** (lines 14–29 of `status.routes.ts`):
```typescript
// status.routes.ts pattern to mirror exactly:
export function statusRoutes(getStatus: ForGettingStatus) {
  const router = new Hono();
  router.get("/status", async (c) => {
    const result = await getStatus();
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(statusResponse.parse(result.value));
  });
  return router;
}
```

**New calendar routes follow same shape:**
```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  registerCalendarRequest,
  calendarResponse,
  listCalendarsResponse,
  closeCalendarRequest,
} from "@morai/contracts";
import type { ForRunningRegisterCalendar, ForListingCalendars, ForClosingCalendar } from "@morai/core";

export function calendarRoutes(
  registerCalendar: ForRunningRegisterCalendar,
  listCalendars: ForListingCalendars,
  closeCalendar: ForClosingCalendar,
) {
  const router = new Hono();

  // POST /api/calendars — register
  router.post("/calendars", zValidator("json", registerCalendarRequest), async (c) => {
    const body = c.req.valid("json");
    const result = await registerCalendar(body);
    if (!result.ok) {
      if (result.error.kind === "validation-error") return c.json({ error: result.error.message }, 400);
      return c.json({ error: "internal" }, 500);
    }
    return c.json(calendarResponse.parse(result.value), 201);
  });

  // GET /api/calendars — list
  router.get("/calendars", async (c) => {
    const status = c.req.query("status");
    const filter = status === "open" || status === "closed" ? status : undefined;
    const result = await listCalendars(filter);
    if (!result.ok) return c.json({ error: "internal" }, 500);
    return c.json(listCalendarsResponse.parse({ calendars: result.value }));
  });

  // POST /api/calendars/:id/close — close
  router.post("/calendars/:id/close", zValidator("json", closeCalendarRequest), async (c) => {
    const id = c.req.param("id");
    const { closeNetCredit } = c.req.valid("json");
    const result = await closeCalendar(id, closeNetCredit);
    if (!result.ok) {
      if (result.error.kind === "not-found") return c.json({ error: "not found" }, 404);
      if (result.error.kind === "already-closed") return c.json({ error: "already closed" }, 409);
      return c.json({ error: "internal" }, 500);
    }
    return c.json(calendarResponse.parse(result.value));
  });

  return router;
}
```

---

### `apps/server/src/adapters/http/journal.routes.ts` (new)

**Analog:** `apps/server/src/adapters/http/status.routes.ts`

```typescript
import { Hono } from "hono";
import { journalResponse } from "@morai/contracts";
import type { ForReadingJournal } from "@morai/core";

export function journalRoutes(getJournal: ForReadingJournal) {
  const router = new Hono();

  router.get("/journal/:calendarId", async (c) => {
    const calendarId = c.req.param("calendarId");
    const result = await getJournal(calendarId);
    if (!result.ok) return c.json({ error: "internal" }, 500);
    if (result.value === null) return c.json({ error: "not found" }, 404);
    return c.json(journalResponse.parse({ snapshots: result.value }));
  });

  return router;
}
```

---

### `apps/server/src/adapters/mcp/tools.ts` (extend)

**Analog:** self — `apps/server/src/adapters/mcp/tools.ts`

**Exact `registerStatusTool` pattern to mirror** (all 47 lines):
```typescript
// Full pattern — lines 15-47 of tools.ts:
export function registerStatusTool(server: McpServer, getStatus: ForGettingStatus): void {
  server.registerTool(
    "get_status",
    {
      title: "Get Morai Status",
      description: "...",
      inputSchema: {},        // no params: empty raw shape
    },
    async () => {
      const result = await getStatus();
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = statusResponse.parse(result.value);
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
```

**Tools with parameters** — re-parse args at boundary (RESEARCH.md §Focus Area 2, Pitfall 6):
```typescript
// registerGetJournalTool — mirror of registerStatusTool with calendarId param:
export function registerGetJournalTool(server: McpServer, getJournal: ForReadingJournal): void {
  server.registerTool(
    "get_journal",
    {
      title: "Get Journal",
      description: "Returns the ordered snapshot series for a calendar.",
      inputSchema: { calendarId: z.string().uuid() },
    },
    async (args) => {
      // Re-parse at boundary (thin-adapter rule, typescript.md):
      const { calendarId } = z.object({ calendarId: z.string().uuid() }).parse(args);
      const result = await getJournal(calendarId);
      if (!result.ok) return { content: [{ type: "text" as const, text: "internal error" }] };
      const payload = journalResponse.parse({ snapshots: result.value });
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
```

**Typed-empty stub tools** (no use-case, no result.ok guard):
```typescript
export function registerGetTermStructureTool(server: McpServer): void {
  server.registerTool(
    "get_term_structure",
    { title: "Get Term Structure", description: "...", inputSchema: {} },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify({ observations: [] }) }],
    }),
  );
}
// Identical shape for registerGetSkewTool
```

---

### `apps/server/src/adapters/mcp/server.ts` (extend)

**Analog:** self — `apps/server/src/adapters/mcp/server.ts`

**Current `makeMcpRouter` signature** (line 22–25):
```typescript
export function makeMcpRouter(config: Config, getStatus: ForGettingStatus): Hono
```

**Extended signature** — add one explicit parameter per use-case (RESEARCH.md §Focus Area 2):
```typescript
export function makeMcpRouter(
  config: Config,
  getStatus: ForGettingStatus,
  listCalendars: ForListingCalendars,
  getJournal: ForReadingJournal,
  getLiveGreeks: ForReadingLatestLegObs,
): Hono
```

**`makeServerAndTransport` helper** (lines 33–39) — extend `registerStatusTool` call to also call all new `registerXxxTool` functions:
```typescript
function makeServerAndTransport() {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = new McpServer({ name: "morai", version: "1.0.0" });
  registerStatusTool(server, getStatus);
  registerListCalendarsTool(server, listCalendars);
  registerGetJournalTool(server, getJournal);
  registerGetLiveGreeksTool(server, getLiveGreeks);
  registerGetTermStructureTool(server);   // no use-case
  registerGetSkewTool(server);            // no use-case
  return { server, transport };
}
```

---

### `apps/worker/src/handlers/snapshot-calendars.ts` (new)

**Analog:** `apps/worker/src/handlers/fetch-cboe-chain.ts`

**Exact handler pattern** (all 62 lines of `fetch-cboe-chain.ts`):
```typescript
// Mirror fetch-cboe-chain.ts exactly — same BossForChainHandler type (re-export it):
import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSnapshotCalendars } from "@morai/core";

type SnapshotCalendarsHandlerDeps = {
  readonly snapshotCalendarsUseCase: ForRunningSnapshotCalendars;
  readonly now: () => Date;
};

export function makeSnapshotCalendarsHandler(
  deps: SnapshotCalendarsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 guard (line 40 in fetch-cboe-chain.ts):
    if (job === undefined) return;

    const now = deps.now();
    // CAL-05: RTH + holiday gate (both gates required):
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("snapshot-calendars: skipping — outside RTH or NYSE holiday");
      return;
    }

    const result = await deps.snapshotCalendarsUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
}
```

Note: no `boss.send` in this handler — snapshot-calendars is the terminal job in the chain (no downstream trigger in Phase 3).

---

### `apps/worker/src/handlers/compute-bsm-greeks.ts` (extend — D-03)

**Analog:** self

**Current handler** — no `boss` dep (line 8). Add `boss` to deps type (mirror `BossForChainHandler` from `fetch-cboe-chain.ts` line 7–13):
```typescript
// Add to ComputeBsmGreeksHandlerDeps:
readonly boss: BossForChainHandler;

// Add after successful use-case result (mirror lines 55-59 of fetch-cboe-chain.ts):
void deps.boss.send("snapshot-calendars", {}, {
  singletonKey: "triggered-by-compute",
}).catch((e: unknown) => {
  console.warn("compute-bsm-greeks: failed to enqueue snapshot-calendars", e);
});
```

---

### `apps/worker/src/main.ts` (extend)

**Analog:** self

**`createQueue` pattern** (lines 108–110) — add one line for new queue:
```typescript
// Existing (lines 108-110):
await boss.createQueue("fetch-cboe-chain");
await boss.createQueue("fetch-rates");
await boss.createQueue("compute-bsm-greeks");
// ADD:
await boss.createQueue("snapshot-calendars");
```

**`work` registration pattern** (lines 135–137) — add worker, NO schedule (D-03 / Pitfall 5):
```typescript
// Existing pattern:
await boss.work("fetch-cboe-chain", { pollingIntervalSeconds: 30 }, fetchCboeChainHandler);
// ADD (no boss.schedule — chain-triggered only per D-03):
await boss.work("snapshot-calendars", { pollingIntervalSeconds: 30 }, snapshotCalendarsHandler);
```

**Import block extension** (lines 9–28) — add new handler import and new repos/use-cases:
```typescript
import { makeSnapshotCalendarsHandler } from "./handlers/snapshot-calendars.ts";
```

**`computeBsmGreeksHandler` construction** (line 100–102) — add `boss` dep:
```typescript
// Before (line 100-102):
const computeBsmGreeksHandler = makeComputeBsmGreeksHandler({ computeBsmGreeksUseCase });
// After (D-03):
const computeBsmGreeksHandler = makeComputeBsmGreeksHandler({ computeBsmGreeksUseCase, boss });
```

---

### Migration: add `option_type` to `calendars` (D-01)

**Analog:** existing Drizzle migrations in `packages/adapters/src/postgres/migrations/`

**Schema change** — add to `schema.ts` `calendars` table (after line 43 `qty`):
```typescript
optionType: contractTypeEnum("option_type").notNull(),
```

Migration SQL:
```sql
ALTER TABLE calendars ADD COLUMN option_type contract_type NOT NULL;
-- Note: existing rows have strike=0 sentinel (test seed only); prod table is empty.
-- If prod table could have rows, add DEFAULT 'C' temporarily then drop default.
```

---

## Shared Patterns

### Error Handling (applies to all service/use-case files)

**Source:** `packages/adapters/src/postgres/repos/leg-observations.ts` lines 74–78 and `packages/adapters/src/postgres/repos/calendars.ts` lines 54–59

```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

### pg-boss Array Guard (applies to all worker handlers)

**Source:** `apps/worker/src/handlers/fetch-cboe-chain.ts` line 40

```typescript
// T-02-18: pg-boss v12 may pass undefined as first array element
if (job === undefined) return;
```

### RTH + Holiday Gate (applies to `fetch-cboe-chain.ts` and `snapshot-calendars.ts`)

**Source:** `apps/worker/src/handlers/fetch-cboe-chain.ts` lines 43–46

```typescript
// Existing (fetch-cboe-chain.ts lines 43-46):
if (!isWithinRth(deps.now())) {
  console.warn("fetch-cboe-chain: skipping — outside RTH");
  return;
}
// Extended pattern (both handlers after Phase 3):
const now = deps.now();
if (!isWithinRth(now) || isNyseHoliday(now)) {
  console.warn("<handler-name>: skipping — outside RTH or NYSE holiday");
  return;
}
```

### Numeric String Convention for Postgres (applies to snapshot insert and all repo writes)

**Source:** `packages/adapters/src/postgres/repos/leg-observations.ts` lines 52–66

```typescript
// Drizzle numeric() columns map to string in TypeScript:
bid: String(row.bid),     // number → string
bsmIv: write.bsmIv,      // already a string: 'NaN' or numeric string
```

**NaN stamp** — `packages/core/src/journal/application/computeBsmGreeks.ts`:
```typescript
// T-02-16 established pattern: pass string 'NaN' for unsolvable numeric NOT NULL columns.
// Never pass JS null, undefined, or NaN directly.
const NAN_STAMP = "NaN";
```

### Fire-and-Forget Job Chain (applies to `compute-bsm-greeks.ts` extension)

**Source:** `apps/worker/src/handlers/fetch-cboe-chain.ts` lines 56–60

```typescript
void deps.boss.send("compute-bsm-greeks", {}, {
  singletonKey: "triggered-by-chain",
}).catch((e: unknown) => {
  console.warn("fetch-cboe-chain: failed to enqueue compute-bsm-greeks", e);
});
```

### MCP Tool Registration (applies to all 5 new tools in `tools.ts`)

**Source:** `apps/server/src/adapters/mcp/tools.ts` lines 15–47

Key invariants:
- `type: "text" as const` (exactOptionalPropertyTypes requires `as const` here)
- `result.ok` guard before use (type narrower)
- Parse through contract schema before returning
- Re-parse `args` at boundary for tools with parameters

---

## No Analog Found

All files have close analogs. No cases with no match.

---

## Metadata

**Analog search scope:** `packages/core/`, `packages/adapters/`, `packages/contracts/`, `apps/server/src/adapters/`, `apps/worker/src/`
**Files scanned:** 13 source files read directly
**Pattern extraction date:** 2026-06-13
