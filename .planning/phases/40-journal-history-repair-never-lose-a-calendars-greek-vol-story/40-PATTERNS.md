# Phase 40: Journal History Repair - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 17 (6 new, 7 modified, 4 bug-fix call sites — 2 of the 4 land inside files already counted above)
**Analogs found:** 17 / 17 — RESEARCH.md's own conclusion holds: every piece of this phase's
machinery is a new *instance* of an existing pattern, not new architecture.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/journal/domain/occ-root.ts` (NEW) | domain (pure fn) | transform | `packages/shared/src/occ-symbol.ts` | role-match |
| `packages/core/src/journal/domain/<slot-rounding>.ts` (NEW, name TBD e.g. `rth-slot.ts`) | domain (pure fn) | transform | `packages/shared/src/rth-window.ts` (`isWithinRth`) | exact |
| `packages/core/src/journal/application/rebuildCalendarHistory.ts` (NEW) | application use-case | batch/derive+upsert | `packages/core/src/journal/application/snapshotCalendars.ts` | exact |
| `packages/core/src/journal/application/selfHealJournal.ts` (NEW) | application use-case (bounded wrapper) | batch | `rebuildCalendarHistory.ts` (sibling, parametrized) | role-match |
| `apps/worker/src/handlers/self-heal-journal.ts` (NEW) | worker handler (thin adapter) | event-driven (pg-boss job) | `apps/worker/src/handlers/register-open-calendars.ts` | exact |
| `apps/worker/src/repair-journal-history.ts` (NEW) | CLI (composition root) | batch | `apps/worker/src/fix-pnl-reingest.ts` | exact |
| `packages/core/src/journal/application/ports.ts` (ADD 2 ports) | port definitions | request-response (types) | itself — `ForResolvingLegSnapshot`/`ForPersistingSnapshot` (same file) | exact |
| `packages/core/src/journal/application/registerOpenCalendars.ts` (EXTEND — chain backfill) | application use-case | event-driven (chained effect) | `apps/worker/src/handlers/snapshot-calendars.ts`'s chain-enqueue of `compute-analytics` | role-match |
| `packages/adapters/src/postgres/repos/leg-observations.ts` (ADD as-of-slot read) | driven adapter (Postgres repo) | request-response (read) | `readSmile` in same file | exact |
| `packages/adapters/src/postgres/repos/calendar-snapshots.ts` (ADD heal-write; FIX `resolveLegSnapshot`; FIX `mapSnapshotRow`) | driven adapter (Postgres repo) | CRUD (conditional write) + request-response (read fix) | `recomputeSnapshotPnl` (transactional UPDATE, same file) for the write; `readLatestSnapshotPerOpenCalendar` (source-inclusive mapping, same file) for the read fix | exact |
| `packages/adapters/src/memory/leg-observations.ts` (ADD twin) | driven adapter (memory) | request-response | `readSmile` twin in same file | exact |
| `packages/adapters/src/memory/calendar-snapshots.ts` (ADD twin) | driven adapter (memory) | CRUD | `persistSnapshot`/`recomputeSnapshotPnl` twins in same file | exact |
| `apps/worker/src/schedule.ts` (ADD queue registration) | config/wiring | event-driven (job registration) | `register-open-calendars` registration triad (`createQueue`/no-schedule/`work`) | exact |
| `docs/architecture/jobs.md` (UPDATE — docs-first, CLAUDE.md rule 4) | docs | — | existing `snapshot-calendars` Job Catalog row | exact |
| `packages/adapters/src/postgres/repos/calendars.ts` `getOpenCalendarLegs` (FIX — bug site #1) | driven adapter (Postgres repo) | request-response | itself (root-construction bug, before/after) | exact |
| `packages/adapters/src/memory/calendars.ts` `getOpenCalendarLegs` (FIX — bug site #2, byte-identical twin) | driven adapter (memory) | request-response | itself, must mirror #1 (architecture-boundaries rule 8) | exact |
| `packages/core/src/journal/application/getLiveGreeks.ts` (FIX — bug site #4) | application use-case | request-response | itself (root-construction bug, before/after) | exact |

Bug site #3 (`resolveLegSnapshot`'s `contracts.root` match) is the SAME file/function already
listed above as `calendar-snapshots.ts`'s heal-write row — not double-counted.

## Pattern Assignments

### Pattern A — HIST-01 root-fix, one function reused at all 4 broken call sites

**New file:** `packages/core/src/journal/domain/occ-root.ts`
**Analog:** `packages/shared/src/occ-symbol.ts` (pure, no I/O, `Result`-free total function —
`occ-root.ts` is even simpler: no parse failure mode, so it returns a plain array, not a `Result`)

**Imports/shape pattern** (`packages/shared/src/occ-symbol.ts:1,15-30`):
```typescript
import { type Result, ok, err } from "./result.ts";

export type OccSymbol = string & { readonly __brand: "OccSymbol" };
export type OccSymbolParsed = { readonly root: string; readonly expiry: Date; ... };
export type OccError = | { readonly kind: "WRONG_LENGTH"; ... } | ...;
```
`occ-root.ts` mirrors this file's convention (branded/literal types, exported pure functions,
zero imports beyond `@morai/shared` internals) but its function is total (never fails), so no
`Result`/error-union is needed:
```typescript
// packages/core/src/journal/domain/occ-root.ts (RESEARCH Pattern 1, recommended shape)
export function resolveRootCandidates(underlying: string): ReadonlyArray<"SPX" | "SPXW"> {
  if (underlying === "SPXW") return ["SPXW"]; // unambiguous — no split possible
  return ["SPX", "SPXW"]; // try the calendar's stored root first, then the sibling
}
```

**The 4 broken call sites to fix with this function** (all currently do
`underlying === "SPXW" ? "SPXW" : "SPX"` inline for BOTH legs — verified current line numbers):

1. `packages/adapters/src/postgres/repos/calendars.ts:349-360` (`getOpenCalendarLegs`):
```typescript
const front = formatOccSymbol({
  root: row.underlying === "SPXW" ? "SPXW" : "SPX",   // BUG: same root for both legs
  expiry: new Date(row.frontExpiry + "T12:00:00Z"),
  type: row.optionType,
  strike: strikePoints,
});
const back = formatOccSymbol({
  root: row.underlying === "SPXW" ? "SPXW" : "SPX",   // BUG: identical construction for back leg
  expiry: new Date(row.backExpiry + "T12:00:00Z"),
  type: row.optionType,
  strike: strikePoints,
});
```
Fix direction (this call site is the one genuine "no `contracts` row may exist yet" case per
RESEARCH — build BOTH candidate symbols and add both to the `mustInclude`/returned set; costless
over-inclusion, `Set<OccSymbol>` already dedups).

2. `packages/adapters/src/memory/calendars.ts:143-154` — byte-identical bug, in-memory twin of
   #1 (architecture-boundaries rule 8: fix together, same PR).

3. `packages/adapters/src/postgres/repos/calendar-snapshots.ts:152-163` (`resolveLegSnapshot`,
   inside the `ForResolvingLegSnapshot` factory):
```typescript
const contractRows = await db
  .select({ occSymbol: contracts.occSymbol })
  .from(contracts)
  .where(
    and(
      eq(contracts.root, query.underlying),   // BUG: should try both SPX/SPXW candidates
      eq(contracts.strike, query.strike),
      eq(contracts.expiration, query.expiry),
      eq(contracts.contractType, query.optionType),
    ),
  )
  .limit(1);
```
Fix direction: `inArray(contracts.root, resolveRootCandidates(query.underlying))` — a `contracts`
row already exists here (populated by the correctly-parsing fetch adapter), so the root-agnostic
try-both lookup is safe with zero date-math risk.

4. `packages/core/src/journal/application/getLiveGreeks.ts:66-81` (`makeGetLiveGreeksUseCase`):
```typescript
const root: "SPX" | "SPXW" = cal.underlying === "SPXW" ? "SPXW" : "SPX";
const strikePoints = cal.strike / 1000;
const frontOcc = formatOccSymbol({ root, expiry: new Date(cal.frontExpiry + "T12:00:00Z"), type: cal.optionType, strike: strikePoints });
const backOcc = formatOccSymbol({ root, expiry: new Date(cal.backExpiry + "T12:00:00Z"), type: cal.optionType, strike: strikePoints });
```
Same bug — one `root` value reused for both legs. This is the exact tool CONTEXT.md's own
diagnosis used, so its printed NaN is ambiguous per RESEARCH Pitfall 4 (cannot distinguish
"no observation" from "never processed" from "root mismatch" — the diagnostic SQL, not this
tool's output, is the confirmation source).

### Pattern B — Slot-boundary rounding (HIST-05), reuse the existing composite PK

**New file:** `packages/core/src/journal/domain/<slot-rounding>.ts` (name at planner's discretion,
e.g. `rth-slot.ts`)
**Analog (full source, copy the idiom exactly):** `packages/shared/src/rth-window.ts`
```typescript
/**
 * isWithinRth — pure RTH gate for the US equity market.
 * - Never reads Date.now() — accepts `now` explicitly for testability/purity.
 * - No imports from outside @morai/shared (architecture-boundaries.md §2).
 */
export function isWithinRth(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  // ...extract weekday/hour/minute via Intl parts, no manual UTC-offset math
}
```
The new slot-rounding function belongs in `packages/core/src/journal/domain/` (not
`packages/shared`, since it's journal-specific 30-min-slot semantics, unlike the
generic RTH-membership check) but follows the SAME `Intl.DateTimeFormat`-based,
caller-passes-`now`, zero-`Date.now()` idiom. Applied only to `snapshotCalendars.ts`'s
`buildSnapshotRow` call for `trigger: 'scheduled'` rows (see `snapshotCalendars.ts:120-132,221-232`
below) — `event-move` rows keep their real timestamp (D-07).

### Pattern C — Rebuild use-case (HIST-02), mirrors the live writer exactly

**New file:** `packages/core/src/journal/application/rebuildCalendarHistory.ts`
**Analog (full source):** `packages/core/src/journal/application/snapshotCalendars.ts`

**Deps/factory shape to copy** (`snapshotCalendars.ts:120-132`):
```typescript
export type SnapshotCalendarsDeps = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly resolveLegs: ForResolvingLegSnapshot;
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly now: () => Date;   // Clock injection — never Date.now() in core
};
export type ForRunningSnapshotCalendars = (args?: {
  readonly trigger?: "scheduled" | "event-move";
}) => Promise<Result<void, StorageError>>;
```
`rebuildCalendarHistory.ts`'s deps swap `resolveLegs`/`persistSnapshot` for the new
as-of-slot read port + heal-write port, and takes a `(calendarId, from, to)` range instead of
iterating all open calendars.

**Pure formula reuse — call these EXACT exported functions, D-02 no-drift** (already exported
specifically for reuse, PICK-04/JRNL-01 precedent):
```typescript
// packages/core/src/journal/application/snapshotCalendars.ts:112-118, 144-212
export function computeSnapshotPnl(netMark: number, openNetDebit: number, qty: number): number {
  return (netMark - openNetDebit) * qty * 100;
}
export function computeLegPairMetrics(
  now: Date, front: LegSnapshot | null, back: LegSnapshot | null,
  qty: number, frontExpiry: string, backExpiry: string,
): Omit<SnapshotRow, "calendarId" | "pnlOpen" | "trigger"> { /* ...marks/IVs/greeks/spot/source... */ }
```

**Loop-and-gate shape to mirror** (`snapshotCalendars.ts:243-294`, `makeSnapshotCalendarsUseCase`):
one `for` loop per calendar (here: per slot), resolve front+back, build the row via the shared
pure functions, persist, propagate `StorageError` via `err(...)`, return `ok(undefined)` — same
`Result`-threading style throughout, no `try/catch` in the use-case layer (only adapters catch).

**D-04 honest-gap law**: where `snapshotCalendars.ts` gates on `assessLegFreshness` (skip on
stale/missing), `rebuildCalendarHistory.ts` gates on "no usable observation for this slot" —
produce nothing for that slot (never interpolate), same "skip, don't fabricate" shape.

### Pattern D — New ports (HIST-02), add beside the existing pair in the SAME file

**File to modify:** `packages/core/src/journal/application/ports.ts`
**Analog (full source, same file, lines 173-241):**
```typescript
export type LegSnapshot = {
  readonly occSymbol: OccSymbol;
  readonly time: Date;
  readonly mark: number;
  readonly underlyingPrice: number;
  readonly ivRaw: number | null;
  readonly bsmIv: string | null; // 'NaN' | numeric string | null
  readonly bsmDelta: string | null;
  readonly bsmGamma: string | null;
  readonly bsmTheta: string | null;
  readonly bsmVega: string | null;
  readonly source: "cboe" | "schwab_chain" | "computed_only";
};

export type ForResolvingLegSnapshot = (query: {
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly expiry: string; // YYYY-MM-DD
}) => Promise<Result<LegSnapshot | null, StorageError>>;

export type SnapshotRow = { /* 18 columns, all Drizzle-numeric strings, 'NaN' valid per D-06 */ };

export type ForPersistingSnapshot = (
  row: SnapshotRow,
) => Promise<Result<void, StorageError>>;
```
New ports follow the SAME naming (`ForVerbingNoun`), SAME `Result<T, StorageError>` return shape,
SAME query-object-in/nullable-value-out convention:
- `ForResolvingLegObservationForSlot` — like `ForResolvingLegSnapshot` but takes an additional
  `slotAnchor: Date` (the historical instant to resolve at-or-before), mirrors `readSmile`'s
  as-of-anchor semantics (Pattern E below) rather than "latest ever."
- `ForHealingSnapshot` — like `ForPersistingSnapshot` but with UPDATE-or-INSERT-or-no-op
  semantics instead of insert-only (Pattern F below); same `(row: SnapshotRow) => Promise<Result<void, StorageError>>` signature is sufficient — the fill-only logic lives in the adapter/use-case, not the type.

### Pattern E — As-of-slot leg resolution (HIST-02), mirrors `readSmile` exactly

**File to modify:** `packages/adapters/src/postgres/repos/leg-observations.ts`
**Analog (full source, same file, lines 325-382):**
```typescript
const readSmile: ForReadingSmileSource = async (
  snapshotTime,
): Promise<Result<SmileReadResult, StorageError>> => {
  try {
    // Step 1: resolve the latest BSM-solved leg cycle at or before the anchor.
    const latest = await db
      .select({ time: legObservations.time })
      .from(legObservations)
      .where(
        and(
          lte(legObservations.time, snapshotTime),
          isNotNull(legObservations.bsmIv),
          ne(legObservations.bsmIv, sql`'NaN'::numeric`),
        ),
      )
      .orderBy(desc(legObservations.time))
      .limit(1);
    const resolvedTime = latest[0]?.time;
    if (resolvedTime === undefined) return ok({ cycleTime: null, quotes: [] });

    // Step 2: read that cohort via the existing contracts join.
    const rows = await db.select({ /* ... */ })
      .from(legObservations)
      .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
      .where(and(eq(legObservations.time, resolvedTime), /* ... */));
    // ...map rows...
    return ok({ cycleTime: resolvedTime, quotes: smile });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err<StorageError>({ kind: "storage-error", message });
  }
};
```
The new `resolveLegObservationForSlot` copies this EXACT two-step shape: Step 1 finds the
observation instant `lte(legObservations.time, slotAnchor)` ordered `desc().limit(1)` (swap
`isNotNull(bsmIv)` gate for "usable data" per D-04); Step 2 joins `contracts` on
`inArray(contracts.root, resolveRootCandidates(underlying))` (Pattern A) instead of
`eq(contracts.root, query.underlying)` — this is also where `resolveLegSnapshot`'s bug-fix
(#3 above) and this new port's correct-by-construction root handling converge on the same
join shape.

**Memory twin analog** (`packages/adapters/src/memory/leg-observations.ts:113-145`,
`readSmile` twin) — same two-step logic over `Map` iteration instead of SQL:
```typescript
const readSmile: ForReadingSmileSource = async (snapshotTime) => {
  const anchor = snapshotTime.getTime();
  let resolvedTime: number | null = null;
  for (const leg of smileStore.values()) {
    if (leg.bsmIv === null || leg.bsmIv === "NaN") continue;
    const t = leg.snapshotTime.getTime();
    if (t > anchor) continue;
    if (resolvedTime === null || t > resolvedTime) resolvedTime = t;
  }
  if (resolvedTime === null) return ok({ cycleTime: null, quotes: [] });
  // ...filter smileStore to resolvedTime, map...
};
```

### Pattern F — Fill-only conditional heal-write (HIST-02/03), reuse `isGapRow`

**File to modify:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts`
**Gap predicate to reuse verbatim (LOCKED, do NOT redefine)** —
`packages/core/src/journal/domain/attribution.ts:78-83`:
```typescript
export function isGapRow(row: AttributionRow): boolean {
  if (row.spot === "0") return true;
  return [row.frontIv, row.backIv, row.netDelta, row.netGamma, row.netTheta, row.netVega].some(
    (value) => !Number.isFinite(parseFloat(value)),
  );
}
```
`SnapshotRow` is a structural superset of `AttributionRow` — pass it directly, no mapping.

**Closest existing conditional-write precedent in the SAME file (transactional UPDATE loop)** —
`recomputeSnapshotPnl`, `calendar-snapshots.ts:288-322`:
```typescript
const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (
  calendarId: string, openNetDebit: number, qty: number,
): Promise<Result<{ readonly rowsUpdated: number }, StorageError>> => {
  try {
    const rowsUpdated = await db.transaction(async (tx) => {
      const rows = await tx.select({ time: calendarSnapshots.time, netMark: calendarSnapshots.netMark })
        .from(calendarSnapshots)
        .where(eq(calendarSnapshots.calendarId, calendarId));
      for (const row of rows) {
        const pnlOpen = String(computeSnapshotPnl(parseFloat(row.netMark), openNetDebit, qty));
        await tx.update(calendarSnapshots).set({ pnlOpen })
          .where(and(eq(calendarSnapshots.calendarId, calendarId), eq(calendarSnapshots.time, row.time)));
      }
      return rows.length;
    });
    return ok({ rowsUpdated });
  } catch (e) { /* ...err(StorageError)... */ }
};
```
The new heal-write port follows this shape: `SELECT` the existing row (if any) by
`(time, calendar_id)` composite key → if absent, `INSERT` (mirror `persistSnapshot`,
`calendar-snapshots.ts:58-94`) → if present and `isGapRow(existing)`, `UPDATE` → if present and
NOT a gap, no-op. RESEARCH recommends the SELECT-then-decide shape (two round-trips) for the
first cut over a hand-written SQL `WHERE` predicate, to keep `isGapRow` the single source of
truth (see RESEARCH Pattern 3 for the ponytail-flagged rationale).

**Insert-only precedent this CANNOT be reused as-is** (`persistSnapshot`,
`calendar-snapshots.ts:58-94`):
```typescript
await db.insert(calendarSnapshots).values({ /* 18 columns incl. trigger: row.trigger ?? null */ })
  .onConflictDoNothing();
```
Structurally cannot satisfy D-03 (never updates an existing gap row) — a genuinely new port is
required, not a new caller of this one (RESEARCH Pitfall 2).

**Source-inclusive mapping fix precedent** (Pitfall 1 — `mapSnapshotRow` drops non-'cboe' rows;
the fix pattern already exists twice in the SAME file) —
`readLatestSnapshotPerOpenCalendar`, `calendar-snapshots.ts:363-370`:
```typescript
const mapped: LatestSnapshotForOpenCalendar[] = rows.map((row) => {
  // snapshot_source enum has a third value ("computed_only") that never actually lands in this
  // column — mirror that same mapping here (never drop the row, unlike mapSnapshotRow).
  const source: "cboe" | "schwab_chain" = row.source === "schwab_chain" ? "schwab_chain" : "cboe";
  const trigger: "scheduled" | "event-move" = row.trigger === "event-move" ? "event-move" : "scheduled";
  return { calendarId: row.calendarId, snapshot: { /* ...never `if (source !== "cboe") return null` */ } };
});
```
Apply this SAME inclusive-mapping fix to `mapSnapshotRow` (`calendar-snapshots.ts:468-501`,
which currently does `if (row.source !== "cboe") return null;` at line 473) — required so
healed `schwab_chain`-sourced rows don't silently vanish from `readJournal`/`LifecycleChart`
(the exact acceptance surface this phase targets).

**Memory twin analogs** (`packages/adapters/src/memory/calendar-snapshots.ts`):
`persistSnapshot` (lines 82-88, `if (!store.has(key)) store.set(...)` — onConflictDoNothing
equivalent) and `recomputeSnapshotPnl` (lines 150-164, direct `store.set` loop) are the two
shapes to combine for the heal-write twin — `Map`-based, no transaction needed.

### Pattern G — Self-heal job wiring (HIST-03), mirrors the on-demand handler exactly

**New files:** `packages/core/src/journal/application/selfHealJournal.ts`,
`apps/worker/src/handlers/self-heal-journal.ts`
**Analog (full source):** `apps/worker/src/handlers/register-open-calendars.ts` (on-demand,
NO RTH gate, account-wide payload — closest shape since self-heal isn't time-of-day sensitive):
```typescript
export const registerOpenCalendarsPayload = z.object({}).passthrough();

export type RegisterOpenCalendarsHandlerDeps = {
  readonly registerOpenCalendarsUseCase: ForRunningRegisterOpenCalendars;
  readonly now: () => Date;
};

export function makeRegisterOpenCalendarsHandler(deps): (jobs) => Promise<void> {
  return async ([job]) => {
    if (job === undefined) return; // pg-boss v12: array element can be undefined
    // No RTH gate — on-demand job, runs anytime
    const payloadResult = registerOpenCalendarsPayload.safeParse(job.data);
    if (!payloadResult.success) throw new Error(`...: invalid payload: ${payloadResult.error.message}`);
    const result = await deps.registerOpenCalendarsUseCase();
    if (!result.ok) throw new Error(result.error.message);
  };
}
```
`self-heal-journal.ts` follows this EXACT thin-adapter shape: array-guard → Zod-parse payload
(likely `{}` or an optional `lookbackDays` override) → call the use-case → throw on `!ok` (signals
pg-boss failure/retry). Zero business logic in the handler (architecture-boundaries §3).

**Chain-enqueue precedent** if the planner picks chain-triggering over cron
(`apps/worker/src/handlers/snapshot-calendars.ts:66-72`):
```typescript
void deps.boss.send("compute-analytics", {}, {
  singletonKey: "triggered-by-snapshot",
}).catch((e: unknown) => {
  console.warn("snapshot-calendars: failed to enqueue compute-analytics", e);
});
```
Fire-and-forget with a `singletonKey` to dedup — same idiom for chain-triggering `self-heal-journal`
after `snapshot-calendars` if the planner chooses that wiring over a bounded low-frequency cron.

**Job registration triad to copy** (`apps/worker/src/schedule.ts:128,211,232` —
`register-open-calendars`, the closest existing "on-demand only, account-wide, no cron" job):
```typescript
await boss.createQueue("register-open-calendars"); // JRNL-02: on-demand only, account-wide; no cron
// ...
// register-open-calendars: NO schedule — on-demand via trigger_job (JRNL-02)
// ...
await boss.work("register-open-calendars", POLLING_INTERVAL, handlers.registerOpenCalendars);
```
If the planner instead wants a bounded periodic self-heal, the `compute-bsm-greeks` hourly
fallback-cron registration (`schedule.ts:161-166`, `"0 * * * *"`, `{ tz: "America/New_York" }`)
is the closest "sparse fallback drain, chain-trigger is primary" precedent. `AllHandlers`
(`schedule.ts:72-89`) and `JobScheduler`/`PgBossHandler` types (`schedule.ts:42-58`) need one
new field each, matching the existing 16-entry pattern.

### Pattern H — Operator CLI (HIST-04), mirrors `fix-pnl-reingest.ts` exactly

**New file:** `apps/worker/src/repair-journal-history.ts`
**Analog (verified full-file read, key excerpts):** `apps/worker/src/fix-pnl-reingest.ts`

**Header docblock convention** (`fix-pnl-reingest.ts:1-38`) — states the sequence, the CRITICAL
FAILURE MODE if a mid-run step fails, and that every step is idempotent so re-running is safe.
`repair-journal-history.ts`'s header should state the equivalent for this phase: rebuild is
fill-only (D-03), so a partial run leaves already-healed rows healed and un-healed rows
untouched — safe to re-run, unlike `fix-pnl-reingest`'s wipe-then-backfill (which has a genuine
empty-window failure mode this phase's design avoids by construction).

**Composition-root guard + error-description helper** (`fix-pnl-reingest.ts:55-70`):
```typescript
type ErrorLike = { readonly kind: string; readonly message?: string };
function describeError(e: ErrorLike): string { return e.message ?? e.kind; }

// Guarded by import.meta.main so importing this module (e.g. from a test) does not boot it.
if (import.meta.main) {
  const { bootWorkerConfig } = await import("./config.ts");
  const { makeDb, makePostgresFillsRepo, /* ... */ } = await import(/* adapters */);
  // ...wire deps, run steps sequentially...
}
```

**Per-item loop + abort-with-progress-count pattern** (`fix-pnl-reingest.ts:235-262`):
```typescript
for (const cal of before) {
  console.warn(`fix-pnl-reingest: calendar ${cal.id} — rebuilding journal...`);
  const rebuildResult = await rebuildJournalUseCase(cal.id);
  if (!rebuildResult.ok) {
    console.error(`...: rebuild-journal FAILED for calendar ${cal.id}: ${describeError(rebuildResult.error)}`);
    console.error(`...: ${results.length}/${before.length} calendar(s) already corrected in this run ` +
      "(unaffected by this failure) — re-running this script is safe (idempotent).");
    process.exit(1);
  }
  // ...
}
```
`repair-journal-history.ts` mirrors this: loop over one calendar or "all" (an explicit flag,
never a silent default-to-all per RESEARCH's Security Domain note), call
`rebuildCalendarHistory` per calendar, print progress, `process.exit(1)` with a clear "N/total
already corrected, safe to re-run" message on any failure.

**Before/after summary table** (`fix-pnl-reingest.ts:281-292`):
```typescript
console.warn("");
console.warn("fix-pnl-reingest: BEFORE/AFTER openNetDebit");
console.warn("calendar_id                              before      after");
for (const r of results) {
  const afterStr = r.after === null ? "MISSING" : r.after.toFixed(2);
  console.warn(`${r.id}  ${r.before.toFixed(2).padStart(10)}  ${afterStr.padStart(9)}`);
}
console.warn("");
console.warn(`fix-pnl-reingest: done. ${results.length} calendar(s) corrected.`);
process.exit(0);
```
`repair-journal-history.ts` prints the equivalent per D-10: rows-before, non-gap-rows-before,
rows-after, non-gap-rows-after, days-covered — per calendar.

### Pattern I — On-register backfill (HIST-04), extend `registerOpenCalendars.ts`

**File to modify:** `packages/core/src/journal/application/registerOpenCalendars.ts`
**Analog:** itself — the existing `makeRegisterOpenCalendarsUseCase` loop
(`registerOpenCalendars.ts:139-211`) already calls `deps.registerCalendar({...})` per candidate
and pushes to `registered`. The chained backfill call (`rebuildCalendarHistory` for
`[openedAt, now]`) slots in immediately after `registerResult.ok` is confirmed, following the
SAME "call the next use-case inline, propagate its `Result` via `return` on failure" convention
already used throughout this file (e.g. `if (!fillsResult.ok) return fillsResult;` at line 168).

### Pattern J — Docs-first update (CLAUDE.md rule 4, must land before self-heal job code)

**File to modify:** `docs/architecture/jobs.md`
**Current row to rewrite** (`jobs.md:25`):
```markdown
| `snapshot-calendars` | chain-triggered only (NO cron) | For each open calendar: resolve front + back legs; write a `calendar_snapshots` row ONLY when both legs are present and fresher than `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` (~45 min = 1.5x the 30-min chain cadence). A missing or stale leg means that calendar is skipped for the cycle (no row written), logged via `console.warn`, self-healing on the next fresh cycle (OPS-01 root-cause fix — historical gap rows are never backfilled) |
```
The phrase "historical gap rows are never backfilled" becomes false once HIST-02/03/04 ship —
rewrite to distinguish "live self-heal" (existing, forward-only, unchanged) from "historical
repair" (new, this phase — bounded self-heal for OPEN calendars + unbounded CLI for all). Add a
new Job Catalog table row for the self-heal job, following the exact column shape of the
existing rows (`Job | Schedule (America/New_York) | Does`).

## Shared Patterns

### Result<T, E> / err/ok threading
**Source:** `packages/shared/src/result.ts` (full file, 8 lines)
**Apply to:** every new port, use-case, and adapter function in this phase.
```typescript
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
```
No exceptions for control flow in core (typescript.md) — every fallible new function returns
`Result`; adapters `try/catch` and map to `StorageError` at the I/O boundary only.

### StorageError shape
**Source:** `packages/core/src/journal/application/ports.ts` (implied by every port above)
```typescript
export type StorageError = { readonly kind: "storage-error"; readonly message: string };
```
Every new port's error channel is `StorageError` (or a union including it), matching
`ForResolvingLegSnapshot`/`ForPersistingSnapshot` exactly — no new error taxonomy needed.

### Clock injection — never `Date.now()` in core
**Pattern (from `SnapshotCalendarsDeps`, `snapshotCalendars.ts:124-125`):**
```typescript
readonly now: () => Date; // Clock injection — never call Date.now() in core (architecture-boundaries.md §2)
```
`rebuildCalendarHistory.ts`, `selfHealJournal.ts`, and the new slot-rounding domain function all
take `now`/anchor times as explicit parameters — zero `Date.now()` calls anywhere in `packages/core`.

### Zod-parse job payload at the handler boundary
**Source:** `apps/worker/src/handlers/register-open-calendars.ts:18,35-40`
```typescript
export const registerOpenCalendarsPayload = z.object({}).passthrough();
// ...
const payloadResult = registerOpenCalendarsPayload.safeParse(job.data);
if (!payloadResult.success) {
  throw new Error(`register-open-calendars: invalid payload: ${payloadResult.error.message}`);
}
```
**Apply to:** `self-heal-journal.ts`'s handler and any CLI argv parsing in `repair-journal-history.ts`.

### Memory-twin discipline (architecture-boundaries rule 8)
Every new/changed driven port in this phase (`ForResolvingLegObservationForSlot`,
`ForHealingSnapshot`) ships its Postgres implementation AND its
`packages/adapters/src/memory/` twin in the SAME PR, contract-tested against both — see
`__contract__/calendar-snapshots.contract.ts`'s existing `CalendarSnapshotsRepo` type
(`packages/adapters/src/__contract__/calendar-snapshots.contract.ts:36`) as the contract-test
harness precedent to extend, not reinvent.

### `isGapRow` — the ONE locked gap definition, never redefine
**Source:** `packages/core/src/journal/domain/attribution.ts:78-83` (see Pattern F above for the
full excerpt). Reused by the heal-write port (D-03's "is this row a gap" test) — never a second,
possibly-drifting hand-written NaN/zero check in SQL or a new TS predicate.

### `TRIGGERABLE_JOBS` — optional operator-trigger extension (Claude's Discretion)
**Source:** `packages/contracts/src/jobs.ts:12-21` (full array)
```typescript
export const TRIGGERABLE_JOBS = [
  "rebuild-journal", "sync-fills", "compute-bsm-greeks", "recompute-snapshot-pnl",
  "wipe-derived-fills", "register-open-calendars", "fetch-schwab-chain",
] as const;
```
If the planner wants the self-heal job manually triggerable in prod without `railway run` shell
access, add one entry here — the `POST /api/jobs/:name/trigger` route and `trigger_job` MCP tool
already share this schema (MCP-02), so this is a one-line, already-generic extension, not new
architecture.

## No Analog Found

None. Every new file in this phase (occ-root.ts, the slot-rounding fn, rebuildCalendarHistory.ts,
selfHealJournal.ts, self-heal-journal.ts, repair-journal-history.ts) has a same-shape,
directly-copyable precedent already in the codebase — this matches RESEARCH.md's own stated
conclusion (no genuinely new architecture, only new instances of existing patterns).

## Metadata

**Analog search scope:** `packages/core/src/journal/{domain,application}/`,
`packages/adapters/src/{postgres/repos,memory}/`, `apps/worker/src/{handlers,}`,
`packages/shared/src/`, `packages/contracts/src/`, `docs/architecture/jobs.md`
**Files scanned (verbatim source read/verified):** `attribution.ts`, `snapshotCalendars.ts`,
`ports.ts`, `registerOpenCalendars.ts`, `getLiveGreeks.ts`, `position-pairing.ts`,
`calendar-snapshots.ts` (postgres), `leg-observations.ts` (postgres), `calendars.ts` (postgres),
`calendar-snapshots.ts` (memory), `leg-observations.ts` (memory), `calendars.ts` (memory),
`occ-symbol.ts`, `rth-window.ts`, `result.ts`, `jobs.ts` (contracts), `schedule.ts`,
`snapshot-calendars.ts` (handler), `register-open-calendars.ts` (handler),
`fix-pnl-reingest.ts`, `docs/architecture/jobs.md`
**Pattern extraction date:** 2026-07-14
