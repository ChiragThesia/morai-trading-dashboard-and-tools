/**
 * makePostgresCalendarSnapshotsRepo — Postgres implementation of
 * ForPersistingSnapshot, ForReadingJournal, ForResolvingLegSnapshot.
 *
 * persistSnapshot: INSERT with onConflictDoNothing on composite PK (time, calendar_id).
 *   'NaN' strings in numeric columns insert cleanly (T-03-13 / D-06).
 *
 * readJournal: reads ordered by time ASC; null when calendarId unknown (drives 404).
 *
 * resolveLegSnapshot: two-step join.
 *   Step 1 — contracts table: match (underlying, strike ×1000 int, expiration, contractType)
 *   Step 2 — leg_observations: latest row (ORDER BY time DESC LIMIT 1) for the occSymbol
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * T-02-09: Drizzle parameterized queries; no raw template interpolation.
 */

import { ok, err, parseOccSymbol, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { computeSnapshotPnl } from "@morai/core";
import type {
  ForPersistingSnapshot,
  ForReadingJournal,
  ForResolvingLegSnapshot,
  ForReadingCalendarSnapshotsForCycle,
  ForReadingLatestSnapshotTime,
  ForRecomputingSnapshotPnl,
  SnapshotRow,
  LegSnapshot,
  CalendarSnapshotForCycle,
  StorageError,
} from "@morai/core";
import { eq, and, lte, desc, asc, max } from "drizzle-orm";
import { calendarSnapshots, legObservations, contracts, calendars } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresCalendarSnapshotsRepo = {
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegSnapshot: ForResolvingLegSnapshot;
  readonly readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle;
  readonly readLatestSnapshotTime: ForReadingLatestSnapshotTime;
  readonly recomputeSnapshotPnl: ForRecomputingSnapshotPnl;
};

export function makePostgresCalendarSnapshotsRepo(
  db: Db,
): PostgresCalendarSnapshotsRepo {
  // ─── ForPersistingSnapshot ──────────────────────────────────────────────────
  // Idempotent INSERT — composite PK (time, calendar_id) absorbs duplicates.
  // 'NaN' numeric strings are valid for Postgres numeric columns (T-03-13).
  const persistSnapshot: ForPersistingSnapshot = async (
    row: SnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .insert(calendarSnapshots)
        .values({
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
          // SNAP-01 / D-12: provenance marker. Undefined/absent -> stored as NULL,
          // read back as "scheduled" (mapSnapshotRow default).
          trigger: row.trigger ?? null,
        })
        .onConflictDoNothing();
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingJournal ──────────────────────────────────────────────────────
  // First checks if the calendar exists; unknown → ok(null) (drives 404 at route layer).
  // Known → returns all rows ordered by time ASC (empty array when no snapshots).
  const readJournal: ForReadingJournal = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<SnapshotRow> | null, StorageError>> => {
    try {
      // Check calendar existence (FK would reject inserts for bad calendarId,
      // but reads against an unknown id should return null, not an empty array).
      const calExists = await db
        .select({ id: calendars.id })
        .from(calendars)
        .where(eq(calendars.id, calendarId))
        .limit(1);

      if (calExists.length === 0) return ok(null);

      const rows = await db
        .select()
        .from(calendarSnapshots)
        .where(eq(calendarSnapshots.calendarId, calendarId))
        .orderBy(asc(calendarSnapshots.time));

      const mapped: SnapshotRow[] = [];
      for (const row of rows) {
        const sr = mapSnapshotRow(row);
        if (sr === null) {
          // Unexpected source enum value — guard against silent misreport.
          console.warn(`calendar-snapshots: skipping row with unknown source "${row.source}" for calendar ${calendarId}`);
          continue;
        }
        mapped.push(sr);
      }
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForResolvingLegSnapshot ────────────────────────────────────────────────
  // Two-step join per D-04 / RESEARCH Focus Area 4:
  //   Step 1: contracts WHERE (underlying, strike [×1000], expiration, contractType) → occSymbol
  //   Step 2: leg_observations WHERE contract = occSymbol ORDER BY time DESC LIMIT 1
  const resolveLegSnapshot: ForResolvingLegSnapshot = async (query: {
    readonly underlying: string;
    readonly strike: number; // ×1000 int
    readonly optionType: "C" | "P";
    readonly expiry: string; // YYYY-MM-DD
  }): Promise<Result<LegSnapshot | null, StorageError>> => {
    try {
      // Step 1: find the OCC symbol via attribute match.
      // Match on contracts.ROOT, not contracts.underlying: weekly options carry occ root
      // "SPXW" while contracts.underlying is the index "SPX". Calendars are tracked by the
      // root ("SPXW"), so matching underlying would never hit (→ null legs → 0/NaN snapshots).
      // The root also disambiguates the SPX vs SPXW share of a strike/expiry (different settle).
      const contractRows = await db
        .select({ occSymbol: contracts.occSymbol })
        .from(contracts)
        .where(
          and(
            eq(contracts.root, query.underlying),
            eq(contracts.strike, query.strike), // both ×1000 int
            eq(contracts.expiration, query.expiry),
            eq(contracts.contractType, query.optionType),
          ),
        )
        .limit(1);

      const contractRow = contractRows[0];
      if (contractRow === undefined) return ok(null);

      const occSymbolRaw = contractRow.occSymbol;

      // Parse to OccSymbol brand (parse, don't cast — typescript.md)
      const parsedOcc = parseOccSymbol(occSymbolRaw);
      if (!parsedOcc.ok) return ok(null); // malformed symbol in DB → null

      // Step 2: latest leg_observation for this occSymbol
      const obsRows = await db
        .select({
          time: legObservations.time,
          mark: legObservations.mark,
          underlyingPrice: legObservations.underlyingPrice,
          iv: legObservations.iv,
          bsmIv: legObservations.bsmIv,
          bsmDelta: legObservations.bsmDelta,
          bsmGamma: legObservations.bsmGamma,
          bsmTheta: legObservations.bsmTheta,
          bsmVega: legObservations.bsmVega,
          source: legObservations.source,
        })
        .from(legObservations)
        .where(eq(legObservations.contract, occSymbolRaw))
        .orderBy(desc(legObservations.time))
        .limit(1);

      const obsRow = obsRows[0];
      if (obsRow === undefined) return ok(null);

      const leg: LegSnapshot = {
        occSymbol: formatOccSymbol(parsedOcc.value),
        time: obsRow.time,
        mark: parseFloat(obsRow.mark),
        underlyingPrice: parseFloat(obsRow.underlyingPrice),
        ivRaw: obsRow.iv !== null ? parseFloat(obsRow.iv) : null,
        bsmIv: obsRow.bsmIv, // null or string ('NaN' | numeric)
        bsmDelta: obsRow.bsmDelta,
        bsmGamma: obsRow.bsmGamma,
        bsmTheta: obsRow.bsmTheta,
        bsmVega: obsRow.bsmVega,
        source: obsRow.source,
      };

      return ok(leg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingCalendarSnapshotsForCycle (06-04) ──────────────────────────────
  // Reads the calendar_snapshots rows for the CURRENT cycle — the most recent snapshot
  // time on or before `snapshotTime` — and maps them to the term-slope passthrough shape.
  // term_slope crosses as a numeric string; "NaN" → parseFloat → NaN, which the
  // computeAnalytics use-case skips (D-06 continuity rows are never written).
  const readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle = async (
    snapshotTime: Date,
  ): Promise<Result<ReadonlyArray<CalendarSnapshotForCycle>, StorageError>> => {
    try {
      // Find the latest snapshot time on or before the requested cycle time.
      const latest = await db
        .select({ time: calendarSnapshots.time })
        .from(calendarSnapshots)
        .where(lte(calendarSnapshots.time, snapshotTime))
        .orderBy(desc(calendarSnapshots.time))
        .limit(1);

      const cycleTime = latest[0]?.time;
      if (cycleTime === undefined) return ok([]);

      const rows = await db
        .select({
          time: calendarSnapshots.time,
          calendarId: calendarSnapshots.calendarId,
          termSlope: calendarSnapshots.termSlope,
          frontIv: calendarSnapshots.frontIv,
          backIv: calendarSnapshots.backIv,
        })
        .from(calendarSnapshots)
        .where(eq(calendarSnapshots.time, cycleTime));

      const mapped: CalendarSnapshotForCycle[] = rows.map((row) => ({
        snapshotTime: row.time,
        calendarId: row.calendarId,
        termSlope: parseFloat(row.termSlope),
        frontIv: parseFloat(row.frontIv),
        backIv: parseFloat(row.backIv),
      }));
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingLatestSnapshotTime (20-05, SNAP-01 Pattern 2) ─────────────────
  // SELECT MAX(time) — index-only scan (time leads the composite PK). Null on
  // cold start (no rows). Never throws — DB errors map to StorageError.
  const readLatestSnapshotTime: ForReadingLatestSnapshotTime = async (): Promise<
    Result<Date | null, StorageError>
  > => {
    try {
      const rows = await db
        .select({ latest: max(calendarSnapshots.time) })
        .from(calendarSnapshots);
      const latest = rows[0]?.latest;
      return ok(latest !== null && latest !== undefined ? latest : null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── recomputeSnapshotPnl (JRNL-01 pnl-unit-mismatch fix) ────────────────────
  // Re-derives pnl_open on every stored row for a calendar from the given openNetDebit/qty,
  // using the SAME D-05 formula the live snapshot writer uses (computeSnapshotPnl) — no
  // formula drift. No online fetch: re-derives purely from each row's stored net_mark.
  //
  // Atomicity (money path): the SELECT + per-row UPDATEs run inside one transaction, so a
  // mid-loop failure rolls back the whole batch rather than leaving a calendar's snapshots
  // half-corrected. rowsUpdated therefore reflects a single committed all-or-nothing batch.
  const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (
    calendarId: string,
    openNetDebit: number,
    qty: number,
  ): Promise<Result<{ readonly rowsUpdated: number }, StorageError>> => {
    try {
      const rowsUpdated = await db.transaction(async (tx) => {
        const rows = await tx
          .select({ time: calendarSnapshots.time, netMark: calendarSnapshots.netMark })
          .from(calendarSnapshots)
          .where(eq(calendarSnapshots.calendarId, calendarId));

        for (const row of rows) {
          const netMark = parseFloat(row.netMark);
          const pnlOpen = String(computeSnapshotPnl(netMark, openNetDebit, qty));
          await tx
            .update(calendarSnapshots)
            .set({ pnlOpen })
            .where(
              and(
                eq(calendarSnapshots.calendarId, calendarId),
                eq(calendarSnapshots.time, row.time),
              ),
            );
        }

        return rows.length;
      });

      return ok({ rowsUpdated });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    persistSnapshot,
    readJournal,
    resolveLegSnapshot,
    readSnapshotsForCycle,
    readLatestSnapshotTime,
    recomputeSnapshotPnl,
  };
}

// ─── Row mapper ─────────────────────────────────────────────────────────────

type RawSnapshotRow = typeof calendarSnapshots.$inferSelect;

function mapSnapshotRow(row: RawSnapshotRow): SnapshotRow | null {
  // snapshot_source enum can be "schwab_chain" | "cboe" | "computed_only".
  // SnapshotRow.source is typed as the literal "cboe" — guard at runtime so
  // an unexpected source value surfaces loudly rather than being silently
  // coerced. (No implicit as-cast per typescript.md.)
  if (row.source !== "cboe") return null;
  const source = row.source; // narrowed to "cboe"
  // SNAP-01 / D-12: NULL (legacy rows, pre-0016) and any unexpected value default to
  // "scheduled" — the only other valid value is "event-move".
  const trigger: "scheduled" | "event-move" =
    row.trigger === "event-move" ? "event-move" : "scheduled";
  return {
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
    source,
    trigger,
  };
}
